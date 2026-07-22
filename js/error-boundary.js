/**
 * ErrorBoundary — production resilience for a no-framework SPA.
 *
 * Responsibilities:
 * 1. Catch synchronous errors in scene renderers and show a recovery UI
 *    instead of leaving the learner on a blank stage.
 * 2. Surface unhandled promise rejections (e.g. failed font loads, SCORM
 *    network errors) without crashing the experience.
 * 3. Log to console in dev mode; stay silent in production to avoid leaking
 *    internals to end users.
 *
 * Usage from app.js:
 *   ErrorBoundary.guard('renderScene', () => renderSceneInternal(idx));
 *   ErrorBoundary.fatal(message);  // show full-screen recovery card
 */
(function (global) {
  'use strict';

  const ErrorBoundary = {
    installed: false,
    lastError: null,
  };

  function install() {
    if (ErrorBoundary.installed) return;
    ErrorBoundary.installed = true;

    global.addEventListener('error', (e) => {
      // Ignore cross-origin script errors — they report as 'Script error.' with
      // no stack; nothing actionable we can do, and they're often from browser
      // extensions or ads in the LMS host page.
      if (e && e.message && e.message.indexOf('Script error') === 0) return;
      record(e.error || e.message, 'window.error');
    });

    global.addEventListener('unhandledrejection', (e) => {
      const reason = e && e.reason;
      const msg = reason && (reason.message || reason.toString()) || 'Unhandled promise rejection';
      // Font load failures, TTS init issues — non-fatal. Just log.
      console.warn('[UnhandledRejection]', reason);
    });
  }

  function record(err, source) {
    ErrorBoundary.lastError = { err, source, ts: Date.now() };
    if (isDevMode()) {
      console.error('[ErrorBoundary]', source, err);
    }
  }

  function isDevMode() {
    try {
      const p = new URLSearchParams(global.location.search);
      return p.get('dev') === '1' || p.get('dev') === 'true';
    } catch (e) { return false; }
  }

  // Wrap a function so any throw is caught and a recovery UI is shown.
  function guard(label, fn) {
    try {
      return fn();
    } catch (err) {
      record(err, label);
      fatal(`تعذّر تحميل هذا المشهد (${label}). حاول مرة أخرى أو عُد إلى المشهد السابق.`);
      return undefined;
    }
  }

  // Show a full-screen recovery card with "restart" + "go back" actions.
  function fatal(message) {
    const stage = document.getElementById('stage');
    if (!stage) return;
    // Cancel any in-flight narration / TTS so the user isn't read over.
    try { if (global.TTS) TTS.cancel(); } catch (e) {}
    try { if (global.Narrator) { Narrator.skipRequested = true; Narrator.hideNarrator(); } } catch (e) {}
    try { if (global.Animator) Animator.clear(); } catch (e) {}

    const loader = document.getElementById('loader');
    if (loader) loader.classList.add('hidden');

    stage.style.opacity = '1';
    stage.innerHTML = `
      <div class="scene-cover" role="alert" aria-live="assertive">
        <div class="scene-eyebrow" style="opacity:1; color: var(--rose); border-color: var(--rose-dim); background: rgba(229,115,115,0.08);">
          تنبيه
        </div>
        <h1 class="scene-title" style="opacity:1">حدث خطأ غير متوقع</h1>
        <div class="scene-story" style="opacity:1; border-color: var(--rose-dim);">
          ${escapeHtml(message || 'يرجى إعادة تحميل الصفحة أو العودة إلى المشهد السابق.')}
        </div>
      </div>
    `;
    const cta = document.getElementById('cta-zone');
    if (cta) {
      cta.classList.remove('empty');
      cta.innerHTML = `
        <button class="cta-primary visible" id="err-reload" type="button">
          <span>إعادة تحميل الصفحة</span>
          <span class="cta-arrow">←</span>
        </button>
      `;
      const btn = document.getElementById('err-reload');
      if (btn) btn.addEventListener('click', () => global.location.reload());
    }
  }

  function escapeHtml(s) {
    return String(s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#039;');
  }

  ErrorBoundary.install = install;
  ErrorBoundary.guard = guard;
  ErrorBoundary.fatal = fatal;

  global.ErrorBoundary = ErrorBoundary;
})(window);
