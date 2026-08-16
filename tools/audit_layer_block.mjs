// ============ 塗層雙面阻擋稽核(地形 / 橋面 / 隧道頂板・路面 / 障礙盒)============
// 用途:規則「地形與馬路等塗層,上下之間 MUST 遵守物理碰撞 —— 往上往下都要擋住砲火,
//       透明可穿透處例外」(使用者 2026-07-30 定案)+「明隧道天花板無法從上面踩,跟橋面
//       一樣需要遵守物理碰撞法則,不可穿越或穿透攻擊;隧道和地下道的天花板也同樣需要遵守」
//       (使用者 2026-08-03 定案)的離線防線。
//
// 一句話定義「塗層」:任何把上方空間與下方空間隔開的實體面 —— 地形高度場、橋面板、
// 隧道頂板、隧道路面、建物/巨物的頂面與底面。它們共通的 MUST:
//   ① **雙面**:由上往下、由下往上穿過同一片面都要截斷,MUST NOT 只擋一個方向;
//   ② **透明例外**:看得穿的地方(punchPortalHoles 打掉的三角形 = 洞口、地下道引道
//      露天路塹 open 段)兩個方向一律放行 —— 看得到就打得到(A29 / A6);
//   ③ **擋得住 = 站得上去**:能截斷砲火的那一面同時是站立面(橋面 `deckY`、隧道頂板
//      `tunRoofTop`)—— 只做其中一半就是「打不穿卻踩得穿」的破圖(Ⅴ 的前科)。
//
// 為什麼會漏(三種前科,本稽核逐條釘住):
//   Ⅰ 薄板只寫了天花沒寫路面 —— 洞內朝地面開火的彈頭穿過馬路鑽進岩盤(地形解析射線在
//     山體內側找不到交點),一路飛到山腹另一側才炸。
//   Ⅱ 障礙盒的頂面判定加掛 `dy < 0`(只擋自上而下)+ 只驗「入點高度」—— 由下往上穿過
//     樓體的射線整條漏放;伺服器 `_losBlocked` 一向是「穿越區間 ∩ [0,h]」語意 ⇒ 客戶端
//     算命中、伺服器算被擋 = 傷害靜默蒸發(A30 兩端 MUST 同橫斷面)。
//   Ⅲ 地形用 `p.y <= heightAt(p.x, p.z)` 當彈道閘 —— 那問的是「在地表以下」不是「穿過
//     地表」:由下往上整條漏放,且 heightAt 不吃打洞(覆蓋段山體高度原封不動)⇒ 洞口/
//     洞內成了看得見卻打不穿的隱形山體(在隧道裡開火 = 彈體在槍口原地就炸)。
//   Ⅳ 爆點拿 `heightAt` 當地面 —— 覆蓋段山體高度沒被開挖,洞內爆點被抬到山頂:爆炸畫在
//     山上、離地高歸 1、lev 掉回 0 ⇒ 洞內單位被 sim `_slabSep` 判成板體另一側 = 整發榴彈
//     打在洞裡卻零傷害。Ⅰ 補上路面之後彈頭才真的會停在隧道路面上,這條才成為熱路徑。
//   Ⅴ 天花板只做了「擋彈道」沒做「站立面」—— 深埋隧道看不出來(頭頂那座山本來就高過頂板,
//     `heightAt` 自己接住了),**明隧道**的頂板卻是露在地形之外的結構物:從山坡走過去,
//     `surfaceAt` 回的是被 `carveGalleryBands` 挖到路面高的側坡 ⇒ 整台機體穿過看得見的
//     頂板掉進洞裡(2026-08-03 使用者回報「明隧道天花板無法從上面踩」)。修法 = 頂板頂面
//     `tunRoofTop(ceil)` 同時當站立面與彈道板體上界,與橋面 `deckY` 逐條對稱。
//
// 為什麼用「抽原文」而不是 import:`game.js` 的 three 走 CDN importmap,Node 端解析不了;
// 抽出來評估的仍是**真正的程式碼文字**(另抄一份公式就永遠會通過)。每一段可執行斷言
// 都自帶反向對照:把判定改回壞版,對應條目 MUST 立刻紅字。
// 跑法:`node tools/audit_layer_block.mjs`
// 退出碼:0 = 全綠;1 = 有紅字
//
// ---- 接縫紀律:「無主的門檻」(2026-08-16 併入,`docs/anime_style_plan.md` ④-4;純註解,零斷言改動)----
// 本支的核心不變量(**站得上去 = 擋得住砲火**,兩端 MUST 同一個面)與參考專案記錄過的
// 那一族接縫陷阱是同一條規則的兩種寫法。既有的 Ⅴ 段已經在守「頂面」那一半;
// 這裡補上它的孿生症狀,今天**沒有斷言**在守:
//
//  ㋐ **一個區域的平台停在哪裡,下一個區域的就 MUST 從哪裡開始。** 症狀:*玩家在兩塊結構的
//     交界處掉到自然地面,而且掉下去就上不來*。成因不是誰寫錯了 —— 是**兩個模組各自正確地
//     結束了自己的工作**,中間留下一段沒有人負責的門檻(參考專案實測:0.6 m 的無主門檻
//     = 掉落 1.79 m)。本專案的三個落點:橋面板 ⇄ 引道、隧道頂板 ⇄ 地形、明隧道 open 段 ⇄
//     覆蓋段。前兩者今天靠 `surfaceAt` 取 `max(地形, roof)` 與 `deckAt` 的重疊擋著,
//     第三者靠 A29 ④ 的「覆蓋區間逐點全寬重驗」。⇒ **改任一端的邊界條件時,
//     MUST 問「另一端有沒有跟著長出去」**,而不是只問「我這一端對不對」。
//  ㋑ **抓得到它的是泛洪不是人。** 高度查詢在平台邊界上是排他的 ⇒ 落在接縫上的查詢
//     兩塊都不匹配、回傳原始地面高;真人幾乎不會恰好踩在那條線上,而
//     `audit_traverse` 的 0.35 m 泛洪格**每一次都踩得到**。⇒ 本支紅字與通行稽核紅字
//     是同一件事的兩端,MUST NOT 因為「玩起來沒事」就把它當誤報。
//     (本支只驗規則的形狀;真的走過去試的是 `audit_traverse`,那一支需要外網 ㋓。)
import { readSrc } from './audit_src.mjs';

// 讀原文一律走 `readSrc`(§5 通則 ㋑;換行正規化成 LF)——
// 工作副本在 Windows 上是 CRLF,方法尾端的 `\n  }` 比對會整組失手
const read = (f) => readSrc('public', 'js', f);
const G = read('game.js');
const M = read('main.js');
const B = read('biomes.js');

let pass = 0, fail = 0;
const ok = (c, msg) => { c ? pass++ : (fail++, console.error(`  ✗ ${msg}`)); };

/** 抽 game.js 的類別方法原文(2 空格縮排 → 首個 `\n  }` 收尾);src 可換成改壞的副本 */
function pickMethod(name, src = G) {
  const P0 = src.indexOf(`\n  ${name}(`);
  if (P0 < 0) throw new Error(`game.js 找不到 ${name}`);
  const P1 = src.indexOf('\n  }\n', P0);
  if (P1 < 0) throw new Error(`game.js ${name} 收尾解析失敗`);
  return new Function(`return function ${name}${src.slice(P0 + 3 + name.length, P1 + 4)}`)();
}

// ---------------- 測試地景(純資料樁,不抄 biomes/main 的任何公式)----------------
// 隧道:沿 +X 由 x=0 到 x=100、z=0、半寬 9,路面 100 / 天花底面 108 / 頂板頂面 109(板厚 1)。
// 橋樑:沿 +X 由 x=0 到 x=100、z=200、半寬 8,橋面 150(板厚 deckUnder=1.2)。
const TUN = { x0: 0, x1: 100, hw: 9, floor: 100, ceil: 108, roof: 109 };
const DECK = { z: 200, x0: 0, x1: 100, hw: 8, y: 150 };
const tunnelAt = (open) => (x, z) =>
  (x >= TUN.x0 && x <= TUN.x1 && Math.abs(z) <= TUN.hw
    ? { floor: TUN.floor, ceil: TUN.ceil, roof: TUN.roof, open } : null);
const deckY = (x, z) =>
  (x >= DECK.x0 && x <= DECK.x1 && Math.abs(z - DECK.z) <= DECK.hw ? DECK.y : null);
const slabEnv = (open = false, src = G) => ({
  terrain: { tunnelAt: tunnelAt(open), deckY, deckUnder: 1.2 },
  _slabHitT: pickMethod('_slabHitT', src),
});
const slabBlocked = (env, a, b) => env._slabHitT.call(env, a[0], a[1], a[2], b[0], b[1], b[2]) != null;

console.log('== 塗層雙面阻擋稽核 ==');

console.log('\n=== Ⅰ 水平薄板(_slabHitT):橋面 / 隧道天花 / 隧道路面 ===');
{
  const env = slabEnv(false);
  // 洞內:天花與路面之間的空腔 MUST 通(隧道兵線正常對射)
  ok(!slabBlocked(env, [10, 103, 0], [90, 103, 0]), 'Ⅰ 洞內水平對射(路面↔天花之間)MUST 通');
  ok(!slabBlocked(env, [10, 103, 0], [90, 106, 0]), 'Ⅰ 洞內微仰射(仍在空腔內)MUST 通');
  // 天花:兩個方向
  ok(slabBlocked(env, [50, 103, 0], [50, 120, 0]), 'Ⅰ 洞內往上打天花 MUST 擋');
  ok(slabBlocked(env, [50, 120, 0], [50, 103, 0]), 'Ⅰ 山體上方往下打進洞裡 MUST 擋(穿天花)');
  // 頂板是**有厚度的板體** [ceil, roof](2026-08-03「跟橋面一樣…不可穿透攻擊」):與橋面
  // [deckY − deckUnder, deckY] 同語意 —— 板體內部與擦邊都算穿越,板體之外(頂板上/洞內)才通
  ok(slabBlocked(env, [10, 108.5, 0], [90, 108.5, 0]),
    'Ⅰ 射線整條走在頂板板體內 MUST 擋(只驗「跨過天花底面」的舊制會整條漏放)');
  ok(slabBlocked(env, [10, 109.5, 0], [90, 108.2, 0]),
    'Ⅰ 站在頂板上朝洞口低伸、削過頂板 MUST 擋 —— 這正是「從上面穿透攻擊」那一發');
  ok(!slabBlocked(env, [10, 112, 0], [90, 112, 0]), 'Ⅰ 頂板上方水平對射 MUST 通(站頂板上互射)');
  ok(slabBlocked(env, [50, 112, 0], [50, 103, 0]), 'Ⅰ 站頂板上往下打洞內 MUST 擋(穿整塊頂板)');
  ok(slabBlocked(env, [50, 103, 0], [50, 112, 0]), 'Ⅰ 洞內往上打站頂板上的人 MUST 擋(雙面)');
  // 路面:兩個方向 —— 舊制只寫天花,這兩條是本次規則的核心
  ok(slabBlocked(env, [50, 103, 0], [50, 92, 0]), 'Ⅰ 洞內往下打路面 MUST 擋(漏判 = 彈頭穿馬路鑽岩盤)');
  ok(slabBlocked(env, [50, 92, 0], [50, 103, 0]), 'Ⅰ 路面底下往上打 MUST 擋(雙面)');
  // 洞外橫向掠過(不在 ribbon 上)MUST 通
  ok(!slabBlocked(env, [50, 103, 40], [50, 92, 40]), 'Ⅰ 隧道 ribbon 外的上下射擊 MUST 通(不誤擋)');

  // open 段(地下道引道露天路塹):頭上是天空、腳下就是地形本體 ⇒ 天花與路面皆 MUST 放行(A29)
  const envOpen = slabEnv(true);
  ok(!slabBlocked(envOpen, [50, 103, 0], [50, 120, 0]), 'Ⅰ open 段 MUST NOT 有隱形天花(A29)');
  ok(!slabBlocked(envOpen, [50, 103, 0], [50, 92, 0]), 'Ⅰ open 段 MUST NOT 有隱形路面(A29;看得到就打得到)');

  // 橋面板:上下穿越擋、同側平射通
  ok(slabBlocked(env, [50, 153, 200], [50, 140, 200]), 'Ⅰ 橋上往下打橋面 MUST 擋');
  ok(slabBlocked(env, [50, 140, 200], [50, 153, 200]), 'Ⅰ 橋下往上打橋面 MUST 擋');
  ok(!slabBlocked(env, [10, 153, 200], [90, 153, 200]), 'Ⅰ 橋面上水平對射 MUST 通');
  ok(!slabBlocked(env, [10, 140, 200], [90, 140, 200]), 'Ⅰ 橋下水平對射 MUST 通');

  // 反向對照:拿掉路面那一項 ⇒ 兩條路面斷言 MUST 立刻失效(證明真的驗到)
  const noFloor = G.replace('\n                || (yHi !== yLo && (py - tn.floor) * (y - tn.floor) <= 0)', '');
  ok(noFloor !== G, 'Ⅰ 反向對照:找得到路面判定原文(改名了就 MUST 同步改本稽核)');
  const envNF = slabEnv(false, noFloor);
  ok(!slabBlocked(envNF, [50, 103, 0], [50, 92, 0]) && !slabBlocked(envNF, [50, 92, 0], [50, 103, 0]),
    'Ⅰ 反向對照:拿掉路面項 MUST 讓「洞內往下 / 路面底下往上」雙雙漏放');
  // 反向對照:頂板板體退回舊制的「只跨過天花底面」單面 ⇒ 板體內/擦邊那兩發 MUST 立刻漏放,
  // 而「洞內往上 / 上方往下」仍照擋(證明差異單獨落在**板厚**這一維,不是整組失效)
  const thin = G.replace('(yLo <= tn.roof && yHi >= tn.ceil)', '(yHi !== yLo && (py - tn.ceil) * (y - tn.ceil) <= 0)');
  ok(thin !== G, 'Ⅰ 反向對照:找得到頂板板體判定原文');
  const envT = slabEnv(false, thin);
  ok(!slabBlocked(envT, [10, 108.5, 0], [90, 108.5, 0]) && !slabBlocked(envT, [10, 109.5, 0], [90, 108.2, 0]),
    'Ⅰ 反向對照:頂板退回零厚度 MUST 讓「板體內 / 擦邊削過」雙雙漏放');
  ok(slabBlocked(envT, [50, 103, 0], [50, 120, 0]) && slabBlocked(envT, [50, 120, 0], [50, 103, 0]),
    'Ⅰ 反向對照:零厚度版仍擋「洞內往上 / 上方往下」(差異單獨落在板厚這一維)');
}

console.log('\n=== Ⅱ 障礙橫斷面(_blockerHitT):側面 / 頂面 / 底面不分方向 ===');
{
  // 40×40 見方、基座 y=19、高 60 ⇒ 垂直帶 [18.5, 79]
  const box = [{ x: 0, z: 0, y: 19, h: 60, hw2: 20, hd2: 20, ry: 0, r: Math.hypot(40, 40) / 2 }];
  const mk = (src = G) => {
    const self = { _blockGrid: pickMethod('_buildBlockGrid', src).call({}, box) };
    const fn = pickMethod('_blockerHitT', src);
    return (a, b) => fn.call(self, a[0], a[1], a[2], b[0], b[1], b[2]) != null;
  };
  const hit = mk();
  ok(hit([-30, 30, 0], [30, 30, 0]), 'Ⅱ 側面水平穿越 MUST 擋');
  ok(hit([0, 120, 0], [0, 40, 0]), 'Ⅱ 正上方垂直往下打頂面 MUST 擋');
  ok(hit([0, 0, 0], [0, 120, 0]), 'Ⅱ 正下方垂直往上打底面 MUST 擋');
  ok(hit([-30, 0, 0], [30, 90, 0]), 'Ⅱ 由下往上斜穿樓體 MUST 擋(入點在盒底之下,舊制整條漏放)');
  ok(hit([-30, 90, 0], [30, 0, 0]), 'Ⅱ 由上往下斜穿樓體 MUST 擋(同一條線反向,結果 MUST 對稱)');
  ok(!hit([-30, 90, 0], [30, 90, 0]), 'Ⅱ 全程高過樓頂 MUST 通');
  ok(!hit([-30, 10, 0], [30, 10, 0]), 'Ⅱ 全程低於盒底 MUST 通(不誤擋)');
  ok(!hit([-30, 30, 60], [30, 30, 60]), 'Ⅱ 盒外側向 MUST 通(不誤擋)');

  // 反向對照:把垂直帶判定加回 `dy < 0`(只擋自上而下)⇒ 由下往上那兩條 MUST 立刻漏放
  const oneWay = G.replace('if (dy > 1e-6 || dy < -1e-6) {', 'if (dy < -1e-6) {');
  ok(oneWay !== G, 'Ⅱ 反向對照:找得到方向無關的垂直帶判定原文');
  const hitOW = mk(oneWay);
  ok(!hitOW([0, 0, 0], [0, 120, 0]) && !hitOW([-30, 0, 0], [30, 90, 0]),
    'Ⅱ 反向對照:退回單向(dy<0)MUST 讓「由下往上」雙雙漏放');
  ok(hitOW([-30, 30, 0], [30, 30, 0]) && hitOW([0, 120, 0], [0, 40, 0]),
    'Ⅱ 反向對照:單向版仍擋側面/頂面(證明差異單獨落在「往上」這一維)');
}

console.log('\n=== Ⅲ 地形高度場:解析射線唯一縫,MUST NOT 退回單面 heightAt ===');
{
  ok(!/\.y <= this\.terrain\.heightAt\(/.test(G),
    'Ⅲ MUST NOT 以 `y <= terrain.heightAt(x,z)` 當彈道閘 —— 那是「在地表以下」不是「穿過地表」'
    + '(由下往上漏放 + 不吃打洞 ⇒ 洞口變隱形山體)');
  const seg = pickMethod('_terrainSegT');
  ok(/this\._terrainHitT\(/.test(seg.toString()),
    'Ⅲ _terrainSegT MUST 走 _terrainHitT(rayTerrain 唯一縫,MUST NOT 另開第二條地形射線)');
  const layer = pickMethod('_layerHitT').toString();
  ok(/this\._terrainSegT\(/.test(layer) && /this\._obstHitT\(/.test(layer),
    'Ⅲ _layerHitT MUST = 地形 ∪ 障礙/薄板(取較近),兩者缺一即有一種塗層不擋彈');
  // 消費端:表現層彈體與榴彈瞄準虛線 MUST 吃同一支(舊制各寫一份 heightAt 判定)
  for (const [m, why] of [['_updateVisShells', '他人/bot 視覺彈體'], ['_arcTrace', '榴彈瞄準虛線/火控驗證']]) {
    ok(/this\._layerHitT\(prev\.x, prev\.y, prev\.z/.test(pickMethod(m).toString()),
      `Ⅲ ${m}(${why})MUST 走 _layerHitT`);
  }
  // 只有 rayTerrain 吃得到 punchPortalHoles 的 triDead;heightAt 不吃 ⇒ 透明例外只能由它成立
  ok(/triDead/.test(read('terrain.js')),
    'Ⅲ terrain.js MUST 保留 triDead(打洞記帳)—— 洞口的「透明可穿透例外」唯一來源');
}

console.log('\n=== Ⅳ 爆點的離地基準面與結構層(彈頭現在真的會停在隧道路面上)===');
{
  // 覆蓋段的地形高度沒被開挖 ⇒ heightAt 是頭頂那座山,不是腳下的路面。
  ok(/const gy = inTun \? btn\.floor : this\.terrain\.heightAt\(p\.x, p\.z\);/.test(G),
    'Ⅳ 爆點基準 MUST 在洞內改取隧道路面 —— 拿 heightAt 會把爆點抬到山頂'
    + '(爆炸畫在山上、離地高歸 1、lev 掉 0 ⇒ 洞內單位被 _slabSep 判成板體另一側 = 零傷害)');
  ok(/const inTun = !!\(btn && !btn\.open && p\.y < btn\.ceil\);/.test(G),
    'Ⅳ 爆點洞內判定 MUST 濾 open(露天路塹腳下就是地形本體,照走 heightAt;A29)');
  // 橋面刻意不報 lev 1:伺服器 _unitLev 讓塔/主堡恆為 0,報 1 = 橋上砲塔對 AoE 完全免傷
  ok(/lev: inTun \? 2 : 0/.test(G),
    'Ⅳ 爆點 lev MUST 只報 0/2 —— 橋面報 1 會讓橋上砲塔被 _slabSep 判成板體另一側 = AoE 免傷(刻意設計)');
  const sim = readSrc('server', 'sim.js');
  ok(/if \(e\.kind === 'tower' \|\| e\.kind === 'base'\) return 0;/.test(sim),
    'Ⅳ 上述「刻意不報 1」的前提 = sim._unitLev 讓塔/主堡恆為 lev 0(前提變了 MUST 重審這條)');
}

console.log('\n=== Ⅴ 隧道頂板頂面 = 可站立結構面(擋得住 = 站得上去)===');
{
  // ---- 單一縫:頂板頂面只有 tunRoofTop 一份定義,三個消費端全吃它 ----
  const defs = B.match(/^const tunRoofTop = .*$/gm) || [];
  ok(defs.length === 1, `Ⅴ biomes.js 的 tunRoofTop MUST 只有一份定義(找到 ${defs.length} 份)`);
  ok(/const tunRoofTop = \(cy\) => cy \+ TUN\.ROOF_T;/.test(B),
    'Ⅴ tunRoofTop MUST = 天花底面 + TUN.ROOF_T(板厚走旋鈕,MUST NOT 手寫數字)');
  // 消費端:外露頂板頂面 / 柱頂 / 站立+彈道索引 —— 任一處手寫 `+ TUN.ROOF_T` = 看到的頂面
  // 與踩得到的頂面分家(玩家踩在頂板上方一截的空氣裡,或整個人陷進頂板裡)
  for (const [re, why] of [
    [/const topAt = \(i\) => tunRoofTop\(ceilOf\(cum\[i\]\)\);/, '明隧道外露頂板 galRoof 的頂面'],
    [/y1: tunRoofTop\(ceilOf\(cum\[i\]\)\),/, '明隧道柱列 galCols 的柱頂'],
    [/roof: tunRoofTop\(ceil\)/, '站立/彈道索引 makeTunnelIndex 的 roof'],
  ]) ok(re.test(B), `Ⅴ ${why} MUST 走 tunRoofTop 單一縫`);
  // 頂板頂面之外的 `+ TUN.ROOF_T` 只准出現在「地表藏不藏得住頂板」的**門檻**式(語意不同)。
  // 逐行剝註解才數 —— 註解裡提到的名字算進來就永遠對不上(㋑ 的 CRLF/註解前科同一族)
  const code = B.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\*.*$/gm, '').replace(/\/\/.*$/gm, '');
  const stray = (code.match(/\+ TUN\.ROOF_T/g) || []).length;
  const thresh = (code.match(/TUN\.CLEAR \+ TUN\.ROOF_T/g) || []).length;
  ok(stray === thresh + 1,
    `Ⅴ 除了 tunRoofTop 的定義與覆蓋門檻式,MUST NOT 再有手寫的 + TUN.ROOF_T(${stray} vs ${thresh}+1)`);

  // ---- 行為:執行 main.js 真正的 surfaceAt 原文 ----
  const num = (name, src = M) => {
    const m = new RegExp(`const ${name} = ([\\d.]+);`).exec(src);
    if (!m) throw new Error(`main.js 找不到 ${name}`);
    return +m[1];
  };
  const K = { DECK_STEP: num('DECK_STEP'), DECK_MARGIN: num('DECK_MARGIN'),
    DECK_UNDER: num('DECK_UNDER'), MAX_MECH_H: num('MAX_MECH_H'), BLK_MARGIN: num('BLK_MARGIN') };
  const mkSurf = (heightAt, tunAt, src = M) => {
    const P0 = src.indexOf('    terrain.surfaceAt = (x, z, curY) => {');
    const P1 = src.indexOf('\n    };', P0);
    if (P0 < 0 || P1 <= P0) throw new Error('main.js 找不到 surfaceAt(結構已變?)');
    const keys = ['heightAt', 'tunnelAt', 'deckY', 'blockerTop', ...Object.keys(K)];
    return new Function(...keys,
      `const terrain = { heightAt };\n${src.slice(P0, P1 + 7)}\nreturn terrain.surfaceAt;`)(
      heightAt, tunAt, () => null, () => null, ...Object.keys(K).map((k) => K[k]));
  };
  // 明隧道:頂板露在地形之外(側坡被 carveGalleryBands 挖到路面高)
  const GAL_H = TUN.floor + 1;                       // 洞外側坡地表(遠低於頂板 109)
  const galSurf = (src = M) => mkSurf(() => GAL_H, tunnelAt(false), src);
  {
    const s = galSurf();
    ok(s(50, 0, TUN.roof) === TUN.roof, 'Ⅴ 明隧道:站在頂板頂面 MUST 回頂板(舊制回側坡地表 = 踩空掉進洞裡)');
    ok(s(50, 0, TUN.roof + 6) === TUN.roof, 'Ⅴ 明隧道:自上方落下 MUST 落在頂板上(不是穿過去)');
    ok(s(50, 0, TUN.ceil + 0.2) === TUN.roof, 'Ⅴ 陷進板體內 MUST 被抬回頂面(板體 [ceil, roof] 塞不下人)');
    ok(s(50, 0, TUN.floor + 2) === TUN.floor, 'Ⅴ 洞內(curY < ceil)MUST 仍站路面 —— MUST NOT 被吸到頂板上');
    ok(s(50, 40, TUN.roof) === GAL_H, 'Ⅴ ribbon 外(側坡上)MUST 照踩地表(頂板不外溢成隱形平台)');
    ok(s(50, 0, null) === GAL_H, 'Ⅴ curY 省略(貼地渲染查詢)MUST 維持裸地形語意');
  }
  // 深埋山體隧道 / 地下道:覆蓋門檻本來就要求地表 ≥ 頂板頂面 ⇒ 取 max 後恆是地形,逐位元不變
  {
    const H = TUN.roof + 21;
    const s = mkSurf(() => H, tunnelAt(false));
    ok(s(50, 0, H) === H, 'Ⅴ 深埋隧道:頂上走的仍是山體地表(MUST NOT 在山坡上長出隱形平台)');
  }
  // open 段(地下道引道露天路塹):頭上是天空,沒有頂板可站(A29)
  {
    const s = mkSurf(() => GAL_H, tunnelAt(true));
    ok(s(50, 0, TUN.roof) === GAL_H, 'Ⅴ open 段 MUST NOT 有可站的隱形頂板(A29;露天溝頭上是天空)');
  }
  // 反向對照:拿掉頂板站立面那一行 ⇒ 明隧道那組 MUST 立刻掉回側坡地表(= 使用者回報的踩空),
  // 而深埋/洞內/open 三組不動(證明差異單獨落在「頂板露出地形之外」這一種地形上)
  const noRoof = M.replace('      if (tn && !tn.open && tn.roof > s) s = tn.roof;\n', '');
  ok(noRoof !== M, 'Ⅴ 反向對照:找得到頂板站立面原文(改名了就 MUST 同步改本稽核)');
  {
    const s = galSurf(noRoof);
    ok(s(50, 0, TUN.roof) === GAL_H && s(50, 0, TUN.roof + 6) === GAL_H,
      'Ⅴ 反向對照:拿掉頂板站立面 MUST 讓明隧道整組踩空(頂板變成看得見卻踩不到的貼圖)');
    ok(s(50, 0, TUN.floor + 2) === TUN.floor,
      'Ⅴ 反向對照:洞內站路面不受影響(差異單獨落在「天花之上」那一側)');
  }
}

console.log(`\n${fail ? '✗' : '✓'} 塗層雙面阻擋:${pass} 通過 / ${fail} 失敗`);
process.exit(fail ? 1 : 0);
