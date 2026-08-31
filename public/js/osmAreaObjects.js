// ============ OSM 用地物件生成器 ============
// 每種 generator 只有一列資料與一個幾何建構器；落點、holes、容量與同輪互撞皆由
// osmAreas.js 的單一配置縫決定。此層只負責把已核准落點批次轉成 Three.js 幾何。
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { areaAreaM2, buildContainmentIndex, placeAreaCandidates } from './osmAreas.js';

const ROWS = Object.freeze({
  industrial: { shape: 'tank', radius: 4.0, minArea: 700, max: 2, color: 0x707a82, solid: true },
  field: { shape: 'crop', radius: 2.2, minArea: 900, max: 6, color: 0x8d9a53, solid: false },
  orchard: { shape: 'tree', radius: 2.5, minArea: 550, max: 7, color: 0x53763e, solid: true },
  forest: { shape: 'tree', radius: 3.0, minArea: 750, max: 8, color: 0x3f6840, solid: true },
  park: { shape: 'bench', radius: 1.8, minArea: 1200, max: 3, color: 0x687c50, solid: true },
  sports: { shape: 'goal', radius: 2.8, minArea: 1800, max: 2, color: 0xd9ded5, solid: true },
  parking: { shape: 'car', radius: 2.4, minArea: 180, max: 8, color: 0x657587, solid: true },
  campus: { shape: 'facility', radius: 5.0, minArea: 3000, max: 1, color: 0x98aa86, solid: true, representative: true },
  hospital: { shape: 'facility', radius: 5.0, minArea: 3000, max: 1, color: 0xb57d7d, solid: true, representative: true },
  station: { shape: 'facility', radius: 5.0, minArea: 2400, max: 1, color: 0x7d86a0, solid: true, representative: true },
  civic: { shape: 'facility', radius: 4.5, minArea: 2400, max: 1, color: 0x9299a1, solid: true, representative: true },
  religious: { shape: 'spire', radius: 4.0, minArea: 2200, max: 1, color: 0xa28a6f, solid: true, representative: true },
  cemetery: { shape: 'marker', radius: 1.2, minArea: 500, max: 6, color: 0x77796d, solid: true },
  military: { shape: 'barrier', radius: 2.4, minArea: 900, max: 4, color: 0x626b59, solid: true },
  railway: { shape: 'signal', radius: 1.2, minArea: 1000, max: 3, color: 0x5e646b, solid: true },
  airport: { shape: 'signal', radius: 1.4, minArea: 2400, max: 3, color: 0xd4c76b, solid: true },
  water: { shape: 'buoy', radius: 1.0, minArea: 4000, max: 3, color: 0xe17d42, solid: false },
  wetland: { shape: 'reed', radius: 1.0, minArea: 650, max: 8, color: 0x687b45, solid: false },
  bare: { shape: 'rock', radius: 2.3, minArea: 1000, max: 4, color: 0x9a8c72, solid: true },
  rock: { shape: 'rock', radius: 2.8, minArea: 850, max: 5, color: 0x77736d, solid: true },
  quarry: { shape: 'barrier', radius: 2.5, minArea: 1200, max: 4, color: 0xb49155, solid: true },
  construction: { shape: 'barrier', radius: 2.0, minArea: 700, max: 5, color: 0xd08a42, solid: true },
  power: { shape: 'transformer', radius: 3.2, minArea: 900, max: 3, color: 0x68767c, solid: true },
});

const box = (w, h, d, y = h / 2) => {
  const g = new THREE.BoxGeometry(w, h, d); g.translate(0, y, 0); return g;
};
const cylinder = (r0, r1, h, n = 8, y = h / 2) => {
  const g = new THREE.CylinderGeometry(r1, r0, h, n); g.translate(0, y, 0); return g;
};

const SHAPES = Object.freeze({
  tank: () => [cylinder(3.2, 3.2, 5, 12)],
  crop: () => [box(3.4, 0.7, 1.2, 0.35), box(3.4, 0.7, 1.2, 0.35)],
  tree: () => [cylinder(0.5, 0.42, 4, 7), cylinder(2.4, 0.2, 5, 8, 6)],
  bench: () => [box(3, 0.35, 0.75, 0.9), box(0.25, 0.9, 0.25, 0.45), box(0.25, 0.9, 0.25, 0.45)],
  goal: () => [box(5, 0.18, 0.18, 2.4), box(0.18, 2.5, 0.18, 1.25), box(0.18, 2.5, 0.18, 1.25)],
  car: () => [box(4.2, 1.2, 1.9, 0.7), box(2.1, 0.7, 1.7, 1.55)],
  facility: () => [box(8, 7, 7), box(3, 2, 3, 8)],
  spire: () => [box(6, 5, 6), cylinder(3.2, 0, 6, 8, 8)],
  marker: () => [box(0.7, 1.3, 0.35, 0.65)],
  barrier: () => [box(4, 1.1, 0.8, 0.55)],
  signal: () => [cylinder(0.18, 0.18, 4, 8), box(0.9, 1.1, 0.45, 3.8)],
  buoy: () => [cylinder(0.7, 0.45, 1.3, 10, 0.65)],
  reed: () => [cylinder(0.08, 0.04, 2.1, 5), cylinder(0.08, 0.04, 1.7, 5)],
  rock: () => [cylinder(2.0, 1.1, 3.2, 7, 1.6)],
  transformer: () => [box(4.5, 3.8, 3.2), cylinder(0.35, 0.35, 4.8, 8, 5.8)],
});

function translateGeos(geos, x, y, z, seed) {
  const ry = ((seed * 0.61803398875) % 1) * Math.PI * 2;
  for (let i = 0; i < geos.length; i++) {
    if (i && geos.length > 1) geos[i].translate((i - (geos.length - 1) / 2) * 0.65, 0, 0);
    geos[i].rotateY(ry); geos[i].translate(x, y, z);
  }
  return ry;
}

/** 生成非建築用地物件；住宅／商業 district 只信任既有 OSM 子建物，不補虛構樓房。 */
export function buildOsmAreaObjects(group, areas = [], options = {}) {
  const containment = buildContainmentIndex(areas);
  const eligible = areas.filter((area) => {
    const row = ROWS[area?.classification?.generator];
    if (!row || area?.tags?.building != null || area?.tags?.['building:part'] != null) return false;
    if (!row.representative) return true;
    return !containment.childrenOf(area).some((c) => (c.tags?.building != null || c.tags?.['building:part'] != null)
      && c.classification?.family === area.classification?.family);
  });
  const plan = placeAreaCandidates(eligible, {
    maxObjects: Math.max(0, Number(options.maxObjects) || 480),
    maxPerArea: 8, minGap: 1.5,
    radiusOf: (area) => ROWS[area.classification.generator].radius,
    countOf: (area) => {
      const row = ROWS[area.classification.generator];
      return Math.min(row.max, Math.max(1, Math.floor(areaAreaM2(area) / row.minArea)));
    },
    blocked: options.blocked,
  });
  const batches = new Map(), blockers = [], generatedByKind = {};
  for (let index = 0; index < plan.placed.length; index++) {
    const p = plan.placed[index], cls = p.area.classification, row = ROWS[cls.generator];
    const make = SHAPES[row.shape];
    if (!make) continue;
    const geos = make();
    const y = Number(options.heightAt?.(p.x, p.z)) || 0;
    const ry = translateGeos(geos, p.x, y, p.z, index + String(p.sourceId).length);
    let batch = batches.get(cls.generator);
    if (!batch) batches.set(cls.generator, batch = { row, geos: [] });
    batch.geos.push(...geos);
    generatedByKind[cls.kind] = (generatedByKind[cls.kind] || 0) + 1;
    if (row.solid) blockers.push({
      x: p.x, z: p.z, y, h: Math.max(1, row.radius * 1.8), r: row.radius,
      hw2: row.radius, hd2: row.radius, ry, cl: 'prop', osmArea: 1, sourceId: p.sourceId,
    });
  }
  for (const [generator, batch] of batches) {
    if (!batch.geos.length) continue;
    const geometry = batch.geos.length === 1 ? batch.geos[0] : mergeGeometries(batch.geos, false);
    const material = options.materialOf?.(generator, batch.row)
      || new THREE.MeshToonMaterial({ color: batch.row.color });
    const mesh = new THREE.Mesh(geometry, material);
    mesh.userData.osmAreaBatch = generator; mesh.frustumCulled = false; group.add(mesh);
  }
  return {
    blockers, generated: Object.values(generatedByKind).reduce((n, v) => n + v, 0),
    generatedByKind, capacity: plan.capacity, skipped: plan.skipped,
  };
}

export { ROWS as OSM_AREA_OBJECT_ROWS };
