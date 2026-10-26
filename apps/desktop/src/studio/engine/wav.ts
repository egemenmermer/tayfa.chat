// 16-bit PCM WAV encoder for Studio exports. Pure: no Web Audio, runs under vitest.

const HEADER_BYTES = 44;

/** Interleaves planar float channels (−1…1, clipped) into a canonical RIFF/WAVE 16-bit PCM file. */
export function encodeWav(channels: readonly Float32Array[], sampleRate: number): Uint8Array {
  if (channels.length < 1 || channels.length > 8)
    throw new RangeError('A WAV export needs 1–8 channels.');
  if (!Number.isInteger(sampleRate) || sampleRate < 3000 || sampleRate > 384000)
    throw new RangeError(`Unsupported sample rate: ${sampleRate}`);
  const frames = channels[0].length;
  if (channels.some((channel) => channel.length !== frames))
    throw new RangeError('Channels differ in length.');
  const blockAlign = channels.length * 2;
  const dataBytes = frames * blockAlign;
  if (HEADER_BYTES + dataBytes > 0xffffffff)
    throw new RangeError('Render is too long for a WAV file.');
  const bytes = new Uint8Array(HEADER_BYTES + dataBytes);
  const view = new DataView(bytes.buffer);
  const ascii = (offset: number, text: string) => {
    for (let i = 0; i < text.length; i += 1) bytes[offset + i] = text.charCodeAt(i);
  };
  ascii(0, 'RIFF');
  view.setUint32(4, 36 + dataBytes, true);
  ascii(8, 'WAVE');
  ascii(12, 'fmt ');
  view.setUint32(16, 16, true); // PCM fmt chunk size
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, channels.length, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * blockAlign, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, 16, true);
  ascii(36, 'data');
  view.setUint32(40, dataBytes, true);
  let offset = HEADER_BYTES;
  for (let frame = 0; frame < frames; frame += 1) {
    for (const channel of channels) {
      const sample = Math.max(-1, Math.min(1, Number.isNaN(channel[frame]) ? 0 : channel[frame]));
      view.setInt16(
        offset,
        sample < 0 ? Math.round(sample * 0x8000) : Math.round(sample * 0x7fff),
        true,
      );
      offset += 2;
    }
  }
  return bytes;
}

/** Root-mean-square level of planar channels; 0 for silence. Used by checks, not by playback. */
export function rms(channels: readonly Float32Array[]): number {
  let sum = 0;
  let count = 0;
  for (const channel of channels) {
    for (let i = 0; i < channel.length; i += 1) sum += channel[i] * channel[i];
    count += channel.length;
  }
  return count ? Math.sqrt(sum / count) : 0;
}
