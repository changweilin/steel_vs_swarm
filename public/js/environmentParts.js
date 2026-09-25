// Shared, seeded environment construction. Metres are supplied by the host, never sampled.
// Descriptors remain render-free so scene and boundary consumers can use the same model.
import { mulberry32 } from './rng.js';
import { createForestTree, forestEnvironment } from './forest.js';
import { makeSceneVehicleParts } from './vehicleCatalog.js';
import { partsAABB } from './vehicles.js';
import { mat3FromEulerXYZ, mat3Multiply, eulerXYZFromMat3 } from './partTransform.js';
import { geologyBackgroundObject, elongatedGeologyMesh } from './geology.js';
import { generateVessel } from './vesselCatalog.js';
import { loftMeshData, vesselHullSections } from './vesselGeometry.js';
import { BUILDING_FUNCTIONS } from './buildingFunctions.js';
import { chooseArchitecture } from './buildingDiversity.js';
import { calculateFootprintMetrics, resolveAdaptiveRoofForm } from './architectureStyles.js';
import { architecturalFacadeParts } from './architectureFacadeParts.js';
import { architecturalRoofParts } from './architectureRoofParts.js';
import { optimalSolarTiltRad } from './data.js';

export const ENVIRONMENT_OBJECTS = Object.freeze({
  house: { category: 'residential', bio: ['urban'], size: [14, 12, 11] },
  skyscraper: { category: 'highrise', bio: ['urban'], size: [20, 60, 18] },
  skyfall: { category: 'highrise', bio: ['urban'], size: [36, 14, 16] },
  factory: { category: 'industry', bio: ['urban'], size: [30, 18, 24] },
  powerplant: { category: 'industry', bio: ['urban'], size: [32, 26, 24] },
  incinerator: { category: 'industry', bio: ['urban'], size: [26, 28, 20] },
  mine: { category: 'extraction', bio: ['bare'], size: [32, 16, 26] },
  oilfield: { category: 'extraction', bio: ['bare'], size: [20, 22, 16] },
  greenhouse: { category: 'agriculture', bio: ['green'], size: [24, 10, 16] },
  ranch: { category: 'agriculture', bio: ['green'], size: [26, 12, 20] },
  boulder: { category: 'rock', bio: ['bare', 'green', 'wet'], size: [18, 16, 16] },
  gianttree: { category: 'giant-tree', bio: ['green', 'wet'], size: [30, 65, 30] },
  fallentree: { category: 'deadwood', bio: ['green', 'wet'], size: [28, 7, 9] },
  car: { category: 'vehicle', bio: ['urban'], size: [4.8, 1.8, 2.2] },
  icefloe: { category: 'sea-ice', bio: ['water'], size: [24, 2, 18], draft: .86 },
  iceberg: { category: 'glacial-ice', bio: ['water'], size: [38, 36, 28], draft: .84 },
  strandedship: { category: 'marine-vehicle', bio: ['wet'], size: [34, 16, 14] },
});

export const ENVIRONMENT_PARAMETERS = Object.freeze({
  residential: { scale: [.72, 1] },
  highrise: { scale: [.75, 1] },
  industry: { scale: [.8, 1] },
  extraction: { scale: [.8, 1] }, agriculture: { scale: [.8, 1] },
  rock: { scale: [.6, 1] }, 'giant-tree': { scale: [.75, 1] },
  deadwood: { scale: [.65, 1] }, vehicle: { scale: [.9, 1] },
  'marine-vehicle': { scale: [.8, 1] },
  'sea-ice': { scale: [.5, 1], sides: [8, 14], edge: [.78, 1], crown: [.94, 1] },
  'glacial-ice': { scale: [.65, 1], sides: [7, 12], edge: [.65, 1], crown: [.55, 1] },
});
export const ENVIRONMENT_CATEGORIES = Object.freeze(Object.fromEntries(
  Object.keys(ENVIRONMENT_PARAMETERS).map(category => [category,
    Object.keys(ENVIRONMENT_OBJECTS).filter(kind => ENVIRONMENT_OBJECTS[kind].category === category)]),
));

export const ENVIRONMENT_BUILDINGS = Object.freeze({
  house: { key: 'residential_townhouse', category: 'residential', type: 'townhouse', affinity: ['house', 'townhouse'], width: [.78, 1], depth: [.72, 1], body: [.55, .76] },
  skyscraper: { key: 'commercial_skyscraper', category: 'commercial', type: 'skyscraper', affinity: ['skyscraper', 'office'], width: [.68, 1], depth: [.65, 1], body: [.72, .94] },
  factory: { type: 'factory', width: [.8, 1], depth: [.74, 1], body: [.38, .56] },
  powerplant: { type: 'plant', width: [.76, 1], depth: [.72, 1], body: [.36, .52] },
  incinerator: { type: 'factory', width: [.72, 1], depth: [.7, 1], body: [.36, .54] },
});

export const ENVIRONMENT_STRUCTURE_PARAMETERS = Object.freeze({
  ranch: { fenceBay: [2.4, 3.6], fenceHeight: [1.2, 1.8], gateWidth: [2.8, 4.2], siloHeightRatio: [.58, .74] },
  chimney: { topRatio: [.64, .78], wallRatio: [.10, .15], bandLevel: [.78, .88] },
  coolingTower: { heightRatio: [.78, .9], throatRatio: [.56, .64], throatLevel: [.65, .75], rimRatio: [.70, .80], wallRatio: [.045, .065] },
  greenhouse: { bay: [2.5, 4], eaveRatio: [.52, .66] },
  wind: { blades: 3, chord: [.24, .38], rotorRatio: [.34, .42] },
  solar: { pitch: [.10, .18], gridLines: [4, 6] },
  tetrapod: { spacing: [3.2, 4.2], layers: [2, 3], armLength: [1.5, 1.8], tipRatio: [.48, .62], yaw: [0, Math.PI * 2] },
  oysterRack: { bay: [2.5, 3.5], height: [2, 3.2], lines: [4, 7], dropRatio: [.55, .8] },
  fishCage: { bay: [7, 10], depth: [1.8, 3.2], floatWidth: [.3, .5], meshBays: [4, 7] },
  mine: { levels: [3, 5], benchHeightRatio: [.44, .54], retreat: [.12, .15], conveyorPitch: [.10, .20] },
  derrick: { bays: [4, 7], crownRatio: [.28, .4], legRatio: [.018, .026], tankHeightRatio: [.18, .25] },
  offshoreRig: { bay: [22, 30], deckRatio: [.14, .18], pontoonRatio: [.08, .12] },
  storageTank: { radiusRatio: [.40, .46], heightRatio: [.66, .80], roofRatio: [.06, .10] },
  fallenViaduct: { span: [10, 16], tilt: [.08, .22], slabRatio: [.08, .12] },
});

export function environmentSize(kind, seed) {
  const def = ENVIRONMENT_OBJECTS[kind];
  if (!def || !Number.isSafeInteger(seed)) throw new RangeError('Invalid environment kind or seed');
  const [lo, hi] = ENVIRONMENT_PARAMETERS[def.category].scale;
  const factor = lo + mulberry32((seed ^ 0x53495a45) >>> 0)() * (hi - lo);
  return def.size.map(value => value * factor);
}

export function environmentAvailable(kind, input = {}) {
  if (!ENVIRONMENT_OBJECTS[kind]?.draft) return true;
  if (typeof input.ice === 'boolean') return input.ice;
  const { temperature } = forestEnvironment(input.latitude, 0, input);
  return Number.isFinite(temperature) && temperature <= (kind === 'icefloe' ? 2 : 8);
}

export function iceParts(kind, size, seed, { yaw = true } = {}) {
  const def = ENVIRONMENT_OBJECTS[kind], spec = ENVIRONMENT_PARAMETERS[def?.category];
  if (!def?.draft || !Number.isSafeInteger(seed) || !Array.isArray(size)
    || size.length !== 3 || size.some(v => !Number.isFinite(v) || v <= 0)) {
    throw new RangeError('Invalid ice model inputs');
  }
  const rnd = mulberry32(seed >>> 0), sample = range => range[0] + rnd() * (range[1] - range[0]);
  const n = Math.floor(sample([spec.sides[0], spec.sides[1] + 1]));
  const [w, h, d] = size, phase = rnd() * Math.PI * 2;
  const outline = Array.from({ length: n }, (_, i) => {
    const angle = phase + (i + .2 * (rnd() - .5)) / n * Math.PI * 2;
    const radius = sample(spec.edge);
    return [Math.cos(angle) * w * .5 * radius, Math.sin(angle) * d * .5 * radius];
  });
  const vertices = [], faces = [], colors = [];
  const tabular = kind === 'icefloe' || rnd() < .4;
  for (let ring = 0; ring < 3; ring++) for (const [x, z] of outline) {
    const factor = ring === 0 ? .55 : ring === 1 ? 1 : tabular ? .94 : .52;
    const y = ring === 0 ? 0 : ring === 1 ? h * def.draft
      : h * (def.draft + (1 - def.draft) * sample(spec.crown));
    vertices.push(x * factor, y, z * factor);
    colors.push(...(ring === 0 ? [.25, .55, .66] : ring === 1 ? [.53, .77, .84] : [.85, .94, .97]));
  }
  // Center fans cap both ends; rings share indices, so no cracks or open undersides.
  vertices.push(0, 0, 0, 0, h, 0);
  colors.push(.25, .55, .66, .91, .97, 1);
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    faces.push(3 * n, i, j, 3 * n + 1, 2 * n + j, 2 * n + i);
    for (let ring = 0; ring < 2; ring++) {
      const a = ring * n + i, b = ring * n + j, c = b + n, e = a + n;
      faces.push(a, e, b, b, e, c);
    }
  }
  const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
  vertices.forEach((value, i) => {
    min[i % 3] = Math.min(min[i % 3], value); max[i % 3] = Math.max(max[i % 3], value);
  });
  const center = min.map((value, i) => (value + max[i]) / 2);
  const dimensions = max.map((value, i) => value - min[i]);
  const mesh = { vertices: vertices.map((value, i) => value - center[i % 3]), faces, colors };
  // 整體朝向抽最後一枚(幾何與前版逐位元一致，只多轉向)；連續無縫的邊界連排由呼叫端關掉。
  const spin = yaw ? rnd() * Math.PI * 2 : 0;
  return [{ g: ['mesh', mesh, dimensions], p: center, c: null, r: [0, spin, 0],
    role: kind === 'icefloe' ? 'sea-ice' : 'glacial-ice' }];
}

export { makeSceneVehicleParts } from './vehicleCatalog.js';

export const ENVIRONMENT_PREFIX = 'environment/';
const box = (w, h, d, x, y, z, c, role, extra = {}) =>
  ({ g: ['box', w, h, d], p: [x, y, z], c, role, ...extra });
const cyl = (rt, rb, h, x, y, z, c, role, extra = {}) =>
  ({ g: ['cyl', rt, rb, h, 8], p: [x, y, z], c, role, ...extra });
const choose = (rnd, rows) => rows[Math.floor(rnd() * rows.length)];
const integer = (rnd, lo, hi) => lo + Math.floor(rnd() * (hi - lo + 1));
const sample = (rnd, range) => range[0] + rnd() * (range[1] - range[0]);
const colors = [0xb4ab99, 0x82919c, 0xc4b597, 0x96785f, 0xa9b2ab];
const rockTints = { spring: 0xdce8c8, summer: 0xffffff, autumn: 0xe1c39a, winter: 0xc9d7df };
export { rockTints as ROCK_SEASON_TINT };
const layDown = rows => rows.map(p => ({ ...p, p: [p.p[1], -p.p[0], p.p[2]],
  r: eulerXYZFromMat3(mat3Multiply(mat3FromEulerXYZ([0, 0, -Math.PI / 2]), mat3FromEulerXYZ(p.r))) }));

// Scale the complete object uniformly; host dimensions are fixed even when its silhouette varies.
function fit(rows, size) {
  const b = partsAABB(rows);
  const scale = Math.min(size[0] / (b.x1 - b.x0), size[1] / (b.y1 - b.y0), size[2] / (b.z1 - b.z0));
  if (!Number.isFinite(scale) || scale <= 0) throw new RangeError('Invalid procedural object bounds');
  return rows.map(p => ({ ...p,
    p: [(p.p[0] - (b.x0 + b.x1) / 2) * scale, (p.p[1] - b.y0) * scale,
      (p.p[2] - (b.z0 + b.z1) / 2) * scale],
    s: (p.s || [1, 1, 1]).map(v => v * scale),
  }));
}

// Closed triangular prism: the roof end meets the wall instead of floating above it.
function roofWedge(w, rise, d, x, y, color) {
  const vertices = [-w/2, 0, -d/2, w/2, 0, -d/2, w/2, rise, -d/2,
    -w/2, 0, d/2, w/2, 0, d/2, w/2, rise, d/2];
  const faces = [0, 2, 1, 3, 4, 5, 0, 1, 4, 0, 4, 3,
    1, 2, 5, 1, 5, 4, 2, 0, 3, 2, 3, 5];
  for (let i = 1; i < vertices.length; i += 3) vertices[i] -= rise / 2;
  return { g: ['mesh', { vertices, faces }, [w, rise, d]], p: [x, y + rise / 2, 0], c: color, role: 'roof-end' };
}

// A closed wall volume with an open bore. Profile is [height, outer radius].
// Existing vessel lofts cap their ends; these shells instead join inner and outer rims.
function hollowShell(profile, thickness, x, y, z, color, role) {
  const height = profile.at(-1)[0], radius = Math.max(...profile.map(p => p[1]));
  const outline = [...profile, ...[...profile].reverse().map(([level, r]) => [level, r - thickness])];
  const vertices = [], faces = [], sides = 16;
  for (const [level, r] of outline) for (let i = 0; i < sides; i++) {
    const angle = i * Math.PI * 2 / sides;
    vertices.push(r * Math.cos(angle), level - height / 2, r * Math.sin(angle));
  }
  for (let row = 0; row < outline.length; row++) for (let i = 0; i < sides; i++) {
    const next = (row + 1) % outline.length, j = (i + 1) % sides;
    const a = row * sides + i, b = next * sides + i, c = next * sides + j, d = row * sides + j;
    faces.push(a, b, c, a, c, d);
  }
  return { g: ['mesh', { vertices, faces }, [radius * 2, height, radius * 2]],
    p: [x, y + height / 2, z], c: color, role };
}

export function environmentBuildingPlan(kind, size, seed) {
  const spec = ENVIRONMENT_BUILDINGS[kind];
  if (!spec) throw new RangeError('Unknown environment building: ' + kind);
  const rnd = mulberry32(seed), sampleRange = range => range[0] + rnd() * (range[1] - range[0]);
  const [width, height, depth] = size;
  const w = width * sampleRange(spec.width), d = depth * sampleRange(spec.depth), bodyH = height * sampleRange(spec.body);
  const functional = BUILDING_FUNCTIONS[spec.type];
  const functionInfo = functional ? { type: spec.type, key: functional.range, category: functional.category, locked: true }
    : { type: spec.type, key: spec.key, category: spec.category, locked: false };
  const style = chooseArchitecture(seed, `environment/${kind}`, { functionInfo, affinity: spec.affinity,
    urban: kind !== 'house', rural: kind === 'house', building: { tags: { height: bodyH } } });
  const poly = { outer: [[-w/2,-d/2],[w/2,-d/2],[w/2,d/2],[-w/2,d/2]], holes: [] };
  const metrics = calculateFootprintMetrics(poly);
  const roofForm = resolveAdaptiveRoofForm(style.roofForm, metrics, bodyH, functionInfo.category);
  const edges = poly.outer.map((a, i) => {
    const b = poly.outer[(i + 1) % 4], dx = b[0] - a[0], dz = b[1] - a[1];
    return { x: (a[0] + b[0]) / 2, z: (a[1] + b[1]) / 2, y: 0, h: bodyH,
      hw2: Math.hypot(dx, dz) / 2, ry: Math.atan2(dz, dx), sourceId: `environment/${kind}/${seed}` };
  });
  const parts = [{ g: ['box', w, bodyH, d], p: [0, bodyH / 2, 0], c: style.wall, role: 'building-body',
    architecture: { style: style.id, roofForm, function: functionInfo.key, seed } },
    ...architecturalFacadeParts(edges, style, .12),
    ...architecturalRoofParts(poly, bodyH, style, roofForm, metrics, bodyH)];
  return { parts, style, w, d, bodyH };
}

function building(kind, w, h, d, rnd) {
  if (kind === 'greenhouse') return greenhouse(w, h, d, rnd);
  if (kind === 'ranch') return ranch(w, h, d, rnd);
  const plan = environmentBuildingPlan(kind, [w, h, d], Math.floor(rnd() * 0x100000000));
  const { parts: rows, style, bodyH } = plan;
  w = plan.w; d = plan.d;
  const trim = style.trim;
  const industrial = ['factory', 'powerplant', 'incinerator'].includes(kind);
  if (industrial) {
    const stacks = kind === 'incinerator' ? 3 : integer(rnd, 1, 2);
    const stackSpec = ENVIRONMENT_STRUCTURE_PARAMETERS.chimney;
    for (let i = 0; i < stacks; i++) {
      const x = w * (-.3 + i * .22), sh = h - bodyH;
      const baseR = Math.min(w * .05, d * .07), topR = baseR * sample(rnd, stackSpec.topRatio);
      rows.push(hollowShell([[0, baseR], [sh, topR]], topR * sample(rnd, stackSpec.wallRatio),
        x, bodyH, -d * .3, trim, 'chimney'));
      const level = sample(rnd, stackSpec.bandLevel), bandH = sh * .07, bandT = baseR * .055;
      const radiusAt = y => baseR + (topR - baseR) * y / sh;
      rows.push(hollowShell([[0, radiusAt(sh * level) + bandT], [bandH, radiusAt(sh * level + bandH) + bandT]],
        bandT, x, bodyH + sh * level, -d * .3, 0xd0c8b7, 'stack-band'));
    }
    if (kind === 'powerplant') {
      const spec = ENVIRONMENT_STRUCTURE_PARAMETERS.coolingTower;
      const radius = Math.min(w * .18, d * .26), towerH = h * sample(rnd, spec.heightRatio);
      const throat = sample(rnd, spec.throatRatio), throatY = sample(rnd, spec.throatLevel);
      const rim = sample(rnd, spec.rimRatio), thickness = radius * sample(rnd, spec.wallRatio);
      const baseH = h * .035, intakeH = h * .075, shellH = towerH - baseH - intakeH;
      const x = w / 2 + radius * 1.15, shellY = baseH + intakeH;
      const profile = Array.from({ length: 9 }, (_, i) => {
        const t = i <= 6 ? throatY * i / 6 : throatY + (1 - throatY) * (i - 6) / 2;
        const distance = t <= throatY ? (throatY - t) / throatY : (t - throatY) / (1 - throatY);
        const endR = t <= throatY ? 1 : rim;
        return [shellH * t, radius * Math.sqrt(throat * throat + (endR * endR - throat * throat) * distance * distance)];
      });
      rows.push(cyl(radius * 1.04, radius * 1.04, baseH, x, baseH / 2, 0, 0x727c7b, 'cooling-basin'));
      for (let i = 0; i < 12; i++) {
        const angle = i * Math.PI / 6, postR = radius - thickness / 2;
        rows.push(cyl(thickness / 2, thickness / 2, intakeH,
          x + postR * Math.cos(angle), baseH + intakeH / 2, postR * Math.sin(angle), 0x9ca39d, 'cooling-support'));
      }
      rows.push(hollowShell(profile, thickness, x, shellY, 0, 0x9ca39d, 'cooling-tower'));
    }
  }
  return rows;
}

function greenhouse(w, h, d, rnd) {
  const spec = ENVIRONMENT_STRUCTURE_PARAMETERS.greenhouse;
  const rows = [], bays = Math.max(1, Math.round(w / sample(rnd, spec.bay))), frame = choose(rnd, [0x879e95, 0xc0cbc1, 0x71827a]);
  const wallH = h * sample(rnd, spec.eaveRatio), pitch = Math.atan2(h - wallH, d / 2);
  const roofD = Math.hypot(d / 2, h - wallH);
  for (const side of [-1, 1]) {
    rows.push(box(w, wallH, .09, 0, wallH / 2, side * d / 2, 0xa4d2c3, 'glass-wall', { mat: 'glass' }));
    rows.push(box(w, .09, roofD, 0, (wallH + h) / 2, side * d / 4,
      0xbadbd0, 'glass-roof', { mat: 'glass', r: [side * pitch, 0, 0] }));
    rows.push(box(w, .16, .16, 0, wallH, side * d / 2, frame, 'eave-frame'));
    rows.push(box(w * .92, .4, d * .28, 0, .2, side * d * .26, 0x665443, 'growing-bed'));
    for (let i = 0; i < bays; i++) rows.push(box(w / bays * .65, .6, d * .2,
      (i + .5) * w / bays - w / 2, .65, side * d * .26, choose(rnd, [0x547f45, 0x6f934d, 0x3e704c]), 'crop'));
  }
  rows.push(box(w, .18, .18, 0, h, 0, frame, 'ridge-frame'));
  for (let i = 0; i <= bays; i++) for (const side of [-1, 1]) {
    const x = i * w / bays - w / 2;
    rows.push(box(.16, wallH, .16, x, wallH / 2, side * d / 2, frame, 'frame-post'));
    rows.push(box(.16, .16, roofD, x, (wallH + h) / 2, side * d / 4, frame,
      'roof-rafter', { r: [side * pitch, 0, 0] }));
  }
  for (const side of [-1, 1]) {
    rows.push(box(.09, wallH, d, side * w / 2, wallH / 2, 0,
      0xa4d2c3, 'glass-end', { mat: 'glass' }));
    const gable = roofWedge(d / 2, h - wallH, .09, 0, wallH, 0xa4d2c3);
    for (const end of [-1, 1]) rows.push({ ...gable, role: 'glass-gable', mat: 'glass',
      p: [side * w / 2, (wallH + h) / 2, end * d / 4], r: [0, end * Math.PI / 2, 0] });
  }
  return rows;
}

function ranch(w, h, d, rnd) {
  const rows = building('house', w * .56, h * .76, d * .55, rnd)
    .map(p => ({ ...p, p: [p.p[0] - w * .17, p.p[1], p.p[2] - d * .15] }));
  const spec = ENVIRONMENT_STRUCTURE_PARAMETERS.ranch;
  const timber = choose(rnd, [0x947754, 0xb49c71, 0xd4c9ad]);
  const fenceH = Math.min(h * .2, sample(rnd, spec.fenceHeight)), bay = sample(rnd, spec.fenceBay);
  const gateW = Math.min(w * .22, sample(rnd, spec.gateWidth)), postW = Math.min(.24, fenceH * .15);
  const posts = new Map();
  const fenceRun = (a, b) => {
    const spans = Math.max(1, Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) / bay));
    let previous;
    for (let i = 0; i <= spans; i++) {
      const node = a.map((v, k) => i === spans ? b[k] : v + (b[k] - v) * i / spans);
      posts.set(node.join(','), node);
      if (previous) for (const level of [.4, .85]) rows.push(beamBetween(
        [previous[0], fenceH * level, previous[1]], [node[0], fenceH * level, node[1]],
        postW * .3, timber, 'fence-rail'));
      previous = node;
    }
  };
  fenceRun([-w / 2, -d / 2], [w / 2, -d / 2]);
  for (const side of [-1, 1]) {
    fenceRun([side * w / 2, -d / 2], [side * w / 2, d / 2]);
    fenceRun([side * gateW / 2, d / 2], [side * w / 2, d / 2]);
  }
  for (const [x, z] of posts.values()) rows.push(box(postW, fenceH, postW, x, fenceH / 2, z, timber, 'fence-post'));
  // A closed, braced gate marks the entrance without changing the authoritative boundary.
  const gateX = gateW / 2 - postW / 2, gateColor = 0x596b70;
  for (const level of [.25, .85]) rows.push(beamBetween(
    [-gateX, fenceH * level, d / 2], [gateX, fenceH * level, d / 2], postW * .3, gateColor, 'gate-rail'));
  for (const side of [-1, 1]) rows.push(beamBetween(
    [side * gateX, fenceH * .25, d / 2], [side * gateX, fenceH * .85, d / 2], postW * .3, gateColor, 'gate-stile'));
  rows.push(beamBetween([-gateX, fenceH * .25, d / 2], [gateX, fenceH * .85, d / 2], postW * .25, gateColor, 'gate-brace'));
  const siloH = h * sample(rnd, spec.siloHeightRatio), siloR = Math.min(w * .08, d * .11), capH = siloR * .7;
  rows.push(cyl(siloR, siloR, siloH, w * .3, siloH / 2, -d * .23, 0xa8aaa1, 'feed-silo'));
  rows.push(cyl(0, siloR, capH, w * .3, siloH + capH / 2, -d * .23, 0x657777, 'silo-roof'));
  return rows;
}

// Descriptor beams use local +Y as their axis; endpoints are shared by legs and bracing.
function beamBetween(a, b, radius, color, role) {
  const delta = b.map((v, i) => v - a[i]), length = Math.hypot(...delta);
  if (!Number.isFinite(length) || length <= 0) throw new RangeError('Invalid structural beam');
  return cyl(radius, radius, length, ...a.map((v, i) => (v + b[i]) / 2), color, role,
    { r: [Math.atan2(delta[2], delta[1]), 0, -Math.asin(Math.max(-1, Math.min(1, delta[0] / length)))] });
}

function extraction(kind, w, h, d, rnd) {
  const rows = [], steel = choose(rnd, [0x7c7770, 0xa27a42, 0x626f74]);
  if (kind === 'mine') {
    const spec = ENVIRONMENT_STRUCTURE_PARAMETERS.mine;
    const levels = integer(rnd, ...spec.levels), retreat = sample(rnd, spec.retreat);
    const stepH = h * sample(rnd, spec.benchHeightRatio) / levels;
    let benchW, benchD, benchZ;
    for (let i = 0; i < levels; i++) {
      benchW = w * (1 - i * retreat * .7);
      benchD = d * (1 - i * retreat);
      benchZ = -d / 2 + benchD / 2;
      rows.push(box(benchW, stepH, benchD, 0, stepH * (i + .5), benchZ, 0x9a8770, 'mine-bench'));
    }
    // The complete excavator footprint fits on the top working bench, regardless of level count.
    rows.push(...makeSceneVehicleParts('excavator', {
      fit: { L: benchW * .7, H: h * .4, W: benchD * .8 },
      at: [0, stepH * levels, benchZ], paint: integer(rnd, 1, 65535),
    }).map(part => ({ ...part, assembly: 'mine-excavator' })));
    const pitch = sample(rnd, spec.conveyorPitch), span = w * .64, thickness = h * .025;
    const z = d * (.5 - retreat * .45), beltD = d * retreat * .55;
    const y = stepH + h * .09 + Math.sin(pitch) * span / 2;
    rows.push(box(span, thickness, beltD, 0, y, z, steel, 'conveyor', { r: [0, 0, pitch] }));
    for (const side of [-1, 1]) {
      const x = side * span * .38;
      const underside = y + x * Math.tan(pitch) - thickness / (2 * Math.cos(pitch));
      for (const edge of [-1, 1]) rows.push(beamBetween(
        [x, stepH, z + edge * beltD * .3], [x, underside, z + edge * beltD * .3],
        Math.min(w, d) * .008, steel, 'conveyor-support'));
    }
  } else {
    const spec = ENVIRONMENT_STRUCTURE_PARAMETERS.derrick;
    const bays = integer(rnd, ...spec.bays), crown = sample(rnd, spec.crownRatio);
    const radius = Math.min(w, d) * sample(rnd, spec.legRatio);
    const cx = -w * .1, baseY = h * .045, topY = h * .96;
    const corners = [[-1, -1], [1, -1], [1, 1], [-1, 1]];
    const node = (level, corner) => {
      const t = level / bays, taper = 1 - t * (1 - crown), [sx, sz] = corners[corner];
      return [cx + sx * w * .22 * taper, baseY + (topY - baseY) * t, sz * d * .23 * taper];
    };
    rows.push(box(w * .6, baseY, d * .6, cx, baseY / 2, 0, 0x788080, 'rig-floor'));
    for (let corner = 0; corner < 4; corner++) {
      rows.push(beamBetween(node(0, corner), node(bays, corner), radius, steel, 'derrick-leg'));
      const next = (corner + 1) % 4;
      for (let level = 0; level <= bays; level++) {
        rows.push(beamBetween(node(level, corner), node(level, next), radius * .65, steel, 'derrick-frame'));
        if (level === bays) continue;
        rows.push(beamBetween(node(level, corner), node(level + 1, next), radius * .45, steel, 'derrick-brace'));
        rows.push(beamBetween(node(level, next), node(level + 1, corner), radius * .45, steel, 'derrick-brace'));
      }
    }
    rows.push(box(w * .44 * crown + radius * 2, h * .025, d * .46 * crown + radius * 2,
      cx, topY, 0, steel, 'crown-block'));
    rows.push(cyl(radius * .3, radius * .3, topY - baseY,
      cx, (topY + baseY) / 2, 0, 0x464e52, 'drill-string'));
    const tankH = h * sample(rnd, spec.tankHeightRatio), tankR = Math.min(w * .095, d * .12);
    rows.push(cyl(tankR, tankR, tankH, w * .35, tankH / 2, d * .15, 0xaaa99b, 'storage-tank'));
    rows.push(cyl(0, tankR, h * .035, w * .35, tankH + h * .0175, d * .15, 0x737f80, 'tank-roof'));
  }
  return rows;
}

function rocks(type, seed, season, { yaw = true } = {}) {
  const model = geologyBackgroundObject(type, seed, { segments: 12 });
  const { min, max, size } = model.bounds, center = min.map((v, i) => (v + max[i]) / 2);
  const tint = rockTints[season] || rockTints.summer;
  const colors = model.meshData.colors.map((value, i) => value * ((tint >> (16 - i % 3 * 8)) & 255) / 255);
  const meshData = { ...model.meshData, colors,
    vertices: model.meshData.vertices.map((v, i) => v - center[i % 3]) };
  // rocks 本身無 rnd 流，朝向另起一種子流(不推移既有幾何)；連續無縫的邊界連排由呼叫端關掉。
  const spin = yaw ? mulberry32(((seed ^ 0xB17D) >>> 0))() * Math.PI * 2 : 0;
  return [{ g: ['mesh', meshData, size], p: [0, size[1] / 2, 0], c: null, r: [0, spin, 0], role: 'rock-mass' }];
}

function ship(seed) {
  const vessel = generateVessel(seed, { id: 'container' });
  const { length: L, beam: B, draft: D, freeboard: F, layout } = vessel;
  const meshData = loftMeshData(vesselHullSections(vessel));
  // Ship models use longitudinal Z; boundary descriptors use longitudinal X.
  const vertices = meshData.vertices.map((value, i, v) => i % 3 === 0 ? v[i + 2] : i % 3 === 2 ? -v[i - 2] : value);
  const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
  vertices.forEach((v, i) => { min[i % 3] = Math.min(min[i % 3], v); max[i % 3] = Math.max(max[i % 3], v); });
  const center = min.map((v, i) => (v + max[i]) / 2), size = max.map((v, i) => v - min[i]);
  const data = { ...meshData, vertices: vertices.map((v, i) => v - center[i % 3]) };
  const rows = [{ g: ['mesh', data, size], p: center, c: vessel.hullColor, role: 'hull' },
    box(L * .72, B * .025, B * .8, 0, F, 0, 0x899395, 'deck')];
  for (const c of layout.cabins) {
    rows.push(box(c.d, c.h, c.w, c.z, c.y + c.h / 2, -c.x, vessel.trimColor, 'bridge'));
    rows.push(box(c.d * 1.01, c.h * .12, c.w * 1.01, c.z, c.y + c.h * .75, -c.x,
      0x436b7b, 'bridge-window', { mat: 'glass' }));
    rows.push(cyl(B * .016, B * .022, B * .3, c.z, c.y + c.h + B * .15, -c.x, 0x6c787b, 'mast'));
  }
  return rows;
}

export function environmentParts(kind, { size = ENVIRONMENT_OBJECTS[kind]?.size, seed = 1, season = 'summer', yaw = true } = {}) {
  if (!ENVIRONMENT_OBJECTS[kind]) throw new RangeError(`Unknown environment object: ${kind}`);
  if (!Number.isSafeInteger(seed) || !Array.isArray(size) || size.length !== 3
    || size.some(v => !Number.isFinite(v) || v <= 0)) throw new RangeError('Invalid environment dimensions or seed');
  const [w, h, d] = size, rnd = mulberry32(seed >>> 0);
  let rows;
  if (ENVIRONMENT_OBJECTS[kind].draft) rows = iceParts(kind, size, seed, { yaw });
  else if (kind === 'car') rows = makeSceneVehicleParts('sedan', { fit: { L: w, H: h, W: d }, paint: seed });
  else if (kind === 'gianttree' || kind === 'fallentree') {
    const tree = createForestTree(choose(rnd, ['redwood', 'sequoia']), seed, undefined, undefined, 1, season);
    rows = tree.parts.filter(p => kind !== 'fallentree' || !['leaf', 'flower', 'fruit'].includes(p.role)).map(p => {
      const g = p.g.parameters;
      return { g: g.height ? ['cyl', g.radiusTop, g.radiusBottom, g.height, g.radialSegments] : ['ico', g.radius],
        p: [p.px || 0, p.y || 0, p.pz || 0], r: [p.rx || 0, 0, p.rz || 0], s: [1, p.sy || 1, 1], c: p.c, role: p.role };
    });
    if (kind === 'fallentree') rows = layDown(rows);
  } else if (kind === 'boulder') rows = rocks(choose(rnd, ['granite', 'sandstone', 'basalt']), seed, season, { yaw });
  else if (kind === 'mine' || kind === 'oilfield') rows = extraction(kind, w, h, d, rnd);
  else if (kind === 'strandedship') rows = ship(seed);
  else if (kind === 'skyfall') rows = layDown(building('skyscraper', h * .55, w, d * .8, rnd));
  else rows = building(kind, w, h, d, rnd);
  const fitted = fit(rows, size);
  if (!ENVIRONMENT_OBJECTS[kind].draft) return fitted;
  const bounds = partsAABB(fitted), waterline = (bounds.y1 - bounds.y0) * ENVIRONMENT_OBJECTS[kind].draft;
  return fitted.map(part => ({ ...part, waterline }));
}

function aquacultureParts(kind, len, d, h, seed) {
  const floating = kind === 'searanch';
  const spec = ENVIRONMENT_STRUCTURE_PARAMETERS[floating ? 'fishCage' : 'oysterRack'];
  const rnd = mulberry32(seed >>> 0), rows = [];
  const count = Math.max(1, Math.round(len / sample(rnd, spec.bay))), step = len / count;
  for (let i = 0; i < count; i++) {
    const local = mulberry32((seed ^ Math.imul(i + 1, 0x9e3779b9)) >>> 0);
    const x = (i + .5) * step - len / 2;
    const halfW = step * .44, halfD = Math.min(d * .4, step * .42);
    if (!floating) {
      const railY = Math.min(h * .7, sample(local, spec.height));
      const wood = choose(local, [0x8e7d5e, 0x847354, 0x988768]);
      // Four grounded posts support both rails; crossbars carry the hanging crop.
      for (const sx of [-1, 1]) for (const sz of [-1, 1]) rows.push(cyl(.09, .12, railY,
        x + sx * halfW, railY / 2, sz * halfD, wood, 'rack-post'));
      for (const sz of [-1, 1]) rows.push(box(halfW * 2 + .18, .16, .16,
        x, railY, sz * halfD, wood, 'longline'));
      const lines = integer(local, ...spec.lines);
      for (let k = 0; k < lines; k++) {
        const xx = x + ((k + .5) / lines * 2 - 1) * halfW;
        rows.push(box(.1, .12, halfD * 2 + .16, xx, railY + .08, 0, wood, 'rack-crossbar'));
        for (const sz of [-1, 0, 1]) {
          const drop = railY * sample(local, spec.dropRatio), zz = sz * halfD * .7;
          rows.push(cyl(.025, .025, drop, xx, railY - drop / 2, zz, 0x4f6667, 'culture-line'));
          for (let shell = 1; shell <= 4; shell++) rows.push({ g: ['ico', .08],
            p: [xx, railY - drop * shell / 5, zz], s: [.7, 1.5, 1], c: 0x7a8071, role: 'oyster-cluster' });
        }
      }
    } else {
      const netDepth = Math.min(h * .6, sample(local, spec.depth));
      const width = Math.min(step * .08, d * .08, sample(local, spec.floatWidth));
      const waterline = netDepth + .12;
      const motion = { kind: 'float', id: `float_${i}`, pivot: [x, waterline, 0], phase: local() * Math.PI * 2, pad: 0 };
      const extra = { motion, waterline };
      const tint = choose(local, [0x3f6f7a, 0x42646b, 0x557980]);
      for (const sz of [-1, 1]) rows.push(box(halfW * 2 + width, width, width,
        x, waterline, sz * halfD, tint, 'cage-float', extra));
      for (const sx of [-1, 1]) rows.push(box(width, width, halfD * 2,
        x + sx * halfW, waterline, 0, tint, 'cage-float', extra));
      // Sparse net lattice is readable low-poly geometry, including a closed bottom.
      const bays = integer(local, ...spec.meshBays), bottom = waterline - netDepth;
      for (let k = 0; k <= bays; k++) {
        const t = k / bays * 2 - 1;
        for (const side of [-1, 1]) {
          rows.push(box(.025, netDepth, .025, x + t * halfW, waterline - netDepth / 2,
            side * halfD, 0x344d4d, 'cage-net', extra));
          rows.push(box(.025, netDepth, .025, x + side * halfW, waterline - netDepth / 2,
            t * halfD, 0x344d4d, 'cage-net', extra));
        }
        rows.push(box(.025, .025, halfD * 2, x + t * halfW, bottom, 0, 0x344d4d, 'cage-bottom', extra));
        rows.push(box(halfW * 2, .025, .025, x, bottom, t * halfD, 0x344d4d, 'cage-bottom', extra));
      }
      for (let level = 0; level < 3; level++) for (const side of [-1, 1]) {
        const y = bottom + netDepth * level / 3;
        rows.push(box(halfW * 2, .025, .025, x, y, side * halfD, 0x344d4d, 'cage-net', extra));
        rows.push(box(.025, .025, halfD * 2, x + side * halfW, y, 0, 0x344d4d, 'cage-net', extra));
      }
    }
  }
  return rows;
}

// Array/linear forms are only exposed through the boundary catalog. Every module receives
// its own seed, so adding detail to one module cannot perturb its neighbours.
export function storageTankParts({ w, h, d, seed = 1 }) {
  if (![w, h, d].every(v => Number.isFinite(v) && v > 0) || !Number.isSafeInteger(seed))
    throw new RangeError('Invalid storage tank dimensions or seed');
  const rnd = mulberry32(seed >>> 0), spec = ENVIRONMENT_STRUCTURE_PARAMETERS.storageTank;
  const radius = Math.min(w, d) * sample(rnd, spec.radiusRatio);
  const bodyH = h * sample(rnd, spec.heightRatio), roofH = h * sample(rnd, spec.roofRatio), baseH = h * .035;
  const color = choose(rnd, [0xb3bab6, 0xc0c7c3, 0xa5ada9]);
  return [cyl(radius * 1.04, radius * 1.04, baseH, 0, baseH / 2, 0, 0x737c79, 'tank-foundation'),
    cyl(radius, radius, bodyH, 0, baseH + bodyH / 2, 0, color, 'storage-tank'),
    cyl(0, radius, roofH, 0, baseH + bodyH + roofH / 2, 0, 0x6e7c80, 'tank-roof')];
}

export const NARROW_GEOLOGY_BOUNDARY = Object.freeze({
  cliff: 'cliff', rockery: 'mountain', landslide: 'moraine', debris: 'mound',
  isletbarrier: 'island', basaltspine: 'basalt', rollinghills: 'mountain', reefchain: 'reef',
});

// 假山群基底：按種子輪用一般地質，拉狹長型成高低變化大的連綿起伏。
export const ROCKERY_BASES = Object.freeze(['granite', 'sandstone', 'tor', 'mountain']);

// 地質邊界一次使用狹長/2D 連續型單體：整段一個連續起伏網格（基底為各類地形，突起數量／
// 起伏程度由長寬比推導的種子隨機範圍決定），不再逐段零星散置。
// 支援 2 維延伸往緩衝區擴大（bufferDepth > 0），把緩衝區完全填滿。
// 幾何與季節無關（四季共用同一網格），季節差異只在 tint 色調。零共享亂數、決定性。
export function narrowGeologyBoundary(kind, { len, depth: d, h, seed = 1, season = 'summer', bufferDepth = 0 }) {
  let type = NARROW_GEOLOGY_BOUNDARY[kind];
  if (!type) throw new RangeError(`Not a narrow geology boundary: ${kind}`);
  if (kind === 'rockery') {
    const pick = mulberry32((seed ^ 0x524f434b) >>> 0);
    type = ROCKERY_BASES[Math.floor(pick() * ROCKERY_BASES.length) % ROCKERY_BASES.length];
  }
  if (![len, d, h].every(v => Number.isFinite(v) && v > 0) || !Number.isSafeInteger(seed))
    throw new RangeError('Invalid narrow geology boundary dimensions or seed');
  const bufD = Math.max(0, Number.isFinite(bufferDepth) ? bufferDepth : 0);
  const tint = rockTints[season] || rockTints.summer;
  const ridge = elongatedGeologyMesh(type, seed >>> 0, { len, depth: d, height: h, tint, bufferDepth: bufD });
  // 網格頂點 y ∈ [0, peakY]；後移半高使 AABB 量尺與渲染位置一致（同 rocks 的置中慣例）。
  const centered = { ...ridge.meshData,
    vertices: ridge.meshData.vertices.map((v, i) => (i % 3 === 1 ? v - ridge.size[1] / 2 : v)) };
  const rows = [{ g: ['mesh', centered, ridge.size], p: [0, ridge.size[1] / 2, 0], c: null, role: 'rock-mass' }];
  const bufferParts = [];
  if (ridge.bufferMeshData) {
    const centeredBuf = { ...ridge.bufferMeshData,
      vertices: ridge.bufferMeshData.vertices.map((v, i) => (i % 3 === 1 ? v - ridge.bufferSize[1] / 2 : v)) };
    const bufPart = {
      g: ['mesh', centeredBuf, ridge.bufferSize],
      p: [0, ridge.bufferSize[1] / 2, -d / 2 - bufD / 2],
      c: null,
      role: 'boundary-buffer-fill',
      boundaryBuffer: true,
    };
    rows.push(bufPart);
    bufferParts.push(bufPart);
  }
  if (kind === 'debris' || kind === 'landslide') {
    // 倒木覆蓋層：依長寬比取 1–3 株，種在突起之間的谷底（基底埋入 .3），
    // 谷底過高無足夠淨空時整株略過（脊體本身已足夠），全程收在包絡內。
    const nTree = Math.max(1, Math.min(3, Math.round(len / 24)));
    const bumps = ridge.params.bumps;
    for (let k = 0; k < nTree; k++) {
      const local = mulberry32((seed ^ Math.imul(k + 1, 0x85ebca6b)) >>> 0);
      const m = bumps > 1 ? Math.max(1, Math.min(bumps - 1, Math.round((k + 1) * bumps / (nTree + 1)))) : 0;
      const tw = Math.min(len / nTree * .7, 10);
      const rawU = (m === 0 ? (k % 2 ? .7 : -.7) : -1 + 2 * m / bumps) * len / 2
        + (local() - .5) * len / Math.max(8, bumps) * .3;
      const tu = Math.max(-len / 2 + tw / 2 + 1e-6, Math.min(len / 2 - tw / 2 - 1e-6, rawU));
      const td = d * .6;
      const tv = Math.max(-d / 2 + td / 2 + 1e-6,
        Math.min(d / 2 - td / 2 - 1e-6, (local() - .5) * d * .4));
      const floorY = Math.max(0, ridge.heightAt(
        Math.max(-1, Math.min(1, tu / (len / 2))), Math.max(-1, Math.min(1, tv / (d / 2)))));
      if (floorY > h - 1.3) continue;
      const treeH = Math.min(h * .25, h - floorY);
      const tree = environmentParts('fallentree',
        { size: [tw, treeH, td], seed: (seed ^ Math.imul(k + 33, 0x27d4eb2f)) >>> 0 });
      const tb = partsAABB(tree);
      const ty = floorY - tb.y0 - .3;
      rows.push(...tree.map(p => ({ ...p, p: [p.p[0] + tu, p.p[1] + ty, p.p[2] + tv] })));
    }
  }
  rows.parts = rows.filter(p => !p.boundaryBuffer);
  rows.bufferParts = bufferParts;
  return rows;
}

export function linearEnvironmentParts(kind, { len, depth: d, h, seed = 1, season = 'summer', latDeg = 25.0, joins = null }) {
  if (kind === 'searanch' || kind === 'oysterracks') return aquacultureParts(kind, len, d, h, seed);
  if (NARROW_GEOLOGY_BOUNDARY[kind]) return narrowGeologyBoundary(kind, { len, depth: d, h, seed, season });
  const rnd = mulberry32(seed >>> 0), rows = [];
  const count = Math.max(1, Math.floor(len / (kind === 'deeprig'
    ? sample(rnd, ENVIRONMENT_STRUCTURE_PARAMETERS.offshoreRig.bay) : kind === 'viaduct'
      ? sample(rnd, ENVIRONMENT_STRUCTURE_PARAMETERS.fallenViaduct.span) : kind.startsWith('wind') ? 18 : 9)));
  const step = len / count;
  const stone = choose(rnd, [0x8c908b, 0x9b927f, 0x738185]);
  if (['tetrapod', 'wetpods'].includes(kind)) {
    const spec = ENVIRONMENT_STRUCTURE_PARAMETERS.tetrapod;
    const stoneColor = kind === 'wetpods' ? choose(rnd, [0x777c7d, 0x6e7374, 0x818687]) : choose(rnd, [0x8c908b, 0x838782, 0x959994]);
    const layers = integer(rnd, ...spec.layers);
    const nPods = Math.max(1, Math.floor(len / sample(rnd, spec.spacing)));
    const podStep = len / nPods;
    const r = Math.min(podStep / 4.8, h / (layers * 3.6), d / 10);
    for (let pIdx = 0; pIdx < nPods; pIdx++) {
      const cx = -len / 2 + (pIdx + .5) * podStep;
      const podLocal = mulberry32((seed ^ Math.imul(pIdx + 1, 0x1f1f)) >>> 0);
      for (let layer = 0; layer < layers; layer++) for (const side of [-1, 1]) {
        const firstPart = rows.length;
        const px = cx + (layer % 2 ? .05 : -.05) * podStep;
        const y = r * (1.25 + layer * 1.65), z = side * d * .24;
        const yaw = sample(podLocal, spec.yaw), armLength = r * sample(podLocal, spec.armLength);
        const tip = r * sample(podLocal, spec.tipRatio);
        const pod = `${pIdx}_${layer}_${side}`;
        rows.push({ g: ['ico', r * .65], p: [px, y, z], c: stoneColor, role: 'breakwater-core', layer, pod });
        // One upward leg and three downward legs: pairwise dot product is -1/3.
        for (let arm = 0; arm < 4; arm++) {
          const azimuth = yaw + (arm - 1) * Math.PI * 2 / 3;
          const dy = arm === 0 ? 1 : -1 / 3;
          const radial = Math.sqrt(1 - dy * dy);
          const dx = radial * Math.cos(azimuth), dz = radial * Math.sin(azimuth);
          rows.push(cyl(tip, r * .65, armLength,
            px + dx * armLength / 2, y + dy * armLength / 2, z + dz * armLength / 2,
            stoneColor, 'breakwater-arm', { r: [Math.atan2(dz, dy), 0, -Math.asin(dx)], pod }));
        }
        const bounds = partsAABB(rows.slice(firstPart));
        // End units meet the segment face so consecutive breakwater runs stay joined.
        const endShift = nPods === 1 ? 0 : pIdx === 0 ? -len / 2 - bounds.x0
          : pIdx === nPods - 1 ? len / 2 - bounds.x1 : 0;
        for (let j = firstPart; j < rows.length; j++) {
          rows[j].p[0] += endShift;
          rows[j].p[1] += layer * r * 1.65 - bounds.y0;
        }
      }
    }
    return rows;
  }
  for (let i = 0; i < count; i++) {
    const x = (i + .5) * step - len / 2;
    const local = mulberry32((seed ^ Math.imul(i + 1, 0x9e3779b9)) >>> 0);
    if (kind.startsWith('wind')) {
      const spec = ENVIRONMENT_STRUCTURE_PARAMETERS.wind;
      const radius = Math.min(step * sample(local, spec.rotorRatio), h * .24, d * .35), hubY = h - radius - .2;
      const z = 1.2, pivot = [x, hubY, z], phase = local() * Math.PI * 2;
      rows.push(cyl(.32, .7, hubY, x, hubY / 2, 0, 0xd4dcda, 'tower-column'));
      rows.push(box(1.2, 1, 2.2, x, hubY, 0, stone, 'nacelle'));
      if (kind === 'windsea') rows.push(cyl(.9, 1, 3, x, 1.5, 0, 0xd3ab44, 'monopile'));
      rows.push(cyl(.28, .28, .4, x, hubY, 1.1, 0xd4dcda, 'rotor-hub', { r: [Math.PI / 2, 0, 0] }));
      const blades = spec.blades, chord = sample(local, spec.chord);
      for (let j = 0; j < blades; j++) {
        const a = j / blades * Math.PI * 2;
        rows.push(box(chord, radius, .16, x + Math.cos(a) * radius * .5,
          hubY + Math.sin(a) * radius * .5, z, 0xe1e5df, 'rotor-blade',
          { r: [0, 0, a - Math.PI / 2], motion: { kind: 'rotor', id: `rotor_${i}`, pivot, phase } }));
      }
    } else if (kind === 'viaduct') {
      const spec = ENVIRONMENT_STRUCTURE_PARAMETERS.fallenViaduct;
      const slabH = h * sample(local, spec.slabRatio), girderH = h * .14, railH = h * .12;
      const width = d * .84, span = step * .94, concrete = choose(local, colors);
      const fragment = [box(span, slabH, width, 0, girderH + slabH / 2, 0, concrete, 'fallen-deck'),
        box(span * .98, slabH * .06, width * .84, 0, girderH + slabH * 1.03, 0, 0x454c50, 'road-surface')];
      for (const side of [-1, 1]) {
        fragment.push(box(span, girderH, width * .12, 0, girderH / 2, side * width * .27, concrete, 'deck-girder'));
        fragment.push(box(span, railH, width * .08, 0, girderH + slabH + railH / 2,
          side * width * .46, concrete, 'deck-parapet'));
      }
      const tilt = (i % 2 ? -1 : 1) * sample(local, spec.tilt), rotation = mat3FromEulerXYZ([0, 0, tilt]);
      const tilted = fragment.map(p => ({ ...p, p: [Math.cos(tilt) * p.p[0] - Math.sin(tilt) * p.p[1],
        Math.sin(tilt) * p.p[0] + Math.cos(tilt) * p.p[1], p.p[2]],
        r: eulerXYZFromMat3(mat3Multiply(rotation, mat3FromEulerXYZ(p.r))), fragment: i }));
      rows.push(...fit(tilted, [step * .94, h, d * .96]).map(p => ({ ...p, p: [p.p[0] + x, p.p[1], p.p[2]] })));
    } else if (kind === 'citywall') {
      const mStone = choose(rnd, [0x989789, 0x919082, 0x9f9e90]), bodyH = h * .68;
      rows.push(box(step, bodyH, d * .76, x, bodyH / 2, 0, mStone, 'wall-course'));
      const courses = 4;
      for (let k = 1; k <= courses; k++) rows.push(box(step, h * .018, d * .81,
        x, bodyH * k / courses, 0, 0x646d6b, 'course-joint'));
      const teeth = Math.max(2, Math.round(step / 2.0)), toothW = step / teeth;
      for (let k = 0; k < teeth; k++) rows.push(box(toothW * .5, h * .13, d * .8,
        x + (k + .5) * toothW - step / 2, bodyH + h * .065, 0, mStone, 'battlement'));
      if (i % 3 === 0) rows.push(box(step * .5, h * .25, d * .9,
        x, h * .805, 0, choose(local, colors), 'watchtower'));
      // 端點或自身延伸甕城連接
      if (i === 0 || i === count - 1) {
        const endIdx = i === 0 ? 0 : 1;
        const j = joins ? joins[endIdx] : { kind: 'citywall' };
        const jKind = j ? (j.kind || j) : null;
        if (!jKind || !NATURAL_CLIFF_KINDS.has(jKind)) {
          const isEndpoint = !jKind || jKind !== 'citywall';
          rows.push(...citywallBarbicanParts({
            len, depth: d, h, seed: (seed ^ Math.imul(endIdx + 1, 0x7391)) >>> 0,
            endIdx, isEndpoint,
          }));
        }
      }
    } else if (['solarfield', 'floatsolar'].includes(kind)) {
      // 浮動式貼合：水面款整組浮台掛 float 動態（與海面共用風時鐘/波浪係數），陸域款保持靜態
      const isFloat = kind === 'floatsolar';
      const spec = ENVIRONMENT_STRUCTURE_PARAMETERS.solar;
      const optTilt = optimalSolarTiltRad(latDeg ?? 25.0);
      const isNorth = (latDeg ?? 25.0) >= 0;
      // Limit tilt by clearance above the platform; deeper boundary modules stay supported.
      const pitch = (isNorth ? -1 : 1) * Math.min(optTilt, Math.atan2(.6, d * .38));
      const gridLines = integer(local, ...spec.gridLines);
      for (const side of [-1, 1]) {
        const y = 1.1, z = side * d * .23;
        const floatMot = isFloat ? {
          kind: 'float', id: `float_${i}_${side > 0 ? 'p' : 'm'}`,
          pivot: [x, y, z],
          phase: (((seed ^ Math.imul(i + 1, 0x9e3779b9) ^ Math.imul(side + 2, 0x85ebca6b)) >>> 0) / 4294967296) * Math.PI * 2,
          pad: 0.3, // 波浪起伏包絡：恰收進邊界包絡（底座 y0=0.325−pad 恆 ≥0），不足以上抬仍遠在碰撞柱內
        } : undefined;
        rows.push(box(step * .9, .35, d * .4, x, .5, z, 0x777e78, 'panel-support', floatMot ? { motion: floatMot } : undefined));
        const panel = box(step * .88, .14, d * .38, x, y, z, choose(local, [0x264461, 0x355875]),
          'solar-panel', { r: [pitch, 0, 0], ...(floatMot ? { motion: floatMot } : {}) });
        rows.push(panel);
        rows.push(box(step * .65, .5, .18, x, .825, z, 0x777e78, 'panel-pedestal', floatMot ? { motion: floatMot } : undefined));
        for (let k = 0; k < gridLines; k++) {
          const grid = box(.05, .05, d * .37,
            x + ((k + .5) / gridLines - .5) * step * .8,
            y + .096 * Math.cos(pitch), z + .096 * Math.sin(pitch), 0xa8babd, 'panel-grid', { r: [pitch, 0, 0] });
          if (floatMot) grid.motion = floatMot;
          rows.push(grid);
        }
      }
    } else if (['train', 'trucks', 'ship', 'rowhouse', 'edgehamlet', 'giantforest'].includes(kind)) {
      const object = { rowhouse: 'house', edgehamlet: 'house', ship: 'strandedship', giantforest: 'gianttree' }[kind];
      const parts = object ? environmentParts(object, { size: [step * .92, h, d * .9], seed: seed ^ (i + 1), season })
        : makeSceneVehicleParts(kind === 'train' ? 'railcar' : 'truck',
          { fit: { L: step * .95, H: h, W: d * .9 }, paint: seed ^ (i + 1) });
      // 車輛／船隻連排：逐架 180° 翻轉＋縱向微小間距誤差（決定性 local 流；
      // 180° 繞 Y 保持置中 AABB 不變；單元最寬 0.95 step、|jx| ≤ 0.02 step → 相鄰中心 ≥ 0.96 step，保證不重疊）
      const flip = ['train', 'trucks', 'ship'].includes(kind);
      const yaw = flip ? (local() < 0.5 ? Math.PI : 0) : 0;
      const jx = flip ? (local() - 0.5) * step * 0.04 : 0;
      const cy = Math.cos(yaw), sy = Math.sin(yaw);
      rows.push(...parts.map(p => {
        const [px = 0, py = 0, pz = 0] = p.p || [];
        const rRot = yaw !== 0 ? (p.r ? [p.r[0], (p.r[1] || 0) + yaw, p.r[2]] : [0, yaw, 0]) : p.r;
        return { ...p, p: [px * cy + pz * sy + x + jx, py, -px * sy + pz * cy], ...(rRot ? { r: rRot } : {}) };
      }));
    } else if (kind === 'seaice') {
      // 浮冰連排：逐段 180° 翻轉＋縱向微小間距誤差（寬收至 0.94 step、|jx| ≤ 0.02 step，保證不重疊）
      const yaw = local() < 0.5 ? Math.PI : 0;
      const jx = (local() - 0.5) * step * 0.04;
      const cy = Math.cos(yaw), sy = Math.sin(yaw);
      rows.push(...environmentParts('icefloe', { size: [step * .94, Math.min(h, step * .16), d], seed: seed ^ (i + 1), yaw: false })
        .map(p => {
          const [px = 0, py = 0, pz = 0] = p.p || [];
          const rRot = yaw !== 0 ? (p.r ? [p.r[0], (p.r[1] || 0) + yaw, p.r[2]] : [0, yaw, 0]) : p.r;
          return { ...p, p: [px * cy + pz * sy + x + jx, py, -px * sy + pz * cy], ...(rRot ? { r: rRot } : {}) };
        }));
    } else if (kind === 'deeprig') {
      const spec = ENVIRONMENT_STRUCTURE_PARAMETERS.offshoreRig;
      const pontoonH = h * sample(local, spec.pontoonRatio), deckY = h * sample(local, spec.deckRatio);
      const deckT = h * .04, waterline = pontoonH * .55;
      const first = rows.length;
      for (const side of [-1, 1]) {
        rows.push(box(step * .9, pontoonH, d * .18, x, pontoonH / 2, side * d * .3, 0x686f70, 'pontoon'));
        for (const end of [-1, 1]) rows.push(box(step * .07, deckY - pontoonH, d * .1,
          x + end * step * .3, (deckY + pontoonH) / 2, side * d * .3, 0x9b9e8d, 'platform-column'));
      }
      rows.push(box(step * .92, deckT, d * .86, x, deckY + deckT / 2, 0, 0x686f70, 'platform-deck'));
      rows.push(...environmentParts('oilfield', { size: [step * .82, h - deckY - deckT, d * .78], seed: seed ^ (i + 1) })
        .map(p => ({ ...p, p: [p.p[0] + x, p.p[1] + deckY + deckT, p.p[2]] })));
      for (let j = first; j < rows.length; j++) rows[j].waterline = waterline;
    } else throw new RangeError(`Unknown linear environment: ${kind}`);
  }
  return rows;
}

export const NATURAL_CLIFF_KINDS = Object.freeze(new Set(['cliff', 'landslide', 'debris']));

/**
 * 城牆甕城零件生成：
 * 城牆自身持續延伸時透過甕城連接，與懸崖峭壁/土石流/崩塌地之外的物件相接時建立甕城作為端點。
 * 零件嚴格收納在端點範圍內，不超出 [-len/2, len/2]。
 */
export function citywallBarbicanParts({ len, depth: d, h, seed = 1, endIdx = 0, isEndpoint = false }) {
  const rnd = mulberry32((seed ^ 0x62617262) >>> 0);
  const rows = [];
  const W_b = Math.min(10, len * 0.24);
  const sign = endIdx === 0 ? -1 : 1;
  const margin = 0.1;
  const bx = sign * (len / 2 - W_b / 2 - margin);
  const mStone = choose(rnd, [0x989789, 0x919082, 0x9f9e90]);
  const bodyH = h * 0.68;

  // 1. 甕城外凸圍護城牆 (barbican-wall)：在 -z 方向（緩衝區側）延伸圍護 (嚴格約束 z 落在 [-d/2, d/2] 內)
  const wallThick = d * 0.18;
  const frontZ = -d / 2 + wallThick / 2;
  // 前側甕城牆 (外緣恰貼齊 -d/2)
  rows.push(box(W_b * 0.88, bodyH, wallThick, bx, bodyH / 2, frontZ, mStone, 'barbican-wall'));
  // 左右兩側翼牆 (向內延伸連接主牆)
  const flankW = Math.max(0.6, W_b * 0.16);
  const flankD = Math.abs(frontZ);
  rows.push(box(flankW, bodyH, flankD, bx - W_b * 0.44 + flankW / 2, bodyH / 2, -flankD / 2, mStone, 'barbican-wall'));
  rows.push(box(flankW, bodyH, flankD, bx + W_b * 0.44 - flankW / 2, bodyH / 2, -flankD / 2, mStone, 'barbican-wall'));

  // 2. 甕城水平石層接縫 (course-joint) - 高程與城牆主體 4 層完全一致
  const courses = 4;
  for (let k = 1; k <= courses; k++) {
    rows.push(box(W_b * 0.9, h * 0.018, wallThick, bx, bodyH * k / courses, frontZ, 0x646d6b, 'course-joint'));
  }

  // 3. 甕城頂部垛口 (battlement)
  const teeth = Math.max(2, Math.round(W_b / 2.0));
  const toothW = (W_b * 0.88) / teeth;
  for (let k = 0; k < teeth; k++) {
    rows.push(box(toothW * 0.5, h * 0.12, wallThick,
      bx - W_b * 0.44 + (k + 0.5) * toothW, bodyH + h * 0.06, frontZ, mStone, 'battlement'));
  }

  // 4. 甕城門洞 (barbican-gate) 與門拱 (gate-arch)
  const gateW = Math.min(3.2, W_b * 0.36);
  const gateH = bodyH * 0.62;
  rows.push(box(gateW, gateH, wallThick, bx, gateH / 2, frontZ, 0x242220, 'barbican-gate'));
  rows.push(box(gateW * 1.15, h * 0.04, wallThick, bx, gateH + h * 0.02, frontZ, 0x5a5d5c, 'gate-arch'));

  // 5. 甕城城樓 (barbican-tower)：座落於主牆與甕城接合之門樓 (嚴格限制頂部高度不超高 h，深度收於 [-d/2, d/2])
  const towerW = W_b * 0.58;
  const towerH = h * 0.20;
  const towerD = d * 0.72;
  const towerColor = choose(rnd, [0x8a3832, 0x7a302a, 0x6e322b]);
  // 樓身
  rows.push(box(towerW, towerH, towerD, bx, bodyH + towerH / 2, -d * 0.04, towerColor, 'barbican-tower'));
  // 歇山頂／廡殿頂大屋簷
  rows.push(box(towerW * 1.22, h * 0.05, d * 0.88, bx, bodyH + towerH + h * 0.025, -d * 0.04, 0x3d4349, 'barbican-tower'));
  // 屋脊
  rows.push(box(towerW * 0.82, h * 0.03, d * 0.22, bx, bodyH + towerH + h * 0.065, -d * 0.04, 0x2b3035, 'barbican-tower'));

  return rows;
}

/**
 * 河堤閘門零件生成：
 * 河堤自身持續延伸時透過閘門連接，與懸崖峭壁/土石流/崩塌地之外的物件相接時建立閘門作為端點。
 * 包含閘墩、防汛閘板、起閉機架、捲揚機箱、檢修便橋與導水翼牆。
 */
export function leveeGateParts({ len, depth: d, h, seed = 1, endIdx = 0, isEndpoint = false }) {
  const rnd = mulberry32((seed ^ 0x67617465) >>> 0);
  const rows = [];
  const gateW = Math.min(8, len * 0.22);
  const sign = endIdx === 0 ? -1 : 1;
  const margin = 0.25;
  const gx = sign * (len / 2 - gateW / 2 - margin);

  const pierW = Math.max(0.6, gateW * 0.14);
  const pierH = h * 0.95;
  const pierD = d * 0.62;
  const concreteColor = choose(rnd, [0x78807d, 0x707875, 0x828a87]);

  // 1. 防汛閘墩 (gate-pier) - 兩側立墩
  const pierOffset = gateW / 2 - pierW / 2;
  rows.push(box(pierW, pierH, pierD, gx - pierOffset, pierH / 2, 0, concreteColor, 'gate-pier'));
  rows.push(box(pierW, pierH, pierD, gx + pierOffset, pierH / 2, 0, concreteColor, 'gate-pier'));

  // 2. 防汛鋼閘板 (gate-leaf)
  const leafW = gateW - pierW * 2;
  const leafH = h * 0.65;
  const leafD = Math.max(0.2, d * 0.08);
  rows.push(box(leafW, leafH, leafD, gx, leafH / 2, 0, 0x2e363a, 'gate-leaf'));
  // 橫向加勁肋
  for (let r = 1; r <= 3; r++) {
    rows.push(box(leafW * 0.98, h * 0.035, leafD * 1.25, gx, leafH * r / 3.5, 0, 0x424e54, 'gate-leaf'));
  }

  // 3. 啟閉機架 (gate-frame) - 跨越兩墩頂部
  const frameH = h * 0.04;
  rows.push(box(gateW, frameH, pierD * 0.35, gx, pierH - frameH / 2, 0, 0x4a5459, 'gate-frame'));

  // 4. 捲揚機箱 (gate-hoist) - 頂部中央
  const hoistW = gateW * 0.38;
  const hoistH = h * 0.04;
  rows.push(box(hoistW, hoistH, pierD * 0.28, gx, pierH + hoistH / 2, 0, 0x364045, 'gate-hoist'));

  // 5. 檢修便橋 (gate-bridge) - 橫跨堤頂供巡查
  const bridgeH = h * 0.05;
  rows.push(box(leafW, bridgeH, d * 0.26, gx, h * 0.78, 0, 0x828a88, 'gate-bridge'));
  for (const side of [-1, 1]) {
    rows.push(box(leafW, h * 0.08, 0.08, gx, h * 0.78 + h * 0.065, side * d * 0.11, 0x9ea6a4, 'gate-bridge'));
  }

  // 6. 導水翼牆 (wing-wall)
  const wingW = pierW;
  const wingH = h * 0.5;
  const wingD = d * 0.3;
  rows.push(box(wingW, wingH, wingD, gx - pierOffset, wingH / 2, -d * 0.3, 0x6e7572, 'wing-wall'));
  rows.push(box(wingW, wingH, wingD, gx + pierOffset, wingH / 2, -d * 0.3, 0x6e7572, 'wing-wall'));

  return rows;
}

