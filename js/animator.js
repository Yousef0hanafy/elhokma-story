/**
 * Animator — scene-level animation orchestrator.
 * Uses setTimeout chains to drive the cinematic timeline.
 *
 * API:
 *   Animator.runTimeline(steps)   // steps: [{time, fn}]
 *   Animator.clear()              // cancel pending
 *   Animator.fadeOut(el, cb)      // cross-fade utility
 *   Animator.fadeIn(el, cb)
 */
(function (global) {
  'use strict';

  const Animator = {
    timeouts: [],
    reducedMotion: false,
  };

  function init() {
    Animator.reducedMotion = global.matchMedia('(prefers-reduced-motion: reduce)').matches;
  }

  function clear() {
    Animator.timeouts.forEach(t => clearTimeout(t));
    Animator.timeouts = [];
  }

  function runTimeline(steps) {
    clear();
    steps.forEach(step => {
      const t = setTimeout(() => {
        try { step.fn(); } catch (e) { console.error('Animation step failed:', e); }
      }, Math.max(0, step.time * 1000));
      Animator.timeouts.push(t);
    });
  }

  function delay(seconds, fn) {
    const t = setTimeout(fn, seconds * 1000);
    Animator.timeouts.push(t);
    return t;
  }

  function fadeOut(el, duration = 0.5, cb) {
    if (!el) { if (cb) cb(); return; }
    el.style.transition = `opacity ${duration}s ease`;
    el.style.opacity = '0';
    const t = setTimeout(() => {
      if (cb) cb();
    }, duration * 1000);
    Animator.timeouts.push(t);
  }

  function fadeIn(el, duration = 0.6, cb) {
    if (!el) { if (cb) cb(); return; }
    el.style.transition = `opacity ${duration}s ease`;
    el.style.opacity = '0';
    requestAnimationFrame(() => {
      el.style.opacity = '1';
    });
    const t = setTimeout(() => { if (cb) cb(); }, duration * 1000);
    Animator.timeouts.push(t);
  }

  function scaleOut(el, duration = 0.5, cb) {
    if (!el) { if (cb) cb(); return; }
    el.style.transition = `opacity ${duration}s ease, transform ${duration}s ease`;
    el.style.opacity = '0';
    el.style.transform = 'scale(0.98)';
    const t = setTimeout(() => { if (cb) cb(); }, duration * 1000);
    Animator.timeouts.push(t);
  }

  // Show element by adding a class with optional delay
  function reveal(el, delay = 0, className = 'anim-fade-up') {
    if (!el) return;
    const t = setTimeout(() => {
      el.classList.add(className);
      el.style.opacity = '';
    }, delay * 1000);
    Animator.timeouts.push(t);
  }

  // Apply staggered reveal to a NodeList
  function staggerReveal(items, startDelay = 0, step = 0.15, className = 'anim-fade-up') {
    items.forEach((el, i) => {
      reveal(el, startDelay + i * step, className);
    });
  }

  // Draw SVG stroke (for the boardroom table)
  function drawStroke(el, duration = 2.0) {
    if (!el) return;
    const len = el.getTotalLength ? el.getTotalLength() : 800;
    el.style.strokeDasharray = String(len);
    el.style.strokeDashoffset = String(len);
    el.style.transition = `stroke-dashoffset ${duration}s ease-out`;
    requestAnimationFrame(() => {
      el.style.strokeDashoffset = '0';
    });
  }

  // Glow a seat temporarily (during narration)
  function pulseGlow(el, duration = 1.6) {
    if (!el) return;
    el.classList.add('glowing');
    const t = setTimeout(() => el.classList.remove('glowing'), duration * 1000);
    Animator.timeouts.push(t);
  }

  Animator.init = init;
  Animator.clear = clear;
  Animator.runTimeline = runTimeline;
  Animator.delay = delay;
  Animator.fadeOut = fadeOut;
  Animator.fadeIn = fadeIn;
  Animator.scaleOut = scaleOut;
  Animator.reveal = reveal;
  Animator.staggerReveal = staggerReveal;
  Animator.drawStroke = drawStroke;
  Animator.pulseGlow = pulseGlow;

  global.Animator = Animator;
})(window);
