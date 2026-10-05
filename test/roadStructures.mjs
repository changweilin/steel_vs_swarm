import assert from 'node:assert/strict';
import { readSrc, grabFn, grabMethod, grabBlock } from '../tools/audit_src.mjs';
import { planBridgeDeck, structureLayer, bridgeConnections, waysShareNode, bridgeOpenings, bridgeOpeningAt, bridgeSupportClearance, platformApproaches, roundaboutIsland } from '../public/js/roadStructures.js';
import { ROAD_STRUCTURE_MESHES } from '../public/js/roadStructureMeshData.js';
import { MAPGEO, GAME, xzToLL } from '../public/js/data.js';
import { makeDeckAt, buildStructs, densify, roadWidth, ROAD_SEG } from '../tools/venue_field.mjs';

const grade = Math.tan(MAPGEO.MAX_ROAD_GRADE_DEG * Math.PI / 180);
const options = { rise: 7.5, grade, lift: .45 };
let profiles = 0;
for (const length of [12, 24, 48, 90, 180, 360]) for (const slope of [-.12, 0, .12]) {
  const count = Math.ceil(length / 3);
  const points = Array.from({ length: count + 1 }, (_, i) => [i * length / count, 0]);
  const heightAt = x => 20 + slope * x;
  const plan = planBridgeDeck(points, heightAt, options);
  assert(plan);
  assert(Math.abs(plan.at(0) - heightAt(0) - options.lift) < 1e-9);
  assert(Math.abs(plan.at(length) - heightAt(length) - options.lift) < 1e-9);
  for (let i = 1; i < plan.floors.length; i++) {
    assert(Math.abs(plan.floors[i] - plan.floors[i - 1]) / (plan.cum[i] - plan.cum[i - 1]) <= grade + 1e-8);
    assert(plan.floors[i] >= heightAt(points[i][0]) + options.lift - 1e-8);
  }
  for (let s = .35; s < length; s += .35) assert(Math.abs(plan.at(s) - plan.at(s - .35)) < .35 * grade + 1e-8);
  profiles++;
}
const points = Array.from({ length: 81 }, (_, i) => [i * 3 - 120, 0]);
const hill = x => 20 + 9 * Math.exp(-((x / 27) ** 2));
const plan = planBridgeDeck(points, hill, options);
assert(plan, 'a terrain hump is supported by the grade envelope');
for (let i = 0; i < points.length; i++) assert(plan.floors[i] >= hill(points[i][0]) + options.lift - 1e-8);
assert.equal(planBridgeDeck(points, x => x === 0 ? 200 : 20, options), null, 'impossible terrain is reported, never buried');
assert.equal(planBridgeDeck([[0, 0], [0, 0]], () => 20, options), null);
assert.equal(planBridgeDeck(points, () => NaN, options), null);
assert.equal(planBridgeDeck(points, () => 20, { ...options, waterFloor: NaN }), null);
assert.equal(planBridgeDeck([[0, 0], [NaN, 0]], () => 20, options), null);
const offline = makeDeckAt(points, hill, { waterFloor: -Infinity });
for (const s of [0, 3, 35.1, 120, 240]) assert.equal(offline(s), plan.at(s), 'offline and runtime deck profiles agree');

const way = (pts, layer = '1') => ({ tags: { highway: 'primary', bridge: 'yes', layer },
  geometry: pts.map(([lat, lon]) => ({ lat, lon })) });
const main = way([[-180, 0], [0, 0], [180, 0]]), branch = way([[0, 0], [80, 80], [160, 100]]);
const upper = way([[0, -180], [0, 0], [0, 180]], '2');
const network = [main, branch, upper], connected = bridgeConnections(network);
assert(connected(main, main.geometry[1])); assert(connected(branch, branch.geometry[0]));
assert(!connected(upper, upper.geometry[1]));
const gaps = bridgeOpenings(network, main, p => [p.lat, p.lon]);
assert(bridgeOpeningAt(gaps, 0, 0, 10)); assert(!bridgeOpeningAt(gaps, 40, 0, 10));
assert.equal(structureLayer({ tunnel: 'culvert' }), -1);
const mainPlan = planBridgeDeck([[-180, 0], [0, 0], [180, 0]], () => 20, { ...options, joins: [[0, 0]] });
const branchPlan = planBridgeDeck([[0, 0], [80, 80], [160, 100]], () => 20,
  { ...options, startJoined: true, joins: [[0, 0]] });
assert(mainPlan && branchPlan); assert.equal(mainPlan.at(180), branchPlan.at(0));
const supportClear = bridgeSupportClearance(network, p => [p.lat, p.lon], () => 16);
assert(!supportClear(upper, 0, 0, 1.4), 'upper supports cannot block a lower road');
assert(supportClear(upper, 0, -70, 1.4));
assert(supportClear(main, -70, 0, 1.4), 'a higher deck does not exclude lower supports');

const bio = readSrc('public', 'js', 'biomes.js');
const crossDedupe = new Function('structureLayer', 'waysShareNode', 'densify', 'llToWorld', 'roadWidth', 'CROSS_GAP', 'RAIL_RANK', 'ROAD_SEG',
  `${grabFn(bio, 'polylinesMeet')}\n${grabFn(bio, 'dedupeCrossingBridges')}\nreturn dedupeCrossingBridges;`)(
  structureLayer, waysShareNode, densify, (lat, lon) => [lat, lon], roadWidth,
  +/const CROSS_GAP = ([\d.]+)/.exec(bio)[1], +/const RAIL_RANK = ([\d.]+)/.exec(bio)[1], ROAD_SEG);
assert.equal(crossDedupe(network, {}).roads.length, 3, 'layers and connected branches survive crossing deduplication');
const parallelDedupe = new Function('structureLayer', 'waysShareNode', 'densify', 'llToWorld', 'bridgeHw', 'isPedestrianBridge', 'ROAD_SEG',
  `${grabFn(bio, 'overlapFrac')}\n${grabFn(bio, 'dedupeParallelBridges')}\nreturn dedupeParallelBridges;`)(
  structureLayer, waysShareNode, densify, (lat, lon) => [lat, lon], () => 8, () => false, ROAD_SEG);
const parallelBranch = way([[0, 0], [50, 2], [100, 5]]);
assert.equal(parallelDedupe([main, parallelBranch], {}).length, 2, 'a connected slip road survives parallel deduplication');
assert.equal(parallelDedupe([main, way([[-170, 2], [170, 2]])], {}).length, 1, 'disconnected duplicate carriageways still merge');
const center = { lat: 25, lng: 121, rot: 0 };
const shortBridge = { tags: { highway: 'secondary', bridge: 'yes' }, geometry: [[-6, 0], [6, 0]].map(p => {
  const [lat, lon] = xzToLL(...p, center); return { lat, lon };
}) };
assert.equal(buildStructs({ roads: [shortBridge] }, center, { minX: -50, maxX: 50, minZ: -50, maxZ: 50, heightAt: () => 20 }).structs.length, 1);
const deckIndex = new Function(`${grabFn(bio, 'makeDeckIndex')} return makeDeckIndex;`)();
const decks = [10, 18, 26].map(y => ({ x1: -50, z1: 0, y1: y, x2: 50, z2: 0, y2: y, hw: 8 }));
const query = deckIndex(decks);
assert.equal(query(0, 0), 26); assert.equal(query(0, 0, 0, -Infinity, 12), 10);
assert.equal(query(0, 0, 0, 12, 25, true), 18); assert.equal(query(0, 0, 0, 30), null);
const mainSource = readSrc('public', 'js', 'main.js');
const constants = ['DECK_STEP', 'DECK_MARGIN', 'DECK_UNDER', 'MAX_MECH_H', 'BLK_MARGIN'].map(name =>
  +new RegExp(`const ${name} = ([\\d.]+)`).exec(mainSource)[1]);
const surface = new Function('terrain', 'deckY', 'tunnelAt', 'blockerTop', 'roofPlatformAt',
  'DECK_STEP', 'DECK_MARGIN', 'DECK_UNDER', 'MAX_MECH_H', 'BLK_MARGIN',
  `return (x,z,curY) => ${grabBlock(mainSource, 'terrain.surfaceAt =')}`)(
  { heightAt: () => 0 }, query, () => null, () => null, () => null, ...constants);
for (const y of [10, 18, 26]) assert.equal(surface(0, 0, y), y, 'standing retains the reachable deck');
assert.equal(surface(0, 0, 0), 0, 'ground movement is not pulled onto a high deck');

const terrainSource = readSrc('public', 'js', 'terrain.js');
const padR = Math.max(GAME.HERO_HEAL_R, Math.hypot(GAME.HERO_SPAWN_OFF, GAME.HERO_SPAWN_SIDE))
  + +/const TOWER_PAD_R = ([\d.]+)/.exec(bio)[1];
for (const slope of [-.14, .14]) for (const ry of [0, Math.PI / 5]) {
  const ca = Math.cos(ry), sa = Math.sin(ry), natural = (x, z) => 60 + (x * ca - z * sa) * slope;
  const lane = densify([[-240 * ca, 240 * sa], [240 * ca, -240 * sa]], 6);
  const pad = { cx: 0, cz: 0, hw: padR, hd: padR, y: 60.45, ry, padT: 1.4, margin: 2.2, targetY: 60.2 };
  pad.approaches = platformApproaches(pad, [lane], natural, { grade, lift: .45, overlap: 12 });
  assert.equal(pad.approaches.length, 2, 'cut and fill sides have graded access');
  for (const access of pad.approaches) {
    assert.equal(access.floors[0], 60); assert.equal(access.floors[1], 60);
    assert(Math.abs(access.floors.at(-1) - natural(...access.pts.at(-1))) < 1e-7);
    for (let i = 1; i < access.pts.length; i++) assert(Math.abs(access.floors[i] - access.floors[i - 1])
      <= grade * Math.hypot(access.pts[i][0] - access.pts[i - 1][0], access.pts[i][1] - access.pts[i - 1][1]) + 1e-7);
  }
  const N = 181, lo = -270, hi = 270, heights = new Float32Array(N * N);
  for (let i = 0; i < N; i++) for (let j = 0; j < N; j++) heights[i * N + j] = natural(lo + j * 3, lo + i * 3);
  const sampled = new Function('N', 'minX', 'maxX', 'minZ', 'maxZ', 'heights', 'markCarved', 'syncHeights',
    `function carvePlatforms(platforms) ${grabBlock(terrainSource, 'function carvePlatforms(')}
     function sampleField(field,x,z) ${grabBlock(terrainSource, 'function sampleField(')}
     carvePlatforms([arguments[8]]); return (x,z)=>sampleField(heights,x,z);`)(
    N, lo, hi, lo, hi, heights, () => {}, () => {}, pad);
  const surfaceOnPad = new Function('terrain', 'deckY', 'tunnelAt', 'blockerTop', 'roofPlatformAt',
    'DECK_STEP', 'DECK_MARGIN', 'DECK_UNDER', 'MAX_MECH_H', 'BLK_MARGIN',
    `return (x,z,curY) => ${grabBlock(mainSource, 'terrain.surfaceAt =')}`)(
    { heightAt: sampled }, deckIndex([{ x1: -ca * padR, z1: sa * padR, y1: pad.y, x2: ca * padR, z2: -sa * padR, y2: pad.y, hw: padR }]),
    () => null, () => null, () => null, ...constants);
  let y = sampled(...lane[0]);
  for (let s = -240; s <= 240; s += .35) {
    const next = surfaceOnPad(s * ca, -s * sa, y);
    assert(Number.isFinite(next)); assert(Math.abs(next - y) < .6, 'rotated slab edges remain walkable across grid triangles'); y = next;
  }
  assert.equal(platformApproaches(pad, [lane], natural, { grade, lift: .45, dryAt: () => false }).length, 0);
}
const slab = new Function(`return function ${grabMethod(readSrc('public', 'js', 'game.js'), '_slabHitT')};`)();
const env = { terrain: { deckY: query, deckUnder: 1.2 } };
for (const y of [10, 18, 26]) {
  assert(slab.call(env, 0, y - 3, 0, 0, y + 3, 0) != null);
  assert(slab.call(env, 0, y + 3, 0, 0, y - 3, 0) != null);
}
assert.equal(slab.call(env, -40, 14, 0, 40, 14, 0), null, 'between deck layers remains open');

const poly = Array.from({ length: 33 }, (_, i) => [Math.cos(i / 32 * Math.PI * 2) * 30, Math.sin(i / 32 * Math.PI * 2) * 30]);
const island = roundaboutIsland(poly, 5);
assert(island && island.r < 25 && island.r > 20);
assert.equal(roundaboutIsland(poly.slice(0, -1), 5), null);
assert.equal(roundaboutIsland(poly, 31), null);
for (const [name, member] of Object.entries(ROAD_STRUCTURE_MESHES)) {
  assert(member.vertices.every(Number.isFinite)); assert.equal(member.faces.length % 3, 0);
  assert(member.faces.every(i => Number.isInteger(i) && i >= 0 && i < member.vertices.length / 3));
  assert(member.vertices.every(v => Math.abs(v) <= .5000001), `${name} fits its collision envelope`);
  const edges = new Map();
  for (let i = 0; i < member.faces.length; i += 3) for (let k = 0; k < 3; k++) {
    const a = member.faces[i + k], b = member.faces[i + (k + 1) % 3];
    const key = [a, b].sort((a, b) => a - b).join(','); edges.set(key, (edges.get(key) || 0) + 1);
  }
  assert([...edges.values()].every(n => n === 2), `${name} is a sealed member`);
}
assert(readSrc('public', 'js', 'osmQuery.js').includes('(motorway|trunk|primary|secondary|tertiary)_link'));
console.log(`PASS: ${profiles} grade profiles, terrain envelope, branch joints, three deck layers, bidirectional ballistics, rotated platform access, islands and 11 sealed Blender members.`);
