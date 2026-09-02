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

const PATCH = { width: 104, depth: 84, cols: 18, rows: 16 };
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

/** 找出適合展示的平坦乾地；取樣順序固定，不消耗遊戲共享亂數。 */
export function findShowcaseSite(terrain) {
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
      if (terrain.waterY != null && y <= terrain.waterY + 0.5) continue;
      const probe = Math.max(5, Math.min(12, step * 0.45));
      const slope = Math.max(
        Math.abs(terrain.heightAt(x + probe, z) - terrain.heightAt(x - probe, z)),
        Math.abs(terrain.heightAt(x, z + probe) - terrain.heightAt(x, z - probe)),
      ) / (probe * 2);
      const rgb = terrain.sampleColor?.(x, z);
      const green = Array.isArray(rgb) && rgb.length >= 3
        ? Math.max(0, (rgb[1] - (rgb[0] + rgb[2]) * 0.5) / 255)
        : 0;
      const centerBias = Math.hypot((x - cx) / spanX, (z - cz) / spanZ);
      const score = slope * 9 + centerBias * 0.7 - green * 0.22;
      if (!best || score < best.score) best = { x, z, y, slopeDeg: Math.atan(slope) * 180 / Math.PI, score };
    }
  }
  if (best) return best;
  const x = clamp(cx, terrain.minX, terrain.maxX);
  const z = clamp(cz, terrain.minZ, terrain.maxZ);
  return { x, z, y: terrain.heightAt(x, z), slopeDeg: 0 };
}

/** 倫敦圖資下載失敗時的安全備援；保留 heightAt/sampleColor 的同一介面。 */
export function createShowcaseFallbackTerrain() {
  const minX = -76, maxX = 76, minZ = -62, maxZ = 62;
  const heightAt = (x, z) => 0.55 * Math.sin(x * 0.075) + 0.35 * Math.cos(z * 0.09)
    + 0.18 * Math.sin((x + z) * 0.16);
  return {
    minX, maxX, minZ, maxZ, worldW: maxX - minX, worldH: maxZ - minZ,
    center: { lat: 51.560302, lng: 0.084931 },
    heightAt, sampleColor: null, waterY: null, usedFallback: true,
  };
}

function fallbackColor(localY) {
  const t = clamp(0.52 + localY * 0.13, 0, 1);
  const c = new THREE.Color(0x354b42).lerp(new THREE.Color(0x70815c), t);
  return [c.r, c.g, c.b];
}

function mapColor(terrain, x, z, localY) {
  const rgb = terrain.sampleColor?.(x, z);
  if (!Array.isArray(rgb) || rgb.length < 3 || !rgb.every(Number.isFinite)) return fallbackColor(localY);
  const c = new THREE.Color(clamp(rgb[0] / 255, 0, 1), clamp(rgb[1] / 255, 0, 1), clamp(rgb[2] / 255, 0, 1));
  // 圖資色彩保留場所辨識度，但壓成展示台可讀的色階，避免衛星影像蓋掉機體輪廓。
  c.lerp(new THREE.Color(0x30463f), 0.22);
  return [c.r, c.g, c.b];
}

/** 從正式地形取樣一塊小型展示地貌；返回的 localYAt 與網格使用同一份 heightAt。 */
export function buildShowcasePatch(terrain, { site = findShowcaseSite(terrain) } = {}) {
  const source = terrain || createShowcaseFallbackTerrain();
  const safeSite = site || findShowcaseSite(source);
  const baseY = Number.isFinite(safeSite.y) ? safeSite.y : source.heightAt(safeSite.x, safeSite.z);
  const { width, depth, cols, rows } = PATCH;
  const pos = new Float32Array(cols * rows * 3);
  const colors = new Float32Array(cols * rows * 3);
  const localYAt = (x, z) => source.heightAt(safeSite.x + x, safeSite.z + z) - baseY;
  let minY = Infinity, maxY = -Infinity;
  for (let iz = 0; iz < rows; iz++) {
    const z = -depth * 0.5 + depth * iz / (rows - 1);
    for (let ix = 0; ix < cols; ix++) {
      const x = -width * 0.5 + width * ix / (cols - 1);
      const y = localYAt(x, z);
      const k = iz * cols + ix;
      const rgb = mapColor(source, safeSite.x + x, safeSite.z + z, y);
      pos[k * 3] = x; pos[k * 3 + 1] = y; pos[k * 3 + 2] = z;
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
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  geo.setIndex(idx);
  geo.computeVertexNormals();
  const mesh = new THREE.Mesh(geo, envMat(0xffffff, {
    vertexColors: true, bands: 4, wash: 0, cool: 0, rim: 0, land: true,
  }));
  mesh.receiveShadow = true;
  mesh.userData.showcaseTerrain = true;
  const group = new THREE.Group();
  group.add(mesh);
  return { group, site: safeSite, baseY, minY, maxY, localYAt, source };
}
