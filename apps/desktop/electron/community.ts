import { t } from '@rooms/i18n';
import { loadMusicLyrics } from './music-lyrics';
import { CinemaRequestError, setupCommunityCinema } from './community-cinema';
import { setupHostOps } from './hostops';
import {
  playlistCatalogSchema,
  playlistChangeSchema,
} from '../../../packages/shared-contracts/src/music-playlists';
import { setupRemoteControl } from './remote-control';
import { randomUUID } from 'node:crypto';
import {
  soundboardCatalogSchema,
  soundboardClipSchema,
} from '../../../packages/shared-contracts/src/soundboard';
import {
  PERSONAL_SOUND_LIMITS,
  personalSoundAssignSchema,
  personalSoundIdSchema,
  personalSoundProfileSchema,
  personalSoundSchema,
  personalSoundUploadSchema,
  personalSoundUserIdSchema,
} from '../../../packages/shared-contracts/src/personal-sounds';
import {
  musicCommandSchema,
  musicSnapshotSchema,
  musicSearchQuerySchema,
  musicSearchResultsSchema,
  musicHistorySchema,
  musicFailedSongSchema,
} from '../../../packages/shared-contracts/src/music';
import { release } from 'node:os';
import { enumerateCaptureSources, CaptureSourcesError } from './capture-sources';
import { displayMediaStreams, systemAudioSupport } from './system-audio';
import { findBrowserWindow } from './browser-video';
import { ConversationVault } from './conversation-vault';
import { PasswordRecoveryBroker } from './password-recovery';
import { PendingSignupBroker, type SignupRegistration } from './signup-broker';
import { requestDmCall } from './dm-call-http';
import {
  dmCallStartSchema,
  dmCallActionSchema,
  dmCallIdSchema,
  type DmCallSession,
} from '../../../packages/shared-contracts/src/dm-call';
import {
  app,
  clipboard,
  dialog,
  desktopCapturer,
  ipcMain,
  safeStorage,
  session,
  shell,
  systemPreferences,
  BrowserWindow,
  type IpcMainInvokeEvent,
  type DesktopCapturerSource,
} from 'electron';
import { fileURLToPath } from 'node:url';
import {
  readFileSync,
  writeFileSync,
  existsSync,
  unlinkSync,
  statSync,
  openSync,
  readSync,
  closeSync,
  fstatSync,
} from 'node:fs';
import { join, basename, extname } from 'node:path';
import { z } from 'zod';
import { StoatClient, StoatError } from '@rooms/stoat';
import {
  SOCIAL_ID_PATTERN,
  SOCIAL_REACTION_PATTERN,
  SOCIAL_ROLE_PERMISSION_KEYS,
  type SocialUser,
  type SocialMember,
  type GatewayEvent,
} from '@rooms/social';
import type { SocialSession } from '@rooms/contracts';
import { postActivityCommand, getActivitySnapshot } from './activity-http';

class SocialInputError extends Error {}
/** Approved sign-up created the account, but its session could not start. */
class AccountCreatedError extends SocialInputError {}

export async function setupCommunity(
  getWindow: () => BrowserWindow | null,
  assertSender: (event: IpcMainInvokeEvent) => void,
  isTrusted: (url: string) => boolean,
  onIncomingMessage: (
    scope: { serverUrl: string; userId: string },
    channelId: string,
    mentioned?: boolean,
    open?: () => void,
  ) => void = () => {},
  onServerAlert: (message: string, open: () => void) => void = () => {},
) {
  let dmNativeEpoch = 0;
  let pendingDmCall: { client: StoatClient; id: string } | null = null;
  const closeDmCall = async () => {
    ++dmNativeEpoch;
    const previous = pendingDmCall;
    pendingDmCall = null;
    if (previous)
      await requestDmCall(previous.client, 'respond', { callId: previous.id, action: 'end' }).catch(
        () => {},
      );
  };
  let client: StoatClient | null = null;
  let user: SocialUser | null = null;
  let remembered = false;
  let unsubscribe: (() => void) | null = null;
  let authRequestEpoch = 0;
  let sessionEpoch = 0;
  /** Aborted at every account change so long polls of the previous session end at once. */
  let sessionRequests = new AbortController();
  const endSessionRequests = () => {
    sessionRequests.abort();
    sessionRequests = new AbortController();
  };
  let recoveryEpoch = 0;
  const uploadedAttachments = new Map<
    string,
    { channelId: string; name: string; size: number; mime: string }
  >();
  let activePresenceSpace: string | null = null;
  const subscribePresence = () => {
    if (activePresenceSpace && getWindow()?.isFocused())
      client?.subscribePresence(activePresenceSpace);
  };
  const presenceTimer = setInterval(subscribePresence, 5 * 60000);
  presenceTimer.unref();
  app.on('browser-window-created', (_event, window) =>
    window.on('focus', () => {
      if (window === getWindow()) subscribePresence();
    }),
  );
  const audioSupport = () => systemAudioSupport(process.platform, release());
  const supportsSystemAudio = () => audioSupport().supported;
  let selectedAudio = false;
  let selected: DesktopCapturerSource | null = null;
  let selectedAt = 0;
  let activeCapture: { epoch: string; displayId: string } | null = null;
  let activeCaptureScope: StoatClient | null = null;
  let choices: DesktopCapturerSource[] = [];
  let choicesAt = 0;
  const conversationVault = new ConversationVault(app.getPath('userData'), safeStorage);
  const vault = join(app.getPath('userData'), 'stoat-session-v1.bin');
  const auth = z
    .object({
      serverUrl: z.string().max(2048),
      email: z.string().email().max(254),
      password: z.string().min(1).max(256),
    })
    .strict();
  const registration = auth.extend({
    username: z.string().min(2).max(32),
    inviteCode: z.string().regex(/^[a-zA-Z0-9_-]{2,128}$/),
    accountInviteCode: z
      .string()
      .regex(/^[a-zA-Z0-9_-]{2,128}$/)
      .optional(),
  });
  const signupRequest = auth.extend({
    password: z.string().min(8).max(256),
    username: z
      .string()
      .trim()
      .min(2)
      .max(32)
      .regex(/^[\p{L}\d_.-]+$/u),
  });
  const signupCompletion = z
    .object({ email: z.string().email().max(254).optional(), password: z.string().min(8).max(256) })
    .strict();
  const recoveryServer = z.string().min(1).max(2048);
  const recoveryInput = z
    .object({ serverUrl: recoveryServer, email: z.string().email().max(254) })
    .strict();
  let recoveryPending = false;
  const id = z.string().regex(SOCIAL_ID_PATTERN);
  const code = z.string().regex(/^[a-zA-Z0-9_-]{2,128}$/);
  const content = z.string().trim().min(1).max(4000);
  const messageContent = z.string().trim().max(4000);
  const fixtureWindow = () =>
    !app.isPackaged &&
    new URL(getWindow()?.webContents.getURL() || 'about:blank').searchParams.has('fixture');
  const emit = (event: GatewayEvent) => {
    const win = getWindow();
    if (win && !win.webContents.isDestroyed() && !fixtureWindow())
      win.webContents.send('rooms:social-event', { ...event, sessionEpoch });
  };
  /**
   * A saved session whose server could not be reached at launch (offline, DNS, 5xx). The token
   * is kept and the restore retried, so a short outage does not look like being signed out.
   */
  let pendingRestore: { url: string; token: string } | null = null;
  /** Why the saved session is not in use: the server refused it, or it is still unreachable. */
  let restoreState: 'expired' | 'unreachable' | null = null;
  const snapshot = (): SocialSession => ({
    instanceUrl: client?.instanceUrl ?? pendingRestore?.url ?? null,
    user,
    status:
      client?.status ??
      (pendingRestore ? 'reconnecting' : restoreState === 'expired' ? 'error' : 'not-configured'),
    remembered: remembered || !!pendingRestore,
    restore: restoreState,
    sessionEpoch,
  });
  function bind(next: StoatClient, generation: number) {
    // Any session in use supersedes a saved one still waiting for its server.
    pendingRestore = null;
    restoreState = null;
    if (client && client !== next) void closeDmCall();
    unsubscribe?.();
    client = next;
    const deliveredMessages = new Set<string>();
    unsubscribe = client.subscribe((event) => {
      if (client !== next || generation !== sessionEpoch) return;
      if (event.type === 'AUTH_EXPIRED') {
        conversationVault.clear();
        recoveryEpoch++;
        passwordReset.clear();
      }
      if (event.type === 'READY') subscribePresence();
      if (event.type === 'CHANNEL_ACCESS_INVALIDATED') {
        const ids = (event.data as { channelIds: string[] }).channelIds;
        for (const channelId of ids) conversationVault.remove(channelId);
        for (const [fileId, file] of uploadedAttachments)
          if (ids.includes(file.channelId)) uploadedAttachments.delete(fileId);
      }
      if (event.type === 'MESSAGE_CREATE' || event.type === 'MESSAGE_UPDATE')
        conversationVault.change(event.data as import('@rooms/social').SocialMessage);
      if (event.type === 'MESSAGE_DELETE') {
        const d = event.data as { id: string; channel_id: string };
        conversationVault.deleteMessage(d.channel_id, d.id);
      }
      if (event.type === 'MESSAGE_CREATE') {
        const message = event.data as {
            id?: string;
            author?: { id?: unknown };
            channelId?: unknown;
            mentions?: string[];
          },
          authorId = message.author?.id;
        if (
          user &&
          typeof message.id === 'string' &&
          !deliveredMessages.has(message.id) &&
          typeof authorId === 'string' &&
          authorId !== user.id &&
          typeof message.channelId === 'string' &&
          SOCIAL_ID_PATTERN.test(message.channelId)
        ) {
          deliveredMessages.add(message.id);
          if (deliveredMessages.size > 2000)
            deliveredMessages.delete(deliveredMessages.values().next().value!);
          const channelId = message.channelId;
          onIncomingMessage(
            { serverUrl: next.instanceUrl, userId: user.id },
            channelId,
            message.mentions?.includes(user.id) ?? false,
            () => {
              if (client === next) emit({ type: 'OPEN_CHANNEL', data: { channelId } });
            },
          );
        }
      }
      if (
        [
          'READY',
          'RESUMED',
          'CONNECTION_STATUS',
          'AUTH_EXPIRED',
          'MESSAGE_CREATE',
          'MESSAGE_UPDATE',
          'PRESENCE_UPDATE',
          'SOCIAL_REFRESH',
          'MESSAGE_ACK',
          'READ_STATE_SYNC',
          'READ_STATE_UNAVAILABLE',
          'TYPING_UPDATE',
          'CHANNEL_ACCESS_INVALIDATED',
        ].includes(event.type)
      )
        emit(event);
      else if (event.type === 'MESSAGE_DELETE') {
        const raw = event.data as Record<string, unknown>;
        emit({
          type: event.type,
          data: { id: String(raw.id), channel_id: String(raw.channel_id) },
        });
      } else if (event.type === 'PRESENCE_UPDATE') {
        const raw = event.data as { user?: { id?: string }; status?: string; guild_id?: string };
        emit({
          type: event.type,
          data: { userId: raw.user?.id, status: raw.status, guildId: raw.guild_id },
        });
      } else if (
        [
          'GUILD_CREATE',
          'GUILD_DELETE',
          'CHANNEL_CREATE',
          'CHANNEL_UPDATE',
          'CHANNEL_DELETE',
          'RELATIONSHIP_ADD',
          'RELATIONSHIP_REMOVE',
          'GUILD_MEMBER_REMOVE',
        ].includes(event.type)
      )
        emit({ type: 'SOCIAL_REFRESH', data: null });
    });
  }
  const remember = () => {
    remembered = false;
    if (!client?.getToken() || !safeStorage.isEncryptionAvailable()) {
      if (existsSync(vault)) unlinkSync(vault);
      return;
    }
    writeFileSync(
      vault,
      safeStorage.encryptString(
        JSON.stringify({
          provider: 'stoat',
          version: 1,
          url: client.instanceUrl,
          token: client.getToken(),
        }),
      ),
      { mode: 0o600 },
    );
    remembered = true;
  };
  const requireClient = () => {
    if (!client || !user) throw new StoatError(401, 'SIGN_IN_REQUIRED');
    return client;
  };
  const hostOps = setupHostOps(
    () => {
      if (fixtureWindow())
        throw new SocialInputError('Native host access is disabled in development fixtures.');
      return requireClient();
    },
    getWindow,
    assertSender,
    (message) => onServerAlert(message, () => emit({ type: 'OPEN_SERVER_SETTINGS', data: null })),
  );
  const handle = (name: string, handler: (...args: unknown[]) => unknown) =>
    ipcMain.handle(name, async (event, ...args) => {
      assertSender(event);
      try {
        if (fixtureWindow())
          throw new SocialInputError('Native account access is disabled in development fixtures.');
        const scoped = ![
          'rooms:social-session',
          'rooms:social-login',
          'rooms:social-register',
          'rooms:social-signup-available',
          'rooms:social-signup-request',
          'rooms:social-signup-pending',
          'rooms:social-signup-check',
          'rooms:social-signup-complete',
          'rooms:social-signup-cancel',
          'rooms:social-logout',
          'rooms:social-password-recovery-capabilities',
          'rooms:social-password-recovery-request',
        ].includes(name);
        const owner = client,
          ownerId = user?.id;
        const result = await handler(...args);
        if (scoped && (client !== owner || user?.id !== ownerId))
          throw new SocialInputError(
            'The account changed. Retry this action in the current account.',
          );
        return result;
      } catch (error) {
        if (
          error instanceof StoatError ||
          error instanceof SocialInputError ||
          error instanceof CaptureSourcesError
        )
          throw new Error(error.message);
        if (error instanceof z.ZodError) throw new Error('Check the supplied fields and retry.');
        throw new Error(
          'This operation could not complete. Check your server, permissions, and connection.',
        );
      }
    });
  handle('rooms:social-session', () => snapshot());
  handle('rooms:social-read-states', () => requireClient().readStates());
  const cinema = setupCommunityCinema({
    openExternal: (url) => shell.openExternal(url),
    handle: (name, handler) =>
      handle(name, async (...args) => {
        try {
          return await handler(...args);
        } catch (error) {
          throw error instanceof CinemaRequestError ? new SocialInputError(error.message) : error;
        }
      }),
    account: () => {
      const current = requireClient();
      return {
        client: current,
        token: current.getToken()!,
        origin: new URL(current.instanceUrl).origin,
      };
    },
    isCurrent: (account) =>
      client === account.client && account.client.getToken() === account.token,
  });
  const replaceSession = async (next: StoatClient, nextUser: SocialUser, request: number) => {
    if (request !== authRequestEpoch) {
      await next.disconnect().catch(() => {});
      throw new SocialInputError('A newer account change has replaced this sign-in.');
    }
    const previous = client;
    const generation = ++sessionEpoch;
    endSessionRequests();
    unsubscribe?.();
    unsubscribe = null;
    client = null;
    user = null;
    activePresenceSpace = null;
    uploadedAttachments.clear();
    remembered = false;
    if (existsSync(vault)) unlinkSync(vault);
    // The saved session is gone with the vault; a restore still retrying must not bring it back.
    pendingRestore = null;
    restoreState = null;
    await closeDmCall();
    await previous?.disconnect();
    if (request !== authRequestEpoch) {
      await next.disconnect().catch(() => {});
      throw new SocialInputError('A newer account change has replaced this sign-in.');
    }
    bind(next, generation);
    user = nextUser;
    conversationVault.select(next.instanceUrl, nextUser.id);
    remember();
    await next.connect();
    if (request !== authRequestEpoch || client !== next)
      throw new SocialInputError('A newer account change has replaced this sign-in.');
    return snapshot();
  };
  handle('rooms:social-login', async (input) => {
    recoveryEpoch++;
    passwordReset.clear();
    const request = ++authRequestEpoch;
    const body = auth.parse(input);
    const next = new StoatClient(body.serverUrl);
    try {
      return await replaceSession(next, await next.login(body.email, body.password), request);
    } catch (error) {
      if (client !== next) await next.disconnect().catch(() => {});
      throw error;
    }
  });
  handle('rooms:social-register', async (input) => {
    recoveryEpoch++;
    passwordReset.clear();
    const request = ++authRequestEpoch;
    const body = registration.parse(input);
    const next = new StoatClient(body.serverUrl);
    try {
      return await replaceSession(next, await next.register(body), request);
    } catch (error) {
      if (client !== next) await next.disconnect().catch(() => {});
      throw error;
    }
  });
  handle('rooms:social-signup-available', (serverUrl) =>
    new StoatClient(recoveryServer.parse(serverUrl)).signupAvailable(),
  );
  // Approved sign-up: no account exists until an admin approves. The password stays in this
  // process's memory; the poll secret and the approved link are kept with safeStorage.
  const signups = new PendingSignupBroker({
    path: join(app.getPath('userData'), 'signup-request-v1.bin'),
    storage: safeStorage,
    client: (serverUrl) => new StoatClient(serverUrl),
  });
  /** Runs the existing invitation registration with the approved single-use link. */
  const completeSignup = async (registration: SignupRegistration) => {
    recoveryEpoch++;
    passwordReset.clear();
    const request = ++authRequestEpoch;
    const next = new StoatClient(registration.serverUrl);
    let created: SocialUser;
    try {
      created = await next.register(registration);
    } catch (error) {
      await next.disconnect().catch(() => {});
      signups.failed(error instanceof Error ? error.message : 'REGISTRATION_UNCERTAIN');
      throw error;
    }
    // The account exists and the single-use link is spent: forget the request (and password)
    // now, so a failed session start below cannot leave a request that only fails again.
    signups.completed();
    try {
      return await replaceSession(next, created, request);
    } catch (error) {
      if (client === next) throw error;
      await next.disconnect().catch(() => {});
      throw new AccountCreatedError(
        t('Hesabın oluştu ama oturum açılamadı. {email} ile giriş yap.', {
          email: registration.email,
        }),
      );
    }
  };
  handle('rooms:social-signup-request', async (input) =>
    signups.request(signupRequest.parse(input)),
  );
  handle('rooms:social-signup-pending', () => signups.snapshot());
  handle('rooms:social-signup-check', async () => {
    const { pending, registration } = await signups.check();
    if (!registration) return { pending, session: null };
    try {
      return { pending: null, session: await completeSignup(registration) };
    } catch (error) {
      // The request is gone once the account exists; say so instead of closing silently.
      if (error instanceof AccountCreatedError) throw error;
      return { pending: signups.snapshot(), session: null };
    }
  });
  handle('rooms:social-signup-complete', async (input) => {
    const body = signupCompletion.parse(input);
    const registration = signups.registration(body);
    if (!registration) throw new SocialInputError(t('Bu istek için onaylı kayıt bağlantısı yok.'));
    return completeSignup(registration);
  });
  handle('rooms:social-signup-cancel', () => signups.cancel());
  handle('rooms:social-signup-requests', (spaceId) =>
    requireClient().listSignupRequests(id.parse(spaceId)),
  );
  handle('rooms:social-signup-decide', (spaceId, requestId, decision) =>
    requireClient().decideSignupRequest(
      id.parse(spaceId),
      z
        .string()
        .regex(/^[a-f0-9]{32}$/)
        .parse(requestId),
      z.enum(['approve', 'reject']).parse(decision),
    ),
  );
  handle('rooms:social-password-recovery-capabilities', (serverUrl) =>
    new StoatClient(recoveryServer.parse(serverUrl)).passwordRecoveryCapabilities(),
  );
  handle('rooms:social-password-recovery-request', async (input) => {
    const body = recoveryInput.parse(input);
    if (recoveryPending)
      throw new SocialInputError(t('Kurtarma isteği sürüyor. Tamamlanmasını bekle.'));
    recoveryPending = true;
    try {
      // Isolated client: no current-session mutation, stored session, gateway, or renderer reset secret.
      const recovery = new StoatClient(body.serverUrl),
        capabilities = await recovery.passwordRecoveryCapabilities();
      if (!capabilities.emailEnabled)
        throw new SocialInputError(t('Sunucuda kurtarma e-postası yapılandırılmamış.'));
      if (capabilities.captcha.required)
        throw new SocialInputError(
          t('Sunucu hCaptcha doğrulaması istiyor. Kurtarmayı Stoat web uygulamasından başlat.'),
        );
      return await recovery.requestPasswordRecovery({ email: body.email });
    } finally {
      recoveryPending = false;
    }
  });
  const passwordReset = new PasswordRecoveryBroker({
    readClipboard: () => clipboard.readText(),
    sessionEpoch: () => recoveryEpoch + sessionEpoch,
  });
  for (const operation of ['import', 'confirm', 'cancel'] as const) {
    ipcMain.handle(`rooms:social-password-recovery-${operation}`, async (event, input) => {
      assertSender(event);
      if (fixtureWindow())
        throw new Error('Native account access is disabled in development fixtures.');
      try {
        if (operation === 'import') return await passwordReset.importLink(input, event.sender.id);
        if (operation === 'cancel') return passwordReset.cancel(input, event.sender.id);
        return await passwordReset.confirm(input, event.sender.id);
      } catch {
        throw new Error(
          operation === 'import'
            ? t('Seçili sunucunun kurtarma bağlantısını kopyalayıp yeniden dene.')
            : t('Parola kurtarma işlemi tamamlanamadı. Bağlantıyı yeniden seç.'),
        );
      }
    });
  }
  app.on('before-quit', () => {
    recoveryEpoch++;
    passwordReset.clear();
  });
  app.on('browser-window-created', (_event, window) =>
    window.on('closed', () => {
      recoveryEpoch++;
      if (!getWindow() || getWindow() === window) hostOps.close();
      passwordReset.clear();
    }),
  );
  handle('rooms:social-logout', async () => {
    pendingRestore = null;
    restoreState = null;
    conversationVault.clear();
    recoveryEpoch++;
    passwordReset.clear();
    ++authRequestEpoch;
    ++sessionEpoch;
    endSessionRequests();
    const previous = client;
    unsubscribe?.();
    unsubscribe = null;
    client = null;
    user = null;
    uploadedAttachments.clear();
    activePresenceSpace = null;
    remembered = false;
    selected = null;
    selectedAudio = false;
    choices = [];
    if (existsSync(vault)) unlinkSync(vault);
    await closeDmCall();
    await previous?.logout();
  });
  handle('rooms:social-spaces', () => requireClient().listSpaces());
  handle('rooms:social-create-space', (name) =>
    requireClient().createSpace(channelName.parse(name)),
  );
  handle('rooms:social-rename-space', (spaceId, name) =>
    requireClient().renameSpace(id.parse(spaceId), channelName.parse(name)),
  );
  handle('rooms:social-channels', async (spaceId) => {
    const parsed = id.parse(spaceId),
      current = requireClient(),
      owner = user!.id;
    const channels = await current.listChannels(parsed);
    if (client !== current || user?.id !== owner)
      throw new SocialInputError('The account changed. Reload its communities.');
    activePresenceSpace = parsed;
    current.subscribePresence(parsed);
    return channels;
  });
  const channelName = z
    .string()
    .trim()
    .min(1)
    .max(32)
    .refine((value) => !/[\x00-\x1f\x7f]/.test(value));
  handle('rooms:social-create-channel', (spaceId, name, type) =>
    requireClient().createChannel(
      id.parse(spaceId),
      channelName.parse(name),
      z.enum(['text', 'voice']).parse(type),
    ),
  );
  handle('rooms:social-rename-channel', (channelId, name) =>
    requireClient().renameChannel(id.parse(channelId), channelName.parse(name)),
  );
  handle('rooms:social-delete-channel', (channelId) =>
    requireClient().deleteChannel(id.parse(channelId)),
  );
  const aclValues = z
    .object({
      view: z.enum(['deny', 'inherit', 'allow']),
      send: z.enum(['deny', 'inherit', 'allow']),
      files: z.enum(['deny', 'inherit', 'allow']),
      manageMessages: z.enum(['deny', 'inherit', 'allow']),
      manageChannel: z.enum(['deny', 'inherit', 'allow']),
    })
    .strict();
  const aclChange = z
    .object({
      channelId: id,
      subject: z.discriminatedUnion('kind', [
        z.object({ kind: z.literal('default'), id: z.literal('default') }).strict(),
        z.object({ kind: z.literal('role'), id }).strict(),
      ]),
      values: aclValues,
    })
    .strict();
  handle('rooms:social-channel-permissions', async (channelId) => {
    const current = requireClient(),
      owner = user!.id,
      result = await current.channelPermissions(id.parse(channelId));
    if (client !== current || user?.id !== owner)
      throw new SocialInputError('The account changed. Open channel permissions again.');
    return result;
  });
  handle('rooms:social-set-channel-permissions', async (input) => {
    const current = requireClient(),
      owner = user!.id,
      result = await current.setChannelPermissions(aclChange.parse(input));
    if (client !== current || user?.id !== owner)
      throw new SocialInputError('The account changed. Open channel permissions again.');
    return result;
  });
  handle('rooms:social-cached-messages', (channelId) => {
    requireClient();
    return conversationVault.get(id.parse(channelId));
  });
  handle('rooms:social-messages', async (channelId, before) => {
    const owner = requireClient(),
      epoch = sessionEpoch,
      parsed = id.parse(channelId);
    const original = conversationVault.get(parsed),
      cacheTicket = conversationVault.ticket(parsed);
    const messages = await owner.listMessages(
      parsed,
      before === undefined ? undefined : id.parse(before),
    );
    if (
      client === owner &&
      sessionEpoch === epoch &&
      before === undefined &&
      cacheTicket === conversationVault.ticket(parsed)
    )
      conversationVault.reconcile(parsed, messages, original);
    return messages;
  });
  handle('rooms:social-send', async (channelId, text, attachments) => {
    const channel = id.parse(channelId);
    const attachmentIds = attachments === undefined ? [] : z.array(id).max(10).parse(attachments);
    const value = messageContent.parse(text);
    if (!value && !attachmentIds.length)
      throw new SocialInputError('Write a message or select an attachment.');
    if (attachmentIds.some((fileId) => uploadedAttachments.get(fileId)?.channelId !== channel))
      throw new SocialInputError('Select your attachment again in this conversation.');
    const message = await requireClient().sendMessage(channel, value, attachmentIds);
    for (const fileId of attachmentIds) uploadedAttachments.delete(fileId);
    return message;
  });
  const memberRoleChange = z
    .object({
      spaceId: id,
      userId: id,
      roleIds: z
        .array(id)
        .max(1000)
        .refine((ids) => new Set(ids).size === ids.length),
    })
    .strict();
  const memberRemoval = z.object({ spaceId: id, userId: id }).strict();
  handle('rooms:social-community-management', async (spaceId) => {
    const current = requireClient(),
      owner = user!.id,
      result = await current.communityManagement(id.parse(spaceId));
    if (client !== current || user?.id !== owner)
      throw new SocialInputError('The account changed. Open community management again.');
    return result;
  });
  const roleName = z
    .string()
    .trim()
    .min(1)
    .max(32)
    .regex(/^[^\x00-\x1f\x7f]+$/);
  const rolePermissionValues = z.record(
    z.enum(SOCIAL_ROLE_PERMISSION_KEYS),
    z.enum(['inherit', 'allow', 'deny']),
  );
  const roleChange = z.discriminatedUnion('action', [
    z.object({ action: z.literal('create'), spaceId: id, name: roleName }).strict(),
    z
      .object({
        action: z.literal('appearance'),
        spaceId: id,
        roleId: id,
        name: roleName,
        color: z
          .string()
          .regex(/^#[0-9a-f]{6}$/i)
          .nullable(),
      })
      .strict(),
    z
      .object({
        action: z.literal('permissions'),
        spaceId: id,
        roleId: id,
        values: rolePermissionValues,
      })
      .strict(),
    z.object({ action: z.literal('delete'), spaceId: id, roleId: id }).strict(),
  ]);
  handle('rooms:social-change-community-role', async (input) => {
    const current = requireClient(),
      owner = user!.id;
    const result = await current.changeCommunityRole(roleChange.parse(input));
    if (client !== current || user?.id !== owner)
      throw new SocialInputError('The account changed. Open community management again.');
    return result;
  });
  handle('rooms:social-set-member-roles', async (input) => {
    const current = requireClient(),
      owner = user!.id,
      result = await current.setCommunityMemberRoles(memberRoleChange.parse(input));
    if (client !== current || user?.id !== owner)
      throw new SocialInputError('The account changed. Open community management again.');
    return result;
  });
  handle('rooms:social-space-profile', (spaceId) =>
    requireClient().spaceProfile(id.parse(spaceId)),
  );
  handle('rooms:social-update-space-profile', async (input) => {
    const change = z
      .object({
        spaceId: id,
        name: z.string().trim().min(1).max(32),
        description: z.string().max(1024),
      })
      .strict()
      .parse(input);
    return requireClient().updateSpaceProfile(change.spaceId, {
      name: change.name,
      description: change.description,
    });
  });
  const spaceImageKind = z.enum(['icon', 'banner']);
  /** Reads a chosen community image; the type comes from its bytes, never its name. */
  function readSpaceImage(path: string, limit: number) {
    const file = openSync(path, 'r');
    try {
      const stat = fstatSync(file);
      if (!stat.isFile() || stat.size < 12 || stat.size > limit)
        throw new SocialInputError(
          t('Görsel en fazla {size} MB olabilir.', {
            size: Math.floor((limit / 1_000_000) * 10) / 10,
          }),
        );
      const bytes = Buffer.alloc(stat.size);
      if (readSync(file, bytes, 0, bytes.length, 0) !== bytes.length)
        throw new SocialInputError(t('Görsel okunamadı.'));
      const mime = bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
        ? 'image/png'
        : bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255
          ? 'image/jpeg'
          : bytes.toString('ascii', 0, 4) === 'RIFF' && bytes.toString('ascii', 8, 12) === 'WEBP'
            ? 'image/webp'
            : bytes.toString('ascii', 0, 4) === 'GIF8'
              ? 'image/gif'
              : null;
      if (!mime) throw new SocialInputError(t('PNG, JPEG, WebP ya da GIF bir görsel seç.'));
      return { bytes: new Uint8Array(bytes), mime, name: basename(path) };
    } finally {
      closeSync(file);
    }
  }
  handle('rooms:social-choose-space-image', async (spaceId, kind) => {
    const space = id.parse(spaceId),
      which = spaceImageKind.parse(kind);
    const current = requireClient(),
      owner = user!.id,
      window = getWindow();
    if (!window) return null;
    const choice = await dialog.showOpenDialog(window, {
      title: which === 'icon' ? t('Sunucu ikonu seç') : t('Sunucu afişi seç'),
      properties: ['openFile'],
      filters: [{ name: t('Görseller'), extensions: ['png', 'jpg', 'jpeg', 'webp', 'gif'] }],
    });
    if (choice.canceled || !choice.filePaths[0]) return null;
    if (client !== current || user?.id !== owner)
      throw new SocialInputError('The account changed. Open server settings again.');
    const image = readSpaceImage(choice.filePaths[0], which === 'icon' ? 2_500_000 : 6_000_000);
    return current.updateSpaceProfile(space, { [which]: image });
  });
  handle('rooms:social-remove-space-image', (spaceId, kind) =>
    requireClient().updateSpaceProfile(id.parse(spaceId), {
      [spaceImageKind.parse(kind)]: null,
    }),
  );
  handle('rooms:social-community-capabilities', (spaceId) =>
    requireClient().communityCapabilities(id.parse(spaceId)),
  );
  handle('rooms:social-ban-community-member', async (input) => {
    const current = requireClient(),
      owner = user!.id,
      result = await current.banCommunityMember(memberRemoval.parse(input));
    if (client !== current || user?.id !== owner)
      throw new SocialInputError('The account changed. Open community management again.');
    return result;
  });
  handle('rooms:social-remove-community-member', async (input) => {
    const current = requireClient(),
      owner = user!.id,
      result = await current.removeCommunityMember(memberRemoval.parse(input));
    if (client !== current || user?.id !== owner)
      throw new SocialInputError('The account changed. Open community management again.');
    return result;
  });
  // The panel, the mention picker and the DM picker may ask at the same moment: they share one
  // in-flight request (never a finished one, so membership changes are not served stale).
  const memberRequests = new Map<string, Promise<SocialMember[]>>();
  handle('rooms:social-members', (spaceId) => {
    const current = requireClient(),
      space = id.parse(spaceId),
      key = `${current.instanceUrl}:${user!.id}:${space}`;
    let pending = memberRequests.get(key);
    if (!pending) {
      pending = current.listCommunityMembers(space).finally(() => {
        if (memberRequests.get(key) === pending) memberRequests.delete(key);
      });
      memberRequests.set(key, pending);
    }
    return pending;
  });
  handle('rooms:social-friends', () => requireClient().listFriends());
  handle('rooms:social-add-friend', (username) =>
    requireClient().addFriend(z.string().min(7).max(37).parse(username)),
  );
  handle('rooms:social-remove-friend', (userId) => requireClient().removeFriend(id.parse(userId)));
  const avatarRequests = new Map<string, Promise<string | null>>();
  handle('rooms:social-download-attachment', async (channelId, messageId, fileId) => {
    const current = requireClient(),
      owner = user!.id,
      window = getWindow();
    if (!window) return false;
    const channel = id.parse(channelId),
      message = id.parse(messageId),
      file = id.parse(fileId);
    const result = await current.attachmentFile(channel, message, file);
    if (client !== current || user?.id !== owner)
      throw new SocialInputError('The conversation session changed.');
    const save = await dialog.showSaveDialog(window, {
      title: t('Dosyayı kaydet'),
      defaultPath: basename(result.name).replace(/[\x00-\x1f]/g, '') || 'Attachment',
    });
    if (save.canceled || !save.filePath) return false;
    const fresh = await current.getMessage(channel, message);
    if (
      client !== current ||
      user?.id !== owner ||
      !fresh.attachments?.some((item) => item.id === file)
    )
      throw new SocialInputError('The conversation session changed.');
    writeFileSync(save.filePath, result.bytes);
    return true;
  });
  handle('rooms:social-attachment-image', async (channelId, messageId, fileId) => {
    const current = requireClient(),
      owner = user!.id;
    const result = await current.attachmentImage(
      id.parse(channelId),
      id.parse(messageId),
      id.parse(fileId),
    );
    if (client !== current || user?.id !== owner)
      throw new SocialInputError('The conversation session changed.');
    return result;
  });
  handle('rooms:social-attachment-video', async (channelId, messageId, fileId) => {
    const current = requireClient(),
      owner = user!.id;
    const result = await current.attachmentVideo(
      id.parse(channelId),
      id.parse(messageId),
      id.parse(fileId),
    );
    if (client !== current || user?.id !== owner)
      throw new SocialInputError('The conversation session changed.');
    return result;
  });
  handle('rooms:social-avatar', async (userId) => {
    const selectedId = id.parse(userId),
      current = requireClient();
    const key = current.instanceUrl + ':' + user!.id + ':' + selectedId;
    let pending = avatarRequests.get(key);
    if (!pending) {
      pending = current.avatar(selectedId);
      if (avatarRequests.size >= 64) avatarRequests.delete(avatarRequests.keys().next().value!);
      avatarRequests.set(key, pending);
      setTimeout(() => avatarRequests.delete(key), 60000).unref();
    }
    return pending;
  });
  handle('rooms:social-choose-avatar', async () => {
    const current = requireClient(),
      owner = user!.id,
      window = getWindow();
    if (!window) return null;
    const choice = await dialog.showOpenDialog(window, {
      title: 'Choose profile photo',
      properties: ['openFile'],
      filters: [{ name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'webp'] }],
    });
    if (choice.canceled || !choice.filePaths[0]) return null;
    if (client !== current || user?.id !== owner)
      throw new SocialInputError('Sign in again before changing your photo.');
    const file = openSync(choice.filePaths[0], 'r');
    let bytes: Buffer;
    try {
      const stat = fstatSync(file);
      if (!stat.isFile() || stat.size > 2_000_000 || stat.size < 12)
        throw new SocialInputError('Choose a PNG, JPEG or WebP photo under 2 MB.');
      bytes = Buffer.alloc(stat.size);
      if (readSync(file, bytes, 0, bytes.length, 0) !== bytes.length)
        throw new SocialInputError('The photo could not be read.');
    } finally {
      closeSync(file);
    }
    const mime = bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
      ? 'image/png'
      : bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255
        ? 'image/jpeg'
        : bytes.toString('ascii', 0, 4) === 'RIFF' && bytes.toString('ascii', 8, 12) === 'WEBP'
          ? 'image/webp'
          : null;
    if (!mime) throw new SocialInputError('Choose a PNG, JPEG or WebP photo.');
    const updated = await current.uploadAvatar(bytes, basename(choice.filePaths[0]), mime);
    if (client !== current || user?.id !== owner) return null;
    user = updated;
    avatarRequests.clear();
    emit({ type: 'PROFILE_UPDATE', data: user });
    return user;
  });
  handle('rooms:social-profile', async (input) => {
    const body = z
      .object({
        displayName: z
          .string()
          .min(2)
          .max(32)
          .regex(/^[^\u200B\n\r]+$/),
        bio: z.string().max(2000).optional(),
        statusText: z.string().max(128).optional(),
      })
      .strict()
      .parse(input);
    const current = requireClient(),
      owner = user!.id,
      updated = await current.updateProfile(body);
    if (client !== current || user?.id !== owner)
      throw new SocialInputError('The account changed. Reopen your profile before saving.');
    user = updated;
    emit({ type: 'PROFILE_UPDATE', data: user });
    return user;
  });
  handle('rooms:social-react', (channelId, messageId, emoji, remove) =>
    requireClient().react(
      id.parse(channelId),
      id.parse(messageId),
      z.string().regex(SOCIAL_REACTION_PATTERN).parse(emoji),
      remove === undefined ? false : z.boolean().parse(remove),
    ),
  );
  handle('rooms:social-discard-attachment', (fileId) => {
    uploadedAttachments.delete(id.parse(fileId));
  });
  function attachmentMime(name: string) {
    const types: Record<string, string> = {
      '.png': 'image/png',
      '.jpg': 'image/jpeg',
      '.jpeg': 'image/jpeg',
      '.webp': 'image/webp',
      '.gif': 'image/gif',
      '.mp4': 'video/mp4',
      '.m4v': 'video/mp4',
      '.mov': 'video/quicktime',
      '.webm': 'video/webm',
      '.mp3': 'audio/mpeg',
      '.wav': 'audio/wav',
      '.ogg': 'audio/ogg',
      '.pdf': 'application/pdf',
      '.txt': 'text/plain',
      '.md': 'text/markdown',
      '.json': 'application/json',
      '.zip': 'application/zip',
    };
    const mime = types[extname(name).toLowerCase()];
    if (!mime) throw new SocialInputError('This attachment file type is not supported.');
    if (uploadedAttachments.size >= 20)
      throw new SocialInputError(
        'Send or discard selected attachments before uploading more files.',
      );
    return mime;
  }
  /** Finder file copies arrive as a file URI list; screenshots as image data. */
  async function clipboardAttachment(): Promise<
    { path: string } | { bytes: Uint8Array; name: string } | null
  > {
    const extensions: Record<string, string> = {
      'image/png': 'png',
      'image/jpeg': 'jpg',
      'image/gif': 'gif',
      'image/webp': 'webp',
    };
    for (const item of await clipboard.read()) {
      const uriType =
        item.types.find((value) => value === 'text/uri-list') ??
        item.types.find((value) => value.includes('format="public.file-url"'));
      if (uriType) {
        const list = await ((await item.getType(uriType)) as Blob).text();
        const uri = list.split(/\r?\n/).find((line) => line.startsWith('file://'));
        if (uri) return { path: fileURLToPath(uri) };
      }
      const type = item.types.find((value) => value in extensions);
      if (type) {
        const bytes = new Uint8Array(await ((await item.getType(type)) as Blob).arrayBuffer());
        if (!bytes.byteLength || bytes.byteLength > 25 * 1024 * 1024)
          throw new SocialInputError('Select a nonempty attachment up to 25 MB.');
        const stamp = new Date().toISOString().slice(0, 19).replace(/[-:T]/g, '');
        return { bytes, name: `pano-${stamp}.${extensions[type]}` };
      }
    }
    return null;
  }
  function readAttachmentFile(path: string) {
    const fileStat = statSync(path);
    if (!fileStat.isFile() || !fileStat.size || fileStat.size > 25 * 1024 * 1024)
      throw new SocialInputError('Select a nonempty attachment up to 25 MB.');
    attachmentMime(basename(path));
    const descriptor = openSync(path, 'r');
    try {
      const initial = fstatSync(descriptor);
      if (!initial.isFile() || initial.size !== fileStat.size)
        throw new SocialInputError('The selected attachment changed. Select it again.');
      const buffer = Buffer.alloc(initial.size + 1);
      let count = 0;
      while (count < buffer.length) {
        const read = readSync(descriptor, buffer, count, buffer.length - count, null);
        if (read === 0) break;
        count += read;
      }
      if (count !== initial.size)
        throw new SocialInputError('The selected attachment changed. Select it again.');
      return new Uint8Array(buffer.subarray(0, count));
    } finally {
      closeSync(descriptor);
    }
  }
  async function stageAttachment(
    current: StoatClient,
    channel: string,
    bytes: Uint8Array,
    name: string,
  ) {
    const mime = attachmentMime(name),
      limit = await current.attachmentSizeLimit();
    if (bytes.byteLength > limit) {
      const exceeded = t('{name} sunucunun {limit} MB sınırını aşıyor.', {
        name,
        limit: Math.floor(limit / 1_000_000),
      });
      throw new SocialInputError(
        mime.startsWith('video/')
          ? `${exceeded} ${t('Uzun videoları Sinema’da “Kendi dosyamla” ile birlikte izleyebilirsiniz.')}`
          : exceeded,
      );
    }
    const result = await current.uploadAttachment(bytes, name, mime);
    if (current !== client)
      throw new SocialInputError('The conversation session changed. Select the attachment again.');
    uploadedAttachments.set(result.id, {
      channelId: channel,
      name: result.name,
      size: result.size,
      mime: result.mime,
    });
    return result;
  }
  handle('rooms:social-choose-attachment', async (channelId) => {
    const channel = id.parse(channelId);
    const current = requireClient();
    await current.getChannel(channel);
    const window = getWindow();
    if (!window) return null;
    const chosen = await dialog.showOpenDialog(window, {
      title: 'Attach a file to this conversation',
      properties: ['openFile'],
      filters: [
        {
          name: 'Images, media and documents',
          extensions: [
            'png',
            'jpg',
            'jpeg',
            'webp',
            'gif',
            'mp4',
            'm4v',
            'mov',
            'webm',
            'mp3',
            'wav',
            'ogg',
            'pdf',
            'txt',
            'md',
            'json',
            'zip',
          ],
        },
      ],
    });
    if (chosen.canceled || !chosen.filePaths[0]) return null;
    const path = chosen.filePaths[0];
    return stageAttachment(current, channel, readAttachmentFile(path), basename(path));
  });
  // Clipboard contents the renderer's paste event cannot expose as files: screenshots copied as
  // image data and files copied in Finder. Reads only on an explicit paste in the composer.
  handle('rooms:social-paste-attachment', async (channelId) => {
    const channel = id.parse(channelId);
    const current = requireClient();
    await current.getChannel(channel);
    const pasted = await clipboardAttachment();
    if (!pasted) return null;
    return stageAttachment(
      current,
      channel,
      'path' in pasted ? readAttachmentFile(pasted.path) : pasted.bytes,
      'path' in pasted ? basename(pasted.path) : pasted.name,
    );
  });
  // Files dragged or pasted into the composer arrive as bytes; the renderer never learns a path.
  handle('rooms:social-drop-attachment', async (channelId, fileName, data) => {
    const channel = id.parse(channelId);
    const name = z
      .string()
      .min(1)
      .max(255)
      .refine((value) => !/[\\/\0]/.test(value))
      .parse(fileName);
    if (!(data instanceof Uint8Array) || !data.byteLength || data.byteLength > 25 * 1024 * 1024)
      throw new SocialInputError('Select a nonempty attachment up to 25 MB.');
    const current = requireClient();
    await current.getChannel(channel);
    return stageAttachment(current, channel, new Uint8Array(data), name);
  });
  handle('rooms:social-edit', (channelId, messageId, text) =>
    requireClient().editMessage(id.parse(channelId), id.parse(messageId), content.parse(text)),
  );
  handle('rooms:social-delete', (channelId, messageId) =>
    requireClient().deleteMessage(id.parse(channelId), id.parse(messageId)),
  );
  handle('rooms:social-create-invite', (channelId) =>
    requireClient().createInvite(id.parse(channelId)),
  );
  handle('rooms:social-list-invites', (spaceId) =>
    requireClient().listInviteLinks(id.parse(spaceId)),
  );
  handle('rooms:social-revoke-invite', (spaceId, inviteId) =>
    requireClient().revokeInviteLink(
      id.parse(spaceId),
      z
        .string()
        .regex(/^[a-f0-9]{16}$/)
        .parse(inviteId),
    ),
  );
  handle('rooms:social-inspect-invite', (url, inviteCode) =>
    new StoatClient(z.string().max(2048).parse(url)).inspectInvite(code.parse(inviteCode)),
  );
  handle('rooms:social-accept-invite', (inviteCode) =>
    requireClient().acceptInvite(code.parse(inviteCode)),
  );
  handle('rooms:social-dms', () => requireClient().listDMs());
  handle('rooms:social-create-dm', (recipientId) =>
    requireClient().createDM(id.parse(recipientId)),
  );
  handle('rooms:social-block', (userId) => requireClient().blockUser(id.parse(userId)));
  handle('rooms:social-unblock', (userId) => requireClient().unblockUser(id.parse(userId)));
  handle('rooms:social-remove-member', (spaceId, userId) =>
    requireClient().removeMember(id.parse(spaceId), id.parse(userId)),
  );
  handle('rooms:social-ack', (channelId, messageId) =>
    requireClient().ackRead(id.parse(channelId), id.parse(messageId)),
  );
  handle('rooms:social-typing', (channel, active) =>
    requireClient().typing(id.parse(channel), z.boolean().parse(active)),
  );
  handle('rooms:social-own-profile', () => requireClient().ownProfile());
  handle('rooms:social-presence', (status) =>
    requireClient().updatePresence(z.enum(['online', 'idle', 'dnd', 'invisible']).parse(status)),
  );
  async function broker(path: string, channelId: unknown) {
    const current = requireClient();
    const response = await fetch(
      `${new URL(current.instanceUrl).origin}/rooms-access/v1/media/${path}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: current.getToken()! },
        body: JSON.stringify(channelId),
        redirect: 'error',
        signal: AbortSignal.timeout(15000),
      },
    );
    const value = await response.json().catch(() => null);
    if (current !== client)
      throw new SocialInputError('The conversation session changed. Join the voice room again.');
    if (!response.ok) {
      const reasons: Record<string, string> = {
        REMOTE_SOURCE_LIMIT: t(
          'Bu odada çok fazla ekran kontrolü kaydı var. Bir paylaşımı kapatıp yeniden dene.',
        ),
        REMOTE_HUMAN_PEER_REQUIRED: t(
          'Ekran kontrolü yalnızca odadaki insanlar arasında kullanılabilir.',
        ),
        REMOTE_ALREADY_ACTIVE: t(
          'Senin veya arkadaşının başka bir kontrol oturumu açık. Önce onu bırak.',
        ),
        REMOTE_REQUEST_PENDING: t('Kontrol isteğin gönderildi. Paylaşan kişinin onayını bekle.'),
        REMOTE_REQUEST_LIMIT: t('Çok fazla kontrol isteği var. Biraz sonra yeniden dene.'),
        REMOTE_REQUEST_STALE: t(
          'Kontrol isteği sona erdi veya ekran değişti. Yeniden kontrol iste.',
        ),
        REMOTE_SOURCE_STALE: t(
          'Bu ekran paylaşımı değişti. Paylaşımı yenileyip tekrar kontrol iste.',
        ),
        REMOTE_SCREEN_REQUIRED: t('Ekran yayını henüz hazır değil. Biraz sonra yeniden dene.'),
        PRESENTER_BUSY: t('Bu odada başka biri ekran paylaşıyor.'),
        PRESENT_PERMISSION_REQUIRED: t('Oda rolün ekran paylaşma izni vermiyor.'),
        VOICE_CHANNEL_REQUIRED: t('Önce bir ses odası seç.'),
        ROOM_ACCESS_DENIED: t(
          'Ses odasına erişimin değişti. Üyeliğin doğrulandıktan sonra yeniden katıl.',
        ),
        SCREEN_LEASE_STALE: t('Sunum sahibi değişti. Odayı yenileyip yeniden dene.'),
        SCREEN_RESERVATION_STALE: t('Devir süresi doldu. Yeniden sunum isteği gönder.'),
        SCREEN_HANDOFF_PENDING: t('Başka bir ekran devri devam ediyor.'),
        SCREEN_REQUEST_EXISTS: t('Bekleyen bir sunum talebin zaten var.'),
        SCREEN_REQUEST_STALE: t('Sunum talebi sona erdi veya artık kullanılamıyor.'),
        SCREEN_PRESENTER_REQUIRED: t('Bu talebi yalnızca mevcut sunum sahibi yanıtlayabilir.'),
        SCREEN_REQUEST_OWNER_REQUIRED: t('Yalnızca kendi sunum talebini iptal edebilirsin.'),
        ALREADY_PRESENTER: t('Zaten ekran paylaşıyorsun.'),
        JOIN_VOICE_FIRST: t('Sunum istemeden önce ses odasına katıl.'),
        MOVE_MEMBERS_REQUIRED: t('Bu odadaki kişileri taşıma veya sesten çıkarma yetkin yok.'),
        MEMBER_NOT_IN_ROOM: t('Bu kişi artık bu odada değil.'),
        SCREEN_REQUEST_LIMIT: t('Çok fazla sunum talebi var. Biraz sonra yeniden dene.'),
      };
      if (typeof value?.error === 'string' && Object.hasOwn(reasons, value.error))
        throw new SocialInputError(reasons[value.error]);
      throw new StoatError(response.status, 'MEDIA_GRANT_DENIED');
    }
    return value;
  }
  async function soundboardRequest(
    channelId: unknown,
    method: 'GET' | 'POST' | 'DELETE' | 'PATCH',
    clipId?: unknown,
    input?: unknown,
  ) {
    const current = requireClient(),
      token = current.getToken()!,
      channel = id.parse(channelId),
      clip = clipId === undefined ? '' : `/${z.string().uuid().parse(clipId)}`;
    const body =
      input === undefined
        ? undefined
        : method === 'PATCH'
          ? z
              .object({ name: z.string().trim().min(1).max(40) })
              .strict()
              .parse(input)
          : z
            .object({
              name: z.string().trim().min(1).max(40),
              audio: z
                .string()
                .max(2_666_672)
                .regex(/^[A-Za-z0-9+/]*={0,2}$/),
            })
            .strict()
            .parse(input);
    const response = await fetch(
      `${new URL(current.instanceUrl).origin}/rooms-access/v1/soundboard/${encodeURIComponent(channel)}${clip}`,
      {
        method,
        headers: { Authorization: token, ...(body ? { 'Content-Type': 'application/json' } : {}) },
        body: body ? JSON.stringify(body) : undefined,
        redirect: 'error',
        signal: AbortSignal.timeout(15000),
      },
    );
    const valid = () => current === client && current.getToken() === token;
    if (!valid()) throw new SocialInputError(t('Oturum değişti.'));
    if (!response.ok) {
      const error = (await response.json().catch(() => null))?.error;
      const messages: Record<string, string> = {
        SOUNDBOARD_NOT_CONFIGURED: t('Sunucunun topluluk sesleri henüz yapılandırılmadı.'),
        SOUNDBOARD_UPLOAD_DENIED: t('Bu odada ses ekleme iznin yok.'),
        SOUNDBOARD_DELETE_DENIED: t('Yalnızca kendi sesini kaldırabilirsin.'),
        SOUNDBOARD_FULL: t('Toplulukta en fazla 32 ses saklanabilir.'),
        SOUNDBOARD_NOT_FOUND: t('Bu ses kaldırılmış.'),
        SOUNDBOARD_INVALID_AUDIO: t('En fazla 8 saniyelik mono veya stereo ses seç.'),
      };
      // A server that predates renaming answers the unknown route with a plain 404/405.
      if (method === 'PATCH' && (response.status === 404 || response.status === 405) && !messages[error])
        throw new SocialInputError(
          t('Sunucu henüz güncel değil; sesi düzenlemek için sunucunun güncellenmesi gerekir.'),
        );
      throw new SocialInputError(messages[error] ?? t('Topluluk sesleri alınamadı. Yeniden dene.'));
    }
    if (method === 'GET' && clip) {
      const reader = response.body?.getReader();
      if (!reader) throw new SocialInputError(t('Ses dosyası alınamadı.'));
      const chunks: Buffer[] = [];
      let size = 0;
      try {
        while (true) {
          const value = await reader.read();
          if (value.done) break;
          size += value.value.byteLength;
          if (size > 2_000_000) throw new SocialInputError(t('Ses dosyası çok büyük.'));
          chunks.push(Buffer.from(value.value));
        }
      } finally {
        await reader.cancel().catch(() => {});
      }
      if (!valid()) throw new SocialInputError(t('Oturum değişti.'));
      return Buffer.concat(chunks).toString('base64');
    }
    const value = await response.json();
    if (!valid()) throw new SocialInputError(t('Oturum değişti.'));
    return method === 'GET'
      ? soundboardCatalogSchema.parse(value)
      : method === 'POST' || method === 'PATCH'
        ? soundboardClipSchema.parse(value)
        : z
            .object({ deleted: z.literal(true) })
            .strict()
            .parse(value);
  }
  handle('rooms:soundboard-list', (channel) => soundboardRequest(channel, 'GET'));
  handle('rooms:soundboard-upload', (channel, input) =>
    soundboardRequest(channel, 'POST', undefined, input),
  );
  handle('rooms:soundboard-read', (channel, clip) => soundboardRequest(channel, 'GET', clip));
  handle('rooms:soundboard-rename', (channel, clip, name) =>
    soundboardRequest(channel, 'PATCH', clip, { name }),
  );
  handle('rooms:soundboard-remove', async (channel, clip) => {
    await soundboardRequest(channel, 'DELETE', clip);
  });
  /** Personal sounds belong to the account, so only playback reads are scoped to a voice channel. */
  async function personalSoundsRequest(
    method: 'GET' | 'POST' | 'PUT' | 'DELETE',
    path: string,
    input?: unknown,
    audio = false,
  ) {
    const current = requireClient(),
      token = current.getToken()!;
    const response = await fetch(
      `${new URL(current.instanceUrl).origin}/rooms-access/v1/personal-sounds/${path}`,
      {
        method,
        headers: {
          Authorization: token,
          ...(input === undefined ? {} : { 'Content-Type': 'application/json' }),
        },
        body: input === undefined ? undefined : JSON.stringify(input),
        redirect: 'error',
        signal: AbortSignal.timeout(15000),
      },
    );
    const valid = () => current === client && current.getToken() === token;
    if (!valid()) throw new SocialInputError(t('Oturum değişti.'));
    if (!response.ok) {
      const error = (await response.json().catch(() => null))?.error;
      const messages: Record<string, string> = {
        PERSONAL_SOUNDS_NOT_CONFIGURED: t('Bu sunucuda giriş sesleri henüz açılmadı.'),
        PERSONAL_SOUND_UPLOADS_DISABLED: t(
          'Sunucu yöneticisi ses yüklemeyi kapattı. Tayfa seslerinden birini seçebilirsin.',
        ),
        PERSONAL_SOUND_INVALID_AUDIO: t(
          'Ses dosyası okunamadı. En fazla 4 saniyelik bir kesit seç.',
        ),
        PERSONAL_SOUND_SILENT: t('Seçtiğin kesit neredeyse sessiz. Başka bir bölüm seç.'),
        PERSONAL_SOUND_LIBRARY_FULL: t('En fazla {count} ses saklayabilirsin. Önce birini sil.', {
          count: PERSONAL_SOUND_LIMITS.maxSounds,
        }),
        PERSONAL_SOUND_STORAGE_LIMIT: t('Sunucudaki ses alanı doldu. Yöneticiye haber ver.'),
        PERSONAL_SOUND_NOT_FOUND: t('Bu ses artık yok.'),
      };
      const fallback = {
        GET: t('Giriş sesleri alınamadı. Yeniden dene.'),
        POST: t('Ses kaydedilemedi. Yeniden dene.'),
        PUT: t('Seçimin kaydedilemedi. Yeniden dene.'),
        DELETE: t('Ses silinemedi. Yeniden dene.'),
      }[method];
      throw new SocialInputError(messages[error] ?? fallback);
    }
    if (audio) {
      const reader = response.body?.getReader();
      if (!reader) throw new SocialInputError(t('Ses dosyası alınamadı.'));
      const chunks: Buffer[] = [];
      let size = 0;
      try {
        while (true) {
          const value = await reader.read();
          if (value.done) break;
          size += value.value.byteLength;
          if (size > PERSONAL_SOUND_LIMITS.maxClipBytes)
            throw new SocialInputError(t('Ses dosyası çok büyük.'));
          chunks.push(Buffer.from(value.value));
        }
      } finally {
        await reader.cancel().catch(() => {});
      }
      if (!valid()) throw new SocialInputError(t('Oturum değişti.'));
      return Buffer.concat(chunks).toString('base64');
    }
    const value = await response.json();
    if (!valid()) throw new SocialInputError(t('Oturum değişti.'));
    return value;
  }
  const soundPath = (soundId: unknown) => encodeURIComponent(personalSoundIdSchema.parse(soundId));
  handle('rooms:personal-sounds-profile', async () =>
    personalSoundProfileSchema.parse(await personalSoundsRequest('GET', 'me')),
  );
  handle('rooms:personal-sounds-upload', async (input) =>
    personalSoundSchema.parse(
      await personalSoundsRequest('POST', 'me/sounds', personalSoundUploadSchema.parse(input)),
    ),
  );
  handle('rooms:personal-sounds-remove', async (soundId) =>
    personalSoundProfileSchema.parse(
      await personalSoundsRequest('DELETE', `me/sounds/${soundPath(soundId)}`),
    ),
  );
  handle('rooms:personal-sounds-assign', async (value) =>
    personalSoundProfileSchema.parse(
      await personalSoundsRequest('PUT', 'me/assign', personalSoundAssignSchema.parse(value)),
    ),
  );
  handle('rooms:personal-sounds-preview', (soundId) =>
    personalSoundsRequest('GET', `me/sounds/${soundPath(soundId)}`, undefined, true),
  );
  handle('rooms:personal-sounds-read', (channelId, userId, soundId) =>
    personalSoundsRequest(
      'GET',
      `${encodeURIComponent(id.parse(channelId))}/${encodeURIComponent(personalSoundUserIdSchema.parse(userId))}/${soundPath(soundId)}`,
      undefined,
      true,
    ),
  );
  async function musicRequest(channelId: string, command?: unknown, search?: string) {
    const current = requireClient(),
      room = id.parse(channelId),
      token = current.getToken()!;
    const body =
      search !== undefined
        ? { query: musicSearchQuerySchema.parse(search) }
        : command === undefined
          ? undefined
          : musicCommandSchema.parse(command);
    const response = await fetch(
      `${new URL(current.instanceUrl).origin}/rooms-access/v1/music/${encodeURIComponent(room)}${search !== undefined ? '/search' : ''}`,
      {
        method: body ? 'POST' : 'GET',
        headers: { Authorization: token, 'Content-Type': 'application/json' },
        body: body ? JSON.stringify(body) : undefined,
        redirect: 'error',
        signal: AbortSignal.timeout(body ? 160000 : 15000),
      },
    );
    const value = await response.json().catch(() => null);
    if (current !== client || current.getToken() !== token)
      throw new SocialInputError(t('Oturum değişti.'));
    if (!response.ok) {
      const messages: Record<string, string> = {
        MUSIC_SPOTIFY_PLAYLIST_UNAVAILABLE: t(
          'Spotify listesi okunamadı. Listenin herkese açık olduğundan emin olup yeniden dene.',
        ),
        MUSIC_SPOTIFY_PLAYLIST_EMPTY: t(
          'Spotify listesinin herkese açık görünümünde şarkı bulunamadı. Özel veya boş bir liste olabilir.',
        ),
        MUSIC_SPOTIFY_PLAYLIST_LIMIT: t(
          'Spotify bu listenin tamamını göstermeyebilir. Eksik aktarmamak için 100 parçadan az bir liste kullan.',
        ),
        MUSIC_SPOTIFY_PLAYLIST_INCOMPLETE: t(
          'Spotify listesindeki bazı kayıtların şarkı bilgisi okunamadı. Liste eklenmedi; yerel dosya veya podcast içermeyen bir liste dene.',
        ),
        MUSIC_QUEUE_CHANGED: t('Kuyruk değişti. Güncel sırayla yeniden dene.'),
        MUSIC_HISTORY_MISSING: t('Geçmiş liste bulunamadı.'),
        MUSIC_HISTORY_UNAVAILABLE: t('DJ geçmişi kaydedilemedi. Müzik bağlantısı korunuyor.'),
        MUSIC_SEARCH_BUSY: t('Arama meşgul. Biraz sonra yeniden dene.'),
        MUSIC_SEARCH_UNAVAILABLE: t('Arama şu anda kullanılamıyor. Yeniden dene.'),
        MUSIC_SEEK_INVALID: t('Bu parçanın süresi doğrulanmadı veya seçilen konum geçersiz.'),
        MUSIC_YOUTUBE_ACCESS_REQUIRED: t(
          'Sunucunun YouTube ses erişimi doğrulanamadı. DJ şu anda bu kaynaktan çalamıyor.',
        ),
        MUSIC_YOUTUBE_UNAVAILABLE: t('YouTube parçası şu anda alınamıyor. Yeniden dene.'),
        MUSIC_SOURCE_TIMEOUT: t('Parça yüklenmesi zaman aşımına uğradı. Yeniden dene.'),
        MUSIC_NOT_CONFIGURED: t('Müzik botu sunucuda yapılandırılmadı.'),
        MUSIC_SOURCE_FAILED: t('Geçerli bir YouTube, Spotify, SoundCloud veya ses bağlantısı gir.'),
        MUSIC_MIRROR_METADATA_UNAVAILABLE: t(
          'Şarkı bilgisi alınamadı. Herkese açık tek şarkı bağlantısını yeniden dene.',
        ),
        MUSIC_MIRROR_SINGLE_TRACK_ONLY: t(
          'Spotify şarkısı veya herkese açık çalma listesi; SoundCloud için tek şarkı bağlantısı gir. Albümler desteklenmiyor.',
        ),
        MUSIC_MIRROR_NOT_FOUND: t(
          'Spotify/SoundCloud parçasıyla aynı sanatçı ve sürede bir YouTube kaydı bulunamadı. Şarkı adını arayıp uygun sonucu seçebilirsin.',
        ),
        MUSIC_JOIN_FIRST: t('Önce ses odasına katıl.'),
        MUSIC_PERMISSION_DENIED: t('Bu odada müzik kontrol yetkin yok.'),
        MUSIC_QUEUE_FULL: t('Kuyruk dolu. En fazla 100 parça eklenebilir.'),
        MUSIC_CACHE_LIMIT: t('Müzik dosyaları toplam boyut sınırını aştı.'),
        MUSIC_TRANSPORT_UNAVAILABLE: t('Müzik botu ses odasına bağlanamadı.'),
        MUSIC_CURRENT_ITEM: t('Çalan parçayı kaldırmadan önce başka parçaya geç.'),
      };
      const song = musicFailedSongSchema.safeParse(value?.song);
      if (value?.error === 'MUSIC_MIRROR_NOT_FOUND' && song.success)
        throw new SocialInputError(
          t(
            'Spotify/SoundCloud şarkısı “{title}” ({artists}) için aynı sanatçı ve sürede bir YouTube kaydı bulunamadı. Şarkı adını arayıp uygun sonucu seçebilirsin.',
            { title: song.data.title, artists: song.data.artists.join(', ') },
          ),
        );
      throw new SocialInputError(
        messages[value?.error] ?? t('DJ sunucusu yanıt vermedi. Biraz sonra yeniden dene.'),
      );
    }
    return search !== undefined
      ? musicSearchResultsSchema.parse(value)
      : musicSnapshotSchema.parse(value);
  }
  async function playlistsRequest(channelId: unknown, change?: unknown) {
    const current = requireClient(),
      token = current.getToken()!,
      channel = id.parse(channelId);
    const response = await fetch(
      `${new URL(current.instanceUrl).origin}/rooms-access/v1/music/${encodeURIComponent(channel)}/playlists`,
      {
        method: change ? 'POST' : 'GET',
        headers: { Authorization: token, 'Content-Type': 'application/json' },
        body: change ? JSON.stringify(playlistChangeSchema.parse(change)) : undefined,
        redirect: 'error',
        signal: AbortSignal.timeout(70000),
      },
    );
    const value = await response.json();
    if (current !== client || current.getToken() !== token)
      throw new SocialInputError(t('Oturum değişti.'));
    if (!response.ok) {
      const errors: Record<string, string> = {
        MUSIC_SPOTIFY_PLAYLIST_UNAVAILABLE: t(
          'Spotify listesi okunamadı. Listenin herkese açık olduğundan emin olup yeniden dene.',
        ),
        MUSIC_SPOTIFY_PLAYLIST_EMPTY: t(
          'Spotify listesinin herkese açık görünümünde şarkı bulunamadı. Özel veya boş bir liste olabilir.',
        ),
        MUSIC_SPOTIFY_PLAYLIST_LIMIT: t(
          'Spotify bu listenin tamamını göstermeyebilir. Eksik aktarmamak için 100 parçadan az bir liste kullan.',
        ),
        MUSIC_SPOTIFY_PLAYLIST_INCOMPLETE: t(
          'Spotify listesindeki bazı kayıtların şarkı bilgisi okunamadı. Liste eklenmedi; yerel dosya veya podcast içermeyen bir liste dene.',
        ),
        MUSIC_PLAYLIST_CHANGED: t(
          'Liste başka biri tarafından değiştirildi. Yenileyip tekrar dene.',
        ),
        MUSIC_PLAYLIST_EMPTY: t('Kaydedilebilecek parça yok.'),
        MUSIC_PLAYLISTS_NOT_CONFIGURED: t('Ortak listeler sunucuda henüz açılmadı.'),
        MUSIC_NOT_CONFIGURED: t('Sunucunun DJ hizmeti henüz açılmadı.'),
        MUSIC_PERMISSION_DENIED: t(
          'Bu odanın listelerine erişimin yok ya da listeleri değiştirmek için odada konuşma iznin yok.',
        ),
        AUTH_REQUIRED: t('Oturum doğrulanamadı. Bağlantıyı yenileyip yeniden dene.'),
        MUSIC_PLAYLIST_LIMIT: t(
          'Topluluğun liste sınırına ulaşıldı. Kullanılmayan listeleri veya parçaları kaldır.',
        ),
        MUSIC_PLAYLIST_INVALID: t(
          'Liste bilgisi geçersiz. Desteklenen YouTube/Spotify bağlantılarını ve parça sınırını kontrol et.',
        ),
        MUSIC_PLAYLIST_SOURCE_UNAVAILABLE: t(
          'Çalma listesi veya DJ geçmişi alınamadı. Kaynak erişimini kontrol edip yeniden dene.',
        ),
      };
      throw new SocialInputError(
        errors[value?.error] ??
          t(
            'Liste işleminin sonucu doğrulanamadı. Yenileyip kaydı kontrol et; değişiklik otomatik tekrarlanmadı.',
          ),
      );
    }
    return playlistCatalogSchema.parse(value);
  }
  handle('rooms:music-playlists', (channel) => playlistsRequest(channel));
  handle('rooms:music-playlist-change', (channel, change) => playlistsRequest(channel, change));
  let lyricsPending = false;
  handle('rooms:music-lyrics', async (channelId, trackId) => {
    const current = requireClient(),
      token = current.getToken(),
      room = id.parse(channelId),
      track = z.string().uuid().parse(trackId);
    if (lyricsPending)
      throw new SocialInputError(t('Şarkı sözleri yükleniyor. Biraz sonra yeniden dene.'));
    lyricsPending = true;
    try {
      const snapshot = musicSnapshotSchema.parse(await musicRequest(room));
      if (snapshot.currentId !== track) throw new SocialInputError(t('Çalan parça değişti.'));
      const item = snapshot.queue.find((item) => item.id === track);
      if (!item) throw new SocialInputError(t('Çalan parça bulunamadı.'));
      const result = await loadMusicLyrics(item.title, item.durationSec);
      if (client !== current || current.getToken() !== token)
        throw new SocialInputError(t('Oturum değişti.'));
      return result;
    } finally {
      lyricsPending = false;
    }
  });
  handle('rooms:music-history', async (channelId) => {
    const current = requireClient(),
      token = current.getToken()!,
      room = id.parse(channelId);
    const response = await fetch(
      `${new URL(current.instanceUrl).origin}/rooms-access/v1/music/${encodeURIComponent(room)}/history`,
      { headers: { Authorization: token }, redirect: 'error', signal: AbortSignal.timeout(15000) },
    );
    const value = await response.json();
    if (current !== client || current.getToken() !== token)
      throw new SocialInputError(t('Oturum değişti.'));
    if (!response.ok) throw new SocialInputError(t('DJ geçmişi alınamadı.'));
    return musicHistorySchema.parse(value);
  });
  handle('rooms:music-snapshot', (channelId) => musicRequest(id.parse(channelId)));
  handle('rooms:music-command', (channelId, command) => musicRequest(id.parse(channelId), command));
  handle('rooms:music-search', (channelId, query) =>
    musicRequest(id.parse(channelId), undefined, musicSearchQuerySchema.parse(query)),
  );
  const screenRequest = z
    .object({ channelId: id, leaseId: z.string().uuid(), requestId: z.string().uuid() })
    .strict();
  const screenRequestEntry = z
    .object({
      requestId: z.string().uuid(),
      userId: id,
      leaseId: z.string().uuid(),
      createdAt: z.number().int().nonnegative(),
      expiresAt: z.number().int().positive(),
    })
    .strict();
  const screenPresenterState = z
    .object({
      presenter: z.object({ userId: id, leaseId: z.string().uuid() }).strict().nullable(),
      requests: z.array(screenRequestEntry).max(20),
      reservation: z
        .object({
          requestId: z.string().uuid(),
          userId: id,
          leaseId: z.string().uuid(),
          expiresAt: z.number().int().positive(),
          released: z.boolean(),
        })
        .strict()
        .nullable(),
    })
    .strict();
  const callRequest = async (path: 'poll' | 'start' | 'respond' | 'grant', body: unknown) => {
    const current = requireClient();
    const generation = path === 'start' || path === 'respond' ? ++dmNativeEpoch : dmNativeEpoch;
    let result;
    try {
      result = await requestDmCall(current, path, body);
    } catch (error) {
      if (error instanceof z.ZodError) throw error;
      throw new SocialInputError(
        error instanceof Error ? error.message : t('Arama isteği tamamlanamadı.'),
      );
    }
    const call =
      path === 'poll'
        ? (result as { call: DmCallSession | null }).call
        : path === 'grant'
          ? null
          : (result as DmCallSession);
    if (
      current !== client ||
      ((path === 'start' || path === 'grant') && generation !== dmNativeEpoch)
    ) {
      if (call && call.state !== 'ended')
        await requestDmCall(current, 'respond', { callId: call.id, action: 'end' }).catch(() => {});
      throw new SocialInputError(t('Oturum değişti. Aramayı yeniden başlat.'));
    }
    if (path !== 'grant' && generation === dmNativeEpoch) {
      if (call && call.state !== 'ended') pendingDmCall = { client: current, id: call.id };
      else if (!call || pendingDmCall?.id === call.id) pendingDmCall = null;
    }
    return result;
  };
  handle('rooms:dm-call-poll', () => callRequest('poll', {}));
  handle('rooms:dm-call-start', (input) => callRequest('start', dmCallStartSchema.parse(input)));
  handle('rooms:dm-call-respond', (input) =>
    callRequest('respond', dmCallActionSchema.parse(input)),
  );
  handle('rooms:dm-call-grant', (input) => callRequest('grant', dmCallIdSchema.parse(input)));
  handle('rooms:media-deafen', async (channelId, deafened) => {
    try {
      await broker('deafen', {
        channelId: id.parse(channelId),
        deafened: z.boolean().parse(deafened),
      });
      return true;
    } catch (error) {
      // Servers without the endpoint keep deafen local; it never blocks the toggle.
      if (error instanceof StoatError && error.status === 404) return false;
      throw error;
    }
  });
  const gifMedia = z
    .object({
      url: z
        .string()
        .url()
        .refine((value) => new URL(value).hostname === 'static.klipy.com'),
      width: z.number().int().positive().max(4096),
      height: z.number().int().positive().max(4096),
    })
    .strict();
  // GIF search goes through the community's access service, which holds the provider key.
  handle('rooms:gif-search', async (query, page) => {
    const current = requireClient();
    const q = z
        .string()
        .trim()
        .max(80)
        .parse(query ?? ''),
      number = z
        .number()
        .int()
        .min(1)
        .max(20)
        .parse(page ?? 1);
    const url = new URL(`${new URL(current.instanceUrl).origin}/rooms-access/v1/gifs`);
    if (q) url.searchParams.set('q', q);
    url.searchParams.set('page', String(number));
    const response = await fetch(url, {
      headers: { Authorization: current.getToken()! },
      redirect: 'error',
      signal: AbortSignal.timeout(12000),
    });
    const value = await response.json().catch(() => null);
    if (current !== client) throw new SocialInputError('The conversation session changed.');
    if (!response.ok)
      throw new SocialInputError(
        value?.error === 'GIFS_NOT_CONFIGURED'
          ? t('GIF araması için sunucuya KLIPY anahtarı eklenmeli.')
          : response.status === 404
            ? t('Bu sunucu GIF aramasını henüz desteklemiyor.')
            : response.status === 429
              ? t('Çok fazla GIF araması yapıldı. Biraz bekleyip yeniden dene.')
              : t('GIF servisine şu an ulaşılamıyor. Biraz sonra yeniden dene.'),
      );
    return z
      .object({
        items: z
          .array(
            z
              .object({
                id: z.string().max(64),
                title: z.string().max(120),
                preview: gifMedia,
                gif: gifMedia,
              })
              .strict(),
          )
          .max(50),
        more: z.boolean(),
      })
      .strict()
      .parse(value);
  });
  handle('rooms:media-moderate', async (input) => {
    const body = z
      .object({
        channelId: id,
        userId: id,
        action: z.enum(['disconnect', 'move']),
        targetChannelId: id.optional(),
      })
      .strict()
      .parse(input);
    try {
      await broker('moderate', body);
    } catch (error) {
      if (error instanceof StoatError && error.status === 404)
        throw new SocialInputError(t('Sunucu bu işlemi henüz desteklemiyor.'));
      throw error;
    }
  });
  handle('rooms:media-directory', async (channelIds) => {
    const ids = z.array(id).min(1).max(32).parse(channelIds);
    const result = await broker('directory', { channelIds: ids });
    return z
      .object({
        rooms: z
          .array(
            z
              .object({
                channelId: id,
                participants: z
                  .array(
                    z
                      .object({
                        id: id,
                        name: z.string().max(128),
                        muted: z.boolean(),
                        screen: z.boolean().optional(),
                        deafened: z.boolean().optional(),
                      })
                      .strict(),
                  )
                  .max(100),
              })
              .strict(),
          )
          .max(32),
      })
      .strict()
      .parse(result);
  });
  const remote = setupRemoteControl({
    handle: (name, fn) =>
      handle(name, async (...args) => {
        try {
          return await fn(...args);
        } catch (error) {
          throw new SocialInputError(
            error instanceof z.ZodError
              ? t('Kontrol isteğinin bilgileri geçersiz.')
              : error instanceof Error
                ? error.message === 'REMOTE_CONTROL_INACTIVE' ||
                  error.message === 'REMOTE_APPROVAL_STALE'
                  ? t('Kontrol oturumu sona erdi. Yeniden kontrol iste.')
                  : error.message
                : t('Kontrol işlemi tamamlanamadı.'),
          );
        }
      }),
    broker,
    identity: () => ({ userId: user?.id ?? null, scope: client }),
    capture: () => (activeCaptureScope === client ? activeCapture : null),
    window: getWindow,
  });
  handle('rooms:media-grant', (channelId) => {
    activeCapture = null;
    remote.stop();
    return broker('grant', { channelId: id.parse(channelId) });
  });
  handle('rooms:media-presenter', (channelId, action) => {
    if (action === 'release') {
      activeCapture = null;
      remote.stop();
    }
    return broker(`screens/${z.enum(['acquire', 'release']).parse(action)}`, {
      channelId: id.parse(channelId),
    });
  });
  handle('rooms:media-screen-state', async (channelId) =>
    screenPresenterState.parse(await broker('screen/state', { channelId: id.parse(channelId) })),
  );
  handle('rooms:media-screen-request', async (input) => {
    const body = screenRequest.parse(input);
    return z
      .object({ request: screenRequestEntry })
      .strict()
      .parse(await broker('screen/request', body));
  });
  handle('rooms:media-screen-request-cancel', async (input) => {
    const body = screenRequest.parse(input);
    return z
      .object({ cancelled: z.literal(true) })
      .strict()
      .parse(await broker('screen/request/cancel', body));
  });
  handle('rooms:media-screen-request-decide', async (input) => {
    const body = screenRequest.extend({ approve: z.boolean() }).strict().parse(input);
    return z
      .object({ approved: z.boolean(), awaitingRelease: z.boolean() })
      .strict()
      .parse(await broker('screen/request/decide', body));
  });
  handle('rooms:media-leave', (channelId) => {
    activeCapture = null;
    remote.stop();
    return broker('leave', { channelId: id.parse(channelId) });
  });
  handle('rooms:capture-status', () => ({
    microphone:
      process.platform === 'darwin'
        ? systemPreferences.getMediaAccessStatus('microphone')
        : 'unknown',
    camera:
      process.platform === 'darwin' ? systemPreferences.getMediaAccessStatus('camera') : 'unknown',
    screen:
      process.platform === 'darwin' ? systemPreferences.getMediaAccessStatus('screen') : 'unknown',
    systemAudio: supportsSystemAudio(),
    systemAudioOwnExcluded: audioSupport().ownAudioExcluded,
    ...(audioSupport().reason ? { systemAudioReason: audioSupport().reason } : {}),
  }));
  handle('rooms:capture-sources', async () => {
    choices = [];
    choicesAt = 0;
    choices = await enumerateCaptureSources(
      (options) => desktopCapturer.getSources(options),
      () =>
        process.platform === 'darwin'
          ? systemPreferences.getMediaAccessStatus('screen')
          : 'unknown',
    );
    choicesAt = Date.now();
    return choices.map((source) => ({
      id: source.id,
      name: source.name,
      thumbnail: source.thumbnail.isEmpty() ? '' : source.thumbnail.toDataURL(),
    }));
  });
  handle('rooms:capture-select', (sourceId, options) => {
    const preference = z
      .object({ audio: z.boolean() })
      .strict()
      .parse(options ?? { audio: false });
    if (preference.audio && !supportsSystemAudio())
      throw new SocialInputError('System audio capture is unavailable on this OS.');
    if (typeof sourceId !== 'string' || Date.now() - choicesAt > 60000)
      throw new Error('Refresh available sources.');
    const source = choices.find((s) => s.id === sourceId);
    if (!source) throw new Error('The selected source is unavailable.');
    activeCapture = null;
    remote.stop();
    selected = source;
    selectedAudio = preference.audio;
    selectedAt = Date.now();
    choices = [];
  });
  // Opens a video the owner keeps off other sites on youtube.com in the user's browser, then offers
  // that window as the next capture source. The user still starts sharing through startScreen.
  handle('rooms:capture-browser-video', async (videoId, title) => {
    const video = z
      .string()
      .regex(/^[a-zA-Z0-9_-]{11}$/)
      .parse(videoId);
    const expected = z.string().trim().min(1).max(240).parse(title);
    await enumerateCaptureSources(
      (options) => desktopCapturer.getSources({ ...options, types: ['window'] }),
      () =>
        process.platform === 'darwin'
          ? systemPreferences.getMediaAccessStatus('screen')
          : 'unknown',
    );
    await shell.openExternal(`https://www.youtube.com/watch?v=${video}`);
    const own = new Set(BrowserWindow.getAllWindows().map((window) => window.getMediaSourceId()));
    const deadline = Date.now() + 20000;
    while (Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 800));
      const windows = await desktopCapturer.getSources({
        types: ['window'],
        thumbnailSize: { width: 0, height: 0 },
        fetchWindowIcons: false,
      });
      const match = findBrowserWindow(
        windows.filter((source) => !own.has(source.id)),
        expected,
      );
      if (match) {
        choices = [match];
        choicesAt = Date.now();
        return { id: match.id, name: match.name };
      }
    }
    return null;
  });
  handle('rooms:capture-clear', () => {
    activeCapture = null;
    remote.stop();
    selected = null;
    selectedAudio = false;
    choices = [];
  });
  session.defaultSession.setDisplayMediaRequestHandler(
    (request, callback) => {
      // Fallback picker is explicit and one-shot; never default to the first screen.
      const allowed =
        request.frame === getWindow()?.webContents.mainFrame &&
        isTrusted(request.frame.url) &&
        selected &&
        Date.now() - selectedAt < 15000;
      const source = selected,
        audio = selectedAudio;
      selected = null;
      selectedAudio = false;
      choices = [];
      if (!allowed || !source) {
        callback(null);
        return;
      }
      activeCaptureScope = client;
      activeCapture =
        source.id.startsWith('screen:') && source.display_id
          ? { epoch: randomUUID(), displayId: source.display_id }
          : null;
      callback(displayMediaStreams(source, audio, audioSupport()));
    },
    { useSystemPicker: false },
  );
  const expiredSession = (error: unknown) =>
    error instanceof StoatError && error.status === 401 && error.code !== 'SESSION_CHANGED';
  const restoreSaved = async (stored: { url: string; token: string }) => {
    const request = authRequestEpoch;
    const restored = new StoatClient(stored.url, stored.token);
    const me = await restored.getCurrentUser();
    // A sign-in, sign-up or sign-out started meanwhile owns the session, even while it has
    // briefly cleared `client` to switch accounts.
    if (request !== authRequestEpoch || client || (pendingRestore && pendingRestore !== stored))
      return;
    user = me;
    conversationVault.select(restored.instanceUrl, me.id);
    bind(restored, sessionEpoch);
    remembered = true;
    void restored.connect().catch(() => {});
  };
  const retryRestore = (stored: { url: string; token: string }, delayMs: number) => {
    setTimeout(() => {
      if (pendingRestore !== stored || client) return;
      void restoreSaved(stored)
        .then(() => {
          if (client) emit({ type: 'SESSION_RESTORED', data: null });
          // Skipped for a sign-in that then failed: the saved session still waits for its server.
          else if (pendingRestore === stored) retryRestore(stored, delayMs);
        })
        .catch((error: unknown) => {
          if (pendingRestore !== stored) return;
          if (expiredSession(error)) {
            pendingRestore = null;
            restoreState = 'expired';
            emit({ type: 'SESSION_RESTORED', data: null });
          } else retryRestore(stored, Math.min(60_000, delayMs * 2));
        });
    }, delayMs).unref?.();
  };
  try {
    if (existsSync(vault) && safeStorage.isEncryptionAvailable()) {
      const stored = z
        .object({
          provider: z.literal('stoat'),
          version: z.literal(1),
          url: z.string(),
          token: z.string().min(1),
        })
        .parse(JSON.parse(safeStorage.decryptString(readFileSync(vault))));
      try {
        await restoreSaved(stored);
      } catch (error) {
        if (expiredSession(error)) restoreState = 'expired';
        else {
          // Unreachable (offline, DNS, 5xx, rate limit): keep the token and try again.
          pendingRestore = stored;
          restoreState = 'unreachable';
          retryRestore(stored, 5_000);
        }
      }
    }
  } catch {
    user = null;
    remembered = false; /* A stale/offline vault never means connected. */
  }
  app.on('before-quit', () => {
    clearInterval(presenceTimer);
    conversationVault.flush();
    void client?.disconnect();
    selected = null;
    selectedAudio = false;
    choices = [];
  });
  async function activityRequest(
    roomId: string,
    command?: unknown,
    afterRevision?: number,
  ): Promise<unknown> {
    const current = requireClient();
    const room = id.parse(roomId);
    if (command !== undefined && Buffer.byteLength(JSON.stringify(command), 'utf8') > 65536)
      throw new Error('The activity command is too large.');
    if (command !== undefined) {
      const token = current.getToken()!;
      return postActivityCommand(
        `${new URL(current.instanceUrl).origin}/rooms-activities/v1/rooms/${encodeURIComponent(room)}/activity`,
        room,
        token,
        command,
        fetch,
        () => {
          if (client !== current || current.getToken() !== token)
            throw new StoatError(401, 'SESSION_CHANGED');
        },
      );
    }
    const revision =
      afterRevision === undefined
        ? undefined
        : z.number().int().min(0).max(Number.MAX_SAFE_INTEGER).parse(afterRevision);
    const query =
      command === undefined && revision !== undefined
        ? `?afterRevision=${revision}&waitMs=20000`
        : '';
    const token = current.getToken()!;
    return getActivitySnapshot(
      `${new URL(current.instanceUrl).origin}/rooms-activities/v1/rooms/${encodeURIComponent(room)}/activity${query}`,
      room,
      token,
      fetch,
      () => {
        if (client !== current || current.getToken() !== token)
          throw new StoatError(401, 'SESSION_CHANGED');
      },
    );
  }
  /**
   * Bearer and origin for a main-process call to a Tayfa service (Studio). The token never leaves the main
   * process; `assertSession` fails once the account changed and `signal` aborts at that moment.
   */
  function serviceSession() {
    const current = requireClient();
    const token = current.getToken()!;
    return {
      origin: new URL(current.instanceUrl).origin,
      token,
      signal: sessionRequests.signal,
      assertSession: () => {
        if (client !== current || current.getToken() !== token)
          throw new StoatError(401, 'SESSION_CHANGED');
      },
    };
  }
  return {
    snapshot,
    activityRequest,
    serviceSession,
    serveCinema: cinema.serve,
    close: async () => {
      recoveryEpoch++;
      endSessionRequests();
      hostOps.dispose();
      remote.dispose();
      passwordReset.clear();
      await closeDmCall();
      clearInterval(presenceTimer);
      await client?.disconnect();
      selected = null;
      choices = [];
    },
  };
}
