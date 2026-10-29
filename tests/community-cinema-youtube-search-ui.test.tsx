// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type { ActivityCommand } from '../packages/activity-protocol/src';

vi.mock('../apps/desktop/src/realtime', () => ({
  useVoiceRejoin: (select: (state: { rejoin: null }) => unknown) => select({ rejoin: null }),
  useRealtime: () => ({ participants: [], tracks: [], status: 'idle', channelId: null }),
}));
vi.mock('@rooms/media', () => ({ liveKitMediaProvider: {} }));
vi.mock('../apps/desktop/src/RealSocial', () => ({
  CommunityChat: () => <div>Salon sohbeti</div>,
}));

import type { CinemaBridge } from '../packages/community-cinema/src/bridge';
import CinemaHall from '../apps/desktop/src/cinema/CinemaHall';
import { installCinemaFixture } from '../apps/desktop/src/cinema/cinema-bridge';
import { resetGuideCache } from '../apps/desktop/src/cinema/guide-cache';
import { useCommunity } from '../apps/desktop/src/community';
import { installDevelopmentRuntime } from '../apps/desktop/src/runtime-sources';
import {
  communityCinemaFixtureRoom,
  createCommunityCinemaFixtureActivity,
  createCommunityCinemaFixtureBridge,
  fixtureArt,
  FIXTURE_COMMUNITY_ID,
  FIXTURE_HALL_ID,
  type CommunityCinemaFixtureVariant,
} from '../apps/desktop/src/dev/community-cinema-fixture';

class Observer {
  observe() {}
  unobserve() {}
  disconnect() {}
}
let cleanups: (() => void)[] = [];
let commands: ActivityCommand['type'][] = [];
let sent: ActivityCommand[] = [];

beforeEach(() => {
  vi.stubGlobal('ResizeObserver', Observer);
  vi.stubGlobal('IntersectionObserver', Observer);
  vi.stubGlobal(
    'matchMedia',
    (query: string) =>
      ({
        matches: false,
        media: query,
        addEventListener() {},
        removeEventListener() {},
      }) as unknown as MediaQueryList,
  );
  localStorage.clear();
  commands = [];
  sent = [];
});
afterEach(() => {
  cleanup();
  cleanups.forEach((clean) => clean());
  cleanups = [];
  resetGuideCache();
  vi.unstubAllGlobals();
});

function mount(
  variant: CommunityCinemaFixtureVariant,
  youtubeSearch?: CinemaBridge['youtubeSearch'],
  owner = variant !== 'member' && variant !== 'remote',
) {
  const bridge = createCommunityCinemaFixtureBridge(variant);
  if (youtubeSearch) bridge.youtubeSearch = youtubeSearch;
  useCommunity.setState({
    user: { id: 'demo-deniz', username: 'deniz', displayName: 'Deniz', avatar: null },
    serverUrl: `https://cinema-${variant}-${Math.random()}`,
    activeSpaceId: FIXTURE_COMMUNITY_ID,
    activeChannelId: FIXTURE_HALL_ID,
    spaces: [
      {
        id: FIXTURE_COMMUNITY_ID,
        name: 'Bizim Oda',
        ownerId: owner ? 'demo-deniz' : 'demo-ece',
        icon: null,
      },
    ],
    channels: [
      {
        id: FIXTURE_HALL_ID,
        spaceId: FIXTURE_COMMUNITY_ID,
        name: 'film-gecesi',
        type: 0,
        topic: null,
      },
    ],
    openChannel: vi.fn(async () => {}),
  });
  const activity = createCommunityCinemaFixtureActivity(communityCinemaFixtureRoom(variant));
  const command = activity.command;
  activity.command = async (roomId, envelope) => {
    commands.push(envelope.command.type);
    sent.push(envelope.command);
    return command(roomId, envelope);
  };
  cleanups.push(
    installDevelopmentRuntime({
      mediaProvider: {} as never,
      mediaBridge: {} as never,
      activityBridge: activity,
    }),
    installCinemaFixture({ bridge, art: fixtureArt }),
  );
  return render(
    <MemoryRouter>
      <CinemaHall notify={vi.fn()} />
    </MemoryRouter>,
  );
}

const RESULTS = [
  { videoId: 'dQw4w9WgXcQ', title: 'Birinci sonuç', durationSec: 213 },
  { videoId: 'jNQXAC9IVRw', title: 'İkinci sonuç', durationSec: 3725 },
  { videoId: 'abcdefghijk', title: 'Üçüncü sonuç', durationSec: 0 },
];

async function openTab() {
  fireEvent.click(await screen.findByRole('tab', { name: 'YouTube' }));
  return screen.findByRole('combobox', { name: 'YouTube bağlantısı ya da arama' });
}

describe('YouTube search in the hall', () => {
  it('searches text, lists title and duration, and picks with the keyboard like a pasted link', async () => {
    const search = vi.fn(async () => RESULTS);
    mount('default', search);
    const input = await openTab();
    fireEvent.change(input, { target: { value: 'komik video' } });
    fireEvent.click(screen.getByRole('button', { name: 'Ara' }));
    const list = await screen.findByRole('listbox', { name: 'Arama sonuçları' });
    expect(search).toHaveBeenCalledWith(FIXTURE_HALL_ID, 'komik video');
    const options = within(list).getAllByRole('option');
    expect(options.map((o) => o.textContent)).toEqual([
      expect.stringContaining('Birinci sonuç'),
      expect.stringContaining('İkinci sonuç'),
      expect.stringContaining('Üçüncü sonuç'),
    ]);
    expect(options[0]!.textContent).toContain('3:33');
    expect(options[1]!.textContent).toContain('1:02:05');
    expect(options[2]!.textContent).not.toMatch(/\d:\d\d/);
    expect(options[0]!.getAttribute('aria-selected')).toBe('true');
    fireEvent.keyDown(input, { key: 'ArrowDown' });
    fireEvent.keyDown(input, { key: 'ArrowDown' });
    expect(options[2]!.getAttribute('aria-selected')).toBe('true');
    fireEvent.keyDown(input, { key: 'ArrowDown' });
    expect(options[0]!.getAttribute('aria-selected')).toBe('true');
    fireEvent.keyDown(input, { key: 'ArrowUp' });
    fireEvent.keyDown(input, { key: 'Enter' });
    await waitFor(() =>
      expect(sent.find((c) => c.type === 'queue.add')).toMatchObject({
        media: { kind: 'youtube', videoId: 'abcdefghijk', title: 'Üçüncü sonuç' },
        start: true,
      }),
    );
    await waitFor(() => expect((input as HTMLInputElement).value).toBe(''));
    expect(screen.queryByRole('listbox')).toBeNull();
  });

  it('a pasted link still opens directly and never searches', async () => {
    const search = vi.fn(async () => RESULTS);
    mount('default', search);
    const input = await openTab();
    fireEvent.change(input, { target: { value: 'https://youtu.be/dQw4w9WgXcQ' } });
    fireEvent.click(screen.getByRole('button', { name: /Salonda aç/ }));
    await waitFor(() =>
      expect(sent.find((c) => c.type === 'queue.add')).toMatchObject({
        media: { kind: 'youtube', videoId: 'dQw4w9WgXcQ' },
        start: true,
      }),
    );
    expect(search).not.toHaveBeenCalled();
  });

  it('a picked result goes through the same remote rules: a member only suggests it', async () => {
    mount('member', async () => RESULTS);
    const input = await openTab();
    fireEvent.change(input, { target: { value: 'komik' } });
    fireEvent.submit(input.closest('form')!);
    fireEvent.click(await screen.findByRole('option', { name: /Birinci sonuç/ }));
    await waitFor(() => expect(sent.some((c) => c.type === 'queue.add')).toBe(true));
    expect(sent.find((c) => c.type === 'queue.add')).toMatchObject({
      media: { kind: 'youtube', videoId: 'dQw4w9WgXcQ' },
    });
  });

  it('shows loading, empty and error states and hides stale results when the text changes', async () => {
    let finish: (value: typeof RESULTS) => void = () => {};
    const search = vi
      .fn<CinemaBridge['youtubeSearch']>()
      .mockImplementationOnce(() => new Promise((resolve) => (finish = resolve)))
      .mockResolvedValueOnce([])
      .mockRejectedValueOnce(new Error('CINEMA_RATE_LIMITED'))
      .mockRejectedValueOnce(new Error('CINEMA_YOUTUBE_SEARCH_UNAVAILABLE'));
    mount('default', search);
    const input = await openTab();
    fireEvent.change(input, { target: { value: 'ab' } });
    fireEvent.submit(input.closest('form')!);
    expect(await screen.findByText('YouTube’da aranıyor…')).toBeTruthy();
    await act(async () => finish(RESULTS));
    expect(await screen.findByRole('listbox')).toBeTruthy();
    fireEvent.change(input, { target: { value: 'abc' } });
    expect(screen.queryByRole('listbox')).toBeNull();
    fireEvent.submit(input.closest('form')!);
    expect(await screen.findByText('“abc” için sonuç bulunamadı.')).toBeTruthy();
    fireEvent.change(input, { target: { value: 'abcd' } });
    fireEvent.submit(input.closest('form')!);
    expect((await screen.findByRole('alert')).textContent).toContain('Çok hızlı istek');
    fireEvent.change(input, { target: { value: 'abcde' } });
    fireEvent.submit(input.closest('form')!);
    await waitFor(() =>
      expect(screen.getByRole('alert').textContent).toContain(
        'YouTube araması şu an kullanılamıyor',
      ),
    );
    expect(sent.some((c) => c.type === 'queue.add')).toBe(false);
  });

  it('asks for at least two characters', async () => {
    const search = vi.fn(async () => RESULTS);
    mount('default', search);
    const input = await openTab();
    fireEvent.change(input, { target: { value: 'a' } });
    fireEvent.submit(input.closest('form')!);
    expect((await screen.findByRole('alert')).textContent).toContain('en az 2 harf');
    expect(search).not.toHaveBeenCalled();
  });
});
