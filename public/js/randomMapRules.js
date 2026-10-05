import { mulberry32 } from './rng.js';
import { geographicEnvironment, FOREST_GEOLOGY_PH } from './seasonalEnvironment.js';
import { CULTURAL_REGIONS } from './architectureStyles.js';

export const RANDOM_MAP_VERSION = 3;
// Metres are game metres; ratios and coordinate bands are generative priors, not surveys.
export const RANDOM_MAP_RANGES = Object.freeze({
  elevation: { amplitudeM: [8, 45], wavelengthM: [240, 700], roughness: [.25, .65],
    ridge: [0, .5], terraceM: [0, 4], datumM: [3, 15] },
  surface: { blockM: [120, 220], gridJitter: [0, .12], streetLanes: [2, 4],
    buildingDensity: [.25, .65], buildingWidthM: [12, 28], buildingLevels: [1, 6],
    urbanFraction: [.2, .55], bareFraction: [.05, .3], waterFraction: [0, .15], wetFraction: [0, .1] },
  regional: { latitude: [-65, 65], longitude: [-180, 180], moisture: [.2, .9],
    wind: [.15, .85], rainfallMm: [200, 3000], vegetation: [.2, .85] },
});
const INTEGER = new Set(['streetLanes', 'buildingLevels']);
export const randomRangeStep = key => INTEGER.has(key) || /M$|Mm$|latitude|longitude/.test(key) ? 1 : .01;
const SALTS = { elevation: 0x54455252, surface: 0x524f4144, regional: 0x42494f4d };
const cultures = Object.keys(CULTURAL_REGIONS), geology = Object.keys(FOREST_GEOLOGY_PH);

export function randomMapLayers(seed, ranges = {}) {
  for (const [layer, entries] of Object.entries(ranges || {})) {
    if (!Object.hasOwn(RANDOM_MAP_RANGES, layer) || !entries || typeof entries !== 'object'
      || Object.keys(entries).some(key => !Object.hasOwn(RANDOM_MAP_RANGES[layer], key))) throw new RangeError(`Unknown random-map range: ${layer}`);
  }
  const layers = {};
  for (const [layer, defs] of Object.entries(RANDOM_MAP_RANGES)) {
    const rnd = mulberry32((seed >>> 0) ^ SALTS[layer]);
    const out = { seed: ((seed >>> 0) ^ SALTS[layer]) >>> 0 };
    for (const [key, limits] of Object.entries(defs)) {
      const range = ranges?.[layer]?.[key] ?? limits;
      if (!Array.isArray(range) || range.length !== 2 || !range.every(Number.isFinite)
        || range[0] < limits[0] || range[1] > limits[1] || range[1] < range[0]
        || (INTEGER.has(key) && !range.every(Number.isInteger))) throw new RangeError(`Invalid random-map range: ${layer}.${key}`);
      out[key] = INTEGER.has(key) ? Math.floor(range[0] + rnd() * (range[1] - range[0] + 1))
        : range[0] + rnd() * (range[1] - range[0]);
    }
    if (layer === 'regional') {
      const profile = geographicEnvironment(out.latitude, out.longitude);
      out.climate = profile.climate;
      out.geology = profile.geology;
      out.culture = cultures[Math.floor(rnd() * cultures.length)];
    }
    layers[layer] = out;
  }
  return layers;
}

export function isRandomMap(cfg) { return cfg?.gen?.mode === 'random'; }

export function validRandomMap(cfg) {
  if (!isRandomMap(cfg) || cfg.gen.version !== RANDOM_MAP_VERSION || cfg.synthetic !== true
    || cfg.center?.lat !== 0 || cfg.center?.lng !== 0 || cfg.center?.rot !== 0 || cfg.procRelief != null
    || !Number.isInteger(cfg.gen.seed) || cfg.gen.seed < 0 || cfg.gen.seed > 0xffffffff
    || !cfg.venue?.mix || !Object.values(cfg.venue.mix).every(v => Number.isFinite(v) && v >= 0)
    || !Array.isArray(cfg.gen.sources) || cfg.gen.sources.length !== 0) return false;
  for (const [layer, defs] of Object.entries(RANDOM_MAP_RANGES)) {
    const value = cfg.gen.layers?.[layer];
    if (!value || !Number.isInteger(value.seed) || value.seed < 0 || value.seed > 0xffffffff) return false;
    for (const [key, [min, max]] of Object.entries(defs)) {
      if (!Number.isFinite(value[key]) || value[key] < min || value[key] > max
        || (INTEGER.has(key) && !Number.isInteger(value[key]))) return false;
    }
  }
  const r = cfg.gen.layers.regional;
  const profile = geographicEnvironment(r.latitude, r.longitude);
  return r.climate === profile?.climate && r.geology === profile?.geology
    && cultures.includes(r.culture) && geology.includes(r.geology);
}
