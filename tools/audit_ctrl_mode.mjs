// ============ Control scheme / spectator-menu audit (2026-07-31 user request) ============
// Purpose: run after changing `public/js/ctrlmode.js`, device detection/settings UI in `mobile.js`,
// `game.js` `_setPaused`/`_applyCtrlScheme`/spectator pointer-lock, or `main.js` TOUCH_UI consumers.
// Usage: `node tools/audit_ctrl_mode.mjs [-v]` (pure source + genuine direct tests, no browser/network)
//
// Six things this file pins (breakage never errors, only "option does nothing" or "spectator stuck with
// no way out of the match"):
//   I Single source of truth: device verdicts (maxTouchPoints / pointer:coarse / short edge) exist only in
//     ctrlmode.js; mobile.js / game.js / main.js MUST NOT each write one; ctrlmode.js MUST stay offline-
//     importable (importing three/DOM modules would blow up this audit, solo static loading, and rooms.js).
//   II Rule direct tests (genuine article; 2026-07-31 user decision "the host picks the control scheme"):
//     default = unrestricted, unrestricted follows device verdicts, **room verdict overrides my default**,
//     **leaving the room falls back to my default**, **a locked scheme cannot change the current controls**
//     (= the user's "no changing mid-game unless unrestricted"), unrestricted switches anywhere in or out
//     of rooms, legacy `svs_touchui` key migration, `?ctrl=`/`?touch=` escape hatches.
//   III Consumer single seam: `isTouchUI()` merely forwards `usePad()`; the scheme option DOM exists only in
//     mobile.js (`renderCtrlModeRow` for rooms / `renderCtrlSettings` for settings; index.html / main.js
//     MUST NOT write a second button set); main.js TOUCH_UI MUST be a function (a cached constant ⇒
//     descriptions freeze at the old build).
//   IV Mid-combat switching: stick-layer build/destroy lives only in `game.js _applyCtrlScheme`, with the
//     subscription released on dispose (kept = a zombie layer rebuilt next match); `_applyCtrlScheme` MUST
//     NOT judge "may I switch" itself (that rule lives in II).
//   V Match menu always reachable (2026-08-01 user request "ESC must work anytime in game"): ESC has exactly
//     one exit, `_escMenu()` (keyboard keydown / pointer-unlock `_onPlc` / touch ☰, three sources one seam),
//     MUST NOT bind `side`/`dead`/`paused`/pointer-lock conditions — scattered conditions become "pressed
//     at some moment and nothing happens" (prior cases: fighting players with unlocked pointers, ESC fully
//     dead after respawn before clicking the screen); `_setPaused` MUST NOT early-out on `!this.side`,
//     touch HOME MUST NOT hide from spectators.
//   VI Host verdict (genuine RoomHub direct test): the scheme lives in `room.config.ctrl`, creating a room
//     takes the host default, **only the host may change it**, illegal values silently ignored, broadcasts
//     and room lists both carry it — the client's `_room` may only be written by that broadcast
//     (act-first = host and teammates on different layouts).
// Source always via `audit_src.mjs` (newline normalization + brace-matched method extraction): a private
// readFileSync lets "per-line comment stripping / split('\n')" silently fail on CRLF checkouts (see that
// file's header).
import { readSrc, grabMethod, grabFn } from './audit_src.mjs';

const read = (...p) => readSrc(...p);
const ctrlSrc = read('public', 'js', 'ctrlmode.js');
let mobileSrc = read('public', 'js', 'mobile.js');
const gameSrc = read('public', 'js', 'game.js');
const mainSrc = read('public', 'js', 'main.js');
let htmlSrc = read('public', 'index.html');
let cssSrc = read('public', 'css', 'style.css');

// Reverse verification (five flags, all serving section X; rewrite rules back to the pre-migration broken form):
//   --break-viewport  drop viewport meta `viewport-fit=cover` ⇒ X-1 MUST go red
//   --break-textadj  drop root text-size-adjust                ⇒ X-2 MUST go red
//   --break-touchdev page-hardening selectors back to `body.touch-ui` ⇒ X-3 MUST go red, X-5 MUST stay green
//   --break-touchact  drop the `#game { touch-action: none }` rule ⇒ X-3 MUST go red
//   --break-meta-select drop the PIN / LAN-URL select-text exemption ⇒ X-6 MUST go red
// A no-op replacement (source already moved) MUST fail loudly — otherwise breaks stay green forever
// (§5.4 ㋑ / tools/CLAUDE.md discipline 2).
// ⚠ Patterns bind **structural anchors** only (attribute names / selectors), MUST NOT bind current values
// (a value-bound break silently becomes a no-op after the value is recomputed, and one fewer red line just
// reads as "fixed along the way this round").
const BREAK_VIEWPORT = process.argv.includes('--break-viewport');
const BREAK_TEXTADJ = process.argv.includes('--break-textadj');
const BREAK_TOUCHDEV = process.argv.includes('--break-touchdev');
const BREAK_TOUCHACT = process.argv.includes('--break-touchact');
const BREAK_META_SELECT = process.argv.includes('--break-meta-select');
/** Per-pattern literal replacement; a miss fails loudly (a no-op replacement = the broken version never built) */
const patch = (flag, name, src, re, to) => {
  if (!flag) return src;
  if (!re.test(src)) {
    console.log(`✗ ${name}:字面替換無效(原文已變 ⇒ 這支 break 根本沒造出壞版)`);
    process.exit(1);
  }
  return src.replace(re, to);
};
htmlSrc = patch(BREAK_VIEWPORT, '--break-viewport', htmlSrc, /,\s*viewport-fit=cover/, '');
cssSrc = patch(BREAK_TEXTADJ, '--break-textadj', cssSrc,
  /-webkit-text-size-adjust:[^;]*;\s*text-size-adjust:[^;]*;/, '');
cssSrc = patch(BREAK_TOUCHACT, '--break-touchact', cssSrc,
  /body\.touch-dev #game \{[^}]*\}\r?\n/, '');
cssSrc = patch(BREAK_META_SELECT, '--break-meta-select', cssSrc,
  /body\.touch-dev #roomPin,\s*body\.touch-dev #roomUrls\s*\{[^}]*\}\r?\n/, '');
cssSrc = patch(BREAK_TOUCHDEV, '--break-touchdev', cssSrc, /body\.touch-dev\b/g, 'body.touch-ui');
mobileSrc = patch(BREAK_TOUCHDEV, '--break-touchdev', mobileSrc,
  /document\.body\.classList\.toggle\('touch-dev',[^;]*;/, '');

const verbose = process.argv.includes('-v');
let pass = 0, fail = 0;
const ok = (cond, msg) => {
  if (cond) { pass++; if (verbose) console.log(`  ✓ ${msg}`); }
  else { fail++; console.log(`  ✗ ${msg}`); }
};
const sec = (t) => console.log(`\n▍${t}`);
/** Extract a method's source (brace matching; empty string when missing — the assertion itself reports "no such method") */
const body = (src, name) => { try { return grabMethod(src, name); } catch { return ''; } };
/** Same, but for **module-top-level** named functions (`export function …`); empty string when missing */
const fnBody = (src, name) => { try { return grabFn(src, name); } catch { return ''; } };
/** Strip comments (assertions only recognize **executable source**; whatever comments say does not count) */
const code = (src) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
const count = (src, re) => (src.match(re) || []).length;

// ── I Single source of truth ────────────────────────────────────────────────
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
// The diagnostics panel may still "display" raw values (for players to see), but verdicts always ask
// ctrlmode again
ok(/isTouchUI\(\)\s*\{\s*return usePad\(\);\s*\}/.test(mobileSrc),
  'mobile.js `isTouchUI()` MUST 只是轉呼 `usePad()`(消費端不必改名,判定卻只有一份)');

// ── II Rule direct tests (import the genuine article) ────────────────────────────────────
sec('Ⅱ 三選一規則直測(真品 ctrlmode.js)');
/** Each fresh reload = one clean page; browser globals stubbed */
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
  // Node 22's navigator is getter-only ⇒ override via defineProperty (direct assignment throws)
  Object.defineProperty(global, 'navigator', { value: { maxTouchPoints: touch }, configurable: true, writable: true });
  Object.defineProperty(global, 'location', { value: { search }, configurable: true, writable: true });
  // cache-busting query: reloading one module into fully fresh state (_mode/_pick/_locked are module-level)
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

// ── III Consumer single seam ──────────────────────────────────────────────
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
  '開房(一般/超級 + 劇情)MUST 帶上房主自己的預設操作方式');
ok(!/class="[^"]*touch-only[^"]*"[^>]*id="pauseCtrlMount"/.test(htmlSrc)
  && !/id="pauseCtrlMount"[^>]*class="[^"]*touch-only/.test(htmlSrc),
  '操作方式 MUST NOT 藏進 .touch-only —— 桌機也要能選「限定搖桿」');
ok(/const TOUCH_UI = \(\) => isTouchUI\(\);/.test(mainSrc),
  'main.js 的 TOUCH_UI MUST 是函式(快取成常數 ⇒ 切換後說明/提示停在進場那一版)');
ok(!/\bTOUCH_UI\s*[?&|)]/.test(code(mainSrc).replace(/TOUCH_UI\(\)/g, '')),
  'main.js MUST NOT 有殘留的 TOUCH_UI 常數用法(漏改 = 那一處永遠是舊值)');
ok(/^onCtrlChange\(\(\) => syncCtrlSettings\(\)\);$/m.test(mobileSrc),
  '操作方式 UI 的同步訂閱 MUST 住模組層(掛在 installTouchUI 裡 ⇒ 進房後選項不會即時變灰)');
ok(/\.segb:disabled/.test(cssSrc),
  '停用態 MUST 有視覺區別(不然玩家只會覺得「按了沒反應」)');
// 2026-07-31 "unified button style": segmented button faces allow exactly one `.seg`/`.segb` copy.
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

// ── IV Mid-combat switching (unrestricted) ────────────────────────────────────────
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

// ── V Match menu always reachable (ESC / HOME) ────────────────────────────
sec('Ⅴ ESC 隨時可用 + 觀戰 HOME');
const paused = body(gameSrc, '_setPaused');
ok(paused.length > 0 && !/!this\.side/.test(paused),
  '`_setPaused` MUST NOT 有 `!this.side` 早退(觀戰者也要有離開戰場的出口)');
ok(/if \(this\._gameOver\) return;/.test(paused), '`_setPaused` 仍在分出勝負後早退(結束頁獨佔)');

// V-a Single exit: three sources (keyboard / pointer-unlock / touch menu) all travel `_escMenu`
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
// ESC during the death countdown (2026-08-02 user request "respawn countdown must also take ESC"): the
// death page is `pointer-events: none` ⇒ any casual screen click re-locks the pointer, and that ESC keydown
// gets eaten by the browser — leaving only the unlock path. A `!this.dead` gate would block it too ⇒
// always switch to the "we unlocked ourselves" stamp.
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

// V-b Behavior tests (genuine source; `_escMenu` body recovered via new Function)
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
// The layout audit's harness is a copy of this line; a split measures a layout that does not exist
const tlAudit = read('tools', 'audit_touch_layout.mjs');
ok(!/\[data-act="menu"\][^\n]*n\.hidden = spec/.test(tlAudit)
  && /\.gb-a, \.gb-aim, \[data-act="shop"\], \[data-act="lock"\]/.test(tlAudit),
  'audit_touch_layout 的 setKind 鏡射 MUST 與 mobile.js 逐字一致');
// Help text: both spectator builds must mention the menu exit (KBM says ESC, pad says HOME).
// **Take the genuine article, never regex-scrape source** (2026-08-02): spectator help is now derived
// row-by-row from `SPEC_CONTROLS` (see help.js; panel and menu share it) — the source no longer holds a
// `spectator: '…'` line. Keep scraping strings and the batch false-reds on empty strings, while what truly
// needs verifying is "the copy the player finally reads".
const { CONTROLS_BY_KIND: HELP_KBM, TOUCH_CONTROLS: HELP_PAD } = await import('../public/js/help.js');
const kbmSpec = HELP_KBM.spectator || '';
const padSpec = HELP_PAD.spectator || '';
ok(/ESC/.test(kbmSpec), '觀戰(鍵鼠版)操作提示 MUST 提到 ESC 戰場選單');
ok(/HOME/.test(padSpec), '觀戰(搖桿版)操作提示 MUST 提到 HOME 戰場選單');

// ── VI Host verdict (genuine RoomHub direct test) ──────────────────────────────
sec('Ⅵ 操作方式由房主選擇(真品 RoomHub)');
const roomsSrc = read('server', 'rooms.js');
ok(/from '\.\.\/public\/js\/ctrlmode\.js'/.test(roomsSrc),
  'rooms.js 的合法值 MUST 取自 ctrlmode.js(照抄一組字串 = 第二份選項表)');
// Behavior tests (create room → host edits → non-host blocked → illegal values → broadcast/list) live in
// `npm test`'s "control scheme picked by host" section: ready fakeBattleConfig and RoomHub session harness there.
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

// ── VII Spectator camera (wheel zoom / four-view cycle) ──────────────────────────
// 2026-08-02 migration (user: "god view gains descend" + "player view switches first-person / third-person
// follow / third-person free, keep camera moves steady"): camera behavior and smoothing math belong to
// `audit_spectator_cam.mjs`; only the "touch/KBM buttons and layout" face stays here (this file's job).
sec('Ⅶ 觀戰視角:滾輪縮放 + 四種視角循環');
{
  const spec = body(gameSrc, '_updateSpectator');
  const specCode = code(spec);
  ok(spec.length > 0, '`_updateSpectator` 還在(觀戰視角的唯一結算點)');
  // Pure client-side camera tool: same nature as VIEW_LOCK — MUST NOT go uplink, MUST NOT touch
  // authoritative state (A1)
  ok(!/this\.net|_cmd\(|\.send\(/.test(specCode),
    '觀戰視角 MUST NOT 送任何訊息(純客戶端視角工具,伺服器不參與)');
  // Viewpoint single seam: player view MUST share heroView + heroTargetH with combat FPV
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
  ok(/_onWheel[\s\S]*?!this\.side[\s\S]*?this\._setAiming/.test(initSrc),
    '滾輪縮放 MUST 只在觀戰生效、交戰時滾輪切換狙擊鏡(A8:FOV 不做機種差異化)');
  ok(/removeEventListener\('wheel', this\._onWheel\)/.test(code(gameSrc)),
    'wheel 監聽 MUST 在 dispose 解訂閱(離場後滾輪還在改上一局的相機)');
  const upd = code(body(gameSrc, '_updatePlayer'));
  ok(/zoomFov/.test(upd) && !/_specFov/.test(upd),
    '交戰視角的 FOV 路徑 MUST 維持原樣(觀戰縮放 MUST NOT 滲進座機視角)');
  ok(/滾輪/.test(kbmSpec) && /F /.test(kbmSpec),
    '觀戰(鍵鼠版)操作提示 MUST 提到滾輪縮放與 F 切換視角');

  // ── Touch: virtual-stick view switching (2026-08-02) ────────────────────────
  // A22 allows one button per function ⇒ spectator **borrows** the existing ability/swap pair; MUST NOT
  // grow a new spectator-only button.
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

// ── VIII Two grip-related defaults (2026-08-04 user request) ──────────────────────
// These two live here rather than `audit_gyro` / `audit_touch_layout`: those need playwright, and a CI
// without it skips them wholesale ⇒ silently reverted defaults with nobody red. Pure-source assertions run
// in CI, which is what stops silent rollback.
sec('Ⅷ 全螢幕方向鎖 / 陀螺儀預設值');
const fullBody = code(fnBody(mobileSrc, 'toggleFullscreen'));
ok(/gyro:\s*false\s*,/.test(code(mobileSrc)),
  '`TOUCH.gyro` 預設 MUST 為 false(使用者:「陀螺儀改成預設關閉」)');
ok(fullBody !== '' && !/orientation\??\.lock/.test(fullBody),
  '`toggleFullscreen()` MUST NOT 鎖方向(使用者:「全螢幕時也可以旋轉手機切換直式/橫式」)');
// Count **twice**, not "appears": the exit-fullscreen path already unlocks once ⇒ an "appears" check stays
// green after the entry path regresses to lock() (prior case: only one of three assertions went red during
// reverse verification).
ok(count(fullBody, /orientation\?\.unlock\?\.\(\)/g) === 2,
  '進與出全螢幕 MUST 各 `unlock()` 一次 —— PWA manifest 與前一次留下的鎖都會延續,不解就等於預設鎖著');
// Layout switching is not toggleFullscreen's business: the orientation listener is the shared path inside
// and outside fullscreen; removing it leaves nobody swapping classes
ok(/window\.addEventListener\('orientationchange', syncOrientation\)/.test(mobileSrc)
  && /screen\?\.orientation\?\.addEventListener\?\.\('change', syncOrientation\)/.test(mobileSrc),
  '轉向 MUST 由 `syncOrientation` 兩個監聽接手(全螢幕內轉手機才換得了直式/橫式版型)');

// ── IX Window-size settle (rotation debounce; 2026-08-16, `docs/anime_style_plan.md` 8-2) ────────
// One rotation fires several sizes in a burst, and **only the last is correct**. Re-fitting render targets
// per event = one hitch, plus a chance of stopping on a wrong middle size (stretched frame / HUD offset,
// zero error messages).
// The behavior half (a burst really calls back once) lives in `audit_touch_gesture` 9 (needs a real
// setTimeout); what is pinned here is **exactly one wait duration** with **no consumer bypassing it** —
// both pure source, both CI-able.
sec('Ⅸ 視窗尺寸定案(旋轉 debounce)');
ok(/SETTLE_MS:\s*50\s*,/.test(mobileSrc) && /SETTLE_IOS_MS:\s*500\s*,/.test(mobileSrc),
  '等待時間 MUST 依裝置分兩檔(一般 50ms / iOS 500ms)且都住 `VIEWPORT`');
ok(count(mobileSrc, /export function viewportSettleMs\(/g) === 1
  && /isIOS\(\) \? VIEWPORT\.SETTLE_IOS_MS : VIEWPORT\.SETTLE_MS/.test(mobileSrc),
  '「要等多久」只有 `viewportSettleMs()` 一份(消費端 MUST NOT 手寫毫秒數)');
// iPadOS 13+ ships desktop UA by default ⇒ matching only iPad|iPhone|iPod calls the burst-heaviest class desktops
ok(/\/Mac\/\.test\(ua\) && \(navigator\.maxTouchPoints \|\| 0\) > 1/.test(mobileSrc),
  '`isIOS()` MUST 蓋住「iPadOS 偽裝成 Mac」那一格(Mac + 多點觸控)');
ok(!/window\.dispatchEvent\(new Event\('resize'\)\)/.test(mobileSrc),
  '`syncOrientation` MUST NOT 自己補送合成 resize —— 那是第二份等待時間,而且比 iOS 需要的短一截');
ok(!/window\.addEventListener\('resize', this\._onResize\)/.test(gameSrc)
  && /this\._offResize = onViewportSettled\(this\._onResize\)/.test(gameSrc),
  '`game.js` 的畫布/相機/HUD MUST 訂閱 `onViewportSettled`,MUST NOT 自己綁 window resize');
ok(/this\._offResize\?\.\(\)/.test(gameSrc),
  'dispose MUST 解除訂閱(留著 = 下一局多一個殭屍消費端,同 Ⅳ 的搖桿層)');
// `_applyRes()` is a pixel-ratio change, not a window change ⇒ deliberately called directly; no 50~500ms wait owed
ok(/_applyRes\(\) \{[\s\S]{0,220}?this\._onResize\(\);/.test(gameSrc),
  '`_applyRes()` MUST 仍直接呼叫 `_onResize()`(自適應解析度降階不該排隊等 debounce)');

// ── X Page-level touch hardening / viewport / safe area (2026-08-16, `docs/anime_style_plan.md` 8-5) ────────
// Before the migration this whole family had **no audit guarding it** (viewport meta / touch-action /
// safe-area: zero repo hits), while every breakage stays silent: pinch shrinking the whole battlefield by
// half, pull-to-refresh wiping the match, long-press selecting into the HUD, iOS landscape upsizing text
// and pushing the HUD band into another ratio — each reads only as "weird on phones".
//
// This section pins that **"does this machine have touch hardware" and "does this room use sticks" are two
// different questions**: `body.touch-ui` = `ctrlmode.usePad()` = a **host-switchable room setting** (always
// false under a "KBM-only" host lock). Hanging page-level hardening under it means one host KBM lock wipes
// the whole protection set on real phones. The device half MUST travel `body.touch-dev` (verdict single
// seam `ctrlmode.touchCapable()`); the layout half (--tl-* / .tl-* / safe area) MUST stay on
// `body.touch-ui`. Columns 3 and 5 **both green together** is what proves the two flags truly split.
sec('Ⅹ 頁面級觸控硬化 / viewport / 安全區(⑧-5)');
const cssCode = cssSrc.replace(/\/\*[\s\S]*?\*\//g, '');
/** Split each rule block into "selector list + declaration zone" (nested @media inner rules included) */
const cssRules = [...cssCode.matchAll(/([^{}@]+)\{([^{}]*)\}/g)].map((m) => ({
  sels: m[1].split(',').map((s) => s.trim().replace(/\s+/g, ' ')).filter(Boolean),
  decl: m[2],
}));
/** A selector's **subject** (last compound) — "who this rule actually acts on" */
const subjectOf = (s) => s.split(/\s*[>+~]\s*|\s+/).filter(Boolean).pop() || '';
const subjectsWhere = (re) => {
  const out = new Set();
  for (const r of cssRules) if (re.test(r.decl)) for (const s of r.sels) out.add(subjectOf(s));
  return out;
};

// 1 viewport-fit=cover: without it, `env(safe-area-inset-*)` always returns 0 on notched devices ⇒ the four
// variables of item 5 below are all 0px, while CSS still computes, frames still draw — only the sticks get
// eaten by the notch.
ok(/<meta name="viewport"[^>]*viewport-fit=cover/.test(htmlSrc),
  'viewport meta MUST 含 `viewport-fit=cover`(挖孔螢幕的 safe-area-inset 才拿得到非零值)');
// The zoom ban is the other half of "touch must swallow every battlefield gesture"; same meta line as
// item 1, pinned together
ok(/<meta name="viewport"[^>]*user-scalable=no/.test(htmlSrc),
  'viewport meta MUST 含 `user-scalable=no`(雙擊放大會把準星與搖桿一起放大到畫面外)');

// 2 text-size-adjust: iOS landscape auto-enlarges text it deems too small, while the HUD lower band's 1/6
// cap is `game.fitHudBand()` back-solving `--hud-k` from **natural height** ⇒ browser-resized text swaps the
// whole HUD to another ratio. MUST hang on the root (html / html, body); under body.touch-* it re-binds to
// room settings.
const rootTextAdj = cssRules.some((r) => r.sels.some((s) => /^(html|body)$/.test(s))
  && /(^|\s|-)text-size-adjust:\s*100%/.test(r.decl));
ok(rootTextAdj, '根層(html / body)MUST 宣告 `text-size-adjust: 100%`(iOS 橫式自動放大字級會扭掉 HUD 的 1/6)');
ok(/-webkit-text-size-adjust:\s*100%/.test(cssCode),
  'MUST 一併帶 `-webkit-` 前綴(iOS Safari 只認前綴版)');

// 3 The five page-level hardenings MUST hang under the **device** class, whose class is decided only by
// `touchCapable()`
const devBlock = cssRules.find((r) => r.sels.length === 1 && r.sels[0] === 'body.touch-dev');
const uiBlocks = cssRules.filter((r) => r.sels.some((s) => /^body\.touch-ui$/.test(s)));
const HARDEN = [
  [/overscroll-behavior:\s*none/, 'overscroll-behavior(下拉刷新 / 捲動鏈)'],
  [/-webkit-user-select:\s*none/, '-webkit-user-select(長按選字)'],
  [/(^|[;\s])user-select:\s*none/, 'user-select(長按選字)'],
  [/-webkit-touch-callout:\s*none/, '-webkit-touch-callout(長按跳系統選單)'],
  [/-webkit-tap-highlight-color:\s*transparent/, '-webkit-tap-highlight-color(點擊藍框)'],
];
for (const [re, label] of HARDEN) {
  ok(!!devBlock && re.test(devBlock.decl),
    `頁面級硬化 ${label} MUST 掛在裝置 class \`body.touch-dev\` 之下`);
  ok(!uiBlocks.some((r) => re.test(r.decl)),
    `${label} MUST NOT 留在 \`body.touch-ui\`(那是房主可關的房間設定,鎖鍵鼠時保護會整組消失)`);
}
ok(cssRules.some((r) => r.sels.includes('body.touch-dev #game') && /touch-action:\s*none/.test(r.decl)),
  '`#game { touch-action: none }` MUST 掛在 `body.touch-dev` 之下(捏合/雙擊縮放要在真手機上恆被吃掉)');
ok(!cssRules.some((r) => r.sels.includes('body.touch-ui #game') && /touch-action:\s*none/.test(r.decl)),
  '`body.touch-ui #game { touch-action: none }` MUST 已改綁裝置 class(留著 = 舊制那一份仍在)');
// Verdict single seam: mount points may only forward `touchCapable()`; MUST NOT re-judge devices in
// mobile.js (section I already guards the other half)
ok(/classList\.toggle\('touch-dev',\s*touchCapable\(\)\)/.test(code(mobileSrc)),
  '`touch-dev` 的判定 MUST 只轉呼 `ctrlmode.touchCapable()`(裝置判定全 repo 只有一份)');
ok(count(code(mobileSrc), /classList\.toggle\('touch-dev'/g) === 1
  && /installTouchUI\(\)[\s\S]{0,900}?classList\.toggle\('touch-dev'/.test(code(mobileSrc)),
  '`touch-dev` 的掛載點 MUST 恰一處、且與 `installTouchUI()` 同一支(兩處掛 = 兩份真相)');
ok(!/classList\.toggle\('touch-dev',\s*(on|isTouchUI\(\)|usePad\(\))/.test(code(mobileSrc)),
  '`touch-dev` MUST NOT 吃 `isTouchUI()` / `usePad()`(那樣就只是 touch-ui 的第二個名字)');

// 4 Scroll containers MUST NOT be covered by touch-action:none — lobby `.screen` and a dozen
// `overflow-y: auto` shop/settings/codex panels scroll; written on the root or a scroll container the
// symptom is "lobby does not scroll", never an error. The criterion is the selector's **subject** (last
// compound): `body.touch-dev #game` subjects to `#game`, the deliberate named exception (the battlefield
// cell was never meant to scroll).
const taSubjects = subjectsWhere(/touch-action:\s*none/);
const scrollSubjects = subjectsWhere(/overflow(-[xy])?:\s*(auto|scroll)/);
const ROOTISH = /^(\*|html|body(\.[\w-]+)*)$/;
ok(taSubjects.size > 0, '掃得到 `touch-action: none` 的規則(掃不到 = 這一條是恆真的假綠)');
const taBad = [...taSubjects].filter((s) => ROOTISH.test(s) || scrollSubjects.has(s));
ok(taBad.length === 0,
  `\`touch-action: none\` MUST NOT 上根層或捲動容器${taBad.length ? `(命中:${taBad.join(' / ')})` : ''}`);
ok(cssRules.some((r) => r.sels.includes('.screen') && /overflow:\s*auto/.test(r.decl)),
  '`.screen` MUST 維持 `overflow: auto`(大廳每一頁都靠它捲)');

// 5 Safe-area and control variables MUST stay on `body.touch-ui` — they are **layout**: with no stick
// layer nothing insets. This column is 3's control: --break-touchdev reds 3 while 5 MUST stay green; both
// columns green together proves the split.
const SAFE_VARS = ['--tl-sl', '--tl-sr', '--tl-sb', '--tl-st'];
for (const v of SAFE_VARS) {
  ok(uiBlocks.some((r) => new RegExp(`\\${v}:\\s*env\\(safe-area-inset-`).test(r.decl)),
    `安全區變數 ${v} MUST 仍住 \`body.touch-ui\`(那是版型不是裝置)`);
  ok(!devBlock || !new RegExp(`\\${v}:`).test(devBlock.decl),
    `安全區變數 ${v} MUST NOT 搬進 \`body.touch-dev\``);
}
ok(uiBlocks.some((r) => /--tl-alpha:/.test(r.decl)) && uiBlocks.some((r) => /--tl-stick:/.test(r.decl)),
  '控件尺寸/透明度變數 MUST 仍住 `body.touch-ui`(版型與裝置 MUST NOT 再合流)');
ok(!devBlock || !/--tl-/.test(devBlock.decl),
  '`body.touch-dev` MUST 只放頁面級硬化,一個 `--tl-*` 都不准放');

// 6 Page-level `user-select:none` must not stop a touch-laptop host from handing relay metadata to
// teammates. Only two read-only values pass; passing `.room-meta` or the whole room page lets
// title/HUD long-press selection seep back in.
const relaySelect = cssRules.find((r) => r.sels.includes('body.touch-dev #roomPin')
  && r.sels.includes('body.touch-dev #roomUrls'));
ok(!!relaySelect && relaySelect.sels.length === 2,
  '觸控選字豁免 MUST 恰好只含 `#roomPin` / `#roomUrls` 兩個唯讀中繼值');
ok(!!relaySelect && /-webkit-user-select:\s*text/.test(relaySelect.decl)
  && /(^|[;\s])user-select:\s*text/.test(relaySelect.decl),
  'PIN / 區網網址 MUST 同時恢復標準與 WebKit 的文字選取');
ok(!!relaySelect && /-webkit-touch-callout:\s*default/.test(relaySelect.decl),
  'PIN / 區網網址 MUST 恢復 iOS 長按選單,否則可選但無法複製');
ok(/<div class="room-meta">[^<]*PIN\s*<b id="roomPin"[^>]*>[^<]*<\/b>[\s\S]*?<span id="roomUrls"[^>]*>/.test(htmlSrc),
  '選字豁免的兩個 id MUST 仍是房間中繼資料的唯讀文字節點');

console.log(`\n${fail ? '✗' : '✓'} 操作方式 / 觀戰選單稽核:${pass}/${pass + fail} 通過`);
process.exit(fail ? 1 : 0);
