// 零件台宣告式零件 → 遊戲執行期幾何的唯一轉接縫。
// 每個通過物件合併成一顆 vertex-color mesh；碰撞與場景配置不得反讀此視覺幾何。
import * as THREE from 'three';
import { envMat, toonMat } from './toon.js';

const TYPES = new Set([
  'box', 'cone', 'conical_frustum', 'cylinder', 'dodecahedron_polyhedron',
  'ellipsoid_sphere', 'frustum_pyramid', 'hemisphere_dome',
  'icosahedron_polyhedron', 'polygonal_prism', 'pyramid', 'torus_ring', 'wedge',
]);

const finite = (v) => Number.isFinite(v);
const pos3 = (v, fallback = 0) => Array.isArray(v) && v.length === 3
  ? v.map((n) => finite(n) ? n : fallback)
  : [fallback, fallback, fallback];
const radiusPair = (p, fallback = 1) => {
  if (Array.isArray(p.radii) && p.radii.length >= 2) {
    return [Math.max(0.001, p.radii[0]), Math.max(0.001, p.radii[1])];
  }
  const r = Array.isArray(p.radius) ? p.radius : [p.radius, p.radius];
  return [Math.max(0.001, r[0] || fallback), Math.max(0.001, r[1] || fallback)];
};

function validMeshArray(value, length, integer = false) {
  return Array.isArray(value) && value.length === length
    && value.every((n) => Number.isFinite(n) && (!integer || Number.isInteger(n)));
}

function partColor(part, palette) {
  let value = part?.color;
  if (palette && part?.colorKey) {
    const key = part.colorKey;
    if (palette[key + 'Hex'] !== undefined) value = palette[key + 'Hex'];
    else if (palette[key] !== undefined) value = palette[key];
  }
  return Number.isInteger(value) ? value : 0x888888;
}

/**
 * 舊 model.json 沒有顏色頂點屬性時，依生成器寫入的零件/面順序補回顏色。
 * 面與零件皆由同一份 meshData 產生，這裡只做資料補全，不重建幾何。
 */
function deriveMeshColors(meshData, parts, palette) {
  const vertexCount = Math.floor((meshData?.vertices?.length || 0) / 3);
  const colors = new Float32Array(vertexCount * 3);
  let faceCursor = 0;
  for (const part of Array.isArray(parts) ? parts : []) {
    const triangleCount = Number.isInteger(part?.triangles) ? part.triangles : 0;
    const end = Math.min(meshData.faces.length, faceCursor + triangleCount * 3);
    const touched = new Set();
    for (let i = faceCursor; i < end; i++) {
      const index = meshData.faces[i];
      if (Number.isInteger(index) && index >= 0 && index < vertexCount) touched.add(index);
    }
    const color = new THREE.Color(partColor(part, palette));
    for (const index of touched) {
      colors[index * 3] = color.r;
      colors[index * 3 + 1] = color.g;
      colors[index * 3 + 2] = color.b;
    }
    faceCursor = end;
  }
  return colors;
}

/** 建立已烘焙的 v6 meshData；預覽、零件台與遊戲端共用同一組頂點與面。 */
export function runtimeMeshDataGeometry(meshData, parts = [], palette = null) {
  const vertices = meshData?.vertices;
  const faces = meshData?.faces;
  if (!Array.isArray(vertices) || vertices.length < 9 || vertices.length % 3 !== 0
    || !Array.isArray(faces) || faces.length < 3 || faces.length % 3 !== 0
    || !faces.every((n) => Number.isInteger(n) && n >= 0 && n < vertices.length / 3)) return null;

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
  if (validMeshArray(meshData.normals, vertices.length)) {
    geo.setAttribute('normal', new THREE.Float32BufferAttribute(meshData.normals, 3));
  } else {
    geo.computeVertexNormals();
  }
  if (validMeshArray(meshData.uvs, (vertices.length / 3) * 2)) {
    geo.setAttribute('uv', new THREE.Float32BufferAttribute(meshData.uvs, 2));
  }
  const colors = validMeshArray(meshData.colors, vertices.length)
    ? meshData.colors
    : deriveMeshColors(meshData, parts, palette);
  geo.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  geo.setIndex(faces);
  geo.computeBoundingBox();
  geo.computeBoundingSphere();
  return geo;
}

function wedgeGeometry(dimensions) {
  const [w, h, d] = pos3(dimensions, 1).map((n) => Math.max(0.001, n));
  const hw = w / 2, hh = h / 2, hd = d / 2;
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute([
    -hw, -hh, -hd, hw, -hh, -hd, hw, -hh, hd, -hw, -hh, hd,
    -hw, hh, -hd, hw, hh, -hd,
  ], 3));
  geo.setIndex([
    0, 1, 2, 0, 2, 3,
    0, 5, 1, 0, 4, 5,
    2, 4, 3, 2, 5, 4,
    0, 3, 4, 1, 5, 2,
  ]);
  geo.computeVertexNormals();
  return geo;
}

/** 建立單一零件幾何；未知型別直接拋錯，禁止靜默退回方盒。 */
export function runtimePrimitiveGeometry(part) {
  if (!part || !TYPES.has(part.type)) throw new TypeError(`未知零件型別:${part?.type || 'null'}`);
  const sides = Math.max(3, Math.min(24, part.sides | 0 || 8));
  const h = Math.max(0.001, finite(part.height) ? part.height : 1);
  let geo;
  switch (part.type) {
    case 'box': geo = new THREE.BoxGeometry(...pos3(part.dimensions, 1).map((n) => Math.max(0.001, n))); break;
    case 'polygonal_prism': {
      const r = Math.max(0.001, finite(part.radius) ? part.radius : 1);
      geo = new THREE.CylinderGeometry(r, r, h, sides); break;
    }
    case 'frustum_pyramid':
    case 'conical_frustum':
    case 'cylinder': {
      const [top, bottom] = radiusPair(part);
      geo = new THREE.CylinderGeometry(top, bottom, h, sides); break;
    }
    case 'pyramid':
    case 'cone': {
      const [, bottom] = radiusPair(part);
      geo = new THREE.ConeGeometry(bottom, h, sides); break;
    }
    case 'hemisphere_dome': {
      const [rx, ry, rz] = pos3(part.radii, 1).map((n) => Math.max(0.001, n));
      geo = new THREE.SphereGeometry(1, 16, 10, 0, Math.PI * 2, 0, Math.PI / 2);
      geo.scale(rx, ry, rz); break;
    }
    case 'ellipsoid_sphere': {
      const [rx, ry, rz] = pos3(part.radii, 1).map((n) => Math.max(0.001, n));
      geo = new THREE.SphereGeometry(1, 14, 9);
      geo.scale(rx, ry, rz); break;
    }
    case 'torus_ring': {
      const r = Math.max(0.001, finite(part.radius) ? part.radius : 1);
      const tube = Math.max(0.001, finite(part.tube) ? part.tube : r * 0.2);
      geo = new THREE.TorusGeometry(r, tube, 8, 18); break;
    }
    case 'dodecahedron_polyhedron':
      geo = new THREE.DodecahedronGeometry(Math.max(0.001, part.radius || 1)); break;
    case 'icosahedron_polyhedron':
      geo = new THREE.IcosahedronGeometry(Math.max(0.001, part.radius || 1)); break;
    case 'wedge': geo = wedgeGeometry(part.dimensions); break;
    default: throw new TypeError(`未實作零件型別:${part.type}`);
  }
  return geo;
}

export function resolvePalette(entry, options = {}) {
  if (options?.palette && typeof options.palette === 'object') return options.palette;
  const palettes = entry?.palettes || [];
  if (!palettes.length) return null;
  if (Number.isInteger(options?.paletteIndex) && options.paletteIndex >= 0 && options.paletteIndex < palettes.length) {
    const p = palettes[options.paletteIndex];
    return p?.colors || p;
  }
  if (Number.isFinite(options?.seed)) {
    const idx = Math.abs(Math.floor(options.seed)) % palettes.length;
    const p = palettes[idx];
    return p?.colors || p;
  }
  const first = palettes[0];
  return first?.colors || first;
}

/**
 * 把異質 primitive 烤成一顆非索引幾何；顏色寫進逐頂點屬性，材質維持單一。
 * 支援透過 options.palette / options.paletteIndex / options.seed 動態套用配色清單。
 * @param {Array<object>} parts 零件台輸出的 parts 陣列
 * @param {object} [options] 配色與母體設定
 */
export function mergeRuntimeParts(parts, options = {}) {
  if (!Array.isArray(parts) || !parts.length) throw new TypeError('執行期模型缺少 parts');
  const palette = options?.palette || (options?.entry ? resolvePalette(options.entry, options) : null);
  const positions = [], normals = [], colors = [];
  const matrix = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const e = new THREE.Euler();
  const p = new THREE.Vector3();
  const s = new THREE.Vector3();
  const color = new THREE.Color();

  for (const part of parts) {
    const source = runtimePrimitiveGeometry(part);
    const geo = source.index ? source.toNonIndexed() : source.clone();
    source.dispose();
    const [rx, ry, rz] = pos3(part.rotation);
    const [px, py, pz] = pos3(part.position);
    e.set(rx, ry, rz, 'XYZ');
    q.setFromEuler(e);
    p.set(px, py, pz);
    s.fromArray(pos3(part.scale, 1).map((value) => Math.max(0.001, Math.abs(value))));
    matrix.compose(p, q, s);
    geo.applyMatrix4(matrix);
    if (!geo.attributes.normal) geo.computeVertexNormals();
    const pa = geo.attributes.position.array;
    const na = geo.attributes.normal.array;
    for (let i = 0; i < pa.length; i++) positions.push(pa[i]);
    for (let i = 0; i < na.length; i++) normals.push(na[i]);

    let partColor = part.color;
    if (palette && part.colorKey) {
      const key = part.colorKey;
      if (palette[key + 'Hex'] !== undefined) partColor = palette[key + 'Hex'];
      else if (palette[key] !== undefined) partColor = palette[key];
    }
    color.setHex(Number.isInteger(partColor) ? partColor : 0x888888);
    for (let i = 0; i < pa.length / 3; i++) colors.push(color.r, color.g, color.b);
    geo.dispose();
  }

  const merged = new THREE.BufferGeometry();
  merged.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  merged.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
  merged.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  merged.computeBoundingBox();
  merged.computeBoundingSphere();
  return merged;
}

/** 建立可複製的零件台物件；entry 必須是 resolved runtime roster 的正式列。 */
export function makeRuntimePartModel(entry, { environment = true, palette = null, paletteIndex = null, seed = null } = {}) {
  if (!entry?.parts?.length) throw new TypeError(`執行期目錄列缺少 parts:${entry?.key || 'unknown'}`);
  const resolvedPalette = palette || resolvePalette(entry, { paletteIndex, seed });
  const geometry = runtimeMeshDataGeometry(entry.meshData, entry.parts, resolvedPalette)
    || mergeRuntimeParts(entry.parts, { entry, palette: resolvedPalette, paletteIndex, seed });
  const material = (environment ? envMat : toonMat)(0xffffff, { vertexColors: true });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.name = `runtime:${entry.key}`;
  mesh.userData.runtimePart = {
    key: entry.key,
    family: entry.family,
    version: entry.version,
    source: entry.source || entry.image || null,
  };
  return mesh;
}

export const runtimePartTypes = () => [...TYPES];
