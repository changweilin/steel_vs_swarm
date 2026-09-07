import assert from 'node:assert/strict';
import { TREE_SPECIES, TREE_VARIANTS, createForestDefs, createForestTree, treeBend, treeSections, treeDistribution, pickTreeType, forestSeed, forestEnvironment, treeHabitatWeight } from '../public/js/forest.js';
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
    assert.ok(parts.length <= 400, 'bounded components even for multi-culm bamboo and palm pinnae');
    for (const part of parts) {
      const p = part.g.parameters;
      if (p.height) {
        const dir = quatApply(quatFromEuler(part.rx || 0, part.ry || 0, part.rz || 0), [0, 1, 0]);
        const endpoints = [-1, 1].map(sign => [part.px || 0, part.y, part.pz || 0]
          .map((v, i) => v + sign * dir[i] * p.height / 2));
        assert.ok(endpoints.every(point => point.every(Number.isFinite)));
        assert.ok(endpoints.every(point => point[1] >= -1e-6 && point[1] <= def.h));
      } else {
        if (part.role === 'leaf') assert.equal(part.key, 'gleaf', 'foliage keeps the shared wind/season channel');
        assert.ok(part.y + p.radius * part.sy <= def.h);
      }
    }
  }
}
for (const type of Object.keys(TREE_SPECIES)) {
  const samples = Array.from({ length: 200 }, (_, seed) => createForestTree(type, seed));
  const spec = TREE_SPECIES[type], growth = spec.growth;
  for (const key of ['h', 'r', 'branchCount', 'density']) {
    assert.ok(new Set(samples.map(tree => tree[key])).size > 2, `${type}: independent ${key} variation`);
  }
  assert.ok(new Set(samples.map(tree => tree.parts.filter(p => p.key).length)).size > 2);
  for (const [seed, tree] of samples.entries()) {
    assert.deepEqual(tree, createForestTree(type, seed));
    assert.equal(tree.girth, 2 * Math.PI * tree.r);
    const taller = createForestTree(type, seed, undefined, undefined, 2);
    assert.ok(taller.sections >= tree.sections, 'final world height never removes trunk rings');
    if (tree.h > 7) assert.ok(taller.sections > tree.sections);
    assert.equal(taller.branchCount, tree.branchCount, 'subdivision must not consume randomness');
    assert.ok(tree.h >= spec.h * growth.height[0] && tree.h <= spec.h * growth.height[1]);
    assert.ok(tree.r >= spec.r * growth.radius[0] && tree.r <= spec.r * growth.radius[1]);
    assert.ok(tree.branchCount >= growth.branches[0] && tree.branchCount <= growth.branches[1]);
    const primary = tree.stems.filter(s => !s.root);
    assert.ok(primary.length >= growth.stemCount[0] && primary.length <= growth.stemCount[1]);
    assert.ok(tree.stems.every(s => Math.hypot(s.x, s.z) + s.r <= tree.footprint + 1e-9), 'all culms/support roots fit ground envelope');
    const skeleton = t => t.parts.filter(p => !['flower', 'fruit'].includes(p.role));
    const spring = createForestTree(type, seed, undefined, undefined, 1, 'spring');
    assert.deepEqual(skeleton(tree), skeleton(spring), 'season never changes skeleton or collision geometry');
    for (const kind of ['flower', 'fruit']) {
      const trait = spec[kind];
      const organs = spring.parts.filter(p => p.role === kind);
      if (!trait?.seasons.includes('spring')) assert.equal(organs.length, 0);
      if (organs.length) {
        const lobes = kind === 'flower' && trait.form !== 'catkin' ? 5 : 1;
        assert.ok(organs.length / lobes >= trait.count[0] && organs.length / lobes <= trait.count[1]);
        for (const p of organs) {
          const size = p.g.parameters.radius / (lobes > 1 ? .65 : 1);
          assert.ok(size >= trait.size[0] - 1e-9 && size <= trait.size[1] + 1e-9);
        }
      }
    }
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
const acid = { temperature: 15, moisture: .7, geology: 'granite' };
assert.ok(treeHabitatWeight('rhododendron', 35, 1200, acid) > 0);
assert.equal(treeHabitatWeight('rhododendron', 35, 1200, { ...acid, geology: 'limestone' }), 0);
assert.equal(forestEnvironment(35, 1200, { ...acid, ph: 7 }).ph, 7, 'explicit soil pH overrides geology proxy');
assert.equal(forestEnvironment(35, 1200).ph, undefined, 'missing soil data is neutral');
assert.equal(forestEnvironment(35, 1200).rainfall, undefined);
const tidal = { wet: true, salinity: .5, temperature: 26, moisture: .95 };
assert.ok(treeHabitatWeight('mangroveGrey', 20, 0, tidal) > 0);
assert.equal(treeHabitatWeight('mangroveGrey', 20, 0, { ...tidal, wet: false }), 0);
assert.equal(treeHabitatWeight('mangroveGrey', 20, 0, { ...tidal, salinity: 0 }), 0);
assert.equal(treeHabitatWeight('mangroveGrey', 20, 0, { ...tidal, slope: 20 }), 0);
assert.ok(treeHabitatWeight('scrubOak', 35, 500, { climate: 'arid' }) > treeHabitatWeight('scrubOak', 35, 500, { climate: 'tropical' }));
assert.equal(treeHabitatWeight('forestBamboo', 20, 500, { rainfall: 0 }), 0);
for (const season of ['spring', 'summer', 'autumn', 'winter']) {
  assert.ok(!createForestTree('forestBamboo', 17, undefined, undefined, 1, season).parts.some(p => p.role === 'flower' || p.role === 'fruit'));
}
assert.ok(createForestTree('banyan', 3).stems.some(s => s.root));
assert.ok(createForestTree('mangroveGrey', 3).parts.filter(p => p.role === 'root').length >= 10);
console.log(`Forest: ${Object.keys(TREE_SPECIES).length * 200} deterministic specimens; species dimensions, roots, seasonal organs, wind and habitat probabilities passed.`);
