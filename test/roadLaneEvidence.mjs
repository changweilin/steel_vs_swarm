import assert from 'node:assert/strict';
import { MAPGEO } from '../public/js/data.js';
import { roadWidth } from '../tools/venue_field.mjs';
import { ROAD_LANE_M, satelliteRoadSection, inferSatelliteRoadLanes, taggedRoadLanes } from '../public/js/roadLaneEvidence.js';
import { sanitizeOsmRelay } from '../public/js/osmrelay.js';

const imagery = (width, angle = 0, pixelM = .4) => ({ pixelM, sampleColor: (x, z) => {
  const across = Math.abs(x * Math.sin(angle) - z * Math.cos(angle)) * MAPGEO.REAL_SCALE;
  return across <= width / 2 ? [85, 85, 85] : [45, 135, 50];
} });
for (const lanes of [1, 2, 3, 4, 6, 8]) for (const degrees of [0, 17, 90, 137]) {
  const angle = degrees * Math.PI / 180;
  const result = satelliteRoadSection(0, 0, Math.cos(angle), Math.sin(angle), imagery(lanes * ROAD_LANE_M, angle));
  assert(result); assert.equal(result.lanes, lanes);
  assert(Math.abs(result.width - lanes * ROAD_LANE_M) < .85);
}
for (const source of [null, imagery(10, 0, 4), { pixelM: .4, sampleColor: () => null },
  { pixelM: .4, sampleColor: () => [85, 85, 85] }, { pixelM: .4, sampleColor: () => [30, 120, 30] }]) {
  assert.equal(satelliteRoadSection(0, 0, 1, 0, source), null);
}
assert.equal(satelliteRoadSection(0, 0, 0, 0, imagery(6.4)), null);
assert.equal(taggedRoadLanes({ 'lanes:forward': '2', 'lanes:backward': '1' }), 3);
assert.equal(taggedRoadLanes({ lanes: '-1' }), null);
assert.equal(taggedRoadLanes({ lanes: '2;4' }), null);
const ways = [{ tags: { highway: 'primary' }, geometry: [{ lat: 25, lon: 121 }, { lat: 25, lon: 121.002 }] },
  { tags: { highway: 'primary', lanes: '4' }, geometry: [{ lat: 25, lon: 121 }, { lat: 25, lon: 121.002 }] }];
const original = structuredClone(ways), toXZ = p => [(p.lon - 121) * 100000 / MAPGEO.REAL_SCALE, 0];
const observed = await inferSatelliteRoadLanes(ways, toXZ, async () => imagery(6.4));
assert.deepEqual(ways, original, 'the raw OSM cache is immutable');
assert.equal(observed[0].tags.lanes, undefined, 'estimates do not impersonate OSM lane tags');
assert.equal(observed[0].tags['svs:lanes'], '2');
assert.equal(roadWidth(observed[0].tags), ROAD_LANE_M * 2);
assert.deepEqual(observed[1], original[1], 'explicit OSM lanes outrank imagery');
const bbox = { minLat: 24.99, maxLat: 25.01, minLng: 120.99, maxLng: 121.01 };
const relay = sanitizeOsmRelay({ bbox, roads: observed });
assert.deepEqual(sanitizeOsmRelay(relay).roads, relay.roads);
assert.equal(roadWidth(relay.roads[0].tags), roadWidth(observed[0].tags));
let calls = 0;
assert.deepEqual(await inferSatelliteRoadLanes(relay.roads, toXZ, async () => { calls++; return imagery(12.8); }), relay.roads);
assert.equal(calls, 0, 'room clients replay frozen estimates without resampling');
const failed = await inferSatelliteRoadLanes(ways, toXZ, async () => { throw Error('unavailable'); });
assert.equal(failed[0].tags['svs:lanes'], undefined);
assert.equal(roadWidth(failed[0].tags), roadWidth(ways[0].tags), 'missing imagery preserves the highway fallback');
let sample = 0;
const disagreement = await inferSatelliteRoadLanes(ways, toXZ, async () => imagery(++sample === 1 ? 6.4 : 12.8));
assert.equal(disagreement[0].tags['svs:lanes'], undefined, 'junction widening and ambiguous sections are omitted');
console.log('PASS: rotated satellite cross-sections, resolution/edge gates, OSM precedence, immutable source, frozen relay and service failure.');
