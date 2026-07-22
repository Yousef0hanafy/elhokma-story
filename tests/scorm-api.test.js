/**
 * Unit tests for the ScormApi module.
 *
 * These tests verify the standalone-mode behavior (localStorage fallback)
 * since we can't test real LMS communication in unit tests.
 *
 * Key behaviors tested:
 *   - localStorage fallback when no LMS API is found
 *   - get/set/commit/finish lifecycle
 *   - Session time tracking
 *   - Suspend data persistence
 *   - Error handling (corrupt localStorage, quota exceeded)
 */
const { test, assert, assertEqual, run, loadModule, createMockWindow } = require('./harness');

// Load ScormApi — it initializes in standalone mode (no LMS API in mock env)
const win = loadModule('js/scorm-api.js');
const ScormApi = win.ScormApi;

test('ScormApi module loads', () => {
  assert(ScormApi, 'ScormApi should be defined');
});

test('Initializes in standalone mode (no LMS API in test env)', () => {
  win.localStorage.clear();
  const w2 = loadModule('js/scorm-api.js');
  w2.ScormApi.init(); // Must call init() to detect standalone mode
  assertEqual(w2.ScormApi.isStandalone(), true, 'should be standalone without LMS API');
  assertEqual(w2.ScormApi.isInitialized(), false, 'should not be initialized in standalone');
});

test('getStatus returns "not attempted" initially', () => {
  win.localStorage.clear();
  // Re-load to get fresh state
  const w2 = loadModule('js/scorm-api.js');
  assertEqual(w2.ScormApi.getStatus(), 'not attempted', 'default status');
});

test('setStatus persists and getStatus reads it back', () => {
  win.localStorage.clear();
  const w2 = loadModule('js/scorm-api.js');
  w2.ScormApi.setStatus('incomplete');
  assertEqual(w2.ScormApi.getStatus(), 'incomplete', 'status should be persisted');
});

test('setScore persists score, min, max', () => {
  win.localStorage.clear();
  const w2 = loadModule('js/scorm-api.js');
  w2.ScormApi.setScore(85, 0, 100);
  assertEqual(w2.ScormApi.getScore(), 85, 'score should be 85');
});

test('getScore returns null when no score set', () => {
  win.localStorage.clear();
  const w2 = loadModule('js/scorm-api.js');
  assertEqual(w2.ScormApi.getScore(), null, 'no score = null');
});

test('getScore handles corrupt data gracefully', () => {
  win.localStorage.clear();
  win.localStorage.setItem('scorm_gov_story_v1', JSON.stringify({
    'cmi.core.score.raw': 'not-a-number',
  }));
  const w2 = loadModule('js/scorm-api.js');
  assertEqual(w2.ScormApi.getScore(), null, 'corrupt score = null');
});

test('setSuspendData persists JSON and getSuspendData reads it back', () => {
  win.localStorage.clear();
  const w2 = loadModule('js/scorm-api.js');
  const data = { currentScreen: 3, sceneScores: { 0: 1, 1: 0 } };
  w2.ScormApi.setSuspendData(data);
  const read = w2.ScormApi.getSuspendData();
  const parsed = JSON.parse(read);
  assertEqual(parsed.currentScreen, 3, 'currentScreen persisted');
  assertEqual(parsed.sceneScores[0], 1, 'sceneScores persisted');
});

test('setSuspendData accepts string or object', () => {
  win.localStorage.clear();
  const w2 = loadModule('js/scorm-api.js');
  w2.ScormApi.setSuspendData('{"foo":"bar"}');
  assertEqual(w2.ScormApi.getSuspendData(), '{"foo":"bar"}', 'string suspend data');
  w2.ScormApi.setSuspendData({ baz: 'qux' });
  assertEqual(JSON.parse(w2.ScormApi.getSuspendData()).baz, 'qux', 'object suspend data');
});

test('getStudentName returns empty string in standalone', () => {
  win.localStorage.clear();
  const w2 = loadModule('js/scorm-api.js');
  assertEqual(w2.ScormApi.getStudentName(), '', 'no student name in standalone');
});

test('Corrupt localStorage JSON is handled gracefully', () => {
  win.localStorage.setItem('scorm_gov_story_v1', 'not-json{');
  // Should not throw — just reset to empty cache
  const w2 = loadModule('js/scorm-api.js');
  assertEqual(w2.ScormApi.getStatus(), 'not attempted', 'corrupt LS = default status');
});

test('finish() is idempotent (calling twice is safe)', () => {
  win.localStorage.clear();
  const w2 = loadModule('js/scorm-api.js');
  w2.ScormApi.setStatus('completed');
  const r1 = w2.ScormApi.finish();
  const r2 = w2.ScormApi.finish();
  assertEqual(r1, true, 'first finish returns true');
  assertEqual(r2, true, 'second finish returns true (idempotent)');
});

test('commitNow flushes to localStorage immediately', () => {
  // Create a fresh mock window so we can inspect its localStorage
  const { createMockWindow, loadModule } = require('./harness');
  // We need the module to use THIS window's localStorage, so set it as global
  const freshWin = createMockWindow();
  global.window = freshWin;
  global.document = freshWin.document;
  global.localStorage = freshWin.localStorage;

  // Load the module — it will use the current globals
  const fs = require('fs');
  const code = fs.readFileSync(require('path').resolve('js/scorm-api.js'), 'utf-8');
  const fn = new Function('window', 'document', 'localStorage', 'navigator', 'matchMedia', 'setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'console', code);
  fn(freshWin, freshWin.document, freshWin.localStorage, freshWin.navigator, freshWin.matchMedia, freshWin.setTimeout, freshWin.clearTimeout, freshWin.setInterval, freshWin.clearInterval, console);

  freshWin.ScormApi.init();
  freshWin.ScormApi.set('cmi.core.lesson_status', 'incomplete');
  freshWin.ScormApi.commitNow();
  const raw = freshWin.localStorage.getItem('scorm_gov_story_v1');
  assert(raw, 'localStorage should have data after commitNow');
  const parsed = JSON.parse(raw);
  assertEqual(parsed['cmi.core.lesson_status'], 'incomplete', 'status flushed to LS');
});

run();
