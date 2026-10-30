import { afterEach, expect, it, vi } from 'vitest';
import type { AudioProcessorOptions } from 'livekit-client';
const denoiser = vi.hoisted(() => ({ connect: vi.fn(), disconnect: vi.fn(), destroy: vi.fn() }));
vi.mock('../packages/media-providers/src/noise-suppression', () => ({
  createNoiseSuppressionNode: vi.fn(async () => denoiser),
}));
import { SoundboardMixer, MIC_LEVELER_MAKEUP } from '../packages/media-providers/src/soundboard';
afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});
function context(compressor: boolean) {
  const node = () => ({ connect: vi.fn(), disconnect: vi.fn() });
  const param = () => ({ value: 0 });
  const destination = {
    ...node(),
    stream: { getAudioTracks: () => [{ stop: vi.fn() }], getTracks: () => [] },
  };
  const level = { ...node(), gain: { value: 0, setTargetAtTime: vi.fn() } };
  const makeup = { ...node(), gain: { value: 0 } };
  const gains = [level, makeup];
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
    level,
    makeup,
    comp,
    context: {
      currentTime: 0,
      createMediaStreamSource: () => node(),
      createMediaStreamDestination: () => destination,
      createGain: () => gains.shift(),
      ...(compressor ? { createDynamicsCompressor: () => comp } : {}),
    },
  };
}
it('levels the denoised microphone: denoiser, compressor, make-up gain, then the room', async () => {
  vi.stubGlobal('MediaStream', class {});
  const c = context(true);
  const mixer = new SoundboardMixer(true, 'strong');
  await mixer.init({ track: {}, audioContext: c.context } as unknown as AudioProcessorOptions);
  expect(c.level.connect).toHaveBeenCalledWith(denoiser);
  expect(denoiser.connect).toHaveBeenCalledWith(c.comp);
  expect(c.comp.connect).toHaveBeenCalledWith(c.makeup);
  expect(c.makeup.connect).toHaveBeenCalledWith(c.destination);
  expect(c.makeup.gain.value).toBe(MIC_LEVELER_MAKEUP);
  expect(c.comp.ratio.value).toBeGreaterThan(1);
  await mixer.destroy();
  expect(c.comp.disconnect).toHaveBeenCalled();
});
it('sends the denoised microphone straight to the room when the engine has no compressor', async () => {
  vi.stubGlobal('MediaStream', class {});
  const c = context(false);
  const mixer = new SoundboardMixer(true, 'strong');
  await mixer.init({ track: {}, audioContext: c.context } as unknown as AudioProcessorOptions);
  expect(denoiser.connect).toHaveBeenCalledWith(c.destination);
  await mixer.destroy();
});
it('adds no leveler when noise removal is off, where the browser AGC already runs', async () => {
  vi.stubGlobal('MediaStream', class {});
  const c = context(true);
  const mixer = new SoundboardMixer(false);
  await mixer.init({ track: {}, audioContext: c.context } as unknown as AudioProcessorOptions);
  expect(c.level.connect).toHaveBeenCalledWith(c.destination);
  expect(c.comp.connect).not.toHaveBeenCalled();
  await mixer.destroy();
});
