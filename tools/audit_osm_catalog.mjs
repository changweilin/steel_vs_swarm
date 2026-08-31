// ============ OSM 全域面域／型錄／精確幾何稽核 ============
// 只執行 osmAreas.js 的純資料縫，不啟動瀏覽器、不查網路、不依賴 Three.js。
// 驗證 closed way、multipolygon 多外環／內洞、分類優先序、父類回退、無效幾何、
// 輸入重排決定性、投影後面積、區域內候選與同輪 sibling 占位。反向旗標會刻意破壞
// 對應測資，確保稽核不是永遠綠：--break-relation --break-hole --break-order
// --break-fallback --break-footprint --break-gap --break-sibling。
import {
  AREA_CATALOG, BUILDING_CATALOG, areaCandidates, buildAreaRecords, catalogAreas,
  classifyArea, placeAreaCandidates, pointInProjectedArea, projectAreaRecord,
} from '../public/js/osmAreas.js';
import fs from 'node:fs';

const argv = process.argv;
const BREAK = (name) => argv.includes(`--break-${name}`);
let pass = 0, fail = 0;
const t = (name, ok, extra = '') => ok ? (pass++, console.log(`  ✓ ${name}`)) : (fail++, console.log(`  ✗ ${name}${extra ? ` ${extra}` : ''}`));
const sq = (lat, lon, size = 10) => [
  { lat, lon }, { lat, lon: lon + size }, { lat: lat + size, lon: lon + size },
  { lat: lat + size, lon }, { lat, lon },
];
const way = (id, geometry, tags = {}) => ({ type: 'way', id, tags, geometry });

const relationWays = [
  way(101, sq(0, 0), {}),
  way(102, sq(20, 0), {}),
  way(103, sq(2, 2, 3), {}),
];
const relation = {
  type: 'relation', id: 900, tags: { type: 'multipolygon', landuse: 'park', name: '測試公園' },
  members: [
    { type: 'way', ref: 101, role: 'outer' }, { type: 'way', ref: 102, role: 'outer' },
    { type: 'way', ref: 103, role: 'inner' },
  ],
};
const elems = [
  ...relationWays, relation,
  way(201, sq(40, 0), { building: 'yes', amenity: 'school' }),
  way(202, sq(60, 0), { building: 'mystery', landuse: 'commercial' }),
  way(203, sq(80, 0), { building: 'mystery' }),
  way(204, [{ lat: 100, lon: 0 }, { lat: 110, lon: 10 }, { lat: 100, lon: 10 }, { lat: 110, lon: 0 }, { lat: 100, lon: 0 }], { landuse: 'park' }),
  way(205, sq(120, 0), { landuse: 'future_unknown' }),
];
const reordered = [...elems].reverse().map((e) => e.type === 'relation'
  ? { ...e, members: e.members.slice().reverse() } : e);
const first = buildAreaRecords(elems);
const second = buildAreaRecords(reordered);
t('closed way 與 multipolygon 都保留為面域', first.areas.some((a) => a.sourceId === 'way/201') && first.areas.some((a) => a.sourceId === 'relation/900'));
const relArea = first.areas.find((a) => a.sourceId === 'relation/900');
t('multipolygon 支援多外環與內洞', relArea?.polygons.length === 2 && relArea.polygons.some((p) => p.holes.length === 1));
t('relation member 缺段會列 invalid，不靜默補線', buildAreaRecords([...relationWays, { ...relation, members: [{ type: 'way', ref: 999, role: 'outer' }] }]).invalid > 0);
t('輸入元素／relation member 重排後逐位元相同', JSON.stringify(first) === JSON.stringify(second));
t('自交環略過並列 invalid', first.invalid > 0 && first.invalidItems.some((x) => x.sourceId === 'way/204'));

const school = classifyArea({ building: 'yes', amenity: 'school' });
const commercialFallback = classifyArea({ building: 'mystery' }, { parent: AREA_CATALOG.commercial });
const unknown = classifyArea({ building: 'mystery' });
t('功能標籤優先於 building 值', school.kind === BUILDING_CATALOG.school.kind && school.exact === true);
t('未知 building 使用可信父類並標 parent_fallback', commercialFallback.mode === 'parent_fallback' && commercialFallback.fallback === 'commercial');
t('沒有可信父類不生成誤導物件而列 unmapped', unknown.mode === 'unmapped' && unknown.generator === null);
t('未知 landuse 不會武斷回退住宅', classifyArea({ landuse: 'future_unknown' }).mode === 'unmapped');
t('landuse village_green 與 sport 走區域型錄', classifyArea({ landuse: 'village_green' }).kind === 'park' && classifyArea({ sport: 'soccer' }).kind === 'sports');
const projected = first.areas.map((a) => projectAreaRecord(a, (lat, lon) => [lon, lat], {})).filter(Boolean);
const square = projectAreaRecord({ sourceId: 'square', tags: {}, polygons: [{ outer: sq(0, 0, 10), holes: [] }] }, (lat, lon) => [lon, lat], {});
t('投影後 areaM2 使用 world polygon shoelace', Math.abs(square.areaM2 - 100) < 1e-9);
const courtyard = projectAreaRecord({ sourceId: 'courtyard', tags: {}, polygons: [{ outer: sq(0, 0, 10), holes: [sq(2, 2, 3)] }] }, (lat, lon) => [lon, lat], {});
t('holes 不封死且扣除面積', Math.abs(courtyard.areaM2 - 91) < 1e-9 && pointInProjectedArea(1, 1, courtyard.worldPolygons[0]) && !pointInProjectedArea(3, 3, courtyard.worldPolygons[0]));

const syntheticArea = projected.find((a) => a.sourceId === 'way/201') || square;
const candidates = areaCandidates(syntheticArea, 16);
t('候選落點全部在 outer 內且不進 holes', candidates.length > 0 && candidates.every((p) => syntheticArea.worldPolygons.some((poly) => pointInProjectedArea(p.x, p.z, poly))));
const packed = placeAreaCandidates([syntheticArea, courtyard], { maxObjects: 8, maxPerArea: 4, radiusOf: () => 2, minGap: 1 });
let noSiblingClash = true;
for (let i = 0; i < packed.placed.length; i++) for (let j = i + 1; j < packed.placed.length; j++) {
  const a = packed.placed[i], b = packed.placed[j];
  if (Math.hypot(a.x - b.x, a.z - b.z) < a.radius + b.radius + 1 - 1e-9) noSiblingClash = false;
}
t('同輪新增物件做 pairwise 占位檢查', noSiblingClash && packed.placed.every((p) => Number.isFinite(p.x) && Number.isFinite(p.z)));
const cat = catalogAreas(projected);
t('缺項報表保留 tag key/value、原因與來源 ID', cat.report.gaps.some((g) => g.tagKey === 'building' && g.reason === 'unknown_building_value')
  && cat.report.gaps.every((g) => Array.isArray(g.sourceIds) && g.sourceIds.length <= 5));
const nested = [
  projectAreaRecord({ sourceId: 'land/commercial', tags: { landuse: 'commercial' }, polygons: [{ outer: sq(0, 0, 20), holes: [] }] }, (lat, lon) => [lon, lat], {}),
  projectAreaRecord({ sourceId: 'building/unknown', tags: { building: 'yes' }, polygons: [{ outer: sq(3, 3, 4), holes: [] }] }, (lat, lon) => [lon, lat], {}),
];
const nestedBuilding = catalogAreas(nested).areas.find((a) => a.sourceId === 'building/unknown');
t('未知建築依實際 containment 使用父用地 fallback', nestedBuilding?.classification.mode === 'parent_fallback'
  && nestedBuilding.classification.family === 'commercial');

const buildingSrc = fs.readFileSync(new URL('../public/js/osmBuilding.js', import.meta.url), 'utf8');
const objectSrc = fs.readFileSync(new URL('../public/js/osmAreaObjects.js', import.meta.url), 'utf8');
const biomesSrc = fs.readFileSync(new URL('../public/js/biomes.js', import.meta.url), 'utf8');
const mainSrc = fs.readFileSync(new URL('../public/js/main.js', import.meta.url), 'utf8');
t('精確屋頂由 outer + holes 建立，不使用外接方盒平台', /new THREE\.Shape\(\)/.test(buildingSrc)
  && /shape\.holes\.push\(path\)/.test(buildingSrc) && /platforms\.push\(\{/.test(buildingSrc));
t('牆面與權威 blocker 共用同一 edgeGeometry 邊段', /const outer = edgeGeometry/.test(buildingSrc)
  && /batch\.walls\.push\(\.\.\.outer\.geos\); blockers\.push\(\.\.\.outer\.edges\)/.test(buildingSrc));
t('靜態牆面／屋頂按建物 kind 合批', /batches\.get\(kind\)/.test(buildingSrc)
  && /mergeGeometries\(batch\.walls/.test(buildingSrc) && /mergeGeometries\(batch\.roofs/.test(buildingSrc));
t('每個建築細分類都有立面／屋頂型錄列', Object.keys(BUILDING_CATALOG).every((kind) =>
  new RegExp(`\\b${kind}: \\{ wall: 0x[0-9a-f]+, roof: 0x[0-9a-f]+, attachment:`, 'i').test(buildingSrc)));
t('識別附件先驗完整輪廓與 holes，塞不下即略過', /function attachmentSite\(poly, half\)/.test(buildingSrc)
  && /!poly\.holes\.some/.test(buildingSrc) && /if \(!site\) return null/.test(buildingSrc)
  && /mergeGeometries\(batch\.details/.test(buildingSrc));
t('用地物件共用決定性配置縫且零 Math.random', /placeAreaCandidates\(eligible/.test(objectSrc)
  && /countOf:/.test(objectSrc) && !/Math\.random\(/.test(objectSrc));
t('OSM 成功含零 area 時停用程序城市 fallback', /const osmSource = osmData !== null/.test(biomesSrc)
  && /if \(!osmSource &&/.test(biomesSrc) && /if \(!osmSource && infillSeeds\.length\)/.test(biomesSrc));
t('屋頂站立查詢保留 holes', /function makeRoofPlatformIndex/.test(mainSrc)
  && /\(p\.holes \|\| \[\]\)\.some/.test(mainSrc) && /roofPlatformAt\(x, z\)/.test(mainSrc));

// 反向測試：旗標只改測資／期望，若對應不變式消失則本輪必紅。
if (BREAK('relation')) t('--break-relation 反向驗證', buildAreaRecords([...relationWays, { ...relation, members: [{ type: 'way', ref: 999, role: 'outer' }] }]).areas.length === 1);
if (BREAK('hole')) t('--break-hole 反向驗證', pointInProjectedArea(3, 3, projectAreaRecord({ sourceId: 'broken-hole', tags: {}, polygons: [{ outer: sq(0, 0, 10), holes: [sq(20, 20, 3)] }] }, (lat, lon) => [lon, lat], {}).worldPolygons[0]) === false);
if (BREAK('order')) t('--break-order 反向驗證', JSON.stringify(first) === JSON.stringify(buildAreaRecords(elems.map((e) => e.type === 'way' && e.id === 101 ? { ...e, geometry: [e.geometry[0], e.geometry[2], e.geometry[1], e.geometry[3], e.geometry[0]] } : e))));
if (BREAK('fallback')) t('--break-fallback 反向驗證', classifyArea({ building: 'mystery' }).mode === 'parent_fallback');
if (BREAK('footprint')) t('--break-footprint 反向驗證', Math.abs(square.areaM2 - 101) < 1e-9);
if (BREAK('gap')) t('--break-gap 反向驗證', cat.report.gaps.length === 0);
if (BREAK('sibling')) t('--break-sibling 反向驗證', !noSiblingClash);

console.log(`\n${fail ? '❌' : '✅'} OSM 型錄稽核：${pass} 綠 / ${fail} 紅`);
process.exit(fail ? 1 : 0);
