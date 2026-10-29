import { describe, it, expect, vi } from 'vitest';
import {
  inviteFromArgv,
  parseInviteLink,
  registerInviteProtocol,
} from '../apps/desktop/electron/native-links';

const token = 'b'.repeat(64);
const appLink = `rooms://invite?server=https%3A%2F%2Ffriends.example&code=${token}`;

it('accepts only bounded invitation links to HTTPS origins or explicit development loopback', () => {
  expect(
    parseInviteLink('rooms://invite?server=https%3A%2F%2Ffriends.example&code=Abcd_123'),
  ).toEqual({ serverUrl: 'https://friends.example', code: 'Abcd_123' });
  // Browsers on Windows may add a slash after the host or upper-case the scheme.
  expect(
    parseInviteLink(`ROOMS://invite/?server=https%3A%2F%2Ffriends.example&code=${token}`),
  ).toEqual({ serverUrl: 'https://friends.example', code: token });
  for (const raw of [
    'rooms://anything?server=https://friends.example&code=abc',
    'rooms://invite?server=file:///etc/passwd&code=abc',
    'rooms://invite?server=https://secret@friends.example&code=abc',
    'rooms://invite?server=http://friends.example&code=abc',
    'rooms://invite?server=https://friends.example&code=abc&code=def',
    'rooms://invite?server=https://friends.example&code=abc&shell=rm',
    'rooms://invite?server=https://friends.example&code=../../x',
    'rooms://invite?code=abc',
    // The OS only hands the app its own scheme; web addresses and bare tokens never count here.
    `https://friends.example/davet/${token}`,
    token,
    'roomsx://invite?server=https%3A%2F%2Ffriends.example&code=abc',
  ])
    expect(parseInviteLink(raw)).toBeNull();
});

describe('invitation links on the command line', () => {
  it('finds the link Windows passes to a second instance among Chromium switches', () => {
    const argv = [
      'C:\\Users\\Ali\\AppData\\Local\\Programs\\ROOMS\\ROOMS.exe',
      '--allow-file-access-from-files',
      '--original-process-start-time=13370000000000000',
      appLink,
    ];
    expect(inviteFromArgv(argv)).toEqual({ serverUrl: 'https://friends.example', code: token });
    // Order is not guaranteed for second-instance argv.
    expect(inviteFromArgv([argv[0], appLink, '--secondary'])).toEqual({
      serverUrl: 'https://friends.example',
      code: token,
    });
  });

  it('ignores malformed links and plain launches, and keeps the first valid link', () => {
    expect(inviteFromArgv(['C:\\ROOMS.exe'])).toBeNull();
    expect(inviteFromArgv(['C:\\ROOMS.exe', '--hidden'])).toBeNull();
    expect(
      inviteFromArgv([
        'C:\\ROOMS.exe',
        'rooms://invite?server=https%3A%2F%2Fevil@x.example&code=a',
      ]),
    ).toBeNull();
    expect(inviteFromArgv(['C:\\ROOMS.exe', `https://friends.example/davet/${token}`])).toBeNull();
    const second = `rooms://invite?server=https%3A%2F%2Fother.example&code=${token}`;
    expect(inviteFromArgv(['x', 'rooms://invite?code=broken', second, appLink])).toEqual({
      serverUrl: 'https://other.example',
      code: token,
    });
  });
});

describe('invitation link handler registration', () => {
  const fakeApp = (isPackaged: boolean, isDefault = false) => ({
    isPackaged,
    isDefaultProtocolClient: vi.fn(() => isDefault),
    setAsDefaultProtocolClient: vi.fn(() => true),
  });

  it('registers the rooms scheme for packaged Windows and macOS builds', () => {
    for (const platform of ['win32', 'darwin'] as const) {
      const app = fakeApp(true);
      expect(registerInviteProtocol(app, platform, undefined)).toBe(true);
      expect(app.setAsDefaultProtocolClient).toHaveBeenCalledWith('rooms');
    }
  });

  it('leaves an existing registration alone', () => {
    const app = fakeApp(true, true);
    expect(registerInviteProtocol(app, 'win32', undefined)).toBe(true);
    expect(app.setAsDefaultProtocolClient).not.toHaveBeenCalled();
  });

  it('never registers development runs, isolated profiles or other platforms', () => {
    for (const [app, platform, profile] of [
      [fakeApp(false), 'win32', undefined],
      [fakeApp(true), 'win32', 'second'],
      [fakeApp(true), 'linux', undefined],
    ] as const) {
      expect(registerInviteProtocol(app, platform, profile)).toBe(false);
      expect(app.setAsDefaultProtocolClient).not.toHaveBeenCalled();
    }
  });

  it('survives a refused registration', () => {
    const app = fakeApp(true);
    app.setAsDefaultProtocolClient.mockImplementation(() => {
      throw new Error('registry locked');
    });
    expect(registerInviteProtocol(app, 'win32', undefined)).toBe(false);
  });
});
