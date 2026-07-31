// ============ 懸浮提示(遊戲內 GUI 說明的唯一縫)============
// 2026-07-31 使用者定案:**遊戲內 GUI 的常駐說明文字一律改成懸浮提示**,內容同時彙整到
// 戰場選單的「說明」分頁(help.js `UI_TIPS` → 說明分頁「介面」類)。
//
// 為什麼要有這一支:常駐說明把每一個選項列都撐成兩三行,窄屏尤其把按鍵擠出摺線(見 A20);
// 但把字直接刪掉又等於資訊消失。折衷 = 字收進 `data-tip`,列上只留一顆 ⓘ 標記,
// 想看再看;同一份字另從 help.js 進說明分頁,離線也翻得到。
//
// **單一縫**:全站只有這一份提示氣泡實作 —— 消費端 MUST 只做兩件事:
//   ① 掛 `data-tip="…"`(任何元素都行,滑鼠移上去/觸控長按即顯示);
//   ② 需要一顆看得見的標記時用 `tipHTML(text)` / `attachTip(el, text)`。
// MUST NOT 另寫第二套氣泡、MUST NOT 退回 `title=`(手機沒有 hover,原生 tooltip 在觸控上永遠不出現)。
//
// 純表現層:不碰任何權威狀態,也不參與伺服器結算。

let _bubble = null;      // 唯一氣泡節點(延遲建立)
let _anchor = null;      // 目前顯示中的錨點
let _lpTimer = 0;        // 觸控長按計時器
let _viaHover = false;   // 目前這一次顯示是不是滑鼠移上去帶出來的(決定點擊該收還是該留)
let _installed = false;

const LONG_PRESS_MS = 380;   // 觸控長按門檻(短於此 = 一般點擊,不能吃掉選項的點選)
const EDGE = 8;              // 氣泡離視窗邊界的最小留白

const _esc = (t) => String(t).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

/** 提示標記的 HTML(消費端唯一取字處;要在樣板字串裡插入時用這支)*/
export function tipHTML(text, cls = '') {
  return `<button class="tip-dot${cls ? ` ${cls}` : ''}" type="button" aria-label="說明" data-tip="${_esc(text)}">ⓘ</button>`;
}

/** 提示標記的 DOM 版(要 append 到既有節點時用這支;回傳建好的按鈕)*/
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
 * 把提示掛到既有元素上(元素本身就是錨點,不另長標記)。
 * 空字串 = 移除提示(動態列刷新時用得到)。
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

/** 顯示提示;錨點沒有 `data-tip` 就當作沒事發生 */
export function showTip(el) {
  const text = el?.dataset?.tip;
  if (!text) return;
  const b = ensureBubble();
  b.textContent = text;
  b.hidden = false;
  _anchor = el;
  el.classList.add('tip-open');

  // 定位:預設貼在錨點正下方靠左對齊,超出視窗就往回夾。
  // MUST 先量氣泡自身尺寸(已 !hidden 才量得到),否則右緣夾制會用到 0 寬。
  b.style.left = '0px';
  b.style.top = '0px';
  const a = el.getBoundingClientRect();
  const r = b.getBoundingClientRect();
  const vw = document.documentElement.clientWidth, vh = document.documentElement.clientHeight;
  let x = a.left;
  let y = a.bottom + 6;
  if (x + r.width > vw - EDGE) x = vw - EDGE - r.width;
  if (x < EDGE) x = EDGE;
  if (y + r.height > vh - EDGE) y = a.top - 6 - r.height;   // 下方放不下就翻到上方
  if (y < EDGE) y = EDGE;
  b.style.left = `${Math.round(x)}px`;
  b.style.top = `${Math.round(y)}px`;
}

/** 收起提示(重複呼叫安全)*/
export function hideTip() {
  clearTimeout(_lpTimer);
  _lpTimer = 0;
  if (_anchor) _anchor.classList.remove('tip-open');
  _anchor = null;
  if (_bubble) _bubble.hidden = true;
}

/**
 * 全域安裝(冪等)。事件一律用委派掛在 document 上 ——
 * 提示標記是動態產生的(房間列、商店、圖鑑每次重繪都換一批節點),
 * 逐節點綁定 MUST NOT:重繪後就失效,而且是漏綁在先、找不到原因在後。
 */
export function installTips() {
  if (_installed) return;
  _installed = true;

  const anchorOf = (t) => (t instanceof Element ? t.closest('[data-tip]') : null);

  // 滑鼠:移入即顯示、移出即收起(pointerover/out 會冒泡,mouseenter 不會 ⇒ 委派只能用前者)
  document.addEventListener('pointerover', (e) => {
    if (e.pointerType === 'touch') return;
    const el = anchorOf(e.target);
    if (el && el !== _anchor) { showTip(el); _viaHover = true; }
  });
  document.addEventListener('pointerout', (e) => {
    if (e.pointerType === 'touch') return;
    if (_anchor && !_anchor.contains(e.relatedTarget)) hideTip();
  });

  // 觸控:長按顯示。短按 MUST 原樣放行 —— 提示可以掛在選項按鈕上,
  // 在這裡吃掉點擊等於整顆鈕失效(A19 一族的「看得到按不到」)。
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

  // ⓘ 標記本身:點一下就切換(觸控不必長按、鍵盤 Enter/Space 也走這條)。
  // `_viaHover` 是必要的:滑鼠移上去已經先顯示了,若在這裡無條件 toggle,
  // 「移上去看到 → 點一下」會立刻把它關掉,看起來像點了沒反應。
  document.addEventListener('click', (e) => {
    const dot = e.target instanceof Element ? e.target.closest('.tip-dot') : null;
    if (!dot) return;
    e.preventDefault();
    e.stopPropagation();
    if (_anchor === dot && !_viaHover) hideTip();
    else { showTip(dot); _viaHover = false; }
  });

  // 鍵盤聚焦帶出提示。`.tip-dot` 例外 —— 它是按鈕,點擊時 focusin 會先於 click 觸發,
  // 在這裡跟著顯示會讓上面那條 toggle 永遠處在「剛被打開」的狀態。
  document.addEventListener('focusin', (e) => {
    const el = anchorOf(e.target);
    if (el && !el.classList.contains('tip-dot')) { showTip(el); _viaHover = false; }
  });
  document.addEventListener('focusout', () => hideTip());
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') hideTip(); });
  // 捲動/轉向後錨點就跑掉了 —— 氣泡是 position:fixed,留著會浮在錯的地方
  window.addEventListener('scroll', () => hideTip(), true);
  window.addEventListener('resize', () => hideTip());
}
