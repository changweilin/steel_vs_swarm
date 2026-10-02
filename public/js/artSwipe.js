// ============ Art Swipe (avatar / portrait left-right to switch) ============
// Zero-dependency swipe detector shared by all avatar walls and portrait views.
// Touch + mouse drag; vertical scroll preserved (horizontal intent only).
// Threshold + direction lock decided here so callers only handle onPrev/onNext.

/** Swipe distance (px) to trigger prev/next. */
export const ART_SWIPE_PX = 42;

/**
 * Attach left/right swipe to switch selection.
 * @param {HTMLElement} el swipe surface
 * @param {object} opt `{ onPrev, onNext }`
 * @returns {() => void} detach function
 */
export function attachArtSwipe(el, opt = {}) {
  if (!el || typeof el.addEventListener !== 'function') return () => {};
  const { onPrev, onNext } = opt;
  let sx = 0, sy = 0, tracking = false, pid = null, lastFire = 0;
  const fire = (dx) => {
    const now = performance.now();
    if (now - lastFire < 350) return;   // pointer + touch 雙事件去重
    lastFire = now;
    if (dx > 0) onPrev?.();
    else onNext?.();
  };
  const down = (e) => {
    if (tracking) return;
    const p = e.touches?.[0] || e;
    sx = p.clientX; sy = p.clientY; tracking = true; pid = e.pointerId ?? 't';
  };
  const up = (e) => {
    if (!tracking) return;
    if (pid !== null && e.pointerId !== undefined && e.pointerId !== pid) return;
    const p = e.changedTouches?.[0] || e;
    const dx = p.clientX - sx, dy = p.clientY - sy;
    tracking = false; pid = null;
    if (Math.abs(dx) < ART_SWIPE_PX || Math.abs(dx) < Math.abs(dy) * 1.4) return;
    fire(dx);
  };
  const cancel = () => { tracking = false; pid = null; };
  el.addEventListener('pointerdown', down);
  el.addEventListener('pointerup', up);
  el.addEventListener('pointercancel', cancel);
  el.addEventListener('touchstart', down, { passive: true });
  el.addEventListener('touchend', up, { passive: true });
  el.addEventListener('touchcancel', cancel, { passive: true });
  return () => {
    el.removeEventListener('pointerdown', down);
    el.removeEventListener('pointerup', up);
    el.removeEventListener('pointercancel', cancel);
    el.removeEventListener('touchstart', down);
    el.removeEventListener('touchend', up);
    el.removeEventListener('touchcancel', cancel);
  };
}
