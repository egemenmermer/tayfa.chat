import tseslint from 'typescript-eslint';

// Deliberately focused correctness checks; TypeScript supplies binding/type validation.
// Formatting and legacy unused declarations are not used as a release readiness proxy.
export default [
  {
    ignores: [
      '**/node_modules/**',
      'dist/**',
      'dist-electron/**',
      'dist-services/**',
      'dist-native/**',
      'release/**',
      '.local/**',
      'upstream/**',
      'test-results/**',
      'playwright-report/**',
      // Private BoardUI Pro submodule (official builds only); linted in its own repository.
      'apps/desktop/src/boardui-pro/**',
    ],
  },
  {
    files: [
      'apps/**/*.{ts,tsx}',
      'packages/**/*.{ts,tsx}',
      'tests/**/*.{ts,tsx}',
      'scripts/**/*.{js,mjs,cjs}',
      '*.{ts,mjs}',
    ],
    languageOptions: { parser: tseslint.parser, ecmaVersion: 'latest', sourceType: 'module' },
    rules: {
      'no-debugger': 'error',
      'no-dupe-args': 'error',
      'no-duplicate-case': 'error',
      'no-unreachable': 'error',
      'no-unsafe-finally': 'error',
      'valid-typeof': 'error',
      'use-isnan': 'error',
      'no-loss-of-precision': 'error',
      'no-async-promise-executor': 'error',
    },
  },
];
