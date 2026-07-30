// ============ 塗層雙面阻擋稽核(地形 / 橋面 / 隧道天花・路面 / 障礙盒)============
// 用途:規則「地形與馬路等塗層,上下之間 MUST 遵守物理碰撞 —— 往上往下都要擋住砲火,
//       透明可穿透處例外」(使用者 2026-07-30 定案)的離線防線。
//
// 一句話定義「塗層」:任何把上方空間與下方空間隔開的實體面 —— 地形高度場、橋面板、
// 隧道天花、隧道路面、建物/巨物的頂面與底面。它們共通的 MUST:
//   ① **雙面**:由上往下、由下往上穿過同一片面都要截斷,MUST NOT 只擋一個方向;
//   ② **透明例外**:看得穿的地方(punchPortalHoles 打掉的三角形 = 洞口、地下道引道
//      露天路塹 open 段)兩個方向一律放行 —— 看得到就打得到(A29 / A6)。
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
//
// 為什麼用「抽原文」而不是 import:`game.js` 的 three 走 CDN importmap,Node 端解析不了;
// 抽出來評估的仍是**真正的程式碼文字**(另抄一份公式就永遠會通過)。每一段可執行斷言
// 都自帶反向對照:把判定改回壞版,對應條目 MUST 立刻紅字。
// 跑法:`node tools/audit_layer_block.mjs`
// 退出碼:0 = 全綠;1 = 有紅字
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
// 換行一律正規化成 LF:工作副本在 Windows 上是 CRLF,方法尾端的 `\n  }` 比對會整組失手
const read = (f) => readFileSync(join(ROOT, 'public', 'js', f), 'utf8').replace(/\r\n/g, '\n');
const G = read('game.js');

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
// 隧道:沿 +X 由 x=0 到 x=100、z=0、半寬 9,路面 100 / 天花 108。
// 橋樑:沿 +X 由 x=0 到 x=100、z=200、半寬 8,橋面 150(板厚 deckUnder=1.2)。
const TUN = { x0: 0, x1: 100, hw: 9, floor: 100, ceil: 108 };
const DECK = { z: 200, x0: 0, x1: 100, hw: 8, y: 150 };
const tunnelAt = (open) => (x, z) =>
  (x >= TUN.x0 && x <= TUN.x1 && Math.abs(z) <= TUN.hw
    ? { floor: TUN.floor, ceil: TUN.ceil, open } : null);
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
  const noFloor = G.replace(' || (py - tn.floor) * (y - tn.floor) <= 0', '');
  ok(noFloor !== G, 'Ⅰ 反向對照:找得到路面判定原文(改名了就 MUST 同步改本稽核)');
  const envNF = slabEnv(false, noFloor);
  ok(!slabBlocked(envNF, [50, 103, 0], [50, 92, 0]) && !slabBlocked(envNF, [50, 92, 0], [50, 103, 0]),
    'Ⅰ 反向對照:拿掉路面項 MUST 讓「洞內往下 / 路面底下往上」雙雙漏放');
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
  const sim = readFileSync(join(ROOT, 'server', 'sim.js'), 'utf8');
  ok(/if \(e\.kind === 'tower' \|\| e\.kind === 'base'\) return 0;/.test(sim),
    'Ⅳ 上述「刻意不報 1」的前提 = sim._unitLev 讓塔/主堡恆為 lev 0(前提變了 MUST 重審這條)');
}

console.log(`\n${fail ? '✗' : '✓'} 塗層雙面阻擋:${pass} 通過 / ${fail} 失敗`);
process.exit(fail ? 1 : 0);
