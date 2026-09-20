import assert from 'node:assert/strict';
import { register } from 'node:module';
import { pathToFileURL } from 'node:url';
import { readSrc, grabFn } from '../tools/audit_src.mjs';
import { WALL_KINDS, wallParts, partBox, EDGE_MOTION, buildBoundaryRunParts } from '../public/js/edgewall.js';
import { ENVIRONMENT_OBJECTS } from '../public/js/environmentParts.js';
import { generateSharedBackgroundObject } from '../public/js/backgroundObjects.js';
import { buildSlopeBoundary, SLOPE_BOUNDARIES } from '../public/js/edgeSlope.js';
if (!process.env.THREE_MODULE) throw new Error('Set THREE_MODULE to the game Three.js module');
register('data:text/javascript,' + encodeURIComponent(`export async function resolve(s,c,next){
  if(s==='three')return {url:${JSON.stringify(pathToFileURL(process.env.THREE_MODULE).href)},shortCircuit:true};
  return next(s,c);
}`), import.meta.url);
const THREE = await import('three');
const { runtimeMeshDataGeometry, mergeRuntimeParts } = await import('../public/js/runtimePartModel.js');
const { mergeGeos } = await import('../public/js/beacons.js');
const wallGeo = new Function('THREE', 'runtimeMeshDataGeometry',
  grabFn(readSrc('public', 'js', 'biomes.js'), 'wallGeo') + '\nreturn wallGeo;')(THREE, runtimeMeshDataGeometry);
let count = 0;
for (const [kind, def] of Object.entries(WALL_KINDS)) for (const seed of [1, 42, 79]) {
  for (const p of wallParts(kind, { len: 30, depth: def.depth, h: def.h, seed })) {
    const g = wallGeo(p.g);
    assert(g?.attributes.position.count > 0, kind);
    const matrix = new THREE.Matrix4().compose(new THREE.Vector3(...p.p),
      new THREE.Quaternion().setFromEuler(new THREE.Euler(...(p.r || [0, 0, 0]))),
      new THREE.Vector3(...(p.s || [1, 1, 1])));
    g.applyMatrix4(matrix); g.computeBoundingBox();
    const b = partBox(p), actual = g.boundingBox;
    for (const axis of ['x', 'y', 'z']) {
      assert(actual.min[axis] >= b[axis + '0'] - 1e-4, kind + ': geometry outside descriptor');
      assert(actual.max[axis] <= b[axis + '1'] + 1e-4, kind + ': geometry outside descriptor');
    }
    if (p.c == null) {
      const before = [...g.attributes.color.array];
      const merged = mergeGeos([g], [null]);
      assert.deepEqual([...merged.attributes.color.array], before, 'geology vertex colors must survive batching');
      merged.dispose();
    } else g.dispose();
    count++;
  }
}
for (const kind of Object.keys(ENVIRONMENT_OBJECTS)) {
  const entry = generateSharedBackgroundObject('environment/' + kind, 42);
  const g = mergeRuntimeParts(entry.parts);
  assert(g.attributes.position.count > 0, kind);
  assert([...g.attributes.position.array].every(Number.isFinite), kind);
  g.dispose();
}
console.log(`PASS: ${count} rendered parts fit their descriptors; runtime scene compilation and geology colors verified.`);
for (const kind of Object.keys(SLOPE_BOUNDARIES)) {
  const def = WALL_KINDS[kind];
  const result = buildSlopeBoundary(kind, { len: 30, depth: def.depth, h: def.h,
    x: 0, z: 0, heightAt: (x, z) => x * 2 + z * .5 });
  for (const part of result.parts) {
    const geometry = wallGeo(part.g);
    assert(geometry.attributes.position.count > 0);
    assert([...geometry.attributes.normal.array].every(Number.isFinite));
    const merged = mergeGeos([geometry], [null]);
    merged.dispose();
  }
}
console.log('PASS: terrain-conforming boundary meshes compile and batch through the actual renderer.');

// Run the real dynamic builder: waterline must shift the root, not only static meshes.
const buildEdgeMotion = new Function('THREE', 'wallGeo', 'mergeGeos', 'envMat', 'EDGE_MOTION', `
  const _we = new THREE.Euler(), _wm = new THREE.Matrix4(), _wp = new THREE.Vector3();
  const _wq = new THREE.Quaternion(), _ws = new THREE.Vector3();
  const celWindAmount = () => 0, celWaveAmount = () => 0, celWindTime = () => 0;
  const celWindHeading = () => [1, 0];
  ${grabFn(readSrc('public', 'js', 'biomes.js'), 'buildEdgeMotion')}
  return buildEdgeMotion;
`)(THREE, wallGeo, mergeGeos, color => new THREE.MeshBasicMaterial({ color }), EDGE_MOTION);
for (const seed of [0, 42, 79]) {
  const group = new THREE.Group(), dynamics = [], ground = 10;
  const { parts: motion, bufferParts } = buildBoundaryRunParts('searanch', {
    len: 80, depth: 16, h: 12, bufferDepth: 40, seed, water: true,
  });
  assert(bufferParts.length > 0 && bufferParts.every(p => p.role.startsWith('cage-')),
    'aquaculture buffers reuse cages instead of unrelated ice');
  assert(buildEdgeMotion({ group, dynamics, segs: [{ x: 0, z: 0, ground, fry: 0, water: true, motion }] }) > 0);
  dynamics[0](1 / 60);
  group.updateMatrixWorld(true);
  for (const root of group.children) {
    const pivot = root.children[0];
    assert(Math.abs(pivot.getWorldPosition(new THREE.Vector3()).y - ground) < 1e-8, 'floating origin stays at waterline after update');
    const bounds = new THREE.Box3().setFromObject(root);
    const center = bounds.getCenter(new THREE.Vector3()), origin = pivot.getWorldPosition(new THREE.Vector3());
    assert(Math.abs(center.x - origin.x) < 1e-4 && Math.abs(center.z - origin.z) < 1e-4,
      'translated cells rotate around their own cage centers');
    assert(bounds.min.y < ground - 1.5 && bounds.max.y > ground && bounds.max.y < ground + .3,
      'rendered net stays submerged while floats straddle the surface');
  }
  group.traverse(object => { object.geometry?.dispose(); object.material?.dispose(); });
}
console.log('PASS: floating net cages keep their waterline in the real dynamic renderer.');
