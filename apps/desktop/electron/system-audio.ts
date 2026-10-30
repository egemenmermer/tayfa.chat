/**
 * What "Sesi de paylaş" can do on this OS. Electron captures system audio as a loopback device:
 * WASAPI on Windows, CoreAudio taps on macOS 14.2+. The renderer asks for `restrictOwnAudio`;
 * Chromium honours it (Electron then opens `loopbackWithoutChrome`, which leaves Tayfa's own
 * playback out of the share) only on Windows 11 and macOS 14.2+. On Windows 10 the loopback
 * also carries the voices Tayfa plays, so viewers can hear the room back through the stream.
 */
export interface SystemAudioSupport {
  /** System audio can be captured together with a screen share. */
  supported: boolean;
  /** Tayfa's own playback (voices, sounds) stays out of the shared audio. */
  ownAudioExcluded: boolean;
  /** Why it is unavailable, for the picker text; absent when supported. */
  reason?: 'macos-version' | 'os';
}
const part = (value: string, index: number) => Number(value.split('.')[index]) || 0;
/**
 * @param platform `process.platform`
 * @param osRelease `os.release()`: "10.0.<build>" on Windows, the Darwin version on macOS.
 */
export function systemAudioSupport(platform: string, osRelease: string): SystemAudioSupport {
  if (platform === 'win32')
    // Windows 11 starts at build 22000; process loopback (own-audio exclusion) needs it.
    return { supported: true, ownAudioExcluded: part(osRelease, 2) >= 22000 };
  if (platform === 'darwin') {
    // Darwin 23.2 is macOS 14.2, the first release with CoreAudio process taps.
    const major = part(osRelease, 0),
      minor = part(osRelease, 1);
    const supported = major > 23 || (major === 23 && minor >= 2);
    return supported
      ? { supported, ownAudioExcluded: true }
      : { supported, ownAudioExcluded: false, reason: 'macos-version' };
  }
  return { supported: false, ownAudioExcluded: false, reason: 'os' };
}
/** The answer to a display-media request: the chosen source, plus system audio when wanted. */
export function displayMediaStreams<Source>(
  source: Source,
  audio: boolean,
  support: SystemAudioSupport,
): { video: Source; audio?: 'loopback' } {
  // Never `loopbackWithMute`: the sharer keeps hearing the game and the room.
  return audio && support.supported ? { video: source, audio: 'loopback' } : { video: source };
}
