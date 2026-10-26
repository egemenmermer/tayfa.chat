import {
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type MouseEvent,
  type PointerEvent,
} from 'react';
import type { StudioClip, StudioProject } from '@rooms/studio';
import { t } from '../../i18n';
import { instrumentLabel } from '../engine/instruments';
import { prepareCanvas, roundRect, useElementSize, usePlayheadLine } from './canvas';
import { resolvePalette, withAlpha, type EditorPalette } from './colors';
import {
  clipNotes,
  createClipOps,
  deleteClipsOps,
  duplicateClipsOps,
  moveClipsOps,
  resizeClipsOps,
  snappedDelta,
  type NewId,
} from './edit-ops';
import { barBeats, snap, snapBeats, snapFloor, unitBeats, type SnapId } from './grid';
import type { EditorPort, EditorPresence } from './port';
import { editorCommand, isMacPlatform } from './shortcuts';

export const ARRANGEMENT_RULER_HEIGHT = 26;
export const ARRANGEMENT_LANE_HEIGHT = 56;
export const ARRANGEMENT_LABEL_WIDTH = 140;
const EDGE_PX = 7;
const DRAG_THRESHOLD = 4;

type Drag =
  | { kind: 'move'; anchor: StudioClip; ids: string[]; x0: number; y0: number; moved: boolean }
  | { kind: 'resize'; ids: string[]; x0: number; moved: boolean }
  | { kind: 'create'; trackId: string; lane: number; beat0: number; x0: number; moved: boolean }
  | { kind: 'loop'; beat0: number; x0: number; moved: boolean };

type Preview =
  | { kind: 'move'; ids: Set<string>; deltaBeats: number; laneDelta: number; duplicate: boolean }
  | { kind: 'resize'; ids: Set<string>; deltaBeats: number }
  | { kind: 'create'; lane: number; from: number; to: number }
  | { kind: 'loop'; from: number; to: number }
  | null;

export interface ArrangementTimelineProps {
  port: EditorPort;
  snap: SnapId;
  pxPerBeat: number;
  onZoom(factor: number): void;
  selectedClipIds: ReadonlySet<string>;
  onSelectClips(ids: Set<string>): void;
  activeClipId: string | null;
  onActivateClip(id: string | null): void;
  onHint(message: string): void;
  newId: NewId;
  /** Draws track names on the left; the shell turns it off when its track headers line up. */
  showLaneLabels?: boolean;
}

/** Track display name: its own name, else the instrument's label. */
export function trackTitle(doc: StudioProject, trackId: string): string {
  const track = doc.tracks[trackId];
  if (!track) return '';
  return track.name || instrumentLabel(track.instrument);
}

export function contentBeats(doc: StudioProject): number {
  const bar = barBeats(doc.timeSignature);
  let end = doc.lengthBeats;
  for (const clip of Object.values(doc.clips))
    end = Math.max(end, clip.startBeat + clip.lengthBeats);
  return Math.ceil(end / bar) * bar + bar * 4;
}

export function ArrangementTimeline({
  port,
  snap: snapId,
  pxPerBeat,
  onZoom,
  selectedClipIds,
  onSelectClips,
  activeClipId,
  onActivateClip,
  onHint,
  newId,
  showLaneLabels = true,
}: ArrangementTimelineProps) {
  const { doc, canEdit, presence } = port;
  const scroller = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const playhead = useRef<HTMLDivElement>(null);
  const drag = useRef<Drag | null>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });
  const [scroll, setScroll] = useState({ left: 0, top: 0 });
  const [preview, setPreview] = useState<Preview>(null);
  const [cursor, setCursor] = useState('default');
  useElementSize(scroller, (w, h) => setSize({ w, h }));

  const labelW = showLaneLabels ? ARRANGEMENT_LABEL_WIDTH : 0;
  const lanes = doc.trackOrder;
  const totalBeats = contentBeats(doc);
  const contentW = labelW + totalBeats * pxPerBeat;
  const contentH = ARRANGEMENT_RULER_HEIGHT + Math.max(1, lanes.length) * ARRANGEMENT_LANE_HEIGHT;
  const xOf = (beat: number) => labelW + beat * pxPerBeat - scroll.left;
  const beatAt = (x: number) => (x - labelW + scroll.left) / pxPerBeat;
  const laneAt = (y: number) =>
    Math.floor((y - ARRANGEMENT_RULER_HEIGHT + scroll.top) / ARRANGEMENT_LANE_HEIGHT);

  const clipsByLane = useMemo(() => {
    const map = new Map<string, StudioClip[]>();
    for (const clip of Object.values(doc.clips)) {
      const list = map.get(clip.trackId);
      if (list) list.push(clip);
      else map.set(clip.trackId, [clip]);
    }
    return map;
  }, [doc.clips]);

  const remoteByClip = useMemo(() => {
    const map = new Map<string, EditorPresence[]>();
    for (const member of presence) {
      const clipId = member.selection?.clipId;
      if (!clipId) continue;
      map.set(clipId, [...(map.get(clipId) ?? []), member]);
    }
    return map;
  }, [presence]);

  usePlayheadLine(playhead, port, (beat) => {
    const x = labelW + beat * pxPerBeat - (scroller.current?.scrollLeft ?? 0);
    return x < labelW || x > (scroller.current?.clientWidth ?? 0) ? null : x;
  });

  useLayoutEffect(() => {
    const ctx = prepareCanvas(canvas.current, size.w, size.h);
    if (!ctx || !canvas.current) return;
    draw(ctx, resolvePalette(canvas.current));
  });

  function clipRect(clip: StudioClip, lane: number) {
    const p = preview;
    let start = clip.startBeat;
    let length = clip.lengthBeats;
    let laneIndex = lane;
    if (p?.kind === 'move' && p.ids.has(clip.id) && !p.duplicate) {
      start = Math.max(0, start + p.deltaBeats);
      laneIndex = Math.min(lanes.length - 1, Math.max(0, lane + p.laneDelta));
    }
    if (p?.kind === 'resize' && p.ids.has(clip.id)) {
      const end = snap(clip.startBeat + clip.lengthBeats + p.deltaBeats, snapId);
      length = Math.max(snapBeats(snapId) || 1 / 32, end - clip.startBeat);
    }
    return {
      x: xOf(start),
      y: ARRANGEMENT_RULER_HEIGHT + laneIndex * ARRANGEMENT_LANE_HEIGHT - scroll.top,
      w: length * pxPerBeat,
    };
  }

  function drawClip(
    ctx: CanvasRenderingContext2D,
    palette: EditorPalette,
    clip: StudioClip,
    rect: { x: number; y: number; w: number },
    ghost: boolean,
  ) {
    const track = doc.tracks[clip.trackId];
    const colour = palette.chart[track?.color ?? 0];
    const h = ARRANGEMENT_LANE_HEIGHT - 6;
    const y = rect.y + 3;
    const w = Math.max(3, rect.w - 1);
    ctx.globalAlpha = ghost ? 0.45 : 1;
    roundRect(ctx, rect.x, y, w, h, 5);
    ctx.fillStyle = withAlpha(colour, 0.28);
    ctx.fill();
    ctx.lineWidth = 1;
    ctx.strokeStyle = withAlpha(colour, 0.9);
    ctx.stroke();
    // Mini notes: pitch range of the clip scaled into the body.
    const notes = clipNotes(doc, clip.id);
    if (notes.length && w > 6) {
      let lo = 127;
      let hi = 0;
      for (const note of notes) {
        lo = Math.min(lo, note.pitch);
        hi = Math.max(hi, note.pitch);
      }
      const span = Math.max(1, hi - lo);
      const top = y + 18;
      const body = h - 22;
      ctx.fillStyle = colour;
      ctx.save();
      ctx.beginPath();
      ctx.rect(rect.x, y, w, h);
      ctx.clip();
      for (const note of notes) {
        if (note.startBeat >= clip.lengthBeats) break;
        const nx = rect.x + note.startBeat * pxPerBeat;
        const ny = top + body - ((note.pitch - lo) / span) * body;
        ctx.fillRect(nx, ny - 1, Math.max(1.5, note.lengthBeats * pxPerBeat - 1), 2);
      }
      ctx.restore();
    }
    if (w > 28) {
      ctx.fillStyle = palette.text;
      ctx.font = '500 11px Inter, sans-serif';
      ctx.textBaseline = 'top';
      const label = clip.name || trackTitle(doc, clip.trackId);
      ctx.save();
      ctx.beginPath();
      ctx.rect(rect.x + 4, y, w - 8, 16);
      ctx.clip();
      ctx.fillText(label, rect.x + 6, y + 4);
      ctx.restore();
    }
    if (selectedClipIds.has(clip.id)) {
      roundRect(ctx, rect.x - 0.5, y - 0.5, w + 1, h + 1, 5);
      ctx.lineWidth = 2;
      ctx.strokeStyle =
        clip.id === activeClipId ? palette.selection : withAlpha(palette.selection, 0.7);
      ctx.stroke();
    }
    const remote = remoteByClip.get(clip.id);
    if (remote) {
      remote.forEach((member, i) => {
        roundRect(ctx, rect.x - 2 - i * 2, y - 2 - i * 2, w + 4 + i * 4, h + 4 + i * 4, 6);
        ctx.setLineDash([4, 3]);
        ctx.lineWidth = 1.5;
        ctx.strokeStyle = palette.chart[member.colorIndex % 12];
        ctx.stroke();
        ctx.setLineDash([]);
      });
    }
    ctx.globalAlpha = 1;
  }

  function draw(ctx: CanvasRenderingContext2D, palette: EditorPalette) {
    const { w, h } = size;
    const bar = barBeats(doc.timeSignature);
    const unit = unitBeats(doc.timeSignature);
    ctx.fillStyle = palette.background;
    ctx.fillRect(0, 0, w, h);
    // Lanes.
    lanes.forEach((_, lane) => {
      const y = ARRANGEMENT_RULER_HEIGHT + lane * ARRANGEMENT_LANE_HEIGHT - scroll.top;
      if (y > h || y + ARRANGEMENT_LANE_HEIGHT < ARRANGEMENT_RULER_HEIGHT) return;
      ctx.fillStyle = lane % 2 ? palette.laneAlt : palette.lane;
      ctx.fillRect(labelW, y, w - labelW, ARRANGEMENT_LANE_HEIGHT);
    });
    // Project end.
    const endX = xOf(doc.lengthBeats);
    if (endX < w) {
      ctx.fillStyle = withAlpha(palette.background, 0.55);
      ctx.fillRect(Math.max(labelW, endX), ARRANGEMENT_RULER_HEIGHT, w, h);
    }
    // Grid.
    const from = Math.max(0, beatAt(labelW));
    const to = beatAt(w);
    const fine = snapBeats(snapId);
    const step = fine && fine * pxPerBeat >= 10 ? fine : unit * pxPerBeat >= 8 ? unit : bar;
    for (let beat = Math.floor(from / step) * step; beat <= to; beat += step) {
      const x = Math.round(xOf(beat)) + 0.5;
      const isBar = Math.abs(beat / bar - Math.round(beat / bar)) < 1e-6;
      ctx.strokeStyle = isBar ? palette.gridBar : palette.gridBeat;
      ctx.globalAlpha = isBar ? 1 : 0.6;
      ctx.beginPath();
      ctx.moveTo(x, ARRANGEMENT_RULER_HEIGHT);
      ctx.lineTo(x, h);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
    // Loop tint.
    const loop =
      preview?.kind === 'loop'
        ? { startBeat: preview.from, endBeat: preview.to, enabled: true }
        : port.loop;
    if (loop && loop.endBeat > loop.startBeat) {
      ctx.fillStyle = withAlpha(palette.loop, loop.enabled ? 0.07 : 0.03);
      ctx.fillRect(
        xOf(loop.startBeat),
        ARRANGEMENT_RULER_HEIGHT,
        (loop.endBeat - loop.startBeat) * pxPerBeat,
        h,
      );
    }
    // Clips.
    lanes.forEach((trackId, lane) => {
      for (const clip of clipsByLane.get(trackId) ?? []) {
        const rect = clipRect(clip, lane);
        if (rect.x > w || rect.x + rect.w < labelW) continue;
        const ghost = preview?.kind === 'move' && preview.duplicate && preview.ids.has(clip.id);
        drawClip(ctx, palette, clip, rect, false);
        if (ghost) {
          const copy = {
            x: xOf(Math.max(0, clip.startBeat + preview.deltaBeats)),
            y:
              ARRANGEMENT_RULER_HEIGHT +
              Math.min(lanes.length - 1, Math.max(0, lane + preview.laneDelta)) *
                ARRANGEMENT_LANE_HEIGHT -
              scroll.top,
            w: rect.w,
          };
          drawClip(ctx, palette, clip, copy, true);
        }
      }
    });
    if (preview?.kind === 'create') {
      const y = ARRANGEMENT_RULER_HEIGHT + preview.lane * ARRANGEMENT_LANE_HEIGHT - scroll.top + 3;
      roundRect(
        ctx,
        xOf(preview.from),
        y,
        (preview.to - preview.from) * pxPerBeat,
        ARRANGEMENT_LANE_HEIGHT - 6,
        5,
      );
      ctx.setLineDash([5, 4]);
      ctx.strokeStyle = palette.accent;
      ctx.lineWidth = 1.5;
      ctx.stroke();
      ctx.setLineDash([]);
    }
    // Remote playheads.
    for (const member of presence) {
      if (member.playheadBeat === undefined) continue;
      const x = Math.round(xOf(member.playheadBeat)) + 0.5;
      if (x < labelW || x > w) continue;
      ctx.strokeStyle = palette.chart[member.colorIndex % 12];
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(x, ARRANGEMENT_RULER_HEIGHT - 6);
      ctx.lineTo(x, h);
      ctx.stroke();
    }
    // Ruler.
    ctx.fillStyle = palette.ruler;
    ctx.fillRect(0, 0, w, ARRANGEMENT_RULER_HEIGHT);
    ctx.strokeStyle = palette.gridBar;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(0, ARRANGEMENT_RULER_HEIGHT - 0.5);
    ctx.lineTo(w, ARRANGEMENT_RULER_HEIGHT - 0.5);
    ctx.stroke();
    if (loop && loop.endBeat > loop.startBeat) {
      ctx.fillStyle = withAlpha(palette.loop, loop.enabled ? 0.85 : 0.35);
      roundRect(ctx, xOf(loop.startBeat), 3, (loop.endBeat - loop.startBeat) * pxPerBeat, 6, 3);
      ctx.fill();
    }
    const barEvery = Math.max(1, Math.ceil(36 / (bar * pxPerBeat)));
    ctx.font = '500 11px Inter, sans-serif';
    ctx.textBaseline = 'alphabetic';
    for (let index = Math.floor(from / bar); index * bar <= to; index += 1) {
      if (index % barEvery) continue;
      const x = Math.round(xOf(index * bar)) + 0.5;
      ctx.strokeStyle = palette.gridBar;
      ctx.beginPath();
      ctx.moveTo(x, ARRANGEMENT_RULER_HEIGHT - 8);
      ctx.lineTo(x, ARRANGEMENT_RULER_HEIGHT);
      ctx.stroke();
      ctx.fillStyle = palette.rulerText;
      ctx.fillText(String(index + 1), x + 4, ARRANGEMENT_RULER_HEIGHT - 6);
    }
    for (const member of presence) {
      if (member.playheadBeat === undefined) continue;
      const x = xOf(member.playheadBeat);
      if (x < labelW || x > w) continue;
      const colour = palette.chart[member.colorIndex % 12];
      ctx.fillStyle = colour;
      ctx.beginPath();
      ctx.moveTo(x - 5, ARRANGEMENT_RULER_HEIGHT - 9);
      ctx.lineTo(x + 5, ARRANGEMENT_RULER_HEIGHT - 9);
      ctx.lineTo(x, ARRANGEMENT_RULER_HEIGHT - 2);
      ctx.fill();
    }
    // Lane labels.
    if (labelW) {
      ctx.fillStyle = palette.ruler;
      ctx.fillRect(0, ARRANGEMENT_RULER_HEIGHT, labelW, h);
      lanes.forEach((trackId, lane) => {
        const y = ARRANGEMENT_RULER_HEIGHT + lane * ARRANGEMENT_LANE_HEIGHT - scroll.top;
        if (y > h || y + ARRANGEMENT_LANE_HEIGHT < ARRANGEMENT_RULER_HEIGHT) return;
        const track = doc.tracks[trackId];
        ctx.fillStyle = palette.chart[track?.color ?? 0];
        roundRect(ctx, 8, y + 10, 4, ARRANGEMENT_LANE_HEIGHT - 20, 2);
        ctx.fill();
        ctx.save();
        ctx.beginPath();
        ctx.rect(18, y, labelW - 24, ARRANGEMENT_LANE_HEIGHT);
        ctx.clip();
        ctx.fillStyle = palette.text;
        ctx.font = '500 12px Inter, sans-serif';
        ctx.textBaseline = 'middle';
        ctx.fillText(trackTitle(doc, trackId), 20, y + ARRANGEMENT_LANE_HEIGHT / 2 - 7);
        ctx.fillStyle = palette.textMuted;
        ctx.font = '400 11px Inter, sans-serif';
        ctx.fillText(
          track ? instrumentLabel(track.instrument) : '',
          20,
          y + ARRANGEMENT_LANE_HEIGHT / 2 + 9,
        );
        ctx.restore();
        ctx.strokeStyle = palette.gridBeat;
        ctx.beginPath();
        ctx.moveTo(0, y + ARRANGEMENT_LANE_HEIGHT - 0.5);
        ctx.lineTo(labelW, y + ARRANGEMENT_LANE_HEIGHT - 0.5);
        ctx.stroke();
      });
      ctx.fillStyle = palette.ruler;
      ctx.fillRect(0, 0, labelW, ARRANGEMENT_RULER_HEIGHT);
      ctx.strokeStyle = palette.gridBar;
      ctx.beginPath();
      ctx.moveTo(labelW - 0.5, 0);
      ctx.lineTo(labelW - 0.5, h);
      ctx.stroke();
    }
  }

  function local(event: { clientX: number; clientY: number }) {
    const box = canvas.current!.getBoundingClientRect();
    return { x: event.clientX - box.left, y: event.clientY - box.top };
  }

  function hit(x: number, y: number): { clip: StudioClip; edge: boolean } | null {
    if (x < labelW || y < ARRANGEMENT_RULER_HEIGHT) return null;
    const lane = laneAt(y);
    const trackId = lanes[lane];
    if (!trackId) return null;
    const beat = beatAt(x);
    const list = clipsByLane.get(trackId) ?? [];
    for (let i = list.length - 1; i >= 0; i -= 1) {
      const clip = list[i];
      if (beat >= clip.startBeat && beat <= clip.startBeat + clip.lengthBeats) {
        const right = xOf(clip.startBeat + clip.lengthBeats);
        return { clip, edge: right - x <= EDGE_PX && clip.lengthBeats * pxPerBeat > EDGE_PX * 2 };
      }
    }
    return null;
  }

  function onPointerDown(event: PointerEvent<HTMLCanvasElement>) {
    if (event.button !== 0) return;
    scroller.current?.focus({ preventScroll: true });
    const { x, y } = local(event);
    if (y < ARRANGEMENT_RULER_HEIGHT) {
      if (x < labelW) return;
      drag.current = { kind: 'loop', beat0: Math.max(0, beatAt(x)), x0: x, moved: false };
      event.currentTarget.setPointerCapture(event.pointerId);
      return;
    }
    const found = hit(x, y);
    if (found) {
      let ids = new Set(selectedClipIds);
      if (event.shiftKey) {
        if (ids.has(found.clip.id)) ids.delete(found.clip.id);
        else ids.add(found.clip.id);
      } else if (!ids.has(found.clip.id)) ids = new Set([found.clip.id]);
      onSelectClips(ids);
      onActivateClip(found.clip.id);
      if (!canEdit || event.shiftKey) return;
      const list = [...ids].filter((id) => doc.clips[id]);
      drag.current = found.edge
        ? { kind: 'resize', ids: list, x0: x, moved: false }
        : { kind: 'move', anchor: found.clip, ids: list, x0: x, y0: y, moved: false };
      event.currentTarget.setPointerCapture(event.pointerId);
      return;
    }
    if (x < labelW) return;
    if (!event.shiftKey) onSelectClips(new Set());
    const lane = laneAt(y);
    const trackId = lanes[lane];
    if (!canEdit || !trackId) return;
    drag.current = { kind: 'create', trackId, lane, beat0: beatAt(x), x0: x, moved: false };
    event.currentTarget.setPointerCapture(event.pointerId);
  }

  function onPointerMove(event: PointerEvent<HTMLCanvasElement>) {
    const { x, y } = local(event);
    const current = drag.current;
    if (!current) {
      const found = canEdit ? hit(x, y) : null;
      setCursor(
        found
          ? found.edge
            ? 'ew-resize'
            : 'grab'
          : y < ARRANGEMENT_RULER_HEIGHT
            ? 'text'
            : 'default',
      );
      return;
    }
    if (
      !current.moved &&
      Math.abs(x - current.x0) < DRAG_THRESHOLD &&
      (current.kind !== 'move' || Math.abs(y - current.y0) < DRAG_THRESHOLD)
    )
      return;
    current.moved = true;
    const rawDelta = (x - current.x0) / pxPerBeat;
    if (current.kind === 'move') {
      const laneDelta = Math.round((y - current.y0) / ARRANGEMENT_LANE_HEIGHT);
      setPreview({
        kind: 'move',
        ids: new Set(current.ids),
        deltaBeats: Math.max(
          -Math.min(...current.ids.map((id) => doc.clips[id]?.startBeat ?? 0)),
          snappedDelta(current.anchor.startBeat, rawDelta, snapId),
        ),
        laneDelta,
        duplicate: event.altKey,
      });
      setCursor(event.altKey ? 'copy' : 'grabbing');
    } else if (current.kind === 'resize') {
      setPreview({ kind: 'resize', ids: new Set(current.ids), deltaBeats: rawDelta });
    } else {
      const a = Math.max(0, current.beat0);
      const b = Math.max(0, beatAt(x));
      const from = snapFloor(Math.min(a, b), snapId);
      const to = Math.max(from + (snapBeats(snapId) || 1 / 32), snap(Math.max(a, b), snapId));
      setPreview(
        current.kind === 'create'
          ? { kind: 'create', lane: current.lane, from, to }
          : { kind: 'loop', from, to },
      );
    }
  }

  function onPointerUp(event: PointerEvent<HTMLCanvasElement>) {
    const current = drag.current;
    drag.current = null;
    const done = preview;
    setPreview(null);
    if (!current) return;
    if (!current.moved) {
      if (current.kind === 'loop') port.seek?.(snap(current.beat0, snapId));
      return;
    }
    if (current.kind === 'loop' && done?.kind === 'loop') {
      port.setLoop?.({ startBeat: done.from, endBeat: done.to, enabled: true });
      return;
    }
    if (!canEdit) return;
    if (done?.kind === 'move') {
      const ops = moveClipsOps(
        doc,
        current.kind === 'move' ? current.ids : [],
        done.deltaBeats,
        done.laneDelta,
        event.altKey,
        newId,
      );
      if (ops.length) port.dispatch(ops);
      if (
        done.laneDelta &&
        !ops.some((op) => op.op === 'clip.set' && op.field === 'trackId') &&
        !event.altKey
      )
        onHint(t('Klip bu tür bir parçaya taşınamaz'));
      if (event.altKey) {
        const created = ops.flatMap((op) => (op.op === 'clip.create' ? [op.clip.id] : []));
        onSelectClips(new Set(created));
        if (created[0]) onActivateClip(created[0]);
      }
    } else if (done?.kind === 'resize') {
      const ops = resizeClipsOps(
        doc,
        current.kind === 'resize' ? current.ids : [],
        done.deltaBeats,
        snapId,
      );
      if (ops.length) port.dispatch(ops);
    } else if (done?.kind === 'create' && current.kind === 'create') {
      createClip(current.trackId, done.from, done.to - done.from);
    }
  }

  function createClip(trackId: string, start: number, length: number) {
    const track = doc.tracks[trackId];
    if (track?.kind === 'audio') {
      onHint(t('Ses parçalarına kayıt yakında geliyor; şimdilik klip oluşturulamaz'));
      return;
    }
    const ops = createClipOps(doc, trackId, start, length, newId);
    if (!ops.length) return;
    port.dispatch(ops);
    const created = ops[0].op === 'clip.create' ? ops[0].clip.id : null;
    if (created) {
      onSelectClips(new Set([created]));
      onActivateClip(created);
    }
  }

  function onDoubleClick(event: MouseEvent<HTMLCanvasElement>) {
    if (!canEdit) return;
    const { x, y } = local(event);
    if (x < labelW || y < ARRANGEMENT_RULER_HEIGHT || hit(x, y)) return;
    const trackId = lanes[laneAt(y)];
    if (!trackId) return;
    const bar = barBeats(doc.timeSignature);
    createClip(trackId, Math.floor(Math.max(0, beatAt(x)) / bar) * bar, bar);
  }

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    const command = editorCommand(event, isMacPlatform());
    if (!command) return;
    const ids = [...selectedClipIds].filter((id) => doc.clips[id]);
    if (command.kind === 'select-all') {
      event.preventDefault();
      onSelectClips(new Set(Object.keys(doc.clips)));
      return;
    }
    if (command.kind === 'clear-selection') {
      onSelectClips(new Set());
      return;
    }
    if (!ids.length || !canEdit) return;
    if (command.kind === 'delete') {
      event.preventDefault();
      port.dispatch(deleteClipsOps(doc, ids));
      onSelectClips(new Set());
      if (activeClipId && ids.includes(activeClipId)) onActivateClip(null);
    } else if (command.kind === 'duplicate') {
      event.preventDefault();
      const ops = duplicateClipsOps(doc, ids, newId);
      port.dispatch(ops);
      onSelectClips(new Set(ops.flatMap((op) => (op.op === 'clip.create' ? [op.clip.id] : []))));
    } else if (command.kind === 'nudge') {
      event.preventDefault();
      const step = command.coarse
        ? barBeats(doc.timeSignature)
        : snapBeats(snapId) || unitBeats(doc.timeSignature);
      const ops = moveClipsOps(doc, ids, command.beats * step, -command.pitch, false, newId);
      if (ops.length) port.dispatch(ops);
    }
  }

  return (
    <div className="relative flex min-h-0 flex-1 flex-col">
      <div
        ref={scroller}
        className="relative min-h-0 flex-1 overflow-auto outline-none focus-visible:ring-2 focus-visible:ring-border-focus-ring"
        tabIndex={0}
        role="application"
        aria-label={t('Düzenleme zaman çizelgesi')}
        aria-roledescription={t('Zaman çizelgesi')}
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
            data-testid="arrangement-canvas"
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
      <div
        ref={playhead}
        aria-hidden
        className="pointer-events-none absolute top-0 bottom-0 left-0 w-px bg-text-primary"
        style={{ display: 'none' }}
      />
      {!lanes.length ? (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
          <p className="text-body-regular text-text-tertiary">
            {t('Henüz parça yok. Parça ekledikten sonra çift tıklayarak klip oluşturabilirsin.')}
          </p>
        </div>
      ) : null}
    </div>
  );
}
