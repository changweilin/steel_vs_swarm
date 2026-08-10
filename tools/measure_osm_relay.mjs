// ============ 路網中繼 payload 實測(㋓ 需外網)============
// 用途:量「房主要送出去的那一則 `t:'osm'` 到底多大」,回頭核對兩個上限 ——
//   ・`server.js` 的 `maxPayload`(2MiB;超過 ws 以 1009 直接斷掉**房主**的連線);
//   ・`osmrelay.js` 的 `OSM_RELAY.MAX_BYTES`(客戶端自我封頂,超過先丟 feats 再整份放棄)。
// 第一版落地時只量過**道路**那一半(docs/map_grid_alignment.md §7.3),建物/鐵路/POI 那一半
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
import { battleBBox } from '../public/js/data.js';
import { OSM_RELAY, sanitizeOsmRelay, osmRelayFit } from '../public/js/osmrelay.js';

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
const featQ = mkQuery('fetchOsmFeatures', ['bb', 'nBld']);
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
  const buildings = [], rails = [], falls = [], crossings = [], pois = [];
  for (const el of data.elements || []) {
    const tags = el.tags || {};
    if (el.type === 'way' && el.geometry && tags.railway) rails.push({ tags, geometry: el.geometry });
    else if (el.type === 'node' && tags.railway === 'level_crossing') crossings.push({ lat: el.lat, lng: el.lon, tags });
    else if (el.type === 'node' && tags.waterway === 'waterfall') falls.push({ lat: el.lat, lng: el.lon, tags });
    else if (el.type === 'node' && (tags.place || tags.natural === 'peak' || tags.highway === 'motorway_junction' || tags.railway)) {
      pois.push({ lat: el.lat, lng: el.lon, tags });
    } else {
      const lat = el.center?.lat ?? el.lat, lng = el.center?.lon ?? el.lon;
      if (Number.isFinite(lat)) buildings.push({ lat, lng, tags });
    }
  }
  return { buildings, rails, falls, crossings, pois };
}

const argv = process.argv.slice(2);
const arg = (k, d) => { const i = argv.indexOf(k); return i >= 0 && argv[i + 1] ? argv[i + 1] : d; };
const team = +arg('--team', 5);
const ids = arg('--venues', 'barcelona,paris,manhattan,shibuya').split(',').filter(Boolean);

console.log(`路網中繼 payload 實測(${team}v${team};上限 maxPayload 2048KB / MAX_BYTES ${kb(OSM_RELAY.MAX_BYTES)})\n`);
console.log('場地        km²   道路way 建物  鐵路  原始JSON  中繼訊息  餘裕vs2MiB  fit');
let worst = 0;
for (const id of ids) {
  const v = VENUES.find((x) => x.id === id);
  if (!v) { console.log(`${id}:沒有這個場地`); continue; }
  const cfg = venueConfig(v, team);
  const bbox = battleBBox(cfg);
  const bb = `${bbox.minLat.toFixed(5)},${bbox.minLng.toFixed(5)},${bbox.maxLat.toFixed(5)},${bbox.maxLng.toFixed(5)}`;
  const km2 = bboxKm2(bbox);
  const fd = await overpass(featQ(bb, quotaOf(km2, 850, 400, 1200)));
  await sleep(1500);
  const rd = await overpass(roadQ(bb, quotaOf(km2, 150, 150, 600), quotaOf(km2, 1300, 400, 1600)));
  if (!fd || !rd) { console.log(`${id.padEnd(11)} 圖資取得失敗(換個時段再跑)`); continue; }
  const feats = parseFeats(fd);
  const roads = [];
  for (const el of rd.elements || []) {
    if (el.type === 'way' && el.geometry && el.tags?.highway) roads.push({ tags: el.tags, geometry: el.geometry });
  }
  const raw = bytes(JSON.stringify({ feats, roads }));
  const clean = sanitizeOsmRelay({ bbox, feats, roads });
  const fit = osmRelayFit(clean);
  const msg = fit ? bytes(JSON.stringify(fit.msg)) : 0;
  worst = Math.max(worst, msg);
  console.log(`${id.padEnd(11)} ${km2.toFixed(2).padStart(5)} ${String(roads.length).padStart(6)} `
    + `${String(feats.buildings.length).padStart(6)} ${String(feats.rails.length).padStart(5)} `
    + `${kb(raw).padStart(8)} ${kb(msg).padStart(9)} ${((2 * 1024 * 1024) / msg).toFixed(1).padStart(9)}× `
    + `${fit ? (fit.dropFeats ? '丟了 feats' : 'ok') : '整份放棄'}`);
  await sleep(1500);
}
console.log(`\n最大一則 ${kb(worst)};maxPayload 餘裕 ${((2 * 1024 * 1024) / (worst || 1)).toFixed(1)}×、`
  + `MAX_BYTES 餘裕 ${(OSM_RELAY.MAX_BYTES / (worst || 1)).toFixed(1)}×`);
console.log('⚠ 這是**單一時點**的量測:OSM 資料會長大,餘裕掉到 1.5× 以下就該回頭看兩個上限。');
