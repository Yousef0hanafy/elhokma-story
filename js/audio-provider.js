/**
 * AudioProvider — professional recorded narration (MP3/AAC).
 *
 * Priority: 1 (highest). Used when audio files exist for the current
 * scene+segment in the narration manifest.
 *
 * How it works:
 *   - speak(text, audioUrl) creates an <audio> element, loads the URL,
 *     and plays it.
 *   - On error (404, codec issue, network failure, autoplay rejection) the
 *     provider calls the onFail callback NarrationManager passed in, which
 *     falls back to TTS for the same segment.
 *   - On end, the provider cleans up the audio element to prevent leaks.
 *   - Playback rate is applied via HTMLMediaElement.playbackRate.
 *   - Muting is via HTMLMediaElement.muted.
 *
 * To add professional narration: place MP3 files in /audio/<sceneId>/seg-<n>.mp3
 * and add an audio manifest to content.js (see CONTENT.audio.narration).
 * The provider handles the rest — no code changes needed.
 *
 * Phones: ONE <audio> element is reused for every segment. iOS only lets
 * an element play from code after it has played once inside a tap, so
 * unlock() (called from the "activate audio" tap) plays a short silent clip
 * on it; every later segment then plays on the same, already-unlocked
 * element. Android Chrome allows play() after any tap on the page.
 */
(function (global) {
  'use strict';

  const SILENCE_URL = 'audio/silence.mp3';

  const AudioProvider = {
    el: null,            // the single reusable <audio> element
    currentAudio: null,  // === el while a segment is loaded, else null
    token: null,         // identifies the segment in flight
    muted: false,
    rate: 1.0,
    stateListeners: [],
  };

  function element() {
    if (!AudioProvider.el) {
      const a = new Audio();
      a.preload = 'auto';
      a.setAttribute('playsinline', '');
      AudioProvider.el = a;
    }
    return AudioProvider.el;
  }

  function init() {
    // Stop audio on page unload
    global.addEventListener('beforeunload', () => {
      try { if (AudioProvider.el) AudioProvider.el.pause(); } catch (e) {}
    });
  }

  function isAvailable() {
    return typeof Audio !== 'undefined' || typeof HTMLAudioElement !== 'undefined';
  }

  // Must run inside the learner's tap (see header). Harmless elsewhere.
  function unlock() {
    if (AudioProvider.currentAudio) return; // already playing a segment in this tap
    try {
      const a = element();
      a.src = SILENCE_URL;
      a.muted = true;
      const p = a.play();
      const done = () => { if (!AudioProvider.currentAudio) { try { a.pause(); } catch (e) {} } a.muted = AudioProvider.muted; };
      if (p && typeof p.then === 'function') p.then(done, done); else done();
    } catch (e) { /* best-effort */ }
  }

  function speak(text, audioUrl, onFail) {
    if (!audioUrl) return false;
    cancel();

    const a = element();
    const token = {};
    AudioProvider.token = token;
    AudioProvider.currentAudio = a;

    const finish = () => {
      if (AudioProvider.token !== token) return;
      AudioProvider.token = null;
      AudioProvider.currentAudio = null;
      notifyStateChange();
    };
    const fail = (why) => {
      if (AudioProvider.token !== token) return; // cancelled or superseded
      console.warn('[AudioProvider] ' + why + ':', audioUrl);
      finish();
      if (typeof onFail === 'function') onFail();
    };

    a.onplay = () => notifyStateChange();
    a.onended = finish;
    a.onerror = () => fail('audio error');
    try {
      a.muted = AudioProvider.muted;
      a.src = audioUrl;
      a.playbackRate = AudioProvider.rate;
      // Keep the voice's pitch at other speeds (default in most browsers).
      if ('preservesPitch' in a) a.preservesPitch = true;
      const p = a.play();
      if (p && typeof p.catch === 'function') {
        p.catch(err => {
          // A play() interrupted by our own cancel()/next segment is normal.
          if (err && err.name === 'AbortError') return;
          fail('play() rejected (' + (err && err.name) + ')');
        });
      }
      notifyStateChange();
      return true;
    } catch (e) {
      console.warn('[AudioProvider] speak failed:', e);
      finish();
      return false;
    }
  }

  function cancel() {
    const a = AudioProvider.el;
    const wasActive = !!AudioProvider.currentAudio;
    AudioProvider.token = null;
    AudioProvider.currentAudio = null;
    if (a && wasActive) {
      try { a.pause(); } catch (e) {}
    }
    if (wasActive) notifyStateChange();
  }

  function setMuted(m) {
    AudioProvider.muted = !!m;
    if (AudioProvider.el) AudioProvider.el.muted = AudioProvider.muted;
  }

  function setRate(r) {
    AudioProvider.rate = r;
    if (AudioProvider.el) AudioProvider.el.playbackRate = r;
  }

  function isSpeaking() {
    return AudioProvider.currentAudio !== null && !AudioProvider.currentAudio.ended;
  }

  function getName() { return 'audio'; }

  function onStateChange(cb) {
    AudioProvider.stateListeners.push(cb);
  }

  function notifyStateChange() {
    AudioProvider.stateListeners.forEach(cb => { try { cb(); } catch (e) {} });
  }

  AudioProvider.init = init;
  AudioProvider.isAvailable = isAvailable;
  AudioProvider.speak = speak;
  AudioProvider.unlock = unlock;
  AudioProvider.cancel = cancel;
  AudioProvider.setMuted = setMuted;
  AudioProvider.setRate = setRate;
  AudioProvider.isSpeaking = isSpeaking;
  AudioProvider.getName = getName;
  AudioProvider.onStateChange = onStateChange;

  global.AudioProvider = AudioProvider;
})(window);
