/**
 * Input sensitivity gate for the outgoing microphone (pure DSP, no Web Audio types), shared by the
 * audio-thread worklet and the tests. Levels are time-domain RMS in dBFS, measured on what the
 * room is sent (after the input level, noise filter and leveler).
 */
export interface MicGateSettings {
  /** Follow the noise floor; false uses `threshold`. */
  auto: boolean;
  /** Manual threshold in dBFS. */
  threshold: number;
}
/**
 * Never send anything a listener's speaking meter calls silence: it lights at RMS 0.012
 * (about -38.4 dBFS), the same in rc.34 clients. Anything quieter would be heard without a ring.
 */
export const MIC_GATE_MIN_DB = -38;
export const MIC_GATE_MAX_DB = -10;
export const MIC_GATE_DEFAULT_DB = -34;
export const DEFAULT_MIC_GATE: MicGateSettings = { auto: true, threshold: MIC_GATE_DEFAULT_DB };
/** Automatic mode sits this far above the measured noise floor, within [MIN, AUTO_MAX]. */
export const MIC_GATE_AUTO_MARGIN_DB = 15;
export const MIC_GATE_AUTO_MAX_DB = -24;
export const MIC_GATE_TIMING = {
  /** Analysis frame. */
  frame: 0.005,
  /** Frames in a row above the threshold before the gate opens (20 ms of sustained sound). */
  openFrames: 4,
  /** The audio is delayed this much, so the opening decision does not cut the first syllable. */
  lookahead: 0.02,
  attack: 0.005,
  hold: 0.25,
  release: 0.12,
  /** Once open, the level may dip this far below the threshold without starting the hold. */
  hysteresisDb: 4,
} as const;
const SILENCE_DB = -120;
export function clampMicGateThreshold(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value)
    ? Math.max(MIC_GATE_MIN_DB, Math.min(MIC_GATE_MAX_DB, Math.round(value)))
    : MIC_GATE_DEFAULT_DB;
}
export function micGateSettings(value: Partial<MicGateSettings> | undefined): MicGateSettings {
  return {
    auto: typeof value?.auto === 'boolean' ? value.auto : true,
    threshold: clampMicGateThreshold(value?.threshold),
  };
}
export function rmsDb(sumOfSquares: number, samples: number): number {
  if (!samples || !(sumOfSquares > 0)) return SILENCE_DB;
  return Math.max(SILENCE_DB, 10 * Math.log10(sumOfSquares / samples));
}
export interface MicGateReport {
  open: boolean;
  /** RMS of the last analysis frame, dBFS. */
  level: number;
  /** The threshold in use now (the automatic one in auto mode). */
  threshold: number;
}
export class MicGateCore {
  private settings: MicGateSettings;
  private readonly frameSize: number;
  private readonly holdFrames: number;
  private readonly attackStep: number;
  private readonly releaseStep: number;
  private readonly delay: Float32Array;
  private delayIndex = 0;
  private frameSum = 0;
  private frameFill = 0;
  private loudRun = 0;
  private holdLeft = 0;
  private gain = 0;
  /** Estimated noise floor for automatic mode, dBFS. */
  private floor = -60;
  private readonly floorRiseClosed: number;
  private readonly floorRiseOpen: number;
  open = false;
  level = SILENCE_DB;
  constructor(
    readonly sampleRate: number,
    settings: Partial<MicGateSettings> = DEFAULT_MIC_GATE,
  ) {
    this.settings = micGateSettings(settings);
    const t = MIC_GATE_TIMING;
    this.frameSize = Math.max(1, Math.round(sampleRate * t.frame));
    const frameSeconds = this.frameSize / sampleRate;
    this.holdFrames = Math.max(1, Math.round(t.hold / frameSeconds));
    this.attackStep = 1 / Math.max(1, sampleRate * t.attack);
    this.releaseStep = 1 / Math.max(1, sampleRate * t.release);
    this.delay = new Float32Array(Math.max(1, Math.round(sampleRate * t.lookahead)));
    // The floor climbs slowly (3 dB/s), slower still while someone talks (0.5 dB/s).
    this.floorRiseClosed = 3 * frameSeconds;
    this.floorRiseOpen = 0.5 * frameSeconds;
  }
  configure(settings: Partial<MicGateSettings>) {
    this.settings = micGateSettings({ ...this.settings, ...settings });
  }
  /** The threshold in use now, dBFS. */
  threshold(): number {
    if (!this.settings.auto) return this.settings.threshold;
    return Math.max(
      MIC_GATE_MIN_DB,
      Math.min(MIC_GATE_AUTO_MAX_DB, this.floor + MIC_GATE_AUTO_MARGIN_DB),
    );
  }
  report(): MicGateReport {
    return { open: this.open, level: this.level, threshold: this.threshold() };
  }
  /**
   * Gates `input` into `output` (same length, may be the same array) with the lookahead delay.
   * Returns true when the open state changed during this block.
   */
  process(input: Float32Array, output: Float32Array): boolean {
    const wasOpen = this.open;
    let changed = false;
    for (let i = 0; i < input.length; i++) {
      const sample = Number.isFinite(input[i]) ? input[i] : 0;
      const delayed = this.delay[this.delayIndex];
      this.delay[this.delayIndex] = sample;
      this.delayIndex = (this.delayIndex + 1) % this.delay.length;
      this.frameSum += sample * sample;
      if (++this.frameFill === this.frameSize) {
        const before = this.open;
        this.analyse(rmsDb(this.frameSum, this.frameFill));
        if (before !== this.open) changed = true;
        this.frameSum = 0;
        this.frameFill = 0;
      }
      if (this.open) this.gain = Math.min(1, this.gain + this.attackStep);
      else this.gain = Math.max(0, this.gain - this.releaseStep);
      // Fully closed sends exact zeros, so Opus DTX can stop sending.
      output[i] = this.gain > 0 ? delayed * this.gain : 0;
    }
    return changed || wasOpen !== this.open;
  }
  private analyse(level: number) {
    this.level = level;
    const threshold = this.threshold();
    if (!this.open) {
      this.loudRun = level >= threshold ? this.loudRun + 1 : 0;
      if (this.loudRun >= MIC_GATE_TIMING.openFrames) {
        this.open = true;
        this.holdLeft = this.holdFrames;
      }
    } else if (level >= threshold - MIC_GATE_TIMING.hysteresisDb) this.holdLeft = this.holdFrames;
    else if (--this.holdLeft <= 0) {
      this.open = false;
      this.loudRun = 0;
    }
    // Pauses between syllables pull the floor down fast; steady noise lifts it slowly.
    if (level < this.floor) this.floor += (level - this.floor) * 0.3;
    else
      this.floor += Math.min(
        level - this.floor,
        this.open ? this.floorRiseOpen : this.floorRiseClosed,
      );
    this.floor = Math.max(-100, Math.min(-20, this.floor));
  }
}
