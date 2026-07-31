// ============ 操作方式 / 觀戰選單稽核(2026-07-31 使用者需求)============
// 用途:改 `public/js/ctrlmode.js`、`mobile.js` 的裝置判定/設定 UI、`game.js` 的
// `_setPaused`/`_applyCtrlScheme`/觀戰指標鎖定,或 `main.js` 的 TOUCH_UI 消費端之後跑這一支。
// 跑法:`node tools/audit_ctrl_mode.mjs [-v]`(純原文 + 真品直測,不需瀏覽器/外網)
//
// 這支要釘住的**五件事**(壞掉都不會報錯,只會「選項沒反應」或「觀戰卡在戰場出不去」):
//   Ⅰ 單一真相縫:裝置判定(maxTouchPoints / pointer:coarse / 短邊)只有 ctrlmode.js 一份,
//     mobile.js / game.js / main.js MUST NOT 各寫一份;ctrlmode.js MUST 可離線 import
//     (不准 import three/DOM 模組,否則本稽核與單機版靜態載入都會炸)。
//   Ⅱ 規則直測(真品):預設 = 不限定、不限定吃裝置判定、**加入房間後限定模式不可變更**、
//     **限定時目前操控不可變更**(= 使用者說的「遊戲中不可變更,除非選不限定」)、
//     不限定時鎖定與否都可切換、舊鍵 `svs_touchui` 遷移、`?ctrl=`/`?touch=` 逃生門。
//   Ⅲ 消費端單一縫:`isTouchUI()` 只是轉呼 `usePad()`;操作方式的選項 DOM 只有
//     `renderCtrlSettings` 一份(index.html / main.js MUST NOT 另寫一組按鈕);
//     main.js 的 TOUCH_UI MUST 是函式(快取成常數 ⇒ 切換後說明文字停在舊版)。
//   Ⅳ 戰鬥中切換:建/毀搖桿層只住 `game.js _applyCtrlScheme`,且訂閱在 dispose 解除
//     (留著 = 下一局重建殭屍層);`_applyCtrlScheme` MUST NOT 自己判「能不能改」(那是 Ⅱ 的規則)。
//   Ⅴ 觀戰也能開戰場選單:`_setPaused` MUST NOT 有 `!this.side` 早退、觀戰 ESC 兩條路
//     (指標鎖定走 `_onPlc`、未鎖定走 keydown)、觸控 HOME 對觀戰 MUST NOT 收掉。
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
  m.setCtrlLock(true);
  ok(m.setCtrlScheme('pad') && m.usePad(),
    '不限定:**加入房間後照樣可以切換**(使用者:選不限定就能在遊戲中變更)');
  ok(!m.setCtrlMode('kbm') && m.ctrlMode() === 'any',
    '加入房間後 MUST NOT 再變更限定模式(操作方式在加入房間之前就要先選)');
  m.setCtrlLock(false);
  ok(m.setCtrlMode('kbm'), '回大廳即可再變更限定模式');
  ok(!m.setCtrlScheme('pad') && m.ctrlScheme() === 'kbm',
    '限定滑鼠鍵盤:目前操控 MUST NOT 被改掉(= 遊戲中不可變更)');
  ok(m.ctrlLocked() === false, 'ctrlLocked() 反映目前鎖定狀態');
}
{
  const m = await fresh({ store: { svs_ctrl_mode: 'pad' }, screen: { width: 1920, height: 1080 } });
  ok(m.usePad(), '限定搖桿:桌機也長出虛擬搖桿(裝置判定 MUST 被限定值蓋過)');
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
  m.setCtrlScheme('pad'); m.setCtrlLock(true); m.setCtrlLock(true);
  off();
  m.setCtrlLock(false);
  ok(seen === 2, `變更才發事件、解除訂閱後不再收(收到 ${seen} 次,期望 2)`);
}

// ── Ⅲ 消費端單一縫 ──────────────────────────────────────────────
sec('Ⅲ 設定 UI 與消費端單一縫');
ok(/export function renderCtrlSettings\(/.test(mobileSrc) && /export function syncCtrlSettings\(/.test(mobileSrc),
  '操作方式選項的 DOM 只有 `renderCtrlSettings` 一份(渲染)+ `syncCtrlSettings`(同步)');
ok(!/name="ctrlMode"/.test(htmlSrc) && !/data-ctrl=/.test(htmlSrc),
  'index.html MUST NOT 另寫一組操作方式選項(只留掛載點,DOM 由共用渲染注入)');
ok(!/data-ctrl=/.test(code(mainSrc)) && !/setCtrlMode\(/.test(code(mainSrc)),
  'main.js MUST NOT 自己畫選項或直接改模式(只負責掛載 + 回報畫面 → setCtrlLock)');
ok(count(mainSrc, /renderCtrlSettings\(/g) >= 3,
  '大廳(加入房間前)/ 大廳選單 / 戰場設定頁三處都掛得到操作方式');
for (const id of ['ctrlModeMount', 'pauseCtrlMount', 'lobbyMenuCtrlMount']) {
  ok(htmlSrc.includes(`id="${id}"`), `index.html 有掛載點 #${id}`);
}
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
ok(/setCtrlLock\(!LOBBY_SCREENS\.has\(screen\)\)/.test(mainSrc),
  '鎖定時機 = 離開大廳類畫面(進房/載入/戰鬥),由 show() 單點回報');

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

console.log(`\n${fail ? '✗' : '✓'} 操作方式 / 觀戰選單稽核:${pass}/${pass + fail} 通過`);
process.exit(fail ? 1 : 0);
