const eslint = require('@eslint/js');
const globals = require('globals');
const vue = require('eslint-plugin-vue');

module.exports = [
  {
    ignores: ['dist/**', 'node_modules/**', 'coverage/**', 'playwright-report/**', 'test-results/**'],
  },
  eslint.configs.recommended,
  ...vue.configs['flat/essential'],
  {
    files: ['src/**/*.{js,vue}'],
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
      globals: {
        ...globals.browser,
        process: 'readonly',
      },
    },
    rules: {
      'no-console': 'warn',
      'no-debugger': 'warn',
    },
  },
  {
    files: ['tests/**/*.js', 'scripts/**/*.{js,mjs}', 'services/**/*.{js,mjs}', '*.config.{js,mjs}'],
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
      globals: globals.node,
    },
  },
  {
    files: ['tests/e2e/**/*.js'],
    languageOptions: {
      globals: {
        ...globals.browser,
        ...globals.node,
      },
    },
  },
];
