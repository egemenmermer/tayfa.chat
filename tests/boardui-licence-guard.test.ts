import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { basename, extname, join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * BoardUI Pro is licensed source (https://www.boardui.com/license): it may live only in the private
 * submodule `egemenmermer/tayfa-pro-ui` mounted at apps/desktop/src/boardui-pro, never as a tracked
 * file of this public repository, and shipped builds carry no source maps of it.
 */
const PRO_PATH = 'apps/desktop/src/boardui-pro';
const FALLBACK_PATH = 'apps/desktop/src/boardui-pro-fallback/';
const PRO_URL = 'https://github.com/egemenmermer/tayfa-pro-ui.git';
// Below this size a file is boilerplate (an empty index, a one-line re-export), not Pro source.
const TRIVIAL_BYTES = 64;

const git = (...args: string[]) => execFileSync('git', args, { encoding: 'utf8' });
const insideGit = (() => {
  try {
    return git('rev-parse', '--is-inside-work-tree').trim() === 'true';
  } catch {
    return false;
  }
})();

const sha256 = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');

export interface TreeFile {
  path: string;
  bytes: Buffer;
}

/** Public files that are byte-identical to a submodule file (ignoring trivial ones). */
export function publicCopiesOfPro(publicFiles: TreeFile[], proFiles: TreeFile[]): string[] {
  const pro = new Map<string, string>();
  for (const file of proFiles)
    if (file.bytes.length >= TRIVIAL_BYTES) pro.set(sha256(file.bytes), file.path);
  return publicFiles
    .filter((file) => file.bytes.length >= TRIVIAL_BYTES && pro.has(sha256(file.bytes)))
    .map((file) => `${file.path} = ${PRO_PATH}/${pro.get(sha256(file.bytes))}`);
}

/** Public component files named like a Pro component file, outside the fallback folder. */
export function publicNamesOfPro(publicPaths: string[], proPaths: string[]): string[] {
  const component = (path: string) =>
    extname(path) === '.tsx' && !/^index\.tsx$/.test(basename(path));
  const proNames = new Set(proPaths.filter(component).map((path) => basename(path)));
  return publicPaths.filter(
    (path) =>
      component(path) &&
      !path.startsWith(FALLBACK_PATH) &&
      path.startsWith('apps/desktop/src/boardui') &&
      proNames.has(basename(path)),
  );
}

function walk(root: string): string[] {
  const files: string[] = [];
  const visit = (dir: string) => {
    for (const name of readdirSync(dir)) {
      if (name === '.git' || name === 'node_modules') continue;
      const path = join(dir, name);
      if (statSync(path).isDirectory()) visit(path);
      else files.push(relative(root, path));
    }
  };
  if (existsSync(root)) visit(root);
  return files;
}

describe('BoardUI Pro licence guard', () => {
  it.skipIf(!insideGit)('tracks only the submodule gitlink under boardui-pro', () => {
    const entries = git('ls-files', '-s', '--', PRO_PATH).trim().split('\n').filter(Boolean);
    expect(entries).toHaveLength(1);
    const [meta, path] = entries[0].split('\t');
    expect(path).toBe(PRO_PATH);
    expect(meta.split(' ')[0]).toBe('160000');
    // Nothing else in the index may sit under the submodule path.
    const below = git('ls-files', '-z')
      .split('\0')
      .filter((tracked) => tracked.startsWith(`${PRO_PATH}/`));
    expect(below).toEqual([]);
    const modules = readFileSync('.gitmodules', 'utf8');
    expect(modules).toContain(`path = ${PRO_PATH}`);
    expect(modules).toContain(`url = ${PRO_URL}`);
  });

  it.skipIf(!insideGit)('keeps submodule files out of the public tree when it is present', () => {
    const proPaths = walk(PRO_PATH);
    if (proPaths.length === 0) return; // Public checkout: the fallback is in use.
    const publicPaths = git('ls-files', '-z')
      .split('\0')
      .filter((path) => path && path !== PRO_PATH && existsSync(path) && statSync(path).isFile());
    const read = (root: string, paths: string[]) =>
      paths.map((path) => ({ path, bytes: readFileSync(join(root, path)) }));
    expect(publicCopiesOfPro(read('.', publicPaths), read(PRO_PATH, proPaths))).toEqual([]);
    expect(publicNamesOfPro(publicPaths, proPaths)).toEqual([]);
  });

  it('detects copies and Pro names, and allows the fallback folder', () => {
    const source = Buffer.from('export function Composer() { return null; } // '.padEnd(120, 'x'));
    const pro = [{ path: 'composer/composer.tsx', bytes: source }];
    expect(
      publicCopiesOfPro(
        [
          { path: 'apps/desktop/src/studio/copied.tsx', bytes: source },
          { path: 'apps/desktop/src/studio/own.tsx', bytes: Buffer.from('x'.repeat(200)) },
          { path: 'apps/desktop/src/studio/tiny.ts', bytes: Buffer.from('export {};') },
        ],
        [...pro, { path: 'tiny.ts', bytes: Buffer.from('export {};') }],
      ),
    ).toEqual([`apps/desktop/src/studio/copied.tsx = ${PRO_PATH}/composer/composer.tsx`]);
    expect(
      publicNamesOfPro(
        [
          'apps/desktop/src/boardui/base/composer.tsx',
          `${FALLBACK_PATH}composer.tsx`,
          'apps/desktop/src/boardui/base/button.tsx',
        ],
        pro.map((file) => file.path),
      ),
    ).toEqual(['apps/desktop/src/boardui/base/composer.tsx']);
  });

  it('builds without source maps', async () => {
    const { default: config } = await import('../vite.config');
    expect((config as { build?: { sourcemap?: unknown } }).build?.sourcemap).toBe(false);
  });

  it('loads Tailwind without preflight and keeps utilities inside BoardUI regions', () => {
    const css = readFileSync('apps/desktop/src/boardui/foundations/globals.css', 'utf8');
    const code = css.replace(/\/\*[\s\S]*?\*\//g, '');
    expect(code).not.toMatch(/@import\s+['"]tailwindcss['"]/);
    expect(code).not.toMatch(/preflight/);
    expect(code).toMatch(/@import\s+'tailwindcss\/theme\.css'\s+layer\(theme\)/);
    const scope = code.indexOf('@scope ([data-boardui])');
    const utilities = code.indexOf('@tailwind utilities source(none);');
    expect(scope).toBeGreaterThan(-1);
    expect(utilities).toBeGreaterThan(scope);
    expect(code.match(/@tailwind/g)).toHaveLength(1);
    // Tailwind scans only BoardUI, Pro/fallback, Studio and the dev fixture.
    const sources = [...code.matchAll(/@source\s+'([^']+)'/g)].map((match) => match[1]);
    expect(sources).toEqual([
      '..',
      '../../boardui-pro',
      '../../boardui-pro-fallback',
      '../../studio',
      '../../dev/BoardUiFixture.tsx',
    ]);
  });
});
