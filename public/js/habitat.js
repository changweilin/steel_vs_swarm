import { HABITATS, HABITAT_SCENE, HABITAT_FILL, HABITAT_COMMUNITIES } from './habitatCatalog.js';
import { forestSeed, pickTreeType, createForestTree, TREE_SPECIES, TREE_VARIANTS } from './forest.js';
import { seasonalEnvironment } from './seasonalEnvironment.js';
import { mulberry32 } from './rng.js';
import { procReliefAt } from './mapgen.js';
import { areaSurfaceRows, pointInProjectedArea, projectedAreaContainsDisk, projectedAreaIntersectsDisk, classifyArea } from './osmAreas.js';
import { areaLayoutAngle } from './osmAreaLayout.js';
import { walkwaySides, walkwayWidth, walkwaySurface, groundWalkway, mappedWalkwayFurniture } from './walkway.js';
import { WALKWAY_FURNITURE, WALKWAY_DETAIL } from './walkwayCatalog.js';

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const fallback = { green: 'meadow', urban: 'built', bare: 'exposed', alpine: 'alpine', cliff: 'cliff', wet: 'marsh' };
const vegetation = { 10: 'woodland', 20: 'scrub', 30: 'meadow', 40: 'cropland', 95: 'woodland', 100: 'meadow' };

/** Resolved geometry/OSM zones outrank observations, including water and slope gates. */
export function habitatAt(sample, zone, tags = {}, depth = null, environment = {}) {
  let key = fallback[zone];
  if (zone === 'water' && Number.isFinite(depth) && depth >= 0 && depth <= HABITAT_SCENE.SHALLOW_DEPTH_M) key = 'shallows';
  if (!key) return null;
  const observed = !!sample?.confidence;
  if (observed && zone === 'green') key = vegetation[sample.code] || key;
  if (zone === 'green' && key === 'meadow' && environment.woodlandF != null) {
    const patch = Number.isFinite(environment.x) && Number.isFinite(environment.z)
      ? habitatPatch(environment.seed || 0, environment.x, environment.z)
      : 0.5;
    if (patch < environment.woodlandF) key = 'woodland';
  }
  if (zone === 'green') {
    if (tags.natural === 'wood' || tags.natural === 'oasis' || tags.landuse === 'forest') key = 'woodland';
    else if (tags.natural === 'scrub' || tags.natural === 'heath') key = 'scrub';
    else if (tags.landuse === 'farmland' || tags.landuse === 'plant_nursery') key = 'cropland';
    else if (tags.landuse === 'orchard') key = 'orchard';
    else if (['vineyard', 'allotments'].includes(tags.landuse)) key = 'cropland';
    else if (tags.natural === 'grassland' || ['grass', 'meadow'].includes(tags.landuse)) key = 'meadow';
    else if (tags.landuse === 'greenhouse_horticulture') key = 'cropland';
    if (tags.landuse === 'animal_keeping' || tags.meadow === 'pasture'
      || tags.power || tags['plant:source'] || tags['generator:source']) key = 'pasture';
  }
  if (zone === 'wet') {
    if (tags.wetland === 'tidalflat' || tags.natural === 'mud' || tags.landuse === 'salt_pond') key = 'mudflat';
    else if (tags.wetland === 'wet_meadow' || tags.basin === 'infiltration') key = 'wetmeadow';
  }
  if (zone === 'bare') {
    if (['beach', 'sand'].includes(tags.natural)) key = 'sand';
    else if (['bare_rock', 'rock', 'scree', 'shingle'].includes(tags.natural)) key = 'rocky';
  }
  const spec = HABITATS[key], rgb = observed && !!(sample.sources & 2);
  const texture = rgb ? sample.texture / 255 : .35;
  const green = rgb ? sample.greenFraction : zone === 'green' ? .65 : .08;
  // RGB brightness varies an established cover's material, never its semantic label.
  const light = rgb ? clamp((sample.brightness - 125) / 255, -.16, .16) : 0;
  const color = spec.color.map((c, i) => clamp(Math.round(c * (1 + light) + (i === 1 ? green * 8 : 0)), 0, 255));
  const density = spec.density * (observed ? 1 : .65) * (.72 + green * .35)
    * (sample?.landform === 5 ? .4 : 1);
  // The neutral season reuses regional cooling without relocating plants in winter or rain.
  const env = seasonalEnvironment({ ...environment, season: 'spring', weather: 'clear' });
  const dry = env.moisture < .32 || (Number.isFinite(env.rainfall) && env.rainfall < 400);
  const waterSupply = env.salinity < .05 && (tags.natural === 'oasis' || environment.waterAvailability === true);
  let community = key === 'woodland' ? dry ? 'drywood' : 'forest' : key === 'scrub' ? 'shrubland' : 'grassland';
  if (['orchard', 'cropland', 'pasture'].includes(key)) community = 'managed';
  else if (zone === 'alpine' || env.temperature < -2) community = 'tundra';
  else if (dry && waterSupply && ['woodland', 'scrub'].includes(key)) community = 'oasis';
  else if (dry && ['exposed', 'sand', 'scrub'].includes(key) && env.temperature > 10) community = 'desert';
  else if (key === 'meadow' && env.temperature > 20 && dry) community = 'savanna';
  const structure = HABITAT_COMMUNITIES[community];
  const moisture = community === 'oasis' ? Math.max(.8, env.moisture) : env.moisture;
  const productivity = clamp(.35 + moisture, .35, 1) * (sample?.landform === 5 ? .6 : 1);
  return { key, zone, color, density: density * structure.ground * productivity, texture, coherence: rgb ? sample.coherence / 255 : 0,
    height: spec.height, canopy: spec.canopy * (observed ? 1 : .65), plant: spec.plant, stone: spec.stone, observed,
    community, structure, environment: { ...environment, moisture,
      waterAvailability: waterSupply, habitatTemperature: env.temperature },
    leafType: ['broadleaved', 'needleleaved', 'mixed'].includes(tags.leaf_type) ? tags.leaf_type : 'unknown',
    landform: sample?.landform || 0, geology: 'unknown' };
}

/** Exact semantic masks retain holes; the same priority ordering serves canopy and ground detail. */
export function createHabitatSampler({ areas = [], evidenceAt, zoneAt, envCodeAt, depthAt, environmentAt }) {
  const grid = new Map(), cell = 64;
  const rows = areaSurfaceRows(areas).filter(r => r.zone && r.outer?.length >= 3)
    .sort((a, b) => b.priority - a.priority || String(a.sourceId).localeCompare(String(b.sourceId)));
  for (const row of rows) {
    row.ry = areaLayoutAngle({ worldPolygons: [{ outer: row.outer }] });
    row.landuse = classifyArea(row.tags).kind;
    const xs = row.outer.map(p => p[0]), zs = row.outer.map(p => p[1]);
    const i0 = Math.floor(Math.min(...xs) / cell), i1 = Math.floor(Math.max(...xs) / cell);
    const j0 = Math.floor(Math.min(...zs) / cell), j1 = Math.floor(Math.max(...zs) / cell);
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
      const key = `${i},${j}`;
      if (!grid.has(key)) grid.set(key, []);
      grid.get(key).push(row);
    }
  }
  const sampleAt = (x, z) => {
    if (!Number.isFinite(x) || !Number.isFinite(z)) return null;
    const ec = envCodeAt(x, z);
    if (![0, 1, 2].includes(ec)) return null;
    const area = grid.get(`${Math.floor(x / cell)},${Math.floor(z / cell)}`)?.find(r => pointInProjectedArea(x, z, r));
    const observation = evidenceAt?.(x, z);
    const zone = ec === 1 ? 'water' : ec === 2 ? 'wet' : zoneAt(x, z, area, observation);
    const environment = environmentAt?.(x, z) || {};
    const dry = environment.climate === 'arid' || environment.moisture < .32
      || (Number.isFinite(environment.rainfall) && environment.rainfall < 400);
    const waterAvailability = dry && ec === 0 && [16, 32].some(d =>
      [[d, 0], [-d, 0], [0, d], [0, -d]].some(([dx, dz]) => envCodeAt(x + dx, z + dz) === 1));
    const habitat = habitatAt(observation, zone, area?.tags, depthAt?.(x, z),
      { ...environment, x, z, waterAvailability: environment.waterAvailability === true || waterAvailability });
    return habitat && { ...habitat, ry: area?.ry || 0, landuse: area?.landuse || 'unknown' };
  };
  sampleAt.contains = ({ x, z, r }) => {
    if (![x, z, r].every(Number.isFinite) || r < 0) return false;
    const candidates = new Set();
    for (let j = Math.floor((z - r) / cell); j <= Math.floor((z + r) / cell); j++) {
      for (let i = Math.floor((x - r) / cell); i <= Math.floor((x + r) / cell); i++) {
        for (const row of grid.get(`${i},${j}`) || []) candidates.add(row);
      }
    }
    const ordered = [...candidates].sort((a, b) => b.priority - a.priority || String(a.sourceId).localeCompare(String(b.sourceId)));
    for (const row of ordered) {
      if (!projectedAreaIntersectsDisk(x, z, r, row)) continue;
      // Reject the entire envelope at semantic boundaries, including tiny holes and higher-priority slivers.
      return projectedAreaContainsDisk(x, z, r, row);
    }
    return true;
  };
  return sampleAt;
}

export function habitatPatch(seed, x, z) {
  return clamp(.5 + procReliefAt(seed ^ 0x484142, x * HABITAT_SCENE.PATCH_WAVE_F,
    z * HABITAT_SCENE.PATCH_WAVE_F), 0, 1);
}

/** One botanical skeleton owns dense-stand rendering, dimensions and trunk collision. */
export function habitatPlant(row) {
  if (!row || ![row.height, row.seed, row.speciesRoll, row.patchSeed].every(Number.isFinite) || row.height <= 0) return null;
  const environment = row.environment || {};
  const type = pickTreeType(environment.latitude, environment.altitude, row.speciesRoll, row.patchSeed,
    { ...environment, temperature: environment.habitatTemperature,
      leafType: row.leafType, plantForms: row.forms });
  if (!type) return null;
  const modelSeed = forestSeed(row.seed % TREE_VARIANTS, 0, 0x4d4f5250);
  const tree = createForestTree(type, modelSeed);
  const s = Math.min(row.height, TREE_SPECIES[type].h) / tree.h;
  return { type, modelSeed, tree, s };
}

/** Canopy spacing follows cover structure; botanical species remain owned by the climate-aware forest seam. */
export function planHabitatCanopy({ bounds, seed = 0, sampleAt, maxPlants, densityScale = 1 }) {
  const rows = [], urban = [], occupied = new Set();
  const { minX, maxX, minZ, maxZ } = bounds || {};
  if (![minX, maxX, minZ, maxZ].every(Number.isFinite) || maxX <= minX || maxZ <= minZ
    || !Number.isInteger(maxPlants) || maxPlants < 0 || typeof sampleAt !== 'function'
    || !Number.isFinite(densityScale) || densityScale < 0 || densityScale > 1) throw new TypeError('Invalid habitat canopy');
  const cell = Math.max(HABITAT_SCENE.CANOPY_CELL_M, Math.sqrt((maxX - minX) * (maxZ - minZ) / HABITAT_SCENE.MAX_CELLS));
  for (let j = Math.floor(minZ / cell); j * cell < maxZ; j++) for (let i = Math.floor(minX / cell); i * cell < maxX; i++) {
    const localSeed = forestSeed(i * cell, j * cell, seed ^ 0x43414e), rnd = mulberry32(localSeed);
    let x = (i + .15 + rnd() * .7) * cell, z = (j + .15 + rnd() * .7) * cell;
    if (x < minX || x > maxX || z < minZ || z > maxZ) continue;
    let habitat = sampleAt(x, z);
    if (!habitat) continue;
    if (habitat.key === 'orchard') {
      const c = Math.cos(habitat.ry || 0), s = Math.sin(habitat.ry || 0);
      const u = Math.round((x * c - z * s) / cell) * cell, v = Math.round((x * s + z * c) / cell) * cell;
      x = u * c + v * s; z = -u * s + v * c;
      habitat = sampleAt(x, z);
      if (x < minX || x > maxX || z < minZ || z > maxZ || habitat?.key !== 'orchard') continue;
    }
    const key = `${Math.round(x * 16)},${Math.round(z * 16)}`;
    if (occupied.has(key)) continue;
    occupied.add(key);
    if (habitat.key === 'built') { urban.push({ x, z, rank: rnd() }); continue; }
    const patch = habitatPatch(seed, x, z), structure = habitat.structure || HABITAT_COMMUNITIES.forest;
    const clustering = habitat.key === 'orchard' ? 1 : .45 + patch * 1.1;
    if (rnd() > habitat.canopy * structure.woody * densityScale * clustering) continue;
    const shrub = habitat.key === 'scrub' || habitat.zone === 'bare' || habitat.key === 'alpine';
    const recruit = rnd() < structure.recruits * (1.4 - patch);
    const age = habitat.key === 'orchard' ? 'mature' : recruit ? 'juvenile' : rnd() < .12 ? 'old' : 'mature';
    const height = (structure.height[0] + rnd() * (structure.height[1] - structure.height[0]))
      * (age === 'juvenile' ? .25 + rnd() * .3 : age === 'old' ? 1.15 : 1);
    const patchSeed = forestSeed(Math.floor(x / HABITAT_SCENE.COMMUNITY_CELL_M),
      Math.floor(z / HABITAT_SCENE.COMMUNITY_CELL_M), seed ^ 0x53504543);
    const speciesRoll = rnd() < structure.dominance ? mulberry32(patchSeed)() : rnd();
    rows.push({ x, z, seed: localSeed, shrub, leafType: habitat.leafType,
      height, age, speciesRoll, patchSeed, forms: structure.forms, environment: habitat.environment,
      scale: shrub ? .1 + rnd() * .13 : habitat.key === 'orchard' ? .45 + rnd() * .1 : .65 + rnd() * .7, rank: rnd() });
  }
  rows.sort((a, b) => a.rank - b.rank || a.seed - b.seed);
  rows.length = Math.min(rows.length, maxPlants);
  urban.sort((a, b) => a.rank - b.rank);
  return { rows, urban: urban.slice(0, 500).map(p => [p.x, p.z]) };
}

/** Coverage first, then bounded density; disjoint slots keep full geometry envelopes separated. */
export function planHabitatDetails({ bounds, seed = 0, sampleAt, heightAt, fits, maxDetails = HABITAT_SCENE.DETAIL_LIMIT }) {
  const rows = [], counts = {};
  const { minX, maxX, minZ, maxZ } = bounds || {};
  if (![minX, maxX, minZ, maxZ].every(Number.isFinite) || maxX <= minX || maxZ <= minZ
    || !Number.isInteger(maxDetails) || maxDetails < 0 || typeof sampleAt !== 'function'
    || typeof heightAt !== 'function' || typeof fits !== 'function') throw new TypeError('Invalid habitat plan');
  // Fix the lattice to the normal budget so large maps retain coverage and low-power survivors stay identical.
  const coverageCells = Math.min(HABITAT_SCENE.MAX_CELLS, Math.floor(HABITAT_SCENE.DETAIL_LIMIT * HABITAT_SCENE.COVERAGE_BUDGET_F));
  const cell = Math.max(HABITAT_SCENE.CELL_M, Math.sqrt((maxX - minX) * (maxZ - minZ) / coverageCells));
  if (!maxDetails) return { rows, counts, cell };
  for (let j = Math.floor(minZ / cell); j * cell < maxZ; j++) {
    for (let i = Math.floor(minX / cell); i * cell < maxX; i++) {
      const available = [];
      const slot = cell / 2;
      for (let k = 0; k < 4; k++) {
        const sx = i * cell + (k % 2) * slot, sz = j * cell + Math.floor(k / 2) * slot;
        const localSeed = forestSeed(sx, sz, seed ^ 0x494e46), rnd = mulberry32(localSeed);
        for (let attempt = 0; attempt < HABITAT_SCENE.INFILL_TRIES; attempt++) {
          const x = sx + (.38 + rnd() * .24) * slot, z = sz + (.38 + rnd() * .24) * slot;
          if (x < minX || x > maxX || z < minZ || z > maxZ) continue;
          const habitat = sampleAt(x, z), fill = HABITAT_FILL[habitat?.key];
          if (!fill || !habitat.plant) continue;
          const patch = habitatPatch(seed, x, z);
          const plantWeight = habitat.density * (.35 + patch), stoneWeight = habitat.stone * (.25 + habitat.texture);
          let kind = rnd() * (plantWeight + stoneWeight) < plantWeight ? habitat.plant : 'stone';
          // One potential planter per furniture-scale cell; industrial equipment remains owned by OSM layouts.
          if (habitat.key === 'built' && ['unknown', 'residential', 'commercial', 'park', 'civic'].includes(habitat.landuse || 'unknown')) {
            const stride = Math.max(1, Math.ceil(HABITAT_SCENE.FURNITURE_STEP_M / cell));
            const macro = mulberry32(forestSeed(Math.floor(i / stride), Math.floor(j / stride), seed ^ 0x504c4e));
            if (((i % stride + stride) % stride) === Math.floor(macro() * stride)
              && ((j % stride + stride) % stride) === Math.floor(macro() * stride) && k === 0) kind = 'planter';
          }
          const radiusScale = kind === 'scrub' ? .8 : kind === 'stone' ? .5 : .6;
          const room = Math.min(x - sx, sx + slot - x, z - sz, sz + slot - z) - HABITAT_SCENE.DETAIL_GAP_M / 2;
          const carpet = kind === 'grass' || kind === 'understory';
          const size = Math.min(carpet ? 16 : 1.2 + rnd() * .6, room / radiusScale), r = radiusScale * size;
          if (!(size >= .7) || x - r < minX || x + r > maxX || z - r < minZ || z + r > maxZ
            || !fits({ x, z, r }, habitat.zone)) continue;
          if ([[0, 0], [-r, -r], [r, -r], [r, r], [-r, r]]
            .some(([dx, dz]) => sampleAt(x + dx, z + dz)?.key !== habitat.key)) continue;
          const y = heightAt(x, z);
          if (!Number.isFinite(y)) continue;
          const h = kind === 'stone' ? .12 + rnd() * .28 : kind === 'planter' ? .9
            : habitat.height * (carpet ? .7 + rnd() * .6 : size);
          let groundX = 0, groundZ = 0;
          if (carpet) {
            groundX = (heightAt(x + r, z) - heightAt(x - r, z)) / (2 * r);
            groundZ = (heightAt(x, z + r) - heightAt(x, z - r)) / (2 * r);
            if (![groundX, groundZ].every(Number.isFinite) || [[-r, -r], [r, -r], [r, r], [-r, r]]
              .some(([dx, dz]) => {
                const ground = heightAt(x + dx, z + dz);
                return !Number.isFinite(ground) || Math.abs(ground - y - groundX * dx - groundZ * dz) > h * .35;
              })) continue;
          }
          const ry = rnd() * Math.PI * 2;
          available.push({ kind, x, y, z, r, height: h, size, ry: kind === 'crop' ? habitat.ry || 0 : ry,
            groundX, groundZ, environment: habitat.environment,
            coverSize: carpet ? size <= 2 ? 2 : size <= 6 ? 6 : 16 : 0,
            cover: clamp(habitat.density * (.65 + patch * .5), .04, 1),
            variant: Math.floor(rnd() * HABITAT_SCENE.VARIANTS), seed: localSeed, habitat: habitat.key,
            color: habitat.color, rank: rnd(), target: Math.min(fill[1], fill[0] + Math.floor(patch * (fill[1] - fill[0] + 1))) });
          break;
        }
      }
      available.sort((a, b) => a.rank - b.rank || a.seed - b.seed);
      for (let k = 0; k < available.length; k++) {
        const { target, ...row } = available[k];
        if (k >= target) continue;
        rows.push({ ...row, round: k });
      }
    }
  }
  // Complete the first coverage round over the whole map before spending the budget on denser cells.
  rows.sort((a, b) => a.round - b.round || a.rank - b.rank || a.seed - b.seed || a.x - b.x || a.z - b.z);
  rows.length = Math.min(rows.length, maxDetails);
  for (const row of rows) counts[row.habitat] = (counts[row.habitat] || 0) + 1;
  return { rows, counts, cell };
}

/** OSM direction is measured from roads; directional RGB contrast supplies no road bearing. */
export function planHabitatStreets({ segments = [], seed = 0, sampleAt, heightAt, fits,
  fitsPanel, realScale = .5, maxPanels = HABITAT_SCENE.STREET_LIMIT }) {
  const rows = [], keys = new Set();
  if (!Number.isInteger(maxPanels) || maxPanels < 0 || typeof sampleAt !== 'function'
    || typeof heightAt !== 'function' || typeof fits !== 'function') throw new TypeError('Invalid habitat streets');
  for (const seg of segments) {
    const { a, b, hw } = seg;
    if (!Array.isArray(a) || !Array.isArray(b) || a.length !== 2 || b.length !== 2
      || ![...a, ...b, hw].every(Number.isFinite) || !(hw > 0)) continue;
    const dx = b[0] - a[0], dz = b[1] - a[1], len = Math.hypot(dx, dz);
    if (len < 1) continue;
    const tx = dx / len, tz = dz / len, nx = -tz, nz = tx;
    const count = Math.ceil(len / HABITAT_SCENE.STREET_STEP_M), step = len / count;
    const materialSeed = seg.appearanceSeed ?? forestSeed((a[0] + b[0]) / 2, (a[1] + b[1]) / 2, seed);
    for (let k = 0; k < count; k++) for (const side of [-1, 1]) {
      const width = walkwayWidth(seg.tags, side, HABITAT_SCENE.STREET_WIDTH_M, realScale);
      if (width == null) continue;
      const offset = side * (hw + width / 2 + .25);
      const x = a[0] + tx * (k + .5) * step + nx * offset;
      const z = a[1] + tz * (k + .5) * step + nz * offset;
      const habitat = sampleAt(x, z);
      if (!habitat || !walkwaySides(seg.tags, habitat).includes(side) || ['water', 'wet', 'cliff'].includes(habitat.zone)) continue;
      const key = `${Math.round(x * 2)},${Math.round(z * 2)}`;
      if (keys.has(key)) continue;
      const corners = [];
      for (const [along, across] of [[-1, -1], [-1, 1], [1, 1], [1, -1]]) {
        const px = x + along * tx * step / 2 + across * nx * width / 2;
        const pz = z + along * tz * step / 2 + across * nz * width / 2;
        corners.push([px, heightAt(px, pz), pz]);
      }
      // A panel fits entirely; missing heights, holes, other carriageways and slope breaks omit it.
      let valid = true;
      const probeHeights = [];
      for (let i = 0; i <= Math.ceil(step / WALKWAY_DETAIL.PANEL_PROBE_M) && valid; i++) {
        for (let j = 0; j <= Math.ceil(width / WALKWAY_DETAIL.PANEL_PROBE_M); j++) {
          const along = (i / Math.ceil(step / WALKWAY_DETAIL.PANEL_PROBE_M) - .5) * step;
          const across = (j / Math.ceil(width / WALKWAY_DETAIL.PANEL_PROBE_M) - .5) * width;
          const px = x + along * tx + across * nx, pz = z + along * tz + across * nz;
          const y = heightAt(px, pz);
          if (sampleAt(px, pz)?.key !== habitat.key || !fits({ x: px, z: pz, r: .05 }, habitat.zone)
            || !Number.isFinite(y)) { valid = false; break; }
          probeHeights.push(y);
        }
      }
      const foot = { x, z, hw: step / 2, hd: width / 2, ry: Math.atan2(dz, dx), r: Math.hypot(step / 2, width / 2) };
      if (!valid || corners.some(p => !p.every(Number.isFinite)) || fitsPanel && !fitsPanel(foot)) continue;
      const heights = [...corners.map(p => p[1]), ...probeHeights];
      if (Math.max(...heights) - Math.min(...heights) > step * .20) continue;
      keys.add(key);
      rows.push({ ...foot, corners, side, width, tags: seg.tags || {}, zone: habitat.zone, habitat: habitat.key,
        surface: walkwaySurface(seg.tags, habitat, materialSeed, side),
        source: seg.tags?.sidewalk || seg.tags?.['sidewalk:both'] || seg.tags?.[side === -1 ? 'sidewalk:left' : 'sidewalk:right']
          ? 'osm-sidewalk' : 'osm-road-cover-inference',
        seed: forestSeed(x, z, seed) });
    }
  }
  rows.sort((a, b) => a.seed - b.seed || a.x - b.x || a.z - b.z);
  rows.length = Math.min(rows.length, maxPanels);
  return rows;
}

/** post: anchors follow mapped dry paths; no inferred paths connect unverified satellite pixels. */
export function planHabitatPathEdges({ segments = [], seed = 0, sampleAt, heightAt }) {
  const rows = [], keys = new Set();
  for (const { a, b, hw, tags = {} } of segments) {
    if (!groundWalkway(tags) || !Array.isArray(a) || !Array.isArray(b) || a.length !== 2 || b.length !== 2
      || ![...a, ...b, hw].every(Number.isFinite) || !(hw > 0)) continue;
    const dx = b[0] - a[0], dz = b[1] - a[1], len = Math.hypot(dx, dz);
    if (len < 1) continue;
    const count = Math.ceil(len / HABITAT_SCENE.FURNITURE_STEP_M);
    for (let k = 0; k < count; k++) {
      const x = a[0] + dx * (k + .5) / count, z = a[1] + dz * (k + .5) / count;
      const habitat = sampleAt(x, z), key = `${Math.round(x)},${Math.round(z)}`;
      if (!habitat || ['water', 'wet', 'cliff'].includes(habitat.zone) || !Number.isFinite(heightAt(x, z)) || keys.has(key)) continue;
      keys.add(key);
      rows.push({ x, z, ry: Math.atan2(dz, dx), side: 1, width: hw * 2, length: len / count, path: true, tags,
        seed: forestSeed(x, z, seed), zone: habitat.zone, habitat: habitat.key,
        surface: walkwaySurface(tags, habitat, forestSeed(a[0], a[1], seed)) });
    }
  }
  rows.sort((a, b) => a.seed - b.seed || a.x - b.x || a.z - b.z);
  return rows.slice(0, WALKWAY_DETAIL.PATH_ANCHOR_LIMIT);
}

/** post: mapped points take precedence; complete dry envelopes stay outside the pedestrian through corridor. */
export function planHabitatFurniture({ panels = [], points = [], seed = 0, fits, heightAt, sampleAt,
  maxObjects = HABITAT_SCENE.FURNITURE_LIMIT }) {
  if (!Number.isInteger(maxObjects) || maxObjects < 0 || typeof fits !== 'function'
    || typeof heightAt !== 'function' || typeof sampleAt !== 'function') throw new TypeError('Invalid street furniture');
  const rows = [], cells = new Map();
  const accept = (kind, x, z, ry, localSeed, source, rank) => {
    const r = WALKWAY_FURNITURE[kind]?.r, habitat = sampleAt(x, z);
    if (!r || !habitat || ['water', 'wet', 'cliff'].includes(habitat.zone) || !fits({ x, z, r }, habitat.zone)) return;
    const heights = [];
    for (let i = 0; i < 9; i++) {
      const angle = i / 8 * Math.PI * 2, px = x + (i ? Math.cos(angle) * r : 0), pz = z + (i ? Math.sin(angle) * r : 0);
      if (sampleAt(px, pz)?.key !== habitat.key) return;
      heights.push(heightAt(px, pz));
    }
    if (!heights.every(Number.isFinite) || Math.max(...heights) - Math.min(...heights) > r * WALKWAY_DETAIL.MAX_SLOPE_F) return;
    if (rows.some(row => Math.hypot(row.x - x, row.z - z) < row.r + r + .5)) return;
    rows.push({ kind, x, y: Math.min(...heights), z, r, ry, seed: localSeed, rank, source });
  };
  const mapped = points.map(p => ({ ...p, kind: mappedWalkwayFurniture(p.tags) }))
    .filter(p => p.kind && [p.x, p.z].every(Number.isFinite))
    .sort((a, b) => a.x - b.x || a.z - b.z || a.kind.localeCompare(b.kind));
  for (const point of mapped) {
    const panel = panels.filter(p => Math.hypot(p.x - point.x, p.z - point.z) <= WALKWAY_DETAIL.MAPPED_NEAR_M)
      .sort((a, b) => Math.hypot(a.x - point.x, a.z - point.z) - Math.hypot(b.x - point.x, b.z - point.z) || a.seed - b.seed)[0];
    if (!panel) continue;
    accept(point.kind, point.x, point.z, Math.PI / 2 - panel.ry, forestSeed(point.x, point.z, seed), 'osm-point', -1);
  }
  for (const panel of panels) {
    const key = `${Math.floor(panel.x / HABITAT_SCENE.FURNITURE_STEP_M)},${Math.floor(panel.z / HABITAT_SCENE.FURNITURE_STEP_M)}`;
    if (!cells.has(key) || panel.seed < cells.get(key).seed) cells.set(key, panel);
  }
  for (const panel of [...cells.values()].sort((a, b) => a.seed - b.seed || a.x - b.x || a.z - b.z)) {
    const localSeed = forestSeed(panel.x, panel.z, seed ^ 0x535452), rnd = mulberry32(localSeed);
    const context = panel.habitat === 'built' || !panel.habitat ? 'urban'
      : ['meadow', 'pasture', 'orchard'].includes(panel.habitat) ? 'park' : 'trail';
    const choices = Object.entries(WALKWAY_FURNITURE).filter(([, spec]) => spec[context]).map(([kind]) => kind);
    const kind = choices[Math.floor(rnd() * choices.length)], r = WALKWAY_FURNITURE[kind].r;
    const side = panel.path ? rnd() < .5 ? -1 : 1 : panel.side || 1;
    const offset = side * ((panel.width || HABITAT_SCENE.STREET_WIDTH_M) / 2 + r + WALKWAY_DETAIL.FURNITURE_CLEAR_M);
    const x = panel.x - Math.sin(panel.ry) * offset, z = panel.z + Math.cos(panel.ry) * offset;
    accept(kind, x, z, Math.PI / 2 - panel.ry, localSeed, 'inferred-dressing', rnd());
  }
  rows.sort((a, b) => a.rank - b.rank || a.seed - b.seed);
  return rows.slice(0, maxObjects);
}

/** Clip into the shipped a,c,b / b,c,d terrain faces so no panel chord can cut through a slope. */
export function drapeHabitatPanel(panel, terrain, lift = HABITAT_SCENE.STREET_LIFT_M) {
  const n = Math.round(terrain.worldW / terrain.gridM);
  if (!(n > 0) || !Number.isFinite(n) || !Number.isFinite(terrain.worldH) || terrain.worldH <= 0) return [];
  const dx = terrain.worldW / n, dz = terrain.worldH / n;
  const ring = panel.corners.map(p => [p[0], p[2]]), xs = ring.map(p => p[0]), zs = ring.map(p => p[1]);
  const i0 = Math.max(0, Math.floor((Math.min(...xs) - terrain.minX) / dx));
  const i1 = Math.min(n - 1, Math.floor((Math.max(...xs) - terrain.minX) / dx));
  const j0 = Math.max(0, Math.floor((Math.min(...zs) - terrain.minZ) / dz));
  const j1 = Math.min(n - 1, Math.floor((Math.max(...zs) - terrain.minZ) / dz));
  const vertices = [];
  for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
    const a = [terrain.minX + i * dx, terrain.minZ + j * dz];
    const b = [a[0] + dx, a[1]], c = [a[0], a[1] + dz], d = [b[0], c[1]];
    for (const triangle of [[a, c, b], [b, c, d]]) {
      let polygon = ring;
      for (let e = 0; e < 3 && polygon.length; e++) {
        const p = triangle[e], q = triangle[(e + 1) % 3];
        const distance = v => (q[0] - p[0]) * (v[1] - p[1]) - (q[1] - p[1]) * (v[0] - p[0]);
        const clipped = [];
        for (let k = 0; k < polygon.length; k++) {
          const u = polygon[k], v = polygon[(k + 1) % polygon.length], du = distance(u), dv = distance(v);
          if (du <= 0) clipped.push(u);
          if ((du <= 0) !== (dv <= 0)) {
            const t = du / (du - dv);
            clipped.push([u[0] + (v[0] - u[0]) * t, u[1] + (v[1] - u[1]) * t]);
          }
        }
        polygon = clipped;
      }
      for (let k = 1; k + 1 < polygon.length; k++) {
        const tri = [polygon[0], polygon[k], polygon[k + 1]];
        const area = (tri[1][0] - tri[0][0]) * (tri[2][1] - tri[0][1]) - (tri[1][1] - tri[0][1]) * (tri[2][0] - tri[0][0]);
        if (Math.abs(area) < 1e-8) continue;
        const points = tri.map(([x, z]) => [x, terrain.heightAt(x, z) + lift, z]);
        if (points.every(p => p.every(Number.isFinite))) vertices.push(...points.flat());
      }
    }
  }
  return vertices;
}
