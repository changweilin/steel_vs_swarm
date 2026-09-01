// ============ 真實高程 fixture 捕獲 CLI =============
// 人工更新專用：下載 AWS Terrain Tiles，保留原始 PNG 與其 SHA-256，再烘成
// runtime 同形的 193×193 raw world-z-x 網格。任何網路／PNG／契約失敗都退出 2；
// 不得用 open-meteo、平地或程序噪聲補洞。
import { resolve } from 'node:path';
import { VENUES, venueConfig } from '../public/js/venues.js';
import { battleBBox, battleRect } from '../public/js/data.js';
import {
  DEFAULT_FIXTURE_DIR, elevationDirForFixtureDir, elevationWorldBounds, loadOsmFixture,
} from './osm_fixture.mjs';
import { captureElevationFixture } from './elevation_fixture.mjs';

const argv = Object.fromEntries(process.argv.slice(2).map((arg) => {
  const m = /^--([^=]+)(?:=(.*))?$/.exec(arg);
  return m ? [m[1], m[2] ?? '1'] : ['_', arg];
}));
const value = (key, fallback = null) => argv[key] ?? fallback;
const has = (key) => Object.prototype.hasOwnProperty.call(argv, key);

function fail(message) {
  console.error('❌ ' + message);
  process.exit(2);
}

function parseBbox(text) {
  if (!text) return null;
  const parts = String(text).split(',').map(Number);
  if (parts.length !== 4 || !parts.every(Number.isFinite)) return null;
  const [minLat, minLng, maxLat, maxLng] = parts;
  return maxLat > minLat && maxLng > minLng ? { minLat, minLng, maxLat, maxLng } : null;
}

function parseCenter(text) {
  if (!text) return null;
  const parts = String(text).split(',').map(Number);
  if (parts.length < 2 || parts.length > 3 || !parts.slice(0, 2).every(Number.isFinite)) return null;
  return { lat: parts[0], lng: parts[1], rot: Number.isFinite(parts[2]) ? parts[2] : 0 };
}

function copyBbox(value) {
  return value && {
    minLat: Number(value.minLat), minLng: Number(value.minLng),
    maxLat: Number(value.maxLat), maxLng: Number(value.maxLng),
  };
}

function copyCenter(value) {
  return value && { lat: Number(value.lat), lng: Number(value.lng), rot: Number(value.rot ?? 0) };
}

const name = value('name');
if (!name) fail('缺少 --name <fixture-name>');
if (!/^[a-z0-9][a-z0-9_-]*$/i.test(String(name))) fail('--name 只能含英數、底線與連字號');

const fixtureDir = resolve(value('fixture-dir', DEFAULT_FIXTURE_DIR));
const osm = loadOsmFixture(name, fixtureDir);
const requestedVenue = value('venue');
const venueId = requestedVenue || osm?.venue?.id || null;
const venue = VENUES.find((item) => item.id === venueId) || null;
const team = Number(value('team', osm?.team ?? 5));
const cfg = venue ? venueConfig(venue, team) : null;
const bbox = parseBbox(value('bbox')) || copyBbox(osm?.bbox) || (cfg ? battleBBox(cfg) : null);
const center = parseCenter(value('center')) || copyCenter(osm?.center) || copyCenter(cfg?.center);
if (!bbox) fail('未知場地必須提供 --bbox minLat,minLng,maxLat,maxLng，或先建立同名 OSM fixture');
if (!center) fail('未知場地必須提供 --center lat,lng[,rot]，或先建立同名 OSM fixture');
if (osm) {
  const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
  if (!same(bbox, copyBbox(osm.bbox)) || !same(center, copyCenter(osm.center))
    || Number(osm.team) !== team) {
    fail('高程捕獲的 bbox/center/team 必須與同名 OSM fixture 完全相同');
  }
}
const bounds = cfg ? battleRect(cfg) : elevationWorldBounds(bbox, center);
const outputDir = resolve(value('elevation-dir', elevationDirForFixtureDir(fixtureDir)));
const timeoutMs = Math.max(5000, Math.min(120000, Number(value('timeout', '45000')) || 45000));

console.log('捕獲真實 Terrarium 高程：' + name);
console.log('  bbox=' + JSON.stringify(bbox) + ' center=' + JSON.stringify(center)
  + ' team=' + team + ' output=' + outputDir);
try {
  const result = await captureElevationFixture({
    name, venue: venue ? {
      id: venue.id, name: venue.name, type: venue.type, country: venue.country,
    } : (osm?.venue || null),
    team, bbox, center, bounds, outputDir, timeoutMs, update: has('update'),
  });
  console.log('✅ 已寫入 ' + result.path + ' (' + result.fixture.stats.tileCount + ' tiles, '
    + result.fixture.stats.points + ' points, '
    + result.fixture.stats.minM.toFixed(2) + '…' + result.fixture.stats.maxM.toFixed(2) + 'm)');
} catch (error) {
  fail(error.message);
}
