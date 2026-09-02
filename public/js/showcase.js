// ============ 倫敦圖資地形展示場景 ============
// 展示台只讀正式地形的 heightAt / sampleColor，機體仍由 makeUnit() 產生。
// 網路圖資尚未完成或來源失效時，先用同一個高度場介面顯示小型備援地貌。
import * as THREE from 'three';
import { envMat } from './hazards.js';

export const LONDON_SHOWCASE_UNITS = [
  { id: 's03', side: 'SWARM', label: '利維坦', note: '長耳可變訊號機', tint: 0x8ce7d8, hover: 0.10 },
  { id: 't03', side: 'STEEL', label: '猩猩', note: '掌行突擊機甲', tint: 0x83b8ff, hover: 0.02 },
  { id: 'm04', side: 'MERC', label: '獵鷹', note: '鷹式偵獵機', tint: 0xe7c875, hover: 1.55 },
];

// 五個展示各自取倫敦的真實地貌帶；座標只用來取圖資，不改戰場 VENUES。
export const LONDON_SHOWCASE_SITES = Object.freeze([
  { id: 'mech', area: '史特拉福／奧林匹克公園', center: [51.5446, -0.0102], sizeM: 1800, terrain: 'urban', water: false, mix: { urban: 0.68, green: 0.32 } },
  { id: 'shore', area: '格林威治半島／泰晤士潮間帶', center: [51.4882, 0.0061], sizeM: 1800, terrain: 'shore', water: 'shore', mix: { urban: 0.35, green: 0.15, water: 0.50 } },
  { id: 'swamp', area: 'Rainham Marshes／倫敦東部濕地', center: [51.5074, 0.2038], sizeM: 1800, terrain: 'swamp', water: 'swamp', mix: { wet: 0.58, water: 0.28, green: 0.14 } },
  { id: 'tree', area: '埃平森林／High Beach', center: [51.6543, 0.0618], sizeM: 1800, terrain: 'forest', water: false, mix: { green: 0.88, urban: 0.04, bare: 0.08 } },
  { id: 'biome', area: '漢普斯特德荒野／Hampstead Heath', center: [51.5607, -0.1782], sizeM: 1800, terrain: 'heath', water: false, mix: { green: 0.62, bare: 0.28, urban: 0.10 } },
]);

/** 建立只供設定頁取樣的場地設定；不註冊成可玩的 VENUE。 */
export function showcaseTerrainConfig(site) {
  const [lat, lng] = site.center;
  const anchor = [lat, lng];
  return {
    center: { lat, lng, rot: 0 },
    bases: { SWARM: anchor, STEEL: anchor },
    lanes: [],
    sizeM: site.sizeM,
    venue: { id: `london-showcase-${site.id}`, name: site.area, country: '🇬🇧', mix: site.mix },
  };
}

const PATCH = { width: 136, depth: 108, cols: 33, rows: 27 };
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

function slopeAt(terrain, x, z) {
  const probe = 8;
  const dx = Math.abs(terrain.heightAt(x + probe, z) - terrain.heightAt(x - probe, z)) / (probe * 2);
  const dz = Math.abs(terrain.heightAt(x, z + probe) - terrain.heightAt(x, z - probe)) / (probe * 2);
  return Math.atan(Math.max(dx, dz)) * 180 / Math.PI;
}

/** 五個專屬場地都以各自圖資框的中心取樣，避免掃回同一塊平坦地。 */
export function showcaseAnchorSite(terrain) {
  if (!terrain?.heightAt) return { x: 0, z: 0, y: 0, slopeDeg: 0, score: 0 };
  const x = clamp(0, terrain.minX, terrain.maxX);
  const z = clamp(0, terrain.minZ, terrain.maxZ);
  return { x, z, y: terrain.heightAt(x, z), slopeDeg: slopeAt(terrain, x, z), score: 0 };
}

/** 依展示類型找出地貌位置；取樣順序固定，不消耗遊戲共享亂數。 */
export function findShowcaseSite(terrain, mode = 'flat') {
  if (!terrain?.heightAt) return { x: 0, z: 0, y: 0, slopeDeg: 0 };
  const spanX = Math.max(1, terrain.maxX - terrain.minX);
  const spanZ = Math.max(1, terrain.maxZ - terrain.minZ);
  const halfW = Math.min(PATCH.width * 0.5 + 4, spanX * 0.42);
  const halfD = Math.min(PATCH.depth * 0.5 + 4, spanZ * 0.42);
  const minX = terrain.minX + halfW, maxX = terrain.maxX - halfW;
  const minZ = terrain.minZ + halfD, maxZ = terrain.maxZ - halfD;
  const step = Math.max(12, Math.min(28, Math.min(spanX, spanZ) / 12));
  const cx = (terrain.minX + terrain.maxX) * 0.5;
  const cz = (terrain.minZ + terrain.maxZ) * 0.5;
  let best = null;
  for (let z = minZ; z <= maxZ + 0.001; z += step) {
    for (let x = minX; x <= maxX + 0.001; x += step) {
      const y = terrain.heightAt(x, z);
      if (!Number.isFinite(y)) continue;
      if (mode !== 'wet' && terrain.waterY != null && y <= terrain.waterY + 0.5) continue;
      const slope = Math.tan(slopeAt(terrain, x, z) * Math.PI / 180);
      const reliefProbe = Math.max(18, Math.min(42, step * 0.8));
      const relief = Math.max(
        terrain.heightAt(x + reliefProbe, z), terrain.heightAt(x - reliefProbe, z),
        terrain.heightAt(x, z + reliefProbe), terrain.heightAt(x, z - reliefProbe),
      ) - Math.min(
        terrain.heightAt(x + reliefProbe, z), terrain.heightAt(x - reliefProbe, z),
        terrain.heightAt(x, z + reliefProbe), terrain.heightAt(x, z - reliefProbe),
      );
      const rgb = terrain.sampleColor?.(x, z);
      const green = Array.isArray(rgb) && rgb.length >= 3
        ? Math.max(0, (rgb[1] - (rgb[0] + rgb[2]) * 0.5) / 255)
        : 0;
      const centerBias = Math.hypot((x - cx) / spanX, (z - cz) / spanZ);
      let score;
      if (mode === 'relief') score = -slope * 14 - relief * 0.18 + centerBias * 0.18;
      else if (mode === 'wet') score = slope * 4 + Math.abs(y - (terrain.waterY ?? terrain.minH)) * 0.12 + centerBias * 0.2;
      else if (mode === 'green') score = slope * 7 + centerBias * 0.35 - green * 0.8;
      else score = slope * 9 + centerBias * 0.7 - green * 0.22;
      if (!best || score < best.score) best = { x, z, y, slopeDeg: Math.atan(slope) * 180 / Math.PI, score };
    }
  }
  if (best) return best;
  const x = clamp(cx, terrain.minX, terrain.maxX);
  const z = clamp(cz, terrain.minZ, terrain.maxZ);
  return { x, z, y: terrain.heightAt(x, z), slopeDeg: 0 };
}

const FALLBACKS = {
  mech: {
    waterY: null,
    heightAt: (x, z) => 0.42 * Math.sin(x * 0.028) + 0.22 * Math.cos(z * 0.04) + 0.12 * Math.sin((x + z) * 0.06),
    color: (x, z) => [92 + Math.sin(x * 0.04) * 12, 112 + Math.cos(z * 0.05) * 10, 82],
  },
  shore: {
    waterY: 0,
    heightAt: (x, z) => 0.34 + 0.50 * Math.tanh(-x / 15) + 0.08 * Math.sin(z * 0.05),
    color: (x, z) => x < 0 ? [194 + Math.sin(z * 0.08) * 10, 174, 126] : [30, 86 + Math.cos(z * 0.04) * 8, 106],
  },
  swamp: {
    waterY: 0.18,
    heightAt: (x, z) => 0.13 + 0.14 * Math.sin(x * 0.035) + 0.11 * Math.cos(z * 0.045) + 0.06 * Math.sin((x - z) * 0.08),
    color: (x, z) => [48 + Math.sin(x * 0.04) * 7, 78 + Math.cos(z * 0.05) * 9, 48],
  },
  tree: {
    waterY: null,
    heightAt: (x, z) => 0.65 * Math.sin(x * 0.025) + 0.40 * Math.cos(z * 0.035) + 0.16 * Math.sin((x - z) * 0.055),
    color: (x, z) => [48, 102 + Math.sin(x * 0.04) * 12, 48 + Math.cos(z * 0.05) * 8],
  },
  biome: {
    waterY: null,
    heightAt: (x, z) => 0.035 * x + 0.42 * Math.sin(z * 0.035) + 0.20 * Math.cos(x * 0.045),
    color: (x, z) => x < 0 ? [70, 116 + Math.cos(z * 0.05) * 8, 58] : [142 + Math.sin(z * 0.04) * 12, 116, 72],
  },
};

/** 倫敦圖資下載失敗時的安全備援；每個展示仍保留自己的地貌輪廓。 */
export function createShowcaseFallbackTerrain(sceneId = 'mech') {
  const site = LONDON_SHOWCASE_SITES.find((item) => item.id === sceneId) || LONDON_SHOWCASE_SITES[0];
  const profile = FALLBACKS[sceneId] || FALLBACKS.mech;
  const minX = -900, maxX = 900, minZ = -900, maxZ = 900;
  const heightAt = profile.heightAt;
  return {
    minX, maxX, minZ, maxZ, worldW: maxX - minX, worldH: maxZ - minZ,
    center: { lat: site.center[0], lng: site.center[1], rot: 0 },
    heightAt, sampleColor: profile.color, waterY: profile.waterY, usedFallback: true,
    showcaseId: sceneId,
  };
}

function fallbackColor(x, z, localY, style) {
  const wave = 0.94 + 0.08 * Math.sin(x * 0.11 + z * 0.07) + 0.05 * Math.cos(z * 0.17);
  const height = clamp(1.0 + localY * 0.05, 0.78, 1.2);
  const base = {
    urban: 0x536653,
    shore: x < 0 ? 0xc2a76f : 0x3b7180,
    swamp: 0x54724c,
    forest: 0x477044,
    heath: x < 0 ? 0x5d844d : 0x92784d,
  }[style] || 0x536653;
  const c = new THREE.Color(base).multiplyScalar(clamp(wave * height, 0.72, 1.24));
  return [c.r, c.g, c.b];
}

function mapOverlayColor(x, z, localY, style) {
  const tint = {
    urban: 0x617766,
    shore: x < 0 ? 0xe2c895 : 0x73a8b1,
    swamp: 0x769463,
    forest: 0x6d9b5e,
    heath: x < 0 ? 0x83a867 : 0xb39a6d,
  }[style] || 0x617766;
  const c = new THREE.Color(0xffffff).lerp(new THREE.Color(tint), style === 'urban' ? 0.16 : 0.22);
  c.multiplyScalar(clamp(0.96 + localY * 0.04 + Math.sin(x * 0.08 + z * 0.06) * 0.035, 0.82, 1.12));
  return [c.r, c.g, c.b];
}

function mapColor(terrain, x, z, localY, style = 'urban') {
  const rgb = terrain.sampleColor?.(x, z);
  if (!Array.isArray(rgb) || rgb.length < 3 || !rgb.every(Number.isFinite)) return fallbackColor(x, z, localY, style);
  const c = new THREE.Color(clamp(rgb[0] / 255, 0, 1), clamp(rgb[1] / 255, 0, 1), clamp(rgb[2] / 255, 0, 1));
  const tint = {
    urban: 0x49624a,
    shore: x < 0 ? 0xb69a69 : 0x2b6c82,
    swamp: 0x466a3b,
    forest: 0x2f6c35,
    heath: x < 0 ? 0x4f7a43 : 0x9a8054,
  }[style] || 0x49624a;
  // 圖資色彩保留場所辨識度，再疊一層地貌色帶，讓倫敦低對比衛星影像仍讀得出地表類型。
  c.lerp(new THREE.Color(tint), style === 'urban' ? 0.32 : 0.52);
  const relief = clamp(0.96 + localY * 0.045, 0.78, 1.16);
  c.multiplyScalar(relief);
  return [c.r, c.g, c.b];
}

/** 在同一份高度場上鋪低伏地貌紋理；只是視覺標記，不建立碰撞平台。 */
function drapedRibbon(points, width, yAt, material) {
  const pos = new Float32Array(points.length * 2 * 3);
  for (let i = 0; i < points.length; i++) {
    const [x, z] = points[i];
    const prev = points[Math.max(0, i - 1)], next = points[Math.min(points.length - 1, i + 1)];
    const dx = next[0] - prev[0], dz = next[1] - prev[1];
    const len = Math.max(1e-3, Math.hypot(dx, dz));
    const nx = -dz / len * width * 0.5, nz = dx / len * width * 0.5;
    const y1 = yAt(x + nx, z + nz) + 0.035, y2 = yAt(x - nx, z - nz) + 0.035;
    const k = i * 6;
    pos[k] = x + nx; pos[k + 1] = y1; pos[k + 2] = z + nz;
    pos[k + 3] = x - nx; pos[k + 4] = y2; pos[k + 5] = z - nz;
  }
  const idx = [];
  for (let i = 0; i < points.length - 1; i++) {
    const a = i * 2, b = a + 1, c = a + 2, d = a + 3;
    idx.push(a, c, b, b, c, d);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setIndex(idx);
  geo.computeVertexNormals();
  return new THREE.Mesh(geo, material);
}

function drapedDisc(x, z, radius, yAt, material, segments = 18) {
  const pos = new Float32Array((segments + 1) * 3);
  pos[1] = yAt(x, z) + 0.07;
  for (let i = 0; i < segments; i++) {
    const a = i / segments * Math.PI * 2;
    const k = (i + 1) * 3;
    pos[k] = x + Math.cos(a) * radius;
    pos[k + 1] = yAt(pos[k], z + Math.sin(a) * radius) + 0.07;
    pos[k + 2] = z + Math.sin(a) * radius;
  }
  const idx = [];
  for (let i = 0; i < segments; i++) idx.push(0, i + 1, (i + 1) % segments + 1);
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setIndex(idx);
  geo.computeVertexNormals();
  return new THREE.Mesh(geo, material);
}

function dressingBlock(group, x, z, w, d, h, yAt, material, rotation = 0) {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), material);
  mesh.position.set(x, yAt(x, z) + h * 0.5 + 0.08, z);
  mesh.rotation.y = rotation;
  group.add(mesh);
}

function dressingTree(group, x, z, scale, yAt, trunkM, leafM) {
  const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.16 * scale, 0.25 * scale, 2.0 * scale, 7), trunkM);
  trunk.position.set(x, yAt(x, z) + scale, z);
  const crown = new THREE.Mesh(new THREE.ConeGeometry(1.35 * scale, 2.8 * scale, 8), leafM);
  crown.position.set(x, yAt(x, z) + 2.65 * scale, z);
  group.add(trunk, crown);
}

function dressingMound(group, x, z, radius, height, yAt, material) {
  const mound = new THREE.Mesh(new THREE.ConeGeometry(radius, height, 8), material);
  mound.position.set(x, yAt(x, z) + height * 0.5 + 0.08, z);
  group.add(mound);
}

function addTerrainDressing(group, style, yAt) {
  const mat = (color, opts = {}) => envMat(color, {
    wash: 0.18, cool: 0.12, rim: 0, land: true, ...opts,
  });
  if (style === 'urban') {
    const road = mat(0x697578, { wash: 0.08, cool: 0.08 });
    const curb = mat(0xb0b5a6, { wash: 0.05, cool: 0.04 });
    const park = mat(0x6b895c, { wash: 0.25, cool: 0.1 });
    group.add(
      drapedRibbon([[-68, -38], [-38, -28], [-4, -32], [30, -18], [68, -22]], 8.5, yAt, road),
      drapedRibbon([[-48, -54], [-30, -25], [-8, 2], [8, 30], [30, 54]], 5.2, yAt, road),
      drapedRibbon([[-68, 13], [-34, 10], [0, 18], [34, 15], [68, 30]], 4.2, yAt, road),
      drapedRibbon([[-68, 43], [-34, 39], [4, 45], [38, 40], [68, 46]], 13, yAt, park),
      drapedRibbon([[-68, -33], [-38, -23], [-4, -27], [30, -13], [68, -17]], 0.85, yAt, curb),
    );
    const building = mat(0x879092, { wash: 0.08, cool: 0.04 });
    dressingBlock(group, -22, -18, 8, 5, 2.2, yAt, building, -0.16);
    dressingBlock(group, -9, -21, 6, 4, 1.7, yAt, building, 0.08);
    dressingBlock(group, 17, -20, 9, 5, 3.0, yAt, building, 0.12);
    dressingBlock(group, 29, -13, 6, 4, 2.0, yAt, building, -0.1);
    return;
  }
  if (style === 'shore') {
    const sand = mat(0xd0b57b, { wash: 0.12, cool: 0.04 });
    const wet = mat(0x5c8990, { wash: 0.08, cool: 0.08 });
    const foam = mat(0xe7efe4, { wash: 0.04, cool: 0.02 });
    const timber = mat(0x795f42, { wash: 0.12, cool: 0.02 });
    const shore = [[0, -54], [-2, -32], [1, -8], [-1, 17], [2, 54]];
    group.add(
      drapedRibbon(shore, 19, yAt, sand),
      drapedRibbon(shore, 5.2, yAt, wet),
      drapedRibbon(shore, 1.15, yAt, foam),
      drapedRibbon([[26, -54], [23, -30], [27, -4], [22, 24], [25, 54]], 3.4, yAt, timber),
      drapedRibbon([[46, -54], [43, -24], [47, 8], [44, 36], [47, 54]], 2.0, yAt, timber),
    );
    for (const [x, z] of [[12, -18], [14, -4], [13, 12], [24, -13], [24, 15]]) {
      dressingBlock(group, x, z, 0.65, 0.65, 2.6, yAt, timber);
    }
    return;
  }
  if (style === 'swamp') {
    const channel = mat(0x315c55, { wash: 0.05, cool: 0.18 });
    const mud = mat(0x6f8150, { wash: 0.2, cool: 0.04 });
    const reedM = mat(0x718e47, { wash: 0.08, cool: 0.02 });
    group.add(
      drapedRibbon([[-22, -54], [-10, -31], [-20, -6], [-7, 20], [-18, 54]], 11, yAt, channel),
      drapedRibbon([[26, -54], [15, -28], [29, -2], [17, 27], [31, 54]], 8, yAt, channel),
      drapedRibbon([[-68, 40], [-38, 30], [-8, 36], [24, 29], [68, 39]], 4.2, yAt, mud),
      drapedRibbon([[-68, -39], [-39, -28], [-7, -37], [24, -29], [68, -40]], 3.0, yAt, mud),
      drapedDisc(-6, 4, 6.5, yAt, channel),
      drapedDisc(34, -10, 5.0, yAt, channel),
    );
    const reedGeo = new THREE.CylinderGeometry(0.06, 0.11, 2.8, 5);
    for (let i = 0; i < 12; i++) {
      const x = -25 + (i % 4) * 5.2 + (i % 2) * 1.4;
      const z = -18 + Math.floor(i / 4) * 15 + (i % 3) * 2;
      const reed = new THREE.Mesh(reedGeo, reedM);
      reed.position.set(x, yAt(x, z) + 1.4, z);
      reed.rotation.z = (i % 2 ? -1 : 1) * 0.12;
      group.add(reed);
    }
    return;
  }
  if (style === 'forest') {
    const trail = mat(0x795d3f, { wash: 0.1, cool: 0.02 });
    const leaf = mat(0x477c42, { wash: 0.35, cool: 0.08 });
    const trunk = mat(0x5d4531, { wash: 0.12, cool: 0.02 });
    group.add(
      drapedRibbon([[-68, 35], [-34, 16], [2, 3], [38, -16], [68, -36]], 5.5, yAt, trail),
      drapedRibbon([[-68, -34], [-38, -21], [-8, -25], [26, -14], [68, -24]], 2.0, yAt, trail),
    );
    for (const [x, z, scale] of [[-13, -15, 1.1], [-7, -7, 0.9], [10, -13, 1.3], [15, -2, 0.95], [-14, 7, 1.0], [9, 10, 1.2], [18, 16, 0.9]]) {
      dressingTree(group, x, z, scale, yAt, trunk, leaf);
    }
    return;
  }
  if (style === 'heath') {
    const heath = mat(0x708957, { wash: 0.22, cool: 0.06 });
    const heather = mat(0x806b4e, { wash: 0.12, cool: 0.02 });
    const contour = mat(0xa09465, { wash: 0.1, cool: 0.02 });
    group.add(
      drapedRibbon([[-68, 20], [-35, 27], [-2, 9], [34, 12], [68, -3]], 11, yAt, heath),
      drapedRibbon([[-58, -34], [-18, -18], [22, -28], [68, -20]], 7, yAt, heather),
      drapedRibbon([[-68, 8], [-36, 14], [0, -4], [36, 0], [68, -14]], 1.3, yAt, contour),
      drapedRibbon([[-68, 32], [-36, 39], [0, 24], [36, 27], [68, 13]], 1.0, yAt, contour),
    );
    for (const [x, z, r] of [[-18, -15, 1.4], [-7, -11, 1.1], [10, -16, 1.35], [18, -5, 1.0], [-16, 9, 1.25], [11, 13, 1.1]]) {
      dressingMound(group, x, z, r, r * 0.9, yAt, heather);
    }
  }
}

/** 從正式地形取樣一塊小型展示地貌；返回的 localYAt 與網格使用同一份 heightAt。 */
export function buildShowcasePatch(terrain, { site = showcaseAnchorSite(terrain), style = 'urban', water = false } = {}) {
  const source = terrain || createShowcaseFallbackTerrain();
  const safeSite = site || findShowcaseSite(source);
  const baseY = Number.isFinite(safeSite.y) ? safeSite.y : source.heightAt(safeSite.x, safeSite.z);
  const { width, depth, cols, rows } = PATCH;
  const pos = new Float32Array(cols * rows * 3);
  const uv = new Float32Array(cols * rows * 2);
  const colors = new Float32Array(cols * rows * 3);
  const sourceMap = source.mesh?.material?.map || null;
  const localYAt = (x, z) => source.heightAt(safeSite.x + x, safeSite.z + z) - baseY;
  let minY = Infinity, maxY = -Infinity;
  for (let iz = 0; iz < rows; iz++) {
    const z = -depth * 0.5 + depth * iz / (rows - 1);
    for (let ix = 0; ix < cols; ix++) {
      const x = -width * 0.5 + width * ix / (cols - 1);
      const y = localYAt(x, z);
      const k = iz * cols + ix;
      const rgb = sourceMap
        ? mapOverlayColor(x, z, y, style)
        : mapColor(source, safeSite.x + x, safeSite.z + z, y, style);
      pos[k * 3] = x; pos[k * 3 + 1] = y; pos[k * 3 + 2] = z;
      uv[k * 2] = clamp((safeSite.x + x - source.minX) / Math.max(1, source.maxX - source.minX), 0, 1);
      uv[k * 2 + 1] = 1 - clamp((safeSite.z + z - source.minZ) / Math.max(1, source.maxZ - source.minZ), 0, 1);
      colors[k * 3] = rgb[0]; colors[k * 3 + 1] = rgb[1]; colors[k * 3 + 2] = rgb[2];
      minY = Math.min(minY, y); maxY = Math.max(maxY, y);
    }
  }
  const idx = [];
  for (let iz = 0; iz < rows - 1; iz++) for (let ix = 0; ix < cols - 1; ix++) {
    const a = iz * cols + ix, b = a + 1, c = a + cols, d = c + 1;
    idx.push(a, c, b, b, c, d);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  geo.setIndex(idx);
  geo.computeVertexNormals();
  const mesh = new THREE.Mesh(geo, envMat(0xffffff, {
    ...(sourceMap ? { map: sourceMap } : {}),
    vertexColors: true, bands: 4, wash: 0, cool: 0, rim: 0, land: true,
  }));
  mesh.receiveShadow = true;
  mesh.userData.showcaseTerrain = true;
  const group = new THREE.Group();
  group.add(mesh);
  addTerrainDressing(group, style, localYAt);
  let waterY = null;
  if (water) {
    const waterWidth = water === 'shore' ? width * 0.52 : water === 'swamp' ? width * 0.46 : width;
    const waterGeo = new THREE.PlaneGeometry(waterWidth, depth, 16, 12);
    const waterMesh = new THREE.Mesh(waterGeo, envMat(water === 'swamp' ? 0x244f3b : 0x2b6b83, {
      bands: 'soft', rim: 0, transparent: true, opacity: 0.82, side: THREE.DoubleSide,
    }));
    // 真實水面優先；個別潮間帶圖框若沒有回傳 waterY，退到地形低位分位數，仍保留實景坡面。
    const level = Number.isFinite(source.waterY)
      ? source.waterY
      : baseY + minY + (maxY - minY) * (water === 'swamp' ? 0.56 : 0.38);
    waterMesh.rotation.x = -Math.PI / 2;
    waterMesh.position.set(
      water === 'shore' ? width * 0.25 : water === 'swamp' ? width * 0.16 : 0,
      level - baseY,
      0,
    );
    waterMesh.renderOrder = -1;
    waterMesh.userData.showcaseWater = true;
    group.add(waterMesh);
    waterY = waterMesh.position.y;
  }
  return { group, site: safeSite, baseY, minY, maxY, localYAt, waterY, source };
}
