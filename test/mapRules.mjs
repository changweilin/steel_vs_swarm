import assert from 'node:assert/strict';
import { VENUES, venueConfig, venueAvailability, migrateFavCfg } from '../public/js/venues.js';
import { MAPGEO, llToXZ } from '../public/js/data.js';
import { mapGeometryAudit, mapGeometryMetrics, naturalRoadBiome } from '../public/js/mapRules.js';
import { validMapSources } from '../public/js/mapSourceValidation.js';
import { traceRoadEvidence, roadFingerprint, laneFingerprint, validRoadEvidence, validTerrainAssessment, makeTerrainAssessment, roadSourceSummary } from '../public/js/roadEvidence.js';
import { validateBattleConfig, RoomHub } from '../server/rooms.js';
import { randomMapConfig } from '../public/js/mapgen.js';
import { VENUE_ROAD_EVIDENCE } from '../public/js/venueRoadEvidence.js';

const cfg = venueConfig(VENUES.find(v => v.id === 'berlin'), 5);
assert(mapGeometryAudit(cfg, 5).ok && validMapSources(cfg));
assert.equal(validateBattleConfig(cfg, 5), null);
assert.equal(VENUES.filter(v => !v.story && venueAvailability(v).available).length, 16);
for (const id of ['berlin', 'madrid', 'seoul', 'neworleans', 'rotterdam', 'roppongi', 'kyoto', 'taipei101', 'shibuya']) {
  const v = VENUES.find(v => v.id === id);
  assert(venueAvailability(v).available);
  assert.equal(roadSourceSummary(venueConfig(v, 5)).real, 3);
  for (const n of [1, 2, 3, 4, 5]) assert.equal(validateBattleConfig(venueConfig(v, n), n), null, id);
}
for (const id of ['taroko', 'todra']) assert(!venueAvailability(VENUES.find(v => v.id === id)).available);
assert.equal(naturalRoadBiome({ green: .4, wet: .4, urban: .2 }), 'green');
assert.equal(naturalRoadBiome({ bare: .75, urban: .25 }), 'bare');
assert.equal(naturalRoadBiome({ green: .3, bare: .3, urban: .4 }), null);
for (const id of ['matamata', 'interlaken', 'mekong', 'bergen', 'phoenix', 'cappadocia', 'uluru', 'dubai', 'walvisbay']) {
  const v = VENUES.find(v => v.id === id), mother = venueConfig(v, 5);
  for (const n of [1, 2, 3, 4, 5]) {
    const c = venueConfig(v, n);
    assert.equal(validateBattleConfig(c, n), null, id);
    assert.equal(c.roadMode, 'natural-hybrid');
    assert.deepEqual(c.motherLanes, mother.motherLanes);
    assert.deepEqual(c.roadSources.map(p => p.kind), ['synthetic', 'osm-baked', 'synthetic']);
    assert.equal(roadSourceSummary(c).real, 1);
  }
  const city = structuredClone(mother); city.venue.mix = { urban: 1 };
  assert(!validMapSources(city), 'urban palettes cannot use the natural exception');
  const altered = structuredClone(mother); altered.motherLanes[0][1][0] += .001;
  assert(!validMapSources(altered), 'generated flanks remain bound to the admitted recipe');
  const noRoad = structuredClone(mother); noRoad.roadSources[1] = noRoad.roadSources[0];
  assert(!validMapSources(noRoad), 'one real middle road remains mandatory');
  const steep = structuredClone(mother); steep.roadTerrain = makeTerrainAssessment(steep, (x, z) => 10 * x + 10 * z);
  assert(!validMapSources(steep), 'relaxing road count does not relax flank grades');
  const swap = structuredClone(mother);
  [swap.bases.SWARM, swap.bases.STEEL] = [swap.bases.STEEL, swap.bases.SWARM];
  swap.lanes = swap.lanes.map(l => [...l].reverse()); swap.motherLanes = swap.motherLanes.map(l => [...l].reverse());
  assert.equal(validateBattleConfig(swap, 5), null, 'natural recipes survive faction swaps');
}
const oldNatural = venueConfig(VENUES.find(v => v.id === 'phoenix'), 5); oldNatural.roadMode = 'real';
assert.equal(migrateFavCfg({ cfg: oldNatural, teamSize: 5 }).roadMode, 'natural-hybrid');
const oldProofs = VENUE_ROAD_EVIDENCE.phoenix;
try {
  VENUE_ROAD_EVIDENCE.phoenix = { 3: VENUE_ROAD_EVIDENCE.berlin[3] };
  assert.equal(venueConfig(VENUES.find(v => v.id === 'phoenix'), 5).roadMode, 'natural-hybrid',
    'an incompatible full-road receipt cannot hide a qualified natural recipe');
} finally {
  if (oldProofs) VENUE_ROAD_EVIDENCE.phoenix = oldProofs;
  else delete VENUE_ROAD_EVIDENCE.phoenix;
}
for (const n of [1, 2, 3, 4, 5]) assert.equal(validateBattleConfig(venueConfig(VENUES[0], n), n), null);
const end = structuredClone(cfg); end.bases.STEEL = [...end.bases.SWARM];
assert(validateBattleConfig(end, 5), 'inconsistent bases cannot pass by retaining advertised distances');
const subset = structuredClone(cfg); subset.lanes[1][1][0] += .001;
assert(validateBattleConfig(subset, 5), 'active lanes must equal their mother subset');
const excessive = structuredClone(cfg); excessive.motherLanes = Array(128).fill(cfg.motherLanes[0]);
assert(validateBattleConfig(excessive, 5), 'oversized mother arrays stop before pairwise occupancy work');
const distantVertex = structuredClone(cfg); distantVertex.motherLanes[0][1] = [80, -170];
assert(validateBattleConfig(distantVertex, 5), 'global-scale segments stop before allocating geographic occupancy grids');
const receipt = structuredClone(cfg); receipt.roadSources[0].edgeIds[0]++;
assert(!validMapSources(receipt), 'a modified source receipt is rejected');
const stale = structuredClone(cfg); stale.roadSources[0].laneHash = '00000000';
assert(!validMapSources(stale));
const falseReal = randomMapConfig({ seed: 12345, teamSize: 5 });
falseReal.gen = null; falseReal.synthetic = false; falseReal.roadMode = 'real';
assert(!validMapSources(falseReal));
const swapped = structuredClone(cfg); [swapped.bases.SWARM, swapped.bases.STEEL] = [swapped.bases.STEEL, swapped.bases.SWARM];
swapped.lanes = swapped.lanes.map(l => [...l].reverse()); swapped.motherLanes = swapped.motherLanes.map(l => [...l].reverse());
assert.deepEqual(mapGeometryMetrics(swapped).maxOverlap, mapGeometryMetrics(cfg).maxOverlap);
assert.equal(validateBattleConfig(swapped, 5), null, 'side swaps retain the same rules and archived source paths');
const steep = structuredClone(cfg); steep.roadTerrain = makeTerrainAssessment(steep, (x, z) => x * 10 + z * 10);
assert(!validTerrainAssessment(steep) && !validMapSources(steep));
const bogusTime = structuredClone(cfg); bogusTime.roadTerrain.times[0] = 0;
assert(!validTerrainAssessment(bogusTime), 'travel time is recomputed from sampled relief');

const A = [25, 121], B = [25.0001, 121.0001], C = [25.0002, 121.0002];
const source = { provider: 'fixture', version: '1', fingerprint: '12345678' };
const way = (id, points, highway = 'residential') => ({ id, tags: { highway }, geometry: points.map(([lat, lon]) => ({ lat, lon })) });
const proof = traceRoadEvidence([A, C], [way(1, [A, B, C])], { source });
assert(proof && validRoadEvidence(proof, [A, C]));
assert.equal(traceRoadEvidence([A, C], [way(1, [A, B]), way(2, [[25.00015, 121.00015], C])], { source }), null, 'nearby disconnected edges do not prove a connected lane');
assert.equal(traceRoadEvidence([A, C], [way(1, [A, B, C], 'footway')], { source }), null, 'walkways do not satisfy the driving profile');
const bridge = way(1, [A, B, C]); bridge.tags.bridge = 'yes';
const D = [25, 121.0001];
assert.equal(traceRoadEvidence([D, B, C], [way(2, [D, B]), bridge], { source }), null, 'structure entry through a middle node is rejected');
const old = { cfg: structuredClone(cfg), teamSize: 5 }; old.cfg.geoScaleVer = 0; old.cfg.venue = null;
assert.deepEqual(migrateFavCfg(old).lanes, old.cfg.lanes, 'custom favorites are never rescaled off their roads');

const hub = new RoomHub(), host = hub.attach(() => {});
try {
  const dishonest = structuredClone(cfg); dishonest.distM = 999999; dishonest.diagM = 1; dishonest.maxOverlap = 0;
  host.recv({ t: 'createRoom', name: 'Host', teamSize: 5, battleConfig: dishonest });
  const room = [...hub.rooms.values()][0]; assert(room);
  assert.equal(room.battleConfig.distM, mapGeometryMetrics(room.battleConfig).distM);
  assert.equal(room.battleConfig.maxOverlap, mapGeometryMetrics(room.battleConfig).maxOverlap);
  assert.equal(validateBattleConfig(room.battleConfig, 5), null);
} finally { hub.shutdown(); }
console.log('PASS shared map rules: verified catalogue, derived metrics, immutable mother subsets, source receipts, connected road ownership, driving profile, portals, relief/travel replay, side swaps and authority settlement.');
