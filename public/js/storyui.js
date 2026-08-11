// ============ 劇情戰役的畫面標記(章節卡 / 開戰簡報 / 結算文案)============
// **兩個消費端共用的唯一縫**:遊戲本體 `main.js` 與本地故事書 `tools/story_book/`。
//
// 為什麼要抽出來:使用者要的故事書是「**完全仿照正式遊戲的呈現**,只是可以隨時換頁」。
// 那句話的工程意思只有一個 —— 兩邊 MUST 是**同一份標記 + 同一份 CSS**。
// 對照台各寫一份「長得很像」的版面,下場是它從此獨立演化:遊戲裡改了簡報排版、故事書沒跟上,
// 而你在故事書裡看到的東西**從來沒有在遊戲裡出現過** —— 那就不叫覆核,叫看另一個作品。
// 同一條理由讓對話演出直接沿用 `dialogue.js`(它本來就只負責畫),沒有第二份實作。
//
// 三條邊界:
//   ① **零 DOM、零 three** —— 只出 HTML 字串。本檔(與它 import 的 data/story/venues/portraits/
//      npcicon)在 Node 端載得起來 ⇒ 離線稽核吃得到真品,不必讀原文用 regex 猜。
//      故 `envLabel` 取自 `data.js` 而不是 `environment.js`(後者 import three)。
//   ② **不碰狀態** —— 解鎖/通關/選中主駕一律由呼叫端**傳進來**。故事書要的正是
//      「不用真的通關」,而那件事在這裡就只是 `unlocked: true` 這個參數,不是一條分支。
//   ③ **不綁事件** —— 卡片只帶 `data-i` / `data-ch`,點擊由各自的呼叫端委派。

import { SIDES, CHARACTERS, charKind, envLabel } from './data.js';
import { chapterSide } from './story.js';
import { VENUES } from './venues.js';
import { avatarURL } from './portraits.js';
import { kindIconHTML } from './npcicon.js';

export const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

/** 機種中文名(頭像角標的 aria-label / 角色卡機體行)—— 自 main.js 抽出的**同一份**,字面不動 */
export const kindLabelOf = (kind) => kind === 'drone' ? '無人機' : kind === 'morph' ? '變形者' : '機甲';

/**
 * **頭像 + 機種角標**(2026-08-02 使用者定案「設計無人機/機甲/變形者的圖示,標示在頭像旁邊」)。
 * 五處頭像(選角牆 / 放大視窗選角牆 / 劇情主駕小卡 / 角色卡立繪標籤 / 故事書)MUST 全走這一支 ——
 * 各拼一次 `<img>` + `<svg>` 就是五份會漂的標記,而「某一面牆沒有角標」在畫面上只像是漏渲染。
 * 機種一律取 `charKind(id)`(2026-08-02 混編後陣營 ≠ 機種,MUST NOT 由 side 推)。
 */
export function charAvatarHTML(id, cls = 'char-av') {
  const kind = charKind(id);
  return `<span class="av-wrap"><img class="${cls}" src="${esc(avatarURL(id))}" alt="" draggable="false">`
    + `<span class="av-kind" aria-label="${esc(kindLabelOf(kind))}">${kindIconHTML(kind)}</span></span>`;
}

/** 角色小卡(選主駕 / 敵方預覽 / 故事書陣容共用) */
export function heroChip(id, opts = {}) {
  const c = CHARACTERS[id] || {};
  const cls = 'sb-chip' + (opts.merc ? ' merc' : '') + (opts.on ? ' on' : '') + (opts.enemy ? ' enemy' : '');
  return `<button class="${cls}" data-ch="${esc(id)}"${opts.enemy ? ' disabled' : ''}>
      ${charAvatarHTML(id, 'sb-chip-av')}
      <span class="sb-chip-txt"><b>「${esc(c.code || '')}」</b>${esc(c.name || '')}${opts.merc ? '<i>傭兵</i>' : ''}</span>
    </button>`;
}

/** 場地顯示名(找不到就退回 id —— 缺資料要看得出來,MUST NOT 靜默留白) */
export const venueName = (ch) => VENUES.find((x) => x.id === ch.venueId)?.name || ch.venueId;

/** 章節的一行地點資訊(卡片與簡報頭共用,兩處分家 = 同一章兩種寫法) */
export const chapterMeta = (ch) =>
  `📍 ${esc(venueName(ch))} ・ ${esc(envLabel(ch.env))} ・ ${ch.teamSize}v${ch.teamSize}`;

/**
 * 章節卡。`unlocked`/`cleared` 由呼叫端給(遊戲讀 localStorage 進度,故事書一律全開)。
 * 回**整顆元素**的 HTML:`tag` 隨解鎖狀態換(可點的是 button)—— 兩邊各自 createElement
 * 就會出現「故事書的卡片不能用鍵盤 focus」這種只有無障礙才看得出來的分歧。
 */
export function chapterCardHTML(ch, i, side, { unlocked = true, cleared = false } = {}) {
  const sc = chapterSide(ch, side);
  const tag = unlocked ? 'button' : 'div';
  const state = cleared ? '<span class="chapter-state done">✓ 已通關</span>'
    : unlocked ? '<span class="chapter-state go">▶ 可出戰</span>'
    : '<span class="chapter-state lock">🔒 未解鎖</span>';
  return `<${tag} class="chapter-card${unlocked ? '' : ' locked'}${cleared ? ' cleared' : ''}" data-i="${i}">
      <span class="chapter-num">${i + 1}</span>
      <div class="chapter-body">
        <span class="chapter-title">${esc(ch.act)} ・ ${esc(sc.title)}</span>
        <span class="chapter-place">${chapterMeta(ch)}</span>
      </div>
      ${state}</${tag}>`;
}

/**
 * 開戰前簡報:全幅立繪 → 長篇敘事 → 雙方陣容(選主駕)→ 任務目標。
 * @param {string} pilot 目前選中的主駕 id(故事書照樣用它高亮,只是點了不會出擊)
 */
export function briefHTML(ch, i, side, pilot) {
  const foe = side === 'STEEL' ? 'SWARM' : 'STEEL';
  const sc = chapterSide(ch, side), ec = chapterSide(ch, foe);
  const cine = sc.img
    ? `<img class="sb-cine-img" src="${esc(sc.img)}" alt="${esc(sc.title)}" onerror="this.classList.add('sb-cine-fail')">`
    : '';
  const mercSet = new Set(sc.mercs);
  const yourChips = [...sc.heroes, ...sc.mercs]
    .map((id) => heroChip(id, { merc: mercSet.has(id), on: id === pilot })).join('');
  const foeMerc = new Set(ec.mercs);
  const foeChips = [...ec.heroes, ...ec.mercs].map((id) => heroChip(id, { merc: foeMerc.has(id), enemy: true })).join('');
  return `
    <div class="sb-cine sb-cine-${side}">
      ${cine}
      <div class="sb-cine-scrim"></div>
      <div class="sb-cine-corners"><i></i><i></i><i></i><i></i></div>
      <div class="sb-cine-tag">${side === 'STEEL' ? '協約 · 鋼鐵征討' : '同盟 · 蜂群逆襲'}</div>
      <div class="sb-cine-cap">
        <div class="sb-cine-act">${esc(ch.act)} ／ CH.${String(i + 1).padStart(2, '0')}</div>
        <div class="sb-cine-name">${esc(sc.title)}</div>
        <div class="sb-cine-meta">${chapterMeta(ch)}</div>
      </div>
    </div>
    <div class="sb-prose"><p class="sb-intro">${esc(sc.intro).replace(/\n\n+/g, '</p><p class="sb-intro">')}</p></div>
    <div class="sb-roster" style="--own:var(${side === 'STEEL' ? '--steel' : '--swarm'});--foe:var(${side === 'STEEL' ? '--swarm' : '--steel'})">
      <div class="sb-roster-h your">◈ 你的部隊 — 點選出戰主駕,其餘為 AI 僚機</div>
      <div class="sb-chips" id="sbYourChips">${yourChips}</div>
      <div class="sb-roster-h foe">✖ 當面之敵</div>
      <div class="sb-chips">${foeChips}</div>
    </div>
    <div class="sb-obj">${esc(sc.objective)}</div>`;
}

/**
 * 結算畫面的標題/敘述(劇情戰役)。**文案來源只有 story.js 的 `victory`/`defeat`** ——
 * 遊戲與故事書分別寫一句「任務達成」就會有兩種說法,而那正是玩家會拿來對照的地方。
 * 回 `{ title, sub, color }`;`color` 是 CSS 值(勝利取陣營色、失敗取警示色)。
 */
export function overText(ch, side, won) {
  const sc = chapterSide(ch, side);
  return {
    title: won ? '任務達成' : '任務失敗',
    sub: won ? sc.victory : sc.defeat,
    color: won ? SIDES[side].color : 'var(--danger)',
  };
}

/** 戰線進度列(章節選單底下那一行);`clearedN` 由呼叫端數 */
export const progressText = (side, clearedN, total) =>
  `${SIDES[side].name}戰線:已通關 ${clearedN} / ${total}`
  + (clearedN >= total ? ' ・ 🏆 全戰線肅清!' : '');
