import assert from 'node:assert/strict';
import { register } from 'node:module';
import { pathToFileURL } from 'node:url';
import { readSrc, grabFn } from '../tools/audit_src.mjs';
import { WALL_KINDS, wallParts, partBox } from '../public/js/edgewall.js';
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
