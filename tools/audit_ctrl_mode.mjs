// ============ 操作方式 / 觀戰選單稽核(2026-07-31 使用者需求)============
// 用途:改 `public/js/ctrlmode.js`、`mobile.js` 的裝置判定/設定 UI、`game.js` 的
// `_setPaused`/`_applyCtrlScheme`/觀戰指標鎖定,或 `main.js` 的 TOUCH_UI 消費端之後跑這一支。
// 跑法:`node tools/audit_ctrl_mode.mjs [-v]`(純原文 + 真品直測,不需瀏覽器/外網)
//
// 這支要釘住的**六件事**(壞掉都不會報錯,只會「選項沒反應」或「觀戰卡在戰場出不去」):
//   Ⅰ 單一真相縫:裝置判定(maxTouchPoints / pointer:coarse / 短邊)只有 ctrlmode.js 一份,
//     mobile.js / game.js / main.js MUST NOT 各寫一份;ctrlmode.js MUST 可離線 import
//     (不准 import three/DOM 模組,否則本稽核、單機版靜態載入與 rooms.js 都會炸)。
//   Ⅱ 規則直測(真品;2026-07-31 使用者定案「操作方式應該由房主選擇」):預設 = 不限定、
//     不限定吃裝置判定、**戰區定案蓋過我的預設**、**離開戰區退回我的預設**、
//     **限定時目前操控不可變更**(= 使用者說的「遊戲中不可變更,除非不限定」)、
//     不限定時在不在戰區都可切換、舊鍵 `svs_touchui` 遷移、`?ctrl=`/`?touch=` 逃生門。
//   Ⅲ 消費端單一縫:`isTouchUI()` 只是轉呼 `usePad()`;操作方式的選項 DOM 只有 mobile.js 一份
//     (戰區畫面 `renderCtrlModeRow` / 設定頁 `renderCtrlSettings`;index.html / main.js
//     MUST NOT 另寫一組按鈕);main.js 的 TOUCH_UI MUST 是函式(快取成常數 ⇒ 說明停在舊版)。
//   Ⅳ 戰鬥中切換:建/毀搖桿層只住 `game.js _applyCtrlScheme`,且訂閱在 dispose 解除
//     (留著 = 下一局重建殭屍層);`_applyCtrlScheme` MUST NOT 自己判「能不能改」(那是 Ⅱ 的規則)。
//   Ⅴ 戰場選單隨時叫得出(2026-08-01 使用者需求「遊戲中隨時都可以 esc」):ESC 的受理只有
//     `_escMenu()` 一個出口(鍵盤 keydown / 指標解鎖 `_onPlc` / 觸控 ☰ 三個來源同縫),
//     MUST NOT 綁 `side`/`dead`/`paused`/指標鎖定狀態的條件 —— 那些條件散出去就是
//     「某個時刻按了沒反應」(前科:未鎖定指標的交戰玩家、重生後還沒點畫面時 ESC 全無效);
//     `_setPaused` MUST NOT 有 `!this.side` 早退、觸控 HOME 對觀戰 MUST NOT 收掉。
//   Ⅵ 房主定案(真品 RoomHub 直測):操作方式住 `room.config.ctrl`、開房吃房主預設、
//     **只有房主改得動**、非法值靜默忽略、廣播與戰區列表都帶得出去 ——
//     客戶端的 `_room` 只准由這份廣播寫入(先斬後奏 = 房主與隊友版型不同步)。
// 原文一律經 `audit_src.mjs`(換行正規化 + 大括號配對抽方法):自己 readFileSync 的話,
// CRLF 檢出的工作區會讓「逐行剝註解 / split('\n')」靜默失效(見該檔檔頭)。
import { readSrc, grabMethod, grabFn } from './audit_src.mjs';

const read = (...p) => readSrc(...p);
const ctrlSrc = read('public', 'js', 'ctrlmode.js');
const mobileSrc = read('public', 'js', 'mobile.js');
const gameSrc = read('public', 'js', 'game.js');
const mainSrc = read('public', 'js', 'main.js');
const htmlSrc = read('public', 'index.html');

const verbose = process.argv.includes('-v');
let pass = 0, fail = 0;
const ok = (cond, msg) => {
  if (cond) { pass++; if (verbose) console.log(`  ✓ ${msg}`); }
  else { fail++; console.log(`  ✗ ${msg}`); }
};
const sec = (t) => console.log(`\n▍${t}`);
/** 取出某個方法的原文(大括號配對;找不到回空字串 —— 由斷言自己報「沒這個方法」) */
const body = (src, name) => { try { return grabMethod(src, name); } catch { return ''; } };
/** 同上,但取**模組頂層**的具名函式(`export function …`);找不到同樣回空字串 */
const fnBody = (src, name) => { try { return grabFn(src, name); } catch { return ''; } };
/** 剝掉註解(斷言只認**執行原文**;註解裡寫什麼都不算數) */
const code = (src) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
const count = (src, re) => (src.match(re) || []).length;

// ── Ⅰ 單一真相縫 ────────────────────────────────────────────────
sec('Ⅰ 裝置判定 / 模組相依單一縫');
const ctrlCode = code(ctrlSrc);
ok(!/^\s*import\s/m.test(ctrlCode),
  'ctrlmode.js MUST NOT import 任何東西(離線稽核與單機版都要載得起來)');
ok(/export function deviceScheme\(/.test(ctrlSrc) && /export function touchCapable\(/.test(ctrlSrc),
  '裝置判定 `deviceScheme()` 與 `touchCapable()` 住 ctrlmode.js');
for (const [f, src] of [['mobile.js', mobileSrc], ['game.js', gameSrc], ['main.js', mainSrc]]) {
  const c = code(src);
  ok(!/maxTouchPoints\s*\|\|\s*0\)\s*>\s*0/.test(c) && !/'ontouchstart' in window/.test(c),
    `${f} MUST NOT 自己判觸控硬體(裝置判定只有 ctrlmode.js 一份)`);
  ok(!/\(pointer:\s*coarse\)'\)\.matches/.test(c.replace(/mm\('\(pointer: coarse\)'\)/g, '')),
    `${f} MUST NOT 自己判 pointer:coarse 來決定操控版本`);
}
// 診斷面板照樣可以「顯示」原始值(那是給玩家看的),但結論一律回頭問 ctrlmode
ok(/isTouchUI\(\)\s*\{\s*return usePad\(\);\s*\}/.test(mobileSrc),
  'mobile.js `isTouchUI()` MUST 只是轉呼 `usePad()`(消費端不必改名,判定卻只有一份)');

// ── Ⅱ 規則直測(import 真品)────────────────────────────────────
sec('Ⅱ 三選一規則直測(真品 ctrlmode.js)');
/** 每次重新載入模組 = 一次乾淨的分頁;stub 掉瀏覽器全域 */
async function fresh({ store = {}, search = '', touch = 0, coarse = false, hover = true, screen = { width: 1920, height: 1080 } } = {}) {
  global.window = {
    localStorage: {
      getItem: (k) => (k in store ? store[k] : null),
      setItem: (k, v) => { store[k] = String(v); },
      removeItem: (k) => { delete store[k]; },
    },
    matchMedia: (q) => ({ matches: q.includes('pointer: coarse') ? coarse : q.includes('any-hover') ? hover : false }),
    screen,
  };
  // Node 22 的 navigator 是 getter-only ⇒ 用 defineProperty 覆寫(直接指派會 throw)
  Object.defineProperty(global, 'navigator', { value: { maxTouchPoints: touch }, configurable: true, writable: true });
  Object.defineProperty(global, 'location', { value: { search }, configurable: true, writable: true });
  // cache-busting query:同一支模組要重載成全新狀態(_mode/_pick/_locked 是模組級變數)
  return import(`../public/js/ctrlmode.js?t=${Math.random()}`);
}

{
  const m = await fresh();
  ok(m.DEFAULT_CTRL_MODE === 'any' && m.ctrlMode() === 'any', '預設 = 不限定(any)');
  ok(m.CTRL_MODE_KEYS.length === 3 && m.CTRL_MODE_KEYS.every((k) => m.CTRL_MODES[k]),
    '三個選項:不限定 / 限定滑鼠鍵盤 / 限定搖桿');
  ok(m.ctrlScheme() === 'kbm' && !m.usePad(), '不限定 + 桌機 ⇒ 目前操控 = 滑鼠鍵盤(裝置判定)');
}
{
  const m = await fresh({ touch: 5, coarse: true, hover: false, screen: { width: 390, height: 844 } });
  ok(m.deviceScheme() === 'pad' && m.usePad(), '不限定 + 手機 ⇒ 目前操控 = 虛擬搖桿(裝置判定)');
  ok(m.setCtrlScheme('kbm') && !m.usePad(), '不限定:玩家可把目前操控改成滑鼠鍵盤');
  m.setRoomCtrlMode('any');
  ok(m.setCtrlScheme('pad') && m.usePad(),
    '戰區選不限定:**加入房間後照樣可以切換**(使用者:不限定就能在遊戲中變更)');
  m.setRoomCtrlMode('kbm');
  ok(m.ctrlMode() === 'kbm' && m.ctrlPref() === 'any',
    '戰區定案(房主選的)MUST 蓋過我的預設 —— 生效值換人,預設本身不被改寫');
  ok(!m.setCtrlScheme('pad') && m.ctrlScheme() === 'kbm',
    '房主限定滑鼠鍵盤:目前操控 MUST NOT 被改掉(= 遊戲中不可變更)');
  ok(m.ctrlLocked() === true && m.roomCtrlMode() === 'kbm', '在戰區內 ⇒ ctrlLocked() 為真');
  ok(m.setCtrlPref('pad') && m.ctrlMode() === 'kbm',
    '戰區內改「我的預設」MUST NOT 動到生效值(房主定案仍是唯一真相)');
  m.setRoomCtrlMode(null);
  ok(m.ctrlMode() === 'pad' && m.ctrlLocked() === false,
    '離開戰區 ⇒ 解除定案、退回我的預設');
  m.setRoomCtrlMode('kbm');
  m.setRoomCtrlMode('亂填的值');
  ok(m.roomCtrlMode() === null && m.ctrlMode() === 'pad',
    '非法戰區值 MUST 視同「沒有定案」而非沿用舊值(寧缺勿錯,MUST NOT 讓玩家卡在壞值)');
}
{
  const m = await fresh({ store: { svs_ctrl_mode: 'pad' }, screen: { width: 1920, height: 1080 } });
  ok(m.usePad(), '限定搖桿:桌機也長出虛擬搖桿(裝置判定 MUST 被限定值蓋過)');
  m.setRoomCtrlMode('kbm');
  ok(!m.usePad() && m.ctrlMismatchText() === null,
    '房主限定鍵鼠 + 桌機 ⇒ 不長搖桿、也沒有裝置衝突警告');
}
{
  const m = await fresh({ touch: 5, coarse: true, hover: false, screen: { width: 390, height: 844 } });
  m.setRoomCtrlMode('kbm');
  ok(/⚠/.test(m.ctrlMismatchText() || ''),
    '手機進了「限定鍵鼠」的戰區 MUST 有警告文字(醜話說在前面,寧缺勿錯)');
  m.setRoomCtrlMode('any');
  ok(m.ctrlMismatchText() === null, '不限定 ⇒ 無所謂相不相容,不該亂警告');
}
{
  const store = { svs_touchui: '1' };
  const m = await fresh({ store });
  ok(m.ctrlMode() === 'pad', '舊鍵 svs_touchui=1 遷移成「限定搖桿」');
  const m2 = await fresh({ store: { svs_touchui: '0' } });
  ok(m2.ctrlMode() === 'kbm', '舊鍵 svs_touchui=0 遷移成「限定滑鼠鍵盤」');
}
{
  const store = {};
  const m = await fresh({ store, search: '?ctrl=pad' });
  ok(m.ctrlMode() === 'pad' && store.svs_ctrl_mode === 'pad',
    '網址 ?ctrl=pad 立即生效並寫回記憶(手機沒有 devtools ⇒ 這是唯一逃生門)');
  const m2 = await fresh({ search: '?touch=0' });
  ok(m2.ctrlMode() === 'kbm', '相容舊網址參數 ?touch=0 ⇒ 限定滑鼠鍵盤');
}
{
  const m = await fresh();
  let seen = 0;
  const off = m.onCtrlChange(() => { seen++; });
  m.setCtrlScheme('pad'); m.setRoomCtrlMode('pad'); m.setRoomCtrlMode('pad');
  off();
  m.setRoomCtrlMode(null);
  ok(seen === 2, `變更才發事件、解除訂閱後不再收(收到 ${seen} 次,期望 2)`);
}

// ── Ⅲ 消費端單一縫 ──────────────────────────────────────────────
sec('Ⅲ 設定 UI 與消費端單一縫');
ok(/export function renderCtrlSettings\(/.test(mobileSrc) && /export function syncCtrlSettings\(/.test(mobileSrc),
  '設定頁的「目前操控」DOM 只有 `renderCtrlSettings` 一份(渲染)+ `syncCtrlSettings`(同步)');
ok(/export function renderCtrlModeRow\(/.test(mobileSrc) && /export function syncCtrlModeRow\(/.test(mobileSrc),
  '戰區畫面的「操作方式」三選一只有 `renderCtrlModeRow` 一份(房主可改,其他人唯讀)');
ok(count(mobileSrc, /data-ctrl="\$\{m\}"/g) === 1,
  '三選一按鈕的 DOM MUST 只有一處產生(設定頁改成唯讀狀態列,MUST NOT 再長出第二組)');
ok(!/name="ctrlMode"/.test(htmlSrc) && !/data-ctrl=/.test(htmlSrc),
  'index.html MUST NOT 另寫一組操作方式選項(只留掛載點,DOM 由共用渲染注入)');
ok(!/data-ctrl=/.test(code(mainSrc)) && !/setCtrlPref\(/.test(code(mainSrc)),
  'main.js MUST NOT 自己畫選項或直接改模式(只負責掛載 + 上行 setRoomConfig + 套用廣播)');
ok(count(mainSrc, /renderCtrlSettings\(/g) >= 3,
  '大廳選單 / 手機操控面板 / 戰場設定頁三處都掛得到「目前操控」(= 選擇併入設定)');
for (const id of ['roomCtrlMount', 'pauseCtrlMount', 'lobbyMenuCtrlMount']) {
  ok(htmlSrc.includes(`id="${id}"`), `index.html 有掛載點 #${id}`);
}
ok(!htmlSrc.includes('id="ctrlModeMount"') && !/ctrlModeMount/.test(mainSrc),
  '大廳面板的操作方式區塊 MUST 已移除(改由房主在戰區畫面決定,留著 = 玩家以為自己選得動)');
ok(/renderCtrlModeRow\(\$\('roomCtrlMount'\)/.test(mainSrc)
  && /t: 'setRoomConfig', ctrl: m/.test(mainSrc),
  '房主的選擇 MUST 走 `setRoomConfig` 上行(客戶端先斬後奏 = 房主與隊友版型不同步)');
ok(/setRoomCtrlMode\(m\.lobby\.config\?\.ctrl \|\| null\)/.test(mainSrc),
  '生效值 MUST 只由 `sync` 廣播寫入(整房唯一真相在伺服器)');
ok(/if \(LOBBY_SCREENS\.has\(screen\)\) setRoomCtrlMode\(null\)/.test(mainSrc),
  '離開戰區回大廳 MUST 解除戰區定案(留著 = 大廳還在用上一場的限定值)');
ok(count(code(mainSrc), /setRoomCtrlMode\(/g) === 2,
  'setRoomCtrlMode 的呼叫端 MUST 只有兩處(套用廣播 + 回大廳解除)');
ok(/ctrl: ctrlPref\(\)/.test(mainSrc) && count(mainSrc, /ctrl: ctrlPref\(\)/g) === 2,
  '開房(一般 + 劇情)MUST 帶上房主自己的預設操作方式');
ok(!/class="[^"]*touch-only[^"]*"[^>]*id="pauseCtrlMount"/.test(htmlSrc)
  && !/id="pauseCtrlMount"[^>]*class="[^"]*touch-only/.test(htmlSrc),
  '操作方式 MUST NOT 藏進 .touch-only —— 桌機也要能選「限定搖桿」');
ok(/const TOUCH_UI = \(\) => isTouchUI\(\);/.test(mainSrc),
  'main.js 的 TOUCH_UI MUST 是函式(快取成常數 ⇒ 切換後說明/提示停在進場那一版)');
ok(!/\bTOUCH_UI\s*[?&|)]/.test(code(mainSrc).replace(/TOUCH_UI\(\)/g, '')),
  'main.js MUST NOT 有殘留的 TOUCH_UI 常數用法(漏改 = 那一處永遠是舊值)');
ok(/^onCtrlChange\(\(\) => syncCtrlSettings\(\)\);$/m.test(mobileSrc),
  '操作方式 UI 的同步訂閱 MUST 住模組層(掛在 installTouchUI 裡 ⇒ 進房後選項不會即時變灰)');
const cssSrc = read('public', 'css', 'style.css');
ok(/\.segb:disabled/.test(cssSrc),
  '停用態 MUST 有視覺區別(不然玩家只會覺得「按了沒反應」)');
// 2026-07-31「按鍵風格統一」:分段按鈕的鈕面樣式只准有 `.seg`/`.segb` 一份。
ok(!/\.tset-segb?\b/.test(cssSrc),
  '舊的 `.tset-seg`/`.tset-segb` MUST 已改名為 `.seg`/`.segb`(留著 = 兩套分段按鈕樣式並存)');
for (const dead of ['.pause-tab {', '.help-cat {', '.unit-side-btn {', '.diff-select']) {
  ok(!cssSrc.includes(dead),
    `\`${dead.replace(' {', '')}\` MUST NOT 自己寫一份鈕面樣式(一律掛 .segb)`);
}
ok(/class="segb pause-tab/.test(htmlSrc) && /class="segb help-cat/.test(mainSrc)
  && /class="segb unit-side-btn/.test(mainSrc),
  '分頁鈕 / 說明類別 / 圖鑑陣營切換 MUST 都掛上 `.segb`');
ok(/onCtrlChange\(/.test(mainSrc) && /syncPauseHelp\(\)/.test(mainSrc),
  '切換操作方式時 MUST 重跑說明/提示(鍵位敘述兩份,取字仍走 help.js 單一縫)');
ok(/renderRoomCtrl\(\);/.test(mainSrc) && /renderBotDiff\(lb\);\s*\n\s*renderRoomCtrl\(\);/.test(mainSrc),
  '戰區畫面 MUST 與電腦難度並列渲染操作方式(同一種「整房一個、房主可改」的房間設定)');

// ── Ⅳ 戰鬥中切換(不限定)────────────────────────────────────────
sec('Ⅳ 戰鬥中切換:搖桿層建/毀');
const apply = body(gameSrc, '_applyCtrlScheme');
ok(apply.length > 0, 'game.js 有 `_applyCtrlScheme`');
ok(count(gameSrc, /new TouchControls\(/g) === 1 && /new TouchControls\(this\)/.test(apply),
  '虛擬搖桿層只有 `_applyCtrlScheme` 一處建立(進場與切換共用同一條路)');
ok(/this\.touch\.dispose\(\)/.test(apply), '切回鍵鼠 MUST 銷毀搖桿層(留著 = 半透明鬼鈕吃事件)');
ok(/exitPointerLock/.test(apply),
  '切到搖桿 MUST 解除指標鎖定(鎖著的話滑鼠事件會與觸控層雙送)');
ok(!/ctrlMode\(|ctrlLocked\(/.test(apply),
  '`_applyCtrlScheme` MUST NOT 自己判「能不能改」—— 規則只住 ctrlmode.js(限定時根本不會發事件)');
ok(/this\._offCtrl = onCtrlChange\(/.test(gameSrc), '戰場訂閱操作方式變更');
ok(/this\._offCtrl\?\.\(\)/.test(body(gameSrc, 'dispose')),
  'dispose MUST 解除訂閱(留著 = 下一局重建一個殭屍搖桿層)');

// ── Ⅴ 戰場選單隨時叫得出(ESC / HOME)────────────────────────────
sec('Ⅴ ESC 隨時可用 + 觀戰 HOME');
const paused = body(gameSrc, '_setPaused');
ok(paused.length > 0 && !/!this\.side/.test(paused),
  '`_setPaused` MUST NOT 有 `!this.side` 早退(觀戰者也要有離開戰場的出口)');
ok(/if \(this\._gameOver\) return;/.test(paused), '`_setPaused` 仍在分出勝負後早退(結束頁獨佔)');

// Ⅴ-a 單一出口:三個來源(鍵盤 / 指標解鎖 / 觸控 ☰)全走 `_escMenu`
const escBody = body(gameSrc, '_escMenu');
ok(escBody.length > 0, 'game.js 有 ESC 的唯一出口 `_escMenu`');
ok(/if \(this\._gameOver\) return;/.test(escBody),
  '`_escMenu` 只擋分出勝負(結束頁獨佔)—— 這是唯一准擋的狀態');
ok(!/this\.side|this\.dead|pointerLockElement|this\.touch/.test(code(escBody)),
  '`_escMenu` MUST NOT 判 side / dead / 指標鎖定 / 輸入裝置(那些條件 = 「某個時刻按了沒反應」)');
ok(/if \(this\.shopOpen\) \{ this\._toggleShop\(false\); return; \}/.test(escBody),
  '疊層逐層退出:商店開著時 ESC 先收商店(再按一次才是戰場選單)');
ok(/this\._setPaused\(!this\.paused\)/.test(escBody),
  '其餘一律**切換**戰場選單(叫得出也要收得回 —— 選單開著時 ESC 同樣受理)');
ok(/ESC_GAP_S/.test(escBody) && count(code(gameSrc), /const ESC_GAP_S = /g) === 1,
  '去彈跳窗 `ESC_GAP_S` 只有一份定義且 `_escMenu` 吃它(解鎖 + 補送 keydown = 開了又立刻關)');

const init = body(gameSrc, '_initInput');
const initCode = code(init);
ok(count(initCode, /'Escape'/g) === 1,
  'ESC 的 keydown 判定全 `_initInput` 只有一處(散成 side/dead 各一條就是第二份實作)');
ok(/if \(e\.type === 'keydown' && e\.code === 'Escape'\) \{ this\._escMenu\(\); return; \}/.test(initCode),
  'ESC keydown 無條件轉呼 `_escMenu`(MUST NOT 夾帶 side / dead / pointerLockElement 條件)');
ok(initCode.indexOf("'Escape'") >= 0
  && initCode.indexOf("'Escape'") < initCode.indexOf('if (this.paused) return;'),
  'ESC MUST 排在 `paused` 早退**之前** —— 選單開著時其餘輸入全凍結,這顆是收回選單的鑰匙');
const plc = init.slice(init.indexOf('this._onPlc'));
const plcCode = code(plc.slice(0, plc.indexOf('document.addEventListener')));
ok(!/this\.side/.test(plcCode),
  '`_onPlc`(指標解鎖 → 戰場選單)MUST NOT 加 side 門檻,觀戰與交戰同一條路');
ok(/this\._escMenu\(\);/.test(plcCode),
  '`_onPlc` 解鎖分支 MUST 走 `_escMenu`(順手蓋去彈跳戳記,擋掉瀏覽器補送的那顆 keydown)');
// 陣亡倒數中按 ESC(2026-08-02 使用者需求「重生倒數計時也要可以按 ESC」):陣亡頁是
// `pointer-events: none` ⇒ 玩家隨手點畫面就重新鎖上指標,那顆 ESC 的 keydown 會被瀏覽器吃掉,
// 只剩解鎖這條路。`!this.dead` 門檻會把它一起擋掉 ⇒ 一律改用「我方主動解鎖」戳記。
ok(!/this\.dead/.test(plcCode),
  '`_onPlc` MUST NOT 用 `dead` 當門檻(陣亡倒數中真的按下的那顆 ESC 會被一起擋掉)');
ok(/this\._plcSelf/.test(plcCode)
  && count(code(gameSrc), /this\._plcSelf = true/g) === 1
  && /pointerLockElement === this\.canvas\) this\._plcSelf = true;/.test(code(body(gameSrc, '_onSelfDeath'))),
  '陣亡的解鎖改以「我方主動」戳記略過(且 MUST 只在真的鎖著時打,否則會吃掉玩家下一顆 ESC)');
const cmd = code(body(gameSrc, '_cmd'));
ok(/act === 'menu'\) \{ if \(down\) this\._escMenu\(\); return; \}/.test(cmd),
  '觸控 ☰ MUST 與鍵盤 ESC 同一個出口(MUST NOT 自己再判一次 `_gameOver`/`!this.paused`)');
ok(count(code(gameSrc), /this\._setPaused\(/g) === 2,
  '`_setPaused` 的呼叫端只剩兩處:`_escMenu` 切換 + `_onPlc` 重新鎖定時關選單');

// Ⅴ-b 行為直測(真品原文;以 new Function 取回 `_escMenu` 本體)
const escFn = new Function('ESC_GAP_S', `return ({${escBody}\n});`)(0.35)._escMenu;
const mk = (o) => Object.assign({
  paused: false, shopOpen: false, _gameOver: false, dead: false, side: 'SWARM', _escAt: -1e9, log: [],
  _toggleShop(v) { this.shopOpen = v; this.log.push(`shop:${v}`); },
  _setPaused(v) { this.paused = v; this.log.push(`pause:${v}`); },
}, o);
const run = (o) => { const s = mk(o); escFn.call(s); return s.log.join(','); };
ok(run({}) === 'pause:true', '交戰中(指標未鎖定)ESC MUST 開得出戰場選單');
ok(run({ dead: true }) === 'pause:true', '陣亡重生倒數中 ESC MUST 開得出戰場選單');
ok(run({ side: null }) === 'pause:true', '觀戰(side=null)ESC MUST 開得出戰場選單');
ok(run({ paused: true }) === 'pause:false', '選單已開著:ESC MUST 收得回去(隨時可按 = 雙向)');
ok(run({ shopOpen: true }) === 'shop:false', '商店開著:ESC 先收商店,MUST NOT 同時動選單');
ok(run({ _gameOver: true }) === '', '分出勝負:ESC MUST 無動作(結束頁獨佔)');
const dbl = mk({}); escFn.call(dbl); escFn.call(dbl);
ok(dbl.log.join(',') === 'pause:true',
  '去彈跳:同一顆 ESC(解鎖事件 + 補送 keydown)只准生效一次');
ok(/if \(!this\.side\) return;\s*\/\/ 觀戰/.test(gameSrc) || /if \(!this\.side\) return;/.test(init),
  '觀戰仍 MUST NOT 開火/瞄準(鎖了指標只為轉視角)');
ok(/requestPointerLock\(\); return; \}/.test(init) && !/if \(!this\.side \|\| this\.shopOpen\) return;/.test(init),
  '觀戰 MUST 也能鎖指標(自由視角的轉向唯一來源是鎖定後的 mousemove)');
const setKind = body(mobileSrc, 'setKind');
ok(setKind.length > 0 && !/data-act="menu"/.test(setKind),
  '觸控 HOME(戰場選單)MUST NOT 對觀戰收掉 —— 那是觀戰唯一的離場出口');
ok(/\.gb-a, \.gb-aim, \[data-act="shop"\], \[data-act="lock"\]/.test(setKind),
  '其餘戰鬥鈕(A / R / ⊟ / 鎖定)仍對觀戰收起');
// 版型稽核的 harness 是這一行的複製品,兩邊分家 = 量到不存在的版型
const tlAudit = read('tools', 'audit_touch_layout.mjs');
ok(!/\[data-act="menu"\][^\n]*n\.hidden = spec/.test(tlAudit)
  && /\.gb-a, \.gb-aim, \[data-act="shop"\], \[data-act="lock"\]/.test(tlAudit),
  'audit_touch_layout 的 setKind 鏡射 MUST 與 mobile.js 逐字一致');
// 說明文字:觀戰兩版都要提到選單出口(鍵鼠說 ESC、搖桿說 HOME)。
// **取真品而不是正則刮原文**(2026-08-02):觀戰說明已改成由 `SPEC_CONTROLS` 逐列推導
//(見 help.js;面板與選單共用同一份),原文裡不再有 `spectator: '…'` 那一行 ——
// 繼續刮字串只會刮到空字串然後整批誤紅,而真正該驗的是「玩家最後讀到的那一份文字」。
const { CONTROLS_BY_KIND: HELP_KBM, TOUCH_CONTROLS: HELP_PAD } = await import('../public/js/help.js');
const kbmSpec = HELP_KBM.spectator || '';
const padSpec = HELP_PAD.spectator || '';
ok(/ESC/.test(kbmSpec), '觀戰(鍵鼠版)操作提示 MUST 提到 ESC 戰場選單');
ok(/HOME/.test(padSpec), '觀戰(搖桿版)操作提示 MUST 提到 HOME 戰場選單');

// ── Ⅵ 房主定案(真品 RoomHub 直測)──────────────────────────────
sec('Ⅵ 操作方式由房主選擇(真品 RoomHub)');
const roomsSrc = read('server', 'rooms.js');
ok(/from '\.\.\/public\/js\/ctrlmode\.js'/.test(roomsSrc),
  'rooms.js 的合法值 MUST 取自 ctrlmode.js(照抄一組字串 = 第二份選項表)');
// 行為直測(開房 → 房主改 → 非房主改不動 → 非法值 → 廣播/列表)住 `npm test` 的
// 「操作方式由房主選擇」段:那裡有現成的 fakeBattleConfig 與 RoomHub session harness。
ok(/ctrl: CTRL_MODES\[m\.ctrl\] \? m\.ctrl : DEFAULT_CTRL_MODE/.test(roomsSrc),
  '開房 MUST 收下房主的預設、非法值退回 DEFAULT_CTRL_MODE');
{
  const i = roomsSrc.indexOf("if (m.t === 'setRoomConfig'");
  const blk = roomsSrc.slice(i, i + 700);
  ok(/myId === room\.hostId/.test(blk.slice(0, blk.indexOf('\n'))),
    '變更操作方式 MUST 與其他房間設定同一道房主閘門(`setRoomConfig` 本身就只認 hostId)');
  ok(/m\.ctrl !== undefined && CTRL_MODES\[m\.ctrl\]/.test(blk),
    '非法值 MUST 靜默忽略(降級不例外:MUST NOT 把整房設成壞值,也 MUST NOT 拋錯斷線)');
}
ok(/ctrl: room\.config\.ctrl \|\| DEFAULT_CTRL_MODE/.test(roomsSrc),
  '戰區列表 MUST 帶出操作方式(手機玩家在**加入之前**就要看得到限定與否)');
const e2eSrc = read('test', 'e2e.mjs');
ok(/操作方式由房主選擇/.test(e2eSrc),
  'e2e MUST 有「操作方式由房主選擇」段(行為直測住那裡,本稽核只驗原文)');

// ── Ⅶ 觀戰視角(滾輪縮放 / 四種視角循環)──────────────────────────
// 2026-08-02 改制(使用者:「上帝視角加入下降操作」+「玩家視角可切換第一人稱 / 第三人稱跟隨 /
// 第三人稱自由,運鏡時避免太晃」):相機本身的行為與平滑數學歸 `audit_spectator_cam.mjs`,
// 這裡只留「觸控/鍵鼠鈕位與版型」這一面(本檔的職責)。
sec('Ⅶ 觀戰視角:滾輪縮放 + 四種視角循環');
{
  const spec = body(gameSrc, '_updateSpectator');
  const specCode = code(spec);
  ok(spec.length > 0, '`_updateSpectator` 還在(觀戰視角的唯一結算點)');
  // 純客戶端視角工具:與 VIEW_LOCK 同性質,MUST NOT 上行、MUST NOT 碰權威狀態(A1)
  ok(!/this\.net|_cmd\(|\.send\(/.test(specCode),
    '觀戰視角 MUST NOT 送任何訊息(純客戶端視角工具,伺服器不參與)');
  // 視點單一縫:玩家視角 MUST 與交戰 FPV 吃同一份 heroView + heroTargetH
  ok(/heroView\(/.test(specCode) && /heroTargetH\(/.test(specCode),
    '玩家視角的視點 MUST 走 heroView + heroTargetH 單一縫(手寫眼高 = 看到的與該玩家看到的分家)');
  ok(!/\b(?:1\.[0-9]|2\.[0-9])\s*[;,)]/.test(specCode.replace(/SPEC_CAM\.[A-Z_]+/g, '')),
    '玩家視角 MUST NOT 手寫眼高常數');
  ok(/camAngleStep\(this\._specYaw, tgt\.ry/.test(specCode) && /this\.yaw = this\._specYaw/.test(specCode),
    '玩家視角的偏航 MUST 吃伺服器權威 `ry`,且**經平滑縫**才進相機'
    + '(快照沒有俯仰 ⇒ 俯仰自控是刻意的降級;ry 量化到 0.01 rad ⇒ 直接賦值就是一格一格跳)');
  ok(/if \(this\._specPid && !tgt\) this\._specSetView\('god'\);/.test(specCode),
    '跟隨目標退場 MUST 降級回上帝視角,且走 `_specSetView` 同一個縫(寧缺勿錯,MUST NOT 卡在空目標)');
  ok(/tgt\.mesh\.visible = false/.test(specCode) && /_specHid\.mesh\.visible = !this\._specHid\.dead/.test(specCode),
    '跟隨中 MUST 藏起該機體、換人時 MUST 還原成「非死亡才可見」(死者本來就該隱形)');
  ok(/SPEC\.FOV_MIN|_specFov/.test(specCode) && /updateProjectionMatrix/.test(specCode),
    '滾輪視野角 MUST 真的套進相機(改了 fov 沒 updateProjectionMatrix = 完全沒作用)');

  const roster = code(body(gameSrc, '_specRoster'));
  ok(/e\.act !== false/.test(roster), '跟隨名冊 MUST 只收主視野機(三機小隊只有一架)');
  ok(/\.sort\(/.test(roster), '跟隨名冊排序 MUST 穩定,否則 Q/E 循環會隨快照跳位');

  const initSrc = code(init);
  ok(/_onWheel[\s\S]*?if \(this\.side \|\| this\.paused\) return;/.test(initSrc),
    '滾輪縮放 MUST 只在觀戰生效 —— 交戰的視野縮放唯一入口是右鍵瞄準(A8:FOV 不做機種差異化)');
  ok(/removeEventListener\('wheel', this\._onWheel\)/.test(code(gameSrc)),
    'wheel 監聽 MUST 在 dispose 解訂閱(離場後滾輪還在改上一局的相機)');
  const upd = code(body(gameSrc, '_updatePlayer'));
  ok(/zoomFov/.test(upd) && !/_specFov/.test(upd),
    '交戰視角的 FOV 路徑 MUST 維持原樣(觀戰縮放 MUST NOT 滲進座機視角)');
  ok(/滾輪/.test(kbmSpec) && /F /.test(kbmSpec),
    '觀戰(鍵鼠版)操作提示 MUST 提到滾輪縮放與 F 切換視角');

  // ── 觸控:虛擬手把的視角切換(2026-08-02)────────────────────────
  // A22 同功能只准一顆鈕 ⇒ 觀戰**借用**既有的招式/換機兩顆,MUST NOT 為觀戰另長新鈕。
  const cmd = code(body(gameSrc, '_cmd'));
  ok(/if \(!this\.side\) \{[\s\S]*?_specCycleView\(\)[\s\S]*?_specFollow\(/.test(cmd),
    '觸控觀戰 MUST 走 `_specCycleView` / `_specFollow` 同兩個縫(觸控層 MUST NOT 自己判模式)');
  ok(/act === 'special'\) this\._specCycleView\(\)/.test(cmd) && /act === 'swap'\) this\._specFollow\(1\)/.test(cmd),
    '十字鍵左 = 循環四種視角、⇄ = 換下一位(鈕位對應住 mobile.js setKind)');
  ok(/if \(!this\.side\) \{[\s\S]*?\s+return;\s*\}/.test(cmd),
    '觀戰分支 MUST 照舊 return —— 其餘戰鬥指令對 side=null 仍不受理');
  ok(/\[data-act="swap"\]'\)\.forEach\(\(n\) => \{ n\.hidden = !spec && kind !== 'drone'; \}\)/.test(code(mobileSrc)),
    '⇄ 鈕對觀戰 MUST NOT 收起(觀戰拿它換人)');
  ok(/\[data-act="special"\] \.gb-f'\)/.test(mobileSrc) && /'視角' : '招式'/.test(mobileSrc),
    '借用的鈕面字 MUST 跟著換(按下去與鈕面不符 = 誤按來源)');
  ok(/data-act="special"[^\n]*<span class="gb-f">招式<\/span><span class="gb-cd">/.test(htmlSrc),
    '招式鈕的字 MUST 住 `.gb-f` span(setKind 換字時 MUST NOT 洗掉 padMirror 要用的 .gb-cd)');
  ok(/十字鍵左 視角/.test(padSpec) && /⇄換人/.test(padSpec),
    '觀戰(搖桿版)操作提示 MUST 提到兩顆借用鈕');
}

// ── Ⅷ 持握相關的兩個預設(2026-08-04 使用者需求)──────────────────────
// 這兩條住這裡而不是 `audit_gyro` / `audit_touch_layout`:那兩支要 playwright,CI 沒裝就整支跳過
// ⇒ 預設值被改回去也沒人紅。純原文的斷言可以進 CI,才擋得住無聲回退。
sec('Ⅷ 全螢幕方向鎖 / 陀螺儀預設值');
const fullBody = code(fnBody(mobileSrc, 'toggleFullscreen'));
ok(/gyro:\s*false\s*,/.test(code(mobileSrc)),
  '`TOUCH.gyro` 預設 MUST 為 false(使用者:「陀螺儀改成預設關閉」)');
ok(fullBody !== '' && !/orientation\??\.lock/.test(fullBody),
  '`toggleFullscreen()` MUST NOT 鎖方向(使用者:「全螢幕時也可以旋轉手機切換直式/橫式」)');
// 數**兩次**而不是「有出現」:退出全螢幕那條路本來就有一次 unlock ⇒ 只驗「有出現」的話,
// 進場那條改回 lock() 也照樣綠(前科:反向驗證時三條斷言只紅了一條)。
ok(count(fullBody, /orientation\?\.unlock\?\.\(\)/g) === 2,
  '進與出全螢幕 MUST 各 `unlock()` 一次 —— PWA manifest 與前一次留下的鎖都會延續,不解就等於預設鎖著');
// 版型切換不歸 toggleFullscreen 管:轉向監聽是全螢幕內外共用的那一條路徑,拆掉就沒人換 class
ok(/window\.addEventListener\('orientationchange', syncOrientation\)/.test(mobileSrc)
  && /screen\?\.orientation\?\.addEventListener\?\.\('change', syncOrientation\)/.test(mobileSrc),
  '轉向 MUST 由 `syncOrientation` 兩個監聽接手(全螢幕內轉手機才換得了直式/橫式版型)');

console.log(`\n${fail ? '✗' : '✓'} 操作方式 / 觀戰選單稽核:${pass}/${pass + fail} 通過`);
process.exit(fail ? 1 : 0);
