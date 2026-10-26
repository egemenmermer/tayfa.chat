import { roomsAliases } from './tooling/aliases';
import { boardUiResolver } from './tooling/boardui-resolver';
import { defineConfig } from 'vitest/config';
import path from 'node:path';
export default defineConfig({
  plugins: [boardUiResolver()],
  resolve: { alias: roomsAliases },
  test: {
    include: ['tests/**/*.test.ts', 'tests/**/*.test.tsx', 'packages/**/src/**/*.test.ts'],
    exclude: ['.local/**', 'node_modules/**'],
    maxWorkers: 2,
    setupFiles: ['tests/setup-locale.ts'],
  },
});
