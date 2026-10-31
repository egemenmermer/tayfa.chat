import { execFile } from 'node:child_process';
import { nativeImage, type NativeImage } from 'electron';

/**
 * Recolors every pixel of a one-colour glyph, keeping its alpha. The tray glyph is a macOS
 * template image (black); Windows has no template images, so it would stay black there.
 * Red, green and blue are set alike, so the bitmap's channel order does not matter.
 */
export function tintBitmap(bitmap: Buffer, level: number): Buffer {
  const out = Buffer.from(bitmap);
  for (let i = 0; i + 3 < out.length; i += 4) out[i] = out[i + 1] = out[i + 2] = level;
  return out;
}

/** The tray image for this platform: a template on macOS, a white or dark glyph elsewhere. */
export function trayImage(base: NativeImage, platform: NodeJS.Platform, lightTaskbar: boolean) {
  if (platform === 'darwin') {
    const template = nativeImage.createFromBuffer(base.toPNG());
    template.setTemplateImage(true);
    return template;
  }
  const size = base.getSize();
  return nativeImage.createFromBitmap(tintBitmap(base.toBitmap(), lightTaskbar ? 0x1f : 0xff), {
    width: size.width,
    height: size.height,
  });
}

/**
 * Whether the Windows taskbar uses the light theme (`SystemUsesLightTheme`; the app theme is a
 * different setting). Unknown counts as dark, the Windows default taskbar.
 */
export function windowsLightTaskbar(): Promise<boolean> {
  return new Promise((resolve) => {
    execFile(
      'reg',
      [
        'query',
        'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Themes\\Personalize',
        '/v',
        'SystemUsesLightTheme',
      ],
      { windowsHide: true, timeout: 3000 },
      (error, stdout) => resolve(!error && /SystemUsesLightTheme\s+REG_DWORD\s+0x1\b/.test(stdout)),
    );
  });
}
