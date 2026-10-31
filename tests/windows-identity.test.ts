import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { WINDOWS_APP_ID } from '../apps/desktop/electron/windows-app-id';

const build = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')).build;

describe('Windows identity', () => {
  it('names and badges Tayfa without moving the install or the update path', () => {
    // The taskbar, pins and toasts match the installer's shortcut only with the same id.
    expect(WINDOWS_APP_ID).toBe(build.appId);
    // appId and productName pick the install folder, userData and the update feed: fixed.
    expect(build.appId).toBe('private.rooms.desktop');
    expect(build.productName).toBe('ROOMS');
    // Visible names: Start menu, search and Apps & features say Tayfa.
    expect(build.nsis).toMatchObject({ shortcutName: 'Tayfa', uninstallDisplayName: 'Tayfa' });
    // The exe and the taskbar carry Tayfa's icon instead of Electron's.
    expect(build.win.icon).toBe('apps/desktop/public/icon.png');
    expect(build.win.artifactName).toBe('ROOMS-${version}-windows-${arch}-setup.${ext}');
  });
});
