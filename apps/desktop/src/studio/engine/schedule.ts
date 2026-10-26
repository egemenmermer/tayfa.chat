// Pure planning layer of the Studio audio engine: maps a Contract-v1 StudioProject onto beat-positioned note
// events, mixer settings and reported issues. No Web Audio or Tone imports, so it runs under vitest without an
// audio device; engine.ts turns a plan into Tone nodes and transport events for live and offline playback alike.
//
// Time model (the contract leaves it open; reported as a contract gap): every beat position and length in a
// project counts quarter notes, and `tempo` is quarter notes per minute, matching Tone's transport. A bar holds
// `timeSignature.beats * 4 / unit` quarter beats (6/8 → 3) and the metronome clicks on every `unit` note.
import {
  MAX_PROJECT_BEATS,
  MAX_TEMPO,
  MIN_TEMPO,
  type StudioProject,
  type StudioTimeSignature,
  type StudioTrack,
} from '@rooms/studio';
import { t } from '../../i18n';
import { drumHit, resolveInstrument, type DrumHit, type InstrumentResolution } from './instruments';

/** Transport resolution: ticks per quarter beat (Tone's default PPQ). Events are scheduled in ticks. */
export const PPQ = 192;
/** Shared reverb return. */
export const REVERB_DECAY_SECONDS = 2.4;
/** Shared delay return: a dotted eighth with this feedback. */
export const DELAY_BEATS = 0.75;
export const DELAY_FEEDBACK = 0.35;
/** Longest export; longer renders would hold hundreds of MB of float audio on an 8 GB machine. */
export const MAX_EXPORT_SECONDS = 10 * 60;
const MAX_TAIL_SECONDS = 10;
const MIN_TAIL_SECONDS = 0.25;

export function beatsToSeconds(beats: number, tempo: number): number {
  if (!(tempo >= MIN_TEMPO && tempo <= MAX_TEMPO))
    throw new RangeError(`Tempo out of range: ${tempo}`);
  return (beats * 60) / tempo;
}

/** Quarter beats in one bar. */
export function barBeats(signature: StudioTimeSignature): number {
  return (signature.beats * 4) / signature.unit;
}

/** Quarter beats between metronome clicks (one time-signature unit). */
export function clickBeats(signature: StudioTimeSignature): number {
  return 4 / signature.unit;
}

export function beatToTicks(beat: number): number {
  return Math.round(beat * PPQ);
}

export interface MixerPlan {
  /** False when muted, or when another track is soloed and this one is not. */
  audible: boolean;
  /** Contract volume is linear gain (0–1.5); Tone channels take dB. 0 → -Infinity. */
  gainDb: number;
  pan: number;
  eq: { low: number; mid: number; high: number };
  /** Post-fader send levels, 0–1. */
  reverb: number;
  delay: number;
}

export interface TrackPlan {
  id: string;
  instrument: InstrumentResolution;
  mixer: MixerPlan;
}

export interface PlannedNote {
  trackId: string;
  noteId: string;
  /** Absolute position in quarter beats. */
  beat: number;
  lengthBeats: number;
  pitch: number;
  /** 0–1 trigger gain. */
  velocity: number;
  /** Drum-kit voices only. */
  drum?: DrumHit;
}

export type PlanIssue =
  | { kind: 'unknown-instrument'; trackId: string; id: string }
  | { kind: 'unsupported-instrument'; trackId: string; id: string; clips: number }
  | { kind: 'unmapped-drum'; trackId: string; pitch: number; notes: number };

export interface ProjectPlan {
  tempo: number;
  timeSignature: StudioTimeSignature;
  lengthBeats: number;
  /** In trackOrder. */
  tracks: TrackPlan[];
  /** Sorted by beat, then track order, then pitch. */
  notes: PlannedNote[];
  issues: PlanIssue[];
}

export interface PlanOptions {
  /** Notes starting before this beat are left out (default 0). */
  fromBeat?: number;
  /** Notes starting at or after this beat are left out; longer notes are cut here (default: no limit). */
  toBeat?: number;
  /** Plan only these tracks' notes (mixer plans still cover every track). */
  trackIds?: readonly string[];
  /** Leave out notes of tracks that are not audible (offline renders); live playback keeps them scheduled. */
  audibleOnly?: boolean;
}

function trackList(project: StudioProject): StudioTrack[] {
  return project.trackOrder
    .map((id) => project.tracks[id])
    .filter((track): track is StudioTrack => !!track);
}

/** Solo rule: a muted track is silent; when any track is soloed, only soloed tracks that are not muted play. */
export function audibleTrackIds(project: StudioProject): Set<string> {
  const tracks = trackList(project);
  const anySolo = tracks.some((track) => track.solo);
  return new Set(
    tracks.filter((track) => !track.mute && (!anySolo || track.solo)).map((track) => track.id),
  );
}

export function linearToDb(gain: number): number {
  return gain > 0 ? 20 * Math.log10(gain) : -Infinity;
}

export function mixerPlan(track: StudioTrack, audible: boolean): MixerPlan {
  return {
    audible,
    gainDb: linearToDb(track.volume),
    pan: track.pan,
    eq: { ...track.eq },
    reverb: track.sends.reverb,
    delay: track.sends.delay,
  };
}

function groupBy<T>(items: Iterable<T>, key: (item: T) => string): Map<string, T[]> {
  const groups = new Map<string, T[]>();
  for (const item of items) {
    const list = groups.get(key(item));
    if (list) list.push(item);
    else groups.set(key(item), [item]);
  }
  return groups;
}

/**
 * Maps a project onto note events. A note sounds at `clip.startBeat + note.startBeat`; notes that start at or
 * after the clip's end are hidden by the clip and left out, and notes are cut at the clip end (and at `toBeat`).
 * Tracks whose instrument cannot play (unknown or audio) schedule nothing and are listed in `issues`, as are
 * drum notes the kit has no voice for.
 */
export function planProject(project: StudioProject, options: PlanOptions = {}): ProjectPlan {
  const fromBeat = options.fromBeat ?? 0;
  const toBeat = options.toBeat ?? Infinity;
  const tracks = trackList(project);
  const audible = audibleTrackIds(project);
  const only = options.trackIds ? new Set(options.trackIds) : null;
  const order = new Map(tracks.map((track, index) => [track.id, index]));
  const clipsByTrack = groupBy(Object.values(project.clips), (clip) => clip.trackId);
  const notesByClip = groupBy(Object.values(project.notes), (note) => note.clipId);
  const plans: TrackPlan[] = [];
  const notes: PlannedNote[] = [];
  const issues: PlanIssue[] = [];
  for (const track of tracks) {
    const instrument = resolveInstrument(track.instrument);
    plans.push({ id: track.id, instrument, mixer: mixerPlan(track, audible.has(track.id)) });
    const clips = clipsByTrack.get(track.id) ?? [];
    if (instrument.status === 'unknown')
      issues.push({ kind: 'unknown-instrument', trackId: track.id, id: instrument.id });
    if (instrument.status === 'unsupported' && clips.length)
      issues.push({
        kind: 'unsupported-instrument',
        trackId: track.id,
        id: instrument.id,
        clips: clips.length,
      });
    if (instrument.status !== 'ok') continue;
    if (only && !only.has(track.id)) continue;
    if (options.audibleOnly && !audible.has(track.id)) continue;
    const unmapped = new Map<number, number>();
    for (const clip of clips) {
      if (clip.kind !== 'midi') continue;
      const clipEnd = clip.startBeat + clip.lengthBeats;
      for (const note of notesByClip.get(clip.id) ?? []) {
        if (note.startBeat >= clip.lengthBeats) continue;
        const beat = clip.startBeat + note.startBeat;
        if (beat < fromBeat || beat >= toBeat) continue;
        const end = Math.min(beat + note.lengthBeats, clipEnd, toBeat);
        let drum: DrumHit | undefined;
        if (instrument.instrument.drums) {
          const hit = drumHit(note.pitch);
          if (!hit) {
            unmapped.set(note.pitch, (unmapped.get(note.pitch) ?? 0) + 1);
            continue;
          }
          drum = hit;
        }
        notes.push({
          trackId: track.id,
          noteId: note.id,
          beat,
          lengthBeats: end - beat,
          pitch: note.pitch,
          velocity: note.velocity / 127,
          ...(drum ? { drum } : {}),
        });
      }
    }
    for (const [pitch, count] of [...unmapped].sort((a, b) => a[0] - b[0]))
      issues.push({ kind: 'unmapped-drum', trackId: track.id, pitch, notes: count });
  }
  notes.sort(
    (a, b) =>
      a.beat - b.beat ||
      (order.get(a.trackId) ?? 0) - (order.get(b.trackId) ?? 0) ||
      a.pitch - b.pitch ||
      (a.noteId < b.noteId ? -1 : a.noteId > b.noteId ? 1 : 0),
  );
  return {
    tempo: project.tempo,
    timeSignature: { ...project.timeSignature },
    lengthBeats: project.lengthBeats,
    tracks: plans,
    notes,
    issues,
  };
}

/** True when both plans schedule exactly the same notes (live updates then skip rescheduling). */
export function sameNotes(a: readonly PlannedNote[], b: readonly PlannedNote[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i += 1) {
    const x = a[i];
    const y = b[i];
    if (
      x.trackId !== y.trackId ||
      x.noteId !== y.noteId ||
      x.beat !== y.beat ||
      x.lengthBeats !== y.lengthBeats ||
      x.pitch !== y.pitch ||
      x.velocity !== y.velocity
    )
      return false;
  }
  return true;
}

export interface MetronomeClick {
  beat: number;
  /** First click of a bar. */
  accent: boolean;
}

/** Clicks on every time-signature unit in [fromBeat, toBeat), counted from beat 0. */
export function metronomeClicks(
  fromBeat: number,
  toBeat: number,
  signature: StudioTimeSignature,
): MetronomeClick[] {
  const step = clickBeats(signature);
  const clicks: MetronomeClick[] = [];
  for (let index = Math.max(0, Math.ceil(fromBeat / step - 1e-9)); ; index += 1) {
    const beat = index * step;
    if (beat >= toBeat) break;
    clicks.push({ beat, accent: index % signature.beats === 0 });
  }
  return clicks;
}

export interface LoopRegion {
  startBeat: number;
  endBeat: number;
}

/** A usable loop region inside the project's beat range, or null (no loop) when it is empty or invalid. */
export function normalizeLoop(loop: LoopRegion | null | undefined): LoopRegion | null {
  if (!loop || !Number.isFinite(loop.startBeat) || !Number.isFinite(loop.endBeat)) return null;
  const startBeat = Math.min(Math.max(0, loop.startBeat), MAX_PROJECT_BEATS);
  const endBeat = Math.min(Math.max(0, loop.endBeat), MAX_PROJECT_BEATS);
  return endBeat - startBeat >= 1 / PPQ ? { startBeat, endBeat } : null;
}

/** Seconds of audio after the last beat so releases, reverb and delay repeats ring out in an export. */
export function tailSeconds(plan: ProjectPlan): number {
  let release = 0;
  let reverb = false;
  let delay = false;
  for (const track of plan.tracks) {
    if (!track.mixer.audible || track.instrument.status !== 'ok') continue;
    release = Math.max(release, track.instrument.instrument.releaseSeconds);
    reverb ||= track.mixer.reverb > 0;
    delay ||= track.mixer.delay > 0;
  }
  // A repeat fades below -60 dB after ln(0.001) / ln(feedback) passes.
  const repeats = Math.ceil(Math.log(0.001) / Math.log(DELAY_FEEDBACK));
  const tail =
    release +
    (reverb ? REVERB_DECAY_SECONDS : 0) +
    (delay ? repeats * beatsToSeconds(DELAY_BEATS, plan.tempo) : 0);
  return Math.min(MAX_TAIL_SECONDS, Math.max(MIN_TAIL_SECONDS, Math.ceil(tail * 10) / 10));
}

export interface ExportRange {
  fromBeat: number;
  toBeat: number;
  /** Length of the beat range. */
  musicSeconds: number;
  tailSeconds: number;
  /** What the offline render produces: music plus tail. */
  totalSeconds: number;
}

/**
 * The beat range an export renders (default: the whole project, 0 → lengthBeats) and its duration. Notes that
 * start before `fromBeat` are not rendered; notes are cut at `toBeat`, then the tail lets them ring out.
 */
export function exportRange(
  project: Pick<StudioProject, 'tempo' | 'lengthBeats'>,
  range: { fromBeat?: number; toBeat?: number },
  tail: number,
): ExportRange {
  const clamp = (beat: number) => Math.min(Math.max(0, beat), MAX_PROJECT_BEATS);
  const fromBeat = clamp(range.fromBeat ?? 0);
  const toBeat = clamp(range.toBeat ?? project.lengthBeats);
  if (!(toBeat > fromBeat)) throw new RangeError(t('Dışa aktarılacak aralık boş.'));
  const musicSeconds = beatsToSeconds(toBeat - fromBeat, project.tempo);
  const totalSeconds = musicSeconds + tail;
  if (totalSeconds > MAX_EXPORT_SECONDS)
    throw new RangeError(t('Dışa aktarma en fazla 10 dakika olabilir.'));
  return { fromBeat, toBeat, musicSeconds, tailSeconds: tail, totalSeconds };
}
