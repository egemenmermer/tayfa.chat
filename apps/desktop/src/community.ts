import { queryClient } from './query-client';
import { ConversationCache, reconcileMessages } from './conversation-cache';
import { useChannelAccess, setChannelAccess } from './channel-access';
import { t, uiError } from './i18n';
import { create } from 'zustand';
import type { ConnectionStatus, SocialSession } from '@rooms/contracts';
import type {
  SocialChannel,
  SocialInvite,
  SocialInviteLinkSummary,
  SocialMessage,
  SocialSpace,
  SocialUser,
  SocialAttachment,
  SocialReadState,
  SocialSignupRequests,
  GatewayEvent,
} from '@rooms/social';

export interface CommunityMessage extends SocialMessage {
  delivery?: 'pending' | 'failed' | 'sent';
}
export interface CommunityState {
  status: ConnectionStatus;
  user: SocialUser | null;
  serverUrl: string;
  remembered: boolean;
  spaces: SocialSpace[];
  channels: SocialChannel[];
  dms: SocialChannel[];
  activeSpaceId: string | null;
  activeChannelId: string | null;
  typing: Record<string, Record<string, { user: SocialUser; expiresAt: number }>>;
  messages: CommunityMessage[];
  unread: Record<string, boolean>;
  readStates: Record<string, SocialReadState>;
  presence: Record<string, string>;
  error: string | null;
  busy: boolean;
  loadingMessages: boolean;
  hasOlder: boolean;
  connect(input: { serverUrl: string; email: string; password: string }): Promise<void>;
  register(input: {
    serverUrl: string;
    email: string;
    password: string;
    username: string;
    inviteCode: string;
    accountInviteCode?: string;
  }): Promise<void>;
  signupRequests(spaceId: string): Promise<SocialSignupRequests>;
  decideSignupRequest(
    spaceId: string,
    requestId: string,
    decision: 'approve' | 'reject',
  ): Promise<void>;
  logout(): Promise<void>;
  refresh(): Promise<void>;
  openSpace(id: string): Promise<void>;
  openChannel(id: string, force?: boolean): Promise<void>;
  send(content: string, attachments?: SocialAttachment[]): Promise<void>;
  reactMessage(id: string, emoji: string): Promise<void>;
  retryMessage(id: string): Promise<void>;
  /** Drops a message that failed to send; it never reached the server. */
  discardMessage(id: string): void;
  editMessage(id: string, content: string): Promise<void>;
  deleteMessage(id: string): Promise<void>;
  loadOlder(): Promise<void>;
  createInvite(channelId: string): Promise<SocialInvite>;
  listInvites(spaceId: string): Promise<SocialInviteLinkSummary[]>;
  revokeInvite(spaceId: string, inviteId: string): Promise<void>;
  acceptInvite(code: string): Promise<void>;
  createDM(recipientId: string): Promise<void>;
  markRead(channelId: string, messageId: string): Promise<void>;
  setPresence(status: 'online' | 'idle' | 'dnd' | 'invisible'): Promise<void>;
  clearError(): void;
}
const blank = {
  status: 'not-configured' as ConnectionStatus,
  user: null,
  serverUrl: '',
  remembered: false,
  spaces: [],
  channels: [],
  dms: [],
  activeSpaceId: null,
  activeChannelId: null,
  messages: [],
  typing: {},
  unread: {},
  readStates: {},
  presence: {},
  error: null,
  busy: false,
  loadingMessages: false,
  hasOlder: true,
};
const bridge = () => {
  if (!window.rooms?.social)
    throw new Error(t('Özel sunucuna bağlanmak için masaüstü uygulamasını aç.'));
  return window.rooms.social;
};
const safeError = uiError;
let selectionEpoch = 0;
let sessionEpoch = 0;
let nativeSessionEpoch: number | null = null;
let initialization: Promise<void> | null = null;
const conversations = new ConversationCache();
const channelRequests = new Map<string, Promise<SocialMessage[]>>();
const receivedMessages = new Set<string>();
function clearConversations() {
  receivedMessages.clear();
  queryClient.clear();
  conversations.clear();
  channelRequests.clear();
}
const captureSession = () => {
  const state = useCommunity.getState(),
    epoch = sessionEpoch;
  return {
    valid: () =>
      epoch === sessionEpoch &&
      useCommunity.getState().user?.id === state.user?.id &&
      useCommunity.getState().serverUrl === state.serverUrl,
  };
};
async function applySession(session: SocialSession, request = sessionEpoch) {
  if (request !== sessionEpoch) return;
  nativeSessionEpoch = session.sessionEpoch ?? null;
  clearConversations();
  if (!session.user) {
    useCommunity.setState({
      ...blank,
      status: session.status,
      // A saved session is kept while its server is unreachable; the main process retries.
      remembered: session.remembered,
      serverUrl: session.instanceUrl ?? '',
      error:
        session.restore === 'expired'
          ? t('Oturumunun süresi doldu. Çıkış yapıp yeniden giriş yap.')
          : session.restore === 'unreachable'
            ? SERVER_UNREACHABLE_MESSAGE
            : null,
    });
    return;
  }
  const { leaveVoice } = await import('./realtime');
  await leaveVoice().catch(() => {});
  if (request !== sessionEpoch) return;
  selectionEpoch++;
  useChannelAccess.setState({ checks: {} });
  useCommunity.setState({
    ...blank,
    status: session.status,
    user: session.user,
    serverUrl: session.instanceUrl ?? '',
    remembered: session.remembered,
    error: null,
  });
  await useCommunity.getState().refresh();
}
/** Messages one channel view keeps; past this, "Önceki mesajlar" stops instead of looping. */
export const MESSAGE_WINDOW = 5000;
/** A saved session waits for its server; nothing needs to be typed again. */
export const SERVER_UNREACHABLE_MESSAGE = t(
  'Kayıtlı sunucuna şu an ulaşılamıyor. Oturumun duruyor; bağlantı gelince kendiliğinden açılacak.',
);
/** Sign-in style session start shared by invitation sign-up and approved sign-up. */
export async function startSession(open: () => Promise<SocialSession>) {
  const request = ++sessionEpoch;
  nativeSessionEpoch = null;
  clearConversations();
  selectionEpoch++;
  useChannelAccess.setState({ checks: {} });
  useCommunity.setState({ ...blank, status: 'connecting', busy: true });
  try {
    const session = await open();
    if (request === sessionEpoch) await applySession(session, request);
  } catch (error) {
    if (request === sessionEpoch) {
      try {
        await applySession(await bridge().session(), request);
      } catch {}
      useCommunity.setState((state) => ({
        status: state.user ? state.status : 'error',
        error: safeError(error),
      }));
    }
    throw error;
  } finally {
    if (request === sessionEpoch) useCommunity.setState({ busy: false });
  }
}
export const useCommunity = create<CommunityState>((set, get) => ({
  ...blank,
  connect: async (input) => {
    const request = ++sessionEpoch;
    nativeSessionEpoch = null;
    clearConversations();
    selectionEpoch++;
    useChannelAccess.setState({ checks: {} });
    set({ ...blank, status: 'connecting', busy: true });
    try {
      const session = await bridge().login(input);
      if (request === sessionEpoch) await applySession(session, request);
    } catch (error) {
      if (request === sessionEpoch) {
        try {
          await applySession(await bridge().session(), request);
        } catch {}
        set((state) => ({ status: state.user ? state.status : 'error', error: safeError(error) }));
      }
      throw error;
    } finally {
      if (request === sessionEpoch) set({ busy: false });
    }
  },
  register: (input) => startSession(() => bridge().register(input)),
  signupRequests: async (spaceId) => {
    const session = captureSession();
    const value = await bridge().signupRequests(spaceId);
    if (!session.valid()) throw new Error(t('Oturum değişti. Kayıt istekleri gösterilmedi.'));
    return value;
  },
  decideSignupRequest: async (spaceId, requestId, decision) => {
    const session = captureSession();
    await bridge().decideSignupRequest(spaceId, requestId, decision);
    if (!session.valid()) throw new Error(t('Oturum değişti. Karar doğrulanamadı.'));
  },
  logout: async () => {
    const request = ++sessionEpoch;
    nativeSessionEpoch = null;
    clearConversations();
    selectionEpoch++;
    useChannelAccess.setState({ checks: {} });
    set({ ...blank, status: 'connecting', busy: true });
    try {
      // Leaving voice is best effort: a failed media teardown must never keep the account
      // signed in (the main process clears the saved session and vault below).
      try {
        const { leaveVoice } = await import('./realtime');
        await leaveVoice();
      } catch {}
      await bridge().logout();
      if (request === sessionEpoch) set({ ...blank });
    } catch (error) {
      if (request === sessionEpoch) set({ ...blank, status: 'error', error: safeError(error) });
      throw error;
    }
  },
  refresh: async () => {
    if (!get().user) return;
    const identity = get().user?.id,
      serverUrl = get().serverUrl,
      epoch = sessionEpoch;
    const sameSession = () =>
      sessionEpoch === epoch && get().user?.id === identity && get().serverUrl === serverUrl;
    try {
      const [spaces, dms, records] = await Promise.all([
        bridge().spaces(),
        bridge().dms(),
        bridge()
          .readStates()
          .catch(() => []),
      ]);
      if (!sameSession()) return;
      set({ spaces, dms, readStates: Object.fromEntries(records.map((r) => [r.channelId, r])) });
      const active = get().activeSpaceId;
      if (!active || !spaces.some((s) => s.id === active)) {
        if (spaces[0]) await get().openSpace(spaces[0].id);
        else set({ channels: [], messages: [], activeSpaceId: null, activeChannelId: null });
      } else {
        const epoch = selectionEpoch,
          previous = get().channels,
          channels = await bridge().channels(active);
        if (!sameSession() || get().activeSpaceId !== active || selectionEpoch !== epoch) return;
        set({ channels });
        const { useVoiceContext, leaveVoice } = await import('./realtime');
        if (!sameSession()) return;
        const voice = useVoiceContext.getState();
        const joined = channels.find((ch) => ch.id === voice.channelId);
        if (joined) useVoiceContext.setState({ roomName: joined.name });
        else if (previous.some((ch) => ch.id === voice.channelId)) await leaveVoice();
        const selected = get().activeChannelId;
        if (
          selected &&
          !channels.some((ch) => ch.id === selected) &&
          !get().dms.some((ch) => ch.id === selected)
        ) {
          const next = channels.find((ch) => ch.type === 0);
          if (next) await get().openChannel(next.id);
          else set({ activeChannelId: null, messages: [] });
        }
      }
    } catch (error) {
      if (sameSession()) set({ error: safeError(error) });
    }
  },
  openSpace: async (spaceId) => {
    if (get().activeSpaceId === spaceId && get().channels.length) {
      await get().refresh();
      return;
    }
    const epoch = ++selectionEpoch,
      session = captureSession();
    set({
      activeSpaceId: spaceId,
      activeChannelId: null,
      messages: [],
      channels: [],
      loadingMessages: true,
      error: null,
    });
    const current = () => epoch === selectionEpoch && session.valid();
    try {
      const channels = await bridge().channels(spaceId);
      if (!current()) return;
      set((state) => ({
        channels,
        unread: {
          ...state.unread,
          ...Object.fromEntries(
            channels
              .filter((ch) => state.readStates[ch.id] && ch.lastMessageId !== undefined)
              .map((ch) => [
                ch.id,
                !!ch.lastMessageId &&
                  state.readStates[ch.id].lastReadMessageId !== ch.lastMessageId,
              ]),
          ),
        },
      }));
      const text = channels.find((c) => c.type === 0);
      if (text && current()) await get().openChannel(text.id);
    } catch (error) {
      if (current()) set({ error: safeError(error) });
    } finally {
      if (current()) set({ loadingMessages: false });
    }
  },
  openChannel: async (channelId, force = false) => {
    const previous = get();
    if (previous.activeChannelId && (!previous.loadingMessages || previous.messages.length > 0))
      conversations.put(previous.activeChannelId, {
        messages: previous.messages,
        hasOlder: previous.hasOlder,
        fetchedAt: conversations.get(previous.activeChannelId)?.fetchedAt ?? 0,
      });
    const cached = useChannelAccess.getState().checks[channelId]
      ? undefined
      : conversations.get(channelId);
    const epoch = ++selectionEpoch,
      session = captureSession();
    set({
      activeChannelId: channelId,
      messages: cached?.messages ?? [],
      loadingMessages: !cached,
      error: null,
      hasOlder: cached?.hasOlder ?? true,
    });
    const current = () =>
      epoch === selectionEpoch && session.valid() && get().activeChannelId === channelId;
    if (cached && !force && Date.now() - cached.fetchedAt < 30000) return;
    let before = get().messages;
    try {
      if (useChannelAccess.getState().checks[channelId]) {
        const access = await bridge().channelPermissions(channelId);
        if (!current()) return;
        if (access.access !== 'allowed' || !access.effective?.view) {
          conversations.remove(channelId);
          setChannelAccess(channelId, access.access === 'missing' ? 'unavailable' : 'denied');
          return;
        }
        setChannelAccess(channelId, null);
      }
      if (!cached && bridge().cachedMessages) {
        const restored = await bridge()
          .cachedMessages(channelId)
          .catch(() => []);
        if (!current()) return;
        if (restored.length) {
          const messages = reconcileMessages(restored, [], get().messages);
          set({ messages, loadingMessages: false });
          before = messages;
        }
      }
      const key = `${sessionEpoch}:${channelId}`;
      let request = channelRequests.get(key);
      if (!request) {
        request = bridge().messages(channelId);
        channelRequests.set(key, request);
        void request
          .finally(() => {
            if (channelRequests.get(key) === request) channelRequests.delete(key);
          })
          .catch(() => {});
      }
      const messages = await request;
      if (!session.valid() || useChannelAccess.getState().checks[channelId]) return;
      const latest = current()
        ? get().messages
        : (conversations.get(channelId)?.messages ?? before);
      const merged = reconcileMessages(messages, before, latest),
        hasOlder = messages.length === 50;
      conversations.put(channelId, { messages: merged, hasOlder, fetchedAt: Date.now() });
      if (!current()) return;
      set({ messages: merged, hasOlder });
      if (messages.at(-1) && location.hash.startsWith('#/chat') && document.hasFocus())
        void get().markRead(channelId, messages.at(-1)!.id);
    } catch (error) {
      if (current()) set({ error: safeError(error) });
    } finally {
      if (current()) set({ loadingMessages: false });
    }
  },
  send: async (text, attachments = []) => {
    const channelId = get().activeChannelId;
    const user = get().user;
    const session = captureSession();
    if (channelId && useChannelAccess.getState().checks[channelId])
      throw new Error(t('Kanal erişimi yeniden doğrulanmalı.'));
    if (!channelId || !user || (!text.trim() && !attachments.length)) return;
    const epoch = selectionEpoch;
    const current = () =>
      epoch === selectionEpoch && session.valid() && get().activeChannelId === channelId;
    if (!current()) throw new Error(t('Oturum değişti. Mesajı yeniden gönder.'));
    const optimistic: CommunityMessage = {
      id: `pending-${crypto.randomUUID()}`,
      channelId,
      author: user,
      content: text.trim().slice(0, 4000),
      timestamp: new Date().toISOString(),
      editedTimestamp: null,
      delivery: 'pending',
      attachments,
    };
    set((state) => ({ messages: [...state.messages, optimistic] }));
    // Settle the optimistic copy wherever it lives now. Reselecting or refreshing the channel
    // while sending carries it into the open list and the channel cache; leaving it there kept a
    // stale "sending" copy next to the delivered message.
    const settle = (update: (messages: CommunityMessage[]) => CommunityMessage[]) => {
      if (!session.valid()) return;
      if (get().activeChannelId === channelId)
        set((state) => ({ messages: update(state.messages) }));
      const cached = conversations.get(channelId);
      if (cached) conversations.put(channelId, { ...cached, messages: update(cached.messages) });
    };
    try {
      const sent = await bridge().send(
        channelId,
        optimistic.content,
        attachments.map((a) => a.id),
      );
      settle((messages) =>
        messages
          .filter((m) => m.id !== optimistic.id && m.id !== sent.id)
          .concat({ ...sent, delivery: 'sent' })
          .sort((a, b) => Date.parse(a.timestamp) - Date.parse(b.timestamp)),
      );
    } catch (error) {
      settle((messages) =>
        messages.map((m) => (m.id === optimistic.id ? { ...m, delivery: 'failed' } : m)),
      );
      if (current()) set({ error: safeError(error) });
      throw error;
    }
  },
  reactMessage: async (id, emoji) => {
    const channelId = get().activeChannelId,
      message = get().messages.find((item) => item.id === id),
      session = captureSession(),
      epoch = selectionEpoch;
    const current = () =>
      epoch === selectionEpoch && session.valid() && get().activeChannelId === channelId;
    if (!channelId || !message || useChannelAccess.getState().checks[channelId]) return;
    try {
      await bridge().react(
        channelId,
        id,
        emoji,
        message.reactions?.[emoji]?.includes(get().user?.id ?? '') ?? false,
      );
      if (current()) await get().openChannel(channelId, true);
    } catch (error) {
      if (current()) throw error;
    }
  },
  discardMessage: (id) => {
    const message = get().messages.find((m) => m.id === id && m.delivery === 'failed');
    if (!message) return;
    set((state) => ({ messages: state.messages.filter((m) => m.id !== id) }));
    const cached = conversations.get(message.channelId);
    if (cached)
      conversations.put(message.channelId, {
        ...cached,
        messages: cached.messages.filter((m) => m.id !== id),
      });
  },
  retryMessage: async (id) => {
    const message = get().messages.find((m) => m.id === id && m.delivery === 'failed');
    if (!message) return;
    set((state) => ({ messages: state.messages.filter((m) => m.id !== id) }));
    await get().send(message.content, message.attachments);
  },
  editMessage: async (id, text) => {
    const channelId = get().activeChannelId,
      session = captureSession(),
      epoch = selectionEpoch;
    if (!channelId) return;
    const current = () =>
      epoch === selectionEpoch && session.valid() && get().activeChannelId === channelId;
    try {
      const updated = await bridge().edit(channelId, id, text);
      if (current())
        set((state) => ({ messages: state.messages.map((m) => (m.id === id ? updated : m)) }));
    } catch (error) {
      if (current()) set({ error: safeError(error) });
      throw error;
    }
  },
  deleteMessage: async (id) => {
    const channelId = get().activeChannelId,
      session = captureSession(),
      epoch = selectionEpoch;
    if (!channelId) return;
    const current = () =>
      epoch === selectionEpoch && session.valid() && get().activeChannelId === channelId;
    try {
      await bridge().delete(channelId, id);
      if (current()) set((state) => ({ messages: state.messages.filter((m) => m.id !== id) }));
    } catch (error) {
      if (current()) set({ error: safeError(error) });
      throw error;
    }
  },
  loadOlder: async () => {
    const initial = get();
    if (
      !initial.activeChannelId ||
      useChannelAccess.getState().checks[initial.activeChannelId] ||
      !initial.hasOlder ||
      initial.loadingMessages
    )
      return;
    const channelId = initial.activeChannelId,
      epoch = selectionEpoch,
      session = captureSession();
    const current = () =>
      epoch === selectionEpoch && session.valid() && get().activeChannelId === channelId;
    const oldest = initial.messages.find((m) => !m.id.startsWith('pending-'));
    if (!oldest) return;
    set({ loadingMessages: true });
    try {
      const older = await bridge().messages(channelId, oldest.id);
      if (current())
        set((state) => {
          const known = new Set(state.messages.map((m) => m.id));
          const merged = [...older.filter((m) => !known.has(m.id)), ...state.messages];
          // Trimming the oldest end would throw away the page just fetched (and loop forever).
          const full = merged.length >= MESSAGE_WINDOW;
          return {
            messages: full ? merged.slice(-MESSAGE_WINDOW) : merged,
            hasOlder: older.length === 50 && !full,
          };
        });
    } catch (error) {
      if (current()) set({ error: safeError(error) });
    } finally {
      if (current()) set({ loadingMessages: false });
    }
  },
  createInvite: async (channelId) => {
    const session = captureSession();
    const invite = await bridge().createInvite(channelId);
    if (!session.valid()) throw new Error(t('Oturum değişti. Davet sonucu gösterilmedi.'));
    return invite;
  },
  listInvites: async (spaceId) => {
    const session = captureSession();
    const invites = await bridge().listInvites(spaceId);
    if (!session.valid()) throw new Error(t('Oturum değişti. Davet listesi gösterilmedi.'));
    return invites;
  },
  revokeInvite: async (spaceId, inviteId) => {
    const session = captureSession();
    await bridge().revokeInvite(spaceId, inviteId);
    if (!session.valid()) throw new Error(t('Oturum değişti. Davet iptali doğrulanamadı.'));
  },
  acceptInvite: async (code) => {
    const session = captureSession();
    try {
      await bridge().acceptInvite(code);
      if (session.valid()) await get().refresh();
    } catch (error) {
      if (session.valid()) set({ error: safeError(error) });
      throw error;
    }
  },
  createDM: async (userId) => {
    const session = captureSession();
    try {
      const channel = await bridge().createDM(userId);
      if (!session.valid()) return;
      set((state) => ({ dms: [...state.dms.filter((c) => c.id !== channel.id), channel] }));
      await get().openChannel(channel.id);
    } catch (error) {
      if (session.valid()) set({ error: safeError(error) });
      throw error;
    }
  },
  markRead: async (channelId, messageId) => {
    try {
      await bridge().ackRead(
        channelId,
        messageId,
      ); /* Native READ_STATE_SYNC is authoritative, including messages arriving while awaiting ACK. */
    } catch {
      /* A failed acknowledgement never clears the unread indicator. */
    }
  },
  setPresence: (status) => bridge().presence(status),
  clearError: () => set({ error: null }),
}));
useCommunity.subscribe((state, previous) => {
  if (
    state.user &&
    state.activeChannelId &&
    state.activeChannelId === previous.activeChannelId &&
    state.messages !== previous.messages &&
    !useChannelAccess.getState().checks[state.activeChannelId]
  ) {
    conversations.put(state.activeChannelId, {
      messages: state.messages,
      hasOlder: state.hasOlder,
      fetchedAt: conversations.get(state.activeChannelId)?.fetchedAt ?? 0,
    });
  }
});
let channelRecheck: ReturnType<typeof setTimeout> | undefined;
/** Coalesces bursts of membership events into one authoritative channel list refresh. */
function scheduleChannelRecheck() {
  clearTimeout(channelRecheck);
  channelRecheck = setTimeout(() => void useCommunity.getState().refresh(), 400);
}
/** A channel permission event only means access may have changed; bring back channels still visible. */
async function recheckChannelAccess(channelIds: string[]) {
  const session = captureSession();
  const results = await Promise.all(
    channelIds.map((id) =>
      bridge()
        .channelPermissions(id)
        .catch(() => null),
    ),
  );
  if (session.valid() && results.some((r) => r?.access === 'allowed' && r.effective?.view))
    scheduleChannelRecheck();
}
function onEvent(event: GatewayEvent) {
  if (typeof event.sessionEpoch === 'number' && event.sessionEpoch !== nativeSessionEpoch) return;
  const state = useCommunity.getState();
  if (event.type === 'CHANNEL_ACCESS_INVALIDATED') {
    const data = event.data as import('@rooms/social').SocialChannelAccessInvalidation;
    const affected = new Set(data.channelIds);
    // A server-wide membership change usually leaves channel access intact. Keep those channels
    // listed while access is rechecked. A channel permission change or removal hides them now;
    // permission changes are rechecked so channels the user can still see come back.
    const listed = (id: string) => data.reason === 'membership-changed' || !affected.has(id);
    const hidden = state.channels.filter((ch) => !listed(ch.id)).map((ch) => ch.id);
    for (const id of affected) {
      conversations.remove(id);
      setChannelAccess(id, 'checking');
    }
    if (state.activeChannelId && affected.has(state.activeChannelId)) selectionEpoch++;
    useCommunity.setState((s) => ({
      channels: s.channels.filter((ch) => listed(ch.id)),
      dms: s.dms.filter((ch) => listed(ch.id)),
      messages: s.activeChannelId && affected.has(s.activeChannelId) ? [] : s.messages,
      typing: Object.fromEntries(Object.entries(s.typing).filter(([id]) => !affected.has(id))),
      readStates: Object.fromEntries(
        Object.entries(s.readStates).filter(([id]) => !affected.has(id)),
      ),
      unread: Object.fromEntries(Object.entries(s.unread).filter(([id]) => !affected.has(id))),
    }));
    window.dispatchEvent(
      new CustomEvent('rooms:channel-access-invalidated', {
        detail: { channelIds: [...affected] },
      }),
    );
    if (state.activeChannelId && affected.has(state.activeChannelId))
      void state.openChannel(state.activeChannelId);
    if (data.reason === 'membership-changed') scheduleChannelRecheck();
    else if (data.reason === 'permissions-changed' && hidden.length)
      void recheckChannelAccess(hidden);
  } else if (event.type === 'READ_STATE_SYNC') {
    const records = event.data as SocialReadState[];
    const readStates = Object.fromEntries(records.map((r) => [r.channelId, r]));
    useCommunity.setState((s) => ({
      readStates,
      unread: Object.fromEntries(
        [...s.channels, ...s.dms]
          .filter((ch) => readStates[ch.id] && ch.lastMessageId !== undefined)
          .map((ch) => [
            ch.id,
            !!ch.lastMessageId && readStates[ch.id].lastReadMessageId !== ch.lastMessageId,
          ]),
      ),
    }));
  } else if (event.type === 'MESSAGE_ACK') {
    const d = event.data as { channelId: string; messageId: string; userId: string };
    if (d.userId === state.user?.id)
      useCommunity.setState((s) => ({
        readStates: {
          ...s.readStates,
          [d.channelId]: {
            channelId: d.channelId,
            lastReadMessageId: d.messageId,
            mentionMessageIds: s.readStates[d.channelId]?.mentionMessageIds ?? [],
          },
        },
        unread: {
          ...s.unread,
          [d.channelId]: [...s.channels, ...s.dms].find((ch) => ch.id === d.channelId)
            ?.lastMessageId
            ? [...s.channels, ...s.dms].find((ch) => ch.id === d.channelId)!.lastMessageId !==
              d.messageId
            : (s.unread[d.channelId] ?? false),
        },
      }));
  } else if (event.type === 'TYPING_UPDATE') {
    const data = event.data as { channelId: string; user: SocialUser; active: boolean };
    if (data.user.id === state.user?.id || useChannelAccess.getState().checks[data.channelId])
      return;
    useCommunity.setState((s) => {
      const users = { ...s.typing[data.channelId] };
      if (data.active) users[data.user.id] = { user: data.user, expiresAt: Date.now() + 8000 };
      else delete users[data.user.id];
      return { typing: { ...s.typing, [data.channelId]: users } };
    });
  } else if (event.type === 'PROFILE_UPDATE') {
    useCommunity.setState({ user: event.data as SocialUser });
  } else if (event.type === 'CONNECTION_STATUS')
    useCommunity.setState({
      status: event.data as ConnectionStatus,
      ...(event.data !== 'connected' ? { typing: {} } : {}),
    });
  else if (event.type === 'OPEN_SERVER_SETTINGS') {
    // A clicked server alert: App opens Sunucu makinesi.
    window.dispatchEvent(new Event('rooms:open-server-settings'));
  } else if (event.type === 'OPEN_CHANNEL') {
    // A clicked desktop notification: App opens the channel.
    const channelId = (event.data as { channelId?: unknown })?.channelId;
    if (typeof channelId === 'string')
      window.dispatchEvent(new CustomEvent('rooms:open-channel', { detail: channelId }));
  } else if (event.type === 'SESSION_RESTORED') {
    // The saved session's server answered (or refused it) after launch. A sign-in, sign-up or
    // sign-out in progress decides the session itself (and re-reads it if it fails), so the
    // restore must not orphan its result by moving the epoch.
    if (state.busy) return;
    const request = ++sessionEpoch;
    void bridge()
      .session()
      .then(async (session) => {
        await applySession(session, request);
        if (session.user) window.dispatchEvent(new Event('rooms:session-restored'));
      })
      .catch(() => {});
  } else if (event.type === 'AUTH_EXPIRED') {
    nativeSessionEpoch = null;
    clearConversations();
    sessionEpoch++;
    selectionEpoch++;
    useChannelAccess.setState({ checks: {} });
    void import('./realtime').then(({ leaveVoice }) => leaveVoice()).catch(() => {});
    useCommunity.setState({
      ...blank,
      status: 'error',
      error: t('Oturumunun süresi doldu. Çıkış yapıp yeniden giriş yap.'),
    });
  } else if (event.type === 'MESSAGE_CREATE' || event.type === 'MESSAGE_UPDATE') {
    const message = event.data as SocialMessage;
    if (useChannelAccess.getState().checks[message.channelId]) return;
    const newlyReceived = event.type === 'MESSAGE_CREATE' && !receivedMessages.has(message.id);
    if (newlyReceived) {
      receivedMessages.add(message.id);
      if (receivedMessages.size > 2000)
        receivedMessages.delete(receivedMessages.values().next().value!);
    }
    if (newlyReceived)
      useCommunity.setState((s) => {
        const users = { ...s.typing[message.channelId] };
        delete users[message.author.id];
        return { typing: { ...s.typing, [message.channelId]: users } };
      });
    if (newlyReceived)
      useCommunity.setState((s) => ({
        readStates:
          message.author.id !== s.user?.id && s.user && message.mentions?.includes(s.user.id)
            ? {
                ...s.readStates,
                [message.channelId]: {
                  channelId: message.channelId,
                  lastReadMessageId: s.readStates[message.channelId]?.lastReadMessageId ?? null,
                  mentionMessageIds: [
                    ...new Set([
                      ...(s.readStates[message.channelId]?.mentionMessageIds ?? []),
                      message.id,
                    ]),
                  ].slice(-200),
                },
              }
            : s.readStates,
        channels: s.channels.map((ch) =>
          ch.id === message.channelId ? { ...ch, lastMessageId: message.id } : ch,
        ),
        dms: s.dms.map((ch) =>
          ch.id === message.channelId ? { ...ch, lastMessageId: message.id } : ch,
        ),
        unread: { ...s.unread, [message.channelId]: message.author.id !== s.user?.id },
      }));
    // An edit or reaction on a message that is not loaded must not drop it into the log out
    // of context; it arrives in place when older pages load.
    const upsert = (messages: SocialMessage[]) =>
      event.type === 'MESSAGE_UPDATE' && !messages.some((m) => m.id === message.id)
        ? messages
        : [...messages.filter((m) => m.id !== message.id), message].sort(
            (a, b) => Date.parse(a.timestamp) - Date.parse(b.timestamp),
          );
    const cached = conversations.get(message.channelId);
    if (cached)
      conversations.put(message.channelId, { ...cached, messages: upsert(cached.messages) });
    if (message.channelId === state.activeChannelId) {
      useCommunity.setState((s) => ({
        messages: upsert(s.messages).slice(-MESSAGE_WINDOW),
      }));
    }
    if (
      newlyReceived &&
      message.channelId === state.activeChannelId &&
      location.hash.startsWith('#/chat') &&
      document.hasFocus()
    )
      void state.markRead(message.channelId, message.id);
  } else if (event.type === 'MESSAGE_DELETE') {
    const d = event.data as { id: string; channel_id: string };
    const cached = conversations.get(d.channel_id);
    if (cached)
      conversations.put(d.channel_id, {
        ...cached,
        messages: cached.messages.filter((m) => m.id !== d.id),
      });
    if (d.channel_id === state.activeChannelId)
      useCommunity.setState((s) => ({ messages: s.messages.filter((m) => m.id !== d.id) }));
  } else if (event.type === 'PRESENCE_UPDATE') {
    const d = event.data as { userId?: string; status?: string };
    if (d.userId && d.status)
      useCommunity.setState((s) => ({ presence: { ...s.presence, [d.userId!]: d.status! } }));
  } else if (event.type === 'SOCIAL_REFRESH' || event.type === 'RESUMED') {
    window.dispatchEvent(new Event('rooms:friends-changed'));
    window.dispatchEvent(new Event('rooms:community-management-invalidated'));
    void state.refresh();
    if (event.type === 'RESUMED' && state.activeChannelId)
      void state.openChannel(state.activeChannelId, true);
  }
}
/** Concurrent mounts share session restoration, including React StrictMode remounts. */
export function initializeCommunity(): Promise<void> {
  if (!window.rooms) return Promise.resolve();
  if (initialization) return initialization;
  const request = ++sessionEpoch;
  bridge().onEvent(onEvent);
  initialization = (async () => {
    try {
      await applySession(await bridge().session(), request);
    } catch {
      if (request === sessionEpoch)
        useCommunity.setState({
          error: t('Kayıtlı sunucuya ulaşılamıyor. Ayarlar bölümünden yeniden bağlan.'),
        });
    }
  })();
  return initialization;
}

/** What the Dock badge counts: unread mentions, plus conversations with unread messages. */
export function badgeCount(state: Pick<CommunityState, 'readStates' | 'unread' | 'dms' | 'user'>) {
  if (!state.user) return 0;
  const mentions = Object.values(state.readStates).reduce(
    (sum, read) => sum + (read.mentionMessageIds?.length ?? 0),
    0,
  );
  const conversations = state.dms.filter((dm) => state.unread[dm.id]).length;
  return Math.min(9999, mentions + conversations);
}
