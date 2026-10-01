import { HABITATS, HABITAT_SCENE } from './habitatCatalog.js';
import { forestSeed } from './forest.js';
import { mulberry32 } from './rng.js';
import { procReliefAt } from './mapgen.js';
import { areaSurfaceRows, pointInProjectedArea } from './osmAreas.js';

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const fallback = { green: 'meadow', urban: 'built', bare: 'exposed', alpine: 'alpine', cliff: 'cliff' };
const vegetation = { 10: 'woodland', 20: 'scrub', 30: 'meadow', 40: 'cropland', 95: 'woodland', 100: 'meadow' };

/** Resolved geometry/OSM zones outrank observations, including water and slope gates. */
export function habitatAt(sample, zone, tags = {}) {
  let key = fallback[zone];
  if (!key) return null;
  const observed = !!sample?.confidence;
  if (observed && zone === 'green') key = vegetation[sample.code] || key;
  if (zone === 'green') {
    if (tags.natural === 'wood' || tags.landuse === 'forest') key = 'woodland';
    else if (tags.natural === 'scrub' || tags.natural === 'heath') key = 'scrub';
    else if (tags.landuse === 'farmland' || tags.landuse === 'plant_nursery') key = 'cropland';
    else if (tags.natural === 'grassland' || ['grass', 'meadow'].includes(tags.landuse)) key = 'meadow';
  }
  const spec = HABITATS[key], rgb = observed && !!(sample.sources & 2);
  const texture = rgb ? sample.texture / 255 : .35;
  const green = rgb ? sample.greenFraction : zone === 'green' ? .65 : .08;
  // RGB brightness varies an established cover's material, never its semantic label.
  const light = rgb ? clamp((sample.brightness - 125) / 255, -.16, .16) : 0;
  const color = spec.color.map((c, i) => clamp(Math.round(c * (1 + light) + (i === 1 ? green * 8 : 0)), 0, 255));
  const density = spec.density * (observed ? 1 : .65) * (.72 + green * .35)
    * (sample?.landform === 5 ? .4 : 1);
  return { key, zone, color, density, texture, coherence: rgb ? sample.coherence / 255 : 0,
    height: spec.height, canopy: spec.canopy * (observed ? 1 : .65), plant: spec.plant, stone: spec.stone, observed };
}

/** Exact semantic masks retain holes; the same priority ordering serves canopy and ground detail. */
export function createHabitatSampler({ areas = [], evidenceAt, zoneAt, envCodeAt }) {
  const grid = new Map(), cell = 64;
  const rows = areaSurfaceRows(areas).filter(r => r.zone && r.outer?.length >= 3)
    .sort((a, b) => b.priority - a.priority || String(a.sourceId).localeCompare(String(b.sourceId)));
  for (const row of rows) {
    const xs = row.outer.map(p => p[0]), zs = row.outer.map(p => p[1]);
    const i0 = Math.floor(Math.min(...xs) / cell), i1 = Math.floor(Math.max(...xs) / cell);
    const j0 = Math.floor(Math.min(...zs) / cell), j1 = Math.floor(Math.max(...zs) / cell);
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
      const key = `${i},${j}`;
      if (!grid.has(key)) grid.set(key, []);
      grid.get(key).push(row);
    }
  }
  return (x, z) => {
    if (!Number.isFinite(x) || !Number.isFinite(z) || envCodeAt(x, z) !== 0) return null;
    const area = grid.get(`${Math.floor(x / cell)},${Math.floor(z / cell)}`)?.find(r => pointInProjectedArea(x, z, r));
    const observation = evidenceAt?.(x, z);
    return habitatAt(observation, zoneAt(x, z, area, observation), area?.tags);
  };
}

export function habitatPatch(seed, x, z) {
  return clamp(.5 + procReliefAt(seed ^ 0x484142, x * HABITAT_SCENE.PATCH_WAVE_F,
    z * HABITAT_SCENE.PATCH_WAVE_F), 0, 1);
}

/** Canopy spacing follows cover structure; botanical species remain owned by the climate-aware forest seam. */
export function planHabitatCanopy({ bounds, seed = 0, sampleAt, maxPlants }) {
  const rows = [], urban = [];
  const { minX, maxX, minZ, maxZ } = bounds || {};
  if (![minX, maxX, minZ, maxZ].every(Number.isFinite) || maxX <= minX || maxZ <= minZ
    || !Number.isInteger(maxPlants) || maxPlants < 0 || typeof sampleAt !== 'function') throw new TypeError('Invalid habitat canopy');
  const cell = Math.max(HABITAT_SCENE.CANOPY_CELL_M, Math.sqrt((maxX - minX) * (maxZ - minZ) / HABITAT_SCENE.MAX_CELLS));
  for (let j = Math.floor(minZ / cell); j * cell < maxZ; j++) for (let i = Math.floor(minX / cell); i * cell < maxX; i++) {
    const localSeed = forestSeed(i * cell, j * cell, seed ^ 0x43414e), rnd = mulberry32(localSeed);
    const x = (i + .15 + rnd() * .7) * cell, z = (j + .15 + rnd() * .7) * cell;
    if (x < minX || x > maxX || z < minZ || z > maxZ) continue;
    const habitat = sampleAt(x, z);
    if (!habitat) continue;
    if (habitat.key === 'built') { urban.push({ x, z, rank: rnd() }); continue; }
    const patch = habitatPatch(seed, x, z);
    if (rnd() > habitat.canopy * (.2 + patch * 1.4)) continue;
    const shrub = habitat.key === 'scrub' || habitat.key === 'exposed' || habitat.key === 'alpine';
    rows.push({ x, z, seed: localSeed, shrub, scale: shrub ? .1 + rnd() * .13 : .65 + rnd() * .7, rank: rnd() });
  }
  rows.sort((a, b) => a.rank - b.rank || a.seed - b.seed);
  rows.length = Math.min(rows.length, maxPlants);
  urban.sort((a, b) => a.rank - b.rank);
  return { rows, urban: urban.slice(0, 500).map(p => [p.x, p.z]) };
}

/** Pure plan; every candidate owns its random stream and survives budget changes at the same position. */
export function planHabitatDetails({ bounds, seed = 0, sampleAt, heightAt, fits, maxDetails = HABITAT_SCENE.DETAIL_LIMIT }) {
  const rows = [], counts = {};
  const { minX, maxX, minZ, maxZ } = bounds || {};
  if (![minX, maxX, minZ, maxZ].every(Number.isFinite) || maxX <= minX || maxZ <= minZ
    || !Number.isInteger(maxDetails) || maxDetails < 0 || typeof sampleAt !== 'function'
    || typeof heightAt !== 'function' || typeof fits !== 'function') throw new TypeError('Invalid habitat plan');
  const cell = Math.max(HABITAT_SCENE.CELL_M, Math.sqrt((maxX - minX) * (maxZ - minZ) / HABITAT_SCENE.MAX_CELLS));
  for (let j = Math.floor(minZ / cell); j * cell < maxZ; j++) {
    for (let i = Math.floor(minX / cell); i * cell < maxX; i++) {
      const localSeed = forestSeed(i * cell, j * cell, seed ^ 0x484142), rnd = mulberry32(localSeed);
      const x = (i + .15 + rnd() * .7) * cell, z = (j + .15 + rnd() * .7) * cell;
      if (x < minX || x > maxX || z < minZ || z > maxZ) continue;
      const habitat = sampleAt(x, z);
      if (!habitat || habitat.zone === 'cliff') continue;
      const patch = habitatPatch(seed, x, z), roll = rnd();
      let kind;
      if (roll < habitat.density * (.15 + patch * 1.4)) kind = habitat.plant;
      else if (rnd() < habitat.stone * (.25 + habitat.texture)) kind = 'stone';
      if (!kind) continue;
      const size = .7 + rnd() * .8;
      const h = kind === 'stone' ? .08 + rnd() * .24 : habitat.height * size;
      const r = kind === 'scrub' ? .8 * size : kind === 'stone' ? .5 * size : .6 * size;
      if (!fits({ x, z, r }, habitat.zone)) continue;
      const y = heightAt(x, z);
      if (!Number.isFinite(y)) continue;
      rows.push({ kind, x, y, z, r, height: h, size, ry: rnd() * Math.PI * 2,
        variant: Math.floor(rnd() * HABITAT_SCENE.VARIANTS), seed: localSeed, habitat: habitat.key,
        color: habitat.color, rank: rnd() });
    }
  }
  // Rank across the whole map before truncation; row-order truncation empties one side of the battlefield.
  rows.sort((a, b) => a.rank - b.rank || a.seed - b.seed || a.x - b.x || a.z - b.z);
  rows.length = Math.min(rows.length, maxDetails);
  for (const row of rows) counts[row.habitat] = (counts[row.habitat] || 0) + 1;
  return { rows, counts, cell };
}

/** OSM direction is measured from roads; directional RGB contrast supplies no road bearing. */
export function planHabitatStreets({ segments = [], seed = 0, sampleAt, heightAt, fits,
  maxPanels = HABITAT_SCENE.STREET_LIMIT }) {
  const rows = [], keys = new Set();
  if (!Number.isInteger(maxPanels) || maxPanels < 0 || typeof sampleAt !== 'function'
    || typeof heightAt !== 'function' || typeof fits !== 'function') throw new TypeError('Invalid habitat streets');
  for (const seg of segments) {
    const { a, b, hw } = seg;
    if (!Array.isArray(a) || !Array.isArray(b) || ![...a, ...b, hw].every(Number.isFinite) || !(hw > 0)) continue;
    const dx = b[0] - a[0], dz = b[1] - a[1], len = Math.hypot(dx, dz);
    if (len < 1) continue;
    const tx = dx / len, tz = dz / len, nx = -tz, nz = tx;
    const count = Math.ceil(len / HABITAT_SCENE.STREET_STEP_M), step = len / count;
    for (let k = 0; k < count; k++) for (const side of [-1, 1]) {
      const offset = side * (hw + HABITAT_SCENE.STREET_WIDTH_M / 2 + .25);
      const x = a[0] + tx * (k + .5) * step + nx * offset;
      const z = a[1] + tz * (k + .5) * step + nz * offset;
      const habitat = sampleAt(x, z);
      if (habitat?.key !== 'built') continue;
      const key = `${Math.round(x * 2)},${Math.round(z * 2)}`;
      if (keys.has(key)) continue;
      const corners = [];
      for (const [along, across] of [[-1, -1], [-1, 1], [1, 1], [1, -1]]) {
        const px = x + along * tx * step / 2 + across * nx * HABITAT_SCENE.STREET_WIDTH_M / 2;
        const pz = z + along * tz * step / 2 + across * nz * HABITAT_SCENE.STREET_WIDTH_M / 2;
        corners.push([px, heightAt(px, pz), pz]);
      }
      // A panel fits entirely; missing heights, holes, other carriageways and slope breaks omit it.
      if (corners.some(p => !p.every(Number.isFinite) || sampleAt(p[0], p[2])?.key !== 'built'
        || !fits({ x: p[0], z: p[2], r: .05 }, 'urban'))) continue;
      if (!fits({ x, z, r: .05 }, 'urban')) continue;
      const heights = corners.map(p => p[1]);
      if (Math.max(...heights) - Math.min(...heights) > step * .20) continue;
      keys.add(key);
      rows.push({ x, z, corners, seed: forestSeed(x, z, seed), ry: Math.atan2(dz, dx) });
    }
  }
  rows.sort((a, b) => a.seed - b.seed || a.x - b.x || a.z - b.z);
  rows.length = Math.min(rows.length, maxPanels);
  return rows;
}

/** Clip into the shipped a,c,b / b,c,d terrain faces so no panel chord can cut through a slope. */
export function drapeHabitatPanel(panel, terrain) {
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
        const points = tri.map(([x, z]) => [x, terrain.heightAt(x, z) + HABITAT_SCENE.STREET_LIFT_M, z]);
        if (points.every(p => p.every(Number.isFinite))) vertices.push(...points.flat());
      }
    }
  }
  return vertices;
}
