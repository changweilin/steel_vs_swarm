// 已通過零件台的建築型錄；選款、正規化與執行期批次只在此一份。
import * as THREE from 'three';
import { BUILDING_PARTS } from './runtimeParts.js';
import { mergeRuntimeParts } from './runtimePartModel.js';
import { envMat } from './toon.js';

const geometryCache = new Map();
let sharedMaterial = null;

const hash01 = (x, z, salt = 0) => {
  let h = ((Math.round(x * 10) * 73856093) ^ (Math.round(z * 10) * 19349663) ^ salt) >>> 0;
  h ^= h >>> 16; h = Math.imul(h, 0x7feb352d); h ^= h >>> 15;
  return (h >>> 0) / 4294967296;
};

const semanticPenalty = (entry, commercial) => {
  const s = entry.subpart || '';
  const domestic = /adobe|house|rowhouse|stonecottage|yurt/.test(s);
  const civic = /civic|pagoda|lighthouse|windmill/.test(s);
  if (civic) return 0.8;
  if (commercial && domestic) return 0.45;
  if (!commercial && s === 'mass') return 0.22;
  return 0;
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
  return {
    entry: pick.entry,
    key: pick.entry.key,
    rot: pick.rot,
    prof: { hw: 0.5, hd: 0.5, hy: 0.5, slabs: [[-0.5, 0.5, 0.5, 0.5, 1]] },
  };
}

/** 把原始真實尺度模型正規化成 X/Z 中心、Y=0 落地的單位盒。 */
export function approvedBuildingGeometry(entry) {
  if (geometryCache.has(entry.key)) return geometryCache.get(entry.key);
  const geo = mergeRuntimeParts(entry.parts);
  const box = geo.boundingBox;
  const size = new THREE.Vector3();
  const center = new THREE.Vector3();
  box.getSize(size);
  box.getCenter(center);
  if (Math.min(size.x, size.y, size.z) <= 0) throw new RangeError(`建築包絡無效:${entry.key}`);
  geo.translate(-center.x, -box.min.y, -center.z);
  geo.scale(1 / size.x, 1 / size.y, 1 / size.z);
  geo.computeBoundingBox();
  geo.computeBoundingSphere();
  geometryCache.set(entry.key, geo);
  return geo;
}

export function approvedBuildingMaterial() {
  if (!sharedMaterial) sharedMaterial = envMat(0xffffff, { vertexColors: true, wash: 0.42 });
  return sharedMaterial;
}

/** 每款一顆 InstancedMesh；同款跨立面來源先合併 rows 再呼叫。 */
export function makeApprovedBuildingBatch(entry, rows) {
  if (!entry || !Array.isArray(rows) || !rows.length) throw new TypeError('建築批次缺少 entry/rows');
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
    scale.set(row.w, row.h, row.d);
    matrix.compose(position, quaternion, scale);
    mesh.setMatrixAt(i, matrix);
  });
  mesh.instanceMatrix.needsUpdate = true;
  mesh.frustumCulled = false;
  mesh.name = `approved-building:${entry.key}`;
  mesh.userData.runtimePart = { key: entry.key, version: entry.version, family: 'building' };
  return mesh;
}

export const approvedBuildingCount = () => BUILDING_PARTS.length;
