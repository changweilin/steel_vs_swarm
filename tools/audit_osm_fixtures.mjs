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
  areaSurfaceRows, catalogAreas, mergeAreaGaps, placeAreaCandidates, projectAreaRecord,
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

function elementKey(el) {
  const rank = ({ node: '0', way: '1', relation: '2' })[el?.type] || '9';
  return `${rank}/${String(el?.id ?? '')}`;
}

function ordered(elements) {
  return elements.every((el, i) => !i || elementKey(elements[i - 1]).localeCompare(elementKey(el), undefined, { numeric: true }) <= 0);
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

  const parsed = parseOsmFeatureElements(featureElements);
  const roads = osmRoadsFromElements(roadElements);
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
  const projected = parsed.areas.map((area) => projectAreaRecord(area, llToXZ, fixture.center)).filter(Boolean);
  const catalog = catalogAreas(projected);
  const gaps = mergeAreaGaps([...(parsed.areaGaps || []), ...catalog.report.gaps]);
  const surfaces = areaSurfaceRows(catalog.areas);
  const packed = placeAreaCandidates(catalog.areas, {
    maxObjects: 240, maxPerArea: 2, minGap: 1, radiusOf: () => 2,
    countOf: (area) => area.classification?.generator ? 1 : 0,
  });
  const clean = sanitizeOsmRelay({ bbox: fixture.bbox, areas: parsed.areas, pointFeatures: parsed.pointFeatures, roads });
  const fit = osmRelayFit(clean);
  const fitBytes = fit ? bytes(fit.msg) : 0;
  const relations = featureElements.filter((el) => el.type === 'relation' && el.tags?.type === 'multipolygon');
  const relationCount = relations.length;
  const relationMissingMembers = relations.filter((el) => !Array.isArray(el.members)
    || !el.members.length || el.members.some((member) => !member.type || member.ref == null || !member.role)).length;
  const rawInnerCount = relations.reduce((n, el) => n + el.members.filter((member) => member.role === 'inner').length, 0);
  const holeCount = projected.reduce((n, area) => n + area.worldPolygons.reduce((m, p) => m + (p.holes?.length || 0), 0), 0);
  const coverage = routeCoverage(fixture, roadElements);

  check(Number.isFinite(fixture.bbox?.minLat) && fixture.bbox.maxLat > fixture.bbox.minLat
    && fixture.bbox.maxLng > fixture.bbox.minLng, `${name}:bbox 合法`);
  check(parsed.areas.length > 0, `${name}:raw → AreaRecord 有面域(${parsed.areas.length})`);
  check(projected.length === parsed.areas.length, `${name}:所有 AreaRecord 都能投影`);
  check(surfaces.length >= projected.length, `${name}:world polygon／holes 進入地貌 surface rows`);
  check(clean !== null && fit !== null, `${name}:relay sanitize + fit 成功`);
  check(fitBytes > 0 && fitBytes <= OSM_RELAY.MAX_BYTES, `${name}:中繼 ${Math.ceil(fitBytes / 1024)}KB ≤ ${Math.ceil(OSM_RELAY.MAX_BYTES / 1024)}KB`);
  check(fit && sanitizeOsmRelay(fit.msg) !== null, `${name}:fit message 可被伺服器端再次淨化`);
  check(relationMissingMembers === 0, `${name}:multipolygon relation member ref/role 未遺失(${relationCount} relations)`);
  check(rawInnerCount === 0 || holeCount > 0, `${name}:raw inner members 有進入 projected holes(${rawInnerCount} inner / ${holeCount} holes)`);
  if (coverage.applicable) check(coverage.misses === 0, `${name}:baked 預算兵線 ${coverage.points} 點全部落在 fixture road geometry`);
  else if (coverage.reason) check(false, `${name}:${coverage.reason}`);

  console.log(`  ${name}: ${bboxKm2(fixture.bbox).toFixed(3)}km² / raw feature ${featureElements.length}`
    + ` / raw road ${roadElements.length} / areas ${parsed.areas.length} / roads ${roads.length}`);
  console.log(`    分類 exact=${catalog.report.exact} parentFallback=${catalog.report.parentFallback}`
    + ` unmapped=${catalog.report.unmapped} invalid=${(parsed.areaInvalid || 0) + catalog.report.invalid}`
    + ` capacity=${(parsed.areaCapacity || 0) + catalog.report.capacity}`);
  console.log(`    relation=${relationCount} holes=${holeCount} pointFeatures=`
    + `${Object.values(parsed.pointFeatures).reduce((n, list) => n + list.length, 0)}`
    + ` packed=${packed.placed.length} skipped=${packed.skipped.length} relayDrop=${clean?.drop || 0}`);
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
  if (gaps.length) {
    console.log('    缺件候選:');
    for (const gap of gaps.slice(0, 20)) console.log(`      ${gap.tagKey || 'tag'}=${gap.tagValue || ''}`
      + ` reason=${gap.reason} fallback=${gap.fallback || '-'} count=${gap.count}`
      + ` sourceIds=${(gap.sourceIds || []).join(',')}`);
  }
  return {
    name, bboxKm2: bboxKm2(fixture.bbox), rawFeatureElements: featureElements.length,
    rawRoadElements: roadElements.length, areas: parsed.areas.length, roads: roads.length,
    report: { ...catalog.report, gaps }, relationCount, holeCount,
    pointFeatures: Object.fromEntries(Object.entries(parsed.pointFeatures).map(([k, v]) => [k, v.length])),
    relayBytes: fitBytes, relayDrop: clean?.drop || 0,
    routeCoverage: coverage,
  };
}

const names = (ONLY.size ? [...ONLY] : readdirSync(DIR).filter((file) => file.endsWith('.json')).map((file) => file.slice(0, -5))).sort();
if (!names.length) { console.error(`❌ 找不到 fixture：${DIR}`); process.exit(2); }
const results = [];
for (const name of names) {
  try { results.push(inspect(name)); }
  catch (error) { fail(`${name}:稽核拋出例外 —— ${error.message}`); }
}
if (OUT) writeFileSync(OUT, JSON.stringify({ version: 1, results }, null, 2) + '\n');
console.log(`\n${fail ? '❌' : '✅'} OSM fixture 稽核：${pass} 綠 / ${fail} 紅`);
process.exit(fail ? 1 : 0);
