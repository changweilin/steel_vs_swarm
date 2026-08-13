// ============ 定裝照工具:一台機體 × 多角度/多姿態(dev-only;headless)============
// 機體展示台的閉環驗證縫:改完 mechs/<key>.js → 跑本支 → 用眼睛比對 2D 定案圖。
// 走 viewer.js 的 __forge/__shot 鉤(headless-3d-inspection 技能同款:手動步進 + 顯式渲染)。
//
//   node tools/humanoid_forge/shot_mech.mjs --id t01 [--port 8635] [--prefix t01]
//
// `--id` 吃的是 **roster key**(`t01` / `t06@ground` / `t06@flight` / `s01`),與名冊同一套鍵;
// 檔名前綴預設把 `@` 換成 `_`(伺服器落盤會把非 \w 字元剝掉 ⇒ 不換的話兩個型態會撞檔名)。
//
// 前提:dev server 已在該埠跑著(node tools/humanoid_forge.mjs --port 8635)。
// Playwright 取自全域 npm(本專案零 npm 依賴,A2 —— dev 驗證工具借用全域安裝不入 package.json)。
import { createRequire } from 'node:module';

const req = createRequire(import.meta.url);
let chromium;
try {
  chromium = req('playwright').chromium;
} catch {
  chromium = req('C:/Users/user/AppData/Roaming/npm/node_modules/playwright').chromium;
}

const arg = (k, d) => {
  const i = process.argv.indexOf(`--${k}`);
  return i > 0 ? process.argv[i + 1] : d;
};
const id = arg('id');
const port = Number(arg('port', '8635'));
const prefix = arg('prefix', id && id.replace('@', '_'));
const distF = Number(arg('distF', '1'));
// 俯角覆寫(選用):水平翼面在預設的 0.12 俯角下幾乎是一條線 —— 「翼展開了沒/翼面多寬」
// 只有從上方看得到。省略 = 逐位元同舊行為。
const pitchO = process.argv.includes('--pitch') ? Number(arg('pitch', '0.12')) : null;
if (!id) {
  console.error('用法:node tools/humanoid_forge/shot_mech.mjs --id t01 [--port 8635] [--prefix t01] [--distF 1.6]');
  process.exit(1);
}

const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage();
  page.on('pageerror', (e) => console.error(`✗ 頁面例外:${e.message}`));
  page.on('console', (m) => { if (m.type() === 'error') console.error(`✗ console:${m.text()}`); });
  await page.goto(`http://localhost:${port}/`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction('!!window.__forge && !!window.__shot', null, { timeout: 20000 });

  const paths = await page.evaluate(async ({ id, prefix, distF, pitchO }) => {
    const F = window.__forge;
    if (!F.specs().includes(id)) throw new Error(`未知機型 ${id}(名冊:${F.specs().join(',')})`);
    F.setSpec(id);
    F.joints(false);
    const out = [];
    // 取景距離倍率(--distF):__shot 的預設鏡距 = 機高 ×2.6,是**人形**的取景 ——
    // 翼展遠大於機高的航空機體(鷹/翼龍/龍/定翼機)在那個距離只佔畫面一小塊,
    // 而「翅膀展開了沒」正是要看那一塊。distF 只縮放鏡距,distF=1 逐位元同舊行為。
    const D = (o) => {
      const r = distF === 1 ? { ...o } : { ...o, dist: F.height() * 2.6 * distF };
      if (pitchO != null) r.pitch = pitchO;
      return r;
    };
    const shot = async (name, opts) => out.push(await window.__shot(`${prefix}_${name}`, 900, 760, D(opts)));
    // 靜姿三視角(正面 / 前側 45° / 背面)—— 與 2D 定案圖比對的主力
    F.step(30);
    await shot('front', { yaw: 0, pitch: 0.12 });
    await shot('side45', { yaw: 0.8, pitch: 0.12 });
    await shot('back', { yaw: Math.PI, pitch: 0.12 });
    // 奔跑中段(步態不穿模、羽/尾/翼跟得上動作)
    F.setSpeed(1);
    F.step(80);
    await shot('run', { yaw: 0.6, pitch: 0.12 });
    F.setSpeed(0);
    F.step(60);
    // 輕武器擊發(槍口/後座)
    F.fire('light');
    F.step(5);
    await shot('fire', { yaw: 0.5, pitch: 0.1 });
    F.step(40);
    // 重武器:蓄力期滿擊發那一刻(蓄力 1.05s ≈ 63 幀)
    F.fire('heavy');
    F.step(62);
    await shot('charge', { yaw: 0.5, pitch: 0.1 });
    F.step(6);
    await shot('heavy', { yaw: 0.5, pitch: 0.1 });
    F.step(60);
    // 招式(全向)
    F.cast(0, 'ult');
    F.step(18);
    await shot('cast', { yaw: 0.4, pitch: 0.14 });
    return out;
  }, { id, prefix, distF, pitchO });

  console.log(paths.join('\n'));
} finally {
  await browser.close();
}
