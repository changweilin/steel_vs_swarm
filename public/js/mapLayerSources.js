import { MAPGEO, llToXZ } from './data.js';

export const MIXED_LAYERS = ['elevation', 'surface', 'regional'];
export const MIXED_SOURCE_VERSION = 1;
export const MIXED_MIN_REGION_M = 5000;

const validCenter = c => c && [c.lat, c.lng, c.rot ?? 0].every(Number.isFinite)
  && Math.abs(c.lat) < 85 && Math.abs(c.lng) <= 180;

export function mapSourceCenter(cfg, layer) {
  if (cfg?.gen?.mode === 'random' && layer === 'regional') {
    const region = cfg.gen.layers?.regional;
    if (region) return { lat: region.latitude, lng: region.longitude, rot: 0 };
  }
  if (cfg?.gen?.mode !== 'mixed' || cfg.gen.version !== MIXED_SOURCE_VERSION) return cfg?.center;
  const center = cfg.gen.layers?.[layer]?.center;
  return validCenter(center) ? center : cfg.center;
}

export function mapSourceKey(cfg) {
  if (cfg?.gen?.mode === 'random') return JSON.stringify([cfg.gen.version, cfg.gen.seed, cfg.gen.layers]);
  if (cfg?.gen?.mode !== 'mixed') return '';
  return JSON.stringify([cfg.gen.version, ...MIXED_LAYERS.map(key => cfg.gen.layers?.[key])]);
}

export function validMixedLayers(layers) {
  if (!layers || !MIXED_LAYERS.every(key => {
    const source = layers[key];
    return source && typeof source.id === 'string' && /^[a-z0-9_-]{1,128}$/.test(source.id) && validCenter(source.center)
      && Number.isInteger(source.roadCount) && source.roadCount > 0;
  })) return false;
  if (new Set(MIXED_LAYERS.map(key => layers[key].id)).size !== MIXED_LAYERS.length) return false;
  for (let i = 0; i < MIXED_LAYERS.length; i++) {
    for (let j = i + 1; j < MIXED_LAYERS.length; j++) {
      const a = layers[MIXED_LAYERS[i]].center, b = layers[MIXED_LAYERS[j]].center;
      const [x, z] = llToXZ(a.lat, a.lng, b);
      if (Math.hypot(x, z) * MAPGEO.REAL_SCALE < MIXED_MIN_REGION_M) return false;
    }
  }
  return true;
}

export function validMixedMap(cfg) {
  return cfg?.gen?.version === MIXED_SOURCE_VERSION && validMixedLayers(cfg.gen.layers)
    && cfg.gen.laneSource === 'osm-baked' && cfg.synthetic === false && cfg.procRelief == null;
}
