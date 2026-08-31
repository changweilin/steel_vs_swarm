// ============ 真實 Overpass fixture 抓取器 ============
// 只在人工更新時使用；CI／正式回歸不得依賴網路。查詢與執行期共用
// public/js/osmQuery.js，保存完整 raw response 以便日後追查 source ID、tags、relation members。
// 用法：
//   node tools/fetch_osm_fixture.mjs --name taipei_dense
//   node tools/fetch_osm_fixture.mjs --name campus --bbox 25.012,121.535,25.020,121.548 --update
import { existsSync, mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { VENUES, venueConfig } from '../public/js/venues.js';
import { battleBBox } from '../public/js/data.js';
import {
  bboxKm2, OSM_FEATURE_QUERY_VERSION, OSM_ROAD_QUERY_VERSION,
  osmFeatureQuery, osmFeatureQuotas, osmRoadQuery, osmRoadQuotas,
} from '../public/js/osmQuery.js';
import { DEFAULT_FIXTURE_DIR, FIXTURE_VERSION, fixturePath } from './osm_fixture.mjs';

const MIRRORS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
  'https://maps.mail.ru/osm/tools/overpass/api/interpreter',
];
const UA = 'steel-vs-swarm-osm-fixture/1.0 (maintainer-updated regression data)';
const argv = process.argv.slice(2);
const value = (key, fallback = null) => {
  const i = argv.indexOf(key);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : fallback;
};
const has = (key) => argv.includes(key);

function fail(message) {
  console.error(`❌ ${message}`);
  process.exit(2);
}

function parseBbox(valueText) {
  if (!valueText) return null;
  const parts = valueText.split(',').map(Number);
  if (parts.length !== 4 || !parts.every(Number.isFinite)) return null;
  const [minLat, minLng, maxLat, maxLng] = parts;
  return maxLat > minLat && maxLng > minLng ? { minLat, minLng, maxLat, maxLng } : null;
}

function parseCenter(valueText, bbox) {
  if (!valueText) return null;
  const [lat, lng] = valueText.split(',').map(Number);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  return { lat, lng, rot: 0 };
}

function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stable(value[key])]));
}

function elementKey(el) {
  const type = ({ node: '0', way: '1', relation: '2' })[el?.type] || '9';
  return `${type}/${String(el?.id ?? '')}`;
}

function stableResponse(response) {
  const out = stable(response);
  out.elements = (response.elements || []).slice().sort((a, b) => elementKey(a).localeCompare(elementKey(b), undefined, { numeric: true }));
  return out;
}

async function request(query, label, timeoutMs) {
  let last = '未知錯誤';
  for (const url of MIRRORS) {
    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'User-Agent': UA },
        body: 'data=' + encodeURIComponent(query),
        signal: AbortSignal.timeout(timeoutMs),
      });
      if (!response.ok) { last = `${url} HTTP ${response.status}`; continue; }
      const data = await response.json();
      if (!Array.isArray(data.elements) || data.remark) {
        last = `${url} 回應被截斷或缺少 elements`;
        continue;
      }
      console.log(`  ${label}: ${url} (${data.elements.length} elements)`);
      return { data, url };
    } catch (error) {
      last = `${url} ${error.message}`;
    }
  }
  throw new Error(`${label} 三個 Overpass mirror 都失敗：${last}`);
}

const name = value('--name');
if (!name) fail('缺少 --name <fixture-name>');
if (!/^[a-z0-9][a-z0-9_-]*$/i.test(name)) fail('--name 只能含英數、底線與連字號');
const venueId = value('--venue', name);
const venue = VENUES.find((item) => item.id === venueId);
const team = Number(value('--team', '5'));
if (!Number.isInteger(team) || team < 1 || team > 5) fail('--team 必須是 1 到 5');
const cfg = venue ? venueConfig(venue, team) : null;
const bbox = parseBbox(value('--bbox')) || (cfg ? battleBBox(cfg) : null);
if (!bbox) fail('未知場地必須提供 --bbox minLat,minLng,maxLat,maxLng');
const center = parseCenter(value('--center'), bbox) || cfg?.center
  || { lat: (bbox.minLat + bbox.maxLat) / 2, lng: (bbox.minLng + bbox.maxLng) / 2, rot: 0 };
if (!center) fail('--center 必須是 lat,lng');

const outPath = resolve(value('--out') || fixturePath(name));
if (existsSync(outPath) && !has('--update')) fail(`fixture 已存在：${outPath}；需要覆寫時加 --update`);
if (has('--recenter')) {
  if (!venue || !existsSync(outPath)) fail('--recenter 需要既有的 venue fixture');
  const fixture = JSON.parse(readFileSync(outPath, 'utf8'));
  fixture.center = cfg.center;
  const tmp = `${outPath}.tmp-${process.pid}`;
  try {
    writeFileSync(tmp, JSON.stringify(fixture, null, 2) + '\n', 'utf8');
    renameSync(tmp, outPath);
  } finally {
    if (existsSync(tmp)) unlinkSync(tmp);
  }
  console.log(`✅ 已修正 ${outPath} 的場地旋轉中心；raw response 未改動`);
  process.exit(0);
}
const timeoutMs = Math.max(5000, Math.min(120000, Number(value('--timeout', '45000')) || 45000));
const featureQuery = osmFeatureQuery(bbox);
const roadQuery = osmRoadQuery(bbox);
if (!featureQuery || !roadQuery) fail('bbox 無效');

console.log(`抓取 ${name}：${bbox.minLat.toFixed(5)},${bbox.minLng.toFixed(5)},${bbox.maxLat.toFixed(5)},${bbox.maxLng.toFixed(5)}`);
const features = await request(featureQuery, 'features', timeoutMs);
const roads = await request(roadQuery, 'roads', timeoutMs);
if (!roads.data.elements.length) fail('roads 回應為空，拒絕建立沒有路網的 fixture');

const featureQuotas = osmFeatureQuotas(bbox);
const roadQuotas = osmRoadQuotas(bbox);
const fixture = {
  version: FIXTURE_VERSION,
  schema: 'osm-fixture-v1',
  name,
  venue: venue ? { id: venue.id, name: venue.name, type: venue.type, country: venue.country } : null,
  team,
  center,
  bbox,
  capturedAt: new Date().toISOString(),
  source: { features: features.url, roads: roads.url, userAgent: UA },
  queries: {
    features: { version: OSM_FEATURE_QUERY_VERSION, quotas: featureQuotas, text: featureQuery },
    roads: { version: OSM_ROAD_QUERY_VERSION, quotas: roadQuotas, text: roadQuery },
  },
  responses: {
    // 完整 raw element 保留 id/type/tags/geometry/members，供日後診斷分類與 relation 組環。
    features: stableResponse(features.data),
    roads: stableResponse(roads.data),
  },
  stats: {
    bboxKm2: bboxKm2(bbox),
    featureElements: features.data.elements.length,
    roadElements: roads.data.elements.length,
  },
};

mkdirSync(dirname(outPath), { recursive: true });
const tmp = `${outPath}.tmp-${process.pid}`;
try {
  writeFileSync(tmp, JSON.stringify(fixture, null, 2) + '\n', 'utf8');
  renameSync(tmp, outPath);
} finally {
  if (existsSync(tmp)) unlinkSync(tmp);
}
console.log(`✅ 已寫入 ${outPath} (${(readFileSync(outPath).length / 1024).toFixed(0)}KB)`);
