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
 *   Scoring.recordScene(idx, correct)           // 1 or 0 for scenes 1-6
 *   Scoring.recordDilemma(idx, correctPhases, totalPhases)  // scene 7
 *   Scoring.reset()                              // clear all (restart)
 *   Scoring.compute()                           // → 0..100
 *   Scoring.commit()                            // write to LMS + persist
 *
 * Policy:
 *   - Each of the N scenes contributes equally: weight = 100 / N.
 *   - Scenes 1-6: correct → full weight, wrong → 0.
 *   - Scene 7 (dilemma): partial credit = (correctPhases / totalPhases) × weight.
 *   - Total is clamped to [0, 100].
 */
(function (global) {
  'use strict';

  const Scoring = {};

  // sceneScores is a plain object: { sceneIdx: number }
  // We store a reference to the app's state object so scores persist via
  // the existing suspend_data mechanism — no separate storage layer.
  let _sceneScores = null;
  let _totalScenes = 7; // default; overwritten on init

  function init(sceneScoresRef, totalScenes) {
    _sceneScores = sceneScoresRef || {};
    _totalScenes = totalScenes || 7;
  }

  function recordScene(idx, correct) {
    if (!_sceneScores) _sceneScores = {};
    _sceneScores[idx] = correct ? 1 : 0;
  }

  // Dilemma gets partial credit: if the learner got 3/4 phases right,
  // they earn (3/4) × weight for that scene. We store the fraction as
  // a decimal so compute() can distinguish "0 = wrong" from "0 = no attempt".
  function recordDilemma(idx, correctPhases, totalPhases) {
    if (!_sceneScores) _sceneScores = {};
    if (totalPhases <= 0) { _sceneScores[idx] = 0; return; }
    const fraction = correctPhases / totalPhases;
    // Store as decimal (0.0–1.0). compute() multiplies by weight.
    // A perfect run stores 1.0 (same as a correct MCQ scene).
    _sceneScores[idx] = fraction;
  }

  function reset() {
    if (!_sceneScores) return;
    for (const k of Object.keys(_sceneScores)) {
      delete _sceneScores[k];
    }
  }

  function weightPerScene() {
    return _totalScenes > 0 ? 100 / _totalScenes : 0;
  }

  function compute() {
    if (!_sceneScores) return 0;
    const weight = weightPerScene();
    let total = 0;
    for (const v of Object.values(_sceneScores)) {
      if (typeof v !== 'number') continue;
      // v is 1 (full credit), 0 (no credit), or a fraction (dilemma partial).
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
  Scoring.reset = reset;
  Scoring.compute = compute;
  Scoring.commit = commit;
  Scoring.recordAndCommit = recordAndCommit;
  Scoring.weightPerScene = weightPerScene;

  global.Scoring = Scoring;
})(window);
