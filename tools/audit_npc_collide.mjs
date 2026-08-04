// ============ NPC 飛行高度基準 / NPC ⇄ 機體實體碰撞稽核 ============
// 用途:2026-08-04 使用者回報兩件事的離線防線 ——
//   ①「有時候 NPC 飛行單位在橋上會越飛越低」
//   ②「NPC 與機體之間的物理碰撞不要破圖」
//
// ── ① 飛行體的高度基準面 ─────────────────────────────────────────────
// 病灶:飛行體的貼地渲染沿用了**地面**單位那條逐幀棘輪 —— `surfaceAt(x, z, curY)` 靠「上一幀
// 的高度」消歧「我在橋上還是橋下」,而飛行體的 curY 種子是 `cur.y − heroY`。兵線擁擠時
// `sim._advance` 的側推會把直升機推出橋面足跡一次(`deckY` 回 null)⇒ 種子掉回橋下的河床,
// 之後上橋的兩個條件再也不成立(距橋面 > `DECK_STEP`、橋腹淨空又 ≥ 最大機體)⇒ 基準面**永久**
// 停在河床:直升機從此貼著谷底飛、穿過橋面板。棘輪是單向的,所以症狀是「越飛越低」而不是抖動。
// 修法:飛行體改吃 `_flySurf(x, z)` = **座標的純函式**(地表 ∪ 橋面 ∪ 隧道頂板取最高)——
// 沒有狀態就沒有回不去的狀態。本段的核心斷言因此是**路徑無關性**:同一個座標,不管之前
// 從哪裡飛過來,高度逐位元相同(舊制在同一條路徑上會給出兩個答案,這就是反向對照組)。
//
// ── ② 單位碰撞 ───────────────────────────────────────────────────────
// 病灶:客戶端 `_collide` 對**單位**只做 push-out(而且自成一段迴圈、排在掃掠之前),
// 只有 `terrain.blockers` 有掃掠。「掃掠與 push-out 缺一不可」(CLAUDE.md §碰撞量體)對建物
// 成立、對單位一樣成立:擊退/蓄力跳/掉幀那一幀的位移動輒數公尺 ≫ 一名步兵的直徑,終點早就
// 落在另一側 ⇒ push-out 查不到重疊 ⇒ 整台機體從小兵/戰車/敵方機甲身上穿過去。而伺服器那半
// (`sim.solidResolve`)一向是掃掠 + push-out ⇒ 兩端分家(A30 家族:真人穿得過、電腦穿不過)。
// 修法:單位與世界障礙走同一套流程(同一份名冊 → 掃掠 → 交錯 push-out),圓柱幾何收成
// `_circleEnter`/`_pushOutCircle` 兩支唯一實作,與伺服器 `solidEnter`/`solidPush` 的圓柱分支
// 逐案例比對同值。
//
// 為什麼用「抽原文」而不是 import:`game.js` 的 three 走 CDN importmap,Node 端解析不了整支;
// 抽出來評估的仍是**真正的程式碼文字**(另抄一份公式進稽核就永遠會通過)。
//
// 跑法:`node tools/audit_npc_collide.mjs`
//   反向驗證(改壞真品原文再跑,對應條目 MUST 立刻紅字,否則等於沒驗到 —— 原則 9):
//     `--break-ratchet` 飛行分支改回逐幀棘輪  ⇒ Ⅲ 紅
//     `--break-deck`    `_flySurf` 不看橋面    ⇒ Ⅰ② / Ⅱ 紅
//     `--break-sweep`   拿掉單位掃掠            ⇒ Ⅴ / Ⅵ① 紅
// 退出碼:0 = 全綠;1 = 有紅字
import { readSrc, grabMethod, grabFn } from './audit_src.mjs';

const ARGV = new Set(process.argv.slice(2));
const BREAK_RATCHET = ARGV.has('--break-ratchet');
const BREAK_DECK = ARGV.has('--break-deck');
const BREAK_SWEEP = ARGV.has('--break-sweep');

let G = readSrc('public', 'js', 'game.js');
const S = readSrc('server', 'sim.js');

/** 反向驗證的改壞規則:MUST 真的改到東西(沒改到 = 旗標成了 no-op,反向驗證會假綠) */
const bust = (re, to, tag) => {
  const next = G.replace(re, to);
  if (next === G) throw new Error(`反向驗證 ${tag}:原文沒有匹配到目標,改壞規則已失效`);
  G = next;
};
if (BREAK_RATCHET) bust(/gy = this\._flySurf\(nx, nz\);/, 'gy = this._surf(nx, nz, cur.y - lift);', '--break-ratchet');
if (BREAK_DECK) bust(/\n    const d = t\.deckY\?\.[^\n]*\n    if \(d != null && d > s\) s = d;[^\n]*/, '', '--break-deck');
if (BREAK_SWEEP) bust(/\n    for \(const u of units\) \{\n      const t = this\._circleEnter[\s\S]*?\n    \}/, '', '--break-sweep');

let pass = 0, fail = 0;
const ok = (c, msg) => { c ? pass++ : (fail++, console.error(`  ✗ ${msg}`)); };
const sec = (t) => console.log(`\n=== ${t} ===`);
/** 逐行剝行末註解(單一縫計數用:註解裡提到的名字不算一處實作)*/
const strip = (s) => s.split('\n').map((l) => l.replace(/\/\/.*$/, '')).join('\n');
/** 全檔出現次數(剝註解後)*/
const count = (src, re) => (strip(src).match(re) || []).length;
/** 把 class 方法原文編譯成可呼叫的函式(free identifier 由呼叫端注入)*/
const meth = (name, src = G, free = {}) => {
  const keys = Object.keys(free);
  const body = grabMethod(src, name);
  const f = new Function(...keys, `return function ${body.slice(name.length + 3)}`);
  return f(...keys.map((k) => free[k]));
};

console.log('== NPC 飛行高度基準 / NPC ⇄ 機體碰撞稽核 ==');

// ---------------- 合成地景(純資料樁;不抄 main/biomes 的任何公式)----------------
// 河谷:x ∈ [0, 200] 之間地表沉到 0(河床),兩岸台地 40m。
// 橋樑:沿 +X 由 x=−30 到 x=230、z=0、半寬 8,橋面恆 46(河谷段淨空 46 ≫ 最大機體 ⇒ 走橋下不會被吸上橋)。
// 山體隧道:x ∈ [300, 420]、|z| ≤ 9,路面 40 / 天花 48 / 頂板頂面 49,山頂地表 120。
const heightAt = (x) => {
  if (x >= 300 && x <= 420) return 120;            // 隧道所在的山體
  if (x > 0 && x < 200) return 0;                  // 河床
  return 40;                                       // 兩岸台地
};
const DECK = { x0: -30, x1: 230, hw: 8, y: 46 };
const deckY = (x, z, m = 0) =>
  (x >= DECK.x0 && x <= DECK.x1 && Math.abs(z) <= DECK.hw + m ? DECK.y : null);
const tunnelAt = (x, z) =>
  (x >= 300 && x <= 420 && Math.abs(z) <= 9 ? { floor: 40, ceil: 48, roof: 49, open: false } : null);

// main.js 的 surfaceAt(舊制棘輪)—— 反向對照組用的**真品規則**,常數與 main.js 同值
const DECK_STEP = 2.2, DECK_MARGIN = 3.0, DECK_UNDER = 1.2, MAX_MECH_H = 4.8;
const surfaceAt = (x, z, curY) => {
  const h = heightAt(x, z);
  if (curY == null) return h;
  const tn = tunnelAt(x, z);
  if (tn && curY < tn.ceil) return tn.floor;
  const d = deckY(x, z, DECK_MARGIN);
  let s = h;
  if (d != null && d > h && (curY >= d - DECK_STEP || (d - DECK_UNDER) - h < MAX_MECH_H)) s = d;
  if (tn && !tn.open && tn.roof > s) s = tn.roof;
  return s;
};
const terrain = { heightAt, deckY, tunnelAt, deckMargin: DECK_MARGIN, surfaceAt };
const flyEnv = { terrain, _flySurf: meth('_flySurf') };
const flySurf = (x, z) => flyEnv._flySurf(x, z);

sec('Ⅰ 飛行體高度基準面:(x, z) 的純函式');
{
  ok(typeof flySurf(100, 0) === 'number', 'Ⅰ `_flySurf` 抽得出來且回傳數值');
  // ① 純函式:同一點呼叫兩次逐位元相同,且與呼叫順序無關
  const a1 = flySurf(100, 0);
  flySurf(-500, 900); flySurf(350, 0); flySurf(100, 40);
  ok(flySurf(100, 0) === a1, 'Ⅰ① 同一座標的答案與呼叫順序無關(無內部狀態)');
  // ② 橋上:基準恆為橋面,MUST NOT 回河床
  ok(flySurf(100, 0) === DECK.y, 'Ⅰ② 橋樑正上方的基準 = 橋面(不是橋下河床)');
  ok(flySurf(100, DECK.hw - 0.5) === DECK.y, 'Ⅰ② 橋面邊緣仍是橋面');
  // ③ 離開橋面足跡就回地表(基準面不外溢成一片隱形平台)
  ok(flySurf(100, DECK.hw + DECK_MARGIN + 5) === 0, 'Ⅰ③ 橋面足跡外回裸地形(不外溢)');
  // ④ 隧道段:MUST NOT 被吸到洞內路面(棘輪的第二個坑 —— 直升機一頭鑽進山肚子)
  ok(flySurf(360, 0) === 120, 'Ⅰ④ 山體隧道正上方取山頂地表(不落到洞內路面 40)');
  // ⑤ 明隧道頂板露在地形之外時取頂板(頂板 = 站立面,見 audit_layer_block Ⅴ)
  {
    const g = { terrain: { heightAt: () => 10, deckY: () => null, tunnelAt: () => ({ floor: 10, ceil: 18, roof: 19, open: false }), deckMargin: 3 }, _flySurf: meth('_flySurf') };
    ok(g._flySurf(0, 0) === 19, 'Ⅰ⑤ 明隧道:頂板高過地表時取頂板頂面');
    const o = { terrain: { heightAt: () => 10, deckY: () => null, tunnelAt: () => ({ floor: 10, ceil: 18, roof: 19, open: true }), deckMargin: 3 }, _flySurf: meth('_flySurf') };
    ok(o._flySurf(0, 0) === 10, 'Ⅰ⑤ open 段(引道露天路塹)無頂板 → 取地表(A29)');
  }
  // ⑥ 點狀地物(建物/電塔)刻意不收:收了直升機經過路邊電塔會整台彈上去
  ok(!/blockerTopAt/.test(strip(grabMethod(G, '_flySurf'))),
    'Ⅰ⑥ `_flySurf` MUST NOT 吃 blockerTopAt(點狀物件不是連續結構面)');
}

sec('Ⅱ 路徑無關性:飛過橋一次就再也回不去的棘輪(反向對照組)');
{
  // 直升機沿橋飛(z 方向被 sim._advance 的側推推出足跡一次再回來)——
  // 這正是使用者回報的觸發條件:「有時候」= 剛好被推出去的那幾架。
  const LIFT = 13;                                   // GAME.HELI_ALT × COMBAT_SCALE
  const path = [];
  for (let x = -40; x <= 240; x += 5) {
    // x ∈ [60, 80] 這一段被側推到橋面足跡外(|z| > hw + margin),之後回到橋心
    const z = (x >= 60 && x <= 80) ? 18 : 0;
    path.push([x, z]);
  }
  // 舊制:逐幀棘輪(種子 = 上一幀的基準面)
  const ratchet = [];
  {
    let cur = heightAt(path[0][0]) + LIFT;
    for (const [x, z] of path) {
      const gy = surfaceAt(x, z, cur - LIFT);
      cur = gy + LIFT;
      ratchet.push(gy);
    }
  }
  // 新制:純函式
  const pure = path.map(([x, z]) => flySurf(x, z));
  const onBridge = (i) => Math.abs(path[i][1]) <= DECK.hw;
  const ratchetSunk = ratchet.some((g, i) => onBridge(i) && path[i][0] > 80 && g < DECK.y);
  ok(ratchetSunk, 'Ⅱ 反向對照:舊制棘輪被側推一次後,回到橋心仍停在河床(病灶復現)');
  ok(pure.every((g, i) => !onBridge(i) || path[i][0] < DECK.x0 || path[i][0] > DECK.x1 || g === DECK.y),
    'Ⅱ 新制:同一條路徑上,橋心的基準面**每一點**都是橋面');
  // 「越飛越低」= 基準面在橋上一路低於橋面且不回頭;純函式版逐點只由座標決定
  const rev = [...path].reverse().map(([x, z]) => flySurf(x, z));
  ok(rev.every((g, i) => g === pure[pure.length - 1 - i]),
    'Ⅱ 新制:反向飛同一條路徑,逐點高度逐位元相同(無方向性/無記憶)');
  // 飛行體 MUST NOT 掉到橋面之下(穿過橋面板 = 破圖)
  ok(pure.every((g, i) => !onBridge(i) || deckY(path[i][0], path[i][1]) == null || g + LIFT >= DECK.y),
    'Ⅱ 新制:橋上的飛行體恆在橋面之上(不穿過橋面板)');
}

sec('Ⅲ 消費端單一縫:_updateEnts 的飛行分支');
{
  const ue = strip(grabMethod(G, '_updateEnts'));
  ok(count(G, /_flySurf\s*\(/g) === 2, 'Ⅲ `_flySurf` 恰一份定義 + 一個消費端');
  ok(/if \(ent\.flies\) \{\s*\n\s*gy = this\._flySurf\(nx, nz\);/.test(ue),
    'Ⅲ `ent.flies` 走 `_flySurf`(MUST NOT 再吃 surfaceAt 的棘輪)');
  // 飛行分支 MUST NOT 讀 cur.y(讀了就是把狀態放回來)
  const flyBranch = /if \(ent\.flies\) \{([\s\S]*?)\} else \{/.exec(ue);
  ok(!!flyBranch && !/cur\.y/.test(flyBranch[1]), 'Ⅲ 飛行分支內 MUST NOT 出現 `cur.y`(無棘輪)');
  // 地面單位那半逐位元維持舊制(兵線剖面場種子 + 棘輪)
  ok(/const laneY = this\._laneSurfAt\?\.\(nx, nz\);/.test(ue) && /curSeed = laneY \+ 1\.2/.test(ue),
    'Ⅲ 地面兵線單位仍吃 `_laneSurfAt` 剖面場(舊行為不變)');
  ok(/let curSeed = cur\.y - lift;/.test(ue), 'Ⅲ 非飛行體(含英雄)仍走逐幀棘輪');
}

// ---------------- ② 單位碰撞 ----------------
// 伺服器那半:抽 sim.js 的 solidEnter / solidPush 原文(module 私有,沒 export)
const solidEnter = new Function(`return ${grabFn(S, 'solidEnter')}`)();
const solidPush = new Function(`return ${grabFn(S, 'solidPush')}`)();

const clientEnv = () => ({
  pos: { x: 0, y: 0, z: 0 },
  vel: { x: 0, y: 0, z: 0 },
  _pushOutCircle: meth('_pushOutCircle'),
  _circleEnter: meth('_circleEnter'),
});

sec('Ⅳ 圓柱幾何:客戶端與伺服器逐案例同值(A30 兩端同判)');
{
  const env = clientEnv();
  let enterMax = 0, pushMax = 0, cases = 0, enterDiff = 0, pushDiff = 0;
  const CY = [0, 0, 3.5, 6, 0, 0, 0, 0];   // solid 圓柱形狀:[x, z, r, top, hw2, hd2, cs, sn]
  for (let ax = -12; ax <= 12; ax += 1.5) {
    for (let az = -12; az <= 12; az += 3) {
      for (let bx = -12; bx <= 12; bx += 1.5) {
        for (let bz = -12; bz <= 12; bz += 3) {
          const myR = 2.4;
          cases++;
          const a = solidEnter(CY, ax, az, bx, bz, myR);
          const b = env._circleEnter(CY[0], CY[1], CY[2], ax, az, bx, bz, myR);
          if ((a == null) !== (b == null)) enterDiff++;
          else if (a != null) enterMax = Math.max(enterMax, Math.abs(a - b));
          const p = solidPush(CY, bx, bz, myR);
          env.pos.x = bx; env.pos.z = bz; env.vel.x = 0; env.vel.z = 0;
          const moved = env._pushOutCircle(CY[0], CY[1], CY[2], myR);
          if ((p == null) !== !moved) pushDiff++;
          else if (p) pushMax = Math.max(pushMax, Math.hypot(env.pos.x - (bx + p[0]), env.pos.z - (bz + p[1])));
        }
      }
    }
  }
  ok(cases > 5000, `Ⅳ 掃描案例數足夠(${cases})`);
  ok(enterDiff === 0, `Ⅳ 掃掠:兩端「有沒有橫越」逐案例同判(分歧 ${enterDiff})`);
  ok(enterMax < 1e-12, `Ⅳ 掃掠:進入參數 t 逐案例同值(最大差 ${enterMax})`);
  ok(pushDiff === 0, `Ⅳ push-out:兩端「有沒有重疊」逐案例同判(分歧 ${pushDiff})`);
  ok(pushMax < 1e-12, `Ⅳ push-out:推出位移逐案例同值(最大差 ${pushMax})`);
}

sec('Ⅴ 單一縫:圓柱幾何各一份實作、單位與障礙同吃');
{
  const col = strip(grabMethod(G, '_collide'));
  const swp = strip(grabMethod(G, '_sweepBlockers'));
  ok(count(G, /_pushOutCircle\s*\(/g) === 3, 'Ⅴ `_pushOutCircle` 恰一份定義 + 兩個消費端(障礙圓柱 / 單位)');
  ok(count(G, /_circleEnter\s*\(/g) === 3, 'Ⅴ `_circleEnter` 恰一份定義 + 兩個消費端(障礙圓柱 / 單位)');
  ok(count(G, /_unitSolids\s*\(/g) === 2, 'Ⅴ `_unitSolids` 恰一份定義 + 一個消費端(掃掠與 push-out 吃同一份名冊)');
  // ents 只在名冊那一支掃(_collide 內不得再自己掃一次 ents)
  ok(!/this\.ents\.values\(\)/.test(col), 'Ⅴ `_collide` MUST NOT 自己再掃一次 `ents`(名冊只有一份)');
  ok(/selfCollider\(/.test(col), 'Ⅴ `_collide` 仍吃 `selfCollider`(兩端同一支量體;audit_bot_vision 同條)');
  // 掃掠 MUST 收單位
  ok(/for \(const u of units\)/.test(swp), 'Ⅴ `_sweepBlockers` MUST 掃單位(不是只掃 terrain.blockers)');
  ok(/_sweepBlockers\(px0, pz0, surfHere, onDeck, myR, myBot, myTop, units\)/.test(col),
    'Ⅴ `_collide` 把名冊傳進掃掠');
  // push-out MUST 與障礙交錯(同一個 pass 迴圈內)
  const loop = /for \(let pass = 0; pass < 3; pass\+\+\) \{([\s\S]*?)\n    \}/.exec(col);
  ok(!!loop && /for \(const u of units\)/.test(loop[1]),
    'Ⅴ 單位 push-out MUST 在同一趟 pass 迴圈內交錯(分兩段解 = 最後一段說了算)');
  // 順序:單位在前、世界障礙在後 ⇒ 擠不下時世界幾何贏(見 Ⅵ⑤-b)
  ok(!!loop && loop[1].indexOf('for (const u of units)') < loop[1].indexOf('of this.terrain.blockers'),
    'Ⅴ pass 內順序 MUST 是「先單位、後世界障礙」(擠不下時 MUST NOT 把機體留在建物裡)');
  // 垂直帶與伺服器同式
  ok(/myBot >= top - 0\.1 \|\| myTop <= base/.test(strip(grabMethod(G, '_unitSolids'))),
    'Ⅴ 單位垂直帶 ε 與伺服器 `_solidsNear` 的 span() 同式');
  ok(/yBot < top - 0\.1 && yTop > base/.test(strip(grabMethod(S, '_solidsNear'))),
    'Ⅴ(對照)伺服器 `_solidsNear` 的 span() 未被改動');
}

sec('Ⅵ 行為直測:機體 ⇄ NPC 不穿透、不被推進牆裡');
{
  // 真品 `_collide` 原文(free identifier:BattleClient.COLLIDER / selfCollider 由此注入)
  const COLLIDER = { soldier: { r: 0.6, h: 1.8 }, tank: { r: 2.6, h: 3.2 } };
  const mkEnv = (ents, blockers, src = G) => {
    const free = {
      BattleClient: { COLLIDER },
      selfCollider: (H, fly) => ({ r: H * 0.317, bot: fly ? -H * 0.2 : 0, top: H * 1.0 }),
    };
    return {
      pos: { x: 0, y: 0, z: 0 },
      vel: { x: 0, y: 0, z: 0 },
      selfH: 9,
      youId: 'me',
      ents: new Map(ents.map((e, i) => [i, e])),
      terrain: { blockers, heightAt: () => 0, deckY: () => null, surfaceAt: (x, z) => 0 },
      _flying: () => false,
      _surf: function (x, z, c) { return this.terrain.surfaceAt(x, z, c); },
      _unitSolids: meth('_unitSolids', src, free),
      _pushOutCircle: meth('_pushOutCircle', src),
      _circleEnter: meth('_circleEnter', src),
      _sweepBlockers: meth('_sweepBlockers', src),
      _collide: meth('_collide', src, free),
    };
  };
  const npc = (kind, x, z) => ({ kind, mesh: { visible: true, position: { x, y: 0, z } }, isSelf: false });
  const myR = 9 * 0.317;

  // ① 單幀高速橫越一名步兵(擊退 30m):MUST 被夾在前緣,MUST NOT 出現在另一側
  {
    const env = mkEnv([npc('soldier', 0, 0)], []);
    env.pos.x = -15; env.pos.z = 0;   // 起點
    env.vel.x = 300;
    env.pos.x = 15;                   // 這一幀直接落到另一側
    env._collide(-15, 0);
    ok(env.pos.x < 0, `Ⅵ① 單幀 30m 擊退橫越步兵 MUST 被夾在近側(x=${env.pos.x.toFixed(2)})`);
    ok(env.pos.x <= -(myR + 0.6) + 1e-9, 'Ⅵ① 夾住的位置在量體外緣之外(留 skin)');
  }
  // ②(反面)慢速貼上去:終點落在量體內近半 → 交給 push-out 沿邊滑,手感不變
  {
    const env = mkEnv([npc('soldier', 0, 0)], []);
    env.pos.x = -(myR + 0.6) - 0.5; env.pos.z = 0.9;
    const p0x = env.pos.x, p0z = env.pos.z;
    env.pos.x += 0.4;                 // 一小步貼上去
    env._collide(p0x, p0z);
    const d = Math.hypot(env.pos.x, env.pos.z);
    ok(d >= myR + 0.6 - 1e-9, 'Ⅵ② 慢速貼上去被 push-out 推到量體外緣(沿邊滑)');
    ok(env.pos.x > p0x - 0.6, 'Ⅵ② 慢速不被掃掠夾回起點(手感不變)');
  }
  // ③ 完全沒碰到的一步:逐位元不動(不誤觸)
  {
    const env = mkEnv([npc('soldier', 40, 40)], []);
    env.pos.x = 0; env.pos.z = 0;
    env.pos.x = 3;
    env._collide(0, 0);
    ok(env.pos.x === 3 && env.pos.z === 0, 'Ⅵ③ 遠離所有量體的一步逐位元不動');
  }
  // ④ 飛越:機體底高過單位頂面 ⇒ 不碰撞(直升機飛過塔頂的同一條垂直閘)
  {
    const env = mkEnv([npc('tank', 0, 0)], []);
    env.pos.y = 20; env.pos.x = -15;
    env.pos.x = 15;
    env._collide(-15, 0);
    ok(env.pos.x === 15, 'Ⅵ④ 高於單位垂直帶 ⇒ 不碰撞(逐位元不動)');
  }
  // ⑤ NPC 貼著牆把機體往牆裡推(擠得下):交錯收斂後 MUST 同時在牆外與 NPC 外
  {
    const wall = { x: 0, z: 16, hw2: 30, hd2: 2, ry: 0, y: -1, h: 12 };   // 沿 X 的長牆(牆面 z = 14)
    const env = mkEnv([npc('tank', 0, 4.5)], [wall]);
    env.pos.x = 0; env.pos.z = 8;     // 卡在牆與戰車之間(間距夠一台機體)
    env._collide(0, 8);
    const d = Math.hypot(env.pos.x, env.pos.z - 4.5);
    ok(d >= myR + 2.6 - 1e-6, `Ⅵ⑤ 擠得下:收斂後在 NPC 量體外(d=${d.toFixed(3)})`);
    ok(env.pos.z <= 14 - myR + 1e-6, `Ⅵ⑤ 擠得下:收斂後在牆外(z=${env.pos.z.toFixed(3)})`);
  }
  // ⑤-b 擠不下(牆與 NPC 之間根本不夠一台機體寬):MUST 讓**世界幾何**贏 ——
  // 陷進 NPC 只是兩個模型交疊,陷進建物是鏡頭看穿牆面的破圖(而且爬不出來)。
  {
    const wall = { x: 0, z: 10, hw2: 30, hd2: 2, ry: 0, y: -1, h: 12 };   // 牆面 z = 8;與戰車間距 3.5m < 一台機體
    const env = mkEnv([npc('tank', 0, 4.5)], [wall]);
    env.pos.x = 0; env.pos.z = 7.2;
    env._collide(0, 7.2);
    ok(env.pos.z <= 8 - myR + 1e-6,
      `Ⅵ⑤-b 擠不下時機體停在牆外(z=${env.pos.z.toFixed(3)} ≤ ${(8 - myR).toFixed(3)}),不被推進牆體`);
  }
  // ⑥ 自己的僚機不進名冊(歸隊時 50m/s 貼上來,誤觸會被夾住)
  {
    const env = mkEnv([{ kind: 'robot', hero: true, pid: 'me', heroCol: { r: 3, h: 9 }, mesh: { visible: true, position: { x: 0, y: 0, z: 0 } } }], []);
    env.pos.x = -15;
    env.pos.x = 15;
    env._collide(-15, 0);
    ok(env.pos.x === 15, 'Ⅵ⑥ 自己的僚機不碰撞(逐位元不動)');
  }
}

if (BREAK_RATCHET || BREAK_DECK || BREAK_SWEEP) {
  console.log(`\n(反向驗證模式:${[BREAK_RATCHET && '--break-ratchet', BREAK_DECK && '--break-deck', BREAK_SWEEP && '--break-sweep'].filter(Boolean).join(' ')} —— 上面 MUST 有紅字)`);
}

console.log(`\n${fail ? '❌' : '✅'} 通過 ${pass} 項${fail ? `,失敗 ${fail} 項` : ''}`);
process.exit(fail ? 1 : 0);
