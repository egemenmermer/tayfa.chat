import type { DesktopBridge } from '@rooms/contracts';

/** Subset of the desktop bridge the window chrome needs; kept narrow so tests can fake it. */
type ChromeBridge = Pick<
  DesktopBridge,
  'platform' | 'windowState' | 'onWindowState' | 'setWindowTheme'
>;

/** The theme the window buttons should match: `data-theme` on <html>, dark when unset. */
export function documentWindowTheme(root: HTMLElement): 'dark' | 'light' {
  return root.dataset.theme === 'light' ? 'light' : 'dark';
}

/**
 * Mirrors the native window into attributes on <html> so CSS can lay out the app-drawn title bar:
 *   data-platform="darwin|win32|linux"   absent in a browser
 *   data-window-overlay="true"           native window buttons are drawn over the bar (Windows only)
 *   data-window-maximized / data-window-fullscreen = "true"|"false"
 * It also reports the theme to the main process so the Windows buttons recolour with the app.
 * Returns a cleanup function.
 */
export function installWindowChrome(
  root: HTMLElement,
  bridge: ChromeBridge | undefined = (window as { rooms?: ChromeBridge }).rooms,
) {
  if (!bridge) return () => {};
  root.dataset.platform = bridge.platform;
  if (bridge.platform === 'win32') root.dataset.windowOverlay = 'true';
  const apply = (state: { maximized: boolean; fullscreen: boolean }) => {
    root.dataset.windowMaximized = String(state.maximized);
    root.dataset.windowFullscreen = String(state.fullscreen);
  };
  apply({ maximized: false, fullscreen: false });
  const stop = bridge.onWindowState(apply);
  bridge
    .windowState()
    .then(apply)
    .catch(() => {});
  let reported: 'dark' | 'light' | null = null;
  const reportTheme = () => {
    const theme = documentWindowTheme(root);
    if (bridge.platform !== 'win32' || theme === reported) return;
    reported = theme;
    bridge.setWindowTheme(theme).catch(() => {
      reported = null;
    });
  };
  reportTheme();
  const observer =
    typeof MutationObserver === 'undefined' ? null : new MutationObserver(reportTheme);
  observer?.observe(root, { attributes: true, attributeFilter: ['data-theme'] });
  return () => {
    stop();
    observer?.disconnect();
  };
}
