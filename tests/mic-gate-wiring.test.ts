import { afterEach, expect, it, vi } from 'vitest';
import type { AudioProcessorOptions } from 'livekit-client';
import type { MicGateReport } from '../packages/media-providers/src/mic-gate';
const h = vi.hoisted(() => ({
  denoiser: { connect: vi.fn(), disconnect: vi.fn(), destroy: vi.fn() },
  gate: {
    connect: vi.fn(),
    disconnect: vi.fn(),
    configure: vi.fn(),
    destroy: vi.fn(),
  },
  callbacks: {} as {
    onState?(report: MicGateReport): void;
    onLevel?(report: MicGateReport): void;
    onFailure?(): void;
  },
  available: true,
}));
vi.mock('../packages/media-providers/src/noise-suppression', () => ({
  createNoiseSuppressionNode: vi.fn(async () => h.denoiser),
}));
vi.mock('../packages/media-providers/src/mic-gate-node', () => ({
  createMicGateNode: vi.fn(async (_context: unknown, _settings: unknown, callbacks: object) => {
    h.callbacks = callbacks;
    return h.available ? h.gate : null;
  }),
}));
import { createMicGateNode } from '../packages/media-providers/src/mic-gate-node';
import { SoundboardMixer } from '../packages/media-providers/src/soundboard';
afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
  h.available = true;
});
function context() {
  const node = () => ({ connect: vi.fn(), disconnect: vi.fn() });
  const param = () => ({ value: 0 });
  const destination = {
    ...node(),
    stream: { getAudioTracks: () => [{ stop: vi.fn() }], getTracks: () => [] },
  };
  const gains: ReturnType<typeof node>[] = [];
  const comp = {
    ...node(),
    threshold: param(),
    knee: param(),
    ratio: param(),
    attack: param(),
    release: param(),
  };
  return {
    destination,
    gains,
    comp,
    context: {
      currentTime: 0,
      destination: node(),
      resume: vi.fn(async () => {}),
      createMediaStreamSource: () => node(),
      createMediaStreamDestination: () => destination,
      createGain: () => {
        const gain = { ...node(), gain: { value: 0, setTargetAtTime: vi.fn() } };
        gains.push(gain);
        return gain;
      },
      createDynamicsCompressor: () => comp,
      createBufferSource: () => ({ ...node(), start: vi.fn(), stop: vi.fn(), buffer: null }),
    },
  };
}
const options = (c: ReturnType<typeof context>) =>
  ({ track: {}, audioContext: c.context }) as unknown as AudioProcessorOptions;

it('gates after the filter and leveler; soundboard clips skip the gate', async () => {
  vi.stubGlobal('MediaStream', class {});
  const c = context();
  const gate = vi.fn();
  const mixer = new SoundboardMixer(
    true,
    'strong',
    { gate },
    { gate: { auto: false, threshold: -30 }, leveler: true },
  );
  await mixer.init(options(c));
  expect(vi.mocked(createMicGateNode).mock.calls[0][1]).toEqual({ auto: false, threshold: -30 });
  const [level, makeup] = c.gains;
  expect(level.connect).toHaveBeenCalledWith(h.denoiser);
  expect(h.denoiser.connect).toHaveBeenCalledWith(c.comp);
  expect(makeup.connect).toHaveBeenCalledWith(h.gate);
  expect(h.gate.connect).toHaveBeenCalledWith(c.destination);
  expect(gate).toHaveBeenLastCalledWith(expect.objectContaining({ open: false }));
  await mixer.play({ duration: 1 } as AudioBuffer, 1, () => true);
  const clipGain = c.gains.at(-1)!;
  expect(clipGain.connect).toHaveBeenCalledWith(c.destination);
  expect(clipGain.connect).not.toHaveBeenCalledWith(h.gate);
  expect(mixer.playing).toBe(true);
  mixer.setGate({ auto: true, threshold: -20 });
  expect(h.gate.configure).toHaveBeenCalledWith({ auto: true, threshold: -20 });
  await mixer.destroy();
  expect(h.gate.destroy).toHaveBeenCalled();
});

it('the leveler toggle rewires the chain without the compressor', async () => {
  vi.stubGlobal('MediaStream', class {});
  const c = context();
  const mixer = new SoundboardMixer(true, 'strong', {}, { leveler: true });
  await mixer.init(options(c));
  h.denoiser.connect.mockClear();
  mixer.setLeveler(false);
  expect(h.denoiser.connect).toHaveBeenLastCalledWith(h.gate);
  expect(c.comp.disconnect).toHaveBeenCalled();
  mixer.setLeveler(true);
  expect(h.denoiser.connect).toHaveBeenLastCalledWith(c.comp);
  await mixer.destroy();
});

it('reports gate changes and live levels, and bypasses a gate that stops', async () => {
  vi.stubGlobal('MediaStream', class {});
  const c = context();
  const gate = vi.fn(),
    level = vi.fn();
  const mixer = new SoundboardMixer(false, 'strong', { gate, level });
  await mixer.init(options(c));
  expect(c.gains[0].connect).toHaveBeenCalledWith(h.gate);
  h.callbacks.onState?.({ open: true, level: -20, threshold: -38 });
  expect(gate).toHaveBeenLastCalledWith({ open: true, level: -20, threshold: -38 });
  h.callbacks.onLevel?.({ open: true, level: -21, threshold: -38 });
  expect(level).toHaveBeenCalledWith({ open: true, level: -21, threshold: -38 });
  // A failed processor would silence the microphone: it is taken out and the voice goes straight on.
  h.callbacks.onFailure?.();
  expect(gate).toHaveBeenLastCalledWith(null);
  expect(c.gains[0].connect).toHaveBeenLastCalledWith(c.destination);
  expect(h.gate.destroy).toHaveBeenCalled();
  await mixer.destroy();
});

it('sends ungated when the engine has no AudioWorklet', async () => {
  vi.stubGlobal('MediaStream', class {});
  h.available = false;
  const c = context();
  const gate = vi.fn();
  const mixer = new SoundboardMixer(false, 'strong', { gate });
  await mixer.init(options(c));
  expect(c.gains[0].connect).toHaveBeenCalledWith(c.destination);
  expect(gate).toHaveBeenCalledWith(null);
  await mixer.destroy();
});
