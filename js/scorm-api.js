/**
 * SCORM 1.2 API Wrapper — lightweight, with localStorage fallback.
 * Reused from Phase 1 with minor refinements.
 */
(function (global) {
  'use strict';
  const SCORM = { api: null, initialized: false, isStandalone: false };
  const MAX_DEPTH = 10;

  function findAPIInWindow(win) {
    let depth = 0;
    while (win && win.API == null && win.parent && win.parent !== win && depth < MAX_DEPTH) {
      depth++; win = win.parent;
    }
    return win ? win.API : null;
  }
  function findAPI() {
    let api = findAPIInWindow(global.window);
    if (!api && global.window.opener) api = findAPIInWindow(global.window.opener);
    return api;
  }
  function init() {
    SCORM.api = findAPI();
    if (!SCORM.api) { SCORM.isStandalone = true; console.info('[SCORM] Standalone mode'); return false; }
    const r = SCORM.api.LMSInitialize('');
    if (r === 'true' || r === true) { SCORM.initialized = true; console.info('[SCORM] Initialized'); return true; }
    return false;
  }
  function get(k) { return SCORM.isStandalone || !SCORM.api ? getLocal(k) : SCORM.api.LMSGetValue(k); }
  function set(k, v) { if (SCORM.isStandalone || !SCORM.api) { setLocal(k, v); return true; } return SCORM.api.LMSSetValue(k, String(v)); }
  function commit() { if (SCORM.isStandalone || !SCORM.api) { flushLocal(); return true; } return SCORM.api.LMSCommit(''); }
  function finish() { if (SCORM.isStandalone || !SCORM.api) { flushLocal(); return true; } if (!SCORM.initialized) return true; SCORM.initialized = false; return SCORM.api.LMSFinish(''); }

  // localStorage
  const LS_KEY = 'scorm_gov_story_v1';
  let cache = {};
  try { cache = JSON.parse(localStorage.getItem(LS_KEY) || '{}'); } catch (e) { cache = {}; }
  let dirty = false;
  function getLocal(k) { return cache[k] !== undefined ? cache[k] : ''; }
  function setLocal(k, v) { cache[k] = String(v); dirty = true; }
  function flushLocal() { if (!dirty) return; try { localStorage.setItem(LS_KEY, JSON.stringify(cache)); } catch (e) {} dirty = false; }

  // High-level helpers
  const getStatus = () => get('cmi.core.lesson_status') || 'not attempted';
  const setStatus = (s) => { set('cmi.core.lesson_status', s); commit(); };
  const getScore = () => { const r = get('cmi.core.score.raw'); return r === '' ? null : parseInt(r, 10); };
  const setScore = (raw, min, max) => { set('cmi.core.score.raw', raw); if (min !== undefined) set('cmi.core.score.min', min); if (max !== undefined) set('cmi.core.score.max', max); commit(); };
  const getSuspendData = () => get('cmi.suspend_data');
  const setSuspendData = (json) => { const s = typeof json === 'string' ? json : JSON.stringify(json); set('cmi.suspend_data', s); commit(); };
  const getStudentName = () => get('cmi.core.student_name') || '';

  // Session time
  const start = Date.now();
  const fmtTime = () => {
    const e = Math.floor((Date.now() - start) / 1000);
    const pad = n => String(n).padStart(2, '0');
    return `${pad(Math.floor(e/3600))}:${pad(Math.floor((e%3600)/60))}:${pad(e%60)}`;
  };
  setInterval(() => { if (SCORM.initialized || SCORM.isStandalone) { set('cmi.core.session_time', fmtTime()); commit(); } }, 60000);
  global.addEventListener('beforeunload', () => { set('cmi.core.session_time', fmtTime()); finish(); });

  global.ScormApi = {
    init, get, set, commit, finish,
    getStatus, setStatus, getScore, setScore,
    getSuspendData, setSuspendData, getStudentName,
    isStandalone: () => SCORM.isStandalone,
  };
})(window);
