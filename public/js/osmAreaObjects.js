// ============ OSM 用地物件生成器 ============
// 每種 generator 只有一列資料與一個幾何建構器；落點、holes、容量與同輪互撞皆由
// osmAreas.js 的單一配置縫決定。此層只負責把已核准落點批次轉成 Three.js 幾何。
import * as THREE from 'three';
import { mergeGeos } from './beacons.js';
import { envMat } from './toon.js';
import { compileSceneParts, fitSceneGeometry, forestSceneGeometry, geologySceneGeometry } from './scenePropModels.js';
import { sceneFurnitureParts } from './sceneFurnitureParts.js';
import { groundPlantParts } from './scenePlantParts.js';
import { makeSceneVehicleParts } from './vehicleCatalog.js';
import { environmentBuildingPlan } from './environmentParts.js';
import { taggedBuildingFunction } from './buildingFunctions.js';
import { OSM_AREA_OBJECT_ROWS as ROWS } from './osmAreaCatalog.js';
import { planOsmAreaObjects } from './osmAreaLayout.js';
import { createOsmSportRenderer } from './osmSportsRender.js';

/** Shared content builders feed the existing area-placement and collision contracts. */
function rawAreaGeometry(kind, seed, radius, functionType, context) {
  if (kind === 'tree') return forestSceneGeometry('holmOak', seed, [radius * 1.8, radius * 1.8, radius * 1.8]);
  if (kind === 'rock') return geologySceneGeometry('granite', seed, [radius * 1.8, radius * 1.5, radius * 1.8]);
  if (kind === 'car' || kind === 'motorcycle') {
    const CAR_PROFILES = ['sedan', 'taxi', 'rally', 'truck', 'van', 'pickup', 'miniTruck', 'police', 'ambulance'];
    const profile = kind === 'motorcycle' ? 'motorcycle' : CAR_PROFILES[Math.abs(seed) % CAR_PROFILES.length];
    return compileSceneParts(makeSceneVehicleParts(profile,
      { paint: seed, fit: kind === 'motorcycle' ? { L: 2, W: .8, H: 1.4 } : { L: 4.2, W: 1.9, H: 1.9 } }));
  }
  if (kind === 'crop' || kind === 'reed') return fitSceneGeometry(compileSceneParts(groundPlantParts(kind, seed)),
    [radius * 1.5, kind === 'crop' ? .85 : 2.1, radius * 1.5]);
  if (kind === 'facility' || kind === 'spire') return fitSceneGeometry(compileSceneParts(
    environmentBuildingPlan('house', [radius * 1.7, radius * 1.6, radius * 1.5], seed,
      functionType || (kind === 'spire' ? 'worship' : 'civic'), context).parts), [radius * 1.7, radius * 1.6, radius * 1.5]);
  return compileSceneParts(sceneFurnitureParts(kind));
}

export function osmAreaGeometry(kind, seed, radius, functionType = null, context = {}) {
  const geometry = rawAreaGeometry(kind, seed, radius, functionType, context);
  geometry.computeBoundingBox();
  const extent = geometry.boundingBox.getSize(new THREE.Vector3());
  const center = geometry.boundingBox.getCenter(new THREE.Vector3());
  geometry.translate(-center.x, -geometry.boundingBox.min.y, -center.z);
  const scale = Math.min(1, radius * 2 / Math.hypot(extent.x, extent.z), Math.max(1, radius * 1.8) / extent.y);
  geometry.scale(scale, scale, scale);
  return geometry;
}

function translateGeos(geos, x, y, z, ry, slopeFit = false, heightAt = null) {
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
  const plan = planOsmAreaObjects(areas, options);
  const batches = new Map(), blockers = [], footprints = [], generatedByKind = {};
  const sports = createOsmSportRenderer(group, options.terrain);
  for (let index = 0; index < plan.placed.length; index++) {
    const p = plan.placed[index], cls = p.area.classification, row = ROWS[cls.generator];
    const { shape: shapeKey, seed, y } = p;
    if (p.sport) {
      if (sports.add(p)) generatedByKind[cls.kind] = (generatedByKind[cls.kind] || 0) + 1;
      else plan.skipped.push({ sourceId: p.sourceId, reason: 'missing_surface' });
      continue;
    }
    const functionType = taggedBuildingFunction(p.area.tags)?.type
      || { campus: 'school', hospital: 'hospital', station: 'station', civic: 'civic', religious: 'worship' }[cls.generator];
    const geos = [osmAreaGeometry(shapeKey, seed, row.radius, functionType, {
      building: p.area, location: options.location, ...options.environmentAt?.(p.x, p.z),
    })];
    geos[0].computeBoundingBox();
    const extent = geos[0].boundingBox.getSize(new THREE.Vector3());
    const ry = translateGeos(geos, p.x, y, p.z, p.ry);
    let batch = batches.get(cls.generator);
    if (!batch) batches.set(cls.generator, batch = { row, geos: [] });
    batch.geos.push(...geos);
    generatedByKind[cls.kind] = (generatedByKind[cls.kind] || 0) + 1;
    footprints.push({ x: p.x, z: p.z, r: Math.hypot(extent.x, extent.z) / 2 });
    if (row.solid) blockers.push({
      x: p.x, z: p.z, y, h: extent.y, r: Math.hypot(extent.x, extent.z) / 2,
      hw2: extent.x / 2, hd2: extent.z / 2, ry, cl: 'prop', osmArea: 1, sourceId: p.sourceId,
    });
  }
  const sportResult = sports.flush();
  blockers.push(...sportResult.blockers); footprints.push(...sportResult.footprints);
  for (const [generator, batch] of batches) {
    if (!batch.geos.length) continue;
    const geometry = batch.geos.length === 1 ? batch.geos[0] : mergeGeos(batch.geos, batch.geos.map(() => null));
    const material = options.materialOf?.(generator, batch.row)
      || envMat(0xffffff, { vertexColors: true, wash: 0.38, cool: 0.42, rim: .035 });
    const mesh = new THREE.Mesh(geometry, material);
    mesh.userData.osmAreaBatch = generator; mesh.frustumCulled = false; group.add(mesh);
  }
  return {
    blockers, footprints, generated: Object.values(generatedByKind).reduce((n, v) => n + v, 0),
    generatedByKind, capacity: plan.capacity, skipped: plan.skipped,
  };
}

export { ROWS as OSM_AREA_OBJECT_ROWS };
