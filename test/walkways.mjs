// Guards mapped side/material precedence, whole-footprint omission, independent replay and authored envelopes.
import assert from 'node:assert/strict';
import { walkwaySides, walkwayWidth, walkwaySurface, mappedWalkwayFurniture } from '../public/js/walkway.js';
import { WALKWAY_SURFACES, WALKWAY_FURNITURE } from '../public/js/walkwayCatalog.js';
import { WALKWAY_MESHES } from '../public/js/walkwayMeshData.js';
import { habitatAt, planHabitatStreets, planHabitatPathEdges, planHabitatFurniture, createHabitatSampler } from '../public/js/habitat.js';
import { classifyArea } from '../public/js/osmAreas.js';
import { parseOsmFeatureElements, osmFeatureQuery } from '../public/js/osmQuery.js';
import { sanitizeOsmRelay } from '../public/js/osmrelay.js';
import { readSrc } from '../tools/audit_src.mjs';
import { llToXZ, xzToLL } from '../public/js/data.js';

const evidence = { code: 50, confidence: 2, sources: 6, texture: 60, coherence: 80, greenFraction: .05, brightness: 140 };
const built = habitatAt(evidence, 'urban'), meadow = habitatAt({ ...evidence, code: 30 }, 'green');
assert.deepEqual(walkwaySides({ sidewalk: 'left' }, built), [-1]);
assert.deepEqual(walkwaySides({ sidewalk: 'right' }, built), [1]);
assert.deepEqual(walkwaySides({ sidewalk: 'both', 'sidewalk:left': 'separate' }, built), [1]);
assert.deepEqual(walkwaySides({ sidewalk: 'no', 'sidewalk:left': 'yes' }, built), [-1]);
assert.deepEqual(walkwaySides({ 'sidewalk:both': 'yes', 'sidewalk:right': 'no' }, meadow), [-1]);
for (const value of ['no', 'none', 'lane', 'separate', 'unknown']) assert.deepEqual(walkwaySides({ sidewalk: value }, built), []);
for (const tags of [{ highway: 'motorway' }, { highway: 'trunk' }, { bridge: 'yes' }, { tunnel: 'yes' },
  { highway: 'footway' }, { foot: 'no' }, { access: 'no' }]) assert.deepEqual(walkwaySides({ sidewalk: 'both', ...tags }, built), []);
assert.deepEqual(walkwaySides({}, built), [-1, 1]);
assert.deepEqual(walkwaySides({}, habitatAt(null, 'urban')), []);
assert.deepEqual(walkwaySides({}, meadow), []);
assert.equal(walkwayWidth({ 'sidewalk:left:width': '2 m' }, -1, 1.8, .5), 4);
assert.equal(walkwayWidth({ 'sidewalk:both:width': '1', 'sidewalk:left:width': '.bad' }, -1, 1.8, .5), null);
for (const value of ['-1', '0', 'NaN', '2 ft', '100', '2;3']) assert.equal(walkwayWidth({ 'sidewalk:width': value }, -1, 1.8, .5), null);
for (const key of Object.keys(WALKWAY_SURFACES)) assert.deepEqual(walkwaySurface({ surface: key }, meadow, 77), { key, source: 'osm-surface' });
assert.equal(walkwaySurface({ surface: 'fine_gravel' }, built).key, 'gravel');
assert.equal(walkwaySurface({ surface: 'asphalt', 'sidewalk:left:surface': 'bricks' }, built, 0, -1).key, 'bricks');
assert.notEqual(walkwaySurface({ surface: 'asphalt' }, built, 0, 1).source, 'osm-surface', 'The carriageway surface is not the sidewalk surface');
assert.equal(walkwaySurface({ surface: 'paved' }, built).source, 'osm-surface-class');
assert.equal(walkwaySurface({ surface: 'not_a_material' }, built).source, 'inferred-appearance');
assert.equal(walkwaySurface({ bridge: 'boardwalk' }, built).key, 'wood');
assert.equal(walkwaySurface({ highway: 'cycleway' }, meadow).key, 'asphalt');
assert.equal(walkwaySurface({ highway: 'path' }, meadow, 0, null, 'oldstreet').key, 'bricks');
assert.equal(walkwaySurface({ surface: 'wood' }, meadow, 0, null, 'oldstreet').key, 'wood');

const seg = { a: [-80, 0], b: [80, 0], hw: 5, tags: { highway: 'residential', sidewalk: 'left', 'sidewalk:left:surface': 'bricks' } };
const args = { segments: [seg], seed: 789, sampleAt: () => built, heightAt: () => 4, fits: () => true };
const panels = planHabitatStreets(args);
assert(panels.length > 30 && panels.every(p => p.z < 0 && p.surface.key === 'bricks' && p.source === 'osm-sidewalk'));
for (const rot of [0, Math.PI / 4, Math.PI / 2, Math.PI]) {
  const center = { lat: 25, lng: 121, rot };
  const a = llToXZ(25, 120.999, center), b = llToXZ(25, 121.001, center);
  const rows = planHabitatStreets({ ...args, segments: [{ ...seg, a, b }] });
  assert(rows.every(p => xzToLL(p.x, p.z, center)[0] > 25), 'Left of an eastbound OSM way stays north after map rotation');
}
assert(planHabitatStreets({ ...args, sampleAt: () => meadow }).length > 30, 'Tagged rural sidewalks survive a non-built appearance prior');
assert.equal(planHabitatStreets({ ...args, heightAt: () => NaN }).length, 0);
assert.equal(planHabitatStreets({ ...args, fits: () => false }).length, 0);
assert.equal(planHabitatStreets({ ...args, fitsPanel: () => false }).length, 0);
assert.equal(planHabitatStreets({ ...args, segments: [{ ...seg, tags: { sidewalk: 'separate' } }] }).length, 0);
assert.deepEqual(planHabitatStreets({ ...args, maxPanels: 5 }), panels.slice(0, 5));
const hole = [[-.07, -6.2], [.07, -6.2], [.07, -6.1], [-.07, -6.1]];
const sampler = createHabitatSampler({ areas: [{ sourceId: 'park', tags: { leisure: 'park' }, classification: classifyArea({ leisure: 'park' }),
  worldPolygons: [{ outer: [[-100,-100],[100,-100],[100,100],[-100,100]], holes: [hole] }] }],
  evidenceAt: () => evidence, zoneAt: () => 'green', envCodeAt: () => 0 });
const holed = planHabitatStreets({ ...args, sampleAt: sampler, fitsPanel: sampler.contains });
assert(holed.length < panels.length, 'A hole narrower than the probe lattice rejects the enclosing footprint');

const path = { ...seg, hw: 2.6, tags: { highway: 'path', surface: 'wood', handrail: 'yes' } };
const edgeArgs = { segments: [path], seed: 17, sampleAt: () => meadow, heightAt: () => 4 };
const edges = planHabitatPathEdges(edgeArgs);
assert(edges.length && edges.every(p => p.path && p.surface.key === 'wood'));
for (const extra of [{ bridge: 'yes' }, { tunnel: 'yes' }, { indoor: 'yes', level: '-1' }, { highway: 'steps' }, { foot: 'no' }]) {
  assert.equal(planHabitatPathEdges({ ...edgeArgs, segments: [{ ...path, tags: { ...path.tags, ...extra } }] }).length, 0);
}
assert.equal(planHabitatPathEdges({ ...edgeArgs, heightAt: () => NaN }).length, 0);
assert.equal(planHabitatPathEdges({ ...edgeArgs, sampleAt: () => habitatAt(null, 'wet') }).length, 0);

const furnitureArgs = { panels, seed: 81, sampleAt: () => built, heightAt: () => 4, fits: () => true };
const mapped = { x: -42, z: -12, tags: { amenity: 'bench' } };
const furniture = planHabitatFurniture({ ...furnitureArgs, points: [mapped] });
assert(furniture.length > 1);
assert(furniture.some(p => p.source === 'osm-point' && p.kind === 'bench' && p.x === mapped.x && p.z === mapped.z));
assert.deepEqual(furniture, planHabitatFurniture({ ...furnitureArgs, panels: panels.toReversed(), points: [mapped] }));
assert.deepEqual(planHabitatFurniture({ ...furnitureArgs, points: [mapped], maxObjects: 2 }), furniture.slice(0, 2));
assert.equal(planHabitatFurniture({ ...furnitureArgs, heightAt: () => NaN }).length, 0);
assert.equal(planHabitatFurniture({ ...furnitureArgs, heightAt: (x, z) => z * 2 }).length, 0);
for (const row of furniture) assert(Math.abs(row.z) - row.r > Math.abs(panels[0].z) + panels[0].width / 2, 'Furniture leaves the through corridor clear');
for (let i = 0; i < furniture.length; i++) for (let j = 0; j < i; j++) {
  assert(Math.hypot(furniture[i].x - furniture[j].x, furniture[i].z - furniture[j].z) >= furniture[i].r + furniture[j].r + .5);
}
const woodland = habitatAt({ ...evidence, code: 10 }, 'green', { natural: 'wood' });
const trailEdges = planHabitatPathEdges({ ...edgeArgs, sampleAt: () => woodland });
const trails = planHabitatFurniture({ ...furnitureArgs, panels: trailEdges, sampleAt: () => woodland });
assert(trails.length && trails.every(row => WALKWAY_FURNITURE[row.kind].trail));
const random = Math.random;
Math.random = () => { throw Error('Walkway planning consumed nondeterministic randomness'); };
try { planHabitatStreets(args); planHabitatPathEdges(edgeArgs); planHabitatFurniture(furnitureArgs); }
finally { Math.random = random; }

for (const [kind, data] of Object.entries(WALKWAY_MESHES)) {
  assert(data.vertices.length % 9 === 0 && data.colors.length * 3 === data.vertices.length);
  assert(data.vertices.every(Number.isFinite));
  const spec = WALKWAY_FURNITURE[kind];
  if (!spec) continue;
  for (let i = 0; i < data.vertices.length; i += 3) {
    assert(Math.hypot(data.vertices[i], data.vertices[i + 2]) <= spec.r, `${kind}: visual envelope exceeds its placement radius`);
    assert(data.vertices[i + 1] >= -.1 && data.vertices[i + 1] < 4);
  }
}
const bbox = { minLat: 25, minLng: 121, maxLat: 25.01, maxLng: 121.01 };
assert(osmFeatureQuery(bbox).includes('bench|waste_basket|bicycle_parking|drinking_water|shelter'));
const nodes = [{ type: 'node', lat: 25.001, lon: 121.001, tags: mapped.tags },
  { type: 'node', lat: 25.002, lon: 121.002, tags: { leisure: 'picnic_table' } },
  { type: 'node', lat: 25.003, lon: 121.003, tags: { barrier: 'bollard' } }];
const features = parseOsmFeatureElements(nodes);
assert.equal(features.pois.length, 3);
assert(features.pois.every(p => mappedWalkwayFurniture(p.tags)));
const relayed = sanitizeOsmRelay({ bbox, pointFeatures: { pois: features.pois } });
assert.deepEqual(relayed.pointFeatures.pois, features.pois);
const renderer = readSrc('public', 'js', 'walkwayRender.js');
assert(!/Math\.random|blockers\.push|decks\.push/.test(renderer));
console.log(`PASS walkways: ${Object.keys(WALKWAY_SURFACES).length} surfaces, ${Object.keys(WALKWAY_MESHES).length} Blender members, side tags, holes, envelopes, replay and room relay`);
