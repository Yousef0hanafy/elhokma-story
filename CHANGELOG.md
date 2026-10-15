# Changelog

All notable changes to this project are documented in this file.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [Unreleased]

### Fixed (mobile)
- The cinematic black bars were drawn over the topbar, hiding the scene menu and the audio buttons on every scene (and over drawers and dialogs). They now sit below the topbar and are dropped on phones.
- The opening title «رحلة الحوكمة» never appeared (it was typed into an invisible heading).
- The narrator portrait covered scene titles and content on phones; it now sits small beside the subtitles.
- The subtitle bar no longer covers the bottom of drawers and dialogs; toasts show above them.
- The review-mode banner showed through the topbar when not in review mode.
- Stacked pillars (scene 4) on phones: an opened pillar's points spilled outside its card.
- iPhone notch / home bar: topbar and subtitles respect the safe areas.

### Fixed (narration audio)
- A voice that finished loading after the audio card opened (common on phones) left the card saying "unavailable" forever. The card now shows a loading state and refreshes.
- Turning audio on now reads the sentence on screen immediately, inside the tap (iOS only allows speech started by a tap).
- Android engines that list no voices are asked for Arabic by language; if they cannot, the course says so and continues with subtitles.
- No `cancel()` right before `speak()` unless something is playing (Android could drop the new sentence); a watchdog stops the narration from stalling when an engine never reports the end of a sentence.
- When no Arabic voice exists, the card tells Android / iPhone users where to add one.

### Added
- Recorded Arabic narration (`audio/`, 57 MP3 files, ~1.3 MB) so the course speaks on every phone, including ones without an Arabic voice. The device voice is only a fallback for a missing file. The current voice is a free placeholder (CC BY-NC-SA, non-commercial); replace it before commercial use (see `audio/LICENSE.txt`).
- `scripts/generate-narration.py` regenerates the MP3s and the file lists from `content.js`.

### Fixed (round 2)
- Audio playback on iPhone: one `<audio>` element is unlocked by the first tap and reused, so later segments are not blocked by autoplay rules.
- The service worker no longer intercepts MP3 / range requests (Safari needs real range responses to play audio).
- Grammar: «ويُبنى الثقة» → «وتُبنى الثقة».
- Phones: seat and star labels were ~5px on screen; they are now readable. Toasts show as a slim banner under the topbar instead of covering seats and feedback. Header buttons are 40px on touch screens.
- `npm run check:files` verifies every narration file exists and is packaged.

### Changed
- Service worker cache bumped to `elhokma-v5` so installed copies pick up the new files.

## [1.1.0] — 2026-10-12

### Fixed (critical)
- A perfect run now scores 100 (the opening scene no longer counts in the denominator).
- Alt+Arrow shortcuts can no longer skip an unfinished scene; every navigation goes through one gate.
- `cmi.core.exit` is `suspend` while in progress, so LMSs keep progress for resume; `lesson_location` is set.
- Completion date and score are recorded once, on finishing; reviewing or reopening no longer re-stamps them.
- Review mode no longer leaks into new scenes; resuming an answered scene always offers a way forward.
- Timers from a scene the learner left can no longer fire.
- `lesson_status` is never downgraded (e.g. restarting after passing).
- LMS errors from `LMSSetValue`/`LMSCommit` are now checked and logged.

### Changed
- Scoring policy: first attempt counts (`scoring_policy` in `content.js`; `best_attempt` is available).
- Correct answers are no longer always in the same position.
- Restart uses an in-page confirm dialog instead of the browser's `confirm()`.
- Keyboard: Alt+← = next, Alt+→ = previous (RTL).
- Narration waits for each sentence to finish; pause/resume replays the current sentence; mute and speed persist; the audio card says clearly when no Arabic voice exists.
- Fonts are self-hosted (no Google requests); CSP `font-src 'self'`.
- The service worker registers only in standalone mode, not inside an LMS.
- Removed the 2-hour forced exit from `imsmanifest.xml`; `masteryscore` moved to the schema-correct position.
- Modals and drawers use `inert` for accessibility.

### Added
- ESLint, html-validate, file-list consistency check.
- End-to-end tests against a strict mock SCORM 1.2 LMS; CI builds the SCORM ZIP.

## [1.0.0] — 2025-07-23

### Version 1.0 Release

This release represents the complete, production-ready Version 1.0 of رحلة الحوكمة (Governance Journey) — a single-course SCORM 1.2 e-learning module covering healthcare governance and compliance in Arabic.

### Critical (Engineering Foundation)
- **SCORM memory leak fixed.** `setInterval` for session-time tracking is now stored and cleared on `finish()`. Previously it ran forever, even after the lesson ended.
- **Mobile unload handling.** Added `pagehide` + `visibilitychange` handlers alongside `beforeunload` (mobile Safari and Chrome iOS frequently skip `beforeunload`). `finish()` is now idempotent so the triple-binding is safe. bfcache (`event.persisted`) is respected — pagehide no longer terminates the SCORM session when the page enters the back-forward cache.
- **Debounced LMSCommit.** Burst `setSuspendData()` calls (e.g. during rapid seat exploration) now collapse into a single `LMSCommit` round-trip. Reduces LMS load and avoids SCORM "commit quota" errors.
- **LMS call hardening.** Every `LMSGetValue` / `LMSSetValue` / `LMSCommit` / `LMSFinish` call is wrapped in try/catch. A misbehaving LMS can no longer break the learner's experience. If `LMSInitialize` fails, falls back to standalone mode.
- **Global error boundary.** New `js/error-boundary.js` catches uncaught errors and unhandled promise rejections. Scene renderers are wrapped in `ErrorBoundary.guard()` so a throw in any scene shows a recovery UI (reload button) instead of leaving the stage blank. Self-installs on load; 15-second loader timeout shows recovery UI if scripts fail.
- **XSS hardening.** All content-derived interpolations in `app.js` template literals are now escaped via `escapeHtml()`.
- **Content Security Policy.** Strict CSP meta tag: `script-src 'self'` (no inline scripts, no eval), `style-src 'self' 'unsafe-inline'` (for JS-driven transitions + Google Fonts), `font-src` restricted to self + Google Fonts CDN.
- **Modal focus trap.** `js/modal-manager.js` centralizes modal lifecycle: focus moves into the modal on open, is trapped (Tab cycles within), and is restored to the trigger element on close. `aria-hidden` is preserved on pre-hidden elements (loader, letterbox) — no longer corrupted by modal open/close.

### High (Architecture)
- **Scoring module** (`js/scoring.js`): single source of truth for SCORM score computation. Previously duplicated in 5 places. Supports partial credit for dilemma scenes.
- **Version module** (`js/version.js`): course versioning and completion-record tracking. Stamps `{version, date, score}` on completion; detects stale completions for audit compliance.
- **Scene registry**: replaces if/else dispatch chain with a `SCENE_RENDERERS` map. Adding a scene is now one entry.
- **Unified state model**: boardroom migrated from legacy top-level state to `sceneState[idx]` pattern matching all other scenes. Backward-compatible migration for existing learner progress.
- **Narration infrastructure** (`js/narration-manager.js` + `js/audio-provider.js` + `js/tts-provider.js`): provider-agnostic narration abstraction. Priority: 1) professional MP3 audio, 2) browser TTS, 3) subtitle-only. Automatic fallback. Audio manifest in `content.js` — adding professional narration is a content operation, not a code change.

### High (Product)
- **SCORM manifest** (`imsmanifest.xml`): valid SCORM 1.2 manifest with course ID, mastery score (70%), time limits. Without this, no LMS could import the package.
- **SCORM packaging** (`scripts/build-scorm.sh`): one-command build produces import-ready ZIP. Validates all files + manifest XML.
- **Completion screen**: full-screen completion UI with pass/fail seal, final score, learner name, date, content version, and printable certificate. "مراجعة المحتوى" button enters Review Mode.
- **Learning Hub**: knowledge center drawer with auto-extracted glossary (18 governance terms) and quick navigation to completed scenes. Adding concepts to `content.js` automatically adds them to the hub.
- **Review Mode**: revisit completed scenes without affecting SCORM score, completion status, or assessment history. Clear teal banner distinguishes Training Mode from Review Mode.
- **Progress display**: scene drawer shows current score, completion percentage, and progress bar.
- **Keyboard navigation**: Alt+ArrowLeft / Alt+ArrowRight navigate between scenes. Skip link, focus traps, Escape to close drawers.
- **Pause control**: new ⏸ button in subtitle bar pauses/resumes narration mid-segment.

### Medium (Testing & Reliability)
- **Unit test infrastructure** (`tests/`): 37 tests covering Scoring, Version, and SCORM API modules. Zero dependencies (Node built-in). CI runs tests on every PR.
- **Resume fix**: returning to a completed scene via the drawer no longer resets exploration state.
- **Service worker**: network-first for HTML/JS (no stale content after deploys), cache-first for static assets. SW_UPDATED message prompts refresh.
- **PWA**: installable via manifest, offline-capable via service worker.

### Documentation
- README updated with complete architecture (all 13 JS modules documented)
- DEPLOY.md: comprehensive LMS deployment guide with troubleshooting
- CONTRIBUTING.md, SECURITY.md, LICENSE (MIT)

## [0.2.0] — 2025-07-22

### High
- **SEO meta tags.** Added `<meta name="description">`, Open Graph, Twitter Card, canonical URL, robots. Updated `<title>` for clarity.
- **Favicon.** Added `favicon.svg` (scales to all sizes; no PNG bloat).
- **PWA manifest.** `manifest.webmanifest` for installability + standalone display.
- **Service worker.** `sw.js` provides offline-first caching of the app shell. README's "works offline" claim is now actually true.
- **Non-blocking fonts.** Google Fonts stylesheet now loads via `rel="preload" onload="this.rel='stylesheet'"` with a `<noscript>` fallback. First paint is no longer blocked on the font CDN.
- **Accessibility — skip link.** First focusable element is a "تخطّي إلى المحتوى" link, visible on keyboard focus only.
- **Accessibility — focus trap.** New `js/modal-manager.js` centralizes modal lifecycle: focus moves into the modal on open, is trapped (Tab cycles within), and is restored to the trigger element on close. Three seat/layer/star modals refactored to use it.
- **Accessibility — `aria-hidden` management.** When a modal opens, the rest of the page gets `aria-hidden="true"` so screen readers don't read background content.
- **Accessibility — broader `:focus-visible`.** Now covers `[tabindex]`, `.dilemma-option`, `.court-btn` in addition to the previous button/seat/assessment-option.
- **`prefers-reduced-motion`.** Now also sets `animation-iteration-count: 1` so infinite animations (e.g. loader pulse) stop.
- **LICENSE.** Added MIT license file (was missing).
- **CONTRIBUTING.md, SECURITY.md.** Added.

### Medium
- **`.gitignore`** expanded (editor swap files, `.env*`, build output, SCORM test zips).
- **README** updated to reflect new files and capabilities.

## [0.2.0] — 2025-07-22

- All 7 scenes implemented (opening, boardroom, framework, pillars, court, integrity, dilemma).
- Arabic TTS via Web Speech API with user-gesture activation flow.
- Scene navigation drawer with progress tracking.
- MCQ retry, viewport scroll fixes, Arabic TTS activation improvements.

## [0.1.0] — Initial prototype

- Premium Arabic story-based e-learning prototype.
- Opening scene + boardroom scene with SCORM 1.2 wrapper.
