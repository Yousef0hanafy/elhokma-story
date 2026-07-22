/**
 * Test harness — loads a module in a mocked browser environment.
 *
 * Each module expects `window` (global), `document`, `localStorage`, etc.
 * We mock just enough for the modules to load and run. This lets us unit-test
 * pure-logic modules (Scoring, Version, ScormApi) without a real browser.
 *
 * Usage:
 *   const { window } = loadModule('js/scoring.js');
 *   assert(window.Scoring.compute() === 0);
 */

// ---------- Mock DOM ----------
function createMockWindow() {
  const win = {};
  const listeners = {};

  const mockElement = () => ({
    _children: [],
    classList: { _classes: new Set(), add(c) { this._classes.add(c); }, remove(c) { this._classes.delete(c); }, contains(c) { return this._classes.has(c); }, toggle(c, f) { if (f === undefined) f = !this._classes.has(c); if (f) this._classes.add(c); else this._classes.delete(c); } },
    style: {},
    attributes: {},
    dataset: {},
    innerHTML: '',
    textContent: '',
    setAttribute(k, v) { this.attributes[k] = v; },
    getAttribute(k) { return this.attributes[k] || null; },
    removeAttribute(k) { delete this.attributes[k]; },
    appendChild(child) { this._children.push(child); return child; },
    removeChild(child) { this._children = this._children.filter(c => c !== child); },
    querySelector: () => null,
    querySelectorAll: () => [],
    addEventListener: () => {},
    removeEventListener: () => {},
    focus: () => {},
    contains: () => false,
    dispatchEvent: () => true,
  });

  const mockDocument = {
    _elements: {},
    getElementById(id) { return this._elements[id] || null; },
    createElement: () => mockElement(),
    querySelector: () => null,
    querySelectorAll: () => [],
    addEventListener(type, cb) { (listeners[type] = listeners[type] || []).push(cb); },
    removeEventListener() {},
    body: mockElement(),
    head: mockElement(),
    documentElement: mockElement(),
    readyState: 'complete',
    visibilityState: 'visible',
  };

  const mockStorage = (() => {
    const data = {};
    return {
      getItem(k) { return k in data ? data[k] : null; },
      setItem(k, v) { data[k] = String(v); },
      removeItem(k) { delete data[k]; },
      clear() { Object.keys(data).forEach(k => delete data[k]); },
      get length() { return Object.keys(data).length; },
      key(i) { return Object.keys(data)[i] || null; },
    };
  })();

  win.window = win;
  win.document = mockDocument;
  win.localStorage = mockStorage;
  win.navigator = { serviceWorker: { register: () => Promise.reject(new Error('no SW in test')) } };
  win.speechSynthesis = undefined; // TTS will detect as unavailable
  win.matchMedia = () => ({ matches: false, addListener: () => {}, removeListener: () => {} });
  win.addEventListener = (type, cb) => { (listeners[type] = listeners[type] || []).push(cb); };
  win.removeEventListener = () => {};
  win.dispatchEvent = () => true;
  win.setTimeout = setTimeout;
  win.clearTimeout = clearTimeout;
  win.setInterval = setInterval;
  win.clearInterval = clearInterval;
  win.Date = Date;
  win.console = console;
  win.location = { search: '', href: 'http://localhost/' };
  win.URLSearchParams = URLSearchParams;
  win.requestAnimationFrame = (cb) => setTimeout(cb, 0);

  return win;
}

// Load a script file in a mock window environment.
// Returns the window object so tests can access globals the script set.
function loadModule(filePath, options = {}) {
  const fs = require('fs');
  const path = require('path');
  const win = createMockWindow();

  // Set up globals that the IIFE expects
  global.window = win;
  global.document = win.document;
  global.localStorage = win.localStorage;
  global.navigator = win.navigator;
  global.matchMedia = win.matchMedia;
  global.setTimeout = win.setTimeout;
  global.clearTimeout = win.clearTimeout;
  global.setInterval = win.setInterval;
  global.clearInterval = win.clearInterval;
  global.requestAnimationFrame = win.requestAnimationFrame;
  global.location = win.location;
  global.URLSearchParams = win.URLSearchParams;
  global.addEventListener = win.addEventListener;
  global.removeEventListener = win.removeEventListener;

  // Pre-populate STORY_CONTENT if provided (for modules that depend on it)
  if (options.content) {
    global.STORY_CONTENT = options.content;
    win.STORY_CONTENT = options.content;
  }

  // Pre-populate __APP_STATE__ if provided (for Version module)
  if (options.appState) {
    global.__APP_STATE__ = options.appState;
    win.__APP_STATE__ = options.appState;
  }

  // Read and execute the script in the global scope
  const code = fs.readFileSync(path.resolve(filePath), 'utf-8');
  // Use Function to evaluate in a scope where `window` refers to our mock
  const fn = new Function('window', 'document', 'localStorage', 'navigator', 'matchMedia', 'setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'requestAnimationFrame', 'location', 'URLSearchParams', 'addEventListener', 'removeEventListener', 'STORY_CONTENT', '__APP_STATE__', 'console', code);
  fn(win, win.document, win.localStorage, win.navigator, win.matchMedia, win.setTimeout, win.clearTimeout, win.setInterval, win.clearInterval, win.requestAnimationFrame, win.location, win.URLSearchParams, win.addEventListener, win.removeEventListener, options.content, options.appState, console);

  return win;
}

// ---------- Test runner ----------
let _tests = [];
let _passed = 0;
let _failed = 0;

function test(name, fn) {
  _tests.push({ name, fn });
}

function assert(condition, message) {
  if (!condition) throw new Error('Assertion failed: ' + message);
}

function assertEqual(actual, expected, message) {
  if (actual !== expected) {
    throw new Error(`Assertion failed: ${message || ''}\n  expected: ${JSON.stringify(expected)}\n  actual:   ${JSON.stringify(actual)}`);
  }
}

async function run() {
  console.log(`\nRunning ${_tests.length} tests...\n`);
  for (const { name, fn } of _tests) {
    try {
      await fn();
      _passed++;
      console.log(`  ✓ ${name}`);
    } catch (e) {
      _failed++;
      console.error(`  ✗ ${name}`);
      console.error(`    ${e.message}`);
    }
  }
  console.log(`\n${_passed} passed, ${_failed} failed`);
  if (_failed > 0) process.exit(1);
}

module.exports = { test, assert, assertEqual, run, loadModule, createMockWindow };
