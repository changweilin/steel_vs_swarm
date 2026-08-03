// ============ 離線工具共用:場地高度場 / 圖資 / 結構剖面(Node 端唯一縫)============
// 用途:讓**不需要瀏覽器**的稽核也能拿到「與執行期同形」的地形與結構 —— 高程網格、
// OSM 路網、隧道/地下道路面剖面、橋面剖面。原本這一整套住在 `audit_lane_scenarios.mjs`
// 裡面,2026-08-03 抽成本檔:`audit_traverse.mjs`(兵線可通行)與淨空檢查都要同一份。
//
// **為什麼是抽原文而不是 import**:`terrain.js` / `biomes.js` 的 three 走 CDN importmap,
// Node 端載不進來(A2 也不准把 three 寫進 package.json)。抄一份公式進工具則永遠會通過 ——
// 公式改了工具照舊全綠。故:
//   ① 換算/高度管線是 `terrain.js buildTerrain` 的**逐字鏡射**(純幾何,無 three);
//   ② 結構判定與剖面(tunnelCoverIntervals / tunFloorAt / underpassPlan / tunnelWallProfile /
//      deckAt)一律用 `new Function` **執行 biomes.js 的原文**,常數也從原文解析 ——
//      改了 biomes.js,這裡跟著改,不會分家。
// 消費端 MUST 走這一支,MUST NOT 自己再抄一份高度管線或結構剖面(第三份必定漂)。
//
// 網路:第一次跑會抓 terrarium 高程磚與 OSM 圖資,結果寫進 `tools/.scen_cache/`
// (之後純離線可重跑)。快取檔名沿用舊版 ⇒ 既有快取直接續用。
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { inflateSync } from 'node:zlib';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { MAPGEO, TERRAIN, WATER, GAME, LOS, solveTowerSites } from '../public/js/data.js';

export const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
export const CACHE = join(ROOT, 'tools', '.scen_cache');
if (!existsSync(CACHE)) mkdirSync(CACHE, { recursive: true });

export const R_EARTH = 6371000;
export const d2r = (d) => d * Math.PI / 180;
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---- 與 terrain.js 同一組換算(該檔 import three ⇒ Node 端載不進來,逐字照抄)----
export const WORLD_S = 1 / MAPGEO.REAL_SCALE;
export const llToWorld = (lat, lng, center) => [
  (lng - center.lng) * Math.PI / 180 * R_EARTH * Math.cos(d2r(center.lat)) * WORLD_S,
  -((lat - center.lat) * Math.PI / 180 * R_EARTH * WORLD_S),
];
const lon2tx = (lon, z) => (lon + 180) / 360 * 2 ** z;
const lat2ty = (lat, z) => (1 - Math.log(Math.tan(d2r(lat)) + 1 / Math.cos(d2r(lat))) / Math.PI) / 2 * 2 ** z;
export const smooth01 = (t) => { t = t < 0 ? 0 : t > 1 ? 1 : t; return t * t * (3 - 2 * t); };
export function distToSegs(px, pz, segs) {
  let min = Infinity;
  for (const [x1, z1, x2, z2] of segs) {
    const dx = x2 - x1, dz = z2 - z1, l2 = dx * dx + dz * dz;
    let t = l2 ? ((px - x1) * dx + (pz - z1) * dz) / l2 : 0;
    t = t < 0 ? 0 : t > 1 ? 1 : t;
    const d = Math.hypot(px - (x1 + t * dx), pz - (z1 + t * dz));
    if (d < min) min = d;
  }
  return min;
}

// ---- biomes.js 的結構常數與函式原文(單一真相縫;抽原文不重寫公式)----
const bsrc = readFileSync(join(ROOT, 'public', 'js', 'biomes.js'), 'utf8').replace(/\r\n?/g, '\n');
function pickConst(name, fallbackMap = {}) {
  const m = new RegExp(`const ${name} = \\{([\\s\\S]*?)\\};`).exec(bsrc);
  if (!m) throw new Error(`biomes.js 找不到 ${name}`);
  return Object.fromEntries(m[1].replace(/\/\/.*$/gm, '').split(',').map((s) => s.trim()).filter(Boolean)
    .map((s) => { const [k, v] = s.split(':').map((t) => t.trim()); return [k, k in fallbackMap ? fallbackMap[k] : +v]; }));
}
export const TUN = pickConst('TUN', { CLEAR: LOS.TUN_CLEAR_M });   // TUN.CLEAR 的單一縫住 data.js
export const UND = pickConst('UND');
export const ROAD_W = pickConst('ROAD_W');
export const PASS_W = +/const PASS_W = (\d+)/.exec(bsrc)[1];
export const ROAD_SEG = +/const ROAD_SEG = (\d+)/.exec(bsrc)[1];
export const BRIDGE_RISE = +/const BRIDGE_RISE = ([\d.]+)/.exec(bsrc)[1];
const TUN_GAP_CLOSE = +/const TUN_GAP_CLOSE = (\d+)/.exec(bsrc)[1];
const TUN_COV_MIN = +/TUN_COV_MIN = (\d+)/.exec(bsrc)[1];
{ // 常數解析防呆:任一沒解出來就整支停(比後面默默算錯好)
  const bad = Object.entries({ ...TUN, PASS_W, ROAD_SEG, BRIDGE_RISE, TUN_GAP_CLOSE, TUN_COV_MIN })
    .filter(([, v]) => !Number.isFinite(v)).map(([k]) => k);
  if (bad.length) throw new Error(`biomes.js 常數解析失敗:${bad.join(',')}`);
}
const evalBlock = (from, fnName, extra = {}) => {
  const P0 = bsrc.indexOf(from);
  const P1 = bsrc.indexOf('\n}', bsrc.indexOf(`function ${fnName}(`)) + 2;
  if (P0 < 0 || P1 <= P0) throw new Error(`biomes.js 找不到 ${fnName} 區塊`);
  const keys = Object.keys(extra);
  return new Function('TUN', ...keys, `${bsrc.slice(P0, P1)}\nreturn ${fnName};`)(TUN, ...keys.map((k) => extra[k]));
};
export const tunnelCoverIntervals = evalBlock('function tunnelCoverIntervals(', 'tunnelCoverIntervals',
  { TUN_GAP_CLOSE, TUN_COV_MIN });
export const tunnelWallProfile = evalBlock('const TUN_WALL_SAMP', 'tunnelWallProfile');
export const densify = evalBlock('function densify(', 'densify');
// 隧道/地下道路面高(biomes.js 的**單一縫**;carve / buildRoads / 走廊淨空都吃它)
export const tunFloorAt = evalBlock('function tunFloorAt(', 'tunFloorAt');
// 地下道規劃(平坦 tunnel way 的下沉剖面)—— 與遊戲同一份原文
export const underpassPlan = evalBlock('const UND = {', 'underpassPlan',
  { ROAD_SEG, WATER, densify, tunnelCoverIntervals });
// 結構隧道資格 —— 與遊戲同一份原文(人行/室內 tunnel way 不進結構管線 ⇒ 不成洞;
// 2026-07-29 澀谷側壁破口案)。判定與候選診斷 MUST 同吃這個閘,否則稽核比執行期多洞。
export const PED_HW = new Function(`return ${/const PED_HW = (\/[^\n]+\/);/.exec(bsrc)[1]};`)();
export const strucTunnel = (() => {
  const m = /const strucTunnel = \(tags\) =>[\s\S]*?;\n/.exec(bsrc);
  if (!m) throw new Error('biomes.js 找不到 strucTunnel');
  return new Function('PED_HW', `${m[0]}return strucTunnel;`)(PED_HW);
})();
export const roadWidth = (tags) => {
  const base = ROAD_W[tags.highway] || 4;
  const lanes = parseInt(tags.lanes, 10) || 0;
  return lanes ? Math.max(base, lanes * 3.2) : base;
};
/** 結構通行半寬(= biomes.buildRoads 的 hw:橋/結構隧道一律夾到 PASS_W/2 以上) */
export const strucHw = (tags) => Math.max(roadWidth(tags) / 2, PASS_W / 2);

/**
 * 橋面剖面工廠(**執行 biomes.js `deckAt` 的原文**;閉包變數由外面餵)。
 * 回傳 `(s, gx, gz) => 橋面高`,與遊戲內同一條 smoothstep 端點緩坡 + 水面下限。
 * @param hA/hB 橋 run 兩端的地表高  @param total run 弧長  @param heightAt 地形取樣
 */
const DECK_SRC = (() => {
  const m = /const deckAt = \(s, gx, gz\) => \{[\s\S]*?\n      \};\n/.exec(bsrc);
  if (!m) throw new Error('biomes.js 找不到 deckAt');
  return m[0];
})();
const ROAD_LIFT = +/const ROAD_LIFT = ([\d.]+)/.exec(bsrc)[1];
export function makeDeckAt(hA, hB, total, heightAt) {
  return new Function('hA', 'hB', 'total', 'terrain', 'BRIDGE_RISE', 'ROAD_LIFT', 'WATER',
    `${DECK_SRC}\nreturn deckAt;`)(hA, hB, total, { heightAt }, BRIDGE_RISE, ROAD_LIFT, WATER);
}

// ---- 極簡 PNG 解碼(terrarium 磚;A2:MUST NOT 新增 npm 依賴 ⇒ 只用 node:zlib)----
function decodePng(buf) {
  if (buf.readUInt32BE(0) !== 0x89504e47) throw new Error('不是 PNG');
  let p = 8, w = 0, h = 0, bitDepth = 0, colorType = 0;
  const idat = [];
  while (p < buf.length) {
    const len = buf.readUInt32BE(p), type = buf.toString('latin1', p + 4, p + 8);
    const body = buf.subarray(p + 8, p + 8 + len);
    if (type === 'IHDR') {
      w = body.readUInt32BE(0); h = body.readUInt32BE(4);
      bitDepth = body[8]; colorType = body[9];
      if (bitDepth !== 8 || (colorType !== 2 && colorType !== 6)) throw new Error(`不支援的 PNG 格式 ${bitDepth}/${colorType}`);
    } else if (type === 'IDAT') idat.push(body);
    else if (type === 'IEND') break;
    p += 12 + len;
  }
  const bpp = colorType === 6 ? 4 : 3;
  const raw = inflateSync(Buffer.concat(idat));
  const out = Buffer.alloc(w * h * bpp);
  const stride = w * bpp;
  for (let y = 0; y < h; y++) {
    const ft = raw[y * (stride + 1)];
    const line = raw.subarray(y * (stride + 1) + 1, y * (stride + 1) + 1 + stride);
    const cur = out.subarray(y * stride, (y + 1) * stride);
    const prev = y ? out.subarray((y - 1) * stride, y * stride) : null;
    for (let i = 0; i < stride; i++) {
      const a = i >= bpp ? cur[i - bpp] : 0, b = prev ? prev[i] : 0, c = (prev && i >= bpp) ? prev[i - bpp] : 0;
      let v = line[i];
      if (ft === 1) v += a;
      else if (ft === 2) v += b;
      else if (ft === 3) v += (a + b) >> 1;
      else if (ft === 4) {                       // Paeth
        const q = a + b - c, pa = Math.abs(q - a), pb = Math.abs(q - b), pc = Math.abs(q - c);
        v += (pa <= pb && pa <= pc) ? a : (pb <= pc ? b : c);
      }
      cur[i] = v & 0xff;
    }
  }
  return { w, h, bpp, data: out };
}

// Overpass / OSM API 對「沒有 User-Agent 的請求」一律拒絕(406 / 429)—— 這支是 Node 端 fetch,
// 不補就等於整個工具在開發機上永遠「取不到路網」(2026-08-01 實測;瀏覽器自己會帶所以只有這裡要補)。
const OSM_UA = 'steel-vs-swarm-lane-scenario-audit/1.0 (offline map audit)';

async function getBuf(url, tries = 4) {
  for (let a = 0; a < tries; a++) {
    try {
      const r = await fetch(url, { headers: { 'User-Agent': OSM_UA }, signal: AbortSignal.timeout(30000) });
      if (r.ok) return Buffer.from(await r.arrayBuffer());
    } catch { /* 重試 */ }
    await sleep(800 * (a + 1));
  }
  return null;
}

/** terrarium 高程取樣器(lat,lng → 公尺);磚快取在 .scen_cache/tile_z_x_y.png */
export async function elevSampler(bbox) {
  const z = TERRAIN.ELEV_ZOOM;
  const tx0 = Math.floor(lon2tx(bbox.minLng, z)), tx1 = Math.floor(lon2tx(bbox.maxLng, z));
  const ty0 = Math.floor(lat2ty(bbox.maxLat, z)), ty1 = Math.floor(lat2ty(bbox.minLat, z));
  const cols = tx1 - tx0 + 1, rows = ty1 - ty0 + 1;
  const W = cols * 256, H = rows * 256;
  const px = new Float32Array(W * H);
  for (let cy = 0; cy < rows; cy++) {
    for (let cx = 0; cx < cols; cx++) {
      const f = join(CACHE, `tile_${z}_${tx0 + cx}_${ty0 + cy}.png`);
      let buf = existsSync(f) ? readFileSync(f) : null;
      if (!buf) {
        buf = await getBuf(`https://s3.amazonaws.com/elevation-tiles-prod/terrarium/${z}/${tx0 + cx}/${ty0 + cy}.png`);
        if (!buf) return null;
        writeFileSync(f, buf);
      }
      const img = decodePng(buf);
      for (let y = 0; y < 256; y++) {
        for (let x = 0; x < 256; x++) {
          const k = (y * img.w + x) * img.bpp;
          px[(cy * 256 + y) * W + cx * 256 + x] = img.data[k] * 256 + img.data[k + 1] + img.data[k + 2] / 256 - 32768;
        }
      }
    }
  }
  return (lat, lng) => {                          // 雙線性(與 terrain.js fetchElevTerrarium 同式)
    const fx0 = (lon2tx(lng, z) - tx0) * 256, fy0 = (lat2ty(lat, z) - ty0) * 256;
    const x0 = Math.max(0, Math.min(W - 2, Math.floor(fx0))), y0 = Math.max(0, Math.min(H - 2, Math.floor(fy0)));
    const fx = fx0 - x0, fy = fy0 - y0;
    const at = (xx, yy) => px[yy * W + xx];
    return at(x0, y0) * (1 - fx) * (1 - fy) + at(x0 + 1, y0) * fx * (1 - fy)
         + at(x0, y0 + 1) * (1 - fx) * fy + at(x0 + 1, y0 + 1) * fx * fy;
  };
}

/**
 * 地形高度場(鏡射 terrain.js buildTerrain 的高度管線):
 * 原始高程網格 → 3×3 平滑 → 兵線外 AMP 放大(市區衰減)→ 塔位乾地帶抬升 → 三角化一致的取樣。
 * 純渲染的部分(貼圖/水面盤/幾何)不做。
 */
export function buildHeightField(cfg, bbox, sampleElev) {
  const N = TERRAIN.GRID_N, center = cfg.center;
  const [minX, maxZs] = llToWorld(bbox.minLat, bbox.minLng, center);
  const [maxX, minZs] = llToWorld(bbox.maxLat, bbox.maxLng, center);
  const minZ = Math.min(minZs, maxZs), maxZ = Math.max(minZs, maxZs);
  const heights = new Float32Array(N * N);
  for (let i = 0; i < N; i++) {
    const lat = bbox.maxLat + (bbox.minLat - bbox.maxLat) * i / (N - 1);
    for (let j = 0; j < N; j++) {
      const lng = bbox.minLng + (bbox.maxLng - bbox.minLng) * j / (N - 1);
      const h = sampleElev(lat, lng);
      heights[i * N + j] = Number.isFinite(h) ? h : 0;
    }
  }
  const sm = new Float32Array(heights);
  for (let i = 1; i < N - 1; i++) {
    for (let j = 1; j < N - 1; j++) {
      let s = 0;
      for (let di = -1; di <= 1; di++) for (let dj = -1; dj <= 1; dj++) s += heights[(i + di) * N + j + dj];
      sm[i * N + j] = s / 9;
    }
  }
  heights.set(sm);
  const segs = [];
  for (const lane of (cfg.lanes || [])) {
    let prev = null;
    for (const [lat, lng] of lane) {
      const p = llToWorld(lat, lng, center);
      if (prev) segs.push([prev[0], prev[1], p[0], p[1]]);
      prev = p;
    }
  }
  const amp = TERRAIN.AMP * (1 - Math.min(1, cfg.venue?.mix?.urban || 0) * TERRAIN.AMP_URBAN_F);
  if (segs.length) {
    let meanH = 0;
    for (let k = 0; k < N * N; k++) meanH += heights[k];
    meanH /= N * N;
    const bases = ['SWARM', 'STEEL'].map((s) => llToWorld(cfg.bases[s][0], cfg.bases[s][1], center));
    const R0 = TERRAIN.AMP_R0, R1 = TERRAIN.AMP_R1, BR = GAME.HERO_HEAL_RADIUS;
    for (let i = 0; i < N; i++) {
      const z = minZ + (maxZ - minZ) * i / (N - 1);
      for (let j = 0; j < N; j++) {
        const x = minX + (maxX - minX) * j / (N - 1);
        let f = smooth01((distToSegs(x, z, segs) - R0) / (R1 - R0));
        let db = Infinity;
        for (const [bx, bz] of bases) db = Math.min(db, Math.hypot(x - bx, z - bz));
        if (db < BR) f *= smooth01((db - BR * 0.4) / (BR * 0.6));
        if (f > 0) heights[i * N + j] += (heights[i * N + j] - meanH) * amp * f;
      }
    }
  }
  {   // 兵線砲塔外接寬度內強制乾地(terrain.js 同段)
    const lanesW = (cfg.lanes || []).map((lane) => lane.map(([lat, lng]) => llToWorld(lat, lng, center)));
    const OFF = GAME.TOWER_SIDE_OFF, BAND_R = 16, SKIRT = 14;
    const tsegs = [];
    for (const laneSites of solveTowerSites(lanesW)) {
      for (const site of laneSites) {
        for (const cp of [site.SWARM, site.STEEL]) {
          tsegs.push([cp.x - cp.nx * OFF, cp.z - cp.nz * OFF, cp.x + cp.nx * OFF, cp.z + cp.nz * OFF]);
        }
      }
    }
    if (tsegs.length) {
      const DRY = WATER.LEVEL + WATER.SWAMP_BAND + 0.5;
      for (let i = 0; i < N; i++) {
        const z = minZ + (maxZ - minZ) * i / (N - 1);
        for (let j = 0; j < N; j++) {
          const x = minX + (maxX - minX) * j / (N - 1);
          const k = i * N + j, dd = distToSegs(x, z, tsegs);
          if (dd < BAND_R + SKIRT && heights[k] < DRY) {
            const w = 1 - smooth01((dd - BAND_R) / SKIRT);
            if (w > 0) heights[k] += (DRY - heights[k]) * w;
          }
        }
      }
    }
  }
  const heightAt = (x, z) => {
    const gj = (x - minX) / (maxX - minX) * (N - 1);
    const gi = (z - minZ) / (maxZ - minZ) * (N - 1);
    const i0 = Math.max(0, Math.min(N - 2, Math.floor(gi))), j0 = Math.max(0, Math.min(N - 2, Math.floor(gj)));
    const fi = Math.max(0, Math.min(1, gi - i0)), fj = Math.max(0, Math.min(1, gj - j0));
    const at = (i, j) => heights[i * N + j];
    const a = at(i0, j0), b = at(i0, j0 + 1), c = at(i0 + 1, j0), d = at(i0 + 1, j0 + 1);
    return fi + fj <= 1 ? a + (b - a) * fj + (c - a) * fi : d + (c - d) * (1 - fj) + (b - d) * (1 - fi);
  };
  return { heightAt, minX, maxX, minZ, maxZ };
}

// ---- Overpass(查詢字串與 biomes.js 同一份;失敗回 null,呼叫端略過該場地)----
const OVERPASS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
  'https://maps.mail.ru/osm/tools/overpass/api/interpreter',
];
const bboxKm2 = (b) => (b.maxLat - b.minLat) * 111.32 * (b.maxLng - b.minLng) * 111.32
  * Math.cos((b.minLat + b.maxLat) / 2 * Math.PI / 180);
const quotaOf = (km2, perKm2, lo, hi) => Math.max(lo, Math.min(hi, Math.round(km2 * perKm2)));

// 逾時/放棄紀律(2026-07-28 實測:runner 上一輪掃描跑了 45 分鐘還沒完):
//   - 每次請求 REQ_MS 硬逾時(Node 的 fetch **沒有預設逾時**,半死的連線會把整支稽核掛住);
//   - 鏡像連續失敗 DEAD_N 次即整輪除名(限流的站不會下一個場地就突然變好,別再逐場地重試它);
//   - 每個查詢最多 ROUNDS 輪;403/405 這種出口政策封鎖不重試(沙箱/公司網路,等再久都一樣)。
const REQ_MS = 45000, DEAD_N = 2, ROUNDS = 2;
const RETRYABLE = new Set([429, 502, 503, 504]);
const fails = new Map();
async function overpass(q) {
  let retryable = false;
  for (let round = 0; round < ROUNDS; round++) {
    for (const url of OVERPASS) {
      if ((fails.get(url) || 0) >= DEAD_N) continue;
      try {
        const r = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'User-Agent': OSM_UA },
          body: 'data=' + encodeURIComponent(q),
          signal: AbortSignal.timeout(REQ_MS),
        });
        if (!r.ok) {
          fails.set(url, (fails.get(url) || 0) + 1);
          retryable = retryable || RETRYABLE.has(r.status);
          continue;
        }
        const d = await r.json();
        if (d.remark) { retryable = true; continue; }   // 伺服器截斷/逾時:換鏡像重抓
        fails.set(url, 0);
        return d.elements || [];
      } catch {                                          // 連線層失敗/逾時
        fails.set(url, (fails.get(url) || 0) + 1);
        retryable = true;
      }
    }
    if (!retryable) return null;
    retryable = false;
    await sleep(3000 * (round + 1));
  }
  return null;
}

// ---- 備援圖資來源:OSM 官方 API 的 /map(2026-07-28)----
// Overpass 的公共鏡像對雲端 IP(CI runner、開發沙箱)幾乎一律拒絕 ⇒ 退到官方 /map,
// 它走另一套基礎設施,回傳該 bbox 的全部原始 node/way。差別只有「沒有 out N 額度上限」
// ⇒ 這裡看到的是超集,實務上等價(L1 bbox 只有 ~0.28 km²,執行期額度遠大於實際 way 數)。
// 能「載著兵線走」的道路類別 = 烘焙兵線用的車行道(tools/bake_venue_lanes.mjs 的 DRIVABLE)。
// 兵線是車行路線 ⇒ 人行地下道/人行空橋**不可能**是兵線本身走的那一條,只可能是它上/下方的結構。
export const LANE_HW = /^(motorway|trunk|primary|secondary|tertiary|unclassified|residential|living_street|service)(_link)?$/;
const OSM_API = 'https://api.openstreetmap.org/api/0.6/map';
const DRIVE_HW = /^(motorway|trunk|primary|secondary|tertiary|unclassified|residential|living_street|service|track|path|footway|pedestrian)$/;
const RAIL_KIND = /^(rail|subway|light_rail|monorail|narrow_gauge|tram)$/;
const WATER_KIND = /^(river|stream|canal|drain|ditch)$/;

/** 極簡 OSM XML 解析(A2:不新增依賴)—— 只取 node 座標、way 的 nd/tag */
function parseOsmXml(xml) {
  const nodes = new Map(), ways = [], crossings = [];
  const attr = (s, k) => { const m = new RegExp(`${k}="([^"]*)"`).exec(s); return m ? m[1] : null; };
  const unesc = (s) => s.replace(/&quot;/g, '"').replace(/&apos;/g, "'")
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
  for (const m of xml.matchAll(/<node\s([^>]*?)(\/>|>([\s\S]*?)<\/node>)/g)) {
    const id = attr(m[1], 'id'), lat = +attr(m[1], 'lat'), lon = +attr(m[1], 'lon');
    if (!id || !Number.isFinite(lat)) continue;
    nodes.set(id, [lat, lon]);
    if (m[3] && /k="railway"\s+v="level_crossing"/.test(m[3])) crossings.push({ lat, lng: lon });
  }
  for (const m of xml.matchAll(/<way\s([^>]*?)>([\s\S]*?)<\/way>/g)) {
    const body = m[2], tags = {};
    for (const t of body.matchAll(/<tag k="([^"]*)" v="([^"]*)"\s*\/>/g)) tags[unesc(t[1])] = unesc(t[2]);
    const geometry = [];
    for (const n of body.matchAll(/<nd ref="(\d+)"\s*\/>/g)) {
      const p = nodes.get(n[1]);
      if (p) geometry.push({ lat: p[0], lon: p[1] });
    }
    if (geometry.length >= 2) ways.push({ tags, geometry });
  }
  return { ways, crossings };
}

async function osmApi(bbox) {
  const url = `${OSM_API}?bbox=${bbox.minLng.toFixed(5)},${bbox.minLat.toFixed(5)},`
    + `${bbox.maxLng.toFixed(5)},${bbox.maxLat.toFixed(5)}`;
  for (let a = 0; a < 3; a++) {
    try {
      const r = await fetch(url, { headers: { 'User-Agent': OSM_UA }, signal: AbortSignal.timeout(REQ_MS) });
      if (r.ok) return parseOsmXml(await r.text());
      if (!RETRYABLE.has(r.status)) return null;      // 400 = bbox 太大 / 403 = 出口封鎖:不重試
    } catch { /* 逾時/連線層失敗:重試 */ }
    await sleep(3000 * (a + 1));
  }
  return null;
}

/**
 * 一個場地一次查詢(道路 + 鐵路 + 水道 + 平交道節點):語句與額度逐條對齊 biomes.js 的
 * fetchOsmRoads / fetchOsmFeatures,只是併進同一個請求少一趟往返(Overpass 是這支的瓶頸)。
 * Overpass 全掛(雲端 IP 常態)時退到官方 /map,見上方 OSM_API 註解。
 */
export async function osmFor(id, bbox) {
  const f = join(CACHE, `${id}_L1v2.json`);   // v2:加抓水道(橋跨水/跨陸判定)
  if (existsSync(f)) return JSON.parse(readFileSync(f, 'utf8'));
  const bb = `${bbox.minLat.toFixed(5)},${bbox.minLng.toFixed(5)},${bbox.maxLat.toFixed(5)},${bbox.maxLng.toFixed(5)}`;
  const km2 = bboxKm2(bbox);
  const nMain = quotaOf(km2, 150, 150, 600), nMinor = quotaOf(km2, 1300, 400, 1600);
  const els = await overpass(`[out:json][timeout:40];`
    + `way["highway"~"^(motorway|trunk|primary|secondary|tertiary)$"](${bb});out geom ${nMain};`
    + `way["highway"~"^(unclassified|residential|living_street|service|track|path|footway|pedestrian)$"](${bb});out geom ${nMinor};`
    + `way["railway"~"^(rail|subway|light_rail|monorail|narrow_gauge|tram)$"](${bb});out geom 60;`
    + `way["waterway"~"^(river|stream|canal|drain|ditch)$"](${bb});out geom 60;`
    + `node["railway"="level_crossing"](${bb});out 40;`);
  let out = null;
  if (els) {
    out = {
      src: 'overpass',
      roads: els.filter((e) => e.type === 'way' && e.geometry && e.tags?.highway).map((e) => ({ tags: e.tags, geometry: e.geometry })),
      rails: els.filter((e) => e.type === 'way' && e.geometry && e.tags?.railway).map((e) => ({ tags: e.tags, geometry: e.geometry })),
      waters: els.filter((e) => e.type === 'way' && e.geometry && e.tags?.waterway).map((e) => ({ tags: e.tags, geometry: e.geometry })),
      crossings: els.filter((e) => e.type === 'node' && e.tags?.railway === 'level_crossing').map((e) => ({ lat: e.lat, lng: e.lon })),
    };
  } else {
    const api = await osmApi(bbox);
    if (!api) return null;
    out = {
      src: 'osm-api',
      roads: api.ways.filter((w) => DRIVE_HW.test(w.tags.highway || '')),
      rails: api.ways.filter((w) => RAIL_KIND.test(w.tags.railway || '')),
      waters: api.ways.filter((w) => WATER_KIND.test(w.tags.waterway || '')),
      crossings: api.crossings,
    };
  }
  writeFileSync(f, JSON.stringify(out));
  return out;
}

// ---- 幾何小工具(遊戲公尺)----
export function segCross(a, b, c, d) {            // 線段真交叉(共端點不算)
  const cr = (o, p, q) => (p[0] - o[0]) * (q[1] - o[1]) - (p[1] - o[1]) * (q[0] - o[0]);
  const d1 = cr(a, b, c), e1 = cr(a, b, d), d3 = cr(c, d, a), e3 = cr(c, d, b);
  return ((d1 > 0) !== (e1 > 0)) && ((d3 > 0) !== (e3 > 0));
}
export function ptSeg(p, a, b) {
  const ex = b[0] - a[0], ez = b[1] - a[1], L2 = ex * ex + ez * ez || 1;
  let t = ((p[0] - a[0]) * ex + (p[1] - a[1]) * ez) / L2;
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  return Math.hypot(p[0] - (a[0] + ex * t), p[1] - (a[1] + ez * t));
}
export const ptPoly = (p, poly) => {
  let m = Infinity;
  for (let i = 1; i < poly.length; i++) m = Math.min(m, ptSeg(p, poly[i - 1], poly[i]));
  return m;
};
export const arcOf = (pts) => { const c = [0]; for (let i = 1; i < pts.length; i++) c.push(c[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1])); return c; };
/** 折線的切線方向(最近段) */
export function tangentAt(p, poly) {
  let best = Infinity, dir = [1, 0];
  for (let i = 1; i < poly.length; i++) {
    const d = ptSeg(p, poly[i - 1], poly[i]);
    if (d < best) {
      best = d;
      const ex = poly[i][0] - poly[i - 1][0], ez = poly[i][1] - poly[i - 1][1], l = Math.hypot(ex, ez) || 1;
      dir = [ex / l, ez / l];
    }
  }
  return dir;
}

/**
 * 結構 way 的覆蓋區間(遊戲公尺弧長)+ densify 後的世界折線;建不成結構回 intervals:[]。
 * 兩種結構共用這一支(判定順序與 biomes.js 的 carve 指派完全相同):
 *   直線剖面藏得住天花板 → **山體隧道**(under:false);
 *   藏不住(平地)→ 交給 underpassPlan 試 **地下道**(under:true,折線含兩端引道延伸段)。
 */
export function tunnelRunOf(way, center, heightAt, hf) {
  const raw = way.geometry.map((p) => llToWorld(p.lat, p.lon, center));
  if (raw.length < 2) return null;
  const pts = densify(raw, ROAD_SEG);
  const cum = arcOf(pts);
  const tot = cum[cum.length - 1] || 1;
  const hA = heightAt(pts[0][0], pts[0][1]), hB = heightAt(pts[pts.length - 1][0], pts[pts.length - 1][1]);
  const floors = cum.map((s) => hA + (hB - hA) * (s / tot));
  const intervals = tunnelCoverIntervals(pts, cum, floors, heightAt);
  if (intervals.length || !hf) return { pts, cum, floors, intervals, under: false };
  const up = underpassPlan(raw, way.tags, heightAt, {
    minX: hf.minX + UND.EDGE, maxX: hf.maxX - UND.EDGE,
    minZ: hf.minZ + UND.EDGE, maxZ: hf.maxZ - UND.EDGE,
  });
  if (!up) return { pts, cum, floors, intervals, under: false };
  return { pts: up.pts, cum: up.cum, floors: up.floors, intervals: up.intervals, under: true, sink: up.sink };
}
