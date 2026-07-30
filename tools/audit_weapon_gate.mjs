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
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  RANGE_TOL, altRangeMax, ALTITUDE, BLAST, blastCoreR, blastFalloff,
  REACH_RULE, reachRule, trajClass, aoeClass, armingOf, lobMinRange,
  BALLISTIC, TARGET_CLASS, CHARACTERS, heroWeapon, hitR, MAPGEO,
  shotV0, flightCapS, SEEK, seekTurn,
} from '../public/js/data.js';
import { BattleSim } from '../server/sim.js';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
// 換行一律正規化成 LF:工作副本在 Windows 上是 CRLF,方法尾端的 `\n  }` 比對會整組失手
const read = (p) => readFileSync(join(ROOT, ...p), 'utf8').replace(/\r\n/g, '\n');
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
  ok(tolGates.length >= 8, `sim.js 射程閘門吃 RANGE_TOL 單一縫(${tolGates.length} 處)`);
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
// 客戶端彈道上限(game.js `_tryFire` 建立彈體時的 b.max)= range × _altRangeMul × 重砲窗,
// 而 _altRangeMul 的上界就是 altRangeMax();伺服器 heroBurst 的上界 MUST ≥ 它。
{
  const alt = methodSrc('_altRangeMul', G);
  ok(/1 \+ ALTITUDE\.RANGE \* altScale\(dh\)/.test(alt),
    '客戶端 _altRangeMul 的上界 = 1 + ALTITUDE.RANGE(= altRangeMax(),兩端同一條公式)');
  ok(/max: def\.range \* this\._altRangeMul\(def\) \* rMul/.test(G),
    '客戶端彈體射程上限 = range × _altRangeMul × 重砲窗');
  const burst = methodSrc('heroBurst', S);
  ok(/const impCap = wp\.def\.range \* altRangeMax\(\) \* RANGE_TOL;/.test(burst),
    'heroBurst 落點閘門 = range × altRangeMax() × RANGE_TOL(三個因子皆推導)');
  const burstCode = burst.replace(/^\s*\/\/.*$/gm, '');   // 只驗可執行原文(說明裡提得到舊值 1.15)
  ok(!/1\.15/.test(burstCode), 'heroBurst 不再手寫 1.15(舊制比其餘閘門緊 ⇒ 高地榴彈靜默丟包)');
  ok((burst.match(/impCap/g) || []).length >= 3,
    '僚機齊射吃同一道 impCap(舊制僚機另寫一份、還漏掉重砲窗)');
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
  ok(/this\._reachable\(ent, def, rule, rng\)/.test(rg),
    '_updateRangeGlows 的亮暗由 _reachable 定案(MUST NOT 退回只量距離)');
  ok(/reachRule\(def\)/.test(rg), '_updateRangeGlows 經 reachRule() 取規則');
  ok(!/trajClass\(|def\.type ===/.test(rg) && !/trajClass\(|def\.type ===/.test(re),
    '光暈路徑 MUST NOT 自己比對 trajClass / def.type(第二份分類表 = 分家)');
  ok(/rule\.hit === 'blast'/.test(re) && /rule\.path === 'arc'/.test(re) && /rule\.arm/.test(re),
    '_reachable 三個欄位全數消費(規則表沒有寫了不用的欄位)');
  ok(/blastCoreR\(def\)/.test(re), '爆炸戰鬥部的判據 = 落點落在爆風核心帶(blastCoreR,推導不手寫)');
  ok(/def\.range \* this\._altRangeMul\(def\) \* rMul/.test(rg),
    '光暈的有效射程與擊發同一組(高度制空 + 重砲窗;漏乘 = 光暈比實際射程短)');
}
// 彈道積分單一縫:繪製與判定共用一份
{
  ok((G.match(/BALLISTIC\.G \* step/g) || []).length === 1,
    'game.js 只有一份彈道積分迴圈(_arcTrace;第二份 = 光暈與虛線分家)');
  const ladder = methodSrc('_lobLadder', G);
  ok(/this\._arcTrace\(from, this\._lobVel\(from, aim, v\), max, aim, draw\)/.test(ladder),
    '_lobLadder 的每一級裝藥都走 _arcTrace(draw 由呼叫端決定寫不寫繪製緩衝)');
  const aim = methodSrc('_lobAim', G);
  const re = methodSrc('_reachable', G);
  ok(/this\._lobLadder\(/.test(aim) && /this\._lobLadder\(/.test(re),
    '火控解(_lobAim)與光暈判定(_reachable)吃同一份逐級降裝藥階梯');
  ok(!/for \(let k = 0; k < Z\.length/.test(aim), '_lobAim 不再自己跑一次裝藥階梯(已收進 _lobLadder)');
  ok(/if \(draw\) this\._ensureArcGuide\(\);/.test(methodSrc('_arcTrace', G)),
    '_arcTrace 只在 draw 時碰繪製緩衝(判定路徑 MUST NOT 踩壞正在顯示的瞄準虛線)');
}

// =================================================================================
sec('Ⅴ _reachable 行為直測:逐彈道類型各自的判定');
// ---------------------------------------------------------------------------------
{
  // ---- 最小 Vector3(只實作 _arcTrace/_lobVel/_reachable 用到的運算)----
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
  const THREE = { Vector3: V3 };
  const ARC_MAXP = Number(/const ARC_MAXP = (\d+);/.exec(G)?.[1]);
  ok(ARC_MAXP > 0, `game.js 的 ARC_MAXP 取得(${ARC_MAXP})`);
  const RANGE_GLOW = new Function(`return ${/const RANGE_GLOW = (\{[^}]*\});/.exec(G)[1]}`)();
  const env = { THREE, BALLISTIC, ARC_MAXP, RANGE_GLOW, TARGET_CLASS, blastCoreR, lobMinRange, armingOf, shotV0 };
  const M = (n) => pickMethod(n, G, env);
  // 樁:平地無障礙 → _layerHitT 由外部注入的 walls 決定
  const mkClient = (walls = []) => ({
    gunGroup: null,
    camera: { position: new V3(0, 2, 0) },
    _shotV0: M('_shotV0'),
    _lobSolve: M('_lobSolve'),
    _lobVel: M('_lobVel'),
    _arcTrace: M('_arcTrace'),
    _lobLadder: M('_lobLadder'),
    _reachable: M('_reachable'),
    _hitR: (e) => e._hr ?? 1,
    // 牆 = 沿 +X 的一道垂直面,擋住 x ≥ wx 的射線;回傳截斷距離
    _layerHitT(ax, ay, az, bx, by, bz) {
      let best = null;
      for (const w of walls) {
        if (ax >= w.x || bx <= w.x) continue;
        const t = (w.x - ax) / (bx - ax);
        const y = ay + (by - ay) * t;
        if (y > w.top) continue;                       // 從牆頂越過(拋物線高角度解)
        const d = Math.hypot(bx - ax, by - ay, bz - az) * t;
        if (best == null || d < best) best = d;
      }
      return best;
    },
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
    ok(core > 2, `測試前置:爆風核心半徑 ${core.toFixed(1)}m`);
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
      `榴彈:存在連全裝藥低伸解都擋住、仍打得到的稜線(${overFull}m)→ 降裝藥階梯確實生效`);
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
  ok(/export const flightCapS = \(def\) =>\s*\(def \? def\.range \* altRangeMax\(\) \* RANGE_TOL \/ shotV0\(def\) : 0\);/.test(D),
    'flightCapS 原文 = 落點閘門上界 ÷ shotV0(三個因子全推導,MUST NOT 手寫秒數)');
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
    ok(/this\.t - \(h\.aimOffAt \?\? -Infinity\) > flightCapS\(wp\.def\)/.test(burst),
      'heroBurst 的需瞄準閘門給滿一整段飛行時間的寬容(推導自 flightCapS)');
    ok(/const back = Math\.min\(dImp \/ shotV0\(wp\.def\), flightCapS\(wp\.def\)\);/.test(burst),
      'heroBurst 由落點距離反推擊發時刻(上限仍是 flightCapS,不因客戶端謊報而失守)');
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
    const chId = heavyOf('fnf').id;
    const cap = flightCapS(heavyOf('fnf').def);
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
  }

  // ---- ③ 射後不理真的會追蹤:MUST NOT 只認伺服器複驗過的 _lockId ----
  {
    const fire = methodSrc('_tryFire', G);
    ok(/this\._aimTarget\(def\.range \* this\._altRangeMul\(def\) \* rMul\)\?\.id/.test(fire),
      '_tryFire 的追蹤目標在拿不到 _lockId 時退回擊發當下的準星解(_aimTarget)');
    ok(!/def\.type === 'missile' && this\._lockId != null/.test(fire),
      '_tryFire 不再「只認 _lockId」(而射程光暈刻意排除 _lockId ⇒ 每個亮著的目標都保證不被追蹤)');
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
    ok(/const spent = b\.seek \? b\.pos\.distanceTo\(b\.origin\) : b\.dist;/.test(ub),
      '導引彈的射程包絡量直線(與失鎖判定/伺服器落點閘門/射程光暈三處同一把尺;航跡長恆長於直線)');
    ok(/seek: !!arm/.test(methodSrc('_tryFire', G)), 'seek 旗標由 armingOf(def) 推導(導引/射後不理才有)');
    ok(/dist >= max/.test(methodSrc('_arcTrace', G)),
      '對照:無導引彈(拋物線瞄準虛線)仍量航跡長 —— 弧長本來就該算進射程消耗');
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
    ok(/const armed = b\.dist >= \(b\.arm \|\| 0\);/.test(ub), '解保險距離量的是航跡長 b.dist');

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
      let travelled = 0, best = Infinity;
      const dt = 1 / 60;
      const turn = (want, w) => {          // game.js 的 steer():等速改向,每秒最大轉角 w
        const cur = nrm3(vel);
        const ang = Math.acos(Math.max(-1, Math.min(1, dot3(cur, want))));
        const k = Math.min(1, w * dt / (ang || 1e-9));
        vel = nrm3(cur.map((c, i) => c + (want[i] - c) * k)).map((x) => x * v0);
      };
      for (let i = 0; i < 20000; i++) {
        const armed = travelled >= arm;
        if (mode === 'home' && armed) {
          turn(nrm3(sub3([tgt[0], tgt[1] + 1.5, tgt[2]], pos)), seekTurn(SEEK.HOME_W, v0));
        } else if (mode === 'guide' && armed) {
          const rd = nrm3(sub3(tgt, eye));
          const along = Math.max(20, dot3(sub3(pos, eye), rd) + 40);
          turn(nrm3(sub3(eye.map((e, k2) => e + rd[k2] * along), pos)), seekTurn(SEEK.RIDE_W, v0));
        } else vel[1] -= BALLISTIC.G * dt;
        const prev = [...pos];
        pos = pos.map((p, k2) => p + vel[k2] * dt);
        travelled += len3(sub3(pos, prev));
        best = Math.min(best, segD(prev, pos, tgt));
        if (pos[1] <= 0) break;
        if ((mode === 'dumb' ? travelled : len3(sub3(pos, eye))) >= max) break;
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
