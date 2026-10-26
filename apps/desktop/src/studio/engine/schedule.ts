// Pure scheduling math for the Studio audio engine. No Web Audio or Tone imports here, so it runs under
// vitest without an audio device. The song description below is a spike-only shape, NOT the Studio
// contract (packages/studio owns that); the real engine maps contract notes onto `ScheduledNote`.

export type SpikeInstrument = 'drums' | 'bass' | 'poly';

export interface SpikeNote {
  /** Start in beats, relative to the start of the part's loop. */
  beat: number;
  /** Length in beats. */
  length: number;
  /** MIDI pitch 0–127. For drums: 36 kick, 38 snare, 42 closed hat. */
  pitch: number;
  /** MIDI velocity 1–127. */
  velocity: number;
}

export interface SpikePart {
  id: string;
  instrument: SpikeInstrument;
  /** The part repeats every `loopBeats` beats. */
  loopBeats: number;
  notes: SpikeNote[];
}

export interface SpikeSong {
  tempo: number;
  beatsPerBar: number;
  parts: SpikePart[];
}

export interface ScheduledNote {
  partId: string;
  instrument: SpikeInstrument;
  /** Seconds from the start of the render or transport. */
  time: number;
  /** Seconds; clamped so a note never sounds past the end of the rendered bars. */
  duration: number;
  pitch: number;
  /** 0–1 gain for the synth trigger. */
  velocity: number;
}

export type DrumVoice = 'kick' | 'snare' | 'hat';

export const MIN_TEMPO = 40;
export const MAX_TEMPO = 240;

export function beatsToSeconds(beats: number, tempo: number): number {
  if (!(tempo >= MIN_TEMPO && tempo <= MAX_TEMPO))
    throw new RangeError(`Tempo out of range: ${tempo}`);
  return (beats * 60) / tempo;
}

export function barsToSeconds(
  bars: number,
  song: Pick<SpikeSong, 'tempo' | 'beatsPerBar'>,
): number {
  return beatsToSeconds(bars * song.beatsPerBar, song.tempo);
}

export function midiToFrequency(pitch: number): number {
  return 440 * 2 ** ((pitch - 69) / 12);
}

export function drumVoice(pitch: number): DrumVoice | null {
  if (pitch === 35 || pitch === 36) return 'kick';
  if (pitch === 38 || pitch === 40) return 'snare';
  if (pitch === 42 || pitch === 44 || pitch === 46) return 'hat';
  return null;
}

/**
 * Expands every part's loop over `bars` bars into absolute, time-sorted notes. Notes that start at or
 * after the end are dropped; notes that would ring past the end are shortened to end exactly there.
 */
export function expandSong(
  song: SpikeSong,
  bars: number,
  partIds?: readonly string[],
): ScheduledNote[] {
  if (!Number.isInteger(bars) || bars < 1)
    throw new RangeError(`Bars must be a positive integer: ${bars}`);
  const totalBeats = bars * song.beatsPerBar;
  const out: ScheduledNote[] = [];
  for (const part of song.parts) {
    if (partIds && !partIds.includes(part.id)) continue;
    if (!(part.loopBeats > 0)) throw new RangeError(`Loop length must be positive: ${part.id}`);
    for (let loopStart = 0; loopStart < totalBeats; loopStart += part.loopBeats) {
      for (const note of part.notes) {
        if (note.beat < 0 || note.beat >= part.loopBeats || !(note.length > 0)) continue;
        const start = loopStart + note.beat;
        if (start >= totalBeats) continue;
        const end = Math.min(start + note.length, totalBeats);
        out.push({
          partId: part.id,
          instrument: part.instrument,
          time: beatsToSeconds(start, song.tempo),
          duration: beatsToSeconds(end - start, song.tempo),
          pitch: note.pitch,
          velocity: Math.min(127, Math.max(1, note.velocity)) / 127,
        });
      }
    }
  }
  return out.sort(
    (a, b) => a.time - b.time || a.partId.localeCompare(b.partId) || a.pitch - b.pitch,
  );
}

/** A 4/4 groove used by the spike harness: four-on-the-floor drums, a root bass line, triad chords. */
export function demoSong(tempo = 120): SpikeSong {
  const drums: SpikeNote[] = [];
  for (let beat = 0; beat < 4; beat += 1)
    drums.push({ beat, length: 0.25, pitch: 36, velocity: 120 });
  drums.push(
    { beat: 1, length: 0.25, pitch: 38, velocity: 110 },
    { beat: 3, length: 0.25, pitch: 38, velocity: 110 },
  );
  for (let step = 0; step < 8; step += 1)
    drums.push({ beat: step / 2, length: 0.125, pitch: 42, velocity: step % 2 ? 70 : 95 });
  const roots = [45, 41, 36, 43]; // A2 F2 C2 G2: Am F C G
  const bass = roots.flatMap((root, bar) => [
    { beat: bar * 4, length: 1.5, pitch: root, velocity: 110 },
    { beat: bar * 4 + 2, length: 1, pitch: root + 12, velocity: 90 },
    { beat: bar * 4 + 3, length: 1, pitch: root + 7, velocity: 90 },
  ]);
  const chords = [
    [57, 60, 64],
    [53, 57, 60],
    [48, 52, 55],
    [55, 59, 62],
  ].flatMap((pitches, bar) =>
    pitches.map((pitch) => ({ beat: bar * 4, length: 3.5, pitch, velocity: 80 })),
  );
  return {
    tempo,
    beatsPerBar: 4,
    parts: [
      { id: 'drums', instrument: 'drums', loopBeats: 4, notes: drums },
      { id: 'bass', instrument: 'bass', loopBeats: 16, notes: bass },
      { id: 'chords', instrument: 'poly', loopBeats: 16, notes: chords },
    ],
  };
}
