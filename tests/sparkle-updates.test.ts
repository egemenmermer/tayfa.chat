import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { setupUpdates } from '../apps/desktop/electron/updates';

const fixture = vi.hoisted(() => ({
  prefs: {} as { enabled?: boolean; sparkleMigrated?: boolean },
  handlers: new Map<string, (event: unknown, ...args: unknown[]) => unknown>(),
  writes: [] as string[],
  native: {
    start: vi.fn(() => true),
    check: vi.fn(),
    enable: vi.fn(),
    status: vi.fn(() => ({ state: 'idle', version: null })),
    install: vi.fn(() => false),
  },
}));
vi.mock('electron', () => ({
  app: { isPackaged: true, getPath: () => '/isolated-profile' },
  ipcMain: {
    handle: (name: string, handler: (...args: unknown[]) => unknown) =>
      fixture.handlers.set(name, handler),
  },
  autoUpdater: {},
}));
vi.mock('electron-updater', () => ({ autoUpdater: {} }));
vi.mock('node:module', () => ({ createRequire: () => () => fixture.native }));
vi.mock('node:child_process', () => ({
  spawnSync: (_command: string, args: string[]) => ({
    status: 0,
    stderr: args.includes('-dv')
      ? 'Authority=Developer ID Application: Test\nTeamIdentifier=TESTTEAM01'
      : '',
  }),
}));
vi.mock('node:fs', () => ({
  readFileSync: (path: string) =>
    JSON.stringify(
      path.endsWith('update-config.json')
        ? { feed: 'https://updates.test/', teamId: 'TESTTEAM01' }
        : fixture.prefs,
    ),
  writeFileSync: (_path: string, value: string) => fixture.writes.push(value),
}));
const originalPlatform = Object.getOwnPropertyDescriptor(process, 'platform')!;
const originalResourcesPath = Object.getOwnPropertyDescriptor(process, 'resourcesPath');
beforeEach(() => {
  Object.defineProperty(process, 'platform', { value: 'darwin', configurable: true });
  vi.stubGlobal('__filename', '/signed/main.cjs');
  vi.stubGlobal('__dirname', '/signed');
  Object.defineProperty(process, 'resourcesPath', {
    value: '/signed/Contents/Resources',
    configurable: true,
  });
  fixture.handlers.clear();
  fixture.writes = [];
  fixture.prefs = {};
  vi.clearAllMocks();
  fixture.native.start.mockReturnValue(true);
});
afterEach(() => {
  Object.defineProperty(process, 'platform', originalPlatform);
  vi.unstubAllGlobals();
  if (originalResourcesPath) Object.defineProperty(process, 'resourcesPath', originalResourcesPath);
  else Reflect.deleteProperty(process, 'resourcesPath');
});
const invoke = (name: string, ...args: unknown[]) =>
  fixture.handlers.get('rooms:update-' + name)!({}, ...args);

it('migrates automatic updates once and routes user check through native Sparkle', () => {
  const sender = vi.fn();
  setupUpdates(sender);
  expect(invoke('status')).toMatchObject({ configured: true, enabled: true, state: 'idle' });
  expect(JSON.parse(fixture.writes[0]!)).toEqual({ enabled: true, sparkleMigrated: true });
  invoke('check');
  expect(fixture.native.check).toHaveBeenCalledOnce();
  expect(sender).toHaveBeenCalledTimes(2);
});
it('installs a downloaded update at once and otherwise lets Sparkle present it', () => {
  setupUpdates(vi.fn());
  fixture.native.install.mockReturnValueOnce(true);
  invoke('install');
  expect(fixture.native.install).toHaveBeenCalledOnce();
  expect(fixture.native.check).not.toHaveBeenCalled();
  invoke('install');
  expect(fixture.native.check).toHaveBeenCalledOnce();
  invoke('check');
  expect(fixture.native.install).toHaveBeenCalledTimes(2);
});
it('preserves a migrated explicit opt-out and blocks checking until enabled', () => {
  fixture.prefs = { enabled: false, sparkleMigrated: true };
  setupUpdates(vi.fn());
  expect(fixture.native.enable).toHaveBeenCalledWith(false);
  expect(fixture.writes).toHaveLength(0);
  expect(() => invoke('check')).toThrow('Enable updates first');
  expect(fixture.native.check).not.toHaveBeenCalled();
  invoke('opt-in', true);
  invoke('check');
  expect(fixture.native.check).toHaveBeenCalledOnce();
});
it('rejects invalid preference input without changing native or persisted state', () => {
  fixture.prefs = { enabled: true, sparkleMigrated: true };
  setupUpdates(vi.fn());
  expect(() => invoke('opt-in', 'yes')).toThrow('Invalid update preference');
  expect(fixture.writes).toHaveLength(0);
  expect(fixture.native.enable).toHaveBeenCalledTimes(1);
});
it('fails closed if the native updater cannot start', () => {
  fixture.native.start.mockReturnValue(false);
  setupUpdates(vi.fn());
  expect(invoke('status')).toMatchObject({ configured: false, state: 'unavailable' });
  expect(() => invoke('install')).toThrow('Sparkle could not start');
  expect(fixture.native.check).not.toHaveBeenCalled();
});
it('rejects an untrusted sender before invoking the native updater', () => {
  setupUpdates(() => {
    throw new Error('Untrusted IPC sender');
  });
  expect(() => invoke('check')).toThrow('Untrusted IPC sender');
  expect(fixture.native.check).not.toHaveBeenCalled();
});

it('does not start native Mac updates on a non-Mac platform', () => {
  Object.defineProperty(process, 'platform', { value: 'linux', configurable: true });
  setupUpdates(vi.fn());
  expect(invoke('status')).toMatchObject({ configured: false, state: 'unavailable' });
  expect(invoke('status').reason).toContain('macOS ve Windows');
  expect(fixture.native.start).not.toHaveBeenCalled();
  expect(() => invoke('check')).toThrow('macOS ve Windows');
});
