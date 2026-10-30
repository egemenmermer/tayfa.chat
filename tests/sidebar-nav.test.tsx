// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, useLocation } from 'react-router-dom';
const f = vi.hoisted(() => ({
  directory: {
    rooms: [] as {
      channelId: string;
      participants: { id: string; name: string; muted: boolean }[];
    }[],
    loading: false,
    error: false,
  },
  snapshot: {
    status: 'idle',
    channelId: null as string | null,
    roomName: null,
    muted: false,
    camera: false,
    sharing: false,
    deafened: false,
    participants: [],
    tracks: [],
    busy: false,
    error: null,
  },
}));
vi.mock('../apps/desktop/src/realtime', () => ({
  useRealtime: () => f.snapshot,
  joinVoice: vi.fn(),
  leaveVoice: vi.fn(),
  toggleMic: vi.fn(),
  toggleDeafen: vi.fn(),
  toggleCamera: vi.fn(),
  startRoomAudio: vi.fn(),
  stopScreen: vi.fn(),
}));
vi.mock('../apps/desktop/src/voice-directory', () => ({ useVoiceDirectory: () => f.directory }));
vi.mock('../apps/desktop/src/Soundboard', () => ({ SoundboardButton: () => null }));
vi.mock('../apps/desktop/src/activity', () => ({ useActivityRoom: () => ({ room: null }) }));
import { MinimalSidebar } from '../apps/desktop/src/MinimalSidebar';
import { useCommunity } from '../apps/desktop/src/community';

const friends = vi.fn();
const communityManagement = vi.fn();
const person = (id: string, relationship: string) => ({
  id,
  username: id,
  displayName: id,
  avatar: null,
  relationship,
});
afterEach(cleanup);
beforeEach(() => {
  friends.mockReset();
  friends.mockResolvedValue([
    person('a', 'incoming'),
    person('b', 'incoming'),
    person('c', 'friend'),
    person('d', 'outgoing'),
  ]);
  communityManagement.mockReset();
  communityManagement.mockResolvedValue({ capabilities: { manageChannels: false } });
  f.directory = { rooms: [], loading: false, error: false };
  (window as { rooms?: unknown }).rooms = {
    social: { friends, communityManagement, avatar: vi.fn(async () => null) },
    media: {},
  };
  useCommunity.setState({
    status: 'connected',
    busy: false,
    error: null,
    loadingMessages: false,
    user: { id: 'me', username: 'me', displayName: 'Ben', avatar: null },
    serverUrl: 'https://local.example',
    activeSpaceId: 'server',
    activeChannelId: null,
    channels: [
      { id: 'general', spaceId: 'server', name: 'genel', type: 0, topic: null },
      { id: 'hall', spaceId: 'server', name: 'Salon', type: 2, topic: null },
    ],
    dms: [],
    unread: {},
    readStates: {},
    spaces: [
      { id: 'server', name: 'Server', ownerId: 'me', icon: null },
      { id: 'other', name: 'Other', ownerId: 'someone', icon: null },
    ],
  });
});
function Where() {
  return <output data-testid="path">{useLocation().pathname}</output>;
}
async function mount(path = '/chat') {
  render(
    <MemoryRouter initialEntries={[path]}>
      <MinimalSidebar
        notify={() => {}}
        invite={() => {}}
        createSpace={() => {}}
        search={() => {}}
        help={() => {}}
      />
      <Where />
    </MemoryRouter>,
  );
  await act(async () => {});
}
const nav = () => within(screen.getByRole('group', { name: 'Kişisel' }));

it('reaches Home, Friends, Notifications and Messages in one click and marks the current page', async () => {
  await mount('/home');
  const rows = nav().getAllByRole('button');
  expect(rows.map((row) => row.textContent)).toEqual([
    'Ana sayfa',
    expect.stringContaining('Arkadaşlar'),
    'Bildirimler',
    'Mesajlar',
  ]);
  expect(nav().getByRole('button', { name: 'Ana sayfa' }).getAttribute('aria-current')).toBe(
    'page',
  );
  for (const [name, path] of [
    ['Arkadaşlar', '/friends'],
    ['Bildirimler', '/notifications'],
    ['Mesajlar', '/messages'],
    ['Ana sayfa', '/home'],
  ] as const) {
    fireEvent.click(nav().getByRole('button', { name: new RegExp(`^${name}`) }));
    expect(screen.getByTestId('path').textContent).toBe(path);
  }
  await act(async () => {});
  expect(
    nav()
      .getByRole('button', { name: /^Arkadaşlar/ })
      .getAttribute('aria-current'),
  ).toBeNull();
});

it('shows a badge for incoming friend requests and refreshes it when friends change', async () => {
  await mount();
  const row = nav().getByRole('button', { name: /^Arkadaşlar/ });
  await waitFor(() => expect(row.querySelector('.sidebar-nav-badge')?.textContent).toBe('2'));
  expect(row.textContent).toContain('2 yeni arkadaşlık isteği');
  friends.mockResolvedValue([person('a', 'friend')]);
  await act(async () => {
    window.dispatchEvent(new Event('rooms:friends-changed'));
  });
  await waitFor(() => expect(row.querySelector('.sidebar-nav-badge')).toBeNull());
});

it('does not ask for friends without a connected account', async () => {
  useCommunity.setState({ status: 'connecting' });
  await mount();
  expect(friends).not.toHaveBeenCalled();
  expect(document.querySelector('.sidebar-nav-badge')).toBeNull();
});

it('counts unread mentions in this community and in DMs, like the notifications page', async () => {
  useCommunity.setState({
    dms: [{ id: 'dm', spaceId: null, name: 'Ece', type: 1, topic: null }],
    unread: { dm: true },
    readStates: {
      general: { lastReadMessageId: null, mentionMessageIds: ['m1', 'm2'] },
      dm: { lastReadMessageId: null, mentionMessageIds: ['m3'] },
      // A channel of another community is not listed on the page, so it is not counted.
      elsewhere: { lastReadMessageId: null, mentionMessageIds: ['m4'] },
    },
  } as never);
  await mount();
  const row = nav().getByRole('button', { name: /^Bildirimler/ });
  expect(row.querySelector('.sidebar-nav-badge')?.textContent).toBe('3');
  expect(row.textContent).toContain('3 okunmamış bildirim');
  expect(
    nav()
      .getByRole('button', { name: /^Mesajlar/ })
      .querySelector('.nav-dot'),
  ).not.toBeNull();
});

it('marks the active community with an icon and aria-current instead of appended text', async () => {
  await mount();
  const active = screen.getByRole('button', { name: 'Server' });
  expect(active.getAttribute('aria-current')).toBe('true');
  expect(active.textContent).toBe('Server');
  expect(active.querySelector('svg')).not.toBeNull();
  expect(screen.getByRole('button', { name: 'Other' }).getAttribute('aria-current')).toBeNull();
});

it('offers channel creation only to members who can manage channels', async () => {
  await mount();
  const chats = screen.getByRole('group', { name: 'Sohbetler' });
  expect(chats.getAttribute('tabindex')).toBe('0');
  expect(within(chats).getByRole('button', { name: 'Sohbet kanalı oluştur' }).title).toBe(
    'Sohbet kanalı oluştur',
  );
  expect(chats.textContent).toContain('Seçenekler için Shift+F10');
  cleanup();
  useCommunity.setState({
    spaces: [{ id: 'server', name: 'Server', ownerId: 'someone', icon: null }],
  });
  await mount();
  await waitFor(() => expect(communityManagement).toHaveBeenCalledWith('server'));
  const member = screen.getByRole('group', { name: 'Sohbetler' });
  expect(member.getAttribute('tabindex')).toBeNull();
  expect(within(member).queryByRole('button')).toBeNull();
  expect(screen.queryByRole('button', { name: 'Ses odası oluştur' })).toBeNull();
  // The section's context menu would only offer creation, so it does not open.
  fireEvent.contextMenu(member);
  expect(screen.queryByRole('menu')).toBeNull();
});

it('shows the create button to a member with the manageChannels capability', async () => {
  communityManagement.mockResolvedValue({ capabilities: { manageChannels: true } });
  useCommunity.setState({
    spaces: [{ id: 'server', name: 'Server', ownerId: 'someone', icon: null }],
  });
  await mount();
  await waitFor(() =>
    expect(screen.getByRole('button', { name: 'Ses odası oluştur' })).toBeTruthy(),
  );
});

it('reports a failed voice directory once, under the rooms header', async () => {
  useCommunity.setState({
    channels: [
      { id: 'a', spaceId: 'server', name: 'Bir', type: 2, topic: null },
      { id: 'b', spaceId: 'server', name: 'İki', type: 2, topic: null },
      { id: 'c', spaceId: 'server', name: 'Üç', type: 2, topic: null },
    ],
  });
  f.directory = { rooms: [], loading: false, error: true };
  await mount();
  expect(screen.getAllByText('Üyeler alınamadı. Yeniden deneniyor…')).toHaveLength(1);
  expect(screen.queryByText('Üyeler alınamadı')).toBeNull();
});

it('shows nothing extra for rooms the directory lists, even when empty', async () => {
  f.directory = { rooms: [{ channelId: 'hall', participants: [] }], loading: false, error: false };
  await mount();
  expect(document.querySelector('.occupancy-unavailable')).toBeNull();
});

it('explains an empty, loading or failed channel list', async () => {
  useCommunity.setState({ channels: [], loadingMessages: true });
  await mount();
  expect(screen.getByText('Kanallar yükleniyor…').getAttribute('role')).toBe('status');
  cleanup();
  useCommunity.setState({ loadingMessages: false });
  await mount();
  expect(screen.getByText('Henüz kanal yok')).toBeTruthy();
  expect(screen.getByRole('button', { name: 'Kanal oluştur' })).toBeTruthy();
  cleanup();
  useCommunity.setState({ error: 'x' });
  await mount();
  const failed = screen.getByText('Kanallar alınamadı.').closest<HTMLElement>('[role="alert"]')!;
  expect(failed).not.toBeNull();
  expect(within(failed).getByRole('button', { name: 'Yeniden dene' })).toBeTruthy();
  cleanup();
  useCommunity.setState({
    error: null,
    spaces: [{ id: 'server', name: 'Server', ownerId: 'someone', icon: null }],
  });
  await mount();
  expect(screen.getByText('Henüz kanal yok')).toBeTruthy();
  expect(screen.queryByRole('button', { name: 'Kanal oluştur' })).toBeNull();
});

it('keeps one set of voice controls with tooltips during a call', async () => {
  f.snapshot = {
    ...f.snapshot,
    status: 'connected',
    channelId: 'hall',
    roomName: 'Salon',
  } as never;
  try {
    await mount('/voice');
    for (const name of ['Kamerayı aç', 'Ekran paylaş', 'Etkinlikler', 'Soundboard', 'Ses ayarları'])
      expect(screen.getByRole('button', { name }).title).toBe(name);
    expect(screen.getByRole('button', { name: 'Sağırlaştır' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Sesten ayrıl' })).toBeTruthy();
    // The old "Ses işlemleri" menu repeated the icon row.
    expect(screen.queryByLabelText('Ses işlemleri')).toBeNull();
    expect(screen.getAllByRole('button', { name: 'Kamerayı aç' })).toHaveLength(1);
  } finally {
    f.snapshot = { ...f.snapshot, status: 'idle', channelId: null, roomName: null } as never;
  }
});

it('gives long names a tooltip so a truncated name stays readable', async () => {
  const long = 'Çok uzun bir sohbet kanalı adı ki dar pencerede sığmaz';
  useCommunity.setState({
    channels: [{ id: 'long', spaceId: 'server', name: long, type: 0, topic: null }],
  });
  await mount();
  expect(screen.getByText(long).getAttribute('title')).toBe(long);
});

it('offers joining with a pasted invite link from the community menu', async () => {
  const joinInvite = vi.fn();
  render(
    <MemoryRouter initialEntries={['/chat']}>
      <MinimalSidebar
        notify={() => {}}
        invite={() => {}}
        joinInvite={joinInvite}
        createSpace={() => {}}
        search={() => {}}
        help={() => {}}
      />
    </MemoryRouter>,
  );
  await act(async () => {});
  fireEvent.click(screen.getByRole('button', { name: 'Davet bağlantısıyla katıl' }));
  const token = 'd'.repeat(64);
  fireEvent.change(screen.getByLabelText('Davet bağlantısı'), {
    target: { value: `https://local.example/davet/${token}` },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Daveti aç' }));
  expect(joinInvite).toHaveBeenCalledWith({ serverUrl: 'https://local.example', code: token });
  expect(screen.queryByLabelText('Davet bağlantısı')).toBeNull();
});

it('hides the join entry when the app gives it nowhere to go', async () => {
  await mount();
  expect(screen.queryByRole('button', { name: 'Davet bağlantısıyla katıl' })).toBeNull();
});
