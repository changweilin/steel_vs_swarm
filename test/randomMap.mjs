import assert from 'node:assert/strict';
import { randomMapConfig } from '../public/js/mapgen.js';
import { RANDOM_MAP_RANGES, validRandomMap } from '../public/js/randomMapRules.js';
import { randomMapModel, randomMapSources, randomMapSamplers } from '../public/js/randomMapSources.js';
import { mapSourceKey } from '../public/js/mapLayerSources.js';
import { RoomHub, validateBattleConfig } from '../server/rooms.js';
import { llToXZ, battleRect, laneSubsetFor, lanesFor } from '../public/js/data.js';
import { prepareMapEvidence, loadVenueEvidence } from '../public/js/mapEvidenceLoader.js';
import { projectAreaRecord, catalogAreas } from '../public/js/osmAreas.js';
import { detectCulturalRegion } from '../public/js/buildingDiversity.js';
import { planHabitatCanopy } from '../public/js/habitat.js';
import { forestEnvironment, geographicEnvironment } from '../public/js/seasonalEnvironment.js';
import { geologyEnvironment } from '../public/js/geology.js';
import { readSrc, grabFn } from '../tools/audit_src.mjs';
import { sourceTerrainHarness } from './sourceTerrainHarness.mjs';

const config = randomMapConfig({ seed: 12345, teamSize: 5 });
assert(config && validRandomMap(config));
assert.deepEqual(config.center, { lat: 0, lng: 0, rot: 0 });
assert.deepEqual(config.gen.sources, []);
assert.deepEqual(config, randomMapConfig({ seed: 12345, teamSize: 5, anchors: [{ ll: [25, 121] }] }));
assert.deepEqual(config, randomMapConfig({ seed: 12345, teamSize: 5, anchors: [{ ll: [-45, -120] }] }));
assert.equal(config.procRelief, null);
const regional = config.gen.layers.regional;
assert.equal(regional.geology, geographicEnvironment(regional.latitude, regional.longitude).geology);
assert.equal(forestEnvironment(regional.latitude, 0, config.venue.forest).rainfall, regional.rainfallMm);
assert.equal(geologyEnvironment(config.venue.forest).rainfall, regional.rainfallMm / RANDOM_MAP_RANGES.regional.rainfallMm[1]);
const canopyArgs = { bounds: { minX: 0, maxX: 800, minZ: 0, maxZ: 800 }, seed: 12345, maxPlants: 100000,
  sampleAt: () => ({ key: 'woodland', zone: 'green', canopy: 1, leafType: 'unknown' }) };
const sparse = planHabitatCanopy({ ...canopyArgs, densityScale: .2 }).rows;
const dense = planHabitatCanopy({ ...canopyArgs, densityScale: .85 }).rows;
assert(sparse.length > 0 && dense.length > sparse.length);
const denseSeeds = new Set(dense.map(row => row.seed));
assert(sparse.every(row => denseSeeds.has(row.seed)), 'density changes retain the same coordinate-owned candidates');
assert.deepEqual(planHabitatCanopy(canopyArgs), planHabitatCanopy({ ...canopyArgs, densityScale: 1 }));
assert.throws(() => planHabitatCanopy({ ...canopyArgs, densityScale: NaN }), TypeError);
for (let seed = 0; seed < 128; seed++) {
  const cfg = randomMapConfig({ seed, teamSize: 5 });
  assert(cfg && validRandomMap(cfg));
  assert.equal(validateBattleConfig(cfg, 5), null);
  for (const [layer, limits] of Object.entries(RANDOM_MAP_RANGES)) {
    for (const [key, [min, max]] of Object.entries(limits)) assert(cfg.gen.layers[layer][key] >= min && cfg.gen.layers[layer][key] <= max);
  }
}
for (let teamSize = 1; teamSize <= 5; teamSize++) {
  const cfg = randomMapConfig({ seed: 12345, teamSize });
  assert.deepEqual(cfg.bases, config.bases);
  assert.deepEqual(cfg.gen.layers, config.gen.layers);
  assert.deepEqual(cfg.motherLanes, config.motherLanes);
  assert.deepEqual(cfg.laneIds, laneSubsetFor(lanesFor(teamSize)));
  assert.equal(validateBattleConfig(cfg, teamSize), null);
}
assert.throws(() => randomMapConfig({ seed: 1, ranges: { elevation: { amplitudeM: [0, 1] } } }), RangeError);
assert.throws(() => randomMapConfig({ seed: 1, ranges: { surface: { streetLanes: [2, 2.5] } } }), RangeError);
assert.throws(() => randomMapConfig({ seed: 1, ranges: { regional: { invented: [1, 2] } } }), RangeError);
const fixed = randomMapConfig({ seed: 1, ranges: { elevation: { amplitudeM: [8, 8] }, surface: { buildingLevels: [3, 3] } } });
assert.equal(fixed.gen.layers.elevation.amplitudeM, 8);
assert.equal(fixed.gen.layers.surface.buildingLevels, 3);
const terrainOverride = randomMapConfig({ seed: 12345, ranges: { elevation: { amplitudeM: [8, 8] } } });
assert.deepEqual(terrainOverride.gen.layers.surface, config.gen.layers.surface);
assert.deepEqual(terrainOverride.gen.layers.regional, config.gen.layers.regional);
assert.deepEqual(terrainOverride.motherLanes, config.motherLanes, 'changing relief does not advance other streams or tactical geometry');
for (const edge of [0, 1]) {
  const ranges = Object.fromEntries(Object.entries(RANDOM_MAP_RANGES).map(([layer, entries]) => [layer,
    Object.fromEntries(Object.entries(entries).map(([key, values]) => [key, [values[edge], values[edge]]]))]));
  const cfg = randomMapConfig({ seed: 12345, ranges, teamSize: 5 }), model = randomMapModel(cfg), sample = randomMapSamplers(cfg);
  assert.equal(validateBattleConfig(cfg, 5), null);
  for (const cell of model.cells) {
    assert(Number.isFinite(sample.elevationAt(cell.x, cell.z)));
    assert(sample.sampleColor(cell.x, cell.z).every(value => Number.isFinite(value) && value >= 0 && value <= 255));
  }
  for (const lane of cfg.motherLanes) for (const pt of lane) assert.equal(sample.elevationAt(...llToXZ(...pt, cfg.center)), cfg.gen.layers.elevation.datumM);
}
const bad = structuredClone(config); bad.gen.layers.surface.blockM = Infinity;
assert(!validRandomMap(bad) && validateBattleConfig(bad, 5));
assert(validateBattleConfig({ ...config, gen: { mode: 'random', seed: 1 } }, 5), 'legacy geographic random maps require regeneration');

const [features, roads] = randomMapSources(config);
assert(features.areas.length && roads.length > 3);
config.motherLanes.forEach(lane => assert(roads.some(road => JSON.stringify(road.geometry.map(p => [p.lat, p.lon])) === JSON.stringify(lane)),
  'every tactical lane is part of the generated road network'));
const adjacency = new Map();
const pointKey = p => `${p.lat},${p.lon}`;
for (const road of roads) for (let i = 1; i < road.geometry.length; i++) {
  const a = pointKey(road.geometry[i - 1]), b = pointKey(road.geometry[i]);
  if (!adjacency.has(a)) adjacency.set(a, new Set());
  if (!adjacency.has(b)) adjacency.set(b, new Set());
  adjacency.get(a).add(b); adjacency.get(b).add(a);
}
const pending = [[...adjacency.keys()][0]], seen = new Set(pending);
while (pending.length) for (const key of adjacency.get(pending.pop())) if (!seen.has(key)) { seen.add(key); pending.push(key); }
assert.equal(seen.size, adjacency.size, 'streets and the three tactical roads form one connected graph');
features.areas[0].tags.source = 'mutated'; roads[0].geometry[0].lat += 1;
assert.notEqual(randomMapSources(config)[0].areas[0].tags.source, 'mutated');
assert.deepEqual(randomMapSources(config)[1][0].geometry[0], { lat: config.motherLanes[0][0][0], lon: config.motherLanes[0][0][1] });
assert.deepEqual(randomMapModel(config).bounds, randomMapModel(randomMapConfig({ seed: 12345, teamSize: 1 })).bounds);
assert.equal(detectCulturalRegion({ region: config.gen.layers.regional.culture }), config.gen.layers.regional.culture);
assert.notEqual(mapSourceKey(config), mapSourceKey(randomMapConfig({ seed: 2 })));

const savedFetch = globalThis.fetch;
let queries = 0;
globalThis.fetch = async () => { queries++; throw new Error('External geography is forbidden'); };
try {
  const services = { get: async () => { queries++; throw new Error('Geographic cache access'); },
    elevation: async () => { queries++; throw new Error('Elevation API access'); },
    imagery: async () => { queries++; throw new Error('Imagery API access'); } };
  const terrain = await sourceTerrainHarness({ gridN: 9, ...services })(config, () => {}, { sourceOnly: true });
  assert(terrain.sourceQuality.synthetic && terrain.sourceQuality.elevationComplete && terrain.sourceQuality.imageryComplete);
  const samplers = randomMapSamplers(config), b = battleRect(config);
  for (const [x, z] of [[b.minX, b.minZ], [b.maxX, b.maxZ], [(b.minX + b.maxX) / 2, (b.minZ + b.maxZ) / 2]]) {
    assert(Math.abs(terrain.elevationAt(x, z) - samplers.elevationAt(x, z)) < .001);
    assert.deepEqual(terrain.sampleColor(x, z), samplers.sampleColor(x, z));
  }
  assert.equal(await loadVenueEvidence(config), null);
  const raw = randomMapSources(config)[0];
  const areas = catalogAreas(raw.areas.map(area => projectAreaRecord(area, llToXZ, config.center)).filter(Boolean)).areas;
  const evidence = await prepareMapEvidence(config, terrain, areas);
  assert(evidence.complete, 'generated observations complete without WorldCover or external services');
  assert.equal(queries, 0);
  const gate = new Function('isRandomMap', `${grabFn(readSrc('public', 'js', 'main.js'), 'osmGate')}; return osmGate;`)(cfg => cfg.gen?.mode === 'random');
  await gate(config);
  const { elevSampler } = await import('../tools/venue_field.mjs');
  const nodeSample = await elevSampler(null, config);
  assert(Number.isFinite(nodeSample(0, 0)));
  assert.equal(queries, 0, 'the Node provider and room gate also avoid geographic queries');
} finally { globalThis.fetch = savedFetch; }

const hub = new RoomHub(), host = hub.attach(() => {});
try {
  host.recv({ t: 'createRoom', name: 'Host', teamSize: 5, battleConfig: structuredClone(config) });
  const room = [...hub.rooms.values()][0]; assert(room);
  assert.deepEqual(room.battleConfig.gen.layers, config.gen.layers);
} finally { hub.shutdown(); }
console.log('PASS random maps: geography independence, three bounded seeded layers, range overrides, 128 authority-valid seeds, one mother across team sizes, connected procedural streets, isolated source records, cultural selection, generated terrain/evidence, zero geographic requests and room replay.');
