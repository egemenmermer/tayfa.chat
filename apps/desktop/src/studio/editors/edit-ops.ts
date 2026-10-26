import {
  clipFitsTrack,
  type StudioClip,
  type StudioNote,
  type StudioOp,
  type StudioProject,
} from '@rooms/studio';
import { barBeats, clamp, minLength, snap, STEP_BEATS, type SnapId } from './grid';

// Gesture → op mapping. Pure: every editor gesture ends in exactly one of these calls and one
// `port.dispatch`. Only changed fields are emitted, ids come from the injected generator.

export type NewId = () => string;

const EPSILON = 1e-6;
const MAX_PITCH = 127;
export const DEFAULT_VELOCITY = 100;
export const ACCENT_VELOCITY = 127;
/** A step at or above this velocity shows as accented. */
export const ACCENT_THRESHOLD = 115;

const notesCache = new WeakMap<StudioProject, Map<string, StudioNote[]>>();

/** Notes grouped by clip, sorted by start; cached per document object. */
export function notesByClip(doc: StudioProject): Map<string, StudioNote[]> {
  const cached = notesCache.get(doc);
  if (cached) return cached;
  const map = new Map<string, StudioNote[]>();
  for (const note of Object.values(doc.notes)) {
    const list = map.get(note.clipId);
    if (list) list.push(note);
    else map.set(note.clipId, [note]);
  }
  for (const list of map.values())
    list.sort((a, b) => a.startBeat - b.startBeat || a.pitch - b.pitch);
  notesCache.set(doc, map);
  return map;
}

export function clipNotes(doc: StudioProject, clipId: string): StudioNote[] {
  return notesByClip(doc).get(clipId) ?? [];
}

const fixed = (value: number) => Number(value.toFixed(6));
const existing = <T>(record: Record<string, T>, ids: Iterable<string>): T[] =>
  [...ids].filter((id) => Object.hasOwn(record, id)).map((id) => record[id]);

/** Snaps the anchor's new start and returns the delta every selected item moves by. */
export function snappedDelta(anchorStart: number, rawDelta: number, snapId: SnapId): number {
  return fixed(snap(anchorStart + rawDelta, snapId) - anchorStart);
}

// ---- Clips ----

/** A new empty MIDI clip; nothing on audio lanes (recording arrives in P2). */
export function createClipOps(
  doc: StudioProject,
  trackId: string,
  startBeat: number,
  lengthBeats: number,
  newId: NewId,
): StudioOp[] {
  const track = doc.tracks[trackId];
  if (!track || !clipFitsTrack('midi', track.kind) || lengthBeats <= 0) return [];
  const clip: StudioClip = {
    id: newId(),
    trackId,
    startBeat: fixed(Math.max(0, startBeat)),
    lengthBeats: fixed(lengthBeats),
    name: '',
    kind: 'midi',
  };
  return [{ op: 'clip.create', clip }];
}

/** Track a clip lands on after moving `laneDelta` lanes; stays put when the kind does not fit. */
function targetTrack(doc: StudioProject, clip: StudioClip, laneDelta: number): string {
  if (!laneDelta) return clip.trackId;
  const index = doc.trackOrder.indexOf(clip.trackId);
  if (index < 0) return clip.trackId;
  const target = doc.trackOrder[clamp(index + laneDelta, 0, doc.trackOrder.length - 1)];
  const track = doc.tracks[target];
  return track && clipFitsTrack(clip.kind, track.kind) ? target : clip.trackId;
}

/**
 * Moves (or, with `duplicate`, copies) clips by a beat delta and a lane delta. The delta is clamped so
 * no clip starts before 0. A copy carries copies of all its notes.
 */
export function moveClipsOps(
  doc: StudioProject,
  clipIds: Iterable<string>,
  deltaBeats: number,
  laneDelta: number,
  duplicate: boolean,
  newId: NewId,
): StudioOp[] {
  const clips = existing(doc.clips, clipIds);
  if (!clips.length) return [];
  const delta = Math.max(deltaBeats, -Math.min(...clips.map((clip) => clip.startBeat)));
  const ops: StudioOp[] = [];
  for (const clip of clips) {
    const startBeat = fixed(clip.startBeat + delta);
    const trackId = targetTrack(doc, clip, laneDelta);
    if (duplicate) {
      const copy: StudioClip = { ...clip, id: newId(), startBeat, trackId };
      ops.push({ op: 'clip.create', clip: copy });
      for (const note of clipNotes(doc, clip.id))
        ops.push({ op: 'note.create', note: { ...note, id: newId(), clipId: copy.id } });
      continue;
    }
    if (Math.abs(startBeat - clip.startBeat) > EPSILON)
      ops.push({ op: 'clip.set', id: clip.id, field: 'startBeat', value: startBeat });
    if (trackId !== clip.trackId)
      ops.push({ op: 'clip.set', id: clip.id, field: 'trackId', value: trackId });
  }
  return ops;
}

/** Right-edge resize: the snapped end moves by `deltaBeats`; never shorter than one grid cell. */
export function resizeClipsOps(
  doc: StudioProject,
  clipIds: Iterable<string>,
  deltaBeats: number,
  snapId: SnapId,
): StudioOp[] {
  const ops: StudioOp[] = [];
  for (const clip of existing(doc.clips, clipIds)) {
    const end = snap(clip.startBeat + clip.lengthBeats + deltaBeats, snapId);
    const lengthBeats = fixed(Math.max(minLength(snapId), end - clip.startBeat));
    if (Math.abs(lengthBeats - clip.lengthBeats) > EPSILON)
      ops.push({ op: 'clip.set', id: clip.id, field: 'lengthBeats', value: lengthBeats });
  }
  return ops;
}

export function deleteClipsOps(doc: StudioProject, clipIds: Iterable<string>): StudioOp[] {
  return existing(doc.clips, clipIds).map((clip) => ({ op: 'clip.delete', id: clip.id }));
}

/** Copies the clips right after the selection (Cmd/Ctrl+D). */
export function duplicateClipsOps(
  doc: StudioProject,
  clipIds: Iterable<string>,
  newId: NewId,
): StudioOp[] {
  const clips = existing(doc.clips, clipIds);
  if (!clips.length) return [];
  const start = Math.min(...clips.map((clip) => clip.startBeat));
  const end = Math.max(...clips.map((clip) => clip.startBeat + clip.lengthBeats));
  return moveClipsOps(doc, clipIds, end - start, 0, true, newId);
}

// ---- Notes ----

export function createNoteOps(
  clipId: string,
  pitch: number,
  startBeat: number,
  lengthBeats: number,
  velocity: number,
  newId: NewId,
): StudioOp[] {
  return [
    {
      op: 'note.create',
      note: {
        id: newId(),
        clipId,
        pitch: clamp(Math.round(pitch), 0, MAX_PITCH),
        startBeat: fixed(Math.max(0, startBeat)),
        lengthBeats: fixed(Math.max(EPSILON * 10, lengthBeats)),
        velocity: clamp(Math.round(velocity), 1, 127),
      },
    },
  ];
}

/** Clamps a move so every selected note stays at start ≥ 0 and pitch 0–127. */
export function clampNoteDelta(
  notes: readonly StudioNote[],
  deltaBeats: number,
  deltaPitch: number,
): { deltaBeats: number; deltaPitch: number } {
  if (!notes.length) return { deltaBeats: 0, deltaPitch: 0 };
  const minStart = Math.min(...notes.map((note) => note.startBeat));
  const minPitch = Math.min(...notes.map((note) => note.pitch));
  const maxPitch = Math.max(...notes.map((note) => note.pitch));
  return {
    deltaBeats: Math.max(deltaBeats, -minStart),
    deltaPitch: clamp(Math.round(deltaPitch), -minPitch, MAX_PITCH - maxPitch),
  };
}

export function moveNotesOps(
  doc: StudioProject,
  noteIds: Iterable<string>,
  deltaBeats: number,
  deltaPitch: number,
  duplicate: boolean,
  newId: NewId,
): StudioOp[] {
  const notes = existing(doc.notes, noteIds);
  const delta = clampNoteDelta(notes, deltaBeats, deltaPitch);
  const ops: StudioOp[] = [];
  for (const note of notes) {
    const startBeat = fixed(note.startBeat + delta.deltaBeats);
    const pitch = note.pitch + delta.deltaPitch;
    if (duplicate) {
      ops.push({ op: 'note.create', note: { ...note, id: newId(), startBeat, pitch } });
      continue;
    }
    if (Math.abs(startBeat - note.startBeat) > EPSILON)
      ops.push({ op: 'note.set', id: note.id, field: 'startBeat', value: startBeat });
    if (pitch !== note.pitch)
      ops.push({ op: 'note.set', id: note.id, field: 'pitch', value: pitch });
  }
  return ops;
}

/** Right-edge resize of notes; the end snaps, the length never drops below one grid cell. */
export function resizeNotesOps(
  doc: StudioProject,
  noteIds: Iterable<string>,
  deltaBeats: number,
  snapId: SnapId,
): StudioOp[] {
  const ops: StudioOp[] = [];
  for (const note of existing(doc.notes, noteIds)) {
    const end = snap(note.startBeat + note.lengthBeats + deltaBeats, snapId);
    const lengthBeats = fixed(Math.max(minLength(snapId), end - note.startBeat));
    if (Math.abs(lengthBeats - note.lengthBeats) > EPSILON)
      ops.push({ op: 'note.set', id: note.id, field: 'lengthBeats', value: lengthBeats });
  }
  return ops;
}

/** Sets velocity (1–127) on the notes; `relative` adds the value instead. */
export function velocityOps(
  doc: StudioProject,
  noteIds: Iterable<string>,
  value: number,
  relative = false,
): StudioOp[] {
  const ops: StudioOp[] = [];
  for (const note of existing(doc.notes, noteIds)) {
    const velocity = clamp(Math.round(relative ? note.velocity + value : value), 1, 127);
    if (velocity !== note.velocity)
      ops.push({ op: 'note.set', id: note.id, field: 'velocity', value: velocity });
  }
  return ops;
}

export function deleteNotesOps(doc: StudioProject, noteIds: Iterable<string>): StudioOp[] {
  return existing(doc.notes, noteIds).map((note) => ({ op: 'note.delete', id: note.id }));
}

/** Copies the notes right after the selection's span. */
export function duplicateNotesOps(
  doc: StudioProject,
  noteIds: Iterable<string>,
  newId: NewId,
): StudioOp[] {
  const notes = existing(doc.notes, noteIds);
  if (!notes.length) return [];
  const start = Math.min(...notes.map((note) => note.startBeat));
  const end = Math.max(...notes.map((note) => note.startBeat + note.lengthBeats));
  return moveNotesOps(doc, noteIds, end - start, 0, true, newId);
}

export interface NoteClipboard {
  /** Offsets relative to the earliest copied note. */
  notes: { pitch: number; offset: number; lengthBeats: number; velocity: number }[];
  span: number;
}

export function copyNotes(doc: StudioProject, noteIds: Iterable<string>): NoteClipboard | null {
  const notes = existing(doc.notes, noteIds);
  if (!notes.length) return null;
  const start = Math.min(...notes.map((note) => note.startBeat));
  const end = Math.max(...notes.map((note) => note.startBeat + note.lengthBeats));
  return {
    span: fixed(end - start),
    notes: notes.map((note) => ({
      pitch: note.pitch,
      offset: fixed(note.startBeat - start),
      lengthBeats: note.lengthBeats,
      velocity: note.velocity,
    })),
  };
}

/** Pastes the clipboard into a clip with its earliest note at `atBeat` (clip-relative). */
export function pasteNotesOps(
  clipId: string,
  clipboard: NoteClipboard,
  atBeat: number,
  newId: NewId,
): { ops: StudioOp[]; ids: string[] } {
  const ops: StudioOp[] = [];
  const ids: string[] = [];
  for (const item of clipboard.notes) {
    const [op] = createNoteOps(
      clipId,
      item.pitch,
      atBeat + item.offset,
      item.lengthBeats,
      item.velocity,
      newId,
    );
    if (op.op === 'note.create') ids.push(op.note.id);
    ops.push(op);
  }
  return { ops, ids };
}

// ---- Drum steps (a view of the same notes) ----

export function stepsPerBar(signature: StudioProject['timeSignature']): number {
  return Math.round(barBeats(signature) / STEP_BEATS);
}

export function stepCount(clip: StudioClip): number {
  return Math.max(1, Math.ceil(clip.lengthBeats / STEP_BEATS - EPSILON));
}

/** The step cell a note belongs to: the step at or before its start. */
export function stepOf(note: StudioNote): number {
  return Math.floor(note.startBeat / STEP_BEATS + EPSILON);
}

/** `pitch:step` → notes in that cell, for one clip. */
export function stepCells(notes: readonly StudioNote[]): Map<string, StudioNote[]> {
  const cells = new Map<string, StudioNote[]>();
  for (const note of notes) {
    const key = `${note.pitch}:${stepOf(note)}`;
    const list = cells.get(key);
    if (list) list.push(note);
    else cells.set(key, [note]);
  }
  return cells;
}

/**
 * Sets cells on or off in one batch (a click or a paint drag). On creates a sixteenth at the step
 * when the cell is empty; off deletes every note of that pitch in the cell.
 */
export function setStepsOps(
  doc: StudioProject,
  clipId: string,
  cells: readonly { pitch: number; step: number }[],
  on: boolean,
  newId: NewId,
  velocity = DEFAULT_VELOCITY,
): StudioOp[] {
  const index = stepCells(clipNotes(doc, clipId));
  const ops: StudioOp[] = [];
  const seen = new Set<string>();
  for (const { pitch, step } of cells) {
    const key = `${pitch}:${step}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const present = index.get(key) ?? [];
    if (on && !present.length)
      ops.push(...createNoteOps(clipId, pitch, step * STEP_BEATS, STEP_BEATS, velocity, newId));
    if (!on) for (const note of present) ops.push({ op: 'note.delete', id: note.id });
  }
  return ops;
}

/** Toggles the accent of a filled cell: accented → normal velocity, otherwise → accent velocity. */
export function toggleAccentOps(
  doc: StudioProject,
  clipId: string,
  pitch: number,
  step: number,
): StudioOp[] {
  const present = stepCells(clipNotes(doc, clipId)).get(`${pitch}:${step}`) ?? [];
  if (!present.length) return [];
  const accented = present.some((note) => note.velocity >= ACCENT_THRESHOLD);
  return velocityOps(
    doc,
    present.map((note) => note.id),
    accented ? DEFAULT_VELOCITY : ACCENT_VELOCITY,
  );
}
