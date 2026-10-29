// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { configureI18n } from '../packages/i18n/src';
import { en } from '../apps/desktop/src/locales/en';
import { ScreenShareGallery } from '../apps/desktop/src/ScreenShareGallery';
import type { MediaTrack, MediaParticipant } from '@rooms/media';
afterEach(cleanup);
const tracks = ['one', 'two'].map((id, i) => ({
  id,
  participantId: id,
  source: 'screen_share',
  kind: 'video',
  local: i === 0,
  muted: false,
})) as MediaTrack[];
const people = [
  { id: 'one', name: 'DEMO Alice' },
  { id: 'two', name: 'DEMO Bob' },
] as MediaParticipant[];
it('shows self and friend previews, enlarges the selected share, and falls back when it ends', () => {
  const props = {
    tracks,
    people,
    notify: () => {},
    renderTrack: (id: string) => <video data-testid={id} />,
  };
  const view = render(<ScreenShareGallery {...props} initialTrackId="two" />);
  expect(
    view.container.querySelector('[data-screen-focus] video')?.getAttribute('data-testid'),
  ).toBe('two');
  fireEvent.click(screen.getByRole('button', { name: 'DEMO Alice (sen) ekranını büyüt' }));
  expect(
    view.container.querySelector('[data-screen-focus] video')?.getAttribute('data-testid'),
  ).toBe('one');
  view.rerender(<ScreenShareGallery {...props} tracks={[tracks[1]]} />);
  expect(
    view.container.querySelector('[data-screen-focus] video')?.getAttribute('data-testid'),
  ).toBe('two');
});
it('keeps the view open and reports when the provider has no watch control', () => {
  const messages: string[] = [];
  const onWatch = () => {
    throw new Error('Stream watch control is unavailable.');
  };
  const view = render(
    <ScreenShareGallery
      tracks={tracks}
      people={people}
      initialTrackId="two"
      onWatch={onWatch}
      notify={(message) => messages.push(message)}
      renderTrack={(id: string) => <video data-testid={id} />}
    />,
  );
  expect(
    view.container.querySelector('[data-screen-focus] video')?.getAttribute('data-testid'),
  ).toBe('two');
  expect(messages.length).toBeGreaterThan(0);
  expect(() => view.unmount()).not.toThrow();
});
describe('viewer quality picker', () => {
  const layers = [
    { quality: 'low', width: 640, height: 360 },
    { quality: 'medium', width: 1280, height: 720 },
    { quality: 'high', width: 1920, height: 1080 },
  ] as const;
  const remote = (trackLayers: readonly { quality: string; width: number; height: number }[]) =>
    [{ ...tracks[1], layers: trackLayers }] as MediaTrack[];
  const show = (props: Partial<Parameters<typeof ScreenShareGallery>[0]>) =>
    render(
      <ScreenShareGallery
        tracks={remote(layers)}
        people={people}
        notify={() => {}}
        renderTrack={(id: string) => <video data-testid={id} />}
        {...props}
      />,
    );
  const description = (element: HTMLElement) =>
    document.getElementById(element.getAttribute('aria-describedby') ?? '')?.textContent;
  afterEach(() => configureI18n({ locale: 'tr', catalog: {} }));
  it('offers Otomatik and every layer the publisher sends, and reports the pick', () => {
    const picks: unknown[] = [];
    show({ quality: 'auto', onQuality: (value) => picks.push(value) });
    const picker = screen.getByRole('combobox', { name: 'Görüntü kalitesi' });
    expect([...(picker as HTMLSelectElement).options].map((option) => option.text)).toEqual([
      'Otomatik',
      '1080p',
      '720p',
      '360p',
    ]);
    expect((picker as HTMLSelectElement).value).toBe('auto');
    // Reachable with the keyboard: a native, enabled select in the tab order.
    expect((picker as HTMLSelectElement).disabled).toBe(false);
    expect(picker.tabIndex).toBe(0);
    picker.focus();
    expect(document.activeElement).toBe(picker);
    fireEvent.change(picker, { target: { value: '720' } });
    fireEvent.change(picker, { target: { value: 'auto' } });
    expect(picks).toEqual([720, 'auto']);
  });
  it('shows a remembered cap on the layer it lands on for an rc.34 two-layer stream', () => {
    show({
      tracks: remote([
        { quality: 'low', width: 960, height: 540 },
        { quality: 'medium', width: 1920, height: 1080 },
      ]),
      quality: 720,
      onQuality: () => {},
    });
    const picker = screen.getByRole('combobox', { name: 'Görüntü kalitesi' }) as HTMLSelectElement;
    expect([...picker.options].map((option) => option.value)).toEqual(['auto', '1080', '540']);
    expect(picker.value).toBe('540');
  });
  it('explains a single-layer stream instead of offering a choice', () => {
    const picks: unknown[] = [];
    show({ tracks: remote([layers[2]]), quality: 360, onQuality: (value) => picks.push(value) });
    const picker = screen.getByRole('combobox', { name: 'Görüntü kalitesi' }) as HTMLSelectElement;
    // Unavailable but still focusable, so a keyboard user reaches the reason.
    expect(picker.getAttribute('aria-disabled')).toBe('true');
    expect(picker.tabIndex).toBe(0);
    expect([...picker.options].map((option) => option.value)).toEqual(['1080']);
    expect(picker.value).toBe('1080');
    fireEvent.change(picker, { target: { value: '1080' } });
    expect(picks).toEqual([]);
    expect(description(picker)).toBe('Bu yayın tek kalitede geliyor; seçilecek başka kalite yok.');
  });
  it('has no picker on your own share, before layers are known, or while the stream opens', () => {
    const view = show({ tracks: [tracks[0]!], onQuality: () => {} });
    expect(screen.queryByRole('combobox')).toBeNull();
    view.rerender(
      <ScreenShareGallery
        tracks={remote([])}
        people={people}
        notify={() => {}}
        onQuality={() => {}}
        renderTrack={(id: string) => <video data-testid={id} />}
      />,
    );
    expect(screen.queryByRole('combobox')).toBeNull();
    view.rerender(
      <ScreenShareGallery
        tracks={[{ ...remote(layers)[0]!, subscribed: false }]}
        people={people}
        notify={() => {}}
        onQuality={() => {}}
        renderTrack={(id: string) => <video data-testid={id} />}
      />,
    );
    expect(screen.queryByRole('combobox')).toBeNull();
  });
  it('is labelled in English', () => {
    configureI18n({ locale: 'en', catalog: en });
    show({ tracks: remote([layers[2]]), onQuality: () => {} });
    const picker = screen.getByRole('combobox', { name: 'Video quality' });
    expect(description(picker)).toBe(
      'This stream comes in a single quality; there is no other quality to choose.',
    );
    cleanup();
    show({ onQuality: () => {} });
    expect(screen.getByRole('option', { name: 'Auto' })).toBeTruthy();
  });
});
