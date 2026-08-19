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
import { MAPGEO, TERRAIN, WATER, GAME, LOS, solveTowerSites, llToXZ, xzToLL } from '../public/js/data.js';

export const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
export const CACHE = join(ROOT, 'tools', '.scen_cache');
if (!existsSync(CACHE)) mkdirSync(CACHE, { recursive: true });

export const R_EARTH = 6371000;
export const d2r = (d) => d * Math.PI / 180;
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---- 經緯度投影唯一縫(A42):直接轉呼 data.llToXZ,不可在工具端手抄 ----
export const WORLD_S = 1 / MAPGEO.REAL_SCALE;
export const llToWorld = (lat, lng, center) => llToXZ(lat, lng, center);
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
const grabFunctionSource = (name) => {
  const start = bsrc.indexOf(`function ${name}(`);
  if (start < 0) throw new Error(`biomes.js 找不到 ${name}`);
  const open = bsrc.indexOf('{', start);
  let depth = 0;
  for (let i = open; i < bsrc.length; i++) {
    if (bsrc[i] === '{') depth++;
    else if (bsrc[i] === '}' && --depth === 0) return bsrc.slice(start, i + 1);
  }
  throw new Error(`biomes.js ${name} 大括號未閉合`);
};
export const tunnelCoverIntervals = evalBlock('function tunnelCoverIntervals(', 'tunnelCoverIntervals',
  { TUN_GAP_CLOSE, TUN_COV_MIN });
export const tunnelWallProfile = evalBlock('const TUN_WALL_SAMP', 'tunnelWallProfile');
export const densify = evalBlock('function densify(', 'densify');
// 隧道/地下道路面高(biomes.js 的**單一縫**;carve / buildRoads / 走廊淨空都吃它)
export const tunFloorAt = evalBlock('function tunFloorAt(', 'tunFloorAt');
// 地下道規劃(平坦 tunnel way 的下沉剖面)—— 與遊戲同一份原文
export const underpassPlan = evalBlock('const UND = {', 'underpassPlan',
  { ROAD_SEG, WATER, densify, tunnelCoverIntervals, TUN_COV_MIN });
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

// ---- 走廊規則的執行期原文鏡射(切面樁與遊戲端 MUST 吃同一份)----
const CELL_M = +/const CELL = ([\d.]+)/.exec(bsrc)[1];
const STRUCT_CLEAR_PAD = new Function('UND', 'TUN',
  `${/const STRUCT_CLEAR_PAD = [^\n]+/.exec(bsrc)[0]}\nreturn STRUCT_CLEAR_PAD;`)(UND, TUN);
const blockArea = new Function('CELL', `${grabFunctionSource('blockArea')}\nreturn blockArea;`)(CELL_M);
const runtimeSplitWaterPieces = new Function(
  'WATER', 'SKIRT_NEAR', 'SKIRT_OPEN', 'SKIRT_MAX', 'SKIRT_STEP', 'SKIRT_CROSS_MIN',
  `${grabFunctionSource('isWaterPt')}\n${grabFunctionSource('terrainEnvCode')}\n${grabFunctionSource('skirtWaterClips')}\n${grabFunctionSource('splitWaterPieces')}\nreturn splitWaterPieces;`,
)(WATER, 30, 60, 72, 3, WATER.SPAN_MIN_M);
export const markGradeCorridors = new Function(
  'roadWidth', 'PASS_W', 'PED_HW', 'llToWorld', 'densify', 'splitWaterPieces', 'strucHw',
  'tunFloorAt', 'TUN', 'STRUCT_CLEAR_PAD', 'WATER', 'ROAD_SEG', 'tunnelWallProfile', 'blockArea',
  `${grabFunctionSource('markGradeCorridors')}\nreturn markGradeCorridors;`,
)(roadWidth, PASS_W, PED_HW, llToWorld, densify, runtimeSplitWaterPieces, strucHw,
  tunFloorAt, TUN, STRUCT_CLEAR_PAD, WATER, ROAD_SEG, tunnelWallProfile, blockArea);

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
  // heights 一併回傳:開挖鏡射(makeCarvedField)要拿它複製一份出來動,
  // 而 `heightAt` 這一份 MUST 永遠是**天然地形**(淨空檢查、明隧道判定的條件③都吃天然快照)
  return { heightAt, minX, maxX, minZ, maxZ, heights, N };
}

// ---- 隧道開挖的鏡射(V-C;2026-08-03)----
// 為什麼要有:`shot_tunnels.mjs` 的五項量化掃描全部住在 Playwright 頁面裡,整類在回歸矩陣上
// 標著 ㋓(沙箱跑不動)⇒ **agent 沒辦法驗自己的隧道改動**。其中第①項「斷面地形殘留」是
// 唯一不吃網格/貼圖、純粹由高度場決定的一項,可以整支搬到 Node。
//
// **只有第①項搬得動,其餘四項留在 Playwright**:②~⑤ 量的是 `THREE.Raycaster` 對真實
// **網格**(結構件/植被/地被拼圖)的命中,而 three 走 CDN importmap、A2 又不准把它寫進
// package.json ⇒ Node 端沒有 three 可用。硬把那四項「近似」成幾何式就是抄第二份公式
// (§2.1 最忌的那件事),寧可留在 ㋓ 也不要一支永遠全綠的假稽核。
//
// 這裡執行的是 `terrain.js carveTunnels` 的**原文**(自由變數以參數注入),不是重寫的公式 ——
// 開挖剖面一改,這支跟著改。
const tsrc = readFileSync(join(ROOT, 'public', 'js', 'terrain.js'), 'utf8').replace(/\r\n?/g, '\n');
const CUT_W = +/const CUT_W = ([\d.]+)/.exec(tsrc)[1];
const PROT_M = +/const PROT_M = (\d+)/.exec(tsrc)[1];
if (!Number.isFinite(CUT_W) || !Number.isFinite(PROT_M)) throw new Error('terrain.js 開挖常數解析失敗');

/**
 * 對高度場執行隧道開挖,回傳「開挖後」的取樣器(天然那一份不動)。
 * @param hf   buildHeightField 的輸出
 * @param runs [{ pts, floors, hw, cut?, covA?, covB? }](= tunnelRunOf 的形狀 + 通行寬)
 * @returns (x, z) => 開挖後地表高;三角化取樣與 `hf.heightAt` 逐字同式
 */
export function makeCarvedField(hf, runs) {
  const { N, minX, maxX, minZ, maxZ } = hf;
  const heights = Float32Array.from(hf.heights);
  const P0 = tsrc.indexOf('function carveTunnels(');
  const P1 = tsrc.indexOf('\n  }', P0) + 4;
  if (P0 < 0 || P1 <= P0) throw new Error('terrain.js 找不到 carveTunnels 區塊');
  // `imagery` / `mat` 只出現在函式尾巴那段「開挖走廊影像重繪」(純視覺)裡,餵 null 即整段跳過;
  // 但 MUST 餵 —— `if (imagery && …)` 讀一個未宣告的全域是 ReferenceError,不是 falsy。
  const carve = new Function('N', 'minX', 'maxX', 'minZ', 'maxZ', 'heights', 'CUT_W', 'PROT_M',
    'markCarved', 'syncHeights', 'imagery', 'mat', `${tsrc.slice(P0, P1)}\nreturn carveTunnels;`)(
    N, minX, maxX, minZ, maxZ, heights, CUT_W, PROT_M, () => {}, () => {}, null, null);
  carve(runs, { clear: TUN.CLEAR });
  return (x, z) => {   // 三角化取樣:與 buildHeightField 的 heightAt 同一套內插(對角切法一致)
    const gj = (x - minX) / (maxX - minX) * (N - 1);
    const gi = (z - minZ) / (maxZ - minZ) * (N - 1);
    const i0 = Math.max(0, Math.min(N - 2, Math.floor(gi))), j0 = Math.max(0, Math.min(N - 2, Math.floor(gj)));
    const fi = Math.max(0, Math.min(1, gi - i0)), fj = Math.max(0, Math.min(1, gj - j0));
    const at = (i, j) => heights[i * N + j];
    const a = at(i0, j0), b = at(i0, j0 + 1), c = at(i0 + 1, j0), d = at(i0 + 1, j0 + 1);
    return fi + fj <= 1 ? a + (b - a) * fj + (c - a) * fi : d + (c - d) * (1 - fj) + (b - d) * (1 - fi);
  };
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

/**
 * 地被圖資(2026-08-04:`audit_venue_biome.mjs` 用)—— 回答「這張圖的地貌**實際上**是什麼」。
 *
 * 為什麼要另開一支而不是併進 `osmFor`:①`osmFor` 的快取檔(`*_L1v2.json`)是場景掃描與
 * 泛洪稽核共用的貴重資產,改它的查詢就得換鍵、整批重抓(公共 Overpass 對雲端 IP 常態拒絕,
 * 重抓一次是分鐘級);②地被只有這一支消費端,查詢額度與逾時可以自己設。
 * 兩支共用同一個 `overpass()`(鏡像輪替 + 逐站計時,§2.4)與同一個快取目錄。
 *
 * 收兩件**互相獨立**的東西,刻意不合併成一個數字:
 *   `covers` 土地覆蓋多邊形(landuse / natural / leisure)—— 這是「地貌」本身;
 *   `buildings` 建物**輪廓**(不是中心點)—— 這是「建蔽率」,回答「為什麼這麼多樓」。
 * 合併會失真:`landuse=residential` 的範圍涵蓋整個街廓(含道路與院子),而建蔽率量的是
 * 真的被樓蓋住的地。兩者一起看才分得出「圖資說這裡是市區」與「這裡真的都是樓」。
 *
 * 沒有 `/map` 備援:Overpass 掛掉就回 null,呼叫端 MUST 標成「未驗」而不是報綠(原則 6)。
 */
export async function landcoverFor(id, bbox) {
  const f = join(CACHE, `${id}_landcover_v1.json`);
  if (existsSync(f)) return JSON.parse(readFileSync(f, 'utf8'));
  const bb = `${bbox.minLat.toFixed(5)},${bbox.minLng.toFixed(5)},${bbox.maxLat.toFixed(5)},${bbox.maxLng.toFixed(5)}`;
  const km2 = bboxKm2(bbox);
  // 額度隨面積縮放(同 osmFor 的紀律):地被多邊形遠少於道路,but 建物在密市區可達數千 ——
  // 截斷會**低估**建蔽率,故把建物那一格給得寬,並在回傳裡記下有沒有頂到額度。
  const nCover = quotaOf(km2, 400, 200, 900), nBld = quotaOf(km2, 6000, 1200, 4000);
  const els = await overpass(`[out:json][timeout:60];`
    + `way["landuse"](${bb});out geom ${nCover};`
    + `way["natural"](${bb});out geom ${nCover};`
    + `way["leisure"~"^(park|garden|golf_course|nature_reserve|recreation_ground)$"](${bb});out geom ${nCover};`
    + `way["building"](${bb});out geom ${nBld};`);
  if (!els) return null;
  const poly = (e) => e.type === 'way' && Array.isArray(e.geometry) && e.geometry.length >= 3;
  const covers = els.filter((e) => poly(e) && !e.tags?.building
    && (e.tags?.landuse || e.tags?.natural || e.tags?.leisure))
    .map((e) => ({ tags: e.tags, geometry: e.geometry }));
  const buildings = els.filter((e) => poly(e) && e.tags?.building)
    .map((e) => ({ tags: e.tags, geometry: e.geometry }));
  const out = { src: 'overpass', covers, buildings, capped: buildings.length >= nBld, quota: nBld };
  writeFileSync(f, JSON.stringify(out));
  return out;
}

/**
 * 切面線工專屬圖資(2026-08-16:`audit_zone_cut.mjs` 的 §0-a 線工切面樁用)——
 * 回答「這張圖上有哪些**行政界**與**海岸線**」。
 *
 * 為什麼是第三支而不是併進 `osmFor`/`landcoverFor`:兩支的快取檔(`*_L1v2.json` /
 * `*_landcover_v1.json`)是場景掃描、泛洪稽核與 `audit_venue_biome` 共用的**貴重資產**,
 * 改它們的查詢就得換鍵、整批重抓(公共 Overpass 對雲端 IP 常態拒絕,重抓一次是分鐘級)。
 * `landcoverFor` 的檔頭已經把這條理由寫死一次,本支是同一條理由的第二個實例。
 * 三支共用同一個 `overpass()`(鏡像輪替 + 逐站計時,§2.4)與同一個快取目錄。
 *
 * 兩類線刻意分開回:
 *   `boundary`  行政界 —— 在 §0-a 的線工裡是**低優先**(多數與河/路重合),呼叫端只在
 *               「附近沒有其他參與線」時才採用;
 *   `coastline` 海岸線 —— 恆參與(它是真實世界最硬的一條地貌界線)。
 *
 * ⚠ **行政界在 OSM 裡是 relation 不是 way**(2026-08-16 實測:barcelona 的戰場 bbox 內
 *   `way["boundary"="administrative"]` 回 **0 條**,而 `rel["boundary"="administrative"]`
 *   回 **41 個**)—— 成員 way 通常**不帶** `boundary` 標籤,只是 relation 的成員。
 *   查 way 就是「這張圖沒有行政界」而每一個數字看起來都正常。故本支查 relation
 *   再用 `way(r)` 展開成員 way(v2 換鍵重抓;v1 那一份是這個坑的證物)。
 *   展開後的成員 way 沒有 `boundary` 標籤 ⇒ 分類改成**排除法**:帶 `natural=coastline` 的
 *   歸海岸線、其餘全是行政界成員(兩個產生器只有這兩個,無歧義)。
 *
 * 沒有 `/map` 備援:Overpass 掛掉就回 `null`,呼叫端 **MUST 標成「未驗」**,
 * MUST NOT 當成「這張圖沒有行政界」(原則 6:降級不例外、寧缺勿錯)。
 */
export async function cutLinesFor(id, bbox) {
  const f = join(CACHE, `${id}_cutlines_v2.json`);
  if (existsSync(f)) return JSON.parse(readFileSync(f, 'utf8'));
  const bb = `${bbox.minLat.toFixed(5)},${bbox.minLng.toFixed(5)},${bbox.maxLat.toFixed(5)},${bbox.maxLng.toFixed(5)}`;
  const km2 = bboxKm2(bbox);
  // 額度隨面積縮放(同 osmFor / landcoverFor 的紀律)。行政界在都會區可以層層疊(市 / 區 /
  // 里各一條、而且常常共線)⇒ 給得比海岸線寬;海岸線在一張戰場圖上頂多幾條 way。
  const nAdm = quotaOf(km2, 120, 60, 400), nCoast = quotaOf(km2, 40, 30, 200);
  const els = await overpass(`[out:json][timeout:60];`
    + `rel["boundary"="administrative"](${bb});way(r);out geom ${nAdm};`
    + `way["natural"="coastline"](${bb});out geom ${nCoast};`);
  if (!els) return null;
  const line = (e) => e.type === 'way' && Array.isArray(e.geometry) && e.geometry.length >= 2;
  const ways = els.filter(line).map((e) => ({ tags: e.tags || {}, geometry: e.geometry }));
  const out = {
    src: 'overpass',
    coastline: ways.filter((w) => w.tags.natural === 'coastline'),
    boundary: ways.filter((w) => w.tags.natural !== 'coastline'),
  };
  out.capped = out.boundary.length >= nAdm || out.coastline.length >= nCoast;
  out.quota = { boundary: nAdm, coastline: nCoast };
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
    hw: strucHw(way.tags),   // 全寬覆蓋取樣的牆線位置 —— 與 biomes.js carve 迴圈同一份 strucHw
  });
  if (!up) return { pts, cum, floors, intervals, under: false };
  return { pts: up.pts, cum: up.cum, floors: up.floors, intervals: up.intervals, under: true, sink: up.sink };
}

// ---- 結構清單(2026-08-16 由 `audit_traverse.mjs` 搬進來;純搬家,一行未改)----
// 為什麼要搬:`audit_zone_cut.mjs`(§0-a 線工切面樁)要的「結構足跡 keep-out」與泛洪要的
// 是**同一份**結構清單(隧道 / 地下道 / 橋的通行折線與半寬)。留在 audit_traverse 裡的話
// 第二個消費端只能抄一份 —— 而「消費端 MUST 走這一支,MUST NOT 自己再抄一份」正是本檔
// 檔頭那條規則。四支的自由變數本來就全部住在本檔(LANE_HW / strucHw / strucTunnel /
// tunnelRunOf / densify / llToWorld / ROAD_SEG / arcOf / makeDeckAt / UND / ptSeg)。

/** 點落在結構通行寬內時回傳它的弧長座標,否則 null */
export function projectArc(x, z, st) {
  let best = Infinity, bs = 0;
  const p = st.pts;
  for (let i = 1; i < p.length; i++) {
    const d = ptSeg([x, z], p[i - 1], p[i]);
    if (d < best) {
      best = d;
      const ex = p[i][0] - p[i - 1][0], ez = p[i][1] - p[i - 1][1], L2 = ex * ex + ez * ez || 1;
      let t = ((x - p[i - 1][0]) * ex + (z - p[i - 1][1]) * ez) / L2;
      t = t < 0 ? 0 : t > 1 ? 1 : t;
      bs = st.cum[i - 1] + t * Math.hypot(ex, ez);
    }
  }
  return best <= st.hw ? bs : null;
}

/** 折線上弧長 s 的座標 */
export function ptAt(run, s) {
  const { pts, cum } = run;
  for (let i = 1; i < cum.length; i++) {
    if (cum[i] >= s) {
      const t = (s - cum[i - 1]) / Math.max(1e-6, cum[i] - cum[i - 1]);
      return [pts[i - 1][0] + (pts[i][0] - pts[i - 1][0]) * t, pts[i - 1][1] + (pts[i][1] - pts[i - 1][1]) * t];
    }
  }
  return pts[pts.length - 1];
}
/** 沿弧長線性內插一組取樣值(隧道路面 floors 已由 tunFloorAt 逐點算好) */
export function sampleAlong(cum, vals, s) {
  for (let i = 1; i < cum.length; i++) {
    if (cum[i] >= s) {
      const t = (s - cum[i - 1]) / Math.max(1e-6, cum[i] - cum[i - 1]);
      return vals[i - 1] + (vals[i] - vals[i - 1]) * t;
    }
  }
  return vals[vals.length - 1];
}

/** 結構清單(隧道 / 地下道 / 橋)+ 它們貢獻的航點 + 開挖走廊(carveTunnels 的輸入) */
export function buildStructs(osm, center, hf) {
  const structs = [], marks = [], carveRuns = [];
  for (const w of (osm?.roads || [])) {
    if (!LANE_HW.test(w.tags.highway || '') || w.geometry.length < 2) continue;
    const hw = strucHw(w.tags);
    if (strucTunnel(w.tags)) {
      const run = tunnelRunOf(w, center, hf.heightAt, hf);
      if (!run || !run.intervals.length) continue;
      const total = run.cum[run.cum.length - 1] || 1;
      const floorAt = (s) => sampleAlong(run.cum, run.floors, s);
      const st = { pts: run.pts, cum: run.cum, hw, floorAt, kind: run.under ? '地下道' : '隧道' };
      structs.push(st);
      // 航點:兩端洞口 + 每一段覆蓋區間的中點(= 真的鑽過去,不是繞到山頂上)
      for (const [a, b] of run.intervals) {
        marks.push({ name: `${st.kind}洞口A`, p: ptAt(run, a), y: floorAt(a) });
        marks.push({ name: `${st.kind}洞中`, p: ptAt(run, (a + b) / 2), y: floorAt((a + b) / 2) });
        marks.push({ name: `${st.kind}洞口B`, p: ptAt(run, b), y: floorAt(b) });
      }
      // 開挖走廊(V-C):`carveTunnels` 吃的是**敞開補集**(引道 / 路塹),不是覆蓋段本身 ——
      // 洞體是把三角形整片刪掉,不是把山壓平。分段規則逐字鏡射 `biomes.js` 那一段
      // (bounds = [頭, 各覆蓋段的頂點索引…, 尾],成對取);cut 旗標 = 地下道引道收窄成垂直路塹。
      // 少了這一步,泛洪就是拿**天然**地形在走引道 —— 一條靠開挖才通的路會被報成不可達,
      // 而那是假紅字,比沒驗還糟。
      {
        const bounds = [0, ...run.intervals.flatMap(([, , ia, ib]) => [ia, ib]), run.pts.length - 1];
        for (let k = 0; k + 1 < bounds.length; k += 2) {
          const a = bounds[k], b = bounds[k + 1];
          if (!(b - a >= 1)) continue;
          carveRuns.push({ pts: run.pts.slice(a, b + 1), floors: run.floors.slice(a, b + 1),
            covA: k > 0, covB: k + 2 < bounds.length, hw, cut: !!run.under });
        }
      }
      if (run.under) {   // 地下道引道:兩端各一個(引道走不通 = 掉進洞裡出不來)
        marks.push({ name: '地下道引道A', p: ptAt(run, Math.min(total, UND.EDGE + 2)), y: floorAt(Math.min(total, UND.EDGE + 2)) });
        marks.push({ name: '地下道引道B', p: ptAt(run, Math.max(0, total - UND.EDGE - 2)), y: floorAt(Math.max(0, total - UND.EDGE - 2)) });
      }
    } else if (w.tags.bridge) {
      const pts = densify(w.geometry.map((p) => llToWorld(p.lat, p.lon, center)), ROAD_SEG);
      if (pts.length < 2) continue;
      const cum = arcOf(pts);
      const total = cum[cum.length - 1] || 1;
      if (total < 24) continue;                       // 太短的「橋」是路面涵管,沒有橋面可走
      const hA = hf.heightAt(pts[0][0], pts[0][1]);
      const hB = hf.heightAt(pts[pts.length - 1][0], pts[pts.length - 1][1]);
      const deckAt = makeDeckAt(hA, hB, total, hf.heightAt);
      const st = { pts, cum, hw, floorAt: (s, x, z) => deckAt(s, x, z), kind: '橋' };
      structs.push(st);
      const mid = total / 2;
      const mp = ptAt({ pts, cum }, mid);
      marks.push({ name: '橋面中段', p: mp, y: deckAt(mid, mp[0], mp[1]) });
    }
  }
  return { structs, marks, carveRuns };
}

/**
 * 準備與執行期相同的走廊輸入：隧道先掛上 `_tun`，兵線泡水段由同一支
 * `splitWaterPieces` 原文生成偽 way。這支只供離線樁使用，不另造一套結構判定。
 */
export function gradeWaysForAudit(osmRoads, laneConfig, center, terrain) {
  const roads = (osmRoads || []).map((w) => ({
    ...w,
    tags: { ...(w.tags || {}) },
    geometry: (w.geometry || []).map((p) => ({ ...p })),
  }));
  for (const way of roads) {
    if (!strucTunnel(way.tags)) continue;
    const run = tunnelRunOf(way, center, terrain.heightAt, terrain);
    way._tun = run ? [run] : [{ intervals: [] }];
  }
  const laneWetWays = [];
  if (roads.length && laneConfig?.length) {
    for (const lane of laneConfig) {
      const pts = densify(lane.map(([lat, lng]) => llToWorld(lat, lng, center)), ROAD_SEG);
      for (const p of runtimeSplitWaterPieces(pts, terrain, true)) {
        if (p.wet === true && p.length >= 2) {
          laneWetWays.push({
            tags: { highway: 'primary' },
            geometry: p.map(([x, z]) => {
              const [lat, lon] = xzToLL(x, z, center);
              return { lat, lon };
            }),
          });
        }
      }
    }
  }
  return { roads, laneWetWays, ways: [...roads, ...laneWetWays] };
}
