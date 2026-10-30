/**
 * Screen share encodings (what a publisher sends) and the viewer's quality choice (which of those
 * layers a listener receives). Kept free of LiveKit types so the desktop UI and tests can use it.
 */
export type ScreenShareQuality = '720p30' | '1080p30' | '1080p60' | '1440p60' | '4k30';
export type ScreenShareContent = 'motion' | 'detail';
/**
 * The top layer of each publish profile. 1080p30 and 1080p60 sit 1–2 Mbps below their rc.34 caps
 * so that, with the smaller layers below them, no profile asks for more uplink than rc.34 did.
 */
export const screenProfiles = {
  '720p30': { width: 1280, height: 720, frameRate: 30, bitrate: 3_000_000 },
  '1080p30': { width: 1920, height: 1080, frameRate: 30, bitrate: 5_000_000 },
  '1080p60': { width: 1920, height: 1080, frameRate: 60, bitrate: 8_000_000 },
  '1440p60': { width: 2560, height: 1440, frameRate: 60, bitrate: 16_000_000 },
  '4k30': { width: 3840, height: 2160, frameRate: 30, bitrate: 24_000_000 },
} as const;
export interface ScreenLayerPlan {
  width: number;
  height: number;
  frameRate: number;
  bitrate: number;
}
/**
 * Simulcast layers published under the profile itself, smallest first. The 360p layer is the floor
 * a weak uplink or a weak viewer falls back to, so it stays cheap; 720p keeps the profile's frame
 * rate so a game shared at 60 fps still moves at 60 fps for a viewer on that layer.
 */
export function screenSimulcastLayers(quality: ScreenShareQuality): ScreenLayerPlan[] {
  const top = screenProfiles[quality];
  const layers: ScreenLayerPlan[] = [
    { width: 640, height: 360, frameRate: Math.min(top.frameRate, 30), bitrate: 600_000 },
  ];
  if (top.height > 720)
    layers.push({
      width: 1280,
      height: 720,
      frameRate: top.frameRate,
      bitrate: top.frameRate > 30 ? 3_500_000 : 2_000_000,
    });
  return layers;
}
/**
 * Everything publishScreen needs for one share. Motion (games, video) keeps its frame rate and
 * gives up resolution under pressure; detail (text, code) keeps resolution and gives up frames.
 * LiveKit's own screen share default is maintain-resolution, which stutters on motion.
 */
export function screenPublishPlan(quality: ScreenShareQuality, content?: ScreenShareContent) {
  const profile = screenProfiles[quality];
  const detail = content === 'detail';
  return {
    capture: { width: profile.width, height: profile.height, frameRate: profile.frameRate },
    encoding: { maxBitrate: profile.bitrate, maxFramerate: profile.frameRate },
    layers: screenSimulcastLayers(quality),
    contentHint: detail ? ('detail' as const) : ('motion' as const),
    degradationPreference: detail
      ? ('maintain-resolution' as const)
      : ('maintain-framerate' as const),
  };
}

/** One layer a remote screen share offers, as its publication describes it. */
export interface ScreenLayer {
  quality: 'low' | 'medium' | 'high';
  width: number;
  height: number;
}
/** 'auto' lets the stream adapt to the tile and the network; a number caps it at that many lines. */
export type ScreenViewQuality = 'auto' | number;
const rank = { low: 0, medium: 1, high: 2 } as const;
/** Lines of a layer as people name them (1080p), also for a portrait window. */
export const screenLayerLines = (layer: ScreenLayer) => Math.min(layer.width, layer.height);
const ordered = (layers: readonly ScreenLayer[]) =>
  layers
    .filter((layer) => screenLayerLines(layer) > 0)
    .sort((a, b) => screenLayerLines(a) - screenLayerLines(b) || rank[a.quality] - rank[b.quality]);
/** Distinct line counts a viewer can pick, highest first. One entry: a single-quality stream. */
export function screenQualityChoices(layers: readonly ScreenLayer[]): number[] {
  return [...new Set(ordered(layers).map(screenLayerLines))].reverse();
}
/**
 * The layer to subscribe to for a choice: the largest one not above the cap, or the smallest one
 * when every layer is above it. 'auto' asks for the stream's own top layer, which leaves LiveKit's
 * adaptive stream (tile size) and the server's bandwidth estimate in charge. A publisher whose
 * layers are q/h only (rc.34) has no 'high' layer, so the answer is always a layer it really sends.
 */
export function screenSubscriptionQuality(
  layers: readonly ScreenLayer[],
  choice: ScreenViewQuality,
): ScreenLayer['quality'] | undefined {
  const sorted = ordered(layers);
  if (!sorted.length) return undefined;
  if (choice === 'auto') return sorted[sorted.length - 1]!.quality;
  const fit = sorted.filter((layer) => screenLayerLines(layer) <= choice);
  return (fit[fit.length - 1] ?? sorted[0]!).quality;
}
/** The option a picker shows as selected: 'auto', or the line count the cap lands on. */
export function screenQualitySelection(
  layers: readonly ScreenLayer[],
  choice: ScreenViewQuality,
): 'auto' | number {
  if (choice === 'auto') return 'auto';
  const choices = screenQualityChoices(layers);
  return choices.find((lines) => lines <= choice) ?? choices[choices.length - 1] ?? 'auto';
}
