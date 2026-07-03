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
    isComplete: false,
    startTimestamp: 0,
    onSegmentCb: null,
    onCompleteCb: null,
    skipRequested: false,
    reducedMotion: false,
  };

  const $subtitle = () => document.getElementById('subtitle-text');
  const $subtitleBar = () => document.getElementById('subtitle-bar');
  const $narratorOverlay = () => document.getElementById('narrator-overlay');
  const $replay = () => document.getElementById('replay-btn');
  const $skip = () => document.getElementById('skip-btn');

  function init() {
    Narrator.reducedMotion = global.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if ($replay()) $replay().addEventListener('click', () => Narrator.replay());
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

    // Disable skip/replay appropriately
    if ($replay()) $replay().disabled = true;
    if ($skip()) $skip().disabled = false;

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
    Narrator.isComplete = true;
    clearAllTimeouts();

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
  Narrator.showNarrator = showNarrator;
  Narrator.hideNarrator = hideNarrator;
  Narrator.startSpeaking = startSpeaking;
  Narrator.stopSpeaking = stopSpeaking;

  global.Narrator = Narrator;
})(window);
