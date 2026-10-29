// Windows in-app updates (electron-updater, generic provider, NSIS).
//   node scripts/windows-update-feed.mjs config        writes dist/update-config.json from ROOMS_UPDATE_FEED
//   node scripts/windows-update-feed.mjs verify <dir>  checks <dir>/latest.yml against the built installer
// The app reads `<feed>latest.yml`, downloads the installer named there from the same feed and
// rejects it unless its SHA-512 matches. Release assets must therefore be uploaded together.
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

/** The feed base: credential-free HTTPS, ending in `/` so relative installer names resolve. */
export function updateFeed(value) {
  let url;
  try {
    url = new URL(value ?? '');
  } catch {
    throw new Error('Set ROOMS_UPDATE_FEED to an HTTPS update feed base.');
  }
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash)
    throw new Error('Use a public HTTPS update feed without credentials, query or fragment.');
  if (!url.pathname.endsWith('/')) url.pathname += '/';
  return url.href;
}

export function installerName(version) {
  return `ROOMS-${version}-windows-x64-setup.exe`;
}

/** Parses latest.yml with the YAML loader electron-updater itself uses. */
export function parseLatestYml(text) {
  const require = createRequire(import.meta.url);
  const yaml = createRequire(require.resolve('electron-updater'))('js-yaml');
  const info = yaml.load(text);
  if (!info || typeof info !== 'object') throw new Error('latest.yml is not a YAML mapping.');
  return info;
}

/** Problems that would make the app reject or mis-resolve this update; empty when consistent. */
export function latestYmlProblems(info, { version, installer, sha512, size }) {
  const problems = [];
  const files = Array.isArray(info.files) ? info.files : [];
  if (info.version !== version) problems.push(`version ${info.version} is not ${version}`);
  if (files.length !== 1) problems.push(`expected one installer entry, found ${files.length}`);
  const [entry] = files;
  if (entry?.url !== installer) problems.push(`installer url ${entry?.url} is not ${installer}`);
  if (/[/\\]|\.\./.test(String(entry?.url ?? '')))
    problems.push('installer url must stay inside the feed directory');
  if (entry?.sha512 !== sha512) problems.push('installer sha512 does not match the built file');
  if (entry?.size !== size) problems.push(`installer size ${entry?.size} is not ${size}`);
  // Older electron-updater clients read the top-level fields.
  if (info.path !== undefined && info.path !== installer) problems.push('path does not match');
  if (info.sha512 !== undefined && info.sha512 !== sha512) problems.push('sha512 does not match');
  return problems;
}

export function sha512Base64(bytes) {
  return createHash('sha512').update(bytes).digest('base64');
}

function verify(dir) {
  const { version } = JSON.parse(readFileSync('package.json', 'utf8'));
  const installer = installerName(version);
  const exe = join(dir, installer),
    metadata = join(dir, 'latest.yml'),
    blockmap = `${exe}.blockmap`;
  for (const path of [exe, metadata, blockmap])
    if (!existsSync(path)) throw new Error(`Missing update asset: ${path}`);
  const problems = latestYmlProblems(parseLatestYml(readFileSync(metadata, 'utf8')), {
    version,
    installer,
    sha512: sha512Base64(readFileSync(exe)),
    size: statSync(exe).size,
  });
  if (problems.length) throw new Error(`latest.yml is inconsistent: ${problems.join('; ')}`);
  console.log(`Update metadata verified for ${installer} (upload: ${installer}, latest.yml, blockmap).`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const [command, dir] = process.argv.slice(2);
  if (command === 'config') {
    const feed = updateFeed(process.env.ROOMS_UPDATE_FEED);
    writeFileSync('dist/update-config.json', JSON.stringify({ feed }));
    console.log(`Windows update feed: ${feed}`);
  } else if (command === 'verify' && dir) verify(dir);
  else throw new Error('Usage: windows-update-feed.mjs config | verify <release dir>');
}
