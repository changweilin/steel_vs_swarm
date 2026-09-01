// ============ 固定 OSM / 高程 fixture 共用讀取縫 ============
// OSM fixture 保留 Overpass 原始 response；高程 fixture 保留 runtime 同形的
// Terrarium 來源 tile 與 193×193 raw 網格。這裡只負責路徑、契約、來源完整性與
// 正式 parser 的接線。抓取器與離線 audit 不得各自發明 payload 形狀。
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { TERRAIN, llToXZ, rotXZ, xzToLL } from '../public/js/data.js';
import { osmFeatureQuery, osmRoadQuery, parseOsmFeatureElements, osmRoadsFromElements } from '../public/js/osmQuery.js';

export const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));
export const DEFAULT_FIXTURE_DIR = join(ROOT, 'test', 'fixtures', 'osm');
export const DEFAULT_ELEVATION_DIR = join(DEFAULT_FIXTURE_DIR, 'elevation');
export const FIXTURE_VERSION = 1;
export const ELEVATION_FIXTURE_VERSION = 1;
export const ELEVATION_FIXTURE_SCHEMA = 'terrain-elevation-fixture-v1';
export const ELEVATION_GRID_N = TERRAIN.GRID_N;

export function fixtureNameOf(name) {
  return /^[a-z0-9][a-z0-9_-]*$/i.test(String(name || '')) ? String(name) : null;
}

export function fixturePath(name, dir = DEFAULT_FIXTURE_DIR) {
  const safe = fixtureNameOf(name);
  return safe ? join(resolve(dir), `${safe}.json`) : null;
}

export function elevationDirForFixtureDir(dir = DEFAULT_FIXTURE_DIR) {
  return join(resolve(dir), 'elevation');
}

export function elevationFixturePath(name, dir = DEFAULT_ELEVATION_DIR) {
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

/**
 * 高程 fixture 的世界網格 bounds。捕獲器與消費端都以這份定義為準：
 * values[i * width + j] 的 i 是世界 z 由北到南的固定列、j 是世界 x 由西到東的固定欄。
 */
export function elevationWorldBounds(bbox, center) {
  const points = [
    [bbox?.minLat, bbox?.minLng], [bbox?.minLat, bbox?.maxLng],
    [bbox?.maxLat, bbox?.minLng], [bbox?.maxLat, bbox?.maxLng],
  ].map(([lat, lng]) => llToXZ(Number(lat), Number(lng), center));
  if (!points.every(([x, z]) => Number.isFinite(x) && Number.isFinite(z))) return null;
  return {
    minX: Math.min(...points.map(([x]) => x)), maxX: Math.max(...points.map(([x]) => x)),
    minZ: Math.min(...points.map(([, z]) => z)), maxZ: Math.max(...points.map(([, z]) => z)),
  };
}

/**
 * 將 runtime 的軸對齊 world bounds 轉成 buildHeightField 可接受的 LL bbox。
 * 舊 Node mirror 會把 LL bbox 的西南／東北兩個對角再投影一次；旋轉場地若直接
 * 餵 battleBBox，會把格網錯誤外擴。這個 adapter 反解那兩個對角的差分
 * (world width = cosθ·local width + sinθ·local height、world z diff =
 * sinθ·local width − cosθ·local height)，只供固定 fixture 分支使用，讓既有
 * buildHeightField 在不改動網路路徑的前提下得到與 runtime battleRect 相同的 bounds。
 */
export function heightFieldBboxForWorldBounds(bounds, center) {
  if (!finiteBounds(bounds) || !finiteCenter(center)) return null;
  const width = Number(bounds.maxX) - Number(bounds.minX);
  const height = Number(bounds.maxZ) - Number(bounds.minZ);
  const angle = Number(center.rot) || 0;
  const c = Math.cos(angle), s = Math.sin(angle);
  let localWidth = 0, localHeight = 0, zDiff = 0;
  for (const sign of [1, -1]) {
    const candidateZDiff = sign * height;
    const candidateWidth = c * width + s * candidateZDiff;
    const candidateHeight = s * width - c * candidateZDiff;
    if (candidateWidth > 0 && candidateHeight > 0) {
      localWidth = candidateWidth;
      localHeight = candidateHeight;
      zDiff = candidateZDiff;
      break;
    }
  }
  if (!(localWidth > 0) || !(localHeight > 0) || !Number.isFinite(zDiff)) return null;
  const centerWorld = [(Number(bounds.minX) + Number(bounds.maxX)) / 2,
    (Number(bounds.minZ) + Number(bounds.maxZ)) / 2];
  const [localX, localZ] = rotXZ(centerWorld[0], centerWorld[1], -angle);
  const [lat0, lng0] = xzToLL(centerWorld[0], centerWorld[1], center);
  const [worldZx, worldZz] = rotXZ(localX, localZ + localHeight / 2, angle);
  const [worldXx, worldXz] = rotXZ(localX + localWidth / 2, localZ, angle);
  const [latZ, lngZ] = xzToLL(worldZx, worldZz, center);
  const [latX, lngX] = xzToLL(worldXx, worldXz, center);
  const dLat = Math.abs(latZ - lat0), dLng = Math.abs(lngX - lng0);
  return {
    minLat: lat0 - dLat, maxLat: lat0 + dLat,
    minLng: lng0 - dLng, maxLng: lng0 + dLng,
  };
}

function finiteBbox(bbox) {
  const keys = ['minLat', 'minLng', 'maxLat', 'maxLng'];
  return !!bbox && keys.every((key) => Number.isFinite(Number(bbox[key])))
    && Number(bbox.maxLat) > Number(bbox.minLat) && Number(bbox.maxLng) > Number(bbox.minLng);
}

function finiteCenter(center) {
  return !!center && ['lat', 'lng', 'rot'].every((key) => Number.isFinite(Number(center[key])));
}

function finiteBounds(bounds) {
  return !!bounds && ['minX', 'maxX', 'minZ', 'maxZ'].every((key) => Number.isFinite(Number(bounds[key])))
    && Number(bounds.maxX) > Number(bounds.minX) && Number(bounds.maxZ) > Number(bounds.minZ);
}

function sha256(buf) {
  return createHash('sha256').update(buf).digest('hex');
}

function tileSetForBbox(bbox, zoom) {
  if (!finiteBbox(bbox) || !Number.isInteger(zoom)) return null;
  const lon2tx = (lon) => (lon + 180) / 360 * 2 ** zoom;
  const lat2ty = (lat) => (1 - Math.log(Math.tan(lat * Math.PI / 180)
    + 1 / Math.cos(lat * Math.PI / 180)) / Math.PI) / 2 * 2 ** zoom;
  const tx0 = Math.floor(lon2tx(Number(bbox.minLng))), tx1 = Math.floor(lon2tx(Number(bbox.maxLng)));
  const ty0 = Math.floor(lat2ty(Number(bbox.maxLat))), ty1 = Math.floor(lat2ty(Number(bbox.minLat)));
  const keys = [];
  for (let y = ty0; y <= ty1; y++) for (let x = tx0; x <= tx1; x++) keys.push(`${zoom}/${x}/${y}`);
  return keys.sort();
}

function tileMetadataErrors(fixture, dir) {
  const errors = [];
  const source = fixture?.source;
  if (source?.provider !== 'aws-terrain-tiles' || source?.encoding !== 'terrarium') {
    errors.push('source.provider 必須是 aws-terrain-tiles 且 source.encoding 必須是 terrarium');
  }
  if (Number(source?.zoom) !== Number(TERRAIN.ELEV_ZOOM)) {
    errors.push(`source.zoom 必須是 ${TERRAIN.ELEV_ZOOM}`);
  }
  if (source?.urlTemplate !== 'https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png') {
    errors.push('source.urlTemplate 必須是 AWS Terrain Tiles Terrarium template');
  }
  if (!Array.isArray(source?.tiles) || source.tiles.length === 0) {
    errors.push('source.tiles 不得為空');
    return errors;
  }
  const seen = new Set();
  for (const tile of source.tiles) {
    const key = `${tile?.z}/${tile?.x}/${tile?.y}`;
    if (seen.has(key)) errors.push(`source.tiles 重複 ${key}`);
    seen.add(key);
    if (!Number.isInteger(tile?.z) || !Number.isInteger(tile?.x) || !Number.isInteger(tile?.y)) {
      errors.push(`source.tiles 座標無效 ${key}`);
      continue;
    }
    if (!/^tiles\/[0-9]+_-?[0-9]+_-?[0-9]+\.png$/u.test(String(tile.path || ''))) {
      errors.push(`source.tiles.path 必須是相對 tiles/*.png：${key}`);
      continue;
    }
    const expectedUrl = 'https://s3.amazonaws.com/elevation-tiles-prod/terrarium/'
      + tile.z + '/' + tile.x + '/' + tile.y + '.png';
    if (tile.url !== expectedUrl) {
      errors.push(`source.tiles.url 不是 AWS Terrarium URL：${key}`);
    }
    if (!/^[0-9a-f]{64}$/u.test(String(tile.sha256 || ''))) {
      errors.push(`source.tiles.sha256 無效：${key}`);
      continue;
    }
    if (Number(tile.width) !== 256 || Number(tile.height) !== 256 || !Number.isInteger(Number(tile.bytes))
      || Number(tile.bytes) <= 0) {
      errors.push(`source.tiles 尺寸/bytes metadata 無效：${key}`);
    }
    if (!dir) continue;
    const file = join(resolve(dir), String(tile.path));
    if (!existsSync(file)) {
      errors.push(`source.tiles 原始檔缺失：${tile.path}`);
      continue;
    }
    const buf = readFileSync(file);
    if (Number.isFinite(Number(tile.bytes)) && Number(tile.bytes) !== buf.length) {
      errors.push(`source.tiles.bytes 不符：${tile.path}`);
    }
    if (sha256(buf) !== tile.sha256) errors.push(`source.tiles.sha256 不符：${tile.path}`);
  }
  const expected = tileSetForBbox(fixture?.bbox, Number(source.zoom));
  if (expected) {
    const actual = [...seen].sort();
    if (JSON.stringify(actual) !== JSON.stringify(expected)) {
      errors.push(`source.tiles 未完整覆蓋 bbox(expected=${expected.join(',')}, actual=${actual.join(',')})`);
    }
  }
  return errors;
}

/**
 * 檢查高程 fixture 是否真的能被當作來源資料消費。缺 raw tile、metadata 或網格
 * 任一項都回傳錯誤；呼叫端 MUST 把 errors 當未驗，不得降級成平地／程序噪聲。
 */
export function validateElevationFixture(fixture, { dir = null } = {}) {
  const errors = [];
  if (fixture?.version !== ELEVATION_FIXTURE_VERSION) errors.push('version 不符');
  if (fixture?.schema !== ELEVATION_FIXTURE_SCHEMA) errors.push('schema 不符');
  if (!fixtureNameOf(fixture?.name)) errors.push('name 無效');
  if (!finiteBbox(fixture?.bbox)) errors.push('bbox 無效');
  if (!finiteCenter(fixture?.center)) errors.push('center 無效');
  if (!Number.isInteger(Number(fixture?.team)) || Number(fixture.team) < 1 || Number(fixture.team) > 5) {
    errors.push('team 無效');
  }
  if (!fixture?.capturedAt || !Number.isFinite(Date.parse(fixture.capturedAt))) errors.push('capturedAt 無效');
  if (fixture?.source?.capturedAt !== fixture?.capturedAt) errors.push('source.capturedAt 必須與 fixture.capturedAt 相同');
  const grid = fixture?.grid;
  if (Number(grid?.width) !== ELEVATION_GRID_N || Number(grid?.height) !== ELEVATION_GRID_N) {
    errors.push(`grid 必須是 ${ELEVATION_GRID_N}×${ELEVATION_GRID_N}`);
  }
  if (grid?.axis !== 'world-z-x' || grid?.interpolation !== 'two-triangle') {
    errors.push('grid.axis/interpolation 必須是 world-z-x/two-triangle');
  }
  if (grid?.sample !== 'xzToLL → Terrarium bilinear at runtime world grid') {
    errors.push('grid.sample 不符 runtime Terrarium 取樣契約');
  }
  if (grid?.valueType !== 'float32' || grid?.digestAlgorithm !== 'sha256-float32-le'
    || !/^[0-9a-f]{64}$/u.test(String(grid?.sha256 || ''))) {
    errors.push('grid.valueType/digestAlgorithm/sha256 不符');
  } else if (Array.isArray(grid?.values) && grid.values.length === ELEVATION_GRID_N * ELEVATION_GRID_N
    && grid.values.every((value) => typeof value === 'number' && Number.isFinite(value))) {
    const bytes = Buffer.from(Float32Array.from(grid.values).buffer);
    if (sha256(bytes) !== grid.sha256) errors.push('grid.sha256 不符');
  }
  if (!finiteBounds(grid?.bounds)) errors.push('grid.bounds 無效');
  if (!Array.isArray(grid?.values) || grid.values.length !== ELEVATION_GRID_N * ELEVATION_GRID_N) {
    errors.push(`grid.values 必須有 ${ELEVATION_GRID_N * ELEVATION_GRID_N} 個值`);
  } else if (!grid.values.every((value) => typeof value === 'number' && Number.isFinite(value))) {
    errors.push('grid.values 含非有限值');
  }
  errors.push(...tileMetadataErrors(fixture, dir));
  return { ok: errors.length === 0, errors };
}

/**
 * 對 OSM fixture 的高程 companion 做相同場地契約檢查。這個契約故意不容許
 * fixture 只靠名字配對：bbox、center、team 與網格 bounds 都必須可回推。
 */
export function elevationFixtureContract(fixture, {
  name = null, venueId = null, team = null, bbox = null, center = null, bounds = null,
} = {}) {
  const valid = validateElevationFixture(fixture);
  const expectedBbox = bbox || null;
  const expectedCenter = center || null;
  const near = (a, b, eps = 1e-9) => Number.isFinite(Number(a)) && Number.isFinite(Number(b))
    && Math.abs(Number(a) - Number(b)) <= eps;
  const bboxKeys = ['minLat', 'minLng', 'maxLat', 'maxLng'];
  const bboxOk = !!expectedBbox && bboxKeys.every((key) => near(fixture?.bbox?.[key], expectedBbox[key]));
  const centerOk = !!expectedCenter && ['lat', 'lng', 'rot'].every((key) => near(fixture?.center?.[key], expectedCenter[key]));
  const teamOk = team == null || Number(fixture?.team) === Number(team);
  const nameOk = name == null || fixture?.osmFixture === name || fixture?.name === name;
  const venueOk = venueId == null || fixture?.venue?.id === venueId;
  const expectedBounds = bboxOk && centerOk ? (bounds || elevationWorldBounds(expectedBbox, expectedCenter)) : null;
  const boundsOk = !!expectedBounds && ['minX', 'maxX', 'minZ', 'maxZ']
    .every((key) => near(fixture?.grid?.bounds?.[key], expectedBounds[key], 1e-6));
  return {
    ok: valid.ok && nameOk && venueOk && teamOk && bboxOk && centerOk && boundsOk,
    valid, nameOk, venueOk, teamOk, bboxOk, centerOk, boundsOk,
    expectedBbox, observedBbox: fixture?.bbox || null,
    expectedCenter, observedCenter: fixture?.center || null,
    expectedBounds, observedBounds: fixture?.grid?.bounds || null,
  };
}

export function loadElevationFixture(name, dir = DEFAULT_ELEVATION_DIR, options = {}) {
  const path = elevationFixturePath(name, dir);
  if (!path || !existsSync(path)) return null;
  let fixture;
  try { fixture = JSON.parse(readFileSync(path, 'utf8')); }
  catch { return null; }
  if (fixture?.version !== ELEVATION_FIXTURE_VERSION
    || fixture?.schema !== ELEVATION_FIXTURE_SCHEMA || fixture?.name !== name) return null;
  if (options.validate === false) return fixture;
  return validateElevationFixture(fixture, { dir }).ok ? fixture : null;
}

export function loadElevationFixtureForVenue(venueId, names = new Set(), osmDir = DEFAULT_FIXTURE_DIR) {
  const dir = elevationDirForFixtureDir(osmDir);
  const candidates = names.size ? [...names] : [venueId];
  for (const name of candidates) {
    const fixture = loadElevationFixture(name, dir);
    if (fixture && (fixture.venue?.id === venueId || name === venueId)) return fixture;
  }
  return null;
}

/**
 * 高程 fixture 的固定取樣器。預設以 fixture bbox 的 LL 規則格取樣；傳入
 * `{ bbox }` 時使用 audit 的 world-bounds adapter bbox，將已在 runtime world-z-x
 * 節點捕獲的 raw 網格逐位元回填給既有 buildHeightField。插值仍是同一個兩三角式，
 * 因此 fixture 模式不需要另一份高程處理，也不會意外查網路。
 */
export function fixtureElevationSampler(fixture, { bbox = null } = {}) {
  const grid = fixture?.grid;
  const b = grid?.bounds;
  const n = Number(grid?.width);
  if (!fixture || n !== ELEVATION_GRID_N || !finiteBounds(b)
    || !Array.isArray(grid.values) || grid.values.length !== n * n) return null;
  const sampleBbox = bbox || fixture.bbox;
  if (!finiteBbox(sampleBbox)) return null;
  const values = grid.values;
  return (lat, lng) => {
    // buildHeightField 的兩層格索引是 LL bbox 的 row/column；fixture 的 values
    // 已在 runtime world-z-x 節點捕獲，將同一個規則格回填即可逐位元重播 raw field。
    const gx = (Number(lng) - sampleBbox.minLng) / (sampleBbox.maxLng - sampleBbox.minLng) * (n - 1);
    const gz = (sampleBbox.maxLat - Number(lat)) / (sampleBbox.maxLat - sampleBbox.minLat) * (n - 1);
    const j0 = Math.max(0, Math.min(n - 2, Math.floor(gx)));
    const i0 = Math.max(0, Math.min(n - 2, Math.floor(gz)));
    const fj = Math.max(0, Math.min(1, gx - j0));
    const fi = Math.max(0, Math.min(1, gz - i0));
    const at = (i, j) => Number(values[i * n + j]);
    const a = at(i0, j0), bb = at(i0, j0 + 1), c = at(i0 + 1, j0), d = at(i0 + 1, j0 + 1);
    return fi + fj <= 1 ? a + (bb - a) * fj + (c - a) * fi
      : d + (c - d) * (1 - fj) + (bb - d) * (1 - fi);
  };
}

export const elevSamplerFromFixture = fixtureElevationSampler;

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
