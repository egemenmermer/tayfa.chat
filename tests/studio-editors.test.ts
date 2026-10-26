import { describe, expect, it } from 'vitest';
import { applyOps, createProject, defaultTrack, type StudioProject } from '@rooms/studio';
import {
  barBeats,
  formatPosition,
  newNoteLength,
  noteName,
  snap,
  snapFloor,
} from '../apps/desktop/src/studio/editors/grid';
import {
  ACCENT_VELOCITY,
  clipNotes,
  copyNotes,
  createClipOps,
  deleteClipsOps,
  duplicateClipsOps,
  duplicateNotesOps,
  moveClipsOps,
  moveNotesOps,
  pasteNotesOps,
  resizeClipsOps,
  resizeNotesOps,
  setStepsOps,
  snappedDelta as gridDelta,
  stepCount,
  stepsPerBar,
  toggleAccentOps,
  velocityOps,
} from '../apps/desktop/src/studio/editors/edit-ops';
import { FakeEditorStore } from '../apps/desktop/src/studio/editors/fake-port';
import { editorCommand, isTypingTarget } from '../apps/desktop/src/studio/editors/shortcuts';

function ids(prefix = 'n') {
  let next = 0;
  return () => `${prefix}${(next += 1)}`;
}

/** drums-bass template plus an audio track: tracks tpl-drums, tpl-bass, audio. */
function project(): StudioProject {
  const doc = createProject({
    id: 'p1',
    roomId: 'r1',
    name: 'Demo',
    createdBy: 'u1',
    createdAt: 1,
    template: 'drums-bass',
  });
  return applyOps(doc, [{ op: 'track.create', track: defaultTrack('audio', 'audio') }]).doc;
}

function store(doc = project()) {
  return new FakeEditorStore(doc);
}

const key = (k: string, extra: Partial<Parameters<typeof editorCommand>[0]> = {}) => ({
  key: k,
  metaKey: false,
  ctrlKey: false,
  shiftKey: false,
  altKey: false,
  target: null,
  ...extra,
});

describe('grid math', () => {
  it('snaps to quarter, eighth, sixteenth and free resolution', () => {
    expect(snap(1.4, '1/4')).toBe(1);
    expect(snap(1.4, '1/8')).toBe(1.5);
    expect(snap(1.4, '1/16')).toBe(1.5);
    expect(snap(1.33, '1/16')).toBe(1.25);
    expect(snap(1.333, 'off')).toBeCloseTo(1.333, 1);
    expect(snapFloor(1.99, '1/4')).toBe(1);
    expect(newNoteLength('off')).toBe(0.25);
  });

  it('counts bars in quarter-note beats (6/8 = 3 beats)', () => {
    expect(barBeats({ beats: 4, unit: 4 })).toBe(4);
    expect(barBeats({ beats: 6, unit: 8 })).toBe(3);
    expect(formatPosition(4.5, { beats: 4, unit: 4 })).toBe('2.1');
    expect(formatPosition(3.5, { beats: 6, unit: 8 })).toBe('2.2');
    expect(noteName(60)).toBe('C4');
    expect(noteName(61)).toBe('C#4');
  });

  it('snaps the anchor, not the delta', () => {
    expect(gridDelta(0.25, 1.1, '1/4')).toBe(0.75);
  });
});

describe('arrangement gestures → ops', () => {
  it('creates a MIDI clip on instrument lanes only', () => {
    const s = store();
    const ops = createClipOps(s.doc, 'tpl-bass', 16, 4, ids('c'));
    expect(ops).toEqual([
      {
        op: 'clip.create',
        clip: { id: 'c1', trackId: 'tpl-bass', startBeat: 16, lengthBeats: 4, name: '', kind: 'midi' },
      },
    ]);
    expect(createClipOps(s.doc, 'audio', 0, 4, ids('c'))).toEqual([]);
    s.dispatch(ops);
    expect(s.doc.clips.c1.startBeat).toBe(16);
    expect(s.skipped).toEqual([]);
  });

  it('moves a clip by a snapped delta and onto a fitting lane, in one batch', () => {
    const s = store();
    const ops = moveClipsOps(s.doc, ['tpl-bass-clip'], gridDelta(0, 4.3, '1/4'), -1, false, ids());
    expect(ops).toEqual([
      { op: 'clip.set', id: 'tpl-bass-clip', field: 'startBeat', value: 4 },
      { op: 'clip.set', id: 'tpl-bass-clip', field: 'trackId', value: 'tpl-drums' },
    ]);
    s.dispatch(ops);
    expect(s.batches).toHaveLength(1);
    expect(s.doc.clips['tpl-bass-clip']).toMatchObject({ startBeat: 4, trackId: 'tpl-drums' });
  });

  it('keeps the track when the target lane is an audio track and clamps at 0', () => {
    const s = store();
    const ops = moveClipsOps(s.doc, ['tpl-bass-clip'], -8, 1, false, ids());
    expect(ops).toEqual([]);
  });

  it('alt-drag duplicates the clip with all of its notes', () => {
    const s = store();
    const notes = clipNotes(s.doc, 'tpl-drums-clip').length;
    const ops = moveClipsOps(s.doc, ['tpl-drums-clip'], 16, 0, true, ids('x'));
    expect(ops[0]).toMatchObject({ op: 'clip.create', clip: { id: 'x1', startBeat: 16 } });
    expect(ops).toHaveLength(1 + notes);
    s.dispatch(ops);
    expect(clipNotes(s.doc, 'x1')).toHaveLength(notes);
    expect(s.skipped).toEqual([]);
  });

  it('resizes from the right edge to the grid with a minimum of one cell', () => {
    const s = store();
    expect(resizeClipsOps(s.doc, ['tpl-bass-clip'], 1.3, '1/4')).toEqual([
      { op: 'clip.set', id: 'tpl-bass-clip', field: 'lengthBeats', value: 17 },
    ]);
    expect(resizeClipsOps(s.doc, ['tpl-bass-clip'], -40, '1/8')).toEqual([
      { op: 'clip.set', id: 'tpl-bass-clip', field: 'lengthBeats', value: 0.5 },
    ]);
  });

  it('deletes and duplicates selected clips after the selection', () => {
    const s = store();
    expect(deleteClipsOps(s.doc, ['tpl-bass-clip', 'missing'])).toEqual([
      { op: 'clip.delete', id: 'tpl-bass-clip' },
    ]);
    const dup = duplicateClipsOps(s.doc, ['tpl-bass-clip'], ids('d'));
    expect(dup[0]).toMatchObject({ op: 'clip.create', clip: { startBeat: 16, trackId: 'tpl-bass' } });
  });
});

describe('piano roll gestures → ops', () => {
  it('moves notes in time and pitch, clamped to the valid range', () => {
    const s = store();
    const [first] = clipNotes(s.doc, 'tpl-bass-clip');
    const ops = moveNotesOps(s.doc, [first.id], -5, 200, false, ids());
    expect(ops).toEqual([{ op: 'note.set', id: first.id, field: 'pitch', value: 127 }]);
    s.dispatch(moveNotesOps(s.doc, [first.id], 0.5, -2, false, ids()));
    expect(s.doc.notes[first.id]).toMatchObject({ startBeat: 0.5, pitch: first.pitch - 2 });
  });

  it('resizes notes to the grid and changes velocity', () => {
    const s = store();
    const [first] = clipNotes(s.doc, 'tpl-bass-clip');
    expect(resizeNotesOps(s.doc, [first.id], 0.6, '1/4')).toEqual([
      { op: 'note.set', id: first.id, field: 'lengthBeats', value: 2 },
    ]);
    expect(velocityOps(s.doc, [first.id], 200)).toEqual([
      { op: 'note.set', id: first.id, field: 'velocity', value: 127 },
    ]);
    expect(velocityOps(s.doc, [first.id], -10, true)).toEqual([
      { op: 'note.set', id: first.id, field: 'velocity', value: first.velocity - 10 },
    ]);
  });

  it('copies, pastes and duplicates notes as one batch', () => {
    const s = store();
    const bass = clipNotes(s.doc, 'tpl-bass-clip').slice(0, 2);
    const clip = copyNotes(s.doc, bass.map((n) => n.id))!;
    expect(clip.span).toBe(2);
    const pasted = pasteNotesOps('tpl-bass-clip', clip, 8, ids('p'));
    expect(pasted.ids).toEqual(['p1', 'p2']);
    s.dispatch(pasted.ops);
    expect(s.doc.notes.p2.startBeat).toBe(9.5);
    const dup = duplicateNotesOps(s.doc, ['p1', 'p2'], ids('q'));
    s.dispatch(dup);
    expect(s.doc.notes.q1.startBeat).toBe(10);
    expect(s.batches).toHaveLength(2);
  });
});

describe('drum steps', () => {
  it('has 16 steps per 4/4 bar and 12 per 6/8 bar', () => {
    expect(stepsPerBar({ beats: 4, unit: 4 })).toBe(16);
    expect(stepsPerBar({ beats: 6, unit: 8 })).toBe(12);
    expect(stepCount({ id: 'c', trackId: 't', startBeat: 0, lengthBeats: 16, name: '', kind: 'midi' })).toBe(64);
  });

  it('toggles a step on and off on the same notes the piano roll edits', () => {
    const s = store();
    const on = setStepsOps(s.doc, 'tpl-drums-clip', [{ pitch: 39, step: 4 }], true, ids('s'));
    expect(on).toEqual([
      {
        op: 'note.create',
        note: { id: 's1', clipId: 'tpl-drums-clip', pitch: 39, startBeat: 1, lengthBeats: 0.25, velocity: 100 },
      },
    ]);
    s.dispatch(on);
    // Kick on step 0 exists in the template: switching it on again is a no-op, off deletes it.
    expect(setStepsOps(s.doc, 'tpl-drums-clip', [{ pitch: 36, step: 0 }], true, ids())).toEqual([]);
    const off = setStepsOps(s.doc, 'tpl-drums-clip', [{ pitch: 39, step: 4 }, { pitch: 36, step: 0 }], false, ids());
    expect(off.map((op) => op.op)).toEqual(['note.delete', 'note.delete']);
  });

  it('toggles the accent of a filled step', () => {
    const s = store();
    const ops = toggleAccentOps(s.doc, 'tpl-drums-clip', 38, 4);
    expect(ops).toHaveLength(1);
    expect(ops[0]).toMatchObject({ field: 'velocity', value: ACCENT_VELOCITY });
    s.dispatch(ops);
    expect(toggleAccentOps(s.doc, 'tpl-drums-clip', 38, 4)[0]).toMatchObject({ value: 100 });
    expect(toggleAccentOps(s.doc, 'tpl-drums-clip', 38, 5)).toEqual([]);
  });
});

describe('keyboard', () => {
  it('maps delete, nudges, duplicate, select all, copy and paste', () => {
    expect(editorCommand(key('Backspace'), true)).toEqual({ kind: 'delete' });
    expect(editorCommand(key('ArrowLeft', { shiftKey: true }), true)).toMatchObject({
      kind: 'nudge',
      beats: -1,
      coarse: true,
    });
    expect(editorCommand(key('ArrowUp'), true)).toMatchObject({ kind: 'nudge', pitch: 1 });
    expect(editorCommand(key('d', { metaKey: true }), true)).toEqual({ kind: 'duplicate' });
    expect(editorCommand(key('d', { ctrlKey: true }), false)).toEqual({ kind: 'duplicate' });
    expect(editorCommand(key('d', { ctrlKey: true }), true)).toBeNull();
    expect(editorCommand(key('A', { ctrlKey: true }), false)).toEqual({ kind: 'select-all' });
    expect(editorCommand(key('z', { metaKey: true }), true)).toBeNull();
    expect(editorCommand(key(' '), true)).toBeNull();
  });

  it('never fires while typing in an input', () => {
    const input = { tagName: 'INPUT', isContentEditable: false, closest: () => null, getAttribute: () => null };
    expect(isTypingTarget(input as unknown as EventTarget)).toBe(true);
    expect(editorCommand(key('Backspace', { target: input as unknown as EventTarget }), true)).toBeNull();
    expect(editorCommand(key('a', { metaKey: true, isComposing: true }), true)).toBeNull();
  });
});
