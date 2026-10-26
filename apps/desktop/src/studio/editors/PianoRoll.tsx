import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type MouseEvent,
  type PointerEvent,
} from 'react';
import type { StudioNote } from '@rooms/studio';
import { t } from '../../i18n';
import { prepareCanvas, roundRect, useElementSize, usePlayheadLine } from './canvas';
import { resolvePalette, withAlpha, type EditorPalette } from './colors';
import {
  clampNoteDelta,
  clipNotes,
  copyNotes,
  createNoteOps,
  DEFAULT_VELOCITY,
  deleteNotesOps,
  duplicateNotesOps,
  moveNotesOps,
  pasteNotesOps,
  resizeNotesOps,
  snappedDelta,
  velocityOps,
  type NewId,
  type NoteClipboard,
} from './edit-ops';
import {
  barBeats,
  isBlackKey,
  minLength,
  newNoteLength,
  noteName,
  snap,
  snapBeats,
  snapFloor,
  unitBeats,
  type SnapId,
} from './grid';
import type { EditorPort } from './port';
import { editorCommand, isMacPlatform } from './shortcuts';

export const PIANO_KEYS_WIDTH = 56;
export const PIANO_RULER_HEIGHT = 22;
export const PIANO_ROW_HEIGHT = 14;
export const VELOCITY_LANE_HEIGHT = 64;
const EDGE_PX = 6;
const DRAG_THRESHOLD = 3;

/** Notes copied in any piano roll; pasted at the playhead (or after the copy) in the open clip. */
let clipboard: NoteClipboard | null = null;

type Drag =
  | {
      kind: 'move';
      anchor: StudioNote;
      ids: string[];
      x0: number;
      y0: number;
      moved: boolean;
      lastPitch: number;
    }
  | { kind: 'resize'; ids: string[]; x0: number; moved: boolean }
  | { kind: 'marquee'; x0: number; y0: number; additive: boolean; moved: boolean }
  | { kind: 'velocity'; ids: string[]; y0: number; base: number; moved: boolean };

type Preview =
  | { kind: 'move'; ids: Set<string>; deltaBeats: number; deltaPitch: number; duplicate: boolean }
  | { kind: 'resize'; ids: Set<string>; deltaBeats: number }
  | { kind: 'marquee'; x0: number; y0: number; x1: number; y1: number }
  | { kind: 'velocity'; ids: Set<string>; delta: number }
  | null;

export interface PianoRollProps {
  port: EditorPort;
  clipId: string;
  snap: SnapId;
  pxPerBeat: number;
  onZoom(factor: number): void;
  selectedNoteIds: ReadonlySet<string>;
  onSelectNotes(ids: Set<string>): void;
  newId: NewId;
  /** Development measurement hook: called with each draw's duration in ms and the notes drawn. */
  onDrawn?(ms: number, drawn: number): void;
}

export function PianoRoll({
  port,
  clipId,
  snap: snapId,
  pxPerBeat,
  onZoom,
  selectedNoteIds,
  onSelectNotes,
  newId,
  onDrawn,
}: PianoRollProps) {
  const { doc, canEdit, presence } = port;
  const clip = doc.clips[clipId];
  const track = clip ? doc.tracks[clip.trackId] : undefined;
  const notes = clip ? clipNotes(doc, clip.id) : [];
  const scroller = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const velocity = useRef<HTMLCanvasElement>(null);
  const playhead = useRef<HTMLDivElement>(null);
  const drag = useRef<Drag | null>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });
  const [scroll, setScroll] = useState({ left: 0, top: 0 });
  const [preview, setPreview] = useState<Preview>(null);
  const [cursor, setCursor] = useState('default');
  useElementSize(scroller, (w, h) => setSize({ w, h }));

  const bar = clip ? barBeats(doc.timeSignature) : 4;
  const lengthBeats = clip ? clip.lengthBeats : 0;
  const notesEnd = notes.reduce((end, note) => Math.max(end, note.startBeat + note.lengthBeats), 0);
  const totalBeats = Math.ceil(Math.max(lengthBeats, notesEnd) / bar) * bar + bar;
  const contentW = PIANO_KEYS_WIDTH + totalBeats * pxPerBeat;
  const contentH = PIANO_RULER_HEIGHT + 128 * PIANO_ROW_HEIGHT;
  const xOf = (beat: number) => PIANO_KEYS_WIDTH + beat * pxPerBeat - scroll.left;
  const yOf = (pitch: number) => PIANO_RULER_HEIGHT + (127 - pitch) * PIANO_ROW_HEIGHT - scroll.top;
  const beatAt = (x: number) => (x - PIANO_KEYS_WIDTH + scroll.left) / pxPerBeat;
  const pitchAt = (y: number) =>
    127 - Math.floor((y - PIANO_RULER_HEIGHT + scroll.top) / PIANO_ROW_HEIGHT);

  const remoteNotes = useMemo(() => {
    const map = new Map<string, number>();
    for (const member of presence)
      if (member.selection?.clipId === clipId)
        for (const id of member.selection.noteIds) map.set(id, member.colorIndex);
    return map;
  }, [presence, clipId]);

  // Centre the view on the clip's notes (or C4) when a clip opens.
  useEffect(() => {
    const element = scroller.current;
    if (!element) return;
    const list = clipNotes(port.doc, clipId);
    const mean = list.length ? list.reduce((sum, note) => sum + note.pitch, 0) / list.length : 60;
    element.scrollTop = Math.max(
      0,
      PIANO_RULER_HEIGHT + (127 - mean) * PIANO_ROW_HEIGHT - element.clientHeight / 2,
    );
    element.scrollLeft = 0;
    // Only when the clip changes, not on every edit.
  }, [clipId]);

  usePlayheadLine(playhead, port, (beat) => {
    if (!clip) return null;
    const x =
      PIANO_KEYS_WIDTH + (beat - clip.startBeat) * pxPerBeat - (scroller.current?.scrollLeft ?? 0);
    return x < PIANO_KEYS_WIDTH || x > (scroller.current?.clientWidth ?? 0) ? null : x;
  });

  function shown(note: StudioNote) {
    const p = preview;
    let { startBeat, pitch, lengthBeats: length, velocity: vel } = note;
    if (p?.kind === 'move' && p.ids.has(note.id) && !p.duplicate) {
      startBeat += p.deltaBeats;
      pitch += p.deltaPitch;
    }
    if (p?.kind === 'resize' && p.ids.has(note.id)) {
      const end = snap(note.startBeat + note.lengthBeats + p.deltaBeats, snapId);
      length = Math.max(minLength(snapId), end - note.startBeat);
    }
    if (p?.kind === 'velocity' && p.ids.has(note.id))
      vel = Math.min(127, Math.max(1, Math.round(vel + p.delta)));
    return { startBeat, pitch, length, vel };
  }

  useLayoutEffect(() => {
    const ctx = prepareCanvas(canvas.current, size.w, size.h);
    if (!ctx || !canvas.current || !clip) return;
    const palette = resolvePalette(canvas.current);
    const started = performance.now();
    const drawn = drawGrid(ctx, palette);
    const vctx = prepareCanvas(velocity.current, size.w, VELOCITY_LANE_HEIGHT);
    if (vctx) drawVelocity(vctx, palette);
    onDrawn?.(performance.now() - started, drawn);
  });

  function drawNote(
    ctx: CanvasRenderingContext2D,
    palette: EditorPalette,
    colour: string,
    note: StudioNote,
    view: ReturnType<typeof shown>,
    ghost: boolean,
  ) {
    const x = xOf(view.startBeat);
    const y = yOf(view.pitch) + 1;
    const w = Math.max(2, view.length * pxPerBeat - 1);
    const h = PIANO_ROW_HEIGHT - 2;
    ctx.globalAlpha = ghost ? 0.5 : 0.45 + (view.vel / 127) * 0.55;
    ctx.fillStyle = colour;
    if (w > 6) {
      roundRect(ctx, x, y, w, h, 3);
      ctx.fill();
    } else ctx.fillRect(x, y, w, h);
    ctx.globalAlpha = 1;
    const remote = remoteNotes.get(note.id);
    if (selectedNoteIds.has(note.id) && !ghost) {
      ctx.lineWidth = 1.5;
      ctx.strokeStyle = palette.selection;
      ctx.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1);
    } else if (remote !== undefined) {
      ctx.lineWidth = 1.5;
      ctx.strokeStyle = palette.chart[remote % 12];
      ctx.setLineDash([3, 2]);
      ctx.strokeRect(x - 0.5, y - 0.5, w + 1, h + 1);
      ctx.setLineDash([]);
    }
    if (w > 34 && PIANO_ROW_HEIGHT >= 12) {
      ctx.fillStyle = palette.background;
      ctx.font = '500 9px Inter, sans-serif';
      ctx.textBaseline = 'middle';
      ctx.fillText(noteName(view.pitch), x + 4, y + h / 2 + 0.5);
    }
  }

  function drawGrid(ctx: CanvasRenderingContext2D, palette: EditorPalette): number {
    const { w, h } = size;
    const unit = unitBeats(doc.timeSignature);
    ctx.fillStyle = palette.background;
    ctx.fillRect(0, 0, w, h);
    const topPitch = Math.min(127, pitchAt(PIANO_RULER_HEIGHT));
    const bottomPitch = Math.max(0, pitchAt(h));
    // Rows.
    for (let pitch = bottomPitch; pitch <= topPitch; pitch += 1) {
      const y = yOf(pitch);
      ctx.fillStyle = isBlackKey(pitch) ? palette.laneAlt : palette.lane;
      ctx.fillRect(PIANO_KEYS_WIDTH, y, w, PIANO_ROW_HEIGHT);
      if (pitch % 12 === 0) {
        ctx.fillStyle = palette.gridBeat;
        ctx.fillRect(PIANO_KEYS_WIDTH, y + PIANO_ROW_HEIGHT - 1, w, 1);
      }
    }
    // Grid columns.
    const from = Math.max(0, beatAt(PIANO_KEYS_WIDTH));
    const to = beatAt(w);
    const fine = snapBeats(snapId);
    const step = fine && fine * pxPerBeat >= 8 ? fine : unit;
    for (let beat = Math.floor(from / step) * step; beat <= to; beat += step) {
      const x = Math.round(xOf(beat)) + 0.5;
      const isBar = Math.abs(beat / bar - Math.round(beat / bar)) < 1e-6;
      const isUnit = Math.abs(beat / unit - Math.round(beat / unit)) < 1e-6;
      ctx.strokeStyle = isBar ? palette.gridBar : palette.gridBeat;
      ctx.globalAlpha = isBar ? 1 : isUnit ? 0.8 : 0.35;
      ctx.beginPath();
      ctx.moveTo(x, PIANO_RULER_HEIGHT);
      ctx.lineTo(x, h);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
    // Beyond the clip end.
    const endX = xOf(lengthBeats);
    if (endX < w) {
      ctx.fillStyle = withAlpha(palette.background, 0.6);
      ctx.fillRect(Math.max(PIANO_KEYS_WIDTH, endX), PIANO_RULER_HEIGHT, w, h);
      ctx.fillStyle = palette.accent;
      ctx.fillRect(Math.round(endX), PIANO_RULER_HEIGHT, 1, h);
    }
    // Notes (culled to the viewport).
    const colour = palette.chart[track?.color ?? 0];
    let drawn = 0;
    for (const note of notes) {
      const view = shown(note);
      if (view.startBeat > to) {
        if (!preview || preview.kind === 'marquee' || preview.kind === 'velocity') break;
        continue;
      }
      if (view.startBeat + view.length < from || view.pitch > topPitch || view.pitch < bottomPitch)
        continue;
      drawNote(ctx, palette, colour, note, view, false);
      drawn += 1;
    }
    if (preview?.kind === 'move' && preview.duplicate)
      for (const note of notes)
        if (preview.ids.has(note.id))
          drawNote(
            ctx,
            palette,
            colour,
            note,
            {
              ...shown(note),
              startBeat: note.startBeat + preview.deltaBeats,
              pitch: note.pitch + preview.deltaPitch,
            },
            true,
          );
    if (preview?.kind === 'marquee') {
      ctx.fillStyle = withAlpha(palette.accent, 0.12);
      ctx.strokeStyle = palette.accent;
      ctx.lineWidth = 1;
      const x = Math.min(preview.x0, preview.x1);
      const y = Math.min(preview.y0, preview.y1);
      ctx.fillRect(x, y, Math.abs(preview.x1 - preview.x0), Math.abs(preview.y1 - preview.y0));
      ctx.strokeRect(
        x + 0.5,
        y + 0.5,
        Math.abs(preview.x1 - preview.x0),
        Math.abs(preview.y1 - preview.y0),
      );
    }
    // Remote playheads (song position → clip position).
    for (const member of presence) {
      if (member.playheadBeat === undefined || !clip) continue;
      const x = Math.round(xOf(member.playheadBeat - clip.startBeat)) + 0.5;
      if (x < PIANO_KEYS_WIDTH || x > w) continue;
      ctx.strokeStyle = palette.chart[member.colorIndex % 12];
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, h);
      ctx.stroke();
    }
    // Keys.
    for (let pitch = bottomPitch; pitch <= topPitch; pitch += 1) {
      const y = yOf(pitch);
      const black = isBlackKey(pitch);
      ctx.fillStyle = black ? palette.blackKey : palette.whiteKey;
      ctx.fillRect(0, y, PIANO_KEYS_WIDTH - 1, PIANO_ROW_HEIGHT - (black ? 0 : 1));
      if (pitch % 12 === 0 || (!black && PIANO_ROW_HEIGHT >= 14 && pitch % 12 === 5)) {
        ctx.fillStyle = pitch % 12 === 0 ? palette.text : palette.textMuted;
        ctx.font = `${pitch % 12 === 0 ? 600 : 400} 11px Inter, sans-serif`;
        ctx.textBaseline = 'middle';
        ctx.fillText(noteName(pitch), 8, y + PIANO_ROW_HEIGHT / 2 + 0.5);
      }
    }
    ctx.fillStyle = palette.gridBar;
    ctx.fillRect(PIANO_KEYS_WIDTH - 1, 0, 1, h);
    // Ruler: song bar numbers.
    ctx.fillStyle = palette.ruler;
    ctx.fillRect(0, 0, w, PIANO_RULER_HEIGHT);
    ctx.fillStyle = palette.gridBar;
    ctx.fillRect(0, PIANO_RULER_HEIGHT - 1, w, 1);
    ctx.font = '500 11px Inter, sans-serif';
    ctx.textBaseline = 'alphabetic';
    const offset = clip ? clip.startBeat : 0;
    const barEvery = Math.max(1, Math.ceil(36 / (bar * pxPerBeat)));
    for (let index = Math.floor(from / bar); index * bar <= to; index += 1) {
      if (index % barEvery) continue;
      const x = Math.round(xOf(index * bar)) + 0.5;
      ctx.fillStyle = palette.gridBar;
      ctx.fillRect(x, PIANO_RULER_HEIGHT - 7, 1, 7);
      ctx.fillStyle = palette.rulerText;
      ctx.fillText(
        String(Math.floor((offset + index * bar) / bar) + 1),
        x + 4,
        PIANO_RULER_HEIGHT - 6,
      );
    }
    return drawn;
  }

  function drawVelocity(ctx: CanvasRenderingContext2D, palette: EditorPalette) {
    const { w } = size;
    const h = VELOCITY_LANE_HEIGHT;
    ctx.fillStyle = palette.ruler;
    ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = palette.gridBar;
    ctx.fillRect(0, 0, w, 1);
    ctx.fillStyle = palette.textMuted;
    ctx.font = '500 11px Inter, sans-serif';
    ctx.textBaseline = 'top';
    ctx.fillText(t('Vuruş gücü'), 6, 6);
    const colour = palette.chart[track?.color ?? 0];
    const from = Math.max(0, beatAt(PIANO_KEYS_WIDTH));
    const to = beatAt(w);
    ctx.save();
    ctx.beginPath();
    ctx.rect(PIANO_KEYS_WIDTH, 0, w, h);
    ctx.clip();
    for (const note of notes) {
      const view = shown(note);
      if (view.startBeat > to) break;
      if (view.startBeat < from - 1) continue;
      const x = Math.round(xOf(view.startBeat));
      const barH = ((h - 10) * view.vel) / 127;
      const selected = selectedNoteIds.has(note.id);
      ctx.fillStyle = selected ? palette.selection : colour;
      ctx.fillRect(x, h - barH, 2, barH);
      ctx.beginPath();
      ctx.arc(x + 1, h - barH, 3, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }

  function local(
    event: { clientX: number; clientY: number },
    element: HTMLElement | null = canvas.current,
  ) {
    const box = element!.getBoundingClientRect();
    return { x: event.clientX - box.left, y: event.clientY - box.top };
  }

  function hit(x: number, y: number): { note: StudioNote; edge: boolean } | null {
    if (x < PIANO_KEYS_WIDTH || y < PIANO_RULER_HEIGHT) return null;
    const pitch = pitchAt(y);
    const beat = beatAt(x);
    for (let i = notes.length - 1; i >= 0; i -= 1) {
      const note = notes[i];
      if (note.pitch !== pitch || beat < note.startBeat || beat > note.startBeat + note.lengthBeats)
        continue;
      const right = xOf(note.startBeat + note.lengthBeats);
      return { note, edge: right - x <= EDGE_PX && note.lengthBeats * pxPerBeat > EDGE_PX * 1.5 };
    }
    return null;
  }

  function audition(pitch: number, vel = DEFAULT_VELOCITY) {
    if (track) port.preview(track.id, pitch, vel);
  }

  function onPointerDown(event: PointerEvent<HTMLCanvasElement>) {
    if (event.button !== 0 || !clip) return;
    scroller.current?.focus({ preventScroll: true });
    const { x, y } = local(event);
    if (y < PIANO_RULER_HEIGHT) {
      port.seek?.(clip.startBeat + Math.max(0, snap(beatAt(x), snapId)));
      return;
    }
    if (x < PIANO_KEYS_WIDTH) {
      audition(pitchAt(y));
      return;
    }
    const found = hit(x, y);
    if (found) {
      let ids = new Set(selectedNoteIds);
      if (event.shiftKey) {
        if (ids.has(found.note.id)) ids.delete(found.note.id);
        else ids.add(found.note.id);
        onSelectNotes(ids);
        return;
      }
      if (!ids.has(found.note.id)) ids = new Set([found.note.id]);
      onSelectNotes(ids);
      audition(found.note.pitch, found.note.velocity);
      if (!canEdit) return;
      const list = [...ids];
      drag.current = found.edge
        ? { kind: 'resize', ids: list, x0: x, moved: false }
        : {
            kind: 'move',
            anchor: found.note,
            ids: list,
            x0: x,
            y0: y,
            moved: false,
            lastPitch: found.note.pitch,
          };
    } else {
      drag.current = { kind: 'marquee', x0: x, y0: y, additive: event.shiftKey, moved: false };
    }
    event.currentTarget.setPointerCapture(event.pointerId);
  }

  function onPointerMove(event: PointerEvent<HTMLCanvasElement>) {
    const { x, y } = local(event);
    const current = drag.current;
    if (!current) {
      const found = canEdit ? hit(x, y) : null;
      setCursor(
        found ? (found.edge ? 'ew-resize' : 'grab') : x < PIANO_KEYS_WIDTH ? 'pointer' : 'default',
      );
      return;
    }
    if (current.kind === 'velocity') return;
    if (
      !current.moved &&
      Math.abs(x - current.x0) < DRAG_THRESHOLD &&
      (current.kind === 'resize' || Math.abs(y - current.y0) < DRAG_THRESHOLD)
    )
      return;
    current.moved = true;
    const rawDelta = (x - current.x0) / pxPerBeat;
    if (current.kind === 'move') {
      const chosen = notes.filter((note) => current.ids.includes(note.id));
      const delta = clampNoteDelta(
        chosen,
        snappedDelta(current.anchor.startBeat, rawDelta, snapId),
        Math.round(-(y - current.y0) / PIANO_ROW_HEIGHT),
      );
      const pitch = current.anchor.pitch + delta.deltaPitch;
      if (pitch !== current.lastPitch) {
        current.lastPitch = pitch;
        audition(pitch, current.anchor.velocity);
      }
      setPreview({ kind: 'move', ids: new Set(current.ids), ...delta, duplicate: event.altKey });
      setCursor(event.altKey ? 'copy' : 'grabbing');
    } else if (current.kind === 'resize') {
      setPreview({ kind: 'resize', ids: new Set(current.ids), deltaBeats: rawDelta });
    } else {
      setPreview({ kind: 'marquee', x0: current.x0, y0: current.y0, x1: x, y1: y });
    }
  }

  function onPointerUp(event: PointerEvent<HTMLCanvasElement>) {
    const current = drag.current;
    drag.current = null;
    const done = preview;
    setPreview(null);
    if (!current || !clip) return;
    if (current.kind === 'marquee') {
      if (!current.moved) {
        if (!current.additive) onSelectNotes(new Set());
        return;
      }
      if (done?.kind !== 'marquee') return;
      const b0 = beatAt(Math.min(done.x0, done.x1));
      const b1 = beatAt(Math.max(done.x0, done.x1));
      const p0 = pitchAt(Math.max(done.y0, done.y1));
      const p1 = pitchAt(Math.min(done.y0, done.y1));
      const ids = new Set(current.additive ? selectedNoteIds : []);
      for (const note of notes)
        if (
          note.pitch >= p0 &&
          note.pitch <= p1 &&
          note.startBeat <= b1 &&
          note.startBeat + note.lengthBeats >= b0
        )
          ids.add(note.id);
      onSelectNotes(ids);
      return;
    }
    if (!current.moved || !canEdit) return;
    if (done?.kind === 'move' && current.kind === 'move') {
      const ops = moveNotesOps(
        doc,
        current.ids,
        done.deltaBeats,
        done.deltaPitch,
        event.altKey,
        newId,
      );
      if (ops.length) port.dispatch(ops);
      if (event.altKey)
        onSelectNotes(new Set(ops.flatMap((op) => (op.op === 'note.create' ? [op.note.id] : []))));
    } else if (done?.kind === 'resize' && current.kind === 'resize') {
      const ops = resizeNotesOps(doc, current.ids, done.deltaBeats, snapId);
      if (ops.length) port.dispatch(ops);
    }
  }

  function onDoubleClick(event: MouseEvent<HTMLCanvasElement>) {
    if (!canEdit || !clip) return;
    const { x, y } = local(event);
    if (x < PIANO_KEYS_WIDTH || y < PIANO_RULER_HEIGHT) return;
    const found = hit(x, y);
    if (found) {
      port.dispatch(deleteNotesOps(doc, [found.note.id]));
      return;
    }
    const pitch = pitchAt(y);
    const ops = createNoteOps(
      clip.id,
      pitch,
      snapFloor(Math.max(0, beatAt(x)), snapId),
      newNoteLength(snapId),
      DEFAULT_VELOCITY,
      newId,
    );
    port.dispatch(ops);
    audition(pitch);
    if (ops[0].op === 'note.create') onSelectNotes(new Set([ops[0].note.id]));
  }

  // Velocity lane: drag a stem up/down; with a selection, every selected note moves by the same amount.
  function onVelocityDown(event: PointerEvent<HTMLCanvasElement>) {
    if (event.button !== 0 || !canEdit) return;
    const { x, y } = local(event, velocity.current);
    let best: StudioNote | null = null;
    let distance = 6;
    for (const note of notes) {
      const d = Math.abs(xOf(note.startBeat) - x);
      if (d <= distance) {
        best = note;
        distance = d;
      }
    }
    if (!best) return;
    const ids = selectedNoteIds.has(best.id) ? [...selectedNoteIds] : [best.id];
    if (!selectedNoteIds.has(best.id)) onSelectNotes(new Set(ids));
    drag.current = { kind: 'velocity', ids, y0: y, base: best.velocity, moved: false };
    event.currentTarget.setPointerCapture(event.pointerId);
  }

  function onVelocityMove(event: PointerEvent<HTMLCanvasElement>) {
    const current = drag.current;
    if (current?.kind !== 'velocity') return;
    const { y } = local(event, velocity.current);
    current.moved = true;
    const delta = Math.round(((current.y0 - y) / (VELOCITY_LANE_HEIGHT - 10)) * 127);
    setPreview({ kind: 'velocity', ids: new Set(current.ids), delta });
  }

  function onVelocityUp() {
    const current = drag.current;
    drag.current = null;
    const done = preview;
    setPreview(null);
    if (current?.kind !== 'velocity' || done?.kind !== 'velocity' || !done.delta) return;
    const ops = velocityOps(doc, current.ids, done.delta, true);
    if (ops.length) port.dispatch(ops);
  }

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (!clip) return;
    const command = editorCommand(event, isMacPlatform());
    if (!command) return;
    const ids = [...selectedNoteIds].filter((id) => doc.notes[id]);
    switch (command.kind) {
      case 'select-all':
        event.preventDefault();
        onSelectNotes(new Set(notes.map((note) => note.id)));
        return;
      case 'clear-selection':
        onSelectNotes(new Set());
        return;
      case 'copy':
        if (!ids.length) return;
        event.preventDefault();
        clipboard = copyNotes(doc, ids);
        return;
      case 'paste': {
        if (!clipboard || !canEdit) return;
        event.preventDefault();
        const position = port.position() - clip.startBeat;
        const copied = ids.length ? copyNotes(doc, ids) : null;
        const inside = position >= 0 && position < clip.lengthBeats;
        const at = inside
          ? snapFloor(position, snapId)
          : copied
            ? Math.min(...ids.map((id) => doc.notes[id].startBeat)) + copied.span
            : 0;
        const pasted = pasteNotesOps(clip.id, clipboard, at, newId);
        port.dispatch(pasted.ops);
        onSelectNotes(new Set(pasted.ids));
        return;
      }
      default:
        break;
    }
    if (!ids.length || !canEdit) return;
    event.preventDefault();
    if (command.kind === 'delete') {
      port.dispatch(deleteNotesOps(doc, ids));
      onSelectNotes(new Set());
    } else if (command.kind === 'duplicate') {
      const ops = duplicateNotesOps(doc, ids, newId);
      port.dispatch(ops);
      onSelectNotes(new Set(ops.flatMap((op) => (op.op === 'note.create' ? [op.note.id] : []))));
    } else if (command.kind === 'nudge') {
      const step = command.coarse ? bar : snapBeats(snapId) || 0.25;
      const ops = moveNotesOps(
        doc,
        ids,
        command.beats * step,
        command.pitch * (command.coarse ? 12 : 1),
        false,
        newId,
      );
      if (ops.length) port.dispatch(ops);
    }
  }

  if (!clip) return null;
  return (
    <div className="relative flex min-h-0 flex-1 flex-col">
      <div
        ref={scroller}
        className="relative min-h-0 flex-1 overflow-auto outline-none focus-visible:ring-2 focus-visible:ring-border-focus-ring"
        tabIndex={0}
        role="application"
        aria-label={t('Piyano rulosu')}
        onKeyDown={onKeyDown}
        onScroll={(event) =>
          setScroll({ left: event.currentTarget.scrollLeft, top: event.currentTarget.scrollTop })
        }
        onWheel={(event) => {
          if (!event.ctrlKey && !event.metaKey) return;
          event.preventDefault();
          onZoom(event.deltaY < 0 ? 1.15 : 1 / 1.15);
        }}
      >
        <div
          style={{
            width: Math.max(contentW, size.w),
            height: Math.max(contentH, size.h),
            position: 'relative',
          }}
        >
          <canvas
            ref={canvas}
            data-testid="piano-roll-canvas"
            className="sticky top-0 left-0 block"
            style={{ cursor, touchAction: 'none' }}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onPointerCancel={() => {
              drag.current = null;
              setPreview(null);
            }}
            onDoubleClick={onDoubleClick}
          />
        </div>
      </div>
      <canvas
        ref={velocity}
        aria-label={t('Vuruş gücü')}
        className="block shrink-0"
        style={{
          height: VELOCITY_LANE_HEIGHT,
          cursor: canEdit ? 'ns-resize' : 'default',
          touchAction: 'none',
        }}
        onPointerDown={onVelocityDown}
        onPointerMove={onVelocityMove}
        onPointerUp={onVelocityUp}
      />
      <div
        ref={playhead}
        aria-hidden
        className="pointer-events-none absolute top-0 bottom-0 left-0 w-px bg-text-primary"
        style={{ display: 'none' }}
      />
    </div>
  );
}
