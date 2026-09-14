import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
import { readSrc, grabFn } from '../tools/audit_src.mjs';
import { edgeWallInsetM } from '../public/js/data.js';
import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';

const THREE = await import(pathToFileURL(process.env.THREE_MODULE || 'out/forest_review/three.module.js').href);
const build = new Function('THREE', 'edgeWallInsetM', 'llToWorld', 'terrainEnvCode', 'toonMat', 'cyl', 'ico',
  `${grabFn(readSrc('public', 'js', 'biomes.js'), 'buildRoadBlocks')} return buildRoadBlocks;`)(
  THREE, edgeWallInsetM, (lat, lon) => [lat, lon], () => 0,
  color => new THREE.MeshBasicMaterial({ color }),
  (...args) => new THREE.CylinderGeometry(...args), r => new THREE.IcosahedronGeometry(r, 0));
const terrain = { minX: -100, maxX: 100, minZ: -100, maxZ: 100,
  // Runtime heightAt clamps out-of-map samples, hiding erroneous placements.
  heightAt: () => 20 };
function run(points) {
  const group = new THREE.Group(), blockers = [];
  const count = build(group, [{ tags: { highway: 'primary' }, geometry: points.map(([lat, lon]) => ({ lat, lon })) }],
    terrain, {}, blockers, () => .99); // Force the road-pit branch.
  for (const blocker of blockers) {
    assert(blocker.x - blocker.r >= terrain.minX && blocker.x + blocker.r <= terrain.maxX
      && blocker.z - blocker.r >= terrain.minZ && blocker.z + blocker.r <= terrain.maxZ,
    `road block escaped map: ${blocker.x}, ${blocker.z}`);
  }
  const bounds = new THREE.Box3().setFromObject(group);
  if (count) assert(bounds.min.x >= -100 && bounds.max.x <= 100 && bounds.min.z >= -100 && bounds.max.z <= 100,
    'all pit debris and barriers remain on the map');
  group.traverse(o => { o.geometry?.dispose(); o.material?.dispose(); });
  return { count, blockers };
}

for (const flip of [-1, 1]) for (const swap of [false, true]) {
  const points = [[-300 * flip, 100 * flip], [0, 0]].map(([x, z]) => swap ? [z, x] : [x, z]);
  const incoming = run(points), outgoing = run(points.slice().reverse());
  assert.equal(incoming.count, 1);
  assert.equal(outgoing.count, 1);
  assert(Math.hypot(incoming.blockers[0].x - outgoing.blockers[0].x,
    incoming.blockers[0].z - outgoing.blockers[0].z) < 1e-8, 'road direction cannot change the crossing');
}
for (const points of [[[-60, 0], [0, 0]], [[0, -60], [0, 0]], [[-300, -300], [0, 0]]]) {
  assert.equal(run(points).count, 1, 'boundary endpoints and corners supported');
}
assert.equal(run([[-300, 200], [-200, 300]]).count, 0, 'outside road omitted');
assert.equal(run([[0, 0], [20, 20]]).count, 0, 'inside road needs no block');
console.log('roadBlockBounds: diagonal entry, reversal, all edges, corners and endpoints passed');

