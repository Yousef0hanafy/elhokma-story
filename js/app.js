/**
 * رحلة الحوكمة — Main App
 * -------------------------------------------
 * Renders scenes, manages state, handles interactions, SCORM hooks.
 * Designed as a scalable architecture: adding a new scene = adding a new
 * render function and entry in STORY_CONTENT.screens.
 */

(function () {
  'use strict';

  const CONTENT = window.STORY_CONTENT;
  if (!CONTENT) { console.error('STORY_CONTENT not loaded'); return; }

  // ---------- State ----------
  const state = {
    currentScreen: 0, // index into CONTENT.screens
    exploredSeats: [], // seat numbers explored on screen 2
    assessmentAnswer: null, // index of selected answer (current scene)
    assessmentAnswered: false,
    narrationCompleted: false,
    seatsRevealed: false,
    sceneScores: {}, // {screenIndex: 1 or 0}
    sceneState: {}, // {screenIndex: {explored: [], answered: bool, ...}}
  };

  const $stage = () => document.getElementById('stage');
  const $ctaZone = () => document.getElementById('cta-zone');
  const $topbar = () => document.getElementById('topbar');
  const $sceneCounter = () => document.getElementById('scene-counter');
  const $loader = () => document.getElementById('loader');
  const $toast = () => document.getElementById('toast');
  const $narratorAvatar = () => document.getElementById('narrator-avatar');

  // ---------- Init ----------
  function init() {
    // Install global error handlers first — before anything can throw.
    if (window.ErrorBoundary) ErrorBoundary.install();

    // Detect dev mode (?dev=1 in URL)
    const urlParams = new URLSearchParams(window.location.search);
    const isDev = urlParams.get('dev') === '1' || urlParams.get('dev') === 'true';
    if (isDev) document.body.classList.add('dev-mode');

    window.ScormApi.init();
    loadState();
    Narrator.init();
    Animator.init();
    if (window.TTS) TTS.init();
    buildNarratorAvatar();
    bindGlobalEvents();
    bindNavigation();
    bindTTSControls();

    // Hide loader after 1.2s (let fonts load)
    setTimeout(() => {
      $loader().classList.add('hidden');
      // Mark lesson in-progress
      if (window.ScormApi.getStatus() === 'not attempted') {
        window.ScormApi.setStatus('incomplete');
      }
      // Start first scene
      renderScene(state.currentScreen);
      // Show TTS activation overlay after first scene renders (only if starting fresh)
      if (state.currentScreen === 0) {
        maybeShowTTSActivation();
      }
    }, 1400);
  }

  function loadState() {
    try {
      const raw = window.ScormApi.getSuspendData();
      if (!raw) return;
      const data = typeof raw === 'string' ? JSON.parse(raw) : raw;
      if (data.currentScreen !== undefined) state.currentScreen = data.currentScreen;
      if (data.exploredSeats) state.exploredSeats = data.exploredSeats;
      if (data.assessmentAnswer !== undefined) state.assessmentAnswer = data.assessmentAnswer;
      if (data.assessmentAnswered) state.assessmentAnswered = data.assessmentAnswered;
      if (data.narrationCompleted) state.narrationCompleted = data.narrationCompleted;
      if (data.sceneScores) state.sceneScores = data.sceneScores;
      // Per-scene exploration/answer state for scenes 3-7
      if (data.sceneState) state.sceneState = data.sceneState;
      // Clamp currentScreen to valid range — corrupt state must never
      // dispatch to a non-existent scene.
      const maxIdx = (CONTENT.screens || []).length - 1;
      if (typeof state.currentScreen !== 'number' || state.currentScreen < 0 || state.currentScreen > maxIdx) {
        state.currentScreen = 0;
      }
      // Normalize per-scene state so renderers can assume a safe shape.
      normalizeSceneState();
    } catch (e) { console.warn('loadState failed', e); }
  }

  // Ensure each scene's persisted state has the fields its renderer expects.
  // Without this, a corrupt or schema-mismatched suspend_data can crash a
  // renderer (e.g. dilemma expects phaseAnswers; an older save may not have it).
  function normalizeSceneState() {
    if (!state.sceneState || typeof state.sceneState !== 'object') state.sceneState = {};
    CONTENT.screens.forEach((scene, idx) => {
      const ss = state.sceneState[idx];
      if (!ss || typeof ss !== 'object') {
        state.sceneState[idx] = {};
        return;
      }
      if (scene.id === 'dilemma') {
        if (!ss.phaseAnswers || typeof ss.phaseAnswers !== 'object') ss.phaseAnswers = {};
        if (!ss.phaseCorrect || typeof ss.phaseCorrect !== 'object') ss.phaseCorrect = {};
        if (typeof ss.currentPhase !== 'number') ss.currentPhase = 1;
        if (typeof ss.completed !== 'boolean') ss.completed = false;
      } else if (scene.id === 'court') {
        if (!ss.classifications || typeof ss.classifications !== 'object') ss.classifications = {};
        if (typeof ss.currentCase !== 'number') ss.currentCase = 1;
      } else {
        // Generic exploration/answer shape (framework, pillars, integrity, boardroom)
        if (!Array.isArray(ss.explored)) ss.explored = [];
        if (typeof ss.answered !== 'boolean') ss.answered = false;
        if (ss.answer === undefined) ss.answer = null;
      }
      if (typeof ss.narrationCompleted !== 'boolean') ss.narrationCompleted = false;
    });
  }

  function saveState() {
    window.ScormApi.setSuspendData({
      currentScreen: state.currentScreen,
      exploredSeats: state.exploredSeats,
      assessmentAnswer: state.assessmentAnswer,
      assessmentAnswered: state.assessmentAnswered,
      narrationCompleted: state.narrationCompleted,
      sceneScores: state.sceneScores || {},
      sceneState: state.sceneState || {},
    });
  }

  function bindGlobalEvents() {
    // Production notes toggle (dev mode only — element is hidden via CSS otherwise)
    const notesToggle = document.getElementById('notes-toggle');
    const notesDrawer = document.getElementById('notes-drawer');
    const notesBackdrop = document.getElementById('notes-backdrop');
    const notesClose = document.getElementById('notes-close');
    if (notesToggle) notesToggle.addEventListener('click', toggleNotes);
    if (notesClose) notesClose.addEventListener('click', closeNotes);
    if (notesBackdrop) notesBackdrop.addEventListener('click', closeNotes);
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        if (notesDrawer && notesDrawer.classList.contains('visible')) closeNotes();
        const sd = document.getElementById('scene-drawer');
        if (sd && sd.classList.contains('visible')) closeSceneDrawer();
      }
    });
  }

  // ---------- Scene Navigation Drawer ----------
  function bindNavigation() {
    const menuBtn = document.getElementById('menu-toggle');
    const closeBtn = document.getElementById('scene-drawer-close');
    const backdrop = document.getElementById('scene-drawer-backdrop');
    const restartBtn = document.getElementById('scene-drawer-restart');
    if (menuBtn) menuBtn.addEventListener('click', openSceneDrawer);
    if (closeBtn) closeBtn.addEventListener('click', closeSceneDrawer);
    if (backdrop) backdrop.addEventListener('click', closeSceneDrawer);
    if (restartBtn) restartBtn.addEventListener('click', restartCourse);
  }

  function openSceneDrawer() {
    buildSceneDrawerContent();
    document.getElementById('scene-drawer').classList.add('visible');
    document.getElementById('scene-drawer-backdrop').classList.add('visible');
    document.getElementById('scene-drawer').setAttribute('aria-hidden', 'false');
  }

  function closeSceneDrawer() {
    document.getElementById('scene-drawer').classList.remove('visible');
    document.getElementById('scene-drawer-backdrop').classList.remove('visible');
    document.getElementById('scene-drawer').setAttribute('aria-hidden', 'true');
  }

  function buildSceneDrawerContent() {
    const body = document.getElementById('scene-drawer-body');
    const total = CONTENT.screens.length;
    let html = '';
    CONTENT.screens.forEach((scene, idx) => {
      const isCurrent = idx === state.currentScreen;
      const isCompleted = isSceneCompleted(idx);
      const isUnlocked = idx <= state.currentScreen || isSceneCompleted(idx) || (idx > 0 && isSceneCompleted(idx - 1));
      // Always allow jumping to scene 1; for others, require previous to be completed OR current
      const canJump = idx === 0 || isUnlocked || idx <= state.currentScreen;
      const classes = ['scene-item'];
      if (isCurrent) classes.push('current');
      if (isCompleted) classes.push('completed');
      if (!canJump) classes.push('locked');
      html += `
        <button class="${classes.join(' ')}" data-scene-idx="${idx}" type="button" ${canJump ? '' : 'disabled'}>
          <div class="scene-item-status"><span class="scene-item-status-icon"></span></div>
          <div class="scene-item-content">
            <div class="scene-item-eyebrow">المشهد ${arabicNumeral(idx + 1)} من ${arabicNumeral(total)}</div>
            <div class="scene-item-title">${escapeHtml(scene.title)}</div>
          </div>
        </button>
      `;
    });
    body.innerHTML = html;
    body.querySelectorAll('.scene-item').forEach(btn => {
      if (btn.disabled) return;
      btn.addEventListener('click', () => {
        const idx = parseInt(btn.dataset.sceneIdx, 10);
        closeSceneDrawer();
        // Cancel any in-flight narration/TTS before switching
        if (window.TTS) TTS.cancel();
        Narrator.skipRequested = true;
        state.currentScreen = idx;
        // Reset per-scene state for the new scene so it plays fresh
        resetCurrentSceneState();
        saveState();
        renderScene(idx);
      });
    });
  }

  function isSceneCompleted(idx) {
    const scene = CONTENT.screens[idx];
    if (!scene) return false;
    // Scene 1 (opening) is complete once user has moved past it
    if (scene.id === 'opening') return state.currentScreen > 0;
    // For scenes 7 (dilemma) — check ss.completed
    if (scene.id === 'dilemma') {
      const ss = state.sceneState && state.sceneState[idx];
      return ss && ss.completed;
    }
    // For scenes with assessments (2, 3, 4, 5, 6), completion = answered correctly
    if (state.sceneScores && state.sceneScores[idx] === 1) return true;
    // Also accept "answered" (even if wrong) as "explored" for navigation unlock
    const ss = state.sceneState && state.sceneState[idx];
    if (ss && ss.answered) return true;
    // Scene 2 uses the old per-scene state (state.assessmentAnswered) — handle that
    if (scene.id === 'boardroom' && state.assessmentAnswered && idx === state.currentScreen) return true;
    return false;
  }

  function resetCurrentSceneState() {
    // Clear the per-scene working state so re-entry plays fresh
    state.assessmentAnswer = null;
    state.assessmentAnswered = false;
    state.narrationCompleted = false;
    state.seatsRevealed = false;
    // Don't clear exploredSeats for scene 2 here — handled by per-scene state
    // Clear current scene's state in sceneState
    if (state.sceneState) {
      delete state.sceneState[state.currentScreen];
    }
  }

  function restartCourse() {
    if (!confirm('هل أنت متأكد من إعادة الرحلة من البداية؟ سيتم مسح تقدّمك.')) return;
    state.currentScreen = 0;
    state.exploredSeats = [];
    state.assessmentAnswer = null;
    state.assessmentAnswered = false;
    state.narrationCompleted = false;
    state.seatsRevealed = false;
    state.sceneScores = {};
    state.sceneState = {};
    if (window.TTS) TTS.cancel();
    Narrator.skipRequested = true;
    saveState();
    window.ScormApi.setStatus('incomplete');
    window.ScormApi.setScore(0, 0, 100);
    closeSceneDrawer();
    renderScene(0);
    showToast('بدأت الرحلة من جديد', 'success');
  }

  // ---------- TTS Controls ----------
  function bindTTSControls() {
    const ttsToggle = document.getElementById('tts-toggle');
    const ttsRate = document.getElementById('tts-rate');
    const ttsIcon = document.getElementById('tts-icon');
    const ttsRateLabel = document.getElementById('tts-rate-label');

    // Activation overlay buttons
    const activateBtn = document.getElementById('tts-activate-btn');
    const skipBtn = document.getElementById('tts-skip-btn');
    const activationOverlay = document.getElementById('tts-activation');
    const activationStatus = document.getElementById('tts-activation-status');
    const activationTitle = document.getElementById('tts-activation-title');
    const activationDesc = document.getElementById('tts-activation-desc');

    if (!window.TTS) return;

    // Update topbar TTS button based on state
    TTS.onStateChange(s => {
      if (!ttsToggle) return;
      ttsToggle.disabled = !s.available;
      ttsToggle.classList.toggle('muted', s.muted || !s.available || !s.activated);
      if (ttsIcon) {
        if (!s.available) ttsIcon.textContent = '🔇';
        else if (!s.activated) ttsIcon.textContent = '🔈';
        else if (s.muted) ttsIcon.textContent = '🔈';
        else if (s.speaking) ttsIcon.textContent = '🔊';
        else ttsIcon.textContent = '🔊';
      }
    });

    // Topbar TTS toggle — if not activated, show activation overlay; else mute/unmute
    if (ttsToggle) {
      ttsToggle.addEventListener('click', () => {
        const s = TTS.getState();
        if (!s.available) {
          showTTSActivationOverlay('unavailable');
          return;
        }
        if (!s.activated) {
          showTTSActivationOverlay();
          return;
        }
        // Toggle mute
        TTS.setMuted(!s.muted);
        showToast(s.muted ? 'تم تفعيل السرد الصوتي' : 'تم كتم السرد الصوتي', s.muted ? 'success' : 'success');
      });
    }

    // Speed control
    if (ttsRate) {
      const rates = [0.75, 1.0, 1.25, 1.5];
      const rateLabels = ['٠.٧٥×', '١×', '١.٢٥×', '١.٥×'];
      ttsRate.addEventListener('click', () => {
        const s = TTS.getState();
        if (!s.available) {
          showToast('السرد الصوتي غير متاح', 'error');
          return;
        }
        const currentIdx = rates.indexOf(s.rate);
        const nextIdx = (currentIdx + 1) % rates.length;
        TTS.setRate(rates[nextIdx]);
        if (ttsRateLabel) ttsRateLabel.textContent = rateLabels[nextIdx];
        showToast(`سرعة السرد: ${rateLabels[nextIdx]}`, 'success');
      });
    }

    // Activation overlay handlers
    if (activateBtn) {
      activateBtn.addEventListener('click', () => {
        const s = TTS.getState();
        if (!s.available) {
          // No Arabic voice — proceed without TTS
          hideTTSActivationOverlay();
          showToast('السرد الصوتي غير متاح، المتابعة بالترجمة النصية', 'warning');
          return;
        }
        // Activate TTS (this is the user gesture)
        TTS.activate();
        hideTTSActivationOverlay();
        showToast('تم تفعيل السرد الصوتي', 'success');
        // If we're on scene 1 and narration already started, re-trigger current segment
        // The narrator.js will handle speaking via onSegment callback
        // But if narration already passed, we may need to restart it
        if (state.currentScreen === 0 && Narrator.isComplete) {
          // Narration already done — no auto-replay, user can use ↺
        }
      });
    }

    if (skipBtn) {
      skipBtn.addEventListener('click', () => {
        hideTTSActivationOverlay();
        showToast('المتابعة بالترجمة النصية', 'success');
      });
    }
  }

  // ---------- TTS Activation Overlay ----------
  function showTTSActivationOverlay(mode) {
    const overlay = document.getElementById('tts-activation');
    const status = document.getElementById('tts-activation-status');
    const title = document.getElementById('tts-activation-title');
    const desc = document.getElementById('tts-activation-desc');
    const activateBtn = document.getElementById('tts-activate-btn');

    if (!overlay) return;

    // Check TTS availability
    const s = window.TTS ? TTS.getState() : { available: false };

    if (mode === 'unavailable' || !s.available) {
      // No Arabic voice available
      title.textContent = 'السرد الصوتي غير متاح';
      desc.textContent = 'متصفحك لا يدعم السرد الصوتي العربي. ستظهر الترجمة النصية تلقائياً. يمكنك المتابعة دون صوت.';
      if (activateBtn) activateBtn.style.display = 'none';
      if (status) {
        status.textContent = 'يمكنك المتابعة بالنقر على الزر أدناه';
        status.className = 'tts-activation-status';
      }
    } else {
      title.textContent = 'السرد الصوتي العربي';
      desc.textContent = 'لتجربة كاملة مع صوت د. سارة، فعّل السرد الصوتي. يمكنك أيضاً المتابعة بالترجمة النصية فقط.';
      if (activateBtn) activateBtn.style.display = '';
      if (status) {
        status.textContent = `الصوت المتاح: ${s.voiceName || 'عربي'} (${s.voiceLang || 'ar'})`;
        status.className = 'tts-activation-status';
      }
    }

    overlay.classList.add('visible');
    overlay.setAttribute('aria-hidden', 'false');
  }

  function hideTTSActivationOverlay() {
    const overlay = document.getElementById('tts-activation');
    if (!overlay) return;
    overlay.classList.remove('visible');
    overlay.setAttribute('aria-hidden', 'true');
  }

  // Check if TTS activation overlay should be shown (only once, on first scene)
  let ttsActivationShown = false;
  function maybeShowTTSActivation() {
    if (ttsActivationShown) return;
    if (!window.TTS) return;
    const s = TTS.getState();
    if (s.activated) return; // Already activated
    // Show overlay after a short delay (let scene render first)
    setTimeout(() => {
      showTTSActivationOverlay();
      ttsActivationShown = true;
    }, 800);
  }

  // ---------- Narrator avatar (inline SVG) ----------
  function buildNarratorAvatar() {
    // Dr. سارة الراشد — elegant Saudi woman with hijab, professional medical coat.
    // Refined flat-illustration portrait with gold accents and subtle depth.
    const svg = `
<svg viewBox="0 0 140 140" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <linearGradient id="narr-bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="#1B3B5F"/>
      <stop offset="100%" stop-color="#0B1F33"/>
    </linearGradient>
    <linearGradient id="narr-hijab" x1="0.3" y1="0" x2="0.7" y2="1">
      <stop offset="0%" stop-color="#234B6E"/>
      <stop offset="50%" stop-color="#1B3B5F"/>
      <stop offset="100%" stop-color="#0B1F33"/>
    </linearGradient>
    <linearGradient id="narr-hijab-fold" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="#2D5A82" stop-opacity="0.6"/>
      <stop offset="100%" stop-color="#0B1F33" stop-opacity="0"/>
    </linearGradient>
    <linearGradient id="narr-coat" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="#FAF6E8"/>
      <stop offset="100%" stop-color="#E8DEC5"/>
    </linearGradient>
    <linearGradient id="narr-skin" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="#EDC9A0"/>
      <stop offset="100%" stop-color="#D9B483"/>
    </linearGradient>
    <linearGradient id="narr-gold" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="#E8C766"/>
      <stop offset="100%" stop-color="#D4AF37"/>
    </linearGradient>
    <radialGradient id="narr-glow" cx="0.5" cy="0.5" r="0.5">
      <stop offset="0%" stop-color="#D4AF37" stop-opacity="0.18"/>
      <stop offset="100%" stop-color="#D4AF37" stop-opacity="0"/>
    </radialGradient>
  </defs>

  <!-- Background -->
  <rect width="140" height="140" fill="url(#narr-bg)"/>

  <!-- Soft golden halo behind head -->
  <circle cx="70" cy="58" r="48" fill="url(#narr-glow)"/>

  <!-- Hijab back (full drape over shoulders) -->
  <path d="M 22 140 Q 22 78 50 64 Q 60 50 70 48 Q 80 50 90 64 Q 118 78 118 140 Z"
        fill="url(#narr-hijab)"/>

  <!-- Hijab side folds (depth) -->
  <path d="M 30 100 Q 28 80 36 70 Q 32 88 38 110 Q 34 118 32 130 Z"
        fill="url(#narr-hijab-fold)"/>
  <path d="M 110 100 Q 112 80 104 70 Q 108 88 102 110 Q 106 118 108 130 Z"
        fill="url(#narr-hijab-fold)"/>

  <!-- Hijab front frame (covers hairline, frames face) -->
  <path d="M 44 64 Q 44 38 70 34 Q 96 38 96 64 L 96 78 Q 92 90 70 92 Q 48 90 44 78 Z"
        fill="url(#narr-hijab)"/>

  <!-- Hijab front edge — gold trim (subtle elegance) -->
  <path d="M 44 64 Q 44 38 70 34 Q 96 38 96 64"
        stroke="url(#narr-gold)" stroke-width="1.2" fill="none" opacity="0.7"/>

  <!-- Under-hijab cap (subtle, gives hijab structure) -->
  <path d="M 50 50 Q 70 42 90 50 L 88 56 Q 70 50 52 56 Z"
        fill="#0B1F33" opacity="0.4"/>

  <!-- Neck -->
  <path d="M 60 88 L 60 100 Q 70 104 80 100 L 80 88 Z" fill="url(#narr-skin)"/>
  <!-- Neck shadow -->
  <path d="M 60 88 L 60 100 Q 70 104 80 100 L 80 88" fill="#0B1F33" opacity="0.15"/>

  <!-- Face -->
  <ellipse cx="70" cy="62" rx="22" ry="26" fill="url(#narr-skin)"/>

  <!-- Face shading — hijab cast shadow on forehead -->
  <path d="M 48 58 Q 50 44 70 40 Q 90 44 92 58 L 92 64 Q 90 50 70 47 Q 50 50 48 64 Z"
        fill="#0B1F33" opacity="0.18"/>

  <!-- Cheek warmth (subtle blush) -->
  <ellipse cx="56" cy="72" rx="5" ry="3.5" fill="#D4A488" opacity="0.35"/>
  <ellipse cx="84" cy="72" rx="5" ry="3.5" fill="#D4A488" opacity="0.35"/>

  <!-- Eyebrows — refined arches -->
  <path d="M 56 55 Q 60 52.5 65 55" stroke="#3A2410" stroke-width="1.6" fill="none" stroke-linecap="round"/>
  <path d="M 75 55 Q 80 52.5 84 55" stroke="#3A2410" stroke-width="1.6" fill="none" stroke-linecap="round"/>

  <!-- Eyes — almond shape, larger pupils for warmth -->
  <path d="M 56 60 Q 62 57 68 60 Q 62 63 56 60 Z" fill="#FFFFFF"/>
  <path d="M 72 60 Q 78 57 84 60 Q 78 63 72 60 Z" fill="#FFFFFF"/>
  <ellipse cx="62" cy="60.5" rx="2" ry="2.4" fill="#3A2410"/>
  <ellipse cx="78" cy="60.5" rx="2" ry="2.4" fill="#3A2410"/>
  <!-- Eye highlights -->
  <circle cx="62.8" cy="59.8" r="0.7" fill="#FFFFFF"/>
  <circle cx="78.8" cy="59.8" r="0.7" fill="#FFFFFF"/>
  <!-- Eyelash hint -->
  <path d="M 56 60 Q 54 58 53 57" stroke="#3A2410" stroke-width="0.8" fill="none" stroke-linecap="round"/>
  <path d="M 84 60 Q 86 58 87 57" stroke="#3A2410" stroke-width="0.8" fill="none" stroke-linecap="round"/>

  <!-- Nose — soft, refined -->
  <path d="M 70 64 Q 68 70 67 74 Q 68 75 70 75 Q 72 75 73 74 Q 72 70 70 64"
        stroke="#B8916A" stroke-width="0.8" fill="none" opacity="0.6"/>
  <ellipse cx="68" cy="74" rx="0.8" ry="0.6" fill="#B8916A" opacity="0.4"/>
  <ellipse cx="72" cy="74" rx="0.8" ry="0.6" fill="#B8916A" opacity="0.4"/>

  <!-- Lips — warm, natural smile -->
  <path d="M 64 79 Q 67 77 70 77.5 Q 73 77 76 79 Q 73 81 70 81 Q 67 81 64 79 Z"
        fill="#B86866" opacity="0.85"/>
  <path d="M 64 79 Q 70 80.5 76 79" stroke="#9A4F4D" stroke-width="0.6" fill="none"/>

  <!-- Chin shadow -->
  <ellipse cx="70" cy="84" rx="6" ry="2" fill="#0B1F33" opacity="0.08"/>

  <!-- Gold earrings (subtle, visible at hijab edge) -->
  <circle cx="48" cy="76" r="1.6" fill="url(#narr-gold)"/>
  <circle cx="92" cy="76" r="1.6" fill="url(#narr-gold)"/>
  <circle cx="48" cy="76" r="0.6" fill="#FFFFFF" opacity="0.7"/>
  <circle cx="92" cy="76" r="0.6" fill="#FFFFFF" opacity="0.7"/>

  <!-- Medical coat shoulders -->
  <path d="M 28 140 Q 28 104 48 96 L 56 92 Q 60 96 70 96 Q 80 96 84 92 L 92 96 Q 112 104 112 140 Z"
        fill="url(#narr-coat)"/>

  <!-- Coat lapels -->
  <path d="M 56 92 L 60 100 L 58 130 L 54 110 Z" fill="#E8DEC5"/>
  <path d="M 84 92 L 80 100 L 82 130 L 86 110 Z" fill="#E8DEC5"/>
  <!-- Lapel shadow -->
  <path d="M 60 100 L 58 130" stroke="#C8BD9F" stroke-width="0.6" fill="none"/>
  <path d="M 80 100 L 82 130" stroke="#C8BD9F" stroke-width="0.6" fill="none"/>

  <!-- Coat center line (subtle) -->
  <line x1="70" y1="100" x2="70" y2="140" stroke="#C8BD9F" stroke-width="0.5" opacity="0.5"/>

  <!-- Gold collar pin (medical/professional accent) -->
  <circle cx="62" cy="106" r="2.2" fill="url(#narr-gold)"/>
  <circle cx="62" cy="106" r="1" fill="#0B1F33" opacity="0.3"/>
  <!-- Tiny medical cross hint inside pin -->
  <path d="M 61.4 106 L 62.6 106 M 62 105.4 L 62 106.6" stroke="#FAF6E8" stroke-width="0.4"/>

  <!-- Name badge hint (small rectangle on coat) -->
  <rect x="84" y="112" width="14" height="9" rx="1.5" fill="#FFFFFF" opacity="0.85" stroke="#D4AF37" stroke-width="0.4"/>
  <rect x="86" y="114" width="10" height="1" rx="0.3" fill="#1B3B5F"/>
  <rect x="86" y="116.5" width="7" height="0.7" rx="0.2" fill="#595959"/>
  <rect x="86" y="118" width="8" height="0.7" rx="0.2" fill="#595959"/>
</svg>`;
    $narratorAvatar().innerHTML = svg;
  }

  // ---------- Scene renderer (dispatch) ----------
  function renderScene(idx) {
    const scene = CONTENT.screens[idx];
    if (!scene) return;
    state.currentScreen = idx;

    // Cancel any in-flight narration + TTS from previous scene
    if (window.TTS) TTS.cancel();
    Narrator.skipRequested = true;
    Animator.clear();

    // Update topbar
    $topbar().classList.add('visible');
    $sceneCounter().textContent = `المشهد ${arabicNumeral(idx + 1)} / ${arabicNumeral(CONTENT.screens.length)}`;

    // Fade out current content
    const stage = $stage();
    Animator.fadeOut(stage, 0.4, () => {
      stage.innerHTML = '';
      // Reset scroll position so new scene starts at the top
      stage.scrollTop = 0;
      window.scrollTo(0, 0);
      $ctaZone().innerHTML = '';
      $ctaZone().classList.add('empty');
      Narrator.hideNarrator();
      document.getElementById('subtitle-bar').classList.remove('visible', 'controls-visible');
      document.body.classList.remove('cinematic');

      // Render scene-specific content (guarded so a throw in any renderer
      // shows the recovery UI instead of leaving the stage blank).
      const dispatch = () => {
        if (scene.id === 'opening') renderOpening(scene);
        else if (scene.id === 'boardroom') renderBoardroom(scene);
        else if (scene.id === 'framework') renderFramework(scene);
        else if (scene.id === 'pillars') renderPillars(scene);
        else if (scene.id === 'court') renderCourt(scene);
        else if (scene.id === 'integrity') renderIntegrity(scene);
        else if (scene.id === 'dilemma') renderDilemma(scene);
        else renderComingSoon(scene);
      };
      if (window.ErrorBoundary) ErrorBoundary.guard('renderScene:' + scene.id, dispatch);
      else dispatch();

      saveState();
    });
  }

  // Fallback for scenes whose renderer isn't implemented yet
  function renderComingSoon(scene) {
    const stage = $stage();
    stage.style.opacity = '1';
    stage.innerHTML = `
      <div class="scene-cover">
        <div class="scene-eyebrow anim-fade-up" style="opacity:1">${escapeHtml(scene.eyebrow || '')}</div>
        <h1 class="scene-title anim-fade-up" style="opacity:1; animation-delay:0.2s">${escapeHtml(scene.title || '')}</h1>
        <div class="scene-subtitle anim-fade-up" style="opacity:1; animation-delay:0.4s">
          المشهد ${arabicNumeral(scene.scene_number)} — قيد الإنتاج
        </div>
        <div class="scene-story anim-fade-up" style="opacity:1; animation-delay:0.6s">
          هذا المشهد مُعرَّف بالكامل في ملف المحتوى، وقيد التطوير في طبقة العرض. سيتوفّر قريباً بنفس جودة المشهدين السابقين.
        </div>
      </div>
    `;
    // Show CTA to go back
    const ctaZone = $ctaZone();
    ctaZone.classList.remove('empty');
    ctaZone.innerHTML = `
      <button class="cta-primary visible" id="cta-back" type="button">
        <span>العودة إلى المشهد السابق</span>
        <span class="cta-arrow">→</span>
      </button>
    `;
    setTimeout(() => {
      document.getElementById('cta-back').addEventListener('click', () => {
        if (state.currentScreen > 0) {
          state.currentScreen--;
          renderScene(state.currentScreen);
        }
      });
    }, 100);
  }

  // ============================================================
  // SCENE 1 — Cinematic Opening
  // ============================================================
  function renderOpening(scene) {
    document.body.classList.add('cinematic');
    const stage = $stage();
    stage.style.opacity = '1';

    stage.innerHTML = `
      <div class="scene-cover">
        <div class="scene-eyebrow" id="eyebrow">${escapeHtml(scene.eyebrow)}</div>
        <h1 class="scene-title" id="hero-title">
          رحلة <span class="accent">${escapeHtml(scene.hero_title_accent)}</span>
        </h1>
        <div class="scene-subtitle" id="hero-subtitle">${escapeHtml(scene.subtitle)}</div>
        <div class="scene-story" id="hero-story">${escapeHtml(scene.story_hook)}</div>
      </div>
    `;

    // Animation timeline
    const reduced = Animator.reducedMotion;
    const tl = [];
    if (reduced) {
      // Show everything immediately
      tl.push({ time: 0, fn: () => {
        document.getElementById('eyebrow').classList.add('anim-fade-in');
        document.getElementById('hero-title').classList.add('anim-fade-up');
        document.getElementById('hero-subtitle').classList.add('anim-fade-in');
        document.getElementById('hero-story').classList.add('anim-fade-in');
        Narrator.showNarrator();
        document.getElementById('subtitle-bar').classList.add('visible');
      }});
    } else {
      tl.push({ time: 0.0, fn: () => document.getElementById('eyebrow').classList.add('anim-fade-up') });
      tl.push({ time: 1.0, fn: () => {
        // Typewriter title
        typeTitle(document.getElementById('hero-title'), 'رحلة ' + scene.hero_title_accent, 60, () => {
          // Highlight accent after typing completes
          const titleEl = document.getElementById('hero-title');
          titleEl.innerHTML = `رحلة <span class="accent">${escapeHtml(scene.hero_title_accent)}</span>`;
        });
      }});
      tl.push({ time: 3.0, fn: () => document.getElementById('hero-subtitle').classList.add('anim-fade-up') });
      tl.push({ time: 3.8, fn: () => document.getElementById('hero-story').classList.add('anim-fade-up') });
    }

    // Narration starts at 4.5s (or immediately if reduced motion)
    const narrationStart = reduced ? 0.5 : 4.5;
    tl.push({ time: narrationStart, fn: () => {
      Narrator.start(scene.narration, {
        totalSeconds: scene.narration_total_seconds,
        onComplete: () => {
          state.narrationCompleted = true;
          saveState();
          showCTA(scene.cta_label, scene.cta_hint, () => {
            // Move to next scene
            Animator.scaleOut($stage(), 0.4, () => {
              renderScene(1);
            });
          });
        },
      });
    }});

    Animator.runTimeline(tl);
  }

  function typeTitle(el, text, speed = 60, onDone = null) {
    el.innerHTML = '<span class="title-typewriter"></span>';
    const span = el.querySelector('.title-typewriter');
    let i = 0;
    function next() {
      if (i >= text.length) {
        span.classList.add('done');
        if (onDone) onDone();
        return;
      }
      i++;
      span.textContent = text.substring(0, i);
      setTimeout(next, speed);
    }
    next();
  }

  function showCTA(label, hint, onClick) {
    const zone = $ctaZone();
    zone.classList.remove('empty');
    zone.innerHTML = `
      <button class="cta-primary" id="cta-btn" type="button">
        <span>${label}</span>
        <span class="cta-arrow">←</span>
      </button>
      ${hint ? `<div class="cta-hint" id="cta-hint">${hint}</div>` : ''}
    `;
    setTimeout(() => {
      const btn = document.getElementById('cta-btn');
      btn.classList.add('visible');
      const h = document.getElementById('cta-hint');
      if (h) h.classList.add('visible');
      btn.addEventListener('click', onClick);
    }, 100);
  }

  // ============================================================
  // SCENE 2 — Boardroom (Guided Exploration)
  // ============================================================
  function renderBoardroom(scene) {
    document.body.classList.add('cinematic');
    const stage = $stage();
    stage.style.opacity = '1';

    // Build the boardroom SVG
    const seatsSvg = scene.seats.map((seat, i) => {
      return `
        <g class="seat" id="seat-${seat.n}" data-seat-n="${seat.n}" tabindex="0" role="button"
           aria-label="المقعد ${seat.n}: ${seat.label}. اضغط للاستكشاف"
           transform="translate(${seat.position.x}, ${seat.position.y})">
          <circle class="seat-circle" r="40"/>
          <text class="seat-icon" y="2">${seat.icon}</text>
          <text class="seat-label" y="62">${seat.label}</text>
          <text class="seat-check" y="-30" font-size="20" fill="#81C784" text-anchor="middle">✓</text>
        </g>
      `;
    }).join('');

    stage.innerHTML = `
      <div class="scene-boardroom">
        <div class="boardroom-header" id="br-header">
          <div class="boardroom-eyebrow">${escapeHtml(scene.eyebrow)}</div>
          <h2 class="boardroom-title">${escapeHtml(scene.hero_title)}</h2>
          <p class="boardroom-instruction" id="br-instruction">${escapeHtml(scene.instruction)}</p>
        </div>

        <div class="boardroom-stage" id="br-stage">
          <svg class="boardroom-svg" viewBox="0 0 720 720" xmlns="http://www.w3.org/2000/svg">
            <defs>
              <radialGradient id="table-grad" cx="0.5" cy="0.5" r="0.5">
                <stop offset="0%" stop-color="#1B3B5F" stop-opacity="0.6"/>
                <stop offset="100%" stop-color="#0B1F33" stop-opacity="0.2"/>
              </radialGradient>
            </defs>
            <!-- Soft glow under table -->
            <ellipse cx="360" cy="340" rx="220" ry="180" fill="#D4AF37" opacity="0.04"/>
            <!-- Table oval -->
            <ellipse class="table-stroke" id="table-oval" cx="360" cy="340" rx="180" ry="140"
                     fill="url(#table-grad)" stroke="#D4AF37" stroke-width="2" stroke-opacity="0.6"/>
            <!-- Table center label -->
            <text class="table-label" x="360" y="338">غرفة القرار</text>
            <text class="table-label" x="360" y="358" font-size="11" opacity="0.5">الأطراف الستة</text>
            <!-- Seats -->
            ${seatsSvg}
          </svg>
        </div>

        <div class="boardroom-progress" id="br-progress">
          <span>استكشفت</span>
          <div class="progress-dots" id="progress-dots">
            ${scene.seats.map(() => '<span class="progress-dot"></span>').join('')}
          </div>
          <span id="progress-text">٠ من ٦</span>
        </div>

        <div class="assessment-panel" id="assessment-panel">
          <div class="assessment-eyebrow">اختبار سريع</div>
          <div class="assessment-question">${escapeHtml(scene.assessment.question)}</div>
          <div class="assessment-options" id="assessment-options">
            ${scene.assessment.options.map((opt, i) => `
              <button class="assessment-option" data-idx="${i}" type="button">
                <span class="option-letter">${['أ','ب','ج','د'][i]}</span>
                <span class="option-text">${escapeHtml(opt)}</span>
              </button>
            `).join('')}
          </div>
          <div class="assessment-feedback" id="assessment-feedback"></div>
        </div>
      </div>
    `;

    // Animation timeline
    const reduced = Animator.reducedMotion;
    const tl = [];

    if (reduced) {
      tl.push({ time: 0, fn: () => {
        document.getElementById('br-header').classList.add('anim-fade-in');
        document.getElementById('br-progress').classList.add('visible');
      }});
    } else {
      tl.push({ time: 0.2, fn: () => document.getElementById('br-header').classList.add('anim-fade-up') });
      tl.push({ time: 0.8, fn: () => {
        // Draw table stroke
        const table = document.getElementById('table-oval');
        Animator.drawStroke(table, 2.0);
      }});
      tl.push({ time: 1.5, fn: () => {
        // Reveal seats staggered
        const seats = document.querySelectorAll('.seat');
        seats.forEach((s, i) => {
          setTimeout(() => s.classList.add('seat-revealing'), i * 120);
        });
      }});
    }

    // Narration starts at 2.5s
    const narrationStart = reduced ? 0.5 : 2.5;
    tl.push({ time: narrationStart, fn: () => {
      Narrator.start(scene.narration, {
        totalSeconds: scene.narration_total_seconds,
        onSegment: (seg, idx) => {
          // When a segment mentions a seat, glow that seat
          if (seg.seat) {
            const seatEl = document.getElementById('seat-' + seg.seat);
            if (seatEl) Animator.pulseGlow(seatEl, 3.5);
          }
        },
        onComplete: () => {
          state.narrationCompleted = true;
          state.seatsRevealed = true;
          saveState();
          // Show progress bar
          document.getElementById('br-progress').classList.add('visible');
          // Make seats interactive
          enableSeatClicks(scene);
          showToast('كل مقعد جاهز للاستكشاف — انقر للبدء', 'success');
        },
      });
    }});

    // If narration already completed (returning to scene), enable immediately
    if (state.narrationCompleted && state.seatsRevealed) {
      // Skip narration, go straight to interactive mode
      Animator.clear();
      Narrator.hideNarrator();
      document.getElementById('subtitle-bar').classList.remove('visible');
      document.getElementById('br-progress').classList.add('visible');
      enableSeatClicks(scene);
      // Restore explored seats visual
      state.exploredSeats.forEach(n => {
        const seatEl = document.getElementById('seat-' + n);
        if (seatEl) seatEl.classList.add('completed');
      });
      updateProgress(scene);
      // Restore assessment if answered
      if (state.assessmentAnswered) {
        showAssessmentAnswer(scene);
      } else if (state.exploredSeats.length === 6) {
        // All seats explored but not yet answered — show + enable assessment
        document.getElementById('assessment-panel').classList.add('visible');
        enableBoardroomAssessment(scene);
      }
    } else {
      Animator.runTimeline(tl);
    }
  }

  function enableSeatClicks(scene) {
    scene.seats.forEach(seat => {
      const el = document.getElementById('seat-' + seat.n);
      if (!el) return;
      if (state.exploredSeats.includes(seat.n)) {
        el.classList.add('completed');
      }
      el.addEventListener('click', () => openSeatModal(seat, scene));
      el.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          openSeatModal(seat, scene);
        }
      });
    });
    updateProgress(scene);
  }

  function openSeatModal(seat, scene) {
    // Build modal content via ModalManager for proper focus trap + a11y
    const content = `
      <div class="seat-modal-card" tabindex="-1">
        <div class="seat-modal-num">${arabicNumeral(seat.n)}</div>
        <div class="seat-modal-eyebrow">المقعد ${arabicNumeral(seat.n)} من ٦</div>
        <h3 class="seat-modal-title">${escapeHtml(seat.label)}</h3>
        <div class="seat-modal-story">${escapeHtml(seat.story)}</div>
        <div class="seat-modal-def-label">التعريف الرسمي</div>
        <div class="seat-modal-def">${escapeHtml(seat.definition)}</div>
        <button class="seat-modal-close" type="button">فهمت</button>
      </div>
    `;
    ModalManager.open({
      content,
      label: `المقعد ${arabicNumeral(seat.n)}: ${seat.label}`,
      onClose: () => {
        // Mark seat as explored
        if (!state.exploredSeats.includes(seat.n)) {
          state.exploredSeats.push(seat.n);
          const el = document.getElementById('seat-' + seat.n);
          if (el) el.classList.add('completed');
          saveState();
          updateProgress(scene);
          // If all 6 explored, reveal assessment
          if (state.exploredSeats.length === 6 && !state.assessmentAnswered) {
            setTimeout(() => {
              const panel = document.getElementById('assessment-panel');
              panel.classList.add('visible');
              enableBoardroomAssessment(scene);
              panel.scrollIntoView({ behavior: 'smooth', block: 'center' });
              showToast('أحسنت! اختبر فهمك الآن', 'success');
            }, 400);
          }
        }
      },
    });
    // Wire close button inside the modal
    const closeBtn = ModalManager.current.overlay.querySelector('.seat-modal-close');
    if (closeBtn) closeBtn.addEventListener('click', () => ModalManager.close());
  }

  function updateProgress(scene) {
    const total = scene.seats.length;
    const done = state.exploredSeats.length;
    document.getElementById('progress-text').textContent = `${arabicNumeral(done)} من ${arabicNumeral(total)}`;
    const dots = document.querySelectorAll('#progress-dots .progress-dot');
    dots.forEach((dot, i) => {
      dot.classList.toggle('filled', i < done);
      dot.classList.toggle('all-done', done === total);
    });
    // If all done, change progress color
    const progress = document.getElementById('br-progress');
    if (done === total) {
      progress.style.borderColor = 'var(--green)';
      progress.style.color = 'var(--green)';
    }
  }

  function enableBoardroomAssessment(scene) {
    const opts = document.querySelectorAll('#assessment-options .assessment-option');
    opts.forEach(opt => {
      opt.addEventListener('click', () => {
        if (state.assessmentAnswered) return;
        const idx = parseInt(opt.dataset.idx, 10);
        handleBoardroomAssessmentAnswer(idx, scene);
      });
    });
  }

  function handleBoardroomAssessmentAnswer(idx, scene) {
    state.assessmentAnswer = idx;
    state.assessmentAnswered = true;
    const correct = idx === scene.assessment.correct_index;
    const opts = document.querySelectorAll('#assessment-options .assessment-option');
    opts.forEach((o, i) => {
      o.classList.add('locked');
      if (i === scene.assessment.correct_index) o.classList.add('correct');
      if (i === idx && !correct) o.classList.add('incorrect');
    });
    const fb = document.getElementById('assessment-feedback');
    fb.className = 'assessment-feedback show ' + (correct ? 'correct' : 'incorrect');
    fb.innerHTML = `
      <span class="feedback-label ${correct ? 'correct' : 'incorrect'}">
        ${correct ? '✓ إجابة صحيحة' : '✗ إجابة غير صحيحة'}
      </span>
      ${escapeHtml(correct ? scene.assessment.correct_feedback : scene.assessment.incorrect_feedback)}
    `;
    showToast(correct ? 'إجابة صحيحة!' : 'إجابة غير صحيحة', correct ? 'success' : 'error');

    // SCORM: progressive scoring — each correct assessment adds (100 / total_assessments)
    // Scenes 1-6 each have one assessment; scene 7 (dilemma) has 4 phases counted separately.
    // For scenes 1-6: each correct = 100/9 ≈ 11.11%. Scene 7 phases: 4 × 100/9 ≈ 11.11% each.
    if (!state.sceneScores) state.sceneScores = {};
    state.sceneScores[state.currentScreen] = correct ? 1 : 0;
    const totalScoreableScenes = 7; // scenes 1..6 single + scene 7 (counted via dilemma phases later)
    // Simple progressive: each scene's assessment = 100 / 7 ≈ 14.28%
    const scorePerScene = Math.round(100 / CONTENT.screens.length);
    const correctScenes = Object.values(state.sceneScores).filter(v => v === 1).length;
    const totalScore = Math.min(100, correctScenes * scorePerScene);
    window.ScormApi.setScore(totalScore, 0, 100);

    saveState();

    // After delay, show CTA for next scene
    setTimeout(() => {
      const ctaZone = $ctaZone();
      ctaZone.classList.remove('empty');
      const isLastScene = state.currentScreen >= CONTENT.screens.length - 1;
      ctaZone.innerHTML = `
        <button class="cta-primary" id="cta-next" type="button">
          <span>${correct ? (isLastScene ? 'أكملت الرحلة ✓' : 'التالي') : 'حاول مرة أخرى'}</span>
          <span class="cta-arrow">←</span>
        </button>
        <div class="cta-hint">${correct ? (isLastScene ? 'تهانينا على إتمام الرحلة' : 'انتقل إلى المشهد التالي') : 'راجع الإجابة الصحيحة ثم تابع'}</div>
      `;
      setTimeout(() => {
        const btn = document.getElementById('cta-next');
        btn.classList.add('visible');
        const h = ctaZone.querySelector('.cta-hint');
        if (h) h.classList.add('visible');
        btn.addEventListener('click', () => {
          if (correct) {
            if (isLastScene) {
              showToast('تهانينا! أكملت الرحلة كاملة', 'success');
              window.ScormApi.setStatus('completed');
              window.ScormApi.setStatus('passed');
            } else {
              // Advance to next scene
              state.currentScreen++;
              saveState();
              renderScene(state.currentScreen);
            }
          } else {
            // Reset assessment IN PLACE (no full re-render) for robust recovery
            // Boardroom uses state.assessmentAnswer/assessmentAnswered (legacy),
            // so we reset those plus call the generic in-place reset.
            state.assessmentAnswer = null;
            state.assessmentAnswered = false;
            // Also ensure sceneState exists for boardroom so resetAssessmentInPlace works
            if (!state.sceneState[state.currentScreen]) {
              state.sceneState[state.currentScreen] = { explored: state.exploredSeats.slice(), answered: false, answer: null, narrationCompleted: true };
            }
            state.sceneState[state.currentScreen].answered = false;
            state.sceneState[state.currentScreen].answer = null;
            resetAssessmentInPlace(scene);
          }
        });
      }, 100);
    }, 2000);
  }

  function showAssessmentAnswer(scene) {
    const opts = document.querySelectorAll('#assessment-options .assessment-option');
    opts.forEach((o, i) => {
      o.classList.add('locked');
      if (i === scene.assessment.correct_index) o.classList.add('correct');
      if (i === state.assessmentAnswer && i !== scene.assessment.correct_index) o.classList.add('incorrect');
    });
    const fb = document.getElementById('assessment-feedback');
    const correct = state.assessmentAnswer === scene.assessment.correct_index;
    fb.className = 'assessment-feedback show ' + (correct ? 'correct' : 'incorrect');
    fb.innerHTML = `
      <span class="feedback-label ${correct ? 'correct' : 'incorrect'}">
        ${correct ? '✓ إجابة صحيحة' : '✗ إجابة غير صحيحة'}
      </span>
      ${escapeHtml(correct ? scene.assessment.correct_feedback : scene.assessment.incorrect_feedback)}
    `;
    document.getElementById('assessment-panel').classList.add('visible');
  }

  // ============================================================
  // SCENE 3 — Building the Framework (Layered Ziggurat)
  // ============================================================
  function renderFramework(scene) {
    document.body.classList.add('cinematic');
    const stage = $stage();
    stage.style.opacity = '1';

    // Per-scene state
    if (!state.sceneState[state.currentScreen]) {
      state.sceneState[state.currentScreen] = { explored: [], answered: false, answer: null, narrationCompleted: false };
    }
    const ss = state.sceneState[state.currentScreen];

    // Render layers (DOM order: bottom = layer 1; we use column-reverse in CSS)
    const layersHtml = scene.layers.map(layer => `
      <div class="framework-layer" data-layer="${layer.n}" data-layer-idx="${layer.n - 1}" tabindex="0" role="button"
           aria-label="الطبقة ${arabicNumeral(layer.n)}: ${layer.label}. اضغط للاستكشاف">
        <div class="framework-layer-num">${layer.icon}</div>
        <div class="framework-layer-label">${escapeHtml(layer.label)}</div>
        <div class="framework-layer-check">✓</div>
      </div>
    `).join('');

    stage.innerHTML = `
      <div class="scene-framework">
        <div class="framework-header" id="fw-header">
          <div class="framework-eyebrow">${escapeHtml(scene.eyebrow)}</div>
          <h2 class="framework-title">${escapeHtml(scene.hero_title)}</h2>
          <p class="framework-instruction">${escapeHtml(scene.instruction)}</p>
        </div>
        <div class="framework-tower" id="fw-tower">${layersHtml}</div>
        <div class="framework-progress" id="fw-progress">
          <span>استكشفت</span>
          <div class="progress-dots" id="fw-progress-dots">
            ${scene.layers.map(() => '<span class="progress-dot"></span>').join('')}
          </div>
          <span id="fw-progress-text">٠ من ${arabicNumeral(scene.layers.length)}</span>
        </div>
        <div class="assessment-panel" id="assessment-panel">
          <div class="assessment-eyebrow">اختبار سريع</div>
          <div class="assessment-question">${escapeHtml(scene.assessment.question)}</div>
          <div class="assessment-options" id="assessment-options">
            ${scene.assessment.options.map((opt, i) => `
              <button class="assessment-option" data-idx="${i}" type="button">
                <span class="option-letter">${['أ','ب','ج','د'][i]}</span>
                <span class="option-text">${escapeHtml(opt)}</span>
              </button>
            `).join('')}
          </div>
          <div class="assessment-feedback" id="assessment-feedback"></div>
        </div>
      </div>
    `;

    const reduced = Animator.reducedMotion;
    const tl = [];

    if (reduced) {
      tl.push({ time: 0, fn: () => {
        document.getElementById('fw-header').classList.add('anim-fade-in');
        document.querySelectorAll('.framework-layer').forEach(l => l.classList.add('revealed'));
      }});
    } else {
      tl.push({ time: 0.2, fn: () => document.getElementById('fw-header').classList.add('anim-fade-up') });
      // Reveal layers from bottom (1) to top (6) — staggered
      scene.layers.forEach((layer, i) => {
        tl.push({ time: 1.5 + i * 0.4, fn: () => {
          const el = document.querySelector(`.framework-layer[data-layer="${layer.n}"]`);
          if (el) el.classList.add('revealed');
        }});
      });
    }

    // Narration
    const narrationStart = reduced ? 0.5 : 2.5;
    tl.push({ time: narrationStart, fn: () => {
      Narrator.start(scene.narration, {
        totalSeconds: scene.narration_total_seconds,
        onSegment: (seg, idx) => {
          if (seg.layer) {
            const el = document.querySelector(`.framework-layer[data-layer="${seg.layer}"]`);
            if (el) Animator.pulseGlow(el, 3.5);
          }
        },
        onComplete: () => {
          ss.narrationCompleted = true;
          saveState();
          document.getElementById('fw-progress').classList.add('visible');
          enableFrameworkLayers(scene);
          showToast('كل طبقة جاهزة للاستكشاف — انقر للبدء', 'success');
        },
      });
    }});

    // If narration already completed, skip to interactive mode
    if (ss.narrationCompleted) {
      Animator.clear();
      Narrator.hideNarrator();
      document.getElementById('subtitle-bar').classList.remove('visible');
      document.getElementById('fw-progress').classList.add('visible');
      document.querySelectorAll('.framework-layer').forEach(l => l.classList.add('revealed'));
      enableFrameworkLayers(scene);
      // Restore explored state
      ss.explored.forEach(n => {
        const el = document.querySelector(`.framework-layer[data-layer="${n}"]`);
        if (el) el.classList.add('completed');
      });
      updateFrameworkProgress(scene);
      if (ss.answered) {
        showFrameworkAssessment(scene);
      } else if (ss.explored.length === scene.layers.length) {
        // All explored but not yet answered — show + enable assessment
        document.getElementById('assessment-panel').classList.add('visible');
        enableAssessment(scene, 'framework');
      }
    } else {
      Animator.runTimeline(tl);
    }
  }

  function enableFrameworkLayers(scene) {
    const ss = state.sceneState[state.currentScreen];
    scene.layers.forEach(layer => {
      const el = document.querySelector(`.framework-layer[data-layer="${layer.n}"]`);
      if (!el) return;
      if (ss.explored.includes(layer.n)) el.classList.add('completed');
      el.addEventListener('click', () => openLayerModal(layer, scene));
      el.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openLayerModal(layer, scene); }
      });
    });
    updateFrameworkProgress(scene);
  }

  function openLayerModal(layer, scene) {
    const content = `
      <div class="seat-modal-card" tabindex="-1">
        <div class="seat-modal-num">${layer.icon}</div>
        <div class="seat-modal-eyebrow">الطبقة ${arabicNumeral(layer.n)} من ${arabicNumeral(scene.layers.length)}</div>
        <h3 class="seat-modal-title">${escapeHtml(layer.label)}</h3>
        <div class="seat-modal-story">${escapeHtml(layer.story)}</div>
        <div class="seat-modal-def-label">التعريف الرسمي</div>
        <div class="seat-modal-def">${escapeHtml(layer.definition)}</div>
        <button class="seat-modal-close" type="button">فهمت</button>
      </div>
    `;
    ModalManager.open({
      content,
      label: `الطبقة ${arabicNumeral(layer.n)}: ${layer.label}`,
      onClose: () => {
        const ss = state.sceneState[state.currentScreen];
        if (!ss.explored.includes(layer.n)) {
          ss.explored.push(layer.n);
          const el = document.querySelector(`.framework-layer[data-layer="${layer.n}"]`);
          if (el) el.classList.add('completed');
          saveState();
          updateFrameworkProgress(scene);
          if (ss.explored.length === scene.layers.length && !ss.answered) {
            setTimeout(() => {
              document.getElementById('assessment-panel').classList.add('visible');
              enableAssessment(scene, 'framework');
              document.getElementById('assessment-panel').scrollIntoView({ behavior: 'smooth', block: 'center' });
              showToast('أحسنت! اختبر فهمك الآن', 'success');
            }, 400);
          }
        }
      },
    });
    const closeBtn = ModalManager.current.overlay.querySelector('.seat-modal-close');
    if (closeBtn) closeBtn.addEventListener('click', () => ModalManager.close());
  }

  function updateFrameworkProgress(scene) {
    const ss = state.sceneState[state.currentScreen];
    const total = scene.layers.length;
    const done = ss.explored.length;
    const txt = document.getElementById('fw-progress-text');
    if (txt) txt.textContent = `${arabicNumeral(done)} من ${arabicNumeral(total)}`;
    const dots = document.querySelectorAll('#fw-progress-dots .progress-dot');
    dots.forEach((dot, i) => {
      dot.classList.toggle('filled', i < done);
      dot.classList.toggle('all-done', done === total);
    });
    const prog = document.getElementById('fw-progress');
    if (prog && done === total) {
      prog.style.borderColor = 'var(--green)';
      prog.style.color = 'var(--green)';
    }
  }

  function showFrameworkAssessment(scene) {
    const ss = state.sceneState[state.currentScreen];
    const opts = document.querySelectorAll('#assessment-options .assessment-option');
    opts.forEach((o, i) => {
      o.classList.add('locked');
      if (i === scene.assessment.correct_index) o.classList.add('correct');
      if (i === ss.answer && i !== scene.assessment.correct_index) o.classList.add('incorrect');
    });
    const fb = document.getElementById('assessment-feedback');
    const correct = ss.answer === scene.assessment.correct_index;
    fb.className = 'assessment-feedback show ' + (correct ? 'correct' : 'incorrect');
    fb.innerHTML = `
      <span class="feedback-label ${correct ? 'correct' : 'incorrect'}">
        ${correct ? '✓ إجابة صحيحة' : '✗ إجابة غير صحيحة'}
      </span>
      ${escapeHtml(correct ? scene.assessment.correct_feedback : scene.assessment.incorrect_feedback)}
    `;
    document.getElementById('assessment-panel').classList.add('visible');
  }

  // ============================================================
  // SCENE 4 — Twin Pillars (Governance + Compliance)
  // ============================================================
  function renderPillars(scene) {
    document.body.classList.add('cinematic');
    const stage = $stage();
    stage.style.opacity = '1';

    if (!state.sceneState[state.currentScreen]) {
      state.sceneState[state.currentScreen] = { explored: [], answered: false, answer: null, narrationCompleted: false };
    }
    const ss = state.sceneState[state.currentScreen];

    stage.innerHTML = `
      <div class="scene-pillars">
        <div class="pillars-header" id="pl-header">
          <div class="pillars-eyebrow">${escapeHtml(scene.eyebrow)}</div>
          <h2 class="pillars-title">${escapeHtml(scene.hero_title)}</h2>
          <p class="pillars-instruction">${escapeHtml(scene.instruction)}</p>
        </div>
        <div class="pillars-stage" id="pl-stage">
          <div class="pillars-arch" id="pl-arch">الاستدامة</div>
          <div class="pillar gov" id="pillar-gov" data-pillar="gov" tabindex="0" role="button" aria-label="ركيزة الحوكمة">
            <div class="pillar-icon">ح</div>
            <div class="pillar-label">${escapeHtml(scene.pillars.gov.label)}</div>
            <div class="pillar-subtitle">${escapeHtml(scene.pillars.gov.subtitle)}</div>
            <div class="pillar-question">${escapeHtml(scene.pillars.gov.question)}</div>
            <div class="pillar-facets">
              ${scene.pillars.gov.facets.map(f => `<div class="pillar-facet">${escapeHtml(f)}</div>`).join('')}
            </div>
          </div>
          <div class="pillar comp" id="pillar-comp" data-pillar="comp" tabindex="0" role="button" aria-label="ركيزة الامتثال">
            <div class="pillar-icon">ا</div>
            <div class="pillar-label">${escapeHtml(scene.pillars.comp.label)}</div>
            <div class="pillar-subtitle">${escapeHtml(scene.pillars.comp.subtitle)}</div>
            <div class="pillar-question">${escapeHtml(scene.pillars.comp.question)}</div>
            <div class="pillar-facets">
              ${scene.pillars.comp.facets.map(f => `<div class="pillar-facet">${escapeHtml(f)}</div>`).join('')}
            </div>
          </div>
        </div>
        <div class="pillars-progress" id="pl-progress">
          <span>استكشفت</span>
          <div class="progress-dots" id="pl-progress-dots">
            <span class="progress-dot"></span>
            <span class="progress-dot"></span>
          </div>
          <span id="pl-progress-text">٠ من ٢</span>
        </div>
        <div class="assessment-panel" id="assessment-panel">
          <div class="assessment-eyebrow">اختبار سريع</div>
          <div class="assessment-question">${escapeHtml(scene.assessment.question)}</div>
          <div class="assessment-options" id="assessment-options">
            ${scene.assessment.options.map((opt, i) => `
              <button class="assessment-option" data-idx="${i}" type="button">
                <span class="option-letter">${['أ','ب','ج','د'][i]}</span>
                <span class="option-text">${escapeHtml(opt)}</span>
              </button>
            `).join('')}
          </div>
          <div class="assessment-feedback" id="assessment-feedback"></div>
        </div>
      </div>
    `;

    const reduced = Animator.reducedMotion;
    const tl = [];

    if (reduced) {
      tl.push({ time: 0, fn: () => {
        document.getElementById('pl-header').classList.add('anim-fade-in');
        document.getElementById('pillar-gov').classList.add('revealed');
        document.getElementById('pillar-comp').classList.add('revealed');
        document.getElementById('pl-arch').classList.add('descended');
      }});
    } else {
      tl.push({ time: 0.2, fn: () => document.getElementById('pl-header').classList.add('anim-fade-up') });
      tl.push({ time: 3.5, fn: () => document.getElementById('pillar-gov').classList.add('revealed') });
      tl.push({ time: 8.0, fn: () => document.getElementById('pillar-comp').classList.add('revealed') });
      tl.push({ time: 19.5, fn: () => document.getElementById('pl-arch').classList.add('descended') });
    }

    const narrationStart = reduced ? 0.5 : 2.5;
    tl.push({ time: narrationStart, fn: () => {
      Narrator.start(scene.narration, {
        totalSeconds: scene.narration_total_seconds,
        onSegment: (seg, idx) => {
          if (seg.pillar === 'gov') {
            const el = document.getElementById('pillar-gov');
            if (el) Animator.pulseGlow(el, 3.5);
          } else if (seg.pillar === 'comp') {
            const el = document.getElementById('pillar-comp');
            if (el) Animator.pulseGlow(el, 3.5);
          }
        },
        onComplete: () => {
          ss.narrationCompleted = true;
          saveState();
          document.getElementById('pl-progress').classList.add('visible');
          enablePillars(scene);
          showToast('كل ركيزة جاهزة للاستكشاف — انقر للبدء', 'success');
        },
      });
    }});

    if (ss.narrationCompleted) {
      Animator.clear();
      Narrator.hideNarrator();
      document.getElementById('subtitle-bar').classList.remove('visible');
      document.getElementById('pl-progress').classList.add('visible');
      document.getElementById('pillar-gov').classList.add('revealed');
      document.getElementById('pillar-comp').classList.add('revealed');
      document.getElementById('pl-arch').classList.add('descended');
      enablePillars(scene);
      ss.explored.forEach(p => {
        const el = document.getElementById('pillar-' + p);
        if (el) el.classList.add('expanded');
      });
      updatePillarsProgress(scene);
      if (ss.answered) {
        showPillarsAssessment(scene);
      } else if (ss.explored.length === 2) {
        // Both pillars explored but not yet answered — show + enable assessment
        document.getElementById('assessment-panel').classList.add('visible');
        enableAssessment(scene, 'pillars');
      }
    } else {
      Animator.runTimeline(tl);
    }
  }

  function enablePillars(scene) {
    const ss = state.sceneState[state.currentScreen];
    ['gov', 'comp'].forEach(p => {
      const el = document.getElementById('pillar-' + p);
      if (!el) return;
      if (ss.explored.includes(p)) el.classList.add('expanded');
      el.addEventListener('click', () => togglePillar(p, scene));
      el.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); togglePillar(p, scene); }
      });
    });
    updatePillarsProgress(scene);
  }

  function togglePillar(p, scene) {
    const el = document.getElementById('pillar-' + p);
    if (!el) return;
    const ss = state.sceneState[state.currentScreen];
    // Toggle expansion
    const wasExpanded = el.classList.contains('expanded');
    el.classList.add('expanded');
    // Dim the other pillar
    const other = document.getElementById('pillar-' + (p === 'gov' ? 'comp' : 'gov'));
    if (other) other.classList.add('dimmed');
    // Mark as explored
    if (!ss.explored.includes(p)) {
      ss.explored.push(p);
      saveState();
      updatePillarsProgress(scene);
      if (ss.explored.length === 2 && !ss.answered) {
        setTimeout(() => {
          document.getElementById('assessment-panel').classList.add('visible');
          enableAssessment(scene, 'pillars');
          document.getElementById('assessment-panel').scrollIntoView({ behavior: 'smooth', block: 'center' });
          showToast('أحسنت! اختبر فهمك الآن', 'success');
        }, 400);
      }
    }
    // Scroll to top of pillar so facets are visible
    setTimeout(() => el.scrollIntoView({ behavior: 'smooth', block: 'center' }), 100);
  }

  function updatePillarsProgress(scene) {
    const ss = state.sceneState[state.currentScreen];
    const total = 2;
    const done = ss.explored.length;
    const txt = document.getElementById('pl-progress-text');
    if (txt) txt.textContent = `${arabicNumeral(done)} من ${arabicNumeral(total)}`;
    const dots = document.querySelectorAll('#pl-progress-dots .progress-dot');
    dots.forEach((dot, i) => {
      dot.classList.toggle('filled', i < done);
      dot.classList.toggle('all-done', done === total);
    });
    const prog = document.getElementById('pl-progress');
    if (prog && done === total) {
      prog.style.borderColor = 'var(--green)';
      prog.style.color = 'var(--green)';
    }
  }

  function showPillarsAssessment(scene) {
    const ss = state.sceneState[state.currentScreen];
    const opts = document.querySelectorAll('#assessment-options .assessment-option');
    opts.forEach((o, i) => {
      o.classList.add('locked');
      if (i === scene.assessment.correct_index) o.classList.add('correct');
      if (i === ss.answer && i !== scene.assessment.correct_index) o.classList.add('incorrect');
    });
    const fb = document.getElementById('assessment-feedback');
    const correct = ss.answer === scene.assessment.correct_index;
    fb.className = 'assessment-feedback show ' + (correct ? 'correct' : 'incorrect');
    fb.innerHTML = `
      <span class="feedback-label ${correct ? 'correct' : 'incorrect'}">
        ${correct ? '✓ إجابة صحيحة' : '✗ إجابة غير صحيحة'}
      </span>
      ${escapeHtml(correct ? scene.assessment.correct_feedback : scene.assessment.incorrect_feedback)}
    `;
    document.getElementById('assessment-panel').classList.add('visible');
  }

  // ============================================================
  // SCENE 5 — Decision Court (Classification Cards)
  // ============================================================
  function renderCourt(scene) {
    document.body.classList.add('cinematic');
    const stage = $stage();
    stage.style.opacity = '1';

    if (!state.sceneState[state.currentScreen]) {
      state.sceneState[state.currentScreen] = {
        classifications: {}, // {caseN: 'gov' | 'comp'}
        answered: false,
        answer: null,
        narrationCompleted: false,
        currentCase: 1,
      };
    }
    const ss = state.sceneState[state.currentScreen];

    stage.innerHTML = `
      <div class="scene-court">
        <div class="court-header" id="ct-header">
          <div class="court-eyebrow">${escapeHtml(scene.eyebrow)}</div>
          <h2 class="court-title">${escapeHtml(scene.hero_title)}</h2>
          <p class="court-scenario">${escapeHtml(scene.scenario)}</p>
        </div>
        <div class="court-progress" id="ct-progress">
          ${scene.cases.map((c, i) => `<div class="court-progress-dot" data-case="${c.n}">${arabicNumeral(c.n)}</div>`).join('')}
        </div>
        <div id="ct-case-container"></div>
        <div class="assessment-panel" id="assessment-panel">
          <div class="assessment-eyebrow">القاعدة الذهبية</div>
          <div class="assessment-question">${escapeHtml(scene.assessment.question)}</div>
          <div class="assessment-options" id="assessment-options">
            ${scene.assessment.options.map((opt, i) => `
              <button class="assessment-option" data-idx="${i}" type="button">
                <span class="option-letter">${['أ','ب','ج','د'][i]}</span>
                <span class="option-text">${escapeHtml(opt)}</span>
              </button>
            `).join('')}
          </div>
          <div class="assessment-feedback" id="assessment-feedback"></div>
        </div>
      </div>
    `;

    const reduced = Animator.reducedMotion;
    const tl = [];
    if (reduced) {
      tl.push({ time: 0, fn: () => document.getElementById('ct-header').classList.add('anim-fade-in') });
    } else {
      tl.push({ time: 0.2, fn: () => document.getElementById('ct-header').classList.add('anim-fade-up') });
    }

    const narrationStart = reduced ? 0.5 : 2.5;
    tl.push({ time: narrationStart, fn: () => {
      Narrator.start(scene.narration, {
        totalSeconds: scene.narration_total_seconds,
        onComplete: () => {
          ss.narrationCompleted = true;
          saveState();
          // Show first case (or current if returning)
          showCourtCase(scene, ss.currentCase || 1);
          // Update progress dots
          updateCourtProgress(scene);
        },
      });
    }});

    if (ss.narrationCompleted) {
      Animator.clear();
      Narrator.hideNarrator();
      document.getElementById('subtitle-bar').classList.remove('visible');
      updateCourtProgress(scene);
      // If all classified, show assessment
      if (Object.keys(ss.classifications).length === scene.cases.length) {
        if (ss.answered) {
          showCourtAssessment(scene);
        } else {
          document.getElementById('assessment-panel').classList.add('visible');
          enableAssessment(scene, 'court');
        }
      } else {
        // Resume at first unclassified case
        const nextCase = scene.cases.find(c => !ss.classifications[c.n]) || scene.cases[0];
        showCourtCase(scene, nextCase.n);
      }
    } else {
      Animator.runTimeline(tl);
    }
  }

  function showCourtCase(scene, caseN) {
    const caseData = scene.cases.find(c => c.n === caseN);
    if (!caseData) return;
    const ss = state.sceneState[state.currentScreen];
    const container = document.getElementById('ct-case-container');
    const alreadyClassified = ss.classifications[caseN] !== undefined;
    const isCorrect = alreadyClassified && ss.classifications[caseN] === caseData.classification;

    container.innerHTML = `
      <div class="court-card" id="court-card-${caseN}">
        <div class="court-card-num">القضية ${arabicNumeral(caseN)}</div>
        <div class="court-card-label">القرار المقترح</div>
        <div class="court-card-action">${escapeHtml(caseData.action)}</div>
        <div class="court-buttons">
          <button class="court-btn gov ${alreadyClassified && ss.classifications[caseN] === 'gov' ? 'selected' : ''} ${alreadyClassified ? 'locked' : ''}" data-choice="gov" type="button" ${alreadyClassified ? 'disabled' : ''}>
            <span class="court-btn-icon">ح</span>
            حوكمة
          </button>
          <button class="court-btn comp ${alreadyClassified && ss.classifications[caseN] === 'comp' ? 'selected' : ''} ${alreadyClassified ? 'locked' : ''}" data-choice="comp" type="button" ${alreadyClassified ? 'disabled' : ''}>
            <span class="court-btn-icon">ا</span>
            امتثال
          </button>
        </div>
        <div class="court-verdict ${alreadyClassified ? 'show ' + (isCorrect ? 'correct' : 'incorrect') : ''}" id="court-verdict-${caseN}">
          ${alreadyClassified ? (isCorrect
            ? `<span class="court-verdict-label">✓ تصنيف صحيح</span>${escapeHtml(caseData.rationale)}`
            : `<span class="court-verdict-label">✗ تصنيف غير صحيح</span>التصنيف الصحيح: ${caseData.classification === 'gov' ? 'حوكمة' : 'امتثال'}. ${escapeHtml(caseData.rationale)}`) : ''}
        </div>
      </div>
    `;

    if (!alreadyClassified) {
      container.querySelectorAll('.court-btn').forEach(btn => {
        btn.addEventListener('click', () => {
          const choice = btn.dataset.choice;
          ss.classifications[caseN] = choice;
          saveState();
          // Re-render this case to show verdict
          showCourtCase(scene, caseN);
          updateCourtProgress(scene);
          const isNowCorrect = choice === caseData.classification;
          showToast(isNowCorrect ? 'تصنيف صحيح!' : 'تصنيف غير صحيح', isNowCorrect ? 'success' : 'error');
          // Advance to next case after delay
          setTimeout(() => {
            const nextCase = scene.cases.find(c => !ss.classifications[c.n]);
            if (nextCase) {
              ss.currentCase = nextCase.n;
              saveState();
              showCourtCase(scene, nextCase.n);
              document.getElementById('court-card-' + nextCase.n).scrollIntoView({ behavior: 'smooth', block: 'center' });
            } else {
              // All classified — show assessment
              ss.currentCase = null;
              saveState();
              document.getElementById('assessment-panel').classList.add('visible');
              enableAssessment(scene, 'court');
              document.getElementById('assessment-panel').scrollIntoView({ behavior: 'smooth', block: 'center' });
              showToast('أحسنت! اختبر فهمك بالقاعدة الذهبية', 'success');
            }
          }, 2800);
        });
      });
    }
  }

  function updateCourtProgress(scene) {
    const ss = state.sceneState[state.currentScreen];
    scene.cases.forEach(c => {
      const dot = document.querySelector(`.court-progress-dot[data-case="${c.n}"]`);
      if (!dot) return;
      dot.classList.remove('current', 'correct', 'incorrect');
      if (ss.classifications[c.n] !== undefined) {
        const isCorrect = ss.classifications[c.n] === c.classification;
        dot.classList.add(isCorrect ? 'correct' : 'incorrect');
      } else if (ss.currentCase === c.n) {
        dot.classList.add('current');
      }
    });
  }

  function showCourtAssessment(scene) {
    const ss = state.sceneState[state.currentScreen];
    const opts = document.querySelectorAll('#assessment-options .assessment-option');
    opts.forEach((o, i) => {
      o.classList.add('locked');
      if (i === scene.assessment.correct_index) o.classList.add('correct');
      if (i === ss.answer && i !== scene.assessment.correct_index) o.classList.add('incorrect');
    });
    const fb = document.getElementById('assessment-feedback');
    const correct = ss.answer === scene.assessment.correct_index;
    fb.className = 'assessment-feedback show ' + (correct ? 'correct' : 'incorrect');
    fb.innerHTML = `
      <span class="feedback-label ${correct ? 'correct' : 'incorrect'}">
        ${correct ? '✓ إجابة صحيحة' : '✗ إجابة غير صحيحة'}
      </span>
      ${escapeHtml(correct ? scene.assessment.correct_feedback : scene.assessment.incorrect_feedback)}
    `;
    document.getElementById('assessment-panel').classList.add('visible');
  }

  // ============================================================
  // SCENE 6 — Integrity Map (Star Constellation)
  // ============================================================
  function renderIntegrity(scene) {
    document.body.classList.add('cinematic');
    const stage = $stage();
    stage.style.opacity = '1';

    if (!state.sceneState[state.currentScreen]) {
      state.sceneState[state.currentScreen] = { explored: [], answered: false, answer: null, narrationCompleted: false };
    }
    const ss = state.sceneState[state.currentScreen];

    // Build star SVG — 1 center star + 5 outer stars in a circle
    const cx = 280, cy = 280; // SVG center
    const centerStar = scene.stars.find(s => s.isCenter);
    const outerStars = scene.stars.filter(s => !s.isCenter);
    const radius = 180; // distance from center for outer stars

    const outerStarsHtml = outerStars.map((star, i) => {
      // Convert angle to x,y; start at top (-90deg) and go clockwise
      const angleRad = ((star.angle - 90) * Math.PI) / 180;
      const x = cx + radius * Math.cos(angleRad);
      const y = cy + radius * Math.sin(angleRad);
      return `
        <g class="integrity-star" id="star-${star.n}" data-star-n="${star.n}" transform="translate(${x}, ${y})" tabindex="0" role="button"
           aria-label="النجم ${arabicNumeral(star.n)}: ${star.label}. اضغط للاستكشاف">
          <circle class="star-circle" r="26"/>
          <text class="star-icon" y="2">${star.icon}</text>
          <text class="star-label" y="48">${escapeHtml(star.label)}</text>
          <text class="star-check" y="-30">✓</text>
        </g>
      `;
    }).join('');

    // Center star (larger)
    const centerStarHtml = centerStar ? `
      <g class="integrity-star star-center" id="star-${centerStar.n}" data-star-n="${centerStar.n}" transform="translate(${cx}, ${cy})" tabindex="0" role="button"
         aria-label="النجم المركزي: ${centerStar.label}. اضغط للاستكشاف">
        <circle class="star-circle" r="36"/>
        <text class="star-icon" y="2">${centerStar.icon}</text>
        <text class="star-label" y="56">${escapeHtml(centerStar.label)}</text>
        <text class="star-check" y="-40">✓</text>
      </g>
    ` : '';

    // Background twinkle dots
    const bgDots = Array.from({ length: 20 }, (_, i) => {
      const x = 40 + Math.random() * 480;
      const y = 40 + Math.random() * 480;
      const r = 0.8 + Math.random() * 1.5;
      const delay = Math.random() * 4;
      return `<circle class="star-bg-dot" cx="${x}" cy="${y}" r="${r}" style="animation-delay:${delay}s"/>`;
    }).join('');

    stage.innerHTML = `
      <div class="scene-integrity">
        <div class="integrity-header" id="in-header">
          <div class="integrity-eyebrow">${escapeHtml(scene.eyebrow)}</div>
          <h2 class="integrity-title">${escapeHtml(scene.hero_title)}</h2>
          <p class="integrity-instruction">${escapeHtml(scene.instruction)}</p>
        </div>
        <div class="integrity-stage" id="in-stage">
          <svg class="integrity-svg" viewBox="0 0 560 560" xmlns="http://www.w3.org/2000/svg">
            <defs>
              <radialGradient id="in-glow" cx="0.5" cy="0.5" r="0.5">
                <stop offset="0%" stop-color="#D4AF37" stop-opacity="0.12"/>
                <stop offset="100%" stop-color="#D4AF37" stop-opacity="0"/>
              </radialGradient>
            </defs>
            <!-- Soft background glow -->
            <circle cx="${cx}" cy="${cy}" r="200" fill="url(#in-glow)"/>
            <!-- Background twinkle dots -->
            ${bgDots}
            <!-- Outer stars -->
            ${outerStarsHtml}
            <!-- Center star -->
            ${centerStarHtml}
          </svg>
        </div>
        <div class="integrity-progress" id="in-progress">
          <span>استكشفت</span>
          <div class="progress-dots" id="in-progress-dots">
            ${scene.stars.map(() => '<span class="progress-dot"></span>').join('')}
          </div>
          <span id="in-progress-text">٠ من ${arabicNumeral(scene.stars.length)}</span>
        </div>
        <div class="assessment-panel" id="assessment-panel">
          <div class="assessment-eyebrow">اختبار سريع</div>
          <div class="assessment-question">${escapeHtml(scene.assessment.question)}</div>
          <div class="assessment-options" id="assessment-options">
            ${scene.assessment.options.map((opt, i) => `
              <button class="assessment-option" data-idx="${i}" type="button">
                <span class="option-letter">${['أ','ب','ج','د'][i]}</span>
                <span class="option-text">${escapeHtml(opt)}</span>
              </button>
            `).join('')}
          </div>
          <div class="assessment-feedback" id="assessment-feedback"></div>
        </div>
      </div>
    `;

    const reduced = Animator.reducedMotion;
    const tl = [];
    if (reduced) {
      tl.push({ time: 0, fn: () => document.getElementById('in-header').classList.add('anim-fade-in') });
    } else {
      tl.push({ time: 0.2, fn: () => document.getElementById('in-header').classList.add('anim-fade-up') });
    }

    const narrationStart = reduced ? 0.5 : 2.5;
    tl.push({ time: narrationStart, fn: () => {
      Narrator.start(scene.narration, {
        totalSeconds: scene.narration_total_seconds,
        onSegment: (seg, idx) => {
          if (seg.star === 'center') {
            const el = document.getElementById(`star-${centerStar.n}`);
            if (el) Animator.pulseGlow(el, 3.5);
          } else if (seg.star) {
            const el = document.getElementById(`star-${seg.star}`);
            if (el) Animator.pulseGlow(el, 3.5);
          }
        },
        onComplete: () => {
          ss.narrationCompleted = true;
          saveState();
          document.getElementById('in-progress').classList.add('visible');
          enableIntegrityStars(scene);
          showToast('كل نجم جاهز للاستكشاف — انقر للبدء', 'success');
        },
      });
    }});

    if (ss.narrationCompleted) {
      Animator.clear();
      Narrator.hideNarrator();
      document.getElementById('subtitle-bar').classList.remove('visible');
      document.getElementById('in-progress').classList.add('visible');
      enableIntegrityStars(scene);
      ss.explored.forEach(n => {
        const el = document.getElementById(`star-${n}`);
        if (el) el.classList.add('completed');
      });
      updateIntegrityProgress(scene);
      if (ss.answered) {
        showIntegrityAssessment(scene);
      } else if (ss.explored.length === scene.stars.length) {
        // All stars explored but not yet answered — show + enable assessment
        document.getElementById('assessment-panel').classList.add('visible');
        enableAssessment(scene, 'integrity');
      }
    } else {
      Animator.runTimeline(tl);
    }
  }

  function enableIntegrityStars(scene) {
    const ss = state.sceneState[state.currentScreen];
    scene.stars.forEach(star => {
      const el = document.getElementById(`star-${star.n}`);
      if (!el) return;
      if (ss.explored.includes(star.n)) el.classList.add('completed');
      el.addEventListener('click', () => openStarModal(star, scene));
      el.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openStarModal(star, scene); }
      });
    });
    updateIntegrityProgress(scene);
  }

  function openStarModal(star, scene) {
    let frameworkHtml = '';
    if (star.hasFramework && star.framework) {
      frameworkHtml = `
        <div class="seat-modal-def-label">إطار الإدارة الرباعي</div>
        <div class="framework-cycle">
          ${star.framework.map((step, i) => `
            <div class="cycle-step">
              <div class="cycle-step-num">${arabicNumeral(i + 1)}</div>
              <div class="cycle-step-label">${escapeHtml(step.step)}</div>
              <div class="cycle-step-desc">${escapeHtml(step.desc)}</div>
            </div>
            ${i < star.framework.length - 1 ? '<div class="cycle-arrow">←</div>' : ''}
          `).join('')}
        </div>
      `;
    }
    const content = `
      <div class="seat-modal-card" tabindex="-1">
        <div class="seat-modal-num">${star.icon}</div>
        <div class="seat-modal-eyebrow">${star.isCenter ? 'النجم المركزي' : 'النجم ' + arabicNumeral(star.n) + ' من ' + arabicNumeral(scene.stars.length)}</div>
        <h3 class="seat-modal-title">${escapeHtml(star.label)}</h3>
        <div class="seat-modal-story">${escapeHtml(star.story)}</div>
        <div class="seat-modal-def-label">التعريف الرسمي</div>
        <div class="seat-modal-def">${escapeHtml(star.definition)}</div>
        ${frameworkHtml}
        <button class="seat-modal-close" type="button">فهمت</button>
      </div>
    `;
    ModalManager.open({
      content,
      label: `${star.isCenter ? 'النجم المركزي' : 'النجم ' + arabicNumeral(star.n)}: ${star.label}`,
      onClose: () => {
        const ss = state.sceneState[state.currentScreen];
        if (!ss.explored.includes(star.n)) {
          ss.explored.push(star.n);
          const el = document.getElementById(`star-${star.n}`);
          if (el) el.classList.add('completed');
          saveState();
          updateIntegrityProgress(scene);
          if (ss.explored.length === scene.stars.length && !ss.answered) {
            setTimeout(() => {
              document.getElementById('assessment-panel').classList.add('visible');
              enableAssessment(scene, 'integrity');
              document.getElementById('assessment-panel').scrollIntoView({ behavior: 'smooth', block: 'center' });
              showToast('أحسنت! اختبر فهمك الآن', 'success');
            }, 400);
          }
        }
      },
    });
    const closeBtn = ModalManager.current.overlay.querySelector('.seat-modal-close');
    if (closeBtn) closeBtn.addEventListener('click', () => ModalManager.close());
  }

  function updateIntegrityProgress(scene) {
    const ss = state.sceneState[state.currentScreen];
    const total = scene.stars.length;
    const done = ss.explored.length;
    const txt = document.getElementById('in-progress-text');
    if (txt) txt.textContent = `${arabicNumeral(done)} من ${arabicNumeral(total)}`;
    const dots = document.querySelectorAll('#in-progress-dots .progress-dot');
    dots.forEach((dot, i) => {
      dot.classList.toggle('filled', i < done);
      dot.classList.toggle('all-done', done === total);
    });
    const prog = document.getElementById('in-progress');
    if (prog && done === total) {
      prog.style.borderColor = 'var(--green)';
      prog.style.color = 'var(--green)';
    }
  }

  function showIntegrityAssessment(scene) {
    const ss = state.sceneState[state.currentScreen];
    const opts = document.querySelectorAll('#assessment-options .assessment-option');
    opts.forEach((o, i) => {
      o.classList.add('locked');
      if (i === scene.assessment.correct_index) o.classList.add('correct');
      if (i === ss.answer && i !== scene.assessment.correct_index) o.classList.add('incorrect');
    });
    const fb = document.getElementById('assessment-feedback');
    const correct = ss.answer === scene.assessment.correct_index;
    fb.className = 'assessment-feedback show ' + (correct ? 'correct' : 'incorrect');
    fb.innerHTML = `
      <span class="feedback-label ${correct ? 'correct' : 'incorrect'}">
        ${correct ? '✓ إجابة صحيحة' : '✗ إجابة غير صحيحة'}
      </span>
      ${escapeHtml(correct ? scene.assessment.correct_feedback : scene.assessment.incorrect_feedback)}
    `;
    document.getElementById('assessment-panel').classList.add('visible');
  }

  // ============================================================
  // SCENE 7 — The Dilemma (Branching Scenario)
  // ============================================================
  function renderDilemma(scene) {
    document.body.classList.add('cinematic');
    const stage = $stage();
    stage.style.opacity = '1';

    if (!state.sceneState[state.currentScreen]) {
      state.sceneState[state.currentScreen] = {
        phaseAnswers: {}, // {phaseN: optionIdx}
        phaseCorrect: {}, // {phaseN: bool}
        currentPhase: 1,
        completed: false,
        narrationCompleted: false,
      };
    }
    const ss = state.sceneState[state.currentScreen];

    stage.innerHTML = `
      <div class="scene-dilemma">
        <div class="dilemma-header" id="dl-header">
          <div class="dilemma-eyebrow">${escapeHtml(scene.eyebrow)}</div>
          <h2 class="dilemma-title">${escapeHtml(scene.hero_title)}</h2>
          <p class="dilemma-instruction">${escapeHtml(scene.instruction)}</p>
        </div>
        <div class="dilemma-progress" id="dl-progress">
          ${scene.phases.map(p => `<div class="dilemma-progress-dot" data-phase="${p.n}">${arabicNumeral(p.n)}</div>`).join('')}
        </div>
        <div id="dl-card-container"></div>
        <div class="dilemma-reflection" id="dl-reflection">
          <div class="dilemma-reflection-label">تأمّل نهائي</div>
          <div class="dilemma-reflection-prompt">${escapeHtml(scene.final_reflection)}</div>
        </div>
      </div>
    `;

    const reduced = Animator.reducedMotion;
    const tl = [];
    if (reduced) {
      tl.push({ time: 0, fn: () => document.getElementById('dl-header').classList.add('anim-fade-in') });
    } else {
      tl.push({ time: 0.2, fn: () => document.getElementById('dl-header').classList.add('anim-fade-up') });
    }

    const narrationStart = reduced ? 0.5 : 2.5;
    tl.push({ time: narrationStart, fn: () => {
      Narrator.start(scene.narration, {
        totalSeconds: scene.narration_total_seconds,
        onComplete: () => {
          ss.narrationCompleted = true;
          saveState();
          showDilemmaPhase(scene, ss.currentPhase || 1);
          updateDilemmaProgress(scene);
        },
      });
    }});

    if (ss.narrationCompleted) {
      Animator.clear();
      Narrator.hideNarrator();
      document.getElementById('subtitle-bar').classList.remove('visible');
      updateDilemmaProgress(scene);
      if (ss.completed) {
        // Show final state — last phase with reflection visible
        showDilemmaPhase(scene, scene.phases.length);
        document.getElementById('dl-reflection').classList.add('show');
        showDilemmaFinalCTA(scene);
      } else {
        showDilemmaPhase(scene, ss.currentPhase || 1);
      }
    } else {
      Animator.runTimeline(tl);
    }
  }

  function showDilemmaPhase(scene, phaseN) {
    const phase = scene.phases.find(p => p.n === phaseN);
    if (!phase) return;
    const ss = state.sceneState[state.currentScreen];
    const container = document.getElementById('dl-card-container');
    const answered = ss.phaseAnswers[phaseN] !== undefined;
    const selectedOpt = answered ? phase.options[ss.phaseAnswers[phaseN]] : null;

    container.innerHTML = `
      <div class="dilemma-card" id="dilemma-card-${phaseN}">
        <div class="dilemma-card-phase">المرحلة ${arabicNumeral(phaseN)} — ${escapeHtml(phase.title)}</div>
        <h3 class="dilemma-card-title">${escapeHtml(phase.scenario)}</h3>
        <div class="dilemma-card-question">${escapeHtml(phase.question)}</div>
        <div class="dilemma-options" id="dl-options">
          ${phase.options.map((opt, i) => `
            <button class="dilemma-option ${answered ? 'locked' : ''} ${answered && i === ss.phaseAnswers[phaseN] ? 'selected' : ''} ${answered && opt.correct ? 'correct' : ''} ${answered && i === ss.phaseAnswers[phaseN] && !opt.correct ? 'incorrect' : ''}" data-idx="${i}" type="button" ${answered ? 'disabled' : ''}>
              <span class="dilemma-option-letter">${['أ','ب','ج','د'][i]}</span>
              <span class="dilemma-option-text">${escapeHtml(opt.text)}</span>
            </button>
          `).join('')}
        </div>
        <div class="dilemma-consequence ${answered ? 'show ' + (selectedOpt.correct ? 'correct' : 'incorrect') : ''}" id="dl-consequence">
          ${answered ? `<span class="dilemma-consequence-label">${selectedOpt.correct ? '✓ قرار صحيح' : '✗ قرار غير صحيح'}</span>${escapeHtml(selectedOpt.consequence)}` : ''}
        </div>
        <div class="dilemma-card-actions" id="dl-actions">
          ${answered && selectedOpt.correct && phaseN < scene.phases.length ? '<button class="dilemma-action-btn show" id="dl-next" type="button">المرحلة التالية <span>←</span></button>' : ''}
          ${answered && !selectedOpt.correct ? '<button class="dilemma-action-btn show secondary" id="dl-retry" type="button">حاول مرة أخرى</button>' : ''}
          ${answered && selectedOpt.correct && phaseN === scene.phases.length ? '<button class="dilemma-action-btn show" id="dl-finish" type="button">عرض التأمّل النهائي <span>←</span></button>' : ''}
        </div>
      </div>
    `;

    if (!answered) {
      container.querySelectorAll('.dilemma-option').forEach(btn => {
        btn.addEventListener('click', () => {
          const idx = parseInt(btn.dataset.idx, 10);
          const opt = phase.options[idx];
          ss.phaseAnswers[phaseN] = idx;
          ss.phaseCorrect[phaseN] = !!opt.correct;
          saveState();
          // Re-render phase to show consequence
          showDilemmaPhase(scene, phaseN);
          updateDilemmaProgress(scene);
          showToast(opt.correct ? 'قرار صحيح!' : 'قرار غير صحيح', opt.correct ? 'success' : 'error');
        });
      });
    } else {
      // Wire action buttons
      const nextBtn = document.getElementById('dl-next');
      const retryBtn = document.getElementById('dl-retry');
      const finishBtn = document.getElementById('dl-finish');
      if (nextBtn) {
        nextBtn.addEventListener('click', () => {
          const nextN = phaseN + 1;
          ss.currentPhase = nextN;
          saveState();
          showDilemmaPhase(scene, nextN);
          updateDilemmaProgress(scene);
          document.getElementById(`dilemma-card-${nextN}`).scrollIntoView({ behavior: 'smooth', block: 'center' });
        });
      }
      if (retryBtn) {
        retryBtn.addEventListener('click', () => {
          delete ss.phaseAnswers[phaseN];
          delete ss.phaseCorrect[phaseN];
          saveState();
          showDilemmaPhase(scene, phaseN);
          updateDilemmaProgress(scene);
        });
      }
      if (finishBtn) {
        finishBtn.addEventListener('click', () => {
          ss.completed = true;
          saveState();
          // Show reflection
          document.getElementById('dl-reflection').classList.add('show');
          showDilemmaFinalCTA(scene);
          // Update SCORM — this is the final scene
          const correctPhases = Object.values(ss.phaseCorrect).filter(v => v).length;
          const totalPhases = scene.phases.length;
          // Score for this scene = (correctPhases / totalPhases) * (100/7)
          const sceneScore = Math.round((correctPhases / totalPhases) * (100 / CONTENT.screens.length));
          if (!state.sceneScores) state.sceneScores = {};
          state.sceneScores[state.currentScreen] = correctPhases === totalPhases ? 1 : 0;
          // Recompute total
          const correctScenes = Object.values(state.sceneScores).filter(v => v === 1).length;
          // For partial credit on dilemma, add the partial
          let totalScore = correctScenes * Math.round(100 / CONTENT.screens.length);
          if (state.sceneScores[state.currentScreen] === 0 && correctPhases > 0) {
            totalScore += Math.round((correctPhases / totalPhases) * Math.round(100 / CONTENT.screens.length));
          }
          totalScore = Math.min(100, totalScore);
          window.ScormApi.setScore(totalScore, 0, 100);
          if (correctPhases === totalPhases) {
            window.ScormApi.setStatus('completed');
            window.ScormApi.setStatus('passed');
            showToast(`تهانينا! أكملت الرحلة بنجاح (${arabicNumeral(correctPhases)}/${arabicNumeral(totalPhases)} قرارات صحيحة)`, 'success');
          } else {
            window.ScormApi.setStatus('completed');
            showToast(`أكملت الرحلة بـ ${arabicNumeral(correctPhases)} من ${arabicNumeral(totalPhases)} قرارات صحيحة`, 'success');
          }
          saveState();
        });
      }
    }
  }

  function updateDilemmaProgress(scene) {
    const ss = state.sceneState[state.currentScreen];
    scene.phases.forEach(p => {
      const dot = document.querySelector(`.dilemma-progress-dot[data-phase="${p.n}"]`);
      if (!dot) return;
      dot.classList.remove('current', 'correct', 'incorrect');
      if (ss.phaseCorrect[p.n] === true) dot.classList.add('correct');
      else if (ss.phaseCorrect[p.n] === false) dot.classList.add('incorrect');
      else if (ss.currentPhase === p.n) dot.classList.add('current');
    });
  }

  function showDilemmaFinalCTA(scene) {
    const ss = state.sceneState[state.currentScreen];
    const correctPhases = Object.values(ss.phaseCorrect).filter(v => v).length;
    const totalPhases = scene.phases.length;
    const allCorrect = correctPhases === totalPhases;
    const ctaZone = $ctaZone();
    ctaZone.classList.remove('empty');
    ctaZone.innerHTML = `
      <button class="cta-primary" id="cta-finish" type="button">
        <span>${allCorrect ? 'أكملت الرحلة ✓' : 'إعادة المعضلة'}</span>
        <span class="cta-arrow">←</span>
      </button>
      <div class="cta-hint">${allCorrect ? 'تهانينا على إتمام رحلة الحوكمة' : 'حاول مرة أخرى لتحسين نتيجتك'}</div>
    `;
    setTimeout(() => {
      const btn = document.getElementById('cta-finish');
      btn.classList.add('visible');
      const h = ctaZone.querySelector('.cta-hint');
      if (h) h.classList.add('visible');
      btn.addEventListener('click', () => {
        if (allCorrect) {
          showToast('تهانينا! أكملت رحلة الحوكمة بنجاح', 'success');
        } else {
          // Reset dilemma
          state.sceneState[state.currentScreen] = {
            phaseAnswers: {}, phaseCorrect: {}, currentPhase: 1, completed: false, narrationCompleted: true,
          };
          saveState();
          document.getElementById('dl-reflection').classList.remove('show');
          ctaZone.classList.add('empty');
          ctaZone.innerHTML = '';
          showDilemmaPhase(scene, 1);
          updateDilemmaProgress(scene);
        }
      });
    }, 100);
  }

  // ---------- Generic Assessment Handler (scenes 3-6) ----------
  function enableAssessment(scene, sceneType) {
    const opts = document.querySelectorAll('#assessment-options .assessment-option');
    opts.forEach(opt => {
      opt.addEventListener('click', () => {
        if (state.sceneState[state.currentScreen] && state.sceneState[state.currentScreen].answered) return;
        const idx = parseInt(opt.dataset.idx, 10);
        handleGenericAssessmentAnswer(idx, scene, sceneType);
      });
    });
  }

  function handleGenericAssessmentAnswer(idx, scene, sceneType) {
    const ss = state.sceneState[state.currentScreen];
    ss.answer = idx;
    ss.answered = true;
    const correct = idx === scene.assessment.correct_index;
    const opts = document.querySelectorAll('#assessment-options .assessment-option');
    opts.forEach((o, i) => {
      o.classList.add('locked');
      if (i === scene.assessment.correct_index) o.classList.add('correct');
      if (i === idx && !correct) o.classList.add('incorrect');
    });
    const fb = document.getElementById('assessment-feedback');
    fb.className = 'assessment-feedback show ' + (correct ? 'correct' : 'incorrect');
    fb.innerHTML = `
      <span class="feedback-label ${correct ? 'correct' : 'incorrect'}">
        ${correct ? '✓ إجابة صحيحة' : '✗ إجابة غير صحيحة'}
      </span>
      ${escapeHtml(correct ? scene.assessment.correct_feedback : scene.assessment.incorrect_feedback)}
    `;
    showToast(correct ? 'إجابة صحيحة!' : 'إجابة غير صحيحة', correct ? 'success' : 'error');

    // Update scene score
    if (!state.sceneScores) state.sceneScores = {};
    state.sceneScores[state.currentScreen] = correct ? 1 : 0;
    const scorePerScene = Math.round(100 / CONTENT.screens.length);
    const correctScenes = Object.values(state.sceneScores).filter(v => v === 1).length;
    const totalScore = Math.min(100, correctScenes * scorePerScene);
    window.ScormApi.setScore(totalScore, 0, 100);
    saveState();

    // Show next-scene CTA
    setTimeout(() => {
      const isLastScene = state.currentScreen >= CONTENT.screens.length - 1;
      const ctaZone = $ctaZone();
      ctaZone.classList.remove('empty');
      ctaZone.innerHTML = `
        <button class="cta-primary" id="cta-next" type="button">
          <span>${correct ? (isLastScene ? 'أكملت الرحلة ✓' : 'التالي') : 'حاول مرة أخرى'}</span>
          <span class="cta-arrow">←</span>
        </button>
        <div class="cta-hint">${correct ? (isLastScene ? 'تهانينا على إتمام الرحلة' : 'انتقل إلى المشهد التالي') : 'راجع الإجابة الصحيحة ثم تابع'}</div>
      `;
      setTimeout(() => {
        const btn = document.getElementById('cta-next');
        btn.classList.add('visible');
        const h = ctaZone.querySelector('.cta-hint');
        if (h) h.classList.add('visible');
        btn.addEventListener('click', () => {
          if (correct) {
            if (isLastScene) {
              showToast('تهانينا! أكملت الرحلة كاملة', 'success');
              window.ScormApi.setStatus('completed');
              window.ScormApi.setStatus('passed');
            } else {
              state.currentScreen++;
              saveState();
              renderScene(state.currentScreen);
            }
          } else {
            // Reset assessment IN PLACE (no full re-render) for robust recovery
            resetAssessmentInPlace(scene);
          }
        });
      }, 100);
    }, 2000);
  }

  // ---------- In-place assessment reset (no re-render) ----------
  // Used by all scenes when learner clicks "Try Again" after a wrong answer.
  // Resets the assessment UI without re-rendering the entire scene, which
  // avoids losing scroll position, exploration state, and animation lifecycle.
  function resetAssessmentInPlace(scene) {
    const ss = state.sceneState[state.currentScreen];
    // Reset state
    if (ss) {
      ss.answer = null;
      ss.answered = false;
    }
    // Also reset legacy boardroom state
    state.assessmentAnswer = null;
    state.assessmentAnswered = false;
    // Update score (this scene no longer correct)
    if (state.sceneScores) state.sceneScores[state.currentScreen] = 0;
    const scorePerScene = Math.round(100 / CONTENT.screens.length);
    const correctScenes = Object.values(state.sceneScores).filter(v => v === 1).length;
    const totalScore = Math.min(100, correctScenes * scorePerScene);
    window.ScormApi.setScore(totalScore, 0, 100);
    saveState();

    // Reset UI: unlock options, remove correct/incorrect styling
    const opts = document.querySelectorAll('#assessment-options .assessment-option');
    opts.forEach(o => {
      o.classList.remove('locked', 'correct', 'incorrect', 'selected');
    });
    // Clear feedback
    const fb = document.getElementById('assessment-feedback');
    if (fb) {
      fb.className = 'assessment-feedback';
      fb.innerHTML = '';
    }
    // Hide CTA
    const ctaZone = $ctaZone();
    ctaZone.innerHTML = '';
    ctaZone.classList.add('empty');
    // Ensure panel is visible
    const panel = document.getElementById('assessment-panel');
    if (panel) panel.classList.add('visible');
    // Re-enable assessment with fresh click handlers
    // Use boardroom-specific handler for scene 2, generic for others
    if (state.currentScreen === 1) {
      enableBoardroomAssessment(scene);
    } else {
      enableAssessment(scene, getCurrentSceneType());
    }
    // Scroll assessment into view
    if (panel) panel.scrollIntoView({ behavior: 'smooth', block: 'center' });
    showToast('حاول مرة أخرى', 'warning');
  }

  function getCurrentSceneType() {
    const scene = CONTENT.screens[state.currentScreen];
    return scene ? scene.id : 'unknown';
  }

  // ---------- Production Notes drawer ----------
  function toggleNotes() {
    const drawer = document.getElementById('notes-drawer');
    const backdrop = document.getElementById('notes-backdrop');
    if (drawer.classList.contains('visible')) {
      closeNotes();
    } else {
      openNotes();
    }
  }

  function openNotes() {
    const scene = CONTENT.screens[state.currentScreen];
    if (!scene) return;
    const spec = scene.spec;
    const body = document.getElementById('notes-body');

    let html = `
      <div class="notes-screen-title">${spec.screen_title}</div>
      <div class="notes-screen-meta">مشهد ${arabicNumeral(scene.scene_number)} من ${arabicNumeral(CONTENT.screens.length)} · ${scene.id}</div>
    `;

    const sections = [
      { label: '٠١ · العنوان', title: 'Screen Title', content: spec.screen_title },
      { label: '٠٢ · الهدف التعليمي', title: 'Learning Objective', content: spec.learning_objective },
      { label: '٠٣ · الغاية السردية', title: 'Narrative Purpose', content: spec.narrative_purpose },
      { label: '٠٤ · نص السرد', title: 'Narration Script (AR)', content: spec.narration_script_ar },
      { label: '٠٥ · الخط الزمني للحركة', title: 'Animation Timeline', content: Array.isArray(spec.animation_timeline)
        ? spec.animation_timeline.map(t => `<div class="timeline-entry"><span class="timeline-time">${t.time}</span><span>${t.action}</span></div>`).join('')
        : spec.animation_timeline },
      { label: '٠٦ · التوجيه البصري', title: 'Visual Direction', content: spec.visual_direction },
      { label: '٠٧ · نوع التفاعل', title: 'Recommended Interaction', content: spec.interaction_type },
      { label: '٠٨ · منطق التفاعل', title: 'Interaction Logic', content: spec.interaction_logic },
      { label: '٠٩ · بند التقييم', title: 'Assessment Item', content: `السؤال: ${spec.assessment_item.question}\nالإجابة الصحيحة: ${spec.assessment_item.correct_answer}` },
      { label: '١٠ · التغذية الصحيحة', title: 'Correct Feedback', content: spec.correct_feedback },
      { label: '١١ · التغذية الخاطئة', title: 'Incorrect Feedback', content: spec.incorrect_feedback },
      { label: '١٢ · ملاحظات التنفيذ', title: 'Implementation Notes', content: spec.implementation_notes },
      { label: '١٣ · توافق SCORM', title: 'SCORM Compatibility', content: spec.scorm_notes },
      { label: '١٤ · هيكل JSON', title: 'JSON Structure', content: `<code>${escapeHtml(spec.json_structure)}</code>` },
      { label: '١٥ · معمارية HTML/CSS/JS', title: 'Architecture Suggestions', content: spec.architecture_notes },
    ];

    sections.forEach(s => {
      html += `
        <div class="notes-section">
          <div class="notes-section-label">${s.label}</div>
          <div class="notes-section-title">${s.title}</div>
          <div class="notes-section-content">${s.content}</div>
        </div>
      `;
    });

    body.innerHTML = html;
    document.getElementById('notes-drawer').classList.add('visible');
    document.getElementById('notes-backdrop').classList.add('visible');
    document.getElementById('notes-drawer').setAttribute('aria-hidden', 'false');
  }

  function closeNotes() {
    document.getElementById('notes-drawer').classList.remove('visible');
    document.getElementById('notes-backdrop').classList.remove('visible');
    document.getElementById('notes-drawer').setAttribute('aria-hidden', 'true');
  }

  // ---------- Toast ----------
  let toastTimer = null;
  function showToast(msg, type) {
    const t = $toast();
    t.textContent = msg;
    t.className = 'toast show' + (type ? ' ' + type : '');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => t.classList.remove('show'), 2800);
  }

  // ---------- Utils ----------
  function arabicNumeral(n) {
    const map = {0:'٠',1:'١',2:'٢',3:'٣',4:'٤',5:'٥',6:'٦',7:'٧',8:'٨',9:'٩'};
    return String(n).split('').map(c => map[c] !== undefined ? map[c] : c).join('');
  }

  function escapeHtml(s) {
    return String(s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#039;');
  }

  // ---------- Boot ----------
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
