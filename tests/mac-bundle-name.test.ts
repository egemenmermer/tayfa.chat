import { mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it } from 'vitest';

const { writeLocalizedDisplayName } = createRequire(import.meta.url)(
  '../scripts/mac-display-name.cjs',
) as { writeLocalizedDisplayName: (resources: string) => number };

// Electron finds its helper apps as "<CFBundleName> Helper.app". The helpers are named after
// productName, so a different CFBundleName makes the packaged app crash at launch (RC27).
it('keeps the macOS bundle name equal to productName; only the display name says Tayfa', () => {
  const pkg = JSON.parse(readFileSync('package.json', 'utf8'));
  const info = pkg.build.mac.extendInfo ?? {};
  expect(info.CFBundleName ?? pkg.build.productName).toBe(pkg.build.productName);
  expect(pkg.build.productName).toBe('ROOMS');
  // Finder and Spotlight show the bundle file name unless the plain display name matches it;
  // Tayfa then comes from the localized InfoPlist.strings written after packaging.
  expect(info.CFBundleDisplayName).toBe(pkg.build.productName);
  expect(info.LSHasLocalizedDisplayName).toBe(true);
  expect(pkg.build.afterPack).toBe('scripts/mac-preview-after-pack.cjs');
  expect(readFileSync(pkg.build.afterPack, 'utf8')).toContain('writeLocalizedDisplayName(');
});

it('names the app Tayfa in every packaged language folder without localizing CFBundleName', () => {
  const resources = mkdtempSync(join(tmpdir(), 'rooms-lproj-'));
  try {
    for (const folder of ['en.lproj', 'tr.lproj', 'nl.lproj', 'native'])
      mkdirSync(join(resources, folder));
    expect(writeLocalizedDisplayName(resources)).toBe(3);
    for (const folder of ['en.lproj', 'tr.lproj', 'nl.lproj']) {
      const strings = readFileSync(join(resources, folder, 'InfoPlist.strings'), 'utf8');
      expect(strings).toBe('CFBundleDisplayName = "Tayfa";\n');
    }
    expect(() => readFileSync(join(resources, 'native', 'InfoPlist.strings'))).toThrow();
  } finally {
    rmSync(resources, { recursive: true, force: true });
  }
});

it('refuses a packaged app without an English language folder', () => {
  const resources = mkdtempSync(join(tmpdir(), 'rooms-lproj-'));
  try {
    expect(() => writeLocalizedDisplayName(resources)).toThrow(/en\.lproj/);
  } finally {
    rmSync(resources, { recursive: true, force: true });
  }
});
