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
- **No `eval`, no `Function()` constructor, no inline event handlers** in committed code (enforced by ESLint and a CI grep).
- **Content Security Policy.** `index.html` ships a CSP meta tag: `script-src 'self'`, `font-src 'self'`, no third-party origins.
- **No external requests.** Fonts (Tajawal, Cairo, Amiri, SIL OFL — see `fonts/OFL.txt`) are self-hosted. No runtime JS dependencies.

## Known limitations

- The module is designed to run inside an LMS iframe. It cannot defend against a compromised host page — that is the LMS's responsibility.
- localStorage (used in standalone mode) is per-origin. Clearing browser data erases progress.
- **Scoring is client-side**, as in every SCORM 1.2 package: the browser computes the score and reports it to the LMS. A technically skilled learner could call the LMS API from devtools and set their own score. SCORM 1.2 offers no defence against this; if scores carry high stakes, pair the course with a proctored or server-side assessment.
