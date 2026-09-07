import { mulberry32 } from './rng.js';

// Art direction: photos/tree/{broadleaf_tree,conifer_tree,buttressed_giant}.
// Latitude and altitude are game distribution controls, not botanical range maps.
// Each range is [outer minimum, preferred minimum, preferred maximum, outer maximum].
export const TREE_SPECIES = {
  redwood:  { h: 110, r: 3.4, form: 'spire', lat: [20, 32, 45, 60], altitude: [-500, 0, 800, 2000], share: [10, 22], bark: 0x76503b, leaf: 0x396648 },
  sequoia:  { h: 92, r: 5.6, form: 'spire', lat: [20, 32, 48, 60], altitude: [300, 1200, 2500, 3500], share: [5, 14], bark: 0x8b5136, leaf: 0x49734c },
  euc:      { h: 98, r: 2.6, form: 'open', lat: [8, 20, 42, 55], altitude: [-500, 0, 1000, 2300], share: [10, 22], bark: 0xb0a38b, leaf: 0x658567 },
  dougfir:  { h: 100, r: 2.5, form: 'spire', lat: [25, 40, 60, 78], altitude: [-500, 0, 2000, 4200], share: [18, 32], bark: 0x6b5947, leaf: 0x365c49 },
  sitka:    { h: 96, r: 2.3, form: 'spire', lat: [35, 48, 68, 90], altitude: [-500, 0, 1300, 5000], share: [16, 30], bark: 0x716653, leaf: 0x3c6b61 },
  meranti:  { h: 95, r: 2.5, form: 'buttress', lat: [0, 0, 12, 30], altitude: [-500, 0, 600, 1900], share: [20, 34], bark: 0x82745a, leaf: 0x4c7844 },
  taiwania: { h: 86, r: 2.1, form: 'spire', lat: [10, 20, 35, 48], altitude: [300, 1000, 2800, 4200], share: [20, 36], bark: 0x80664c, leaf: 0x48745b },
  dinizia:  { h: 88, r: 2.7, form: 'umbrella', lat: [0, 0, 10, 28], altitude: [-500, 0, 500, 1500], share: [14, 26], bark: 0x8c775b, leaf: 0x4f733e },
  klinki:   { h: 90, r: 2.2, form: 'tiers', lat: [0, 0, 18, 35], altitude: [0, 500, 2000, 3200], share: [10, 20], bark: 0x85725c, leaf: 0x46744a },
  tualang:  { h: 85, r: 2.8, form: 'buttress', lat: [0, 0, 12, 30], altitude: [-500, 0, 700, 1800], share: [16, 28], bark: 0xa39a7f, leaf: 0x567b43 },
  alerce:   { h: 72, r: 2.4, form: 'spire', lat: [28, 40, 60, 90], altitude: [-500, 0, 1800, 5000], share: [16, 28], bark: 0x88583e, leaf: 0x426d59 },
};

export const TREE_VARIANTS = 3;
function rangeWeight(value, [a, b, c, d]) {
  if (value < a || value > d) return 0;
  if (value < b) return (value - a) / (b - a);
  if (value > c) return (d - value) / (d - c);
  return 1;
}

export function treeDistribution(latitude, altitude, mix = 0.5) {
  if (!Number.isFinite(latitude) || !Number.isFinite(altitude)) return [];
  const lat = Math.min(90, Math.abs(latitude));
  const blend = Number.isFinite(mix) ? Math.max(0, Math.min(1, mix)) : 0.5;
  const rows = Object.entries(TREE_SPECIES).map(([type, spec]) => ({ type,
    weight: rangeWeight(lat, spec.lat) * rangeWeight(altitude, spec.altitude)
      * (spec.share[0] + (spec.share[1] - spec.share[0]) * blend),
  })).filter(row => row.weight > 0);
  const sum = rows.reduce((n, row) => n + row.weight, 0);
  return rows.map(row => ({ type: row.type, weight: row.weight / sum }));
}

// Independent coordinate seed: adding branches never advances the scene RNG.
export function forestSeed(x, z, salt = 0) {
  return (Math.imul(Math.round(x * 16), 73856093) ^ Math.imul(Math.round(z * 16), 19349663) ^ salt) >>> 0;
}

export function pickTreeType(latitude, altitude, roll, patchSeed = 0) {
  const rows = treeDistribution(latitude, altitude, mulberry32(patchSeed)());
  if (!rows.length || !Number.isFinite(roll)) return null;
  let remaining = Math.max(0, Math.min(1, roll));
  for (const row of rows) {
    remaining -= row.weight;
    if (remaining < 0) return row.type;
  }
  return rows[rows.length - 1].type;
}

// One ring every five world metres; subdivision changes no random draws.
export function treeSections(height) {
  return Math.max(1, Math.ceil(Math.max(0, height) / 5));
}
export function treeBend(height, radius) {
  const flex = Math.max(1, Math.min(1.8, height / radius / 30));
  return { flex, lag: Math.min(1.5, height / 70), rate: 1 / Math.sqrt(flex) };
}
const treeCylinder = (radiusTop, radiusBottom, height, radialSegments, heightSegments) =>
  ({ parameters: { radiusTop, radiusBottom, height, radialSegments, heightSegments } });
const treeCrown = radius => ({ parameters: { radius } });

/** A per-tree connected skeleton. Geometry factories keep layout independent of THREE. */
export function createForestTree(type, seed, cyl = treeCylinder, ico = treeCrown, scale = 1) {
  const spec = TREE_SPECIES[type];
  if (!spec) throw new RangeError('Unknown forest species: ' + type);
  const rnd = mulberry32(seed);
  const { bark, leaf, form } = spec;
  const h = spec.h * (0.62 + rnd() * 0.38);
  const r = spec.r * (0.55 + rnd() * 0.60);
  const girth = 2 * Math.PI * r;
  const crownScale = 0.72 + rnd() * 0.4;
  const conifer = form === 'spire' || form === 'tiers';
  const top = h * (conifer ? 0.95 : 0.83);
  const parts = [{ g: cyl(r * 0.28, r, top, 9, treeSections(top * scale)), y: top / 2, c: bark }];
  const branch = (a, b, radius) => {
    const dx = b[0] - a[0], dy = b[1] - a[1], dz = b[2] - a[2];
    const len = Math.hypot(dx, dy, dz);
    // Rx * Rz maps local +Y onto the branch; no independent joint jitter.
    parts.push({ g: cyl(radius * 0.22, radius, len, 6, treeSections(len * scale)),
      px: (a[0] + b[0]) / 2, y: (a[1] + b[1]) / 2, pz: (a[2] + b[2]) / 2,
      rx: Math.atan2(dz, dy), rz: -Math.asin(dx / len), c: bark });
  };
  const crown = (p, radius, sy) => parts.push({ g: ico(radius), px: p[0], y: p[1], pz: p[2],
    sy, key: 'gleaf', c: leaf });
  // Radial roots terminate below grade and remain within the trunk footprint.
  for (let k = 0; k < 5; k++) {
    const a = k * Math.PI * 2 / 5 + rnd() * 0.3;
    branch([Math.cos(a) * r * 1.25, 0, Math.sin(a) * r * 1.25],
      [0, r * (form === 'buttress' ? 3.3 : 1.8), 0], r * 0.32);
  }
  const count = (conifer ? 7 : 5) + Math.floor(rnd() * 8);
  for (let k = 0; k < count; k++) {
    const t = k / (count - 1), a = k * 2.39996 + rnd() * 0.55;
    const y = h * (conifer ? 0.43 + t * 0.46 : 0.53 + t * 0.22);
    const reach = h * (conifer ? 0.14 * (1 - t * 0.72) : 0.16 + rnd() * 0.06) * (0.84 + rnd() * 0.3);
    const tip = [Math.cos(a) * reach, y + h * (conifer ? 0.025 : 0.09), Math.sin(a) * reach];
    branch([0, y, 0], tip, r * (0.32 - t * 0.16) * (0.8 + rnd() * 0.35));
    const radius = h * crownScale * (conifer ? (0.055 + rnd() * 0.02) * (1 - t * 0.52) : 0.08 + rnd() * 0.035);
    crown(tip, radius, (form === 'umbrella' || form === 'tiers' ? 0.4 : 0.66) * (0.82 + rnd() * 0.25));
    if (conifer && rnd() < 0.85) crown([tip[0] * 0.42, tip[1], tip[2] * 0.42], radius * 1.3,
      form === 'tiers' ? 0.38 : 0.9);
    if (!conifer && rnd() < 0.75) {
      const fork = [tip[0] * 1.18, tip[1] + radius * 0.45, tip[2] * 1.18];
      branch(tip, fork, r * 0.12);
      crown(fork, radius * 0.72, form === 'open' ? 0.85 : 0.55);
    }
  }
  crown([0, top, 0], h * (conifer ? 0.035 : 0.10), conifer ? 1.4 : 0.7);

  return { h, r, girth, branchCount: count, sections: treeSections(top * scale), parts };
}

// Representative specimens for catalog tools; live trees always use their own coordinate seed.
export function createForestDefs(cyl, ico) {
  return Object.fromEntries(Object.entries(TREE_SPECIES).map(([type, spec], index) => {
    const variants = Array.from({ length: TREE_VARIANTS }, (_, variant) =>
      createForestTree(type, 0x46525354 ^ Math.imul(index + 1, 7919) ^ Math.imul(variant + 1, 104729), cyl, ico).parts);
    return [type, { h: spec.h, r: spec.r * 1.15, parts: variants.flat(), variants }];
  }));
}
