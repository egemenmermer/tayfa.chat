// Studio audio spike check: the real engine core, built with the app's vite config in production mode and
// served under the real index.html CSP from file:// (as the packaged app loads it), in Electron with the
// app's renderer permission predicate. Renders 4 bars offline, checks every part is audible and the WAV
// export decodes, and records CSP/worklet/clock/latency/MIDI findings in .local/studio-audio-check.
// Output is muted; no account, server or network is used.
import { _electron as electron } from '@playwright/test';
import { build } from 'esbuild';
import { build as viteBuild, loadConfigFromFile } from 'vite';
import { mkdir, readFile, readdir, stat, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import assert from 'node:assert/strict';
const root = resolve('.').replaceAll('\\', '/');
const out = resolve('.local/studio-audio-check');
await mkdir(out, { recursive: true });
const csp = (await readFile(join(root, 'apps/desktop/index.html'), 'utf8')).match(
  /<meta\s+http-equiv="Content-Security-Policy"\s+content="([^"]+)"/,
)?.[1];
if (!csp) throw new Error('The app CSP was not found in apps/desktop/index.html.');
await writeFile(
  join(out, 'probe.worklet.js'),
  `/*${' '.repeat(5000)}*/class StudioProbe extends AudioWorkletProcessor{process(_i,outputs){for(const channel of outputs[0])channel.fill(0.5);return true;}}registerProcessor('studio-probe',StudioProbe);`,
);
await writeFile(
  join(out, 'renderer.ts'),
  `
import {createStudioEngine} from '${root}/apps/desktop/src/studio/engine/engine';
import {demoSong} from '${root}/apps/desktop/src/studio/engine/schedule';
import {encodeWav, rms} from '${root}/apps/desktop/src/studio/engine/wav';
import probeWorklet from './probe.worklet.js?url&no-inline';
const violations: unknown[] = [];
const rejections: string[] = [];
document.addEventListener('securitypolicyviolation', (e) => violations.push({directive: e.effectiveDirective, blocked: e.blockedURI}));
addEventListener('unhandledrejection', (e) => rejections.push(String((e.reason && e.reason.message) || e.reason)));
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const timeout = <T,>(p: Promise<T>, ms: number) => Promise.race([p, sleep(ms).then(() => { throw new Error('timeout ' + ms + ' ms'); })]);
const settle = async (fn: () => Promise<unknown>) => { try { return {ok: true, value: await fn()}; } catch (e) { return {ok: false, error: String((e as Error)?.message || e)}; } };
const processorSource = "class P extends AudioWorkletProcessor{process(_i,o){for(const c of o[0])c.fill(0.5);return true}}registerProcessor('blob-probe',P)";
(window as any).__midi = (sysex: boolean) => settle(async () => { const access = await navigator.requestMIDIAccess({sysex}); return {inputs: access.inputs.size, outputs: access.outputs.size, sysexEnabled: access.sysexEnabled}; });
async function run() {
  const r: Record<string, unknown> = {};
  r.blobWorker = await settle(() => timeout(new Promise((resolve, reject) => {
    const w = new Worker(URL.createObjectURL(new Blob(['postMessage(1)'], {type: 'text/javascript'})));
    w.onmessage = () => { w.terminate(); resolve('message received'); };
    w.onerror = () => reject(new Error('worker error event'));
  }), 2000));
  const song = demoSong(120);
  const engine = await createStudioEngine(song);
  const Tone = await import('tone');
  r.toneVersion = Tone.version;
  r.defaultClock = engine.stats().clockSource;
  const timings: number[] = [];
  let full: {channels: Float32Array[]; sampleRate: number} | null = null;
  for (let i = 0; i < 2; i += 1) {
    const started = performance.now();
    full = await engine.renderOffline(4);
    timings.push(Math.round(performance.now() - started));
  }
  r.renderMs = timings;
  r.renderSeconds = full!.channels[0].length / full!.sampleRate;
  r.rms = {mix: rms(full!.channels)} as Record<string, number>;
  for (const id of ['drums', 'bass', 'chords']) (r.rms as Record<string, number>)[id] = rms((await engine.renderOffline(4, {partIds: [id]})).channels);
  const wav = encodeWav(full!.channels, full!.sampleRate);
  const decoded = await new OfflineAudioContext(2, 1, full!.sampleRate).decodeAudioData(wav.slice().buffer);
  r.wav = {bytes: wav.length, decodedChannels: decoded.numberOfChannels, decodedFrames: decoded.length, frames: full!.channels[0].length, decodedRms: rms([decoded.getChannelData(0), decoded.getChannelData(1)])};
  let binary = ''; for (let i = 0; i < wav.length; i += 0x8000) binary += String.fromCharCode(...wav.subarray(i, i + 0x8000));
  (window as any).__wav = btoa(binary);
  // Worklets: (a) Tone's own worklet nodes (blob: module, fetched by standardized-audio-context),
  // (b) native addModule from a blob: URL, (c) native addModule from a same-origin file emitted by vite.
  r.toneWorkletLive = await settle(async () => { const f = new Tone.FeedbackCombFilter(); await sleep(1500); const loaded = !!(f as any)._worklet; f.dispose(); if (!loaded) throw new Error('worklet node never created'); return 'loaded'; });
  r.toneFreeverbOffline = await settle(async () => { const b = await Tone.Offline(() => { const v = new Tone.Freeverb({roomSize: 0.7, wet: 1}).toDestination(); new Tone.Oscillator(220).connect(v).start(0); }, 1, 2, 44100); return {rms: rms([b.getChannelData(0)])}; });
  r.mvpEffectsOffline = await settle(async () => { const b = await Tone.Offline(async () => { const reverb = new Tone.Reverb({decay: 1.5, wet: 0.5}).toDestination(); await reverb.ready; const delay = new Tone.FeedbackDelay('8n', 0.3).connect(reverb); const eq = new Tone.EQ3(-2, 0, 3).connect(delay); new Tone.Synth().connect(eq).triggerAttackRelease(220, 0.5, 0); }, 1.5, 2, 44100); return {rms: rms([b.getChannelData(0), b.getChannelData(1)])}; });
  r.nativeBlobWorklet = await settle(async () => { const c = new OfflineAudioContext(1, 4410, 44100); await timeout(c.audioWorklet.addModule(URL.createObjectURL(new Blob([processorSource], {type: 'text/javascript'}))), 3000); return 'loaded'; });
  r.nativeSelfWorklet = await settle(async () => { const url = new URL(probeWorklet, location.href).href; const c = new OfflineAudioContext(1, 4410, 44100); await timeout(c.audioWorklet.addModule(url), 3000); new AudioWorkletNode(c, 'studio-probe').connect(c.destination); const b = await c.startRendering(); return {url: url.replace(/^.*\\//, ''), rms: rms([b.getChannelData(0)])}; });
  // Live playback, muted: proves the transport clock runs; latencies read once the context is running.
  Tone.getDestination().mute = true;
  r.live = await settle(async () => { await engine.play(4); await sleep(1500); const s = engine.stats(); const seconds = Tone.getTransport().seconds; engine.stop(); return {...s, transportSeconds: Math.round(seconds * 1000) / 1000}; });
  r.nativeLatency = await settle(async () => { const c = new AudioContext({latencyHint: 'interactive'}); await c.resume(); await sleep(400); const v = {state: c.state, sampleRate: c.sampleRate, baseLatency: c.baseLatency, outputLatency: c.outputLatency}; await c.close(); return v; });
  r.violations = violations;
  r.rejections = rejections;
  return r;
}
run().then((r) => { (window as any).__studio = r; }, (e) => { (window as any).__studio = {fatal: String(e?.stack || e)}; });
`,
);
await writeFile(
  join(out, 'index.html'),
  `<!doctype html><html lang="tr"><head><meta charset="UTF-8"><meta http-equiv="Content-Security-Policy" content="${csp}"></head><body><script type="module" src="./renderer.ts"></script></body></html>`,
);
const loaded = await loadConfigFromFile(
  { command: 'build', mode: 'production' },
  resolve('vite.config.ts'),
);
if (!loaded) throw new Error('Vite configuration unavailable.');
await viteBuild({
  ...loaded.config,
  configFile: false,
  mode: 'production',
  root: out,
  publicDir: false,
  build: { outDir: join(out, 'ui'), emptyOutDir: true },
  logLevel: 'error',
});
const assets = {};
for (const name of await readdir(join(out, 'ui/assets')))
  assets[name] = (await stat(join(out, 'ui/assets', name))).size;
await writeFile(
  join(out, 'preload.cjs'),
  `const {contextBridge}=require('electron');contextBridge.exposeInMainWorld('rooms',{locale:{preference:'tr',resolved:'tr'}});`,
);
await writeFile(
  join(out, 'main.ts'),
  `
import {app,BrowserWindow,session} from 'electron';import {isRendererPermissionAllowed} from '${root}/apps/desktop/electron/permissions';
app.setPath('userData',${JSON.stringify(join(out, 'profile'))});
const page=new URL('file://'+__dirname+'/ui/index.html').href;
const isTrusted=(url:string)=>url.split('#')[0]===page;
const g=globalThis as any;g.__permissionLog=[];g.__phase='current';
// 'baseline' replays the handler as it was before the spike: the same predicate without 'midi'.
// 'sysex-experiment' grants midiSysex in this harness only, to record what such a grant would expose.
const allowed=(permission:string,context:Parameters<typeof isRendererPermissionAllowed>[1])=>(g.__phase==='sysex-experiment'&&permission==='midiSysex')||(!(g.__phase==='baseline'&&permission==='midi')&&isRendererPermissionAllowed(permission,context));
app.whenReady().then(()=>{
 const win=new BrowserWindow({show:false,width:800,height:600,webPreferences:{preload:__dirname+'/preload.cjs',contextIsolation:true,sandbox:true,nodeIntegration:false,webSecurity:true,backgroundThrottling:false}});
 const ctx=(contents:Electron.WebContents|null,details:{isMainFrame:boolean;requestingUrl?:string})=>{const ownWindow=!!contents&&contents===win.webContents;return {isMainFrame:details.isMainFrame,requestingUrl:details.requestingUrl,contentsUrl:ownWindow?contents.getURL():'',ownWindow,isTrusted};};
 session.defaultSession.setPermissionRequestHandler((contents,permission,callback,details)=>{const ok=allowed(permission,ctx(contents,details));g.__permissionLog.push({kind:'request',phase:g.__phase,permission,ok});callback(ok);});
 session.defaultSession.setPermissionCheckHandler((contents,permission,_origin,details)=>{const ok=allowed(permission,ctx(contents,details));g.__permissionLog.push({kind:'check',phase:g.__phase,permission,ok});return ok;});
 void win.loadFile(__dirname+'/ui/index.html');
});
`,
);
await build({
  entryPoints: [join(out, 'main.ts')],
  outfile: join(out, 'main.cjs'),
  bundle: true,
  platform: 'node',
  format: 'cjs',
  external: ['electron'],
  logLevel: 'error',
});
const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;
const result = {
  scope:
    'Engine core in a production vite build under the real CSP and permission predicate; muted output; excludes MIDI hardware, packaged app, Windows and two-client sync',
  status: 'FAIL',
  platform: process.platform,
  csp,
  assets,
};
const app = await electron.launch({ args: [join(out, 'main.cjs')], env });
try {
  result.versions = await app.evaluate(() => ({
    electron: process.versions.electron,
    chrome: process.versions.chrome,
  }));
  const page = await app.firstWindow();
  page.on('console', (message) => {
    if (message.type() === 'error') console.log('QA renderer: ' + message.text());
  });
  await page.waitForFunction(() => !!window.__studio, null, { timeout: 120000 });
  Object.assign(result, await page.evaluate(() => window.__studio));
  await writeFile(
    join(out, 'demo-4bars.wav'),
    Buffer.from(await page.evaluate(() => window.__wav ?? ''), 'base64'),
  );
  const midi = {};
  for (const phase of ['baseline', 'current', 'sysex-experiment']) {
    await app.evaluate((_electron, value) => {
      globalThis.__phase = value;
    }, phase);
    midi[phase] = await page.evaluate(() => window.__midi(false));
    if (phase === 'current') midi.sysex = await page.evaluate(() => window.__midi(true));
  }
  midi.permissionLog = await app.evaluate(() => globalThis.__permissionLog);
  result.midi = midi;
  assert.equal(result.fatal, undefined, String(result.fatal));
  for (const part of ['drums', 'bass', 'chords', 'mix'])
    assert.ok(result.rms[part] > 0.01, `${part} is silent (RMS ${result.rms[part]})`);
  assert.equal(result.wav.decodedChannels, 2);
  assert.equal(result.wav.decodedFrames, result.wav.frames);
  assert.ok(result.wav.decodedRms > 0.01, 'decoded WAV is silent');
  assert.ok(
    result.mvpEffectsOffline.ok && result.mvpEffectsOffline.value.rms > 0.01,
    'MVP effects',
  );
  assert.ok(
    result.live.ok && result.live.value.playedNotes > 0,
    'live playback triggered no notes',
  );
  // The app predicate never grants midiSysex (Web MIDI itself is reported, not asserted: see status note).
  assert.equal(result.midi.sysex.ok, false, 'MIDI SysEx must stay denied');
  assert.ok(
    midi.permissionLog.every(
      (entry) =>
        entry.permission !== 'midiSysex' || entry.phase === 'sysex-experiment' || !entry.ok,
    ),
  );
  result.status = 'PASS';
} finally {
  await app.close();
  await writeFile(join(out, 'result.json'), JSON.stringify(result, null, 2));
  console.log(JSON.stringify({ ...result, csp: undefined }, null, 1));
}
