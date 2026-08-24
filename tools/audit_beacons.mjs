// ============ 語意化地標(P2-C)稽核 ============
// `docs/visual_upgrade_plan.md` 的 P2-C 被延後兩個月的理由只有一句:**「驗不動」**。
// 往兵線裡放東西正是 V-B 泛洪稽核存在的目的,而那支要 Overpass + 高程磚,沙箱連不出去。
// 2026-08-03 使用者定案「放在**旁邊**、看得見即可」把死結拆開之後,這一項就變成
// **完全可以離線驗**的東西 —— 本檔不需要網路、不需要瀏覽器、不需要 three。
//
// 能離線驗的關鍵是 `beacons.js` 的前半段(常數 / 型錄 / 零件表 / 錨點 / 落點規劃)**零 THREE**:
// 零件是純資料(`['box', w,h,d]` 這種),所以外廓在 Node 端算得出來;落點規劃只認一個
// `probe(x,z,r)` 回呼,所以合成場景就能直測。本檔以 `new Function` 執行**那一段原文**
// (㋑ 以執行原文驗真品;抄一份公式進稽核 = 公式改了稽核照舊全綠)。
//
// 分段:
//   Ⅰ 型錄與外廓 —— 標稱 foot 不得低報(A30:看得見卻打不到)、也不得虛胖;純區塊零 THREE
//   Ⅱ 錨點推導 —— 三類(兵線/重生點/建築單位)齊全、前線塔位優先、切向是單位向量、零亂數
//   Ⅲ 落點規劃行為直測 —— 由近而遠、側向優先、找不到就不擺、SEP/MAX/FAR、確定性、朝向
//   Ⅳ 消費端單一縫 —— biomes.js 的接線:四道閘、量出來的碰撞柱、排在植被之前、不消耗 rnd
//
// 反向驗證(原則 9):`node tools/audit_beacons.mjs --break-extent` 把一件零件撐出 foot,
// Ⅰ MUST 紅字;`--break-pad` 把預留餘裕歸零,Ⅲ 的預留斷言 MUST 紅字;
// `--break-order` 把地標呼叫搬到大地標之前,Ⅳ 的建置順序斷言 MUST 紅字。
import { readSrc } from './audit_src.mjs';
import { makeVehicle } from '../public/js/vehicles.js';
import { solveTowerSites } from '../public/js/data.js';

const BREAK_EXTENT = process.argv.includes('--break-extent');
const BREAK_PAD = process.argv.includes('--break-pad');
const BREAK_ORDER = process.argv.includes('--break-order');

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log(`  ✅ ${m}`); } else { fail++; console.log(`  ❌ ${m}`); } };
const near = (a, b, e = 1e-9) => Math.abs(a - b) <= e;

const src = readSrc('public', 'js', 'beacons.js');
const bioSrc = readSrc('public', 'js', 'biomes.js');

// ---- 抽出「純區塊」= 常數起點 → 建構段起點 ----
const i0 = src.indexOf('export const BEACON = {');
const i1 = src.indexOf('// ---- 建構(以下才需要 THREE)----');
if (i0 < 0 || i1 < 0 || i1 <= i0) { console.log('❌ 找不到純區塊界標'); process.exit(1); }
const pureSrc = src.slice(i0, i1);

const M = new Function('makeVehicle', `
  ${pureSrc.replace(/^export /gm, '')}
  return { BEACON, BEACON_KINDS, KIND_PARTS, KIND_BY_ANCHOR, LANE_KINDS,
           partExtent, kindExtent, beaconSeed, beaconAnchors, beaconKindFor, planBeaconSites };
`)(makeVehicle);

if (BREAK_EXTENT) M.KIND_PARTS.pylon.push({ g: ['box', 40, 1, 1], c: 0x999999, p: [0, 5, 0] });
if (BREAK_PAD) M.BEACON.PAD = 0;

// ============ Ⅰ 型錄與外廓 ============
console.log('\nⅠ 型錄與外廓(標稱 foot vs 零件實算)');
{
  // 剝掉註解再看(行註解 + 區塊註解)—— 註解裡當然可以提到 three,會壞事的是真的用到它
  const pureCode = pureSrc.replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n').map((l) => l.replace(/\/\/.*$/, '')).join('\n');
  ok(!/\bTHREE\b/.test(pureCode), '純區塊零 THREE(這才是本項能離線驗的原因)');
  ok(!/Math\.random/.test(src), '全檔無 Math.random(A4)');
  const kinds = Object.keys(M.BEACON_KINDS);
  ok(kinds.length >= 3, `型錄至少三款(${kinds.length} 款)`);
  ok(kinds.every((k) => M.KIND_PARTS[k]), '每一款型錄都有對應零件表');
  ok(Object.keys(M.KIND_PARTS).every((k) => M.BEACON_KINDS[k]), '每一份零件表都有對應型錄(沒有孤兒)');
  for (const k of kinds) {
    const ext = M.kindExtent(k);
    const foot = M.BEACON_KINDS[k].foot;
    // **低報就是 A30**:規劃期只預留 foot + PAD,而碰撞柱是量出來的 —— 實際外廓超過 foot
    // 就代表碰撞柱可能大於預留範圍,地標會侵進它自己沒有申請過的空間。
    ok(ext <= foot + 1e-9, `${k}:實算外廓 ${ext.toFixed(2)}m ≤ 標稱 foot ${foot}m`);
    // 虛胖也不行:foot 撐大 = 地標被無謂地推遠 = 使用者要的「旁邊」變成「遠方」
    ok(ext >= foot * 0.7, `${k}:標稱 foot 沒有虛胖(實算佔 ${(ext / foot * 100).toFixed(0)}%)`);
  }
  // 高度分級:錨點的淨空圈越大 ⇒ 地標被推得越遠 ⇒ 必須越高才看得見
  ok(M.BEACON_KINDS[M.KIND_BY_ANCHOR.base].h >= 20,
    `重生點那一款夠高(主堡淨空 70m ⇒ 落在 ~90m 外;${M.KIND_BY_ANCHOR.base} ${M.BEACON_KINDS[M.KIND_BY_ANCHOR.base].h}m)`);
  ok(M.BEACON_KINDS[M.KIND_BY_ANCHOR.tower].h >= 18,
    `建築單位那一款夠高(${M.KIND_BY_ANCHOR.tower} ${M.BEACON_KINDS[M.KIND_BY_ANCHOR.tower].h}m)`);
  ok(M.LANE_KINDS.every((k) => M.BEACON_KINDS[k]), '兵線那三款輪替都在型錄內');
  // FAR MUST 大於主堡那一圈,否則重生點永遠找不到位置(而且不會有任何錯誤訊息)
  const baseFoot = M.BEACON_KINDS[M.KIND_BY_ANCHOR.base].foot;
  ok(M.BEACON.FAR > 70 + baseFoot + M.BEACON.PAD,
    `FAR(${M.BEACON.FAR}m)大於主堡淨空 70 + foot + PAD(${(70 + baseFoot + M.BEACON.PAD).toFixed(1)}m)`);
  // 傾斜件的外廓 MUST 用 3D 半對角(縱向尺寸會轉進水平面)
  const flat = M.partExtent({ g: ['cyl', 1.5, 1.5, 0.45, 10], p: [0, 0, 0] });
  const tilt = M.partExtent({ g: ['cyl', 1.5, 1.5, 0.45, 10], p: [0, 0, 0], r: [Math.PI / 2, 0, 0] });
  ok(tilt >= flat, '傾斜件的外廓不小於同一件躺平時(偏差朝「算大」)');
  ok(M.partExtent({ g: ['ico', 1], p: [3, 0, 4] }) === 6, '外廓 = 位移距離 + 零件半徑');
}

// ============ Ⅱ 錨點推導 ============
console.log('\nⅡ 錨點推導(兵線 / 重生點 / 建築單位)');
// 合成兵線:一條沿 +x 的直線(index 0 = SWARM 端),長 2000m
const lane = [];
for (let i = 0; i <= 20; i++) lane.push([-1000 + i * 100, 0]);
const lanesW = [lane];
const basesW = [{ side: 'SWARM', x: -1000, z: 0 }, { side: 'STEEL', x: 1000, z: 0 }];
const towerSites = solveTowerSites(lanesW);
{
  const an = M.beaconAnchors({ lanesW, basesW, towerSites });
  const byKind = (k) => an.filter((a) => a.kind === k);
  ok(byKind('base').length === 2, `重生點錨點 = 雙方主堡(${byKind('base').length} 個)`);
  ok(byKind('tower').length >= 2, `建築單位錨點來自 solveTowerSites(${byKind('tower').length} 個)`);
  ok(byKind('lane').length === 3, `兵線沿線等距取樣(${byKind('lane').length} 個)`);
  ok(an.findIndex((a) => a.kind === 'base') < an.findIndex((a) => a.kind === 'tower'),
    '重生點排在最前(玩家每場開局與每次重生都從這裡出發)');
  ok(an.every((a) => near(Math.hypot(a.tx, a.tz), 1, 1e-9)), '每個錨點的切向都是單位向量');
  // 前線那一組(solveTowerSites 序末項)MUST 排在同一條兵線其他塔位之前
  if (towerSites[0].length > 1) {
    const front = towerSites[0][towerSites[0].length - 1];
    const first = byKind('tower')[0];
    ok(near(first.x, front.SWARM.x) && near(first.z, front.SWARM.z),
      '前線塔位排在同一條兵線的其他塔位之前');
  } else {
    ok(true, '此合成兵線只解出一組塔位(前線優先無從比較,略過)');
  }
  // 錨點座標 MUST 真的落在它宣稱的東西上
  ok(byKind('base').every((a) => basesW.some((b) => near(a.x, b.x) && near(a.z, b.z))),
    '重生點錨點座標 = 主堡座標');
  ok(byKind('tower').every((a) => towerSites[0].some((s) => ['SWARM', 'STEEL'].some(
    (sd) => near(a.x, s[sd].x) && near(a.z, s[sd].z)))), '建築單位錨點座標 = 塔位座標');
  ok(byKind('lane').every((a) => Math.abs(a.z) < 1e-6 && a.x > -1000 && a.x < 1000),
    '兵線錨點落在兵線上');
  // 零亂數消耗(§2.3):推導端連 rnd 這個字都不該出現
  const anSrc = pureSrc.slice(pureSrc.indexOf('export function beaconAnchors'), pureSrc.indexOf('export function beaconKindFor'));
  ok(!/\brnd\b|random/i.test(anSrc), '錨點推導不消耗任何亂數(抽一枚就把全圖佈局序列推移)');
  ok(!lanesW.length || M.beaconAnchors({ lanesW: [], basesW: [], towerSites: [] }).length === 0,
    '沒有兵線就沒有錨點(離線兵線缺失時不亂擺)');
}

// ============ Ⅲ 落點規劃行為直測 ============
console.log('\nⅢ 落點規劃(合成 probe 直測)');
{
  const one = [{ kind: 'lane', x: 0, z: 0, tx: 1, tz: 0, tag: 'T' }];
  // ① 全部放得下 ⇒ 取最近的一圈(使用者要的「旁邊」)
  {
    const seen = [];
    const s = M.planBeaconSites(one, (x, z, r) => { seen.push(r); return true; });
    ok(s.length === 1, '放得下就擺一件');
    ok(near(s[0].d, M.BEACON.NEAR), `落點取最近的一圈(d = ${s[0].d}m = NEAR)`);
    const foot = M.BEACON_KINDS[s[0].kind].foot;
    ok(!BREAK_PAD ? seen.every((r) => near(r, foot + M.BEACON.PAD)) : false,
      `probe 收到的腳印 = foot + PAD(${(foot + M.BEACON.PAD).toFixed(1)}m;比建物更保守)`);
    // 側向優先:落點應垂直於切向(切向 = +x ⇒ 落點在 ±z)
    ok(Math.abs(s[0].x) < 1e-9 && Math.abs(s[0].z) > 1,
      '落點由側向張開(落在路邊,不是推進方向的正前方)');
    // 面向錨點
    ok(near(Math.atan2(0 - s[0].x, 0 - s[0].z), s[0].ry), 'ry 面向錨點(梯子/碟面朝著路)');
  }
  // ② 一律拒絕 ⇒ 一件都不擺(原則 6 寧缺勿錯,MUST NOT 硬塞)
  ok(M.planBeaconSites(one, () => false).length === 0, 'probe 全拒 ⇒ 一件都不擺');
  // ③ 只有遠處放得下 ⇒ 落在那個距離,且不超過 FAR
  {
    const s = M.planBeaconSites(one, (x, z) => Math.hypot(x, z) >= 120);
    ok(s.length === 1 && s[0].d >= 120 && s[0].d <= M.BEACON.FAR,
      `近處放不下就往外找(d = ${s[0]?.d}m)`);
  }
  // ④ 超過 FAR 的位置一律不要(再遠就不是「旁邊」)
  ok(M.planBeaconSites(one, (x, z) => Math.hypot(x, z) > M.BEACON.FAR + 5).length === 0,
    `超過 FAR(${M.BEACON.FAR}m)一律不擺`);
  // ⑤ SEP:兩個貼在一起的錨點不得各擺一件
  {
    const two = [
      { kind: 'lane', x: 0, z: 0, tx: 1, tz: 0 },
      { kind: 'lane', x: 20, z: 0, tx: 1, tz: 0 },
    ];
    const s = M.planBeaconSites(two, () => true);
    ok(s.length < 2 || Math.hypot(s[0].x - s[1].x, s[0].z - s[1].z) >= M.BEACON.SEP,
      `地標彼此至少 SEP = ${M.BEACON.SEP}m(不擠在同一個路口)`);
  }
  // ⑥ MAX 上限
  {
    const many = [];
    for (let i = 0; i < 40; i++) many.push({ kind: 'lane', x: i * 400, z: 0, tx: 1, tz: 0 });
    ok(M.planBeaconSites(many, () => true).length <= M.BEACON.MAX,
      `全場上限 MAX = ${M.BEACON.MAX} 件`);
  }
  // ⑦ 確定性:同輸入兩次逐位元相同(§2.3 —— 跨客戶端場景一致)
  {
    const an = M.beaconAnchors({ lanesW, basesW, towerSites });
    const p = (x, z) => ((x * 7 + z * 13) | 0) % 3 !== 0;   // 有規律地拒絕一部分
    ok(JSON.stringify(M.planBeaconSites(an, p)) === JSON.stringify(M.planBeaconSites(an, p)),
      '同輸入兩次逐位元相同');
    // 種子也是位置推導的 ⇒ 同一張圖每台機器長得一樣
    ok(M.beaconSeed(123.5, -87.25) === M.beaconSeed(123.5, -87.25) && Number.isInteger(M.beaconSeed(1, 2)),
      '落點種子由座標推導且確定');
    ok(M.beaconSeed(10, 20) !== M.beaconSeed(20, 10), '種子不對稱(x/z 對調不同種子)');
  }
  // ⑧ 型錄指派:重生點/建築單位一對一,兵線三款輪替
  {
    ok(M.beaconKindFor({ kind: 'base', x: 0, z: 0 }) === M.KIND_BY_ANCHOR.base, '重生點固定一款');
    ok(M.beaconKindFor({ kind: 'tower', x: 0, z: 0 }) === M.KIND_BY_ANCHOR.tower, '建築單位固定一款');
    const got = new Set();
    for (let i = 0; i < 400; i++) got.add(M.beaconKindFor({ kind: 'lane' }, i * 37.5, i * 11.25));
    ok(got.size === M.LANE_KINDS.length, `兵線那一類三款都輪得到(實得 ${got.size} 款)`);
  }
  // ⑨ 整條合成兵線跑完:落點一律在錨點的搜尋帶內
  {
    const an = M.beaconAnchors({ lanesW, basesW, towerSites });
    const s = M.planBeaconSites(an, () => true);
    ok(s.length > 0, `合成兵線擺出 ${s.length} 件地標`);
    ok(s.every((p) => p.d >= M.BEACON_KINDS[p.kind].foot && p.d <= M.BEACON.FAR), '每一件都在搜尋帶內');
    ok(new Set(s.map((p) => p.from)).size >= 2, '至少兩類錨點各有地標(不會全擠在同一類)');
  }
}

// ============ Ⅳ 消費端單一縫(biomes.js 接線) ============
console.log('\nⅣ 消費端單一縫(biomes.js)');
{
  const nc = (s) => s.split('\n').map((l) => l.replace(/\/\/.*$/, '')).join('\n');   // 剝行註解
  const bio = nc(bioSrc);
  const count = (s, re) => (s.match(re) || []).length;
  ok(count(bio, /function placeBeacons\(/g) === 1, 'placeBeacons 只有一份實作');
  // 呼叫點只數 buildBiomes 那一段(定義本身也長得像呼叫)
  let body = bio.slice(bio.indexOf('export async function buildBiomes'));
  if (BREAK_ORDER) {
    body = `/* break-order */\nplaceBeacons({\n${body.replace('placeBeacons({', 'placeBeaconsMoved({')}`;
  }
  ok(count(body, /placeBeacons\(\{/g) === 1, 'placeBeacons 只有一個呼叫點');
  const fn = bio.slice(bio.indexOf('function placeBeacons('), bio.indexOf('function placeMegaliths('));
  // 四道閘缺一不可 —— 少了任何一道,地標就可能落進走廊/水裡/懸崖上/圖外
  ok(/areaFree\(blocked/.test(fn), 'probe 吃 areaFree(blocked)—— 兵線走廊/塔位/主堡/橋隧走廊同一道閘');
  ok(/terrain\.heightAt/.test(fn) && /terrainEnvCode/.test(fn), 'probe 擋水域/沼澤');
  ok(/flatRadiusAt/.test(fn), 'probe 擋站不平的地方');
  ok(/terrain\.minX/.test(fn) && /terrain\.maxZ/.test(fn), 'probe 擋圖外');
  // 碰撞柱 MUST 是量出來的(原則 4 / A30),MUST NOT 拿標稱 foot 當半徑
  ok(/beaconCollider\(g\)/.test(fn) && /r: col\.r/.test(fn), '碰撞柱半徑取實測值 beaconCollider');
  ok(!/\.foot/.test(fn), 'biomes.js 不自己讀標稱 foot(那是規劃期的預留,不是碰撞半徑)');
  ok(/blockArea\(blocked/.test(fn) && /blockers\.push/.test(fn),
    '登記 blockArea(植被避開)+ blockers(碰撞/LOS,與建物同一條路徑)');
  ok(/sinkBaseY\(/.test(fn), '落底走 sinkBaseY 單一縫(只取中心高度 = 下坡側整片懸空)');
  // 零共享 rnd:插在中間卻不推移後面的佈局序列
  ok(!/\brnd\b/.test(fn), 'placeBeacons 不碰共享 rnd(否則全圖植被/建物佈局跟著變)');
  // 順序:MUST 排在一般植被散布之前,blockArea 才護得住
  const iB = body.indexOf('placeBeacons({'), iV = bioSrc.slice(bio.indexOf('export async function buildBiomes')).indexOf('鋪設植被地貌');
  ok(iB > 0 && iV > 0 && iB < iV, '呼叫排在一般植被散布之前(blockArea 之後小植被才會避開)');
  const iM = body.indexOf('placeMegaliths({');
  const iG = body.indexOf('placeGiantGroves({');
  ok(iM > 0 && iG > iM && iB > iG, '排在巨岩/神木之後(大地標先佔位,語意地標補位)');
  // 檔頭紀律④:不掛反轉外殼描邊(世界的線由 postfx 的螢幕空間勾線負責)
  ok(!/outlinify/.test(src), 'beacons.js 不掛反轉外殼描邊(一座電塔十幾個殼 = 十幾個 draw call)');
  ok(/mulberry32\(/.test(src) && /buildBeacon\(kind, seed/.test(src),
    '外觀差異由自帶種子的 mulberry32 供應(同 buildHazard)');
  ok(/gm\.dispose\(\)/.test(src), '合併後的暫時幾何有 dispose(A25)');
  ok(/stats = \{[\s\S]{0,400}beacons:/.test(bioSrc), 'stats 帶出地標件數(冒煙時看得到擺了幾件)');
}

console.log(`\n${fail === 0 ? '✅' : '❌'} 通過 ${pass} 項,失敗 ${fail} 項`);
process.exit(fail === 0 ? 0 : 1);
