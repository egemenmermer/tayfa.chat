import {
  activityOperationalReporter,
  activityBuildInfo,
  type ActivityOperationalEvent,
} from './operational-events';
import Fastify, { type FastifyRequest } from 'fastify';
import rateLimit from '@fastify/rate-limit';
import { z } from 'zod';
import {
  commandSchema,
  opaqueId,
  type ActivityResponse,
} from '../../../packages/activity-protocol/src/index';
import {
  ActivityError,
  applyCommand,
  emptyRoom,
  pruneDisconnected,
  response,
  type ActivityIdentity,
} from './engine';
import type { ActivityRepository, StoredRoom } from './repository';
import { heartbeatGame } from './games';
import { registerStudio, type StudioStore } from './studio';
import { StoatError } from '@rooms/stoat';
import { ingressLimit, TRUSTED_PROXIES } from '../shared/ingress';

export interface ActivityServerOptions {
  repository: ActivityRepository;
  onOperationalEvent?: (event: ActivityOperationalEvent) => void;
  /** Check current upstream membership and permissions on every request. Never cache bearer tokens here. */
  authorize?: (bearer: string, roomId: string) => Promise<ActivityIdentity>;
  clock?: () => number;
  sweepIntervalMs?: number;
  /** Collaborative Studio projects; the routes exist only when a store is given. */
  studio?: StudioStore;
  /** Byte cap of a project's persisted op log (default 4 MiB); tests lower it. */
  studioLogByteLimit?: number;
  /** Internal test/deployment tuning; never accepts values from a client. */
  rateLimits?: { ingressPerMinute: number; identityPerMinute: number; studioPerMinute?: number };
}
/** Poll and command responses carry only the newest archived tables, each with a short hand list. */
export const POLL_PREVIOUS_TABLES = 3;
export const POLL_PREVIOUS_HANDS = 20;
/** Bound `previousTables` in place; `full` (explicit `?previousTables=all`) keeps every archive. */
export function boundPreviousTables(res: ActivityResponse, full: boolean) {
  const view = res.room.game?.view;
  if (full || !view || !Array.isArray(view.previousTables)) return res;
  view.previousTables = view.previousTables.slice(-POLL_PREVIOUS_TABLES).map((table) => {
    const archive = table as { history?: unknown };
    return Array.isArray(archive.history)
      ? { ...archive, history: archive.history.slice(-POLL_PREVIOUS_HANDS) }
      : table;
  });
  return res;
}
export async function createActivityServer(options: ActivityServerOptions) {
  const operationalError = activityOperationalReporter(options.onOperationalEvent);
  const app = Fastify({ logger: false, trustProxy: TRUSTED_PROXIES, bodyLimit: 65536 });
  ingressLimit(app, { perMinute: 1200, error: 'RATE_LIMITED' });
  const limits = z
    .object({
      ingressPerMinute: z.number().int().min(1).max(10000),
      identityPerMinute: z.number().int().min(1).max(10000),
      studioPerMinute: z.number().int().min(1).max(10000).default(600),
    })
    .strict()
    .parse(options.rateLimits ?? { ingressPerMinute: 600, identityPerMinute: 120 });
  // An anonymous ingress cap per client address (only the reverse proxy's hop is trusted).
  // Never trust a forwarded identity or an unverified bearer as a key.
  await app.register(rateLimit, { max: limits.ingressPerMinute, timeWindow: '1 minute' });
  const identities = new WeakMap<FastifyRequest, ActivityIdentity>();
  const identityLimit = app.createRateLimit({
    max: limits.identityPerMinute,
    keyGenerator: (request) => {
      const identity = identities.get(request);
      if (!identity) throw new ActivityError(401, 'AUTH_REQUIRED');
      return `activity-user:${identity.userId}`;
    },
  });
  const now = options.clock ?? Date.now;
  const locks = new Map<string, Promise<unknown>>();
  const listeners = new Map<string, Set<() => void>>();
  const serialize = async <T>(id: string, task: () => Promise<T>): Promise<T> => {
    const work = (locks.get(id) ?? Promise.resolve()).catch(() => {}).then(task);
    locks.set(id, work);
    try {
      return await work;
    } finally {
      if (locks.get(id) === work) locks.delete(id);
    }
  };
  const notify = (id: string) => {
    for (const wake of listeners.get(id) ?? []) wake();
  };
  const identityOf = async (header: string | undefined, roomId: string) => {
    if (!header || !header.startsWith('Bearer ') || header.length > 8192)
      throw new ActivityError(401, 'AUTH_REQUIRED');
    if (!options.authorize) throw new ActivityError(503, 'AUTHORIZATION_NOT_CONFIGURED');
    const identity = z
      .object({
        userId: opaqueId.refine((id) => !['__proto__', 'constructor', 'prototype'].includes(id)),
        displayName: z.string().min(1).max(240),
        canControl: z.boolean(),
        canCreate: z.boolean(),
      })
      .strict()
      .parse(await options.authorize(header.slice(7), roomId));
    return identity;
  };
  const authorizeAndLimit = async (request: FastifyRequest, roomId: string) => {
    const identity = await identityOf(request.headers.authorization, roomId);
    identities.set(request, identity);
    const limit = await identityLimit(request);
    if (!limit.isAllowed && limit.isExceeded) throw new ActivityError(429, 'RATE_LIMITED');
    return identity;
  };
  app.setErrorHandler((error, _request, reply) => {
    if (error instanceof ActivityError) return reply.code(error.status).send({ error: error.code });
    if (error instanceof StoatError && [401, 403, 404, 429].includes(error.status)) {
      const code = (
        {
          401: 'SESSION_EXPIRED',
          403: 'ROOM_ACCESS_DENIED',
          404: 'ROOM_UNAVAILABLE',
          429: 'RATE_LIMITED',
        } as Record<number, string>
      )[error.status];
      return reply.code(error.status).send({ error: code });
    }
    if (error instanceof z.ZodError) return reply.code(400).send({ error: 'INVALID_COMMAND' });
    const status = (error as { statusCode?: number }).statusCode;
    if (status === 429) return reply.code(429).send({ error: 'RATE_LIMITED' });
    // Fastify's own client errors (body over the limit, malformed JSON) are not service failures.
    if (status === 413) return reply.code(413).send({ error: 'PAYLOAD_TOO_LARGE' });
    if (status === 400 && String((error as { code?: unknown }).code).startsWith('FST_'))
      return reply.code(400).send({ error: 'INVALID_COMMAND' });
    operationalError(error, 'request');
    // Upstream failures fail closed; do not leak token-bearing request details.
    return reply.code(503).send({ error: 'ACTIVITY_SERVICE_UNAVAILABLE' });
  });
  const roomParam = z.object({ roomId: opaqueId });
  // Registered after the error handler so Studio routes map errors the same way.
  if (options.studio) {
    // Editing sends many small batches and presence updates; it has its own per-user budget next to the room one.
    const studioLimit = app.createRateLimit({
      max: limits.studioPerMinute,
      keyGenerator: (request) => {
        const identity = identities.get(request);
        if (!identity) throw new ActivityError(401, 'AUTH_REQUIRED');
        return `studio-user:${identity.userId}`;
      },
    });
    registerStudio(app, {
      store: options.studio,
      logByteLimit: options.studioLogByteLimit,
      now,
      serialize,
      onStorageError: operationalError,
      authorize: async (request, roomId, counted = true) => {
        const identity = await identityOf(request.headers.authorization, roomId);
        if (!counted) return identity;
        identities.set(request, identity);
        const limit = await studioLimit(request);
        if (!limit.isAllowed && limit.isExceeded) throw new ActivityError(429, 'RATE_LIMITED');
        return identity;
      },
    });
  }
  app.get('/health', async (_request, reply) => {
    try {
      await options.repository.probe?.();
      return {
        service: 'rooms-activities',
        protocolVersion: 1,
        authorizationConfigured: !!options.authorize,
        persistence: options.repository.probe ? 'available' : 'not-probed',
        ready: !!options.authorize && !!options.repository.probe,
        ...activityBuildInfo,
      };
    } catch (error) {
      operationalError(error, 'health');
      return reply.code(503).send({
        service: 'rooms-activities',
        ready: false,
        persistence: 'unavailable',
        ...activityBuildInfo,
      });
    }
  });
  app.post('/v1/rooms/:roomId/activity/commands', async (request) => {
    const { roomId } = roomParam.parse(request.params);
    const identity = await authorizeAndLimit(request, roomId);
    const command = commandSchema.parse(request.body);
    return serialize(roomId, async () => {
      const room = (await options.repository.load(roomId)) ?? emptyRoom(roomId, now());
      // A rejected command never changes persisted state or a participant's lease.
      const changed = applyCommand(room, identity, command, now());
      if (changed) {
        await options.repository.save(room);
        notify(roomId);
      }
      return boundPreviousTables(
        response(room, command.expectedRevision, now(), identity.userId),
        false,
      );
    });
  });
  app.get('/v1/rooms/:roomId/activity', async (request) => {
    const { roomId } = roomParam.parse(request.params);
    const query = z
      .object({
        afterRevision: z.coerce.number().int().min(0).default(0),
        waitMs: z.coerce.number().int().min(0).max(25000).default(0),
        previousTables: z.enum(['all']).optional(),
      })
      .strict()
      .parse(request.query);
    let identity = await authorizeAndLimit(request, roomId);
    const read = () =>
      serialize(roomId, async () => {
        const room = (await options.repository.load(roomId)) ?? emptyRoom(roomId, now());
        const participant = room.snapshot.participants.find((p) => p.userId === identity.userId);
        if (participant) {
          participant.lastSeenAt = now();
          participant.canControl = identity.canControl;
          participant.canCreate = identity.canCreate;
          if (room.game) heartbeatGame(room.game, identity.userId);
          await options.repository.save(room);
        }
        return room;
      });
    let room: StoredRoom;
    // Subscribe BEFORE reading to avoid losing a command between read and listener installation.
    let release = () => {};
    const wake = new Promise<void>((resolve) => {
      release = resolve;
    });
    const bucket = listeners.get(roomId) ?? new Set<() => void>();
    bucket.add(release);
    listeners.set(roomId, bucket);
    const timer = setTimeout(release, query.waitMs);
    timer.unref();
    const aborted = () => release();
    request.raw.once('aborted', aborted);
    try {
      room = await read();
      if (query.waitMs && room.snapshot.revision === query.afterRevision) {
        await wake;
        identity = await identityOf(request.headers.authorization, roomId);
        room = await read();
      }
      return boundPreviousTables(
        response(room, query.afterRevision, now(), identity.userId),
        query.previousTables === 'all',
      );
    } finally {
      clearTimeout(timer);
      request.raw.off('aborted', aborted);
      bucket.delete(release);
      if (!bucket.size) listeners.delete(roomId);
    }
  });
  let sweeping = false;
  const sweep = setInterval(async () => {
    if (sweeping) return;
    sweeping = true;
    try {
      for (const stored of await options.repository.list())
        // One room that fails must not stop presence expiry and bot takeover for the others.
        await serialize(stored.snapshot.roomId, async () => {
          const room = await options.repository.load(stored.snapshot.roomId);
          if (room && pruneDisconnected(room, now())) {
            await options.repository.save(room);
            notify(room.snapshot.roomId);
          }
        }).catch((error: unknown) => operationalError(error, 'sweep'));
    } catch (error) {
      operationalError(error, 'sweep'); /* The next sweep retries without accepting stale leases. */
    } finally {
      sweeping = false;
    }
  }, options.sweepIntervalMs ?? 1000);
  sweep.unref();
  app.addHook('onClose', async () => {
    clearInterval(sweep);
    for (const id of listeners.keys()) notify(id);
  });
  return app;
}
