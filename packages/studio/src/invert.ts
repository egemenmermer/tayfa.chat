import type { StudioProject } from './model';
import type { StudioOp } from './ops';
import { readTrackField, StudioDraft } from './reducer';

const has = (record: object, id: string) => Object.hasOwn(record, id);

/**
 * Ops that undo `op` when applied right after it, read from the state just before `op`. Returns [] when the target
 * is missing: such an op is skipped and needs no undo.
 */
function inverseOf(doc: StudioProject, op: StudioOp): StudioOp[] {
  switch (op.op) {
    case 'project.set':
      switch (op.field) {
        case 'name':
          return [{ op: 'project.set', field: 'name', value: doc.name }];
        case 'tempo':
          return [{ op: 'project.set', field: 'tempo', value: doc.tempo }];
        case 'timeSignature':
          return [{ op: 'project.set', field: 'timeSignature', value: { ...doc.timeSignature } }];
        case 'key':
          return [{ op: 'project.set', field: 'key', value: doc.key ?? null }];
        case 'lengthBeats':
          return [{ op: 'project.set', field: 'lengthBeats', value: doc.lengthBeats }];
        default:
          return [];
      }
    case 'track.create':
      return [{ op: 'track.delete', id: op.track.id }];
    case 'track.set':
      if (!has(doc.tracks, op.id)) return [];
      return [{ ...op, value: readTrackField(doc.tracks[op.id], op.field) } as StudioOp];
    case 'track.delete': {
      if (!has(doc.tracks, op.id)) return [];
      // Parents first: the track at its old position, then its clips, then their notes.
      const track = doc.tracks[op.id];
      const clips = Object.values(doc.clips).filter((clip) => clip.trackId === op.id);
      return [
        { op: 'track.create', track },
        { op: 'track.move', id: op.id, index: doc.trackOrder.indexOf(op.id) },
        ...clips.map((clip): StudioOp => ({ op: 'clip.create', clip })),
        ...notesOf(doc, new Set(clips.map((clip) => clip.id))),
      ];
    }
    case 'track.move':
      if (!has(doc.tracks, op.id)) return [];
      return [{ op: 'track.move', id: op.id, index: doc.trackOrder.indexOf(op.id) }];
    case 'clip.create':
      return [{ op: 'clip.delete', id: op.clip.id }];
    case 'clip.set':
      if (!has(doc.clips, op.id)) return [];
      return [{ ...op, value: doc.clips[op.id][op.field] } as StudioOp];
    case 'clip.delete':
      if (!has(doc.clips, op.id)) return [];
      return [{ op: 'clip.create', clip: doc.clips[op.id] }, ...notesOf(doc, new Set([op.id]))];
    case 'note.create':
      return [{ op: 'note.delete', id: op.note.id }];
    case 'note.set':
      if (!has(doc.notes, op.id)) return [];
      return [{ ...op, value: doc.notes[op.id][op.field] } as StudioOp];
    case 'note.delete':
      if (!has(doc.notes, op.id)) return [];
      return [{ op: 'note.create', note: doc.notes[op.id] }];
    default:
      return [];
  }
}

function notesOf(doc: StudioProject, clipIds: Set<string>): StudioOp[] {
  return Object.values(doc.notes)
    .filter((note) => clipIds.has(note.clipId))
    .map((note) => ({ op: 'note.create', note }));
}

/**
 * Ops that undo `ops` applied to `docBefore` (a user's local undo step): applying them to
 * `applyOps(docBefore, ops).doc` gives back `docBefore`. Skipped ops need no undo and get none. The result can be
 * longer than one batch allows (undoing a track delete re-creates its notes); send it with `chunkOps`.
 */
export function invertOps(docBefore: StudioProject, ops: readonly StudioOp[]): StudioOp[] {
  const draft = new StudioDraft(docBefore);
  const groups: StudioOp[][] = [];
  for (const op of ops) {
    // Read before applying: the draft replaces entities but may change its maps in place.
    const inverse = inverseOf(draft.view, op);
    if (draft.apply(op) === null) groups.push(inverse);
  }
  // Undo the last op first; each group keeps its own order (a parent before its children).
  return groups.reverse().flat();
}
