// Frozen lane proofs retain connected source paths and way ownership; absent data stays unverified.
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT } from './audit_src.mjs';
import { VENUE_LANES } from '../public/js/venueLanes.js';
import { traceRoadEvidence, roadFingerprint, makeTerrainAssessment } from '../public/js/roadEvidence.js';
import { loadElevationFixture, fixtureElevationSampler, osmFixtureFiles, readOsmCapture } from './osm_fixture.mjs';
import { llToXZ, xzToLL } from '../public/js/data.js';

const directories = ['osm', 'venue_roads'].map(name => join(ROOT, 'test', 'fixtures', name));
const fixtures = directories.flatMap(directory => osmFixtureFiles(directory).map(name => {
  const { data, sha256 } = readOsmCapture(join(directory, name));
  return { data, directory, sha256 };
})).filter(({ data }) => data.team === 5 && Array.isArray(data.responses?.roads?.elements));
const result = {}, terrain = {};
for (const [id, entries] of Object.entries(VENUE_LANES)) {
  for (const key of ['3', 'm1']) {
    const entry = entries[key];
    if (!entry) continue;
    for (const { data, directory, sha256 } of fixtures.filter(f => f.data.venue?.id === id)) {
      const ways = data.responses.roads.elements;
      const source = { provider: data.source.roads, version: `osm-query-${data.queries.roads.version}`,
        capturedAt: data.capturedAt, fingerprint: roadFingerprint(ways), sha256 };
      const proofs = entry.lanes.map(lane => traceRoadEvidence(lane, ways, { source }));
      if (proofs.every(Boolean)) {
        (result[id] ||= {})[key] = proofs;
        try {
          const elevation = fixtureElevationSampler(loadElevationFixture(data.name, join(directory, 'elevation')));
          const center = { lat: (entry.bases[0][0] + entry.bases[1][0]) / 2, lng: (entry.bases[0][1] + entry.bases[1][1]) / 2, rot: 0 };
          (terrain[id] ||= {})[key] = makeTerrainAssessment({ center, lanes: entry.lanes },
            (x, z) => {
              const [lat, lng] = xzToLL(x, z, center), box = data.bbox;
              return lat < box.minLat || lat > box.maxLat || lng < box.minLng || lng > box.maxLng
                ? null : elevation(lat, lng);
            });
        } catch { /* Missing elevation leaves the road assessment pending. */ }
        break;
      }
    }
  }
}
writeFileSync(join(ROOT, 'public', 'js', 'venueRoadEvidence.js'),
  '// Generated from versioned raw OSM fixtures by tools/bake_road_evidence.mjs.\n'
  + 'export const VENUE_ROAD_EVIDENCE = ' + JSON.stringify(result) + ';\n'
  + 'export const VENUE_ROAD_TERRAIN = ' + JSON.stringify(terrain) + ';\n');
console.log('Verified bundled road paths: ' + Object.entries(result).map(([id, keys]) => id + ':' + Object.keys(keys).join(',')).join(' '));
