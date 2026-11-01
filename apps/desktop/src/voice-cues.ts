import { useCommunity } from './community';
import { mediaProvider } from './runtime-sources';
import { useRooms } from './store';
import { encodePersonalSoundWav } from '../../../packages/shared-contracts/src/personal-sound-audio';
import { PERSONAL_SOUND_LIMITS } from '../../../packages/shared-contracts/src/personal-sounds';
import type { MediaParticipant } from '@rooms/media';

/**
 * Short confirmation cues: this listener's own microphone and deafen toggles, a screen share that
 * starts or stops in their room (their own share included), and someone starting or stopping to
 * watch their own share.
 */
export type VoiceCue =
  | 'mic-on'
  | 'mic-off'
  | 'deafen-on'
  | 'deafen-off'
  | 'stream-start'
  | 'stream-stop'
  | 'viewer-join'
  | 'viewer-leave';

const RATE = PERSONAL_SOUND_LIMITS.sampleRate;
const tone = (frequency: number, t: number) =>
  Math.sin(2 * Math.PI * frequency * t) + 0.25 * Math.sin(4 * Math.PI * frequency * t);
/** Notes `step` seconds apart, each with a soft attack and an exponential tail of `length` seconds. */
const notes = (t: number, frequencies: number[], step: number, length: number, gain: number) =>
  frequencies.reduce((sum, frequency, index) => {
    const local = t - index * step;
    if (local < 0 || local > length) return sum;
    const envelope = Math.min(1, local / 0.006) * Math.exp(-local / (length / 3));
    return sum + tone(frequency, local) * envelope * gain;
  }, 0);

/** Original synthesized figures: rising means on or started, falling means off or stopped. */
const recipes: Record<VoiceCue, { seconds: number; sample(t: number): number }> = {
  'mic-on': { seconds: 0.2, sample: (t) => notes(t, [740, 1109], 0.06, 0.13, 0.16) },
  'mic-off': { seconds: 0.2, sample: (t) => notes(t, [1109, 740], 0.06, 0.13, 0.16) },
  // Deafen sits lower than the microphone, so the two are told apart without looking.
  'deafen-on': { seconds: 0.26, sample: (t) => notes(t, [587, 392], 0.08, 0.17, 0.17) },
  'deafen-off': { seconds: 0.26, sample: (t) => notes(t, [392, 587], 0.08, 0.17, 0.17) },
  'stream-start': {
    seconds: 0.42,
    sample: (t) => notes(t, [523, 784, 1047], 0.08, 0.26, 0.12),
  },
  'stream-stop': {
    seconds: 0.42,
    sample: (t) => notes(t, [1047, 784, 523], 0.08, 0.26, 0.12),
  },
  // A viewer is a smaller event than a stream: two high, quiet notes.
  'viewer-join': { seconds: 0.18, sample: (t) => notes(t, [988, 1319], 0.05, 0.11, 0.1) },
  'viewer-leave': { seconds: 0.18, sample: (t) => notes(t, [1319, 988], 0.05, 0.11, 0.1) },
};

const sources = new Map<VoiceCue, string>();
/** The cue as a WAV blob URL, built once per cue (no asset, no network). */
export function voiceCueSource(cue: VoiceCue): string {
  const cached = sources.get(cue);
  if (cached) return cached;
  const recipe = recipes[cue],
    samples = new Float32Array(Math.round(RATE * recipe.seconds));
  for (let i = 0; i < samples.length; i++) samples[i] = recipe.sample(i / RATE);
  const bytes = encodePersonalSoundWav(samples);
  const url = URL.createObjectURL(new Blob([bytes.buffer as ArrayBuffer], { type: 'audio/wav' }));
  sources.set(cue, url);
  return url;
}

/**
 * Own toggles always confirm, even when the listener just deafened. Stream and viewer cues are
 * room events, so a deafened listener does not hear them.
 */
export function voiceCueAudible(cue: VoiceCue) {
  const prefs = useRooms.getState().preferences;
  if (!prefs.voiceCues || prefs.soundEffectsLevel <= 0 || !useCommunity.getState().user)
    return false;
  if (!cue.startsWith('stream-') && !cue.startsWith('viewer-')) return true;
  try {
    return !mediaProvider().snapshot().deafened;
  } catch {
    /* No media runtime (tests, browser build): nothing to be deafened by. */
    return true;
  }
}

const lastPlayed = new Map<VoiceCue, number>();
/** Plays one cue now; repeats of the same cue within 120 ms collapse (a key held down, a burst). */
export function playVoiceCue(cue: VoiceCue, gain = 0.6) {
  if (!voiceCueAudible(cue)) return;
  const now = performance.now();
  if (now - (lastPlayed.get(cue) ?? -Infinity) < 120) return;
  lastPlayed.set(cue, now);
  try {
    const prefs = useRooms.getState().preferences,
      player = new Audio(voiceCueSource(cue));
    player.volume = Math.max(0, Math.min(1, gain * prefs.soundEffectsLevel));
    void (async () => {
      try {
        if (prefs.outputId && 'setSinkId' in player)
          await (player as HTMLAudioElement & { setSinkId(id: string): Promise<void> }).setSinkId(
            prefs.outputId,
          );
        await player.play();
      } catch {
        /* A cue must never fail the toggle or the room. */
      }
    })();
  } catch {
    /* No audio element, no cue. */
  }
}

export interface StreamCue {
  kind: 'stream-start' | 'stream-stop';
  actor: string;
  local: boolean;
}
/**
 * Compares who shares a screen between two rosters of the same room. Joining, reconnecting and
 * switching rooms start a new baseline, so streams already running never play a cue; a person who
 * leaves while sharing gets the leave cue only.
 */
export class StreamCueTracker {
  private room: string | null = null;
  private sharing = new Map<string, boolean>();
  /** `room` is null while the listener is not connected. */
  update(
    room: string | null,
    participants: Pick<MediaParticipant, 'id' | 'local' | 'screen'>[],
  ): StreamCue[] {
    const people = participants.filter((p) => !p.id.startsWith('rooms-music-'));
    const next = new Map(people.map((p) => [p.id, !!p.screen]));
    const before = this.sharing,
      same = room !== null && room === this.room;
    this.room = room;
    this.sharing = room === null ? new Map() : next;
    if (!same) return [];
    return people.flatMap((p): StreamCue[] => {
      const was = before.get(p.id);
      if (was === undefined || was === !!p.screen) return [];
      return [{ kind: p.screen ? 'stream-start' : 'stream-stop', actor: p.id, local: p.local }];
    });
  }
}

export interface ViewerCue {
  kind: 'viewer-join' | 'viewer-leave';
  viewer: string;
}
/**
 * Who watches this listener's own screen share (H03). A new share, room or reconnect starts a new
 * baseline; a viewer who leaves the room while watching counts as leaving the stream.
 */
export class ViewerCueTracker {
  private key: string | null = null;
  private viewers = new Set<string>();
  /** `room` is null while the listener is not connected. */
  update(
    room: string | null,
    participants: Pick<MediaParticipant, 'id' | 'local' | 'screen' | 'watching'>[],
  ): ViewerCue[] {
    const me = participants.find((p) => p.local);
    const key = room !== null && me?.screen ? JSON.stringify([room, me.id]) : null;
    const next = new Set(
      key && me
        ? participants
            .filter((p) => !p.local && p.watching === me.id && !p.id.startsWith('rooms-music-'))
            .map((p) => p.id)
        : [],
    );
    const before = this.viewers,
      same = key !== null && key === this.key;
    this.key = key;
    this.viewers = next;
    if (!same) return [];
    return [
      ...[...next]
        .filter((id) => !before.has(id))
        .map((viewer) => ({ kind: 'viewer-join' as const, viewer })),
      ...[...before]
        .filter((id) => !next.has(id))
        .map((viewer) => ({ kind: 'viewer-leave' as const, viewer })),
    ];
  }
}
