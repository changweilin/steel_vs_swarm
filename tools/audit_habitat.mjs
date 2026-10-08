// Guards: replay from shared evidence, OSM priority/holes, cover-specific canopy,
// coverage-first infill, envelope spacing, spatial budgets, invalid probes and triangle-exact street draping.
import assert from 'node:assert/strict';
import { habitatAt, createHabitatSampler, habitatPatch, planHabitatCanopy, habitatPlant,
  planHabitatDetails, planHabitatStreets, planHabitatFurniture, drapeHabitatPanel } from '../public/js/habitat.js';
import { buildLandField } from '../public/js/landfield.js';
import { HABITATS, HABITAT_FILL, HABITAT_SCENE } from '../public/js/habitatCatalog.js';
import { readSrc } from './audit_src.mjs';
import { classifyArea, pointInProjectedArea, projectedAreaContainsDisk } from '../public/js/osmAreas.js';
import { planOsmAreaObjects, areaLayoutAngle } from '../public/js/osmAreaLayout.js';
import { osmFeatureQuery, parseOsmFeatureElements, OSM_FEATURE_QUERY_VERSION } from '../public/js/osmQuery.js';
import { TREE_SPECIES, treeDistribution, treeHabitatWeight } from '../public/js/forest.js';

const evidence = code => ({ code, confidence: 2, sources: 3, texture: 100, coherence: 180,
  greenFraction: code === 60 || code === 50 ? .05 : .8, brightness: 125, landform: 1 });
assert.equal(habitatAt(evidence(10), 'green').key, 'woodland');
assert.equal(habitatAt(evidence(20), 'green').key, 'scrub');
assert.equal(habitatAt(evidence(30), 'green').key, 'meadow');
assert.equal(habitatAt(evidence(40), 'green').key, 'cropland');
assert.equal(habitatAt(evidence(10), 'urban').key, 'built');
assert.equal(habitatAt(evidence(10), 'bare').key, 'exposed');
assert.equal(habitatAt(evidence(10), 'water'), null);
assert.equal(habitatAt(evidence(95), 'wet').key, 'marsh');
assert.equal(habitatAt(evidence(90), 'wet', { wetland: 'tidalflat' }).key, 'mudflat');
assert.equal(habitatAt(evidence(90), 'wet', { wetland: 'wet_meadow' }).key, 'wetmeadow');
assert.equal(habitatAt(evidence(80), 'water', {}, .4).key, 'shallows');
assert.equal(habitatAt(evidence(80), 'water', {}, 5), null);
assert.equal(habitatAt(evidence(80), 'water', {}, NaN), null);
assert.equal(habitatAt(evidence(80), 'water', {}, -.2), null);
assert.equal(habitatAt(evidence(60), 'bare', { natural: 'sand' }).key, 'sand');
assert.equal(habitatAt(evidence(60), 'bare', { natural: 'scree' }).key, 'rocky');
assert.equal(habitatAt(evidence(10), 'green', { landuse: 'orchard' }).key, 'orchard');
assert.equal(habitatAt(evidence(10), 'green', { landuse: 'vineyard' }).canopy, 0);
assert.equal(habitatAt(evidence(10), 'green', { landuse: 'allotments' }).key, 'cropland');
assert.equal(habitatAt(evidence(10), 'green', { landuse: 'animal_keeping' }).canopy, 0);
assert.equal(habitatAt(evidence(10), 'green', { 'plant:source': 'wind' }).canopy, 0);
assert.equal(habitatAt(evidence(10), 'green').geology, 'unknown');
assert.equal(habitatAt(evidence(10), 'green', { landuse: 'meadow' }).key, 'meadow');
assert.equal(habitatAt(null, 'green').observed, false);
const humid = { latitude: 25, altitude: 100, climate: 'tropical', moisture: .8, rainfall: 1800 };
const arid = { latitude: 25, altitude: 100, climate: 'arid', moisture: .15, rainfall: 180 };
assert.equal(habitatAt(evidence(10), 'green', {}, null, humid).community, 'forest');
assert.equal(habitatAt(evidence(10), 'green', {}, null, arid).community, 'drywood');
assert.equal(habitatAt(evidence(20), 'green', {}, null, arid).community, 'desert');
assert.equal(habitatAt(evidence(30), 'green', {}, null, arid).community, 'savanna');
assert.equal(habitatAt(evidence(10), 'green', {}, null, { ...humid, altitude: 5500 }).community, 'tundra');
assert.equal(habitatAt(evidence(10), 'green', { natural: 'oasis' }, null, arid).community, 'oasis');
assert.equal(habitatAt(evidence(60), 'bare', {}, null, arid).community, 'desert');
assert.equal(habitatAt(evidence(10), 'green', {}, null, { ...arid, waterAvailability: true, salinity: .5 }).community, 'drywood',
  'Saline water cannot create a freshwater oasis');
assert.equal(habitatAt(evidence(30), 'green', { meadow: 'pasture' }, null, arid).canopy, 0);
assert.equal(habitatAt(evidence(30), 'green', {}, null, { ...humid, season: 'winter' }).community, 'grassland');
assert.equal(classifyArea({ natural: 'oasis' }).surface, 'green');
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
assert.equal(createHabitatSampler({ ...samplerArgs, envCodeAt: () => 2 })(20, 20).key, 'marsh');
assert.equal(createHabitatSampler({ ...samplerArgs, envCodeAt: () => 1, depthAt: () => .4 })(20, 20).key, 'shallows');
assert.equal(createHabitatSampler({ ...samplerArgs, envCodeAt: () => NaN })(20, 20), null);
assert(sampler.contains({ x: 20, z: 20, r: 1 }));
assert(sampler.contains({ x: 0, z: 0, r: 1 }), 'A hole retains its underlying habitat');
assert(!sampler.contains({ x: 9.5, z: 0, r: 1 }), 'Infill cannot cross a hole boundary');
assert(!sampler.contains({ x: 39.5, z: 20, r: 1 }), 'Infill cannot cross a semantic boundary');
const tinyMask = createHabitatSampler({ ...samplerArgs, areas: [area('sliver', 'green', 9,
  square(1, -.05, 1.1, .05)), area('base', 'urban', 1, square(-10, -10, 10, 10))] });
assert(!tinyMask.contains({ x: 0, z: 0, r: 1.2 }), 'Disk tests catch slivers missed by corners');
assert(!sampler.contains({ x: NaN, z: 0, r: 1 }));

for (const [tags, generator] of [
  [{ landuse: 'aquaculture' }, 'aquaculture'], [{ landuse: 'animal_keeping' }, 'livestock'],
  [{ landuse: 'meadow', meadow: 'pasture' }, 'livestock'], [{ landuse: 'meadow' }, null],
  [{ landuse: 'greenhouse_horticulture' }, 'greenhouse'], [{ landuse: 'basin', basin: 'detention' }, 'flood'],
  [{ landuse: 'industrial', industrial: 'mine' }, 'quarry'], [{ landuse: 'industrial', craft: 'sawmill' }, 'forest'],
  [{ power: 'plant', 'plant:source': 'solar' }, 'solar'], [{ power: 'generator', 'generator:source': 'wind' }, 'wind'],
  [{ power: 'substation' }, 'power'], [{ man_made: 'water_works' }, 'power'],
  [{ power: 'tower' }, 'pylon'], [{ natural: 'wood' }, null], [{ landuse: 'forest' }, null],
]) assert.equal(classifyArea(tags).generator, generator, JSON.stringify(tags));
assert.equal(classifyArea({ landuse: 'unknown' }).mode, 'unmapped');
assert.equal(classifyArea({ natural: 'grassland' }).kind, 'grassland');
assert.equal(classifyArea({ natural: 'scrub' }).kind, 'scrub');
assert.equal(classifyArea({ building: 'warehouse', power: 'plant', 'plant:source': 'solar' }).generator, 'polygonBuilding');

const tinyHole = { outer: square(-10, -10, 10, 10), holes: [square(.8, .1, 1, .3)] };
assert.equal(pointInProjectedArea(0, 0, tinyHole), true);
assert.equal(projectedAreaContainsDisk(0, 0, 2, tinyHole), false, 'A small off-centre hole cannot hide between probes');
assert.equal(projectedAreaContainsDisk(0, 0, 2, {}), false);
const taggedArea = (id, tags, outer = square(-100, -100, 100, 100), holes = []) => ({
  sourceId: id, tags, classification: classifyArea(tags), worldPolygons: [{ outer, holes }], areaM2: 40000,
});
const solarArea = taggedArea('solar', { power: 'plant', 'plant:source': 'solar' }, undefined, [square(-12, -12, 12, 12)]);
const areaArgs = { terrain: { minX: -110, maxX: 110, minZ: -110, maxZ: 110, waterY: 4 },
  heightAt: () => 4, envCodeAt: () => 0, maxObjects: 480, seed: 17 };
const solarPlan = planOsmAreaObjects([solarArea], areaArgs);
assert(solarPlan.placed.length > 8 && solarPlan.placed.every(p => p.shape === 'solar' && p.ry === 0));
assert(solarPlan.placed.every(p => projectedAreaContainsDisk(p.x, p.z, p.radius, solarArea.worldPolygons[0])));
assert.deepEqual(solarPlan, planOsmAreaObjects([solarArea], areaArgs));
assert.equal(planOsmAreaObjects([solarArea], { ...areaArgs, heightAt: () => NaN }).placed.length, 0);
assert.equal(planOsmAreaObjects([solarArea], { ...areaArgs, heightAt: x => x }).placed.length, 0);
assert.equal(planOsmAreaObjects([solarArea], { ...areaArgs, envCodeAt: () => 1 }).placed.length, 0);
assert.equal(planOsmAreaObjects([solarArea], { ...areaArgs, maxObjects: 0 }).placed.length, 0);
const buildingArea = taggedArea('building', { building: 'warehouse' }, square(-30, -30, 30, 30));
const mixedAreas = [solarArea, buildingArea];
const mixedPlan = planOsmAreaObjects(mixedAreas, areaArgs);
assert.deepEqual(mixedPlan, planOsmAreaObjects(mixedAreas.toReversed(), areaArgs));
assert(mixedPlan.placed.every(p => Math.abs(p.x) > 30 + p.radius || Math.abs(p.z) > 30 + p.radius));
const fishArea = taggedArea('fish', { landuse: 'aquaculture' });
assert.equal(planOsmAreaObjects([fishArea], areaArgs).placed.length, 0, 'OSM alone cannot manufacture settled water');
const fishPlan = planOsmAreaObjects([fishArea], { ...areaArgs, envCodeAt: () => 1, heightAt: () => 2 });
assert(fishPlan.placed.length > 0 && fishPlan.placed.every(p => p.y === 4 && p.shape === 'fishcage'));
assert.equal(planOsmAreaObjects([fishArea], { ...areaArgs, terrain: { ...areaArgs.terrain, waterY: null },
  envCodeAt: () => 1 }).placed.length, 0);
const pointWind = { x: 45, z: 45, tags: { power: 'generator', 'generator:source': 'wind' } };
const windPlan = planOsmAreaObjects([], { ...areaArgs, utilityPoints: [pointWind] });
assert.equal(windPlan.placed.length, 1);
assert.equal(windPlan.placed[0].x, 45);
assert.equal(windPlan.placed[0].shape, 'windturbine');
assert.equal(planOsmAreaObjects([taggedArea('farm', { power: 'plant', 'plant:source': 'wind' })],
  { ...areaArgs, utilityPoints: [pointWind] }).placed.length, 1, 'Point turbines replace synthetic wind-farm scatter');
assert.equal(planOsmAreaObjects([buildingArea], { ...areaArgs, utilityPoints: [{ ...pointWind, x: 0, z: 0 }] }).placed.length, 0);
assert.equal(areaLayoutAngle(solarArea), areaLayoutAngle({ worldPolygons: solarArea.worldPolygons.map(p => ({ ...p, outer: p.outer.toReversed() })) }));
assert.equal(OSM_FEATURE_QUERY_VERSION, 12);
assert(osmFeatureQuery({ minLat: 24, maxLat: 25, minLng: 120, maxLng: 121 }).includes('["generator:source"="wind"]'));
assert.equal(parseOsmFeatureElements([{ type: 'node', lat: 24.5, lon: 120.5, tags: pointWind.tags }]).pois.length, 1);
const needleTrees = treeDistribution(45, 500, .5, { leafType: 'needleleaved' });
assert(needleTrees.length && needleTrees.every(row => TREE_SPECIES[row.type].form === 'spire'));
assert.equal(treeHabitatWeight('holmOak', 45, 500, { leafType: 'needleleaved' }), 0);

const bounds = { minX: -400, maxX: 400, minZ: -300, maxZ: 300 };
const woodland = habitatAt(evidence(10), 'green'), meadow = habitatAt(evidence(30), 'green');
const canopyArgs = { bounds, seed: 91, maxPlants: 10000, sampleAt: () => woodland };
const ecoPlan = input => planHabitatCanopy({ ...canopyArgs,
  sampleAt: () => habitatAt(evidence(10), 'green', {}, null, input) }).rows;
const humidPlants = ecoPlan(humid), dryPlants = ecoPlan(arid);
assert(humidPlants.length > dryPlants.length * 1.5, 'Water availability increases woody stocking');
assert(humidPlants.length / ((bounds.maxX - bounds.minX) * (bounds.maxZ - bounds.minZ)) > .015,
  'Uncapped woodland sustains dense stands rather than isolated trees');
assert.deepEqual(new Set(humidPlants.map(row => row.age)), new Set(['juvenile', 'mature', 'old']));
const ageMean = age => { const rows = humidPlants.filter(row => row.age === age); return rows.reduce((s, r) => s + r.height, 0) / rows.length; };
assert(ageMean('juvenile') < ageMean('mature') * .6 && ageMean('old') > ageMean('mature'));
const patchRows = new Map();
for (const row of humidPlants) {
  const rolls = patchRows.get(row.patchSeed) || []; rolls.push(row.speciesRoll); patchRows.set(row.patchSeed, rolls);
  const plant = habitatPlant(row);
  if (!plant) continue;
  assert.deepEqual(plant, habitatPlant(row));
  assert(!['shrub', 'herb', 'rosette', 'cactus', 'fallen', 'snag'].includes(TREE_SPECIES[plant.type].form));
  assert(Math.abs(plant.tree.h * plant.s - Math.min(row.height, TREE_SPECIES[plant.type].h)) < 1e-8);
  assert(plant.tree.stems.every(stem => (Math.hypot(stem.x, stem.z) + stem.r) * plant.s <= plant.tree.footprint * plant.s + 1e-9));
}
assert([...patchRows.values()].some(rolls => rolls.length > 30 && new Set(rolls).size < rolls.length * .5),
  'Local dominant taxa are shared within a stand rather than resampled independently');
assert.equal(habitatPlant({ ...humidPlants[0], height: NaN }), null);
assert.equal(habitatPlant({ ...humidPlants[0], environment: { ...humid, altitude: 9000 } }), null);
for (const forms of ['shrub', 'xeric', 'tree', 'oasis']) {
  const rows = treeDistribution(25, 100, .5, { ...arid, plantForms: forms, moisture: forms === 'oasis' ? .9 : .2 });
  assert(rows.length);
  if (forms === 'shrub') assert(rows.every(row => TREE_SPECIES[row.type].form === 'shrub'));
  if (forms === 'xeric') assert(rows.every(row => ['shrub', 'rosette', 'cactus', 'dragon', 'ribbon'].includes(TREE_SPECIES[row.type].form)));
}
const oasisSpecies = treeDistribution(25, 100, .5, { ...arid, moisture: .9, plantForms: 'oasis', waterAvailability: true });
assert(oasisSpecies.some(row => TREE_SPECIES[row.type].form === 'palm'), 'Root-zone water supports oasis palms despite low regional rainfall');
const riparian = createHabitatSampler({ evidenceAt: () => evidence(10), zoneAt: () => 'green',
  envCodeAt: x => x >= 15 && x <= 17 ? 1 : 0, environmentAt: () => arid });
assert.equal(riparian(0, 0).community, 'oasis', 'Nearby settled water supports a dry-climate oasis');
assert.equal(riparian(150, 0).community, 'drywood', 'Dry woodland away from water never invents an oasis');
assert.equal(riparian(16, 0), null, 'A dry-land oasis cannot occupy settled water');
const nativeRandom = Math.random;
Math.random = () => { throw new Error('Habitat consumed nondeterministic randomness'); };
try {
  const canopy = planHabitatCanopy(canopyArgs);
  assert.deepEqual(canopy, planHabitatCanopy(canopyArgs));
  const open = planHabitatCanopy({ ...canopyArgs, sampleAt: () => meadow });
  assert(canopy.rows.length > open.rows.length * 10, 'Grassland must remain open compared with woodland');
  assert.equal(planHabitatCanopy({ ...canopyArgs, sampleAt: () => habitatAt(evidence(40), 'green') }).rows.length, 0);
  const orchard = habitatAt(evidence(10), 'green', { landuse: 'orchard' });
  const orchardPlan = planHabitatCanopy({ ...canopyArgs, sampleAt: () => orchard });
  assert(orchardPlan.rows.length > 20 && orchardPlan.rows.every(p => Math.abs(p.x / HABITAT_SCENE.CANOPY_CELL_M - Math.round(p.x / HABITAT_SCENE.CANOPY_CELL_M)) < 1e-8));
  assert.equal(new Set(orchardPlan.rows.map(p => `${p.x},${p.z}`)).size, orchardPlan.rows.length);
  const detailArgs = { bounds, seed: 123, maxDetails: 8000, sampleAt: () => meadow,
    heightAt: (x, z) => x * .02 + z * .01, fits: f => Math.abs(f.x) > 25 };
  const detail = planHabitatDetails(detailArgs), low = planHabitatDetails({ ...detailArgs, maxDetails: 400 });
  assert.deepEqual(detail, planHabitatDetails(detailArgs));
  assert.deepEqual(low.rows, detail.rows.slice(0, 400));
  assert(low.rows.some(r => r.x < -200) && low.rows.some(r => r.x > 200), 'Budget must cover both ends');
  assert(detail.rows.every(r => Math.abs(r.x) > 25 && Number.isFinite(r.y)));
  assert(detail.rows.filter(r => r.coverSize).every(r => Math.abs(r.groundX - .02) < 1e-9 && Math.abs(r.groundZ - .01) < 1e-9),
    'Surface patches follow the fitted terrain plane without tilting blade height');
  assert.equal(planHabitatDetails({ ...detailArgs, heightAt: () => NaN }).rows.length, 0);
  assert.equal(planHabitatDetails({ ...detailArgs, fits: () => false }).rows.length, 0);
  assert.notDeepEqual(detail.rows, planHabitatDetails({ ...detailArgs, seed: 124 }).rows);
  assert.throws(() => planHabitatDetails({ ...detailArgs, bounds: {} }), TypeError);
  assert(Math.abs(habitatPatch(123, 10, 10) - habitatPatch(123, 10.1, 10.1)) < .03);
} finally { Math.random = nativeRandom; }

const fillBounds = { minX: 0, maxX: 120, minZ: 0, maxZ: 96 };
for (const [key, [minimum, maximum]] of Object.entries(HABITAT_FILL)) {
  const habitat = { ...HABITATS[key], key, texture: .4, ry: .7 };
  const args = { bounds: fillBounds, seed: 73, sampleAt: () => habitat, heightAt: () => 4, fits: () => true };
  const plan = planHabitatDetails(args), cells = new Map();
  for (const row of plan.rows) {
    const cellKey = `${Math.floor(row.x / plan.cell)},${Math.floor(row.z / plan.cell)}`;
    cells.set(cellKey, (cells.get(cellKey) || 0) + 1);
    assert([habitat.plant, 'stone', ...(key === 'built' ? ['planter'] : [])].includes(row.kind), 'Infill matches the habitat');
    assert(row.x - row.r >= 0 && row.z - row.r >= 0 && row.x + row.r <= 120 && row.z + row.r <= 96);
  }
  assert.equal(cells.size, 320, `${key}: every free cell receives detail`);
  assert([...cells.values()].every(n => n >= minimum && n <= maximum), `${key}: density stays within the profile`);
  for (let i = 0; i < plan.rows.length; i++) for (let j = i + 1; j < plan.rows.length; j++) {
    const a = plan.rows[i], b = plan.rows[j];
    assert(Math.hypot(a.x - b.x, a.z - b.z) + 1e-9 >= a.r + b.r + HABITAT_SCENE.DETAIL_GAP_M, 'Infill envelopes stay separated');
  }
  const coverage = planHabitatDetails({ ...args, maxDetails: cells.size });
  assert(coverage.rows.every(row => row.round === 0), 'Coverage consumes the budget before densification');
  assert.equal(new Set(coverage.rows.map(row => `${Math.floor(row.x / plan.cell)},${Math.floor(row.z / plan.cell)}`)).size, cells.size);
  const crowded = planHabitatDetails({ ...args, fits: foot => foot.x - foot.r >= 60 });
  assert(crowded.rows.length < plan.rows.length && crowded.rows.every(row => row.x - row.r >= 60));
}
const retryArgs = { bounds: fillBounds, seed: 73, sampleAt: () => meadow, heightAt: () => 4 };
const curved = planHabitatDetails({ ...retryArgs, fits: () => true, heightAt: (x, z) => x * x + z * z });
assert(curved.rows.every(row => !row.coverSize), 'Non-planar ground omits broad patches instead of floating their roots');
const firstAttempts = planHabitatDetails({ ...retryArgs, fits: () => true }).rows;
const retried = planHabitatDetails({ ...retryArgs, fits: foot => !firstAttempts.some(row => row.x === foot.x && row.z === foot.z) });
assert.equal(retried.rows.filter(row => row.round === 0).length, 320, 'Rejected positions retry within their free cell');
assert.equal(planHabitatDetails({ ...retryArgs, sampleAt: () => null, fits: () => true }).rows.length, 0);
assert.equal(planHabitatDetails({ ...retryArgs, sampleAt: () => ({ ...HABITATS.cliff, key: 'cliff' }), fits: () => true }).rows.length, 0);
const largeArgs = { ...retryArgs, bounds: { minX: -1200, maxX: 1200, minZ: -900, maxZ: 900 }, fits: () => true };
const largeFill = planHabitatDetails(largeArgs), unlimitedFill = planHabitatDetails({ ...largeArgs, maxDetails: 40000 });
assert(largeFill.cell > HABITAT_SCENE.CELL_M, 'Large maps adapt the coverage lattice to the fixed presentation budget');
assert.deepEqual(largeFill.rows.filter(row => row.round === 0), unlimitedFill.rows.filter(row => row.round === 0),
  'Normal-budget infill covers every available large-map cell before densification');
assert.deepEqual(planHabitatDetails({ ...largeArgs, maxDetails: HABITAT_SCENE.LOW_DETAIL_LIMIT }).rows,
  largeFill.rows.slice(0, HABITAT_SCENE.LOW_DETAIL_LIMIT));

const streetArgs = { segments: [{ a: [-40, 0], b: [40, 0], hw: 5 }], sampleAt: () => habitatAt(evidence(50), 'urban'),
  heightAt: () => 4, fits: f => Math.abs(f.x) > 6, maxPanels: 100 };
const street = planHabitatStreets(streetArgs);
assert(street.length > 20 && street.every(p => p.corners.every(v => Math.abs(v[0]) > 6)));
assert.equal(planHabitatStreets({ ...streetArgs, sampleAt: () => meadow }).length, 0);
assert.equal(planHabitatStreets({ ...streetArgs, heightAt: () => NaN }).length, 0);
assert.equal(planHabitatStreets({ ...streetArgs, heightAt: (x, z) => x + z }).length, 0);
assert.deepEqual(street, planHabitatStreets(streetArgs));
const furnitureArgs = { panels: street, seed: 42, fits: () => true, heightAt: () => 4, sampleAt: streetArgs.sampleAt };
const furniture = planHabitatFurniture(furnitureArgs);
assert(furniture.length > 0);
assert(furniture.every(row => row.kind !== 'streetlamp'), 'Unmapped lighting must stay unknown');
assert.deepEqual(furniture, planHabitatFurniture({ ...furnitureArgs, panels: street.toReversed() }));
assert.deepEqual(planHabitatFurniture({ ...furnitureArgs, maxObjects: 2 }), furniture.slice(0, 2));
assert.equal(planHabitatFurniture({ ...furnitureArgs, heightAt: () => NaN }).length, 0);
assert.equal(planHabitatFurniture({ ...furnitureArgs, fits: () => false }).length, 0);

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
console.log('PASS habitat: exact masks, free-cell coverage, density caps, envelope gaps, retries, deterministic budgets and shipped deployment');
