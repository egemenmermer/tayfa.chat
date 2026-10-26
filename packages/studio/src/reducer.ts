import { MAX_CLIPS, MAX_NOTES, MAX_TRACKS } from './limits';
import {
  clipFitsTrack,
  type StudioClip,
  type StudioNote,
  type StudioProject,
  type StudioTrack,
} from './model';
import type { ClipSetOp, NoteSetOp, ProjectSetOp, StudioOp, TrackSetOp } from './ops';

/**
 * Why an op had no effect. Skips are normal under concurrency (someone deleted the target first) and are reported,
 * never thrown:
 * - `missing-target`: the entity to edit, move or delete does not exist (never created or already deleted);
 * - `exists`: a create reuses an id that is present;
 * - `missing-track` / `missing-clip`: the parent of a new or moved clip / new note does not exist;
 * - `kind-mismatch`: a clip on a track of the wrong kind, a note on an audio clip, an audio field on a MIDI clip;
 * - `limit`: the create would exceed MAX_TRACKS / MAX_CLIPS / MAX_NOTES;
 * - `invalid`: not a known op or field (only reachable without schema validation).
 */
export type StudioSkipReason =
  | 'missing-target'
  | 'exists'
  | 'missing-track'
  | 'missing-clip'
  | 'kind-mismatch'
  | 'limit'
  | 'invalid';

export interface StudioSkip {
  /** Position of the op in the list given to `applyOps`. */
  index: number;
  op: string;
  reason: StudioSkipReason;
}

export interface StudioApplyResult {
  /** The new document; the input itself when nothing applied. */
  doc: StudioProject;
  /** Indexes of the ops that took effect, in order. */
  applied: number[];
  skipped: StudioSkip[];
}

const has = (record: object, id: string) => Object.hasOwn(record, id);

/** Reads a settable track field (`sends.*` and `eq.*` are leaves of nested objects). */
export function readTrackField(track: StudioTrack, field: TrackSetOp['field']): TrackSetOp['value'] {
  switch (field) {
    case 'sends.reverb':
      return track.sends.reverb;
    case 'sends.delay':
      return track.sends.delay;
    case 'eq.low':
      return track.eq.low;
    case 'eq.mid':
      return track.eq.mid;
    case 'eq.high':
      return track.eq.high;
    default:
      return track[field];
  }
}

function writeTrackField(track: StudioTrack, op: TrackSetOp): StudioTrack {
  switch (op.field) {
    case 'sends.reverb':
      return { ...track, sends: { ...track.sends, reverb: op.value } };
    case 'sends.delay':
      return { ...track, sends: { ...track.sends, delay: op.value } };
    case 'eq.low':
      return { ...track, eq: { ...track.eq, low: op.value } };
    case 'eq.mid':
      return { ...track, eq: { ...track.eq, mid: op.value } };
    case 'eq.high':
      return { ...track, eq: { ...track.eq, high: op.value } };
    default:
      // The schema pairs each top-level field with a value of that field's type.
      return { ...track, [op.field]: op.value } as StudioTrack;
  }
}

function copyTrack(track: StudioTrack): StudioTrack {
  return { ...track, sends: { ...track.sends }, eq: { ...track.eq } };
}

/**
 * Applies ops one by one to a private copy of the document. Maps are copied on their first write and entities are
 * replaced, never changed, so the input document and everything it shares stay untouched and an entity read from
 * `view` before an `apply` keeps its old value.
 */
export class StudioDraft {
  private project: StudioProject;
  private readonly copied = {
    root: false,
    tracks: false,
    trackOrder: false,
    clips: false,
    notes: false,
  };
  private readonly counts: { tracks: number; clips: number; notes: number };

  constructor(private readonly base: StudioProject) {
    this.project = base;
    this.counts = {
      tracks: Object.keys(base.tracks).length,
      clips: Object.keys(base.clips).length,
      notes: Object.keys(base.notes).length,
    };
  }

  /** The current state. Read it before the next `apply`; later applies may change its maps in place. */
  get view(): StudioProject {
    return this.project;
  }

  /** Applies one op; returns why it was skipped, or null when it took effect. */
  apply(op: StudioOp): StudioSkipReason | null {
    switch (op.op) {
      case 'project.set':
        return this.setProject(op);
      case 'track.create': {
        const { id } = op.track;
        if (has(this.project.tracks, id)) return 'exists';
        if (this.counts.tracks >= MAX_TRACKS) return 'limit';
        this.tracks()[id] = copyTrack(op.track);
        this.trackOrder().push(id);
        this.counts.tracks += 1;
        return null;
      }
      case 'track.set': {
        if (!has(this.project.tracks, op.id)) return 'missing-target';
        if (!isTrackField(op.field)) return 'invalid';
        this.tracks()[op.id] = writeTrackField(this.project.tracks[op.id], op);
        return null;
      }
      case 'track.delete': {
        if (!has(this.project.tracks, op.id)) return 'missing-target';
        delete this.tracks()[op.id];
        const project = this.root();
        project.trackOrder = project.trackOrder.filter((id) => id !== op.id);
        this.copied.trackOrder = true;
        this.counts.tracks -= 1;
        const clipIds = Object.values(this.project.clips)
          .filter((clip) => clip.trackId === op.id)
          .map((clip) => clip.id);
        this.deleteClips(new Set(clipIds));
        return null;
      }
      case 'track.move': {
        if (!has(this.project.tracks, op.id)) return 'missing-target';
        const order = this.trackOrder();
        order.splice(order.indexOf(op.id), 1);
        order.splice(Math.min(Math.max(op.index, 0), order.length), 0, op.id);
        return null;
      }
      case 'clip.create': {
        const { id, trackId, kind } = op.clip;
        if (has(this.project.clips, id)) return 'exists';
        if (!has(this.project.tracks, trackId)) return 'missing-track';
        if (!clipFitsTrack(kind, this.project.tracks[trackId].kind)) return 'kind-mismatch';
        if (this.counts.clips >= MAX_CLIPS) return 'limit';
        this.clips()[id] = { ...op.clip };
        this.counts.clips += 1;
        return null;
      }
      case 'clip.set':
        return this.setClip(op);
      case 'clip.delete': {
        if (!has(this.project.clips, op.id)) return 'missing-target';
        this.deleteClips(new Set([op.id]));
        return null;
      }
      case 'note.create': {
        const { id, clipId } = op.note;
        if (has(this.project.notes, id)) return 'exists';
        if (!has(this.project.clips, clipId)) return 'missing-clip';
        if (this.project.clips[clipId].kind !== 'midi') return 'kind-mismatch';
        if (this.counts.notes >= MAX_NOTES) return 'limit';
        this.notes()[id] = { ...op.note };
        this.counts.notes += 1;
        return null;
      }
      case 'note.set':
        return this.setNote(op);
      case 'note.delete': {
        if (!has(this.project.notes, op.id)) return 'missing-target';
        delete this.notes()[op.id];
        this.counts.notes -= 1;
        return null;
      }
      default:
        return 'invalid';
    }
  }

  /** The resulting document (the base document itself when nothing changed). */
  finish(): StudioProject {
    return this.project;
  }

  private setProject(op: ProjectSetOp): StudioSkipReason | null {
    if (!PROJECT_FIELDS.has(op.field)) return 'invalid';
    const project = this.root();
    switch (op.field) {
      case 'name':
        project.name = op.value;
        break;
      case 'tempo':
        project.tempo = op.value;
        break;
      case 'timeSignature':
        project.timeSignature = { ...op.value };
        break;
      case 'key':
        // JSON has no undefined: null clears the key, and the property is removed rather than left undefined.
        if (op.value === null) delete project.key;
        else project.key = op.value;
        break;
      case 'lengthBeats':
        project.lengthBeats = op.value;
        break;
    }
    return null;
  }

  private setClip(op: ClipSetOp): StudioSkipReason | null {
    if (!has(this.project.clips, op.id)) return 'missing-target';
    const clip = this.project.clips[op.id];
    switch (op.field) {
      case 'trackId':
        if (!has(this.project.tracks, op.value)) return 'missing-track';
        if (!clipFitsTrack(clip.kind, this.project.tracks[op.value].kind)) return 'kind-mismatch';
        break;
      case 'offsetSec':
      case 'gainDb':
        if (clip.kind !== 'audio') return 'kind-mismatch';
        break;
      case 'name':
      case 'startBeat':
      case 'lengthBeats':
        break;
      default:
        return 'invalid';
    }
    this.clips()[op.id] = { ...clip, [op.field]: op.value } as StudioClip;
    return null;
  }

  private setNote(op: NoteSetOp): StudioSkipReason | null {
    if (!has(this.project.notes, op.id)) return 'missing-target';
    if (!NOTE_FIELDS.has(op.field)) return 'invalid';
    this.notes()[op.id] = { ...this.project.notes[op.id], [op.field]: op.value } as StudioNote;
    return null;
  }

  /** Deletes the clips and every note on them. */
  private deleteClips(ids: Set<string>): void {
    if (!ids.size) return;
    const clips = this.clips();
    for (const id of ids) delete clips[id];
    this.counts.clips -= ids.size;
    const noteIds = Object.values(this.project.notes)
      .filter((note) => ids.has(note.clipId))
      .map((note) => note.id);
    if (!noteIds.length) return;
    const notes = this.notes();
    for (const id of noteIds) delete notes[id];
    this.counts.notes -= noteIds.length;
  }

  private root(): StudioProject {
    if (!this.copied.root) {
      this.project = { ...this.base };
      this.copied.root = true;
    }
    return this.project;
  }

  private tracks(): Record<string, StudioTrack> {
    const project = this.root();
    if (!this.copied.tracks) {
      project.tracks = { ...project.tracks };
      this.copied.tracks = true;
    }
    return project.tracks;
  }

  private trackOrder(): string[] {
    const project = this.root();
    if (!this.copied.trackOrder) {
      project.trackOrder = [...project.trackOrder];
      this.copied.trackOrder = true;
    }
    return project.trackOrder;
  }

  private clips(): Record<string, StudioClip> {
    const project = this.root();
    if (!this.copied.clips) {
      project.clips = { ...project.clips };
      this.copied.clips = true;
    }
    return project.clips;
  }

  private notes(): Record<string, StudioNote> {
    const project = this.root();
    if (!this.copied.notes) {
      project.notes = { ...project.notes };
      this.copied.notes = true;
    }
    return project.notes;
  }
}

const PROJECT_FIELDS = new Set<string>([
  'name',
  'tempo',
  'timeSignature',
  'key',
  'lengthBeats',
] satisfies ProjectSetOp['field'][]);
const TRACK_FIELDS = new Set<string>([
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
] satisfies TrackSetOp['field'][]);
const NOTE_FIELDS = new Set<string>([
  'pitch',
  'startBeat',
  'lengthBeats',
  'velocity',
] satisfies NoteSetOp['field'][]);
function isTrackField(field: string): boolean {
  return TRACK_FIELDS.has(field);
}

/**
 * Applies ops in order with field-level last-writer-wins. Pure and deterministic: the input is never changed, and
 * the server and every client reach the same document from the same ops. Ops are expected to have passed
 * `studioOpSchema`; ops that cannot apply to the current state are skipped, not thrown (see StudioSkipReason).
 */
export function applyOps(doc: StudioProject, ops: readonly StudioOp[]): StudioApplyResult {
  const draft = new StudioDraft(doc);
  const applied: number[] = [];
  const skipped: StudioSkip[] = [];
  ops.forEach((op, index) => {
    const reason = draft.apply(op);
    if (reason) skipped.push({ index, op: String(op.op), reason });
    else applied.push(index);
  });
  return { doc: draft.finish(), applied, skipped };
}
