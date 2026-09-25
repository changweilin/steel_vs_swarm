// ============ Tooltips (sole seam for in-game GUI explanations) ============
// In-game GUI persistent explanation texts are consolidated into hover/touch tooltips,
// and also aggregated into the "Help" tab of the battle pause menu (help.js `UI_TIPS` -> "UI" category).
//
// Persistent explanation labels bloat option rows into multiple lines, squeezing controls on narrow screens.
// Tooltips hide text inside `data-tip` behind an ⓘ badge, while help.js mirrors the copy offline.
//
// Sole seam: single tooltip bubble implementation across the client. Consumers MUST only:
//   1. Add `data-tip="..."` (displayed on mouseover or touch long-press).
//   2. Use `tipHTML(text)` or `attachTip(el, text)` when a visible badge is required.
// MUST NOT implement a second bubble system or fall back to native `title=` (touch devices have no hover).
//
// Pure presentation layer: does not touch authority state or participate in server settlement.

let _bubble = null;      // Lazy singleton bubble element
let _anchor = null;      // Currently active anchor element
let _lpTimer = 0;        // Touch long-press timer
let _viaHover = false;   // True if triggered via hover (determines click dismiss behavior)
let _installed = false;

const LONG_PRESS_MS = 380;   // Threshold distinguishing tap from long-press to avoid swallowing option clicks
const EDGE = 8;              // Minimum padding from viewport boundary

const _esc = (t) => String(t).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

/** Tooltip badge HTML (sole generation seam; use when interpolating into template strings). */
export function tipHTML(text, cls = '') {
  return `<button class="tip-dot${cls ? ` ${cls}` : ''}" type="button" aria-label="說明" data-tip="${_esc(text)}">ⓘ</button>`;
}

/** DOM variant of tooltip badge for appending to existing nodes. */
export function tipDot(text, cls = '') {
  const b = document.createElement('button');
  b.className = 'tip-dot' + (cls ? ` ${cls}` : '');
  b.type = 'button';
  b.setAttribute('aria-label', '說明');
  b.dataset.tip = text;
  b.textContent = 'ⓘ';
  return b;
}

/**
 * Attach tooltip directly to an existing element without adding a badge.
 * Empty string removes tooltip (used during dynamic row refresh).
 */
export function attachTip(el, text) {
  if (!el) return el;
  if (text) el.dataset.tip = text;
  else delete el.dataset.tip;
  return el;
}

function ensureBubble() {
  if (_bubble) return _bubble;
  _bubble = document.createElement('div');
  _bubble.className = 'tip-bubble';
  _bubble.setAttribute('role', 'tooltip');
  _bubble.hidden = true;
  document.body.appendChild(_bubble);
  return _bubble;
}

/** Show tooltip; no-op if anchor lacks `data-tip`. */
export function showTip(el) {
  const text = el?.dataset?.tip;
  if (!text) return;
  const b = ensureBubble();
  b.textContent = text;
  b.hidden = false;
  _anchor = el;
  el.classList.add('tip-open');

  // Position directly below anchor, left-aligned; clamped within viewport boundaries.
  // Bubble dimensions MUST be measured after unhiding to avoid 0-width measurement.
  b.style.left = '0px';
  b.style.top = '0px';
  const a = el.getBoundingClientRect();
  const r = b.getBoundingClientRect();
  const vw = document.documentElement.clientWidth, vh = document.documentElement.clientHeight;
  let x = a.left;
  let y = a.bottom + 6;
  if (x + r.width > vw - EDGE) x = vw - EDGE - r.width;
  if (x < EDGE) x = EDGE;
  if (y + r.height > vh - EDGE) y = a.top - 6 - r.height;   // Flip above if bottom overflows
  if (y < EDGE) y = EDGE;
  b.style.left = `${Math.round(x)}px`;
  b.style.top = `${Math.round(y)}px`;
}

/** Hide tooltip (idempotent / safe to call repeatedly). */
export function hideTip() {
  clearTimeout(_lpTimer);
  _lpTimer = 0;
  if (_anchor) _anchor.classList.remove('tip-open');
  _anchor = null;
  if (_bubble) _bubble.hidden = true;
}

/**
 * Global installation (idempotent). Delegated on document because tooltip anchors
 * are recreated dynamically during room, shop, and roster redraws.
 * Per-node listeners MUST NOT be used as they would detach on DOM re-renders.
 */
export function installTips() {
  if (_installed) return;
  _installed = true;

  const anchorOf = (t) => (t instanceof Element ? t.closest('[data-tip]') : null);

  // Mouse: pointerover/pointerout bubble across delegation boundaries, unlike mouseenter/mouseleave.
  document.addEventListener('pointerover', (e) => {
    if (e.pointerType === 'touch') return;
    const el = anchorOf(e.target);
    if (el && el !== _anchor) { showTip(el); _viaHover = true; }
  });
  document.addEventListener('pointerout', (e) => {
    if (e.pointerType === 'touch') return;
    if (_anchor && !_anchor.contains(e.relatedTarget)) hideTip();
  });

  // Touch: long-press displays tooltip. Short taps MUST pass through without interference
  // so option buttons under tooltips remain clickable.
  document.addEventListener('pointerdown', (e) => {
    const el = anchorOf(e.target);
    if (e.pointerType !== 'touch') { if (!el) hideTip(); return; }
    hideTip();
    if (!el) return;
    _lpTimer = setTimeout(() => { _lpTimer = 0; showTip(el); _viaHover = false; }, LONG_PRESS_MS);
  }, true);
  const cancelLp = () => { if (_lpTimer) { clearTimeout(_lpTimer); _lpTimer = 0; } };
  document.addEventListener('pointerup', cancelLp, true);
  document.addEventListener('pointercancel', () => hideTip(), true);
  document.addEventListener('pointermove', (e) => { if (e.pointerType === 'touch') cancelLp(); }, true);

  // ⓘ badge toggle: immediate click toggle for keyboard Enter/Space and touch taps.
  // `_viaHover` avoids closing immediately on click when hover has already opened the bubble.
  document.addEventListener('click', (e) => {
    const dot = e.target instanceof Element ? e.target.closest('.tip-dot') : null;
    if (!dot) return;
    e.preventDefault();
    e.stopPropagation();
    if (_anchor === dot && !_viaHover) hideTip();
    else { showTip(dot); _viaHover = false; }
  });

  // Keyboard focusin displays tooltip, except for .tip-dot where focusin precedes click
  // and would break toggle state tracking.
  document.addEventListener('focusin', (e) => {
    const el = anchorOf(e.target);
    if (el && !el.classList.contains('tip-dot')) { showTip(el); _viaHover = false; }
  });
  document.addEventListener('focusout', () => hideTip());
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') hideTip(); });
  // Dismiss fixed bubble on scroll/resize because anchor position has invalidated.
  window.addEventListener('scroll', () => hideTip(), true);
  window.addEventListener('resize', () => hideTip());
}
