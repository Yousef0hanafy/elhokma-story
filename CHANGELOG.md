# Changelog

All notable changes to this project are documented in this file.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [Unreleased] — Production Upgrade

### Critical
- **SCORM memory leak fixed.** `setInterval` for session-time tracking is now stored and cleared on `finish()`. Previously it ran forever, even after the lesson ended.
- **Mobile unload handling.** Added `pagehide` + `visibilitychange` handlers alongside `beforeunload` (mobile Safari and Chrome iOS frequently skip `beforeunload`). `finish()` is now idempotent so the triple-binding is safe.
- **Debounced LMSCommit.** Burst `setSuspendData()` calls (e.g. during rapid seat exploration) now collapse into a single `LMSCommit` round-trip. Reduces LMS load and avoids SCORM "commit quota" errors.
- **LMS call hardening.** Every `LMSGetValue` / `LMSSetValue` / `LMSCommit` / `LMSFinish` call is wrapped in try/catch. A misbehaving LMS can no longer break the learner's experience.
- **Global error boundary.** New `js/error-boundary.js` catches uncaught errors and unhandled promise rejections. Scene renderers are wrapped in `ErrorBoundary.guard()` so a throw in any scene shows a recovery UI (reload button) instead of leaving the stage blank.
- **XSS hardening.** All content-derived interpolations in `app.js` template literals are now escaped via `escapeHtml()` (eyebrow, title, instruction, assessment question/options/feedback, pillar labels/subtitles/questions/facets, story, definition). Defense-in-depth for future content changes.

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
