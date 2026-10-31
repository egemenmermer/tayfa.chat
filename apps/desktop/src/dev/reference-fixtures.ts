import type { ConnectionStatus } from '@rooms/contracts';
import type {
  SocialAttachment,
  SocialChannel,
  SocialInvite,
  SocialMessage,
  SocialFriend,
  SocialReadState,
  SocialSpace,
  SocialUser,
} from '@rooms/social';
import { useCommunity, type CommunityMessage, type CommunityState } from '../community';
import { useRooms } from '../store';
import { people, places, sample } from './sample';

export const REFERENCE_FIXTURE_LABEL = sample(
  'DEMO · Yerel örnek veriler',
  'DEMO · Local sample data',
);

export interface ReferenceFixtureMetadata {
  screenId: string;
  variant: string;
  status: ConnectionStatus;
  identity: SocialUser | null;
  scene:
    | 'welcome'
    | 'sign-in'
    | 'registration'
    | 'recovery'
    | 'invitation'
    | 'profile-setup'
    | 'device-setup'
    | 'home'
    | 'friends'
    | 'chat'
    | 'voice'
    | 'video'
    | 'share-picker'
    | 'screen-share'
    | 'activity';
  dataScope: 'signed-out' | 'setup-sample' | 'community-sample';
  demo: true;
}

const userIds = {
  deniz: 'demo-deniz',
  ece: 'demo-ece',
  can: 'demo-can',
  zeynep: 'demo-zeynep',
  mert: 'demo-mert',
} as const;

const spaceId = 'demo-bizim-oda';
const channelIds = {
  general: 'demo-channel-genel',
  film: 'demo-channel-film-gecesi',
  games: 'demo-channel-oyun-masasi',
  shares: 'demo-channel-paylasimlar',
  lounge: 'demo-channel-salon',
  quiet: 'demo-channel-sessiz-kose',
} as const;

const users: Record<keyof typeof userIds, SocialUser> = {
  deniz: {
    id: userIds.deniz,
    username: people.deniz.toLowerCase(),
    displayName: people.deniz,
    avatar: null,
  },
  ece: {
    id: userIds.ece,
    username: people.ece.toLowerCase(),
    displayName: people.ece,
    avatar: null,
  },
  can: {
    id: userIds.can,
    username: people.can.toLowerCase(),
    displayName: people.can,
    avatar: null,
  },
  zeynep: {
    id: userIds.zeynep,
    username: people.zeynep.toLowerCase(),
    displayName: people.zeynep,
    avatar: null,
  },
  mert: {
    id: userIds.mert,
    username: people.mert.toLowerCase(),
    displayName: people.mert,
    avatar: null,
  },
};

const avatarPaths: Record<string, string> = {
  [userIds.deniz]: '/__reference/01_brand/avatar-deniz.svg',
  [userIds.ece]: '/__reference/01_brand/avatar-ece.svg',
  [userIds.can]: '/__reference/01_brand/avatar-can.svg',
  [userIds.zeynep]: '/__reference/01_brand/avatar-zeynep.svg',
  [userIds.mert]: '/__reference/01_brand/avatar-mert.svg',
};

const fixtureVariants: Record<string, readonly string[]> = {
  S01: ['default'],
  S02: ['default', 'invalid', 'loading', 'offline', 'password'],
  S03: ['default', 'invalid', 'used'],
  S04: ['default', 'expired', 'reset', 'sent'],
  S05: ['default', 'expired', 'limit', 'revoked'],
  S06: ['default', 'avatar'],
  S07: ['default', 'denied', 'granted', 'test'],
  S08: ['default', 'empty', 'loading'],
  S09: ['default', 'add', 'all', 'blocked'],
  S10: ['default', 'failed', 'empty', 'loading', 'offline'],
  S19: ['default', 'empty', 'alone', 'ptt', 'offline', 'dm'],
  S20: ['default', 'focus', 'camera_off', 'no_device', 'dm'],
  S21: ['default', 'denied', 'system_audio_unavailable'],
  S22: ['default', 'viewer', 'request', 'request_sent', 'handover', 'source_closed'],
  S23: ['default', 'active', 'forbidden'],
  S70: ['default', 'history', 'discord', 'discord_disconnected', 'permission'],
  S71: ['default', 'downloading', 'ready', 'error', 'logs', 'licenses'],
  S72: [
    'default',
    'offline',
    'reconnect',
    'loading',
    'empty',
    'session_expired',
    'unavailable',
    'permission_denied',
    'unsupported',
    'splash',
  ],
};

function normalizeFixtureScreen(id: string): string {
  return id
    .trim()
    .toUpperCase()
    .replace(/^S?(\d{2})$/, 'S$1');
}

/** Stable public metadata for the development capture router; this is not provider session data. */
export function getReferenceFixtureMetadata(id: string, value: string): ReferenceFixtureMetadata {
  const screenId = normalizeFixtureScreen(id);
  const variants = fixtureVariants[screenId];
  if (!variants) throw new Error(`Unsupported reference fixture screen: ${id}`);
  const variant = value.trim().toLowerCase() || 'default';
  if (!variants.includes(variant))
    throw new Error(`Unsupported ${screenId} reference fixture variant: ${value}`);
  const number = Number(screenId.slice(1));
  const dataScope: ReferenceFixtureMetadata['dataScope'] =
    number <= 5 ? 'signed-out' : number <= 7 ? 'setup-sample' : 'community-sample';
  const scene: ReferenceFixtureMetadata['scene'] =
    screenId === 'S01'
      ? 'welcome'
      : screenId === 'S02'
        ? 'sign-in'
        : screenId === 'S03'
          ? 'registration'
          : screenId === 'S04'
            ? 'recovery'
            : screenId === 'S05'
              ? 'invitation'
              : screenId === 'S06'
                ? 'profile-setup'
                : screenId === 'S07'
                  ? 'device-setup'
                  : screenId === 'S08'
                    ? 'home'
                    : screenId === 'S09'
                      ? 'friends'
                      : screenId === 'S10'
                        ? 'chat'
                        : screenId === 'S19'
                          ? 'voice'
                          : screenId === 'S20'
                            ? 'video'
                            : screenId === 'S21'
                              ? 'share-picker'
                              : screenId === 'S22'
                                ? 'screen-share'
                                : 'activity';
  const identity = dataScope === 'signed-out' ? null : { ...users.deniz };
  const status: ConnectionStatus =
    dataScope === 'community-sample'
      ? screenId === 'S08' && variant === 'loading'
        ? 'connecting'
        : screenId === 'S10' && variant === 'offline'
          ? 'reconnecting'
          : 'connected'
      : 'not-configured';
  return { screenId, variant, status, identity, scene, dataScope, demo: true };
}

/** The reference friends panel is local sample data, never provider presence. */
export function getReferenceFriends(): SocialFriend[] {
  return [
    { user: { ...users.ece }, relationship: 'friend', status: 'online' },
    { user: { ...users.can }, relationship: 'friend', status: 'online' },
    { user: { ...users.zeynep }, relationship: 'friend', status: 'online' },
    { user: { ...users.mert }, relationship: 'friend', status: 'invisible' },
  ];
}

/** S10 prototype shows Ece's typing indicator in #genel; the social contract has no typing field yet. */
export function getReferenceTypingUsers(channelId: string): SocialUser[] {
  return channelId === channelIds.general ? [{ ...users.ece }] : [];
}

/** Resolve only the fixed local fixture presence; this is not live provider presence. */
export function getReferencePresenceStatus(userId: string): 'online' | 'invisible' | null {
  if (userId === userIds.mert) return 'invisible';
  if (new Set<string>([userIds.deniz, userIds.ece, userIds.can, userIds.zeynep]).has(userId))
    return 'online';
  return null;
}

/** Profile copy present in the approved sample; returns null when the source has no status text. */
export function getReferencePresenceText(userId: string): string | null {
  if (userId === userIds.deniz) return sample('Buradayım.', "I'm here.");
  if (userId === userIds.ece)
    return sample('Cinema · Gecenin Kıyısında', 'Cinema · Edge of Tonight');
  if (userId === userIds.can) return sample('Birazdan katılıyorum', 'Joining in a bit');
  if (userId === userIds.zeynep) return sample('Müzik dinliyor', 'Listening to music');
  if (userId === userIds.mert) return sample('En son dün', 'Last seen yesterday');
  return null;
}

/** Resolve fixture IDs to source artwork served only by the dev reference route. */
export function getReferenceAvatar(id: string): string | null {
  return avatarPaths[id] ?? null;
}

const space: SocialSpace = {
  id: spaceId,
  name: places.community,
  ownerId: 'demo-deniz',
  icon: null,
};

const channels: SocialChannel[] = [
  {
    id: channelIds.general,
    spaceId,
    name: places.general,
    type: 0,
    topic: sample('Her şey burada başlar.', 'Where everything starts.'),
  },
  { id: channelIds.film, spaceId, name: places.movieNight, type: 0, topic: null },
  { id: channelIds.games, spaceId, name: places.gameTable, type: 0, topic: null },
  { id: channelIds.shares, spaceId, name: places.shares, type: 0, topic: null },
  { id: channelIds.lounge, spaceId, name: places.lounge, type: 2, topic: null },
  { id: channelIds.quiet, spaceId, name: places.quietCorner, type: 2, topic: null },
];

const timestamp = (minute: number) => new Date(Date.UTC(2026, 9, 10, 18, minute)).toISOString();

const makeMessage = (
  id: string,
  author: SocialUser,
  minute: number,
  content: string,
  additions: Pick<SocialMessage, 'mentions' | 'attachments' | 'reactions'> = {},
): CommunityMessage => ({
  id,
  channelId: channelIds.general,
  author,
  content,
  timestamp: timestamp(minute),
  editedTimestamp: null,
  ...additions,
});

const referencePdf: SocialAttachment = {
  id: 'demo-weekend-list-pdf',
  name: sample('hafta-sonu-listesi.pdf', 'weekend-list.pdf'),
  // The S10 reference displays 248 KB; the linked local sample PDF remains its original 13,499-byte file.
  size: 248 * 1024,
  mime: 'application/pdf',
  url: '/__reference/06_handoff/examples/weekend-list.pdf',
};

function makeDefaultMessages(): CommunityMessage[] {
  return [
    makeMessage(
      'demo-message-ece-2042',
      users.ece,
      42,
      sample(
        'Herkes burada mı? Bu akşam filmi biraz erken açalım mı?',
        'Is everyone here? Should we start the movie a bit early tonight?',
      ),
      {
        reactions: {
          '2764': [userIds.deniz, userIds.can, userIds.zeynep],
          '2714': [userIds.deniz, userIds.can],
        },
      },
    ),
    makeMessage(
      'demo-message-can-2043',
      users.can,
      43,
      sample(
        'Ben hazırım. Çayı da aldım, başlayabiliriz.',
        "I'm ready. Got my tea too, we can start.",
      ),
    ),
    makeMessage(
      'demo-message-deniz-2044',
      users.deniz,
      44,
      sample('Süper. @Zeynep sen de geliyor musun?', 'Great. @Zoe are you coming too?'),
      {
        mentions: [userIds.zeynep],
      },
    ),
    makeMessage(
      'demo-message-zeynep-2045',
      users.zeynep,
      45,
      sample(
        'Geldim! Önce izleme listesine bir şey daha ekleyeyim.',
        "I'm here! Let me add one more thing to the watchlist first.",
      ),
      {
        attachments: [referencePdf],
      },
    ),
    makeMessage(
      'demo-message-ece-2047',
      users.ece,
      47,
      sample(
        'İlk filmi seçtim. Herkes kendi kaynağını hazırlayınca başlatırız.',
        "I picked the first movie. We'll start once everyone has their own source ready.",
      ),
    ),
  ];
}

function initialReadStates(): Record<string, SocialReadState> {
  return {
    [channelIds.general]: {
      channelId: channelIds.general,
      lastReadMessageId: 'demo-message-zeynep-2045',
      mentionMessageIds: [],
    },
  };
}

function rejectExternalAction(): never {
  throw new Error(
    'This demo fixture stores changes locally and cannot contact a community server.',
  );
}

/** Install a deterministic local social shell; the explicit screen ID selects only demo state. */
export async function installReferenceFixture(id: string, value: string): Promise<() => void> {
  const metadata = getReferenceFixtureMetadata(id, value);
  const { screenId, variant, dataScope } = metadata;
  const previousState = useCommunity.getState();
  const previousMemberPanel = useRooms.getState().preferences.memberPanel;
  const previousFixtureTag = document.documentElement.getAttribute('data-demofixture');
  const socialSample = dataScope === 'community-sample';
  const homeEmpty = screenId === 'S08' && variant === 'empty';
  const s10Variant = screenId === 'S10' ? variant : 'default';
  const selectedVariant = s10Variant as 'default' | 'failed' | 'empty' | 'loading' | 'offline';
  const initialMessages =
    socialSample &&
    !homeEmpty &&
    (selectedVariant === 'default' || selectedVariant === 'failed' || selectedVariant === 'offline')
      ? makeDefaultMessages()
      : [];
  if (screenId === 'S10' && selectedVariant === 'failed') {
    initialMessages.push({
      ...makeMessage(
        'demo-message-deniz-2048',
        users.deniz,
        48,
        sample('Tamam, ben de hazırım.', "Okay, I'm ready too."),
      ),
      delivery: 'failed',
    });
  }
  const status: ConnectionStatus = metadata.status;
  let localMessageSequence = 0;
  document.documentElement.dataset.demofixture = `${screenId}-${variant}`;

  const sampleChannels =
    socialSample && !homeEmpty
      ? channels.map((channel) => ({
          ...channel,
          lastMessageId:
            channel.id === channelIds.general && initialMessages.length
              ? 'demo-message-ece-2047'
              : null,
        }))
      : [];
  const sampleSpaces = socialSample && !homeEmpty ? [space] : [];
  const hasCommunityShell = socialSample && !homeEmpty;
  const activeChannelId = hasCommunityShell ? channelIds.general : null;
  const initialState: CommunityState = {
    status,
    user: metadata.identity,
    serverUrl: '',
    remembered: false,
    spaces: sampleSpaces,
    channels: sampleChannels,
    dms: [],
    activeSpaceId: hasCommunityShell ? spaceId : null,
    activeChannelId,
    messages: initialMessages,
    typing: {},
    unread: screenId === 'S10' ? { [channelIds.general]: true } : {},
    readStates: screenId === 'S10' ? initialReadStates() : {},
    presence: hasCommunityShell
      ? {
          [userIds.deniz]: 'online',
          [userIds.ece]: 'online',
          [userIds.can]: 'online',
          [userIds.zeynep]: 'online',
          [userIds.mert]: 'invisible',
        }
      : {},
    error: null,
    busy: false,
    loadingMessages:
      (screenId === 'S10' && selectedVariant === 'loading') ||
      (screenId === 'S08' && variant === 'loading'),
    hasOlder: false,
    connect: async () => rejectExternalAction(),
    register: async () => rejectExternalAction(),
    signupRequests: async () => rejectExternalAction(),
    decideSignupRequest: async () => rejectExternalAction(),
    logout: async () => rejectExternalAction(),
    refresh: async () => undefined,
    openSpace: async (nextSpaceId) => {
      if (!sampleSpaces.some((item) => item.id === nextSpaceId)) return;
      useCommunity.setState({ activeSpaceId: nextSpaceId, error: null });
      const nextChannel = sampleChannels.find((channel) => channel.type === 0);
      if (nextChannel) await useCommunity.getState().openChannel(nextChannel.id);
    },
    openChannel: async (channelId) => {
      const knownChannel = [
        ...useCommunity.getState().channels,
        ...useCommunity.getState().dms,
      ].some((channel) => channel.id === channelId);
      if (!knownChannel) return;
      const emptyTranscript =
        screenId === 'S10' && (selectedVariant === 'empty' || selectedVariant === 'loading');
      const messages =
        channelId !== channelIds.general || emptyTranscript
          ? []
          : selectedVariant === 'failed'
            ? [
                ...makeDefaultMessages(),
                {
                  ...makeMessage(
                    'demo-message-deniz-2048',
                    users.deniz,
                    48,
                    sample('Tamam, ben de hazırım.', "Okay, I'm ready too."),
                  ),
                  delivery: 'failed' as const,
                },
              ]
            : makeDefaultMessages();
      useCommunity.setState({
        activeChannelId: channelId,
        messages,
        loadingMessages: false,
        hasOlder: false,
        error: null,
      });
    },
    send: async (content, attachments = []) => {
      const current = useCommunity.getState();
      if (!current.user || !current.activeChannelId || (!content.trim() && !attachments.length)) {
        if (!current.user)
          throw new Error('A signed-out reference fixture cannot send community messages.');
        return;
      }
      localMessageSequence += 1;
      const localMessage: CommunityMessage = {
        id: `demo-local-message-${localMessageSequence}`,
        channelId: current.activeChannelId,
        author: current.user,
        content: content.trim().slice(0, 4000),
        timestamp: timestamp(48 + localMessageSequence),
        editedTimestamp: null,
        delivery: screenId === 'S10' && selectedVariant === 'offline' ? 'failed' : 'sent',
        ...(attachments.length ? { attachments: [...attachments] } : {}),
      };
      useCommunity.setState((state) => ({ messages: [...state.messages, localMessage] }));
      if (screenId === 'S10' && selectedVariant === 'offline')
        throw new Error(
          'Demo fixture is simulating a reconnect; this message remains local and was not sent.',
        );
    },
    reactMessage: async () => rejectExternalAction(),
    discardMessage: (messageId) =>
      useCommunity.setState((state) => ({
        messages: state.messages.filter(
          (item) => !(item.id === messageId && item.delivery === 'failed'),
        ),
      })),
    retryMessage: async (messageId) => {
      const current = useCommunity.getState();
      const message = current.messages.find(
        (item) => item.id === messageId && item.delivery === 'failed',
      );
      if (!message) return;
      if (screenId === 'S10' && selectedVariant === 'offline')
        throw new Error('Demo fixture is simulating a reconnect; this message remains local.');
      useCommunity.setState((state) => ({
        messages: state.messages.map((item) =>
          item.id === messageId ? { ...item, delivery: 'sent' } : item,
        ),
      }));
    },
    editMessage: async (messageId, content) => {
      if (!content.trim()) return;
      useCommunity.setState((state) => ({
        messages: state.messages.map((message) =>
          message.id === messageId && message.author.id === userIds.deniz
            ? {
                ...message,
                content: content.trim().slice(0, 4000),
                editedTimestamp: timestamp(49 + localMessageSequence),
              }
            : message,
        ),
      }));
    },
    deleteMessage: async (messageId) =>
      useCommunity.setState((state) => ({
        messages: state.messages.filter((message) => message.id !== messageId),
      })),
    loadOlder: async () => undefined,
    createInvite: async (_channelId): Promise<SocialInvite> => rejectExternalAction(),
    listInvites: async () => rejectExternalAction(),
    revokeInvite: async () => rejectExternalAction(),
    acceptInvite: async () => rejectExternalAction(),
    createDM: async (recipientId) => {
      if (!useCommunity.getState().user)
        throw new Error('A signed-out reference fixture cannot create direct messages.');
      const recipient = Object.values(users).find((candidate) => candidate.id === recipientId);
      if (!recipient || recipient.id === users.deniz.id) return;
      const dm: SocialChannel = {
        id: `demo-dm-${recipient.id}`,
        spaceId: null,
        name: recipient.displayName,
        type: 1,
        topic: null,
        recipients: [recipient],
      };
      useCommunity.setState((state) => ({
        dms: [...state.dms.filter((channel) => channel.id !== dm.id), dm],
      }));
      await useCommunity.getState().openChannel(dm.id);
    },
    markRead: async (channelId, messageId) =>
      useCommunity.setState((state) => ({
        readStates: {
          ...state.readStates,
          [channelId]: { channelId, lastReadMessageId: messageId, mentionMessageIds: [] },
        },
        unread: { ...state.unread, [channelId]: false },
      })),
    setPresence: async (nextStatus) =>
      useCommunity.setState((state) => ({
        presence: { ...state.presence, [userIds.deniz]: nextStatus },
      })),
    clearError: () => useCommunity.setState({ error: null }),
  };

  useRooms.setState((state) => ({
    preferences: { ...state.preferences, memberPanel: hasCommunityShell },
  }));
  useCommunity.setState(initialState, true);
  return () => {
    useCommunity.setState(previousState, true);
    useRooms.setState((state) => ({
      preferences: { ...state.preferences, memberPanel: previousMemberPanel },
    }));
    if (previousFixtureTag === null) delete document.documentElement.dataset.demofixture;
    else document.documentElement.setAttribute('data-demofixture', previousFixtureTag);
  };
}

/** Visual-only public fixture identity metadata, unavailable in production. */
export function getReferenceNameColors(): Record<string, string> {
  return {
    [userIds.deniz]: '#b7aeff',
    [userIds.ece]: '#e9af85',
    [userIds.can]: '#94d4bf',
    [userIds.zeynep]: '#e3a6c2',
    [userIds.mert]: '#93bce5',
  };
}
export function getReferenceCommunityIcons(): Record<string, string> {
  return { [spaceId]: '/__reference/01_brand/community-bizim-oda.svg' };
}

/** Explicit DEV-only state projection into the shared production SystemState component. */
export function getReferenceSystemState():
  import('../SystemState').SystemStateKind | 'splash' | null {
  const params = new URLSearchParams(location.search);
  if (params.get('fixture') !== 'S72') return null;
  const metadata = getReferenceFixtureMetadata('S72', params.get('variant') || 'default');
  return (metadata.variant === 'default' ? 'offline' : metadata.variant) as
    import('../SystemState').SystemStateKind | 'splash';
}

/** Explicit S71 local projection; native updater/download/install stays disabled. */
export function getReferenceAbout() {
  const params = new URLSearchParams(location.search);
  if (params.get('fixture') !== 'S71') return null;
  const { variant } = getReferenceFixtureMetadata('S71', params.get('variant') || 'default');
  const state: Awaited<
    ReturnType<import('@rooms/contracts').DesktopBridge['updates']['status']>
  >['state'] =
    variant === 'downloading'
      ? 'downloading'
      : variant === 'ready'
        ? 'ready'
        : variant === 'error'
          ? 'error'
          : 'available';
  return {
    info: { version: '0.8.3', platform: 'darwin', arch: 'arm64', electron: 'local-fixture' },
    status: {
      enabled: true,
      configured: true,
      state,
      version: '0.8.4',
      progress: variant === 'downloading' ? 62 : 0,
      reason: null,
      releaseNotes: [
        sample(
          'Ses odasına dönüşte bağlantı durumu daha açık gösteriliyor.',
          'The connection status is clearer when you return to a voice room.',
        ),
        sample(
          'Ortak kuyrukta klavyeyle sıralama kolaylaştırıldı.',
          'Reordering the shared queue with the keyboard is easier.',
        ),
        sample(
          'Asistan görevlerinde bağlantı hatası açıklamaları iyileştirildi.',
          'Connection error messages in assistant tasks are clearer.',
        ),
      ],
    },
    modal:
      variant === 'logs'
        ? ('logs' as const)
        : variant === 'licenses'
          ? ('licenses' as const)
          : null,
    content:
      variant === 'logs'
        ? 'DEMO · Local support projection\nNo actual reconnect or success is implied.\nMessage content, account keys and personal paths are absent.'
        : variant === 'licenses'
          ? 'Inter — SIL Open Font License 1.1\nROOMS reference icons — original SVG paths\nInstalled dependency notices are read from the actual desktop build.'
          : '',
  };
}

/** Read-only S70 fixture. No live bot, token or permission mutation is emulated. */
export function getReferenceAuthority() {
  const params = new URLSearchParams(location.search);
  if (params.get('fixture') !== 'S70') return null;
  const { variant } = getReferenceFixtureMetadata('S70', params.get('variant') || 'default');
  const authority: import('../../../../packages/agent-contracts/src').AgentAuthoritySnapshot = {
    userId: userIds.deniz,
    roomId: channelIds.general,
    canManage: variant !== 'permission',
    yolo: false,
    principals: [users.deniz, users.ece, users.can, users.zeynep].map((u, i) => ({
      userId: u.id,
      canManage: i === 0,
      canStart: true,
    })),
    scopes: [
      { kind: 'github', read: true, write: true, resources: ['film-night-notes'] },
      { kind: 'drive', read: true, write: true, resources: ['film-night-plan'] },
      { kind: 'room', read: true, write: true, resources: [channelIds.general] },
    ],
    discord: {
      state: variant === 'discord_disconnected' ? 'not-configured' : 'configured',
      mentionOnly: true,
      mappings:
        variant === 'discord_disconnected'
          ? []
          : [
              { userId: userIds.deniz, channelId: 'rooms-asistan', personalModel: 'selected' },
              { userId: userIds.ece, channelId: 'rooms-asistan', personalModel: 'private' },
            ],
    },
    permissionsMutable: false,
    configurationSource: 'server-admin',
  };
  const audit: import('../../../../packages/agent-contracts/src').AgentAuditSnapshot = {
    scope: variant === 'permission' ? 'own' : 'room',
    roomId: channelIds.general,
    entries: [
      {
        at: '2026-10-10T18:10:00Z',
        userId: userIds.deniz,
        action: 'yolo-enabled',
        roomId: channelIds.general,
        taskId: null,
      },
      {
        at: '2026-10-10T18:05:00Z',
        userId: userIds.deniz,
        action: 'task-failed',
        roomId: channelIds.general,
        taskId: null,
      },
      {
        at: '2026-10-10T18:04:00Z',
        userId: userIds.deniz,
        action: 'operation-approved',
        roomId: channelIds.general,
        taskId: null,
      },
      {
        at: '2026-10-10T17:58:00Z',
        userId: userIds.ece,
        action: 'memory-deleted',
        roomId: channelIds.general,
        taskId: null,
      },
      {
        at: '2026-10-10T17:50:00Z',
        userId: userIds.deniz,
        action: 'task-completed',
        roomId: channelIds.general,
        taskId: null,
      },
    ],
    limited: false,
  };
  return {
    authority,
    audit,
    names: Object.fromEntries(Object.values(users).map((u) => [u.id, u.displayName])),
    tab:
      variant === 'history'
        ? ('history' as const)
        : variant.startsWith('discord')
          ? ('discord' as const)
          : ('permissions' as const),
  };
}
