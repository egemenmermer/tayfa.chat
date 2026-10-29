import { describe, expect, it } from 'vitest';
import {
  MIC_GATE_MIN_DB,
  MIC_GATE_TIMING,
  MicGateCore,
  clampMicGateThreshold,
  micGateSettings,
} from '../packages/media-providers/src/mic-gate';

const RATE = 48_000;
const QUANTUM = 128;
const amplitude = (db: number) => Math.SQRT2 * 10 ** (db / 20); // sine peak for an RMS in dBFS
const ms = (value: number) => Math.round((RATE * value) / 1000);

/** Runs the gate in 128-sample render quanta, like the audio thread, and records each sample. */
function run(gate: MicGateCore, signal: Float32Array) {
  const out = new Float32Array(signal.length);
  const open: boolean[] = [];
  for (let start = 0; start < signal.length; start += QUANTUM) {
    const end = Math.min(signal.length, start + QUANTUM);
    const block = signal.slice(start, end),
      result = new Float32Array(block.length);
    gate.process(block, result);
    out.set(result, start);
    for (let i = start; i < end; i++) open.push(gate.open);
  }
  return { out, open };
}
function tone(length: number, db: number, phase = 0) {
  const a = amplitude(db);
  return Float32Array.from(
    { length },
    (_, i) => a * Math.sin(phase + (2 * Math.PI * 220 * i) / RATE),
  );
}
function concat(...parts: Float32Array[]) {
  const total = parts.reduce((sum, part) => sum + part.length, 0);
  const result = new Float32Array(total);
  let offset = 0;
  for (const part of parts) {
    result.set(part, offset);
    offset += part.length;
  }
  return result;
}
const silence = (length: number) => new Float32Array(length);
const firstOpen = (open: boolean[]) => open.indexOf(true);
const lastOpen = (open: boolean[]) => open.lastIndexOf(true);

describe('microphone input gate', () => {
  it('opens on sustained speech within ~20 ms and keeps the onset thanks to the lookahead', () => {
    const gate = new MicGateCore(RATE, { auto: false, threshold: -34 });
    const { out, open } = run(gate, concat(silence(ms(100)), tone(ms(300), -20)));
    const opened = firstOpen(open) - ms(100);
    expect(opened).toBeGreaterThanOrEqual(ms(20) - 1);
    expect(opened).toBeLessThanOrEqual(ms(25));
    // The delayed onset reaches the output only after the gate opened, so it is not cut off.
    const lookahead = ms(MIC_GATE_TIMING.lookahead * 1000);
    const onsetOut = ms(100) + lookahead;
    expect(out.slice(0, ms(100) + ms(20)).every((value) => value === 0)).toBe(true);
    const rms = (from: number, to: number) =>
      Math.sqrt(out.slice(from, to).reduce((sum, v) => sum + v * v, 0) / (to - from));
    expect(rms(onsetOut + ms(10), onsetOut + ms(50))).toBeGreaterThan(amplitude(-20) * 0.6);
  });

  it('holds ~250 ms after speech stops, then releases smoothly to exact silence', () => {
    const gate = new MicGateCore(RATE, { auto: false, threshold: -34 });
    const speechEnd = ms(400);
    // A quiet tail (below the threshold) shows the release ramp instead of plain silence.
    const { out, open } = run(gate, concat(tone(speechEnd, -20), tone(ms(800), -50)));
    const closed = lastOpen(open) + 1;
    expect(closed - speechEnd).toBeGreaterThanOrEqual(ms(245));
    expect(closed - speechEnd).toBeLessThanOrEqual(ms(260));
    const peak = (from: number, to: number) =>
      out.slice(from, to).reduce((max, v) => Math.max(max, Math.abs(v)), 0);
    // During the hold the quiet tail is still sent; the release then fades it over ~120 ms.
    expect(peak(closed - ms(20), closed)).toBeGreaterThan(amplitude(-50) * 0.9);
    expect(peak(closed + ms(60), closed + ms(80))).toBeLessThan(amplitude(-50) * 0.6);
    expect(peak(closed + ms(60), closed + ms(80))).toBeGreaterThan(0);
    expect(out.slice(closed + ms(125)).every((value) => value === 0)).toBe(true);
  });

  it('a new word during the hold keeps the gate open without a gap', () => {
    const gate = new MicGateCore(RATE, { auto: false, threshold: -34 });
    const { open } = run(
      gate,
      concat(tone(ms(200), -20), silence(ms(150)), tone(ms(200), -20), silence(ms(600))),
    );
    const from = firstOpen(open),
      to = lastOpen(open);
    expect(open.slice(from, to).every(Boolean)).toBe(true);
    expect(to + 1 - ms(550)).toBeGreaterThanOrEqual(ms(245));
  });

  it('keyboard-like clicks stay closed: quiet ones and loud short ones, at any frame phase', () => {
    for (const offset of [0, 37, 120, 181, 239]) {
      const gate = new MicGateCore(RATE, { auto: false, threshold: -34 });
      const parts: Float32Array[] = [silence(offset)];
      for (let key = 0; key < 20; key++)
        parts.push(tone(ms(5), key % 2 ? -12 : -40, key), silence(ms(115)));
      const { out, open } = run(gate, concat(...parts));
      expect(open.some(Boolean)).toBe(false);
      expect(out.every((value) => value === 0)).toBe(true);
    }
  });

  it('breathing below the threshold is never sent', () => {
    const gate = new MicGateCore(RATE, { auto: false, threshold: -30 });
    let seed = 7;
    const noise = Float32Array.from({ length: ms(2000) }, () => {
      seed = (seed * 1103515245 + 12345) % 2 ** 31;
      return (seed / 2 ** 31 - 0.5) * 2 * amplitude(-36);
    });
    const { out } = run(gate, noise);
    expect(gate.open).toBe(false);
    expect(out.every((value) => value === 0)).toBe(true);
  });

  it('never goes below the speaking-meter threshold, also in manual mode', () => {
    expect(MIC_GATE_MIN_DB).toBeGreaterThanOrEqual(20 * Math.log10(0.012));
    expect(clampMicGateThreshold(-80)).toBe(MIC_GATE_MIN_DB);
    expect(clampMicGateThreshold(5)).toBe(-10);
    expect(micGateSettings({ auto: 'yes' as never, threshold: Number.NaN })).toEqual({
      auto: true,
      threshold: -34,
    });
    const gate = new MicGateCore(RATE, { auto: false, threshold: -38 });
    run(gate, tone(ms(500), -41));
    expect(gate.open).toBe(false);
  });

  it('automatic mode follows the noise floor and does not climb during speech with pauses', () => {
    const gate = new MicGateCore(RATE, { auto: true, threshold: -20 });
    run(gate, silence(ms(500)));
    expect(gate.threshold()).toBe(MIC_GATE_MIN_DB);
    const speech: Float32Array[] = [];
    for (let syllable = 0; syllable < 20; syllable++)
      speech.push(tone(ms(220), -22), tone(ms(40), -55));
    const { open } = run(gate, concat(...speech));
    expect(open.slice(ms(30)).every(Boolean)).toBe(true);
    expect(gate.threshold()).toBeLessThanOrEqual(MIC_GATE_MIN_DB + 3);
    // A steady loud hum (no denoiser) lifts the floor until the gate closes on it.
    const hum = new MicGateCore(RATE, { auto: true, threshold: -20 });
    run(hum, tone(ms(4000), -45));
    expect(hum.open).toBe(false);
    run(hum, tone(ms(8000), -30));
    expect(hum.threshold()).toBeGreaterThan(-30);
    expect(hum.open).toBe(false);
  });

  it('applies new settings to a running gate', () => {
    const gate = new MicGateCore(RATE, { auto: false, threshold: -34 });
    run(gate, tone(ms(200), -28));
    expect(gate.open).toBe(true);
    gate.configure({ threshold: -12 });
    run(gate, tone(ms(600), -28));
    expect(gate.open).toBe(false);
    expect(gate.report()).toMatchObject({ open: false, threshold: -12 });
    expect(gate.report().level).toBeCloseTo(-28, 0);
  });
});
