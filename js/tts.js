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
 * 4. Without an Arabic voice we report `available: false`; the app then
 *    runs subtitle-only and says so, rather than reading Arabic text with
 *    an English voice.
 * 5. Chrome silently stops any single utterance after ~15 seconds. Long
 *    text is split at sentence boundaries into short utterances that the
 *    browser queues back to back.
 * 6. Mute and speed are owned (and persisted) by NarrationManager, which
 *    pushes them here; this module stores no settings of its own.
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

  // ---------- Init ----------
  function init() {
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
  // Split at sentence punctuation (Arabic and Latin) into chunks short
  // enough to stay under Chrome's ~15s utterance cut-off.
  const MAX_CHUNK = 160;
  function splitText(text) {
    const sentences = String(text).match(/[^.!?؟؛،\n]+[.!?؟؛،\n]*/g) || [String(text)];
    const chunks = [];
    let cur = '';
    sentences.forEach(sentence => {
      if ((cur + sentence).length > MAX_CHUNK && cur) { chunks.push(cur.trim()); cur = ''; }
      cur += sentence;
    });
    if (cur.trim()) chunks.push(cur.trim());
    return chunks.length ? chunks : [String(text)];
  }

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

    const chunks = splitText(text);
    const token = {};
    TTS.currentUtterance = token;
    // Mark as speaking right away (the browser starts asynchronously) so
    // the Narrator never mistakes "about to speak" for "finished".
    TTS.speaking = true;
    notifyStateChange();

    const utterances = chunks.map((chunk, i) => {
      const u = new SpeechSynthesisUtterance(chunk);
      u.voice = TTS.voice;
      u.lang = TTS.voice.lang;
      u.rate = TTS.rate;
      u.pitch = TTS.pitch;
      u.volume = TTS.volume;
      const isLast = i === chunks.length - 1;
      u.onend = () => {
        if (!isLast || TTS.currentUtterance !== token) return;
        TTS.speaking = false;
        TTS.currentUtterance = null;
        notifyStateChange();
      };
      u.onerror = (e) => {
        if (e.error && !['interrupted', 'canceled'].includes(e.error)) {
          console.warn('[TTS] Speech error:', e.error);
        }
        if (TTS.currentUtterance !== token) return;
        TTS.speaking = false;
        TTS.currentUtterance = null;
        notifyStateChange();
      };
      return u;
    });

    // Small delay helps Chrome process cancel-before-speak reliably
    setTimeout(() => {
      if (TTS.currentUtterance !== token || !TTS.synth) return;
      try { utterances.forEach(u => TTS.synth.speak(u)); }
      catch (e) {
        console.warn('[TTS] speak() failed:', e);
        TTS.speaking = false;
        TTS.currentUtterance = null;
        notifyStateChange();
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
    notifyStateChange();
  }
  function setRate(r) {
    TTS.rate = Math.max(0.5, Math.min(2.0, r));
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
