import { describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';
import {
  parseUpdateConfig,
  selectUpdatePlatform,
  updateReasonText,
  type UpdatePlatformInput,
} from '../apps/desktop/electron/update-platform';
import {
  installerName,
  latestYmlProblems,
  parseLatestYml,
  sha512Base64,
  updateFeed,
} from '../scripts/windows-update-feed.mjs';

const require = createRequire(import.meta.url);
const { parseUpdateInfo, resolveFiles } = require('electron-updater/out/providers/Provider') as {
  parseUpdateInfo(raw: string, channelFile: string, url: URL): { version: string };
  resolveFiles(info: unknown, baseUrl: URL): { url: URL; info: { sha512: string } }[];
};
const { getChannelFilename, newBaseUrl } = require('electron-updater/out/util') as {
  getChannelFilename(channel: string): string;
  newBaseUrl(url: string): URL;
};

const feed = 'https://github.com/egemenmermer/tayfa/releases/latest/download/';
const installed: UpdatePlatformInput = {
  platform: 'win32',
  isPackaged: true,
  config: { feed, teamId: null },
  macSigned: false,
  windowsUpdateYml: true,
  windowsInstalled: true,
};
const installerBytes = Buffer.from('fixture installer bytes');
const version = '0.1.18-rc.36';
const latestYml = `version: ${version}
files:
  - url: ${installerName(version)}
    sha512: ${sha512Base64(installerBytes)}
    size: ${installerBytes.length}
path: ${installerName(version)}
sha512: ${sha512Base64(installerBytes)}
releaseDate: '2026-10-30T10:00:00.000Z'
`;

describe('update platform selection', () => {
  it('uses the NSIS updater only on an installed, feed-configured Windows build', () => {
    expect(selectUpdatePlatform(installed)).toEqual({ engine: 'nsis', reason: null });
    expect(selectUpdatePlatform({ ...installed, isPackaged: false })).toEqual({
      engine: null,
      reason: 'unpackaged',
    });
    expect(selectUpdatePlatform({ ...installed, config: null }).reason).toBe('no-feed');
    expect(selectUpdatePlatform({ ...installed, windowsUpdateYml: false }).reason).toBe('no-feed');
    expect(selectUpdatePlatform({ ...installed, windowsInstalled: false }).reason).toBe('portable');
  });
  it('keeps macOS on Sparkle and requires a verified Developer ID signature with a team', () => {
    const mac = { ...installed, platform: 'darwin' as const, config: { feed, teamId: 'TESTTEAM01' } };
    expect(selectUpdatePlatform({ ...mac, macSigned: true }).engine).toBe('sparkle');
    expect(selectUpdatePlatform(mac)).toEqual({ engine: null, reason: 'mac-unsigned' });
    expect(selectUpdatePlatform({ ...mac, macSigned: true, config: { feed, teamId: null } }).reason).toBe(
      'mac-unsigned',
    );
    expect(selectUpdatePlatform({ ...mac, macSigned: true, isPackaged: false }).reason).toBe(
      'mac-unsigned',
    );
  });
  it('explains every unavailable platform instead of hiding updates', () => {
    expect(selectUpdatePlatform({ ...installed, platform: 'linux' }).reason).toBe('platform');
    for (const reason of ['mac-unsigned', 'platform', 'unpackaged', 'no-feed', 'portable', 'failed'] as const)
      expect(updateReasonText(reason).length).toBeGreaterThan(20);
  });
});

describe('update feed configuration', () => {
  it('accepts a credential-free HTTPS feed with or without an Apple team', () => {
    expect(parseUpdateConfig({ feed })).toEqual({ feed, teamId: null });
    expect(parseUpdateConfig({ feed, teamId: 'TESTTEAM01' })).toEqual({ feed, teamId: 'TESTTEAM01' });
    expect(parseUpdateConfig({ feed, teamId: 'not a team' })).toEqual({ feed, teamId: null });
  });
  it('rejects plain HTTP, embedded credentials, queries and malformed values', () => {
    for (const bad of [
      'http://github.com/o/r/releases/latest/download/',
      'https://user:pass@updates.example.org/',
      'https://updates.example.org/?token=1',
      'https://updates.example.org/#x',
      'not a url',
    ])
      expect(parseUpdateConfig({ feed: bad })).toBeNull();
    expect(parseUpdateConfig(null)).toBeNull();
    expect(parseUpdateConfig({ feed: 42 })).toBeNull();
  });
  it('normalizes the workflow feed and refuses unsafe ones', () => {
    expect(updateFeed('https://github.com/o/r/releases/latest/download')).toBe(
      'https://github.com/o/r/releases/latest/download/',
    );
    expect(() => updateFeed(undefined)).toThrow('HTTPS');
    expect(() => updateFeed('http://github.com/o/r/')).toThrow('HTTPS');
    expect(() => updateFeed('https://x:y@github.com/o/r/')).toThrow('credentials');
  });
});

describe('Windows update metadata', () => {
  it('resolves latest.yml and its installer under the same latest-release feed', () => {
    // The app pins channel "latest", so even an rc build asks for latest.yml.
    expect(getChannelFilename('latest')).toBe('latest.yml');
    const base = newBaseUrl(feed);
    const info = parseUpdateInfo(latestYml, 'latest.yml', new URL('latest.yml', base));
    expect(info.version).toBe(version);
    const [file] = resolveFiles(info, base);
    expect(file!.url.href).toBe(`${feed}${installerName(version)}`);
    expect(file!.info.sha512).toBe(sha512Base64(installerBytes));
  });
  it('accepts metadata that matches the built installer', () => {
    const info = parseLatestYml(latestYml);
    expect(
      latestYmlProblems(info, {
        version,
        installer: installerName(version),
        sha512: sha512Base64(installerBytes),
        size: installerBytes.length,
      }),
    ).toEqual([]);
  });
  it('flags a stale version, a different installer, a wrong hash and a path outside the feed', () => {
    const expected = {
      version,
      installer: installerName(version),
      sha512: sha512Base64(Buffer.from('other bytes')),
      size: installerBytes.length + 1,
    };
    const problems = latestYmlProblems(parseLatestYml(latestYml), expected);
    expect(problems.join('\n')).toMatch(/sha512 does not match/);
    expect(problems.join('\n')).toMatch(/size/);
    const stale = latestYml.replaceAll(version, '0.1.18-rc.35');
    expect(latestYmlProblems(parseLatestYml(stale), { ...expected }).join('\n')).toMatch(
      /version 0\.1\.18-rc\.35 is not/,
    );
    const escaped = latestYml.replace(`url: ${installerName(version)}`, 'url: ../evil.exe');
    expect(latestYmlProblems(parseLatestYml(escaped), expected).join('\n')).toMatch(
      /inside the feed/,
    );
    expect(() => parseLatestYml('just text')).toThrow('YAML mapping');
  });
});
