// ESLint flat config. The app is plain browser scripts (no modules, no
// bundler): each file is an IIFE that publishes one global on `window`.
// The globals below are those cross-module names, declared read-only so a
// typo or a missing <script> tag fails lint instead of failing in an LMS.
const globals = require('globals');

const APP_GLOBALS = {
  STORY_CONTENT: 'readonly',
  ErrorBoundary: 'readonly',
  ScormApi: 'readonly',
  Scoring: 'readonly',
  Version: 'readonly',
  TTS: 'readonly',
  AudioProvider: 'readonly',
  TTSProvider: 'readonly',
  NarrationManager: 'readonly',
  Narrator: 'readonly',
  Animator: 'readonly',
  ModalManager: 'readonly',
};

module.exports = [
  { ignores: ['node_modules/**', 'dist/**'] },
  {
    files: ['js/**/*.js'],
    languageOptions: {
      ecmaVersion: 2020,
      sourceType: 'script',
      globals: { ...globals.browser, ...APP_GLOBALS },
    },
    rules: {
      'no-undef': 'error',
      'no-unused-vars': ['error', { args: 'none', caughtErrors: 'none' }],
      'no-eval': 'error',
      'no-implied-eval': 'error',
      'no-new-func': 'error',
      'no-console': ['error', { allow: ['info', 'warn', 'error'] }],
      eqeqeq: ['error', 'smart'],
    },
  },
  {
    files: ['sw.js'],
    languageOptions: {
      ecmaVersion: 2020,
      sourceType: 'script',
      globals: { ...globals.serviceworker },
    },
  },
  {
    files: ['tests/**/*.js', 'scripts/**/*.js', 'eslint.config.js'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'commonjs',
      globals: { ...globals.node },
    },
  },
];
