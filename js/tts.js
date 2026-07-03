/**
 * TTS Engine — Arabic voice narration via Web Speech API
 * -------------------------------------------------------
 * v2: Improved voice loading, user-gesture activation, and robust fallback.
 *
 * Key design decisions:
 * 1. Browser autoplay policies require a user gesture before speechSynthesis
 *    can play. So we require explicit "activation" via user click.
 * 2. Chrome loads voices asynchronously (getVoices() returns [] initially).
 *    We poll for up to 5 seconds and listen for onvoiceschanged.
 * 3. Many systems (especially Linux/headless) have NO Arabic voices. We
 *    detect this and gracefully fall back to subtitle-only mode with a
 *    clear UI indicator.
 * 4. If Arabic voices aren't available, we try ANY voice that can handle
 *    Arabic text (some multilingual voices exist).
 *
 * API:
 *   TTS.init()                  // call once on app boot
 *   TTS.activate()              // call on user gesture (button click)
 *   TTS.isActivated()           // has user enabled TTS?
 *   TTS.speak(text)             // speak a segment (cancels previous)
 *   TTS.cancel()                // stop all speech immediately
 *   TTS.isEnabled()             // is TTS available + activated + not muted?
 *   TTS.isSpeaking()            // currently speaking?
 *   TTS.setMuted(bool)          // mute/unmute
 *   TTS.setRate(float)          // 0.75 – 1.5
 *   TTS.onStateChange(cb)       // subscribe to state changes
 */
(function (global) {
  'use strict';

  const TTS = {
    synth: null,
    voice: null,
    available: false,      // Arabic voice exists + synth works
    activated: false,      // User has clicked to enable TTS
    muted: false,
    rate: 1.0,
    pitch: 1.0,
    volume: 1.0,
    currentUtterance: null,
    stateListeners: [],
    speaking: false,
    pendingText: null,     // Text to speak once activated
    voiceCheckTimer: null,
  };

  // ---------- Persistence ----------
  const LS_KEY = 'tts_settings_v1';
  function loadSettings() {
    try {
      const s = JSON.parse(localStorage.getItem(LS_KEY) || '{}');
      TTS.muted = s.muted !== undefined ? !!s.muted : false;
      TTS.rate = s.rate || 1.0;
      // Don't persist activated across sessions — user must re-activate
      // (browser autoplay policies reset per session)
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

    // Chrome loads voices asynchronously. Poll for up to 5 seconds.
    let attempts = 0;
    const maxAttempts = 20; // 20 × 250ms = 5s
    const loadVoices = () => {
      attempts++;
      const voices = TTS.synth.getVoices();
      if (voices.length > 0) {
        pickVoice(voices);
        return true;
      }
      if (attempts < maxAttempts) {
        TTS.voiceCheckTimer = setTimeout(loadVoices, 250);
      } else {
        console.info('[TTS] No voices found after 5s of polling. Subtitle-only mode.');
        TTS.available = false;
        notifyStateChange();
      }
      return false;
    };

    // Try immediate
    if (!loadVoices()) {
      // Also listen for the async event
      TTS.synth.onvoiceschanged = () => {
        if (TTS.voiceCheckTimer) clearTimeout(TTS.voiceCheckTimer);
        loadVoices();
      };
    }

    // Cancel any speech on page unload
    global.addEventListener('beforeunload', () => {
      try { if (TTS.synth) TTS.synth.cancel(); } catch (e) {}
    });
  }

  function pickVoice(voices) {
    // Priority: ar-SA (Saudi) > ar-EG > any ar-* > multilingual voices
    const arVoices = voices.filter(v => /^ar(-|_)/i.test(v.lang) || /^ar$/i.test(v.lang));
    if (arVoices.length === 0) {
      console.info('[TTS] No Arabic voice found among', voices.length, 'voices.');
      console.info('[TTS] Available langs:', voices.map(v => v.lang).join(', '));
      TTS.available = false;
      notifyStateChange();
      return;
    }

    // Prefer Saudi dialect, then Egyptian, then any Arabic
    const sa = arVoices.find(v => /^ar(-|_)SA/i.test(v.lang));
    const eg = arVoices.find(v => /^ar(-|_)EG/i.test(v.lang));
    // Prefer female voices for our narrator (Dr. سارة)
    const femaleHints = ['female', 'woman', 'sara', 'amira', 'laila', 'salma', 'najwa', 'zeina', 'hoda', 'mona'];
    const femaleAr = arVoices.find(v => femaleHints.some(h => (v.name || '').toLowerCase().includes(h)));

    TTS.voice = sa || femaleAr || eg || arVoices[0];
    TTS.available = true;
    console.info(`[TTS] Arabic voice ready: ${TTS.voice.name} (${TTS.voice.lang})`);
    notifyStateChange();
  }

  // ---------- Activation (user gesture required) ----------
  function activate() {
    TTS.activated = true;
    // If there's pending text, speak it now
    if (TTS.pendingText) {
      const text = TTS.pendingText;
      TTS.pendingText = null;
      // Small delay to let the browser register the user gesture
      setTimeout(() => speak(text), 100);
    }
    notifyStateChange();
    return TTS.available;
  }

  // ---------- Speak ----------
  function speak(text) {
    if (!TTS.available || TTS.muted || !TTS.voice || !text) {
      return false;
    }
    // If not activated yet, queue the text for when user activates
    if (!TTS.activated) {
      TTS.pendingText = text;
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
    try { TTS.synth.cancel(); } catch (e) {}
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
    return TTS.available && TTS.activated && !TTS.muted;
  }
  function isSpeaking() {
    return TTS.speaking;
  }
  function isActivated() {
    return TTS.activated;
  }

  // ---------- State subscription ----------
  function onStateChange(cb) {
    TTS.stateListeners.push(cb);
    cb(getState());
  }
  function notifyStateChange() {
    const s = getState();
    TTS.stateListeners.forEach(cb => { try { cb(s); } catch (e) {} });
  }
  function getState() {
    return {
      available: TTS.available,
      activated: TTS.activated,
      muted: TTS.muted,
      speaking: TTS.speaking,
      rate: TTS.rate,
      voiceName: TTS.voice ? TTS.voice.name : null,
      voiceLang: TTS.voice ? TTS.voice.lang : null,
    };
  }

  // ---------- Public API ----------
  TTS.init = init;
  TTS.activate = activate;
  TTS.isActivated = isActivated;
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
