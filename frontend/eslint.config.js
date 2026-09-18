// ESLint flat config. Replaces the CRA "react-app" preset.
//
// The rule set is deliberately close to what CRA enforced — the two classic
// hooks rules, TypeScript recommended, unused-vars as a warning — so the
// migration does not turn into a repo-wide style pass. The newer
// React-Compiler-era rules from eslint-plugin-react-hooks 7 — the Phase 5
// decision, measured on 2026-09-18:
//   • On, as errors: every rule with zero findings (`purity`, `immutability`,
//     `static-components`, `set-state-in-render`, `globals`, `error-boundaries`,
//     `use-memo`, `component-hook-factories`). They catch real bugs — impure
//     render, mutated props/state, components declared inside components,
//     setState during render — and cost nothing to hold.
//   • Off: `set-state-in-effect` (46 findings) and `refs` (10). They flag the
//     reset-a-form-when-the-sheet-opens effect and the latest-value ref, both
//     deliberate patterns here. Rewriting 56 working call sites for a compiler
//     this app does not use would be churn with regression risk and no
//     user-visible gain. Revisit if the React Compiler is adopted.
import js from '@eslint/js';
import globals from 'globals';
import tseslint from 'typescript-eslint';
import reactHooks from 'eslint-plugin-react-hooks';
import reactRefresh from 'eslint-plugin-react-refresh';

const testGlobals = {
  vi: 'readonly',
  describe: 'readonly',
  it: 'readonly',
  test: 'readonly',
  expect: 'readonly',
  beforeEach: 'readonly',
  afterEach: 'readonly',
  beforeAll: 'readonly',
  afterAll: 'readonly',
};

export default tseslint.config(
  {
    ignores: ['dist/**', 'build/**', 'node_modules/**', 'playwright-report/**', 'test-results/**', 'public/**'],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['src/**/*.{ts,tsx}', 'vite.config.ts', 'vite.proxy.ts', 'vite.proxy.test.ts'],
    languageOptions: {
      ecmaVersion: 2023,
      globals: { ...globals.browser, ...globals.es2021 },
    },
    plugins: {
      'react-hooks': reactHooks,
      'react-refresh': reactRefresh,
    },
    rules: {
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'warn',
      'react-hooks/purity': 'error',
      'react-hooks/immutability': 'error',
      'react-hooks/static-components': 'error',
      'react-hooks/set-state-in-render': 'error',
      'react-hooks/globals': 'error',
      'react-hooks/error-boundaries': 'error',
      'react-hooks/use-memo': 'error',
      'react-hooks/component-hook-factories': 'error',
      'react-refresh/only-export-components': 'off',
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-unused-vars': [
        'warn',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrors: 'none' },
      ],
      '@typescript-eslint/no-empty-object-type': 'off',
      'no-empty': ['error', { allowEmptyCatch: true }],
      'no-useless-assignment': 'off',
      'prefer-const': 'warn',
    },
  },
  {
    files: ['src/**/*.test.{ts,tsx}', 'src/setupTests.ts', 'vite.proxy.test.ts'],
    languageOptions: {
      globals: { ...globals.browser, ...globals.node, ...testGlobals },
    },
    rules: {
      '@typescript-eslint/no-unused-expressions': 'off',
      '@typescript-eslint/no-require-imports': 'off',
      'react-hooks/rules-of-hooks': 'off',
    },
  },
  {
    files: ['e2e/**/*.ts', 'playwright.config.ts', 'scripts/**/*.mjs', 'tailwind.config.js', 'postcss.config.js', 'eslint.config.js'],
    languageOptions: { globals: { ...globals.node } },
  },
);
