export * from './dm-call';
export type ConnectionStatus =
  'not-configured' | 'connecting' | 'connected' | 'reconnecting' | 'error';
export type ActivityState =
  'idle' | 'preparing' | 'live' | 'paused' | 'recovering' | 'ended' | 'error';
export type ActivityCategory = 'watch' | 'share' | 'play' | 'together';
export interface ActivityManifest {
  id: string;
  version: number;
  label: string;
  category: ActivityCategory;
  kind: 'shared-player' | 'live-stream' | 'collaborative' | 'game';
  capabilities: ('timeline' | 'queue' | 'host-control' | 'voice' | 'reactions' | 'participants')[];
  supportedPlatforms: ('windows' | 'macos')[];
  availability: 'local' | 'requires-setup' | 'later';
  description: string;
}
export type ActivityPayload =
  | { type: 'cinema'; source: 'bundled-demo' | 'local-file'; title: string }
  | {
      type: 'poll';
      question: string;
      options: { id: string; label: string }[];
      votes: Record<string, string>;
    };
export interface ActivitySession {
  id: string;
  roomId: string;
  activityId: string;
  hostUserId: string;
  controllerUserId: string | null;
  revision: number;
  state: ActivityState;
  startedAt: string;
  payload: ActivityPayload;
}
export interface ChannelNotificationScope {
  serverUrl: string;
  userId: string;
}
export interface ChannelNotificationInput extends ChannelNotificationScope {
  channelId: string;
  muted?: boolean;
}
export interface DesktopWindowPreferences {
  keepOpenOnClose: boolean;
  warnOnVoiceClose: boolean;
  trayAvailable: boolean;
}
export interface YouTubeDetails {
  playable: true;
  embeddable: boolean;
  title: string;
  author: string;
  durationSec: number | null;
}
export interface DesktopBridge {
  remoteControl?: import('./remote-control').RemoteControlBridge;
  hostOps?: import('./hostops').HostOpsBridge;
  soundboard?: import('./soundboard').SoundboardBridge;
  personalSounds?: import('./personal-sounds').PersonalSoundsBridge;
  /** Collaborative Studio projects (op log + long poll); absent in fixtures and old preloads. */
  studio?: import('./studio').StudioBridge;
  desktopWindow: {
    status(): Promise<DesktopWindowPreferences>;
    setPreference(
      key: 'keepOpenOnClose' | 'warnOnVoiceClose',
      value: boolean,
    ): Promise<DesktopWindowPreferences>;
  };
  /** Interface language held by the main process; fixed until the window reloads. */
  locale?: { preference: 'system' | 'tr' | 'en'; resolved: 'tr' | 'en' };
  setLocale?(preference: 'system' | 'tr' | 'en'): Promise<void>;
  pendingInvite(): Promise<{ serverUrl: string; code: string } | null>;
  onInvite(listener: (invite: { serverUrl: string; code: string }) => void): () => void;
  platform: 'darwin' | 'win32' | 'linux';
  windowAction(action: 'minimize' | 'maximize' | 'close' | 'fullscreen'): Promise<void>;
  setAlwaysOnTop(value: boolean): Promise<void>;
  loginItemStatus(): Promise<boolean>;
  setLoginItem(value: boolean): Promise<boolean>;
  chooseMedia(): Promise<{ url: string; name: string } | null>;
  releaseMedia(url: string): Promise<void>;
  chooseCaption(mediaUrl: string): Promise<{ content: string; name: string } | null>;
  openMediaExternal(url: string): Promise<boolean>;
  applicationInfo(): Promise<{ version: string; platform: string; arch: string; electron: string }>;
  /** Unread mentions and conversations on the Dock or launcher icon (0 clears it). */
  setBadge?(count: number): Promise<void>;
  diagnosticsPreview(): Promise<string>;
  thirdPartyNotices(): Promise<string>;
  exportDiagnostics(): Promise<boolean>;
  notifications: {
    channelStatus(input: ChannelNotificationInput): Promise<{ muted: boolean }>;
    setChannelMuted(
      input: ChannelNotificationInput & { muted: boolean },
    ): Promise<{ muted: boolean }>;
    status(): Promise<{
      enabled: boolean;
      sound: boolean;
      pauseDuringVoice: boolean;
      supported: boolean;
    }>;
    setOptIn(
      value: boolean,
    ): Promise<{ enabled: boolean; sound: boolean; pauseDuringVoice: boolean; supported: boolean }>;
    setSound(
      value: boolean,
    ): Promise<{ enabled: boolean; sound: boolean; pauseDuringVoice: boolean; supported: boolean }>;
    setPauseDuringVoice(
      value: boolean,
    ): Promise<{ enabled: boolean; sound: boolean; pauseDuringVoice: boolean; supported: boolean }>;
    setVoiceActive(value: boolean): Promise<void>;
    /** A content-free OS notification for an incoming private call (not while focused). */
    incomingCall?(): Promise<void>;
    /** A programme reminder the member set themselves (not while focused). */
    reminder?(input: { title: string; detail: string }): Promise<void>;
  };
  social: SocialBridge;
  music: {
    lyrics(channelId: string, trackId: string): Promise<import('./music-lyrics').MusicLyrics>;
    playlists(channelId: string): Promise<import('./music-playlists').SharedPlaylist[]>;
    changePlaylist(
      channelId: string,
      change: import('./music-playlists').PlaylistChange,
    ): Promise<import('./music-playlists').SharedPlaylist[]>;
    history(channelId: string): Promise<import('./music').MusicHistorySession[]>;
    snapshot(channelId: string): Promise<import('./music').MusicSnapshot>;
    command(
      channelId: string,
      command: import('./music').MusicCommand,
    ): Promise<import('./music').MusicSnapshot>;
    search(channelId: string, query: string): Promise<import('./music').MusicSearchResult[]>;
  };
  dmCalls: import('./dm-call').DmCallBridge;
  updates: {
    status(): Promise<import('../../../apps/desktop/electron/updates').UpdateStatus>;
    setOptIn(
      value: boolean,
    ): Promise<import('../../../apps/desktop/electron/updates').UpdateStatus>;
    check(): Promise<import('../../../apps/desktop/electron/updates').UpdateStatus>;
    download(): Promise<import('../../../apps/desktop/electron/updates').UpdateStatus>;
    cancel(): Promise<import('../../../apps/desktop/electron/updates').UpdateStatus>;
    install(): Promise<void>;
  };
  providers: import('../../../apps/desktop/electron/provider-contracts').ProviderBridge;
  /** Community cinema hall; absent in dev fixtures and older preload scripts. */
  cinema?: import('../../community-cinema/src/bridge').CinemaBridge;
  agent: import('@rooms/agent-contracts').AgentBridge;
  activity: {
    exportBoard(roomId: string, format?: 'svg' | 'png'): Promise<boolean>;
    youtubePlaylist(playlistId: string): Promise<{ url: string; nonce: string }>;
    /**
     * Public title and whether the official embedded player may show it. `embeddable: false`
     * videos still play on youtube.com; `playable: false` ones are private or removed.
     */
    youtubeDetails?(videoId: string): Promise<YouTubeDetails | { playable: false } | null>;
    /** `minimal` hides YouTube's own controls; Tayfa draws the shared ones. */
    youtubePlayer(
      videoId: string,
      chrome?: 'minimal' | 'native',
    ): Promise<{ url: string; nonce: string }>;
    snapshot(
      roomId: string,
      afterRevision?: number,
    ): Promise<import('@rooms/activity-protocol').ActivityResponse>;
    command(
      roomId: string,
      envelope: import('@rooms/activity-protocol').ActivityCommandEnvelope,
    ): Promise<import('@rooms/activity-protocol').ActivityResponse>;
  };
  media: {
    directory?(channelIds: string[]): Promise<{
      rooms: {
        channelId: string;
        participants: {
          id: string;
          name: string;
          muted: boolean;
          screen?: boolean;
          deafened?: boolean;
        }[];
      }[];
    }>;
    /** Shares this user's deafen state with the room; false when the server lacks support. */
    deafen?(channelId: string, deafened: boolean): Promise<boolean>;
    /** GIF search through the community server (KLIPY); media comes from static.klipy.com. */
    gifs?(
      query: string,
      page: number,
    ): Promise<{
      items: {
        id: string;
        title: string;
        preview: { url: string; width: number; height: number };
        gif: { url: string; width: number; height: number };
      }[];
      more: boolean;
    }>;
    /** Moves someone to another voice room, or disconnects them; needs Move Members. */
    moderate?(input: {
      channelId: string;
      userId: string;
      action: 'disconnect' | 'move';
      targetChannelId?: string;
    }): Promise<void>;
    grant(
      channelId: string,
    ): Promise<{ serverUrl: string; roomName: string; token: string; expiresAt: string }>;
    presenter(
      channelId: string,
      action: 'acquire' | 'release',
    ): Promise<{ granted: true; leaseId: string } | { released: true }>;
    screenState(channelId: string): Promise<ScreenPresenterState>;
    requestScreen(
      channelId: string,
      leaseId: string,
      requestId: string,
    ): Promise<{ request: ScreenPresenterRequest }>;
    cancelScreenRequest(
      channelId: string,
      leaseId: string,
      requestId: string,
    ): Promise<{ cancelled: true }>;
    decideScreenRequest(
      channelId: string,
      leaseId: string,
      requestId: string,
      approve: boolean,
    ): Promise<{ approved: boolean; awaitingRelease: boolean }>;
    leave(channelId: string): Promise<void>;
    captureSources(): Promise<{ id: string; name: string; thumbnail: string }[]>;
    selectCaptureSource(id: string, options?: { audio: boolean }): Promise<void>;
    clearCaptureSource(): Promise<void>;
    /** Opens youtube.com in the user's browser and offers that window as the next source. */
    openBrowserVideo?(videoId: string, title: string): Promise<{ id: string; name: string } | null>;
    captureStatus(): Promise<{
      microphone: string;
      camera: string;
      screen: string;
      systemAudio: boolean;
    }>;
  };
}
export interface ScreenPresenterRequest {
  requestId: string;
  userId: string;
  leaseId: string;
  createdAt: number;
  expiresAt: number;
}
export interface ScreenPresenterReservation {
  requestId: string;
  userId: string;
  leaseId: string;
  expiresAt: number;
  released: boolean;
}
export interface ScreenPresenterState {
  presenter: { userId: string; leaseId: string } | null;
  requests: ScreenPresenterRequest[];
  reservation: ScreenPresenterReservation | null;
}
export interface SocialSession {
  instanceUrl: string | null;
  user: import('@rooms/social').SocialUser | null;
  status: ConnectionStatus;
  remembered: boolean;
  /**
   * Why a saved session is not in use: the server refused it (`expired`), or it could not be
   * reached at launch and is retried (`unreachable`).
   */
  restore?: 'expired' | 'unreachable' | null;
  sessionEpoch?: number;
}
export interface SocialPasswordRecoveryCapabilities {
  emailEnabled: boolean;
  captcha: { required: boolean; siteKey: string | null };
}
export interface SocialBridge {
  session(): Promise<SocialSession>;
  login(input: { serverUrl: string; email: string; password: string }): Promise<SocialSession>;
  register(input: {
    serverUrl: string;
    email: string;
    password: string;
    username: string;
    inviteCode: string;
    accountInviteCode?: string;
  }): Promise<SocialSession>;
  /**
   * Approved sign-up without an invitation link; see docs/SELF_HOSTING.md. A request creates no
   * account; after approval the account is created through the invitation registration.
   */
  signupAvailable(serverUrl: string): Promise<boolean>;
  requestSignup(input: {
    serverUrl: string;
    email: string;
    password: string;
    username: string;
  }): Promise<import('@rooms/social').SocialPendingSignup>;
  pendingSignup(): Promise<import('@rooms/social').SocialPendingSignup | null>;
  checkSignup(): Promise<{
    pending: import('@rooms/social').SocialPendingSignup | null;
    session: SocialSession | null;
  }>;
  completeSignup(input: { email?: string; password: string }): Promise<SocialSession>;
  cancelSignup(): Promise<void>;
  signupRequests(spaceId: string): Promise<import('@rooms/social').SocialSignupRequests>;
  decideSignupRequest(
    spaceId: string,
    requestId: string,
    decision: 'approve' | 'reject',
  ): Promise<void>;
  passwordRecoveryCapabilities(serverUrl: string): Promise<SocialPasswordRecoveryCapabilities>;
  requestPasswordRecovery(input: { serverUrl: string; email: string }): Promise<{ accepted: true }>;
  importPasswordRecoveryLink(input: {
    serverUrl: string;
  }): Promise<{ handle: string; expiresAt: number; serverOrigin: string }>;
  confirmPasswordRecovery(input: { serverUrl: string; handle: string; password: string }): Promise<{
    state:
      | 'completed'
      | 'invalid-token'
      | 'selection-expired'
      | 'rejected'
      | 'uncertain'
      | 'scope-changed';
  }>;
  cancelPasswordRecovery(input: { handle: string }): Promise<void>;
  logout(): Promise<void>;
  spaces(): Promise<import('@rooms/social').SocialSpace[]>;
  createSpace(name: string): Promise<import('@rooms/social').SocialSpace>;
  renameSpace(spaceId: string, name: string): Promise<import('@rooms/social').SocialSpace>;
  channels(spaceId: string): Promise<import('@rooms/social').SocialChannel[]>;
  createChannel(
    spaceId: string,
    name: string,
    type: 'text' | 'voice',
  ): Promise<import('@rooms/social').SocialChannel>;
  renameChannel(channelId: string, name: string): Promise<import('@rooms/social').SocialChannel>;
  deleteChannel(channelId: string): Promise<void>;
  cachedMessages(channelId: string): Promise<import('@rooms/social').SocialMessage[]>;
  messages(channelId: string, before?: string): Promise<import('@rooms/social').SocialMessage[]>;
  send(
    channelId: string,
    content: string,
    attachmentIds?: string[],
  ): Promise<import('@rooms/social').SocialMessage>;
  edit(
    channelId: string,
    messageId: string,
    content: string,
  ): Promise<import('@rooms/social').SocialMessage>;
  delete(channelId: string, messageId: string): Promise<void>;
  createInvite(channelId: string): Promise<import('@rooms/social').SocialInvite>;
  listInvites(spaceId: string): Promise<import('@rooms/social').SocialInviteLinkSummary[]>;
  revokeInvite(spaceId: string, inviteId: string): Promise<void>;
  inspectInvite(serverUrl: string, code: string): Promise<import('@rooms/social').SocialInvite>;
  acceptInvite(code: string): Promise<import('@rooms/social').SocialInvite>;
  attachmentImage(channelId: string, messageId: string, fileId: string): Promise<string | null>;
  /** Video bytes for inline playback (MP4, WebM, QuickTime), or null for other files. */
  attachmentVideo(
    channelId: string,
    messageId: string,
    fileId: string,
  ): Promise<{ mime: string; bytes: Uint8Array } | null>;
  downloadAttachment(channelId: string, messageId: string, fileId: string): Promise<boolean>;
  avatar(userId: string): Promise<string | null>;
  chooseAvatar(): Promise<import('@rooms/social').SocialUser | null>;
  channelPermissions(channelId: string): Promise<import('@rooms/social').SocialChannelPermissions>;
  setChannelPermissions(
    change: import('@rooms/social').SocialChannelPermissionChange,
  ): Promise<import('@rooms/social').SocialChannelPermissions>;
  communityManagement(spaceId: string): Promise<import('@rooms/social').SocialCommunityManagement>;
  changeCommunityRole(
    change: import('@rooms/social').SocialCommunityRoleChange,
  ): Promise<import('@rooms/social').SocialCommunityRoleResult>;
  setMemberRoles(
    change: import('@rooms/social').SocialMemberRoleChange,
  ): Promise<import('@rooms/social').SocialCommunityManagement>;
  removeCommunityMember(
    change: import('@rooms/social').SocialMemberRemoval,
  ): Promise<import('@rooms/social').SocialCommunityManagement>;
  /** Bans a member below this account's rank; they cannot rejoin until unbanned. */
  banCommunityMember?(
    change: import('@rooms/social').SocialMemberRemoval,
  ): Promise<import('@rooms/social').SocialCommunityManagement>;
  /** The community's name, description, icon and banner for its settings page. */
  spaceProfile?(spaceId: string): Promise<import('@rooms/social').SocialSpaceProfile>;
  updateSpaceProfile?(change: {
    spaceId: string;
    name: string;
    description: string;
  }): Promise<import('@rooms/social').SocialSpaceProfile>;
  /** Opens a file picker and uploads the chosen icon or banner; null when cancelled. */
  chooseSpaceImage?(
    spaceId: string,
    kind: 'icon' | 'banner',
  ): Promise<import('@rooms/social').SocialSpaceProfile | null>;
  removeSpaceImage?(
    spaceId: string,
    kind: 'icon' | 'banner',
  ): Promise<import('@rooms/social').SocialSpaceProfile>;
  /** This account's moderation rights in a community, without listing members. */
  communityCapabilities?(
    spaceId: string,
  ): Promise<import('@rooms/social').SocialCommunityManagement['capabilities']>;
  members(spaceId: string): Promise<import('@rooms/social').SocialMember[]>;
  friends(): Promise<import('@rooms/social').SocialFriend[]>;
  addFriend(username: string): Promise<void>;
  removeFriend(id: string): Promise<void>;
  updateProfile(input: {
    displayName: string;
    bio?: string;
    statusText?: string;
  }): Promise<import('@rooms/social').SocialUser>;
  react(channelId: string, messageId: string, emoji: string, remove?: boolean): Promise<void>;
  discardAttachment(id: string): Promise<void>;
  chooseAttachment(
    channelId: string,
  ): Promise<{ id: string; name: string; size: number; mime: string } | null>;
  dropAttachment(
    channelId: string,
    name: string,
    data: Uint8Array,
  ): Promise<{ id: string; name: string; size: number; mime: string }>;
  pasteAttachment(
    channelId: string,
  ): Promise<{ id: string; name: string; size: number; mime: string } | null>;
  dms(): Promise<import('@rooms/social').SocialChannel[]>;
  createDM(recipientId: string): Promise<import('@rooms/social').SocialChannel>;
  blockUser(userId: string): Promise<void>;
  unblockUser(userId: string): Promise<void>;
  removeMember(spaceId: string, userId: string): Promise<void>;
  ackRead(channelId: string, messageId: string): Promise<void>;
  readStates(): Promise<import('@rooms/social').SocialReadState[]>;
  presence(status: 'online' | 'idle' | 'dnd' | 'invisible'): Promise<void>;
  /** Bio, status text and presence as stored on the server, for Settings to start from. */
  ownProfile?(): Promise<{
    bio: string;
    statusText: string;
    presence: 'online' | 'idle' | 'dnd' | 'invisible';
  }>;
  typing(channelId: string, active: boolean): Promise<boolean>;
  onEvent(listener: (event: import('@rooms/social').GatewayEvent) => void): () => void;
}
