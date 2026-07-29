// ============ 預設場地兵線離線預算 ============
// 用法:node tools/bake_venue_lanes.mjs   (ONLY=taipei101,seoul 可只跑指定場地)
// 產出 public/js/venueLanes.js。改 ANCHORS 或 MAPGEO 的尺寸/重合率常數後 MUST 重跑。
// Overpass 真實道路路網 → 建圖 → 每條兵線 = 一條「邊不相交」的最短路徑(全程踩在現實道路上)
// → 用 overlapCellM(L) 驗重合率 ≤ MAX_OVERLAP、繞路 ≤ 2.2×、兩堡距離 ≥ 對角線 80%。
// 方位角挑選另偏好砲塔規則:#5 洞內砲塔 ≥20% 射程涵蓋洞口外(towerTunnelAudit)優先於
// #4 射程重疊殘餘(towerLayoutAudit)—— 塔埋在山體裡只能沿洞內走廊對射,是功能性缺陷。
import { writeFileSync, readFileSync, existsSync, mkdirSync } from 'node:fs';
import { MAPGEO, realDistFor, targetDistFor, overlapCellM, laneTacticsXZ, tacticalScore, towerLayoutAudit, towerTunnelAudit, laneSeparationAudit, laneUTurnAudit, laneTurnAccumAudit, laneStructEntryAudit }
  from '../public/js/data.js';
// 既有兵線:ONLY= 局部重烤時,沒烤到的場地要原樣寫回(見下方 keep)
import { VENUE_LANES } from '../public/js/venueLanes.js';

// 兵線 lat/lng → 遊戲公尺(中心相對;與 audit_map_rules / runtime 同一換算 ⇒ 烘焙期的規則判定與最終稽核一致)
const SC_GAME = 1 / MAPGEO.REAL_SCALE, EARTH_M = 6371000;
const llToGame = (lat, lng, c) => [
  (lng - c.lng) * Math.PI / 180 * EARTH_M * Math.cos(c.lat * Math.PI / 180) * SC_GAME,
  (lat - c.lat) * Math.PI / 180 * EARTH_M * SC_GAME,
];
// 寫出精度(六位小數 ≈ 0.1m):規則硬門檻與寫檔 MUST 用同一個捨入(見 tryBearing 分離閘)
const r6 = (v) => +v.toFixed(6);

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
  phoenix: [[33.4950, -112.1700]],                            // 西鳳凰城 Maryvale 索諾拉沙漠格柵(全 L 過稽核)
  hehuanshan: [[23.9650, 120.9670], [24.0577, 121.1614]],     // 埔里鎮 / 清境農場
  venice: [[45.4850, 12.2350], [45.4408, 12.3155]],           // Mestre(本島無車道)
  iguazu: [[-25.5990, -54.5735]],                             // Puerto Iguazú
  tamsui: [[25.1680, 121.4450], [25.1720, 121.4400]],         // 淡水市區
  okavango: [[-19.9833, 23.4167]],                            // Maun
  rio: [[-22.9700, -43.1850], [-22.9519, -43.2105]],
  // 金龍隧道西南口外(金龍路)/ 東北口外(金湖路)。L1 兩堡僅 ~481 真實公尺、隧道 ~195m:
  // 錨點 MUST 貼隧道軸且距洞口 ~130m,B 才不會被吸進隧道內部或繞上別的街廓
  jinlong: [[25.0838, 121.5846], [25.0873, 121.5895]],
  // ② 純陸域高架橋的候選(**尚未定案**,故 venues.js 暫不收):Park Avenue 高架繞中央車站,
  // 底下全是街道。三輪實測(夾方位角 / 放開方位角 / PREFER_BRIDGE 偏好)兵線最近只到高架旁 4m,
  // 沒真的踩上橋面 —— 曼哈頓格柵的等長替代路線太多,且高架與地面 Park Ave 是分離的 way。
  parkave: [[40.75005, -73.97940], [40.75500, -73.97530]],
  barcelona: [[41.3925, 2.1620], [41.3850, 2.1700]],          // 巴塞隆納 Eixample 格柵(臨地中海)
  london: [[51.5007, -0.1246]],
  // ② 地下道的測試場地:市民大道沿線的車行地下道群(L1 bbox 內圖資有 8 條 tunnel way,
  // 是掃到最密的一區)。兩個候選原點沿市民大道排開,實際選線由 PREFER_TUNNEL 決定。
  civicblvd: [[25.0470, 121.5180], [25.0492, 121.5232]],
  // ④ 明隧道的測試場地(2026-07-29 廣域探測選定):太魯閣峽谷 燕子口—錐麓段,台8線上
  // 三段短隧道幾乎整條是明隧道(探測 open 72m/54m/96m,中點 121.5547/121.5537/121.5509),
  // 彼此相距 ~400m,一條 L1 兵線可連穿多座。錨點 MUST 取探測回報的**路上座標**(峽谷路窄,
  // 憑地名下錨會落在崖壁上「120m 內無道路節點」);首錨 = 最東那段明隧道中點,往西烤。
  taroko: [[24.1712, 121.5547], [24.1712, 121.5560]],
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
  for (let a = 0; a < 6; a++) {
    const url = ENDPOINTS[a % ENDPOINTS.length];
    try {
      // Content-Type 必須明講:Node fetch 對字串 body 預設 text/plain,
      // Overpass 會把 "data=" 前綴當成查詢語法 → 406 Not Acceptable
      // signal:Node 的 fetch 沒有預設逾時,半死的連線會把整支烘焙掛住
      const resp = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: 'data=' + encodeURIComponent(q),
        signal: AbortSignal.timeout(60000),
      });
      if (!resp.ok) { log(`  overpass ${resp.status} @${new URL(url).host}, retry`); await sleep(3000 * (a + 1)); continue; }
      const d = await resp.json();
      const els = d.elements || [];
      writeFileSync(f, JSON.stringify(els));
      return els;
    } catch (e) { log('  overpass err', e.message); await sleep(3000 * (a + 1)); }
  }
  // 備援:OSM 官方 API 的 /map(2026-07-28)。Overpass 的公共鏡像對雲端 IP(CI runner /
  // 開發沙箱)常態拒絕,沒有備援就烤不出新場地。/map 走另一套基礎設施、回傳該 bbox 的原始
  // node/way,篩出 DRIVABLE 車行道後與 Overpass 回應同形(tags + geometry)。
  const els = await osmApiRoads(lat, lng, radius);
  if (els) { writeFileSync(f, JSON.stringify(els)); return els; }
  return null;
}

/** OSM 官方 /map 備援:回傳與 Overpass `out geom` 同形的 way 陣列(只留車行道) */
async function osmApiRoads(lat, lng, radius) {
  const dLat = radius / 111320, dLng = radius / (111320 * Math.cos(lat * d2r));
  const url = `https://api.openstreetmap.org/api/0.6/map?bbox=${(lng - dLng).toFixed(5)},${(lat - dLat).toFixed(5)},`
    + `${(lng + dLng).toFixed(5)},${(lat + dLat).toFixed(5)}`;
  const RE = new RegExp(`^(${DRIVABLE})$`);
  for (let a = 0; a < 3; a++) {
    try {
      const r = await fetch(url, { signal: AbortSignal.timeout(90000) });
      if (!r.ok) { log(`  osm-api ${r.status}, retry`); await sleep(3000 * (a + 1)); continue; }
      const xml = await r.text();
      const nodes = new Map();
      const attr = (s2, k) => { const m = new RegExp(`${k}="([^"]*)"`).exec(s2); return m ? m[1] : null; };
      for (const m of xml.matchAll(/<node\s([^>]*?)(\/>|>[\s\S]*?<\/node>)/g)) {
        const id2 = attr(m[1], 'id'), la = +attr(m[1], 'lat'), lo = +attr(m[1], 'lon');
        if (id2 && Number.isFinite(la)) nodes.set(id2, { lat: la, lon: lo });
      }
      const out = [];
      for (const m of xml.matchAll(/<way\s([^>]*?)>([\s\S]*?)<\/way>/g)) {
        const body = m[2], tags = {};
        for (const t of body.matchAll(/<tag k="([^"]*)" v="([^"]*)"\s*\/>/g)) tags[t[1]] = t[2];
        if (!RE.test(tags.highway || '')) continue;
        const geometry = [];
        for (const n of body.matchAll(/<nd ref="(\d+)"\s*\/>/g)) {
          const p = nodes.get(n[1]);
          if (p) geometry.push({ lat: p.lat, lon: p.lon });
        }
        if (geometry.length >= 2) out.push({ type: 'way', tags, geometry });
      }
      log(`  osm-api 備援取得 ${out.length} 條車行道`);
      return out.length ? out : null;
    } catch (e) { log('  osm-api err', e.message); await sleep(3000 * (a + 1)); }
  }
  return null;
}

// ---- 數值索引路網圖 ----
function buildGraph(ways, origin) {
  const idx = new Map();          // "lat,lng" -> i
  const X = [], Z = [], LA = [], LN = [], adj = [];
  const tunE = new Set();         // 隧道邊 "u:v"(雙向都記):規則 #5 選線判定用
  const brgE = new Set();         // 橋樑邊(同上):PREFER_BRIDGE 場地的選線偏好用
  const portalN = new Set();      // 橋/隧 way 的端點節點 = 出入口(portal):規則「只能從出入口進出」
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
    const tun = !!w.tags?.tunnel;
    const brg = !!w.tags?.bridge && !tun;
    for (let i = 1; i < w.geometry.length; i++) {
      const a = w.geometry[i - 1], b = w.geometry[i];
      const u = nid(a.lat, a.lon), v = nid(b.lat, b.lon);
      if (u === v) continue;
      const len = Math.hypot(X[u] - X[v], Z[u] - Z[v]);
      adj[u].push(v, len);        // 扁平化:[v0,len0, v1,len1, …]
      adj[v].push(u, len);
      if (tun) { tunE.add(`${u}:${v}`); tunE.add(`${v}:${u}`); }
      if (brg) { brgE.add(`${u}:${v}`); brgE.add(`${v}:${u}`); }
    }
    // 結構 way 的頭尾幾何節點 = 出入口(portal):真實匝道/洞口只接在結構兩端,
    // way 中間節點若被兵線側切上/下橋 = 「從側邊出入」(規則禁止,見 laneStructEntryAudit)。
    if (tun || brg) {
      const g0 = w.geometry[0], gN = w.geometry[w.geometry.length - 1];
      portalN.add(nid(g0.lat, g0.lon));
      portalN.add(nid(gN.lat, gN.lon));
    }
  }
  return { X, Z, LA, LN, adj, n: X.length, tunE, brgE, portalN };
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

// ---- 規則 #5 輸入:完整節點路徑上的 tunnel 邊 → 簡化兵線(遊戲公尺)上的弧長區間 ----
// 兵線頂點經 Douglas-Peucker 簡化過,隧道端點未必留在頂點上 ⇒ 投影取弧長。
// 相鄰段 ≤ SPAN_GAP 縫成同一座洞(雙孔/分段 way);同 tools/audit_lane_grade_sep.mjs。
const SPAN_GAP = 36;
function tunSpansOf(g, full, gpts, cc) {
  const cum = [0];
  for (let i = 1; i < gpts.length; i++) cum.push(cum[i - 1] + Math.hypot(gpts[i][0] - gpts[i - 1][0], gpts[i][1] - gpts[i - 1][1]));
  const arcOf = (i) => {
    const [px, py] = llToGame(g.LA[i], g.LN[i], cc);
    let best = Infinity, bs = 0;
    for (let k = 1; k < gpts.length; k++) {
      const [ax, ay] = gpts[k - 1], [bx, by] = gpts[k];
      const ex = bx - ax, ey = by - ay, L2 = ex * ex + ey * ey || 1;
      let t = ((px - ax) * ex + (py - ay) * ey) / L2;
      t = t < 0 ? 0 : t > 1 ? 1 : t;
      const d = Math.hypot(px - (ax + ex * t), py - (ay + ey * t));
      if (d < best) { best = d; bs = cum[k - 1] + t * Math.hypot(ex, ey); }
    }
    return bs;
  };
  const raw = [];
  let cur = null;
  for (let i = 1; i < full.length; i++) {
    if (g.tunE.has(`${full[i - 1]}:${full[i]}`)) {
      const sa = arcOf(full[i - 1]), sb = arcOf(full[i]);
      const lo = Math.min(sa, sb), hi = Math.max(sa, sb);
      if (!cur) cur = [lo, hi];
      else { cur[0] = Math.min(cur[0], lo); cur[1] = Math.max(cur[1], hi); }
    } else if (cur) { raw.push(cur); cur = null; }
  }
  if (cur) raw.push(cur);
  const out = [];
  for (const s of raw.sort((p, q) => p[0] - q[0])) {
    const last = out[out.length - 1];
    if (last && s[0] - last[1] <= SPAN_GAP) last[1] = Math.max(last[1], s[1]);
    else out.push([...s]);
  }
  return out;
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

// 指定場地限定方位角扇區(度,[起, 迄] 順時針含跨 0°;**逐錨點**一份扇區清單):
// 兵線軸向必須對準特定地標才有測試意義(如 jinlong:兩錨沿隧道軸對向,兵線才會穿
// 金龍隧道山體;全向暴搜會挑分數更高的街廓方位,兵線就繞開隧道了)。未列場地 = 全向。
// 這些場地是「兵線要踩上高架橋」的測試場地 ⇒ 選線時先比「踩在橋上的長度」,再走原本的排序。
// 一般場地不受影響(集合外的 id 完全走舊路徑)。
const PREFER_BRIDGE = new Set(['parkave']);
// 同理:「兵線要走進地下道」的測試場地 ⇒ 先比「踩在 tunnel way 上的長度」。
// 註:平地地下道現行引擎不生成(見 docs/lane_scenarios.md),這裡挑的是**圖資上**的地下道段,
// 供引擎支援下沉剖面後直接成立;現在開這張圖看到的是一般街道。
const PREFER_TUNNEL = new Set(['civicblvd', 'taroko']);
const BEARING_SECTORS = {
  jinlong: [[[30, 80]], [[210, 260]]],   // 西南錨(金龍路)→東北;東北錨(金湖路)→西南(隧道軸 ~56°)
  // taroko 兩錨都夾往西:東側是 656m 的靳珩隧道,PREFER_TUNNEL 不夾會整條兵線鑽進長隧道
  // (洞內塔違規 ×3、明隧道只沾 36m);往西才是三段「幾乎整條明隧道」的短洞群
  taroko: [[[235, 300]], [[235, 300]]],
  // parkave 不夾方位角:改由 PREFER_BRIDGE 的「踩在橋上長度」自己挑(夾了反而把能上橋的
  // 方位角排除掉 —— 實測夾 195~235° 時兵線只擦過高架 4m,沒真的走上去)。
};
const inSector = (br, [a, b]) => ((br - a + 360) % 360) <= ((b - a + 360) % 360);

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
    // 折返閘門(同 mapSelect / MAPGEO.MAX_BACKTRACK):prog 已正規化為 A→B 進度,
    // 累加進度倒退段 = 往主堡折返比例;超標淘汰(側翼 via 導引偶會把路徑吸回起點)
    let back = 0, pr = prog(p[0]);
    for (let k = 1; k < p.length; k++) { const pg = prog(p[k]); if (pg < pr) back += pr - pg; pr = pg; }
    if (back > MAPGEO.MAX_BACKTRACK) { why = 'backtrack'; return null; }
    // 規則(2026-07-28):橋/隧只能從出入口(結構 way 端點 portalN)進出,不可從側邊上/下橋。
    // struc 對齊節點路徑 p:段 k 連 p[k−1]→p[k];portal = p[i] 是否為結構端點(見 laneStructEntryAudit)。
    const struc = new Array(p.length);
    struc[0] = false;
    for (let k = 1; k < p.length; k++) struc[k] = g.tunE.has(`${p[k - 1]}:${p[k]}`) || g.brgE.has(`${p[k - 1]}:${p[k]}`);
    if (!laneStructEntryAudit(struc, p.map((nd) => g.portalN.has(nd))).ok) { why = 'sideEntry'; return null; }
    const all = p.map((i) => [X[i], Z[i]]);
    const keep = simplifyIdx(all, 3);
    const idx = keep.map((k) => p[k]);                        // 簡化後仍全是 OSM 道路節點
    const xz = keep.map((k) => all[k]);
    // 規則(2026-07-28):兵線不可接近 180° 迴轉(側翼 via / REUSE 重罰偶會逼出上橋再折回式掉頭)。
    // xz 是真實公尺(buildGraph 用地球半徑),laneUTurnAudit 的 SEG_M 取樣與 laneTacticsXZ 同在
    // 遊戲公尺語意下 ⇒ 換算後再判(× 1/REAL_SCALE;此處在 s 宣告前被呼叫,不能用 s,直接取 MAPGEO)。
    const gs = 1 / MAPGEO.REAL_SCALE;
    const gxz = xz.map(([x, z]) => [x * gs, z * gs]);
    if (!laneUTurnAudit(gxz).ok) { why = 'uturn'; return null; }
    // 規則③(2026-07-29):相對 A→B 主軸的帶號偏航累積 MUST 落在 ±TURN_ACCUM_MAX_DEG 內
    // (順逆時針抵消;背對主軸走/繞圈在此淘汰)。與迴轉閘同一組遊戲公尺取樣語彙。
    if (!laneTurnAccumAudit(gxz).ok) { why = 'turnAccum'; return null; }
    banPath(used, p, n);                                      // 過閘後才標記已用邊(下一條被 REUSE_PEN 重罰)
    let s = 0;
    for (const q of idx) s += lat(q);
    return { xz, idx, full: p, lat: s / idx.length };   // full = 未簡化節點路徑(規則 #5 取隧道邊用)
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
  // 兵線互不接觸/交叉硬門檻(全禁,含立體交叉;與 mapSelect / server / audit_lane_sep 同一支)。
  // MUST 判「寫出後」的幾何:六位小數捨入 lat/lng → llToGame(origin = 捨入後 bases[0],
  // 與 audit_lane_sep 逐式相同)。圖平面座標(未捨入)在扇出帶的公分級貼近會與寫出幾何
  // 不同判 —— 捨入讓兩線換邊變成交叉(2026-07-29 barcelona L3 實案:bake 閘綠、離線稽核紅
  // → runner 拒絕提交)。判寫出幾何 = 兩端永遠同判(原則 3)。
  const wr6 = (i) => [r6(g.LA[i]), r6(g.LN[i])];
  const oW = wr6(aIdx);
  const lanesWritten = lanes.map((l) => l.idx.map((i) => {
    const [la, ln] = wr6(i);
    return llToGame(la, ln, { lat: oW[0], lng: oW[1] });
  }));
  if (!laneSeparationAudit(lanesWritten).ok) return { fail: 'touch' };
  let sinu = 0, tpk = 0;
  for (const l of lanes) { const t = laneTacticsXZ(l.xz.map(([x, z]) => [x * s, z * s])); sinu += t.sinuosity; tpk += t.turnsPerKm; }
  sinu /= L; tpk /= L;
  // 砲塔規則合規(規則 #4):跑與 runtime 同一換算的 towerLayoutAudit ⇒ 選址時就偏好「砲塔佈局合規」的方位
  const A = [g.LA[aIdx], g.LN[aIdx]], B = [g.LA[bIdx], g.LN[bIdx]];
  const cc = { lat: (A[0] + B[0]) / 2, lng: (A[1] + B[1]) / 2 };
  const lanesGame = lanes.map((l) => l.idx.map((i) => llToGame(g.LA[i], g.LN[i], cc)));
  const ta = towerLayoutAudit(lanesGame);
  // 砲塔洞口規則(規則 #5):兵線穿隧道時,埋在洞內的砲塔 MUST 有 ≥TOWER_TUNNEL_OUT_F 射程涵蓋洞口外。
  // 隧道段取圖資 tunnel way 全長(上界;執行期只有地形蓋得住的段落才成洞)⇒ 選線期寧可保守。
  const tt = towerTunnelAudit(lanesGame, lanes.map((l, li) => tunSpansOf(g, l.full, lanesGame[li], cc)));
  // 兵線實際踩在橋樑邊上的長度(遊戲公尺):PREFER_BRIDGE 場地用它當首要偏好 ——
  // 「純陸域高架橋」的測試場地要的就是兵線真的走在橋面上,一般的戰術評分不會特意去挑高架。
  let brgLen = 0, tunLen = 0;
  for (const l of lanes) {
    for (let i = 1; i < l.full.length; i++) {
      const u = l.full[i - 1], v = l.full[i];
      const seg = Math.hypot(g.X[u] - g.X[v], g.Z[u] - g.Z[v]) * s;
      if (g.brgE?.has(`${u}:${v}`)) brgLen += seg;
      if (g.tunE?.has(`${u}:${v}`)) tunLen += seg;
    }
  }
  return {
    bearing, aIdx, bIdx, lanes, brgLen, tunLen,
    maxOverlap: mo, sinuosity: sinu, turnsPerKm: tpk,
    resid: ta.residual + (ta.stackBad ? 1000 : 0),   // 疊塔視為重罰(絕不選)
    tunBad: tt.bad.length,                           // 規則 #5 違規塔數(0 = 合規)
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
      const sectors = BEARING_SECTORS[id]?.[anchors.indexOf(anchor)];
      for (let i = 0; i < 72; i++) {
        if (sectors && !sectors.some((s) => inSector(i * 5, s))) continue;
        for (const off of OFFSET_FRACS) {
          const r = tryBearing(g, aIdx, i * 5, L, off);
          if (r?.fail) { why[r.fail] = (why[r.fail] || 0) + 1; if (r.ov != null) bestOv = Math.min(bestOv, r.ov); continue; }
          // 詞典序:先「規則 #5 洞內砲塔違規少」(塔埋在山體裡只能沿洞內走廊對射 = 功能性缺陷,
          // 比 #4 的重疊殘餘嚴重)、再「規則 #4 殘餘少」、同分才取戰術評分高。
          // 兩者皆是**偏好非硬門檻**:全方位皆不合規時仍取最小者(不放棄該 L,行為等同舊版最佳努力)。
          // 無隧道的場地 tunBad 恆 0 ⇒ 排序退化為舊版,選線結果不動。
          if (r && PREFER_TUNNEL.has(id)
            && (!best || r.tunLen > best.tunLen + 1
              || (Math.abs(r.tunLen - best.tunLen) <= 1 && (r.tunBad < best.tunBad
                || (r.tunBad === best.tunBad && (r.resid < best.resid
                  || (r.resid === best.resid && r.score > best.score))))))) { best = r; continue; }
          if (r && PREFER_BRIDGE.has(id)
            && (!best || r.brgLen > best.brgLen + 1
              || (Math.abs(r.brgLen - best.brgLen) <= 1 && (r.tunBad < best.tunBad
                || (r.tunBad === best.tunBad && (r.resid < best.resid
                  || (r.resid === best.resid && r.score > best.score))))))) { best = r; continue; }
          if (r && !PREFER_BRIDGE.has(id) && !PREFER_TUNNEL.has(id) && (!best || r.tunBad < best.tunBad
            || (r.tunBad === best.tunBad && (r.resid < best.resid
              || (r.resid === best.resid && r.score > best.score))))) best = r;
          // ↑ 一般場地的排序(規則 #5 → 規則 #4 → 戰術評分)不動
        }
      }
      if (!best) {
        // 逐 L 獨立:這個 L 湊不出真實道路兵線 → venueConfig 對它退回 synthLane
        log(`  L=${L} ✗ 無可行方位角 reasons=${JSON.stringify(why)}${bestOv < 9 ? ` bestOv=${bestOv.toFixed(3)}` : ''}`);
        continue;
      }
      byL[L] = { g, ...best };
      log(`  L=${L} ✓ br=${best.bearing}° ov=${best.maxOverlap.toFixed(3)} sinu=${best.sinuosity.toFixed(2)} resid=${best.resid}` +
        (best.tunBad ? ` ⚠️洞內塔違規=${best.tunBad}` : ''));
    }
    const hits = Object.keys(byL).length;
    if (!hits) continue;
    // 取錨點:先「規則 #4/#5 合規的 L 數」最多,再「真實道路可用 L 數」最多;同分取先列者。
    const conf = Object.values(byL).filter((b) => b.resid === 0 && b.tunBad === 0).length;
    if (!picked || conf > picked.conf || (conf === picked.conf && hits > Object.keys(picked.byL).length)) {
      picked = { anchor, byL, ways: ways.length, g, conf };
    }
    if (hits === 3 && conf === 3) break;   // 完美(全 L 真實道路且全合規)才提前收手
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

let js = `// ============ 預設場地兵線(離線預算,勿手改)============
// 由 tools/bake_venue_lanes.mjs 產生:Overpass 真實道路路網 → 邊不相交最短路徑。
// 每條兵線的每個頂點都是 OSM 道路節點 ⇒ NPC 引導路線 100% 與現實導航路線相符。
// 通過的規則(與互動式選址流程相同):兩堡距離 ≥ 對角線 ${MAPGEO.MIN_DIST_FRAC * 100}%、
// 任兩線重合率 ≤ ${MAPGEO.MAX_OVERLAP}(判定網格 overlapCellM(L))、單線繞路 ≤ 2.2×直線距離、
// 任兩線互不接觸/交叉(排除主堡扇出段,中段最近距離 ≥ ${MAPGEO.LANE_MIN_SEP_M} 遊戲公尺,含立體交叉亦禁)。
// bases[0] = SWARM(錨點側)、bases[1] = STEEL;lanes 依側向排序 [上, 中, 下]。
export const VENUE_LANES = {\n`;
// ONLY= 只烤指定場地時,**其餘場地的既有兵線 MUST 原樣保留** —— 這支一律重寫整份
// venueLanes.js,少了這段就會把沒烤到的場地整批清空(2026-07-28 實測:ONLY=parkave
// 之後其餘 22 個場地全數退回 synthLane 合成弧,場景掃描結果整個變樣)。
const keep = ONLY.length ? Object.entries(VENUE_LANES).filter(([id]) => !(id in ANCHORS)) : [];
for (const [id, byL] of keep) {
  js += `  ${id}: {\n`;
  for (const L of [1, 2, 3]) {
    const e = byL[L];
    if (!e) continue;
    js += `    ${L}: { bearing: ${e.bearing}, maxOverlap: ${e.maxOverlap},\n`;
    js += `      bases: [[${e.bases[0][0]},${e.bases[0][1]}],[${e.bases[1][0]},${e.bases[1][1]}]],\n`;
    js += `      lanes: [\n        ${e.lanes.map((l) => `[${l.map((p) => `[${p[0]},${p[1]}]`).join(',')}]`).join(',\n        ')}\n      ] },\n`;
  }
  js += `  },\n`;
}
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
