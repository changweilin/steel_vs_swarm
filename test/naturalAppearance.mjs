// Natural variation must replay, retain its envelope and change actual surfaces and normals.
import assert from 'node:assert/strict';
import { sceneryMeshData } from '../public/js/sceneryAppearance.js';
import { createForestTree } from '../public/js/forest.js';
import { elongatedGeologyMesh } from '../public/js/geology.js';
import { SCENERY_MESHES } from '../public/js/sceneryMeshData.js';

for (const name of ['crown', 'stone', 'mushroomCap']) {
  const shapes = new Set(), lighting = new Set(), size = [3.7, .13, .9];
  for (let seed = 0; seed < 64; seed++) {
    const mesh = sceneryMeshData(name, size, seed);
    assert.deepEqual(mesh, sceneryMeshData(name, size, seed));
    assert.equal(mesh.faces.length, SCENERY_MESHES[name].faces.length, 'No added triangles');
    shapes.add(JSON.stringify(mesh.vertices)); lighting.add(JSON.stringify(mesh.normals));
    for (let i = 0; i < mesh.vertices.length; i += 3) {
      const [x, y, z] = mesh.vertices.slice(i, i + 3).map((v, axis) => v / size[axis]);
      assert(Math.hypot(x, z) <= .500001 && Math.abs(y) <= .500001);
      assert(Math.abs(Math.hypot(...mesh.normals.slice(i, i + 3)) - 1) < 1e-9);
    }
    let volume = 0;
    for (let i = 0; i < mesh.faces.length; i += 3) {
      const [a, b, c] = mesh.faces.slice(i, i + 3).map(id => mesh.vertices.slice(id * 3, id * 3 + 3));
      const u = b.map((v, axis) => v - a[axis]), v = c.map((n, axis) => n - a[axis]);
      const normal = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
      assert(Math.hypot(...normal) > 1e-10, 'No collapsed faces');
      volume += a.reduce((sum, value, axis) => sum + value * normal[axis], 0) / 6;
    }
    assert(volume > 0, 'Outward winding');
  }
  assert.equal(shapes.size, 64); assert.equal(lighting.size, 64);
}
for (const name of ['beveledBox', 'turbineBlade', 'planterShell']) {
  assert.deepEqual(sceneryMeshData(name, [1, 1, 1], 42), sceneryMeshData(name, [1, 1, 1]), 'Manufactured surfaces retain their design');
}
for (const seed of [NaN, Infinity, .5, '42']) assert.throws(() => sceneryMeshData('crown', [1, 1, 1], seed), TypeError);

for (const type of ['banyan', 'dougfir', 'holmOak', 'forestBamboo']) {
  for (let seed = 0; seed < 16; seed++) {
    const tree = createForestTree(type, seed), crowns = tree.parts.filter(p => p.role === 'leaf' && !p.noCard);
    assert(new Set(crowns.map(p => p.naturalSeed)).size === crowns.length);
    assert(new Set(crowns.map(p => p.c)).size > crowns.length / 2, type + ': per-crown colour');
    const shapes = crowns.map(p => sceneryMeshData('crown', [1, 1, 1], p.naturalSeed));
    assert.equal(new Set(shapes.map(mesh => JSON.stringify(mesh.vertices))).size, crowns.length);
    assert.deepEqual(tree.stems, createForestTree(type, seed, undefined, undefined, 1, 'winter').stems);
  }
}
for (let seed = 0; seed < 16; seed++) {
  const range = elongatedGeologyMesh('mountain', seed, { len: 160, depth: 16, height: 14, bufferDepth: 35 });
  const replay = elongatedGeologyMesh('mountain', seed, { len: 160, depth: 16, height: 14, bufferDepth: 35 });
  assert.deepEqual(range.meshData, replay.meshData); assert.deepEqual(range.bufferMeshData, replay.bufferMeshData);
  assert(range.summitMorphologies.length > 1);
  assert(range.summitMorphologies.every(m => m.family === range.morphology.family));
  if (range.morphology.family === 'arete') assert(range.summitMorphologies.every(m => m.ridgeWidth >= .22 && m.ridgeWidth <= .34));
  assert.equal(new Set(range.summitMorphologies.map(m => JSON.stringify(m))).size, range.params.bumps);
}
console.log('Natural appearance: distinct surfaces, normals, crowns and summits; replay, envelopes and triangle budgets passed.');
