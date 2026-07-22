/**
 * NarrationManager — provider-agnostic narration abstraction.
 *
 * This is the single entry point for all narration in the app. Scene code
 * and the Narrator engine call NarrationManager.speak()/cancel() without
 * knowing whether the audio comes from professional studio recordings,
 * browser TTS, or subtitle-only mode.
 *
 * Provider priority (first available wins):
 *   1. AudioProvider  — professional MP3 narration (if audio manifest exists
 *      for the current scene AND the audio file loads successfully)
 *   2. TTSProvider    — browser Web Speech API Arabic TTS (if a voice is
 *      available AND the user has activated audio)
 *   3. SubtitleProvider — subtitle-only (always available; subtitles render
 *      regardless of provider, so this is the silent fallback)
 *
 * Fallback: if the active provider fails mid-narration (e.g., audio 404,
 * TTS error), NarrationManager automatically falls back to the next
 * provider without interrupting the learner.
 *
 * Activation: browser autoplay policies require a user gesture before any
 * audio can play. NarrationManager.activate() is called on the first user
 * gesture (the TTS activation overlay button). Until activated, all
 * narration is subtitle-only — this is intentional and correct.
 *
 * API (what scene code / Narrator calls):
 *   NarrationManager.init(manifest)           // set the audio manifest
 *   NarrationManager.setContext(sceneId)      // tell NM which scene we're in
 *   NarrationManager.activate()               // user gesture — enable audio
 *   NarrationManager.isActivated()            // has user enabled audio?
 *   NarrationManager.speak(text, segmentId)   // narrate a segment
 *   NarrationManager.cancel()                 // stop immediately
 *   NarrationManager.setMuted(bool)           // mute/unmute (preserves activation)
 *   NarrationManager.setRate(float)           // 0.75 – 1.5
 *   NarrationManager.isSpeaking()             // currently narrating?
 *   NarrationManager.getState()               // { provider, available, muted, speaking, rate }
 *   NarrationManager.onStateChange(cb)        // subscribe to state changes
 *
 * Subtitles are ALWAYS shown by the Narrator engine (typewriter effect).
 * NarrationManager only controls audio. This guarantees the product is
 * usable by deaf/hard-of-hearing learners and in silent environments.
 */
(function (global) {
  'use strict';

  const NarrationManager = {
    providers: [],
    activeProvider: null,
    activated: false,
    muted: false,
    rate: 1.0,
    stateListeners: [],
    manifest: null,      // audio manifest from content.js
    currentSceneId: null,
    currentSegmentId: null,
  };

  // ---------- Provider interface ----------
  // Each provider implements:
  //   init()                          — one-time setup
  //   isAvailable()                   — can this provider narrate right now?
  //   speak(text, audioUrl)           — start narrating; returns true if started
  //   cancel()                        — stop immediately
  //   setMuted(bool)                  — mute/unmute
  //   setRate(float)                  — set playback speed
  //   isSpeaking()                    — currently playing?
  //   onStateChange(cb)               — subscribe to provider state changes
  //   getName()                       — 'audio' | 'tts' | 'subtitle'
  //
  // Providers are registered in priority order. NarrationManager picks the
  // first available provider on each speak() call.

  function registerProvider(provider) {
    if (!provider || !provider.getName) return;
    NarrationManager.providers.push(provider);
    // Wire provider state changes to our own state notification
    if (provider.onStateChange) {
      provider.onStateChange(() => notifyStateChange());
    }
  }

  // ---------- Manifest ----------
  // The audio manifest maps sceneId → segmentId → audio file URL.
  // Example:
  //   {
  //     'opening': { '0': 'audio/opening/seg-0.mp3', '1': 'audio/opening/seg-1.mp3' },
  //     'boardroom': { '0': 'audio/boardroom/seg-0.mp3', ... }
  //   }
  // If no manifest is provided, or a scene/segment isn't in the manifest,
  // AudioProvider.isAvailable() returns false and we fall back to TTS.
  function init(manifest) {
    NarrationManager.manifest = manifest || {};
    // Initialize all providers
    NarrationManager.providers.forEach(p => {
      try { if (p.init) p.init(); } catch (e) { console.warn('[NarrationManager] provider init failed:', p.getName?.(), e); }
    });
    notifyStateChange();
  }

  function setContext(sceneId) {
    NarrationManager.currentSceneId = sceneId;
    NarrationManager.currentSegmentId = null;
  }

  // Look up the audio URL for the current scene + segment.
  function getAudioUrl(segmentId) {
    if (!NarrationManager.manifest || !NarrationManager.currentSceneId) return null;
    const sceneAudio = NarrationManager.manifest[NarrationManager.currentSceneId];
    if (!sceneAudio) return null;
    return sceneAudio[String(segmentId)] || sceneAudio[segmentId] || null;
  }

  // ---------- Activation ----------
  function activate() {
    NarrationManager.activated = true;
    // Tell all providers the user has gestured
    NarrationManager.providers.forEach(p => {
      try { if (p.activate) p.activate(); } catch (e) {}
    });
    notifyStateChange();
  }

  function isActivated() {
    return NarrationManager.activated;
  }

  // ---------- Speak ----------
  // Picks the best available provider and narrates the text.
  // `segmentId` is used to look up the audio file URL in the manifest.
  // If the active provider fails, we fall back to the next one.
  function speak(text, segmentId) {
    if (NarrationManager.muted || !text) return false;

    NarrationManager.currentSegmentId = segmentId;

    // If not activated, no audio plays (subtitles still show via Narrator).
    // This is correct browser behavior — we can't bypass autoplay policies.
    if (!NarrationManager.activated) return false;

    // Find the first available provider
    for (const provider of NarrationManager.providers) {
      if (!provider.isAvailable()) continue;

      const audioUrl = (provider.getName() === 'audio')
        ? getAudioUrl(segmentId)
        : null;

      // AudioProvider needs a URL; if no URL for this segment, skip to TTS
      if (provider.getName() === 'audio' && !audioUrl) continue;

      try {
        const started = provider.speak(text, audioUrl);
        if (started) {
          NarrationManager.activeProvider = provider;
          notifyStateChange();
          return true;
        }
      } catch (e) {
        console.warn('[NarrationManager] provider failed, falling back:', provider.getName?.(), e);
        // Fall through to next provider
      }
    }

    // No provider could narrate — subtitle-only mode (subtitles still work)
    NarrationManager.activeProvider = null;
    return false;
  }

  function cancel() {
    NarrationManager.providers.forEach(p => {
      try { if (p.cancel) p.cancel(); } catch (e) {}
    });
    NarrationManager.activeProvider = null;
    notifyStateChange();
  }

  // ---------- Settings ----------
  function setMuted(m) {
    NarrationManager.muted = !!m;
    if (NarrationManager.muted) cancel();
    NarrationManager.providers.forEach(p => {
      try { if (p.setMuted) p.setMuted(NarrationManager.muted); } catch (e) {}
    });
    notifyStateChange();
  }

  function setRate(r) {
    NarrationManager.rate = Math.max(0.5, Math.min(2.0, r));
    NarrationManager.providers.forEach(p => {
      try { if (p.setRate) p.setRate(NarrationManager.rate); } catch (e) {}
    });
    notifyStateChange();
  }

  // ---------- State ----------
  function isSpeaking() {
    return NarrationManager.providers.some(p => {
      try { return p.isSpeaking && p.isSpeaking(); } catch (e) { return false; }
    });
  }

  function getActiveProviderName() {
    return NarrationManager.activeProvider ? NarrationManager.activeProvider.getName() : null;
  }

  function getState() {
    // Determine the "available" provider for UI display
    let availableProvider = null;
    for (const p of NarrationManager.providers) {
      if (p.isAvailable && p.isAvailable()) { availableProvider = p.getName(); break; }
    }
    return {
      provider: getActiveProviderName(),
      available: availableProvider,
      activated: NarrationManager.activated,
      muted: NarrationManager.muted,
      speaking: isSpeaking(),
      rate: NarrationManager.rate,
      hasAudioManifest: !!(NarrationManager.manifest && Object.keys(NarrationManager.manifest).length > 0),
    };
  }

  function onStateChange(cb) {
    NarrationManager.stateListeners.push(cb);
    cb(getState());
  }

  function notifyStateChange() {
    const s = getState();
    NarrationManager.stateListeners.forEach(cb => {
      try { cb(s); } catch (e) {}
    });
  }

  // ---------- Public API ----------
  NarrationManager.registerProvider = registerProvider;
  NarrationManager.init = init;
  NarrationManager.setContext = setContext;
  NarrationManager.activate = activate;
  NarrationManager.isActivated = isActivated;
  NarrationManager.speak = speak;
  NarrationManager.cancel = cancel;
  NarrationManager.setMuted = setMuted;
  NarrationManager.setRate = setRate;
  NarrationManager.isSpeaking = isSpeaking;
  NarrationManager.getState = getState;
  NarrationManager.onStateChange = onStateChange;

  global.NarrationManager = NarrationManager;
})(window);
