import { describe, expect, it } from 'vitest';
import {
  screenProfiles,
  screenPublishPlan,
  screenQualityChoices,
  screenQualitySelection,
  screenSimulcastLayers,
  screenSubscriptionQuality,
  type ScreenLayer,
  type ScreenShareQuality,
} from '../packages/media-providers/src/screen-quality';

// rc.34 published the profile plus LiveKit's default half-size layer at the same frame rate:
// bitrate / (2² × fps/fps), never below 150 kbps.
const rc34Uplink: Record<ScreenShareQuality, number> = {
  '720p30': 3_000_000 + 750_000,
  '1080p30': 6_000_000 + 1_500_000,
  '1080p60': 10_000_000 + 2_500_000,
  '1440p60': 16_000_000 + 4_000_000,
  '4k30': 24_000_000 + 6_000_000,
};
const uplink = (quality: ScreenShareQuality) =>
  screenProfiles[quality].bitrate +
  screenSimulcastLayers(quality).reduce((sum, layer) => sum + layer.bitrate, 0);

describe('screen share encodings', () => {
  it('publishes 360p, 720p and the 1080p60 profile by default, 60 fps kept on 720p', () => {
    const plan = screenPublishPlan('1080p60');
    expect(plan.capture).toEqual({ width: 1920, height: 1080, frameRate: 60 });
    expect(plan.encoding).toEqual({ maxBitrate: 8_000_000, maxFramerate: 60 });
    expect(plan.layers).toEqual([
      { width: 640, height: 360, frameRate: 30, bitrate: 600_000 },
      { width: 1280, height: 720, frameRate: 60, bitrate: 3_500_000 },
    ]);
  });
  it('adds only layers smaller than the profile, with a cheap floor for weak links', () => {
    expect(screenSimulcastLayers('720p30')).toEqual([
      { width: 640, height: 360, frameRate: 30, bitrate: 600_000 },
    ]);
    expect(screenSimulcastLayers('4k30')[1]).toEqual({
      width: 1280,
      height: 720,
      frameRate: 30,
      bitrate: 2_000_000,
    });
    for (const quality of Object.keys(screenProfiles) as ScreenShareQuality[]) {
      const top = screenProfiles[quality];
      const layers = screenSimulcastLayers(quality);
      expect(layers.length).toBeLessThanOrEqual(2);
      for (const layer of layers) {
        expect(layer.height).toBeLessThan(top.height);
        expect(layer.frameRate).toBeLessThanOrEqual(top.frameRate);
        expect(layer.bitrate).toBeLessThan(top.bitrate);
      }
      expect(layers[0]!.bitrate).toBeLessThanOrEqual(600_000);
    }
  });
  it('stays within 0.1 Mbps of the uplink rc.34 asked for at every profile', () => {
    for (const quality of Object.keys(screenProfiles) as ScreenShareQuality[])
      expect(uplink(quality), quality).toBeLessThanOrEqual(rc34Uplink[quality] + 100_000);
    expect(uplink('1080p60')).toBe(12_100_000);
  });
  it('keeps frames for motion and sharpness for detail', () => {
    expect(screenPublishPlan('1080p60')).toMatchObject({
      contentHint: 'motion',
      degradationPreference: 'maintain-framerate',
    });
    expect(screenPublishPlan('1080p30', 'detail')).toMatchObject({
      contentHint: 'detail',
      degradationPreference: 'maintain-resolution',
    });
  });
});

const layer = (quality: ScreenLayer['quality'], width: number, height: number) => ({
  quality,
  width,
  height,
});
// What a viewer sees in trackInfo.layers.
const current = [layer('low', 640, 360), layer('medium', 1280, 720), layer('high', 1920, 1080)];
const rc34 = [layer('low', 960, 540), layer('medium', 1920, 1080)];
const single = [layer('high', 1920, 1080)];

describe('viewer quality choice', () => {
  it('offers every layer of a three-layer share and maps each to its own layer', () => {
    expect(screenQualityChoices(current)).toEqual([1080, 720, 360]);
    expect(screenSubscriptionQuality(current, 'auto')).toBe('high');
    expect(screenSubscriptionQuality(current, 1080)).toBe('high');
    expect(screenSubscriptionQuality(current, 720)).toBe('medium');
    expect(screenSubscriptionQuality(current, 360)).toBe('low');
    // A cap between layers lands on the layer under it; below every layer, on the smallest.
    expect(screenSubscriptionQuality(current, 480)).toBe('low');
    expect(screenSubscriptionQuality(current, 144)).toBe('low');
  });
  it('maps an rc.34 q/h share to layers it really sends, never to a missing high layer', () => {
    expect(screenQualityChoices(rc34)).toEqual([1080, 540]);
    expect(screenSubscriptionQuality(rc34, 'auto')).toBe('medium');
    expect(screenSubscriptionQuality(rc34, 1080)).toBe('medium');
    expect(screenSubscriptionQuality(rc34, 720)).toBe('low');
    expect(screenQualitySelection(rc34, 720)).toBe(540);
  });
  it('has one choice for a single-layer publisher and leaves nothing to switch', () => {
    expect(screenQualityChoices(single)).toEqual([1080]);
    expect(screenSubscriptionQuality(single, 'auto')).toBe('high');
    expect(screenSubscriptionQuality(single, 360)).toBe('high');
    expect(screenQualitySelection(single, 360)).toBe(1080);
  });
  it('dedupes layers a small window collapsed to one size and reads portrait windows by width', () => {
    const window = [layer('low', 900, 500), layer('medium', 900, 500)];
    expect(screenQualityChoices(window)).toEqual([500]);
    expect(screenSubscriptionQuality(window, 'auto')).toBe('medium');
    expect(screenQualityChoices([layer('low', 360, 640), layer('high', 1080, 1920)])).toEqual([
      1080, 360,
    ]);
  });
  it('requests nothing before the publication announced its layers', () => {
    expect(screenQualityChoices([])).toEqual([]);
    expect(screenSubscriptionQuality([], 720)).toBeUndefined();
    expect(screenQualitySelection([], 720)).toBe('auto');
  });
});
