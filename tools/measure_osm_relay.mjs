// ============ 路網中繼 payload 實測(㋓ 需外網)============
// 用途:量「房主要送出去的那一則 `t:'osm'` 到底多大」,回頭核對兩個上限 ——
//   ・`server.js` 的 `maxPayload`(2MiB;超過 ws 以 1009 直接斷掉**房主**的連線);
//   ・`osmrelay.js` 的 `OSM_RELAY.MAX_BYTES`(客戶端自我封頂,超過先丟 feats 再整份放棄)。
// 第一版落地時只量過**道路**那一半(PR #188 的討論串),建物/鐵路/POI 那一半
// 是靠自我封頂兜底的 —— 本工具把缺的那一半補上。
//
// **查詢字串取自 `biomes.js` 執行原文**(`grabFn` + 樣板字串重新求值),不是抄一份:
// 抄的那份會在額度或查詢改版時靜默過期,而它量出來的數字看起來一樣正常。
//
// 用法:
//   node tools/measure_osm_relay.mjs                       # 預設四張密市區圖,5v5
//   node tools/measure_osm_relay.mjs --venues paris,seoul --team 3
import { readSrc, grabFn } from './audit_src.mjs';
import { VENUES, venueConfig } from '../public/js/venues.js';
import { battleBBox, llToXZ } from '../public/js/data.js';
import { OSM_RELAY, sanitizeOsmRelay, osmRelayFit } from '../public/js/osmrelay.js';
import { planPedestrianNetwork } from '../public/js/pedestrian.js';
import { OSM_AREA_KEYS, buildAreaRecords } from '../public/js/osmAreas.js';

const OSM_UA = 'steel-vs-swarm/1.0 (relay payload measure)';
const OVERPASS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
  'https://maps.mail.ru/osm/tools/overpass/api/interpreter',
];
const REQ_MS = 60000;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const bytes = (s) => new TextEncoder().encode(s).length;
const kb = (n) => `${(n / 1024).toFixed(0)}KB`;

// ---- 從 biomes.js 原文取出兩個查詢的樣板字串與額度推導(真品,不抄)----
const bio = readSrc('public', 'js', 'biomes.js');
// `const q = \`…\` + \`…\`;` —— 續接的樣板一起取回來當一個運算式求值
const grabQ = (fn) => {
  const m = /const q = ([\s\S]*?);\n/.exec(grabFn(bio, fn));
  if (!m) throw new Error(`${fn}:抓不到查詢樣板(biomes.js 的寫法改了,先修這裡)`);
  return m[1];
};
const mkQuery = (fn, params) => new Function(...params, `return (${grabQ(fn)});`);
const featQ = mkQuery('fetchOsmFeatures', ['bb', 'nBld', 'nCover', 'nArea', 'areaWays', 'areaRelations']);
const roadQ = mkQuery('fetchOsmRoads', ['bb', 'nMain', 'nMinor']);
const quotaOf = new Function('return ' + /const quotaOf = ([^;]+);/.exec(bio)[1])();
const bboxKm2 = new Function(`${grabFn(bio, 'bboxKm2')}; return bboxKm2;`)();

async function overpass(q) {
  for (const url of OVERPASS) {
    try {
      const r = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'User-Agent': OSM_UA },
        body: 'data=' + encodeURIComponent(q),
        signal: AbortSignal.timeout(REQ_MS),
      });
      if (!r.ok) continue;
      const d = await r.json();
      if (d.remark) continue;
      return d;
    } catch { /* 換站(逐站計時,§2.4)*/ }
  }
  return null;
}

/** 逐字鏡射 fetchOsmFeatures 的分類(那一支住在 import 不了 three 的檔案裡) */
function parseFeats(data) {
  const areaElements = [], rails = [], falls = [], crossings = [], pois = [], entrances = [];
  const waters = [], boundaries = [], areaKeys = new Set(OSM_AREA_KEYS);
  for (const el of data.elements || []) {
    const tags = el.tags || {};
    if (el.type === 'relation' && (tags.type === 'multipolygon' || Array.isArray(el.members))) areaElements.push(el);
    else if (el.type === 'way' && el.geometry && Object.keys(tags).some((k) => areaKeys.has(k))) areaElements.push(el);
    else if (el.type === 'way' && el.geometry && tags.railway) rails.push({ tags, geometry: el.geometry });
    else if (el.type === 'way' && el.geometry && tags.waterway) waters.push({ tags, geometry: el.geometry });
    else if (el.type === 'way' && el.geometry && tags.natural === 'coastline') boundaries.push({ tags, geometry: el.geometry });
    else if (el.type === 'way' && el.geometry) boundaries.push({ tags, geometry: el.geometry });
    else if (el.type === 'node' && tags.railway === 'level_crossing') crossings.push({ lat: el.lat, lng: el.lon, tags });
    else if (el.type === 'node' && tags.waterway === 'waterfall') falls.push({ lat: el.lat, lng: el.lon, tags });
    else if (el.type === 'node' && (/^(subway_entrance|station_entrance)$/.test(tags.railway || '')
      || (tags.entrance && /^(station|subway)$/.test(tags.public_transport || '')))) {
      entrances.push({ lat: el.lat, lng: el.lon, tags });
    }
    else if (el.type === 'node' && (tags.place || tags.natural === 'peak' || tags.highway === 'motorway_junction' || tags.railway)) {
      pois.push({ lat: el.lat, lng: el.lon, tags });
    }
  }
  const built = buildAreaRecords(areaElements);
  return { areas: built.areas, pointFeatures: { rails, falls, crossings, pois, entrances, waters, boundaries } };
}

const argv = process.argv.slice(2);
const arg = (k, d) => { const i = argv.indexOf(k); return i >= 0 && argv[i + 1] ? argv[i + 1] : d; };
const team = +arg('--team', 5);
const ids = arg('--venues', 'barcelona,paris,manhattan,shibuya').split(',').filter(Boolean);

console.log(`路網中繼 payload 實測(${team}v${team};上限 maxPayload 2048KB / MAX_BYTES ${kb(OSM_RELAY.MAX_BYTES)})\n`);
console.log('場地        km²   道路way 面域 水道 界線 入口 原始JSON  中繼訊息  餘裕vs2MiB  fit');
let worst = 0;
let measured = 0;
for (const id of ids) {
  const v = VENUES.find((x) => x.id === id);
  if (!v) { console.log(`${id}:沒有這個場地`); continue; }
  const cfg = venueConfig(v, team);
  const bbox = battleBBox(cfg);
  const bb = `${bbox.minLat.toFixed(5)},${bbox.minLng.toFixed(5)},${bbox.maxLat.toFixed(5)},${bbox.maxLng.toFixed(5)}`;
  const km2 = bboxKm2(bbox);
  const nArea = quotaOf(km2, 1200, 600, 1800);
  const areaWays = OSM_AREA_KEYS.map((key) => `way["${key}"](${bb});`).join('');
  const areaRelations = OSM_AREA_KEYS.map((key) => `rel["type"="multipolygon"]["${key}"](${bb});`).join('');
  const fd = await overpass(featQ(bb, quotaOf(km2, 850, 400, 1200), quotaOf(km2, 400, 200, 900), nArea, areaWays, areaRelations));
  await sleep(1500);
  const rd = await overpass(roadQ(bb, quotaOf(km2, 150, 150, 600), quotaOf(km2, 1300, 400, 1600)));
  if (!fd || !rd) { console.log(`${id.padEnd(11)} 圖資取得失敗(換個時段再跑)`); continue; }
  const feats = parseFeats(fd);
  const roads = [];
  for (const el of rd.elements || []) {
    if (el.type === 'way' && el.geometry && el.tags?.highway) roads.push({ tags: el.tags, geometry: el.geometry });
  }
  const raw = bytes(JSON.stringify({ areas: feats.areas, pointFeatures: feats.pointFeatures, roads }));
  const clean = sanitizeOsmRelay({ bbox, areas: feats.areas, pointFeatures: feats.pointFeatures, roads });
  const fit = osmRelayFit(clean);
  const ped = planPedestrianNetwork({
    roads,
    rails: feats.pointFeatures.rails,
    pois: feats.pointFeatures.pois,
    entrances: feats.pointFeatures.entrances,
    toXZ: (p) => llToXZ(p.lat, p.lng ?? p.lon, cfg.center),
  });
  const msg = fit ? bytes(JSON.stringify(fit.msg)) : 0;
  measured++;
  worst = Math.max(worst, msg);
  console.log(`${id.padEnd(11)} ${km2.toFixed(2).padStart(5)} ${String(roads.length).padStart(6)} `
    + `${String(feats.areas.length).padStart(6)}`
    + ` ${String(feats.pointFeatures.waters.length).padStart(4)} ${String(feats.pointFeatures.boundaries.length).padStart(4)}`
    + ` ${String(feats.pointFeatures.entrances.length).padStart(4)} `
    + `${kb(raw).padStart(8)} ${kb(msg).padStart(9)} ${((2 * 1024 * 1024) / msg).toFixed(1).padStart(9)}× `
    + `${fit ? (fit.dropPointFeatures ? `裁面域 ${fit.dropAreas || 0}` : 'ok') : '整份放棄'}`);
  console.log(`  行人規劃 天橋 ${ped.stats.footbridges}・地下路線移除 ${ped.stats.undergroundRemoved}`
    + `・入口 ${ped.stats.entrances}・老街 ${ped.stats.oldstreet}`
    + `・自行車道 ${ped.stats.cycleway}・商圈步道 ${ped.stats.promenade}`);
  await sleep(1500);
}
if (!measured) {
  console.error('\n❌ 沒有任何場地取得兩份圖資；容量未驗，MUST NOT 把 0KB 當成餘裕。');
  process.exit(1);
}
console.log(`\n最大一則 ${kb(worst)};maxPayload 餘裕 ${((2 * 1024 * 1024) / (worst || 1)).toFixed(1)}×、`
  + `MAX_BYTES 餘裕 ${(OSM_RELAY.MAX_BYTES / (worst || 1)).toFixed(1)}×`);
console.log('⚠ 這是**單一時點**的量測:OSM 資料會長大,餘裕掉到 1.5× 以下就該回頭看兩個上限。');
