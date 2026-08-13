// ============ 武器命中閘門稽核(射程容差 / 爆風量體 / 射程光暈可命中判定)============
// 用途:使用者 2026-07-30 回報「榴彈類武器常常出現射程光暈卻沒命中對方」的離線防線,
//       以及「不同類型武器各自的判定問題」的逐彈道覆蓋。
//
// 一句話定義本稽核守的規則:**光暈亮 = 打得到,而「打得到」與伺服器實際結算同源**。
// 拆成四條 MUST:
//   ① 射程閘門的網路寬容只有**一個**值(data.js RANGE_TOL);sim.js MUST NOT 逐處手寫倍率。
//   ② 兩端閘門同界:客戶端彈道能飛到的最遠處,伺服器 MUST 收得下(否則 = 靜默丟包)。
//   ③ 爆風量到目標命中量體的**最近點**(水平 hitR + 垂直帶),不是量中心。
//   ④ 射程光暈的判據依 `data.js reachRule()` 逐彈道分派,五類全覆蓋;消費端只有一份實作,
//      且拋物線可行性與 `_lobAim` 的火控解吃**同一份**逐級降裝藥階梯(_lobLadder)。
//   ⑤ 2026-08-03 使用者定案:光暈亮的是**這一發真的會傷到的單位**(準星目標打得到 ⇒ 名冊 =
//      該次結算的傷害足跡)。足跡的分類只走 `aoeClass(def)` 一份、幾何逐類鏡射伺服器
//      (`_blast` / `heroPlasma` / `_lanceHits`);爆風那一支**刻意不吃 LOS 也不吃射程**(A11)。
//
// 三種前科(本稽核逐條釘住):
//   Ⅰ **光暈只量距離**:距離在射程內就亮 —— 榴彈的彈道被稜線擋住、直擊武器的視線被建物擋住
//     都照亮不誤。伺服器那邊 heroHit/_lanceHits/heroPlasma 全有 `_losBlocked` 複驗、榴彈落點
//     則根本沒飛到目標 ⇒ 「光暈亮著卻沒命中」。
//   Ⅱ **閘門容差逐處手寫**:heroBurst 曾獨自寫 1.15,其餘閘門是 1.25 且另乘 `_altRange`。
//     高地上合法的榴彈落點落在 (1.15, altRangeMax × RANGE_TOL] 這段窗口 = 驗證後靜默丟棄:
//     玩家看到砲彈在敵人身上炸開、傷害卻是 0(A30 靜默丟包家族)。
//   Ⅲ **爆風量到中心**:半徑 20m 的主堡被榴彈直擊牆面,爆心離中心就是 20m ⇒ r=16 的榴彈
//     只結算到約五成超壓、r≤11 的直接歸零。與 2026-07-28 `_lanceHits` 的 R + hitR(t)、
//     2026-07-29 `_surfD3` 同一條病灶(「打不到建築」)的爆風版。
//
// 為什麼用「抽原文」而不是 import:`game.js` 的 three 走 CDN importmap,Node 端解析不了;
// 抽出來評估的仍是**真正的程式碼文字**(另抄一份公式就永遠會通過)。伺服器側則直接跑
// 真的 `BattleSim`。每一段可執行斷言都自帶反向對照:把判定改回壞版,對應條目 MUST 立刻紅字。
// 跑法:`node tools/audit_weapon_gate.mjs`
// 退出碼:0 = 全綠;1 = 有紅字
import {
  RANGE_TOL, altRangeMax, altRangeF, ALTITUDE, BLAST, blastCoreR, blastFalloff,
  HGT_CHARS, HGT_STEP, HGT_LEVELS, hgtEnc, LOS, chaseCapS, LOCK,
  REACH_RULE, reachRule, trajClass, aoeClass, fanConeHalf, armingOf, lobMinRange, lanceR, LANCE,
  BALLISTIC, TARGET_CLASS, CHARACTERS, heroWeapon, hitR, MAPGEO, WEAPONS, UNITS,
  GAME, STRUCT_W, NPC_BLAST, npcBlastR,
  evadable, evadeComped, evadeCompF, evadeExpF, EVASION, heroMobility, evasionMinSpeed, charKind,
  shotV0, shotFlightS, flightCapS, shotTrailS, SEEK, seekTurn,
  HIGH_SUP, highSupF, altTier, altDhMax,
} from '../public/js/data.js';
import { BattleSim } from '../server/sim.js';
import { readSrc } from './audit_src.mjs';

// 讀原文一律走 `readSrc`(§5 通則 ㋑;換行正規化成 LF)——
// 工作副本在 Windows 上是 CRLF,方法尾端的 `\n  }` 比對會整組失手
const read = (p) => readSrc(...p);
const G = read(['public', 'js', 'game.js']);
const S = read(['server', 'sim.js']);
const D = read(['public', 'js', 'data.js']);

let pass = 0, fail = 0;
const ok = (c, msg) => { c ? pass++ : (fail++, console.error(`  ✗ ${msg}`)); };
const sec = (t) => console.log(`\n${t}`);

/** 挑一名重武器彈道類別為 traj 的角色(不寫死角色代號:資料改了稽核仍成立)。side 可限定陣營。 */
function heavyOf(traj, side = null) {
  for (const id of Object.keys(CHARACTERS)) {
    if (side && CHARACTERS[id].side !== side && CHARACTERS[id].side !== 'MERC') continue;
    const def = heroWeapon(id, 'heavy', 1);
    if (def && trajClass(def) === traj) return { id, def };
  }
  throw new Error(`資料中找不到 trajClass=${traj} 的重武器`);
}

/** 抽 class 方法原文(2 空格縮排 → 首個 `\n  }` 收尾) */
function methodSrc(name, src) {
  const p0 = src.indexOf(`\n  ${name}(`);
  if (p0 < 0) throw new Error(`找不到方法 ${name}`);
  const p1 = src.indexOf('\n  }\n', p0);
  if (p1 < 0) throw new Error(`${name} 收尾解析失敗`);
  return src.slice(p0 + 1, p1 + 4);
}
/** 抽方法並在指定環境下實體化成可呼叫函式(env 的鍵become 該函式可見的自由變數) */
function pickMethod(name, src, env = {}) {
  const body = methodSrc(name, src).replace(/^\s*/, '');
  const keys = Object.keys(env);
  return new Function(...keys, `return function ${body.slice(name.length)}`)(...keys.map((k) => env[k]));
}

// =================================================================================
sec('Ⅰ 射程閘門容差 / 爆風超壓帶:單一縫,推導不手寫');
// ---------------------------------------------------------------------------------
ok(RANGE_TOL > 1 && RANGE_TOL < 2, `RANGE_TOL 是合理的網路寬容(${RANGE_TOL})`);
ok(Math.abs(altRangeMax() - (1 + ALTITUDE.RANGE)) < 1e-12,
  'altRangeMax() = 1 + ALTITUDE.RANGE(推導不手寫)');
ok(/export const altRangeMax = \(\) => 1 \+ ALTITUDE\.RANGE;/.test(D),
  'altRangeMax 原文由 ALTITUDE.RANGE 推導(MUST NOT 寫死 1.25)');
// sim.js 的每一道射程閘門都 MUST 吃 RANGE_TOL,且不得再出現「射程 × 手寫倍率」
{
  const gates = S.match(/\.range \* [^;\n]*/g) || [];
  const magic = gates.filter((g) => /\*\s*1\.\d/.test(g));
  ok(magic.length === 0, `sim.js 射程閘門無手寫倍率魔數(殘留 ${magic.length} 處:${magic.slice(0, 2).join(' | ')})`);
  const tolGates = gates.filter((g) => g.includes('RANGE_TOL'));
  ok(tolGates.length >= 6, `客戶端已自行夾過射程的回報路徑吃 RANGE_TOL 單一縫(${tolGates.length} 處)`);
  // 誠實界的那幾條(伺服器自己選目標)MUST NOT 混進 RANGE_TOL —— 沒有客戶端閘門可以寬容,
  // 寬容就是白送射程。逐條釘住:botFire / heroPlasma / heroLance 逐目標 / NPC 主迴圈。
  const honest = gates.filter((g) => /this\._altRange\(/.test(g) && !g.includes('RANGE_TOL'));
  ok(honest.length >= 4,
    `伺服器自己選目標的射程閘門吃誠實界(不乘 RANGE_TOL;${honest.length} 處)`);
  ok(/import \{[\s\S]*?altRangeMax[\s\S]*?\} from '\.\.\/public\/js\/data\.js'/.test(S),
    'sim.js 由 data.js 匯入 altRangeMax(不自算高度上限)');
}
// blastFalloff 的三個轉折點收成具名常數(核心帶要被「打得到」判定取用,兩處各寫一份 = 分家)
{
  const p = D.indexOf('export function blastFalloff');
  const src = D.slice(p, D.indexOf('\n}\n', p));
  ok(p > 0 && !/\b1\.8\b|\b1\.3\b/.test(src), 'blastFalloff 原文無硬寫 1.8 / 1.3(改吃 BLAST.EDGE 與推導跨距)');
  ok(Math.abs(blastCoreR({ r: 20 }) - 20 * BLAST.CORE) < 1e-12, 'blastCoreR = def.r × BLAST.CORE(推導)');
  ok(blastFalloff(20, 20 * BLAST.CORE) === 1 && blastFalloff(20, 20 * BLAST.EDGE) === 0,
    '爆風曲線轉折不變:核心帶內全額、EDGE 倍半徑歸零');
  ok(Math.abs(blastFalloff(16, 10) - ((16 * 1.8 - 10) / (16 * 1.3)) ** 0.75) < 1e-12,
    '爆風曲線逐點與舊制逐位元相同(只換常數命名,不動形狀)');
}

// =================================================================================
sec('Ⅱ 兩端射程閘門同界:客戶端飛得到的,伺服器 MUST 收得下');
// ---------------------------------------------------------------------------------
// 客戶端彈道上限(game.js `_tryFire` 建立彈體時的 b.max)= range × 逐目標高度制空倍率,
// 其上界就是 altRangeMax();伺服器 heroBurst 的上界 MUST ≥ 它。
{
  const alt = methodSrc('_altRangeTo', G);
  ok(/altRangeF\(/.test(alt) && !/ALTITUDE\.RANGE \* altScale/.test(alt),
    '客戶端 _altRangeTo 走 data.js altRangeF 這個唯一縫(MUST NOT 自寫第二份曲線)');
  ok(/this\._maxRange\(def\)/.test(methodSrc('_tryFire', G)) && /altRangeMax\(\)/.test(methodSrc('_maxRange', G)),
    '搜尋上限 _maxRange = range × altRangeMax()(= 伺服器 impCap 的誠實界)');
  ok(/max: rng, mesh, origin: muzzle\.clone\(\),/.test(G),
    '客戶端彈體射程上限 = 這一發的有效射程 rng、球心 = 槍口(2026-08-01 起無重砲窗:巨砲已整組移除)');
  ok(!/\brMul\b/.test(G.replace(/^\s*(\/\/|\*).*$/gm, '')) || /const rMul = this\._altRangeTo\(/.test(G),
    'rMul 若仍出現在可執行原文 MUST 有宣告(巨砲移除後遺留的未宣告變數 = 一開火就 ReferenceError)');
  const burst = methodSrc('heroBurst', S);
  ok(/const impCap = wp\.def\.range \* altRangeMax\(\) \* RANGE_TOL;/.test(burst),
    'heroBurst 落點閘門 = range × altRangeMax() × RANGE_TOL(三個因子皆推導)');
  const burstCode = burst.replace(/^\s*\/\/.*$/gm, '');   // 只驗可執行原文(說明裡提得到舊值 1.15)
  ok(!/1\.15/.test(burstCode), 'heroBurst 不再手寫 1.15(舊制比其餘閘門緊 ⇒ 高地榴彈靜默丟包)');
  ok((burst.match(/impCap/g) || []).length >= 3,
    '僚機齊射吃同一道 impCap(舊制僚機另寫一份 ⇒ 兩端分家)');
  ok(altRangeMax() * RANGE_TOL > 1.15,
    `舊制 1.15 確實收不下客戶端上限(現界 ${(altRangeMax() * RANGE_TOL).toFixed(3)} > 1.15)`);
}
// 行為直測:真 BattleSim —— 高地上以「射程 × altRangeMax」回報落點 MUST 生效,超界 MUST 丟棄
{
  const sim = new BattleSim(fakeCfg());
  purge(sim);
  const lobCh = heavyOf('lob', 'SWARM');               // 任一名榴彈類(launcher 無導引)角色
  const h = sim.addHero('SWARM', 'p_g1', lobCh.id);
  const wp = sim._heroWeapon(h, 'heavy');
  h.aiming = true; h.x = 3000; h.z = 3000; h.y = 0;
  sim.t = 1000;   // _gateFire 的射速閘量的是「距上次擊發」,t=0 的新 sim 一律禁射
  const mk = (x, z) => sim._add({ kind: 'robot', side: 'STEEL', hero: true, dead: false,
    x, z, y: 0, hp: 9000, maxHp: 9000, armor: 0, sp: 0, maxSp: 0, lev: 0, buffs: {}, mods: [] });
  const R = wp.def.range;
  // ① 落點在「舊制拒收、新制收下」的窗口內(range × 1.20)
  const dIn = R * 1.20;
  const t1 = mk(h.x + dIn, h.z);
  sim.heroBurst('p_g1', t1.x, t1.z, 0, 0);
  ok(t1.hp < t1.maxHp, `落點 range×1.20(舊制 1.15 會靜默丟棄)MUST 造成傷害:hp ${t1.hp.toFixed(0)}/${t1.maxHp}`);
  // ② 落點超出新界 → 仍 MUST 丟棄(寬容不是無上限)
  const sim2 = new BattleSim(fakeCfg());
  purge(sim2);
  const h2 = sim2.addHero('SWARM', 'p_g2', lobCh.id);
  h2.aiming = true; h2.x = 3000; h2.z = 3000; h2.y = 0;
  sim2.t = 1000;
  const t2 = sim2._add({ kind: 'robot', side: 'STEEL', hero: true, dead: false,
    x: h2.x + R * altRangeMax() * RANGE_TOL + 20, z: h2.z, y: 0,
    hp: 9000, maxHp: 9000, armor: 0, sp: 0, maxSp: 0, lev: 0, buffs: {}, mods: [] });
  sim2.heroBurst('p_g2', t2.x, t2.z, 0, 0);
  ok(t2.hp === t2.maxHp, '落點超出 range × altRangeMax × RANGE_TOL → 仍靜默丟棄(防作弊上限不因寬容失守)');
}

// =================================================================================
sec('Ⅲ 爆風量到命中量體最近點(水平 hitR + 垂直帶),不是量中心');
// ---------------------------------------------------------------------------------
{
  const bl = methodSrc('_blast', S);
  ok(/Math\.hypot\(x - t\.x, z - t\.z\) - hitR\(t\)/.test(bl),
    '_blast 水平距離扣掉目標水平量體 hitR(t)(與 _surfD3 / _lanceHits 同一把尺)');
  ok(/this\._bodyDy\(t, y\)/.test(bl), '_blast 垂直距離仍走 _bodyDy 垂直帶(水平垂直同一把尺)');
  const sim = new BattleSim(fakeCfg());
  purge(sim);
  const owner = sim.addHero('SWARM', 'p_b1', 'm01');
  const def = { dmg: 300, r: 16, pen: 0, vs: {} };      // r=16:152mm 級榴彈
  const base = [...sim.ents.values()].find((e) => e.kind === 'base' && e.side === 'STEEL');
  ok(!!base && hitR(base) >= 20, `測試前置:主堡水平量體 hitR = ${base ? hitR(base) : '—'}m`);
  base.sp = 0; base.maxSp = 0;   // 排除護盾層(先扣、不吃護甲)干擾兩次爆風的掉血比較
  // ① 直擊牆面 = 直擊中心:兩者掉血 MUST 相同(舊制牆面只有約五成)
  const shoot = (dx) => { const h0 = base.hp; sim._blast(owner, def, base.x + dx, base.z, 0, 0); return h0 - base.hp; };
  const dCenter = shoot(0);
  const dWall = shoot(hitR(base));
  ok(dCenter > 0 && Math.abs(dWall - dCenter) < 1e-6,
    `榴彈直擊主堡牆面 = 直擊中心的滿額爆風(牆面 ${dWall.toFixed(1)} / 中心 ${dCenter.toFixed(1)})`);
  ok(blastFalloff(def.r, hitR(base)) < 0.6,
    `對照:舊制量中心只結算 ${(blastFalloff(def.r, hitR(base)) * 100).toFixed(0)}% 超壓(這就是「打不到建築」)`);
  // ② 近側表面之外仍照曲線衰減、EDGE 外歸零(寬容不是無限放大爆風)
  ok(shoot(hitR(base) + def.r * BLAST.EDGE + 1) === 0,
    '距近側表面 EDGE·r 之外 → 爆風歸零(半徑沒有被 hitR 無限撐大)');
  const dMid = shoot(hitR(base) + def.r);
  ok(dMid > 0 && dMid < dCenter, `近側表面之外照舊衰減(表面 +r 處 ${dMid.toFixed(1)} < 滿額 ${dCenter.toFixed(1)})`);
  // ③ 人員級目標(hitR ≈ 0.6m)位移極小 —— 平衡位移只發生在大體積目標
  const soldR = hitR({ kind: 'soldier' });
  const fNew = blastFalloff(def.r, def.r * 1.2 - soldR), fOld = blastFalloff(def.r, def.r * 1.2);
  ok(fNew / fOld < 1.15, `人員級目標(hitR ${soldR}m)超壓位移 ${((fNew / fOld - 1) * 100).toFixed(1)}% < 15%`);
  const towR = hitR({ kind: 'tower' });
  ok(blastFalloff(def.r, towR) > 0.9,
    `砲塔(hitR ${towR}m)本就多半落在核心帶內 ⇒ bal ④ 拆塔時間位移可忽略(舊制已 ${(blastFalloff(def.r, towR) * 100).toFixed(0)}%)`);
}

// =================================================================================
sec('Ⅳ 射程光暈的「打得到」判定:逐彈道分派、五類全覆蓋、消費端單一縫');
// ---------------------------------------------------------------------------------
{
  const TRAJ = ['lob', 'flat', 'line', 'guide', 'fnf'];
  ok(TRAJ.every((k) => REACH_RULE[k]), `REACH_RULE 覆蓋全部五個彈道類別(${Object.keys(REACH_RULE).join('/')})`);
  ok(Object.keys(REACH_RULE).length === TRAJ.length, 'REACH_RULE 沒有多餘類別(分類縫與 trajClass 一一對應)');
  ok(Object.values(REACH_RULE).every((r) => (r.path === 'arc' || r.path === 'ray')
    && (r.hit === 'blast' || r.hit === 'clear') && typeof r.arm === 'boolean'),
  'REACH_RULE 每列欄位完整(path ∈ arc|ray、hit ∈ blast|clear、arm 布林)');
  ok(REACH_RULE.lob.path === 'arc' && REACH_RULE.flat.path === 'ray',
    '拋物線走彈道積分、平射走直線段(判定方式跟著彈道走)');
  ok(REACH_RULE.guide.arm && REACH_RULE.fnf.arm && !REACH_RULE.lob.arm,
    '只有導引/射後不理吃軌跡修正期(ARMING 就只有這兩類)');
  // 逐武器交叉驗:hit==='blast' MUST ⟺ 該武器是爆炸戰鬥部(aoeClass 'blast')
  let cross = 0, bad = [];
  for (const id of Object.keys(CHARACTERS)) {
    for (const slot of ['light', 'heavy']) {
      const def = heroWeapon(id, slot, 1);
      if (!def) continue;
      cross++;
      const isBlast = aoeClass(def) === 'blast';
      if ((reachRule(def).hit === 'blast') !== isBlast) bad.push(`${id}.${slot}`);
      if (!REACH_RULE[trajClass(def)]) bad.push(`${id}.${slot}(無規則)`);
    }
  }
  ok(bad.length === 0, `${cross} 把角色武器的 reachRule 與 aoeClass 一致(離群:${bad.slice(0, 3).join(',') || '無'})`);
  // 消費端單一縫
  const rg = methodSrc('_updateRangeGlows', G);
  const re = methodSrc('_reachable', G);
  const sv = methodSrc('_shotVictims', G);
  const sw = methodSrc('_shotWarn', G);
  ok(/this\._reachable\(ent, def, rule, this\._effRange\(def, ent\)\)/.test(sv),
    '準星目標的亮暗由 _reachable 定案(MUST NOT 退回只量距離)');
  ok(/reachRule\(def\)/.test(rg), '_updateRangeGlows 經 reachRule() 取規則');
  ok(!/trajClass\(|def\.type ===/.test(rg) && !/trajClass\(|def\.type ===/.test(re)
    && !/trajClass\(|def\.type ===/.test(sv),
    '光暈路徑 MUST NOT 自己比對 trajClass / def.type(第二份分類表 = 分家)');
  ok(/rule\.hit === 'blast'/.test(re) && /rule\.path === 'arc'/.test(re) && /rule\.arm/.test(sw),
    '_reachable + _shotWarn 三個欄位全數消費(規則表沒有寫了不用的欄位)');
  ok(/blastCoreR\(def\)/.test(re), '爆炸戰鬥部的判據 = 落點落在爆風核心帶(blastCoreR,推導不手寫)');
  ok(/this\._effRange\(def, ent\)/.test(sv) && /this\._effRange\(def, ent\)/.test(methodSrc('_inShotRange', G)),
    '光暈的有效射程 = 逐目標 _effRange(與擊發同一個數字;漏掉 = 光暈與實際射程分家)');
  ok(/if \(surf > rng\) return \{ ok: false/.test(re),
    '_reachable 自己夾射程(量近側表面 surf,與伺服器 _surfD3 同一把尺)');
  ok(/this\._maxRange\(def\)/.test(sv),
    '貫穿圓柱端點用搜尋上限 _maxRange(只寬不緊;射程由逐目標誠實界夾回)');
  // ---- 警示語意單一縫(2026-08-03:整發的性質,MUST NOT 讓準星與濺射名冊各判一次)----
  ok((G.match(/lobMinRange\(def\)/g) || []).length === 2,
    'game.js 只有兩處讀 lobMinRange(_lobAim 的太近提示 + _shotWarn;第三處 = 第二份警示規則)');
  ok((G.match(/this\._shotWarn\(/g) || []).length === 2,
    '_shotWarn 恰兩個消費端(_reachable 逐目標 + _shotVictims 整發)');
}
// 彈道積分單一縫:繪製與判定共用一份
{
  ok((G.match(/BALLISTIC\.G \* step/g) || []).length === 1,
    'game.js 只有一份彈道積分迴圈(_arcTrace;第二份 = 光暈與虛線分家)');
  const ladder = methodSrc('_lobLadder', G);
  ok(/const lv = this\._lobVel\(from, aim, v\);\n\s+const a = this\._arcTrace\(from, lv, max, aim, draw\);/.test(ladder),
    '_lobLadder 的每一級裝藥都走 _arcTrace(draw 由呼叫端決定寫不寫繪製緩衝)');
  ok(/const v45 = this\._lob45Vel\(from, aim, base\);/.test(ladder)
    && /this\._arcTrace\(from, v45, max, aim, draw\)/.test(ladder),
    '_lobLadder 對地走固定 45° 解,且與裝藥階梯共用同一支 _arcTrace(第二份積分 = 光暈與虛線分家)');
  const aim = methodSrc('_lobAim', G);
  const re = methodSrc('_reachable', G);
  ok(/this\._lobLadder\(/.test(aim) && /this\._lobLadder\(/.test(re),
    '火控解(_lobAim)與光暈判定(_reachable)吃同一份火控解(對地 45° / 對空裝藥階梯)');
  ok(/this\._lobLadder\(from, fc\.aim, max, base, BALLISTIC\.LOB_TOL, true, fc\.aa\)/.test(aim)
    && /this\._lobLadder\(from, aim, rng, this\._shotV0\(def, aa\), tol, false, aa\)/.test(re),
    '兩個消費端都把「對空與否」傳進 _lobLadder(漏傳 = 光暈拿另一條彈道回答)');
  ok(!/for \(let k = 0; k < Z\.length/.test(aim), '_lobAim 不再自己跑一次裝藥階梯(已收進 _lobLadder)');
  ok(!/_lob45Vel/.test(aim) && !/_lob45Vel/.test(re),
    '45° 解只在 _lobLadder 裡出現一次(消費端各解一次 = 兩份實作)');
  ok(/if \(draw\) this\._ensureArcGuide\(\);/.test(methodSrc('_arcTrace', G)),
    '_arcTrace 只在 draw 時碰繪製緩衝(判定路徑 MUST NOT 踩壞正在顯示的瞄準虛線)');
}

// =================================================================================
sec('Ⅴ _reachable 行為直測:逐彈道類型各自的判定');
// ---------------------------------------------------------------------------------
// ---- 最小 Vector3 + 真品方法抽取環境(Ⅴ 與 Ⅴ-b 共用一份:兩份樁 = 兩套幾何)----
class V3 {
    constructor(x = 0, y = 0, z = 0) { this.x = x; this.y = y; this.z = z; }
    set(x, y, z) { this.x = x; this.y = y; this.z = z; return this; }
    clone() { return new V3(this.x, this.y, this.z); }
    copy(v) { this.x = v.x; this.y = v.y; this.z = v.z; return this; }
    addScaledVector(v, s) { this.x += v.x * s; this.y += v.y * s; this.z += v.z * s; return this; }
    sub(v) { this.x -= v.x; this.y -= v.y; this.z -= v.z; return this; }
    dot(v) { return this.x * v.x + this.y * v.y + this.z * v.z; }
    divideScalar(s) { this.x /= s; this.y /= s; this.z /= s; return this; }
    length() { return Math.hypot(this.x, this.y, this.z); }
    normalize() { const l = this.length() || 1; this.x /= l; this.y /= l; this.z /= l; return this; }
  distanceTo(v) { return Math.hypot(this.x - v.x, this.y - v.y, this.z - v.z); }
}
const THREE = { Vector3: V3 };
const ARC_MAXP = Number(/const ARC_MAXP = (\d+);/.exec(G)?.[1]);
const RANGE_GLOW = new Function(`return ${/const RANGE_GLOW = (\{[^}]*\});/.exec(G)[1]}`)();
const env = { THREE, BALLISTIC, ARC_MAXP, RANGE_GLOW, TARGET_CLASS, blastCoreR, lobMinRange, armingOf, shotV0,
  aoeClass, blastFalloff, fanConeHalf, lanceR, LANCE };
const M = (n) => pickMethod(n, G, env);
// 牆 = 沿 +X 的一道垂直面(擋住 x ≥ w.x 且高度低於 w.top 的射線);回傳截斷距離
const mkWalls = (walls) => (ax, ay, az, bx, by, bz) => {
  let best = null;
  for (const w of walls) {
    if (ax >= w.x || bx <= w.x) continue;
    const t = (w.x - ax) / (bx - ax);
    if (ay + (by - ay) * t > w.top) continue;          // 從牆頂越過(拋物線高角度解)
    const d = Math.hypot(bx - ax, by - ay, bz - az) * t;
    if (best == null || d < best) best = d;
  }
  return best;
};

{
  ok(ARC_MAXP > 0, `game.js 的 ARC_MAXP 取得(${ARC_MAXP})`);
  // 樁:平地無障礙 → _layerHitT 由外部注入的 walls 決定
  const mkClient = (walls = []) => ({
    gunGroup: null,
    camera: { position: new V3(0, 2, 0) },
    _shotV0: M('_shotV0'),
    _lobSolve: M('_lobSolve'),
    _lobVel: M('_lobVel'),
    _lob45Vel: M('_lob45Vel'),
    _arcTrace: M('_arcTrace'),
    _lobLadder: M('_lobLadder'),
    _reachable: M('_reachable'),
    _shotWarn: M('_shotWarn'),
    _hitR: (e) => e._hr ?? 1,
    _layerHitT: mkWalls(walls),
  });
  const mkEnt = (x, kind = 'robot', hr = 1) =>
    ({ kind, _hr: hr, dimTop: 6, dimH: 6, mesh: { position: new V3(x, 0, 0) } });

  // ---- flat / line(直擊・貫穿):視線 MUST 整段淨空 ----
  {
    const { id, def } = heavyOf('flat');         // 動能貫穿重武器(gun/rail → traj flat)
    ok(trajClass(def) === 'flat', `測試前置:${id} 重武器彈道類別 = flat(${def.name})`);
    const rule = reachRule(def);
    const clear = mkClient();
    ok(clear._reachable(mkEnt(120), def, rule, def.range).ok, '直擊武器:視線淨空 → 光暈亮');
    const walled = mkClient([{ x: 60, top: 40 }]);
    ok(!walled._reachable(mkEnt(120), def, rule, def.range).ok,
      '直擊武器:中途有實體障礙 → 光暈熄滅(伺服器 _losBlocked 會擋,亮著就是騙人)');
    ok(walled._reachable(mkEnt(40), def, rule, def.range).ok,
      '直擊武器:目標在障礙**之前** → 照亮(不誤殺)');
  }
  // ---- 爆炸戰鬥部 + 直線(guide / fnf):落點落在爆風核心帶內即算打得到(A11 爆風不吃 LOS)----
  {
    const { id, def } = heavyOf('guide');        // 雷射導引火箭(launcher + guide → traj guide)
    ok(trajClass(def) === 'guide', `測試前置:${id} 重武器彈道類別 = guide(${def.name})`);
    const rule = reachRule(def);
    const core = blastCoreR(def);
    // 前置只驗「核心帶是推導值且為正」——**MUST NOT 釘住一個絕對公尺數**:2026-08-02「一發不得
    // 同時吃到兩座塔」的夾制把爆炸型半徑整批收到 soloBlastRmax() 以下(核心帶 6.0m → 1.5m),
    // 舊的 `core > 2` 釘的是改制前的尺度,而下面兩條掩體測試本來就是按 core 的比例擺位。
    ok(core > 0 && Math.abs(core - def.r * BLAST.CORE) < 1e-9,
      `測試前置:爆風核心半徑 ${core.toFixed(2)}m = r ${def.r.toFixed(2)}m × BLAST.CORE`);
    const near = mkClient([{ x: 120 - core * 0.4, top: 40 }]);   // 掩體貼著目標
    ok(near._reachable(mkEnt(120), def, rule, def.range).ok,
      '爆炸戰鬥部:掩體貼著目標 → 仍亮(爆風繞過掩體照樣傷得到,A11)');
    const far = mkClient([{ x: 40, top: 40 }]);                  // 掩體離目標很遠
    ok(!far._reachable(mkEnt(120), def, rule, def.range).ok,
      '爆炸戰鬥部:掩體離目標遠於核心帶 → 熄滅(彈頭炸在牆上,傷不到人)');
    // 軌跡修正期:ARMING.m 內 → 亮但轉警示
    const arm = armingOf(def).m;
    const close = mkClient();
    const rClose = close._reachable(mkEnt(arm * 0.5), def, rule, def.range);
    ok(rClose.ok && rClose.warn, `導引彈:目標在軌跡修正期(<${arm}m)內 → 亮但轉警示色`);
    ok(!close._reachable(mkEnt(arm * 2.5), def, rule, def.range).warn,
      '導引彈:拉開距離後回到正常光暈');
  }
  // ---- lob(榴彈):吃火控階梯 ----
  {
    const { id, def } = heavyOf('lob');          // 榴彈/火箭(launcher 無導引 → traj lob)
    ok(trajClass(def) === 'lob', `測試前置:${id} 重武器彈道類別 = lob(${def.name})`);
    const rule = reachRule(def);
    const flat = mkClient();
    const rng = def.range;
    ok(flat._reachable(mkEnt(rng * 0.5), def, rule, rng).ok, '榴彈:平地射程內 → 光暈亮');
    // 高牆貼在槍口前:所有裝藥號數都越不過 → 熄滅
    const wall = mkClient([{ x: 8, top: 400 }]);
    ok(!wall._reachable(mkEnt(rng * 0.5), def, rule, rng).ok,
      '榴彈:所有裝藥都越不過的高牆 → 光暈熄滅(舊制只量距離,照亮不誤)');
    // 中等高度的稜線:直射被擋、拋物線越得過 → 仍亮(這正是榴彈存在的意義)。
    // 不寫死高度(換武器/射程資料就會失準):掃一輪,要求「存在」這樣一種稜線。
    // 兩個層級各驗一次:①擋住直射 ②連全裝藥低伸解都擋住(= 只有降裝藥階梯救得回來)。
    const wx = rng * 0.2, tgt = rng * 0.6;
    let overFlat = null, overFull = null;
    for (let top = 2; top <= 120 && !(overFlat != null && overFull != null); top += 2) {
      const c = mkClient([{ x: wx, top }]);
      const reach = c._reachable(mkEnt(tgt), def, rule, rng).ok;
      if (!reach) continue;
      if (overFlat == null && c._layerHitT(0, 2, 0, tgt, 3, 0) != null) overFlat = top;
      // 探針:只跑全裝藥那一級(不經階梯)—— 被擋代表這條光暈是降裝藥救回來的
      const from2 = new V3(0, 2, 0), aim2 = new V3(tgt, 3, 0);
      const fullArc = c._arcTrace(from2, c._lobVel(from2, aim2, c._shotV0(def, false)), rng, aim2, false);
      if (overFull == null && fullArc.cut === 'block') overFull = top;
    }
    ok(overFlat != null,
      `榴彈:存在擋住直射卻打得到的稜線(${overFlat}m)→ 光暈仍亮(拋物線本來就越得過)`);
    ok(overFull != null,
      `榴彈:存在連全裝藥低伸解都擋住、仍打得到的稜線(${overFull}m)→ 45° 拋投確實抬得比低伸解高`);
    // 最小安全射程內 → 亮但警示(打得到,只是會自損無差別)
    const mr = lobMinRange(def);
    ok(mr > 0, `測試前置:最小安全射程 ${mr.toFixed(1)}m`);
    const r2 = flat._reachable(mkEnt(mr * 0.6), def, rule, rng);
    ok(r2.ok && r2.warn, '榴彈:最小安全射程內 → 亮但轉警示色(會無差別波及自身)');
    // 超出射程包絡(以極短的 max 模擬)→ 熄滅
    ok(!flat._reachable(mkEnt(rng * 0.9), def, rule, 30).ok,
      '榴彈:彈道被射程終點截斷 → 光暈熄滅');
  }
}

// =================================================================================
sec('Ⅴ-b 範圍光暈 = 這一發的傷害足跡(2026-08-03 使用者定案)');
// ---------------------------------------------------------------------------------
// 使用者定案:「範圍光暈不是單純在射程範圍內就亮,而是:**準星的目標在射程內被擊中時、
// 同時會受到傷害的單位才亮**」。
// 舊制(Ⅴ 那一代)亮的是「我打得到的每一個敵人」—— 190m 的重武器在前線會讓半個畫面同時
// 發光,而其中絕大多數不是**這一發**會傷到的人。新制把名冊換成「這一發的結算足跡」,
// Ⅴ 的判據沒有被丟掉,而是收斂成足跡的**入口閘**(準星那一發打不到 ⇒ 誰都不會受傷)。
// 本段釘住三件事:①名冊只有一份且分類只走 `aoeClass` ②爆風那一支不吃 LOS / 射程(A11)
// ③足跡幾何逐類鏡射伺服器(以真品 `_shotVictims` 原文跑合成場景直測)。
{
  const rg = methodSrc('_updateRangeGlows', G);
  const sv = methodSrc('_shotVictims', G);
  // ---- 原文:單一縫 ----
  ok(/this\._shotVictims\(def, reachRule\(def\)\)/.test(rg), '光暈名冊只來自 _shotVictims(唯一縫)');
  ok((G.match(/_shotVictims\(/g) || []).length === 2, '_shotVictims 一份實作、一個呼叫點');
  ok(!/_reachable/.test(rg),
    '_updateRangeGlows MUST NOT 自己逐敵人跑 _reachable(入口閘已收進 _shotVictims)');
  ok(!/RANGE_GLOW\.(TTL_S|ARC_PER_FRAME|RAY_PER_FRAME)/.test(G),
    '舊的分幀預算 / TTL 快取 MUST NOT 復辟(那是「每個敵人各跑一次彈道積分」時代的節流)');
  ok(/aoeClass\(def\)/.test(sv), '足跡分類走 aoeClass(def)(唯一分類縫)');
  ok(/blastFalloff\(def\.r,/.test(sv),
    'blast 足跡以 blastFalloff 判入列(與伺服器 _blast 同一條曲線,MUST NOT 自己寫半徑比較)');
  ok(/this\._lancePierced\(from, impact, lanceR\(def\)\)/.test(sv),
    'line 足跡走既有的 _lancePierced(sim._lanceHits 的客戶端鏡射)');
  // 扇形錐緣 MUST 量到命中量體近側表面(fanConeHalf 單一縫)—— 量中心 = 貼著砲塔/主堡牆面噴
  // 光暈全滅而伺服器那半照樣結算(2026-08-03 使用者回報「打得到一般單位、但不到建築」)
  ok(/fanConeHalf\(def, d2, this\._hitR\(e\)\)/.test(sv),
    'fan 足跡的錐緣走 fanConeHalf(def, d2, hitR) 單一縫');
  ok(!/Math\.cos\(\(def\.arc/.test(sv) && !/cosA/.test(sv),
    '_shotVictims MUST NOT 留下第二份手寫錐(舊 cosA 已退場)');
  ok(!/Math\.cos\(\(wp\.def\.arc/.test(S) && !/cosA/.test(S),
    'sim.js MUST NOT 留下第二份手寫錐(heroPlasma 改吃 fanConeHalf)');
  ok((S.match(/fanConeHalf\(/g) || []).length === 1 && (G.match(/fanConeHalf\(/g) || []).length === 1,
    'fanConeHalf 在 sim.js / game.js 各恰一個消費端');
  {
    const LS = read(['tools', 'lanesim.mjs']);
    ok(/fanConeHalf\(def, d, hitR\(e\)\)/.test(LS),
      '前線交戰模型(lanesim,bal ⑦ 的攻擊範圍計價)吃同一支 fanConeHalf');
  }
  ok(/this\._lobFc/.test(sv) && !/_lobLadder|_arcTrace|_lob45Vel/.test(sv),
    '拋物線吃每幀已定案的火控解 _lobFc,MUST NOT 在名冊裡重解一次彈道');
  ok(/ent\.id !== this\._lockId/.test(rg), '鎖定目標仍排除在範圍光暈之外(另有 lockGlow,不疊兩層)');
  const blastArm = /if \(cls === 'blast'\) \{([\s\S]*?)\n {4}\} else if \(cls === 'fan'\)/.exec(sv)?.[1] || '';
  ok(blastArm.length > 0, '取得 _shotVictims 的 blast 分支原文');
  ok(!/_layerHitT|_losBlocked|_effRange|_inShotRange|RANGE_TOL/.test(blastArm),
    'A11:blast 足跡 MUST NOT 出現 LOS / 射程閘(牆邊炸開照樣傷得到牆後的人)');
  ok(/hitR|_hitR/.test(blastArm) && /_bodyDy/.test(blastArm),
    'blast 足跡量到命中量體最近點(水平 _hitR + 垂直帶 _bodyDy,與伺服器 _blast 同構)');
  ok(/_bodySpan|y < y0 \? y0 - y : \(y > y1 \? y - y1 : 0\)/.test(methodSrc('_bodyDy', G)),
    '客戶端 _bodyDy 與伺服器 sim._bodyDy 同式(帶內 = 0)');

  // ---- 行為直測:真品 _shotVictims 跑合成場景 ----
  /** 挑一把 aoeClass = cls 的武器(不寫死角色代號) */
  const weaponOfAoe = (cls) => {
    for (const id of Object.keys(CHARACTERS)) {
      for (const slot of ['light', 'heavy']) {
        const def = heroWeapon(id, slot, 1);
        if (def && aoeClass(def) === cls) return { id, slot, def };
      }
    }
    throw new Error(`資料中找不到 aoeClass=${cls} 的武器`);
  };
  const mkFoe = (id, x, z = 0, h = 4, hr = 1) => ({
    id, kind: 'robot', side: 'STEEL', mesh: { position: new V3(x, 0, z), visible: true },
    dimTop: h, dimH: h, hr,
  });
  /** 樁:自機在原點、面向 +X;準星解 / 貫穿端點 / 牆由呼叫端注入 */
  const mkShot = (o = {}) => ({
    side: 'SWARM', dead: false, shopOpen: false, gunGroup: null,
    camera: {
      position: new V3(0, 2, 0),
      getWorldDirection: (v) => v.set(1, 0, 0),
    },
    ents: new Map((o.foes || []).map((e) => [e.id, e])),
    _lobFc: o.fc || null,
    _hitR: (e) => e?.hr ?? 1,
    _altRangeTo: () => 1,
    _maxRange: (d) => d.range * 2,
    _effRange: M('_effRange'),
    _entAimPoint: M('_entAimPoint'),
    _bodyDy: M('_bodyDy'),
    _shotWarn: M('_shotWarn'),
    _inShotRange: M('_inShotRange'),
    _lancePierced: M('_lancePierced'),
    _reachable: M('_reachable'),
    _shotVictims: M('_shotVictims'),
    _shotV0: M('_shotV0'), _lobSolve: M('_lobSolve'), _lobVel: M('_lobVel'),
    _lob45Vel: M('_lob45Vel'), _arcTrace: M('_arcTrace'), _lobLadder: M('_lobLadder'),
    _layerHitT: mkWalls(o.walls || []),
    _lobCrosshair: () => ({ from: new V3(0, 2, 0), pt: o.pt || new V3(100, 2, 0), ent: o.cross || null }),
    _resolveAim: () => ({ point: o.pt || new V3(300, 2, 0), ent: null, missileId: null }),
  });
  const ids = (r) => (r ? r.hits.map((e) => e.id).sort() : null);

  // ---- ① blast:準星目標 + **同時會受到傷害的那些人**(這一代的重點)----
  {
    const { id, def } = weaponOfAoe('blast');
    const rule = reachRule(def);
    ok(rule.path === 'ray', `測試前置:${id} 的 ${def.name} = 爆炸型且走直線落點(r ${def.r}m)`);
    const A = mkFoe('A', 100), B = mkFoe('B', 100 + def.r * 1.5), C = mkFoe('C', 100 + def.r * 3);
    const c = mkShot({ foes: [A, B, C], cross: A, pt: new V3(100, 2, 0) });
    const r = c._shotVictims(def, rule);
    ok(String(ids(r)) === 'A,B',
      `爆炸型:準星目標 A 與爆風內的 B 一起亮、${(def.r * 3).toFixed(1)}m 外的 C 不亮(實得 ${ids(r)})`);
    // A11:爆風不吃 LOS —— 掩體擋在 A 與 B 之間,B 照樣入列
    const c2 = mkShot({ foes: [A, B, C], cross: A, pt: new V3(100, 2, 0),
      walls: [{ x: 100 + def.r * 0.5, top: 400 }] });
    ok(String(ids(c2._shotVictims(def, rule))) === 'A,B',
      'A11:掩體擋在爆心與 B 之間,B 仍亮(爆風繞射近似,不吃 LOS)');
    // 入口閘:準星目標打不到 ⇒ 誰都不受傷 ⇒ 全場熄燈(即使 B 就站在落點旁)
    const c3 = mkShot({ foes: [A, B, C], cross: A, pt: new V3(100, 2, 0), walls: [{ x: 50, top: 400 }] });
    ok(c3._shotVictims(def, rule) === null,
      '入口閘:準星那一發被掩體擋住 ⇒ 回 null(全場熄燈,MUST NOT 只熄準星目標那一顆)');
  }
  // ---- ② 單體直擊輕武器:只有準星那一個亮(旁邊 1m 的隊友照樣不亮)----
  {
    let picked = null;
    for (const id of Object.keys(CHARACTERS)) {
      const def = heroWeapon(id, 'light', 1);
      if (def && aoeClass(def) === null) { picked = { id, def }; break; }
    }
    ok(picked != null, '測試前置:找得到單體直擊輕武器(aoeClass = null)');
    const { def } = picked;
    const rule = reachRule(def);
    const A = mkFoe('A', 60), B = mkFoe('B', 61);
    const c = mkShot({ foes: [A, B], cross: A, pt: new V3(60, 2, 0) });
    ok(String(ids(c._shotVictims(def, rule))) === 'A',
      '單體直擊:只有準星那一個亮(這一發本來就只傷得到他)');
    ok(mkShot({ foes: [A, B], cross: null, pt: new V3(60, 2, 0) })._shotVictims(def, rule) === null,
      '單體直擊:準星壓在地上 ⇒ 誰都傷不到 ⇒ 全場熄燈');
  }
  // ---- ③ line:圓柱內的全部亮(與 sim._lanceHits 同構)----
  {
    const { id, def } = weaponOfAoe('line');
    const rule = reachRule(def);
    const R = lanceR(def);
    ok(R > 0, `測試前置:${id} 的 ${def.name} = 直線貫穿(圓柱半徑 ${R}m)`);
    const A = mkFoe('A', def.range * 0.3), B = mkFoe('B', def.range * 0.6, R * 0.4);
    const C = mkFoe('C', def.range * 0.6, R + 1 + 6);
    const D = mkFoe('D', def.range * 1.6);              // 射程外:圓柱裡但打不到
    const c = mkShot({ foes: [A, B, C, D], pt: new V3(def.range * 2, 2, 0) });
    ok(String(ids(c._shotVictims(def, rule))) === 'A,B',
      `直線貫穿:圓柱內的 A/B 一起亮、柱外的 C 與射程外的 D 不亮(實得 ${ids(c._shotVictims(def, rule))})`);
    ok(String(ids(mkShot({ foes: [A, D], pt: new V3(def.range * 2, 2, 0) })._shotVictims(def, rule))) === 'A',
      '直線貫穿:射程外的 D 在同一條圓柱上也不亮(逐目標誠實界,與伺服器 heroLance 同一條)');
  }
  // ---- ④ fan:錐內的全部亮(與 sim.heroPlasma 同構)----
  {
    const { id, def } = weaponOfAoe('fan');
    const rule = reachRule(def);
    const arc = def.arc || 15;
    const d = Math.min(50, def.range * 0.5);
    const A = mkFoe('A', d, 0);
    const B = mkFoe('B', d, d * Math.tan(arc * 0.5 * Math.PI / 180));   // 錐內
    const C = mkFoe('C', d, d * Math.tan((arc + 20) * Math.PI / 180));  // 錐外
    const c = mkShot({ foes: [A, B, C] });
    ok(String(ids(c._shotVictims(def, rule))) === 'A,B',
      `扇形(${id} ${def.name},±${arc}°):錐內的 A/B 亮、錐外的 C 不亮(實得 ${ids(c._shotVictims(def, rule))})`);
    // 建築量體撐開錐緣:中心遠在標稱錐外,但牆面就在錐裡 ⇒ MUST 亮(伺服器 heroPlasma 同判)
    const towR = hitR({ kind: 'tower', side: 'STEEL' });
    const angT = (arc + 12) * Math.PI / 180;                            // 中心偏出標稱錐 12°
    const dT = towR / Math.sin(Math.min(1.2, angT - arc * Math.PI / 180 + 0.35));   // 近到量體撐得開
    const T = mkFoe('T', dT * Math.cos(angT), dT * Math.sin(angT), 26, towR);
    ok(String(ids(mkShot({ foes: [T] })._shotVictims(def, rule))) === 'T',
      `扇形:砲塔量體(hitR ${towR}m)中心偏出標稱錐 12° 仍亮(錐緣量到近側表面)`);
    const Tfar = mkFoe('Tfar', d * 3 * Math.cos(angT), d * 3 * Math.sin(angT), 26, towR);
    ok(mkShot({ foes: [Tfar] })._shotVictims(def, rule) === null,
      '扇形:同一個偏角但距離拉遠(量體張角撐不開)⇒ 不亮(只放寬、不無限放寬)');
    // 扇形不需要準星目標(錐從槍口張開,伺服器 heroPlasma 同樣不看準星解到誰)
    ok(c._shotVictims(def, rule) !== null, '扇形:準星壓在空無處仍亮(足跡由射向定案)');
    // 準星壓在射程外的遠方敵人身上:整發性的入口閘會把整組錯誤熄掉,而那一發真的會傷到近處的 A
    const Z = mkFoe('Z', def.range * 3, 0);
    ok(String(ids(mkShot({ foes: [A, Z], cross: Z })._shotVictims(def, rule))) === 'A',
      '扇形:準星壓在射程外的敵人身上,錐內近處的 A 照樣亮(MUST NOT 讓準星目標整組熄燈)');
  }
}

// =================================================================================
sec('Ⅵ 導引 / 射後不理:承諾(光暈)與實際(彈道 + 伺服器閘門)同源');
// ---------------------------------------------------------------------------------
// 使用者 2026-07-30 回報:「雷射導引與射後不理常常有出現射程光暈卻沒命中對方」。
// `REACH_RULE.guide/fnf` 的 `path:'ray'` 承諾的是「彈頭會被導引到目標」—— 這條承諾要成立,
// 底下五件事全部 MUST 為真;舊制五件全破,而且每一件都是「靜默丟包」(玩家只看到零傷害)。
{
  // ---- ① 出膛初速只有一個縫(拋射武器吃吊射初速,不是砲口初速)----
  const v0src = methodSrc('_shotV0', G);
  ok(/return shotV0\(def, aa\);/.test(v0src) && !/Math\.min\(v0/.test(v0src) && !/\|\| 600/.test(v0src),
    'game._shotV0 只是轉呼 data.shotV0(初速夾制不再有第二份實作)');
  {
    const lob = heavyOf('lob').def;
    ok(shotV0(lob) === Math.min(lob.mv, BALLISTIC.LAUNCH_MV) && shotV0(lob) < lob.mv,
      `拋射武器吃吊射初速 ${shotV0(lob)}m/s 而非砲口初速 ${lob.mv}m/s(取錯 = 飛行時間差數倍)`);
    const fnf = heavyOf('fnf').def;
    ok(shotV0(fnf) === fnf.mv, '非拋射武器就是自己的砲口初速');
  }

  // ---- ② 著彈才回報 ⇒ 擊發資格的閘門要能把時間軸換算回擊發時刻 ----
  ok(/export const flightCapS = \(def\) =>\s*\(def \? shotFlightS\(def, def\.range \* altRangeMax\(\) \* RANGE_TOL, -altDhMax\(\)\) : 0\);/.test(D),
    'flightCapS 原文 = shotFlightS(落點閘門上界, 高差機制上限)(四個因子全推導,MUST NOT 手寫秒數)');
  ok(/export const altDhMax = \(\) => altTier\(\) \* ALTITUDE\.TIERS;/.test(D),
    'altDhMax 由 altScale 的封頂推導(俯射餘裕 MUST NOT 手寫公尺數)');
  // 飛行時間是**唯一縫**:heroBurst 的 back 與 flightCapS 都 MUST 經 shotFlightS,
  // MUST NOT 任一端自己拿 shotV0 除一次 —— 拋物線自 2026-08-02 改 45° 反解初速後,
  // `d / shotV0` 低估 2.2 倍(舊制的病灶,見下方 ②-b 的行為直測)。
  ok((D.match(/shotFlightS/g) || []).length === 2 && !/shotV0\(/.test(S),
    'shotFlightS 是飛行時間唯一縫(data.js 只有定義 + flightCapS 消費;sim.js 全檔不再自己除 shotV0)');
  {
    // ②-b 45° 拋投的飛行時間 MUST 由 45° 解推導(T = √(2d/g)),而不是 d / 砲口初速。
    // 反向驗證:把 shotFlightS 換回 `d / shotV0(def)`,這一條與下方「收鏡仍結算」都 MUST 紅字。
    const lob = heavyOf('lob').def;
    const d = lob.range;
    const t45 = Math.sqrt(2 * d / BALLISTIC.G);
    ok(Math.abs(shotFlightS(lob, d) - t45) < 1e-9,
      `拋物線飛行時間 = √(2d/g)(${t45.toFixed(2)}s),與 _lob45Vel 的 45° 解同源`);
    ok(shotFlightS(lob, d) > d / shotV0(lob) * 2,
      `舊制 d/shotV0 低估 ${(t45 / (d / shotV0(lob))).toFixed(1)} 倍 —— 這就是「榴彈只有開局有傷害」的病灶`);
    ok(flightCapS(lob) > shotFlightS(lob, d),
      '寬容窗嚴格長於滿射程的真實飛行時間(偏差朝「不擋」,原則 6)');
    const fnf = heavyOf('fnf').def;
    ok(Math.abs(shotFlightS(fnf, fnf.range) - fnf.range / shotV0(fnf)) < 1e-9,
      '非拋射彈道維持等速直線近似(逐位元同舊制)');
  }
  {
    const slow = Object.keys(CHARACTERS)
      .map((id) => heroWeapon(id, 'heavy', 1))
      .filter((d) => d && (trajClass(d) === 'fnf' || trajClass(d) === 'guide'))
      .reduce((a, d) => (flightCapS(d) > flightCapS(a) ? d : a));
    ok(flightCapS(slow) > 1,
      `最慢的導引彈頭滿射程要飛 ${flightCapS(slow).toFixed(2)}s(${slow.name})—— 這段時間裡玩家早就收鏡了`);
  }
  const aimSrc = methodSrc('heroAim', S);
  ok(/if \(h\.aiming && !on\) h\.aimOffAt = this\.t;/.test(aimSrc), 'heroAim 記錄退出瞄準的時刻');
  {
    const burst = methodSrc('heroBurst', S);
    ok(/const cap = fnf \? chaseCapS\(wp\.def\) : flightCapS\(wp\.def\);/.test(burst),
      '飛行時間上限單一縫:射後不理吃 chaseCapS(追擊)、其餘吃 flightCapS(推導不手寫)');
    ok(/this\.t - \(h\.aimOffAt \?\? -Infinity\) > cap/.test(burst),
      'heroBurst 的需瞄準閘門給滿一整段飛行時間的寬容(吃同一個 cap)');
    // 2026-08-05 起回推量與球心是**同一個解**(_shotOrigin 內部經 shotFlightS + cap 夾住);
    // 在 heroBurst 裡另外算一次 shotFlightS(dImp) 就是第二份實作,機體一移動兩份立刻分家。
    ok(/const back = org\.back;/.test(burst)
      && /back: Math\.min\(ft, cap\)/.test(methodSrc('_shotOrigin', S))
      && /back: Math\.min\(shotFlightS\(def, dist2d\(b\.x, b\.z, x, z\)\), cap\)/.test(methodSrc('_shotOrigin', S)),
      'heroBurst 由落點距離經 shotFlightS 反推擊發時刻(上限仍是 cap,不因客戶端謊報而失守)');
    ok(/this\._gateFire\(h, wp\.id, wp\.def, true, back\)/.test(burst), '擊發閘門吃回推時刻');
    const gate = methodSrc('_gateFire', S);
    ok((gate.match(/now - back \+ this\._reloadT/g) || []).length === 2,
      '_gateFire 的兩處裝填計時器都接回擊發時刻(打空 + 空夾補判)');
    ok(/if \(now - \(h\.fireAt\[id\] \|\| 0\) < 1 \/ \(def\.rate/.test(gate),
      '射速閘刻意仍量真實時鐘(著彈順序可能與擊發順序相反,回推時鐘量間隔會誤殺後到的那發)');
  }
  // 行為直測:真 BattleSim —— 合法離架後收鏡,彈頭 MUST 照樣結算;久到不可能是同一發才丟棄
  {
    const mk = (chId) => {
      const sim = new BattleSim(fakeCfg());
      purge(sim);
      const h = sim.addHero('SWARM', 'p_f1', chId);
      h.aiming = true; h.x = 3000; h.z = 3000; h.y = 0;
      sim.t = 1000;
      const wp = sim._heroWeapon(h, 'heavy');
      const t = sim._add({ kind: 'robot', side: 'STEEL', hero: true, dead: false,
        x: h.x + wp.def.range * 0.8, z: h.z, y: 0,
        hp: 9000, maxHp: 9000, armor: 0, sp: 0, maxSp: 0, lev: 0, buffs: {}, mods: [] });
      return { sim, h, wp, t };
    };
    // 這一段驗的是「收鏡寬容窗」,取**非**射後不理的導引武器 —— 射後不理的窗口是 chaseCapS
    // (追擊),兩者混在一起會驗不出「超過窗口仍丟棄」那一半。
    const chId = heavyOf('guide').id;
    const cap = flightCapS(heavyOf('guide').def);
    // ①-a 離架時在瞄準模式 → 飛行途中收鏡 → 著彈仍生效
    { const { sim, h, t } = mk(chId);
      sim.heroAim('p_f1', false);            // 收鏡(彈頭已經在天上)
      sim.t += cap * 0.5;
      sim.heroBurst('p_f1', t.x, t.z, 0, 0);
      ok(t.hp < t.maxHp, `飛行途中退出瞄準模式 → 已離架的彈頭仍結算(舊制靜默丟棄,hp ${t.hp.toFixed(0)})`); }
    // ①-b 收鏡久到超過最長飛行時間 → 這一發不可能是瞄準中打出去的 → 仍 MUST 丟棄
    { const { sim, h, t } = mk(chId);
      sim.heroAim('p_f1', false);
      sim.t += cap + 1;
      sim.heroBurst('p_f1', t.x, t.z, 0, 0);
      ok(t.hp === t.maxHp, '收鏡超過最長飛行時間後才回報的爆點 → 仍靜默丟棄(防作弊上限不失守)'); }
    // ②-a 裝填計時器接回擊發時刻:打空彈夾後,下一輪打**更近**的目標不再被吃掉。
    //     客戶端的彈夾/裝填一向從**擊發**起算(平衡模型 duel.mjs 也只看 rate/reload);伺服器若從
    //     著彈起算,整個週期就比客戶端晚一整段飛行時間 ⇒ 下一輪第一發只要打得比上一發近,
    //     著彈時伺服器還在裝填 = 靜默丟棄。這裡的時間軸一律用**客戶端的**算法推,不讀伺服器狀態。
    { const { sim, h, wp, t } = mk(chId);
      const far = wp.def.range * 0.95, near = wp.def.range * 0.05;
      const fFar = far / shotV0(wp.def), fNear = near / shotV0(wp.def);
      let lastLaunch = 0;
      for (let i = 0; i < wp.def.mag; i++) {          // 打空整個彈夾(全部打遠目標)
        lastLaunch = sim.t;                            // 擊發時刻(客戶端時鐘)
        sim.t += fFar;                                 // 飛過去
        sim.heroBurst('p_f1', h.x + far, h.z, 0, 0);
        sim.t += Math.max(0, 1 / wp.def.rate - fFar);
      }
      ok(h.ammo.heavy === 0 && h.reloadUntil.heavy > 0, '測試前置:彈夾打空並進入裝填');
      const ready = lastLaunch + sim._reloadT(h, wp.def);   // 客戶端認定的可擊發時刻
      const t2 = sim._add({ kind: 'robot', side: 'STEEL', hero: true, dead: false,
        x: h.x + near, z: h.z, y: 0, hp: 9000, maxHp: 9000, armor: 0, sp: 0, maxSp: 0, lev: 0, buffs: {}, mods: [] });
      sim.t = ready + fNear;                           // 一裝填完就打近目標,飛行時間短很多
      sim.heroBurst('p_f1', t2.x, t2.z, 0, 0);
      ok(t2.hp < t2.maxHp,
        `裝填後打更近的目標不再被靜默丟棄(遠彈飛 ${fFar.toFixed(2)}s / 近彈 ${fNear.toFixed(2)}s)`); }
    // ---- 拋物線版的同兩條(2026-08-03 使用者回報「榴彈投擲只有遊戲一開始有傷害」)----
    // 45° 拋投的滿射程航程近 6 秒,而舊制的窗口是 `d / shotV0` 除出來的 1.7 秒 ⇒ 這兩條在
    // 舊制下 100% 紅字。反向驗證:把 shotFlightS 的 lob 分支換回 `d / shotV0(def)` 即復現。
    const lobId = heavyOf('lob', 'SWARM').id;
    // 飛行時間**獨立於受測函式**推導:直接照 game._lob45Vel 的 45° 解算(v0 = √(g·d),
    // 水平分量 v0/√2 ⇒ T = √(2d/g))。拿 shotFlightS 自己餵自己會讓這兩條變成恆真
    // ——「把 lob 分支改回 d/shotV0」時測試也跟著縮短時間軸,壞版照樣全綠。
    const lob45S = (d) => Math.sqrt(2 * d / BALLISTIC.G);
    // ①-c 開完砲右鍵收鏡去移動(最自然的操作)⇒ 那一發 MUST 照樣結算
    { const { sim, wp, t } = mk(lobId);
      const fly = lob45S(wp.def.range * 0.8);
      sim.heroAim('p_f1', false);
      sim.t += fly;
      sim.heroBurst('p_f1', t.x, t.z, 0, 0);
      ok(t.hp < t.maxHp,
        `45° 拋投飛 ${fly.toFixed(2)}s 才著彈,收鏡後仍結算`
        + `(舊窗口只有 ${(wp.def.range * 0.8 / shotV0(wp.def)).toFixed(2)}s ⇒ 整輪靜默丟棄)`); }
    // ②-b 這一輪打遠、下一輪打近:舊制伺服器的裝填窗比客戶端晚 4 秒 ⇒ 近的那一輪整輪被吃掉
    { const { sim, h, wp } = mk(lobId);
      const far = wp.def.range * 0.9, near = wp.def.range * 0.2;
      const fFar = lob45S(far), fNear = lob45S(near);
      let lastLaunch = 0;
      for (let i = 0; i < wp.def.mag; i++) {
        lastLaunch = sim.t;
        sim.t += fFar;
        sim.heroBurst('p_f1', h.x + far, h.z, 0, 0);
        sim.t += Math.max(0, 1 / wp.def.rate - fFar);
      }
      ok(h.ammo.heavy === 0 && h.reloadUntil.heavy > 0, '測試前置:拋物線彈夾打空並進入裝填');
      const t2 = sim._add({ kind: 'robot', side: 'STEEL', hero: true, dead: false,
        x: h.x + near, z: h.z, y: 0, hp: 9000, maxHp: 9000, armor: 0, sp: 0, maxSp: 0, lev: 0, buffs: {}, mods: [] });
      sim.t = lastLaunch + sim._reloadT(h, wp.def) + fNear;   // 客戶端一裝填完就打近目標
      sim.heroBurst('p_f1', t2.x, t2.z, 0, 0);
      ok(t2.hp < t2.maxHp,
        `拋物線裝填後打更近的目標不再整輪丟棄(遠彈飛 ${fFar.toFixed(2)}s / 近彈 ${fNear.toFixed(2)}s)`); }
  }

  // ---- ③ 射後不理真的會追蹤:MUST NOT 只認伺服器複驗過的 _lockId ----
  {
    const fire = methodSrc('_tryFire', G);
    ok(/this\._aimTarget\(rng\)\?\.id/.test(fire),
      '_tryFire 的追蹤目標在拿不到 _lockId 時退回擊發當下的準星解(_aimTarget)');
    ok(!/def\.type === 'missile' && this\._lockId != null/.test(fire),
      '_tryFire 不再「只認 _lockId」(而射程光暈刻意排除 _lockId ⇒ 每個亮著的目標都保證不被追蹤)');
    // 2026-08-04 使用者回報「準星沒有照到目標時,彈體會往先前鎖定的敵人飛去」:
    // `_lockId` 是**上一個**伺服器複驗過的鎖定,準星移開後要等 `_tickLock` 下一次 4Hz 心跳才清得掉。
    // 追蹤目標 MUST 只由**擊發當下的準星解**決定 ⇒ `_tryFire` 全段不得再出現 `_lockId`
    // (鎖定該有的黏著住在 `_coneAcquire` 的遲滯錨 `keepId`,不在擊發端)。
    // 單一縫計數 MUST 剝掉註解 —— 否則「解釋為什麼不能讀 _lockId」的那段註解自己會讓斷言紅字
    const fireBare = fire.replace(/\/\*[\s\S]*?\*\//g, '')
      .split('\n').map((l) => l.replace(/\/\/.*$/, '')).join('\n');
    ok(!/_lockId/.test(fireBare),
      '_tryFire 全段不讀 _lockId:追蹤目標只認擊發當下的準星解(準星沒照到 ⇒ 直飛,不追舊鎖定)');
    ok(/const homing = def\.type === 'missile' \? \(this\._aimTarget\(rng\)\?\.id \?\? null\) : null;/.test(fire),
      '追蹤目標定案只有一行(單一縫;準星解不到即 null = 不追蹤)');
    ok(/keepId = opt && 'keepId' in opt \? opt\.keepId : this\._lockId/.test(methodSrc('_coneAcquire', G)),
      '對照:鎖定的黏著仍在 _coneAcquire 的遲滯錨上(準星仍壓在同一個錐內才續留)');
    ok(/ent\.id !== this\._lockId/.test(methodSrc('_updateRangeGlows', G)),
      '對照:_updateRangeGlows 確實把鎖定目標排除在射程光暈之外(鎖定另有 lockGlow)');
    const at = methodSrc('_aimTarget', G);
    ok(/this\._resolveAim\(rng\)/.test(at) && /this\._coneAcquire\(rng\)/.test(at) && /this\._lobFc/.test(at),
      '_aimTarget 三段齊全(火控解 → 準星射線 → 錐形輔助)');
    const tl = methodSrc('_tickLock', G);
    ok(/this\._aimTarget\(/.test(tl) && !/this\._coneAcquire\(/.test(tl) && !/this\._resolveAim\(/.test(tl),
      '_tickLock 改吃 _aimTarget(目標解析只有一份實作,擊發端與回報端同源)');
  }

  // ---- ④ 近炸引信量線段最近點、半徑與光暈承諾的 tol 同一式 ----
  {
    const ub = methodSrc('_updateBullets', G);
    ok(!/Math\.max\(4, \(b\.r \|\| 0\) \* 0\.5\)/.test(ub),
      '近炸引信不再手寫 max(4, r×0.5)(r×0.5 是手抄的 BLAST.CORE = 第二份實作)');
    ok(/\(b\.core \|\| 0\) \+ this\._hitR\(tgt\)/.test(ub),
      '引信半徑 = 爆風核心帶 + 目標水平量體(與 _reachable 的 blastCoreR(def) + hr 同一式)');
    ok(/core: blastCoreR\(def\)/.test(methodSrc('_tryFire', G)), '核心帶於擊發當下由 blastCoreR 推導一次');
    ok(/const s = l2 > 1e-9/.test(ub) && /Math\.max\(0, Math\.min\(1,/.test(ub),
      '引信量的是**這一幀掃過的線段**上的最近點(夾制在 [0,1];點取樣會被高速彈跨過去)');
    ok(/const spent = b\.pos\.distanceTo\(b\.origin\);/.test(ub),
      '射程包絡量「離發射點的直線距離」(與失鎖判定/伺服器落點閘門/射程光暈三處同一把尺)');
  }

  // ---- ⑤ 導引頭轉得過來:轉彎半徑上限只放寬不收緊 ----
  {
    ok(seekTurn(SEEK.HOME_W, 1) === SEEK.HOME_W && seekTurn(SEEK.RIDE_W, 1) === SEEK.RIDE_W,
      'seekTurn 對慢彈逐位元回傳基礎角速度(既有手感零回歸)');
    let widened = 0, narrowed = 0;
    for (const id of Object.keys(CHARACTERS)) {
      const def = heroWeapon(id, 'heavy', 1);
      if (!def || !armingOf(def)) continue;
      const v0 = shotV0(def);
      for (const w of [SEEK.HOME_W, SEEK.RIDE_W]) {
        if (seekTurn(w, v0) < w) narrowed++;
        else if (seekTurn(w, v0) > w) widened++;
      }
    }
    ok(narrowed === 0, `seekTurn 對任何武器都不收緊(收緊 ${narrowed} 例)`);
    ok(widened > 0, `確實有轉不過來的導引頭被拉高角速度(${widened} 例;沒有 = 這道上限沒作用)`);
    const ub = methodSrc('_updateBullets', G);
    ok(/seekTurn\(SEEK\.HOME_W, b\.mv\)/.test(ub) && /seekTurn\(SEEK\.RIDE_W, b\.mv\)/.test(ub),
      '_updateBullets 的兩處轉向都經 seekTurn(MUST NOT 手寫 rad/s)');
    ok(!/, 3\.2\)/.test(ub) && !/, 2\.2\)/.test(ub), '_updateBullets 不再殘留手寫轉角常數');
  }

  // ---- ⑥ 行為直測:導引狀態下「光暈亮 = 打得到」逐武器逐距離成立 ----
  // 本段是 `_updateBullets` 導引積分的**鏡射**(那支函式吃 three/scene/raycaster,Node 端抽不出來)。
  // 鏡射一定要釘住,否則改了 game.js 這裡照樣全綠 —— 積分用到的每一個決策點都在上面 ④⑤ 以
  // **執行原文**斷言過(兩處 seekTurn 呼叫、引信半徑式、線段最近點、seek 的直線包絡),再加下面
  // 兩條導引點原文。任何一項被改掉,原文斷言先紅。
  {
    const ub = methodSrc('_updateBullets', G);
    ok(/Math\.max\(20, _TMP_A\.copy\(b\.pos\)\.sub\(ro\)\.dot\(rd\) \+ 40\)/.test(ub),
      '騎波導引點 = 準星射線上、彈體前方 40m(鏡射積分吃同一組數)');
    ok(/const armed = prev\.distanceTo\(b\.origin\) >= \(b\.arm \|\| 0\);/.test(ub),
      '解保險距離與射程量同一顆球(離發射點的直線距離)');

    const sub3 = (a, b2) => [a[0] - b2[0], a[1] - b2[1], a[2] - b2[2]];
    const len3 = (v) => Math.hypot(v[0], v[1], v[2]);
    const nrm3 = (v) => { const l = len3(v) || 1; return v.map((x) => x / l); };
    const dot3 = (a, b2) => a[0] * b2[0] + a[1] * b2[1] + a[2] * b2[2];
    const segD = (p0, p1, c) => {          // 線段最近點距離(與引信同式)
      const d = sub3(p1, p0), l2 = dot3(d, d);
      const s = l2 > 1e-9 ? Math.max(0, Math.min(1, dot3(sub3(c, p0), d) / l2)) : 0;
      return len3(sub3([p0[0] + d[0] * s, p0[1] + d[1] * s, p0[2] + d[2] * s], c));
    };
    /** mode:'home' 追蹤 / 'guide' 騎波 / 'dumb' 無導引(純重力)。回傳整段航程的最近通過距離 */
    const fly = (def, dist, mode) => {
      const v0 = shotV0(def), arm = armingOf(def).m, max = def.range, sp = armingOf(def).spread;
      const eye = [0, 2, 0], tgt = [dist, 2, 0];
      let pos = [...eye], vel = nrm3([Math.cos(sp), Math.sin(sp), 0]).map((x) => x * v0);
      let best = Infinity;   // 解保險與射程一律量離發射點的直線距離(球面;航跡長已整組退場)
      const dt = 1 / 60;
      const turn = (want, w) => {          // game.js 的 steer():等速改向,每秒最大轉角 w
        const cur = nrm3(vel);
        const ang = Math.acos(Math.max(-1, Math.min(1, dot3(cur, want))));
        const k = Math.min(1, w * dt / (ang || 1e-9));
        vel = nrm3(cur.map((c, i) => c + (want[i] - c) * k)).map((x) => x * v0);
      };
      for (let i = 0; i < 20000; i++) {
        const armed = len3(sub3(pos, eye)) >= arm;
        if (mode === 'home' && armed) {
          turn(nrm3(sub3([tgt[0], tgt[1] + 1.5, tgt[2]], pos)), seekTurn(SEEK.HOME_W, v0));
        } else if (mode === 'guide' && armed) {
          const rd = nrm3(sub3(tgt, eye));
          const along = Math.max(20, dot3(sub3(pos, eye), rd) + 40);
          turn(nrm3(sub3(eye.map((e, k2) => e + rd[k2] * along), pos)), seekTurn(SEEK.RIDE_W, v0));
        } else vel[1] -= BALLISTIC.G * dt;
        const prev = [...pos];
        pos = pos.map((p, k2) => p + vel[k2] * dt);
        best = Math.min(best, segD(prev, pos, tgt));
        if (pos[1] <= 0) break;
        if (len3(sub3(pos, eye)) >= max) break;
      }
      return best;
    };
    const missGuided = [], notBetter = [], dumbMiss = [];
    let n = 0, guns = 0;
    for (const id of Object.keys(CHARACTERS)) {
      const def = heroWeapon(id, 'heavy', 1);
      if (!def || !armingOf(def)) continue;
      guns++;
      const mode = trajClass(def) === 'fnf' ? 'home' : 'guide';
      const tol = blastCoreR(def) + hitR({ kind: 'robot' });
      for (const f of [0.35, 0.5, 0.7, 0.85, 1.0]) {
        const d = def.range * f;
        if (d < armingOf(def).m * 1.15) continue;      // 軌跡修正期內本來就該打歪(光暈已轉警示色)
        n++;
        if (fly(def, d, mode) > tol) missGuided.push(`${id}@${(f * 100) | 0}%`);
      }
      // 滿射程對照:導引 MUST 嚴格優於無導引(否則「有沒有接手導引」根本不是差別所在)
      const full = def.range;
      const g = fly(def, full, mode), u = fly(def, full, 'dumb');
      if (!(g < u)) notBetter.push(`${id}(導引 ${g.toFixed(1)} ≮ 無導引 ${u.toFixed(1)})`);
      if (u > tol) dumbMiss.push(id);
    }
    ok(missGuided.length === 0,
      `${n} 組(武器 × 距離)在導引狀態下全部落在爆風核心帶內(離群:${missGuided.join(' ') || '無'})`);
    ok(notBetter.length === 0,
      `${guns} 把導引/射後不理武器在滿射程都是「有導引明顯更準」(離群:${notBetter.join(' ') || '無'})`);
    ok(dumbMiss.length >= guns - 1,
      `對照:${dumbMiss.length}/${guns} 把在**沒有導引**時滿射程落到核心帶外`
      + ' —— 這正是「追蹤目標不能只認 _lockId」的理由(舊制每個亮著光暈的目標都保證無導引)');
  }
}

// =================================================================================
sec('Ⅶ 光暈 ⇔ 傷害:沒有射程光暈的敵人 MUST NOT 掉血(2026-08-01 使用者回報)');
// ---------------------------------------------------------------------------------
// 使用者情境:雙方都固定不動。此時沒有任何網路延遲/彈道飛行的藉口 ——
// 「亮 = 打得到、不亮 = 打不到」MUST 是一個等價命題,兩端的有效射程 MUST 是**同一個數字**。
// 舊制有兩條各自獨立的隱形加成,疊起來 = 1.5625 × 光暈射程:
//   ① `_sightY` **跨參考框相減**:英雄回報的 ay 是絕對高程(含地形海拔,真實場地動輒數百公尺),
//      NPC/塔在伺服器是離地高 + 基準 0 ⇒ 相減 = 拿海拔當高度差 ⇒ altScale 直接封頂
//      = 英雄對**所有** NPC 恆 +25% 射程,而客戶端光暈量本地地形 ⇒ 恆 1。
//   ② `heroPlasma`(扇形)乘 `RANGE_TOL`:那是放給「客戶端已自行夾過射程的回報」的網路寬容,
//      而扇形武器只回報一個射向、**沒有任何客戶端閘門** ⇒ 寬容直接變成 25% 隱形射程。
{
  // ---- ① 同框比較:跨框相減 MUST 不再發生 ----
  const dh = methodSrc('_altDh', S);
  ok(/a\.hero && a\.ay != null && b\.hero && b\.ay != null/.test(dh),
    '_altDh:只有雙方都是回報 ay 的英雄才用絕對框(否則退回離地框)');
  ok(/this\._sightY\(a, false\) - this\._sightY\(b, false\)/.test(dh),
    '_altDh:退回時兩邊都吃離地框(`abs=false`)—— 一邊絕對一邊離地就是病灶本身');
  const rangeM = methodSrc('_altRange', S);
  ok(/altRangeF\(this\._altDh\(shooter, target\)\)/.test(rangeM),
    '_altRange 走 data.js altRangeF + _altDh 兩個唯一縫(MUST NOT 自寫曲線或自己相減 _sightY)');
  for (const m of ['_altCrit', '_dodgeP']) {   // 閃避率的算式 2026-08-12 拆進 _dodgeP(_dodges 只剩擲骰)
    ok(/this\._altDh\(/.test(methodSrc(m, S)) && !/this\._sightY\([a-z]+\) - this\._sightY\(/.test(methodSrc(m, S)),
      `${m} 的高度差也走 _altDh(三個消費端同一把尺,MUST NOT 只修射程那一份)`);
  }
  // 行為直測:海拔 500m 的場地,英雄對地面小兵 MUST 不再拿到高度加成
  const sim = new BattleSim(fakeCfg());
  purge(sim);
  const h = sim.addHero('SWARM', 'p_alt', Object.keys(CHARACTERS)[0]);
  h.x = 700; h.z = 700; h.y = 0; h.ay = 500 + 2;      // 絕對視線高程 = 場地海拔 + 眼高
  const npc = { kind: 'soldier', side: 'STEEL', x: 700, z: 760, y: 0 };
  ok(sim._altRange(h, npc) === 1,
    `海拔 500m 的英雄對地面小兵無高度加成(實得 ×${sim._altRange(h, npc)};舊制 ×1.25 = 隱形 +25% 射程)`);
  h.y = 0;
  const hiHero = { hero: true, ay: 500 + 2, y: 0 }, loHero = { hero: true, ay: 500 - 90, y: 0 };
  ok(sim._altRange(h, loHero) > 1 && sim._altRange(h, hiHero) === 1,
    '對照:英雄 vs 英雄(兩邊都有 ay)仍精確吃高度制空 —— 修的是跨框,不是把機制關掉');
  ok(sim._altRange(h, loHero) === altRangeF(92), '英雄對英雄的倍率 = altRangeF(絕對高程差)');
}
{
  // ---- ② 扇形武器:伺服器自己選目標的唯一一條英雄武器路徑 ⇒ MUST 吃誠實界 ----
  const plasma = methodSrc('heroPlasma', S).replace(/^\s*(\/\/|\*).*$/gm, '');
  ok(!/RANGE_TOL/.test(plasma),
    'heroPlasma 的射程閘門不乘 RANGE_TOL(沒有客戶端閘門可寬容,寬容 = 隱形射程)');
  ok(/wp\.def\.range \* this\._altRange\(b, t, wp\.def\)/.test(plasma),
    'heroPlasma 仍吃 range × 高度制空(誠實界,與 botFire 同一條規則)');
  // 行為直測:射程內掉血、射程外一律不掉(舊制到 1.25 × 射程都還在掉血)
  const sim = new BattleSim(fakeCfg());
  purge(sim);
  const fanCh = Object.keys(CHARACTERS).find((c) => heroWeapon(c, 'light', 1)?.fan);
  const wf = heroWeapon(fanCh, 'light', 1, true);
  const fh = sim.addHero('SWARM', 'p_fan', fanCh);
  fh.x = 700; fh.z = 700; fh.y = 0;
  const shoot = (f) => {
    const t = sim._add({ kind: 'soldier', side: 'STEEL', x: fh.x, z: fh.z + wf.range * f, y: 0, hp: 999999, maxHp: 999999 });
    sim.t += 5;
    fh.ammo.light = wf.mag; fh.reloadUntil.light = 0; fh.fireAt.light = -99;
    const hp0 = t.hp;
    sim.heroPlasma('p_fan', 0, 1, 'light');
    const hurt = t.hp < hp0;
    sim.ents.delete(t.id);
    return hurt;
  };
  ok(shoot(0.95), `射程內(0.95 × ${wf.range}m)的扇形目標照常掉血`);
  for (const f of [1.05, 1.15, 1.24]) {
    ok(!shoot(f), `${f.toFixed(2)} × 射程(光暈不亮)的扇形目標 MUST NOT 掉血(舊制 ≤1.25 全中)`);
  }
}
{
  // ---- ③ 客戶端與伺服器的有效射程 MUST 是同一個數字 ----
  const eff = methodSrc('_effRange', G);
  ok(/def\?\.range \|\| 0\) \* this\._altRangeTo\(ent\)/.test(eff),
    '_effRange = range × _altRangeTo(逐目標;客戶端的唯一有效射程縫)');
  const to = methodSrc('_altRangeTo', G);
  ok(/ent\.hero/.test(to) && /this\.pos\.y \+ this\._eyeH\(\)/.test(to),
    '_altRangeTo 的絕對框只對英雄成立,且我方高程與回報伺服器的 ay 同一式(pos.y + _eyeH)');
  ok(/LOS\.TOWER_EYE_M/.test(to) && /LOS\.TGT_M/.test(to) && /this\._altAG/.test(to),
    '_altRangeTo 的離地框逐條照抄 sim._sightY(塔砲位高 / 目標身高 / 我方 _altAG)');
  ok(!/terrain\.heightAt/.test(to),
    '_altRangeTo MUST NOT 再拿「前方地表」近似目標高程(舊制的第二份公式 = 兩端必然分家)');
  // 兩端同式直測:非英雄目標一律 1(伺服器算不出 NPC 海拔 ⇒ 兩端都 MUST 是 1)
  const sim = new BattleSim(fakeCfg());
  purge(sim);
  const h2 = sim.addHero('SWARM', 'p_c', Object.keys(CHARACTERS)[0]);
  h2.ay = 812; h2.y = 0;
  const cases = [{ kind: 'soldier' }, { kind: 'tower' }, { kind: 'base' }];
  ok(cases.every((t) => sim._altRange(h2, { ...t, side: 'STEEL', x: 0, z: 0, y: 0 }) === 1),
    '伺服器對小兵/塔/主堡一律 ×1 = 客戶端 _altRangeTo 的離地框結果(平地站立 _altAG=0)');
}

// =================================================================================
sec('Ⅷ 隔山打牛:伺服器自己選目標的路徑 MUST 自己驗地形(2026-08-01 使用者需求)');
// ---------------------------------------------------------------------------------
// 伺服器是無地形高程的 2D 平面:`_losBlocked` 只認上傳的障礙柱與水平薄板,山稜不存在。
// 客戶端回報型的攻擊(heroHit / heroBurst / heroLance 的射線)本來就被本端 193² 解析地形
// 截斷過,看不出問題;而**伺服器自己選目標**的兩條路(heroPlasma 錐內選人、_lanceHits
// 圓柱內選人 —— 後者含 botFire 自建的未截斷射線)沒有這道保護 ⇒ 隔山打牛。
// 而客戶端射程光暈對這兩類武器吃的是 REACH_RULE 的 hit:'clear'(線段整段淨空,含地形)
// ⇒ 光暈早就說打不到,伺服器照樣扣血 = 又一次「光暈 ⇔ 傷害」分家。
{
  // ---- 靜態:編碼單一縫 + 消費端只有該有的那兩處 ----
  ok(HGT_CHARS.length === 64 && HGT_LEVELS === 64 * 64,
    `高程編碼字母表 64 個字元、${HGT_LEVELS} 階(2 字元/格,推導不手寫)`);
  ok(HGT_STEP < LOS.RIDGE_M,
    `量化步長 ${HGT_STEP}m < 認定餘裕 ${LOS.RIDGE_M}m(量化誤差吃不進判定)`);
  ok(/hgtEnc\(/.test(read(['public', 'js', 'main.js'])) && /HGT_CHARS/.test(S),
    '烘烤端(main.js)與解析端(sim.js)同吃 data.js 的編碼縫,MUST NOT 各寫一份字母表');
  ok(!/_ridgeBlocked/.test(methodSrc('_losBlocked', S)),
    '_ridgeBlocked MUST NOT 併進 _losBlocked —— 客戶端回報型攻擊已被本端解析地形截斷,'
    + '再驗一次只會因兩份解析度不同而多擋掉合法傷害(A30 靜默丟包)');
  const users = (S.match(/this\._ridgeBlocked\(/g) || []).length;
  ok(users === 2, `_ridgeBlocked 恰好兩個消費端(heroPlasma / _lanceHits;實得 ${users})`);
  ok(/this\._ridgeBlocked\(/.test(methodSrc('heroPlasma', S))
    && /this\._ridgeBlocked\(/.test(methodSrc('_lanceHits', S)),
    '兩個消費端就是扇形(heroPlasma)與直線貫穿(_lanceHits)');
  const rb = methodSrc('_ridgeBlocked', S);
  ok(/if \(!g\) return false;/.test(rb), '沒有網格(e2e/headless/舊版房主)一律放行 —— 舊行為逐位元不變');
  ok(/this\._unitLev\(ea\) === 2 \|\| this\._unitLev\(eb\) === 2/.test(rb),
    '任一端在隧道內一律放行(高程網格是未開挖的山體,洞內頭頂永遠壓著一座山)');
  ok(/LOS\.RIDGE_M/.test(rb) && /LOS\.RIDGE_SKIP_M/.test(rb),
    '餘裕與端點豁免帶都吃 LOS 常數(MUST NOT 手寫公尺數)');
}
{
  // ---- 行為直測:合成一道山脊,真 BattleSim 打過去 ----
  const cell = LOS.HGT_M, cols = 64, rows = 64, minX = 400, minZ = 400, minH = 0;
  const bake = (fn) => {
    let data = '';
    for (let i = 0; i < rows; i++) {
      const z = minZ + (i + 0.5) * cell;
      for (let j = 0; j < cols; j++) data += hgtEnc(fn(minX + (j + 0.5) * cell, z), minH);
    }
    return { minX, minZ, cell, cols, rows, minH, data };
  };
  const RIDGE = (x, z) => (Math.abs(z - 740) < 20 ? 60 : 0);          // z=740 一道 60m 山脊
  const SLOPE = (x, z) => (z - minZ) * 0.35;                          // 均勻 19° 緩坡(雙方都站在坡上)
  const fanCh = Object.keys(CHARACTERS).find((c) => heroWeapon(c, 'light', 1)?.fan);
  const wf = heroWeapon(fanCh, 'light', 1, true);
  /** 建一個裝好高程網格的 sim,回傳「往 +z 開一發扇形,距離 d 的目標有沒有掉血」 */
  const mk = (hgt) => {
    const sim = new BattleSim(fakeCfg());
    purge(sim);
    if (hgt) sim.setWorld({ occ: [], cor: [], slabs: [], hgt });
    const fh = sim.addHero('SWARM', 'p_r', fanCh);
    fh.x = 700; fh.z = 700; fh.y = 0;
    return { sim, fh, shoot(tz, gy) {
      const t = sim._add({ kind: 'soldier', side: 'STEEL', x: 700, z: tz, y: 0, hp: 999999, maxHp: 999999 });
      sim.t += 5;
      fh.ammo.light = wf.mag; fh.reloadUntil.light = 0; fh.fireAt.light = -99;
      const hp0 = t.hp;
      sim.heroPlasma('p_r', 0, 1, 'light');
      const hurt = t.hp < hp0;
      sim.ents.delete(t.id);
      return hurt;
    } };
  };
  const R = mk(bake(RIDGE));
  ok(!!R.sim._hgtGrid, '粗高程網格收得進來(setWorld 的 hgt 欄位)');
  ok(Math.abs(R.sim._hgtAt(700, 700)) < 1 && R.sim._hgtAt(700, 740) > 40,
    `雙線性取樣讀得到山脊(平地 ${R.sim._hgtAt(700, 700).toFixed(1)}m / 脊頂 ${R.sim._hgtAt(700, 740).toFixed(1)}m)`);
  ok(R.shoot(730), '山脊**前**的目標照常掉血(同側,射程內)');
  ok(!R.shoot(780), '山脊**後**的目標 MUST NOT 掉血(隔山打牛已擋掉;射程內、錐內、無障礙柱)');
  // 對照:同一組座標,沒有高程網格(e2e/headless)⇒ 舊行為,照樣打得到
  const N = mk(null);
  ok(N.shoot(780), '對照:未上傳高程網格時行為逐位元不變(判定 no-op,e2e 確定性不受影響)');
  // 保守性:均勻緩坡上「雙方都站在坡上」MUST NOT 被自己腳下的地擋住(端點豁免 + 餘裕)
  const P = mk(bake(SLOPE));
  ok(P.shoot(780), '均勻緩坡上互射 MUST NOT 被誤擋(偏差方向一律朝「不擋」,原則 6)');
  // 殘缺/壞掉的網格整份不收(半份網格 = 半張地圖隔山打牛)
  const bad = mk(null);
  bad.sim._worldSet = false;
  bad.sim.setWorld({ occ: [], cor: [], slabs: [], hgt: { ...bake(RIDGE), data: 'AA' } });
  ok(!bad.sim._hgtGrid, '長度不足的網格整份不收(寧缺勿錯,MUST NOT 收半份)');
}
{
  // ---- 直線貫穿:超過射程就沒傷害(圓柱端帽不得再放 25% 寬容)----
  const lance = methodSrc('heroLance', S);
  ok(/wp\.def\.range \* this\._altRange\(b, t, wp\.def\)\) continue;/.test(lance),
    'heroLance 逐目標射程閘門吃誠實界(d3 從回報槍口量起,與射程光暈同一個起點)');
  ok(/wp\.def\.range \* altRangeMax\(\)\);/.test(lance),
    '射線長上限 = range × altRangeMax()(誠實界;len 本來就是客戶端夾過的)');
  const sim = new BattleSim(fakeCfg());
  purge(sim);
  const lineCh = heavyOf('line');
  const wl = heroWeapon(lineCh.id, 'heavy', 1, true);
  const lh = sim.addHero(CHARACTERS[lineCh.id].side === 'STEEL' ? 'STEEL' : 'SWARM', 'p_ln', lineCh.id);
  lh.x = 700; lh.z = 700; lh.y = 0; lh.aiming = true;
  const fire = (f) => {
    const t = sim._add({ kind: 'soldier', side: lh.side === 'SWARM' ? 'STEEL' : 'SWARM',
      x: 700, z: 700 + wl.range * f, y: 0, hp: 999999, maxHp: 999999 });
    sim.t += 30;
    lh.ammo.heavy = wl.mag; lh.reloadUntil.heavy = 0; lh.fireAt.heavy = -99; lh.mp = lh.maxMp;
    const hp0 = t.hp;
    // 射線長照客戶端上限(range × altRangeMax)回報 —— 伺服器仍 MUST 以逐目標誠實界夾回
    sim.heroLance('p_ln', [700, 700, 2], [0, 1, 0], wl.range * 1.25);
    const hurt = t.hp < hp0;
    sim.ents.delete(t.id);
    return hurt;
  };
  ok(fire(0.9), `直線貫穿射程內(0.9 × ${wl.range}m)照常掉血`);
  for (const f of [1.05, 1.2]) {
    ok(!fire(f), `${f.toFixed(2)} × 射程(光暈不亮)的直線貫穿目標 MUST NOT 掉血(舊制 ≤1.25 全中)`);
  }
}

// =================================================================================
sec('Ⅸ 射後不理:鎖定後持續追擊不受射程影響(但只能射程內鎖定)—— 2026-08-01 使用者定案');
// ---------------------------------------------------------------------------------
// 規則拆成兩半,兩半 MUST 同時成立才叫「對」:
//   ① **只能在射程內鎖定** —— 客戶端 `_tickLock` 以 `_effRange` 誠實夾回、伺服器 `heroLock`
//      再驗一次射程 / 迷霧 / LOS。沒有這一半,規則就等於「無限射程」。
//   ② **鎖定之後不受射程影響** —— 彈道的射程包絡整條讓位給追擊燃料(`chaseCapS`,推導不手寫),
//      伺服器的落點閘門**追加**一條綁鎖定目標的放行。
// 防作弊沒有變鬆:沒有鎖定就沒有豁免;有鎖定也只有炸在那個目標的爆風核心帶內才豁免。
// 2026-08-03 使用者定案「中途爆炸也要有傷害」:那條放行是**加分題不是替代題** —— 彈頭在半路
// 撞到小兵/建物/地形就地引爆,爆點當然不在鎖定目標身上,舊制的 `if (lockT) … else` 把它連同
// 一般落點閘門一起判掉 ⇒ 前線一有東西擋路,整發飛彈靜默丟包(開局空曠打得到、兵線鋪開後打不到)。
const FNF = heavyOf('fnf');   // 任一名射後不理角色(不寫死角色代號:資料改了稽核仍成立)
{
  ok(Math.abs(chaseCapS(FNF.def) - flightCapS(FNF.def) * SEEK.CHASE_F) < 1e-12,
    'chaseCapS = flightCapS × SEEK.CHASE_F(推導不手寫)');
  ok(SEEK.CHASE_F > 1, `追擊燃料嚴格長於滿射程飛行時間(×${SEEK.CHASE_F})`);
  ok(chaseCapS(FNF.def) * shotV0(FNF.def) > FNF.def.range * 3,
    `追擊里程 ${(chaseCapS(FNF.def) * shotV0(FNF.def)).toFixed(0)}m 遠大於武器射程 ${FNF.def.range}m`
    + '(上限只是不讓失控彈體永遠留在場上,MUST NOT 拿它當射程的替身)');
  const upd = methodSrc('_updateBullets', G);
  ok(/if \(tgt && !b\.fnf && tgt\.mesh\.position\.distanceTo\(b\.origin\) > b\.max\)/.test(upd),
    '失鎖規則(離開發射源射程 → 直線飛行)對射後不理 MUST NOT 生效(A7 已改寫)');
  ok(/if \(b\.fnf && tgt\) b\.chase = true;/.test(upd),
    '追擊旗標一經鎖定即不可逆(目標中途陣亡也照飛,不會突然被射程包絡砍掉)');
  ok(/const done = hit \|\| \(b\.chase \? b\.age >= b\.fuel : spent >= b\.max\);/.test(upd),
    '追擊中射程包絡整條讓位給燃料;沒追擊的彈體維持原本的 b.max 包絡(逐位元不變)');
  const tl = methodSrc('_tickLock', G);
  ok(/this\._effRange\(def, t0\)/.test(tl), '對照:①「只能射程內鎖定」仍由 _tickLock 的 _effRange 把關');
  const lockSrc = methodSrc('heroLock', S);
  ok(/\.range \* RANGE_TOL\) return;/.test(lockSrc) && /_losBlocked/.test(lockSrc) && /_visibleTo/.test(lockSrc),
    '對照:伺服器 heroLock 複驗射程 / 迷霧 / LOS 三道(鎖定是唯一入口,豁免全掛在它身上)');
}
{
  // 行為直測:真 BattleSim —— 有鎖定就追得到,沒鎖定照舊被落點閘門擋下
  const sim = new BattleSim(fakeCfg());
  purge(sim);
  const side = CHARACTERS[FNF.id].side === 'STEEL' ? 'STEEL' : 'SWARM';
  const foe = side === 'SWARM' ? 'STEEL' : 'SWARM';
  const h = sim.addHero(side, 'p_fnf', FNF.id);
  h.x = 700; h.z = 700; h.y = 0;
  const impCap = FNF.def.range * altRangeMax() * RANGE_TOL;
  const shoot = (d, lock, offset = 0) => {
    const t = sim._add({ kind: 'soldier', side: foe, x: 700, z: 700 + d, y: 0, hp: 999999, maxHp: 999999 });
    const aim = offset ? sim._add({ kind: 'soldier', side: foe, x: 700, z: 700 + d + offset, y: 0, hp: 999999, maxHp: 999999 }) : t;
    sim.t += 60;
    h.ammo.heavy = FNF.def.mag; h.reloadUntil.heavy = 0; h.fireAt.heavy = -99; h.mp = h.maxMp; h.aiming = true;
    const sq = sim.squads.get('p_fnf');
    if (lock) { sq.lock = t.id; sq.lockAt = sim.t; } else { sq.lock = 0; sq.lockAt = -999; }
    const hp0 = aim.hp;
    sim.heroBurst('p_fnf', aim.x, aim.z, 0, 0);
    const hurt = aim.hp < hp0;
    sim.ents.delete(t.id); if (aim !== t) sim.ents.delete(aim.id);
    return hurt;
  };
  const inCap = Math.round(FNF.def.range * 0.8), farOut = Math.round(impCap * 2.3);
  ok(shoot(inCap, false), `射程內(${inCap}m)無鎖定也照常結算(落點閘門內)`);
  ok(!shoot(farOut, false), `${farOut}m > 落點閘門 ${impCap.toFixed(0)}m 且**無鎖定** ⇒ MUST 丟棄(沒有鎖定就沒有豁免)`);
  ok(shoot(farOut, true), `${farOut}m 但**有伺服器複驗過的鎖定** ⇒ 照樣結算(鎖定後不受射程影響)`);
  ok(!shoot(farOut, true, blastCoreR(FNF.def) * 8),
    '有鎖定但炸在遠離鎖定目標的地方 ⇒ 仍丟棄(豁免只放給「炸在那個目標身上」,MUST NOT 變成隨便一個遠點)');
  // 中途爆炸(2026-08-03 使用者定案):有鎖定、但彈頭在半路撞到別的東西就地引爆 ——
  // 爆點離鎖定目標很遠卻仍在**一般落點閘門內** ⇒ MUST 退回一般閘門照常結算。
  // 反向驗證:把 heroBurst 的 `chased` 改回 `if (lockT) … else`,這一條 MUST 立刻紅字。
  {
    const near = Math.round(FNF.def.range * 0.3);
    const t = sim._add({ kind: 'soldier', side: foe, x: 700, z: 700 + FNF.def.range * 0.8, y: 0, hp: 999999, maxHp: 999999 });
    const mid = sim._add({ kind: 'soldier', side: foe, x: 700, z: 700 + near, y: 0, hp: 999999, maxHp: 999999 });
    sim.t += 60;
    h.ammo.heavy = FNF.def.mag; h.reloadUntil.heavy = 0; h.fireAt.heavy = -99; h.mp = h.maxMp; h.aiming = true;
    const sq3 = sim.squads.get('p_fnf');
    sq3.lock = t.id; sq3.lockAt = sim.t;                 // 鎖定遠處目標
    const hp3 = mid.hp;
    sim.heroBurst('p_fnf', mid.x, mid.z, 0, 0);          // 卻在半路上的小兵身上引爆
    ok(mid.hp < hp3,
      `有鎖定但中途在 ${near}m 處引爆(離鎖定目標 ${(FNF.def.range * 0.8 - near).toFixed(0)}m)⇒ 退回一般閘門照常結算`);
    sim.ents.delete(t.id); sim.ents.delete(mid.id);
  }
  {
    const burst = methodSrc('heroBurst', S);
    ok(/const chased = !!lockT\s*&&\s*this\._surfD3\(dist2d\(lockT\.x, lockT\.z, x, z\), lockT\) <= blastCoreR\(wp\.def\);/.test(burst),
      '追擊放行是獨立旗標 chased(MUST NOT 退回 `if (lockT) … else` 的替代語意)');
    ok(/if \(!chased && dImp > impCap\) return;/.test(burst)
      && /if \(!chased && dist2d\(bo\.x, bo\.z, x, z\) > impCap\) continue;/.test(burst),
      '射手與僚機吃同一個 chased ⇒ 一般落點閘門對「沒炸在鎖定目標上」的那一發仍原封不動生效');
  }
  // 鎖定過期 ⇒ 退回一般落點閘門
  const t2 = sim._add({ kind: 'soldier', side: foe, x: 700, z: 700 + farOut, y: 0, hp: 999999, maxHp: 999999 });
  sim.t += 60;
  h.ammo.heavy = FNF.def.mag; h.reloadUntil.heavy = 0; h.fireAt.heavy = -99; h.mp = h.maxMp; h.aiming = true;
  const sq2 = sim.squads.get('p_fnf');
  sq2.lock = t2.id; sq2.lockAt = sim.t - LOCK.TTL - 1;   // 過期
  const hp2 = t2.hp;
  sim.heroBurst('p_fnf', t2.x, t2.z, 0, 0);
  ok(t2.hp === hp2, '鎖定過期(LOCK.TTL)⇒ 退回一般落點閘門,遠距落點照樣丟棄');
  sim.ents.delete(t2.id);
}

// =================================================================================
sec('Ⅹ 爆炸傷害:射程只限制擴散中心點,擴散範圍不受射程限制(2026-08-01 使用者定案)');
// ---------------------------------------------------------------------------------
// **刻意設計,MUST NOT「補完」**:`_blast` 逐目標只量「爆心 → 目標命中量體最近點」,
// 沒有、也 MUST NOT 有任何「這個目標離射手多遠」的閘門 —— 射程管的是砲彈落在哪裡
// (heroBurst 的落點閘門),落下去之後的超壓照物理擴散。這條與「沒有射程光暈就不該掉血」
// 不衝突:射程光暈的語意是「我能不能**瞄準**這個敵人」,而濺射從來不是瞄準出來的。
{
  const blast = methodSrc('_blast', S).replace(/^\s*(\/\/|\*).*$/gm, '');
  ok(!/\.range/.test(blast),
    '_blast 內 MUST NOT 出現任何 def.range 閘門(擴散範圍不吃射程 —— 刻意設計)');
  ok(!/RANGE_TOL|_altRange\(/.test(blast),
    '_blast 內也不該有射程容差 / 高度制空(那都是「打得到誰」的語意,不是超壓幾何)');
  ok(/blastFalloff\(def\.r, d\)/.test(blast),
    '逐目標傷害只由爆風半徑與距離決定(blastFalloff 單一縫)');
  // 行為直測:落點壓在射程邊緣,射程**外**的目標照樣吃到爆風
  const sim = new BattleSim(fakeCfg());
  purge(sim);
  const lobCh = heavyOf('lob');
  const wl = heroWeapon(lobCh.id, 'heavy', 1, true);
  const side = CHARACTERS[lobCh.id].side === 'STEEL' ? 'STEEL' : 'SWARM';
  const foe = side === 'SWARM' ? 'STEEL' : 'SWARM';
  const h = sim.addHero(side, 'p_bl', lobCh.id);
  h.x = 700; h.z = 700; h.y = 0; h.aiming = true;
  const impZ = 700 + wl.range - 2;                       // 落點:射程內
  const out = sim._add({ kind: 'soldier', side: foe, x: 700, z: impZ + wl.r * 0.6, y: 0, hp: 999999, maxHp: 999999 });
  const dOut = wl.range - 2 + wl.r * 0.6;
  ok(dOut > wl.range, `對照目標離射手 ${dOut.toFixed(0)}m > 射程 ${wl.range}m(確實在射程外)`);
  sim.t += 60;
  h.ammo.heavy = wl.mag; h.reloadUntil.heavy = 0; h.fireAt.heavy = -99; h.mp = h.maxMp;
  const hp0 = out.hp;
  sim.heroBurst('p_bl', 700, impZ, 0, 0);
  ok(out.hp < hp0, '射程**外**的目標吃到射程內落點的爆風(擴散不受射程限制 —— 使用者定案)');
}

// =================================================================================
sec('Ⅺ 榴彈:準星是唯一目標來源 + 對地 45° 拋投 + 射程量直線(2026-08-02 → 08-10 使用者定案)');
// ---------------------------------------------------------------------------------
// 使用者四條:①目標只認準星(**沒有瞄到敵人就是打地面** —— 任何瞄準輔助都不准把落點拉走)
//            ②準星瞄地面敵人 → 投擲角 45°、落點 = 目標瞄準點
//            ③準星瞄空中敵人 → 維持彈射模式(高初速近直線)
//            ④中途碰撞就爆、目標移開就繼續飛,超出射程原地爆
{
  // ---- ① 準星是唯一目標來源:錐形瞄準輔助整支退場 ----
  {
    const aa = methodSrc('_updateAaMode', G);
    ok(/this\._lobCrosshair\(def\)\.ent/.test(aa),
      '_updateAaMode 的目標來自準星解 _lobCrosshair(與 _lobAim 的瞄準點同一份)');
    ok(/TARGET_CLASS\[ent\.kind\] === 'air' \? ent : null/.test(aa),
      '準星底下是不是飛行單位就決定進不進彈射模式(其餘一律 45° 對地)');
    // 2026-08-10 使用者定案「拋物線準星沒有瞄敵人時就是打地面」:錐形輔助 `_aaTarget` 是唯一
    // 能把落點從準星底下拉走的路徑(前一版把它降級成「準星什麼都沒解到才接手」仍不夠 ——
    // 規則本身就沒有「準星沒解到單位時另找一個目標」這回事)。整支刪掉,連常數一併退場。
    ok(!/this\._aaTarget\(/.test(G) && !/\n {2}_aaTarget\(/.test(G),
      '錐形瞄準輔助 _aaTarget 的定義與呼叫在 game.js 零殘留(MUST NOT 復辟;退場註解不算)');
    ok(!/AA_CONE\s*:/.test(D) && !/BALLISTIC\.AA_CONE/.test(G),
      '準星錐常數 AA_CONE 一併退場(沒有消費端的旋鈕 = 死碼)');
    ok(!/this\.ents/.test(aa) && !/_coneAcquire|_obstHitT/.test(aa),
      '_updateAaMode 不掃全場、不做任何錐形/遮擋判定 —— 它只讀準星那一份解');
    const cross = methodSrc('_lobCrosshair', G);
    ok(/this\._resolveAim\(this\._maxRange\(def\)\)/.test(cross)
      && !/this\._resolveAim\(/.test(methodSrc('_lobAim', G)),
      '榴彈的準星射線只打在 _lobCrosshair 一處(_lobAim 不再自己打一條 = 兩份會分家)');
    ok(/_lobFc/.test(methodSrc('_aimTarget', G)),
      '對照:_aimTarget(鎖定 / 追蹤)對 lob 直接吃火控解 ⇒ 瞄準點被拉走 = 鎖定也被拉走');
  }

  // ---- ① 行為直測:準星沒瞄到敵人 ⇒ 不進彈射模式(落點留在準星底下的地面)----
  {
    const upd = pickMethod('_updateAaMode', G, { TARGET_CLASS });
    const air = Object.keys(TARGET_CLASS).find((k) => TARGET_CLASS[k] === 'air');
    const gnd = Object.keys(TARGET_CLASS).find((k) => TARGET_CLASS[k] !== 'air');
    const { def } = heavyOf('lob');
    // 誘餌:錐形輔助一旦復辟就會來拿這幾個東西(直接讓斷言紅字,而不是丟例外)
    let bait = 0;
    const mk = (cross) => {
      const c = {
        side: 'SWARM', dead: false, shopOpen: false, hud: {},
        _curWeapon: () => ({ def }),
        _lobCrosshair: () => cross,
        _updateAaMode: upd,
        _aaTarget: () => { bait++; return { kind: air, id: 'heli' }; },
        _maxRange: () => { bait++; return def.range * altRangeMax(); },
        _obstHitT: () => { bait++; return null; },
        camera: { position: { x: 0, y: 2, z: 0 }, getWorldDirection: (v) => { bait++; return v; } },
        ents: new Map([['heli', { kind: air, id: 'heli' }]]),
      };
      c._updateAaMode();
      return c._aaEnt;
    };
    ok(mk({ ent: null }) === null,
      '準星沒瞄到敵人(地形/建物/天空一律 ent=null):不進彈射模式 ⇒ 45° 對地、落點就在準星');
    ok(mk({ ent: { kind: air, id: 'x' } })?.id === 'x',
      `準星直接壓在飛行單位(${air})上:目標就是它(彈射模式)`);
    ok(mk({ ent: { kind: gnd, id: 'g' } }) === null,
      `準星壓在地面單位(${gnd})上:一律 45° 對地拋投`);
    ok(bait === 0, `三種準星解全程沒碰過索敵/射程/遮擋(誘餌計數 ${bait} = 0)—— 目標來源只有準星`);
    // 沒有「錐內有飛行單位」這個輸入了 —— 本函式的可觀察行為只由 cross.ent 決定(純函式化的證明)
    ok(!/_aaTarget|_maxRange/.test(methodSrc('_updateAaMode', G)),
      '_updateAaMode 不再需要射程/索敵參數:輸入只有準星解一個');
  }

  // ---- ②③ 45° 行為直測:落點 = 瞄準點、出膛角恆 45°、對空維持階梯 ----
  {
    class V3 {
      constructor(x = 0, y = 0, z = 0) { this.x = x; this.y = y; this.z = z; }
      set(x, y, z) { this.x = x; this.y = y; this.z = z; return this; }
      clone() { return new V3(this.x, this.y, this.z); }
      copy(v) { this.x = v.x; this.y = v.y; this.z = v.z; return this; }
      addScaledVector(v, s) { this.x += v.x * s; this.y += v.y * s; this.z += v.z * s; return this; }
      length() { return Math.hypot(this.x, this.y, this.z); }
      normalize() { const l = this.length() || 1; this.x /= l; this.y /= l; this.z /= l; return this; }
      distanceTo(v) { return Math.hypot(this.x - v.x, this.y - v.y, this.z - v.z); }
    }
    const ARC_MAXP = Number(/const ARC_MAXP = (\d+);/.exec(G)?.[1]);
    const env = { THREE: { Vector3: V3 }, BALLISTIC, ARC_MAXP };
    const M = (n) => pickMethod(n, G, env);
    const c = {
      _lobSolve: M('_lobSolve'), _lobVel: M('_lobVel'), _lob45Vel: M('_lob45Vel'),
      _arcTrace: M('_arcTrace'), _lobLadder: M('_lobLadder'),
      _layerHitT: () => null,   // 空地:彈道不被截斷
    };
    const { def } = heavyOf('lob');
    const base = shotV0(def, false);
    const from = new V3(0, 2, 0);
    let worstAng = 0, worstMiss = 0;
    for (const L of [20, 60, 120, def.range, def.range * altRangeMax()]) {
      for (const dy of [-80, -20, 0, 10]) {
        const aim = new V3(L, 2 + dy, 0);
        const v = c._lob45Vel(from, aim, base);
        ok(!!v, `45° 解存在(水平 ${L.toFixed(0)}m / 高差 ${dy}m)`);
        if (!v) continue;
        // 出膛角恆 45°
        worstAng = Math.max(worstAng, Math.abs(Math.atan2(v.y, Math.hypot(v.x, v.z)) - Math.PI / 4));
        // 落點 = 瞄準點(積分到位;射程給足以隔離射程截斷這個變因)
        const a = c._arcTrace(from, v, 1e6, aim, false);
        worstMiss = Math.max(worstMiss, a.minD);
      }
    }
    ok(worstAng < 1e-9, `投擲角逐例恆為 45°(最大偏差 ${(worstAng * 180 / Math.PI).toExponential(1)}°)`);
    ok(worstMiss <= BALLISTIC.LOB_TOL,
      `積分落點逐例落在瞄準點的 LOB_TOL 內(最差 ${worstMiss.toFixed(2)}m ≤ ${BALLISTIC.LOB_TOL}m)—— 弧線真的以瞄準點為落點`);
    // 45° 弧長 > 直線 ⇒ 舊制「扣航跡長」會在抵達之前截斷:這正是改量直線的理由
    {
      const aim = new V3(def.range, 2, 0);
      const v = c._lob45Vel(from, aim, base);
      const a = c._arcTrace(from, v, def.range, aim, false);
      ok(a.minD <= BALLISTIC.LOB_TOL,
        `滿射程 ${def.range}m 的 45° 拋投仍抵達瞄準點(minD ${a.minD.toFixed(2)}m;量航跡長會在 87% 處自爆)`);
      const far = new V3(def.range * 1.3, 2, 0);
      const vf = c._lob45Vel(from, far, base);
      const af = c._arcTrace(from, vf, def.range, far, false);
      ok(af.cut === 'range' && af.minD > BALLISTIC.LOB_TOL,
        '超出射程的瞄準點:彈道在射程界原地截斷(cut=range)⇒ 光暈不亮、砲彈原地爆');
    }
    // 對地:_lobLadder 真的交出 45°(行為錨 —— 原文斷言擋不住「45° 那一段被繞過」的改法)
    {
      const aim = new V3(120, 2, 0);
      const L = c._lobLadder(from, aim, 400, base, BALLISTIC.LOB_TOL, false, false);
      ok(L.ok && Math.abs(Math.atan2(L.vel.y, Math.hypot(L.vel.x, L.vel.z)) - Math.PI / 4) < 1e-9,
        '對地 _lobLadder 交出的出膛角 = 45°(不是低伸解)');
      ok(L.v0 < base, `對地初速由幾何反解而非全裝藥(${L.v0.toFixed(1)} < ${base}m/s)`);
      ok(L.high === false, '對地 45° 是標準解(high=false ⇒ 虛線維持陣營色,不是降裝藥的琥珀)');
    }
    // 仰角 ≥ 45° 無 45° 解 ⇒ 退回裝藥階梯(低伸解本來就更陡,兩者在 45° 處連續)
    {
      const up = new V3(30, 2 + 40, 0);
      ok(c._lob45Vel(from, up, base) === null, '目標仰角 ≥ 45°(懸崖正上方)⇒ 45° 無解');
      const L = c._lobLadder(from, up, 400, base, BALLISTIC.LOB_TOL, false, false);
      ok(L.arc && L.ok, '無 45° 解時退回裝藥階梯,仍打得到(MUST NOT 變成打不到)');
      ok(Math.atan2(L.vel.y, Math.hypot(L.vel.x, L.vel.z)) > Math.PI / 4,
        '退回的低伸解仰角比 45° 更陡(曲線連續,不是特例)');
    }
    // 對空:維持既有裝藥階梯(高初速近直線),MUST NOT 被 45° 接管
    {
      const aim = new V3(120, 60, 0);
      const aaBase = shotV0(def, true);
      const L = c._lobLadder(from, aim, 400, aaBase, BALLISTIC.LOB_TOL, false, true);
      ok(L.ok && Math.abs(L.v0 - aaBase) < 1e-9, '對空彈射:走全裝藥(初速 = AA_MV 夾制值,不被 45° 接管)');
      ok(Math.atan2(L.vel.y, Math.hypot(L.vel.x, L.vel.z)) < Math.PI / 4,
        '對空彈道明顯比 45° 平(高速近直線 —— 使用者「空中敵人維持現狀」)');
    }
  }

  // ---- ④ 射程 = 以射擊點為中心的球面(與軌跡無關);中途碰撞就爆、沒碰撞就飛到球面原地爆 ----
  // 使用者 2026-08-02 定案:「射程範圍與軌跡無關,是射擊點為中心的球面」。凡是「這一發還能不能
  // 再飛」的判定 MUST 只量 |彈頭 − 發射點|;航跡長(弧、導引修正、離架散布繞的路)一律不計。
  {
    const ub = methodSrc('_updateBullets', G);
    const at = methodSrc('_arcTrace', G);
    const vs = methodSrc('_updateVisShells', G);
    const fire = methodSrc('_tryFire', G);
    ok(/const spent = p\.distanceTo\(from\);/.test(at) && /spent >= max/.test(at),
      '_arcTrace(瞄準虛線/光暈判定)的射程界量離發射點的直線距離');
    ok(/const spent = b\.pos\.distanceTo\(b\.origin\);/.test(ub),
      '_updateBullets(自機彈體)的射程界量離發射點的直線距離');
    ok(/b\.pos\.distanceTo\(b\.origin\) >= b\.max/.test(vs),
      '_updateVisShells(他人/bot 視覺彈體)同一把尺 —— 兩端看到的射程界一致');
    // 航跡長已整組退場:一條殘留的 b.dist 就是第二把尺
    for (const [src, name] of [[ub, '_updateBullets'], [vs, '_updateVisShells'], [fire, '_tryFire']]) {
      ok(!/\bb\.dist\b|\bdist: 0\b/.test(src.replace(/^\s*(\/\/|\*).*$/gm, '')),
        `${name} 不再有航跡長 b.dist(射程與軌跡無關 ⇒ 第二把尺 MUST NOT 復辟)`);
    }
    ok(!/b\.seek|b\.lob/.test(ub.replace(/^\s*(\/\/|\*).*$/gm, '')),
      '射程界不再依彈道分支(seek / lob 旗標整組退場 —— 一顆球面管全部)');
    ok(/const armed = prev\.distanceTo\(b\.origin\) >= \(b\.arm \|\| 0\);/.test(ub),
      '軌跡修正期(ARMING)也量同一顆球 —— 光暈的琥珀帶 `surf < arm` 本來就是直線量的');
    ok(/const done = hit \|\| \(b\.chase \? b\.age >= b\.fuel : spent >= b\.max\);/.test(ub),
      '彈體終止條件 = 命中 or 出球面(中途碰撞就爆、沒碰撞就繼續飛;唯一例外 = 射後不理鎖定後的追擊燃料)');
    ok(/if \(b\.aoe\) \{/.test(ub) && /t: 'burst'/.test(ub),
      '終止當下一律回報爆點(直擊/落地/射程終點皆引爆 —— 原地爆炸)');
  }

  // ---- ⑤ 雷射導引吃同一條規則(2026-08-02 使用者定案)----
  // 「中途碰撞就爆炸,因為目標移動而沒碰撞的話會繼續飛,直到超出射程就原地爆炸」——
  // 導引失效(導引點出球面)MUST 只是「不再修正航向」,MUST NOT 讓彈體提早消失。
  {
    const ub = methodSrc('_updateBullets', G);
    const guideBlock = /} else if \(armed && b\.guide[\s\S]*?\n      } else \{/.exec(ub)?.[0] || '';
    ok(guideBlock.length > 0, '_updateBullets 取得雷射導引分支原文');
    ok(/gp\.distanceTo\(b\.origin\) > b\.max/.test(guideBlock),
      '雷射導引的失效判據 = 導引點出了同一顆球(MUST NOT 另量航跡長)');
    ok(/b\.guide = false;/.test(guideBlock) && !/splice|_dropBullet|done = true/.test(guideBlock),
      '導引失效只關掉導引(彈體照飛到球面才爆 —— MUST NOT 在這裡把彈體收掉)');
    ok(/b\.vel\.y -= BALLISTIC\.G \* dt;/.test(guideBlock),
      '導引失效後改吃重力直飛(與 A7「失鎖後直線飛行」同一條)');
    {
      const { def } = heavyOf('guide');
      ok(trajClass(def) === 'guide' && aoeClass(def) === 'blast',
        `雷射導引是爆炸戰鬥部(${def.name})⇒ 走 b.aoe 的 burst 回報 = 碰撞/出球面都原地爆`);
      ok(armingOf(def) != null, '雷射導引有軌跡修正期 ⇒ armed 之後才接手導引');
    }
  }
}

// =================================================================================
sec('Ⅻ 全攻擊路徑對帳:射程 = 以射擊點為中心的球面(含扇形)');
// ---------------------------------------------------------------------------------
// 使用者 2026-08-02:「基於更改的射程範圍定義,確認包括扇形攻擊在內的所有攻擊符合射程範圍規則」。
// 本段是那份對帳表的可執行版:每一條會造成傷害的路徑,射程判據 MUST 是
//   ①**3D 直線距離**(球面,不是水平圓柱、不是航跡長)
//   ②球心 = **射擊點**(客戶端量槍口 ⇒ 伺服器也要量槍口,否則誠實界沒有寬容可以吸收差額)
// 具名例外(刻意的水平圓柱)集中在下方 ⑶,每一條都 MUST 附「為什麼 2D 是對的」。
{
  // ---- ⑴ 伺服器逐路徑:傷害射程閘量 3D ----
  {
    const paths = [
      ['heroHit', /const d3 = Math\.hypot\(h\.x - t\.x, h\.z - t\.z, \(h\.y \|\| 0\) - \(t\.hero \? \(t\.y \|\| 0\) : 0\)\);/, '單體直擊'],
      ['heroPlasma', /const d3 = Math\.hypot\(d2, byD - \(t\.hero \? \(t\.y \|\| 0\) : 0\)\);/, '扇形(散彈/電漿)'],
      ['_lanceHits', /d3: Math\.hypot\(tx, tz, ty - oy\)/, '直線貫穿'],
      ['hitMissile', /const d3 = Math\.hypot\(h\.x - m\.x, h\.z - m\.z, \(h\.y \|\| 0\) - m\.y\);/, '攔截來襲飛彈'],
      ['botFire', /const d3 = Math\.hypot\(h\.x - t\.x, h\.z - t\.z, \(t\.hero \? \(t\.y \|\| 0\) : 0\)\);|const d3 = Math\.hypot\(h\.x - t\.x, h\.z - t\.z, \(h\.y \|\| 0\) - \(t\.hero \? \(t\.y \|\| 0\) : 0\)\);/, '電腦玩家開火'],
      ['heroLock', /Math\.hypot\(t\.x - h\.x, t\.z - h\.z, ty - \(h\.y \|\| 0\)\)/, '準星鎖定(決定射後不理能不能鎖)'],
      ['_tickMissiles', /Math\.hypot\(t\.x - m\.ox, \(t\.y \|\| 0\) - \(m\.oy \|\| 0\), t\.z - m\.oz\) > m\.range/, '飛彈失鎖(以發射點為球心)'],
    ];
    for (const [m, re, why] of paths) {
      ok(re.test(methodSrc(m, S)), `${m}(${why})的射程判據量 3D 直線距離(球面)`);
    }
    // 爆風擴散刻意無射程(A11)—— 對照組:它不在球面規則的管轄內
    ok(!/\.range/.test(methodSrc('_blast', S).replace(/^\s*(\/\/|\*).*$/gm, '')),
      '對照:_blast(爆風擴散)刻意沒有射程閘(射程只限制擴散中心點,A11)');
  }

  // ---- ⑵ 扇形的球心 = 客戶端回報的槍口(與 heroLance 同一條) ----
  {
    const hp = methodSrc('heroPlasma', S);
    ok(/heroPlasma\(pid, dx, dz, slot = 'heavy', o = null\)/.test(hp),
      'heroPlasma 收槍口 o(射程球心;與 heroLance 的 o 同一組座標約定)');
    ok(/dist2d\(h\.x, h\.z, \+o\[0\], \+o\[1\]\) <= 12/.test(hp),
      '槍口防作弊閘與 heroLance 同一道(不能從任意座標噴一個錐)');
    ok(/const lead = mz && b === h;/.test(hp) && /const bx = lead \? mz\[0\] : b\.x, bz = lead \? mz\[1\] : b\.z;/.test(hp),
      '僚機維持各自機體中心(它們沒有槍口回報),只有主視野機吃回報的槍口');
    ok(/this\._losBlocked\(bx, bz, byE,/.test(hp) && /this\._ridgeBlocked\(bx, bz, this\._absSightY\(b, byE, bx, bz\)/.test(hp),
      '錐內的 LOS / 稜線射線與射程球心同源(起點分家 = 打得到卻被自己的牆擋住)');
    ok(/\{ t: 'plasma', dx: dir\.x, dz: -dir\.z, slot: id,/.test(G) && /o: \[Math\.round\(muzzle\.x \* 10\) \/ 10, Math\.round\(-muzzle\.z \* 10\) \/ 10,/.test(G),
      '客戶端 plasma 回報帶槍口(少送這一欄 = 伺服器退回機體中心 = 邊界帶光暈亮著卻不掉血)');
    ok(/if \(this\.gunGroup\) this\.gunGroup\.localToWorld\(from\.copy\(this\._muzzle\)\);/.test(methodSrc('_reachable', G)),
      '對照:客戶端射程光暈 _reachable 量的就是槍口 ⇒ 兩端同一個球心');

    // 行為直測:目標落在「機體量得到 = 超程 / 槍口量得到 = 射程內」那條邊界帶
    const sim = new BattleSim(fakeCfg());
    purge(sim);
    let fanCh = null;
    for (const id of Object.keys(CHARACTERS)) {
      const d = heroWeapon(id, 'heavy', 1);
      if (d && d.fan) { fanCh = { id, def: heroWeapon(id, 'heavy', 1, true) }; break; }
    }
    ok(fanCh != null, `測試前置:找得到扇形重武器角色(${fanCh?.id} / ${fanCh?.def?.name})`);
    const R = fanCh.def.range, OFF = 10;                 // 槍口沿射向前伸 10m(閘門允許到 12m)
    const side = CHARACTERS[fanCh.id].side === 'STEEL' ? 'STEEL' : 'SWARM';
    const foe = side === 'SWARM' ? 'STEEL' : 'SWARM';
    const mk = () => {
      const h = sim.addHero(side, 'p_fan', fanCh.id);
      h.x = 0; h.z = 0; h.y = 0; h.aiming = true;
      sim.t += 60;
      h.ammo.heavy = fanCh.def.mag; h.reloadUntil.heavy = 0; h.fireAt.heavy = -99; h.mp = h.maxMp;
      return h;
    };
    const shoot = (withMuzzle) => {
      for (const s of [...sim.ents.values()]) if (s.tp || s.hero) sim.ents.delete(s.id);
      sim.heroes.clear();
      const h = mk();
      // 目標:離機體 R+5(超程)、離槍口 R−5(射程內)
      const t = sim._add({ kind: 'soldier', side: foe, x: 0, z: R + 5 - hitR({ kind: 'soldier' }), y: 0, hp: 999999, maxHp: 999999 });
      const hp0 = t.hp;
      sim.heroPlasma('p_fan', 0, 1, 'heavy', withMuzzle ? [0, OFF, 0] : null);
      return t.hp < hp0;
    };
    ok(shoot(true), '帶槍口:離槍口 R−5 的目標掉血(= 客戶端光暈亮的那一格)');
    ok(!shoot(false), '對照:不帶槍口(bot / 舊版客戶端)退回機體中心 ⇒ 同一個目標超程不掉血');
  }

  // ---- ⑶ 具名例外:刻意的水平圓柱,每一條都只放寬不收緊 ----
  // 這四條 MUST 留在名單上:偏差方向一律朝「不擋」(原則 6),2D ≤ 3D ⇒ 永遠不會把
  // 客戶端已自行夾過球面的合法攻擊靜默丟棄(A30)。要收緊成球面,先解決「伺服器只有離地高、
  // 沒有絕對高程」這件事(見 _altDh / _absSightY 同一個坑)。
  {
    const exceptions = [
      ['heroBurst', /const dImp = dist2d\(org\.x, org\.z, x, z\);/,
        '爆點落點閘:回報的 y 是離地高不是絕對高程,算不出 3D;2D ≤ 3D ⇒ 只放寬不誤丟'],
      ['_acquireTarget', /let d = dist2d\(e\.x, e\.z, t\.x, t\.z\);/,
        'NPC/塔索敵:高度另有獨立天花板閘(min(range×0.9, GUN_CEIL_M)),改 3D 會與它打架'],
      ['heroCast', /const d = dist2d\(h\.x, h\.z, x, z\);/,
        '招式:落點是地面座標(x,z),2D 就是球面在地面的截痕'],
      ['_decoyBombTarget', /const dist = dist2d\(e\.x, e\.z, d\.x, d\.z\);/,
        '集束投彈:轟炸機在正上方,BOMB_R 是投彈足跡半徑而非射擊射程'],
    ];
    for (const [m, re, why] of exceptions) {
      ok(re.test(methodSrc(m, S)), `具名例外 ${m} 仍是水平圓柱 —— ${why}`);
    }
  }

  // ---- ⑷ 球面是**遊戲空間**球面,不是真實世界球面(2026-08-02 使用者定案)----
  // 座標系只有一個:x/z/y 全是**遊戲公尺**,三軸等權 ⇒ 直接對原始座標 hypot 就是遊戲空間球面。
  // 兩個比例尺都在戰鬥層之外一次套完,MUST NOT 滲進任何射程/彈道判定:
  //   ・`REAL_SCALE`(遊戲世界 = 真實 ×2)只住經緯度→遊戲公尺的邊界(llToMeters / rooms 的 SC_GAME);
  //   ・`COMBAT_SCALE`(reach 減半)只住 data.js 的統一縮放塊 ⇒ `def.range` 送到判定時already 是遊戲公尺。
  // 會壞掉的改法:看到「遊戲地形比真實平緩約兩倍」就想在 y 軸乘個補正把球面「拉回真實比例」——
  // 那會讓射程變成橢球,而客戶端光暈/彈體是純遊戲空間的正球 ⇒ 兩端立刻分家(A30)。
  {
    ok(!/REAL_SCALE|COMBAT_SCALE/.test(G),
      'game.js 全檔無比例尺常數(彈道/射程/光暈全在遊戲空間,MUST NOT 換算回真實世界)');
    ok(!/COMBAT_SCALE/.test(S), 'sim.js 全檔無 COMBAT_SCALE(def.range 進來就已經是遊戲公尺)');
    // sim.js 的 REAL_SCALE 自 2026-08-10 起是 **0 處**:投影(比例尺 + 地圖主方位旋轉)整支
    // 收進 `data.js llToXZ`,`llToMeters` 只剩 **z 鏡射**(客戶端框 z=南 / 伺服器框 z=北,A30)。
    const realHits = S.split('\n').map((l, i) => [i + 1, l])
      .filter(([, l]) => /MAPGEO\.REAL_SCALE/.test(l) && !/^\s*(\/\/|\*)/.test(l));
    ok(realHits.length === 0,
      `sim.js 全檔無 REAL_SCALE —— 經緯度投影唯一縫 = data.js llToXZ(實得 ${realHits.length} 處)`);
    const llm = /export function llToMeters[\s\S]*?\n}/.exec(S)?.[0] || '';
    ok(/llToXZ\(lat, lng, center\)/.test(llm) && /return \[x, -z\];/.test(llm),
      'sim.llToMeters = data.js llToXZ 的 z 鏡射薄殼(投影本體不在 sim)');
    // z 鏡射已把 R(θ) 共軛成 R(−θ):在這裡再套一次旋轉 = 兩端世界差 2θ,而畫面上只表現成
    // 「塔的位置跟畫面對不上 / 打得到卻沒傷害」(A30 靜默丟包家族)。
    ok(!/rotXZ|Math\.cos|Math\.sin|mapRot/.test(llm),
      'sim.llToMeters 內沒有第二份旋轉(旋轉方向由 z 鏡射自動反號,MUST NOT 手動再轉一次)');
    for (const m of ['heroHit', 'heroPlasma', 'heroLance', 'heroBurst', '_lanceHits', 'botFire']) {
      ok(!/REAL_SCALE|COMBAT_SCALE/.test(methodSrc(m, S)), `${m} 的判定內無任何比例尺換算`);
    }

    // 行為直測:三軸等權 —— 同一段遊戲公尺,擺水平與擺垂直 MUST 同判(正球,不是橢球/圓柱)
    const sim = new BattleSim(fakeCfg());
    purge(sim);
    const { id: fid, def } = heavyOf('flat');           // 直擊武器 → heroHit 路徑
    const side = CHARACTERS[fid].side === 'STEEL' ? 'STEEL' : 'SWARM';
    const foe = side === 'SWARM' ? 'STEEL' : 'SWARM';
    const wl = heroWeapon(fid, 'heavy', 1, true);
    const shoot = (dx, dy) => {
      sim.heroes.clear();
      for (const s of [...sim.ents.values()]) if (s.hero) sim.ents.delete(s.id);
      const h = sim.addHero(side, 'p_sp', fid);
      h.x = 0; h.z = 0; h.y = 0; h.aiming = true;
      const t = sim.addHero(foe, 'p_tg', fid);
      t.x = dx; t.z = 0; t.y = dy;
      t.hp = 999999; t.maxHp = 999999; t.sp = 0;
      sim.t += 60;
      h.ammo.heavy = wl.mag; h.reloadUntil.heavy = 0; h.fireAt.heavy = -99; h.mp = h.maxMp;
      const hp0 = t.hp;
      sim.heroHit('p_sp', t.id, 'heavy');
      return t.hp < hp0;
    };
    const D = wl.range * 0.8, OUT = wl.range * 1.6;
    ok(shoot(D, 0) === shoot(0, D),
      `射程內 ${D.toFixed(0)} 遊戲公尺:擺水平與擺垂直同判(${shoot(D, 0)})—— 三軸等權`);
    ok(shoot(OUT, 0) === shoot(0, OUT),
      `射程外 ${OUT.toFixed(0)} 遊戲公尺:擺水平與擺垂直同判(${shoot(OUT, 0)})`);
    ok(shoot(D, 0) && !shoot(OUT, 0), '對照:同一把武器射程內打得到、射程外打不到(閘門真的有作用)');
  }

  // ---- ⑸ 球心 = **彈藥擊發當下的位置**,後續機體的移動不影響(2026-08-05 使用者定案)----
  // 客戶端一向如此(`b.origin = muzzle.clone()`,見 ④);伺服器少的是那份記憶 —— AoE 彈頭是
  // **著彈**才回報,而 45° 拋投的榴彈滿射程要飛近 6 秒,舊制的落點閘門拿的是機體**當下**的
  // 位置 ⇒ 球心跟著機體跑。兩個方向都沒有錯誤訊息:退後 = 合法彈著被靜默丟棄(零傷害)、
  // 前衝 = 射程外的彈著被收下(隱形射程)。
  {
    const hb = methodSrc('heroBurst', S);
    const so = methodSrc('_shotOrigin', S);
    const tp = methodSrc('_trailPush', S);

    ok(/const org = this\._shotOrigin\(h, wp\.def, x, z, cap\);/.test(hb),
      'heroBurst 的球心由 _shotOrigin 回推(擊發位置),不是機體當下位置');
    ok(!/dist2d\(h\.x, h\.z, x, z\)/.test(hb),
      '舊制「以機體當下位置為球心」已整組退場(MUST NOT 復辟)');
    ok(/const back = org\.back;/.test(hb) && !/shotFlightS\(/.test(hb),
      '擊發時刻回推量與球心是同一個解(heroBurst 內不得再算一次 shotFlightS —— 兩份會在移動時分家)');
    ok(/const bo = this\._shotOrigin\(b, wp\.def, x, z, cap\);/.test(hb)
      && /dist2d\(bo\.x, bo\.z, x, z\) > impCap/.test(hb),
      '僚機吃同一條球心規則(整個小隊是一起移動的,只修主視野機 = 僚機那份傷害照樣被丟)');

    // 單一縫:一份實作、消費端數得出來
    const nDef = (re) => (S.match(re) || []).length;
    ok(nDef(/^\s{2}_shotOrigin\(/gm) === 1, '_shotOrigin 只有一份實作');
    ok(nDef(/^\s{2}_trailPush\(/gm) === 1, '_trailPush 只有一份實作');
    ok(nDef(/this\._shotOrigin\(/g) === 2, `_shotOrigin 恰兩個消費端(領機 + 僚機;實得 ${nDef(/this\._shotOrigin\(/g)})`);
    ok(nDef(/this\._trailPush\(/g) === 1, `軌跡取樣點只有一個(實得 ${nDef(/this\._trailPush\(/g)})`);
    ok(/for \(const b of this\._allBodies\(\)\) this\._trailPush\(b\);/.test(methodSrc('tick', S)),
      '取樣點在 tick 內、掃過每一架機體(領機/僚機/bot 三條位置寫入路徑同一個時間切片)');
    ok(/b\._trail = null;/.test(methodSrc('_respawn', S)),
      '重生清軌跡(瞬移;留著上一條命的軌跡會讓落點閘門回推到主堡外)');

    // 保留窗推導不手寫
    const trailDef = D.slice(D.indexOf('export function shotTrailS()'));
    ok(/export function shotTrailS\(\)/.test(D), 'data.js 有 shotTrailS(軌跡保留窗的唯一縫)');
    ok(!/\b\d+(\.\d+)?\s*\*?\s*\/\/.*秒/.test(trailDef.slice(0, 400))
      && /chaseCapS\(def\)/.test(trailDef.slice(0, 400)) && /flightCapS\(def\)/.test(trailDef.slice(0, 400)),
      '保留窗 = max(chaseCapS / flightCapS)推導不手寫(與 heroBurst 的 cap 同一條式)');
    ok(/shotTrailS\(\)/.test(tp) && !/\b\d{1,3}\s*;\s*\/\/.*窗/.test(tp),
      '_trailPush 的裁切窗吃 shotTrailS(sim.js 不手寫秒數)');
    ok(shotTrailS() > 0 && shotTrailS() >= flightCapS(heavyOf('lob').def),
      `保留窗 ${shotTrailS().toFixed(1)}s 蓋得住最長的拋物線飛行時間 ${flightCapS(heavyOf('lob').def).toFixed(1)}s`);

    // 對照:客戶端那一半本來就是擊發點(兩端同一個球心的另一端)
    ok(/origin: muzzle\.clone\(\),/.test(G), '對照:客戶端彈體的球心 = 擊發當下的槍口(烤死,不隨機體移動)');

    // ---- 行為直測:真 BattleSim + 真 _trailPush / _shotOrigin / heroBurst ----
    const { id: lid } = heavyOf('lob');
    const wl = heroWeapon(lid, 'heavy', 1, true);
    const side = CHARACTERS[lid].side === 'STEEL' ? 'STEEL' : 'SWARM';
    const foe = side === 'SWARM' ? 'STEEL' : 'SWARM';
    const impCap = wl.range * altRangeMax() * RANGE_TOL;
    const IMP = impCap * 0.9;                       // 落點:擊發位置正北 0.9×上界(合法)
    const FLY = shotFlightS(wl, IMP);               // 這一發要飛多久
    const AWAY = impCap * 1.2;                      // 開完砲往後退到「從當下位置量就超程」

    /**
     * 打一發:射手在 (0,0) 擊發 → 花 fly 秒退到 (0, −away) → 回報落點 (0, IMP)。
     * trail=false 時完全不記軌跡(= 舊制 / headless 降級路徑)。
     */
    const burstAfterMove = ({ away, fly, trail = true, atFire = 0 }) => {
      const sim = new BattleSim(fakeCfg());
      purge(sim);
      for (const s of [...sim.ents.values()]) if (s.hero) sim.ents.delete(s.id);
      const h = sim.addHero(side, 'p_mv', lid);
      h.aiming = true;
      sim.t = 100;
      // 擊發那一刻的位置(atFire = 沿落點方向的偏移;0 = 正好在射程內)
      h.x = 0; h.z = atFire;
      if (trail) sim._trailPush(h);
      // 飛行期間逐 tick 後撤(每 0.125s 一筆,與正式 tick 率同)
      const steps = Math.max(1, Math.ceil(fly / 0.125));
      for (let k = 1; k <= steps; k++) {
        sim.t += 0.125;
        h.z = atFire - away * (k / steps);
        if (trail) sim._trailPush(h);
      }
      const t = sim._add({ kind: 'soldier', side: foe, x: 0, z: IMP, y: 0, hp: 999999, maxHp: 999999 });
      h.ammo.heavy = wl.mag; h.reloadUntil.heavy = 0; h.fireAt.heavy = -99; h.mp = h.maxMp;
      const hp0 = t.hp;
      sim.heroBurst('p_mv', 0, IMP, 0, 0);
      return t.hp < hp0;
    };

    ok(burstAfterMove({ away: AWAY, fly: FLY }),
      `擊發時在射程內、飛行中往後退 ${AWAY.toFixed(0)}m(當下位置量已超程)⇒ 傷害照結算`);
    ok(!burstAfterMove({ away: AWAY, fly: FLY, trail: false }),
      '反面對照:沒有軌跡(舊制 = 以當下位置為球心)⇒ 同一發被靜默丟棄');
    ok(!burstAfterMove({ away: -AWAY, fly: FLY, atFire: -impCap * 1.4 }),
      '反向:擊發時就在射程外、飛行中衝進來 ⇒ 仍然丟棄(球心釘在擊發位置,不給隱形射程)');
    ok(burstAfterMove({ away: 0, fly: FLY }),
      '對照:原地不動照樣打得到(球心規則不改變靜止射手的任何行為)');

    // tick 真的有在記軌跡(取樣點接上了)
    {
      const sim = new BattleSim(fakeCfg());
      purge(sim);
      const h = sim.addHero(side, 'p_tk', lid);
      h.x = 12; h.z = 34;
      sim.tick(0.125);
      const tr = h._trail;
      ok(Array.isArray(tr) && tr.length >= 3 && tr[1] === 12 && tr[2] === 34,
        'sim.tick 一跑就記下這一格的位置(取樣點真的接上,不是只寫在原文裡)');
    }
  }
}


// =================================================================================
sec('ⅩⅢ 爆炸傷害:閃避逐目標各自計算 + 「維持 DPS」的補償(2026-08-11 / 08-12 使用者定案)');
// ---------------------------------------------------------------------------------
// 使用者原句:「榴彈類/導彈類等爆炸傷害爆炸時,就算沒擊中原先的目標,也會造成範圍傷害
// (閃避率各自計算)」。兩件事一起定案:
//   ① 爆炸傷害從此**吃閃避**(舊制「有爆風 r ⇒ 不可閃」與「招式不吃閃避」兩條同時退場);
//   ② 閃避降級成**逐目標**的事 —— 爆風照樣鋪開,範圍內每個目標各自擲自己的骰。
// 兩條缺一不可,而且**第二條才是真正會壞掉的那一半**:把閃避做成整發早退(`return`)最省事,
// 症狀是「小隊裡最快的那一台一閃,站在他旁邊的重甲與砲塔一起免傷」—— 畫面上看起來只是
// 「這發榴彈好像沒傷害」,傷害數字一個都不會跳,而所有既有斷言照樣全綠。
//
// 判定範圍只有 `data.js evadable()` 一份:扇形與貫穿**依機制豁免**(錐/圓柱一次掃過整排目標,
// 沒有「這一發瞄的是誰」可閃),其餘全吃。塔/主堡的制式火砲無 `wid` ⇒ def 為空 ⇒ 不可閃。
{
  // ---- ① 分類縫:逐類對帳(MUST NOT 有第二份 type 比對)----
  ok(evadable({ id: 'light' }) === true, 'evadable:輕武器直射吃閃避(舊制唯一的一類)');
  ok(evadable(WEAPONS.rgun) === true,
    'evadable:NPC 重型機槍(直射)吃閃避 —— 它沒有 `id`,拿 id 比對當判據會靜默判成不可閃');
  ok(evadable(WEAPONS.rocket) === true && evadable(WEAPONS.siege) === true,
    'evadable:NPC 兩把爆炸型(肩射火箭 / 攻城榴彈砲)吃閃避');
  ok(evadable({ dmg: 100, r: 20, pen: 4, vs: {} }) === true,
    'evadable:招式/載具戰鬥部的爆風 def(無 `id`)吃閃避 —— aoeClass 認不得它們,判據不能拿 blast');
  ok(evadable(null) === false && evadable(undefined) === false,
    'evadable:塔/主堡無 wid ⇒ def 為空 ⇒ 制式火砲不可閃');
  {
    const byCls = { blast: [], fan: [], line: [] };
    for (const id of Object.keys(CHARACTERS)) {
      for (const slot of ['light', 'heavy']) {
        for (const lv of [1, 4]) {
          const def = heroWeapon(id, slot, lv, true);
          const cls = aoeClass(def);
          if (byCls[cls]) byCls[cls].push({ id, slot, lv, def });
        }
      }
    }
    ok(byCls.blast.length > 0 && byCls.blast.every((w) => evadable(w.def)),
      `全 ${byCls.blast.length} 把爆炸型重武器(32 角 × 兩槽 × 首末階)吃閃避`);
    ok(byCls.fan.length > 0 && byCls.fan.every((w) => !evadable(w.def)),
      `全 ${byCls.fan.length} 把扇形武器依機制豁免`);
    ok(byCls.line.length > 0 && byCls.line.every((w) => !evadable(w.def)),
      `全 ${byCls.line.length} 把貫穿武器依機制豁免`);
  }
  // ---- ② 單一縫:閃避判據 MUST NOT 在消費端各寫一份 ----
  const code = (s) => s.replace(/^\s*(\/\/|\*|\/\*).*$/gm, '');
  const simCode = code(S);
  ok(!/\.id === 'light' && this\._dodges/.test(simCode),
    'sim.js 三條直擊路徑改吃 evadable(MUST NOT 留任何「id 是 light 才擲骰」的第二份規則)');
  ok(!/!wd\.r && e\.kind !== 'tower'/.test(simCode),
    'sim.js NPC 分支不再以「沒有爆風 r」當可閃的判據(那條規則已退場)');
  for (const [f, src] of [['duel.mjs', read(['tools', 'duel.mjs'])], ['lanesim.mjs', read(['tools', 'lanesim.mjs'])]]) {
    ok(/\bevadeExpF\(/.test(code(src)) && !/id === 'light' \? dodgeP|byLight/.test(code(src)),
      `${f} 的閃避判定與補償走 evadeExpF 同一個縫(平衡模型與伺服器分家 = 模型量的是另一個遊戲)`);
  }
  // ---- ③ _blast 原文:擲骰在傷害之前、只對敵方、且 MUST 是逐目標 continue ----
  const blast = code(methodSrc('_blast', S));
  ok(/const p = same \? 0 : this\._dodgeP\(t, h\)/.test(blast),
    '_blast:逐目標取**該目標自己的** p,且只對敵方(自損是榴彈最小安全射程的代價,不是別人打過來的攻擊)');
  ok(/pm > 0 && Math\.random\(\) < pm[\s\S]*?continue;[\s\S]*?this\._damage\(/.test(blast)
    && !/Math\.random\(\) < pm[\s\S]{0,240}?return;/.test(blast),
    '_blast:閃掉的目標只 continue(跳過自己這一份),MUST NOT return —— 整發早退 = 一台閃全隊免傷');
  // 2026-08-12 高地壓制(HIGH_SUP)之後,骰的是「打不中」= 閃避 ⊕ 射手失準,而**補償的分母只有閃避那一半**:
  // 補償是 A45 ⑦「維持 DPS」的規則,把壓制也補回去 = 這條新規則對爆炸傷害完全沒有作用(而且沒有任何錯誤訊息)。
  ok(/const pm = same \? 0 : this\._missP\(t, h\)/.test(blast),
    '_blast:擲的是 `_missP`(閃避 ⊕ 射手被高地壓制而失準),兩者是獨立事件不是相加');
  ok(/this\._damage\(t, base \* f \* evadeCompF\(p\)/.test(blast) && !/evadeCompF\(pm\)/.test(blast),
    '_blast:補償吃 evadeCompF(**p**)= 只補閃避那一半,MUST NOT 拿 pm(壓制不在「維持 DPS」的帳裡)');
  ok(/const p = this\._missP\(t, shooter\);[\s\S]{0,120}?p > 0 && Math\.random\(\) < p/.test(code(methodSrc('_dodges', S))),
    '_dodges 拆成「算率 + 擲骰」後仍保留 `p > 0` 短路 —— 不合格的目標不消耗亂數(逐位元同拆之前的亂數流)');
  // ---- ③b 高地壓制原文(2026-08-12 使用者定案:高度優勢越高,被擊中後 1 秒內命中/閃避/速度掉越多)----
  const stamp = code(methodSrc('_stampSup', S));
  ok(/if \(!by\) return;/.test(stamp) && /highSupF\(this\._altDh\(t, by\)\)/.test(stamp),
    '_stampSup:高度優勢相對**打你的那個人**取(同 _altRange/_altCrit/_dodgeP 的 dh 來源);無攻擊者(地雷/火場)不留壓制');
  ok(/t\.supF = Math\.max\(this\._supF\(t\), f\)/.test(stamp) && /t\.supUntil = this\.t \+ HIGH_SUP\.DUR_S/.test(stamp),
    '_stampSup:同窗多發取較強、窗一律續到最新一發(與 slowF 同一個處理)');
  ok(/this\._stampSup\(t, by\);/.test(code(methodSrc('_damage', S))),
    '_damage 的英雄分支是壓制的**唯一戳記處**(砲塔/主堡/小兵刻意不壓制:那會直接動到 bal ①④ 的校準錨)');
  ok(/Math\.min\(p, EVASION\.P_MAX\) \* highSupDodgeF\(this\._supF\(t\)\)/.test(code(methodSrc('_dodgeP', S))),
    '_dodgeP:壓制折扣套在**加總與夾制之後**(折的是「現在還閃不閃得掉」,不是逐項扣掉某一份加成)');
  for (const [f, src] of [['bots.js', read(['server', 'bots.js'])], ['game.js', read(['public', 'js', 'game.js'])]]) {
    ok(/highSupSpeedF\(/.test(code(src)),
      `${f} 的唯一取速處吃 highSupSpeedF —— 速度只在「位置權威」那一端折(伺服器 MUST NOT 對真人再折一次)`);
  }
  ok(!/highSupSpeedF/.test(simCode),
    'sim.js 不對真人再折一次速度(位置本就客戶端權威;bot 那半住 bots._speed)');
  // 強度形狀:一階(FLOOR)+ 斜坡。高地的**報酬**量出來就是這個形狀(跨過門檻先跳一段、再線性加碼),
  // 代價寫成純斜坡的話那個截距永遠配不掉 —— 症狀是「不管站多高,較高方恆多留 8.7% EHP」而斷言全綠。
  ok(/HIGH_SUP\.FLOOR \+ \(1 - HIGH_SUP\.FLOOR\) \* s/.test(code(D)),
    'highSupF 是「門檻一階 + 隨高度的斜坡」,MUST NOT 退回純 altScale(截距配不掉,見 bal ⑤c1)');
  ok(highSupF(0) === 0 && highSupF(altTier()) === 0 && highSupF(-altDhMax()) === 0,
    'highSupF:門檻以下與較低方一律 0(沒有高度優勢 = 逐位元同舊制)');
  ok(highSupF(altDhMax()) === 1 && highSupF(altTier() * 1.001) >= HIGH_SUP.FLOOR
    && highSupF(altDhMax()) > highSupF(altTier() * 2),
    'highSupF:剛跨過門檻就有 FLOOR、封頂 1、且中間嚴格遞增(「越高越多」是使用者定案的原句)');
}
{
  // ---- ④ 行為直測:同一個爆點,一台閃掉、旁邊的照樣掉血 ----
  const sim = new BattleSim(fakeCfg());
  purge(sim);
  // 挑一台「機動高到跨得過閃避門檻」的角色(不寫死代號:資料改了稽核仍成立)
  const fast = Object.keys(CHARACTERS).find((c) => {
    const k = charKind(c);
    return heroMobility(k, CHARACTERS[c].mods, k === 'drone') > evasionMinSpeed();
  });
  ok(!!fast, '資料中存在跨得過閃避門檻的機體(否則本段量不到東西)');
  const atk = sim.addHero('SWARM', 'p_atk', Object.keys(CHARACTERS)[0]);
  atk.x = 0; atk.z = 0;
  // addHero 不保證給到指定角色(席位/重複由它自己決定)⇒ 機體剖面在這裡釘死,
  // 否則抽到低機動的重甲就整段量不到東西,而稽核只會顯示「沒閃」看起來像功能壞了
  const mkFoe = (pid, x) => {
    const f = sim.addHero('STEEL', pid, fast);
    for (const b of [f, ...sim._bodies(f)]) {
      b.ch = fast; b.kind = charKind(fast);
      b.x = x; b.z = 0; b.y = 0; b.sp = 0; b.hp = 100000; b.maxHp = 100000;
    }
    f._spd = 999;   // 移動中(閃避門檻之一)
    return f;
  };
  const A = mkFoe('p_a', 1), B = mkFoe('p_b', 2);
  ok([A, B].every((f) => heroMobility(f.kind, CHARACTERS[f.ch].mods, f.kind === 'drone') > evasionMinSpeed()),
    '兩名受測目標都跨過閃避門檻(剖面釘死,不靠 addHero 給到誰)');
  const creep = sim._add({ kind: 'soldier', side: 'STEEL', x: 3, z: 0, y: 0, hp: 100000, maxHp: 100000 });
  const def = { dmg: 500, r: 40, pen: 0, vs: {} };
  const hp0 = (e) => (e.sp || 0) + e.hp;
  const orig = Math.random;
  // 骰**恆閃**:能閃的兩台都閃掉,不能閃的小兵照吃。刻意不用「第一顆骰閃、第二顆不閃」的序列
  // —— 那會把斷言綁在 `ents` 的走訪順序上,而順序不是這段要驗的東西(壞掉時紅的條目會亂跳)。
  Math.random = () => 0;
  const before = [hp0(A), hp0(B), hp0(creep)];
  sim._blast(atk, def, 1.5, 0, 0);
  Math.random = orig;
  ok(hp0(A) === before[0] && hp0(B) === before[1],
    '「原先的目標」閃掉 ⇒ 自己這一份完全免傷(使用者定案:整發閃開)');
  ok(hp0(creep) < before[2],
    '**同一個爆點、閃不掉的那個照樣掉血** —— 這就是「就算沒擊中原先的目標,也會造成範圍傷害」'
    + '(整發早退的寫法會讓這一項當場紅字)');
  ok(sim.events.filter((e) => e.e === 'dodge' && e.pid === atk.pid).length === 2,
    '每一份被閃的都各送一次 dodge 事件(逐目標 ⇒ 兩台就是兩筆;帶射手 pid ⇒ 客戶端跳 Miss)');
  // 對照:同一顆爆風、骰恆不中 ⇒ 兩台都掉血(排除「他們本來就吃不到這顆爆風」)
  const b2 = [hp0(A), hp0(B)];
  Math.random = () => 0.999;
  sim._blast(atk, def, 1.5, 0, 0);
  Math.random = orig;
  ok(hp0(A) < b2[0] && hp0(B) < b2[1], '對照:骰不中時兩台都在爆風內掉血(上一段的免傷確實來自閃避)');
}
{
  // ---- ⑤ 對照組:同一顆爆風,骰全部不中就是全額 —— 免得上一段的「掉血」其實是別的原因 ----
  const sim = new BattleSim(fakeCfg());
  purge(sim);
  const fast = Object.keys(CHARACTERS).find((c) => {
    const k = charKind(c);
    return heroMobility(k, CHARACTERS[c].mods, k === 'drone') > evasionMinSpeed();
  });
  const atk = sim.addHero('SWARM', 'p_atk2', Object.keys(CHARACTERS)[0]);
  atk.x = 0; atk.z = 0;
  const foe = sim.addHero('STEEL', 'p_f2', fast);
  for (const b of [foe, ...sim._bodies(foe)]) {
    b.ch = fast; b.kind = charKind(fast);
    b.x = 1; b.z = 0; b.y = 0; b.sp = 0; b.hp = 100000; b.maxHp = 100000;
  }
  foe._spd = 999;
  const def = { dmg: 500, r: 40, pen: 0, vs: {} };
  const orig = Math.random;
  Math.random = () => 0.999;                       // 恆不中
  const h0 = foe.hp;
  sim._blast(atk, def, 1, 0, 0);
  const full = h0 - foe.hp;
  Math.random = () => 0;                           // 恆閃開
  const h1 = foe.hp;
  sim._blast(atk, def, 1, 0, 0);
  const dodged = h1 - foe.hp;
  Math.random = orig;
  ok(full > 0 && dodged === 0,
    `同一發爆風:不閃 ${full.toFixed(0)} 傷害 / 閃開 0 —— 差別只有那一顆骰(實得 ${dodged})`);
  // 自損(榴彈最小安全射程的無差別模式)刻意不擲骰
  const orig2 = Math.random;
  Math.random = () => 0;
  const s0 = atk.hp + (atk.sp || 0);
  sim._blast(atk, def, atk.x, atk.z, 0, null, true);
  Math.random = orig2;
  ok(atk.hp + (atk.sp || 0) < s0,
    '自損不吃閃避:最小安全射程的自傷是代價,能閃開就變成擲骰躲懲罰');
}
{
  // ---- ⑥ NPC 肩射火箭:從「不可閃的單體直擊」變成真的爆炸(一發傷到範圍內所有敵方)----
  ok((WEAPONS.rocket.r || 0) > 0, 'NPC 肩射火箭是爆炸型(有爆風半徑)');
  const code = (s) => s.replace(/^\s*(\/\/|\*|\/\*).*$/gm, '');
  const npcTick = code(S.slice(S.indexOf('const wd = WEAPONS[u.wid] || STRUCT_W[e.kind];')));
  ok(/wd\?\.r[\s\S]{0,600}?this\._blast\(e, wd,[\s\S]{0,200}?u\.dmg\)/.test(npcTick),
    'NPC 爆炸型武器走 _blast(傷害基準 MUST 是 UNITS[kind].dmg —— NPC 傷害刻意不吃 vs 剋制)');
  ok(/wd\?\.r[\s\S]{0,900}?e: 'boom'/.test(npcTick),
    '補發 boom 事件:十幾二十公尺的超壓帶要看得見才讀得出危險區(演出取用的尺寸來自權威值)');
  const sim = new BattleSim(fakeCfg());
  purge(sim);
  const rk = sim._add({ kind: 'rocketeer', side: 'SWARM', x: 0, z: 0, y: 0, hp: 999, maxHp: 999 });
  const t1 = sim._add({ kind: 'soldier', side: 'STEEL', x: 30, z: 0, y: 0, hp: 100000, maxHp: 100000 });
  // z 取 18m:核心帶是 0.5r = 10m,擺在核心帶內兩個都是全額 —— 量不到遞減
  const t2 = sim._add({ kind: 'soldier', side: 'STEEL', x: 30, z: 18, y: 0, hp: 100000, maxHp: 100000 });
  const b1 = t1.hp, b2 = t2.hp;
  sim._blast(rk, WEAPONS.rocket, t1.x, t1.z, 0, null, false, UNITS.rocketeer.dmg);
  ok(t1.hp < b1 && t2.hp < b2,
    '一發火箭同時傷到爆風內的兩名敵方(舊制只有被瞄準的那一個掉血,旁邊的毫髮無傷)');
  ok(b1 - t1.hp > b2 - t2.hp, '離爆心越遠吃得越少(走同一支 blastFalloff)');
}
{
  // ---- ⑥b 攻城榴彈砲也是爆炸型(2026-08-13 使用者定案「榴彈類…無論是對地或對目標發射,
  //      都會對範圍內所有單位造成傷害」)----
  // 舊制 `WEAPONS.siege` 沒有 `r` ⇒ 榴彈兵與坦克的砲彈是**單體直擊**:客戶端照樣畫拋物線曳光
  // (game._arcTracer 認 howitzer/tank),伺服器卻只有被瞄準的那一個掉血 —— 一把名為「榴彈砲」
  // 的武器落在使用者這條規則之外,而畫面上完全看不出來(曳光、砲管仰角、命中特效都正常)。
  ok((WEAPONS.siege.r || 0) > 0, 'NPC 攻城榴彈砲是爆炸型(有爆風半徑)—— 榴彈類 MUST 真的爆');
  // 半徑 MUST 推導不手寫:以肩射火箭為軸的「爆風面積 × 持續 DPS」預算,榴彈兵與坦克共用
  // 這把武器 ⇒ 取兩者的幾何中點。手寫一個數字進去 = 改 UNITS 的 dmg/rate 之後它自己漂走。
  const dps = (k) => UNITS[k].dmg * UNITS[k].rate;
  const want = Math.round(WEAPONS.rocket.r
    * Math.sqrt(dps('rocketeer') / Math.sqrt(dps('howitzer') * dps('tank'))) * 10) / 10;
  ok(WEAPONS.siege.r === want,
    `攻城榴彈砲爆風半徑是推導值(${WEAPONS.siege.r}m = 火箭 ${WEAPONS.rocket.r}m × √(火箭兵 DPS ÷ 榴彈兵·坦克幾何中點))`);
  ok(want < WEAPONS.rocket.r,
    '打得越頻繁、單發炸得越小(榴彈兵 0.3/s + 坦克 0.6/s vs 火箭兵 0.4/s ⇒ 半徑 MUST 小於火箭)');
  // 行為直測:坦克一發砲彈同時傷到爆風內的兩名敵方(NPC 分支的 `wd?.r` 那一支真的接上了)。
  // 兩人的間距取**推導值**的核心帶(不是現值)—— 拿 `WEAPONS.siege.r` 當間距的話,退回舊制
  // (r = 0)會讓兩個假人重疊在爆心上,兩個都吃滿 ⇒ 反向驗證恆綠。
  const sim = new BattleSim(fakeCfg());
  purge(sim);
  const tk = sim._add({ kind: 'tank', side: 'SWARM', x: 0, z: 0, y: 0, hp: 999, maxHp: 999 });
  const c = want * BLAST.CORE * 0.9;   // 兩個都擺核心帶內 ⇒ 全額(遞減另由火箭那段量)
  const g1 = sim._add({ kind: 'soldier', side: 'STEEL', x: 30, z: 0, y: 0, hp: 100000, maxHp: 100000 });
  const g2 = sim._add({ kind: 'soldier', side: 'STEEL', x: 30, z: c, y: 0, hp: 100000, maxHp: 100000 });
  sim._blast(tk, WEAPONS.siege, g1.x, g1.z, 0, null, false, UNITS.tank.dmg);
  ok(g1.hp < 100000 && g2.hp < 100000,
    '一發攻城榴彈同時傷到爆風內的兩名敵方(舊制只有被瞄準的那一個掉血)');
}
{
  // ---- ⑥c 名冊擴到「**所有**爆炸傷害武器」(2026-08-13 使用者追加)----
  // 還漏在外面的都不是小兵武器,所以不會被 ⑥/⑥b 的 `wd?.r` 那一支涵蓋:
  //   ・主堡火砲:連 def 都沒有(無 `wid`)⇒ 舊制既不可閃也不爆風
  //   ・第三方防空伏擊飛彈:近炸引信 `_damage` 單體結算,而同一行的 `boom` 畫著 r = 14 的超壓帶
  // 半徑一律走同一個縫 `npcBlastR`(面積 × 火力守恆),**軸與被算的那一把 MUST 同單位**:
  // 持續射擊用 DPS、一次性彈藥用單發傷害(拿 DPS 算伏擊飛彈會除到近 0 ⇒ 半徑膨脹到 95m)。
  const dps = (k) => UNITS[k].dmg * UNITS[k].rate;
  const code = (s) => s.replace(/^\s*(\/\/|\*|\/\*).*$/gm, '');
  ok(STRUCT_W.base.r === Math.max(npcBlastR(dps('base'), NPC_BLAST.DPS), npcBlastR(dps('tower'), NPC_BLAST.DPS)),
    `主堡火砲的爆風半徑 = 合併前兩把推導值的**較大者**(${STRUCT_W.base.r}m;拿合併後的 DPS 重推會縮回本體那一份)`);
  // 防禦塔是**單體攻擊武器**(2026-08-13 使用者定案「塔換成單體攻擊武器,傷害不變」)。
  // 這裡釘的是**查不到 def**,不是「r = 0 的 def」—— 後者會讓 evadable() 判 true(判據是排除法),
  // 塔火從此可閃**而且沒有補償**(evadeComped 要 r > 0)⇒ 期望傷害掉 ×(1−p),與「傷害不變」衝突,
  // 而畫面上只表現成「塔好像變弱了」,沒有任何錯誤訊息。
  ok(STRUCT_W.tower === undefined, '防禦塔 MUST NOT 有 def(單體攻擊武器;`r: 0` 的 def 也不行)');
  ok(evadable(STRUCT_W.tower) === false && evadeComped(STRUCT_W.tower) === false,
    '塔火不可閃、也不進補償 ⇒ 對主目標的傷害逐位元同舊制');
  ok(GAME.AA_AMBUSH.R === npcBlastR(GAME.AA_AMBUSH.DMG, NPC_BLAST.SHOT) && GAME.AA_AMBUSH.R > 0,
    `第三方伏擊飛彈的爆風半徑是推導值(${GAME.AA_AMBUSH.R}m;一次性彈藥 ⇒ 軸取單發傷害)`);
  ok(STRUCT_W.base.r < WEAPONS.siege.r && WEAPONS.siege.r < WEAPONS.rocket.r,
    '同一條預算下的排序:火力越猛半徑越小(主堡 < 攻城榴彈砲 < 肩射火箭)');
  {
    // ---- 主堡兩把武器合併(2026-08-13 使用者定案「射程/範圍/傷害等參數都挑最大值」)----
    // 合併前:本體火砲(dmg 90 / rate 1.2 / range 230)+ 雙聯裝砲(整組 derive 自砲塔)。
    // 這裡逐項釘住「取最大值」,並釘住**開火路徑只剩一條** —— 合併卻留著主迴圈那一支的話,
    // 主堡會同時用兩套射控開火,總火力不減反增,而每一條既有斷言都還是綠的。
    const g = UNITS.base.guns;
    ok(g.range === Math.max(UNITS.base.range, UNITS.tower.range)
      && g.dmg === Math.max(UNITS.base.dmg, UNITS.tower.dmg)
      && g.rate === Math.max(UNITS.base.rate, UNITS.tower.rate) && g.n === 2,
    `主堡火砲逐項取最大值(射程 ${g.range} / 傷害 ${g.dmg} / 射速 ${g.rate} / 砲管 ${g.n})`);
    ok(UNITS.base.range === g.range && UNITS.base.dmg === g.dmg && UNITS.base.rate === g.rate,
      '主堡自己的 range/dmg/rate 也是合併後那一份(否則賞金與圖鑑還在讀合併前的本體火砲)');
    ok(/if \(e\.cd === 0 && !u\.guns &&/.test(code(S)),
      '主迴圈對 `u.guns` 的單位不開火 ⇒ 合併後開火路徑只剩 `_tickBaseGuns` 一條');
    // 行為直測:主堡在一個 tick 內只由砲管路徑開火,且發數 = 砲管數
    const sim2 = new BattleSim(fakeCfg());
    purge(sim2);
    for (const e of [...sim2.ents.values()]) sim2.ents.delete(e.id);
    const bs = sim2._add({ kind: 'base', side: 'STEEL', x: 4000, z: 4000, y: 0, hp: 9999, maxHp: 9999, cd: 0 });
    const vv = sim2._add({ kind: 'soldier', side: 'SWARM', x: bs.x + 60, z: bs.z, y: 0, hp: 1e7, maxHp: 1e7 });
    sim2.events.length = 0;
    sim2.tick(0.125);
    const shots = sim2.events.filter((ev) => ev.e === 'shot' && ev.id === bs.id);
    ok(shots.length === g.n && shots.every((ev) => ev.gi != null),
      `主堡一輪開 ${shots.length} 發、全部來自砲管路徑(MUST = 砲管數 ${g.n};本體火砲那一支已不再開火)`);
    ok(vv.hp < 1e7, '合併後的主堡火砲照樣打得到目標');
  }
  ok(!('r' in WEAPONS.rgun),
    '重型機槍 MUST NOT 有爆風 —— 動能武器不是爆炸傷害武器(名冊不是「全部都給」)');
  {
    // 行為直測(走真的 tick,不是直呼 _blast):塔開一發 ⇒ **只有目標**掉血,旁邊那個一格未動
    const sim = new BattleSim(fakeCfg());
    purge(sim);
    for (const e of [...sim.ents.values()]) sim.ents.delete(e.id);   // 清場:只留受測三個實體
    const tw = sim._add({ kind: 'tower', side: 'STEEL', x: 4000, z: 4000, y: 0, hp: 9999, maxHp: 9999, cd: 0 });
    const v1 = sim._add({ kind: 'soldier', side: 'SWARM', x: tw.x + 60, z: tw.z, y: 0, hp: 1e7, maxHp: 1e7 });
    const v2 = sim._add({ kind: 'soldier', side: 'SWARM', x: tw.x + 60, z: tw.z + 4, y: 0, hp: 1e7, maxHp: 1e7 });
    sim.tick(0.125);
    const hurt = [v1, v2].filter((v) => v.hp < 1e7).length;
    ok(hurt === 1, `塔開火只傷到瞄準的那一個(實得 ${hurt} 個;4m 外的旁觀者 MUST 毫髮無傷)`);
    // 「傷害不變」= 這一發等於「拿 UNITS.tower.dmg 直接走 _damage」(對照組自己算,免得把
    // 護甲減免手抄成第二份公式)
    const ref = sim._add({ kind: 'soldier', side: 'SWARM', x: tw.x - 400, z: tw.z, y: 0, hp: 1e7, maxHp: 1e7 });
    sim._damage(ref, UNITS.tower.dmg, tw, 0);
    ok(Math.abs((1e7 - Math.min(v1.hp, v2.hp)) - (1e7 - ref.hp)) < 1e-6,
      `塔的單發傷害逐位元同「UNITS.tower.dmg 直接結算」(${(1e7 - ref.hp).toFixed(2)})—— 「傷害不變」`);
  }
  // 原文:每個消費端都接到既有的那一支,MUST NOT 各自寫第二份傷害
  ok(/const wd = WEAPONS\[u\.wid\] \|\| STRUCT_W\[e\.kind\]/.test(code(S)),
    '建築制式火砲走 STRUCT_W 這個 def 縫(傷害/射速/射程仍住 UNITS,MUST NOT 複製第二份)');
  const guns = code(S.slice(S.indexOf('_tickBaseGuns(e, g, dt)')));
  ok(/this\._blast\(e, STRUCT_W\.base,[\s\S]{0,120}?g\.dmg\)/.test(guns)
    && !/this\._damage\(target, g\.dmg/.test(guns.slice(0, 1200)),
  '主堡火砲走 _blast(舊制的單體 _damage MUST 已經不在)');
  const mis = code(S.slice(S.indexOf('_samBlast(m, x, z, y')));
  ok(/_blast\(by, \{ r: GAME\.AA_AMBUSH\.R, pen: m\.pen \|\| 0 \}/.test(mis)
    && /r: GAME\.AA_AMBUSH\.R, side: m\.side, sam: true/.test(mis),
  '伏擊飛彈的結算與演出取**同一個** GAME.AA_AMBUSH.R(舊制手寫 14 / 8,誰都對不上)');
  // 只掃 `_tickMissiles` 這一段:別處的 `r: 8` 是**攔截成功**的煙火(極音速飛彈被擊落刻意不引爆、
  // 玩家打掉來襲飛彈),那是「完全否定」的定案,MUST NOT 被這條順手改掉。
  const misTick = code(S.slice(S.indexOf('  _tickMissiles(dt) {'), S.indexOf('  _creepMul(side, lane)')));
  ok(misTick.length > 200 && !/r: 14|r: 8/.test(misTick),
    '飛彈引爆點的手寫半徑(14 / 8 / 8)MUST 已全數退場');
  ok((code(S).match(/this\._samBlast\(/g) || []).length === 3,
    '飛彈的三個引爆點(近炸引信 / 追蹤中撞障礙 / 失鎖後撞障礙)MUST 全走同一支 _samBlast');
  // 行為直測:伏擊飛彈引爆傷到爆風內的兩名敵方 + 演出半徑 = 結算半徑
  const sim = new BattleSim(fakeCfg());
  purge(sim);
  const site = sim._add({ kind: 'aasite', side: 'STEEL', x: 0, z: 0, y: 0, hp: 999, maxHp: 999 });
  const a1 = sim._add({ kind: 'soldier', side: 'SWARM', x: 60, z: 0, y: 0, hp: 100000, maxHp: 100000 });
  const a2 = sim._add({ kind: 'soldier', side: 'SWARM', x: 60, z: GAME.AA_AMBUSH.R * BLAST.CORE * 0.9, y: 0, hp: 100000, maxHp: 100000 });
  sim.events.length = 0;
  sim._samBlast({ byId: site.id, side: 'STEEL', dmg: GAME.AA_AMBUSH.DMG, pen: GAME.AA_AMBUSH.PEN },
    a1.x, a1.z, 0, 0);
  ok(a1.hp < 100000 && a2.hp < 100000, '伏擊飛彈引爆同時傷到爆風內的兩名敵方');
  ok(sim.events.some((ev) => ev.e === 'boom' && ev.r === GAME.AA_AMBUSH.R),
    'boom 事件帶的半徑 = 結算用的那一份(演出取用權威值)');
}

{
  // ---- ⑦ 閃避補償:「維持 DPS 提高傷害,閃避率不動」(2026-08-12 使用者定案)----
  // 把爆炸傷害納入閃避,代價是它對機動機體的期望輸出整組 ×(1−p)(實測讓 bal ①⑤⑦e 三項出界)。
  // 使用者的收法不是調閃避率,而是把被閃掉的那一份**還給沒被閃掉的那幾發**:
  //     期望傷害 = dmg × (1−p) × 1/(1−p) ≡ dmg
  // 會靜默壞掉的兩種寫法:①拿**全體平均**當單一係數 —— 閃不掉的小兵/建築/重甲會平白吃到那份
  // 補償,那是通膨不是補償;②把補償也套到**輕武器**上 —— 它自 2026-07-14 就吃閃避,基準 DPS
  // 早就含著那份損失,補它等於憑空加傷。兩種都不會有任何錯誤訊息,只會讓平衡整組漂掉。
  ok(evadeCompF(0) === 1, 'evadeCompF(0) === 1 ⇒ 閃不掉的目標(小兵/建築/低機動重甲)逐位元同舊制');
  for (const p of [0.2, 0.35, 0.45, 0.78]) {
    ok(Math.abs((1 - p) * evadeCompF(p) - 1) < 1e-12,
      `p=${p}:期望輸出 (1−p)×${evadeCompF(p).toFixed(3)} ≡ 1(維持 DPS 是等式不是估計)`);
  }
  ok(Number.isFinite(evadeCompF(1)) && evadeCompF(1) === 1 / (1 - EVASION.P_MAX),
    `p→1 由 EVASION.P_MAX 夾住(分母是 1−p,沒有夾就會炸;實得上限 ×${evadeCompF(1).toFixed(0)})`);
  ok(evadeComped(WEAPONS.rocket) && evadeComped(WEAPONS.siege) && !evadeComped(WEAPONS.rgun),
    'evadeComped:只補「這一輪新納入閃避的那一批」= 爆炸傷害(NPC 兩把爆炸型都在內);直射槍械 MUST NOT 補(它本來就吃閃避)');
  ok(evadeComped({ dmg: 100, r: 20, pen: 4, vs: {} }) && !evadeComped({ id: 'light' }),
    'evadeComped:招式/載具戰鬥部的爆風要補、輕武器直射不補');
  {
    const byCls = { blast: 0, other: 0 };
    for (const id of Object.keys(CHARACTERS)) {
      for (const slot of ['light', 'heavy']) {
        const def = heroWeapon(id, slot, 1, true);
        if (aoeClass(def) === 'blast') byCls.blast += evadeComped(def) ? 1 : -99;
        else byCls.other += evadeComped(def) ? -99 : 1;
      }
    }
    ok(byCls.blast > 0 && byCls.other > 0,
      `全 32 角兩槽位:爆炸型 ${byCls.blast} 把全部有補償、其餘 ${byCls.other} 把全部沒有`);
  }
  // 期望值縫:平衡模型吃的那一支 MUST 與伺服器的擲骰同源
  ok(evadeExpF(WEAPONS.rocket, 0.35) === 1 && evadeExpF(WEAPONS.rgun, 0.35) === 0.65,
    'evadeExpF:爆炸傷害的期望倍率恆 1(有補償)、直射槍械是 1−p(無補償)');
  ok(evadeExpF({ id: 'heavy', type: 'beam' }, 0.35) === 1,
    'evadeExpF:貫穿/扇形依機制豁免 ⇒ 期望倍率 1(不是因為補償,是根本不擲)');
  {
    // 行為直測:同一個目標、同一顆爆風,閃與不閃的**期望值**等於沒有閃避時的傷害
    const sim = new BattleSim(fakeCfg());
    purge(sim);
    const fast = Object.keys(CHARACTERS).find((c) => {
      const k = charKind(c);
      return heroMobility(k, CHARACTERS[c].mods, k === 'drone') > evasionMinSpeed();
    });
    const atk = sim.addHero('SWARM', 'p_atk3', Object.keys(CHARACTERS)[0]);
    atk.x = 0; atk.z = 0;
    const foe = sim.addHero('STEEL', 'p_f3', fast);
    for (const b of [foe, ...sim._bodies(foe)]) {
      b.ch = fast; b.kind = charKind(fast);
      b.x = 1; b.z = 0; b.y = 0; b.sp = 0; b.hp = 1e9; b.maxHp = 1e9;
    }
    foe._spd = 999;
    const def = { dmg: 500, r: 40, pen: 0, vs: {} };
    const p = sim._dodgeP(foe, atk);
    ok(p > 0, `受測目標的閃避率 p = ${p.toFixed(2)}(> 0,否則本段量不到補償)`);
    const orig = Math.random;
    Math.random = () => 0.999;                 // 恆不中 ⇒ 量到的一律是「沒被閃掉」的那一發
    // 基準:**同一台機體**站著不動 ⇒ 不符合閃避條件 ⇒ p = 0 ⇒ 沒有補償。
    // 拿同一個實體當基準是刻意的 —— 換一台機體就換了護甲/量體,量到的差就不只是補償係數。
    foe._spd = 0;
    const b0 = foe.hp;
    sim._blast(atk, def, 1, 0, 0);
    const plain = b0 - foe.hp;
    foe._spd = 999;                            // 移動中 ⇒ p > 0 ⇒ 這一發吃補償
    const h0 = foe.hp;
    sim._blast(atk, def, 1, 0, 0);
    const hit = h0 - foe.hp;
    Math.random = orig;
    ok(plain > 0 && Math.abs(hit - plain * evadeCompF(p)) < 1e-6,
      `補償是**實得的**:站樁 ${plain.toFixed(1)} → 移動中 ${hit.toFixed(1)}(= ×${evadeCompF(p).toFixed(3)});`
      + '拿全體平均當單一係數會在這裡對不上');
    ok(Math.abs(hit * (1 - p) - plain) < 1e-6,
      `期望值回到改制前:${hit.toFixed(1)} × (1−${p.toFixed(2)}) = ${plain.toFixed(1)}(維持 DPS 是等式不是估計)`);
    // 閃不掉的目標:同一發爆風的傷害 MUST 逐位元不吃補償
    const creep = sim._add({ kind: 'soldier', side: 'STEEL', x: 1, z: 0, y: 0, hp: 1e9, maxHp: 1e9 });
    ok(sim._dodgeP(creep, atk) === 0, '小兵的 p = 0 ⇒ 補償係數 1 ⇒ 爆風傷害逐位元同舊制');
  }
}

// ---------------------------------------------------------------------------------
console.log(`\n${fail === 0 ? '✅' : '❌'} 武器命中閘門稽核:${pass} 綠 / ${fail} 紅`);
process.exit(fail === 0 ? 0 : 1);

// ---------------------------------------------------------------------------------
function purge(sim) {
  for (const s of [...sim.ents.values()]) if (s.tp) sim.ents.delete(s.id);
  sim.camps = [];
}
function fakeCfg(L = 1) {
  const A = [25.0330, 121.5654];
  const Dm = 1600 * L, R = 6371000;
  const realD = Dm * MAPGEO.REAL_SCALE;
  const dLat = realD / R * 180 / Math.PI;
  const B = [A[0] + dLat, A[1]];
  const mid = [(A[0] + B[0]) / 2, (A[1] + B[1]) / 2];
  const pts = [];
  for (let t = 0; t <= 1.001; t += 0.05) pts.push([A[0] + (B[0] - A[0]) * t, A[1]]);
  const sizeM = Dm / (0.85 * Math.SQRT2);
  return {
    center: { lat: mid[0], lng: mid[1] },
    bases: { SWARM: A, STEEL: B },
    lanes: [pts],
    sizeM, diagM: sizeM * Math.SQRT2, distM: Dm,
    geoScaleVer: MAPGEO.GEO_SCALE_VER,
    maxOverlap: 0.05, synthetic: true, placeName: '稽核戰區',
    env: { season: 'summer', time: 'day', weather: 'clear' },
  };
}
