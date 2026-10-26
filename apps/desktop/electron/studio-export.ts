// Validation for Studio song exports the renderer hands to main for saving. The renderer renders the WAV itself
// (Web Audio, OfflineAudioContext); main only checks the bytes are a bounded WAV and asks the user where to save.

/** Ten minutes of 44.1 kHz stereo 16-bit PCM (the engine's export cap) plus header room. */
export const MAX_STUDIO_EXPORT_BYTES = 110 * 1024 * 1024;
const MAX_FILE_NAME = 120;

export class StudioExportInputError extends Error {}

const ascii = (bytes: Uint8Array, from: number) =>
  String.fromCharCode(...bytes.subarray(from, from + 4));

/** A file name safe on macOS and Windows that ends in `.wav`; falls back to `tayfa-studio.wav`. */
export function studioExportFileName(input: unknown): string {
  const raw = typeof input === 'string' ? input : '';
  const cleaned = raw
    // Path separators, characters Windows forbids and control characters.
    .replace(/[\\/:*?"<>|\u0000-\u001f\u007f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^[. ]+/, '')
    .replace(/\.wav$/i, '')
    .trim()
    .slice(0, MAX_FILE_NAME)
    .replace(/[. ]+$/, '');
  return `${cleaned || 'tayfa-studio'}.wav`;
}

/** Accepts only a nonempty RIFF/WAVE byte array within the size cap. */
export function validateStudioExport(data: unknown): Uint8Array {
  if (!(data instanceof Uint8Array) || data.byteLength < 44)
    throw new StudioExportInputError('The Studio export is not a WAV file.');
  if (data.byteLength > MAX_STUDIO_EXPORT_BYTES)
    throw new StudioExportInputError('The Studio export is too large.');
  if (ascii(data, 0) !== 'RIFF' || ascii(data, 8) !== 'WAVE')
    throw new StudioExportInputError('The Studio export is not a WAV file.');
  return data;
}
