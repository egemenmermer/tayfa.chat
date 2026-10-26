import type { LoopRegion } from '../engine/schedule';
import { feedStudioEngine } from '../store';
import type { StudioProject } from '@rooms/studio';
import type { RenderOptions, StudioEngine } from '../engine/engine';
import type { ExportRange } from '../engine/schedule';

/**
 * What the transport bar needs from the audio engine. Loop, loop range and metronome are this client's
 * listening settings, not project fields: they never go to the server.
 */
export interface StudioTransport {
  playing(): boolean;
  /** Playhead in beats (quarter notes). */
  position(): number;
  play(fromBeat?: number): Promise<void>;
  stop(): void;
  seek(beat: number): void;
  setLoop(loop: LoopRegion | null): void;
  setMetronome(on: boolean): void;
  /** Called about 30 times a second while playing, and on seek/stop. */
  onPosition(listener: (beat: number, playing: boolean) => void): () => void;
  /** Auditions one note on a track (editor clicks); optional so silent fakes need not implement it. */
  preview?(trackId: string, pitch: number, velocity: number): void;
  /** Renders the project offline to a 16-bit WAV (export dialog). */
  exportWav?: StudioExporter;
  dispose(): void;
}

export type StudioExporter = (
  project: StudioProject,
  options: RenderOptions,
) => Promise<{ wav: Uint8Array; range: ExportRange }>;

/**
 * The live transport: the Tone engine is created on the first Play (an AudioContext needs a user gesture and
 * `tone` must stay out of the startup bundle) and fed with every new document of the open project.
 */
export function createLiveTransport(
  create: () => Promise<StudioEngine> = async () =>
    (await import('../engine/engine')).createStudioEngine(),
): StudioTransport {
  let engine: StudioEngine | null = null;
  let starting: Promise<StudioEngine> | null = null;
  let detachFeed: (() => void) | null = null;
  let detachPosition: (() => void) | null = null;
  let loop: LoopRegion | null = null;
  let metronome = false;
  let seekBeat = 0;
  let disposed = false;
  const listeners = new Set<(beat: number, playing: boolean) => void>();
  const emit = (beat: number, playing: boolean) => {
    for (const listener of listeners) listener(beat, playing);
  };
  const ensure = () => {
    starting ??= create().then((created) => {
      if (disposed) {
        created.dispose();
        throw new DOMException('The Studio transport was closed.', 'AbortError');
      }
      engine = created;
      engine.setLoop(loop);
      engine.setMetronome(metronome);
      engine.seek(seekBeat);
      detachFeed = feedStudioEngine(engine);
      detachPosition = engine.onPosition(emit);
      return engine;
    });
    return starting;
  };
  return {
    playing: () => engine?.playing() ?? false,
    position: () => engine?.position() ?? seekBeat,
    async play(fromBeat) {
      const live = await ensure();
      await live.play(fromBeat);
    },
    stop() {
      seekBeat = 0;
      if (engine) engine.stop();
      else emit(0, false);
    },
    seek(beat) {
      seekBeat = Math.max(0, beat);
      if (engine) engine.seek(seekBeat);
      else emit(seekBeat, false);
    },
    setLoop(next) {
      loop = next;
      engine?.setLoop(next);
    },
    setMetronome(on) {
      metronome = on;
      engine?.setMetronome(on);
    },
    onPosition(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    preview(trackId, pitch, velocity) {
      // A click is a user gesture, so the engine may start here; the very first audition can be silent
      // while the project loads.
      void ensure()
        .then((live) => live.preview(trackId, pitch, velocity))
        .catch(() => {});
    },
    async exportWav(project, options) {
      const live = await ensure();
      return live.exportWav(project, options);
    },
    dispose() {
      disposed = true;
      detachPosition?.();
      detachFeed?.();
      engine?.stop();
      engine?.dispose();
      engine = null;
      listeners.clear();
    },
  };
}
