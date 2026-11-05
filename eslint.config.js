import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import globals from 'globals';

export default tseslint.config(
  {
    ignores: [
      '**/dist/**',
      '**/node_modules/**',
      'handoff/**',
      '**/coverage/**',
      '**/playwright-report/**',
      '**/test-results/**',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['**/*.{ts,tsx}'],
    languageOptions: { ecmaVersion: 2022 },
    rules: {
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
    },
  },
  { files: ['scripts/**/*.{mjs,ts}', '**/*.config.{js,ts,mjs}'], languageOptions: { globals: globals.node } },
  { files: ['apps/web/**/*.{ts,tsx}'], languageOptions: { globals: globals.browser } },
  { files: ['apps/server/**/*.ts', 'e2e/**/*.ts'], languageOptions: { globals: globals.node } },
);
