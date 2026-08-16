// ============ 招式立繪演出(Cut-in)============
// 對應 doc/drone_vs_robot_fps_dota_plan.html「2D Comic Billboard VFX」:
// 施放大招/小招時,以粗體斜角漫畫字 + 立繪滑入 + 徑向速度線呈現,搭配鏡頭震動。
//
// 純 DOM overlay(不進 3D 場景):立繪是 2D 素材,拉進 Three.js 只會多一層 billboard 排序問題;
// 且戰鬥中 UI 層本來就在 canvas 之上。所有動畫走 CSS,JS 只負責掛/卸節點。
//
// 三種強度:
//   ult  自己  → full  全屏立繪 + 大字幕(1.3s)
//   skill 自己 → mini  左下角小卡(0.8s)
//   ult  敵方  → warn  頂部警示條 + 敵方立繪(1.0s)
// 小招不做敵方演出(戰場上小招太頻繁,會蓋住視野)。

import { CHARACTERS, heroAbility } from './data.js';
import { portraitURL, avatarURL } from './portraits.js';

const DUR = { full: 1300, warn: 1000, mini: 800 };

export class CutIn {
  /** @param {HTMLElement} root 疊在 canvas 之上的空層 */
  constructor(root) {
    this.root = root;
    this.timers = new Set();
    // 斜向轉場(序 8 ④-1)的**選用**消費端。沒接上 ⇒ 一格都不會發生(原則 6):
    // 立繪本身是 DOM overlay,而幕是後製 pass ⇒ 兩者只在「同一個施放事件」上會合。
    this.pipeline = null;
  }

  /**
   * 接上後製管線(`game.js` 建完 pipeline 之後一行:`this.cutin.setPipeline(this.pipeline)`)。
   * **MUST NOT 由本檔自己去找 pipeline** —— 全專案有兩個 `new Pipeline`(戰場與設定頁樣品),
   * 模組級的「當下這一支」會在開設定頁時指到樣品那一支上。
   */
  setPipeline(p) { this.pipeline = p || null; }

  /**
   * @param {object} ev  伺服器 cast 事件(ch/slot/side/lvl)
   * @param {boolean} self 是不是自己施放
   * @param {string} sideColor 施放者陣營色
   */
  show(ev, self, sideColor) {
    if (!this.root) return;
    const c = CHARACTERS[ev.ch];
    if (!c) return;
    const isUlt = ev.slot === 'ult';
    if (!self && !isUlt) return;
    const mode = self ? (isUlt ? 'full' : 'mini') : 'warn';
    // 同強度只留最新一張:大招重疊時舊的立即讓位,不排隊
    this.root.querySelector(`.cutin.${mode}`)?.remove();

    const a = heroAbility(ev.ch, ev.slot, ev.lvl || 1);
    const el = document.createElement('div');
    el.className = `cutin ${mode}`;
    el.style.setProperty('--side', sideColor);
    el.innerHTML = mode === 'mini'
      ? `<img class="cut-av" src="${avatarURL(ev.ch)}" alt="">
         <div class="cut-mini-txt"><b>${esc(a.name)}</b><span>${esc(c.code)}</span></div>`
      : `<div class="cut-lines"></div>
         <img class="cut-art" src="${portraitURL(ev.ch)}" alt="">
         <div class="cut-band">
           <div class="cut-who">${mode === 'warn' ? '⚠ 敵方 ' : ''}「${esc(c.code)}」${esc(c.name)}</div>
           <div class="cut-name">${esc(a.name)}</div>
           <div class="cut-sub">${esc(a.desc || '')}${ev.lvl ? ` ・ Lv${ev.lvl}` : ''}</div>
         </div>`;
    this.root.appendChild(el);
    const t = setTimeout(() => { el.remove(); this.timers.delete(t); }, DUR[mode]);
    this.timers.add(t);
    // 自己的大招那一格才刷屏(`full`):小卡與敵方警示條在戰鬥中太頻繁,蓋住視野就是玩法改動。
    // 幕色吃**施放者的陣營色**(呼叫端已經算好的那一個)—— 幕色刻意不住 `data.js WIPE`,
    // 那會變成與 `toon.js OUTLINE_COLOR` 並存的第二份墨色。
    if (mode === 'full') this.wipe(sideColor);
  }

  /**
   * 遮幕 → 揭幕的一次刷屏。旋鈕關著時 `playWipe` 會**同步**走回呼並回 false ⇒
   * 這一支整條退化成「呼叫兩次早退」,連時序都逐位元同舊制。
   * 回呼由**幀迴圈**觸發(`Pipeline._tickWipe`),本檔的 `timers` 一格都不用動。
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
    this.pipeline = null;   // 幕的回呼抓著 this ⇒ 離場 MUST 斷掉(管線自己也會清 _wipe)
    if (this.root) this.root.innerHTML = '';
  }
}

const esc = (s) => String(s).replace(/[&<>"]/g, (m) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[m]));
