/**
 * Unit tests for the Scoring module.
 *
 * Scoring is the single source of truth for SCORM score computation.
 * These tests verify:
 *   - Basic score calculation (each scene = 100/N weight)
 *   - Partial credit for dilemma scenes
 *   - Edge cases (no scores, all correct, all wrong)
 *   - Reset behavior
 *   - Commit calls through to ScormApi
 */
const { test, assert, assertEqual, run, loadModule } = require('./harness');

// Load Scoring module — it doesn't depend on STORY_CONTENT, so no content needed
const win = loadModule('js/scoring.js');
const Scoring = win.Scoring;

test('Scoring module loads', () => {
  assert(Scoring, 'Scoring should be defined');
  assert(typeof Scoring.init === 'function', 'init should be a function');
  assert(typeof Scoring.compute === 'function', 'compute should be a function');
});

test('Initial score is 0 with no scores recorded', () => {
  Scoring.init({}, 7);
  assertEqual(Scoring.compute(), 0, 'empty scores should compute to 0');
});

test('Single correct scene = 100/7 ≈ 14', () => {
  Scoring.init({}, 7);
  Scoring.recordScene(0, true);
  assertEqual(Scoring.compute(), 14, '1/7 correct = 14% (rounded)');
});

test('All 7 correct = 100', () => {
  Scoring.init({}, 7);
  for (let i = 0; i < 6; i++) Scoring.recordScene(i, true);
  Scoring.recordDilemma(6, 4, 4);
  assertEqual(Scoring.compute(), 100, 'all correct = 100');
});

test('All wrong = 0', () => {
  Scoring.init({}, 7);
  for (let i = 0; i < 6; i++) Scoring.recordScene(i, false);
  Scoring.recordDilemma(6, 0, 4);
  assertEqual(Scoring.compute(), 0, 'all wrong = 0');
});

test('Dilemma partial credit (3/4 phases)', () => {
  Scoring.init({}, 7);
  for (let i = 0; i < 6; i++) Scoring.recordScene(i, true);
  Scoring.recordDilemma(6, 3, 4);
  // 6 full + 0.75 for dilemma = 6.75 * (100/7) = 96.43 → rounded 96
  assertEqual(Scoring.compute(), 96, '6 correct + 3/4 dilemma = 96');
});

test('Dilemma zero phases = 0 for that scene', () => {
  Scoring.init({}, 7);
  for (let i = 0; i < 6; i++) Scoring.recordScene(i, true);
  Scoring.recordDilemma(6, 0, 4);
  // 6 full + 0 = 6 * (100/7) = 85.71 → rounded 86
  assertEqual(Scoring.compute(), 86, '6 correct + 0/4 dilemma = 86');
});

test('Reset clears all scores', () => {
  Scoring.init({}, 7);
  Scoring.recordScene(0, true);
  Scoring.recordScene(1, true);
  assertEqual(Scoring.compute(), 29, '2 correct = 29');
  Scoring.reset();
  assertEqual(Scoring.compute(), 0, 'after reset = 0');
});

test('recordAndCommit calls both record and commit', () => {
  let commitCalled = false;
  const origScormApi = win.ScormApi;
  win.ScormApi = { setScore: () => { commitCalled = true; } };
  Scoring.init({}, 7);
  Scoring.recordAndCommit(0, true);
  assert(commitCalled, 'commit should have been called');
  assertEqual(Scoring.compute(), 14, 'score should be recorded');
  win.ScormApi = origScormApi;
});

test('Score never exceeds 100', () => {
  Scoring.init({}, 7);
  // Record more scenes than exist — should still cap at 100
  for (let i = 0; i < 10; i++) Scoring.recordScene(i, true);
  assertEqual(Scoring.compute(), 100, 'score capped at 100');
});

test('Score never goes below 0', () => {
  Scoring.init({}, 7);
  Scoring.recordScene(0, false);
  Scoring.recordScene(0, false); // double-record
  assertEqual(Scoring.compute(), 0, 'score floored at 0');
});

test('Weight per scene is 100/N', () => {
  Scoring.init({}, 7);
  assertEqual(Scoring.weightPerScene(), 100 / 7, 'weight = 100/7');
  Scoring.init({}, 10);
  assertEqual(Scoring.weightPerScene(), 10, 'weight = 10 for 10 scenes');
});

run();
