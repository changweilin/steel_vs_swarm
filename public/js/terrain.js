// ============ 即時 3D 地形(改自 mapping_elf terrainViewer.js)============
// 依戰場設定(bbox)即時抓取高程資料建立地形網格,疊上衛星影像貼圖。
//  - 高程主來源:AWS Terrain Tiles(terrarium PNG,免金鑰、CORS 開放)
//  - 高程備援:open-meteo elevation API(mapping_elf 原本的來源,批次 100 點)
//  - 貼圖:Esri World Imagery(與 mapManager 同來源)拼接成 canvas 紋理
//
// 世界座標:以戰場中心為原點,x = 東(公尺),z = 南(three.js 慣例;
// 模擬層的「北」= -z)。heightAt(x, z) 供機甲貼地、小兵放置使用。
import * as THREE from 'three';
import { envMat } from './hazards.js';
import { setWeatherField } from './toon.js';
import { makeField, makeToneLadder, bakeFieldTexture } from './field.js';
import { MAPGEO, TERRAIN, GAME, WATER, battleBBox, solveTowerSites, curveMaxEdgeM } from './data.js';
import { geoGet, geoPut, geoKey } from './geocache.js';

// 涵蓋範圍幾何搬到 data.js(伺服器 sim.js 共用同一份,保證中立物不落在地形外);
// 舊引用路徑照舊有效。
export { battleBBox };

const R_EARTH = 6371000;
// 真實↔遊戲世界比例尺(與 sim.js/llToMeters 必須同倍率,否則單位錯位)
const WORLD_S = 1 / MAPGEO.REAL_SCALE;
const GRID_N = TERRAIN.GRID_N;         // 地形頂點解析度
const ELEV_ZOOM = TERRAIN.ELEV_ZOOM;
const TERRARIUM = (z, x, y) => `https://s3.amazonaws.com/elevation-tiles-prod/terrarium/${z}/${x}/${y}.png`;
const IMAGERY = (z, x, y) => `https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/${z}/${y}/${x}`;
const OPEN_METEO = 'https://api.open-meteo.com/v1/elevation';

// ---- 投影工具 ----
const d2r = (d) => d * Math.PI / 180;
function lon2tx(lon, z) { return (lon + 180) / 360 * 2 ** z; }
function lat2ty(lat, z) {
  return (1 - Math.log(Math.tan(d2r(lat)) + 1 / Math.cos(d2r(lat))) / Math.PI) / 2 * 2 ** z;
}

// smoothstep 到 [0,1]
function smooth01(t) {
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  return t * t * (3 - 2 * t);
}
// 點到多段線集合(每段 [x1,z1,x2,z2])的最短距離
function distToSegs(px, pz, segs) {
  let min = Infinity;
  for (const [x1, z1, x2, z2] of segs) {
    const dx = x2 - x1, dz = z2 - z1;
    const l2 = dx * dx + dz * dz;
    let t = l2 ? ((px - x1) * dx + (pz - z1) * dz) / l2 : 0;
    t = t < 0 ? 0 : t > 1 ? 1 : t;
    const cx = x1 + t * dx, cz = z1 + t * dz;
    const d = Math.hypot(px - cx, pz - cz);
    if (d < min) min = d;
  }
  return min;
}

// ---- 無衛星影像時的地表色階梯(2026-08-03)----
// 五階地被色,**由相對亮度(Rec.709)設計**:亮度 55 → 70 → 82 → 91 → 97,
// 階差 15.1 / 12.3 / 8.5 / 6.0 —— **暗端的階差大於亮端**(嚴格遞減)。反過來排(亮端拉開)的話,暗部會糊成
// 一坨、亮部又過曝,這是色階梯最常見的失敗。色相同時從「冷苔綠」漸走到「暖乾土」,
// 讓層次不只是明暗還有溫度差。
// 這些是**頂點色**(乘在白底上),不是 cel ramp 的階 —— A14/#INC-106 管的是 ramp 的暗階
// (`toon.js RAMPS`,恆 ≥102),兩者是不同的東西,MUST NOT 混為一談。
const GROUND_TONES = [0x2e3a34, 0x3c4a3e, 0x4b5646, 0x565e4c, 0x5d644f];
const TONE_JIT_F = 0.018;   // 閾值抖動格寬 = 跨距 × 此值(比橢圓細、比取樣粗,見 field.js)

/**
 * 把色階梯烤成頂點色。
 * 種子由**戰場中心**推(與 biomes.js 的散布同源,§2.3)⇒ 同一場地跨客戶端逐位元同一張場。
 * 成本 = `pos.count * 3` 個 float(193² 網格 ≈ 447KB),換掉的是「整張地形一個顏色」。
 */
function paintTerrainTones(geo, pos, bounds, center) {
  const span = Math.max(bounds.maxX - bounds.minX, bounds.maxZ - bounds.minZ);
  const seed = ((Math.round(center.lat * 1e4) * 31 + Math.round(center.lng * 1e4)) ^ 0x7E44A1) >>> 0;
  const tone = makeToneLadder(makeField(seed, span), bounds, GROUND_TONES.length, span * TONE_JIT_F);
  const rgb = GROUND_TONES.map((c) => [((c >> 16) & 255) / 255, ((c >> 8) & 255) / 255, (c & 255) / 255]);
  const n = pos.length / 3;
  const colors = new Float32Array(n * 3);
  for (let k = 0; k < n; k++) {
    const [r, g, b] = rgb[tone(pos[k * 3], pos[k * 3 + 2])];
    colors[k * 3] = r; colors[k * 3 + 1] = g; colors[k * 3 + 2] = b;
  }
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
}

// ---- 風化屬性場(P2-A;2026-08-03)----
// 種子與地表色階梯**刻意錯開**(`^ WEATHER_SEED_MIX`):同一張場同時決定「地是什麼顏色」與
// 「哪裡長苔」的話,深色的地方剛好也最斑駁 —— 兩個訊號完全相關 = 看起來像只有一個訊號,
// 那正是要修的「整片一樣」本身。錯開後兩者各自起伏,交疊處才生得出「這一角特別老」。
// 場的紀律(散布橢圓、加權平均、`mulberry32` 確定性)全在 field.js,本檔只負責接線;
// 「這一區有多老」MUST NOT 改成由地形推(高度/離水距離在均勻區域內是常數,見計畫書 P2-A)。
const WEATHER_SEED_MIX = 0x3F1B9D;
const WEATHER_TEX_N = 64;    // 場的最小特徵 ≥ 1/10 跨距 ⇒ 64² 已細一個量級,線性內插看不出格點
function installWeatherField(bounds, center) {
  const span = Math.max(bounds.maxX - bounds.minX, bounds.maxZ - bounds.minZ);
  const seed = (((Math.round(center.lat * 1e4) * 31 + Math.round(center.lng * 1e4)) ^ 0x7E44A1) ^ WEATHER_SEED_MIX) >>> 0;
  setWeatherField(bakeFieldTexture(makeField(seed, span), bounds, WEATHER_TEX_N), WEATHER_TEX_N, bounds);
}

function loadImage(url) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(`載入失敗:${url}`));
    img.src = url;
  });
}

/** 經緯度 → 世界公尺(x 東、z 南) */
export function llToWorld(lat, lng, center) {
  const x = (lng - center.lng) * Math.PI / 180 * R_EARTH * Math.cos(d2r(center.lat)) * WORLD_S;
  const zN = (lat - center.lat) * Math.PI / 180 * R_EARTH * WORLD_S;
  return [x, -zN];
}

// ---- 高程來源 1:AWS terrarium tiles ----
async function fetchElevTerrarium(bbox, onProgress) {
  const z = ELEV_ZOOM;
  const tx0 = Math.floor(lon2tx(bbox.minLng, z)), tx1 = Math.floor(lon2tx(bbox.maxLng, z));
  const ty0 = Math.floor(lat2ty(bbox.maxLat, z)), ty1 = Math.floor(lat2ty(bbox.minLat, z));
  const cols = tx1 - tx0 + 1, rows = ty1 - ty0 + 1;
  if (cols * rows > 16) throw new Error('高程磚數量異常');
  const canvas = document.createElement('canvas');
  canvas.width = cols * 256; canvas.height = rows * 256;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  let done = 0;
  const total = cols * rows;
  await Promise.all(
    Array.from({ length: total }, (_, i) => {
      const cx = i % cols, cy = Math.floor(i / cols);
      const url = TERRARIUM(z, tx0 + cx, ty0 + cy);
      // 單磚失敗重試一次:高程是全有全無(任一磚失敗 → 整組換 open-meteo 粗網格,
      // 高度場整個不同 → 兵線跨水判定逐局漂移),盡量守住主來源
      return loadImage(url).catch(() => loadImage(url)).then((img) => {
        ctx.drawImage(img, cx * 256, cy * 256);
        onProgress?.(++done / total);
      });
    }),
  );
  const data = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
  // 取樣函式:latlng → 高程(雙線性)
  return (lat, lng) => {
    const px = (lon2tx(lng, z) - tx0) * 256;
    const py = (lat2ty(lat, z) - ty0) * 256;
    const x0 = Math.max(0, Math.min(canvas.width - 2, Math.floor(px)));
    const y0 = Math.max(0, Math.min(canvas.height - 2, Math.floor(py)));
    const fx = px - x0, fy = py - y0;
    const h = (xx, yy) => {
      const k = (yy * canvas.width + xx) * 4;
      return (data[k] * 256 + data[k + 1] + data[k + 2] / 256) - 32768;
    };
    return h(x0, y0) * (1 - fx) * (1 - fy) + h(x0 + 1, y0) * fx * (1 - fy)
         + h(x0, y0 + 1) * (1 - fx) * fy + h(x0 + 1, y0 + 1) * fx * fy;
  };
}

// ---- 高程來源 2(備援):open-meteo 批次點查詢(mapping_elf 原手法) ----
async function fetchElevOpenMeteo(bbox, onProgress) {
  const N = 33;
  const lats = [], lngs = [];
  for (let i = 0; i < N; i++) {
    const lat = bbox.minLat + (bbox.maxLat - bbox.minLat) * i / (N - 1);
    for (let j = 0; j < N; j++) {
      lats.push(lat);
      lngs.push(bbox.minLng + (bbox.maxLng - bbox.minLng) * j / (N - 1));
    }
  }
  const elev = [];
  const batch = 100;
  for (let s = 0; s < lats.length; s += batch) {
    const ls = lats.slice(s, s + batch).map((v) => v.toFixed(4)).join(',');
    const gs = lngs.slice(s, s + batch).map((v) => v.toFixed(4)).join(',');
    const resp = await fetch(`${OPEN_METEO}?latitude=${ls}&longitude=${gs}`);
    if (!resp.ok) throw new Error('open-meteo 高程查詢失敗');
    const d = await resp.json();
    elev.push(...(d.elevation || []));
    onProgress?.(Math.min(1, (s + batch) / lats.length));
  }
  return (lat, lng) => {
    const gi = (lat - bbox.minLat) / (bbox.maxLat - bbox.minLat) * (N - 1);
    const gj = (lng - bbox.minLng) / (bbox.maxLng - bbox.minLng) * (N - 1);
    const i0 = Math.max(0, Math.min(N - 2, Math.floor(gi)));
    const j0 = Math.max(0, Math.min(N - 2, Math.floor(gj)));
    const fi = gi - i0, fj = gj - j0;
    const at = (i, j) => elev[i * N + j] ?? 0;
    return at(i0, j0) * (1 - fi) * (1 - fj) + at(i0 + 1, j0) * fi * (1 - fj)
         + at(i0, j0 + 1) * (1 - fi) * fj + at(i0 + 1, j0 + 1) * fi * fj;
  };
}

// ---- 衛星貼圖:拼接 Esri World Imagery ----
async function fetchImagery(bbox, onProgress) {
  // 選 zoom 讓貼圖寬 ≈ 1600px
  let z = 15;
  for (; z > 10; z--) {
    if ((lon2tx(bbox.maxLng, z) - lon2tx(bbox.minLng, z)) * 256 <= 2048) break;
  }
  const tx0 = Math.floor(lon2tx(bbox.minLng, z)), tx1 = Math.floor(lon2tx(bbox.maxLng, z));
  const ty0 = Math.floor(lat2ty(bbox.maxLat, z)), ty1 = Math.floor(lat2ty(bbox.minLat, z));
  const cols = tx1 - tx0 + 1, rows = ty1 - ty0 + 1;
  const canvas = document.createElement('canvas');
  canvas.width = cols * 256; canvas.height = rows * 256;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#20262c';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  let done = 0;
  let fails = 0;
  const total = cols * rows;
  await Promise.all(
    Array.from({ length: total }, (_, i) => {
      const cx = i % cols, cy = Math.floor(i / cols);
      const url = IMAGERY(z, tx0 + cx, ty0 + cy);
      return loadImage(url).catch(() => loadImage(url))   // 單磚重試一次
        .then((img) => ctx.drawImage(img, cx * 256, cy * 256))
        .catch(() => { fails++; })   // 缺磚就留底色
        .finally(() => onProgress?.(++done / total));
    }),
  );
  // complete:零缺磚才算完整拼接 —— 快取只准定案完整影像(缺磚底色會讓水色分類永久帶洞)
  return { canvas, z, tx0, ty0, complete: fails === 0 };
}

// ---- 衛星影像賽璐璐化(botw_plan Task 2.1):寬筆刷低通 + 色階量化 + 飽和提升 ----
// photoreal 顆粒抹平成水彩色塊;呼叫前 sampleColor 已捕捉原始像素,分類不受影響。
function stylizeImagery(canvas) {
  const W = canvas.width, H = canvas.height;
  const ctx = canvas.getContext('2d');
  const small = document.createElement('canvas');
  small.width = Math.max(1, Math.round(W / 3));
  small.height = Math.max(1, Math.round(H / 3));
  const sctx = small.getContext('2d');
  sctx.imageSmoothingEnabled = true;
  sctx.drawImage(canvas, 0, 0, small.width, small.height);
  ctx.imageSmoothingEnabled = true;
  ctx.drawImage(small, 0, 0, W, H);          // 1/3 縮放來回 = 寬筆刷低通
  const img = ctx.getImageData(0, 0, W, H);
  const d = img.data;
  const STEP = 24, SAT = 1.3;
  for (let k = 0; k < d.length; k += 4) {
    const l = (d[k] + d[k + 1] + d[k + 2]) / 3;
    for (let c = 0; c < 3; c++) {
      const v = l + (d[k + c] - l) * SAT;    // 飽和提升 → 量化成色塊;+8 保底不塌黑(#INC-106 精神)
      d[k + c] = Math.max(0, Math.min(255, Math.round(v / STEP) * STEP + 8));
    }
  }
  ctx.putImageData(img, 0, 0);
}

/**
 * 建立戰場地形。回傳:
 * { group, heightAt(x,z), sampleColor(x,z)|null, center, bbox,
 *   worldW, worldH, minX, minZ, maxX, maxZ, minH, maxH, avgH }
 * sampleColor:取衛星影像該點的 [r,g,b],供 biomes.js 做地被分類。
 */
export async function buildTerrain(cfg, onProgress) {
  const bbox = battleBBox(cfg);
  const center = cfg.center;

  onProgress?.(0.02, '下載高程資料…');
  // 高程網格快取(geocache.js):同 bbox 首次由主來源(terrarium)完整取樣成功即定案入庫
  // (raw N×N,平滑/AMP/乾地帶處理前)。之後每場直接取用 → 高度場逐局位元級一致,
  // 兵線跨水段/橋數不再隨「terrarium vs open-meteo」來源切換浮動(倫敦橋數 1~3 案根因之一)。
  // 備援來源結果 MUST NOT 入庫 —— 一次網路顛簸不能把 33×33 粗高程永久定案。
  const elevKey = geoKey('elev', 1, bbox, `n${GRID_N}`);
  let rawElev = await geoGet(elevKey);
  let usedFallback = false;
  if (!(rawElev instanceof Float32Array) || rawElev.length !== GRID_N * GRID_N) {
    let sampleElev;
    try {
      sampleElev = await fetchElevTerrarium(bbox, (f) => onProgress?.(0.02 + f * 0.30, '下載高程資料…'));
    } catch {
      usedFallback = true;
      sampleElev = await fetchElevOpenMeteo(bbox, (f) => onProgress?.(0.02 + f * 0.30, '下載高程資料(備援來源)…'));
    }
    rawElev = new Float32Array(GRID_N * GRID_N);
    for (let i = 0; i < GRID_N; i++) {         // 取樣網格 MUST 與下方 heights 網格同一組經緯點
      const lat = bbox.maxLat + (bbox.minLat - bbox.maxLat) * i / (GRID_N - 1);
      for (let j = 0; j < GRID_N; j++) {
        const lng = bbox.minLng + (bbox.maxLng - bbox.minLng) * j / (GRID_N - 1);
        const h = sampleElev(lat, lng);
        rawElev[i * GRID_N + j] = Number.isFinite(h) ? h : 0;
      }
    }
    if (!usedFallback) geoPut(elevKey, rawElev);
  }

  onProgress?.(0.34, '下載衛星影像…');
  // 衛星影像快取:原始像素(stylize 前)整塊入庫,只有「零缺磚」的完整拼接才定案 ——
  // 缺磚底色入庫會讓水色/地被分類永久帶洞。命中時以 putImageData 重建 canvas,
  // 之後的取樣/賽璐璐化/貼圖管線與網路版全同。
  const imgKey = geoKey('img', 1, bbox);
  let imagery = null;
  let idata = null;
  const cachedImg = await geoGet(imgKey);
  if (cachedImg?.data?.length === cachedImg?.w * cachedImg?.h * 4) {
    const canvas = document.createElement('canvas');
    canvas.width = cachedImg.w; canvas.height = cachedImg.h;
    canvas.getContext('2d').putImageData(new ImageData(cachedImg.data, cachedImg.w, cachedImg.h), 0, 0);
    imagery = { canvas, z: cachedImg.z, tx0: cachedImg.tx0, ty0: cachedImg.ty0 };
    idata = cachedImg.data;
  } else {
    try {
      imagery = await fetchImagery(bbox, (f) => onProgress?.(0.34 + f * 0.30, '下載衛星影像…'));
    } catch { /* 沒有貼圖就用素色 */ }
  }

  // 影像取樣(世界公尺 → 經緯度 → mercator 像素):biomes.js 地被分類用
  let sampleColor = null;
  if (imagery) {
    if (!idata) {
      idata = imagery.canvas.getContext('2d').getImageData(0, 0, imagery.canvas.width, imagery.canvas.height).data;
      if (imagery.complete) {
        geoPut(imgKey, { w: imagery.canvas.width, h: imagery.canvas.height, z: imagery.z, tx0: imagery.tx0, ty0: imagery.ty0, data: idata });
      }
    }
    const iw = imagery.canvas.width, ih = imagery.canvas.height;
    sampleColor = (x, z) => {
      // 遊戲世界公尺 → 真實公尺(×REAL_SCALE)→ 經緯度(llToWorld 的逆運算)
      const lng = center.lng + x * MAPGEO.REAL_SCALE / (R_EARTH * Math.cos(d2r(center.lat))) * 180 / Math.PI;
      const lat = center.lat + (-z) * MAPGEO.REAL_SCALE / R_EARTH * 180 / Math.PI;
      const px = Math.round((lon2tx(lng, imagery.z) - imagery.tx0) * 256);
      const py = Math.round((lat2ty(lat, imagery.z) - imagery.ty0) * 256);
      if (px < 0 || py < 0 || px >= iw || py >= ih) return null;
      const k = (py * iw + px) * 4;
      return [idata[k], idata[k + 1], idata[k + 2]];
    };
    stylizeImagery(imagery.canvas);   // 原始像素已捕捉進 idata,底圖轉水彩色塊
  }

  onProgress?.(0.68, '建構地形網格…');

  // 世界範圍(公尺)
  const [minX, maxZs] = llToWorld(bbox.minLat, bbox.minLng, center); // minLng→minX;minLat→z 南(最大 z)
  const [maxX, minZs] = llToWorld(bbox.maxLat, bbox.maxLng, center);
  const minZ = Math.min(minZs, maxZs), maxZ = Math.max(minZs, maxZs);
  const worldW = maxX - minX, worldH = maxZ - minZ;

  const N = GRID_N;
  // rawElev = 上方定案的 N×N 原始高程(i:z 方向北→南 = maxLat→minLat;快取命中或現抓皆同一組網格點)
  const heights = new Float32Array(rawElev);
  let minH = Infinity, maxH = -Infinity;
  for (let k = 0; k < N * N; k++) {
    const h = heights[k];
    if (h < minH) minH = h;
    if (h > maxH) maxH = h;
  }
  // 輕度 3×3 平滑(terrainViewer 的 hole-aware blur 簡化版)
  const sm = new Float32Array(heights);
  for (let i = 1; i < N - 1; i++) {
    for (let j = 1; j < N - 1; j++) {
      let s = 0;
      for (let di = -1; di <= 1; di++) for (let dj = -1; dj <= 1; dj++) s += heights[(i + di) * N + j + dj];
      sm[i * N + j] = s / 9;
    }
  }
  heights.set(sm);

  // ---- 主要道路(兵線)以外放大海拔起伏 ----
  // 走廊(距兵線 ≤ AMP_R0)保留真實高度可行駛;遠離處放大「相對全場均值」的偏差 →
  // 更戲劇性的丘壑。主堡半徑內壓回平坦,維持基座與單位貼地正常。
  {
    const segs = [];
    for (const lane of (cfg.lanes || [])) {
      let prev = null;
      for (const [lat, lng] of lane) {
        const p = llToWorld(lat, lng, center);
        if (prev) segs.push([prev[0], prev[1], p[0], p[1]]);
        prev = p;
      }
    }
    // 市區衰減:SRTM 市區建物殘留雜訊經 AMP 放大會把平坦市街變丘壑(建物半埋、街道忽上忽下、
    // 河谷成乾峽谷)—— 依場地市區成分縮減放大量(公式與常數住 data.js TERRAIN.AMP_URBAN_F)。
    const amp = TERRAIN.AMP * (1 - Math.min(1, cfg.venue?.mix?.urban || 0) * TERRAIN.AMP_URBAN_F);
    if (segs.length) {
      let meanH = 0;
      for (let k = 0; k < N * N; k++) meanH += heights[k];
      meanH /= N * N;
      const bases = ['SWARM', 'STEEL'].map((s) => llToWorld(cfg.bases[s][0], cfg.bases[s][1], center));
      const R0 = TERRAIN.AMP_R0, R1 = TERRAIN.AMP_R1, BR = GAME.HERO_HEAL_RADIUS;
      minH = Infinity; maxH = -Infinity;
      for (let i = 0; i < N; i++) {
        const z = minZ + (maxZ - minZ) * i / (N - 1);
        for (let j = 0; j < N; j++) {
          const x = minX + (maxX - minX) * j / (N - 1);
          let f = smooth01((distToSegs(x, z, segs) - R0) / (R1 - R0));
          let db = Infinity;
          for (const [bx, bz] of bases) db = Math.min(db, Math.hypot(x - bx, z - bz));
          if (db < BR) f *= smooth01((db - BR * 0.4) / (BR * 0.6));   // 基座淨空壓平
          const k = i * N + j;
          if (f > 0) heights[k] += (heights[k] - meanH) * amp * f;
          if (heights[k] < minH) minH = heights[k];
          if (heights[k] > maxH) maxH = heights[k];
        }
      }
    }
  }

  // ---- 兵線砲塔外接寬度內強制乾地(2026-07-22 使用者需求)----
  // 同塔位左右兩座砲塔(沿法線 ±TOWER_SIDE_OFF)之間的外接帶,一律抬到「水面 + 沼澤帶」之上 →
  // 砲塔與其交戰區絕不落在水域/沼澤(否則塔/駐軍泡水、拆塔戰在河裡打)。抬升直接寫進最終
  // heights[](幾何 / heightAt / 水面盤自動遮蔽 / bakeWetGrid 上傳的伺服器迴避網格全部同步受益);
  // 衛星影像「藍色」分支不吃高程,另由 inDryBand 遮罩在 terrainEnvCode/isWaterPt 消除 → WYSIWYG 完全乾地。
  let dryBand = null;
  {
    const lanesW = (cfg.lanes || []).map((lane) => lane.map(([lat, lng]) => llToWorld(lat, lng, center)));
    if (lanesW.some((l) => l.length >= 2)) {
      const OFF = GAME.TOWER_SIDE_OFF, BAND_R = 16, SKIRT = 14;   // BAND_R 半徑涵蓋塔基 + 走位餘裕;SKIRT 裙帶漸回原地表(免斷崖)
      const segs = [];
      for (const laneSites of solveTowerSites(lanesW)) {
        for (const site of laneSites) {
          for (const cp of [site.SWARM, site.STEEL]) {   // 左右塔連線(外接寬度沿法線 ±OFF)= 抬升膠囊中軸
            segs.push([cp.x - cp.nx * OFF, cp.z - cp.nz * OFF, cp.x + cp.nx * OFF, cp.z + cp.nz * OFF]);
          }
        }
      }
      if (segs.length) {
        const DRY = WATER.LEVEL + WATER.SWAMP_BAND + 0.5;   // 抬到沼澤分類界(waterY + SWAMP_BAND)之上
        minH = Infinity; maxH = -Infinity;
        for (let i = 0; i < N; i++) {
          const z = minZ + (maxZ - minZ) * i / (N - 1);
          for (let j = 0; j < N; j++) {
            const x = minX + (maxX - minX) * j / (N - 1);
            const k = i * N + j;
            const dd = distToSegs(x, z, segs);
            if (dd < BAND_R + SKIRT && heights[k] < DRY) {
              const w = 1 - smooth01((dd - BAND_R) / SKIRT);   // 帶內全抬(w=1)、裙帶外緣漸回原高(w=0)
              if (w > 0) heights[k] += (DRY - heights[k]) * w;
            }
            if (heights[k] < minH) minH = heights[k];
            if (heights[k] > maxH) maxH = heights[k];
          }
        }
        dryBand = (px, pz) => distToSegs(px, pz, segs) <= BAND_R;   // 保證乾地區間(不含裙帶):供影像藍色分支遮罩
      }
    }
  }

  // ---- 全圖平均海拔(遊戲最高高度的兩個輸入之一;唯一取樣點)----
  // 與 `minH`/`maxH` 同一組取樣面(整片 N×N 高度場,含上面每一段抬升/放大的結果)。
  // 之後的 `gradeRoadBeds`/`carveTunnels` 是**局部**開挖(路廊/洞口),對全圖平均的位移
  // 遠小於一個砲塔高 ⇒ 刻意不重算:天花板是全場一個值,讓它隨開挖逐格漂移只會讓
  // 同一張圖在不同載入階段算出不同的天花板。
  let avgH = 0;
  for (let k = 0; k < N * N; k++) avgH += heights[k];
  avgH /= N * N;

  // ---- BufferGeometry ----
  const geo = new THREE.BufferGeometry();
  const pos = new Float32Array(N * N * 3);
  const uv = new Float32Array(N * N * 2);
  for (let i = 0; i < N; i++) {
    const z = minZ + (maxZ - minZ) * i / (N - 1);
    const lat = bbox.maxLat + (bbox.minLat - bbox.maxLat) * i / (N - 1);
    for (let j = 0; j < N; j++) {
      const x = minX + (maxX - minX) * j / (N - 1);
      const lng = bbox.minLng + (bbox.maxLng - bbox.minLng) * j / (N - 1);
      const k = i * N + j;
      pos[k * 3] = x;
      pos[k * 3 + 1] = heights[k];
      pos[k * 3 + 2] = z;
      if (imagery) {
        // 依 mercator 像素位置取 UV,避免高緯度貼圖歪斜
        uv[k * 2] = ((lon2tx(lng, imagery.z) - imagery.tx0) * 256) / imagery.canvas.width;
        uv[k * 2 + 1] = 1 - ((lat2ty(lat, imagery.z) - imagery.ty0) * 256) / imagery.canvas.height;
      } else {
        uv[k * 2] = j / (N - 1);
        uv[k * 2 + 1] = 1 - i / (N - 1);
      }
    }
  }
  const idx = [];
  for (let i = 0; i < N - 1; i++) {
    for (let j = 0; j < N - 1; j++) {
      const a = i * N + j, b = a + 1, c = a + N, d = c + 1;
      idx.push(a, c, b, b, c, d);
    }
  }
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  geo.setIndex(idx);
  geo.computeVertexNormals();

  // 地形也走日漫賽璐璐(衛星影像 + 光影階梯 = 2.5D 手繪感)。
  // 2026-08-03 兩件事一起修:
  //  ① 地形是**畫面上最大的一塊面**,卻是全場唯一沒吃 cel 補丁的表面(裸 MeshToonMaterial)——
  //     其他環境物件都有的 wash(低頻水彩暈染)與 cool(陰影偏冷)它一個都沒有,結果就是
  //     「機體與建物是畫的、地面是照片」。改走 `envMat`;`rim: 0` 是必要的 —— 貼地平面在遠處
  //     掠射角 rim 全開會整片洗白(envMat 檔頭已記),地被/道路早就這樣傳了。
  //  ② **沒有衛星影像時整張地形是一個 `0x39424c`**。那正是「88% 的坡面同一個色」的教科書案例:
  //     光影只有 3 階、又全部落在同一個底色上 ⇒ 山看起來是一塊平板。改吃屬性場驅動的色階梯
  //     (field.js;門檻取該場地自己的分位數 ⇒ 單一色階佔比恆 ≤ 1/n 附近,實測 27 場地 ×
  //     三種隊制最壞 30.3%),色階由**相對亮度**設計:暗端的階差大於亮端(暗部要分得開,
  //     亮部再拉開就過曝)。頂點色乘在底色上,故底色改成白。
  //  階數取 4(大型結構):3 階在整片山坡上只有一刀明暗界,轉折看不出來。
  // 風化屬性場(P2-A):**兩條路徑都要裝**,而且要在建材質**之前** —— 場是共享 uniform,
  // 材質只是拿到那個物件的參照,先後其實不影響,但擺在這裡才看得出「有沒有影像都有場」。
  installWeatherField({ minX, maxX, minZ, maxZ }, center);
  let mat;
  if (imagery) {
    const tex = new THREE.CanvasTexture(imagery.canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = 4;
    mat = envMat(0xffffff, { map: tex, rim: 0, bands: 4 });
  } else {
    paintTerrainTones(geo, pos, { minX, maxX, minZ, maxZ }, center);
    mat = envMat(0xffffff, { vertexColors: true, rim: 0, bands: 4 });
  }
  const mesh = new THREE.Mesh(geo, mat);
  mesh.receiveShadow = true;

  const group = new THREE.Group();
  group.add(mesh);

  // 水面(有低於海平面的區域才加);waterY = 水面高(無水域 = null,供 game.js 涉水/深水物理)。
  // 水面高的唯一真相 = data.js WATER.LEVEL(涉水深/道路跨水判定共用同一數字)。
  let waterY = null;
  if (minH < WATER.LEVEL + 0.2) {
    waterY = WATER.LEVEL;
    // 分段數由 `curveMaxEdgeM()` 推導(MUST NOT 手寫):世界曲面是**逐頂點**沉降,一整片
    // 鋪成兩個三角形的話中間就是一條弦 —— 邊長 L 的弦高 L²/(4R),整張圖一格的舊制在 L3
    // (1200m)上是 25m,水面會從遠處的地形裡整片浮出來。地形自己的格是 6.25m ⇒ 弦高
    // 0.9mm,本來就遠在容差之內,只有水面需要補這一刀。
    const wSeg = (n) => Math.max(1, Math.ceil(n / curveMaxEdgeM()));
    const water = new THREE.Mesh(
      new THREE.PlaneGeometry(worldW, worldH, wSeg(worldW), wSeg(worldH)),
      // DoubleSide:視線沒入水下時抬頭仍看得到水面(單面會被背面剔除 = 水下憑空無水)。
      // 水面是淺色大面積 ⇒ ramp 取 `soft`(整條抬到亮端,兩階之間才看得出交界);
      // 透明件不吃 moss(envMat 預設就沒有),wash/cool 照走 —— 水色要跟著天色偏。
      envMat(0x1a4a6a, { bands: 'soft', rim: 0, transparent: true, opacity: 0.82, side: THREE.DoubleSide }),
    );
    water.rotation.x = -Math.PI / 2;
    water.position.set((minX + maxX) / 2, waterY, (minZ + maxZ) / 2);
    group.add(water);
  }

  // 世界座標高度取樣。
  // MUST 與網格三角化(idx: a,c,b / b,c,d;對角線 = b–c)一致:雙線性在鞍點會低於
  // 實際三角面最多 (a+d-b-c)/4 公尺,單位/道路/地被就會沉進地表被擋住。
  function sampleField(field, x, z) {
    const gj = (x - minX) / (maxX - minX) * (N - 1);
    const gi = (z - minZ) / (maxZ - minZ) * (N - 1);
    const i0 = Math.max(0, Math.min(N - 2, Math.floor(gi)));
    const j0 = Math.max(0, Math.min(N - 2, Math.floor(gj)));
    const fi = Math.max(0, Math.min(1, gi - i0));
    const fj = Math.max(0, Math.min(1, gj - j0));
    const at = (i, j) => field[i * N + j];
    const a = at(i0, j0), b = at(i0, j0 + 1), c = at(i0 + 1, j0), d = at(i0 + 1, j0 + 1);
    return fi + fj <= 1
      ? a + (b - a) * fj + (c - a) * fi              // 三角形 (a, c, b)
      : d + (c - d) * (1 - fj) + (b - d) * (1 - fi); // 三角形 (b, c, d)
  }
  const heightAt = (x, z) => sampleField(heights, x, z);
  // 天然地形高(**開挖/整平之前**的那一份;2026-08-01 明隧道判定改制)。
  // 「這一側在不在地形之外」問的是**天然**地形:我們自己挖出來的路塹/斜壁/整平台不算證據。
  // 不分這一份的後果是判定隨呼叫時機漂移 —— 明隧道判定跑三次(carveGalleryBands 呼叫端在
  // 開挖**前**、buildRoads 與 markGradeCorridors 在開挖**後**),金龍隧道實測:隔壁孔的洞口
  // 路塹把 20~25m 外的地表挖到我方路面之下 3m ⇒ 開挖前判「牆」、開挖後判「柱」,結果是柱外
  // 淨空帶沒挖、卻長出柱列(兩份剖面分家)。吃同一份天然地形 ⇒ 三次呼叫逐位元同解。
  // 快照時機 = 地形建完(carve* / gradeRoadBeds 都在 buildBiomes 才呼叫)⇒ 恆是原始地形。
  const heights0 = new Float32Array(heights);
  const natureAt = (x, z) => sampleField(heights0, x, z);

  // ---- 地形射線(解析版;取代 three Mesh.raycast 的逐三角掃描)----
  // 地形是**高度場**:193² 網格 = 73,728 個三角形,three 的 Mesh.raycast 每次都整批線性掃完
  // (包圍球/盒對「射點就在圖內」的射線一律通過,far 不參與剪枝)⇒ 每顆子彈每幀 ~1ms(桌機)、
  // 手機 3~6 倍 —— 這正是「開火就掉幀」的主因。改走 Amanatides–Woo 網格行進:只測射線真正
  // 穿過的格子(一顆子彈一幀約 1~4 格 = 2~8 個三角形),**同一組三角形、同一條 Möller–Trumbore**
  // ⇒ 命中點與舊版逐面掃描完全一致,不是近似。
  //
  // `punchPortalHoles` 會把隧道洞口的三角形從 index 刪掉(彈道要能打進洞內)—— 高度場本身沒有
  // 「洞」的概念,故一併記帳被刪的三角形(triDead),行進時跳過,與網格保持同形。
  const CELLS = (N - 1) * (N - 1);
  let triDead = null;   // Uint8Array(CELLS*2);null = 尚未打洞(全存活)
  /** 標記某原始三角形已被打洞刪除(t 序:cell*2 + 0/1,對應 (a,c,b) / (b,c,d)) */
  function markTriDead(v0, v1, v2) {
    const lo = Math.min(v0, v1, v2), hi = Math.max(v0, v1, v2);
    const mid = v0 + v1 + v2 - lo - hi;
    // (a, a+1, a+N) = 上三角(a,c,b);(a+1, a+N, a+N+1) = 下三角(b,c,d)
    const upper = mid - lo === 1;
    const a = upper ? lo : lo - 1;
    const i = (a / N) | 0, j = a % N;
    if (i < 0 || j < 0 || i >= N - 1 || j >= N - 1) return;
    if (!triDead) triDead = new Uint8Array(CELLS * 2);
    triDead[(i * (N - 1) + j) * 2 + (upper ? 0 : 1)] = 1;
  }

  const DX = (maxX - minX) / (N - 1);   // 格寬(公尺)
  const DZ = (maxZ - minZ) / (N - 1);
  /** 單一三角形 Möller–Trumbore(頂點以格點索引給);回傳 t 或 -1 */
  function triHit(ox, oy, oz, dx, dy, dz, far, k0, k1, k2) {
    const ax = minX + (k0 % N) * DX, ay = heights[k0], az = minZ + ((k0 / N) | 0) * DZ;
    const e1x = minX + (k1 % N) * DX - ax, e1y = heights[k1] - ay, e1z = minZ + ((k1 / N) | 0) * DZ - az;
    const e2x = minX + (k2 % N) * DX - ax, e2y = heights[k2] - ay, e2z = minZ + ((k2 / N) | 0) * DZ - az;
    const px = dy * e2z - dz * e2y, py = dz * e2x - dx * e2z, pz = dx * e2y - dy * e2x;
    const det = e1x * px + e1y * py + e1z * pz;
    if (det > -1e-10 && det < 1e-10) return -1;
    const inv = 1 / det;
    const tx = ox - ax, ty = oy - ay, tz = oz - az;
    const u = (tx * px + ty * py + tz * pz) * inv;
    if (u < 0 || u > 1) return -1;
    const qx = ty * e1z - tz * e1y, qy = tz * e1x - tx * e1z, qz = tx * e1y - ty * e1x;
    const v = (dx * qx + dy * qy + dz * qz) * inv;
    if (v < 0 || u + v > 1) return -1;
    const t = (e2x * qx + e2y * qy + e2z * qz) * inv;
    return (t > 1e-4 && t <= far) ? t : -1;
  }

  /**
   * 地形射線求交。dir **MUST 已正規化**;回傳 { t, x, y, z } 或 null。
   * 呼叫端(game.js 彈道/準星)以此取代把 `terrain.mesh` 丟進 raycaster 的做法。
   */
  function rayTerrain(ox, oy, oz, dx, dy, dz, far) {
    // ① 先把射線夾進地形 XZ 邊界(射點可能在圖外)
    let t0 = 0, t1 = far;
    for (const [o, d, lo, hi] of [[ox, dx, minX, maxX], [oz, dz, minZ, maxZ]]) {
      if (Math.abs(d) < 1e-9) { if (o < lo || o > hi) return null; continue; }
      let ta = (lo - o) / d, tb = (hi - o) / d;
      if (ta > tb) { const s = ta; ta = tb; tb = s; }
      if (ta > t0) t0 = ta;
      if (tb < t1) t1 = tb;
      if (t0 > t1) return null;
    }
    // ② Amanatides–Woo:逐格行進,只測射線真的穿過的格
    const eps = 1e-6;
    let gj = (ox + dx * (t0 + eps) - minX) / DX, gi = (oz + dz * (t0 + eps) - minZ) / DZ;
    let j = Math.max(0, Math.min(N - 2, Math.floor(gj)));
    let i = Math.max(0, Math.min(N - 2, Math.floor(gi)));
    const sj = dx > 0 ? 1 : dx < 0 ? -1 : 0;
    const si = dz > 0 ? 1 : dz < 0 ? -1 : 0;
    const tdj = sj ? Math.abs(DX / dx) : Infinity;
    const tdi = si ? Math.abs(DZ / dz) : Infinity;
    // 下一次跨格邊界的 t(以射線參數計)
    let tnj = sj ? t0 + ((sj > 0 ? (j + 1) * DX : j * DX) + minX - (ox + dx * t0)) / dx : Infinity;
    let tni = si ? t0 + ((si > 0 ? (i + 1) * DZ : i * DZ) + minZ - (oz + dz * t0)) / dz : Infinity;
    for (let guard = 0; guard < 4096; guard++) {
      const cell = i * (N - 1) + j;
      const a = i * N + j, b = a + 1, c = a + N, d2 = c + 1;
      let best = -1;
      if (!triDead || !triDead[cell * 2]) {          // 上三角 (a, c, b)
        const t = triHit(ox, oy, oz, dx, dy, dz, t1, a, c, b);
        if (t >= 0) best = t;
      }
      if (!triDead || !triDead[cell * 2 + 1]) {      // 下三角 (b, c, d)
        const t = triHit(ox, oy, oz, dx, dy, dz, t1, b, c, d2);
        if (t >= 0 && (best < 0 || t < best)) best = t;
      }
      if (best >= 0) return { t: best, x: ox + dx * best, y: oy + dy * best, z: oz + dz * best };
      // 前進到下一格
      if (tnj < tni) {
        if (tnj > t1) return null;
        j += sj; tnj += tdj;
        if (j < 0 || j > N - 2) return null;
      } else {
        if (tni > t1) return null;
        i += si; tni += tdi;
        if (i < 0 || i > N - 2) return null;
      }
    }
    return null;
  }

  /**
   * 地下道洞口開挖(2026-07-15;2026-07-22 改制):**只開挖 approaches / 敞開段**,深山段完全不動 →
   * 天花板上方的山體地表保持原樣(照常鋪地被拼圖)。
   * runs: [{ pts:[[x,z]…], floors:[y…], hw? }](floors = 該點的路面高度;hw = 該段自己的通行半寬,
   * 省略則吃選項的預設值 —— 地下道/隧道的通行寬取自圖資車道數,寬過預設 9 的話固定值會讓
   * 路面兩緣落在沒開挖到的斜坡裡 = 路面邊緣被土埋住)。
   * 呼叫端(biomes.js)只送「敞開補集」折線(覆蓋段/縫合蓋廊段不送)—— 本函式對送進來的
   * 走廊一律開挖,規則:原地表低於「路面 + clear + 1」(藏不住天花板)才動。
   * 剖面:路廊(≤ hw+1)全深壓到路面高;向外以 smoothstep 漸束回原地表。過渡帶寬分兩路:
   *   山體隧道(預設)到 hw+7 —— 斜壁路塹,而非舊版垂直斷崖(拉伸三角形布幕 = 破圖主因之一);
   *   地下道引道(r.cut)到 hw+CUT_W —— 垂直路塹:平地上 hw+7 緩斜壁是一圈走得下去的碗
   *   (= 從地下道側面挖出入口),收窄後路塹外地表保持平坦,側面只剩擋土牆(biomes.js)。
   */
  const CUT_W = 2.5;   // 地下道路塹過渡帶寬(公尺):牆後藏崖;緣石帶 UND.COPE MUST 蓋得過它
  // 覆蓋轉換端保護帶(公尺):敞開 run 與覆蓋段交界的最後這段維持舊判準(只挖藏不住天花板的
  // 節點),保住「藏著洞口的轉換崖」—— 數值 = buildRoads 圍裙段 APRON(門洞立在崖前的那 8m)。
  const PROT_M = 8;
  // 開挖足跡:被隧道剖面/明隧道淨空帶動過的節點,gradeRoadBeds MUST NOT 再動
  // (路基整平的目標高是「一般道路貼地剖面」,蓋回去就把開挖好的洞口/路塹重新填起來)。
  let carvedNodes = null;
  const markCarved = (k) => { (carvedNodes ??= new Uint8Array(N * N))[k] = 1; };
  /** heights[] 改完批次回寫 position 屬性 + 重算法線(三個開挖/整地入口共用) */
  function syncHeights() {
    const posAttr = geo.getAttribute('position');
    for (let k = 0; k < N * N; k++) posAttr.array[k * 3 + 1] = heights[k];
    posAttr.needsUpdate = true;
    geo.computeVertexNormals();
  }
  function carveTunnels(runs, { clear = 8, hw = 9 } = {}) {
    if (!runs?.length) return;
    const fullOf = (r) => (r.hw ?? hw) + 1;
    const nearOf = (r) => (r.hw ?? hw) + (r.cut ? CUT_W : 7);
    for (const r of runs) {                           // 弧長(轉換端保護帶判定用)
      r._cum = [0];
      for (let i = 1; i < r.pts.length; i++) {
        r._cum.push(r._cum[i - 1] + Math.hypot(r.pts[i][0] - r.pts[i - 1][0], r.pts[i][1] - r.pts[i - 1][1]));
      }
    }
    const proj = (x, z, r) => {                       // 最近段 + 內插路面高 + 弧長位置
      let bd = Infinity, bf = 0, bs = 0;
      for (let i = 0; i < r.pts.length - 1; i++) {
        const ax = r.pts[i][0], az = r.pts[i][1];
        const ex = r.pts[i + 1][0] - ax, ez = r.pts[i + 1][1] - az;
        const L2 = ex * ex + ez * ez || 1;
        let t = ((x - ax) * ex + (z - az) * ez) / L2; t = t < 0 ? 0 : t > 1 ? 1 : t;
        const d = Math.hypot(x - (ax + ex * t), z - (az + ez * t));
        if (d < bd) { bd = d; bf = r.floors[i] + (r.floors[i + 1] - r.floors[i]) * t; bs = r._cum[i] + (r._cum[i + 1] - r._cum[i]) * t; }
      }
      return { d: bd, floor: bf, s: bs };
    };
    for (let i = 0; i < N; i++) {
      const z = minZ + (maxZ - minZ) * i / (N - 1);
      for (let j = 0; j < N; j++) {
        const x = minX + (maxX - minX) * j / (N - 1);
        const k = i * N + j, orig = heights[k];
        let target = Infinity;
        for (const r of runs) {
          const full = fullOf(r), near = nearOf(r);
          const p = proj(x, z, r);
          if (p.d > near) continue;
          // 敞開 run「內部」無條件開挖:覆蓋判定只看**中心線**逐 6m 取樣,走廊裡高過門檻的
          // 殘峰(~8.3m 網格節點)舊判準會整根留下 = 一道橫在路上的岩牆(2026-07-31 太魯閣
          // 兩洞口之間敞開段實測 +8.2m)。覆蓋轉換端 PROT_M 內只有**斜壁過渡帶**維持舊判準
          // (保護門洞兩側/上方的轉換崖 —— 洞口打洞 + collar 靠它當基準面);路廊本體(≤ full)
          // 恆無條件 —— 崖可以留在路旁,不可以橫在路上(單位出洞第一步就撞 3m 土階)。
          // run 頭尾(接一般道路/圖界)無崖可保,一律內部。
          const total = r._cum[r._cum.length - 1];
          const inner = p.d <= full
            || ((!r.covA || p.s > PROT_M) && (!r.covB || p.s < total - PROT_M));
          if (inner || orig < p.floor + clear + 1) {
            const t = p.d <= full ? 0 : (p.d - full) / (near - full);
            const w = t * t * (3 - 2 * t);    // smoothstep:路廊全深、外緣歸零 = 斜壁
            target = Math.min(target, p.floor + (orig - p.floor) * w);
          }
        }
        if (target < orig) { heights[k] = target; markCarved(k); }
      }
    }
    syncHeights();
    // 開挖走廊影像重繪(2026-07-22):衛星影像在走廊上是原地物(深色森林/建物照片陰影),
    // 被拉伸貼到挖出的路塹壁/溝底上就是整片黑色色塊(看似破圖)。沿走廊把畫布塗成開挖
    // 岩土色 —— sampleColor 已於 stylize 前快照原始像素(idata),此處純視覺,
    // 不影響地被分類、不耗共享 rnd。
    if (imagery && mat?.map) {
      const ictx = imagery.canvas.getContext('2d');
      const toPx = (x, z) => {
        const lng = center.lng + x * MAPGEO.REAL_SCALE / (R_EARTH * Math.cos(d2r(center.lat))) * 180 / Math.PI;
        const lat = center.lat + (-z) * MAPGEO.REAL_SCALE / R_EARTH * 180 / Math.PI;
        return [(lon2tx(lng, imagery.z) - imagery.tx0) * 256, (lat2ty(lat, imagery.z) - imagery.ty0) * 256];
      };
      const [ox] = toPx(0, 0), [tx] = toPx(10, 0);
      const pxPerM = Math.abs(tx - ox) / 10 || 1;
      ictx.save();
      ictx.lineCap = 'round';
      ictx.lineJoin = 'round';
      for (const r of runs) {
        for (const [color, w] of [['#877c6a', (nearOf(r) + 1.5) * 2], ['#948a76', (r.hw ?? hw) * 2]]) {
          ictx.strokeStyle = color;
          ictx.lineWidth = Math.max(2, w * pxPerM);
          ictx.beginPath();
          r.pts.forEach(([x, z], i) => {
            const [px, py] = toPx(x, z);
            if (i === 0) ictx.moveTo(px, py); else ictx.lineTo(px, py);
          });
          ictx.stroke();
        }
      }
      ictx.restore();
      mat.map.needsUpdate = true;
    }
  }

  /**
   * 明隧道開放側柱外淨空帶(2026-07-31 使用者回報「柱子外的地形沒有完全淨空」):
   * 開放側牆線外常橫著一道**低於頂板**的土脊(側坡殘丘,可高出路面 2~3m)—— 柱間看出去
   * 是一面土牆、彈道也被擋。把 [hw−0.5, hw+clearW] 帶內、頂板以下的地形降到路面高
   * (外緣 3m smoothstep 收回原地表)。與洞內打洞(punchPortalHoles)分工:
   * 斷面**內**的楔形與山體相連,高度場挖不掉(拉伸陡面)只能刪繪製三角形;牆線**外**的
   * 開放側地形往低處走,真開挖即可水密收乾淨(不需 collar、不留看穿的洞)。
   * 只降不升、只動頂板以下 ⇒ tunnelWallProfile 的 thin/backed 取樣對這刀**穩定**
   * (backed 只認 ≥ 頂板的點;被挖的點本來就 < 頂板)—— buildRoads 開挖後重算不翻面。
   * strips: [{ pts, floors, hw, side }](tunnelWallProfile 判 open 的連續覆蓋段,逐側一條)
   */
  function carveGalleryBands(strips, { clear = 8, roofT = 1, clearW = 9 } = {}) {
    if (!strips?.length) return;
    let touched = false;
    for (let i = 0; i < N; i++) {
      const z = minZ + (maxZ - minZ) * i / (N - 1);
      for (let j = 0; j < N; j++) {
        const x = minX + (maxX - minX) * j / (N - 1);
        const k = i * N + j, orig = heights[k];
        let target = Infinity;
        for (const st of strips) {
          const inner = st.hw - 0.5, outer = st.hw + clearW;
          let bd = Infinity, bf = 0, bo = 0;
          for (let q = 0; q < st.pts.length - 1; q++) {
            const ax = st.pts[q][0], az = st.pts[q][1];
            const ex = st.pts[q + 1][0] - ax, ez = st.pts[q + 1][1] - az;
            const L2 = ex * ex + ez * ez || 1;
            const t = ((x - ax) * ex + (z - az) * ez) / L2;
            if (t < 0 || t > 1) continue;   // 端帽不外溢:strip 端外接的是轉換崖/深覆蓋段,不得蝕
            const px = x - (ax + ex * t), pz = z - (az + ez * t);
            const d = Math.hypot(px, pz);
            if (d >= bd) continue;
            const L = Math.sqrt(L2);
            bd = d;
            bf = st.floors[q] + (st.floors[q + 1] - st.floors[q]) * t;
            bo = (px * (ez / L) - pz * (ex / L)) * st.side;   // 側向有號偏移(nx=dz·side 同向)
          }
          if (bo < inner || bo > outer || bd === Infinity) continue;
          // 不設「高過頂板不動」上限:開放側判定(thin && !backed)已擋掉岩背 —— 帶內殘餘的
          // 高聳岩脊正是「明隧道穿著岩嘴蓋」的那一小段,不切掉柱間就是一面石壁(路塹式切齊)。
          // 岩背側(backed)本來就不判 open ⇒ 不進 strip,山壁毫髮無傷。
          const t2 = Math.max(0, (bo - (outer - 3)) / 3);
          const w = t2 * t2 * (3 - 2 * t2);           // 外緣 smoothstep 收回原地表
          target = Math.min(target, bf + (orig - bf) * w);
        }
        if (target < orig) { heights[k] = target; markCarved(k); touched = true; }
      }
    }
    if (touched) syncHeights();
  }

  /**
   * 道路路基整平(2026-07-31 使用者回報「兩側太陡時一邊懸空、一邊陷入地形」):
   * 一般道路(非橋/非結構隧道)的路面緞帶「各自貼地 + 夾高 0.7m」扛不住陡橫坡 ——
   * 橫向 10m 高差可達 6m+:下坡緣浮空、上坡緣連同格間地形鼓包整片埋進山壁,
   * 也沒有平的地面可以踩(單位站的是裸地形 heightAt)。比照現實工程把走廊整成
   * **切填平台**:走廊內(d ≤ hw)壓到中心線路面高、向外 taper 帶 smoothstep 收回原地表。
   * 紀律:①填方上限 fillMax、超過再 0.5×fillMax 漸退歸零 —— 峽谷邊緣不築土壩;
   * ②水域/沼澤節點(原高 ≤ 水面 + SWAMP_BAND)不動 —— 跨水段本來就走橋,岸線不得位移;
   * ③隧道開挖足跡(carvedNodes)優先 —— 洞口路塹/剖面不得被整平蓋回去。
   * 全程純幾何零 rnd;floors 於**修改前**整批取樣(跨 run 一致)。
   * runs: [{ pts, hw }](呼叫端已裁切 + densify + 剔除泡水段/橋/結構/步道)
   */
  function gradeRoadBeds(runs, { taper = 6, fillMax = 12 } = {}) {
    if (!runs?.length) return;
    const bestW = new Float32Array(N * N);
    const bestT = new Float32Array(N * N);
    const DXg = (maxX - minX) / (N - 1), DZg = (maxZ - minZ) / (N - 1);
    for (const r of runs) {
      // 全深帶外擴半格:heightAt 是雙線性內插,路緣正下方的表面高混到 ~半格外的節點 ——
      // 全深帶只到 hw 的話,路面緞帶跨距內的地表仍會被帶外節點拉出橫傾(整了等於沒整)。
      const hwR = Math.max(r.hw ?? 2.5, 2.5) + Math.max(DXg, DZg) / 2;
      const band = hwR + taper;
      const floors = r.pts.map(([px, pz]) => heightAt(px, pz));   // 修改前的中心線剖面
      for (let q = 0; q + 1 < r.pts.length; q++) {
        const ax = r.pts[q][0], az = r.pts[q][1];
        const bx = r.pts[q + 1][0], bz = r.pts[q + 1][1];
        const jMin = Math.max(0, Math.floor((Math.min(ax, bx) - band - minX) / DXg));
        const jMax = Math.min(N - 1, Math.ceil((Math.max(ax, bx) + band - minX) / DXg));
        const iMin = Math.max(0, Math.floor((Math.min(az, bz) - band - minZ) / DZg));
        const iMax = Math.min(N - 1, Math.ceil((Math.max(az, bz) + band - minZ) / DZg));
        const ex = bx - ax, ez = bz - az, L2 = ex * ex + ez * ez || 1;
        for (let i = iMin; i <= iMax; i++) {
          const z = minZ + DZg * i;
          for (let j = jMin; j <= jMax; j++) {
            const x = minX + DXg * j;
            let t = ((x - ax) * ex + (z - az) * ez) / L2; t = t < 0 ? 0 : t > 1 ? 1 : t;
            const d = Math.hypot(x - (ax + ex * t), z - (az + ez * t));
            if (d >= band) continue;
            const u = d <= hwR ? 0 : (d - hwR) / taper;
            const w = 1 - u * u * (3 - 2 * u);
            const k = i * N + j;
            // 每節點認**最近的那條路**(w 最大者):髮夾彎上下兩腿各自成台階,
            // 混平均會把兩條路一起弄成半埋半浮
            if (w > bestW[k]) { bestW[k] = w; bestT[k] = floors[q] + (floors[q + 1] - floors[q]) * t; }
          }
        }
      }
    }
    let touched = false;
    for (let k = 0; k < N * N; k++) {
      const w = bestW[k];
      if (!w || carvedNodes?.[k]) continue;
      const orig = heights[k];
      if (orig <= WATER.LEVEL + WATER.SWAMP_BAND) continue;
      let delta = bestT[k] - orig;
      if (delta > 0) {
        if (delta >= fillMax * 1.5) continue;             // 深谷:不填(寧可維持現狀,不築壩)
        if (delta > fillMax) {
          const f = (delta - fillMax) / (fillMax * 0.5);
          delta *= 1 - f * f * (3 - 2 * f);               // 超限漸退:路堤高度連續歸零
        }
      }
      const ny = orig + delta * w;
      if (Math.abs(ny - orig) < 1e-6) continue;
      heights[k] = ny;
      touched = true;
    }
    if (touched) syncHeights();
  }

  /**
   * 洞口打洞(2026-07-23 洞口透明化):把「戳進隧道斷面」的地形三角形從**繪製 index** 移除,
   * `heights[]` 與 position 屬性一律不動 —— heightAt / 碰撞 / 迷霧 LOS / bakeWetGrid 全讀 heights
   * 陣列,不讀三角形 ⇒ 這是**純視覺**開洞:單位照樣走不過山、砲火照樣打不穿(33b3c54 命脈不動)。
   * 刪除條件三合一(缺一不可,缺了就是破頂或黑洞):
   *   ① 三角形(XZ 投影)與斷面走廊矩形(|側向 offset| ≤ hw、進洞深度 0.5 ~ depth)**重疊**;
   *   ② 三角形有部分高過路面(整片在路面之下 = 被路面緞帶蓋著看不見,留著);
   *   ③ 三角形有部分低於天花(整片在天花之上 = 山體本體,留著 ⇒ 高空俯瞰不破頂)。
   * 亦即只刪「覆蓋轉換處那一圈把隧道斷面塞住的拉伸崖面(土牆)」。
   * 地被層(拼圖底毯 / 細節實例)是**獨立圖層**,不一起讓開的話洞口望進去仍是一坡草皮貼在崖面上
   * —— 故 covers 一併吃同一把尺(單一縫:判定只有這一份,地形與地被不可能對不齊)。
   * @param bores [{x,z,ry,hw,depth,floorY,slope,clear,lift}];ry:局部 +Z = 洞外方向,slope = 每公尺進洞的路面高變化
   * @param covers 地被層 Object3D 陣列(Mesh 打洞 / InstancedMesh 縮零實例)
   * @returns { rims, touched } —— rims[i] = 該 bore 的洞緣邊 [[ax,ay,az,bx,by,bz]…](世界座標,建
   *   collar 裙面用);touched[i] = 該 bore 的走廊內是否真有東西被刪掉(**含被鄰座 bore 認領的**:
   *   平行雙孔隧道兩座門洞相距僅數公尺、bore 大幅重疊,重疊區三角形只會被第一座認領 —— 呼叫端
   *   若拿 rims 判「打洞是否成功」會誤判第二座失敗而掛回黑暗面,那片黑板就正好擋在第一座洞口後面)
   */
  function punchPortalHoles(bores, covers = []) {
    const rims = (bores || []).map(() => []);
    const touched = (bores || []).map(() => false);
    if (!bores?.length) return { rims, touched };
    // out = 走廊往洞**外**延伸幾公尺(2026-07-31 多視角檢視):洞口外側 ±hw、路面以上、天花以下
    // 那塊空間就是「車開出來的地方」,本來就該淨空 —— 開挖後殘留在切面上的地被底毯/地形攤片
    // 會斜插進洞口(從洞內往外看是幾片浮在路面上方的土色薄片)。走廊只往外延一格,垂直三條界
    // 不動 ⇒ 路面以下(路塹底、圍裙)與天花以上(山體)照樣不刪。
    const B = bores.map((b) => ({ ...b, out: b.out || 0, ca: Math.cos(b.ry), sa: Math.sin(b.ry),
      far2: (b.depth + b.hw + 24 + (b.out || 0)) ** 2 }));
    /** 點是否落在該 bore 的斷面走廊內(不含高度判定) */
    const inBore = (b, x, z) => {
      const dx = x - b.x, dz = z - b.z;
      if (dx * dx + dz * dz > b.far2) return false;
      const lx = dx * b.ca - dz * b.sa, lz = dx * b.sa + dz * b.ca;
      return Math.abs(lx) <= b.hw && lz <= b.out - 0.5 && lz >= -b.depth;
    };
    /**
     * 三角形(XZ 投影)是否與該 bore 的斷面走廊矩形重疊(2D SAT;凸 × 凸)。
     * **MUST NOT 退回「任一頂點在走廊內」**(2026-07-31 多視角檢視):地形格 ~8.3m、對角 ~11.7m,
     * 走廊在**縱向兩端**只有 0.5m / depth 兩道界 —— 洞口與明隧道段端點附近的三角形常常一個頂點
     * 落在走廊外側(側向 > hw)、另一個落在端界外(lz > −0.5 或 < −depth),整片卻橫切過斷面。
     * 頂點法漏掉它 ⇒ 出入口內側殘留一片戳進斷面的地形楔(使用者回報的「洞內卡著石頭」),
     * 且該片不在 rims 內、collar 也補不到。重疊法只多刪真的擋在斷面裡的那幾片,鄰接的洞緣
     * 照樣進 rims → collar 仍水密。
     */
    const triBore = (b, x0, z0, x1, z1, x2, z2) => {
      const mx = (x0 + x1 + x2) / 3 - b.x, mz = (z0 + z1 + z2) / 3 - b.z;
      if (mx * mx + mz * mz > b.far2) return false;                    // 粗篩(far2 已含一格餘裕)
      const L = (x, z) => {
        const dx = x - b.x, dz = z - b.z;
        return [dx * b.ca - dz * b.sa, dx * b.sa + dz * b.ca];
      };
      const p = [L(x0, z0), L(x1, z1), L(x2, z2)];
      const xLo = -b.hw, xHi = b.hw, zLo = -b.depth, zHi = b.out - 0.5;
      // 軸 1/2 = 走廊自身的兩軸
      if (p.every((q) => q[0] < xLo) || p.every((q) => q[0] > xHi)) return false;
      if (p.every((q) => q[1] < zLo) || p.every((q) => q[1] > zHi)) return false;
      // 軸 3~5 = 三角形三邊的法線
      const corner = [[xLo, zLo], [xHi, zLo], [xHi, zHi], [xLo, zHi]];
      for (let e = 0; e < 3; e++) {
        const a = p[e], c = p[(e + 1) % 3];
        const nx = c[1] - a[1], nz = a[0] - c[0];
        let tLo = Infinity, tHi = -Infinity, rLo = Infinity, rHi = -Infinity;
        for (const q of p) { const d = q[0] * nx + q[1] * nz; if (d < tLo) tLo = d; if (d > tHi) tHi = d; }
        for (const q of corner) { const d = q[0] * nx + q[1] * nz; if (d < rLo) rLo = d; if (d > rHi) rHi = d; }
        if (tHi < rLo || rHi < tLo) return false;
      }
      return true;
    };
    /** 該 bore 在此點深度的路面高。山體隧道 = 平直內插(floorY + slope × 進洞深度);
     *  地下道另帶 fp 剖面取樣(進洞深度自 −fpOut 起、每 fpStep 一枚)—— 下沉剖面是曲線、
     *  引道在洞外還一路爬升,線性外推在 MOUTH_OUT 外延帶會把「引道路面之下」的地形誤刪:
     *  洞緣(rim)因此跑進斷面中央,collar 沿著它織出橫跨洞口的混凝土殘片
     *  (2026-08-05 使用者回報「洞口殘留混凝土」的成因)。無 fp 的 bore 逐位元同舊制。 */
    const floorAt = (b, x, z) => {
      const d = -((x - b.x) * b.sa + (z - b.z) * b.ca);
      if (b.fp?.length > 1) {
        const t = Math.max(0, Math.min(b.fp.length - 1, (d + b.fpOut) / b.fpStep));
        const i = Math.min(b.fp.length - 2, Math.floor(t));
        return b.fp[i] + (b.fp[i + 1] - b.fp[i]) * (t - i);
      }
      return b.floorY + b.slope * Math.min(b.depth, Math.max(0, d));
    };
    /**
     * 通用打洞:index 就地壓實(寫入游標恆 ≤ 讀取游標,不會覆蓋未讀資料)+ drawRange 收尾 ——
     * 不重配緩衝、不動 position/normal。回傳 own 陣列(供地形取洞緣)或 null。
     */
    const punchGeo = (g) => {
      const index = g.getIndex();
      if (!index) return null;
      const tri = index.array, triN = (tri.length / 3) | 0;
      const P = g.getAttribute('position').array;
      const own = new Int16Array(triN).fill(-1);
      let cut = 0;
      for (let t = 0; t < triN; t++) {
        const i0 = tri[t * 3] * 3, i1 = tri[t * 3 + 1] * 3, i2 = tri[t * 3 + 2] * 3;
        const yLo = Math.min(P[i0 + 1], P[i1 + 1], P[i2 + 1]);
        const yHi = Math.max(P[i0 + 1], P[i1 + 1], P[i2 + 1]);
        const mx = (P[i0] + P[i1] + P[i2]) / 3, mz = (P[i0 + 2] + P[i1 + 2] + P[i2 + 2]) / 3;
        for (let k = 0; k < B.length; k++) {
          const b = B[k];
          // ① 三角形與走廊斷面重疊(含「跨越但無頂點在內」——洞口/明隧道端點的常見情形)
          if (!triBore(b, P[i0], P[i0 + 2], P[i1], P[i1 + 2], P[i2], P[i2 + 2])) continue;
          // ②③ 高差判定:fp bore(地下道)MUST 逐頂點對「該頂點自己所在深度」的路面 ——
          // 引道是爬升坡,地形格三角形寬 ~8.3m,拿質心一枚樣本比對整片的 yHi/yLo,遠端頂點
          // 的路面比質心高 ⇒「引道路面之下」的路塹底被系統性誤刪,rim 因此跑到洞外路面上、
          // collar 沿它織出橫跨洞口的殘片(2026-08-05 使用者回報)。無 fp(山體隧道/明隧道)
          // 維持質心判定 = 逐位元舊制(平直剖面下兩者差異只在 slope 那一點點,行為已凍結)。
          if (b.fp?.length > 1) {
            const f0 = floorAt(b, P[i0], P[i0 + 2]), f1 = floorAt(b, P[i1], P[i1 + 2]), f2 = floorAt(b, P[i2], P[i2 + 2]);
            const lo = b.lift + 0.15, hi = b.clear + 0.25;
            if (P[i0 + 1] <= f0 + lo && P[i1 + 1] <= f1 + lo && P[i2 + 1] <= f2 + lo) continue;   // ② 全在路面之下
            if (P[i0 + 1] >= f0 + hi && P[i1 + 1] >= f1 + hi && P[i2 + 1] >= f2 + hi) continue;   // ③ 全在天花之上
          } else {
            const fy = floorAt(b, mx, mz);
            if (yHi <= fy + b.lift + 0.15) continue;      // ② 全在路面之下
            if (yLo >= fy + b.clear + 0.25) continue;     // ③ 全在天花之上
          }
          touched[k] = true;                            // 重疊 bore 全部記帳(認領只給第一座)
          if (own[t] < 0) { own[t] = k; cut++; }
        }
      }
      if (!cut) return null;
      return { own, tri, triN, P, index, g };
    };
    const compact = (r) => {
      let w = 0;
      for (let t = 0; t < r.triN; t++) {
        if (r.own[t] >= 0) continue;
        r.tri[w++] = r.tri[t * 3]; r.tri[w++] = r.tri[t * 3 + 1]; r.tri[w++] = r.tri[t * 3 + 2];
      }
      r.index.needsUpdate = true;
      r.g.setDrawRange(0, w);
    };
    // ---- 地被層:Mesh 打洞、InstancedMesh 縮零(實例幾何共用,MUST NOT 動它的 index)----
    const M = new THREE.Matrix4();
    for (const o of covers) {
      if (o.isInstancedMesh) {
        let hit = false;
        for (let i = 0; i < o.count; i++) {
          o.getMatrixAt(i, M);
          const e = M.elements, x = e[12], y = e[13], z = e[14];
          if (e[0] === 0 && e[5] === 0) continue;      // 已縮零
          let k = -1;
          for (let j = 0; j < B.length && k < 0; j++) if (inBore(B[j], x, z)) k = j;
          if (k < 0) continue;
          const b = B[k], fy = floorAt(b, x, z);
          if (y <= fy + b.lift + 0.15 || y >= fy + b.clear + 0.25) continue;
          M.makeScale(0, 0, 0); o.setMatrixAt(i, M); hit = true;
        }
        if (hit) o.instanceMatrix.needsUpdate = true;
      } else if (o.isMesh) {
        const r = punchGeo(o.geometry);
        if (r) compact(r);
      }
    }
    // ---- 地形本體:打洞 + 取洞緣(collar 貼補用)----
    const res = punchGeo(geo);
    if (!res) return { rims, touched };
    const { own, tri, triN, P } = res;
    // 解析射線(rayTerrain)與網格同形:被刪的三角形一併記帳,行進時跳過 ——
    // 否則彈道會被「已經不存在的洞口面」擋住(打不進隧道)。MUST 在 index 壓實之前算。
    for (let t = 0; t < triN; t++) {
      if (own[t] >= 0) markTriDead(tri[t * 3], tri[t * 3 + 1], tri[t * 3 + 2]);
    }
    // 洞緣 = 只被一個「被刪三角形」用到的邊(被兩個用到 = 洞內部)。MUST 在 index 壓實之前算。
    const NV = N * N, em = new Map();
    for (let t = 0; t < triN; t++) {
      const k = own[t];
      if (k < 0) continue;
      const v = [tri[t * 3], tri[t * 3 + 1], tri[t * 3 + 2]];
      for (let e = 0; e < 3; e++) {
        const p = v[e], q = v[(e + 1) % 3];
        const key = p < q ? p * NV + q : q * NV + p;
        const rec = em.get(key);
        if (rec) rec.n++; else em.set(key, { n: 1, p, q, b: k });
      }
    }
    for (const r of em.values()) {
      if (r.n !== 1) continue;
      rims[r.b].push([P[r.p * 3], P[r.p * 3 + 1], P[r.p * 3 + 2], P[r.q * 3], P[r.q * 3 + 1], P[r.q * 3 + 2]]);
    }
    // 舊法線保留:洞緣少了幾片面的平均法線差異肉眼不可辨,重算反而多跑一輪 N²
    compact(res);
    return { rims, touched };
  }

  onProgress?.(1, '地形完成');
  return { group, mesh, heightAt, natureAt, rayTerrain, carveTunnels, carveGalleryBands, gradeRoadBeds, punchPortalHoles, sampleColor, waterY, center, bbox, worldW, worldH, minX, minZ, maxX, maxZ, minH, maxH, avgH, usedFallback, inDryBand: dryBand };
}
