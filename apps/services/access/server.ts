import { registerSoundboard } from './soundboard';
import { registerPersonalSounds } from './personal-sounds';
import { registerMusicGateway } from './music-gateway';
import { registerMusicPlaylists } from './music-playlists';
import { registerDmCalls } from './dm-calls';
import { registerGifs } from './gifs';
import { registerRemoteControl, type RemoteConsent } from './remote-control';
import Fastify, { type FastifyReply, type FastifyRequest } from 'fastify';
import { InviteClaimReleased, RegistrationGate } from './registration';
import {
  mongoAccountInviteSink,
  seedAccountInvite,
  type AccountInviteSink,
} from './account-invites';
import { INVITE_PAGE_HEADERS, renderInvitePage } from './invite-page';
import { registerSignupRequests, SignupRequestStore, type SignupLimits } from './signup-requests';
import { MongoClient } from 'mongodb';
import { StoatAuthorizationReader } from './stoat-authorization';
import { createHash, randomUUID } from 'node:crypto';
import rateLimit from '@fastify/rate-limit';
import {
  AccessToken,
  DataPacket_Kind,
  RoomServiceClient,
  TrackSource,
  WebhookReceiver,
} from 'livekit-server-sdk';
import { z } from 'zod';
import { StoatClient, StoatError } from '@rooms/stoat';
import {
  INVITE_TOKEN_PATTERN,
  LEGACY_INVITE_CODE_PATTERN,
  SOCIAL_ID_PATTERN,
  inviteAppLink,
  inviteOrigin,
} from '@rooms/social';
import {
  stoatChannelPermissions,
  stoatCommunityAdmin,
  StoatPermissions as Permissions,
  type StoatServer,
  type StoatChannel,
  type StoatMember,
} from './stoat-permissions';
import { ingressLimit, TRUSTED_PROXIES } from '../shared/ingress';
import { identityCache } from '../shared/identity-cache';

export interface AccessConfig {
  soundboardDirectory?: string;
  personalSoundsDirectory?: string;
  /** False when the instance administrator turned personal sound uploads off; presets stay. */
  personalSoundUploads?: boolean;
  personalSoundsMaxBytes?: number;
  musicPlaylistsDirectory?: string;
  musicName?: string;
  musicUrl?: string;
  musicSecret?: string;
  stoatUrl?: string;
  /** Legacy configuration accepted only for validation tests; never contacts Spacebar. */ spacebarUrl?: string;
  livekitUrl: string;
  publicLivekitUrl: string;
  apiKey: string;
  apiSecret: string;
  registrationInvitesFile?: string;
  accountInviteMongoUrl?: string;
  /** Test seam for one-time Stoat account invitations; defaults to the delegated Mongo connection. */
  accountInviteSink?: AccountInviteSink;
  /** Public origin printed in invitation pages; the Host header is used when unset. */
  publicUrl?: string;
  /** Where invitation pages send people to download the desktop app. */
  downloadUrl?: string;
  socialReadMongoUrl?: string;
  /** Community that approved sign-up (no invitation link) asks to join; unset turns it off. */
  signupSpaceId?: string;
  signupRequestsFile?: string;
  signupLimits?: Partial<SignupLimits>;
  /** KLIPY app key for GIF search; kept on the server, never sent to clients. */
  klipyKey?: string;
}
const opaqueId = z.string().regex(SOCIAL_ID_PATTERN);
/** Server-sent request for one client to join another voice room; members cannot forge it. */
const MOVE_TOPIC = 'rooms-move-v1';
const channelBody = z.object({ channelId: opaqueId }).strict();
const credentialBody = z
  .object({ email: z.string().email().max(254), password: z.string().min(1).max(256) })
  .strict();
const registrationBody = credentialBody.extend({
  username: z
    .string()
    .min(2)
    .max(32)
    .regex(/^[\p{L}\d_.-]+$/u),
  inviteCode: z.string().regex(/^[a-zA-Z0-9_-]{2,128}$/),
});
/** Server-owned LiveKit participant attribute; clients cannot edit their own metadata. */
export const DEAFENED_ATTRIBUTE = 'rooms.deafened';
export async function createAccessServer(config: AccessConfig) {
  const server = Fastify({ logger: false, trustProxy: TRUSTED_PROXIES, bodyLimit: 16384 });
  ingressLimit(server, { perMinute: 1200, error: 'RATE_LIMITED' });
  // Media polling and room changes share this budget per client address (Caddy is trusted).
  await server.register(rateLimit, { max: 600, timeWindow: '1 minute' });
  const rawBodies = new WeakMap<FastifyRequest, string>();
  server.removeContentTypeParser('application/json');
  server.addContentTypeParser(
    ['application/json', 'application/webhook+json'],
    { parseAs: 'string' },
    (request, body, done) => {
      if (typeof body !== 'string') {
        done(new Error('Invalid request body'));
        return;
      }
      rawBodies.set(request, body);
      try {
        done(null, JSON.parse(body));
      } catch {
        const error = new Error('Invalid JSON') as Error & { statusCode: number };
        error.statusCode = 400;
        done(error);
      }
    },
  );
  const webhookReceiver = new WebhookReceiver(config.apiKey, config.apiSecret);
  const roomService = new RoomServiceClient(config.livekitUrl, config.apiKey, config.apiSecret);
  const grants = new Map<
    string,
    { userId: string; channelId: string; token: string; lastSeen: number }
  >();
  const parallelScreens = new Map<
    string,
    { channelId: string; userId: string; leaseId: string; createdAt: number }
  >();
  const screenLeases = new Map<string, { userId: string; createdAt: number; leaseId: string }>();
  // Ephemeral consent is bound to a real media lease, never an Activity host.
  type PresenterRequest = {
    requestId: string;
    userId: string;
    leaseId: string;
    createdAt: number;
    expiresAt: number;
  };
  type PresenterReservation = {
    requestId: string;
    userId: string;
    leaseId: string;
    expiresAt: number;
    released: boolean;
  };
  const screenRequests = new Map<string, PresenterRequest[]>();
  const screenReservations = new Map<string, PresenterReservation>();
  let remoteControl: RemoteConsent | null = null;
  const pruneScreen = (channelId: string) => {
    const now = Date.now(),
      lease = screenLeases.get(channelId);
    const requests = (screenRequests.get(channelId) ?? []).filter(
      (r) => r.expiresAt > now && r.leaseId === lease?.leaseId,
    );
    if (requests.length) screenRequests.set(channelId, requests);
    else screenRequests.delete(channelId);
    const reservation = screenReservations.get(channelId);
    if (
      reservation &&
      (reservation.expiresAt <= now ||
        (!reservation.released && reservation.leaseId !== lease?.leaseId))
    )
      screenReservations.delete(channelId);
  };
  const invalidateScreenUser = (channelId: string, userId: string) => {
    remoteControl?.revoke(channelId, userId, true);
    parallelScreens.delete(`${channelId}:${userId}`);
    const lease = screenLeases.get(channelId);
    if (lease?.userId === userId) {
      screenLeases.delete(channelId);
      screenRequests.delete(channelId);
      screenReservations.delete(channelId);
    }
    const requests = (screenRequests.get(channelId) ?? []).filter((r) => r.userId !== userId);
    if (requests.length) screenRequests.set(channelId, requests);
    else screenRequests.delete(channelId);
    if (screenReservations.get(channelId)?.userId === userId) screenReservations.delete(channelId);
  };
  const inviteLocks = new Map<string, Promise<unknown>>();
  const socialOptions = {
    trustedInternalOrigin: true,
    apiRoot: !new URL(config.stoatUrl ?? 'http://127.0.0.1:3022').pathname.startsWith('/api'),
  };
  const reader = config.socialReadMongoUrl
    ? new StoatAuthorizationReader(config.socialReadMongoUrl)
    : null;
  server.addHook('onClose', async () => {
    await reader?.close();
  });
  /** Who a session belongs to, asked of Stoat at most once per token every 30 s (see identityCache). */
  const identify = identityCache((token: string) =>
    new StoatClient(
      config.stoatUrl ?? 'http://127.0.0.1:3022',
      token,
      socialOptions,
    ).getCurrentUser(),
  );
  server.addHook('onClose', async () => identify.clear());
  const roomName = (id: string) => `stoat-channel-${id}`;
  /**
   * Grants live in memory, so a restart forgets everyone already in a room. A caller whose
   * session was just authorized and who is still a participant in the LiveKit room is
   * registered again with that session instead of being told to rejoin.
   */
  const memberGrant = async (token: string, channelId: string, userId: string) => {
    const key = `${channelId}:${userId}`;
    const known = grants.get(key);
    if (known) return known;
    let participant;
    try {
      participant = await roomService.getParticipant(roomName(channelId), userId);
    } catch {
      return undefined;
    }
    if (participant?.identity !== userId) return undefined;
    const grant = { userId, channelId, token, lastSeen: Date.now() };
    grants.set(key, grant);
    return grant;
  };
  const dmCalls = registerDmCalls(server, {
    apiKey: config.apiKey,
    apiSecret: config.apiSecret,
    publicLivekitUrl: config.publicLivekitUrl,
    roomService,
    identify,
    authorize: (token, dmId) =>
      new StoatClient(config.stoatUrl ?? 'http://127.0.0.1:3022', token, socialOptions).getCallPeer(
        dmId,
      ),
    disconnect: async (room) => {
      try {
        await roomService.deleteRoom(room);
      } catch (error) {
        if ((error as { code?: string }).code !== 'not_found') throw error;
      }
    },
  });
  const authorize = async (token: string, channelId: string) => {
    const client = new StoatClient(
      config.stoatUrl ?? 'http://127.0.0.1:3022',
      token,
      socialOptions,
    );
    const user = await identify(token);
    const context = reader ? await reader.read(channelId, user.id) : null;
    const channel = context?.channel ?? (await client.getChannel(channelId));
    if (
      channel.channel_type !== 'TextChannel' ||
      !channel.voice ||
      typeof channel.server !== 'string'
    )
      throw new StoatError(403, 'VOICE_CHANNEL_REQUIRED');
    const [rawServer, rawMember] = context
      ? [context.server, context.member]
      : await Promise.all([
          client.getServer(channel.server),
          client.getMember(channel.server, user.id),
        ]);
    const permissions = stoatChannelPermissions(
      rawServer as StoatServer,
      channel as StoatChannel,
      rawMember as StoatMember,
      user.id,
    );
    if (
      (permissions & Permissions.VIEW_CHANNEL) === 0n ||
      (permissions & Permissions.CONNECT) === 0n
    )
      throw new StoatError(403, 'ROOM_ACCESS_DENIED');
    return {
      user,
      permissions,
      communityId: channel.server,
      ownerId: (rawServer as StoatServer).owner,
      canManage: stoatCommunityAdmin(rawServer as StoatServer, rawMember as StoatMember, user.id),
    };
  };
  registerSoundboard(server, {
    directory: config.soundboardDirectory,
    authorize: async (token, channelId) => {
      const value = await authorize(token, channelId);
      return {
        communityId: value.communityId,
        userId: value.user.id,
        canUpload: (value.permissions & Permissions.SPEAK) !== 0n,
        canManage: value.canManage,
      };
    },
  });
  const personalSounds = registerPersonalSounds(server, {
    directory: config.personalSoundsDirectory,
    uploads: config.personalSoundUploads ?? true,
    maxBytes: config.personalSoundsMaxBytes ?? 512 * 1024 * 1024,
    currentUser: identify,
    authorize: async (token, channelId) => ({
      userId: (await authorize(token, channelId)).user.id,
    }),
    // The owner's current membership, read with the listener's session.
    canView: async (token, channelId, userId) => {
      const client = new StoatClient(
        config.stoatUrl ?? 'http://127.0.0.1:3022',
        token,
        socialOptions,
      );
      const context = reader ? await reader.read(channelId, userId) : null;
      const channel = context?.channel ?? (await client.getChannel(channelId));
      if (typeof channel.server !== 'string') return false;
      const [rawServer, rawMember] = context
        ? [context.server, context.member]
        : await Promise.all([
            client.getServer(channel.server),
            client.getMember(channel.server, userId),
          ]);
      const permissions = stoatChannelPermissions(
        rawServer as StoatServer,
        channel as StoatChannel,
        rawMember as StoatMember,
        userId,
      );
      return (permissions & Permissions.VIEW_CHANNEL) !== 0n;
    },
    // Attributes merge, so rooms.deafened stays; a grant whose holder already left fails quietly.
    onAssignChanged: (userId, attributes) => {
      for (const grant of grants.values())
        if (grant.userId === userId)
          void roomService
            .updateParticipant(roomName(grant.channelId), userId, { attributes })
            .catch(() => {});
    },
  });
  registerMusicPlaylists(server, {
    directory: config.musicPlaylistsDirectory,
    authorize: async (token, channelId) => {
      const value = await authorize(token, channelId);
      return {
        communityId: value.communityId,
        userId: value.user.id,
        canControl:
          (value.permissions & Permissions.SPEAK) !== 0n &&
          (value.permissions & Permissions.LISTEN) !== 0n,
      };
    },
    references: async (channelId, source) => {
      if (!config.musicUrl || !config.musicSecret) throw Error('MUSIC_NOT_CONFIGURED');
      const response = await fetch(`${config.musicUrl}/v1/references`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${config.musicSecret}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ channelId, ...source }),
        redirect: 'error',
        signal: AbortSignal.timeout(60000),
      });
      if (!response.ok) {
        const failure = (await response.json().catch(() => null)) as { error?: unknown } | null;
        const code = failure?.error;
        throw Error(
          typeof code === 'string' &&
            /^MUSIC_SPOTIFY_PLAYLIST_(UNAVAILABLE|EMPTY|LIMIT|INCOMPLETE)$/.test(code)
            ? code
            : 'MUSIC_PLAYLIST_SOURCE_UNAVAILABLE',
        );
      }
      return response.json();
    },
  });
  const music = registerMusicGateway(server, {
    displayName: config.musicName,
    url: config.musicUrl,
    secret: config.musicSecret,
    apiKey: config.apiKey,
    apiSecret: config.apiSecret,
    livekitUrl: config.livekitUrl.replace(/^http/, 'ws'),
    roomService,
    authorize: async (token, channelId) => {
      const result = await authorize(token, channelId);
      return {
        userId: result.user.id,
        canControl:
          (result.permissions & Permissions.SPEAK) !== 0n &&
          (result.permissions & Permissions.LISTEN) !== 0n,
      };
    },
  });
  const screenMember = async (token: string, channelId: string) => {
    let result;
    try {
      result = await authorize(token, channelId);
    } catch (error) {
      const grant = [...grants.values()].find(
        (g) => g.channelId === channelId && g.token === token,
      );
      if (grant) invalidateScreenUser(channelId, grant.userId);
      throw error;
    }
    if ((result.permissions & Permissions.VIDEO) === 0n) {
      invalidateScreenUser(channelId, result.user.id);
      throw new StoatError(403, 'PRESENT_PERMISSION_REQUIRED');
    }
    const grant = await memberGrant(token, channelId, result.user.id);
    if (!grant || grant.token !== token) throw new StoatError(403, 'JOIN_VOICE_FIRST');
    let participant;
    try {
      participant = await roomService.getParticipant(roomName(channelId), result.user.id);
    } catch (error) {
      invalidateScreenUser(channelId, result.user.id);
      throw error;
    }
    if (!participant || participant.identity !== result.user.id) {
      invalidateScreenUser(channelId, result.user.id);
      throw new StoatError(403, 'JOIN_VOICE_FIRST');
    }
    return result;
  };
  const leaseContext = z.object({ channelId: opaqueId, leaseId: z.string().uuid() }).strict();
  const remoteMember = async (token: string, channelId: string) => {
    const result = await authorize(token, channelId);
    const grant = await memberGrant(token, channelId, result.user.id);
    if (!grant || grant.token !== token || (result.permissions & Permissions.LISTEN) === 0n)
      throw new StoatError(403, 'JOIN_VOICE_FIRST');
    const person = await roomService.getParticipant(roomName(channelId), result.user.id);
    if (person.identity !== result.user.id) throw new StoatError(403, 'JOIN_VOICE_FIRST');
    return {
      userId: result.user.id,
      participantSid: person.sid,
      label: result.user.displayName,
      human: !result.user.bot && !person.identity.startsWith('rooms-music-'),
      screens: person.tracks.filter((t) => t.source === TrackSource.SCREEN_SHARE).map((t) => t.sid),
    };
  };
  remoteControl = registerRemoteControl(server, {
    member: remoteMember,
    peer: async (channelId, userId) => {
      const grant = grants.get(`${channelId}:${userId}`);
      if (!grant) throw new StoatError(403, 'JOIN_VOICE_FIRST');
      return remoteMember(grant.token, channelId);
    },
    setData: async (channelId, userId, enabled) => {
      const grant = grants.get(`${channelId}:${userId}`);
      if (!grant) {
        if (enabled) throw new StoatError(403, 'JOIN_VOICE_FIRST');
        return;
      }
      const value = await authorize(grant.token, channelId).catch((error) => {
        if (enabled) throw error;
        return null;
      });
      if (!value) return;
      const hasScreen =
        (screenLeases.get(channelId)?.userId === userId ||
          parallelScreens.has(`${channelId}:${userId}`)) &&
        (value.permissions & Permissions.VIDEO) !== 0n;
      await roomService
        .updateParticipant(roomName(channelId), userId, {
          permission: {
            canPublish: sources(value.permissions).length > 0,
            canSubscribe: (value.permissions & Permissions.LISTEN) !== 0n,
            canPublishSources: sources(value.permissions, hasScreen),
            canPublishData: !value.user.bot,
            canUpdateMetadata: false,
          },
        })
        .catch((error) => {
          if (enabled) throw error;
        });
    },
  });
  const requestContext = leaseContext.extend({ requestId: z.string().uuid() });
  const requireLease = (channelId: string, leaseId: string) => {
    pruneScreen(channelId);
    const lease = screenLeases.get(channelId);
    if (!lease || lease.leaseId !== leaseId) throw new StoatError(409, 'SCREEN_LEASE_STALE');
    return lease;
  };
  const tokenOf = (header: string | undefined) => {
    if (!header || header.length > 8192) throw new StoatError(401, 'AUTH_REQUIRED');
    return header.replace(/^Bearer /, '');
  };
  const sources = (permissions: bigint, screen = false) => [
    ...((permissions & Permissions.SPEAK) !== 0n ? [TrackSource.MICROPHONE] : []),
    ...((permissions & Permissions.VIDEO) !== 0n ? [TrackSource.CAMERA] : []),
    ...(screen ? [TrackSource.SCREEN_SHARE, TrackSource.SCREEN_SHARE_AUDIO] : []),
  ];
  registerGifs(server, {
    key: config.klipyKey,
    user: async (authorization) => (await identify(tokenOf(authorization))).id,
  });
  server.setErrorHandler((error, request, reply) => {
    // A session Stoat no longer accepts must not keep passing the identity step from the cache.
    const authorization = request.headers.authorization;
    if (error instanceof StoatError && error.status === 401 && authorization)
      identify.forget(authorization.replace(/^Bearer /, ''));
    if (error instanceof StoatError)
      return reply.code(error.status).send({ error: error.code, message: error.message });
    if (error instanceof z.ZodError)
      return reply
        .code(400)
        .send({ error: 'INVALID_INPUT', message: 'Check the supplied fields and retry.' });
    if ((error as { statusCode?: number }).statusCode === 400)
      return reply.code(400).send({ error: 'INVALID_INPUT' });
    if ((error as { statusCode?: number }).statusCode === 429)
      return reply.code(429).send({
        error: 'RATE_LIMITED',
        message: 'Too many requests. Please wait before retrying.',
      });
    return reply.code(503).send({
      error: 'SERVICE_UNAVAILABLE',
      message: 'The access or media service is unavailable. Retry shortly.',
    });
  });
  server.post(
    '/v1/media/webhook',
    { bodyLimit: 65536, config: { rateLimit: { max: 240, timeWindow: '1 minute' } } },
    async (request, reply) => {
      let event;
      try {
        event = await webhookReceiver.receive(
          rawBodies.get(request) ?? '',
          request.headers.authorization,
        );
      } catch {
        return reply.code(401).send({ error: 'INVALID_WEBHOOK_SIGNATURE' });
      }
      if (event.event === 'participant_joined' && event.room?.name && event.participant?.identity) {
        const room = event.room.name,
          identity = event.participant.identity;
        if (await dmCalls.webhook(room, identity)) return { accepted: true };
        if (!room.startsWith('stoat-channel-')) return { accepted: true };
        const channelId = room.slice('stoat-channel-'.length);
        if (!SOCIAL_ID_PATTERN.test(channelId))
          return reply.code(400).send({ error: 'INVALID_ROOM' });
        if (await music.webhook(channelId, identity, event.participant.metadata ?? ''))
          return { accepted: true };
        invalidateScreenUser(channelId, identity);
        const grant = grants.get(`${channelId}:${identity}`);
        let valid = false;
        try {
          if (grant) {
            const result = await authorize(grant.token, channelId);
            valid = result.user.id === identity;
          }
        } catch {
          /* Fail closed on uncertain membership. */
        }
        if (!valid) {
          await roomService.removeParticipant(room, identity);
          grants.delete(`${channelId}:${identity}`);
          invalidateScreenUser(channelId, identity);
          return { accepted: true, removed: true };
        }
        const { user, permissions } = await authorize(grant!.token, channelId);
        await roomService.updateParticipant(room, identity, {
          permission: {
            canPublish: sources(permissions).length > 0,
            canSubscribe: (permissions & Permissions.LISTEN) !== 0n,
            canPublishData: !user.bot,
            canPublishSources: sources(permissions),
          },
        });
      }
      if (
        event.event === 'participant_left' &&
        event.room?.name?.startsWith('stoat-channel-') &&
        event.participant?.identity
      )
        invalidateScreenUser(
          event.room.name.slice('stoat-channel-'.length),
          event.participant.identity,
        );
      return { accepted: true };
    },
  );
  server.get('/health', async () => ({ service: 'rooms-access', ready: true }));
  const accountDatabase = config.accountInviteMongoUrl
    ? new MongoClient(config.accountInviteMongoUrl, {
        serverSelectionTimeoutMS: 5000,
        connectTimeoutMS: 5000,
      })
    : null;
  server.addHook('onClose', async () => {
    await accountDatabase?.close();
  });
  const registration = new RegistrationGate(
    config.registrationInvitesFile ?? '.local/stoat/registration-invites.json',
  );
  const accountInvites =
    config.accountInviteSink ?? (accountDatabase ? mongoAccountInviteSink(accountDatabase) : null);
  const stoat = (token?: string) =>
    new StoatClient(config.stoatUrl ?? 'http://127.0.0.1:3022', token, socialOptions);
  const inviteCode = z.object({ code: z.string().regex(LEGACY_INVITE_CODE_PATTERN) });
  /** Listing and revoking links stays with the space owner and owner-equivalent admins. */
  const requireSpaceAdmin = async (authorization: string | undefined, spaceId: string) => {
    const client = stoat(tokenOf(authorization));
    const user = await client.getCurrentUser();
    const space = (await client.getServer(spaceId)) as unknown as StoatServer;
    const member =
      space.owner === user.id
        ? null
        : ((await client.getMember(spaceId, user.id).catch(() => null)) as StoatMember | null);
    if (!stoatCommunityAdmin(space, member, user.id))
      throw new StoatError(403, 'INVITE_ADMIN_REQUIRED');
    return { client, userId: user.id };
  };
  const requireSpaceOwner = async (authorization: string | undefined, spaceId: string) =>
    (await requireSpaceAdmin(authorization, spaceId)).client;
  registerSignupRequests(server, {
    spaceId: config.signupSpaceId,
    store: new SignupRequestStore(config.signupRequestsFile ?? '.local/stoat/signup-requests.json'),
    registration,
    provisioning: !!accountInvites,
    limits: config.signupLimits,
    requireSpaceAdmin,
  });
  server.post('/v1/invites', async (request) => {
    const { channelId } = channelBody.parse(request.body);
    const token = tokenOf(request.headers.authorization);
    if (!accountInvites) throw new StoatError(501, 'INVITE_PROVISIONING_UNAVAILABLE');
    const client = stoat(token);
    const [user, channel] = await Promise.all([
      client.getCurrentUser(),
      client.getChannel(channelId),
    ]);
    if (channel.channel_type !== 'TextChannel' || typeof channel.server !== 'string')
      throw new StoatError(403, 'SERVER_CHANNEL_REQUIRED');
    const [rawServer, rawMember] = await Promise.all([
      client.getServer(channel.server),
      client.getMember(channel.server, user.id),
    ]);
    const permissions = stoatChannelPermissions(
      rawServer as StoatServer,
      channel as StoatChannel,
      rawMember as StoatMember,
      user.id,
    );
    // Any member holding Stoat's InviteOthers permission may invite; the owner still manages links.
    if (!(permissions & (1n << 25n))) throw new StoatError(403, 'INVITE_PERMISSION_REQUIRED');
    const upstream = await client.createUpstreamInvite(channelId);
    // Account invitations are seeded per signup, so one link can welcome several friends.
    const issued = await registration
      .issue({
        communityInviteCode: upstream.code,
        spaceId: channel.server,
        createdBy: user.id,
        source: 'app',
        upstreamOwned: true,
      })
      .catch(async (error) => {
        // No link refers to it, so the upstream invitation must not outlive this request.
        await client.deleteUpstreamInvite(upstream.code).catch(() => {});
        throw error;
      });
    return {
      ...upstream,
      code: issued.code,
      expiresAt: issued.expiresAt,
      maxUses: issued.maxUses,
      uses: 0,
    };
  });
  server.get(
    '/v1/spaces/:spaceId/invites',
    { config: { rateLimit: { max: 60, timeWindow: '1 minute' } } },
    async (request) => {
      const { spaceId } = z.object({ spaceId: opaqueId }).parse(request.params);
      await requireSpaceOwner(request.headers.authorization, spaceId);
      return { invites: await registration.list(spaceId) };
    },
  );
  server.delete(
    '/v1/spaces/:spaceId/invites/:id',
    { config: { rateLimit: { max: 60, timeWindow: '1 minute' } } },
    async (request) => {
      const { spaceId, id } = z
        .object({ spaceId: opaqueId, id: z.string().regex(/^[a-f0-9]{16}$/) })
        .parse(request.params);
      const client = await requireSpaceOwner(request.headers.authorization, spaceId);
      const revoked = await registration.revoke(spaceId, id);
      // Best effort: the link is already closed; a leftover upstream code never leaves the broker.
      if (revoked.releaseUpstream)
        await client.deleteUpstreamInvite(revoked.communityInviteCode).catch(() => {});
      return { revoked: true };
    },
  );
  server.get(
    '/v1/auth/invites/:code',
    { config: { rateLimit: { max: 60, timeWindow: '1 minute' } } },
    async (request) => {
      const { code } = inviteCode.parse(request.params);
      const ticket = await registration.inspect(code);
      const invite = await stoat().inspectUpstreamInvite(ticket.communityInviteCode);
      return { ...invite, code, expiresAt: ticket.expiresAt };
    },
  );
  server.post(
    '/v1/auth/invites/:code/join',
    { config: { rateLimit: { max: 60, timeWindow: '1 minute' } } },
    async (request) => {
      const { code } = inviteCode.parse(request.params);
      const client = stoat(tokenOf(request.headers.authorization));
      const user = await client.getCurrentUser();
      const isMember = (spaceId: string) =>
        client.getMember(spaceId, user.id).then(
          () => true,
          (error) => {
            if (error instanceof StoatError && [403, 404].includes(error.status)) return false;
            throw error;
          },
        );
      // Opening a link again as a member must not spend a use, even once it is full or expired.
      const known = await registration.peek(code);
      if (known?.spaceId && (await isMember(known.spaceId))) {
        const space = await client.getServer(known.spaceId);
        return {
          code,
          space: { id: known.spaceId, name: typeof space.name === 'string' ? space.name : '' },
          channel: null,
          expiresAt: known.expiresAt,
        };
      }
      const ticket = await registration.inspect(code);
      const invite = await client.inspectUpstreamInvite(ticket.communityInviteCode);
      // Legacy links carry no space id; the upstream invitation names the community instead.
      const legacySpace = ticket.spaceId ? undefined : invite.space?.id;
      if (legacySpace && (await isMember(legacySpace)))
        return { ...invite, code, expiresAt: ticket.expiresAt };
      return registration.consume(code, async (grant) => {
        try {
          const joined = await client.acceptInvite(grant.communityInviteCode);
          return { ...joined, code };
        } catch (error) {
          // A definite refusal (banned, already joined, server full) joined nobody: return the use.
          if (
            error instanceof StoatError &&
            error.status >= 400 &&
            error.status < 500 &&
            ![408, 429].includes(error.status)
          )
            throw new InviteClaimReleased(error);
          throw error;
        }
      });
    },
  );
  server.post(
    '/v1/auth/register',
    { config: { rateLimit: { max: 5, timeWindow: '1 minute' } } },
    async (request) => {
      const body = registrationBody.parse(request.body);
      return registration.consume(body.inviteCode, async (grant) => {
        let accountInviteCode = grant.accountInviteCode;
        if (!accountInviteCode) {
          if (!accountInvites)
            throw new InviteClaimReleased(new StoatError(501, 'INVITE_PROVISIONING_UNAVAILABLE'));
          try {
            accountInviteCode = await seedAccountInvite(accountInvites);
          } catch {
            throw new InviteClaimReleased(new StoatError(503, 'INVITE_PROVISIONING_UNAVAILABLE'));
          }
        }
        const client = stoat();
        let stage: 'prepare' | 'account-create' | 'account-created' = 'prepare';
        try {
          await client.registerUpstream(
            { ...body, inviteCode: grant.communityInviteCode, accountInviteCode },
            { onStage: (next) => (stage = next) },
          );
        } catch (error) {
          // Only a definite rejection before any account exists returns the use to the link.
          const definite =
            error instanceof StoatError &&
            error.status >= 400 &&
            error.status < 500 &&
            ![408, 429].includes(error.status);
          if (stage === 'prepare' || (stage === 'account-create' && definite))
            throw new InviteClaimReleased(error);
          throw error;
        }
        const token = client.getToken();
        if (!token) throw new StoatError(502, 'INVALID_SESSION_RESPONSE');
        return { token };
      });
    },
  );
  const downloadUrl = config.downloadUrl ?? 'https://github.com/egemenmermer/rooms/releases/latest';
  const pageOrigin = (request: FastifyRequest) => {
    if (config.publicUrl) return inviteOrigin(config.publicUrl);
    const host = request.headers.host ?? '';
    const loopback = /^(127\.0\.0\.1|localhost|\[::1\])(:\d+)?$/.test(host);
    const proto = loopback && request.headers['x-forwarded-proto'] === 'http' ? 'http' : 'https';
    return inviteOrigin(`${proto}://${host}`);
  };
  // Read-only landing page: link previews and browser prefetches never spend a use.
  const invitePage = async (request: FastifyRequest, reply: FastifyReply) => {
    const { token } = z.object({ token: z.string() }).parse(request.params);
    let state: Parameters<typeof renderInvitePage>[0] = { kind: 'invalid' };
    if (INVITE_TOKEN_PATTERN.test(token)) {
      try {
        const ticket = await registration.inspect(token);
        const invite = await stoat()
          .inspectUpstreamInvite(ticket.communityInviteCode)
          .catch(() => null);
        const origin = pageOrigin(request);
        state = {
          kind: 'valid',
          communityName: invite?.space?.name ?? null,
          expiresAt: ticket.expiresAt,
          appLink: origin ? inviteAppLink(origin, token) : null,
          downloadUrl,
        };
      } catch {
        state = { kind: 'invalid' };
      }
    }
    const rendered = renderInvitePage(state, request.headers['accept-language']);
    return reply.code(rendered.status).headers(INVITE_PAGE_HEADERS).send(rendered.html);
  };
  for (const url of ['/davet/:token', '/davet/:token/'])
    server.get(url, { config: { rateLimit: { max: 60, timeWindow: '1 minute' } } }, invitePage);
  // Deafen is local playback state. The service publishes it as a server-owned participant attribute
  // so rooms and the directory can show it without granting clients canUpdateOwnMetadata.
  server.post(
    '/v1/media/deafen',
    {
      config: {
        rateLimit: {
          max: 60,
          timeWindow: '1 minute',
          keyGenerator: (request: FastifyRequest) =>
            'voice-deafen:' +
            createHash('sha256')
              .update(request.headers.authorization ?? request.ip)
              .digest('hex'),
        },
      },
    },
    async (request) => {
      const { channelId, deafened } = z
        .object({ channelId: opaqueId, deafened: z.boolean() })
        .strict()
        .parse(request.body);
      const token = tokenOf(request.headers.authorization);
      const { user } = await authorize(token, channelId);
      const grant = await memberGrant(token, channelId, user.id);
      if (!grant || grant.token !== token) throw new StoatError(403, 'JOIN_VOICE_FIRST');
      await roomService.updateParticipant(roomName(channelId), user.id, {
        attributes: { [DEAFENED_ATTRIBUTE]: deafened ? '1' : '' },
      });
      return { deafened };
    },
  );
  // Reject legacy Discord-shaped auth endpoints; clients must use Stoat's official account/session flow.
  server.post('/api/v9/auth/register', async (_request, reply) =>
    reply.code(400).send({ error: 'STOAT_AUTH_REQUIRED' }),
  );
  // Observation is authorized independently of joining/publishing media.
  server.post(
    '/v1/media/directory',
    {
      config: {
        rateLimit: {
          max: 30,
          timeWindow: '1 minute',
          keyGenerator: (request: FastifyRequest) =>
            'voice-directory:' +
            createHash('sha256')
              .update(request.headers.authorization ?? request.ip)
              .digest('hex'),
        },
      },
    },
    async (request) => {
      const { channelIds } = z
        .object({ channelIds: z.array(opaqueId).min(1).max(32) })
        .strict()
        .parse(request.body);
      const token = tokenOf(request.headers.authorization);
      const client = new StoatClient(
        config.stoatUrl ?? 'http://127.0.0.1:3022',
        token,
        socialOptions,
      );
      const user = await identify(token);
      const permitted: string[] = [];
      for (const channelId of new Set(channelIds)) {
        try {
          const context = reader ? await reader.read(channelId, user.id) : null;
          const channel = context?.channel ?? (await client.getChannel(channelId));
          if (
            channel.channel_type !== 'TextChannel' ||
            !channel.voice ||
            typeof channel.server !== 'string'
          )
            continue;
          const [rawServer, rawMember] = context
            ? [context.server, context.member]
            : await Promise.all([
                client.getServer(channel.server),
                client.getMember(channel.server, user.id),
              ]);
          const permissions = stoatChannelPermissions(
            rawServer as StoatServer,
            channel as StoatChannel,
            rawMember as StoatMember,
            user.id,
          );
          if ((permissions & Permissions.VIEW_CHANNEL) !== 0n) permitted.push(channelId);
        } catch (error) {
          if (!(error instanceof StoatError) || ![403, 404].includes(error.status)) throw error;
        }
      }
      if (!permitted.length) return { rooms: [] };
      const liveRooms = await roomService.listRooms(permitted.map(roomName));
      const liveNames = new Set(liveRooms.map((room) => room.name));
      const rooms = await Promise.all(
        permitted.map(async (channelId) => {
          let participants: Awaited<ReturnType<typeof roomService.listParticipants>> = [];
          if (liveNames.has(roomName(channelId)))
            try {
              participants = await roomService.listParticipants(roomName(channelId));
            } catch (error) {
              if ((error as { code?: string }).code !== 'not_found') throw error;
            }
          return {
            channelId,
            participants: participants.slice(0, 100).map((p) => ({
              id: p.identity,
              name: (p.name || p.identity).slice(0, 128),
              muted: !p.tracks.some((t) => t.source === TrackSource.MICROPHONE && !t.muted),
              ...(p.tracks.some((t) => t.source === TrackSource.SCREEN_SHARE && !t.muted)
                ? { screen: true }
                : {}),
              ...(p.attributes?.[DEAFENED_ATTRIBUTE] === '1' ? { deafened: true } : {}),
            })),
          };
        }),
      );
      return { rooms };
    },
  );
  // Moving or disconnecting someone needs Stoat's MoveMembers in their room (and, to move, in the
  // target). A move only tells their client where to go: it joins through the normal grant check.
  server.post(
    '/v1/media/moderate',
    {
      config: {
        rateLimit: {
          max: 60,
          timeWindow: '1 minute',
          keyGenerator: (request: FastifyRequest) =>
            'voice-moderate:' +
            createHash('sha256')
              .update(request.headers.authorization ?? request.ip)
              .digest('hex'),
        },
      },
    },
    async (request) => {
      const body = z
        .object({
          channelId: opaqueId,
          userId: opaqueId,
          action: z.enum(['disconnect', 'move']),
          targetChannelId: opaqueId.optional(),
        })
        .strict()
        .refine(
          (v) =>
            (v.action === 'move') === (v.targetChannelId !== undefined) &&
            v.targetChannelId !== v.channelId,
        )
        .parse(request.body);
      const token = tokenOf(request.headers.authorization);
      const moderator = await authorize(token, body.channelId);
      if ((moderator.permissions & Permissions.MOVE_MEMBERS) === 0n)
        throw new StoatError(403, 'MOVE_MEMBERS_REQUIRED');
      if (body.userId === moderator.user.id) throw new StoatError(400, 'MODERATE_SELF');
      if (body.userId === moderator.ownerId) throw new StoatError(403, 'MOVE_MEMBERS_REQUIRED');
      const room = roomName(body.channelId);
      const participant = await roomService.getParticipant(room, body.userId).catch(() => null);
      if (!participant) throw new StoatError(404, 'MEMBER_NOT_IN_ROOM');
      if (body.action === 'move') {
        const target = await authorize(token, body.targetChannelId!);
        if (
          target.communityId !== moderator.communityId ||
          (target.permissions & Permissions.MOVE_MEMBERS) === 0n
        )
          throw new StoatError(403, 'MOVE_MEMBERS_REQUIRED');
        await roomService.sendData(
          room,
          new TextEncoder().encode(
            JSON.stringify({ channelId: body.targetChannelId, by: moderator.user.id }),
          ),
          DataPacket_Kind.RELIABLE,
          { destinationIdentities: [body.userId], topic: MOVE_TOPIC },
        );
        return { moved: true };
      }
      await roomService.removeParticipant(room, body.userId);
      grants.delete(`${body.channelId}:${body.userId}`);
      invalidateScreenUser(body.channelId, body.userId);
      return { disconnected: true };
    },
  );
  // Every member may publish data packets: cursors, watch state and remote input all ride on it.
  // Remote input stays safe because each frame carries a per-lease MAC the receiver verifies.
  server.post('/v1/media/grant', async (request) => {
    const { channelId } = channelBody.parse(request.body);
    const token = tokenOf(request.headers.authorization);
    const { user, permissions } = await authorize(token, channelId);
    remoteControl?.revoke(channelId, user.id, true);
    const attributes = await personalSounds.attributes(user.id);
    const access = new AccessToken(config.apiKey, config.apiSecret, {
      identity: user.id,
      name: user.displayName,
      ttl: 300,
      ...(Object.keys(attributes).length ? { attributes } : {}),
    });
    access.addGrant({
      roomJoin: true,
      room: roomName(channelId),
      canSubscribe: (permissions & Permissions.LISTEN) !== 0n,
      canPublish: sources(permissions).length > 0,
      canPublishSources: sources(permissions),
      canPublishData: !user.bot,
      canUpdateOwnMetadata: false,
    });
    grants.set(`${channelId}:${user.id}`, {
      userId: user.id,
      channelId,
      token,
      lastSeen: Date.now(),
    });
    return {
      serverUrl: config.publicLivekitUrl,
      roomName: roomName(channelId),
      token: await access.toJwt(),
      expiresAt: new Date(Date.now() + 300000).toISOString(),
    };
  });
  // Each connected member gets a separate screen grant; no other publisher is revoked.
  server.post('/v1/media/screens/acquire', async (request) => {
    const { channelId } = channelBody.parse(request.body),
      token = tokenOf(request.headers.authorization);
    const { user, permissions } = await screenMember(token, channelId),
      key = `${channelId}:${user.id}`;
    const previous = parallelScreens.get(key);
    if (
      !previous &&
      (parallelScreens.size >= 1000 ||
        [...parallelScreens.values()].filter((p) => p.channelId === channelId).length >= 20)
    )
      throw new StoatError(409, 'SCREEN_LEASE_LIMIT');
    const lease = previous ?? {
      channelId,
      userId: user.id,
      leaseId: randomUUID(),
      createdAt: Date.now(),
    };
    parallelScreens.set(key, lease);
    try {
      const current = await screenMember(token, channelId);
      if (current.user.id !== user.id || parallelScreens.get(key) !== lease)
        throw new StoatError(409, 'SCREEN_LEASE_STALE');
      await roomService.updateParticipant(roomName(channelId), user.id, {
        permission: {
          canPublish: true,
          canSubscribe: (current.permissions & Permissions.LISTEN) !== 0n,
          canPublishData: !user.bot,
          canPublishSources: sources(current.permissions, true),
        },
      });
      if (parallelScreens.get(key) !== lease) {
        await roomService.updateParticipant(roomName(channelId), user.id, {
          permission: { canPublishSources: sources(permissions) },
        });
        throw new StoatError(409, 'SCREEN_LEASE_STALE');
      }
      return { granted: true, leaseId: lease.leaseId };
    } catch (error) {
      if (!previous && parallelScreens.get(key) === lease) {
        try {
          await roomService.updateParticipant(roomName(channelId), user.id, {
            permission: { canPublishSources: sources(permissions) },
          });
          parallelScreens.delete(key);
        } catch {
          /* Membership sweep retries uncertain revocation. */
        }
      }
      throw error;
    }
  });
  server.post('/v1/media/screens/release', async (request) => {
    const { channelId } = channelBody.parse(request.body),
      token = tokenOf(request.headers.authorization);
    const { user, permissions } = await authorize(token, channelId);
    await roomService.updateParticipant(roomName(channelId), user.id, {
      permission: {
        canPublish: sources(permissions).length > 0,
        canSubscribe: (permissions & Permissions.LISTEN) !== 0n,
        canPublishData: !user.bot,
        canPublishSources: sources(permissions),
      },
    });
    invalidateScreenUser(channelId, user.id);
    return { released: true };
  });
  server.post('/v1/media/screen/state', async (request) => {
    const { channelId } = channelBody.parse(request.body);
    await screenMember(tokenOf(request.headers.authorization), channelId);
    pruneScreen(channelId);
    const lease = screenLeases.get(channelId),
      reservation = screenReservations.get(channelId);
    return {
      presenter: lease ? { userId: lease.userId, leaseId: lease.leaseId } : null,
      requests: screenRequests.get(channelId) ?? [],
      reservation: reservation ?? null,
    };
  });
  server.post('/v1/media/screen/request', async (request) => {
    const { channelId, leaseId, requestId } = requestContext.parse(request.body);
    const { user } = await screenMember(tokenOf(request.headers.authorization), channelId);
    const lease = requireLease(channelId, leaseId);
    if (lease.userId === user.id) throw new StoatError(409, 'ALREADY_PRESENTER');
    if (screenReservations.has(channelId)) throw new StoatError(409, 'SCREEN_HANDOFF_PENDING');
    const requests = screenRequests.get(channelId) ?? [];
    if (requests.some((r) => r.userId === user.id || r.requestId === requestId))
      throw new StoatError(409, 'SCREEN_REQUEST_EXISTS');
    if (requests.length >= 20 || (!screenRequests.has(channelId) && screenRequests.size >= 1000))
      throw new StoatError(409, 'SCREEN_REQUEST_LIMIT');
    const entry = {
      requestId,
      userId: user.id,
      leaseId,
      createdAt: Date.now(),
      expiresAt: Date.now() + 60000,
    };
    requests.push(entry);
    screenRequests.set(channelId, requests);
    return { request: entry };
  });
  server.post('/v1/media/screen/request/cancel', async (request) => {
    const { channelId, leaseId, requestId } = requestContext.parse(request.body);
    const { user } = await screenMember(tokenOf(request.headers.authorization), channelId);
    pruneScreen(channelId);
    const reservation = screenReservations.get(channelId);
    if (reservation?.requestId === requestId && reservation.leaseId === leaseId) {
      if (reservation.userId !== user.id)
        throw new StoatError(403, 'SCREEN_REQUEST_OWNER_REQUIRED');
      screenReservations.delete(channelId);
      return { cancelled: true };
    }
    requireLease(channelId, leaseId);
    const requests = screenRequests.get(channelId) ?? [],
      entry = requests.find((r) => r.requestId === requestId);
    if (!entry) throw new StoatError(409, 'SCREEN_REQUEST_STALE');
    if (entry.userId !== user.id) throw new StoatError(403, 'SCREEN_REQUEST_OWNER_REQUIRED');
    screenRequests.set(
      channelId,
      requests.filter((r) => r !== entry),
    );
    return { cancelled: true };
  });
  server.post('/v1/media/screen/request/decide', async (request) => {
    const { channelId, leaseId, requestId, approve } = requestContext
      .extend({ approve: z.boolean() })
      .parse(request.body);
    const { user } = await screenMember(tokenOf(request.headers.authorization), channelId);
    const lease = requireLease(channelId, leaseId);
    if (lease.userId !== user.id) throw new StoatError(403, 'SCREEN_PRESENTER_REQUIRED');
    if (screenReservations.has(channelId)) throw new StoatError(409, 'SCREEN_HANDOFF_PENDING');
    const requests = screenRequests.get(channelId) ?? [],
      entry = requests.find((r) => r.requestId === requestId);
    if (!entry) throw new StoatError(409, 'SCREEN_REQUEST_STALE');
    if (approve) {
      const grant = grants.get(`${channelId}:${entry.userId}`);
      if (!grant) throw new StoatError(409, 'SCREEN_REQUEST_STALE');
      const requester = await screenMember(grant.token, channelId);
      if (requester.user.id !== entry.userId) throw new StoatError(409, 'SCREEN_REQUEST_STALE');
      const controller = await screenMember(tokenOf(request.headers.authorization), channelId);
      if (controller.user.id !== user.id) throw new StoatError(403, 'SCREEN_PRESENTER_REQUIRED');
      requireLease(channelId, leaseId);
      if (
        entry.expiresAt <= Date.now() ||
        !(screenRequests.get(channelId) ?? []).includes(entry) ||
        screenReservations.has(channelId)
      )
        throw new StoatError(409, 'SCREEN_REQUEST_STALE');
      screenReservations.set(channelId, {
        requestId,
        userId: entry.userId,
        leaseId,
        expiresAt: Date.now() + 30000,
        released: false,
      });
      screenRequests.delete(channelId);
    } else
      screenRequests.set(
        channelId,
        requests.filter((r) => r !== entry),
      );
    return { approved: approve, awaitingRelease: approve };
  });
  server.post('/v1/media/screen/acquire', async (request) => {
    const { channelId } = channelBody.parse(request.body);
    const token = tokenOf(request.headers.authorization);
    const { user, permissions } = await authorize(token, channelId);
    if ((permissions & Permissions.VIDEO) === 0n) {
      invalidateScreenUser(channelId, user.id);
      throw new StoatError(403, 'PRESENT_PERMISSION_REQUIRED');
    }
    pruneScreen(channelId);
    const reservation = screenReservations.get(channelId);
    if (reservation && (!reservation.released || reservation.userId !== user.id))
      throw new StoatError(409, 'SCREEN_HANDOFF_PENDING');
    if (reservation) await screenMember(token, channelId);
    // Recheck after async authorization: a cancelled/expired reservation cannot authorize acquisition.
    if (
      reservation &&
      (screenReservations.get(channelId) !== reservation || reservation.expiresAt <= Date.now())
    )
      throw new StoatError(409, 'SCREEN_RESERVATION_STALE');
    const previous = screenLeases.get(channelId);
    if (previous && previous.userId !== user.id) throw new StoatError(409, 'PRESENTER_BUSY');
    if (!previous && screenLeases.size >= 1000) throw new StoatError(409, 'SCREEN_LEASE_LIMIT');
    const lease = previous ?? { userId: user.id, createdAt: Date.now(), leaseId: randomUUID() };
    screenLeases.set(channelId, lease);
    try {
      const participants = await roomService.listParticipants(roomName(channelId));
      if (screenLeases.get(channelId) !== lease) throw new StoatError(409, 'SCREEN_LEASE_STALE');
      if (
        participants.some(
          (p) =>
            p.identity !== user.id &&
            p.tracks.some(
              (t) =>
                t.source === TrackSource.SCREEN_SHARE ||
                t.source === TrackSource.SCREEN_SHARE_AUDIO,
            ),
        )
      )
        throw new StoatError(409, 'PRESENTER_BUSY');
      if (
        reservation &&
        (screenReservations.get(channelId) !== reservation || reservation.expiresAt <= Date.now())
      )
        throw new StoatError(409, 'SCREEN_RESERVATION_STALE');
      const current = await authorize(token, channelId);
      if (current.user.id !== user.id || (current.permissions & Permissions.VIDEO) === 0n)
        throw new StoatError(403, 'PRESENT_PERMISSION_REQUIRED');
      if (
        screenLeases.get(channelId) !== lease ||
        (reservation &&
          (screenReservations.get(channelId) !== reservation ||
            reservation.expiresAt <= Date.now()))
      )
        throw new StoatError(409, 'SCREEN_LEASE_STALE');
      await roomService.updateParticipant(roomName(channelId), user.id, {
        permission: {
          canPublish: true,
          canSubscribe: (current.permissions & Permissions.LISTEN) !== 0n,
          canPublishData: !user.bot,
          canPublishSources: sources(current.permissions, true),
        },
      });
      if (
        screenLeases.get(channelId) !== lease ||
        (reservation &&
          (screenReservations.get(channelId) !== reservation ||
            reservation.expiresAt <= Date.now()))
      ) {
        await roomService.updateParticipant(roomName(channelId), user.id, {
          permission: { canPublishSources: sources(permissions) },
        });
        throw new StoatError(409, 'SCREEN_LEASE_STALE');
      }
      if (reservation) screenReservations.delete(channelId);
      screenRequests.delete(channelId);
      return { granted: true, leaseId: lease.leaseId };
    } catch (error) {
      if (!previous && screenLeases.get(channelId) === lease) {
        // An uncertain grant must keep excluding others until SFU permission revocation succeeds.
        try {
          await roomService.updateParticipant(roomName(channelId), user.id, {
            permission: { canPublishSources: sources(permissions) },
          });
          if (screenLeases.get(channelId) === lease) screenLeases.delete(channelId);
        } catch {
          /* Retain the lease; the membership sweep retries safe cleanup. */
        }
      }
      throw error;
    }
  });
  server.post('/v1/media/screen/release', async (request) => {
    const { channelId } = channelBody.parse(request.body);
    const token = tokenOf(request.headers.authorization);
    const { user, permissions } = await authorize(token, channelId);
    pruneScreen(channelId);
    const lease = screenLeases.get(channelId);
    // Keep the lease blocking acquisition until publication permission was actually removed.
    await roomService.updateParticipant(roomName(channelId), user.id, {
      permission: {
        canPublish: sources(permissions).length > 0,
        canSubscribe: (permissions & Permissions.LISTEN) !== 0n,
        canPublishData: !user.bot,
        canPublishSources: sources(permissions),
      },
    });
    if (lease?.userId === user.id && screenLeases.get(channelId) === lease) {
      screenLeases.delete(channelId);
      screenRequests.delete(channelId);
      const reservation = screenReservations.get(channelId);
      if (reservation?.leaseId === lease.leaseId) reservation.released = true;
    }
    return { released: true };
  });
  server.post('/v1/media/leave', async (request) => {
    const { channelId } = channelBody.parse(request.body);
    const user = await identify(tokenOf(request.headers.authorization));
    grants.delete(`${channelId}:${user.id}`);
    invalidateScreenUser(channelId, user.id);
    await roomService.removeParticipant(roomName(channelId), user.id).catch(() => {});
    return { left: true };
  });
  // Recheck memberships on existing sessions; revoked permissions terminate media.
  let sweeping = false;
  const sweep = setInterval(async () => {
    if (sweeping) return;
    sweeping = true;
    try {
      for (const channelId of new Set([...screenRequests.keys(), ...screenReservations.keys()]))
        pruneScreen(channelId);
      for (const [key, grant] of grants) {
        try {
          const { user, permissions } = await authorize(grant.token, grant.channelId);
          const participant = await roomService
            .getParticipant(roomName(grant.channelId), grant.userId)
            .catch(() => null);
          if (!participant && Date.now() - grant.lastSeen > 30000) {
            grants.delete(key);
            invalidateScreenUser(grant.channelId, grant.userId);
          }
          if ((permissions & Permissions.VIDEO) === 0n)
            invalidateScreenUser(grant.channelId, grant.userId);
          pruneScreen(grant.channelId);
          const lease = screenLeases.get(grant.channelId);
          const parallel = parallelScreens.get(key);
          if (
            parallel &&
            Date.now() - parallel.createdAt > 15000 &&
            !participant?.tracks.some(
              (t) =>
                t.source === TrackSource.SCREEN_SHARE ||
                t.source === TrackSource.SCREEN_SHARE_AUDIO,
            )
          ) {
            if (participant)
              await roomService.updateParticipant(roomName(grant.channelId), grant.userId, {
                permission: { canPublishSources: sources(permissions) },
              });
            if (parallelScreens.get(key) === parallel) parallelScreens.delete(key);
          }
          if (participant)
            await roomService.updateParticipant(roomName(grant.channelId), grant.userId, {
              permission: {
                canSubscribe: (permissions & Permissions.LISTEN) !== 0n,
                canPublish: sources(permissions).length > 0,
                canPublishData: !user.bot,
                canPublishSources: sources(
                  permissions,
                  (lease?.userId === grant.userId || parallelScreens.has(key)) &&
                    (permissions & Permissions.VIDEO) !== 0n,
                ),
              },
            });
          if (
            lease?.userId === grant.userId &&
            Date.now() - lease.createdAt > 15000 &&
            !participant?.tracks.some(
              (t) =>
                t.source === TrackSource.SCREEN_SHARE ||
                t.source === TrackSource.SCREEN_SHARE_AUDIO,
            )
          ) {
            if (participant) {
              const { permissions } = await authorize(grant.token, grant.channelId);
              await roomService.updateParticipant(roomName(grant.channelId), grant.userId, {
                permission: { canPublishSources: sources(permissions) },
              });
            }
            if (screenLeases.get(grant.channelId) === lease)
              invalidateScreenUser(grant.channelId, grant.userId);
          }
        } catch (error) {
          if (
            error instanceof StoatError &&
            (error.status === 401 || error.status === 403 || error.status === 404)
          ) {
            if (error.status === 401) identify.forget(grant.token);
            await roomService
              .removeParticipant(roomName(grant.channelId), grant.userId)
              .catch(() => {});
            grants.delete(key);
            invalidateScreenUser(grant.channelId, grant.userId);
          }
        }
      }
    } finally {
      sweeping = false;
    }
  }, 10000);
  sweep.unref();
  server.addHook('onClose', async () => {
    clearInterval(sweep);
    grants.clear();
    parallelScreens.clear();
    screenLeases.clear();
    screenRequests.clear();
    screenReservations.clear();
  });
  return server;
}
