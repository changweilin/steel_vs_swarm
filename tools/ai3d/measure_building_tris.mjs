#!/usr/bin/env node
/**
 * families.building 三角形預算量測(tri_budget.json 的量測來源;§2.1-6:預算由量測推導,
 * MUST NOT 手寫好看數字)。
 *
 * 量什麼:建物屋頂/立面配件桶(chimneys / roofTanks / roofBoxes / roofGables / roofPrisms /
 * cornices / roofPanels / cellMasts / antennas …)在**真場景**裡的 instance 數與現行單件
 * 三角形數,加上整張圖的三角形總量 —— 這一族與 rock/tree 的關鍵差別是 **InstancedMesh**:
 * 一顆節點幾何被全桶共用,GPU 成本 = 節點 tris × instance 數,「單件上限」必須由
 * instance 數反推,逐件看毫無意義(500 tris 的煙囪 × 300 座 = 15 萬 tris)。
 *
 * 量法(與 tree 族同律):playwright 頁內執行 **真品** buildTerrain + buildBiomes + 真 three,
 * 逐 InstancedMesh 以(幾何型別, 幾何參數, 材質色)指紋對回 biomes.js 的桶名。
 * `--live` 吃真 Overpass 圖資(instance 數要真市區才有代表性);圖磚由 Node 轉送。
 *
 * 用法:node tools/ai3d/measure_building_tris.mjs --venue shibuya [--team 1] [--live]
 */
import fs from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromiumOrNull, chromePath, serve, skipNoPlaywright } from '../pw.mjs';

const ROOT = dirname(dirname(dirname(fileURLToPath(import.meta.url))));
const arg = (k, d) => { const i = process.argv.indexOf(k); return i >= 0 ? process.argv[i + 1] : d; };
const VENUE = arg('--venue', 'shibuya');
const TEAM = +arg('--team', '1');
const LIVE = process.argv.includes('--live');
const PORT = +arg('--port', 8641);

const chromium = await chromiumOrNull();
if (!chromium) skipNoPlaywright('建築三角形預算量測');

const srv = await serve(PORT);
const browser = await chromium.launch({
  executablePath: chromePath(),
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox'],
});
const page = await browser.newPage({ viewport: { width: 640, height: 360 } });
page.on('pageerror', (e) => console.log('  [pageerror]', e.message.slice(0, 300)));

const THREE_CDN = 'https://unpkg.com/three@0.160.0/build/three.module.js';
const threeLocal = [process.env.THREE_DIR, join(ROOT, 'node_modules', 'three')]
  .filter(Boolean).find((d) => fs.existsSync(join(d, 'build', 'three.module.js')));
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
// 圖磚/圖資由 Node 轉送(同 shot_scene:瀏覽器直連在代理環境常被擋;Overpass 需 UA)
const relay = async (route, contentType) => {
  for (let i = 0; i < 3; i++) {
    try {
      const req = route.request();
      const r = await fetch(req.url(), req.method() === 'POST'
        ? { method: 'POST', body: req.postData(), headers: { 'User-Agent': 'steel-vs-swarm-tri-budget/1.0', 'Content-Type': 'application/x-www-form-urlencoded' } }
        : { headers: { 'User-Agent': 'steel-vs-swarm-tri-budget/1.0' } });
      if (!r.ok) continue;
      return route.fulfill({ status: 200, contentType, body: Buffer.from(await r.arrayBuffer()),
        headers: { 'access-control-allow-origin': '*' } });
    } catch { /* 再試 */ }
  }
  route.abort();
};
await page.route(/elevation-tiles-prod/, (r) => relay(r, 'image/png'));
await page.route(/arcgisonline\.com/, (r) => relay(r, 'image/jpeg'));
if (LIVE) {
  await page.route(/overpass|api\/interpreter/, (r) => relay(r, 'application/json'));
} else {
  const osm = (route) => route.fulfill({ status: 200, contentType: 'application/json', body: '{"elements":[]}' });
  await page.route('**/overpass**', osm);
  await page.route('**/api/interpreter**', osm);
}

const PROBE_URL = `${srv.url}public/__tri_probe.html`;
await page.route(PROBE_URL, (r) => r.fulfill({
  status: 200, contentType: 'text/html; charset=utf-8',
  body: `<!DOCTYPE html><html><head><meta charset="utf-8">
<script type="importmap">{"imports":{"three":"${THREE_CDN}","three/addons/":"https://unpkg.com/three@0.160.0/examples/jsm/"}}</script>
</head><body><canvas id="c" width="640" height="360"></canvas></body></html>`,
}));
await page.goto(PROBE_URL, { waitUntil: 'domcontentloaded' });

const res = await page.evaluate(async ({ venueId, teamSize }) => {
  const { VENUES, venueConfig } = await import('/public/js/venues.js');
  const { buildTerrain } = await import('/public/js/terrain.js');
  const { buildBiomes } = await import('/public/js/biomes.js');
  const venue = VENUES.find((v) => v.id === venueId);
  if (!venue) throw new Error(`找不到場地 ${venueId}`);
  const cfg = venueConfig(venue, teamSize);
  cfg.env = { season: 'summer', time: 'day', weather: 'clear' };
  const terrain = await buildTerrain(cfg, () => {});
  const bio = await buildBiomes(cfg, terrain, () => {});

  const tri = (g) => Math.round(((g.index ? g.index.count : g.attributes.position?.count) || 0) / 3);
  const rows = [];
  let sceneTris = 0, meshN = 0;
  const walk = (root) => root.traverse((o) => {
    if (!o.isMesh && !o.isInstancedMesh) return;
    meshN++;
    const t = tri(o.geometry);
    const n = o.isInstancedMesh ? o.count : 1;
    sceneTris += t * n;
    if (!o.isInstancedMesh) return;
    const mat = Array.isArray(o.material) ? o.material : [o.material];
    rows.push({
      geo: o.geometry.type,
      params: JSON.stringify(o.geometry.parameters || null),
      colors: mat.map((m) => (m.color ? m.color.getHexString() : '?')),
      matN: mat.length,
      count: n,
      tris: t,
    });
  });
  walk(bio); walk(terrain.group);
  return { rows, sceneTris, meshN, osmOk: !!bio.userData?.osmOk, stats: bio.userData?.stats || null };
}, { venueId: VENUE, teamSize: TEAM });

// —— 指紋 → biomes.js 桶名(對照 biomes.js 建物配件 InstancedMesh 建構段;色值一改要跟著改)——
const BUCKETS = [
  { name: 'facade_wall(建物主體)', geo: 'BoxGeometry', matN: 6 },
  { name: 'chimneys', geo: 'BoxGeometry', color: '9a5a44' },
  { name: 'roofBoxes(空調/機房)', geo: 'BoxGeometry', color: '8a9096' },
  { name: 'roofTanks(圓筒水塔)', geo: 'CylinderGeometry', color: 'b0b8be' },
  { name: 'cornices(簷口帶)', geo: 'BoxGeometry', color: 'ffffff' },
  { name: 'roofGables(四坡錐頂)', geo: 'ConeGeometry', color: 'ffffff' },
  { name: 'roofPrisms(人字屋頂)', geo: 'BufferGeometry', color: 'ffffff' },
  { name: 'roofPanels(光電板)', geo: 'BoxGeometry', color: '27435f' },
  { name: 'roofPads(屋頂綠地墊)', geo: 'BoxGeometry', color: '4f7a3c' },
  { name: 'roofBushes(屋頂灌木)', geo: 'IcosahedronGeometry', color: '4f8a44', pr: 0.8 },
  { name: 'roofTree 盆', geo: 'CylinderGeometry', color: '8a6a52' },
  { name: 'roofTree 幹', geo: 'CylinderGeometry', color: '6b4a30' },
  { name: 'roofTree 冠', geo: 'IcosahedronGeometry', color: '4f8a44', pr: 1.1 },
  { name: 'cellMasts(基地台桅)', geo: 'CylinderGeometry', color: 'c4ccd2', prTop: 0.09 },
  { name: 'antennas(高樓天線)', geo: 'CylinderGeometry', color: 'c4ccd2', prTop: 0.12 },
  { name: 'cellPanels(扇區天線)', geo: 'BoxGeometry', color: 'dfe4e8' },
];
const label = (r) => {
  const p = r.params ? JSON.parse(r.params) : null;
  for (const b of BUCKETS) {
    if (r.geo !== b.geo) continue;
    if (b.matN && r.matN !== b.matN) continue;
    if (b.color && r.colors[0] !== b.color) continue;
    if (b.pr != null && Math.abs((p?.radius ?? -1) - b.pr) > 1e-6) continue;
    if (b.prTop != null && Math.abs((p?.radiusTop ?? -1) - b.prTop) > 1e-6) continue;
    if (b.matN && r.matN !== b.matN) continue;
    return b.name;
  }
  return null;
};

const byBucket = new Map();
for (const r of res.rows) {
  const n = label(r);
  if (!n) continue;
  const cur = byBucket.get(n) || { count: 0, tris: r.tris, draws: 0 };
  cur.count += r.count; cur.draws += 1;
  cur.tris = r.tris;
  byBucket.set(n, cur);
}
console.log(`場地 ${VENUE} 隊制 ${TEAM}${LIVE ? '(真圖資)' : '(離線 fallback)'}`);
console.log(`全場三角形 ${res.sceneTris.toLocaleString()}・mesh ${res.meshN}`);
console.log('桶名                          instance   單件tris   桶總tris');
let bldTris = 0;
for (const [n, c] of [...byBucket.entries()].sort((a, b) => b[1].count * b[1].tris - a[1].count * a[1].tris)) {
  console.log(`  ${n.padEnd(26)} ${String(c.count).padStart(8)} ${String(c.tris).padStart(9)} ${String(c.count * c.tris).padStart(10)}`);
  bldTris += c.count * c.tris;
}
console.log(`建物相關桶合計 ${bldTris.toLocaleString()} tris(佔全場 ${(bldTris / res.sceneTris * 100).toFixed(1)}%)`);
const unmatched = res.rows.filter((r) => !label(r));
console.log(`未對應 InstancedMesh ${unmatched.length} 筆(植被/道路/其他系統,不在建物預算內)`);
fs.mkdirSync(join(ROOT, 'tools', 'ai3d', '.tri_measure'), { recursive: true });
fs.writeFileSync(join(ROOT, 'tools', 'ai3d', '.tri_measure', `${VENUE}_t${TEAM}${LIVE ? '_live' : ''}.json`),
  JSON.stringify({ venue: VENUE, team: TEAM, live: LIVE, sceneTris: res.sceneTris,
    buckets: Object.fromEntries(byBucket), measured_at: new Date().toISOString() }, null, 2));
await browser.close();
srv.close();
