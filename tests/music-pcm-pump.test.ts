import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PCM_FRAME_BYTES, startPcmPump } from '../apps/services/music/pcm-pump';

const MS = 192; // bytes per millisecond of s16le 48 kHz stereo
const CHUNK = 65536;

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

/** Mirrors the native AudioSource: accepts frames until `queueMs` is queued, then paces at realtime. */
function fakeSink(queueMs = 1000) {
  let queued = 0;
  let last = 0;
  let underrunMs = 0;
  let frames = 0;
  const sink = {
    async captureFrame(_samples: Int16Array) {
      const drain = () => {
        const now = Date.now();
        if (last !== 0) {
          const elapsed = now - last;
          if (elapsed > queued && frames > 0) underrunMs += elapsed - queued;
          queued = Math.max(queued - elapsed, 0);
        }
        last = now;
      };
      drain();
      while (queued + 10 > queueMs) {
        await new Promise((resolve) => setTimeout(resolve, 10));
        drain();
      }
      queued += 10;
      frames++;
    },
  };
  return {
    sink,
    get frames() {
      return frames;
    },
    get underrunMs() {
      return underrunMs;
    },
  };
}

/** Push-driven source that records whether the pump released it. */
function controlledSource() {
  const chunks: Buffer[] = [];
  let ended = false;
  let wake: (() => void) | null = null;
  const state = { returned: false, yielded: 0 };
  async function* generate() {
    try {
      for (;;) {
        if (chunks.length) {
          state.yielded += chunks[0].length;
          yield chunks.shift()!;
        } else if (ended) return;
        else await new Promise<void>((resolve) => (wake = resolve));
      }
    } finally {
      state.returned = true;
    }
  }
  const signal = () => {
    const resolve = wake;
    wake = null;
    resolve?.();
  };
  return {
    iterable: generate(),
    state,
    /** Pushes `ms` of audio in 64 KB chunks. */
    push(ms: number) {
      let remaining = ms * MS;
      while (remaining > 0) {
        const size = Math.min(CHUNK, remaining);
        chunks.push(Buffer.alloc(size));
        remaining -= size;
      }
      signal();
    },
    end() {
      ended = true;
      signal();
    },
  };
}

const tick = (ms: number) => vi.advanceTimersByTimeAsync(ms);

describe('pcm pump', () => {
  it('keeps playing through an upstream stall that exceeds the native queue', async () => {
    const source = controlledSource();
    const sink = fakeSink(1000);
    const pump = startPcmPump({
      source: source.iterable,
      sink: sink.sink,
      isCurrent: () => true,
    });
    let finished = false;
    void pump.done.then(() => (finished = true));
    source.push(5000); // burst: read-ahead holds it while playback runs at realtime
    await tick(3000); // upstream is silent for 3 s, longer than the 1 s native queue
    expect(sink.frames).toBeGreaterThan(300);
    expect(sink.underrunMs).toBe(0);
    source.push(2000);
    source.end();
    await tick(7000);
    expect(finished).toBe(true);
    expect(sink.frames).toBe(700);
    expect(sink.underrunMs).toBe(0);
  });

  it('collects the preroll before the first frame and flushes short tracks when the source ends', async () => {
    const source = controlledSource();
    const sink = fakeSink();
    const pump = startPcmPump({ source: source.iterable, sink: sink.sink, isCurrent: () => true });
    source.push(1500);
    await tick(500);
    expect(sink.frames).toBe(0);
    source.push(600);
    await tick(10);
    expect(sink.frames).toBeGreaterThan(0);

    const short = controlledSource();
    const shortSink = fakeSink();
    const shortPump = startPcmPump({
      source: short.iterable,
      sink: shortSink.sink,
      isCurrent: () => true,
    });
    short.push(500);
    short.end();
    await tick(2000);
    await expect(shortPump.done).resolves.toBeUndefined();
    expect(shortSink.frames).toBe(50);
    pump.cancel();
    await pump.done.catch(() => {});
  });

  it('rebuffers after running dry instead of resuming on every tiny chunk', async () => {
    const source = controlledSource();
    const sink = fakeSink(200);
    const pump = startPcmPump({
      source: source.iterable,
      sink: sink.sink,
      isCurrent: () => true,
      prerollMs: 500,
      rebufferMs: 1000,
    });
    source.push(500);
    await tick(1000); // everything played, the source is still alive: underrun
    const before = sink.frames;
    expect(before).toBe(50);
    source.push(400); // below the rebuffer threshold
    await tick(500);
    expect(sink.frames).toBe(before);
    source.push(700); // 1.1 s buffered
    await tick(50);
    expect(sink.frames).toBeGreaterThan(before);
    source.end();
    await tick(3000);
    await expect(pump.done).resolves.toBeUndefined();
    expect(sink.frames).toBe(160);
  });

  it('bounds memory: a fast source is back-pressured at the read-ahead limit', async () => {
    const maxReadAheadMs = 4000;
    const state = { pulled: 0, returned: false };
    let captured = 0;
    async function* infinite() {
      try {
        for (;;) {
          state.pulled += CHUNK;
          yield Buffer.alloc(CHUNK);
          await Promise.resolve();
        }
      } finally {
        state.returned = true;
      }
    }
    const sink = fakeSink(1000);
    let worst = 0;
    const pump = startPcmPump({
      source: infinite(),
      sink: {
        captureFrame: async (samples) => {
          await sink.sink.captureFrame(samples);
          captured++;
          worst = Math.max(worst, state.pulled - captured * PCM_FRAME_BYTES);
        },
      },
      isCurrent: () => true,
      maxReadAheadMs,
    });
    await tick(8000);
    expect(captured).toBeGreaterThan(600);
    // Unconsumed bytes never exceed the limit by more than one source chunk (plus the frame in hand).
    expect(worst).toBeLessThanOrEqual(maxReadAheadMs * MS + CHUNK + PCM_FRAME_BYTES);
    expect(state.pulled).toBeLessThan(captured * PCM_FRAME_BYTES + maxReadAheadMs * MS + 2 * CHUNK);
    pump.cancel();
    await tick(10);
    expect(state.returned).toBe(true);
  });

  it('cancel releases a producer parked on a full buffer and rejects done', async () => {
    const state = { returned: false };
    async function* infinite() {
      try {
        for (;;) {
          yield Buffer.alloc(CHUNK);
          await Promise.resolve();
        }
      } finally {
        state.returned = true;
      }
    }
    const frames = vi.fn();
    const pump = startPcmPump({
      source: infinite(),
      sink: { captureFrame: () => new Promise<void>(() => {}) }, // native queue full, never drains
      isCurrent: () => true,
      onFrame: frames,
      maxReadAheadMs: 500,
    });
    await tick(100);
    expect(state.returned).toBe(false);
    pump.cancel();
    await expect(pump.done).rejects.toThrow('Cancelled');
    await tick(10);
    expect(state.returned).toBe(true);
    expect(frames).not.toHaveBeenCalled();
  });

  it('cancel during preroll stops quickly and never publishes', async () => {
    const source = controlledSource();
    const sink = fakeSink();
    const spy = vi.spyOn(sink.sink, 'captureFrame');
    const pump = startPcmPump({ source: source.iterable, sink: sink.sink, isCurrent: () => true });
    source.push(800);
    await tick(100);
    pump.cancel();
    await expect(pump.done).rejects.toThrow('Cancelled');
    source.end(); // the killed decoder closes its stream
    await tick(10);
    expect(source.state.returned).toBe(true);
    expect(spy).not.toHaveBeenCalled();
  });

  it('stops as soon as the owner is no longer current, without publishing another frame', async () => {
    const source = controlledSource();
    const sink = fakeSink();
    let current = true;
    const onFrame = vi.fn();
    const pump = startPcmPump({
      source: source.iterable,
      sink: sink.sink,
      isCurrent: () => current,
      onFrame,
      prerollMs: 100,
    });
    source.push(3000);
    await tick(50);
    const seen = onFrame.mock.calls.length;
    expect(seen).toBeGreaterThan(0);
    current = false;
    const result = pump.done.catch((error) => error);
    await tick(100);
    expect(((await result) as Error).message).toBe('Cancelled');
    expect(onFrame.mock.calls.length).toBeLessThanOrEqual(seen + 1);
  });

  it('plays buffered audio out and then reports a source failure', async () => {
    const failure = new Error('boom');
    async function* failing() {
      yield Buffer.alloc(300 * MS);
      throw failure;
    }
    const sink = fakeSink();
    const pump = startPcmPump({ source: failing(), sink: sink.sink, isCurrent: () => true });
    const result = pump.done.catch((error) => error);
    await tick(2000);
    await expect(result).resolves.toBe(failure);
    expect(sink.frames).toBe(30);
  });
});
