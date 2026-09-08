import assert from 'node:assert/strict';
import { GEOLOGY_TYPES, generateGeology, geologyDistribution, geologyBackgroundObject } from '../public/js/geology.js';
import { generateSharedBackgroundObject, sharedBackgroundObjectTargets } from '../public/js/backgroundObjects.js';

let count = 0;
for (const type of Object.keys(GEOLOGY_TYPES)) {
  for (const seed of [0, 1, -12, 4294967295]) {
    const input = { climate: 'temperate', moisture: .95, vegetation: .9, conifers: .6 };
    const a = geologyBackgroundObject(type, seed, input), b = geologyBackgroundObject(type, seed, input);
    assert.deepEqual(a, b);
    const { vertices, faces, colors } = a.meshData;
    assert(vertices.length > 0 && vertices.every(Number.isFinite));
    assert.equal(colors.length, vertices.length);
    assert(colors.every(x => x >= 0 && x <= 1));
    assert(faces.every(x => Number.isInteger(x) && x >= 0 && x < vertices.length / 3));
    for (let k = 0; k < vertices.length; k++) assert(vertices[k] >= a.bounds.min[k % 3] && vertices[k] <= a.bounds.max[k % 3]);
    for (const row of a.generation.surfaceTriangles) {
      assert(row.up > 0 && row.up <= 1.000001);
      if (['cones', 'wood', 'leaves', 'grass', 'snow', 'gravel'].includes(row.surface)) assert(row.up > .82);
      if (row.surface === 'water') assert(row.up >= .995);
    }
    const bare = generateGeology(type, seed, { ...input, vegetation: 0 });
    assert.deepEqual(bare.parameters, a.generation.parameters);
    assert(bare.surfaces.filter(x => ['wood', 'leaves', 'cones', 'grass'].includes(x.kind)).every(x => x.coverage === 0));
    for (const key of ['width', 'height', 'ageMa', 'roughness']) {
      assert(a.generation.parameters[key] >= GEOLOGY_TYPES[type][key][0]);
      assert(a.generation.parameters[key] <= GEOLOGY_TYPES[type][key][1]);
    }
    count++;
  }
  const key = `geology/${type}`;
  assert(sharedBackgroundObjectTargets('geology').includes(key));
  assert.equal(generateSharedBackgroundObject(key, 1).generation.type, type);
}
for (const input of [{}, { water: 'sea', temperature: 25, depth: 12 }, { climate: 'alpine' }]) {
  assert(Math.abs(geologyDistribution(input).reduce((a, b) => a + b.weight, 0) - 1) < 1e-12);
}
for (const input of [{ water: 'lake', temperature: 25 }, { water: 'sea', temperature: 2 }, { water: 'sea', temperature: 25, depth: 100 }]) {
  assert(!geologyDistribution(input).some(x => x.type === 'reef'));
}
assert(geologyDistribution({ water: 'sea', temperature: 25, depth: 12 }).some(x => x.type === 'reef'));
const dryDune = generateGeology('dune', 42, { climate: 'arid', moisture: .1, vegetation: 0 });
assert(dryDune.surfaces.filter(x => ['mud', 'moss', 'lichen', 'water'].includes(x.kind)).every(x => x.coverage === 0));
assert.throws(() => generateGeology('missing'), RangeError);
assert.throws(() => generateGeology('granite', NaN), TypeError);
assert.throws(() => generateGeology('granite', 1, { water: 'bad' }), RangeError);
console.log(`Geology: ${count} deterministic meshes; bounds, surfaces, habitats, catalog and input guards passed.`);
