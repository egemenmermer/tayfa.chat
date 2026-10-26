// Deterministic screenshots of every development fixture (`?fixture=<id>&variant=<v>`) plus a pixel
// comparison against an earlier run. It is the cheap visual regression gate for UI refactors:
//
//   node scripts/fixture-shots.mjs --out .local/shots/before
//   ... refactor ...
//   node scripts/fixture-shots.mjs --out .local/shots/after --compare .local/shots/before
//
// Headless Playwright chromium against the renderer dev server (no Electron). Fixtures and variants are
// discovered from apps/desktop/src/dev/*.ts and apps/desktop/src/main.tsx, so new ones are picked up.
// No dependencies beyond @playwright/test: PNGs are decoded/encoded with node:zlib.
import { chromium } from '@playwright/test';
import { spawn } from 'node:child_process';
import { mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { createServer } from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import zlib from 'node:zlib';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const devDir = path.join(root, 'apps/desktop/src/dev');

const USAGE = `Usage: node scripts/fixture-shots.mjs [options]
  --out <dir>            output directory (default .local/fixture-shots/latest)
  --compare <dir>        baseline directory from an earlier run; exits 1 on differences
  --only <regex>         only fixtures whose "S42/full_table" key matches (case-insensitive)
  --sizes <list>         comma separated WxH list (default 1280x800); --viewports is an alias
  --timeout <seconds>    per-capture time limit (default 15); a slow capture is reported and skipped
  --theme light|dark     colour scheme (default dark; the app has no light theme yet)
  --locale tr|en         interface language, forced through the renderer's ?lang= query (default tr)
  --full                 also capture the whole scrolling page area as <name>-full.png (taller viewport)
  --workers <n>          parallel pages (default 2)
  --max-diff-pixels <n>  allowed differing pixels per image (default 0)
  --pixel-tolerance <n>  per-channel difference (0-255) that still counts as equal (default 0)
  --all                  print every row of the table, not only failures
  --list                 print the discovered fixtures and exit
  --help`;

function parseArgs(argv) {
  const opts = {
    out: '.local/fixture-shots/latest',
    compare: null,
    only: null,
    viewports: '1280x800',
    timeout: 15,
    theme: 'dark',
    locale: 'tr',
    full: false,
    workers: 2,
    maxDiffPixels: 0,
    pixelTolerance: 0,
    all: false,
    list: false,
  };
  const valued = {
    '--out': 'out',
    '--compare': 'compare',
    '--only': 'only',
    '--viewports': 'viewports',
    '--sizes': 'viewports',
    '--timeout': 'timeout',
    '--theme': 'theme',
    '--locale': 'locale',
    '--workers': 'workers',
    '--max-diff-pixels': 'maxDiffPixels',
    '--pixel-tolerance': 'pixelTolerance',
  };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--help' || arg === '-h') {
      console.log(USAGE);
      process.exit(0);
    }
    if (arg === '--all') opts.all = true;
    else if (arg === '--full') opts.full = true;
    else if (arg === '--list') opts.list = true;
    else if (valued[arg]) {
      const value = argv[++i];
      if (value === undefined) throw new Error(`${arg} needs a value`);
      opts[valued[arg]] = value;
    } else throw new Error(`Unknown option ${arg}\n${USAGE}`);
  }
  if (!['light', 'dark'].includes(opts.theme)) throw new Error('--theme must be light or dark');
  if (!['tr', 'en'].includes(opts.locale)) throw new Error('--locale must be tr or en');
  for (const key of ['workers', 'maxDiffPixels', 'pixelTolerance', 'timeout'])
    opts[key] = Number(opts[key]);
  if (!Number.isInteger(opts.workers) || opts.workers < 1) throw new Error('Invalid --workers');
  if (!(opts.timeout >= 3 && opts.timeout <= 15)) throw new Error('--timeout must be 3-15 seconds');
  if (!Number.isInteger(opts.maxDiffPixels) || opts.maxDiffPixels < 0)
    throw new Error('Invalid --max-diff-pixels');
  if (!Number.isInteger(opts.pixelTolerance) || opts.pixelTolerance < 0)
    throw new Error('Invalid --pixel-tolerance');
  opts.viewports = opts.viewports.split(',').map((item) => {
    const match = /^(\d+)x(\d+)$/.exec(item.trim());
    if (!match) throw new Error(`Invalid viewport ${item}`);
    return { width: Number(match[1]), height: Number(match[2]), key: item.trim() };
  });
  opts.only = opts.only ? new RegExp(opts.only, 'i') : null;
  return opts;
}

// ---------------------------------------------------------------------------------------------
// Fixture discovery
// ---------------------------------------------------------------------------------------------

// Variants that are viewport evidence keys, not distinct scenes: the matrix covers viewports itself.
const isViewportKey = (variant) => /^\d+x\d+$/.test(variant);
const parseList = (text) => [...text.matchAll(/'([^']*)'/g)].map((m) => m[1]);

// Fixtures whose variants live in a named constant instead of an `S12: ['default', ...]` table.
const NAMED_VARIANT_LISTS = {
  S29: ['personal-playback-fixture.ts', 'variants'],
  S66: ['appearance-fixture.ts', 'appearanceVariants'],
  S67: ['notification-fixture.ts', 'notificationVariants'],
  S68: ['community-management-fixture.ts', 'COMMUNITY_MANAGEMENT_FIXTURE_VARIANTS'],
  S80: ['community-cinema-fixture.ts', 'COMMUNITY_CINEMA_FIXTURE_VARIANTS'],
};
// main.tsx accepts only these for S30 (inline literal in mini-playback-fixture.ts); S30 has no
// `default` variant (no variant means `personal`), so none is added for these lists.
const INLINE_VARIANT_LISTS = { S30: ['personal', 'live'] };

// The hash route that shows each fixture. Keep in step with scripts/capture-reference.mjs and the
// Games fixture metadata; fixtures not listed open the app's default route.
const ROUTES = {
  S01: '/setup/welcome',
  S02: '/setup/signin',
  S03: '/setup/register',
  S04: '/setup/recovery',
  S05: '/setup/invite',
  S06: '/setup/profile',
  S07: '/setup/devices',
  S08: '/home',
  S09: '/friends',
  S10: '/chat',
  S12: '/dm',
  S13: '/chat',
  S14: '/files',
  S15: '/chat',
  S16: '/notifications',
  S17: '/chat',
  S18: '/chat',
  S19: '/voice',
  S20: '/voice',
  S21: '/voice',
  S22: '/voice?view=share',
  S23: '/voice',
  S29: '/media?player=1',
  S30: '/chat',
  S33: '/media',
  S34: '/media',
  S35: '/media',
  S36: '/media?player=1',
  S37: '/media',
  S38: '/media',
  S39: '/media?player=1',
  S51: '/games?tab=history',
  S53: '/together',
  S54: '/together?tab=board',
  S56: '/agent',
  S57: '/agent',
  S58: '/agent',
  S59: '/settings?tab=agent',
  S60: '/settings?tab=connections',
  S61: '/settings?tab=room-memory',
  S62: '/settings?tab=schedules',
  S63: '/settings?tab=automation',
  S66: '/settings?tab=appearance',
  S67: '/settings?tab=desktop',
  S68: '/settings?tab=community-management',
  S70: '/settings?tab=assistant-permissions',
  S71: '/settings?tab=about',
  // SystemState reads the S72 projection only on the connection status page.
  S72: '/status',
  S80: '/cinema',
};
// Fixtures that cannot render by design: skipped (and listed in the summary), never reported as failures.
const SKIPS = {
  'S68/invite': 'unsupported by design: the fixture throws (no broker invitation capability yet)',
  'S68/invite_created':
    'unsupported by design: the fixture throws (no broker invitation capability)',
  'S68/revoke': 'unsupported by design: the fixture throws (no broker revocation capability)',
  'S50/penalty': 'unsupported by design: games-fixture throws (no penalty-event projection yet)',
  'S54/saved': 'unsupported by design: games-fixture throws (no named saved-board archive yet)',
};
function routeFor(id, variant) {
  if (id === 'S38' && variant === 'playing') return '/media?player=1';
  if (ROUTES[id]) return ROUTES[id];
  // S40/S41 are the lobby (Games lobby); S42-S50, S52 and S73-S75 are table states, shown on the table tab.
  if (/^S4[01]$/.test(id)) return '/games';
  if (/^S(4[2-9]|50|52|7[3-5])$/.test(id)) return '/games?tab=table';
  return null;
}

async function discoverFixtures() {
  const files = (await readdir(devDir)).filter((f) => f.endsWith('.ts')).sort();
  const texts = new Map();
  for (const file of files) texts.set(file, await readFile(path.join(devDir, file), 'utf8'));
  const found = new Map(); // id -> variants[]
  // `S12: ['default', 'blocked']` tables (multi-line arrays included). media-fixture.ts only mirrors
  // lists owned by the files below, so it is skipped to avoid advertising variants it would reject.
  for (const [file, text] of texts) {
    if (file === 'media-fixture.ts') continue;
    for (const match of text.matchAll(/\b(S\d{2}):\s*\[([^\]]*)\]/g))
      if (!found.has(match[1])) found.set(match[1], parseList(match[2]));
  }
  for (const [id, [file, name]] of Object.entries(NAMED_VARIANT_LISTS)) {
    const match = new RegExp(`\\b${name}\\s*=\\s*\\[([^\\]]*)\\]`).exec(texts.get(file) ?? '');
    if (match) found.set(id, parseList(match[1].replace(/\/\*\*[^*]*\*\//g, '')));
  }
  for (const [id, variants] of Object.entries(INLINE_VARIANT_LISTS)) found.set(id, variants);
  // Any other id main.tsx routes to a fixture (S59-S63 reuse the S19 sample) has a default scene.
  const main = await readFile(path.join(root, 'apps/desktop/src/main.tsx'), 'utf8');
  const mentioned = [...main.matchAll(/\bS\d{2}\b/g)].map((m) => m[0]);
  for (const group of main.matchAll(/\bS\(([\d|]+)\)/g))
    for (const number of group[1].split('|')) mentioned.push(`S${number}`);
  for (const id of mentioned) if (!found.has(id)) found.set(id, ['default']);
  const fixtures = [];
  for (const [id, variants] of [...found].sort(([a], [b]) => a.localeCompare(b))) {
    const unique = [...new Set(variants)].filter((v) => !isViewportKey(v));
    if (!unique.includes('default') && !INLINE_VARIANT_LISTS[id]) unique.unshift('default');
    for (const variant of unique) fixtures.push({ id, variant, key: `${id}/${variant}` });
  }
  return fixtures;
}

// ---------------------------------------------------------------------------------------------
// Dev server
// ---------------------------------------------------------------------------------------------

function freePort() {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      server.close(() => resolve(port));
    });
  });
}

let devServer = null;
function stopDevServer() {
  if (!devServer || devServer.exitCode !== null) return;
  try {
    process.kill(-devServer.pid, 'SIGTERM');
  } catch {
    devServer.kill('SIGTERM');
  }
}
for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    stopDevServer();
    process.exit(130);
  });
}
process.on('exit', stopDevServer);

async function startDevServer() {
  const port = await freePort();
  const vite = path.join(root, 'node_modules/.bin/vite');
  if (!existsSync(vite)) throw new Error('vite is not installed; run pnpm install first');
  // The repo's dev:web script is `vite --host 127.0.0.1`; the port is overridden for a free one.
  devServer = spawn(vite, ['--host', '127.0.0.1', '--port', String(port), '--strictPort'], {
    cwd: root,
    detached: true,
    stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, BROWSER: 'none', NO_COLOR: '1' },
  });
  let log = '';
  devServer.stdout.on('data', (d) => (log += d));
  devServer.stderr.on('data', (d) => (log += d));
  const base = `http://127.0.0.1:${port}`;
  const deadline = Date.now() + 90_000;
  while (Date.now() < deadline) {
    if (devServer.exitCode !== null) throw new Error(`vite exited early:\n${log}`);
    try {
      const response = await fetch(`${base}/`);
      if (response.ok) return base;
    } catch {
      // not listening yet
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error(`vite did not start within 90s:\n${log}`);
}

// ---------------------------------------------------------------------------------------------
// Capture
// ---------------------------------------------------------------------------------------------

const FIXED_TIME = new Date('2026-03-14T10:30:00.000Z');
// Seeded Math.random (mulberry32), reinstalled on every page load; storage is cleared so a reused
// profile can never leak state between fixtures.
const INIT_SCRIPT = `(() => {
  try { localStorage.clear(); sessionStorage.clear(); } catch {}
  let a = 0x9e3779b9;
  Math.random = () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
})();`;

const fileName = (fixture, viewport, suffix = '') =>
  `${fixture.id}__${fixture.variant}__${viewport.key}${suffix}.png`;
const MAX_FULL_HEIGHT = 2400;

// One capture gets `limitMs` in total (navigation retries included). When it runs out the context is
// closed, which aborts whatever the page was doing, and the capture is reported as a timeout.
async function capture(browser, base, opts, job, limitMs = opts.timeout * 1000) {
  const { fixture, viewport } = job;
  const deadline = Date.now() + limitMs;
  const left = (cap) => Math.max(1000, Math.min(cap, deadline - Date.now()));
  let timedOut = false;
  const context = await browser.newContext({
    viewport: { width: viewport.width, height: viewport.height },
    deviceScaleFactor: 1,
    colorScheme: opts.theme,
    locale: opts.locale === 'en' ? 'en-US' : 'tr-TR',
    timezoneId: 'Europe/Amsterdam',
    reducedMotion: 'reduce',
    serviceWorkers: 'block',
  });
  const problems = [];
  const timer = setTimeout(() => {
    timedOut = true;
    context.close().catch(() => {});
  }, limitMs);
  try {
    // Fixtures are self-contained; anything that is not the dev server would be nondeterministic.
    await context.route(
      (url) =>
        url.protocol.startsWith('http') && !['127.0.0.1', 'localhost'].includes(url.hostname),
      (route) => route.abort(),
    );
    await context.addInitScript(INIT_SCRIPT);
    const page = await context.newPage();
    // Date.now()/new Date() are pinned; timers keep running so the app still renders normally.
    await page.clock.setFixedTime(FIXED_TIME);
    page.on('pageerror', (error) => problems.push(`pageerror: ${error.message.split('\n')[0]}`));
    const route = routeFor(fixture.id, fixture.variant);
    const query = new URLSearchParams({
      fixture: fixture.id,
      variant: fixture.variant,
      lang: opts.locale,
      theme: opts.theme,
    });
    const url = `${base}/?${query}${route ? `#${route}` : ''}`;
    let failure = null;
    for (let attempt = 0; attempt < 3 && Date.now() < deadline; attempt++) {
      failure = null;
      try {
        await page.goto(url, { waitUntil: 'load', timeout: left(12_000) });
        await page.waitForFunction(
          () => document.querySelector('#root')?.childElementCount > 0,
          null,
          { timeout: left(10_000) },
        );
        await page.waitForLoadState('networkidle', { timeout: left(3_000) }).catch(() => {});
        await page.evaluate(() => document.fonts.ready);
        await page.evaluate(
          () => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))),
        );
        await page.waitForTimeout(300);
        if (await page.locator('.fatal').count()) failure = 'error boundary (.fatal) is showing';
        break;
      } catch (error) {
        // The first visit can trigger a vite dependency re-optimisation reload; retry.
        failure = `navigation failed: ${String(error.message).split('\n')[0]}`;
        problems.length = 0;
      }
    }
    if (timedOut) failure = `timeout after ${limitMs / 1000}s`;
    if (failure) return { ...job, ok: false, failure, problems };
    await page.evaluate(
      () => document.activeElement instanceof HTMLElement && document.activeElement.blur(),
    );
    const png = await page.screenshot({ animations: 'disabled', caret: 'hide', scale: 'css' });
    await writeFile(path.join(opts.out, fileName(fixture, viewport)), png);
    if (opts.full) {
      // The app scrolls inside nested panes; grow the viewport by the largest hidden overflow of a
      // wide scroll container (side lists are narrower) and shoot again. Reflow can expose more
      // overflow after a resize, so repeat a few times.
      const measure = () =>
        page.evaluate(() => {
          let most = 0;
          for (const el of document.querySelectorAll('body *')) {
            const overflow = getComputedStyle(el).overflowY;
            if (overflow !== 'auto' && overflow !== 'scroll') continue;
            if (el.clientWidth < window.innerWidth * 0.5) continue;
            most = Math.max(most, el.scrollHeight - el.clientHeight);
          }
          return most;
        });
      let height = viewport.height;
      for (let round = 0; round < 3 && height < MAX_FULL_HEIGHT; round++) {
        const extra = await measure();
        if (extra <= 0) break;
        height = Math.min(height + extra, MAX_FULL_HEIGHT);
        await page.setViewportSize({ width: viewport.width, height });
        await page.evaluate(
          () => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))),
        );
        await page.waitForTimeout(200);
      }
      if (height > viewport.height) {
        const tall = await page.screenshot({ animations: 'disabled', caret: 'hide', scale: 'css' });
        await writeFile(path.join(opts.out, fileName(fixture, viewport, '-full')), tall);
      }
    }
    return { ...job, ok: true, failure: null, problems };
  } catch (error) {
    const failure = timedOut
      ? `timeout after ${limitMs / 1000}s`
      : String(error.message).split('\n')[0];
    return { ...job, ok: false, failure, problems };
  } finally {
    clearTimeout(timer);
    await context.close().catch(() => {});
  }
}

// ---------------------------------------------------------------------------------------------
// PNG decode / encode / diff (8-bit RGB or RGBA, non-interlaced: what chromium produces)
// ---------------------------------------------------------------------------------------------

function decodePng(buffer) {
  if (buffer.readUInt32BE(0) !== 0x89504e47) throw new Error('not a PNG');
  let offset = 8;
  let width = 0;
  let height = 0;
  let channels = 0;
  const idat = [];
  while (offset < buffer.length) {
    const length = buffer.readUInt32BE(offset);
    const type = buffer.toString('ascii', offset + 4, offset + 8);
    const data = buffer.subarray(offset + 8, offset + 8 + length);
    if (type === 'IHDR') {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      const depth = data[8];
      const colorType = data[9];
      if (depth !== 8 || data[12] !== 0 || ![2, 6].includes(colorType))
        throw new Error(`unsupported PNG (depth ${depth}, colour type ${colorType})`);
      channels = colorType === 6 ? 4 : 3;
    } else if (type === 'IDAT') idat.push(data);
    else if (type === 'IEND') break;
    offset += 12 + length;
  }
  const raw = zlib.inflateSync(Buffer.concat(idat));
  const stride = width * channels;
  const out = Buffer.alloc(width * height * 4, 255);
  const prev = Buffer.alloc(stride);
  const line = Buffer.alloc(stride);
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)];
    const source = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1));
    for (let x = 0; x < stride; x++) {
      const left = x >= channels ? line[x - channels] : 0;
      const up = prev[x];
      const upLeft = x >= channels ? prev[x - channels] : 0;
      let value = source[x];
      if (filter === 1) value += left;
      else if (filter === 2) value += up;
      else if (filter === 3) value += (left + up) >> 1;
      else if (filter === 4) {
        const p = left + up - upLeft;
        const pa = Math.abs(p - left);
        const pb = Math.abs(p - up);
        const pc = Math.abs(p - upLeft);
        value += pa <= pb && pa <= pc ? left : pb <= pc ? up : upLeft;
      }
      line[x] = value & 255;
    }
    for (let x = 0; x < width; x++)
      for (let c = 0; c < channels; c++) out[(y * width + x) * 4 + c] = line[x * channels + c];
    line.copy(prev);
  }
  return { width, height, data: out };
}

const crcTable = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
function crc32(buffer) {
  let c = 0xffffffff;
  for (const byte of buffer) c = crcTable[(c ^ byte) & 255] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function encodePng({ width, height, data }) {
  const chunk = (type, body) => {
    const head = Buffer.alloc(8);
    head.writeUInt32BE(body.length, 0);
    head.write(type, 4, 'ascii');
    const tail = Buffer.alloc(4);
    tail.writeUInt32BE(crc32(Buffer.concat([head.subarray(4), body])), 0);
    return Buffer.concat([head, body, tail]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  const stride = width * 4;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y++)
    data.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

/** Pixel diff of two PNG files. Returns the count of differing pixels and an optional diff image. */
function diffImages(aBuffer, bBuffer, tolerance) {
  if (aBuffer.equals(bBuffer)) return { equal: true, diff: 0, total: 0, image: null };
  const a = decodePng(aBuffer);
  const b = decodePng(bBuffer);
  if (a.width !== b.width || a.height !== b.height)
    return {
      equal: false,
      diff: -1,
      total: a.width * a.height,
      image: null,
      note: `size ${a.width}x${a.height} vs ${b.width}x${b.height}`,
    };
  const total = a.width * a.height;
  const image = Buffer.alloc(total * 4);
  let diff = 0;
  for (let i = 0; i < total; i++) {
    const o = i * 4;
    const delta = Math.max(
      Math.abs(a.data[o] - b.data[o]),
      Math.abs(a.data[o + 1] - b.data[o + 1]),
      Math.abs(a.data[o + 2] - b.data[o + 2]),
      Math.abs(a.data[o + 3] - b.data[o + 3]),
    );
    if (delta > tolerance) {
      diff++;
      image[o] = 255;
      image[o + 3] = 255;
    } else {
      // Faded copy of the baseline so changes stay readable in context.
      const gray = (a.data[o] + a.data[o + 1] + a.data[o + 2]) / 3;
      const faded = 200 + gray * 0.2;
      image[o] = image[o + 1] = image[o + 2] = faded;
      image[o + 3] = 255;
    }
  }
  return {
    equal: diff === 0,
    diff,
    total,
    image: diff ? encodePng({ width: a.width, height: a.height, data: image }) : null,
  };
}

// ---------------------------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------------------------

function table(rows) {
  const widths = rows[0].map((_, col) => Math.max(...rows.map((row) => String(row[col]).length)));
  return rows
    .map((row) =>
      row
        .map((cell, col) => String(cell).padEnd(widths[col]))
        .join('  ')
        .trimEnd(),
    )
    .join('\n');
}

async function run() {
  const opts = parseArgs(process.argv.slice(2));
  let fixtures = await discoverFixtures();
  if (opts.only) fixtures = fixtures.filter((f) => opts.only.test(f.key));
  if (opts.list) {
    console.log(
      fixtures.map((f) => `${f.key}  ${routeFor(f.id, f.variant) ?? '(default route)'}`).join('\n'),
    );
    console.log(`${fixtures.length} fixtures`);
    return 0;
  }
  if (!fixtures.length) throw new Error('No fixture matches --only');
  const skipped = fixtures.filter((f) => SKIPS[f.key]);
  fixtures = fixtures.filter((f) => !SKIPS[f.key]);
  if (!fixtures.length) throw new Error('Every fixture matching --only is skipped');
  opts.out = path.resolve(root, opts.out);
  if (opts.compare) {
    opts.compare = path.resolve(root, opts.compare);
    if (!existsSync(opts.compare)) throw new Error(`Baseline ${opts.compare} does not exist`);
    if (opts.compare === opts.out) throw new Error('--out and --compare must differ');
  }
  await rm(opts.out, { recursive: true, force: true });
  await mkdir(opts.out, { recursive: true });

  const started = Date.now();
  const jobs = fixtures.flatMap((fixture) =>
    opts.viewports.map((viewport) => ({ fixture, viewport })),
  );
  console.log(
    `${fixtures.length} fixtures x ${opts.viewports.length} viewports = ${jobs.length} images (${opts.theme}, ${opts.locale})`,
  );
  const base = await startDevServer();
  const results = [];
  let browser = null;
  try {
    browser = await chromium.launch({
      headless: true,
      args: ['--force-color-profile=srgb', '--disable-lcd-text', '--font-render-hinting=none'],
    });
    // Warm vite's dependency optimiser once so the first real fixtures are not reloaded mid-capture.
    const warmup = { fixture: { id: 'S10', variant: 'default' }, viewport: opts.viewports[0] };
    await capture(browser, base, opts, warmup, 60_000);
    await rm(path.join(opts.out, fileName(warmup.fixture, warmup.viewport)), { force: true });
    const queue = [...jobs];
    let done = 0;
    await Promise.all(
      Array.from({ length: Math.min(opts.workers, queue.length) }, async () => {
        for (let job = queue.shift(); job; job = queue.shift()) {
          results.push(await capture(browser, base, opts, job));
          done++;
          if (done % 25 === 0 || done === jobs.length)
            process.stderr.write(`  ${done}/${jobs.length} captured\n`);
        }
      }),
    );
  } finally {
    await browser?.close().catch(() => {});
    stopDevServer();
  }
  results.sort((a, b) =>
    fileName(a.fixture, a.viewport).localeCompare(fileName(b.fixture, b.viewport)),
  );
  const manifest = results.map((r) => ({
    image: fileName(r.fixture, r.viewport),
    fixture: r.fixture.key,
    viewport: r.viewport.key,
    ok: r.ok,
    failure: r.failure,
    problems: r.problems,
  }));
  await writeFile(
    path.join(opts.out, 'manifest.json'),
    JSON.stringify({ theme: opts.theme, locale: opts.locale, images: manifest }, null, 2),
  );

  const captured = results.filter((r) => r.ok).length;
  const failed = results.filter((r) => !r.ok);
  const withProblems = results.filter((r) => r.ok && r.problems.length);
  const seconds = ((Date.now() - started) / 1000).toFixed(0);
  let exitCode = failed.length ? 1 : 0;

  if (opts.compare) {
    const rows = [['IMAGE', 'STATUS', 'DIFF PX', 'DIFF %']];
    const baseline = new Set((await readdir(opts.compare)).filter((f) => f.endsWith('.png')));
    const current = new Set((await readdir(opts.out)).filter((f) => f.endsWith('.png')));
    await mkdir(path.join(opts.out, 'diff'), { recursive: true });
    let same = 0;
    let differ = 0;
    let missing = 0;
    let added = 0;
    for (const name of [...new Set([...baseline, ...current])].sort()) {
      if (!current.has(name)) {
        // A capture failure is reported separately; only count a baseline image as missing otherwise.
        if (!failed.some((r) => name.startsWith(fileName(r.fixture, r.viewport).slice(0, -4)))) {
          missing++;
          rows.push([name, 'MISSING', '-', '-']);
        }
        continue;
      }
      if (!baseline.has(name)) {
        added++;
        rows.push([name, 'NEW', '-', '-']);
        continue;
      }
      const result = diffImages(
        await readFile(path.join(opts.compare, name)),
        await readFile(path.join(opts.out, name)),
        opts.pixelTolerance,
      );
      if (result.diff === -1) {
        differ++;
        rows.push([name, 'SIZE', '-', result.note]);
      } else if (result.diff > opts.maxDiffPixels) {
        differ++;
        await writeFile(path.join(opts.out, 'diff', name), result.image);
        rows.push([
          name,
          'DIFF',
          result.diff,
          `${((result.diff / result.total) * 100).toFixed(3)}%`,
        ]);
      } else {
        same++;
        if (opts.all) rows.push([name, result.diff ? 'WITHIN' : 'SAME', result.diff, '0%']);
      }
    }
    if (rows.length > 1) console.log(table(rows));
    console.log(
      `compare: ${same} same, ${differ} different, ${missing} missing, ${added} new (max ${opts.maxDiffPixels} px, tolerance ${opts.pixelTolerance}/255)`,
    );
    if (differ) console.log(`diff images: ${path.join(opts.out, 'diff')}`);
    if (differ || missing) exitCode = 1;
  }
  for (const f of skipped) console.log(`SKIPPED ${f.key}: ${SKIPS[f.key]}`);
  for (const r of failed) console.log(`FAILED ${r.fixture.key} ${r.viewport.key}: ${r.failure}`);
  if (withProblems.length)
    console.log(
      `${withProblems.length} images had page errors (see manifest.json), e.g. ${withProblems[0].fixture.key}: ${withProblems[0].problems[0]}`,
    );
  console.log(
    `captured ${captured}/${jobs.length} images in ${seconds}s -> ${opts.out}${exitCode ? '  (exit 1)' : ''}`,
  );
  return exitCode;
}

try {
  process.exitCode = await run();
} catch (error) {
  stopDevServer();
  console.error(error.message);
  process.exitCode = 2;
}
