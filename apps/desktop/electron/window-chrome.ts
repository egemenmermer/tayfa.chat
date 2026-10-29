import type { BrowserWindow } from 'electron';

/** Theme the window controls follow; Tayfa is dark-only today, `light` is ready for a future theme. */
export type WindowTheme = 'dark' | 'light';

/** State the renderer needs to lay out its own title bar. */
export interface WindowChromeState {
  maximized: boolean;
  fullscreen: boolean;
}

/** Height of the app-drawn bar (`.window-chrome` in reference-shell.css), border included. */
export const WINDOW_CHROME_HEIGHT = 30;
/**
 * The overlay is one pixel shorter than the bar so the bar's 1px bottom divider runs unbroken
 * underneath the native window buttons.
 */
export const TITLE_BAR_OVERLAY_HEIGHT = WINDOW_CHROME_HEIGHT - 1;

/**
 * Overlay colours per theme. `dark` must equal `--color-background-canvas` and
 * `--color-text-primary` in reference-tokens.css (tests/window-chrome.test.ts checks this) so the
 * native buttons blend into the bar. `light` is provisional until a light theme ships.
 */
const OVERLAY_COLORS: Record<WindowTheme, { color: string; symbolColor: string }> = {
  dark: { color: '#141518', symbolColor: '#F2F3F7' },
  light: { color: '#F4F5F8', symbolColor: '#1B1D24' },
};

export function parseWindowTheme(value: unknown): WindowTheme | null {
  return value === 'dark' || value === 'light' ? value : null;
}

export function titleBarOverlay(theme: WindowTheme) {
  return { ...OVERLAY_COLORS[theme], height: TITLE_BAR_OVERLAY_HEIGHT };
}

/**
 * Frame options for the main window. macOS keeps its inset traffic lights; Windows hides the
 * native title bar and keeps only the native buttons as an overlay in the app's colours; other
 * platforms keep the previous options.
 */
export function windowFrameOptions(platform: NodeJS.Platform, theme: WindowTheme = 'dark') {
  if (platform === 'win32')
    return { titleBarStyle: 'hidden' as const, titleBarOverlay: titleBarOverlay(theme) };
  return { titleBarStyle: 'hiddenInset' as const, trafficLightPosition: { x: 15, y: 8 } };
}

/** Recolours the native window buttons; a no-op wherever there is no overlay. */
export function applyWindowTheme(
  window: Pick<BrowserWindow, 'setTitleBarOverlay' | 'isDestroyed'>,
  platform: NodeJS.Platform,
  theme: WindowTheme,
) {
  if (platform !== 'win32' || window.isDestroyed()) return false;
  window.setTitleBarOverlay(titleBarOverlay(theme));
  return true;
}

export function windowChromeState(
  window: Pick<BrowserWindow, 'isMaximized' | 'isFullScreen'>,
): WindowChromeState {
  return { maximized: window.isMaximized(), fullscreen: window.isFullScreen() };
}

/** Sends the maximized/fullscreen state to the renderer on every change. */
export function trackWindowChrome(window: BrowserWindow) {
  const send = () => {
    if (!window.isDestroyed() && !window.webContents.isDestroyed())
      window.webContents.send('rooms:window-state', windowChromeState(window));
  };
  for (const event of [
    'maximize',
    'unmaximize',
    'enter-full-screen',
    'leave-full-screen',
    'restore',
  ] as const)
    window.on(event as 'maximize', send);
  // A reload or navigation starts a fresh renderer that has not seen the current state yet.
  window.webContents.on('did-finish-load', send);
  return send;
}
