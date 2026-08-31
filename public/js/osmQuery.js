// ============ OSM 查詢與原始元素分流(瀏覽器／工具共用)============
// Overpass 查詢字串與回應分流只能有一份；執行期、fixture 抓取器與 payload 實測
// 都從這裡取得，避免額度或 selector 改動後各自查出不同世界。
import { OSM_AREA_KEYS, buildAreaRecords } from './osmAreas.js';

export const OSM_FEATURE_QUERY_VERSION = 6;
export const OSM_ROAD_QUERY_VERSION = 1;
export const OSM_QUERY_TIMEOUT_S = 15;

const KM_PER_DEG = 111.32;
const finite = (v) => typeof v === 'number' && Number.isFinite(v);

export function bboxText(bbox) {
  if (!bbox || ![bbox.minLat, bbox.minLng, bbox.maxLat, bbox.maxLng].every(finite)
    || !(bbox.maxLat > bbox.minLat) || !(bbox.maxLng > bbox.minLng)) return null;
  return `${bbox.minLat.toFixed(5)},${bbox.minLng.toFixed(5)},${bbox.maxLat.toFixed(5)},${bbox.maxLng.toFixed(5)}`;
}

export function bboxKm2(bbox) {
  const bb = bboxText(bbox);
  if (!bb) return 0;
  const midLat = (bbox.minLat + bbox.maxLat) / 2;
  return (bbox.maxLat - bbox.minLat) * KM_PER_DEG
    * (bbox.maxLng - bbox.minLng) * KM_PER_DEG * Math.cos(midLat * Math.PI / 180);
}

export const quotaOf = (km2, perKm2, lo, hi) =>
  Math.max(lo, Math.min(hi, Math.round(km2 * perKm2)));

export function osmFeatureQuotas(bbox) {
  const km2 = bboxKm2(bbox);
  return {
    nBld: quotaOf(km2, 850, 400, 1200),
    nCover: quotaOf(km2, 400, 200, 900),
    nArea: quotaOf(km2, 1200, 600, 1800),
  };
}

export function osmRoadQuotas(bbox) {
  const km2 = bboxKm2(bbox);
  return {
    nMain: quotaOf(km2, 150, 150, 600),
    nMinor: quotaOf(km2, 1300, 400, 1600),
  };
}

/** 正式建物／地被／附屬點位查詢；內容與 biomes.js 執行期完全相同。 */
export function osmFeatureQuery(bbox) {
  const bb = bboxText(bbox);
  if (!bb) return null;
  const { nBld, nCover, nArea } = osmFeatureQuotas(bbox);
  const areaWays = OSM_AREA_KEYS.map((key) => `way["${key}"](${bb});`).join('');
  const areaRelations = OSM_AREA_KEYS.map((key) => `rel["type"="multipolygon"]["${key}"](${bb});`).join('');
  return `[out:json][timeout:${OSM_QUERY_TIMEOUT_S}];`
    // multipolygon relation 必須保留 member ref／role；只有 tags + geom 會讓真實 relation 變成 missing_outer。
    + `(${areaWays}${areaRelations});out body geom ${nArea};`
    + `node["power"="tower"](${bb});out tags ${nBld};`
    + `way["railway"~"^(rail|subway|light_rail|monorail|narrow_gauge|tram)$"](${bb});out geom 60;`
    + `node["railway"="level_crossing"](${bb});out 40;`
    + `node["waterway"="waterfall"](${bb});out 20;`
    + `node["place"~"^(city|town|village|suburb|neighbourhood)$"](${bb});out 24;`
    + `node["natural"="peak"](${bb});out 12;`
    + `node["highway"="motorway_junction"](${bb});out 12;`
    + `node["railway"~"^(station|halt)$"](${bb});out 12;`
    + `node["railway"~"^(subway_entrance|station_entrance)$"](${bb});out 80;`
    + `node["entrance"]["public_transport"~"^(station|subway)$"](${bb});out 40;`
    + `way["waterway"~"^(river|stream|canal|drain|ditch)$"](${bb});out geom 120;`
    + `way["landuse"](${bb});out geom ${nCover};`
    + `way["natural"](${bb});out geom ${nCover};`
    + `way["leisure"~"^(park|garden|golf_course|nature_reserve|recreation_ground)$"](${bb});out geom ${nCover};`
    + `rel["boundary"="administrative"](${bb});way(r);out geom 400;`;
}

/** 正式道路查詢；主幹與次要道路分開限額，避免小徑擠掉主幹。 */
export function osmRoadQuery(bbox) {
  const bb = bboxText(bbox);
  if (!bb) return null;
  const { nMain, nMinor } = osmRoadQuotas(bbox);
  return `[out:json][timeout:${OSM_QUERY_TIMEOUT_S}];`
    + `way["highway"~"^(motorway|trunk|primary|secondary|tertiary)$"](${bb});out geom ${nMain};`
    + `way["highway"~"^(unclassified|residential|living_street|service|track|path|footway|pedestrian|steps|cycleway|bridleway)$"](${bb});out geom ${nMinor};`;
}

/** 把正式 feature 查詢回應分成 AreaRecord 與非面狀欄位；不得丟失 raw element。 */
export function parseOsmFeatureElements(elements = []) {
  const areaElements = [], rails = [], falls = [], crossings = [], pois = [], entrances = [];
  const waters = [], boundaries = [], areaKeys = new Set(OSM_AREA_KEYS);
  for (const el of Array.isArray(elements) ? elements : []) {
    const tags = el?.tags || {};
    if (el?.type === 'relation' && (tags.type === 'multipolygon' || Array.isArray(el.members))) {
      // relation member way 仍留在 areaElements，buildAreaRecords 會依 source ID 串 outer/inner。
      areaElements.push(el);
    } else if (el?.type === 'way' && el.geometry && Object.keys(tags).some((k) => areaKeys.has(k))) {
      // way 即使是 relation 邊段也保留，供 relation 組環；非閉合的線由 buildAreaRecords 略過並列 invalid。
      areaElements.push(el);
      const closed = Array.isArray(el.geometry) && el.geometry.length > 2
        && el.geometry[0]?.lat === el.geometry.at(-1)?.lat
        && (el.geometry[0]?.lon ?? el.geometry[0]?.lng) === (el.geometry.at(-1)?.lon ?? el.geometry.at(-1)?.lng);
      if (tags.railway && !closed) rails.push({ tags, geometry: el.geometry });
      else if (tags.waterway && !closed) waters.push({ tags, geometry: el.geometry });
    } else if (el?.type === 'way' && el.geometry && tags.railway) {
      rails.push({ tags, geometry: el.geometry });
    } else if (el?.type === 'way' && el.geometry && tags.waterway) {
      waters.push({ tags, geometry: el.geometry });
    } else if (el?.type === 'way' && el.geometry && tags.natural === 'coastline') {
      boundaries.push({ tags, geometry: el.geometry });
    } else if (el?.type === 'way' && el.geometry) {
      // relation 展開後的成員 way 通常沒有 boundary 標籤；排除具名類別後即為行政界成員。
      boundaries.push({ tags, geometry: el.geometry });
    } else if (el?.type === 'node' && tags.railway === 'level_crossing') {
      crossings.push({ lat: el.lat, lng: el.lon, tags });
    } else if (el?.type === 'node' && tags.waterway === 'waterfall') {
      falls.push({ lat: el.lat, lng: el.lon, tags });
    } else if (el?.type === 'node' && (/^(subway_entrance|station_entrance)$/.test(tags.railway || '')
      || (tags.entrance && /^(station|subway)$/.test(tags.public_transport || '')))) {
      entrances.push({ lat: el.lat, lng: el.lon, tags });
    } else if (el?.type === 'node' && (tags.place || tags.natural === 'peak'
      || tags.highway === 'motorway_junction' || tags.railway)) {
      pois.push({ lat: el.lat, lng: el.lon, tags });
    }
  }
  const built = buildAreaRecords(areaElements);
  const pointFeatures = { rails, waters, boundaries, falls, crossings, pois, entrances };
  return {
    areas: built.areas, areaInvalid: built.invalid, areaCapacity: built.capacity, areaGaps: built.gaps,
    pointFeatures,
    // 舊消費端的短期別名；陣列仍與 pointFeatures 共用同一份參照。
    ...pointFeatures,
  };
}

export function osmRoadsFromElements(elements = []) {
  return (Array.isArray(elements) ? elements : [])
    .filter((el) => el?.type === 'way' && el.geometry && el.tags?.highway)
    .map((el) => ({ tags: el.tags, geometry: el.geometry }));
}
