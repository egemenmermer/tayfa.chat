import { describe, expect, it } from 'vitest';
import {
  applyOps,
  createProject,
  defaultTrack,
  type StudioClip,
  type StudioNote,
  type StudioProject,
} from '@rooms/studio';
import {
  AUDIO_INSTRUMENT,
  drumHit,
  drumRows,
  instrumentChoices,
  instrumentLabel,
  instrumentProblem,
  midiToFrequency,
  resolveInstrument,
} from '../apps/desktop/src/studio/engine/instruments';
import {
  audibleTrackIds,
  barBeats,
  beatsToSeconds,
  beatToTicks,
  clickBeats,
  exportRange,
  linearToDb,
  MAX_EXPORT_SECONDS,
  metronomeClicks,
  normalizeLoop,
  planProject,
  PPQ,
  sameNotes,
  tailSeconds,
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
    const wav = encodeWav(
      [new Float32Array([0, 2, -0.5]), new Float32Array([1, -3, Number.NaN])],
      48000,
    );
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

const base = () =>
  createProject({
    id: 'p1',
    roomId: 'room1',
    name: 'Test',
    createdBy: 'u1',
    createdAt: 1,
    template: 'drums-bass',
  });

const midiClip = (
  id: string,
  trackId: string,
  startBeat: number,
  lengthBeats: number,
): StudioClip => ({
  id,
  trackId,
  startBeat,
  lengthBeats,
  name: '',
  kind: 'midi',
});

const note = (
  id: string,
  clipId: string,
  pitch: number,
  startBeat: number,
  lengthBeats: number,
): StudioNote => ({
  id,
  clipId,
  pitch,
  startBeat,
  lengthBeats,
  velocity: 127,
});

/** The template plus a piano track with one clip at beat 8. */
function withPiano(notes: StudioNote[], clip = midiClip('pc', 'piano', 8, 4)): StudioProject {
  const result = applyOps(base(), [
    { op: 'track.create', track: defaultTrack('piano', 'instrument') },
    { op: 'clip.create', clip },
    ...notes.map((value) => ({ op: 'note.create' as const, note: value })),
  ]);
  expect(result.skipped).toEqual([]);
  return result.doc;
}

const setTrack = (
  project: StudioProject,
  id: string,
  patch: Partial<StudioProject['tracks'][string]>,
) => ({
  ...project,
  tracks: { ...project.tracks, [id]: { ...project.tracks[id], ...patch } },
});

describe('Studio instruments', () => {
  it('resolves built-in instruments, reports unknown ones and treats audio as not yet playable', () => {
    for (const ref of ['piano@1', 'drum-kit@1', 'bass@1', 'synth-lead@1', 'synth-pad@1'])
      expect(resolveInstrument(ref)).toMatchObject({ status: 'ok', instrument: { ref } });
    expect(resolveInstrument('piano@2')).toEqual({ status: 'unknown', id: 'piano@2' });
    expect(resolveInstrument('baglama@1')).toEqual({ status: 'unknown', id: 'baglama@1' });
    expect(resolveInstrument(AUDIO_INSTRUMENT)).toEqual({ status: 'unsupported', id: 'audio@1' });
    expect(instrumentProblem(resolveInstrument('baglama@1'))).toBe(
      'Bu enstrüman için Tayfa’yı güncelle',
    );
    expect(instrumentProblem(resolveInstrument('piano@1'))).toBeNull();
    expect(instrumentLabel('baglama@1')).toBe('Bilinmeyen enstrüman');
  });

  it('lists the picker choices with Turkish labels', () => {
    expect(instrumentChoices()).toEqual([
      { ref: 'piano@1', label: 'Piyano', drums: false },
      { ref: 'drum-kit@1', label: 'Davul seti', drums: true },
      { ref: 'bass@1', label: 'Bas', drums: false },
      { ref: 'synth-lead@1', label: 'Lead synth', drums: false },
      { ref: 'synth-pad@1', label: 'Pad synth', drums: false },
    ]);
  });

  it('maps GM drum pitches 35–51 onto the synthesized kit', () => {
    for (let pitch = 35; pitch <= 51; pitch += 1)
      expect(drumHit(pitch), String(pitch)).not.toBeNull();
    expect(drumHit(36)?.voice).toBe('kick');
    expect(drumHit(37)?.voice).toBe('rim');
    expect(drumHit(38)?.voice).toBe('snare');
    expect(drumHit(39)?.voice).toBe('clap');
    expect(drumHit(42)?.voice).toBe('closed-hat');
    expect(drumHit(46)?.voice).toBe('open-hat');
    expect(drumHit(45)).toEqual({ voice: 'tom', frequency: 110 });
    expect(drumHit(34)).toBeNull();
    expect(drumHit(52)).toBeNull();
    expect(drumRows().every((row) => drumHit(row.pitch))).toBe(true);
    expect(midiToFrequency(69)).toBe(440);
  });
});

describe('Studio project plan', () => {
  it('maps the drums-bass template onto drum hits and bass notes in quarter beats', () => {
    const plan = planProject(base());
    expect(plan.tracks.map((track) => [track.id, track.instrument.status])).toEqual([
      ['tpl-drums', 'ok'],
      ['tpl-bass', 'ok'],
    ]);
    expect(plan.issues).toEqual([]);
    expect(plan.notes.filter((n) => n.trackId === 'tpl-drums')).toHaveLength(48);
    expect(plan.notes.filter((n) => n.trackId === 'tpl-bass')).toHaveLength(20);
    expect(plan.notes.filter((n) => n.trackId === 'tpl-drums').every((n) => n.drum)).toBe(true);
    expect(plan.notes.filter((n) => n.trackId === 'tpl-bass').some((n) => n.drum)).toBe(false);
    // Sorted by beat, then track order, then pitch.
    expect(plan.notes.slice(0, 3).map((n) => [n.beat, n.trackId, n.pitch])).toEqual([
      [0, 'tpl-drums', 36],
      [0, 'tpl-drums', 42],
      [0, 'tpl-bass', 36],
    ]);
    expect(plan.notes.at(-1)?.beat).toBe(15.5);
    expect(beatsToSeconds(16, plan.tempo)).toBe(8);
    expect(beatToTicks(1.5)).toBe(1.5 * PPQ);
  });

  it('places notes by clip offset, hides notes past the clip end and cuts long notes at it', () => {
    const plan = planProject(
      withPiano([
        note('n1', 'pc', 60, 1, 1),
        note('n2', 'pc', 64, 3, 4), // rings past the clip end (beat 12)
        note('n3', 'pc', 67, 4, 1), // starts at the clip end: hidden
        note('n4', 'pc', 72, 0, 0.5),
      ]),
      { trackIds: ['piano'] },
    );
    expect(plan.notes.map((n) => [n.noteId, n.beat, n.lengthBeats, n.velocity])).toEqual([
      ['n4', 8, 0.5, 1],
      ['n1', 9, 1, 1],
      ['n2', 11, 1, 1],
    ]);
  });

  it('limits notes to a beat range: earlier starts left out, notes cut at the end', () => {
    const project = withPiano([note('n1', 'pc', 60, 0, 2), note('n2', 'pc', 62, 2, 2)]);
    const plan = planProject(project, { fromBeat: 9, toBeat: 11, trackIds: ['piano'] });
    expect(plan.notes.map((n) => [n.noteId, n.beat, n.lengthBeats])).toEqual([['n2', 10, 1]]);
  });

  it('follows the mute and solo rules', () => {
    let project = withPiano([note('n1', 'pc', 60, 0, 1)]);
    expect([...audibleTrackIds(project)]).toEqual(['tpl-drums', 'tpl-bass', 'piano']);
    project = setTrack(project, 'tpl-bass', { mute: true });
    expect([...audibleTrackIds(project)]).toEqual(['tpl-drums', 'piano']);
    project = setTrack(project, 'piano', { solo: true });
    expect([...audibleTrackIds(project)]).toEqual(['piano']);
    // Mute wins over solo.
    project = setTrack(setTrack(project, 'tpl-bass', { solo: true }), 'piano', { mute: true });
    expect([...audibleTrackIds(project)]).toEqual([]);
    project = setTrack(project, 'tpl-bass', { mute: false });
    const plan = planProject(project, { audibleOnly: true });
    expect(new Set(plan.notes.map((n) => n.trackId))).toEqual(new Set(['tpl-bass']));
    expect(plan.tracks.map((track) => track.mixer.audible)).toEqual([false, true, false]);
    // Live plans keep every playable track scheduled; the mixer silences them.
    expect(new Set(planProject(project).notes.map((n) => n.trackId))).toEqual(
      new Set(['tpl-drums', 'tpl-bass', 'piano']),
    );
  });

  it('maps volume, pan, sends and EQ onto mixer settings', () => {
    let project = setTrack(base(), 'tpl-bass', {
      volume: 0.5,
      pan: -0.4,
      sends: { reverb: 0.3, delay: 0.1 },
      eq: { low: 3, mid: -2, high: 0 },
    });
    project = setTrack(project, 'tpl-drums', { volume: 0 });
    const [drums, bass] = planProject(project).tracks;
    expect(drums.mixer.gainDb).toBe(-Infinity);
    expect(bass.mixer.gainDb).toBeCloseTo(-6.0206, 3);
    expect(bass.mixer).toMatchObject({
      pan: -0.4,
      reverb: 0.3,
      delay: 0.1,
      eq: { low: 3, mid: -2, high: 0 },
    });
    expect(linearToDb(1.5)).toBeCloseTo(3.52, 2);
  });

  it('reports unknown instruments, audio tracks with clips and unmapped drum pitches', () => {
    let project = withPiano([note('n1', 'pc', 60, 0, 1)]);
    project = setTrack(project, 'piano', { instrument: 'baglama@1' });
    const audio = applyOps(project, [
      { op: 'track.create', track: defaultTrack('rec', 'audio') },
      { op: 'track.create', track: defaultTrack('rec-empty', 'audio') },
      {
        op: 'clip.create',
        clip: {
          ...midiClip('ac', 'rec', 0, 4),
          kind: 'audio',
          blobId: 'b1',
          offsetSec: 0,
          gainDb: 0,
        },
      },
      { op: 'note.create', note: note('odd1', 'tpl-drums-clip', 60, 0, 0.25) },
      { op: 'note.create', note: note('odd2', 'tpl-drums-clip', 60, 1, 0.25) },
      { op: 'note.create', note: note('odd3', 'tpl-drums-clip', 30, 1, 0.25) },
    ]);
    expect(audio.skipped).toEqual([]);
    const plan = planProject(audio.doc);
    expect(plan.issues).toEqual([
      { kind: 'unmapped-drum', trackId: 'tpl-drums', pitch: 30, notes: 1 },
      { kind: 'unmapped-drum', trackId: 'tpl-drums', pitch: 60, notes: 2 },
      { kind: 'unknown-instrument', trackId: 'piano', id: 'baglama@1' },
      { kind: 'unsupported-instrument', trackId: 'rec', id: 'audio@1', clips: 1 },
    ]);
    expect(plan.tracks.find((track) => track.id === 'piano')?.instrument).toEqual({
      status: 'unknown',
      id: 'baglama@1',
    });
    expect(plan.notes.some((n) => n.trackId === 'piano' || n.pitch === 60)).toBe(false);
    expect(plan.notes.filter((n) => n.trackId === 'tpl-drums')).toHaveLength(48);
  });

  it('compares note lists for live updates', () => {
    const a = planProject(base()).notes;
    expect(sameNotes(a, planProject(base()).notes)).toBe(true);
    const moved = applyOps(base(), [{ op: 'note.set', id: 'tpl-b12', field: 'pitch', value: 40 }]);
    expect(moved.skipped).toEqual([]);
    expect(sameNotes(a, planProject(moved.doc).notes)).toBe(false);
    expect(sameNotes(a, a.slice(1))).toBe(false);
  });

  it('reschedules when a track switches between a melodic instrument and the drum kit', () => {
    // Pitches 36–51 all have kit voices, so only the drum mapping tells the plans apart.
    const project = withPiano([note('n1', 'pc', 36, 0, 1), note('n2', 'pc', 45, 1, 1)]);
    const melodic = planProject(setTrack(project, 'piano', { instrument: 'bass@1' }), {
      trackIds: ['piano'],
    }).notes;
    const drums = planProject(setTrack(project, 'piano', { instrument: 'drum-kit@1' }), {
      trackIds: ['piano'],
    }).notes;
    expect(drums.every((n) => n.drum)).toBe(true);
    expect(melodic.some((n) => n.drum)).toBe(false);
    expect(sameNotes(melodic, drums)).toBe(false);
  });
});

describe('Studio timing', () => {
  it('counts quarter beats per bar and clicks per time-signature unit', () => {
    expect(barBeats({ beats: 4, unit: 4 })).toBe(4);
    expect(barBeats({ beats: 3, unit: 4 })).toBe(3);
    expect(barBeats({ beats: 6, unit: 8 })).toBe(3);
    expect(barBeats({ beats: 7, unit: 8 })).toBe(3.5);
    expect(clickBeats({ beats: 6, unit: 8 })).toBe(0.5);
    expect(() => beatsToSeconds(1, 300)).toThrow(RangeError);
    expect(beatsToSeconds(3, 90)).toBe(2);
  });

  it('accents the metronome on the first click of every bar', () => {
    expect(metronomeClicks(0, 8, { beats: 4, unit: 4 }).map((c) => [c.beat, c.accent])).toEqual([
      [0, true],
      [1, false],
      [2, false],
      [3, false],
      [4, true],
      [5, false],
      [6, false],
      [7, false],
    ]);
    const sixEight = metronomeClicks(0, 6, { beats: 6, unit: 8 });
    expect(sixEight).toHaveLength(12);
    expect(sixEight.filter((c) => c.accent).map((c) => c.beat)).toEqual([0, 3]);
    expect(metronomeClicks(2.5, 5, { beats: 3, unit: 4 }).map((c) => [c.beat, c.accent])).toEqual([
      [3, true],
      [4, false],
    ]);
  });

  it('normalizes loop regions', () => {
    expect(normalizeLoop({ startBeat: 4, endBeat: 8 })).toEqual({ startBeat: 4, endBeat: 8 });
    expect(normalizeLoop({ startBeat: -2, endBeat: 4 })).toEqual({ startBeat: 0, endBeat: 4 });
    expect(normalizeLoop({ startBeat: 8, endBeat: 8 })).toBeNull();
    expect(normalizeLoop({ startBeat: 8, endBeat: 4 })).toBeNull();
    expect(normalizeLoop({ startBeat: Number.NaN, endBeat: 4 })).toBeNull();
    expect(normalizeLoop(null)).toBeNull();
    expect(normalizeLoop({ startBeat: 0, endBeat: 1e9 })?.endBeat).toBe(4096);
  });

  it('computes the export range and a tail for releases, reverb and delay', () => {
    const project = base();
    const dry = tailSeconds(planProject(project));
    expect(dry).toBe(0.8);
    const range = exportRange(project, {}, dry);
    expect(range).toEqual({
      fromBeat: 0,
      toBeat: 16,
      musicSeconds: 8,
      tailSeconds: 0.8,
      totalSeconds: 8.8,
    });
    expect(exportRange(project, { fromBeat: -4, toBeat: 4 }, 1)).toMatchObject({
      fromBeat: 0,
      toBeat: 4,
      musicSeconds: 2,
      totalSeconds: 3,
    });
    const wet = setTrack(project, 'tpl-bass', { sends: { reverb: 0.5, delay: 0 } });
    expect(tailSeconds(planProject(wet))).toBe(3.2);
    // Delay: 7 repeats of a dotted eighth (0.375 s at 120 BPM) fade below -60 dB.
    const echo = setTrack(project, 'tpl-bass', { sends: { reverb: 0, delay: 0.5 } });
    expect(tailSeconds(planProject(echo))).toBe(3.5);
    // A muted track's sends do not lengthen the tail.
    expect(tailSeconds(planProject(setTrack(echo, 'tpl-bass', { mute: true })))).toBe(0.8);
    expect(() => exportRange(project, { fromBeat: 8, toBeat: 8 }, 1)).toThrow(
      'Dışa aktarılacak aralık boş.',
    );
    const slow = { ...project, tempo: 40, lengthBeats: 4096 };
    expect(() => exportRange(slow, {}, 1)).toThrow(RangeError);
    expect(exportRange(slow, { toBeat: 398 }, 1).totalSeconds).toBeLessThanOrEqual(
      MAX_EXPORT_SECONDS,
    );
  });
});
