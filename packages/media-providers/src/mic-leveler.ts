/** Linear make-up gain after the leveler's compressor (about +6 dB). */
export const MIC_LEVELER_MAKEUP = 2;
/**
 * Strong noise removal turns the browser's AGC off (it would amplify noise before the filter),
 * so mic loudness differs a lot per person. A gentle compressor plus make-up gain after the
 * filter narrows that gap without touching what is below the noise floor. Contexts without a
 * compressor (older engines, test doubles) get null: the plain path.
 */
export function createMicLeveler(
  context: BaseAudioContext,
): { input: AudioNode; output: AudioNode } | null {
  if (!context.createDynamicsCompressor) return null;
  const compressor = context.createDynamicsCompressor(),
    makeup = context.createGain();
  compressor.threshold.value = -24;
  compressor.knee.value = 20;
  compressor.ratio.value = 3;
  compressor.attack.value = 0.01;
  compressor.release.value = 0.25;
  makeup.gain.value = MIC_LEVELER_MAKEUP;
  compressor.connect(makeup);
  return { input: compressor, output: makeup };
}
