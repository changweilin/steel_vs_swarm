import { battleRect, llToXZ, xzToLL, WATER } from './data.js';
import { procReliefAt, PROC_RELIEF_WAVE_M } from './mapgen.js';
import { mulberry32 } from './rng.js';
import { distanceToSegment } from './architectureStyles.js';
import { parseOsmFeatureElements } from './osmQuery.js';
import { validRandomMap } from './randomMapRules.js';

const models = new Map();
const COLORS = { urban: [112, 108, 99], green: [48, 87, 48], bare: [135, 115, 84],
  water: [38, 80, 119], wet: [53, 85, 71] };
const LAND_TAGS = { urban: { landuse: 'residential' }, green: { natural: 'wood' },
  bare: { natural: 'bare_rock' }, water: { natural: 'water', water: 'lake' }, wet: { natural: 'wetland' } };
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

export function randomMapModel(cfg) {
  if (!validRandomMap(cfg)) throw new RangeError('Invalid procedural map recipe');
  const key = JSON.stringify([cfg.gen, cfg.motherLanes, cfg.sizeM]);
  if (models.has(key)) return models.get(key);
  const bounds = battleRect({ ...cfg, lanes: cfg.motherLanes });
  const p = cfg.gen.layers.surface;
  const nx = Math.max(2, Math.ceil((bounds.maxX - bounds.minX) / p.blockM));
  const nz = Math.max(2, Math.ceil((bounds.maxZ - bounds.minZ) / p.blockM));
  const dx = (bounds.maxX - bounds.minX) / nx, dz = (bounds.maxZ - bounds.minZ) / nz;
  const nodes = Array.from({ length: nz + 1 }, (_, j) => Array.from({ length: nx + 1 }, (_, i) => {
    const jitter = procReliefAt(p.seed ^ 0x4a4954, i * 97, j * 97) * p.gridJitter;
    return [bounds.minX + i * dx + (i > 0 && i < nx ? jitter * dx : 0),
      bounds.minZ + j * dz + (j > 0 && j < nz ? jitter * dz : 0)];
  }));
  const toPoint = point => { const [lat, lon] = xzToLL(...point, cfg.center); return { lat, lon }; };
  const roads = cfg.motherLanes.map(lane => ({ tags: { highway: 'primary', lanes: String(p.streetLanes), source: 'procedural' },
    geometry: lane.map(([lat, lon]) => ({ lat, lon })) }));
  for (let j = 0; j <= nz; j++) roads.push({ tags: { highway: 'residential', lanes: String(p.streetLanes), source: 'procedural' }, geometry: nodes[j].map(toPoint) });
  for (let i = 0; i <= nx; i++) roads.push({ tags: { highway: 'residential', lanes: String(p.streetLanes), source: 'procedural' }, geometry: nodes.map(row => toPoint(row[i])) });
  // Three tactical roads and the street lattice share explicit junctions at the bases.
  for (const base of Object.values(cfg.bases)) {
    const pt = llToXZ(...base, cfg.center);
    let nearest = nodes[0][0], best = Infinity;
    for (const row of nodes) for (const node of row) {
      const distance = Math.hypot(node[0] - pt[0], node[1] - pt[1]);
      if (distance < best) { best = distance; nearest = node; }
    }
    roads.push({ tags: { highway: 'residential', lanes: String(p.streetLanes), source: 'procedural' },
      geometry: [{ lat: base[0], lon: base[1] }, toPoint(nearest)] });
  }
  const cells = [];
  for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) {
    cells.push({ i, j, x: bounds.minX + (i + .5) * dx, z: bounds.minZ + (j + .5) * dz,
      rank: procReliefAt(p.seed ^ 0x434f5645, i * 65, j * 65), zone: 'green' });
  }
  const ordered = [...cells].sort((a, b) => a.rank - b.rank || a.j - b.j || a.i - b.i);
  let cursor = 0;
  for (const zone of ['water', 'wet', 'urban', 'bare']) {
    const n = Math.floor(ordered.length * (cfg.venue.mix[zone] || 0));
    for (let k = 0; k < n && cursor < ordered.length; k++) ordered[cursor++].zone = zone;
  }
  const elements = [];
  let id = 1;
  const polygon = (points, tags) => {
    const geometry = [...points, points[0]].map(toPoint);
    elements.push({ type: 'way', id: id++, tags: { ...tags, source: 'procedural' }, geometry });
  };
  const rnd = mulberry32(p.seed ^ 0x4255494c);
  for (const cell of cells) {
    const { i, j } = cell;
    polygon([nodes[j][i], nodes[j][i + 1], nodes[j + 1][i + 1], nodes[j + 1][i]], LAND_TAGS[cell.zone]);
    if (cell.zone !== 'urban' || rnd() > p.buildingDensity) continue;
    const width = Math.min(p.buildingWidthM, dx * .25, dz * .25);
    const types = ['house', 'apartments', 'commercial', 'industrial'];
    const building = types[Math.floor(rnd() * types.length)];
    for (const side of [-1, 1]) {
      const x = cell.x + side * dx * .2, z = cell.z;
      polygon([[x - width / 2, z - width / 2], [x + width / 2, z - width / 2],
        [x + width / 2, z + width / 2], [x - width / 2, z + width / 2]],
      { building, 'building:levels': String(p.buildingLevels) });
    }
  }
  const features = parseOsmFeatureElements(elements);
  const segments = cfg.motherLanes.flatMap(lane => lane.slice(1).map((end, i) => [...llToXZ(...lane[i], cfg.center), ...llToXZ(...end, cfg.center)]));
  const model = { bounds, cells, nx, nz, dx, dz, features, roads, segments };
  if (models.size >= 8) models.delete(models.keys().next().value);
  models.set(key, model);
  return model;
}

export function randomMapSources(cfg) {
  const { features, roads } = randomMapModel(cfg);
  return [structuredClone(features), structuredClone(roads)];
}

function cellAt(model, x, z) {
  const i = clamp(Math.floor((x - model.bounds.minX) / model.dx), 0, model.nx - 1);
  const j = clamp(Math.floor((z - model.bounds.minZ) / model.dz), 0, model.nz - 1);
  return model.cells[j * model.nx + i];
}

function sampleElevation(model, p, x, z) {
  const scale = PROC_RELIEF_WAVE_M / p.wavelengthM;
  const broad = procReliefAt(p.seed, x * scale, z * scale);
  const detail = procReliefAt(p.seed ^ 0x444554, x * scale * 2, z * scale * 2);
  const ridge = 1 - Math.abs(broad) * 2;
  let height = p.datumM + p.amplitudeM * ((broad * (1 - p.ridge) + ridge * p.ridge) * (1 - p.roughness * .3) + detail * p.roughness * .3);
  if (p.terraceM > 1) {
    const terrace = Math.round(height / p.terraceM) * p.terraceM;
    height = height * .75 + terrace * .25;
  }
  const zone = cellAt(model, x, z).zone;
  if (zone === 'water') height = WATER.LEVEL - 2;
  if (zone === 'wet') height = WATER.LEVEL + WATER.SWAMP_BAND / 2;
  let distance = Infinity;
  for (const segment of model.segments) distance = Math.min(distance, distanceToSegment(x, z, ...segment));
  const f = clamp((distance - 24) / 48, 0, 1);
  return p.datumM + (height - p.datumM) * f * f * (3 - 2 * f);
}

function sampleColor(model, p, x, z) {
  const base = COLORS[cellAt(model, x, z).zone];
  const grain = procReliefAt(p.seed ^ 0x434f4c, x * 4, z * 4) * 12;
  return base.map(value => Math.round(clamp(value + grain, 0, 255)));
}

export function randomMapSamplers(cfg) {
  const model = randomMapModel(cfg);
  return { elevationAt: (x, z) => sampleElevation(model, cfg.gen.layers.elevation, x, z),
    sampleColor: (x, z) => sampleColor(model, cfg.gen.layers.surface, x, z) };
}

export const randomElevationAt = (cfg, x, z) => randomMapSamplers(cfg).elevationAt(x, z);
export const randomSurfaceColor = (cfg, x, z) => randomMapSamplers(cfg).sampleColor(x, z);
