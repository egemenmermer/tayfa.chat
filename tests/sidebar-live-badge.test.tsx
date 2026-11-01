// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, useLocation } from 'react-router-dom';
const f = vi.hoisted(() => ({
  volume: vi.fn(),
  join: vi.fn(async () => {}),
  directory: {
    rooms: [] as {
      channelId: string;
      participants: { id: string; name: string; muted: boolean; screen?: boolean }[];
    }[],
    loading: false,
    error: null,
  },
  snapshot: {} as any,
  base: {
    status: 'connected',
    channelId: 'hall',
    roomName: 'Salon',
    muted: false,
    camera: false,
    sharing: false,
    deafened: false,
    participants: [
      { id: 'me', name: 'Ben', muted: false, volume: 1 },
      { id: 'ece', name: 'Ece', muted: false, volume: 1 },
    ],
    tracks: [],
    busy: false,
    error: null,
  },
}));
vi.mock('../apps/desktop/src/realtime', () => ({
  useRealtime: () => f.snapshot,
  joinVoice: f.join,
  leaveVoice: vi.fn(),
  toggleMic: vi.fn(),
  toggleDeafen: vi.fn(),
  toggleCamera: vi.fn(),
  startRoomAudio: vi.fn(),
  stopScreen: vi.fn(),
  setParticipantVolume: f.volume,
}));
vi.mock('../apps/desktop/src/voice-directory', () => ({
  useVoiceDirectory: () => f.directory,
}));
vi.mock('../apps/desktop/src/Soundboard', () => ({ SoundboardButton: () => null }));
vi.mock('../apps/desktop/src/activity', () => ({ useActivityRoom: () => ({ room: null }) }));
import { MinimalSidebar } from '../apps/desktop/src/MinimalSidebar';
import { useCommunity } from '../apps/desktop/src/community';
import { queryClient } from '../apps/desktop/src/query-client';

const bridge = {
  moderate: vi.fn(async () => {}),
  capabilities: vi.fn(async () => ({
    manageServer: false,
    manageChannels: false,
    manageRoles: false,
    managePermissions: false,
    assignRoles: false,
    kickMembers: true,
    moveMembers: true,
    banMembers: false,
  })),
};
afterEach(() => {
  cleanup();
  queryClient.clear();
  f.volume.mockClear();
  f.directory.rooms = [];
});
beforeEach(() => {
  f.snapshot = structuredClone(f.base);
  f.join.mockClear();
  bridge.moderate.mockClear();
  (window as { rooms?: unknown }).rooms = {
    social: {
      communityCapabilities: bridge.capabilities,
      removeCommunityMember: vi.fn(),
      avatar: vi.fn(async () => null),
    },
    media: { moderate: bridge.moderate },
  };
  useCommunity.setState({
    user: { id: 'me', username: 'me', displayName: 'Ben', avatar: null },
    serverUrl: 'https://local.example',
    activeSpaceId: 'server',
    activeChannelId: null,
    channels: [
      { id: 'hall', spaceId: 'server', name: 'Salon', type: 2, topic: null },
      { id: 'lounge', spaceId: 'server', name: 'Bahçe', type: 2, topic: null },
    ],
    spaces: [{ id: 'server', name: 'Server', ownerId: 'me', icon: null }],
  });
});
const notify = vi.fn();
let where = '';
function Where() {
  const location = useLocation();
  where = location.pathname + location.search;
  return null;
}
const tree = (path = '/voice') => (
  <MemoryRouter initialEntries={[path]}>
    <Where />
    <MinimalSidebar
      notify={notify}
      invite={() => {}}
      createSpace={() => {}}
      editSpace={() => {}}
      search={() => {}}
      help={() => {}}
    />
  </MemoryRouter>
);
async function mount(path?: string) {
  const view = render(tree(path));
  await waitFor(() => expect(bridge.capabilities).toHaveBeenCalledWith('server'));
  await act(async () => {});
  return view;
}
const occupant = (id: string) =>
  document.querySelector(`[data-voice-participant-id="${id}"]`) as HTMLElement;

const badge = (id: string) => occupant(id).querySelector('[data-live-badge]') as HTMLElement;

it('opens the stream from the live badge in your room; the name still opens the profile', async () => {
  f.snapshot.participants[1].screen = true;
  f.snapshot.tracks = [
    {
      id: 'TR_cam',
      participantId: 'ece',
      source: 'camera',
      kind: 'video',
      local: false,
      muted: false,
    },
    {
      id: 'TR_ece',
      participantId: 'ece',
      source: 'screen_share',
      kind: 'video',
      local: false,
      muted: false,
    },
  ];
  await mount();
  expect(badge('me')).toBeNull();
  expect(badge('ece').textContent).toBe('CANLI');
  fireEvent.click(badge('ece'));
  expect(where).toBe('/voice?view=share&screen=TR_ece');
  expect(screen.queryByRole('dialog')).toBeNull();
  fireEvent.click(within(occupant('ece')).getByText('Ece'));
  expect(await screen.findByRole('dialog')).toBeTruthy();
});

it('joins another room from its live badge and opens the stream once it is listed', async () => {
  f.snapshot = { ...f.snapshot, status: 'disconnected', channelId: null, participants: [] };
  f.directory.rooms = [
    { channelId: 'lounge', participants: [{ id: 'ece', name: 'Ece', muted: false, screen: true }] },
  ];
  const view = await mount();
  fireEvent.click(badge('ece'));
  expect(f.join).toHaveBeenCalledWith('lounge', 'Bahçe');
  expect(where).toBe('/voice');
  f.snapshot = {
    ...f.snapshot,
    status: 'connected',
    channelId: 'lounge',
    participants: [
      { id: 'me', name: 'Ben', muted: false, volume: 1 },
      { id: 'ece', name: 'Ece', muted: false, volume: 1, screen: true },
    ],
    tracks: [
      {
        id: 'TR_ece',
        participantId: 'ece',
        source: 'screen_share',
        kind: 'video',
        local: false,
        muted: false,
      },
    ],
  };
  view.rerender(tree());
  await waitFor(() => expect(where).toBe('/voice?view=share&screen=TR_ece'));
});
it('joins a voice room without leaving the open text channel; a second click opens it (H09)', async () => {
  f.snapshot = { ...f.snapshot, status: 'disconnected', channelId: null, participants: [] };
  const view = await mount('/chat');
  const room = () => document.querySelector('[data-channel-id="lounge"]') as HTMLElement;
  fireEvent.click(room());
  expect(f.join).toHaveBeenCalledWith('lounge', 'Bahçe');
  expect(where).toBe('/chat');
  f.snapshot = { ...f.snapshot, status: 'connected', channelId: 'lounge' };
  view.rerender(tree('/chat'));
  fireEvent.click(room());
  expect(f.join).toHaveBeenCalledTimes(1);
  expect(where).toBe('/voice');
});
