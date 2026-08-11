// ============ 本地故事書:頁面控制(dev-only)============
// 這支**只做兩件事**:決定現在停在哪一頁、把真品的標記/演出掛上去。
// 它自己**一行劇情文字、一條版面規則都不產生** —— 內容住 story.js / storytalk.js,
// 標記住 storyui.js,演出住 dialogue.js,樣式住 public/css/style.css。
// 在這裡多寫一個 `<div class="像簡報的東西">` 就是第二份版面(見 tools/story_book.mjs 檔頭)。

import { SIDES, SIEGE } from '/public/js/data.js';
import { STORY, WORLD, chapterSide } from '/public/js/story.js';
import { talkOf, stageKey } from '/public/js/storytalk.js';
import { chapterCardHTML, briefHTML, overText, esc, venueName } from '/public/js/storyui.js';
import { Dialogue } from '/public/js/dialogue.js';

const $ = (id) => document.getElementById(id);
const SIDES2 = ['STEEL', 'SWARM'];

/** 頁序推導自 `SIEGE.STAGES`(與 tools/story_book.mjs `pagesOf` 同一條規則,MUST NOT 手寫五頁) */
const PAGES = [
  { key: 'brief', label: '開戰簡報' },
  ...SIEGE.STAGES.map((_, i) => ({ key: `talk:${i}`, label: `${SIEGE.NAMES[i]}・對話`, stage: i })),
  { key: 'over', label: '戰役結算' },
];

const st = { side: 'STEEL', ch: 0, page: 0 };
let dlg = null;

// ---------------------------------------------------------------------------
// 側欄
// ---------------------------------------------------------------------------
function renderSide() {
  document.body.dataset.side = st.side;
  $('bkSides').querySelectorAll('.segb').forEach((b) => b.classList.toggle('on', b.dataset.side === st.side));
  // 章節卡走**真品** `chapterCardHTML`,全部以 `unlocked: true` 呈現 ——
  // 「不用真的通關」在這裡就只是這個參數,MUST NOT 改去寫 localStorage 的通關進度
  $('bkChapters').innerHTML = STORY
    .map((ch, i) => chapterCardHTML(ch, i, st.side, { unlocked: true, cleared: false })).join('');
  $('bkChapters').querySelectorAll('button.chapter-card').forEach((b) => {
    b.classList.toggle('bk-on', Number(b.dataset.i) === st.ch);
    b.onclick = () => { st.ch = Number(b.dataset.i); st.page = 0; render(); };
  });
}

function renderPages() {
  $('bkPages').innerHTML = PAGES.map((p, i) => {
    const miss = p.stage != null && !talkOf(STORY[st.ch].id, st.side, stageKey(p.stage));
    return `<button class="bk-page${i === st.page ? ' on' : ''}${miss ? ' miss' : ''}" data-p="${i}">`
      + `<i>${i + 1}</i>${esc(p.label)}${miss ? ' ⚠' : ''}</button>`;
  }).join('');
  $('bkPages').querySelectorAll('.bk-page').forEach((b) => {
    b.onclick = () => { st.page = Number(b.dataset.p); render(); };
  });
}

// ---------------------------------------------------------------------------
// 主畫面:一頁一種呈現,全部用遊戲的真品節點結構
// ---------------------------------------------------------------------------
function render() {
  const ch = STORY[st.ch];
  const sc = chapterSide(ch, st.side);
  renderSide();
  renderPages();
  $('bkWhere').textContent = `${ch.act} ・ ${sc.title}`;
  $('bkWhere2').textContent = `${venueName(ch)} ・ ${SIDES[st.side].name}視角 ・ 第 ${st.page + 1}/${PAGES.length} 頁`;
  $('bkPrev').disabled = st.ch === 0 && st.page === 0;
  $('bkNext').disabled = st.ch === STORY.length - 1 && st.page === PAGES.length - 1;

  dlg?.dispose();
  dlg = null;
  const stage = $('bkStage');
  stage.innerHTML = '';
  const p = PAGES[st.page];

  if (p.key === 'brief') return pageBrief(stage, ch, sc);
  if (p.key === 'over') return pageOver(stage, ch);
  return pageTalk(stage, ch, p.stage);
}

/** 開戰簡報:與遊戲的 `#storyBrief` 同一份標記(storyui.briefHTML),連選主駕都會動 */
function pageBrief(stage, ch, sc) {
  const roster = [...sc.heroes, ...sc.mercs];
  // 節點結構照抄 index.html 的 `#storyBrief`(overlay-box > story-brief-box > story-brief-body)——
  // 少一層外框,`.sb-cine` 的 `width:100%` 就找不到寬度來源,整條全幅立繪塌成 0px
  const box = document.createElement('div');
  box.className = 'overlay-box story-brief-box bk-sheet';
  box.innerHTML = `<div class="story-brief-body">${briefHTML(ch, st.ch, st.side, roster[0])}</div>`;
  stage.appendChild(box);
  // 主駕小卡的選取行為照抄遊戲(點了只換高亮 —— 故事書沒有「出擊」)
  const chips = box.querySelector('#sbYourChips');
  chips?.querySelectorAll('.sb-chip').forEach((btn) => {
    btn.onclick = () => chips.querySelectorAll('.sb-chip').forEach((b) => b.classList.toggle('on', b === btn));
  });
  stage.appendChild(note('這一頁就是遊戲裡按下章節後看到的簡報(同一份 storyui.briefHTML + 同一份 style.css)。'
    + '差別只有:故事書不會出擊。'));
}

/**
 * 階段對話。**演出用遊戲的那一支 `dialogue.js`**:
 *   前線 / 中段 → `radio()` 下緣對話條(戰鬥中的樣子)+ `track()` 攻堅進度條
 *   主堡      → `scene()` 全篇對照稿,掛在真品 `.overlay-box` 裡(結算畫面的樣子)
 * 故事書多的只有「▶ 自動播 / ⏭ 逐句 / ↻ 重播」—— 那是**翻頁**,不是另一種呈現。
 */
function pageTalk(stage, ch, si) {
  const talk = talkOf(ch.id, st.side, stageKey(si));
  if (!talk) { stage.appendChild(note('⚠ 這一階還沒有對白(storytalk.js 缺這一格)。')); return; }

  if (si === SIEGE.BASE) {
    const over = document.createElement('div');
    over.className = 'bk-sheet bk-overlay';
    over.innerHTML = `<div class="overlay-box"><div class="over-title"></div>
      <div class="over-sub"></div><div id="bkTalkHost"></div></div>`;
    const ot = overText(ch, st.side, true);
    over.querySelector('.over-title').textContent = ot.title;
    over.querySelector('.over-title').style.color = ot.color;
    over.querySelector('.over-sub').textContent = ot.sub;
    stage.appendChild(over);
    dlg = new Dialogue(document.createElement('div'));   // scene() 掛在 host,不需要疊層
    dlg.scene(over.querySelector('#bkTalkHost'), talk);
    stage.appendChild(bar([['↻ 重播', () => render()]]));
    stage.appendChild(note('主堡那一階的對白在**結算畫面**播 —— 主堡一倒就結束戰鬥,'
      + '戰鬥中沒有暫停,那一場天生沒有時間在戰場上演完。'));
    return;
  }

  // 戰鬥中的無線電條:真品 `.dlg-layer` 疊在一塊「示意戰場」上(背景取該章簡報立繪)
  const field = document.createElement('div');
  field.className = 'bk-sheet bk-field';
  const sc = chapterSide(ch, st.side);
  if (sc.img) field.style.backgroundImage = `url("${sc.img.replace(/"/g, '')}")`;
  const layer = document.createElement('div');
  layer.className = 'dlg-layer';
  field.appendChild(layer);
  stage.appendChild(field);

  dlg = new Dialogue(layer);
  dlg.track(si + 1);                    // 這一階剛被推平 ⇒ 進度條停在下一階
  const play = (manual) => { dlg.clear(); dlg.track(si + 1); dlg.radio(talk, { manual }); };
  play(true);                           // 預設逐句:故事書是拿來讀的
  stage.appendChild(bar([
    ['⏭ 下一句(空白鍵)', () => { if (!dlg.next()) play(true); }],
    ['▶ 自動播(遊戲的節奏)', () => play(false)],
    ['↻ 重播', () => play(true)],
  ]));
  stage.appendChild(note('這一頁是戰鬥中的樣子:對話條不擋畫面、逐句自動推進,'
    + '上方是攻堅進度條(前線砲塔 › 中段砲塔 › 主堡)。背景只是示意,真正的戰場是 3D 場景。'));
}

/** 戰役結算:真品 `.overlay-box` + storyui.overText 的勝敗文案,兩種結果並排 */
function pageOver(stage, ch) {
  const wrap = document.createElement('div');
  wrap.className = 'bk-sheet bk-overs';
  for (const won of [true, false]) {
    const ot = overText(ch, st.side, won);
    const box = document.createElement('div');
    box.className = 'overlay-box';
    box.innerHTML = `<div class="over-title"></div><div class="over-sub"></div>`;
    box.querySelector('.over-title').textContent = ot.title;
    box.querySelector('.over-title').style.color = ot.color;
    box.querySelector('.over-sub').textContent = ot.sub;
    wrap.appendChild(box);
  }
  stage.appendChild(wrap);
  stage.appendChild(note('勝敗兩種結果並排 —— 遊戲裡一次只會看到其中一個(文案同一份 storyui.overText)。'
    + '勝利時,主堡那一階的對白會接在標題底下播。'));
}

// ---------------------------------------------------------------------------
const note = (t) => { const d = document.createElement('div'); d.className = 'bk-note'; d.textContent = t; return d; };
const bar = (btns) => {
  const d = document.createElement('div');
  d.className = 'bk-tools';
  for (const [label, fn] of btns) {
    const b = document.createElement('button');
    b.className = 'btn'; b.textContent = label; b.onclick = fn;
    d.appendChild(b);
  }
  return d;
};

/** 翻頁:頁到底就換章,章到底就停(與側欄的直接點選是同一個狀態) */
function flip(d) {
  let p = st.page + d, c = st.ch;
  if (p < 0) { c--; p = PAGES.length - 1; }
  if (p >= PAGES.length) { c++; p = 0; }
  if (c < 0 || c >= STORY.length) return;
  st.ch = c; st.page = p; render();
}

$('bkPrev').onclick = () => flip(-1);
$('bkNext').onclick = () => flip(1);
$('bkSides').onclick = (e) => {
  const b = e.target.closest('.segb');
  if (!b || b.dataset.side === st.side) return;
  st.side = b.dataset.side; render();
};
addEventListener('keydown', (e) => {
  if (e.key === 'ArrowRight') flip(1);
  else if (e.key === 'ArrowLeft') flip(-1);
  else if (e.key === 'ArrowDown') { if (st.ch < STORY.length - 1) { st.ch++; st.page = 0; render(); } }
  else if (e.key === 'ArrowUp') { if (st.ch > 0) { st.ch--; st.page = 0; render(); } }
  else if (e.key === 'Tab') { e.preventDefault(); st.side = st.side === 'STEEL' ? 'SWARM' : 'STEEL'; render(); }
  else if (e.key === ' ') { e.preventDefault(); if (dlg?.manual && !dlg.next()) render(); }
  else return;
  e.preventDefault?.();
});

// 世界觀當開場白(story.js 的 WORLD,原文照登)
$('bkStage').innerHTML = '';
render();
$('bkChapters').insertAdjacentHTML('beforebegin',
  `<details class="bk-world"><summary>◈ 世界觀</summary><div>${esc(WORLD).replace(/\n\n+/g, '</div><div>')}</div></details>`);
