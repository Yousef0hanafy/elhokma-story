# Deployment Guide — رحلة الحوكمة

This guide covers deploying the e-learning module to an LMS or as a standalone web page.

---

## Option 1: Deploy as a SCORM Package (Recommended)

This is the standard deployment for LMS environments (Moodle, Blackboard,
Canvas, SCORM Cloud, Cornerstone, etc.).

### Prerequisites
- `zip` command-line utility (pre-installed on macOS/Linux; on Windows use Git Bash or WSL)
- `python3` (for manifest validation only — not needed at runtime)

### Build the package

```bash
./scripts/build-scorm.sh
```

This produces `dist/elhokma-governance-scorm.zip` — a SCORM 1.2-compliant
package with `imsmanifest.xml` at the root.

### Import into your LMS

1. Log in to your LMS as an administrator or course creator.
2. Create a new course (or open an existing one).
3. Add a new activity → select "SCORM package" (the exact name varies by LMS).
4. Upload `dist/elhokma-governance-scorm.zip`.
5. Configure:
   - **SCORM version**: 1.2
   - **Grading method**: Highest score, Average score, or First attempt (per your policy)
   - **Attempts**: Unlimited (recommended — learners can retake to improve)
   - **Display**: In a new window (recommended for full-screen experience)
6. Save and test.

### SCORM data mapping

| SCORM field | Value |
|-------------|-------|
| `cmi.core.lesson_status` | `incomplete` on first launch → `passed` / `failed` on finishing (never downgraded) |
| `cmi.core.score.raw` | 0–100. Six scored scenes, 100/6 each; the dilemma gives partial credit. First attempt counts (`scoring_policy` in `content.js`). |
| `cmi.core.score.min` | 0 |
| `cmi.core.score.max` | 100 |
| `cmi.core.session_time` | HH:MM:SS (updated every 60s + on unload) |
| `cmi.suspend_data` | JSON: currentScreen, sceneScores, sceneState, completion record (≤ 4096 chars) |
| `cmi.core.lesson_location` | `scene-N` bookmark |
| `cmi.core.exit` | `suspend` while in progress (so the LMS keeps suspend_data), `''` once finished |
| `cmi.core.student_name` | Read from LMS (displayed on completion screen) |

**Mastery score**: 70 (configured in `imsmanifest.xml`). The LMS will mark
the activity as `passed` if the learner's score ≥ 70, otherwise `failed`.

### Offline / standalone mode

If the module is opened outside an LMS (no SCORM API detected), it
automatically falls back to `localStorage` for progress tracking. The
learner's progress persists in their browser but is NOT reported to any
LMS. This mode is for preview/demo only.

---

## Option 2: Deploy as a Standalone Web Page

For scenarios where SCORM tracking is not needed (e.g., public preview,
internal training without an LMS).

### Requirements
- Any static web server (nginx, Apache, GitHub Pages, Netlify, Vercel)

### Steps
1. Upload all files to the web server root:
   ```
   index.html
   favicon.svg
   manifest.webmanifest
   sw.js
   css/
   fonts/
   js/
   ```
2. Ensure the server sets correct MIME types:
   - `.webmanifest` → `application/manifest+json`
   - `.svg` → `image/svg+xml`
   - `.js` → `application/javascript` (NOT `text/javascript` on some servers)
3. The service worker (`sw.js`) enables offline use after first load. It is
   registered only in standalone mode, never inside an LMS.
4. Progress is saved to `localStorage` (per-browser, per-origin).

### Browser compatibility

| Browser | Minimum version | Notes |
|---------|----------------|-------|
| Chrome | 90+ | Full support (TTS, SW, CSP) |
| Firefox | 88+ | Full support |
| Safari | 14+ | Full support (TTS voice may differ) |
| Edge | 90+ | Full support (Chromium-based) |
| Mobile Safari | iOS 14+ | bfcache handled; TTS requires user gesture |
| Mobile Chrome | 90+ | Full support |

**Known limitations:**
- Arabic TTS requires an Arabic voice installed on the system. Most desktop
  browsers do not include one by default. The module gracefully falls back
  to subtitle-only mode if no Arabic voice is available.
- The module does not impose a time limit. If your organisation needs one,
  configure it in the LMS, not in the package.

---

## Verification Checklist

Before going live, verify:

- [ ] `./scripts/build-scorm.sh` produces a ZIP with no errors
- [ ] ZIP contains `imsmanifest.xml` at the root (not in a subdirectory)
- [ ] Import into a test LMS course succeeds
- [ ] Learner can navigate all 7 scenes without errors
- [ ] Score is reported to the LMS gradebook after completion
- [ ] Completion screen appears after the last scene
- [ ] Print certificate produces a readable PDF/printout
- [ ] Reloading mid-course resumes at the correct scene
- [ ] Alt+ArrowLeft (next) / Alt+ArrowRight (previous) work, and cannot skip an unfinished scene
- [ ] Closing mid-course and relaunching resumes at the same scene (LMS kept suspend_data)
- [ ] No JavaScript errors in the browser console (except expected TTS "no Arabic voice" info)

---

## Troubleshooting

### "No SCORM API found" in console
This is expected in standalone mode. The module will use `localStorage`
instead. If you see this in an LMS, the iframe may not have access to the
parent window's API. Check your LMS's SCORM iframe settings.

### Score not updating in the LMS
The module debounces `LMSCommit` calls (600ms) to avoid overwhelming the
LMS. The final score is committed immediately on completion. If the score
still doesn't appear, check that your LMS supports `cmi.core.score.raw`
(some older LMS versions only support `cmi.core.lesson_location`).

### Learner progress lost on reload
The module saves to `cmi.suspend_data` on every state change. If progress
is lost, the LMS may have a `suspend_data` size limit (SCORM 1.2 spec
allows 4096 bytes; our data is typically <1000 bytes). Check the LMS logs
for "suspend_data too large" errors.

### Arabic voice not available
The module detects available TTS voices and falls back to subtitle-only
mode if no Arabic voice is found. To enable Arabic TTS:
- **macOS**: System Preferences → Accessibility → Speech → System Voice →
  select an Arabic voice (e.g., "Maged")
- **Windows**: Settings → Time & Language → Speech → Add voices → Arabic
- **Chrome OS**: Settings → Manage accessibility features → Text-to-speech
  → select an Arabic voice
