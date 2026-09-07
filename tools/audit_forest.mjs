import assert from 'node:assert/strict';
import { TREE_SPECIES, TREE_VARIANTS, createForestDefs, createForestTree, treeBend, treeSections, treeDistribution, pickTreeType, forestSeed } from '../public/js/forest.js';
import { mulberry32 } from '../public/js/rng.js';
import { quatApply, quatFromEuler } from '../public/js/xform.js';

const cyl = (radiusTop, radiusBottom, height) => ({ parameters: { radiusTop, radiusBottom, height } });
const ico = radius => ({ parameters: { radius } });
const defs = createForestDefs(cyl, ico);
assert.deepEqual(defs, createForestDefs(cyl, ico));
for (const def of Object.values(defs)) {
  assert.equal(def.variants.length, TREE_VARIANTS);
  assert.equal(new Set(def.variants.map(parts => JSON.stringify(parts))).size, TREE_VARIANTS);
  for (const parts of def.variants) {
    assert.ok(parts.length <= 55, 'bounded generated components (merged into two draw calls)');
    for (const part of parts) {
      const p = part.g.parameters;
      if (p.height) {
        const dir = quatApply(quatFromEuler(part.rx || 0, part.ry || 0, part.rz || 0), [0, 1, 0]);
        const endpoints = [-1, 1].map(sign => [part.px || 0, part.y, part.pz || 0]
          .map((v, i) => v + sign * dir[i] * p.height / 2));
        assert.ok(endpoints.every(point => point.every(Number.isFinite)));
        assert.ok(endpoints.every(point => point[1] >= -1e-6 && point[1] <= def.h));
      } else {
        assert.equal(part.key, 'gleaf', 'foliage keeps the shared wind/season channel');
        assert.ok(part.y + p.radius * part.sy <= def.h);
      }
    }
  }
}
for (const type of Object.keys(TREE_SPECIES)) {
  const samples = Array.from({ length: 200 }, (_, seed) => createForestTree(type, seed));
  for (const key of ['h', 'r', 'branchCount', 'sections']) {
    assert.ok(new Set(samples.map(tree => tree[key])).size > 2, `${type}: independent ${key} variation`);
  }
  assert.ok(new Set(samples.map(tree => tree.parts.filter(p => p.key).length)).size > 2);
  for (const [seed, tree] of samples.entries()) {
    assert.deepEqual(tree, createForestTree(type, seed));
    assert.equal(tree.girth, 2 * Math.PI * tree.r);
    const taller = createForestTree(type, seed, undefined, undefined, 2);
    assert.ok(taller.sections > tree.sections, 'final world height adds trunk rings');
    assert.equal(taller.branchCount, tree.branchCount, 'subdivision must not consume randomness');
    for (const part of tree.parts) {
      if (part.g.parameters.height) assert.equal(part.g.parameters.heightSegments, treeSections(part.g.parameters.height));
      else assert.ok(part.y + part.g.parameters.radius * part.sy <= tree.h, 'crown stays below sampled tree height');
    }
  }
}
assert.ok(treeBend(100, 2).flex > treeBend(40, 2).flex);
assert.ok(treeBend(100, 2).rate < treeBend(40, 2).rate);
assert.ok(treeBend(100, 2).lag > treeBend(40, 2).lag);
assert.ok(treeBend(100, 2).flex > treeBend(100, 5).flex);
for (const lat of [0, 15, 25, 45, 65, 85]) for (const altitude of [0, 800, 1800, 3000, 4500]) {
  const rows = treeDistribution(lat, altitude);
  assert.deepEqual(rows, treeDistribution(-lat, altitude));
  if (!rows.length) continue;
  assert.ok(Math.abs(rows.reduce((sum, row) => sum + row.weight, 0) - 1) < 1e-12);
  const seed = forestSeed(lat, altitude), rnd = mulberry32(seed), counts = {};
  const expected = treeDistribution(lat, altitude, mulberry32(seed)());
  for (let k = 0; k < 10000; k++) {
    const type = pickTreeType(lat, altitude, rnd(), seed);
    assert.ok(TREE_SPECIES[type]);
    counts[type] = (counts[type] || 0) + 1;
  }
  for (const row of expected) assert.ok(Math.abs((counts[row.type] || 0) / 10000 - row.weight) < 0.025);
}
assert.notDeepEqual(treeDistribution(25, 0), treeDistribution(25, 2400));
assert.notDeepEqual(treeDistribution(0, 0), treeDistribution(60, 0));
assert.equal(pickTreeType(0, 9000, 0.5), null);
assert.equal(pickTreeType(NaN, 0, 0.5), null);
assert.equal(pickTreeType(25, 0, NaN), null);
console.log('Forest: 2200 per-tree samples; random dimensions/counts; height-based sections and elasticity; climate probabilities passed.');
