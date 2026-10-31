import { contextBridge, ipcRenderer } from 'electron';
import type { DesktopBridge } from '@rooms/contracts';
const bridge: DesktopBridge = {
  hostOps: {
    hosts: () => ipcRenderer.invoke('rooms:hostops-hosts'),
    snapshot: (id) => ipcRenderer.invoke('rooms:hostops-snapshot', id),
    history: (id, range) => ipcRenderer.invoke('rooms:hostops-history', id, range),
    operators: (id) => ipcRenderer.invoke('rooms:hostops-operators', id),
    setOperator: (id, grant) => ipcRenderer.invoke('rooms:hostops-operator', id, grant),
    thresholds: (id, value) => ipcRenderer.invoke('rooms:hostops-thresholds', id, value),
    acknowledge: (id, ids) => ipcRenderer.invoke('rooms:hostops-ack', id, ids),
    terminals: (id) => ipcRenderer.invoke('rooms:hostops-terminals', id),
    createTerminal: (id) => ipcRenderer.invoke('rooms:hostops-create-terminal', id),
    terminalAction: (id, session, action, target) =>
      ipcRenderer.invoke('rooms:hostops-terminal-action', id, session, action, target),
    attach: (id, session) => ipcRenderer.invoke('rooms:hostops-attach', id, session),
    send: (input) => ipcRenderer.invoke('rooms:hostops-send', input),
    detach: () => ipcRenderer.invoke('rooms:hostops-detach'),
    onTerminal: (listener) => {
      const handler = (
        _event: Electron.IpcRendererEvent,
        value: import('../../../packages/shared-contracts/src/hostops').TerminalEvent,
      ) => listener(value);
      ipcRenderer.on('rooms:hostops-terminal', handler);
      return () => ipcRenderer.removeListener('rooms:hostops-terminal', handler);
    },
  },
  locale: ipcRenderer.sendSync('rooms:locale'),
  setLocale: (preference) => ipcRenderer.invoke('rooms:set-locale', preference),
  pendingInvite: () => ipcRenderer.invoke('rooms:pending-invite'),
  onInvite: (listener) => {
    const handler = (
      _event: Electron.IpcRendererEvent,
      invite: { serverUrl: string; code: string },
    ) => listener(invite);
    ipcRenderer.on('rooms:invite-link', handler);
    return () => ipcRenderer.removeListener('rooms:invite-link', handler);
  },
  platform: process.platform as DesktopBridge['platform'],
  windowAction: (action) => ipcRenderer.invoke('rooms:window', action),
  windowState: () => ipcRenderer.invoke('rooms:window-state'),
  onWindowState: (listener) => {
    const handler = (
      _event: Electron.IpcRendererEvent,
      state: { maximized: boolean; fullscreen: boolean },
    ) => listener(state);
    ipcRenderer.on('rooms:window-state', handler);
    return () => ipcRenderer.removeListener('rooms:window-state', handler);
  },
  setWindowTheme: (theme) => ipcRenderer.invoke('rooms:window-theme', theme),
  setAlwaysOnTop: (value) => ipcRenderer.invoke('rooms:always-on-top', value),
  loginItemStatus: () => ipcRenderer.invoke('rooms:login-item-status'),
  setLoginItem: (value) => ipcRenderer.invoke('rooms:login-item', value),
  chooseMedia: () => ipcRenderer.invoke('rooms:choose-media'),
  releaseMedia: (url: string) => ipcRenderer.invoke('rooms:release-media', url),
  chooseCaption: (mediaUrl: string) => ipcRenderer.invoke('rooms:choose-caption', mediaUrl),
  openMediaExternal: (url) => ipcRenderer.invoke('rooms:external-media', url),
  applicationInfo: () => ipcRenderer.invoke('rooms:application-info'),
  setBadge: (count) => ipcRenderer.invoke('rooms:set-badge', count),
  diagnosticsPreview: () => ipcRenderer.invoke('rooms:diagnostics-preview'),
  thirdPartyNotices: () => ipcRenderer.invoke('rooms:third-party-notices'),
  exportDiagnostics: () => ipcRenderer.invoke('rooms:export-diagnostics'),
  dmCalls: {
    poll: () => ipcRenderer.invoke('rooms:dm-call-poll'),
    start: (dmId, mode) => ipcRenderer.invoke('rooms:dm-call-start', { dmId, mode }),
    respond: (callId, action) => ipcRenderer.invoke('rooms:dm-call-respond', { callId, action }),
    grant: (callId) => ipcRenderer.invoke('rooms:dm-call-grant', { callId }),
  },
  social: {
    session: () => ipcRenderer.invoke('rooms:social-session'),
    login: (input) => ipcRenderer.invoke('rooms:social-login', input),
    register: (input) => ipcRenderer.invoke('rooms:social-register', input),
    signupAvailable: (serverUrl) => ipcRenderer.invoke('rooms:social-signup-available', serverUrl),
    requestSignup: (input) => ipcRenderer.invoke('rooms:social-signup-request', input),
    pendingSignup: () => ipcRenderer.invoke('rooms:social-signup-pending'),
    checkSignup: () => ipcRenderer.invoke('rooms:social-signup-check'),
    completeSignup: (input) => ipcRenderer.invoke('rooms:social-signup-complete', input),
    cancelSignup: () => ipcRenderer.invoke('rooms:social-signup-cancel'),
    signupRequests: (spaceId) => ipcRenderer.invoke('rooms:social-signup-requests', spaceId),
    decideSignupRequest: (spaceId, requestId, decision) =>
      ipcRenderer.invoke('rooms:social-signup-decide', spaceId, requestId, decision),
    passwordRecoveryCapabilities: (serverUrl) =>
      ipcRenderer.invoke('rooms:social-password-recovery-capabilities', serverUrl),
    requestPasswordRecovery: (input) =>
      ipcRenderer.invoke('rooms:social-password-recovery-request', input),
    importPasswordRecoveryLink: (input) =>
      ipcRenderer.invoke('rooms:social-password-recovery-import', input),
    confirmPasswordRecovery: (input) =>
      ipcRenderer.invoke('rooms:social-password-recovery-confirm', input),
    cancelPasswordRecovery: (input) =>
      ipcRenderer.invoke('rooms:social-password-recovery-cancel', input),
    logout: () => ipcRenderer.invoke('rooms:social-logout'),
    spaces: () => ipcRenderer.invoke('rooms:social-spaces'),
    createSpace: (name) => ipcRenderer.invoke('rooms:social-create-space', name),
    renameSpace: (spaceId, name) => ipcRenderer.invoke('rooms:social-rename-space', spaceId, name),
    createChannel: (spaceId, name, type) =>
      ipcRenderer.invoke('rooms:social-create-channel', spaceId, name, type),
    renameChannel: (id, name) => ipcRenderer.invoke('rooms:social-rename-channel', id, name),
    deleteChannel: (id) => ipcRenderer.invoke('rooms:social-delete-channel', id),
    channelPermissions: (id) => ipcRenderer.invoke('rooms:social-channel-permissions', id),
    setChannelPermissions: (change) =>
      ipcRenderer.invoke('rooms:social-set-channel-permissions', change),
    communityManagement: (spaceId) =>
      ipcRenderer.invoke('rooms:social-community-management', spaceId),
    changeCommunityRole: (change) =>
      ipcRenderer.invoke('rooms:social-change-community-role', change),
    setMemberRoles: (change) => ipcRenderer.invoke('rooms:social-set-member-roles', change),
    removeCommunityMember: (change) =>
      ipcRenderer.invoke('rooms:social-remove-community-member', change),
    banCommunityMember: (change) => ipcRenderer.invoke('rooms:social-ban-community-member', change),
    communityCapabilities: (spaceId) =>
      ipcRenderer.invoke('rooms:social-community-capabilities', spaceId),
    spaceProfile: (spaceId) => ipcRenderer.invoke('rooms:social-space-profile', spaceId),
    updateSpaceProfile: (change) => ipcRenderer.invoke('rooms:social-update-space-profile', change),
    chooseSpaceImage: (spaceId, kind) =>
      ipcRenderer.invoke('rooms:social-choose-space-image', spaceId, kind),
    removeSpaceImage: (spaceId, kind) =>
      ipcRenderer.invoke('rooms:social-remove-space-image', spaceId, kind),
    channels: (id) => ipcRenderer.invoke('rooms:social-channels', id),
    cachedMessages: (id) => ipcRenderer.invoke('rooms:social-cached-messages', id),
    messages: (id, before) => ipcRenderer.invoke('rooms:social-messages', id, before),
    send: (id, content, attachmentIds) =>
      ipcRenderer.invoke('rooms:social-send', id, content, attachmentIds),
    edit: (channel, id, content) => ipcRenderer.invoke('rooms:social-edit', channel, id, content),
    delete: (channel, id) => ipcRenderer.invoke('rooms:social-delete', channel, id),
    createInvite: (id) => ipcRenderer.invoke('rooms:social-create-invite', id),
    listInvites: (spaceId) => ipcRenderer.invoke('rooms:social-list-invites', spaceId),
    revokeInvite: (spaceId, inviteId) =>
      ipcRenderer.invoke('rooms:social-revoke-invite', spaceId, inviteId),
    inspectInvite: (url, code) => ipcRenderer.invoke('rooms:social-inspect-invite', url, code),
    acceptInvite: (code) => ipcRenderer.invoke('rooms:social-accept-invite', code),
    attachmentImage: (channel, message, file) =>
      ipcRenderer.invoke('rooms:social-attachment-image', channel, message, file),
    attachmentVideo: (channel, message, file) =>
      ipcRenderer.invoke('rooms:social-attachment-video', channel, message, file),
    downloadAttachment: (channel, message, file) =>
      ipcRenderer.invoke('rooms:social-download-attachment', channel, message, file),
    avatar: (userId) => ipcRenderer.invoke('rooms:social-avatar', userId),
    chooseAvatar: () => ipcRenderer.invoke('rooms:social-choose-avatar'),
    readStates: () => ipcRenderer.invoke('rooms:social-read-states'),
    members: (spaceId) => ipcRenderer.invoke('rooms:social-members', spaceId),
    friends: () => ipcRenderer.invoke('rooms:social-friends'),
    addFriend: (username) => ipcRenderer.invoke('rooms:social-add-friend', username),
    removeFriend: (id) => ipcRenderer.invoke('rooms:social-remove-friend', id),
    updateProfile: (input) => ipcRenderer.invoke('rooms:social-profile', input),
    react: (channel, message, emoji, remove) =>
      ipcRenderer.invoke('rooms:social-react', channel, message, emoji, remove),
    discardAttachment: (id) => ipcRenderer.invoke('rooms:social-discard-attachment', id),
    chooseAttachment: (channel) => ipcRenderer.invoke('rooms:social-choose-attachment', channel),
    dropAttachment: (channel, name, data) =>
      ipcRenderer.invoke('rooms:social-drop-attachment', channel, name, data),
    pasteAttachment: (channel) => ipcRenderer.invoke('rooms:social-paste-attachment', channel),
    dms: () => ipcRenderer.invoke('rooms:social-dms'),
    createDM: (id) => ipcRenderer.invoke('rooms:social-create-dm', id),
    blockUser: (id) => ipcRenderer.invoke('rooms:social-block', id),
    unblockUser: (id) => ipcRenderer.invoke('rooms:social-unblock', id),
    removeMember: (space, id) => ipcRenderer.invoke('rooms:social-remove-member', space, id),
    ackRead: (channel, id) => ipcRenderer.invoke('rooms:social-ack', channel, id),
    typing: (channel, active) => ipcRenderer.invoke('rooms:social-typing', channel, active),
    presence: (status) => ipcRenderer.invoke('rooms:social-presence', status),
    ownProfile: () => ipcRenderer.invoke('rooms:social-own-profile'),
    onEvent: (listener) => {
      const handler = (
        _event: Electron.IpcRendererEvent,
        event: import('@rooms/social').GatewayEvent,
      ) => listener(event);
      ipcRenderer.on('rooms:social-event', handler);
      return () => {
        ipcRenderer.removeListener('rooms:social-event', handler);
      };
    },
  },
  soundboard: {
    list: (id) => ipcRenderer.invoke('rooms:soundboard-list', id),
    upload: (id, input) => ipcRenderer.invoke('rooms:soundboard-upload', id, input),
    read: (id, clip) => ipcRenderer.invoke('rooms:soundboard-read', id, clip),
    remove: (id, clip) => ipcRenderer.invoke('rooms:soundboard-remove', id, clip),
    rename: (id, clip, name) => ipcRenderer.invoke('rooms:soundboard-rename', id, clip, name),
  },
  globalShortcuts: {
    set: (shortcuts) => ipcRenderer.invoke('rooms:global-shortcuts-set', shortcuts),
    onTrigger: (listener) => {
      const handler = (_event: Electron.IpcRendererEvent, action: 'mute' | 'deafen') =>
        listener(action);
      ipcRenderer.on('rooms:global-shortcut', handler);
      return () => ipcRenderer.removeListener('rooms:global-shortcut', handler);
    },
  },
  personalSounds: {
    profile: () => ipcRenderer.invoke('rooms:personal-sounds-profile'),
    upload: (input) => ipcRenderer.invoke('rooms:personal-sounds-upload', input),
    remove: (soundId) => ipcRenderer.invoke('rooms:personal-sounds-remove', soundId),
    assign: (value) => ipcRenderer.invoke('rooms:personal-sounds-assign', value),
    preview: (soundId) => ipcRenderer.invoke('rooms:personal-sounds-preview', soundId),
    read: (channelId, userId, soundId) =>
      ipcRenderer.invoke('rooms:personal-sounds-read', channelId, userId, soundId),
  },
  music: {
    lyrics: (channel, track) => ipcRenderer.invoke('rooms:music-lyrics', channel, track),
    playlists: (channel) => ipcRenderer.invoke('rooms:music-playlists', channel),
    changePlaylist: (channel, change) =>
      ipcRenderer.invoke('rooms:music-playlist-change', channel, change),
    history: (channelId) => ipcRenderer.invoke('rooms:music-history', channelId),
    snapshot: (channelId) => ipcRenderer.invoke('rooms:music-snapshot', channelId),
    command: (channelId, command) => ipcRenderer.invoke('rooms:music-command', channelId, command),
    search: (channelId, query) => ipcRenderer.invoke('rooms:music-search', channelId, query),
  },
  activity: {
    exportBoard: (roomId, format) => ipcRenderer.invoke('rooms:export-board', roomId, format),
    youtubePlaylist: (playlistId) => ipcRenderer.invoke('rooms:youtube-playlist', playlistId),
    youtubeDetails: (videoId) => ipcRenderer.invoke('rooms:youtube-details', videoId),
    youtubePlayer: (videoId, chrome) => ipcRenderer.invoke('rooms:youtube-player', videoId, chrome),
    snapshot: (roomId, afterRevision) =>
      ipcRenderer.invoke('rooms:activity-snapshot', roomId, afterRevision),
    command: (roomId, envelope) => ipcRenderer.invoke('rooms:activity-command', roomId, envelope),
  },
  studio: {
    list: (roomId) => ipcRenderer.invoke('rooms:studio-list', roomId),
    create: (roomId, input) => ipcRenderer.invoke('rooms:studio-create', roomId, input),
    remove: (roomId, projectId) => ipcRenderer.invoke('rooms:studio-remove', roomId, projectId),
    sync: (roomId, projectId, afterSeq, waitMs) =>
      ipcRenderer.invoke('rooms:studio-sync', roomId, projectId, afterSeq, waitMs),
    ops: (roomId, projectId, batch) =>
      ipcRenderer.invoke('rooms:studio-ops', roomId, projectId, batch),
    presence: (roomId, projectId, state) =>
      ipcRenderer.invoke('rooms:studio-presence', roomId, projectId, state),
    saveExport: (fileName, wav) => ipcRenderer.invoke('rooms:studio-save-export', fileName, wav),
  },
  updates: {
    status: () => ipcRenderer.invoke('rooms:update-status'),
    setOptIn: (value) => ipcRenderer.invoke('rooms:update-opt-in', value),
    check: () => ipcRenderer.invoke('rooms:update-check'),
    download: () => ipcRenderer.invoke('rooms:update-download'),
    cancel: () => ipcRenderer.invoke('rooms:update-cancel'),
    install: () => ipcRenderer.invoke('rooms:update-install'),
  },
  desktopWindow: {
    status: () => ipcRenderer.invoke('rooms:desktop-window-status'),
    setPreference: (key, value) =>
      ipcRenderer.invoke('rooms:desktop-window-preference', key, value),
  },
  notifications: {
    channelStatus: (input) => ipcRenderer.invoke('rooms:notification-channel-status', input),
    setChannelMuted: (input) => ipcRenderer.invoke('rooms:notification-channel-mute', input),
    status: () => ipcRenderer.invoke('rooms:notification-status'),
    setOptIn: (value) => ipcRenderer.invoke('rooms:notification-opt-in', value),
    setImportant: (value) => ipcRenderer.invoke('rooms:notification-important', value),
    setSound: (value) => ipcRenderer.invoke('rooms:notification-sound', value),
    setPauseDuringVoice: (value) => ipcRenderer.invoke('rooms:notification-pause-voice', value),
    setVoiceActive: (value) => ipcRenderer.invoke('rooms:notification-voice-active', value),
    incomingCall: () => ipcRenderer.invoke('rooms:notification-incoming-call'),
    reminder: (input) => ipcRenderer.invoke('rooms:notification-reminder', input),
  },
  providers: {
    nativePlayer: {
      status: () => ipcRenderer.invoke('rooms:provider-native-status'),
      start: (url) => ipcRenderer.invoke('rooms:provider-native-start', url),
      state: (token) => ipcRenderer.invoke('rooms:provider-native-state', token),
      bounds: (token, rect) => ipcRenderer.invoke('rooms:provider-native-bounds', token, rect),
      control: (token, input) => ipcRenderer.invoke('rooms:provider-native-control', token, input),
      stop: (token) => ipcRenderer.invoke('rooms:provider-native-stop', token),
    },
    recentChannels: (id) => ipcRenderer.invoke('rooms:provider-recent-channels', id),
    acknowledgePlayback: (url) => ipcRenderer.invoke('rooms:provider-acknowledge-playback', url),
    updatePlaylist: (input) => ipcRenderer.invoke('rooms:provider-playlist-update', input),
    updateXtream: (input) => ipcRenderer.invoke('rooms:provider-xtream-update', input),
    rdCancel: () => ipcRenderer.invoke('rooms:provider-rd-cancel'),
    pickPlaylist: () => ipcRenderer.invoke('rooms:provider-pick-playlist'),
    playlistFile: (input) => ipcRenderer.invoke('rooms:provider-playlist-file', input),
    saveResume: (url, position) => ipcRenderer.invoke('rooms:provider-resume', url, position),
    status: () => ipcRenderer.invoke('rooms:provider-status'),
    connectPlaylist: (input) => ipcRenderer.invoke('rooms:provider-playlist', input),
    connectXtream: (input) => ipcRenderer.invoke('rooms:provider-xtream', input),
    epg: (id, channel) => ipcRenderer.invoke('rooms:provider-epg', id, channel),
    guide: (id, channels) => ipcRenderer.invoke('rooms:provider-guide', id, channels),
    channels: (id) => ipcRenderer.invoke('rooms:provider-channels', id),
    favorite: (id, channel, value) =>
      ipcRenderer.invoke('rooms:provider-favorite', id, channel, value),
    play: (id, channel) => ipcRenderer.invoke('rooms:provider-play', id, channel),
    disconnect: (id) => ipcRenderer.invoke('rooms:provider-disconnect', id),
    rdStart: () => ipcRenderer.invoke('rooms:provider-rd-start'),
    rdPoll: () => ipcRenderer.invoke('rooms:provider-rd-poll'),
    rdLibrary: () => ipcRenderer.invoke('rooms:provider-rd-library'),
    rdPlay: (id) => ipcRenderer.invoke('rooms:provider-rd-play', id),
  },
  cinema: {
    status: (communityId) => ipcRenderer.invoke('rooms:cinema-status', communityId),
    setHall: (communityId, channelId) =>
      ipcRenderer.invoke('rooms:cinema-set-hall', communityId, channelId),
    connect: (communityId, source) =>
      ipcRenderer.invoke('rooms:cinema-connect', communityId, source),
    disconnect: (communityId) => ipcRenderer.invoke('rooms:cinema-disconnect', communityId),
    reload: (communityId, scope) => ipcRenderer.invoke('rooms:cinema-reload', communityId, scope),
    categories: (hallId, kind) => ipcRenderer.invoke('rooms:cinema-categories', hallId, kind),
    items: (hallId, query) => ipcRenderer.invoke('rooms:cinema-items', hallId, query),
    search: (hallId, text, kinds) => ipcRenderer.invoke('rooms:cinema-search', hallId, text, kinds),
    youtubeSearch: (hallId, text) =>
      ipcRenderer.invoke('rooms:cinema-youtube-search', hallId, text),
    guide: (hallId, refs, from, to) =>
      ipcRenderer.invoke('rooms:cinema-guide', hallId, refs, from, to),
    details: (hallId, ref) => ipcRenderer.invoke('rooms:cinema-details', hallId, ref),
    watch: (hallId) => ipcRenderer.invoke('rooms:cinema-watch', hallId),
    setAudio: (hallId, ref, track) => ipcRenderer.invoke('rooms:cinema-audio', hallId, ref, track),
    setSubtitleKey: (communityId, key) =>
      ipcRenderer.invoke('rooms:cinema-subtitle-key', communityId, key),
    setAudioDefault: (communityId, value) =>
      ipcRenderer.invoke('rooms:cinema-audio-default', communityId, value),
    setTmdbKey: (communityId, key) => ipcRenderer.invoke('rooms:cinema-tmdb-key', communityId, key),
    titleLinks: (hallId, ref) => ipcRenderer.invoke('rooms:cinema-links', hallId, ref),
    subtitles: (hallId, ref) => ipcRenderer.invoke('rooms:cinema-subtitles', hallId, ref),
    chooseSubtitleFile: () => ipcRenderer.invoke('rooms:cinema-subtitle-file'),
    continueWatching: (hallId, kind) => ipcRenderer.invoke('rooms:cinema-continue', hallId, kind),
    favorites: (hallId) => ipcRenderer.invoke('rooms:cinema-favorites', hallId),
    setFavorite: (hallId, ref, on) => ipcRenderer.invoke('rooms:cinema-favorite', hallId, ref, on),
    episodeMarks: (hallId, ref) => ipcRenderer.invoke('rooms:cinema-episode-marks', hallId, ref),
    markEpisode: (hallId, ref, watched) =>
      ipcRenderer.invoke('rooms:cinema-mark-episode', hallId, ref, watched),
    rmdb: (hallId) => ipcRenderer.invoke('rooms:cinema-rmdb', hallId),
    rmdbWork: (hallId, workId) => ipcRenderer.invoke('rooms:cinema-rmdb-work', hallId, workId),
    rmdbAdd: (hallId, ref, watchlist) =>
      ipcRenderer.invoke('rooms:cinema-rmdb-add', hallId, ref, watchlist),
    rmdbReview: (hallId, workId, review) =>
      ipcRenderer.invoke('rooms:cinema-rmdb-review', hallId, workId, review),
    rmdbRemoveReview: (hallId, workId, userId) =>
      ipcRenderer.invoke('rooms:cinema-rmdb-remove-review', hallId, workId, userId),
    rmdbWatchlist: (hallId, workId, on) =>
      ipcRenderer.invoke('rooms:cinema-rmdb-watchlist', hallId, workId, on),
    rmdbLog: (hallId, workId, watchedAt) =>
      ipcRenderer.invoke('rooms:cinema-rmdb-log', hallId, workId, watchedAt),
    rmdbRemoveLog: (hallId, workId, entryId) =>
      ipcRenderer.invoke('rooms:cinema-rmdb-remove-log', hallId, workId, entryId),
    rmdbRemove: (hallId, workId) => ipcRenderer.invoke('rooms:cinema-rmdb-remove', hallId, workId),
    stremioLinkStart: (communityId) => ipcRenderer.invoke('rooms:cinema-stremio-link', communityId),
    stremioLinkPoll: (communityId) => ipcRenderer.invoke('rooms:cinema-stremio-poll', communityId),
    stremioUnlink: (communityId) => ipcRenderer.invoke('rooms:cinema-stremio-unlink', communityId),
    stremioHome: (hallId) => ipcRenderer.invoke('rooms:cinema-stremio-home', hallId),
    stremioSearch: (hallId, text) =>
      ipcRenderer.invoke('rooms:cinema-stremio-search', hallId, text),
    stremioCatalog: (hallId, key, genre, skip) =>
      ipcRenderer.invoke('rooms:cinema-stremio-catalog', hallId, key, genre, skip),
    stremioDetails: (hallId, type, id) =>
      ipcRenderer.invoke('rooms:cinema-stremio-details', hallId, type, id),
    stremioStreams: (hallId, type, id, videoId) =>
      ipcRenderer.invoke('rooms:cinema-stremio-streams', hallId, type, id, videoId),
    stremioPick: (hallId, streamId) =>
      ipcRenderer.invoke('rooms:cinema-stremio-pick', hallId, streamId),
    stremioAssist: (hallId, type, id, videoId) =>
      ipcRenderer.invoke('rooms:cinema-stremio-assist', hallId, type, id, videoId),
    stremioPickLocal: (hallId, streamId) =>
      ipcRenderer.invoke('rooms:cinema-stremio-pick-local', hallId, streamId),
  },
  remoteControl: {
    register: (room, track) => ipcRenderer.invoke('rooms:remote-register', room, track),
    state: (room) => ipcRenderer.invoke('rooms:remote-state', room),
    request: (room, peer, epoch) => ipcRenderer.invoke('rooms:remote-request', room, peer, epoch),
    decide: (room, id, approve) => ipcRenderer.invoke('rooms:remote-decide', room, id, approve),
    revoke: () => ipcRenderer.invoke('rooms:remote-revoke'),
    frame: (value, leaseId) => ipcRenderer.invoke('rooms:remote-frame', value, leaseId),
    receive: (value) => ipcRenderer.invoke('rooms:remote-receive', value),
  },
  agent: {
    workspace: {
      terminals: (id) => ipcRenderer.invoke('rooms:agent-workspace-terminals', id),
      take: (id) => ipcRenderer.invoke('rooms:agent-workspace-take', id),
      close: (id, session) => ipcRenderer.invoke('rooms:agent-workspace-close', id, session),
      resume: (id) => ipcRenderer.invoke('rooms:agent-workspace-resume', id),
      attach: (id, session) => ipcRenderer.invoke('rooms:agent-workspace-attach', id, session),
      send: (value) => ipcRenderer.invoke('rooms:agent-workspace-send', value),
      detach: () => ipcRenderer.invoke('rooms:agent-workspace-detach'),
      onTerminal: (listener) => {
        const handler = (
          _event: Electron.IpcRendererEvent,
          value: import('../../../packages/shared-contracts/src/hostops').TerminalEvent,
        ) => listener(value);
        ipcRenderer.on('rooms:agent-workspace-event', handler);
        return () => ipcRenderer.removeListener('rooms:agent-workspace-event', handler);
      },
    },
    previewArtifact: (taskId, artifactId) =>
      ipcRenderer.invoke('rooms:agent-artifact-preview', taskId, artifactId),
    authority: (roomId) => ipcRenderer.invoke('rooms:agent-authority', roomId),
    audit: (roomId) => ipcRenderer.invoke('rooms:agent-audit', roomId),
    configure: (input) => ipcRenderer.invoke('rooms:agent-configure', input),
    status: () => ipcRenderer.invoke('rooms:agent-status'),
    tasks: (room) => ipcRenderer.invoke('rooms:agent-tasks', room),
    submit: (input) => ipcRenderer.invoke('rooms:agent-submit', input),
    remind: (input) => ipcRenderer.invoke('rooms:agent-remind', input),
    cancel: (id) => ipcRenderer.invoke('rooms:agent-cancel', id),
    approve: (id) => ipcRenderer.invoke('rooms:agent-approve', id),
    resolveOperation: (id, input) => ipcRenderer.invoke('rooms:agent-resolve-operation', id, input),
    connections: () => ipcRenderer.invoke('rooms:agent-connections'),
    connectModel: (input) => ipcRenderer.invoke('rooms:agent-connect-model', input),
    disconnectModel: (id) => ipcRenderer.invoke('rooms:agent-disconnect-model', id),
    yolo: (value) => ipcRenderer.invoke('rooms:agent-yolo', value),
    memory: (room) => ipcRenderer.invoke('rooms:agent-memory', room),
    saveMemory: (input) => ipcRenderer.invoke('rooms:agent-save-memory', input),
    deleteMemory: (id) => ipcRenderer.invoke('rooms:agent-delete-memory', id),
    downloadArtifact: (task, id) => ipcRenderer.invoke('rooms:agent-artifact', task, id),
  },
  media: {
    directory: (channelIds) => ipcRenderer.invoke('rooms:media-directory', channelIds),
    deafen: (id, deafened) => ipcRenderer.invoke('rooms:media-deafen', id, deafened),
    moderate: (input) => ipcRenderer.invoke('rooms:media-moderate', input),
    gifs: (query, page) => ipcRenderer.invoke('rooms:gif-search', query, page),
    grant: (id) => ipcRenderer.invoke('rooms:media-grant', id),
    presenter: (id, action) => ipcRenderer.invoke('rooms:media-presenter', id, action),
    screenState: (id) => ipcRenderer.invoke('rooms:media-screen-state', id),
    requestScreen: (channelId, leaseId, requestId) =>
      ipcRenderer.invoke('rooms:media-screen-request', { channelId, leaseId, requestId }),
    cancelScreenRequest: (channelId, leaseId, requestId) =>
      ipcRenderer.invoke('rooms:media-screen-request-cancel', { channelId, leaseId, requestId }),
    decideScreenRequest: (channelId, leaseId, requestId, approve) =>
      ipcRenderer.invoke('rooms:media-screen-request-decide', {
        channelId,
        leaseId,
        requestId,
        approve,
      }),
    leave: (id) => ipcRenderer.invoke('rooms:media-leave', id),
    captureSources: () => ipcRenderer.invoke('rooms:capture-sources'),
    selectCaptureSource: (id, options) => ipcRenderer.invoke('rooms:capture-select', id, options),
    clearCaptureSource: () => ipcRenderer.invoke('rooms:capture-clear'),
    openBrowserVideo: (videoId, title) =>
      ipcRenderer.invoke('rooms:capture-browser-video', videoId, title),
    captureStatus: () => ipcRenderer.invoke('rooms:capture-status'),
  },
};
contextBridge.exposeInMainWorld('rooms', bridge);
