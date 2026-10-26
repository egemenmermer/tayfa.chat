import { describe, expect, it } from 'vitest';
import {
  barsToSeconds,
  beatsToSeconds,
  demoSong,
  drumVoice,
  expandSong,
  midiToFrequency,
  type SpikeSong,
} from '../apps/desktop/src/studio/engine/schedule';
import { encodeWav, rms } from '../apps/desktop/src/studio/engine/wav';

const ascii = (bytes: Uint8Array, start: number, length: number) =>
  String.fromCharCode(...bytes.subarray(start, start + length));

describe('Studio WAV export', () => {
  it('writes a canonical 16-bit PCM RIFF header', () => {
    const left = new Float32Array([0, 0.5, -0.5]);
    const right = new Float32Array([1, -1, 0]);
    const wav = encodeWav([left, right], 44100);
    const view = new DataView(wav.buffer);
    expect(wav.length).toBe(44 + 3 * 2 * 2);
    expect(ascii(wav, 0, 4)).toBe('RIFF');
    expect(view.getUint32(4, true)).toBe(wav.length - 8);
    expect(ascii(wav, 8, 8)).toBe('WAVEfmt ');
    expect(view.getUint32(16, true)).toBe(16);
    expect(view.getUint16(20, true)).toBe(1);
    expect(view.getUint16(22, true)).toBe(2);
    expect(view.getUint32(24, true)).toBe(44100);
    expect(view.getUint32(28, true)).toBe(44100 * 4);
    expect(view.getUint16(32, true)).toBe(4);
    expect(view.getUint16(34, true)).toBe(16);
    expect(ascii(wav, 36, 4)).toBe('data');
    expect(view.getUint32(40, true)).toBe(12);
  });

  it('interleaves frames and clips samples to the 16-bit range', () => {
    const wav = encodeWav([new Float32Array([0, 2, -0.5]), new Float32Array([1, -3, Number.NaN])], 48000);
    const view = new DataView(wav.buffer);
    const samples = Array.from({ length: 6 }, (_, i) => view.getInt16(44 + i * 2, true));
    expect(samples).toEqual([0, 32767, 32767, -32768, -16384, 0]);
  });

  it('rejects mismatched channels and invalid sample rates', () => {
    expect(() => encodeWav([new Float32Array(2), new Float32Array(3)], 44100)).toThrow(RangeError);
    expect(() => encodeWav([], 44100)).toThrow(RangeError);
    expect(() => encodeWav([new Float32Array(2)], 44100.5)).toThrow(RangeError);
  });

  it('measures RMS', () => {
    expect(rms([new Float32Array(8)])).toBe(0);
    expect(rms([new Float32Array([1, -1, 1, -1])])).toBe(1);
  });
});

describe('Studio scheduling math', () => {
  it('converts beats and bars to seconds at the song tempo', () => {
    expect(beatsToSeconds(4, 120)).toBe(2);
    expect(barsToSeconds(4, { tempo: 120, beatsPerBar: 4 })).toBe(8);
    expect(barsToSeconds(2, { tempo: 90, beatsPerBar: 3 })).toBe(4);
    expect(() => beatsToSeconds(1, 0)).toThrow(RangeError);
    expect(() => beatsToSeconds(1, 300)).toThrow(RangeError);
  });

  it('maps MIDI pitches to frequency and drum voices', () => {
    expect(midiToFrequency(69)).toBe(440);
    expect(midiToFrequency(57)).toBeCloseTo(220, 10);
    expect(drumVoice(36)).toBe('kick');
    expect(drumVoice(38)).toBe('snare');
    expect(drumVoice(42)).toBe('hat');
    expect(drumVoice(60)).toBeNull();
  });

  it('repeats loops over the bars, drops notes past the end and clamps ringing notes', () => {
    const song: SpikeSong = {
      tempo: 120,
      beatsPerBar: 4,
      parts: [
        {
          id: 'lead',
          instrument: 'poly',
          loopBeats: 6,
          notes: [
            { beat: 0, length: 1, pitch: 60, velocity: 127 },
            { beat: 3, length: 4, pitch: 64, velocity: 0 },
            { beat: 6, length: 1, pitch: 99, velocity: 64 }, // outside its own loop: ignored
          ],
        },
      ],
    };
    // 2 bars = 8 beats = 4 s; the loop of 6 beats starts at 0 and 6.
    const notes = expandSong(song, 2);
    expect(notes.map((note) => [note.time, note.duration, note.pitch])).toEqual([
      [0, 0.5, 60],
      [1.5, 2, 64], // notes may ring over the loop restart (beat 3 → 7)
      [3, 0.5, 60], // second pass; its beat-3 note would start at beat 9, past the end

    ]);
    expect(notes[0].velocity).toBe(1);
    expect(notes[1].velocity).toBeCloseTo(1 / 127, 10);
  });

  it('clamps a note that rings past the last bar', () => {
    const song: SpikeSong = {
      tempo: 60,
      beatsPerBar: 4,
      parts: [{ id: 'pad', instrument: 'poly', loopBeats: 4, notes: [{ beat: 2, length: 8, pitch: 60, velocity: 90 }] }],
    };
    expect(expandSong(song, 1).map((note) => [note.time, note.duration])).toEqual([[2, 2]]);
  });

  it('expands the demo groove over 4 bars, per part, time-sorted', () => {
    const song = demoSong(120);
    const all = expandSong(song, 4);
    expect(all.filter((note) => note.partId === 'drums')).toHaveLength(4 * (4 + 2 + 8));
    expect(all.filter((note) => note.partId === 'bass')).toHaveLength(12);
    expect(all.filter((note) => note.partId === 'chords')).toHaveLength(12);
    expect(all.every((note, i) => i === 0 || all[i - 1].time <= note.time)).toBe(true);
    expect(Math.max(...all.map((note) => note.time + note.duration))).toBeLessThanOrEqual(8);
    expect(expandSong(song, 4, ['bass']).every((note) => note.partId === 'bass')).toBe(true);
    expect(() => expandSong(song, 0)).toThrow(RangeError);
  });
});
