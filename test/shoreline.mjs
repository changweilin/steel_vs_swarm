// Execute production classification and placement: holes, narrow channels, missing evidence, replay and authored envelopes.
import assert from 'node:assert/strict';
import { shoreWaterType, mappedShoreFacility, createShoreClassifier, planShoreAnchors, planShoreFacilities } from '../public/js/shoreline.js';
import { SHORELINE, SHORE_FACILITIES } from '../public/js/shorelineCatalog.js';
import { SHORE_MESHES } from '../public/js/shorelineMeshData.js';
import { classifyArea } from '../public/js/osmAreas.js';
import { parseOsmFeatureElements, osmFeatureQuery } from '../public/js/osmQuery.js';
import { sanitizeOsmRelay } from '../public/js/osmrelay.js';
import { readSrc } from '../tools/audit_src.mjs';

for (const type of ['lake', 'reservoir', 'pond', 'river', 'stream', 'canal', 'drain', 'ditch', 'basin', 'lagoon']) {
  assert.equal(shoreWaterType({ natural: 'water', water: type }), type);
}
assert.equal(shoreWaterType({ natural: 'coastline' }), 'sea');
assert.equal(shoreWaterType({ waterway: 'tidal_channel' }), 'tidal');
assert.equal(shoreWaterType({ landuse: 'reservoir' }), 'reservoir');
assert.equal(shoreWaterType({ natural: 'water' }), 'unknown');
assert.equal(shoreWaterType({ water: 'unrecognized', waterway: 'river' }), 'unknown');
assert.equal(mappedShoreFacility({ man_made: 'pier', floating: 'yes' }), 'floating_dock');
assert.equal(mappedShoreFacility({ emergency: 'life_ring' }), 'life_ring');
assert.equal(mappedShoreFacility({ natural: 'water' }), null);
assert.equal(mappedShoreFacility({ man_made: 'monitoring_station', 'monitoring:weather': 'yes' }), null);
assert.equal(mappedShoreFacility({ man_made: 'monitoring_station', 'monitoring:water_level': 'yes' }), 'gauge');

const obs = code => ({ code, confidence: 2, sources: 3 });
const area = (tags, outer, holes = [], sourceId = 'w1') => ({ sourceId, tags, classification: classifyArea(tags), worldPolygons: [{ outer, holes }] });
const lake = area({ natural: 'water', water: 'lake' }, [[-40,-40],[40,-40],[40,40],[-40,40]], [[[-8,-8],[8,-8],[8,8],[-8,8]]]);
const coast = { tags: { natural: 'coastline' }, points: [[0,-60],[0,60]] };
const classifier = createShoreClassifier({ areas: [lake], lines: [coast], evidenceAt: () => obs(80) });
assert.equal(classifier(12, 0).type, 'lake', 'Inland polygons outrank a nearby coastline');
assert.equal(classifier(0, 0).type, 'sea', 'Polygon holes never inherit lake tags');
assert.equal(classifier(100, 100).type, 'unknown');
assert.equal(classifier(12, 0).confidence, 3);
assert.equal(createShoreClassifier({ areas: [lake], evidenceAt: () => obs(50) })(12, 0).conflict, true);
assert.equal(createShoreClassifier({ areas: [lake], evidenceAt: () => ({ code: 80, confidence: 3, sources: 4 }) })(12, 0).corroborated, false);
const unknown = area({ natural: 'water' }, [[-10,-10],[10,-10],[10,10],[-10,10]]);
assert.equal(createShoreClassifier({ areas: [unknown], lines: [coast] })(0, 0).type, 'unknown');
assert.equal(createShoreClassifier({ evidenceAt: () => obs(80) })(0, 0).type, 'unknown', 'Satellite water alone cannot prove a lake');

const bounds = { minX: -70, maxX: 70, minZ: -70, maxZ: 70 }, heightAt = (x, z) => z * .05;
const anchors = planShoreAnchors({ bounds, heightAt, waterY: 0, classifyAt: () => ({ type: 'river', source: 'osm-line' }) });
assert(anchors.length > 8);
assert(anchors.every(a => Math.abs(a.z) < .01 && a.nz > .999 && Math.abs(a.nx) < .001));
assert.deepEqual(planShoreAnchors({ bounds, heightAt: () => NaN, waterY: 0 }), []);
assert.deepEqual(planShoreAnchors({ bounds, heightAt, waterY: null }), []);
assert.deepEqual(planShoreAnchors({ bounds, heightAt: () => 1, waterY: 0 }), []);
const channel = { tags: { waterway: 'ditch', width: '1' }, points: [[-60,3],[60,3]] };
const channelHeight = (x, z) => Math.abs(z - 3) - .5;
const channelRows = planShoreAnchors({ bounds, waterY: 0, heightAt: channelHeight, lines: [channel],
  classifyAt: createShoreClassifier({ lines: [channel] }) });
assert(channelRows.length >= 16 && channelRows.every(a => a.type === 'ditch'));
assert(channelRows.some(a => a.nz < 0) && channelRows.some(a => a.nz > 0));
assert.deepEqual(planShoreAnchors({ bounds, waterY: 0, heightAt: () => 2, lines: [channel] }), [], 'A mapped dry channel cannot manufacture water');

const args = { anchors, bounds, heightAt, evidenceAt: () => obs(50), seed: 77 };
const rows = planShoreFacilities(args);
assert(rows.length > 3 && rows.every(r => r.source === 'context-appearance'));
assert.deepEqual(planShoreFacilities(args), rows);
assert.deepEqual(planShoreFacilities({ ...args, limit: 3 }), rows.slice(0, 3));
const manyArgs = { ...args, bounds: {minX:-4000,maxX:4000,minZ:-70,maxZ:70}, heightAt: () => 4,
  anchors: Array.from({length:1200},(_,i)=>({...anchors[0],x:(i-600)*6})) };
const many = planShoreFacilities(manyArgs);
assert.equal(many.length, SHORELINE.LIMIT);
assert.deepEqual(planShoreFacilities({...manyArgs,limit:SHORELINE.LOW_LIMIT}),many.slice(0,SHORELINE.LOW_LIMIT));
const generated = planShoreFacilities({...manyArgs,procedural:true});
assert(generated.some(r=>SHORE_FACILITIES[r.kind].mapped),'Procedural maps can draw compatible infrastructure without geographic POIs');
assert(generated.every(r=>r.source==='procedural-appearance'));
assert.deepEqual(planShoreFacilities({...manyArgs,procedural:true,limit:SHORELINE.LOW_LIMIT}),generated.slice(0,SHORELINE.LOW_LIMIT));
assert(!many.some(r=>SHORE_FACILITIES[r.kind].mapped),'Geographic inference still requires mapped infrastructure');
assert.deepEqual(planShoreFacilities({ ...args, fits: () => false }), []);
assert.deepEqual(planShoreFacilities({ ...args, heightAt: () => NaN }), []);
assert.deepEqual(planShoreFacilities({ ...args, evidenceAt: () => null }), []);
assert.deepEqual(planShoreFacilities({ ...args, evidenceAt: () => obs(60) }), [], 'Bare cover never invents beach sand or rock geology');
assert(rows.every(r => Math.cos(r.ry) < -.99), 'Local positive Z faces the water');
const mapped = planShoreFacilities({ ...args, points: [{ x: 0, z: 4, tags: { emergency: 'life_ring' } }] });
assert(mapped[0].kind === 'life_ring' && mapped[0].source === 'osm-point' && mapped[0].x === 0 && mapped[0].z === 4);
assert(!planShoreFacilities({ ...args, evidenceAt: () => null, points: [{ x: 0, z: -4, tags: { emergency: 'life_ring' } }] }).length);
const sand = area({ natural: 'beach' }, [[-70,0],[70,0],[70,70],[-70,70]]);
const beach = planShoreFacilities({ ...args, anchors: anchors.map(a => ({ ...a, type: 'sea' })), areas: [sand], evidenceAt: () => obs(60) });
assert(beach.length && beach.every(r => r.kind === 'dune_fence'));

let triangles = 0;
for (const [kind, spec] of Object.entries(SHORE_FACILITIES)) for (let v = 0; v < SHORELINE.VARIANTS; v++) {
  const m = SHORE_MESHES[kind + '/' + v];
  assert(m && m.vertices.length % 9 === 0 && m.vertices.length / 3 === m.colors.length);
  assert(m.vertices.every(Number.isFinite));
  for (let i = 0; i < m.vertices.length; i += 3) {
    assert(Math.abs(m.vertices[i]) <= spec.size[0] / 2 + 1e-5);
    assert(m.vertices[i + 1] >= -1e-5 && m.vertices[i + 1] <= spec.size[1] + 1e-5);
    assert(Math.abs(m.vertices[i + 2]) <= spec.size[2] / 2 + 1e-5);
  }
  assert(m.vertices.length / 9 <= 1200, kind + ': excessive triangle budget');
  triangles += m.vertices.length / 9;
}
assert.equal(Object.keys(SHORE_MESHES).length, Object.keys(SHORE_FACILITIES).length * SHORELINE.VARIANTS);
const parsed = parseOsmFeatureElements([
  { type: 'way', id: 1, tags: { natural: 'coastline' }, geometry: [{ lat: 25, lon: 121 }, { lat: 25.01, lon: 121 }] },
  { type: 'node', id: 2, lat: 25, lon: 121, tags: { emergency: 'life_ring' } },
  { type: 'node', id: 3, lat: 25, lon: 121, tags: { waterway: 'sluice_gate' } },
]);
assert.equal(parsed.boundaries.length, 1);
assert.equal(parsed.pois.length, 2);
assert.equal(parsed.areaInvalid, 0, 'A coastline is a line, not an invalid polygon');
const bbox = { minLat: 24.9, maxLat: 25.1, minLng: 120.9, maxLng: 121.1 };
const relay = sanitizeOsmRelay({ bbox, areas: parsed.areas, pointFeatures: parsed.pointFeatures, roads: [] });
assert.equal(relay.pointFeatures.boundaries.length, 1);
assert.equal(relay.pointFeatures.pois[0].tags.emergency, 'life_ring');
assert.deepEqual(sanitizeOsmRelay(relay), relay);
const query = osmFeatureQuery(bbox);
assert(query.includes('life_ring|lifeguard_tower') && query.includes('tidal_channel'));
const src = readSrc('public/js/habitatRender.js');
assert(src.includes('allShore.slice') && src.indexOf('planShoreFacilities') < src.indexOf('const plan = planHabitatDetails'));
assert(!/Math\.random|blockers\.push/.test(readSrc('public/js/shoreline.js') + readSrc('public/js/shorelineRender.js')));
assert(readSrc('public/js/biomes.js').includes('procedural: isRandomMap(cfg)'));
console.log(`PASS shore evidence, holes, narrow channels, dry/invalid omission, replay, budgets, room relay and ${Object.keys(SHORE_MESHES).length} authored models (${triangles} triangles)`);
