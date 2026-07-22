/**
 * Narrator Engine — manages timed narration with typewriter subtitles.
 *
 * API:
 *   Narrator.start(segments, opts)         // segments: [{time, text, seat?}]
 *   Narrator.skip()                        // jump to end
 *   Narrator.replay()                      // restart from beginning
 *   Narrator.onComplete(cb)                // callback when narration finishes
 *   Narrator.onSegment(cb)                 // callback when each segment shows (used for seat glow)
 */
(function (global) {
  'use strict';

  const Narrator = {
    segments: [],
    timeouts: [],
    currentIndex: -1,
    isPlaying: false,
    isPaused: false,
    isComplete: false,
    startTimestamp: 0,
    pauseTimestamp: 0,
    pausedRemaining: [], // {fn, delay} — pending timeouts saved on pause
    onSegmentCb: null,
    onCompleteCb: null,
    skipRequested: false,
    reducedMotion: false,
  };

  const $subtitle = () => document.getElementById('subtitle-text');
  const $subtitleBar = () => document.getElementById('subtitle-bar');
  const $narratorOverlay = () => document.getElementById('narrator-overlay');
  const $replay = () => document.getElementById('replay-btn');
  const $pause = () => document.getElementById('pause-btn');
  const $skip = () => document.getElementById('skip-btn');

  function init() {
    Narrator.reducedMotion = global.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if ($replay()) $replay().addEventListener('click', () => Narrator.replay());
    if ($pause()) $pause().addEventListener('click', () => Narrator.togglePause());
    if ($skip()) $skip().addEventListener('click', () => Narrator.skip());
  }

  function clearAllTimeouts() {
    Narrator.timeouts.forEach(t => clearTimeout(t));
    Narrator.timeouts = [];
  }

  function start(segments, opts = {}) {
    Narrator.segments = segments;
    Narrator.onSegmentCb = opts.onSegment || null;
    Narrator.onCompleteCb = opts.onComplete || null;
    Narrator.currentIndex = -1;
    Narrator.isPlaying = true;
    Narrator.isComplete = false;
    Narrator.skipRequested = false;
    Narrator.startTimestamp = Date.now();

    clearAllTimeouts();

    // Show narrator overlay (handled by app.js for positioning)
    showNarrator();

    // Show subtitle bar
    $subtitleBar().classList.add('visible');

    // Disable skip/replay appropriately; enable pause
    if ($replay()) $replay().disabled = true;
    if ($pause()) { $pause().disabled = false; $pause().textContent = '⏸'; $pause().setAttribute('aria-label', 'إيقاف مؤقت'); }
    if ($skip()) $skip().disabled = false;
    Narrator.isPaused = false;

    // Schedule each segment
    segments.forEach((seg, i) => {
      const delayMs = Math.max(0, seg.time * 1000);
      const t = setTimeout(() => {
        if (Narrator.skipRequested) return;
        Narrator.currentIndex = i;
        showSegment(seg, i);
        if (Narrator.onSegmentCb) Narrator.onSegmentCb(seg, i);
      }, delayMs);
      Narrator.timeouts.push(t);
    });

    // Schedule completion
    const totalMs = (opts.totalSeconds || segments[segments.length - 1].time + 3) * 1000;
    const tEnd = setTimeout(() => {
      if (Narrator.skipRequested) return;
      Narrator.isPlaying = false;
      Narrator.isComplete = true;
      stopSpeaking();
      if ($replay()) $replay().disabled = false;
      if ($pause()) $pause().disabled = true;
      if ($skip()) $skip().disabled = true;
      $subtitleBar().classList.add('controls-visible');
      if (Narrator.onCompleteCb) Narrator.onCompleteCb();
    }, totalMs);
    Narrator.timeouts.push(tEnd);
  }

  function showSegment(seg, idx) {
    const $sub = $subtitle();
    if (!$sub) return;
    startSpeaking();

    // Narrate this segment via NarrationManager (provider-agnostic).
    // The segment index is passed as the segmentId so the AudioProvider
    // can look up the correct audio file in the manifest.
    // Subtitles ALWAYS render below regardless of whether audio plays.
    if (global.NarrationManager) {
      NarrationManager.speak(seg.text, idx);
    }

    if (Narrator.reducedMotion) {
      // Show full text immediately
      $sub.innerHTML = escapeHtml(seg.text);
      $sub.classList.add('done');
      return;
    }

    // Typewriter effect
    $sub.classList.remove('done');
    $sub.innerHTML = '<span class="cursor"></span>';
    const text = seg.text;
    const cursor = $sub.querySelector('.cursor');
    let charIdx = 0;
    // Speed: ~30ms per char for subtitles (faster than cover title)
    const speed = Math.max(20, Math.min(45, 1800 / text.length));

    function typeNext() {
      if (Narrator.skipRequested) {
        $sub.innerHTML = escapeHtml(text);
        $sub.classList.add('done');
        return;
      }
      if (charIdx >= text.length) {
        $sub.innerHTML = escapeHtml(text) + '<span class="cursor"></span>';
        // After 800ms, hide cursor (segment complete)
        const tHide = setTimeout(() => {
          $sub.classList.add('done');
        }, 600);
        Narrator.timeouts.push(tHide);
        return;
      }
      charIdx++;
      $sub.innerHTML = escapeHtml(text.substring(0, charIdx)) + '<span class="cursor"></span>';
      const tNext = setTimeout(typeNext, speed);
      Narrator.timeouts.push(tNext);
    }
    typeNext();
  }

  function skip() {
    if (!Narrator.isPlaying) return;
    Narrator.skipRequested = true;
    Narrator.isPlaying = false;
    Narrator.isPaused = false;
    Narrator.isComplete = true;
    clearAllTimeouts();
    Narrator.pausedRemaining = [];
    // Cancel any in-flight narration (provider-agnostic)
    if (global.NarrationManager) NarrationManager.cancel();
    else if (global.TTS) TTS.cancel();

    // Show final segment immediately
    if (Narrator.segments.length > 0) {
      const last = Narrator.segments[Narrator.segments.length - 1];
      const $sub = $subtitle();
      if ($sub) {
        $sub.innerHTML = escapeHtml(last.text);
        $sub.classList.add('done');
      }
    }
    stopSpeaking();
    if ($replay()) $replay().disabled = false;
    if ($pause()) { $pause().disabled = true; $pause().textContent = '⏸'; }
    if ($skip()) $skip().disabled = true;
    $subtitleBar().classList.add('controls-visible');
    if (Narrator.onCompleteCb) Narrator.onCompleteCb();
  }

  function replay() {
    if (!Narrator.segments.length) return;
    if ($skip()) $skip().disabled = false;
    $subtitleBar().classList.remove('controls-visible');
    start(Narrator.segments, {
      onSegment: Narrator.onSegmentCb,
      onComplete: Narrator.onCompleteCb,
      totalSeconds: Narrator.segments[Narrator.segments.length - 1].time + 3,
    });
  }

  // Pause/resume narration. When paused:
  //   - All pending timeouts are cleared but their remaining delays are saved
  //   - The typewriter effect freezes (its timeouts are in Narrator.timeouts)
  //   - Audio narration is cancelled (we can't pause Web Speech API reliably)
  //   - The narrator wave animation stops
  // On resume:
  //   - Saved timeouts are re-scheduled with their remaining delays
  //   - Audio narration restarts for the current segment
  // This gives learners control over pacing without losing their place.
  function togglePause() {
    if (!Narrator.isPlaying) return;

    if (!Narrator.isPaused) {
      // --- PAUSE ---
      Narrator.isPaused = true;
      Narrator.pauseTimestamp = Date.now();

      // Save remaining delays for all pending timeouts, then clear them.
      // We can't read the remaining delay of a setTimeout directly, so we
      // calculate it from the segment timestamps vs. elapsed time.
      const elapsed = (Narrator.pauseTimestamp - Narrator.startTimestamp) / 1000;
      Narrator.pausedRemaining = [];
      Narrator.segments.forEach((seg, i) => {
        if (seg.time > elapsed && i > Narrator.currentIndex) {
          Narrator.pausedRemaining.push({
            segIdx: i,
            delayMs: Math.max(0, (seg.time - elapsed) * 1000),
          });
        }
      });
      // Also save the completion timeout
      const totalSec = Narrator.segments[Narrator.segments.length - 1].time + 3;
      if (totalSec > elapsed) {
        Narrator.pausedRemaining.push({
          segIdx: -1, // sentinel for completion
          delayMs: Math.max(0, (totalSec - elapsed) * 1000),
        });
      }
      clearAllTimeouts();

      // Cancel audio (Web Speech API doesn't pause reliably)
      if (global.NarrationManager) NarrationManager.cancel();
      else if (global.TTS) TTS.cancel();

      // Update UI
      stopSpeaking();
      if ($pause()) { $pause().textContent = '▶'; $pause().setAttribute('aria-label', 'استئناف'); }
    } else {
      // --- RESUME ---
      Narrator.isPaused = false;
      Narrator.startTimestamp = Date.now() - (Narrator.pauseTimestamp - Narrator.startTimestamp);

      // Re-schedule saved timeouts
      Narrator.pausedRemaining.forEach(item => {
        const t = setTimeout(() => {
          if (Narrator.skipRequested) return;
          if (item.segIdx === -1) {
            // Completion
            Narrator.isPlaying = false;
            Narrator.isComplete = true;
            stopSpeaking();
            if ($replay()) $replay().disabled = false;
            if ($pause()) $pause().disabled = true;
            if ($skip()) $skip().disabled = true;
            $subtitleBar().classList.add('controls-visible');
            if (Narrator.onCompleteCb) Narrator.onCompleteCb();
          } else {
            const seg = Narrator.segments[item.segIdx];
            Narrator.currentIndex = item.segIdx;
            showSegment(seg, item.segIdx);
            if (Narrator.onSegmentCb) Narrator.onSegmentCb(seg, item.segIdx);
          }
        }, item.delayMs);
        Narrator.timeouts.push(t);
      });
      Narrator.pausedRemaining = [];

      // Re-start audio for the current segment
      if (Narrator.currentIndex >= 0 && Narrator.segments[Narrator.currentIndex]) {
        const seg = Narrator.segments[Narrator.currentIndex];
        if (global.NarrationManager) NarrationManager.speak(seg.text, Narrator.currentIndex);
      }

      // Update UI
      startSpeaking();
      if ($pause()) { $pause().textContent = '⏸'; $pause().setAttribute('aria-label', 'إيقاف مؤقت'); }
    }
  }

  function showNarrator() {
    const $n = $narratorOverlay();
    if ($n) {
      $n.classList.add('visible');
      startSpeaking();
    }
  }

  function hideNarrator() {
    const $n = $narratorOverlay();
    if ($n) $n.classList.remove('visible', 'speaking');
  }

  function startSpeaking() {
    const $n = $narratorOverlay();
    if ($n) $n.classList.add('speaking');
  }

  function stopSpeaking() {
    const $n = $narratorOverlay();
    if ($n) $n.classList.remove('speaking');
  }

  function escapeHtml(s) {
    return String(s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#039;');
  }

  Narrator.init = init;
  Narrator.start = start;
  Narrator.skip = skip;
  Narrator.replay = replay;
  Narrator.togglePause = togglePause;
  Narrator.showNarrator = showNarrator;
  Narrator.hideNarrator = hideNarrator;
  Narrator.startSpeaking = startSpeaking;
  Narrator.stopSpeaking = stopSpeaking;

  global.Narrator = Narrator;
})(window);
