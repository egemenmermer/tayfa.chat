import { randomUUID } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  applyOps,
  chunkOps,
  createProject,
  defaultTrack,
  MAX_BATCH_BYTES,
  MAX_BATCH_OPS,
  MAX_CLIPS,
  MAX_NOTES,
  MAX_TRACKS,
  STUDIO_PROTOCOL_VERSION,
  STUDIO_TEMPLATE_IDS,
  studioBatchSchema,
  studioOpSchema,
  studioProjectSchema,
  type StudioClip,
  type StudioNote,
  type StudioOp,
  type StudioProject,
  type StudioSkipReason,
} from '../packages/studio/src/index';

function deepFreeze<T>(value: T): T {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value)) deepFreeze(child);
  }
  return value;
}

const project = (template: 'empty' | 'drums-bass' = 'empty') =>
  createProject({
    id: 'p1',
    roomId: 'room1',
    name: 'Demo',
    createdBy: 'alice',
    createdAt: 1000,
    template,
  });
const midiClip = (id: string, trackId: string, extra: Partial<StudioClip> = {}): StudioClip => ({
  id,
  trackId,
  startBeat: 0,
  lengthBeats: 4,
  name: '',
  kind: 'midi',
  ...extra,
});
const audioClip = (id: string, trackId: string): StudioClip => ({
  id,
  trackId,
  startBeat: 8,
  lengthBeats: 4,
  name: 'take',
  kind: 'audio',
  blobId: 'blob1',
  offsetSec: 0.5,
  gainDb: -3,
});
const note = (id: string, clipId: string, pitch = 60): StudioNote => ({
  id,
  clipId,
  pitch,
  startBeat: 0,
  lengthBeats: 1,
  velocity: 100,
});

/** A frozen project with tracks t1 (instrument), t2 (drums), t3 (audio); clips c1 (t1), c2 (t2), c3 (t3); notes. */
function scene(): StudioProject {
  const { doc, skipped } = applyOps(project(), [
    { op: 'track.create', track: defaultTrack('t1', 'instrument') },
    { op: 'track.create', track: defaultTrack('t2', 'drums') },
    { op: 'track.create', track: defaultTrack('t3', 'audio') },
    { op: 'clip.create', clip: midiClip('c1', 't1') },
    { op: 'clip.create', clip: midiClip('c2', 't2') },
    { op: 'clip.create', clip: audioClip('c3', 't3') },
    { op: 'note.create', note: note('n1', 'c1') },
    { op: 'note.create', note: note('n2', 'c1', 64) },
    { op: 'note.create', note: note('n3', 'c2', 36) },
  ]);
  expect(skipped).toEqual([]);
  return deepFreeze(doc);
}

function apply(doc: StudioProject, ops: StudioOp[]) {
  const result = applyOps(doc, ops);
  expect(studioProjectSchema.safeParse(result.doc).success).toBe(true);
  return result;
}

it('keeps the package free of Node-only imports, so the desktop renderer can bundle it', () => {
  const root = join(__dirname, '../packages/studio/src');
  const offenders = readdirSync(root)
    .filter((file) => file.endsWith('.ts'))
    .filter((file) =>
      /from ['"]node:|\bBuffer\b|\brequire\(/.test(readFileSync(join(root, file), 'utf8')),
    );
  expect(offenders).toEqual([]);
});

describe('studio templates', () => {
  it('builds valid projects without display names', () => {
    for (const template of STUDIO_TEMPLATE_IDS) {
      const doc = project(template);
      expect(studioProjectSchema.parse(JSON.parse(JSON.stringify(doc)))).toStrictEqual(doc);
      for (const track of Object.values(doc.tracks)) expect(track.name).toBe('');
      for (const clip of Object.values(doc.clips)) expect(clip.name).toBe('');
    }
    expect(project('empty')).toMatchObject({ tempo: 120, trackOrder: [], lengthBeats: 64 });
    const groove = project('drums-bass');
    expect(groove.trackOrder).toEqual(['tpl-drums', 'tpl-bass']);
    expect(groove.tracks['tpl-drums'].kind).toBe('drums');
    expect(Object.keys(groove.clips)).toHaveLength(2);
    expect(Object.keys(groove.notes)).toHaveLength(68);
  });

  it('rejects invalid params', () => {
    expect(() =>
      createProject({ id: 'p', roomId: 'r', name: ' ', createdBy: 'a', createdAt: 0 }),
    ).toThrow();
    expect(() =>
      createProject({ id: 'p', roomId: 'r', name: 'x', createdBy: 'a', createdAt: 0, tempo: 300 }),
    ).toThrow();
  });
});

describe('applyOps', () => {
  it('sets every project field and clears the key with null', () => {
    const base = scene();
    const { doc, applied } = apply(base, [
      { op: 'project.set', field: 'name', value: 'Gece şarkısı' },
      { op: 'project.set', field: 'tempo', value: 92.5 },
      { op: 'project.set', field: 'timeSignature', value: { beats: 7, unit: 8 } },
      { op: 'project.set', field: 'key', value: 'F# minor' },
      { op: 'project.set', field: 'lengthBeats', value: 128 },
    ]);
    expect(applied).toEqual([0, 1, 2, 3, 4]);
    expect(doc).toMatchObject({
      name: 'Gece şarkısı',
      tempo: 92.5,
      timeSignature: { beats: 7, unit: 8 },
      key: 'F# minor',
      lengthBeats: 128,
    });
    const cleared = apply(doc, [{ op: 'project.set', field: 'key', value: null }]).doc;
    expect('key' in cleared).toBe(false);
    expect(base.name).toBe('Demo');
  });

  it('creates, edits, moves and deletes tracks; leaf fields keep their siblings', () => {
    const base = scene();
    const { doc } = apply(base, [
      { op: 'track.set', id: 't1', field: 'name', value: 'Piyano' },
      { op: 'track.set', id: 't1', field: 'instrument', value: 'future-synth@7' },
      { op: 'track.set', id: 't1', field: 'volume', value: 1.5 },
      { op: 'track.set', id: 't1', field: 'pan', value: -1 },
      { op: 'track.set', id: 't1', field: 'mute', value: true },
      { op: 'track.set', id: 't1', field: 'solo', value: true },
      { op: 'track.set', id: 't1', field: 'color', value: 11 },
      { op: 'track.set', id: 't1', field: 'sends.reverb', value: 0.4 },
      { op: 'track.set', id: 't1', field: 'sends.delay', value: 0.2 },
      { op: 'track.set', id: 't1', field: 'eq.low', value: -12 },
      { op: 'track.set', id: 't1', field: 'eq.mid', value: 3 },
      { op: 'track.set', id: 't1', field: 'eq.high', value: 12 },
      { op: 'track.move', id: 't3', index: 0 },
      { op: 'track.move', id: 't1', index: 31 },
    ]);
    expect(doc.tracks.t1).toEqual({
      ...base.tracks.t1,
      name: 'Piyano',
      instrument: 'future-synth@7',
      volume: 1.5,
      pan: -1,
      mute: true,
      solo: true,
      color: 11,
      sends: { reverb: 0.4, delay: 0.2 },
      eq: { low: -12, mid: 3, high: 12 },
    });
    expect(doc.trackOrder).toEqual(['t3', 't2', 't1']);
    const created = apply(doc, [{ op: 'track.create', track: defaultTrack('t4', 'drums') }]).doc;
    expect(created.trackOrder).toEqual(['t3', 't2', 't1', 't4']);
  });

  it('cascades a track delete to its clips and their notes only', () => {
    const { doc } = apply(scene(), [{ op: 'track.delete', id: 't1' }]);
    expect(doc.trackOrder).toEqual(['t2', 't3']);
    expect(Object.keys(doc.clips).sort()).toEqual(['c2', 'c3']);
    expect(Object.keys(doc.notes)).toEqual(['n3']);
  });

  it('creates, edits, moves and deletes clips; a clip delete cascades to its notes', () => {
    const base = scene();
    const { doc } = apply(base, [
      { op: 'clip.set', id: 'c1', field: 'name', value: 'Nakarat' },
      { op: 'clip.set', id: 'c1', field: 'startBeat', value: 16 },
      { op: 'clip.set', id: 'c1', field: 'lengthBeats', value: 8 },
      { op: 'clip.set', id: 'c1', field: 'trackId', value: 't2' },
      { op: 'clip.set', id: 'c3', field: 'offsetSec', value: 2 },
      { op: 'clip.set', id: 'c3', field: 'gainDb', value: 6 },
      { op: 'clip.create', clip: midiClip('c4', 't1', { startBeat: 32 }) },
    ]);
    expect(doc.clips.c1).toEqual({
      ...base.clips.c1,
      name: 'Nakarat',
      startBeat: 16,
      lengthBeats: 8,
      trackId: 't2',
    });
    expect(doc.clips.c3).toMatchObject({ offsetSec: 2, gainDb: 6 });
    expect(doc.clips.c4.trackId).toBe('t1');
    const deleted = apply(doc, [{ op: 'clip.delete', id: 'c1' }]).doc;
    expect(Object.keys(deleted.clips).sort()).toEqual(['c2', 'c3', 'c4']);
    expect(Object.keys(deleted.notes)).toEqual(['n3']);
  });

  it('creates, edits and deletes notes', () => {
    const { doc } = apply(scene(), [
      { op: 'note.create', note: note('n4', 'c1', 67) },
      { op: 'note.set', id: 'n1', field: 'pitch', value: 127 },
      { op: 'note.set', id: 'n1', field: 'startBeat', value: 2.5 },
      { op: 'note.set', id: 'n1', field: 'lengthBeats', value: 0.25 },
      { op: 'note.set', id: 'n1', field: 'velocity', value: 1 },
      { op: 'note.delete', id: 'n2' },
    ]);
    expect(doc.notes.n1).toEqual({
      ...note('n1', 'c1'),
      pitch: 127,
      startBeat: 2.5,
      lengthBeats: 0.25,
      velocity: 1,
    });
    expect(Object.keys(doc.notes).sort()).toEqual(['n1', 'n3', 'n4']);
  });

  it('is last-writer-wins per field in op order', () => {
    const { doc } = apply(scene(), [
      { op: 'track.set', id: 't1', field: 'volume', value: 0.2 },
      { op: 'track.set', id: 't1', field: 'eq.low', value: 4 },
      { op: 'track.set', id: 't1', field: 'volume', value: 0.7 },
      { op: 'track.set', id: 't1', field: 'eq.high', value: -4 },
    ]);
    expect(doc.tracks.t1.volume).toBe(0.7);
    expect(doc.tracks.t1.eq).toEqual({ low: 4, mid: 0, high: -4 });
  });

  it('never mutates its input and returns the input when nothing applies', () => {
    const base = scene();
    const snapshot = JSON.stringify(base);
    const ops: StudioOp[] = [
      { op: 'track.delete', id: 't2' },
      { op: 'clip.set', id: 'c1', field: 'startBeat', value: 4 },
      { op: 'note.delete', id: 'n1' },
      { op: 'track.move', id: 't3', index: 0 },
      { op: 'project.set', field: 'timeSignature', value: { beats: 3, unit: 4 } },
    ];
    deepFreeze(ops);
    const result = applyOps(base, ops);
    expect(JSON.stringify(base)).toBe(snapshot);
    // The result shares no mutable object with the ops it came from.
    expect(result.doc.timeSignature).not.toBe((ops[4] as { value: object }).value);
    const missed = applyOps(base, [{ op: 'note.delete', id: 'gone' }]);
    expect(missed.doc).toBe(base);
  });
});

describe('applyOps skips instead of throwing', () => {
  const cases: Array<[string, StudioOp[], StudioSkipReason]> = [
    [
      'track.set on a missing track',
      [{ op: 'track.set', id: 'x', field: 'mute', value: true }],
      'missing-target',
    ],
    ['track.delete on a missing track', [{ op: 'track.delete', id: 'x' }], 'missing-target'],
    ['track.move on a missing track', [{ op: 'track.move', id: 'x', index: 0 }], 'missing-target'],
    [
      'clip.set on a missing clip',
      [{ op: 'clip.set', id: 'x', field: 'name', value: '' }],
      'missing-target',
    ],
    ['clip.delete on a missing clip', [{ op: 'clip.delete', id: 'x' }], 'missing-target'],
    [
      'note.set on a missing note',
      [{ op: 'note.set', id: 'x', field: 'pitch', value: 1 }],
      'missing-target',
    ],
    ['note.delete on a missing note', [{ op: 'note.delete', id: 'x' }], 'missing-target'],
    [
      'an edit after a delete',
      [
        { op: 'track.delete', id: 't1' },
        { op: 'track.set', id: 't1', field: 'pan', value: 1 },
      ],
      'missing-target',
    ],
    [
      'a note edit after its track was deleted',
      [
        { op: 'track.delete', id: 't1' },
        { op: 'note.set', id: 'n1', field: 'velocity', value: 5 },
      ],
      'missing-target',
    ],
    [
      'track.create with an existing id',
      [{ op: 'track.create', track: defaultTrack('t1', 'drums') }],
      'exists',
    ],
    [
      'clip.create with an existing id',
      [{ op: 'clip.create', clip: midiClip('c1', 't1') }],
      'exists',
    ],
    ['note.create with an existing id', [{ op: 'note.create', note: note('n1', 'c1') }], 'exists'],
    [
      'a clip on a missing track',
      [{ op: 'clip.create', clip: midiClip('c9', 'x') }],
      'missing-track',
    ],
    [
      'a clip moved to a missing track',
      [{ op: 'clip.set', id: 'c1', field: 'trackId', value: 'x' }],
      'missing-track',
    ],
    [
      'a clip on a track deleted earlier in the batch',
      [
        { op: 'track.delete', id: 't1' },
        { op: 'clip.create', clip: midiClip('c9', 't1') },
      ],
      'missing-track',
    ],
    ['a note on a missing clip', [{ op: 'note.create', note: note('n9', 'x') }], 'missing-clip'],
    [
      'a note on a clip removed by a track cascade',
      [
        { op: 'track.delete', id: 't1' },
        { op: 'note.create', note: note('n9', 'c1') },
      ],
      'missing-clip',
    ],
    [
      'a MIDI clip on an audio track',
      [{ op: 'clip.create', clip: midiClip('c9', 't3') }],
      'kind-mismatch',
    ],
    [
      'an audio clip on a drum track',
      [{ op: 'clip.create', clip: audioClip('c9', 't2') }],
      'kind-mismatch',
    ],
    [
      'a MIDI clip moved to an audio track',
      [{ op: 'clip.set', id: 'c1', field: 'trackId', value: 't3' }],
      'kind-mismatch',
    ],
    [
      'an audio field on a MIDI clip',
      [{ op: 'clip.set', id: 'c1', field: 'gainDb', value: 1 }],
      'kind-mismatch',
    ],
    ['a note on an audio clip', [{ op: 'note.create', note: note('n9', 'c3') }], 'kind-mismatch'],
    ['an unknown op', [{ op: 'track.rename', id: 't1' } as unknown as StudioOp], 'invalid'],
    [
      'an unknown field',
      [{ op: 'track.set', id: 't1', field: 'kind', value: 'audio' } as unknown as StudioOp],
      'invalid',
    ],
  ];
  it.each(cases)('%s', (_name, ops, reason) => {
    const base = scene();
    const tail = ops.length - 1;
    const result = applyOps(base, [...ops, { op: 'project.set', field: 'tempo', value: 100 }]);
    expect(result.skipped).toEqual([{ index: tail, op: ops[tail].op, reason }]);
    // Later ops still apply.
    expect(result.applied).toEqual([...Array(tail).keys(), tail + 1]);
    expect(result.doc.tempo).toBe(100);
    expect(studioProjectSchema.safeParse(result.doc).success).toBe(true);
  });
});

describe('limits', () => {
  it('skips creates beyond the track, clip and note limits', () => {
    const tracks = Array.from({ length: MAX_TRACKS + 1 }, (_, i): StudioOp => ({
      op: 'track.create',
      track: defaultTrack(`t${i}`, 'instrument'),
    }));
    const full = apply(project(), tracks);
    expect(full.skipped).toEqual([{ index: MAX_TRACKS, op: 'track.create', reason: 'limit' }]);
    // Deleting one frees a slot.
    const again = apply(full.doc, [{ op: 'track.delete', id: 't0' }, tracks[MAX_TRACKS]]);
    expect(again.skipped).toEqual([]);

    const clips = Array.from({ length: MAX_CLIPS + 1 }, (_, i): StudioOp => ({
      op: 'clip.create',
      clip: midiClip(`c${i}`, 't1', { startBeat: i }),
    }));
    const clipResult = apply(full.doc, clips);
    expect(clipResult.skipped).toEqual([{ index: MAX_CLIPS, op: 'clip.create', reason: 'limit' }]);

    const notes = Array.from({ length: MAX_NOTES + 1 }, (_, i): StudioOp => ({
      op: 'note.create',
      note: { ...note(`n${i}`, `c${i % MAX_CLIPS}`), startBeat: (i % 64) / 4 },
    }));
    const noteResult = applyOps(clipResult.doc, notes);
    expect(noteResult.skipped).toEqual([{ index: MAX_NOTES, op: 'note.create', reason: 'limit' }]);
    expect(Object.keys(noteResult.doc.notes)).toHaveLength(MAX_NOTES);
    expect(studioProjectSchema.safeParse(noteResult.doc).success).toBe(true);
    // A track delete returns its clips' and notes' slots.
    const freed = applyOps(noteResult.doc, [
      { op: 'track.delete', id: 't1' },
      { op: 'track.create', track: defaultTrack('t1', 'instrument') },
      { op: 'clip.create', clip: midiClip('c-new', 't1') },
      { op: 'note.create', note: note('n-new', 'c-new') },
    ]);
    expect(freed.skipped).toEqual([]);
    expect(Object.keys(freed.doc.notes)).toEqual(['n-new']);
  });
});

describe('schemas', () => {
  const valid = (op: unknown) => studioOpSchema.safeParse(op).success;

  it('accepts every op shape', () => {
    for (const op of [
      { op: 'project.set', field: 'key', value: null },
      { op: 'track.create', track: defaultTrack('t1', 'audio') },
      { op: 'track.set', id: 't1', field: 'eq.mid', value: -12 },
      { op: 'track.move', id: 't1', index: 31 },
      { op: 'clip.create', clip: audioClip('c1', 't1') },
      { op: 'clip.set', id: 'c1', field: 'offsetSec', value: 3600 },
      { op: 'note.create', note: note('n1', 'c1') },
      { op: 'note.set', id: 'n1', field: 'velocity', value: 127 },
      { op: 'note.delete', id: 'n1' },
    ])
      expect(valid(op), JSON.stringify(op)).toBe(true);
  });

  it('rejects unknown fields', () => {
    expect(valid({ op: 'note.delete', id: 'n1', extra: 1 })).toBe(false);
    expect(valid({ op: 'track.create', track: { ...defaultTrack('t1', 'drums'), gain: 1 } })).toBe(
      false,
    );
    expect(valid({ op: 'note.create', note: { ...note('n1', 'c1'), channel: 1 } })).toBe(false);
    expect(valid({ op: 'track.set', id: 't1', field: 'kind', value: 'audio' })).toBe(false);
    expect(valid({ op: 'track.set', id: 't1', field: 'id', value: 't2' })).toBe(false);
    expect(valid({ op: 'note.set', id: 'n1', field: 'clipId', value: 'c2' })).toBe(false);
    expect(valid({ op: 'track.delete', id: 't1', cascade: false })).toBe(false);
    expect(studioProjectSchema.safeParse({ ...project(), extra: true }).success).toBe(false);
  });

  it('rejects out-of-range and mistyped values', () => {
    const set = (field: string, value: unknown) =>
      valid({ op: 'track.set', id: 't1', field, value });
    expect(set('volume', 1.6)).toBe(false);
    expect(set('volume', true)).toBe(false);
    expect(set('pan', -1.01)).toBe(false);
    expect(set('color', 12)).toBe(false);
    expect(set('color', 1.5)).toBe(false);
    expect(set('eq.low', 12.5)).toBe(false);
    expect(set('sends.delay', 1.1)).toBe(false);
    expect(set('instrument', 'Piano@1')).toBe(false);
    expect(set('instrument', 'piano')).toBe(false);
    expect(set('name', 'x'.repeat(41))).toBe(false);
    const projectSet = (field: string, value: unknown) =>
      valid({ op: 'project.set', field, value });
    expect(projectSet('tempo', 39)).toBe(false);
    expect(projectSet('tempo', 241)).toBe(false);
    expect(projectSet('tempo', Number.NaN)).toBe(false);
    expect(projectSet('timeSignature', { beats: 13, unit: 4 })).toBe(false);
    expect(projectSet('timeSignature', { beats: 4, unit: 3 })).toBe(false);
    expect(projectSet('name', 'x'.repeat(81))).toBe(false);
    expect(projectSet('name', ' padded')).toBe(false);
    expect(projectSet('name', '')).toBe(false);
    expect(projectSet('name', 'tab\there')).toBe(false);
    expect(projectSet('key', 'x'.repeat(17))).toBe(false);
    expect(projectSet('lengthBeats', 4097)).toBe(false);
    expect(projectSet('lengthBeats', 1.5)).toBe(false);
    const noteSet = (field: string, value: unknown) =>
      valid({ op: 'note.set', id: 'n1', field, value });
    expect(noteSet('pitch', 128)).toBe(false);
    expect(noteSet('velocity', 0)).toBe(false);
    expect(noteSet('startBeat', -0.5)).toBe(false);
    expect(noteSet('lengthBeats', 0)).toBe(false);
    expect(valid({ op: 'clip.set', id: 'c1', field: 'gainDb', value: 13 })).toBe(false);
    expect(valid({ op: 'clip.set', id: 'c1', field: 'startBeat', value: Infinity })).toBe(false);
    expect(valid({ op: 'track.move', id: 't1', index: MAX_TRACKS })).toBe(false);
  });

  it('rejects ids that are not opaque or that reach the object prototype', () => {
    for (const id of ['__proto__', 'constructor', 'prototype', '', 'a b', 'ş', 'x'.repeat(129)])
      expect(valid({ op: 'note.delete', id }), id).toBe(false);
    expect(valid({ op: 'note.delete', id: 'x'.repeat(128) })).toBe(true);
  });

  it('keeps audio fields on audio clips only', () => {
    expect(valid({ op: 'clip.create', clip: { ...midiClip('c1', 't1'), blobId: 'b' } })).toBe(
      false,
    );
    const { gainDb: _gain, ...partial } = audioClip('c1', 't1');
    expect(valid({ op: 'clip.create', clip: partial })).toBe(false);
  });

  it('validates the batch envelope', () => {
    const ops: StudioOp[] = [{ op: 'note.delete', id: 'n1' }];
    const batch = { protocolVersion: STUDIO_PROTOCOL_VERSION, batchId: randomUUID(), ops };
    expect(studioBatchSchema.safeParse(batch).success).toBe(true);
    expect(studioBatchSchema.safeParse({ ...batch, protocolVersion: 2 }).success).toBe(false);
    expect(studioBatchSchema.safeParse({ ...batch, batchId: 'not-a-uuid' }).success).toBe(false);
    expect(studioBatchSchema.safeParse({ ...batch, ops: [] }).success).toBe(false);
    expect(studioBatchSchema.safeParse({ ...batch, expectedRevision: 3 }).success).toBe(false);
    const many = Array.from({ length: MAX_BATCH_OPS + 1 }, () => ops[0]);
    expect(studioBatchSchema.safeParse({ ...batch, ops: many }).success).toBe(false);
  });

  it('rejects a batch only for its serialized size', () => {
    // Multibyte names (♪ is 3 bytes in UTF-8): valid ops under the limit by string length, over it in bytes.
    const big = Array.from({ length: MAX_BATCH_OPS }, (_, i): StudioOp => ({
      op: 'track.create',
      track: defaultTrack(`track-${i}`, 'instrument', { name: '♪'.repeat(40) }),
    }));
    const batch = { protocolVersion: STUDIO_PROTOCOL_VERSION, batchId: randomUUID(), ops: big };
    expect(JSON.stringify(batch).length).toBeLessThan(MAX_BATCH_BYTES);
    const result = studioBatchSchema.safeParse(batch);
    expect(result.success).toBe(false);
    expect(result.error?.issues.map((issue) => issue.message)).toEqual([
      `Batch larger than ${MAX_BATCH_BYTES} bytes`,
    ]);
    const chunks = chunkOps(big);
    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks.flat()).toEqual(big);
    for (const chunk of chunks)
      expect(
        studioBatchSchema.safeParse({ ...batch, batchId: randomUUID(), ops: chunk }).success,
      ).toBe(true);
  });

  it('chunks long op lists by count', () => {
    const ops = Array.from({ length: 450 }, (_, i): StudioOp => ({
      op: 'note.delete',
      id: `n${i}`,
    }));
    expect(chunkOps(ops).map((chunk) => chunk.length)).toEqual([200, 200, 50]);
    expect(chunkOps([])).toEqual([]);
  });

  it('rejects inconsistent documents on load', () => {
    const doc = scene();
    const broken: Array<Partial<StudioProject>> = [
      { tracks: { ...doc.tracks, other: doc.tracks.t1 } },
      { trackOrder: ['t1', 't2'] },
      { trackOrder: ['t1', 't2', 't3', 't1'] },
      { clips: { ...doc.clips, c9: midiClip('c9', 'gone') } },
      { clips: { ...doc.clips, c9: midiClip('c9', 't3') } },
      { notes: { ...doc.notes, n9: note('n9', 'gone') } },
      { notes: { ...doc.notes, n9: note('n9', 'c3') } },
    ];
    expect(studioProjectSchema.safeParse(doc).success).toBe(true);
    for (const patch of broken)
      expect(
        studioProjectSchema.safeParse({ ...doc, ...patch }).success,
        JSON.stringify(Object.keys(patch)),
      ).toBe(false);
  });
});
