// Studio audio engine core (spike). Tone.js on Web Audio; every client renders locally.
// Tone is imported lazily: importing the `tone` entry creates the default AudioContext and its clock at
// module load, which must not happen at app start or on routes that never open the Studio.
import { barsToSeconds, drumVoice, expandSong, midiToFrequency, type ScheduledNote, type SpikeSong } from './schedule';

type ToneModule = typeof import('tone');

export interface RenderResult {
  channels: Float32Array[];
  sampleRate: number;
}

export interface EngineStats {
  /** Clock Tone's default context ended up with ('worker' needs a blob: Worker; 'timeout' is the fallback). */
  clockSource: string;
  state: string;
  sampleRate: number;
  lookAhead: number;
  baseLatency: number | null;
  outputLatency: number | null;
  /** Notes triggered by live playback since the last play(). */
  playedNotes: number;
}

export interface StudioEngine {
  play(bars: number): Promise<void>;
  stop(): void;
  renderOffline(bars: number, options?: { partIds?: readonly string[]; tailSeconds?: number; sampleRate?: number }): Promise<RenderResult>;
  stats(): EngineStats;
  dispose(): void;
}

interface Voices {
  trigger(note: ScheduledNote, time: number): void;
  dispose(): void;
}

// Builds the instruments in Tone's current context (live or offline), so both share one code path.
function createVoices(Tone: ToneModule): Voices {
  const nodes: { dispose(): unknown }[] = [];
  const channel = (volume: number) => {
    const node = new Tone.Channel({ volume }).toDestination();
    nodes.push(node);
    return node;
  };
  const drumBus = channel(-4);
  const kick = new Tone.MembraneSynth({
    pitchDecay: 0.04,
    octaves: 6,
    envelope: { attack: 0.001, decay: 0.35, sustain: 0, release: 0.05 },
  }).connect(drumBus);
  const snare = new Tone.NoiseSynth({
    noise: { type: 'white' },
    envelope: { attack: 0.001, decay: 0.16, sustain: 0, release: 0.03 },
    volume: -8,
  }).connect(drumBus);
  const hat = new Tone.MetalSynth({
    envelope: { attack: 0.001, decay: 0.05, release: 0.01 },
    harmonicity: 5.1,
    modulationIndex: 32,
    resonance: 4000,
    octaves: 1.5,
    volume: -18,
  }).connect(drumBus);
  const bass = new Tone.MonoSynth({
    oscillator: { type: 'sawtooth' },
    filter: { Q: 2, type: 'lowpass', rolloff: -24 },
    envelope: { attack: 0.005, decay: 0.2, sustain: 0.6, release: 0.15 },
    filterEnvelope: { attack: 0.005, decay: 0.15, sustain: 0.3, release: 0.2, baseFrequency: 120, octaves: 3 },
    volume: -6,
  }).connect(channel(-2));
  const poly = new Tone.PolySynth(Tone.Synth, {
    oscillator: { type: 'triangle' },
    envelope: { attack: 0.02, decay: 0.3, sustain: 0.5, release: 0.6 },
    volume: -10,
  }).connect(channel(-4));
  nodes.push(kick, snare, hat, bass, poly);
  return {
    trigger(note, time) {
      if (note.instrument === 'drums') {
        const voice = drumVoice(note.pitch);
        if (voice === 'kick') kick.triggerAttackRelease(50, note.duration, time, note.velocity);
        else if (voice === 'snare') snare.triggerAttackRelease(note.duration, time, note.velocity);
        else if (voice === 'hat') hat.triggerAttackRelease(300, note.duration, time, note.velocity);
      } else if (note.instrument === 'bass') {
        bass.triggerAttackRelease(midiToFrequency(note.pitch), note.duration, time, note.velocity);
      } else {
        poly.triggerAttackRelease(midiToFrequency(note.pitch), note.duration, time, note.velocity);
      }
    },
    dispose() {
      for (const node of nodes) node.dispose();
    },
  };
}

function scheduleOnTransport(
  transport: ReturnType<ToneModule['getTransport']>,
  voices: Voices,
  notes: readonly ScheduledNote[],
  onNote?: () => void,
) {
  for (const note of notes)
    transport.schedule((time) => {
      voices.trigger(note, time);
      onNote?.();
    }, note.time);
}

export async function createStudioEngine(
  song: SpikeSong,
  options: { clockSource?: 'worker' | 'timeout'; lookAhead?: number } = {},
): Promise<StudioEngine> {
  const Tone = await import('tone');
  // The default context is always a realtime Tone Context here; BaseContext lacks the clock accessors.
  const context = Tone.getContext() as InstanceType<ToneModule['Context']>;
  const defaultClock = context.clockSource;
  if (options.clockSource) context.clockSource = options.clockSource;
  if (options.lookAhead !== undefined) context.lookAhead = options.lookAhead;
  let live: Voices | null = null;
  let playedNotes = 0;
  const stop = () => {
    const transport = Tone.getTransport();
    transport.stop();
    transport.cancel(0);
    live?.dispose();
    live = null;
  };
  return {
    async play(bars) {
      stop();
      await Tone.start();
      const transport = Tone.getTransport();
      transport.bpm.value = song.tempo;
      transport.loop = true;
      transport.loopStart = 0;
      transport.loopEnd = barsToSeconds(bars, song);
      live = createVoices(Tone);
      playedNotes = 0;
      scheduleOnTransport(transport, live, expandSong(song, bars), () => {
        playedNotes += 1;
      });
      transport.start();
    },
    stop,
    async renderOffline(bars, { partIds, tailSeconds = 1, sampleRate = 44100 } = {}) {
      const notes = expandSong(song, bars, partIds);
      const buffer = await Tone.Offline(
        ({ transport }) => {
          transport.bpm.value = song.tempo;
          scheduleOnTransport(transport, createVoices(Tone), notes);
          transport.start(0);
        },
        barsToSeconds(bars, song) + tailSeconds,
        2,
        sampleRate,
      );
      const channels = Array.from({ length: buffer.numberOfChannels }, (_, i) => buffer.getChannelData(i));
      return { channels, sampleRate: buffer.sampleRate };
    },
    stats() {
      const raw = context.rawContext as unknown as { baseLatency?: number; outputLatency?: number };
      return {
        clockSource: `${defaultClock}${options.clockSource ? `→${context.clockSource}` : ''}`,
        state: context.state,
        sampleRate: context.sampleRate,
        lookAhead: context.lookAhead,
        baseLatency: typeof raw.baseLatency === 'number' ? raw.baseLatency : null,
        outputLatency: typeof raw.outputLatency === 'number' ? raw.outputLatency : null,
        playedNotes,
      };
    },
    dispose() {
      stop();
    },
  };
}
