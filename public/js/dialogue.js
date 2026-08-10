// ============ 劇情戰役:階段對話演出(純 DOM overlay)============
// 內容住 `storytalk.js`、階段順序住 `data.js SIEGE`、觸發住伺服器的 `siege` 事件;
// 本檔**只負責畫**,不認得章節、不判階段、不決定誰該說話(同 worldtext ↔ vernacular 的分工)。
//
// 兩種演出,差別只在「戰鬥還在不在跑」:
//   radio  戰鬥中(前線 / 中段兩階)——下緣單行對話條,逐句自動推進,**不擋畫面、不吃輸入**。
//          伺服器沒有暫停(rooms.js 全程 8Hz),把終場那種讀秒的演出塞進即時戰鬥 =
//          玩家一邊讀一邊被打死;所以戰鬥中的兩場刻意做成無線電閒聊,推進的路上聽完。
//   scene  結算畫面(主堡那一階)——全篇逐句浮現的對照稿 + 兩側立繪,可以自己重讀。
//          主堡一倒就 gameOver,對話沒有時間在戰場上播完 —— 那一場天生屬於結算畫面。
//
// 三條紀律:
//   ①**逐句切換 MUST NOT 靠 CSS transition**(與 `.blood-splat` / `.cc-flash` 同一條):
//     對話條每 1.6~4 秒整行換掉,補間會把上一句拖成殘影,讀起來像疊字。淡入只給**整條**
//     的出現/消失(那是一次性的),不給行內文字。
//   ② 定時器全部登記進 `this.timers`,`clear()` / `dispose()` 一次收乾淨 —— 陣亡、離場、
//     換章都會在對話播到一半時發生,漏收就會在下一場戰役裡冒出上一場的台詞。
//   ③ 文字一律 `esc()`;台詞是資料不是標記(storytalk 那邊也有一道稽核擋 `<>&`)。

import { CHARACTERS, SIDES, SIEGE } from './data.js';
import { avatarURL, portraitURL } from './portraits.js';

/** 單句停留秒數:短句不至於一閃而過、長句讀得完(字數線性 + 上下限) */
const lineMs = (s) => Math.max(1700, Math.min(4200, 900 + String(s).length * 140));

const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (m) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[m]));

/** 角色的陣營色(傭兵用中立金);頭像框與名條同吃 */
const sideColor = (id) => {
  const c = CHARACTERS[id];
  if (!c) return '#b9a06a';
  return c.side === 'MERC' ? '#b9a06a' : SIDES[c.side].color;
};

export class Dialogue {
  /** @param {HTMLElement} root 疊在 canvas 之上的空層(#dialogueLayer) */
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
   * 戰鬥中的無線電對話條(前線 / 中段兩階)。
   * @param {object} sc storytalk 的一場 `{ title, note, lines }`
   * @param {object} [opt] `{ manual }` —— **只給本地故事書用**:不自動推進,由 `next()` 逐句翻。
   *   遊戲本體 MUST NOT 傳 `manual`(戰鬥中沒有人能按「下一句」,而漏按就是對白永遠停在第一句);
   *   不傳時整條路徑逐位元同舊制。稽核 `audit_story_talk` Ⅵ 釘住「main.js 不得出現 manual」。
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
        <img class="dlg-av" src="" alt="" draggable="false">
        <div class="dlg-txt"><span class="dlg-who"></span><span class="dlg-line"></span></div>
      </div>`;
    this.root.appendChild(el);
    const av = el.querySelector('.dlg-av');
    const who = el.querySelector('.dlg-who');
    const txt = el.querySelector('.dlg-line');
    let i = 0;
    const step = () => {
      if (!this.bar || i >= sc.lines.length) { if (!this.manual) this._fadeOut(el); this._step = null; return; }
      const l = sc.lines[i++];
      const c = CHARACTERS[l.ch];
      el.style.setProperty('--dlg-side', sideColor(l.ch));
      av.src = avatarURL(l.ch);
      who.textContent = c ? `「${c.code}」${c.name}` : l.ch;
      txt.textContent = l.t;
      this.at = i;                       // 已播到第幾句(故事書的頁碼顯示;遊戲不讀)
      if (!this.manual) this._after(lineMs(l.t), step);
    };
    this._step = step;
    this.total = sc.lines.length;
    step();
  }

  /** 逐句翻頁(只有 `manual` 模式有意義);回 false = 已經是最後一句 */
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
   * 結算畫面的全篇對照稿(主堡那一階)。回傳掛好的節點,呼叫端自己決定塞在哪。
   * 逐句**浮現**(每句一個 timer),而不是一次全出 —— 讀的節奏本身就是演出的一部分。
   * @param {HTMLElement} host 容器(結算面板裡的一格)
   */
  scene(host, sc) {
    if (!host || !sc?.lines?.length) return null;
    // 兩側立繪 = 這一場開口最多的兩個人(不寫死主角:傭兵場、多對多場都要成立)
    const tally = new Map();
    for (const l of sc.lines) tally.set(l.ch, (tally.get(l.ch) || 0) + 1);
    const leads = [...tally.entries()].sort((a, b) => b[1] - a[1]).slice(0, 2).map(([id]) => id);
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
      const row = document.createElement('div');
      row.className = 'dlg-say';
      row.style.setProperty('--dlg-side', sideColor(l.ch));
      row.innerHTML = `<img class="dlg-av" src="${esc(avatarURL(l.ch))}" alt="" draggable="false">
        <div class="dlg-txt"><span class="dlg-who">${esc(c ? `「${c.code}」${c.name}` : l.ch)}</span>
        <span class="dlg-line">${esc(l.t)}</span></div>`;
      script.appendChild(row);
      this._after(180 + i * 260, () => { row.classList.add('on'); row.scrollIntoView({ block: 'nearest' }); });
    });
    return wrap;
  }

  /**
   * 攻堅進度條:目前打得動的是哪一階(名稱走 `SIEGE.NAMES`,本檔不自寫「前線砲塔」四個字)。
   * @param {number|null} open 敵方目前開放的階段索引;null = 收起(非劇情戰役)
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

  /** 收掉正在播的對話條(陣亡 / 換階 / 離場);進度條不受影響 */
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
