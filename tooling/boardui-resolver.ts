import { existsSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Plugin } from 'vite';
import { tsconfigPaths } from './aliases';

const repositoryRoot = fileURLToPath(new URL('..', import.meta.url));

/**
 * Wildcard aliases with fallback locations, read from tsconfig.json `paths` (the single alias source).
 *
 * `@boardui-pro/*` lists the private Pro submodule first and the public fallback second, exactly as
 * TypeScript tries them: a module comes from the submodule when that file exists there, otherwise from
 * apps/desktop/src/boardui-pro-fallback. Builds without access to the private repository therefore use
 * the fallback, and the public tree never needs Pro source.
 */
export interface WildcardAlias {
  prefix: string;
  /** Absolute directories, tried in order. */
  roots: string[];
}

const EXTENSIONS = ['.tsx', '.ts', '.jsx', '.js', '.mjs'];

export function wildcardAliases(
  paths: Record<string, string[]> = tsconfigPaths,
  base = repositoryRoot,
): WildcardAlias[] {
  return Object.entries(paths)
    .filter(([name]) => name.endsWith('/*'))
    .map(([name, targets]) => ({
      prefix: name.slice(0, -1),
      roots: targets.map((target) => resolve(base, target.replace(/\/\*$/, ''))),
    }));
}

const isFile = (path: string) => existsSync(path) && statSync(path).isFile();

/** The file a request like `@boardui-pro/composer` maps to, or null when no root has it. */
export function resolveWildcard(specifier: string, aliases: WildcardAlias[]): string | null {
  for (const { prefix, roots } of aliases) {
    if (!specifier.startsWith(prefix)) continue;
    const rest = specifier.slice(prefix.length);
    for (const root of roots) {
      const target = join(root, rest);
      if (isFile(target)) return target;
      for (const extension of EXTENSIONS) if (isFile(target + extension)) return target + extension;
      for (const extension of EXTENSIONS)
        if (isFile(join(target, `index${extension}`))) return join(target, `index${extension}`);
    }
    return null;
  }
  return null;
}

/** Vite/Vitest resolver for the wildcard aliases above. */
export function boardUiResolver(aliases = wildcardAliases()): Plugin {
  return {
    name: 'tayfa-boardui-resolver',
    enforce: 'pre',
    resolveId(source) {
      if (!aliases.some(({ prefix }) => source.startsWith(prefix))) return null;
      const resolved = resolveWildcard(source.split('?')[0], aliases);
      if (!resolved) return null;
      const query = source.includes('?') ? source.slice(source.indexOf('?')) : '';
      return resolved + query;
    },
  };
}
