import assert from 'node:assert/strict';
import { ENVIRONMENT_OBJECTS, environmentParts } from '../public/js/environmentParts.js';
import { WALL_KINDS, STANDALONE_BOUNDARY_KINDS, BOUNDARY_ONLY_KINDS,
  boundaryObjectMeta, wallParts, wallFit, partBox, standaloneBoundaryParts } from '../public/js/edgewall.js';
import { sharedBackgroundObjectTargets, generateSharedBackgroundObject } from '../public/js/backgroundObjects.js';
import { readSrc, grabFn } from '../tools/audit_src.mjs';
import { edgeSeed } from '../public/js/edgewall.js';
import { edgeWallInsetM, objScaleFit, slopeDeg, SLOPE, WATER } from '../public/js/data.js';
import { mulberry32 } from '../public/js/rng.js';

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
  const alias = STANDALONE_BOUNDARY_KINDS.find(key => WALL_KINDS[key].object === kind);
  assert(alias, `${kind}: missing reverse boundary consumer`);
  const options = { len: def.size[0], h: def.size[1], depth: def.size[2], seed: 42, variant: 0 };
  const rows = environmentParts(kind, { seed: 42 });
  assert.deepEqual(rows, wallParts(alias, options), `${kind}: one generator for both uses`);
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
console.log(`Procedural environment: ${samples} boundary envelopes, ${Object.keys(ENVIRONMENT_OBJECTS).length} shared types passed.`);

// Execute the actual scene placement code against synthetic terrain; rendering is checked separately.
const biomeSource = readSrc('public', 'js', 'biomes.js');
const placementDeps = { ENVIRONMENT_OBJECTS, environmentParts, edgeSeed, edgeWallInsetM,
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
    sampleColor: () => [110, 110, 110], ...overrides };
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
assert.equal(field({ heightAt: () => -5, waterY: 0 }).objects.length, 0, 'no submerged placements');
assert.equal(field({ heightAt: (x, z) => 3000 + x * 2 + z * 2 }).objects.length, 0, 'reject steep terrain');
assert.equal(field({ heightAt: () => NaN }).objects.length, 0, 'failed terrain samples are omitted');
console.log('Scene placement: determinism, blockers, spawn/road/OSM clearance, water and slopes passed.');

if (process.argv.includes('--serve')) {
  const { createServer } = await import('node:http');
  const { readFile } = await import('node:fs/promises');
  const { fileURLToPath } = await import('node:url');
  const path = await import('node:path');
  const root = fileURLToPath(new URL('../public/', import.meta.url));
  const three = fileURLToPath(new URL('../out/forest_review/three.module.js', import.meta.url));
  createServer(async (req, res) => {
    try {
      const route = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
      const target = route === '/' ? fileURLToPath(new URL('./environmentPreview.html', import.meta.url))
        : route === '/three.js' ? three : path.resolve(root, '.' + route);
      if (route !== '/' && route !== '/three.js' && !target.startsWith(root)) { res.writeHead(403); res.end(); return; }
      const data = await readFile(target);
      res.setHeader('Content-Type', target.endsWith('.html') ? 'text/html; charset=utf-8' : 'text/javascript');
      res.end(data);
    } catch { res.writeHead(404); res.end(); }
  }).listen(8646, '127.0.0.1', () => console.log('Environment preview: http://127.0.0.1:8646'));
}
