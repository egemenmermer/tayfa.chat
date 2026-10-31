/**
 * Windows groups the taskbar button, pins and toasts by this id. It must equal build.appId,
 * which the installer writes into the Start menu shortcut; without it Windows shows the
 * Electron icon and drops notifications.
 */
export const WINDOWS_APP_ID = 'private.rooms.desktop';
