import { spawn } from 'node:child_process';
import {
  AudioFrame,
  AudioSource,
  LocalAudioTrack,
  Room,
  TrackPublishOptions,
  TrackSource,
} from '@livekit/rtc-node';
import { PCM_SAMPLE_RATE, PCM_SOURCE_QUEUE_MS, startPcmPump, type PcmPump } from './pcm-pump';
import { openYouTubeAudio } from './youtube-source';
export interface MusicPublisher {
  connect(url: string, token: string): Promise<void>;
  play(
    path: string,
    position: number,
    onEnded: () => void,
    onError: (error?: Error) => void,
  ): Promise<void>;
  playYouTube?(
    source: string,
    position: number,
    onEnded: () => void,
    onError: (error?: Error) => void,
  ): Promise<void>;
  pause(): void;
  position(): number;
  close(): Promise<void>;
}
/** Server PCM publishing; ffmpeg receives a local MP3 only and cannot fetch network resources. */
export class LiveMusicPublisher implements MusicPublisher {
  private streamClose: (() => Promise<void>) | null = null;
  private room = new Room();
  // A 1 s native queue absorbs feeder scheduling jitter; the read-ahead buffer in pcm-pump covers
  // upstream stalls. pause() clears the queue so a pause or seek does not keep playing.
  private source = new AudioSource(PCM_SAMPLE_RATE, 2, PCM_SOURCE_QUEUE_MS);
  private track = LocalAudioTrack.createAudioTrack('DJ', this.source);
  private decoder: ReturnType<typeof spawn> | null = null;
  private pump: PcmPump | null = null;
  private generation = 0;
  private offset = 0;
  private frames = 0;
  private playing = false;
  async connect(url: string, token: string) {
    await this.room.connect(url, token, { autoSubscribe: false, dynacast: false });
    const options = new TrackPublishOptions({
      audioEncoding: { maxBitrate: 510000n },
      dtx: false,
      red: false,
    });
    options.source = TrackSource.SOURCE_MICROPHONE;
    await this.room.localParticipant!.publishTrack(this.track, options);
  }
  position() {
    return Math.max(
      0,
      this.offset + this.frames / 48000 - (this.playing ? this.source.queuedDuration / 1000 : 0),
    );
  }
  pause() {
    this.offset = this.position();
    this.frames = 0;
    this.playing = false;
    this.generation++;
    this.pump?.cancel();
    this.pump = null;
    this.decoder?.kill('SIGKILL');
    this.decoder = null;
    void this.streamClose?.();
    this.streamClose = null;
    this.source.clearQueue();
  }
  /** Feeds decoder PCM through the read-ahead buffer; `frames` advances as each frame is accepted. */
  private startPump(stream: AsyncIterable<Uint8Array>, generation: number, onFrame?: () => void) {
    const pump = startPcmPump({
      source: stream,
      sink: {
        captureFrame: (samples) =>
          this.source.captureFrame(new AudioFrame(samples, PCM_SAMPLE_RATE, 2, 480)),
      },
      isCurrent: () => generation === this.generation,
      onFrame: () => {
        this.frames += 480;
        onFrame?.();
      },
    });
    this.pump = pump;
    return pump;
  }

  async play(
    path: string,
    position: number,
    onEnded: () => void,
    onError: (error?: Error) => void,
  ) {
    this.pause();
    this.offset = position;
    this.frames = 0;
    this.playing = true;
    const generation = this.generation;
    const child = spawn(
      'ffmpeg',
      [
        '-v',
        'error',
        '-nostdin',
        '-protocol_whitelist',
        'file,pipe',
        '-format_whitelist',
        'mp3',
        '-ss',
        String(position),
        '-i',
        path,
        '-map',
        '0:a:0',
        '-vn',
        '-ac',
        '2',
        '-ar',
        '48000',
        '-f',
        's16le',
        'pipe:1',
      ],
      { stdio: ['ignore', 'pipe', 'ignore'] },
    );
    this.decoder = child;
    const done = new Promise<number | null>((resolve, reject) => {
      child.once('error', reject);
      child.once('close', resolve);
    });
    void done.catch(() => {});
    const pump = this.startPump(child.stdout!, generation);
    void (async () => {
      try {
        await pump.done;
        if ((await done) !== 0) throw new Error('Decode failed');
        await this.source.waitForPlayout();
        if (generation === this.generation) {
          this.offset = this.position();
          this.playing = false;
          this.frames = 0;
          onEnded();
        }
      } catch {
        if (generation === this.generation) {
          this.pause();
          onError();
        }
      }
    })();
  }
  async playYouTube(
    url: string,
    position: number,
    onEnded: () => void,
    onError: (error?: Error) => void,
  ) {
    this.pause();
    this.offset = position;
    this.frames = 0;
    this.playing = true;
    const generation = this.generation;
    const input = await openYouTubeAudio(url, position);
    if (generation !== this.generation) {
      await input.close();
      return;
    }
    this.streamClose = input.close;
    const inputFormat =
      input.format === 's16le'
        ? ['-f', 's16le', '-ar', '48000', '-ac', '2']
        : ['-format_whitelist', 'matroska,webm', '-ss', String(position)];
    const child = spawn(
      'ffmpeg',
      [
        '-v',
        'error',
        '-nostdin',
        '-protocol_whitelist',
        'file,pipe',
        ...inputFormat,
        '-i',
        'pipe:0',
        '-map',
        '0:a:0',
        '-vn',
        '-ac',
        '2',
        '-ar',
        '48000',
        '-f',
        's16le',
        'pipe:1',
      ],
      { stdio: ['pipe', 'pipe', 'ignore'] },
    );
    this.decoder = child;
    child.stdin.on('error', () => {});
    input.stream.pipe(child.stdin);
    const done = new Promise<number | null>((resolve, reject) => {
      child.once('error', reject);
      child.once('close', resolve);
    });
    void done.catch(() => {});
    let sourceError: Error | undefined;
    void input.done.catch((error) => {
      sourceError = error instanceof Error ? error : new Error('MUSIC_SOURCE_FAILED');
      child.kill('SIGKILL');
    });
    let started = false;
    let resolveReady!: () => void, rejectReady!: (error: Error) => void;
    const ready = new Promise<void>((resolve, reject) => {
      resolveReady = resolve;
      rejectReady = reject;
    });
    const startup = setTimeout(() => {
      if (!started) {
        this.pause();
        rejectReady(new Error('MUSIC_SOURCE_TIMEOUT'));
      }
    }, 60000);
    const pump = this.startPump(child.stdout, generation, () => {
      if (!started) {
        started = true;
        clearTimeout(startup);
        resolveReady();
      }
    });
    void (async () => {
      try {
        await pump.done;
        if ((await done) !== 0) throw new Error('Decode failed');
        await input.done;
        if (!started) throw new Error('Empty audio');
        await this.source.waitForPlayout();
        if (generation === this.generation) {
          this.offset = this.position();
          this.playing = false;
          this.frames = 0;
          onEnded();
        }
      } catch (error) {
        const failure =
          sourceError ?? (error instanceof Error ? error : new Error('MUSIC_SOURCE_FAILED'));
        if (!started) {
          clearTimeout(startup);
          rejectReady(failure);
        }
        if (generation === this.generation) {
          this.pause();
          onError(failure);
        }
      } finally {
        await input.close();
      }
    })();
    await ready;
  }
  async close() {
    this.pause();
    await this.room.disconnect();
    await this.track.close();
    await this.source.close();
  }
}
