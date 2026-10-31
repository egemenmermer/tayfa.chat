// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import {
  cleanup,
  configure,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type { ActivityCommand } from '../packages/activity-protocol/src';
import type { CinemaBridge } from '../packages/community-cinema/src/bridge';

vi.mock('../apps/desktop/src/realtime', () => ({
  useVoiceRejoin: (select: (state: { rejoin: null }) => unknown) => select({ rejoin: null }),
  useRealtime: () => ({ participants: [], tracks: [], status: 'idle', channelId: null }),
}));
vi.mock('@rooms/media', () => ({ liveKitMediaProvider: {} }));
vi.mock('../apps/desktop/src/RealSocial', () => ({
  CommunityChat: () => <div>Salon sohbeti</div>,
}));

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

// Several mounts and fixture round trips per test; keep them stable on a busy machine.
configure({ asyncUtilTimeout: 4000 });

class Observer {
  observe() {}
  unobserve() {}
  disconnect() {}
}
let cleanups: (() => void)[] = [];
let sent: ActivityCommand[] = [];
let bridge: CinemaBridge;
let notify: Mock<(message: string) => void>;

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
  sent = [];
});
afterEach(() => {
  cleanup();
  cleanups.forEach((clean) => clean());
  cleanups = [];
  resetGuideCache();
  vi.unstubAllGlobals();
});

/** Mounts the hall; `again` keeps the same fixture service, like reopening the app. */
function mount(variant: CommunityCinemaFixtureVariant, again = false) {
  const owner = variant !== 'member' && variant !== 'remote';
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
    sent.push(envelope.command);
    return command(roomId, envelope);
  };
  if (!again) bridge = createCommunityCinemaFixtureBridge(variant);
  cleanups.push(
    installDevelopmentRuntime({
      mediaProvider: {} as never,
      mediaBridge: {} as never,
      activityBridge: activity,
    }),
    installCinemaFixture({ bridge, art: fixtureArt }),
  );
  notify = vi.fn();
  return render(
    <MemoryRouter>
      <CinemaHall notify={notify} />
    </MemoryRouter>,
  );
}

const hallTabs = async () => screen.findByRole('tablist', { name: 'Sinema' });

describe('Stremio in the cinema hall', { timeout: 30_000 }, () => {
  it('asks the owner to link Stremio first and tells members who can', async () => {
    mount('member');
    fireEvent.click(within(await hallTabs()).getByRole('tab', { name: 'Stremio' }));
    expect(await screen.findByRole('heading', { name: 'Stremio bağlı değil' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: /Bağlantıyı kur/ })).toBeNull();
  });

  it('lists an episode’s streams and plays the pick without an IPTV account', async () => {
    mount('stremio');
    const watch = vi.spyOn(bridge, 'watch');
    fireEvent.click(within(await hallTabs()).getByRole('tab', { name: 'Stremio' }));
    const continuing = await screen.findByRole('region', { name: 'İzlemeye devam et' });
    fireEvent.click(await within(continuing).findByRole('button', { name: /DEMO Stremio Dizisi/ }));
    // The episode Stremio was on opens with its streams.
    const streams = await screen.findByRole('region', { name: 'Kaynaklar' });
    expect(await within(streams).findByText('Hazır')).toBeTruthy();
    expect(within(streams).getByText('İndirilecek')).toBeTruthy();
    // Torrentio refuses the server here; this computer (the linker's) listed it.
    expect(within(streams).getByText(/MediaFusion/)).toBeTruthy();
    const pick = vi.spyOn(bridge, 'stremioPickLocal');
    fireEvent.click(
      within(streams).getAllByRole('button', { name: /salonda oynat|sıraya öner/ })[0]!,
    );
    await waitFor(() => expect(pick).toHaveBeenCalledWith(FIXTURE_HALL_ID, 'local-demo-stream-4k'));
    await waitFor(() =>
      expect(
        sent.some(
          (command) =>
            command.type === 'queue.add' &&
            command.media.kind === 'community-media' &&
            command.media.ref.startsWith('x-'),
        ),
      ).toBe(true),
    );
    // The stage asks the service for the pick; no IPTV account is needed.
    await waitFor(() => expect(watch).toHaveBeenCalledWith(FIXTURE_HALL_ID));
    await waitFor(() => expect(watch).toHaveResolved());
    expect(screen.queryByText(/IPTV hesabı yok/)).toBeNull();
    expect(screen.queryByText('Sahip henüz bir kaynak bağlamadı')).toBeNull();
  });

  it('shows the hero, genres and catalog rows, and browses a row and a genre', async () => {
    mount('stremio');
    const catalog = vi.spyOn(bridge, 'stremioCatalog');
    fireEvent.click(within(await hallTabs()).getByRole('tab', { name: 'Stremio' }));
    const hero = await screen.findByRole('region', { name: 'Öne çıkanlar' });
    expect(within(hero).getByRole('heading', { name: 'DEMO Film 1' })).toBeTruthy();
    fireEvent.click(within(hero).getByRole('button', { name: 'Sonraki' }));
    expect(await within(hero).findByRole('heading', { name: 'DEMO Film 2' })).toBeTruthy();
    // Rows: Cinemeta's catalogs named by the desktop, an add-on's with its own name.
    for (const name of [
      'Popüler filmler',
      'Popüler diziler',
      'Bu yılın filmleri',
      'Öne çıkan filmler',
    ])
      expect(screen.getByRole('region', { name })).toBeTruthy();
    expect(screen.getByRole('region', { name: 'Popüler anime · DEMO Anime' })).toBeTruthy();
    expect(screen.getAllByLabelText('IMDb puanı 6.7').length).toBeGreaterThan(0);
    // "Tümünü gör" opens the whole catalog as a grid.
    const popular = screen.getByRole('region', { name: 'Popüler filmler' });
    fireEvent.click(within(popular).getByRole('button', { name: /Tümünü gör/ }));
    expect(await screen.findByRole('heading', { name: /Popüler filmler/ })).toBeTruthy();
    await waitFor(() =>
      expect(catalog).toHaveBeenCalledWith(FIXTURE_HALL_ID, 'cinemeta:movie:top', null, 0),
    );
    // A genre chip narrows it; Cinemeta's genre value is sent, the chip reads Turkish.
    fireEvent.click(await screen.findByRole('radio', { name: 'Korku' }));
    await waitFor(() =>
      expect(catalog).toHaveBeenCalledWith(FIXTURE_HALL_ID, 'cinemeta:movie:top', 'Horror', 0),
    );
    expect(await screen.findByRole('heading', { name: /Korku · Filmler/ })).toBeTruthy();
    // A title opened from the grid comes back to it.
    fireEvent.click(await screen.findByRole('button', { name: /DEMO Horror Film 3 \d{4}/ }));
    fireEvent.click(await screen.findByRole('button', { name: 'Korku' }));
    expect(await screen.findByRole('heading', { name: /Korku · Filmler/ })).toBeTruthy();
    // The genre switch on the home browses series too.
    fireEvent.click(screen.getByRole('button', { name: 'Stremio' }));
    fireEvent.click(await screen.findByRole('radio', { name: 'Diziler' }));
    fireEvent.click(
      within(screen.getByRole('region', { name: 'Türler' })).getByRole('button', { name: 'Dram' }),
    );
    await waitFor(() =>
      expect(catalog).toHaveBeenCalledWith(FIXTURE_HALL_ID, 'cinemeta:series:top', 'Drama', 0),
    );
  });

  it('falls back to the popular rows on a service without catalog rows', async () => {
    mount('stremio');
    const home = bridge.stremioHome.bind(bridge);
    vi.spyOn(bridge, 'stremioHome').mockImplementation(async (hallId) => {
      const { rows: _rows, featured: _featured, ...older } = await home(hallId);
      return older;
    });
    fireEvent.click(within(await hallTabs()).getByRole('tab', { name: 'Stremio' }));
    const popular = await screen.findByRole('region', { name: 'Popüler filmler' });
    expect(within(popular).queryByRole('button', { name: /Tümünü gör/ })).toBeNull();
    expect(screen.queryByRole('region', { name: 'Öne çıkanlar' })).toBeNull();
    expect(screen.queryByRole('region', { name: 'Türler' })).toBeNull();
  });
});
