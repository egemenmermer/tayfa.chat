// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter, useLocation } from 'react-router-dom';
const f = vi.hoisted(() => ({
  voice: {
    status: 'connected',
    channelId: 'room',
    roomName: 'DARK WEB',
    muted: false,
    camera: false,
    sharing: false,
    deafened: false,
    participants: [] as Record<string, unknown>[],
    tracks: [],
    busy: false,
    error: null,
  },
  activity: {
    status: 'connected',
    room: null as Record<string, unknown> | null,
    busy: false,
    error: null,
    serverOffsetMs: 0,
    send: vi.fn(),
    refresh: vi.fn(),
    clearError: vi.fn(),
  },
  cinema: { available: false, status: null, hallId: null } as Record<string, unknown>,
}));
vi.mock('../apps/desktop/src/realtime', () => ({
  useRealtime: () => f.voice,
  joinVoice: vi.fn(),
  leaveVoice: vi.fn(),
  toggleMic: vi.fn(),
  toggleDeafen: vi.fn(),
  toggleCamera: vi.fn(),
  startRoomAudio: vi.fn(),
  stopScreen: vi.fn(),
}));
vi.mock('../apps/desktop/src/activity', () => ({ useActivityRoom: () => f.activity }));
vi.mock('../apps/desktop/src/MusicDJ', () => ({
  openMusicDJ: vi.fn(),
  openRoomActivity: (path: string, navigate: (path: string) => void) => navigate(path),
}));
vi.mock('../apps/desktop/src/voice-directory', () => ({ useVoiceDirectory: () => ({}) }));
vi.mock('../apps/desktop/src/Soundboard', () => ({ SoundboardButton: () => null }));
vi.mock('../apps/desktop/src/cinema/cinema-status', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../apps/desktop/src/cinema/cinema-status')>()),
  useCommunityCinema: () => f.cinema,
}));
import { ActivityLauncher } from '../apps/desktop/src/Activities';
import { activityRoute } from '../apps/desktop/src/activity-route';
import { MinimalSidebar } from '../apps/desktop/src/MinimalSidebar';
import { PushToTalkNotice } from '../apps/desktop/src/PushToTalk';
import { useCommunity } from '../apps/desktop/src/community';
import { useRooms } from '../apps/desktop/src/store';

const person = (id: string, name: string, extra: Record<string, unknown> = {}) => ({
  id,
  name,
  local: id === 'me',
  muted: false,
  deafened: false,
  speaking: false,
  camera: false,
  screen: false,
  volume: 1,
  quality: 'excellent',
  ...extra,
});
const running = (participants: string[], activity = 'screen', title = 'Ekran paylaşımı') => ({
  roomId: 'room',
  revision: 3,
  participants: participants.map((userId) => ({
    userId,
    displayName: userId,
    canControl: true,
    canCreate: true,
    joinedAt: 1,
    lastSeenAt: 1,
  })),
  primary: {
    activity,
    title,
    hostUserId: 'egemen',
    startedAt: 1,
    state: 'live',
  },
  timeline: {
    playing: true,
    positionSec: 0,
    rate: 1,
    effectiveServerTimeMs: 1,
    epoch: 1,
    itemId: null,
  },
  queue: [],
  polls: [],
  whiteboard: [],
});
function Route() {
  const location = useLocation();
  return <output data-testid="route">{location.pathname + location.search}</output>;
}
afterEach(cleanup);
beforeEach(() => {
  vi.clearAllMocks();
  f.voice.participants = [];
  f.activity.room = null;
  f.cinema = { available: false, status: null, hallId: null };
  useCommunity.setState({
    user: { id: 'me', username: 'me', displayName: 'Me', avatar: null },
    serverUrl: 'https://local.example',
    activeSpaceId: 'server',
    activeChannelId: 'room',
    channels: [{ id: 'room', name: 'DARK WEB', type: 2 } as any],
    spaces: [{ id: 'server', name: 'Server', ownerId: 'me', icon: null }],
  });
});
const launcher = () =>
  render(
    <MemoryRouter initialEntries={['/voice']}>
      <ActivityLauncher onClose={() => {}} />
      <Route />
    </MemoryRouter>,
  );
const sidebar = () =>
  render(
    <MemoryRouter initialEntries={['/voice']}>
      <MinimalSidebar
        notify={() => {}}
        invite={() => {}}
        createSpace={() => {}}
        editSpace={() => {}}
        search={() => {}}
        help={() => {}}
      />
      <Route />
    </MemoryRouter>,
  );

it('lets a newcomer join a running activity in one click without end-for-everyone text', () => {
  f.activity.room = running(['egemen']);
  launcher();
  expect(screen.queryByText(/herkes adına bitir/)).toBeNull();
  expect(screen.queryByRole('button', { name: /Bitir ve etkinlik seç/ })).toBeNull();
  expect(screen.queryByRole('button', { name: 'Etkinliği bitir' })).toBeNull();
  expect(screen.queryByRole('button', { name: 'Oyunlar' })).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Katıl' }));
  expect(screen.getByTestId('route').textContent).toBe('/voice?view=share');
});

it('keeps ending the shared player for the host only', () => {
  useCommunity.setState({
    user: { id: 'egemen', username: 'egemen', displayName: 'egemen', avatar: null },
  });
  f.activity.room = running(['egemen']);
  launcher();
  expect(screen.getByRole('button', { name: 'Aç' })).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'Etkinliği bitir' }));
  expect(f.activity.send).toHaveBeenCalledWith({ type: 'end' });
});

it('offers the DJ as something the room can start, but not the assistant page', () => {
  f.activity.room = { ...running([]), primary: null };
  launcher();
  expect(screen.getAllByRole('button', { name: /Texas Hold’em/ }).length).toBeGreaterThan(0);
  expect(screen.getByRole('button', { name: /DJ Recep/ })).toBeTruthy();
  expect(screen.queryByRole('button', { name: /Asistan/ })).toBeNull();
});

it('explains an old-cinema session from an older client instead of opening a removed page', () => {
  f.activity.room = running(['egemen'], 'youtube', 'Birlikte izle');
  launcher();
  expect(screen.getByText('Eski Sinema · bu sürümde açılmıyor')).toBeTruthy();
  expect(screen.getByText(/Oturumun hostu bitirince/)).toBeTruthy();
  expect(screen.queryByRole('button', { name: 'Katıl' })).toBeNull();
  expect(screen.queryByRole('button', { name: 'Etkinliği bitir' })).toBeNull();
  expect(screen.getByRole('button', { name: 'Kapat' })).toBeTruthy();
  cleanup();

  // The host can still end it, which frees the room for a new activity.
  useCommunity.setState({
    user: { id: 'egemen', username: 'egemen', displayName: 'egemen', avatar: null },
  });
  f.activity.room = running(['egemen'], 'cinema', 'Film gecesi');
  launcher();
  expect(screen.getByText(/Bitirirsen odada yeni bir etkinlik/)).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'Etkinliği bitir' }));
  expect(f.activity.send).toHaveBeenCalledWith({ type: 'end' });
  expect(screen.getByTestId('route').textContent).toBe('/voice');
});

it('opens the launcher, not a removed page, from an old-cinema session in the sidebar', () => {
  f.voice.participants = [person('me', 'Me'), person('egemen', 'egemen')];
  f.activity.room = running(['egemen'], 'youtube', 'Birlikte izle');
  const opened = vi.fn();
  window.addEventListener('rooms:open-activity-launcher', opened);
  sidebar();
  fireEvent.click(
    screen.getByRole('button', { name: /Birlikte izle sürüyor, 1 kişi\. Eski Sinema/ }),
  );
  window.removeEventListener('rooms:open-activity-launcher', opened);
  expect(opened).toHaveBeenCalledOnce();
  expect(screen.getByTestId('route').textContent).toBe('/voice');
  expect(activityRoute('youtube')).toBeNull();
  expect(activityRoute('cinema')).toBeNull();
});

it('starts the Sinema hall from the launcher when the community has one', () => {
  f.activity.room = { ...running([]), primary: null };
  const closed = vi.fn();
  const mountLauncher = () =>
    render(
      <MemoryRouter initialEntries={['/voice']}>
        <ActivityLauncher onClose={closed} />
        <Route />
      </MemoryRouter>,
    );
  // No cinema bridge or hall: nothing to start, and the highlights still fill the grid.
  mountLauncher();
  expect(screen.queryByRole('button', { name: /Sinema/ })).toBeNull();
  expect(screen.queryByText(/YouTube videolarını birlikte izle/)).toBeNull();
  expect(screen.getByRole('button', { name: /Ekran paylaş/ })).toBeTruthy();
  expect(
    [...document.querySelectorAll('.appdir-featured .appdir-card strong')].map(
      (n) => n.textContent,
    ),
  ).toEqual(['Texas Hold’em', '101 Okey', 'Beyaz tahta', 'Anket']);
  cleanup();

  f.cinema = { available: true, status: { isOwner: false }, hallId: 'hall' };
  mountLauncher();
  expect(
    [...document.querySelectorAll('.appdir-featured .appdir-card strong')].map(
      (n) => n.textContent,
    ),
  ).toEqual(['Sinema salonu', 'Texas Hold’em', '101 Okey', 'Beyaz tahta']);
  const watch = screen.getByRole('heading', { name: 'Birlikte izle' }).closest('section')!;
  fireEvent.click(within(watch as HTMLElement).getByRole('button', { name: /Sinema salonu/ }));
  expect(screen.getByTestId('route').textContent).toBe('/cinema');
  expect(closed).toHaveBeenCalledOnce();
  cleanup();

  // Searching finds it first, so Enter opens the hall.
  closed.mockClear();
  mountLauncher();
  const search = screen.getByRole('textbox', { name: 'Uygulama ve etkinlik ara' });
  fireEvent.change(search, { target: { value: 'sinema' } });
  fireEvent.keyDown(search, { key: 'Enter' });
  expect(screen.getByTestId('route').textContent).toBe('/cinema');
  cleanup();

  sidebar();
  fireEvent.click(screen.getByRole('button', { name: 'Sinema salonu' }));
  expect(screen.getByTestId('route').textContent).toBe('/cinema');
  // A hall already playing in the room is still joined at the hall.
  expect(activityRoute('hall')).toBe('/cinema');
});

it('shows the running activity under the joined room and opens it from the sidebar', () => {
  f.voice.participants = [person('me', 'Me'), person('egemen', 'egemen')];
  f.activity.room = running(['egemen']);
  sidebar();
  fireEvent.click(screen.getByRole('button', { name: /Ekran paylaşımı sürüyor, 1 kişi\. Katıl/ }));
  expect(screen.getByTestId('route').textContent).toBe('/voice?view=share');
});

it('marks a person this listener silenced and drops their speaking ring', () => {
  f.voice.participants = [
    person('me', 'Me'),
    person('rooms-music-dj', 'DJ Recep', { speaking: true, volume: 0 }),
    person('sems', 'sems', { speaking: true }),
  ];
  sidebar();
  const dj = document.querySelector('[data-voice-participant-id="rooms-music-dj"]')!;
  const sems = document.querySelector('[data-voice-participant-id="sems"]')!;
  expect(dj.className).not.toContain('speaking');
  expect(dj.querySelector('[aria-label="Sesini kapattın, yalnızca sende"]')).not.toBeNull();
  expect(sems.className).toContain('speaking');
  expect(sems.querySelector('[aria-label="Sesini kapattın, yalnızca sende"]')).toBeNull();
});

it('shows both the muted and the deafened icon for a deafened person', () => {
  f.voice.participants = [
    person('me', 'Me'),
    person('ece', 'Ece', { deafened: true, muted: true }),
    person('can', 'Can', { muted: true }),
  ];
  sidebar();
  const ece = document.querySelector('[data-voice-participant-id="ece"]')!;
  const can = document.querySelector('[data-voice-participant-id="can"]')!;
  expect(ece.querySelector('[aria-label="Mikrofon kapalı"]')).not.toBeNull();
  expect(ece.querySelector('[aria-label="Sağırlaştırdı"]')).not.toBeNull();
  expect(can.querySelector('[aria-label="Mikrofon kapalı"]')).not.toBeNull();
  expect(can.querySelector('[aria-label="Sağırlaştırdı"]')).toBeNull();
});

it('names the chosen push-to-talk key in the room hint', () => {
  const previous = useRooms.getState().preferences;
  useRooms.setState({ preferences: { ...previous, pushToTalkKey: 'Alt+KeyV' } });
  render(<PushToTalkNotice />);
  expect(screen.getByText(/Bas konuş açık/).textContent).not.toContain('Space');
  expect(screen.getByText(/Bas konuş açık/).textContent).toMatch(/V$/);
  useRooms.setState({ preferences: previous });
});
