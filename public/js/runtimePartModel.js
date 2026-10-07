// Single adapter seam from bench-declared parts to runtime game geometry.
// Each approved object merges into one vertex-color mesh; collision and scene layout MUST NOT read back this visual geometry.
import * as THREE from 'three';
import { sceneObjectMat, toonMat } from './toon.js';
import { sceneryBoxData } from './sceneryAppearance.js';

const TYPES = new Set([
  'mesh', 'box', 'cone', 'conical_frustum', 'cylinder', 'dodecahedron_polyhedron',
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
 * Backfills colors by generator-written part/face order when legacy model.json lacks color vertex attributes.
 * Faces and parts come from the same meshData; this only completes data, never rebuilds geometry.
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

/** Build baked v6 meshData; preview, bench, and game share the same vertices and faces. */
export function runtimeMeshDataGeometry(meshData, parts = [], palette = null) {
  const vertices = meshData?.vertices;
  const faces = meshData?.faces;
  if (!Array.isArray(vertices) || vertices.length < 9 || vertices.length % 3 !== 0
    || !Array.isArray(faces) || faces.length < 3 || faces.length % 3 !== 0
    || !faces.every((n) => Number.isInteger(n) && n >= 0 && n < vertices.length / 3)) return null;

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
  geo.setIndex(faces);
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

/** Build a single part geometry; unknown types throw loudly, never silently fall back to a box. */
export function runtimePrimitiveGeometry(part) {
  if (!part || !TYPES.has(part.type)) throw new TypeError(`未知零件型別:${part?.type || 'null'}`);
  const sides = Math.max(3, Math.min(24, part.sides | 0 || 8));
  const h = Math.max(0.001, finite(part.height) ? part.height : 1);
  let geo;
  switch (part.type) {
    case 'mesh': {
      geo = runtimeMeshDataGeometry(part.meshData);
      if (!geo) throw new TypeError('Invalid procedural mesh');
      break;
    }
    case 'box': {
      const size = pos3(part.dimensions, 1).map(n => Math.max(0.001, n));
      geo = Math.min(...size) < .025 ? new THREE.BoxGeometry(...size) : runtimeMeshDataGeometry(sceneryBoxData(size));
      break;
    }
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
 * Bakes heterogeneous primitives into one non-indexed geometry; colors go into per-vertex attributes, material stays single.
 * Supports dynamic palette lists via options.palette / options.paletteIndex / options.seed.
 * @param {Array<object>} parts parts array from the bench
 * @param {object} [options] palette and parent settings
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
    if (part.type === 'mesh' && part.meshData.colors && geo.attributes.color) {
      for (const component of geo.attributes.color.array) colors.push(component);
    }
    else for (let i = 0; i < pa.length / 3; i++) colors.push(color.r, color.g, color.b);
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

// Cache only immutable approved rows; in-progress preview rows rebuild every time, so stale parts are never shown.
// Returns independent geometry, so tearing down one object never frees buffers still used by others.
const compiledModels = new Map();
const COMPILED_MODEL_LIMIT = 32;
function compiledGeometry(entry, palette, options) {
  const key = JSON.stringify(palette);
  const cached = compiledModels.get(entry);
  if (cached && cached.key === key) {
    compiledModels.delete(entry);
    compiledModels.set(entry, cached);
    return cached.geometry.clone();
  }
  const geometry = runtimeMeshDataGeometry(entry.meshData, entry.parts, palette)
    || mergeRuntimeParts(entry.parts, { ...options, entry, palette });
  if (!Object.isFrozen(entry)) return geometry;
  if (cached) cached.geometry.dispose();
  compiledModels.delete(entry);
  compiledModels.set(entry, { key, geometry });
  if (compiledModels.size > COMPILED_MODEL_LIMIT) {
    const oldest = compiledModels.keys().next().value;
    compiledModels.get(oldest).geometry.dispose();
    compiledModels.delete(oldest);
  }
  return geometry.clone();
}

/** Build a duplicable bench object; entry must be an approved row of the resolved runtime roster. */
export function makeRuntimePartModel(entry, { environment = true, palette = null, paletteIndex = null, seed = null } = {}) {
  if (!entry?.parts?.length) throw new TypeError(`執行期目錄列缺少 parts:${entry?.key || 'unknown'}`);
  const resolvedPalette = palette || resolvePalette(entry, { paletteIndex, seed });
  const geometry = compiledGeometry(entry, resolvedPalette, { paletteIndex, seed });
  const material = (environment ? sceneObjectMat : toonMat)(0xffffff, { vertexColors: true });
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
