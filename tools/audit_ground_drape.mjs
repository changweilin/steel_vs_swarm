// ============ 地被貼合稽核(斜坡破圖;需 playwright + 網路 ㋓)============
// 2026-08-13 使用者回報「斜坡時地貌拼圖很容易破圖」。
//
// ---- 病灶 ----
// 地被拼圖是**鋪在地形上的一層皮**:它的頂點取 `terrain.heightAt` ⇒ **頂點恆在地形上**,
// 而頂點與頂點之間是**直的**。地形不是 —— 它是逐格三角化的高度場,兩片三角面相接處有折角。
// 一條穿過折角的皮邊(弦)因此低於地形本身,低多少 = 折角的角度 × 弦長 ÷ 4:
// 皮的邊長 ≈ 半個 cell(13m ÷ 2),而山區相鄰兩格的坡度差輕鬆就有十幾度 ⇒ **decimetre 級**,
// 而底毯的抬升只有 `CLIFT = 0.07m`。結果就是地形從皮底下戳出來,沿著地形網格線一條一條。
//
// 平地看不到(折角 = 0),坡越陡、地形越碎越明顯 —— 正是使用者說的「斜坡時」。
//
// ---- 這支量什麼 ----
// 走**真品**:`buildTerrain` + `buildBiomes` 建完之後,把每一片地被三角形逐點與
// `terrain.heightAt` 相減(這裡沒有第二份實作:皮的幾何是真的那一份,地形也是真的那一份)。
//   penetration = terrain.heightAt(p) − 皮在 p 的高度
// > 0 就是地形戳出來。逐層(底毯 / 外溢 / 脊帶 / 界線 / 特徵)報 p50 / p99 / max 與破圖面積比,
// 並依**坡度**分桶 —— 「斜坡才破」這句話要能在數字上看得見,否則改完也不知道有沒有改對。
//
// 用法:node tools/audit_ground_drape.mjs [--venue taroko] [--team 1] [--port 8636] [--live]
//       (找不到 playwright 就印一行說明並以 0 結束,同 shot_scene)
//
// ---- 接縫紀律:兩片蓋同一塊地的地表(2026-08-16 併入,`docs/anime_style_plan.md` ④-4;
//      純註解,零斷言改動)----
// 本支量的「地形戳穿地被」是那一族接縫陷阱裡**最貴的一條**的一個特例。完整的規則是:
//
//  ㋐ **兩片蓋住同一塊地的地表,任何位移 MUST 兩邊同量。** 症狀:*下面那一片從馬路、緣石、
//     停在上面的車輪之間冒出來*。參考專案實測:兩片只差 65 mm、而起伏只套在其中一片上 ⇒
//     7,346 m² 冒出來、最壞 1.68 m。本專案的對應保證是「**同一份場餵給每一層**」:
//     `SAG`(底毯 / 外溢 / 脊帶 / 界線 / 特徵五層共用 `groundSagAt` 一份)⇒ lift 階梯整條平移、
//     層與層的先後一格未動。⇒ **加第六層地被時 MUST 吃同一份場**;自己算一份「差不多的抬升」
//     就是這一條的重演,而本支只會告訴你「某一層破圖率變高了」,不會告訴你為什麼。
//  ㋑ **抬過頭與抬不夠是同一條規則的兩端。** 沉下去是破圖、浮起來也是破圖(草皮蓋過馬路)。
//     `SAG` 因此有三個上限(道路走廊 `ROAD` 0.10 < 路面 lift 0.18 − 底毯 0.07 的餘裕、
//     圖內 `MAX` 0.6、緩衝空間 `BUF` 放寬)。本支只量**沉**那一半 ——「浮起來」目前
//     **沒有任何離線稽核在看**,它的驗收面是定場照(㋓)與真機(㋕)。
//  ㋒ **「網格取樣一條曲線」的弦虧損是可以算的**:凸曲線上的弦跑在曲線**上方** `f''h²/8`
//     (參考專案:2 m 列距上是 9 mm)。本專案的 `SAG` 走的正是這條 —— 逐頂點往八方量
//     「中點高 − 兩端平均」取最大,而且**平面恆 0**(⇒ 平地與緩坡逐位元同舊制,
//     shibuya / blackforest 實測 0.0~0.2%)。看到平地也被抬起來 = 公式寫反了。
//  ㋓ **共面是解法不是問題。** 2026-08-13 起圖內三層改成**認養地形三角形**(`emitCell`)⇒
//     皮的三角形 === 地形的三角形 ⇒ 破圖恆 0,而穿出量 p99 **恰等於各自的 lift**
//     —— 那個數字就是共面的指紋。⚠ 共面在**同一個高度**上會退化成硬幣拋(渲染器每個機位
//     挑一個贏,而 symptom 是「鋪面在兩個色調之間閃」)—— 這裡不會,因為 lift 階梯讓每一層
//     差開了一小段;維持那個階梯是這條紀律的全部本錢。
import fs from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromiumOrNull, chromePath, serve, skipNoPlaywright } from './pw.mjs';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const arg = (k, d) => { const i = process.argv.indexOf(k); return i >= 0 ? process.argv[i + 1] : d; };
const VENUE = arg('--venue', 'taroko');
const TEAM = +arg('--team', '1');
const PORT = +arg('--port', '8636');
const LIVE = process.argv.includes('--live');
/** 反向驗證:`?sag=0` 把貼合抬升整層關掉 ⇒ 圖內三層 MUST 全紅(關掉還全綠 = 這支沒在守) */
const BREAK_SAG = process.argv.includes('--break-sag');
// 門檻(2026-08-13 taroko 實測定案):抬升前 底毯 22.0% / p99 0.446m ⇒ 兩項都紅;
// 抬升後 3.8% / 0.117m。留的餘裕吃得下不同場地的地形粗糙度差異。
const GATE = { badPct: 8, p99: 0.20 };

const chromium = await chromiumOrNull();
if (!chromium) skipNoPlaywright('地被貼合');

const THREE_CDN = 'https://unpkg.com/three@0.160.0/build/three.module.js';
const threeLocal = [process.env.THREE_DIR, join(ROOT, 'node_modules', 'three')]
  .filter(Boolean).find((d) => fs.existsSync(join(d, 'build', 'three.module.js')));

const srv = await serve(PORT);
const browser = await chromium.launch({
  executablePath: chromePath(),
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox'],
});
const page = await browser.newPage({ viewport: { width: 320, height: 240 } });
page.on('pageerror', (e) => console.log('  [pageerror]', e.message.slice(0, 300)));
if (threeLocal) {
  await page.route('**/three@0.160.0/build/three.module.js',
    (r) => r.fulfill({ status: 200, contentType: 'text/javascript', body: fs.readFileSync(join(threeLocal, 'build', 'three.module.js'), 'utf8') }));
  await page.route('**/three@0.160.0/examples/jsm/**', (r) => {
    const rel = r.request().url().split('/examples/jsm/')[1].split('?')[0];
    const f = join(threeLocal, 'examples', 'jsm', rel);
    return fs.existsSync(f)
      ? r.fulfill({ status: 200, contentType: 'text/javascript', body: fs.readFileSync(f, 'utf8') })
      : r.abort();
  });
}
const relay = async (route, contentType) => {
  for (let i = 0; i < 3; i++) {
    try {
      const r = await fetch(route.request().url());
      if (!r.ok) continue;
      return route.fulfill({ status: 200, contentType, body: Buffer.from(await r.arrayBuffer()),
        headers: { 'access-control-allow-origin': '*' } });
    } catch { /* 再試 */ }
  }
  route.abort();
};
await page.route(/elevation-tiles-prod/, (r) => relay(r, 'image/png'));
await page.route(/arcgisonline\.com/, (r) => relay(r, 'image/jpeg'));
if (!LIVE) {
  const osm = (route) => route.fulfill({ status: 200, contentType: 'application/json', body: '{"elements":[]}' });
  await page.route('**/overpass**', osm);
  await page.route('**/api/interpreter**', osm);
}
const PROBE = `${srv.url}public/__drape_probe.html`;
await page.route(`${PROBE}**`, (r) => r.fulfill({
  status: 200, contentType: 'text/html; charset=utf-8',
  body: `<!DOCTYPE html><html><head><meta charset="utf-8">
<script type="importmap">{"imports":{"three":"${THREE_CDN}","three/addons/":"https://unpkg.com/three@0.160.0/examples/jsm/"}}</script>
</head><body><canvas id="c" width="320" height="240"></canvas></body></html>`,
}));
await page.goto(BREAK_SAG ? `${PROBE}?sag=0` : PROBE, { waitUntil: 'domcontentloaded' });

const res = await page.evaluate(async ({ venueId, teamSize }) => {
  const { VENUES, venueConfig } = await import('/public/js/venues.js');
  const { buildTerrain } = await import('/public/js/terrain.js');
  const { buildBiomes } = await import('/public/js/biomes.js');
  const venue = VENUES.find((v) => v.id === venueId);
  const cfg = venueConfig(venue, teamSize);
  cfg.env = { season: 'summer', time: 'day', weather: 'clear' };
  const terrain = await buildTerrain(cfg, () => {});
  const _t0 = performance.now();
  const bio = await buildBiomes(cfg, terrain, () => {});
  const buildMs = performance.now() - _t0;
  // 參考高度 MUST 與皮自己吃的那一支一致:圖內 `heightAt`、緩衝空間 `bufferHeightAt`
  // (拿 heightAt 去量界外會被夾回圖界 ⇒ 量出上百公尺的假穿出,而那一批全是 0° 平地)。
  const IN = (x, z) => x >= terrain.minX && x <= terrain.maxX && z >= terrain.minZ && z <= terrain.maxZ;
  const H = (x, z) => (IN(x, z) ? terrain.heightAt(x, z)
    : (terrain.bufferHeightAt ? terrain.bufferHeightAt(x, z) : terrain.heightAt(x, z)));
  const g = terrain.gridM || 8;

  // 坡度(裸地形,與 SLOPE 那一族同一種量法:中央差分)
  const slopeDeg = (x, z) => {
    const dx = (H(x + g, z) - H(x - g, z)) / (2 * g), dz = (H(x, z + g) - H(x, z - g)) / (2 * g);
    return Math.atan(Math.hypot(dx, dz)) * 180 / Math.PI;
  };
  // 三角形內的取樣點(重心座標;含三條邊的中點與形心 —— 弦的最大偏差就在那裡)
  const BARY = [];
  { const n = 6;
    for (let a = 0; a <= n; a++) for (let b = 0; a + b <= n; b++) BARY.push([a / n, b / n, 1 - a / n - b / n]); }

  const layers = new Map();   // 層 → 統計
  const bucket = () => ({ pen: [], area: 0, bad: 0, tot: 0, worst: 0, worstAt: null, slopeBad: [], slopeAll: [] });
  bio.traverse((o) => {
    if (!o.isMesh || !o.geometry?.attributes?.position) return;
    const ud = o.userData || {};
    // 立體脊(界線拼圖的 ridge 種類)**底部刻意埋進地表 0.12m** ⇒ 它的裙一定「被戳穿」,
    // 那是構造不是缺陷。它與貼地帶共用 glayer='border',差別在有沒有 uv(bkOf 的第三參數)。
    let lay = ud.glayer || (ud.gsub != null ? 'patch' : null);
    if (lay === 'border' && !o.geometry.attributes.uv) lay = 'border脊(刻意埋入)';
    if (!lay) return;
    const b = layers.get(lay) || layers.set(lay, bucket()).get(lay);
    const bOut = layers.get(`${lay}~界外`) || layers.set(`${lay}~界外`, bucket()).get(`${lay}~界外`);
    const pos = o.geometry.attributes.position, idx = o.geometry.index;
    const nTri = idx ? idx.count / 3 : pos.count / 3;
    for (let t = 0; t < nTri; t++) {
      const i0 = idx ? idx.getX(t * 3) : t * 3, i1 = idx ? idx.getX(t * 3 + 1) : t * 3 + 1,
        i2 = idx ? idx.getX(t * 3 + 2) : t * 3 + 2;
      const P = [[pos.getX(i0), pos.getY(i0), pos.getZ(i0)],
        [pos.getX(i1), pos.getY(i1), pos.getZ(i1)],
        [pos.getX(i2), pos.getY(i2), pos.getZ(i2)]];
      let worst = -1e9, wx = 0, wz = 0;
      for (const [u, v, w] of BARY) {
        const x = P[0][0] * u + P[1][0] * v + P[2][0] * w;
        const y = P[0][1] * u + P[1][1] * v + P[2][1] * w;
        const z = P[0][2] * u + P[1][2] * v + P[2][2] * w;
        const d = H(x, z) - y;
        if (d > worst) { worst = d; wx = x; wz = z; }
      }
      const bb = IN((P[0][0] + P[1][0] + P[2][0]) / 3, (P[0][2] + P[1][2] + P[2][2]) / 3) ? b : bOut;
      bb.tot++;
      const s = slopeDeg((P[0][0] + P[1][0] + P[2][0]) / 3, (P[0][2] + P[1][2] + P[2][2]) / 3);
      bb.slopeAll.push(s);
      bb.pen.push(worst);
      if (worst > 0) { bb.bad++; bb.slopeBad.push(s); }
      if (worst > bb.worst) { bb.worst = worst; bb.worstAt = [Math.round(wx), Math.round(wz), Math.round(s)]; }
    }
  });
  const q = (a, p) => { if (!a.length) return 0; const s = [...a].sort((x, y) => x - y); return s[Math.min(s.length - 1, Math.floor(s.length * p))]; };
  const out = {};
  for (const [k, b] of layers) {
    if (!b.tot) continue;
    out[k] = {
      tri: b.tot, badPct: b.tot ? b.bad / b.tot * 100 : 0,
      p50: q(b.pen, 0.5), p90: q(b.pen, 0.9), p99: q(b.pen, 0.99), max: b.worst, worstAt: b.worstAt,
      slopeAllMed: q(b.slopeAll, 0.5), slopeBadMed: q(b.slopeBad, 0.5),
      // 依坡度分桶的破圖率:「斜坡才破」要在這裡看得見
      byslope: [0, 5, 10, 20, 30, 45].map((lo, i, arr) => {
        const hi = arr[i + 1] ?? 999;
        let n = 0, bad = 0;
        for (let j = 0; j < b.tot; j++) if (b.slopeAll[j] >= lo && b.slopeAll[j] < hi) { n++; if (b.pen[j] > 0) bad++; }
        return { lo, hi, n, pct: n ? bad / n * 100 : 0 };
      }),
    };
  }
  return { out, buildMs, gridM: terrain.gridM, worldW: terrain.worldW, usedFallback: terrain.usedFallback };
}, { venueId: VENUE, teamSize: TEAM });

console.log(`== 地被貼合(${VENUE} / ${TEAM}v${TEAM})==`);
console.log(`buildBiomes ${res.buildMs?.toFixed(0)}ms・地形格距 ${res.gridM?.toFixed(2)}m・世界寬 ${res.worldW?.toFixed(0)}m${res.usedFallback ? '・⚠ 高程走 fallback' : ''}\n`);
for (const [k, s] of Object.entries(res.out)) {
  console.log(`${k}  三角 ${s.tri}  破圖 ${s.badPct.toFixed(1)}%  穿出量 p50 ${s.p50.toFixed(3)} / p90 ${s.p90.toFixed(3)} / p99 ${s.p99.toFixed(3)} / max ${s.max.toFixed(3)}m`
    + `  (最壞 @${s.worstAt?.slice(0, 2).join(',')} 坡 ${s.worstAt?.[2]}°)`);
  console.log(`    坡度分桶破圖率  ${s.byslope.map((b) => `${b.lo}-${b.hi === 999 ? '' : b.hi}°:${b.pct.toFixed(0)}%(${b.n})`).join('  ')}`);
}
await browser.close();
srv.close?.();

// ---- 判定 ----
// **只判圖內**:界外那一圈比對的是 `bufferHeightAt` 這個**函式**,而畫出來的是裙的
// 網格(逐段線性)—— 兩者本來就不是同一個面,拿它當門檻等於用錯尺量。那一圈的數字
// 照印(它確實比圖內差一個量級,是**另一件待辦**,不是這一輪的迴歸)。
// 立體脊**底部刻意埋進地表 0.12m**,同樣不判(它的裙被戳穿是構造)。
let fail = 0;
for (const [k, st] of Object.entries(res.out)) {
  if (k.includes('界外') || k.includes('脊')) continue;
  const bad = st.badPct > GATE.badPct || st.p99 > GATE.p99;
  if (bad) fail++;
  console.log(`  ${bad ? '✗' : '✓'} ${k}:破圖 ${st.badPct.toFixed(1)}% ≤ ${GATE.badPct}%、p99 ${st.p99.toFixed(3)} ≤ ${GATE.p99}m`);
}
console.log(`
${fail ? '❌' : '✅'} 圖內地被貼合:${fail ? `${fail} 層超標` : '全數通過'}`);
if (BREAK_SAG && !fail) {
  console.error('❌ 反向驗證失敗:`?sag=0` 關掉抬升卻全綠 —— 這支沒有真的在守');
  process.exit(1);
}
process.exit(fail && !BREAK_SAG ? 1 : 0);
