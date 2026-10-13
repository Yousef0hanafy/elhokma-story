/**
 * Unit tests for the Scoring module.
 *
 * The course has 7 scenes but only 6 carry an assessment (the opening scene
 * has none), so app.js initializes Scoring with 6 scored scenes. These tests
 * use the real scene layout: MCQ scenes at indexes 1–5, the dilemma at 6.
 */
const { test, assert, assertEqual, run, loadModule } = require('./harness');

const win = loadModule('js/scoring.js');
const Scoring = win.Scoring;
const MCQ_SCENES = [1, 2, 3, 4, 5];
const DILEMMA = 6;
const SCORED = 6;

test('Scoring module loads', () => {
  assert(Scoring, 'Scoring should be defined');
  assert(typeof Scoring.init === 'function', 'init should be a function');
  assert(typeof Scoring.compute === 'function', 'compute should be a function');
});

test('Initial score is 0 with no scores recorded', () => {
  Scoring.init({}, SCORED);
  assertEqual(Scoring.compute(), 0, 'empty scores should compute to 0');
});

test('Perfect run over the real scene layout = 100', () => {
  Scoring.init({}, SCORED);
  MCQ_SCENES.forEach(i => Scoring.recordScene(i, true));
  Scoring.recordDilemma(DILEMMA, 4, 4);
  assertEqual(Scoring.compute(), 100, 'all assessed scenes correct = 100');
});

test('Single correct scene = 100/6 ≈ 17', () => {
  Scoring.init({}, SCORED);
  Scoring.recordScene(1, true);
  assertEqual(Scoring.compute(), 17, '1/6 correct = 17% (rounded)');
});

test('All wrong = 0', () => {
  Scoring.init({}, SCORED);
  MCQ_SCENES.forEach(i => Scoring.recordScene(i, false));
  Scoring.recordDilemma(DILEMMA, 0, 4);
  assertEqual(Scoring.compute(), 0, 'all wrong = 0');
});

test('Dilemma partial credit (3/4 phases)', () => {
  Scoring.init({}, SCORED);
  MCQ_SCENES.forEach(i => Scoring.recordScene(i, true));
  Scoring.recordDilemma(DILEMMA, 3, 4);
  // 5 full + 0.75 = 5.75 × (100/6) = 95.83 → 96
  assertEqual(Scoring.compute(), 96, '5 correct + 3/4 dilemma = 96');
});

test('One wrong MCQ still passes the 70% bar; two wrong do not with a weak dilemma', () => {
  Scoring.init({}, SCORED);
  [1, 2, 3, 4].forEach(i => Scoring.recordScene(i, true));
  Scoring.recordScene(5, false);
  Scoring.recordDilemma(DILEMMA, 4, 4);
  assertEqual(Scoring.compute(), 83, '5/6 = 83');
  Scoring.init({}, SCORED);
  [1, 2, 3].forEach(i => Scoring.recordScene(i, true));
  [4, 5].forEach(i => Scoring.recordScene(i, false));
  Scoring.recordDilemma(DILEMMA, 1, 4);
  assertEqual(Scoring.compute(), 54, '3 + 0.25 of 6 = 54');
});

test('first_attempt (default): a retry never changes the recorded result', () => {
  Scoring.init({}, SCORED);
  Scoring.recordScene(1, false);
  Scoring.recordScene(1, true);
  assertEqual(Scoring.compute(), 0, 'wrong first answer stays recorded');
  Scoring.recordDilemma(DILEMMA, 2, 4);
  Scoring.recordDilemma(DILEMMA, 4, 4);
  assertEqual(Scoring.compute(), 8, 'first dilemma result (0.5 × 16.67) stays');
  assert(Scoring.isRecorded(1), 'scene 1 recorded');
  assert(!Scoring.isRecorded(2), 'scene 2 not recorded');
});

test('best_attempt: a better result replaces a worse one, never the reverse', () => {
  Scoring.init({}, SCORED, 'best_attempt');
  Scoring.recordScene(1, false);
  Scoring.recordScene(1, true);
  assertEqual(Scoring.compute(), 17, 'retry upgrades the scene');
  Scoring.recordScene(1, false);
  assertEqual(Scoring.compute(), 17, 'a later wrong answer does not downgrade');
});

test('Reset clears all scores', () => {
  Scoring.init({}, SCORED);
  Scoring.recordScene(1, true);
  Scoring.recordScene(2, true);
  assertEqual(Scoring.compute(), 33, '2 correct = 33');
  Scoring.reset();
  assertEqual(Scoring.compute(), 0, 'after reset = 0');
});

test('recordAndCommit calls both record and commit', () => {
  let committed = null;
  const origScormApi = win.ScormApi;
  win.ScormApi = { setScore: (raw) => { committed = raw; } };
  Scoring.init({}, SCORED);
  Scoring.recordAndCommit(1, true);
  assertEqual(committed, 17, 'commit should send the computed score');
  win.ScormApi = origScormApi;
});

test('Score never exceeds 100', () => {
  Scoring.init({}, SCORED);
  for (let i = 0; i < 10; i++) Scoring.recordScene(i, true);
  assertEqual(Scoring.compute(), 100, 'score capped at 100');
});

test('Weight per scene is 100/N', () => {
  Scoring.init({}, SCORED);
  assertEqual(Scoring.weightPerScene(), 100 / 6, 'weight = 100/6');
  Scoring.init({}, 10);
  assertEqual(Scoring.weightPerScene(), 10, 'weight = 10 for 10 scenes');
});

run();
