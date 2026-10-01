// Guards: replay from shared evidence, OSM priority/holes, cover-specific canopy,
// spatially distributed budgets, omission on invalid probes and triangle-exact street draping.
import assert from 'node:assert/strict';
import { habitatAt, createHabitatSampler, habitatPatch, planHabitatCanopy,
  planHabitatDetails, planHabitatStreets, drapeHabitatPanel } from '../public/js/habitat.js';
import { buildLandField } from '../public/js/landfield.js';
import { HABITAT_SCENE } from '../public/js/habitatCatalog.js';
import { readSrc } from './audit_src.mjs';

const evidence = code => ({ code, confidence: 2, sources: 3, texture: 100, coherence: 180,
  greenFraction: code === 60 || code === 50 ? .05 : .8, brightness: 125, landform: 1 });
assert.equal(habitatAt(evidence(10), 'green').key, 'woodland');
assert.equal(habitatAt(evidence(20), 'green').key, 'scrub');
assert.equal(habitatAt(evidence(30), 'green').key, 'meadow');
assert.equal(habitatAt(evidence(40), 'green').key, 'cropland');
assert.equal(habitatAt(evidence(10), 'urban').key, 'built');
assert.equal(habitatAt(evidence(10), 'bare').key, 'exposed');
assert.equal(habitatAt(evidence(10), 'water'), null);
assert.equal(habitatAt(evidence(95), 'wet'), null);
assert.equal(habitatAt(evidence(10), 'green', { landuse: 'meadow' }).key, 'meadow');
assert.equal(habitatAt(null, 'green').observed, false);
assert.deepEqual(habitatAt({ code: 50, confidence: 1, sources: 1 }, 'urban').color,
  habitatAt(null, 'urban').color, 'Absent RGB must not darken a dated prior');

const square = (x0, z0, x1, z1) => [[x0, z0], [x1, z0], [x1, z1], [x0, z1]];
const area = (id, zone, priority, outer, holes = [], tags = {}) => ({ sourceId: id, tags,
  classification: { surface: zone, priority }, worldPolygons: [{ outer, holes }] });
const areas = [area('district', 'urban', 1, square(-80, -80, 80, 80)),
  area('park', 'green', 9, square(-40, -40, 40, 40), [square(-10, -10, 10, 10)], { landuse: 'meadow' })];
const samplerArgs = { areas, evidenceAt: () => evidence(50), zoneAt: (_x, _z, a) => a?.zone || 'bare', envCodeAt: () => 0 };
const sampler = createHabitatSampler(samplerArgs);
assert.equal(sampler(20, 20).key, 'meadow');
assert.equal(sampler(0, 0).key, 'built', 'Park hole exposes its actual underlying district');
assert.equal(sampler(100, 100).key, 'exposed');
assert.deepEqual(createHabitatSampler({ ...samplerArgs, areas: areas.toReversed() })(20, 20), sampler(20, 20));
assert.equal(createHabitatSampler({ ...samplerArgs, envCodeAt: () => 1 })(20, 20), null);
assert.equal(sampler(NaN, 0), null);

const bounds = { minX: -400, maxX: 400, minZ: -300, maxZ: 300 };
const woodland = habitatAt(evidence(10), 'green'), meadow = habitatAt(evidence(30), 'green');
const canopyArgs = { bounds, seed: 91, maxPlants: 10000, sampleAt: () => woodland };
const nativeRandom = Math.random;
Math.random = () => { throw new Error('Habitat consumed nondeterministic randomness'); };
try {
  const canopy = planHabitatCanopy(canopyArgs);
  assert.deepEqual(canopy, planHabitatCanopy(canopyArgs));
  const open = planHabitatCanopy({ ...canopyArgs, sampleAt: () => meadow });
  assert(canopy.rows.length > open.rows.length * 10, 'Grassland must remain open compared with woodland');
  assert.equal(planHabitatCanopy({ ...canopyArgs, sampleAt: () => habitatAt(evidence(40), 'green') }).rows.length, 0);
  const detailArgs = { bounds, seed: 123, maxDetails: 8000, sampleAt: () => meadow,
    heightAt: (x, z) => x * .02 + z * .01, fits: f => Math.abs(f.x) > 25 };
  const detail = planHabitatDetails(detailArgs), low = planHabitatDetails({ ...detailArgs, maxDetails: 400 });
  assert.deepEqual(detail, planHabitatDetails(detailArgs));
  assert.deepEqual(low.rows, detail.rows.slice(0, 400));
  assert(low.rows.some(r => r.x < -200) && low.rows.some(r => r.x > 200), 'Budget must cover both ends');
  assert(detail.rows.every(r => Math.abs(r.x) > 25 && Number.isFinite(r.y)));
  assert.equal(planHabitatDetails({ ...detailArgs, heightAt: () => NaN }).rows.length, 0);
  assert.equal(planHabitatDetails({ ...detailArgs, fits: () => false }).rows.length, 0);
  assert.notDeepEqual(detail.rows, planHabitatDetails({ ...detailArgs, seed: 124 }).rows);
  assert.throws(() => planHabitatDetails({ ...detailArgs, bounds: {} }), TypeError);
  assert(Math.abs(habitatPatch(123, 10, 10) - habitatPatch(123, 10.1, 10.1)) < .03);
} finally { Math.random = nativeRandom; }

const streetArgs = { segments: [{ a: [-40, 0], b: [40, 0], hw: 5 }], sampleAt: () => habitatAt(evidence(50), 'urban'),
  heightAt: () => 4, fits: f => Math.abs(f.x) > 6, maxPanels: 100 };
const street = planHabitatStreets(streetArgs);
assert(street.length > 20 && street.every(p => p.corners.every(v => Math.abs(v[0]) > 6)));
assert.equal(planHabitatStreets({ ...streetArgs, sampleAt: () => meadow }).length, 0);
assert.equal(planHabitatStreets({ ...streetArgs, heightAt: () => NaN }).length, 0);
assert.equal(planHabitatStreets({ ...streetArgs, heightAt: (x, z) => x + z }).length, 0);
assert.deepEqual(street, planHabitatStreets(streetArgs));

// A saddle exposes the chord error even when all four panel corners are valid terrain samples.
const saddle = { minX: 0, minZ: 0, worldW: 8, worldH: 4, gridM: 8,
  heightAt: (x, z) => x / 8 + z / 4 <= 1 ? 0 : 2 * (x / 8 + z / 4 - 1) };
const panel = { corners: [[1, 0, .5], [1, 0, 3.5], [7, 0, 3.5], [7, 0, .5]] };
const draped = drapeHabitatPanel(panel, saddle);
assert(draped.length >= 18);
let areaSum = 0;
for (let i = 0; i < draped.length; i += 9) {
  const a = draped.slice(i, i + 3), b = draped.slice(i + 3, i + 6), c = draped.slice(i + 6, i + 9);
  const x = (a[0] + b[0] + c[0]) / 3, z = (a[2] + b[2] + c[2]) / 3;
  assert(Math.abs((a[1] + b[1] + c[1]) / 3 - saddle.heightAt(x, z) - HABITAT_SCENE.STREET_LIFT_M) < 1e-8);
  const twiceArea = (b[0] - a[0]) * (c[2] - a[2]) - (b[2] - a[2]) * (c[0] - a[0]);
  assert(twiceArea < 0, 'Street triangles face upward');
  areaSum += -twiceArea / 2;
}
assert(Math.abs(areaSum - 18) < 1e-8, 'Draping covers the panel exactly once');

globalThis.requestAnimationFrame = f => setImmediate(f);
const terrain = { minX: -100, maxX: 100, minZ: -100, maxZ: 100, worldW: 200, worldH: 200, gridM: 5,
  heightAt: () => 4, evidenceAt: () => evidence(50) };
const fieldArgs = { terrain, areas, center: { lat: 0, lng: 0 }, classifyPureAt: () => 'urban',
  envCodeAt: x => x < -90 ? 1 : 0, projectAt: () => [0, 0], seed: 91 };
const field = await buildLandField(fieldArgs);
assert.equal(field.sample(20, 20), 'green');
assert.equal(field.sample(0, 0), 'urban');
assert.equal(field.sample(-95, 0), 'water');
assert.equal(field.appearance.length, field.data.length);
const replay = await buildLandField({ ...fieldArgs, areas: areas.toReversed() });
assert.deepEqual(field.data, replay.data);
assert.deepEqual(field.appearance, replay.appearance);
const bio = readSrc('public', 'js', 'biomes.js');
assert(!bio.includes('buildGroundCover('), 'Legacy random patch deployment must stay retired');
assert(bio.includes('planHabitatCanopy(') && bio.includes('buildHabitatScene('));
console.log('PASS habitat: cover structure, exact OSM masks, deterministic budgets, invalid probes, slope draping and shipped deployment');
