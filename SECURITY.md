# Security Policy

## Supported versions

This is a front-end-only e-learning module. The latest `main` branch is the only supported version.

## Reporting a vulnerability

Please report security issues privately by emailing the maintainer at the address listed in the GitHub profile. Do **not** open a public issue for security concerns.

Include in your report:
- A clear description of the issue and its impact.
- Steps to reproduce (POC if possible).
- Affected file(s) and line(s).
- Suggested fix, if you have one.

You will receive an acknowledgement within 72 hours.

## Security posture

- **No backend, no database, no server-side code.** The module runs entirely in the browser.
- **SCORM 1.2 communication** is the only external surface. The wrapper (`js/scorm-api.js`) treats all LMS responses as untrusted strings and wraps every API call in try/catch so a misbehaving LMS cannot break the learner's experience.
- **Content escaping.** All dynamic content injected via `innerHTML` is escaped via `escapeHtml()`. The learner-facing content itself comes from `js/content.js` (trusted, developer-authored), but escaping is applied as defense-in-depth.
- **No `eval`, no `Function()` constructor, no inline event handlers** in committed code (one exception: the font-loading `onload` attribute in `index.html`, which is a standard pattern and contains no user input).
- **CSP-friendly.** The page does not use inline scripts that execute user-controlled data. (A strict CSP can be added at deployment time by the LMS host if needed.)
- **Dependencies.** The only external resources are Google Fonts (Tajawal, Cairo, Amiri) loaded via CDN with `preconnect`. No JS dependencies. The page has system-font fallbacks in CSS so it remains fully usable if fonts are blocked.

## Known limitations

- The module is designed to run inside an LMS iframe. It cannot defend against a compromised host page — that is the LMS's responsibility.
- localStorage (used in standalone mode) is per-origin. Clearing browser data erases progress.
