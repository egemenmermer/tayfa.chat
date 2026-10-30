// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
const f = vi.hoisted(() => ({
  snapshot: {
    status: 'connected',
    channelId: 'room',
    roomName: 'Test room',
    muted: true,
    camera: false,
    sharing: true,
    sharingAudio: true,
    sharingQuality: '1080p60' as string | null,
    deafened: false,
    participants: [],
    tracks: [],
    busy: false,
    error: null,
  },
  capture: vi.fn(),
  status: vi.fn(),
  start: vi.fn(),
  stop: vi.fn(),
  quality: vi.fn(),
  sound: vi.fn(),
  source: vi.fn(),
}));
vi.mock('../apps/desktop/src/realtime', () => ({
  useVoiceRejoin: (select: (state: { rejoin: null }) => unknown) => select({ rejoin: null }),
  useRealtime: () => f.snapshot,
  useVoiceContext: (select: (state: { channelId: string }) => unknown) =>
    select({ channelId: 'room' }),
  joinVoice: vi.fn(),
  leaveVoice: vi.fn(),
  toggleMic: vi.fn(),
  toggleDeafen: vi.fn(),
  toggleCamera: vi.fn(),
  startScreen: f.start,
  stopScreen: f.stop,
  changeScreenSource: f.source,
  changeScreenQuality: f.quality,
  setScreenSound: f.sound,
  setParticipantVolume: vi.fn(),
  startRoomAudio: vi.fn(),
  attachMediaTrack: vi.fn(),
  playSoundboard: vi.fn(),
  stopSoundboard: vi.fn(),
}));
vi.mock('../apps/desktop/src/runtime-sources', () => ({
  mediaBridge: () => ({ captureSources: f.capture, captureStatus: f.status }),
}));
vi.mock('../apps/desktop/src/screen-handoff', () => ({
  ScreenHandoffControls: () => null,
  cancelScreenHandoff: vi.fn(),
  decideScreenHandoff: vi.fn(),
  useScreenHandoff: (selector: any) => selector({ value: null, error: null }),
}));
import { RealVoiceDock } from '../apps/desktop/src/RealSocial';
import { OwnShareMenu } from '../apps/desktop/src/ShareMenu';
import { ScreenShareGallery } from '../apps/desktop/src/ScreenShareGallery';

afterEach(cleanup);
beforeEach(() => {
  vi.clearAllMocks();
  Object.assign(f.snapshot, {
    status: 'connected',
    sharing: true,
    sharingAudio: true,
    sharingQuality: '1080p60',
  });
  f.capture.mockResolvedValue([{ id: 'window:next', name: 'NEXT window', thumbnail: '' }]);
  f.status.mockResolvedValue({ screen: 'granted', systemAudio: true });
  f.stop.mockResolvedValue(undefined);
  f.quality.mockResolvedValue(undefined);
  f.sound.mockResolvedValue({ audio: true });
  f.source.mockResolvedValue(undefined);
  localStorage.clear();
});
const mountMenu = (notify: (m: string) => void = () => {}) =>
  render(
    <>
      <button data-own-share-menu="" data-testid="own">
        yayın
      </button>
      <button data-testid="other">başka</button>
      <OwnShareMenu notify={notify} />
    </>,
  );
const openMenu = () => {
  fireEvent.contextMenu(screen.getByTestId('own'));
  return screen.getByRole('menu', { name: 'Yayın ayarları' });
};

it('opens on right-click of your own share with every item, the current quality marked', async () => {
  mountMenu();
  const menu = openMenu();
  expect(
    within(menu).getByRole('menuitem', { name: 'Ekranı veya pencereyi değiştir' }),
  ).toBeTruthy();
  const radios = within(menu).getAllByRole('menuitemradio');
  expect(radios.map((r) => r.textContent)).toEqual([
    '720p30',
    '1080p30',
    '1080p60',
    '1440p60',
    '4k30',
  ]);
  expect(radios.map((r) => r.getAttribute('aria-checked'))).toEqual([
    'false',
    'false',
    'true',
    'false',
    'false',
  ]);
  const sound = await within(menu).findByRole('menuitemcheckbox', { name: 'Sesi de paylaş' });
  expect(sound.getAttribute('aria-checked')).toBe('true');
  expect(within(menu).getByRole('menuitem', { name: 'Yayını durdur' })).toBeTruthy();
});
it('never opens for viewers, on other elements, or while the room is not connected', () => {
  f.snapshot.sharing = false; // someone watching, not sharing
  mountMenu();
  fireEvent.contextMenu(screen.getByTestId('own'));
  expect(screen.queryByRole('menu')).toBeNull();
  cleanup();
  f.snapshot.sharing = true;
  mountMenu();
  fireEvent.contextMenu(screen.getByTestId('other'));
  expect(screen.queryByRole('menu')).toBeNull();
  cleanup();
  f.snapshot.status = 'reconnecting';
  mountMenu();
  fireEvent.contextMenu(screen.getByTestId('own'));
  expect(screen.queryByRole('menu')).toBeNull();
});
it('closes by itself when the share ends', () => {
  const view = mountMenu();
  openMenu();
  f.snapshot.sharing = false;
  view.rerender(
    <>
      <button data-own-share-menu="" data-testid="own" />
      <OwnShareMenu notify={() => {}} />
    </>,
  );
  expect(screen.queryByRole('menu')).toBeNull();
});
it('opens with Shift+F10 and the menu key, moves with the arrows, Escape returns focus', async () => {
  mountMenu();
  const own = screen.getByTestId('own');
  own.focus();
  fireEvent.keyDown(own, { key: 'F10' }); // plain F10 does nothing
  expect(screen.queryByRole('menu')).toBeNull();
  fireEvent.keyDown(own, { key: 'F10', shiftKey: true });
  const menu = screen.getByRole('menu', { name: 'Yayın ayarları' });
  const first = within(menu).getByRole('menuitem', { name: 'Ekranı veya pencereyi değiştir' });
  await waitFor(() => expect(document.activeElement).toBe(first));
  fireEvent.keyDown(document.activeElement!, { key: 'ArrowDown' });
  expect(document.activeElement).toBe(within(menu).getAllByRole('menuitemradio')[0]);
  fireEvent.keyDown(document.activeElement!, { key: 'ArrowUp' });
  expect(document.activeElement).toBe(first);
  fireEvent.keyDown(document.activeElement!, { key: 'Escape' });
  expect(screen.queryByRole('menu')).toBeNull();
  expect(document.activeElement).toBe(own);
  fireEvent.keyDown(own, { key: 'ContextMenu' });
  expect(screen.getByRole('menu', { name: 'Yayın ayarları' })).toBeTruthy();
});
it('a quality pick changes the running share and closes; the current one only closes', async () => {
  mountMenu();
  fireEvent.click(within(openMenu()).getByRole('menuitemradio', { name: '720p30' }));
  await waitFor(() => expect(f.quality).toHaveBeenCalledWith('720p30'));
  await waitFor(() => expect(screen.queryByRole('menu')).toBeNull());
  expect(f.stop).not.toHaveBeenCalled();
  f.quality.mockClear();
  fireEvent.click(within(openMenu()).getByRole('menuitemradio', { name: '1080p60' }));
  expect(f.quality).not.toHaveBeenCalled();
});
it('a failed quality change says so, keeps the menu and the share', async () => {
  const notify = vi.fn();
  f.quality.mockRejectedValue(new Error('Kalite değiştirilemedi, yayın önceki kaliteyle sürüyor.'));
  mountMenu(notify);
  fireEvent.click(within(openMenu()).getByRole('menuitemradio', { name: '4k30' }));
  await waitFor(() => expect(notify).toHaveBeenCalledWith(expect.stringContaining('sürüyor')));
  expect(screen.getByRole('menu')).toBeTruthy();
  expect(f.stop).not.toHaveBeenCalled();
});
it('sound toggle turns the sound off, remembers it, and turns it on again', async () => {
  mountMenu();
  let menu = openMenu();
  fireEvent.click(await within(menu).findByRole('menuitemcheckbox', { name: 'Sesi de paylaş' }));
  await waitFor(() => expect(f.sound).toHaveBeenCalledWith(false));
  expect(localStorage.getItem('rooms-share-audio-v1')).toBe('0');
  f.snapshot.sharingAudio = false;
  cleanup();
  mountMenu();
  menu = openMenu();
  const toggle = await within(menu).findByRole('menuitemcheckbox', { name: 'Sesi de paylaş' });
  expect(toggle.getAttribute('aria-checked')).toBe('false');
  fireEvent.click(toggle);
  await waitFor(() => expect(f.sound).toHaveBeenLastCalledWith(true));
  expect(localStorage.getItem('rooms-share-audio-v1')).toBe('1');
});
it('turning sound on without a loopback track tells the sharer the picture goes alone', async () => {
  const notify = vi.fn();
  f.snapshot.sharingAudio = false;
  f.sound.mockResolvedValue({ audio: false });
  mountMenu(notify);
  fireEvent.click(
    await within(openMenu()).findByRole('menuitemcheckbox', { name: 'Sesi de paylaş' }),
  );
  await waitFor(() =>
    expect(notify).toHaveBeenCalledWith(expect.stringContaining('yalnızca görüntü')),
  );
});
it('sound is disabled with the reason where this computer cannot capture it', async () => {
  f.status.mockResolvedValue({
    screen: 'granted',
    systemAudio: false,
    systemAudioReason: 'macos-version',
  });
  mountMenu();
  const toggle = await within(openMenu()).findByRole('menuitemcheckbox', {
    name: 'Sesi de paylaş',
  });
  await waitFor(() => expect((toggle as HTMLButtonElement).disabled).toBe(true));
  expect(screen.getByText(/macOS 14.2 veya üstü gerekir/)).toBeTruthy();
  expect(toggle.getAttribute('aria-describedby')).toBe('own-share-sound-note');
});
it('Yayını durdur stops the share; changing the source asks for the picker without stopping', async () => {
  const chosen = vi.fn();
  window.addEventListener('rooms:choose-capture', chosen);
  mountMenu();
  fireEvent.click(
    within(openMenu()).getByRole('menuitem', { name: 'Ekranı veya pencereyi değiştir' }),
  );
  expect(chosen).toHaveBeenCalledOnce();
  expect(f.stop).not.toHaveBeenCalled();
  expect(screen.queryByRole('menu')).toBeNull();
  window.removeEventListener('rooms:choose-capture', chosen);
  fireEvent.click(within(openMenu()).getByRole('menuitem', { name: 'Yayını durdur' }));
  await waitFor(() => expect(f.stop).toHaveBeenCalledOnce());
});
it('the dock share controls and your own tile open the menu; a remote tile does not', () => {
  render(
    <MemoryRouter initialEntries={['/voice']}>
      <RealVoiceDock openLauncher={() => {}} notify={() => {}} />
    </MemoryRouter>,
  );
  fireEvent.contextMenu(screen.getByRole('button', { name: 'Paylaşımı durdur' }));
  expect(screen.getByRole('menu', { name: 'Yayın ayarları' })).toBeTruthy();
  cleanup();
  const gallery = (local: boolean) =>
    render(
      <>
        <ScreenShareGallery
          tracks={[
            {
              id: 't1',
              participantId: 'p1',
              source: 'screen_share',
              kind: 'video',
              local,
              muted: false,
            },
          ]}
          people={[]}
          renderTrack={() => <video />}
          notify={() => {}}
        />
        <OwnShareMenu notify={() => {}} />
      </>,
    );
  const own = gallery(true);
  fireEvent.contextMenu(own.container.querySelector('[data-screen-focus]')!);
  expect(screen.getByRole('menu', { name: 'Yayın ayarları' })).toBeTruthy();
  cleanup();
  gallery(false);
  fireEvent.contextMenu(document.querySelector('[data-screen-focus]')!);
  expect(screen.queryByRole('menu')).toBeNull();
});
it('while sharing, the picker switches the source of the running share instead of starting one', async () => {
  render(
    <MemoryRouter initialEntries={['/voice']}>
      <RealVoiceDock openLauncher={() => {}} notify={() => {}} />
    </MemoryRouter>,
  );
  window.dispatchEvent(new Event('rooms:choose-capture'));
  fireEvent.click(await screen.findByRole('button', { name: /NEXT window/ }));
  // Quality and sound belong to the menu in this mode.
  expect(screen.queryByRole('switch', { name: 'Sesi de paylaş' })).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Bu kaynağa geç' }));
  await waitFor(() => expect(f.source).toHaveBeenCalledWith('window:next'));
  expect(f.start).not.toHaveBeenCalled();
  expect(f.stop).not.toHaveBeenCalled();
});
it('a failed source switch keeps the picker open with the reason; the share is untouched', async () => {
  f.source.mockRejectedValue(new Error('Kaynak değiştirilemedi, önceki paylaşım sürüyor.'));
  render(
    <MemoryRouter initialEntries={['/voice']}>
      <RealVoiceDock openLauncher={() => {}} notify={() => {}} />
    </MemoryRouter>,
  );
  window.dispatchEvent(new Event('rooms:choose-capture'));
  fireEvent.click(await screen.findByRole('button', { name: /NEXT window/ }));
  fireEvent.click(screen.getByRole('button', { name: 'Bu kaynağa geç' }));
  expect(await screen.findByRole('alert')).toBeTruthy();
  expect(screen.getByText(/önceki paylaşım sürüyor/)).toBeTruthy();
  expect(f.stop).not.toHaveBeenCalled();
});
