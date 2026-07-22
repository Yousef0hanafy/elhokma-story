/**
 * TTSProvider — browser Web Speech API Arabic TTS.
 *
 * Priority: 2. Used when AudioProvider is unavailable (no audio manifest
 * for this segment) or fails. Wraps the existing TTS module (tts.js)
 * so all Web Speech API logic stays in one place.
 *
 * This provider delegates to window.TTS — it does NOT re-implement voice
 * loading, activation, or error handling. It's a thin adapter that makes
 * TTS conform to the NarrationManager provider interface.
 *
 * If the browser has no Arabic voice, isAvailable() returns false and
 * NarrationManager falls back to subtitle-only mode.
 */
(function (global) {
  'use strict';

  const TTSProvider = {
    stateListeners: [],
  };

  function init() {
    // TTS module initializes itself; we just subscribe to its state changes
    // so NarrationManager gets notified when TTS voice loads/fails.
    if (global.TTS && TTS.onStateChange) {
      TTS.onStateChange(() => notifyStateChange());
    }
  }

  function isAvailable() {
    return !!(global.TTS && TTS.isEnabled && TTS.isEnabled());
  }

  function speak(text, audioUrl) {
    // audioUrl is ignored — TTS uses the text
    if (!global.TTS || !TTS.speak) return false;
    return TTS.speak(text);
  }

  function cancel() {
    if (global.TTS && TTS.cancel) TTS.cancel();
  }

  function activate() {
    if (global.TTS && TTS.activate) TTS.activate();
  }

  function setMuted(m) {
    if (global.TTS && TTS.setMuted) TTS.setMuted(m);
  }

  function setRate(r) {
    if (global.TTS && TTS.setRate) TTS.setRate(r);
  }

  function isSpeaking() {
    return !!(global.TTS && TTS.isSpeaking && TTS.isSpeaking());
  }

  function getName() { return 'tts'; }

  function onStateChange(cb) {
    TTSProvider.stateListeners.push(cb);
  }

  function notifyStateChange() {
    TTSProvider.stateListeners.forEach(cb => { try { cb(); } catch (e) {} });
  }

  TTSProvider.init = init;
  TTSProvider.isAvailable = isAvailable;
  TTSProvider.speak = speak;
  TTSProvider.cancel = cancel;
  TTSProvider.activate = activate;
  TTSProvider.setMuted = setMuted;
  TTSProvider.setRate = setRate;
  TTSProvider.isSpeaking = isSpeaking;
  TTSProvider.getName = getName;
  TTSProvider.onStateChange = onStateChange;

  global.TTSProvider = TTSProvider;
})(window);
