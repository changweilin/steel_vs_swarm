import assert from 'node:assert/strict';
import { DEFS, SURFACES, SURFACE_LIMITS, ZONES } from '../public/js/groundCatalog.js';
import { stadiumPath, paintVenue } from '../public/js/groundMarkings.js';
import { VENUES, TRACK, TRACK_WIDTH, TRACK_DEPTH } from '../public/js/groundVenues.js';
import { LANDSCAPES } from '../public/js/groundLandscapes.js';
import { VISITOR_SITES } from '../public/js/groundVisitorSites.js';
import { GROUND_PARTS, GROUND_ATTACHMENTS } from '../public/js/groundPartCatalog.js';
import { surfaceEnvironment, surfaceAllowed, surfaceParameters, probeSurface, paintGround } from '../public/js/proceduralGround.js';
import { mulberry32 } from '../public/js/rng.js';

const { THREE, generateGroundPart } = await import('../tools/ground_model_runtime.mjs');
assert.deepEqual(Object.keys(SURFACES).sort(), Object.keys(DEFS).sort());
assert.deepEqual(Object.keys(GROUND_ATTACHMENTS).sort(), Object.keys(DEFS).sort());
for (const id of Object.keys(SURFACES)) {
  for (let seed = 0; seed < 100; seed++) {
    const p = surfaceParameters(id, seed, seed * 7, -seed);
    assert.deepEqual(p, surfaceParameters(id, seed, seed * 7, -seed));
    assert.ok(p.widthScale >= SURFACE_LIMITS.widthScale[0] && p.widthScale <= SURFACE_LIMITS.widthScale[1]);
    if (SURFACES[id].locked) assert.equal(p.aspect, SURFACES[id].aspect);
    for (const part of SURFACES[id].parts) assert.ok(GROUND_PARTS[part]);
  }
}
for (const id of ['court', 'track', 'helipad']) {
  assert.ok(probeSurface(() => 10, 0, 0, 16, .71, DEFS[id], SURFACES[id]));
  assert.equal(probeSurface((x, z) => 10 + .1 * x, 0, 0, 16, .71, DEFS[id], SURFACES[id]), false);
  assert.equal(probeSurface((x, z) => x > 4 && z > 4 ? 12 : 10, 0, 0, 16, .71, DEFS[id], SURFACES[id]), false);
  assert.equal(probeSurface(() => NaN, 0, 0, 16, 0, DEFS[id], SURFACES[id]), false);
}
assert.ok(probeSurface(x => 10 + x * .05, 0, 0, 16, .71, DEFS.turf, SURFACES.turf));
assert.equal(surfaceAllowed('icefield', surfaceEnvironment({ latitude: 0, season: 'summer' })), false);
assert.ok(surfaceAllowed('icefield', surfaceEnvironment({ latitude: 70, season: 'winter' })));
assert.equal(surfaceEnvironment({ geology: 'fictional' }).geology, 'unknown');
for (const type of Object.keys(GROUND_PARTS)) {
  const a = generateGroundPart(type, 1), b = generateGroundPart(type, 1), c = generateGroundPart(type, 2);
  const signature = parts => parts.map(p => [...p.geo.attributes.position.array]);
  assert.deepEqual(signature(a), signature(b), type);
  assert.notDeepEqual(signature(a), signature(c), `${type} variants must change geometry`);
  for (const part of [...a, ...b, ...c]) {
    assert.ok([...part.geo.attributes.position.array].every(Number.isFinite), type);
    part.geo.computeBoundingBox(); assert.ok(!part.geo.boundingBox.isEmpty()); part.geo.dispose();
  }
}

function context(log = []) {
  return new Proxy({}, { get: (o, k) => k in o ? o[k] : (...args) => {
    log.push([k, ...args]);
    if (k === 'createLinearGradient' || k === 'createRadialGradient') return { addColorStop() {} };
  }, set: (o, k, v) => { log.push([k, v]); o[k] = v; return true; } });
}
for (const id of Object.keys(SURFACES)) {
  const a = [], b = [];
  paintGround(context(a), 256, id, 15, surfaceEnvironment({ season: 'summer' }));
  paintGround(context(b), 256, id, 15, surfaceEnvironment({ season: 'summer' }));
  assert.deepEqual(a, b);
}
const summer = [], winter = [];
paintGround(context(summer), 256, 'paddy', 15, surfaceEnvironment({ season: 'summer' }));
paintGround(context(winter), 256, 'paddy', 15, surfaceEnvironment({ season: 'winter' }));
assert.notEqual(summer.length, winter.length, 'Seasons change patterns, not only tint');

globalThis.document = { createElement: () => ({ getContext: () => context() }) };
globalThis.window = { location: { search: '' } };
const { buildGroundCover } = await import('../public/js/ground.js');
function build(slope = 0) {
  const group = new THREE.Group(), blockers = [];
  const heightAt = (x, z) => 20 + x * slope;
  const terrain = { minX: -160, maxX: 160, minZ: -160, maxZ: 160, worldW: 320, worldH: 320, gridM: 4,
    heightAt, elevationAt: () => 150, center: { lat: 25 } };
  const stats = buildGroundCover(group, terrain, { isBlocked: () => false, classifyAt: () => 'urban',
    classifyPureAt: () => 'urban', blockers, season: 'summer', seed: 7123, rnd: mulberry32(7123) });
  for (const mesh of group.children) {
    assert.ok([...mesh.geometry.attributes.position.array].every(Number.isFinite), mesh.name);
  }
  return { group, stats, blockers };
}
const a = build(), b = build(), slope = build(.12);
assert.ok(a.stats.patches > 0 && a.stats.details > 0, 'Actual deployment is nonempty');
assert.deepEqual(a.group.userData.proceduralSurfaces, b.group.userData.proceduralSurfaces);
assert.deepEqual(a.blockers, b.blockers);
assert.equal(slope.group.userData.proceduralSurfaces.some(p => SURFACES[p.sub].flat), false);
assert.ok(a.group.children.some(m => m.userData.proceduralGroundPart));
const originalUrban = ZONES.urban;
ZONES.urban = ['court'];
const courtFixture = build();
ZONES.urban = originalUrban;
const courts = courtFixture.group.userData.proceduralSurfaces.filter(p => p.sub === 'court');
assert.ok(courts.length, 'Fixture must exercise a deployed court');
const hoops = [];
for (const mesh of courtFixture.group.children.filter(m => m.userData.proceduralGroundPart?.type === 'hoop')) {
  for (let i = 0; i < mesh.count; i++) {
    const matrix = new THREE.Matrix4(); mesh.getMatrixAt(i, matrix);
    hoops.push({ position: new THREE.Vector3().setFromMatrixPosition(matrix),
      facing: new THREE.Vector3(0, 0, 1).transformDirection(matrix) });
  }
}
for (const court of courts) for (const side of [-1, 1]) {
  const x = court.x + side * court.width * .42 * Math.cos(court.rot);
  const z = court.z + side * court.width * .42 * Math.sin(court.rot);
  const hoop = hoops.find(h => Math.hypot(h.position.x - x, h.position.z - z) < 1e-4);
  assert.ok(hoop, 'Both end hoops must be deployed');
  const towardCenter = new THREE.Vector3(court.x - x, 0, court.z - z).normalize();
  assert.ok(hoop.facing.dot(towardCenter) > .999, 'Hoops must face the court center');
}
console.log(`PASS: ${Object.keys(SURFACES).length} surfaces, ${Object.keys(GROUND_PARTS).length} procedural parts; flat deployment ${a.stats.patches} patches / ${a.stats.details} details; slope constraints and determinism.`);
const trackPath = [];
stadiumPath(context(trackPath), TRACK.straight, TRACK.radius);
assert.equal(trackPath.filter(c => c[0] === 'lineTo').length, 2);
const bends = trackPath.filter(c => c[0] === 'arc');
assert.equal(bends.length, 2);
for (const bend of bends) {
  assert.equal(bend[3], TRACK.radius);
  assert.ok(Math.abs(bend[5] - bend[4] - Math.PI) < 1e-12);
}
for (const [id, venue] of Object.entries(VENUES)) {
  assert.ok(ZONES.urban.includes(id));
  assert.equal(SURFACES[id].aspect, venue.width / venue.length);
  assert.equal(probeSurface(x => 10 + x * .1, 0, 0, 15, 0, DEFS[id], SURFACES[id]), false);
  assert.equal(GROUND_ATTACHMENTS[id].referenceWidth, venue.length / .8);
}
for (const id of ['latinPlaza', 'mediterraneanPlaza', 'southAsianMaidan', 'nordicSquare']) {
  const commands = []; paintVenue(context(commands), id);
  assert.equal(commands.filter(c => ['lineTo', 'strokeRect'].includes(c[0])).length, 0, `${id} has no invented grid`);
}
for (const id of ['tennis', 'soccer', 'cricket', 'taiwanTemple']) {
  ZONES.urban = [id];
  const fixture = build();
  ZONES.urban = originalUrban;
  assert.ok(fixture.group.userData.proceduralSurfaces.some(p => p.sub === id), `${id} deploys`);
  for (const type of SURFACES[id].parts) assert.ok(fixture.group.children.some(m => m.userData.proceduralGroundPart?.type === type), `${id} equipment ${type} deploys`);
}
// Include the outer stroke, not only its centre line, in the visibility envelope.
const outerTrack = TRACK.radius + TRACK.lanes * TRACK.lane + TRACK.lineWidth / 2;
assert.ok((TRACK_WIDTH / 2 - TRACK.straight / 2 - outerTrack) / TRACK_WIDTH > .05);
assert.ok((TRACK_DEPTH / 2 - outerTrack) / TRACK_DEPTH > .05);
for (const [id, spec] of Object.entries(LANDSCAPES)) {
  for (const zone of spec.zones || [spec.zone]) assert.ok(ZONES[zone].includes(id));
  assert.ok(probeSurface(x => 20 + x * .1, 0, 0, 12, .5, DEFS[id], SURFACES[id]), `${id} follows slopes`);
  assert.ok(GROUND_ATTACHMENTS[id].scatter);
}
for (const zone of ['green', 'bare']) {
  const saved = ZONES[zone];
  // Urban fixture classification lets us test candidate deployment without duplicating the builder.
  ZONES.urban = Object.keys(LANDSCAPES).filter(id => LANDSCAPES[id].zone === zone);
  const result = build(); ZONES.urban = originalUrban;
  assert.ok(result.group.userData.proceduralSurfaces.some(p => LANDSCAPES[p.sub]), `${zone} additions deploy`);
  assert.equal(ZONES[zone], saved);
}
for (const zone of ['green', 'bare']) {
  const natural = Object.keys(LANDSCAPES).filter(id => LANDSCAPES[id].zone === zone);
  const visitor = Object.values(VISITOR_SITES).filter(site => site.zone === zone);
  assert.equal(visitor.length, natural.length, `${zone}: equal natural and visitor additions`);
  assert.deepEqual(visitor.map(site => site.naturalCounterpart).sort(), natural.sort(), 'One unique counterpart per natural addition');
}
for (const [id, site] of Object.entries(VISITOR_SITES)) {
  assert.ok(ZONES[site.zone].includes(id));
  assert.equal(probeSurface(x => 20 + x * .1, 0, 0, 14, 0, DEFS[id], SURFACES[id]), false, 'Facility pads require stable ground');
  ZONES.urban = [id];
  const fixture = build(); ZONES.urban = originalUrban;
  // Alpine/cold variants need a matching climate; other sites must deploy in this temperate fixture.
  if (surfaceAllowed(id, surfaceEnvironment({ latitude: 25, altitude: 150, season: 'summer' }))) {
    assert.ok(fixture.group.userData.proceduralSurfaces.some(p => p.sub === id), `${id} deploys`);
    for (const part of SURFACES[id].parts) assert.ok(fixture.group.children.some(m => m.userData.proceduralGroundPart?.type === part), `${id}: ${part} deploys`);
  }
}
