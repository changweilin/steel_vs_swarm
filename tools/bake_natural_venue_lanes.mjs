// Only source-proven middle roads and terrain-qualified deterministic flanks enter the catalogue.
import { writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { ROOT } from './audit_src.mjs';
import { buildGraph, dijkstra } from './road_graph.mjs';
import { loadElevationFixture, fixtureElevationSampler, osmFixtureFiles, readOsmCapture } from './osm_fixture.mjs';
import { VENUES, venueAvailability, synthLane } from '../public/js/venues.js';
import { VENUE_NATURAL_LANES } from '../public/js/venueNaturalLanes.js';
import { VENUE_GRID } from '../public/js/venueGrid.js';
import { MAPGEO, llToXZ, xzToLL, realDistFor, sideMFor } from '../public/js/data.js';
import { MAP_ROAD_PROFILE, mapGeometryAudit, naturalRoadBiome } from '../public/js/mapRules.js';
import { traceRoadEvidence, roadFingerprint, syntheticLaneEvidence, makeTerrainAssessment, validTerrainAssessment } from '../public/js/roadEvidence.js';

const only = new Set(process.argv.slice(2).filter(arg => !arg.startsWith('--')));
const diagnostic = process.argv.includes('--diagnostic');
const reportPath = process.argv.find(arg => arg.startsWith('--report='))?.slice('--report='.length);
const limits = { anchors: 48, targets: 2, salts: 16 };
for (const [key, maximum] of Object.entries({ anchors: 512, targets: 16, salts: 64 })) {
  const text = process.argv.find(arg => arg.startsWith(`--${key}=`))?.slice(key.length + 3);
  if (text == null) continue;
  const value = Number(text);
  if (!Number.isInteger(value) || value < 1 || value > maximum) throw new Error(`--${key} must be 1..${maximum}`);
  limits[key] = value;
}
for (const id of only) if (!VENUES.some(v => v.id === id)) throw new Error('Unknown venue: ' + id);
const reports = [];
const directory = join(ROOT, 'test', 'fixtures', 'venue_roads');
const captures = osmFixtureFiles(directory).map(n => {
  const { data, sha256 } = readOsmCapture(join(directory, n));
  return { data, sha256 };
});
const result = { ...VENUE_NATURAL_LANES };
for (const venue of VENUES.filter(v => !only.size || only.has(v.id))) {
  const biome = naturalRoadBiome(venue.mix);
  if (!biome) continue;
  const existing = venueAvailability(venue);
  if (existing.available && existing.cfg.roadMode === 'real') continue;
  const capture = captures.find(c => c.data.venue?.id === venue.id);
  if (!capture) { console.log(venue.id + ': pending road capture'); continue; }
  const { data, sha256 } = capture;
  let elevation;
  try { elevation = fixtureElevationSampler(loadElevationFixture(data.name, join(directory, 'elevation'))); }
  catch { console.log(venue.id + ': pending relief capture'); continue; }
  const ways = data.responses.roads.elements.filter(w => MAP_ROAD_PROFILE.test(w.tags?.highway || ''));
  const g = buildGraph(ways, [data.center.lat, data.center.lng]);
  const anchor = llToXZ(...venue.ll, data.center).map(v => v * MAPGEO.REAL_SCALE);
  const rows = Array.from({ length: g.n }, (_, i) => ({ i,
    distance: Math.hypot(g.X[i] - anchor[0], -g.Z[i] - anchor[1]) }));
  rows.sort((a, b) => a.distance - b.distance || a.i - b.i);
  const cells = new Set(), anchors = [];
  for (const row of rows) {
    const key = Math.floor(g.X[row.i] / 45) + ',' + Math.floor(g.Z[row.i] / 45);
    if (cells.has(key)) continue;
    cells.add(key); anchors.push(row.i);
    if (anchors.length === limits.anchors) break;
  }
  const target = realDistFor(3), minimum = target * MAPGEO.MIN_DIST_FRAC / MAPGEO.BASE_DIST_FRAC;
  const source = { provider: data.source.roads, version: data.queries.roads.version,
    capturedAt: data.capturedAt, fingerprint: roadFingerprint(ways), sha256 };
  let best = null, checked = 0, geometryQualified = 0, leastGrade = Infinity, leastGradeCandidate = null;
  const rejected = {};
  for (const a of anchors) {
    const bins = Array.from({ length: 12 }, () => []);
    for (let b = 0; b < g.n; b++) {
      if (g.component[a] !== g.component[b]) continue;
      const dx = g.X[b] - g.X[a], dz = g.Z[b] - g.Z[a], distance = Math.hypot(dx, dz);
      if (distance < minimum || distance > target * 1.15) continue;
      const bin = Math.floor((Math.atan2(dz, dx) + Math.PI) / (2 * Math.PI) * bins.length) % bins.length;
      bins[bin].push({ b, error: Math.abs(distance - target) });
    }
    const ends = bins.flatMap(bin => bin.sort((p, q) => p.error - q.error || p.b - q.b).slice(0, limits.targets));
    for (const { b } of ends) {
      checked++;
      const path = dijkstra(g, a, b, new Set(), null);
      if (!path) continue;
      const middle = path.map(i => [g.LA[i], g.LN[i]]), A = middle[0], B = middle.at(-1);
      const center = { lat: (A[0] + B[0]) / 2, lng: (A[1] + B[1]) / 2,
        rot: (VENUE_GRID[venue.id] || 0) * Math.PI / 180 };
      const sampler = (x, z) => {
        const [lat, lng] = xzToLL(x, z, center), box = data.bbox;
        return lat < box.minLat || lat > box.maxLat || lng < box.minLng || lng > box.maxLng ? null : elevation(lat, lng);
      };
      for (let salt = 0; salt < limits.salts; salt++) {
        const mother = [synthLane(A, B, 1, salt), middle, synthLane(A, B, -1, salt)];
        const cfg = { center, bases: { SWARM: A, STEEL: B }, lanes: mother, motherLanes: mother,
          laneCount: 3, laneIds: [0, 1, 2], sizeM: sideMFor(3), venue: { mix: venue.mix } };
        const audit = mapGeometryAudit(cfg, 5);
        if (!audit.ok) { rejected[audit.code] = (rejected[audit.code] || 0) + 1; continue; }
        geometryQualified++;
        cfg.roadTerrain = makeTerrainAssessment(cfg, sampler);
        if (cfg.roadTerrain.verified && cfg.roadTerrain.maxGrade < leastGrade) {
          leastGrade = cfg.roadTerrain.maxGrade;
          leastGradeCandidate = { bases: [[...A], [...B]], lanes: mother, salt,
            roadTerrain: cfg.roadTerrain, middleProof: traceRoadEvidence(middle, ways, { source }) };
        }
        if (!validTerrainAssessment(cfg)) {
          const why = cfg.roadTerrain.verified ? 'grade' : 'missingRelief';
          rejected[why] = (rejected[why] || 0) + 1; continue;
        }
        const times = cfg.roadTerrain.times, timeError = Math.abs(times[0] - times[2]) / Math.max(...times);
        const distance = Math.hypot(...llToXZ(center.lat, center.lng, data.center)) * MAPGEO.REAL_SCALE;
        const score = audit.metrics.maxOverlap + timeError + distance / (target * 10);
        if (best && score >= best.score) break;
        const proof = traceRoadEvidence(middle, ways, { source });
        if (!proof) break;
        best = { score, biome, bases: [[...A], [...B]], lanes: mother,
          roadSources: [syntheticLaneEvidence(mother[0]), proof, syntheticLaneEvidence(mother[2])],
          roadTerrain: cfg.roadTerrain, salt };
        break;
      }
    }
  }
  reports.push({ id: venue.id, status: best ? 'qualified' : 'pending', source,
    captureCenter: data.center, bbox: data.bbox, search: { ...limits, actualAnchors: anchors.length },
    endpointPairs: checked, geometryQualified, rejected,
    leastCompleteGradeDeg: Number.isFinite(leastGrade) ? Math.atan(leastGrade) * 180 / Math.PI : null,
    leastGradeCandidate });
  if (best) {
    const { score, ...entry } = best;
    result[venue.id] = entry;
    console.log(venue.id + ': qualified one road + two generated lanes; ' + checked + ' endpoint pairs; grade '
      + (Math.atan(entry.roadTerrain.maxGrade) * 180 / Math.PI).toFixed(1) + '°');
  } else console.log(venue.id + ': pending; no terrain-qualified layout in ' + checked + ' endpoint pairs; ' + JSON.stringify(rejected));
}
if (reportPath) writeFileSync(resolve(reportPath), JSON.stringify({ version: 1, reports }, null, 2) + '\n');
if (!diagnostic) writeFileSync(join(ROOT, 'public', 'js', 'venueNaturalLanes.js'),
  '// Generated by tools/bake_natural_venue_lanes.mjs from captured OSM roads and relief.\n'
  + 'export const VENUE_NATURAL_LANES = ' + JSON.stringify(result) + ';\n');
