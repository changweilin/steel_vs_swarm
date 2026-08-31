// ============ 路網中繼 payload 實測(㋓ 需外網)============
// 用途:量「房主要送出去的那一則 `t:'osm'` 到底多大」,回頭核對兩個上限 ——
//   ・`server.js` 的 `maxPayload`(2MiB;超過 ws 以 1009 直接斷掉**房主**的連線);
//   ・`osmrelay.js` 的 `OSM_RELAY.MAX_BYTES`(客戶端自我封頂,超過先丟 feats 再整份放棄)。
// 第一版落地時只量過**道路**那一半(PR #188 的討論串),建物/鐵路/POI 那一半
// 是靠自我封頂兜底的 —— 本工具把缺的那一半補上。
//
// **查詢字串與 parser 取自 `osmQuery.js` 共用縫**,不是抄一份:
// 抄的那份會在額度或查詢改版時靜默過期,而它量出來的數字看起來一樣正常。
//
// 用法:
//   node tools/measure_osm_relay.mjs                       # 預設四張密市區圖,5v5
//   node tools/measure_osm_relay.mjs --venues paris,seoul --team 3
import { VENUES, venueConfig } from '../public/js/venues.js';
import { battleBBox, llToXZ } from '../public/js/data.js';
import { OSM_RELAY, sanitizeOsmRelay, osmRelayFit } from '../public/js/osmrelay.js';
import { planPedestrianNetwork } from '../public/js/pedestrian.js';
import {
  bboxKm2, osmFeatureQuery, osmRoadQuery,
  parseOsmFeatureElements, osmRoadsFromElements,
} from '../public/js/osmQuery.js';

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
  const fd = await overpass(osmFeatureQuery(bbox));
  await sleep(1500);
  const rd = await overpass(osmRoadQuery(bbox));
  if (!fd || !rd) { console.log(`${id.padEnd(11)} 圖資取得失敗(換個時段再跑)`); continue; }
  const feats = parseOsmFeatureElements(fd.elements);
  const roads = osmRoadsFromElements(rd.elements);
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
