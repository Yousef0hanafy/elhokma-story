/**
 * Version — course versioning and completion-record tracking.
 *
 * Why this exists: healthcare governance training is regulated. An auditor
 * may ask "which version of the training did Dr. X complete?" The product
 * must be able to answer that question for any past completion.
 *
 * Design:
 *  - CONTENT.course.version is the source of truth for the current content
 *    version (semantic version: MAJOR.MINOR.PATCH).
 *  - On completion, the version is stamped into the completion record and
 *    persisted in suspend_data.completion. The completion screen and
 *    printable certificate both display the version.
 *  - On load, if the persisted completion version differs from the current
 *    content version, the learner sees a "content updated" notice on the
 *    completion screen — their completion is still valid, but they may
 *    want to review the updated content.
 *  - The version is also written to cmi.core.lesson_location (SCORM 1.2
 *    allows free-form strings) as a secondary audit trail for LMSs that
 *    expose it in reports.
 *
 * API:
 *   Version.current()              // → '1.0.0' (from CONTENT.course.version)
 *   Version.label()                // → 'إصدار ١.٠.٠' (human-readable)
 *   Version.stampCompletion()      // records {version, date, score} in state
 *   Version.getCompletion()        // → {version, date, score} or null
 *   Version.isStale()              // did the learner complete an older version?
 *
 * Migration: suspend_data written by older versions (pre-versioning) has no
 * `completion` field. Version.getCompletion() returns null in that case,
 * and the completion screen shows the current version without a "stale"
 * notice. This is forward-compatible — no migration code needed.
 */
(function (global) {
  'use strict';

  const Version = {};

  function getContent() {
    return (global.STORY_CONTENT && global.STORY_CONTENT.course) || {};
  }

  function current() {
    return getContent().version || '0.0.0';
  }

  function label() {
    return getContent().version_label || ('إصدار ' + current());
  }

  // Compare two semver strings. Returns:
  //  -1 if a < b, 0 if equal, 1 if a > b
  function compareVersions(a, b) {
    const pa = String(a || '0').split('.').map(n => parseInt(n, 10) || 0);
    const pb = String(b || '0').split('.').map(n => parseInt(n, 10) || 0);
    for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
      const va = pa[i] || 0;
      const vb = pb[i] || 0;
      if (va < vb) return -1;
      if (va > vb) return 1;
    }
    return 0;
  }

  // Stamp the current version + date + score into the app's completion record.
  // Called when the learner finishes the course. Persists via the app's
  // saveState() mechanism (the app owns the state object; we just write to
  // a well-known field on it).
  function stampCompletion(score) {
    if (!global.__APP_STATE__) return;
    global.__APP_STATE__.completion = {
      version: current(),
      date: new Date().toISOString(),
      score: score,
    };
  }

  function getCompletion() {
    return (global.__APP_STATE__ && global.__APP_STATE__.completion) || null;
  }

  // Did the learner complete an older version of the content?
  function isStale() {
    const c = getCompletion();
    if (!c || !c.version) return false;
    return compareVersions(c.version, current()) < 0;
  }

  Version.current = current;
  Version.label = label;
  Version.stampCompletion = stampCompletion;
  Version.getCompletion = getCompletion;
  Version.isStale = isStale;
  Version.compareVersions = compareVersions;

  global.Version = Version;
})(window);
