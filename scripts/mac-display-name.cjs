const { readdirSync, writeFileSync } = require('node:fs');
const { join } = require('node:path');

const MAC_DISPLAY_NAME = 'Tayfa';

/**
 * Finder, Spotlight and the Dock ignore Info.plist's CFBundleDisplayName unless it matches the
 * bundle's file name (ROOMS.app). With LSHasLocalizedDisplayName they read the localized one, so
 * every shipped language folder names the app Tayfa while the bundle and helpers stay ROOMS.
 * CFBundleName is never localized: Electron finds "<CFBundleName> Helper.app" (see RC27).
 */
function writeLocalizedDisplayName(resources, name = MAC_DISPLAY_NAME) {
  const strings = `CFBundleDisplayName = "${name}";\n`;
  const folders = readdirSync(resources, { withFileTypes: true }).filter(
    (item) => item.isDirectory() && item.name.endsWith('.lproj'),
  );
  if (!folders.some((item) => item.name === 'en.lproj'))
    throw new Error('The packaged app has no en.lproj folder for its display name.');
  for (const item of folders)
    writeFileSync(join(resources, item.name, 'InfoPlist.strings'), strings);
  return folders.length;
}

module.exports = { MAC_DISPLAY_NAME, writeLocalizedDisplayName };
