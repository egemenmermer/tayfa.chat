import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import {
  setupUpdates,
  WINDOWS_CHECK_INTERVAL_MS,
  WINDOWS_FIRST_CHECK_MS,
} from '../apps/desktop/electron/updates';

const FEED = 'https://github.com/egemenmermer/tayfa/releases/latest/download/';
const fixture = vi.hoisted(() => {
  const listeners = new Map<string, ((...args: any[]) => void)[]>();
  const updater = {
    autoDownload: undefined as boolean | undefined,
    autoInstallOnAppQuit: undefined as boolean | undefined,
    allowPrerelease: undefined as boolean | undefined,
    allowDowngrade: undefined as boolean | undefined,
    on(name: string, fn: (...args: any[]) => void) {
      listeners.set(name, [...(listeners.get(name) ?? []), fn]);
      return updater;
    },
    emit(name: string, ...args: unknown[]) {
      for (const fn of listeners.get(name) ?? []) fn(...args);
    },
    setFeedURL: vi.fn(),
    checkForUpdates: vi.fn(),
    downloadUpdate: vi.fn(),
    quitAndInstall: vi.fn(),
  };
  return {
    listeners,
    updater,
    handlers: new Map<string, (event: unknown, ...args: unknown[]) => unknown>(),
    isPackaged: true,
    prefs: {} as Record<string, unknown>,
    writes: [] as string[],
    config: null as unknown,
    appUpdateYml: true,
    uninstaller: true,
    codesignStatus: 0,
    nativeLoaded: vi.fn(),
  };
});
vi.mock('electron', () => ({
  app: {
    get isPackaged() {
      return fixture.isPackaged;
    },
    getPath: () => '/isolated-profile',
  },
  ipcMain: {
    handle: (name: string, handler: (...args: unknown[]) => unknown) =>
      fixture.handlers.set(name, handler),
  },
}));
vi.mock('electron-updater', () => ({ autoUpdater: fixture.updater }));
vi.mock('node:module', () => ({ createRequire: () => fixture.nativeLoaded }));
vi.mock('node:child_process', () => ({
  spawnSync: () => ({ status: fixture.codesignStatus, stderr: '' }),
}));
vi.mock('node:fs', () => ({
  readFileSync: (path: string) => {
    if (!path.endsWith('update-config.json')) return JSON.stringify(fixture.prefs);
    if (fixture.config === null) throw Object.assign(new Error('missing'), { code: 'ENOENT' });
    return JSON.stringify(fixture.config);
  },
  writeFileSync: (_path: string, value: string) => fixture.writes.push(value),
  existsSync: (path: string) => path.endsWith('app-update.yml') && fixture.appUpdateYml,
  readdirSync: () =>
    fixture.uninstaller ? ['ROOMS.exe', 'Uninstall ROOMS.exe', 'resources'] : ['ROOMS.exe'],
}));

const originalPlatform = Object.getOwnPropertyDescriptor(process, 'platform')!;
const originalResourcesPath = Object.getOwnPropertyDescriptor(process, 'resourcesPath');
const token = () => ({
  cancelled: false,
  cancel: vi.fn(function (this: { cancelled: boolean }) {
    this.cancelled = true;
  }),
});
beforeEach(() => {
  vi.useFakeTimers();
  Object.defineProperty(process, 'platform', { value: 'win32', configurable: true });
  Object.defineProperty(process, 'resourcesPath', {
    value: 'C:\\Tayfa\\resources',
    configurable: true,
  });
  vi.stubGlobal('__dirname', 'C:\\Tayfa\\resources\\app.asar\\dist-electron');
  fixture.listeners.clear();
  fixture.handlers.clear();
  fixture.writes = [];
  fixture.prefs = {};
  fixture.config = { feed: FEED };
  fixture.isPackaged = true;
  fixture.appUpdateYml = true;
  fixture.uninstaller = true;
  fixture.codesignStatus = 0;
  vi.clearAllMocks();
});
afterEach(() => {
  vi.clearAllTimers();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  Object.defineProperty(process, 'platform', originalPlatform);
  if (originalResourcesPath) Object.defineProperty(process, 'resourcesPath', originalResourcesPath);
  else Reflect.deleteProperty(process, 'resourcesPath');
});
const invoke = (name: string, ...args: unknown[]) =>
  fixture.handlers.get('rooms:update-' + name)!({}, ...args) as any;
const offer = (version = '0.1.18-rc.36') => {
  const cancellation = token();
  fixture.updater.checkForUpdates.mockImplementationOnce(async () => {
    fixture.updater.emit('checking-for-update');
    fixture.updater.emit('update-available', { version, releaseNotes: 'Windows updates' });
    return { cancellationToken: cancellation, downloadPromise: Promise.resolve([]) };
  });
  return cancellation;
};

it('runs the NSIS updater on an installed Windows build with automatic updates on once', () => {
  setupUpdates(vi.fn());
  expect(invoke('status')).toMatchObject({
    configured: true,
    engine: 'nsis',
    enabled: true,
    state: 'idle',
    reason: null,
  });
  expect(JSON.parse(fixture.writes[0]!)).toEqual({ enabled: true, autoMigrated: true });
  // Same "release marked Latest" rule as the macOS appcast; rc builds still read latest.yml.
  expect(fixture.updater.setFeedURL).toHaveBeenCalledWith({
    provider: 'generic',
    url: FEED,
    channel: 'latest',
  });
  expect(fixture.updater).toMatchObject({
    allowPrerelease: false,
    allowDowngrade: false,
    autoDownload: true,
    autoInstallOnAppQuit: true,
  });
});

it('moves checking → downloading → ready and installs silently with a relaunch', async () => {
  setupUpdates(vi.fn());
  expect(() => invoke('install')).toThrow('doğrulanması');
  fixture.updater.emit('checking-for-update');
  expect(invoke('status').state).toBe('checking');
  offer();
  expect(await invoke('check')).toMatchObject({
    state: 'downloading',
    version: '0.1.18-rc.36',
    progress: 0,
    releaseNotes: ['Windows updates'],
  });
  fixture.updater.emit('download-progress', { percent: 41.6 });
  expect(invoke('status')).toMatchObject({ state: 'downloading', progress: 42 });
  fixture.updater.emit('update-downloaded', { version: '0.1.18-rc.36' });
  expect(invoke('status')).toMatchObject({ state: 'ready', progress: 100, reason: null });
  // A later automatic check must not disturb a waiting install.
  await vi.advanceTimersByTimeAsync(WINDOWS_FIRST_CHECK_MS);
  expect(fixture.updater.checkForUpdates).toHaveBeenCalledTimes(1);
  invoke('install');
  expect(fixture.updater.quitAndInstall).toHaveBeenCalledWith(true, true);
});

it('cancels a download, then offers the update and downloads only on request', async () => {
  setupUpdates(vi.fn());
  const first = offer();
  await invoke('check');
  expect(invoke('cancel')).toMatchObject({ state: 'idle', version: null, progress: 0 });
  expect(first.cancel).toHaveBeenCalledOnce();
  expect(fixture.updater.autoDownload).toBe(false);
  // The cancellation surfaces as an updater error; it is not a failure.
  fixture.updater.emit('error', new Error('cancelled'));
  expect(invoke('status')).toMatchObject({ state: 'idle', reason: null });
  const second = offer();
  expect(await invoke('check')).toMatchObject({ state: 'available', version: '0.1.18-rc.36' });
  fixture.updater.downloadUpdate.mockResolvedValueOnce([]);
  expect(await invoke('download')).toMatchObject({ state: 'downloading' });
  expect(fixture.updater.downloadUpdate).toHaveBeenCalledWith(second);
  expect(() => invoke('cancel')).not.toThrow();
});

it('stays quiet when the Latest release has no latest.yml and reports real failures', async () => {
  setupUpdates(vi.fn());
  const fail = (error: Error) =>
    fixture.updater.checkForUpdates.mockImplementationOnce(async () => {
      fixture.updater.emit('checking-for-update');
      fixture.updater.emit('error', error);
      throw error;
    });
  fail(Object.assign(new Error('Cannot find channel "latest.yml"'), {
    code: 'ERR_UPDATER_CHANNEL_FILE_NOT_FOUND',
  }));
  expect(await invoke('check')).toMatchObject({ state: 'idle', version: null, reason: null });
  fail(new Error('sha512 checksum mismatch'));
  const failed = await invoke('check');
  expect(failed.state).toBe('error');
  expect(failed.reason).toContain('SHA-512');
  // A rejected check without an error event never leaves the UI spinning.
  fixture.updater.checkForUpdates.mockImplementationOnce(async () => {
    fixture.updater.emit('checking-for-update');
    throw new Error('network');
  });
  expect((await invoke('check')).state).toBe('error');
});

it('checks automatically after launch only while updates are enabled', async () => {
  fixture.prefs = { enabled: false, autoMigrated: true };
  setupUpdates(vi.fn());
  expect(fixture.writes).toHaveLength(0);
  expect(invoke('status')).toMatchObject({ enabled: false, state: 'idle' });
  expect(fixture.updater).toMatchObject({ autoDownload: false, autoInstallOnAppQuit: false });
  await vi.advanceTimersByTimeAsync(WINDOWS_FIRST_CHECK_MS);
  expect(fixture.updater.checkForUpdates).not.toHaveBeenCalled();
  await expect(invoke('check')).rejects.toThrow('otomatik güncellemeleri etkinleştir');
  expect(() => invoke('opt-in', 'yes')).toThrow('Invalid update preference');
  invoke('opt-in', true);
  expect(JSON.parse(fixture.writes[0]!)).toEqual({ enabled: true, autoMigrated: true });
  expect(fixture.updater).toMatchObject({ autoDownload: true, autoInstallOnAppQuit: true });
  fixture.updater.checkForUpdates.mockResolvedValueOnce(null);
  await vi.advanceTimersByTimeAsync(WINDOWS_CHECK_INTERVAL_MS);
  expect(fixture.updater.checkForUpdates).toHaveBeenCalledOnce();
});

it.each([
  ['an unpackaged run', () => (fixture.isPackaged = false), 'Geliştirme sürümü'],
  ['a build without a feed', () => (fixture.config = null), 'güncelleme adresi olmadan'],
  [
    'an HTTP feed',
    () => (fixture.config = { feed: 'http://github.com/o/r/releases/latest/download/' }),
    'güncelleme adresi olmadan',
  ],
  ['a build without app-update.yml', () => (fixture.appUpdateYml = false), 'güncelleme adresi'],
  ['a portable folder', () => (fixture.uninstaller = false), 'Kurulum yapılmadan'],
])('is unavailable with a reason for %s', (_name, arrange, reason) => {
  arrange();
  setupUpdates(vi.fn());
  expect(invoke('status')).toMatchObject({ configured: false, state: 'unavailable' });
  expect(invoke('status').reason).toContain(reason);
  for (const action of ['check', 'download', 'cancel', 'install'])
    expect(() => invoke(action)).toThrow(reason);
  expect(fixture.updater.setFeedURL).not.toHaveBeenCalled();
  expect(fixture.listeners.size).toBe(0);
});

it('leaves an unsigned macOS build unavailable with a reason and never loads Sparkle', () => {
  Object.defineProperty(process, 'platform', { value: 'darwin', configurable: true });
  fixture.config = { feed: 'https://updates.test/', teamId: 'TESTTEAM01' };
  fixture.codesignStatus = 1;
  setupUpdates(vi.fn());
  expect(invoke('status')).toMatchObject({ configured: false, state: 'unavailable' });
  expect(invoke('status').reason).toContain('İmzalı güncellemeler');
  expect(fixture.nativeLoaded).not.toHaveBeenCalled();
  expect(fixture.updater.setFeedURL).not.toHaveBeenCalled();
});

it('rejects an untrusted sender before touching the Windows updater', () => {
  setupUpdates(() => {
    throw new Error('Untrusted IPC sender');
  });
  expect(() => invoke('check')).toThrow('Untrusted IPC sender');
  expect(fixture.updater.checkForUpdates).not.toHaveBeenCalled();
});
