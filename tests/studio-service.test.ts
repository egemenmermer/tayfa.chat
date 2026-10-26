import { randomUUID } from 'node:crypto';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ActivityError } from '../apps/services/activities/engine';
import { MemoryActivityRepository } from '../apps/services/activities/repository';
import { createActivityServer } from '../apps/services/activities/server';
import { FileStudioStore, STUDIO_LOG_BYTE_LIMIT } from '../apps/services/activities/studio';
import { decodeStudioProject } from '../apps/services/activities/studio-schemas';
import {
  defaultTrack,
  studioCreateResponseSchema,
  studioDeleteResponseSchema,
  studioListResponseSchema,
  studioOpsReplySchema,
  studioPresenceReplySchema,
  studioSyncResponseSchema,
  type StudioOp,
} from '../packages/studio/src/index';

// Counts strict decodes of stored records; the real function still runs.
vi.mock('../apps/services/activities/studio-schemas', async (importOriginal) => {
  const original =
    await importOriginal<typeof import('../apps/services/activities/studio-schemas')>();
  return { ...original, decodeStudioProject: vi.fn(original.decodeStudioProject) };
});

const authorize = async (token: string, roomId: string) => {
  if (roomId !== 'room-1') throw new ActivityError(403, 'ROOM_ACCESS_DENIED');
  return { userId: token, displayName: token.toUpperCase(), canControl: true, canCreate: true };
};

const directories: string[] = [];
const apps: { close(): Promise<unknown> }[] = [];
afterEach(async () => {
  for (const app of apps.splice(0)) await app.close();
  for (const directory of directories.splice(0))
    await rm(directory, { recursive: true, force: true });
});

async function start(directory: string, studioLogByteLimit?: number) {
  const app = await createActivityServer({
    repository: new MemoryActivityRepository(),
    studio: new FileStudioStore(directory),
    studioLogByteLimit,
    authorize,
    sweepIntervalMs: 60000,
    rateLimits: { ingressPerMinute: 10000, identityPerMinute: 10000, studioPerMinute: 10000 },
  });
  await app.listen({ host: '127.0.0.1', port: 0 });
  apps.push(app);
  const address = app.server.address();
  const base = `http://127.0.0.1:${typeof address === 'object' && address ? address.port : 0}`;
  const call = async (method: string, path: string, body?: unknown) => {
    const response = await fetch(base + path, {
      method,
      headers: {
        authorization: 'Bearer alice',
        ...(body === undefined ? {} : { 'content-type': 'application/json' }),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    return { status: response.status, body: (await response.json()) as Record<string, unknown> };
  };
  const close = async () => {
    apps.splice(apps.indexOf(app), 1);
    await app.close();
  };
  return { call, close };
}
async function temporary() {
  const directory = await mkdtemp(join(tmpdir(), 'rooms-studio-service-'));
  directories.push(directory);
  return directory;
}

const projects = '/v1/rooms/room-1/studio/projects';
type Call = Awaited<ReturnType<typeof start>>['call'];
const batch = (ops: StudioOp[], batchId: string = randomUUID()) => ({
  protocolVersion: 1,
  batchId,
  ops,
});
async function create(call: Call, name: string) {
  const created = await call('POST', projects, { protocolVersion: 1, name });
  expect(created.status).toBe(200);
  expect(studioCreateResponseSchema.safeParse(created.body).success).toBe(true);
  return (created.body.project as { id: string }).id;
}
const names = async (call: Call) =>
  ((await call('GET', projects)).body.projects as { name: string }[]).map((p) => p.name).sort();

describe('Studio summary index', () => {
  it('lists from memory: create, rename and delete show up without decoding any record again', async () => {
    const directory = await temporary();
    let server = await start(directory);
    const first = await create(server.call, 'Bir');
    await create(server.call, 'Iki');
    await server.close();

    server = await start(directory);
    const decode = vi.mocked(decodeStudioProject);
    decode.mockClear();
    // The first list of a room builds the index: one decode per stored project, once.
    expect(await names(server.call)).toEqual(['Bir', 'Iki']);
    expect(decode).toHaveBeenCalledTimes(2);
    expect(await names(server.call)).toEqual(['Bir', 'Iki']);
    decode.mockClear();

    const third = await create(server.call, 'Uc');
    expect(await names(server.call)).toEqual(['Bir', 'Iki', 'Uc']);
    // Rename and add a track on the project created in this process, then on a reloaded one.
    const renamed = await server.call(
      'POST',
      `${projects}/${third}/ops`,
      batch([
        { op: 'project.set', field: 'name', value: 'Ucuncu' },
        { op: 'track.create', track: defaultTrack(randomUUID(), 'drums') },
      ]),
    );
    expect(renamed.status).toBe(200);
    const list = (await server.call('GET', projects)).body.projects as {
      id: string;
      name: string;
      tracks: number;
    }[];
    expect(list.find((p) => p.id === third)).toMatchObject({ name: 'Ucuncu', tracks: 1 });
    // The newest edit is listed first.
    expect(list[0].id).toBe(third);

    expect((await server.call('DELETE', `${projects}/${third}`)).status).toBe(200);
    expect(await names(server.call)).toEqual(['Bir', 'Iki']);
    // Deleting a project that was only on disk loads that one record (the single decode), nothing else.
    decode.mockClear();
    expect((await server.call('DELETE', `${projects}/${first}`)).status).toBe(200);
    expect(await names(server.call)).toEqual(['Iki']);
    expect(decode).toHaveBeenCalledTimes(1);
  });

  it('builds the index once when lists race', async () => {
    const directory = await temporary();
    let server = await start(directory);
    for (let i = 0; i < 3; i++) await create(server.call, `P${i}`);
    await server.close();
    server = await start(directory);
    const decode = vi.mocked(decodeStudioProject);
    decode.mockClear();
    const results = await Promise.all([1, 2, 3, 4].map(() => names(server.call)));
    for (const result of results) expect(result).toEqual(['P0', 'P1', 'P2']);
    expect(decode).toHaveBeenCalledTimes(3);
  });
});

describe('Studio persisted log byte cap', () => {
  const trackId = randomUUID();
  /** About 6 KB of ops per batch. */
  const bigBatch = (color: number, batchId?: string) =>
    batch(
      Array.from({ length: 90 }, (_, i) => ({
        op: 'track.set',
        id: trackId,
        field: 'color',
        value: (color + i) % 12,
      })) as StudioOp[],
      batchId,
    );

  it('keeps the default cap at 4 MiB', () => {
    expect(STUDIO_LOG_BYTE_LIMIT).toBe(4 * 1024 * 1024);
  });

  it('drops old batches beyond the cap, sends a snapshot to clients behind and still answers retries', async () => {
    const directory = await temporary();
    const limit = 20 * 1024;
    let server = await start(directory, limit);
    const projectId = await create(server.call, 'Büyük');
    const path = `${projects}/${projectId}`;
    await server.call(
      'POST',
      `${path}/ops`,
      batch([{ op: 'track.create', track: { ...defaultTrack(trackId, 'drums') } }]),
    );
    const oldest = randomUUID();
    const oldestBatch = bigBatch(0, oldest);
    const reply = await server.call('POST', `${path}/ops`, oldestBatch);
    expect(reply.body).toMatchObject({ seq: 2 });
    for (let i = 1; i <= 7; i++)
      expect((await server.call('POST', `${path}/ops`, bigBatch(i))).status).toBe(200);
    const seq = 9;

    // The newest batch is still replayable, a client at seq 1 is behind the retained log and gets the snapshot.
    const near = await server.call('GET', `${path}?afterSeq=${seq - 1}`);
    expect((near.body.batches as { seq: number }[]).map((b) => b.seq)).toEqual([seq]);
    const far = await server.call('GET', `${path}?afterSeq=1`);
    expect(far.body.batches).toBeUndefined();
    expect(far.body.snapshot).toBeDefined();
    expect(studioSyncResponseSchema.safeParse(far.body).success).toBe(true);

    // A retry of a batch whose log entry is gone gets the original answer; other ops under its id conflict.
    const retry = await server.call('POST', `${path}/ops`, oldestBatch);
    expect(retry.body).toEqual(reply.body);
    const conflict = await server.call('POST', `${path}/ops`, bigBatch(5, oldest));
    expect(conflict.status).toBe(409);
    await server.close();

    // On disk: log within the cap and contiguous, every receipt kept, and the strict loader accepts the record.
    const text = await readFile(join(directory, 'room-1', `${projectId}.json`), 'utf8');
    const stored = JSON.parse(text) as {
      seq: number;
      log: { seq: number }[];
      receipts: { seq: number }[];
    };
    expect(stored.seq).toBe(seq);
    expect(stored.log.length).toBeGreaterThan(0);
    expect(stored.log.length).toBeLessThan(seq);
    expect(stored.log.at(-1)?.seq).toBe(seq);
    expect(
      stored.log.reduce((sum, e) => sum + Buffer.byteLength(JSON.stringify(e)), 0),
    ).toBeLessThanOrEqual(limit);
    expect(stored.receipts.map((r) => r.seq)).toEqual(Array.from({ length: seq }, (_, i) => i + 1));
    expect(() =>
      decodeStudioProject(JSON.parse(text), { roomId: 'room-1', projectId }),
    ).not.toThrow();

    // After a restart the retry is still answered, and nothing was applied twice.
    server = await start(directory, limit);
    expect((await server.call('POST', `${path}/ops`, oldestBatch)).body).toEqual(reply.body);
    expect((await server.call('GET', `${path}?afterSeq=0`)).body.seq).toBe(seq);
  });
});

describe('Studio wire schemas', () => {
  it('describe every response the service sends', async () => {
    const server = await start(await temporary());
    const id = await create(server.call, 'Sözleşme');
    const path = `${projects}/${id}`;
    expect(
      studioListResponseSchema.safeParse((await server.call('GET', projects)).body).success,
    ).toBe(true);
    const snapshot = await server.call('GET', `${path}?afterSeq=0`);
    expect(studioSyncResponseSchema.safeParse(snapshot.body).success).toBe(true);
    expect(snapshot.body.snapshot).toBeDefined();
    const ops = await server.call(
      'POST',
      `${path}/ops`,
      batch([{ op: 'track.create', track: defaultTrack(randomUUID(), 'drums') }]),
    );
    expect(studioOpsReplySchema.safeParse(ops.body).success).toBe(true);
    const tail = await server.call('GET', `${path}?afterSeq=1`);
    expect(tail.body.batches).toHaveLength(0);
    expect(studioSyncResponseSchema.safeParse(tail.body).success).toBe(true);
    const presence = await server.call('POST', `${path}/presence`, { view: 'mixer' });
    expect(studioPresenceReplySchema.safeParse(presence.body).success).toBe(true);
    const removed = await server.call('DELETE', path);
    expect(studioDeleteResponseSchema.safeParse(removed.body).success).toBe(true);
  });
});
