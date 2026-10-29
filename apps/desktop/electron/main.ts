import { setupPersonalVLC } from './personal-vlc';
import { isolatedProfilePath } from './profile';
import {
  app,
  BrowserWindow,
  dialog,
  globalShortcut,
  ipcMain,
  Menu,
  nativeImage,
  protocol,
  session,
  Tray,
  screen,
  shell,
} from 'electron';
import { readFileSync, writeFileSync, statSync, createReadStream } from 'node:fs';
import { join, basename } from 'node:path';
import { randomUUID } from 'node:crypto';
import { localMediaId } from './media-capabilities';
import { readCaptionFile, readSubtitleFile } from './caption-file';
import { Readable } from 'node:stream';
import { setupCommunity } from './community';
import { createStudioHttp } from './studio-http';
import { studioExportFileName, validateStudioExport } from './studio-export';
import { setupNotifications } from './notifications';
import { setupWindowPolicy } from './window-policy';
import { readWindowState, showRestored, showWindow, trackWindowState } from './window-state';
import { parseWatchPage } from './browser-video';
import { setupUpdates } from './updates';
import { setupProviders } from './providers';
import {
  inviteFromArgv,
  parseInviteLink,
  registerInviteProtocol,
  type InviteLink,
} from './native-links';
import { setupAgent } from './agent';
import { whiteboardSvg } from './whiteboard-export';
import { whiteboardPng } from './whiteboard-raster';
import { setupLocale } from './locale';
import { setupGlobalShortcuts } from './global-shortcuts';
import { isRendererPermissionAllowed } from './permissions';
import { t } from '@rooms/i18n';
import type { ActivityResponse } from '@rooms/activity-protocol';
const isolatedProfile = isolatedProfilePath(app.getPath('appData'), process.env.ROOMS_PROFILE);
if (isolatedProfile) app.setPath('userData', isolatedProfile);
let win: BrowserWindow | null = null;
let quitting = false;
let windowPolicy: ReturnType<typeof setupWindowPolicy> | null = null;
app.on('before-quit', () => {
  quitting = true;
});
let pendingInvite: InviteLink | null = null;
function receiveInvite(invite: InviteLink | null) {
  if (!invite) return;
  pendingInvite = invite;
  if (win) {
    showWindow(win);
    win.focus();
    win.webContents.send('rooms:invite-link', invite);
  }
}
app.on('open-url', (event, url) => {
  event.preventDefault();
  receiveInvite(parseInviteLink(url));
});
let primaryInstance = true;
if (app.isPackaged && !process.env.ROOMS_PROFILE) {
  if (!app.requestSingleInstanceLock()) {
    primaryInstance = false;
    app.quit();
  } else
    app.on('second-instance', (_event, argv) => {
      const invite = inviteFromArgv(argv);
      if (invite) receiveInvite(invite);
      else if (win) showWindow(win);
    });
}
if (primaryInstance) registerInviteProtocol(app, process.platform, process.env.ROOMS_PROFILE);
receiveInvite(inviteFromArgv(process.argv));
app.setName('ROOMS');
let tray: Tray | null = null;
const selectedMedia = new Map<string, string>();
const devUrl =
  process.env.ROOMS_DEV_URL === 'http://127.0.0.1:5173' ? process.env.ROOMS_DEV_URL : undefined;
// `pnpm dev` serves the renderer from Vite and never builds dist/, so read static images from public/.
const appImage = (name: string) =>
  nativeImage.createFromPath(join(__dirname, devUrl ? '../apps/desktop/public' : '../dist', name));
protocol.registerSchemesAsPrivileged([
  {
    scheme: 'rooms-provider',
    privileges: {
      standard: true,
      secure: true,
      stream: true,
      supportFetchAPI: true,
      corsEnabled: true,
    },
  },
  {
    // Community cinema relay playlists, segments and artwork, fetched by main with the session token.
    scheme: 'rooms-cinema',
    privileges: {
      standard: true,
      secure: true,
      stream: true,
      supportFetchAPI: true,
      corsEnabled: true,
    },
  },
  {
    scheme: 'rooms-media',
    privileges: { standard: true, secure: true, stream: true, supportFetchAPI: true },
  },
]);
function isTrusted(url: string) {
  try {
    return devUrl
      ? new URL(url).origin === devUrl
      : url.startsWith('file://') &&
          url.split('#')[0] === new URL(`file://${join(__dirname, '../dist/index.html')}`).href;
  } catch {
    return false;
  }
}
function assertSender(event: Electron.IpcMainInvokeEvent) {
  if (
    !win ||
    event.sender !== win.webContents ||
    event.senderFrame !== win.webContents.mainFrame ||
    !isTrusted(event.senderFrame.url)
  )
    throw new Error('Untrusted IPC sender');
}
function createWindow() {
  const stateFile = join(app.getPath('userData'), 'window.json');
  const state = readWindowState(stateFile, (rect) => screen.getDisplayMatching(rect).workArea);
  const bounds = {
    width: state.width,
    height: state.height,
    ...(state.x !== undefined && state.y !== undefined ? { x: state.x, y: state.y } : {}),
  };
  win = new BrowserWindow({
    ...bounds,
    minWidth: 900,
    minHeight: 700,
    backgroundColor: '#141518',
    show: false,
    title: 'Tayfa',
    titleBarStyle: 'hiddenInset',
    trafficLightPosition: { x: 15, y: 8 },
    ...(process.platform === 'win32'
      ? { titleBarOverlay: { color: '#141518', symbolColor: '#F2F3F7', height: 30 } }
      : {}),
    webPreferences: {
      preload: join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      webSecurity: true,
      // Incoming private calls are found by polling; a window in the background must keep
      // polling at its pace instead of once a minute (calls ring for 45 s).
      backgroundThrottling: false,
    },
  });
  win.webContents.setWindowOpenHandler(({ url }) => {
    // Chat links open in the user's browser; the app window never hosts external pages.
    if (/^https?:\/\//i.test(url) && url.length <= 2048) {
      try {
        const parsed = new URL(url);
        if (!parsed.username && !parsed.password) void shell.openExternal(parsed.href);
      } catch {
        /* Malformed links are ignored. */
      }
    }
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (event, url) => {
    if (!isTrusted(url)) event.preventDefault();
  });
  win.webContents.on('will-attach-webview', (event) => event.preventDefault());
  win.once('ready-to-show', () => win && showRestored(win, state));
  windowPolicy?.attach(win);
  trackWindowState(win, stateFile);
  win.on('closed', () => {
    win = null;
    selectedMedia.clear();
  });
  if (devUrl) void win.loadURL(devUrl);
  else void win.loadFile(join(__dirname, '../dist/index.html'));
}
/** Native menus follow the interface language and are rebuilt when it changes. */
function applyMenus() {
  Menu.setApplicationMenu(
    Menu.buildFromTemplate([
      {
        label: 'Tayfa',
        submenu: [
          { role: 'about' },
          { type: 'separator' },
          { role: 'hide' },
          { role: 'hideOthers' },
          { role: 'unhide' },
          { type: 'separator' },
          { role: 'quit' },
        ],
      },
      { role: 'editMenu' },
      {
        label: t('Görüntü'),
        submenu: [
          { role: 'reload' },
          { role: 'toggleDevTools' },
          { role: 'resetZoom' },
          { role: 'zoomIn' },
          { role: 'zoomOut' },
          { role: 'togglefullscreen' },
        ],
      },
      { role: 'windowMenu' },
    ]),
  );
  if (tray && !tray.isDestroyed())
    tray.setContextMenu(
      Menu.buildFromTemplate([
        {
          label: t('Tayfa’yı aç'),
          click: () => {
            if (win) showWindow(win);
            else createWindow();
          },
        },
        { type: 'separator' },
        { role: 'quit' },
      ]),
    );
}
app.whenReady().then(async () => {
  if (!primaryInstance) return;
  setupLocale(assertSender, applyMenus);
  const globalShortcuts = setupGlobalShortcuts({
    ipc: ipcMain,
    shortcuts: globalShortcut,
    assertSender,
    window: () => win,
  });
  app.on('will-quit', globalShortcuts.dispose);
  const notifications = setupNotifications(
    () => win,
    assertSender,
    () => {
      const scope = community.snapshot();
      return scope.user && scope.instanceUrl
        ? { serverUrl: scope.instanceUrl, userId: scope.user.id }
        : null;
    },
  );
  windowPolicy = setupWindowPolicy(
    assertSender,
    () => !!tray && !tray.isDestroyed(),
    notifications.voiceActive,
    () => quitting,
  );
  const community = await setupCommunity(
    () => win,
    assertSender,
    isTrusted,
    notifications.message,
    notifications.serverAlert,
  );
  protocol.handle('rooms-cinema', community.serveCinema);
  const providers = setupProviders(
    assertSender,
    () => {
      const scope = community.snapshot();
      return `${scope.sessionEpoch ?? 0}:${scope.instanceUrl ?? ''}:${scope.user?.id ?? ''}`;
    },
    () => {
      const scope = community.snapshot();
      return scope.user && scope.instanceUrl
        ? JSON.stringify([scope.instanceUrl, scope.user.id])
        : null;
    },
  );
  const personalVLC = setupPersonalVLC(assertSender, () => win, providers);
  app.on('before-quit', () => {
    void personalVLC.close();
  });
  setupUpdates(assertSender);
  setupAgent(
    () => win,
    assertSender,
    () => community.snapshot().user?.id ?? null,
  );
  ipcMain.handle('rooms:activity-snapshot', (event, roomId, afterRevision) => {
    assertSender(event);
    return community.activityRequest(roomId, undefined, afterRevision);
  });
  ipcMain.handle('rooms:activity-command', (event, roomId, command) => {
    assertSender(event);
    return community.activityRequest(roomId, command);
  });
  const studio = createStudioHttp(community.serviceSession);
  // Long polls of a closed main window must not keep running against the service.
  app.on('browser-window-created', (_event, window) =>
    window.on('closed', () => {
      if (!win || win === window) studio.abortAll();
    }),
  );
  for (const [name, method] of Object.entries(studio.bridge))
    ipcMain.handle(`rooms:studio-${name}`, (event, ...args: unknown[]) => {
      assertSender(event);
      return (method as (...input: unknown[]) => Promise<unknown>)(...args);
    });
  // The renderer renders the song; main validates the WAV bytes and writes them where the user chooses.
  ipcMain.handle('rooms:studio-save-export', async (event, fileName, data) => {
    assertSender(event);
    if (!win) return false;
    if (devUrl && new URL(event.senderFrame!.url).searchParams.has('fixture'))
      throw new Error('File export is disabled in development fixtures.');
    const wav = validateStudioExport(data);
    const result = await dialog.showSaveDialog(win, {
      title: t('Şarkıyı kaydet'),
      defaultPath: studioExportFileName(fileName),
      filters: [{ name: 'WAV', extensions: ['wav'] }],
    });
    if (result.canceled || !result.filePath) return false;
    writeFileSync(result.filePath, wav, { mode: 0o600 });
    return true;
  });
  app.on('before-quit', () => providers.clearPlayback());
  ipcMain.handle('rooms:youtube-details', async (event, videoId) => {
    assertSender(event);
    if (typeof videoId !== 'string' || !/^[a-zA-Z0-9_-]{11}$/.test(videoId))
      throw new Error('Invalid YouTube video identifier.');
    const watch = `https://www.youtube.com/watch?v=${videoId}`;
    const endpoint = new URL('https://www.youtube.com/oembed');
    endpoint.searchParams.set('url', watch);
    endpoint.searchParams.set('format', 'json');
    try {
      const response = await fetch(endpoint, {
        headers: { Accept: 'application/json' },
        redirect: 'error',
        signal: AbortSignal.timeout(6000),
      });
      if (response.ok) {
        const value = (await response.json()) as { title?: unknown; author_name?: unknown };
        const title = typeof value.title === 'string' ? value.title.trim().slice(0, 240) : '';
        const author =
          typeof value.author_name === 'string' ? value.author_name.trim().slice(0, 120) : '';
        return title
          ? { playable: true, embeddable: true, title, author, durationSec: null }
          : null;
      }
      if (response.status === 404) return { playable: false };
      if (response.status !== 401 && response.status !== 403) return null;
      // Embedding is off: the public watch page says whether it still plays on youtube.com.
      const page = await fetch(`${watch}&hl=tr`, {
        headers: { 'Accept-Language': 'tr,en;q=0.8' },
        redirect: 'follow',
        signal: AbortSignal.timeout(8000),
      });
      if (!page.ok || new URL(page.url).hostname !== 'www.youtube.com') return null;
      const facts = parseWatchPage((await page.text()).slice(0, 4_000_000));
      if (facts.status && facts.status !== 'OK') return { playable: false };
      return facts.title
        ? {
            playable: true,
            embeddable: false,
            title: facts.title,
            author: facts.author,
            durationSec: facts.durationSec,
          }
        : null;
    } catch {
      return null;
    }
  });
  ipcMain.handle('rooms:youtube-player', (event, videoId, chrome) => {
    assertSender(event);
    if (typeof videoId !== 'string' || !/^[a-zA-Z0-9_-]{11}$/.test(videoId))
      throw new Error('Invalid YouTube video identifier.');
    if (chrome !== undefined && chrome !== 'minimal' && chrome !== 'native')
      throw new Error('Invalid YouTube player style.');
    const instance = community.snapshot().instanceUrl;
    if (!instance) throw new Error('Connect the community server first.');
    const origin = new URL(instance).origin;
    if (!origin.startsWith('https://'))
      throw new Error(
        'YouTube requires the deployed HTTPS player origin. Local viewing has not been verified.',
      );
    const nonce = randomUUID();
    return {
      url: `${origin}/rooms-activities/player/youtube?videoId=${videoId}&nonce=${nonce}${chrome === 'minimal' ? '&chrome=minimal' : ''}`,
      nonce,
    };
  });
  ipcMain.handle('rooms:youtube-playlist', (event, playlistId) => {
    assertSender(event);
    if (typeof playlistId !== 'string' || !/^[a-zA-Z0-9_-]{10,128}$/.test(playlistId))
      throw new Error('Invalid YouTube playlist identifier.');
    const instance = community.snapshot().instanceUrl;
    if (!instance) throw new Error('Connect the community server first.');
    const origin = new URL(instance).origin;
    if (!origin.startsWith('https://'))
      throw new Error('YouTube requires the deployed HTTPS player origin.');
    const nonce = randomUUID();
    return {
      url: `${origin}/rooms-activities/player/youtube?playlistId=${encodeURIComponent(playlistId)}&nonce=${nonce}`,
      nonce,
    };
  });
  const permissionContext = (
    contents: Electron.WebContents | null,
    details: { isMainFrame: boolean; requestingUrl?: string },
  ) => {
    const ownWindow = !!contents && contents === win?.webContents;
    return {
      isMainFrame: details.isMainFrame,
      requestingUrl: details.requestingUrl,
      contentsUrl: ownWindow ? contents.getURL() : '',
      ownWindow,
      isTrusted,
    };
  };
  session.defaultSession.setPermissionRequestHandler((contents, permission, callback, details) =>
    callback(isRendererPermissionAllowed(permission, permissionContext(contents, details))),
  );
  session.defaultSession.setPermissionCheckHandler((contents, permission, _origin, details) =>
    isRendererPermissionAllowed(permission, permissionContext(contents, details)),
  );
  protocol.handle('rooms-media', (request) => {
    const id = new URL(request.url).hostname;
    const path = selectedMedia.get(id);
    if (!path) return new Response('Media access expired. Choose the file again.', { status: 404 });
    try {
      const size = statSync(path).size;
      const range = request.headers.get('range');
      const match = range?.match(/^bytes=(\d+)-(\d*)$/);
      const start = match ? Number(match[1]) : 0;
      const end = match && match[2] ? Math.min(Number(match[2]), size - 1) : size - 1;
      if (start >= size || end < start)
        return new Response(null, { status: 416, headers: { 'Content-Range': `bytes */${size}` } });
      const mime = path.toLowerCase().endsWith('.webm')
        ? 'video/webm'
        : path.toLowerCase().endsWith('.ogg')
          ? 'video/ogg'
          : 'video/mp4';
      const headers: Record<string, string> = {
        'Content-Type': mime,
        'Content-Length': String(end - start + 1),
        'Accept-Ranges': 'bytes',
      };
      if (match) headers['Content-Range'] = `bytes ${start}-${end}/${size}`;
      return new Response(
        Readable.toWeb(createReadStream(path, { start, end })) as ReadableStream,
        { status: match ? 206 : 200, headers },
      );
    } catch {
      return new Response('The selected file is unavailable.', { status: 404 });
    }
  });
  ipcMain.handle('rooms:pending-invite', (event) => {
    assertSender(event);
    const invite = pendingInvite;
    pendingInvite = null;
    return invite;
  });
  ipcMain.handle('rooms:window', (event, action) => {
    assertSender(event);
    if (action === 'minimize') win?.minimize();
    else if (action === 'maximize') win?.isMaximized() ? win.unmaximize() : win?.maximize();
    else if (action === 'close') win?.close();
    else if (action === 'fullscreen') win?.setFullScreen(!win.isFullScreen());
    else throw new Error('Unknown window action');
  });
  ipcMain.handle('rooms:always-on-top', (event, value) => {
    assertSender(event);
    if (typeof value !== 'boolean') throw new Error('Invalid value');
    win?.setAlwaysOnTop(value);
  });
  ipcMain.handle('rooms:login-item-status', (event) => {
    assertSender(event);
    return app.isPackaged && app.getLoginItemSettings().openAtLogin;
  });
  ipcMain.handle('rooms:login-item', (event, value) => {
    assertSender(event);
    if (typeof value !== 'boolean') throw new Error('Invalid value');
    if (!app.isPackaged) return false;
    app.setLoginItemSettings({ openAtLogin: value });
    return app.getLoginItemSettings().openAtLogin;
  });
  ipcMain.handle('rooms:choose-media', async (event) => {
    assertSender(event);
    if (!win) return null;
    const result = await dialog.showOpenDialog(win, {
      title: 'Choose your own media',
      properties: ['openFile'],
      filters: [{ name: 'Video', extensions: ['mp4', 'webm', 'ogg', 'mov', 'm4v'] }],
    });
    if (result.canceled || !result.filePaths[0]) return null;
    selectedMedia.clear();
    const id = randomUUID();
    selectedMedia.set(id, result.filePaths[0]);
    return { url: `rooms-media://${id}/video`, name: basename(result.filePaths[0]) };
  });
  ipcMain.handle('rooms:release-media', (event, url) => {
    assertSender(event);
    selectedMedia.delete(localMediaId(url));
  });
  ipcMain.handle('rooms:choose-caption', async (event, mediaUrl) => {
    assertSender(event);
    const id = localMediaId(mediaUrl);
    const sourcePath = selectedMedia.get(id);
    if (!sourcePath || !win) throw new Error('Choose your own local video first.');
    const result = await dialog.showOpenDialog(win, {
      title: 'Choose your own subtitles',
      properties: ['openFile'],
      filters: [{ name: 'WebVTT subtitles', extensions: ['vtt'] }],
    });
    if (result.canceled || !result.filePaths[0]) return null;
    if (selectedMedia.get(id) !== sourcePath)
      throw new Error('The selected video changed. Choose subtitles again.');
    return { content: readCaptionFile(result.filePaths[0]), name: basename(result.filePaths[0]) };
  });
  // The hall's own subtitles for this viewer only: the file's text crosses IPC, never its path.
  ipcMain.handle('rooms:cinema-subtitle-file', async (event) => {
    assertSender(event);
    if (!win) return null;
    const result = await dialog.showOpenDialog(win, {
      title: 'Choose a subtitle file',
      properties: ['openFile'],
      filters: [{ name: 'Subtitles', extensions: ['srt', 'vtt', 'ass', 'ssa'] }],
    });
    if (result.canceled || !result.filePaths[0]) return null;
    return {
      content: readSubtitleFile(result.filePaths[0]),
      name: basename(result.filePaths[0]).slice(0, 120),
    };
  });
  ipcMain.handle('rooms:external-media', async (event, url) => {
    assertSender(event);
    if (typeof url !== 'string') throw new Error('Invalid media selection.');
    const parsed = new URL(url);
    if (parsed.protocol !== 'rooms-media:') throw new Error('Choose your own local media first.');
    const path = selectedMedia.get(parsed.hostname);
    if (!path) throw new Error('The selected media access expired. Choose the file again.');
    return (await shell.openPath(path)) === '';
  });
  const diagnosticsPreview = () =>
    JSON.stringify(
      {
        app: 'ROOMS',
        version: app.getVersion(),
        platform: process.platform,
        arch: process.arch,
        electron: process.versions.electron,
        social: community.snapshot().status,
        mode: community.snapshot().user ? 'authenticated' : 'signed-out',
        timestamp: new Date().toISOString(),
      },
      null,
      2,
    );
  ipcMain.handle('rooms:set-badge', (event, count) => {
    assertSender(event);
    if (!Number.isInteger(count) || count < 0 || count > 9999) throw new Error('Invalid badge.');
    // macOS and Linux launchers; Windows has no count badge for a plain window icon.
    app.setBadgeCount(count);
  });
  ipcMain.handle('rooms:application-info', (event) => {
    assertSender(event);
    return {
      version: app.getVersion(),
      platform: process.platform,
      arch: process.arch,
      electron: process.versions.electron,
    };
  });
  ipcMain.handle('rooms:diagnostics-preview', (event) => {
    assertSender(event);
    return diagnosticsPreview();
  });
  ipcMain.handle('rooms:third-party-notices', (event) => {
    assertSender(event);
    const file = join(__dirname, '../dist/THIRD_PARTY_NOTICES.txt');
    if (statSync(file).size > 2_000_000) throw new Error('The bundled notices are too large.');
    return readFileSync(file, 'utf8');
  });
  ipcMain.handle('rooms:export-diagnostics', async (event) => {
    assertSender(event);
    if (!win) return false;
    const result = await dialog.showSaveDialog(win, {
      title: 'Export sanitized diagnostics',
      defaultPath: 'rooms-diagnostics.json',
      filters: [{ name: 'JSON', extensions: ['json'] }],
    });
    if (result.canceled || !result.filePath) return false;
    writeFileSync(result.filePath, diagnosticsPreview());
    return true;
  });
  ipcMain.handle('rooms:export-board', async (event, roomId, requestedFormat) => {
    assertSender(event);
    if (!win) return false;
    if (devUrl && new URL(event.senderFrame!.url).searchParams.has('fixture'))
      throw new Error('File export is disabled in development fixtures.');
    const format = requestedFormat === undefined ? 'svg' : requestedFormat;
    if (format !== 'svg' && format !== 'png') throw new Error('Unsupported artwork format.');
    // Membership and session are checked by the existing native Activity adapter.
    const state = (await community.activityRequest(roomId)) as ActivityResponse;
    const artwork = whiteboardSvg(state.room.whiteboard);
    const identity = community.snapshot().user?.id;
    const serverUrl = community.snapshot().instanceUrl;
    const image = format === 'png' ? await whiteboardPng(artwork) : null;
    const result = await dialog.showSaveDialog(win, {
      title: 'Save shared whiteboard',
      defaultPath: `rooms-whiteboard.${format}`,
      filters: [{ name: format === 'png' ? 'PNG image' : 'SVG image', extensions: [format] }],
    });
    if (result.canceled || !result.filePath) return false;
    if (
      !identity ||
      community.snapshot().user?.id !== identity ||
      community.snapshot().instanceUrl !== serverUrl
    )
      throw new Error('The community session changed.');
    await community.activityRequest(roomId);
    if (
      community.snapshot().user?.id !== identity ||
      community.snapshot().instanceUrl !== serverUrl
    )
      throw new Error('The community session changed.');
    if (image) writeFileSync(result.filePath, image, { mode: 0o600 });
    else writeFileSync(result.filePath, artwork, { encoding: 'utf8', mode: 0o600 });
    return true;
  });
  applyMenus();
  createWindow();
  const dockIcon = appImage('icon.png');
  if (process.platform === 'darwin' && !dockIcon.isEmpty()) app.dock?.setIcon(dockIcon);
  const icon = appImage('tray.png');
  icon.setTemplateImage(true);
  if (!icon.isEmpty()) {
    tray = new Tray(icon);
    tray.setToolTip('Tayfa');
    applyMenus();
  }
  app.on('activate', () => {
    if (!win) createWindow();
    else showWindow(win);
  });
});
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
