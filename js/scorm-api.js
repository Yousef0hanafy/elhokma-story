/**
 * SCORM 1.2 API Wrapper — lightweight, with localStorage fallback.
 *
 * Production hardening:
 * - Session-time interval is stored and cleared on finish() to prevent leaks.
 * - visibilitychange + pagehide handlers complement beforeunload (more reliable
 *   on mobile Safari and Chrome on iOS, which often skip beforeunload).
 * - LMSCommit calls are debounced so burst updates (e.g. suspend_data writes
 *   during exploration) collapse into a single network round-trip.
 * - All API calls are wrapped in try/catch — a misbehaving LMS must never
 *   break the learner's experience.
 */
(function (global) {
  'use strict';

  const SCORM = {
    api: null,
    initialized: false,
    isStandalone: false,
    finished: false,
  };
  const MAX_DEPTH = 10;

  function findAPIInWindow(win) {
    let depth = 0;
    while (win && win.API == null && win.parent && win.parent !== win && depth < MAX_DEPTH) {
      depth++; win = win.parent;
    }
    return win ? win.API : null;
  }
  function findAPI() {
    try {
      let api = findAPIInWindow(global.window);
      if (!api && global.window.opener) {
        try { api = findAPIInWindow(global.window.opener); } catch (e) { /* cross-origin opener */ }
      }
      return api;
    } catch (e) {
      return null;
    }
  }

  function init() {
    SCORM.api = findAPI();
    if (!SCORM.api) {
      SCORM.isStandalone = true;
      console.info('[SCORM] Standalone mode');
      return false;
    }
    try {
      const r = SCORM.api.LMSInitialize('');
      if (r === 'true' || r === true) {
        SCORM.initialized = true;
        console.info('[SCORM] Initialized');
        return true;
      }
    } catch (e) {
      console.warn('[SCORM] LMSInitialize threw:', e);
    }
    return false;
  }

  function get(k) {
    if (SCORM.isStandalone || !SCORM.api) return getLocal(k);
    try { return SCORM.api.LMSGetValue(k); }
    catch (e) { console.warn('[SCORM] LMSGetValue failed:', k, e); return getLocal(k); }
  }

  function set(k, v) {
    if (SCORM.isStandalone || !SCORM.api) { setLocal(k, v); return true; }
    try { return SCORM.api.LMSSetValue(k, String(v)); }
    catch (e) { console.warn('[SCORM] LMSSetValue failed:', k, e); return false; }
  }

  // Debounced commit — collapses rapid setSuspendData() calls into one LMSCommit.
  let commitTimer = null;
  const COMMIT_DEBOUNCE_MS = 600;
  function commit() {
    if (SCORM.isStandalone || !SCORM.api) { flushLocal(); return true; }
    if (commitTimer) clearTimeout(commitTimer);
    commitTimer = setTimeout(() => {
      commitTimer = null;
      try { SCORM.api.LMSCommit(''); }
      catch (e) { console.warn('[SCORM] LMSCommit failed:', e); }
    }, COMMIT_DEBOUNCE_MS);
    return true;
  }
  // Force-flush — used by finish() and unload handlers.
  function commitNow() {
    if (commitTimer) { clearTimeout(commitTimer); commitTimer = null; }
    if (SCORM.isStandalone || !SCORM.api) { flushLocal(); return true; }
    try { return SCORM.api.LMSCommit(''); }
    catch (e) { console.warn('[SCORM] LMSCommit failed:', e); return false; }
  }

  function finish() {
    if (SCORM.finished) return true;
    SCORM.finished = true;
    if (sessionTimer) { clearInterval(sessionTimer); sessionTimer = null; }
    if (SCORM.isStandalone || !SCORM.api) { flushLocal(); return true; }
    if (!SCORM.initialized) return true;
    SCORM.initialized = false;
    try {
      set('cmi.core.session_time', fmtTime());
      commitNow();
      return SCORM.api.LMSFinish('');
    } catch (e) {
      console.warn('[SCORM] LMSFinish failed:', e);
      return false;
    }
  }

  // ---------- localStorage fallback ----------
  const LS_KEY = 'scorm_gov_story_v1';
  let cache = {};
  try { cache = JSON.parse(localStorage.getItem(LS_KEY) || '{}'); } catch (e) { cache = {}; }
  let dirty = false;
  function getLocal(k) { return cache[k] !== undefined ? cache[k] : ''; }
  function setLocal(k, v) { cache[k] = String(v); dirty = true; }
  function flushLocal() {
    if (!dirty) return;
    try { localStorage.setItem(LS_KEY, JSON.stringify(cache)); }
    catch (e) { /* quota / private mode — best-effort */ }
    dirty = false;
  }

  // ---------- High-level helpers ----------
  const getStatus = () => get('cmi.core.lesson_status') || 'not attempted';
  const setStatus = (s) => { set('cmi.core.lesson_status', s); commit(); };
  const getScore = () => {
    const r = get('cmi.core.score.raw');
    if (r === '' || r === null || r === undefined) return null;
    const n = parseInt(r, 10);
    return Number.isNaN(n) ? null : n;
  };
  const setScore = (raw, min, max) => {
    set('cmi.core.score.raw', raw);
    if (min !== undefined) set('cmi.core.score.min', min);
    if (max !== undefined) set('cmi.core.score.max', max);
    commit();
  };
  const getSuspendData = () => get('cmi.suspend_data');
  const setSuspendData = (json) => {
    const s = typeof json === 'string' ? json : JSON.stringify(json);
    set('cmi.suspend_data', s);
    commit();
  };
  const getStudentName = () => get('cmi.core.student_name') || '';

  // ---------- Session time tracking ----------
  const start = Date.now();
  const fmtTime = () => {
    const e = Math.floor((Date.now() - start) / 1000);
    const pad = n => String(n).padStart(2, '0');
    return `${pad(Math.floor(e / 3600))}:${pad(Math.floor((e % 3600) / 60))}:${pad(e % 60)}`;
  };

  // Store the timer so finish() can clear it. Previously it leaked forever.
  let sessionTimer = null;
  function startSessionTimer() {
    if (sessionTimer) return;
    sessionTimer = setInterval(() => {
      if (SCORM.initialized || SCORM.isStandalone) {
        set('cmi.core.session_time', fmtTime());
        commit();
      }
    }, 60000);
    // Allow the timer to die with the page — no keeping the event loop alive.
    if (sessionTimer && typeof sessionTimer.unref === 'function') sessionTimer.unref();
  }
  startSessionTimer();

  // ---------- Unload handling ----------
  // beforeunload is unreliable on mobile Safari / Chrome iOS. pagehide + visibilitychange
  // cover those cases. We bind all three but finish() is idempotent (SCORM.finished guard).
  function handleUnload() {
    try {
      if (!SCORM.finished) {
        set('cmi.core.session_time', fmtTime());
        finish();
      }
    } catch (e) { /* never let unload throw */ }
  }
  global.addEventListener('beforeunload', handleUnload);
  global.addEventListener('pagehide', handleUnload);
  document.addEventListener('visibilitychange', () => {
    // On hidden (tab switch / backgrounded), flush session time — some LMS
    // environments never see beforeunload if the user just closes the tab.
    if (document.visibilityState === 'hidden' && !SCORM.finished) {
      try {
        set('cmi.core.session_time', fmtTime());
        commitNow();
      } catch (e) { /* best-effort */ }
    }
  });

  global.ScormApi = {
    init, get, set, commit, commitNow, finish,
    getStatus, setStatus, getScore, setScore,
    getSuspendData, setSuspendData, getStudentName,
    isStandalone: () => SCORM.isStandalone,
    isInitialized: () => SCORM.initialized,
  };
})(window);
