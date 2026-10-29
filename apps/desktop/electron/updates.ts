import { app, ipcMain } from 'electron';
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { createRequire } from 'node:module';
import { autoUpdater } from 'electron-updater';
import { t } from '@rooms/i18n';
import {
  parseUpdateConfig,
  selectUpdatePlatform,
  updateReasonText,
  type UpdateConfig,
  type UpdateEngine,
  type UpdateReason,
} from './update-platform';
export interface UpdateStatus {
  enabled: boolean;
  configured: boolean;
  /** Sparkle checks a publisher signature; the Windows NSIS updater checks the release's SHA-512. */
  engine?: UpdateEngine | null;
  state:
    | 'unavailable'
    | 'idle'
    | 'checking'
    | 'available'
    | 'downloading'
    | 'verifying'
    | 'ready'
    | 'error';
  version: string | null;
  progress: number;
  reason: string | null;
  releaseNotes?: string[];
}
type Bind = (name: string, fn: (...args: any[]) => unknown) => void;
/** Windows checks this long after launch, then on this interval (Sparkle's default is daily). */
export const WINDOWS_FIRST_CHECK_MS = 30_000;
export const WINDOWS_CHECK_INTERVAL_MS = 6 * 60 * 60_000;
export function setupUpdates(assertSender: (e: Electron.IpcMainInvokeEvent) => void) {
  const file = join(app.getPath('userData'), 'updates.json');
  let enabled = false;
  try {
    enabled = JSON.parse(readFileSync(file, 'utf8')).enabled === true;
  } catch {
    /* Updates start opt-out. */
  }
  let config: UpdateConfig | null = null;
  let signed = false;
  try {
    config = parseUpdateConfig(
      JSON.parse(readFileSync(join(__dirname, '../dist/update-config.json'), 'utf8')),
    );
    if (config?.teamId && app.isPackaged && process.platform === 'darwin') {
      const bundle = join(process.resourcesPath, '../..');
      const verification = spawnSync(
        '/usr/bin/codesign',
        ['--verify', '--deep', '--strict', bundle],
        { encoding: 'utf8', timeout: 10000 },
      );
      const details = spawnSync('/usr/bin/codesign', ['-dv', '--verbose=4', bundle], {
        encoding: 'utf8',
        timeout: 10000,
      });
      signed =
        verification.status === 0 &&
        details.stderr.includes('Authority=Developer ID Application:') &&
        details.stderr.includes(`TeamIdentifier=${config.teamId}`);
    }
  } catch {
    /* Only signed, packaged configuration enables updates. */
  }
  let windowsUpdateYml = false,
    windowsInstalled = false;
  if (process.platform === 'win32' && app.isPackaged) {
    try {
      windowsUpdateYml = existsSync(join(process.resourcesPath, 'app-update.yml'));
      windowsInstalled = readdirSync(dirname(process.execPath)).some((name) =>
        /^Uninstall .+\.exe$/i.test(name),
      );
    } catch {
      /* An unreadable install folder cannot be updated in place. */
    }
  }
  const selection = selectUpdatePlatform({
    platform: process.platform,
    isPackaged: app.isPackaged,
    config,
    macSigned: signed,
    windowsUpdateYml,
    windowsInstalled,
  });
  const configured = selection.engine !== null;
  const bind: Bind = (name, fn) =>
    ipcMain.handle(`rooms:update-${name}`, (event, ...args) => {
      assertSender(event);
      return fn(...args);
    });
  if (selection.engine === 'nsis') return setupWindowsUpdates(file, config!.feed, bind);
  const status: UpdateStatus = {
    enabled,
    configured,
    engine: selection.engine,
    state: configured ? 'idle' : 'unavailable',
    version: null,
    progress: 0,
    reason: null,
  };
  // Sparkle owns macOS update UI, signature checks and atomic installation.
  if (configured && process.platform === 'darwin') {
    try {
      const requireNative = createRequire(__filename);
      const sparkle = requireNative(join(process.resourcesPath, 'native/rooms-sparkle.node')) as {
        start(): boolean;
        check(): void;
        enable(value: boolean): void;
        status(): { state: UpdateStatus['state']; version: string | null };
        /** Installs a downloaded update and relaunches; false when nothing is waiting. */
        install(): boolean;
      };
      if (!sparkle.start()) throw new Error('Sparkle initialization failed');
      // Owner requested automatic updates; subsequent explicit opt-out is preserved.
      let migrated = false;
      try {
        migrated = JSON.parse(readFileSync(file, 'utf8')).sparkleMigrated === true;
      } catch {}
      if (!migrated) {
        enabled = true;
        writeFileSync(file, JSON.stringify({ enabled: true, sparkleMigrated: true }), {
          mode: 0o600,
        });
      }
      status.enabled = enabled;
      sparkle.enable(enabled);
      const snapshot = () => ({ ...status, ...sparkle.status() });
      const bindNative = (name: string, fn: (...args: any[]) => unknown) =>
        ipcMain.handle(`rooms:update-${name}`, (event, ...args) => {
          assertSender(event);
          return fn(...args);
        });
      bindNative('status', snapshot);
      bindNative('opt-in', (value) => {
        if (typeof value !== 'boolean') throw new Error('Invalid update preference');
        status.enabled = value;
        sparkle.enable(value);
        writeFileSync(file, JSON.stringify({ enabled: value, sparkleMigrated: true }), {
          mode: 0o600,
        });
        return snapshot();
      });
      for (const name of ['check', 'download', 'install'])
        bindNative(name, () => {
          if (!status.enabled) throw new Error('Enable updates first');
          // A waiting download installs and relaunches at once; otherwise Sparkle shows its own window.
          if (name !== 'install' || !sparkle.install()) sparkle.check();
          return snapshot();
        });
      bindNative('cancel', () => snapshot());
      return;
    } catch {
      status.configured = false;
      status.state = 'unavailable';
      status.reason = 'Sparkle could not start. Reinstall the signed application.';
      for (const name of ['status', 'opt-in', 'cancel'])
        ipcMain.handle(`rooms:update-${name}`, (event) => {
          assertSender(event);
          return { ...status };
        });
      for (const name of ['check', 'download', 'install'])
        ipcMain.handle(`rooms:update-${name}`, (event) => {
          assertSender(event);
          throw new Error(status.reason!);
        });
      return;
    }
  }
  // No updater on this machine: every action explains why instead of failing silently.
  const unavailable = () => ({ ...status, reason: updateReasonText(selection.reason!) });
  bind('status', unavailable);
  bind('opt-in', (value) => {
    if (typeof value !== 'boolean') throw new Error('Invalid update preference.');
    status.enabled = value;
    writeFileSync(file, JSON.stringify({ enabled: value }), { mode: 0o600 });
    return unavailable();
  });
  for (const name of ['check', 'download', 'cancel', 'install'])
    bind(name, () => {
      throw new Error(updateReasonText(selection.reason!));
    });
}

/**
 * Windows (NSIS) updates through electron-updater: `latest.yml` from the same "latest release"
 * feed as the macOS appcast, SHA-512 checked by electron-updater before `update-downloaded`,
 * then a silent reinstall into the same folder on restart or on quit.
 */
function setupWindowsUpdates(file: string, feed: string, bind: Bind) {
  let prefs: { enabled?: unknown; autoMigrated?: unknown } = {};
  try {
    prefs = JSON.parse(readFileSync(file, 'utf8'));
  } catch {
    /* First launch with updates. */
  }
  // Automatic like macOS (the owner asked for automatic updates); a later opt-out is kept.
  let enabled = prefs.enabled === true;
  const persist = (value: boolean) =>
    writeFileSync(file, JSON.stringify({ enabled: value, autoMigrated: true }), { mode: 0o600 });
  if (prefs.autoMigrated !== true) {
    enabled = true;
    persist(true);
  }
  const status: UpdateStatus = {
    enabled,
    configured: true,
    engine: 'nsis',
    state: 'idle',
    version: null,
    progress: 0,
    reason: null,
  };
  let failure: UpdateReason | null = null;
  let updateResult: Awaited<ReturnType<typeof autoUpdater.checkForUpdates>> = null;
  // A cancelled download is not restarted by the next automatic check in this session.
  let cancelled = false;
  const applyPreference = () => {
    autoUpdater.autoDownload = status.enabled && !cancelled;
    autoUpdater.autoInstallOnAppQuit = status.enabled;
  };
  autoUpdater.logger = null;
  autoUpdater.allowDowngrade = false;
  autoUpdater.allowPrerelease = false;
  // `latest/download/` always names the newest release, which has no older blockmap to diff.
  autoUpdater.disableDifferentialDownload = true;
  autoUpdater.autoRunAppAfterInstall = true;
  // The release workflow pins the channel: a prerelease version would otherwise ask for rc.yml.
  autoUpdater.setFeedURL({ provider: 'generic', url: feed, channel: 'latest' });
  applyPreference();
  const snapshot = (): UpdateStatus => ({
    ...status,
    reason: failure ? updateReasonText(failure) : null,
    releaseNotes: status.releaseNotes ? [...status.releaseNotes] : undefined,
  });
  autoUpdater.on('checking-for-update', () => {
    status.state = 'checking';
    failure = null;
  });
  autoUpdater.on('update-available', (info) => {
    status.state = autoUpdater.autoDownload ? 'downloading' : 'available';
    status.version = info.version;
    status.progress = 0;
    status.releaseNotes = (
      typeof info.releaseNotes === 'string'
        ? [info.releaseNotes]
        : (info.releaseNotes ?? []).map((note) => note.note)
    )
      .filter((note): note is string => typeof note === 'string')
      .slice(0, 20)
      .map((note) => note.slice(0, 4000));
  });
  autoUpdater.on('update-not-available', () => {
    status.state = 'idle';
    status.version = null;
  });
  autoUpdater.on('download-progress', (p) => {
    status.state = 'downloading';
    status.progress = Math.round(p.percent);
  });
  // electron-updater emits this only after the file matched the SHA-512 in latest.yml.
  autoUpdater.on('update-downloaded', (info) => {
    status.state = 'ready';
    status.version = info.version;
    status.progress = 100;
    failure = null;
  });
  autoUpdater.on('error', (error) => {
    if (updateResult?.cancellationToken?.cancelled || status.state === 'ready') return;
    // The Latest release carries no Windows metadata (e.g. a macOS-only hotfix): nothing to offer.
    if ((error as { code?: unknown } | null)?.code === 'ERR_UPDATER_CHANNEL_FILE_NOT_FOUND') {
      status.state = 'idle';
      status.version = null;
      return;
    }
    status.state = 'error';
    failure = 'failed';
  });
  const check = async () => {
    if (['checking', 'downloading', 'ready'].includes(status.state)) return;
    // A token cancelled earlier must not hide this check's errors.
    updateResult = null;
    try {
      updateResult = await autoUpdater.checkForUpdates();
      // Download failures arrive as the error event; the promise must not go unhandled.
      void updateResult?.downloadPromise?.catch(() => undefined);
    } catch {
      // The error event normally set the state already; never stay "checking".
      if (status.state === 'checking') {
        status.state = 'error';
        failure = 'failed';
      }
    }
  };
  const automatic = () => {
    if (status.enabled) void check();
  };
  setTimeout(automatic, WINDOWS_FIRST_CHECK_MS).unref?.();
  setInterval(automatic, WINDOWS_CHECK_INTERVAL_MS).unref?.();
  bind('status', snapshot);
  bind('opt-in', (value) => {
    if (typeof value !== 'boolean') throw new Error('Invalid update preference.');
    status.enabled = value;
    persist(value);
    applyPreference();
    return snapshot();
  });
  bind('check', async () => {
    if (!status.enabled) throw new Error(t('Önce otomatik güncellemeleri etkinleştir.'));
    await check();
    return snapshot();
  });
  bind('download', async () => {
    if (!status.enabled || status.state !== 'available')
      throw new Error(t('İndirilecek güncelleme yok. Önce güncellemeleri kontrol et.'));
    if (!updateResult?.cancellationToken || updateResult.cancellationToken.cancelled)
      throw new Error(t('İndirmeden önce güncellemeleri yeniden kontrol et.'));
    status.state = 'downloading';
    try {
      await autoUpdater.downloadUpdate(updateResult.cancellationToken);
    } catch {
      /* The error event already set the state. */
    }
    return snapshot();
  });
  bind('cancel', () => {
    if (status.state !== 'downloading' || !updateResult?.cancellationToken)
      throw new Error(t('Süren bir güncelleme indirmesi yok.'));
    updateResult.cancellationToken.cancel();
    cancelled = true;
    applyPreference();
    status.state = 'idle';
    status.version = null;
    status.progress = 0;
    failure = null;
    return snapshot();
  });
  bind('install', () => {
    if (!status.enabled || status.state !== 'ready')
      throw new Error(t('Önce güncellemenin inip doğrulanması gerekiyor.'));
    // Silent: the assisted installer would otherwise reopen its wizard; it keeps the install folder.
    autoUpdater.quitAndInstall(true, true);
  });
}
