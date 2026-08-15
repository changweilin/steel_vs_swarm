// ============ 觸控手勢稽核(空處 #tlLook + 點擊型鈕)============
// 用途:改 `mobile.js` 的 `_bindLook` / `_setLookFire` / `_tickLookFire` / `_bindButtons` /
// `_tapOk` / `_tickTap` / `LOOK.TAP_*` 後,用**合成指標事件**驗證兩條手勢都不會回歸。
//
// 為什麼要有這支:誤觸在真機上很難重現(要剛好點成雙擊的節奏、或剛好從鈕上滑出去),
// 但一旦壞掉就是每一場都中招;而判定本身是「時間 × 位移 × 前一次點擊」三個變數的狀態機,
// 肉眼讀程式碼看不出邊界。
//
// 驗的七件事(①~⑦ 空處手勢、⑧ 點擊型鈕):
//   ① 單指拖曳(轉視角)**MUST NOT** 開火 —— 這是每秒都在做的動作
//   ② 純雙擊(點兩下就放開)**MUST NOT** 開火 —— 捲動/誤觸太容易產生
//   ③ 輕點一下 → 再按住 = 開火(長按路徑,走幀迴圈 tick)
//   ④ 輕點一下 → 再拖曳 = 開火,且視角照常轉(拖曳路徑)
//   ⑤ 放開即停;且「A 鈕按著時放開空處手勢」MUST NOT 代 A 收掉射擊
//   ⑧ **一次點擊 = 距離 + 時間**(2026-08-16,`docs/anime_style_plan.md` ⑧-1):
//      點擊型鈕在 `pointerdown` **MUST NOT** 派發;拖過 `TAP_SLOP_PX`、按超過 `TAP_MS`、
//      或收到 `pointercancel` 一律不算點擊。按住型(A/R/ZR/B/ZL)**MUST 逐位元維持舊制**
//      —— 拿點擊判定去閘射擊就是交火中途停火。
//      壞掉的症狀:滑過搖桿邊緣就開商店 / 按了招式沒反應,兩者都不留任何錯誤訊息。
// 跑法:`node tools/audit_touch_gesture.mjs`(反向驗證 `--break-tap` = 退回「按下即派發」)
import { chromiumOrNull, chromePath, serve, skipNoPlaywright, THREE_STUB, THREE_CDN } from './pw.mjs';
import { readSrc } from './audit_src.mjs';

const chromium = await chromiumOrNull();
if (!chromium) skipNoPlaywright('觸控手勢稽核');

// 反向驗證(兩支,都是把規則寫回壞版):
//   --break-tap      點擊型鈕改回舊制的「pointerdown 當場派發」⇒ ⑧ 整段 MUST 紅
//   --break-debounce 視窗尺寸改回「每一筆都當場算數」        ⇒ ⑨ 整段 MUST 紅
// 替換無效(原文已變)MUST 當場失敗 —— 不然 break 永遠是綠的(見 tools/CLAUDE.md 紀律 2)。
const BREAK_TAP = process.argv.includes('--break-tap');
const BREAK_DEB = process.argv.includes('--break-debounce');
let mobileSrc = null;
if (BREAK_TAP || BREAK_DEB) mobileSrc = readSrc('public', 'js', 'mobile.js');
const patch = (flag, name, re, to) => {
  if (!flag) return;
  if (!re.test(mobileSrc)) {
    console.log(`✗ ${name}:字面替換無效(原文已變 ⇒ 這支 break 根本沒造出壞版)`);
    process.exit(1);
  }
  mobileSrc = mobileSrc.replace(re, to);
};
patch(BREAK_TAP, '--break-tap', /this\._tap\.set\(e\.pointerId,[^;]*\);/, 'this.client._cmd(act, true);');
patch(BREAK_DEB, '--break-debounce', /export function bumpViewport\(\) \{[\s\S]*?\r?\n\}/,
  'export function bumpViewport() { for (const fn of [..._vpSubs]) { try { fn(); } catch { /* */ } } }');

const srv = await serve();
// 只需要 #tlLook 與兩顆鈕:手勢判定不依賴版型,量的是狀態機不是幾何(幾何在 audit_touch_layout)。
// A = 按住型(HOLD)、⊟ 商店 = 點擊型 —— 兩類規則不同,MUST 各驗各的。
const PAGE = `<!doctype html><html><head><meta charset="utf-8">
<script type="importmap">{"imports":{"three":"${THREE_CDN}"}}<\/script>
<style>#tlLook{position:fixed;inset:0}</style>
</head><body>
<div id="touchLayer" hidden><div id="tlLook"></div>
<button class="tl-gb gb-a" type="button" data-act="fire">A</button>
<button class="tl-dp-b dir-up" type="button" data-act="shop">⊟</button></div>
<script type="module">
import * as M from '/public/js/mobile.js';
window.M = M;
window.cmds = []; window.looks = [];
// 假 client:走的是與戰鬥完全相同的 _cmd / _applyLook 派發路徑(見 mobile.js 檔頭三個共用縫)
const mock = {
  heroKind: 'mech', side: 'STEEL', paused: false, shopOpen: false, _gameOver: false, dead: false,
  firing: false, yaw: 0, pitch: 0,
  hud: { feed: () => {} },
  _applyLook(dy, dp) { window.looks.push([dy, dp]); this.yaw += dy; this.pitch += dp; },
  _cmd(act, down) { window.cmds.push([act, down]); if (act === 'fire') this.firing = !!down; },
};
window.mock = mock;
window.mkTc = () => {
  window.tc?.dispose();
  window.M.TOUCH.gyro = false;
  window.cmds = []; window.looks = [];
  mock.firing = false; mock.paused = false; mock.yaw = 0;
  window.tc = new M.TouchControls(mock);
};
window.ready = true;
<\/script></body></html>`;

const browser = await chromium.launch({ executablePath: chromePath() });
const page = await browser.newPage({ viewport: { width: 844, height: 390 }, hasTouch: true });
await page.route(THREE_CDN, (r) =>
  r.fulfill({ status: 200, contentType: 'text/javascript', body: THREE_STUB }));
await page.route(`${srv.url}__gesture.html`, (r) =>
  r.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: PAGE }));
// 壞版才攔截模組本體:平常一律吃磁碟上的**真品**(攔截了就等於在驗自己貼的那份字串)
if (mobileSrc) {
  await page.route(`${srv.url}public/js/mobile.js`, (r) =>
    r.fulfill({ status: 200, contentType: 'text/javascript', body: mobileSrc }));
}
page.on('pageerror', (e) => console.log('PAGE ERROR', e.message));
await page.goto(`${srv.url}__gesture.html`);
await page.waitForFunction(() => window.ready === true, null, { timeout: 8000 });

let pass = 0, fail = 0;
const t = (name, ok, extra = '') => {
  if (ok) { pass++; console.log(`  ✓ ${name}`); } else { fail++; console.log(`  ✗ ${name} ${extra}`); }
};

// 指標事件都打在 #tlLook 上(id 固定 1);tick 由測試自己泵 —— 長按路徑住在幀迴圈裡
const ev = (type, x, y) => page.evaluate(([type, x, y]) => {
  const el = document.getElementById('tlLook');
  el.setPointerCapture = () => {};   // jsdom/headless 沒有真的指標捕捉,吞掉即可(mobile.js 已包 try)
  el.dispatchEvent(new PointerEvent(type, { bubbles: true, pointerId: 1, clientX: x, clientY: y }));
}, [type, x, y]);
const tick = (n = 1) => page.evaluate((n) => { for (let i = 0; i < n; i++) window.tc.tick(1 / 60); }, n);
const wait = (ms) => page.waitForTimeout(ms);
const fired = () => page.evaluate(() => window.cmds.filter((c) => c[0] === 'fire'));
const fresh = () => page.evaluate(() => window.mkTc());

console.log('\n■ ① 單指拖曳轉視角 MUST NOT 開火');
await fresh();
await ev('pointerdown', 400, 200);
for (let i = 1; i <= 12; i++) await ev('pointermove', 400 + i * 9, 200 + i * 3);
await tick(20);
await ev('pointerup', 508, 236);
t('拖曳全程沒有 fire', (await fired()).length === 0, JSON.stringify(await fired()));
t('拖曳有轉到視角', (await page.evaluate(() => window.looks.length)) >= 10);

console.log('\n■ ② 純雙擊(點兩下就放開)MUST NOT 開火');
await fresh();
await ev('pointerdown', 400, 200); await ev('pointerup', 400, 200);
await wait(60);
await ev('pointerdown', 402, 201); await tick(2); await ev('pointerup', 402, 201);
t('雙擊不擊發', (await fired()).length === 0, JSON.stringify(await fired()));

console.log('\n■ ③ 輕點 → 再按住 = 開火(長按路徑走幀迴圈)');
await fresh();
await ev('pointerdown', 400, 200); await ev('pointerup', 400, 200);
await wait(60);
await ev('pointerdown', 401, 200);
await tick(2);
t('按下當下還沒開火(要先滿足 TAP_FIRE_MS)', (await fired()).length === 0, JSON.stringify(await fired()));
await wait(200); await tick(2);
t('按住超過門檻 → fire↓', JSON.stringify(await fired()) === '[["fire",true]]', JSON.stringify(await fired()));
t('client.firing 真的被打開', await page.evaluate(() => window.mock.firing === true));
await ev('pointerup', 401, 200);
t('放開 → fire↑', JSON.stringify(await fired()) === '[["fire",true],["fire",false]]', JSON.stringify(await fired()));
t('client.firing 收回', await page.evaluate(() => window.mock.firing === false));

console.log('\n■ ④ 輕點 → 再拖曳 = 開火,且視角照常轉');
await fresh();
await ev('pointerdown', 400, 200); await ev('pointerup', 400, 200);
await wait(60);
await ev('pointerdown', 400, 200);
await ev('pointermove', 420, 205);      // 位移 > TAP_FIRE_PX ⇒ 不必等時間就開火
t('一拖就 fire↓(不必等長按門檻)', JSON.stringify(await fired()) === '[["fire",true]]', JSON.stringify(await fired()));
t('拖曳期間視角照常轉', (await page.evaluate(() => window.mock.yaw)) !== 0);
await ev('pointerup', 420, 205);
t('放開停火', (await fired()).at(-1)[1] === false, JSON.stringify(await fired()));

console.log('\n■ ⑤ 邊界:間隔太久不算雙擊 / 第一下太長不算輕點 / 不會連發武裝');
await fresh();
await ev('pointerdown', 400, 200); await ev('pointerup', 400, 200);
await wait(500);                         // > TAP_GAP_MS
await ev('pointerdown', 400, 200); await wait(220); await tick(2);
t('間隔超過 TAP_GAP_MS → 不武裝', (await fired()).length === 0, JSON.stringify(await fired()));
await ev('pointerup', 400, 200);

await fresh();
await ev('pointerdown', 400, 200); await wait(400); await ev('pointerup', 400, 200);   // 第一下是長按不是點
await wait(60);
await ev('pointerdown', 400, 200); await wait(220); await tick(2);
t('第一下超過 TAP_MS → 不算輕點,不武裝', (await fired()).length === 0, JSON.stringify(await fired()));
await ev('pointerup', 400, 200);

await fresh();
await ev('pointerdown', 400, 200); await ev('pointerup', 400, 200);
await wait(60);
await ev('pointerdown', 400, 200); await wait(220); await tick(2); await ev('pointerup', 400, 200);  // 開火手勢
await wait(60);
await ev('pointerdown', 400, 200); await wait(220); await tick(2);                                   // 再按一次
t('開火手勢放開後不自動武裝下一發(要重新雙擊)',
  (await fired()).filter((c) => c[1]).length === 1, JSON.stringify(await fired()));
await ev('pointerup', 400, 200);

console.log('\n■ ⑥ A 鈕與空處手勢並用:兩邊都放開才停火');
await fresh();
await page.evaluate(() => {
  const a = document.querySelector('[data-act="fire"]');
  a.setPointerCapture = () => {};
  a.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, pointerId: 2, clientX: 10, clientY: 10 }));
});
await ev('pointerdown', 400, 200); await ev('pointerup', 400, 200);
await wait(60);
await ev('pointerdown', 400, 200); await wait(220); await tick(2);
await ev('pointerup', 400, 200);                       // 空處手勢放開,但 A 還按著
t('A 仍按著 → 空處手勢放開不送 fire↑', await page.evaluate(() => window.mock.firing === true),
  JSON.stringify(await fired()));
await page.evaluate(() => {
  document.querySelector('[data-act="fire"]')
    .dispatchEvent(new PointerEvent('pointerup', { bubbles: true, pointerId: 2, clientX: 10, clientY: 10 }));
});
t('A 放開後才真的停火', await page.evaluate(() => window.mock.firing === false));

console.log('\n■ ⑦ 疊層開著(選單/商店)不吃手勢');
await fresh();
await page.evaluate(() => { window.mock.paused = true; });
await ev('pointerdown', 400, 200); await ev('pointerup', 400, 200);
await wait(60);
await ev('pointerdown', 400, 200); await wait(220); await tick(2);
t('暫停時空處手勢不開火', (await fired()).filter((c) => c[1]).length === 0, JSON.stringify(await fired()));
await ev('pointerup', 400, 200);
await page.evaluate(() => { window.mock.paused = false; });

console.log('\n■ ⑧ 點擊型鈕:一次點擊 = 距離 + 時間(--break-tap 這一整段 MUST 紅)');
// 鈕上的合成事件:與 audit_gyro 同形(id 3,免得與空處手勢的 1 撞號)
const btn = (type, x, y, act = 'shop') => page.evaluate(([type, x, y, act]) => {
  const el = document.querySelector(`[data-act="${act}"]`);
  el.setPointerCapture = () => {};
  el.dispatchEvent(new PointerEvent(type, { bubbles: true, pointerId: 3, clientX: x, clientY: y }));
}, [type, x, y, act]);
const shopped = () => page.evaluate(() => window.cmds.filter((c) => c[0] === 'shop'));
const pressed = () => page.evaluate(() =>
  document.querySelector('[data-act="shop"]').classList.contains('press'));
const SLOP = await page.evaluate(() => window.M.LOOK.TAP_SLOP_PX);
const TAPMS = await page.evaluate(() => window.M.LOOK.TAP_MS);

await fresh();
await btn('pointerdown', 100, 100);
t('按下當下 MUST NOT 派發(舊制在這裡就送出去了)', (await shopped()).length === 0, JSON.stringify(await shopped()));
t('按下當下鈕面就亮(回饋先於動作)', await pressed());
await btn('pointerup', 100, 100);
t('放開 → 派發一次', JSON.stringify(await shopped()) === '[["shop",true]]', JSON.stringify(await shopped()));

await fresh();
await btn('pointerdown', 100, 100);
await btn('pointermove', 100 + SLOP + 6, 100);      // 拖出容差 = 從鈕上滑走
await btn('pointerup', 100 + SLOP + 6, 100);
t('拖出 TAP_SLOP_PX 之外 → 不派發', (await shopped()).length === 0, JSON.stringify(await shopped()));
t('拖走當場熄燈', (await pressed()) === false);

await fresh();
await btn('pointerdown', 100, 100);
await wait(TAPMS + 90); await tick(2);              // 時間那一半住幀迴圈 ⇒ 要泵 tick
t('按過 TAP_MS → 幀迴圈當場熄燈', (await pressed()) === false);
await btn('pointerup', 100, 100);
t('按過 TAP_MS → 不派發', (await shopped()).length === 0, JSON.stringify(await shopped()));

await fresh();
await btn('pointerdown', 100, 100);
await btn('pointercancel', 100, 100);
t('pointercancel(系統手勢接管)→ 不派發', (await shopped()).length === 0, JSON.stringify(await shopped()));

// 按住型 MUST 逐位元維持舊制 —— 這一條是 --break-tap **不該**紅的對照組
await fresh();
await btn('pointerdown', 10, 10, 'fire');
t('按住型 A 仍在 pointerdown 當場 fire↓', JSON.stringify(await fired()) === '[["fire",true]]', JSON.stringify(await fired()));
await btn('pointermove', 10 + SLOP + 40, 10, 'fire');
t('按住型拖遠 MUST NOT 停火(拇指微滑是常態)', await page.evaluate(() => window.mock.firing === true));
await btn('pointerup', 10 + SLOP + 40, 10, 'fire');
t('按住型放開 → fire↑', (await fired()).at(-1)[1] === false, JSON.stringify(await fired()));

console.log('\n■ ⑨ 視窗尺寸定案:連發合併成最後一個(--break-debounce 這一段 MUST 紅)');
// 旋轉一次會連發好幾個尺寸,逐筆重配 render target = 頓一下 + 有機會停在中間那個錯的尺寸。
// 這一段量的是**行為**(真的 setTimeout);「只有一份等待時間 + 消費端沒繞過」在 audit_ctrl_mode Ⅸ。
const dbg = await page.evaluate(async () => {
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const ms = window.M.viewportSettleMs();
  let n = 0;
  const off = window.M.onViewportSettled(() => { n++; });
  for (let i = 0; i < 6; i++) window.M.bumpViewport();
  const during = n;
  await wait(ms + 150);
  const after = n;
  n = 0;
  window.dispatchEvent(new Event('resize'));
  window.dispatchEvent(new Event('resize'));
  window.dispatchEvent(new Event('resize'));
  const duringR = n;
  await wait(ms + 150);
  const afterR = n;
  off();
  n = 0;
  window.dispatchEvent(new Event('resize'));
  await wait(ms + 150);
  return { ms, during, after, duringR, afterR, afterOff: n };
});
t('非 iOS 的等待時間 = VIEWPORT.SETTLE_MS(50)', dbg.ms === 50, JSON.stringify(dbg));
t('連發 6 次 MUST NOT 當場回呼', dbg.during === 0, JSON.stringify(dbg));
t('連發 6 次只回呼一次(合併成最後一個尺寸)', dbg.after === 1, JSON.stringify(dbg));
t('真的 resize 事件走同一條 debounce', dbg.duringR === 0 && dbg.afterR === 1, JSON.stringify(dbg));
t('解除訂閱後不再回呼(dispose 不留殭屍消費端)', dbg.afterOff === 0, JSON.stringify(dbg));

await browser.close();
srv.close();
console.log(fail ? `\n✗ ${pass} 通過 / ${fail} 失敗` : `\n✓ 觸控手勢 ${pass} 項全通過`);
process.exit(fail ? 1 : 0);
