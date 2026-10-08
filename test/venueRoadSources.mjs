import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT } from '../tools/audit_src.mjs';
import { loadElevationFixture, fixtureElevationSampler, osmMapRoadResponse, osmFixtureFiles, readOsmCapture } from '../tools/osm_fixture.mjs';
import { VENUES, venueAvailability } from '../public/js/venues.js';
import { MAP_ROAD_PROFILE, mapGeometryAudit } from '../public/js/mapRules.js';
import { xzToLL, sideMFor } from '../public/js/data.js';
import { VENUE_GRID } from '../public/js/venueGrid.js';
import { traceRoadEvidence, roadFingerprint, makeTerrainAssessment, validTerrainAssessment } from '../public/js/roadEvidence.js';

const captures = new Map();
for (const directory of ['osm', 'venue_roads'].map(n => join(ROOT, 'test', 'fixtures', n))) {
  for (const name of osmFixtureFiles(directory)) {
    const { data, sha256 } = readOsmCapture(join(directory, name));
    if (!data.responses?.roads?.elements) continue;
    captures.set(sha256, { directory, name: data.name, ways: data.responses.roads.elements, bbox: data.bbox });
  }
}
function replayTerrain(cfg, capture) {
  const id = cfg.venue.id;
  const elevation = fixtureElevationSampler(loadElevationFixture(capture.name, join(capture.directory, 'elevation')));
  const checked = makeTerrainAssessment(cfg, (x, z) => {
    const [lat, lng] = xzToLL(x, z, cfg.center), box = capture.bbox;
    assert(lat >= box.minLat && lat <= box.maxLat && lng >= box.minLng && lng <= box.maxLng,
      id + ': every lane remains inside the captured relief');
    return elevation(lat, lng);
  });
  assert(checked.verified);
  assert.equal(checked.samples.length, cfg.roadTerrain.samples.length);
  for (let i = 0; i < checked.samples.length; i++) {
    assert(Math.abs(checked.samples[i] - cfg.roadTerrain.samples[i]) < 1e-5,
      id + ': relief sample agrees with preserved tiles/grid');
  }
  assert(Math.abs(checked.maxGrade - cfg.roadTerrain.maxGrade) <= 1e-6);
  return checked;
}
let maps = 0, lanes = 0;
for (const venue of VENUES) {
  const admitted = venueAvailability(venue);
  if (!admitted.available) continue;
  const cfg = admitted.cfg;
  let capture;
  for (const [i, proof] of cfg.roadSources.entries()) {
    if (proof.kind === 'synthetic') continue;
    capture = captures.get(proof.source.sha256);
    assert(capture, venue.id + ': archived capture checksum');
    const ways = cfg.roadMode === 'natural-hybrid'
      ? capture.ways.filter(w => MAP_ROAD_PROFILE.test(w.tags?.highway || '')) : capture.ways;
    assert.equal(proof.source.fingerprint, roadFingerprint(ways));
    assert.deepEqual(traceRoadEvidence(cfg.motherLanes[i], ways, { source: proof.source }), proof,
      venue.id + ': exact source path and way ownership replay');
    lanes++;
  }
  replayTerrain(cfg, capture);
  maps++;
}
const report = JSON.parse(readFileSync(join(ROOT, 'test', 'fixtures', 'venue_roads', 'natural-qualification-report.json'), 'utf8'));
assert.equal(report.version, 1);
assert.deepEqual(report.reports.map(r => r.id), ['taroko', 'todra']);
for (const row of report.reports) {
  const venue = VENUES.find(v => v.id === row.id), candidate = row.leastGradeCandidate;
  assert.equal(row.status, 'pending');
  assert(!venueAvailability(venue).available);
  const capture = captures.get(row.source.sha256);
  assert(capture, row.id + ': failed search retains its exact source');
  const ways = capture.ways.filter(w => MAP_ROAD_PROFILE.test(w.tags?.highway || ''));
  assert.equal(row.source.fingerprint, roadFingerprint(ways));
  assert.deepEqual(row.bbox, capture.bbox);
  assert.deepEqual(traceRoadEvidence(candidate.lanes[1], ways, { source: row.source }), candidate.middleProof);
  assert(candidate.middleProof);
  const [a, b] = candidate.bases;
  const cfg = { center: { lat: (a[0] + b[0]) / 2, lng: (a[1] + b[1]) / 2,
    rot: (VENUE_GRID[row.id] || 0) * Math.PI / 180 },
    bases: { SWARM: a, STEEL: b }, lanes: candidate.lanes, motherLanes: candidate.lanes,
    laneCount: 3, laneIds: [0, 1, 2], sizeM: sideMFor(3), venue,
    roadTerrain: candidate.roadTerrain };
  assert(mapGeometryAudit(cfg, 5).ok, 'the retained rejection passes geometry');
  const checked = replayTerrain(cfg, capture);
  assert(!validTerrainAssessment(cfg), 'complete relief still rejects the retained steep candidate');
  assert(Math.abs(Math.atan(checked.maxGrade) * 180 / Math.PI - row.leastCompleteGradeDeg) < 1e-6);
  assert.equal(row.geometryQualified, row.rejected.grade + row.rejected.missingRelief);
}
const raw = { elements: [
  { type: 'node', id: 1, lat: 25, lon: 121 }, { type: 'node', id: 2, lat: 25.001, lon: 121 },
  { type: 'way', id: 3, nodes: [1, 2], tags: { highway: 'primary' } },
  { type: 'way', id: 4, nodes: [2, 99], tags: { highway: 'primary' } },
] };
const parsed = osmMapRoadResponse(raw);
assert.deepEqual(parsed.elements.map(e => e.id), [3], 'a missing source node omits the whole road');
assert.deepEqual(parsed.elements[0].nodes, [1, 2]);
assert.deepEqual(parsed.elements[0].geometry, [{ lat: 25, lon: 121 }, { lat: 25.001, lon: 121 }]);
console.log(`PASS venue source replay: ${maps} admitted maps, ${lanes} real lanes, ${report.reports.length} steep rejection replays, raw-capture checksums, exact way paths, preserved relief and missing-node omission.`);
