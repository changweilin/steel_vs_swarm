// ============ OSM 面域型錄報表 CLI ============
// 與執行期共用 osmAreas.js 的建構、投影、分類與 gap 產生器；本工具不查網路。
// 用法：node tools/osm_catalog.mjs --scene-cache <file> [--json <path>]
import fs from 'node:fs';
import path from 'node:path';
import { buildAreaRecords, catalogAreas, mergeAreaGaps, projectAreaRecord } from '../public/js/osmAreas.js';
import { llToXZ } from '../public/js/data.js';

const arg = (name) => {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : null;
};
const cachePath = arg('--scene-cache');
const jsonPath = arg('--json');
if (!cachePath) {
  console.error('缺少 --scene-cache <file>');
  process.exit(2);
}

let raw;
try {
  raw = JSON.parse(fs.readFileSync(path.resolve(cachePath), 'utf8'));
} catch (err) {
  console.error(`無法讀取 scene cache：${err.message}`);
  process.exit(2);
}
const payload = raw?.t === 'osm' ? raw : raw?.osm || raw;
const source = Array.isArray(payload?.elements) ? buildAreaRecords(payload.elements) : { areas: payload?.areas || [], invalid: 0, capacity: 0, gaps: [] };
const bbox = payload?.bbox || {};
const hasBbox = [bbox.minLat, bbox.maxLat, bbox.minLng, bbox.maxLng].every(Number.isFinite);
const center = payload?.center || (hasBbox ? {
  lat: (bbox.minLat + bbox.maxLat) / 2,
  lng: (bbox.minLng + bbox.maxLng) / 2,
} : null);
if (!Number.isFinite(center?.lat) || !Number.isFinite(center?.lng)) {
  console.error('scene cache 缺少有效 center／bbox，無法計算投影面積');
  process.exit(2);
}
const projected = source.areas.map((a) => projectAreaRecord(a, llToXZ, center)).filter(Boolean);
const catalog = catalogAreas(projected);
const report = {
  ...catalog.report,
  invalid: catalog.report.invalid + (source.invalid || 0),
  capacity: catalog.report.capacity + (source.capacity || 0),
  gaps: mergeAreaGaps([...(source.gaps || []), ...catalog.report.gaps]),
};
const result = { version: 1, center, report, areas: catalog.areas };
const lines = [
  `OSM 面域型錄：${cachePath}`,
  `area=${report.area} building=${report.building} mapped=${report.mapped} exact=${report.exact}`,
  `parentFallback=${report.parentFallback} unmapped=${report.unmapped} invalid=${report.invalid} capacity=${report.capacity}`,
  '分類：',
  ...Object.entries(report.byKind).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => `  ${k}: count=${v.count} areaM2=${v.areaM2.toFixed(3)} generated=${v.generated}`),
  '缺項：',
  ...(report.gaps.length ? report.gaps.map((g) => `  ${g.tagKey || 'tag'}=${g.tagValue || ''} reason=${g.reason} fallback=${g.fallback || '-'} count=${g.count} areaM2=${Number(g.areaM2 || 0).toFixed(3)} sourceIds=${(g.sourceIds || []).slice(0, 5).join(',')}`) : ['  （無）']),
];
console.log(lines.join('\n'));
if (jsonPath) fs.writeFileSync(path.resolve(jsonPath), JSON.stringify(result, null, 2) + '\n');
