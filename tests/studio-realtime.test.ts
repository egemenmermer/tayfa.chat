import { randomUUID } from 'node:crypto';
import { mkdir, mkdtemp, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createActivityServer } from '../apps/services/activities/server';
import { MemoryActivityRepository } from '../apps/services/activities/repository';
import { ActivityError } from '../apps/services/activities/engine';
import type { ActivityOperationalEvent } from '../apps/services/activities/operational-events';
import { FileStudioStore } from '../apps/services/activities/studio';
import {
  applyOps,
  defaultTrack,
  MAX_BATCH_BYTES,
  MAX_PROJECTS_PER_ROOM,
  MAX_TRACKS,
  RETAINED_BATCHES,
  serializedBytes,
  type StudioOp,
  type StudioProject,
} from '../packages/studio/src/index';

/** Mutable so a test can change a member's permissions mid-session. */
let members: Record<string, { canControl: boolean; canCreate: boolean }> = {};
const authorize = async (token: string, roomId: string) => {
  const member = members[token];
  if (!member || !['room-1', 'room-2'].includes(roomId))
    throw new ActivityError(403, 'ROOM_ACCESS_DENIED');
  return { userId: token, displayName: token.toUpperCase(), ...member };
};

interface SyncBody {
  protocolVersion: number;
  serverTimeMs: number;
  seq: number;
  snapshot?: StudioProject;
  batches?: { seq: number; actorId: string; batchId: string; ops: StudioOp[] }[];
  presence: Record<string, unknown>[];
  access: { canEdit: boolean; canDelete: boolean };
}
type Call = (
  user: string,
  method: string,
  path: string,
  body?: unknown,
) => Promise<{ status: number; body: Record<string, unknown> }>;

const directories: string[] = [];
const apps: { close(): Promise<unknown> }[] = [];
afterEach(async () => {
  for (const app of apps.splice(0)) await app.close();
  for (const directory of directories.splice(0))
    await rm(directory, { recursive: true, force: true });
});
async function temporary() {
  const directory = await mkdtemp(join(tmpdir(), 'rooms-studio-test-'));
  directories.push(directory);
  return directory;
}

async function start(directory: string, events: ActivityOperationalEvent[] = []) {
  const app = await createActivityServer({
    repository: new MemoryActivityRepository(),
    studio: new FileStudioStore(directory),
    authorize,
    onOperationalEvent: (event) => events.push(event),
    sweepIntervalMs: 60000,
    rateLimits: { ingressPerMinute: 10000, identityPerMinute: 10000, studioPerMinute: 10000 },
  });
  await app.listen({ host: '127.0.0.1', port: 0 });
  apps.push(app);
  const address = app.server.address();
  const base = `http://127.0.0.1:${typeof address === 'object' && address ? address.port : 0}`;
  const call: Call = async (user, method, path, body) => {
    const response = await fetch(base + path, {
      method,
      headers: {
        authorization: `Bearer ${user}`,
        ...(body === undefined ? {} : { 'content-type': 'application/json' }),
      },
      body: body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body),
    });
    return { status: response.status, body: (await response.json()) as Record<string, unknown> };
  };
  const close = async () => {
    apps.splice(apps.indexOf(app), 1);
    await app.close();
  };
  return { call, close };
}

const projects = '/v1/rooms/room-1/studio/projects';
async function createProject(call: Call, user = 'alice', name = 'İlk şarkı') {
  const created = await call(user, 'POST', projects, { protocolVersion: 1, name });
  expect(created.status).toBe(200);
  return `${projects}/${(created.body.project as { id: string }).id}`;
}
const batch = (ops: StudioOp[], batchId: string = randomUUID()) => ({
  protocolVersion: 1,
  batchId,
  ops,
});
const id = () => randomUUID();
const trackOp = (trackId = id()): StudioOp => ({
  op: 'track.create',
  track: defaultTrack(trackId, 'drums'),
});

/** A client mirror: the confirmed project plus the seq it has seen, folded with the shared reducer. */
function mirror(first: SyncBody) {
  let project = first.snapshot as StudioProject;
  let seq = first.seq;
  return {
    get project() {
      return project;
    },
    get seq() {
      return seq;
    },
    accept(sync: SyncBody) {
      if (sync.snapshot) project = sync.snapshot;
      for (const entry of sync.batches ?? []) project = applyOps(project, entry.ops).doc;
      seq = sync.seq;
    },
  };
}
async function pull(call: Call, user: string, path: string, afterSeq: number, waitMs = 0) {
  const result = await call(user, 'GET', `${path}?afterSeq=${afterSeq}&waitMs=${waitMs}`);
  expect(result.status).toBe(200);
  return result.body as unknown as SyncBody;
}

describe('Studio sync over real HTTP clients', () => {
  it('converges concurrent edits, wakes long polls, replays retries and rejects a reused batch id', async () => {
    members = {
      alice: { canControl: true, canCreate: true },
      bob: { canControl: true, canCreate: false },
    };
    const { call } = await start(await temporary());
    const path = await createProject(call);
    const alice = mirror(await pull(call, 'alice', path, 0));
    expect(alice.project).toMatchObject({
      name: 'İlk şarkı',
      roomId: 'room-1',
      createdBy: 'alice',
    });
    const bob = mirror(await pull(call, 'bob', path, 0));
    expect(alice.seq).toBe(0);

    // Bob waits at 0; Alice's first batch wakes him (a client at 0 always gets the snapshot).
    const waitingAtZero = pull(call, 'bob', path, bob.seq, 5000);
    const drums = id();
    const clip = id();
    const first = batch([
      trackOp(drums),
      {
        op: 'clip.create',
        clip: { id: clip, trackId: drums, startBeat: 0, lengthBeats: 4, name: '', kind: 'midi' },
      },
      ...[0, 1, 2, 3].map((beat): StudioOp => ({
        op: 'note.create',
        note: {
          id: id(),
          clipId: clip,
          pitch: 36,
          startBeat: beat,
          lengthBeats: 0.25,
          velocity: 110,
        },
      })),
    ]);
    const sent = await call('alice', 'POST', `${path}/ops`, first);
    expect(sent.body).toEqual({
      protocolVersion: 1,
      seq: 1,
      applied: [0, 1, 2, 3, 4, 5],
      skipped: [],
    });
    const woken = await waitingAtZero;
    expect(woken.seq).toBe(1);
    bob.accept(woken);
    expect(Object.keys(bob.project.notes)).toHaveLength(4);
    alice.accept(await pull(call, 'alice', path, alice.seq));
    expect(alice.project).toEqual(bob.project);

    // Concurrent edits, no expected revision: both apply, field-level last writer wins in server order.
    const aliceEdit = batch([
      { op: 'track.set', id: drums, field: 'volume', value: 0.3 },
      { op: 'track.set', id: drums, field: 'name', value: 'Kick' },
    ]);
    const bobEdit = batch([
      { op: 'track.set', id: drums, field: 'volume', value: 0.5 },
      { op: 'track.set', id: drums, field: 'eq.low', value: 3 },
      { op: 'project.set', field: 'tempo', value: 96 },
    ]);
    const waiting = pull(call, 'bob', path, bob.seq, 5000);
    const [a, b] = await Promise.all([
      call('alice', 'POST', `${path}/ops`, aliceEdit),
      call('bob', 'POST', `${path}/ops`, bobEdit),
    ]);
    expect([a.body.seq, b.body.seq].sort()).toEqual([2, 3]);
    // The waiting poll is woken by the first of them and receives batches, not a snapshot.
    const batches = (await waiting).batches!;
    expect(batches[0]).toMatchObject({ seq: 2, actorId: a.body.seq === 2 ? 'alice' : 'bob' });
    expect(batches[0].ops).toEqual(a.body.seq === 2 ? aliceEdit.ops : bobEdit.ops);
    alice.accept(await pull(call, 'alice', path, alice.seq));
    bob.accept(await pull(call, 'bob', path, bob.seq));
    expect(alice.project).toEqual(bob.project);
    expect(alice.project).toEqual((await pull(call, 'bob', path, 0)).snapshot);
    const lastVolume = (a.body.seq as number) > (b.body.seq as number) ? 0.3 : 0.5;
    expect(alice.project.tracks[drums]).toMatchObject({ name: 'Kick', volume: lastVolume });
    expect(alice.project.tracks[drums].eq.low).toBe(3);
    expect(alice.project.tempo).toBe(96);

    // A retry is answered with the original result and not applied again.
    expect(await call('alice', 'POST', `${path}/ops`, aliceEdit)).toEqual(a);
    expect((await pull(call, 'alice', path, alice.seq)).batches).toEqual([]);
    // The same id with a different body is a conflict, not a second batch.
    const reused = batch(
      [{ op: 'track.set', id: drums, field: 'volume', value: 1 }],
      aliceEdit.batchId,
    );
    expect(await call('alice', 'POST', `${path}/ops`, reused)).toEqual({
      status: 409,
      body: { error: 'STUDIO_BATCH_CONFLICT' },
    });
    // Idempotency is per (actor, batchId): another member's batch with that id is its own batch.
    expect((await call('bob', 'POST', `${path}/ops`, reused)).body).toMatchObject({ seq: 4 });

    // Presence is memory only, replaced per post, and wakes waiting pollers (coalesced).
    const presenceWait = pull(call, 'alice', path, 4, 5000);
    const here = await call('bob', 'POST', `${path}/presence`, {
      playheadBeat: 8,
      selection: { clipId: clip, noteIds: [] },
      view: 'piano-roll',
    });
    expect(here.status).toBe(200);
    const withPresence = await presenceWait;
    expect(withPresence.batches).toEqual([]);
    expect(withPresence.presence).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ userId: 'alice', displayName: 'ALICE' }),
        expect.objectContaining({
          userId: 'bob',
          playheadBeat: 8,
          selection: { clipId: clip, noteIds: [] },
          view: 'piano-roll',
        }),
      ]),
    );
  });

  it('skips ops on entities another member deleted and still sequences the batch', async () => {
    members = {
      alice: { canControl: true, canCreate: true },
      bob: { canControl: true, canCreate: false },
    };
    const { call } = await start(await temporary());
    const path = await createProject(call);
    const track = id();
    await call('alice', 'POST', `${path}/ops`, batch([trackOp(track)]));
    const bob = mirror(await pull(call, 'bob', path, 0));
    expect(bob.project.trackOrder).toEqual([track]);

    // Alice deletes the track; Bob, not yet aware, edits it and adds a clip to it.
    await call('alice', 'POST', `${path}/ops`, batch([{ op: 'track.delete', id: track }]));
    const stale = batch([
      { op: 'track.set', id: track, field: 'mute', value: true },
      {
        op: 'clip.create',
        clip: { id: id(), trackId: track, startBeat: 0, lengthBeats: 4, name: '', kind: 'midi' },
      },
      { op: 'project.set', field: 'name', value: 'Yeni ad' },
    ]);
    const result = await call('bob', 'POST', `${path}/ops`, stale);
    expect(result.body).toEqual({
      protocolVersion: 1,
      seq: 3,
      applied: [2],
      skipped: [
        { index: 0, op: 'track.set', reason: 'missing-target' },
        { index: 1, op: 'clip.create', reason: 'missing-track' },
      ],
    });
    // A batch whose ops were all skipped is still logged, so its sender can drop it from pending.
    const empty = batch([{ op: 'note.delete', id: id() }]);
    expect((await call('bob', 'POST', `${path}/ops`, empty)).body).toMatchObject({
      seq: 4,
      applied: [],
    });
    bob.accept(await pull(call, 'bob', path, bob.seq));
    expect(bob.project.tracks).toEqual({});
    expect(bob.project.name).toBe('Yeni ad');
    expect(bob.project).toEqual((await pull(call, 'alice', path, 0)).snapshot);
  });

  it('lets outsiders see nothing, viewers only watch, and creators or managers delete', async () => {
    members = {
      alice: { canControl: true, canCreate: true },
      bob: { canControl: true, canCreate: false },
      viewer: { canControl: false, canCreate: false },
      manager: { canControl: true, canCreate: true },
    };
    const { call } = await start(await temporary());
    const path = await createProject(call);
    const edit = () => batch([trackOp()]);

    for (const [method, route, body] of [
      ['GET', projects, undefined],
      ['POST', projects, { protocolVersion: 1, name: 'x' }],
      ['GET', `${path}?afterSeq=0`, undefined],
      ['POST', `${path}/ops`, edit()],
      ['POST', `${path}/presence`, {}],
      ['DELETE', path, undefined],
    ] as const)
      expect(await call('mallory', method, route, body)).toEqual({
        status: 403,
        body: { error: 'ROOM_ACCESS_DENIED' },
      });
    // Projects belong to their room.
    expect(
      (await call('alice', 'GET', `${path.replace('room-1', 'room-2')}?afterSeq=0`)).status,
    ).toBe(404);

    const list = await call('viewer', 'GET', projects);
    expect(list.body).toMatchObject({
      projects: [{ name: 'İlk şarkı', createdBy: 'alice', tempo: 120, tracks: 0 }],
      access: { canCreate: false },
    });
    const watched = await pull(call, 'viewer', path, 0);
    expect(watched.access).toEqual({ canEdit: false, canDelete: false });
    expect((await call('viewer', 'POST', `${path}/presence`, { view: 'mixer' })).status).toBe(200);
    expect((await call('viewer', 'POST', `${path}/ops`, edit())).body).toEqual({
      error: 'STUDIO_EDIT_DENIED',
    });
    expect((await call('viewer', 'POST', projects, { protocolVersion: 1, name: 'x' })).status).toBe(
      403,
    );
    expect((await call('bob', 'POST', projects, { protocolVersion: 1, name: 'x' })).body).toEqual({
      error: 'STUDIO_CREATE_DENIED',
    });
    expect((await call('bob', 'DELETE', path)).body).toEqual({ error: 'STUDIO_DELETE_DENIED' });

    // The creator may delete their project after losing the create permission.
    members.alice = { canControl: true, canCreate: false };
    expect((await pull(call, 'alice', path, 0)).access).toEqual({ canEdit: true, canDelete: true });
    expect((await call('alice', 'DELETE', path)).status).toBe(200);
    // A manager (canCreate) deletes any project; a deletion wakes and ends waiting polls.
    members.alice = { canControl: true, canCreate: true };
    const other = await createProject(call, 'alice', 'İkinci');
    await call('alice', 'POST', `${other}/ops`, edit());
    const waiting = call('bob', 'GET', `${other}?afterSeq=1&waitMs=5000`);
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect((await call('manager', 'DELETE', other)).status).toBe(200);
    expect(await waiting).toEqual({ status: 404, body: { error: 'STUDIO_PROJECT_NOT_FOUND' } });

    // Membership lost during a long poll is seen on wake: the poll re-authorizes.
    const third = await createProject(call, 'alice', 'Üçüncü');
    await call('alice', 'POST', `${third}/ops`, edit());
    const kicked = call('bob', 'GET', `${third}?afterSeq=1&waitMs=5000`);
    await new Promise((resolve) => setTimeout(resolve, 100));
    delete members.bob;
    await call('alice', 'POST', `${third}/ops`, edit());
    expect(await kicked).toEqual({ status: 403, body: { error: 'ROOM_ACCESS_DENIED' } });
  });

  it('enforces batch, document, presence and room limits', async () => {
    members = { alice: { canControl: true, canCreate: true } };
    const { call } = await start(await temporary());
    const path = await createProject(call);
    const ops = `${path}/ops`;

    const tooMany = batch(Array.from({ length: 201 }, () => trackOp()));
    expect(await call('alice', 'POST', ops, tooMany)).toEqual({
      status: 400,
      body: { error: 'INVALID_COMMAND' },
    });
    // Within 200 ops but above the 60 KB serialized cap (and below the 64 KB body limit).
    const long = 'n'.repeat(120);
    const notes: StudioOp[] = [];
    while (serializedBytes(batch(notes)) < MAX_BATCH_BYTES + 1024)
      notes.push({
        op: 'note.create',
        note: {
          id: `${long}${notes.length}`,
          clipId: `${long}c`,
          pitch: 60,
          startBeat: 0,
          lengthBeats: 1,
          velocity: 100,
        },
      });
    expect(notes.length).toBeLessThanOrEqual(200);
    expect(serializedBytes(batch(notes))).toBeLessThan(64 * 1024);
    expect((await call('alice', 'POST', ops, batch(notes))).status).toBe(400);
    // Above the body limit the request never reaches the route.
    const huge = JSON.stringify({ ...batch([]), ops: [], pad: 'x'.repeat(70 * 1024) });
    expect(await call('alice', 'POST', ops, huge)).toEqual({
      status: 413,
      body: { error: 'PAYLOAD_TOO_LARGE' },
    });
    expect((await call('alice', 'POST', ops, '{"protocolVersion":')).status).toBe(400);
    expect(
      (await call('alice', 'POST', ops, { ...batch([trackOp()]), protocolVersion: 2 })).status,
    ).toBe(400);
    expect(
      (await call('alice', 'POST', ops, { ...batch([trackOp()]), expectedRevision: 1 })).status,
    ).toBe(400);

    // The document limits skip, never fail, the op that would cross them.
    const full = await call(
      'alice',
      'POST',
      ops,
      batch(Array.from({ length: MAX_TRACKS + 1 }, () => trackOp())),
    );
    expect(full.status).toBe(200);
    expect(full.body.applied).toHaveLength(MAX_TRACKS);
    expect(full.body.skipped).toEqual([{ index: MAX_TRACKS, op: 'track.create', reason: 'limit' }]);

    const presence = `${path}/presence`;
    expect(
      (
        await call('alice', 'POST', presence, {
          selection: { noteIds: Array.from({ length: 65 }, id) },
        })
      ).status,
    ).toBe(400);
    expect((await call('alice', 'POST', presence, { view: 'Mixer!' })).status).toBe(400);
    expect((await call('alice', 'POST', presence, { cursor: 1 })).status).toBe(400);
    expect((await call('alice', 'GET', `${path}?afterSeq=0&waitMs=25001`)).status).toBe(400);
    expect(
      (await call('alice', 'POST', projects, { protocolVersion: 1, name: ' boşluk' })).status,
    ).toBe(400);
    expect(
      (await call('alice', 'POST', projects, { protocolVersion: 1, name: 'a', tempo: 300 })).status,
    ).toBe(400);

    const template = await call('alice', 'POST', projects, {
      protocolVersion: 1,
      name: 'Davul bas',
      tempo: 90,
      template: 'drums-bass',
    });
    expect(template.body.project).toMatchObject({ tempo: 90, tracks: 2 });
    for (let i = 2; i < MAX_PROJECTS_PER_ROOM; i++)
      await createProject(call, 'alice', `Şarkı ${i}`);
    expect(await call('alice', 'POST', projects, { protocolVersion: 1, name: 'Fazla' })).toEqual({
      status: 409,
      body: { error: 'STUDIO_ROOM_FULL' },
    });
    expect((await call('alice', 'GET', projects)).body.projects).toHaveLength(
      MAX_PROJECTS_PER_ROOM,
    );
  });

  it('flushes on close, reloads from the file store and quarantines corrupt records', async () => {
    members = { alice: { canControl: true, canCreate: true } };
    const directory = await temporary();
    const events: ActivityOperationalEvent[] = [];
    let server = await start(directory, events);
    const path = await createProject(server.call);
    const projectId = path.split('/').pop()!;
    const track = id();
    await server.call('alice', 'POST', `${path}/ops`, batch([trackOp(track)]));
    await server.call(
      'alice',
      'POST',
      `${path}/ops`,
      batch([{ op: 'track.set', id: track, field: 'solo', value: true }]),
    );
    const before = await pull(server.call, 'alice', path, 0);
    // A project deleted with an unsaved edit is not written back by the pending save.
    const gone = await createProject(server.call, 'alice', 'Silinecek');
    await server.call('alice', 'POST', `${gone}/ops`, batch([trackOp()]));
    await server.call('alice', 'DELETE', gone);
    await server.close();

    const file = join(directory, 'room-1', `${projectId}.json`);
    expect((await stat(file)).mode & 0o777).toBe(0o600);
    expect(await readdir(join(directory, 'room-1'))).toEqual([`${projectId}.json`]);

    server = await start(directory, events);
    const reloaded = await pull(server.call, 'alice', path, 0);
    expect(reloaded.seq).toBe(2);
    expect(reloaded.snapshot).toEqual(before.snapshot);
    expect((await pull(server.call, 'alice', path, 1)).batches?.map((entry) => entry.seq)).toEqual([
      2,
    ]);

    // Corrupt records: unparsable JSON, a broken document, and one filed under another project id.
    const room = join(directory, 'room-1');
    const stored = JSON.parse(await readFile(file, 'utf8')) as { project: { tempo: number } };
    await writeFile(join(room, 'broken-json.json'), '{"version":1,', { mode: 0o600 });
    await writeFile(
      join(room, 'bad-tempo.json'),
      JSON.stringify({ ...stored, project: { ...stored.project, tempo: 999 } }),
    );
    await writeFile(join(room, 'elsewhere.json'), JSON.stringify(stored));
    await mkdir(join(directory, 'room-2'), { recursive: true });
    const list = await server.call('alice', 'GET', projects);
    expect(list.status).toBe(200);
    expect((list.body.projects as { id: string }[]).map((p) => p.id)).toEqual([projectId]);
    expect((await server.call('alice', 'GET', `${projects}/bad-tempo?afterSeq=0`)).status).toBe(
      404,
    );
    const names = (await readdir(room)).sort();
    expect(names.filter((name) => name.endsWith('.json'))).toEqual([`${projectId}.json`]);
    expect(names.filter((name) => name.includes('.json.corrupt-'))).toHaveLength(3);
    expect(events).toContainEqual(
      expect.objectContaining({ category: 'storage-incompatible', operation: 'studio-load' }),
    );
    // The good project still works after the quarantine.
    expect(
      (await server.call('alice', 'POST', `${path}/ops`, batch([trackOp()]))).body,
    ).toMatchObject({ seq: 3 });
  });

  it(`answers with a snapshot once a client is behind the ${RETAINED_BATCHES} retained batches`, async () => {
    members = { alice: { canControl: true, canCreate: true } };
    const { call } = await start(await temporary());
    const path = await createProject(call);
    const track = id();
    const behind = mirror(await pull(call, 'alice', path, 0));
    await call('alice', 'POST', `${path}/ops`, batch([trackOp(track)]));
    const total = RETAINED_BATCHES + 8;
    for (let i = 2; i <= total; i++) {
      const sent = await call(
        'alice',
        'POST',
        `${path}/ops`,
        batch([{ op: 'track.set', id: track, field: 'color', value: i % 12 }]),
      );
      expect(sent.status).toBe(200);
    }
    const edge = await pull(call, 'alice', path, total - RETAINED_BATCHES);
    expect(edge.snapshot).toBeUndefined();
    expect(edge.batches).toHaveLength(RETAINED_BATCHES);
    expect(edge.batches?.[0].seq).toBe(total - RETAINED_BATCHES + 1);
    const late = await pull(call, 'alice', path, total - RETAINED_BATCHES - 1);
    expect(late.batches).toBeUndefined();
    expect(late.snapshot?.tracks[track].color).toBe(total % 12);
    // A client ahead of the server (e.g. after a restore) is reset with a snapshot too.
    expect((await pull(call, 'alice', path, total + 5)).snapshot).toBeDefined();
    behind.accept(late);
    expect(behind.seq).toBe(total);
    expect(behind.project).toEqual(late.snapshot);
  });
});
