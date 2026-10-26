import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createProject, defaultTrack, type StudioOp, type StudioProject } from '@rooms/studio';
import type {
  StudioBatchInput,
  StudioBridge,
  StudioPresenceState,
  StudioSyncResponse,
} from '../packages/shared-contracts/src/studio';
import { createStudioSession, type StudioSession } from '../apps/desktop/src/studio/sync';
import { connectStudioEngine } from '../apps/desktop/src/studio/engine-adapter';
import { studioErrorCode, studioErrorMessage } from '../apps/desktop/src/studio/errors';

const SELF = 'alice';
interface Deferred<T> {
  resolve: (value: T) => void;
  reject: (error: unknown) => void;
}
interface SyncCall extends Deferred<StudioSyncResponse> {
  afterSeq: number;
  waitMs: number;
}
interface OpsCall extends Deferred<{ protocolVersion: 1; seq: number; applied: number[]; skipped: [] }> {
  batch: StudioBatchInput;
  body: string;
}
interface PresenceCall extends Deferred<{ protocolVersion: 1; presence: [] }> {
  state: StudioPresenceState;
  at: number;
}

function fakeBridge() {
  const syncs: SyncCall[] = [];
  const ops: OpsCall[] = [];
  const presence: PresenceCall[] = [];
  const bridge: StudioBridge = {
    list: vi.fn(),
    create: vi.fn(),
    remove: vi.fn(),
    sync: (_room, _project, afterSeq, waitMs) =>
      new Promise((resolve, reject) => syncs.push({ afterSeq, waitMs, resolve, reject })),
    ops: (_room, _project, batch) =>
      new Promise((resolve, reject) =>
        ops.push({
          batch: structuredClone(batch),
          body: JSON.stringify(batch),
          resolve: resolve as OpsCall['resolve'],
          reject,
        }),
      ),
    presence: (_room, _project, state) =>
      new Promise((resolve, reject) =>
        presence.push({
          state: structuredClone(state),
          at: Date.now(),
          resolve: resolve as PresenceCall['resolve'],
          reject,
        }),
      ),
  };
  return { bridge, syncs, ops, presence };
}

const baseDoc = (): StudioProject => {
  const doc = createProject({
    id: 'p1',
    roomId: 'room1',
    name: 'Demo',
    createdBy: SELF,
    createdAt: 1000,
  });
  return { ...doc, tracks: { t1: defaultTrack('t1', 'instrument') }, trackOrder: ['t1'] };
};
const access = { canEdit: true, canDelete: true };
const snapshot = (seq: number, doc = baseDoc(), canEdit = true): StudioSyncResponse => ({
  protocolVersion: 1,
  serverTimeMs: Date.now(),
  seq,
  presence: [],
  access: { ...access, canEdit },
  snapshot: doc,
});
const batches = (
  seq: number,
  list: { seq: number; actorId: string; batchId: string; ops: StudioOp[] }[],
): StudioSyncResponse => ({
  protocolVersion: 1,
  serverTimeMs: Date.now(),
  seq,
  presence: [],
  access,
  batches: list,
});
const volume = (value: number): StudioOp => ({
  op: 'track.set',
  id: 't1',
  field: 'volume',
  value,
});
const pan = (value: number): StudioOp => ({ op: 'track.set', id: 't1', field: 'pan', value });
const flush = () => vi.advanceTimersByTimeAsync(0);
const track = (session: StudioSession) => session.view().doc!.tracks.t1;

let sessions: StudioSession[] = [];
async function open(canEdit = true, seq = 0, doc = baseDoc()) {
  const fake = fakeBridge();
  let n = 0;
  const session = createStudioSession({
    bridge: fake.bridge,
    roomId: 'room1',
    projectId: 'p1',
    actorId: SELF,
    uuid: () => `00000000-0000-4000-8000-${String(++n).padStart(12, '0')}`,
  });
  sessions.push(session);
  await flush();
  expect(fake.syncs[0]).toMatchObject({ afterSeq: 0, waitMs: 0 });
  fake.syncs[0].resolve(snapshot(seq, doc, canEdit));
  await flush();
  return { ...fake, session };
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(1_000_000);
});
afterEach(() => {
  sessions.forEach((session) => session.close());
  sessions = [];
  vi.useRealTimers();
});

describe('Studio client session', () => {
  it('loads with an immediate first sync, then long-polls after the confirmed seq', async () => {
    const { session, syncs } = await open(true, 5);
    expect(session.view()).toMatchObject({ status: 'live', seq: 5, readOnly: false, pending: 0 });
    expect(syncs[1]).toMatchObject({ afterSeq: 5, waitMs: 25_000 });
  });

  it('applies an edit at once and keeps it through the server echo without flicker', async () => {
    const { session, syncs, ops } = await open();
    const seen: number[] = [];
    session.subscribe(() => seen.push(track(session).volume));
    expect(session.dispatch([volume(0.5)])).toBe(true);
    expect(track(session).volume).toBe(0.5);
    expect(session.view().pending).toBe(1);
    await flush();
    expect(ops).toHaveLength(1);
    const { batchId } = ops[0].batch;
    ops[0].resolve({ protocolVersion: 1, seq: 1, applied: [0], skipped: [] });
    await flush();
    expect(session.view().pending).toBe(1); // stays until the log shows it
    syncs[1].resolve(batches(1, [{ seq: 1, actorId: SELF, batchId, ops: [volume(0.5)] }]));
    await flush();
    expect(session.view()).toMatchObject({ seq: 1, pending: 0, status: 'live' });
    expect(track(session).volume).toBe(0.5);
    expect(seen.every((value) => value === 0.5)).toBe(true);
    expect(syncs[2]).toMatchObject({ afterSeq: 1 });
  });

  it('drops a batch whose reply arrives after the poll already confirmed it', async () => {
    const { session, syncs, ops } = await open();
    session.dispatch([volume(0.5)]);
    await flush();
    const { batchId } = ops[0].batch;
    syncs[1].resolve(batches(1, [{ seq: 1, actorId: SELF, batchId, ops: [volume(0.5)] }]));
    await flush();
    expect(session.view().pending).toBe(0);
    ops[0].resolve({ protocolVersion: 1, seq: 1, applied: [0], skipped: [] });
    await flush();
    expect(session.view()).toMatchObject({ pending: 0, seq: 1 });
    expect(ops).toHaveLength(1);
  });

  it('rebases pending edits over concurrent remote batches (server order wins per field)', async () => {
    const { session, syncs, ops } = await open();
    session.dispatch([volume(0.5)]);
    await flush();
    const mine = ops[0].batch.batchId;
    // Bob's batches were sequenced first: a pan change and a volume change on the same track.
    syncs[1].resolve(
      batches(2, [
        { seq: 1, actorId: 'bob', batchId: crypto.randomUUID(), ops: [pan(0.3)] },
        { seq: 2, actorId: 'bob', batchId: crypto.randomUUID(), ops: [volume(0.9)] },
      ]),
    );
    await flush();
    // Bob's pan shows; my pending volume is re-applied on top, as the server will apply it after his.
    expect(track(session)).toMatchObject({ pan: 0.3, volume: 0.5 });
    expect(session.view()).toMatchObject({ seq: 2, pending: 1 });
    ops[0].resolve({ protocolVersion: 1, seq: 3, applied: [0], skipped: [] });
    await flush();
    syncs[2].resolve(batches(3, [{ seq: 3, actorId: SELF, batchId: mine, ops: [volume(0.5)] }]));
    await flush();
    expect(track(session)).toMatchObject({ pan: 0.3, volume: 0.5 });
    expect(session.view().pending).toBe(0);
  });

  it('hides a pending edit whose track someone else deleted', async () => {
    const { session, syncs } = await open();
    session.dispatch([volume(0.5)]);
    await flush();
    syncs[1].resolve(
      batches(1, [
        {
          seq: 1,
          actorId: 'bob',
          batchId: crypto.randomUUID(),
          ops: [{ op: 'track.delete', id: 't1' }],
        },
      ]),
    );
    await flush();
    expect(session.view().doc!.tracks.t1).toBeUndefined();
    expect(session.view().pending).toBe(1);
  });

  it('retries a failed send with the same batchId and the same body, then goes live again', async () => {
    const { session, ops } = await open();
    session.dispatch([volume(0.5)]);
    await flush();
    ops[0].reject(
      new Error("Error invoking remote method 'rooms:studio-ops': Error: ACTIVITY_SERVICE_UNAVAILABLE"),
    );
    await flush();
    expect(session.view().status).toBe('offline');
    expect(session.view().error).toBeTruthy();
    // Edits made meanwhile go in a new batch; the attempted one is never changed.
    session.dispatch([pan(-0.2)]);
    session.dispatch([pan(-0.4)]);
    await vi.advanceTimersByTimeAsync(2_000);
    expect(ops).toHaveLength(2);
    expect(ops[1].body).toBe(ops[0].body);
    ops[1].resolve({ protocolVersion: 1, seq: 1, applied: [0], skipped: [] });
    await flush();
    expect(session.view()).toMatchObject({ status: 'live', error: null });
    expect(ops).toHaveLength(3);
    expect(ops[2].batch.batchId).not.toBe(ops[0].batch.batchId);
    // The two queued edits were never sent, so they travel as one batch.
    expect(ops[2].batch.ops).toEqual([pan(-0.2), pan(-0.4)]);
  });

  it('retries the long poll with backoff and turns live on the next answer', async () => {
    const { session, syncs } = await open(true, 4);
    syncs[1].reject(new Error('ACTIVITY_SERVICE_UNAVAILABLE'));
    await flush();
    expect(session.view().status).toBe('offline');
    expect(session.view().doc).not.toBeNull();
    await vi.advanceTimersByTimeAsync(2_000);
    expect(syncs[2]).toMatchObject({ afterSeq: 4, waitMs: 0 });
    syncs[2].resolve(batches(4, []));
    await flush();
    expect(session.view()).toMatchObject({ status: 'live', seq: 4 });
    expect(syncs[3]).toMatchObject({ afterSeq: 4, waitMs: 25_000 });
  });

  it('replaces the document on a snapshot fallback: done batches drop, the rest resend, undo clears', async () => {
    const { session, syncs, ops } = await open(true, 3);
    session.dispatch([volume(0.5)]);
    await flush();
    ops[0].resolve({ protocolVersion: 1, seq: 4, applied: [0], skipped: [] });
    await flush();
    session.dispatch([pan(0.7)]);
    await flush();
    expect(ops).toHaveLength(2);
    expect(session.view()).toMatchObject({ pending: 2, canUndo: true });
    // Behind the retained log: the server sends the document at seq 5, which contains the first batch.
    const remote = baseDoc();
    remote.tracks.t1 = { ...remote.tracks.t1, volume: 0.5, name: 'Bob' };
    syncs[1].resolve(snapshot(5, remote));
    await flush();
    expect(session.view()).toMatchObject({ seq: 5, pending: 1, canUndo: false, canRedo: false });
    expect(track(session)).toMatchObject({ volume: 0.5, name: 'Bob', pan: 0.7 });
    ops[1].resolve({ protocolVersion: 1, seq: 6, applied: [0], skipped: [] });
    await flush();
    expect(session.view().pending).toBe(1);
  });

  it('resends batches a snapshot does not contain (server restarted behind the client)', async () => {
    const { session, syncs, ops } = await open(true, 3);
    session.dispatch([volume(0.5)]);
    await flush();
    ops[0].resolve({ protocolVersion: 1, seq: 4, applied: [0], skipped: [] });
    await flush();
    syncs[1].resolve(snapshot(3));
    await flush();
    expect(session.view()).toMatchObject({ seq: 3, pending: 1 });
    expect(track(session).volume).toBe(0.5);
    expect(ops).toHaveLength(2);
    expect(ops[1].body).toBe(ops[0].body);
  });

  it('asks for a snapshot when the log has a hole', async () => {
    const { session, syncs } = await open(true, 2);
    syncs[1].resolve(
      batches(5, [{ seq: 4, actorId: 'bob', batchId: crypto.randomUUID(), ops: [pan(0.1)] }]),
    );
    await flush();
    expect(syncs[2]).toMatchObject({ afterSeq: 0, waitMs: 0 });
    expect(session.view().seq).toBe(2);
  });

  it('undoes and redoes local edits through new batches', async () => {
    const { session, ops } = await open();
    session.dispatch([volume(0.5)]);
    session.dispatch([{ op: 'track.set', id: 't1', field: 'name', value: 'Lead' }]);
    expect(session.view()).toMatchObject({ canUndo: true, canRedo: false });
    expect(session.undo()).toBe(true);
    expect(track(session)).toMatchObject({ name: '', volume: 0.5 });
    expect(session.undo()).toBe(true);
    expect(track(session).volume).toBe(1);
    expect(session.view()).toMatchObject({ canUndo: false, canRedo: true });
    expect(session.redo()).toBe(true);
    expect(track(session).volume).toBe(0.5);
    // A new edit drops the redo history.
    session.dispatch([pan(0.2)]);
    expect(session.view().canRedo).toBe(false);
    expect(session.redo()).toBe(false);
    await flush();
    // Everything was sent in order: the first batch is in flight, the rest grew into one queued batch.
    ops[0].resolve({ protocolVersion: 1, seq: 1, applied: [0], skipped: [] });
    await flush();
    expect(ops[1].batch.ops).toEqual([
      { op: 'track.set', id: 't1', field: 'name', value: 'Lead' },
      { op: 'track.set', id: 't1', field: 'name', value: '' },
      volume(1),
      volume(0.5),
      pan(0.2),
    ]);
  });

  it('splits a dispatch over 200 ops into several batches', async () => {
    const { session, ops } = await open();
    const many = Array.from({ length: 250 }, (_, i) => volume((i % 10) / 10));
    expect(session.dispatch(many)).toBe(true);
    await flush();
    expect(ops[0].batch.ops).toHaveLength(200);
    ops[0].resolve({ protocolVersion: 1, seq: 1, applied: [], skipped: [] });
    await flush();
    expect(ops[1].batch.ops).toHaveLength(50);
  });

  it('blocks editing when the member may not control the room', async () => {
    const { session, ops } = await open(false);
    expect(session.view().readOnly).toBe(true);
    expect(session.dispatch([volume(0.5)])).toBe(false);
    expect(session.undo()).toBe(false);
    expect(track(session).volume).toBe(1);
    expect(session.view().error).toBeTruthy();
    await flush();
    expect(ops).toHaveLength(0);
  });

  it('turns read-only and reverts pending edits when the server refuses editing', async () => {
    const { session, ops } = await open();
    session.dispatch([volume(0.5)]);
    await flush();
    ops[0].reject(new Error('STUDIO_EDIT_DENIED'));
    await flush();
    expect(session.view()).toMatchObject({ readOnly: true, pending: 0, canUndo: false });
    expect(track(session).volume).toBe(1);
    expect(session.view().error).toBe(studioErrorMessage(new Error('STUDIO_EDIT_DENIED')));
  });

  it('drops a refused batch without retrying it', async () => {
    const { session, ops } = await open();
    session.dispatch([volume(0.5)]);
    await flush();
    ops[0].reject(new Error('PAYLOAD_TOO_LARGE'));
    await vi.advanceTimersByTimeAsync(20_000);
    expect(ops).toHaveLength(1);
    expect(session.view()).toMatchObject({ pending: 0, status: 'live' });
    expect(track(session).volume).toBe(1);
  });

  it('stops for good when the project is gone', async () => {
    const { session, syncs } = await open();
    syncs[1].reject(new Error('STUDIO_PROJECT_NOT_FOUND'));
    await vi.advanceTimersByTimeAsync(30_000);
    expect(session.view().status).toBe('error');
    expect(syncs).toHaveLength(2);
  });

  it('throttles presence to four posts a second and always sends the latest full state', async () => {
    const { session, presence } = await open();
    session.setPresence({ view: 'arrangement' });
    for (let beat = 1; beat <= 40; beat++) {
      session.setPresence({ playheadBeat: beat });
      await vi.advanceTimersByTimeAsync(25);
      presence.at(-1)?.resolve({ protocolVersion: 1, presence: [] });
    }
    await vi.advanceTimersByTimeAsync(1_000);
    const sent = presence.map((call) => call.at);
    for (let i = 1; i < sent.length; i++) expect(sent[i] - sent[i - 1]).toBeGreaterThanOrEqual(250);
    expect(presence.length).toBeLessThanOrEqual(6);
    expect(presence.at(-1)!.state).toEqual({ view: 'arrangement', playheadBeat: 40 });
  });

  it('lists other members from sync answers, not this user', async () => {
    const { session, syncs } = await open();
    syncs[1].resolve({
      ...batches(0, []),
      presence: [
        { userId: SELF, displayName: 'Alice', lastSeenAt: 1 },
        { userId: 'bob', displayName: 'Bob', lastSeenAt: 1, playheadBeat: 8 },
      ],
    });
    await flush();
    expect(session.view().presence).toEqual([
      { userId: 'bob', displayName: 'Bob', lastSeenAt: 1, playheadBeat: 8 },
    ]);
  });

  it('keeps undo history when a never-edited project answers its poll with a snapshot', async () => {
    const { session, syncs, ops } = await open(true, 0);
    session.dispatch([volume(0.5)]);
    await flush();
    ops[0].resolve({ protocolVersion: 1, seq: 1, applied: [0], skipped: [] });
    await flush();
    const doc = baseDoc();
    doc.tracks.t1 = { ...doc.tracks.t1, volume: 0.5 };
    syncs[1].resolve(snapshot(1, doc));
    await flush();
    expect(session.view()).toMatchObject({ seq: 1, pending: 0, canUndo: true });
  });
});

describe('Studio error text', () => {
  it('reads the public code through the Electron prefix', () => {
    expect(
      studioErrorCode(
        new Error("Error invoking remote method 'rooms:studio-ops': Error: STUDIO_BATCH_CONFLICT"),
      ),
    ).toBe('STUDIO_BATCH_CONFLICT');
    expect(studioErrorCode(new Error('fetch failed'))).toBeNull();
  });

  it('has its own message for every Studio code, including the room limit', () => {
    const generic = studioErrorMessage(new Error('SOMETHING_ELSE'));
    for (const code of [
      'STUDIO_PROJECT_NOT_FOUND',
      'STUDIO_CREATE_DENIED',
      'STUDIO_DELETE_DENIED',
      'STUDIO_EDIT_DENIED',
      'STUDIO_ROOM_FULL',
      'STUDIO_BATCH_CONFLICT',
      'STUDIO_UNAVAILABLE',
      'PAYLOAD_TOO_LARGE',
    ])
      expect(studioErrorMessage(new Error(code)), code).not.toBe(generic);
    expect(studioErrorMessage(new Error('STUDIO_ROOM_FULL'))).toContain('proje');
  });
});

describe('Studio engine adapter', () => {
  it('loads one document at a time and skips to the newest', async () => {
    let current: StudioProject | null = null;
    const listeners = new Set<() => void>();
    const set = (doc: StudioProject) => {
      current = doc;
      listeners.forEach((listener) => listener());
    };
    const loads: { doc: StudioProject; done: () => void }[] = [];
    const engine = {
      load: (doc: StudioProject) =>
        new Promise<never>((resolve) =>
          loads.push({ doc, done: () => resolve(undefined as never) }),
        ),
    };
    const stop = connectStudioEngine(engine, {
      current: () => current,
      subscribe: (listener) => {
        listeners.add(listener);
        return () => listeners.delete(listener);
      },
    });
    const a = baseDoc();
    const b = { ...a, name: 'B' };
    const c = { ...a, name: 'C' };
    set(a);
    set(b);
    set(c);
    await flush();
    expect(loads.map((load) => load.doc)).toEqual([a]);
    loads[0].done();
    await flush();
    expect(loads.map((load) => load.doc)).toEqual([a, c]);
    loads[1].done();
    await flush();
    set(c);
    expect(loads).toHaveLength(2);
    stop();
    set({ ...a, name: 'D' });
    await flush();
    expect(loads).toHaveLength(2);
  });
});
