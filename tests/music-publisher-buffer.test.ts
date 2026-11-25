import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({
  children: [] as any[],
  sources: [] as any[],
  openYouTubeAudio: vi.fn(),
}));

vi.mock('node:child_process', () => ({
  spawn: () => {
    const child: any = new EventEmitter();
    child.stdout = new PassThrough();
    child.stdin = new PassThrough();
    child.kill = vi.fn(() => {
      child.stdout.end();
      Promise.resolve().then(() => child.emit('close', null));
    });
    h.children.push(child);
    return child;
  },
}));

vi.mock('../apps/services/music/youtube-source', () => ({ openYouTubeAudio: h.openYouTubeAudio }));

vi.mock('../apps/services/music/node_modules/@livekit/rtc-node', () => {
  class AudioFrame {
    constructor(
      public data: Int16Array,
      public sampleRate: number,
      public channels: number,
      public samplesPerChannel: number,
    ) {}
  }
  /** Same pacing contract as the native source: accept until the queue is full, then realtime. */
  class AudioSource {
    queued = 0;
    last = 0;
    captured = 0;
    clearQueue = vi.fn(() => {
      this.queued = 0;
    });
    constructor(
      public sampleRate: number,
      public channels: number,
      public queueSize: number,
    ) {
      h.sources.push(this);
    }
    private drain() {
      const now = Date.now();
      if (this.last) this.queued = Math.max(this.queued - (now - this.last), 0);
      this.last = now;
    }
    get queuedDuration() {
      this.drain();
      return this.queued;
    }
    async captureFrame() {
      this.drain();
      while (this.queued + 10 > this.queueSize) {
        await new Promise((resolve) => setTimeout(resolve, 10));
        this.drain();
      }
      this.queued += 10;
      this.captured++;
    }
    async waitForPlayout() {
      await new Promise((resolve) => setTimeout(resolve, this.queuedDuration));
    }
    async close() {}
  }
  class Room {
    localParticipant = { publishTrack: async () => {} };
    async connect() {}
    async disconnect() {}
  }
  return {
    AudioFrame,
    AudioSource,
    Room,
    LocalAudioTrack: { createAudioTrack: () => ({ close: async () => {} }) },
    TrackPublishOptions: class {},
    TrackSource: { SOURCE_MICROPHONE: 1 },
  };
});

import { LiveMusicPublisher } from '../apps/services/music/publisher';

const MS = 192;
const tick = (ms: number) => vi.advanceTimersByTimeAsync(ms);

function youtubeInput() {
  let resolveDone!: () => void;
  const done = new Promise<void>((resolve) => (resolveDone = resolve));
  return {
    stream: new PassThrough(),
    done,
    format: 's16le' as const,
    close: vi.fn(async () => {}),
    finish: resolveDone,
  };
}

/** Decoder finished: output closed, process exit code reported. */
function finishChild(child: any, code: number) {
  child.stdout.end();
  Promise.resolve().then(() => child.emit('close', code));
}

beforeEach(() => {
  vi.useFakeTimers();
  h.children.length = 0;
  h.sources.length = 0;
  h.openYouTubeAudio.mockReset();
});
afterEach(() => vi.useRealTimers());

async function startYouTube(publisher: LiveMusicPublisher, onEnded = vi.fn(), onError = vi.fn()) {
  const input = youtubeInput();
  h.openYouTubeAudio.mockResolvedValue(input);
  const started = publisher.playYouTube(
    'https://www.youtube.com/watch?v=PgHzDZJwGW8',
    0,
    onEnded,
    onError,
  );
  await tick(0);
  return { input, started, onEnded, onError, child: h.children.at(-1) };
}

describe('LiveMusicPublisher read-ahead', () => {
  it('uses a 1 s native queue', () => {
    new LiveMusicPublisher();
    expect(h.sources[0].queueSize).toBe(1000);
  });

  it('starts after the preroll, reports position from what was played and fires onEnded once', async () => {
    const publisher = new LiveMusicPublisher();
    const { child, started, onEnded, onError, input } = await startYouTube(publisher);
    child.stdout.write(Buffer.alloc(1000 * MS));
    await tick(100);
    expect(h.sources[0].captured).toBe(0); // still prerolling
    expect(publisher.position()).toBe(0);
    child.stdout.write(Buffer.alloc(4000 * MS));
    finishChild(child, 0);
    input.finish();
    await tick(20);
    await started; // resolved by the first published frame
    await tick(2000);
    expect(publisher.position()).toBeGreaterThan(1.9);
    expect(publisher.position()).toBeLessThan(2.1);
    expect(onEnded).not.toHaveBeenCalled();
    await tick(4000);
    expect(onEnded).toHaveBeenCalledTimes(1);
    expect(onError).not.toHaveBeenCalled();
    expect(publisher.position()).toBeCloseTo(5, 1);
    await tick(5000);
    expect(onEnded).toHaveBeenCalledTimes(1);
    expect(input.close).toHaveBeenCalled();
  });

  it('pause clears the native queue, stops the decoder and never fires onEnded', async () => {
    const publisher = new LiveMusicPublisher();
    const { child, started, onEnded, onError, input } = await startYouTube(publisher);
    child.stdout.write(Buffer.alloc(6000 * MS));
    await tick(20);
    await started;
    await tick(2000);
    publisher.pause();
    expect(h.sources[0].clearQueue).toHaveBeenCalled();
    expect(child.kill).toHaveBeenCalledWith('SIGKILL');
    const captured = h.sources[0].captured;
    expect(publisher.position()).toBeGreaterThan(1.9);
    expect(publisher.position()).toBeLessThan(2.1);
    await tick(10000);
    expect(h.sources[0].captured).toBeLessThanOrEqual(captured + 1);
    expect(onEnded).not.toHaveBeenCalled();
    expect(onError).not.toHaveBeenCalled();
    expect(input.close).toHaveBeenCalled();
  });

  it('a new track after a seek is not corrupted by frames of the old one', async () => {
    const publisher = new LiveMusicPublisher();
    const first = await startYouTube(publisher);
    first.child.stdout.write(Buffer.alloc(6000 * MS));
    await tick(20);
    await first.started;
    await tick(500);
    const second = await startYouTube(publisher);
    second.child.stdout.write(Buffer.alloc(3000 * MS));
    await tick(20);
    await second.started;
    await tick(1000);
    expect(publisher.position()).toBeGreaterThan(0.9);
    expect(publisher.position()).toBeLessThan(1.1);
  });

  it('keeps the startup timeout when no audio arrives', async () => {
    const publisher = new LiveMusicPublisher();
    const { started, onError, onEnded } = await startYouTube(publisher);
    const result = started.catch((error) => error);
    await tick(60001);
    expect(((await result) as Error).message).toBe('MUSIC_SOURCE_TIMEOUT');
    expect(onError).not.toHaveBeenCalled();
    expect(onEnded).not.toHaveBeenCalled();
  });

  it('reports a failed decode once, after the buffered audio, and not as an ended track', async () => {
    const publisher = new LiveMusicPublisher();
    const { child, started, onEnded, onError } = await startYouTube(publisher);
    child.stdout.write(Buffer.alloc(500 * MS));
    finishChild(child, 1);
    await tick(20);
    await started;
    await tick(2000);
    expect(onError).toHaveBeenCalledTimes(1);
    expect((onError.mock.calls[0][0] as Error).message).toBe('Decode failed');
    expect(onEnded).not.toHaveBeenCalled();
  });

  it('rejects an empty source as an error', async () => {
    const publisher = new LiveMusicPublisher();
    const { child, started, onError, input } = await startYouTube(publisher);
    const result = started.catch((error) => error);
    finishChild(child, 0);
    input.finish();
    await tick(20);
    expect(((await result) as Error).message).toBe('Empty audio');
    expect(onError).toHaveBeenCalledTimes(1);
  });

  it('feeds local MP3 playback through the same buffer and fires onEnded once', async () => {
    const publisher = new LiveMusicPublisher();
    const onEnded = vi.fn();
    const onError = vi.fn();
    await publisher.play('/tmp/song.mp3', 0, onEnded, onError);
    const child = h.children.at(-1);
    child.stdout.write(Buffer.alloc(3000 * MS));
    finishChild(child, 0);
    await tick(20);
    expect(h.sources[0].captured).toBeGreaterThan(0);
    await tick(5000);
    expect(onEnded).toHaveBeenCalledTimes(1);
    expect(onError).not.toHaveBeenCalled();
    expect(publisher.position()).toBeCloseTo(3, 1);
  });
});
