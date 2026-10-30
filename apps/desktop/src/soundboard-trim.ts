/** Pure trim math for the soundboard: seconds <-> samples, handle limits and waveform peaks. */
export const SOUNDBOARD_MAX_SECONDS = 8;
/** Shortest selection a handle can leave; keeps the clip audible and the handles apart. */
export const SOUNDBOARD_MIN_SECONDS = 0.05;
/** Source files are only trimmed down, so they may be longer than a stored sound. */
export const SOUNDBOARD_SOURCE_MAX_SECONDS = 180;
export const SOUNDBOARD_SOURCE_MAX_BYTES = 30_000_000;
/** Cut edges get a short ramp so a cut in the middle of a wave does not click. */
export const SOUNDBOARD_FADE_SECONDS = 0.004;

export type TrimSelection = { start: number; end: number };

export const secondsToSample = (seconds: number, rate: number) => Math.round(seconds * rate);
export const sampleToSeconds = (sample: number, rate: number) => sample / rate;

const minimum = (duration: number) => Math.min(SOUNDBOARD_MIN_SECONDS, duration);

/** The selection a new file starts with: its beginning, at most the stored maximum. */
export function initialSelection(duration: number): TrimSelection {
  return { start: 0, end: Math.min(duration, SOUNDBOARD_MAX_SECONDS) };
}

/**
 * Keeps a selection inside the file, at least the minimum and at most the maximum long.
 * `moved` is the handle the user is dragging: when the limit is hit the other handle stays put
 * unless the maximum forces it to slide along.
 */
export function clampSelection(
  selection: TrimSelection,
  duration: number,
  moved: 'start' | 'end',
): TrimSelection {
  const min = minimum(duration);
  let { start, end } = selection;
  if (!Number.isFinite(start)) start = 0;
  if (!Number.isFinite(end)) end = duration;
  if (moved === 'start') {
    start = Math.min(Math.max(start, 0), duration - min);
    end = Math.min(Math.max(end, start + min), duration);
    if (end - start > SOUNDBOARD_MAX_SECONDS) end = start + SOUNDBOARD_MAX_SECONDS;
  } else {
    end = Math.min(Math.max(end, min), duration);
    start = Math.max(Math.min(start, end - min), 0);
    if (end - start > SOUNDBOARD_MAX_SECONDS) start = end - SOUNDBOARD_MAX_SECONDS;
  }
  return { start, end };
}

export const nudgeSelection = (
  selection: TrimSelection,
  duration: number,
  handle: 'start' | 'end',
  delta: number,
) => clampSelection({ ...selection, [handle]: selection[handle] + delta }, duration, handle);

export type TrimIssue = 'empty' | 'too-short' | 'too-long';
export function trimIssue(selection: TrimSelection, duration: number): TrimIssue | null {
  const length = selection.end - selection.start;
  if (!(duration > 0) || !(length > 0) || selection.start < 0 || selection.end > duration + 1e-9)
    return 'empty';
  if (length < minimum(duration) - 1e-9) return 'too-short';
  // Half a sample of slack: the selection comes out of float math.
  if (length > SOUNDBOARD_MAX_SECONDS + 1e-9) return 'too-long';
  return null;
}

/** True when saving would store less than the whole file. */
export const isTrimmed = (selection: TrimSelection, duration: number) =>
  selection.start > 0.001 || selection.end < duration - 0.001;

/** Sample range [from, to) of a selection; never longer than the stored maximum. */
export function selectionSamples(selection: TrimSelection, rate: number, length: number) {
  const from = Math.min(
    Math.max(secondsToSample(selection.start, rate), 0),
    Math.max(length - 1, 0),
  );
  const to = Math.min(
    Math.max(secondsToSample(selection.end, rate), from + 1),
    length,
    from + SOUNDBOARD_MAX_SECONDS * rate,
  );
  return { from, to };
}

/** Largest absolute sample per bucket across all channels, for drawing the waveform. */
export function waveformPeaks(channels: ArrayLike<number>[], buckets: number): number[] {
  const length = channels[0]?.length ?? 0;
  if (!length || buckets < 1) return [];
  const peaks = new Array<number>(buckets).fill(0);
  for (let bucket = 0; bucket < buckets; bucket++) {
    const from = Math.floor((bucket * length) / buckets),
      to = Math.max(from + 1, Math.floor(((bucket + 1) * length) / buckets));
    let peak = 0;
    for (const data of channels)
      for (let i = from; i < to && i < length; i++) peak = Math.max(peak, Math.abs(data[i]));
    peaks[bucket] = Math.min(peak, 1);
  }
  return peaks;
}

/** "3,2 sn" style readout; one decimal, locale-neutral dot. */
export const formatSeconds = (seconds: number) => seconds.toFixed(2);
