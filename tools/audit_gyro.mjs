// ============ 陀螺儀輸入鏈稽核(兩條感測路徑 + 自動切換)============
// 用途:改 `mobile.js` 的 `Gyro` / `LOOK.GYRO_*` / 感測來源後,用**合成事件**驗證:
//   ① deviceorientation(融合姿態):alpha→水平、beta→俯仰,軸向分離且增益 1:1
//   ② devicemotion(角速度):投影到畫面軸再積分,與 ① **同號**(兩條路徑手感一致),
//      且螢幕旋轉角會自動補正(橫式下換成另一個裝置軸提供水平)
//   ③ 自動切換:方向感測收不到 / 缺水平朝向(無磁力計)時改走角速度;鎖死來源就不偷換
//   ④ 兩條都不通 → 關閉開關並把原因寫進戰報(MUST NOT 靜默)
//   ⑤ 不可用時的「陀螺」鈕(.off)按下去仍要寫出理由
//
// 真機仍 MUST 實測(見 /CLAUDE.md 驗證矩陣:https + 轉手機看準星),
// 這支只保證**程式邏輯與軸向**不退化 —— 合成事件測不出感測器本身有沒有在動。
// 跑法:`node tools/audit_gyro.mjs`
import { chromiumOrNull, chromePath, serve, skipNoPlaywright, THREE_STUB } from './pw.mjs';
import { readSrc } from './audit_src.mjs';

/** 宣告的預設值只驗得到原文 —— 執行時的 `TOUCH` 早被前面每一段測試改過(見「預設關閉」段) */
const mobileSrc = readSrc('public', 'js', 'mobile.js');

const chromium = await chromiumOrNull();
if (!chromium) skipNoPlaywright('陀螺儀稽核');

const srv = await serve();
const PAGE = `<!doctype html><html><head><meta charset="utf-8">
<script type="importmap">{"imports":{"three":"https://unpkg.com/three@0.160.0/build/three.module.js"}}<\/script>
</head><body>
<div id="touchLayer" hidden><div id="tlLook"></div><div id="tlDpad"><span id="tlKnob"></span></div>
<button class="tl-dp-b dir-dn" type="button" data-act="gyro">陀螺</button></div>
<script type="module">
import * as M from '/public/js/mobile.js';
window.M = M;
window.looks = []; window.feeds = [];
// 假 client:走的是與戰鬥完全相同的 _applyLook 派發路徑(見 mobile.js 檔頭三個共用縫)
const mock = {
  heroKind: 'drone', side: 'SWARM', paused: false, shopOpen: false, _gameOver: false, dead: false,
  yaw: 0, pitch: 0,
  hud: { feed: (t) => window.feeds.push(t) },
  _applyLook(dy, dp) { window.looks.push([dy, dp]); this.yaw += dy; this.pitch += dp; },
  _cmd() {},
};
window.mkTc = () => { window.tc = new M.TouchControls(mock); return true; };
window.ready = true;
<\/script></body></html>`;

const browser = await chromium.launch({ executablePath: chromePath() });
const page = await browser.newPage({ viewport: { width: 844, height: 390 } });
await page.route('https://unpkg.com/three@0.160.0/build/three.module.js', (r) =>
  r.fulfill({ status: 200, contentType: 'text/javascript', body: THREE_STUB }));
await page.route(`${srv.url}__gyro.html`, (r) =>
  r.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: PAGE }));
page.on('pageerror', (e) => console.log('PAGE ERROR', e.message));
await page.goto(`${srv.url}__gyro.html`);
await page.waitForFunction(() => window.ready === true, null, { timeout: 8000 });

let pass = 0, fail = 0;
const t = (name, ok, extra = '') => {
  if (ok) { pass++; console.log(`  ✓ ${name}`); } else { fail++; console.log(`  ✗ ${name} ${extra}`); }
};
const deg = (r) => r * 180 / Math.PI;

// 每個案例重建一個 TouchControls ⇒ Gyro 從乾淨狀態起算(權限直接標記為已授權)
const setup = (src) => page.evaluate((src) => {
  window.tc?.dispose();
  window.looks = []; window.feeds = [];
  window.M.TOUCH.gyro = true; window.M.TOUCH.gyroSrc = src;
  window.M.TOUCH.gyroSens = 1; window.M.TOUCH.gyroInvert = false;
  window.mkTc();
  window.tc.gyro.granted = true;
  window.tc.gyro.start();
}, src);
const ori = (a, b, g) => page.evaluate(([a, b, g]) => {
  const ev = new Event('deviceorientation');
  Object.assign(ev, { alpha: a, beta: b, gamma: g });
  window.dispatchEvent(ev);
}, [a, b, g]);
const motion = (rx, ry, rz, interval = 1000 / 60) => page.evaluate(([rx, ry, rz, interval]) => {
  const ev = new Event('devicemotion');
  Object.assign(ev, { rotationRate: { beta: rx, gamma: ry, alpha: rz }, interval });
  window.dispatchEvent(ev);
}, [rx, ry, rz, interval]);
const sum = () => page.evaluate(() => window.looks.reduce((a, l) => [a[0] + l[0], a[1] + l[1]], [0, 0]));
const setAngle = (a) => page.evaluate((a) => {
  Object.defineProperty(window.screen.orientation, 'angle', { get: () => a, configurable: true });
}, a);

console.log('\n■ 路徑 ① deviceorientation(融合姿態)');
await setup('orient');
await ori(0, 90, 0);      // 基準:直式手持(beta 90 = 螢幕面向使用者)
await ori(20, 90, 0);     // alpha +20 = 水平左轉 20°
let [dy, dp] = await sum();
t('alpha +20° → yaw +20°(1:1)', Math.abs(deg(dy) - 20) < 0.5, `實得 ${deg(dy).toFixed(2)}°`);
t('alpha 只動水平、俯仰不動', Math.abs(deg(dp)) < 0.5, `實得 ${deg(dp).toFixed(2)}°`);

await setup('orient');
await ori(0, 90, 0);
await ori(0, 75, 0);      // beta 90→75:頂端前傾,相機朝機背 ⇒ 俯視
[dy, dp] = await sum();
t('beta −15° → pitch −15°(俯視)', Math.abs(deg(dp) + 15) < 0.5, `實得 ${deg(dp).toFixed(2)}°`);
t('beta 只動俯仰、水平不動', Math.abs(deg(dy)) < 0.5, `實得 ${deg(dy).toFixed(2)}°`);

await setup('orient');
await page.evaluate(() => { window.M.TOUCH.gyroInvert = true; });
await ori(0, 90, 0); await ori(0, 75, 0);
[dy, dp] = await sum();
t('垂直反轉 → pitch 反號', deg(dp) > 14 && deg(dp) < 16, `實得 ${deg(dp).toFixed(2)}°`);
await page.evaluate(() => { window.M.TOUCH.gyroInvert = false; });

console.log('\n■ 路徑 ② devicemotion(角速度;無磁力計也能用)');
await setup('motion');
await motion(0, 0, 0);                  // 第一筆只當基準(dt 還不可信)
await motion(0, 60, 0, 1000 / 60);      // 繞裝置 y(直式 = 畫面上方軸)60°/s × 1/60s = 1°
[dy, dp] = await sum();
t('繞畫面上方軸 → yaw(左轉為正,與 ① 同號)', Math.abs(deg(dy) - 1) < 0.02, `實得 ${deg(dy).toFixed(3)}°`);
t('水平不汙染俯仰', Math.abs(deg(dp)) < 0.001, `實得 ${deg(dp).toFixed(4)}°`);

await setup('motion');
await motion(0, 0, 0);
await motion(-60, 0, 0, 1000 / 60);     // rotationRate.beta 為負 = beta 下降 ⇒ 俯視(對上 ①)
[dy, dp] = await sum();
t('繞畫面右軸 → pitch 與 ① 同號(俯視)', Math.abs(deg(dp) + 1) < 0.02, `實得 ${deg(dp).toFixed(3)}°`);

await setup('motion');
await setAngle(90);                     // 橫式:畫面上方軸改成裝置 +x ⇒ 水平改由 rotationRate.beta 提供
await motion(0, 0, 0);
await motion(60, 0, 0, 1000 / 60);
[dy] = await sum();
t('橫式 90°:軸向自動補正(裝置 x → yaw)', Math.abs(deg(dy) - 1) < 0.02, `實得 ${deg(dy).toFixed(3)}°`);
await setAngle(0);

console.log('\n■ 自動切換(auto)');
await setup('auto');
await page.waitForTimeout(2100);
let st = await page.evaluate(() => ({ path: window.tc.gyro.path, on: window.M.TOUCH.gyro }));
t('方向感測 0 筆 → 自動改走角速度', st.path === 'motion', JSON.stringify(st));
t('切換過程不關閉陀螺儀', st.on === true, JSON.stringify(st));
await motion(0, 0, 0); await motion(0, 60, 0, 1000 / 60);
[dy] = await sum();
t('切換後角速度真的推得動準星', Math.abs(deg(dy) - 1) < 0.02, `實得 ${deg(dy).toFixed(3)}°`);

await setup('auto');
await ori(null, 90, 0);
for (let i = 1; i <= 20; i++) await ori(null, 90 - i, 0);   // 有事件、有俯仰,但 alpha 恆 null
st = await page.evaluate(() => ({ path: window.tc.gyro.path, note: window.tc.gyro.note }));
t('alpha 恆 null(無磁力計)→ 偵測水平軸死亡並改走角速度', st.path === 'motion', JSON.stringify(st));
await motion(0, 0, 0); await motion(0, 60, 0, 1000 / 60);
const after = await page.evaluate(() => window.looks.at(-1));
t('改走角速度後水平可動', Math.abs(deg(after[0]) - 1) < 0.02, `實得 ${deg(after[0]).toFixed(3)}°`);

await setup('orient');
await page.waitForTimeout(2100);
st = await page.evaluate(() => ({ note: window.tc.gyro.note, on: window.M.TOUCH.gyro, feeds: window.feeds }));
t('鎖死方向感測 → 不偷偷換路徑', st.note === '' && st.feeds.some((f) => f.includes('方向感測')), JSON.stringify(st));
t('收不到資料 → 關閉開關並講原因', st.on === false && st.feeds.some((f) => f.includes('陀螺儀')), JSON.stringify(st.feeds));

await setup('auto');
await page.waitForTimeout(3600);
st = await page.evaluate(() => ({ on: window.M.TOUCH.gyro, feeds: window.feeds }));
t('auto 兩條都不通 → 關閉並講原因', st.on === false && st.feeds.length > 0, JSON.stringify(st.feeds));

console.log('\n■ 預設關閉 + 十字鍵下「陀螺」一鍵收放');
// 2026-08-04 使用者需求「陀螺儀改成預設關閉」。這一條 MUST 驗**宣告的預設值**而不是執行時的
// `window.M.TOUCH.gyro` —— 上面每一段都在改那個值、`saveTouchPrefs()` 也寫過 localStorage,
// 讀執行時值等於在驗前一段留下的殘留(舊版那句 `|| localStorage.getItem(...) !== null`
// 正是為此加的逃生門,代價是這條斷言幾乎恆真:預設值被改掉也不會紅)。
t('TOUCH.gyro 宣告的預設值為關', /\bgyro:\s*false\s*,/.test(mobileSrc),
  mobileSrc.match(/\bgyro:\s*[^,\n]+/)?.[0]);
// 陀螺鈕按一下 → 關;再按一下 → 開(走的是 _local → setGyro 這一個縫)。
// 2026-07-27 這顆從 ZR 搬到十字鍵下(ZR 改給機種絕招),但走的仍是同一個 data-act。
const zr = await page.evaluate(async () => {
  window.tc?.dispose();
  window.M.TOUCH.gyro = true; window.M.TOUCH.gyroSrc = 'motion';
  window.mkTc();
  window.tc.gyro.granted = true;
  await window.tc.setGyro(true, true);
  // 一次**完整的點擊** = 按下 + 放開:2026-08-16 起點擊型鈕在放開才定案(距離 + 時間,
  // 見 mobile.js `_bindButtons`)⇒ 只送 pointerdown 等於「按著沒放」,什麼都不會發生。
  const tap = async () => {
    const b = document.querySelector('[data-act="gyro"]');
    b.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, pointerId: 1, clientX: 8, clientY: 8 }));
    b.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, pointerId: 1, clientX: 8, clientY: 8 }));
    await new Promise((r) => setTimeout(r, 40));
    return { active: window.tc.gyro.active, pref: window.M.TOUCH.gyro,
             on: document.querySelector('[data-act="gyro"]').classList.contains('on') };
  };
  const a = await tap(), b = await tap();
  return { start: true, off: a, back: b };
});
t('陀螺鈕按一下關閉陀螺儀', zr.off.active === false && zr.off.pref === false, JSON.stringify(zr.off));
t('陀螺鈕再按一下重新開啟', zr.back.active === true && zr.back.pref === true, JSON.stringify(zr.back));
t('陀螺鈕鈕面反映開關狀態(.on)', zr.off.on === false && zr.back.on === true, JSON.stringify([zr.off.on, zr.back.on]));

// iOS:靜默(非使用者手勢)啟用時 MUST NOT 去要權限 —— 要了會被拒,連帶把玩家上一場開啟過的偏好關掉
const ios = await page.evaluate(async () => {
  window.tc?.dispose();
  const D = window.DeviceOrientationEvent;
  let asked = false;
  D.requestPermission = () => { asked = true; return Promise.reject(new Error('not a gesture')); };
  window.M.TOUCH.gyro = true;
  window.mkTc();
  window.tc.gyro.granted = false;
  window.feeds = [];
  const ret = await window.tc.setGyro(true, true);       // silent = 進場自動套用偏好
  const out = { asked, ret, pref: window.M.TOUCH.gyro, feeds: [...window.feeds] };
  delete D.requestPermission;
  return out;
});
t('iOS 靜默啟用不在非手勢中要權限', ios.asked === false, JSON.stringify(ios));
t('待授權時保留玩家開啟過的偏好', ios.pref === true && ios.ret === true, JSON.stringify(ios));
// 提示 MUST 指到真的存在的那顆鈕 —— 舊版寫「按一下 ZR」,ZR 改成絕招後就是把玩家指去按絕招
t('待授權時提示玩家按十字鍵下的陀螺鈕', ios.feeds.some((f) => f.includes('十字鍵')), JSON.stringify(ios.feeds));

console.log('\n■ 不可用狀態(.off)的「陀螺」鈕');
const tapped = await page.evaluate(async () => {
  window.tc?.dispose(); window.feeds = [];
  window.mkTc();
  const btn = document.querySelector('[data-act="gyro"]');
  btn.classList.add('off');
  btn.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, pointerId: 1, clientX: 8, clientY: 8 }));
  btn.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, pointerId: 1, clientX: 8, clientY: 8 }));
  await new Promise((r) => setTimeout(r, 50));
  return window.feeds.length;
});
t('.off 的陀螺鈕按下去會寫出理由(不再靜默)', tapped > 0, `feeds=${tapped}`);

await browser.close();
srv.close();
console.log(fail ? `\n✗ ${pass} 通過 / ${fail} 失敗` : `\n✓ 陀螺儀輸入鏈 ${pass} 項全通過`);
process.exit(fail ? 1 : 0);
