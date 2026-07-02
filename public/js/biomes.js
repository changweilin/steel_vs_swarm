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
import { ENV, GAME } from './data.js';
import { llToWorld } from './terrain.js';

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
  conifer:     { parts: [{ g: cyl(0.20, 0.30, 1.8), y: 0.9, c: 0x5d4027 }, { g: cone(2.0, 6.4, 6), y: 4.9, key: 'conifer' }] },
  silvergrass: { parts: [{ g: cone(0.7, 1.7), y: 0.85, key: 'grass' }] },
  arrowbamboo: { parts: [{ g: cone(0.9, 2.3), y: 1.15, c: 0x5c7a3a }] },
  shrub:       { parts: [{ g: ico(0.9), y: 0.8, key: 'foliage', sy: 0.8 }] },
  succulent:   { parts: [{ g: cyl(0.5, 0.7, 0.9, 6), y: 0.45, c: 0x7a9c74 }] },
  mangrove:    { parts: [{ g: cyl(0.25, 0.5, 1.8), y: 0.9, c: 0x54412e }, { g: ico(2.0), y: 2.7, key: 'foliage', sy: 0.6 }] },
  reed:        { parts: [{ g: cone(0.35, 1.9, 4), y: 0.95, c: 0xa9b06a }] },
};

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
    const mat = new THREE.MeshStandardMaterial({
      color: seasonColor(part.key, part.c, season), flatShading: true, roughness: 0.92, metalness: 0,
    });
    const m = new THREE.InstancedMesh(part.g, mat, items.length);
    items.forEach((it, i) => {
      E.set(0, it.ry, 0);
      Q.setFromEuler(E);
      P.set(it.x, it.y + part.y * it.s, it.z);
      S.set(it.s, it.s * (part.sy || 1), it.s);
      M.compose(P, Q, S);
      m.setMatrixAt(i, M);
      tint.setScalar(0.85 + ((i * 2654435761) % 100) / 333);   // 明度抖動,免得像複製貼上
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
  return new THREE.MeshStandardMaterial({ color, flatShading: true, roughness: 0.85, metalness: 0.05, ...opts });
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

/** Overpass 建物(10 秒沒回就放棄 → 程序生成備援) */
async function fetchOsmBuildings(bbox) {
  const bb = `${bbox.minLat.toFixed(5)},${bbox.minLng.toFixed(5)},${bbox.maxLat.toFixed(5)},${bbox.maxLng.toFixed(5)}`;
  const q = `[out:json][timeout:9];(way["building"](${bb});node["power"="tower"](${bb}););out center tags 600;`;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 10000);
  try {
    const resp = await fetch(OVERPASS, { method: 'POST', body: 'data=' + encodeURIComponent(q), signal: ctrl.signal });
    if (!resp.ok) return null;
    const data = await resp.json();
    return (data.elements || []).map((el) => ({
      lat: el.center?.lat ?? el.lat, lng: el.center?.lon ?? el.lon, tags: el.tags || {},
    })).filter((e) => Number.isFinite(e.lat));
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
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
    items[type].push({ x, y: terrain.heightAt(x, z), z, s, ry: rnd() * Math.PI * 2 });
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
        put('broadleaf', x, z, 0.75 + rnd() * 0.9);
      }
    } else if (biome === 'bare') {
      const r = rnd();
      if (r < 0.38) put('silvergrass', x, z, 0.8 + rnd() * 1.0);
      else if (r < 0.60) put('arrowbamboo', x, z, 0.8 + rnd() * 0.8);
      else if (r < 0.82) put('shrub', x, z, 0.7 + rnd() * 0.9);
      else put('succulent', x, z, 0.7 + rnd() * 0.8);
    } else if (biome === 'wet') {
      if (rnd() < 0.45) put('mangrove', x, z, 0.8 + rnd() * 0.7);
      else put('reed', x, z, 0.8 + rnd() * 0.8);
    }
  }
  for (const type in items) {
    for (const m of buildVegMeshes(type, items[type], season)) group.add(m);
  }

  // ---- 建物(市區)----
  onProgress?.(0.42, '讀取 OSM 圖資建物…');
  const wantUrban = (mix ? (mix.urban || 0) > 0.05 : true) || urbanPts.length > 8;
  let osm = null;
  if (wantUrban && terrain.sampleColor) osm = await fetchOsmBuildings(terrain.bbox);

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
    const mat = new THREE.MeshStandardMaterial({
      color: commercial ? 0x5f7382 : 0x9c948a, flatShading: true, roughness: 0.8, metalness: commercial ? 0.3 : 0.05,
      emissive: night ? (commercial ? 0x36434f : 0x2a2418) : 0x000000,
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

  onProgress?.(1, '地貌完成');
  group.userData.stats = {
    veg: placed,
    buildings: generic.length + landmarks.length,
    landmarks: landmarks.length,
    osm: !!(osm && osm.length),
  };
  return group;
}
