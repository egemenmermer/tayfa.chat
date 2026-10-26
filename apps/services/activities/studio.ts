import { randomUUID } from 'node:crypto';
import { mkdir, readdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { Pool } from 'pg';
import { z } from 'zod';
import { opaqueId } from '../../../packages/activity-protocol/src/index';
import {
  applyOps,
  createProject,
  MAX_PROJECTS_PER_ROOM,
  PRESENCE_TTL_MS,
  RETAINED_BATCHES,
  STUDIO_PROTOCOL_VERSION,
  studioBatchSchema,
  studioIdSchema,
} from '../../../packages/studio/src/index';
import { ActivityError, type ActivityIdentity } from './engine';
import { ActivityStorageError } from './storage-codec';
import {
  decodeStudioProject,
  STUDIO_STORAGE_VERSION,
  studioCreateRequestSchema,
  studioPresenceRequestSchema,
  studioSyncQuerySchema,
  type StoredStudioProject,
  type StudioLogEntry,
  type StudioPresence,
  type StudioPresenceState,
} from './studio-schemas';

/** Projects held in memory; idle, saved ones beyond this are dropped and reloaded on demand. */
export const STUDIO_LIVE_LIMIT = 64;
/** Edits reach the store at most this long after they were applied (and always on close). */
export const STUDIO_SAVE_DELAY_MS = 1000;
/** A failed save is retried after this delay instead of in a tight loop. */
export const STUDIO_SAVE_RETRY_MS = 5000;
/** Presence changes wake long polls at most this often per project; op batches wake them at once. */
export const STUDIO_PRESENCE_WAKE_MS = 1000;

export interface StudioStore {
  /** Called once per record that failed strict validation and was moved aside. */
  onQuarantine?: (error: ActivityStorageError) => void;
  probe?(): Promise<void>;
  /** Valid projects of the room; corrupt records are quarantined and left out. */
  list(roomId: string): Promise<StoredStudioProject[]>;
  /** The project, or null when it does not exist or its record was corrupt (and is now quarantined). */
  load(roomId: string, projectId: string): Promise<StoredStudioProject | null>;
  save(stored: StoredStudioProject): Promise<void>;
  remove(roomId: string, projectId: string): Promise<void>;
}

export class MemoryStudioStore implements StudioStore {
  private projects = new Map<string, StoredStudioProject>();
  async list(roomId: string) {
    return structuredClone([...this.projects.values()].filter((p) => p.roomId === roomId));
  }
  async load(roomId: string, projectId: string) {
    return structuredClone(this.projects.get(`${roomId}/${projectId}`) ?? null);
  }
  async save(stored: StoredStudioProject) {
    this.projects.set(`${stored.roomId}/${stored.project.id}`, structuredClone(stored));
  }
  async remove(roomId: string, projectId: string) {
    this.projects.delete(`${roomId}/${projectId}`);
  }
}

/**
 * One file per project at `<directory>/<roomId>/<projectId>.json`, 0600 and replaced atomically. Both ids are
 * validated (`[A-Za-z0-9_-]`), so they are safe path segments. A corrupt file is renamed to
 * `<projectId>.json.corrupt-<time>` and kept for inspection.
 */
export class FileStudioStore implements StudioStore {
  onQuarantine?: (error: ActivityStorageError) => void;
  constructor(private directory: string) {}
  private folder(roomId: string) {
    return join(this.directory, opaqueId.parse(roomId));
  }
  private file(roomId: string, projectId: string) {
    return join(this.folder(roomId), `${studioIdSchema.parse(projectId)}.json`);
  }
  async probe() {
    await mkdir(this.directory, { recursive: true, mode: 0o700 });
  }
  async list(roomId: string) {
    let names: string[];
    try {
      names = await readdir(this.folder(roomId));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
      throw error;
    }
    const projects: StoredStudioProject[] = [];
    for (const name of names) {
      const id = name.endsWith('.json') ? name.slice(0, -5) : '';
      if (!studioIdSchema.safeParse(id).success) continue;
      const stored = await this.load(roomId, id);
      if (stored) projects.push(stored);
    }
    return projects;
  }
  async load(roomId: string, projectId: string) {
    const file = this.file(roomId, projectId);
    let text: string;
    try {
      text = await readFile(file, 'utf8');
    } catch (error) {
      // Only a missing file is "no project"; other read errors fail the request instead of hiding data.
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
      throw error;
    }
    try {
      return decodeStudioProject(JSON.parse(text) as unknown, { roomId, projectId });
    } catch (error) {
      const failure =
        error instanceof ActivityStorageError ? error : new ActivityStorageError('invalid-state');
      await rename(file, `${file}.corrupt-${Date.now()}`);
      this.onQuarantine?.(failure);
      return null;
    }
  }
  async save(stored: StoredStudioProject) {
    const validated = decodeStudioProject(stored);
    await mkdir(this.folder(validated.roomId), { recursive: true, mode: 0o700 });
    const file = this.file(validated.roomId, validated.project.id);
    await writeFile(`${file}.tmp`, JSON.stringify(validated), { mode: 0o600 });
    await rename(`${file}.tmp`, file);
  }
  async remove(roomId: string, projectId: string) {
    await rm(this.file(roomId, projectId), { force: true });
  }
}

/** Not exercised by the local test suite (no Postgres on the development machine). */
export class PostgresStudioStore implements StudioStore {
  onQuarantine?: (error: ActivityStorageError) => void;
  constructor(private pool: Pool) {}
  async initialize() {
    await this.pool.query(
      'CREATE TABLE IF NOT EXISTS rooms_studio_projects (room_id text NOT NULL, project_id text NOT NULL, state jsonb NOT NULL, updated_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY (room_id, project_id))',
    );
    await this.pool.query(
      'CREATE TABLE IF NOT EXISTS rooms_studio_quarantine (room_id text NOT NULL, project_id text NOT NULL, state jsonb NOT NULL, quarantined_at timestamptz NOT NULL DEFAULT now())',
    );
  }
  async probe() {
    await this.pool.query('SELECT 1 FROM rooms_studio_projects LIMIT 0');
  }
  private async decode(roomId: string, projectId: string, state: unknown) {
    try {
      return decodeStudioProject(state, { roomId, projectId });
    } catch (error) {
      if (!(error instanceof ActivityStorageError)) throw error;
      await this.pool.query(
        'WITH moved AS (DELETE FROM rooms_studio_projects WHERE room_id=$1 AND project_id=$2 RETURNING room_id, project_id, state) INSERT INTO rooms_studio_quarantine(room_id, project_id, state) SELECT room_id, project_id, state FROM moved',
        [roomId, projectId],
      );
      this.onQuarantine?.(error);
      return null;
    }
  }
  async list(roomId: string) {
    const result = await this.pool.query<{ project_id: string; state: unknown }>(
      'SELECT project_id, state FROM rooms_studio_projects WHERE room_id=$1',
      [roomId],
    );
    const projects: StoredStudioProject[] = [];
    for (const row of result.rows) {
      const stored = await this.decode(roomId, row.project_id, row.state);
      if (stored) projects.push(stored);
    }
    return projects;
  }
  async load(roomId: string, projectId: string) {
    const result = await this.pool.query<{ state: unknown }>(
      'SELECT state FROM rooms_studio_projects WHERE room_id=$1 AND project_id=$2',
      [roomId, projectId],
    );
    return result.rows[0] ? this.decode(roomId, projectId, result.rows[0].state) : null;
  }
  async save(stored: StoredStudioProject) {
    const validated = decodeStudioProject(stored);
    await this.pool.query(
      'INSERT INTO rooms_studio_projects(room_id,project_id,state) VALUES($1,$2,$3) ON CONFLICT(room_id,project_id) DO UPDATE SET state=EXCLUDED.state, updated_at=now()',
      [validated.roomId, validated.project.id, validated],
    );
  }
  async remove(roomId: string, projectId: string) {
    await this.pool.query('DELETE FROM rooms_studio_projects WHERE room_id=$1 AND project_id=$2', [
      roomId,
      projectId,
    ]);
  }
}

export interface StudioRouteOptions {
  store: StudioStore;
  now: () => number;
  /**
   * Current membership for the room behind the project. `counted` applies the Studio rate budget; the re-check
   * after a long-poll wake is not counted again.
   */
  authorize: (
    request: FastifyRequest,
    roomId: string,
    counted?: boolean,
  ) => Promise<ActivityIdentity>;
  serialize: <T>(key: string, task: () => Promise<T>) => Promise<T>;
  onStorageError: (error: unknown, operation: 'studio-save' | 'studio-load') => void;
}

function summary(stored: StoredStudioProject) {
  const { project } = stored;
  return {
    id: project.id,
    name: project.name,
    createdBy: project.createdBy,
    createdAt: project.createdAt,
    updatedAt: stored.updatedAt,
    tempo: project.tempo,
    tracks: project.trackOrder.length,
  };
}
const response = (entry: StudioLogEntry) => ({
  protocolVersion: STUDIO_PROTOCOL_VERSION,
  seq: entry.seq,
  applied: entry.applied,
  skipped: entry.skipped,
});

/**
 * Collaborative Studio projects (Contract v1, coordinator/specs/studio.md). Separate from the room command
 * envelope: clients send op batches without an expected revision, the server sequences them, and pollers receive
 * the batches after `afterSeq` (or a snapshot when they are too far behind). The live project stays in memory
 * (one writer process) and is saved shortly after each change; presence is memory only.
 */
export function registerStudio(app: FastifyInstance, options: StudioRouteOptions) {
  const live = new Map<string, StoredStudioProject>();
  const dirty = new Set<string>();
  const presence = new Map<string, Map<string, StudioPresence>>();
  const presenceWakes = new Map<string, NodeJS.Timeout>();
  const listeners = new Map<string, Set<() => void>>();
  let saveTimer: NodeJS.Timeout | null = null;
  let flushing: Promise<void> = Promise.resolve();
  let closed = false;
  options.store.onQuarantine ??= (error) => options.onStorageError(error, 'studio-load');

  const keyOf = (roomId: string, projectId: string) => `${roomId}/${projectId}`;
  const notify = (key: string) => {
    for (const wake of listeners.get(key) ?? []) wake();
  };
  const notifyPresence = (key: string) => {
    if (presenceWakes.has(key)) return;
    const timer = setTimeout(() => {
      presenceWakes.delete(key);
      notify(key);
    }, STUDIO_PRESENCE_WAKE_MS);
    timer.unref();
    presenceWakes.set(key, timer);
  };
  const saveDirty = async () => {
    for (const key of [...dirty]) {
      dirty.delete(key);
      // Read the live copy inside the lock: a project deleted meanwhile must not be written back.
      await options
        .serialize(`studio:${key}`, async () => {
          const stored = live.get(key);
          if (stored) await options.store.save(stored);
        })
        .catch((error: unknown) => {
          dirty.add(key);
          options.onStorageError(error, 'studio-save');
        });
    }
    if (dirty.size && !saveTimer && !closed)
      saveTimer = setTimeout(() => void flush(), STUDIO_SAVE_RETRY_MS);
  };
  // Flushes run one after another, so close waits for a save that a timer already started.
  const flush = () => {
    saveTimer = null;
    flushing = flushing.then(saveDirty);
    return flushing;
  };
  const scheduleSave = (key: string) => {
    dirty.add(key);
    if (!closed) saveTimer ??= setTimeout(() => void flush(), STUDIO_SAVE_DELAY_MS);
  };
  const evictIdle = () => {
    // Map order is load order, so the oldest idle projects go first.
    for (const key of live.keys()) {
      if (live.size <= STUDIO_LIVE_LIMIT) return;
      if (!dirty.has(key) && !listeners.has(key)) live.delete(key);
    }
  };
  const open = async (roomId: string, projectId: string) => {
    const key = keyOf(roomId, projectId);
    let stored = live.get(key);
    if (!stored) {
      stored = (await options.store.load(roomId, projectId)) ?? undefined;
      if (stored) {
        live.set(key, stored);
        evictIdle();
      }
    }
    if (!stored) throw new ActivityError(404, 'STUDIO_PROJECT_NOT_FOUND');
    return stored;
  };
  const presenceOf = (key: string): StudioPresence[] => {
    const people = presence.get(key);
    if (!people) return [];
    const cutoff = options.now() - PRESENCE_TTL_MS;
    for (const [id, entry] of people) if (entry.lastSeenAt < cutoff) people.delete(id);
    if (!people.size) presence.delete(key);
    return [...people.values()].map((entry) => structuredClone(entry));
  };
  /** Marks the member as present; `state` replaces what they share. Wakes pollers when that changed. */
  const touch = (key: string, identity: ActivityIdentity, state?: StudioPresenceState) => {
    presenceOf(key);
    const people = presence.get(key) ?? new Map<string, StudioPresence>();
    presence.set(key, people);
    const previous = people.get(identity.userId);
    const { userId, displayName } = identity;
    const shared = state ?? (previous ? stripMeta(previous) : {});
    people.set(userId, { ...shared, userId, displayName, lastSeenAt: options.now() });
    if (!previous || (state && JSON.stringify(stripMeta(previous)) !== JSON.stringify(state)))
      notifyPresence(key);
  };
  /** Snapshot when the client is new (0), ahead of the server, or behind the retained log. */
  const needsSnapshot = (stored: StoredStudioProject, afterSeq: number) => {
    const first = stored.log[0]?.seq ?? stored.seq + 1;
    return afterSeq === 0 || afterSeq > stored.seq || afterSeq < first - 1;
  };
  const sync = (stored: StoredStudioProject, afterSeq: number, identity: ActivityIdentity) => {
    const key = keyOf(stored.roomId, stored.project.id);
    const base = {
      protocolVersion: STUDIO_PROTOCOL_VERSION,
      serverTimeMs: options.now(),
      seq: stored.seq,
      presence: presenceOf(key),
      access: {
        canEdit: identity.canControl,
        canDelete: identity.canCreate || stored.project.createdBy === identity.userId,
      },
    };
    // Stored documents are never mutated (applyOps returns a new one), so they are sent as they are.
    if (needsSnapshot(stored, afterSeq)) return { ...base, snapshot: stored.project };
    return {
      ...base,
      batches: stored.log
        .filter((entry) => entry.seq > afterSeq)
        .map(({ seq, actorId, batchId, ops }) => ({ seq, actorId, batchId, ops })),
    };
  };

  const roomParams = z.object({ roomId: opaqueId }).strict();
  const projectParams = z.object({ roomId: opaqueId, projectId: studioIdSchema }).strict();

  app.get('/v1/rooms/:roomId/studio/projects', async (request) => {
    const { roomId } = roomParams.parse(request.params);
    const identity = await options.authorize(request, roomId);
    const stored = await options.store.list(roomId);
    // The live copy is newer than the store until the next save.
    const projects = stored
      .map((p) => live.get(keyOf(roomId, p.project.id)) ?? p)
      .map(summary)
      .sort((a, b) => b.updatedAt - a.updatedAt);
    return {
      protocolVersion: STUDIO_PROTOCOL_VERSION,
      projects,
      access: { canCreate: identity.canCreate },
    };
  });

  app.post('/v1/rooms/:roomId/studio/projects', async (request) => {
    const { roomId } = roomParams.parse(request.params);
    const identity = await options.authorize(request, roomId);
    if (!identity.canCreate) throw new ActivityError(403, 'STUDIO_CREATE_DENIED');
    const body = studioCreateRequestSchema.parse(request.body);
    return options.serialize(`studio-room:${roomId}`, async () => {
      if ((await options.store.list(roomId)).length >= MAX_PROJECTS_PER_ROOM)
        throw new ActivityError(409, 'STUDIO_ROOM_FULL');
      const now = options.now();
      const project = createProject({
        id: randomUUID(),
        roomId,
        name: body.name,
        createdBy: identity.userId,
        createdAt: now,
        tempo: body.tempo,
        template: body.template,
      });
      const stored: StoredStudioProject = {
        version: STUDIO_STORAGE_VERSION,
        roomId,
        updatedAt: now,
        seq: 0,
        project,
        log: [],
      };
      // Saved at once so the room list and the project limit see it.
      await options.store.save(stored);
      live.set(keyOf(roomId, project.id), stored);
      evictIdle();
      return { protocolVersion: STUDIO_PROTOCOL_VERSION, project: summary(stored) };
    });
  });

  app.delete('/v1/rooms/:roomId/studio/projects/:projectId', async (request) => {
    const { roomId, projectId } = projectParams.parse(request.params);
    const identity = await options.authorize(request, roomId);
    const key = keyOf(roomId, projectId);
    return options.serialize(`studio:${key}`, async () => {
      const stored = await open(roomId, projectId);
      if (!identity.canCreate && stored.project.createdBy !== identity.userId)
        throw new ActivityError(403, 'STUDIO_DELETE_DENIED');
      await options.store.remove(roomId, projectId);
      live.delete(key);
      dirty.delete(key);
      presence.delete(key);
      // Waiting pollers re-open the project and receive 404.
      notify(key);
      return { protocolVersion: STUDIO_PROTOCOL_VERSION, removed: projectId };
    });
  });

  app.get('/v1/rooms/:roomId/studio/projects/:projectId', async (request) => {
    const { roomId, projectId } = projectParams.parse(request.params);
    const query = studioSyncQuerySchema.parse(request.query);
    let identity = await options.authorize(request, roomId);
    const key = keyOf(roomId, projectId);
    const read = () => options.serialize(`studio:${key}`, () => open(roomId, projectId));
    // Subscribe BEFORE reading so a batch between the read and the wait still wakes this poll.
    let release = () => {};
    const wake = new Promise<void>((resolve) => {
      release = resolve;
    });
    const bucket = listeners.get(key) ?? new Set<() => void>();
    bucket.add(release);
    listeners.set(key, bucket);
    const timer = setTimeout(release, query.waitMs);
    timer.unref();
    const aborted = () => release();
    request.raw.once('aborted', aborted);
    try {
      let stored = await read();
      touch(key, identity);
      // Wait only while nothing is newer than `afterSeq`. A client at 0 cannot be told apart from a new one,
      // so the first sync of a session is sent with `waitMs=0` to get the snapshot at once.
      if (query.waitMs && !closed && stored.seq === query.afterSeq) {
        await wake;
        // Membership may have changed (or the project been deleted) while this request waited.
        identity = await options.authorize(request, roomId, false);
        stored = await read();
        touch(key, identity);
      }
      return sync(stored, query.afterSeq, identity);
    } finally {
      clearTimeout(timer);
      request.raw.off('aborted', aborted);
      bucket.delete(release);
      if (!bucket.size) listeners.delete(key);
    }
  });

  app.post('/v1/rooms/:roomId/studio/projects/:projectId/ops', async (request) => {
    const { roomId, projectId } = projectParams.parse(request.params);
    const identity = await options.authorize(request, roomId);
    if (!identity.canControl) throw new ActivityError(403, 'STUDIO_EDIT_DENIED');
    const batch = studioBatchSchema.parse(request.body);
    const key = keyOf(roomId, projectId);
    return options.serialize(`studio:${key}`, async () => {
      const stored = await open(roomId, projectId);
      // Idempotent per (actor, batchId) within the retained log.
      const previous = stored.log.find(
        (entry) => entry.actorId === identity.userId && entry.batchId === batch.batchId,
      );
      if (previous) {
        // Both sides went through the same schema, so equal batches serialize identically.
        if (JSON.stringify(previous.ops) !== JSON.stringify(batch.ops))
          throw new ActivityError(409, 'STUDIO_BATCH_CONFLICT');
        return response(previous);
      }
      const result = applyOps(stored.project, batch.ops);
      // Every batch is logged, even when all its ops were skipped: clients drop a pending batch once they see it.
      const entry: StudioLogEntry = {
        seq: stored.seq + 1,
        actorId: identity.userId,
        batchId: batch.batchId,
        ops: batch.ops,
        applied: result.applied,
        skipped: result.skipped,
      };
      const next: StoredStudioProject = {
        ...stored,
        project: result.doc,
        seq: entry.seq,
        updatedAt: options.now(),
        // Compaction: the document is the snapshot; only the newest batches are kept for catch-up.
        log: [...stored.log, entry].slice(-RETAINED_BATCHES),
      };
      live.set(key, next);
      scheduleSave(key);
      touch(key, identity);
      notify(key);
      return response(entry);
    });
  });

  app.post('/v1/rooms/:roomId/studio/projects/:projectId/presence', async (request) => {
    const { roomId, projectId } = projectParams.parse(request.params);
    const identity = await options.authorize(request, roomId);
    const state = studioPresenceRequestSchema.parse(request.body);
    const key = keyOf(roomId, projectId);
    await options.serialize(`studio:${key}`, () => open(roomId, projectId));
    touch(key, identity, state);
    return { protocolVersion: STUDIO_PROTOCOL_VERSION, presence: presenceOf(key) };
  });

  app.addHook('onClose', async () => {
    closed = true;
    if (saveTimer) clearTimeout(saveTimer);
    for (const timer of presenceWakes.values()) clearTimeout(timer);
    presenceWakes.clear();
    for (const key of listeners.keys()) notify(key);
    await flush();
  });
}

function stripMeta(entry: StudioPresence): StudioPresenceState {
  const { playheadBeat, selection, view } = entry;
  return {
    ...(playheadBeat === undefined ? {} : { playheadBeat }),
    ...(selection === undefined ? {} : { selection }),
    ...(view === undefined ? {} : { view }),
  };
}
