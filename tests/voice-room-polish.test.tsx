// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
const f = vi.hoisted(() => ({
  snapshot: {
    status: 'connected',
    channelId: 'room' as string | null,
    roomName: 'Test room' as string | null,
    muted: false,
    camera: false,
    sharing: false,
    deafened: false,
    participants: [],
    tracks: [],
    busy: false,
    error: null,
  },
  join: vi.fn(),
  deafen: vi.fn(),
  leave: vi.fn(),
}));
vi.mock('../apps/desktop/src/realtime', () => ({
  useVoiceRejoin: (select: (state: { rejoin: null }) => unknown) => select({ rejoin: null }),
  useRealtime: () => f.snapshot,
  joinVoice: f.join,
  leaveVoice: f.leave,
  toggleMic: vi.fn(),
  toggleDeafen: f.deafen,
  toggleCamera: vi.fn(),
  startScreen: vi.fn(),
  stopScreen: vi.fn(),
  watchScreen: vi.fn(),
  setScreenVolume: vi.fn(),
  setScreenQuality: vi.fn(),
  setParticipantVolume: vi.fn(),
  startRoomAudio: vi.fn(),
  attachMediaTrack: vi.fn(),
  playSoundboard: vi.fn(),
  stopSoundboard: vi.fn(),
}));
vi.mock('../apps/desktop/src/screen-handoff', () => ({
  ScreenHandoffControls: () => null,
  cancelScreenHandoff: vi.fn(),
  decideScreenHandoff: vi.fn(),
  useScreenHandoff: (selector: any) => selector({ value: null, error: null }),
}));
import { CommunityVoice, RealVoiceDock } from '../apps/desktop/src/RealSocial';
import { useCommunity } from '../apps/desktop/src/community';
const room = (id: string, name: string) => ({ id, spaceId: 'space', name, type: 2, topic: null });
afterEach(cleanup);
beforeEach(() => {
  vi.clearAllMocks();
  f.join.mockResolvedValue(undefined);
  f.deafen.mockResolvedValue(undefined);
  f.leave.mockResolvedValue(undefined);
  Object.assign(f.snapshot, { status: 'connected', channelId: 'room', roomName: 'Test room' });
  useCommunity.setState({
    user: { id: 'me', username: 'me', displayName: 'Me', avatar: null },
    channels: [room('lounge', 'Salon'), room('games', 'Oyun odası')],
    activeChannelId: null,
  });
});
const mount = (ui: React.ReactNode) =>
  render(<MemoryRouter initialEntries={['/voice']}>{ui}</MemoryRouter>);

it('names dock actions with the sidebar terms and offers deafen once', () => {
  mount(<RealVoiceDock openLauncher={() => {}} notify={() => {}} />);
  fireEvent.click(screen.getByRole('button', { name: 'Sağırlaştır' }));
  expect(f.deafen).toHaveBeenCalledTimes(1);
  expect(screen.getAllByRole('button', { name: /Sağırlaştır/ })).toHaveLength(1);
  expect(screen.queryByRole('button', { name: /Oda sesini/ })).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Sesten ayrıl' }));
  expect(f.leave).toHaveBeenCalledTimes(1);
  // The activity launcher's accessible name matches what it shows.
  expect(screen.getByRole('button', { name: 'Etkinlikler' }).textContent).toBe('Etkinlikler');
  // One device-settings entry instead of single-item microphone and camera menus.
  expect(screen.queryByRole('button', { name: 'Mikrofon ayarları' })).toBeNull();
  expect(screen.queryByRole('button', { name: 'Kamera ayarları' })).toBeNull();
  expect(screen.getByRole('button', { name: 'Cihaz ayarları' })).toBeTruthy();
});

it('shows the ready stage for the selected room and joins that room', () => {
  Object.assign(f.snapshot, { channelId: null, roomName: null });
  useCommunity.setState({ activeChannelId: 'games' });
  mount(<CommunityVoice openLauncher={() => {}} notify={() => {}} />);
  expect(screen.getByRole('heading', { name: 'Oda sana hazır' })).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'Katıl' }));
  expect(f.join).toHaveBeenCalledWith('games', 'Oyun odası');
});

it('lists the rooms on the same stage when none is selected, and says when there are none', () => {
  Object.assign(f.snapshot, { channelId: null, roomName: null });
  const { unmount } = mount(<CommunityVoice openLauncher={() => {}} notify={() => {}} />);
  expect(screen.getByRole('heading', { name: 'Bir ses odası seç' })).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: /Salon/ }));
  expect(f.join).toHaveBeenCalledWith('lounge', 'Salon');
  unmount();
  useCommunity.setState({ channels: [] });
  mount(<CommunityVoice openLauncher={() => {}} notify={() => {}} />);
  expect(screen.getByRole('heading', { name: 'Henüz ses odası yok' })).toBeTruthy();
});
