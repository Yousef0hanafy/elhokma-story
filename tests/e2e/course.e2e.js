/**
 * End-to-end tests: run the real course in Chromium against a mock LMS.
 *
 * These cover what the unit tests cannot: scene flow, gating, scoring as the
 * LMS sees it, resume after relaunch, review mode, and SCORM calls.
 *
 * Run:  npm run test:e2e
 * Uses PLAYWRIGHT_CHROMIUM_PATH if set (e.g. a preinstalled Chromium).
 */
const { chromium, devices } = require('playwright');
const { test, assert, assertEqual, run } = require('../harness');
const { start } = require('./server');
const { installMockLms } = require('./mock-lms');

let server, baseUrl, browser;

// A fake Arabic Web Speech voice whose every utterance takes `durationMs`.
// Logs start / end / cancel with timestamps to window.__speech.
// `opts` is the duration in ms, or { ms, voices, error }: `voices` replaces
// the voice list (e.g. [] for an engine that lists none) and `error` makes
// every utterance fail with that error code.
function installFakeSpeech(opts) {
  const { ms: durationMs, voices = [{ name: 'Test Arabic', lang: 'ar-SA' }], error = null, voicesAfterMs = 0 } =
    typeof opts === 'number' ? { ms: opts } : opts;
  const bootedAt = Date.now();
  const log = [];
  window.__speech = log;
  let timers = [];
  let queue = [];
  function next() {
    const u = queue.shift();
    if (!u) return;
    log.push({ type: 'start', text: u.text, lang: u.lang, t: Date.now() });
    if (error) {
      timers.push(setTimeout(() => { if (u.onerror) u.onerror({ error }); next(); }, 10));
      return;
    }
    timers.push(setTimeout(() => {
      log.push({ type: 'end', text: u.text, t: Date.now() });
      if (u.onend) u.onend({});
      next();
    }, durationMs));
  }
  window.SpeechSynthesisUtterance = function (text) { this.text = text; };
  const synth = {
    // `voicesAfterMs`: the list stays empty for a while, as on many phones.
    getVoices: () => (Date.now() - bootedAt >= voicesAfterMs ? voices : []),
    speak(u) { queue.push(u); if (queue.length === 1 && !synth._busy) { synth._busy = true; next(); } },
    cancel() {
      if (timers.length || queue.length) log.push({ type: 'cancel', t: Date.now() });
      timers.forEach(clearTimeout); timers = []; queue = []; synth._busy = false;
    },
    onvoiceschanged: null,
  };
  // Re-arm "busy" when the queue drains.
  const origNext = next;
  next = function () { if (!queue.length) { synth._busy = false; } origNext(); };
  Object.defineProperty(window, 'speechSynthesis', { value: synth, configurable: true });
}

// Removes the recorded-narration manifest so a test exercises browser TTS.
function disableRecordedNarration() {
  let content;
  Object.defineProperty(window, 'STORY_CONTENT', {
    configurable: true,
    get: () => content,
    set: v => { if (v && v.audio) v.audio.narration = {}; content = v; },
  });
}

async function newPage({ lms = true, reducedMotion = true, speechMs = 0, speech = null, device = null, recorded } = {}) {
  // Tests that fake a TTS voice test TTS: no recorded audio unless asked.
  if (recorded === undefined) recorded = !(speechMs || speech);
  const context = await browser.newContext({ ...(device || {}), reducedMotion: reducedMotion ? 'reduce' : 'no-preference' });
  // Block third-party requests: the course must work fully offline / inside
  // a locked-down hospital network.
  await context.route(/^https?:\/\/(?!127\.0\.0\.1)/, route => route.abort());
  if (lms) await context.addInitScript(installMockLms);
  if (speechMs || speech) await context.addInitScript(installFakeSpeech, speech || speechMs);
  if (!recorded) await context.addInitScript(disableRecordedNarration);
  const page = await context.newPage();
  page.errors = [];
  page.on('pageerror', e => page.errors.push('PageError: ' + e.message));
  page.on('console', m => { if (m.type() === 'error') page.errors.push('ConsoleError: ' + m.text()); });
  page.on('dialog', d => { page.errors.push('Native dialog opened: ' + d.message()); d.dismiss(); });
  return page;
}

async function open(page) {
  await page.goto(baseUrl, { waitUntil: 'load' });
  await page.waitForFunction(() => document.getElementById('loader').classList.contains('hidden'), null, { timeout: 10000 });
  await page.waitForFunction(() => document.getElementById('stage').dataset.scene, null, { timeout: 10000 });
}

async function dismissAudioOverlay(page) {
  await page.waitForSelector('#tts-activation.visible', { timeout: 5000 });
  await page.click('#tts-skip-btn');
  await page.waitForSelector('#tts-activation:not(.visible)');
}

const sceneId = page => page.evaluate(() => document.getElementById('stage').dataset.scene);
const content = page => page.evaluate(() => window.STORY_CONTENT);
const lmsValue = (page, k) => page.evaluate(key => window.__lms.cmi[key], k);

async function waitScene(page, id) {
  await page.waitForFunction(i => document.getElementById('stage').dataset.scene === i, id, { timeout: 10000 });
}

async function skipNarration(page) {
  await page.waitForFunction(() => {
    const b = document.getElementById('skip-btn');
    return b && !b.disabled;
  }, null, { timeout: 10000 });
  await page.click('#skip-btn');
}

async function closeModal(page) {
  await page.waitForSelector('.seat-modal.visible .seat-modal-close');
  await page.click('.seat-modal.visible .seat-modal-close');
  await page.waitForFunction(() => !document.querySelector('.seat-modal.visible'));
}

async function exploreAll(page, selector) {
  const n = await page.locator(selector).count();
  for (let i = 0; i < n; i++) {
    await page.locator(selector).nth(i).click();
    await closeModal(page);
  }
}

async function answer(page, idx) {
  await page.waitForSelector('#assessment-panel.visible');
  await page.click(`#assessment-options .assessment-option[data-idx="${idx}"]`);
}

async function clickNext(page) {
  await page.waitForSelector('#cta-next.visible', { timeout: 6000 });
  await page.click('#cta-next');
}

// Plays the current scene to its end. `wrongFirst` answers the MCQ (or the
// first dilemma phase) wrong once, then retries correctly.
async function playScene(page, opts = {}) {
  const id = await sceneId(page);
  await playSceneSteps(page, id, opts);
  // Wait for the transition so the next call sees the next scene.
  await page.waitForFunction(i => document.getElementById('stage').dataset.scene !== i, id, { timeout: 10000 });
}

async function playSceneSteps(page, id, { wrongFirst = false } = {}) {
  const c = await content(page);
  const scene = c.screens.find(s => s.id === id);
  const correct = scene.assessment ? scene.assessment.correct_index : null;
  const wrong = correct === 0 ? 1 : 0;

  await skipNarration(page);
  if (id === 'opening') {
    await page.waitForSelector('#cta-btn.visible');
    await page.click('#cta-btn');
    return;
  }
  if (id === 'boardroom') await exploreAll(page, '.seat');
  if (id === 'framework') await exploreAll(page, '.framework-layer');
  if (id === 'integrity') await exploreAll(page, '.integrity-star');
  if (id === 'pillars') {
    await page.click('#pillar-gov');
    await page.click('#pillar-comp');
  }
  if (id === 'court') {
    for (const cs of scene.cases) {
      await page.waitForSelector(`#court-card-${cs.n} .court-btn[data-choice="${cs.classification}"]:not([disabled])`, { timeout: 8000 });
      await page.click(`#court-card-${cs.n} .court-btn[data-choice="${cs.classification}"]`);
    }
  }
  if (id === 'dilemma') {
    for (const ph of scene.phases) {
      const good = ph.options.findIndex(o => o.correct);
      const bad = ph.options.findIndex(o => !o.correct);
      await page.waitForSelector(`#dilemma-card-${ph.n} .dilemma-option:not([disabled])`);
      if (wrongFirst && ph.n === 1) {
        await page.click(`#dilemma-card-${ph.n} .dilemma-option[data-idx="${bad}"]`);
        await page.click('#dl-retry');
      }
      await page.click(`#dilemma-card-${ph.n} .dilemma-option[data-idx="${good}"]`);
      await page.click(ph.n < scene.phases.length ? '#dl-next' : '#dl-finish');
    }
    await page.waitForSelector('.completion-screen', { timeout: 6000 });
    return;
  }
  if (wrongFirst) {
    await answer(page, wrong);
    await clickNext(page); // "try again"
  }
  await answer(page, correct);
  await clickNext(page);
}

// ---------------------------------------------------------------------------

test('Boots with no errors, CSP, skip link, modules, no third-party requests', async () => {
  const page = await newPage();
  await open(page);
  assert((await page.title()).includes('رحلة الحوكمة'), 'title');
  assert(await page.evaluate(() => !!document.querySelector('meta[http-equiv="Content-Security-Policy"]')), 'CSP meta present');
  assert(await page.evaluate(() => !!document.querySelector('.skip-link')), 'skip link present');
  const missing = await page.evaluate(() => ['ErrorBoundary', 'ScormApi', 'Scoring', 'Version', 'TTS', 'NarrationManager', 'Narrator', 'Animator', 'ModalManager']
    .filter(m => !window[m]));
  assertEqual(missing.length, 0, 'modules missing: ' + missing.join(','));
  assertEqual(await page.evaluate(() => window.ScormApi.isStandalone()), false, 'LMS detected');
  assertEqual(await lmsValue(page, 'cmi.core.lesson_status'), 'incomplete', 'status set to incomplete on launch');
  assertEqual(await lmsValue(page, 'cmi.core.exit'), 'suspend', 'exit=suspend while in progress');
  const fonts = await page.evaluate(() => [...document.styleSheets].map(s => s.href || '').filter(h => h.includes('googleapis')));
  assertEqual(fonts.length, 0, 'no Google Fonts stylesheet');
  assertEqual(page.errors.length, 0, page.errors.join('\n'));
  await page.context().close();
});

test('Alt+Arrow cannot skip an unfinished scene', async () => {
  const page = await newPage();
  await open(page);
  await dismissAudioOverlay(page);
  for (const key of ['Alt+ArrowLeft', 'Alt+ArrowRight', 'Alt+ArrowLeft']) {
    await page.keyboard.press(key);
    await page.waitForTimeout(300);
  }
  assertEqual(await sceneId(page), 'opening', 'still on the opening scene');
  assertEqual(page.errors.length, 0, page.errors.join('\n'));
  await page.context().close();
});

test('Seat modal traps focus and keeps loader aria-hidden', async () => {
  const page = await newPage();
  await open(page);
  await dismissAudioOverlay(page);
  await playScene(page);
  await waitScene(page, 'boardroom');
  await skipNarration(page);
  await page.click('#seat-1');
  await page.waitForSelector('.seat-modal.visible');
  await page.waitForTimeout(100);
  assert(await page.evaluate(() => document.querySelector('.seat-modal').contains(document.activeElement)), 'focus inside modal');
  await page.keyboard.press('Escape');
  await page.waitForFunction(() => !document.querySelector('.seat-modal.visible'));
  assertEqual(await page.evaluate(() => document.getElementById('loader').getAttribute('aria-hidden')), 'true', 'loader aria-hidden preserved');
  await page.context().close();
});

test('Perfect run scores 100, passes, and records one completion', async () => {
  const page = await newPage();
  await open(page);
  await dismissAudioOverlay(page);
  const total = (await content(page)).screens.length;
  for (let i = 0; i < total; i++) await playScene(page);

  assertEqual(await lmsValue(page, 'cmi.core.score.raw'), '100', 'LMS score');
  assertEqual(await lmsValue(page, 'cmi.core.lesson_status'), 'passed', 'LMS status');
  assertEqual(await lmsValue(page, 'cmi.core.exit'), '', 'exit cleared after completion');
  const meta = await page.evaluate(() => document.querySelector('.completion-meta').textContent);
  assert(meta.includes('٧ من ٧'), 'completion screen shows 7 of 7 scenes, got: ' + meta.replace(/\s+/g, ' '));
  const stamp1 = await page.evaluate(() => window.Version.getCompletion());
  assert(stamp1 && stamp1.score === 100, 'completion stamped with score 100');

  // Review mode, then exit: completion record must not be re-stamped.
  await page.waitForTimeout(20);
  await page.click('#completion-review');
  await page.waitForSelector('#learning-hub.visible');
  await page.click('.hub-scene-item[data-hub-scene-idx="1"]');
  await waitScene(page, 'boardroom');
  assert(await page.evaluate(() => document.body.classList.contains('review-mode')), 'review mode on');
  await page.click('#review-exit-btn');
  await page.waitForSelector('.completion-screen');
  const stamp2 = await page.evaluate(() => window.Version.getCompletion());
  assertEqual(stamp2.date, stamp1.date, 'completion date unchanged after review');

  // Restart uses an in-page dialog (native confirm is blocked in LMS iframes)
  // and must never downgrade the LMS status.
  await page.click('#completion-restart');
  await page.waitForSelector('.seat-modal.visible [data-confirm="yes"]');
  await page.click('.seat-modal.visible [data-confirm="yes"]');
  await waitScene(page, 'opening');
  assertEqual(await lmsValue(page, 'cmi.core.lesson_status'), 'passed', 'status not downgraded by restart');

  const lmsErrors = await page.evaluate(() => window.__lms.errors);
  assertEqual(lmsErrors.length, 0, 'LMS rejected writes: ' + JSON.stringify(lmsErrors));
  assertEqual(page.errors.length, 0, page.errors.join('\n'));
  await page.context().close();
});

test('First attempt counts: a wrong answer then a right one scores 0 for that scene', async () => {
  const page = await newPage();
  await open(page);
  await dismissAudioOverlay(page);
  await playScene(page);                        // opening
  await playScene(page, { wrongFirst: true });  // boardroom
  await waitScene(page, 'framework');
  assertEqual(await lmsValue(page, 'cmi.core.score.raw'), '0', 'score after wrong first attempt');
  assertEqual(page.errors.length, 0, page.errors.join('\n'));
  await page.context().close();
});

test('Relaunch resumes the scene and offers a way forward on an answered scene', async () => {
  const page = await newPage();
  await open(page);
  await dismissAudioOverlay(page);
  await playScene(page); // opening
  await waitScene(page, 'boardroom');
  await skipNarration(page);
  await exploreAll(page, '.seat');
  await answer(page, (await content(page)).screens[1].assessment.correct_index);
  await page.waitForTimeout(300);
  // Simulate the learner closing the window and relaunching from the LMS.
  await page.reload({ waitUntil: 'load' });
  await page.waitForFunction(() => document.getElementById('stage').dataset.scene === 'boardroom', null, { timeout: 10000 });
  assertEqual(await lmsValue(page, 'cmi.core.entry'), 'resume', 'LMS entry=resume');
  await page.waitForSelector('#cta-next.visible', { timeout: 5000 });
  await page.click('#cta-next');
  await waitScene(page, 'framework');
  assertEqual(page.errors.length, 0, page.errors.join('\n'));
  await page.context().close();
});

test('Reviewing a finished scene does not leak review mode into new work', async () => {
  const page = await newPage();
  await open(page);
  await dismissAudioOverlay(page);
  await playScene(page); // opening
  await playScene(page); // boardroom
  await waitScene(page, 'framework');
  await page.click('#hub-toggle');
  await page.click('.hub-scene-item[data-hub-scene-idx="1"]');
  await waitScene(page, 'boardroom');
  assert(await page.evaluate(() => document.body.classList.contains('review-mode')), 'review mode on');
  await page.click('#menu-toggle');
  await page.click('.scene-item[data-scene-idx="2"]');
  await waitScene(page, 'framework');
  assert(!(await page.evaluate(() => document.body.classList.contains('review-mode'))), 'review mode off on unfinished scene');
  assertEqual(page.errors.length, 0, page.errors.join('\n'));
  await page.context().close();
});

test('Leaving a scene cancels its pending timers', async () => {
  const page = await newPage();
  await open(page);
  await dismissAudioOverlay(page);
  await playScene(page); // opening
  await waitScene(page, 'boardroom');
  await skipNarration(page);
  await exploreAll(page, '.seat');
  await answer(page, 0);
  // Leave before the 2s "next / try again" CTA timer fires.
  await page.click('#menu-toggle');
  await page.click('.scene-item[data-scene-idx="0"]');
  await waitScene(page, 'opening');
  await page.waitForTimeout(2600);
  assertEqual(await page.locator('#cta-next').count(), 0, 'stale CTA from previous scene not shown');
  assertEqual(page.errors.length, 0, page.errors.join('\n'));
  await page.context().close();
});

test('Standalone (no LMS): loads, saves progress to localStorage', async () => {
  const page = await newPage({ lms: false });
  await open(page);
  await dismissAudioOverlay(page);
  assertEqual(await page.evaluate(() => window.ScormApi.isStandalone()), true, 'standalone');
  await playScene(page);
  await waitScene(page, 'boardroom');
  await page.waitForTimeout(800);
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('scorm_gov_story_v1') || '{}')['cmi.suspend_data']);
  assert(saved && JSON.parse(saved).currentScreen === 1, 'progress saved locally');
  assertEqual(page.errors.length, 0, page.errors.join('\n'));
  await page.context().close();
});

test('Fonts are self-hosted and load; no service worker inside an LMS', async () => {
  const page = await newPage();
  await open(page);
  await page.evaluate(() => document.fonts.ready);
  assert(await page.evaluate(() => document.fonts.check('700 16px Tajawal', 'رحلة')), 'Tajawal loaded');
  assertEqual(await page.evaluate(async () => (await navigator.serviceWorker.getRegistrations()).length), 0, 'no SW registered in LMS mode');
  await page.context().close();
});

test('Recorded narration: one tap starts the sentence on screen, then each segment plays in turn', async () => {
  const page = await newPage();
  await open(page);
  await page.waitForSelector('#tts-activation.visible');
  assert(!(await page.isHidden('#tts-activate-btn')), 'activate button offered at once (no voice to wait for)');
  assert((await page.textContent('#tts-activation-status')).includes('مسجّل'), 'card says recorded narration');
  await page.waitForFunction(() => window.Narrator && window.Narrator.isPlaying && document.getElementById('subtitle-text').textContent.length > 0);
  const inTap = await page.evaluate(() => {
    document.getElementById('tts-activate-btn').click();
    const a = window.AudioProvider.el;
    return { src: a && a.src, playing: a && !a.paused };
  });
  assert(/audio\/opening\/seg-\d+\.mp3$/.test(inTap.src), 'segment audio loaded in the tap: ' + inTap.src);
  assert(inTap.playing, 'play() called inside the tap');
  const first = inTap.src;
  await page.waitForFunction(f => window.AudioProvider.el.src !== f && /seg-\d+\.mp3$/.test(window.AudioProvider.el.src), first, { timeout: 15000 });
  assertEqual(page.errors.length, 0, page.errors.join('\n'));
  await page.context().close();
});

test('A missing narration file falls back to the device voice for that sentence', async () => {
  const page = await newPage({ speech: { ms: 300 }, recorded: true });
  await page.context().route(/\.mp3$/, route => route.fulfill({ status: 404, body: '' }));
  await open(page);
  await page.waitForSelector('#tts-activation.visible');
  await page.click('#tts-activate-btn');
  await page.waitForFunction(() => window.__speech.some(e => e.type === 'start'), null, { timeout: 10000 });
  await page.context().close();
});

test('Without an Arabic voice, the audio card says so instead of pretending', async () => {
  const page = await newPage({ speech: { ms: 500, voices: [{ name: 'English', lang: 'en-US' }] } });
  await open(page);
  await page.waitForSelector('#tts-activation.visible');
  assert(await page.evaluate(() => document.getElementById('tts-activate-btn').hidden), 'activate button hidden');
  assert((await page.textContent('#tts-activation-title')).includes('غير متاح'), 'card says audio unavailable');
  await page.context().close();
});

test('Narration waits for each sentence to finish; pause/resume replays it', async () => {
  const page = await newPage({ reducedMotion: true, speechMs: 5000 });
  await open(page);
  await page.waitForSelector('#tts-activation.visible');
  await page.waitForFunction(() => !document.getElementById('tts-activate-btn').hidden);
  await page.click('#tts-activate-btn');
  await page.waitForFunction(() => window.__speech.filter(e => e.type === 'start').length >= 2, null, { timeout: 15000 });
  const log = await page.evaluate(() => window.__speech);
  const starts = log.filter(e => e.type === 'start');
  const firstEnd = log.find(e => e.type === 'end');
  assert(firstEnd && starts[1].t >= firstEnd.t, 'second sentence started only after the first finished');
  assert(!log.some(e => e.type === 'cancel' && e.t < firstEnd.t), 'first sentence was not cut off');

  await page.click('#pause-btn');
  await page.click('#pause-btn');
  await page.waitForFunction(() => window.__speech.filter(e => e.type === 'start').length >= 3);
  const after = await page.evaluate(() => window.__speech.filter(e => e.type === 'start'));
  assertEqual(after[2].text, after[1].text, 'resume replays the current sentence');
  assertEqual(page.errors.length, 0, page.errors.join('\n'));
  await page.context().close();
});

test('Mute and speed survive a reload, and the topbar shows them', async () => {
  const page = await newPage({ speechMs: 1000 });
  await open(page);
  await page.waitForFunction(() => !document.getElementById('tts-activate-btn').hidden);
  await page.click('#tts-activate-btn');
  await page.click('#tts-rate');            // 1× → 1.25×
  await page.click('#tts-toggle');          // mute
  await page.reload({ waitUntil: 'load' });
  await page.waitForFunction(() => document.getElementById('loader').classList.contains('hidden'));
  const st = await page.evaluate(() => window.NarrationManager.getState());
  assertEqual(st.muted, true, 'muted persisted');
  assertEqual(st.rate, 1.25, 'rate persisted');
  assertEqual(await page.textContent('#tts-rate-label'), '١.٢٥×', 'rate label matches');
  await page.context().close();
});

// What a learner can actually tap at the centre of an element.
const topElementIs = (page, sel) => page.evaluate(s => {
  const el = document.querySelector(s);
  const r = el.getBoundingClientRect();
  const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
  return !!hit && (hit === el || el.contains(hit));
}, sel);

test('Phone: the topbar is not hidden under the black bars, and the title shows', async () => {
  const page = await newPage({ device: devices['Pixel 7'], reducedMotion: false });
  await open(page);
  await dismissAudioOverlay(page);
  await page.waitForFunction(() => document.body.classList.contains('cinematic'));
  await page.waitForTimeout(2500); // past the title's typewriter start
  for (const sel of ['#menu-toggle', '#hub-toggle', '#tts-toggle', '#tts-rate']) {
    assert(await topElementIs(page, sel), sel + ' is visible and tappable');
  }
  const bars = await page.evaluate(() => document.getElementById('letterbox-top').getBoundingClientRect().height);
  assertEqual(bars, 0, 'no cinematic bars on a phone');
  assert(await page.evaluate(() => getComputedStyle(document.getElementById('hero-title')).opacity === '1'), 'opening title is visible');
  // The narrator portrait sits by the subtitles, not over the scene content.
  const overlap = await page.evaluate(() => {
    const a = document.getElementById('narrator-overlay').getBoundingClientRect();
    const b = document.getElementById('subtitle-bar').getBoundingClientRect();
    return a.top >= b.top - 30;
  });
  assert(overlap, 'narrator docked by the subtitle bar');
  // The scene drawer is not covered by the subtitle bar.
  await page.click('#menu-toggle');
  await page.waitForSelector('#scene-drawer.visible');
  await page.waitForTimeout(400);
  assert(await topElementIs(page, '#scene-drawer-restart'), 'drawer restart button not covered');
  assertEqual(page.errors.length, 0, page.errors.join('\n'));
  await page.context().close();
});

test('Desktop: the topbar stays on top of the cinematic bars', async () => {
  const page = await newPage({ reducedMotion: false });
  await page.setViewportSize({ width: 1280, height: 800 });
  await open(page);
  await dismissAudioOverlay(page);
  await page.waitForFunction(() => document.body.classList.contains('cinematic'));
  await page.waitForTimeout(1200);
  assert(await topElementIs(page, '#tts-toggle'), 'audio toggle visible above the letterbox');
  await page.context().close();
});

test('Turning audio on reads the sentence on screen right away, inside the tap', async () => {
  const page = await newPage({ speechMs: 3000 });
  await open(page);
  await page.waitForSelector('#tts-activation.visible');
  await page.waitForFunction(() => !document.getElementById('tts-activate-btn').hidden);
  await page.waitForFunction(() => document.getElementById('subtitle-text').textContent.length > 0);
  const onScreen = await page.textContent('#subtitle-text');
  // Same task as the click: no timer may run between the tap and speak().
  const startedInTap = await page.evaluate(() => {
    document.getElementById('tts-activate-btn').click();
    return window.__speech.filter(e => e.type === 'start').map(e => e.text);
  });
  assertEqual(startedInTap.length, 1, 'one sentence started synchronously in the tap');
  assert(onScreen.startsWith(startedInTap[0].slice(0, 10)), 'it is the sentence on screen');
  await page.context().close();
});

test('A voice that loads after the audio card opened still enables audio', async () => {
  const page = await newPage({ speech: { ms: 500, voicesAfterMs: 2500 } });
  await open(page);
  await page.waitForSelector('#tts-activation.visible');
  assert(!(await page.textContent('#tts-activation-title')).includes('غير متاح'), 'card does not claim "unavailable" while voices load');
  await page.waitForFunction(() => !document.getElementById('tts-activate-btn').hidden, null, { timeout: 6000 });
  await page.context().close();
});

test('An engine that lists no voices is asked for Arabic by language', async () => {
  const page = await newPage({ speech: { ms: 500, voices: [] } });
  await open(page);
  await page.waitForSelector('#tts-activation.visible');
  await page.waitForFunction(() => !document.getElementById('tts-activate-btn').hidden, null, { timeout: 8000 });
  await page.click('#tts-activate-btn');
  await page.waitForFunction(() => window.__speech.some(e => e.type === 'start'));
  const first = await page.evaluate(() => window.__speech.find(e => e.type === 'start'));
  assertEqual(first.lang, 'ar-SA', 'utterance asks for Arabic');
  assertEqual(page.errors.length, 0, page.errors.join('\n'));
  await page.context().close();
});

test('If that engine cannot speak Arabic, the course says so and goes subtitles-only', async () => {
  const page = await newPage({ speech: { ms: 500, voices: [], error: 'language-unavailable' } });
  await open(page);
  await page.waitForSelector('#tts-activation.visible');
  await page.waitForFunction(() => !document.getElementById('tts-activate-btn').hidden, null, { timeout: 8000 });
  await page.click('#tts-activate-btn');
  await page.waitForFunction(() => window.NarrationManager.getState().available === null);
  await page.waitForFunction(() => document.getElementById('toast').textContent.includes('النطق العربي'));
  assertEqual(await page.textContent('#tts-icon'), '🔇', 'topbar shows audio unavailable');
  await page.context().close();
});

(async () => {
  ({ server, url: baseUrl } = await start());
  const executablePath = process.env.PLAYWRIGHT_CHROMIUM_PATH || undefined;
  browser = await chromium.launch({ executablePath });
  try {
    await run();
  } finally {
    await browser.close();
    server.close();
  }
})();
