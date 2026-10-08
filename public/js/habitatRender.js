import * as THREE from 'three';
import { HABITAT_SCENE } from './habitatCatalog.js';
import { createHabitatSampler, planHabitatDetails, planHabitatStreets, planHabitatFurniture, planHabitatPathEdges } from './habitat.js';
import { groundPlantParts, groundCoverParts } from './scenePlantParts.js';
import { compileSceneParts } from './scenePropModels.js';
import { envMat } from './toon.js';
import { makeFootprintIndex, blockerFoot } from './ground.js';
import { seasonalEnvironment } from './seasonalEnvironment.js';
import { sceneFurnitureParts } from './sceneFurnitureParts.js';
import { sceneryGeometry } from './sceneryGeometry.js';
import { buildWalkwaySurfaces, walkwayGeometry } from './walkwayRender.js';
import { WALKWAY_MESHES } from './walkwayMeshData.js';

function detailGeometry(kind, variant, coverSize = 0) {
  if (coverSize) {
    const geometry = compileSceneParts(groundCoverParts(kind, variant * 7717, coverSize));
    geometry.deleteAttribute('color');
    geometry.computeBoundingBox();
    const pos = geometry.attributes.position;
    let radius = 0;
    for (let i = 0; i < pos.count; i++) radius = Math.max(radius, Math.hypot(pos.getX(i), pos.getZ(i)));
    const box = geometry.boundingBox;
    geometry.translate(0, -box.min.y, 0);
    geometry.scale(.58 / Math.max(.01, radius), 1 / Math.max(.01, box.max.y - box.min.y), .58 / Math.max(.01, radius));
    return geometry;
  }
  if (kind === 'scrub') {
    const parts = [];
    for (let i = 0; i < 3; i++) {
      const angle = i * Math.PI * 2 / 3 + variant * .7;
      const x = Math.cos(angle) * .22, z = Math.sin(angle) * .22;
      const height = .44 + ((i + variant) % 3) * .08;
      parts.push({ g: ['cyl', .025, .04, height, 5], p: [x, height / 2, z], c: 0x715e42 });
      parts.push({ g: ['crown', .30], p: [x, height + .10, z], s: [1, .75, 1], c: [0x78834d, 0x687747, 0x8b8c53][i] });
      parts[parts.length - 1].naturalSeed = variant * 7717 ^ Math.imul(i + 1, 0x9e3779b9);
    }
    return compileSceneParts(parts);
  }
  if (kind === 'stone') {
    const geo = sceneryGeometry('stone', [1, 1, 1], variant * 7717);
    geo.translate(0, .5, 0);
    return geo;
  }
  const parts = kind === 'planter' ? sceneFurnitureParts(kind)
    : groundPlantParts(kind === 'crop' || kind === 'reed' ? kind : 'silvergrass', variant * 7717);
  const geometry = compileSceneParts(kind === 'planter' ? parts : kind === 'crop' || kind === 'reed'
    ? parts.slice(0, HABITAT_SCENE.DETAIL_PLANT_PARTS) : parts.filter(part => part.key === 'grass').slice(0, 4));
  if (kind !== 'planter') geometry.deleteAttribute('color');
  geometry.computeBoundingBox();
  const box = geometry.boundingBox, size = box.getSize(new THREE.Vector3());
  geometry.translate(-box.getCenter(new THREE.Vector3()).x, -box.min.y, -box.getCenter(new THREE.Vector3()).z);
  geometry.scale(.8 / Math.max(.01, size.x), 1 / Math.max(.01, size.y), .8 / Math.max(.01, size.z));
  return geometry;
}

/** Ground material belongs to terrain triangles; these batches fill free slots with bounded surface detail. */
export function buildHabitatScene(group, terrain, { surfaceField, seed = 0, blockers = [], reservedFootprints = [],
  roadSegments = [], walkwayPoints = [], realScale = .5, areas = [], roadClear, envCodeAt, isBlocked, inset = 0,
  low = false, season = 'summer', environment = {}, environmentAt }) {
  const occupied = makeFootprintIndex([...blockers.map(blockerFoot), ...reservedFootprints]);
  const bounds = { minX: terrain.minX + inset, maxX: terrain.maxX - inset,
    minZ: terrain.minZ + inset, maxZ: terrain.maxZ - inset };
  const sampleAt = createHabitatSampler({ areas, evidenceAt: terrain.evidenceAt,
    environmentAt: (x, z) => ({ ...environment, ...environmentAt?.(x, z),
      altitude: terrain.elevationAt?.(x, z) ?? terrain.heightAt(x, z) }),
    zoneAt: (x, z) => surfaceField.sample(x, z), envCodeAt,
    depthAt: (x, z) => Number.isFinite(terrain.waterY) ? terrain.waterY - terrain.heightAt(x, z) : null });
  const fits = (foot, zone) => {
    const { x, z, r } = foot;
    if (x - r < bounds.minX || x + r > bounds.maxX || z - r < bounds.minZ || z + r > bounds.maxZ
      || isBlocked(x, z) || occupied.near(foot, HABITAT_SCENE.DETAIL_GAP_M) || roadClear(x, z, foot)
      || !sampleAt.contains(foot)) return false;
    for (const [dx, dz] of [[0, 0], [-r, -r], [r, -r], [r, r], [-r, r]]) {
      const ec = envCodeAt(x + dx, z + dz), expected = zone === 'water' ? 1 : zone === 'wet' ? 2 : 0;
      if (ec !== expected || surfaceField.sample(x + dx, z + dz) !== zone) return false;
      if (zone === 'water' && sampleAt(x + dx, z + dz)?.key !== 'shallows') return false;
    }
    const heights = [[0, 0], [-r, -r], [r, -r], [r, r], [-r, r]].map(([dx, dz]) => terrain.heightAt(x + dx, z + dz));
    return heights.every(Number.isFinite) && Math.max(...heights) - Math.min(...heights) <= Math.max(.12, r * .6);
  };
  const streetPlan = planHabitatStreets({ segments: roadSegments, seed, sampleAt, heightAt: terrain.heightAt, fits, realScale,
    fitsPanel: foot => !occupied.near(foot) && sampleAt.contains(foot) });
  const pathEdges = planHabitatPathEdges({ segments: roadSegments, seed, sampleAt, heightAt: terrain.heightAt });
  for (const panel of streetPlan) {
    occupied.add({ x: panel.x, z: panel.z, hw: panel.hw, hd: panel.hd, ry: panel.ry, r: panel.r });
  }
  const allFurniture = planHabitatFurniture({ panels: [...streetPlan, ...pathEdges], points: walkwayPoints,
    seed, fits, sampleAt, heightAt: terrain.heightAt });
  for (const foot of allFurniture) occupied.add(foot);
  const furniture = allFurniture.slice(0, low ? HABITAT_SCENE.LOW_FURNITURE_LIMIT : HABITAT_SCENE.FURNITURE_LIMIT);
  const plan = planHabitatDetails({ bounds, seed, sampleAt, heightAt: terrain.heightAt, fits,
    maxDetails: low ? HABITAT_SCENE.LOW_DETAIL_LIMIT : HABITAT_SCENE.DETAIL_LIMIT });
  const env = seasonalEnvironment({ ...environment, season });
  const buckets = new Map(), matrix = new THREE.Matrix4(), rotation = new THREE.Quaternion();
  const color = new THREE.Color(), scale = new THREE.Vector3(), position = new THREE.Vector3();
  for (const row of plan.rows) {
    const key = row.kind + '/' + row.variant + '/' + row.coverSize;
    if (!buckets.has(key)) buckets.set(key, []);
    buckets.get(key).push(row);
  }
  for (const [key, rows] of buckets) {
    const [kind, variant, coverSize] = key.split('/'), geometry = detailGeometry(kind, +variant, +coverSize);
    const material = envMat(0xffffff, { vertexColors: !!geometry.attributes.color, side: THREE.DoubleSide,
      wash: .08, cool: .12, land: true, rim: 0, ink: 'land',
      soft: kind === 'stone' || kind === 'planter' ? null : { k: kind === 'scrub' ? 'leaf' : 'grass' } });
    const mesh = new THREE.InstancedMesh(geometry, material, rows.length);
    mesh.name = 'habitat/' + key;
    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      position.set(row.x, row.y - .025, row.z);
      rotation.setFromEuler(new THREE.Euler(0, row.ry, 0));
      const spread = row.size * (row.coverSize ? Math.sqrt(row.cover) : 1);
      scale.set(spread, row.height, spread);
      matrix.compose(position, rotation, scale);
      // Shear only the ground plane: blade height stays vertical on fitted sloping patches.
      if (row.coverSize) {
        const e = matrix.elements;
        e[1] = row.groundX * e[0] + row.groundZ * e[2];
        e[9] = row.groundX * e[8] + row.groundZ * e[10];
      }
      mesh.setMatrixAt(i, matrix);
      const growth = row.environment ? seasonalEnvironment({ ...environment, ...row.environment, season }).growth : env.growth;
      const tint = kind === 'scrub' || kind === 'planter' ? [255, 255, 255] : kind === 'stone' ? [row.color[0] * .85, row.color[1] * .82, row.color[2] * .8]
        : [row.color[0] * .72 + (1 - growth) * 28, row.color[1] * .82, row.color[2] * .55];
      color.setRGB(...tint.map(n => Math.min(1, n / 255)), THREE.SRGBColorSpace);
      mesh.setColorAt(i, color);
    }
    mesh.computeBoundingBox(); mesh.computeBoundingSphere();
    mesh.receiveShadow = true;
    group.add(mesh);
  }
  const furnitureKinds = new Map();
  for (const row of furniture) {
    if (!furnitureKinds.has(row.kind)) furnitureKinds.set(row.kind, []);
    furnitureKinds.get(row.kind).push(row);
  }
  for (const [kind, rows] of furnitureKinds) {
    const geometry = Object.hasOwn(WALKWAY_MESHES, kind) ? walkwayGeometry(kind) : compileSceneParts(sceneFurnitureParts(kind));
    const mesh = new THREE.InstancedMesh(geometry, envMat(0xffffff, { vertexColors: true }), rows.length);
    mesh.name = 'habitat/' + kind;
    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      position.set(row.x, row.y, row.z); rotation.setFromEuler(new THREE.Euler(0, row.ry, 0));
      scale.set(1, 1, 1); matrix.compose(position, rotation, scale); mesh.setMatrixAt(i, matrix);
    }
    mesh.computeBoundingBox(); mesh.computeBoundingSphere(); mesh.receiveShadow = true; group.add(mesh);
  }
  const panels = streetPlan.slice(0, low ? HABITAT_SCENE.LOW_STREET_LIMIT : HABITAT_SCENE.STREET_LIMIT);
  const walkway = buildWalkwaySurfaces(group, panels, terrain, { low, pathEdges,
    canDetailAt: (x, z) => x >= bounds.minX && x <= bounds.maxX && z >= bounds.minZ && z <= bounds.maxZ
      && envCodeAt(x, z) === 0 && !isBlocked(x, z) });
  return { patches: panels.length, details: plan.rows.length, aligned: panels.length, bufCells: 0,
    bandDryAt: null, habitats: plan.counts, furniture: furniture.length,
    filledCells: plan.rows.filter(row => row.round === 0).length,
    models: buckets.size + furnitureKinds.size, walkway: { ...walkway, pathAnchors: pathEdges.length },
    recipe: 'evidence-habitat-v2' };
}
