// ============ Self-buff attack ults: compensation + player-following support fleet ============
// 2026-08-06 decision: chassis ults (saturation strike / cluster bombs / hypersonic missile) retire as a
// group; hold-right becomes the ability gesture (normal → guard / aimed → attack). The 22 attack ults
// already migrated to carriers trade their hold for the attack move; the remaining 10 **pure self-type** attack ults
// have no vehicle to trade into ⇒ the removed budget folds into the attack ult itself (data.js SELF_ATK).
// 2026-08-07 decision (this file's section V): those 10 are instead supplied by a **player-following
// support fleet** (data.js ATK_SUPPORT) — some moves send several frames, multiple frames' states
// **stack**; sustained fleets outlast intermittent ones, intermittent outlast instant ones — longer dur,
// tougher fleet.
//
// Guarded diseases (all error-silent):
//   - Hand-write the equivalent as one multiplier ⇒ later edits to any character's `ult.cd` or
//     `SPECIAL.BASE` silently de-calibrate compensation, showing on screen only as "these few feel weaker";
//   - Compute compensation as "one more multiplicative layer" instead of an **increment** ⇒
//     1.35 x 2.35 = 3.17 instead of 2.35 (one budget too many);
//   - The 22 carrier-migrated ults also take compensation ⇒ hold-traded-for-attack **plus** a conversion share
//     (double budget claim);
//   - The stealth burst window opens in `_castEffect` ⇒ hiding without firing still burns that second
//     (players just feel "the burst never landed");
//   - `brk` (ends on one hit taken) missing some damage path ⇒ that source's damage never breaks overload;
//   - Clamps shaving derived values without record ⇒ "compensation is derived" stops holding for those
//     few (silent truncation);
//   - Stacking written as "each frame pushes its own mods" ⇒ multiplied by `_buffMul`
//     ((1+(m−1)/N)^N ≠ m): stronger than legacy at full attendance, reconciling only at the instant
//     "exactly this many frames live";
//   - Support frames re-baselining window `until` from now on every join/leave ⇒ the move extends forever,
//     never ends;
//   - One-shot parts (revive / cleanse / full magazine / fog-free vision) replaying along ⇒ several shares
//     from one cast;
//   - Fleet wiped yet binary states outside mods (stealth / no-reload) never revoked ⇒ "all escorts down
//     and still invisible";
//   - Delivery-leg expiry checked before propulsion ⇒ instant types (dur = 0) collected on the tick-quantized
//     frame = **never delivered**.
//
// Usage: `node tools/audit_self_ult.mjs`
//   Reverse verification (principle 9; matching items MUST go red at once, otherwise nothing is verified):
//     `--break-eq`    selfAtkEq as hand-written constant (no longer follows cd / budget) ⇒ I red
//     `--break-alpha` stealth window opens in `_castEffect` (not at firing-reveal) ⇒ III/IV red
//     `--break-brk`   `_damage` no longer calls `_breakOnHit` (overload unbreakable) ⇒ III/IV red
//     `--break-stack` stacking as multiplication (mf degenerates to identity) ⇒ V red
//     `--break-tempo` tempo coefficients all 1 (sustain/pulse/burst same toughness) ⇒ V red
// Exit code: 0 = all green; 1 = red present
import { mkdtempSync, writeFileSync, copyFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { pathToFileURL } from 'node:url';
import { readSrc, grabMethod } from './audit_src.mjs';

const ARGV = new Set(process.argv.slice(2));
const BREAK_EQ = ARGV.has('--break-eq');
const BREAK_ALPHA = ARGV.has('--break-alpha');
const BREAK_BRK = ARGV.has('--break-brk');
const BREAK_STACK = ARGV.has('--break-stack');
const BREAK_TEMPO = ARGV.has('--break-tempo');

let pass = 0, fail = 0;
const ok = (c, msg) => { c ? pass++ : (fail++, console.error(`  ✗ ${msg}`)); };
const sec = (t) => console.log(`\n=== ${t} ===`);
/** Strip trailing line comments (single-seam counting: names mentioned in comments do not count as implementations) */
const strip = (s) => s.split('\n').map((l) => l.replace(/\/\/.*$/, '')).join('\n');
const count = (s, re) => (strip(s).match(re) || []).length;
const near = (a, b, e = 1e-9) => Math.abs(a - b) <= e;

const G = readSrc('public', 'js', 'game.js');
const L = readSrc('tools', 'lanesim.mjs');
const DSRC = readSrc('public', 'js', 'data.js');

/** Breakage rules for reverse verification: MUST actually change something (a miss = the flag is a no-op, reverse verification falsely green) */
const bust = (src, re, to, tag) => {
  const next = src.replace(re, to);
  if (next === src) throw new Error(`反向驗證 ${tag}:原文沒有匹配到目標,改壞規則已失效`);
  return next;
};

// ---- Data / server layer: break flags travel via "broken copy re-imported" (same genuine source, one target line moved) ----
let d, S = readSrc('server', 'sim.js'), BattleSim;
{
  const dirty = BREAK_EQ || BREAK_ALPHA || BREAK_BRK || BREAK_STACK || BREAK_TEMPO;
  if (!dirty) {
    d = await import('../public/js/data.js');
    ({ BattleSim } = await import('../server/sim.js'));
  } else {
    const dir = mkdtempSync(join(tmpdir(), 'svs-selfult-'));
    let ds = DSRC;
    if (BREAK_EQ) {
      ds = bust(ds, /return specialBudget\(abil\) \* SELF_ATK\.REALIZED_F \* tierVal\(a\.cd, lvl\) \/ SPECIAL_CD_S;/,
        'return 250;', '--break-eq');
    }
    if (BREAK_ALPHA) {
      S = bust(S, /if \(A\.add\?\.fx === 'alpha' && once\) \{ h\.alphaX = B\.alphaX; h\.alphaArm = this\.t \+ A\.dur; \}/,
        "if (A.add?.fx === 'alpha' && once) { h.mods.push({ k: 'dmg', m: B.alphaX, until: this.t + SELF_ATK.ALPHA_S }); }",
        '--break-alpha');
    }
    if (BREAK_BRK) {
      S = bust(S, /\n      this\._breakOnHit\(t\);[^\n]*/, '', '--break-brk');
    }
    if (BREAK_STACK) {
      // Stacking degenerates to "every frame gets the whole share" ⇒ withdrawing and re-adding a share
      // stops working (= the equivalent symptom of per-frame multiplication: correct at full attendance,
      // still full rate one frame down)
      S = bust(S, /const mf = \(m\) => 1 \+ \(m - 1\) \* frac;[^\n]*/, 'const mf = (m) => m;', '--break-stack');
    }
    if (BREAK_TEMPO) {
      ds = bust(ds, /export const supportTempoF = \(tempo\) =>\n[^;]*;/,
        'export const supportTempoF = () => 1;', '--break-tempo');
    }
    // When sim.js is imported from the temp dir, `../public/js/data.js` must resolve to the broken copy
    // ⇒ mirror the directory layout alongside
    const pub = join(dir, 'public', 'js'), srv = join(dir, 'server');
    const { mkdirSync } = await import('node:fs');
    mkdirSync(pub, { recursive: true }); mkdirSync(srv, { recursive: true });
    writeFileSync(join(pub, 'data.js'), ds);
    for (const f of ['botPolicy.js', 'balancePrefs.js', 'rng.js', 'mapBuilding.js', 'pool.js']) {
      copyFileSync(join(process.cwd(), 'public', 'js', f), join(pub, f));
    }
    writeFileSync(join(srv, 'sim.js'), S);
    d = await import(pathToFileURL(join(pub, 'data.js')).href);
    ({ BattleSim } = await import(pathToFileURL(join(srv, 'sim.js')).href));
    process.on('exit', () => { try { rmSync(dir, { recursive: true, force: true }); } catch { /* failing to clean up never blocks verification */ } });
  }
}

const CHS = Object.keys(d.CHARACTERS);
const SELF = CHS.filter((c) => !d.atkDelivered(c));
const CONV = CHS.filter((c) => d.atkDelivered(c));
const AB = (l = 1, h = 1) => ({ light: l, heavy: h });

// ============================================================
sec('Ⅰ 當量推導(MUST NOT 手寫)');
{
  ok(SELF.length === 10, `純自身型 10 台(實得 ${SELF.length}:${SELF.join(' ')})`);
  ok(CONV.every((c) => d.selfAtkEq(c, 1, AB()) === 0),
    '載具化的 22 台當量恆 0(長按已經換成攻招,MUST NOT 重複補)');
  ok(SELF.every((c) => d.selfAtkEq(c, 1, AB()) > 0), '未載具化的 10 台當量全 > 0');

  // Each of the three inputs monotone: longer CD brings back more shares, bigger budget brings back more,
  // shorter chassis-ult CD demands more shares back
  const s04 = (lvl) => d.selfAtkEq('s04', lvl, AB());
  ok(d.selfAtkEq('s04', 1, AB(4, 4)) > d.selfAtkEq('s04', 1, AB(1, 1)),
    '當量隨武器綜合等級(= specialBudget)遞增');
  const cds = SELF.map((c) => [d.tierVal(d.CHARACTERS[c].atk.cd, 1), d.selfAtkEq(c, 1, AB())]);
  ok(cds.every(([cd, eq]) => near(eq, d.specialBudget(AB()) * d.SELF_ATK.REALIZED_F * cd / d.SPECIAL_CD_S)),
    '當量 = 預算 × 實得率 × (攻招 CD ÷ 機種絕招 CD)—— 逐台獨立重算比對');
  // The equivalent scales with **this move's own CD**: a faster-cycling attack ult needs fewer chassis-ult
  // shares per cast. s04's cd ladder is [70, 60, 50] (faster with upgrades) ⇒ the equivalent MUST shrink
  // along, never "upgrades mean more".
  ok(s04(3) < s04(1) && near(s04(3) / s04(1), d.tierVal(d.CHARACTERS.s04.atk.cd, 3) / d.tierVal(d.CHARACTERS.s04.atk.cd, 1)),
    '當量正比於攻招 CD(cd 階梯一改自己跟著走)');

  // Derived, never hand-written: no numeric literals allowed in the definition (constants always travel
  // SELF_ATK / SPECIAL_CD_S)
  const eqSrc = (strip(DSRC).match(/export const selfAtkEq = [\s\S]*?\n\};/) || [''])[0];
  ok(/specialBudget\(abil\)/.test(eqSrc) && /SELF_ATK\.REALIZED_F/.test(eqSrc)
    && /SPECIAL_CD_S/.test(eqSrc) && !/[^.\w]\d+(\.\d+)?\s*[*/]/.test(eqSrc),
    'selfAtkEq 由 specialBudget / REALIZED_F / SPECIAL_CD_S 推導,式子裡沒有手寫倍率');
  ok(/export const SPECIAL_CD_S = SQUAD\.KAMI\.CD_S;/.test(DSRC)
    && near(d.SPECIAL_CD_S, d.SQUAD.KAMI.CD_S) && near(d.SPECIAL_CD_S, d.DECOY.CD_S)
    && near(d.SPECIAL_CD_S, d.HYPER.CD_S),
    '機種絕招 CD 取自常數且三招同值(SPECIAL_CD_S 是唯一縫)');
}

// ============================================================
sec('Ⅱ 兌現形式與夾制(逐台;夾到上限 MUST 講出來)');
{
  // Neutral: carrier-migrated characters' three boost columns all neutral ⇒ _castEffect bit-identical for them
  ok(CONV.every((c) => {
    const B = d.selfAtkBoost(c, 1, AB());
    return B.dmgMul === 0 && B.heal === 0 && B.alphaX === 1;
  }), '載具化的 22 台 boost 恆中性(dmgMul 0 / heal 0 / alphaX 1)⇒ 效果結算逐位元不受影響');
  ok(d.selfAtkBoost('__nope__', 1, AB()).alphaX === 1, '未知角色回中性值(不炸)');

  // Per-fx dispatch: heal → heal column, stealth → alphaX, buff+mul.dmg → dmgMul, the three redesigned
  // chassis → all neutral
  const byFx = (c) => d.CHARACTERS[c].atk.fx;
  for (const c of SELF) {
    const B = d.selfAtkBoost(c, 1, AB()), fx = byFx(c);
    const u = d.CHARACTERS[c].atk;
    const want = fx === 'heal' ? (B.heal > 0 && B.dmgMul === 0 && B.alphaX === 1)
      : fx === 'stealth' ? (B.alphaX > 1 && B.heal === 0 && B.dmgMul === 0)
        : (fx === 'buff' && u.mul?.dmg) ? (B.dmgMul > 0 && B.heal === 0 && B.alphaX === 1)
          : (B.dmgMul === 0 && B.heal === 0 && B.alphaX === 1);
    ok(want, `${c}(${fx})的補償走對通道`);
  }
  // The three redesigned chassis: the effect IS the compensation, MUST NOT stack another multiplier
  // (otherwise one budget claimed twice)
  for (const c of ['s12', 't02', 'm04']) {
    const B = d.selfAtkBoost(c, 1, AB());
    ok(B.dmgMul === 0 && B.heal === 0 && B.alphaX === 1,
      `${c}(重新設計)不再另加乘數 —— 效果本身就是補償`);
  }
  // Heal type: increment = the equivalent itself (healing X = negating X damage, equivalence derivable)
  ok(near(d.selfAtkBoost('s11', 1, AB()).heal, d.selfAtkEq('s11', 1, AB())),
    's11 治療增額 = 當量本身(1:1 等價)');

  // Clamps: both caps hold, and **every chassis pinned at a cap is named** (silent truncation = the
  // "derived" claim stops holding)
  const capped = { dmg: [], alpha: [] };
  for (const c of SELF) for (const lvl of [1, 2, 3]) {
    const B = d.selfAtkBoost(c, lvl, AB());
    ok(B.dmgMul <= d.SELF_ATK.MUL_MAX + 1e-9 && B.alphaX <= d.SELF_ATK.ALPHA_MAX + 1e-9,
      `${c} Lv${lvl} 夾在上限內`);
    if (lvl === 1 && near(B.dmgMul, d.SELF_ATK.MUL_MAX)) capped.dmg.push(c);
    if (lvl === 1 && near(B.alphaX, d.SELF_ATK.ALPHA_MAX)) capped.alpha.push(c);
  }
  console.log(`   ⓘ Lv1 頂到夾制上限:mul.dmg ${capped.dmg.join('/') || '無'}`
    + ` / alphaX ${capped.alpha.join('/') || '無'} —— 這幾台的補償**不是**完整推導值,是被上限截斷後的值`);
  // Clamps genuinely working (not just never exceeded): live characters already pin at caps.
  // **A feature and a warning**: pinned chassis no longer hold complete derived values ⇒ REALIZED_F
  // retunes leave them untouched; only MUL_MAX / ALPHA_MAX or the payout form itself moves them.
  ok(capped.dmg.length > 0, `MUL_MAX 對現役角色是**生效中**的夾制(${capped.dmg.join('/')})`);
  ok(capped.alpha.length > 0, `ALPHA_MAX 對現役角色是**生效中**的夾制(${capped.alpha.join('/')})`);
  // Budget blown up (light tier raised ⇒ budget up but heavy DPS flat) always clamps
  ok(near(d.selfAtkBoost('t06', 1, AB(9, 1)).dmgMul, d.SELF_ATK.MUL_MAX),
    '預算灌爆時 dmgMul 夾在 MUL_MAX');
  // DPS takes the heavy weapon (low light DPS would push the whole multiplier batch into the clamp cap)
  ok(/heroWeapon\(ch, 'heavy'/.test(strip(DSRC).match(/export const selfAtkDps[\s\S]*?\n\};/)[0]),
    'selfAtkDps 取**重武器**持續 DPS(攻招開窗那幾秒玩家打的就是它)');
  ok(/weaponDps\(w\)/.test(DSRC), '持續 DPS 走 weaponDps 單一縫(MUST NOT 手抄彈匣週期)');
}

// ============================================================
sec('Ⅲ 單一縫(原文)');
{
  // Multiplier/heal increments taken exactly once, in _castEffect
  ok(count(S, /selfAtkBoost\(/g) === 1, `sim 只在一處取 boost(實得 ${count(S, /selfAtkBoost\(/g)})`);
  const ce = grabMethod(S, '_castEffect');
  ok(/selfAtkBoost\(h\.ch, h\.abil\?\.atk \|\| 1, h\.abil\)/.test(ce) && /A\.id === 'atk'/.test(ce),
    '_castEffect 是唯一取用點,而且只給攻招(守招不吃補償)');
  ok(!/selfAtkBoost|selfAtkEq/.test(strip(G)),
    '客戶端 MUST NOT 自己算一份補償(算出兩個數字 = 「HUD 說 ×2.3、實際掉血 ×1.35」)');
  ok(count(L, /selfAtkBoost\(/g) === 1,
    '前線交戰模型也只取一次(bal 說平衡、打起來不是 ⇐ 模型自己算一份)');
  // Increment semantics: added, never multiplied
  ok(/const mm = k === 'dmg' \? m \+ B\.dmgMul : m;/.test(strip(ce)),
    '補償是**增額**(1.35 + 1.00 = 2.35),MUST NOT 再乘一層');
  ok(/const healAmt = A\.heal \+ B\.heal;/.test(strip(ce)), '治療同樣是增額');

  // Stealth burst window: _castEffect only arms; the window opens on _gateFire's "firing reveals" line
  ok(/h\.alphaX = B\.alphaX; h\.alphaArm = this\.t \+ A\.dur;/.test(strip(ce)),
    '_castEffect 對 alpha 只**上膛**(alphaArm),不開窗');
  const gf = strip(grabMethod(S, '_gateFire'));
  ok(/h\.mods\.push\(\{ k: 'dmg', m: h\.alphaX \|\| 1, until: now \+ SELF_ATK\.ALPHA_S \}\);/.test(gf)
    && gf.indexOf('alphaArm') < gf.indexOf("h.stealthUntil = 0"),
    '窗開在 _gateFire 的開火現形那一刻,且排在 `stealthUntil = 0` **之前**');
  ok(count(S, /SELF_ATK\.ALPHA_S/g) === 1, '爆發窗長度只有一個消費端');

  // No-reload: the refill MUST precede "empty → reload starts"
  ok(/if \(h\.ammo\[id\] <= 0 && \(h\.noReloadUntil \|\| 0\) > now\) h\.ammo\[id\] = def\.mag;/.test(gf),
    '_gateFire:免裝填時窗內見底就地補滿');
  ok(gf.indexOf('noReloadUntil') < gf.indexOf('reloadUntil[id] = now - back'),
    '補滿排在「推進填彈計時器」之前(排後面 = 免裝填等於沒有)');
  // Squad-shared: one magazine only; per-chassis noReload windows/stealth arms would split the main-view
  // chassis from wingmen
  for (const k of ['noReloadUntil', 'alphaArm', 'alphaX']) {
    ok(new RegExp(`'${k}'`).test(S.slice(0, S.indexOf('// ---- tick 內加速結構'))),
      `${k} 進 SQUAD_SHARED(小隊共用,MUST NOT 逐機體各記一份)`);
  }
  // brk: the verdict lives only in _damage's hero branch (spread out = "some damage sources never break")
  ok(count(S, /_breakOnHit\(/g) === 2, `_breakOnHit:1 定義 + 1 呼叫(實得 ${count(S, /_breakOnHit\(/g)})`);
  ok(/this\._breakOnHit\(t\);/.test(strip(grabMethod(S, '_damage'))), '_damage 的英雄分支呼叫 _breakOnHit');
  // heroAbility's four new columns
  for (const k of ['regen', 'cleanse', 'revive', 'brk']) {
    ok(new RegExp(`${k}:`).test(strip(DSRC).match(/export function heroAbility[\s\S]*?\n\}/)[0]),
      `heroAbility 解析 ${k} 欄位`);
  }
  // CC immunity: all three application paths must check (one missed = that CC flavor still lands)
  ok(count(S, /_buffVal\((e|t), 'ccImm'\) > 0/g) >= 3,
    `ccImm 在三條施加路徑都判(_applyHitEmp / emp 分支 / _applyCC;實得 ${count(S, /'ccImm'\) > 0/g)})`);
}

// ============================================================
sec('Ⅳ 行為直測(真 BattleSim)');
{
  const mkCfg = () => {
    const A = [25.0330, 121.5654];
    const D = 1600, R = 6371000;
    const realD = D * d.MAPGEO.REAL_SCALE;
    const B2 = [A[0] + realD / R * 180 / Math.PI, A[1]];
    const mid = [(A[0] + B2[0]) / 2, (A[1] + B2[1]) / 2];
    const pts = [];
    for (let t = 0; t <= 1.001; t += 0.05) pts.push([A[0] + (B2[0] - A[0]) * t, A[1]]);
    const sizeM = D / (0.85 * Math.SQRT2);
    return {
      center: { lat: mid[0], lng: mid[1] }, bases: { SWARM: A, STEEL: B2 }, lanes: [pts],
      sizeM, diagM: sizeM * Math.SQRT2, distM: D, geoScaleVer: d.MAPGEO.GEO_SCALE_VER,
      maxOverlap: 0.05, synthetic: true, placeName: '稽核戰區',
      env: { season: 'summer', time: 'day', weather: 'clear' },
    };
  };
  // Casters stand off-lane: since 2026-08-07 the fleet ticks to station, so on-lane measurements read
  // "can creeps hit the escorts" instead of the move itself (and t02's brk would be tripped early by
  // passing creeps).
  const hero = (sim, side, pid, ch) => {
    for (const [id, e] of sim.ents) if (!e.hero && e.kind !== 'base' && e.kind !== 'tower') sim.ents.delete(id);
    sim.nextWaveAt = 1e9;
    const h = sim.addHero(side, pid, ch);
    h.x = 400; h.z = 0; h.mp = 999; h.abil.atk = 1;
    return h;
  };
// Since 2026-08-07 self-buff attack ults no longer go off instantly — the delivery leg flies first, then
// supply ⇒ behavior tests MUST push to station. Since round two (attack ults summoned from the nearest
// tower/base), the leg is a **real distance**, never a fixed count ⇒ MUST NOT use fixed
// "supportLegS / dt"-style frame counts (flight time grows with fort-to-caster distance; fixed counts false-red
// when the caster pushes forward). Kami TTL caps the top as insurance — only truly unreachable flights land
// there.
  const DEPLOY_N = Math.ceil(d.SQUAD.KAMI.TTL_S / 0.125) + 4;
  const armed = (sim) => [...sim.ents.values()].some((e) => e.supG && e.phase === 'escort');
  const deploy = (sim, until = null) => {
    const done = until || (() => armed(sim) || ![...sim.ents.values()].some((e) => e.supG));
    for (let i = 0; i < DEPLOY_N && !done(); i++) sim.tick(0.125);
  };
  /** Support craft currently airborne */
  const craftOf = (sim, pid) => [...sim.ents.values()].filter((e) => e.supG && e.pid === pid);

  // 1 rally (s12): whole-team regen boost + cleanse and CC immunity + on-the-spot half-HP revive for
  // teammates counting down
  {
    const sim = new BattleSim(mkCfg());
    const h = hero(sim, 'SWARM', 'a1', 's12');
    const mate = hero(sim, 'SWARM', 'a2', 's11');
    mate.x = 300; mate.z = 40;                       // far from the caster — rally deliberately ignores radius (whole team)
    mate.stunUntil = sim.t + 5; mate.empUntil = sim.t + 5;
    const body = sim._bodies(mate)[0];
    body.dead = true; body.respawnAt = sim.t + 12; body.hp = 0; body.sp = 0;
    const A = d.heroAbility('s12', 'atk', 1);
    sim.heroCast('a1', 'atk');
    deploy(sim);
    ok(!body.dead && body.respawnAt === 0, 'rally:重生倒數中的隊友原地站起來');
    // Standing up at half HP the moment of station; regen tops up after ⇒ lower-bound comparison (the upper
    // bound blocks "revive at full")
    ok(body.hp >= Math.max(1, Math.round(body.maxHp * A.revive)) - 1 && body.hp < body.maxHp * (A.revive + 0.25),
      `rally:回場半血(${body.hp.toFixed(0)}/${body.maxHp})`);
    ok(body.invUntil > sim.t, 'rally:復活後有無敵幀(站起來那一瞬不該被同一發爆風再收一次)');
    ok(mate.stunUntil === 0 && mate.empUntil === 0, 'rally:既有異常被解除');
    ok(sim._buffVal(mate, 'ccImm') > 0 && sim._buffMul(mate, 'regen') > 1,
      'rally:期間免疫異常 + 恢復速度倍率(全隊,不吃半徑)');
    // Immunity genuinely blocks: one more EMP MUST fizzle
    sim._applyHitEmp(h, { emp: 3 }, mate);
    ok(!(mate.empUntil > sim.t), 'rally:免疫期間再施加 EMP 無效');
    // Teammates already back on their own do not count (only the counting-down)
    const sim2 = new BattleSim(mkCfg());
    hero(sim2, 'SWARM', 'b1', 's12');
    const m2 = hero(sim2, 'SWARM', 'b2', 's11');
    const b2 = sim2._bodies(m2)[0];
    b2.dead = true; b2.respawnAt = 0;                // not counting down
    sim2.heroCast('b1', 'atk');
    // Since 2026-08-07 pushing to station takes ticks, while the normal respawn flow releases bodies when
    // respawnAt expires anyway ⇒ the verdict watches "was a revive event emitted" (legacy `b2.dead` gets
    // washed into false-red by normal respawns)
    let revived = false;
    for (let i = 0; i < DEPLOY_N && !armed(sim2); i++) {
      sim2.tick(0.125);
      revived ||= sim2.events.some((e) => e.e === 'respawn' && e.revive);
    }
    ok(!revived, 'rally:**不在重生倒數中**的隊友不復活(使用者定案的限制)');
  }

  // 2 overdrive (t02): full magazines + no-reload + evasion; one hit taken ends it
  {
    const sim = new BattleSim(mkCfg());
    const h = hero(sim, 'STEEL', 'a3', 't02');
    const wl = d.heroWeapon('t02', 'light', 1);
    h.ammo.light = 0; h.reloadUntil.light = sim.t + 99;
    sim.heroCast('a3', 'atk');
    deploy(sim);
    ok(h.noReloadUntil > sim.t && !(h.reloadUntil.light > sim.t),
      'overdrive:彈藥/填彈帳清空 + 開啟免裝填時窗');
    ok(sim._buffVal(h, 'evade') > 0, 'overdrive:閃避率加成');
    ok(sim._buffMul(h, 'dmgTaken') < 1, 'overdrive:減傷仍在(mul.dmgTaken)');
    // Sustained fire inside the window: burning through several magazines MUST NOT enter reload (the
    // round cap is window length × rate, not magazine size)
    const end = h.noReloadUntil - 0.05;
    let shots = 0, blocked = 0;
    while (sim.t < end) {
      sim.t += 1 / wl.rate + 1e-6;
      if (sim.t >= end) break;
      if (sim._gateFire(h, 'light', wl)) shots++; else blocked++;
    }
    ok(shots > wl.mag && blocked === 0 && !(h.reloadUntil.light > sim.t),
      `overdrive:時窗內連打 ${shots} 發(> 彈匣 ${wl.mag})一次都沒進填彈,擋下 ${blocked} 發`);
    // One hit ends it — MUST verify in a **fresh match**: the loop above already pushed the clock to the
    // window's tail, so asking "is the window still open" there is always no, and removing `_breakOnHit`
    // would still pass (false green).
    {
      const s3 = new BattleSim(mkCfg());
      const h3 = hero(s3, 'STEEL', 'a9', 't02');
      s3.heroCast('a9', 'atk');
      deploy(s3);
      const dur = h3.noReloadUntil - s3.t;
      s3.t += dur / 2;                                 // mid-window, half remaining to close
      ok(h3.noReloadUntil > s3.t && s3._buffVal(h3, 'evade') > 0, 'overdrive:時窗中段仍生效(對照)');
      s3._damage(h3, 5, null, 0);
      ok(!(h3.noReloadUntil > s3.t) && !(s3._buffVal(h3, 'evade') > 0),
        'overdrive:挨一發即撤銷(免裝填 + 那一批 mods 一起收)');
    }
    // Control: moves without brk are never broken by one hit
    const sim2 = new BattleSim(mkCfg());
    const h2 = hero(sim2, 'SWARM', 'a4', 's04');
    sim2.heroCast('a4', 'atk');
    deploy(sim2);
    const before = sim2._buffMul(h2, 'dmg');
    sim2._damage(h2, 5, null, 0);
    ok(before > 1 && near(sim2._buffMul(h2, 'dmg'), before),
      's04(無 brk)挨打不受影響 —— `brk` 只作用在標了旗標的招式上');
  }

  // 3 recon (m04): range bonus travels the _altRange seam (every range gate consumes it)
  {
    const sim = new BattleSim(mkCfg());
    const h = hero(sim, 'SWARM', 'a5', 'm04');
    const dum = sim._add({ kind: 'bunker', side: 'STEEL', x: 200, z: 0, y: 0, hp: 4000 }); delete dum.lane;
    const before = sim._altRange(h, dum);
    sim.heroCast('a5', 'atk');
    deploy(sim);
    const after = sim._altRange(h, dum);
    const A = d.heroAbility('m04', 'atk', 1);
    ok(near(after / before, A.mul.range, 1e-9), `recon:有效射程 ×${A.mul.range}(${before.toFixed(2)} → ${after.toFixed(2)})`);
    ok(sim._buffMul(h, 'speed') > 1 && sim._buffVal(h, 'evade') > 0, 'recon:跑速與閃避同步拉高');
    ok(sim.visionUntil[h.side] > sim.t, 'recon:全隊無霧視野');
    ok(count(S, /this\._buffMul\(shooter, 'range'\)/g) === 1,
      '射程加成只有 _altRange 一個消費端(散到各閘門去乘 = 有些路徑吃不到)');
  }

  // 4 alpha (m08): the window opens only at the **firing-reveal instant**
  {
    const sim = new BattleSim(mkCfg());
    // Sides use only the two zones that really hold a base (mercenary chassis mount the same — the move,
    // not the faction, is under test)
    const h = hero(sim, 'STEEL', 'a6', 'm08');
    if (!h) { ok(false, 'm08 掛不上戰區'); }
    else {
      const A = d.heroAbility('m08', 'atk', 1);
      const B = d.selfAtkBoost('m08', 1, h.abil);
      sim.heroCast('a6', 'atk');
      deploy(sim);
      ok(h.stealthUntil > sim.t && h.alphaArm > sim.t, 'alpha:施放後匿蹤 + 上膛');
      ok(near(sim._buffMul(h, 'dmg'), 1), 'alpha:**還沒開火 ⇒ 窗還沒開**(躲著不打不會燒掉那一秒)');
      const wl = d.heroWeapon('m08', 'light', 1);
      sim.t += 3;                                      // waited 3 seconds under stealth
      ok(near(sim._buffMul(h, 'dmg'), 1), 'alpha:等了 3 秒窗仍未開');
      sim._gateFire(h, 'light', wl);                   // firing = revealing
      ok(near(sim._buffMul(h, 'dmg'), B.alphaX, 1e-9), `alpha:開火那一刻開窗(×${B.alphaX.toFixed(2)})`);
      ok(h.stealthUntil === 0 && h.alphaArm === 0, 'alpha:現形 + 卸膛(同一次匿蹤只換一個窗)');
      sim.t += d.SELF_ATK.ALPHA_S + 0.01;
      ok(near(sim._buffMul(h, 'dmg'), 1), `alpha:${d.SELF_ATK.ALPHA_S}s 後窗關閉`);
    }
  }

  // 5 Unmigrated characters' compensation really settles (s11 heal = base + increment); migrated
  // characters bit-identical
  {
    const sim = new BattleSim(mkCfg());
    const h = hero(sim, 'SWARM', 'a7', 's11');
    h.hp = 1;
    // Both heal-measuring phases MUST isolate from battlefield fire: `deploy()` genuinely ticks, creep waves
    // still spawn, rocketeers still shoot. Since 2026-08-11 NPC shoulder rockets genuinely explode (the
    // per-target evasion-roll build) ⇒ a 1-HP test chassis catches passing splash and the section turns into
    // dice (measured 2 red in 8 runs). Invulnerability frames are the existing isolation; tested logic untouched.
    h.invUntil = sim.t + 1e6;
    h.lastHitAt = sim.t + 1e6;
    const A = d.heroAbility('s11', 'atk', 1);
    const B = d.selfAtkBoost('s11', 1, h.abil);
    sim.heroCast('a7', 'atk');
    // Instant type: four frames each deliver 1/4 ⇒ wait for the whole team (stopping at the first arrival
    // measures only a quarter share)
    deploy(sim, () => ![...sim.ents.values()].some((e) => e.supG));
    ok(B.heal > 0 && near(h.hp, Math.min(h.maxHp, 1 + A.heal + B.heal), 0.01),
      `s11 治療 = 基礎 ${A.heal} + 補償 ${B.heal.toFixed(0)}`);
    const sim2 = new BattleSim(mkCfg());
    const h2 = hero(sim2, 'SWARM', 'a8', 's02');       // carrier-migrated (team heal)
    h2.hp = 1;
    sim2.heroCast('a8', 'atk');
    ok(near(h2.hp, 1), '載具化角色:效果由載具抵達時才施放,施放當下不回血(逐位元同載具改制)');
  }
}

// ============================================================
sec('Ⅴ 跟隨玩家的輔助機隊(2026-08-07 使用者定案)');
{
  // ---- V-a Classification and frame counts: derived, never hand-written ----
  const TEMPOS = SELF.map((c) => d.selfAtkTempo(c));
  ok(TEMPOS.every((t) => t === 'burst' || t === 'pulse' || t === 'sustain'),
    `10 台各有節奏分類(${SELF.map((c, i) => `${c}:${TEMPOS[i]}`).join(' ')})`);
  ok(CONV.every((c) => d.selfAtkTempo(c) === null && d.supportN(c) === 1),
    '載具化的 22 台不歸這一段管(tempo 回 null)');
  ok(new Set(TEMPOS).size === 3, '三種節奏在現役角色上都有人(分類不是死碼)');
  // Classification **derives from ult columns**: no dur ⇒ instant, regen present ⇒ intermittent, else
  // sustained (recomputed independently per chassis)
  ok(SELF.every((c) => {
    const u = d.CHARACTERS[c].atk;
    const want = !(d.tierVal(u.dur ?? 0, 1) > 0) ? 'burst'
      : d.tierVal(u.regen ?? 0, 1) > 0 ? 'pulse' : 'sustain';
    return d.selfAtkTempo(c) === want;
  }), '節奏由 ult 欄位推導(逐台獨立重算比對)');
  ok(!/selfAtkTempo[\s\S]{0,400}?['"]s\d\d['"]/.test(strip(DSRC)),
    '節奏分類 MUST NOT 手寫角色名冊');
  // Frame counts: stackables batch by chassis (same table as atkParts), binary states always solo — the
  // user's "**some** moves become several"
  ok(SELF.every((c) => d.supportN(c) === (d.supportStackable(c) ? d.kindParts(d.charKind(c)) : 1)),
    '機數 = 可疊加 ? 該機種分批數 : 1(與 atkParts 同一張機種表)');
  ok(SELF.some((c) => d.supportN(c) > 1) && SELF.some((c) => d.supportN(c) === 1),
    `「某些」招式換成多架:多機 ${SELF.filter((c) => d.supportN(c) > 1).join('/')}`
    + ` / 單機 ${SELF.filter((c) => d.supportN(c) === 1).join('/')}`);
  ok(!d.supportStackable('m08') && d.supportN('m08') === 1,
    'm08(純二元狀態:匿蹤)不可疊加 ⇒ 單機(「一半的隱形」沒有意義)');
  ok(d.kindParts('drone') === d.SQUAD.KAMI.N && d.kindParts('morph') === d.DECOY.BOMB_MAX
    && d.kindParts('robot') === 1
    && count(DSRC, /kind === 'drone' \? SQUAD\.KAMI\.N/g) === 1,
    'kindParts 是機種分批數的唯一縫(atkParts 與 supportN 同吃)');

  // ---- V-b Stacking is additive (core invariant: full attendance = bit-identical to legacy) ----
  for (const c of SELF) {
    const n = d.supportN(c);
    ok(near(d.supportF(c, n), 1) && near(d.supportF(c, 0), 0),
      `${c}:${n} 架全在線 ⇒ 份額 1(= 舊制效果值)、全滅 ⇒ 0`);
    ok(Array.from({ length: n + 1 }, (_, k) => d.supportF(c, k))
      .every((v, k, a) => k === 0 || v > a[k - 1] - 1e-12), `${c}:份額隨在線架數單調`);
  }
  ok(near(d.supportF('s04', 2), 0.5), 's04 擊落一半 ⇒ 份額 0.5(線性,不是指數)');
  ok(d.supportF('s04', 99) === 1 && d.supportF('s04', -3) === 0, '份額夾在 [0, 1]');

  // ---- V-c Toughness: the user's two clauses (item 3) ----
  // Service window: same dur ranks sustain > pulse > burst; and strictly increasing in dur (dur = 0 instant
  // excepted)
  const F = d.supportTempoF;
  ok(F('sustain') === 1 && F('burst') === 0 && F('pulse') === d.ATK_SUPPORT.PULSE_F,
    '節奏係數:兩端是定義(0 / 1)、中間是旋鈕 PULSE_F');
  ok(F('sustain') > F('pulse') && F('pulse') > F('burst'),
    `持續 > 間斷 > 瞬發(${F('sustain')} > ${F('pulse')} > ${F('burst')})`);
  ok(d.ATK_SUPPORT.PULSE_F > 0 && d.ATK_SUPPORT.PULSE_F < 1,
    'PULSE_F ∈ (0, 1):撐一半仍有交付,但不是撐滿');
  // Sweeping dur on one chassis: fleet toughness strictly increasing in dur ("longer duration, tougher fleet")
  {
    const durs = [1, 4, 8, 12, 20];
    // Per frame: delivery legs in parallel (never divided by frame count), effect windows in series
    // (divided by frame count) — same formula as supportHp
    const hpAt = (tempo, dur, n = 4) => d.frontKillHp(d.supportLegS('atk') + F(tempo) * dur / n) * n;
    for (const tempo of ['sustain', 'pulse']) {
      const seq = durs.map((x) => hpAt(tempo, x));
      ok(seq.every((v, i) => i === 0 || v > seq[i - 1]), `${tempo}:dur 越久機隊越硬(${seq.join(' < ')})`);
    }
    for (const dur of durs) {
      ok(hpAt('sustain', dur) > hpAt('pulse', dur) && hpAt('pulse', dur) > hpAt('burst', dur),
        `dur ${dur}s:持續 ${hpAt('sustain', dur)} > 間斷 ${hpAt('pulse', dur)} > 瞬發 ${hpAt('burst', dur)}`);
    }
  }
  // Live 10 chassis: fleet toughness ≈ frontDps × service window (frame-count independent), each > 0;
  // armor/shields 0 guaranteed at spawn
  for (const c of SELF) {
    const n = d.supportN(c), tempo = d.selfAtkTempo(c);
    const dur = d.tierVal(d.CHARACTERS[c].atk.dur ?? 0, 1);
    const want = d.frontKillHp(d.supportLegS('atk') + F(tempo) * dur / n);
    ok(d.supportHp(c, 1) === want && want > 0,
      `${c}:每架 ${want} = 前線塔位 ${d.frontDps()} DPS ×(投放腿 + ${tempo} 窗 ÷ ${n})`);
    ok(d.supportFleetHp(c, 1) === want * n, `${c}:機隊總耐久 = 每架 × ${n}`);
    ok(d.supportHp(c, 3) >= d.supportHp(c, 1), `${c}:升級不會讓輔助機變脆`);
  }
  // Delivery legs are **parallel** exposure: MUST NOT divide them by frame count too (dividing leaves
  // s11 with one bullet's worth per frame)
  ok(d.supportHp('s11', 1) > d.frontKillHp(d.supportLegS('atk') / d.supportN('s11')) * 2,
    `瞬發型每架 ${d.supportHp('s11', 1)} 點 ≫ 「整段除以機數」的 ${d.frontKillHp(d.supportLegS('atk') / d.supportN('s11'))} 點`);
  // Derived, never hand-written: the HP formula composes only frontKillHp / service window / frame count
  {
    const hpSrc = (strip(DSRC).match(/export const supportHp = [\s\S]*?\n\};/) || [''])[0];
    ok(/frontKillHp\(/.test(hpSrc) && /supportLegS\(slot\)/.test(hpSrc) && /supportTempoF\(/.test(hpSrc)
      && /\/ n/.test(hpSrc) && !/\d{2,}/.test(hpSrc),
      'supportHp = frontKillHp(投放腿 + 節奏係數 × dur ÷ 機數)(式子裡沒有手寫血量)');
    const svcSrc = (strip(DSRC).match(/export const supportServiceS = [\s\S]*?\n\};/) || [''])[0];
    ok(/supportLegS\(slot\)/.test(svcSrc) && /supportTempoF\(/.test(svcSrc) && !/\d\s*[*/+-]/.test(svcSrc),
      '服務窗 = 投放腿 + 節奏係數 × dur(沒有手寫秒數)');
    // The delivery leg has only abilLaunchLegM's single split (guard MIN_LEG / attack atkLaunchLegM);
    // MUST NOT write a second slot check inside supportLegS (two splits sooner diverge to one edited)
    ok(count(DSRC, /abilLaunchLegM\(slot\) \/ supportSpeed\(\)/g) === 1
      && count(DSRC, /export const abilLaunchLegM/g) === 1,
      '投放腿逐槽位只有 abilLaunchLegM 一份分流(守招 MIN_LEG / 攻招 代表發射腿)');
  }
  // Tower retunes drift toughness along (same yardstick as the three point-delivery vehicles)
  ok(/frontKillHp/.test(strip(DSRC).match(/export const supportHp[\s\S]*?\n\};/)[0])
    && /export const frontKillHp = \(sec\) => towerKillHp\(sec \* TOWER_SITE_N\);/.test(DSRC),
    '耐久與 kami/decoy/hyper 共用「前線一組塔位」那一把尺');

  // ---- V-d Single seam (source) ----
  ok(count(S, /_launchAtkSupport\(/g) === 2,
    `_launchAtkSupport:1 定義 + 1 呼叫(實得 ${count(S, /_launchAtkSupport\(/g)})`);
  ok(count(S, /supportHp\(/g) === 1, '輔助機 HP 只在生成處取一次(MUST NOT 在別處另算)');
  ok(count(S, /_supSync\(/g) === 3,
    `_supSync:1 定義 + 2 呼叫(就位 / 下線 —— 疊加只有這一條路;實得 ${count(S, /_supSync\(/g)})`);
  ok(!/supportHp|supportN|ATK_SUPPORT/.test(strip(G)),
    '客戶端 MUST NOT 自己算輔助機的耐久/機數(A1:那是伺服器結算的量)');
  {
    const sy = strip(grabMethod(S, '_supSync'));
    ok(/m\.sup !== g\.id/.test(sy) || /\.sup === g\.id/.test(sy),
      '_supSync 先撤下這一組的舊 mods(疊加 = 撤下再放,不是逐架各推一筆)');
    ok(/a\.mods\[j\]\.until = g\.until;/.test(sy),
      '重放的 mods 一律改寫成群組 until(不改 = 每死一架就展期一次)');
    ok(/g\.live <= 0/.test(sy) && /_supRevoke\(/.test(sy),
      '一架都不剩 ⇒ 只撤不放,並撤掉不住在 mods 的二元狀態');
    const ts = strip(grabMethod(S, '_tickSupport'));
    ok(ts.indexOf("k.phase === 'deploy'") < ts.indexOf('this.t >= (k.supG?.until'),
      '投放腿的推進排在到期判定**之前**(排反了 ⇒ 瞬發型永遠交付不到)');
    // Round two 2026-08-07: the effect window MUST count from **station** — fixing it at cast time means a
    // fort farther from the caster expires it mid-flight = the move never delivers on deep pushes (the same
    // pit a second time, equally error-silent)
    ok(/until: null,/.test(strip(grabMethod(S, '_launchAtkSupport')))
      && /g\.until \?\?= this\.t \+ \(g\.A\.dur \|\| 0\);/.test(strip(grabMethod(S, '_supArm'))),
      '效果窗自第一架就位起算(施放當下 until = null;MUST NOT 用「施放 + 代表腿」定死)');
  }
  {
    const ce = strip(grabMethod(S, '_castEffect'));
    ok(/const mf = \(m\) => 1 \+ \(m - 1\) \* frac;/.test(ce) && /const vf = \(v\) => v \* frac;/.test(ce),
      '份額只有 mf/vf 兩支(乘數型加法疊加 / 數值型按份)');
    for (const g of ['A.revive > 0 && once', 'A.vision && once', 'if (once) h.stealthUntil']) {
      ok(ce.includes(g), `一次性效果掛上 once 守衛(${g})`);
    }
  }

  // ---- V-e Behavior tests (genuine BattleSim) ----
  {
    const mkCfg = () => {
      const A = [25.0330, 121.5654];
      const D2 = 1600, R = 6371000;
      const realD = D2 * d.MAPGEO.REAL_SCALE;
      const B2 = [A[0] + realD / R * 180 / Math.PI, A[1]];
      const mid = [(A[0] + B2[0]) / 2, (A[1] + B2[1]) / 2];
      const pts = [];
      for (let t = 0; t <= 1.001; t += 0.05) pts.push([A[0] + (B2[0] - A[0]) * t, A[1]]);
      const sizeM = D2 / (0.85 * Math.SQRT2);
      return {
        center: { lat: mid[0], lng: mid[1] }, bases: { SWARM: A, STEEL: B2 }, lanes: [pts],
        sizeM, diagM: sizeM * Math.SQRT2, distM: D2, geoScaleVer: d.MAPGEO.GEO_SCALE_VER,
        maxOverlap: 0.05, synthetic: true, placeName: '稽核戰區',
        env: { season: 'summer', time: 'day', weather: 'clear' },
      };
    };
    // The delivery leg is a real distance (attack ults summon from the nearest fort) ⇒ wait for "someone
    // stationed", never a fixed frame count
    const DEPLOY_N = Math.ceil(d.SQUAD.KAMI.TTL_S / 0.125) + 4;
    const armed = (sim) => [...sim.ents.values()].some((e) => e.supG && e.phase === 'escort');
    const deploy = (sim, until = null) => {
      const done = until || (() => armed(sim) || ![...sim.ents.values()].some((e) => e.supG));
      for (let i = 0; i < DEPLOY_N && !done(); i++) sim.tick(0.125);
    };
    const mk = (side, pid, ch) => {
      const sim = new BattleSim(mkCfg());
      for (const [id, e] of sim.ents) if (!e.hero && e.kind !== 'base' && e.kind !== 'tower') sim.ents.delete(id);
      sim.nextWaveAt = 1e9;
      const h = sim.addHero(side, pid, ch);
      h.x = 400; h.z = 0; h.mp = 999; h.abil.atk = 1;   // off-lane (same rationale as IV)
      return { sim, h };
    };
    const fleet = (sim, pid) => [...sim.ents.values()].filter((e) => e.supG && e.pid === pid);
    const run = (sim, n) => { for (let i = 0; i < n; i++) sim.tick(0.125); };

    // 1 Spawn: frame count / HP / armor·shields 0 / not yet stationed ⇒ bonus not yet live
    {
      const { sim, h } = mk('SWARM', 'v1', 's04');
      sim.heroCast('v1', 'atk');
      const cs = fleet(sim, 'v1');
      ok(cs.length === d.supportN('s04'), `s04 派出 ${cs.length} 架(推導 ${d.supportN('s04')})`);
      ok(cs.every((k) => k.hp === d.supportHp('s04', 1) && k.armor === 0 && k.maxSp === 0),
        `每架 HP ${d.supportHp('s04', 1)}、armor / 護盾恆 0(校準不隨主機漂移)`);
      ok(near(sim._buffMul(h, 'dmg'), 1), '投放腿飛行中 ⇒ 加成還沒上線(每一發都有攔截窗)');
      deploy(sim);
      const full = d.heroAbility('s04', 'atk', 1).mul.dmg + d.selfAtkBoost('s04', 1, h.abil).dmgMul;
      ok(near(sim._buffMul(h, 'dmg'), full, 1e-6),
        `全員就位 ⇒ 效果值**逐位元同舊制**(×${full.toFixed(3)})`);
      // 2 Stacking: half shot down ⇒ half the bonus remains (additive, never multiplicative)
      const alive = fleet(sim, 'v1');
      alive[0].hp = 0; sim._kill(alive[0], null);
      alive[1].hp = 0; sim._kill(alive[1], null);
      ok(near(sim._buffMul(h, 'dmg'), 1 + (full - 1) * 0.5, 1e-6),
        `擊落 2/4 ⇒ ×${(1 + (full - 1) * 0.5).toFixed(3)}(加法疊加;相乘會得到 ${((1 + (full - 1) / 4) ** 2).toFixed(3)})`);
      for (const k of fleet(sim, 'v1')) { k.hp = 0; sim._kill(k, null); }
      ok(near(sim._buffMul(h, 'dmg'), 1), '機隊全滅 ⇒ 加成整份下線');
      ok(fleet(sim, 'v1').length === 0, '全滅後場上不留殘骸實體');
    }
    // 3 Instant type (s11): delivered on arrival, one share lost per frame downed
    {
      const { sim, h } = mk('SWARM', 'v2', 's11');
      h.hp = 1;
      h.invUntil = sim.t + 1e6;   // as above: heal measurement MUST isolate from passing blasts (deploy genuinely ticks)
      h.lastHitAt = sim.t + 1e6;
      sim.heroCast('v2', 'atk');
      const cs = fleet(sim, 'v2');
      ok(cs.length === d.supportN('s11') && d.selfAtkTempo('s11') === 'burst',
        `s11 是瞬發型、派 ${cs.length} 架`);
      cs[0].hp = 0; sim._kill(cs[0], null);
      deploy(sim, () => ![...sim.ents.values()].some((e) => e.supG));
      const A = d.heroAbility('s11', 'atk', 1), B = d.selfAtkBoost('s11', 1, h.abil);
      ok(near(h.hp, Math.min(h.maxHp, 1 + (A.heal + B.heal) * 0.75), 1),
        `擊落 1/4 ⇒ 只補 3/4(${(h.hp - 1).toFixed(0)} / 全額 ${(A.heal + B.heal).toFixed(0)})`);
      ok(fleet(sim, 'v2').length === 0, '瞬發型交付完即退場(沒有時窗可供輸)');
    }
    // 4 Binary states (m08 stealth): solo frame, revealed the moment it is downed
    {
      const { sim, h } = mk('STEEL', 'v3', 'm08');
      sim.heroCast('v3', 'atk');
      deploy(sim);
      ok(fleet(sim, 'v3').length === 1 && h.stealthUntil > sim.t,
        'm08 單機就位 ⇒ 匿蹤上線');
      const k = fleet(sim, 'v3')[0];
      k.hp = 0; sim._kill(k, null);
      ok(h.stealthUntil === 0 && !(h.alphaArm > sim.t),
        '輔助機被擊落 ⇒ 當場現形(二元狀態不住在 mods,MUST 顯式撤掉)');
    }
    // 5 Windows never extend: until stays the original instant after a frame dies
    {
      const { sim, h } = mk('SWARM', 'v4', 's12');
      sim.heroCast('v4', 'atk');
      deploy(sim);
      const armAt5 = sim.t;
      const u0 = h.mods.find((m) => m.k === 'regen').until;
      run(sim, 8);
      const k = fleet(sim, 'v4')[0];
      k.hp = 0; sim._kill(k, null);
      const u1 = h.mods.find((m) => m.k === 'regen').until;
      ok(near(u0, u1), `擊落一架不展期(until ${u0.toFixed(2)} 不變)`);
      ok(u0 > sim.t && near(u0 - armAt5, d.heroAbility('s12', 'atk', 1).dur, 0.2),
        `時窗 = dur(自就位那一刻起算;實得 ${(u0 - armAt5).toFixed(2)}s)`);
    }
    // 6 One-shot effects fire exactly once: s12's revive never re-saves on a "one more frame down, replay"
    {
      const { sim, h } = mk('SWARM', 'v5', 's12');
      const mate = sim.addHero('SWARM', 'v5b', 's11');
      mate.x = 700; mate.mp = 999; mate.abil.atk = 1;
      const body = sim._bodies(mate)[0];
      body.dead = true; body.respawnAt = sim.t + 30; body.hp = 0;
      sim.heroCast('v5', 'atk');
      deploy(sim);
      ok(!body.dead, 'rally:就位那一刻復活隊友');
      body.dead = true; body.respawnAt = sim.t + 30; body.hp = 0;   // kill once more
      const k = fleet(sim, 'v5')[0];
      k.hp = 0; sim._kill(k, null);                                  // trigger one replay
      ok(body.dead, '重放 MUST NOT 再復活一次(一次性效果只在第一次做)');
    }
    // 7 The 22 carrier-migrated ults totally unaffected (no escorts spawned)
    {
      const { sim } = mk('SWARM', 'v6', 's02');
      sim.heroCast('v6', 'atk', 450, 0);
      ok(fleet(sim, 'v6').length === 0
        && [...sim.ents.values()].filter((e) => e.kami).length === d.SQUAD.KAMI.N,
        's02(點遞送)仍生 kami 載具、一架輔助機都沒有');
    }
  }
}

// ============================================================
sec('Ⅵ 輔助機隊攻招專屬 + 守招本體詠唱分流(2026-08-22 使用者定案)');
{
  // 2026-08-22 user decision "guard moves become cast effects instead of summon effects: they take effect
  // only after a cast time set by effect strength, and hits during the cast force immediate delivery (at the
  // square of the chanted-time fraction)".
  // Support fleets (ATK_SUPPORT) hence belong to attack ults only (slot === 'atk'); guard moves are all
  // self-cast skills (no vehicles/escorts).
  const CHS2 = Object.keys(d.CHARACTERS);
  // 1 The classification/count/tempo/toughness quartet is bit-identical on the attack-ult side (default param = 'atk')
  ok(CHS2.every((c) => d.supportStackable(c, 'atk') === d.supportStackable(c)
    && d.supportN(c, 'atk') === d.supportN(c)
    && d.abilTempo(c, 'atk') === d.selfAtkTempo(c)
    && d.supportHp(c, 1, 'atk') === d.supportHp(c, 1)),
    '四支推導的預設槽位 = ult ⇒ 既有呼叫端逐位元不變');
  // 2 The 10 self-buff attack ults travel in follow formation, all three tempos in use, toughness > 0
  const supUlt = CHS2.filter((c) => !d.abilDelivered(c, 'atk'));
  ok(supUlt.length === 10 && supUlt.every((c) => d.heroAbility(c, 'atk', 1).support),
    `自身強化型攻招恰 10 台走跟隨編隊(實得 ${supUlt.length} 台)`);
  ok(new Set(supUlt.map((c) => d.abilTempo(c, 'atk'))).size === 3,
    `攻招三種節奏皆在線(${[...new Set(supUlt.map((c) => d.abilTempo(c, 'atk')))].join(' / ')})`);
  let ultHpOk = true;
  for (const c of supUlt) {
    const n = d.supportN(c, 'atk'), tempo = d.abilTempo(c, 'atk');
    const dur = d.tierVal(d.CHARACTERS[c].atk.dur ?? 0, 1);
    const want = d.frontKillHp(d.supportLegS('atk') + d.supportTempoF(tempo) * dur / n);
    if (d.supportHp(c, 1, 'atk') !== want || !(want > 0)) ultHpOk = false;
  }
  ok(ultHpOk, '攻招輔助機耐久 = 前線一組塔位 ×(攻招投放腿 + 節奏係數 × dur ÷ 機數)(逐台獨立重算)');

  // 3 Guard moves all non-escort (carrier: false, support: false, castTime > 0)
  ok(CHS2.every((c) => {
    const A = d.heroAbility(c, 'def', 1);
    return !A.carrier && !A.support && A.castTime >= d.DEF_CAST.MIN_S && A.castTime <= d.DEF_CAST.MAX_S;
  }), '32 台守招全數為本體施展技能(非載具/輔助機,castTime ∈ [0.5, 2.5]s)');

  // 4 Compensation pays attack ults only: guard moves MUST NOT draw selfAtkEq (that budget buys the
  // retired chassis ults)
  ok(CHS2.every((c) => d.selfAtkEq(c, 1, { light: 1, heavy: 1 }) >= 0)
    && /A\.id === 'atk'/.test(strip(grabMethod(S, '_castEffect'))),
    '補償只在 A.id === ult 那一支取(守招不領 selfAtkEq)');
}

// ============================================================
console.log(`\n${fail ? '❌' : '✅'} 自身強化型攻招(補償 + 輔助機隊)稽核:${pass} 綠 / ${fail} 紅`
  + (BREAK_EQ || BREAK_ALPHA || BREAK_BRK || BREAK_STACK || BREAK_TEMPO
    ? '(反向驗證模式:紅字 = 稽核有牙)' : ''));
process.exit(fail ? 1 : 0);
