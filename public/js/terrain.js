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
import { MAPGEO, TERRAIN, GAME, WATER, battleBBox } from './data.js';

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
      return loadImage(TERRARIUM(z, tx0 + cx, ty0 + cy)).then((img) => {
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
  const total = cols * rows;
  await Promise.all(
    Array.from({ length: total }, (_, i) => {
      const cx = i % cols, cy = Math.floor(i / cols);
      return loadImage(IMAGERY(z, tx0 + cx, ty0 + cy))
        .then((img) => ctx.drawImage(img, cx * 256, cy * 256))
        .catch(() => {})   // 缺磚就留底色
        .finally(() => onProgress?.(++done / total));
    }),
  );
  return { canvas, z, tx0, ty0 };
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
  let sampleElev;
  let usedFallback = false;
  try {
    sampleElev = await fetchElevTerrarium(bbox, (f) => onProgress?.(0.02 + f * 0.30, '下載高程資料…'));
  } catch {
    usedFallback = true;
    sampleElev = await fetchElevOpenMeteo(bbox, (f) => onProgress?.(0.02 + f * 0.30, '下載高程資料(備援來源)…'));
  }

  onProgress?.(0.34, '下載衛星影像…');
  let imagery = null;
  try {
    imagery = await fetchImagery(bbox, (f) => onProgress?.(0.34 + f * 0.30, '下載衛星影像…'));
  } catch { /* 沒有貼圖就用素色 */ }

  // 影像取樣(世界公尺 → 經緯度 → mercator 像素):biomes.js 地被分類用
  let sampleColor = null;
  if (imagery) {
    const ictx = imagery.canvas.getContext('2d');
    const idata = ictx.getImageData(0, 0, imagery.canvas.width, imagery.canvas.height).data;
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
  const heights = new Float32Array(N * N);
  let minH = Infinity, maxH = -Infinity;
  for (let i = 0; i < N; i++) {           // i:z 方向(北→南 = minZ→maxZ = maxLat→minLat)
    const lat = bbox.maxLat + (bbox.minLat - bbox.maxLat) * i / (N - 1);
    for (let j = 0; j < N; j++) {
      const lng = bbox.minLng + (bbox.maxLng - bbox.minLng) * j / (N - 1);
      let h = sampleElev(lat, lng);
      if (!Number.isFinite(h)) h = 0;
      heights[i * N + j] = h;
      if (h < minH) minH = h;
      if (h > maxH) maxH = h;
    }
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
   * 地下道洞口開挖(2026-07-15):**只開挖approaches / 敞開段**,深山段完全不動 →
   * 天花板上方的山體地表保持原樣(照常鋪地被拼圖)。
   * runs: [{ pts:[[x,z]…], floors:[y…] }](floors = 該點的平直路面高度)。
   * 規則:近走廊(≤ hw+3)且原地表低於「路面 + clear + 1」(= 山體不夠高、藏不住天花板的敞開/洞口段)→
   *       壓到路面高 = 露出可通行的路;山體夠高處(covered)保持原地表不挖。
   */
  function carveTunnels(runs, { clear = 8, hw = 9 } = {}) {
    if (!runs?.length) return;
    const near = hw + 3;
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
          if (orig < p.floor + clear + 1) target = Math.min(target, p.floor);   // 敞開/洞口段才挖
        }
        if (target < orig) heights[k] = target;
      }
    }
    const posAttr = geo.getAttribute('position');
    for (let k = 0; k < N * N; k++) posAttr.array[k * 3 + 1] = heights[k];
    posAttr.needsUpdate = true;
    geo.computeVertexNormals();
  }

  onProgress?.(1, '地形完成');
  return { group, mesh, heightAt, carveTunnels, sampleColor, waterY, center, bbox, worldW, worldH, minX, minZ, maxX, maxZ, minH, maxH, usedFallback };
}
