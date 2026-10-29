import { MicGateCore, type MicGateSettings } from './mic-gate';
declare const sampleRate: number;
declare class AudioWorkletProcessor {
  readonly port: MessagePort;
}
declare function registerProcessor(name: string, processor: unknown): void;

/** Runs the input gate on the audio thread, so a hidden or throttled window never delays it. */
class RoomsMicGateProcessor extends AudioWorkletProcessor {
  private gate: MicGateCore;
  private destroyed = false;
  private sinceReport = 0;
  /** Loudest frame since the last level report, so the meter does not flicker between syllables. */
  private peak = -120;
  private readonly reportEvery = Math.round(sampleRate * 0.05);
  constructor(options: { processorOptions?: Partial<MicGateSettings> }) {
    super();
    this.gate = new MicGateCore(sampleRate, options.processorOptions);
    this.port.onmessage = (event) => {
      if (event.data?.type === 'settings') this.gate.configure(event.data.settings ?? {});
      else if (event.data?.type === 'destroy') this.destroyed = true;
    };
  }
  process(inputs: Float32Array[][], outputs: Float32Array[][]) {
    if (this.destroyed) return false;
    const input = inputs[0]?.[0],
      output = outputs[0]?.[0];
    // No input connected yet: send silence (an absent source has nothing to gate).
    if (!input) {
      output?.fill(0);
      return true;
    }
    const target = output ?? new Float32Array(input.length);
    if (this.gate.process(input, target))
      this.port.postMessage({ type: 'state', ...this.gate.report() });
    this.peak = Math.max(this.peak, this.gate.level);
    this.sinceReport += input.length;
    if (this.sinceReport >= this.reportEvery) {
      this.port.postMessage({ type: 'level', ...this.gate.report(), level: this.peak });
      this.sinceReport = 0;
      this.peak = -120;
    }
    return true;
  }
}
registerProcessor('rooms-mic-gate', RoomsMicGateProcessor);
