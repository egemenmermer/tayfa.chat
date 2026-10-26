import type { StudioTimeSignature } from '@rooms/studio';

// Musical grid math shared by the editors. A beat is a quarter note (ST-engine decision); a bar is
// beats·4/unit beats, so 6/8 has 3 beats per bar.

export type SnapId = '1/4' | '1/8' | '1/16' | 'off';
export const SNAP_IDS: readonly SnapId[] = ['1/4', '1/8', '1/16', 'off'];

/** Positions with snap off are still rounded to this, so stored values stay short. */
export const FREE_RESOLUTION = 1 / 96;
/** Shortest note or clip a gesture can produce when snap is off. */
export const MIN_LENGTH = 1 / 32;
/** Drum steps are sixteenth notes. */
export const STEP_BEATS = 0.25;

export function snapBeats(snap: SnapId): number {
  switch (snap) {
    case '1/4':
      return 1;
    case '1/8':
      return 0.5;
    case '1/16':
      return 0.25;
    default:
      return 0;
  }
}

export function barBeats(signature: StudioTimeSignature): number {
  return (signature.beats * 4) / signature.unit;
}

/** Spacing of the light grid lines inside a bar (one metronome click). */
export function unitBeats(signature: StudioTimeSignature): number {
  return 4 / signature.unit;
}

function round(value: number, step: number): number {
  // The extra rounding keeps 0.1 + 0.2 style noise out of stored positions.
  return Number((Math.round(value / step) * step).toFixed(6));
}

/** Nearest grid position (or the fine free resolution when snap is off). */
export function snap(beat: number, snapId: SnapId): number {
  const step = snapBeats(snapId) || FREE_RESOLUTION;
  return round(beat, step);
}

/** Grid position at or before `beat`: where a click inside a cell lands. */
export function snapFloor(beat: number, snapId: SnapId): number {
  const step = snapBeats(snapId) || FREE_RESOLUTION;
  return Number((Math.floor(beat / step + 1e-9) * step).toFixed(6));
}

/** Smallest length a gesture may produce under the snap setting. */
export function minLength(snapId: SnapId): number {
  return snapBeats(snapId) || MIN_LENGTH;
}

/** Default length of a new note: one grid cell, or a sixteenth when snap is off. */
export function newNoteLength(snapId: SnapId): number {
  return snapBeats(snapId) || STEP_BEATS;
}

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];

/** Scientific pitch name with MIDI 60 = C4. */
export function noteName(pitch: number): string {
  return `${NOTE_NAMES[pitch % 12]}${Math.floor(pitch / 12) - 1}`;
}

export function isBlackKey(pitch: number): boolean {
  return [1, 3, 6, 8, 10].includes(pitch % 12);
}

/** "bar.beat" (1-based) for readouts and tooltips. */
export function formatPosition(beat: number, signature: StudioTimeSignature): string {
  const bar = barBeats(signature);
  const unit = unitBeats(signature);
  const barIndex = Math.floor(beat / bar + 1e-9);
  const inBar = beat - barIndex * bar;
  return `${barIndex + 1}.${Math.floor(inBar / unit + 1e-9) + 1}`;
}

/** Visible range culling: [first, last) beats for a viewport. */
export function visibleBeats(scrollLeft: number, width: number, pxPerBeat: number) {
  return { from: scrollLeft / pxPerBeat, to: (scrollLeft + width) / pxPerBeat };
}
