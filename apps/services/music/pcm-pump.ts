/**
 * Read-ahead jitter buffer between a PCM decoder and the LiveKit audio source.
 *
 * Input is raw s16le 48 kHz stereo. The pump reads ahead of playback into a bounded byte queue and
 * feeds 10 ms frames to the sink. It never paces on its own timer: `captureFrame` accepts frames
 * immediately while the native queue has room and then paces at realtime, so awaiting it is the
 * playback clock. The read-ahead only has to cover upstream hiccups (segment fetches, JVM pauses,
 * CPU throttling); the native queue only has to cover the feeder's own scheduling jitter.
 */
export const PCM_SAMPLE_RATE = 48000;
export const PCM_CHANNELS = 2;
/** 10 ms of s16le stereo: 480 samples per channel. */
export const PCM_FRAME_SAMPLES = 480;
export const PCM_FRAME_BYTES = PCM_FRAME_SAMPLES * PCM_CHANNELS * 2;
const BYTES_PER_MS = (PCM_SAMPLE_RATE * PCM_CHANNELS * 2) / 1000;
/** Audio collected before the first frame is published. */
export const PCM_PREROLL_MS = 2000;
/** Upper bound for read-ahead (12 s is about 2.3 MB). Beyond it, the decoder is back-pressured. */
export const PCM_MAX_READAHEAD_MS = 12000;
/** Audio collected again after the buffer ran dry before playback resumes. */
export const PCM_REBUFFER_MS = 1000;
/** Native AudioSource queue. Frames beyond it make captureFrame wait, which paces playback. */
export const PCM_SOURCE_QUEUE_MS = 1000;

export interface PcmSink {
  captureFrame(samples: Int16Array): Promise<void>;
}

export interface PcmPumpOptions {
  source: AsyncIterable<Uint8Array>;
  sink: PcmSink;
  /** False once the owner moved on (new generation); the pump then stops without publishing. */
  isCurrent: () => boolean;
  /** Called after each frame was accepted by the sink, only while the pump is still current. */
  onFrame?: () => void;
  prerollMs?: number;
  maxReadAheadMs?: number;
  rebufferMs?: number;
}

export interface PcmPump {
  /**
   * Resolves once the source ended and every frame was accepted by the sink. Rejects with
   * `Error('Cancelled')` after cancel(), or with the source's own error. Audio already buffered when
   * the source fails is still played out before the error is reported.
   */
  done: Promise<void>;
  /** Stops both loops immediately and releases the source. Safe to call more than once. */
  cancel(): void;
}

/** FIFO of chunks that avoids re-concatenating the whole backlog on every read. */
class ByteQueue {
  private chunks: Buffer[] = [];
  private head = 0;
  length = 0;
  push(chunk: Uint8Array) {
    if (chunk.length === 0) return;
    this.chunks.push(Buffer.from(chunk.buffer, chunk.byteOffset, chunk.byteLength));
    this.length += chunk.length;
  }
  take(size: number) {
    const out = Buffer.allocUnsafe(size);
    let filled = 0;
    while (filled < size) {
      const chunk = this.chunks[0];
      const count = Math.min(size - filled, chunk.length - this.head);
      chunk.copy(out, filled, this.head, this.head + count);
      filled += count;
      this.head += count;
      if (this.head === chunk.length) {
        this.chunks.shift();
        this.head = 0;
      }
    }
    this.length -= size;
    return out;
  }
}

export function startPcmPump(options: PcmPumpOptions): PcmPump {
  const prerollBytes = bytesFor(options.prerollMs ?? PCM_PREROLL_MS);
  const maxBytes = Math.max(
    PCM_FRAME_BYTES,
    bytesFor(options.maxReadAheadMs ?? PCM_MAX_READAHEAD_MS),
  );
  const rebufferBytes = bytesFor(options.rebufferMs ?? PCM_REBUFFER_MS);
  const queue = new ByteQueue();
  const iterator = options.source[Symbol.asyncIterator]();
  const waiters = new Set<() => void>();
  const notify = () => {
    for (const resolve of [...waiters]) resolve();
    waiters.clear();
  };
  const changed = () => new Promise<void>((resolve) => waiters.add(resolve));
  let cancelled = false;
  let ended = false;
  let failure: unknown;
  let failed = false;
  let rejectCancel!: (error: Error) => void;
  const cancelSignal = new Promise<never>((_, reject) => (rejectCancel = reject));
  cancelSignal.catch(() => {});
  let released = false;
  const release = () => {
    if (released) return;
    released = true;
    // Queued behind a pending next(); the decoder being killed ends that read.
    void Promise.resolve(iterator.return?.()).catch(() => {});
  };
  const stop = () => {
    if (cancelled) return;
    cancelled = true;
    rejectCancel(new Error('Cancelled'));
    notify();
    release();
  };

  const produce = async () => {
    try {
      while (!cancelled) {
        while (!cancelled && queue.length >= maxBytes) await changed();
        if (cancelled) break;
        const next = await iterator.next();
        if (cancelled) break;
        if (next.done) break;
        queue.push(next.value);
        notify();
      }
    } catch (error) {
      if (!cancelled) {
        failed = true;
        failure = error;
      }
    } finally {
      ended = true;
      notify();
      release();
    }
  };

  const consume = async () => {
    let need = prerollBytes;
    for (;;) {
      while (!cancelled && !ended && queue.length < need) await changed();
      if (cancelled) throw new Error('Cancelled');
      while (queue.length >= PCM_FRAME_BYTES) {
        const bytes = queue.take(PCM_FRAME_BYTES);
        notify();
        const samples = new Int16Array(PCM_FRAME_BYTES / 2);
        for (let i = 0; i < samples.length; i++) samples[i] = bytes.readInt16LE(i * 2);
        if (cancelled || !options.isCurrent()) {
          stop();
          throw new Error('Cancelled');
        }
        await Promise.race([options.sink.captureFrame(samples), cancelSignal]);
        if (cancelled || !options.isCurrent()) {
          stop();
          throw new Error('Cancelled');
        }
        options.onFrame?.();
      }
      if (ended) {
        if (failed) throw failure;
        return;
      }
      // Buffer ran dry while the source is still alive: wait for a short rebuffer so a recovering
      // stall does not come out as many tiny gaps.
      need = rebufferBytes;
    }
  };

  void produce();
  const done = consume().finally(stop);
  // Callers await done; a pump that is cancelled and never awaited must not raise unhandled rejections.
  done.catch(() => {});
  return { done, cancel: stop };
}

function bytesFor(ms: number) {
  return Math.max(0, Math.round(ms * BYTES_PER_MS));
}
