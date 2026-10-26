import { z } from 'zod';
import { opaqueId } from '@rooms/activity-protocol';
import { StoatError } from '@rooms/stoat';
import {
  MAX_BATCH_OPS,
  MAX_PROJECTS_PER_ROOM,
  MAX_SYNC_WAIT_MS,
  STUDIO_PROTOCOL_VERSION,
  studioBatchSchema,
  studioIdSchema,
  studioOpSchema,
  studioPresenceEntrySchema,
  studioProjectSchema,
  studioProjectSummarySchema,
  studioSkipSchema,
} from '@rooms/studio';
import {
  studioCreateInputSchema,
  studioPresenceStateSchema,
  type StudioBridge,
} from '../../../packages/shared-contracts/src/studio';

// Studio Contract v1 over HTTP to the activities service. The renderer never sees the bearer: these calls run in
// the main process with the signed-in session, validate every input before it leaves and every answer before the
// renderer receives it.

export interface StudioServiceSession {
  origin: string;
  token: string;
  /** Aborted when the account changes. */
  signal: AbortSignal;
  /** Throws once the session that issued the request is no longer the current one. */
  assertSession: () => void;
}

const PUBLIC_CODE = /^[A-Z_]{1,64}$/;
const REQUEST_TIMEOUT_MS = 30_000;
/** Grace on top of the server's long-poll wait before the client gives up on the answer. */
const POLL_GRACE_MS = 10_000;

const version = z.literal(STUDIO_PROTOCOL_VERSION);
const seqSchema = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER);
const timeSchema = z.number().int().min(0);
const summarySchema = studioProjectSummarySchema;
const listSchema = z.object({
  protocolVersion: version,
  projects: z.array(summarySchema).max(MAX_PROJECTS_PER_ROOM * 2),
  access: z.object({ canCreate: z.boolean() }),
});
const presenceSchema = studioPresenceEntrySchema.extend({
  userId: z.string().min(1).max(128),
  displayName: z.string().max(256),
});
const syncBase = {
  protocolVersion: version,
  serverTimeMs: timeSchema,
  seq: seqSchema,
  presence: z.array(presenceSchema).max(256),
  access: z.object({ canEdit: z.boolean(), canDelete: z.boolean() }),
};
const syncSchema = z.union([
  z.object({ ...syncBase, snapshot: studioProjectSchema }),
  z.object({
    ...syncBase,
    batches: z.array(
      z.object({
        seq: z.number().int().min(1).max(Number.MAX_SAFE_INTEGER),
        actorId: z.string().min(1).max(128),
        batchId: z.string().uuid(),
        ops: z.array(studioOpSchema).min(1).max(MAX_BATCH_OPS),
      }),
    ),
  }),
]);
const skipSchema = studioSkipSchema;
const opsSchema = z.object({
  protocolVersion: version,
  seq: z.number().int().min(1),
  applied: z.array(z.number().int().min(0)).max(MAX_BATCH_OPS),
  skipped: z.array(skipSchema).max(MAX_BATCH_OPS),
});
const createSchema = z.object({ protocolVersion: version, project: summarySchema });
const removeSchema = z.object({ protocolVersion: version, removed: studioIdSchema });
const presenceReplySchema = z.object({
  protocolVersion: version,
  presence: z.array(presenceSchema).max(256),
});
const afterSeqSchema = seqSchema;
const waitSchema = z.number().int().min(0).max(MAX_SYNC_WAIT_MS);

/** An error the renderer can classify: Electron passes only `message` through IPC, so it carries the code. */
function failure(status: number, code: string): StoatError {
  const error = new StoatError(status, code);
  error.message = code;
  return error;
}

/** Code for a response without a readable `{error}` body (proxy pages, a service that is not deployed). */
function fallbackCode(status: number): string {
  if (status >= 500) return 'ACTIVITY_SERVICE_UNAVAILABLE';
  if (status === 413) return 'PAYLOAD_TOO_LARGE';
  if (status === 429) return 'RATE_LIMITED';
  if (status === 401) return 'SESSION_EXPIRED';
  // The service answers every known route with JSON; a bare 404 means Studio is not on this server yet.
  if (status === 404) return 'STUDIO_UNAVAILABLE';
  return 'ROOM_ACCESS_DENIED';
}

export function createStudioHttp(
  session: () => StudioServiceSession,
  fetcher: typeof fetch = fetch,
) {
  /** Every request in flight, so a closed window can end them. */
  const inflight = new Set<AbortController>();
  /** The running long poll per project: a newer poll from the renderer replaces it. */
  const polls = new Map<string, AbortController>();

  async function send<T>(
    path: string,
    schema: z.ZodType<T>,
    init: { method?: string; body?: unknown; timeoutMs?: number; poll?: string } = {},
  ): Promise<T> {
    const current = session();
    current.assertSession();
    const controller = new AbortController();
    if (init.poll) {
      polls.get(init.poll)?.abort();
      polls.set(init.poll, controller);
    }
    inflight.add(controller);
    const signal = AbortSignal.any([
      controller.signal,
      current.signal,
      AbortSignal.timeout(init.timeoutMs ?? REQUEST_TIMEOUT_MS),
    ]);
    try {
      let response: Response;
      try {
        response = await fetcher(`${current.origin}/rooms-activities/v1/rooms/${path}`, {
          method: init.method ?? 'GET',
          headers: {
            Authorization: `Bearer ${current.token}`,
            ...(init.body === undefined ? {} : { 'Content-Type': 'application/json' }),
          },
          body: init.body === undefined ? undefined : JSON.stringify(init.body),
          redirect: 'error',
          signal,
        });
      } catch {
        current.assertSession();
        if (controller.signal.aborted) throw failure(499, 'REQUEST_CANCELLED');
        throw failure(503, 'ACTIVITY_SERVICE_UNAVAILABLE');
      }
      const value: unknown = await response.json().catch(() => null);
      current.assertSession();
      if (!response.ok) {
        const code = (value as { error?: unknown } | null)?.error;
        throw failure(
          response.status,
          typeof code === 'string' && PUBLIC_CODE.test(code) ? code : fallbackCode(response.status),
        );
      }
      const parsed = schema.safeParse(value);
      if (!parsed.success) throw failure(502, 'INVALID_ACTIVITY_RESPONSE');
      return parsed.data;
    } finally {
      inflight.delete(controller);
      if (init.poll && polls.get(init.poll) === controller) polls.delete(init.poll);
    }
  }
  async function call<T>(
    path: string,
    schema: z.ZodType<T>,
    init: { method?: string; body?: unknown; timeoutMs?: number; poll?: string } = {},
  ): Promise<T> {
    try {
      return await send(path, schema, init);
    } catch (error) {
      // Session checks throw a StoatError whose message is prose; only the code survives IPC usefully.
      if (
        error instanceof StoatError &&
        error.message !== error.code &&
        PUBLIC_CODE.test(error.code)
      )
        throw failure(error.status, error.code);
      throw error;
    }
  }

  /** Input from the renderer is checked before anything is sent; a bad value is a public code, not zod text. */
  const input = <T>(schema: z.ZodType<T>, value: unknown): T => {
    const parsed = schema.safeParse(value);
    if (!parsed.success) throw failure(400, 'STUDIO_INVALID_INPUT');
    return parsed.data;
  };
  const room = (roomId: unknown) => encodeURIComponent(input(opaqueId, roomId));
  const project = (roomId: unknown, projectId: unknown) =>
    `${room(roomId)}/studio/projects/${encodeURIComponent(input(studioIdSchema, projectId))}`;

  const bridge: StudioBridge = {
    list: async (roomId) => call(`${room(roomId)}/studio/projects`, listSchema),
    create: async (roomId, value) =>
      call(`${room(roomId)}/studio/projects`, createSchema, {
        method: 'POST',
        body: {
          protocolVersion: STUDIO_PROTOCOL_VERSION,
          ...input(studioCreateInputSchema, value),
        },
      }),
    remove: async (roomId, projectId) =>
      call(project(roomId, projectId), removeSchema, { method: 'DELETE' }),
    sync: async (roomId, projectId, afterSeq, waitMs) => {
      const path = project(roomId, projectId);
      const after = input(afterSeqSchema, afterSeq);
      const wait = input(waitSchema, waitMs);
      return call(`${path}?afterSeq=${after}&waitMs=${wait}`, syncSchema, {
        timeoutMs: wait + POLL_GRACE_MS,
        poll: path,
      });
    },
    ops: async (roomId, projectId, batch) => {
      const path = `${project(roomId, projectId)}/ops`;
      const body = input(studioBatchSchema, {
        protocolVersion: STUDIO_PROTOCOL_VERSION,
        batchId: (batch as { batchId?: unknown } | null)?.batchId,
        ops: (batch as { ops?: unknown } | null)?.ops,
      });
      return call(path, opsSchema, { method: 'POST', body });
    },
    presence: async (roomId, projectId, state) => {
      const path = `${project(roomId, projectId)}/presence`;
      return call(path, presenceReplySchema, {
        method: 'POST',
        body: input(studioPresenceStateSchema, state),
      });
    },
  };
  return {
    bridge,
    /** Ends every request in flight (the window closed). */
    abortAll() {
      for (const controller of inflight) controller.abort();
      inflight.clear();
      polls.clear();
    },
  };
}
