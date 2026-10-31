// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import type { DesktopBridge } from '@rooms/contracts';
import type { SocialUser } from '@rooms/social';
import { queryClient } from '../apps/desktop/src/query-client';
import { useCommunity } from '../apps/desktop/src/community';
import {
  DirectMessageList,
  DirectMessageSurface,
  SharedFilesSurface,
  UserProfileDialog,
  dmNotificationsRoute,
  ulidTime,
} from '../apps/desktop/src/SocialSurfaces';
import { FriendsPage } from '../apps/desktop/src/FriendsPage';

const startDmCall = vi.fn(async () => {});
vi.mock('../apps/desktop/src/VoiceAvatar', () => ({ VoiceAvatar: () => null }));
vi.mock('../apps/desktop/src/RealSocial', () => ({ CommunityChat: () => null }));
vi.mock('../apps/desktop/src/realtime', () => ({ useRealtime: () => ({}) }));
vi.mock('../apps/desktop/src/dm-call', () => ({
  useDmCall: () => ({ busy: false, call: null }),
  dmCallUnavailable: () => null,
  dmCallFailure: (error: unknown) => String(error),
  startDmCall: (...args: unknown[]) => startDmCall(...(args as [])),
}));

const self = {
  id: 'self',
  username: 'deniz',
  displayName: 'Deniz',
  avatar: null,
  discriminator: '4821',
};
const ada = { id: 'ada', username: 'ada', displayName: 'Ada', avatar: null, discriminator: '1111' };
const bora = { id: 'bora', username: 'bora', displayName: 'Bora', avatar: null };
// 01JB… ULIDs: the later id sorts first.
const older = '01JB0000000000000000000000',
  newer = '01JC0000000000000000000000';
const dm = (id: string, peer: SocialUser, lastMessageId: string | null) => ({
  id,
  spaceId: null,
  name: '',
  type: 1,
  topic: null,
  recipients: [self, peer],
  lastMessageId,
});
const message = (id: string, channelId: string, author: SocialUser, content: string) => ({
  id,
  channelId,
  author,
  content,
  timestamp: '2026-10-20T18:30:00Z',
  editedTimestamp: null,
});
function Where() {
  const location = useLocation();
  return <output data-testid="where">{location.pathname + location.search}</output>;
}
const inRouter = (node: React.ReactNode, path = '/') =>
  render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="*" element={node} />
      </Routes>
      <Where />
    </MemoryRouter>,
  );

beforeEach(() => {
  queryClient.clear();
  startDmCall.mockClear();
  useCommunity.setState({
    user: self,
    serverUrl: 'https://example.test',
    status: 'connected',
    activeChannelId: null,
    channels: [],
    dms: [],
    spaces: [],
    messages: [],
    presence: {},
    unread: {},
    hasOlder: false,
    loadingMessages: false,
  });
});
afterEach(() => {
  cleanup();
  queryClient.clear();
  delete window.rooms;
});

it('decodes ULID times and ignores ids that are not ULIDs', () => {
  expect(ulidTime('01ARZ3NDEKTSV4RRFFQ69G5FAV')).toBe(1469922850259);
  expect(ulidTime('7ZZZZZZZZZ0000000000000000')).toBe(2 ** 48 - 1);
  expect(ulidTime('1234567890')).toBeUndefined();
  expect(ulidTime(null)).toBeUndefined();
});

it('lists conversations newest first with preview, own prefix, unread mark and time', async () => {
  useCommunity.setState({
    dms: [dm('dm-ada', ada, older), dm('dm-bora', bora, newer)],
    unread: { 'dm-ada': true },
  });
  const cachedMessages = vi.fn(async (id: string) =>
    id === 'dm-ada'
      ? [message(older, 'dm-ada', ada, 'film saat 9da\nikinci satır')]
      : [message(newer, 'dm-bora', self, '')].map((m) => ({
          ...m,
          attachments: [{ id: 'f', name: 'plan.pdf', mime: 'application/pdf', size: 1 }],
        })),
  );
  window.rooms = { social: { cachedMessages } } as unknown as DesktopBridge;
  const onOpen = vi.fn();
  inRouter(<DirectMessageList onOpen={onOpen} />);
  const rows = screen.getAllByRole('button');
  expect(rows.map((row) => within(row).getByText(/Ada|Bora/).textContent)).toEqual(['Bora', 'Ada']);
  await waitFor(() => expect(screen.getByText('film saat 9da')).toBeTruthy());
  expect(screen.getByText('Sen: Dosya: plan.pdf')).toBeTruthy();
  expect(rows[1]!.className).toContain('unread');
  expect(within(rows[1]!).getByRole('img', { name: 'Okunmamış mesaj var' })).toBeTruthy();
  expect(within(rows[0]!).queryByRole('img')).toBeNull();
  expect(rows[0]!.querySelector('time')?.getAttribute('dateTime')).toBe('2026-10-20T18:30:00.000Z');
  fireEvent.click(rows[1]!);
  expect(onOpen).toHaveBeenCalledWith('dm-ada');
});

it('does not show a stale cached preview when a newer message exists', async () => {
  useCommunity.setState({ dms: [dm('dm-ada', ada, newer)], unread: { 'dm-ada': true } });
  window.rooms = {
    social: { cachedMessages: async () => [message(older, 'dm-ada', ada, 'eski mesaj')] },
  } as unknown as DesktopBridge;
  inRouter(<DirectMessageList onOpen={vi.fn()} />);
  await waitFor(() => expect(screen.getByText('Yeni mesaj')).toBeTruthy());
  expect(screen.queryByText('eski mesaj')).toBeNull();
  // The time still comes from the newer ULID.
  expect(screen.getByRole('button').querySelector('time')).toBeTruthy();
});

it('shows an empty state that leads to friends when there are no conversations', () => {
  inRouter(<DirectMessageList onOpen={vi.fn()} />);
  expect(screen.getByRole('heading', { name: 'Henüz özel konuşma yok' })).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'Arkadaşlarını aç' }));
  expect(screen.getByTestId('where').textContent).toBe('/friends');
});

it('DM header has no dead pin and its bell opens this conversation’s notification setting', () => {
  useCommunity.setState({ dms: [dm('dm-ada', ada, older)], activeChannelId: 'dm-ada' });
  window.rooms = { social: { friends: async () => [] } } as unknown as DesktopBridge;
  inRouter(<DirectMessageSurface notify={vi.fn()} />, '/dm');
  expect(screen.queryByRole('button', { name: /Sabitlen/ })).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Bu konuşmanın bildirimleri' }));
  expect(screen.getByTestId('where').textContent).toBe(dmNotificationsRoute('dm-ada'));
  expect(dmNotificationsRoute('a b')).toBe('/settings?tab=desktop&channel=a%20b');
});

it('DM surface without an open conversation shows the conversation list', () => {
  useCommunity.setState({
    dms: [dm('dm-ada', ada, null), { ...dm('saved', ada, null), recipients: [self] }],
  });
  inRouter(<DirectMessageSurface notify={vi.fn()} />, '/dm');
  expect(screen.getByRole('navigation', { name: 'Özel mesajlar' })).toBeTruthy();
  expect(screen.getByText('Henüz mesaj yok')).toBeTruthy();
  // Saved notes have no peer and would only reopen this list.
  expect(screen.getAllByRole('button')).toHaveLength(1);
});

it('profile has no dead details toggle, shows the own bio and a styled close button', async () => {
  const ownProfile = vi.fn(async () => ({
    bio: 'Cuma film gecesi',
    statusText: 'Mola',
    presence: 'online' as const,
  }));
  window.rooms = { social: { ownProfile, friends: async () => [] } } as unknown as DesktopBridge;
  const own = inRouter(<UserProfileDialog onClose={vi.fn()} />);
  await waitFor(() => expect(screen.getByText('Cuma film gecesi')).toBeTruthy());
  expect(screen.getByText('Mola')).toBeTruthy();
  expect(screen.queryByText('Ayrıntıları göster')).toBeNull();
  own.unmount();
  inRouter(<UserProfileDialog user={ada} onClose={vi.fn()} />);
  expect(screen.queryByText('Ayrıntıları göster')).toBeNull();
  expect(screen.queryByText('HAKKINDA')).toBeNull();
  expect(screen.getByRole('button', { name: 'Kapat' }).className).toContain('button secondary');
});

it('files upload shows one progress state and no dead cancel buttons', async () => {
  useCommunity.setState({
    channels: [{ id: 'genel', spaceId: 's', name: 'genel', type: 0, topic: null }],
    activeChannelId: 'genel',
  });
  window.rooms = {
    social: { chooseAttachment: () => new Promise(() => {}) },
  } as unknown as DesktopBridge;
  inRouter(<SharedFilesSurface notify={vi.fn()} />, '/files');
  expect(screen.queryByRole('button', { name: 'İptal' })).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Dosya yükle' }));
  await waitFor(() => expect(screen.getByText('Dosya yükleniyor…')).toBeTruthy());
  expect(screen.getByRole('progressbar', { name: 'Dosya yüklemesi' })).toBeTruthy();
  expect(screen.queryByRole('button', { name: 'İptal' })).toBeNull();
  const tabs = screen.getAllByRole('tab');
  expect(screen.getByRole('tabpanel').getAttribute('aria-labelledby')).toBe(tabs[0]!.id);
});

it('friends page shows the own tag to copy and keyboard-operable tabs', async () => {
  const writeText = vi.fn(async () => {});
  Object.assign(navigator, { clipboard: { writeText } });
  window.rooms = { social: { friends: async () => [] } } as unknown as DesktopBridge;
  const notify = vi.fn();
  inRouter(<FriendsPage notify={notify} />, '/friends');
  fireEvent.click(screen.getByRole('button', { name: 'Kullanıcı etiketini kopyala: deniz#4821' }));
  expect(writeText).toHaveBeenCalledWith('deniz#4821');
  await waitFor(() => expect(notify).toHaveBeenCalledWith('Kullanıcı adı kopyalandı.'));
  const tabs = screen.getAllByRole('tab');
  expect(tabs.map((tab) => tab.tabIndex)).toEqual([0, -1, -1, -1]);
  fireEvent.keyDown(tabs[0]!, { key: 'ArrowRight' });
  await waitFor(() => expect(screen.getByTestId('where').textContent).toBe('/friends?tab=all'));
  expect(screen.getAllByRole('tab')[1]!.getAttribute('aria-selected')).toBe('true');
  fireEvent.keyDown(screen.getAllByRole('tab')[1]!, { key: 'End' });
  await waitFor(() => expect(screen.getByTestId('where').textContent).toBe('/friends?tab=blocked'));
  const panel = screen.getByRole('tabpanel');
  expect(panel.getAttribute('aria-labelledby')).toBe(screen.getAllByRole('tab')[3]!.id);
});

it('friend voice call is hidden without DM calls and rings the friend’s own DM', async () => {
  const friend = { user: ada, relationship: 'friend', status: 'online' };
  const createDM = vi.fn(async () => {
    useCommunity.setState({
      dms: [
        { ...dm('group', ada, null), recipients: [self, ada, bora] },
        dm('dm-bora', bora, null),
        dm('dm-ada', ada, null),
      ],
      activeChannelId: 'dm-bora',
    });
  });
  useCommunity.setState({ createDM });
  window.rooms = { social: { friends: async () => [friend] } } as unknown as DesktopBridge;
  const first = inRouter(<FriendsPage notify={vi.fn()} />, '/friends?tab=all');
  await waitFor(() => expect(screen.getByText('Ada')).toBeTruthy());
  expect(screen.queryByRole('button', { name: 'Ada ile sesli ara' })).toBeNull();
  first.unmount();
  queryClient.clear();
  window.rooms = {
    social: { friends: async () => [friend] },
    dmCalls: {},
  } as unknown as DesktopBridge;
  inRouter(<FriendsPage notify={vi.fn()} />, '/friends?tab=all');
  fireEvent.click(await screen.findByRole('button', { name: 'Ada ile sesli ara' }));
  await waitFor(() => expect(startDmCall).toHaveBeenCalledWith('dm-ada', 'audio'));
  await waitFor(() => expect(screen.getByTestId('where').textContent).toBe('/dm-call'));
});

it('a friend’s profile sends a quick message in your DM with them and opens it', async () => {
  let opens = dm('dm-ada', ada, null);
  const social = {
    friends: async () => [{ user: ada, relationship: 'friend', status: 'online' }],
    createDM: vi.fn(async () => opens),
    send: vi.fn(async () => ({})),
  };
  const createDM = vi.fn(async () => {});
  useCommunity.setState({ createDM, activeChannelId: 'general' });
  window.rooms = { social } as unknown as DesktopBridge;
  // Not a friend: no message box.
  const stranger = inRouter(<UserProfileDialog user={bora} onClose={vi.fn()} />);
  await waitFor(() => expect(screen.getByRole('button', { name: 'Kapat' })).toBeTruthy());
  await new Promise((resolve) => setTimeout(resolve, 20));
  expect(screen.queryByRole('textbox')).toBeNull();
  stranger.unmount();
  const onClose = vi.fn();
  inRouter(<UserProfileDialog user={ada} onClose={onClose} />);
  const box = await screen.findByRole('textbox', { name: 'Ada için mesaj yaz' });
  expect(screen.getByRole('button', { name: 'Mesajı gönder' })).toHaveProperty('disabled', true);
  // A DM that came back for someone else never receives the message.
  opens = dm('dm-bora', bora, null);
  fireEvent.change(box, { target: { value: '  selam  ' } });
  fireEvent.click(screen.getByRole('button', { name: 'Mesajı gönder' }));
  expect(await screen.findByText('Özel mesaj açılamadı. Yeniden dene.')).toBeTruthy();
  expect(social.send).not.toHaveBeenCalled();
  opens = dm('dm-ada', ada, null);
  fireEvent.submit(box.closest('form')!);
  await waitFor(() => expect(onClose).toHaveBeenCalled());
  expect(social.createDM).toHaveBeenLastCalledWith(ada.id);
  expect(social.send).toHaveBeenCalledWith('dm-ada', 'selam');
  // The open channel never changed before the message was delivered; then the DM opens.
  expect(createDM).toHaveBeenCalledWith(ada.id);
  expect(screen.getByTestId('where').textContent).toBe('/chat');
});
