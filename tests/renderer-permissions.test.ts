import { describe, expect, it } from 'vitest';
import { isRendererPermissionAllowed, type PermissionContext } from '../apps/desktop/electron/permissions';

const app = 'file:///Applications/Tayfa.app/Contents/Resources/app.asar/dist/index.html';
const trusted: PermissionContext = {
  isMainFrame: true,
  requestingUrl: app,
  contentsUrl: `${app}#/studio`,
  ownWindow: true,
  isTrusted: (url) => url.split('#')[0] === app,
};

describe('renderer web permissions', () => {
  it('grants the existing permissions and Web MIDI to the app main frame', () => {
    for (const permission of ['media', 'fullscreen', 'clipboard-sanitized-write', 'midi'])
      expect(isRendererPermissionAllowed(permission, trusted)).toBe(true);
  });

  it('denies MIDI SysEx and unlisted permissions', () => {
    for (const permission of ['midiSysex', 'geolocation', 'hid', 'usb', 'serial', 'notifications'])
      expect(isRendererPermissionAllowed(permission, trusted)).toBe(false);
  });

  it('denies MIDI to frames, other windows and untrusted origins', () => {
    expect(isRendererPermissionAllowed('midi', { ...trusted, isMainFrame: false })).toBe(false);
    expect(isRendererPermissionAllowed('midi', { ...trusted, ownWindow: false })).toBe(false);
    expect(isRendererPermissionAllowed('midi', { ...trusted, requestingUrl: undefined })).toBe(false);
    expect(isRendererPermissionAllowed('midi', { ...trusted, requestingUrl: 'https://example.com/' })).toBe(false);
    expect(isRendererPermissionAllowed('midi', { ...trusted, contentsUrl: 'https://example.com/' })).toBe(false);
  });
});
