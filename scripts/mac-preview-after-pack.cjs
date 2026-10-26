const { copyVLCFiles } = require('./copy-vlc-runtime.cjs');
const { join } = require('node:path');
const { spawnSync } = require('node:child_process');
const { mkdirSync, copyFileSync, existsSync, readFileSync } = require('node:fs');
const { distributionScope, verifyPublicResources } = require('./package-privacy.cjs');
const { writeLocalizedDisplayName } = require('./mac-display-name.cjs');

module.exports = async (context) => {
  const scope = distributionScope();
  const resources =
    context.electronPlatformName === 'darwin'
      ? join(
          context.appOutDir,
          `${context.packager.appInfo.productFilename}.app/Contents/Resources`,
        )
      : join(context.appOutDir, 'resources');
  if (context.packager?.config?.extraMetadata?.roomsRemoteInput === true) {
    const metadata = JSON.parse(readFileSync('dist-native/remote-input-version.json', 'utf8'));
    const arch = { 0: 'ia32', 1: 'x64', 2: 'armv7l', 3: 'arm64', 4: 'universal' }[context.arch];
    const digest = require('node:crypto')
      .createHash('sha256')
      .update(readFileSync('apps/desktop/native/remote-input.cc'))
      .digest('hex');
    if (
      metadata.platform !== context.electronPlatformName ||
      metadata.arch !== arch ||
      metadata.sourceSha256 !== digest
    )
      throw Error(
        'Prepare the remote input module for this source/platform/architecture before packaging.',
      );
    const native = join(resources, 'native');
    mkdirSync(native, { recursive: true });
    copyFileSync('dist-native/rooms-remote-input.node', join(native, 'rooms-remote-input.node'));
    copyFileSync(
      'apps/desktop/native/remote-input.cc',
      join(native, 'rooms-remote-input-source.cc'),
    );
  }
  if (process.env.ROOMS_VLC === '1') {
    const metadata = JSON.parse(readFileSync('dist-native/vlc-version.json', 'utf8'));
    if (metadata.platform !== process.platform || metadata.arch !== process.arch)
      throw new Error('The VLC build does not match the package platform.');
    const native = join(resources, 'native');
    mkdirSync(native, { recursive: true });
    copyVLCFiles('dist-native/vlc', join(native, 'vlc'));
    copyFileSync('dist-native/rooms-vlc.node', join(native, 'rooms-vlc.node'));
    copyFileSync('dist-native/vlc-version.json', join(native, 'vlc-version.json'));
    copyFileSync('apps/desktop/native/vlc-player.mm', join(native, 'rooms-vlc-source.mm'));
    copyFileSync('scripts/prepare-vlc.mjs', join(native, 'rooms-vlc-build.mjs'));
    copyFileSync('scripts/copy-vlc-runtime.cjs', join(native, 'copy-vlc-runtime.cjs'));
    copyFileSync('scripts/build-vlc-source-mac.mjs', join(native, 'build-vlc-source-mac.mjs'));
    mkdirSync(join(native, 'vlc-patches'), { recursive: true });
    copyFileSync(
      'scripts/vlc-patches/avcodec-version-guard.patch',
      join(native, 'vlc-patches/avcodec-version-guard.patch'),
    );
  }
  if (scope === 'public') verifyPublicResources(resources);
  if (context.electronPlatformName !== 'darwin') return;
  writeLocalizedDisplayName(resources);
  // Finder/resource-fork metadata on generated files invalidates codesign sealing.
  // Restrict cleanup to this build's generated app, never source, user data or installed apps.
  const app = join(context.appOutDir, `${context.packager.appInfo.productFilename}.app`);
  if (process.env.ROOMS_SPARKLE === '1') {
    const framework = join(process.cwd(), '.local/sparkle/Sparkle.framework');
    if (!existsSync(framework) || !existsSync('dist-native/rooms-sparkle.node'))
      throw new Error('Prepare Sparkle before packaging');
    const copied = spawnSync(
      '/bin/cp',
      ['-R', framework, join(app, 'Contents/Frameworks/Sparkle.framework')],
      { stdio: 'inherit' },
    );
    if (copied.status !== 0) throw new Error('Sparkle framework copy failed');
    const native = join(app, 'Contents/Resources/native');
    mkdirSync(native, { recursive: true });
    copyFileSync('dist-native/rooms-sparkle.node', join(native, 'rooms-sparkle.node'));
    copyFileSync('.local/sparkle/LICENSE', join(native, 'Sparkle-LICENSE.txt'));
  }
  if (scope === 'public') verifyPublicResources(resources);
  const result = spawnSync('/usr/bin/xattr', ['-cr', app], { stdio: 'inherit' });
  if (result.error) throw result.error;
  if (result.status !== 0)
    throw new Error('Could not clean generated app metadata before signing.');
};
