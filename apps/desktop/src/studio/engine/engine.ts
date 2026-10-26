// Studio audio engine: plays and exports a Contract-v1 StudioProject with Tone.js on Web Audio. Every client
// renders locally; no audio is streamed. schedule.ts plans the project (pure); this file builds Tone nodes and
// transport events from a plan, with one scheduling path for live playback and offline export.
//
// Rules from the spike (coordinator/specs/studio.md):
// - `tone` is imported lazily: importing it creates the default AudioContext and its clock at module load.
// - The live context uses the 'timeout' clock: the app CSP blocks Tone's blob: Worker clock.
// - No worklet-based Tone nodes (FeedbackCombFilter, LowpassCombFilter, Freeverb, JCReverb, PluckSynth,
//   BitCrusher): they load blob: modules the CSP blocks. The mixer uses Channel, EQ3, Reverb (convolver),
//   FeedbackDelay and Gain sends wired by hand (Channel.send() keeps its buses in a static map shared by
//   every context, which would join an offline render to the live graph).
// - Every node gets its context explicitly: an export swaps Tone's global context while it sets up.
//
// Live updates (`load` while playing): mixer settings are set in place; a changed instrument rebuilds only
// that track's voice; any change to notes, clips, tempo, time signature, length or loop cancels the transport's
// events and schedules the whole plan again in ticks without stopping the transport, so playback continues from
// the current position. Notes already sounding keep their voices. A note added under the playhead sounds from
// the next pass.
import type * as ToneTypes from 'tone';
import { encodeWav } from './wav';
import {
  beatsToSeconds,
  beatToTicks,
  barBeats,
  DELAY_BEATS,
  DELAY_FEEDBACK,
  exportRange,
  metronomeClicks,
  normalizeLoop,
  planProject,
  PPQ,
  REVERB_DECAY_SECONDS,
  sameNotes,
  tailSeconds,
  type ExportRange,
  type LoopRegion,
  type PlannedNote,
  type ProjectPlan,
  type TrackPlan,
} from './schedule';
import { midiToFrequency, type DrumVoice, type InstrumentVoice } from './instruments';
import type { StudioProject } from '@rooms/studio';

type ToneModule = typeof ToneTypes;
type AnyContext = ToneTypes.Context | ToneTypes.OfflineContext;
type Transport = ToneTypes.Context['transport'];
type Node = ToneTypes.ToneAudioNode;

export interface RenderResult {
  channels: Float32Array[];
  sampleRate: number;
  range: ExportRange;
  plan: ProjectPlan;
}

export interface RenderOptions {
  fromBeat?: number;
  toBeat?: number;
  sampleRate?: number;
  /** 0–1. The clock pass reports up to 0.9; the native render cannot report progress, so 1 comes at the end. */
  onProgress?: (fraction: number) => void;
  /** Aborts the clock pass immediately; once the native render has started its result is discarded. */
  signal?: AbortSignal;
}

export interface EngineStats {
  clockSource: string;
  state: string;
  sampleRate: number;
  lookAhead: number;
  baseLatency: number | null;
  outputLatency: number | null;
  /** Notes triggered by live playback since the engine was created. */
  playedNotes: number;
  /** Triggers a voice rejected (reported, never fatal to playback). */
  triggerErrors: number;
  /** Times the live transport events were rebuilt by `load`. */
  reschedules: number;
}

export type PositionListener = (beat: number, playing: boolean) => void;

export interface StudioEngine {
  /** Applies a project document. While playing, the transport keeps running (see the header comment). */
  load(project: StudioProject): Promise<ProjectPlan>;
  /** Starts playback at `fromBeat`, or where it was paused. Needs a loaded project and a user gesture. */
  play(fromBeat?: number): Promise<void>;
  pause(): void;
  /** Stops and returns to the loop start (or beat 0). */
  stop(): void;
  seek(beat: number): void;
  setLoop(loop: LoopRegion | null): void;
  setMetronome(on: boolean): void;
  /** Playhead in quarter beats, at the audio clock (lookAhead excluded). */
  position(): number;
  playing(): boolean;
  /** Called at most ~30 times a second while playing, and once on every stop or pause. */
  onPosition(listener: PositionListener): () => void;
  /** The last loaded plan: track instrument statuses and issues for the UI. */
  plan(): ProjectPlan | null;
  renderOffline(project: StudioProject, options?: RenderOptions): Promise<RenderResult>;
  /** renderOffline, encoded as 16-bit PCM WAV. */
  exportWav(
    project: StudioProject,
    options?: RenderOptions,
  ): Promise<{ wav: Uint8Array; range: ExportRange }>;
  stats(): EngineStats;
  dispose(): void;
}

interface Voice {
  trigger(note: PlannedNote, time: number, seconds: number): void;
  dispose(): void;
}

// Builds one instrument's Tone voice in `context`, connected to `output`.
function createVoice(
  Tone: ToneModule,
  context: AnyContext,
  kind: InstrumentVoice,
  output: Node,
): Voice {
  const nodes: { dispose(): unknown }[] = [];
  const keep = <T extends { dispose(): unknown }>(node: T): T => {
    nodes.push(node);
    return node;
  };
  const dispose = () => {
    for (const node of nodes) node.dispose();
  };
  if (kind === 'drum-kit') {
    const kick = keep(
      new Tone.MembraneSynth({
        context,
        pitchDecay: 0.04,
        octaves: 6,
        envelope: { attack: 0.001, decay: 0.35, sustain: 0, release: 0.05 },
      }),
    ).connect(output);
    const snare = keep(
      new Tone.NoiseSynth({
        context,
        noise: { type: 'white' },
        envelope: { attack: 0.001, decay: 0.16, sustain: 0, release: 0.03 },
        volume: -8,
      }),
    ).connect(output);
    const clapFilter = keep(
      new Tone.Filter({ context, type: 'bandpass', frequency: 1200, Q: 0.8 }),
    ).connect(output);
    const clap = keep(
      new Tone.NoiseSynth({
        context,
        noise: { type: 'pink' },
        envelope: { attack: 0.004, decay: 0.12, sustain: 0, release: 0.05 },
        volume: -2,
      }),
    ).connect(clapFilter);
    const hat = (decay: number, release: number, volume: number) =>
      keep(
        new Tone.MetalSynth({
          context,
          envelope: { attack: 0.001, decay, release },
          harmonicity: 5.1,
          modulationIndex: 32,
          resonance: 4000,
          octaves: 1.5,
          volume,
        }),
      ).connect(output);
    const closedHat = hat(0.05, 0.01, -18);
    const openHat = hat(0.35, 0.2, -20);
    const tom = keep(
      new Tone.MembraneSynth({
        context,
        pitchDecay: 0.08,
        octaves: 2,
        envelope: { attack: 0.001, decay: 0.4, sustain: 0, release: 0.1 },
        volume: -4,
      }),
    ).connect(output);
    const rim = keep(
      new Tone.Synth({
        context,
        oscillator: { type: 'triangle' },
        envelope: { attack: 0.001, decay: 0.04, sustain: 0, release: 0.02 },
        volume: -10,
      }),
    ).connect(output);
    // Each drum voice is monophonic; a second hit on the same voice at the same instant adds nothing and
    // some Tone sources reject a start time that is not later than the previous one.
    const last = new Map<DrumVoice, number>();
    return {
      trigger(note, time, seconds) {
        const hit = note.drum;
        if (!hit) return;
        if ((last.get(hit.voice) ?? -1) >= time - 1e-4) return;
        last.set(hit.voice, time);
        const v = note.velocity;
        switch (hit.voice) {
          case 'kick':
            kick.triggerAttackRelease(50, seconds, time, v);
            break;
          case 'snare':
            snare.triggerAttackRelease(seconds, time, v);
            break;
          case 'clap':
            clap.triggerAttackRelease(seconds, time, v);
            break;
          case 'closed-hat':
            closedHat.triggerAttackRelease(300, seconds, time, v);
            break;
          case 'open-hat':
            openHat.triggerAttackRelease(300, Math.max(seconds, 0.3), time, v);
            break;
          case 'tom':
            tom.triggerAttackRelease(hit.frequency, seconds, time, v);
            break;
          case 'rim':
            rim.triggerAttackRelease(1700, 0.03, time, v);
            break;
        }
      },
      dispose,
    };
  }
  let synth: ToneTypes.MonoSynth | ToneTypes.PolySynth;
  if (kind === 'piano') {
    synth = keep(
      new Tone.PolySynth({
        context,
        voice: Tone.FMSynth,
        maxPolyphony: 32,
        options: {
          harmonicity: 3,
          modulationIndex: 2.5,
          oscillator: { type: 'sine' },
          modulation: { type: 'sine' },
          envelope: { attack: 0.002, decay: 1.1, sustain: 0.25, release: 1 },
          modulationEnvelope: { attack: 0.002, decay: 0.4, sustain: 0, release: 0.5 },
        },
        volume: -3,
      }),
    );
  } else if (kind === 'synth-pad') {
    const filter = keep(new Tone.Filter({ context, type: 'lowpass', frequency: 1800 })).connect(
      output,
    );
    synth = keep(
      new Tone.PolySynth({
        context,
        voice: Tone.Synth,
        maxPolyphony: 16,
        options: {
          oscillator: { type: 'fatsawtooth', count: 3, spread: 24 },
          envelope: { attack: 0.35, decay: 0.5, sustain: 0.8, release: 1.8 },
        },
        volume: -16,
      }),
    );
    synth.connect(filter);
    return {
      trigger: (note, time, seconds) =>
        synth.triggerAttackRelease(midiToFrequency(note.pitch), seconds, time, note.velocity),
      dispose,
    };
  } else {
    const lead = kind === 'synth-lead';
    synth = keep(
      new Tone.MonoSynth({
        context,
        oscillator: { type: lead ? 'square' : 'sawtooth' },
        filter: { Q: lead ? 1 : 2, type: 'lowpass', rolloff: -24 },
        envelope: lead
          ? { attack: 0.01, decay: 0.2, sustain: 0.7, release: 0.3 }
          : { attack: 0.005, decay: 0.2, sustain: 0.6, release: 0.15 },
        filterEnvelope: {
          attack: 0.005,
          decay: lead ? 0.3 : 0.15,
          sustain: lead ? 0.5 : 0.3,
          release: 0.2,
          baseFrequency: lead ? 600 : 120,
          octaves: lead ? 2.5 : 3,
        },
        volume: lead ? -10 : -6,
      }),
    );
  }
  synth.connect(output);
  return {
    trigger: (note, time, seconds) =>
      synth.triggerAttackRelease(midiToFrequency(note.pitch), seconds, time, note.velocity),
    dispose,
  };
}

interface Strip {
  ref: string | null;
  voice: Voice | null;
  eq: ToneTypes.EQ3;
  channel: ToneTypes.Channel;
  reverbSend: ToneTypes.Gain;
  delaySend: ToneTypes.Gain;
}

/** One mixer graph (live or offline): a strip per track into a master bus with shared reverb and delay. */
class Mixer {
  private readonly strips = new Map<string, Strip>();
  private tempo = 120;
  private constructor(
    private readonly Tone: ToneModule,
    private readonly context: AnyContext,
    private readonly master: ToneTypes.Gain,
    private readonly limiter: ToneTypes.Limiter,
    private readonly reverb: ToneTypes.Reverb,
    private readonly delay: ToneTypes.FeedbackDelay,
  ) {}

  static async create(Tone: ToneModule, context: AnyContext): Promise<Mixer> {
    // Native DynamicsCompressor (no worklet): keeps a dense mix from clipping the 16-bit export.
    const limiter = new Tone.Limiter({ context, threshold: -1 }).connect(context.destination);
    const master = new Tone.Gain({ context, gain: 0.8 }).connect(limiter);
    const reverb = new Tone.Reverb({
      context,
      decay: REVERB_DECAY_SECONDS,
      preDelay: 0.01,
      wet: 1,
    }).connect(master);
    const delay = new Tone.FeedbackDelay({
      context,
      delayTime: 0.375,
      feedback: DELAY_FEEDBACK,
      wet: 1,
      maxDelay: 2,
    }).connect(master);
    await reverb.ready;
    return new Mixer(Tone, context, master, limiter, reverb, delay);
  }

  /** Brings strips, voices and mixer settings in line with `plan`. `immediate` skips ramps (offline). */
  sync(plan: ProjectPlan, immediate = false) {
    const Tone = this.Tone;
    const context = this.context;
    if (plan.tempo !== this.tempo || immediate) {
      this.tempo = plan.tempo;
      this.delay.delayTime.value = beatsToSeconds(DELAY_BEATS, plan.tempo);
    }
    const seen = new Set<string>();
    for (const track of plan.tracks) {
      seen.add(track.id);
      let strip = this.strips.get(track.id);
      if (!strip) {
        const channel = new Tone.Channel({ context }).connect(this.master);
        const reverbSend = new Tone.Gain({ context, gain: 0 }).connect(this.reverb);
        const delaySend = new Tone.Gain({ context, gain: 0 }).connect(this.delay);
        channel.connect(reverbSend);
        channel.connect(delaySend);
        const eq = new Tone.EQ3({ context }).connect(channel);
        strip = { ref: null, voice: null, eq, channel, reverbSend, delaySend };
        this.strips.set(track.id, strip);
        immediate = true;
      }
      this.applyMixer(strip, track, immediate);
      const ref = track.instrument.status === 'ok' ? track.instrument.instrument.ref : null;
      if (ref !== strip.ref) {
        strip.voice?.dispose();
        strip.voice =
          track.instrument.status === 'ok'
            ? createVoice(Tone, context, track.instrument.instrument.voice, strip.eq)
            : null;
        strip.ref = ref;
      }
    }
    for (const [id, strip] of this.strips)
      if (!seen.has(id)) {
        disposeStrip(strip);
        this.strips.delete(id);
      }
  }

  private applyMixer(strip: Strip, track: TrackPlan, immediate: boolean) {
    const { mixer } = track;
    const set = (param: ToneTypes.Param<'decibels' | 'audioRange' | 'gain'>, value: number) => {
      if (immediate || !Number.isFinite(value)) param.value = value;
      else param.rampTo(value, 0.03);
    };
    strip.channel.mute = !mixer.audible;
    set(strip.channel.volume, mixer.gainDb);
    set(strip.channel.pan, mixer.pan);
    set(strip.eq.low, mixer.eq.low);
    set(strip.eq.mid, mixer.eq.mid);
    set(strip.eq.high, mixer.eq.high);
    set(strip.reverbSend.gain, mixer.reverb);
    set(strip.delaySend.gain, mixer.delay);
  }

  /** Plays a note on its track's voice; false when the voice rejected it. */
  trigger(note: PlannedNote, time: number): boolean {
    const voice = this.strips.get(note.trackId)?.voice;
    if (!voice) return true;
    try {
      voice.trigger(note, time, beatsToSeconds(note.lengthBeats, this.tempo));
      return true;
    } catch {
      return false;
    }
  }

  dispose() {
    for (const strip of this.strips.values()) disposeStrip(strip);
    this.strips.clear();
    this.reverb.dispose();
    this.delay.dispose();
    this.master.dispose();
    this.limiter.dispose();
  }
}

function disposeStrip(strip: Strip) {
  strip.voice?.dispose();
  strip.eq.dispose();
  strip.channel.dispose();
  strip.reverbSend.dispose();
  strip.delaySend.dispose();
}

/** The one scheduling path: puts a plan's notes on a transport in ticks. Used live and offline. */
function scheduleNotes(
  transport: Transport,
  mixer: Mixer,
  notes: readonly PlannedNote[],
  onTrigger: (ok: boolean) => void,
) {
  for (const note of notes)
    transport.schedule(
      (time) => onTrigger(mixer.trigger(note, time)),
      `${beatToTicks(note.beat)}i`,
    );
}

function configureTransport(transport: Transport, plan: ProjectPlan) {
  transport.PPQ = PPQ;
  transport.bpm.value = plan.tempo;
  transport.timeSignature = barBeats(plan.timeSignature);
}

function abortError(): DOMException {
  return new DOMException('The export was canceled.', 'AbortError');
}

export async function createStudioEngine(
  options: { clockSource?: 'worker' | 'timeout'; lookAhead?: number } = {},
): Promise<StudioEngine> {
  const Tone = await import('tone');
  // Captured once: an export swaps Tone's global context while it sets up, so the live engine never asks
  // Tone for "the current" context or transport.
  const context = Tone.getContext() as ToneTypes.Context;
  const defaultClock = context.clockSource;
  // Tone's 'worker' clock runs a blob: Worker that the app CSP blocks; the failure is asynchronous, so Tone
  // never falls back. The main window sets backgroundThrottling: false, so a timeout clock keeps its pace.
  const clockSource = options.clockSource ?? 'timeout';
  if (context.clockSource !== clockSource) context.clockSource = clockSource;
  context.lookAhead = options.lookAhead ?? 0.05;
  const transport = context.transport;
  transport.PPQ = PPQ;

  let mixer: Mixer | null = null;
  let click: ToneTypes.Synth | null = null;
  let current: ProjectPlan | null = null;
  let loop: LoopRegion | null = null;
  let metronome = false;
  let isPlaying = false;
  let disposed = false;
  let queue: Promise<unknown> = Promise.resolve();
  let timer: ReturnType<typeof setInterval> | null = null;
  const listeners = new Set<PositionListener>();
  const counters = { playedNotes: 0, triggerErrors: 0, reschedules: 0 };

  const position = () => {
    const ticks = isPlaying ? transport.getTicksAtTime(context.immediate()) : transport.ticks;
    return Math.max(0, ticks) / PPQ;
  };
  const emit = () => {
    const beat = position();
    for (const listener of listeners) listener(beat, isPlaying);
  };
  const startTimer = () => {
    if (timer === null) timer = setInterval(emit, 34);
  };
  const stopTimer = () => {
    if (timer !== null) clearInterval(timer);
    timer = null;
  };
  const halt = (rewind: boolean) => {
    transport.stop();
    if (rewind) transport.ticks = beatToTicks(loop?.startBeat ?? 0);
    isPlaying = false;
    stopTimer();
    emit();
  };

  // Rebuilds every transport event for the current plan, loop and metronome, without stopping the transport.
  const reschedule = () => {
    if (!current || !mixer) return;
    const plan = current;
    const live = mixer;
    transport.cancel(0);
    counters.reschedules += 1;
    configureTransport(transport, plan);
    transport.loop = !!loop;
    if (loop)
      transport.setLoopPoints(`${beatToTicks(loop.startBeat)}i`, `${beatToTicks(loop.endBeat)}i`);
    scheduleNotes(transport, live, plan.notes, (ok) => {
      counters.playedNotes += 1;
      if (!ok) counters.triggerErrors += 1;
    });
    const endBeat = Math.max(plan.lengthBeats, loop?.endBeat ?? 0);
    if (metronome && click) {
      const synth = click;
      for (const tick of metronomeClicks(0, endBeat, plan.timeSignature))
        transport.schedule(
          (time) =>
            synth.triggerAttackRelease(
              tick.accent ? 1760 : 1320,
              0.03,
              time,
              tick.accent ? 1 : 0.6,
            ),
          `${beatToTicks(tick.beat)}i`,
        );
    }
    if (!loop)
      transport.schedule(
        () => {
          // Runs lookAhead early; the stop lands on the audio clock a moment later.
          setTimeout(() => {
            if (isPlaying && !loop) halt(true);
          }, context.lookAhead * 1000);
        },
        `${beatToTicks(plan.lengthBeats)}i`,
      );
  };

  const apply = async (project: StudioProject) => {
    const next = planProject(project);
    if (disposed) return next;
    if (!mixer) {
      mixer = await Mixer.create(Tone, context);
      click = new Tone.Synth({
        context,
        oscillator: { type: 'square' },
        envelope: { attack: 0.001, decay: 0.03, sustain: 0, release: 0.01 },
        volume: -14,
      }).connect(context.destination);
    }
    const previous = current;
    mixer.sync(next, !previous);
    current = next;
    const timingChanged =
      !previous ||
      previous.tempo !== next.tempo ||
      previous.lengthBeats !== next.lengthBeats ||
      previous.timeSignature.beats !== next.timeSignature.beats ||
      previous.timeSignature.unit !== next.timeSignature.unit;
    if (timingChanged || !sameNotes(previous.notes, next.notes)) reschedule();
    return next;
  };

  const engine: StudioEngine = {
    load(project) {
      const run = queue.then(() => apply(project));
      queue = run.catch(() => undefined);
      return run;
    },
    async play(fromBeat) {
      await queue;
      if (!current || !mixer) throw new Error('No Studio project is loaded.');
      await context.resume();
      if (fromBeat !== undefined) transport.ticks = beatToTicks(Math.max(0, fromBeat));
      if (isPlaying) return;
      if (!loop && transport.ticks >= beatToTicks(current.lengthBeats)) transport.ticks = 0;
      transport.start();
      isPlaying = true;
      startTimer();
    },
    pause() {
      transport.pause();
      isPlaying = false;
      stopTimer();
      emit();
    },
    stop() {
      halt(true);
    },
    seek(beat) {
      transport.ticks = beatToTicks(Math.max(0, beat));
      emit();
    },
    setLoop(region) {
      loop = normalizeLoop(region);
      reschedule();
    },
    setMetronome(on) {
      if (metronome === on) return;
      metronome = on;
      reschedule();
    },
    position,
    playing: () => isPlaying,
    onPosition(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    plan: () => current,
    async renderOffline(
      project,
      { fromBeat, toBeat, sampleRate = 44100, onProgress, signal } = {},
    ) {
      if (signal?.aborted) throw abortError();
      const tracksOnly = planProject(project, { toBeat: 0 });
      const range = exportRange(project, { fromBeat, toBeat }, tailSeconds(tracksOnly));
      const plan = planProject(project, {
        fromBeat: range.fromBeat,
        toBeat: range.toBeat,
        audibleOnly: true,
      });
      const offline = new Tone.OfflineContext(2, range.totalSeconds, sampleRate);
      const original = Tone.getContext();
      let graph: Mixer | null = null;
      // Nodes get their context explicitly; the global swap covers what Tone creates internally.
      Tone.setContext(offline);
      try {
        graph = await Mixer.create(Tone, offline);
        graph.sync(plan, true);
        const offlineTransport = offline.transport;
        configureTransport(offlineTransport, plan);
        const target = graph;
        scheduleNotes(offlineTransport, target, plan.notes, () => undefined);
        offlineTransport.start(0, `${beatToTicks(range.fromBeat)}i`);
      } catch (error) {
        graph?.dispose();
        throw error;
      } finally {
        Tone.setContext(original);
      }
      let reported = 0;
      const onTick = () => {
        if (signal?.aborted) throw abortError();
        const fraction = Math.min(0.9, (offline.currentTime / range.totalSeconds) * 0.9);
        if (fraction - reported >= 0.02) {
          reported = fraction;
          onProgress?.(fraction);
        }
      };
      offline.on('tick', onTick);
      try {
        const buffer = await offline.render();
        if (signal?.aborted) throw abortError();
        onProgress?.(1);
        const channels = Array.from({ length: buffer.numberOfChannels }, (_, index) =>
          buffer.getChannelData(index),
        );
        return { channels, sampleRate: buffer.sampleRate, range, plan };
      } finally {
        offline.off('tick', onTick);
        graph.dispose();
      }
    },
    async exportWav(project, options) {
      const result = await engine.renderOffline(project, options);
      return { wav: encodeWav(result.channels, result.sampleRate), range: result.range };
    },
    stats() {
      const raw = context.rawContext as unknown as { baseLatency?: number; outputLatency?: number };
      return {
        clockSource:
          defaultClock === context.clockSource
            ? defaultClock
            : `${defaultClock}→${context.clockSource}`,
        state: context.state,
        sampleRate: context.sampleRate,
        lookAhead: context.lookAhead,
        baseLatency: typeof raw.baseLatency === 'number' ? raw.baseLatency : null,
        outputLatency: typeof raw.outputLatency === 'number' ? raw.outputLatency : null,
        ...counters,
      };
    },
    dispose() {
      disposed = true;
      transport.stop();
      transport.cancel(0);
      isPlaying = false;
      stopTimer();
      listeners.clear();
      mixer?.dispose();
      click?.dispose();
      mixer = null;
      click = null;
      current = null;
    },
  };
  return engine;
}
