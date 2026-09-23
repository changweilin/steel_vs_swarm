// Pure, seeded visual geology. Metres / degrees / Ma; ranges are art direction, not surveys.
import { mulberry32 } from './rng.js';
import { forestEnvironment } from './forest.js';
import { selectAncientStone, ancientStoneGeometry, ancientStoneDistribution } from './ancientStone.js';
import { generateHeritageSite } from './heritageSites.js';
import { PHENOMENA, phenomenaWeights, phenomenaProfile, phenomenaSurface, phenomenaEffects } from './geologyPhenomena.js';

export const GEOLOGY_PREFIX = 'geology/';
export const GEOLOGY_STEEP_DEG = 45;
const spec = (name, lithology, process, width, height, ageMa, roughness, color, terrainFit = false) =>
  ({ name, lithology, process, width, height, ageMa, roughness, color, terrainFit });
export const GEOLOGY_TYPES = {
  granite: spec('花崗岩塊', 'igneous', 'joint-weathering', [2, 12], [1, 7], [10, 3000], [.12, .35], 0x96928b),
  mountain: spec('褶皺山巒', 'metamorphic', 'uplift-erosion', [25, 90], [15, 65], [50, 2500], [.2, .5], 0x777d80),
  mound: spec('土堆／崩積丘', 'unconsolidated', 'colluvium', [3, 18], [1, 6], [0, .1], [.02, .1], 0x8d7051),
  dune: spec('風成沙丘', 'unconsolidated', 'aeolian', [10, 50], [2, 12], [0, .1], [.005, .025], 0xd6b77c),
  sandstone: spec('層狀砂岩台地', 'sedimentary', 'deposition-erosion', [6, 28], [3, 18], [2, 600], [.04, .15], 0xb38663),
  cliff: spec('斷層峭壁', 'metamorphic', 'fault-uplift', [12, 40], [8, 32], [20, 1800], [.08, .25], 0x85817b, true),
  karst: spec('石灰岩溶蝕峰', 'sedimentary', 'dissolution', [6, 25], [5, 24], [5, 500], [.15, .35], 0xb1afa0),
  basalt: spec('玄武岩柱狀節理', 'igneous', 'cooling-joints', [4, 18], [3, 15], [.001, 180], [.01, .06], 0x555e62, true),
  crater: spec('火山口', 'igneous', 'eruption-collapse', [18, 65], [5, 22], [0, 5], [.06, .2], 0x665952),
  reef: spec('淺海珊瑚礁', 'biogenic', 'carbonate-accretion', [5, 24], [1, 5], [0, .02], [.08, .22], 0xc6c1a3),
  island: spec('海蝕島礁', 'sedimentary', 'wave-erosion', [10, 35], [3, 14], [1, 300], [.08, .25], 0x969183),
  river: spec('河床沖積灘', 'unconsolidated', 'fluvial-deposition', [6, 24], [.5, 3], [0, .1], [.03, .12], 0x9b9180),
  moraine: spec('冰磧碎石丘', 'unconsolidated', 'glacial-deposition', [8, 30], [2, 10], [0, 2.6], [.2, .45], 0x899092),
  tor: spec('節理風化岩堆', 'igneous', 'joint-weathering', [8, 28], [4, 18], [10, 3000], [.04, .12], 0xbdb2a0),
  fin: spec('刃狀岩脊', 'sedimentary', 'differential-erosion', [12, 40], [8, 30], [2, 600], [.04, .14], 0xa8875c, true),
  spire: spec('侵蝕尖峰', 'sedimentary', 'differential-erosion', [8, 26], [10, 35], [2, 600], [.06, .18], 0x9a8068),
  marble: spec('大理岩圓蝕露頭', 'metamorphic', 'dissolution-weathering', [6, 22], [3, 12], [20, 1800], [.03, .1], 0xcfc8bc),
  inselberg: spec('砂岩孤立岩丘', 'sedimentary', 'differential-erosion', [30, 90], [12, 40], [2, 600], [.03, .09], 0xae6345),
  rocktower: spec('層狀砂岩塔峰', 'sedimentary', 'differential-erosion', [14, 36], [25, 65], [2, 600], [.03, .1], 0x94816a),
  granite_towers: spec('花崗岩塔群', 'igneous', 'joint-weathering', [20, 50], [25, 70], [10, 3000], [.05, .14], 0xb9b4a8),
  conglomerate: spec('礫岩圓頂峰', 'sedimentary', 'differential-erosion', [14, 40], [20, 55], [2, 600], [.05, .14], 0x9a8f7c),
  monument: { name: '地區古蹟', lithology: 'manufactured', process: 'regional-architecture',
    uniformScale: [.5, 1.5], color: 0x969184 },
  ruins: { name: '隨機廢棄遺跡', lithology: 'manufactured', process: 'human-activity',
    uniformScale: [.5, 1.5], color: 0x969184 },
  ...Object.fromEntries(Object.entries(PHENOMENA).map(([id,row])=>[id,{...spec(...row.slice(0,8)),group:row[8]}])),
};

// Art-direction limits for solid relief above its base, independent of footprint area.
const reliefRatios = {
  granite: .4, mountain: .35, mound: .2, dune: .15, sandstone: .4,
  cliff: null, karst: null, basalt: null, crater: .2, reef: .12, island: .3,
  river: .06, moraine: .2, tor: .4, fin: null, spire: null, marble: .35,
  inselberg: .3, rocktower: null, granite_towers: null, conglomerate: null,
  debris_flow: .12, landslide: .3, landslide_lake: .18, slope_creep: .25,
  eruption: .3, badlands: .25, geothermal: .08, mud_volcano: .15,
  hot_spring: .06, fountain: .06, geyser: .06, impact_crater: .15,
};
for (const [type, ratio] of Object.entries(reliefRatios)) GEOLOGY_TYPES[type].maxHeightDiagonalRatio = ratio;

// Migration ledger for biomes.js synthMegalith's eleven recipes. Unsupported topology
// is deliberately omitted, never substituted with a solid "arch" or a floating cap.
export const LEGACY_GEOLOGY_RULES = Object.freeze({
  dome: 'granite', slab: 'cliff', tower: 'rocktower', mesa: 'sandstone',
  spire: 'spire', fin: 'fin', basalt: 'basalt', granite: 'tor', marble: 'marble',
});

export const GEOLOGY_SURFACES = {
  mud: { name: '淤泥', color: 0x665844, coverage: [.2, .8] },
  sand: { name: '沙塵', color: 0xc8ae78, coverage: [.15, .85] },
  gravel: { name: '碎石', color: 0x8c8a80, coverage: [.15, .6] },
  wood: { name: '軟木／枯木屑', color: 0x82603b, coverage: [.03, .18] },
  leaves: { name: '落葉', color: 0x9e703a, coverage: [.1, .65] },
  cones: { name: '毬果', color: 0x67482f, coverage: [.02, .12] },
  grass: { name: '長草', color: 0x748349, coverage: [.15, .65] },
  moss: { name: '青苔', color: 0x536d43, coverage: [.15, .75] },
  lichen: { name: '地衣', color: 0xa5ac80, coverage: [.1, .55] },
  water: { name: '積水', color: 0x426d79, coverage: [.15, .65] },
  snow: { name: '積雪', color: 0xd5e1df, coverage: [.25, .9] },
  ash: { name: '火山灰', color: 0x625d58, coverage: [0, 0] },
  lava: { name: '熔岩', color: 0xf76824, coverage: [0, 0] },
  mineral: { name: '礦物沉積', color: 0xdacb88, coverage: [0, 0] },
};
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const number = (v, fallback, lo, hi) => Number.isFinite(v) ? clamp(v, lo, hi) : fallback;

export function geologyEnvironment(input = {}) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new TypeError('Geology environment must be an object');
  const latitude = number(input.latitude, 25, -90, 90);
  const altitude = number(input.altitude, 100, -11000, 9000);
  const climate = forestEnvironment(latitude, altitude, input);
  const referenceLatitude = { tropical: 10, temperate: 35, boreal: 60, arid: 25, mediterranean: 35, alpine: 45 }[input.climate];
  const temperature = Number.isFinite(input.temperature) ? input.temperature : climate.temperature
    - (referenceLatitude === undefined ? 0 : Math.max(0, altitude) * .0065 + (Math.abs(latitude) - referenceLatitude) * .25);
  const water = input.water ?? 'none';
  if (!['none', 'stream', 'river', 'lake', 'sea'].includes(water)) throw new RangeError('Unknown geology water body');
  return { latitude, altitude, temperature, moisture: climate.moisture,
    water, depth: number(input.depth, 0, 0, 11000),
    vegetation: number(input.vegetation, .4, 0, 1), conifers: number(input.conifers, 0, 0, 1),
    wind: number(input.wind, .4, 0, 1), fault: number(input.fault, 0, 0, 1),
    volcanic: number(input.volcanic, 0, 0, 1), exposure: number(input.exposure, .5, 0, 1),
    sediment: number(input.sediment, .4, 0, 1), dissolution: number(input.dissolution, .4, 0, 1),
    human: number(input.human, 0, 0, 1),
    slope: number(input.slope, 0, 0, 90), rainfall: number(input.rainfall, 0, 0, 1),
    instability: number(input.instability, 0, 0, 1), geothermal: number(input.geothermal, 0, 0, 1),
    gasPressure: number(input.gasPressure, 0, 0, 1), springPressure: number(input.springPressure, 0, 0, 1),
    impact: number(input.impact, 0, 0, 1), activity: number(input.activity, .7, 0, 1) };
}

export function geologyDistribution(input = {}) {
  const e = geologyEnvironment(input), wet = e.water !== 'none';
  const weights = { granite: 1, mountain: .2 + Math.max(0, e.altitude) / 2000 + e.fault,
    mound: .2 + e.sediment, dune: (1 - e.moisture) * e.wind * (wet ? .15 : 2),
    sandstone: .4, cliff: .1 + e.fault * 3, karst: e.dissolution * e.moisture,
    basalt: e.volcanic * 2, crater: e.volcanic * 2,
    // This archetype is a shallow photosymbiotic reef, not all coral species.
    reef: e.water === 'sea' && e.temperature >= 20 && e.temperature <= 30 && e.depth <= 30 ? 2 : 0,
    island: e.water === 'sea' ? 2 : 0,
    river: ['stream', 'river', 'lake'].includes(e.water) ? 2 + e.sediment : 0,
    moraine: e.temperature < 5 ? 1 : .02,
    tor: .25 + e.exposure * .4, fin: .15 + e.fault * .7,
    spire: .1 + e.exposure * .3, marble: .1 + e.dissolution * .3,
    inselberg: .15 + (1 - e.moisture) * .2, rocktower: .15 + e.exposure * .2,
    granite_towers: .1 + Math.max(0, e.altitude) / 4000, conglomerate: .15 };
  for(const row of ancientStoneDistribution(input)) weights[row.type]=e.human*3*row.weight;
  Object.assign(weights,phenomenaWeights(e));
  if (e.slope > GEOLOGY_STEEP_DEG || typeof input.heightAt === 'function') {
    for (const type of Object.keys(weights)) {
      if (!GEOLOGY_TYPES[type].terrainFit) weights[type] = 0;
    }
  }
  const sum = Object.values(weights).reduce((a, b) => a + b, 0);
  return Object.entries(weights).filter(([, w]) => w > 0).map(([type, w]) => ({ type, weight: w / sum }));
}

function surfaceWeights(e, type) {
  const land = e.depth === 0;
  const stableRock = !['dune', 'mound', 'river', 'moraine'].includes(type);
  return { mud: land && e.moisture > .55 ? e.moisture * e.sediment : 0,
    sand: (1 - e.moisture) * e.wind + (type === 'dune' ? 1 : 0),
    gravel: e.exposure * (type === 'moraine' ? 1 : .4),
    wood: land ? e.vegetation * .2 : 0, leaves: land ? e.vegetation * (1 - e.conifers) : 0,
    cones: land ? e.vegetation * e.conifers : 0,
    grass: land && e.temperature > 0 ? e.moisture * e.vegetation : 0,
    moss: land && stableRock && e.moisture > .35 && e.temperature > -5 ? e.moisture * .8 : 0,
    lichen: land && stableRock ? e.exposure * .5 : 0,
    water: land && e.temperature > 0 ? Math.max(0, e.moisture - .65) : 0,
    snow: land && e.temperature < 1 ? .8 : 0 };
}

/** Independent streams: surface edits cannot change the rock's shape or scene RNG. */
export function generateGeology(type = 'auto', seed = 0, input = {}) {
  if (!Number.isSafeInteger(seed)) throw new TypeError('Geology seed must be a safe integer');
  const explicitRuins = type === 'ruins';
  const environment = geologyEnvironment(input);
  const rnd = mulberry32(seed ^ 0x47454f), coverRnd = mulberry32(seed ^ 0x534f494c);
  // Legacy human-stone entry uses the same conditional 50/50 policy as automatic generation.
  if(type==='masonry') type=selectAncientStone(seed,input).kind;
  if (type === 'auto') {
    const rows = geologyDistribution(input);
    let roll = rnd();
    type = rows[rows.length - 1].type;
    for (const row of rows) { roll -= row.weight; if (roll < 0) { type = row.type; break; } }
  }
  const s = GEOLOGY_TYPES[type];
  if (!s) throw new RangeError(`Unknown geology type: ${type}`);
  const sample = ([a, b]) => a + rnd() * (b - a);
  let stone, stoneGeometry;
  let p;
  if (s.lithology === 'manufactured') {
    stone = selectAncientStone(seed, explicitRuins ? input : {...input,ruinType:'auto'},type);
    type = stone.kind;
    stoneGeometry = input.heritageState
      ? generateHeritageSite(seed, { ...input, selection: stone, state: input.heritageState })
      : ancientStoneGeometry(stone, seed);
    const [w,h,d] = stoneGeometry.bounds.size, scale = stone.uniformScale;
    p = { width: w*scale, height: h*scale, depthRatio: d/w, uniformScale: scale,
      ageMa: stone.ageMa, roughness: 0, strike: rnd()*Math.PI*2, dip: 0, layers: 1,
      erosion: 0, dissolution: 0 };
  } else p = { width: sample(s.width), height: sample(s.height), depthRatio: .65 + rnd() * .5,
    ageMa: sample(s.ageMa), roughness: sample(s.roughness), strike: rnd() * Math.PI * 2,
    dip: sample([0, environment.fault > .5 ? 70 : 25]), layers: 4 + Math.floor(rnd() * 9),
    erosion: environment.exposure * (.25 + rnd() * .75), dissolution: environment.dissolution };
  if (Number.isFinite(input.strike)) p.strike = input.strike;
  if (!stone) {
    for (const key of ['width', 'depth', 'height']) {
      if (input[key] !== undefined && (!Number.isFinite(input[key]) || input[key] <= 0)) {
        throw new RangeError(`Geology ${key} must be a positive finite number`);
      }
    }
    p.width = input.width ?? p.width;
    p.depthRatio = input.depth === undefined ? p.depthRatio : input.depth / p.width;
    p.height = input.height ?? p.height;
    const diagonal = Math.hypot(p.width, p.width * p.depthRatio);
    if (!Number.isFinite(diagonal) || !Number.isFinite(p.depthRatio) || p.depthRatio <= 0) {
      throw new RangeError('Geology footprint must be finite');
    }
    if (s.maxHeightDiagonalRatio !== null) p.height = Math.min(p.height, diagonal * s.maxHeightDiagonalRatio);
  }
  if (Object.hasOwn(PHENOMENA,type)) {
    const eventRnd=mulberry32(seed ^ 0x45564e54);
    Object.assign(p,{activity:environment.activity,ventRadius:.12+eventRnd()*.12,
      channelWidth:.12+eventRnd()*.14,jetHeight:.3+eventRnd()*.6});
  }
  // Depositional age does not dictate surface exposure or weathering duration.
  const surfaces = Object.entries(stone && input.heritageState ? {} : surfaceWeights(environment, type)).map(([kind, weight]) => {
    const [a, b] = GEOLOGY_SURFACES[kind].coverage;
    return { kind, coverage: weight * (a + coverRnd() * (b - a)) };
  });
  return { type, seed, environment, parameters: p, surfaces, ...(stone ? { stone, stoneGeometry } : {}) };
}

function profile(type, x, z, p) {
  if(Object.hasOwn(PHENOMENA,type)) return phenomenaProfile(type,x,z,p);
  const r = Math.hypot(x, z), envelope = Math.max(0, 1 - r * r);
  const groove = .94 + .06 * Math.cos(x * 31 + z * 4 + p.erosion * 3);
  if (type === 'inselberg') return Math.max(0, 1 - (x * x + z * z * 1.7)) ** .38 * groove;
  if (type === 'rocktower') {
    const core = Math.max(0, 1 - Math.hypot(x * 1.7, z * 1.9));
    const tier = Math.floor(core ** .15 * p.layers) / p.layers;
    return Math.max(envelope * .24, tier * groove);
  }
  if (type === 'granite_towers') {
    let peak = 0;
    for (const [cx, cz, height] of [[-.42, .06, .77], [0, -.08, 1], [.42, .1, .68]]) {
      peak = Math.max(peak, Math.max(0, 1 - Math.hypot((x - cx) * 3.3, (z - cz) * 3.8)) ** .45 * height);
    }
    return Math.max(envelope * .18, peak * groove);
  }
  if (type === 'conglomerate') return Math.max(envelope * .15,
    Math.max(0, 1 - (x * x * 2.2 + z * z * 2.5)) ** .22) * groove;
  if (type === 'crater') return Math.exp(-(((r - .62) / .19) ** 2)) * Math.max(0, 1 - r ** 8);
  if (type === 'dune') return Math.max(0, 1 - Math.abs(z) ** 2) * Math.max(0, x < .25 ? (x + 1) / 1.25 : (1 - x) / .75);
  if (type === 'cliff') return envelope * (x > -.05 ? .95 : .12);
  if (type === 'sandstone') return Math.floor(envelope ** .3 * p.layers) / p.layers;
  if (type === 'basalt') return Math.max(0, 1 - Math.hypot(Math.round(x * 5) / 5, Math.round(z * 5) / 5)) ** .25;
  if (type === 'fin') return envelope * Math.max(0, 1 - Math.abs(z + .06 * Math.sin(x * 9)) * 5) ** .4
    * (.7 + .3 * Math.abs(Math.cos(x * 8)));
  if (type === 'spire') return Math.max(0, 1 - r) ** 1.5;
  if (type === 'tor') {
    const block = Math.max(0, 1 - Math.max(Math.abs(x), Math.abs(z)));
    const joints = .88 + .12 * Math.abs(Math.sin(x * 11 + Math.floor(block * 4) * 1.7));
    return Math.ceil(block * 4) / 4 * joints;
  }
  if (type === 'marble') return envelope ** .6 * (.65 + .35 * Math.abs(Math.sin(x * 6) * Math.cos(z * 5)));
  if (type === 'karst') return envelope * (1 - p.dissolution * .75 + p.dissolution * .75 * Math.abs(Math.sin(x * 8) * Math.cos(z * 7)) ** 3);
  if (type === 'mountain') return envelope * (.3 + .7 * Math.abs(Math.sin(x * 5 + z * 3))) ** 1.4;
  if (type === 'reef') return envelope * (.3 + .45 * Math.abs(Math.sin(x * 10) * Math.cos(z * 11)));
  if (type === 'river') return envelope * (.18 + .3 * Math.abs(z + .2 * Math.sin(x * 4)));
  if (type === 'island') return Math.max(0, envelope - .2) ** .45;
  return envelope ** (type === 'granite' ? .45 : 1.3);
}
const linear = value => value <= .04045 ? value / 12.92 : ((value + .055) / 1.055) ** 2.4;
function rgb(hex, shade = 1) {
  return [16, 8, 0].map(shift => linear(clamp(((hex >> shift) & 255) / 255 * shade, 0, 1)));
}

/** Mesh colours and surface details share the measured triangles, never an approximate landing formula. */
export function geologyBackgroundObject(type, seed = 0, input = {}) {
  if (input.heightAt !== undefined && typeof input.heightAt !== 'function') throw new TypeError('Geology heightAt must be a function');
  const model = generateGeology(type, seed, input), { parameters: p, environment: e } = model;
  type = model.type;
  const spec = GEOLOGY_TYPES[type];
  const n = Number.isInteger(input.segments) ? Math.max(8, Math.min(28, input.segments)) : 28;
  const points = [], bases = [], vertices = [], faces = [], colors = [];
  let peakRelief = 0;
  const shapeRnd = mulberry32(seed ^ 0x53484150);
  const phases = [shapeRnd(), shapeRnd(), shapeRnd()].map(v => v * Math.PI * 2);
  const c = Math.cos(p.strike), s = Math.sin(p.strike);
  const originX = number(input.x, 0, -Infinity, Infinity), originZ = number(input.z, 0, -Infinity, Infinity);
  const ground = input.heightAt ? input.heightAt(originX, originZ) : 0;
  if (!Number.isFinite(ground)) return null;
  // Sampling is performed before emitting faces, so a missing sample omits the whole object.
  // Callers supply the maximum footprint slope; explicit art previews can still select any type.
  if (input.heightAt && !spec.terrainFit) throw new RangeError(`Geology cannot conform to terrain: ${type}`);
  if (!model.stone) for (let j = 0; j <= n; j++) for (let i = 0; i <= n; i++) {
    const x = i / n * 2 - 1, z = j / n * 2 - 1;
    const base = profile(type, x, z, p);
    const feature=Object.hasOwn(PHENOMENA,type)?phenomenaSurface(type,x,z,p):null;
    const noise = (Math.sin(x * 7 + z * 3 + phases[0]) * .3
      + Math.sin(x * 13 - z * 9 + phases[1]) * .15
      + Math.cos(x * 23 + z * 17 + phases[2]) * .05)
      * p.roughness * (1 - p.erosion * .5) * base * (feature==='water'?0:1);
    const y = Math.max(0, base + noise) * p.height;
    const px = x * p.width / 2, pz = z * p.width * p.depthRatio / 2;
    const wx = px * c - pz * s, wz = px * s + pz * c;
    const baseY = input.heightAt ? input.heightAt(originX + wx, originZ + wz) : 0;
    if (!Number.isFinite(baseY)) return null;
    points.push([wx, y + baseY - ground, wz]);
    bases.push(baseY - ground);
    peakRelief = Math.max(peakRelief, y);
  }
  // Noise and profile peaks are included; scaling all relief preserves benches and pools.
  if (!model.stone && spec.maxHeightDiagonalRatio !== null) {
    const limit = Math.hypot(p.width, p.width * p.depthRatio) * spec.maxHeightDiagonalRatio;
    const fit = peakRelief > limit ? limit / peakRelief : 1;
    for (let i = 0; i < points.length; i++) points[i][1] = bases[i] + (points[i][1] - bases[i]) * fit;
  }
  function triangle(a, b, c, color) {
    const index = vertices.length / 3;
    vertices.push(...a, ...b, ...c); faces.push(index, index + 1, index + 2);
    colors.push(...color, ...color, ...color);
  }
  const counts = {}, surfaceTriangles = [];
  let detailCount = 0;
  function face(a, b, c, stoneColor) {
    if (Math.max(a[1], b[1], c[1]) === 0) return;
    const u = b.map((v, k) => v - a[k]), v = c.map((v, k) => v - a[k]);
    const normal = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
    if (Math.hypot(...normal) < 1e-12) return;
    const up = normal[1] / Math.hypot(...normal), center = a.map((v, k) => (v + b[k] + c[k]) / 3);
    const band = Math.floor((center[1] + center[0] * Math.tan(p.dip * Math.PI / 180)) / p.height * p.layers);
    let color = rgb(stoneColor ?? spec.color, .91 + (band % 2 ? .09 : 0));
    // Coherent patches span neighbouring triangles instead of confetti per face.
    const patchX = center[0] / p.width, patchZ = center[2] / p.width;
    let selected = null, roll = clamp(.5 + .25 * Math.sin(patchX * 11 + patchZ * 3 + phases[0])
      + .25 * Math.cos(patchZ * 9 - patchX * 2 + phases[1]), 0, 1);
    // One categorical draw includes bare rock; total cover never exceeds 90%.
    const eligible = model.surfaces.map(row => ({ ...row, weight: row.coverage *
      (['moss', 'lichen'].includes(row.kind) ? (up < -.01 ? 0 : .35 + .65 * Math.max(0, up)) : up > .82 ? 1 : 0) *
      (row.kind === 'water' && (up < .995 || center[1] > p.height * .2) ? 0 : 1) }));
    const total = eligible.reduce((sum, row) => sum + row.weight, 0);
    for (const row of eligible) {
      roll -= row.weight * Math.min(1, .9 / Math.max(.001, total));
      if (roll < 0) { selected = row.kind; break; }
    }
    if(Object.hasOwn(PHENOMENA,type)) {
      const cos=Math.cos(p.strike),sin=Math.sin(p.strike);
      const local=point=>[(point[0]*cos+point[2]*sin)*2/p.width,(-point[0]*sin+point[2]*cos)*2/(p.width*p.depthRatio)];
      const feature=phenomenaSurface(type,...local(center),p);
      if(feature==='water') {
        // Shore triangles stay bare; only a flat, fully submerged triangle is water.
        selected=up>=.995 && [a,b,c].every(point=>phenomenaSurface(type,...local(point),p)==='water')?'water':null;
      } else if(feature) selected=feature==='bare'?null:feature;
    }
    if (selected) {
      const coverColor = rgb(GEOLOGY_SURFACES[selected].color);
      // Thin weathering stains retain the underlying rock tone; water, snow and event cores stay opaque.
      const stain = ['mud', 'sand', 'moss', 'lichen'].includes(selected) ? .55 : 1;
      color = color.map((value, i) => value * (1 - stain) + coverColor[i] * stain);
      counts[selected] = (counts[selected] || 0) + 1;
    }
    triangle(a, b, c, color);
    surfaceTriangles.push({ center, up, surface: selected || 'bare' });
    if (!selected || detailCount >= 180 || !['grass', 'cones', 'wood', 'leaves', 'gravel'].includes(selected)) return;
    detailCount++;
    const scale = p.uniformScale ?? 1;
    const size = Math.min(.3, p.width / scale / n * .2) * scale, [x, y, z] = center;
    const height = selected === 'grass' ? size * 4 : selected === 'cones' ? size * 1.5 : size * .35;
    // Centroid is on the actual triangle; decorations grow from that anchor.
    const tip = [x, y + height, z];
    const a1 = [x - size, y, z], b1 = [x + size, y, z];
    triangle(a1, tip, b1, color); triangle(b1, tip, a1, color);
    triangle([x, y, z - size], [x, y, z + size], tip, color);
    triangle([x, y, z + size], [x, y, z - size], tip, color);
  }
  if (model.stone) {
    const transform = ([x,y,z]) => [(x*c-z*s)*p.uniformScale,y*p.uniformScale,(x*s+z*c)*p.uniformScale];
    const patchSpan = Math.max(...model.stoneGeometry.bounds.size)/12;
    function stoneFace(a,b,end,color,depth = 0) {
      const points = [a,b,end];
      const lengths = points.map((point,i) => Math.hypot(...point.map((v,k) => v-points[(i+1)%3][k])));
      const edge = lengths.indexOf(Math.max(...lengths));
      if (depth >= 4 || lengths[edge] <= patchSpan) {
        face(transform(a),transform(b),transform(end),color);
        return;
      }
      // Subdivide on the original plane: texture patches gain detail, proportions stay fixed.
      const first = points[edge], second = points[(edge+1)%3], third = points[(edge+2)%3];
      const middle = first.map((v,k) => (v+second[k])/2);
      stoneFace(first,middle,third,color,depth+1);
      stoneFace(middle,second,third,color,depth+1);
    }
    for (const { a,b,c: end,color } of model.stoneGeometry.triangles) stoneFace(a,b,end,color);
  } else for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
    const a = j * (n + 1) + i, b = a + 1, c = a + n + 1, d = c + 1;
    face(points[a], points[c], points[b]); face(points[b], points[c], points[d]);
  }
  const effects=[];
  if(Object.hasOwn(PHENOMENA,type)) {
    // Effect anchors interpolate the same mesh triangles used above, including noise.
    const terrainHeight=(x,z)=>{
      const gx=clamp((x/p.width+ .5)*n,0,n-1e-9),gz=clamp((z/(p.width*p.depthRatio)+.5)*n,0,n-1e-9);
      const ix=Math.floor(gx),iz=Math.floor(gz),u=gx-ix,v=gz-iz,base=iz*(n+1)+ix;
      const a=points[base][1],b=points[base+1][1],d=points[base+n+2][1],end=points[base+n+1][1];
      return u+v<=1?a+(b-a)*u+(end-a)*v:d+(end-d)*(1-u)+(b-d)*(1-v);
    };
    effects.push(...phenomenaEffects(type,p,terrainHeight,mulberry32(seed ^ 0x504c554d)));
    for(const effect of effects) {
      const {x,y,z,height,radius,kind,color}=effect;
      const transform=(dx,dy,dz)=>[(x+dx)*c-(z+dz)*s,y+dy,(x+dx)*s+(z+dz)*c];
      const rings=8,sides=8;
      for(let j=0;j<rings;j++) for(let i=0;i<sides;i++) {
        const point=(level,index)=>{
          const t=level/rings,a=index/sides*Math.PI*2;
          const spread=kind==='steam'||kind==='ash-plume'
            ?.2+2.3*Math.sin(Math.PI*t)**.5*(.7+.3*Math.sin(t*Math.PI*5)**2):1-t*.75;
          return transform(Math.cos(a)*radius*spread+t*t*e.wind*height*.2,t*height,Math.sin(a)*radius*spread);
        };
        const a=point(j,i),b=point(j,i+1),end=point(j+1,i),d=point(j+1,i+1),tint=rgb(color,.85+.15*j/rings);
        triangle(a,end,b,tint);triangle(b,end,d,tint);
        if(j===rings-1) triangle(end,transform(e.wind*height*.2,height,0),d,tint);
      }
    }
  }
  const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < vertices.length; i++) { const axis = i % 3; min[axis] = Math.min(min[axis], vertices[i]); max[axis] = Math.max(max[axis], vertices[i]); }
  const targetKey = GEOLOGY_PREFIX + type;
  const { stoneGeometry, ...generationModel } = model;
  const name = model.stone?.name ?? spec.name;
  return { key: `${targetKey}:${seed}:${JSON.stringify(e)}${model.stone ? ':'+model.stone.id+':'+p.uniformScale : ':'+JSON.stringify(p)}`, targetKey, family: 'environment', subpart: type,
    name, ...(model.stone ? { scalePolicy: 'uniform' } : {}), bounds: { min, max, size: max.map((v, i) => v - min[i]) },
    parts: [{ name, type: 'box', dimensions: [p.width, p.height, p.width * p.depthRatio],
      position: [0, p.height / 2, 0], color: spec.color, triangles: faces.length / 3 }], palettes: [],
    meshData: { vertices, faces, colors },
    generation: { source: 'geology', category: 'geology', ...generationModel, effects, surfaceCounts: counts, surfaceTriangles } };
}

// 狹長型邊界各突起波峰／波谷／誤差範圍（相對高度比例）：為邊界設計的狹長地形
// （懸崖峭壁／連續斷層面類）起伏極小、波谷維持高位；堆積／侵蝕類起伏較大。
// peak 下限恆 ≥ valley 上限，避免峰谷反轉。err 為雜訊倍率：斷層類等特定幾何
// 圖形誤差小，隨機性高的地質（冰磧／土堆／惡地／沙丘）誤差大。
export const ELONGATED_RELIEF = Object.freeze({
  cliff: { peak: [.88, 1], valley: [.70, .86], err: [.20, .50] },
  basalt: { peak: [.85, 1], valley: [.65, .83], err: [.20, .50] },
  fin: { peak: [.85, 1], valley: [.65, .83], err: [.25, .55] },
  mountain: { peak: [.75, 1], valley: [.30, .55], err: [.60, 1] },
  moraine: { peak: [.60, .95], valley: [.25, .50], err: [.80, 1.3] },
  mound: { peak: [.55, .90], valley: [.25, .50], err: [.80, 1.3] },
  island: { peak: [.70, 1], valley: [.35, .60], err: [.50, .90] },
  // 一般地質拉狹長型：高低變化大的連綿起伏，波谷可低至一成高度。
  granite: { peak: [.80, 1], valley: [.10, .32], err: [.50, .90] },
  sandstone: { peak: [.75, 1], valley: [.12, .35], err: [.50, .90] },
  tor: { peak: [.70, 1], valley: [.10, .30], err: [.60, 1] },
  spire: { peak: [.85, 1], valley: [.15, .35], err: [.50, .90] },
  karst: { peak: [.70, 1], valley: [.15, .35], err: [.50, .90] },
  marble: { peak: [.65, .95], valley: [.15, .35], err: [.50, .90] },
  dune: { peak: [.45, .85], valley: [.10, .30], err: [.70, 1.1] },
  crater: { peak: [.55, .90], valley: [.10, .30], err: [.50, .90] },
  badlands: { peak: [.60, .95], valley: [.12, .32], err: [.80, 1.2] },
  rocktower: { peak: [.75, 1], valley: [.12, .32], err: [.50, .90] },
  granite_towers: { peak: [.75, 1], valley: [.12, .32], err: [.50, .90] },
  conglomerate: { peak: [.75, 1], valley: [.12, .32], err: [.50, .90] },
  inselberg: { peak: [.75, 1], valley: [.12, .32], err: [.50, .90] },
  reef: { peak: [.40, .80], valley: [.10, .30], err: [.60, 1] },
  river: { peak: [.40, .80], valley: [.10, .30], err: [.60, 1] },
  default: { peak: [.70, 1], valley: [.30, .55], err: [.50, 1] },
});

// 狹長型邊界單體起伏參數:一次使用、沿長軸連續。突起數量與起伏程度由長寬比推導,
// 以種子抽取隨機範圍;愈狹長(長寬比愈大)突起愈多,鞍部愈低。
// 串流順序固定(bumps → saddle → relief → sharp → phases → roughness → layers → dissolution → per-bump),
// 新增取樣 MUST 附加在尾端,不得推移既有順序。per-bump 使用獨立 BUMP 串流,不推移前序。
export function elongatedGeologyParams(len, depth, seed) {
  if (!Number.isFinite(len) || !Number.isFinite(depth) || len <= 0 || depth <= 0)
    throw new RangeError('Elongated geology footprint must be positive finite numbers');
  if (!Number.isSafeInteger(seed)) throw new TypeError('Geology seed must be a safe integer');
  const rnd = mulberry32((seed ^ 0x454c4f4e) >>> 0);
  const aspect = len / depth;
  const minBumps = Math.max(1, Math.floor(aspect / 3));
  const maxBumps = Math.max(2, Math.ceil(aspect / 1.2));
  const bumps = minBumps + Math.floor(rnd() * (maxBumps - minBumps + 1));
  const saddleBase = Math.max(.22, .45 - aspect * .015);
  const saddle = saddleBase + rnd() * .25;
  const relief = .55 + rnd() * .45;
  const sharp = .6 + rnd() * .8;
  const phases = [rnd() * Math.PI * 2, rnd() * Math.PI * 2, rnd() * Math.PI * 2];
  return { bumps, saddle, relief, sharp, phases, aspect };
}

// 狹長型邊界連續起伏網格:以任意自然地形為基底(profile 唯一縫),沿長軸重複其造型,
// 每個突起抽取各自的隨機波峰、每道分界抽取各自的隨機波谷（範圍見 ELONGATED_RELIEF），
// 波長與起伏量（波峰−波谷）正相關（落差愈大波長愈長，另帶隨機抖動），雜訊再乘 per-bump 誤差倍率。
// 單一網格、零共享亂數;幾何與季節無關,色調由 tint 決定。
// 回傳 { meshData, size, params, undulation, heightAt }:size 為 [len, peakY, depth],網格基底 y0 = 0;
// undulation.wavelengths 以公尺計，加總等於 len。
export function elongatedGeologyMesh(type, seed, { len, depth, height, tint = 0xffffff } = {}) {
  const s = GEOLOGY_TYPES[type];
  if (!s) throw new RangeError(`Unknown geology type: ${type}`);
  if (s.lithology === 'manufactured') throw new RangeError('Elongated ridge needs a natural terrain type');
  if (!Number.isFinite(len) || !Number.isFinite(depth) || !Number.isFinite(height)
    || len <= 0 || depth <= 0 || height <= 0)
    throw new RangeError('Elongated geology dimensions must be positive finite numbers');
  if (!Number.isSafeInteger(seed)) throw new TypeError('Geology seed must be a safe integer');
  const params = elongatedGeologyParams(len, depth, seed);
  const { bumps, relief, sharp, phases } = params;
  const cfg = ELONGATED_RELIEF[type] || ELONGATED_RELIEF.default;
  const brnd = mulberry32((seed ^ 0x42554d50) >>> 0);
  const peaks = Array.from({ length: bumps },
    () => cfg.peak[0] + brnd() * (cfg.peak[1] - cfg.peak[0]));
  const valleys = Array.from({ length: bumps + 1 },
    () => cfg.valley[0] + brnd() * (cfg.valley[1] - cfg.valley[0]));
  const rawWave = peaks.map((peak, k) => (0.35 + 2.2 * (peak - (valleys[k] + valleys[k + 1]) / 2))
    * (0.9 + 0.2 * brnd()));
  const waveSum = rawWave.reduce((a, b) => a + b, 0);
  const wavelengths = rawWave.map(w => w / waveSum * len);
  const errors = Array.from({ length: bumps },
    () => cfg.err[0] + brnd() * (cfg.err[1] - cfg.err[0]));
  const bounds = [0];
  for (const w of wavelengths) bounds.push(bounds[bounds.length - 1] + w);
  bounds[bumps] = len;
  const locate = (x) => {
    let cell = 0;
    while (cell < bumps - 1 && x >= bounds[cell + 1]) cell++;
    return cell;
  };
  const rnd = mulberry32((seed ^ 0x52494447) >>> 0);
  const p = { roughness: s.roughness ? s.roughness[0] + rnd() * (s.roughness[1] - s.roughness[0]) : .1,
    erosion: .25 + rnd() * .75, layers: 4 + Math.floor(rnd() * 9), dissolution: rnd(), dip: 0 };
  if (Object.hasOwn(PHENOMENA, type)) Object.assign(p, { activity: .7,
    ventRadius: .12 + rnd() * .12, channelWidth: .12 + rnd() * .14, jetHeight: .3 + rnd() * .6 });
  const nx = Math.max(12, Math.min(96, Math.round(len / Math.max(1.5, depth / 8))));
  const nz = 8;
  const top = (ix, iz) => ix * (nz + 1) + iz;
  const vertices = [], colors = [], faces = [], grid = new Float32Array((nx + 1) * (nz + 1));
  const tintCh = [16, 8, 0].map(shift => ((tint >> shift) & 255) / 255);
  const paint = (y, shade) => {
    const t = clamp(y / height, 0, 1);
    const k = (.80 + .20 * t) * shade;
    return [16, 8, 0].map((shift, i) => linear(clamp(((s.color >> shift) & 255) / 255 * k * tintCh[i], 0, 1)));
  };
  let peakY = 0;
  for (let ix = 0; ix <= nx; ix++) {
    const u = ix / nx * 2 - 1;
    const x = Math.min(ix / nx * len, len - 1e-9), cell = locate(x);
    const span = bounds[cell + 1] - bounds[cell];
    const frac = span > 0 ? (x - bounds[cell]) / span : 0, lu = frac * 2 - 1;
    const blend = frac * frac * (3 - 2 * frac);
    const floor = valleys[cell] + (valleys[cell + 1] - valleys[cell]) * blend;
    const crest = peaks[cell], err = errors[cell];
    for (let iz = 0; iz <= nz; iz++) {
      const v = iz / nz * 2 - 1;
      const base = profile(type, lu * .92, v * .92, p);
      const noise = (Math.sin(lu * 7 + v * 3 + phases[0]) * .3
        + Math.sin(lu * 13 - v * 9 + phases[1]) * .15
        + Math.cos((lu + v) * 17 + phases[2]) * .05)
        * p.roughness * (1 - p.erosion * .5) * base * err;
      const cross = Math.pow(Math.max(0, Math.cos(v * Math.PI / 2)), .5 * sharp);
      const y = Math.max(0, Math.min(1,
        (floor + (crest - floor) * Math.min(1, Math.max(0, base + noise))) * (.72 + .28 * cross)
        + relief * .04 * Math.sin(u * bumps * Math.PI + phases[2]) * cross));
      const yy = Math.min(height, y * height);
      peakY = Math.max(peakY, yy);
      grid[top(ix, iz)] = yy;
      vertices.push(-len / 2 + ix / nx * len, yy, -depth / 2 + iz / nz * depth);
      colors.push(...paint(yy, .94 + .06 * Math.sin(lu * 31 + v * 4 + p.erosion * 3)));
    }
  }
  for (let ix = 0; ix < nx; ix++) for (let iz = 0; iz < nz; iz++) {
    const a = top(ix, iz), b = a + 1, c = a + nz + 1, d = c + 1;
    faces.push(a, c, b, b, c, d);
  }
  // 周邊裙擺:由表緣直落地面,雙面繞序(不透明批次單面渲染亦可見),色調壓暗。
  const skirt = (edge) => {
    for (let i = 0; i < edge.length - 1; i++) {
      const [t0, t1] = [edge[i], edge[i + 1]];
      const [x0, y0, z0] = vertices.slice(t0 * 3, t0 * 3 + 3);
      const [x1, y1, z1] = vertices.slice(t1 * 3, t1 * 3 + 3);
      const base = vertices.length / 3;
      const dark = (t) => colors.slice(t * 3, t * 3 + 3).map(v => v * .72);
      vertices.push(x0, y0, z0, x1, y1, z1, x0, 0, z0, x1, 0, z1);
      colors.push(...dark(t0), ...dark(t1), ...dark(t0).map(v => v * .9), ...dark(t1).map(v => v * .9));
      faces.push(base, base + 2, base + 1, base + 1, base + 2, base + 3,
        base, base + 1, base + 2, base + 1, base + 3, base + 2);
    }
  };
  const edgeLoop = [];
  for (let ix = 0; ix <= nx; ix++) edgeLoop.push(top(ix, 0));
  for (let iz = 1; iz <= nz; iz++) edgeLoop.push(top(nx, iz));
  for (let ix = nx - 1; ix >= 0; ix--) edgeLoop.push(top(ix, nz));
  for (let iz = nz - 1; iz >= 1; iz--) edgeLoop.push(top(0, iz));
  edgeLoop.push(top(0, 0));
  skirt(edgeLoop);
  const size = [len, Math.max(peakY, 1e-6), depth];
  // 脊頂高度取樣器(u, v ∈ [-1, 1])：覆蓋層（倒木等）落地用，與網格同一份高度。
  const heightAt = (u, v) => {
    if (!Number.isFinite(u) || !Number.isFinite(v)) return NaN;
    const gx = Math.max(0, Math.min(nx - 1e-9, (u + 1) / 2 * nx));
    const gz = Math.max(0, Math.min(nz - 1e-9, (v + 1) / 2 * nz));
    const ix = Math.floor(gx), iz = Math.floor(gz), fu = gx - ix, fv = gz - iz;
    const a = grid[top(ix, iz)], b = grid[top(ix + 1, iz)];
    const c = grid[top(ix, iz + 1)], d = grid[top(ix + 1, iz + 1)];
    return a + (b - a) * fu + (c - a) * fv + (a - b - c + d) * fu * fv;
  };
  return { meshData: { vertices, faces, colors }, size, params,
    undulation: { peaks, valleys, wavelengths, errors }, heightAt };
}
