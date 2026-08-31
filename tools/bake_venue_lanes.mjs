// ============ 預設場地兵線離線預算 ============
// 用法:node tools/bake_venue_lanes.mjs   (ONLY=taipei101,seoul 可只跑指定場地)
// 產出 public/js/venueLanes.js。改 ANCHORS 或 MAPGEO 的尺寸/重合率常數後 MUST 重跑。
// 逐場地烤四份:完整戰場 L1/L2/L3 + **縮小尺度的單兵線 m1**(迷你地圖與劇情戰役共用 ——
// 兩者 mapScaleF 相同,見 venues.js venueLaneKey)。m1 的砲塔規則一次驗三種型態
// (迷你 / 劇情守方在 SWARM / 劇情守方在 STEEL),因為守方是哪一邊逐章不同、還會被
// rollSideSwap 再擲一次。改 MINI.STAGES / STORY_MAP.DEF_STAGES 後 MUST 重跑。
// Overpass 真實道路路網 → 建圖 → 每條兵線 = 一條「邊不相交」的最短路徑(全程踩在現實道路上)
// → 用 overlapCellM(L) 驗重合率 ≤ MAX_OVERLAP、繞路 ≤ 2.2×、兩堡距離 ≥ 對角線 80%。
// 方位角挑選另偏好砲塔規則:#5 洞內砲塔 ≥20% 射程涵蓋洞口外(towerTunnelAudit)優先於
// #4 射程重疊殘餘(towerLayoutAudit)—— 塔埋在山體裡只能沿洞內走廊對射,是功能性缺陷。
import { writeFileSync, readFileSync, existsSync, mkdirSync } from 'node:fs';
import { MAPGEO, realDistFor, targetDistFor, overlapCellM, laneTacticsXZ, tacticalScore, towerLayoutAudit, towerTunnelAudit, laneSeparationAudit, laneUTurnAudit, laneTurnAccumAudit, laneStructEntryAudit }
  from '../public/js/data.js';
// 既有兵線:ONLY= 局部重烤時,沒烤到的場地要原樣寫回(見下方 keep)
import { VENUE_LANES } from '../public/js/venueLanes.js';
// 表的鍵只有 venues.js 一份(消費端與產生端同吃 —— 在這裡照抄一個字串前綴,
// 改鍵時必漏改其中一邊,而症狀是「烤了卻沒人讀得到」,沒有任何錯誤訊息)。
import { VENUE_LANE_KEYS, venueLaneModes } from '../public/js/venues.js';
// 結構隧道資格閘(**執行 biomes.js 原文**的那一份,§2.1「離線工具的結構剖面」單一縫)。
// 2026-08-04:舊制 buildGraph 直接看 `w.tags.tunnel` = 第二份實作,比引擎鬆 ——
// `indoor=yes` 的 service 通道(車站地下街 / 停車場坡道)在引擎裡一律攤平成一般小路
//(`strucTunnel`,2026-07-29 澀谷側壁破口案),卻照樣被 `PREFER_TUNNEL` 當成「這條路線
// 走得到隧道」而拿去加分,也照樣被規則「橋/隧只能從出入口進出」當成結構去擋。
// 選線期與執行期對隧道的定義分家,症狀是「烤出來的兵線號稱走地下道,開圖是一條平街」。
import { strucTunnel } from './venue_field.mjs';

// 兵線 lat/lng → 遊戲公尺(中心相對;與 audit_map_rules / runtime 同一換算 ⇒ 烘焙期的規則判定與最終稽核一致)
const SC_GAME = 1 / MAPGEO.REAL_SCALE, EARTH_M = 6371000;
const llToGame = (lat, lng, c) => [
  (lng - c.lng) * Math.PI / 180 * EARTH_M * Math.cos(c.lat * Math.PI / 180) * SC_GAME,
  (lat - c.lat) * Math.PI / 180 * EARTH_M * SC_GAME,
];
// 寫出精度(六位小數 ≈ 0.1m):規則硬門檻與寫檔 MUST 用同一個捨入(見 tryBearing 分離閘)
const r6 = (v) => +v.toFixed(6);

const CACHE = new URL('./.osm_cache/', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
if (!existsSync(CACHE)) mkdirSync(CACHE, { recursive: true });

const R = 6371000, d2r = Math.PI / 180;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (...a) => { console.log(...a); };

const ONLY = (process.env.ONLY || '').split(',').filter(Boolean);
const ANCHORS_ALL = {
  taipei101: [[25.0339, 121.5645]],
  shibuya: [[35.6595, 139.7005]],
  manhattan: [[40.7549, -73.9840]],
  paris: [[48.8584, 2.2945]],
  seoul: [[37.4979, 127.0276]],
  // 自然場地:錨點移到鄰近有路網的聚落(地貌 mix 不變,仍是森林/沙漠/濕地的視覺)
  yangmingshan: [[25.1180, 121.5300], [25.1370, 121.5450]],   // 天母(陽明山南麓住宅網格)
  aokigahara: [[35.4972, 138.7546], [35.4986, 138.6866]],     // 河口湖町
  blackforest: [[48.4670, 8.4115], [48.5480, 8.3700]],        // Freudenstadt / Baiersbronn
  yosemite: [[37.6690, -119.7990], [37.7485, -119.5878]],     // El Portal / 優勝美地村
  giza: [[29.9870, 31.1420], [29.9773, 31.1325]],             // Nazlet El-Semman
  uluru: [[-25.2406, 130.9889]],                              // Yulara 度假村
  phoenix: [[33.4950, -112.1700]],                            // 西鳳凰城 Maryvale 索諾拉沙漠格柵(全 L 過稽核)
  hehuanshan: [[23.9650, 120.9670], [24.0577, 121.1614]],     // 埔里鎮 / 清境農場
  venice: [[45.4850, 12.2350], [45.4408, 12.3155]],           // Mestre(本島無車道)
  iguazu: [[-25.5990, -54.5735]],                             // Puerto Iguazú
  tamsui: [[25.1680, 121.4450], [25.1720, 121.4400]],         // 淡水市區
  okavango: [[-19.9833, 23.4167]],                            // Maun
  rio: [[-22.9700, -43.1850], [-22.9519, -43.2105]],
  // 金龍隧道西南口外(金龍路)/ 東北口外(金湖路)。L1 兩堡僅 ~481 真實公尺、隧道 ~195m:
  // 錨點 MUST 貼隧道軸且距洞口 ~130m,B 才不會被吸進隧道內部或繞上別的街廓
  jinlong: [[25.0838, 121.5846], [25.0873, 121.5895]],
  // ② 純陸域高架橋的候選(**尚未定案**,故 venues.js 暫不收):Park Avenue 高架繞中央車站,
  // 底下全是街道。三輪實測(夾方位角 / 放開方位角 / PREFER_BRIDGE 偏好)兵線最近只到高架旁 4m,
  // 沒真的踩上橋面 —— 曼哈頓格柵的等長替代路線太多,且高架與地面 Park Ave 是分離的 way。
  parkave: [[40.75005, -73.97940], [40.75500, -73.97530]],
  barcelona: [[41.3925, 2.1620], [41.3850, 2.1700]],          // 巴塞隆納 Eixample 格柵(臨地中海)
  // 劇情終章場地(2026-08-04)。納希莫夫廣場 / 烏沙科夫廣場 —— 兩座廣場都在市中心
  // 半島的脊線上,之間隔著 ~450 真實公尺的密街廓 ⇒ L1~L3 都排得出互不接觸的三條真實道路。
  crimea: [[44.6172, 33.5243], [44.6137, 33.5218]],           // 塞瓦斯托波爾市中心
  // 倫敦:2026-08-02 使用者回報「倫敦也沒有橋了」—— 07-29 主軸偏航規則重烤後兵線不再走
  // Westminster Bridge(改前實測踩橋 298m)。錨點改貼西橋頭、方位角夾往東岸,並掛 PREFER_BRIDGE:
  // 泰晤士河在此寬 ~250m,兩堡 481 真實公尺一南一北岸 ⇒ 唯一走得通的路線就是橋面。
  london: [[51.50094, -0.12456], [51.50110, -0.11810]],
  // 以下三張是 2026-08-02 探測(`--probe --probe-r=2`)選定的場地,錨點一律取探測回報的
  // **結構中點**再沿軸退開 ~150m —— 錨點壓在結構上會讓主堡落進橋面/洞內(jinlong 同一條經驗)。
  //
  // 陸上高架橋(③):柏林 華沙大街跨東站調車場。實測 Warschauer Brücke 陸橋 446m
  // @52.50569,13.44893(橋下是鐵道 ⇒ spansWater 判否);同一 bbox 的 Oberbaumbrücke 是水橋,
  // 方位角夾南北(橋軸)才不會跑去跨施普雷河。左右數百公尺內沒有第二個跨越點 ⇒ 最短路徑非上橋不可
  // (parkave 失敗的原因正是「等長替代路線太多」,曼哈頓格柵怎麼繞都一樣長)。
  berlin: [[52.50330, 13.44875], [52.50810, 13.44930]],
  // 地下道(②):馬德里 卡斯提亞大道一帶。地形全平 ⇒ 深度只能來自「挖」,正是 underpassPlan
  // 的適用面;PREFER_TUNNEL 讓選線踩上 tunnel way。
  // **錨點改用 María de Molina**(探測覆蓋 234m @40.43784,-3.68745):首輪的 Joaquín Costa
  // 探測報 165m,但**執行期**只建得出 29m 覆蓋段(< 場景門檻 ON_MIN 之後所剩無幾),
  // 兵線最近只到洞旁 1m 就繞回地面 —— 探測長度是圖資 way 全長,不是遊戲裡真的挖出來的洞。
  // 挑地下道場地一律以「執行期覆蓋長度」為準,MUST NOT 拿圖資長度當數據。
  // 2026-08-04 探測(r=3)把這一帶的覆蓋段中點量清楚了:María de Molina **277m**
  // @40.43785,-3.68759(舊註記的 234m 是同一條,量到的段落略短)、Joaquín Costa 212m
  // @40.44491,-3.68517。錨點改成夾住 277m 那一段的兩端(各退開 ~250m):兩堡 481m 剛好
  // 把整段納進來、兩頭各留 ~100m 露天。舊錨點(-3.68925 / -3.68560)只涵蓋到洞的一半
  // ⇒ 兵線從洞頂跨過去,實測中的是 ⑦ 穿越地下道上方而不是 ②。
  madrid: [[40.43785, -3.69007], [40.43785, -3.68511], [40.44491, -3.68517]],
  // 水上高架橋(⑨):芝加哥河兩岸。實測 North Lower Michigan Avenue 水橋 201m
  // @41.88884,-87.62436(跨圖資水道)。河面僅數十公尺寬、南北向幹道一律以可通車的開合橋跨河
  // ⇒ 兩堡分踞兩岸時兵線必然踩上橋面(與 london 的「單座長橋」互為對照組)。
  chicago: [[41.88770, -87.62436], [41.89000, -87.62436]],
  // 市民大道:**2026-08-04 從 ② 地下道候選改成 ③ 陸上高架橋**。
  // 舊制錨點是為了追一群圖資地下道(L1 bbox 內 8 條 tunnel way)而擺的,配 PREFER_TUNNEL;
  // 但 2026-07-30 全量掃描早已實測「兵線走到的那條 60m service 隧道 underpassPlan 規劃放棄、
  // 仍是平街」⇒ ② 在這張圖上不成立(docs/lane_scenarios.md 已記),偏好卻沒跟著撤。
  // 後果是實測到的:L1 兵線被 PREFER_TUNNEL 拉到 25.0495~25.0526(錨點以北 280~620m)、
  // **場景 0 種**,而這張圖真正有的東西 —— 市民大道高架道路 —— 在兵線 226m 外。
  // 新錨點取 2026-08-04 探測回報的陸橋覆蓋段中點(`--probe=25.047,121.518 --probe-r=3`):
  //   市民大道高架道路 1526m @25.04974,121.51228 / 1269m @25.04979,121.51243
  //   市民大道高架道路 560m @25.05018,121.50993(西段)
  // 兩錨沿高架軸(東西向)排開、BEARING_SECTORS 夾在橋軸上,選線改由 PREFER_BRIDGE 主導。
  civicblvd: [[25.05018, 121.50993], [25.04974, 121.51228]],
  // ② 地下道的第二張圖候選(2026-08-04 探測選定):東京・六本木。
  // 同一次探測回報這一帶有 **7 條**引擎真的挖得出來的車行地下道,是掃過最密的一區:
  //   乃木坂トンネル 覆蓋 547m @35.66675,139.72644
  //   環状三号線     覆蓋 265m @35.66163,139.72851
  //   環状三号線     覆蓋 107m @35.66387,139.72581
  // 三個中點直接當候選錨點,**不夾方位角** —— 這一帶的地下道軸向不一(乃木坂東西向、
  // 環状三号線南北向),夾錯反而把唯一走得通的方位排除掉(parkave 的前例)。
  // 尺度提醒:L1 兩堡只有 ~481 真實公尺,而乃木坂トンネル 覆蓋 547m **比整條兵線還長**
  // ⇒ 選它會把兩座主堡一起塞進洞裡(規則 #5 洞內砲塔必然違規)。265m/107m 那兩段才是
  // 「洞在中段、兩頭露天」的尺度,選線排序會自己挑(tunLen 相同才比 tunBad)。
  roppongi: [[35.66163, 139.72851], [35.66387, 139.72581], [35.66675, 139.72644]],
  // ④ 明隧道的測試場地(2026-07-29 廣域探測選定):太魯閣峽谷 燕子口—錐麓段,台8線上
  // 三段短隧道幾乎整條是明隧道(探測 open 72m/54m/96m,中點 121.5547/121.5537/121.5509),
  // 彼此相距 ~400m,一條 L1 兵線可連穿多座。錨點 MUST 取探測回報的**路上座標**(峽谷路窄,
  // 憑地名下錨會落在崖壁上「120m 內無道路節點」);首錨 = 最東那段明隧道中點,往西烤。
  taroko: [[24.1712, 121.5547], [24.1712, 121.5560]],
  kyoto: [[35.0100, 135.7100], [35.0116, 135.6800]],          // 右京區街廓 / 嵐山
};

const ANCHORS = ONLY.length ? Object.fromEntries(Object.entries(ANCHORS_ALL).filter(([k])=>ONLY.includes(k))) : ANCHORS_ALL;

const DRIVABLE = 'motorway|trunk|primary|secondary|tertiary|unclassified|residential|living_street|service'
  + '|motorway_link|trunk_link|primary_link|secondary_link|tertiary_link';
const ENDPOINTS = [
  'https://overpass-api.de/api/interpreter',
  'https://maps.mail.ru/osm/tools/overpass/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
];

async function overpassRoads(id, lat, lng, radius) {
  const f = `${CACHE}/${id}.json`;
  if (existsSync(f)) return JSON.parse(readFileSync(f, 'utf8'));
  const q = `[out:json][timeout:90];way["highway"~"^(${DRIVABLE})$"](around:${Math.round(radius)},${lat},${lng});out geom;`;
  for (let a = 0; a < 6; a++) {
    const url = ENDPOINTS[a % ENDPOINTS.length];
    try {
      // Content-Type 必須明講:Node fetch 對字串 body 預設 text/plain,
      // Overpass 會把 "data=" 前綴當成查詢語法 → 406 Not Acceptable
      // signal:Node 的 fetch 沒有預設逾時,半死的連線會把整支烘焙掛住
      const resp = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: 'data=' + encodeURIComponent(q),
        signal: AbortSignal.timeout(60000),
      });
      if (!resp.ok) { log(`  overpass ${resp.status} @${new URL(url).host}, retry`); await sleep(3000 * (a + 1)); continue; }
      const d = await resp.json();
      const els = d.elements || [];
      writeFileSync(f, JSON.stringify(els));
      return els;
    } catch (e) { log('  overpass err', e.message); await sleep(3000 * (a + 1)); }
  }
  // 備援:OSM 官方 API 的 /map(2026-07-28)。Overpass 的公共鏡像對雲端 IP(CI runner /
  // 開發沙箱)常態拒絕,沒有備援就烤不出新場地。/map 走另一套基礎設施、回傳該 bbox 的原始
  // node/way,篩出 DRIVABLE 車行道後與 Overpass 回應同形(tags + geometry)。
  const els = await osmApiRoads(lat, lng, radius);
  if (els) { writeFileSync(f, JSON.stringify(els)); return els; }
  return null;
}

/** OSM 官方 /map 備援:回傳與 Overpass `out geom` 同形的 way 陣列(只留車行道) */
async function osmApiRoads(lat, lng, radius) {
  const dLat = radius / 111320, dLng = radius / (111320 * Math.cos(lat * d2r));
  const url = `https://api.openstreetmap.org/api/0.6/map?bbox=${(lng - dLng).toFixed(5)},${(lat - dLat).toFixed(5)},`
    + `${(lng + dLng).toFixed(5)},${(lat + dLat).toFixed(5)}`;
  const RE = new RegExp(`^(${DRIVABLE})$`);
  for (let a = 0; a < 3; a++) {
    try {
      const r = await fetch(url, { signal: AbortSignal.timeout(90000) });
      if (!r.ok) { log(`  osm-api ${r.status}, retry`); await sleep(3000 * (a + 1)); continue; }
      const xml = await r.text();
      const nodes = new Map();
      const attr = (s2, k) => { const m = new RegExp(`${k}="([^"]*)"`).exec(s2); return m ? m[1] : null; };
      for (const m of xml.matchAll(/<node\s([^>]*?)(\/>|>[\s\S]*?<\/node>)/g)) {
        const id2 = attr(m[1], 'id'), la = +attr(m[1], 'lat'), lo = +attr(m[1], 'lon');
        if (id2 && Number.isFinite(la)) nodes.set(id2, { lat: la, lon: lo });
      }
      const out = [];
      for (const m of xml.matchAll(/<way\s([^>]*?)>([\s\S]*?)<\/way>/g)) {
        const body = m[2], tags = {};
        for (const t of body.matchAll(/<tag k="([^"]*)" v="([^"]*)"\s*\/>/g)) tags[t[1]] = t[2];
        if (!RE.test(tags.highway || '')) continue;
        const geometry = [];
        for (const n of body.matchAll(/<nd ref="(\d+)"\s*\/>/g)) {
          const p = nodes.get(n[1]);
          if (p) geometry.push({ lat: p.lat, lon: p.lon });
        }
        if (geometry.length >= 2) out.push({ type: 'way', tags, geometry });
      }
      log(`  osm-api 備援取得 ${out.length} 條車行道`);
      return out.length ? out : null;
    } catch (e) { log('  osm-api err', e.message); await sleep(3000 * (a + 1)); }
  }
  return null;
}

// ---- 數值索引路網圖 ----
function buildGraph(ways, origin) {
  const idx = new Map();          // "lat,lng" -> i
  const X = [], Z = [], LA = [], LN = [], adj = [];
  const tunE = new Set();         // 隧道邊 "u:v"(雙向都記):規則 #5 選線判定用
  const brgE = new Set();         // 橋樑邊(同上):PREFER_BRIDGE 場地的選線偏好用
  const portalN = new Set();      // 橋/隧 way 的端點節點 = 出入口(portal):規則「只能從出入口進出」
  const cosO = Math.cos(origin[0] * d2r);
  const nid = (la, ln) => {
    const k = `${la.toFixed(6)},${ln.toFixed(6)}`;
    let i = idx.get(k);
    if (i === undefined) {
      i = X.length;
      idx.set(k, i);
      X.push((ln - origin[1]) * d2r * R * cosO);
      Z.push((la - origin[0]) * d2r * R);
      LA.push(la); LN.push(ln); adj.push([]);
    }
    return i;
  };
  for (const w of ways) {
    if (!w.geometry) continue;
    const tun = strucTunnel(w.tags);          // 資格閘與引擎同一份(見檔頭 import 註解)
    const brg = !!w.tags?.bridge && !w.tags?.tunnel;
    for (let i = 1; i < w.geometry.length; i++) {
      const a = w.geometry[i - 1], b = w.geometry[i];
      const u = nid(a.lat, a.lon), v = nid(b.lat, b.lon);
      if (u === v) continue;
      const len = Math.hypot(X[u] - X[v], Z[u] - Z[v]);
      adj[u].push(v, len);        // 扁平化:[v0,len0, v1,len1, …]
      adj[v].push(u, len);
      if (tun) { tunE.add(`${u}:${v}`); tunE.add(`${v}:${u}`); }
      if (brg) { brgE.add(`${u}:${v}`); brgE.add(`${v}:${u}`); }
    }
    // 結構 way 的頭尾幾何節點 = 出入口(portal):真實匝道/洞口只接在結構兩端,
    // way 中間節點若被兵線側切上/下橋 = 「從側邊出入」(規則禁止,見 laneStructEntryAudit)。
    if (tun || brg) {
      const g0 = w.geometry[0], gN = w.geometry[w.geometry.length - 1];
      portalN.add(nid(g0.lat, g0.lon));
      portalN.add(nid(gN.lat, gN.lon));
    }
  }
  return { X, Z, LA, LN, adj, n: X.length, tunE, brgE, portalN };
}

class MinHeap {
  constructor(cap) { this.k = new Float64Array(cap); this.v = new Int32Array(cap); this.n = 0; }
  push(k, v) {
    if (this.n === this.k.length) { const K = new Float64Array(this.n * 2), V = new Int32Array(this.n * 2); K.set(this.k); V.set(this.v); this.k = K; this.v = V; }
    let i = this.n++;
    this.k[i] = k; this.v[i] = v;
    while (i > 0) { const p = (i - 1) >> 1; if (this.k[p] <= this.k[i]) break; this._sw(p, i); i = p; }
  }
  pop() {
    const rk = this.k[0], rv = this.v[0];
    this.n--;
    if (this.n) {
      this.k[0] = this.k[this.n]; this.v[0] = this.v[this.n];
      let i = 0;
      for (;;) {
        const l = 2 * i + 1, r = l + 1;
        let s = i;
        if (l < this.n && this.k[l] < this.k[s]) s = l;
        if (r < this.n && this.k[r] < this.k[s]) s = r;
        if (s === i) break;
        this._sw(s, i); i = s;
      }
    }
    return [rk, rv];
  }
  _sw(a, b) { const k = this.k[a], v = this.v[a]; this.k[a] = this.k[b]; this.v[a] = this.v[b]; this.k[b] = k; this.v[b] = v; }
}

// 已被前一條兵線用掉的邊:重罰而非硬禁。
// 硬禁(邊不相交)會逼第三條繞路超過 2.2× 上限而全滅;重罰讓它「盡量不重用」,
// 真正的硬門檻交給重合率(那才是規則本身)。
const REUSE_PEN = 8;

/** Dijkstra;used = Set of (u*n+v) 已用邊;wMul(u,v) 側翼偏好乘數 */
function dijkstra(g, src, dst, used, wMul) {
  const { adj, n } = g;
  const dist = new Float64Array(n).fill(Infinity);
  const prev = new Int32Array(n).fill(-1);
  const done = new Uint8Array(n);
  dist[src] = 0;
  const h = new MinHeap(1024);
  h.push(0, src);
  while (h.n) {
    const [d, u] = h.pop();
    if (done[u]) continue;
    done[u] = 1;
    if (u === dst) break;
    const a = adj[u];
    for (let i = 0; i < a.length; i += 2) {
      const v = a[i];
      if (done[v]) continue;
      let w = a[i + 1] * (wMul ? wMul(u, v) : 1);
      if (used.has(u * n + v)) w *= REUSE_PEN;
      const nd = d + w;
      if (nd < dist[v]) { dist[v] = nd; prev[v] = u; h.push(nd, v); }
    }
  }
  if (!done[dst]) return null;
  const path = [dst];
  while (path[0] !== src) { const p = prev[path[0]]; if (p < 0) return null; path.unshift(p); }
  return path;
}

const pathLen = (g, p) => { let s = 0; for (let i = 1; i < p.length; i++) s += Math.hypot(g.X[p[i]] - g.X[p[i - 1]], g.Z[p[i]] - g.Z[p[i - 1]]); return s; };
const banPath = (b, p, n) => { for (let i = 1; i < p.length; i++) { b.add(p[i - 1] * n + p[i]); b.add(p[i] * n + p[i - 1]); } };

/** Douglas-Peucker;回傳「保留下來的位置索引」(端點恆保留 ⇒ 兵線端點精確落在主堡) */
function simplifyIdx(pts, tol) {
  const keep = new Uint8Array(pts.length);
  keep[0] = keep[pts.length - 1] = 1;
  if (pts.length >= 3) {
    const st = [[0, pts.length - 1]];
    while (st.length) {
      const [i, j] = st.pop();
      if (j <= i + 1) continue;
      const [x1, y1] = pts[i], [x2, y2] = pts[j];
      const dx = x2 - x1, dy = y2 - y1, L2 = dx * dx + dy * dy || 1;
      let bi = -1, bd = tol;
      for (let k = i + 1; k < j; k++) {
        const [x, y] = pts[k];
        const t = Math.max(0, Math.min(1, ((x - x1) * dx + (y - y1) * dy) / L2));
        const d = Math.hypot(x - (x1 + t * dx), y - (y1 + t * dy));
        if (d > bd) { bd = d; bi = k; }
      }
      if (bi < 0) continue;
      keep[bi] = 1; st.push([i, bi], [bi, j]);
    }
  }
  const outIdx = [];
  for (let i = 0; i < pts.length; i++) if (keep[i]) outIdx.push(i);
  return outIdx;
}

// ---- 規則 #5 輸入:完整節點路徑上的 tunnel 邊 → 簡化兵線(遊戲公尺)上的弧長區間 ----
// 兵線頂點經 Douglas-Peucker 簡化過,隧道端點未必留在頂點上 ⇒ 投影取弧長。
// 相鄰段 ≤ SPAN_GAP 縫成同一座洞(雙孔/分段 way);同 tools/audit_lane_grade_sep.mjs。
const SPAN_GAP = 36;
function tunSpansOf(g, full, gpts, cc) {
  const cum = [0];
  for (let i = 1; i < gpts.length; i++) cum.push(cum[i - 1] + Math.hypot(gpts[i][0] - gpts[i - 1][0], gpts[i][1] - gpts[i - 1][1]));
  const arcOf = (i) => {
    const [px, py] = llToGame(g.LA[i], g.LN[i], cc);
    let best = Infinity, bs = 0;
    for (let k = 1; k < gpts.length; k++) {
      const [ax, ay] = gpts[k - 1], [bx, by] = gpts[k];
      const ex = bx - ax, ey = by - ay, L2 = ex * ex + ey * ey || 1;
      let t = ((px - ax) * ex + (py - ay) * ey) / L2;
      t = t < 0 ? 0 : t > 1 ? 1 : t;
      const d = Math.hypot(px - (ax + ex * t), py - (ay + ey * t));
      if (d < best) { best = d; bs = cum[k - 1] + t * Math.hypot(ex, ey); }
    }
    return bs;
  };
  const raw = [];
  let cur = null;
  for (let i = 1; i < full.length; i++) {
    if (g.tunE.has(`${full[i - 1]}:${full[i]}`)) {
      const sa = arcOf(full[i - 1]), sb = arcOf(full[i]);
      const lo = Math.min(sa, sb), hi = Math.max(sa, sb);
      if (!cur) cur = [lo, hi];
      else { cur[0] = Math.min(cur[0], lo); cur[1] = Math.max(cur[1], hi); }
    } else if (cur) { raw.push(cur); cur = null; }
  }
  if (cur) raw.push(cur);
  const out = [];
  for (const s of raw.sort((p, q) => p[0] - q[0])) {
    const last = out[out.length - 1];
    if (last && s[0] - last[1] <= SPAN_GAP) last[1] = Math.max(last[1], s[1]);
    else out.push([...s]);
  }
  return out;
}

function overlapXZ(a, b, cell) {
  const gridOf = (lane) => {
    const s = new Set();
    for (let i = 1; i < lane.length; i++) {
      const [x1, z1] = lane[i - 1], [x2, z2] = lane[i];
      const n = Math.max(1, Math.ceil(Math.hypot(x2 - x1, z2 - z1) / (cell / 2)));
      for (let k = 0; k <= n; k++) s.add(`${Math.round((x1 + (x2 - x1) * k / n) / cell)},${Math.round((z1 + (z2 - z1) * k / n) / cell)}`);
    }
    return s;
  };
  const ga = gridOf(a), gb = gridOf(b);
  if (!ga.size || !gb.size) return 1;
  let sh = 0;
  for (const c of ga) if (gb.has(c)) sh++;
  return sh / Math.min(ga.size, gb.size);
}

// 側移目標檔位:與 mapSelect 的 OFFSET_FRACS 同一組(近→遠)
const OFFSET_FRACS = [MAPGEO.LANE_OFFSET_FRAC, 0.45, 0.62];

// 指定場地限定方位角扇區(度,[起, 迄] 順時針含跨 0°;**逐錨點**一份扇區清單):
// 兵線軸向必須對準特定地標才有測試意義(如 jinlong:兩錨沿隧道軸對向,兵線才會穿
// 金龍隧道山體;全向暴搜會挑分數更高的街廓方位,兵線就繞開隧道了)。未列場地 = 全向。
// 這些場地是「兵線要踩上高架橋」的測試場地 ⇒ 選線時先比「踩在橋上的長度」,再走原本的排序。
// 一般場地不受影響(集合外的 id 完全走舊路徑)。
// 2026-08-04:`civicblvd` 從 PREFER_TUNNEL 改列這裡(市民大道要的是它自己的高架道路,
// 不是那群挖不出來的圖資地下道 —— 見 ANCHORS 的註解)。
const PREFER_BRIDGE = new Set(['parkave', 'london', 'berlin', 'chicago', 'civicblvd']);
// 同理:「兵線要走進地下道」的測試場地 ⇒ 先比「踩在 tunnel way 上的長度」。
// **踩的是 `strucTunnel` 認可的那種 tunnel way**(見檔頭 import):`indoor` 通道不算,
// 引擎會把它攤平成一般小路,選線期把它當隧道加分就是「號稱走地下道、開圖是平街」。
// 註:圖資上是隧道 ≠ 執行期挖得出來 —— `underpassPlan` 會因「引道空間不足 / 太深 / 碰水」
// 放棄(civicblvd 的 60m service 就是這樣落空的)。這個集合只是選線偏好,成不成立一律
// 以 `audit_lane_scenarios` 的實測為準。
const PREFER_TUNNEL = new Set(['taroko', 'madrid', 'roppongi']);
const BEARING_SECTORS = {
  // 三張新橋樑場地都要「兵線橫過那道障礙(河/調車場)」⇒ 方位角夾在橋軸上,
  // 否則暴搜會挑同一岸的街廓(分數更高、也不必過橋)。逐錨點一份扇區,兩錨對向。
  london: [[[60, 120]], [[240, 300]]],     // 西橋頭 → 東岸 / 東橋頭 → 西岸(Westminster Bridge 東西向)
  // madrid 兩錨都夾往東(Joaquín Costa / María de Molina 都是東西向,目標地下道在錨點東側)。
  // 不夾的話 L2 會沿卡斯提亞大道往北,把後塔擺進一條 service 隧道深處 273m —— 規則 #5 直接紅字
  // (2026-08-02 首輪實測)。夾了以後 L2/L3 多半湊不出真實道路解 ⇒ 退回 synthLane,那正是想要的:
  // 這張圖的用途是 **1v1 兵線走地下道**,不是三線市區圖。
  // 逐錨點一份扇區(索引對齊 ANCHORS):①María de Molina 西錨往東 ②同街東錨往西
  // ③Joaquín Costa(2026-08-04 新增的第三錨,212m 覆蓋段)也是東西向,兩向都放行 ——
  // 這一錨沒有「目標在哪一側」的先驗,夾單向等於先賭一半。
  madrid: [[[60, 120]], [[240, 300]], [[60, 120], [240, 300]]],
  berlin: [[[340, 40]], [[160, 220]]],     // 南錨 → 北 / 北錨 → 南(華沙大街南北向)
  chicago: [[[330, 30]], [[150, 210]]],    // 南岸 → 北 / 北岸 → 南(芝加哥河主河道東西向)
  jinlong: [[[30, 80]], [[210, 260]]],   // 西南錨(金龍路)→東北;東北錨(金湖路)→西南(隧道軸 ~56°)
  // taroko 兩錨都夾往西:東側是 656m 的靳珩隧道,PREFER_TUNNEL 不夾會整條兵線鑽進長隧道
  // (洞內塔違規 ×3、明隧道只沾 36m);往西才是三段「幾乎整條明隧道」的短洞群
  taroko: [[[235, 300]], [[235, 300]]],
  // parkave 不夾方位角:改由 PREFER_BRIDGE 的「踩在橋上長度」自己挑(夾了反而把能上橋的
  // 方位角排除掉 —— 實測夾 195~235° 時兵線只擦過高架 4m,沒真的走上去)。
  // civicblvd 夾在市民大道高架的軸上(東西向):西錨往東 / 東錨往西。
  // 不夾的話暴搜會挑南北向的街廓(市區格柵的戰術評分更高、也不必上高架)——
  // 舊制正是這樣把 L1 兵線整條拉到錨點以北 280~620m,場景 0 種。
  civicblvd: [[[60, 120]], [[240, 300]]],
  // roppongi **刻意不夾**:這一帶三條候選地下道的軸向不一(乃木坂東西向、環状三号線
  // 南北向),夾錯就是把唯一走得通的方位排除掉(parkave 的前例)。交給 PREFER_TUNNEL 挑。
};
const inSector = (br, [a, b]) => ((br - a + 360) % 360) <= ((b - a + 360) % 360);
/** 詞典序比較(錨點挑選用):第一個不同的欄位決勝,全同 = 不換(同分取先列者) */
const lexGT = (a, b) => { for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return a[i] > b[i]; return false; };

function tryBearing(g, aIdx, bearing, L, offFrac, mapA = false) {
  const realD = realDistFor(L, mapA);
  const { X, Z, n } = g;
  const ax = X[aIdx], az = Z[aIdx];
  const bx0 = ax + Math.sin(bearing * d2r) * realD, bz0 = az + Math.cos(bearing * d2r) * realD;
  const minAB = realD * MAPGEO.MIN_DIST_FRAC / MAPGEO.BASE_DIST_FRAC;   // ⇒ distM ≥ diagM×0.80
  let bIdx = -1, best = Infinity;
  for (let i = 0; i < n; i++) {
    const ab = Math.hypot(X[i] - ax, Z[i] - az);
    if (ab < minAB || ab > realD * 1.15) continue;
    const off = Math.hypot(X[i] - bx0, Z[i] - bz0);
    if (off < best) { best = off; bIdx = i; }
  }
  if (bIdx < 0) return { fail: 'noB' };

  const straight = Math.hypot(X[bIdx] - ax, Z[bIdx] - az);
  const vx = (X[bIdx] - ax) / straight, vz = (Z[bIdx] - az) / straight;
  const px = -vz, pz = vx;                                    // 垂直單位向量
  const lat = (i) => (X[i] - ax) * px + (Z[i] - az) * pz;     // 側向位移(正 = 左)
  const prog = (i) => ((X[i] - ax) * vx + (Z[i] - az) * vz) / straight;   // 沿 A→B 的進度 0..1
  // 側翼:不只是「別走錯邊」,而是主動朝目標側移弧線靠攏 —— 與 synthLane 的主脊同形
  // (sin 拱形:兩端歸零、中段最寬 LANE_OFFSET_FRAC×D)。
  // 只罰錯邊的舊寫法會讓路徑貼著中線走,重合率因此壓不下來。
  const STEER_W = 2.4;
  const sideW = (s, offFrac) => (u, v) => {
    const m = (lat(u) + lat(v)) / 2;
    const t = Math.max(0, Math.min(1, (prog(u) + prog(v)) / 2));
    const want = s * offFrac * straight * Math.sin(Math.PI * t);
    return 1 + STEER_W * Math.abs(m - want) / straight;
  };

  const used = new Set();
  let why = null;
  const take = (wMul) => {
    const p = dijkstra(g, aIdx, bIdx, used, wMul);
    if (!p) { why = 'noPath'; return null; }
    if (pathLen(g, p) / straight > 2.2) { why = 'detour'; return null; }   // 繞路閘門(同 mapSelect)
    // 折返閘門(同 mapSelect / MAPGEO.MAX_BACKTRACK):prog 已正規化為 A→B 進度,
    // 累加進度倒退段 = 往主堡折返比例;超標淘汰(側翼 via 導引偶會把路徑吸回起點)
    let back = 0, pr = prog(p[0]);
    for (let k = 1; k < p.length; k++) { const pg = prog(p[k]); if (pg < pr) back += pr - pg; pr = pg; }
    if (back > MAPGEO.MAX_BACKTRACK) { why = 'backtrack'; return null; }
    // 規則(2026-07-28):橋/隧只能從出入口(結構 way 端點 portalN)進出,不可從側邊上/下橋。
    // struc 對齊節點路徑 p:段 k 連 p[k−1]→p[k];portal = p[i] 是否為結構端點(見 laneStructEntryAudit)。
    const struc = new Array(p.length);
    struc[0] = false;
    for (let k = 1; k < p.length; k++) struc[k] = g.tunE.has(`${p[k - 1]}:${p[k]}`) || g.brgE.has(`${p[k - 1]}:${p[k]}`);
    if (!laneStructEntryAudit(struc, p.map((nd) => g.portalN.has(nd))).ok) { why = 'sideEntry'; return null; }
    const all = p.map((i) => [X[i], Z[i]]);
    const keep = simplifyIdx(all, 3);
    const idx = keep.map((k) => p[k]);                        // 簡化後仍全是 OSM 道路節點
    const xz = keep.map((k) => all[k]);
    // 規則(2026-07-28):兵線不可接近 180° 迴轉(側翼 via / REUSE 重罰偶會逼出上橋再折回式掉頭)。
    // xz 是真實公尺(buildGraph 用地球半徑),laneUTurnAudit 的 SEG_M 取樣與 laneTacticsXZ 同在
    // 遊戲公尺語意下 ⇒ 換算後再判(× 1/REAL_SCALE;此處在 s 宣告前被呼叫,不能用 s,直接取 MAPGEO)。
    const gs = 1 / MAPGEO.REAL_SCALE;
    const gxz = xz.map(([x, z]) => [x * gs, z * gs]);
    if (!laneUTurnAudit(gxz).ok) { why = 'uturn'; return null; }
    // 規則③(2026-07-29):相對 A→B 主軸的帶號偏航累積 MUST 落在 ±TURN_ACCUM_MAX_DEG 內
    // (順逆時針抵消;背對主軸走/繞圈在此淘汰)。與迴轉閘同一組遊戲公尺取樣語彙。
    if (!laneTurnAccumAudit(gxz).ok) { why = 'turnAccum'; return null; }
    banPath(used, p, n);                                      // 過閘後才標記已用邊(下一條被 REUSE_PEN 重罰)
    let s = 0;
    for (const q of idx) s += lat(q);
    return { xz, idx, full: p, lat: s / idx.length };   // full = 未簡化節點路徑(規則 #5 取隧道邊用)
  };

  const lanes = [];
  if (L === 1 || L === 3) { const m = take(null); if (!m) return { fail: why }; lanes.push(m); }
  if (L > 1) for (const s of [1, -1]) { const f = take(sideW(s, offFrac)); if (!f) return { fail: why }; lanes.push(f); }
  lanes.sort((p, q) => q.lat - p.lat);                        // [上, 中, 下]

  const cell = overlapCellM(L, mapA);
  let mo = 0;
  for (let i = 0; i < lanes.length; i++)
    for (let j = i + 1; j < lanes.length; j++) mo = Math.max(mo, overlapXZ(lanes[i].xz, lanes[j].xz, cell));
  if (mo > MAPGEO.MAX_OVERLAP) return { fail: 'overlap', ov: mo };

  const s = 1 / MAPGEO.REAL_SCALE;
  // 兵線互不接觸/交叉硬門檻(全禁,含立體交叉;與 mapSelect / server / audit_lane_sep 同一支)。
  // MUST 判「寫出後」的幾何:六位小數捨入 lat/lng → llToGame(origin = 捨入後 bases[0],
  // 與 audit_lane_sep 逐式相同)。圖平面座標(未捨入)在扇出帶的公分級貼近會與寫出幾何
  // 不同判 —— 捨入讓兩線換邊變成交叉(2026-07-29 barcelona L3 實案:bake 閘綠、離線稽核紅
  // → runner 拒絕提交)。判寫出幾何 = 兩端永遠同判(原則 3)。
  const wr6 = (i) => [r6(g.LA[i]), r6(g.LN[i])];
  const oW = wr6(aIdx);
  const lanesWritten = lanes.map((l) => l.idx.map((i) => {
    const [la, ln] = wr6(i);
    return llToGame(la, ln, { lat: oW[0], lng: oW[1] });
  }));
  if (!laneSeparationAudit(lanesWritten).ok) return { fail: 'touch' };
  let sinu = 0, tpk = 0;
  for (const l of lanes) { const t = laneTacticsXZ(l.xz.map(([x, z]) => [x * s, z * s])); sinu += t.sinuosity; tpk += t.turnsPerKm; }
  sinu /= L; tpk /= L;
  // 砲塔規則合規(規則 #4):跑與 runtime 同一換算的 towerLayoutAudit ⇒ 選址時就偏好「砲塔佈局合規」的方位
  const A = [g.LA[aIdx], g.LN[aIdx]], B = [g.LA[bIdx], g.LN[bIdx]];
  const cc = { lat: (A[0] + B[0]) / 2, lng: (A[1] + B[1]) / 2 };
  const lanesGame = lanes.map((l) => l.idx.map((i) => llToGame(g.LA[i], g.LN[i], cc)));
  // 砲塔洞口規則(規則 #5):兵線穿隧道時,埋在洞內的砲塔 MUST 有 ≥TOWER_TUNNEL_OUT_F 射程涵蓋洞口外。
  // 隧道段取圖資 tunnel way 全長(上界;執行期只有地形蓋得住的段落才成洞)⇒ 選線期寧可保守。
  const spans = lanes.map((l, li) => tunSpansOf(g, l.full, lanesGame[li], cc));
  // 兩條規則逐型態各驗一次再加總(見 venues.js venueLaneModes):完整戰場恆為單一型態 ⇒ 逐位元同舊制。
  let resid = 0, tunBad = 0;
  for (const m of venueLaneModes(mapA)) {
    const ta = towerLayoutAudit(lanesGame, m);
    resid += ta.residual + (ta.stackBad ? 1000 : 0);   // 疊塔視為重罰(絕不選)
    tunBad += towerTunnelAudit(lanesGame, spans, m).bad.length;
  }
  // 兵線實際踩在橋樑邊上的長度(遊戲公尺):PREFER_BRIDGE 場地用它當首要偏好 ——
  // 「純陸域高架橋」的測試場地要的就是兵線真的走在橋面上,一般的戰術評分不會特意去挑高架。
  let brgLen = 0, tunLen = 0;
  for (const l of lanes) {
    for (let i = 1; i < l.full.length; i++) {
      const u = l.full[i - 1], v = l.full[i];
      const seg = Math.hypot(g.X[u] - g.X[v], g.Z[u] - g.Z[v]) * s;
      if (g.brgE?.has(`${u}:${v}`)) brgLen += seg;
      if (g.tunE?.has(`${u}:${v}`)) tunLen += seg;
    }
  }
  return {
    bearing, aIdx, bIdx, lanes, brgLen, tunLen,
    maxOverlap: mo, sinuosity: sinu, turnsPerKm: tpk,
    resid,      // 規則 #4 殘餘(逐型態加總)
    tunBad,     // 規則 #5 違規塔數(逐型態加總;0 = 合規)
    score: tacticalScore(sinu, tpk, mo),
  };
}

// ---- 主流程 ----
const out = {}, report = [];
const maxRealD = realDistFor(3);
// 表的鍵(順序即寫檔順序;唯一縫在 venues.js):完整戰場 1~3 條兵線 + 縮小尺度的單兵線。
const KEYS = VENUE_LANE_KEYS.map((k) => k.key);
for (const [id, anchors] of Object.entries(ANCHORS)) {
  let picked = null;
  for (const anchor of anchors) {
    log(`${id} @ [${anchor}] …`);
    // 半徑要留給側翼外凸的空間(B 已在 1.15×realD;繞路上限 2.2×)
    const RAD = maxRealD * 2.4;
    const ways = await overpassRoads(`${id}_${anchor.map((v) => v.toFixed(4)).join('_')}_r${Math.round(RAD)}`, anchor[0], anchor[1], RAD);
    if (!ways || ways.length < 20) { log(`  ways=${ways ? ways.length : 'ERR'} → skip`); continue; }
    const g = buildGraph(ways, anchor);
    log(`  ways=${ways.length} nodes=${g.n}`);
    // 錨點 → 最近道路節點(120m 內)
    let aIdx = -1, ad = 120;
    for (let i = 0; i < g.n; i++) { const d = Math.hypot(g.X[i], g.Z[i]); if (d < ad) { ad = d; aIdx = i; } }
    if (aIdx < 0) { log('  錨點 120m 內無道路節點 → skip'); continue; }

    const byL = {};
    // 逐「尺度 × 兵線數」各烤一份:完整戰場 L1~L3,縮小尺度(迷你 / 劇情戰役,兩者
    // mapScaleF 相同)只有單兵線 —— 兩種型態都恆為 1 條線(laneCountFor / MINI.TEAM_MAX)。
    for (const { key, L, mapA } of VENUE_LANE_KEYS) {
      let best = null;
      const why = {};
      let bestOv = 9;
      // 方位角每 5° × 三檔側移目標:離線暴搜,不放過任何一組能全線走真實道路的解
      const sectors = BEARING_SECTORS[id]?.[anchors.indexOf(anchor)];
      for (let i = 0; i < 72; i++) {
        if (sectors && !sectors.some((s) => inSector(i * 5, s))) continue;
        for (const off of OFFSET_FRACS) {
          const r = tryBearing(g, aIdx, i * 5, L, off, mapA);
          if (r?.fail) { why[r.fail] = (why[r.fail] || 0) + 1; if (r.ov != null) bestOv = Math.min(bestOv, r.ov); continue; }
          // 詞典序:先「規則 #5 洞內砲塔違規少」(塔埋在山體裡只能沿洞內走廊對射 = 功能性缺陷,
          // 比 #4 的重疊殘餘嚴重)、再「規則 #4 殘餘少」、同分才取戰術評分高。
          // 兩者皆是**偏好非硬門檻**:全方位皆不合規時仍取最小者(不放棄該 L,行為等同舊版最佳努力)。
          // 無隧道的場地 tunBad 恆 0 ⇒ 排序退化為舊版,選線結果不動。
          if (r && PREFER_TUNNEL.has(id)
            && (!best || r.tunLen > best.tunLen + 1
              || (Math.abs(r.tunLen - best.tunLen) <= 1 && (r.tunBad < best.tunBad
                || (r.tunBad === best.tunBad && (r.resid < best.resid
                  || (r.resid === best.resid && r.score > best.score))))))) { best = r; continue; }
          if (r && PREFER_BRIDGE.has(id)
            && (!best || r.brgLen > best.brgLen + 1
              || (Math.abs(r.brgLen - best.brgLen) <= 1 && (r.tunBad < best.tunBad
                || (r.tunBad === best.tunBad && (r.resid < best.resid
                  || (r.resid === best.resid && r.score > best.score))))))) { best = r; continue; }
          if (r && !PREFER_BRIDGE.has(id) && !PREFER_TUNNEL.has(id) && (!best || r.tunBad < best.tunBad
            || (r.tunBad === best.tunBad && (r.resid < best.resid
              || (r.resid === best.resid && r.score > best.score))))) best = r;
          // ↑ 一般場地的排序(規則 #5 → 規則 #4 → 戰術評分)不動
        }
      }
      if (!best) {
        // 逐鍵獨立:這個尺度湊不出真實道路兵線 → venueConfig 對它降級(完整版路線剪短 / synthLane)
        log(`  ${key} ✗ 無可行方位角 reasons=${JSON.stringify(why)}${bestOv < 9 ? ` bestOv=${bestOv.toFixed(3)}` : ''}`);
        continue;
      }
      byL[key] = { g, ...best };
      log(`  ${key} ✓ br=${best.bearing}° ov=${best.maxOverlap.toFixed(3)} sinu=${best.sinuosity.toFixed(2)} resid=${best.resid}` +
        (best.tunBad ? ` ⚠️洞內塔違規=${best.tunBad}` : ''));
    }
    const hits = Object.keys(byL).length;
    if (!hits) continue;
    // 取錨點:先「規則 #4/#5 合規的鍵數」最多,再「真實道路可用鍵數」最多;同分取先列者。
    // **完整戰場的鍵排在縮小尺度之前**(2026-08-14 加入 m1 時追加):比較序寫成
    // [完整合規數, 完整可用數, 全部合規數, 全部可用數]。多錨點的場地(tamsui / madrid /
    // roppongi …)本來就是靠這個計數挑錨,把新鍵併進同一個計數 = 「另一個錨點的**迷你**
    // 路線比較好」就足以換掉那張圖已經定案的 L1~L3(連同 `scen` 場景實測標記整份過期)。
    // 分層之後新增鍵只能當同分時的決勝,既有尺度的選擇一格不動。
    const cnt = (ks) => {
      const es = ks.map((k) => byL[k]).filter(Boolean);
      return [es.filter((b) => b.resid === 0 && b.tunBad === 0).length, es.length];
    };
    const rank = [...cnt(KEYS.filter((k) => typeof k === 'number')), ...cnt(KEYS)];
    if (!picked || lexGT(rank, picked.rank)) picked = { anchor, byL, ways: ways.length, g, conf: rank[2], rank };
    if (hits === KEYS.length && rank[2] === KEYS.length) break;   // 完美(全鍵真實道路且全合規)才提前收手
  }
  if (!picked) { report.push(`${id}: ❌ 全尺度皆無真實道路解 → 一律 synthLane`); log(`${id}: ❌`); continue; }
  out[id] = picked;
  const mark = (K) => (picked.byL[K] ? `${K} ov=${picked.byL[K].maxOverlap.toFixed(2)}` : `${K} synth`);
  const full = Object.keys(picked.byL).length === KEYS.length;
  report.push(`${id}: ${full ? '✅' : '◐'} A=[${picked.anchor.map((v) => v.toFixed(5))}] ${KEYS.map(mark).join(' | ')}`);
  log(`${id}: ${full ? '✅' : '◐'}`);
}

// 指定場地只准在**全部**取得新路網並至少選出一組路線後寫檔。
// 外部服務失敗時若仍重寫，`keep` 會把該場地當成已重烤而移除舊表，
// 下一局才靜默退回 synthLane，等同把原本有效的 baked route 刪掉。
const missing = ONLY.filter((id) => !out[id]);
if (missing.length) {
  log(`\n❌ 指定場地未取得可用路線，拒絕重寫 venueLanes.js：${missing.join(', ')}`);
  process.exit(1);
}

log('\n---- 報告 ----');
for (const r of report) log(r);
log(`\n成功 ${Object.keys(out).length} / ${Object.keys(ANCHORS).length}`);

let js = `// ============ 預設場地兵線(離線預算,勿手改)============
// 由 tools/bake_venue_lanes.mjs 產生:Overpass 真實道路路網 → 邊不相交最短路徑。
// 每條兵線的每個頂點都是 OSM 道路節點 ⇒ NPC 引導路線 100% 與現實導航路線相符。
// 通過的規則(與互動式選址流程相同):兩堡距離 ≥ 對角線 ${MAPGEO.MIN_DIST_FRAC * 100}%、
// 任兩線重合率 ≤ ${MAPGEO.MAX_OVERLAP}(判定網格 overlapCellM(L))、單線繞路 ≤ 2.2×直線距離、
// 任兩線互不接觸/交叉(排除主堡扇出段,中段最近距離 ≥ ${MAPGEO.LANE_MIN_SEP_M} 遊戲公尺,含立體交叉亦禁)。
// bases[0] = SWARM(錨點側)、bases[1] = STEEL;lanes 依側向排序 [上, 中, 下]。
// 鍵(見 venues.js \`venueLaneKey\`):1/2/3 = 完整戰場的兵線數;
// m1 = 縮小尺度(迷你地圖 / 劇情戰役,兩堡距離 ×${(realDistFor(1, true) / realDistFor(1)).toFixed(1)})的單兵線 ——
// 那是**另外挑過的一條路線**,不是完整版剪短的中段:同一張圖在兩種距離下,
// 路網上走得通又排得出合規砲塔的路徑不同,且 m1 的砲塔規則是拿迷你 + 劇情兩側一起驗的。
export const VENUE_LANES = {\n`;
// ONLY= 只烤指定場地時,**其餘場地的既有兵線 MUST 原樣保留** —— 這支一律重寫整份
// venueLanes.js,少了這段就會把沒烤到的場地整批清空(2026-07-28 實測:ONLY=parkave
// 之後其餘 22 個場地全數退回 synthLane 合成弧,場景掃描結果整個變樣)。
const keep = ONLY.length ? Object.entries(VENUE_LANES).filter(([id]) => !(id in ANCHORS)) : [];
for (const [id, byL] of keep) {
  js += `  ${id}: {\n`;
  for (const K of KEYS) {
    const e = byL[K];
    if (!e) continue;
    js += `    ${K}: { bearing: ${e.bearing}, maxOverlap: ${e.maxOverlap},\n`;
    js += `      bases: [[${e.bases[0][0]},${e.bases[0][1]}],[${e.bases[1][0]},${e.bases[1][1]}]],\n`;
    js += `      lanes: [\n        ${e.lanes.map((l) => `[${l.map((p) => `[${p[0]},${p[1]}]`).join(',')}]`).join(',\n        ')}\n      ] },\n`;
  }
  js += `  },\n`;
}
for (const [id, v] of Object.entries(out)) {
  js += `  ${id}: {\n`;
  for (const K of KEYS) {
    const b = v.byL[K];
    if (!b) continue;                     // 該鍵無真實道路解 → venues.js 對它降級(見 venueConfig)
    const g = v.g;
    const A = [g.LA[b.aIdx], g.LN[b.aIdx]], B = [g.LA[b.bIdx], g.LN[b.bIdx]];
    const lanesLL = b.lanes.map((l) => l.idx.map((i) => [r6(g.LA[i]), r6(g.LN[i])]));
    js += `    ${K}: { bearing: ${b.bearing}, maxOverlap: ${+b.maxOverlap.toFixed(3)},\n`;
    js += `      bases: [[${r6(A[0])},${r6(A[1])}],[${r6(B[0])},${r6(B[1])}]],\n`;
    js += `      lanes: [\n        ${lanesLL.map((l) => `[${l.map((p) => `[${p[0]},${p[1]}]`).join(',')}]`).join(',\n        ')}\n      ] },\n`;
  }
  js += `  },\n`;
}
js += '};\n';
const dest = new URL('../public/js/venueLanes.js', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
writeFileSync(dest, js, 'utf8');
log('\nwrote', dest, (js.length / 1024).toFixed(1) + ' KB');
