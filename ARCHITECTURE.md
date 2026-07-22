# Architecture — رحلة الحوكمة

This document captures engineering intent: **why** decisions were made, **how** to extend the project safely, and **where** the fragile areas are. It is written for the engineer who inherits this codebase next.

For "what does each file do", see the README architecture tree. For "how to deploy", see DEPLOY.md. This document is about the reasoning that isn't obvious from reading the code.

---

## Design Principles

1. **Vanilla JS, zero dependencies.** The product runs inside SCORM sandboxed iframes where external CDN scripts may be blocked. No build step means no bundler configuration to maintain.
2. **Subtitles are first-class.** Audio narration is an enhancement. The product must be fully usable by deaf learners and in silent environments. Every narration path has a subtitle fallback.
3. **Single source of truth.** Scoring, versioning, and state management each have exactly one module that owns them. Duplicated logic is the #1 source of silent bugs in e-learning compliance software.
4. **Fail gracefully.** Every external call (LMS, TTS, audio playback) is wrapped in try/catch. A misbehaving LMS or missing audio file must never leave the learner on a blank screen.

---

## Module Responsibilities

### State & Logic (testable, no DOM)

| Module | Owns | Key invariant |
|--------|------|---------------|
| `scorm-api.js` | LMS communication + localStorage fallback | `finish()` is idempotent; safe to call from multiple unload handlers |
| `scoring.js` | Score computation | Single source of truth — no other module calls `ScormApi.setScore()` directly |
| `version.js` | Content version + completion record | Completion record persists in `suspend_data.completion` for audit |

### Rendering & Interaction (DOM-coupled)

| Module | Owns | Key invariant |
|--------|------|---------------|
| `app.js` | Scene dispatch, state, UI wiring | Scene renderers are registered in `SCENE_RENDERERS` map, not if/else |
| `narrator.js` | Timed subtitles + typewriter + pause/resume | Subtitles ALWAYS render; audio is optional |
| `animator.js` | setTimeout-based timeline orchestration | All timeouts tracked in `timeouts[]` for clean cancellation |
| `modal-manager.js` | Modal lifecycle (focus trap, aria-hidden) | Only modifies elements that don't already have `aria-hidden` |

### Narration (provider abstraction)

| Module | Owns | Key invariant |
|--------|------|---------------|
| `narration-manager.js` | Provider selection + fallback | Picks first available provider per `speak()` call |
| `audio-provider.js` | Professional MP3 playback (priority 1) | Cleans up `<audio>` elements on end/error to prevent leaks |
| `tts-provider.js` | Browser TTS adapter (priority 2) | Thin wrapper over `tts.js`; delegates to existing TTS module |
| `tts.js` | Web Speech API engine | Handles voice loading, activation, rate/mute |

### Infrastructure

| Module | Owns | Key invariant |
|--------|------|---------------|
| `error-boundary.js` | Global error catching + recovery UI | Self-installs on load (doesn't wait for app.js) |
| `content.js` | All learner-facing content + production specs | Editing content never requires touching other files |

---

## Key Architectural Decisions

### Why provider-agnostic narration?

**Problem**: The product launched with browser TTS, but the roadmap requires professional studio audio. Rewriting scene code when audio arrives would be risky.

**Decision**: `NarrationManager` sits between the Narrator (subtitles) and the audio providers. Scene code calls `NarrationManager.speak(text, segmentId)` without knowing which provider is active.

**Tradeoff**: One extra layer of abstraction. Worth it because the alternative (rewriting all scene renderers when audio arrives) would touch 7 scene functions and risk regressions in assessment scoring.

**To add professional audio**: place MP3s in `/audio/<sceneId>/seg-<n>.mp3`, add entries to `CONTENT.audio.narration` in `content.js`. No code changes. See "Extension Points" below.

### Why `sceneState[idx]` instead of top-level state?

**Problem**: The boardroom (scene 2) originally used `state.exploredSeats`, `state.assessmentAnswer`, etc. All other scenes used `state.sceneState[idx]`. This created special cases in 5 functions and was a trap for new engineers.

**Decision**: Migrated boardroom to `sceneState[1]`. Legacy fields are synced in `saveState()` for backward compatibility with older app versions.

**Tradeoff**: `saveState()` has a sync block that looks redundant. It's not — it keeps older app versions functional if a learner's LMS caches the old JS. Do not remove it.

### Why network-first service worker for JS, cache-first for CSS?

**Problem**: A pure cache-first SW serves stale JS for one page load after every deploy. For an assessment-bearing module, that means a learner could complete a quiz with buggy old code.

**Decision**: HTML and JS use network-first (fresh code on every load). CSS, images, and fonts use cache-first (they change less often and stale CSS doesn't affect scoring correctness).

**Tradeoff**: Slightly slower JS loads (network round-trip before cache fallback). Acceptable for correctness.

### Why `style-src 'unsafe-inline'` in CSP?

**Problem**: JS sets `element.style.transition`, `element.style.opacity`, etc. for animations. These inline styles require `'unsafe-inline'` in the CSP.

**Decision**: Allow `style-src 'unsafe-inline'` but keep `script-src 'self'` (no inline scripts, no eval). Inline styles are low-risk (no script execution); inline scripts are high-risk.

**Alternative considered**: Nonce-based CSP. Rejected because it requires a server to generate nonces — this is a static SCORM package with no backend.

### Why does `pagehide` check `event.persisted`?

**Problem**: Mobile Safari fires `pagehide` with `persisted=true` when the page enters the back-forward cache (bfcache). If we call `SCORM finish()` at that point, the session is dead when the user returns via the back button — all subsequent progress is lost.

**Decision**: `handleUnload(event)` checks `event.persisted`. If true, we skip `finish()`. A `pageshow` handler restarts the session timer when the page is restored from bfcache.

**Do not remove** the `persisted` check. It prevents data loss on iOS.

---

## Fragile Areas

These are places where the code looks simple but has subtle invariants. Read this before modifying.

### `resetCurrentSceneState()` — only call on non-completed scenes

```js
if (!isSceneCompleted(idx)) {
  resetCurrentSceneState();
}
```

**Why**: Calling `resetCurrentSceneState()` on a completed scene deletes the learner's exploration progress (seats explored, layers viewed). This was a real bug: returning to a completed scene via the drawer silently destroyed work.

**Invariant**: Never call `resetCurrentSceneState()` unconditionally. Always guard with `isSceneCompleted()`.

### `ModalManager.open()` — aria-hidden preservation

```js
if (el.getAttribute('aria-hidden') === 'true') return; // already hidden — leave it alone
```

**Why**: The loader, letterbox bars, and topbar start with `aria-hidden="true"` in the HTML. If we blindly `setAttribute('aria-hidden', 'true')` on all body children and then `removeAttribute` on close, we'd corrupt their original state.

**Invariant**: Only set `aria-hidden` on elements that don't already have it. Track modified elements via `data-modal-hidden="1"` and only restore those.

### Narrator pause — timeout re-scheduling math

```js
const elapsed = (Narrator.pauseTimestamp - Narrator.startTimestamp) / 1000;
```

**Why**: `setTimeout` doesn't expose remaining delay. On pause, we calculate elapsed time from `startTimestamp`, then re-schedule each pending segment with `seg.time - elapsed`. On resume, we adjust `startTimestamp` so the next pause calculation is correct.

**Invariant**: `startTimestamp` must be adjusted on resume (`Date.now() - (pauseTimestamp - startTimestamp)`). If you forget this, a second pause will calculate elapsed time incorrectly and segments will fire at the wrong times.

### SCORM `finish()` — idempotency

**Why**: `beforeunload`, `pagehide`, and `visibilitychange` are all bound to handlers that may call `finish()`. The `SCORM.finished` flag ensures `LMSFinish` is only called once.

**Invariant**: `finish()` must remain idempotent. Never remove the `if (SCORM.finished) return true` guard.

---

## Extension Points

### How to add a new scene

1. **Add content** to `js/content.js` in the `screens` array:
   ```js
   {
     id: 'new-scene',
     scene_number: 8,
     title: 'العنوان',
     narration: [{ time: 0, text: '...' }, ...],
     assessment: { question: '...', options: [...], correct_index: 1, ... },
     spec: { ... 15-item production spec ... }
   }
   ```

2. **Write a renderer** in `js/app.js`:
   ```js
   function renderNewScene(scene) {
     document.body.classList.add('cinematic');
     const stage = $stage();
     stage.style.opacity = '1';
     // ... build HTML, animation timeline, narration ...
   }
   ```

3. **Register it** in the `SCENE_RENDERERS` map:
   ```js
   var SCENE_RENDERERS = {
     opening: renderOpening,
     // ...
     'new-scene': renderNewScene,  // add this line
   };
   ```

4. **Update `normalizeSceneState()`** if the scene has non-standard state (like dilemma's `phaseAnswers`).

That's it. No other files need changes.

### How to add professional narration

1. Record each narration segment as a separate MP3 file.
2. Place files in `audio/<sceneId>/seg-<index>.mp3` (0-indexed).
3. Add entries to `CONTENT.audio.narration` in `content.js`:
   ```js
   audio: {
     narration: {
       'opening': {
         '0': 'audio/opening/seg-0.mp3',
         '1': 'audio/opening/seg-1.mp3',
         // ...
       },
       'boardroom': { ... },
     }
   }
   ```
4. Add the audio files to `imsmanifest.xml` `<file>` list and `scripts/build-scorm.sh` `MANIFEST_FILES` array.

No code changes. `NarrationManager` automatically uses `AudioProvider` when a manifest entry exists, falling back to TTS for missing segments.

### How to add a new narration provider

1. Create a provider module that implements the provider interface:
   ```js
   const MyProvider = {
     init() { ... },
     isAvailable() { return true; },
     speak(text, audioUrl) { ... return true; },
     cancel() { ... },
     setMuted(m) { ... },
     setRate(r) { ... },
     isSpeaking() { return false; },
     getName() { return 'my-provider'; },
     onStateChange(cb) { ... },
   };
   ```

2. Register it in `app.js init()`:
   ```js
   NarrationManager.registerProvider(MyProvider);
   ```

Priority is registration order. Place higher-priority providers first.

### How to create a release

1. Update `CONTENT.course.version` in `content.js` (semantic version).
2. Update `CONTENT.course.version_label` (Arabic display string).
3. Update `CHANGELOG.md` with the new version section.
4. Run `./scripts/test.sh` — all tests must pass.
5. Run `./scripts/build-scorm.sh` — produces `dist/elhokma-governance-scorm.zip`.
6. Tag the release: `git tag v1.0.0 && git push origin v1.0.0`.
7. Distribute the ZIP to LMS administrators.

---

## Testing Strategy

**Unit tests** (`tests/`) cover the three modules where bugs are most damaging:
- `scoring.test.js` — score computation, partial credit, edge cases
- `version.test.js` — version stamping, stale detection, semver comparison
- `scorm-api.test.js` — standalone mode, persistence, corrupt data, idempotency

These modules were chosen because:
1. They have pure logic (no DOM coupling) — testable without a browser
2. Bugs here are silent (wrong score, lost progress, broken audit trail)
3. They're the modules most likely to be modified when business rules change

**What is NOT unit-tested (and why)**:
- `narrator.js`, `modal-manager.js`, `animator.js` — DOM-coupled, better tested via the smoke test
- Scene renderers in `app.js` — integration-level, verified by the Playwright smoke test in CI
- `tts.js`, `audio-provider.js` — depend on browser APIs (Web Speech, HTMLAudio) that can't be meaningfully mocked

**CI pipeline** (`.github/workflows/ci.yml`):
1. JS syntax check (all files)
2. Unit tests (`./scripts/test.sh`)
3. JSON + HTML validation
4. Forbidden pattern check (no eval, no inline handlers)
5. File reference check (all `<script src>` files exist)
6. Playwright smoke test (load, navigate, modal focus, aria-hidden, SCORM, modules)

---

## Known Limitations

1. **Arabic TTS unavailable on most devices.** Web Speech API Arabic voices are rare on desktop browsers. The product gracefully falls back to subtitle-only mode. Professional audio narration (MP3) is the production solution — infrastructure is built, recording is a content task.

2. **No real LMS testing.** SCORM manifest is valid and packaging works, but the product has only been tested in standalone mode (localStorage fallback). Real LMS testing requires access to Moodle, Blackboard, Canvas, or SCORM Cloud.

3. **Single course only.** The architecture supports one course. Multi-course support (Chapter 2+) requires extracting the rendering engine into a reusable library — do not build this until Chapter 2 is commissioned.

4. **Content is code.** `content.js` is 1000+ lines of JavaScript. Content authors need a developer to make changes. A visual content editor is Phase 3 roadmap, not V1.0.

5. **No analytics.** The LMS gradebook shows pass/fail + score, but there's no visibility into *which questions* were missed or *where* learners spend time. xAPI analytics is Phase 2 roadmap.

---

## Maintenance Expectations

**Routine (every content update)**:
- Bump `CONTENT.course.version` in `content.js`
- Update `CHANGELOG.md`
- Run `./scripts/test.sh && ./scripts/build-scorm.sh`
- Test the ZIP in at least one LMS before distribution

**Annual (or when browsers change)**:
- Test in current Chrome, Firefox, Safari, Edge
- Verify Google Fonts CDN is still accessible (or self-host fonts)
- Check if Web Speech API Arabic voice availability has improved
- Review `sw.js` cache version — bump `CACHE_VERSION` if the SW needs to be invalidated

**When modifying core modules**:
- `scoring.js` — run `node tests/scoring.test.js` before and after
- `version.js` — run `node tests/version.test.js` before and after
- `scorm-api.js` — run `node tests/scorm-api.test.js` before and after
- `narrator.js` — manually test pause/resume/skip/replay in a browser
- `modal-manager.js` — manually verify focus trap + aria-hidden preservation

---

## Debugging Common Problems

| Symptom | Likely cause | Fix |
|---------|-------------|-----|
| Blank stage after scene transition | Renderer threw an error | Check console; ErrorBoundary should show recovery UI. Look for `TypeError` in the renderer. |
| Score not updating in LMS | `commit()` is debounced (600ms) | Call `commitNow()` for immediate flush, or wait 1 second |
| Learner progress lost on iOS | `pagehide` called `finish()` on bfcache | Verify `event.persisted` check is present in `handleUnload` |
| Modal focus escapes | `aria-hidden` corruption | Check ModalManager only sets aria-hidden on elements without it |
| Audio doesn't play | Autoplay policy or missing manifest | Verify user clicked "activate" button; check `CONTENT.audio.narration` has the scene+segment |
| Arabic TTS silent | No Arabic voice installed | Expected on most desktops; subtitles are the fallback. Install an Arabic voice in OS settings. |
| SCORM import fails | Missing file in manifest | Run `./scripts/build-scorm.sh` and verify all 20 JS files are in the ZIP |
