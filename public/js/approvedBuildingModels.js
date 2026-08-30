// 已通過零件台的建築型錄；選款、正規化與執行期批次只在此一份。
import * as THREE from 'three';
import { BUILDING_PARTS } from './runtimeParts.js';
import { generateBackgroundObject } from './backgroundObjects.js';
import { mergeRuntimeParts } from './runtimePartModel.js';
import { envMat } from './toon.js';

const geometryCache = new Map();
let sharedMaterial = null;

const hash32 = (x, z, salt = 0) => {
  let h = ((Math.round(x * 10) * 73856093) ^ (Math.round(z * 10) * 19349663) ^ salt) >>> 0;
  h ^= h >>> 16; h = Math.imul(h, 0x7feb352d); h ^= h >>> 15;
  return h >>> 0;
};
const hash01 = (x, z, salt = 0) => hash32(x, z, salt) / 4294967296;

const semanticPenalty = (entry, commercial) => {
  const s = entry.subpart || '';
  const domestic = /adobe|house|rowhouse|stonecottage|yurt/.test(s);
  const civic = /civic|pagoda|lighthouse|windmill/.test(s);
  if (civic) return 0.8;
  if (commercial && domestic) return 0.45;
  if (!commercial && s === 'mass') return 0.22;
  return 0;
};

const isCuboidAssembly = (entry) => {
  const count = entry?.generation?.mainPartCount ?? entry?.parts?.length ?? 0;
  return Array.isArray(entry?.parts) && count > 0
    && entry.parts.slice(0, count).every((part) => part?.type === 'box');
};

const profileOf = (entry) => {
  const size = entry.bounds.size;
  if (isCuboidAssembly(entry)) {
    return { hw: 0.5, hd: 0.5, hy: 0.5, slabs: [[-0.5, 0.5, 0.5, 0.5, 1]] };
  }
  // 非方盒構築先以自然樓高正規化，保留原始長寬高比，實例階段只能等比例縮放。
  const h = Math.max(size[1], 0.001);
  const hw = size[0] / h * 0.5;
  const hd = size[2] / h * 0.5;
  return { hw, hd, hy: 0.5, slabs: [[-0.5, 0.5, hw, hd, 1]] };
};

/**
 * 依足跡比例選出拉伸最少的一列；前六名用座標雜湊輪替，零共享亂數消耗。
 * 回傳的 prof 只描述「正規化後完整包絡」，供既有碰撞盒與招牌縫共用。
 */
export function fitApprovedBuilding(building) {
  if (!BUILDING_PARTS.length) return null;
  const target = Math.max(building.w, 0.001) / Math.max(building.d, 0.001);
  const ranked = [];
  for (const entry of BUILDING_PARTS) {
    const size = entry.bounds?.size;
    if (!Array.isArray(size) || size.some((n) => !Number.isFinite(n) || n <= 0)) continue;
    for (const rot of [0, 1]) {
      const aspect = rot ? size[2] / size[0] : size[0] / size[2];
      const stretch = Math.exp(Math.abs(Math.log(target / aspect)));
      const heightRatio = Math.max(building.h || 10, 0.001) / Math.max(size[1], 0.001);
      const heightStretch = Math.exp(Math.abs(Math.log(heightRatio)));
      // 變形防線：平面拉伸不得超過 1.65x，高度拉伸不得超過 1.8x
      // 杜絕將 4~10m 低矮建築暴力拉伸成 50~100m 摩天大樓導致門窗被縱向拉成細長條
      if (stretch > 1.65 || heightStretch > 1.8) continue;
      ranked.push({ entry, rot, score: Math.log(stretch) + Math.log(heightStretch) * 0.4 + semanticPenalty(entry, !!building.commercial) });
    }
  }
  ranked.sort((a, b) => a.score - b.score
    || (a.entry.key < b.entry.key ? -1 : a.entry.key > b.entry.key ? 1 : 0)
    || a.rot - b.rot);
  if (!ranked.length) return null;
  const pool = ranked.slice(0, Math.min(6, ranked.length));
  const pick = pool[Math.floor(hash01(building.x, building.z, building.commercial ? 17 : 31) * pool.length)];
  const entry = generateBackgroundObject(pick.entry.key,
    hash32(building.x, building.z, building.commercial ? 97 : 113));
  const proportional = !isCuboidAssembly(entry);
  return {
    entry,
    key: entry.key,
    rot: pick.rot,
    proportional,
    prof: profileOf(entry),
  };
}

/** 把模型正規化成 X/Z 中心、Y=0 落地；非方盒模型只按自然樓高正規化以保留比例。 */
export function approvedBuildingGeometry(entry, paletteIndex = null) {
  const cacheKey = paletteIndex != null ? `${entry.key}_pal${paletteIndex}` : entry.key;
  if (geometryCache.has(cacheKey)) return geometryCache.get(cacheKey);
  const geo = mergeRuntimeParts(entry.parts, { entry, paletteIndex });
  const box = geo.boundingBox;
  const size = new THREE.Vector3();
  const center = new THREE.Vector3();
  box.getSize(size);
  box.getCenter(center);
  if (Math.min(size.x, size.y, size.z) <= 0) throw new RangeError(`建築包絡無效:${entry.key}`);
  geo.translate(-center.x, -box.min.y, -center.z);
  if (isCuboidAssembly(entry)) geo.scale(1 / size.x, 1 / size.y, 1 / size.z);
  else geo.scale(1 / size.y, 1 / size.y, 1 / size.y);
  geo.computeBoundingBox();
  geo.computeBoundingSphere();
  geometryCache.set(cacheKey, geo);
  return geo;
}

export function approvedBuildingMaterial() {
  if (!sharedMaterial) sharedMaterial = envMat(0xffffff, { vertexColors: true, wash: 0.42 });
  return sharedMaterial;
}

/** 每款一顆 InstancedMesh（若具備多套 palettes 則依座標雜湊隨機分組批次渲染）；同款跨立面來源先合併 rows 再呼叫。 */
export function makeApprovedBuildingBatch(entry, rows) {
  if (!entry || !Array.isArray(rows) || !rows.length) throw new TypeError('建築批次缺少 entry/rows');
  const numPalettes = Array.isArray(entry.palettes) && entry.palettes.length > 1 ? entry.palettes.length : 1;
  const proportional = !isCuboidAssembly(entry);

  if (numPalettes <= 1) {
    const mesh = new THREE.InstancedMesh(approvedBuildingGeometry(entry), approvedBuildingMaterial(), rows.length);
    const matrix = new THREE.Matrix4();
    const quaternion = new THREE.Quaternion();
    const euler = new THREE.Euler();
    const position = new THREE.Vector3();
    const scale = new THREE.Vector3();
    rows.forEach((row, i) => {
      euler.set(0, row.ry, 0);
      quaternion.setFromEuler(euler);
      position.set(row.x, row.y - row.h / 2, row.z); // 正規化模型由地面起算；既有 row.y 是中心。
      if (proportional) scale.setScalar(row.w); else scale.set(row.w, row.h, row.d);
      matrix.compose(position, quaternion, scale);
      mesh.setMatrixAt(i, matrix);
    });
    mesh.instanceMatrix.needsUpdate = true;
    mesh.frustumCulled = false;
    mesh.name = `approved-building:${entry.key}`;
    mesh.userData.runtimePart = { key: entry.key, version: entry.version, family: 'building' };
    return mesh;
  }

  // 跨多套配色依座標雜湊隨機分組批次渲染
  const groups = new Map();
  for (const row of rows) {
    const palIdx = Math.floor(hash01(row.x, row.z, 79) * numPalettes);
    if (!groups.has(palIdx)) groups.set(palIdx, []);
    groups.get(palIdx).push(row);
  }

  const batchGroup = new THREE.Group();
  batchGroup.name = `approved-building-group:${entry.key}`;
  const matrix = new THREE.Matrix4();
  const quaternion = new THREE.Quaternion();
  const euler = new THREE.Euler();
  const position = new THREE.Vector3();
  const scale = new THREE.Vector3();

  for (const [palIdx, palRows] of groups.entries()) {
    const mesh = new THREE.InstancedMesh(approvedBuildingGeometry(entry, palIdx), approvedBuildingMaterial(), palRows.length);
    palRows.forEach((row, i) => {
      euler.set(0, row.ry, 0);
      quaternion.setFromEuler(euler);
      position.set(row.x, row.y - row.h / 2, row.z);
      if (proportional) scale.setScalar(row.w); else scale.set(row.w, row.h, row.d);
      matrix.compose(position, quaternion, scale);
      mesh.setMatrixAt(i, matrix);
    });
    mesh.instanceMatrix.needsUpdate = true;
    mesh.frustumCulled = false;
    mesh.name = `approved-building:${entry.key}:pal${palIdx}`;
    mesh.userData.runtimePart = { key: entry.key, version: entry.version, family: 'building', paletteIndex: palIdx };
    batchGroup.add(mesh);
  }
  return batchGroup;
}

export const approvedBuildingCount = () => BUILDING_PARTS.length;
