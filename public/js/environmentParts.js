// Shared, seeded environment construction. Metres are supplied by the host, never sampled.
// Descriptors remain render-free so scene and boundary consumers can use the same model.
import { mulberry32 } from './rng.js';
import { createForestTree } from './forest.js';
import { makeSceneVehicleParts } from './vehicleParts.js';
import { partsAABB } from './vehicles.js';
import { mat3FromEulerXYZ, mat3Multiply, eulerXYZFromMat3 } from './partTransform.js';
import { geologyBackgroundObject } from './geology.js';
import { generateVessel } from './vesselCatalog.js';
import { loftMeshData, vesselHullSections } from './vesselGeometry.js';

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
  strandedship: { category: 'marine-vehicle', bio: ['wet'], size: [34, 16, 14] },
});

export const ENVIRONMENT_PREFIX = 'environment/';
const box = (w, h, d, x, y, z, c, role, extra = {}) =>
  ({ g: ['box', w, h, d], p: [x, y, z], c, role, ...extra });
const cyl = (rt, rb, h, x, y, z, c, role, extra = {}) =>
  ({ g: ['cyl', rt, rb, h, 8], p: [x, y, z], c, role, ...extra });
const choose = (rnd, rows) => rows[Math.floor(rnd() * rows.length)];
const integer = (rnd, lo, hi) => lo + Math.floor(rnd() * (hi - lo + 1));
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

function building(kind, w, h, d, rnd) {
  if (kind === 'greenhouse') return greenhouse(w, h, d, rnd);
  if (kind === 'ranch') return ranch(w, h, d, rnd);
  const facade = choose(rnd, colors), trim = choose(rnd, [0x514d46, 0x6d7d82, 0x8f6851]);
  const tall = kind === 'skyscraper' || kind === 'skyfall';
  const industrial = ['factory', 'powerplant', 'incinerator'].includes(kind);
  const bodyH = h * (industrial ? .48 : tall ? .88 : .7);
  const rows = [box(w, bodyH, d, 0, bodyH / 2, 0, facade, 'building-body')];
  const floors = tall ? integer(rnd, 8, 16) : industrial ? 2 : integer(rnd, 2, 4);
  const bays = integer(rnd, 3, 7);
  for (let floor = 0; floor < floors; floor++) {
    const y = bodyH * (floor + .65) / floors, wh = bodyH / floors * .48;
    for (let bay = 0; bay < bays; bay++) {
      const x = (bay + .5) * w / bays - w / 2;
      for (const side of [-1, 1]) rows.push(box(w / bays * .62, wh, .08, x, y, side * (d / 2 + .04),
        0x537785, 'window', { mat: 'glass' }));
    }
    for (const side of [-1, 1]) rows.push(box(.08, wh, d * .76, side * (w / 2 + .04), y, 0,
      0x537785, 'side-window', { mat: 'glass' }));
    if (tall) rows.push(box(w * 1.015, bodyH / floors * .08, d * 1.015, 0,
      bodyH * (floor + 1) / floors, 0, trim, 'floor-band'));
  }
  if (industrial) {
    const bays = integer(rnd, 2, 4);
    for (let i = 0; i < bays; i++) {
      const x = (i + .5) * w / bays - w / 2;
      rows.push(box(w / bays * .92, h * .035, d * 1.015, x, bodyH + h * .08, 0, trim,
        'sawtooth-roof', { r: [0, 0, .14] }));
    }
    const stacks = kind === 'incinerator' ? 3 : integer(rnd, 1, 2);
    for (let i = 0; i < stacks; i++) {
      const x = w * (-.3 + i * .22), sh = h - bodyH;
      rows.push(cyl(w * .035, w * .05, sh, x, bodyH + sh / 2, -d * .3, trim, 'chimney'));
      rows.push(cyl(w * .037, w * .037, sh * .1, x, h * .94, -d * .3, 0xd0c8b7, 'stack-band'));
    }
    if (kind === 'powerplant') rows.push(cyl(w * .12, w * .18, h * .5,
      w * .25, bodyH + h * .25, 0, 0x9ca39d, 'cooling-tower'));
  } else if (tall) {
    const crown = choose(rnd, ['terrace', 'lantern', 'spire']);
    rows.push(box(w * .65, h * .08, d * .65, 0, bodyH + h * .04, 0, trim, crown));
    if (crown === 'spire') rows.push(cyl(.12, w * .035, h * .04, 0, h * .98, 0, trim, 'antenna'));
  } else {
    const pitch = choose(rnd, [.24, .36, .48]);
    for (const side of [-1, 1]) rows.push(box(w * 1.03, h * .035, d * .58,
      0, bodyH + d * .13, side * d * .24, trim, 'roof-slope', { r: [side * pitch, 0, 0] }));
    rows.push(box(w * .16, bodyH * .42, .12, -w * .22, bodyH * .21, d / 2 + .07, trim, 'door'));
  }
  return rows;
}

function greenhouse(w, h, d, rnd) {
  const rows = [], bays = integer(rnd, 4, 7), frame = choose(rnd, [0x879e95, 0xc0cbc1, 0x71827a]);
  const wallH = h * .58, pitch = Math.atan2(h - wallH, d / 2);
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
  for (const side of [-1, 1]) rows.push(box(.09, wallH, d, side * w / 2, wallH / 2, 0,
    0xa4d2c3, 'glass-end', { mat: 'glass' }));
  return rows;
}

function ranch(w, h, d, rnd) {
  const rows = building('house', w * .56, h * .76, d * .55, rnd)
    .map(p => ({ ...p, p: [p.p[0] - w * .17, p.p[1], p.p[2] - d * .15] }));
  const timber = choose(rnd, [0x947754, 0xb49c71, 0xd4c9ad]), fenceH = h * .2;
  const posts = integer(rnd, 5, 8);
  for (let i = 0; i <= posts; i++) for (const side of [-1, 1])
    rows.push(box(.24, fenceH, .24, i * w / posts - w / 2, fenceH / 2, side * d / 2, timber, 'fence-post'));
  for (const side of [-1, 1]) for (const level of [.4, .85]) {
    rows.push(box(w, .16, .16, 0, fenceH * level, side * d / 2, timber, 'fence-rail'));
    rows.push(box(.16, .16, d, side * w / 2, fenceH * level, 0, timber, 'fence-rail'));
  }
  rows.push(cyl(w * .08, w * .08, h * .72, w * .3, h * .36, -d * .23, 0xa8aaa1, 'feed-silo'));
  rows.push(cyl(0, w * .085, h * .15, w * .3, h * .795, -d * .23, 0x657777, 'silo-roof'));
  return rows;
}

function extraction(kind, w, h, d, rnd) {
  const rows = [], steel = choose(rnd, [0x7c7770, 0xa27a42, 0x626f74]);
  if (kind === 'mine') {
    const levels = integer(rnd, 3, 5);
    for (let i = 0; i < levels; i++) rows.push(box(w * (1 - i * .12), h * .16,
      d * (1 - i * .13), 0, h * (.08 + i * .16), -d * i * .025, 0x9a8770, 'mine-bench'));
    rows.push(box(w * .6, h * .07, d * .09, 0, h * .65, d * .24, steel,
      'conveyor', { r: [0, 0, .22] }));
    rows.push(...makeSceneVehicleParts('excavator', { fit: { L: w * .4, H: h * .45, W: d * .35 },
      at: [w * .18, h * .55, 0], paint: integer(rnd, 1, 65535) }));
  } else {
    for (const x of [-1, 1]) for (const z of [-1, 1]) rows.push(box(w * .045, h, d * .045,
      x * w * .19, h / 2, z * d * .22, steel, 'derrick-leg'));
    for (let i = 1; i <= 6; i++) {
      rows.push(box(w * .44, h * .025, d * .49, 0, h * i / 6, 0, steel, 'derrick-frame'));
    }
    rows.push(cyl(w * .14, w * .14, h * .25, w * .32, h * .125, d * .25, 0xaaa99b, 'storage-tank'));
  }
  return rows;
}

function rocks(type, seed, season) {
  const model = geologyBackgroundObject(type, seed, { segments: 12 });
  const { min, max, size } = model.bounds, center = min.map((v, i) => (v + max[i]) / 2);
  const tint = rockTints[season] || rockTints.summer;
  const colors = model.meshData.colors.map((value, i) => value * ((tint >> (16 - i % 3 * 8)) & 255) / 255);
  const meshData = { ...model.meshData, colors,
    vertices: model.meshData.vertices.map((v, i) => v - center[i % 3]) };
  return [{ g: ['mesh', meshData, size], p: [0, size[1] / 2, 0], c: null, role: 'rock-mass' }];
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

export function environmentParts(kind, { size = ENVIRONMENT_OBJECTS[kind]?.size, seed = 1, season = 'summer' } = {}) {
  if (!ENVIRONMENT_OBJECTS[kind]) throw new RangeError(`Unknown environment object: ${kind}`);
  if (!Number.isSafeInteger(seed) || !Array.isArray(size) || size.length !== 3
    || size.some(v => !Number.isFinite(v) || v <= 0)) throw new RangeError('Invalid environment dimensions or seed');
  const [w, h, d] = size, rnd = mulberry32(seed >>> 0);
  let rows;
  if (kind === 'car') rows = makeSceneVehicleParts('sedan', { fit: { L: w, H: h, W: d }, paint: seed });
  else if (kind === 'gianttree' || kind === 'fallentree') {
    const tree = createForestTree(choose(rnd, ['redwood', 'sequoia']), seed, undefined, undefined, 1, season);
    rows = tree.parts.filter(p => kind !== 'fallentree' || !['leaf', 'flower', 'fruit'].includes(p.role)).map(p => {
      const g = p.g.parameters;
      return { g: g.height ? ['cyl', g.radiusTop, g.radiusBottom, g.height, g.radialSegments] : ['ico', g.radius],
        p: [p.px || 0, p.y || 0, p.pz || 0], r: [p.rx || 0, 0, p.rz || 0], s: [1, p.sy || 1, 1], c: p.c, role: p.role };
    });
    if (kind === 'fallentree') rows = layDown(rows);
  } else if (kind === 'boulder') rows = rocks(choose(rnd, ['granite', 'sandstone', 'basalt']), seed, season);
  else if (kind === 'mine' || kind === 'oilfield') rows = extraction(kind, w, h, d, rnd);
  else if (kind === 'strandedship') rows = ship(seed);
  else if (kind === 'skyfall') rows = layDown(building('skyscraper', h * .55, w, d * .8, rnd));
  else rows = building(kind, w, h, d, rnd);
  return fit(rows, size);
}

// Array/linear forms are only exposed through the boundary catalog. Every module receives
// its own seed, so adding detail to one module cannot perturb its neighbours.
export function linearEnvironmentParts(kind, { len, depth: d, h, seed = 1, season = 'summer' }) {
  const rnd = mulberry32(seed >>> 0), rows = [];
  const count = Math.max(1, Math.floor(len / (kind.startsWith('wind') ? 18 : 9)));
  const step = len / count;
  const stone = choose(rnd, [0x8c908b, 0x9b927f, 0x738185]);
  for (let i = 0; i < count; i++) {
    const x = (i + .5) * step - len / 2;
    const local = mulberry32((seed ^ Math.imul(i + 1, 0x9e3779b9)) >>> 0);
    if (kind.startsWith('wind')) {
      const radius = Math.min(step * .42, h * .24, d * .35), hubY = h - radius - .2;
      const z = d * .15, pivot = [x, hubY, z], phase = local() * Math.PI * 2;
      rows.push(cyl(.32, .7, hubY, x, hubY / 2, 0, 0xd4dcda, 'tower-column'));
      rows.push(box(1.2, 1, 2.2, x, hubY, 0, stone, 'nacelle'));
      if (kind === 'windsea') rows.push(cyl(.9, 1, 3, x, 1.5, 0, 0xd3ab44, 'monopile'));
      const blades = choose(local, [3, 3, 4]);
      for (let j = 0; j < blades; j++) {
        const a = j / blades * Math.PI * 2;
        rows.push(box(.3, radius * .88, .16, x + Math.cos(a) * radius * .52,
          hubY + Math.sin(a) * radius * .52, z, 0xe1e5df, 'rotor-blade',
          { r: [0, 0, a - Math.PI / 2], motion: { kind: 'rotor', id: `rotor_${i}`, pivot, phase } }));
      }
    } else if (['tetrapod', 'wetpods'].includes(kind)) {
      const r = Math.min(step * .19, h * .13, d * .18);
      for (let layer = 0; layer < 3; layer++) for (const side of [-1, 1]) {
        const px = x + (layer % 2 ? .12 : -.12) * step, y = r * (1.8 + layer * 1.65), z = side * d * .22;
        const yaw = local() * Math.PI;
        rows.push({ g: ['ico', r], p: [px, y, z], c: stone, role: 'breakwater-core', layer });
        for (let arm = 0; arm < 4; arm++) rows.push(cyl(r * .38, r * .55, r * 2.4,
          px, y, z, stone, 'breakwater-arm', { r: [arm * Math.PI / 2 + .5, yaw, .8] }));
      }
    } else if (['citywall', 'barricade', 'levee', 'seawall', 'viaduct'].includes(kind)) {
      const wall = kind === 'citywall', bridge = kind === 'viaduct';
      const bodyH = h * (wall ? .68 : bridge ? .52 : .78);
      rows.push(box(step, bodyH, d * .76, x, bodyH / 2, 0, stone, bridge ? 'fallen-deck' : 'wall-course'));
      const courses = integer(local, 3, 5);
      for (let k = 1; k <= courses; k++) rows.push(box(step, h * .018, d * .81,
        x, bodyH * k / courses, 0, 0x646d6b, 'course-joint'));
      if (wall || kind === 'barricade') {
        const teeth = integer(local, 3, 5);
        for (let k = 0; k < teeth; k++) rows.push(box(step / teeth * .5, h * .13, d * .8,
          x + (k + .5) * step / teeth - step / 2, bodyH + h * .065, 0, stone, 'battlement'));
        if (wall && i % 3 === 0) rows.push(box(step * .5, h * .25, d * .9,
          x, h * .805, 0, choose(local, colors), 'watchtower'));
      } else rows.push(box(step, h * .09, d, x, bodyH + h * .045, 0, stone, bridge ? 'deck-parapet' : 'crest'));
    } else if (['solarfield', 'floatsolar'].includes(kind)) {
      for (const side of [-1, 1]) {
        const y = 1.1, z = side * d * .23;
        rows.push(box(step * .9, .35, d * .4, x, .5, z, 0x777e78, 'panel-support'));
        rows.push(box(step * .88, .14, d * .38, x, y, z, choose(local, [0x264461, 0x355875]),
          'solar-panel', { r: [-.12, 0, 0] }));
        for (let k = 0; k < 4; k++) rows.push(box(.05, .05, d * .37,
          x + (k - 1.5) * step * .2, y + .14, z, 0xa8babd, 'panel-grid'));
      }
    } else if (['train', 'trucks', 'ship', 'rowhouse', 'edgehamlet', 'giantforest'].includes(kind)) {
      const object = { rowhouse: 'house', edgehamlet: 'house', ship: 'strandedship', giantforest: 'gianttree' }[kind];
      const parts = object ? environmentParts(object, { size: [step * .92, h, d * .9], seed: seed ^ (i + 1), season })
        : makeSceneVehicleParts(kind === 'train' ? 'railcar' : 'truck',
          { fit: { L: step * .95, H: h, W: d * .9 }, paint: seed ^ (i + 1) });
      rows.push(...parts.map(p => ({ ...p, p: [p.p[0] + x, p.p[1], p.p[2]] })));
    } else if (['cliff', 'rockery', 'landslide', 'debris', 'isletbarrier'].includes(kind)) {
      const type = { cliff: 'cliff', rockery: 'mountain', landslide: 'moraine', debris: 'mound', isletbarrier: 'island' }[kind];
      rows.push(...fit(rocks(type, seed ^ (i + 1), season), [step, h, d])
        .map(p => ({ ...p, p: [p.p[0] + x, p.p[1], p.p[2]] })));
      if (kind === 'debris' || kind === 'landslide') rows.push(...environmentParts('fallentree',
        { size: [step * .8, h * .25, d * .65], seed: seed ^ (i + 33) })
        .map(p => ({ ...p, p: [p.p[0] + x, p.p[1] + h * .12, p.p[2]] })));
    } else if (['searanch', 'oysterracks'].includes(kind)) {
      const railY = Math.min(h * .45, 4);
      for (const side of [-1, 1]) {
        rows.push(cyl(.12, .18, railY, x + side * step * .43, railY / 2, d * .25, stone, 'rack-post'));
        rows.push(box(step * .9, .25, .3, x, railY, side * d * .28, 0x8e7d5e, 'longline'));
      }
      const lines = integer(local, 4, 8);
      for (let k = 0; k < lines; k++) rows.push(cyl(.07, .09, railY * .8,
        x + (k + .5) / lines * step * .8 - step * .4, railY * .55, d * .28, 0x4f6667, 'culture-line'));
    } else if (kind === 'deeprig') {
      rows.push(box(step * .9, h * .1, d * .85, x, h * .16, 0, 0x686f70, 'pontoon'));
      rows.push(...environmentParts('oilfield', { size: [step * .82, h * .7, d * .8], seed: seed ^ (i + 1) })
        .map(p => ({ ...p, p: [p.p[0] + x, p.p[1] + h * .21, p.p[2]] })));
    } else throw new RangeError(`Unknown linear environment: ${kind}`);
  }
  return rows;
}
