// ============ 即時 3D 地形(改自 mapping_elf terrainViewer.js)============
// 依戰場設定(bbox)即時抓取高程資料建立地形網格,疊上衛星影像貼圖。
//  - 高程主來源:AWS Terrain Tiles(terrarium PNG,免金鑰、CORS 開放)
//  - 高程備援:open-meteo elevation API(mapping_elf 原本的來源,批次 100 點)
//  - 貼圖:Esri World Imagery(與 mapManager 同來源)拼接成 canvas 紋理
//
// 世界座標:以戰場中心為原點,x = 東(公尺),z = 南(three.js 慣例;
// 模擬層的「北」= -z)。heightAt(x, z) 供機甲貼地、小兵放置使用。
import * as THREE from 'three';
import { toonGradient } from './hazards.js';
import { MAPGEO, TERRAIN, GAME, WATER, battleBBox, solveTowerSites } from './data.js';
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
 *   worldW, worldH, minX, minZ, maxX, maxZ, minH, maxH }
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

  // 地形也走日漫賽璐璐(衛星影像 + 4 階光影 = 2.5D 手繪感)
  let mat;
  if (imagery) {
    const tex = new THREE.CanvasTexture(imagery.canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = 4;
    mat = new THREE.MeshToonMaterial({ map: tex, gradientMap: toonGradient() });
  } else {
    mat = new THREE.MeshToonMaterial({ color: 0x39424c, gradientMap: toonGradient() });
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
    const water = new THREE.Mesh(
      new THREE.PlaneGeometry(worldW, worldH),
      // DoubleSide:視線沒入水下時抬頭仍看得到水面(單面會被背面剔除 = 水下憑空無水)
      new THREE.MeshToonMaterial({ color: 0x1a4a6a, gradientMap: toonGradient(), transparent: true, opacity: 0.82, side: THREE.DoubleSide }),
    );
    water.rotation.x = -Math.PI / 2;
    water.position.set((minX + maxX) / 2, waterY, (minZ + maxZ) / 2);
    group.add(water);
  }

  // 世界座標高度取樣。
  // MUST 與網格三角化(idx: a,c,b / b,c,d;對角線 = b–c)一致:雙線性在鞍點會低於
  // 實際三角面最多 (a+d-b-c)/4 公尺,單位/道路/地被就會沉進地表被擋住。
  function heightAt(x, z) {
    const gj = (x - minX) / (maxX - minX) * (N - 1);
    const gi = (z - minZ) / (maxZ - minZ) * (N - 1);
    const i0 = Math.max(0, Math.min(N - 2, Math.floor(gi)));
    const j0 = Math.max(0, Math.min(N - 2, Math.floor(gj)));
    const fi = Math.max(0, Math.min(1, gi - i0));
    const fj = Math.max(0, Math.min(1, gj - j0));
    const at = (i, j) => heights[i * N + j];
    const a = at(i0, j0), b = at(i0, j0 + 1), c = at(i0 + 1, j0), d = at(i0 + 1, j0 + 1);
    return fi + fj <= 1
      ? a + (b - a) * fj + (c - a) * fi              // 三角形 (a, c, b)
      : d + (c - d) * (1 - fj) + (b - d) * (1 - fi); // 三角形 (b, c, d)
  }

  /**
   * 地下道洞口開挖(2026-07-15;2026-07-22 改制):**只開挖 approaches / 敞開段**,深山段完全不動 →
   * 天花板上方的山體地表保持原樣(照常鋪地被拼圖)。
   * runs: [{ pts:[[x,z]…], floors:[y…] }](floors = 該點的平直路面高度)。
   * 呼叫端(biomes.js)只送「敞開補集」折線(覆蓋段/縫合蓋廊段不送)—— 本函式對送進來的
   * 走廊一律開挖,規則:原地表低於「路面 + clear + 1」(藏不住天花板)才動。
   * 剖面:路廊(≤ hw+1)全深壓到路面高;向外至 hw+7 以 smoothstep 漸束回原地表 =
   * 斜壁路塹,而非舊版垂直斷崖(拉伸三角形布幕 = 破圖主因之一)。
   */
  function carveTunnels(runs, { clear = 8, hw = 9 } = {}) {
    if (!runs?.length) return;
    const full = hw + 1;
    const near = hw + 7;
    const proj = (x, z, r) => {                       // 最近段 + 內插路面高
      let bd = Infinity, bf = 0;
      for (let i = 0; i < r.pts.length - 1; i++) {
        const ax = r.pts[i][0], az = r.pts[i][1];
        const ex = r.pts[i + 1][0] - ax, ez = r.pts[i + 1][1] - az;
        const L2 = ex * ex + ez * ez || 1;
        let t = ((x - ax) * ex + (z - az) * ez) / L2; t = t < 0 ? 0 : t > 1 ? 1 : t;
        const d = Math.hypot(x - (ax + ex * t), z - (az + ez * t));
        if (d < bd) { bd = d; bf = r.floors[i] + (r.floors[i + 1] - r.floors[i]) * t; }
      }
      return { d: bd, floor: bf };
    };
    for (let i = 0; i < N; i++) {
      const z = minZ + (maxZ - minZ) * i / (N - 1);
      for (let j = 0; j < N; j++) {
        const x = minX + (maxX - minX) * j / (N - 1);
        const k = i * N + j, orig = heights[k];
        let target = Infinity;
        for (const r of runs) {
          const p = proj(x, z, r);
          if (p.d > near) continue;
          if (orig < p.floor + clear + 1) {   // 藏不住天花板的敞開/洞口段才挖
            const t = p.d <= full ? 0 : (p.d - full) / (near - full);
            const w = t * t * (3 - 2 * t);    // smoothstep:路廊全深、外緣歸零 = 斜壁
            target = Math.min(target, p.floor + (orig - p.floor) * w);
          }
        }
        if (target < orig) heights[k] = target;
      }
    }
    const posAttr = geo.getAttribute('position');
    for (let k = 0; k < N * N; k++) posAttr.array[k * 3 + 1] = heights[k];
    posAttr.needsUpdate = true;
    geo.computeVertexNormals();
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
        for (const [color, w] of [['#877c6a', (near + 1.5) * 2], ['#948a76', hw * 2]]) {
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
   * 洞口打洞(2026-07-23 洞口透明化):把「戳進隧道斷面」的地形三角形從**繪製 index** 移除,
   * `heights[]` 與 position 屬性一律不動 —— heightAt / 碰撞 / 迷霧 LOS / bakeWetGrid 全讀 heights
   * 陣列,不讀三角形 ⇒ 這是**純視覺**開洞:單位照樣走不過山、砲火照樣打不穿(33b3c54 命脈不動)。
   * 刪除條件三合一(缺一不可,缺了就是破頂或黑洞):
   *   ① 任一頂點落在斷面走廊內(|側向 offset| ≤ hw、進洞深度 0.5 ~ depth);
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
    const B = bores.map((b) => ({ ...b, ca: Math.cos(b.ry), sa: Math.sin(b.ry), far2: (b.depth + b.hw + 24) ** 2 }));
    /** 點是否落在該 bore 的斷面走廊內(不含高度判定) */
    const inBore = (b, x, z) => {
      const dx = x - b.x, dz = z - b.z;
      if (dx * dx + dz * dz > b.far2) return false;
      const lx = dx * b.ca - dz * b.sa, lz = dx * b.sa + dz * b.ca;
      return Math.abs(lx) <= b.hw && lz <= -0.5 && lz >= -b.depth;
    };
    /** 該 bore 在此點深度的路面高(隧道路面是平直內插,slope 為定值) */
    const floorAt = (b, x, z) => b.floorY
      + b.slope * Math.min(b.depth, Math.max(0, -((x - b.x) * b.sa + (z - b.z) * b.ca)));
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
          // ① 任一頂點在走廊內(三角形直徑 < 走廊寬,故「跨越但無頂點在內」不成立)
          if (!inBore(b, P[i0], P[i0 + 2]) && !inBore(b, P[i1], P[i1 + 2]) && !inBore(b, P[i2], P[i2 + 2])) continue;
          const fy = floorAt(b, mx, mz);
          if (yHi <= fy + b.lift + 0.15) continue;      // ② 全在路面之下
          if (yLo >= fy + b.clear + 0.25) continue;     // ③ 全在天花之上
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
  return { group, mesh, heightAt, carveTunnels, punchPortalHoles, sampleColor, waterY, center, bbox, worldW, worldH, minX, minZ, maxX, maxZ, minH, maxH, usedFallback, inDryBand: dryBand };
}
