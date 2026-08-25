// ============ 路網中繼:payload 的形狀、上限與封裝(唯一定義)============
// 【它解的是什麼】今天每個客戶端各自向 Overpass 抓圖資(`startPrebuild` 是每台各跑一次的),
// A 抓到而 B 恰被限流 ⇒ 兩台在建**不同的世界**:橋、隧道、明隧道、地下道、建物、碰撞柱、
// 街廓朝向全不一樣,而且沒有任何錯誤訊息 —— `main.js scheduleOsmRetry` 那 90 秒重試就是
// 在跟它搏鬥。中繼之後:房主抓一次 → 伺服器轉給全房 ⇒ 整房逐位元同一份路網,
// Overpass 的負擔也從「每人一次」變成「每房一次」。
//
// 【為什麼形狀的定義要獨立成一支】同一把尺兩端都要用:
//   ・房主送出前先過一次(夾上限、砍畸形欄位),而且**自己吃的就是送出去的那一份** ——
//     兩邊從不同的資料建圖,中繼就白做了;
//   ・伺服器收到後再過一次。房主是**不可信輸入**(§7.4-3):形狀與筆數要驗,否則惡意房主
//     能讓每個入房者吃下任意大的陣列;而且這一趟會產生**全新的物件**當房間副本 ——
//     單機模式的 RoomHub 跑在同一個分頁裡,直接存 `m.roads` 會與客戶端**共用參照**,
//     而下游(`mergeGradeChains` / `way._tun` / `buildRails`)是就地變異那些物件的。
//   ⇒ 本檔的 `sanitizeOsmRelay` MUST 冪等:同一份資料跑兩次逐位元相同。
//
// 【座標刻意不降精度】`DP = 7` = OSM 節點的原生精度(1e-7° ≈ 1.1cm)⇒ 對**真實圖資**這一步
// 是恆等變換,房主的建圖結果與沒有中繼的今天逐位元相同,只有畸形/惡意輸入才會被動到。
// 降到 6 位可以把 payload 砍半,但那會讓「開了中繼」與「中繼逾時退回自己抓」建出兩張
// 略微不同的地圖 —— 用不著:實測最大 payload(barcelona 5v5 原始 JSON 783KB + 建物/鐵路)
// 仍在 `server.js maxPayload` 2MiB 之內,再加上下面的 `osmRelayFit` 兜底。
//
// 【MUST NOT 有任何模組級可變狀態】單機模式下 `rooms.js` 與 `main.js` import 到的是**同一個**
// 模組實例(URL 佈局鏡射儲存庫佈局,A28)—— 在這裡放一份 store 就等於伺服器與客戶端共用它。
// 中繼資料的 store 住 `biomes.js`(`commitOsmIn`/`osmInOf`),那一支 `rooms.js` 永遠不會 import。
// 本檔因此**零 import**(與 `ctrlmode.js` / `rng.js` 同紀律),Node 與瀏覽器都載得起來。
//
// 【θ 不在這裡】地圖主方位 `center.rot` 隨 `battleConfig` 在開房當下定案並凍結(A42 ③)。
// 中繼 payload MUST NOT 帶任何座標框資訊:路網可以從無到有(房主重試成功),座標框不行 ——
// 選角途中把整房的世界轉一次,比抓不到圖資嚴重得多。

export const OSM_RELAY = {
  // 入房者等中繼的上限。健康的 Overpass 鏡像實測 1.5~10s(見 biomes.js OVERPASS_TRY 檔頭),
  // 20s 蓋得住「房主先踩到一個壞鏡像再輪到好的」;再等下去房主多半是整組失敗,
  // 這時入房者退回自己抓才是對的 —— 它很可能 geocache 直接命中(零網路、瞬間)。
  // 等待與地形建構**並行**(main.js osmGate),所以這段時間絕大多數是免費的。
  WAIT_MS: 20000,
  DP: 7,                 // 座標小數位 = OSM 原生精度(見檔頭);MUST NOT 為了 payload 調小
  MAX_BYTES: 1800000,    // 單則訊息位元組上限(server.js maxPayload 2MiB 留餘裕;超過 ws 會以 1009 直接斷線)
  MAX_ROAD: 2400,        // 道路 way(查詢額度上限 600 + 1600,留裕度)
  MAX_BLD: 1400,         // 建物(額度上限 1200)
  MAX_RAIL: 80,          // 鐵路 way(額度 60)
  MAX_FALL: 40,          // 瀑布(額度 20)
  MAX_XING: 60,          // 平交道(額度 40)
  MAX_POI: 80,           // 具名點位(地名 24 + 山峰 12 + 交流道 12 + 車站 12)
  MAX_ENTRANCE: 120,     // 捷運／車站入口(80 + public_transport 補查 40)
  MAX_COVER: 900,        // landuse / natural / leisure 面(線工切面 + 面標籤)
  MAX_WATERWAY: 120,     // 河川 / 溝渠線
  MAX_BOUNDARY: 500,     // 行政 relation 成員線 + 海岸線
  MAX_PTS: 4000,         // 單條 way 的節點數上限
  MAX_PTS_TOTAL: 200000, // 全部 way 的節點總預算(實測密路網 ~21000)
  MAX_TAGS: 40,          // 單一元素的 tag 數上限
  MAX_TAG_LEN: 200,      // tag 鍵/值的字元上限
};

const R = 10 ** OSM_RELAY.DP;
/** 座標正規化:非有限值一律回 null(呼叫端據此整條丟掉,MUST NOT 補 0 —— 那會把路拉到赤道) */
const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? Math.round(v * R) / R : null);

/**
 * tag 表淨化。**刻意不做白名單**:下游讀 tag 的地方散在 biomes / vernacular / worldtext,
 * 在這裡再列一份「哪些 tag 有用」就是第二份會過期的名冊 —— 漏一個的症狀是招牌變空白、
 * 隧道退回一般道路,而沒有任何錯誤訊息。這裡只管**形狀**:鍵值都是有界長度的字串。
 */
function tagsOf(t) {
  const out = {};
  if (!t || typeof t !== 'object') return out;
  let n = 0;
  for (const k of Object.keys(t)) {
    if (n >= OSM_RELAY.MAX_TAGS) break;
    const v = t[k];
    if (typeof v !== 'string' && typeof v !== 'number') continue;
    out[String(k).slice(0, OSM_RELAY.MAX_TAG_LEN)] = String(v).slice(0, OSM_RELAY.MAX_TAG_LEN);
    n++;
  }
  return out;
}

/**
 * way 幾何。超過上限一律**整條丟掉,MUST NOT 截斷** —— 截掉一半的折線不是「少一點細節」,
 * 而是那條路憑空轉向並在半路斷掉(橋台落在河中央、隧道洞口開在山裡)。
 */
function ptsOf(g, budget) {
  if (!Array.isArray(g) || g.length < 2) return null;
  if (g.length > OSM_RELAY.MAX_PTS || g.length > budget.left) return null;
  const out = [];
  for (const p of g) {
    const lat = num(p?.lat), lon = num(p?.lon ?? p?.lng);
    if (lat == null || lon == null) return null;
    out.push({ lat, lon });
  }
  budget.left -= out.length;
  return out;
}

/** 點位元素([{lat, lng, tags}];建物/瀑布/平交道/具名點位共用) */
function nodesOf(arr, cap) {
  const out = [];
  if (!Array.isArray(arr)) return out;
  for (const e of arr) {
    if (out.length >= cap) break;
    const lat = num(e?.lat), lng = num(e?.lng ?? e?.lon);
    if (lat == null || lng == null) continue;
    out.push({ lat, lng, tags: tagsOf(e.tags) });
  }
  return out;
}

/**
 * way 元素([{tags, geometry}])。`need` = 必要的 tag 鍵,鏡射 `fetchOsmRoads`/`fetchOsmFeatures`
 * 自己的過濾條件(道路要 highway、鐵路要 railway)—— 少了它下游 `ROAD_W[hw]` 查不到寬度,
 * 一條沒有 highway 的「路」會靜默地以 undefined 寬鋪出去。
 */
function waysOf(arr, cap, need, budget) {
  const out = [];
  let drop = 0;
  if (!Array.isArray(arr)) return { out, drop };
  for (const w of arr) {
    if (out.length >= cap) { drop++; continue; }
    const tags = tagsOf(w?.tags);
    if (need && typeof tags[need] !== 'string') { drop++; continue; }
    const g = ptsOf(w?.geometry, budget);
    if (!g) { drop++; continue; }
    out.push({ tags, geometry: g });
  }
  return { out, drop };
}

function bboxOf(b) {
  if (!b || typeof b !== 'object') return null;
  const minLat = num(b.minLat), minLng = num(b.minLng), maxLat = num(b.maxLat), maxLng = num(b.maxLng);
  if (minLat == null || minLng == null || maxLat == null || maxLng == null) return null;
  if (!(maxLat > minLat) || !(maxLng > minLng)) return null;
  return { minLat, minLng, maxLat, maxLng };
}

/** 中繼與快取的配對鍵:與 `geocache.geoKey` 同精度(5 位小數 ≈ 1m,同場地同隊制必同鍵) */
export function osmRelayKey(bbox) {
  const b = bboxOf(bbox);
  return b ? `${b.minLat.toFixed(5)},${b.minLng.toFixed(5)},${b.maxLat.toFixed(5)},${b.maxLng.toFixed(5)}` : null;
}

/**
 * 中繼 payload 淨化(房主送出前 / 伺服器收到後,**同一支**)。
 * 回傳 `{ bbox, feats|null, roads|null, drop }`;整份不合用回 `null`。
 * 順序是契約的一部分:道路 MUST 排在鐵路之前吃節點預算,否則兩端跑同一份資料會裁出不同結果。
 * @returns {null | { bbox: object, feats: object|null, roads: Array|null, drop: number }}
 */
export function sanitizeOsmRelay(m) {
  const bbox = bboxOf(m?.bbox);
  if (!bbox) return null;
  const budget = { left: OSM_RELAY.MAX_PTS_TOTAL };
  let drop = 0;
  const rd = waysOf(m?.roads, OSM_RELAY.MAX_ROAD, 'highway', budget);
  drop += rd.drop;
  const roads = rd.out.length ? rd.out : null;
  let feats = null;
  const f = m?.feats;
  if (f && typeof f === 'object') {
    const ra = waysOf(f.rails, OSM_RELAY.MAX_RAIL, 'railway', budget);
    const cv = waysOf(f.covers, OSM_RELAY.MAX_COVER, null, budget);
    const wa = waysOf(f.waters, OSM_RELAY.MAX_WATERWAY, 'waterway', budget);
    const bd = waysOf(f.boundaries, OSM_RELAY.MAX_BOUNDARY, null, budget);
    drop += ra.drop + cv.drop + wa.drop + bd.drop;
    feats = {
      buildings: nodesOf(f.buildings, OSM_RELAY.MAX_BLD),
      rails: ra.out,
      falls: nodesOf(f.falls, OSM_RELAY.MAX_FALL),
      crossings: nodesOf(f.crossings, OSM_RELAY.MAX_XING),
      pois: nodesOf(f.pois, OSM_RELAY.MAX_POI),
      entrances: nodesOf(f.entrances, OSM_RELAY.MAX_ENTRANCE),
      covers: cv.out,
      waters: wa.out,
      boundaries: bd.out,
    };
  }
  if (!feats && !roads) return null;
  return { bbox, feats, roads, drop };
}

/** UTF-8 位元組長度(CJK 招牌名一個字 3 bytes ⇒ MUST NOT 拿 `String.length` 當尺) */
const byteLen = (s) => (typeof TextEncoder === 'function' ? new TextEncoder().encode(s).length : s.length * 3);

/**
 * 把淨化後的 payload 裝進一則訊息,並確保**送得出去**。
 * 超過 `MAX_BYTES` 時先丟掉 `feats`(建物/鐵路/POI 拿不到只是少些擺件與招牌;路網拿不到
 * 是整批立體結構消失),仍超過就整份放棄。**MUST NOT 直接硬送** —— `ws` 對超過 maxPayload
 * 的訊框是以 1009 直接斷線,房主會在選角途中掉線,而症狀看起來完全像「伺服器壞了」。
 * @returns {null | { msg: object, dropFeats: boolean }}
 */
export function osmRelayFit(clean) {
  if (!clean) return null;
  let msg = { t: 'osm', bbox: clean.bbox, feats: clean.feats, roads: clean.roads };
  if (byteLen(JSON.stringify(msg)) <= OSM_RELAY.MAX_BYTES) return { msg, dropFeats: false };
  if (!clean.roads) return null;
  msg = { t: 'osm', bbox: clean.bbox, feats: null, roads: clean.roads };
  if (byteLen(JSON.stringify(msg)) <= OSM_RELAY.MAX_BYTES) return { msg, dropFeats: true };
  return null;
}
