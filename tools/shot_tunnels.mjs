// ============ 隧道 / 地下道 / 明隧道:多視角構造檢視(2026-07-31)============
// 用途:三種結構的「兩端出入口(外→內、內→外)+ 洞體中間 + 斜側 + 空拍」逐視角出圖,
// 外加四項**量化掃描**,把肉眼難判的破口/殘留變成數字 —— 離線稽核驗的是幾何契約,
// 這支驗的是「玩家真的看到什麼」。
//
// 出圖(每座結構 24 張):
//   p{i}_out60 / out25 / oblL / oblR   洞外遠近 + 左右斜側望向洞口
//   p{i}_mouth / in20_out / in45_out   洞口內側回望 / 洞內 20m・45m 望向洞外
//   p{i}_in20_up                       洞內仰視(天花/樑/燈)
//   mid_fwd / back / left / right / up / down    洞體中間六向
//   aerial_side / aerial_axis          橫向 / 沿軸空拍(相機高度吃**相機所在地**地形,免鑽進山裡)
//   明隧道整段覆蓋時引擎不立門洞(見 biomes 洞口條件 c0 >= 4)⇒ 端點由覆蓋段鏈首尾合成。
//
// 掃描(寫進 meta.json):
//   ① 斷面地形殘留  洞內斷面橫向射線(terrain.rayTerrain,吃 triDead)打到地形 = 洞裡卡著土楔
//   ② 洞口見天      洞口周邊斜上方視線瞄準「地表**下** 1m」卻打不到任何東西 = 這條線上缺面
//                   (瞄空中一點會被臨崖地形的合法穿空塞滿假紅字;洞身足跡本來就挖空,跳過)。
//                   **仍是篩選值不是判決值**:斜坡橫切溪溝一類地形會殘留少量偽陽,MUST 配圖判讀
//   ③ 斷面遮擋      洞內橫向射線距離 < hw−0.6 = 斷面裡有東西(植被/岩塊/擺件)
//   ④ 由上而下看穿  結構周邊垂直射線打不到任何東西 = 真破洞(collar 沒補到)
//   ⑤ 洞內見天      覆蓋段中心半球取樣的天空比例(深埋段 MUST ≈0;明隧道開放側本來就見天)
//
// 前置:①Playwright(開發期工具,**MUST NOT** 進 package.json —— 見 tools/pw.mjs)
//      ②高程走真實 AWS terrarium 磚(經 Node 轉送,沙箱瀏覽器直連常被擋)
//      ③圖資預設走**合成 way**(--synth):Overpass 不保證可達,且合成 way 能穩定重現
//        三種結構各一座;--live 則不攔截,吃真實圖資(真機/CI 用)。
//        合成 way 的形狀與真實 OSM 同構:tunnel way 只涵蓋結構本身、外接一般道路 way
//        (寫成一條長 way 會讓結構通行寬一路鋪到 120m 外,洞口接合根本沒被驗到)。
//      ④衛星影像(Esri)取不到就是素色地被 —— 地貌分類與線上版不同,**判讀構造不受影響**。
// 用法:node tools/shot_tunnels.mjs --kind tunnel|underpass|gallery [--venue taroko] [--out DIR] [--live]
// 退出碼:0 = 出圖完成(或找不到 playwright 而跳過);1 = 建圖失敗
import fs from 'node:fs';
import path from 'node:path';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromiumOrNull, chromePath, serve, skipNoPlaywright } from './pw.mjs';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const arg = (k, d) => { const i = process.argv.indexOf(k); return i >= 0 ? process.argv[i + 1] : d; };
const has = (k) => process.argv.includes(k);
const KIND = arg('--kind', 'tunnel');
if (!['tunnel', 'underpass', 'gallery'].includes(KIND)) throw new Error(`--kind MUST 是 tunnel / underpass / gallery(收到 ${KIND})`);
// 預設場地:山體隧道與明隧道要山(太魯閣燕子口),地下道要平地(市民大道)
const VENUE = arg('--venue', KIND === 'underpass' ? 'civicblvd' : 'taroko');
const OUT = path.resolve(arg('--out', join(ROOT, 'tools', `.shots_tunnels/${KIND}`)));
const LIVE = has('--live');
const DEBUG = has('--debug');   // 洞口破片定位:同視角出「原樣 / 隱藏地被層 / 只留地被層」三份
const PORT = +arg('--port', 8631);

const chromium = await chromiumOrNull();
if (!chromium) skipNoPlaywright('隧道多視角檢視');
fs.mkdirSync(OUT, { recursive: true });

// three:本機有 node_modules/three 就攔截 CDN 換成本機那份(沙箱連不出去);沒有就照走 CDN
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
// 圖磚一律由 Node 轉送:瀏覽器直連在沙箱/代理環境常被擋,Node 端已經配好憑證
const relay = async (route, contentType) => {
  // 重試三次:單一磚失敗會讓 fetchElevTerrarium 整批拋出 → 退到 open-meteo(沙箱連不出去)
  // ⇒ 整場地形建不起來。網路顛簸不該讓檢視工具整支掛掉。
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
  // 合成圖資:建物/鐵路查詢回空,道路查詢回頁面裡算好的三條 way(結構 + 兩條外接道路)
  const osm = async (route) => {
    const kind = /building/.test(route.request().postData() || '') ? 'features' : 'roads';
    const fx = await page.evaluate((k) => (window.__OSM?.[k] ?? { elements: [] }), kind);
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(fx) });
  };
  await page.route('**/overpass**', osm);
  await page.route('**/api/interpreter**', osm);
}
// 檢視頁:與 /public/js 同源(相對 import 才解析得到),只有 importmap + 一張 canvas
const PROBE_URL = `${srv.url}public/__tunnel_probe.html`;
await page.route(PROBE_URL, (r) => r.fulfill({
  status: 200, contentType: 'text/html; charset=utf-8',
  body: `<!DOCTYPE html><html><head><meta charset="utf-8">
<script type="importmap">{"imports":{"three":"${THREE_CDN}","three/addons/":"https://unpkg.com/three@0.160.0/examples/jsm/"}}</script>
<style>html,body{margin:0;background:#000}canvas{display:block}</style></head>
<body><canvas id="c" width="1280" height="720"></canvas></body></html>`,
}));
await page.goto(PROBE_URL, { waitUntil: 'domcontentloaded' });

const report = await page.evaluate(async ({ venueId, kind, synth, dbg }) => {
  const THREE = await import('three');
  const { VENUES, venueConfig } = await import('/public/js/venues.js');
  const { buildTerrain } = await import('/public/js/terrain.js');
  const { buildBiomes, makeTunnelIndex } = await import('/public/js/biomes.js');
  const { applyEnvironment } = await import('/public/js/environment.js');
  const { MAPGEO, WATER } = await import('/public/js/data.js');

  const venue = VENUES.find((v) => v.id === venueId);
  if (!venue) throw new Error(`找不到場地 ${venueId}`);
  const cfg = venueConfig(venue, 1);
  cfg.env = { season: 'summer', time: 'day', weather: 'clear' };   // 判讀構造要最亮的光
  window.__OSM = { features: { elements: [] }, roads: { elements: [] } };

  const terrain = await buildTerrain(cfg, () => {});
  const H = (x, z) => terrain.heightAt(x, z);
  const R_EARTH = 6371000, d2r = (d) => d * Math.PI / 180, S = MAPGEO.REAL_SCALE;
  const toLL = (x, z) => ({
    lat: cfg.center.lat + (-z) * S / R_EARTH * 180 / Math.PI,
    lon: cfg.center.lng + x * S / (R_EARTH * Math.cos(d2r(cfg.center.lat))) * 180 / Math.PI,
  });
  const inMap = (x, z, m = 80) => x > terrain.minX + m && x < terrain.maxX - m && z > terrain.minZ + m && z < terrain.maxZ - m;

  // ---------- 選址(純幾何掃描,零亂數 ⇒ 同場地恆選同一處)----------
  const L = kind === 'tunnel' ? 240 : kind === 'gallery' ? 200 : 150;
  const cands = [];
  for (let x = terrain.minX + 120; x < terrain.maxX - 120; x += 30) {
    for (let z = terrain.minZ + 120; z < terrain.maxZ - 120; z += 30) {
      for (let d = 0; d < 24; d++) cands.push({ x, z, ux: Math.cos(Math.PI * d / 24), uz: Math.sin(Math.PI * d / 24) });
    }
  }
  const ends = (c) => [c.x - c.ux * L / 2, c.z - c.uz * L / 2, c.x + c.ux * L / 2, c.z + c.uz * L / 2];
  const score = {
    tunnel(c) {                                   // 山體隧道:中段埋得最深(路面 = 兩端地表直線內插)
      const [ax, az, bx, bz] = ends(c);
      if (!inMap(ax, az) || !inMap(bx, bz)) return -1e9;
      const hA = H(ax, az), hB = H(bx, bz);
      if (hA < WATER.LEVEL + 3 || hB < WATER.LEVEL + 3) return -1e9;
      if (Math.abs(hA - hB) > 40) return -1e9;    // 兩端高差過大 = 路面自己就是陡坡
      let minBury = Infinity;
      for (let i = 5; i <= 35; i++) {
        const t = i / 40;
        minBury = Math.min(minBury, H(ax + (bx - ax) * t, az + (bz - az) * t) - (hA + (hB - hA) * t));
      }
      return minBury;
    },
    gallery(c) {                                  // 明隧道:沿等高線橫切陡坡(靠山側高、臨谷側低)
      const [ax, az, bx, bz] = ends(c);
      if (!inMap(ax, az) || !inMap(bx, bz)) return -1e9;
      const nx = -c.uz, nz = c.ux;
      let worst = Infinity;
      for (let i = 0; i <= 20; i++) {
        const t = i / 20, px = ax + (bx - ax) * t, pz = az + (bz - az) * t, h0 = H(px, pz);
        if (h0 < WATER.LEVEL + 5) return -1e9;
        worst = Math.min(worst, Math.min(H(px + nx * 16, pz + nz * 16) - h0, h0 - H(px - nx * 16, pz - nz * 16)));
      }
      return worst;
    },
    underpass(c) {                                // 地下道:最平的一段(地形起伏 = 懲罰)
      const [ax, az, bx, bz] = ends(c);
      if (!inMap(ax, az) || !inMap(bx, bz)) return -1e9;
      const hA = H(ax, az), hB = H(bx, bz);
      let dev = 0;
      for (let i = 0; i <= 20; i++) {
        const t = i / 20, px = ax + (bx - ax) * t, pz = az + (bz - az) * t, h = H(px, pz);
        if (h < WATER.LEVEL + 8) return -1e9;
        dev = Math.max(dev, Math.abs(h - (hA + (hB - hA) * t)));
      }
      return -dev;
    },
  }[kind];
  let best = null;
  for (const c of cands) { const s = score(c); if (!best || s > best.s) best = { s, c }; }
  const c = best.c;
  const [ax, az] = ends(c);
  const P = (t) => [ax + c.ux * L * t, az + c.uz * L * t];
  // 結構 way 只涵蓋結構本身(真實 OSM 的 tunnel way 就止於洞口):
  //   山體隧道 = 埋深 ≥ CLEAR+ROOF 的最長連續段(±8m 餘裕);明隧道/地下道 = 整條
  let t0 = 0, t1 = 1;
  if (kind === 'tunnel') {
    const hA = H(...P(0)), hB = H(...P(1));
    let bs = null, cur = null;
    for (let i = 0; i <= 120; i++) {
      const t = i / 120, p = P(t);
      if (H(p[0], p[1]) - (hA + (hB - hA) * t) >= 9.5) { if (!cur) cur = [t, t]; else cur[1] = t; }
      else if (cur) { if (!bs || cur[1] - cur[0] > bs[1] - bs[0]) bs = cur; cur = null; }
    }
    if (cur && (!bs || cur[1] - cur[0] > bs[1] - bs[0])) bs = cur;
    if (bs) {
      // way 端 MUST 落在「路面與地表相交」處 = 現實中的洞口。停在還埋著 9.5m 的地方 = way
      // 端點在山肚子裡:引擎只挖得出一條 ±hw 的走廊,兩側殘留的坡面就斜插進洞口(假破圖)。
      const bury = (t) => { const q = P(t); return H(q[0], q[1]) - (hA + (hB - hA) * t); };
      let a = bs[0], b2 = bs[1];
      while (a > 0 && bury(a) > 0.3) a -= 1 / 120;
      while (b2 < 1 && bury(b2) > 0.3) b2 += 1 / 120;
      t0 = Math.max(0, a - 2 / L); t1 = Math.min(1, b2 + 2 / L);
    }
  }
  const pts = [];
  for (let i = 0; i <= 6; i++) pts.push(P(t0 + (t1 - t0) * i / 6));
  if (synth) {
    const geomOf = (p) => p.map(([x, z]) => toLL(x, z));
    const tags = kind === 'gallery'
      ? { highway: 'secondary', tunnel: 'avalanche_protector', lanes: '2', name: 'PROBE' }
      : { highway: 'secondary', tunnel: 'yes', layer: '-1', lanes: '2', name: 'PROBE' };
    // 地下道的引道由 underpassPlan 自行往外長 ~1.5×sink/GRADE(≈130m):外接道路要讓開,
    // 否則兩條路疊在一起(接合處會出現假的錯層/破面,誤判成引擎 bug)
    const GAP = kind === 'underpass' ? 145 : 0;
    const approach = (len = 130) => [[pts[0], pts[1]], [pts[6], pts[5]]].map(([p, q]) => {
      let dx = p[0] - q[0], dz = p[1] - q[1];
      const l = Math.hypot(dx, dz) || 1; dx /= l; dz /= l;
      const s0 = [p[0] + dx * GAP, p[1] + dz * GAP];
      return [s0, [s0[0] + dx * len * 0.5, s0[1] + dz * len * 0.5], [s0[0] + dx * len, s0[1] + dz * len]];
    });
    window.__OSM = { features: { elements: [] }, roads: { elements: [
      { type: 'way', tags, geometry: geomOf(pts) },
      ...approach().map((p) => ({ type: 'way', tags: { highway: 'secondary', lanes: '2', name: 'APPROACH' }, geometry: geomOf(p) })),
    ] } };
  }

  const biomes = await buildBiomes(cfg, terrain, () => {});
  terrain.group.add(biomes);
  const ud = biomes.userData;
  const tunnelAt = makeTunnelIndex(ud.tunnels || []);
  const portals = ud.portals || [];
  const segs = ud.tunnels || [];
  const covSegs = segs.filter((d) => !d.open);
  const axisOf = (d) => { const ux = d.x2 - d.x1, uz = d.z2 - d.z1, l = Math.hypot(ux, uz) || 1; return [ux / l, uz / l, l]; };

  // 明隧道整段覆蓋 ⇒ 引擎不立門洞;端點改由覆蓋段鏈首尾合成(朝外向量 = 軸向往外)
  let mouths = portals;
  if (!mouths.length && covSegs.length) {
    const proj = (d) => (d.x1 - pts[0][0]) * c.ux + (d.z1 - pts[0][1]) * c.uz;
    const sorted = [...covSegs].sort((p, q) => proj(p) - proj(q));
    const a0 = sorted[0], a1 = sorted[sorted.length - 1];
    mouths = [
      { x: a0.x1, z: a0.z1, y: a0.fy1, hw: a0.hw, ry: Math.atan2(-(a0.x2 - a0.x1), -(a0.z2 - a0.z1)), synth: true },
      { x: a1.x2, z: a1.z2, y: a1.fy2, hw: a1.hw, ry: Math.atan2(a1.x2 - a1.x1, a1.z2 - a1.z1), synth: true },
    ];
  }

  // ================= 量化掃描 =================
  // ① 斷面地形殘留(rayTerrain 吃 triDead ⇒ 已打洞的三角形不算)
  const intruders = [];
  let sectSamples = 0;
  for (const d of covSegs) {
    const [ux, uz, len] = axisOf(d);
    const nx = -uz, nz = ux;
    for (let s = 1; s < len; s += 4) {
      const t = s / len;
      const cx = d.x1 + (d.x2 - d.x1) * t, cz = d.z1 + (d.z2 - d.z1) * t;
      const fy = d.fy1 + (d.fy2 - d.fy1) * t, cy = d.cy1 + (d.cy2 - d.cy1) * t;
      for (let y = fy + 0.8; y < cy - 0.2; y += 1.2) {
        sectSamples++;
        const hit = terrain.rayTerrain(cx - nx * d.hw, y, cz - nz * d.hw, nx, 0, nz, 2 * d.hw);
        if (hit) intruders.push({ x: +hit.x.toFixed(1), z: +hit.z.toFixed(1), dy: +(y - fy).toFixed(1),
          off: +((hit.x - cx) * nx + (hit.z - cz) * nz).toFixed(1) });
      }
    }
  }
  // ② 洞口見天(斜上方三個眼位掃過門面 ±18m)
  const rayA = new THREE.Raycaster();
  const apron = mouths.map((p, pi) => {
    const ox = Math.sin(p.ry), oz = Math.cos(p.ry), rx = oz, rz = -ox;
    const eyes = [[p.x + ox * 30 + rx * 22, p.y + 16, p.z + oz * 30 + rz * 22],
                  [p.x + ox * 30 - rx * 22, p.y + 16, p.z + oz * 30 - rz * 22],
                  [p.x + ox * 45, p.y + 20, p.z + oz * 45]];
    let miss = 0, n = 0;
    const missPts = [];
    for (const e of eyes) {
      const org = new THREE.Vector3(...e);
      for (let u = -1; u <= 1.001; u += 0.08) {
        for (let v = -1; v <= 1.001; v += 0.2) {
          // 目標一律取「地表**下** 1m」:射線最後必定進到實地裡 ⇒ 打不到 = 這條視線上真的缺面。
          // MUST NOT 改成瞄準空中的一點 —— 臨崖地形上那種射線會合法地越過稜線飛出圖外(假破口)。
          const tx = p.x + rx * 18 * u + ox * 10 * v, tz = p.z + rz * 18 * u + oz * 10 * v;
          // 門洞正面的洞身足跡 MUST 跳過:那裡的「地表下」本來就是**挖空的隧道**(打洞的目的),
          // 不跳過的話整片洞口都會被記成破口(假紅字,反而蓋掉真正的縫)。
          const lat = (tx - p.x) * rx + (tz - p.z) * rz, out = (tx - p.x) * ox + (tz - p.z) * oz;
          if (Math.abs(lat) <= (p.hw ?? 9) + 2 && out < 2) continue;
          const ty = H(tx, tz) - 1;
          const dir = new THREE.Vector3(tx - e[0], ty - e[1], tz - e[2]).normalize();
          if (dir.y > 0) continue;                   // 只看朝下(地面方向)的視線
          n++;
          rayA.set(org, dir);
          rayA.far = Math.hypot(tx - e[0], ty - e[1], tz - e[2]);
          if (!rayA.intersectObject(terrain.group, true).length) {
            miss++;
            if (missPts.length < 40) missPts.push([+tx.toFixed(1), +tz.toFixed(1)]);
          }
        }
      }
    }
    return { portal: pi, n, miss, missPts };
  });
  // ③ 斷面遮擋(任何物件,不只地形)
  const rayB = new THREE.Raycaster();
  const blockIn = [];
  for (const d of covSegs) {
    const [ux, uz, len] = axisOf(d);
    const nx = -uz, nz = ux;
    for (let s = 2; s < len; s += 9) {
      const t = s / len;
      const cx = d.x1 + (d.x2 - d.x1) * t, cz = d.z1 + (d.z2 - d.z1) * t;
      const fy = d.fy1 + (d.fy2 - d.fy1) * t, cy = d.cy1 + (d.cy2 - d.cy1) * t;
      for (let y = fy + 1.0; y < cy - 0.4; y += 2.0) {
        for (const sg of [1, -1]) {
          rayB.far = d.hw + 1;
          rayB.set(new THREE.Vector3(cx, y, cz), new THREE.Vector3(nx * sg, 0, nz * sg));
          const hit = rayB.intersectObject(terrain.group, true)[0];
          if (hit && hit.distance < d.hw - 0.6) {
            blockIn.push({ x: +cx.toFixed(1), z: +cz.toFixed(1), dy: +(y - fy).toFixed(1),
              dist: +hit.distance.toFixed(1), side: sg, gal: !!d.gal });
          }
        }
      }
    }
  }
  // ④ 由上而下看穿世界
  const rayV = new THREE.Raycaster(); rayV.far = 3000;
  let voidHits = 0, voidN = 0;
  const voidPts = [];
  if (covSegs.length) {
    let bx0 = Infinity, bx1 = -Infinity, bz0 = Infinity, bz1 = -Infinity;
    for (const d of segs) {
      bx0 = Math.min(bx0, d.x1, d.x2); bx1 = Math.max(bx1, d.x1, d.x2);
      bz0 = Math.min(bz0, d.z1, d.z2); bz1 = Math.max(bz1, d.z1, d.z2);
    }
    for (let x = bx0 - 40; x <= bx1 + 40; x += 4) {
      for (let z = bz0 - 40; z <= bz1 + 40; z += 4) {
        voidN++;
        rayV.set(new THREE.Vector3(x, terrain.maxH + 400, z), new THREE.Vector3(0, -1, 0));
        if (!rayV.intersectObject(terrain.group, true).length) {
          voidHits++;
          if (voidPts.length < 60) voidPts.push([+x.toFixed(1), +z.toFixed(1)]);
        }
      }
    }
  }
  // ⑤ 洞內見天(覆蓋段中心半球取樣)
  const rayS = new THREE.Raycaster(); rayS.far = 900;
  const leaks = [];
  for (let i = 0; i < covSegs.length; i += Math.max(1, Math.floor(covSegs.length / 8))) {
    const d = covSegs[i];
    const [ux, uz] = axisOf(d);
    const org = new THREE.Vector3((d.x1 + d.x2) / 2, (d.fy1 + d.fy2) / 2 + 3.0, (d.z1 + d.z2) / 2);
    let sky = 0, n = 0, axial = 0;
    for (let a = 0; a < 48; a++) {
      for (let e = 0; e < 5; e++) {
        const azm = Math.PI * 2 * a / 48, el = (-10 + e * 15) * Math.PI / 180;
        const dir = new THREE.Vector3(Math.sin(azm) * Math.cos(el), Math.sin(el), Math.cos(azm) * Math.cos(el)).normalize();
        n++;
        rayS.set(org, dir);
        if (!rayS.intersectObject(terrain.group, true).length) {
          sky++;
          if (Math.abs(dir.x * ux + dir.z * uz) > 0.9) axial++;   // 沿軸 = 從洞口看出去,合法
        }
      }
    }
    leaks.push({ x: +org.x.toFixed(1), z: +org.z.toFixed(1), sky, axial, n, gal: !!d.gal });
  }

  // ================= 出圖 =================
  const canvas = document.getElementById('c');
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  renderer.setPixelRatio(1); renderer.setSize(1280, 720, false);
  const scene = new THREE.Scene();
  applyEnvironment(scene, terrain, cfg.env);
  scene.add(terrain.group);
  const span = Math.max(terrain.worldW, terrain.worldH);
  const cam = new THREE.PerspectiveCamera(68, 1280 / 720, 0.4, span * 2);
  const shots = [];
  const snap = (name, pos, look) => {
    cam.position.set(...pos); cam.lookAt(...look); cam.updateProjectionMatrix();
    renderer.render(scene, cam);
    shots.push({ name, data: canvas.toDataURL('image/png') });
  };

  // --debug:同一視角出三份(原樣 / 隱藏地被實例層 / 只留地被實例層)—— 洞口的破片到底
  // 是地形、結構還是地被拼圖,靠這三張一眼定位(肉眼分不出灰白拼圖與混凝土)
  const dbgHits = [], dbgWidth = [];
  const instLayer = [];
  if (dbg) terrain.group.traverse((o) => { if (o.isInstancedMesh) instLayer.push(o); });
  const snapDbg = (name, pos, look) => {
    snap(name, pos, look);
    if (!dbg) return;
    instLayer.forEach((o) => { o.visible = false; });
    snap(`${name}__noCover`, pos, look);
    instLayer.forEach((o) => { o.visible = true; });
    terrain.group.traverse((o) => { if (o.isMesh && !o.isInstancedMesh) o.visible = false; });
    snap(`${name}__coverOnly`, pos, look);
    terrain.group.traverse((o) => { if (o.isMesh && !o.isInstancedMesh) o.visible = true; });
  };

  mouths.forEach((p, i) => {
    const ox = Math.sin(p.ry), oz = Math.cos(p.ry), rx = oz, rz = -ox, fy = p.y;
    const eye = (d) => Math.max(H(p.x + ox * d, p.z + oz * d), fy) + 3.2;
    if (dbg) {
      snapDbg(`p${i}_dbg_out14`, [p.x + ox * 14, fy + 3.0, p.z + oz * 14], [p.x - ox * 30, fy + 4, p.z - oz * 30]);
      snapDbg(`p${i}_dbg_in12`, [p.x - ox * 12, fy + 3.0, p.z - oz * 12], [p.x + ox * 40, fy + 4, p.z + oz * 40]);
      // 誰擋在洞口斷面裡:自洞內眼位掃一把扇形,把命中物件的識別特徵收集起來
      const rayD = new THREE.Raycaster();
      const org = new THREE.Vector3(p.x - ox * 12, fy + 3.0, p.z - oz * 12);
      const seen = new Map();
      for (let u = -1; u <= 1.001; u += 0.05) {
        for (let w = -0.6; w <= 1.201; w += 0.1) {
          const tx = p.x + rx * 12 * u + ox * 4, tz = p.z + rz * 12 * u + oz * 4, ty = fy + 1 + 6 * w;
          rayD.set(org, new THREE.Vector3(tx - org.x, ty - org.y, tz - org.z).normalize());
          rayD.far = 60;
          const h = rayD.intersectObject(terrain.group, true)[0];
          if (!h) continue;
          const o = h.object, m = o.material;
          const k = `${o.isInstancedMesh ? 'inst' : 'mesh'}|${m?.color?.getHexString?.() ?? '-'}|${m?.side ?? '-'}`
            + `|vc=${!!m?.vertexColors}|map=${!!m?.map}|po=${!!m?.polygonOffset}|v=${o.geometry?.attributes?.position?.count ?? 0}`;
          const rec = seen.get(k) || { n: 0, near: Infinity, y: 0 };
          rec.n++;
          if (h.distance < rec.near) { rec.near = +h.distance.toFixed(1); rec.y = +(h.point.y - fy).toFixed(1); }
          seen.set(k, rec);
        }
      }
      dbgHits.push({ portal: i, hits: [...seen].map(([k, v]) => ({ k, ...v })).sort((a, b) => b.n - a.n) });
      // 洞口鋪面寬度剖面:自洞內 12m 到洞外 24m,逐公尺量「路面緞帶」橫向延伸多寬 ——
      // 結構通行寬(≥PASS_W/2)與洞外車道寬之間若沒有漸縮帶,這條剖面就會在洞口斷成階梯
      const rayW = new THREE.Raycaster();
      const prof = [];
      for (let s = -12; s <= 24; s += 2) {
        const cx = p.x + ox * s, cz = p.z + oz * s;
        // 基準高取**當地中心線**的路面(引道是斜的;拿洞口高當基準,10m 外就差一個門檻 = 假縮寬)
        rayW.far = 30;
        rayW.set(new THREE.Vector3(cx, p.y + 14, cz), new THREE.Vector3(0, -1, 0));
        const cHits = rayW.intersectObject(terrain.group, true);
        if (!cHits.length) { prof.push({ s, wL: -1, wR: -1 }); continue; }
        const ref = cHits[cHits.length - 1].point.y;   // 最底下那個面 = 路面(上方可能有天花/門框)
        let wL = 0, wR = 0;
        for (let l = 0.5; l <= 18; l += 0.5) {
          for (const sg of [1, -1]) {
            rayW.set(new THREE.Vector3(cx + rx * l * sg, ref + 8, cz + rz * l * sg), new THREE.Vector3(0, -1, 0));
            rayW.far = 20;
            // 逐個交點找「與當地路面同高」的那一個(只看最近的會被門框/天花/簷口吃掉)
            const paved = rayW.intersectObject(terrain.group, true).some((h) => Math.abs(h.point.y - ref) < 1.0);
            if (!paved) continue;
            if (sg > 0 && l > wR) wR = l;
            if (sg < 0 && l > wL) wL = l;
          }
        }
        prof.push({ s, wL: +wL.toFixed(1), wR: +wR.toFixed(1) });
      }
      dbgWidth.push({ portal: i, prof });
    }
    snap(`p${i}_out60`, [p.x + ox * 60, eye(60) + 2, p.z + oz * 60], [p.x, fy + 4, p.z]);
    snap(`p${i}_out25`, [p.x + ox * 25, eye(25), p.z + oz * 25], [p.x, fy + 4, p.z]);
    snap(`p${i}_oblL`, [p.x + ox * 28 + rx * 22, eye(28) + 4, p.z + oz * 28 + rz * 22], [p.x, fy + 4, p.z]);
    snap(`p${i}_oblR`, [p.x + ox * 28 - rx * 22, eye(28) + 4, p.z + oz * 28 - rz * 22], [p.x, fy + 4, p.z]);
    snap(`p${i}_mouth`, [p.x + ox * 3, fy + 3.2, p.z + oz * 3], [p.x - ox * 60, fy + 4, p.z - oz * 60]);
    snap(`p${i}_in20_out`, [p.x - ox * 20, fy + 3.2, p.z - oz * 20], [p.x + ox * 60, fy + 4.5, p.z + oz * 60]);
    snap(`p${i}_in45_out`, [p.x - ox * 45, fy + 3.2, p.z - oz * 45], [p.x + ox * 90, fy + 4.5, p.z + oz * 90]);
    snap(`p${i}_in20_up`, [p.x - ox * 20, fy + 2.0, p.z - oz * 20], [p.x - ox * 24, fy + 12, p.z - oz * 24]);
  });
  const meta = {
    kind, venue: venueId, place: cfg.placeName, synth, score: +best.s.toFixed(1),
    line: pts.map((p) => p.map((v) => +v.toFixed(1))),
    portals: portals.length, segs: segs.length, covered: covSegs.length,
    open: segs.length - covSegs.length, gal: segs.filter((d) => d.gal).length,
    mouths: mouths.map((p) => ({ x: +p.x.toFixed(1), z: +p.z.toFixed(1), y: +p.y.toFixed(1), synth: !!p.synth })),
    scan: { sectSamples, intruders: intruders.length, intruderList: intruders.slice(0, 200),
            apron, blockIn: blockIn.length, blockInList: blockIn.slice(0, 60),
            voidN, voidHits, voidPts, leaks },
    dbgHits, dbgWidth,
  };
  if (covSegs.length) {
    const m = covSegs[Math.floor(covSegs.length / 2)];
    const mx = (m.x1 + m.x2) / 2, mz = (m.z1 + m.z2) / 2;
    const tn = tunnelAt(mx, mz);
    const fy = tn ? tn.floor : (m.fy1 + m.fy2) / 2;
    const [ux, uz] = axisOf(m);
    meta.mid = { x: +mx.toFixed(1), z: +mz.toFixed(1), floor: +fy.toFixed(1), ceil: tn ? +tn.ceil.toFixed(1) : null };
    snap('mid_fwd', [mx, fy + 3.2, mz], [mx + ux * 80, fy + 4, mz + uz * 80]);
    snap('mid_back', [mx, fy + 3.2, mz], [mx - ux * 80, fy + 4, mz - uz * 80]);
    snap('mid_left', [mx, fy + 3.2, mz], [mx - uz * 40, fy + 4.5, mz + ux * 40]);
    snap('mid_right', [mx, fy + 3.2, mz], [mx + uz * 40, fy + 4.5, mz - ux * 40]);
    snap('mid_up', [mx, fy + 2.0, mz], [mx + ux * 6, fy + 14, mz + uz * 6]);
    snap('mid_down', [mx, fy + 5.5, mz], [mx + ux * 10, fy - 4, mz + uz * 10]);
    // 空拍高度 MUST 吃**相機所在地**的地形(只看結構中心會把相機擺進山體 = 拍到地形背面)
    const cx = (pts[0][0] + pts[6][0]) / 2, cz = (pts[0][1] + pts[6][1]) / 2;
    const camA = [cx - uz * 170, 0, cz + ux * 170], camB = [cx - ux * 220, 0, cz - uz * 220];
    camA[1] = Math.max(H(camA[0], camA[2]), H(cx, cz), fy) + 130;
    camB[1] = Math.max(H(camB[0], camB[2]), H(cx, cz), fy) + 140;
    snap('aerial_side', camA, [cx, fy, cz]);
    snap('aerial_axis', camB, [cx, fy, cz]);
  }
  return { meta, shots };
}, { venueId: VENUE, kind: KIND, synth: !LIVE, dbg: DEBUG });

for (const s of report.shots) fs.writeFileSync(join(OUT, `${s.name}.png`), Buffer.from(s.data.split(',')[1], 'base64'));
fs.writeFileSync(join(OUT, 'meta.json'), JSON.stringify(report.meta, null, 2));
const sc = report.meta.scan;
console.log(`【${KIND}】${report.meta.place}　門洞 ${report.meta.portals}　小段 ${report.meta.segs}(覆蓋 ${report.meta.covered} / 明隧道 ${report.meta.gal})`);
console.log(`  斷面地形殘留 ${sc.intruders}/${sc.sectSamples}　斷面遮擋 ${sc.blockIn}　由上而下看穿 ${sc.voidHits}/${sc.voidN}`);
console.log(`  洞口見天 ${sc.apron.map((a) => `${a.miss}/${a.n}`).join('、') || '(無門洞)'}`);
console.log(`  洞內見天 ${sc.leaks.map((l) => `${l.sky}${l.gal ? '*' : ''}`).join(' ')}　(* = 明隧道段,開放側本來就見天)`);
console.log(`✓ ${report.shots.length} 張 → ${OUT}`);
await browser.close();
srv.close();
