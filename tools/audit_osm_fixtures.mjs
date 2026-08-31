// ============ 固定真實 OSM fixture 完整資料流程稽核 ============
// 離線執行：raw Overpass response → AreaRecord → 投影／分類／缺件報表 →
// relay sanitize／fit → 固定場地路網來源覆蓋。它不查網路，因此可在 CI 重跑；
// 真正的高程／結構／泛洪仍由 audit_traverse --fixture-dir 接同一份 fixture 驗證。
// 用法：node tools/audit_osm_fixtures.mjs [--only=taipei_dense,shibuya_dense] [--json=out.json]
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { VENUES, venueConfig } from '../public/js/venues.js';
import { battleBBox, llToXZ } from '../public/js/data.js';
import {
  OSM_AREA_KEYS, OSM_AREA_LIMITS, areaSurfaceRows, catalogAreas, mergeAreaGaps,
  placeAreaCandidates, projectAreaRecord,
} from '../public/js/osmAreas.js';
import { OSM_RELAY, osmRelayFit, sanitizeOsmRelay } from '../public/js/osmrelay.js';
import {
  bboxKm2, OSM_FEATURE_QUERY_VERSION, OSM_ROAD_QUERY_VERSION,
  osmFeatureQuotas, osmFeatureQuery, osmRoadQuery, osmRoadQuotas,
  parseOsmFeatureElements, osmRoadsFromElements,
} from '../public/js/osmQuery.js';
import { DEFAULT_FIXTURE_DIR, FIXTURE_VERSION, fixtureQueries } from './osm_fixture.mjs';

const argv = Object.fromEntries(process.argv.slice(2).map((arg) => {
  const m = /^--([^=]+)(?:=(.*))?$/.exec(arg);
  return m ? [m[1], m[2] ?? '1'] : ['_', arg];
}));
const ONLY = new Set(String(argv.only || '').split(',').filter(Boolean));
const DIR = resolve(argv['fixture-dir'] || DEFAULT_FIXTURE_DIR);
const OUT = argv.json ? resolve(argv.json) : null;
const bytes = (value) => new TextEncoder().encode(JSON.stringify(value)).length;
let pass = 0, fail = 0;
const check = (condition, label) => {
  if (condition) { pass++; console.log(`    ✓ ${label}`); }
  else { fail++; console.error(`    ✗ ${label}`); }
};
const hasArg = (name) => Object.prototype.hasOwnProperty.call(argv, name.replace(/^--/, ''));
const BREAKS = {
  relation: hasArg('--break-real-relation'),
  hole: hasArg('--break-real-hole'),
  capacity: hasArg('--break-capacity-report'),
};
const mutations = { relation: false, hole: false, capacity: false };

// `--break-*` 只准命中真實 fixture；找不到適用樣本時於收尾列紅，不能把 no-op 當成綠燈。
const mutationTargets = { relation: null, hole: null, capacity: null };

function elementKey(el) {
  const rank = ({ node: '0', way: '1', relation: '2' })[el?.type] || '9';
  return `${rank}/${String(el?.id ?? '')}`;
}

function ordered(elements) {
  return elements.every((el, i) => !i || elementKey(elements[i - 1]).localeCompare(elementKey(el), undefined, { numeric: true }) <= 0);
}

function sourceIdOf(el) {
  return el?.type && el?.id != null ? `${el.type}/${el.id}` : null;
}

function stableObject(value) {
  if (Array.isArray(value)) return value.map(stableObject);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stableObject(value[key])]));
}

function stableJson(value) {
  return JSON.stringify(stableObject(value));
}

/**
 * Overpass 的多個 selector 會重複回傳同一 way；只有 byte-identical 重複才可折疊。
 * sourceId 仍是每個去重後 raw element 的唯一鍵，衝突的重複必須列紅。
 */
function uniqueRaw(elements) {
  const byId = new Map(), unique = [], duplicateIds = new Set(), conflicts = [];
  for (const element of elements || []) {
    const sourceId = sourceIdOf(element);
    if (!sourceId) { unique.push(element); continue; }
    const previous = byId.get(sourceId);
    if (!previous) {
      byId.set(sourceId, element);
      unique.push(element);
      continue;
    }
    duplicateIds.add(sourceId);
    if (stableJson(previous) !== stableJson(element)) conflicts.push(sourceId);
  }
  return {
    unique: unique.slice().sort((a, b) => elementKey(a).localeCompare(elementKey(b), undefined, { numeric: true })),
    duplicateIds: [...duplicateIds].sort(),
    conflicts: [...new Set(conflicts)].sort(),
  };
}

const AREA_KEYS = new Set(OSM_AREA_KEYS);
const hasAreaTag = (tags) => Object.keys(tags || {}).some((key) => AREA_KEYS.has(key));

function relationWayIds(elements) {
  const ids = new Set();
  for (const element of elements || []) {
    if (element?.type !== 'relation' || element.tags?.type !== 'multipolygon') continue;
    for (const member of element.members || []) {
      if (member?.type === 'way' && member.ref != null) ids.add(String(member.ref));
    }
  }
  return ids;
}

/** 與 buildAreaRecords 相同的候選資格；relation member way 只是邊，不是第二個面域。 */
function rawAreaCandidates(elements) {
  const memberIds = relationWayIds(elements);
  return uniqueRaw(elements).unique.filter((element) => {
    if (element?.type === 'relation') return element.tags?.type === 'multipolygon' && hasAreaTag(element.tags);
    if (element?.type !== 'way' || !element.geometry || !hasAreaTag(element.tags)) return false;
    return !memberIds.has(String(element.id)) || !!element.tags?.['building:part'];
  });
}

function flowEqual(a, b) {
  return stableJson(a) === stableJson(b);
}

function sourceTag(element) {
  const tags = element?.tags || {};
  const key = OSM_AREA_KEYS.find((candidate) => tags[candidate] != null);
  return { tagKey: key || null, tagValue: key ? String(tags[key]) : null };
}

function stableList(rows) {
  return (rows || []).slice().sort((a, b) => stableJson(a).localeCompare(stableJson(b), undefined, { numeric: true }));
}

function stablePointFeatures(pointFeatures) {
  return Object.fromEntries(Object.entries(pointFeatures || {}).map(([key, rows]) => [key,
    Array.isArray(rows) ? stableList(rows) : rows]));
}

function areaFlow(fixture, featureElements, roadElements) {
  const parsed = parseOsmFeatureElements(featureElements);
  // parser 的 pointFeatures／roads 是集合；在比較前固定集合序列，但不改 geometry 頂點方向。
  for (const rows of Object.values(parsed.pointFeatures || {})) {
    if (Array.isArray(rows)) rows.sort((a, b) => stableJson(a).localeCompare(stableJson(b), undefined, { numeric: true }));
  }
  const roads = stableList(osmRoadsFromElements(roadElements));
  const projected = parsed.areas.map((area) => projectAreaRecord(area, llToXZ, fixture.center)).filter(Boolean);
  const catalog = catalogAreas(projected);
  const gaps = mergeAreaGaps([...(parsed.areaGaps || []), ...catalog.report.gaps]);
  const surfaces = areaSurfaceRows(catalog.areas);
  const packed = placeAreaCandidates(catalog.areas, {
    maxObjects: 240, maxPerArea: 2, minGap: 1, radiusOf: () => 2,
    countOf: (area) => area.classification?.generator ? 1 : 0,
  });
  // relay 的 cap 是順序敏感的；先以穩定內容序列餵入，raw selector 重排不得換掉被保留的尾端。
  const clean = sanitizeOsmRelay({ bbox: fixture.bbox, areas: parsed.areas,
    pointFeatures: stablePointFeatures(parsed.pointFeatures), roads: stableList(roads) });
  const fit = osmRelayFit(clean);
  return { parsed, roads, projected, catalog, gaps, surfaces, packed, clean, fit };
}

function candidateAccounting(featureElements, flow) {
  const candidates = rawAreaCandidates(featureElements);
  const byId = new Map(candidates.map((element) => [sourceIdOf(element), element]));
  const candidateIds = new Set(byId.keys());
  const parserInvalidRows = (flow.parsed.areaGaps || []).filter((gap) => gap.reason !== 'capacity');
  const invalidReasons = new Map();
  const invalidIds = new Set();
  for (const gap of parserInvalidRows) {
    for (const sourceId of gap.sourceIds || []) {
      invalidIds.add(sourceId);
      if (!invalidReasons.has(sourceId)) invalidReasons.set(sourceId, gap.reason || 'geometry_invalid');
    }
  }
  const areaIds = new Set(flow.parsed.areas.map((area) => String(area.sourceId)));
  const projectedIds = new Set(flow.projected.map((area) => String(area.sourceId)));
  const projectionInvalidIds = new Set([...areaIds].filter((sourceId) => !projectedIds.has(sourceId)));
  for (const sourceId of projectionInvalidIds) {
    invalidIds.add(sourceId);
    if (!invalidReasons.has(sourceId)) invalidReasons.set(sourceId, 'projection_invalid');
  }
  const unknownInvalidIds = [...invalidIds].filter((sourceId) => !candidateIds.has(sourceId));
  const unknownAreaIds = [...areaIds].filter((sourceId) => !candidateIds.has(sourceId));
  const acceptedIds = new Set([...projectedIds].filter((sourceId) => !invalidIds.has(sourceId)));
  const capacityIds = new Set([...candidateIds].filter((sourceId) => !invalidIds.has(sourceId) && !acceptedIds.has(sourceId)));
  const classifications = { exact: 0, parentFallback: 0, unmapped: 0 };
  for (const area of flow.catalog.areas) {
    const sourceId = String(area.sourceId);
    if (!acceptedIds.has(sourceId)) continue;
    const mode = area.classification?.mode;
    if (mode === 'exact') classifications.exact++;
    else if (mode === 'parent_fallback') classifications.parentFallback++;
    else if (mode === 'unmapped') classifications.unmapped++;
  }
  const assigned = classifications.exact + classifications.parentFallback + classifications.unmapped;
  const unassignedIds = [...candidateIds].filter((sourceId) => !invalidIds.has(sourceId) && !acceptedIds.has(sourceId) && !capacityIds.has(sourceId));
  return {
    candidates, byId, candidateIds, parserInvalidRows, invalidReasons, invalidIds,
    projectionInvalidIds, areaIds, projectedIds, acceptedIds, capacityIds,
    classifications, assigned, unknownInvalidIds, unknownAreaIds, unassignedIds,
    geometryInvalid: invalidIds.size, exact: classifications.exact,
    parentFallback: classifications.parentFallback, unmapped: classifications.unmapped,
    capacityDropped: capacityIds.size,
  };
}

function expandParserGaps(flow, account) {
  const rows = [];
  for (const gap of account.parserInvalidRows) {
    if (!(gap.sourceIds || []).length) {
      rows.push({ ...gap, sourceIds: [] });
      continue;
    }
    rows.push({ ...gap, sourceIds: [...new Set(gap.sourceIds)].sort() });
  }
  for (const sourceId of account.capacityIds) {
    const tag = sourceTag(account.byId.get(sourceId));
    rows.push({ ...tag, reason: 'capacity', fallback: null, mode: 'capacity', count: 1, areaM2: 0, sourceIds: [sourceId] });
  }
  return rows;
}

function dropLedger(flow, account) {
  const rows = [];
  for (const sourceId of account.invalidIds) {
    rows.push({ sourceId, reason: account.invalidReasons.get(sourceId) || 'geometry_invalid' });
  }
  for (const sourceId of account.capacityIds) rows.push({ sourceId, reason: 'capacity' });
  for (const row of flow.packed.capacity || []) rows.push({ sourceId: row.sourceId, reason: row.reason || 'capacity' });
  for (const row of flow.packed.skipped || []) rows.push({ sourceId: row.sourceId, reason: row.reason || 'skipped' });
  if (flow.fit?.dropAreas) {
    const fitIds = new Set((flow.fit.msg?.areas || []).map((area) => String(area.sourceId)));
    for (const area of flow.clean?.areas || []) {
      if (!fitIds.has(String(area.sourceId))) rows.push({ sourceId: String(area.sourceId), reason: 'relay_capacity' });
    }
  }
  return rows;
}

function findRelationFixture(featureElements) {
  const unique = uniqueRaw(featureElements).unique;
  for (const relation of unique) {
    if (relation.type !== 'relation' || relation.tags?.type !== 'multipolygon') continue;
    const inner = (relation.members || []).find((member) => member?.type === 'way'
      && member.role === 'inner' && Array.isArray(member.geometry) && member.geometry.length >= 3);
    const outer = (relation.members || []).find((member) => member?.type === 'way'
      && member.role === 'outer' && Array.isArray(member.geometry) && member.geometry.length >= 3);
    if (inner && outer) return { relation, member: inner, outer };
  }
  return null;
}

function findCapacityFixture(featureElements, fixture) {
  const baseline = areaFlow(fixture, uniqueRaw(featureElements).unique, []);
  const account = candidateAccounting(uniqueRaw(featureElements).unique, baseline);
  if (baseline.parsed.areas.length !== OSM_AREA_LIMITS.MAX_AREAS || !account.capacityIds.size) return null;
  const sourceId = [...account.capacityIds].sort()[0];
  return sourceId ? { sourceId, baselineCapacityIds: [...account.capacityIds].sort() } : null;
}

function mutateFixture(name, fixture, featureElements) {
  if (BREAKS.relation && !mutations.relation) {
    const target = findRelationFixture(featureElements);
    if (target) {
      const expectedRef = String(target.outer.ref);
      const before = stableJson(target.outer);
      const brokenRef = `missing-${name}-${target.relation.id}-${expectedRef}`;
      let changed = false;
      for (const element of featureElements) {
        if (element?.type !== 'relation' || String(element.id) !== String(target.relation.id)
          || !Array.isArray(element.members)) continue;
        for (const member of element.members) {
          if (member?.type !== 'way' || member.role !== target.outer.role || String(member.ref) !== expectedRef) continue;
          member.ref = brokenRef;
          member.geometry = [];
          changed = true;
        }
      }
      changed = changed && before !== stableJson(target.outer);
      check(changed, `${name}:--break-real-relation mutation 已套用`);
      mutations.relation = changed;
      mutationTargets.relation = {
        name,
        relationId: `relation/${target.relation.id}`,
        memberRole: target.outer.role,
        expectedRef,
      };
    }
  }
  if (BREAKS.hole && !mutations.hole) {
    const target = findRelationFixture(featureElements);
    if (target && Array.isArray(target.member.geometry) && target.member.geometry.length >= 3) {
      const memberRef = String(target.member.ref);
      const before = stableJson(target.member.geometry);
      const brokenGeometry = target.member.geometry.slice(0, 1);
      let changed = false;
      for (const element of featureElements) {
        if (element?.type !== 'relation' || String(element.id) !== String(target.relation.id)
          || !Array.isArray(element.members)) continue;
        for (const member of element.members) {
          if (member?.type !== 'way' || member.role !== 'inner' || String(member.ref) !== memberRef) continue;
          member.geometry = brokenGeometry;
          changed = true;
        }
      }
      changed = changed && before !== stableJson(brokenGeometry);
      check(changed, `${name}:--break-real-hole mutation 已套用`);
      mutations.hole = changed;
      mutationTargets.hole = { name, relationId: `relation/${target.relation.id}`, memberRef };
    }
  }
  if (BREAKS.capacity && !mutations.capacity) {
    const original = uniqueRaw(featureElements).unique;
    const target = findCapacityFixture(original, fixture);
    if (target) {
      const before = featureElements.length;
      const kept = featureElements.filter((element) => sourceIdOf(element) !== target.sourceId);
      featureElements.splice(0, featureElements.length, ...kept);
      const changed = featureElements.length < before;
      check(changed, `${name}:--break-capacity-report mutation 已套用`);
      mutations.capacity = changed;
      mutationTargets.capacity = { name, sourceId: target.sourceId, baselineCapacityIds: target.baselineCapacityIds };
    }
  }
}

function nearestRoad(x, z, roads, center) {
  let best = { distanceM: Infinity, road: null };
  for (const road of roads) {
    const p = road.geometry.map((q) => llToXZ(q.lat, q.lon ?? q.lng, center));
    for (let i = 1; i < p.length; i++) {
      const [ax, az] = p[i - 1], [bx, bz] = p[i];
      const dx = bx - ax, dz = bz - az, l2 = dx * dx + dz * dz || 1;
      const t = Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / l2));
      const distanceM = Math.hypot(x - ax - (dx * t), z - az - (dz * t));
      if (distanceM < best.distanceM) best = { distanceM, road };
    }
  }
  return best;
}

function routeCoverage(fixture, roadElements) {
  const venue = VENUES.find((item) => item.id === (fixture.venue?.id || fixture.name));
  if (!venue || fixture.team !== 5) return { applicable: false, points: 0, misses: 0, missingPoints: [] };
  const cfg = venueConfig(venue, fixture.team);
  const points = cfg.lanes.flat();
  const missingPoints = [];
  points.forEach((p, index) => {
    const [x, z] = llToXZ(p[0], p[1], fixture.center);
    const nearest = nearestRoad(x, z, roadElements, fixture.center);
    if (nearest.distanceM > 80) {
      const road = nearest.road;
      missingPoints.push({
        index, point: p, distanceM: nearest.distanceM,
        nearestRoad: road ? { type: road.type, id: road.id, highway: road.tags?.highway, name: road.tags?.name } : null,
      });
    }
  });
  if (cfg.synthetic) {
    return {
      applicable: false, verified: false, reason: 'venueConfig 使用 synthetic fallback，沒有 baked OSM 兵線可比對',
      points: points.length, misses: missingPoints.length, missingPoints,
    };
  }
  return { applicable: true, verified: true, points: points.length, misses: missingPoints.length, missingPoints };
}

function inspect(name) {
  const file = join(DIR, `${name}.json`);
  const fixture = JSON.parse(readFileSync(file, 'utf8'));
  const featureElements = fixture.responses?.features?.elements;
  const roadElements = fixture.responses?.roads?.elements;
  check(fixture.version === FIXTURE_VERSION && fixture.schema === 'osm-fixture-v1', `${name}:fixture schema/version`);
  check(Array.isArray(featureElements) && Array.isArray(roadElements), `${name}:保留兩份 raw Overpass response`);
  if (!Array.isArray(featureElements) || !Array.isArray(roadElements)) return { name, error: 'invalid response' };
  mutateFixture(name, fixture, featureElements);
  const rawFeatures = uniqueRaw(featureElements);
  const rawRoads = uniqueRaw(roadElements);
  const missingRawIds = [...rawFeatures.unique, ...rawRoads.unique].filter((element) => !sourceIdOf(element));
  check(missingRawIds.length === 0, `${name}:raw element source ID 完整`);
  check(rawFeatures.conflicts.length === 0 && rawRoads.conflicts.length === 0,
    `${name}:重複 raw sourceId 僅允許 byte-identical selector 結果`);
  check(new Set(rawFeatures.unique.map(sourceIdOf)).size === rawFeatures.unique.length
    && new Set(rawRoads.unique.map(sourceIdOf)).size === rawRoads.unique.length,
  `${name}:去重後 raw sourceId 唯一(重複 selector=${rawFeatures.duplicateIds.length})`);
  check(ordered(featureElements) && ordered(roadElements), `${name}:raw element 輸出排序穩定`);
  check(featureElements.some((el) => el.id != null && el.tags && typeof el.tags === 'object'), `${name}:raw source ID/tags 未被抹除`);
  check(fixture.queries?.features?.version === OSM_FEATURE_QUERY_VERSION
    && fixture.queries?.roads?.version === OSM_ROAD_QUERY_VERSION
    && fixture.queries?.features?.text === fixtureQueries(fixture).features
    && fixture.queries?.roads?.text === fixtureQueries(fixture).roads, `${name}:fixture query 與正式 query builder 逐字一致`);
  const fq = osmFeatureQuotas(fixture.bbox), rq = osmRoadQuotas(fixture.bbox);
  check(JSON.stringify(fixture.queries?.features?.quotas) === JSON.stringify(fq)
    && JSON.stringify(fixture.queries?.roads?.quotas) === JSON.stringify(rq), `${name}:query 額度與 bbox 推導一致`);
  check(fixture.queries?.features?.text === osmFeatureQuery(fixture.bbox)
    && fixture.queries?.roads?.text === osmRoadQuery(fixture.bbox), `${name}:feature/road selector 版本未漂移`);

  // 後續流程只吃 sourceId 去重、按 ID 排好的 raw；Overpass selector 重疊不可製造第二份 AreaRecord。
  const flow = areaFlow(fixture, rawFeatures.unique, rawRoads.unique);
  const reorderedFlow = areaFlow(fixture, rawFeatures.unique.slice().reverse(), rawRoads.unique.slice().reverse());
  const account = candidateAccounting(rawFeatures.unique, flow);
  const parsed = flow.parsed;
  const roads = flow.roads;
  const venue = VENUES.find((item) => item.id === (fixture.venue?.id || fixture.name));
  if (venue && fixture.team === 5) {
    const expected = battleBBox(venueConfig(venue, fixture.team));
    const close = (a, b) => Math.abs(a - b) < 1e-9;
    check(['minLat', 'minLng', 'maxLat', 'maxLng'].every((key) => close(fixture.bbox?.[key], expected[key])),
      `${name}:bbox 與目前 venueConfig 一致`);
    const current = venueConfig(venue, fixture.team).center;
    check(['lat', 'lng', 'rot'].every((key) => close(fixture.center?.[key], current[key])),
      `${name}:投影中心／旋轉與目前 venueConfig 一致`);
  }
  const { projected, catalog, gaps, surfaces, packed, clean, fit } = flow;
  const fitBytes = fit ? bytes(fit.msg) : 0;
  const relations = rawFeatures.unique.filter((el) => el.type === 'relation' && el.tags?.type === 'multipolygon');
  const relationCount = relations.length;
  const relationMissingMembers = relations.filter((el) => !Array.isArray(el.members)
    || !el.members.length || el.members.some((member) => !member.type || member.ref == null || !member.role)).length;
  const rawInnerCount = relations.reduce((n, el) => n + (Array.isArray(el.members)
    ? el.members.filter((member) => member.role === 'inner').length
    : 0), 0);
  const holeCount = projected.reduce((n, area) => n + area.worldPolygons.reduce((m, p) => m + (p.holes?.length || 0), 0), 0);
  const coverage = routeCoverage(fixture, rawRoads.unique);
  const areaSourceIds = parsed.areas.map((area) => String(area.sourceId));
  const candidateSourceIds = [...account.candidateIds].sort();
  const acceptedSourceIds = [...account.acceptedIds].sort();
  const invalidSourceIds = [...account.invalidIds].sort();
  const capacitySourceIds = [...account.capacityIds].sort();
  const drops = dropLedger(flow, account);
  const rawCandidateGaps = expandParserGaps(flow, account);
  const reportGaps = mergeAreaGaps([...rawCandidateGaps, ...catalog.report.gaps]);

  check(Number.isFinite(fixture.bbox?.minLat) && fixture.bbox.maxLat > fixture.bbox.minLat
    && fixture.bbox.maxLng > fixture.bbox.minLng, `${name}:bbox 合法`);
  check(parsed.areas.length > 0, `${name}:raw → AreaRecord 有面域(${parsed.areas.length})`);
  check(new Set(areaSourceIds).size === areaSourceIds.length, `${name}:AreaRecord sourceId 唯一`);
  check(flowEqual(flow, reorderedFlow), `${name}:raw elements 重排後 parser/catalog/gaps/relay fit 逐位元一致`);
  check(projected.length === parsed.areas.length, `${name}:所有 AreaRecord 都能投影`);
  check(surfaces.length >= projected.length, `${name}:world polygon／holes 進入地貌 surface rows`);
  check(clean !== null && fit !== null, `${name}:relay sanitize + fit 成功`);
  check(fitBytes > 0 && fitBytes <= OSM_RELAY.MAX_BYTES, `${name}:中繼 ${Math.ceil(fitBytes / 1024)}KB ≤ ${Math.ceil(OSM_RELAY.MAX_BYTES / 1024)}KB`);
  const cleanAgain = clean && sanitizeOsmRelay(clean);
  const fitClean = fit && sanitizeOsmRelay(fit.msg);
  check(clean && cleanAgain && stableJson(clean) === stableJson(cleanAgain), `${name}:sanitize 冪等(完整輸出逐位元一致)`);
  check(fit && fitClean && stableJson(fitClean) === stableJson(sanitizeOsmRelay(fitClean)),
    `${name}:fit 後再 sanitize 冪等(完整輸出逐位元一致)`);
  check(relationMissingMembers === 0, `${name}:multipolygon relation member ref/role 未遺失(${relationCount} relations)`);
  if (mutationTargets.relation?.name === name) {
    const targetRelation = relations.find((relation) => `relation/${relation.id}` === mutationTargets.relation.relationId);
    const intact = targetRelation?.members?.some((member) => member.role === mutationTargets.relation.memberRole
      && String(member.ref) === mutationTargets.relation.expectedRef);
    check(intact, `${name}:--break-real-relation 應被固定 member ref 攔截`);
  }
  check(rawInnerCount === 0 || rawInnerCount === holeCount,
    `${name}:每個 raw inner member 都進入 projected holes(${rawInnerCount} inner / ${holeCount} holes)`);
  check(account.unknownInvalidIds.length === 0 && account.unknownAreaIds.length === 0,
    `${name}:parser invalid／AreaRecord sourceId 都可回指 raw candidate`);
  check(account.assigned === account.acceptedIds.size,
    `${name}:accepted 分類互斥(${account.exact} exact / ${account.parentFallback} parentFallback / ${account.unmapped} unmapped)`);
  check(account.geometryInvalid + account.exact + account.parentFallback + account.unmapped + account.capacityDropped
    === account.candidateIds.size && account.unassignedIds.length === 0,
  `${name}:raw candidate 守恆到 accepted/invalid/capacityDropped(${account.candidateIds.size})`);
  check((parsed.areaCapacity || 0) === account.capacityDropped,
    `${name}:capacityDropped 與 parser capacity 一致(${account.capacityDropped})`);
  check(drops.every((drop) => /^(?:node|way|relation)\/.+$/u.test(String(drop.sourceId))
    && account.candidateIds.has(String(drop.sourceId))
    && typeof drop.reason === 'string' && drop.reason.length > 0),
  `${name}:所有 area/placement drop 都帶 reason 與 sourceId(${drops.length})`);
  if (mutationTargets.capacity?.name === name) {
    check(JSON.stringify(capacitySourceIds) === JSON.stringify(mutationTargets.capacity.baselineCapacityIds),
      `${name}:--break-capacity-report 應被固定 baseline capacity sourceIds 攔截`);
  }
  if (coverage.applicable) check(coverage.misses === 0, `${name}:baked 預算兵線 ${coverage.points} 點全部落在 fixture road geometry`);
  else if (coverage.reason) check(false, `${name}:${coverage.reason}`);

  console.log(`  ${name}: ${bboxKm2(fixture.bbox).toFixed(3)}km² / raw feature ${featureElements.length}`
    + ` / raw road ${roadElements.length} / areas ${parsed.areas.length} / roads ${roads.length}`);
  console.log(`    指標 geometryInvalid=${account.geometryInvalid} exact=${account.exact}`
    + ` parentFallback=${account.parentFallback} unmapped=${account.unmapped}`
    + ` capacityDropped=${account.capacityDropped}`);
  console.log(`    relation=${relationCount} holes=${holeCount} pointFeatures=`
    + `${Object.values(parsed.pointFeatures).reduce((n, list) => n + list.length, 0)}`
    + ` packed=${packed.placed.length} skipped=${packed.skipped.length}`
    + ` packedCapacity=${packed.capacity.length} relayDrop=${clean?.drop || 0}`);
  if (coverage.applicable) console.log(`    routeCoverage=${coverage.points - coverage.misses}/${coverage.points}`);
  else if (coverage.reason) console.log(`    routeCoverage=未驗(${coverage.reason}) syntheticProbe=${coverage.points - coverage.misses}/${coverage.points}`);
  if (coverage.missingPoints?.length) {
    for (const miss of coverage.missingPoints.slice(0, 12)) {
      const road = miss.nearestRoad;
      console.log(`    routeMiss[${miss.index}] ${miss.point[0].toFixed(6)},${miss.point[1].toFixed(6)}`
        + ` nearest=${road ? `${road.type}/${road.id} highway=${road.highway || '-'}` : 'none'}`
        + ` distance=${miss.distanceM.toFixed(1)}m`);
    }
  }
  if (reportGaps.length) {
    console.log('    缺件候選:');
    for (const gap of reportGaps.slice(0, 20)) console.log(`      ${gap.tagKey || 'tag'}=${gap.tagValue || ''}`
      + ` reason=${gap.reason} fallback=${gap.fallback || '-'} count=${gap.count}`
      + ` areaM2=${Number(gap.areaM2 || 0).toFixed(3)}`
      + ` sourceIds=${(gap.sourceIds || []).join(',')}`);
  }
  return {
    name, bboxKm2: bboxKm2(fixture.bbox), rawFeatureElements: featureElements.length,
    rawRoadElements: roadElements.length, areas: parsed.areas.length, roads: roads.length,
    rawUniqueFeatureElements: rawFeatures.unique.length, rawUniqueRoadElements: rawRoads.unique.length,
    rawDuplicateFeatureSourceIds: rawFeatures.duplicateIds.length,
    sourceIds: { candidates: candidateSourceIds, accepted: acceptedSourceIds,
      geometryInvalid: invalidSourceIds, capacityDropped: capacitySourceIds, areaRecords: areaSourceIds },
    report: {
      geometryInvalid: account.geometryInvalid, exact: account.exact,
      parentFallback: account.parentFallback, unmapped: account.unmapped,
      capacityDropped: account.capacityDropped, gaps: reportGaps,
      capacity: { areaRecords: account.capacityDropped, packed: packed.capacity.length, relayAreas: fit?.dropAreas || 0 },
    },
    relationCount, holeCount,
    pointFeatures: Object.fromEntries(Object.entries(parsed.pointFeatures).map(([k, v]) => [k, v.length])),
    relayBytes: fitBytes, relayDrop: clean?.drop || 0, drops,
    routeCoverage: coverage,
  };
}

const GAP_KEY_IMPORTANCE = Object.freeze({
  building: 100, 'building:part': 98, waterway: 94, water: 92, natural: 88,
  landuse: 82, leisure: 76, amenity: 72, railway: 68, power: 66, man_made: 62,
  public_transport: 58, sport: 56, tourism: 52, historic: 48,
});
const GAP_REASON_IMPORTANCE = Object.freeze({
  missing_outer: 30, orphan_inner: 28, invalid_ring: 26, projection_invalid: 24,
  capacity: 20, unknown_building_value: 12, unknown_area_value: 10,
});

function gapImportance(gap) {
  return (GAP_KEY_IMPORTANCE[gap?.tagKey] || 0) + (GAP_REASON_IMPORTANCE[gap?.reason] || 0);
}

function aggregateGaps(results) {
  const map = new Map();
  for (const result of results) {
    for (const gap of result.report?.gaps || []) {
      const key = `${gap?.tagKey || ''}|${gap?.tagValue || ''}|${gap?.reason || ''}|${gap?.fallback || ''}`;
      const row = map.get(key) || {
        tagKey: gap?.tagKey || null, tagValue: gap?.tagValue || null,
        reason: gap?.reason || 'unknown', fallback: gap?.fallback || null,
        count: 0, areaM2: 0, fixtureCount: 0, sourceIds: [], fixtures: new Set(),
      };
      row.count += Number(gap?.count) || 1;
      row.areaM2 += Number(gap?.areaM2) || 0;
      row.fixtures.add(result.name);
      for (const sourceId of gap?.sourceIds || []) {
        if (row.sourceIds.length < 5 && !row.sourceIds.includes(sourceId)) row.sourceIds.push(sourceId);
      }
      map.set(key, row);
    }
  }
  return [...map.values()].map((row) => ({ ...row, fixtureCount: row.fixtures.size, importance: gapImportance(row) }))
    .sort((a, b) => b.count - a.count || b.areaM2 - a.areaM2 || b.importance - a.importance
      || String(a.tagKey).localeCompare(String(b.tagKey)) || String(a.tagValue).localeCompare(String(b.tagValue))
      || String(a.reason).localeCompare(String(b.reason)) || String(a.fallback).localeCompare(String(b.fallback)));
}

const names = (ONLY.size ? [...ONLY] : readdirSync(DIR).filter((file) => file.endsWith('.json')).map((file) => file.slice(0, -5))).sort();
if (!names.length) { console.error(`❌ 找不到 fixture：${DIR}`); process.exit(2); }
const results = [];
for (const name of names) {
  try { results.push(inspect(name)); }
  catch (error) { fail++; console.error(`    ✗ ${name}:稽核拋出例外 —— ${error.message}`); }
}
for (const [kind, enabled] of Object.entries(BREAKS)) {
  if (enabled && !mutations[kind]) {
    fail++;
    const flag = kind === 'capacity' ? '--break-capacity-report' : `--break-real-${kind}`;
    console.error(`    ✗ ${flag}: 找不到適用的真實 fixture，反向驗證未執行`);
  }
}
const gapSummary = aggregateGaps(results);
if (gapSummary.length) {
  console.log('\n跨 fixture 缺件聚合(依 count/areaM2/遊戲辨識重要性):');
  for (const gap of gapSummary) console.log(`  ${gap.tagKey || 'tag'}=${gap.tagValue || ''}`
    + ` reason=${gap.reason} fallback=${gap.fallback || '-'} count=${gap.count}`
    + ` areaM2=${gap.areaM2.toFixed(3)} fixture數=${gap.fixtureCount}`
    + ` sourceIds=${gap.sourceIds.join(',')} importance=${gap.importance}`);
}
if (OUT) writeFileSync(OUT, JSON.stringify({ version: 1, results, gaps: gapSummary }, null, 2) + '\n');
console.log(`\n${fail ? '❌' : '✅'} OSM fixture 稽核：${pass} 綠 / ${fail} 紅`);
process.exit(fail ? 1 : 0);
