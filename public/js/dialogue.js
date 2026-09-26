// ============ Campaign Dialogue Presentation (pure DOM overlay) ============
// Content lives in `storytalk.js`, phase progression in `data.js SIEGE`, triggers in server `siege` events.
// This module renders dialogue overlay only; agnostic to chapters, phases, and speaker selection.
//
// Two presentation modes based on active simulation state:
//   radio  During combat (frontline and mid stages) -- bottom single-line ticker, auto-advancing,
//          non-blocking to gameplay and inputs. Prevents player deaths while reading full screens.
//   scene  Post-battle settlement (base stage) -- full transcript fade-in with portraits and replay capability.
//
// Invariants:
//   1. Line switches MUST NOT use CSS transitions -- per-line crossfades blur rapid 1.6-4s switches into ghosting.
//      Fade transitions apply only to container mount/unmount.
//   2. All active timers MUST be tracked in `this.timers` and cancelled on `clear()` / `dispose()` to prevent
//      stale dialogue leaking across deaths, phase changes, and chapter exits.
//   3. Text is treated as untrusted data and escaped via `esc()`.

import { CHARACTERS, SIDES, SIEGE } from './data.js';
import { avatarURL, portraitURL } from './portraits.js';

/** Display duration per line: clamped linear scale based on character count. */
const lineMs = (s) => Math.max(1700, Math.min(4200, 900 + String(s).length * 140));

const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (m) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[m]));

/** Faction color by character ID (mercenaries use neutral gold); shared by portrait frame and name tag. */
const sideColor = (id) => {
  const c = CHARACTERS[id];
  if (!c) return '#b9a06a';
  return c.side === 'MERC' ? '#b9a06a' : SIDES[c.side].color;
};

/**
 * Portrait faction tag (drives frame style + side).
 * SWARM → left, STEEL → right (mirrors HUD base bars); MERC → left with gold double frame
 * (team context is unknowable here, so mercenaries take a fixed neutral seat).
 */
const facOf = (id) => CHARACTERS[id]?.side || 'MERC';

export class Dialogue {
  /** @param {HTMLElement} root Dialogue overlay layer mounted over canvas (#dialogueLayer) */
  constructor(root) {
    this.root = root;
    this.timers = new Set();
    this.bar = null;
  }

  _after(ms, fn) {
    const t = setTimeout(() => { this.timers.delete(t); fn(); }, ms);
    this.timers.add(t);
    return t;
  }

  /**
   * Radio dialogue ticker during combat (frontline and mid stages).
   * @param {object} sc Scenario object `{ title, note, lines }` from storytalk.js
   * @param {object} [opt] `{ manual }` -- Storybook inspection mode only: advances manually via `next()`.
   *   Live gameplay MUST NOT pass manual; enforced by `audit_story_talk`.
   */
  radio(sc, opt = {}) {
    if (!this.root || !sc?.lines?.length) return;
    this.clear();
    this.manual = !!opt.manual;
    const el = this.bar = document.createElement('div');
    el.className = 'dlg-bar';
    el.innerHTML = `
      <div class="dlg-note"><b>${esc(sc.title)}</b><span>${esc(sc.note)}</span></div>
      <div class="dlg-row">
        <img class="dlg-av dlg-av-l" src="" alt="" draggable="false">
        <div class="dlg-txt"><span class="dlg-who"></span><span class="dlg-line"></span></div>
        <img class="dlg-av dlg-av-r" src="" alt="" draggable="false">
      </div>`;
    this.root.appendChild(el);
    // 雙頭像:取本場台詞最多的兩名發言者固定鎮守兩端(左 SWARM 系 / 右 STEEL,同 HUD 主堡條站位),
    // 逐句只切換高亮 —— 頭像不再每句跳動(RPG 對話框站位)。
    const tally = new Map();
    for (const l of sc.lines) tally.set(l.ch, (tally.get(l.ch) || 0) + 1);
    const leads = [...tally.entries()].sort((a, b) => b[1] - a[1]).map(([id]) => id);
    const L = leads.find((id) => facOf(id) !== 'STEEL') ?? leads[0];
    const R = leads.find((id) => id !== L) ?? null;
    const avL = el.querySelector('.dlg-av-l');
    const avR = el.querySelector('.dlg-av-r');
    for (const [av, id] of [[avL, L], [avR, R]]) {
      if (!av) continue;
      if (!id) { av.style.display = 'none'; continue; }
      av.src = avatarURL(id);
      av.dataset.fac = facOf(id);
      av.dataset.ch = id;
    }
    const who = el.querySelector('.dlg-who');
    const txt = el.querySelector('.dlg-line');
    let i = 0;
    const step = () => {
      if (!this.bar || i >= sc.lines.length) { if (!this.manual) this._fadeOut(el); this._step = null; return; }
      const l = sc.lines[i++];
      const c = CHARACTERS[l.ch];
      el.style.setProperty('--dlg-side', sideColor(l.ch));
      // 非固定班底臨時插話:借用該端頭像(框色跟著發言者走,下一句自動歸位)
      const av = facOf(l.ch) === 'STEEL' ? avR : avL;
      if (av && av.dataset.ch !== l.ch) { av.src = avatarURL(l.ch); av.dataset.fac = facOf(l.ch); av.dataset.ch = l.ch; }
      for (const a of [avL, avR]) a?.classList.toggle('on', a === av);
      who.textContent = c ? `「${c.code}」${c.name}` : l.ch;
      txt.textContent = l.t;
      this.at = i;                       // Current line index (storybook progress indicator; unused in live gameplay)
      if (!this.manual) this._after(lineMs(l.t), step);
    };
    this._step = step;
    this.total = sc.lines.length;
    step();
  }

  /** Advance one line in manual mode; returns false when final line reached. */
  next() {
    if (!this._step) return false;
    this._step();
    return !!this._step;
  }

  _fadeOut(el) {
    el.classList.add('out');
    this._after(420, () => { el.remove(); if (this.bar === el) this.bar = null; });
  }

  /**
   * Full scenario transcript view for settlement screen (base stage).
   * Lines fade in sequentially with staggered timers to establish narrative pacing.
   * @param {HTMLElement} host Container element within settlement modal
   */
  scene(host, sc) {
    if (!host || !sc?.lines?.length) return null;
    // Portraits display the two most frequent speakers in this scenario
    const tally = new Map();
    for (const l of sc.lines) tally.set(l.ch, (tally.get(l.ch) || 0) + 1);
    const leads = [...tally.entries()].sort((a, b) => b[1] - a[1]).slice(0, 2).map(([id]) => id)
      .sort((a, b) => (facOf(a) === 'STEEL' ? 1 : 0) - (facOf(b) === 'STEEL' ? 1 : 0));
    const wrap = document.createElement('div');
    wrap.className = 'dlg-scene';
    wrap.innerHTML = `
      <div class="dlg-scene-h"><b>${esc(sc.title)}</b><span>${esc(sc.note)}</span></div>
      <div class="dlg-scene-body">
        ${leads.map((id, k) => `<img class="dlg-art dlg-art-${k ? 'r' : 'l'}" src="${esc(portraitURL(id))}"
             alt="" draggable="false" style="--dlg-side:${sideColor(id)}">`).join('')}
        <div class="dlg-script"></div>
      </div>`;
    const script = wrap.querySelector('.dlg-script');
    host.appendChild(wrap);
    sc.lines.forEach((l, i) => {
      const c = CHARACTERS[l.ch];
      const fac = facOf(l.ch);
      const row = document.createElement('div');
      // SWARM 系頭像在左 / STEEL 在右(與無線電條同序);傭兵固定左、金色雙框
      row.className = 'dlg-say' + (fac === 'STEEL' ? ' flip' : '');
      row.dataset.fac = fac;
      row.style.setProperty('--dlg-side', sideColor(l.ch));
      row.innerHTML = `<img class="dlg-av" src="${esc(avatarURL(l.ch))}" alt="" draggable="false" data-fac="${fac}">
        <div class="dlg-txt"><span class="dlg-who">${esc(c ? `「${c.code}」${c.name}` : l.ch)}</span>
        <span class="dlg-line">${esc(l.t)}</span></div>`;
      script.appendChild(row);
      this._after(180 + i * 260, () => { row.classList.add('on'); row.scrollIntoView({ block: 'nearest' }); });
    });
    return wrap;
  }

  /**
   * Siege stage progress bar: indicates current attackable stage (names sourced from `SIEGE.NAMES`).
   * @param {number|null} open Currently active enemy stage index; null collapses the bar (non-campaign mode)
   */
  track(open) {
    if (!this.root) return;
    let el = this.root.querySelector('.dlg-track');
    if (open == null) { el?.remove(); return; }
    if (!el) { el = document.createElement('div'); el.className = 'dlg-track'; this.root.appendChild(el); }
    el.innerHTML = SIEGE.NAMES.map((n, i) => {
      const st = i < open ? 'done' : i === open ? 'now' : 'lock';
      const mark = st === 'done' ? '✓' : st === 'now' ? '▶' : '🔒';
      return `<span class="dlg-step ${st}">${mark} ${esc(n)}</span>`;
    }).join('<i>›</i>');
  }

  /** Clear active dialogue bar on death, stage transition, or room exit; progress bar remains intact. */
  clear() {
    for (const t of this.timers) clearTimeout(t);
    this.timers.clear();
    this.bar?.remove();
    this.bar = null;
    this._step = null;
    this.at = 0; this.total = 0;
  }

  dispose() {
    this.clear();
    if (this.root) this.root.innerHTML = '';
  }
}
