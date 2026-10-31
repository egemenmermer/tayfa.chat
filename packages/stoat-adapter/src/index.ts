import { restBucket, resetDelay } from './rate-limit';
import type { ConnectionStatus } from '@rooms/contracts';
import {
  SOCIAL_ID_PATTERN,
  SOCIAL_REACTION_PATTERN,
  type SocialCommunityRoleChange,
  type SocialCommunityRoleResult,
  type SocialRolePermissionValues,
  type SocialRolePermissionKey,
  type SocialUser,
  type SocialSpace,
  type SocialSpaceProfile,
  type SocialChannel,
  type SocialMessage,
  type SocialInvite,
  type SocialInviteLinkSummary,
  type SocialSignupPoll,
  type SocialSignupRequests,
  type SocialAttachment,
  type SocialFriend,
  type SocialMember,
  type SocialReadState,
  type GatewayEvent,
  type SocialChannelPermissions,
  type SocialChannelPermissionChange,
  type SocialPermissionValues,
  type SocialChannelAccessInvalidation,
  type SocialCommunityManagement,
  type SocialMemberRoleChange,
  type SocialMemberRemoval,
} from '@rooms/social';
export type {
  SocialUser,
  SocialSpace,
  SocialChannel,
  SocialMessage,
  SocialInvite,
  SocialAttachment,
  SocialFriend,
  SocialReadState,
  GatewayEvent,
} from '@rooms/social';
type Raw = Record<string, any>;
export interface PasswordRecoveryCapabilities {
  emailEnabled: boolean;
  captcha: { required: boolean; siteKey: string | null };
}
export interface PasswordRecoveryRequest {
  email: string;
  captcha?: string;
}
export interface PasswordRecoveryConfirm {
  token: string;
  password: string;
  removeSessions?: boolean;
}
const recoveryTimeoutMs = 15000;
function recoveryText(value: unknown, minimum: number, maximum: number): value is string {
  return (
    typeof value === 'string' &&
    value.length >= minimum &&
    value.length <= maximum &&
    !/[\x00-\x1f\x7f]/.test(value)
  );
}
const roleErrorMessages: Record<string, string> = {
  ROLE_MANAGEMENT_DENIED: 'You do not have permission to manage roles.',
  CANNOT_GRANT_ROLE_PERMISSION: 'You cannot change a role permission you do not have.',
  ROLE_SAVED_REFRESH_FAILED:
    'The role change was saved, but the updated list could not be loaded. Refresh the roles before trying again.',
  INVALID_ROLE_NAME: 'Role names must contain 1 to 32 characters.',
  INVALID_ROLE_COLOR: 'Choose a valid role color.',
  TooManyRoles: 'This community has reached its role limit.',
};
const directMessageErrors: Record<string, string> = {
  DM_FRIEND_REQUIRED: 'You need to be friends before sending a private message.',
  DM_FRIEND_PENDING: 'Your friend request has not been accepted yet.',
  DM_FRIEND_INCOMING: 'This person sent you a friend request. Accept it to send a private message.',
  DM_BLOCKED: 'You cannot send private messages to a blocked user.',
};
const inviteErrors: Record<string, string> = {
  INVITE_ALREADY_CLAIMED: 'This invitation link has reached its limit. Ask for a new link.',
  INVITE_EXPIRED: 'This invitation link has expired. Ask for a new link.',
  INVITE_REVOKED: 'This invitation link was cancelled. Ask for a new link.',
  INVITE_NOT_FOUND: 'This invitation link was not found. It may have expired or been cancelled.',
  INVITE_LIMIT_REACHED:
    'This community already has many active invitation links. Cancel one under Community management, Invitations.',
  REGISTRATION_BUSY: 'Another signup is in progress. Try again in a moment.',
  SIGNUP_UNAVAILABLE: 'This server does not accept sign-up requests without an invitation link.',
  SIGNUP_BUSY: 'Many people are signing up right now. Try again later.',
  SIGNUP_QUEUE_FULL: 'Too many sign-up requests are waiting for approval. Try again later.',
  SIGNUP_ALREADY_REQUESTED: 'This email address already has a sign-up request waiting.',
  SIGNUP_REQUEST_NOT_FOUND: 'This sign-up request is no longer open.',
  SIGNUP_NOT_ENABLED: 'Approved sign-up is not enabled for this community.',
  SIGNUP_CHANNEL_REQUIRED: 'Create a channel in this community before approving requests.',
  INVITE_PERMISSION_REQUIRED: 'You do not have permission to invite people to this community.',
};
/** Sign-in and sign-up failures that would otherwise read as an expired session or a generic rejection. */
const accountErrors: Record<string, string> = {
  InvalidCredentials: 'The email or password is not correct.',
  LockedOut: 'Too many failed sign-in attempts. Wait a few minutes and try again.',
  InvalidInvite: 'This invitation is invalid or has already been used.',
  ShortPassword: 'The password is too short. Choose a longer one.',
  CompromisedPassword: 'This password appears in known data leaks. Choose another one.',
  NETWORK_UNAVAILABLE:
    'The server could not be reached. Check your network connection and the server address.',
};
const ATTACHMENT_MAX_BYTES = 25 * 1024 * 1024;
/** Video types the desktop chat plays inline; QuickTime covers Mac recordings and iPhone videos. */
export const INLINE_VIDEO_TYPES = ['video/mp4', 'video/webm', 'video/quicktime'];
export class StoatError extends Error {
  constructor(
    public status: number,
    public code: string,
  ) {
    super(
      roleErrorMessages[code] ??
        directMessageErrors[code] ??
        inviteErrors[code] ??
        accountErrors[code] ??
        (code === 'REGISTRATION_REQUIRES_SIGN_IN'
          ? 'This email address already has an account. Sign in with it, or use a different email address.'
          : code === 'REGISTRATION_UNCERTAIN'
            ? 'Account creation could not be confirmed. Try signing in before submitting another invitation.'
            : code === 'INVITE_PROVISIONING_UNAVAILABLE'
              ? 'Invitation provisioning is not configured on this server. Ask your administrator.'
              : code === 'INVITE_ADMIN_REQUIRED'
                ? 'Only the space owner can create account invitations.'
                : code === 'EXPIRING_INVITES_UNAVAILABLE'
                  ? 'This Stoat release cannot enforce invitation expiry or one-time use. Ask your administrator to provide an invitation.'
                  : code === 'ACCOUNT_INVITE_REQUIRED'
                    ? 'A separate account invitation is required. Ask your administrator.'
                    : code === 'UnverifiedAccount'
                      ? 'Verify your email before signing in.'
                      : code === 'ADDITIONAL_AUTHENTICATION_REQUIRED'
                        ? 'This account needs additional authentication. Complete the official Stoat sign-in flow.'
                        : status === 401
                          ? 'Your session expired. Sign in again.'
                          : status === 403
                            ? 'You do not have permission for this action.'
                            : status === 404
                              ? 'This room, message or invitation is unavailable.'
                              : status === 413
                                ? 'This file is larger than the server accepts.'
                                : status === 429
                                  ? 'Too many requests. Please wait and retry.'
                                  : status >= 500
                                    ? 'The social server is unavailable. Retry shortly.'
                                    : 'The social server rejected this request. Check the supplied details.'),
    );
    this.name = 'StoatError';
  }
}
export function validateInstanceUrl(value: string, trustedInternalOrigin = false): string {
  const url = new URL(value);
  const local = ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname);
  if (
    (url.protocol !== 'https:' &&
      !((local || trustedInternalOrigin) && url.protocol === 'http:')) ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    !['', '/', '/api', '/api/'].includes(url.pathname)
  )
    throw new Error(
      'Use an HTTPS Stoat origin or /api endpoint, or HTTP loopback for development.',
    );
  return url.origin + (url.pathname.startsWith('/api') ? '/api' : '');
}
const checked = (value: string) => {
  if (!SOCIAL_ID_PATTERN.test(value)) throw new StoatError(400, 'INVALID_ID');
  return encodeURIComponent(value);
};
export const normalizeUser = (u: Raw): SocialUser => ({
  id: String(u._id),
  username: String(u.username ?? ''),
  displayName: String(u.display_name ?? u.username ?? ''),
  avatar: typeof u.avatar?._id === 'string' ? u.avatar._id : null,
  ...(u.bot ? { bot: true } : {}),
  ...(typeof u.discriminator === 'string' ? { discriminator: u.discriminator } : {}),
});
export const normalizeSpace = (s: Raw): SocialSpace => ({
  id: String(s._id),
  name: String(s.name ?? ''),
  icon: typeof s.icon?._id === 'string' ? s.icon._id : null,
  ...(s.owner ? { ownerId: String(s.owner) } : {}),
});
export function ulidTimestamp(id: string): string {
  const alphabet = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
  let ms = 0;
  if (!/^[0-7][0-9A-HJKMNP-TV-Z]{25}$/.test(id)) throw new StoatError(502, 'INVALID_MESSAGE_ID');
  for (const char of id.slice(0, 10)) ms = ms * 32 + alphabet.indexOf(char);
  return new Date(ms).toISOString();
}
const aclBits = {
  view: 1n << 20n,
  send: 1n << 22n,
  files: 1n << 27n,
  manageMessages: 1n << 23n,
  manageChannel: 1n,
} as const;
const safeMask = (1n << 52n) - 1n;
function permissionBits(value: unknown): bigint {
  if (typeof value !== 'number' || !Number.isSafeInteger(value))
    throw new StoatError(502, 'INVALID_PERMISSION_BITS');
  return BigInt(value) & safeMask;
}
function permissionOverride(raw: Raw | undefined) {
  return { allow: raw ? permissionBits(raw.a) : 0n, deny: raw ? permissionBits(raw.d) : 0n };
}
function permissionValues(raw: Raw | undefined): SocialPermissionValues {
  const p = permissionOverride(raw);
  return Object.fromEntries(
    Object.entries(aclBits).map(([key, bit]) => [
      key,
      p.deny & bit ? 'deny' : p.allow & bit ? 'allow' : 'inherit',
    ]),
  ) as SocialPermissionValues;
}
/** Mirrors pinned v0.15.5 ordering, including channel defaults BEFORE server roles. */
export function stoatChannelPermissionBits(
  self: Raw,
  server: Raw,
  channel: Raw,
  member: Raw | null,
): bigint {
  if (self.privileged === true || server.owner === self._id) return safeMask;
  if (!member) return 0n;
  const roles: Raw[] = Object.entries(server.roles ?? {})
    .filter(([id]) => member.roles?.includes(id))
    .map(([id, role]) => ({ id, ...(role as Raw) }));
  const apply = (bits: bigint, raw: Raw | undefined) => {
    const p = permissionOverride(raw);
    return (bits | p.allow) & ~p.deny;
  };
  let bits = apply(permissionBits(server.default_permissions), channel.default_permissions);
  const applyRanked = (entries: { rank: number; override: Raw | undefined }[]) => {
    const groups = new Map<number, { allow: bigint; deny: bigint }>();
    for (const entry of entries) {
      if (!Number.isSafeInteger(entry.rank)) throw new StoatError(502, 'INVALID_ROLE_RESPONSE');
      const p = permissionOverride(entry.override),
        group = groups.get(entry.rank) ?? { allow: 0n, deny: 0n };
      group.allow |= p.allow;
      group.deny |= p.deny;
      groups.set(entry.rank, group);
    }
    // Upstream hash-map tie order is not reproducible. Never advertise an ambiguous allowance.
    for (const [, group] of [...groups].sort((a, b) => b[0] - a[0]))
      bits = (bits | group.allow) & ~group.deny;
  };
  applyRanked(roles.map((role) => ({ rank: role.rank, override: role.permissions })));
  applyRanked(
    roles.map((role) => ({ rank: role.rank, override: channel.role_permissions?.[role.id] })),
  );
  if (member.timeout && Date.parse(member.timeout) > Date.now()) bits &= (1n << 20n) | (1n << 21n);
  return bits & aclBits.view ? bits : 0n;
}
const emptyAcl = (
  channelId: string,
  access: SocialChannelPermissions['access'],
): SocialChannelPermissions => ({
  channelId,
  spaceId: null,
  access,
  effective: {
    view: false,
    send: false,
    files: false,
    manageMessages: false,
    manageChannel: false,
    managePermissions: false,
    readHistory: false,
  },
  subjects: [],
  defaultViewDenied: false,
  memberOverridesSupported: false,
  concurrency: 'last-write-wins',
});
const managementBits = {
  manageServer: 2n,
  manageChannels: 1n,
  manageRoles: 8n,
  managePermissions: 4n,
  assignRoles: 512n,
  kickMembers: 64n,
  banMembers: 128n,
  moveMembers: 1n << 35n,
} as const;
const rolePermissionBits: Record<SocialRolePermissionKey, bigint> = {
  view: 1n << 20n,
  send: 1n << 22n,
  files: 1n << 27n,
  connect: 1n << 30n,
  speak: 1n << 31n,
  video: 1n << 32n,
  manageMessages: 1n << 23n,
  manageChannels: 1n,
  assignRoles: 512n,
  manageRoles: 8n,
  managePermissions: 4n,
  kickMembers: 64n,
  banMembers: 128n,
  moveMembers: 1n << 35n,
};
function rolePermissionValues(raw: Raw | undefined): SocialRolePermissionValues {
  const p = permissionOverride(raw);
  return Object.fromEntries(
    Object.entries(rolePermissionBits).map(([key, bit]) => [
      key,
      p.deny & bit ? 'deny' : p.allow & bit ? 'allow' : 'inherit',
    ]),
  ) as SocialRolePermissionValues;
}
const roleColor = (value: unknown): string | null =>
  typeof value === 'string' && /^#[0-9a-f]{6}$/i.test(value) ? value : null;
const managementUnavailable = (
  spaceId: string,
  access: SocialCommunityManagement['access'],
): SocialCommunityManagement => ({
  spaceId,
  access,
  capabilities: {
    manageServer: false,
    manageChannels: false,
    manageRoles: false,
    managePermissions: false,
    assignRoles: false,
    kickMembers: false,
    banMembers: false,
    moveMembers: false,
  },
  roles: [],
  grantablePermissions: [],
  members: [],
  invites: {
    source: 'rooms-broker',
    state: 'unsupported',
    managementSupported: false,
    reason:
      'This server does not expose account invitation listing or revocation. Existing invitation creation uses the account invitation broker.',
  },
  concurrency: 'last-write-wins',
});
function checkedMember(raw: Raw, spaceId: string, userId: string) {
  if (
    !raw ||
    raw._id?.server !== spaceId ||
    raw._id?.user !== userId ||
    (raw.roles !== undefined &&
      (!Array.isArray(raw.roles) ||
        raw.roles.length > 1000 ||
        raw.roles.some((id: unknown) => typeof id !== 'string' || !SOCIAL_ID_PATTERN.test(id)))) ||
    (raw.timeout != null &&
      (typeof raw.timeout !== 'string' || !Number.isFinite(Date.parse(raw.timeout))))
  )
    throw new StoatError(502, 'INVALID_MEMBER_RESPONSE');
  return raw;
}
function memberRank(member: Raw, roles: Raw[]): number {
  return Math.min(
    ...roles.filter((role) => (member.roles ?? []).includes(role.id)).map((role) => role.rank),
  );
}
/** Server-only management bits: no channel overrides or invented administrator flag. */
function managementPermissionBits(
  self: Raw,
  server: Raw,
  member: Raw | null,
  roles: Raw[],
): bigint {
  if (self.privileged === true || server.owner === self._id) return safeMask;
  if (!member) return 0n;
  let bits = permissionBits(server.default_permissions);
  const groups = new Map<number, { allow: bigint; deny: bigint }>();
  for (const role of roles.filter((role) => (member.roles ?? []).includes(role.id))) {
    const p = permissionOverride(role.permissions),
      g = groups.get(role.rank) ?? { allow: 0n, deny: 0n };
    g.allow |= p.allow;
    g.deny |= p.deny;
    groups.set(role.rank, g);
  }
  // Same-rank upstream hash order is unknown: advertise the conservative denial.
  for (const [, g] of [...groups].sort((a, b) => b[0] - a[0])) bits = (bits | g.allow) & ~g.deny;
  if (member.timeout && Date.parse(member.timeout) > Date.now()) bits &= (1n << 20n) | (1n << 21n);
  return bits;
}
/** Native-only REST/events adapter. No auth, sessions, or credentials enter renderer events. */
export class StoatClient {
  readonly instanceUrl: string;
  readonly apiUrl: string;
  status: ConnectionStatus = 'not-configured';
  private token: string | null;
  private readonly botToken: boolean;
  private currentUser: SocialUser | null = null;
  private fileOrigin: string | null = null;
  // The server's advertised attachment size limit; uploads above it are refused before sending.
  private attachmentLimit = ATTACHMENT_MAX_BYTES;
  private socket: WebSocket | null = null;
  private heartbeat: ReturnType<typeof setInterval> | null = null;
  private retry: ReturnType<typeof setTimeout> | null = null;
  private stopped = true;
  private attempt = 0;
  private pongAt = 0;
  private listeners = new Set<(event: GatewayEvent) => void>();
  private users = new Map<string, Raw>();
  private servers = new Map<string, Raw>();
  private channels = new Map<string, Raw>();
  private messages = new Map<string, Raw>();
  private presenceSubscriptions = new Map<string, number>();
  private managementEpoch = 0;
  private aclEpoch = 0;
  private sessionEpoch = 0;
  private invalidChannels = new Set<string>();
  private readyWait: Promise<void> | null = null;
  private eventQueue = Promise.resolve();
  private restQueues = new Map<string, Promise<unknown>>();
  private restReset = new Map<string, number>();
  private pendingRequests = 0;
  constructor(
    value: string,
    token?: string,
    options?: { trustedInternalOrigin?: boolean; apiRoot?: boolean; botToken?: boolean },
  ) {
    this.instanceUrl = validateInstanceUrl(value, options?.trustedInternalOrigin === true);
    this.apiUrl =
      this.instanceUrl.endsWith('/api') || options?.apiRoot
        ? this.instanceUrl
        : `${this.instanceUrl}/api`;
    this.token = token ?? null;
    this.botToken = options?.botToken === true;
  }
  getToken() {
    return this.token;
  }
  subscribe(listener: (event: GatewayEvent) => void) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
  /** Unauthenticated recovery never attaches an existing user or bot session, retries, or redirects. */
  private async recoveryRequest(
    path: string,
    method: 'GET' | 'POST' | 'PATCH',
    body?: unknown,
  ): Promise<Response> {
    try {
      return await fetch(`${this.apiUrl}${path}`, {
        method,
        headers: { 'Content-Type': 'application/json' },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        credentials: 'omit',
        cache: 'no-store',
        redirect: 'error',
        signal: AbortSignal.timeout(recoveryTimeoutMs),
      });
    } catch {
      // Do not propagate transport exceptions, which can contain URLs or sensitive request details.
      throw new StoatError(503, 'PASSWORD_RECOVERY_NETWORK_UNAVAILABLE');
    }
  }
  async passwordRecoveryCapabilities(): Promise<PasswordRecoveryCapabilities> {
    const response = await this.recoveryRequest('', 'GET');
    if (!response.ok)
      throw new StoatError(response.status, 'PASSWORD_RECOVERY_CONFIGURATION_UNAVAILABLE');
    let root: Raw;
    try {
      const text = await response.text();
      if (text.length > 1_000_000) throw new Error();
      root = JSON.parse(text);
    } catch {
      throw new StoatError(502, 'INVALID_PASSWORD_RECOVERY_CONFIGURATION');
    }
    const captcha = root?.features?.captcha;
    if (
      typeof root?.features?.email !== 'boolean' ||
      typeof captcha?.enabled !== 'boolean' ||
      typeof captcha?.key !== 'string' ||
      captcha.key.length > 256 ||
      /[\x00-\x1f\x7f]/.test(captcha.key) ||
      (captcha.enabled && !captcha.key.trim())
    ) {
      throw new StoatError(502, 'INVALID_PASSWORD_RECOVERY_CONFIGURATION');
    }
    return {
      emailEnabled: root.features.email,
      captcha: { required: captcha.enabled, siteKey: captcha.enabled ? captcha.key : null },
    };
  }
  /** Accepted means only that upstream accepted the request; it never proves account existence or delivery. */
  async requestPasswordRecovery(input: PasswordRecoveryRequest): Promise<{ accepted: true }> {
    if (
      !input ||
      !recoveryText(input.email, 3, 254) ||
      !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(input.email) ||
      (input.captcha !== undefined && !recoveryText(input.captcha, 1, 4096))
    )
      throw new StoatError(400, 'INVALID_PASSWORD_RECOVERY_REQUEST');
    const capabilities = await this.passwordRecoveryCapabilities();
    if (!capabilities.emailEnabled)
      throw new StoatError(501, 'PASSWORD_RECOVERY_EMAIL_UNAVAILABLE');
    if (capabilities.captcha.required && !input.captcha?.trim())
      throw new StoatError(400, 'PASSWORD_RECOVERY_CAPTCHA_REQUIRED');
    const response = await this.recoveryRequest('/auth/account/reset_password', 'POST', {
      email: input.email,
      ...(input.captcha === undefined ? {} : { captcha: input.captcha }),
    });
    if (response.status !== 204)
      throw new StoatError(response.ok ? 502 : response.status, 'PASSWORD_RECOVERY_REQUEST_FAILED');
    return { accepted: true };
  }
  /** Reset secrets exist only in this call. Upstream enforces token expiry and password policy. */
  async confirmPasswordRecovery(input: PasswordRecoveryConfirm): Promise<{ completed: true }> {
    if (
      !input ||
      !recoveryText(input.token, 1, 512) ||
      !input.token.trim() ||
      !recoveryText(input.password, 8, 1024) ||
      (input.removeSessions !== undefined && typeof input.removeSessions !== 'boolean')
    )
      throw new StoatError(400, 'INVALID_PASSWORD_RECOVERY_CONFIRMATION');
    const response = await this.recoveryRequest('/auth/account/reset_password', 'PATCH', {
      token: input.token,
      password: input.password,
      remove_sessions: input.removeSessions ?? true,
    });
    if (response.status !== 204)
      throw new StoatError(
        response.ok ? 502 : response.status,
        response.status === 401
          ? 'PASSWORD_RECOVERY_INVALID_TOKEN'
          : 'PASSWORD_RECOVERY_CONFIRMATION_FAILED',
      );
    return { completed: true };
  }
  private emit(type: string, data: unknown) {
    for (const listener of this.listeners) listener({ type, data });
  }
  private setStatus(status: ConnectionStatus) {
    this.status = status;
    this.emit('CONNECTION_STATUS', status);
  }
  private async request<T>(
    path: string,
    method = 'GET',
    body?: unknown,
    additionalHeaders: Record<string, string> = {},
  ): Promise<T> {
    if (this.pendingRequests >= 128) throw new StoatError(429, 'CLIENT_QUEUE_FULL');
    const bucket = restBucket(path, method),
      token = this.token,
      sessionEpoch = this.sessionEpoch,
      payload = body === undefined ? undefined : JSON.stringify(body);
    this.pendingRequests++;
    const work = (this.restQueues.get(bucket) ?? Promise.resolve())
      .catch(() => {})
      .then(async () => {
        const deadline = Date.now() + 60000;
        for (let attempt = 0; attempt < 3; attempt++) {
          const wait = (this.restReset.get(bucket) ?? 0) - Date.now();
          if (wait > 0) {
            if (Date.now() + wait > deadline) throw new StoatError(429, 'RATE_LIMITED');
            await new Promise((resolve) => setTimeout(resolve, wait));
          }
          if (this.token !== token || this.sessionEpoch !== sessionEpoch)
            throw new StoatError(401, 'SESSION_CHANGED');
          let response: Response;
          try {
            response = await fetch(`${this.apiUrl}${path}`, {
              method,
              headers: {
                'Content-Type': 'application/json',
                ...additionalHeaders,
                ...(token ? { [this.botToken ? 'x-bot-token' : 'x-session-token']: token } : {}),
              },
              body: payload,
              redirect: 'error',
              signal: AbortSignal.timeout(15000),
            });
          } catch {
            throw new StoatError(503, 'NETWORK_UNAVAILABLE');
          }
          if (this.token !== token || this.sessionEpoch !== sessionEpoch)
            throw new StoatError(401, 'SESSION_CHANGED');
          if (response.ok) {
            const delay = resetDelay(response);
            if (response.headers.get('x-ratelimit-remaining') === '0' && delay !== null)
              this.restReset.set(bucket, Date.now() + delay);
            return response.status === 204 ? (undefined as T) : (response.json() as Promise<T>);
          }
          const data = (await response.json().catch(() => ({}))) as Raw;
          // Upstream's rate-limit fairing rejects before route execution. Only a
          // definite 429 with bounded reset metadata is safe to retry. Never retry
          // a network failure or an ambiguous mutation response.
          const delay = response.status === 429 ? resetDelay(response, data) : null;
          if (delay !== null && attempt < 2 && Date.now() + delay <= deadline) {
            this.restReset.set(bucket, Date.now() + delay);
            continue;
          }
          const deniedChannel =
            method === 'GET' && [403, 404].includes(response.status)
              ? /^\/channels\/([A-Za-z0-9_-]{1,128})(?:[/?]|$)/.exec(path)?.[1]
              : undefined;
          // A deleted message is not a deleted channel; upstream answers UnknownChannel for that.
          const messageGone =
            response.status === 404 &&
            /^\/channels\/[^/?]+\/messages\/[^/?]+/.test(path) &&
            data.type !== 'UnknownChannel';
          if (deniedChannel && !messageGone)
            this.invalidateChannelAccess(
              [deniedChannel],
              response.status === 404 ? 'removed' : 'permissions-changed',
            );
          throw new StoatError(response.status, String(data.type ?? 'REQUEST_FAILED'));
        }
        throw new StoatError(429, 'RATE_LIMITED');
      });
    this.restQueues.set(bucket, work);
    try {
      return await work;
    } finally {
      this.pendingRequests--;
      if (this.restQueues.get(bucket) === work) this.restQueues.delete(bucket);
    }
  }
  private async authenticate(email: string, password: string) {
    const response = await this.request<Raw>('/auth/session/login', 'POST', {
      email,
      password,
      friendly_name: 'ROOMS Desktop',
    });
    if (typeof response.token !== 'string')
      throw new StoatError(400, 'ADDITIONAL_AUTHENTICATION_REQUIRED');
    this.token = response.token;
  }
  async login(email: string, password: string) {
    await this.authenticate(email, password);
    return this.getCurrentUser();
  }
  async register(input: {
    email: string;
    password: string;
    username: string;
    inviteCode: string;
    accountInviteCode?: string;
  }) {
    // Signup tickets belong to Tayfa. Official account/community invitation secrets remain in the broker.
    let response: Response;
    try {
      response = await fetch(`${new URL(this.instanceUrl).origin}/rooms-access/v1/auth/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: input.email,
          password: input.password,
          username: input.username,
          inviteCode: input.inviteCode,
        }),
        redirect: 'error',
        signal: AbortSignal.timeout(60000),
      });
    } catch {
      throw new StoatError(503, 'REGISTRATION_UNCERTAIN');
    }
    const data = (await response.json().catch(() => ({}))) as Raw;
    if (!response.ok)
      throw new StoatError(
        response.status,
        data.error === 'OperationFailed'
          ? 'REGISTRATION_REQUIRES_SIGN_IN'
          : String(data.error ?? 'REQUEST_FAILED'),
      );
    if (typeof data.token !== 'string') throw new StoatError(502, 'INVALID_SESSION_RESPONSE');
    this.token = data.token;
    return this.getCurrentUser();
  }
  /** Called only by the trusted registration broker after claiming its own durable signup ticket. */
  async registerUpstream(
    input: {
      email: string;
      password: string;
      username: string;
      inviteCode: string;
      accountInviteCode: string;
    },
    hooks: { onStage?(stage: 'account-create' | 'account-created'): void } = {},
  ) {
    await this.inspectUpstreamInvite(input.inviteCode);
    // The broker uses these stages to tell a definite rejection from an uncertain account.
    hooks.onStage?.('account-create');
    try {
      await this.request('/auth/account/create', 'POST', {
        email: input.email,
        password: input.password,
        invite: input.accountInviteCode,
      });
    } catch (error) {
      // Upstream answers 500 OperationFailed when the (normalised) email already has an account
      // and it cannot mail a reset; nothing was created, so report a definite refusal.
      if (error instanceof StoatError && error.code === 'OperationFailed')
        throw new StoatError(409, 'OperationFailed');
      throw error;
    }
    hooks.onStage?.('account-created');
    await this.authenticate(input.email, input.password);
    const onboarding = await this.request<{ onboarding: boolean }>('/onboard/hello');
    if (onboarding.onboarding)
      await this.request('/onboard/complete', 'POST', { username: input.username });
    await this.acceptInvite(input.inviteCode);
    return this.getCurrentUser();
  }
  async getCurrentUser() {
    const raw = await this.request<Raw>('/users/@me');
    this.users.set(raw._id, raw);
    this.currentUser = normalizeUser(raw);
    return this.currentUser;
  }
  private normalizeChannel(c: Raw): SocialChannel {
    return {
      id: String(c._id),
      spaceId: c.server ? String(c.server) : null,
      name: String(
        c.name ?? (c.channel_type === 'SavedMessages' ? 'Saved messages' : 'Direct message'),
      ),
      type:
        c.channel_type === 'VoiceChannel' || c.voice
          ? 2
          : ['DirectMessage', 'Group', 'SavedMessages'].includes(c.channel_type)
            ? 1
            : 0,
      topic: typeof c.description === 'string' ? c.description : null,
      lastMessageId: typeof c.last_message_id === 'string' ? c.last_message_id : null,
      ...(Array.isArray(c.recipients)
        ? {
            recipients: c.recipients.map((id: string) =>
              normalizeUser(this.users.get(id) ?? { _id: id, username: id }),
            ),
          }
        : {}),
    };
  }
  private async normalizeMessage(m: Raw): Promise<SocialMessage> {
    const epoch = this.aclEpoch;
    let author = m.user ?? this.users.get(m.author);
    if (!author) {
      try {
        author = await this.request<Raw>(`/users/${checked(String(m.author))}`);
      } catch (error) {
        // A removed account must not take the whole page of messages down with it.
        if (!(error instanceof StoatError && error.status === 404)) throw error;
        author = { _id: String(m.author), username: String(m.author) };
      }
      this.users.set(author._id, author);
    }
    if (this.invalidChannels.has(m.channel) || epoch !== this.aclEpoch)
      throw new StoatError(409, 'ACCESS_CHANGED');
    this.messages.set(m._id, m);
    if (this.messages.size > 1000) this.messages.delete(this.messages.keys().next().value!);
    return {
      id: String(m._id),
      channelId: String(m.channel),
      author: normalizeUser(author),
      content: typeof m.content === 'string' ? m.content : '',
      timestamp: ulidTimestamp(String(m._id)),
      editedTimestamp: m.edited ?? null,
      ...(Array.isArray(m.attachments)
        ? { attachments: m.attachments.map((file: Raw) => this.normalizeAttachment(file)) }
        : {}),
      ...(m.reactions && typeof m.reactions === 'object'
        ? {
            reactions: Object.fromEntries(
              Object.entries(m.reactions)
                .filter(([, ids]) => Array.isArray(ids))
                .map(([emoji, ids]) => [
                  emoji,
                  (ids as unknown[]).filter((id): id is string => typeof id === 'string'),
                ]),
            ),
          }
        : {}),
      ...(Array.isArray(m.mentions)
        ? { mentions: m.mentions.filter((id: unknown) => typeof id === 'string') }
        : {}),
      ...(Array.isArray(m.replies)
        ? { replies: m.replies.filter((id: unknown) => typeof id === 'string') }
        : {}),
    };
  }
  private configureFileOrigin(root: Raw) {
    const limit = root.features?.limits?.default?.file_upload_size_limits?.attachments;
    if (Number.isSafeInteger(limit) && limit > 0)
      this.attachmentLimit = Math.min(limit, ATTACHMENT_MAX_BYTES);
    const raw = root.features?.autumn;
    if (raw?.enabled !== true || typeof raw.url !== 'string') return;
    let url: URL;
    try {
      url = new URL(raw.url);
    } catch {
      return;
    }
    if (
      url.origin !== new URL(this.instanceUrl).origin ||
      url.username ||
      url.password ||
      url.search ||
      url.hash
    )
      return;
    this.fileOrigin = url.href.replace(/\/$/, '');
  }
  private normalizeAttachment(file: Raw): SocialAttachment {
    const id = String(file._id);
    const name = typeof file.filename === 'string' ? file.filename.slice(0, 255) : 'Attachment';
    return {
      id,
      name,
      size: Number.isSafeInteger(file.size) && file.size >= 0 ? file.size : 0,
      mime: typeof file.content_type === 'string' ? file.content_type : 'application/octet-stream',
      ...(this.fileOrigin && SOCIAL_ID_PATTERN.test(id)
        ? {
            url: `${this.fileOrigin}/attachments/${encodeURIComponent(id)}/${encodeURIComponent(name)}`,
          }
        : {}),
    };
  }
  /** The largest attachment this server accepts, in bytes. */
  async attachmentSizeLimit(): Promise<number> {
    if (!this.fileOrigin) this.configureFileOrigin(await this.request<Raw>(''));
    return this.attachmentLimit;
  }
  async uploadAttachment(bytes: Uint8Array, name: string, mime: string): Promise<SocialAttachment> {
    if (
      !bytes.byteLength ||
      bytes.byteLength > ATTACHMENT_MAX_BYTES ||
      !name ||
      name.length > 255 ||
      /[\r\n/\\]/.test(name) ||
      !/^[-\w.+]+\/[-\w.+]+$/.test(mime)
    )
      throw new StoatError(400, 'INVALID_ATTACHMENT');
    if (!this.fileOrigin) this.configureFileOrigin(await this.request<Raw>(''));
    if (!this.fileOrigin) throw new StoatError(501, 'ATTACHMENTS_UNAVAILABLE');
    if (bytes.byteLength > this.attachmentLimit) throw new StoatError(413, 'ATTACHMENT_TOO_LARGE');
    const form = new FormData();
    form.append('file', new Blob([new Uint8Array(bytes)], { type: mime }), name);
    let response: Response;
    try {
      response = await fetch(`${this.fileOrigin}/attachments`, {
        method: 'POST',
        headers: this.token
          ? { [this.botToken ? 'x-bot-token' : 'x-session-token']: this.token }
          : {},
        body: form,
        redirect: 'error',
        signal: AbortSignal.timeout(60000),
      });
    } catch {
      throw new StoatError(503, 'UPLOAD_UNCERTAIN');
    }
    if (!response.ok) throw new StoatError(response.status, 'ATTACHMENT_UPLOAD_DENIED');
    const value = (await response.json()) as Raw;
    if (typeof value.id !== 'string' || !SOCIAL_ID_PATTERN.test(value.id))
      throw new StoatError(502, 'INVALID_ATTACHMENT_RESPONSE');
    return { id: value.id, name, size: bytes.byteLength, mime };
  }
  async listFriends(): Promise<SocialFriend[]> {
    const self = await this.request<Raw>('/users/@me');
    const relations = (self.relations ?? []).filter((r: Raw) =>
      ['Friend', 'Incoming', 'Outgoing', 'Blocked'].includes(r.status),
    );
    if (relations.length > 1000) throw new StoatError(502, 'RELATIONSHIP_LIMIT');
    return Promise.all(
      relations.map(async (r: Raw) => {
        const u = await this.request<Raw>(`/users/${checked(r._id)}`);
        this.users.set(u._id, u);
        const status =
          u.online === false || u.status?.presence === 'Invisible'
            ? 'invisible'
            : u.online === true
              ? (({ Idle: 'idle', Busy: 'dnd', Focus: 'dnd' } as Record<string, string>)[
                  u.status?.presence
                ] ?? 'online')
              : 'unknown';
        return {
          user: normalizeUser(u),
          relationship: r.status.toLowerCase(),
          status,
        } as SocialFriend;
      }),
    );
  }
  async addFriend(username: string) {
    if (!/^.{2,32}#[0-9]{4}$/.test(username))
      throw new StoatError(400, 'USERNAME_DISCRIMINATOR_REQUIRED');
    await this.request('/users/friend', 'POST', { username });
  }
  async removeFriend(userId: string) {
    await this.request(`/users/${checked(userId)}/friend`, 'DELETE');
  }
  /**
   * Attachments of a message this session already loaded with authorization. The gateway keeps
   * the cache current (deletes, access invalidation, reconnect), so only a miss asks upstream.
   */
  private async messageAttachments(channelId: string, messageId: string) {
    const raw = this.messages.get(messageId);
    if (
      raw &&
      raw.channel === channelId &&
      this.status === 'connected' &&
      !this.invalidChannels.has(channelId)
    )
      return Array.isArray(raw.attachments)
        ? raw.attachments.map((file: Raw) => this.normalizeAttachment(file))
        : [];
    return (await this.getMessage(channelId, messageId)).attachments ?? [];
  }
  async attachmentFile(channelId: string, messageId: string, fileId: string) {
    const epoch = this.aclEpoch;
    if (!this.fileOrigin) this.configureFileOrigin(await this.request<Raw>(''));
    const message = await this.getMessage(channelId, messageId);
    const file = message.attachments?.find((item) => item.id === fileId);
    if (!file?.url) throw new StoatError(404, 'ATTACHMENT_UNAVAILABLE');
    const response = await fetch(file.url, {
      redirect: 'error',
      signal: AbortSignal.timeout(30000),
    });
    if (!response.ok) throw new StoatError(response.status, 'ATTACHMENT_UNAVAILABLE');
    const reader = response.body?.getReader();
    if (!reader) throw new StoatError(502, 'ATTACHMENT_UNAVAILABLE');
    const parts: Uint8Array[] = [];
    let size = 0;
    try {
      while (true) {
        const next = await reader.read();
        if (next.done) break;
        size += next.value.length;
        if (size > 25 * 1024 * 1024) throw new StoatError(413, 'ATTACHMENT_TOO_LARGE');
        parts.push(next.value);
      }
    } finally {
      await reader.cancel();
    }
    const fresh = await this.getMessage(channelId, messageId);
    if (epoch !== this.aclEpoch || !fresh.attachments?.some((item) => item.id === fileId))
      throw new StoatError(409, 'ACCESS_CHANGED');
    return { name: file.name, bytes: Buffer.concat(parts) };
  }
  async attachmentImage(
    channelId: string,
    messageId: string,
    fileId: string,
  ): Promise<string | null> {
    const epoch = this.aclEpoch;
    if (!this.fileOrigin) this.configureFileOrigin(await this.request<Raw>(''));
    const attachment = (await this.messageAttachments(channelId, messageId)).find(
      (file) => file.id === fileId,
    );
    if (
      !attachment?.url ||
      !['image/png', 'image/jpeg', 'image/webp', 'image/gif'].includes(attachment.mime)
    )
      return null;
    const response = await fetch(attachment.url, {
      redirect: 'error',
      signal: AbortSignal.timeout(15000),
    });
    if (!response.ok) throw new StoatError(response.status, 'ATTACHMENT_UNAVAILABLE');
    const mime = response.headers.get('content-type')?.split(';')[0];
    if (!mime || !['image/png', 'image/jpeg', 'image/webp', 'image/gif'].includes(mime))
      return null;
    const reader = response.body?.getReader();
    if (!reader) return null;
    let size = 0;
    const parts: Uint8Array[] = [];
    try {
      while (true) {
        const next = await reader.read();
        if (next.done) break;
        size += next.value.length;
        if (size > 25 * 1024 * 1024) throw new StoatError(413, 'ATTACHMENT_TOO_LARGE');
        parts.push(next.value);
      }
    } finally {
      await reader.cancel();
    }
    const fresh = await this.messageAttachments(channelId, messageId);
    if (!fresh.some((file) => file.id === fileId)) throw new StoatError(409, 'ACCESS_CHANGED');
    if (epoch !== this.aclEpoch) throw new StoatError(409, 'ACCESS_CHANGED');
    return `data:${mime};base64,${Buffer.concat(parts).toString('base64')}`;
  }
  /** A video attachment's bytes for inline playback, read with the same access checks as photos. */
  async attachmentVideo(
    channelId: string,
    messageId: string,
    fileId: string,
  ): Promise<{ mime: string; bytes: Uint8Array } | null> {
    const epoch = this.aclEpoch;
    if (!this.fileOrigin) this.configureFileOrigin(await this.request<Raw>(''));
    const attachment = (await this.messageAttachments(channelId, messageId)).find(
      (file) => file.id === fileId,
    );
    if (!attachment?.url || !INLINE_VIDEO_TYPES.includes(attachment.mime)) return null;
    const response = await fetch(attachment.url, {
      redirect: 'error',
      signal: AbortSignal.timeout(60000),
    });
    if (!response.ok) throw new StoatError(response.status, 'ATTACHMENT_UNAVAILABLE');
    const reader = response.body?.getReader();
    if (!reader) return null;
    let size = 0;
    const parts: Uint8Array[] = [];
    try {
      while (true) {
        const next = await reader.read();
        if (next.done) break;
        size += next.value.length;
        if (size > ATTACHMENT_MAX_BYTES) throw new StoatError(413, 'ATTACHMENT_TOO_LARGE');
        parts.push(next.value);
      }
    } finally {
      await reader.cancel();
    }
    const fresh = await this.messageAttachments(channelId, messageId);
    if (!fresh.some((file) => file.id === fileId)) throw new StoatError(409, 'ACCESS_CHANGED');
    if (epoch !== this.aclEpoch) throw new StoatError(409, 'ACCESS_CHANGED');
    return { mime: attachment.mime, bytes: new Uint8Array(Buffer.concat(parts)) };
  }
  /** An image from the file server as a data URL, or null if missing, too big or not an image. */
  private async fileImage(tag: 'icons' | 'banners', id: string, limit: number) {
    if (!this.fileOrigin) this.configureFileOrigin(await this.request<Raw>(''));
    if (!this.fileOrigin) return null;
    const response = await fetch(`${this.fileOrigin}/${tag}/${checked(id)}`, {
      redirect: 'error',
      signal: AbortSignal.timeout(15000),
    });
    if (!response.ok) return null;
    const mime = response.headers.get('content-type')?.split(';')[0];
    if (!mime || !['image/png', 'image/jpeg', 'image/webp', 'image/gif'].includes(mime))
      return null;
    const reader = response.body?.getReader();
    if (!reader) return null;
    let size = 0;
    const parts: Uint8Array[] = [];
    try {
      while (true) {
        const next = await reader.read();
        if (next.done) break;
        size += next.value.length;
        if (size > limit) return null;
        parts.push(next.value);
      }
    } finally {
      await reader.cancel();
    }
    return `data:${mime};base64,${Buffer.concat(parts).toString('base64')}`;
  }
  /** A community's profile for its settings page: name, description, icon and banner. */
  async spaceProfile(spaceId: string): Promise<SocialSpaceProfile> {
    const raw = await this.request<Raw>(`/servers/${checked(spaceId)}`);
    if (raw._id !== spaceId || typeof raw.name !== 'string')
      throw new StoatError(502, 'INVALID_SERVER_RESPONSE');
    this.servers.set(raw._id, { ...this.servers.get(raw._id), ...raw });
    const [icon, banner] = await Promise.all([
      typeof raw.icon?._id === 'string' ? this.fileImage('icons', raw.icon._id, 2_500_000) : null,
      typeof raw.banner?._id === 'string'
        ? this.fileImage('banners', raw.banner._id, 6_000_000)
        : null,
    ]);
    return {
      id: raw._id,
      name: raw.name,
      description: typeof raw.description === 'string' ? raw.description.slice(0, 1024) : '',
      icon,
      banner,
      ...(raw.owner ? { ownerId: String(raw.owner) } : {}),
    };
  }
  /**
   * Saves a community profile. New images are uploaded to the file server first; null removes
   * one. The server checks Manage Server for every change.
   */
  async updateSpaceProfile(
    spaceId: string,
    change: {
      name?: string;
      description?: string;
      icon?: { bytes: Uint8Array; name: string; mime: string } | null;
      banner?: { bytes: Uint8Array; name: string; mime: string } | null;
    },
  ): Promise<SocialSpaceProfile> {
    checked(spaceId);
    const body: Raw = { remove: [] };
    if (change.name !== undefined) {
      const name = change.name.trim();
      if (!name || name.length > 32 || /[\x00-\x1f\x7f]/.test(name))
        throw new StoatError(400, 'INVALID_SERVER_NAME');
      body.name = name;
    }
    if (change.description !== undefined) {
      const description = change.description.trim();
      if (description.length > 1024) throw new StoatError(400, 'INVALID_SERVER_DESCRIPTION');
      if (description) body.description = description;
      else body.remove.push('Description');
    }
    for (const [key, tag, field, limit] of [
      ['icon', 'icons', 'Icon', 2_500_000],
      ['banner', 'banners', 'Banner', 6_000_000],
    ] as const) {
      const image = change[key];
      if (image === undefined) continue;
      if (image === null) {
        body.remove.push(field);
        continue;
      }
      if (
        !image.bytes.length ||
        image.bytes.length > limit ||
        !['image/png', 'image/jpeg', 'image/webp', 'image/gif'].includes(image.mime)
      )
        throw new StoatError(400, 'INVALID_SERVER_IMAGE');
      if (!this.fileOrigin) this.configureFileOrigin(await this.request<Raw>(''));
      if (!this.fileOrigin) throw new StoatError(501, 'ATTACHMENTS_UNAVAILABLE');
      const form = new FormData();
      form.append(
        'file',
        new Blob([new Uint8Array(image.bytes)], { type: image.mime }),
        image.name,
      );
      const response = await fetch(`${this.fileOrigin}/${tag}`, {
        method: 'POST',
        headers: this.token
          ? { [this.botToken ? 'x-bot-token' : 'x-session-token']: this.token }
          : {},
        body: form,
        redirect: 'error',
        signal: AbortSignal.timeout(60000),
      });
      const data = (await response.json().catch(() => ({}))) as Raw;
      if (!response.ok || typeof data.id !== 'string' || !SOCIAL_ID_PATTERN.test(data.id))
        throw new StoatError(response.ok ? 502 : response.status, 'SERVER_IMAGE_UPLOAD_FAILED');
      body[key] = data.id;
    }
    if (!body.remove.length) delete body.remove;
    const raw = await this.request<Raw>(`/servers/${spaceId}`, 'PATCH', body);
    if (raw._id !== spaceId) throw new StoatError(502, 'INVALID_SERVER_RESPONSE');
    this.servers.set(raw._id, { ...this.servers.get(raw._id), ...raw });
    this.emit('SOCIAL_REFRESH', null);
    return this.spaceProfile(spaceId);
  }
  async avatar(userId: string): Promise<string | null> {
    const raw = await this.request<Raw>(`/users/${checked(userId)}`);
    this.users.set(userId, raw);
    if (typeof raw.avatar?._id !== 'string') return null;
    if (!this.fileOrigin) this.configureFileOrigin(await this.request<Raw>(''));
    if (!this.fileOrigin) return null;
    const response = await fetch(`${this.fileOrigin}/avatars/${checked(raw.avatar._id)}`, {
      redirect: 'error',
      signal: AbortSignal.timeout(10000),
    });
    if (!response.ok) return null;
    const mime = response.headers.get('content-type')?.split(';')[0];
    if (!mime || !['image/png', 'image/jpeg', 'image/webp', 'image/gif'].includes(mime))
      return null;
    const reader = response.body?.getReader();
    if (!reader) return null;
    let size = 0;
    const parts: Uint8Array[] = [];
    try {
      while (true) {
        const next = await reader.read();
        if (next.done) break;
        size += next.value.length;
        if (size > 2_000_000) return null;
        parts.push(next.value);
      }
    } finally {
      await reader.cancel();
    }
    return `data:${mime};base64,${Buffer.concat(parts).toString('base64')}`;
  }
  async uploadAvatar(bytes: Uint8Array, name: string, mime: string) {
    if (
      !bytes.length ||
      bytes.length > 2_000_000 ||
      !['image/png', 'image/jpeg', 'image/webp'].includes(mime)
    )
      throw new StoatError(400, 'INVALID_AVATAR');
    if (!this.fileOrigin) this.configureFileOrigin(await this.request<Raw>(''));
    if (!this.fileOrigin) throw new StoatError(501, 'ATTACHMENTS_UNAVAILABLE');
    const form = new FormData();
    form.append('file', new Blob([new Uint8Array(bytes)], { type: mime }), name);
    const response = await fetch(`${this.fileOrigin}/avatars`, {
      method: 'POST',
      headers: this.token ? { 'x-session-token': this.token } : {},
      body: form,
      redirect: 'error',
      signal: AbortSignal.timeout(30000),
    });
    const data = (await response.json().catch(() => ({}))) as Raw;
    if (!response.ok || typeof data.id !== 'string')
      throw new StoatError(response.status, 'AVATAR_UPLOAD_FAILED');
    const raw = await this.request<Raw>('/users/@me', 'PATCH', { avatar: data.id });
    this.users.set(raw._id, raw);
    this.currentUser = normalizeUser(raw);
    return this.currentUser;
  }
  async updateProfile(input: { displayName: string; bio?: string; statusText?: string }) {
    const body: Raw = { display_name: input.displayName, remove: [] };
    if (input.bio !== undefined) {
      if (input.bio) body.profile = { content: input.bio };
      else body.remove.push('ProfileContent');
    }
    if (input.statusText !== undefined) {
      if (input.statusText) body.status = { text: input.statusText };
      else body.remove.push('StatusText');
    }
    const raw = await this.request<Raw>('/users/@me', 'PATCH', body);
    this.users.set(raw._id, raw);
    this.currentUser = normalizeUser(raw);
    return this.currentUser;
  }
  async react(channelId: string, messageId: string, emoji: string, remove = false) {
    if (!SOCIAL_REACTION_PATTERN.test(emoji)) throw new StoatError(400, 'INVALID_EMOJI');
    await this.request(
      `/channels/${checked(channelId)}/messages/${checked(messageId)}/reactions/${encodeURIComponent(emoji)}`,
      remove ? 'DELETE' : 'PUT',
    );
    const message = await this.request<Raw>(
      `/channels/${checked(channelId)}/messages/${checked(messageId)}`,
    );
    this.emit('MESSAGE_UPDATE', await this.normalizeMessage(message));
  }
  async createSpace(name: string): Promise<SocialSpace> {
    if (!name.trim() || name.trim().length > 32 || /[\x00-\x1f\x7f]/.test(name))
      throw new StoatError(400, 'INVALID_SERVER_NAME');
    const result = await this.request<Raw>('/servers/create', 'POST', { name: name.trim() });
    if (
      !result.server ||
      typeof result.server._id !== 'string' ||
      !SOCIAL_ID_PATTERN.test(result.server._id) ||
      typeof result.server.name !== 'string'
    )
      throw new StoatError(502, 'INVALID_SERVER_RESPONSE');
    this.servers.set(result.server._id, result.server);
    for (const channel of result.channels ?? []) {
      if (channel && typeof channel._id === 'string' && SOCIAL_ID_PATTERN.test(channel._id))
        this.channels.set(channel._id, channel);
    }
    this.emit('SOCIAL_REFRESH', null);
    return normalizeSpace(result.server);
  }
  async renameSpace(spaceId: string, name: string): Promise<SocialSpace> {
    if (!name.trim() || name.trim().length > 32 || /[\x00-\x1f\x7f]/.test(name))
      throw new StoatError(400, 'INVALID_SERVER_NAME');
    const raw = await this.request<Raw>(`/servers/${checked(spaceId)}`, 'PATCH', {
      name: name.trim(),
    });
    if (raw._id !== spaceId || typeof raw.name !== 'string')
      throw new StoatError(502, 'INVALID_SERVER_RESPONSE');
    this.servers.set(raw._id, raw);
    this.emit('SOCIAL_REFRESH', null);
    return normalizeSpace(raw);
  }
  async listSpaces() {
    await this.ensureReady();
    return [...this.servers.values()].map(normalizeSpace);
  }
  async listChannels(spaceId: string) {
    const epoch = this.aclEpoch,
      // Upstream allows five server-bucket calls per ten seconds and every social refresh lists
      // channels, so re-reading the server here starves channel writes. While the gateway is
      // connected, Ready/ServerUpdate keep the channel order current; each channel is still
      // fetched below, which is where access is enforced.
      cached = this.status === 'connected' ? this.servers.get(checked(spaceId)) : undefined,
      raw = Array.isArray(cached?.channels) ? cached : await this.getServer(spaceId);
    const channels = await Promise.all(
      (raw.channels ?? []).map(async (id: string) => {
        try {
          return await this.getChannel(id);
        } catch (error) {
          if (error instanceof StoatError && [403, 404].includes(error.status)) return null;
          throw error;
        }
      }),
    );
    if (epoch !== this.aclEpoch) throw new StoatError(409, 'ACCESS_CHANGED');
    const visible = channels.filter((c: Raw | null): c is Raw => c !== null);
    for (const c of visible) this.channels.set(c._id, c);
    return visible.map((c: Raw) => this.normalizeChannel(c));
  }
  async createChannel(spaceId: string, name: string, type: 'text' | 'voice') {
    const raw = await this.request<Raw>(`/servers/${checked(spaceId)}/channels`, 'POST', {
      type: 'Text',
      name,
      ...(type === 'voice' ? { voice: {} } : {}),
    });
    this.channels.set(raw._id, raw);
    // The gateway's ServerUpdate may arrive after the caller's refresh.
    const server = this.servers.get(spaceId);
    if (Array.isArray(server?.channels) && !server.channels.includes(raw._id))
      this.servers.set(spaceId, { ...server, channels: [...server.channels, raw._id] });
    return this.normalizeChannel(raw);
  }
  async renameChannel(channelId: string, name: string) {
    const raw = await this.request<Raw>(`/channels/${checked(channelId)}`, 'PATCH', { name });
    this.channels.set(raw._id, raw);
    return this.normalizeChannel(raw);
  }
  async deleteChannel(channelId: string) {
    await this.request(`/channels/${checked(channelId)}`, 'DELETE');
    const spaceId = this.channels.get(channelId)?.server,
      server = typeof spaceId === 'string' ? this.servers.get(spaceId) : undefined;
    if (Array.isArray(server?.channels))
      this.servers.set(spaceId, {
        ...server,
        channels: server.channels.filter((id: string) => id !== channelId),
      });
    this.channels.delete(channelId);
  }
  async getServer(spaceId: string) {
    return this.request<Raw>(`/servers/${checked(spaceId)}`);
  }
  /** Private-call authorization uses upstream membership and the caller's current relationship. */
  async getCallPeer(dmId: string) {
    const [self, channel] = await Promise.all([
      this.request<Raw>('/users/@me'),
      this.getChannel(dmId),
    ]);
    const recipients = channel.recipients;
    if (
      channel.channel_type !== 'DirectMessage' ||
      !Array.isArray(recipients) ||
      recipients.length !== 2 ||
      new Set(recipients).size !== 2 ||
      !recipients.includes(self._id) ||
      recipients.some(
        (value: unknown) => typeof value !== 'string' || !SOCIAL_ID_PATTERN.test(value),
      )
    )
      throw new StoatError(403, 'DM_CALL_ACCESS_DENIED');
    const peerId = recipients.find((value: string) => value !== self._id);
    if (
      !(self.relations ?? []).some(
        (relation: Raw) => relation._id === peerId && relation.status === 'Friend',
      )
    )
      throw new StoatError(403, 'DM_CALL_FRIEND_REQUIRED');
    const peer = await this.request<Raw>(`/users/${checked(peerId)}`);
    if (peer.deleted === true) throw new StoatError(403, 'DM_CALL_ACCESS_DENIED');
    return { user: normalizeUser(self), peer: normalizeUser(peer) };
  }
  async getChannel(channelId: string) {
    return this.request<Raw>(`/channels/${checked(channelId)}`);
  }
  private invalidateChannelAccess(
    channelIds: string[],
    reason: SocialChannelAccessInvalidation['reason'],
    notifyAgain = false,
  ) {
    const ids = [...new Set(channelIds)].filter(
      (id) => SOCIAL_ID_PATTERN.test(id) && (notifyAgain || !this.invalidChannels.has(id)),
    );
    if (!ids.length) return;
    ++this.aclEpoch;
    for (const id of ids) {
      this.invalidChannels.add(id);
      for (const [messageId, message] of this.messages)
        if (message.channel === id) this.messages.delete(messageId);
    }
    this.emit('CHANNEL_ACCESS_INVALIDATED', {
      channelIds: ids,
      reason,
    } satisfies SocialChannelAccessInvalidation);
  }
  private async readAclContext(channelId: string) {
    const epoch = this.aclEpoch,
      token = this.token;
    const channel = await this.getChannel(channelId);
    if (channel._id !== channelId) throw new StoatError(502, 'CHANNEL_SCOPE_MISMATCH');
    if (channel.channel_type !== 'TextChannel' || typeof channel.server !== 'string') return null;
    const [self, server] = await Promise.all([
      this.request<Raw>('/users/@me'),
      this.getServer(channel.server),
    ]);
    if (
      typeof self._id !== 'string' ||
      !SOCIAL_ID_PATTERN.test(self._id) ||
      server._id !== channel.server ||
      typeof server.owner !== 'string'
    )
      throw new StoatError(502, 'INVALID_PERMISSION_CONTEXT');
    const member =
      server.owner === self._id || self.privileged === true
        ? null
        : await this.getMember(channel.server, self._id);
    if (epoch !== this.aclEpoch || token !== this.token)
      throw new StoatError(409, 'ACCESS_CHANGED');
    const bits = stoatChannelPermissionBits(self, server, channel, member);
    return { channel, self, server, member, bits, epoch, token };
  }
  async channelPermissions(channelId: string): Promise<SocialChannelPermissions> {
    checked(channelId);
    try {
      const context = await this.readAclContext(channelId);
      if (!context) return emptyAcl(channelId, 'unsupported');
      const { channel, self, server, member, bits } = context;
      if (!(bits & aclBits.view)) {
        this.invalidateChannelAccess([channelId], 'permissions-changed');
        return emptyAcl(channelId, 'denied');
      }
      const manage = !!(bits & 4n),
        owner = server.owner === self._id;
      const roles: Raw[] = Object.entries(server.roles ?? {}).map(([id, role]) => ({
        id,
        ...(role as Raw),
      }));
      if (
        roles.some(
          (role) =>
            !SOCIAL_ID_PATTERN.test(role.id) ||
            !Number.isSafeInteger(role.rank) ||
            typeof role.name !== 'string',
        )
      )
        throw new StoatError(502, 'INVALID_ROLE_RESPONSE');
      const rank = Math.min(
        ...roles.filter((role) => member?.roles?.includes(role.id)).map((role) => role.rank),
      );
      const subjects: SocialChannelPermissions['subjects'] = manage
        ? [
            {
              id: 'default',
              kind: 'default',
              name: 'Everyone',
              values: permissionValues(channel.default_permissions),
              editable: true,
            },
            ...roles.map((role) => ({
              id: role.id,
              kind: 'role' as const,
              name: String(role.name),
              values: permissionValues(channel.role_permissions?.[role.id]),
              editable: owner || role.rank > rank,
            })),
          ]
        : [];
      this.invalidChannels.delete(channelId);
      this.channels.set(channelId, channel);
      return {
        channelId,
        spaceId: channel.server,
        access: 'allowed',
        effective: {
          ...(Object.fromEntries(
            Object.entries(aclBits).map(([key, bit]) => [key, !!(bits & bit)]),
          ) as Record<keyof typeof aclBits, boolean>),
          managePermissions: manage,
          readHistory: !!(bits & (1n << 21n)),
        },
        subjects,
        defaultViewDenied: !!(permissionOverride(channel.default_permissions).deny & aclBits.view),
        memberOverridesSupported: false,
        concurrency: 'last-write-wins',
      };
    } catch (error) {
      if (error instanceof StoatError && [403, 404].includes(error.status)) {
        this.invalidateChannelAccess(
          [channelId],
          error.status === 404 ? 'removed' : 'permissions-changed',
        );
        return emptyAcl(channelId, error.status === 404 ? 'missing' : 'denied');
      }
      throw error;
    }
  }
  async setChannelPermissions(
    change: SocialChannelPermissionChange,
  ): Promise<SocialChannelPermissions> {
    const { channelId, subject, values } = change;
    checked(channelId);
    if (
      !subject ||
      !['default', 'role'].includes(subject.kind) ||
      (subject.kind === 'default' && subject.id !== 'default') ||
      !values ||
      Object.keys(values).length !== 5 ||
      Object.keys(aclBits).some(
        (key) => !['deny', 'inherit', 'allow'].includes(values[key as keyof typeof aclBits]),
      )
    )
      throw new StoatError(400, 'INVALID_PERMISSION_CHANGE');
    checked(subject.id);
    const context = await this.readAclContext(channelId);
    if (!context) throw new StoatError(400, 'UNSUPPORTED_CHANNEL_PERMISSIONS');
    if (!(context.bits & aclBits.view) || !(context.bits & 4n))
      throw new StoatError(403, 'MISSING_MANAGE_PERMISSIONS');
    if (subject.kind === 'role' && !context.server.roles?.[subject.id])
      throw new StoatError(404, 'ROLE_NOT_FOUND');
    const previous = permissionOverride(
      subject.kind === 'default'
        ? context.channel.default_permissions
        : context.channel.role_permissions?.[subject.id],
    );
    for (const [key, bit] of Object.entries(aclBits)) {
      previous.allow &= ~bit;
      previous.deny &= ~bit;
      if (values[key as keyof typeof aclBits] === 'allow') previous.allow |= bit;
      if (values[key as keyof typeof aclBits] === 'deny') previous.deny |= bit;
    }
    if (context.epoch !== this.aclEpoch || context.token !== this.token)
      throw new StoatError(409, 'ACCESS_CHANGED');
    // Upstream enforces current ManagePermissions, role rank and grant limits again.
    await this.request(
      `/channels/${checked(channelId)}/permissions/${subject.kind === 'default' ? 'default' : checked(subject.id)}`,
      'PUT',
      { permissions: { allow: Number(previous.allow), deny: Number(previous.deny) } },
    );
    this.invalidateChannelAccess([channelId], 'permissions-changed', true);
    return this.channelPermissions(channelId);
  }
  private async managementContext(spaceId: string) {
    checked(spaceId);
    const epoch = this.managementEpoch,
      session = this.sessionEpoch;
    const [self, server] = await Promise.all([
      this.request<Raw>('/users/@me'),
      this.getServer(spaceId),
    ]);
    if (
      typeof self._id !== 'string' ||
      !SOCIAL_ID_PATTERN.test(self._id) ||
      (self.privileged !== undefined && typeof self.privileged !== 'boolean') ||
      server._id !== spaceId ||
      typeof server.owner !== 'string' ||
      !SOCIAL_ID_PATTERN.test(server.owner) ||
      (server.roles !== undefined &&
        (!server.roles || typeof server.roles !== 'object' || Array.isArray(server.roles)))
    )
      throw new StoatError(502, 'INVALID_MANAGEMENT_CONTEXT');
    const roles: Raw[] = Object.entries(server.roles ?? {}).map(([id, role]) => ({
      ...(role as Raw),
      id,
    }));
    if (
      roles.length > 1000 ||
      roles.some(
        (role) =>
          !SOCIAL_ID_PATTERN.test(role.id) ||
          typeof role.name !== 'string' ||
          role.name.length > 128 ||
          !Number.isSafeInteger(role.rank),
      )
    )
      throw new StoatError(502, 'INVALID_ROLE_RESPONSE');
    for (const role of roles) permissionOverride(role.permissions);
    const bypass = self.privileged === true || self._id === server.owner;
    const member = bypass
      ? null
      : checkedMember(await this.getMember(spaceId, self._id), spaceId, self._id);
    const bits = managementPermissionBits(self, server, member, roles),
      rank = bypass ? -Infinity : memberRank(member!, roles),
      // Matches the services' stoatCommunityAdmin: the owner, or roles granting every permission.
      admin = self._id === server.owner || (!!member && bits === safeMask);
    this.assertManagementContext(epoch, session);
    return { self, server, roles, bits, rank, admin, epoch, session };
  }
  private assertManagementContext(epoch: number, session: number) {
    if (session !== this.sessionEpoch) throw new StoatError(401, 'SESSION_CHANGED');
    if (epoch !== this.managementEpoch) throw new StoatError(409, 'ACCESS_CHANGED');
  }
  async communityManagement(spaceId: string): Promise<SocialCommunityManagement> {
    checked(spaceId);
    try {
      const context = await this.managementContext(spaceId),
        result = managementUnavailable(spaceId, 'denied');
      result.capabilities = Object.fromEntries(
        Object.entries(managementBits).map(([key, bit]) => [key, !!(context.bits & bit)]),
      ) as SocialCommunityManagement['capabilities'];
      if (!Object.values(result.capabilities).some(Boolean)) return result;
      const raw = await this.listMembers(spaceId);
      if (
        !Array.isArray(raw.users) ||
        !Array.isArray(raw.members) ||
        raw.users.length > 1000 ||
        raw.members.length > 1000
      )
        throw new StoatError(502, 'INVALID_MEMBERS_RESPONSE');
      const users = new Map<string, Raw>(
        raw.users
          .filter((u: Raw) => typeof u._id === 'string' && SOCIAL_ID_PATTERN.test(u._id))
          .map((u: Raw) => [u._id, u]),
      );
      result.members = raw.members.flatMap((m: Raw) => {
        if (typeof m?._id?.user !== 'string' || !SOCIAL_ID_PATTERN.test(m._id.user))
          throw new StoatError(502, 'INVALID_MEMBER_RESPONSE');
        checkedMember(m, spaceId, m._id.user);
        const u = users.get(m._id.user);
        if (!u) return [];
        const isSelf = u._id === context.self._id,
          isOwner = u._id === context.server.owner,
          elevated = memberRank(m, context.roles) > context.rank;
        const status: SocialMember['status'] =
          u.online === false || u.status?.presence === 'Invisible'
            ? 'invisible'
            : u.online === true
              ? (({ Idle: 'idle', Busy: 'dnd', Focus: 'dnd' } as const)[
                  u.status?.presence as 'Idle' | 'Busy' | 'Focus'
                ] ?? 'online')
              : 'unknown';
        return [
          {
            user: normalizeUser(u),
            status,
            statusText: typeof u.status?.text === 'string' ? u.status.text.slice(0, 128) : null,
            roles: [...(m.roles ?? [])],
            canAssignRoles: result.capabilities.assignRoles && !isOwner && (isSelf || elevated),
            canRemove: result.capabilities.kickMembers && !isSelf && !isOwner && elevated,
            canBan: !!result.capabilities.banMembers && !isSelf && !isOwner && elevated,
          },
        ];
      });
      result.grantablePermissions = (
        Object.keys(rolePermissionBits) as SocialRolePermissionKey[]
      ).filter((key) => !!(context.bits & rolePermissionBits[key]));
      result.roles = context.roles
        .map((role) => ({
          id: role.id,
          name: role.name,
          rank: role.rank,
          assignable: result.capabilities.assignRoles && role.rank > context.rank,
          color: roleColor(role.colour),
          editable: result.capabilities.manageRoles && role.rank > context.rank,
          permissionsEditable: result.capabilities.managePermissions && role.rank > context.rank,
          permissions: rolePermissionValues(role.permissions),
        }))
        .sort((a, b) => a.rank - b.rank || a.id.localeCompare(b.id));
      // Members may create links; listing and revoking stay with the owner and admins.
      result.invites = context.admin
        ? { source: 'rooms-broker', state: 'supported', managementSupported: true }
        : {
            source: 'rooms-broker',
            state: 'unsupported',
            managementSupported: false,
            reason: 'Only the community owner or an admin can manage invitation links.',
          };
      this.assertManagementContext(context.epoch, context.session);
      result.access = 'allowed';
      return result;
    } catch (error) {
      if (error instanceof StoatError && [403, 404].includes(error.status))
        return managementUnavailable(spaceId, error.status === 404 ? 'missing' : 'denied');
      throw error;
    }
  }
  async changeCommunityRole(change: SocialCommunityRoleChange): Promise<SocialCommunityRoleResult> {
    const { spaceId, action } = change;
    checked(spaceId);
    if (!['create', 'appearance', 'permissions', 'delete'].includes(action))
      throw new StoatError(400, 'INVALID_ROLE_CHANGE');
    if (
      'name' in change &&
      (typeof change.name !== 'string' ||
        !change.name.trim() ||
        [...change.name].length > 32 ||
        /[\x00-\x1f\x7f]/.test(change.name))
    )
      throw new StoatError(400, 'INVALID_ROLE_NAME');
    if (action === 'appearance' && change.color !== null && !roleColor(change.color))
      throw new StoatError(400, 'INVALID_ROLE_COLOR');
    if (
      action === 'permissions' &&
      (!change.values ||
        Object.keys(change.values).length !== Object.keys(rolePermissionBits).length ||
        Object.keys(rolePermissionBits).some(
          (key) =>
            !['allow', 'deny', 'inherit'].includes(change.values[key as SocialRolePermissionKey]),
        ))
    )
      throw new StoatError(400, 'INVALID_ROLE_PERMISSIONS');
    if ('roleId' in change) checked(change.roleId);
    const c = await this.managementContext(spaceId);
    const required =
      action === 'permissions' ? managementBits.managePermissions : managementBits.manageRoles;
    if (!(c.bits & required)) throw new StoatError(403, 'ROLE_MANAGEMENT_DENIED');
    const role = 'roleId' in change ? c.roles.find((r) => r.id === change.roleId) : null;
    if (action !== 'create' && !role) throw new StoatError(404, 'ROLE_NOT_FOUND');
    if (role && role.rank <= c.rank) throw new StoatError(403, 'NotElevated');
    let permissions: { allow: number; deny: number } | undefined;
    if (action === 'permissions') {
      const previous = permissionOverride(role!.permissions);
      const next = { ...previous };
      for (const [key, bit] of Object.entries(rolePermissionBits)) {
        next.allow &= ~bit;
        next.deny &= ~bit;
        const value = change.values[key as SocialRolePermissionKey];
        if (value === 'allow') next.allow |= bit;
        if (value === 'deny') next.deny |= bit;
        // A manager cannot change a permission they do not hold, even by clearing a denial.
        if (((previous.allow ^ next.allow) | (previous.deny ^ next.deny)) & bit & ~c.bits)
          throw new StoatError(403, 'CANNOT_GRANT_ROLE_PERMISSION');
      }
      permissions = { allow: Number(next.allow), deny: Number(next.deny) };
    }
    this.assertManagementContext(c.epoch, c.session);
    let roleId = 'roleId' in change ? change.roleId : '';
    if (action === 'create') {
      const result = await this.request<Raw>(`/servers/${checked(spaceId)}/roles`, 'POST', {
        name: change.name.trim(),
      });
      if (typeof result.id !== 'string' || !SOCIAL_ID_PATTERN.test(result.id))
        throw new StoatError(502, 'INVALID_ROLE_RESPONSE');
      roleId = result.id;
    } else if (action === 'appearance') {
      await this.request(`/servers/${checked(spaceId)}/roles/${checked(roleId)}`, 'PATCH', {
        name: change.name.trim(),
        ...(change.color ? { colour: change.color } : { remove: ['Colour'] }),
      });
    } else if (action === 'permissions') {
      await this.request(`/servers/${checked(spaceId)}/permissions/${checked(roleId)}`, 'PUT', {
        permissions,
      });
    } else {
      await this.request(`/servers/${checked(spaceId)}/roles/${checked(roleId)}`, 'DELETE');
    }
    if (c.session !== this.sessionEpoch) throw new StoatError(401, 'SESSION_CHANGED');
    ++this.managementEpoch;
    try {
      return { roleId, management: await this.refreshAfterWrite(spaceId, c.session) };
    } catch (error) {
      if (c.session !== this.sessionEpoch) throw error;
      // Never retry the write or imply that creating another role is the recovery action.
      throw new StoatError(502, 'ROLE_SAVED_REFRESH_FAILED');
    } finally {
      this.managementChanged(spaceId);
    }
  }
  async setCommunityMemberRoles(
    change: SocialMemberRoleChange,
  ): Promise<SocialCommunityManagement> {
    const { spaceId, userId, roleIds } = change;
    checked(spaceId);
    checked(userId);
    if (
      !Array.isArray(roleIds) ||
      roleIds.length > 1000 ||
      new Set(roleIds).size !== roleIds.length ||
      roleIds.some((id) => typeof id !== 'string' || !SOCIAL_ID_PATTERN.test(id))
    )
      throw new StoatError(400, 'INVALID_ROLE_IDS');
    const c = await this.managementContext(spaceId);
    if (!(c.bits & managementBits.assignRoles) || userId === c.server.owner)
      throw new StoatError(403, 'ASSIGN_ROLES_DENIED');
    const target = checkedMember(await this.getMember(spaceId, userId), spaceId, userId);
    if (userId !== c.self._id && memberRank(target, c.roles) <= c.rank)
      throw new StoatError(403, 'NotElevated');
    for (const roleId of roleIds) {
      const role = c.roles.find((role) => role.id === roleId);
      if (!role) throw new StoatError(400, 'InvalidRole');
      if (!(target.roles ?? []).includes(roleId) && role.rank <= c.rank)
        throw new StoatError(403, 'NotElevated');
    }
    this.assertManagementContext(c.epoch, c.session);
    // The upstream PATCH rechecks current AssignRoles, target hierarchy and added roles.
    await this.request(`/servers/${checked(spaceId)}/members/${checked(userId)}`, 'PATCH', {
      roles: roleIds,
    });
    if (c.session !== this.sessionEpoch) throw new StoatError(401, 'SESSION_CHANGED');
    ++this.managementEpoch;
    try {
      return await this.refreshAfterWrite(spaceId, c.session);
    } finally {
      this.managementChanged(spaceId);
    }
  }
  /** What this account may do in a community, without listing its members. */
  async communityCapabilities(spaceId: string): Promise<SocialCommunityManagement['capabilities']> {
    checked(spaceId);
    const context = await this.managementContext(spaceId);
    return {
      ...Object.fromEntries(
        Object.entries(managementBits).map(([key, bit]) => [key, !!(context.bits & bit)]),
      ),
      communityAdmin: context.admin,
    } as SocialCommunityManagement['capabilities'];
  }
  /** Bans someone below this account's rank; they leave the community and cannot rejoin. */
  async banCommunityMember(change: SocialMemberRemoval): Promise<SocialCommunityManagement> {
    const { spaceId, userId } = change;
    checked(spaceId);
    checked(userId);
    const c = await this.managementContext(spaceId);
    if (!(c.bits & managementBits.banMembers) || userId === c.self._id || userId === c.server.owner)
      throw new StoatError(403, 'BAN_MEMBER_DENIED');
    const target = checkedMember(await this.getMember(spaceId, userId), spaceId, userId);
    if (memberRank(target, c.roles) <= c.rank) throw new StoatError(403, 'NotElevated');
    this.assertManagementContext(c.epoch, c.session);
    await this.request(`/servers/${checked(spaceId)}/bans/${checked(userId)}`, 'PUT', {});
    if (c.session !== this.sessionEpoch) throw new StoatError(401, 'SESSION_CHANGED');
    ++this.managementEpoch;
    try {
      return await this.refreshAfterWrite(spaceId, c.session);
    } finally {
      this.managementChanged(spaceId);
    }
  }
  async removeCommunityMember(change: SocialMemberRemoval): Promise<SocialCommunityManagement> {
    const { spaceId, userId } = change;
    checked(spaceId);
    checked(userId);
    const c = await this.managementContext(spaceId);
    if (
      !(c.bits & managementBits.kickMembers) ||
      userId === c.self._id ||
      userId === c.server.owner
    )
      throw new StoatError(403, 'REMOVE_MEMBER_DENIED');
    const target = checkedMember(await this.getMember(spaceId, userId), spaceId, userId);
    if (memberRank(target, c.roles) <= c.rank) throw new StoatError(403, 'NotElevated');
    this.assertManagementContext(c.epoch, c.session);
    await this.removeMember(spaceId, userId);
    if (c.session !== this.sessionEpoch) throw new StoatError(401, 'SESSION_CHANGED');
    ++this.managementEpoch;
    try {
      return await this.refreshAfterWrite(spaceId, c.session);
    } finally {
      this.managementChanged(spaceId);
    }
  }
  /**
   * Reads the result of this client's own write. Its gateway echo (ServerRoleUpdate,
   * ServerMemberUpdate) bumps the management epoch mid-read, so a stale read is retried instead of
   * being reported as a failed save.
   */
  private async refreshAfterWrite(spaceId: string, session: number) {
    for (let attempt = 0; ; attempt++) {
      try {
        return await this.communityManagement(spaceId);
      } catch (error) {
        if (
          session === this.sessionEpoch &&
          attempt < 2 &&
          error instanceof StoatError &&
          error.code === 'ACCESS_CHANGED'
        )
          continue;
        throw error;
      }
    }
  }
  /**
   * Invalidates access and asks the app to refresh only after the post-write read: those refreshes
   * share the same rate-limited server bucket and would otherwise queue ahead of it.
   */
  private managementChanged(spaceId: string) {
    ++this.managementEpoch;
    this.invalidateChannelAccess(
      [...this.channels.values()].filter((c) => c.server === spaceId).map((c) => c._id),
      'membership-changed',
      true,
    );
    this.emit('SOCIAL_REFRESH', null);
  }
  async getMember(spaceId: string, userId: string) {
    return this.request<Raw>(`/servers/${checked(spaceId)}/members/${checked(userId)}`);
  }
  async listMembers(spaceId: string) {
    return this.request<Raw>(`/servers/${checked(spaceId)}/members`);
  }
  async listCommunityMembers(spaceId: string): Promise<SocialMember[]> {
    const raw = await this.listMembers(spaceId);
    if (
      !Array.isArray(raw.users) ||
      !Array.isArray(raw.members) ||
      raw.users.length > 1000 ||
      raw.members.length > 1000
    )
      throw new StoatError(502, 'INVALID_MEMBERS_RESPONSE');
    const users = new Map<string, Raw>(
      raw.users
        .filter((u: Raw) => typeof u._id === 'string' && SOCIAL_ID_PATTERN.test(u._id))
        .map((u: Raw) => [u._id, u]),
    );
    return raw.members.flatMap((member: Raw) => {
      const rawUser = users.get(member._id?.user);
      if (!rawUser) return [];
      this.users.set(rawUser._id, rawUser);
      const status: SocialMember['status'] =
        rawUser.online === false || rawUser.status?.presence === 'Invisible'
          ? 'invisible'
          : rawUser.online === true
            ? (({ Idle: 'idle', Busy: 'dnd', Focus: 'dnd' } as const)[
                rawUser.status?.presence as 'Idle' | 'Busy' | 'Focus'
              ] ?? 'online')
            : 'unknown';
      return [
        {
          user: normalizeUser(rawUser),
          status,
          statusText:
            typeof rawUser.status?.text === 'string' ? rawUser.status.text.slice(0, 128) : null,
          roles: Array.isArray(member.roles)
            ? member.roles.filter(
                (r: unknown): r is string => typeof r === 'string' && SOCIAL_ID_PATTERN.test(r),
              )
            : [],
        },
      ];
    });
  }
  async blockUser(userId: string) {
    await this.request(`/users/${checked(userId)}/block`, 'PUT');
  }
  async unblockUser(userId: string) {
    await this.request(`/users/${checked(userId)}/block`, 'DELETE');
  }
  async removeMember(spaceId: string, userId: string) {
    await this.request(`/servers/${checked(spaceId)}/members/${checked(userId)}`, 'DELETE');
  }
  async ackRead(channelId: string, messageId: string) {
    await this.request(`/channels/${checked(channelId)}/ack/${checked(messageId)}`, 'PUT');
    await this.syncReadStates();
  }
  async readStates(): Promise<SocialReadState[]> {
    const self = this.currentUser ?? (await this.getCurrentUser());
    const records = await this.request<Raw[]>('/sync/unreads');
    if (!Array.isArray(records) || records.length > 10000)
      throw new StoatError(502, 'INVALID_READ_STATES');
    return records
      .filter((raw) => raw._id?.user === self.id)
      .map((raw) => {
        if (
          typeof raw._id?.channel !== 'string' ||
          !SOCIAL_ID_PATTERN.test(raw._id.channel) ||
          (raw.last_id !== undefined &&
            raw.last_id !== null &&
            (typeof raw.last_id !== 'string' || !SOCIAL_ID_PATTERN.test(raw.last_id))) ||
          (raw.mentions !== undefined && !Array.isArray(raw.mentions))
        )
          throw new StoatError(502, 'INVALID_READ_STATES');
        return {
          channelId: raw._id.channel,
          lastReadMessageId: raw.last_id ?? null,
          mentionMessageIds: (raw.mentions ?? []).filter(
            (id: unknown): id is string => typeof id === 'string' && SOCIAL_ID_PATTERN.test(id),
          ),
        };
      });
  }
  private async syncReadStates() {
    try {
      this.emit('READ_STATE_SYNC', await this.readStates());
    } catch {
      this.emit('READ_STATE_UNAVAILABLE', {
        reason: 'The server read markers could not be restored. Retry after reconnecting.',
      });
    }
  }
  async listDMs() {
    const channels = await this.request<Raw[]>('/users/dms');
    await Promise.all(
      channels
        .flatMap((c) => c.recipients ?? [])
        .filter((id: string) => !this.users.has(id))
        .map(async (id: string) => {
          const u = await this.request<Raw>(`/users/${checked(id)}`);
          this.users.set(id, u);
        }),
    );
    return channels.map((c) => this.normalizeChannel(c));
  }
  async createDM(recipientId: string) {
    try {
      return this.normalizeChannel(await this.request<Raw>(`/users/${checked(recipientId)}/dm`));
    } catch (error) {
      if (!(error instanceof StoatError) || error.status !== 403) throw error;
      // Upstream opens private messages only between friends; say which step is missing.
      const self = await this.request<Raw>('/users/@me').catch(() => null);
      const status = (self?.relations ?? []).find((r: Raw) => r._id === recipientId)?.status;
      if (status === 'Friend') throw error;
      throw new StoatError(
        403,
        status === 'Outgoing'
          ? 'DM_FRIEND_PENDING'
          : status === 'Incoming'
            ? 'DM_FRIEND_INCOMING'
            : status === 'Blocked' || status === 'BlockedOther'
              ? 'DM_BLOCKED'
              : 'DM_FRIEND_REQUIRED',
      );
    }
  }
  async listMessages(channelId: string, before?: string) {
    const result = await this.request<Raw | Raw[]>(
      `/channels/${checked(channelId)}/messages?limit=50&include_users=true${before ? `&before=${checked(before)}` : ''}`,
    );
    const raw = Array.isArray(result) ? result : result.messages;
    for (const u of Array.isArray(result) ? [] : (result.users ?? [])) this.users.set(u._id, u);
    return Promise.all([...raw].reverse().map((m) => this.normalizeMessage(m)));
  }
  async getMessage(channelId: string, messageId: string): Promise<SocialMessage> {
    const channel = decodeURIComponent(checked(channelId));
    const message = decodeURIComponent(checked(messageId));
    const raw = await this.request<Raw>(
      `/channels/${checked(channel)}/messages/${checked(message)}`,
    );
    if (raw.channel !== channel || raw._id !== message)
      throw new StoatError(502, 'MESSAGE_SCOPE_MISMATCH');
    return this.normalizeMessage(raw);
  }
  async sendMessage(channelId: string, content: string, attachmentIds?: string[]) {
    if (
      attachmentIds &&
      (attachmentIds.length > 10 || attachmentIds.some((id) => !SOCIAL_ID_PATTERN.test(id)))
    )
      throw new StoatError(400, 'INVALID_ATTACHMENT');
    return this.normalizeMessage(
      await this.request<Raw>(`/channels/${checked(channelId)}/messages`, 'POST', {
        content,
        nonce: crypto.randomUUID(),
        ...(attachmentIds?.length ? { attachments: attachmentIds } : {}),
      }),
    );
  }
  async sendReply(channelId: string, messageId: string, content: string, deliveryId: string) {
    if (!/^[A-Za-z0-9_-]{1,64}$/.test(deliveryId)) throw new StoatError(400, 'INVALID_DELIVERY_ID');
    return this.normalizeMessage(
      await this.request<Raw>(
        `/channels/${checked(channelId)}/messages`,
        'POST',
        // Stoat consumes the header as the nonce; also sending a body nonce makes it reject the
        // first delivery as a duplicate (InvalidOperation).
        { content, replies: [{ id: messageId, mention: false }] },
        { 'Idempotency-Key': deliveryId },
      ),
    );
  }
  async editMessage(channelId: string, messageId: string, content: string) {
    return this.normalizeMessage(
      await this.request<Raw>(
        `/channels/${checked(channelId)}/messages/${checked(messageId)}`,
        'PATCH',
        { content },
      ),
    );
  }
  async deleteMessage(channelId: string, messageId: string) {
    await this.request(`/channels/${checked(channelId)}/messages/${checked(messageId)}`, 'DELETE');
  }
  private normalizeInvite(i: Raw): SocialInvite {
    return {
      code: String(i.code ?? i._id),
      space: i.server_id
        ? {
            id: String(i.server_id),
            name: String(i.server_name ?? ''),
            icon: i.server_icon?._id ?? null,
          }
        : null,
      channel: i.channel_id
        ? {
            id: String(i.channel_id),
            spaceId: i.server_id ?? null,
            name: String(i.channel_name ?? ''),
            type: 0,
            topic: i.channel_description ?? null,
          }
        : null,
      expiresAt: i.expires ?? null,
    };
  }
  async createInvite(channelId: string): Promise<SocialInvite> {
    let response: Response;
    try {
      response = await fetch(`${new URL(this.instanceUrl).origin}/rooms-access/v1/invites`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${this.token ?? ''}`,
        },
        body: JSON.stringify({ channelId: decodeURIComponent(checked(channelId)) }),
        redirect: 'error',
        signal: AbortSignal.timeout(15000),
      });
    } catch {
      throw new StoatError(503, 'NETWORK_UNAVAILABLE');
    }
    const data = (await response.json().catch(() => ({}))) as Raw;
    if (!response.ok)
      throw new StoatError(response.status, String(data.error ?? 'INVITE_UNAVAILABLE'));
    return data as SocialInvite;
  }
  private async broker<T>(
    path: string,
    init: { method?: string; body?: unknown; timeoutMs?: number } = {},
  ): Promise<T> {
    let response: Response;
    try {
      response = await fetch(`${new URL(this.instanceUrl).origin}/rooms-access${path}`, {
        method: init.method ?? 'GET',
        headers: {
          ...(init.body === undefined ? {} : { 'Content-Type': 'application/json' }),
          Authorization: `Bearer ${this.token ?? ''}`,
        },
        body: init.body === undefined ? undefined : JSON.stringify(init.body),
        redirect: 'error',
        signal: AbortSignal.timeout(init.timeoutMs ?? 15000),
      });
    } catch {
      throw new StoatError(503, 'NETWORK_UNAVAILABLE');
    }
    const data = (await response.json().catch(() => ({}))) as Raw;
    if (!response.ok)
      throw new StoatError(response.status, String(data.error ?? 'INVITE_UNAVAILABLE'));
    return data as T;
  }
  /** Unauthenticated call to the access service for approved sign-up. */
  private async signupFetch(
    path: string,
    init: { method?: string; body?: unknown; secret?: string } = {},
  ): Promise<Raw> {
    let response: Response;
    try {
      response = await fetch(`${new URL(this.instanceUrl).origin}/rooms-access${path}`, {
        method: init.method ?? 'GET',
        headers: {
          ...(init.body === undefined ? {} : { 'Content-Type': 'application/json' }),
          ...(init.secret ? { Authorization: `Bearer ${init.secret}` } : {}),
        },
        body: init.body === undefined ? undefined : JSON.stringify(init.body),
        redirect: 'error',
        signal: AbortSignal.timeout(15000),
      });
    } catch {
      throw new StoatError(503, 'NETWORK_UNAVAILABLE');
    }
    const data = (await response.json().catch(() => ({}))) as Raw;
    if (!response.ok)
      throw new StoatError(response.status, String(data.error ?? 'SIGNUP_UNAVAILABLE'));
    return data;
  }
  /** Whether this server accepts sign-up requests without an invitation link. */
  async signupAvailable() {
    try {
      return (await this.signupFetch('/v1/auth/signup')).enabled === true;
    } catch (error) {
      // Brokers from before approved sign-up do not know the route.
      if (error instanceof StoatError && error.status === 404) return false;
      throw error;
    }
  }
  /**
   * Approved sign-up: queues a request. No account exists until an admin approves; the
   * returned poll secret is the only way to follow the request.
   */
  async requestSignup(input: { email: string; username: string }) {
    let data: Raw;
    try {
      data = await this.signupFetch('/v1/auth/signup-requests', {
        method: 'POST',
        body: { email: input.email, username: input.username },
      });
    } catch (error) {
      if (error instanceof StoatError && error.status === 404)
        throw new StoatError(501, 'SIGNUP_UNAVAILABLE');
      throw error;
    }
    if (
      typeof data.requestId !== 'string' ||
      !/^[a-f0-9]{32}$/.test(data.requestId) ||
      typeof data.pollSecret !== 'string' ||
      !/^[A-Za-z0-9_-]{43}$/.test(data.pollSecret)
    )
      throw new StoatError(502, 'INVALID_SIGNUP_RESPONSE');
    return { requestId: data.requestId, pollSecret: data.pollSecret };
  }
  /** Where a request stands. An approval returns its single-use registration link once. */
  async signupStatus(requestId: string, pollSecret: string): Promise<SocialSignupPoll> {
    if (!/^[a-f0-9]{32}$/.test(requestId)) throw new StoatError(400, 'INVALID_ID');
    const data = await this.signupFetch(`/v1/auth/signup-requests/${requestId}`, {
      secret: pollSecret,
    });
    const status = ['pending', 'approved', 'issued', 'rejected', 'expired'].includes(data.status)
      ? (data.status as SocialSignupPoll['status'])
      : null;
    if (!status) throw new StoatError(502, 'INVALID_SIGNUP_RESPONSE');
    const inviteCode =
      status === 'approved' &&
      typeof data.inviteCode === 'string' &&
      /^[a-f0-9]{64}$/.test(data.inviteCode)
        ? data.inviteCode
        : null;
    if (status === 'approved' && !inviteCode) throw new StoatError(502, 'INVALID_SIGNUP_RESPONSE');
    return {
      status,
      inviteCode,
      createdAt: typeof data.createdAt === 'string' ? data.createdAt : null,
      expiresAt: typeof data.expiresAt === 'string' ? data.expiresAt : null,
    };
  }
  async cancelSignup(requestId: string, pollSecret: string) {
    if (!/^[a-f0-9]{32}$/.test(requestId)) throw new StoatError(400, 'INVALID_ID');
    await this.signupFetch(`/v1/auth/signup-requests/${requestId}`, {
      method: 'DELETE',
      secret: pollSecret,
    });
  }
  async listSignupRequests(spaceId: string): Promise<SocialSignupRequests> {
    const data = await this.broker<Raw>(`/v1/spaces/${checked(spaceId)}/signup-requests`);
    if (!Array.isArray(data.requests) || data.requests.length > 1000)
      throw new StoatError(502, 'INVALID_SIGNUP_RESPONSE');
    return {
      enabled: data.enabled === true,
      requests: data.requests.map((raw: Raw) => {
        if (
          typeof raw?.id !== 'string' ||
          !/^[a-f0-9]{32}$/.test(raw.id) ||
          typeof raw.username !== 'string' ||
          typeof raw.createdAt !== 'string'
        )
          throw new StoatError(502, 'INVALID_SIGNUP_RESPONSE');
        return {
          id: raw.id,
          username: raw.username.slice(0, 32),
          createdAt: raw.createdAt,
          state: raw.state === 'approved' ? ('approved' as const) : ('pending' as const),
        };
      }),
    };
  }
  async decideSignupRequest(spaceId: string, requestId: string, decision: 'approve' | 'reject') {
    if (!/^[a-f0-9]{32}$/.test(requestId)) throw new StoatError(400, 'INVALID_ID');
    await this.broker(`/v1/spaces/${checked(spaceId)}/signup-requests/${requestId}/${decision}`, {
      method: 'POST',
    });
  }
  /** Active invitation links of a space; only its owner may list them. */
  async listInviteLinks(spaceId: string): Promise<SocialInviteLinkSummary[]> {
    const data = await this.broker<{ invites?: unknown }>(`/v1/spaces/${checked(spaceId)}/invites`);
    if (!Array.isArray(data.invites) || data.invites.length > 200)
      throw new StoatError(502, 'INVALID_INVITES_RESPONSE');
    return data.invites.map((raw: Raw) => {
      if (
        typeof raw?.id !== 'string' ||
        !/^[a-f0-9]{16}$/.test(raw.id) ||
        !Number.isInteger(raw.maxUses) ||
        !Number.isInteger(raw.uses) ||
        !Number.isInteger(raw.pending) ||
        typeof raw.expiresAt !== 'string' ||
        typeof raw.createdAt !== 'string'
      )
        throw new StoatError(502, 'INVALID_INVITES_RESPONSE');
      return {
        id: raw.id,
        createdAt: raw.createdAt,
        expiresAt: raw.expiresAt,
        maxUses: raw.maxUses,
        uses: raw.uses,
        pending: raw.pending,
        source: ['app', 'admin', 'script', 'legacy'].includes(raw.source) ? raw.source : 'legacy',
        createdBy:
          typeof raw.createdBy === 'string' && SOCIAL_ID_PATTERN.test(raw.createdBy)
            ? raw.createdBy
            : null,
        state: raw.state === 'full' ? 'full' : 'active',
      };
    });
  }
  async revokeInviteLink(spaceId: string, inviteId: string) {
    if (!/^[a-f0-9]{16}$/.test(inviteId)) throw new StoatError(400, 'INVALID_ID');
    await this.broker(`/v1/spaces/${checked(spaceId)}/invites/${inviteId}`, { method: 'DELETE' });
  }
  /** Broker-only: removes the upstream invitation behind a revoked link. */
  async deleteUpstreamInvite(code: string) {
    await this.request(`/invites/${checked(code)}`, 'DELETE');
  }
  /** Broker-only perpetual upstream invitation; its code never enters the native/renderer result. */
  async createUpstreamInvite(channelId: string) {
    const created = await this.request<Raw>(`/channels/${checked(channelId)}/invites`, 'POST');
    return this.inspectUpstreamInvite(String(created._id));
  }
  async inspectInvite(code: string) {
    if (code.length >= 32) {
      let response: Response;
      try {
        response = await fetch(
          `${new URL(this.instanceUrl).origin}/rooms-access/v1/auth/invites/${checked(code)}`,
          { redirect: 'error', signal: AbortSignal.timeout(15000) },
        );
      } catch {
        throw new StoatError(503, 'NETWORK_UNAVAILABLE');
      }
      const data = (await response.json().catch(() => ({}))) as Raw;
      if (!response.ok)
        throw new StoatError(response.status, String(data.error ?? 'INVITE_UNAVAILABLE'));
      return data as SocialInvite;
    }
    return this.inspectUpstreamInvite(code);
  }
  async inspectUpstreamInvite(code: string) {
    return this.normalizeInvite(await this.request<Raw>(`/invites/${checked(code)}`));
  }
  async acceptInvite(code: string) {
    if (code.length >= 32) {
      let response: Response;
      try {
        response = await fetch(
          `${new URL(this.instanceUrl).origin}/rooms-access/v1/auth/invites/${checked(code)}/join`,
          {
            method: 'POST',
            headers: { Authorization: `Bearer ${this.token ?? ''}` },
            redirect: 'error',
            signal: AbortSignal.timeout(20000),
          },
        );
      } catch {
        throw new StoatError(503, 'NETWORK_UNAVAILABLE');
      }
      const data = (await response.json().catch(() => ({}))) as Raw;
      if (!response.ok)
        throw new StoatError(response.status, String(data.error ?? 'INVITE_UNAVAILABLE'));
      this.emit('SOCIAL_REFRESH', null);
      return data as SocialInvite;
    }
    const joined = await this.request<Raw>(`/invites/${checked(code)}`, 'POST');
    if (joined.server) this.servers.set(joined.server._id, joined.server);
    for (const c of joined.channels ?? []) this.channels.set(c._id, c);
    return {
      code,
      space: joined.server ? normalizeSpace(joined.server) : null,
      channel: joined.channel
        ? this.normalizeChannel(joined.channel)
        : joined.channels?.[0]
          ? this.normalizeChannel(joined.channels[0])
          : null,
      expiresAt: null,
    };
  }
  /** The signed-in user's bio, status text and presence, as Settings shows them. */
  async ownProfile(): Promise<{
    bio: string;
    statusText: string;
    presence: 'online' | 'idle' | 'dnd' | 'invisible';
  }> {
    const raw = await this.request<Raw>('/users/@me');
    // The profile route takes a user id; '@me' only works for /users/@me itself.
    const profile = await this.request<Raw>(`/users/${checked(String(raw._id))}/profile`).catch(
      () => null,
    );
    const presence = raw.status?.presence;
    return {
      bio: typeof profile?.content === 'string' ? profile.content.slice(0, 2000) : '',
      statusText: typeof raw.status?.text === 'string' ? raw.status.text.slice(0, 128) : '',
      presence:
        presence === 'Idle'
          ? 'idle'
          : presence === 'Busy' || presence === 'Focus'
            ? 'dnd'
            : presence === 'Invisible'
              ? 'invisible'
              : 'online',
    };
  }
  async updatePresence(status: 'online' | 'idle' | 'dnd' | 'invisible') {
    await this.request('/users/@me', 'PATCH', {
      status: {
        presence: { online: 'Online', idle: 'Idle', dnd: 'Busy', invisible: 'Invisible' }[status],
      },
    });
  }
  subscribePresence(spaceId: string): boolean {
    checked(spaceId);
    if (this.status !== 'connected' || !this.servers.has(spaceId)) return false;
    const now = Date.now();
    for (const [id, sentAt] of this.presenceSubscriptions)
      if (now - sentAt >= 15 * 60000) this.presenceSubscriptions.delete(id);
    const previous = this.presenceSubscriptions.get(spaceId);
    if (previous !== undefined && now - previous < 10 * 60000) return true;
    if (previous === undefined && this.presenceSubscriptions.size >= 5) return false;
    this.send({ type: 'Subscribe', server_id: spaceId });
    this.presenceSubscriptions.set(spaceId, now);
    return true;
  }
  /** Upstream validates membership; no message content is sent in a typing event. */
  typing(channelId: string, active: boolean): boolean {
    checked(channelId);
    if (
      this.status !== 'connected' ||
      !this.channels.has(channelId) ||
      this.socket?.readyState !== WebSocket.OPEN
    )
      return false;
    this.send({ type: active ? 'BeginTyping' : 'EndTyping', channel: channelId });
    return true;
  }
  private send(data: unknown) {
    if (this.socket?.readyState === WebSocket.OPEN) this.socket.send(JSON.stringify(data));
  }
  private ensureReady() {
    return this.status === 'connected' ? Promise.resolve() : (this.readyWait ?? this.connect());
  }
  async connect(): Promise<void> {
    if (!this.token) throw new StoatError(401, 'SIGN_IN_REQUIRED');
    if (this.readyWait) return this.readyWait;
    this.stopped = false;
    this.setStatus('connecting');
    this.readyWait = new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        off();
        reject(new StoatError(503, 'EVENTS_TIMEOUT'));
      }, 20000);
      const off = this.subscribe((e) => {
        if (e.type === 'READY') {
          clearTimeout(timer);
          off();
          resolve();
        } else if (e.type === 'AUTH_EXPIRED') {
          clearTimeout(timer);
          off();
          reject(new StoatError(401, 'InvalidSession'));
        }
      });
      void this.openSocket().catch((error) => {
        clearTimeout(timer);
        off();
        reject(error);
      });
    }).finally(() => {
      this.readyWait = null;
    });
    return this.readyWait;
  }
  private async openSocket() {
    if (this.stopped) return;
    const root = await this.request<Raw>('');
    this.configureFileOrigin(root);
    if (this.stopped) return;
    const endpoint = new URL(String(root.ws));
    const configured = new URL(this.instanceUrl);
    if (
      endpoint.host !== configured.host ||
      !['ws:', 'wss:'].includes(endpoint.protocol) ||
      (configured.protocol === 'https:' && endpoint.protocol !== 'wss:') ||
      endpoint.username ||
      endpoint.password
    ) {
      this.setStatus('error');
      throw new StoatError(403, 'UNTRUSTED_GATEWAY');
    }
    endpoint.searchParams.set('format', 'json');
    endpoint.searchParams.set('version', '1');
    if (this.heartbeat) clearInterval(this.heartbeat);
    this.heartbeat = null;
    const previous = this.socket;
    this.socket = null;
    previous?.close();
    const socket = new WebSocket(endpoint);
    this.socket = socket;
    socket.addEventListener('open', () => {
      if (this.socket !== socket || this.stopped) return;
      this.send({ type: 'Authenticate', token: this.token });
      this.pongAt = Date.now();
      this.heartbeat = setInterval(() => {
        if (Date.now() - this.pongAt > 60000) {
          socket.close();
          return;
        }
        this.send({ type: 'Ping', data: Date.now() });
      }, 20000);
    });
    socket.addEventListener('message', (event) => {
      if (this.socket !== socket) return;
      let packet: Raw;
      try {
        if (String(event.data).length > 2097152) throw new Error('Packet too large');
        packet = JSON.parse(String(event.data));
      } catch {
        socket.close();
        return;
      }
      this.eventQueue = this.eventQueue
        .then(async () => {
          if (this.socket === socket) await this.processPacket(packet);
        })
        .catch(() => {
          this.emit('SOCIAL_REFRESH', null);
        });
    });
    socket.addEventListener('close', () => {
      if (this.socket !== socket) return;
      if (this.heartbeat) clearInterval(this.heartbeat);
      this.heartbeat = null;
      this.scheduleReconnect();
    });
    socket.addEventListener('error', () => socket.close());
  }
  private async processPacket(p: Raw): Promise<void> {
    if (p.type === 'Bulk') {
      for (const child of p.v ?? []) await this.processPacket(child);
      return;
    }
    if (p.type === 'Pong') {
      this.pongAt = Date.now();
      return;
    }
    if (
      p.type === 'Logout' ||
      (p.type === 'Error' &&
        ['InvalidSession', 'OnboardingNotFinished'].includes(p.error ?? p.data?.type))
    ) {
      this.stopped = true;
      this.setStatus('error');
      this.emit('AUTH_EXPIRED', null);
      this.socket?.close();
      return;
    }
    if (p.type === 'Ready') {
      this.users.clear();
      this.servers.clear();
      this.channels.clear();
      // Deletes and edits during a gateway gap were not seen; do not trust cached messages.
      this.messages.clear();
      for (const u of p.users ?? []) this.users.set(u._id, u);
      for (const s of p.servers ?? []) this.servers.set(s._id, s);
      for (const c of p.channels ?? []) this.channels.set(c._id, c);
      this.attempt = 0;
      this.setStatus('connected');
      this.presenceSubscriptions.clear();
      this.emit('READY', {
        user: this.currentUser,
        spaces: [...this.servers.values()].map(normalizeSpace),
      });
      for (const raw of this.users.values()) {
        if (typeof raw.online === 'boolean') {
          const status =
            raw.online === false || raw.status?.presence === 'Invisible'
              ? 'invisible'
              : (({ Idle: 'idle', Busy: 'dnd', Focus: 'dnd' } as Record<string, string>)[
                  raw.status?.presence
                ] ?? 'online');
          this.emit('PRESENCE_UPDATE', { userId: raw._id, status });
        }
      }
      await this.syncReadStates();
      return;
    }
    if (p.type === 'ChannelStartTyping' || p.type === 'ChannelStopTyping') {
      if (
        typeof p.id !== 'string' ||
        typeof p.user !== 'string' ||
        !SOCIAL_ID_PATTERN.test(p.id) ||
        !SOCIAL_ID_PATTERN.test(p.user) ||
        !this.channels.has(p.id) ||
        this.invalidChannels.has(p.id)
      )
        return;
      const user = this.users.get(p.user);
      if (!user) return;
      this.emit('TYPING_UPDATE', {
        channelId: p.id,
        user: normalizeUser(user),
        active: p.type === 'ChannelStartTyping',
      });
      return;
    }
    if (p.type === 'ChannelUpdate') {
      const old = this.channels.get(p.id);
      if (old) this.channels.set(p.id, { ...old, ...p.data });
      // Message pointers and presentation fields do not change channel authority.
      const changed = [...Object.keys(p.data ?? {}), ...(Array.isArray(p.clear) ? p.clear : [])];
      const presentation = new Set([
        'last_message_id',
        'name',
        'description',
        'icon',
        'Icon',
        'Description',
      ]);
      if (changed.some((key) => !presentation.has(key)))
        this.invalidateChannelAccess([p.id], 'permissions-changed', true);
    }
    if (p.type === 'ServerMemberJoin') ++this.managementEpoch;
    // Another member's roles, nickname or departure cannot change this user's channel access.
    // ServerMemberUpdate carries { server, user } as id; ServerMemberLeave carries the user separately.
    const memberUser =
      p.type === 'ServerMemberUpdate'
        ? p.id?.user
        : p.type === 'ServerMemberLeave'
          ? p.user
          : undefined;
    const otherMember =
      typeof memberUser === 'string' &&
      typeof this.currentUser?.id === 'string' &&
      memberUser !== this.currentUser.id;
    // Channel create/delete sends ServerUpdate { channels }; like presentation fields, the
    // channel list does not change this user's access to existing channels.
    const serverPresentation =
      p.type === 'ServerUpdate' &&
      [...Object.keys(p.data ?? {}), ...(Array.isArray(p.clear) ? p.clear : [])].every((key) =>
        [
          'channels',
          'name',
          'description',
          'icon',
          'banner',
          'Description',
          'Icon',
          'Banner',
        ].includes(key),
      );
    if (otherMember || serverPresentation) ++this.managementEpoch;
    else if (
      [
        'ServerUpdate',
        'ServerRoleUpdate',
        'ServerRoleDelete',
        'ServerMemberUpdate',
        'ServerMemberLeave',
        'ServerDelete',
      ].includes(p.type)
    ) {
      ++this.managementEpoch;
      const serverId = typeof p.id === 'string' ? p.id : p.id?.server;
      this.invalidateChannelAccess(
        [...this.channels.values()].filter((c) => c.server === serverId).map((c) => c._id),
        p.type === 'ServerDelete' ? 'removed' : 'membership-changed',
        true,
      );
    }
    if (p.type === 'ChannelDelete') this.invalidateChannelAccess([p.id], 'removed', true);
    if (
      [
        'Message',
        'MessageUpdate',
        'MessageReact',
        'MessageUnreact',
        'MessageRemoveReaction',
      ].includes(p.type)
    ) {
      const channelId = p.channel ?? p.channel_id;
      if (this.invalidChannels.has(channelId)) {
        const acl = await this.channelPermissions(channelId);
        if (acl.access !== 'allowed' || !acl.effective.view) return;
      }
    }
    if (p.type === 'Message') {
      this.emit('MESSAGE_CREATE', await this.normalizeMessage(p));
      return;
    }
    if (p.type === 'MessageUpdate') {
      const previous = this.messages.get(p.id);
      const raw = previous
        ? { ...previous, ...p.data }
        : await this.request<Raw>(`/channels/${checked(p.channel)}/messages/${checked(p.id)}`);
      this.emit('MESSAGE_UPDATE', await this.normalizeMessage(raw));
      return;
    }
    if (['MessageReact', 'MessageUnreact', 'MessageRemoveReaction'].includes(p.type)) {
      const raw = await this.request<Raw>(
        `/channels/${checked(p.channel_id)}/messages/${checked(p.id)}`,
      );
      this.emit('MESSAGE_UPDATE', await this.normalizeMessage(raw));
      return;
    }
    if (p.type === 'MessageDelete') {
      this.messages.delete(p.id);
      this.emit('MESSAGE_DELETE', { id: p.id, channel_id: p.channel });
      return;
    }
    if (p.type === 'UserUpdate') {
      const old = this.users.get(p.id);
      const raw = { ...old, ...p.data, _id: p.id };
      this.users.set(p.id, raw);
      if ('online' in (p.data ?? {}) || p.data?.status) {
        const presence = p.data?.status?.presence ?? raw.status?.presence;
        const status =
          raw.online === false || presence === 'Invisible'
            ? 'invisible'
            : ((
                { Online: 'online', Idle: 'idle', Busy: 'dnd', Focus: 'dnd' } as Record<
                  string,
                  string
                >
              )[presence] ?? (raw.online === true ? 'online' : undefined));
        if (status) this.emit('PRESENCE_UPDATE', { userId: p.id, status });
      }
      return;
    }
    if (p.type === 'ServerCreate') {
      const server = p.server ?? p;
      if (typeof server._id === 'string' && SOCIAL_ID_PATTERN.test(server._id))
        this.servers.set(server._id, server);
      for (const c of p.channels ?? []) {
        if (c && typeof c._id === 'string' && SOCIAL_ID_PATTERN.test(c._id))
          this.channels.set(c._id, c);
      }
    }
    if (p.type === 'ServerDelete') this.servers.delete(p.id);
    if (p.type === 'ServerUpdate') {
      const old = this.servers.get(p.id);
      if (old) this.servers.set(p.id, { ...old, ...p.data });
    }
    if (p.type === 'ChannelCreate') this.channels.set(p._id, p);
    if (p.type === 'ChannelDelete') this.channels.delete(p.id);
    if (p.type === 'ChannelAck' && p.user === this.currentUser?.id) {
      this.emit('MESSAGE_ACK', { channelId: p.id, messageId: p.message_id, userId: p.user });
      await this.syncReadStates();
      return;
    }
    if (
      p.type?.startsWith('Server') ||
      p.type?.startsWith('Channel') ||
      p.type === 'UserRelationship'
    )
      this.emit('SOCIAL_REFRESH', null);
  }
  private scheduleReconnect() {
    if (this.stopped || this.retry) return;
    this.setStatus('reconnecting');
    this.retry = setTimeout(
      () => {
        this.retry = null;
        void this.openSocket().catch(() => this.scheduleReconnect());
      },
      Math.min(30000, 1000 * 2 ** Math.min(this.attempt++, 5)),
    );
  }
  async disconnect() {
    ++this.managementEpoch;
    ++this.sessionEpoch;
    ++this.aclEpoch;
    this.stopped = true;
    if (this.retry) clearTimeout(this.retry);
    this.retry = null;
    if (this.heartbeat) clearInterval(this.heartbeat);
    this.heartbeat = null;
    const socket = this.socket;
    this.socket = null;
    socket?.close(1000);
    this.setStatus('not-configured');
  }
  async logout() {
    await this.request('/auth/session/logout', 'POST').catch(() => {});
    await this.disconnect();
    this.token = null;
    this.currentUser = null;
    this.users.clear();
    this.servers.clear();
    this.channels.clear();
    this.messages.clear();
  }
}
