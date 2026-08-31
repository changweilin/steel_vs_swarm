// ============ OSM 封閉面域、分類與決定性配置規則 ============
// 本檔零 import、零 THREE、零亂數；瀏覽器、離線工具與中繼資料契約共用。
// OSM 的 way / multipolygon relation 先在這裡成為 AreaRecord，後續消費端不得
// 再從中心點猜量體。幾何失敗與未知標籤一定留下 audit gap，不以「看起來像住宅」帶過。

/** OSM 面域相關鍵名冊；新增查詢鍵時必須先加入這一格。 */
export const OSM_AREA_KEYS = Object.freeze([
  'building', 'building:part', 'landuse', 'landcover', 'amenity', 'leisure',
  'natural', 'healthcare', 'tourism', 'shop', 'office', 'craft', 'industrial',
  'man_made', 'power', 'public_transport', 'railway', 'aeroway', 'military',
  'historic', 'sport', 'water', 'waterway',
]);

/** relay / 建圖共同的幾何上限；relay 會用自己的 payload 上限再夾一次。 */
export const OSM_AREA_LIMITS = Object.freeze({
  MAX_AREAS: 1800,
  MAX_RINGS: 5200,
  MAX_RING_POINTS: 4000,
  MAX_POINTS: 200000,
  EPS: 1e-10,
});

// 一個家族一個產生器；每個 OSM 語意是一列資料。`parent` 是可信回退，不是
// 把未知值假裝成 exact。`surface` 供 landfield 使用，`object` 供地物組裝使用。
const rows = (list) => Object.freeze(Object.fromEntries(list.map((r) => [r.kind, Object.freeze(r)])));
export const AREA_CATALOG = rows([
  { kind: 'residential', family: 'residential', key: 'landuse', values: ['residential'], generator: 'district', surface: 'urban', priority: 50 },
  { kind: 'commercial', family: 'commercial', key: 'landuse', values: ['commercial', 'retail'], generator: 'district', surface: 'urban', priority: 50 },
  { kind: 'industrial', family: 'industrial', key: 'landuse', values: ['industrial'], generator: 'industrial', surface: 'urban', priority: 60 },
  { kind: 'agriculture', family: 'agriculture', key: 'landuse', values: ['farmland', 'farmyard', 'greenhouse_horticulture', 'plant_nursery', 'aquaculture', 'meadow'], generator: 'field', surface: 'green', priority: 40 },
  { kind: 'orchard', family: 'agriculture', key: 'landuse', values: ['orchard', 'vineyard', 'allotments'], generator: 'orchard', surface: 'green', priority: 41 },
  { kind: 'forest', family: 'forestry', key: 'landuse', values: ['forest'], generator: 'forest', surface: 'green', priority: 40 },
  { kind: 'wood', family: 'forestry', key: 'natural', values: ['wood', 'scrub', 'heath'], generator: 'forest', surface: 'green', priority: 40 },
  { kind: 'park', family: 'park', key: 'leisure', values: ['park', 'garden', 'nature_reserve', 'recreation_ground', 'village_green'], generator: 'park', surface: 'green', priority: 45 },
  { kind: 'sports', family: 'sports', key: 'sport', values: ['soccer', 'football', 'tennis', 'basketball', 'baseball', 'athletics', 'golf'], generator: 'sports', surface: 'green', priority: 70 },
  { kind: 'sports', family: 'sports', key: 'leisure', values: ['pitch', 'sports_centre', 'stadium', 'track', 'golf_course', 'swimming_pool'], generator: 'sports', surface: 'green', priority: 70 },
  { kind: 'parking', family: 'parking', key: 'amenity', values: ['parking', 'parking_space'], generator: 'parking', surface: 'urban', priority: 75 },
  { kind: 'education', family: 'education', key: 'amenity', values: ['school', 'university', 'college', 'kindergarten'], generator: 'campus', surface: 'urban', priority: 80 },
  { kind: 'hospital', family: 'healthcare', key: 'amenity', values: ['hospital', 'clinic', 'doctors'], generator: 'hospital', surface: 'urban', priority: 80 },
  { kind: 'cemetery', family: 'cemetery', key: 'landuse', values: ['cemetery'], generator: 'cemetery', surface: 'green', priority: 45 },
  { kind: 'military', family: 'military', key: 'landuse', values: ['military'], generator: 'military', surface: 'urban', priority: 80 },
  { kind: 'railway', family: 'transport', key: 'landuse', values: ['railway'], generator: 'railway', surface: 'urban', priority: 72 },
  { kind: 'station', family: 'transport', key: 'public_transport', values: ['station'], generator: 'station', surface: 'urban', priority: 90 },
  { kind: 'airport', family: 'transport', key: 'aeroway', values: ['aerodrome', 'apron', 'terminal', 'runway', 'taxiway'], generator: 'airport', surface: 'urban', priority: 72 },
  { kind: 'water', family: 'water', key: 'natural', values: ['water', 'bay', 'strait'], generator: 'water', surface: 'water', priority: 100 },
  { kind: 'reservoir', family: 'water', key: 'landuse', values: ['reservoir', 'basin'], generator: 'water', surface: 'water', priority: 100 },
  { kind: 'wetland', family: 'water', key: 'natural', values: ['wetland', 'marsh', 'mud'], generator: 'wetland', surface: 'wet', priority: 90 },
  { kind: 'beach', family: 'natural', key: 'natural', values: ['beach', 'sand', 'shingle'], generator: 'bare', surface: 'bare', priority: 40 },
  { kind: 'rock', family: 'natural', key: 'natural', values: ['bare_rock', 'rock', 'scree', 'cliff'], generator: 'rock', surface: 'bare', priority: 60 },
  { kind: 'quarry', family: 'mining', key: 'landuse', values: ['quarry', 'landfill'], generator: 'quarry', surface: 'bare', priority: 65 },
  { kind: 'construction', family: 'construction', key: 'landuse', values: ['construction', 'brownfield', 'greenfield'], generator: 'construction', surface: 'bare', priority: 35 },
  { kind: 'power', family: 'utility', key: 'power', values: ['plant', 'substation', 'generator', 'transformer'], generator: 'power', surface: 'urban', priority: 85 },
  { kind: 'utility', family: 'utility', key: 'man_made', values: ['water_works', 'wastewater_plant', 'storage_tank', 'works'], generator: 'power', surface: 'urban', priority: 78 },
  { kind: 'tourism', family: 'tourism', key: 'tourism', values: ['attraction', 'zoo', 'theme_park', 'camp_site', 'caravan_site'], generator: 'park', surface: 'green', priority: 55 },
  { kind: 'heritage', family: 'culture', key: 'historic', values: ['archaeological_site', 'ruins', 'monument', 'memorial', 'fort'], generator: 'civic', surface: 'bare', priority: 72 },
  { kind: 'waterway', family: 'water', key: 'waterway', values: ['riverbank', 'dock', 'canal'], generator: 'water', surface: 'water', priority: 100 },
  { kind: 'religious', family: 'religion', key: 'amenity', values: ['place_of_worship'], generator: 'religious', surface: 'urban', priority: 86 },
]);

const buildingRows = [
  ['house', 'residential', ['house', 'detached', 'semidetached_house', 'bungalow', 'cabin', 'hut', 'residential']],
  ['terrace', 'residential', ['terrace']],
  ['apartments', 'residential', ['apartments', 'dormitory']],
  ['commercial', 'commercial', ['commercial', 'retail', 'office', 'hotel']],
  ['industrial', 'industrial', ['industrial', 'factory', 'warehouse', 'workshop']],
  ['farm', 'agriculture', ['farm', 'farm_auxiliary', 'barn', 'stable', 'greenhouse']],
  ['school', 'education', ['school', 'university', 'college', 'kindergarten']],
  ['hospital', 'healthcare', ['hospital', 'clinic']],
  ['station', 'transport', ['train_station', 'transportation', 'bus_station', 'terminal']],
  ['church', 'religion', ['church', 'cathedral', 'chapel', 'monastery']],
  ['mosque', 'religion', ['mosque']],
  ['temple', 'religion', ['temple', 'pagoda', 'stupa', 'shrine']],
  ['synagogue', 'religion', ['synagogue']],
  ['civic', 'civic', ['civic', 'government', 'public', 'townhall', 'fire_station', 'police', 'police_station']],
  ['museum', 'culture', ['museum', 'theatre', 'library']],
  ['stadium', 'sports', ['stadium', 'sports_hall', 'grandstand']],
  ['garage', 'parking', ['garage', 'garages', 'carport']],
  ['hangar', 'transport', ['hangar']],
  ['lighthouse', 'utility', ['lighthouse']],
  ['castle', 'culture', ['castle', 'fort']],
];

/** 建築型錄：一個建築家族由 biomes 的一個精確多邊形生成器消費。 */
export const BUILDING_CATALOG = Object.freeze(Object.fromEntries(
  buildingRows.map(([kind, family, values]) => [kind, Object.freeze({ kind, family, key: 'building', values, generator: 'polygonBuilding', priority: 100 })]),
));

const BUILDING_BY_VALUE = new Map(buildingRows.flatMap(([kind, , values]) => values.map((value) => [value, BUILDING_CATALOG[kind]])));
const AREA_BY_KEY_VALUE = new Map(Object.values(AREA_CATALOG).flatMap((r) => r.values.map((value) => [`${r.key}=${value}`, r])));
// `village_green` 在 OSM 同時出現在 leisure 與 landuse 實作，兩者都指向同一列。
AREA_BY_KEY_VALUE.set('landuse=village_green', AREA_CATALOG.park);
for (const value of ['trees', 'forest', 'wood']) AREA_BY_KEY_VALUE.set(`landcover=${value}`, AREA_CATALOG.forest);
for (const value of ['grass', 'grassland', 'meadow', 'flowerbed']) AREA_BY_KEY_VALUE.set(`landcover=${value}`, AREA_CATALOG.park);
for (const value of ['supermarket', 'mall', 'department_store', 'retail', 'marketplace', 'convenience']) {
  AREA_BY_KEY_VALUE.set(`shop=${value}`, AREA_CATALOG.commercial);
}
for (const value of ['office', 'company', 'government']) AREA_BY_KEY_VALUE.set(`office=${value}`, AREA_CATALOG.commercial);
for (const value of ['factory', 'workshop', 'warehouse', 'sawmill']) AREA_BY_KEY_VALUE.set(`craft=${value}`, AREA_CATALOG.industrial);
for (const value of ['plant', 'works', 'mine', 'kiln']) AREA_BY_KEY_VALUE.set(`industrial=${value}`, AREA_CATALOG.industrial);
for (const value of ['clinic', 'hospital', 'doctors', 'dentist', 'rehabilitation']) AREA_BY_KEY_VALUE.set(`healthcare=${value}`, AREA_CATALOG.hospital);
for (const value of ['station', 'halt', 'tram_stop', 'subway_entrance']) AREA_BY_KEY_VALUE.set(`railway=${value}`, AREA_CATALOG.station);
AREA_BY_KEY_VALUE.set('public_transport=station', AREA_CATALOG.station);
for (const value of ['base', 'barracks', 'training_area', 'range', 'airfield', 'naval_base']) AREA_BY_KEY_VALUE.set(`military=${value}`, AREA_CATALOG.military);
for (const value of ['lake', 'pond', 'reservoir', 'basin', 'lagoon', 'moat']) AREA_BY_KEY_VALUE.set(`water=${value}`, AREA_CATALOG.water);
for (const value of ['pitch', 'sports_centre', 'stadium', 'track', 'golf_course', 'swimming_pool']) AREA_BY_KEY_VALUE.set(`leisure=${value}`, AREA_CATALOG.sports);
for (const value of ['soccer', 'football', 'tennis', 'basketball', 'baseball', 'athletics', 'golf']) AREA_BY_KEY_VALUE.set(`sport=${value}`, AREA_CATALOG.sports);
for (const value of ['townhall', 'fire_station', 'police', 'courthouse', 'community_centre']) {
  AREA_BY_KEY_VALUE.set(`amenity=${value}`, Object.freeze({ kind: 'civic', family: 'civic', key: 'amenity', values: [value], generator: 'civic', surface: 'urban', priority: 82 }));
}

const isObj = (v) => !!v && typeof v === 'object';
const finite = (v) => typeof v === 'number' && Number.isFinite(v);
const valueOf = (p, k) => p?.[k] ?? p?.[k === 'lon' ? 'lng' : k];
const pointKey = (p) => `${Number(p.lat).toFixed(7)},${Number(p.lon ?? p.lng).toFixed(7)}`;

function cloneTags(tags) {
  const out = {};
  if (!isObj(tags)) return out;
  for (const k of Object.keys(tags).sort()) {
    const v = tags[k];
    if (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean') out[k] = String(v);
  }
  return out;
}

function pointOf(p) {
  const lat = Number(valueOf(p, 'lat')), lon = Number(valueOf(p, 'lon'));
  return finite(lat) && finite(lon) ? { lat, lon } : null;
}

/** 清除重點／共線點，不篡改 OSM 輪廓的非共線頂點。 */
export function normalizeRing(input, eps = OSM_AREA_LIMITS.EPS) {
  if (!Array.isArray(input) || input.length < 3) return null;
  const a = [];
  for (const raw of input) {
    const p = pointOf(raw);
    if (!p) return null;
    if (!a.length || pointKey(a[a.length - 1]) !== pointKey(p)) a.push(p);
  }
  if (a.length > 1 && pointKey(a[0]) === pointKey(a[a.length - 1])) a.pop();
  if (a.length < 3) return null;
  let changed = true;
  while (changed && a.length >= 3) {
    changed = false;
    for (let i = 0; i < a.length; i++) {
      const p = a[(i + a.length - 1) % a.length], q = a[i], r = a[(i + 1) % a.length];
      const cross = (q.lon - p.lon) * (r.lat - q.lat) - (q.lat - p.lat) * (r.lon - q.lon);
      const dot = (q.lon - p.lon) * (r.lon - q.lon) + (q.lat - p.lat) * (r.lat - q.lat);
      if (Math.abs(cross) <= eps && between(p, q, r) && dot >= -eps) {
        a.splice(i, 1); changed = true; break;
      }
    }
  }
  if (a.length < 3) return null;
  // 起點與方向只影響序列，不影響輪廓；固定後 relation member／元素重排仍逐位元相同。
  const rotations = [];
  for (let i = 0; i < a.length; i++) rotations.push(a.slice(i).concat(a.slice(0, i)));
  const rev = a.slice().reverse();
  for (let i = 0; i < rev.length; i++) rotations.push(rev.slice(i).concat(rev.slice(0, i)));
  rotations.sort((x, y) => x.map(pointKey).join('|').localeCompare(y.map(pointKey).join('|')));
  return rotations[0];
}

export function ringArea(ring) {
  let a = 0;
  for (let i = 0; i < ring.length; i++) {
    const p = ring[i], q = ring[(i + 1) % ring.length];
    a += p.lon * q.lat - q.lon * p.lat;
  }
  return a * 0.5;
}

function orient(a, b, c) { return (b.lon - a.lon) * (c.lat - a.lat) - (b.lat - a.lat) * (c.lon - a.lon); }
function between(a, b, c) { return Math.min(a.lon, c.lon) - 1e-12 <= b.lon && b.lon <= Math.max(a.lon, c.lon) + 1e-12
  && Math.min(a.lat, c.lat) - 1e-12 <= b.lat && b.lat <= Math.max(a.lat, c.lat) + 1e-12; }
function segmentsCross(a, b, c, d) {
  const ab1 = orient(a, b, c), ab2 = orient(a, b, d), cd1 = orient(c, d, a), cd2 = orient(c, d, b);
  if (Math.abs(ab1) < 1e-12 && between(a, c, b)) return true;
  if (Math.abs(ab2) < 1e-12 && between(a, d, b)) return true;
  if (Math.abs(cd1) < 1e-12 && between(c, a, d)) return true;
  if (Math.abs(cd2) < 1e-12 && between(c, b, d)) return true;
  return (ab1 > 0) !== (ab2 > 0) && (cd1 > 0) !== (cd2 > 0);
}

/** 簡單環驗證；相鄰端點的接觸不算自交。 */
export function isSimpleRing(ring) {
  if (!ring || ring.length < 3 || Math.abs(ringArea(ring)) <= OSM_AREA_LIMITS.EPS) return false;
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i], b = ring[(i + 1) % ring.length];
    for (let j = i + 1; j < ring.length; j++) {
      if (j === i || j === (i + 1) % ring.length || i === (j + 1) % ring.length) continue;
      if (segmentsCross(a, b, ring[j], ring[(j + 1) % ring.length])) return false;
    }
  }
  return true;
}

export function pointInRing(p, ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[i], b = ring[j];
    if ((a.lat > p.lat) !== (b.lat > p.lat)
      && p.lon < (b.lon - a.lon) * (p.lat - a.lat) / (b.lat - a.lat) + a.lon) inside = !inside;
  }
  return inside;
}

function ringFromWay(way) {
  const g = way?.geometry || way?.points;
  const ring = normalizeRing(g);
  return ring && isSimpleRing(ring) ? ring : null;
}

function endpoint(p) { return pointKey(p); }

/** 將 relation member way 串成多條 outer/inner 環，支援方向反轉與多外環。 */
export function assembleRelationRings(relation, waysById = new Map()) {
  const members = Array.isArray(relation?.members) ? relation.members.slice().sort((a, b) => {
    const role = String(a?.role || '').localeCompare(String(b?.role || ''));
    return role || String(a?.ref ?? '').localeCompare(String(b?.ref ?? ''));
  }) : [];
  const segments = [];
  for (const [index, m] of members.entries()) {
    if (!['outer', 'inner'].includes(m?.role)) continue;
    let g = m.geometry;
    if (!g && m.ref != null) {
      const key = `${m.type || 'way'}/${m.ref}`;
      const way = waysById.get(key) || waysById.get(String(m.ref));
      g = way?.geometry;
    }
    const pts = Array.isArray(g) ? g.map(pointOf) : null;
    if (!pts || pts.some((p) => !p)) continue;
    const closedMember = pts.length > 2 && pointKey(pts[0]) === pointKey(pts[pts.length - 1]);
    const n = closedMember ? pts.slice(0, -1) : pts.slice();
    if (n.length >= 2) segments.push({ role: m.role, ref: String(m.ref ?? index), pts: n, closed: closedMember });
  }
  const out = [], used = new Set();
  const roleOrder = ['outer', 'inner'];
  for (const role of roleOrder) {
    for (let seed = 0; seed < segments.length; seed++) {
      if (used.has(seed) || segments[seed].role !== role) continue;
      let chain = segments[seed].pts.slice(); used.add(seed);
      let closed = segments[seed].closed || endpoint(chain[0]) === endpoint(chain[chain.length - 1]);
      for (let guard = 0; !closed && guard < segments.length + 1; guard++) {
        const end = endpoint(chain[chain.length - 1]);
        const candidates = [];
        for (let i = 0; i < segments.length; i++) if (!used.has(i) && segments[i].role === role) {
          const s = segments[i].pts;
          if (endpoint(s[0]) === end) candidates.push({ i, rev: false });
          else if (endpoint(s[s.length - 1]) === end) candidates.push({ i, rev: true });
        }
        candidates.sort((a, b) => String(segments[a.i].ref).localeCompare(String(segments[b.i].ref)) || a.i - b.i);
        if (!candidates.length) break;
        const pick = candidates[0];
        const add = segments[pick.i].pts.slice(); if (pick.rev) add.reverse();
        chain.push(...add.slice(1)); used.add(pick.i);
        closed = endpoint(chain[0]) === endpoint(chain[chain.length - 1]);
      }
      if (!closed) continue;
      const ring = normalizeRing(chain);
      if (ring && isSimpleRing(ring)) out.push({ role, ring });
    }
  }
  return out;
}

function areaRecord(sourceType, sourceId, tags, polygons, extra = {}) {
  const valid = [];
  for (const p of polygons || []) {
    const outer = normalizeRing(p?.outer);
    if (!outer || !isSimpleRing(outer)) continue;
    const holes = [];
    for (const h of p.holes || []) {
      const ring = normalizeRing(h);
      if (ring && isSimpleRing(ring) && pointInRing(ring[0], outer)) holes.push(ring);
    }
    valid.push({ outer, holes });
  }
  if (!valid.length) return null;
  const out = { sourceId: String(sourceId), sourceType, tags: cloneTags(tags), polygons: valid, ...extra };
  return out;
}

/**
 * 將 Overpass elements 轉成 AreaRecord。closed way 與 multipolygon relation 共用此縫；
 * relation 成員 way 不會再重複生成同一面域。
 */
export function buildAreaRecords(elements = [], opts = {}) {
  if (!Array.isArray(elements)) return { areas: [], invalid: 1, gaps: [{ reason: 'invalid_elements' }] };
  const orderedElements = elements.slice().sort((a, b) => String(a?.type || '').localeCompare(String(b?.type || ''))
    || String(a?.id ?? '').localeCompare(String(b?.id ?? '')));
  const ways = new Map(), relations = [], relationWayIds = new Set();
  for (const e of orderedElements) {
    if (e?.type === 'way' && e.id != null) ways.set(`way/${e.id}`, e), ways.set(String(e.id), e);
    if (e?.type === 'relation' && e.tags?.type === 'multipolygon') relations.push(e);
  }
  for (const rel of relations) for (const m of rel.members || []) if (m?.type === 'way' && m.ref != null) relationWayIds.add(String(m.ref));
  const areas = [], invalid = [], seen = new Set();
  const wanted = new Set(opts.keys || OSM_AREA_KEYS);
  const hasAreaTag = (tags) => Object.keys(tags || {}).some((k) => wanted.has(k));
  const invalidOf = (element, sourceId, reason) => {
    const [tagKey, tagValue] = firstTag(element?.tags || {}, OSM_AREA_KEYS) || [];
    return { sourceId, reason, tagKey: tagKey || null, tagValue: tagValue || null };
  };
  const add = (a) => { if (!a || seen.has(a.sourceId)) return; seen.add(a.sourceId); areas.push(a); };
  for (const e of orderedElements) {
    if (e?.type !== 'way' || !hasAreaTag(e.tags)) continue;
    // relation member ways are only edges unless they have an explicit building:part of their own.
    if (relationWayIds.has(String(e.id)) && !e.tags?.['building:part']) continue;
    const ring = ringFromWay(e);
    if (!ring) { invalid.push(invalidOf(e, `way/${e.id ?? 'unknown'}`, 'invalid_ring')); continue; }
    add(areaRecord('way', `way/${e.id ?? seen.size}`, e.tags, [{ outer: ring, holes: [] }]));
  }
  for (const rel of relations.sort((a, b) => String(a?.id ?? '').localeCompare(String(b?.id ?? '')))) {
    if (!hasAreaTag(rel.tags)) continue;
    const rings = assembleRelationRings(rel, waysById(ways));
    const outers = rings.filter((r) => r.role === 'outer').map((r) => r.ring);
    const inners = rings.filter((r) => r.role === 'inner').map((r) => r.ring);
    if (!outers.length) { invalid.push(invalidOf(rel, `relation/${rel.id ?? 'unknown'}`, 'missing_outer')); continue; }
    const polygons = outers.map((outer) => ({ outer, holes: [] }));
    for (const inner of inners) {
      const parent = polygons.find((p) => pointInRing(inner[0], p.outer));
      if (parent) parent.holes.push(inner); else invalid.push(invalidOf(rel, `relation/${rel.id ?? 'unknown'}`, 'orphan_inner'));
    }
    add(areaRecord('relation', `relation/${rel.id ?? seen.size}`, rel.tags, polygons));
  }
  areas.sort((a, b) => a.sourceId.localeCompare(b.sourceId));
  const limited = areas.slice(0, OSM_AREA_LIMITS.MAX_AREAS);
  const capacity = Math.max(0, areas.length - limited.length);
  if (capacity) invalid.push({ tagKey: 'area', tagValue: 'capacity', reason: 'capacity', count: capacity });
  const invalidCount = invalid.filter((x) => x.reason !== 'capacity').reduce((n, x) => n + (Number(x.count) || 1), 0);
  return {
    areas: limited, invalid: invalidCount, capacity, invalidItems: invalid,
    gaps: invalid.map((x) => ({
      tagKey: x.tagKey || null, tagValue: x.tagValue || null, reason: x.reason,
      fallback: null, mode: x.reason === 'capacity' ? 'capacity' : 'invalid',
      count: Number(x.count) || 1, areaM2: 0, sourceIds: x.sourceId ? [x.sourceId] : [],
    })),
  };
}

function waysById(map) {
  // assembleRelationRings only needs exact IDs; aliases do not harm deterministic lookup.
  return map;
}

function firstTag(tags, order) {
  for (const key of order) if (tags?.[key] != null) return [key, String(tags[key])];
  return null;
}

function directBuilding(tags) {
  if (!tags || typeof tags !== 'object') return null;
  const b = String(tags.building || tags['building:part'] || '');
  const amenity = String(tags.amenity || '');
  const healthcare = String(tags.healthcare || '');
  const railway = String(tags.railway || '');
  const pt = String(tags.public_transport || '');
  const use = String(tags['building:use'] || '');
  if (amenity === 'hospital' || healthcare) return BUILDING_CATALOG.hospital;
  if (/^(school|university|college|kindergarten)$/.test(amenity)) return BUILDING_CATALOG.school;
  if (amenity === 'bus_station' || railway === 'station' || pt === 'station') return BUILDING_CATALOG.station;
  if (amenity === 'place_of_worship') {
    if (tags.religion === 'muslim') return BUILDING_CATALOG.mosque;
    if (tags.religion === 'jewish') return BUILDING_CATALOG.synagogue;
    if (tags.religion === 'christian') return BUILDING_CATALOG.church;
    return BUILDING_CATALOG.temple;
  }
  if (tags.tourism === 'museum') return BUILDING_CATALOG.museum;
  if (tags.leisure === 'stadium' || tags.sport) return BUILDING_CATALOG.stadium;
  if (tags.man_made === 'lighthouse') return BUILDING_CATALOG.lighthouse;
  if (tags.historic === 'castle') return BUILDING_CATALOG.castle;
  return BUILDING_BY_VALUE.get(b) || BUILDING_BY_VALUE.get(use) || null;
}

function parentRow(tags) {
  const candidates = [];
  for (const [key, value] of [
    ['landuse', tags?.landuse], ['landcover', tags?.landcover], ['amenity', tags?.amenity],
    ['leisure', tags?.leisure], ['natural', tags?.natural], ['water', tags?.water],
    ['waterway', tags?.waterway], ['aeroway', tags?.aeroway], ['military', tags?.military],
    ['shop', tags?.shop], ['office', tags?.office], ['craft', tags?.craft],
    ['industrial', tags?.industrial], ['healthcare', tags?.healthcare],
    ['railway', tags?.railway], ['public_transport', tags?.public_transport], ['sport', tags?.sport],
  ]) {
    if (value == null) continue;
    const r = AREA_BY_KEY_VALUE.get(`${key}=${String(value)}`);
    if (r) candidates.push(r);
  }
  candidates.sort((a, b) => b.priority - a.priority || a.kind.localeCompare(b.kind));
  return candidates[0] || null;
}

function rowTagPair(tags, row) {
  for (const [key, value] of Object.entries(tags || {})) {
    if (AREA_BY_KEY_VALUE.get(`${key}=${value}`) === row) return [key, String(value)];
  }
  return [row?.key || null, row?.values?.[0] || null];
}

/** 分類優先序：功能語意 → building 值 → 父面域 → 可信通用類 → unmapped。 */
export function classifyArea(tags = {}, context = {}) {
  const t = cloneTags(tags);
  const hasBuilding = t.building != null || t['building:part'] != null;
  const b = hasBuilding ? directBuilding(t) : null;
  if (b) {
    const [tagKey, tagValue] = t.amenity ? ['amenity', t.amenity]
      : t.healthcare ? ['healthcare', t.healthcare]
        : t.railway ? ['railway', t.railway]
          : t.public_transport ? ['public_transport', t.public_transport]
            : t.tourism ? ['tourism', t.tourism]
              : t.leisure ? ['leisure', t.leisure]
                : t.man_made ? ['man_made', t.man_made]
                  : t['building:use'] ? ['building:use', t['building:use']]
                    : ['building', t.building || t['building:part']];
    return { ...b, exact: true, mode: 'exact', tagKey, tagValue };
  }
  if (hasBuilding) {
    const parent = context.parent || parentRow(t);
    const fallback = (row) => ({ ...row, exact: false, mode: 'parent_fallback', fallback: parent.kind, tagKey: 'building', tagValue: t.building || t['building:part'], reason: 'unknown_building_value' });
    if (parent?.family === 'commercial') return fallback(BUILDING_CATALOG.commercial);
    if (parent?.family === 'industrial') return fallback(BUILDING_CATALOG.industrial);
    if (parent?.family === 'education') return fallback(BUILDING_CATALOG.school);
    if (parent?.family === 'healthcare') return fallback(BUILDING_CATALOG.hospital);
    if (parent?.family === 'transport') return fallback(BUILDING_CATALOG.station);
    if (parent?.family === 'religion') return fallback(BUILDING_CATALOG.temple);
    if (parent?.family === 'civic') return fallback(BUILDING_CATALOG.civic);
    if (!parent) return { family: 'unknown', kind: 'unknown', generator: null, exact: false, mode: 'unmapped', tagKey: 'building', tagValue: t.building || t['building:part'], reason: 'unknown_building_value' };
    return { ...BUILDING_CATALOG.house, exact: false, mode: 'parent_fallback', fallback: parent.kind, reason: 'unknown_building_value' };
  }
  const r = parentRow(t);
  if (r) {
    const [tagKey, tagValue] = rowTagPair(t, r);
    return { ...r, exact: true, mode: 'exact', tagKey, tagValue };
  }
  const [tagKey, tagValue] = firstTag(t, OSM_AREA_KEYS) || [];
  // 只有 key 本身就能可靠表達父類時才回退；未知 landuse/natural 不得一律猜住宅/森林。
  if (tagKey) {
    const parent = ({
      shop: AREA_CATALOG.commercial, office: AREA_CATALOG.commercial,
      craft: AREA_CATALOG.industrial, industrial: AREA_CATALOG.industrial,
      healthcare: AREA_CATALOG.hospital, sport: AREA_CATALOG.sports,
      water: AREA_CATALOG.water, power: AREA_CATALOG.power,
      military: AREA_CATALOG.military,
    })[tagKey] || null;
    if (!parent) return { family: 'unknown', kind: 'unknown', generator: null, exact: false, mode: 'unmapped', tagKey, tagValue, reason: 'unknown_area_value' };
    return { ...parent, exact: false, mode: 'parent_fallback', fallback: parent.kind, tagKey, tagValue, reason: 'unknown_area_value' };
  }
  return { family: 'unknown', kind: 'unknown', generator: null, exact: false, mode: 'unmapped', reason: 'no_supported_area_tag' };
}

function flatRingArea(ring) {
  let a = 0;
  for (let i = 0; i < ring.length; i++) {
    const p = ring[i], q = ring[(i + 1) % ring.length];
    a += p[0] * q[1] - q[0] * p[1];
  }
  return a * 0.5;
}

function projectedAreaM2(polygons) {
  return (polygons || []).reduce((sum, p) => sum + Math.max(0,
    Math.abs(flatRingArea(p.outer)) - (p.holes || []).reduce((h, ring) => h + Math.abs(flatRingArea(ring)), 0)), 0);
}

export function areaAreaM2(record) {
  if (record?.worldPolygons) return projectedAreaM2(record.worldPolygons);
  return (record?.polygons || []).reduce((sum, p) => sum + Math.max(0, Math.abs(ringArea(p.outer))
    - (p.holes || []).reduce((h, ring) => h + Math.abs(ringArea(ring)), 0)), 0);
}

function ringBounds(ring) {
  const b = { minLat: Infinity, minLon: Infinity, maxLat: -Infinity, maxLon: -Infinity };
  for (const p of ring) { b.minLat = Math.min(b.minLat, p.lat); b.maxLat = Math.max(b.maxLat, p.lat); b.minLon = Math.min(b.minLon, p.lon); b.maxLon = Math.max(b.maxLon, p.lon); }
  return b;
}

/** 將 parser／分類／runtime 的缺項合併為穩定報表列；所有消費端共用。 */
export function mergeAreaGaps(rows = []) {
  const merged = new Map();
  for (const gap of rows || []) {
    const key = `${gap?.tagKey || ''}|${gap?.tagValue || ''}|${gap?.reason || ''}|${gap?.fallback || ''}`;
    const out = merged.get(key) || {
      tagKey: gap?.tagKey || null, tagValue: gap?.tagValue || null,
      reason: gap?.reason || 'unknown', fallback: gap?.fallback || null,
      count: 0, areaM2: 0, sourceIds: [],
    };
    out.count += Number(gap?.count) || 1; out.areaM2 += Number(gap?.areaM2) || 0;
    for (const id of gap?.sourceIds || []) if (out.sourceIds.length < 5 && !out.sourceIds.includes(id)) out.sourceIds.push(id);
    merged.set(key, out);
  }
  return [...merged.values()].sort((a, b) => String(a.tagKey).localeCompare(String(b.tagKey))
    || String(a.tagValue).localeCompare(String(b.tagValue)) || String(a.reason).localeCompare(String(b.reason)));
}

/** 由經緯度投影到遊戲平面；只在此附加 worldPolygons，原始 OSM 點不丟。 */
export function projectAreaRecord(record, projectAt, center) {
  if (!record || typeof projectAt !== 'function') return null;
  const projected = [];
  for (const p of record.polygons || []) {
    const outer = p.outer.map((q) => projectAt(q.lat, q.lon, center));
    const holes = (p.holes || []).map((ring) => ring.map((q) => projectAt(q.lat, q.lon, center)));
    if (outer.every((q) => Array.isArray(q) && finite(q[0]) && finite(q[1]))) projected.push({ outer, holes });
  }
  if (!projected.length) return null;
  let sx = 0, sz = 0, weight = 0;
  const addCentroid = (ring, sign) => {
    const a = flatRingArea(ring);
    if (Math.abs(a) <= OSM_AREA_LIMITS.EPS) return;
    let cx = 0, cz = 0;
    for (let i = 0; i < ring.length; i++) {
      const p = ring[i], q = ring[(i + 1) % ring.length], cross = p[0] * q[1] - q[0] * p[1];
      cx += (p[0] + q[0]) * cross; cz += (p[1] + q[1]) * cross;
    }
    const w = Math.abs(a) * sign;
    sx += (cx / (6 * a)) * w; sz += (cz / (6 * a)) * w; weight += w;
  };
  for (const p of projected) {
    addCentroid(p.outer, 1);
    for (const h of p.holes || []) addCentroid(h, -1);
  }
  if (weight <= OSM_AREA_LIMITS.EPS) {
    for (const p of projected) for (const q of p.outer) { sx += q[0]; sz += q[1]; weight++; }
  }
  const all = projected.flatMap((p) => p.outer);
  const bounds = { minX: Math.min(...all.map((q) => q[0])), maxX: Math.max(...all.map((q) => q[0])), minZ: Math.min(...all.map((q) => q[1])), maxZ: Math.max(...all.map((q) => q[1])) };
  return { ...record, worldPolygons: projected, areaM2: projectedAreaM2(projected), centroid: { x: sx / Math.max(OSM_AREA_LIMITS.EPS, weight), z: sz / Math.max(OSM_AREA_LIMITS.EPS, weight) }, bounds };
}

/** 所有 area 的分類摘要與缺項；輸入順序不影響輸出。 */
export function catalogAreas(areas = [], context = {}) {
  const rowsByFamily = {}, rowsByKind = {}, gapsMap = new Map();
  const classified = [];
  let invalid = 0, capacity = 0;
  const addRow = (map, key, area, generated = 0) => {
    const r = map[key] || (map[key] = { count: 0, areaM2: 0, generated: 0 });
    r.count++; r.areaM2 += areaAreaM2(area); r.generated += generated;
  };
  const ordered = [...(areas || [])].sort((a, b) => String(a?.sourceId).localeCompare(String(b?.sourceId)));
  const parents = ordered.filter((a) => !(a.tags?.building || a.tags?.['building:part']))
    .sort((a, b) => areaAreaM2(a) - areaAreaM2(b) || String(a.sourceId).localeCompare(String(b.sourceId)));
  const buildingParents = ordered.filter((a) => a.tags?.building && !a.tags?.['building:part'])
    .sort((a, b) => areaAreaM2(a) - areaAreaM2(b) || String(a.sourceId).localeCompare(String(b.sourceId)));
  const containingParent = (area) => {
    if (!(area?.tags?.building || area?.tags?.['building:part'])) return null;
    const probes = (area.worldPolygons || []).flatMap((p) => p.outer.slice(0, 3));
    const candidates = area.tags?.['building:part'] ? [...buildingParents, ...parents] : parents;
    return candidates.find((parent) => parent.sourceId !== area.sourceId && areaAreaM2(parent) > areaAreaM2(area)
      && probes.some((q) => (parent.worldPolygons || []).some((poly) => pointInProjectedArea(q[0], q[1], poly)))) || null;
  };
  for (const area of ordered) {
    const parentArea = containingParent(area);
    const parent = parentArea ? classifyArea(parentArea.tags, context) : context.parent;
    const c = classifyArea(area.tags, { ...context, parent });
    const x = { ...area, classification: c };
    classified.push(x);
    addRow(rowsByFamily, c.family || 'unknown', area);
    addRow(rowsByKind, c.kind || 'unknown', area);
    if (c.mode !== 'exact') {
      const key = `${c.tagKey || 'tag'}=${c.tagValue || ''}|${c.reason || c.mode}`;
      const g = gapsMap.get(key) || { tagKey: c.tagKey || null, tagValue: c.tagValue || null, reason: c.reason || c.mode, fallback: c.fallback || null, count: 0, areaM2: 0, sourceIds: [] };
      g.count++; g.areaM2 += areaAreaM2(area); if (g.sourceIds.length < 5) g.sourceIds.push(area.sourceId); gapsMap.set(key, g);
      if (c.mode === 'unmapped') invalid++;
    }
    if (c.reason === 'capacity') capacity++;
  }
  const gaps = [...gapsMap.values()].sort((a, b) => String(a.tagKey).localeCompare(String(b.tagKey)) || String(a.tagValue).localeCompare(String(b.tagValue)) || String(a.reason).localeCompare(String(b.reason)));
  const buildings = classified.filter((a) => a.tags?.building != null || a.tags?.['building:part'] != null || a.classification?.generator === 'polygonBuilding');
  const exact = classified.filter((a) => a.classification?.exact).length;
  const parentFallback = classified.filter((a) => a.classification?.mode === 'parent_fallback').length;
  const unmapped = classified.filter((a) => a.classification?.mode === 'unmapped').length;
  return {
    areas: classified, report: {
      area: classified.length, building: buildings.length, mapped: classified.length - unmapped,
      exact, parentFallback, unmapped, invalid, capacity, byFamily: rowsByFamily, byKind: rowsByKind, gaps,
    },
  };
}

/** 把世界投影 polygon 轉成 landfield 可讀的封閉面，保留 holes。 */
export function areaSurfaceRows(areas = []) {
  return areas.flatMap((a) => (a.worldPolygons || []).map((p) => ({
    sourceId: a.sourceId, tags: a.tags, zone: a.classification?.surface,
    priority: a.classification?.priority || 0, outer: p.outer, holes: p.holes || [],
  })));
}

export function pointInProjectedArea(x, z, polygon) {
  const inside = (ring) => {
    let yes = false;
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const a = ring[i], b = ring[j];
      if ((a[1] > z) !== (b[1] > z) && x < (b[0] - a[0]) * (z - a[1]) / (b[1] - a[1]) + a[0]) yes = !yes;
    }
    return yes;
  };
  return !!polygon && inside(polygon.outer) && !(polygon.holes || []).some(inside);
}

/** 建物／用地 containment：最小包含父面優先，輸入順序不影響。 */
export function buildContainmentIndex(areas = []) {
  const ordered = [...areas].sort((a, b) => areaAreaM2(a) - areaAreaM2(b) || String(a.sourceId).localeCompare(String(b.sourceId)));
  const parents = ordered.filter((a) => !(a.tags?.building || a.tags?.['building:part']));
  const parentOf = (child) => {
    const p = child?.centroid;
    if (!p) return null;
    return parents.find((candidate) => (candidate.worldPolygons || []).some((poly) => pointInProjectedArea(p.x, p.z, poly))) || null;
  };
  const children = new Map();
  for (const area of ordered) {
    const parent = parentOf(area);
    if (!parent) continue;
    const list = children.get(parent.sourceId) || [];
    list.push(area); children.set(parent.sourceId, list);
  }
  return { parentOf, parents, childrenOf: (parent) => children.get(parent?.sourceId) || [] };
}

/** 穩定的面域抽樣點：中心、bbox 網格與頂點候選，零亂數。 */
export function areaCandidates(area, max = 24) {
  const out = [];
  for (const p of area?.worldPolygons || []) {
    const xs = p.outer.map((q) => q[0]), zs = p.outer.map((q) => q[1]);
    const minX = Math.min(...xs), maxX = Math.max(...xs), minZ = Math.min(...zs), maxZ = Math.max(...zs);
    const nx = Math.max(1, Math.ceil(Math.sqrt(max * Math.max(0.1, (maxX - minX) / Math.max(0.1, maxZ - minZ)))));
    const nz = Math.max(1, Math.ceil(max / nx));
    for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) {
      const x = minX + (i + 0.5) * (maxX - minX) / nx, z = minZ + (j + 0.5) * (maxZ - minZ) / nz;
      if (pointInProjectedArea(x, z, p)) out.push({ x, z });
    }
  }
  out.sort((a, b) => a.z - b.z || a.x - b.x);
  return out.slice(0, max);
}

/**
 * 以面積／語意優先序決定性配置離散區域物件；所有新落點都做同輪 pairwise 占位檢查。
 * `radiusOf` 與 `blocked` 只讀權威幾何，呼叫端可將結果直接轉成 blocker／visual。
 */
export function placeAreaCandidates(areas = [], options = {}) {
  const maxObjects = Math.max(0, Number(options.maxObjects) || 0);
  const maxPerArea = Math.max(1, Number(options.maxPerArea) || 1);
  const minGap = Math.max(0, Number(options.minGap) || 0);
  const radiusOf = typeof options.radiusOf === 'function' ? options.radiusOf : (() => 1);
  const countOf = typeof options.countOf === 'function' ? options.countOf : (() => maxPerArea);
  const blocked = typeof options.blocked === 'function' ? options.blocked : (() => false);
  const ordered = [...areas].sort((a, b) => (b.classification?.priority || 0) - (a.classification?.priority || 0)
    || areaAreaM2(b) - areaAreaM2(a) || String(a.sourceId).localeCompare(String(b.sourceId)));
  const placed = [], capacity = [], skipped = [];
  for (const area of ordered) {
    if (placed.length >= maxObjects) { capacity.push({ sourceId: area.sourceId, reason: 'capacity' }); continue; }
    const wanted = Math.max(0, Math.min(maxPerArea, Math.floor(Number(countOf(area)) || 0)));
    if (!wanted) continue;
    const candidates = areaCandidates(area, Math.max(wanted * 6, 12));
    let added = 0;
    for (const p of candidates) {
      if (added >= wanted || placed.length >= maxObjects) break;
      const radius = Math.max(0, Number(radiusOf(area, p)) || 0);
      if (blocked(p.x, p.z, radius, area)) { skipped.push({ sourceId: area.sourceId, reason: 'blocked' }); continue; }
      let clash = false;
      for (const q of placed) {
        const gap = radius + q.radius + minGap;
        if (Math.hypot(p.x - q.x, p.z - q.z) < gap) { clash = true; break; }
      }
      if (clash) { skipped.push({ sourceId: area.sourceId, reason: 'sibling_overlap' }); continue; }
      placed.push({ ...p, radius, sourceId: area.sourceId, area }); added++;
    }
    if (!added && candidates.length) skipped.push({ sourceId: area.sourceId, reason: 'no_space' });
  }
  return { placed, capacity, skipped };
}
