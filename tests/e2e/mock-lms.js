/**
 * Mock SCORM 1.2 LMS, injected into the page before any app script runs.
 *
 * It behaves like a strict LMS so tests catch what lenient LMSs hide:
 *  - Values are validated (lesson_status / exit vocabularies, score range,
 *    session_time format, 4096-char suspend_data limit). Invalid writes
 *    return 'false' and set an error code, like a real LMS.
 *  - The data model is persisted in localStorage under its own key so a
 *    page reload behaves like a relaunch from the LMS.
 *  - On relaunch, suspend_data and lesson_location survive ONLY if the
 *    previous session set cmi.core.exit = 'suspend' (cmi.core.entry is then
 *    'resume'). Otherwise the LMS starts a fresh attempt, keeping only the
 *    status and score, as SCORM Cloud and other strict LMSs do.
 *
 * Every call is logged to window.__lms.calls for assertions.
 */
function installMockLms() {
  const KEY = '__mock_lms__';
  const STATUSES = ['passed', 'completed', 'failed', 'incomplete', 'browsed', 'not attempted'];
  const EXITS = ['', 'time-out', 'suspend', 'logout'];
  const load = () => { try { return JSON.parse(localStorage.getItem(KEY) || 'null'); } catch (e) { return null; } };
  const persisted = load() || { cmi: {}, launches: 0, lastExit: null };

  const cmi = Object.assign({
    'cmi.core.student_id': 'u-001',
    'cmi.core.student_name': 'Hanafy, Youssef',
    'cmi.core.lesson_status': 'not attempted',
    'cmi.core.score.raw': '',
    'cmi.core.score.min': '',
    'cmi.core.score.max': '',
    'cmi.core.lesson_location': '',
    'cmi.suspend_data': '',
    'cmi.launch_data': '',
  }, persisted.cmi);

  const resumed = persisted.lastExit === 'suspend';
  if (!resumed) {
    cmi['cmi.suspend_data'] = '';
    cmi['cmi.core.lesson_location'] = '';
  }
  cmi['cmi.core.entry'] = persisted.launches === 0 ? 'ab-initio' : (resumed ? 'resume' : '');
  delete cmi['cmi.core.exit'];
  delete cmi['cmi.core.session_time'];

  const lms = { calls: [], errors: [], cmi, initialized: false, finished: false, lastError: '0', commits: 0 };
  window.__lms = lms;

  const save = () => {
    const keep = Object.assign({}, cmi);
    localStorage.setItem(KEY, JSON.stringify({
      cmi: keep,
      launches: persisted.launches + 1,
      lastExit: cmi['cmi.core.exit'] === undefined ? '' : cmi['cmi.core.exit'],
    }));
  };
  const fail = (code, call) => { lms.lastError = String(code); lms.errors.push({ code, call }); return 'false'; };

  function validate(k, v) {
    if (k === 'cmi.core.lesson_status') return STATUSES.includes(v) && v !== 'not attempted';
    if (k === 'cmi.core.exit') return EXITS.includes(v);
    if (k.startsWith('cmi.core.score.')) return v === '' || (/^-?\d+(\.\d+)?$/.test(v) && +v >= 0 && +v <= 100);
    if (k === 'cmi.core.session_time') return /^\d{2,4}:\d{2}:\d{2}(\.\d{1,2})?$/.test(v);
    if (k === 'cmi.suspend_data') return v.length <= 4096;
    if (k === 'cmi.core.lesson_location') return v.length <= 255;
    return ['cmi.comments'].includes(k);
  }

  window.API = {
    LMSInitialize() {
      lms.calls.push(['LMSInitialize']);
      if (lms.initialized) return fail(101, 'LMSInitialize');
      lms.initialized = true; lms.lastError = '0'; return 'true';
    },
    LMSFinish() {
      lms.calls.push(['LMSFinish']);
      if (!lms.initialized) return fail(301, 'LMSFinish');
      lms.initialized = false; lms.finished = true; save(); lms.lastError = '0'; return 'true';
    },
    LMSGetValue(k) {
      lms.calls.push(['LMSGetValue', k]);
      if (!lms.initialized) { fail(301, 'LMSGetValue ' + k); return ''; }
      if (k === 'cmi.core.exit' || k === 'cmi.core.session_time') { fail(404, 'LMSGetValue ' + k); return ''; }
      if (!(k in cmi)) { fail(401, 'LMSGetValue ' + k); return ''; }
      lms.lastError = '0';
      return cmi[k];
    },
    LMSSetValue(k, v) {
      v = String(v);
      lms.calls.push(['LMSSetValue', k, v]);
      if (!lms.initialized) return fail(301, 'LMSSetValue ' + k);
      if (['cmi.core.entry', 'cmi.core.student_id', 'cmi.core.student_name', 'cmi.launch_data'].includes(k)) return fail(403, 'LMSSetValue ' + k);
      if (!validate(k, v)) return fail(405, 'LMSSetValue ' + k + '=' + v.slice(0, 40));
      cmi[k] = v; lms.lastError = '0'; return 'true';
    },
    LMSCommit() {
      lms.calls.push(['LMSCommit']);
      if (!lms.initialized) return fail(301, 'LMSCommit');
      lms.commits++; save(); lms.lastError = '0'; return 'true';
    },
    LMSGetLastError() { return lms.lastError; },
    LMSGetErrorString(code) { return 'Mock LMS error ' + code; },
    LMSGetDiagnostic(code) { return 'Mock LMS diagnostic ' + code; },
  };
}

module.exports = { installMockLms };
