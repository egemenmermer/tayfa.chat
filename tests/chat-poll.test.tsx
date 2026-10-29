// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { RoomSnapshot } from '@rooms/activity-protocol';
const native = vi.hoisted(() => ({ snapshot: vi.fn(), command: vi.fn() }));
vi.mock('../apps/desktop/src/runtime-sources', async (original) => ({
  ...(await original<typeof import('../apps/desktop/src/runtime-sources')>()),
  activityBridge: () => native,
  developmentActivityState: () => null,
}));
vi.mock('../apps/desktop/src/VoiceAvatar', () => ({ VoiceAvatar: () => null }));
vi.mock('../apps/desktop/src/realtime', () => ({
  useVoiceRejoin: (select: (state: { rejoin: null }) => unknown) => select({ rejoin: null }),
  stopSoundboard: vi.fn(),
  // Sitting in a voice room must not move a text-channel poll into the voice room's state.
  useRealtime: () => ({ channelId: 'voice-room', participants: [], status: 'not-configured' }),
}));
import {
  CHAT_POLL_ID_LENGTH,
  chatPollFallback,
  chatPollId,
  chatPollMessage,
  newChatPollId,
} from '../apps/desktop/src/chat-poll';
import { ChatPollCard } from '../apps/desktop/src/ChatPoll';
import { CommunityChat, quoteReply } from '../apps/desktop/src/RealSocial';
import { isGifMessage } from '../apps/desktop/src/ComposerPickers';
import { useCommunity } from '../apps/desktop/src/community';

const POLL_ID = 'Ab3dEf6hIj9k';
const content = chatPollMessage('Filmden sonra ne oynayalım?', POLL_ID); // i18n-ignore: test data
const poll = (extra: Partial<RoomSnapshot['polls'][number]> = {}) => ({
  id: POLL_ID,
  question: 'Filmden sonra ne oynayalım?', // i18n-ignore: test data
  options: [
    { id: 'okey', label: '101 Okey' },
    { id: 'batak', label: 'Batak' },
  ],
  votes: { bob: 'batak' } as Record<string, string>,
  createdBy: 'bob',
  closed: false,
  ...extra,
});
const room = (roomId: string, polls: RoomSnapshot['polls'] = [], revision = 4) =>
  ({
    roomId,
    revision,
    participants: [],
    primary: null,
    queue: [],
    polls,
    whiteboard: [],
    timeline: {},
  }) as unknown as RoomSnapshot;
const alice = { id: 'alice', username: 'alice', displayName: 'Alice', avatar: null };
const bob = { id: 'bob', username: 'bob', displayName: 'Bob', avatar: null };
const message = (id: string, text: string, channelId = 'ban-show') => ({
  id,
  channelId,
  author: bob,
  content: text,
  timestamp: '2026-10-29T09:00:00Z',
  editedTimestamp: null,
  reactions: {},
});
/** Answers snapshots per room, so a poll that exists elsewhere is never found by accident. */
const rooms = (byRoom: Record<string, RoomSnapshot>) =>
  native.snapshot.mockImplementation(async (roomId: string) => {
    if (!byRoom[roomId]) throw new Error('ROOM_ACCESS_DENIED');
    return { room: byRoom[roomId], serverTimeMs: Date.now() };
  });
let account = 0;
beforeEach(() => {
  // A fresh account scope per test keeps the shared activity cache from leaking between tests.
  account++;
  act(() =>
    useCommunity.setState({
      user: alice,
      serverUrl: `https://server-${account}.test`,
      status: 'connected',
      activeChannelId: 'ban-show',
      channels: [{ id: 'ban-show', spaceId: 'space', name: 'ban_show', type: 0, topic: null }],
      dms: [],
      messages: [],
      typing: {},
      unread: {},
      loadingMessages: false,
      hasOlder: false,
    }),
  );
});
afterEach(() => {
  cleanup();
  native.snapshot.mockReset();
  native.command.mockReset();
});

describe('poll message format', () => {
  it('reads as a plain sentence for older clients and round-trips the poll id', () => {
    expect(content).toBe(
      '📊 Anket: Filmden sonra ne oynayalım? — Tayfa’nın yeni sürümünde oy ver. #Ab3dEf6hIj9k', // i18n-ignore: test data
    );
    expect(content).not.toMatch(/[{}[\]<>@_]|https?:/);
    expect(isGifMessage(content)).toBe(false);
    expect(chatPollId(content)).toBe(POLL_ID);
    expect(chatPollFallback(content)).toBe(
      'Anket: Filmden sonra ne oynayalım? — Tayfa’nın yeni sürümünde oy ver.', // i18n-ignore: test data
    );
    // Line breaks in the question never split the sentence older clients see.
    expect(chatPollMessage('Ne\noynayalım?', POLL_ID)).toContain('Anket: Ne oynayalım? —'); // i18n-ignore: test data
  });

  it('only treats a whole poll message as a card, not quotes, edits or look-alikes', () => {
    expect(chatPollId(quoteReply(message('m', content), 'bence batak'))).toBeNull(); // i18n-ignore: test data
    expect(chatPollId(`${content} ve sonra?`)).toBeNull(); // i18n-ignore: test data
    expect(chatPollId(`selam ${content}`)).toBeNull();
    expect(chatPollId('📊 Anket: soru? #kisa')).toBeNull(); // i18n-ignore: test data
    expect(chatPollId('Anket: soru? #Ab3dEf6hIj9k')).toBeNull(); // i18n-ignore: test data
    expect(chatPollId(`  ${content}\n`)).toBe(POLL_ID);
  });

  it('creates ids that fit both the message token and the activity protocol', () => {
    const ids = Array.from({ length: 50 }, () => newChatPollId());
    for (const id of ids) expect(id).toMatch(new RegExp(`^[A-Za-z0-9]{${CHAT_POLL_ID_LENGTH}}$`));
    expect(new Set(ids).size).toBe(ids.length);
    // Bytes at or above 248 are dropped so every character is equally likely.
    const bytes = [255, 250, 248, ...Array.from({ length: 12 }, (_, i) => i)];
    expect(newChatPollId((target) => target.map((_, i) => bytes.shift() ?? i))).toBe(
      'ABCDEFGHIJKL',
    );
  });
});

describe('poll card', () => {
  const renderCard = (pollId = POLL_ID) =>
    render(<ChatPollCard channelId="ban-show" pollId={pollId} content={content} />);

  it('renders the live poll of the message channel and votes through the activity service', async () => {
    rooms({ 'ban-show': room('ban-show', [poll()]) });
    native.command.mockImplementation(
      async (roomId: string, envelope: { command: { type: string } }) => ({
        room: room(
          roomId,
          [poll({ votes: { bob: 'batak', alice: 'okey' } })],
          envelope.command.type === 'join' ? 5 : 6,
        ),
        serverTimeMs: Date.now(),
      }),
    );
    renderCard();
    const card = await screen.findByRole('region', { name: 'Filmden sonra ne oynayalım?' }); // i18n-ignore: test data
    expect(native.snapshot).toHaveBeenCalledWith('ban-show', undefined);
    expect(within(card).getByText('1 kişi oy verdi')).toBeTruthy(); // i18n-ignore: test data
    fireEvent.click(within(card).getByRole('button', { name: /101 Okey/ }));
    await waitFor(() =>
      expect(native.command).toHaveBeenCalledWith(
        'ban-show',
        expect.objectContaining({
          command: { type: 'poll.vote', pollId: POLL_ID, optionId: 'okey' },
        }),
      ),
    );
    // Every command goes to the message's own channel, never the voice room.
    expect(native.command.mock.calls.every(([roomId]) => roomId === 'ban-show')).toBe(true);
    await waitFor(() =>
      expect(
        within(card)
          .getByRole('button', { name: /101 Okey/ })
          .getAttribute('aria-pressed'),
      ).toBe('true'),
    );
    expect(within(card).getByText('2 kişi oy verdi')).toBeTruthy(); // i18n-ignore: test data
  });

  it('shows a closed poll with its result and no voting', async () => {
    rooms({ 'ban-show': room('ban-show', [poll({ closed: true })]) });
    renderCard();
    await screen.findByText('Sonuç: Batak · 1 oy'); // i18n-ignore: test data
    expect(screen.getByText('Oylama kapalı')).toBeTruthy(); // i18n-ignore: test data
    for (const button of screen.getAllByRole('button') as HTMLButtonElement[])
      expect(button.disabled).toBe(true);
  });

  it('lets the creator close the poll after confirming', async () => {
    rooms({ 'ban-show': room('ban-show', [poll({ createdBy: 'alice' })]) });
    native.command.mockImplementation(async (roomId: string) => ({
      room: room(roomId, [poll({ createdBy: 'alice', closed: true })], 7),
      serverTimeMs: Date.now(),
    }));
    renderCard();
    fireEvent.click(await screen.findByRole('button', { name: 'Anketi kapat' }));
    expect(screen.getByText('Oylamayı kapat?')).toBeTruthy(); // i18n-ignore: test data
    fireEvent.click(screen.getByRole('button', { name: 'Anketi kapat' }));
    await waitFor(() =>
      expect(native.command).toHaveBeenCalledWith(
        'ban-show',
        expect.objectContaining({ command: { type: 'poll.close', pollId: POLL_ID } }),
      ),
    );
    await screen.findByText('Oylama kapalı'); // i18n-ignore: test data
  });

  it('shows a clear state with the readable text for an unknown or foreign poll', async () => {
    // The poll exists, but in another room: a message cannot borrow it.
    rooms({ 'ban-show': room('ban-show', []), 'other-room': room('other-room', [poll()]) });
    renderCard();
    await screen.findByText('Bu anket bulunamadı. Silinmiş ya da başka bir kanala ait olabilir.'); // i18n-ignore: test data
    expect(
      screen.getByText('Anket: Filmden sonra ne oynayalım? — Tayfa’nın yeni sürümünde oy ver.'), // i18n-ignore: test data
    ).toBeTruthy();
    expect(screen.queryByRole('button')).toBeNull();
    expect(native.snapshot.mock.calls.every(([roomId]) => roomId === 'ban-show')).toBe(true);
  });

  it('keeps the readable text and offers a retry when the poll cannot be loaded', async () => {
    native.snapshot.mockRejectedValue(new Error('ACTIVITY_UNAVAILABLE'));
    renderCard();
    const retry = await screen.findByRole('button', { name: 'Yeniden dene' });
    expect(
      screen.getByText('Anket: Filmden sonra ne oynayalım? — Tayfa’nın yeni sürümünde oy ver.'), // i18n-ignore: test data
    ).toBeTruthy();
    rooms({ 'ban-show': room('ban-show', [poll()]) });
    fireEvent.click(retry);
    await screen.findByRole('region', { name: 'Filmden sonra ne oynayalım?' }); // i18n-ignore: test data
  });
});

describe('text channel chat', () => {
  const renderChat = (notify = vi.fn()) =>
    render(
      <MemoryRouter>
        <CommunityChat notify={notify} />
      </MemoryRouter>,
    );

  it('renders poll messages as cards in community channels and as text in DMs', async () => {
    rooms({ 'ban-show': room('ban-show', [poll()]), 'voice-room': room('voice-room') });
    act(() => useCommunity.setState({ messages: [message('m1', content)] }));
    renderChat();
    await screen.findByRole('region', { name: 'Filmden sonra ne oynayalım?' }); // i18n-ignore: test data
    cleanup();
    act(() =>
      useCommunity.setState({
        activeChannelId: 'dm',
        channels: [],
        dms: [{ id: 'dm', spaceId: null, name: 'Bob', type: 1, topic: null, recipients: [bob] }],
        messages: [message('m1', content, 'dm')],
      }),
    );
    renderChat();
    expect(screen.getByText(content)).toBeTruthy();
    expect(screen.queryByRole('region', { name: /oynayalım/ })).toBeNull(); // i18n-ignore: test data
    expect(screen.queryByRole('button', { name: 'Anket' })).toBeNull();
  });

  it('creates the poll in the text channel and then posts the poll message there', async () => {
    rooms({ 'ban-show': room('ban-show'), 'voice-room': room('voice-room') });
    native.command.mockImplementation(
      async (roomId: string, envelope: { command: { type: string } }) => ({
        room: room(roomId, envelope.command.type === 'join' ? [] : [poll()], 9),
        serverTimeMs: Date.now(),
      }),
    );
    const send = vi.fn(async () => {});
    act(() => useCommunity.setState({ send }));
    renderChat();
    fireEvent.click(screen.getByRole('button', { name: 'Anket' }));
    const dialog = await screen.findByRole('dialog');
    expect(
      within(dialog).getByText('#ban_show kanalını görebilen herkes oy verebilir.'),
    ).toBeTruthy(); // i18n-ignore: test data
    fireEvent.change(within(dialog).getByLabelText('Soru'), {
      target: { value: '  Filmden sonra ne oynayalım? ' }, // i18n-ignore: test data
    });
    fireEvent.change(within(dialog).getByLabelText('Seçenek 1'), { target: { value: '101 Okey' } }); // i18n-ignore: test data
    fireEvent.change(within(dialog).getByLabelText('Seçenek 2'), { target: { value: 'Batak' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Anketi gönder' }));
    await waitFor(() => expect(send).toHaveBeenCalledTimes(1));
    const create = native.command.mock.calls.find(
      ([, envelope]) => envelope.command.type === 'poll.create',
    );
    expect(create?.[0]).toBe('ban-show');
    const pollId = create?.[1].command.pollId as string;
    expect(create?.[1].command).toMatchObject({
      question: 'Filmden sonra ne oynayalım?', // i18n-ignore: test data
      options: [{ label: '101 Okey' }, { label: 'Batak' }],
    });
    expect(send).toHaveBeenCalledWith(chatPollMessage('Filmden sonra ne oynayalım?', pollId)); // i18n-ignore: test data
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });

  it('keeps the created poll when posting fails and posts it again without a second poll', async () => {
    rooms({ 'ban-show': room('ban-show'), 'voice-room': room('voice-room') });
    native.command.mockImplementation(async (roomId: string) => ({
      room: room(roomId, [poll()], 9),
      serverTimeMs: Date.now(),
    }));
    const send = vi
      .fn<(text: string) => Promise<void>>()
      .mockRejectedValueOnce(new Error('Kanal erişimi yeniden doğrulanmalı.')) // i18n-ignore: test data
      .mockResolvedValueOnce(undefined);
    act(() => useCommunity.setState({ send }));
    renderChat();
    fireEvent.click(screen.getByRole('button', { name: 'Anket' }));
    const dialog = await screen.findByRole('dialog');
    fireEvent.change(within(dialog).getByLabelText('Soru'), { target: { value: 'Ne?' } });
    fireEvent.change(within(dialog).getByLabelText('Seçenek 1'), { target: { value: 'A' } });
    fireEvent.change(within(dialog).getByLabelText('Seçenek 2'), { target: { value: 'B' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Anketi gönder' }));
    await within(dialog).findByText('Kanal erişimi yeniden doğrulanmalı.'); // i18n-ignore: test data
    fireEvent.click(within(dialog).getByRole('button', { name: 'Mesajı yeniden gönder' }));
    await waitFor(() => expect(send).toHaveBeenCalledTimes(2));
    expect(send.mock.calls[0][0]).toBe(send.mock.calls[1][0]);
    expect(
      native.command.mock.calls.filter(([, envelope]) => envelope.command.type === 'poll.create'),
    ).toHaveLength(1);
  });
});
