import type { FastifyInstance } from 'fastify';
import { AccessToken, TrackSource, type RoomServiceClient } from 'livekit-server-sdk';
import {
  randomUUID,
  timingSafeEqual,
  createHash,
  createCipheriv,
  createDecipheriv,
  hkdfSync,
  randomBytes,
} from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { chmod, rename, writeFile, rm } from 'node:fs/promises';
import { z } from 'zod';
import {
  musicCommandSchema,
  musicSnapshotSchema,
  musicIdentity,
  musicSearchQuerySchema,
  musicSearchResultsSchema,
  musicHistorySchema,
  musicFailedSongSchema,
} from '../../../packages/shared-contracts/src/music';
const channel = z.string().regex(/^[A-Za-z0-9_-]{1,128}$/);
interface Lease {
  id: string;
  token: string;
  userId: string;
  expires: number;
  /** When the room was first seen without people; a short gap (everyone reconnecting) is kept. */
  emptySince?: number;
}
/** Grace for an empty room before the DJ leaves it. */
const EMPTY_GRACE_MS = 60_000;
/** A lease may renew this long after it expired on disk: the time an access restart can take. */
const RESTORE_WINDOW_MS = 5 * 60_000;
const LEASE_TTL_MS = 35_000;
const LEASE_FILE_VERSION = 1;
/** Default place for the persisted leases: the access state volume, when the service has one. */
const defaultLeaseFile = () =>
  process.env.ROOMS_MUSIC_LEASES_FILE ||
  (existsSync('/state') ? '/state/music-leases.json' : undefined);
const leaseKey = (secret: string) =>
  Buffer.from(hkdfSync('sha256', secret, 'rooms-music-leases', 'lease-file-v1', 32));
function sealLeases(secret: string, leases: Map<string, Lease>) {
  const iv = randomBytes(12),
    cipher = createCipheriv('aes-256-gcm', leaseKey(secret), iv),
    plain = JSON.stringify(
      [...leases].map(([channelId, l]) => ({
        channelId,
        id: l.id,
        token: l.token,
        userId: l.userId,
        expires: l.expires,
      })),
    );
  const data = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  return JSON.stringify({
    v: LEASE_FILE_VERSION,
    iv: iv.toString('base64'),
    tag: cipher.getAuthTag().toString('base64'),
    data: data.toString('base64'),
  });
}
function openLeases(secret: string, raw: string, now: number) {
  const file = z
    .object({ v: z.literal(LEASE_FILE_VERSION), iv: z.string(), tag: z.string(), data: z.string() })
    .parse(JSON.parse(raw));
  const decipher = createDecipheriv(
    'aes-256-gcm',
    leaseKey(secret),
    Buffer.from(file.iv, 'base64'),
  );
  decipher.setAuthTag(Buffer.from(file.tag, 'base64'));
  const plain = Buffer.concat([
    decipher.update(Buffer.from(file.data, 'base64')),
    decipher.final(),
  ]).toString('utf8');
  const entries = z
    .array(
      z.object({
        channelId: channel,
        id: z.string().uuid(),
        token: z.string().min(1),
        userId: z.string().min(1),
        expires: z.number(),
      }),
    )
    .parse(JSON.parse(plain));
  // Only leases that were alive moments ago come back; the sweeper and every renewal still
  // re-validate the stored user token, so a lost right or a gone room ends the lease as before.
  return entries
    .filter((e) => e.expires > now - RESTORE_WINDOW_MS)
    .map((e): [string, Lease] => [
      e.channelId,
      {
        id: e.id,
        token: e.token,
        userId: e.userId,
        expires: Math.max(e.expires, now + LEASE_TTL_MS),
      },
    ]);
}
/**
 * A refusal that ends the session: the commander lost the right, or the room is gone. Anything
 * else (Stoat 5xx or timeout, a LiveKit API error) is passing and must not wipe the queue.
 */
const definitive = (error: unknown) =>
  error instanceof Error &&
  (error.message === 'MUSIC_PERMISSION_DENIED' ||
    error.message === 'MUSIC_ROOM_EMPTY' ||
    [401, 403, 404].includes((error as { status?: number }).status ?? 0));
export function registerMusicGateway(
  server: FastifyInstance,
  options: {
    displayName?: string;
    url?: string;
    secret?: string;
    apiKey: string;
    apiSecret: string;
    livekitUrl: string;
    roomService: Pick<
      RoomServiceClient,
      'getParticipant' | 'listParticipants' | 'removeParticipant' | 'updateParticipant'
    >;
    authorize(token: string, channelId: string): Promise<{ userId: string; canControl: boolean }>;
    /**
     * Where live leases are kept (encrypted, 0600) so an access restart does not end every DJ
     * session. Defaults to ROOMS_MUSIC_LEASES_FILE or the /state volume; `null` keeps leases in
     * memory only.
     */
    leaseFile?: string | null;
  },
) {
  const displayName = z
    .string()
    .trim()
    .min(1)
    .max(40)
    .regex(/^[^\x00-\x1f\x7f]+$/)
    .parse(options.displayName ?? 'DJ');
  const leases = new Map<string, Lease>();
  const room = (id: string) => `stoat-channel-${id}`;
  const configured = !!options.url && !!options.secret && options.secret.length >= 32;
  const leaseFile = configured
    ? options.leaseFile === undefined
      ? defaultLeaseFile()
      : options.leaseFile
    : null;
  if (leaseFile) {
    try {
      for (const [id, lease] of openLeases(
        options.secret!,
        readFileSync(leaseFile, 'utf8'),
        Date.now(),
      ))
        leases.set(id, lease);
    } catch {
      // No file yet, another secret or damage: start empty, which is the old behavior.
    }
  }
  let saving: Promise<void> = Promise.resolve();
  const persist = () => {
    if (!leaseFile) return saving;
    // Serialized and best effort: a failed write only costs the restart survival.
    saving = saving.then(async () => {
      const temporary = `${leaseFile}.${process.pid}.tmp`;
      try {
        if (!leases.size) return void (await rm(leaseFile, { force: true }));
        await writeFile(temporary, sealLeases(options.secret!, leases), { mode: 0o600 });
        await chmod(temporary, 0o600);
        await rename(temporary, leaseFile);
      } catch {
        await rm(temporary, { force: true }).catch(() => {});
      }
    });
    return saving;
  };
  async function worker(channelId: string, body?: unknown) {
    if (!configured) throw new Error('MUSIC_NOT_CONFIGURED');
    const response = await fetch(`${options.url}/v1/rooms/${encodeURIComponent(channelId)}`, {
      method: body ? 'POST' : 'GET',
      headers: { Authorization: `Bearer ${options.secret}`, 'Content-Type': 'application/json' },
      body: body ? JSON.stringify(body) : undefined,
      redirect: 'error',
      signal: AbortSignal.timeout(body ? 150000 : 10000),
    });
    const result = await response.json();
    if (!response.ok) {
      const song = musicFailedSongSchema.safeParse(result?.song);
      throw Object.assign(
        new Error(
          typeof result?.error === 'string' && /^MUSIC_[A-Z_]+$/.test(result.error)
            ? result.error
            : 'MUSIC_SERVICE_UNAVAILABLE',
        ),
        song.success ? { song: song.data } : {},
      );
    }
    return musicSnapshotSchema.parse(result);
  }
  async function revoke(channelId: string) {
    leases.delete(channelId);
    void persist();
    await options.roomService
      .removeParticipant(room(channelId), musicIdentity(channelId))
      .catch(() => {});
  }
  async function validate(channelId: string, lease: Lease) {
    const access = await options.authorize(lease.token, channelId);
    if (access.userId !== lease.userId || !access.canControl)
      throw new Error('MUSIC_PERMISSION_DENIED');
    const humans = (await options.roomService.listParticipants(room(channelId))).filter(
      (p) => p.identity !== musicIdentity(channelId),
    );
    if (humans.length) delete lease.emptySince;
    else if (Date.now() - (lease.emptySince ??= Date.now()) > EMPTY_GRACE_MS)
      throw new Error('MUSIC_ROOM_EMPTY');
  }
  async function grant(channelId: string, lease: Lease) {
    await validate(channelId, lease);
    lease.expires = Date.now() + LEASE_TTL_MS;
    void persist();
    const access = new AccessToken(options.apiKey, options.apiSecret, {
      identity: musicIdentity(channelId),
      name: displayName,
      ttl: 300,
      metadata: JSON.stringify({ musicLeaseId: lease.id }),
    });
    access.addGrant({
      roomJoin: true,
      room: room(channelId),
      canSubscribe: false,
      canPublish: true,
      canPublishSources: [TrackSource.MICROPHONE],
      canPublishData: false,
      canUpdateOwnMetadata: false,
    });
    return { leaseId: lease.id, url: options.livekitUrl, token: await access.toJwt() };
  }
  server.post('/v1/music/internal/lease', async (request, reply) => {
    const received = request.headers.authorization?.replace(/^Bearer /, '') ?? '',
      secret = options.secret ?? '';
    if (
      !configured ||
      Buffer.byteLength(received) !== Buffer.byteLength(secret) ||
      !timingSafeEqual(Buffer.from(received), Buffer.from(secret))
    )
      return reply.code(401).send({ error: 'AUTH_REQUIRED' });
    const body = z
      .object({ channelId: channel, leaseId: z.string().uuid() })
      .strict()
      .parse(request.body);
    const lease = leases.get(body.channelId);
    if (!lease || lease.id !== body.leaseId || lease.expires < Date.now())
      return reply.code(403).send({ error: 'MUSIC_LEASE_EXPIRED' });
    try {
      return await grant(body.channelId, lease);
    } catch (error) {
      // A passing failure keeps the lease (it still expires on its own); the worker retries.
      if (!definitive(error)) return reply.code(503).send({ error: 'MUSIC_LEASE_UNAVAILABLE' });
      await revoke(body.channelId);
      return reply.code(403).send({ error: 'MUSIC_PERMISSION_DENIED' });
    }
  });
  const token = (header: string | undefined) => {
    const value = header?.replace(/^Bearer /, '');
    if (!value) throw new Error('AUTH_REQUIRED');
    return value;
  };
  const fail = (reply: { code(n: number): { send(v: unknown): unknown } }, error: unknown) => {
    const message = error instanceof Error ? error.message : '';
    return reply
      .code(
        message === 'AUTH_REQUIRED'
          ? 401
          : message === 'MUSIC_PERMISSION_DENIED' || message === 'MUSIC_JOIN_FIRST'
            ? 403
            : 503,
      )
      .send({
        error: /^(MUSIC_[A-Z_]+|AUTH_REQUIRED)$/.test(message)
          ? message
          : 'MUSIC_SERVICE_UNAVAILABLE',
        ...(musicFailedSongSchema.safeParse((error as { song?: unknown })?.song).success
          ? { song: musicFailedSongSchema.parse((error as { song: unknown }).song) }
          : {}),
      });
  };
  server.get('/v1/music/:channelId', async (request, reply) => {
    try {
      const id = channel.parse((request.params as { channelId: string }).channelId);
      await options.authorize(token(request.headers.authorization), id);
      return await worker(id);
    } catch (error) {
      return fail(reply, error);
    }
  });
  server.get('/v1/music/:channelId/history', async (request, reply) => {
    try {
      const id = channel.parse((request.params as { channelId: string }).channelId),
        credential = token(request.headers.authorization);
      const initial = await options.authorize(credential, id);
      if (!configured) throw new Error('MUSIC_NOT_CONFIGURED');
      const response = await fetch(`${options.url}/v1/rooms/${encodeURIComponent(id)}/history`, {
        headers: { Authorization: `Bearer ${options.secret}` },
        redirect: 'error',
        signal: AbortSignal.timeout(10000),
      });
      if (!response.ok) throw new Error('MUSIC_HISTORY_UNAVAILABLE');
      const value = musicHistorySchema.parse(await response.json());
      const fresh = await options.authorize(credential, id);
      if (initial.userId !== fresh.userId) throw new Error('MUSIC_PERMISSION_DENIED');
      return value;
    } catch (error) {
      return fail(reply, error);
    }
  });
  server.post(
    '/v1/music/:channelId/search',
    {
      config: {
        rateLimit: {
          max: 12,
          timeWindow: '1 minute',
          keyGenerator: (request) =>
            'music-search:' +
            createHash('sha256')
              .update(request.headers.authorization ?? request.ip)
              .digest('hex'),
        },
      },
    },
    async (request, reply) => {
      try {
        const id = channel.parse((request.params as { channelId: string }).channelId),
          body = z.object({ query: musicSearchQuerySchema }).strict().parse(request.body);
        const access = await options.authorize(token(request.headers.authorization), id);
        if (!access.canControl) throw new Error('MUSIC_PERMISSION_DENIED');
        if (!(await options.roomService.getParticipant(room(id), access.userId).catch(() => null)))
          throw new Error('MUSIC_JOIN_FIRST');
        if (!configured) throw new Error('MUSIC_NOT_CONFIGURED');
        const response = await fetch(`${options.url}/v1/search`, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${options.secret}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(body),
          redirect: 'error',
          signal: AbortSignal.timeout(50000),
        });
        const result = await response.json();
        if (!response.ok) throw new Error('MUSIC_SEARCH_UNAVAILABLE');
        const fresh = await options.authorize(token(request.headers.authorization), id);
        if (
          fresh.userId !== access.userId ||
          !fresh.canControl ||
          !(await options.roomService.getParticipant(room(id), access.userId).catch(() => null))
        )
          throw new Error('MUSIC_PERMISSION_DENIED');
        return musicSearchResultsSchema.parse(result);
      } catch (error) {
        return fail(reply, error);
      }
    },
  );
  /**
   * Sinema's YouTube search. Same public-metadata search as the DJ's, but for anyone who can
   * see and connect to the hall channel: finding a video needs no DJ control. Opening the pick
   * is still the cinema's own permission and queue rules.
   */
  server.post(
    '/v1/halls/:channelId/youtube-search',
    {
      config: {
        rateLimit: {
          max: 20,
          timeWindow: '1 minute',
          keyGenerator: (request) =>
            'hall-youtube-search:' +
            createHash('sha256')
              .update(request.headers.authorization ?? request.ip)
              .digest('hex'),
        },
      },
    },
    async (request, reply) => {
      try {
        const id = channel.parse((request.params as { channelId: string }).channelId),
          body = z.object({ query: musicSearchQuerySchema }).strict().parse(request.body);
        const credential = token(request.headers.authorization);
        const access = await options.authorize(credential, id);
        if (!configured) throw new Error('MUSIC_NOT_CONFIGURED');
        const response = await fetch(`${options.url}/v1/search`, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${options.secret}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(body),
          redirect: 'error',
          signal: AbortSignal.timeout(50000),
        });
        const result = await response.json().catch(() => null);
        if (!response.ok)
          throw new Error(
            result?.error === 'MUSIC_SEARCH_BUSY'
              ? 'MUSIC_SEARCH_BUSY'
              : 'MUSIC_SEARCH_UNAVAILABLE',
          );
        // The member may have lost access while yt-dlp ran.
        const fresh = await options.authorize(credential, id);
        if (fresh.userId !== access.userId) throw new Error('MUSIC_PERMISSION_DENIED');
        return musicSearchResultsSchema.parse(result);
      } catch (error) {
        return fail(reply, error);
      }
    },
  );
  server.post('/v1/music/:channelId', { bodyLimit: 65536 }, async (request, reply) => {
    let id: string | undefined;
    try {
      id = channel.parse((request.params as { channelId: string }).channelId);
      const command = musicCommandSchema.parse(request.body),
        credential = token(request.headers.authorization),
        access = await options.authorize(credential, id);
      if (!access.canControl) throw new Error('MUSIC_PERMISSION_DENIED');
      const member = await options.roomService
        .getParticipant(room(id), access.userId)
        .catch(() => null);
      if (!member) throw new Error('MUSIC_JOIN_FIRST');
      const lease = leases.get(id) ?? {
        id: randomUUID(),
        token: credential,
        userId: access.userId,
        expires: Date.now() + LEASE_TTL_MS,
      };
      lease.token = credential;
      lease.userId = access.userId;
      leases.set(id, lease);
      const media = await grant(id, lease);
      try {
        return await worker(id, { lease: media, command });
      } finally {
        if (command.type === 'stop') await revoke(id);
      }
    } catch (error) {
      return fail(reply, error);
    }
  });
  let sweeping = false;
  const timer = setInterval(() => {
    if (sweeping) return;
    sweeping = true;
    void (async () => {
      try {
        for (const [id, lease] of leases) {
          try {
            if (lease.expires < Date.now()) throw new Error('MUSIC_PERMISSION_DENIED');
            await validate(id, lease);
          } catch (error) {
            if (definitive(error)) await revoke(id);
          }
        }
      } finally {
        sweeping = false;
      }
    })();
  }, 10000);
  timer.unref();
  server.addHook('onClose', async () => {
    clearInterval(timer);
    // With persisted leases a restart keeps the DJ in the room: the worker renews against the
    // restarted service. Without them nobody could renew, so the bot leaves as before.
    if (leaseFile) await persist();
    else await Promise.all([...leases.keys()].map(revoke));
  });
  return {
    async webhook(channelId: string, identity: string, metadata: string) {
      if (identity !== musicIdentity(channelId)) return false;
      const lease = leases.get(channelId);
      let valid = false;
      try {
        valid =
          !!lease &&
          lease.expires > Date.now() &&
          JSON.parse(metadata || '{}').musicLeaseId === lease.id;
        if (valid) await validate(channelId, lease!);
      } catch {
        valid = false;
      }
      if (!valid) {
        await revoke(channelId);
        return true;
      }
      await options.roomService.updateParticipant(room(channelId), identity, {
        permission: {
          canSubscribe: false,
          canPublish: true,
          canPublishSources: [TrackSource.MICROPHONE],
          canPublishData: false,
        },
      });
      return true;
    },
  };
}
