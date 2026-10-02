// ============ Art Swipe (horizontal toggles mode / vertical steps selection) ============
// Zero-dependency swipe detector shared by all avatar walls and portrait views.
// Touch + mouse drag. Callers bind horizontal (onPrev/onNext) to 角色/機體 display
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
 * Horizontal: right = onPrev, left = onNext (avatar walls bind 角色/機體 toggle).
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
    suppressUntil = 0; lastSwipeAt = 0; // 新手勢開始:只吞上一次滑動的尾隨 click,不擋這次的點選
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
  // 拖曳後的 click(滑鼠必有,觸控視瀏覽器而定)會點中起始那顆按鈕而抵銷滑動:
  // 捕獲期吞掉即可,不影響一般的點選(未滑動時 suppressUntil 已過期)。
  const clickCap = (e) => {
    if (performance.now() < suppressUntil) { e.preventDefault(); e.stopPropagation(); }
  };
  el.addEventListener('pointerdown', down);
  el.addEventListener('pointerup', up);
  el.addEventListener('pointercancel', cancel);
  el.addEventListener('click', clickCap, true);
  // PointerEvent 存在的瀏覽器另外掛 touch 會同一次滑動打兩次 fire:
  // 舊 throttle 會連帶吃掉 350ms 內的合法連滑,改為只留一組事件源。
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
