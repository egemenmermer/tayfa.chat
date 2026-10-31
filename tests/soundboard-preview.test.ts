import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  previewSound,
  soundboardLevel,
  SOUNDBOARD_DEFAULT_LEVEL,
  stopSoundPreview,
} from '../apps/desktop/src/soundboard-preview';

describe('soundboard level', () => {
  it('starts at 20% and keeps a level someone set', () => {
    expect(SOUNDBOARD_DEFAULT_LEVEL).toBe(0.2);
    expect(soundboardLevel(null)).toBe(0.2);
    expect(soundboardLevel('0.5')).toBe(0.5);
    expect(soundboardLevel('0')).toBe(0);
    expect(soundboardLevel('7')).toBe(0.2);
    expect(soundboardLevel('x')).toBe(0.2);
  });
});

describe('Dene', () => {
  afterEach(() => {
    stopSoundPreview();
    vi.unstubAllGlobals();
  });
  it('plays only on this computer, at the soundboard level, on the chosen output', async () => {
    const made: { sink: string[]; gain: { value: number }; started: number; closed: number }[] = [];
    class Context {
      record = { sink: [] as string[], gain: { value: 1 }, started: 0, closed: 0 };
      destination = {};
      constructor() {
        made.push(this.record);
      }
      async setSinkId(id: string) {
        this.record.sink.push(id);
      }
      createGain() {
        return { gain: this.record.gain, connect: (next: unknown) => next };
      }
      createBufferSource() {
        const record = this.record;
        return {
          buffer: null,
          onended: null,
          connect: (next: unknown) => next,
          start: () => record.started++,
          stop: () => {},
        };
      }
      async close() {
        this.record.closed++;
      }
    }
    vi.stubGlobal('AudioContext', Context);
    const buffer = {} as AudioBuffer;
    await previewSound(buffer, 0.2, 'headset');
    expect(made[0]).toMatchObject({ sink: ['headset'], gain: { value: 0.2 }, started: 1 });
    // A second preview ends the first.
    await previewSound(buffer, 0.2);
    expect(made[0]!.closed).toBe(1);
    expect(made[1]).toMatchObject({ sink: [], started: 1 });
  });
});
