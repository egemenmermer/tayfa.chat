import type { StudioProject } from '@rooms/studio';
import type { StudioEngine } from './engine/engine';

/**
 * Keeps an engine fed with the latest Studio document. One `load` runs at a time; documents that arrive meanwhile
 * collapse into the newest, which loads when the running one finishes (a drag does not queue a load per frame).
 * Takes the engine as a value so this module never imports Tone.
 */
export function connectStudioEngine(
  engine: Pick<StudioEngine, 'load'>,
  source: {
    current: () => StudioProject | null;
    subscribe: (listener: () => void) => () => void;
  },
  onError: (error: unknown) => void = () => {},
): () => void {
  let loaded: StudioProject | null = null;
  let running = false;
  let stopped = false;
  const sync = async () => {
    if (running || stopped) return;
    running = true;
    try {
      for (let doc = source.current(); doc && doc !== loaded && !stopped; doc = source.current()) {
        loaded = doc;
        try {
          await engine.load(doc);
        } catch (error) {
          onError(error);
        }
      }
    } finally {
      running = false;
    }
  };
  const unsubscribe = source.subscribe(() => void sync());
  void sync();
  return () => {
    stopped = true;
    unsubscribe();
  };
}
