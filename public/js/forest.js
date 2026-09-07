import { mulberry32 } from './rng.js';

import { TREE_SPECIES } from './forestSpecies.js';
export { TREE_SPECIES } from './forestSpecies.js';

export const TREE_VARIANTS = 3;
function rangeWeight(value, [a, b, c, d]) {
  if (value < a || value > d) return 0;
  if (value < b) return (value - a) / (b - a);
  if (value > c) return (d - value) / (d - c);
  return 1;
}

// Optional map-author inputs. Rock -> pH is an art-direction proxy, not a soil survey.
export const FOREST_GEOLOGY_PH = { limestone: 7.8, granite: 5.2, sandstone: 5.6, volcanic: 5.8, alluvium: 6.8, sand: 6.5, peat: 4.8 };
const CLIMATE = {
  tropical: { temperature: 26, moisture: .8 }, temperate: { temperature: 13, moisture: .6 },
  boreal: { temperature: 2, moisture: .5 }, arid: { temperature: 27, moisture: .15 },
  mediterranean: { temperature: 18, moisture: .3 }, alpine: { temperature: 3, moisture: .55 },
};
export function forestEnvironment(latitude, altitude, input = {}) {
  const climate = CLIMATE[input.climate] || {};
  const finite = (value, fallback) => Number.isFinite(value) ? value : fallback;
  return {
    temperature: finite(input.temperature, climate.temperature ?? 29 - Math.abs(latitude) * .48 - Math.max(0, altitude) * .006),
    moisture: Math.max(0, Math.min(1, finite(input.moisture, input.wet ? .95 : climate.moisture ?? .55))),
    ph: finite(input.ph, FOREST_GEOLOGY_PH[input.geology]),
    rainfall: finite(input.rainfall, undefined), salinity: Math.max(0, Math.min(1, finite(input.salinity, 0))),
    slope: finite(input.slope, undefined), wet: !!input.wet,
  };
}
export function treeHabitatWeight(type, latitude, altitude, input = {}) {
  const spec = TREE_SPECIES[type];
  if (!spec) return 0;
  const env = forestEnvironment(latitude, altitude, input);
  if (spec.roots === 'pneumatophore' && !env.wet) return 0;
  let weight = rangeWeight(Math.min(90, Math.abs(latitude)), spec.lat) * rangeWeight(altitude, spec.altitude);
  for (const [key, range] of Object.entries(spec.habitat)) {
    if (Number.isFinite(env[key])) weight *= rangeWeight(env[key], range);
  }
  return weight;
}
export function treeDistribution(latitude, altitude, mix = 0.5, environment = {}) {
  if (!Number.isFinite(latitude) || !Number.isFinite(altitude)) return [];
  const lat = Math.min(90, Math.abs(latitude));
  const blend = Number.isFinite(mix) ? Math.max(0, Math.min(1, mix)) : 0.5;
  const rows = Object.entries(TREE_SPECIES).map(([type, spec]) => ({ type,
    weight: treeHabitatWeight(type, lat, altitude, environment)
      * (spec.share[0] + (spec.share[1] - spec.share[0]) * blend),
  })).filter(row => row.weight > 0);
  const sum = rows.reduce((n, row) => n + row.weight, 0);
  return rows.map(row => ({ type: row.type, weight: row.weight / sum }));
}

// Independent coordinate seed: adding branches never advances the scene RNG.
export function forestSeed(x, z, salt = 0) {
  return (Math.imul(Math.round(x * 16), 73856093) ^ Math.imul(Math.round(z * 16), 19349663) ^ salt) >>> 0;
}

export function pickTreeType(latitude, altitude, roll, patchSeed = 0, environment = {}) {
  const rows = treeDistribution(latitude, altitude, mulberry32(patchSeed)(), environment);
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

/** A per-tree connected skeleton. Factories keep layout independent of THREE. */
export function createForestTree(type, seed, cyl = treeCylinder, ico = treeCrown, scale = 1, season = 'summer') {
  const spec = TREE_SPECIES[type];
  if (!spec) throw new RangeError('Unknown forest species: ' + type);
  const rnd = mulberry32(seed), g = spec.growth;
  const sample = range => range[0] + rnd() * (range[1] - range[0]);
  const integer = range => Math.floor(sample([range[0], range[1] + 1]));
  const h = spec.h * sample(g.height), r = spec.r * sample(g.radius);
  const count = integer(g.branches), density = g.density * (.8 + rnd() * .2);
  const crownScale = sample(g.crown), rootCount = integer(g.rootCount);
  const parts = [], stems = [], crowns = [];
  const { bark, leaf, form } = spec;
  const conifer = form === 'spire' || form === 'tiers';
  const top = h * (conifer ? .95 : form === 'palm' ? .84 : form === 'shrub' ? .68 : .83);
  let footprint = r * 1.6;
  const branch = (a, b, radius, role = 'branch', color = bark) => {
    const dx = b[0] - a[0], dy = b[1] - a[1], dz = b[2] - a[2], len = Math.hypot(dx, dy, dz);
    if (len < 1e-5) return;
    if (a[1] <= 1e-5) footprint = Math.max(footprint, Math.hypot(a[0], a[2]) + radius);
    if (b[1] <= 1e-5) footprint = Math.max(footprint, Math.hypot(b[0], b[2]) + radius * .22);
    parts.push({ g: cyl(radius * .22, radius, len, 6, treeSections(len * scale)),
      px: (a[0] + b[0]) / 2, y: (a[1] + b[1]) / 2, pz: (a[2] + b[2]) / 2,
      rx: Math.atan2(dz, dy), rz: -Math.asin(dx / len), c: color, role,
      ...(role === 'leaf' ? { key: 'gleaf', noCard: true } : {}) });
  };
  const stem = (x, z, height, radius) => {
    parts.push({ g: cyl(radius * .28, radius, height, 9, treeSections(height * scale)),
      px: x, y: height / 2, pz: z, c: bark, role: 'trunk' });
    stems.push({ x, z, r: radius, h: height });
  };
  const crown = (p, radius, sy) => {
    // Crown tops stay inside the sampled height; their centers still enclose branch tips.
    sy = Math.min(sy, Math.max(.05, (h - p[1]) / radius));
    parts.push({ g: ico(radius), px: p[0], y: p[1], pz: p[2], sy, key: 'gleaf', c: leaf, role: 'leaf' });
    crowns.push({ p, radius, sy });
  };
  if (form === 'bamboo') {
    const n = integer(g.stemCount);
    for (let i = 0; i < n; i++) {
      const a = i * 2.39996, d = i === 0 ? 0 : h * (.035 + rnd() * .055);
      const x = Math.cos(a) * d, z = Math.sin(a) * d, ht = top * (i === 0 ? 1 : .65 + rnd() * .35);
      const width = .65 + rnd() * .35;
      const rr = r * (i === 0 ? 1 : width);
      stem(x, z, ht, rr);
      const nodes = Math.max(4, Math.ceil(ht / 1.5));
      for (let k = 1; k < nodes; k++) {
        const y = ht * k / nodes, radius = rr * (1 - .72 * y / ht);
        parts.push({ g: cyl(radius * 1.24, radius * 1.24, rr * .5, 6, 1), px: x, y, pz: z, c: 0xb0b67b, role: 'node' });
      }
      for (let k = 0; k < count; k++) {
        const y = ht * (.5 + k / count * .4), angle = k * 2.4 + a;
        const tip = [x + Math.cos(angle) * ht * .075, y + ht * .025, z + Math.sin(angle) * ht * .075];
        branch([x, y, z], tip, rr * .3);
        crown(tip, ht * (.035 + rnd() * .025) * crownScale, .35 * density);
        Object.assign(parts[parts.length - 1], { sx: 1.65, sz: .4, ry: -angle });
      }
      crown([x, ht, z], ht * .04, .7);
    }
  } else if (form === 'palm') {
    stem(0, 0, top, r);
    for (let k = 0; k < count; k++) {
      const a = k / count * Math.PI * 2 + rnd() * .2;
      const mid = [Math.cos(a) * h * .13, top + h * .07, Math.sin(a) * h * .13];
      const tip = [Math.cos(a) * h * .25, top - h * (.05 + rnd() * .05), Math.sin(a) * h * .25];
      branch([0, top, 0], mid, r * .2);
      branch(mid, tip, h * .012, 'leaf', leaf);
      const pinnae = 4 + Math.floor(rnd() * 4 * density);
      for (let j = 1; j <= pinnae; j++) {
        const t = j / (pinnae + 1), p = mid.map((v, i) => v + (tip[i] - v) * t);
        for (const sign of [-1, 1]) branch(p,
          [p[0] - Math.sin(a) * sign * h * .04 * crownScale, p[1] - h * .018, p[2] + Math.cos(a) * sign * h * .04 * crownScale],
          h * .008, 'leaf', leaf);
      }
    }
    parts.push({ g: ico(r * 1.8), y: top, sy: 1, c: leaf, key: 'gleaf', noCard: true, role: 'leaf' });
    crowns.push({ p: [0, top, 0], radius: h * .05, sy: .5 });
  } else {
    stem(0, 0, top, r);
    if (form === 'shrub') {
      for (let i = 1, n = integer(g.stemCount); i < n; i++) {
        const a = i * 2.39996, d = h * (.035 + rnd() * .035);
        stem(Math.cos(a) * d, Math.sin(a) * d, top * (.7 + rnd() * .3), r * (.45 + rnd() * .3));
      }
    }
    if (form === 'bottle') {
      parts[0].g = cyl(r * .45, r, top, 10, treeSections(top * scale));
      parts.push({ g: ico(r), y: Math.min(r, top * .35), sy: Math.min(1.25, top * .4 / r), c: bark, role: 'trunk' });
    }
    const primaryStems = [...stems];
    for (let k = 0; k < count; k++) {
      const t = k / (count - 1), a = k * 2.39996 + rnd() * .55, trunk = primaryStems[k % primaryStems.length];
      const y = trunk.h * (conifer ? .45 + t * .46 : form === 'shrub' ? .15 + t * .72 : .6 + t * .3);
      const reach = h * (conifer ? .14 * (1 - t * .72) : form === 'shrub' ? .2 + rnd() * .12 : .16 + rnd() * .06) * (.84 + rnd() * .3);
      const tip = [trunk.x + Math.cos(a) * reach, y + h * (conifer ? .025 : .08), trunk.z + Math.sin(a) * reach];
      branch([trunk.x, y, trunk.z], tip, trunk.r * (.32 - t * .16) * (.8 + rnd() * .35));
      const radius = h * crownScale * (conifer ? (.055 + rnd() * .02) * (1 - t * .52)
        : form === 'shrub' ? .16 + rnd() * .05 : spec.roots === 'aerial' ? .12 + rnd() * .05 : .08 + rnd() * .035);
      crown(tip, radius, (form === 'umbrella' || form === 'tiers' ? .4 : .66) * (.82 + rnd() * .25));
      if (conifer && rnd() < density) crown([tip[0] * .42, tip[1], tip[2] * .42], radius * 1.3, form === 'tiers' ? .38 : .9);
      if (!conifer && rnd() < density) {
        const fork = [tip[0] * 1.18, tip[1] + radius * .45, tip[2] * 1.18];
        branch(tip, fork, r * .12);
        crown(fork, radius * .72, form === 'open' ? .85 : .55);
      }
      if (form === 'weeping') {
        const end = [tip[0] * 1.13, Math.max(h * .2, tip[1] - h * (.2 + rnd() * .16)), tip[2] * 1.13];
        branch(end, tip, r * .08);
        for (let j = 0; j < 3; j++) crown(end.map((v, i) => v + (tip[i] - v) * j / 3), radius * .45, 1.3);
      }
      if (spec.roots === 'aerial' && k < rootCount) {
        const rr = r * (.06 + rnd() * .1);
        branch([tip[0], 0, tip[2]], tip, rr, 'root');
        stems.push({ x: tip[0], z: tip[2], r: rr, h: tip[1], root: true });
      }
    }
    for (const trunk of stems.filter(s => !s.root)) crown([trunk.x, trunk.h, trunk.z], h * (conifer ? .035 : form === 'shrub' ? .18 : .10), conifer ? 1.4 : .7);
  }
  // Roots use their own seed, leaving the crown structure unaffected by root counts.
  const rrnd = mulberry32(seed ^ 0x524f4f54);
  if (spec.roots === 'pneumatophore') {
    for (let i = 0; i < rootCount; i++) {
      const a = rrnd() * Math.PI * 2, d = r * (2 + rrnd() * 5), ht = .15 + rrnd() * .5;
      footprint = Math.max(footprint, d + .055);
      // Bury the base so the cluster's slight rigid lean cannot lift outer roots clear of soil.
      parts.push({ g: cyl(.015, .055, ht + .2, 5, 1), px: Math.cos(a) * d, y: (ht - .2) / 2, pz: Math.sin(a) * d, c: bark, role: 'root' });
    }
  } else if (spec.roots !== 'aerial') {
    for (let i = 0; i < rootCount; i++) {
      const a = i / rootCount * Math.PI * 2 + rrnd() * .3;
      const buttress = spec.roots === 'buttress';
      const reach = spec.roots === 'rhizome' ? h * .075
        : r * (buttress ? 1.25 : spec.roots === 'fibrous' ? 1.8 : spec.roots === 'shallow' ? 3.2 : spec.roots === 'surface' ? 3 : 2.5);
      branch([Math.cos(a) * reach, 0, Math.sin(a) * reach],
        [0, Math.min(top * .2, r * (buttress ? 3.3 : .3)), 0], r * (buttress ? .32 : spec.roots === 'fibrous' ? .04 : .1), 'root');
    }
  }
  const organs = (kind, trait) => {
    if (!trait || !trait.seasons.includes(season)) return;
    const random = mulberry32(seed ^ (kind === 'flower' ? 0x464c4f57 : 0x46525549));
    if (random() >= trait.chance) return;
    const n = Math.floor(trait.count[0] + random() * (trait.count[1] - trait.count[0] + 1));
    for (let i = 0; i < n; i++) {
      const cr = crowns[Math.floor(random() * crowns.length)], a = random() * Math.PI * 2;
      const size = trait.size[0] + random() * (trait.size[1] - trait.size[0]);
      const up = kind === 'flower' ? .15 + random() * .7 : -.7;
      const spread = Math.sqrt(1 - up * up);
      const x = cr.p[0] + Math.cos(a) * cr.radius * spread, z = cr.p[2] + Math.sin(a) * cr.radius * spread;
      const y = Math.min(h - size * 2.5, cr.p[1] + up * cr.radius * cr.sy);
      branch(cr.p, [x, y, z], size * .18, kind);
      parts[parts.length - 1].organStem = true;
      const lobes = kind === 'flower' && trait.form !== 'catkin' ? 5 : 1;
      for (let j = 0; j < lobes; j++) {
        const angle = j / lobes * Math.PI * 2, offset = lobes > 1 ? size * .7 : 0;
        parts.push({ g: ico(size * (lobes > 1 ? .65 : 1)), px: x + Math.cos(angle) * offset,
          y, pz: z + Math.sin(angle) * offset, sy: trait.form === 'catkin' ? 2.5 : kind === 'flower' ? .4 : 1.2, c: trait.color, role: kind });
      }
    }
  };
  organs('flower', spec.flower); organs('fruit', spec.fruit);
  footprint = Math.max(footprint, ...stems.map(s => Math.hypot(s.x, s.z) + s.r));
  return { h, r, girth: 2 * Math.PI * r, branchCount: count, density, roots: spec.roots, footprint, stems,
    sections: treeSections(top * scale), parts };
}

// Representative specimens for catalog tools; live trees always use their own coordinate seed.
export function createForestDefs(cyl, ico) {
  return Object.fromEntries(Object.entries(TREE_SPECIES).map(([type, spec], index) => {
    const variants = Array.from({ length: TREE_VARIANTS }, (_, variant) =>
      createForestTree(type, 0x46525354 ^ Math.imul(index + 1, 7919) ^ Math.imul(variant + 1, 104729), cyl, ico).parts);
    return [type, { h: spec.h, r: spec.r * spec.growth.radius[1], parts: variants.flat(), variants }];
  }));
}
