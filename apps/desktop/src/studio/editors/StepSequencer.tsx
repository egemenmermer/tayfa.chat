import { useEffect, useMemo, useRef, useState, type PointerEvent } from 'react';
import { t } from '../../i18n';
import { drumRows } from '../engine/instruments';
import { usePlayheadLine } from './canvas';
import { chartToken } from './colors';
import {
  ACCENT_THRESHOLD,
  clipNotes,
  DEFAULT_VELOCITY,
  setStepsOps,
  stepCells,
  stepCount,
  stepsPerBar,
  toggleAccentOps,
  type NewId,
} from './edit-ops';
import { noteName, STEP_BEATS } from './grid';
import type { EditorPort } from './port';

const LABEL_WIDTH = 128;
const CELL = 24;
const GAP = 2;
const BEAT_GAP = 6;

export type StepMode = 'steps' | 'accent';

export interface StepRow {
  pitch: number;
  label: string;
  /** Pitches the clip uses outside the kit rows are shown so they never vanish silently. */
  extra: boolean;
}

/** Kit rows (engine registry) plus any other pitch the clip's notes use. */
export function stepRows(pitches: Iterable<number>): StepRow[] {
  const rows: StepRow[] = drumRows().map((row) => ({ ...row, extra: false }));
  const known = new Set(rows.map((row) => row.pitch));
  const extra = [...new Set(pitches)].filter((pitch) => !known.has(pitch)).sort((a, b) => b - a);
  for (const pitch of extra) rows.push({ pitch, label: noteName(pitch), extra: true });
  return rows;
}

export interface StepSequencerProps {
  port: EditorPort;
  clipId: string;
  mode: StepMode;
  newId: NewId;
}

/** Drum step grid: a view of the clip's notes (sixteenths), edited with the same ops as the piano roll. */
export function StepSequencer({ port, clipId, mode, newId }: StepSequencerProps) {
  const { doc, canEdit } = port;
  const clip = doc.clips[clipId];
  const track = clip ? doc.tracks[clip.trackId] : undefined;
  const notes = clip ? clipNotes(doc, clip.id) : [];
  const cells = useMemo(() => stepCells(notes), [notes]);
  const rows = useMemo(() => stepRows(notes.map((note) => note.pitch)), [notes]);
  const perBar = stepsPerBar(doc.timeSignature);
  const steps = clip ? stepCount(clip) : 0;
  const scroller = useRef<HTMLDivElement>(null);
  const playhead = useRef<HTMLDivElement>(null);
  const paint = useRef<{ on: boolean; pitch: number } | null>(null);
  const [painted, setPainted] = useState<Set<string>>(new Set());

  const stepX = (step: number) =>
    LABEL_WIDTH + step * (CELL + GAP) + Math.floor(step / 4) * BEAT_GAP;

  usePlayheadLine(playhead, port, (beat) => {
    if (!clip) return null;
    const local = beat - clip.startBeat;
    if (local < 0 || local >= clip.lengthBeats) return null;
    const step = Math.floor(local / STEP_BEATS);
    // The line lives inside the scrolled content, so no scroll offset.
    return stepX(step) + (local / STEP_BEATS - step) * CELL;
  });

  // A paint drag ends wherever the pointer is released.
  useEffect(() => {
    const finish = () => {
      const current = paint.current;
      paint.current = null;
      setPainted((pending) => {
        if (current && pending.size && clip) {
          const list = [...pending].map((key) => {
            const [pitch, step] = key.split(':').map(Number);
            return { pitch, step };
          });
          const ops = setStepsOps(port.doc, clip.id, list, current.on, newId);
          if (ops.length) queueMicrotask(() => port.dispatch(ops));
        }
        return new Set();
      });
    };
    window.addEventListener('pointerup', finish);
    window.addEventListener('pointercancel', finish);
    return () => {
      window.removeEventListener('pointerup', finish);
      window.removeEventListener('pointercancel', finish);
    };
  }, [port, clip, newId]);

  if (!clip || !track) return null;

  function onCellDown(event: PointerEvent<HTMLButtonElement>, pitch: number, step: number) {
    if (event.button !== 0 || !canEdit || !clip || !track) return;
    event.preventDefault();
    const key = `${pitch}:${step}`;
    const filled = cells.has(key);
    if (mode === 'accent' || (event.shiftKey && filled)) {
      const ops = toggleAccentOps(doc, clip.id, pitch, step);
      if (ops.length) port.dispatch(ops);
      return;
    }
    paint.current = { on: !filled, pitch };
    if (!filled) port.preview(track.id, pitch, DEFAULT_VELOCITY);
    setPainted(new Set([key]));
    // Pointer capture would keep enter events from the other cells.
    event.currentTarget.releasePointerCapture?.(event.pointerId);
  }

  function onCellEnter(pitch: number, step: number) {
    const current = paint.current;
    if (!current || current.pitch !== pitch) return;
    setPainted((pending) => new Set(pending).add(`${pitch}:${step}`));
  }

  function onCellKey(pitch: number, step: number, shift: boolean) {
    if (!canEdit || !clip || !track) return;
    const key = `${pitch}:${step}`;
    const filled = cells.has(key);
    if (mode === 'accent' || (shift && filled)) {
      const ops = toggleAccentOps(doc, clip.id, pitch, step);
      if (ops.length) port.dispatch(ops);
      return;
    }
    port.dispatch(setStepsOps(doc, clip.id, [{ pitch, step }], !filled, newId));
    if (!filled) port.preview(track.id, pitch, DEFAULT_VELOCITY);
  }

  const colourVar = `var(${chartToken(track.color)})`;
  const width = stepX(steps) + 12;
  return (
    <div className="relative flex min-h-0 flex-1 flex-col">
      <div
        ref={scroller}
        className="relative min-h-0 flex-1 overflow-auto"
        role="grid"
        aria-label={t('Davul adımları')}
        aria-readonly={!canEdit}
      >
        <div style={{ width, position: 'relative' }} className="py-2">
          <div role="row" className="flex h-6 items-end" style={{ width }}>
            <span
              className="sticky left-0 z-10 shrink-0 bg-background-canvas"
              style={{ width: LABEL_WIDTH }}
            />
            {Array.from({ length: steps }, (_, step) => (
              <span
                key={step}
                role="columnheader"
                className="absolute text-caption-2-medium text-text-tertiary tabular-nums"
                style={{ left: stepX(step) + 2 }}
              >
                {step % perBar === 0
                  ? Math.floor((clip.startBeat + step * STEP_BEATS) / (perBar * STEP_BEATS)) + 1
                  : step % 4 === 0
                    ? '·'
                    : ''}
              </span>
            ))}
          </div>
          {rows.map((row) => (
            <div
              key={row.pitch}
              role="row"
              className="relative flex items-center"
              style={{ height: CELL + GAP * 2 }}
            >
              <span
                role="rowheader"
                className="sticky left-0 z-10 flex h-full shrink-0 items-center gap-1.5 truncate bg-background-canvas pe-2 ps-3 text-body-medium text-text-secondary"
                style={{ width: LABEL_WIDTH }}
                title={row.extra ? t('Bu nota kitin satırlarında yok') : undefined}
              >
                <span className="truncate">{row.label}</span>
                {row.extra ? (
                  <span className="text-caption-2-medium text-text-tertiary">{t('kit dışı')}</span>
                ) : null}
              </span>
              {Array.from({ length: steps }, (_, step) => {
                const key = `${row.pitch}:${step}`;
                const present = cells.get(key);
                const pending = painted.has(key) && paint.current;
                const on = pending ? paint.current!.on : !!present;
                const accent = !!present?.some((note) => note.velocity >= ACCENT_THRESHOLD);
                const downbeat = step % 4 === 0;
                return (
                  <button
                    key={step}
                    type="button"
                    role="gridcell"
                    aria-pressed={on}
                    aria-label={t('{row}, adım {step}', { row: row.label, step: step + 1 })}
                    className="absolute rounded-md border transition-colors duration-75 focus-visible:outline-2 focus-visible:outline-border-focus-ring"
                    style={{
                      left: stepX(step),
                      width: CELL,
                      height: CELL,
                      background: on
                        ? accent
                          ? colourVar
                          : `color-mix(in srgb, ${colourVar} 62%, transparent)`
                        : downbeat
                          ? 'var(--color-background-tertiary-default)'
                          : 'var(--color-background-secondary-default)',
                      borderColor: on
                        ? accent
                          ? 'var(--color-text-white)'
                          : colourVar
                        : 'var(--color-border-subtle)',
                      cursor: canEdit ? 'pointer' : 'default',
                    }}
                    onPointerDown={(event) => onCellDown(event, row.pitch, step)}
                    onPointerEnter={() => onCellEnter(row.pitch, step)}
                    onKeyDown={(event) => {
                      if (event.key !== ' ' && event.key !== 'Enter') return;
                      event.preventDefault();
                      onCellKey(row.pitch, step, event.shiftKey);
                    }}
                  />
                );
              })}
            </div>
          ))}
        </div>
        <div
          ref={playhead}
          aria-hidden
          className="pointer-events-none absolute top-0 bottom-0 left-0 w-0.5 rounded-full bg-text-primary opacity-70"
          style={{ display: 'none' }}
        />
      </div>
    </div>
  );
}
