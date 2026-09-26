import assert from 'node:assert/strict';
import { TREE_SPECIES, FOREST_FORMS } from '../public/js/forestSpecies.js';
import { treeDistribution } from '../public/js/forest.js';
import { forestCatalog, sampleForestCatalog } from '../public/js/forestCatalog.js';

assert.deepEqual(forestCatalog(), Object.keys(TREE_SPECIES));
for (const [type, spec] of Object.entries(TREE_SPECIES)) {
  assert.ok(spec.name && FOREST_FORMS[spec.form], type);
  assert.ok(spec.regions.length && spec.climates.length, type);
  for (const region of spec.regions) {
    for (const climate of spec.climates) {
      assert.ok(forestCatalog({ region, climate, form: spec.form }).includes(type), type);
    }
  }
}
assert.deepEqual(forestCatalog({ region: '夏威夷', climate: 'boreal' }), []);
assert.deepEqual(forestCatalog({ region: '非洲', form: 'cactus' }), []);
assert.deepEqual(forestCatalog({ region: '索科特拉島', form: 'dragon' }), ['dragonBlood']);
assert.equal(sampleForestCatalog({ region: 'missing' }, 1, 35, 500, {}), null);
assert.equal(sampleForestCatalog({}, 1, NaN, 500, {}), null);
assert.equal(sampleForestCatalog({ form: 'spire' }, 1, 35, 500, { temperature: -200 }), null);
const tidal = { wet: true, salinity: .5, temperature: 26, moisture: .95 };
const mangroveFilter = { region: '東亞', climate: 'tropical', form: 'open' };
assert.equal(sampleForestCatalog(mangroveFilter, 1, 20, 0, tidal), 'mangroveGrey');
assert.equal(sampleForestCatalog(mangroveFilter, 1, 20, 0, { ...tidal, wet: false }), null);

const filters = { region: '北美洲', climate: 'temperate', form: 'spire' };
const allowed = new Set(forestCatalog(filters));
const env = { temperature: 13, moisture: .6 };
const counts = new Map();
for (let seed = 0; seed < 10000; seed++) {
  const type = sampleForestCatalog(filters, seed, 40, 500, env);
  assert.ok(allowed.has(type));
  assert.equal(type, sampleForestCatalog(filters, seed, 40, 500, env));
  counts.set(type, (counts.get(type) || 0) + 1);
}
const rows = treeDistribution(40, 500, .5, env).filter(row => allowed.has(row.type));
const total = rows.reduce((sum, row) => sum + row.weight, 0);
for (const row of rows) assert.ok(Math.abs((counts.get(row.type) || 0) / 10000 - row.weight / total) < .025);
console.log('PASS: catalog coverage, filter intersections, empty habitats, tidal gates and deterministic weighted sampling.');
