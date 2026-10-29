import { t } from '@rooms/i18n';
import { Track, type TrackProcessor, type AudioProcessorOptions } from 'livekit-client';
import {
  createNoiseSuppressionNode,
  type NoiseSuppressionNode,
  type NoiseSuppressionMode,
  type NoiseProcessingStats,
} from './noise-suppression';
import { createMicGateNode, type MicGateNode } from './mic-gate-node';
import { DEFAULT_MIC_GATE, type MicGateReport, type MicGateSettings } from './mic-gate';
/** Linear make-up gain after the leveler's compressor (about +6 dB). */
export const MIC_LEVELER_MAKEUP = 2;
/** Mix a user-selected clip into the existing authorized microphone publication. */
export class SoundboardMixer implements TrackProcessor<Track.Kind.Audio, AudioProcessorOptions> {
  name = 'rooms-microphone-denoise-soundboard';
  constructor(
    private noiseSuppression = false,
    private mode: NoiseSuppressionMode = 'strong',
    private callbacks: {
      error?(): void;
      stats?(value: NoiseProcessingStats): void;
      /** The input gate opened or closed; null when it is unavailable (sent ungated). */
      gate?(report: MicGateReport | null): void;
      /** Live input level for the Settings meter, about 20 times a second. */
      level?(report: MicGateReport): void;
      /** A soundboard clip started or ended; it is sent past the gate. */
      playing?(value: boolean): void;
    } = {},
    audio: { gate?: MicGateSettings; leveler?: boolean } = {},
  ) {
    this.gateSettings = audio.gate ?? DEFAULT_MIC_GATE;
    this.leveling = audio.leveler ?? true;
  }
  private destroyed = false;
  private denoiser?: NoiseSuppressionNode;
  private processingAbort?: AbortController;
  private async createDenoiser() {
    let node: NoiseSuppressionNode;
    node = await createNoiseSuppressionNode(this.context!, this.mode, {
      signal: this.processingAbort?.signal,
      error: () => {
        if (this.denoiser !== node) return;
        this.stop();
        this.input?.disconnect();
        this.processedTrack?.stop();
        this.callbacks.error?.();
      },
      stats: (value) => {
        if (this.denoiser === node) this.callbacks.stats?.(value);
      },
    });
    return node;
  }
  processedTrack?: MediaStreamTrack;
  private input?: MediaStreamAudioSourceNode;
  /** The person's input level for the current microphone, applied before the noise filter. */
  private level?: GainNode;
  private inputLevel = 1;
  private destination?: MediaStreamAudioDestinationNode;
  /** Evens out loud and quiet talkers after denoising, where the browser's own AGC is off. */
  private leveler?: { input: AudioNode; output: AudioNode };
  /** Input gate between the voice chain and the room; soundboard clips bypass it. */
  private gate?: MicGateNode;
  private gateSettings: MicGateSettings;
  private leveling: boolean;
  private clip?: AudioBufferSourceNode;
  private gain?: GainNode;
  private context?: AudioContext;
  /** A soundboard clip is being sent now. */
  get playing() {
    return !!this.clip;
  }
  async init(options: AudioProcessorOptions) {
    if (this.destroyed) throw new DOMException('Cancelled', 'AbortError');
    this.processingAbort = new AbortController();
    this.context = options.audioContext ?? this.context;
    if (!this.context) throw new Error('Microphone audio context is unavailable.');
    this.input = this.context.createMediaStreamSource(new MediaStream([options.track]));
    this.level = this.context.createGain();
    this.level.gain.value = this.inputLevel;
    this.input.connect(this.level);
    this.destination = this.context.createMediaStreamDestination();
    try {
      await this.createGate();
      if (this.noiseSuppression) this.denoiser = await this.createDenoiser();
      this.wire();
      this.processedTrack = this.destination.stream.getAudioTracks()[0];
    } catch (error) {
      await this.destroy();
      throw error;
    }
  }
  // LiveKit track restart does not pass audioContext; preserve the original context.
  async restart(options: AudioProcessorOptions) {
    const context = this.context;
    await this.destroy();
    this.destroyed = false;
    await this.init({ ...options, audioContext: options.audioContext ?? context! });
  }
  async setNoiseSuppression(value: boolean, mode: NoiseSuppressionMode = this.mode) {
    if (value === this.noiseSuppression && mode === this.mode) return;
    if (!this.context || !this.level || !this.destination)
      throw new Error('Microphone processor is unavailable.');
    const previousMode = this.mode;
    this.mode = mode;
    let node: NoiseSuppressionNode | undefined;
    try {
      node = value ? await this.createDenoiser() : undefined;
    } catch (error) {
      this.mode = previousMode;
      throw error;
    }
    this.denoiser?.destroy();
    this.denoiser = node;
    this.wire();
    this.noiseSuppression = value;
  }
  /** Input level → noise filter → leveler (filter on, leveler on) → gate → room. */
  private wire() {
    if (!this.level || !this.destination) return;
    this.level.disconnect();
    this.denoiser?.disconnect();
    this.disposeLeveler();
    this.gate?.disconnect();
    const tail: AudioNode = this.gate ?? this.destination;
    if (this.gate) this.gate.connect(this.destination);
    if (this.denoiser) {
      this.level.connect(this.denoiser);
      this.denoiser.connect(this.leveling ? this.levelerFor(tail) : tail);
    } else this.level.connect(tail);
  }
  private async createGate() {
    const context = this.context;
    if (!context) return;
    let node: MicGateNode | null = null;
    try {
      node = await createMicGateNode(context, this.gateSettings, {
        onState: (report) => {
          if (this.gate === node) this.callbacks.gate?.(report);
        },
        onLevel: (report) => {
          if (this.gate === node) this.callbacks.level?.(report);
        },
        onFailure: () => {
          // A stopped gate would silence the microphone: send ungated instead.
          if (this.gate !== node) return;
          this.gate = undefined;
          node?.destroy();
          this.wire();
          this.callbacks.gate?.(null);
        },
      });
    } catch {
      node = null;
    }
    if (this.destroyed) {
      node?.destroy();
      return;
    }
    this.gate = node ?? undefined;
    this.callbacks.gate?.(
      node ? { open: false, level: -120, threshold: this.gateSettings.threshold } : null,
    );
  }
  /** Input sensitivity: automatic or a manual threshold in dBFS. */
  setGate(settings: MicGateSettings) {
    this.gateSettings = settings;
    this.gate?.configure(settings);
  }
  /** The leveler after the noise filter ("Ses seviyesini dengele"); no effect while the filter is off. */
  setLeveler(value: boolean) {
    if (value === this.leveling) return;
    this.leveling = value;
    this.wire();
  }
  /**
   * Strong noise removal turns the browser's AGC off (it would amplify noise before the filter),
   * so mic loudness differs a lot per person. A gentle compressor plus make-up gain after the
   * filter narrows that gap without touching what is below the noise floor. Contexts without a
   * compressor (older engines, test doubles) get the plain path.
   */
  private levelerFor(destination: AudioNode): AudioNode {
    const context = this.context;
    if (!context?.createDynamicsCompressor) return destination;
    const compressor = context.createDynamicsCompressor(),
      makeup = context.createGain();
    compressor.threshold.value = -24;
    compressor.knee.value = 20;
    compressor.ratio.value = 3;
    compressor.attack.value = 0.01;
    compressor.release.value = 0.25;
    makeup.gain.value = MIC_LEVELER_MAKEUP;
    compressor.connect(makeup);
    makeup.connect(destination);
    this.leveler = { input: compressor, output: makeup };
    return compressor;
  }
  private disposeLeveler() {
    this.leveler?.input.disconnect();
    this.leveler?.output.disconnect();
    this.leveler = undefined;
  }
  /** 1 sends the microphone as captured; 0–2 scales what the room hears. */
  setInputLevel(value: number) {
    this.inputLevel = value;
    if (this.level && this.context)
      this.level.gain.setTargetAtTime(value, this.context.currentTime, 0.02);
  }
  stop() {
    const clip = this.clip;
    this.clip = undefined;
    if (clip) {
      clip.onended = null;
      try {
        clip.stop();
      } catch {}
      clip.disconnect();
      this.callbacks.playing?.(false);
    }
    this.gain?.disconnect();
    this.gain = undefined;
  }
  async play(buffer: AudioBuffer, volume: number, canPlay: () => boolean) {
    if (!this.context || !this.destination) throw new Error(t('Mikrofon kullanılamıyor.'));
    this.stop();
    await this.context.resume();
    if (!canPlay()) return;
    const clip = this.context.createBufferSource(),
      gain = this.context.createGain();
    clip.buffer = buffer;
    gain.gain.value = volume;
    clip.connect(gain);
    gain.connect(this.destination);
    // Monitor only the selected clip. Never route microphone input to the speakers.
    gain.connect(this.context.destination);
    this.clip = clip;
    this.gain = gain;
    clip.onended = () => {
      if (this.clip === clip) this.stop();
    };
    clip.start();
    this.callbacks.playing?.(true);
  }
  async destroy() {
    this.destroyed = true;
    this.processingAbort?.abort();
    this.processingAbort = undefined;
    this.stop();
    this.input?.disconnect();
    this.level?.disconnect();
    this.level = undefined;
    this.denoiser?.disconnect();
    this.denoiser?.destroy();
    this.denoiser = undefined;
    this.disposeLeveler();
    this.gate?.destroy();
    this.gate = undefined;
    this.processedTrack?.stop();
    this.destination?.stream.getTracks().forEach((track) => track.stop());
    this.input = undefined;
    this.destination = undefined;
    this.processedTrack = undefined;
    this.context = undefined;
  }
}
