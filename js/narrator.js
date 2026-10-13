/**
 * Narrator Engine — manages timed narration with typewriter subtitles.
 *
 * API:
 *   Narrator.start(segments, opts)         // segments: [{time, text, seat?}]
 *   Narrator.skip()                        // jump to end (fires onComplete)
 *   Narrator.stop()                        // abandon silently (scene change)
 *   Narrator.replay()                      // restart from beginning
 *   Narrator.togglePause()                 // pause / resume
 *   opts.onSegment(seg, idx)               // each segment shows (seat glow, …)
 *   opts.onComplete()                      // narration finished or skipped
 *
 * Timing: each segment's `time` is the EARLIEST moment it may start. The
 * next segment also waits for the current sentence to finish speaking (up
 * to MAX_SPEECH_WAIT_MS), so a slow voice or a 0.75× rate never gets cut
 * off mid-sentence by the next segment. Without audio (subtitles only) the
 * script timings are used as written.
 *
 * Pause/resume: pausing stops the audio and freezes the schedule. Resuming
 * replays the current sentence from its start (audio and subtitle), since
 * Web Speech cannot resume mid-utterance reliably.
 */
(function (global) {
  'use strict';

  const MAX_SPEECH_WAIT_MS = 15000;
  const SPEECH_POLL_MS = 250;
  const MIN_GAP_MS = 800;

  const Narrator = {
    segments: [],
    timeouts: [],
    currentIndex: -1,
    isPlaying: false,
    isPaused: false,
    isComplete: false,
    totalSeconds: 0,
    pending: null,       // { fn, due } — the next scheduled step
    pausedRemaining: 0,  // ms left on `pending` when paused
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
    Narrator.pending = null;
  }

  function track(fn, ms) {
    const t = setTimeout(fn, Math.max(0, ms));
    Narrator.timeouts.push(t);
    return t;
  }

  // The single "what happens next" timer of the narration schedule.
  function schedule(fn, ms) {
    Narrator.pending = { fn, due: Date.now() + Math.max(0, ms) };
    track(() => {
      Narrator.pending = null;
      if (Narrator.skipRequested || Narrator.isPaused) return;
      fn();
    }, ms);
  }

  function isSpeaking() {
    if (global.NarrationManager) return NarrationManager.isSpeaking();
    if (global.TTS) return TTS.isSpeaking();
    return false;
  }

  function speak(text, idx) {
    if (global.NarrationManager) NarrationManager.speak(text, idx);
  }

  function stopAudio() {
    if (global.NarrationManager) NarrationManager.cancel();
    else if (global.TTS) TTS.cancel();
  }

  function setControls(playing) {
    if ($replay()) $replay().disabled = playing;
    if ($pause()) {
      $pause().disabled = !playing;
      $pause().textContent = '⏸';
      $pause().setAttribute('aria-label', 'إيقاف مؤقت');
    }
    if ($skip()) $skip().disabled = !playing;
  }

  function start(segments, opts = {}) {
    clearAllTimeouts();
    Narrator.segments = Array.isArray(segments) ? segments : [];
    Narrator.onSegmentCb = opts.onSegment || null;
    Narrator.onCompleteCb = opts.onComplete || null;
    Narrator.currentIndex = -1;
    Narrator.isPlaying = true;
    Narrator.isPaused = false;
    Narrator.isComplete = false;
    Narrator.skipRequested = false;

    const segs = Narrator.segments;
    if (!segs.length) { complete(); return; }
    const last = segs[segs.length - 1];
    Narrator.totalSeconds = opts.totalSeconds || last.time + 3;

    showNarrator();
    const bar = $subtitleBar();
    if (bar) { bar.classList.add('visible'); bar.classList.remove('controls-visible'); }
    setControls(true);

    schedule(() => step(0), segs[0].time * 1000);
  }

  function step(i) {
    const segs = Narrator.segments;
    const seg = segs[i];
    Narrator.currentIndex = i;
    showSegment(seg, i);
    if (Narrator.onSegmentCb) Narrator.onSegmentCb(seg, i);

    const nextAt = i + 1 < segs.length ? segs[i + 1].time : Narrator.totalSeconds;
    const gapMs = Math.max(MIN_GAP_MS, (nextAt - seg.time) * 1000);
    schedule(() => afterSpeech(() => {
      if (i + 1 < segs.length) step(i + 1);
      else complete();
    }), gapMs);
  }

  // Runs `next` once the current sentence has finished speaking (or right
  // away when nothing is speaking, e.g. subtitles-only mode).
  function afterSpeech(next) {
    const startedWaiting = Date.now();
    const poll = () => {
      if (!isSpeaking() || Date.now() - startedWaiting > MAX_SPEECH_WAIT_MS) next();
      else schedule(poll, SPEECH_POLL_MS);
    };
    poll();
  }

  function complete() {
    Narrator.isPlaying = false;
    Narrator.isPaused = false;
    Narrator.isComplete = true;
    clearAllTimeouts();
    stopSpeaking();
    setControls(false);
    const bar = $subtitleBar();
    if (bar) bar.classList.add('controls-visible');
    if (Narrator.onCompleteCb) Narrator.onCompleteCb();
  }

  function showSegment(seg, idx) {
    const $sub = $subtitle();
    if (!$sub) return;
    startSpeaking();

    // Narrate this segment via NarrationManager (provider-agnostic). The
    // segment index is the segmentId for the audio manifest lookup.
    // Subtitles ALWAYS render below regardless of whether audio plays.
    speak(seg.text, idx);

    const text = seg.text;
    if (Narrator.reducedMotion) {
      $sub.textContent = text;
      $sub.classList.add('done');
      return;
    }

    // Typewriter effect: ~30ms per character, faster for long lines.
    $sub.classList.remove('done');
    $sub.innerHTML = '<span class="cursor"></span>';
    let charIdx = 0;
    const speed = Math.max(20, Math.min(45, 1800 / text.length));

    function typeNext() {
      if (Narrator.skipRequested) {
        $sub.textContent = text;
        $sub.classList.add('done');
        return;
      }
      if (charIdx >= text.length) {
        $sub.innerHTML = escapeHtml(text) + '<span class="cursor"></span>';
        track(() => $sub.classList.add('done'), 600);
        return;
      }
      charIdx++;
      $sub.innerHTML = escapeHtml(text.substring(0, charIdx)) + '<span class="cursor"></span>';
      track(typeNext, speed);
    }
    typeNext();
  }

  function skip() {
    if (!Narrator.isPlaying) return;
    Narrator.skipRequested = true;
    clearAllTimeouts();
    stopAudio();

    // Show the final segment immediately
    if (Narrator.segments.length > 0) {
      const last = Narrator.segments[Narrator.segments.length - 1];
      const $sub = $subtitle();
      if ($sub) {
        $sub.textContent = last.text;
        $sub.classList.add('done');
      }
    }
    complete();
  }

  // Silently abandons the current narration (scene change, error screen):
  // no onComplete callback, no stale subtitle written afterwards.
  function stop() {
    Narrator.skipRequested = true;
    Narrator.isPlaying = false;
    Narrator.isPaused = false;
    clearAllTimeouts();
    stopAudio();
  }

  function replay() {
    if (!Narrator.segments.length) return;
    start(Narrator.segments, {
      onSegment: Narrator.onSegmentCb,
      onComplete: Narrator.onCompleteCb,
      totalSeconds: Narrator.totalSeconds,
    });
  }

  function togglePause() {
    if (!Narrator.isPlaying) return;

    if (!Narrator.isPaused) {
      // --- PAUSE ---
      Narrator.isPaused = true;
      const pending = Narrator.pending;
      Narrator.pausedRemaining = pending ? Math.max(0, pending.due - Date.now()) : 0;
      const pendingFn = pending ? pending.fn : null;
      clearAllTimeouts();
      Narrator.pausedFn = pendingFn;
      stopAudio();
      stopSpeaking();
      if ($pause()) { $pause().textContent = '▶'; $pause().setAttribute('aria-label', 'استئناف'); }
    } else {
      // --- RESUME ---
      Narrator.isPaused = false;
      if ($pause()) { $pause().textContent = '⏸'; $pause().setAttribute('aria-label', 'إيقاف مؤقت'); }
      if (Narrator.currentIndex >= 0) {
        // Replay the current sentence from its start, then carry on.
        step(Narrator.currentIndex);
      } else if (Narrator.pausedFn) {
        // Paused before the first sentence: wait out the remaining delay.
        schedule(Narrator.pausedFn, Narrator.pausedRemaining);
      }
      Narrator.pausedFn = null;
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
  Narrator.stop = stop;
  Narrator.replay = replay;
  Narrator.togglePause = togglePause;
  Narrator.showNarrator = showNarrator;
  Narrator.hideNarrator = hideNarrator;
  Narrator.startSpeaking = startSpeaking;
  Narrator.stopSpeaking = stopSpeaking;

  global.Narrator = Narrator;
})(window);
