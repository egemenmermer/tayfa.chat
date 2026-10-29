// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import {
  TITLE_BAR_OVERLAY_HEIGHT,
  WINDOW_CHROME_HEIGHT,
  applyWindowTheme,
  parseWindowTheme,
  titleBarOverlay,
  windowFrameOptions,
} from '../apps/desktop/electron/window-chrome';
import { documentWindowTheme, installWindowChrome } from '../apps/desktop/src/window-chrome';

const src = path.resolve(__dirname, '../apps/desktop');
const read = (file: string) => readFileSync(path.join(src, file), 'utf8');

describe('window frame options (main process)', () => {
  it('Windows hides the title bar and keeps the native buttons as a themed overlay', () => {
    const options = windowFrameOptions('win32');
    expect(options).toEqual({
      titleBarStyle: 'hidden',
      titleBarOverlay: {
        color: '#141518',
        symbolColor: '#F2F3F7',
        height: TITLE_BAR_OVERLAY_HEIGHT,
      },
    });
  });
  it('macOS keeps the inset traffic lights and gets no overlay', () => {
    expect(windowFrameOptions('darwin')).toEqual({
      titleBarStyle: 'hiddenInset',
      trafficLightPosition: { x: 15, y: 8 },
    });
    expect(windowFrameOptions('darwin')).not.toHaveProperty('titleBarOverlay');
    expect(windowFrameOptions('linux')).toEqual(windowFrameOptions('darwin'));
  });
  it('the overlay is one pixel shorter than the bar so the divider stays unbroken', () => {
    expect(TITLE_BAR_OVERLAY_HEIGHT).toBe(WINDOW_CHROME_HEIGHT - 1);
    const css = read('src/reference-shell.css');
    expect(css).toMatch(/\.window-chrome \{\s*height: 30px;[^}]*border-bottom: 1px solid/);
  });
  it('dark overlay colours equal the app tokens; light differs', () => {
    const tokens = read('src/reference-tokens.css');
    const token = (name: string) =>
      new RegExp(`--${name}:\\s*(#[0-9a-fA-F]{6})`).exec(tokens)![1]!.toLowerCase();
    const dark = titleBarOverlay('dark');
    expect(dark.color.toLowerCase()).toBe(token('color-background-canvas'));
    expect(dark.symbolColor.toLowerCase()).toBe(token('color-text-primary'));
    expect(titleBarOverlay('light').color).not.toBe(dark.color);
  });
  it('parses only known themes', () => {
    expect(parseWindowTheme('dark')).toBe('dark');
    expect(parseWindowTheme('light')).toBe('light');
    for (const bad of ['', 'DARK', 'auto', null, undefined, 1, {}])
      expect(parseWindowTheme(bad)).toBeNull();
  });
});

describe('theme updates (main process)', () => {
  const fake = (destroyed = false) => ({
    setTitleBarOverlay: vi.fn(),
    isDestroyed: () => destroyed,
  });
  it('recolours the Windows overlay when the theme changes', () => {
    const window = fake();
    expect(applyWindowTheme(window, 'win32', 'light')).toBe(true);
    expect(window.setTitleBarOverlay).toHaveBeenCalledWith(titleBarOverlay('light'));
    applyWindowTheme(window, 'win32', 'dark');
    expect(window.setTitleBarOverlay).toHaveBeenLastCalledWith(titleBarOverlay('dark'));
  });
  it('does nothing on macOS, Linux or a destroyed window', () => {
    const window = fake();
    expect(applyWindowTheme(window, 'darwin', 'light')).toBe(false);
    expect(applyWindowTheme(window, 'linux', 'light')).toBe(false);
    expect(applyWindowTheme(fake(true), 'win32', 'light')).toBe(false);
    expect(window.setTitleBarOverlay).not.toHaveBeenCalled();
  });
});

describe('renderer platform flag', () => {
  const bridge = (platform: 'darwin' | 'win32' | 'linux') => {
    let listener: ((state: { maximized: boolean; fullscreen: boolean }) => void) | undefined;
    return {
      platform,
      windowState: vi.fn(async () => ({ maximized: true, fullscreen: false })),
      onWindowState: vi.fn((next: typeof listener) => {
        listener = next;
        return () => {
          listener = undefined;
        };
      }),
      setWindowTheme: vi.fn(async () => {}),
      emit: (state: { maximized: boolean; fullscreen: boolean }) => listener?.(state),
    };
  };
  it('reserves the overlay only on Windows', async () => {
    const win = document.createElement('html');
    const b = bridge('win32');
    const stop = installWindowChrome(win, b);
    expect(win.dataset.platform).toBe('win32');
    expect(win.dataset.windowOverlay).toBe('true');
    await vi.waitFor(() => expect(win.dataset.windowMaximized).toBe('true'));
    b.emit({ maximized: false, fullscreen: true });
    expect(win.dataset.windowFullscreen).toBe('true');
    stop();
    expect(b.onWindowState).toHaveBeenCalledTimes(1);
  });
  it('sets the platform but no overlay flag on macOS, and nothing in a browser', () => {
    const mac = document.createElement('html');
    const b = bridge('darwin');
    installWindowChrome(mac, b);
    expect(mac.dataset.platform).toBe('darwin');
    expect(mac.dataset.windowOverlay).toBeUndefined();
    expect(b.setWindowTheme).not.toHaveBeenCalled();
    const browser = document.createElement('html');
    installWindowChrome(browser, undefined);
    expect(browser.dataset.platform).toBeUndefined();
  });
  it('reports the theme on start and again when data-theme changes', async () => {
    const win = document.createElement('html');
    const b = bridge('win32');
    installWindowChrome(win, b);
    expect(b.setWindowTheme).toHaveBeenCalledWith('dark');
    win.dataset.theme = 'light';
    await vi.waitFor(() => expect(b.setWindowTheme).toHaveBeenLastCalledWith('light'));
    expect(documentWindowTheme(win)).toBe('light');
    win.dataset.theme = 'dark';
    await vi.waitFor(() => expect(b.setWindowTheme).toHaveBeenLastCalledWith('dark'));
    expect(b.setWindowTheme).toHaveBeenCalledTimes(3);
  });
});

describe('Windows bar CSS is scoped to the overlay flag', () => {
  const css = read('src/reference-shell.css');
  const windowsRules = css.slice(css.indexOf('Windows title bar.'));
  const selectors = [...windowsRules.matchAll(/([^{}/]+)\{/g)].map((m) => m[1]!.trim());
  it('every rule in the Windows block requires data-window-overlay', () => {
    expect(selectors.length).toBeGreaterThan(4);
    for (const selector of selectors)
      expect(selector).toContain("html[data-window-overlay='true']");
  });
  it('left-aligns the bar, clears the overlay width and hides the bar in full screen', () => {
    expect(windowsRules).toContain('titlebar-area-width');
    expect(windowsRules).toMatch(/\.window-chrome \{\s*justify-content: flex-start/);
    expect(windowsRules).toMatch(
      /data-window-fullscreen='true'\] \.window-chrome \{\s*display: none/,
    );
    expect(windowsRules).toMatch(/data-window-fullscreen='true'\] \.app-layout \{\s*height: 100vh/);
  });
  it('main.ts uses the shared frame options and no hard-coded overlay', () => {
    const main = read('electron/main.ts');
    expect(main).toContain('...windowFrameOptions(process.platform)');
    expect(main).not.toContain('titleBarOverlay');
    expect(main).toContain("ipcMain.handle('rooms:window-theme'");
  });
});
