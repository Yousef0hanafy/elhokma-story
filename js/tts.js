/**
 * TTS Engine — Arabic voice narration via Web Speech API
 * -------------------------------------------------------
 * Provides high-quality Arabic text-to-speech synchronized with the
 * narrator's subtitle segments. Designed for Saudi educational context.
 *
 * Features:
 *   - Auto-detects best Arabic voice (prefers ar-SA, then any ar-*).
 *   - Falls back gracefully to subtitle-only when no Arabic voice exists.
 *   - Synced with narrator.js segment timeline.
 *   - Per-segment speaking — pauses naturally between sentences.
 *   - Speed control (0.75x, 1x, 1.25x, 1.5x).
 *   - Mute toggle (persists in localStorage).
 *   - Auto-cancels in-flight speech on skip/replay/scene-change.
 *
 * API:
 *   TTS.init()                  // call once on app boot
 *   TTS.speak(text)             // speak a segment (cancels previous)
 *   TTS.cancel()                // stop all speech immediately
 *   TTS.isEnabled()             // is TTS available + not muted?
 *   TTS.isSpeaking()            // currently speaking?
 *   TTS.setMuted(bool)          // mute/unmute
 *   TTS.setRate(float)          // 0.75 – 1.5
 *   TTS.onStateChange(cb)       // subscribe to speaking/idle state changes
 */
(function (global) {
  'use strict';

  const TTS = {
    synth: null,
    voice: null,
    available: false,
    muted: false,
    rate: 1.0,
    pitch: 1.0,
    volume: 1.0,
    currentUtterance: null,
    stateListeners: [],
    speaking: false,
  };

  // ---------- Persistence ----------
  const LS_KEY = 'tts_settings_v1';
  function loadSettings() {
    try {
      const s = JSON.parse(localStorage.getItem(LS_KEY) || '{}');
      TTS.muted = s.muted !== undefined ? !!s.muted : false;
      TTS.rate = s.rate || 1.0;
    } catch (e) {}
  }
  function saveSettings() {
    try {
      localStorage.setItem(LS_KEY, JSON.stringify({ muted: TTS.muted, rate: TTS.rate }));
    } catch (e) {}
  }

  // ---------- Init ----------
  function init() {
    loadSettings();
    if (!('speechSynthesis' in global) || !global.speechSynthesis) {
      console.info('[TTS] Web Speech API not available — subtitle-only mode.');
      TTS.available = false;
      notifyStateChange();
      return;
    }
    TTS.synth = global.speechSynthesis;

    // Wait for voices to load (Chrome loads async)
    const loadVoices = () => {
      const voices = TTS.synth.getVoices();
      if (voices.length === 0) return false;
      pickVoice(voices);
      return true;
    };

    if (!loadVoices()) {
      TTS.synth.onvoiceschanged = () => loadVoices();
      // Retry a few times (some browsers need this)
      setTimeout(loadVoices, 250);
      setTimeout(loadVoices, 800);
      setTimeout(loadVoices, 1500);
    }

    // Cancel any speech on page unload
    global.addEventListener('beforeunload', () => {
      try { TTS.synth.cancel(); } catch (e) {}
    });
  }

  function pickVoice(voices) {
    // Priority: ar-SA (Saudi) > ar-EG > ar > any ar-* > fallback
    const arVoices = voices.filter(v => /^ar(-|_)/i.test(v.lang) || /^ar$/i.test(v.lang));
    if (arVoices.length === 0) {
      console.info('[TTS] No Arabic voice found. Available voices:', voices.map(v => v.lang).join(', '));
      TTS.available = false;
      notifyStateChange();
      return;
    }

    // Prefer Saudi dialect
    const sa = arVoices.find(v => /^ar(-|_)SA/i.test(v.lang));
    const eg = arVoices.find(v => /^ar(-|_)EG/i.test(v.lang));
    // Prefer female voices for our narrator (Dr. سارة)
    const femaleHints = ['female', 'woman', 'sara', 'amira', 'laila', 'salma', 'najwa', 'zeina'];
    const femaleAr = arVoices.find(v => femaleHints.some(h => (v.name || '').toLowerCase().includes(h)));

    TTS.voice = sa || femaleAr || eg || arVoices[0];
    TTS.available = true;
    console.info(`[TTS] Arabic voice ready: ${TTS.voice.name} (${TTS.voice.lang})`);
    notifyStateChange();
  }

  // ---------- Speak ----------
  function speak(text) {
    if (!TTS.available || TTS.muted || !TTS.voice || !text) {
      return false;
    }
    // Cancel any in-flight speech
    cancel();

    const u = new SpeechSynthesisUtterance(text);
    u.voice = TTS.voice;
    u.lang = TTS.voice.lang;
    u.rate = TTS.rate;
    u.pitch = TTS.pitch;
    u.volume = TTS.volume;

    u.onstart = () => {
      TTS.speaking = true;
      notifyStateChange();
    };
    u.onend = () => {
      TTS.speaking = false;
      TTS.currentUtterance = null;
      notifyStateChange();
    };
    u.onerror = (e) => {
      // Don't log 'interrupted' or 'canceled' as errors — they happen on normal cancel
      if (e.error && !['interrupted', 'canceled'].includes(e.error)) {
        console.warn('[TTS] Speech error:', e.error);
      }
      TTS.speaking = false;
      TTS.currentUtterance = null;
      notifyStateChange();
    };

    TTS.currentUtterance = u;
    // Small delay helps Chrome process cancel-before-speak reliably
    setTimeout(() => {
      if (TTS.currentUtterance === u && TTS.synth) {
        try { TTS.synth.speak(u); } catch (e) { console.warn('[TTS] speak() failed:', e); }
      }
    }, 30);
    return true;
  }

  function cancel() {
    if (!TTS.synth) return;
    try {
      TTS.synth.cancel();
    } catch (e) {}
    TTS.speaking = false;
    TTS.currentUtterance = null;
    notifyStateChange();
  }

  // ---------- Settings ----------
  function setMuted(m) {
    TTS.muted = !!m;
    if (TTS.muted) cancel();
    saveSettings();
    notifyStateChange();
  }
  function setRate(r) {
    TTS.rate = Math.max(0.5, Math.min(2.0, r));
    saveSettings();
  }
  function isEnabled() {
    return TTS.available && !TTS.muted;
  }
  function isSpeaking() {
    return TTS.speaking;
  }

  // ---------- State subscription ----------
  function onStateChange(cb) {
    TTS.stateListeners.push(cb);
    // Fire immediately with current state
    cb(getState());
  }
  function notifyStateChange() {
    const s = getState();
    TTS.stateListeners.forEach(cb => { try { cb(s); } catch (e) {} });
  }
  function getState() {
    return {
      available: TTS.available,
      muted: TTS.muted,
      speaking: TTS.speaking,
      rate: TTS.rate,
      voiceName: TTS.voice ? TTS.voice.name : null,
      voiceLang: TTS.voice ? TTS.voice.lang : null,
    };
  }

  // ---------- Public API ----------
  TTS.init = init;
  TTS.speak = speak;
  TTS.cancel = cancel;
  TTS.setMuted = setMuted;
  TTS.setRate = setRate;
  TTS.isEnabled = isEnabled;
  TTS.isSpeaking = isSpeaking;
  TTS.onStateChange = onStateChange;
  TTS.getState = getState;

  global.TTS = TTS;
})(window);
