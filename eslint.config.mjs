import { dirname } from 'path';
import { fileURLToPath } from 'url';
import { FlatCompat } from '@eslint/eslintrc';
import tseslint from 'typescript-eslint';

const compat = new FlatCompat({ baseDirectory: dirname(fileURLToPath(import.meta.url)) });

export default tseslint.config(
  {
    // The vendored ContextNest engine and CLI are an upstream mirror — linting
    // them here would produce a permanent diff against upstream that nobody can
    // land. They are covered by their own suite, which `pnpm test` runs.
    ignores: [
      'vendor/**',
      '.next/**',
      'node_modules/**',
      'next-env.d.ts',
      'tsconfig.tsbuildinfo',
    ],
  },

  ...compat.extends('next/core-web-vitals'),
  ...tseslint.configs.recommended,

  {
    rules: {
      // Deliberate escape hatch, used at boundaries where a value's shape is
      // asserted elsewhere (MCP authInfo, storage payloads). Flag it, don't fail
      // the build over it.
      '@typescript-eslint/no-explicit-any': 'warn',
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrors: 'none' },
      ],
    },
  },

  {
    // Test files legitimately reach for loose typing to build fixtures and stub
    // interfaces they only partially implement.
    files: ['**/*.test.ts', '**/*.test.tsx', 'scripts/**'],
    rules: {
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-non-null-assertion': 'off',
    },
  },
);
