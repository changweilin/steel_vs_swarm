// ============ 固定 OSM fixture runtime 預算證據稽核 ============
// 讀固定 raw fixture，經正式 fixture parser → catalog/project → relay sanitize/fit，
// 再以 `readSrc()` 編譯並執行 osmBuilding.js／osmAreaObjects.js 原文。Three 只用
// 受控 trace 容器記錄 production 幾何；Node 沒有 WebGL，因此 draw call 欄位永遠
// 標為 `unverified`，本稽核也因此以非零退出，不能把 batch 數冒充瀏覽器實測。
//
// 預設驗收 shibuya_dense、roppongi_underpass；可用 --only=a,b 或 --all。
// 可輸出 --json=<path>。反向驗證（每個旗標都應退出非零）：
//   --break-relay       將 production MAX_BYTES 變成 1，fit 閘必須攔下
//   --break-blocker     production 外環少一段 blocker，邊界數量必須不符
//   --break-roof        production roof 少一個 polygon，roof polygon 必須不符
//   --break-object-batch production object batch 改成逐件 key，批次增長必須被攔下
// 替換命中數不符、反向測資不適用或壞版未被攔下，均是稽核失敗。

import { performance } from 'node:perf_hooks';
import { readdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { readSrc } from './audit_src.mjs';
import {
  DEFAULT_FIXTURE_DIR, FIXTURE_VERSION, fixtureOsm, fixturePath,
  fixtureResponses, loadOsmFixture,
} from './osm_fixture.mjs';
import {
  OSM_AREA_KEYS, areaAreaM2, assembleRelationRings,
  buildAreaRecords, buildContainmentIndex, catalogAreas, isSimpleRing,
  normalizeRing, placeAreaCandidates, projectAreaRecord,
} from '../public/js/osmAreas.js';
import { llToXZ } from '../public/js/data.js';
import { OSM_RELAY, osmRelayFit, sanitizeOsmRelay } from '../public/js/osmrelay.js';
import { osmRoadsFromElements } from '../public/js/osmQuery.js';

const argv = process.argv.slice(2);
const valueArg = (name, fallback = null) => {
  const exact = argv.find((arg) => arg.startsWith(`${name}=`));
  if (exact) return exact.slice(name.length + 1);
  const at = argv.indexOf(name);
  return at >= 0 && argv[at + 1] && !argv[at + 1].startsWith('--') ? argv[at + 1] : fallback;
};
const hasArg = (name) => argv.includes(name) || argv.some((arg) => arg.startsWith(`${name}=`));
const ONLY = new Set(String(valueArg('--only', '')).split(',').map((x) => x.trim()).filter(Boolean));
const DIR = resolve(valueArg('--fixture-dir', DEFAULT_FIXTURE_DIR));
const OUT = valueArg('--json');
const REQUIRE_BROWSER = hasArg('--require-browser');
const BREAKS = ['relay', 'blocker', 'roof', 'object-batch'].filter((name) => hasArg(`--break-${name}`));
const DEFAULT_NAMES = ['shibuya_dense', 'roppongi_underpass'];
const namesRequested = hasArg('--all')
  ? readdirSync(DIR).filter((file) => file.endsWith('.json')).map((file) => file.slice(0, -5)).sort()
  : (ONLY.size ? [...ONLY].sort() : DEFAULT_NAMES);

let pass = 0;
let fail = 0;
const check = (condition, label) => {
  if (condition) { pass++; console.log(`    ✓ ${label}`); }
  else { fail++; console.error(`    ✗ ${label}`); }
  return condition;
};
const bytes = (value) => new TextEncoder().encode(JSON.stringify(value)).length;
const round7 = (value) => Math.round(Number(value) * 1e7) / 1e7;
const sourceIdOf = (element) => element?.type && element?.id != null ? `${element.type}/${element.id}` : null;
const sortIds = (values) => [...values].filter((value) => typeof value === 'string').sort((a, b) => a.localeCompare(b));

function normalizeTags(tags) {
  const out = {};
  let count = 0;
  for (const key of Object.keys(tags || {}).sort()) {
    if (count >= OSM_RELAY.MAX_TAGS) break;
    const value = tags[key];
    if (typeof value !== 'string' && typeof value !== 'number') continue;
    out[String(key).slice(0, OSM_RELAY.MAX_TAG_LEN)] = String(value).slice(0, OSM_RELAY.MAX_TAG_LEN);
    count++;
  }
  return out;
}

function lineSignature(tags, geometry) {
  return JSON.stringify({
    tags: normalizeTags(tags),
    geometry: (geometry || []).map((point) => [round7(point?.lat), round7(point?.lon ?? point?.lng)]),
  });
}

function pointSignature(point) {
  return JSON.stringify({
    lat: round7(point?.lat), lng: round7(point?.lng ?? point?.lon), tags: normalizeTags(point?.tags),
  });
}

function unmatchedSources(rawRows, acceptedRows, signature) {
  const counts = new Map();
  for (const row of acceptedRows || []) {
    const key = signature(row.tags, row.geometry);
    counts.set(key, (counts.get(key) || 0) + 1);
  }
  const out = [];
  for (const row of rawRows || []) {
    const key = signature(row.tags, row.geometry);
    const left = counts.get(key) || 0;
    if (left) counts.set(key, left - 1);
    else if (row.sourceId) out.push(row.sourceId);
  }
  return out;
}

function unmatchedPointSources(rawRows, acceptedRows) {
  const counts = new Map();
  for (const row of acceptedRows || []) {
    const key = pointSignature(row);
    counts.set(key, (counts.get(key) || 0) + 1);
  }
  const out = [];
  for (const row of rawRows || []) {
    const key = pointSignature(row);
    const left = counts.get(key) || 0;
    if (left) counts.set(key, left - 1);
    else if (row.sourceId) out.push(row.sourceId);
  }
  return out;
}

function rawFeatureRows(elements) {
  const areaKeys = new Set(OSM_AREA_KEYS);
  const out = {
    rails: [], waters: [], boundaries: [], falls: [], crossings: [], pois: [], entrances: [],
  };
  for (const element of elements || []) {
    const tags = element?.tags || {};
    const sourceId = sourceIdOf(element);
    if (element?.type === 'relation' && (tags.type === 'multipolygon' || Array.isArray(element.members))) continue;
    if (element?.type === 'way' && element.geometry && Object.keys(tags).some((key) => areaKeys.has(key))) {
      const closed = Array.isArray(element.geometry) && element.geometry.length > 2
        && element.geometry[0]?.lat === element.geometry.at(-1)?.lat
        && (element.geometry[0]?.lon ?? element.geometry[0]?.lng)
          === (element.geometry.at(-1)?.lon ?? element.geometry.at(-1)?.lng);
      if (tags.railway && !closed) out.rails.push({ sourceId, tags, geometry: element.geometry });
      else if (tags.waterway && !closed) out.waters.push({ sourceId, tags, geometry: element.geometry });
    } else if (element?.type === 'way' && element.geometry && tags.railway) {
      out.rails.push({ sourceId, tags, geometry: element.geometry });
    } else if (element?.type === 'way' && element.geometry && tags.waterway) {
      out.waters.push({ sourceId, tags, geometry: element.geometry });
    } else if (element?.type === 'way' && element.geometry && tags.natural === 'coastline') {
      out.boundaries.push({ sourceId, tags, geometry: element.geometry });
    } else if (element?.type === 'way' && element.geometry) {
      out.boundaries.push({ sourceId, tags, geometry: element.geometry });
    } else if (element?.type === 'node' && tags.railway === 'level_crossing') {
      out.crossings.push({ sourceId, lat: element.lat, lng: element.lon, tags });
    } else if (element?.type === 'node' && tags.waterway === 'waterfall') {
      out.falls.push({ sourceId, lat: element.lat, lng: element.lon, tags });
    } else if (element?.type === 'node' && (/^(subway_entrance|station_entrance)$/.test(tags.railway || '')
      || (tags.entrance && /^(station|subway)$/.test(tags.public_transport || '')))) {
      out.entrances.push({ sourceId, lat: element.lat, lng: element.lon, tags });
    } else if (element?.type === 'node' && (tags.place || tags.natural === 'peak'
      || tags.highway === 'motorway_junction' || tags.railway)) {
      out.pois.push({ sourceId, lat: element.lat, lng: element.lon, tags });
    }
  }
  return out;
}

function rawAreaCandidateIds(elements) {
  const ways = new Map();
  const relations = [];
  const relationWayIds = new Set();
  const wanted = new Set(OSM_AREA_KEYS);
  const hasAreaTag = (tags) => Object.keys(tags || {}).some((key) => wanted.has(key));
  for (const element of elements || []) {
    if (element?.type === 'way' && element.id != null) {
      ways.set(`way/${element.id}`, element); ways.set(String(element.id), element);
    }
    if (element?.type === 'relation' && element.tags?.type === 'multipolygon') relations.push(element);
  }
  for (const relation of relations) {
    for (const member of relation.members || []) {
      if (member?.type === 'way' && member.ref != null) relationWayIds.add(String(member.ref));
    }
  }
  const ids = new Set();
  for (const element of elements || []) {
    if (element?.type !== 'way' || !hasAreaTag(element.tags)) continue;
    if (relationWayIds.has(String(element.id)) && !element.tags?.['building:part']) continue;
    const ring = normalizeRing(element.geometry);
    if (ring && isSimpleRing(ring)) ids.add(`way/${element.id}`);
  }
  for (const relation of relations) {
    if (!hasAreaTag(relation.tags)) continue;
    const rings = assembleRelationRings(relation, ways);
    if (rings.some((entry) => entry.role === 'outer' && entry.ring?.length >= 3)) ids.add(`relation/${relation.id}`);
  }
  return sortIds(ids);
}

function areaStats(areas) {
  let rings = 0;
  let nodes = 0;
  let holes = 0;
  let polygons = 0;
  for (const area of areas || []) for (const polygon of area.polygons || area.worldPolygons || []) {
    polygons++;
    rings++;
    nodes += polygon.outer?.length || 0;
    for (const hole of polygon.holes || []) { rings++; holes++; nodes += hole.length; }
  }
  return { areas: areas?.length || 0, polygons, rings, holes, nodes };
}

function isBuilding(area) {
  return area?.tags?.building != null || area?.tags?.['building:part'] != null;
}

function projectCatalog(areas, center) {
  return catalogAreas((areas || []).map((area) => projectAreaRecord(area, llToXZ, center)).filter(Boolean)).areas;
}

// ---------------------------------------------------------------------------
// Controlled Three trace. It only records calls made by the production source.
// ---------------------------------------------------------------------------
let activeTrace = null;
const emptyBounds = () => ({
  minX: Infinity, maxX: -Infinity, minY: Infinity, maxY: -Infinity,
  minZ: Infinity, maxZ: -Infinity,
});
const unionBounds = (items) => {
  const out = emptyBounds();
  for (const item of items || []) {
    const bounds = item?.bounds;
    if (!bounds) continue;
    out.minX = Math.min(out.minX, bounds.minX); out.maxX = Math.max(out.maxX, bounds.maxX);
    out.minY = Math.min(out.minY, bounds.minY); out.maxY = Math.max(out.maxY, bounds.maxY);
    out.minZ = Math.min(out.minZ, bounds.minZ); out.maxZ = Math.max(out.maxZ, bounds.maxZ);
  }
  return out;
};

class TracePath {
  constructor() { this.points = []; }
  moveTo(x, y) { this.points.push([x, y]); }
  lineTo(x, y) { this.points.push([x, y]); }
}

class TraceShape extends TracePath {
  constructor() { super(); this.holes = []; }
}

class TraceGeometry {
  constructor(kind, bounds = emptyBounds()) {
    this.kind = kind;
    this.bounds = { ...bounds };
    this.localBounds = { ...bounds };
    this.position = { x: 0, y: 0, z: 0 };
    if (activeTrace) activeTrace.geometries.push(this);
  }
  rotateX(angle) { this.rotateXAngle = angle; return this; }
  rotateY(angle) {
    this.rotateYAngle = angle;
    const b = this.localBounds, c = Math.cos(angle), s = Math.sin(angle);
    const points = [b.minX, b.maxX].flatMap((x) => [b.minZ, b.maxZ]
      .map((z) => [x * c + z * s, -x * s + z * c]));
    if (points.length) {
      this.bounds.minX = Math.min(...points.map((point) => point[0]));
      this.bounds.maxX = Math.max(...points.map((point) => point[0]));
      this.bounds.minZ = Math.min(...points.map((point) => point[1]));
      this.bounds.maxZ = Math.max(...points.map((point) => point[1]));
    }
    return this;
  }
  translate(x, y, z) {
    this.position = { x, y, z };
    const b = this.bounds;
    this.bounds = {
      minX: b.minX + x, maxX: b.maxX + x, minY: b.minY + y, maxY: b.maxY + y,
      minZ: b.minZ + z, maxZ: b.maxZ + z,
    };
    this.localBounds = { ...this.bounds };
    return this;
  }
}

class TraceShapeGeometry extends TraceGeometry {
  constructor(shape) {
    const points = (shape?.points || []).map(([x, y]) => [x, -y]);
    const bounds = points.length ? {
      minX: Math.min(...points.map((point) => point[0])), maxX: Math.max(...points.map((point) => point[0])),
      minY: 0, maxY: 0, minZ: Math.min(...points.map((point) => point[1])), maxZ: Math.max(...points.map((point) => point[1])),
    } : emptyBounds();
    super('shape', bounds);
    this.shape = shape;
    if (activeTrace) activeTrace.roofShapes.push(shape);
  }
}

class TraceBoxGeometry extends TraceGeometry {
  constructor(width, height, depth) {
    super('box', { minX: -width / 2, maxX: width / 2, minY: -height / 2, maxY: height / 2,
      minZ: -depth / 2, maxZ: depth / 2 });
    this.width = width; this.height = height; this.depth = depth;
  }
}

class TraceCylinderGeometry extends TraceGeometry {
  constructor(top, bottom, height) {
    const radius = Math.max(Math.abs(Number(top) || 0), Math.abs(Number(bottom) || 0));
    super('cylinder', { minX: -radius, maxX: radius, minY: -height / 2, maxY: height / 2,
      minZ: -radius, maxZ: radius });
  }
}

class TraceConeGeometry extends TraceGeometry {
  constructor(radius, height) {
    const r = Math.abs(Number(radius) || 0);
    super('cone', { minX: -r, maxX: r, minY: -height / 2, maxY: height / 2, minZ: -r, maxZ: r });
  }
}

class TraceMesh {
  constructor(geometry, material) {
    this.geometry = geometry; this.material = material; this.userData = {}; this.frustumCulled = true;
  }
}

const THREE_STUB = {
  Shape: TraceShape, Path: TracePath, ShapeGeometry: TraceShapeGeometry,
  BoxGeometry: TraceBoxGeometry, CylinderGeometry: TraceCylinderGeometry,
  ConeGeometry: TraceConeGeometry, Mesh: TraceMesh,
};
const mergeGeometries = (geometries) => {
  const merged = new TraceGeometry('merged', unionBounds(geometries));
  merged.children = [...geometries];
  return merged;
};
const envMat = (color, options) => ({ color, options });

function compileSource(source, kind) {
  const body = source
    .replace(/^import[^\n]*\r?\n/gm, '')
    .replace(/^export\s+\{[^\n]*\};?\s*$/gm, '')
    .replace(/^export\s+(?=(?:const|function|class)\b)/gm, '');
  if (kind === 'building') {
    return new Function('THREE', 'mergeGeometries', 'envMat',
      `${body}\nreturn { buildOsmPolygonBuildings };`)(THREE_STUB, mergeGeometries, envMat).buildOsmPolygonBuildings;
  }
  const factory = new Function('THREE', 'mergeGeometries', 'envMat', 'areaAreaM2',
    'buildContainmentIndex', 'placeAreaCandidates', `${body}\nreturn { buildOsmAreaObjects, ROWS };`);
  const result = factory(THREE_STUB, mergeGeometries, envMat, areaAreaM2,
    buildContainmentIndex, placeAreaCandidates);
  return { build: result.buildOsmAreaObjects, rows: result.ROWS };
}

function compileRelay(source) {
  const body = source.replace(/^export\s+/gm, '');
  return new Function(`${body}\nreturn { OSM_RELAY, sanitizeOsmRelay, osmRelayFit };`)();
}

function executeBuilder(builder, areas, options = {}) {
  const trace = { geometries: [], roofShapes: [] };
  const group = { children: [], add(child) { this.children.push(child); } };
  activeTrace = trace;
  let result;
  let error = null;
  try { result = builder(group, areas, options); }
  catch (caught) { error = caught; }
  finally { activeTrace = null; }
  return { group, result, trace, error };
}

function meshBatchNames(meshes, fields) {
  return sortIds(new Set((meshes || []).flatMap((mesh) => fields
    .map((field) => mesh?.userData?.[field]).filter((name) => typeof name === 'string'))));
}

function mutation(source, pattern, replacement, name) {
  const matches = source.match(pattern) || [];
  if (matches.length !== 1) throw new Error(`--break-${name} 原文替換命中 ${matches.length} 次（預期 1）`);
  return source.replace(pattern, replacement);
}

function parserLedger(rawElements, parsedAreas, parserResult) {
  const rows = [];
  for (const item of parserResult.invalidItems || []) {
    if (item.reason === 'capacity') continue;
    rows.push({ stage: 'parser', sourceId: item.sourceId || null, reason: item.reason || 'invalid_area' });
  }
  const accepted = new Set((parsedAreas || []).map((area) => area.sourceId));
  const invalid = new Set((parserResult.invalidItems || []).map((item) => item.sourceId).filter(Boolean));
  const candidates = rawAreaCandidateIds(rawElements);
  const capacityIds = candidates.filter((sourceId) => !accepted.has(sourceId) && !invalid.has(sourceId));
  for (const sourceId of capacityIds) rows.push({ stage: 'parser', sourceId, reason: 'capacity' });
  return { rows, candidates, capacityIds };
}

function addRelayDropRows(rows, raw, parsed, sanitized, fit) {
  const parserAreas = parsed.areas || [];
  const cleanAreas = sanitized?.areas || [];
  const fitAreas = fit?.msg?.areas || [];
  const cleanAreaIds = new Set(cleanAreas.map((area) => area.sourceId));
  const fitAreaIds = new Set(fitAreas.map((area) => area.sourceId));
  for (const area of parserAreas) if (!cleanAreaIds.has(area.sourceId)) {
    rows.push({ stage: 'relay-sanitize', sourceId: area.sourceId, reason: 'invalid_area' });
  }
  for (const area of cleanAreas) if (!fitAreaIds.has(area.sourceId)) {
    rows.push({ stage: 'relay-fit', sourceId: area.sourceId, reason: 'capacity' });
  }
  const rawRoads = raw.roads;
  const cleanRoads = sanitized?.roads || [];
  for (const sourceId of unmatchedSources(rawRoads, cleanRoads, lineSignature)) {
    rows.push({ stage: 'relay-sanitize', sourceId, reason: 'invalid_or_capacity_road' });
  }
  if (!fit) {
    for (const sourceId of unmatchedSources(rawRoads, [], lineSignature)) {
      rows.push({ stage: 'relay-fit', sourceId, reason: 'oversize_payload' });
    }
  }
  const cleanFeatures = sanitized?.pointFeatures || {};
  for (const category of Object.keys(rawFeatureRows(raw.rawFeatureElements))) {
    const rawRows = rawFeatureRows(raw.rawFeatureElements)[category];
    const acceptedRows = cleanFeatures[category] || [];
    const isLine = ['rails', 'waters', 'boundaries'].includes(category);
    const dropped = isLine
      ? unmatchedSources(rawRows, acceptedRows, lineSignature)
      : unmatchedPointSources(rawRows, acceptedRows);
    for (const sourceId of dropped) rows.push({ stage: 'relay-sanitize', sourceId, reason: `invalid_or_capacity_${category}` });
    if (fit?.dropPointFeatures) {
      for (const row of acceptedRows) {
        const key = isLine ? lineSignature(row.tags, row.geometry) : pointSignature(row);
        const rawMatch = rawRows.find((candidate) => (isLine
          ? lineSignature(candidate.tags, candidate.geometry) : pointSignature(candidate)) === key);
        rows.push({ stage: 'relay-fit', sourceId: rawMatch?.sourceId || null, reason: 'point_features_dropped' });
      }
    }
  }
  return rows;
}

function runtimeDropRows(rows, buildingRun, objectRun) {
  for (const row of buildingRun?.result?.invalid || []) rows.push({ stage: 'building', sourceId: row.sourceId || null, reason: row.reason || 'invalid_footprint' });
  for (const row of buildingRun?.result?.skipped || []) rows.push({ stage: 'building', sourceId: row.sourceId || null, reason: row.reason || 'unsupported_building' });
  for (const row of objectRun?.result?.capacity || []) rows.push({ stage: 'area-object', sourceId: row.sourceId || null, reason: 'capacity' });
  for (const row of objectRun?.result?.skipped || []) rows.push({ stage: 'area-object', sourceId: row.sourceId || null, reason: row.reason || 'blocked' });
  return rows;
}

function countBuildingSources(areas, result) {
  const input = (areas || []).filter(isBuilding);
  const generated = new Set((result?.platforms || []).map((row) => row.sourceId));
  const invalid = new Set((result?.invalid || []).map((row) => row.sourceId));
  const skipped = new Set((result?.skipped || []).map((row) => row.sourceId));
  const unresolved = input.map((area) => area.sourceId)
    .filter((sourceId) => !generated.has(sourceId) && !invalid.has(sourceId) && !skipped.has(sourceId));
  return { input: input.length, generatedSources: generated.size, invalidSources: invalid.size, skippedSources: skipped.size, unresolved };
}

function buildingEvidence(builder, areas, run) {
  const result = run.result || {};
  const kinds = new Set(Object.keys(result.generatedByKind || {}));
  const batchNames = meshBatchNames(result.meshes, ['osmBuildingBatch', 'osmBuildingRoofBatch', 'osmBuildingDetailBatch']);
  const sourceCount = countBuildingSources(areas, result);
  const doubledAreas = (areas || []).map((area, index) => ({ ...area, sourceId: `${area.sourceId}#scale${index}` }));
  const scaled = executeBuilder(builder, [...areas, ...doubledAreas], { terrain: { heightAt: () => 0 } });
  const scaleProbe = {
    status: scaled.error ? 'failed' : 'verified-static-batch',
    inputBuildings: (areas || []).filter(isBuilding).length,
    scaledInputBuildings: ([...areas, ...doubledAreas]).filter(isBuilding).length,
    meshCount: result.meshes?.length || 0,
    scaledMeshCount: scaled.result?.meshes?.length || 0,
    invariant: !scaled.error && (scaled.result?.meshes?.length || 0) === (result.meshes?.length || 0),
    note: 'production builder + duplicated fixture rows; static batch trace, not WebGL draw-call measurement',
  };
  const maxMeshCount = kinds.size * 3;
  return {
    inputSources: sourceCount,
    generatedPolygons: result.generated || 0,
    generatedByKind: result.generatedByKind || {},
    blockers: result.blockers || [],
    roofPlatforms: result.platforms || [],
    invalid: result.invalid || [],
    skipped: result.skipped || [],
    meshCount: result.meshes?.length || 0,
    batchKinds: batchNames,
    batchKindCount: batchNames.length,
    batchCount: batchNames.length,
    staticBound: { maxMeshes: maxMeshCount, pass: (result.meshes?.length || 0) <= maxMeshCount },
    scaleProbe,
  };
}

function objectEvidence(objectBuilder, areas, buildingBlockers, rows) {
  const blocked = (x, z, radius) => buildingBlockers.some((blocker) =>
    Math.hypot(blocker.x - x, blocker.z - z) < (blocker.r || 0) + radius + 0.5);
  const run = executeBuilder(objectBuilder, areas, { maxObjects: 480, heightAt: () => 0, blocked });
  const result = run.result || {};
  const batches = meshBatchNames(run.group.children, ['osmAreaBatch']);
  const objectKinds = Object.keys(rows || {});
  return {
    run,
    generated: result.generated || 0,
    generatedByKind: result.generatedByKind || {},
    blockers: result.blockers || [],
    capacity: result.capacity || [],
    skipped: result.skipped || [],
    meshCount: run.group.children.length,
    batchKinds: batches,
    batchKindCount: batches.length,
    batchCount: batches.length,
    staticBound: { knownGenerators: objectKinds.length, pass: run.group.children.length <= objectKinds.length },
  };
}

function loadRecord(name) {
  const fixture = loadOsmFixture(name, DIR);
  if (!fixture || fixture.version !== FIXTURE_VERSION || fixture.schema !== 'osm-fixture-v1') {
    throw new Error(`${name}: fixture 不存在、版本不符或 schema 不符`);
  }
  const responses = fixtureResponses(fixture);
  if (!responses) throw new Error(`${name}: 缺少 features/roads raw response`);
  const started = performance.now();
  const osm = fixtureOsm(fixture);
  if (!osm?.features) throw new Error(`${name}: fixtureOsm parser 失敗`);
  const parsed = osm.features;
  const rawFeatureElements = responses.features.elements;
  const rawRoadElements = responses.roads.elements;
  const parsedRoads = osm.roads;
  const rawBuild = buildAreaRecords(rawFeatureElements);
  const parserLedgerData = parserLedger(rawFeatureElements, parsed.areas, rawBuild);
  const parserAt = performance.now();
  const catalogAreasOutput = projectCatalog(parsed.areas, fixture.center);
  const catalogAt = performance.now();
  const relayInput = {
    bbox: fixture.bbox,
    areas: parsed.areas,
    pointFeatures: parsed.pointFeatures,
    roads: parsedRoads,
  };
  const sanitized = sanitizeOsmRelay(relayInput);
  const fit = osmRelayFit(sanitized);
  const relayAt = performance.now();
  const runtimeAreas = fit?.msg?.areas || [];
  const runtimeCatalogAreas = projectCatalog(runtimeAreas, fixture.center);
  const buildingSource = readSrc('public', 'js', 'osmBuilding.js');
  const objectSource = readSrc('public', 'js', 'osmAreaObjects.js');
  const buildingBuilder = compileSource(buildingSource, 'building');
  const objectCompiled = compileSource(objectSource, 'object');
  const buildingRun = executeBuilder(buildingBuilder, runtimeCatalogAreas, { terrain: { heightAt: () => 0 } });
  const building = buildingEvidence(buildingBuilder, runtimeCatalogAreas, buildingRun);
  const objects = objectEvidence(objectCompiled.build, runtimeCatalogAreas, building.blockers, objectCompiled.rows);
  const runtimeAt = performance.now();
  const rawFeatureRowsData = rawFeatureRows(rawFeatureElements);
  const rawRoadRows = rawRoadElements
    .filter((element) => element?.type === 'way' && element.geometry && element.tags?.highway)
    .map((element) => ({ sourceId: sourceIdOf(element), tags: element.tags, geometry: element.geometry }));
  const raw = {
    featureElements: rawFeatureElements.length,
    roadElements: rawRoadElements.length,
    nodeElements: rawFeatureElements.filter((element) => element?.type === 'node').length,
    areaCandidates: parserLedgerData.candidates.length,
    featureBytes: bytes(responses.features),
    roadBytes: bytes(responses.roads),
    responseBytes: bytes({ features: responses.features, roads: responses.roads }),
    modelBytes: bytes(relayInput),
    rawFeatureElements,
    features: rawFeatureRowsData,
    roads: rawRoadRows,
  };
  const relayRows = addRelayDropRows([], {
    ...raw,
    rawFeatureElements,
    features: rawFeatureRowsData,
    roads: rawRoadRows,
  }, parsed, sanitized, fit);
  const dropRows = runtimeDropRows([...parserLedgerData.rows, ...relayRows], buildingRun, objects.run);
  const invalidDrops = dropRows.filter((row) => !row.sourceId || !row.reason);
  const fitBytes = fit ? bytes(fit.msg) : 0;
  const sanitizedAgain = sanitized ? sanitizeOsmRelay(sanitized) : null;
  const fitSanitized = fit ? sanitizeOsmRelay(fit.msg) : null;
  const fitCanonical = fit ? Object.fromEntries(Object.entries(fit.msg).filter(([key]) => key !== 't')) : null;
  const parserAccepted = new Set((parsed.areas || []).map((area) => area.sourceId));
  const parserInvalid = new Set((rawBuild.invalidItems || []).map((item) => item.sourceId).filter(Boolean));
  const parserCapacity = new Set(parserLedgerData.capacityIds);
  const partition = parserLedgerData.candidates.filter((id) => parserAccepted.has(id)).length
    + parserLedgerData.candidates.filter((id) => parserInvalid.has(id)).length
    + parserLedgerData.candidates.filter((id) => parserCapacity.has(id)).length;
  const report = {
    version: 1,
    fixture: name,
    venue: fixture.venue,
    center: fixture.center,
    bbox: fixture.bbox,
    evidence: {
      runtime: 'controlled-production-source-harness',
      three: 'stub-trace-only',
      browserDrawCalls: {
        status: 'unverified',
        value: null,
        reason: '--require-browser is available, but this Node tool has no browser/WebGL renderer',
      },
    },
    bytes: {
      rawFeatureResponse: raw.featureBytes,
      rawRoadResponse: raw.roadBytes,
      rawResponses: raw.responseBytes,
      rawParsedModel: raw.modelBytes,
      sanitized: sanitized ? bytes(sanitized) : 0,
      fit: fitBytes,
      relayLimit: OSM_RELAY.MAX_BYTES,
      fitWithinLimit: !!fit && fitBytes <= OSM_RELAY.MAX_BYTES,
    },
    counts: {
      rawElements: { features: raw.featureElements, roads: raw.roadElements, nodes: raw.nodeElements },
      areas: {
        parsed: areaStats(parsed.areas),
        sanitized: areaStats(sanitized?.areas || []),
        fit: areaStats(runtimeAreas),
      },
      buildings: {
        inputAreas: building.inputSources.input,
        generatedSources: building.inputSources.generatedSources,
        invalidSources: building.inputSources.invalidSources,
        skippedSources: building.inputSources.skippedSources,
        unresolvedSources: building.inputSources.unresolved,
        generatedPolygons: building.generatedPolygons,
      },
      blockers: building.blockers.length + objects.blockers.length,
      buildingBlockers: building.blockers.length,
      roofPolygons: building.roofPlatforms.length,
      roofHoles: building.roofPlatforms.reduce((sum, row) => sum + (row.holes?.length || 0), 0),
      areaObjects: objects.generated,
      capacityDrops: dropRows.filter((row) => row.reason === 'capacity').length,
    },
    parser: {
      acceptedAreas: parsed.areas.length,
      invalid: rawBuild.invalidItems?.filter((item) => item.reason !== 'capacity') || [],
      capacity: parserLedgerData.capacityIds.map((sourceId) => ({ sourceId, reason: 'capacity' })),
      sourcePartition: {
        candidates: parserLedgerData.candidates.length,
        accepted: parserAccepted.size,
        invalid: parserInvalid.size,
        capacity: parserCapacity.size,
        conserved: partition === parserLedgerData.candidates.length,
      },
    },
    catalog: {
      report: catalogAreas((catalogAreasOutput || [])).report,
      runtimeAreas: runtimeCatalogAreas.length,
    },
    relay: {
      sanitized: sanitized ? { drop: sanitized.drop || 0, areas: sanitized.areas.length, roads: sanitized.roads?.length || 0 } : null,
      fit: fit ? {
        dropFeats: !!fit.dropFeats, dropPointFeatures: !!fit.dropPointFeatures, dropAreas: fit.dropAreas || 0,
        areas: fit.msg.areas?.length || 0, roads: fit.msg.roads?.length || 0,
      } : null,
      drops: relayRows,
      sanitizeIdempotent: !!sanitized && JSON.stringify(sanitized) === JSON.stringify(sanitizedAgain),
      fitSanitizeIdempotent: !!fit && JSON.stringify(fitCanonical) === JSON.stringify(fitSanitized),
    },
    runtime: {
      building,
      areaObjects: {
        generated: objects.generated,
        generatedByKind: objects.generatedByKind,
        blockers: objects.blockers,
        capacity: objects.capacity,
        skipped: objects.skipped,
        capacityDropCount: objects.capacity.length,
        meshCount: objects.meshCount,
        batchKinds: objects.batchKinds,
        batchKindCount: objects.batchKindCount,
        batchCount: objects.batchCount,
        staticBound: objects.staticBound,
      },
      drops: dropRows,
      dropContract: { allHaveSourceIdAndReason: invalidDrops.length === 0, invalid: invalidDrops },
    },
    timingsMs: {
      parser: Number((parserAt - started).toFixed(3)),
      catalog: Number((catalogAt - parserAt).toFixed(3)),
      relay: Number((relayAt - catalogAt).toFixed(3)),
      runtimeBuilders: Number((runtimeAt - relayAt).toFixed(3)),
      total: Number((runtimeAt - started).toFixed(3)),
    },
  };
  return {
    name, fixture, responses, parsed, rawBuild, parserLedgerData, raw, relayInput, sanitized, fit,
    runtimeAreas, runtimeCatalogAreas, buildingSource, objectSource, buildingBuilder, objectCompiled,
    buildingRun, building, objects, report, dropRows,
  };
}

function auditRecord(record) {
  const { name, parsed, rawBuild, parserLedgerData, raw, sanitized, fit, runtimeAreas, runtimeCatalogAreas,
    building, objects, report, dropRows } = record;
  check(raw.featureElements > 0 && raw.roadElements > 0, `${name}: raw feature/road response 非空`);
  check(rawBuild.areas.length === parsed.areas.length, `${name}: fixtureOsm 與正式 buildAreaRecords accepted areas 一致`);
  check(report.bytes.fitWithinLimit, `${name}: fit ${report.bytes.fit} bytes <= OSM_RELAY.MAX_BYTES ${OSM_RELAY.MAX_BYTES}`);
  check(report.relay.sanitizeIdempotent, `${name}: sanitize 冪等`);
  check(report.relay.fitSanitizeIdempotent, `${name}: fit 後再 sanitize 逐位元一致`);
  check(report.parser.sourcePartition.conserved, `${name}: raw area candidates → accepted/invalid/capacity 守恆`);
  check(fit && runtimeAreas.length === (fit.msg.areas || []).length, `${name}: runtime 使用 fit 訊息 areas`);
  check(!report.runtime.dropContract.invalid.length, `${name}: 每筆 parser/relay/runtime drop 都帶 sourceId/reason (${dropRows.length})`);
  check(!buildingRunError(record), `${name}: production osmBuilding.js 原文受控執行`);
  check(!objects.run.error && objects.run.result, `${name}: production osmAreaObjects.js 原文受控執行`);
  check(building.staticBound.pass && building.scaleProbe.invariant,
    `${name}: 建物 batch static evidence 不隨棟數線性增長（${building.meshCount} meshes/${building.batchCount} batches）`);
  check(objects.staticBound.pass, `${name}: area object batch static evidence 受 generator 上限約束（${objects.meshCount}/${objects.batchCount}）`);
  check(building.roofPlatforms.every((platform) => Array.isArray(platform.outer) && Array.isArray(platform.holes)),
    `${name}: roof polygons 保留 outer/holes`);
  check(building.blockers.every((blocker) => blocker.sourceId && blocker.reason == null),
    `${name}: building blockers 具 sourceId（production geometry trace）`);
  check(objects.blockers.every((blocker) => blocker.sourceId), `${name}: area object blockers 具 sourceId`);
  check(objects.capacity.every((row) => row.sourceId && row.reason), `${name}: area object capacity 每筆具 sourceId/reason`);
  check(objects.skipped.every((row) => row.sourceId && row.reason), `${name}: area object skipped 每筆具 sourceId/reason`);
  // Keep report values visible to reviewers without duplicating the raw payload.
  console.log(`  ${name}: raw=${raw.responseBytes}B sanitized=${report.bytes.sanitized}B fit=${report.bytes.fit}B`
    + ` areas=${runtimeAreas.length} rings=${report.counts.areas.fit.rings} nodes=${report.counts.areas.fit.nodes}`
    + ` buildings=${building.inputSources.input} blockers=${report.counts.blockers}`
    + ` roofs=${report.counts.roofPolygons} objects=${objects.generated}`
    + ` capacityDrops=${dropRows.filter((row) => row.reason === 'capacity').length}`
    + ` buildMs=${report.timingsMs.runtimeBuilders}`);
}

function buildingRunError(record) {
  return record.buildingRun.error || !record.buildingRun.result;
}

function firstBuilding(record) {
  return record.runtimeCatalogAreas.find((area) => isBuilding(area) && area.worldPolygons?.length);
}

function firstHoleBuilding(record) {
  return record.runtimeCatalogAreas.find((area) => isBuilding(area)
    && area.worldPolygons?.some((polygon) => (polygon.holes || []).length));
}

function auditBreaks(records) {
  if (!BREAKS.length) return;
  const record = records.find((item) => item.building.inputSources.input > 0) || records[0];
  if (!record) throw new Error('反向驗證沒有 fixture');
  for (const name of BREAKS) {
    try {
      if (name === 'relay') {
        const relaySource = readSrc('public', 'js', 'osmrelay.js');
        const brokenSource = mutation(relaySource, /\r?\n\s*MAX_BYTES:\s*1800000/, '\n  MAX_BYTES: 1', name);
        const brokenRelay = compileRelay(brokenSource);
        const brokenClean = brokenRelay.sanitizeOsmRelay(record.relayInput);
        const brokenFit = brokenRelay.osmRelayFit(brokenClean);
        const caught = !brokenFit || new TextEncoder().encode(JSON.stringify(brokenFit.msg)).length > brokenRelay.OSM_RELAY.MAX_BYTES;
        if (!caught) throw new Error('壞版 fit 仍被接受');
        fail++;
        console.error(`    ✗ --break-relay 已攔下 ${record.name}（預期紅字）`);
        continue;
      }
      if (name === 'object-batch') {
        const source = record.objectSource;
        const brokenSource = mutation(source,
          /\r?\n\s*let batch = batches\.get\(cls\.generator\);\r?\n\s*if \(!batch\) batches\.set\(cls\.generator, batch = \{ row, geos: \[\] \}\);/,
          '\n    let batch = batches.get(`${cls.generator}:${index}`);\n'
          + '    if (!batch) batches.set(`${cls.generator}:${index}`, batch = { row, geos: [] });', name);
        const broken = compileSource(brokenSource, 'object');
        const blocked = () => false;
        const brokenRun = executeBuilder(broken.build, record.runtimeCatalogAreas, { maxObjects: 480, heightAt: () => 0, blocked });
        const brokenBatches = brokenRun.group.children.length;
        const caught = !brokenRun.error && brokenBatches > record.objects.meshCount;
        if (!caught) throw new Error('逐件 batch 變異未造成可觀察批次線性增長');
        fail++;
        console.error(`    ✗ --break-object-batch 已攔下 ${record.name}（預期紅字）`);
        continue;
      }
      const target = name === 'roof' ? (firstHoleBuilding(record) || firstBuilding(record)) : firstBuilding(record);
      if (!target) throw new Error(`沒有適用真實建物（${name}）`);
      const source = record.buildingSource;
      if (name === 'blocker') {
        const brokenSource = mutation(source, /(?:\r?\n|[ \t])+blockers\.push\(\.\.\.outer\.edges\);/, ' blockers.push(...outer.edges.slice(0, -1));', name);
        const brokenBuilder = compileSource(brokenSource, 'building');
        const brokenRun = executeBuilder(brokenBuilder, [target], { terrain: { heightAt: () => 0 } });
        const expected = target.worldPolygons.reduce((sum, polygon) => sum + polygon.outer.length
          + (polygon.holes || []).reduce((holeSum, hole) => holeSum + hole.length, 0), 0);
        const caught = !brokenRun.error && (brokenRun.result?.blockers?.length || 0) !== expected;
        if (!caught) throw new Error('外環 blocker 壞版未被攔下');
        fail++;
        console.error(`    ✗ --break-blocker 已攔下 ${record.name}/${target.sourceId}（預期紅字）`);
      } else if (name === 'roof') {
        const brokenSource = mutation(source, /\r?\n\s*batch\.roofs\.push\(roofGeometry\(poly,\s*topY\)\);/, '\n      /* --break-roof: omitted production roof polygon */', name);
        const brokenBuilder = compileSource(brokenSource, 'building');
        const brokenRun = executeBuilder(brokenBuilder, [target], { terrain: { heightAt: () => 0 } });
        const expected = target.worldPolygons.length;
        const actual = brokenRun.trace.roofShapes?.length || 0;
        const caught = !brokenRun.error && actual !== expected;
        if (!caught) throw new Error('roof holes 壞版未被攔下');
        fail++;
        console.error(`    ✗ --break-roof 已攔下 ${record.name}/${target.sourceId}（預期紅字）`);
      }
    } catch (error) {
      fail++;
      console.error(`    ✗ --break-${name}: ${error.message}`);
    }
  }
}

const records = [];
for (const name of namesRequested) {
  if (!fixturePath(name, DIR)) {
    fail++;
    console.error(`  ✗ ${name}: 找不到 fixture`);
    continue;
  }
  try {
    const record = loadRecord(name);
    records.push(record);
    auditRecord(record);
  } catch (error) {
    fail++;
    console.error(`  ✗ ${name}: ${error.stack || error.message}`);
  }
}

if (!records.length) {
  fail++;
  console.error(`❌ 沒有可驗 fixture：${DIR}`);
} else {
  auditBreaks(records);
}

// Browser draw calls are deliberately not inferred from static mesh/batch counts.
// This explicit red gate keeps the P4 browser requirement visible to CI/reviewers.
fail++;
console.error(`    ✗ browser drawCall 未驗（${REQUIRE_BROWSER ? '--require-browser 已要求' : 'Node static-only 模式'}；需要實際瀏覽器/WebGL renderer）`);

const output = {
  version: 1,
  source: ['tools/osm_fixture.mjs', 'public/js/osmQuery.js', 'public/js/osmAreas.js', 'public/js/osmrelay.js',
    'public/js/osmBuilding.js', 'public/js/osmAreaObjects.js'],
  evidenceKind: 'node-static-batch',
  browserDrawCalls: { status: 'unverified', requireBrowser: REQUIRE_BROWSER },
  relayLimit: OSM_RELAY.MAX_BYTES,
  fixtures: records.map((record) => record.report),
  pass,
  fail,
};
if (OUT) writeFileSync(resolve(OUT), JSON.stringify(output, null, 2) + '\n');
console.log(`\n${fail ? '❌' : '✅'} OSM runtime 預算證據稽核：${pass} 綠 / ${fail} 紅`);
process.exitCode = fail ? 1 : 0;
