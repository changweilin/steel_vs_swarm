// ============ Art Swipe (horizontal toggles mode / vertical steps selection) ============
// Zero-dependency swipe detector shared by all avatar walls and portrait views.
// Touch + mouse drag. Callers bind horizontal (onPrev/onNext) to char/mech display
// toggle and vertical (onUp/onDown) to prev/next stepping.
// Post-swipe click suppression: a drag starting on a button MUST NOT also fire
// that button's click and undo the swipe. No pointer capture is used — capture
// would retarget the trailing click to the container and break normal clicks
// (avatar select / portrait bio). Listeners stay on `el` so discarding the
// element (detail re-render) never leaks window handlers; a document-level guard
// covers the trailing click when the swipe rebuilt the content underneath it.

/** Swipe distance (px) to trigger, horizontal and vertical alike. */
export const ART_SWIPE_PX = 42;

/** Post-swipe window (ms) during which the trailing click is swallowed. */
const CLICK_SUPPRESS_MS = 600;

/** Global swipe stamp: suppresses the trailing click even after re-render. */
let lastSwipeAt = 0;
let docGuardInstalled = false;
/** Art surfaces whose trailing click is swallowed (walls persist, portraits rebuild). */
const ART_CLICK_SCOPE = '[data-artswipe], .char-grid, .sb-chips, .smp-grid';
function ensureDocGuard() {
  if (docGuardInstalled || typeof document === 'undefined') return;
  docGuardInstalled = true;
  document.addEventListener('click', (e) => {
    if (performance.now() - lastSwipeAt > CLICK_SUPPRESS_MS) return;
    if (e.target?.closest?.(ART_CLICK_SCOPE)) { e.preventDefault(); e.stopPropagation(); }
  }, true);
}

/**
 * Attach four-direction swipe.
 * Horizontal: right = onPrev, left = onNext (avatar walls bind char/mech toggle).
 * Vertical: up = onUp, down = onDown (bind prev/next stepping).
 * @param {HTMLElement} el swipe surface
 * @param {object} opt `{ onPrev, onNext, onUp, onDown }`
 * @returns {() => void} detach function
 */
export function attachArtSwipe(el, opt = {}) {
  if (!el || typeof el.addEventListener !== 'function') return () => {};
  ensureDocGuard();
  const { onPrev, onNext, onUp, onDown } = opt;
  let sx = 0, sy = 0, tracking = false, pid = null, suppressUntil = 0;
  const fireH = (dx) => {
    const now = performance.now();
    suppressUntil = now + CLICK_SUPPRESS_MS;
    lastSwipeAt = now;
    if (dx > 0) onPrev?.();
    else onNext?.();
  };
  const fireV = (dy) => {
    const now = performance.now();
    suppressUntil = now + CLICK_SUPPRESS_MS;
    lastSwipeAt = now;
    if (dy < 0) onUp?.();
    else onDown?.();
  };
  const down = (e) => {
    if (e.isPrimary === false) return;
    if (e.pointerType === 'mouse' && e.button !== undefined && e.button !== 0) return;
    if (tracking) return;
    const p = e.touches?.[0] || e;
    if (p.clientX == null || p.clientY == null) return;
    suppressUntil = 0; lastSwipeAt = 0; // New gesture starts: swallow only the trailing click of the last swipe, never block this tap
    sx = p.clientX; sy = p.clientY; tracking = true; pid = e.pointerId ?? 't';
  };
  const up = (e) => {
    if (!tracking) return;
    if (pid !== null && e.pointerId !== undefined && e.pointerId !== pid) return;
    if (e.isPrimary === false) return;
    const p = e.changedTouches?.[0] || e;
    if (p.clientX == null) { tracking = false; pid = null; return; }
    const dx = p.clientX - sx, dy = p.clientY - sy;
    tracking = false; pid = null;
    const adx = Math.abs(dx), ady = Math.abs(dy);
    if (adx >= ART_SWIPE_PX && adx >= ady * 1.4) { fireH(dx); return; }
    if (ady >= ART_SWIPE_PX && ady >= adx * 1.4) { fireV(dy); return; }
  };
  const cancel = (e) => {
    if (e && pid !== null && e.pointerId !== undefined && e.pointerId !== pid) return;
    tracking = false; pid = null;
  };
  // Trailing click after drag (always on mouse, browser-dependent on touch) would hit the start button and cancel the swipe:
// swallow it in capture phase, normal taps unaffected (suppressUntil already expired when no swipe).
  const clickCap = (e) => {
    if (performance.now() < suppressUntil) { e.preventDefault(); e.stopPropagation(); }
  };
  el.addEventListener('pointerdown', down);
  el.addEventListener('pointerup', up);
  el.addEventListener('pointercancel', cancel);
  el.addEventListener('click', clickCap, true);
  // Browsers with PointerEvent double-fire the same swipe if touch is also bound:
// old throttle would also eat legit chained swipes within 350ms, keep only one event source.
  const hasPointer = typeof PointerEvent !== 'undefined'
    || (typeof window !== 'undefined' && 'onpointerdown' in window);
  if (!hasPointer) {
    el.addEventListener('touchstart', down, { passive: true });
    el.addEventListener('touchend', up, { passive: true });
    el.addEventListener('touchcancel', cancel, { passive: true });
  }
  return () => {
    el.removeEventListener('pointerdown', down);
    el.removeEventListener('pointerup', up);
    el.removeEventListener('pointercancel', cancel);
    el.removeEventListener('click', clickCap, true);
    if (!hasPointer) {
      el.removeEventListener('touchstart', down);
      el.removeEventListener('touchend', up);
      el.removeEventListener('touchcancel', cancel);
    }
  };
}
