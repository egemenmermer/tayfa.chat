import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

// TypeScript is the single source for repository-local module aliases.
const config = JSON.parse(readFileSync(new URL('../tsconfig.json', import.meta.url), 'utf8'));
export const tsconfigPaths = config.compilerOptions.paths as Record<string, string[]>;
// Exact package aliases only. Wildcard entries (`@boardui/*`, `@boardui-pro/*` with a fallback
// location) are resolved by tooling/boardui-resolver.ts in the same order as TypeScript.
export const roomsAliases: Record<string, string> = Object.fromEntries(
  Object.entries(tsconfigPaths)
    .filter(([name]) => !name.includes('*'))
    .map(([name, paths]) => [name, resolve(paths[0])]),
);
