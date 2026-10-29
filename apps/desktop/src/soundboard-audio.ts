import { t } from './i18n';
import { SOUNDBOARD_FADE_SECONDS } from './soundboard-trim';

/** Canonical bounded PCM WAV; avoids uploading opaque codecs to the access service. */
export function encodeSoundboard(
  buffer: AudioBuffer,
  /** Sample range to keep; defaults to the whole buffer. */
  range?: { from: number; to: number },
): string {
  const from = range ? range.from : 0,
    to = range ? range.to : buffer.length,
    frames = to - from;
  if (
    buffer.sampleRate !== 48000 ||
    !Number.isInteger(from) ||
    !Number.isInteger(to) ||
    from < 0 ||
    to > buffer.length ||
    frames <= 0 ||
    frames / 48000 > 8 ||
    buffer.numberOfChannels < 1 ||
    buffer.numberOfChannels > 2
  )
    throw Error(t('En fazla 8 saniyelik mono veya stereo ses seç.'));
  const channels = buffer.numberOfChannels,
    size = frames * channels * 2,
    bytes = new Uint8Array(44 + size),
    view = new DataView(bytes.buffer);
  const label = (at: number, value: string) => {
    for (let i = 0; i < value.length; i++) bytes[at + i] = value.charCodeAt(i);
  };
  label(0, 'RIFF');
  view.setUint32(4, 36 + size, true);
  label(8, 'WAVE');
  label(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, channels, true);
  view.setUint32(24, 48000, true);
  view.setUint32(28, 48000 * channels * 2, true);
  view.setUint16(32, channels * 2, true);
  view.setUint16(34, 16, true);
  label(36, 'data');
  view.setUint32(40, size, true);
  const data = Array.from({ length: channels }, (_, i) => buffer.getChannelData(i));
  // A cut edge ramps over a few milliseconds; the file's own start and end stay untouched.
  const ramp = Math.min(Math.round(SOUNDBOARD_FADE_SECONDS * 48000), Math.floor(frames / 2));
  for (let frame = 0; frame < frames; frame++) {
    let gain = 1;
    if (from > 0 && frame < ramp) gain = frame / ramp;
    if (to < buffer.length && frames - 1 - frame < ramp)
      gain = Math.min(gain, (frames - 1 - frame) / ramp);
    for (let channel = 0; channel < channels; channel++) {
      const value = Math.max(-1, Math.min(1, data[channel][from + frame] * gain));
      view.setInt16(
        44 + (frame * channels + channel) * 2,
        Math.round(value * (value < 0 ? 32768 : 32767)),
        true,
      );
    }
  }
  let binary = '';
  for (let i = 0; i < bytes.length; i += 8192)
    binary += String.fromCharCode(...bytes.subarray(i, i + 8192));
  return btoa(binary);
}
export function soundboardBytes(base64: string): ArrayBuffer {
  const value = atob(base64);
  if (value.length > 2_000_000) throw Error(t('Ses dosyası çok büyük.'));
  const bytes = new Uint8Array(value.length);
  for (let i = 0; i < value.length; i++) bytes[i] = value.charCodeAt(i);
  return bytes.buffer;
}
