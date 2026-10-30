import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { readFile, readdir, mkdir, writeFile, rm } from 'node:fs/promises';
import { join, resolve, basename } from 'node:path';
import { _electron } from '@playwright/test';

assert.equal(process.platform, 'win32', 'Native Windows verification is required');
const { version } = JSON.parse(await readFile('package.json', 'utf8'));
const sourceSha = spawnSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).stdout.trim();
assert(/^[a-f0-9]{40}$/.test(sourceSha), 'Source provenance required');
const output = resolve('release'),
  installer = join(output, `ROOMS-${version}-windows-x64-setup.exe`);
const installDir = resolve(process.env.ROOMS_WINDOWS_INSTALL_DIR ?? '');
assert(
  process.env.ROOMS_WINDOWS_INSTALL_DIR && basename(installDir) === 'rooms-candidate-installed',
  'Use a dedicated disposable CI install directory',
);
const result = {
  version,
  sourceSha,
  platform: process.platform,
  arch: process.arch,
  status: 'RUNNING',
  signed: false,
  checks: [],
  limitations: [
    'Hosted Windows Server 2025 VM, not a physical Windows friend device',
    'No live login, microphone, camera, room, private IPTV or DJ publication',
    'Hosted Windows has no audio endpoint; native video display is required, physical audio stays open',
    'In-app update from a previous release not exercised (unsigned NSIS, SHA-512 via latest.yml; needs a real PC)',
    'Unsigned candidate; no SmartScreen/security warning bypass',
  ],
};
const sha = async (file) =>
  createHash('sha256')
    .update(await readFile(file))
    .digest('hex');
let app, profile;
const profileId = `qa-${randomUUID()}`;
assert(/^[a-zA-Z0-9-]{1,40}$/.test(profileId));
const expectedProfile = resolve(process.env.APPDATA, 'ROOMS', profileId);
const executable = join(installDir, 'ROOMS.exe');
// The checks read Turkish text; CI runners are set up in English.
const env = { ROOMS_LOCALE: 'tr', ...process.env, ROOMS_PROFILE: profileId };
delete env.ELECTRON_RUN_AS_NODE;
delete env.ROOMS_DEV_URL;
const launch = async () => {
  app = await _electron.launch({ executablePath: executable, env, timeout: 45000 });
  profile = await app.evaluate(({ app }) => app.getPath('userData'));
  assert.equal(
    resolve(profile).toLowerCase(),
    expectedProfile.toLowerCase(),
    'Refuse default profile access/cleanup',
  );
  const page = await app.firstWindow({ timeout: 30000 });
  return page;
};
await mkdir(output, { recursive: true });
try {
  result.installer = {
    name: basename(installer),
    sha256: await sha(installer),
    bytes: (await readFile(installer)).length,
  };
  const installation = spawnSync(installer, ['/S', `/D=${installDir}`], {
    timeout: 120000,
    encoding: 'utf8',
  });
  assert.equal(installation.error, undefined);
  assert.equal(installation.status, 0, 'NSIS installation failed');
  result.checks.push('NSIS silent installation to disposable CI directory');
  assert.equal(
    await sha(join(installDir, 'resources', 'app.asar')),
    await sha(join(output, 'win-unpacked', 'resources', 'app.asar')),
    'Installed app differs from built package',
  );
  result.checks.push('Installed ASAR equals packaged ASAR');
  const nativeCheck = spawnSync(process.execPath, ['scripts/verify-vlc-native.mjs'], {
    env: { ...process.env, ROOMS_VLC_QA_NATIVE_ROOT: join(installDir, 'resources', 'native') },
    stdio: 'inherit',
    timeout: 180000,
  });
  assert.equal(nativeCheck.error, undefined);
  assert.equal(nativeCheck.status, 0, 'Installed VLC synthetic output check failed');
  result.checks.push(
    'Installed VLC runtime displays synthetic video; hosted physical audio excluded',
  );
  let page = await launch();
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  // The signed-out start screen opens on Kayıt ol; the old connection card's "Giriş" heading
  // only flashes while the app routes there.
  await page.getByRole('heading', { name: 'Hesap oluştur', exact: true }).waitFor();
  const info = await page.evaluate(() => window.rooms.applicationInfo());
  assert.equal(info.version, version);
  assert.equal(info.platform, 'win32');
  assert.equal(info.arch, 'x64');
  result.info = info;
  result.nativePlayer = await page.evaluate(() => window.rooms.providers.nativePlayer.status());
  assert.equal(result.nativePlayer.available, true, 'Installed VLC engine must load');
  result.checks.push('Installed native VLC adapter and official runtime load');
  assert.equal(await app.evaluate(({ app }) => app.isPackaged), true);
  assert(page.url().startsWith('file:///'));
  assert.equal(await page.evaluate(() => typeof window.require), 'undefined');
  result.checks.push(
    'Actual installed x64 packaged Electron app, file:// onboarding, sandboxed renderer',
  );
  assert.equal(
    await sha(join(installDir, 'resources/native/rooms-remote-input.node')),
    await sha(join(output, 'win-unpacked/resources/native/rooms-remote-input.node')),
  );
  result.remoteInput = await app.evaluate(({ app }) => {
    const { createRequire } = process.getBuiltinModule('module');
    const { join } = process.getBuiltinModule('path');
    const native = createRequire(join(app.getAppPath(), 'package.json'))(
      join(process.resourcesPath, 'native', 'rooms-remote-input.node'),
    );
    const status = native.status();
    if (!status.supported || status.active) throw Error('Installed native input must be inactive');
    const refused = native.apply(2, 0, 0, 65, true) === false;
    native.end();
    return {
      supported: status.supported,
      inactive: !status.active,
      unapprovedInputRefused: refused,
    };
  });
  assert.equal(result.remoteInput.unapprovedInputRefused, true);
  result.checks.push(
    'Installed native input hash/load and unapproved-input refusal; no OS input armed',
  );
  await assert.rejects(page.evaluate(() => window.rooms.windowAction('invalid')));
  result.checks.push('Invalid privileged window command refused');
  await page.getByLabel('Davet bağlantısı', { exact: true }).waitFor();
  await page.getByRole('tab', { name: 'Giriş yap', exact: true }).click();
  await page.getByLabel('E-posta adresi').waitFor();
  await page.getByRole('tab', { name: 'Kendi sunucunu kur', exact: true }).click();
  // The self-host tab is a one-step-per-screen wizard; the install command is on step 4.
  await page.getByRole('button', { name: '4. adım: Kur', exact: true }).click();
  await page.getByLabel('Kurulum komutu', { exact: true }).waitFor();
  result.checks.push(
    'Start tabs (Kayıt ol, Giriş yap, Kendi sunucunu kur) without submitting credentials',
  );
  await page.evaluate(() => (location.hash = '/settings?tab=appearance'));
  await page.getByRole('heading', { name: 'Görünüm ve erişilebilirlik', exact: true }).waitFor();
  for (const [width, height] of [
    [900, 700],
    [1440, 900],
  ]) {
    await app.evaluate(
      ({ BrowserWindow }, bounds) => BrowserWindow.getAllWindows()[0].setContentSize(...bounds),
      [width, height],
    );
    assert(
      await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
      'Horizontal overflow',
    );
    await page.screenshot({ path: join(output, `windows-package-${width}.png`) });
  }
  result.checks.push(
    'Settings and 900x700 / 1440x900 Windows viewport screenshots, no horizontal overflow',
  );
  result.captureStatus = await page.evaluate(() => window.rooms.media.captureStatus());
  assert.equal(result.captureStatus.systemAudio, true);
  // Enumeration only. No source selection, capture or room publication.
  try {
    result.captureSources = await page.evaluate(async () => {
      const sources = await window.rooms.media.captureSources();
      return {
        count: sources.length,
        screenCount: sources.filter((source) => source.id.startsWith('screen:')).length,
      };
    });
  } catch {
    result.captureSources = { status: 'UNAVAILABLE_ON_HOSTED_DESKTOP' };
  }
  const assets = await readdir('dist/assets');
  const worklet = assets.find((name) => /^noise-worklet-.*\.js$/.test(name));
  const rnnoise = assets.find((name) => /^rnnoise-.*\.wasm$/.test(name));
  const gtcrn = assets.find((name) => /^gtcrn-.*\.wasm$/.test(name));
  assert(worklet && rnnoise && gtcrn, 'Bundled noise assets missing');
  result.models = await page.evaluate(
    async ({ worklet, rnnoise, gtcrn }) => {
      const context = new AudioContext({ sampleRate: 48000 });
      const nodes = [];
      try {
        await context.audioWorklet.addModule(new URL(`./assets/${worklet}`, location.href));
        const read = async (name) => {
          const response = await fetch(new URL(`./assets/${name}`, location.href));
          if (!response.ok) throw Error('Bundled model unavailable');
          return response.arrayBuffer();
        };
        const rnnoiseBinary = await read(rnnoise),
          gtcrnBinary = await read(gtcrn);
        const modes = [];
        for (const mode of ['standard', 'strong']) {
          const node = new AudioWorkletNode(context, 'rooms-noise-suppression', {
            numberOfInputs: 1,
            numberOfOutputs: 1,
            outputChannelCount: [1],
            channelCount: 1,
            channelCountMode: 'explicit',
            processorOptions: {
              mode,
              rnnoiseBinary,
              gtcrnBinary: mode === 'strong' ? gtcrnBinary : undefined,
            },
          });
          nodes.push(node);
          await new Promise((resolve, reject) => {
            const timer = setTimeout(() => reject(Error('Model ready timeout')), 10000);
            node.addEventListener(
              'processorerror',
              () => {
                clearTimeout(timer);
                reject(Error('Processor failure'));
              },
              { once: true },
            );
            node.port.onmessage = (event) => {
              if (event.data?.type === 'ready') {
                clearTimeout(timer);
                resolve();
              } else if (event.data?.type === 'error') {
                clearTimeout(timer);
                reject(Error('Model initialization failure'));
              }
            };
          });
          modes.push(mode);
        }
        return {
          modes,
          scope:
            'Real bundled WASM/worklet readiness, no physical microphone or noise-quality acceptance',
        };
      } finally {
        for (const node of nodes) {
          node.port.postMessage({ type: 'destroy' });
          node.disconnect();
          node.port.close();
        }
        await context.close();
      }
    },
    { worklet, rnnoise, gtcrn },
  );
  result.checks.push(
    'Actual installed file:// Strong/Standard models initialize under packaged CSP',
  );
  await page.evaluate(() => localStorage.setItem('rooms-windows-disposable-check', 'persisted'));
  await app.close();
  app = null;
  page = await launch();
  await page.getByRole('heading', { name: 'Hesap oluştur', exact: true }).waitFor();
  assert.equal(
    await page.evaluate(() => localStorage.getItem('rooms-windows-disposable-check')),
    'persisted',
  );
  result.checks.push('Normal packaged relaunch preserves disposable profile preference');
  assert.deepEqual(errors, []);
  result.rendererErrors = errors;
  result.status = 'PASS_NATIVE_WINDOWS_PACKAGE';
} catch (error) {
  result.status = 'FAILED';
  result.error = error.message;
  throw error;
} finally {
  if (app) await app.close();
  if (profile && resolve(profile).toLowerCase() === expectedProfile.toLowerCase())
    await rm(expectedProfile, { recursive: true, force: true });
  result.at = new Date().toISOString();
  await writeFile(
    join(output, 'windows-package-results.json'),
    JSON.stringify(result, null, 2) + '\n',
  );
  console.log(JSON.stringify(result));
}
