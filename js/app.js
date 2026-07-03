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
    window.ScormApi.init();
    loadState();
    Narrator.init();
    Animator.init();
    buildNarratorAvatar();
    bindGlobalEvents();

    // Hide loader after 1.2s (let fonts load)
    setTimeout(() => {
      $loader().classList.add('hidden');
      // Mark lesson in-progress
      if (window.ScormApi.getStatus() === 'not attempted') {
        window.ScormApi.setStatus('incomplete');
      }
      // Start first scene
      renderScene(state.currentScreen);
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
    } catch (e) { console.warn('loadState failed', e); }
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
    // Production notes toggle
    const notesToggle = document.getElementById('notes-toggle');
    const notesDrawer = document.getElementById('notes-drawer');
    const notesBackdrop = document.getElementById('notes-backdrop');
    const notesClose = document.getElementById('notes-close');
    notesToggle.addEventListener('click', toggleNotes);
    notesClose.addEventListener('click', closeNotes);
    notesBackdrop.addEventListener('click', closeNotes);
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && notesDrawer.classList.contains('visible')) closeNotes();
    });
  }

  // ---------- Narrator avatar (inline SVG) ----------
  function buildNarratorAvatar() {
    // Stylized portrait of Dr. Sarah — flat illustration
    const svg = `
<svg viewBox="0 0 140 140" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="#1B3B5F"/>
      <stop offset="100%" stop-color="#122E4A"/>
    </linearGradient>
    <linearGradient id="hijab" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="#1B3B5F"/>
      <stop offset="100%" stop-color="#0B1F33"/>
    </linearGradient>
    <linearGradient id="coat" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="#FFFFFF"/>
      <stop offset="100%" stop-color="#F4ECD8"/>
    </linearGradient>
  </defs>
  <!-- Background -->
  <rect width="140" height="140" fill="url(#bg)"/>
  <!-- Soft glow behind head -->
  <circle cx="70" cy="60" r="42" fill="#D4AF37" opacity="0.08"/>
  <!-- Shoulders / coat -->
  <path d="M 28 140 Q 28 100 50 92 L 90 92 Q 112 100 112 140 Z" fill="url(#coat)"/>
  <!-- Coat collar -->
  <path d="M 50 92 L 70 110 L 90 92 L 90 100 L 70 120 L 50 100 Z" fill="#D4AF37" opacity="0.4"/>
  <!-- Hijab back -->
  <path d="M 30 70 Q 30 35 70 30 Q 110 35 110 70 L 110 95 Q 90 88 70 88 Q 50 88 30 95 Z" fill="url(#hijab)"/>
  <!-- Face -->
  <ellipse cx="70" cy="62" rx="22" ry="26" fill="#E8C5A0"/>
  <!-- Face shadow (hijab edge) -->
  <path d="M 48 60 Q 50 45 70 42 Q 90 45 92 60 L 92 72 Q 90 88 70 90 Q 50 88 48 72 Z" fill="#D9B48A" opacity="0.3"/>
  <!-- Eyebrows -->
  <path d="M 58 55 Q 62 53 66 55" stroke="#5C3A1E" stroke-width="1.5" fill="none" stroke-linecap="round"/>
  <path d="M 74 55 Q 78 53 82 55" stroke="#5C3A1E" stroke-width="1.5" fill="none" stroke-linecap="round"/>
  <!-- Eyes -->
  <ellipse cx="62" cy="60" rx="1.8" ry="2.2" fill="#3A2410"/>
  <ellipse cx="78" cy="60" rx="1.8" ry="2.2" fill="#3A2410"/>
  <!-- Nose -->
  <path d="M 70 64 L 68 72 L 72 72 Z" fill="#C99770" opacity="0.5"/>
  <!-- Mouth (subtle smile) -->
  <path d="M 64 78 Q 70 81 76 78" stroke="#A0524A" stroke-width="1.8" fill="none" stroke-linecap="round"/>
  <!-- Hijab front edge -->
  <path d="M 48 70 Q 50 45 70 42 Q 90 45 92 70" stroke="#0B1F33" stroke-width="1" fill="none"/>
  <!-- Earring hint -->
  <circle cx="49" cy="72" r="1.5" fill="#D4AF37"/>
  <circle cx="91" cy="72" r="1.5" fill="#D4AF37"/>
</svg>`;
    $narratorAvatar().innerHTML = svg;
  }

  // ---------- Scene renderer (dispatch) ----------
  function renderScene(idx) {
    const scene = CONTENT.screens[idx];
    if (!scene) return;
    state.currentScreen = idx;

    // Update topbar
    $topbar().classList.add('visible');
    $sceneCounter().textContent = `المشهد ${arabicNumeral(idx + 1)} / ${arabicNumeral(CONTENT.screens.length)}`;

    // Fade out current content
    const stage = $stage();
    Animator.fadeOut(stage, 0.4, () => {
      stage.innerHTML = '';
      $ctaZone().innerHTML = '';
      $ctaZone().classList.add('empty');
      Narrator.hideNarrator();
      document.getElementById('subtitle-bar').classList.remove('visible', 'controls-visible');
      document.body.classList.remove('cinematic');

      // Render scene-specific content
      if (scene.id === 'opening') renderOpening(scene);
      else if (scene.id === 'boardroom') renderBoardroom(scene);
      else if (scene.id === 'framework') renderFramework(scene);
      else if (scene.id === 'pillars') renderPillars(scene);
      else if (scene.id === 'court') renderCourt(scene);
      else if (scene.id === 'integrity') renderIntegrity(scene);
      else if (scene.id === 'dilemma') renderDilemma(scene);
      else renderComingSoon(scene);

      saveState();
    });
  }

  // Fallback for scenes whose renderer isn't implemented yet
  function renderComingSoon(scene) {
    const stage = $stage();
    stage.style.opacity = '1';
    stage.innerHTML = `
      <div class="scene-cover">
        <div class="scene-eyebrow anim-fade-up" style="opacity:1">${scene.eyebrow || ''}</div>
        <h1 class="scene-title anim-fade-up" style="opacity:1; animation-delay:0.2s">${scene.title || ''}</h1>
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
        <div class="scene-eyebrow" id="eyebrow">${scene.eyebrow}</div>
        <h1 class="scene-title" id="hero-title">
          رحلة <span class="accent">${scene.hero_title_accent}</span>
        </h1>
        <div class="scene-subtitle" id="hero-subtitle">${scene.subtitle}</div>
        <div class="scene-story" id="hero-story">${scene.story_hook}</div>
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
          titleEl.innerHTML = `رحلة <span class="accent">${scene.hero_title_accent}</span>`;
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
          <div class="boardroom-eyebrow">${scene.eyebrow}</div>
          <h2 class="boardroom-title">${scene.hero_title}</h2>
          <p class="boardroom-instruction" id="br-instruction">${scene.instruction}</p>
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
          <div class="assessment-question">${scene.assessment.question}</div>
          <div class="assessment-options" id="assessment-options">
            ${scene.assessment.options.map((opt, i) => `
              <button class="assessment-option" data-idx="${i}" type="button">
                <span class="option-letter">${['أ','ب','ج','د'][i]}</span>
                <span class="option-text">${opt}</span>
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
    // Build modal
    const modal = document.createElement('div');
    modal.className = 'seat-modal';
    modal.innerHTML = `
      <div class="seat-modal-card">
        <div class="seat-modal-num">${arabicNumeral(seat.n)}</div>
        <div class="seat-modal-eyebrow">المقعد ${arabicNumeral(seat.n)} من ٦</div>
        <h3 class="seat-modal-title">${seat.label}</h3>
        <div class="seat-modal-story">${seat.story}</div>
        <div class="seat-modal-def-label">التعريف الرسمي</div>
        <div class="seat-modal-def">${seat.definition}</div>
        <button class="seat-modal-close" type="button">فهمت</button>
      </div>
    `;
    document.body.appendChild(modal);
    requestAnimationFrame(() => modal.classList.add('visible'));

    const close = () => {
      modal.classList.remove('visible');
      setTimeout(() => modal.remove(), 300);
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
            enableAssessment(scene);
            panel.scrollIntoView({ behavior: 'smooth', block: 'center' });
            showToast('أحسنت! اختبر فهمك الآن', 'success');
          }, 400);
        }
      }
    };

    modal.querySelector('.seat-modal-close').addEventListener('click', close);
    modal.addEventListener('click', (e) => { if (e.target === modal) close(); });
    document.addEventListener('keydown', function escHandler(e) {
      if (e.key === 'Escape') { close(); document.removeEventListener('keydown', escHandler); }
    });
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

  function enableAssessment(scene) {
    const opts = document.querySelectorAll('#assessment-options .assessment-option');
    opts.forEach(opt => {
      opt.addEventListener('click', () => {
        if (state.assessmentAnswered) return;
        const idx = parseInt(opt.dataset.idx, 10);
        handleAssessmentAnswer(idx, scene);
      });
    });
  }

  function handleAssessmentAnswer(idx, scene) {
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
      ${correct ? scene.assessment.correct_feedback : scene.assessment.incorrect_feedback}
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
            // Reset assessment for retry
            state.assessmentAnswer = null;
            state.assessmentAnswered = false;
            saveState();
            // Re-render scene
            renderScene(state.currentScreen);
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
      ${correct ? scene.assessment.correct_feedback : scene.assessment.incorrect_feedback}
    `;
    document.getElementById('assessment-panel').classList.add('visible');
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
