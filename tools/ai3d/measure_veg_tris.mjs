#!/usr/bin/env node
/**
 * families.veg 三角形預算量測(tri_budget.json 的量測來源;§2.1-6:預算由量測推導,
 * MUST NOT 手寫好看數字)。
 *
 * 量什麼:**一般植被**(biomes.js VEG_DEFS)在真場景裡的逐型 instance 數與現行單件三角形數,
 * 加上整張圖的三角形總量。與 tree 族(GIANT_DEFS 神木)的關鍵差別是**數量級**:
 * 神木一張圖幾十株、一般植被上萬株,而兩者都是 InstancedMesh ⇒ GPU 成本 = 節點 tris ×
 * instance 數。故 veg 族沿用 **building 族那條逐桶反推**的規則(不是 tree 族的「單件 ≤ 最重整株」):
 *
 *     node_cap(型) = (whole_factor − 1) × 植被總量上界 ÷ 名冊列數 ÷ 該型實測最大 instance 數
 *
 * ⇒ 名冊全數換滿的最壞情況,植被總量 ≤ whole_factor × 現值(與 building node_caps、
 * megalith whole_factor、tree kind_factor 同一條「整件閘」規則)。
 *
 * 量法(與 building 族同律):playwright 頁內執行 **真品** buildTerrain + buildBiomes + 真 three,
 * 逐 InstancedMesh 對回 VEG_DEFS 的(型, 零件序)。**指紋表推導不手寫**(這是與
 * measure_building_tris 的唯一方法差異,也是它下一輪該學的):零件描述子直接取自
 * `parts_src.bioLibDescs().VEG_DEFS` —— 手寫一張桶表的話,改一顆 ico 半徑就對不回來,
 * 而對不回來只表現成「這一型不在預算內」,沒有錯誤訊息。
 *
 * 指紋 = 幾何參數 **+ 材質色**,而且兩者都由頁內呼叫**真品 `buildVegMeshes`** 取得
 * (逐型建一株樣本、讀它的 geometry.parameters 與 material.color)—— 光靠幾何參數碰撞是常態
 * (shrub 與 conifer2 都有 ico(0.9)、broadleaf 與 borderrock 都有 ico(1.7)),而碰撞會把兩型的
 * instance 數**互相灌到對方頭上**:實測過的錯帳是 shrub 與 conifer2 同時報 2044,加總起來
 * 比整層植被的三角形總量還多。季節色是 `seasonColor` 算出來的,在這裡**照 Node 端抄一份
 * 色表就是第二份實作** ⇒ 一律問真品。真正無解的碰撞(birch/mangrove 的 ico(2.0) 同色)
 * 才整群加總,偏差方向朝「instance 算多」= 上限算小(原則 6:鬆掉的閘門不報錯)。
 *
 * ⚠ 綠地場地才有代表性(市區的植被 instance 數不是上界);`--live` 吃真 Overpass 圖資。
 *
 * `--giants`:改量 **families.tree 的 `kind_tris`**(11 種神木逐株零件三角形加總)。同一支工具是因為
 * 兩者的量法逐字相同(頁內執行真品 `buildVegMeshes` + 真 three),差別只有「量哪一張表」與
 * 「要不要建整個場景」。**MUST NOT `loadPartLibs()`**:`kind_tris` 的語意是「該株**現值**」=
 * 保險絲那一版,載了零件庫量到的是換完之後的值,閘門會拿自己的產出當基準(恆綠 = 沒有閘門)。
 * §5g 那一輪這一步是臨時腳本,而 tri_budget 的 staleness 明寫「改 GIANT_DEFS 任一零件表 MUST 重量」
 * ⇒ 第二次要用就升格成工具(同 mesh_sheet/photo_sheet 的來歷)。
 *
 * 用法:node tools/ai3d/measure_veg_tris.mjs --venue aokigahara --team 3 [--live]
 *      node tools/ai3d/measure_veg_tris.mjs --giants
 */
import fs from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromiumOrNull, chromePath, serve, skipNoPlaywright } from '../pw.mjs';
import { bioLibDescs } from './parts_src.mjs';

const ROOT = dirname(dirname(dirname(fileURLToPath(import.meta.url))));
const arg = (k, d) => { const i = process.argv.indexOf(k); return i >= 0 ? process.argv[i + 1] : d; };
const VENUE = arg('--venue', 'aokigahara');
const TEAM = +arg('--team', '3');
const LIVE = process.argv.includes('--live');
const PORT = +arg('--port', 8643);

// 型別名冊由真品原文推導(名字而已;指紋本身在頁內問真品 buildVegMeshes)
const { VEG_DEFS } = bioLibDescs();
const VEG_TYPES = Object.keys(VEG_DEFS);

const chromium = await chromiumOrNull();
if (!chromium) skipNoPlaywright('一般植被三角形預算量測');

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

const PROBE_URL = `${srv.url}public/__veg_probe.html`;
await page.route(PROBE_URL, (r) => r.fulfill({
  status: 200, contentType: 'text/html; charset=utf-8',
  body: `<!DOCTYPE html><html><head><meta charset="utf-8">
<script type="importmap">{"imports":{"three":"${THREE_CDN}","three/addons/":"https://unpkg.com/three@0.160.0/examples/jsm/"}}</script>
</head><body><canvas id="c" width="640" height="360"></canvas></body></html>`,
}));
await page.goto(PROBE_URL, { waitUntil: 'domcontentloaded' });

if (process.argv.includes('--giants')) {
  const kinds = Object.keys(bioLibDescs().GIANT_DEFS);
  const out = await page.evaluate(async (ks) => {
    const { buildVegMeshes } = await import('/public/js/biomes.js');   // 刻意不 loadPartLibs:量的是保險絲現值
    const one = [{ x: 0, y: 0, z: 0, s: 1, ry: 0 }];
    const r = {};
    for (const k of ks) {
      r[k] = buildVegMeshes(k, one, 'summer').reduce((t, m) => t
        + Math.round(((m.geometry.index ? m.geometry.index.count : m.geometry.attributes.position.count) || 0) / 3), 0);
    }
    return r;
  }, kinds);
  const sorted = Object.fromEntries(Object.entries(out).sort((a, b) => b[1] - a[1]));
  console.log('families.tree kind_tris(逐株零件三角形加總;保險絲路徑):');
  for (const [k, v] of Object.entries(sorted)) console.log(`  ${k.padEnd(10)} ${v}`);
  console.log(`measured_max_tris = ${Math.max(...Object.values(out))}`);
  console.log(JSON.stringify(sorted));
  await browser.close(); srv.close();
  process.exit(0);
}

const res = await page.evaluate(async ({ venueId, teamSize, vegTypes }) => {
  const { VENUES, venueConfig } = await import('/public/js/venues.js');
  const { buildTerrain } = await import('/public/js/terrain.js');
  const { buildBiomes, buildVegMeshes } = await import('/public/js/biomes.js');
  const venue = VENUES.find((v) => v.id === venueId);
  if (!venue) throw new Error(`找不到場地 ${venueId}`);
  const cfg = venueConfig(venue, teamSize);
  cfg.env = { season: 'summer', time: 'day', weather: 'clear' };
  const terrain = await buildTerrain(cfg, () => {});
  const bio = await buildBiomes(cfg, terrain, () => {});

  const tri = (g) => Math.round(((g.index ? g.index.count : g.attributes.position?.count) || 0) / 3);
  // 指紋 = 幾何參數 + 材質色,兩者一律由**真品** buildVegMeshes 產生的那一顆 mesh 上量
  const sigOf = (o) => {
    const p = o.geometry.parameters || {};
    const g = o.geometry.type === 'IcosahedronGeometry' ? `ico|${p.radius}`
      : o.geometry.type === 'CylinderGeometry' ? `cyl|${p.radiusTop}|${p.radiusBottom}|${p.height}|${p.radialSegments}`
        : o.geometry.type === 'ConeGeometry' ? `cone|${p.radius}|${p.height}|${p.radialSegments}` : `${o.geometry.type}|?`;
    const m = Array.isArray(o.material) ? o.material[0] : o.material;
    return `${g}#${m?.color ? m.color.getHexString() : '?'}`;
  };
  const ref = {};                                   // 指紋 → [{ type, index }]
  const one = [{ x: 0, y: 0, z: 0, s: 1, ry: 0 }];
  for (const type of vegTypes) {
    buildVegMeshes(type, one, cfg.env.season).forEach((m, index) => {
      (ref[sigOf(m)] ||= []).push({ type, index });
    });
  }

  const rows = [];
  let sceneTris = 0, meshN = 0;
  const walk = (root) => root.traverse((o) => {
    if (!o.isMesh && !o.isInstancedMesh) return;
    meshN++;
    const t = tri(o.geometry);
    const n = o.isInstancedMesh ? o.count : 1;
    sceneTris += t * n;
    if (o.isInstancedMesh) rows.push({ sig: sigOf(o), count: n, tris: t });
  });
  walk(bio); walk(terrain.group);
  return { rows, ref, sceneTris, meshN, stats: bio.userData?.stats || null };
}, { venueId: VENUE, teamSize: TEAM, vegTypes: VEG_TYPES });

// —— 對回 VEG_DEFS(逐(型,零件序);真正無解的同色同參碰撞才整群加總)——
const byRow = new Map();         // `型#序` → { type, index, count, tris }
const ambiguous = new Set();
let vegTris = 0, matched = 0;
for (const r of res.rows) {
  const m = res.ref[r.sig];
  if (!m) continue;
  matched++;
  vegTris += r.count * r.tris;
  if (m.length > 1) ambiguous.add(r.sig);
  for (const { type, index } of m) {               // 碰撞群:同一筆 instance 數記給群裡每一列(偏緊)
    const k = `${type}#${index}`;
    const cur = byRow.get(k) || { type, index, count: 0, tris: r.tris };
    cur.count += r.count; cur.tris = Math.max(cur.tris, r.tris);
    byRow.set(k, cur);
  }
}
const byType = new Map();
for (const v of byRow.values()) {
  const cur = byType.get(v.type) || { count: 0, tris: 0, rows: 0 };
  cur.count = Math.max(cur.count, v.count); cur.tris = Math.max(cur.tris, v.tris); cur.rows++;
  byType.set(v.type, cur);
}

console.log(`場地 ${VENUE} 隊制 ${TEAM}${LIVE ? '(真圖資)' : '(離線 fallback)'}`);
console.log(`全場三角形 ${res.sceneTris.toLocaleString()}・mesh ${res.meshN}・散布植被 ${res.stats?.veg ?? '?'} 株`);
console.log('植被型                instance   零件列  最重零件tris');
for (const [t, c] of [...byType.entries()].sort((a, b) => b[1].count - a[1].count)) {
  console.log(`  ${t.padEnd(20)} ${String(c.count).padStart(8)} ${String(c.rows).padStart(7)} ${String(c.tris).padStart(13)}`);
}
console.log(`一般植被合計 ${vegTris.toLocaleString()} tris(佔全場 ${(vegTris / res.sceneTris * 100).toFixed(1)}%;對上 ${matched} 個 InstancedMesh)`);
if (ambiguous.size) console.log(`無解碰撞指紋 ${ambiguous.size} 組(同參數同色;instance 數記給群裡每一列 = 上限偏緊)`);

fs.mkdirSync(join(ROOT, 'tools', 'ai3d', '.tri_measure'), { recursive: true });
fs.writeFileSync(join(ROOT, 'tools', 'ai3d', '.tri_measure', `veg_${VENUE}_t${TEAM}${LIVE ? '_live' : ''}.json`),
  JSON.stringify({ venue: VENUE, team: TEAM, live: LIVE, sceneTris: res.sceneTris, vegTris,
    veg: res.stats?.veg ?? null, types: Object.fromEntries(byType),
    rows: Object.fromEntries([...byRow].map(([k, v]) => [k, { count: v.count, tris: v.tris }])),
    measured_at: new Date().toISOString() }, null, 2));
await browser.close();
srv.close();
