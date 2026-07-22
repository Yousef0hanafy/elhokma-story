/**
 * ModalManager — centralizes modal lifecycle: focus trap, ESC, backdrop,
 * and aria-hidden on the rest of the page.
 *
 * Why: the three seat/layer/star modals in app.js each rolled their own
 * keydown/click handlers and never moved focus into the modal or restored
 * it on close — a real a11y gap. This module fixes that with one API.
 *
 * API:
 *   ModalManager.open({ content, onClose })  // opens a modal, traps focus
 *   ModalManager.close()                     // closes current modal
 *   ModalManager.isOpen()                    // bool
 */
(function (global) {
  'use strict';

  const FOCUSABLE = [
    'a[href]', 'button:not([disabled])', 'textarea', 'input', 'select',
    '[tabindex]:not([tabindex="-1"])',
  ].join(',');

  const ModalManager = {
    current: null,
    previouslyFocused: null,
    keyHandler: null,
  };

  function isOpen() { return ModalManager.current !== null; }

  function open(opts) {
    if (ModalManager.current) close();
    if (!opts || !opts.content) return;

    const previouslyFocused = document.activeElement;
    ModalManager.previouslyFocused = previouslyFocused;

    const overlay = document.createElement('div');
    overlay.className = 'seat-modal';
    overlay.setAttribute('role', 'dialog');
    overlay.setAttribute('aria-modal', 'true');
    overlay.setAttribute('aria-label', opts.label || 'نافذة تفاصيل');
    overlay.innerHTML = opts.content;

    document.body.appendChild(overlay);
    document.body.classList.add('modal-open');

    // Hide the rest of the page from screen readers.
    // CRITICAL: only set aria-hidden on elements that don't ALREADY have it.
    // The loader, letterbox bars, etc. start with aria-hidden="true" in the
    // HTML. If we blindly removeAttribute on close, we'd corrupt their
    // original state. We track which elements WE modified via a data
    // attribute and only restore those.
    document.querySelectorAll('body > *:not(.seat-modal)').forEach(el => {
      if (el.id === 'toast') return;
      if (el.getAttribute('aria-hidden') === 'true') return; // already hidden — leave it alone
      el.setAttribute('aria-hidden', 'true');
      el.dataset.modalHidden = '1';
    });

    // Make the modal visible first, THEN move focus. Calling focus() on an
    // element inside a visibility:hidden container is a no-op in most
    // browsers — the focus would stay on the background, breaking the
    // focus trap and screen-reader experience.
    overlay.classList.add('visible');

    ModalManager.current = {
      overlay,
      onClose: opts.onClose || null,
    };

    // Move focus into the modal after the browser has painted the visible
    // state. requestAnimationFrame ensures the visibility change is applied.
    requestAnimationFrame(() => {
      const firstFocusable = overlay.querySelector(FOCUSABLE);
      if (firstFocusable) {
        firstFocusable.focus();
      } else {
        // No focusable child — focus the overlay itself so Tab has a anchor.
        overlay.setAttribute('tabindex', '-1');
        overlay.focus();
      }
    });

    // Backdrop click
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) close();
    });

    // ESC + focus trap
    ModalManager.keyHandler = (e) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        close();
        return;
      }
      if (e.key === 'Tab') {
        trapTab(e, overlay);
      }
    };
    document.addEventListener('keydown', ModalManager.keyHandler);
  }

  function close() {
    if (!ModalManager.current) return;
    const { overlay, onClose } = ModalManager.current;

    overlay.classList.remove('visible');
    setTimeout(() => {
      if (overlay.parentNode) overlay.parentNode.removeChild(overlay);
    }, 300);

    document.body.classList.remove('modal-open');
    document.removeEventListener('keydown', ModalManager.keyHandler);
    ModalManager.keyHandler = null;

    // Restore aria-hidden
    document.querySelectorAll('[data-modal-hidden="1"]').forEach(el => {
      el.removeAttribute('aria-hidden');
      delete el.dataset.modalHidden;
    });

    // Restore focus
    if (ModalManager.previouslyFocused && typeof ModalManager.previouslyFocused.focus === 'function') {
      ModalManager.previouslyFocused.focus();
    }
    ModalManager.previouslyFocused = null;
    ModalManager.current = null;

    if (typeof onClose === 'function') {
      try { onClose(); } catch (e) { console.warn('[ModalManager] onClose threw:', e); }
    }
  }

  function trapTab(e, container) {
    const focusables = Array.from(container.querySelectorAll(FOCUSABLE))
      .filter(el => el.offsetParent !== null || el === document.activeElement);
    if (focusables.length === 0) return;
    const first = focusables[0];
    const last = focusables[focusables.length - 1];
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  }

  ModalManager.open = open;
  ModalManager.close = close;
  ModalManager.isOpen = isOpen;

  global.ModalManager = ModalManager;
})(window);
