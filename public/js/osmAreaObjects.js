// ============ OSM 用地物件生成器 ============
// 每種 generator 只有一列資料與一個幾何建構器；落點、holes、容量與同輪互撞皆由
// osmAreas.js 的單一配置縫決定。此層只負責把已核准落點批次轉成 Three.js 幾何。
import * as THREE from 'three';
import { mergeGeos } from './beacons.js';
import { areaAreaM2, buildContainmentIndex, placeAreaCandidates } from './osmAreas.js';
import { envMat } from './toon.js';
import { compileSceneParts, fitSceneGeometry, forestSceneGeometry, geologySceneGeometry } from './scenePropModels.js';
import { sceneFurnitureParts } from './sceneFurnitureParts.js';
import { groundPlantParts } from './scenePlantParts.js';
import { makeSceneVehicleParts } from './vehicleCatalog.js';
import { environmentBuildingPlan } from './environmentParts.js';
import { taggedBuildingFunction } from './buildingFunctions.js';

const ROWS = Object.freeze({
  industrial: { shape: 'tank', radius: 4.0, minArea: 700, max: 2, color: 0x707a82, solid: true },
  field: { shape: 'crop', radius: 2.2, minArea: 900, max: 6, color: 0x8d9a53, solid: false },
  orchard: { shape: 'tree', radius: 2.5, minArea: 550, max: 7, color: 0x53763e, solid: true },
  forest: { shape: 'tree', radius: 3.0, minArea: 750, max: 8, color: 0x3f6840, solid: true },
  park: { shape: 'bench', radius: 1.8, minArea: 1200, max: 3, color: 0x687c50, solid: true },
  sports: { shape: 'goal', radius: 2.8, minArea: 1800, max: 2, color: 0xd9ded5, solid: true },
  parking: { shape: 'car', radius: 2.2, minArea: 55, max: 24, color: 0x657587, solid: true },
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

/** Shared content builders feed the existing area-placement and collision contracts. */
export function osmAreaGeometry(kind, seed, radius, functionType = null) {
  if (kind === 'tree') return forestSceneGeometry('holmOak', seed, [radius * 1.8, radius * 1.8, radius * 1.8]);
  if (kind === 'rock') return geologySceneGeometry('granite', seed, [radius * 1.8, radius * 1.5, radius * 1.8]);
  if (kind === 'car' || kind === 'motorcycle') return compileSceneParts(makeSceneVehicleParts(kind === 'car' ? 'sedan' : kind,
    { paint: seed, fit: kind === 'car' ? { L: 4.2, W: 1.9, H: 1.9 } : { L: 2, W: .8, H: 1.4 } }));
  if (kind === 'crop' || kind === 'reed') return fitSceneGeometry(compileSceneParts(groundPlantParts(kind, seed)),
    [radius * 1.5, kind === 'crop' ? .85 : 2.1, radius * 1.5]);
  if (kind === 'facility' || kind === 'spire') return fitSceneGeometry(compileSceneParts(
    environmentBuildingPlan('house', [radius * 1.7, radius * 1.6, radius * 1.5], seed,
      functionType || (kind === 'spire' ? 'worship' : 'civic')).parts), [radius * 1.7, radius * 1.6, radius * 1.5]);
  const geometry = compileSceneParts(sceneFurnitureParts(kind));
  geometry.computeBoundingBox();
  const extent = geometry.boundingBox.getSize(new THREE.Vector3());
  const scale = Math.min(1, radius * 2 / extent.x, radius * 2 / extent.z, Math.max(1, radius * 1.8) / extent.y);
  geometry.scale(scale, scale, scale);
  return geometry;
}

function translateGeos(geos, x, y, z, seed, slopeFit = false, heightAt = null) {
  const ry = ((seed * 0.61803398875) % 1) * Math.PI * 2;
  // 地面式貼合：以 heightAt 有限差分推導坡度，轉入實例朝向局部系；
  // rotateX(θ):+Z 端下沉 ⇒ pitch=-atan；rotateZ(φ):+X 端抬升 ⇒ roll=+atan
  let pitch = 0, roll = 0;
  if (slopeFit && typeof heightAt === 'function') {
    const e = 1.25;
    const hx1 = heightAt(x + e, z), hx0 = heightAt(x - e, z);
    const hz1 = heightAt(x, z + e), hz0 = heightAt(x, z - e);
    if ([hx1, hx0, hz1, hz0].every(Number.isFinite)) {
      const gx = (hx1 - hx0) / (2 * e), gz = (hz1 - hz0) / (2 * e);
      if (Math.hypot(gx, gz) >= 0.02) {
        const c = Math.cos(ry), s = Math.sin(ry);
        const clamp = (v) => Math.max(-0.45, Math.min(0.45, v));
        pitch = clamp(-Math.atan(s * gx + c * gz));
        roll = clamp(Math.atan(c * gx - s * gz));
      }
    }
  }
  for (let i = 0; i < geos.length; i++) {
    if (i && geos.length > 1) geos[i].translate((i - (geos.length - 1) / 2) * 0.65, 0, 0);
    if (pitch || roll) { geos[i].rotateX(pitch); geos[i].rotateZ(roll); }
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
  const terrain = options.terrain;
  const inset = Math.max(0, Number(options.inset) || 0);
  const isInside = (x, z, r = 0) => !terrain || (
    x >= terrain.minX + inset + r && x <= terrain.maxX - inset - r
    && z >= terrain.minZ + inset + r && z <= terrain.maxZ - inset - r
  );
  const blocked = (x, z, r, area) => {
    if (!isInside(x, z, r)) return true;
    return options.blocked ? options.blocked(x, z, r, area) : false;
  };
  const plan = placeAreaCandidates(eligible, {
    maxObjects: Math.max(0, Number(options.maxObjects) || 480),
    maxPerArea: 8, minGap: 1.5,
    radiusOf: (area) => ROWS[area.classification.generator].radius,
    countOf: (area) => {
      const row = ROWS[area.classification.generator];
      return Math.min(row.max, Math.max(1, Math.floor(areaAreaM2(area) / row.minArea)));
    },
    blocked,
  });
  const batches = new Map(), blockers = [], generatedByKind = {};
  for (let index = 0; index < plan.placed.length; index++) {
    const p = plan.placed[index], cls = p.area.classification, row = ROWS[cls.generator];
    if (!isInside(p.x, p.z, row.radius)) continue;
    let shapeKey = row.shape;
    if (cls.generator === 'parking') {
      const occSeed = ((index * 9301 + 49297) % 233280) / 233280;
      if (occSeed < 0.22) continue;
      shapeKey = (index % 3 === 0) ? 'motorcycle' : 'car';
    } else if (cls.generator === 'power') {
      const isSolar = p.area?.tags?.['plant:source'] === 'solar' || p.area?.tags?.['generator:source'] === 'solar' || p.area?.tags?.power === 'solar';
      if (isSolar) shapeKey = 'solar';
    }
    const seed = (Math.imul(Math.round(p.x * 16), 73856093) ^ Math.imul(Math.round(p.z * 16), 19349663)) >>> 0;
    const functionType = taggedBuildingFunction(p.area.tags)?.type
      || { campus: 'school', hospital: 'hospital', station: 'station', civic: 'civic', religious: 'worship' }[cls.generator];
    const geos = [osmAreaGeometry(shapeKey, seed, row.radius, functionType)];
    const y = Number(options.heightAt?.(p.x, p.z)) || 0;
    // OSM 太陽能電廠順著地形高程鋪設，面向角度保持不變；其餘用地物件維持直立
    const ry = translateGeos(geos, p.x, y, p.z, index + String(p.sourceId).length, false, options.heightAt);
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
    const geometry = batch.geos.length === 1 ? batch.geos[0] : mergeGeos(batch.geos, batch.geos.map(() => null));
    const material = options.materialOf?.(generator, batch.row)
      || envMat(0xffffff, { vertexColors: true, wash: 0.38, cool: 0.42, rim: .035 });
    const mesh = new THREE.Mesh(geometry, material);
    mesh.userData.osmAreaBatch = generator; mesh.frustumCulled = false; group.add(mesh);
  }
  return {
    blockers, generated: Object.values(generatedByKind).reduce((n, v) => n + v, 0),
    generatedByKind, capacity: plan.capacity, skipped: plan.skipped,
  };
}

export { ROWS as OSM_AREA_OBJECT_ROWS };
