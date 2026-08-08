// ============ 固定機位定場鏡頭組(V-A;每次視覺改動的前後對照基準)============
// 為什麼要有這一支:既有五支 `shot_*.mjs` 都是**逐功能**的(機體 / 隧道 / 季節 / 巨物 / 鳥巢),
// 沒有任何一組「每個地點各一張、改動前後各拍一次」的定場照 ⇒ 只要回歸發生在**正在改的
// 那個功能之外**,就完全看不見。渲染管線一改(ramp / 天空 / 地形 / 勾線 / 調色 / 描邊)動到的
// 是**整個畫面**,沒有這組基準就等於沒有驗收。
//
// 機位是**推導的,不是手打座標**(手打的一改兵線就對不上,而且看不出來):
//   spawn      兩座主堡,朝兵線方向       first_tower  各兵線第一座塔位
//   lane_mid   各兵線中段                portal_a/b   第一座結構隧道的兩端洞口(有才拍)
//   bridge     第一座橋的橋頭(有才拍)   hilltop      全圖最高點俯瞰兵線
//   waterline  水岸(有水域才拍)         aerial       圖心高空俯瞰
//
// 圖層隔離:`--ink=0` / `--grade=0` / `--fxaa=0` / `--post=0` 各關一層,同一組機位再拍一次
// ⇒ 「這張圖變醜是哪一層造成的」變成可回答的問題,而不是憑印象猜。
//
// 前置與 shot_tunnels.mjs 完全相同(Playwright + terrarium 高程 + 合成圖資),
// **找不到 playwright 就印一行說明並以 0 結束**(A2:MUST NOT 寫進 package.json)。
// 用法:node tools/shot_scene.mjs [--venue taroko] [--team 1] [--out DIR] [--ink=0] [--lib=0] [--live]
import fs from 'node:fs';
import path from 'node:path';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromiumOrNull, chromePath, serve, skipNoPlaywright } from './pw.mjs';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const arg = (k, d) => { const i = process.argv.indexOf(k); return i >= 0 ? process.argv[i + 1] : d; };
const flag = (k) => !process.argv.includes(`--${k}=0`);   // ⚠ MUST 回**布林**:`Pipeline` 的判定是
// `opts.ink !== false`,而 `0 !== false` 為真 ⇒ 回 0/1 的話 `--ink=0`/`--grade=0`/`--fxaa=0`
// **全部是 no-op**(2026-08-08 §5z-t 實測:`--ink=0` 與預設的 PNG 逐位元相同,而那不是
// 「勾線沒作用」,是**旗標沒作用**)。`post` 之所以看起來正常,只因為它在本檔內另被當
// truthy 用(`layers.post ? new Pipeline(...) : null`)—— 一個旗標兩套解讀,壞掉的那半沒人發現。
const has = (k) => process.argv.includes(k);
const VENUE = arg('--venue', 'taroko');
const TEAM = +arg('--team', '1');
const OUT = path.resolve(arg('--out', join(ROOT, 'tools', `.shots_scene/${VENUE}`)));
const LIVE = has('--live');
// `--stations <meta.json>`:**照抄前一輪推導出來的機位**再拍一次。
// 為什麼需要:機位是由**世界幾何**推導的(離兵線最近的那株喬木、最高點、第一座橋…),
// 而 `--lib=0` 換掉的正是那些幾何 ⇒ 前後兩張其實**站在不同的地方、拍不同的樹**
// (blackforest 實測 veg_near 的 z 從 185 跑到 239)。這一支的賣點是「改動前後各拍一次」,
// 那個賣點對 `--lib` 直接不成立。回放不是手打座標(座標仍來自某一輪的推導),
// 只是把「哪一輪」講清楚 —— 而 meta 本來就已經把機位寫進去了。
const STATIONS = arg('--stations', '');
const REPLAY = STATIONS ? JSON.parse(fs.readFileSync(STATIONS, 'utf8')).stations : null;
const PORT = +arg('--port', 8632);
const LAYERS = { ink: flag('ink'), grade: flag('grade'), fxaa: flag('fxaa'), post: flag('post'), lib: flag('lib') };
const SUFFIX = Object.entries(LAYERS).filter(([, v]) => !v).map(([k]) => `_no-${k}`).join('');

const chromium = await chromiumOrNull();
if (!chromium) skipNoPlaywright('定場鏡頭組');
fs.mkdirSync(OUT, { recursive: true });

const THREE_CDN = 'https://unpkg.com/three@0.160.0/build/three.module.js';
const threeLocal = [process.env.THREE_DIR, join(ROOT, 'node_modules', 'three')]
  .filter(Boolean).find((d) => fs.existsSync(join(d, 'build', 'three.module.js')));

const srv = await serve(PORT);
const browser = await chromium.launch({
  executablePath: chromePath(),
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox'],
});
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
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
// 圖磚一律由 Node 轉送(瀏覽器直連在沙箱/代理環境常被擋)
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
  // 圖資取不到就走引擎自己的程序生成 fallback(§2.4);那一份是**確定性**的 ⇒ 定場照可重現
  const osm = (route) => route.fulfill({ status: 200, contentType: 'application/json', body: '{"elements":[]}' });
  await page.route('**/overpass**', osm);
  await page.route('**/api/interpreter**', osm);
}

const PROBE_URL = `${srv.url}public/__scene_probe.html`;
await page.route(PROBE_URL, (r) => r.fulfill({
  status: 200, contentType: 'text/html; charset=utf-8',
  body: `<!DOCTYPE html><html><head><meta charset="utf-8">
<script type="importmap">{"imports":{"three":"${THREE_CDN}","three/addons/":"https://unpkg.com/three@0.160.0/examples/jsm/"}}</script>
<style>html,body{margin:0;background:#000}canvas{display:block}</style></head>
<body><canvas id="c" width="1280" height="720"></canvas></body></html>`,
}));
await page.goto(PROBE_URL, { waitUntil: 'domcontentloaded' });

const shots = await page.evaluate(async ({ venueId, teamSize, layers, replay }) => {
  const THREE = await import('three');
  const { VENUES, venueConfig } = await import('/public/js/venues.js');
  const { buildTerrain } = await import('/public/js/terrain.js');
  const { buildBiomes } = await import('/public/js/biomes.js');
  const { applyEnvironment } = await import('/public/js/environment.js');
  const { Pipeline } = await import('/public/js/postfx.js');
  const { updateCelLight } = await import('/public/js/toon.js');
  const { SOLDIER_H, WATER, solveTowerSites, MAPGEO } = await import('/public/js/data.js');

  const venue = VENUES.find((v) => v.id === venueId);
  if (!venue) throw new Error(`找不到場地 ${venueId}`);
  const cfg = venueConfig(venue, teamSize);
  cfg.env = { season: 'summer', time: 'day', weather: 'clear' };

  // ⚠ **零件庫 MUST 在 buildBiomes 之前載入**(2026-08-08 §5z-t):這一支跑的是真的賽璐璐 +
  // 勾線管線,但在此之前它從來沒有載過零件庫 ⇒ 每一張定場圖畫的都是**保險絲**那棵樹,
  // 而檔案裡的樹早就換成庫節點了。症狀是**完全看不出來**:圖照樣出、地物數照樣印、
  // 顏色與勾線也都對 —— 只是那不是玩家會看到的世界(§5z-o 對 `shot_giants` 記過同一條)。
  // 這正是「勾線對新冠形是加分還是扣分」那一項卡了三輪沒答案的原因:
  // `shot_veg` 載庫但**沒有管線**(黏土)、`shot_scene` 有管線但**不載庫** —— 兩邊各缺一半。
  // `--lib=0` 保留舊行為當**前後對照的「前」**(保險絲路徑),而不是預設。
  let libN = 0;
  if (layers.lib) {
    const { loadPartLibs, libGeo } = await import('/public/js/partlib.js');
    await loadPartLibs();
    // 載到幾顆 MUST 印出來:載入失敗時 `libGeo` 一律回 null、消費端**逐位元**退回保險絲,
    // 而那與「根本沒載庫」畫出來的圖一模一樣 —— 沒有這個讀數就分不出這兩件事。
    libN = ['tree/cf2_crown_a', 'tree/cf2_wood_a', 'tree/bl_crown_a', 'tree/bl_wood_a',
            'tree/snag_a', 'tree/bush_a09'].filter((n) => libGeo(n)).length;
  }

  const terrain = await buildTerrain(cfg, () => {});
  // buildBiomes 回傳的是 **group 本身**,結構清單住 group.userData(main.js 的 `ud` 就是它)
  let bio = null, biomeErr = null;
  try { bio = await buildBiomes(cfg, terrain, () => {}); } catch (e) { biomeErr = String(e && e.message || e); }
  const ud = bio?.userData || {};
  // 地物數量進 meta:圖資取不到時 biomes 走程序生成 fallback,數量會掉 —— 那不是渲染回歸,
  // 但**看起來一模一樣**(空曠的山谷),所以一律印出來,免得拿兩張不同世界的圖在比顏色。
  let objN = 0;
  if (bio) bio.traverse((o) => { if (o.isMesh || o.isInstancedMesh) objN++; });
  const scene = new THREE.Scene();
  scene.add(terrain.group);
  if (bio) scene.add(bio);
  const envFx = applyEnvironment(scene, terrain, cfg.env);

  const canvas = document.getElementById('c');
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: !layers.post });
  renderer.setPixelRatio(1);
  renderer.setSize(1280, 720, false);
  const camera = new THREE.PerspectiveCamera(68, 1280 / 720, 0.5,
    Math.max(terrain.worldW, terrain.worldH) * 2);
  scene.add(camera);
  const pipe = layers.post ? new Pipeline(renderer, scene, camera, layers) : null;

  // ---- 機位推導(零手打座標)----
  const R_EARTH = 6371000, d2r = (d) => d * Math.PI / 180, S = MAPGEO.REAL_SCALE;
  const toW = (lat, lng) => [
    (lng - cfg.center.lng) * Math.PI / 180 * R_EARTH * Math.cos(d2r(cfg.center.lat)) / S,
    -((lat - cfg.center.lat) * Math.PI / 180 * R_EARTH / S),
  ];
  const lanes = (cfg.lanes || []).map((l) => l.map(([a, b]) => toW(a, b)));
  const surf = (x, z) => terrain.heightAt(x, z);
  const EYE = SOLDIER_H * 1.1;
  const stations = [];
  const add = (name, p, look, up = EYE) => stations.push({ name, p: [p[0], surf(p[0], p[1]) + up, p[1]], look });

  for (const side of ['SWARM', 'STEEL']) {
    const b = toW(cfg.bases[side][0], cfg.bases[side][1]);
    const l0 = lanes[0] || [];
    const aim = l0.length ? l0[Math.floor(l0.length / 2)] : [0, 0];
    add(`spawn_${side}`, b, [aim[0], surf(aim[0], aim[1]) + EYE, aim[1]]);
  }
  const sites = solveTowerSites(lanes);
  sites.forEach((laneSites, li) => {
    const s0 = laneSites[0];
    if (s0?.SWARM) {
      const c = s0.SWARM, aim = [c.x + c.nx * 40, c.z + c.nz * 40];
      add(`first_tower_L${li + 1}`, [c.x - c.nx * 30, c.z - c.nz * 30], [aim[0], surf(aim[0], aim[1]) + EYE, aim[1]]);
    }
    const lane = lanes[li] || [];
    if (lane.length > 3) {
      const m = lane[Math.floor(lane.length / 2)], n = lane[Math.floor(lane.length / 2) + 1];
      add(`lane_mid_L${li + 1}`, m, [n[0], surf(n[0], n[1]) + EYE, n[1]]);
    }
  });
  // 結構:引擎已經把隧道/橋的實際幾何算好了,直接拿它自己的清單(MUST NOT 另解一次)
  const tuns = (ud.tunnels || []).filter((t) => !t.open);
  if (tuns.length) {
    const t = tuns[0], tl = tuns[tuns.length - 1];
    add('portal_a', [t.x1, t.z1], [t.x2, surf(t.x2, t.z2) + EYE, t.z2], 3);
    add('portal_b', [tl.x2, tl.z2], [tl.x1, surf(tl.x1, tl.z1) + EYE, tl.z1], 3);
  }
  const decks = ud.decks || [];
  if (decks.length) {
    const d = decks[0];
    stations.push({ name: 'bridge', p: [d.x1, surf(d.x1, d.z1) + EYE + 6, d.z1],
      look: [d.x2, surf(d.x2, d.z2) + EYE, d.z2] });
  }
  // **喬木近景**(2026-08-08 §5z-t):勾線是**螢幕空間**的 pass,門檻吃「離相機多遠 + 掠射角」,
  // 而且**背景是天空(深度 = far)的那一格會早退** ⇒ 一棵孤零零站在空背景前的樹**畫不出線**
  // (`shot_veg` 實測 `--ink=1` 與 `--ink=0` 的 PNG **逐位元相同**)。「勾線對這個冠形是加分
  // 還是扣分」因此**只能在有地形、有鄰木的場景裡**量 —— 而既有機位最近的樹也在 60~100m 外,
  // 一棵樹只有十幾個像素高。⇒ 補一個機位,**位置照樣是推導的**:取離兵線中段最近的那一株
  // 「高 ≥ 4m 的植被 instance」,取景比例與 `shot_veg` 同一組(距離 2.2×樹高、眼高 0.55×),
  // 兩支的圖才比得起來。認樹用**幾何包圍盒的高**,不比對列名 —— 名字會改,高度不會。
  {
    const cands = [];
    if (bio) bio.traverse((o) => {
      if (!o.isInstancedMesh || !o.geometry) return;
      o.geometry.computeBoundingBox();
      const bb = o.geometry.boundingBox;
      const h = (bb.max.y - bb.min.y) * (o.scale?.y || 1);
      if (h < 4) return;                                  // 灌木 / 草不算
      const m = new THREE.Matrix4(), v = new THREE.Vector3();
      for (let i = 0; i < o.count; i++) {
        o.getMatrixAt(i, m);
        v.setFromMatrixPosition(m).applyMatrix4(o.matrixWorld);
        cands.push([v.x, v.z, h]);
      }
    });
    const l0 = lanes[0] || [];
    const ref = l0.length ? l0[Math.floor(l0.length / 2)] : [0, 0];
    let best = null;
    for (const c of cands) {
      const d = (c[0] - ref[0]) ** 2 + (c[1] - ref[1]) ** 2;
      if (!best || d < best[0]) best = [d, c];
    }
    if (best) {
      const [tx, tz, th] = best[1];
      const dist = th * 2.2, base = surf(tx, tz);
      stations.push({
        name: 'veg_near',
        p: [tx + dist * 0.80, base + th * 0.55, tz + dist * 0.60],
        look: [tx, base + th * 0.45, tz],
      });
    }
  }
  // 全圖最高點俯瞰兵線(掃格,零亂數)
  {
    let best = null;
    for (let x = terrain.minX + 60; x < terrain.maxX - 60; x += 40) {
      for (let z = terrain.minZ + 60; z < terrain.maxZ - 60; z += 40) {
        const h = surf(x, z);
        if (!best || h > best[2]) best = [x, z, h];
      }
    }
    const l0 = lanes[0] || [];
    const aim = l0.length ? l0[Math.floor(l0.length / 2)] : [0, 0];
    add('hilltop', [best[0], best[1]], [aim[0], surf(aim[0], aim[1]), aim[1]]);
  }
  if (terrain.waterY != null) {   // 水岸:第一個「腳下乾、前方濕」的格點
    let found = null;
    for (let x = terrain.minX + 40; x < terrain.maxX - 40 && !found; x += 25) {
      for (let z = terrain.minZ + 40; z < terrain.maxZ - 40; z += 25) {
        if (surf(x, z) > WATER.LEVEL + 1 && surf(x + 25, z) < WATER.LEVEL) { found = [x, z]; break; }
      }
    }
    if (found) add('waterline', found, [found[0] + 120, WATER.LEVEL, found[1]]);
  }
  {   // 空拍:圖心正上方(相機直接定位,這一支不經過玩家狀態機)
    const span = Math.max(terrain.worldW, terrain.worldH);
    const cx = (terrain.minX + terrain.maxX) / 2, cz = (terrain.minZ + terrain.maxZ) / 2;
    stations.push({ name: 'aerial', p: [cx, surf(cx, cz) + span * 0.45, cz + span * 0.35], look: [cx, surf(cx, cz), cz] });
  }

  const out = [];
  // 回放 MUST 整組取代(不是補進去):混著用會拍出「一半新機位、一半舊機位」的圖組,
  // 而檔名一模一樣 ⇒ 之後沒有任何東西能分辨哪幾張可以比。
  const use = replay && replay.length ? replay : stations;
  for (const st of use) {
    camera.position.set(st.p[0], st.p[1], st.p[2]);
    camera.lookAt(st.look[0], st.look[1], st.look[2]);
    camera.updateMatrixWorld(true);
    envFx.update(0.016, camera);
    updateCelLight(camera);
    if (pipe) pipe.render(); else renderer.render(scene, camera);
    out.push({ name: st.name, png: canvas.toDataURL('image/png'),
      p: st.p.map((v) => Math.round(v)), look: st.look.map((v) => Math.round(v)) });
  }
  return { shots: out, tunnels: tuns.length, decks: decks.length, water: terrain.waterY != null, objN, libN, biomeErr, imagery: !!terrain.sampleColor };
}, { venueId: VENUE, teamSize: TEAM, layers: LAYERS, replay: REPLAY });

for (const s of shots.shots) {
  fs.writeFileSync(join(OUT, `${s.name}${SUFFIX}.png`), Buffer.from(s.png.split(',')[1], 'base64'));
  console.log(`  ${s.name}${SUFFIX}  eye=${s.p.join(',')}  →  ${s.look.join(',')}`);
}
if (shots.biomeErr) console.log(`  ⚠ buildBiomes 例外:${shots.biomeErr}`);
console.log(`  地物 mesh ${shots.objN}・零件庫節點 ${shots.libN}${LAYERS.lib ? '' : '(--lib=0 保險絲)'}・隧道 ${shots.tunnels}・橋 ${shots.decks}`
  + `・水域 ${shots.water ? '有' : '無'}・衛星影像 ${shots.imagery ? '有' : '無'}`);
fs.writeFileSync(join(OUT, `meta${SUFFIX}.json`), JSON.stringify({
  venue: VENUE, team: TEAM, layers: LAYERS,
  tunnels: shots.tunnels, decks: shots.decks, water: shots.water,
  objN: shots.objN, libN: shots.libN, biomeErr: shots.biomeErr, imagery: shots.imagery,
  stations: shots.shots.map((s) => ({ name: s.name, p: s.p, look: s.look })),
}, null, 2));
console.log(`\n${shots.shots.length} 張 → ${OUT}`);
await browser.close();
srv.close();
