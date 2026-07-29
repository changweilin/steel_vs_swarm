// ============ 1v1 兵線立體場景稽核(離線;找測試用預設場地)============
// 用途:回答「哪一個預設場地的 **1v1(L1)兵線**上,真的走得到某種立體交通場景」——
// 供手動測試八種情境各挑一張預設地圖:
//   ① 隧道(山體):道路平坦,鑽進突起的地形 —— 深度來自山
//   ② 地下道(平地下穿):地形平坦,路面一端往下、另一端上來 —— 深度來自挖
//      (2026-07-28 起引擎會生成:`biomes.js underpassPlan` 把平坦 tunnel way 改吃下沉剖面)
//   ③ 地面高架橋(兵線走在**純陸域**橋面上)  ④ 明隧道(側向土牆藏不住結構那一側)
//   ⑤ 平交道(兵線與地面鐵軌平面交會)        ⑥ 穿越高架橋底部(兵線從橋下鑽過)
//   ⑦ 穿越地下道上方(兵線從洞頂走過)
//   ⑧ 其中一側有超過一座砲塔高的地形(altTier() = TARGET_H.tower,高度差加成的觸發門檻;
//      **只算一般道路段** —— 橋面/隧道/引道一律扣掉:洞裡量到的側向高差是「地下道/隧道的深度」,
//      不是可以佔領的戰術高地)
//
// 兩個附帶診斷(不是場景,但選場地時要看):
//   跨水橋   兵線走在橋上但橋跨的是水域 —— ③ 刻意不收(使用者要純陸域高架橋)
//   落空地下道 圖資掛 tunnel、地形也平坦,但 underpassPlan 放棄(人行道 / 引道空間不足 /
//            要挖到 SINK_MAX 以上 / 走廊碰水)⇒ 仍當一般道路,列出來供評估
//
// 資料來源與執行期完全同源:
//   - 兵線/主堡/bbox:`venues.js venueConfig(v, 1)` + `data.js battleBBox`(teamSize=1 ⇒ L=1)
//   - 路網/鐵路/平交道:Overpass,查詢字串與 `biomes.js fetchOsmRoads/fetchOsmFeatures` 同一份;
//     Overpass 的公共鏡像對雲端 IP 幾乎一律拒絕 ⇒ 全掛時退到 OSM 官方 API 的 /map(見 OSM_API)
//   - 高程:AWS terrarium 磚(= `terrain.js` 主來源),再走同一條「3×3 平滑 → 兵線外 AMP 放大
//     → 塔位乾地帶抬升」管線,故本工具的 heightAt 與遊戲內地形同形。
//   - 隧道覆蓋/地下道規劃/明隧道判定:**直接執行 `biomes.js` 的函式原文**(tunnelCoverIntervals /
//     tunFloorAt / underpassPlan / tunnelWallProfile;抽原文的理由同 audit_open_tunnel.mjs ——
//     biomes.js 的 three 走 CDN importmap,Node 端 import 不了,另抄一份公式則永遠會通過)。
//
// 網路:第一次跑會抓圖資 + terrarium 高程,結果寫進 `tools/.scen_cache/`(之後純離線可重跑)。
// 用法:node tools/audit_lane_scenarios.mjs [--only=jinlong,london] [--json=out.json]
//      node tools/audit_lane_scenarios.mjs --probe='25.09,121.54,自強隧道;40.78,-73.97,中央公園'  ← 找新場地用
// 退出碼:0 = 八種場景各至少有一個場地;1 = 有場景無場地(需要新增測試場地)
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { inflateSync } from 'node:zlib';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { VENUES, venueConfig, SCEN_LABEL } from '../public/js/venues.js';
import { MAPGEO, TERRAIN, WATER, GAME, LOS, UNITS, TARGET_H, altTier, battleBBox, sideMFor, solveTowerSites } from '../public/js/data.js';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const CACHE = join(ROOT, 'tools', '.scen_cache');
if (!existsSync(CACHE)) mkdirSync(CACHE, { recursive: true });

const ARG = Object.fromEntries(process.argv.slice(2).map((s) => {
  const m = /^--([^=]+)(?:=(.*))?$/.exec(s);
  return m ? [m[1], m[2] ?? '1'] : ['_', s];
}));
const ONLY = (ARG.only || '').split(',').filter(Boolean);

const R_EARTH = 6371000;
const d2r = (d) => d * Math.PI / 180;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---- 與 terrain.js 同一組換算(該檔 import three ⇒ Node 端載不進來,逐字照抄)----
const WORLD_S = 1 / MAPGEO.REAL_SCALE;
const llToWorld = (lat, lng, center) => [
  (lng - center.lng) * Math.PI / 180 * R_EARTH * Math.cos(d2r(center.lat)) * WORLD_S,
  -((lat - center.lat) * Math.PI / 180 * R_EARTH * WORLD_S),
];
const lon2tx = (lon, z) => (lon + 180) / 360 * 2 ** z;
const lat2ty = (lat, z) => (1 - Math.log(Math.tan(d2r(lat)) + 1 / Math.cos(d2r(lat))) / Math.PI) / 2 * 2 ** z;
const smooth01 = (t) => { t = t < 0 ? 0 : t > 1 ? 1 : t; return t * t * (3 - 2 * t); };
function distToSegs(px, pz, segs) {
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
const bsrc = readFileSync(join(ROOT, 'public', 'js', 'biomes.js'), 'utf8');
function pickConst(name, fallbackMap = {}) {
  const m = new RegExp(`const ${name} = \\{([\\s\\S]*?)\\};`).exec(bsrc);
  if (!m) throw new Error(`biomes.js 找不到 ${name}`);
  return Object.fromEntries(m[1].replace(/\/\/.*$/gm, '').split(',').map((s) => s.trim()).filter(Boolean)
    .map((s) => { const [k, v] = s.split(':').map((t) => t.trim()); return [k, k in fallbackMap ? fallbackMap[k] : +v]; }));
}
const TUN = pickConst('TUN', { CLEAR: LOS.TUN_CLEAR_M });   // TUN.CLEAR 的單一縫住 data.js
const UND = pickConst('UND');
const ROAD_W = pickConst('ROAD_W');
const PASS_W = +/const PASS_W = (\d+)/.exec(bsrc)[1];
const ROAD_SEG = +/const ROAD_SEG = (\d+)/.exec(bsrc)[1];
const TUN_GAP_CLOSE = +/const TUN_GAP_CLOSE = (\d+)/.exec(bsrc)[1];
const TUN_COV_MIN = +/TUN_COV_MIN = (\d+)/.exec(bsrc)[1];
{ // 常數解析防呆:任一沒解出來就整支停(比後面默默算錯好)
  const bad = Object.entries({ ...TUN, PASS_W, ROAD_SEG, TUN_GAP_CLOSE, TUN_COV_MIN })
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
const tunnelCoverIntervals = evalBlock('function tunnelCoverIntervals(', 'tunnelCoverIntervals',
  { TUN_GAP_CLOSE, TUN_COV_MIN });
const tunnelWallProfile = evalBlock('const TUN_WALL_SAMP', 'tunnelWallProfile');
const densify = evalBlock('function densify(', 'densify');
// 地下道規劃(平坦 tunnel way 的下沉剖面)—— 與遊戲同一份原文
const underpassPlan = evalBlock('const UND = {', 'underpassPlan',
  { ROAD_SEG, WATER, densify, tunnelCoverIntervals });
// 結構隧道資格 —— 與遊戲同一份原文(人行/室內 tunnel way 不進結構管線 ⇒ 不成洞;
// 2026-07-29 澀谷側壁破口案)。①/⑦ 判定與候選診斷 MUST 同吃這個閘,否則稽核比執行期多洞。
const PED_HW = new Function(`return ${/const PED_HW = (\/[^\n]+\/);/.exec(bsrc)[1]};`)();
const strucTunnel = (() => {
  const m = /const strucTunnel = \(tags\) =>[\s\S]*?;\r?\n/.exec(bsrc);
  if (!m) throw new Error('biomes.js 找不到 strucTunnel');
  return new Function('PED_HW', `${m[0]}return strucTunnel;`)(PED_HW);
})();
const roadWidth = (tags) => {
  const base = ROAD_W[tags.highway] || 4;
  const lanes = parseInt(tags.lanes, 10) || 0;
  return lanes ? Math.max(base, lanes * 3.2) : base;
};
/** 結構通行半寬(= biomes.buildRoads 的 hw:橋/結構隧道一律夾到 PASS_W/2 以上) */
const strucHw = (tags) => Math.max(roadWidth(tags) / 2, PASS_W / 2);

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

async function getBuf(url, tries = 4) {
  for (let a = 0; a < tries; a++) {
    try {
      const r = await fetch(url, { signal: AbortSignal.timeout(30000) });
      if (r.ok) return Buffer.from(await r.arrayBuffer());
    } catch { /* 重試 */ }
    await sleep(800 * (a + 1));
  }
  return null;
}

/** terrarium 高程取樣器(lat,lng → 公尺);磚快取在 .scen_cache/tile_z_x_y.png */
async function elevSampler(bbox) {
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
function buildHeightField(cfg, bbox, sampleElev) {
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
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
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
// 為什麼要備援:Overpass 的公共鏡像對雲端 IP(CI runner、開發沙箱)幾乎一律拒絕 ——
// 實測 runner 上三個鏡像全數失敗,整支稽核只剩不需要圖資的 ⑧ 能判。官方 /map 走的是
// 另一套基礎設施,回傳該 bbox 的**全部**原始資料(node/way),本工具要的 way 幾何與標籤都在裡面。
// 與執行期的差別只有「沒有 Overpass 的 out N 額度上限」⇒ 這裡看到的是**超集**:
// L1 bbox 只有 ~0.28 km²,執行期額度(幹道 150 / 小徑 400)遠大於實際 way 數,兩者實務上等價;
// 真要卡到額度也只會讓遊戲少畫幾條小徑,不影響本稽核判定的橋/隧道/鐵路。
// 能「載著兵線走」的道路類別 = 烘焙兵線用的車行道(tools/bake_venue_lanes.mjs 的 DRIVABLE)。
// 兵線是車行路線 ⇒ 人行地下道/人行空橋**不可能**是兵線本身走的那一條,只可能是它上/下方的結構。
const LANE_HW = /^(motorway|trunk|primary|secondary|tertiary|unclassified|residential|living_street|service)(_link)?$/;
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
  // <node .../>(自閉)或 <node ...> … </node>(含 tag)
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
      const r = await fetch(url, { signal: AbortSignal.timeout(REQ_MS) });
      if (r.ok) return parseOsmXml(await r.text());
      if (!RETRYABLE.has(r.status)) return null;      // 400 = bbox 太大 / 403 = 出口封鎖:不重試
    } catch { /* 逾時/連線層失敗:重試 */ }
    await sleep(3000 * (a + 1));
  }
  return null;
}

/**
 * 一個場地一次查詢(道路 + 鐵路 + 平交道節點):語句與額度逐條對齊 biomes.js 的
 * fetchOsmRoads / fetchOsmFeatures,只是併進同一個請求少一趟往返(Overpass 是這支的瓶頸)。
 * Overpass 全掛(雲端 IP 常態)時退到官方 /map,見上方 OSM_API 註解。
 */
async function osmFor(id, bbox) {
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
function segCross(a, b, c, d) {                   // 線段真交叉(共端點不算)
  const cr = (o, p, q) => (p[0] - o[0]) * (q[1] - o[1]) - (p[1] - o[1]) * (q[0] - o[0]);
  const d1 = cr(a, b, c), e1 = cr(a, b, d), d3 = cr(c, d, a), e3 = cr(c, d, b);
  return ((d1 > 0) !== (e1 > 0)) && ((d3 > 0) !== (e3 > 0));
}
function ptSeg(p, a, b) {
  const ex = b[0] - a[0], ez = b[1] - a[1], L2 = ex * ex + ez * ez || 1;
  let t = ((p[0] - a[0]) * ex + (p[1] - a[1]) * ez) / L2;
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  return Math.hypot(p[0] - (a[0] + ex * t), p[1] - (a[1] + ez * t));
}
const ptPoly = (p, poly) => {
  let m = Infinity;
  for (let i = 1; i < poly.length; i++) m = Math.min(m, ptSeg(p, poly[i - 1], poly[i]));
  return m;
};
const arcOf = (pts) => { const c = [0]; for (let i = 1; i < pts.length; i++) c.push(c[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1])); return c; };
/** 折線的切線方向(最近段) */
function tangentAt(p, poly) {
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

// ---- 場景判定門檻(遊戲公尺)----
const ON_MIN = 24;        // 「兵線走在結構上」的最短同向重疊長度
const ALIGN = 0.6;        // 同向判定 |cos|
const XING_R = 20;        // 平交道節點離兵線的容許距離(≈ 10 真實公尺)
// 側向高地掃描距離(遊戲公尺):高度差加成作用在「交戰中的兩造」⇒ 尺規取交戰距離而非貼身距離。
// 300 ≈ 英雄重武器射程上限,也就是「站在那片高地上真的打得到兵線」的最遠處。--side= 可覆寫。
const SIDE_MAX = +(ARG.side || 300);
const SIDE_STEP = 10;
const SIDE_RUN_MIN = 60;  // 高地要連續涵蓋這麼長的兵線才算「一側有高地」

/**
 * 結構 way 的覆蓋區間(遊戲公尺弧長)+ densify 後的世界折線;建不成結構回 intervals:[]。
 * 兩種結構共用這一支(判定順序與 biomes.js 的 carve 指派完全相同):
 *   直線剖面藏得住天花板 → **山體隧道**(under:false);
 *   藏不住(平地)→ 交給 underpassPlan 試 **地下道**(under:true,折線含兩端引道延伸段)。
 */
function tunnelRunOf(way, center, heightAt, hf) {
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

/** 兵線與 way 的同向重疊區間(兵線弧長 [s0,s1] 陣列) */
function overlapRuns(laneD, laneCum, wayPts, hw) {
  const runs = [];
  let cur = null;
  for (let i = 1; i < laneD.length; i++) {
    const mid = [(laneD[i][0] + laneD[i - 1][0]) / 2, (laneD[i][1] + laneD[i - 1][1]) / 2];
    const ex = laneD[i][0] - laneD[i - 1][0], ez = laneD[i][1] - laneD[i - 1][1], l = Math.hypot(ex, ez) || 1;
    const t = tangentAt(mid, wayPts);
    const on = ptPoly(mid, wayPts) <= hw + ROAD_SEG && Math.abs((ex / l) * t[0] + (ez / l) * t[1]) >= ALIGN;
    if (on) cur = cur || [laneCum[i - 1], 0];
    if (on) cur[1] = laneCum[i];
    else if (cur) { runs.push(cur); cur = null; }
  }
  if (cur) runs.push(cur);
  return runs.filter(([a, b]) => b - a >= ON_MIN);
}

async function scanVenue(v) {
  const cfg = venueConfig(v, 1);                  // teamSize 1 ⇒ L = 1(1v1)
  const res = { id: v.id, name: v.name, synthetic: cfg.synthetic, hits: {}, notes: [] };
  if (cfg.synthetic) res.notes.push('兵線為合成弧(無 baked 真實道路)');
  const bbox = battleBBox(cfg);
  const sampleElev = await elevSampler(bbox);
  if (!sampleElev) { res.error = '高程磚下載失敗'; return res; }
  const hf = buildHeightField(cfg, bbox, sampleElev);
  const { heightAt } = hf;
  const center = cfg.center;
  const laneW = cfg.lanes[0].map(([lat, lng]) => llToWorld(lat, lng, center));
  const laneD = densify(laneW, ROAD_SEG), laneCum = arcOf(laneD);
  // 兵線頂點就是 OSM 路網節點(venueLanes.js 烘焙時取自真實道路)⇒ 「兵線是否**走在**這條 way 上」
  // 用共用節點判定最紮實:純看 2D 距離會把「正下方的人行地下道 / 正上方的空橋」誤判成同一條路。
  const k6 = (lat, lng) => `${lat.toFixed(6)},${lng.toFixed(6)}`;
  const laneKeys = new Set(cfg.lanes[0].map(([lat, lng]) => k6(lat, lng)));
  const sharesNode = (way) => way.geometry.some((p) => laneKeys.has(k6(p.lat, p.lon)));

  const osm = await osmFor(v.id, bbox);
  if (!osm) { res.error = '取不到路網(Overpass 與 OSM API 皆不可達)'; return res; }
  res.osm = { src: osm.src || 'overpass', roads: osm.roads.length, rails: osm.rails.length,
    waters: (osm.waters || []).length, crossings: osm.crossings.length };

  // 兵線上「踩在立體結構上」的弧長區間(橋面 / 隧道含引道):⑧ 的側翼高地要扣掉這些段,
  // 使用者要的是**一般道路**上的高地對峙,不是站在橋上或洞裡比高度。
  const structArcs = [];

  // 橋跨的是水域還是陸域(2026-07-28 使用者需求:③ 要**純陸域**高架橋):
  //   ①與圖資水道相交,或②橋下地表沉在水/沼面之下 —— 兩者任一即判水域。
  // 第二條是為了抓沒被畫成 waterway 的湖/潟湖/海灣(遊戲端的 splitWaterPieces 也是看高程與水色)。
  const WET_Y = WATER.LEVEL + WATER.SWAMP_BAND;
  const waterWays = (osm.waters || []).map((w) => w.geometry.map((p) => llToWorld(p.lat, p.lon, center)));
  const spansWater = (wpts) => {
    for (let i = 1; i < wpts.length; i++) {
      for (const wp of waterWays) {
        for (let j = 1; j < wp.length; j++) {
          if (segCross(wpts[i - 1], wpts[i], wp[j - 1], wp[j])) return '水道';
        }
      }
    }
    for (const p of densify(wpts, ROAD_SEG)) if (heightAt(p[0], p[1]) <= WET_Y) return '水面';
    return null;
  };

  // ---- ①③⑤⑥ 結構 way(隧道/橋)----
  for (const way of osm.roads) {
    const isTun = strucTunnel(way.tags), isBrg = !!way.tags.bridge && !way.tags.tunnel;
    if (!isTun && !isBrg) continue;
    const hw = strucHw(way.tags);
    const wpts = way.geometry.map((p) => llToWorld(p.lat, p.lon, center));
    if (wpts.length < 2) continue;
    const runs = overlapRuns(laneD, laneCum, wpts, hw);
    const onLen = runs.reduce((s, [a, b]) => s + (b - a), 0);
    const name = way.tags.name || way.tags.highway;

    const canCarry = LANE_HW.test(way.tags.highway || '') && sharesNode(way);
    if (isBrg) {
      if (onLen >= ON_MIN && canCarry) {           // 兵線走在橋面上(車行橋 + 共用節點)
        structArcs.push(...runs);
        const wet = spansWater(wpts);
        if (wet) {                                 // 跨水橋:記錄但不算 ③(使用者要純陸域高架橋)
          const cur = res.hits2Water;
          if (!cur || onLen > cur.len) res.hits2Water = { name, len: Math.round(onLen), wet };
        } else {                                   // ③ 地面高架橋 = 純陸域上方
          const cur = res.hits.bridge;
          if (!cur || onLen > cur.len) res.hits.bridge = { name, len: Math.round(onLen) };
        }
      } else {                                     // ⑥ 兵線從橋下鑽過(純幾何交叉)
        for (let i = 1; i < laneD.length && !res.hits.underBridge; i++) {
          for (let j = 1; j < wpts.length; j++) {
            if (segCross(laneD[i - 1], laneD[i], wpts[j - 1], wpts[j])) { res.hits.underBridge = { name }; break; }
          }
        }
      }
      continue;
    }
    // 隧道/地下道:先問「執行期真的成洞嗎」(山體藏得住 → 隧道;平地 → 試挖地下道)
    const tr = tunnelRunOf(way, center, heightAt, hf);
    if (!tr || !tr.intervals.length) {
      // 圖資是地下道,山體藏不住、underpassPlan 也放棄(人行道 / 引道空間不足 / 太深 / 碰水)
      // ⇒ buildRoads 當一般道路。列出來供評估,不記成 hits(標記代表「遊戲裡真的走得到」,
      // 這裡走得到的是一條普通街道)。
      if (onLen >= ON_MIN && canCarry) {
        const cur = res.flatTunnel;
        if (!cur || onLen > cur.len) res.flatTunnel = { name, len: Math.round(onLen) };
        structArcs.push(...runs);
      }
      continue;
    }
    if (onLen >= ON_MIN && canCarry) structArcs.push(...runs);
    const covIdx = new Set();
    for (const [, , ia, ib] of tr.intervals) for (let i = ia; i <= ib; i++) covIdx.add(i);
    if (onLen >= ON_MIN && canCarry) {
      // ①/② 洞段:重疊段要真的落在覆蓋區間內(否則只是走在引道上)
      let covLen = 0;
      for (let i = 1; i < laneD.length; i++) {
        const mid = [(laneD[i][0] + laneD[i - 1][0]) / 2, (laneD[i][1] + laneD[i - 1][1]) / 2];
        if (ptPoly(mid, tr.pts) > hw + ROAD_SEG) continue;
        let k = 0, best = Infinity;
        for (let m = 0; m < tr.pts.length; m++) {
          const d = Math.hypot(mid[0] - tr.pts[m][0], mid[1] - tr.pts[m][1]);
          if (d < best) { best = d; k = m; }
        }
        if (covIdx.has(k)) covLen += laneCum[i] - laneCum[i - 1];
      }
      if (covLen >= ON_MIN) {
        // 山體隧道 = ①、地下道 = ②(深度來自山還是來自挖,是兩種場景)
        const key = tr.under ? 'underpass' : 'tunnel';
        const cur = res.hits[key];
        if (!cur || covLen > cur.len) res.hits[key] = { name, len: Math.round(covLen) };
        // ④ 明隧道:同一條隧道的側向土牆體檢(biomes.js 唯一結算縫)。
        // 地下道不在此列 —— 它的頂是沒被開挖的原地表,buildRoads 一律把 open 歸零(見 A29)。
        const cov = tr.pts.map((_, i) => covIdx.has(i));
        for (const side of [1, -1]) {
          if (tr.under) break;
          const prof = tunnelWallProfile(tr.pts, tr.floors, cov, heightAt, TUN.HW, side);
          const n = prof.filter((g) => g.open).length;
          if (n) {
            const cur2 = res.hits.gallery;
            if (!cur2 || n > cur2.pts) res.hits.gallery = { name, pts: n, side, len: Math.round(n * ROAD_SEG) };
          }
        }
      }
    } else if (!sharesNode(way)) {
      // ⑦ 穿越地下道上方:兵線不在這條隧道上(不共節點)且**橫越**它的覆蓋段 = 從洞頂走過去。
      // 只認「橫越」:平行並行的另一個孔(例如同一座山的人行孔)在高度場上與兵線同層,
      // 不是「上下分層」的測試場景 —— 那條規則放進來會讓 jinlong 的人行孔誤判成 ⑦。
      for (let i = 1; i < laneD.length && !res.hits.overTunnel; i++) {
        for (let j = 1; j < tr.pts.length; j++) {
          if (!segCross(laneD[i - 1], laneD[i], tr.pts[j - 1], tr.pts[j])) continue;
          if (covIdx.has(j) || covIdx.has(j - 1)) { res.hits.overTunnel = { name }; break; }
        }
      }
    }
  }

  // ---- ① 的候選診斷:bbox 內「執行期真的成洞」的車行隧道 + 它的**深度**----
  // 「地表高 − 路面高」在高度場上同時是「上方有多少土」與「路面沉在地表之下多深」——
  // 語意上是**深度**(2026-07-28 使用者指正):地下道的關鍵尺寸是路面下沉多少,不是頂上多厚。
  // 使用者要的 ① 是「地下道感」= 短、**淺**(路面只沉十來公尺就出來)、周邊地形平坦;
  // 金龍隧道那種深覆蓋是「山體隧道」。深度取覆蓋段的中位數。
  for (const w of osm.roads) {
    if (!strucTunnel(w.tags) || !LANE_HW.test(w.tags.highway || '') || w.geometry.length < 2) continue;
    const tr = tunnelRunOf(w, center, heightAt, hf);
    if (!tr || !tr.intervals.length) continue;
    if (tr.under) {                       // 地下道走 ② 的候選清單(深度來自挖,不是山)
      const covLen2 = tr.intervals.reduce((a, [s0, s1]) => a + (s1 - s0), 0);
      const d2 = Math.round(Math.min(...tr.pts.map((p) => ptPoly(p, laneD))));
      const c2 = { name: w.tags.name || w.tags.highway, len: Math.round(covLen2), depth: Math.round(tr.sink), d: d2 };
      if (!res.underCand || d2 < res.underCand.d) res.underCand = c2;
      continue;
    }
    const th = [];
    for (const [, , ia, ib] of tr.intervals) {
      for (let i = ia; i <= ib; i++) th.push(heightAt(tr.pts[i][0], tr.pts[i][1]) - tr.floors[i]);
    }
    if (!th.length) continue;
    th.sort((a, b) => a - b);
    const covLen = tr.intervals.reduce((a, [s0, s1]) => a + (s1 - s0), 0);
    const d = Math.round(Math.min(...tr.pts.map((p) => ptPoly(p, laneD))));
    const cand = { name: w.tags.name || w.tags.highway, len: Math.round(covLen),
                   depth: Math.round(th[th.length >> 1]), d };
    // 首選「最淺」的那條(路面沉得越少越像地下道);同深度取離兵線近的
    if (!res.tunnelCand || cand.depth < res.tunnelCand.depth
        || (cand.depth === res.tunnelCand.depth && d < res.tunnelCand.d)) res.tunnelCand = cand;
  }

  // ---- ③ 的候選診斷:bbox 內有沒有「純陸域的車行高架橋」(兵線沒走到也列出來)----
  // 用途:③ 目前只有跨水橋時,靠這份清單判斷「哪個場地換個錨點重烤兵線就能踩上陸域高架橋」。
  for (const w of osm.roads) {
    if (!w.tags.bridge || w.tags.tunnel || !LANE_HW.test(w.tags.highway || '') || w.geometry.length < 2) continue;
    const wpts = w.geometry.map((p) => llToWorld(p.lat, p.lon, center));
    if (spansWater(wpts)) continue;
    let len = 0;
    for (let i = 1; i < wpts.length; i++) len += Math.hypot(wpts[i][0] - wpts[i - 1][0], wpts[i][1] - wpts[i - 1][1]);
    if (len < ON_MIN) continue;
    const d = Math.round(Math.min(...wpts.map((p) => ptPoly(p, laneD))));
    if (!res.landBridgeCand || d < res.landBridgeCand.d) {
      res.landBridgeCand = { name: w.tags.name || w.tags.highway, len: Math.round(len), d };
    }
  }

  // ---- ⑦ 的候選診斷:bbox 內有沒有「任一車行道從覆蓋段隧道上方跨過」----
  // ⑦ 要的是**兵線**從洞頂走過,可遇不可求;這裡順手回報「這張地圖上存不存在這種交叉、
  // 離兵線多遠」,好判斷「換個錨點/方位角重烤兵線」有沒有機會把 ⑦ 湊出來(離兵線越近越有機會)。
  {
    const tunRuns = [];
    for (const w of osm.roads) {
      if (!strucTunnel(w.tags) || w.geometry.length < 2) continue;
      const tr = tunnelRunOf(w, center, heightAt, hf);
      if (!tr || !tr.intervals.length) continue;
      const cov = new Set();
      for (const [, , ia, ib] of tr.intervals) for (let i = ia; i <= ib; i++) cov.add(i);
      tunRuns.push({ name: w.tags.name || w.tags.highway, tr, cov });
    }
    for (const t of tunRuns) {
      for (const w of osm.roads) {
        if (w.tags.tunnel || w.tags.bridge || w.geometry.length < 2) continue;
        const rp = w.geometry.map((p) => llToWorld(p.lat, p.lon, center));
        for (let i = 1; i < rp.length; i++) {
          for (let j = 1; j < t.tr.pts.length; j++) {
            if (!segCross(rp[i - 1], rp[i], t.tr.pts[j - 1], t.tr.pts[j])) continue;
            if (!t.cov.has(j) && !t.cov.has(j - 1)) continue;
            const d = ptPoly(rp[i], laneD);
            if (!res.overTunnelCand || d < res.overTunnelCand.d) {
              res.overTunnelCand = { road: w.tags.name || w.tags.highway, tunnel: t.name, d: Math.round(d) };
            }
          }
        }
      }
    }
  }

  // ---- ⑧ 側翼高地(altTier() = 一座砲塔高 = 高度差加成門檻)----
  // 2026-07-28 使用者需求:**扣掉隧道/地下道/高架橋段**。理由是語意:在地下道裡側面地形之所以
  // 「比兵線高」,只是因為**路面沉得深**(那個高度差就是地下道的深度),不是可以佔領的戰術高地;
  // 站在橋面上比更沒有意義。要的是「一般道路的兵線,單側地形高過一座砲塔」。
  // structArcs = 兵線踩在立體結構上的弧長區間(含引道)。
  {
    const T = altTier();
    const onStruct = (sArc) => structArcs.some(([a, b]) => sArc >= a - ROAD_SEG && sArc <= b + ROAD_SEG);
    const gain = [[], []];
    for (let i = 0; i < laneD.length; i++) {
      const a = laneD[Math.max(0, i - 1)], c = laneD[Math.min(laneD.length - 1, i + 1)];
      let dx = c[0] - a[0], dz = c[1] - a[1];
      const l = Math.hypot(dx, dz) || 1; dx /= l; dz /= l;
      const base = heightAt(laneD[i][0], laneD[i][1]);
      [1, -1].forEach((side, si) => {
        const nx = dz * side, nz = -dx * side;
        let best = -Infinity;
        for (let d = SIDE_STEP; d <= SIDE_MAX; d += SIDE_STEP) {
          best = Math.max(best, heightAt(laneD[i][0] + nx * d, laneD[i][1] + nz * d) - base);
        }
        gain[si].push(best);
      });
    }
    let bestRun = 0, peak = -Infinity, bestSide = 0;
    gain.forEach((g, si) => {
      let s0 = null;
      for (let i = 0; i < g.length; i++) {
        if (onStruct(laneCum[i])) { s0 = null; continue; }   // 結構段整段跳過(含引道)
        peak = Math.max(peak, g[i]);
        if (g[i] >= T) {
          if (s0 === null) s0 = laneCum[i];
          const run = laneCum[i] - s0;
          if (run > bestRun) { bestRun = run; bestSide = si ? -1 : 1; }
        } else s0 = null;
      }
    });
    if (bestRun >= SIDE_RUN_MIN) {
      res.hits.highGround = { len: Math.round(bestRun), peak: Math.round(peak), side: bestSide };
    }
    res.peakSide = Number.isFinite(peak) ? Math.round(peak) : null;
  }

  // ---- ④ 平交道(圖資 railway=level_crossing 節點落在兵線上)----
  for (const c of osm.crossings) {
    const p = llToWorld(c.lat, c.lng, center);
    const d = ptPoly(p, laneD);
    if (d <= XING_R) {
      const cur = res.hits.crossing;
      if (!cur || d < cur.d) res.hits.crossing = { d: Math.round(d) };
    }
  }
  return res;
}

/**
 * 探測模式(--probe=lat,lng[,名稱]):不需要 baked 兵線,只問「這個點周邊一張 L1 地圖裡,
 * 有沒有執行期真的成洞的車行隧道、覆蓋多長多厚」。用來替 ①(地下道感 = 短、覆蓋薄)找新場地。
 * ④ 明隧道候選也在此體檢:對每條成洞山體隧道跑 `tunnelWallProfile`(與執行期同一縫)兩側,
 * 報 open 點數 × ROAD_SEG = 明隧道段長 —— 判定與兵線無關(只吃地形與隧道軸),探測即可定案。
 * bbox 與 L1 同尺寸(`--probe-r=N` 可放大 N 倍廣域掃,找到後再精確定錨);
 * 每條成洞隧道/明隧道段都回報**經緯度中點** —— L1 bbox 半徑僅 ~266 真實公尺,
 * 憑地名記憶下錨必偏,拿中點座標當錨點才擺得準。
 * heightAt 用「東西向穿過該點的假兵線」餵 AMP(探測只需大略地形)。
 */
async function probePoint(lat, lng, label) {
  const half = sideMFor(1) / 2 * MAPGEO.REAL_SCALE * MAPGEO.MAP_EXPAND * (+ARG['probe-r'] || 1);
  const dLat = half / R_EARTH * 180 / Math.PI, dLng = half / (R_EARTH * Math.cos(d2r(lat))) * 180 / Math.PI;
  const bbox = { minLat: lat - dLat, maxLat: lat + dLat, minLng: lng - dLng, maxLng: lng + dLng };
  const sampleElev = await elevSampler(bbox);
  if (!sampleElev) return console.log(`${label}:高程磚下載失敗`);
  const A = [lat, lng - dLng * 0.7], B = [lat, lng + dLng * 0.7];
  const cfg = { center: { lat, lng }, bases: { SWARM: A, STEEL: B }, lanes: [[A, B]], venue: { mix: { urban: 0.6 } } };
  const hf = buildHeightField(cfg, bbox, sampleElev);
  const { heightAt } = hf;
  const osm = await osmFor(`probe_${lat.toFixed(4)}_${lng.toFixed(4)}`, bbox);
  if (!osm) return console.log(`${label}:取不到路網`);
  const found = [];
  for (const w of osm.roads) {
    if (!strucTunnel(w.tags) || !LANE_HW.test(w.tags.highway || '') || w.geometry.length < 2) continue;
    const tr = tunnelRunOf(w, cfg.center, heightAt, hf);
    if (!tr || !tr.intervals.length) { found.push({ name: w.tags.name || w.tags.highway, flat: true }); continue; }
    const th = [];
    for (const [, , ia, ib] of tr.intervals) for (let i = ia; i <= ib; i++) th.push(heightAt(tr.pts[i][0], tr.pts[i][1]) - tr.floors[i]);
    th.sort((a, b) => a - b);
    // 世界座標 → 經緯度(llToWorld 的逆換算;錨點擺位要用)
    const w2ll = ([x, z]) => `${(lat - z / (R_EARTH * WORLD_S) * 180 / Math.PI).toFixed(5)},${(lng + x / (R_EARTH * Math.cos(d2r(lat)) * WORLD_S) * 180 / Math.PI).toFixed(5)}`;
    const covList = [];
    for (const [, , ia, ib] of tr.intervals) for (let i = ia; i <= ib; i++) covList.push(i);
    const covMid = tr.pts[covList[covList.length >> 1]];
    // ④ 明隧道體檢:同 scanVenue 的判定縫(tunnelWallProfile),取兩側 open 點數較大者
    let gal = 0, galSide = 0, galMid = null;
    if (!tr.under) {
      const cov = tr.pts.map((_, i) => covList.includes(i));
      for (const side of [1, -1]) {
        const opens = [];
        tunnelWallProfile(tr.pts, tr.floors, cov, heightAt, TUN.HW, side).forEach((g, i) => { if (g.open) opens.push(i); });
        if (opens.length > gal) { gal = opens.length; galSide = side; galMid = tr.pts[opens[opens.length >> 1]]; }
      }
    }
    found.push({ name: w.tags.name || w.tags.highway, under: tr.under,
      len: Math.round(tr.intervals.reduce((a, [s0, s1]) => a + (s1 - s0), 0)),
      depth: Math.round(th[th.length >> 1]), gal, galSide,
      at: covMid ? w2ll(covMid) : '', galAt: galMid ? w2ll(galMid) : '' });
  }
  const real = found.filter((f) => !f.flat && !f.under).sort((a, b) => a.depth - b.depth);
  const und = found.filter((f) => f.under);
  const galHits = real.filter((f) => f.gal).sort((a, b) => b.gal - a.gal);
  console.log(`${label} (${lat},${lng}) 車行隧道 ${found.length} 條、山體成洞 ${real.length} 條、地下道 ${und.length} 條、明隧道 ${galHits.length} 條`
    + (real.length ? `　最淺山體洞:${real.slice(0, 3).map((f) => `${f.name} 覆蓋${f.len}m/深${f.depth}m @${f.at}`).join('、')}` : '')
    + (galHits.length ? `　明隧道:${galHits.slice(0, 3).map((f) => `${f.name} open ${f.gal}點≈${Math.round(f.gal * ROAD_SEG)}m(side ${f.galSide},覆蓋${f.len}m)@${f.galAt}`).join('、')}` : '')
    + (und.length ? `　地下道:${und.slice(0, 3).map((f) => `${f.name} 覆蓋${f.len}m @${f.at}`).join('、')}` : '')
    + (found.length - real.length - und.length ? `　平地不成洞 ${found.length - real.length - und.length} 條` : ''));
}

if (ARG.probe) {
  for (const spec of ARG.probe.split(';')) {
    const [la, ln, ...rest] = spec.split(',');
    await probePoint(+la, +ln, rest.join(',') || spec);
  }
  process.exit(0);
}

// ---- 主流程 ----
// 隧道與地下道是**兩種東西**,判定與分類一律分開(2026-07-28 使用者指示):
//   隧道   道路平坦,鑽進突起的地形 —— 深度來自「山」。
//   地下道 地形平坦,路面一端往下、另一端再上來 —— 深度來自「挖」。
//          2026-07-28 起引擎會生成:直線剖面藏不住天花板時改吃 `underpassPlan` 的下沉剖面
//          (兩端接引道、中段平底),覆蓋判定與後續構件一律沿用隧道那一套。
//          放棄的情形(人行道 / 引道空間不足 / 要挖到 SINK_MAX 以上 / 走廊碰水)仍當一般道路,
//          在報告裡列成「落空地下道」。
const SCEN = [
  ['tunnel', '① 隧道(山體)'],
  ['underpass', '② 地下道(平地下穿)'],
  ['bridge', '③ 地面高架橋'],
  ['gallery', '④ 明隧道'],
  ['crossing', '⑤ 平交道'],
  ['underBridge', '⑥ 穿越高架橋底部'],
  ['overTunnel', '⑦ 穿越地下道上方'],
  ['highGround', '⑧ 一側高於一座砲塔'],
];
// 引擎尚未生成的場景:報告但不計入「缺場地」(換地圖解不了,要改引擎)。
// 2026-07-28:`underpass` 已隨 underpassPlan 落地 ⇒ 此表清空(留著結構,下一個缺口照樣掛得上)。
const KNOWN_GAP = new Map();
{ // 場景代號 MUST 與 venues.js 的 SCEN_LABEL 同集合(標記與判定分家 = 標了卻沒人驗)
  const a = SCEN.map(([k]) => k).sort().join(','), b = Object.keys(SCEN_LABEL).sort().join(',');
  if (a !== b) throw new Error(`場景代號與 venues.js SCEN_LABEL 不一致:\n  稽核 ${a}\n  標記 ${b}`);
}

// 整支時間預算(分鐘;0 = 不限)。Overpass 公共節點排隊時單一場地可能等上一分鐘,
// 22 個場地跑成一小時的 CI job 誰也看不到中途進度 ⇒ 超時就把剩下的場地標成「未掃」,
// 先把已完成的印出來。快取(.scen_cache)保留 ⇒ 下一次接著跑就會補完。
const MAX_MS = (+(ARG['max-min'] || 0)) * 60000;
const T_START = Date.now();

const list = VENUES.filter((v) => !ONLY.length || ONLY.includes(v.id));
console.log(`1v1(L1)兵線立體場景稽核 —— 場地 ${list.length}、砲塔高 ${TARGET_H.tower}m、`
  + `側向掃描 ${SIDE_MAX} 遊戲公尺(塔射程 ${UNITS.tower.range})\n`);
const results = [];
let skipped = 0;
for (const v of list) {
  if (MAX_MS && Date.now() - T_START > MAX_MS) {
    skipped++;
    console.log(`${(v.id + ' ').padEnd(15, '·')} ⏭ 時間預算用盡,未掃(快取保留,下次接著跑)`);
    continue;
  }
  const t0 = Date.now();
  const r = await scanVenue(v);
  r.secs = ((Date.now() - t0) / 1000).toFixed(0);
  results.push(r);
  const marks = SCEN.map(([k]) => (r.hits[k] ? '●' : '·')).join(' ');
  const detail = SCEN.filter(([k]) => r.hits[k]).map(([k, label]) => {
    const h = r.hits[k];
    return `${label.slice(0, 2)}${h.name ? h.name : ''}${h.len ? ` ${h.len}m` : ''}${k === 'highGround' ? ` +${h.peak}m` : ''}`;
  }).join('、');
  console.log(`${(r.id + ' ').padEnd(15, '·')} ${marks}  側向峰值 +${r.peakSide ?? '?'}m  ${r.secs}s  `
    + `${r.osm ? `[${r.osm.src} 路 ${r.osm.roads}/軌 ${r.osm.rails}/平交 ${r.osm.crossings}] ` : ''}`
    + `${r.error ? `⚠️ ${r.error}` : detail || '(無)'}`
    + `${r.hits2Water ? `　跨水橋(不算③):${r.hits2Water.name} ${r.hits2Water.len}m/${r.hits2Water.wet}` : ''}`
    + `${r.landBridgeCand ? `　③候選陸橋:${r.landBridgeCand.name} ${r.landBridgeCand.len}m 離兵線 ${r.landBridgeCand.d}m` : ''}`
    + `${r.flatTunnel ? `　落空地下道(規劃放棄,仍是平街):${r.flatTunnel.name} ${r.flatTunnel.len}m` : ''}`
    + `${r.underCand ? `　②候選地下道:${r.underCand.name} 覆蓋 ${r.underCand.len}m/沉 ${r.underCand.depth}m 離兵線 ${r.underCand.d}m` : ''}`
    + `${r.tunnelCand ? `　①候選洞:${r.tunnelCand.name} 覆蓋 ${r.tunnelCand.len}m/深 ${r.tunnelCand.depth}m 離兵線 ${r.tunnelCand.d}m` : ''}`
    + `${r.overTunnelCand ? `　⑦候選:${r.overTunnelCand.road}×${r.overTunnelCand.tunnel} 離兵線 ${r.overTunnelCand.d}m` : ''}`);
}

console.log('\n各場景可用的 1v1 預設場地:');
let missing = 0;
const pick = {};
for (const [k, label] of SCEN) {
  const hit = results.filter((r) => r.hits[k]);
  if (KNOWN_GAP.has(k)) {                       // 已知缺口:列候選,不計入缺場地
    const cand = results.filter((r) => r.flatTunnel)
      .map((r) => `${r.id}(${r.flatTunnel.name} ${r.flatTunnel.len}m)`);
    console.log(`  ${label}:⚠️ ${KNOWN_GAP.get(k)}`);
    console.log(`      圖資上是地下道的兵線段(引擎支援後即成立):${cand.join('、') || '(無)'}`);
    continue;
  }
  if (!hit.length) {
    missing++;
    console.log(`  ${label}:❌ 沒有任何預設場地 —— 需新增測試場地`);
    if (k === 'underpass') {   // 沒場地時把候選一起印出來:離兵線多遠、規劃有沒有落空,決定要不要重烤兵線
      const cand = results.filter((r) => r.underCand).map((r) => `${r.id}(${r.underCand.name} ${r.underCand.len}m 離兵線 ${r.underCand.d}m)`);
      const lost = results.filter((r) => r.flatTunnel).map((r) => `${r.id}(${r.flatTunnel.name})`);
      console.log(`      bbox 內建得出來的地下道:${cand.join('、') || '(無)'}`);
      console.log(`      規劃落空(仍是平街):${lost.join('、') || '(無)'}`);
    }
    continue;
  }
  // 首選 = 該場景「量」最大的場地(隧道/橋取長度、高地取連續長度、平交道取最近)
  const score = (r) => {
    const h = r.hits[k];
    return k === 'crossing' ? -h.d : (h.len ?? h.pts ?? 1);
  };
  hit.sort((a, b) => score(b) - score(a));
  pick[k] = hit[0].id;
  console.log(`  ${label}:${hit[0].id}(${hit[0].name})　其他:${hit.slice(1).map((r) => r.id).join('、') || '—'}`);
}
// ---- venues.js 的 scen 標記 MUST 對得上實測(標記是給玩家看的提示,不能是臆測)----
// 只在「整批掃描且該場地確實取得圖資」時比對:--only= 或 Overpass 掛掉時無從判定漏標。
let tagBad = 0;
if (!ONLY.length && !skipped) {
  console.log('\nvenues.js scen 標記複驗:');
  for (const r of results) {
    if (r.error) { console.log(`  ⚠️ ${r.id}:${r.error} —— 無法複驗標記`); continue; }
    const want = SCEN.map(([k]) => k).filter((k) => !KNOWN_GAP.has(k) && r.hits[k]);
    const have = VENUES.find((v) => v.id === r.id).scen || [];
    const extra = have.filter((k) => !want.includes(k)), miss = want.filter((k) => !have.includes(k));
    if (!extra.length && !miss.length) continue;
    tagBad++;
    console.log(`  ❌ ${r.id}:${extra.length ? `多標 ${extra.join('、')}` : ''}`
      + `${extra.length && miss.length ? ' / ' : ''}${miss.length ? `漏標 ${miss.join('、')}` : ''}`
      + `　實測 = [${want.join(', ')}]`);
  }
  if (!tagBad) console.log('  ✓ 全數相符');
}
if (ARG.json) writeFileSync(ARG.json, JSON.stringify({ results, pick }, null, 2));
const NEED = SCEN.length - KNOWN_GAP.size;   // 已知缺口不列入分母(換地圖解不了)
console.log(`\n總結:${NEED - missing}/${NEED} 種場景有預設場地(另 ${KNOWN_GAP.size} 種為引擎已知缺口)、標記不符 ${tagBad}`
  + `${skipped ? `、未掃 ${skipped} 個場地(時間預算)` : ''}`);
process.exit(missing || tagBad || skipped ? 1 : 0);
