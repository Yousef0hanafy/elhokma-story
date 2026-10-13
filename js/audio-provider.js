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
 * Memory: each speak() creates a new Audio element. On end/error, the
 * element is removed and dereferenced. cancel() stops and cleans up the
 * current element. No leaks across scene transitions.
 */
(function (global) {
  'use strict';

  const AudioProvider = {
    currentAudio: null,
    muted: false,
    rate: 1.0,
    stateListeners: [],
  };

  function init() {
    // Clean up any audio on page unload
    global.addEventListener('beforeunload', () => {
      try { if (AudioProvider.currentAudio) { AudioProvider.currentAudio.pause(); AudioProvider.currentAudio = null; } } catch (e) {}
    });
  }

  function isAvailable() {
    // Available if the browser supports HTMLAudioElement (virtually all do)
    return typeof Audio !== 'undefined' || typeof HTMLAudioElement !== 'undefined';
  }

  function speak(text, audioUrl, onFail) {
    if (!audioUrl) return false;
    // Cancel any in-flight audio first
    cancel();

    try {
      const audio = new Audio();
      audio.src = audioUrl;
      audio.playbackRate = AudioProvider.rate;
      audio.muted = AudioProvider.muted;
      audio.preload = 'auto';

      AudioProvider.currentAudio = audio;

      audio.onplay = () => notifyStateChange();
      audio.onended = () => {
        cleanup();
        notifyStateChange();
      };
      const fail = (why) => {
        if (AudioProvider.currentAudio !== audio) return; // already cancelled
        console.warn('[AudioProvider] ' + why + ':', audioUrl);
        cleanup();
        if (typeof onFail === 'function') onFail();
      };
      audio.onerror = () => fail('audio error');

      // Play returns a promise; if it rejects (autoplay policy), fall back
      const playPromise = audio.play();
      if (playPromise && typeof playPromise.catch === 'function') {
        playPromise.catch(() => fail('play() rejected'));
      }

      return true;
    } catch (e) {
      console.warn('[AudioProvider] speak failed:', e);
      cleanup();
      return false;
    }
  }

  function cancel() {
    if (AudioProvider.currentAudio) {
      try {
        AudioProvider.currentAudio.pause();
        AudioProvider.currentAudio.currentTime = 0;
      } catch (e) {}
      cleanup();
    }
  }

  function cleanup() {
    if (AudioProvider.currentAudio) {
      AudioProvider.currentAudio.onplay = null;
      AudioProvider.currentAudio.onended = null;
      AudioProvider.currentAudio.onerror = null;
      AudioProvider.currentAudio.src = '';
      AudioProvider.currentAudio = null;
    }
    notifyStateChange();
  }

  function setMuted(m) {
    AudioProvider.muted = !!m;
    if (AudioProvider.currentAudio) AudioProvider.currentAudio.muted = AudioProvider.muted;
  }

  function setRate(r) {
    AudioProvider.rate = r;
    if (AudioProvider.currentAudio) AudioProvider.currentAudio.playbackRate = r;
  }

  function isSpeaking() {
    return AudioProvider.currentAudio !== null && !AudioProvider.currentAudio.paused;
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
  AudioProvider.cancel = cancel;
  AudioProvider.setMuted = setMuted;
  AudioProvider.setRate = setRate;
  AudioProvider.isSpeaking = isSpeaking;
  AudioProvider.getName = getName;
  AudioProvider.onStateChange = onStateChange;

  global.AudioProvider = AudioProvider;
})(window);
