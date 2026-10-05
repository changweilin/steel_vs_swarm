// Frozen lane proofs retain connected source paths and way ownership; absent data stays unverified.
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { ROOT } from './audit_src.mjs';
import { VENUE_LANES } from '../public/js/venueLanes.js';
import { traceRoadEvidence, roadFingerprint, makeTerrainAssessment } from '../public/js/roadEvidence.js';
import { loadElevationFixture, fixtureElevationSampler } from './osm_fixture.mjs';
import { llToXZ, xzToLL } from '../public/js/data.js';

const directory = join(ROOT, 'test', 'fixtures', 'osm');
const fixtures = readdirSync(directory).filter(name => name.endsWith('.json')).map(name => {
  const bytes = readFileSync(join(directory, name));
  const data = JSON.parse(bytes);
  return { data, sha256: createHash('sha256').update(bytes).digest('hex') };
}).filter(({ data }) => data.team === 5 && Array.isArray(data.responses?.roads?.elements));
const result = {}, terrain = {};
for (const [id, entries] of Object.entries(VENUE_LANES)) {
  for (const key of ['3', 'm1']) {
    const entry = entries[key];
    if (!entry) continue;
    for (const { data, sha256 } of fixtures.filter(f => f.data.venue?.id === id)) {
      const ways = data.responses.roads.elements;
      const source = { provider: data.source.roads, version: `osm-query-${data.queries.roads.version}`,
        capturedAt: data.capturedAt, fingerprint: roadFingerprint(ways), sha256 };
      const proofs = entry.lanes.map(lane => traceRoadEvidence(lane, ways, { source }));
      if (proofs.every(Boolean)) {
        (result[id] ||= {})[key] = proofs;
        try {
          const elevation = fixtureElevationSampler(loadElevationFixture(data.name));
          const center = { lat: (entry.bases[0][0] + entry.bases[1][0]) / 2, lng: (entry.bases[0][1] + entry.bases[1][1]) / 2, rot: 0 };
          (terrain[id] ||= {})[key] = makeTerrainAssessment({ center, lanes: entry.lanes },
            (x, z) => elevation(...xzToLL(x, z, center)));
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
