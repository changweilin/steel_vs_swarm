// ============ 1v1 兵線立體場景稽核(離線;找測試用預設場地)============
// 用途:回答「哪一個預設場地的 **1v1(L1)兵線**上,真的走得到某種立體交通場景」——
// 供手動測試七種情境各挑一張預設地圖:
//   ① 地下道(兵線走進山體隧道)              ② 地面高架橋(兵線走在橋面上)
//   ③ 明隧道(隧道側向土牆藏不住結構那一側)  ④ 平交道(兵線與地面鐵軌平面交會)
//   ⑤ 穿越高架橋底部(兵線從橋下鑽過)        ⑥ 穿越地下道上方(兵線從洞頂走過)
//   ⑦ 其中一側有超過一座砲塔高的地形(altTier() = TARGET_H.tower,高度差加成的觸發門檻)
//
// 資料來源與執行期完全同源:
//   - 兵線/主堡/bbox:`venues.js venueConfig(v, 1)` + `data.js battleBBox`(teamSize=1 ⇒ L=1)
//   - 路網/鐵路/平交道:Overpass,查詢字串與 `biomes.js fetchOsmRoads/fetchOsmFeatures` 同一份
//   - 高程:AWS terrarium 磚(= `terrain.js` 主來源),再走同一條「3×3 平滑 → 兵線外 AMP 放大
//     → 塔位乾地帶抬升」管線,故本工具的 heightAt 與遊戲內地形同形。
//   - 隧道覆蓋/明隧道判定:**直接執行 `biomes.js` 的函式原文**(tunnelCoverIntervals /
//     tunnelWallProfile;抽原文的理由同 audit_open_tunnel.mjs —— biomes.js 的 three 走 CDN
//     importmap,Node 端 import 不了,另抄一份公式則永遠會通過)。
//
// 網路:第一次跑會抓 Overpass + terrarium,結果寫進 `tools/.scen_cache/`(之後純離線可重跑)。
// 用法:node tools/audit_lane_scenarios.mjs [--only=jinlong,london] [--json=out.json]
// 退出碼:0 = 七種場景各至少有一個場地;1 = 有場景無場地(需要新增測試場地)
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { inflateSync } from 'node:zlib';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { VENUES, venueConfig } from '../public/js/venues.js';
import { MAPGEO, TERRAIN, WATER, GAME, UNITS, TARGET_H, altTier, battleBBox, solveTowerSites } from '../public/js/data.js';

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
const TUN = pickConst('TUN', { CLEAR: 8 });              // CLEAR = LOS.TUN_CLEAR_M
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
      const r = await fetch(url);
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

// 限流(429/504)才值得等著重試;403/405 = 出口政策擋掉(沙箱/公司網路),等再久也一樣 ⇒ 立刻放棄
const RETRYABLE = new Set([429, 502, 503, 504]);
async function overpass(q) {
  let retryable = false;
  for (let round = 0; round < 3; round++) {
    for (const url of OVERPASS) {
      try {
        const r = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: 'data=' + encodeURIComponent(q),
        });
        if (!r.ok) { retryable = retryable || RETRYABLE.has(r.status); continue; }
        const d = await r.json();
        if (d.remark) { retryable = true; continue; }   // 伺服器截斷/逾時:換鏡像重抓
        return d.elements || [];
      } catch { retryable = true; }                     // 連線層失敗:可能只是抖動
    }
    if (!retryable) return null;
    retryable = false;
    await sleep(4000 * (round + 1));
  }
  return null;
}

async function osmFor(id, bbox) {
  const f = join(CACHE, `${id}_L1.json`);
  if (existsSync(f)) return JSON.parse(readFileSync(f, 'utf8'));
  const bb = `${bbox.minLat.toFixed(5)},${bbox.minLng.toFixed(5)},${bbox.maxLat.toFixed(5)},${bbox.maxLng.toFixed(5)}`;
  const km2 = bboxKm2(bbox);
  const nMain = quotaOf(km2, 150, 150, 600), nMinor = quotaOf(km2, 1300, 400, 1600);
  const roads = await overpass(`[out:json][timeout:60];`
    + `way["highway"~"^(motorway|trunk|primary|secondary|tertiary)$"](${bb});out geom ${nMain};`
    + `way["highway"~"^(unclassified|residential|living_street|service|track|path|footway|pedestrian)$"](${bb});out geom ${nMinor};`);
  if (!roads) return null;
  const feats = await overpass(`[out:json][timeout:60];`
    + `way["railway"~"^(rail|subway|light_rail|monorail|narrow_gauge|tram)$"](${bb});out geom 60;`
    + `node["railway"="level_crossing"](${bb});out 40;`);
  if (!feats) return null;
  const out = {
    roads: roads.filter((e) => e.type === 'way' && e.geometry && e.tags?.highway).map((e) => ({ tags: e.tags, geometry: e.geometry })),
    rails: feats.filter((e) => e.type === 'way' && e.geometry && e.tags?.railway).map((e) => ({ tags: e.tags, geometry: e.geometry })),
    crossings: feats.filter((e) => e.type === 'node' && e.tags?.railway === 'level_crossing').map((e) => ({ lat: e.lat, lng: e.lon })),
  };
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

/** 結構 way 的覆蓋區間(遊戲公尺弧長)+ densify 後的世界折線;非隧道回 intervals:[] */
function tunnelRunOf(way, center, heightAt) {
  const raw = way.geometry.map((p) => llToWorld(p.lat, p.lon, center));
  if (raw.length < 2) return null;
  const pts = densify(raw, ROAD_SEG);
  const cum = arcOf(pts);
  const tot = cum[cum.length - 1] || 1;
  const hA = heightAt(pts[0][0], pts[0][1]), hB = heightAt(pts[pts.length - 1][0], pts[pts.length - 1][1]);
  const floors = cum.map((s) => hA + (hB - hA) * (s / tot));
  const intervals = tunnelCoverIntervals(pts, cum, floors, heightAt);
  return { pts, cum, floors, intervals };
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
  const { heightAt } = buildHeightField(cfg, bbox, sampleElev);
  const center = cfg.center;
  const laneW = cfg.lanes[0].map(([lat, lng]) => llToWorld(lat, lng, center));
  const laneD = densify(laneW, ROAD_SEG), laneCum = arcOf(laneD);

  // ---- ⑦ 側向高地(不需要 OSM;altTier() = 一座砲塔高 = 高度差加成門檻)----
  {
    const T = altTier();
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
    res.peakSide = Math.round(peak);
  }

  const osm = await osmFor(v.id, bbox);
  if (!osm) { res.error = 'Overpass 取不到路網(限流/無網路)'; return res; }
  res.osm = { roads: osm.roads.length, rails: osm.rails.length, crossings: osm.crossings.length };

  // ---- ①③⑤⑥ 結構 way(隧道/橋)----
  for (const way of osm.roads) {
    const isTun = !!way.tags.tunnel, isBrg = !!way.tags.bridge && !way.tags.tunnel;
    if (!isTun && !isBrg) continue;
    const hw = strucHw(way.tags);
    const wpts = way.geometry.map((p) => llToWorld(p.lat, p.lon, center));
    if (wpts.length < 2) continue;
    const runs = overlapRuns(laneD, laneCum, wpts, hw);
    const onLen = runs.reduce((s, [a, b]) => s + (b - a), 0);
    const name = way.tags.name || way.tags.highway;

    if (isBrg) {
      if (onLen >= ON_MIN) {                       // ② 兵線走在橋面上
        const cur = res.hits.bridge;
        if (!cur || onLen > cur.len) res.hits.bridge = { name, len: Math.round(onLen) };
      } else {                                     // ⑤ 兵線從橋下鑽過(純幾何交叉)
        for (let i = 1; i < laneD.length && !res.hits.underBridge; i++) {
          for (let j = 1; j < wpts.length; j++) {
            if (segCross(laneD[i - 1], laneD[i], wpts[j - 1], wpts[j])) { res.hits.underBridge = { name }; break; }
          }
        }
      }
      continue;
    }
    // 隧道:先問「執行期真的成洞嗎」(平坦市區掛 tunnel tag 不立結構)
    const tr = tunnelRunOf(way, center, heightAt);
    if (!tr || !tr.intervals.length) continue;
    const covIdx = new Set();
    for (const [, , ia, ib] of tr.intervals) for (let i = ia; i <= ib; i++) covIdx.add(i);
    if (onLen >= ON_MIN) {
      // ① 地下道:重疊段要真的落在覆蓋區間內(否則只是走在引道上)
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
        const cur = res.hits.tunnel;
        if (!cur || covLen > cur.len) res.hits.tunnel = { name, len: Math.round(covLen) };
        // ③ 明隧道:同一條隧道的側向土牆體檢(biomes.js 唯一結算縫)
        const cov = tr.pts.map((_, i) => covIdx.has(i));
        for (const side of [1, -1]) {
          const prof = tunnelWallProfile(tr.pts, tr.floors, cov, heightAt, TUN.HW, side);
          const n = prof.filter((g) => g.open).length;
          if (n) {
            const cur2 = res.hits.gallery;
            if (!cur2 || n > cur2.pts) res.hits.gallery = { name, pts: n, side, len: Math.round(n * ROAD_SEG) };
          }
        }
      }
    } else {
      // ⑥ 穿越地下道上方:兵線與隧道走廊幾何交叉,且交點落在覆蓋段(洞頂)
      for (let i = 1; i < laneD.length && !res.hits.overTunnel; i++) {
        for (let j = 1; j < tr.pts.length; j++) {
          if (!segCross(laneD[i - 1], laneD[i], tr.pts[j - 1], tr.pts[j])) continue;
          if (covIdx.has(j) || covIdx.has(j - 1)) { res.hits.overTunnel = { name }; break; }
        }
      }
    }
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

// ---- 主流程 ----
const SCEN = [
  ['tunnel', '① 地下道'],
  ['bridge', '② 地面高架橋'],
  ['gallery', '③ 明隧道'],
  ['crossing', '④ 平交道'],
  ['underBridge', '⑤ 穿越高架橋底部'],
  ['overTunnel', '⑥ 穿越地下道上方'],
  ['highGround', '⑦ 一側高於一座砲塔'],
];

const list = VENUES.filter((v) => !ONLY.length || ONLY.includes(v.id));
console.log(`1v1(L1)兵線立體場景稽核 —— 場地 ${list.length}、砲塔高 ${TARGET_H.tower}m、`
  + `側向掃描 ${SIDE_MAX} 遊戲公尺(塔射程 ${UNITS.tower.range})\n`);
const results = [];
for (const v of list) {
  const r = await scanVenue(v);
  results.push(r);
  const marks = SCEN.map(([k]) => (r.hits[k] ? '●' : '·')).join(' ');
  const detail = SCEN.filter(([k]) => r.hits[k]).map(([k, label]) => {
    const h = r.hits[k];
    return `${label.slice(0, 2)}${h.name ? h.name : ''}${h.len ? ` ${h.len}m` : ''}${k === 'highGround' ? ` +${h.peak}m` : ''}`;
  }).join('、');
  console.log(`${(r.id + ' ').padEnd(15, '·')} ${marks}  側向峰值 +${r.peakSide ?? '?'}m  `
    + `${r.error ? `⚠️ ${r.error}` : detail || '(無)'}`);
}

console.log('\n各場景可用的 1v1 預設場地:');
let missing = 0;
const pick = {};
for (const [k, label] of SCEN) {
  const hit = results.filter((r) => r.hits[k]);
  if (!hit.length) { missing++; console.log(`  ${label}:❌ 沒有任何預設場地 —— 需新增測試場地`); continue; }
  // 首選 = 該場景「量」最大的場地(隧道/橋取長度、高地取連續長度、平交道取最近)
  const score = (r) => {
    const h = r.hits[k];
    return k === 'crossing' ? -h.d : (h.len ?? h.pts ?? 1);
  };
  hit.sort((a, b) => score(b) - score(a));
  pick[k] = hit[0].id;
  console.log(`  ${label}:${hit[0].id}(${hit[0].name})　其他:${hit.slice(1).map((r) => r.id).join('、') || '—'}`);
}
if (ARG.json) writeFileSync(ARG.json, JSON.stringify({ results, pick }, null, 2));
console.log(`\n總結:${SCEN.length - missing}/${SCEN.length} 種場景有預設場地`);
process.exit(missing ? 1 : 0);
