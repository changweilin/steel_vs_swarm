import assert from 'node:assert/strict';
import { VENUES, venueConfig } from '../public/js/venues.js';
import { VENUE_LANES } from '../public/js/venueLanes.js';
import { mixedMapConfig, randomMapConfig } from '../public/js/mapgen.js';
import { generateMixedMap, mixedRoadFrame, mixedRoadCount } from '../public/js/mixedMap.js';
import { MIXED_LAYERS, mapSourceCenter, mapSourceKey, validMixedLayers } from '../public/js/mapLayerSources.js';
import { geographicEnvironment, seasonalEnvironment } from '../public/js/seasonalEnvironment.js';
import { detectCulturalRegion } from '../public/js/buildingDiversity.js';
import { RoomHub, validateBattleConfig } from '../server/rooms.js';
import { battleBBox, battleRect, xzToLL, lanesFor, laneSubsetFor } from '../public/js/data.js';
import { sourceTerrainHarness } from './sourceTerrainHarness.mjs';
import { readSrc, grabFn } from '../tools/audit_src.mjs';
import { makeTerrainAssessment, laneFingerprint } from '../public/js/roadEvidence.js';

const roadIn = b => [{ tags: { highway: 'residential' }, geometry: [
  { lat: b.minLat, lon: b.minLng }, { lat: b.maxLat, lon: b.maxLng },
] }];
const fetchRoads = async b => roadIn(b);
const venue = id => VENUES.find(v => v.id === id);
const source = (id, role) => {
  const frame = mixedRoadFrame(venue(id)) || venueConfig(venue(id), 5);
  return { ...venue(id), role, frame, weight: 1, roadCount: 1,
    laneSource: role === 'surface' ? (frame.roadMode === 'natural-hybrid' ? 'natural-hybrid' : 'osm-baked') : null };
};
const sources = [source('taroko', 'elevation'), source('berlin', 'surface'), source('dubai', 'regional')];
const cfg = mixedMapConfig(sources, { teamSize: 5, seed: 42 });
assert(cfg);
assert.deepEqual(cfg.center, mixedRoadFrame(venue('berlin')).center, 'the map does not sample a geographic centroid');
assert.deepEqual(cfg.motherLanes, VENUE_LANES.berlin[3].lanes, 'all three lanes retain their raw OSM polylines');
assert.equal(cfg.synthetic, false);
assert.equal(cfg.procRelief, null, 'borrowed contours are not replaced by synthetic relief');
assert(validateBattleConfig(cfg, 5), 'borrowed elevation must be assessed in its new road frame');
cfg.roadTerrain = makeTerrainAssessment(cfg, () => 0);
assert.equal(validateBattleConfig(cfg, 5), null);
const hub = new RoomHub(), messages = [], host = hub.attach(message => messages.push(message));
try {
  host.recv({ t: 'createRoom', name: 'Host', teamSize: 5, battleConfig: structuredClone(cfg) });
  const room = [...hub.rooms.values()][0];
  assert(room, 'the shared room core accepts the mixed recipe');
  assert.deepEqual(room.battleConfig.gen.layers, cfg.gen.layers);
  assert.deepEqual(room.battleConfig.venue.forest, cfg.venue.forest);
  const received = [], guest = hub.attach(message => received.push(message));
  guest.recv({ t: 'joinRoom', pin: room.pin, name: 'Guest', mode: 'spectator' });
  assert(received.some(message => JSON.stringify(message).includes(JSON.stringify(cfg.gen.layers))),
    'source coordinates and road provenance reach joining clients');
} finally { hub.shutdown(); }
assert.equal(cfg.venue.forest.geology, 'sandstone');
assert.equal(cfg.venue.forest.climate, 'arid');
assert.equal(cfg.venue.forest.geologyInferred, true);
assert.deepEqual(mapSourceCenter(cfg, 'elevation'), sources[0].frame.center);
assert.deepEqual(mapSourceCenter(cfg, 'regional'), sources[2].frame.center);
assert(detectCulturalRegion({ center: mapSourceCenter(cfg, 'regional') }), 'regional appearance uses the existing coordinate classifier');
assert.notEqual(detectCulturalRegion({ center: mapSourceCenter(cfg, 'regional') }), detectCulturalRegion({ center: cfg.center }));

for (let ts = 1; ts <= 5; ts++) {
  const c = mixedMapConfig(sources, { teamSize: ts, seed: 42 });
  c.roadTerrain = structuredClone(cfg.roadTerrain);
  assert.deepEqual(c.center, cfg.center);
  assert.deepEqual(c.bases, cfg.bases);
  assert.deepEqual(c.motherLanes, cfg.motherLanes);
  assert.deepEqual(c.laneIds, laneSubsetFor(lanesFor(ts)));
  assert.equal(validateBattleConfig(c, ts), null);
}
const before = JSON.stringify(sources);
const original = cfg.motherLanes[0][1][0];
cfg.motherLanes[0][1][0] += .001;
assert.equal(JSON.stringify(sources), before, 'config assembly never mutates a baked source');
cfg.motherLanes[0][1][0] = original;

assert(mixedRoadFrame(venue('madrid')), 'the newly verified complete Madrid mother is usable');
assert.equal(mixedRoadFrame(venue('taroko')), null, 'unqualified natural geometry remains pending');
assert.equal(mixedMapConfig([]), null);
assert.equal(mixedMapConfig([sources[0], sources[1], { ...sources[2], roadCount: 0 }]), null);
assert.equal(mixedMapConfig([sources[0], sources[1], { ...sources[2], id: sources[0].id }]), null);
assert.equal(mixedMapConfig([sources[0], { ...sources[1], laneSource: null }, sources[2]]), null);
assert.equal(validMixedLayers({ ...cfg.gen.layers, regional: { ...cfg.gen.layers.regional, center: cfg.gen.layers.elevation.center } }), false);
assert(validateBattleConfig({ ...cfg, synthetic: true }, 5), 'all transports reject a synthetic mixed map');
assert(validateBattleConfig({ ...cfg, gen: { mode: 'mixed' } }, 5), 'legacy mixed maps require regeneration');

const bbox = battleBBox(cfg);
assert.equal(mixedRoadCount(null, bbox), 0);
assert.equal(mixedRoadCount([], bbox), 0);
assert.equal(mixedRoadCount([{ tags: { highway: 'primary' }, geometry: [{ lat: NaN, lon: 0 }, { lat: 0, lon: 0 }] }], bbox), 0);
assert.equal(mixedRoadCount([{ tags: {}, geometry: roadIn(bbox)[0].geometry }], bbox), 0);
assert.equal(mixedRoadCount(roadIn({ minLat: -10, maxLat: -9, minLng: 0, maxLng: 1 }), bbox), 0);
assert.equal(mixedRoadCount(roadIn(bbox), bbox), 1, 'residential roads qualify, not only arterial roads');
assert.equal(mixedRoadCount([{ tags: { highway: 'primary' }, geometry: [{ lat: 2, lon: 0 }, { lat: 4, lon: 2 }] }],
  { minLat: 0, maxLat: 2, minLng: 1, maxLng: 3 }), 0, 'a way bounding box alone is insufficient road coverage');

for (const seed of [1, 2, 3, 42, 108]) {
  const a = await generateMixedMap(VENUES, { seed, fetchRoads });
  const b = await generateMixedMap(VENUES, { seed, fetchRoads });
  assert(a && b);
  assert.deepEqual(a, b, 'a frozen source set and seed replay identically');
  assert.equal(new Set(MIXED_LAYERS.map(role => a.gen.layers[role].id)).size, 3);
  assert.deepEqual(a.motherLanes, venueConfig(venue(a.gen.layers.surface.id), 5).motherLanes);
  a.roadTerrain = makeTerrainAssessment(a, () => 0);
  assert.equal(validateBattleConfig(a, 5), null);
}
assert.equal(await generateMixedMap(VENUES, { seed: 42, fetchRoads: async () => [] }), null);
assert.equal(await generateMixedMap(VENUES, { seed: 42, fetchRoads: async () => { throw new Error('unavailable'); } }), null);
let checked = 0;
const skipped = await generateMixedMap(VENUES, { seed: 42, fetchRoads: async b => ++checked === 1 ? [] : roadIn(b) });
assert(skipped && checked > 3, 'a roadless region is replaced before committing the three layers');
const ctrl = new AbortController();
assert.equal(await generateMixedMap(VENUES, { seed: 42, signal: ctrl.signal,
  fetchRoads: async b => { ctrl.abort(); return roadIn(b); } }), null);

assert.equal(geographicEnvironment(NaN, 1), null);
assert.equal(geographicEnvironment(25, 181), null);
assert.equal(geographicEnvironment(60, 10).geology, 'granite');
assert.equal(geographicEnvironment(25, 121).geology, 'basalt');
assert.equal(seasonalEnvironment({ ...geographicEnvironment(-37, 175), season: 'winter' }).season, 'winter');
const changed = structuredClone(cfg);
changed.gen.layers.elevation.center.lng += 1;
assert.notEqual(mapSourceKey(changed), mapSourceKey(cfg), 'source coordinates invalidate preparation keys');

// Source-only production terrain sampling runs without loading Three.js or public services.
let requestedElevation;
const buildTerrain = sourceTerrainHarness({ get: async () => null,
  elevation: async b => { requestedElevation = b; return (lat, lng) => lat * 100 + lng; } });
const pack = await buildTerrain(cfg, () => {}, { sourceOnly: true });
assert.deepEqual(requestedElevation, battleBBox(cfg, mapSourceCenter(cfg, 'elevation')));
assert.deepEqual(pack.bbox, bbox, 'OSM and imagery retain the road map capture frame');
assert.deepEqual(pack.center, cfg.center);
const rect = battleRect(cfg), [lat, lng] = xzToLL(rect.minX, rect.minZ, mapSourceCenter(cfg, 'elevation'));
assert(Math.abs(pack.elevationAt(rect.minX, rect.minZ) - (lat * 100 + lng)) < .001);

const prepKey = new Function('mapSourceKey', 'laneFingerprint', `${grabFn(readSrc('public', 'js', 'mapPreparation.js'), 'mapPrepKey')}; return mapPrepKey;`)(mapSourceKey, laneFingerprint);
assert.notEqual(prepKey(cfg), prepKey(changed), 'shared preparation caches include layer coordinates');

const regular = venueConfig(venue('berlin'), 5);
assert.deepEqual(mapSourceCenter(regular, 'elevation'), regular.center);
assert.equal(mapSourceKey(regular), '');
assert(randomMapConfig({ anchors: VENUES, seed: 1, teamSize: 5 }).synthetic, 'random-map mode retains its own generator');
const naturalSources = [source('kyoto', 'elevation'), source('phoenix', 'surface'), source('walvisbay', 'regional')];
for (const n of [1, 2, 3, 4, 5]) {
  const natural = mixedMapConfig(naturalSources, { seed: 123, teamSize: n });
  assert(natural);
  assert.equal(natural.roadMode, 'natural-hybrid');
  assert.equal(natural.gen.laneSource, 'natural-hybrid');
  assert.deepEqual(natural.roadSources.map(p => p.kind), ['synthetic', 'osm-baked', 'synthetic']);
  natural.roadTerrain = makeTerrainAssessment(natural, () => 0);
  assert.equal(validateBattleConfig(natural, n), null);
  const urban = structuredClone(natural); urban.venue.mix = { urban: 1 };
  assert(validateBattleConfig(urban, n), 'borrowing a palette cannot turn an urban map into a natural road exception');
  natural.roadTerrain = makeTerrainAssessment(natural, (x, z) => 10 * x + 10 * z);
  assert(validateBattleConfig(natural, n), 'borrowed relief still qualifies both generated flanks');
}
assert.equal(mixedMapConfig(naturalSources, { mixOverride: { urban: 1 } }), null);
console.log('PASS mixed maps: three distinct verified road regions, exact OSM mother, seeded replay, authority gates, empty/failed source rejection, cancellation, source elevation projection, climate/culture/geology appearance and cache identity.');
