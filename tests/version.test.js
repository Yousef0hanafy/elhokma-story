/**
 * Unit tests for the Version module.
 *
 * Version handles course versioning and completion-record tracking.
 * These tests verify:
 *   - Version reading from STORY_CONTENT
 *   - Completion stamping
 *   - Stale version detection
 *   - Semver comparison
 */
const { test, assert, assertEqual, run, loadModule } = require('./harness');

const mockContent = {
  course: {
    title: 'Test Course',
    version: '1.2.3',
    version_label: 'إصدار ١.٢.٣',
    passing_score: 70,
  },
};

const win = loadModule('js/version.js', { content: mockContent });
const Version = win.Version;

test('Version module loads', () => {
  assert(Version, 'Version should be defined');
});

test('current() reads from STORY_CONTENT.course.version', () => {
  assertEqual(Version.current(), '1.2.3', 'should read version from content');
});

test('label() reads from STORY_CONTENT.course.version_label', () => {
  assertEqual(Version.label(), 'إصدار ١.٢.٣', 'should read label from content');
});

test('getCompletion() returns null when no completion recorded', () => {
  // Fresh app state with no completion
  const w2 = loadModule('js/version.js', { content: mockContent, appState: {} });
  assertEqual(w2.Version.getCompletion(), null, 'no completion = null');
});

test('stampCompletion() records version + date + score', () => {
  const appState = {};
  const w2 = loadModule('js/version.js', { content: mockContent, appState });
  w2.Version.stampCompletion(85);
  const c = w2.Version.getCompletion();
  assert(c, 'completion should exist');
  assertEqual(c.version, '1.2.3', 'version stamped');
  assertEqual(c.score, 85, 'score stamped');
  assert(typeof c.date === 'string', 'date should be ISO string');
});

test('isStale() returns false when no completion exists', () => {
  const w2 = loadModule('js/version.js', { content: mockContent, appState: {} });
  assertEqual(w2.Version.isStale(), false, 'no completion = not stale');
});

test('isStale() returns false when completion version matches current', () => {
  const appState = { completion: { version: '1.2.3', date: '2024-01-01', score: 80 } };
  const w2 = loadModule('js/version.js', { content: mockContent, appState });
  assertEqual(w2.Version.isStale(), false, 'same version = not stale');
});

test('isStale() returns true when completion version is older', () => {
  const appState = { completion: { version: '1.0.0', date: '2024-01-01', score: 80 } };
  const w2 = loadModule('js/version.js', { content: mockContent, appState });
  assertEqual(w2.Version.isStale(), true, 'older version = stale');
});

test('isStale() returns false when completion version is newer', () => {
  const appState = { completion: { version: '2.0.0', date: '2024-01-01', score: 80 } };
  const w2 = loadModule('js/version.js', { content: mockContent, appState });
  assertEqual(w2.Version.isStale(), false, 'newer version = not stale');
});

test('compareVersions() handles semver correctly', () => {
  assertEqual(Version.compareVersions('1.0.0', '1.0.0'), 0, 'equal versions');
  assertEqual(Version.compareVersions('1.0.0', '2.0.0'), -1, '1.0.0 < 2.0.0');
  assertEqual(Version.compareVersions('2.0.0', '1.0.0'), 1, '2.0.0 > 1.0.0');
  assertEqual(Version.compareVersions('1.0.0', '1.0.1'), -1, 'patch difference');
  assertEqual(Version.compareVersions('1.0.0', '1.1.0'), -1, 'minor difference');
  assertEqual(Version.compareVersions('1.10.0', '1.9.0'), 1, 'double-digit version');
});

test('compareVersions() handles missing versions', () => {
  assertEqual(Version.compareVersions(null, '1.0.0'), -1, 'null < 1.0.0');
  assertEqual(Version.compareVersions('1.0.0', null), 1, '1.0.0 > null');
  assertEqual(Version.compareVersions(null, null), 0, 'null == null');
});

test('Fallback when content has no version', () => {
  const w2 = loadModule('js/version.js', { content: { course: {} } });
  assertEqual(w2.Version.current(), '0.0.0', 'missing version = 0.0.0');
});

run();
