// ============ Ability Cut-in Presentation ============
// Implements 2D comic billboard VFX: bold angled typography + character portrait slide-in + radial speedlines + camera shake.
// (Offensive ability = ult slot, defensive ability = skill slot; casting during shield mode is always defensive, see data.js ABIL_NATURE).
//
// Pure DOM overlay outside 3D scene: 2D cut-in art avoids Three.js billboard depth sorting issues,
// and HUD layer already sits above canvas. CSS drives animations; JS handles mount/unmount lifecycle.
//
// Intensity levels:
//   ult  (self)  -> full  full-screen portrait + banner (1.3s)
//   skill (self) -> mini  bottom-left thumbnail card (0.8s)
//   ult  (enemy) -> warn  top warning bar + enemy portrait (1.0s)
// Defensive abilities do not trigger enemy presentation to avoid obstructing combat visibility.

import { CHARACTERS, heroAbility } from './data.js';
import { cutinArtURL } from './portraits.js';

const DUR = { full: 1300, warn: 1000, mini: 800 };

export class CutIn {
  /** @param {HTMLElement} root Container layer mounted above canvas. */
  constructor(root) {
    this.root = root;
    this.timers = new Set();
    // Optional consumer for diagonal wipe transitions. If disconnected, no transition runs (degrade by omission):
    // Cut-in is DOM overlay while wipe is post-process pass; both synchronize on the same cast event.
    this.pipeline = null;
  }

  /**
   * Bind post-process pipeline (wired by game.js after pipeline construction).
   * MUST NOT query pipeline globally: two Pipeline instances coexist (match and settings sample),
   * and a module-level pointer would bind to the settings sample on menu open.
   */
  setPipeline(p) { this.pipeline = p || null; }

  /**
   * @param {object} ev Server cast event (ch/slot/side/lvl).
   * @param {boolean} self True if cast by local player.
   * @param {string} sideColor Caster faction color.
   */
  show(ev, self, sideColor) {
    if (!this.root) return;
    const c = CHARACTERS[ev.ch];
    if (!c) return;
    const isUlt = ev.slot === 'ult';
    if (!self && !isUlt) return;
    const mode = self ? (isUlt ? 'full' : 'mini') : 'warn';
    // Retain latest cut-in per intensity: overlapping ultimates yield immediately without queuing.
    this.root.querySelector(`.cutin.${mode}`)?.remove();

    const a = heroAbility(ev.ch, ev.slot, ev.lvl || 1);
    const el = document.createElement('div');
    el.className = `cutin ${mode}`;
    el.style.setProperty('--side', sideColor);
    el.innerHTML = mode === 'mini'
      ? `<img class="cut-av" src="${cutinArtURL(ev.ch, 'skill')}" alt="">
         <div class="cut-mini-txt"><b>${esc(a.name)}</b><span>${esc(c.code)}</span></div>`
      : `<div class="cut-lines"></div>
         <img class="cut-art" src="${cutinArtURL(ev.ch, 'ult')}" alt="">
         <div class="cut-band">
           <div class="cut-who">${mode === 'warn' ? '⚠ 敵方 ' : ''}「${esc(c.code)}」${esc(c.name)}</div>
           <div class="cut-name">${esc(a.name)}</div>
           <div class="cut-sub">${esc(a.desc || '')}${ev.lvl ? ` ・ Lv${ev.lvl}` : ''}</div>
         </div>`;
    this.root.appendChild(el);
    const t = setTimeout(() => { el.remove(); this.timers.delete(t); }, DUR[mode]);
    this.timers.add(t);
    // Trigger screen wipe only on local ultimate (full); frequent mini/warn wipes obstruct combat visibility.
    // Screen wipe uses caster faction color calculated by caller to avoid maintaining duplicate palette in data.js WIPE.
    if (mode === 'full') this.wipe(sideColor);
  }

  /**
   * Full wipe pass (cover -> reveal). When wipe is toggled off, playWipe executes callback synchronously
   * and returns false, cleanly degrading to two early returns with matching execution order.
   * Callbacks are driven by render loop (Pipeline._tickWipe); timers set is untouched.
   */
  wipe(color) {
    const p = this.pipeline;
    if (!p) return false;
    const opt = { color };
    return p.playWipe('cover', () => this.pipeline?.playWipe('reveal', null, opt), opt);
  }

  dispose() {
    for (const t of this.timers) clearTimeout(t);
    this.timers.clear();
    this.pipeline = null; // Wipe callback captures this; MUST disconnect on tear-down.
    if (this.root) this.root.innerHTML = '';
  }
}

const esc = (s) => String(s).replace(/[&<>"]/g, (m) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[m]));
