# Contributing to رحلة الحوكمة

شكراً لاهتمامك بالمشاركة في تطوير هذا المشروع. هذه الإرشادات تساعدنا على الحفاظ على جودة الكود وتجربة المتعلم.

## Getting Started

1. Fork the repository and clone your fork.
2. Open `index.html` directly in a browser — no build step required.
3. For dev mode (production notes drawer), append `?dev=1` to the URL.

## Architecture (quick map)

- `index.html` — single-page entry point. Loads scripts in order; the order matters (`error-boundary` → `scorm-api` → `tts` → `content` → `narrator` → `animator` → `modal-manager` → `app`).
- `js/content.js` — all learner-facing content + production specs. **Editing content does not require touching any other file.**
- `js/app.js` — scene renderers + state machine. One `render<Scene>()` function per scene.
- `js/scorm-api.js` — SCORM 1.2 wrapper with localStorage fallback.
- `js/tts.js` — Web Speech API wrapper for Arabic narration.
- `js/narrator.js` — timed narration + typewriter subtitles.
- `js/animator.js` — setTimeout-based timeline orchestrator.
- `js/modal-manager.js` — focus-trapped modal lifecycle (use for any new modal).
- `js/error-boundary.js` — global error catcher + recovery UI.

## Adding a new scene

1. Add a screen object to `STORY_CONTENT.screens` in `js/content.js`. Include `id`, `scene_number`, `title`, `narration`, and a `spec` block (15-item production design spec).
2. Add a `render<SceneId>()` function in `js/app.js`.
3. Add the dispatch case in `renderScene()`'s `dispatch()` function.
4. Add an `isSceneCompleted()` branch if the completion logic differs from the default.

## Code style

- Vanilla JS only — no framework, no bundler. This is intentional for SCORM compatibility.
- 2-space indentation. Single quotes for strings. Semicolons required.
- All user-facing strings in Arabic. Code comments in English (with Arabic where the concept is content-specific).
- Escape all dynamic content via `escapeHtml()` before injecting into `innerHTML`. Use `ModalManager.open()` for any modal.
- No `console.log` in committed code — use `console.info` / `console.warn` / `console.error` with a `[Module]` prefix.

## Commit messages

Follow the conventional-commit pattern:

```
<type>: <imperative summary>

<optional body explaining why, not what>
```

Types: `Critical`, `High`, `Medium`, `Low`, `Fix`, `Add`, `Refactor`, `Docs`, `Chore`.

## Testing

Run everything CI runs before opening a PR (Node 22+):

```bash
npm ci
npm test            # lint + unit + end-to-end
```

- `npm run lint` runs ESLint, html-validate, and `check:files` (every file the
  page loads must be listed in `imsmanifest.xml`, `scripts/build-scorm.sh`
  and the `sw.js` app shell).
- `npm run test:unit` runs the pure-logic tests in `tests/*.test.js`.
- `npm run test:e2e` drives the whole course in Chromium against a strict
  mock SCORM 1.2 LMS (`tests/e2e/mock-lms.js`). Set
  `PLAYWRIGHT_CHROMIUM_PATH` to use a local Chromium, or run
  `npx playwright install chromium` once.

Still worth a manual pass for UI changes: keyboard-only navigation, reduced
motion, and a 390px-wide mobile viewport.

## Rules that keep the course correct

- **Navigate only through `goToScene(idx, opts)`.** It enforces gating
  (a scene unlocks when the previous one is completed) and review mode.
  Never call `renderScene()` directly from UI code.
- **Schedule scene timers with `later(ms, fn)`** (i.e. `Animator.delay`),
  never raw `setTimeout`. `renderScene()` cancels them, so a callback from
  a scene the learner already left can never fire.
- **`finishCourse()` records completion; `showCompletionScreen()` only
  displays it.** Displaying the completion screen must never re-stamp the
  date or score.
- **Scoring follows `CONTENT.course.scoring_policy`** (`first_attempt` by
  default). Retries are for learning; they do not change the recorded score.
- Keyboard shortcuts are RTL-aware: **Alt+← = next, Alt+→ = previous**.

## Reporting security issues

See `SECURITY.md`.
