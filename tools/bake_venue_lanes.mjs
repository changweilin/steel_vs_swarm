// ============ 預設場地兵線離線預算 ============
// 用法:node tools/bake_venue_lanes.mjs   (ONLY=taipei101,seoul 可只跑指定場地)
// 產出 public/js/venueLanes.js。改 ANCHORS 或 MAPGEO 的尺寸/重合率常數後 MUST 重跑。
// Overpass 真實道路路網 → 建圖 → 每條兵線 = 一條「邊不相交」的最短路徑(全程踩在現實道路上)
// → 用 overlapCellM(L) 驗重合率 ≤ MAX_OVERLAP、繞路 ≤ 2.2×、兩堡距離 ≥ 對角線 80%。
import { writeFileSync, readFileSync, existsSync, mkdirSync } from 'node:fs';
import { MAPGEO, realDistFor, targetDistFor, overlapCellM, laneTacticsXZ, tacticalScore }
  from '../public/js/data.js';

const CACHE = new URL('./.osm_cache/', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
if (!existsSync(CACHE)) mkdirSync(CACHE, { recursive: true });

const R = 6371000, d2r = Math.PI / 180;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (...a) => { console.log(...a); };

const ONLY = (process.env.ONLY || '').split(',').filter(Boolean);
const ANCHORS_ALL = {
  taipei101: [[25.0339, 121.5645]],
  shibuya: [[35.6595, 139.7005]],
  manhattan: [[40.7549, -73.9840]],
  paris: [[48.8584, 2.2945]],
  seoul: [[37.4979, 127.0276]],
  // 自然場地:錨點移到鄰近有路網的聚落(地貌 mix 不變,仍是森林/沙漠/濕地的視覺)
  yangmingshan: [[25.1180, 121.5300], [25.1370, 121.5450]],   // 天母(陽明山南麓住宅網格)
  aokigahara: [[35.4972, 138.7546], [35.4986, 138.6866]],     // 河口湖町
  blackforest: [[48.4670, 8.4115], [48.5480, 8.3700]],        // Freudenstadt / Baiersbronn
  yosemite: [[37.6690, -119.7990], [37.7485, -119.5878]],     // El Portal / 優勝美地村
  giza: [[29.9870, 31.1420], [29.9773, 31.1325]],             // Nazlet El-Semman
  uluru: [[-25.2406, 130.9889]],                              // Yulara 度假村
  atacama: [[-22.9098, -68.2001]],                            // San Pedro de Atacama
  hehuanshan: [[23.9650, 120.9670], [24.0577, 121.1614]],     // 埔里鎮 / 清境農場
  venice: [[45.4850, 12.2350], [45.4408, 12.3155]],           // Mestre(本島無車道)
  iguazu: [[-25.5990, -54.5735]],                             // Puerto Iguazú
  tamsui: [[25.1680, 121.4450], [25.1720, 121.4400]],         // 淡水市區
  okavango: [[-19.9833, 23.4167]],                            // Maun
  rio: [[-22.9700, -43.1850], [-22.9519, -43.2105]],
  sydney: [[-33.8700, 151.2070], [-33.8568, 151.2153]],       // 雪梨 CBD(歌劇院在岬角,湊不出側翼)
  london: [[51.5007, -0.1246]],
  kyoto: [[35.0100, 135.7100], [35.0116, 135.6800]],          // 右京區街廓 / 嵐山
};

const ANCHORS = ONLY.length ? Object.fromEntries(Object.entries(ANCHORS_ALL).filter(([k])=>ONLY.includes(k))) : ANCHORS_ALL;

const DRIVABLE = 'motorway|trunk|primary|secondary|tertiary|unclassified|residential|living_street|service'
  + '|motorway_link|trunk_link|primary_link|secondary_link|tertiary_link';
const ENDPOINTS = [
  'https://overpass-api.de/api/interpreter',
  'https://maps.mail.ru/osm/tools/overpass/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
];

async function overpassRoads(id, lat, lng, radius) {
  const f = `${CACHE}/${id}.json`;
  if (existsSync(f)) return JSON.parse(readFileSync(f, 'utf8'));
  const q = `[out:json][timeout:90];way["highway"~"^(${DRIVABLE})$"](around:${Math.round(radius)},${lat},${lng});out geom;`;
  for (let a = 0; a < 9; a++) {
    const url = ENDPOINTS[a % ENDPOINTS.length];
    try {
      // Content-Type 必須明講:Node fetch 對字串 body 預設 text/plain,
      // Overpass 會把 "data=" 前綴當成查詢語法 → 406 Not Acceptable
      const resp = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: 'data=' + encodeURIComponent(q),
      });
      if (!resp.ok) { log(`  overpass ${resp.status} @${new URL(url).host}, retry`); await sleep(3000 * (a + 1)); continue; }
      const d = await resp.json();
      const els = d.elements || [];
      writeFileSync(f, JSON.stringify(els));
      return els;
    } catch (e) { log('  overpass err', e.message); await sleep(3000 * (a + 1)); }
  }
  return null;
}

// ---- 數值索引路網圖 ----
function buildGraph(ways, origin) {
  const idx = new Map();          // "lat,lng" -> i
  const X = [], Z = [], LA = [], LN = [], adj = [];
  const cosO = Math.cos(origin[0] * d2r);
  const nid = (la, ln) => {
    const k = `${la.toFixed(6)},${ln.toFixed(6)}`;
    let i = idx.get(k);
    if (i === undefined) {
      i = X.length;
      idx.set(k, i);
      X.push((ln - origin[1]) * d2r * R * cosO);
      Z.push((la - origin[0]) * d2r * R);
      LA.push(la); LN.push(ln); adj.push([]);
    }
    return i;
  };
  for (const w of ways) {
    if (!w.geometry) continue;
    for (let i = 1; i < w.geometry.length; i++) {
      const a = w.geometry[i - 1], b = w.geometry[i];
      const u = nid(a.lat, a.lon), v = nid(b.lat, b.lon);
      if (u === v) continue;
      const len = Math.hypot(X[u] - X[v], Z[u] - Z[v]);
      adj[u].push(v, len);        // 扁平化:[v0,len0, v1,len1, …]
      adj[v].push(u, len);
    }
  }
  return { X, Z, LA, LN, adj, n: X.length };
}

class MinHeap {
  constructor(cap) { this.k = new Float64Array(cap); this.v = new Int32Array(cap); this.n = 0; }
  push(k, v) {
    if (this.n === this.k.length) { const K = new Float64Array(this.n * 2), V = new Int32Array(this.n * 2); K.set(this.k); V.set(this.v); this.k = K; this.v = V; }
    let i = this.n++;
    this.k[i] = k; this.v[i] = v;
    while (i > 0) { const p = (i - 1) >> 1; if (this.k[p] <= this.k[i]) break; this._sw(p, i); i = p; }
  }
  pop() {
    const rk = this.k[0], rv = this.v[0];
    this.n--;
    if (this.n) {
      this.k[0] = this.k[this.n]; this.v[0] = this.v[this.n];
      let i = 0;
      for (;;) {
        const l = 2 * i + 1, r = l + 1;
        let s = i;
        if (l < this.n && this.k[l] < this.k[s]) s = l;
        if (r < this.n && this.k[r] < this.k[s]) s = r;
        if (s === i) break;
        this._sw(s, i); i = s;
      }
    }
    return [rk, rv];
  }
  _sw(a, b) { const k = this.k[a], v = this.v[a]; this.k[a] = this.k[b]; this.v[a] = this.v[b]; this.k[b] = k; this.v[b] = v; }
}

// 已被前一條兵線用掉的邊:重罰而非硬禁。
// 硬禁(邊不相交)會逼第三條繞路超過 2.2× 上限而全滅;重罰讓它「盡量不重用」,
// 真正的硬門檻交給重合率(那才是規則本身)。
const REUSE_PEN = 8;

/** Dijkstra;used = Set of (u*n+v) 已用邊;wMul(u,v) 側翼偏好乘數 */
function dijkstra(g, src, dst, used, wMul) {
  const { adj, n } = g;
  const dist = new Float64Array(n).fill(Infinity);
  const prev = new Int32Array(n).fill(-1);
  const done = new Uint8Array(n);
  dist[src] = 0;
  const h = new MinHeap(1024);
  h.push(0, src);
  while (h.n) {
    const [d, u] = h.pop();
    if (done[u]) continue;
    done[u] = 1;
    if (u === dst) break;
    const a = adj[u];
    for (let i = 0; i < a.length; i += 2) {
      const v = a[i];
      if (done[v]) continue;
      let w = a[i + 1] * (wMul ? wMul(u, v) : 1);
      if (used.has(u * n + v)) w *= REUSE_PEN;
      const nd = d + w;
      if (nd < dist[v]) { dist[v] = nd; prev[v] = u; h.push(nd, v); }
    }
  }
  if (!done[dst]) return null;
  const path = [dst];
  while (path[0] !== src) { const p = prev[path[0]]; if (p < 0) return null; path.unshift(p); }
  return path;
}

const pathLen = (g, p) => { let s = 0; for (let i = 1; i < p.length; i++) s += Math.hypot(g.X[p[i]] - g.X[p[i - 1]], g.Z[p[i]] - g.Z[p[i - 1]]); return s; };
const banPath = (b, p, n) => { for (let i = 1; i < p.length; i++) { b.add(p[i - 1] * n + p[i]); b.add(p[i] * n + p[i - 1]); } };

/** Douglas-Peucker;回傳「保留下來的位置索引」(端點恆保留 ⇒ 兵線端點精確落在主堡) */
function simplifyIdx(pts, tol) {
  const keep = new Uint8Array(pts.length);
  keep[0] = keep[pts.length - 1] = 1;
  if (pts.length >= 3) {
    const st = [[0, pts.length - 1]];
    while (st.length) {
      const [i, j] = st.pop();
      if (j <= i + 1) continue;
      const [x1, y1] = pts[i], [x2, y2] = pts[j];
      const dx = x2 - x1, dy = y2 - y1, L2 = dx * dx + dy * dy || 1;
      let bi = -1, bd = tol;
      for (let k = i + 1; k < j; k++) {
        const [x, y] = pts[k];
        const t = Math.max(0, Math.min(1, ((x - x1) * dx + (y - y1) * dy) / L2));
        const d = Math.hypot(x - (x1 + t * dx), y - (y1 + t * dy));
        if (d > bd) { bd = d; bi = k; }
      }
      if (bi < 0) continue;
      keep[bi] = 1; st.push([i, bi], [bi, j]);
    }
  }
  const outIdx = [];
  for (let i = 0; i < pts.length; i++) if (keep[i]) outIdx.push(i);
  return outIdx;
}

function overlapXZ(a, b, cell) {
  const gridOf = (lane) => {
    const s = new Set();
    for (let i = 1; i < lane.length; i++) {
      const [x1, z1] = lane[i - 1], [x2, z2] = lane[i];
      const n = Math.max(1, Math.ceil(Math.hypot(x2 - x1, z2 - z1) / (cell / 2)));
      for (let k = 0; k <= n; k++) s.add(`${Math.round((x1 + (x2 - x1) * k / n) / cell)},${Math.round((z1 + (z2 - z1) * k / n) / cell)}`);
    }
    return s;
  };
  const ga = gridOf(a), gb = gridOf(b);
  if (!ga.size || !gb.size) return 1;
  let sh = 0;
  for (const c of ga) if (gb.has(c)) sh++;
  return sh / Math.min(ga.size, gb.size);
}

// 側移目標檔位:與 mapSelect 的 OFFSET_FRACS 同一組(近→遠)
const OFFSET_FRACS = [MAPGEO.LANE_OFFSET_FRAC, 0.45, 0.62];

function tryBearing(g, aIdx, bearing, L, offFrac) {
  const realD = realDistFor(L);
  const { X, Z, n } = g;
  const ax = X[aIdx], az = Z[aIdx];
  const bx0 = ax + Math.sin(bearing * d2r) * realD, bz0 = az + Math.cos(bearing * d2r) * realD;
  const minAB = realD * MAPGEO.MIN_DIST_FRAC / MAPGEO.BASE_DIST_FRAC;   // ⇒ distM ≥ diagM×0.80
  let bIdx = -1, best = Infinity;
  for (let i = 0; i < n; i++) {
    const ab = Math.hypot(X[i] - ax, Z[i] - az);
    if (ab < minAB || ab > realD * 1.15) continue;
    const off = Math.hypot(X[i] - bx0, Z[i] - bz0);
    if (off < best) { best = off; bIdx = i; }
  }
  if (bIdx < 0) return { fail: 'noB' };

  const straight = Math.hypot(X[bIdx] - ax, Z[bIdx] - az);
  const vx = (X[bIdx] - ax) / straight, vz = (Z[bIdx] - az) / straight;
  const px = -vz, pz = vx;                                    // 垂直單位向量
  const lat = (i) => (X[i] - ax) * px + (Z[i] - az) * pz;     // 側向位移(正 = 左)
  const prog = (i) => ((X[i] - ax) * vx + (Z[i] - az) * vz) / straight;   // 沿 A→B 的進度 0..1
  // 側翼:不只是「別走錯邊」,而是主動朝目標側移弧線靠攏 —— 與 synthLane 的主脊同形
  // (sin 拱形:兩端歸零、中段最寬 LANE_OFFSET_FRAC×D)。
  // 只罰錯邊的舊寫法會讓路徑貼著中線走,重合率因此壓不下來。
  const STEER_W = 2.4;
  const sideW = (s, offFrac) => (u, v) => {
    const m = (lat(u) + lat(v)) / 2;
    const t = Math.max(0, Math.min(1, (prog(u) + prog(v)) / 2));
    const want = s * offFrac * straight * Math.sin(Math.PI * t);
    return 1 + STEER_W * Math.abs(m - want) / straight;
  };

  const used = new Set();
  let why = null;
  const take = (wMul) => {
    const p = dijkstra(g, aIdx, bIdx, used, wMul);
    if (!p) { why = 'noPath'; return null; }
    if (pathLen(g, p) / straight > 2.2) { why = 'detour'; return null; }   // 繞路閘門(同 mapSelect)
    banPath(used, p, n);                                      // 標記已用邊(下一條會被 REUSE_PEN 重罰)
    const all = p.map((i) => [X[i], Z[i]]);
    const keep = simplifyIdx(all, 3);
    const idx = keep.map((k) => p[k]);                        // 簡化後仍全是 OSM 道路節點
    const xz = keep.map((k) => all[k]);
    let s = 0;
    for (const q of idx) s += lat(q);
    return { xz, idx, lat: s / idx.length };
  };

  const lanes = [];
  if (L === 1 || L === 3) { const m = take(null); if (!m) return { fail: why }; lanes.push(m); }
  if (L > 1) for (const s of [1, -1]) { const f = take(sideW(s, offFrac)); if (!f) return { fail: why }; lanes.push(f); }
  lanes.sort((p, q) => q.lat - p.lat);                        // [上, 中, 下]

  const cell = overlapCellM(L);
  let mo = 0;
  for (let i = 0; i < lanes.length; i++)
    for (let j = i + 1; j < lanes.length; j++) mo = Math.max(mo, overlapXZ(lanes[i].xz, lanes[j].xz, cell));
  if (mo > MAPGEO.MAX_OVERLAP) return { fail: 'overlap', ov: mo };

  const s = 1 / MAPGEO.REAL_SCALE;
  let sinu = 0, tpk = 0;
  for (const l of lanes) { const t = laneTacticsXZ(l.xz.map(([x, z]) => [x * s, z * s])); sinu += t.sinuosity; tpk += t.turnsPerKm; }
  sinu /= L; tpk /= L;
  return {
    bearing, aIdx, bIdx, lanes,
    maxOverlap: mo, sinuosity: sinu, turnsPerKm: tpk,
    score: tacticalScore(sinu, tpk, mo),
  };
}

// ---- 主流程 ----
const out = {}, report = [];
const maxRealD = realDistFor(3);
for (const [id, anchors] of Object.entries(ANCHORS)) {
  let picked = null;
  for (const anchor of anchors) {
    log(`${id} @ [${anchor}] …`);
    // 半徑要留給側翼外凸的空間(B 已在 1.15×realD;繞路上限 2.2×)
    const RAD = maxRealD * 2.4;
    const ways = await overpassRoads(`${id}_${anchor.map((v) => v.toFixed(4)).join('_')}_r${Math.round(RAD)}`, anchor[0], anchor[1], RAD);
    if (!ways || ways.length < 20) { log(`  ways=${ways ? ways.length : 'ERR'} → skip`); continue; }
    const g = buildGraph(ways, anchor);
    log(`  ways=${ways.length} nodes=${g.n}`);
    // 錨點 → 最近道路節點(120m 內)
    let aIdx = -1, ad = 120;
    for (let i = 0; i < g.n; i++) { const d = Math.hypot(g.X[i], g.Z[i]); if (d < ad) { ad = d; aIdx = i; } }
    if (aIdx < 0) { log('  錨點 120m 內無道路節點 → skip'); continue; }

    const byL = {};
    for (const L of [1, 2, 3]) {
      let best = null;
      const why = {};
      let bestOv = 9;
      // 方位角每 5° × 三檔側移目標:離線暴搜,不放過任何一組能全線走真實道路的解
      for (let i = 0; i < 72; i++) {
        for (const off of OFFSET_FRACS) {
          const r = tryBearing(g, aIdx, i * 5, L, off);
          if (r?.fail) { why[r.fail] = (why[r.fail] || 0) + 1; if (r.ov != null) bestOv = Math.min(bestOv, r.ov); continue; }
          if (r && (!best || r.score > best.score)) best = r;
        }
      }
      if (!best) {
        // 逐 L 獨立:這個 L 湊不出真實道路兵線 → venueConfig 對它退回 synthLane
        log(`  L=${L} ✗ 無可行方位角 reasons=${JSON.stringify(why)}${bestOv < 9 ? ` bestOv=${bestOv.toFixed(3)}` : ''}`);
        continue;
      }
      byL[L] = { g, ...best };
      log(`  L=${L} ✓ br=${best.bearing}° ov=${best.maxOverlap.toFixed(3)} sinu=${best.sinuosity.toFixed(2)}`);
    }
    const hits = Object.keys(byL).length;
    if (!hits) continue;
    // 取「真實道路兵線可用的 L 數」最多的錨點;同分取先列者
    if (!picked || hits > Object.keys(picked.byL).length) picked = { anchor, byL, ways: ways.length, g };
    if (hits === 3) break;
  }
  if (!picked) { report.push(`${id}: ❌ 全 L 皆無真實道路解 → 一律 synthLane`); log(`${id}: ❌`); continue; }
  out[id] = picked;
  const mark = (L) => (picked.byL[L] ? `L${L} ov=${picked.byL[L].maxOverlap.toFixed(2)}` : `L${L} synth`);
  const full = Object.keys(picked.byL).length === 3;
  report.push(`${id}: ${full ? '✅' : '◐'} A=[${picked.anchor.map((v) => v.toFixed(5))}] ${[1, 2, 3].map(mark).join(' | ')}`);
  log(`${id}: ${full ? '✅' : '◐'}`);
}

log('\n---- 報告 ----');
for (const r of report) log(r);
log(`\n成功 ${Object.keys(out).length} / ${Object.keys(ANCHORS).length}`);

const r6 = (v) => +v.toFixed(6);
let js = `// ============ 預設場地兵線(離線預算,勿手改)============
// 由 tools/bake_venue_lanes.mjs 產生:Overpass 真實道路路網 → 邊不相交最短路徑。
// 每條兵線的每個頂點都是 OSM 道路節點 ⇒ NPC 引導路線 100% 與現實導航路線相符。
// 通過的規則(與互動式選址流程相同):兩堡距離 ≥ 對角線 ${MAPGEO.MIN_DIST_FRAC * 100}%、
// 任兩線重合率 ≤ ${MAPGEO.MAX_OVERLAP}(判定網格 overlapCellM(L))、單線繞路 ≤ 2.2×直線距離。
// bases[0] = SWARM(錨點側)、bases[1] = STEEL;lanes 依側向排序 [上, 中, 下]。
export const VENUE_LANES = {\n`;
for (const [id, v] of Object.entries(out)) {
  js += `  ${id}: {\n`;
  for (const L of [1, 2, 3]) {
    const b = v.byL[L];
    if (!b) continue;                     // 該 L 無真實道路解 → venues.js 對它退回 synthLane
    const g = v.g;
    const A = [g.LA[b.aIdx], g.LN[b.aIdx]], B = [g.LA[b.bIdx], g.LN[b.bIdx]];
    const lanesLL = b.lanes.map((l) => l.idx.map((i) => [r6(g.LA[i]), r6(g.LN[i])]));
    js += `    ${L}: { bearing: ${b.bearing}, maxOverlap: ${+b.maxOverlap.toFixed(3)},\n`;
    js += `      bases: [[${r6(A[0])},${r6(A[1])}],[${r6(B[0])},${r6(B[1])}]],\n`;
    js += `      lanes: [\n        ${lanesLL.map((l) => `[${l.map((p) => `[${p[0]},${p[1]}]`).join(',')}]`).join(',\n        ')}\n      ] },\n`;
  }
  js += `  },\n`;
}
js += '};\n';
const dest = new URL('../public/js/venueLanes.js', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
writeFileSync(dest, js, 'utf8');
log('\nwrote', dest, (js.length / 1024).toFixed(1) + ' KB');
