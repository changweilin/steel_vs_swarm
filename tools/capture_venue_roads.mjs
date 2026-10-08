// Preserve the original OSM map response and Terrarium relief for bounded offline venue searches.
import { mkdirSync, writeFileSync, existsSync, renameSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { gzipSync } from 'node:zlib';
import { ROOT } from './audit_src.mjs';
import { VENUES, venueConfig } from '../public/js/venues.js';
import { battleBBox } from '../public/js/data.js';
import { MAP_ROAD_PROFILE } from '../public/js/mapRules.js';
import { captureElevationFixture } from './elevation_fixture.mjs';
import { elevationWorldBounds, osmMapRoadResponse } from './osm_fixture.mjs';

const directory = join(ROOT, 'test', 'fixtures', 'venue_roads');
const ids = process.argv.slice(2).filter(id => !id.startsWith('--'));
const update = process.argv.includes('--update');
const centerArg = process.argv.find(a => a.startsWith('--center='))?.split('=')[1]?.split(',').map(Number);
const radiusText = process.argv.find(a => a.startsWith('--radius='))?.split('=')[1];
const radiusArg = radiusText == null ? null : Number(radiusText);
if (centerArg && (centerArg.length !== 2 || !centerArg.every(Number.isFinite)
  || Math.abs(centerArg[0]) >= 85 || Math.abs(centerArg[1]) > 180)) throw new Error('Invalid source center');
if (radiusArg != null && (!Number.isFinite(radiusArg) || radiusArg < 300 || radiusArg > 1500)) throw new Error('Capture radius must be 300..1500 real meters');
if (!ids.length) throw new Error('Provide one or more catalogue venue IDs');
mkdirSync(directory, { recursive: true });

async function captureMap(bbox, depth = 0) {
  const url = 'https://api.openstreetmap.org/api/0.6/map.json?bbox=' + [bbox.minLng, bbox.minLat, bbox.maxLng, bbox.maxLat].join(',');
  const response = await fetch(url, { signal: AbortSignal.timeout(20000),
    headers: { 'User-Agent': 'steel-vs-swarm-venue-road-capture/1.0' } });
  if (response.ok) return { raw: await response.json(), urls: [url] };
  const reason = await response.text();
  if (response.status !== 400 || !/too many nodes/i.test(reason) || depth >= 2) {
    throw new Error('OSM HTTP ' + response.status + ': ' + reason.slice(0,100));
  }
  const lat = (bbox.minLat + bbox.maxLat) / 2, lng = (bbox.minLng + bbox.maxLng) / 2;
  const parts = [];
  for (const [minLat, maxLat] of [[bbox.minLat, lat], [lat, bbox.maxLat]]) {
    for (const [minLng, maxLng] of [[bbox.minLng, lng], [lng, bbox.maxLng]]) {
      parts.push(await captureMap({ minLat, maxLat, minLng, maxLng }, depth + 1));
    }
  }
  const elements = new Map();
  for (const part of parts) for (const element of part.raw.elements) {
    const key = element.type + '/' + element.id, old = elements.get(key);
    if (!old || element.version > old.version) elements.set(key, element);
  }
  return { raw: { ...parts[0].raw, elements: [...elements.values()], parts: parts.map(p => p.raw) },
    urls: parts.flatMap(p => p.urls) };
}

let failures = 0;
for (const id of ids) {
  try {
    const venue = VENUES.find(v => v.id === id);
    if (!venue) throw new Error('Unknown venue: ' + id);
    const path = join(directory, id + '.json.gz');
    const legacyPath = join(directory, id + '.json');
    if ((existsSync(path) || existsSync(legacyPath)) && !update) { console.log(id + ': retained existing capture'); continue; }
    const cfg = venueConfig(venue, 5);
    let bbox = battleBBox(cfg);
    if (centerArg || radiusArg) {
      const lat = centerArg?.[0] ?? cfg.center.lat, lng = centerArg?.[1] ?? cfg.center.lng;
      const dLat = (radiusArg || 800) / 6371000 * 180 / Math.PI, dLng = dLat / Math.cos(lat * Math.PI / 180);
      bbox = { minLat: lat - dLat, maxLat: lat + dLat, minLng: lng - dLng, maxLng: lng + dLng };
    }
    const center = { lat: (bbox.minLat + bbox.maxLat) / 2, lng: (bbox.minLng + bbox.maxLng) / 2, rot: 0 };
    const { raw, urls } = await captureMap(bbox), roads = osmMapRoadResponse(raw);
    if (!roads.elements.some(way => MAP_ROAD_PROFILE.test(way.tags?.highway || ''))) throw new Error('No driving-profile roads');
    const archive = gzipSync(Buffer.from(JSON.stringify({ version: 1, schema: 'venue-road-fixture-v1', name: id, team: 5,
      venue: { id, name: venue.name }, center, bbox, capturedAt: new Date().toISOString(),
      source: { roads: 'https://api.openstreetmap.org/api/0.6/map.json', urls },
      queries: { roads: { version: 'osm-map-json-0.6', text: urls.join('\n') } },
      responses: { osmMap: raw, roads } }) + '\n'), { level: 9 });
    const elevation = await captureElevationFixture({ name: id, venue, team: 5, bbox, center,
      bounds: elevationWorldBounds(bbox, center), outputDir: join(directory, 'elevation'), timeoutMs: 20000, update });
    // A failed relief request must not replace an existing complete source pair.
    writeFileSync(path + '.tmp', archive);
    renameSync(path + '.tmp', path);
    if (existsSync(legacyPath)) unlinkSync(legacyPath);
    console.log(id + ': captured ' + roads.elements.length + ' roads, ' + elevation.fixture.stats.tileCount + ' relief tiles');
  } catch (error) { failures++; console.error(id + ': ' + error.message); }
}
process.exitCode = failures ? 1 : 0;
