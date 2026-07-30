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
  const env = { THREE, BALLISTIC, ARC_MAXP, RANGE_GLOW, TARGET_CLASS, blastCoreR, lobMinRange, armingOf };
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
