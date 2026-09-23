import assert from 'node:assert/strict';
import { ENVIRONMENT_OBJECTS, environmentParts, environmentSize, environmentAvailable } from '../public/js/environmentParts.js';
import { WALL_KINDS, STANDALONE_BOUNDARY_KINDS, BOUNDARY_ONLY_KINDS,
  boundaryObjectMeta, wallParts, wallFit, partBox, standaloneBoundaryParts, wallCandidates, planWallRuns } from '../public/js/edgewall.js';
import { sharedBackgroundObjectTargets, generateSharedBackgroundObject } from '../public/js/backgroundObjects.js';
import { readSrc, grabFn } from '../tools/audit_src.mjs';
import { edgeSeed } from '../public/js/edgewall.js';
import { edgeWallInsetM, objScaleFit, slopeDeg, SLOPE, WATER } from '../public/js/data.js';
import { mulberry32 } from '../public/js/rng.js';
import { iceParts } from '../public/js/iceParts.js';

let samples = 0;
for (const [kind, def] of Object.entries(WALL_KINDS)) {
  const fingerprints = new Set();
  for (const len of [12, 24, 30, 48]) for (let seed = 0; seed < 80; seed++) {
    const options = { len, depth: def.depth, h: def.h, seed };
    const rows = wallParts(kind, options);
    assert(rows.length > 0, kind);
    assert.deepEqual(rows, wallParts(kind, options), `${kind}: repeatability`);
    assert(wallFit(rows, len, def.depth, def.h).fit, `${kind}: envelope seed=${seed} len=${len}`);
    assert(rows.every(p => Object.values(partBox(p)).every(Number.isFinite)), `${kind}: finite geometry`);
    if (len === 30) fingerprints.add(JSON.stringify(rows));
    samples++;
  }
  assert(fingerprints.size > 1, `${kind}: seeded variation`);
  assert.equal(typeof boundaryObjectMeta(kind).category, 'string');
}
for (const [kind, def] of Object.entries(ENVIRONMENT_OBJECTS)) {
  // 同名款優先：假山群已改走一般地質狹長單體，巨石仍由同名邊界款共用同一生成器。
  const alias = STANDALONE_BOUNDARY_KINDS.find(key => key === kind)
    ?? STANDALONE_BOUNDARY_KINDS.find(key => WALL_KINDS[key].object === kind);
  assert(alias, `${kind}: missing reverse boundary consumer`);
  const options = { len: def.size[0], h: def.size[1], depth: def.size[2], seed: 42, variant: 0 };
  const rows = environmentParts(kind, { seed: 42 });
  // 同一生成器、同參數、同輸出：wallParts 本体預設 yaw:false（連續除外），此處以 yaw:true 比對同源一致性。
  assert.deepEqual(rows, wallParts(alias, { ...options, yaw: true }), `${kind}: one generator for both uses`);
  const entry = generateSharedBackgroundObject(`environment/${kind}`, 42);
  assert.equal(entry.parts.length, rows.length);
  assert(entry.bounds.size.every(n => Number.isFinite(n) && n > 0));
}
for (const kind of BOUNDARY_ONLY_KINDS) {
  assert.throws(() => standaloneBoundaryParts(kind), RangeError);
  assert(!sharedBackgroundObjectTargets().includes(`edge/${kind}`));
}
assert(sharedBackgroundObjectTargets().every(key => /^(environment|edge|geology|vehicle|consist)\//.test(key)));
assert.throws(() => environmentParts('missing'), RangeError);
assert.throws(() => environmentParts('house', { size: [1, 0, 1] }), RangeError);
assert.throws(() => environmentParts('house', { seed: NaN }), RangeError);
for (const kind of ['icefloe', 'iceberg']) for (let seed = 0; seed < 64; seed++) {
  const size = environmentSize(kind, seed), [part] = iceParts(kind, size, seed);
  const { vertices, faces } = part.g[1], n = (vertices.length / 3 - 2) / 3;
  const edges = new Map();
  let volume = 0;
  for (let i = 0; i < faces.length; i += 3) {
    const ids = faces.slice(i, i + 3), [a, b, c] = ids.map(id => vertices.slice(id * 3, id * 3 + 3));
    volume += a[0] * (b[1]*c[2]-b[2]*c[1]) + a[1] * (b[2]*c[0]-b[0]*c[2]) + a[2] * (b[0]*c[1]-b[1]*c[0]);
    for (let k = 0; k < 3; k++) {
      const from = ids[k], to = ids[(k + 1) % 3], key = [from,to].sort((a,b)=>a-b).join(':');
      const row = edges.get(key) || { count: 0, winding: 0 };
      row.count++; row.winding += from < to ? 1 : -1; edges.set(key,row);
    }
  }
  assert(volume > 0, 'ice normals point outward');
  assert([...edges.values()].every(e => e.count === 2 && e.winding === 0), 'closed manifold ice');
  for (let i = 0; i < n; i++) assert(vertices[(2*n+i)*3+1] >= vertices[(n+i)*3+1], 'ice crown stays above waterline');
  assert.deepEqual(size, environmentSize(kind, seed));
}
const iceKinds = ['icefloe', 'iceberg', 'seaice'];
assert(iceKinds.every(kind => wallCandidates('water', true, 'flat', { temperature: -5 }).includes(kind)));
assert(wallCandidates('water', true, 'flat', { temperature: 25 }).every(kind => !iceKinds.includes(kind)));
const waterSegments = Array.from({ length: 80 }, (_, i) => ({ x: i * 30, z: 10, len: 30, water: true, biome: 'water' }));
assert(planWallRuns(waterSegments, { environment: { temperature: 25 } }).every(run => !iceKinds.includes(run.kind)));
assert(planWallRuns(waterSegments, { environment: { temperature: -5 } }).some(run => iceKinds.includes(run.kind)));
assert(wallCandidates('water', true, 'flat', { ice: false, temperature: -5 }).every(kind => !iceKinds.includes(kind)));
console.log(`Procedural environment: ${samples} boundary envelopes, ${Object.keys(ENVIRONMENT_OBJECTS).length} shared types passed.`);

// Execute the actual scene placement code against synthetic terrain; rendering is checked separately.
const biomeSource = readSrc('public', 'js', 'biomes.js');
const placementDeps = { ENVIRONMENT_OBJECTS, environmentParts, environmentSize, environmentAvailable, edgeSeed, edgeWallInsetM,
  objScaleFit, slopeDeg, SLOPE, WATER, mulberry32, partBox,
  newBatch: () => [], emitWallParts: (batch, parts) => batch.push(parts), flushPartBatch: () => {} };
const placementHelpers = ['areaFreeCore', 'areaFree', 'blockArea', 'makeOccupancy', 'classifyImg', 'terrainEnvCode', 'placeSharedEnvironment'];
const placement = new Function(...Object.keys(placementDeps),
  biomeSource.match(/const CELL = \d+;/)[0] + '\n' + placementHelpers.map(k => grabFn(biomeSource, k)).join('\n')
  + '\nreturn {placeSharedEnvironment,makeOccupancy,blockArea};')(...Object.values(placementDeps));
function field(overrides = {}, gates = {}) {
  const blocked = new Set(), blockers = [], group = { userData: {} };
  placement.blockArea(blocked, 0, 0, 150);
  const terrain = { minX: -600, maxX: 600, minZ: -600, maxZ: 600, heightAt: () => 20,
    sampleColor: () => [110, 110, 110], objectEnvironment: { temperature: -5 }, ...overrides };
  placement.placeSharedEnvironment({ group, terrain, blocked, blockers, occ: placement.makeOccupancy(),
    roadOccupied: () => false, osmBldHit: () => false, seed: 42, ...gates });
  return { objects: group.userData.sharedEnvironment, blockers };
}
const placed = field();
assert(placed.objects.length > 0 && placed.blockers.length > 0);
assert.deepEqual(placed, field(), 'scene placement and collision repeat across clients');
assert(placed.objects.every(p => Math.hypot(p.x, p.z) > 150), 'spawn clearance stays free');
assert.equal(field({}, { roadOccupied: () => true }).objects.length, 0, 'road clearance');
assert.equal(field({}, { osmBldHit: () => true }).objects.length, 0, 'OSM building priority');
const water = field({ heightAt: () => -100, waterY: 0 });
assert(water.objects.length > 0 && water.blockers.length > 0, 'water ice is deployed with collision');
assert.deepEqual(water, field({ heightAt: () => -100, waterY: 0 }), 'water determinism');
assert(water.objects.every(p => ['icefloe', 'iceberg'].includes(p.kind) && p.y < 0), 'ice keels are submerged');
for (const p of water.objects) {
  const [part] = environmentParts(p.kind, { size: p.size, seed: p.seed });
  assert(Math.abs(p.y + part.waterline) < 1e-8, 'scene uses descriptor waterline');
  const bounds = partBox(part);
  assert(water.blockers.some(b => Math.abs(b.x - p.x) < 1e-8 && Math.abs(b.z - p.z) < 1e-8
    && Math.abs(b.y - (p.y + bounds.y0)) < 1e-8 && Math.abs(b.h - (bounds.y1 - bounds.y0)) < 1e-8),
  'ice collision matches rendered descriptor');
}
assert.equal(field({ heightAt: () => -.05, waterY: 0 }).objects.length, 0, 'shallow water rejects grounded ice');
assert.equal(field({ heightAt: () => -100, waterY: NaN }).objects.length, 0, 'unknown waterline');
assert.equal(field({ heightAt: () => -100 }).objects.length, 0, 'missing waterline');
assert.equal(field({ heightAt: () => -100, waterY: 0, objectEnvironment: { temperature: 25 } }).objects.length, 0, 'warm water has no automatic ice');
assert(field({ heightAt: () => -100, waterY: 0, objectEnvironment: { temperature: 25, ice: true } }).objects.length > 0, 'authored ice override');
for (const p of water.objects) {
  const shoal = field({ waterY: 0, heightAt: (x,z) => Math.abs(x-p.x)<1 && Math.abs(z-p.z)<1 ? -.01 : -100 });
  assert(!shoal.objects.some(q => q.x === p.x && q.z === p.z), 'interior shoal rejects footprint');
}
assert.equal(field({ heightAt: (x, z) => 3000 + x * 2 + z * 2 }).objects.length, 0, 'reject steep terrain');
assert.equal(field({ heightAt: () => NaN }).objects.length, 0, 'failed terrain samples are omitted');
console.log('Scene placement: determinism, blockers, spawn/road/OSM clearance, water and slopes passed.');
