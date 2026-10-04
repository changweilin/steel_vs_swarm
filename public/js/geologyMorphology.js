import { mulberry32 } from './rng.js';

// Families describe erosional forms, not arbitrary noise or a simulated geological history.
export const GEOLOGY_MORPHOLOGIES = Object.freeze(Object.fromEntries(Object.entries({
  mountain: ['rounded', 'ridge', 'arete', 'horn', 'saddle'],
  granite: ['dome', 'ridge'],
  sandstone: ['mesa', 'butte', 'cuesta'],
  inselberg: ['dome', 'mesa'],
  tor: ['jointed-tor'], granite_towers: ['jointed-peaks'],
  fin: ['fin'], spire: ['tapered-spire'], rocktower: ['butte'],
  conglomerate: ['rounded-tower'], marble: ['eroded-ridge'],
  karst: ['dissolution-ridges'], cliff: ['fault-scarp'],
}).map(([type, families]) => [type, Object.freeze(families)])));

export function geologyMorphology(type, seed) {
  if (!Number.isSafeInteger(seed)) throw new TypeError('Geology seed must be a safe integer');
  const families = GEOLOGY_MORPHOLOGIES[type];
  if (!families) return null;
  // This stream never advances object dimensions, covers or scene layout.
  const rnd = mulberry32(seed ^ 0x4d4f5250), sample = (lo, hi) => lo + rnd() * (hi - lo);
  const family = families[Math.floor(rnd() * families.length)];
  const m = { family, spanX: sample(.74, .96), spanZ: sample(.70, .94),
    offsetX: sample(-.08, .08), offsetZ: sample(-.08, .08),
    sharpness: sample(.85, 1.3), ridgeWidth: family === 'arete' ? sample(.22, .34) : sample(.48, .68),
    bend: sample(-.10, .10), phase: sample(0, Math.PI * 2),
    separation: sample(.34, .44), secondaryHeight: sample(.80, .95),
    topRadius: family === 'butte' ? sample(.12, .24) : sample(.35, .55),
    scarpWidth: sample(.22, .34), dip: sample(.08, .22),
    jointCount: 3 + Math.floor(rnd() * 4), fluteFrequency: sample(5, 9) };
  if (type === 'granite_towers') {
    const count = 2 + Math.floor(rnd() * 3);
    m.peaks = Array.from({ length: count }, (_, i) => ({
      x: -.48 + .96 * i / (count - 1), z: sample(-.15, .15),
      radius: sample(.25, .37), height: i === Math.floor(count / 2) ? 1 : sample(.65, .9),
    }));
  }
  return m;
}

const positive = v => Math.max(0, v);
const smooth = v => { const t = Math.max(0, Math.min(1, v)); return t * t * (3 - 2 * t); };

// Single-valued surfaces exclude unsupported overhangs and floating fragments.
export function mountainProfile(x, z, m) {
  const r2 = x * x + z * z;
  if (m.family === 'rounded' || m.family === 'dome') return positive(1 - r2) ** (m.family === 'dome' ? .55 : .85);
  if (m.family === 'horn') {
    let distance = 0;
    for (let i = 0; i < 3; i++) {
      const angle = m.phase + i * Math.PI * 2 / 3;
      distance = Math.max(distance, x * Math.cos(angle) + z * Math.sin(angle));
    }
    return positive(1 - distance / .55) ** m.sharpness;
  }
  if (m.family === 'ridge' || m.family === 'arete') {
    const crestZ = m.bend * Math.sin(x * 2.8 + m.phase);
    const flank = positive(1 - Math.abs(z - crestZ) / m.ridgeWidth) ** m.sharpness;
    const along = positive(1 - (x / .96) ** 2) ** .6;
    const cols = m.family === 'arete' ? .88 + .12 * Math.cos(x * 7 + m.phase) : .96 + .04 * Math.cos(x * 3 + m.phase);
    return flank * along * cols;
  }
  if (m.family === 'saddle') {
    const dome = (cx, cz) => positive(1 - ((x - cx) / .66) ** 2 - ((z - cz) / .78) ** 2) ** .85;
    return Math.max(dome(-m.separation, -m.bend), dome(m.separation, m.bend) * m.secondaryHeight);
  }
  if (['mesa', 'butte', 'cuesta'].includes(m.family)) {
    const radius = Math.hypot(x, z);
    const top = 1 - smooth((radius - m.topRadius) / m.scarpWidth);
    const cap = m.family === 'cuesta' ? top * (1 - m.dip * (x + 1) / 2) : top;
    // A resistant cap sits above a continuous lower talus apron.
    return Math.max(cap, positive(1 - r2) * .18);
  }
  return null;
}
