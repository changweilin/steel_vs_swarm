// Exact outlines and controls outrank coarse observations; reordered room inputs must replay identically.
import assert from 'node:assert/strict';
import { planRoadFurniture } from '../public/js/roadFurniturePlan.js';
import { junctionBoundary, junctionMarkings, crossingMarkings, islandNoseMarkings } from '../public/js/roadJunctions.js';
import { parseOsmFeatureElements, osmFeatureQuery } from '../public/js/osmQuery.js';
import { sanitizeOsmRelay } from '../public/js/osmrelay.js';

const road = (points, tags = {}) => ({ kind: 'road', points, hw: 4, tags: { highway: 'primary', ...tags } });
const rectangle = (x0, z0, x1, z1) => [[x0,z0],[x1,z0],[x1,z1],[x0,z1],[x0,z0]];
const outline = { tags: { 'area:highway': 'traffic_island' }, points: rectangle(20,-.8,70,.8) };
const runs = [road([[-100,0],[100,0]]), road([[0,-100],[0,100]])];
const rec = { x: 0, z: 0, hw: 4, arms: 4, dirs: [[1,0],[0,1],[-1,0],[0,-1]],
  armHw: [4,4,4,4], armLength: [100,100,100,100], armIncoming: [true,true,true,false] };
rec.boundary = junctionBoundary(rec);
const points = [{ x: 0, z: 0, tags: { highway: 'traffic_signals' } },
  { x: 30, z: 7, tags: { highway: 'street_lamp' } }, { x: -30, z: -8, tags: { natural: 'tree' } },
  { x: 45, z: 0, tags: { highway: 'crossing', 'crossing:island': 'yes' } }];
const options = { runs, points, features: [outline], junctions: [rec], heightAt: () => 8 };
const plan = planRoadFurniture(options);
assert.equal(plan.islands.length, 1, 'Mapped refuge outline must not be duplicated by its crossing node');
assert.equal(plan.islands[0].source, 'osm-outline');
assert.equal(plan.lamps.length, 1); assert.equal(plan.trees.length, 1); assert.equal(plan.signals.length, 3);
assert(plan.signals.some(s => s.aspect === 'red') && plan.signals.some(s => s.aspect === 'green'));
assert(plan.signals.every(s => Math.abs(s.x) > 4 && Math.abs(s.z) > 4), 'Posts avoid both carriageways');
for (const s of plan.signals) assert(s.x * Math.sin(s.ry) + s.z * Math.cos(s.ry) > 0, 'Heads face approaching traffic');
assert.deepEqual(plan, planRoadFurniture({ ...options, runs: runs.toReversed(), points: points.toReversed() }));
assert.deepEqual(plan, planRoadFurniture({ ...options, junctions: [{ ...rec,
  dirs: rec.dirs.toReversed(), armHw: rec.armHw.toReversed(), armIncoming: rec.armIncoming.toReversed(),
  boundary: { ...rec.boundary, reaches: rec.boundary.reaches.toReversed() } }] }));
assert.equal(planRoadFurniture({ runs, heightAt: () => 8 }).signals.length, 0, 'Wide roads never fabricate controls');
assert.equal(planRoadFurniture({ ...options, points: [{ x:30, z:7, tags: { highway:'street_lamp', layer:'1' } }] }).lamps.length, 0,
  'Mapped nodes cannot attach to another road layer');
assert.equal(planRoadFurniture({ ...options, heightAt: () => NaN }).islands.length, 0);
assert.equal(planRoadFurniture({ ...options, free: () => false }).signals.length, 0);
assert.equal(planRoadFurniture({ ...options, free: (x, z) => !(x > 40 && x < 50 && Math.abs(z) < .4) }).islands.length, 0,
  'Interior water excludes the entire outline');
assert.equal(planRoadFurniture({ ...options, features: [{ ...outline, points: [[0,0],[4,4],[0,4],[4,0],[0,0]] }] }).islands
  .filter(i => i.source === 'osm-outline').length, 0);
assert.equal(planRoadFurniture({ ...options, features: [{ ...outline, points: outline.points.slice(0,-1) }] }).islands
  .filter(i => i.source === 'osm-outline').length, 0);
const pair = [road([[-100,-28],[100,-28]], { name: 'A', oneway: 'yes' }),
  road([[100,28],[-100,28]], { name: 'A', oneway: 'yes' })];
const fusion = { runs: pair, heightAt: () => 8, evidenceCellM: 40,
  evidenceAt: () => ({ sources: 3, confidence: 2, greenFraction: .8 }) };
assert.equal(planRoadFurniture(fusion).islands.length, 1);
assert.equal(planRoadFurniture(fusion).islands[0].source, 'osm-pair-rgb');
assert.equal(planRoadFurniture({ ...fusion, evidenceAt: () => ({ sources: 1, confidence: 2, greenFraction: .8 }) }).islands.length, 0);
assert.equal(planRoadFurniture({ ...fusion, evidenceAt: () => null }).islands.length, 0);
assert.equal(planRoadFurniture({ ...fusion, evidenceCellM: 80 }).islands.length, 0, 'Unresolved gaps are unknown');
assert.equal(planRoadFurniture({ ...fusion, runs: [pair[0], { ...pair[1], tags: { ...pair[1].tags, name: 'B' } }] }).islands.length, 0);
assert.equal(planRoadFurniture({ ...fusion, runs: [...pair, road([[0,-100],[0,100]])] }).islands.length, 0,
  'A transverse carriageway must not be buried under a median');
const twoWaySignals = planRoadFurniture({ runs: [runs[0]], heightAt: () => 8,
  points: [{ x: 10, z: 0, tags: { highway: 'traffic_signals' } }] }).signals;
assert.equal(twoWaySignals.length, 2);
assert.equal(planRoadFurniture({ runs: [road([[-100,0],[100,0]], { oneway: '-1' })], heightAt: () => 8,
  points: [{ x: 10, z: 0, tags: { highway: 'traffic_signals' } }] }).signals.length, 1);
const paint = junctionMarkings(rec, { controlled: true });
assert.equal(paint.filter(m => m.role === 'stop').length, 3);
assert(paint.some(m => m.role === 'zebra'));
assert.equal(junctionMarkings({ ...rec, armLength: [8,8,8,8] }).length, 0, 'Nearby junctions omit overlapping crossings');
assert(junctionMarkings({ ...rec, armLength: [8,8,8,8], armPaintLength: [100,100,100,100] }).length > 0,
  'Collinear intermediate vertices do not stand in for the next junction');
assert.equal(junctionMarkings({ ...rec, armTags: rec.dirs.map(() => ({ highway: 'motorway' })) }).length, 0);
for (const hw of [2,3.2,6.4,9.6]) for (const angle of [0,.2,1.5]) {
  const c = { x: 5, z: -3, dx: Math.cos(angle), dz: Math.sin(angle), hw, marked: true };
  for (const m of crossingMarkings(c)) for (const [x, z] of m.points) {
    assert(Math.abs((x-c.x)*c.dz-(z-c.z)*c.dx) <= hw * .82 + 1e-9);
    assert(Math.abs((x-c.x)*c.dx+(z-c.z)*c.dz) <= 1.6 + 1e-9);
  }
}
assert(islandNoseMarkings(plan.islands[0]).length > 0);
const elements = [{ type: 'way', tags: outline.tags, geometry: outline.points.map(([lon,lat]) => ({ lon,lat })) },
  { type: 'way', tags: { natural: 'tree_row' }, geometry: [{ lat:25,lon:121 },{ lat:25.01,lon:121.01 }] },
  ...['street_lamp','traffic_signals'].map(highway => ({ type: 'node', lat:25, lon:121, tags: { highway } })),
  { type: 'node', lat:25, lon:121, tags: { natural:'tree' } }];
const parsed = parseOsmFeatureElements(elements);
assert.equal(parsed.roadFurniture.length, 2); assert.equal(parsed.pois.length, 3); assert.equal(parsed.boundaries.length, 0);
const bbox = { minLat:-1,minLng:-1,maxLat:26,maxLng:122 };
const clean = sanitizeOsmRelay({ bbox, areas: [], pointFeatures: parsed.pointFeatures, roads: [] });
assert.equal(clean.pointFeatures.roadFurniture.length, 2);
assert.deepEqual(clean, sanitizeOsmRelay(clean));
parsed.roadFurniture[0].geometry[0].lat = 88;
assert.notEqual(clean.pointFeatures.roadFurniture[0].geometry[0].lat, 88, 'Room ownership is detached');
const query = osmFeatureQuery({ minLat:24,minLng:120,maxLat:25,maxLng:121 });
for (const tag of ['traffic_island','tree_row','street_lamp','natural"="tree']) assert(query.includes(tag));
console.log('PASS road furniture: mapped ownership, coarse RGB limits, whole envelopes, signal facing, layered omission and paint fit');
