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
 * 7. Phones:
 *    - Some Android TTS engines (common on Xiaomi/Samsung) report NO voices
 *      at all, yet speak Arabic fine when asked by language. With an empty
 *      voice list we try "by language" (lang=ar-SA, no voice object) and
 *      drop to subtitles if the engine then errors.
 *    - iOS only lets speech start from inside a tap, so the first utterance
 *      after activation is sent synchronously (no timer in between).
 *    - Android Chrome can drop an utterance queued right after cancel(), and
 *      some engines never fire `end`. We only cancel when something is
 *      playing, leave a gap after a real cancel, and a watchdog clears the
 *      "speaking" flag so the narration never stalls waiting for it.
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
    byLanguage: false,     // no voice list: ask the engine for Arabic by lang
    loading: false,        // still waiting for the voice list
    watchdog: null,
  };

  const FALLBACK_LANG = 'ar-SA';

  // ---------- Init ----------
  function init() {
    if (!('speechSynthesis' in global) || !global.speechSynthesis) {
      console.info('[TTS] Web Speech API not available — subtitle-only mode.');
      TTS.available = false;
      notifyStateChange();
      return;
    }
    TTS.synth = global.speechSynthesis;
    TTS.loading = true;

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
        // The engine exposes no voice list. Many Android engines still speak
        // Arabic when asked by language, so offer audio and find out on the
        // first utterance (an engine error turns it off again).
        console.info('[TTS] No voice list after 5s; will request Arabic by language.');
        TTS.voice = null;
        TTS.byLanguage = true;
        TTS.available = true;
        TTS.loading = false;
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
    TTS.loading = false;
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
    TTS.byLanguage = false;
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
    if (!TTS.available || TTS.muted || (!TTS.voice && !TTS.byLanguage) || !text) {
      return false;
    }
    // If not activated yet, queue the text for when user activates
    if (!TTS.activated) {
      TTS.pendingText = text;
      return false;
    }

    // Cancel in-flight speech only when there is some: on Android a
    // cancel() right before speak() can swallow the new utterance.
    const busy = engineBusy();
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
      if (TTS.voice) u.voice = TTS.voice;
      u.lang = TTS.voice ? TTS.voice.lang : FALLBACK_LANG;
      u.rate = TTS.rate;
      u.pitch = TTS.pitch;
      u.volume = TTS.volume;
      const isLast = i === chunks.length - 1;
      u.onend = () => {
        if (!isLast || TTS.currentUtterance !== token) return;
        finish();
      };
      u.onerror = (e) => {
        const real = e.error && !['interrupted', 'canceled'].includes(e.error);
        if (real) console.warn('[TTS] Speech error:', e.error);
        if (TTS.currentUtterance !== token) return;
        finish();
        // Asked for Arabic by language and the engine cannot do it: stop
        // offering audio rather than failing on every sentence.
        if (real && TTS.byLanguage) {
          console.info('[TTS] Engine cannot speak Arabic by language. Subtitle-only mode.');
          TTS.available = false;
          notifyStateChange();
        }
      };
      return u;
    });

    // Some Android engines never fire `end`. Clear "speaking" after a
    // generous estimate so the Narrator is never stuck waiting on it.
    const estimateMs = 2500 + String(text).length * 120 / (TTS.rate || 1);
    TTS.watchdog = setTimeout(() => {
      if (TTS.currentUtterance === token) finish();
    }, estimateMs);

    function finish() {
      if (TTS.currentUtterance !== token) return;
      clearTimeout(TTS.watchdog);
      TTS.speaking = false;
      TTS.currentUtterance = null;
      notifyStateChange();
    }

    const send = () => {
      if (TTS.currentUtterance !== token || !TTS.synth) return;
      try {
        // Chrome on Android can be left "paused" after the tab was in the
        // background; resume() is a no-op otherwise.
        if (typeof TTS.synth.resume === 'function') TTS.synth.resume();
        utterances.forEach(u => TTS.synth.speak(u));
      } catch (e) {
        console.warn('[TTS] speak() failed:', e);
        finish();
      }
    };
    // Speak right away when nothing was cancelled: this keeps the call inside
    // the learner's tap, which iOS requires for the first utterance. After a
    // real cancel, give the engine a moment to settle first.
    if (busy) setTimeout(send, 150);
    else send();
    return true;
  }

  function engineBusy() {
    const synth = TTS.synth;
    return !!(synth && (synth.speaking || synth.pending || TTS.speaking));
  }

  function cancel() {
    if (!TTS.synth) return;
    clearTimeout(TTS.watchdog);
    // Only touch the engine when it has something to stop (see speak()).
    if (engineBusy()) {
      try { TTS.synth.cancel(); } catch (e) {}
    }
    TTS.speaking = false;
    TTS.currentUtterance = null;
    notifyStateChange();
  }

  // iOS unlocks speech only from inside a tap. When activation happens with
  // no sentence to read yet, speak a silent primer in the tap so the next
  // sentence (started by a timer) is allowed to play.
  function unlock() {
    if (!TTS.synth || !TTS.available) return;
    try {
      const u = new SpeechSynthesisUtterance(' ');
      u.volume = 0;
      u.lang = TTS.voice ? TTS.voice.lang : FALLBACK_LANG;
      if (TTS.voice) u.voice = TTS.voice;
      TTS.synth.speak(u);
    } catch (e) { /* best-effort */ }
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
      voiceLang: TTS.voice ? TTS.voice.lang : (TTS.byLanguage ? FALLBACK_LANG : null),
      byLanguage: TTS.byLanguage,
      loading: TTS.loading,
    };
  }

  // ---------- Public API ----------
  TTS.init = init;
  TTS.activate = activate;
  TTS.isActivated = isActivated;
  TTS.speak = speak;
  TTS.cancel = cancel;
  TTS.unlock = unlock;
  TTS.setMuted = setMuted;
  TTS.setRate = setRate;
  TTS.isEnabled = isEnabled;
  TTS.isSpeaking = isSpeaking;
  TTS.onStateChange = onStateChange;
  TTS.getState = getState;

  global.TTS = TTS;
})(window);
