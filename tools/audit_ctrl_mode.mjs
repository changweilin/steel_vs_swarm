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
//   Ⅴ 觀戰也能開戰場選單:`_setPaused` MUST NOT 有 `!this.side` 早退、觀戰 ESC 兩條路
//     (指標鎖定走 `_onPlc`、未鎖定走 keydown)、觸控 HOME 對觀戰 MUST NOT 收掉。
//   Ⅵ 房主定案(真品 RoomHub 直測):操作方式住 `room.config.ctrl`、開房吃房主預設、
//     **只有房主改得動**、非法值靜默忽略、廣播與戰區列表都帶得出去 ——
//     客戶端的 `_room` 只准由這份廣播寫入(先斬後奏 = 房主與隊友版型不同步)。
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (...p) => readFileSync(join(root, ...p), 'utf8');
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
/** 取出某個方法的原文(從 `  <name>(` 起算到下一個同縮排的方法定義) */
const body = (src, name) => {
  const i = src.indexOf(`\n  ${name}(`);
  if (i < 0) return '';
  const rest = src.slice(i + 3);
  const j = rest.search(/\n  [_A-Za-z$][\w$]*\(/);
  return j < 0 ? rest : rest.slice(0, j);
};
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
ok(/\.tset-segb:disabled/.test(cssSrc),
  '停用態 MUST 有視覺區別(不然玩家只會覺得「按了沒反應」)');
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

// ── Ⅴ 觀戰也能開戰場選單(ESC / HOME)────────────────────────────
sec('Ⅴ 觀戰:ESC / HOME 戰場選單');
const paused = body(gameSrc, '_setPaused');
ok(paused.length > 0 && !/!this\.side/.test(paused),
  '`_setPaused` MUST NOT 有 `!this.side` 早退(觀戰者也要有離開戰場的出口)');
ok(/if \(this\._gameOver\) return;/.test(paused), '`_setPaused` 仍在分出勝負後早退(結束頁獨佔)');
const init = body(gameSrc, '_initInput');
ok(/e\.code === 'Escape' && !this\.side/.test(init),
  '觀戰 ESC:未鎖定指標時走 keydown(剛進場/剛關掉選單時只有這條管用)');
ok(/document\.pointerLockElement !== this\.canvas\) this\._setPaused\(true\)/.test(init),
  '觀戰 ESC 的 keydown 路徑 MUST 只在**未鎖定**時觸發(鎖定中那顆 ESC 由 _onPlc 接手)');
const plc = init.slice(init.indexOf('this._onPlc'));
ok(!/this\.side/.test(plc.slice(0, plc.indexOf('document.addEventListener'))),
  '`_onPlc`(指標解鎖 → 戰場選單)MUST NOT 加 side 門檻,觀戰與交戰同一條路');
ok(/if \(!this\.side\) return;\s*\/\/ 觀戰/.test(gameSrc) || /if \(!this\.side\) return;/.test(init),
  '觀戰仍 MUST NOT 開火/瞄準(鎖了指標只為轉視角)');
ok(/requestPointerLock\(\); return; \}/.test(init) && !/if \(!this\.side \|\| this\.shopOpen\) return;/.test(init),
  '觀戰 MUST 也能鎖指標(自由視角的轉向唯一來源是鎖定後的 mousemove)');
const setKind = body(mobileSrc, 'setKind');
ok(setKind.length > 0 && !/data-act="menu"/.test(setKind),
  '觸控 HOME(戰場選單)MUST NOT 對觀戰收掉 —— 那是觀戰唯一的離場出口');
ok(/\.gb-a, \.gb-aim, \[data-act="shop"\], \[data-act="special"\], \[data-act="lock"\]/.test(setKind),
  '其餘戰鬥鈕(A / R / ⊟ / 絕招 / 鎖定)仍對觀戰收起');
// 版型稽核的 harness 是這一行的複製品,兩邊分家 = 量到不存在的版型
const tlAudit = read('tools', 'audit_touch_layout.mjs');
ok(!/\[data-act="menu"\][^\n]*n\.hidden = spec/.test(tlAudit)
  && /\.gb-a, \.gb-aim, \[data-act="shop"\], \[data-act="special"\], \[data-act="lock"\]/.test(tlAudit),
  'audit_touch_layout 的 setKind 鏡射 MUST 與 mobile.js 逐字一致');
// 說明文字:觀戰兩版都要提到選單出口(鍵鼠說 ESC、搖桿說 HOME)
const helpSrc = read('public', 'js', 'help.js');
const kbmSpec = /spectator: '([^']*)'/.exec(helpSrc)?.[1] || '';
const padSpec = [...helpSrc.matchAll(/spectator: '([^']*)'/g)][1]?.[1] || '';
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

console.log(`\n${fail ? '✗' : '✓'} 操作方式 / 觀戰選單稽核:${pass}/${pass + fail} 通過`);
process.exit(fail ? 1 : 0);
