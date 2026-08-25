// ============ 行人路網語意規劃稽核 ============
// 驗證 `public/js/pedestrian.js` 與 `biomes.js` 的唯一接線點：
//   Ⅰ 高架步道保留原端點並標成人行天橋；未標 bridge 的泡水步道不得被猜成橋。
//   Ⅱ 地下步道整條從道路輸出移除，但兩端保留入口；車站附近入口套用車站款。
//   Ⅲ 同層長距離平行才套老街／綠廊／自行車道，孤立筆直步道逐物件不變。
//   Ⅳ OSM 入口查詢、快取版、路網中繼、橋面建置與世界文字只各有一條接線。
//   Ⅴ 全管線零 Math.random、零共享 rnd，輸入重排只改輸出排列、不改幾何判決。
//
// 反向驗證：
//   --break-underground  關掉 tunnel 地下分類       ⇒ Ⅱ MUST 紅
//   --break-footbridge   關掉 bridge=yes 分類       ⇒ Ⅰ MUST 紅
//   --break-adjacent     平行覆蓋門檻調成不可能達成 ⇒ Ⅲ MUST 紅
import { readSrc } from './audit_src.mjs';

const argv = process.argv;
let src = readSrc('public', 'js', 'pedestrian.js');
const replaceOne = (re, value, label) => {
  const hits = src.match(new RegExp(re.source, re.flags.includes('g') ? re.flags : re.flags + 'g')) || [];
  if (hits.length !== 1) throw new Error(`${label} 反向替換命中 ${hits.length} 次`);
  src = src.replace(re, value);
};
if (argv.includes('--break-underground')) {
  replaceOne(/export function isUndergroundPedestrian\(tags\) \{/,
    "export function isUndergroundPedestrian(tags) { return false;", 'underground');
}
if (argv.includes('--break-footbridge')) {
  replaceOne(/&& on\(tags\?\.bridge\) && !on\(tags\?\.tunnel\)/,
    "&& false && !on(tags?.tunnel)", 'footbridge');
}
if (argv.includes('--break-adjacent')) {
  replaceOne(/MIN_PARALLEL_F: 0\.42/, 'MIN_PARALLEL_F: 2', 'adjacent');
}
const M = await import(`data:text/javascript;base64,${Buffer.from(src).toString('base64')}`);
const bioSrc = readSrc('public', 'js', 'biomes.js');
const relaySrc = readSrc('public', 'js', 'osmrelay.js');

let pass = 0, fail = 0;
const t = (name, ok, extra = '') => {
  if (ok) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.log(`  ✗ ${name}${extra ? ` — ${extra}` : ''}`); }
};
const sec = (name) => console.log(`\n${name}`);
const p = (x, z) => ({ lat: z, lon: x });
const way = (highway, pts, tags = {}) => ({ tags: { highway, ...tags }, geometry: pts.map(([x, z]) => p(x, z)) });
const toXZ = (q) => [q.lon ?? q.lng, q.lat];
const plan = (roads, extras = {}) => M.planPedestrianNetwork({ roads, rails: [], pois: [], entrances: [], toXZ, ...extras });
const sig = (r) => `${r.tags.highway}:${r.geometry.map((q) => `${q.lon},${q.lat}`).join('|')}:${r._ped?.theme || ''}`;

sec('Ⅰ 高架步道 = 人行天橋');
{
  const bridge = way('footway', [[0, 0], [30, 0], [70, 0]], { bridge: 'yes', layer: '1', name: 'Footbridge' });
  const r = plan([bridge]);
  t('bridge=yes 步道保留', r.roads.length === 1);
  t('標成人行天橋而非一般道路', r.roads[0]?._ped?.kind === 'footbridge' && r.roads[0]._ped.theme === 'footbridge');
  t('端點逐位元不動（通行連接不被設計外觀切斷）', r.roads[0]?.geometry[0] === bridge.geometry[0]
    && r.roads[0]?.geometry.at(-1) === bridge.geometry.at(-1));
  t('bridge=no 不得誤判高架', !M.isPedestrianBridge({ highway: 'footway', bridge: 'no' }));
  t('高架優先於負 layer，不被誤刪成地下入口', !M.isUndergroundPedestrian(bridge.tags));
}

sec('Ⅱ 地下步道只留出入口');
{
  const underground = way('footway', [[0, 0], [25, 0], [50, 0]], { tunnel: 'yes', layer: '-1' });
  const r = plan([underground]);
  t('地下路線從道路輸出整條移除', r.roads.length === 0 && r.stats.undergroundRemoved === 1);
  t('非閉環地下線保留兩端入口', r.entrances.length === 2
    && r.entrances.every((e) => e.kind === 'underpass' && e.source === 'underground-end'));
  t('入口方向沿原路線向外', Number.isFinite(r.entrances[0]?.ry) && Number.isFinite(r.entrances[1]?.ry)
    && Math.abs(r.entrances[0].ry + Math.PI / 2) < 1e-9
    && Math.abs(r.entrances[1].ry - Math.PI / 2) < 1e-9);

  const pois = [{ lat: 0, lng: 52, tags: { railway: 'station', name: 'Victoria' } }];
  const s = plan([underground], { pois });
  t('車站附近地下端點改用車站入口款', s.entrances.some((e) => e.kind === 'station'
    && e.stationTags?.name === 'Victoria'));

  const entry = [{ lat: 4, lng: 48, tags: { railway: 'subway_entrance', ref: 'A' } }];
  const e = plan([], { pois, entrances: entry });
  t('OSM 捷運入口節點即使沒有地下 way 仍會建入口', e.entrances.length === 1
    && e.entrances[0].source === 'osm-entrance');

  const closed = way('footway', [[0, 0], [20, 0], [20, 20], [0, 0]], { tunnel: 'yes', layer: '-1' });
  const c = plan([closed]);
  t('封閉地下環移除但不憑空捏造重合入口', c.roads.length === 0 && c.entrances.length === 0);

  // 測試同站多出入口：統一樣式、同一站名、不同出口編號
  const rRoad = way('residential', [[0, 0], [100, 0]]);
  const multiEntry = [
    { lat: 0, lng: 45, tags: { railway: 'subway_entrance' } },
    { lat: 0, lng: 55, tags: { railway: 'subway_entrance' } },
  ];
  const mRes = plan([rRoad], { pois, entrances: multiEntry });
  t('同站多出入口聚類成功產出 2 座', mRes.entrances.length === 2);
  t('同站出入口共享相同樣式', mRes.entrances[0].archetype && mRes.entrances[0].archetype === mRes.entrances[1].archetype);
  t('同站出入口共享相同站名', mRes.entrances[0].baseName === 'Victoria' && mRes.entrances[1].baseName === 'Victoria');
  t('同站出入口擁有不同循序編號與標牌文字', mRes.entrances[0].exitNum !== mRes.entrances[1].exitNum
    && mRes.entrances[0].signText !== mRes.entrances[1].signText);
  t('出入口不背對道路 (朝向法線點積 <= 1e-5)', mRes.entrances.every((ent) => {
    const ny = ent.z >= 0 ? 1 : -1;
    const forwardY = Math.cos(ent.ry);
    return forwardY * ny <= 1e-5;
  }));
}

sec('Ⅲ 道路／鐵道旁步道統一規劃');
{
  const road = way('residential', [[0, 0], [120, 0]]);
  const side = way('footway', [[0, 8], [120, 8]]);
  const r = plan([road, side]);
  t('沿道路長距離平行步道 = 綠廊', r.roads.find((w) => w.tags.highway === 'footway')?._ped?.theme === 'promenade');

  const rail = { tags: { railway: 'rail' }, geometry: [p(0, 0), p(120, 0)] };
  const rr = plan([side], { rails: [rail] });
  t('沿鐵道平行步道 = 自行車道', rr.roads[0]?._ped?.theme === 'cycleway');

  const station = [{ lat: 8, lng: 60, tags: { railway: 'station', name: 'Central' } }];
  const sr = plan([road, side], { pois: station });
  t('車站商圈內沿路步道 = 老街', sr.roads.find((w) => w.tags.highway === 'footway')?._ped?.theme === 'oldstreet');

  const bike = way('footway', [[0, 40], [80, 40]], { bicycle: 'designated' });
  t('圖資明示自行車通行時不必依賴鄰路', plan([bike]).roads[0]?._ped?.theme === 'cycleway');

  const isolated = way('footway', [[0, 80], [120, 80]]);
  const iso = plan([road, isolated]);
  t('孤立筆直正常步道逐物件保留，不因長／窄而刪', iso.roads.includes(isolated) && !isolated._ped);

  const cross = way('footway', [[60, -60], [60, 60]]);
  t('只短暫垂直交叉不套沿線主題', !plan([road, cross]).roads.find((w) => w === cross)?._ped);
}

sec('Ⅳ 消費端單一接線');
{
  t('OSM features 快取已升版 4', /geoKey\('osmF', 4, bbox/.test(bioSrc));
  t('查詢同時收 subway_entrance 與 station_entrance', /subway_entrance\|station_entrance/.test(bioSrc));
  t('路網中繼保留 entrances 且有獨立上限', /MAX_ENTRANCE/.test(relaySrc)
    && /entrances: nodesOf\(f\.entrances, OSM_RELAY\.MAX_ENTRANCE\)/.test(relaySrc));
  t('地下移除先於 pruneRoads', bioSrc.indexOf('planPedestrianNetwork({') < bioSrc.indexOf('osmRoads = pruneRoads('));
  t('明示步橋進橋樑管線，泡水步道不自動建橋', /const brg = bridge \|\| \(!ped && run\.wet === true\);/.test(bioSrc));
  t('人行天橋不被平行車橋或兵線補橋去重', /if \(A\.ped !== B\.ped\) continue;/.test(bioSrc)
    && /if \(isPedestrianBridge\(w\.tags\)\) return true;/.test(bioSrc));
  t('人行橋通行寬由 FOOTBRIDGE_MIN_W_M 單一值推導', /PED_PLAN\.FOOTBRIDGE_MIN_W_M \/ 2/.test(bioSrc));
  t('車站入口招牌仍走 buildWorldSigns／SignSheet 唯一文字層', /entranceSigns: pedestrianEntrances\.signSpots/.test(bioSrc)
    && /for \(const s of entranceSigns\)/.test(bioSrc));
  t('入口外觀走一個生成器與 PED_ARCHETYPES 資料列', /function buildPedestrianEntrances/.test(bioSrc)
    && /for \(const kind of Object\.keys\(PED_ARCHETYPES\)\)/.test(bioSrc));
}

sec('Ⅴ 決定性與重排不變');
{
  t('規劃模組零 Math.random／共享 rnd', !/Math\.random|\brnd\s*\(/.test(src));
  const a = way('residential', [[0, 0], [120, 0]]);
  const b = way('footway', [[0, 8], [120, 8]]);
  const c = way('footway', [[0, 50], [80, 50]], { bridge: 'yes' });
  const fwd = plan([a, b, c]).roads.map(sig).sort();
  const rev = plan([c, b, a]).roads.map(sig).sort();
  t('輸入 way 重排後逐路判決相同', JSON.stringify(fwd) === JSON.stringify(rev));
  const twiceA = plan([a, b, c]), twiceB = plan([a, b, c]);
  t('同輸入重跑逐位元相同', JSON.stringify(twiceA) === JSON.stringify(twiceB));
}

console.log(`\n${fail ? '❌' : '✅'} 行人路網語意規劃：${pass} 通過 / ${fail} 失敗`);
process.exit(fail ? 1 : 0);
