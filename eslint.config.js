import lomrayConfig from '@lomray/eslint-config';
import globals from 'globals';

export default [
  { ignores: ['node_modules/**', 'lib/**', 'coverage/**'] },
  ...lomrayConfig.config({
    files: ['src/**/*.ts', 'tests/**/*.ts', 'vitest.config.ts'],
    languageOptions: {
      globals: { ...globals.node, NodeJS: true },
      parserOptions: { projectService: true, tsconfigRootDir: import.meta.dirname },
    },
    settings: {
      'import-x/resolver': { typescript: { project: './tsconfig.json' } },
    },
    rules: {
      // Native ESM imports must retain .js extensions in the emitted CLI.
      'import-x/extensions': 'off',
      'import-x/prefer-default-export': 'off',
      // Filesystem walks and CLI prompts intentionally preserve operation order.
      'no-await-in-loop': 'off',
      // This package runs in Node and uses its standard library directly.
      'no-console': 'off',
      'no-restricted-imports': 'off',
    },
  }),
  {
    files: ['tests/**/*.ts'],
    // Keep each test's command arguments and expected paths readable on their own.
    rules: { 'sonarjs/no-duplicate-string': 'off' },
  },
];
