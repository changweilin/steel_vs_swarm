// ============ 路網中繼(房主抓圖資 → 伺服器轉給全房)稽核 ============
// 用途:改 `public/js/osmrelay.js`、`biomes.js` 的 `commitOsmIn`/`osmInOf`/兩支 fetcher、
// `main.js` 的 `osmGate`/`onOsmRelay`/`scheduleOsmRetry`、`server/rooms.js` 的 `t:'osm'` 分支
// 或 `osmPayload`、`server.js` 的 maxPayload 之後跑。
//
// 使用者定案(2026-08-10)原句:「圖資儲存在開房者,再由開房者透過 server 傳給入房者?」
//
// 【它在修什麼】`startPrebuild` 是每台客戶端各跑一次的,而 `scheduleOsmRetry` 的存在本身
// 就證明「這一輪 Overpass 被限流」是常態 ⇒ A 抓到、B 沒抓到,兩台在建**不同的世界**:
// 橋、隧道、明隧道、地下道、建物、碰撞柱、街廓朝向全不一樣,而且沒有任何錯誤訊息 ——
// 玩家只會看到「你說的那座橋我這邊沒有」。中繼之後全房逐位元同一份路網。
//
// 【五種會靜默壞掉的方式,對應本檔五段】
//  Ⅰ **兩端用不同的資料**。房主如果吃「原始圖資」而入房者吃「淨化後的圖資」,中繼就白做了:
//     兩邊仍然在建不同的世界,只是差得比較小(小到剛好測不出來,而破圖照樣發生)。
//     ⇒ 淨化 MUST 冪等,而且對**真實 OSM 精度**的座標 MUST 是恆等(DP = 7 = OSM 原生精度)。
//  Ⅱ **模組級狀態被單機模式共用**。單機的 RoomHub 跑在同一個分頁裡,`rooms.js` 與 `main.js`
//     import 到的是**同一個** osmrelay.js 實例(URL 佈局鏡射,A28)—— 在那支放 store 就等於
//     伺服器與客戶端共用它。店面 MUST 住 biomes.js(rooms.js 永遠不會 import 那一支)。
//     同段順帶釘住「θ 不經中繼」:座標框在開房當下凍結(A42 ③),中繼只搬路網。
//  Ⅲ **覆蓋已定案的那一格**。房主 90 秒後重試成功會再送一次;若伺服器讓新的蓋掉舊的,
//     早進房的人用 v1、晚進房的人用 v2 —— 那正是中繼要修的病,只是換了個發生地點。
//     同段釘住不可信輸入(房主送什麼都要過 sanitize)與**別名**(單機直接存 `m.roads`
//     會與客戶端共用參照,而下游是就地變異那些陣列的)。
//  Ⅳ **接線的順序**。中繼早退 MUST 排在 `geoGet` 之前(排在後面 = 快取先贏 = 中繼只在
//     沒快取的機器上生效,而那正是最不需要它的情況);入房者 MUST 真的等(不等 = 這整套
//     只是把房主的圖資白送一趟);等待 MUST 與地形建構並行(串起來就是每個人多等 20 秒)。
//  Ⅴ **定案表的三態**。`undefined`(還沒定案)/ `null`(查過且沒有)/ 資料,三者混淆的代價:
//     把 null 當成「還沒定案」⇒ 房主要多吃一整份逾時預算;把「還沒定案」當成 null ⇒
//     入房者永遠不會自己去抓那一格。
//
// 反向驗證(全部落在原文斷言上;行為直測那幾條恆跑真品,不受旗標影響):
//   --break-monotone  伺服器改成無條件覆蓋已定案的格  ⇒ Ⅲ MUST 紅
//   --break-clone     伺服器直接存 m.roads(繞過淨化)⇒ Ⅲ MUST 紅
//   --break-wait      入房者不等中繼                  ⇒ Ⅳ MUST 紅
//   --break-cache     中繼早退搬到 geoGet 之後        ⇒ Ⅳ MUST 紅
//   --break-label     等待期間不寫進度列              ⇒ Ⅳ MUST 紅
import { readSrc, grabFn, grabBlock } from './audit_src.mjs';
import { OSM_RELAY, osmRelayKey, sanitizeOsmRelay, osmRelayFit } from '../public/js/osmrelay.js';
import { RoomHub } from '../server/rooms.js';
import { MAPGEO } from '../public/js/data.js';

const argv = process.argv;
let pass = 0, fail = 0;
const t = (n, ok, extra = '') => { ok ? (pass++, console.log(`  ✓ ${n}`)) : (fail++, console.log(`  ✗ ${n} ${extra}`)); };
const sec = (s) => console.log(`\n${s}`);

// 原文一律經 readSrc(換行已正規化為 \n)⇒ 下面的替換用 \n 是安全的;
// 每一支 break 都 MUST 驗「替換真的生效」,否則旗標會變成無聲 no-op = break 永遠是綠的(§5.4 ㋑)。
const patch = (src, re, rep, why) => {
  const out = src.replace(re, rep);
  if (out === src) { console.error(`❌ --break 替換無效(${why});稽核本身已失效,先修這裡`); process.exit(2); }
  return out;
};
const strip = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '')
  .split('\n').map((l) => l.replace(/(^|[^:'"`])\/\/.*$/, '$1')).join('\n');

let relaySrc = readSrc('public', 'js', 'osmrelay.js');
let roomsSrc = readSrc('server', 'rooms.js');
let mainSrc = readSrc('public', 'js', 'main.js');
let bioSrc = readSrc('public', 'js', 'biomes.js');
const srvSrc = readSrc('server', 'server.js');

if (argv.includes('--break-monotone')) {
  roomsSrc = patch(roomsSrc, /if \(!room\.osm\.roads && clean\.roads\)/, 'if (clean.roads)', 'monotone');
}
if (argv.includes('--break-clone')) {
  roomsSrc = patch(roomsSrc, /const clean = sanitizeOsmRelay\(m\);/, 'const clean = m;', 'clone');
}
if (argv.includes('--break-wait')) {
  mainSrc = patch(mainSrc, /if \(!osmInReady\(bbox, false\) && app\.lobby\?\.phase === 'room'\) \{[\s\S]*?await waitOsmRelay\(bbox\);[\s\S]*?\n    \}/, ';', 'wait');
}
if (argv.includes('--break-label')) {
  // 等待期間不寫進度列 ⇒「卡住時畫面要說明」的斷言 MUST 咬住
  mainSrc = patch(mainSrc, /\n *if \(pre\.osmLabel\) setP\(0\.60, pre\.osmLabel\);/, '', 'label');
}
if (argv.includes('--break-cache')) {
  // 把兩支 fetcher 的中繼早退整段拿掉 ⇒「早退排在 geoGet 之前」的順序斷言 MUST 咬住
  bioSrc = patch(bioSrc, /\n  const inj = osmInOf\(bbox, '(?:feats|roads)'\);[^\n]*\n  if \(inj !== undefined\) return inj && structuredClone\(inj\);/g, '\n', 'cache');
}

// =================================================================================
sec('Ⅰ payload 淨化:冪等 + 對真實圖資恆等 + 不可信輸入');
// ---------------------------------------------------------------------------------
{
  const BB = { minLat: 25.03, minLng: 121.55, maxLat: 25.06, maxLng: 121.59 };
  // 真實 OSM 節點精度 = 1e-7 度(資料庫存的就是這個刻度)。座標 MUST 由**整數奈度**組出來 ——
  // 寫 `25.0334567 + i * 1e-5` 這種浮點累加會生出第 8 位以後的尾巴,那是測資自己的問題,
  // 不是被驗的程式碼有問題(而且它會把「對真實圖資恆等」這條斷言變成永遠紅)。
  const ll = (nano) => nano / 1e7;
  const way = (n, tags = { highway: 'residential', name: '中山北路' }) => ({
    tags,
    geometry: Array.from({ length: n }, (_, i) => ({ lat: ll(250334567 + i * 100), lon: ll(1215612345 + i * 100) })),
  });
  const feats = {
    buildings: [{ lat: ll(250412345), lng: ll(1215623456), tags: { building: 'yes', name: '中山大樓' } }],
    rails: [{ tags: { railway: 'rail' }, geometry: [{ lat: 25.04, lon: 121.56 }, { lat: 25.05, lon: 121.57 }] }],
    falls: [], crossings: [], pois: [{ lat: 25.05, lng: 121.58, tags: { place: 'suburb', name: '士林' } }],
  };
  const raw = { bbox: BB, feats, roads: [way(12), way(30, { highway: 'primary' })] };
  const a = sanitizeOsmRelay(raw);
  const b = sanitizeOsmRelay(a);
  t('淨化冪等(房主送出前跑一次、伺服器收到後再跑一次 ⇒ 逐位元相同)',
    JSON.stringify(a) === JSON.stringify(b));
  t('對真實 OSM 精度(1e-7 度)的座標是恆等 —— 開了中繼與退回自己抓建出同一張圖',
    JSON.stringify(a.roads) === JSON.stringify(raw.roads)
    && JSON.stringify(a.feats.buildings) === JSON.stringify(raw.feats.buildings));
  t('DP = 7 = OSM 節點原生精度(調小可以砍 payload,但那會讓中繼與備援建出兩張圖)',
    OSM_RELAY.DP === 7);

  t('bbox 不合法 ⇒ 整份丟掉(MUST NOT 補 0,那會把整張圖挪到赤道)',
    sanitizeOsmRelay({ bbox: { minLat: 1, minLng: 2 }, roads: [way(4)] }) === null
    && sanitizeOsmRelay({ bbox: { minLat: 9, minLng: 2, maxLat: 1, maxLng: 3 }, roads: [way(4)] }) === null);
  t('兩格都空 ⇒ 回 null(沒有東西可中繼,MUST NOT 送出空訊息讓入房者以為定案了)',
    sanitizeOsmRelay({ bbox: BB, feats: null, roads: [] }) === null);
  t('座標非有限值 ⇒ 該條 way 整條丟掉',
    sanitizeOsmRelay({ bbox: BB, roads: [{ tags: { highway: 'primary' }, geometry: [{ lat: NaN, lon: 1 }, { lat: 2, lon: 3 }] }] }) === null);
  t('沒有 highway 的「道路」被擋(鏡射 fetchOsmRoads 自己的過濾;放行 = 下游查不到路寬)',
    sanitizeOsmRelay({ bbox: BB, roads: [{ tags: { name: 'x' }, geometry: way(4).geometry }] }) === null);
  t('沒有 railway 的「鐵路」被擋',
    sanitizeOsmRelay({ bbox: BB, feats: { rails: [{ tags: {}, geometry: way(4).geometry }] } }).feats.rails.length === 0);

  // 超限一律**整條丟掉**:截掉一半的折線不是「少一點細節」,而是那條路憑空轉向並在半路斷掉
  const longWay = way(OSM_RELAY.MAX_PTS + 1);
  const cut = sanitizeOsmRelay({ bbox: BB, roads: [longWay, way(5)] });
  t('超過單條節點上限 ⇒ 整條丟掉,MUST NOT 截斷(截斷 = 橋台落在河中央、洞口開在山裡)',
    cut.roads.length === 1 && cut.roads[0].geometry.length === 5 && cut.drop === 1);
  const many = sanitizeOsmRelay({ bbox: BB, roads: Array.from({ length: OSM_RELAY.MAX_ROAD + 3 }, () => way(3)) });
  t('超過 way 數上限 ⇒ 夾到上限並記在 drop(靜默截斷 = 看起來像「這張圖本來就沒那麼多路」)',
    many.roads.length === OSM_RELAY.MAX_ROAD && many.drop === 3);
  const tagged = sanitizeOsmRelay({
    bbox: BB,
    roads: [{ tags: Object.fromEntries(Array.from({ length: OSM_RELAY.MAX_TAGS + 10 }, (_, i) => [i === 0 ? 'highway' : `k${i}`, 'x'.repeat(500)])), geometry: way(3).geometry }],
  });
  t('tag 數與鍵值長度都有界(惡意房主不能靠一條 way 灌爆入房者)',
    Object.keys(tagged.roads[0].tags).length === OSM_RELAY.MAX_TAGS
    && Object.values(tagged.roads[0].tags).every((v) => v.length <= OSM_RELAY.MAX_TAG_LEN));
  t('淨化產生的是**全新物件**(單機 hub 與客戶端共用分頁 ⇒ 存 m.roads 會被下游就地變異)',
    a.roads !== raw.roads && a.roads[0] !== raw.roads[0] && a.feats !== raw.feats
    && a.feats.buildings[0] !== raw.feats.buildings[0]);

  // 節點預算的消耗順序是契約:道路先於鐵路。兩端跑同一份資料若順序不同就會裁出不同結果。
  t('節點預算:道路 MUST 排在鐵路之前(順序不同 = 兩端裁出不同的世界)',
    /waysOf\(m\?\.roads[\s\S]{0,600}waysOf\(f\.rails/.test(strip(relaySrc)));

  // ---- osmRelayFit:送得出去才算數 ----
  t('正常大小的 payload 原樣送出',
    osmRelayFit(a).dropFeats === false && osmRelayFit(a).msg.t === 'osm');
  const bigFeats = {
    ...feats,
    buildings: Array.from({ length: OSM_RELAY.MAX_BLD }, (_, i) => ({ lat: 25.04 + i * 1e-6, lng: 121.56, tags: { building: 'yes', name: '大'.repeat(120) } })),
  };
  const bigA = sanitizeOsmRelay({ bbox: BB, feats: bigFeats, roads: [way(12)] });
  const savedMax = OSM_RELAY.MAX_BYTES;
  OSM_RELAY.MAX_BYTES = 20000;   // 只在這一小段收緊(不是 --break-*:驗的是「超限時的行為」)
  const fitted = osmRelayFit(bigA);
  t('超過位元組上限 ⇒ 先丟 feats 保住路網(拿不到建物只是少擺件,拿不到路網是結構整批消失)',
    fitted?.dropFeats === true && fitted.msg.feats === null && fitted.msg.roads?.length === 1);
  OSM_RELAY.MAX_BYTES = 200;
  t('連路網都塞不下 ⇒ 整份放棄,MUST NOT 硬送(ws 對超限訊框是 1009 直接斷房主的線)',
    osmRelayFit(bigA) === null);
  OSM_RELAY.MAX_BYTES = savedMax;
  t('CJK 招牌名以 UTF-8 位元組計量(拿 String.length 當尺會低估三倍)',
    /TextEncoder/.test(strip(relaySrc)));
  t('客戶端自我封頂低於 server.js 的 maxPayload(2MiB)',
    OSM_RELAY.MAX_BYTES < 2 * 1024 * 1024 && /maxPayload: 2 << 20/.test(srvSrc));
}

// =================================================================================
sec('Ⅱ osmrelay.js:零 import、零模組級可變狀態、θ 不經中繼');
// ---------------------------------------------------------------------------------
{
  const s = strip(relaySrc);
  t('零 import(rooms.js 要在 Node 載得起來;A28)', !/^\s*import\s/m.test(s));
  t('零模組級可變狀態(單機的 hub 與客戶端 import 到同一個實例 ⇒ 有 store 就等於共用)',
    !/^(let|var)\s/m.test(s), (s.match(/^(let|var)\s.*/m) || [''])[0]);
  t('中繼 payload 不帶座標框 —— θ 隨 battleConfig 在開房當下凍結(A42 ③)',
    !/\brot\b/.test(s) && !/\bcenter\b/.test(s));
  t('店面住 biomes.js(rooms.js 永遠不會 import 那一支)',
    /^let _osmIn = null;/m.test(strip(bioSrc)) && !/biomes\.js/.test(strip(roomsSrc)));
  t('rooms.js 由 osmrelay.js 取得淨化函式(MUST NOT 在伺服器端照抄一組上限)',
    /import \{ sanitizeOsmRelay, osmRelayKey \} from '\.\.\/public\/js\/osmrelay\.js';/.test(roomsSrc));
  t('中繼鍵與 geocache 同精度(5 位小數;不同精度 = 同一張圖被判成兩張)',
    osmRelayKey({ minLat: 25.0300001, minLng: 121.55, maxLat: 25.06, maxLng: 121.59 })
    === osmRelayKey({ minLat: 25.03, minLng: 121.55, maxLat: 25.06, maxLng: 121.59 })
    && /toFixed\(5\)/.test(strip(relaySrc)));
}

// =================================================================================
sec('Ⅲ 伺服器:不可信輸入 + 逐格單調 + 晚到者補送');
// ---------------------------------------------------------------------------------
{
  const blk = strip(grabBlock(roomsSrc, "if (m.t === 'osm')"));
  t('只有房主的中繼受理(非房主一律丟棄,與 t:\'world\' 同規格)',
    /myId !== room\.hostId\) return;/.test(blk));
  t('一律過 sanitizeOsmRelay(存進房間的 MUST 是它回傳的新物件)',
    /const clean = sanitizeOsmRelay\(m\);/.test(blk) && !/room\.osm\.roads = m\./.test(blk));
  t('逐格單調:已定案的格 MUST NOT 被覆蓋',
    /!room\.osm\.feats && clean\.feats/.test(blk) && /!room\.osm\.roads && clean\.roads/.test(blk));
  t('沒有新的格就不轉播(否則入房者每收一次就白重建一次)',
    /if \(!add\.feats && !add\.roads\) return;/.test(blk));
  t('MUST NOT 碰 battleConfig —— 路網可以從無到有,座標框不行(A42 ③)',
    !/battleConfig/.test(blk) && !/center/.test(blk));
  t('MUST NOT 塞進 sync(那則會重播多次,幾百 KB 乘上去不可接受)',
    !/osm/.test(strip(grabBlock(roomsSrc, '  broadcast(room) {'))));
  t('晚到的入房者/重連者補送(joinRoom 與 reattach 各一處,經 osmPayload 單一縫)',
    (strip(roomsSrc).match(/hub\.osmPayload\(room\)/g) || []).length === 2);

  // ---- 行為直測:真的起一個 RoomHub 跑一輪(原文斷言驗形狀,這一段驗它真的這樣動)----
  const A = [25.0330, 121.5654], D = 1600, R = 6371000;
  const realD = D * MAPGEO.REAL_SCALE, dLat = realD / R * 180 / Math.PI;
  const B = [A[0] + dLat, A[1]], mid = [(A[0] + B[0]) / 2, (A[1] + B[1]) / 2];
  const lane = [];
  for (let u = 0; u <= 1.001; u += 0.05) lane.push([A[0] + (B[0] - A[0]) * u, A[1] + (B[1] - A[1]) * u]);
  const sizeM = D / (0.85 * Math.SQRT2);
  const cfg = {
    center: { lat: mid[0], lng: mid[1] }, bases: { SWARM: A, STEEL: B }, lanes: [lane],
    sizeM, diagM: sizeM * Math.SQRT2, distM: D, geoScaleVer: MAPGEO.GEO_SCALE_VER,
    maxOverlap: 0.05, synthetic: true, placeName: '中繼測試', env: { season: 'summer', time: 'day', weather: 'clear' },
  };
  const BB = { minLat: 25.03, minLng: 121.55, maxLat: 25.06, maxLng: 121.59 };
  const mkRoads = (name) => [{ tags: { highway: 'primary', name }, geometry: [{ lat: 25.04, lon: 121.56 }, { lat: 25.05, lon: 121.57 }] }];
  const mkFeats = () => ({ buildings: [{ lat: 25.041, lng: 121.562, tags: { building: 'yes' } }], rails: [], falls: [], crossings: [], pois: [] });

  const hub = new RoomHub({ urls: () => [], log: () => {}, dropMs: 0 });
  const hIn = [], host = hub.attach((m) => hIn.push(m));
  host.recv({ t: 'createRoom', name: '房主', teamSize: 1, battleConfig: cfg });
  const room = [...hub.rooms.values()][0];
  t('開房成功(行為直測的前置)', !!room);

  const gIn = [], guest = hub.attach((m) => gIn.push(m));
  guest.recv({ t: 'joinRoom', pin: room.pin, name: '入房者' });
  const roads1 = mkRoads('第一份');
  host.recv({ t: 'osm', bbox: BB, feats: mkFeats(), roads: roads1 });
  const got = gIn.filter((m) => m.t === 'osm');
  t('房主上傳 → 入房者立刻收到(房間階段就送,不等開戰)',
    got.length === 1 && got[0].roads?.[0]?.tags?.name === '第一份' && !!got[0].feats);
  t('房主自己不會收到轉播(它就是來源)', hIn.filter((m) => m.t === 'osm').length === 0);
  t('房間副本與客戶端不共用參照(單機 hub 跑在同一個分頁裡,共用 = 被下游就地變異)',
    room.osm.roads !== roads1 && room.osm.roads[0] !== roads1[0]);

  host.recv({ t: 'osm', bbox: BB, feats: mkFeats(), roads: mkRoads('第二份') });
  t('已定案的格不被覆蓋(房主重試成功再送一次 ⇒ 早進房與晚進房的人 MUST 拿到同一份)',
    room.osm.roads[0].tags.name === '第一份' && gIn.filter((m) => m.t === 'osm').length === 1);

  const lIn = [], late = hub.attach((m) => lIn.push(m));
  late.recv({ t: 'joinRoom', pin: room.pin, name: '晚到者', mode: 'spectator' });   // 1v1 席位已滿 ⇒ 觀戰身分
  const lateGot = lIn.find((m) => m.t === 'osm');
  t('晚到的入房者一進房就補到同一份(房主早就上傳完了,它不該乾等 20 秒)',
    lateGot?.roads?.[0]?.tags?.name === '第一份');

  const before = JSON.stringify(room.osm);
  late.recv({ t: 'osm', bbox: BB, roads: mkRoads('冒名') });
  t('非房主的中繼一律丟棄', JSON.stringify(room.osm) === before);
  host.recv({ t: 'osm', bbox: { minLat: 1, minLng: 1, maxLat: 2, maxLng: 2 }, roads: mkRoads('別張圖') });
  t('鍵不符的中繼丟棄(那份不屬於這一房)', JSON.stringify(room.osm) === before);
  host.recv({ t: 'osm', bbox: BB, roads: [{ tags: {}, geometry: [] }] });
  t('畸形 payload 不會炸掉房間', JSON.stringify(room.osm) === before);
  hub.shutdown();
}

// =================================================================================
sec('Ⅳ 客戶端接線:早退順序、真的等、與地形建構並行');
// ---------------------------------------------------------------------------------
{
  const bio = strip(bioSrc);
  for (const [fn, slot] of [['fetchOsmFeatures', 'feats'], ['fetchOsmRoads', 'roads']]) {
    const body = strip(grabFn(bioSrc, fn));
    const iInj = body.indexOf(`osmInOf(bbox, '${slot}')`);
    const iGet = body.indexOf('geoGet');
    t(`${fn}:中繼早退 MUST 排在 geoGet 之前(排在後面 = 快取先贏 ⇒ 中繼只在最不需要它的機器上生效)`,
      iInj >= 0 && iGet > iInj);
    t(`${fn}:中繼那一份走深拷貝(下游就地變異;不拷貝 = 第二場拿到被改過的圖資)`,
      /return inj && structuredClone\(inj\);/.test(body));
  }
  t('中繼資料 MUST NOT 寫進 geocache(來源是不可信的房主;寫了會污染這台機器之後每一場)',
    !/geoPut\([^)]*inj/.test(bio));
  t('定案表是唯一 store,且逐格三態(undefined 未定案 / null 查過沒有 / 資料)',
    (bio.match(/^let _osmIn = null;/gm) || []).length === 1
    && /_osmIn\[k\] !== undefined/.test(bio));

  const m = strip(mainSrc);
  const gate = strip(grabFn(mainSrc, 'osmGate'));
  t('NET_HANDLERS 收 t:\'osm\'', /\n  osm: \(m\) => onOsmRelay\(m\),/.test(m));
  t('入房者 MUST 真的等中繼(不等 = 這整套只是把房主的圖資白送一趟)',
    /await waitOsmRelay\(bbox\)/.test(gate));
  t('已收到任一格就不再等(中繼晚到觸發的重建不該抱著資料乾等 WAIT_MS)',
    /osmInReady\(bbox, false\)/.test(gate));
  t('只在房間階段等 —— 載入畫面上乾等會拖著全房(maybeLaunch 要所有人 loaded 才開戰)',
    /app\.lobby\?\.phase === 'room'/.test(gate));
  t('房主取原始圖資走 warmOsm(buildBiomes 內那一份已被量化與就地變異過)',
    /await warmOsm\(bbox\)/.test(gate));
  t('房主吃的是**送出去的那一份**(fit.msg;兩邊資料不同 = 中繼白做)',
    /commitOsmIn\(bbox, \{ feats: fit\?\.msg\.feats \|\| null, roads: fit\?\.msg\.roads \|\| null \}\)/.test(gate));
  t('房主親自查過的空手也定案成 null(不定案 ⇒ buildBiomes 會再吃一整份逾時預算)',
    /\|\| null, roads: .*\|\| null \}\)/.test(gate));
  t('送出前一律經 osmRelayFit(直接硬送會被 ws 以 1009 斷掉房主的連線)',
    /osmRelayFit\(sanitizeOsmRelay\(/.test(gate));

  const pre = strip(grabFn(mainSrc, 'startPrebuild'));
  const iGate = pre.indexOf('osmGate(cfg'), iModels = pre.indexOf('await warmModels'), iAwait = pre.indexOf('await gate;'), iBio = pre.indexOf('buildBiomes(');
  t('閘門與模型/地形建構**並行**:開閘排在 warmModels 之前,await 排在 buildBiomes 之前',
    iGate >= 0 && iModels > iGate && iAwait > iModels && iBio > iAwait);
  t('閘門失敗一律吞掉(每一種失敗都有備援,MUST NOT 把整份預建判成 pre.error)',
    /osmGate\(cfg, onOsmLabel\)\.catch\(/.test(pre));
  // 【進度回饋】等待與地形建構並行 ⇒ 平時看不出來;房主整組失敗時入房者會多停最多 WAIT_MS,
  // 那段沉默是唯一「畫面沒說明」的窗口。文字的**內容**只准住 osmGate(房主等 Overpass 與
  // 入房者等中繼是兩件事,而那個分岔只有它認得),**顯示時機**只准住 startPrebuild 的
  // await 那一刻(閘一開就寫 = 蓋掉正在跑的模型/地形文案,而那兩段本來就在並行)。
  const iLabel = pre.indexOf('if (pre.osmLabel) setP(');
  t('等待中繼 MUST 有畫面說明(否則狀態列停在地形文案上乾等 WAIT_MS)', iLabel >= 0);
  t('顯示時機 MUST 排在 await gate 之前、地形之後(閘一開就寫會蓋掉並行中的地形進度)',
    iLabel > pre.indexOf('buildTerrain(') && iLabel < iAwait);
  t('文字內容 MUST 由 osmGate 決定(房主等 Overpass / 入房者等中繼是兩件事,分岔只有它認得)',
    /onLabel\('等待房主的道路圖資…'\)/.test(gate) && /onLabel\('取得道路圖資/.test(gate)
    && !/pre\.osmLabel = '[^']/.test(pre));
  t('等到了 MUST 清空(留著 = 下一次 await 顯示一句早就過期的說明)',
    (gate.match(/onLabel\(''\)/g) || []).length === 2);

  const arrive = strip(grabFn(mainSrc, 'onOsmRelay'));
  t('中繼只定案帶資料的格(寫成 null 等於替房主的失敗背書,入房者從此不會自己去抓)',
    /feats: clean\.feats \|\| undefined, roads: clean\.roads \|\| undefined/.test(arrive));
  t('鍵 MUST 對得上本房這張圖(指向別張圖的中繼會把定案表整份換掉 = 已到手的路網被清掉)',
    /key !== osmRelayKey\(battleBBox\(cfg\)\)\) return;/.test(arrive));
  t('中繼晚到 ⇒ 只在房間階段重建(loading 之後重建會把全房卡在載入畫面)',
    /app\.phaseShown === 'room'/.test(arrive) && /app\.pre = null;/.test(arrive));
  t('沒帶來新東西就不重建(單調 ⇒ 至多重建有限次,MUST NOT 變成互相觸發的迴圈)',
    /if \(!fresh\) return;/.test(arrive));
  t('中繼 MUST NOT 改寫 battleConfig / center(θ 凍結,A42 ③)',
    !/battleConfig\s*=/.test(arrive) && !/\.center\b/.test(arrive) && !/\brot\b/.test(arrive));

  const retry = strip(grabFn(mainSrc, 'scheduleOsmRetry'));
  t('房間階段補抓成功 MUST 呼叫 resetOsmMisses(否則第一輪的 null 把自己永久鎖死)',
    /resetOsmMisses\(\);/.test(retry));
}

// =================================================================================
sec('Ⅴ 定案表三態(原文沙箱直測)');
// ---------------------------------------------------------------------------------
{
  const src = readSrc('public', 'js', 'biomes.js');   // 這一段恆驗真品,不吃 --break-cache
  const store = new Function('osmRelayKey', `
    let _osmIn = null;
    ${grabFn(src, 'commitOsmIn')}
    ${grabFn(src, 'osmInOf')}
    ${grabFn(src, 'osmInReady')}
    ${grabFn(src, 'resetOsmMisses')}
    return { commitOsmIn, osmInOf, osmInReady, resetOsmMisses };
  `)(osmRelayKey);
  const BB = { minLat: 25.03, minLng: 121.55, maxLat: 25.06, maxLng: 121.59 };
  const BB2 = { minLat: 35.03, minLng: 121.55, maxLat: 35.06, maxLng: 121.59 };
  const R1 = [{ tags: { highway: 'primary' }, geometry: [] }];
  const R2 = [{ tags: { highway: 'trunk' }, geometry: [] }];

  t('未定案 ⇒ undefined(fetcher 照舊自己抓)', store.osmInOf(BB, 'roads') === undefined);
  t('定案資料 ⇒ 回報有新東西(呼叫端據此重建)', store.commitOsmIn(BB, { roads: R1 }) === true);
  t('已定案的格 MUST NOT 被覆蓋(同一間房裡不能有人用 v1、有人用 v2)',
    store.commitOsmIn(BB, { roads: R2 }) === false && store.osmInOf(BB, 'roads') === R1);
  t('undefined 的格 = 不動它', store.osmInOf(BB, 'feats') === undefined);
  t('定案為 null(查過且沒有)不算新東西 ⇒ 不觸發重建',
    store.commitOsmIn(BB, { feats: null }) === false && store.osmInOf(BB, 'feats') === null);
  t('兩格都定案 ⇒ 房主的閘門直接放行', store.osmInReady(BB) === true);
  t('resetOsmMisses 只退 null、不動已到手的那一份(那是全房正在用的)',
    (store.resetOsmMisses(), store.osmInOf(BB, 'feats') === undefined && store.osmInOf(BB, 'roads') === R1));
  t('至少一格 ⇒ 入房者的閘門不再等(osmInReady(bbox, false))',
    store.osmInReady(BB, false) === true && store.osmInReady(BB) === false);
  t('換一張圖 ⇒ 舊的定案不適用(bbox 是配對鍵)',
    store.osmInOf(BB2, 'roads') === undefined);
  t('換圖後定案不會污染回舊圖(store 只留一把鍵)',
    store.commitOsmIn(BB2, { roads: R2 }) === true && store.osmInOf(BB, 'roads') === undefined);
}

// =================================================================================
console.log(`\n${fail ? '❌' : '✅'} 路網中繼稽核:${pass} 綠 / ${fail} 紅`);
for (const [flag, why] of [
  ['--break-monotone', '伺服器無條件覆蓋已定案的格 ⇒ Ⅲ MUST 紅'],
  ['--break-clone', '伺服器直接存 m.roads(繞過淨化)⇒ Ⅲ MUST 紅'],
  ['--break-wait', '入房者不等中繼 ⇒ Ⅳ MUST 紅'],
  ['--break-cache', '中繼早退搬到 geoGet 之後 ⇒ Ⅳ MUST 紅'],
  ['--break-label', '等待期間不寫進度列 ⇒ Ⅳ MUST 紅'],
]) if (argv.includes(flag)) console.log(`(${flag}:${why})`);
process.exit(fail ? 1 : 0);
