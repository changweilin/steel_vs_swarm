// ============ 地貌系統:五類地被 + 圖資建物 + 兵線淨空 ============
// 依衛星影像逐點分類五種地貌,鋪設對應的 3D 地物:
//   綠地   — 竹林(大小不一的群落)/ 闊葉林 / 針葉林(高海拔)
//   裸露地 — 芒草 / 箭竹 / 灌木 / 多肉植物
//   市區   — 依 OSM 圖資設置建物(住宅/商辦/醫院/學校/車站/寺廟/教堂/
//            清真寺/博物館/電塔/工廠),離線時退回程序生成街區
//   水體   — 不鋪地物(水面由 terrain.js 處理)
//   濕地   — 紅樹林 / 蘆葦(僅低海拔成立)
// 預設場地的 mix(venues.js)會對分類加權,做出「單一 80% / 混合」的場地感。
// 兵線走廊保持淨空(寬度 > 4 台機甲並行),主堡與防禦塔周圍同樣清場。
// 植被全部用 InstancedMesh(低多邊形 + flatShading),整張圖 < 20 個 draw call。
// 亂數以戰場中心為種子:同一房間所有玩家看到同一片森林。
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { ENV, GAME } from './data.js';
import { llToWorld } from './terrain.js';
import { toonMat, toonGradient } from './hazards.js';

const CELL = 10;                 // 淨空網格(m);走廊全寬約 30m > 4×3.5m 機甲
const MAX_VEG = 6000;            // 植被實例上限
const MAX_BUILDINGS = 240;       // 建物上限(特殊地標另計 ≤ 60)
const OVERPASS = 'https://overpass-api.de/api/interpreter';

// ---- 決定性亂數(mulberry32):全房間共享同一片地貌 ----
function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ---- 淨空網格 ----
function cellKey(x, z) { return `${Math.round(x / CELL)},${Math.round(z / CELL)}`; }

function buildClearance(cfg, center) {
  const blocked = new Set();
  const blockPoint = (x, z, r = CELL) => {
    const n = Math.ceil(r / CELL);
    const cx = Math.round(x / CELL), cz = Math.round(z / CELL);
    for (let i = -n; i <= n; i++) {
      for (let j = -n; j <= n; j++) {
        if (i * i + j * j <= n * n + n) blocked.add(`${cx + i},${cz + j}`);
      }
    }
  };
  const lanesW = cfg.lanes.map((lane) => lane.map(([lat, lng]) => llToWorld(lat, lng, center)));
  for (const lane of lanesW) {
    for (let i = 1; i < lane.length; i++) {
      const [x1, z1] = lane[i - 1], [x2, z2] = lane[i];
      const seg = Math.hypot(x2 - x1, z2 - z1);
      const n = Math.max(1, Math.ceil(seg / 5));
      for (let k = 0; k <= n; k++) {
        blockPoint(x1 + (x2 - x1) * k / n, z1 + (z2 - z1) * k / n, 14);   // 走廊半寬 14m
      }
    }
    // 防禦塔位置(與 sim.js 同一算法)周圍清場
    const cum = [0];
    for (let i = 1; i < lane.length; i++) cum.push(cum[i - 1] + Math.hypot(lane[i][0] - lane[i - 1][0], lane[i][1] - lane[i - 1][1]));
    const total = cum[cum.length - 1];
    for (const frac of GAME.TOWER_FRACS) {
      for (const d of [total * frac, total * (1 - frac)]) {
        let i = 1; while (cum[i] < d && i < cum.length - 1) i++;
        const f = (d - cum[i - 1]) / (cum[i] - cum[i - 1] || 1);
        blockPoint(lane[i - 1][0] + (lane[i][0] - lane[i - 1][0]) * f,
                   lane[i - 1][1] + (lane[i][1] - lane[i - 1][1]) * f, 30);
      }
    }
  }
  for (const side of ['SWARM', 'STEEL']) {
    const [x, z] = llToWorld(cfg.bases[side][0], cfg.bases[side][1], center);
    blockPoint(x, z, 70);
  }
  return blocked;
}

// ---- 地貌分類(影像顏色 + 高程 + 場地 mix 加權)----
function weightedPick(mix, rnd) {
  let sum = 0;
  for (const k in mix) sum += mix[k];
  let r = rnd() * sum;
  for (const k in mix) { r -= mix[k]; if (r <= 0) return k; }
  return null;
}

function classify(rgb, h, mix, rnd) {
  let c = null;
  if (rgb) {
    const [r, g, b] = rgb;
    if (b > r + 14 && b > g + 6) c = 'water';
    else if (g > r + 10 && g > b + 12) c = 'green';
    else {
      const sat = Math.max(r, g, b) - Math.min(r, g, b);
      if (sat < 24) c = 'urban';             // 低飽和灰 → 人工地貌
      else if (r > b + 12) c = 'bare';       // 棕黃 → 裸露地
      else c = 'green';
    }
  }
  if (mix && rnd() < 0.55) c = weightedPick(mix, rnd) || c;   // 場地類型加權
  if (!c) c = h > 400 ? 'bare' : 'green';                     // 無影像時粗略猜
  if (c === 'wet' && h > 8) c = 'green';                      // 濕地只在低海拔
  return c;
}

// ---- 植被幾何(低多邊形;key='foliage'/'conifer'/'grass' 依季節換色)----
const cyl = (r1, r2, h, n = 5) => new THREE.CylinderGeometry(r1, r2, h, n);
const cone = (r, h, n = 5) => new THREE.ConeGeometry(r, h, n);
const ico = (r) => new THREE.IcosahedronGeometry(r, 0);

const VEG_DEFS = {
  bamboo:      { parts: [{ g: cyl(0.10, 0.14, 6.5), y: 3.25, c: 0x8fae4e }, { g: cone(1.1, 2.4), y: 7.4, key: 'foliage' }] },
  broadleaf:   { parts: [{ g: cyl(0.22, 0.34, 2.8), y: 1.4, c: 0x6b4a2f }, { g: ico(2.6), y: 4.8, key: 'foliage', sy: 0.78 }] },
  birch:       { parts: [{ g: cyl(0.16, 0.22, 3.4), y: 1.7, c: 0xe8e4dc }, { g: ico(2.0), y: 4.6, key: 'foliage', sy: 0.9 }] },
  deadtree:    { parts: [{ g: cyl(0.14, 0.30, 4.4), y: 2.2, c: 0x6a5a48 }, { g: cyl(0.06, 0.1, 2.2, 5), y: 4.6, c: 0x5c4e40 }] },
  conifer:     { parts: [{ g: cyl(0.20, 0.30, 1.8), y: 0.9, c: 0x5d4027 }, { g: cone(2.0, 6.4, 6), y: 4.9, key: 'conifer' }] },
  silvergrass: { parts: [{ g: cone(0.7, 1.7), y: 0.85, key: 'grass' }] },
  arrowbamboo: { parts: [{ g: cone(0.9, 2.3), y: 1.15, c: 0x5c7a3a }] },
  shrub:       { parts: [{ g: ico(0.9), y: 0.8, key: 'foliage', sy: 0.8 }] },
  succulent:   { parts: [{ g: cyl(0.5, 0.7, 0.9, 6), y: 0.45, c: 0x7a9c74 }] },
  mangrove:    { parts: [{ g: cyl(0.25, 0.5, 1.8), y: 0.9, c: 0x54412e }, { g: ico(2.0), y: 2.7, key: 'foliage', sy: 0.6 }] },
  reed:        { parts: [{ g: cone(0.35, 1.9, 4), y: 0.95, c: 0xa9b06a }] },
};

// ---- Quaternius Ultimate Stylized Nature(CC0)植被插槽 ----
// 下載自 quaternius.com(gltf + bin + 貼圖,法線圖已剝除);
// 載入失敗自動退回上面 VEG_DEFS 的程序生成版本,不開天窗。
const NATURE_DIR = 'assets/models/quaternius/nature/';
const NATURE_MANIFEST = {
  broadleaf:   { files: ['MapleTree_1.gltf', 'MapleTree_2.gltf', 'MapleTree_3.gltf'], h: 8 },
  birch:       { files: ['BirchTree_1.gltf', 'BirchTree_2.gltf'], h: 8.5 },
  shrub:       { files: ['Bush.gltf', 'Bush_Large.gltf', 'Bush_Small_Flowers.gltf'], h: 1.8 },
  silvergrass: { files: ['Grass_Large.gltf', 'Grass_Small.gltf'], h: 1.2 },
  deadtree:    { files: ['DeadTree_1.gltf', 'DeadTree_2.gltf'], h: 6.5 },
};
// 葉片的季節色偏(乘在貼圖上;樹幹不動)
const SEASON_LEAF_TINT = { spring: 0xd9ffd0, summer: 0xffffff, autumn: 0xffab5e, winter: 0xc9d6da };

/** gltf → 正規化零件(高度=1、底部貼地),材質轉 toon 並保留貼圖 */
function extractNatureParts(gltf, season) {
  const root = gltf.scene;
  root.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(root);
  const h = Math.max(0.01, box.max.y - box.min.y);
  const norm = new THREE.Matrix4()
    .makeScale(1 / h, 1 / h, 1 / h)
    .multiply(new THREE.Matrix4().makeTranslation(-(box.min.x + box.max.x) / 2, -box.min.y, -(box.min.z + box.max.z) / 2));
  const parts = [];
  root.traverse((o) => {
    if (!o.isMesh) return;
    const geo = o.geometry.clone().applyMatrix4(new THREE.Matrix4().multiplyMatrices(norm, o.matrixWorld));
    const src = Array.isArray(o.material) ? o.material[0] : o.material;
    const mat = new THREE.MeshToonMaterial({
      color: src.color ? src.color.clone() : new THREE.Color(0xffffff),
      map: src.map || null,
      gradientMap: toonGradient(),
    });
    if (src.map) { mat.alphaTest = 0.5; mat.side = THREE.DoubleSide; }   // 葉片鏤空貼圖
    if (/leaves|grass|flower|bush/i.test(`${src.name} ${o.name} ${src.map?.name || ''}`)) {
      mat.color.multiply(new THREE.Color(SEASON_LEAF_TINT[season] ?? 0xffffff));
    }
    parts.push({ geo, mat });
  });
  return parts;
}

/** 併發載入 manifest 植被模型;個別失敗只是該類型退回程序生成 */
async function loadNatureModels(season) {
  const loader = new GLTFLoader();
  const out = {};
  await Promise.all(Object.entries(NATURE_MANIFEST).map(async ([type, def]) => {
    const slots = new Array(def.files.length).fill(null);   // 保持檔案順序:全房間變體分配一致
    await Promise.all(def.files.map(async (f, i) => {
      try {
        const gltf = await loader.loadAsync(NATURE_DIR + f);
        const parts = extractNatureParts(gltf, season);
        if (parts.length) slots[i] = { parts };
      } catch (e) {
        console.warn(`植被模型載入失敗(退回程序生成):${f}`, e.message);
      }
    }));
    const variants = slots.filter(Boolean);
    if (variants.length) out[type] = { variants, h: def.h };
  }));
  return out;
}

/** GLB 植被 → InstancedMesh(變體以 i % n 決定性分配;實例色/傾斜差異化同程序生成版) */
function buildVegMeshesGlb(entry, items) {
  const meshes = [];
  const groups = entry.variants.map(() => []);
  items.forEach((it, i) => groups[i % entry.variants.length].push([it, i]));
  const M = new THREE.Matrix4(), Q = new THREE.Quaternion(), E = new THREE.Euler();
  const P = new THREE.Vector3(), S = new THREE.Vector3();
  const tint = new THREE.Color();
  groups.forEach((list, vi) => {
    if (!list.length) return;
    for (const part of entry.variants[vi].parts) {
      const m = new THREE.InstancedMesh(part.geo, part.mat, list.length);
      list.forEach(([it, gi], k) => {
        E.set(it.tx || 0, it.ry, it.tz || 0);
        Q.setFromEuler(E);
        P.set(it.x, it.y, it.z);
        const sc = it.s * entry.h;
        S.set(sc, sc, sc);
        M.compose(P, Q, S);
        m.setMatrixAt(k, M);
        const j1 = ((gi * 2654435761) >>> 0) % 100 / 100;
        const j2 = ((gi * 1597334677) >>> 0) % 100 / 100;
        const j3 = ((gi * 3812015801) >>> 0) % 100 / 100;
        tint.setRGB(0.82 + j1 * 0.32, 0.82 + j2 * 0.32, 0.82 + j3 * 0.32);
        m.setColorAt(k, tint);
      });
      m.instanceMatrix.needsUpdate = true;
      if (m.instanceColor) m.instanceColor.needsUpdate = true;
      m.castShadow = false;
      m.frustumCulled = false;
      meshes.push(m);
    }
  });
  return meshes;
}

function seasonColor(key, fixed, season) {
  const s = ENV.seasons[season] || ENV.seasons.summer;
  if (key === 'foliage') return s.foliage;
  if (key === 'grass') return s.grass;
  if (key === 'conifer') return season === 'winter' ? 0x8fa89a : 0x2f6b34;
  return fixed ?? 0x777777;
}

/** 把某類植被的所有實例組成 InstancedMesh(每 part 一個 draw call) */
function buildVegMeshes(type, items, season) {
  const def = VEG_DEFS[type];
  const meshes = [];
  const M = new THREE.Matrix4(), Q = new THREE.Quaternion(), E = new THREE.Euler();
  const P = new THREE.Vector3(), S = new THREE.Vector3();
  const tint = new THREE.Color();
  for (const part of def.parts) {
    // 日漫賽璐璐渲染(4 階 toon 漸層,取代寫實 PBR)
    const mat = toonMat(seasonColor(part.key, part.c, season));
    const m = new THREE.InstancedMesh(part.g, mat, items.length);
    items.forEach((it, i) => {
      E.set(it.tx || 0, it.ry, it.tz || 0);   // 微傾斜:每棵樹站姿不同
      Q.setFromEuler(E);
      P.set(it.x, it.y + part.y * it.s, it.z);
      S.set(it.s, it.s * (part.sy || 1), it.s);
      M.compose(P, Q, S);
      m.setMatrixAt(i, M);
      // 每實例隨機差異化:RGB 各自抖動 = 明度 + 色相同時變化,不像複製貼上
      const j1 = ((i * 2654435761) >>> 0) % 100 / 100;
      const j2 = ((i * 1597334677) >>> 0) % 100 / 100;
      const j3 = ((i * 3812015801) >>> 0) % 100 / 100;
      tint.setRGB(0.82 + j1 * 0.32, 0.82 + j2 * 0.32, 0.82 + j3 * 0.32);
      m.setColorAt(i, tint);
    });
    m.instanceMatrix.needsUpdate = true;
    if (m.instanceColor) m.instanceColor.needsUpdate = true;
    m.castShadow = false;
    m.frustumCulled = false;   // 實例散佈全圖,包圍球不可靠
    meshes.push(m);
  }
  return meshes;
}

// ---- 建物(特殊地標 = 小 Group;住宅/商辦 = InstancedMesh)----
function bmat(color, opts = {}) {
  return toonMat(color, opts);   // 建物同樣走日漫賽璐璐
}
function box(w, h, d, color, x = 0, y = 0, z = 0) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), bmat(color));
  m.position.set(x, y + h / 2, z);
  return m;
}

const LANDMARKS = {
  hospital: (g) => {
    g.add(box(16, 18, 12, 0xe8e4dc));
    g.add(box(1.6, 5, 0.6, 0xd93a2b, 0, 18.2, 6.0));   // 紅十字(直)
    g.add(box(5, 1.6, 0.6, 0xd93a2b, 0, 19.9, 6.0));   //        (橫)
  },
  school: (g) => {
    g.add(box(22, 9, 8, 0xd9c9a8));
    g.add(box(8, 9, 8, 0xd9c9a8, 10, 0, 8));
    const pole = new THREE.Mesh(cyl(0.12, 0.12, 12, 6), bmat(0x9aa2a8));
    pole.position.set(-8, 6, 8); g.add(pole);
  },
  station: (g) => {
    g.add(box(26, 7, 12, 0xb8bfc4));
    const roof = new THREE.Mesh(new THREE.CylinderGeometry(6, 6, 26, 10, 1, false, 0, Math.PI), bmat(0x6f8a99));
    roof.rotation.z = Math.PI / 2; roof.position.y = 7; g.add(roof);
  },
  temple: (g) => {
    g.add(box(12, 6, 10, 0xc9563a));
    const r1 = new THREE.Mesh(cone(9.5, 3.4, 4), bmat(0x8a3324)); r1.position.y = 7.7; r1.rotation.y = Math.PI / 4; g.add(r1);
    const r2 = new THREE.Mesh(cone(6.5, 2.8, 4), bmat(0x8a3324)); r2.position.y = 11; r2.rotation.y = Math.PI / 4; g.add(r2);
  },
  church: (g) => {
    g.add(box(10, 9, 16, 0xd8d2c4));
    g.add(box(4.5, 17, 4.5, 0xd8d2c4, 0, 0, -8));
    g.add(box(0.5, 3, 0.5, 0xc7a13d, 0, 17, -8));
    g.add(box(1.8, 0.5, 0.5, 0xc7a13d, 0, 18.6, -8));
  },
  mosque: (g) => {
    g.add(box(14, 8, 14, 0xe6ded0));
    const dome = new THREE.Mesh(new THREE.SphereGeometry(5.4, 10, 8, 0, Math.PI * 2, 0, Math.PI / 2), bmat(0x3f8f7a));
    dome.position.y = 8; g.add(dome);
    const mn = new THREE.Mesh(cyl(0.9, 1.1, 18, 8), bmat(0xe6ded0)); mn.position.set(9.5, 9, 9.5); g.add(mn);
    const mt = new THREE.Mesh(cone(1.3, 2.6, 8), bmat(0x3f8f7a)); mt.position.set(9.5, 19.3, 9.5); g.add(mt);
  },
  museum: (g) => {
    g.add(box(20, 8, 14, 0xcfc8b8));
    for (let i = -2; i <= 2; i++) {
      const col = new THREE.Mesh(cyl(0.55, 0.55, 7, 8), bmat(0xe3dccb));
      col.position.set(i * 3.6, 3.5, 7.6); g.add(col);
    }
    const ped = new THREE.Mesh(cone(11, 3, 3), bmat(0xd8d1c0));
    ped.rotation.y = Math.PI / 2; ped.scale.z = 0.45; ped.position.y = 9.4; g.add(ped);
  },
  power: (g) => {
    const tower = new THREE.Mesh(cyl(0.9, 3.4, 42, 4), bmat(0x8e979e, { wireframe: true }));
    tower.position.y = 21; g.add(tower);
    g.add(box(16, 0.7, 0.7, 0x8e979e, 0, 34, 0));
    g.add(box(11, 0.7, 0.7, 0x8e979e, 0, 38, 0));
  },
  factory: (g) => {
    g.add(box(24, 9, 14, 0x9aa0a4));
    const ch1 = new THREE.Mesh(cyl(1.1, 1.4, 16, 8), bmat(0x7c8388)); ch1.position.set(-8, 8, -4); g.add(ch1);
    const ch2 = new THREE.Mesh(cyl(0.9, 1.2, 12, 8), bmat(0x7c8388)); ch2.position.set(-4.5, 6, -4); g.add(ch2);
  },
};

/** OSM tags → 建物類型 */
function buildingType(tags) {
  const b = tags.building, a = tags.amenity;
  if (a === 'hospital' || b === 'hospital') return 'hospital';
  if (a === 'school' || a === 'university' || a === 'college' || b === 'school' || b === 'university') return 'school';
  if (b === 'train_station' || tags.railway === 'station' || a === 'bus_station') return 'station';
  if (a === 'place_of_worship') {
    const r = tags.religion;
    if (r === 'muslim') return 'mosque';
    if (r === 'christian') return 'church';
    return 'temple';
  }
  if (tags.tourism === 'museum' || b === 'museum') return 'museum';
  if (tags.power === 'tower') return 'power';
  if (b === 'industrial' || b === 'factory' || b === 'warehouse') return 'factory';
  if (b === 'commercial' || b === 'office' || b === 'retail' || b === 'hotel' || b === 'apartments' && (+tags['building:levels'] || 0) >= 10) return 'commercial';
  return 'residential';
}

function buildingHeight(tags, type, rnd) {
  const h = parseFloat(tags.height) || (+tags['building:levels'] || 0) * 3.2;
  if (h > 3) return Math.min(h, 120);
  return type === 'commercial' ? 24 + rnd() * 40 : 7 + rnd() * 9;
}

/** Overpass 圖資(10 秒沒回就放棄 → 程序生成備援):建物 + 鐵路/捷運 + 瀑布 */
async function fetchOsmFeatures(bbox) {
  const bb = `${bbox.minLat.toFixed(5)},${bbox.minLng.toFixed(5)},${bbox.maxLat.toFixed(5)},${bbox.maxLng.toFixed(5)}`;
  const q = `[out:json][timeout:9];`
    + `(way["building"](${bb});node["power"="tower"](${bb}););out center tags 600;`
    + `way["railway"~"^(rail|subway|light_rail|monorail|narrow_gauge|tram)$"](${bb});out geom 60;`
    + `node["waterway"="waterfall"](${bb});out 20;`;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 10000);
  try {
    const resp = await fetch(OVERPASS, { method: 'POST', body: 'data=' + encodeURIComponent(q), signal: ctrl.signal });
    if (!resp.ok) return null;
    const data = await resp.json();
    const buildings = [], rails = [], falls = [];
    for (const el of data.elements || []) {
      const tags = el.tags || {};
      if (el.type === 'way' && el.geometry && tags.railway) {
        rails.push({ tags, geometry: el.geometry });
      } else if (el.type === 'node' && tags.waterway === 'waterfall') {
        falls.push({ lat: el.lat, lng: el.lon, tags });
      } else {
        const lat = el.center?.lat ?? el.lat, lng = el.center?.lon ?? el.lon;
        if (Number.isFinite(lat)) buildings.push({ lat, lng, tags });
      }
    }
    return { buildings, rails, falls };
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * 道路路網(獨立 Overpass 查詢):與建物/鐵路分開,避免道路查詢過重或逾時時
 * 連帶拖垮既有的建物/鐵路渲染。失敗回 null → buildBiomes 退回以兵線為主要道路。
 */
async function fetchOsmRoads(bbox) {
  const bb = `${bbox.minLat.toFixed(5)},${bbox.minLng.toFixed(5)},${bbox.maxLat.toFixed(5)},${bbox.maxLng.toFixed(5)}`;
  const q = `[out:json][timeout:9];`
    + `way["highway"~"^(motorway|trunk|primary|secondary|tertiary|unclassified|residential|living_street|service|track|path|footway|pedestrian)$"](${bb});out geom 300;`;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 10000);
  try {
    const resp = await fetch(OVERPASS, { method: 'POST', body: 'data=' + encodeURIComponent(q), signal: ctrl.signal });
    if (!resp.ok) return null;
    const data = await resp.json();
    const roads = [];
    for (const el of data.elements || []) {
      if (el.type === 'way' && el.geometry && el.tags?.highway) roads.push({ tags: el.tags, geometry: el.geometry });
    }
    return roads.length ? roads : null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

// ---- 道路(圖資 way):有寬度的賽璐璐路面,主/次分級 + 依地貌變色 ----
const ROAD_W = {
  motorway: 12, trunk: 11, primary: 10, secondary: 8, tertiary: 7,
  unclassified: 5, residential: 5.5, living_street: 5, service: 4,
  pedestrian: 4, track: 3.5, footway: 2.4, path: 2.2,
};
const MAIN_HW = /^(motorway|trunk|primary|secondary|tertiary)$/;
function roadWidth(tags) {
  const base = ROAD_W[tags.highway] || 4;
  const lanes = parseInt(tags.lanes, 10) || 0;
  return lanes ? Math.max(base, lanes * 3.2) : base;   // 寬度依圖資車道數
}
// 路面顏色(cel-shaded):城市柏油 / 綠地泥土 / 裸露地礫石;主/次略有深淺
function roadColor(biome, main) {
  if (biome === 'urban') return main ? 0x3a3f45 : 0x4a4640;
  if (biome === 'green') return main ? 0x6f5b3e : 0x77603f;
  if (biome === 'bare') return main ? 0x8c7c5a : 0x94855f;
  if (biome === 'wet') return main ? 0x5c5a48 : 0x6a6350;
  return main ? 0x44484d : 0x50493f;
}

/**
 * 把圖資道路(或離線備援的兵線)畫成貼地賽璐璐路面。
 * 純視覺:掛在 biomes group,不進射擊 raycast、不描邊。
 * 依地貌 + 主/次分色批次合併(每色一個 Mesh),寬度取自圖資車道數。
 */
function buildRoads(group, roads, terrain, center, mix, rnd) {
  const inb = 4;
  const buckets = new Map();   // color -> { pos, nrm, idx, base }
  const bucketOf = (color) => {
    let b = buckets.get(color);
    if (!b) { b = { pos: [], nrm: [], idx: [], base: 0 }; buckets.set(color, b); }
    return b;
  };
  let built = 0;
  for (const way of roads) {
    if (way.tags.tunnel) continue;             // 隧道段不畫
    const main = MAIN_HW.test(way.tags.highway);
    const hw = roadWidth(way.tags) / 2;
    const lift = way.tags.bridge ? 3 : 0.18;
    // 世界折線(超出邊界即切段)
    const runs = [];
    let cur = [];
    for (const gpt of way.geometry) {
      const [x, z] = llToWorld(gpt.lat, gpt.lon, center);
      if (x < terrain.minX + inb || x > terrain.maxX - inb || z < terrain.minZ + inb || z > terrain.maxZ - inb) {
        if (cur.length >= 2) runs.push(cur);
        cur = [];
        continue;
      }
      cur.push([x, z]);
    }
    if (cur.length >= 2) runs.push(cur);
    for (const run of runs) {
      const mid = run[(run.length / 2) | 0];
      const biome = classify(terrain.sampleColor?.(mid[0], mid[1]), terrain.heightAt(mid[0], mid[1]), mix, rnd);
      if (biome === 'water') continue;
      const b = bucketOf(roadColor(biome, main));
      const nP = run.length, vbase = b.base;
      for (let i = 0; i < nP; i++) {
        const [x, z] = run[i];
        const a = run[Math.max(0, i - 1)], c = run[Math.min(nP - 1, i + 1)];
        let dx = c[0] - a[0], dz = c[1] - a[1];
        const l = Math.hypot(dx, dz) || 1; dx /= l; dz /= l;
        const px = dz, pz = -dx;                 // XZ 垂直向量
        const lx = x + px * hw, lz = z + pz * hw, rxp = x - px * hw, rzp = z - pz * hw;
        b.pos.push(lx, terrain.heightAt(lx, lz) + lift, lz);
        b.pos.push(rxp, terrain.heightAt(rxp, rzp) + lift, rzp);
        b.nrm.push(0, 1, 0, 0, 1, 0);
      }
      for (let i = 0; i < nP - 1; i++) {
        const k = vbase + i * 2;
        b.idx.push(k, k + 1, k + 2, k + 1, k + 3, k + 2);
      }
      b.base += nP * 2;
      built++;
      if (built >= 600) break;
    }
    if (built >= 600) break;
  }
  for (const [color, b] of buckets) {
    if (!b.idx.length) continue;
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(b.pos, 3));
    geo.setAttribute('normal', new THREE.Float32BufferAttribute(b.nrm, 3));
    geo.setIndex(b.idx);
    const m = new THREE.Mesh(geo, toonMat(color));
    m.frustumCulled = false;
    m.renderOrder = 1;
    m.userData.noOutline = true;
    group.add(m);
  }
  return built;
}

// ---- 鐵路 / 捷運(圖資 way):道碴 + 雙軌 + 行駛中的低多邊形列車 ----
function buildRails(group, rails, terrain, center, dynamics) {
  const lines = [];
  for (const way of rails) {
    if (way.tags.tunnel) continue;   // 隧道段不可見(捷運地下段)
    const elevated = !!way.tags.bridge || way.tags.railway === 'monorail';
    const lift = elevated ? 8 : 0.35;
    const pts = [];
    for (const gpt of way.geometry) {
      const [x, z] = llToWorld(gpt.lat, gpt.lon, center);
      if (x < terrain.minX + 5 || x > terrain.maxX - 5 || z < terrain.minZ + 5 || z > terrain.maxZ - 5) {
        if (pts.length >= 2) { lines.push({ pts: [...pts], tags: way.tags, elevated, lift }); }
        pts.length = 0;
        continue;
      }
      pts.push(new THREE.Vector3(x, terrain.heightAt(x, z) + lift, z));
    }
    if (pts.length >= 2) lines.push({ pts, tags: way.tags, elevated, lift });
    if (lines.length >= 30) break;
  }
  if (!lines.length) return 0;

  // 軌道:每線段 1 個道碴床 + 2 條鋼軌(InstancedMesh,整批 3 個 draw call)
  let segs = [];
  for (const l of lines) {
    for (let i = 1; i < l.pts.length && segs.length < 900; i++) segs.push([l.pts[i - 1], l.pts[i], l]);
  }
  const unit = new THREE.BoxGeometry(1, 1, 1);
  const bedM = new THREE.InstancedMesh(unit, toonMat(0x5a5348), segs.length);
  const railM = new THREE.InstancedMesh(unit, toonMat(0x3a3f45), segs.length * 2);
  const M = new THREE.Matrix4(), Q = new THREE.Quaternion(), P = new THREE.Vector3(), S = new THREE.Vector3();
  const up = new THREE.Vector3(0, 1, 0), dir = new THREE.Vector3(), side = new THREE.Vector3();
  segs.forEach(([a, b], i) => {
    dir.subVectors(b, a);
    const len = dir.length();
    dir.normalize();
    Q.setFromUnitVectors(new THREE.Vector3(0, 0, 1), dir);
    side.crossVectors(dir, up).normalize();
    P.addVectors(a, b).multiplyScalar(0.5);
    S.set(3.4, 0.5, len + 0.4);
    M.compose(P, Q, S);
    bedM.setMatrixAt(i, M);
    for (const s of [-1, 1]) {
      const rp = P.clone().addScaledVector(side, s * 0.8);
      rp.y += 0.32;
      S.set(0.2, 0.24, len + 0.4);
      M.compose(rp, Q, S);
      railM.setMatrixAt(i * 2 + (s > 0 ? 1 : 0), M);
    }
  });
  bedM.instanceMatrix.needsUpdate = railM.instanceMatrix.needsUpdate = true;
  bedM.frustumCulled = railM.frustumCulled = false;
  group.add(bedM, railM);

  // 高架橋墩(捷運/橋段)
  const piers = segs.filter(([, , l]) => l.elevated);
  if (piers.length) {
    const pierM = new THREE.InstancedMesh(unit, toonMat(0x8f9296), Math.min(piers.length, 200));
    piers.slice(0, 200).forEach(([a], i) => {
      const gy = terrain.heightAt(a.x, a.z);
      P.set(a.x, (gy + a.y) / 2, a.z);
      S.set(1.6, Math.max(1, a.y - gy), 1.6);
      M.compose(P, new THREE.Quaternion(), S);
      pierM.setMatrixAt(i, M);
    });
    pierM.instanceMatrix.needsUpdate = true;
    pierM.frustumCulled = false;
    group.add(pierM);
  }

  // 列車:最長兩條路線各跑一列(捷運=銀藍、鐵路=橘白),往返行駛
  const byLen = lines.map((l) => {
    let d = 0;
    for (let i = 1; i < l.pts.length; i++) d += l.pts[i].distanceTo(l.pts[i - 1]);
    return { ...l, total: d };
  }).filter((l) => l.total > 300).sort((a, b) => b.total - a.total);
  for (const line of byLen.slice(0, 2)) {
    const metro = /subway|light_rail|monorail|tram/.test(line.tags.railway);
    const train = makeTrain(metro);
    group.add(train);
    dynamics.push(trainDriver(train, line, metro ? 22 : 17));
  }
  return lines.length;
}

/** 低多邊形列車(車頭 + 2 節車廂) */
function makeTrain(metro) {
  const g = new THREE.Group();
  const body = metro ? 0xdfe5ea : 0xe8873c;
  const stripe = metro ? 0x2a6fa8 : 0xf4f0e6;
  for (let c = 0; c < 3; c++) {
    const car = new THREE.Group();
    const m = new THREE.Mesh(new THREE.BoxGeometry(3.0, 3.4, 13.4), toonMat(body));
    m.position.y = 2.4;
    car.add(m);
    const st = new THREE.Mesh(new THREE.BoxGeometry(3.05, 0.7, 13.4), toonMat(stripe));
    st.position.y = 1.7;
    car.add(st);
    const win = new THREE.Mesh(new THREE.BoxGeometry(3.06, 0.9, 11.5),
      toonMat(0x27313a, { emissive: new THREE.Color(0x36434f), emissiveIntensity: 0.5 }));
    win.position.y = 3.1;
    car.add(win);
    if (c === 0) {   // 車頭斜鼻
      const nose = new THREE.Mesh(new THREE.BoxGeometry(3.0, 2.6, 2.2), toonMat(body));
      nose.position.set(0, 2.0, -7.6);
      nose.rotation.x = 0.35;
      car.add(nose);
    }
    car.position.z = c * 14.4;
    g.add(car);
  }
  return g;
}

/** 列車駕駛:沿折線等速前進,端點折返(回傳 dt 更新器) */
function trainDriver(train, line, speed) {
  const cum = [0];
  for (let i = 1; i < line.pts.length; i++) cum.push(cum[i - 1] + line.pts[i].distanceTo(line.pts[i - 1]));
  let s = Math.random() * line.total, dirn = 1;
  const at = (d) => {
    const dd = Math.max(0, Math.min(line.total, d));
    let i = 1;
    while (cum[i] < dd && i < cum.length - 1) i++;
    const f = (dd - cum[i - 1]) / (cum[i] - cum[i - 1] || 1);
    return new THREE.Vector3().lerpVectors(line.pts[i - 1], line.pts[i], f);
  };
  return (dt) => {
    s += speed * dirn * dt;
    if (s > line.total || s < 0) { dirn *= -1; s = Math.max(0, Math.min(line.total, s)); }
    const p = at(s);
    const ahead = at(s + dirn * 8);
    train.position.copy(p);
    if (ahead.distanceToSquared(p) > 0.5) train.lookAt(ahead);
  };
}

// ---- 瀑布(圖資節點):水簾 + 底部水潭 + 湧動泡沫 ----
function buildWaterfalls(group, falls, terrain, center, dynamics) {
  let built = 0;
  for (const f of falls.slice(0, 6)) {
    const [x, z] = llToWorld(f.lat, f.lng, center);
    if (x < terrain.minX + 20 || x > terrain.maxX - 20 || z < terrain.minZ + 20 || z > terrain.maxZ - 20) continue;
    // 找落差方向:採樣 8 方位高程,水從最高側流向最低側
    let hi = { h: -Infinity }, lo = { h: Infinity };
    for (let k = 0; k < 8; k++) {
      const a = k / 8 * Math.PI * 2;
      const h = terrain.heightAt(x + Math.cos(a) * 18, z + Math.sin(a) * 18);
      if (h > hi.h) hi = { h, a };
      if (h < lo.h) lo = { h, a };
    }
    const drop = Math.max(6, hi.h - lo.h);
    const g = new THREE.Group();
    g.position.set(x, lo.h, z);
    g.rotation.y = -lo.a;
    // 水簾(兩層錯開的半透明白幕)
    const sheets = [];
    for (const [w, off, op] of [[7, 0, 0.85], [5, 0.8, 0.55]]) {
      const sheet = new THREE.Mesh(
        new THREE.PlaneGeometry(w, drop),
        new THREE.MeshToonMaterial({
          color: 0xeaf6fb, gradientMap: toonGradient(), transparent: true, opacity: op, side: THREE.DoubleSide,
        }),
      );
      sheet.position.set(0, drop / 2, -off);
      g.add(sheet);
      sheets.push(sheet);
    }
    // 頂緣溢流 + 底部水潭 + 泡沫
    const lip = new THREE.Mesh(new THREE.BoxGeometry(7.4, 0.8, 2.4), toonMat(0xd8eef6, { transparent: true, opacity: 0.9 }));
    lip.position.set(0, drop, -0.6);
    g.add(lip);
    const pool = new THREE.Mesh(new THREE.CylinderGeometry(6.5, 6.5, 0.5, 14),
      toonMat(0x9fd4e8, { transparent: true, opacity: 0.7 }));
    pool.position.y = 0.25;
    g.add(pool);
    const foam = new THREE.Mesh(new THREE.CylinderGeometry(3.4, 4.2, 1.1, 12),
      toonMat(0xffffff, { transparent: true, opacity: 0.8 }));
    foam.position.y = 0.7;
    g.add(foam);
    group.add(g);
    built++;
    // 動態:水簾上下捲動錯覺(縮放脈動)+ 泡沫呼吸
    let t = Math.random() * 10;
    dynamics.push((dt) => {
      t += dt;
      sheets.forEach((s, i) => {
        s.material.opacity = (i === 0 ? 0.85 : 0.55) + Math.sin(t * (3 + i)) * 0.1;
        s.scale.x = 1 + Math.sin(t * 2.4 + i) * 0.05;
      });
      foam.scale.setScalar(1 + Math.sin(t * 3.2) * 0.12);
    });
  }
  return built;
}

/**
 * 建立整張圖的地物。回傳 THREE.Group(加進 terrain.group 同層即可)。
 * cfg 需含 lanes/bases/center/env/venue;terrain 來自 buildTerrain()。
 */
export async function buildBiomes(cfg, terrain, onProgress) {
  const center = cfg.center;
  const season = cfg.env?.season || 'summer';
  const night = cfg.env?.time === 'night';
  const mix = cfg.venue?.mix || null;
  const rnd = mulberry32(
    (Math.round(center.lat * 1e4) * 31 + Math.round(center.lng * 1e4)) ^ ((cfg.teamSize || 5) << 20),
  );
  const group = new THREE.Group();
  group.name = 'biomes';

  onProgress?.(0.02, '規劃兵線淨空走廊…');
  const naturePromise = loadNatureModels(season);   // Quaternius 植被:與散佈並行載入
  const blocked = buildClearance(cfg, center);
  const inb = 30;   // 邊界內縮
  const rx = () => terrain.minX + inb + rnd() * (terrain.worldW - inb * 2);
  const rz = () => terrain.minZ + inb + rnd() * (terrain.worldH - inb * 2);

  // ---- 散佈植被 ----
  const areaKm2 = terrain.worldW * terrain.worldH / 1e6;
  const vegTarget = Math.max(800, Math.min(MAX_VEG, Math.round(areaKm2 * 420)));
  const items = {};   // type -> [{x,y,z,s,ry}]
  const urbanPts = [];
  let placed = 0;
  const put = (type, x, z, s) => {
    items[type] ??= [];
    items[type].push({
      x, y: terrain.heightAt(x, z), z, s, ry: rnd() * Math.PI * 2,
      tx: (rnd() - 0.5) * 0.09, tz: (rnd() - 0.5) * 0.09,   // 站姿微傾斜(每棵不同)
    });
    placed++;
  };

  const attempts = vegTarget * 3;
  for (let a = 0; a < attempts && placed < vegTarget; a++) {
    if ((a & 1023) === 0) onProgress?.(0.05 + (a / attempts) * 0.30, '鋪設植被地貌…');
    const x = rx(), z = rz();
    if (blocked.has(cellKey(x, z))) continue;
    const h = terrain.heightAt(x, z);
    if (h < 0.4) {   // 水體:偶爾在水邊補蘆葦
      if (rnd() < 0.06) put('reed', x, z, 0.8 + rnd() * 0.6);
      continue;
    }
    const biome = classify(terrain.sampleColor?.(x, z), h, mix, rnd);
    if (biome === 'water') continue;
    if (biome === 'urban') {
      if (urbanPts.length < 500) urbanPts.push([x, z]);
      continue;
    }
    if (biome === 'green') {
      const relH = (h - terrain.minH) / Math.max(1, terrain.maxH - terrain.minH);
      const r = rnd();
      if (r < 0.25) {
        // 竹林:大小不一的群落
        const n = 6 + Math.floor(rnd() * 12);
        const cr = 5 + rnd() * 14;
        for (let k = 0; k < n && placed < vegTarget; k++) {
          const bx = x + (rnd() - 0.5) * cr * 2, bz = z + (rnd() - 0.5) * cr * 2;
          if (blocked.has(cellKey(bx, bz)) || terrain.heightAt(bx, bz) < 0.4) continue;
          put('bamboo', bx, bz, 0.8 + rnd() * 0.7);
        }
      } else if (relH > 0.55 || r < 0.55) {
        put('conifer', x, z, 0.75 + rnd() * 0.9);
      } else {
        put(rnd() < 0.3 ? 'birch' : 'broadleaf', x, z, 0.75 + rnd() * 0.9);
      }
    } else if (biome === 'bare') {
      const r = rnd();
      if (r < 0.38) put('silvergrass', x, z, 0.8 + rnd() * 1.0);
      else if (r < 0.58) put('arrowbamboo', x, z, 0.8 + rnd() * 0.8);
      else if (r < 0.78) put('shrub', x, z, 0.7 + rnd() * 0.9);
      else if (r < 0.88) put('deadtree', x, z, 0.7 + rnd() * 0.7);
      else put('succulent', x, z, 0.7 + rnd() * 0.8);
    } else if (biome === 'wet') {
      if (rnd() < 0.45) put('mangrove', x, z, 0.8 + rnd() * 0.7);
      else put('reed', x, z, 0.8 + rnd() * 0.8);
    }
  }
  onProgress?.(0.38, '建置植被模型(Quaternius CC0)…');
  const nature = await naturePromise;
  for (const type in items) {
    const meshes = nature[type]
      ? buildVegMeshesGlb(nature[type], items[type])
      : buildVegMeshes(type, items[type], season);
    for (const m of meshes) group.add(m);
  }

  // ---- 圖資(建物 + 鐵路 + 瀑布)----
  onProgress?.(0.42, '讀取 OSM 圖資(建物/鐵路/道路/瀑布)…');
  let osmData = null, osmRoads = null;
  if (terrain.sampleColor) [osmData, osmRoads] = await Promise.all([fetchOsmFeatures(terrain.bbox), fetchOsmRoads(terrain.bbox)]);
  const osm = osmData?.buildings || null;

  const generic = [];       // {x,z,w,h,d,ry,commercial}
  const landmarks = [];     // {x,z,type,scale}
  const usedLm = new Set();

  const tryPlace = (x, z) =>
    !blocked.has(cellKey(x, z))
    && x > terrain.minX + inb && x < terrain.maxX - inb
    && z > terrain.minZ + inb && z < terrain.maxZ - inb
    && terrain.heightAt(x, z) > 0.4;

  if (osm && osm.length) {
    onProgress?.(0.6, `建置圖資建物(${osm.length} 筆)…`);
    // 特殊地標優先,一般建物均勻抽樣到上限
    osm.sort((p, q) => (buildingType(q.tags) !== 'residential') - (buildingType(p.tags) !== 'residential'));
    for (const el of osm) {
      const [x, z] = llToWorld(el.lat, el.lng, center);
      if (!tryPlace(x, z)) continue;
      const type = buildingType(el.tags);
      if (LANDMARKS[type]) {
        if (landmarks.length < 60) { landmarks.push({ x, z, type }); usedLm.add(type); }
      } else if (generic.length < MAX_BUILDINGS) {
        const commercial = type === 'commercial';
        const h = buildingHeight(el.tags, type, rnd);
        generic.push({ x, z, w: 8 + rnd() * (commercial ? 12 : 7), d: 8 + rnd() * (commercial ? 12 : 7), h, ry: rnd() * Math.PI, commercial });
      }
    }
  }
  // 備援:離線 / 圖資空白但影像判定有市區 → 程序生成街區
  if (!landmarks.length && !generic.length && urbanPts.length > 8) {
    onProgress?.(0.6, '離線模式:程序生成市區…');
    const lmTypes = Object.keys(LANDMARKS);
    urbanPts.forEach(([x, z], i) => {
      if (!tryPlace(x, z)) return;
      if (i < lmTypes.length && rnd() < 0.8) { landmarks.push({ x, z, type: lmTypes[i] }); return; }
      if (generic.length >= MAX_BUILDINGS) return;
      const commercial = rnd() < 0.25;
      generic.push({
        x, z, w: 8 + rnd() * 8, d: 8 + rnd() * 8,
        h: commercial ? 24 + rnd() * 40 : 7 + rnd() * 9,
        ry: rnd() * Math.PI, commercial,
      });
    });
  }

  // 一般建物:兩個 InstancedMesh(住宅暖灰、商辦冷玻璃;夜間商辦亮窗)
  for (const commercial of [false, true]) {
    const list = generic.filter((b) => b.commercial === commercial);
    if (!list.length) continue;
    const mat = toonMat(commercial ? 0x5f7382 : 0x9c948a, {
      emissive: new THREE.Color(night ? (commercial ? 0x36434f : 0x2a2418) : 0x000000),
      emissiveIntensity: night ? 0.6 : 0,
    });
    const m = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), mat, list.length);
    const M = new THREE.Matrix4(), Q = new THREE.Quaternion(), E = new THREE.Euler();
    const P = new THREE.Vector3(), S = new THREE.Vector3();
    list.forEach((b, i) => {
      E.set(0, b.ry, 0); Q.setFromEuler(E);
      P.set(b.x, terrain.heightAt(b.x, b.z) + b.h / 2 - 0.5, b.z);
      S.set(b.w, b.h, b.d);
      M.compose(P, Q, S);
      m.setMatrixAt(i, M);
    });
    m.instanceMatrix.needsUpdate = true;
    m.frustumCulled = false;
    group.add(m);
  }
  // 特殊地標
  onProgress?.(0.85, '放置地標建物…');
  for (const lm of landmarks) {
    const g = new THREE.Group();
    LANDMARKS[lm.type](g);
    g.position.set(lm.x, terrain.heightAt(lm.x, lm.z) - 0.3, lm.z);
    g.rotation.y = rnd() * Math.PI * 2;
    group.add(g);
  }

  // ---- 道路(圖資主/次要;離線則以兵線為主要道路備援)----
  onProgress?.(0.9, '鋪設道路路面…');
  const roadInput = osmRoads?.length
    ? osmRoads
    : cfg.lanes.map((lane) => ({ tags: { highway: 'primary' }, geometry: lane.map(([lat, lng]) => ({ lat, lon: lng })) }));
  const roadsBuilt = buildRoads(group, roadInput, terrain, center, mix, rnd);

  // ---- 鐵路/捷運(含行駛列車)+ 瀑布(動態物件)----
  onProgress?.(0.92, '鋪設鐵路與瀑布…');
  const dynamics = [];
  const railLines = osmData?.rails?.length ? buildRails(group, osmData.rails, terrain, center, dynamics) : 0;
  const fallsBuilt = osmData?.falls?.length ? buildWaterfalls(group, osmData.falls, terrain, center, dynamics) : 0;
  if (dynamics.length) {
    group.userData.update = (dt) => { for (const fn of dynamics) fn(dt); };
  }

  onProgress?.(1, '地貌完成');
  group.userData.stats = {
    veg: placed,
    buildings: generic.length + landmarks.length,
    landmarks: landmarks.length,
    roads: roadsBuilt,
    rails: railLines,
    falls: fallsBuilt,
    osm: !!(osm && osm.length),
  };
  return group;
}
