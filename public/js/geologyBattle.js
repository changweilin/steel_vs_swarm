// Battle adapters contain placement envelopes, never a second rock modeller.
import { GEOLOGY_TYPES, GEOLOGY_STEEP_DEG, LEGACY_GEOLOGY_RULES, geologyEnvironment, generateGeology, geologyBackgroundObject } from './geology.js';
import { mulberry32 } from './rng.js';

export const BATTLE_GEOLOGY = Object.freeze({
  uluru: { type: 'inselberg', col: { r: 88, h: 62 }, s: [1, 1.7] },
  augustus: { type: 'inselberg', col: { r: 80, h: 50 }, s: [.9, 1.6] },
  dabajian: { type: 'rocktower', col: { r: 40, h: 96 }, s: [.8, 1.5] },
  moai: { type: 'monument', region: 'rapa_nui', col: { r: 16, h: 34 }, s: [1, 1.9] },
  machupicchu: { type: 'monument', region: 'andes', col: { r: 42, h: 44 }, s: [1, 1.7] },
  stonehenge: { type: 'monument', region: 'britain', col: { r: 24, h: 27 }, s: [1.1, 2] },
  torres: { type: 'granite_towers', col: { r: 34, h: 120 }, s: [.8, 1.4] },
  karst: { type: 'rocktower', col: { r: 18, h: 104 }, s: [.8, 1.4] },
  meteora: { type: 'conglomerate', col: { r: 36, h: 88 }, s: [.9, 1.5] },
  sigiriya: { type: 'granite', col: { r: 48, h: 76 }, s: [.8, 1.3] },
});
export const SYNTH_GEOLOGY = Object.freeze({ col: { r: 42, h: 65 }, s: [.9, 1.4] });

/** Conservative maximum over the entire placement envelope, never just the centre. */
export function battleGeologySlope(heightAt, x, z, radius) {
  const n = 16, step = radius * 2 / n;
  if (!(step > 0)) return null;
  let previous, slope = 0;
  for (let j = 0; j <= n; j++) {
    const row = [];
    for (let i = 0; i <= n; i++) {
      const h = heightAt(x - radius + i * step, z - radius + j * step);
      if (!Number.isFinite(h)) return null;
      row.push(h);
      const dx = i ? (h - row[i - 1]) / step : 0;
      const dz = previous ? (h - previous[i]) / step : 0;
      slope = Math.max(slope, Math.atan(Math.hypot(dx, dz)) * 180 / Math.PI);
    }
    previous = row;
  }
  return slope;
}

export function battleGeology(key, seed, input = {}) {
  const def = key === 'auto' ? null : BATTLE_GEOLOGY[key];
  if (key !== 'auto' && !def) throw new RangeError(`Unknown battle geology: ${key}`);
  const rnd = mulberry32((input.formationSeed ?? seed) ^ 0x424f554c);
  const types = [...new Set(Object.values(LEGACY_GEOLOGY_RULES))];
  let type = def?.type ?? types[Math.floor(rnd() * types.length)];
  if (geologyEnvironment(input).slope > GEOLOGY_STEEP_DEG && !GEOLOGY_TYPES[type].terrainFit) {
    type = generateGeology('auto', input.formationSeed ?? seed, input).type;
  }
  const entry = geologyBackgroundObject(type, seed, {
    ...input, region: def?.region, uniformScale: 1, segments: 24, strike: 0,
  });
  if (!entry) return null;
  const { vertices } = entry.meshData, { min, size } = entry.bounds;
  const centerX = (entry.bounds.min[0] + entry.bounds.max[0]) / 2;
  const centerZ = (entry.bounds.min[2] + entry.bounds.max[2]) / 2;
  let radius = 0;
  for (let i = 0; i < vertices.length; i += 3) radius = Math.max(radius, Math.hypot(vertices[i] - centerX, vertices[i + 2] - centerZ));
  const envelope = def?.col ?? SYNTH_GEOLOGY.col;
  const scale = Math.min(envelope.r / radius, envelope.h / size[1]);
  // One scale for rocks, monuments and surface details. Bounds include every triangle.
  const fitted = vertices.map((v, i) => (v - [centerX, min[1], centerZ][i % 3]) * scale);
  const col = { r: radius * scale, h: size[1] * scale };
  return { ...entry, meshData: { ...entry.meshData, vertices: fitted },
    bounds: { min: entry.bounds.min.map((v, i) => (v - [centerX, min[1], centerZ][i]) * scale),
      max: entry.bounds.max.map((v, i) => (v - [centerX, min[1], centerZ][i]) * scale), size: size.map(v => v * scale) },
    battle: { key, col, scale },
  };
}
