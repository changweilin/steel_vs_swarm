// ============ OSM 精確建物外環生成器 ============
// 只吃 osmAreas.js 投影後的 outer/holes；不把輪廓縮成中心方盒。牆段與 blocker
// 共用同一組 edge 資料，屋頂則由 ShapeGeometry 保留內洞。不同語意最後各自合批，
// 因而 draw call 由型別數決定，不隨建物棟數線性增加。
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { envMat } from './toon.js';

const EPS = 1e-5;
const DEFAULT_H = Object.freeze({
  house: 8, terrace: 10, apartments: 20, commercial: 18, industrial: 12, farm: 8,
  school: 10, hospital: 14, station: 12, church: 14, mosque: 14, temple: 14,
  synagogue: 14, civic: 12, museum: 14, stadium: 18, garage: 5, hangar: 12,
  lighthouse: 18, castle: 16,
});

// 一種類型一列；幾何仍只由下方單一 polygon/attachment 生成器負責。
// attachment 是識別性屋頂件，fit 不進完整輪廓時整件略過，不放大主體。
export const BUILDING_STYLE_ROWS = Object.freeze({
  house: { wall: 0xb7a893, roof: 0x6d5d52, attachment: 'chimney' },
  terrace: { wall: 0xb39a84, roof: 0x67584f, attachment: 'chimney' },
  apartments: { wall: 0xa9a398, roof: 0x505b64, attachment: 'hvac' },
  commercial: { wall: 0x7189a8, roof: 0x465765, attachment: 'canopy' },
  industrial: { wall: 0x727b83, roof: 0x4f5964, attachment: 'stack' },
  farm: { wall: 0xa58d68, roof: 0x66574a, attachment: 'silo' },
  school: { wall: 0x9aaf8f, roof: 0x596d58, attachment: 'clock' },
  hospital: { wall: 0xb47e7e, roof: 0x66565b, attachment: 'cross' },
  station: { wall: 0x888fa4, roof: 0x505866, attachment: 'canopy' },
  church: { wall: 0xa58f73, roof: 0x5c5660, attachment: 'spire' },
  mosque: { wall: 0xc0ad83, roof: 0x56756f, attachment: 'dome' },
  temple: { wall: 0xa77b64, roof: 0x6f3e36, attachment: 'finial' },
  synagogue: { wall: 0xb49f7b, roof: 0x5f6b78, attachment: 'dome' },
  civic: { wall: 0x9b9ea6, roof: 0x565d66, attachment: 'flag' },
  museum: { wall: 0x9d8eaa, roof: 0x5a5265, attachment: 'skylight' },
  stadium: { wall: 0x789b80, roof: 0x4e6658, attachment: 'mast' },
  garage: { wall: 0x8a8d91, roof: 0x55595c, attachment: null },
  hangar: { wall: 0x7c858b, roof: 0x4d555b, attachment: 'beacon' },
  lighthouse: { wall: 0xd4c7ad, roof: 0x8b4f47, attachment: 'beacon' },
  castle: { wall: 0x958b78, roof: 0x5f5b55, attachment: 'battlement' },
});

const finite = (v) => typeof v === 'number' && Number.isFinite(v);
const ringOf = (ring) => {
  if (!Array.isArray(ring) || ring.length < 3) return null;
  const out = [];
  for (const p of ring) {
    if (!Array.isArray(p) || !finite(p[0]) || !finite(p[1])) return null;
    if (!out.length || Math.hypot(p[0] - out[out.length - 1][0], p[1] - out[out.length - 1][1]) > EPS) out.push([p[0], p[1]]);
  }
  if (out.length > 1 && Math.hypot(out[0][0] - out[out.length - 1][0], out[0][1] - out[out.length - 1][1]) <= EPS) out.pop();
  return out.length >= 3 ? out : null;
};

function polyOf(polygon) {
  const outer = ringOf(polygon?.outer);
  if (!outer) return null;
  const holes = [];
  for (const raw of polygon?.holes || []) {
    const hole = ringOf(raw);
    if (hole) holes.push(hole);
  }
  return { outer, holes };
}

function addPath(shape, ring) {
  shape.moveTo(ring[0][0], -ring[0][1]);
  for (let i = 1; i < ring.length; i++) shape.lineTo(ring[i][0], -ring[i][1]);
  shape.lineTo(ring[0][0], -ring[0][1]);
}

function roofGeometry(poly, y) {
  const shape = new THREE.Shape();
  addPath(shape, poly.outer);
  for (const hole of poly.holes) {
    const path = new THREE.Path();
    addPath(path, hole);
    shape.holes.push(path);
  }
  const geo = new THREE.ShapeGeometry(shape);
  // ShapeGeometry is X/Y; map its local Y to world Z while keeping its normal upward.
  geo.rotateX(-Math.PI / 2);
  geo.translate(0, y, 0);
  return geo;
}

function edgeGeometry(ring, baseY, height, thickness, sourceId, kind) {
  const geos = [], edges = [];
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i], b = ring[(i + 1) % ring.length];
    const dx = b[0] - a[0], dz = b[1] - a[1], len = Math.hypot(dx, dz);
    if (len <= EPS) continue;
    const ry = Math.atan2(dz, dx);
    const geo = new THREE.BoxGeometry(len, height, thickness);
    geo.rotateY(ry);
    geo.translate((a[0] + b[0]) / 2, baseY + height / 2, (a[1] + b[1]) / 2);
    geos.push(geo);
    // This is the same oriented box as the visible wall segment (A30).
    edges.push({
      x: (a[0] + b[0]) / 2, z: (a[1] + b[1]) / 2, y: baseY,
      h: height, hw2: len / 2, hd2: thickness / 2, ry,
      r: Math.hypot(len, thickness) / 2, ty: baseY + height,
      bld: 1, osm: 1, cl: 'bld', sourceId, kind,
    });
  }
  return { geos, edges };
}

function heightOf(area, kind) {
  const tags = area?.tags || {};
  const raw = Number.parseFloat(tags.height);
  if (Number.isFinite(raw) && raw > 2) return Math.min(120, raw);
  const levels = Number.parseFloat(tags['building:levels']);
  if (Number.isFinite(levels) && levels > 0) return Math.min(120, Math.max(3.2, levels * 3.2));
  return DEFAULT_H[kind] || 8;
}

function baseOf(poly, terrain, fallback = 0) {
  if (typeof terrain?.heightAt !== 'function') return fallback;
  let y = Infinity;
  for (const p of poly.outer) y = Math.min(y, terrain.heightAt(p[0], p[1]));
  for (const ring of poly.holes) for (const p of ring) y = Math.min(y, terrain.heightAt(p[0], p[1]));
  return Number.isFinite(y) ? y : fallback;
}

function defaultMaterials(style) {
  const row = BUILDING_STYLE_ROWS[style] || BUILDING_STYLE_ROWS.house;
  return {
    wall: envMat(row.wall, { wash: 0.42, cool: 0.4 }),
    roof: envMat(row.roof, { wash: 0.3, cool: 0.45 }),
  };
}

function pointInRing(x, z, ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[i], b = ring[j];
    if (((a[1] > z) !== (b[1] > z)) && x < (b[0] - a[0]) * (z - a[1]) / ((b[1] - a[1]) || EPS) + a[0]) inside = !inside;
  }
  return inside;
}

function attachmentSite(poly, half) {
  const xs = poly.outer.map((p) => p[0]), zs = poly.outer.map((p) => p[1]);
  const cx = (Math.min(...xs) + Math.max(...xs)) / 2, cz = (Math.min(...zs) + Math.max(...zs)) / 2;
  const points = [[cx, cz], ...poly.outer.map((p) => [(p[0] + cx) / 2, (p[1] + cz) / 2])];
  return points.find(([x, z]) => [[-half, -half], [half, -half], [half, half], [-half, half]].every(([dx, dz]) =>
    pointInRing(x + dx, z + dz, poly.outer) && !poly.holes.some((hole) => pointInRing(x + dx, z + dz, hole)))) || null;
}

function attachmentGeometry(kind, poly, y) {
  const type = BUILDING_STYLE_ROWS[kind]?.attachment;
  if (!type) return null;
  const xs = poly.outer.map((p) => p[0]), zs = poly.outer.map((p) => p[1]);
  const half = Math.max(0.35, Math.min(2.2, Math.min(Math.max(...xs) - Math.min(...xs), Math.max(...zs) - Math.min(...zs)) * 0.12));
  const site = attachmentSite(poly, half);
  if (!site) return null;
  const [x, z] = site;
  let geo;
  if (type === 'dome' || type === 'silo') geo = new THREE.CylinderGeometry(half, half * 0.75, half * 1.8, 10);
  else if (type === 'spire' || type === 'finial') geo = new THREE.ConeGeometry(half, half * 3.2, 8);
  else if (type === 'stack' || type === 'mast' || type === 'flag' || type === 'beacon') geo = new THREE.CylinderGeometry(half * 0.28, half * 0.34, half * 2.8, 8);
  else if (type === 'cross') {
    const stem = new THREE.BoxGeometry(half * 0.35, half * 2.6, half * 0.3);
    const arm = new THREE.BoxGeometry(half * 1.5, half * 0.32, half * 0.3); arm.translate(0, half * 0.45, 0);
    geo = mergeGeometries([stem, arm], false);
  } else if (type === 'canopy' || type === 'skylight' || type === 'battlement') geo = new THREE.BoxGeometry(half * 1.8, half * 0.8, half * 1.8);
  else geo = new THREE.BoxGeometry(half, half, half);
  geo.translate(x, y + half * 1.3, z);
  return geo;
}

/**
 * 生成 OSM 建物外環／內洞。`materialOf` 回傳 { wall, roof }，可由 biomes 注入既有材質縫。
 * 回傳的 platforms 不放進 blockers，僅交給 main.js 的既有 surfaceAt 平台索引。
 */
export function buildOsmPolygonBuildings(group, areas = [], options = {}) {
  const terrain = options.terrain;
  const materialOf = typeof options.materialOf === 'function' ? options.materialOf : defaultMaterials;
  const wallThickness = Math.max(0.08, Number(options.wallThickness) || 0.28);
  const batches = new Map();
  const blockers = [], platforms = [], generatedByKind = {}, invalid = [], skipped = [];
  const ordered = [...areas].sort((a, b) => String(a?.sourceId).localeCompare(String(b?.sourceId)));
  for (const area of ordered) {
    const cls = area?.classification || {};
    const isBuilding = area?.tags?.building != null || area?.tags?.['building:part'] != null;
    if (!isBuilding) continue;
    if (cls.generator !== 'polygonBuilding') {
      skipped.push({ sourceId: area.sourceId, reason: cls.mode === 'unmapped' ? 'unmapped' : 'unsupported_building' });
      continue;
    }
    const kind = cls.kind || 'house';
    const height = heightOf(area, kind);
    let areaGenerated = 0;
    for (const raw of area.worldPolygons || []) {
      const poly = polyOf(raw);
      if (!poly) { invalid.push({ sourceId: area.sourceId, reason: 'invalid_footprint' }); continue; }
      const baseY = baseOf(poly, terrain, 0);
      const topY = baseY + height;
      let batch = batches.get(kind);
      if (!batch) { batch = { kind, walls: [], roofs: [], details: [], count: 0 }; batches.set(kind, batch); }
      batch.roofs.push(roofGeometry(poly, topY));
      const detail = attachmentGeometry(kind, poly, topY);
      if (detail) batch.details.push(detail);
      const outer = edgeGeometry(poly.outer, baseY, height, wallThickness, area.sourceId, kind);
      batch.walls.push(...outer.geos); blockers.push(...outer.edges);
      for (const hole of poly.holes) {
        const inner = edgeGeometry(hole, baseY, height, wallThickness, area.sourceId, kind);
        batch.walls.push(...inner.geos); blockers.push(...inner.edges);
      }
      // Polygon platform retains the outer ring and all holes; no AABB approximation is used.
      const xs = poly.outer.map((p) => p[0]), zs = poly.outer.map((p) => p[1]);
      platforms.push({
        platform: 1, active: true, sourceId: area.sourceId, kind,
        outer: poly.outer, holes: poly.holes, y: topY,
        bounds: { minX: Math.min(...xs), maxX: Math.max(...xs), minZ: Math.min(...zs), maxZ: Math.max(...zs) },
      });
      batch.count++; areaGenerated++;
    }
    if (areaGenerated) generatedByKind[kind] = (generatedByKind[kind] || 0) + areaGenerated;
  }
  const meshes = [];
  for (const batch of batches.values()) {
    const mats = materialOf(batch.kind, batch, BUILDING_STYLE_ROWS[batch.kind]) || defaultMaterials(batch.kind);
    if (batch.walls.length) {
      const geometry = batch.walls.length === 1 ? batch.walls[0] : mergeGeometries(batch.walls, false);
      const mesh = new THREE.Mesh(geometry, mats.wall);
      mesh.userData.osmBuildingBatch = batch.kind;
      mesh.frustumCulled = false;
      group.add(mesh); meshes.push(mesh);
    }
    if (batch.roofs.length) {
      const geometry = batch.roofs.length === 1 ? batch.roofs[0] : mergeGeometries(batch.roofs, false);
      const mesh = new THREE.Mesh(geometry, mats.roof);
      mesh.userData.osmBuildingRoofBatch = batch.kind;
      mesh.frustumCulled = false;
      group.add(mesh); meshes.push(mesh);
    }
    if (batch.details.length) {
      const geometry = batch.details.length === 1 ? batch.details[0] : mergeGeometries(batch.details, false);
      const mesh = new THREE.Mesh(geometry, mats.detail || mats.roof);
      mesh.userData.osmBuildingDetailBatch = batch.kind;
      mesh.frustumCulled = false;
      group.add(mesh); meshes.push(mesh);
    }
  }
  return {
    blockers, platforms, generated: Object.values(generatedByKind).reduce((n, v) => n + v, 0),
    generatedByKind, invalid, skipped,
    meshes,
  };
}
