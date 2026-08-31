// ============ 固定 OSM fixture 共用讀取縫 ============
// fixture 保留 Overpass 原始 response；這裡只負責路徑、基本契約與正式 parser
// 的接線。抓取器與離線 audit 不得各自發明 payload 形狀。
import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { osmFeatureQuery, osmRoadQuery, parseOsmFeatureElements, osmRoadsFromElements } from '../public/js/osmQuery.js';

export const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));
export const DEFAULT_FIXTURE_DIR = join(ROOT, 'test', 'fixtures', 'osm');
export const FIXTURE_VERSION = 1;

export function fixtureNameOf(name) {
  return /^[a-z0-9][a-z0-9_-]*$/i.test(String(name || '')) ? String(name) : null;
}

export function fixturePath(name, dir = DEFAULT_FIXTURE_DIR) {
  const safe = fixtureNameOf(name);
  return safe ? join(resolve(dir), `${safe}.json`) : null;
}

export function loadOsmFixture(name, dir = DEFAULT_FIXTURE_DIR) {
  const path = fixturePath(name, dir);
  if (!path || !existsSync(path)) return null;
  const fixture = JSON.parse(readFileSync(path, 'utf8'));
  if (fixture?.version !== FIXTURE_VERSION || fixture?.name !== name) return null;
  return fixture;
}

export function loadOsmFixtureForVenue(venueId, names = new Set(), dir = DEFAULT_FIXTURE_DIR) {
  const candidates = names.size ? [...names] : [venueId];
  for (const name of candidates) {
    const fixture = loadOsmFixture(name, dir);
    if (fixture && (fixture.venue?.id === venueId || name === venueId)) return fixture;
  }
  return null;
}

export function fixtureResponses(fixture) {
  const features = fixture?.responses?.features;
  const roads = fixture?.responses?.roads;
  if (!Array.isArray(features?.elements) || !Array.isArray(roads?.elements)) return null;
  return { features, roads };
}

export function fixtureQueries(fixture) {
  const bbox = fixture?.bbox;
  return bbox ? { features: osmFeatureQuery(bbox), roads: osmRoadQuery(bbox) } : { features: null, roads: null };
}

/** 將 raw fixture 接到與執行期相同的場地結構消費端。 */
export function fixtureOsm(fixture) {
  const responses = fixtureResponses(fixture);
  if (!responses) return null;
  const features = parseOsmFeatureElements(responses.features.elements);
  const roads = osmRoadsFromElements(responses.roads.elements);
  return {
    src: 'fixture',
    roads,
    rails: features.pointFeatures.rails,
    waters: features.pointFeatures.waters,
    boundaries: features.pointFeatures.boundaries,
    crossings: features.pointFeatures.crossings,
    falls: features.pointFeatures.falls,
    pois: features.pointFeatures.pois,
    entrances: features.pointFeatures.entrances,
    features,
  };
}
