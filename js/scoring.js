/**
 * Scoring — single source of truth for SCORM score computation.
 *
 * Why this exists: the score formula (correctScenes × 100/totalScenes) was
 * duplicated in 5 places across app.js, with subtle variations:
 *   - handleBoardroomAssessmentAnswer (simple version)
 *   - handleGenericAssessmentAnswer (simple version)
 *   - showDilemmaFinalCTA (with partial-credit for dilemma phases)
 *   - resetAssessmentInPlace (recompute after wrong answer)
 *   - restartCourse (reset to 0)
 *
 * Any change to the scoring policy required editing all 5 sites. Any miss
 * produced inconsistent scores. This module centralizes the policy so a
 * future engineer changes the formula in exactly one place.
 *
 * API:
 *   Scoring.init(sceneScoresRef, scoredSceneCount, policy)
 *   Scoring.recordScene(idx, correct)           // 1 or 0 for an MCQ scene
 *   Scoring.recordDilemma(idx, correctPhases, totalPhases)  // partial credit
 *   Scoring.isRecorded(idx)                     // has this scene been scored?
 *   Scoring.reset()                              // clear all (restart)
 *   Scoring.compute()                           // → 0..100
 *   Scoring.commit()                            // write to LMS + persist
 *
 * Policy:
 *   - Only scenes that carry an assessment count. The opening scene has no
 *     question, so a 7-scene course with 6 assessed scenes weighs each
 *     assessed scene 100 / 6. (Dividing by all 7 scenes capped the best
 *     possible score at 86.)
 *   - MCQ scenes: correct → full weight, wrong → 0.
 *   - Dilemma: partial credit = (correctPhases / totalPhases) × weight.
 *   - 'first_attempt' (default): the first recorded result for a scene is
 *     final; retries never change it. 'best_attempt': a better result
 *     replaces a worse one.
 *   - Total is clamped to [0, 100].
 */
(function (global) {
  'use strict';

  const Scoring = {};

  // sceneScores is a plain object: { sceneIdx: number }
  // We store a reference to the app's state object so scores persist via
  // the existing suspend_data mechanism — no separate storage layer.
  let _sceneScores = null;
  let _scoredScenes = 1;
  let _policy = 'first_attempt';

  function init(sceneScoresRef, scoredSceneCount, policy) {
    _sceneScores = sceneScoresRef || {};
    _scoredScenes = scoredSceneCount > 0 ? scoredSceneCount : 1;
    _policy = policy === 'best_attempt' ? 'best_attempt' : 'first_attempt';
  }

  function isRecorded(idx) {
    return !!_sceneScores && typeof _sceneScores[idx] === 'number';
  }

  function store(idx, value) {
    if (!_sceneScores) _sceneScores = {};
    if (isRecorded(idx)) {
      if (_policy === 'first_attempt') return;
      if (value <= _sceneScores[idx]) return;
    }
    _sceneScores[idx] = value;
  }

  function recordScene(idx, correct) {
    store(idx, correct ? 1 : 0);
  }

  // Dilemma gets partial credit: if the learner got 3/4 phases right,
  // they earn (3/4) × weight for that scene, stored as a 0.0–1.0 fraction.
  function recordDilemma(idx, correctPhases, totalPhases) {
    store(idx, totalPhases > 0 ? Math.max(0, Math.min(1, correctPhases / totalPhases)) : 0);
  }

  function reset() {
    if (!_sceneScores) return;
    for (const k of Object.keys(_sceneScores)) {
      delete _sceneScores[k];
    }
  }

  function weightPerScene() {
    return 100 / _scoredScenes;
  }

  function compute() {
    if (!_sceneScores) return 0;
    const weight = weightPerScene();
    let total = 0;
    for (const v of Object.values(_sceneScores)) {
      if (typeof v !== 'number') continue;
      total += v * weight;
    }
    return Math.min(100, Math.max(0, Math.round(total)));
  }

  function commit() {
    if (global.ScormApi) {
      global.ScormApi.setScore(compute(), 0, 100);
    }
  }

  // Convenience: record + commit in one call (the common case).
  function recordAndCommit(idx, correct) {
    recordScene(idx, correct);
    commit();
  }

  Scoring.init = init;
  Scoring.recordScene = recordScene;
  Scoring.recordDilemma = recordDilemma;
  Scoring.isRecorded = isRecorded;
  Scoring.reset = reset;
  Scoring.compute = compute;
  Scoring.commit = commit;
  Scoring.recordAndCommit = recordAndCommit;
  Scoring.weightPerScene = weightPerScene;

  global.Scoring = Scoring;
})(window);
