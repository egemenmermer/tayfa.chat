import { describe, expect, it } from 'vitest';
import {
  applyOps,
  chunkOps,
  createProject,
  defaultTrack,
  dropConfirmed,
  invertOps,
  rebase,
  studioOpSchema,
  studioProjectSchema,
  type StudioOp,
  type StudioPendingBatch,
  type StudioProject,
  type StudioTrackKind,
} from '../packages/studio/src/index';

/** mulberry32: a small deterministic PRNG, so every seed replays the same sequence. */
function prng(seed: number) {
  let state = seed >>> 0;
  const next = () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const int = (max: number) => Math.floor(next() * max);
  const pick = <T>(items: readonly T[]): T => items[int(items.length)];
  const chance = (p: number) => next() < p;
  /** A value in [min, max] on a 1/4 grid, so sums stay exact. */
  const quarter = (min: number, max: number) => min + int((max - min) * 4 + 1) / 4;
  return { int, pick, chance, quarter };
}
type Rng = ReturnType<typeof prng>;

function deepFreeze<T>(value: T): T {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value)) deepFreeze(child);
  }
  return value;
}

// Small id pools make collisions, re-created deleted ids and edits of deleted entities common.
const TRACK_IDS = ['t0', 't1', 't2', 't3', 't4', 't5'];
const CLIP_IDS = Array.from({ length: 10 }, (_, i) => `c${i}`);
const NOTE_IDS = Array.from({ length: 30 }, (_, i) => `n${i}`);
const TRACK_KINDS: StudioTrackKind[] = ['instrument', 'drums', 'audio'];

/** Mostly an existing id (so ops apply), sometimes any id from the pool (missing or deleted). */
function target(rng: Rng, existing: Record<string, unknown>, pool: string[]): string {
  const ids = Object.keys(existing);
  return ids.length && rng.chance(0.8) ? rng.pick(ids) : rng.pick(pool);
}

/** A schema-valid op, aimed at `doc` most of the time. */
function randomOp(rng: Rng, doc: StudioProject): StudioOp {
  const kind = rng.int(11);
  switch (kind) {
    case 0: {
      const field = rng.pick(['name', 'tempo', 'timeSignature', 'key', 'lengthBeats'] as const);
      if (field === 'name')
        return { op: 'project.set', field, value: rng.pick(['Demo', 'Gece', 'Şarkı 2']) };
      if (field === 'tempo') return { op: 'project.set', field, value: rng.quarter(40, 240) };
      if (field === 'timeSignature')
        return {
          op: 'project.set',
          field,
          value: { beats: 2 + rng.int(11), unit: rng.pick([4, 8] as const) },
        };
      if (field === 'key')
        return { op: 'project.set', field, value: rng.pick(['Am', 'C', 'F# minor', null]) };
      return { op: 'project.set', field, value: 1 + rng.int(256) };
    }
    case 1:
      return {
        op: 'track.create',
        track: defaultTrack(rng.pick(TRACK_IDS), rng.pick(TRACK_KINDS), {
          name: rng.pick(['', 'Bas', 'Davul ş']),
          color: rng.int(12),
        }),
      };
    case 2: {
      const id = target(rng, doc.tracks, TRACK_IDS);
      const field = rng.pick([
        'name',
        'instrument',
        'volume',
        'pan',
        'mute',
        'solo',
        'color',
        'sends.reverb',
        'sends.delay',
        'eq.low',
        'eq.mid',
        'eq.high',
      ] as const);
      switch (field) {
        case 'name':
          return { op: 'track.set', id, field, value: rng.pick(['', 'Lead', 'Ritim']) };
        case 'instrument':
          return { op: 'track.set', id, field, value: rng.pick(['piano@1', 'bass@1', 'saz@2']) };
        case 'mute':
        case 'solo':
          return { op: 'track.set', id, field, value: rng.chance(0.5) };
        case 'color':
          return { op: 'track.set', id, field, value: rng.int(12) };
        case 'volume':
          return { op: 'track.set', id, field, value: rng.quarter(0, 1.5) };
        case 'pan':
          return { op: 'track.set', id, field, value: rng.quarter(-1, 1) };
        case 'sends.reverb':
        case 'sends.delay':
          return { op: 'track.set', id, field, value: rng.quarter(0, 1) };
        default:
          return { op: 'track.set', id, field, value: rng.quarter(-12, 12) };
      }
    }
    case 3:
      return { op: 'track.delete', id: target(rng, doc.tracks, TRACK_IDS) };
    case 4:
      return {
        op: 'track.move',
        id: target(rng, doc.tracks, TRACK_IDS),
        index: rng.chance(0.9) ? rng.int(6) : 31,
      };
    case 5: {
      const trackId = target(rng, doc.tracks, TRACK_IDS);
      const track = doc.tracks[trackId];
      const audio = track ? (track.kind === 'audio') !== rng.chance(0.1) : rng.chance(0.3);
      const base = {
        id: rng.pick(CLIP_IDS),
        trackId,
        startBeat: rng.quarter(0, 64),
        lengthBeats: rng.quarter(0.25, 16),
        name: rng.pick(['', 'A', 'Nakarat']),
      };
      return {
        op: 'clip.create',
        clip: audio
          ? {
              ...base,
              kind: 'audio',
              blobId: 'blob1',
              offsetSec: rng.quarter(0, 10),
              gainDb: rng.quarter(-24, 12),
            }
          : { ...base, kind: 'midi' },
      };
    }
    case 6: {
      const id = target(rng, doc.clips, CLIP_IDS);
      const field = rng.pick([
        'name',
        'trackId',
        'startBeat',
        'lengthBeats',
        'offsetSec',
        'gainDb',
      ] as const);
      switch (field) {
        case 'name':
          return { op: 'clip.set', id, field, value: rng.pick(['', 'B']) };
        case 'trackId':
          return { op: 'clip.set', id, field, value: target(rng, doc.tracks, TRACK_IDS) };
        case 'startBeat':
          return { op: 'clip.set', id, field, value: rng.quarter(0, 64) };
        case 'lengthBeats':
          return { op: 'clip.set', id, field, value: rng.quarter(0.25, 16) };
        case 'offsetSec':
          return { op: 'clip.set', id, field, value: rng.quarter(0, 10) };
        default:
          return { op: 'clip.set', id, field, value: rng.quarter(-24, 12) };
      }
    }
    case 7:
      return { op: 'clip.delete', id: target(rng, doc.clips, CLIP_IDS) };
    case 8:
      return {
        op: 'note.create',
        note: {
          id: rng.pick(NOTE_IDS),
          clipId: target(rng, doc.clips, CLIP_IDS),
          pitch: rng.int(128),
          startBeat: rng.quarter(0, 16),
          lengthBeats: rng.quarter(0.25, 4),
          velocity: 1 + rng.int(127),
        },
      };
    case 9: {
      const id = target(rng, doc.notes, NOTE_IDS);
      const field = rng.pick(['pitch', 'startBeat', 'lengthBeats', 'velocity'] as const);
      if (field === 'pitch') return { op: 'note.set', id, field, value: rng.int(128) };
      if (field === 'velocity') return { op: 'note.set', id, field, value: 1 + rng.int(127) };
      if (field === 'startBeat') return { op: 'note.set', id, field, value: rng.quarter(0, 16) };
      return { op: 'note.set', id, field, value: rng.quarter(0.25, 4) };
    }
    default:
      return { op: 'note.delete', id: target(rng, doc.notes, NOTE_IDS) };
  }
}

/** `count` ops generated against the evolving document, so later ops build on earlier ones. */
function randomOps(rng: Rng, doc: StudioProject, count: number): StudioOp[] {
  const ops: StudioOp[] = [];
  let current = doc;
  for (let i = 0; i < count; i += 1) {
    const op = randomOp(rng, current);
    ops.push(op);
    current = applyOps(current, [op]).doc;
  }
  return ops;
}

/** A populated starting document: a template plus random history. */
function startDoc(rng: Rng): StudioProject {
  const doc = createProject({
    id: 'p1',
    roomId: 'room1',
    name: 'Demo',
    createdBy: 'alice',
    createdAt: 1000,
    template: rng.chance(0.5) ? 'drums-bass' : 'empty',
  });
  return applyOps(doc, randomOps(rng, doc, 40)).doc;
}

describe('invertOps', () => {
  it('undoes 250 random op sequences exactly', () => {
    const reasons = new Set<string>();
    const opKinds = new Set<string>();
    let appliedTotal = 0;
    for (let seed = 1; seed <= 250; seed += 1) {
      const rng = prng(seed);
      const before = deepFreeze(startDoc(rng));
      const ops = deepFreeze(randomOps(rng, before, 1 + rng.int(40)));
      for (const op of ops)
        expect(studioOpSchema.safeParse(op).success, JSON.stringify(op)).toBe(true);

      const forward = applyOps(before, ops);
      expect(forward.applied.length + forward.skipped.length).toBe(ops.length);
      expect(studioProjectSchema.safeParse(forward.doc).success, `seed ${seed}`).toBe(true);
      forward.skipped.forEach((skip) => reasons.add(skip.reason));
      forward.applied.forEach((index) => opKinds.add(ops[index].op));
      appliedTotal += forward.applied.length;

      const inverse = invertOps(before, ops);
      for (const op of inverse)
        expect(studioOpSchema.safeParse(op).success, JSON.stringify(op)).toBe(true);
      const back = applyOps(forward.doc, inverse);
      expect(back.skipped, `seed ${seed}`).toEqual([]);
      expect(back.doc, `seed ${seed}`).toStrictEqual(before);
      expect(back.doc.trackOrder).toEqual(before.trackOrder);

      // Sent in several batches, the undo lands the same way.
      let chunked = forward.doc;
      for (const chunk of chunkOps(inverse)) chunked = applyOps(chunked, chunk).doc;
      expect(chunked).toStrictEqual(before);
    }
    // The generator really exercises every op and the concurrency skips.
    expect([...opKinds].sort()).toEqual(
      [
        'clip.create',
        'clip.delete',
        'clip.set',
        'note.create',
        'note.delete',
        'note.set',
        'project.set',
        'track.create',
        'track.delete',
        'track.move',
        'track.set',
      ].sort(),
    );
    for (const reason of [
      'missing-target',
      'exists',
      'missing-track',
      'missing-clip',
      'kind-mismatch',
    ])
      expect(reasons.has(reason), reason).toBe(true);
    expect(appliedTotal).toBeGreaterThan(1000);
  });

  it('restores a deleted track at its position with its clips and notes', () => {
    const before = deepFreeze(
      createProject({
        id: 'p1',
        roomId: 'r',
        name: 'Demo',
        createdBy: 'a',
        createdAt: 0,
        template: 'drums-bass',
      }),
    );
    const ops: StudioOp[] = [{ op: 'track.delete', id: 'tpl-drums' }];
    const after = applyOps(before, ops).doc;
    expect(after.trackOrder).toEqual(['tpl-bass']);
    const inverse = invertOps(before, ops);
    expect(inverse.slice(0, 3).map((op) => op.op)).toEqual([
      'track.create',
      'track.move',
      'clip.create',
    ]);
    expect(inverse).toHaveLength(3 + 48);
    expect(applyOps(after, inverse).doc).toStrictEqual(before);
  });
});

/** The server: applies batches in arrival order and keeps the sequenced log. */
class Server {
  log: Array<{ seq: number; actorId: string; batchId: string; ops: readonly StudioOp[] }> = [];
  constructor(public doc: StudioProject) {}
  receive(actorId: string, batch: StudioPendingBatch) {
    this.doc = applyOps(this.doc, batch.ops).doc;
    this.log.push({ seq: this.log.length + 1, actorId, batchId: batch.batchId, ops: batch.ops });
  }
}

/** A client: confirmed state from the server log plus its own pending batches. */
class Client {
  confirmed: StudioProject;
  seq = 0;
  pending: StudioPendingBatch[] = [];
  sent = 0;
  private batches = 0;
  constructor(
    public actorId: string,
    doc: StudioProject,
  ) {
    this.confirmed = doc;
  }
  get view(): StudioProject {
    return rebase(this.confirmed, this.pending).doc;
  }
  edit(ops: StudioOp[]) {
    this.batches += 1;
    this.pending.push({ batchId: `${this.actorId}-${this.batches}`, ops });
  }
  /** Sends the next unsent pending batch, as the desktop bridge does in order. */
  send(server: Server): boolean {
    if (this.sent >= this.pending.length) return false;
    server.receive(this.actorId, this.pending[this.sent]);
    this.sent += 1;
    return true;
  }
  sync(server: Server) {
    const fresh = server.log.filter((entry) => entry.seq > this.seq);
    for (const entry of fresh) this.confirmed = applyOps(this.confirmed, entry.ops).doc;
    this.seq = server.log.length;
    const remaining = dropConfirmed(this.pending, fresh, this.actorId);
    this.sent -= this.pending.length - remaining.length;
    this.pending = remaining;
  }
}

function scene(): StudioProject {
  return deepFreeze(
    applyOps(createProject({ id: 'p1', roomId: 'r', name: 'Demo', createdBy: 'a', createdAt: 0 }), [
      { op: 'track.create', track: defaultTrack('t1', 'instrument') },
      { op: 'track.create', track: defaultTrack('t2', 'drums') },
    ]).doc,
  );
}

describe('two clients converge through rebase and server order', () => {
  for (const order of ['delete first', 'create first'] as const)
    it(`a track delete racing a clip create on it (${order})`, () => {
      const server = new Server(scene());
      const alice = new Client('alice', server.doc);
      const bob = new Client('bob', server.doc);
      alice.edit([{ op: 'track.delete', id: 't1' }]);
      bob.edit([
        {
          op: 'clip.create',
          clip: { id: 'c1', trackId: 't1', startBeat: 0, lengthBeats: 4, name: '', kind: 'midi' },
        },
        {
          op: 'note.create',
          note: { id: 'n1', clipId: 'c1', pitch: 60, startBeat: 0, lengthBeats: 1, velocity: 90 },
        },
      ]);
      // Optimistic views show each user's own edit at once.
      expect(alice.view.tracks.t1).toBeUndefined();
      expect(bob.view.clips.c1).toBeDefined();
      if (order === 'delete first') {
        alice.send(server);
        bob.send(server);
      } else {
        bob.send(server);
        alice.send(server);
      }
      alice.sync(server);
      bob.sync(server);
      expect(alice.pending).toEqual([]);
      expect(bob.pending).toEqual([]);
      expect(alice.view).toStrictEqual(server.doc);
      expect(bob.view).toStrictEqual(server.doc);
      // Either way the track and everything on it is gone.
      expect(server.doc.trackOrder).toEqual(['t2']);
      expect(server.doc.clips).toEqual({});
      expect(server.doc.notes).toEqual({});
    });

  it('settles concurrent writes per field in server order', () => {
    const server = new Server(scene());
    const alice = new Client('alice', server.doc);
    const bob = new Client('bob', server.doc);
    alice.edit([
      { op: 'track.set', id: 't1', field: 'volume', value: 0.2 },
      { op: 'track.set', id: 't1', field: 'eq.low', value: 6 },
    ]);
    bob.edit([
      { op: 'track.set', id: 't1', field: 'volume', value: 0.9 },
      { op: 'track.set', id: 't1', field: 'eq.high', value: -6 },
    ]);
    bob.send(server);
    // Alice sees Bob's confirmed batch under her own pending one.
    alice.sync(server);
    expect(alice.view.tracks.t1.volume).toBe(0.2);
    expect(alice.view.tracks.t1.eq).toEqual({ low: 6, mid: 0, high: -6 });
    alice.send(server);
    alice.sync(server);
    bob.sync(server);
    expect(server.doc.tracks.t1.volume).toBe(0.2);
    expect(server.doc.tracks.t1.eq).toEqual({ low: 6, mid: 0, high: -6 });
    expect(alice.view).toStrictEqual(server.doc);
    expect(bob.view).toStrictEqual(server.doc);
  });

  it('keeps a remote edit when undoing a local one', () => {
    const server = new Server(scene());
    const alice = new Client('alice', server.doc);
    const bob = new Client('bob', server.doc);
    const step: StudioOp[] = [
      { op: 'track.set', id: 't1', field: 'pan', value: -1 },
      { op: 'track.move', id: 't1', index: 1 },
    ];
    const undo = invertOps(alice.view, step);
    alice.edit(step);
    alice.send(server);
    bob.sync(server);
    bob.edit([{ op: 'track.set', id: 't1', field: 'mute', value: true }]);
    bob.send(server);
    alice.edit(undo);
    alice.send(server);
    alice.sync(server);
    bob.sync(server);
    expect(server.doc.tracks.t1).toMatchObject({ pan: 0, mute: true });
    expect(server.doc.trackOrder).toEqual(['t1', 't2']);
    expect(alice.view).toStrictEqual(server.doc);
    expect(bob.view).toStrictEqual(server.doc);
  });

  it('converges over 120 random interleavings', () => {
    for (let seed = 1; seed <= 120; seed += 1) {
      const rng = prng(10_000 + seed);
      const server = new Server(deepFreeze(startDoc(rng)));
      const clients = [new Client('alice', server.doc), new Client('bob', server.doc)];
      for (let step = 0; step < 30; step += 1) {
        const client = rng.pick(clients);
        const action = rng.int(3);
        if (action === 0) client.edit(randomOps(rng, client.view, 1 + rng.int(4)));
        else if (action === 1) client.send(server);
        else client.sync(server);
        // A client with nothing pending shows exactly the server state it has seen.
        if (!client.pending.length && client.seq === server.log.length)
          expect(client.view).toStrictEqual(server.doc);
      }
      for (const client of clients) while (client.send(server));
      for (const client of clients) client.sync(server);
      for (const client of clients) {
        expect(client.pending).toEqual([]);
        expect(client.view, `seed ${seed}`).toStrictEqual(server.doc);
      }
      expect(studioProjectSchema.safeParse(server.doc).success).toBe(true);
    }
  });
});
