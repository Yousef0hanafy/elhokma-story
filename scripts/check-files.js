#!/usr/bin/env node
/**
 * Packaging consistency check.
 *
 * The list of runtime files lives in three places that must agree:
 *   - imsmanifest.xml   (what the LMS is told the package contains)
 *   - build-scorm.sh    (what actually goes into the ZIP)
 *   - sw.js APP_SHELL   (what the offline cache precaches)
 * Every local file index.html loads (scripts, stylesheets, icons) and every
 * font file css/fonts.css references must be listed in all three, and must
 * exist. A file missing from one list is a broken LMS import or a broken
 * offline start — this fails CI instead.
 */
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const read = f => fs.readFileSync(path.join(root, f), 'utf8');
const errors = [];

const html = read('index.html');
const required = new Set(['index.html']);
for (const m of html.matchAll(/(?:src|href)="([^"#]+)"/g)) {
  const ref = m[1];
  if (/^(https?:)?\/\//.test(ref) || ref.startsWith('data:') || ref.startsWith('mailto:')) continue;
  required.add(ref.replace(/^\.\//, ''));
}
if (fs.existsSync(path.join(root, 'css/fonts.css'))) {
  for (const m of read('css/fonts.css').matchAll(/url\(['"]?([^'")]+)['"]?\)/g)) {
    required.add(path.posix.join('css', m[1]));
  }
}

const manifest = new Set([...read('imsmanifest.xml').matchAll(/<file href="([^"]+)"/g)].map(m => m[1]));
const buildBlock = read('scripts/build-scorm.sh').match(/MANIFEST_FILES=\(([\s\S]*?)\)/);
const build = new Set(buildBlock ? [...buildBlock[1].matchAll(/"([^"]+)"/g)].map(m => m[1]) : []);
const shellBlock = read('sw.js').match(/APP_SHELL = \[([\s\S]*?)\];/);
const shell = new Set(shellBlock ? [...shellBlock[1].matchAll(/'([^']+)'/g)].map(m => m[1].replace(/^\.\//, '')) : []);

for (const f of required) {
  const normalized = path.posix.normalize(f);
  if (!fs.existsSync(path.join(root, normalized))) errors.push(`missing on disk: ${normalized}`);
  if (!manifest.has(normalized)) errors.push(`not in imsmanifest.xml: ${normalized}`);
  if (!build.has(normalized)) errors.push(`not in build-scorm.sh: ${normalized}`);
  if (!shell.has(normalized)) errors.push(`not in sw.js APP_SHELL: ${normalized}`);
}
for (const f of new Set([...manifest, ...build])) {
  if (!fs.existsSync(path.join(root, f))) errors.push(`listed but missing on disk: ${f}`);
}

// Narration audio: every file the manifest in content.js points to must
// exist and ship in the SCORM package (it is fetched on demand, so it is not
// in the offline APP_SHELL).
global.window = global;
require(path.join(root, 'js/content.js'));
const narration = (global.window.STORY_CONTENT.audio || {}).narration || {};
const audioFiles = Object.values(narration).flatMap(scene => Object.values(scene));
if (audioFiles.length) audioFiles.push('audio/silence.mp3');
for (const f of audioFiles) {
  if (!fs.existsSync(path.join(root, f))) errors.push(`narration file missing on disk: ${f}`);
  if (!manifest.has(f)) errors.push(`narration file not in imsmanifest.xml: ${f}`);
  if (!build.has(f)) errors.push(`narration file not in build-scorm.sh: ${f}`);
}

if (errors.length) {
  console.error('Packaging check failed:\n  ' + errors.join('\n  '));
  process.exit(1);
}
console.log(`✓ ${required.size} runtime files listed consistently in imsmanifest.xml, build-scorm.sh and sw.js; ${audioFiles.length} narration audio files packaged`);
