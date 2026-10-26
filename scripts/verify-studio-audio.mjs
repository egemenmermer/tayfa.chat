// Studio audio engine check: the real engine, built with the app's vite config in production mode and served
// under the real index.html CSP from file:// (as the packaged app loads it), in Electron with the app's renderer
// permission predicate. Renders a Contract-v1 project (template 'drums-bass' plus a piano part) offline, checks
// every track is audible on its own (solo), the WAV export decodes, progress/cancel, effects, an unknown
// instrument report, and a live update while playing; records clock/latency/MIDI findings in
// .local/studio-audio-check. Output is muted; no account, server or network is used.
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
  join(out, 'renderer.ts'),
  `
import {applyOps, createProject, defaultTrack, type StudioProject} from '@rooms/studio';
import {createStudioEngine} from '${root}/apps/desktop/src/studio/engine/engine';
import {encodeWav, rms} from '${root}/apps/desktop/src/studio/engine/wav';
const violations: unknown[] = [];
const rejections: string[] = [];
document.addEventListener('securitypolicyviolation', (e) => violations.push({directive: e.effectiveDirective, blocked: e.blockedURI}));
addEventListener('unhandledrejection', (e) => rejections.push(String((e.reason && e.reason.message) || e.reason)));
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const settle = async (fn: () => Promise<unknown>) => { try { return {ok: true, value: await fn()}; } catch (e) { return {ok: false, error: String((e as Error)?.name + ': ' + ((e as Error)?.message || e))}; } };
(window as any).__midi = (sysex: boolean) => settle(async () => { const access = await navigator.requestMIDIAccess({sysex}); return {inputs: access.inputs.size, outputs: access.outputs.size, sysexEnabled: access.sysexEnabled}; });
const setTrack = (p: StudioProject, id: string, patch: Partial<StudioProject['tracks'][string]>): StudioProject => ({...p, tracks: {...p.tracks, [id]: {...p.tracks[id], ...patch}}});
function project(): StudioProject {
  const base = createProject({id: 'verify', roomId: 'room', name: 'Verify', createdBy: 'qa', createdAt: 1, template: 'drums-bass'});
  const chords = [[60, 64, 67], [57, 60, 64], [53, 57, 60], [55, 59, 62]];
  const result = applyOps(base, [
    {op: 'track.create', track: defaultTrack('piano', 'instrument', {color: 7})},
    {op: 'clip.create', clip: {id: 'piano-clip', trackId: 'piano', startBeat: 0, lengthBeats: 16, name: '', kind: 'midi'}},
    ...chords.flatMap((pitches, bar) => pitches.map((pitch, i) => ({op: 'note.create' as const, note: {id: 'pn' + bar + '-' + i, clipId: 'piano-clip', pitch, startBeat: bar * 4, lengthBeats: 3.5, velocity: 90}}))),
  ]);
  if (result.skipped.length) throw new Error('verify project ops skipped: ' + JSON.stringify(result.skipped));
  return result.doc;
}
async function run() {
  const r: Record<string, unknown> = {};
  const doc = project();
  const engine = await createStudioEngine();
  const Tone = await import('tone');
  r.toneVersion = Tone.version;
  r.clock = engine.stats().clockSource;
  r.lookAhead = engine.stats().lookAhead;
  const timings: number[] = [];
  const progress: number[] = [];
  let full: Awaited<ReturnType<typeof engine.renderOffline>> | null = null;
  for (let i = 0; i < 2; i += 1) {
    const started = performance.now();
    full = await engine.renderOffline(doc, i ? {} : {onProgress: (f) => progress.push(Math.round(f * 100) / 100)});
    timings.push(Math.round(performance.now() - started));
  }
  r.renderMs = timings;
  r.range = full!.range;
  r.renderSeconds = full!.channels[0].length / full!.sampleRate;
  r.progress = {count: progress.length, first: progress[0], last: progress.at(-1), monotonic: progress.every((v, i) => !i || v >= progress[i - 1])};
  r.issues = full!.plan.issues;
  const levels: Record<string, number> = {mix: rms(full!.channels)};
  r.peak = Math.max(...full!.channels.map((c) => c.reduce((m, v) => Math.max(m, Math.abs(v)), 0)));
  for (const id of doc.trackOrder) levels[id] = rms((await engine.renderOffline(setTrack(doc, id, {solo: true}))).channels);
  r.rms = levels;
  const wav = encodeWav(full!.channels, full!.sampleRate);
  const decoded = await new OfflineAudioContext(2, 1, full!.sampleRate).decodeAudioData(wav.slice().buffer);
  r.wav = {bytes: wav.length, decodedChannels: decoded.numberOfChannels, decodedFrames: decoded.length, frames: full!.channels[0].length, decodedRms: rms([decoded.getChannelData(0), decoded.getChannelData(1)])};
  let binary = ''; for (let i = 0; i < wav.length; i += 0x8000) binary += String.fromCharCode(...wav.subarray(i, i + 0x8000));
  (window as any).__wav = btoa(binary);
  r.rangeExport = await settle(async () => { const part = await engine.renderOffline(doc, {fromBeat: 4, toBeat: 8}); return {seconds: part.channels[0].length / part.sampleRate, range: part.range, rms: rms(part.channels)}; });
  r.cancel = await settle(async () => { const abort = new AbortController(); await engine.renderOffline(doc, {signal: abort.signal, onProgress: () => abort.abort()}); return 'not canceled'; });
  r.effects = await settle(async () => { const wet = setTrack(setTrack(doc, 'tpl-bass', {sends: {reverb: 0.5, delay: 0.4}, eq: {low: 4, mid: -3, high: 2}, pan: -0.5}), 'piano', {sends: {reverb: 0.6, delay: 0}}); const b = await engine.renderOffline(wet); return {tail: b.range.tailSeconds, seconds: b.channels[0].length / b.sampleRate, rms: rms(b.channels)}; });
  r.unknownInstrument = await settle(async () => { const b = await engine.renderOffline(setTrack(doc, 'piano', {instrument: 'baglama@1'})); return {issues: b.plan.issues, rms: rms(b.channels)}; });
  // Live playback, muted: the transport keeps running across a document update (notes + tempo change).
  Tone.getDestination().mute = true;
  r.live = await settle(async () => {
    const positions: number[] = [];
    const off = engine.onPosition((beat) => positions.push(beat));
    await engine.load(doc);
    await engine.play();
    await sleep(1200);
    const before = engine.stats();
    const beatBefore = engine.position();
    const edited = applyOps({...doc, tempo: 140}, [{op: 'note.create', note: {id: 'live-add', clipId: 'piano-clip', pitch: 72, startBeat: 3, lengthBeats: 1, velocity: 100}}]).doc;
    await engine.load(edited);
    const stateAfterUpdate = Tone.getTransport().state;
    const bpmAfterUpdate = Math.round(Tone.getTransport().bpm.value);
    await sleep(1200);
    const after = engine.stats();
    const beatAfter = engine.position();
    engine.setMetronome(true);
    engine.setLoop({startBeat: 0, endBeat: 4});
    await sleep(800);
    const looped = engine.position();
    engine.stop();
    off();
    return {...after, playedBefore: before.playedNotes, reschedulesBefore: before.reschedules, beatBefore, beatAfter, looped, stateAfterUpdate, bpmAfterUpdate, positionEvents: positions.length, playing: engine.playing()};
  });
  r.nativeLatency = await settle(async () => { const c = new AudioContext({latencyHint: 'interactive'}); await c.resume(); await sleep(400); const v = {state: c.state, sampleRate: c.sampleRate, baseLatency: c.baseLatency, outputLatency: c.outputLatency}; await c.close(); return v; });
  engine.dispose();
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
    'Studio engine on a Contract-v1 project in a production vite build under the real CSP and permission predicate; muted output; excludes audible listening, MIDI hardware, packaged app, Windows and two-client sync',
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
    join(out, 'drums-bass-piano.wav'),
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
  for (const part of ['tpl-drums', 'tpl-bass', 'piano', 'mix'])
    assert.ok(result.rms[part] > 0.01, `${part} is silent (RMS ${result.rms[part]})`);
  assert.deepEqual(result.issues, []);
  assert.equal(result.wav.decodedChannels, 2);
  assert.equal(result.wav.decodedFrames, result.wav.frames);
  assert.ok(result.wav.decodedRms > 0.01, 'decoded WAV is silent');
  assert.ok(Math.abs(result.renderSeconds - result.range.totalSeconds) < 0.01, 'render length');
  assert.ok(
    result.progress.count > 2 && result.progress.last === 1 && result.progress.monotonic,
    'progress',
  );
  assert.ok(result.rangeExport.ok && result.rangeExport.value.rms > 0.01, 'range export');
  assert.ok(
    Math.abs(result.rangeExport.value.seconds - (2 + result.rangeExport.value.range.tailSeconds)) <
      0.01,
  );
  assert.ok(
    !result.cancel.ok && /AbortError/.test(result.cancel.error),
    `cancel: ${JSON.stringify(result.cancel)}`,
  );
  assert.ok(
    result.effects.ok && result.effects.value.rms > 0.01 && result.effects.value.tail > 3,
    'effects',
  );
  assert.ok(result.unknownInstrument.ok, 'unknown instrument render');
  assert.ok(
    result.unknownInstrument.value.issues.some(
      (issue) => issue.kind === 'unknown-instrument' && issue.id === 'baglama@1',
    ),
    'unknown instrument not reported',
  );
  assert.ok(result.unknownInstrument.value.rms > 0.01, 'other tracks still play');
  assert.ok(result.live.ok, `live: ${result.live.error}`);
  const live = result.live.value;
  assert.ok(live.playedBefore > 0, 'live playback triggered no notes');
  assert.equal(live.stateAfterUpdate, 'started', 'transport stopped on update');
  assert.equal(live.bpmAfterUpdate, 140);
  assert.ok(live.reschedules > live.reschedulesBefore, 'update did not reschedule');
  assert.ok(live.playedNotes > live.playedBefore, 'no notes after the update');
  assert.ok(live.beatAfter > live.beatBefore, 'playhead did not advance');
  assert.ok(live.looped < 4, 'loop region not applied');
  assert.ok(live.positionEvents > 10 && live.positionEvents <= 31 * 3.3, 'position rate');
  assert.equal(live.triggerErrors, 0);
  assert.equal(live.playing, false);
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
