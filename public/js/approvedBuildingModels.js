// 已通過零件台的建築型錄；選款、正規化與執行期批次只在此一份。
import * as THREE from 'three';
import { BUILDING_PARTS } from './runtimeParts.js';
import { generateBackgroundObject, BACKGROUND_VARIANTS_PER_TARGET } from './backgroundObjects.js';
import { mergeRuntimeParts, runtimePartTypes } from './runtimePartModel.js';
import { sceneObjectMat } from './toon.js';
import { deploySceneObjects } from './sceneObjects.js';
import { pickArchitectureModel } from './buildingDiversity.js';
import { ARCHITECTURE_SITE, computeOrientedRoofFrame } from './architectureStyles.js';

const geometryCache = new Map();
const assemblyCache = new Map();
const generatedCache = new Map();
const supportedParts = new Set(runtimePartTypes());
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

/** 解析組成後才選款；不讓非法尺寸、分離主體或空底模型進入隨機池。 */
export function analyzeApprovedBuilding(entry) {
  if (assemblyCache.has(entry.key)) return assemblyCache.get(entry.key);
  const reject = reason => {
    const result = { accepted: false, reason };
    assemblyCache.set(entry.key, result);
    return result;
  };
  const count = entry.generation?.mainPartCount;
  if (!Number.isInteger(count) || count < 1 || count > entry.parts?.length) return reject('missing_structure');
  const boxes = [];
  for (const part of entry.parts) {
    if (!supportedParts.has(part.type)) return reject('unsupported_part');
    if (!Array.isArray(part.position) || part.position.length !== 3 || !part.position.every(Number.isFinite)) return reject('invalid_position');
    for (const key of ['dimensions', 'radii', 'scale']) {
      if (part[key] && (!Array.isArray(part[key]) || !part[key].every(n => Number.isFinite(n) && n > 0))) return reject('invalid_size');
    }
    for (const key of ['radius', 'height']) {
      if (part[key] != null && (!Number.isFinite(part[key]) || part[key] <= 0)) return reject('invalid_size');
    }
    if (part.rotation && (part.rotation.length !== 3 || !part.rotation.every(Number.isFinite))) return reject('invalid_rotation');
    const geo = mergeRuntimeParts([part]);
    boxes.push(geo.boundingBox.clone());
    geo.dispose();
  }
  const main = boxes.slice(0, count);
  const joined = new Set([0]);
  for (let changed = true; changed;) {
    changed = false;
    for (let i = 0; i < main.length; i++) {
      if (joined.has(i)) continue;
      if ([...joined].some(j => main[j].clone().expandByScalar(0.2).intersectsBox(main[i]))) {
        joined.add(i); changed = true;
      }
    }
  }
  if (joined.size !== main.length) return reject('disconnected_structure');
  const bounds = boxes.reduce((box, next) => box.union(next), new THREE.Box3());
  const size = bounds.getSize(new THREE.Vector3());
  const baseY = bounds.min.y + Math.min(0.5, size.y * 0.1);
  // 完整方形底層才可替代矩形外牆；凹翼／塔腳仍保留為固定形狀模型。
  const rectangular = entry.parts.slice(0, count).some((part, i) => part.type === 'box'
    && !(part.rotation || []).some(r => Math.abs(r) > 1e-5)
    && main[i].min.y <= baseY && main[i].max.y > baseY
    && (main[i].max.x - main[i].min.x) / size.x >= 0.9
    && (main[i].max.z - main[i].min.z) / size.z >= 0.9);
  const result = { accepted: true, rectangular, bounds: {
    min: bounds.min.toArray(), max: bounds.max.toArray(), size: size.toArray(),
  } };
  assemblyCache.set(entry.key, result);
  return result;
}

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
 * 足跡與高度先過尺度防線，再依文化語彙與變形代價加權選款，零共享亂數消耗。
 * 回傳的 prof 只描述「正規化後完整包絡」，供既有碰撞盒與招牌縫共用。
 */
export function fitApprovedBuilding(building, architecture = null, seed = 0, options = { rectangular: true }) {
  if (!BUILDING_PARTS.length) return null;
  if (architecture?.proceduralOnly) return null;
  if (![building.w, building.d, building.h].every(n => Number.isFinite(n) && n > 0)) return null;
  if (architecture?.slope >= ARCHITECTURE_SITE.slopeDeg) return null;
  const target = Math.max(building.w, 0.001) / Math.max(building.d, 0.001);
  const ranked = [];
  for (const source of BUILDING_PARTS) {
    const variantSeed = hash32(building.x, building.z, (building.commercial ? 97 : 113) ^ seed);
    const cacheKey = `${source.key}:${variantSeed % BACKGROUND_VARIANTS_PER_TARGET}`;
    if (!generatedCache.has(cacheKey)) generatedCache.set(cacheKey, generateBackgroundObject(source.key, variantSeed));
    const entry = generatedCache.get(cacheKey);
    const assembly = analyzeApprovedBuilding(entry);
    if (!assembly.accepted || (options.rectangular && !assembly.rectangular)) continue;
    entry.bounds = assembly.bounds;
    const size = entry.bounds?.size;
    if (!Array.isArray(size) || size.some((n) => !Number.isFinite(n) || n <= 0)) continue;
    for (const rot of [0, 1]) {
      const aspect = rot ? size[2] / size[0] : size[0] / size[2];
      const stretch = Math.exp(Math.abs(Math.log(target / aspect)));
      const heightRatio = Math.max(building.h || 10, 0.001) / Math.max(size[1], 0.001);
      const heightStretch = Math.exp(Math.abs(Math.log(heightRatio)));
      // 方盒各軸縮放差 ≤35%；固定造型 ≤15%，自然樓高範圍仍限 1.8x。
      // 杜絕將 4~10m 低矮建築暴力拉伸成 50~100m 摩天大樓導致門窗被縱向拉成細長條
      const limit = isCuboidAssembly(entry) ? 1.35 : 1.15;
      const scales = [(rot ? building.d : building.w) / size[0], heightRatio,
        (rot ? building.w : building.d) / size[2]];
      if (stretch > limit || heightStretch > 1.8
        || Math.max(...scales) / Math.min(...scales) > limit) continue;
      ranked.push({ entry, rot, score: Math.log(stretch) + Math.log(heightStretch) * 0.4 + semanticPenalty(entry, !!building.commercial) });
    }
  }
  ranked.sort((a, b) => a.score - b.score
    || (a.entry.key < b.entry.key ? -1 : a.entry.key > b.entry.key ? 1 : 0)
    || a.rot - b.rot);
  if (!ranked.length) return null;
  const pick = architecture
    ? pickArchitectureModel(ranked, architecture, `${seed}:${building.x}:${building.z}`)
    : ranked[Math.floor(hash01(building.x, building.z, building.commercial ? 17 : 31) * ranked.length)];
  const entry = pick.entry;
  const proportional = !isCuboidAssembly(entry);
  return {
    entry,
    key: entry.key,
    rot: pick.rot,
    proportional,
    prof: profileOf(entry),
  };
}

/** 固定模型整棟替換，不疊在程序牆面與屋頂上。 */
export function fitApprovedPolygon(poly, height, architecture, seed = 0) {
  const frame = computeOrientedRoofFrame(poly);
  if (!frame) return null;
  const fit = fitApprovedBuilding({ x: frame.cx, z: frame.cz, w: frame.len, d: frame.span,
    h: height, commercial: architecture.functionInfo?.category === 'commercial' }, architecture, seed, { rectangular: true });
  // Polygon walls/platforms describe the full envelope, so only full cuboid assemblies fit this seam.
  if (!fit || fit.proportional) return null;
  const mainParts = fit.entry.parts.slice(0, fit.entry.generation.mainPartCount);
  if (mainParts.some(part => (part.rotation || []).some(r => Math.abs(r) > 1e-5))) return null;
  const geo = approvedBuildingGeometry(fit.entry, architecture.variant).clone();
  geo.setIndex(Array.from({ length: geo.attributes.position.count }, (_, i) => i));
  geo.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(geo.attributes.position.count * 2), 2));
  const width = fit.rot ? frame.span : frame.len, depth = fit.rot ? frame.len : frame.span;
  const angle = -frame.angle + (fit.rot ? Math.PI / 2 : 0);
  geo.scale(width, height, depth);
  geo.rotateY(angle);
  geo.translate(frame.cx, 0, frame.cz);
  const { min, max, size } = fit.entry.bounds;
  const sx = width / size[0], sy = height / size[1], sz = depth / size[2];
  const ca = Math.cos(angle), sa = Math.sin(angle);
  // 碰撞與可站立頂面由同一份方盒組成資料推導，退台上方不留下隱形牆。
  geo.userData.buildingVolumes = mainParts.map(part => {
    const scale = part.scale || [1, 1, 1];
    const x = (part.position[0] - (min[0] + max[0]) / 2) * sx;
    const z = (part.position[2] - (min[2] + max[2]) / 2) * sz;
    const h = part.dimensions[1] * scale[1] * sy;
    const hw2 = part.dimensions[0] * scale[0] * sx / 2;
    const hd2 = part.dimensions[2] * scale[2] * sz / 2;
    return { x: frame.cx + x * ca + z * sa, z: frame.cz - x * sa + z * ca,
      y: (part.position[1] - min[1]) * sy - h / 2, h, hw2, hd2,
      ry: -angle, r: Math.hypot(hw2, hd2) };
  });
  return geo;
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
  if (!sharedMaterial) sharedMaterial = sceneObjectMat(0xffffff, { vertexColors: true });
  return sharedMaterial;
}

/** 每款一顆 InstancedMesh（若具備多套 palettes 則依座標雜湊隨機分組批次渲染）；同款跨立面來源先合併 rows 再呼叫。 */
export function makeApprovedBuildingBatch(entry, rows) {
  if (!entry || !Array.isArray(rows) || !rows.length) throw new TypeError('建築批次缺少 entry/rows');
  const numPalettes = Math.max(1, entry.palettes?.length || 0);
  const proportional = !isCuboidAssembly(entry);
  const quaternion = new THREE.Quaternion();
  const euler = new THREE.Euler();
  const position = new THREE.Vector3();
  const scale = new THREE.Vector3();
  return deploySceneObjects(rows, {
    variantOf: (row) => numPalettes > 1 ? Math.floor(hash01(row.x, row.z, 79) * numPalettes) : null,
    geometryOf: (variant) => approvedBuildingGeometry(entry, variant),
    material: approvedBuildingMaterial(),
    name: 'approved-building:' + entry.key,
    metadata: { key: entry.key, version: entry.version, family: 'building' },
    matrixOf: (row, matrix) => {
      euler.set(0, row.ry, 0);
      quaternion.setFromEuler(euler);
      position.set(row.x, row.y - row.h / 2, row.z);
      if (proportional) scale.setScalar(row.w); else scale.set(row.w, row.h, row.d);
      matrix.compose(position, quaternion, scale);
    },
  });
}

export const approvedBuildingCount = () => BUILDING_PARTS.length;
