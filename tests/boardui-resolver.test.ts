import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { boardUiResolver, resolveWildcard, wildcardAliases } from '../tooling/boardui-resolver';
import { roomsAliases, tsconfigPaths } from '../tooling/aliases';
import { boardUiProSource } from '@boardui-pro/pro-source';

const root = mkdtempSync(join(tmpdir(), 'boardui-resolver-'));
afterAll(() => rmSync(root, { recursive: true, force: true }));
const file = (path: string) => {
  mkdirSync(join(root, path, '..'), { recursive: true });
  writeFileSync(join(root, path), 'export {};\n');
  return join(root, path);
};
const aliases = wildcardAliases(
  {
    '@boardui/*': ['free/*'],
    '@boardui-pro/*': ['pro/*', 'fallback/*'],
    '@rooms/games': ['games/index.ts'],
  },
  root,
);

describe('BoardUI alias resolution', () => {
  it('prefers the submodule file and falls back when it is missing', () => {
    const fallbackComposer = file('fallback/composer.tsx');
    const fallbackOnly = file('fallback/only-here.ts');
    expect(resolveWildcard('@boardui-pro/composer', aliases)).toBe(fallbackComposer);
    const proComposer = file('pro/composer.tsx');
    expect(resolveWildcard('@boardui-pro/composer', aliases)).toBe(proComposer);
    expect(resolveWildcard('@boardui-pro/only-here', aliases)).toBe(fallbackOnly);
    expect(resolveWildcard('@boardui-pro/missing', aliases)).toBeNull();
  });

  it('resolves extensions, index files and exact files such as stylesheets', () => {
    const button = file('free/base/button.tsx');
    const select = file('free/base/select/index.ts');
    const css = file('free/foundations/globals.css');
    expect(resolveWildcard('@boardui/base/button', aliases)).toBe(button);
    expect(resolveWildcard('@boardui/base/select', aliases)).toBe(select);
    expect(resolveWildcard('@boardui/foundations/globals.css', aliases)).toBe(css);
    expect(resolveWildcard('@rooms/games', aliases)).toBeNull();
  });

  it('keeps tsconfig as the single alias source', () => {
    expect(tsconfigPaths['@boardui-pro/*']).toEqual([
      'apps/desktop/src/boardui-pro/*',
      'apps/desktop/src/boardui-pro-fallback/*',
    ]);
    expect(Object.keys(roomsAliases).some((name) => name.includes('*'))).toBe(false);
    const plugin = boardUiResolver(aliases);
    const resolveId = plugin.resolveId as (source: string) => string | null;
    expect(resolveId('@boardui-pro/composer?raw')).toBe(`${join(root, 'pro/composer.tsx')}?raw`);
    expect(resolveId('react')).toBeNull();
  });

  it('builds this checkout from the source the alias picks', () => {
    // The public checkout has no submodule content, so the example module comes from the fallback.
    expect(['pro', 'fallback']).toContain(boardUiProSource);
  });
});
