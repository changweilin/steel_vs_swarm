// ============ Building-bonus removal + shield/armor split-track counter audit ============
// Purpose: run after changing `data.js` `BUILDING_VS_CAP` clamp section / `shieldSplit()` /
// `shieldRoleName()`, or `sim._damage()` / `sim._heroDmg()`, `tools/duel.mjs` apply(),
// `tools/balance.mjs` building DPS, or `game._hitFeedback`/`_lanceFeedback` estimates.
// Usage: `node tools/audit_shield_counter.mjs`
//
// Why this file exists — each of the two changes has a "breaks silently" shape:
//
// 1 **Building-bonus removal** (2026-08-02 user decision "remove anti-building bonus weapons").
//    Two bonus layers: per-weapon `vs.building` (0.3~2.2) + launcher-only `GRENADE.BUILDING_MUL` (x1.4).
//    The second is deleted wholesale; the first keeps **only penalties** (clamped to <=
//    `BUILDING_VS_CAP`). The easiest breakage is not a wrong deletion but a **clamp roster missing
//    one table** — abilities (skill/ult), `WEAPONS`, `DECOY`/`HYPER` each carry vs tables, and a missed
//    table keeps the old siege bonus on that path, showing in game only as "this move shreds towers",
//    with no error message. So every table is swept here instead of trusting the clamp loop's roster.
//    Also verifies `grenadeBuildingMul` has no remnant in the **whole repo's executable source**
//    (one surviving consumer = the bonus was never really removed).
//
// 2 **Shield/armor split-track counters** (user request: weapons "good vs shields but weak vs main HP,
//    low-rate shield-piercing HP damage with lower total, and similar specialist types"). The three
//    knobs vsSp/vsHp/spPierce settle in `shieldSplit`, while **the same split logic has four consumers**
//    (server settlement / client HUD estimate / duel model / balance model). Any end hand-writing
//    `Math.min(sp, dmg)` once shows as "HUD numbers disagree with actual damage" or "bal says balanced
//    but it plays otherwise" — both nearly impossible to trace back from the screen. So this verifies
//    the **single seam**: server/client/both models MUST all call shieldSplit, and sim.js holds no
//    second hand-written shield deduction.
//
// One more math invariant: **overflow folds back by budget**. Dumping post-breakthrough overflow
// straight into the armor layer lets high-vsSp weapons earn a free anti-shield bonus on depleted-shield
// targets (damage spikes on the exact shot the shield empties), occurring only on that "shield just
// emptied" shot ⇒ in-match it reads as random burst damage. Pinned here by behavior test, not source.
//
// Source reading goes through the `audit_src.mjs` single seam (newline normalization included —
// naive per-line comment stripping silently fails on CRLF checkouts).
import { readSrc } from './audit_src.mjs';
import * as DATA from '../public/js/data.js';
import { BUILDING_VS_CAP, shieldSplit, shieldRoleName, CHARACTERS, WEAPONS, DECOY, HYPER,
  heroWeapon, heroAbility, UNITS, MAPGEO,
  EX_SIEGE_WEAPONS, COUNTER_BUDGET, counterLoad, counterDmgF,
  aoeTrimF, mobDmgF, rngDmgF } from '../public/js/data.js';
import { BattleSim } from '../server/sim.js';

// Synthetic battlefield config (same fakeBattleConfig as test/e2e.mjs / audit_lance_hit.mjs; single lane, near Taipei 101)
function fakeBattleConfig(L = 1) {
  const A = [25.0330, 121.5654];
  const D = 1600 * L, R = 6371000;
  const dLat = D * MAPGEO.REAL_SCALE / R * 180 / Math.PI;
  const B = [A[0] + dLat, A[1]];
  const mid = [(A[0] + B[0]) / 2, (A[1] + B[1]) / 2];
  const pts = [];
  for (let u = 0; u <= 1.001; u += 0.05) {
    const v = 1 - u;
    pts.push([v * v * A[0] + 2 * v * u * mid[0] + u * u * B[0], v * v * A[1] + 2 * v * u * mid[1] + u * u * B[1]]);
  }
  const sizeM = D / (0.85 * Math.SQRT2);
  return {
    center: { lat: mid[0], lng: mid[1] }, bases: { SWARM: A, STEEL: B }, lanes: [pts],
    sizeM, diagM: sizeM * Math.SQRT2, distM: D, geoScaleVer: MAPGEO.GEO_SCALE_VER,
    maxOverlap: 0.05, synthetic: true, placeName: '護盾剋制稽核戰區',
    env: { season: 'summer', time: 'day', weather: 'clear' },
  };
}

let pass = 0, fail = 0;
const t = (n, ok, extra = '') => { ok ? (pass++, console.log(`  ✓ ${n}`)) : (fail++, console.log(`  ✗ ${n} ${extra}`)); };
const near = (a, b, e = 1e-9) => Math.abs(a - b) <= e;
const count = (s, needle) => s.split(needle).length - 1;

/** Strip block/line comments — "only N occurrences in the whole file" MUST count executable source (a name mentioned in comments is not a seam breach) */
const strip = (s) => s
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .split('\n').map((l) => l.replace(/(^|[^:'"`])\/\/.*$/, '$1')).join('\n');

const dataSrc = strip(readSrc('public', 'js', 'data.js'));
const simSrc = strip(readSrc('server', 'sim.js'));
const gameSrc = strip(readSrc('public', 'js', 'game.js'));
const duelSrc = strip(readSrc('tools', 'duel.mjs'));
const balSrc = strip(readSrc('tools', 'balance.mjs'));

// ---------------------------------------------------------------------------
console.log('■ Ⅰ 建築加乘移除(加乘全刪、懲罰保留;夾制是推導不是逐武器手改)');
// ---------------------------------------------------------------------------
{
  t('BUILDING_VS_CAP === 1(建築剋制上限 = 無加乘)', BUILDING_VS_CAP === 1, `${BUILDING_VS_CAP}`);

  // Sweep every vs table — never trust the clamp loop's roster to be complete
  const tables = [
    ...Object.entries(WEAPONS).map(([k, w]) => [`WEAPONS.${k}`, w]),
    ['DECOY', DECOY], ['HYPER', HYPER],
    ...Object.entries(CHARACTERS).flatMap(([id, c]) =>
      ['light', 'heavy', 'skill', 'ult'].filter((s) => c[s]).map((s) => [`${id}.${s}`, c[s]])),
  ];
  const over = tables.filter(([, w]) => w?.vs?.building > BUILDING_VS_CAP);
  t(`所有 vs 表對建築無加乘(掃 ${tables.length} 張)`, over.length === 0,
    over.map(([n, w]) => `${n}=${w.vs.building}`).join(' '));

  // Penalties stay: if even <1 were flattened, that would be "removing the whole building-counter
  // relationship", not "removing the bonus"
  const under = tables.filter(([, w]) => w?.vs?.building < 1);
  t(`懲罰保留(${under.length} 張表仍 < 1:防空/反甲特化拆建築照樣吃虧)`, under.length > 0);

  // Resolved live values are clamped the same way (heroWeapon/heroAbility share the vs reference ⇒
  // clamping at the source covers the whole chain)
  const solved = [];
  for (const id of Object.keys(CHARACTERS)) {
    for (const s of ['light', 'heavy']) { const w = heroWeapon(id, s, 3, true); if (w?.vs?.building > 1) solved.push(`${id}.${s}`); }
    for (const s of ['skill', 'ult']) { const a = heroAbility(id, s, 3); if (a?.vs?.building > 1) solved.push(`${id}.${s}`); }
  }
  t('heroWeapon/heroAbility 解析後仍無加乘(夾在源頭即全鏈生效)', solved.length === 0, solved.join(' '));

  // The clamp MUST be one derived loop, not per-weapon hand edits (1 declaration + compare and
  // assign in the clamp section + 1 upper clamp in the building-DPS convergence section = 4 sites;
  // any extra site must be explainable as its own derivation)
  t('夾制在 data.js 只有唯一一段推導迴圈',
    count(dataSrc, 'BUILDING_VS_CAP') === 4 && /w\.vs\.building > BUILDING_VS_CAP\) w\.vs\.building = BUILDING_VS_CAP;/.test(dataSrc),
    `${count(dataSrc, 'BUILDING_VS_CAP')} 處`);

  // Launcher x1.4 vs buildings retired as a group (one surviving consumer = the bonus never really left)
  t('GRENADE.BUILDING_MUL / grenadeBuildingMul 已無匯出', !('grenadeBuildingMul' in DATA) && !('GRENADE' in DATA));
  for (const [name, s] of [['data.js', dataSrc], ['sim.js', simSrc], ['duel.mjs', duelSrc], ['balance.mjs', balSrc], ['game.js', gameSrc]])
    t(`${name} 執行原文無 grenadeBuildingMul 殘留`, !/grenadeBuildingMul|BUILDING_MUL/.test(s));

  t('_heroDmg 不再有任何情境倍率(只剩 vsMult × buff)',
    /_heroDmg\(h, def, targetKind\) \{\s*(?:let m = vsMult\(def, targetKind\);[\s\S]*?return def\.dmg \* m \* this\._buffMul\(h, 'dmg'\);|return def\.dmg \* vsMult\(def, targetKind\) \* this\._buffMul\(h, 'dmg'\);)/.test(simSrc));
}

// ---------------------------------------------------------------------------
console.log('\n■ Ⅱ 分軌拆分單一縫(shieldSplit;四個消費端 MUST 全部吃這一支)');
// ---------------------------------------------------------------------------
{
  t('shieldSplit 只在 data.js 有一份實作', count(dataSrc, 'export function shieldSplit') === 1);
  // Knobs may only be read inside data.js: settlement (shieldSplit), labels (shieldRoleName), and
  // resolution passthrough (heroWeapon/heroAbility). Once a consumer reads wd.vsSp to multiply by
  // itself, that is a second split logic — the source of "HUD disagrees with actual damage" and
  // "bal says balanced but it plays otherwise".
  // "Forwarding as-is" is allowed (copying all three columns when rebuilding a def); **reading them
  // in to compute locally** is the seam breach. So strip `vsSp: X.vsSp`-style forwarding first; any
  // knob mention left means a consumer is multiplying on its own.
  const fwd = /\b(?:vsSp|vsHp|spPierce): [A-Za-z_$][\w$]*\.(?:vsSp|vsHp|spPierce)\b/g;
  const knob = /\bvsSp\b|\bvsHp\b|\bspPierce\b/;
  for (const [name, s] of [['sim.js', simSrc], ['duel.mjs', duelSrc], ['balance.mjs', balSrc], ['game.js', gameSrc]])
    t(`${name} 不自己讀旋鈕運算(一律經 shieldSplit;原樣轉交不算)`, !knob.test(s.replace(fwd, '')));
  // Rebuilt defs MUST copy all three knobs together — a missed column means ability and weapon
  // versions behave two ways against the same shield axis
  t('sim.js 重建招式 def 時帶齊三個旋鈕',
    /vs: A\.vs, pen: A\.pen,\s*vsSp: A\.vsSp, vsHp: A\.vsHp, spPierce: A\.spPierce/.test(simSrc));
  t('data.js 的結算讀取點只有 shieldSplit 一處',
    count(dataSrc, 'const sMul = wd?.vsSp') === 1);

  // Server: shield deduction may only appear in _damage, via shieldSplit
  t('sim.js import shieldSplit', /shieldSplit/.test(simSrc.split('\n').slice(0, 40).join('\n')));
  t('sim._damage 英雄分支經 shieldSplit 拆分',
    /const \{ toSp: toShield, toHp \} = shieldSplit\(wd, dmg, t\.sp \|\| 0\);/.test(simSrc));
  t('sim._damage 非英雄分支同樣吃 vsHp(經 shieldSplit(…, 0))',
    /dmg = shieldSplit\(wd, dmg, 0\)\.toHp;/.test(simSrc));
  t('sim.js 全檔沒有第二處手寫護盾拆分(Math.min(t.sp…))',
    !/Math\.min\(t\.sp/.test(simSrc) && count(simSrc, 'shieldSplit(') === 2,
    `shieldSplit 呼叫 ${count(simSrc, 'shieldSplit(')} 次`);

  // The wd parameter of _damage: every damage path holding a weapon def MUST pass it in
  const dmgCalls = simSrc.split('\n').filter((l) => /this\._damage\(/.test(l));
  const withDef = dmgCalls.filter((l) => /(wp\.def|, def\)|, wd\))\s*\);?$/.test(l.trim()) || /0, (wp\.def|def|wd)\)/.test(l));
  t(`_damage 的武器路徑都帶 def(${withDef.length}/${dmgCalls.length} 條;其餘為環境/地雷/SAM)`,
    withDef.length >= 7, withDef.length + ' 條');

  // Client estimates and the two offline models
  t('game.js HUD 估算吃 shieldSplit(兩處回饋:直擊 + 貫穿)', count(gameSrc, 'shieldSplit(def,') === 2,
    `${count(gameSrc, 'shieldSplit(def,')} 處`);
  t('game.js 估算的護盾水位取自快照 ent.sp(MUST NOT 自算)', count(gameSrc, "shieldSplit(def, raw, ent.sp || 0)") === 2);
  t('duel.mjs apply() 經 shieldSplit(對進戰模型與 sim._damage 同一支)',
    /const \{ toSp, toHp \} = shieldSplit\(def, dmg, Math\.max\(0, T\.sh\)\);/.test(duelSrc));
  t('duel.mjs 無手寫護盾拆分殘留', !/Math\.min\(Math\.max\(0, T\.sh\), dmg\)/.test(duelSrc));
  t('balance.mjs 對建築/NPC 的 DPS 吃 vsHp(經 shieldSplit(…, 0))',
    count(balSrc, 'shieldSplit(w, w.dmg, 0).toHp') === 3, `${count(balSrc, 'shieldSplit(w, w.dmg, 0).toHp')} 處`);
}

// ---------------------------------------------------------------------------
console.log('\n■ Ⅲ shieldSplit 行為(中性還原 / 預算守恆 / 三型 / 退化方向)');
// ---------------------------------------------------------------------------
{
  // Neutral = bit-identical to the old scheme: this guarantees the "28 unflagged characters" are
  // completely unaffected by this change
  for (const [dmg, sp] of [[100, 250], [100, 100], [100, 40], [100, 0], [0, 100]]) {
    const r = shieldSplit({}, dmg, sp), old = Math.min(sp, dmg);
    t(`中性 dmg${dmg}/盾${sp} 逐位元同舊制`, near(r.toSp, old) && near(r.toHp, dmg - old), `${r.toSp}/${r.toHp}`);
  }
  t('未帶 def(環境傷害)= 中性', near(shieldSplit(null, 100, 40).toSp, 40) && near(shieldSplit(undefined, 100, 40).toHp, 60));

  // Anti-shield: more shield damage, less armor damage
  const anti = { vsSp: 2, vsHp: 0.5 };
  t('反護盾滿盾:護盾吃 dmg × vsSp、裝甲 0',
    near(shieldSplit(anti, 100, 1000).toSp, 200) && near(shieldSplit(anti, 100, 1000).toHp, 0));
  // Budget conservation (core invariant): the shield only absorbs sp/vsSp of budget; the rest enters armor
  const a2 = shieldSplit(anti, 100, 100);
  t('溢出按預算折回:盾 100 只消耗 50 點預算 ⇒ 裝甲 = 50 × vsHp',
    near(a2.toSp, 100) && near(a2.toHp, 25), `${a2.toSp}/${a2.toHp}`);
  t('MUST NOT 把溢出的護盾傷害直接倒進裝甲(那會是 (200−100)×0.5 = 50)', !near(a2.toHp, 50));

  // Shield-piercing: full shields still bleed, and the bleed is independent of shield level
  const pc = { spPierce: 0.5, vsHp: 0.8 };
  t('穿盾滿盾仍見血 = dmg × spPierce × vsHp', near(shieldSplit(pc, 100, 99999).toHp, 40));
  // The floor is not a flat amount: thinner shields also add overflow budget ⇒ bleed only guarantees
  // a lower bound and is non-decreasing as shields thin
  const pcSeq = [99999, 60, 40, 20, 0].map((sp) => shieldSplit(pc, 100, sp).toHp);
  t('穿盾見血量恆 ≥ dmg × spPierce × vsHp(護盾再厚也有保底)', pcSeq.every((v) => v >= 40 - 1e-9), pcSeq.join(','));
  t('護盾越薄見血越多(單調不減)', pcSeq.every((v, i) => i === 0 || v >= pcSeq[i - 1]), pcSeq.join(','));
  t('spPierce=1 = 完全無視護盾(盾一點都不掉)',
    near(shieldSplit({ spPierce: 1 }, 100, 500).toSp, 0) && near(shieldSplit({ spPierce: 1 }, 100, 500).toHp, 100));

  // Anti-armor: mirror image
  const aa = { vsSp: 0.5, vsHp: 1.5 };
  t('反裝甲:同一發在護盾上只刮一半', near(shieldSplit(aa, 100, 500).toSp, 50));
  t('反裝甲:無護盾目標吃滿 vsHp', near(shieldSplit(aa, 100, 0).toHp, 150));

  // Degradation always favors "shield works" (principle 6)
  const bk = shieldSplit({ vsSp: 0 }, 100, 500);
  t('vsSp=0 = 護盾全擋(MUST NOT 退化成無視護盾穿過去)', near(bk.toSp, 0) && near(bk.toHp, 0));

  // Monotonicity: higher vsSp ⇒ more shield damage; higher vsHp ⇒ more armor damage
  const spSeq = [0.5, 1, 1.5, 2].map((v) => shieldSplit({ vsSp: v }, 100, 500).toSp);
  t('vsSp 單調遞增 → 護盾傷害單調遞增', spSeq.every((v, i) => i === 0 || v > spSeq[i - 1]), spSeq.join(','));
  const hpSeq = [0.5, 1, 1.5, 2].map((v) => shieldSplit({ vsHp: v }, 100, 0).toHp);
  t('vsHp 單調遞增 → 裝甲傷害單調遞增', hpSeq.every((v, i) => i === 0 || v > hpSeq[i - 1]), hpSeq.join(','));

  // Labels derive from knobs
  t('標籤推導:中性無標籤 / 反護盾 / 穿盾 / 反裝甲',
    shieldRoleName({}) === '' && shieldRoleName({ vsSp: 1.7, vsHp: 0.7 }) === '反護盾'
    && shieldRoleName({ spPierce: 0.4 }) === '穿盾' && shieldRoleName({ vsSp: 0.7, vsHp: 1.2 }) === '反裝甲');
  t('死區:微幅偏離不掛標籤(避免圖鑑滿版噪音)', shieldRoleName({ vsSp: 1.02, vsHp: 0.98 }) === '');
}

// ---------------------------------------------------------------------------
console.log('\n■ Ⅳ 真 BattleSim 直測(伺服器結算與 shieldSplit 對得上)');
// ---------------------------------------------------------------------------
{
  const sim = new BattleSim(fakeBattleConfig(1));
  const h = sim.addHero('SWARM', 'pa', 't01');
  // Damage deliberately sized so neutral cannot pierce the shield (< maxSp): if both shots emptied
  // the shield, the cap would eat the strip difference and this section could never tell whether
  // anti-shield works (a fixture false negative, not a code pass).
  const DMG = Math.floor(h.maxSp * 0.6);
  const shot = (wd) => {
    h.sp = h.maxSp; h.hp = h.maxHp; h.lastHitAt = -999;
    sim._damage(h, DMG, null, 0, 0, wd);
    return { sp: h.maxSp - h.sp, hp: h.maxHp - h.hp };
  };
  const n = shot(null), a = shot({ vsSp: 1.7, vsHp: 0.7 }), p = shot({ spPierce: 0.5, vsHp: 0.9 });
  t(`反護盾削盾更快(${n.sp.toFixed(0)} → ${a.sp.toFixed(0)};護盾上限 ${h.maxSp})`, a.sp > n.sp);
  t(`中性武器打不穿的盾,穿盾武器仍見血 ${p.hp.toFixed(1)}`, near(n.hp, 0) && p.hp > 0);
  t('護盾層不吃護甲減免(反護盾也一樣)', near(a.sp, Math.min(h.maxSp, DMG * 1.7)));

  // NPCs (no shield layer) still take vsHp — if "weak main-HP damage" held only for heroes, that
  // would be an invisible second rule set
  const npc = () => sim._add({ kind: 'soldier', side: 'STEEL', x: 40, z: 0, hp: UNITS.soldier.hp });
  const n1 = npc(); sim._damage(n1, 100, null, 0, 0, null);
  const n2 = npc(); sim._damage(n2, 100, null, 0, 0, { vsHp: 0.5 });
  t('NPC 也吃 vsHp(弱化 = 中性 × 0.5)',
    near(UNITS.soldier.hp - n2.hp, (UNITS.soldier.hp - n1.hp) * 0.5, 1e-6));
  const n3 = npc(); sim._damage(n3, 100, null, 0, 0, { vsSp: 3, spPierce: 0.9 });
  t('NPC 不受 vsSp/spPierce 影響(沒有護盾層可談)',
    near(UNITS.soldier.hp - n3.hp, UNITS.soldier.hp - n1.hp, 1e-6));
  for (const e of [n1, n2, n3]) sim.ents.delete(e.id);
}

// ---------------------------------------------------------------------------
console.log('\n■ Ⅴ 配置紀律(2026-08-02 使用者定案的三條;全部是推導,不是「當初調的時候記得」)');
// ---------------------------------------------------------------------------
{
  // Roster of weapons carrying shield-axis flags (reverse-check all three disciplines against it)
  const flagged = [];
  for (const [id, c] of Object.entries(CHARACTERS))
    for (const s of ['light', 'heavy', 'skill', 'ult']) {
      const w = c[s];
      if (w && ((w.vsSp ?? 1) !== 1 || (w.vsHp ?? 1) !== 1 || (w.spPierce || 0) !== 0)) flagged.push([`${id}.${s}`, w]);
    }
  t(`共 ${flagged.length} 把武器掛了護盾軸(其餘逐位元不受本次改動影響)`, flagged.length > 0,
    flagged.map(([k]) => k).join(' '));

  // — Discipline 1: piercing / anti-armor may only sit on formerly siege-bonused weapons —
  const roster = new Set(EX_SIEGE_WEAPONS);
  t('EX_SIEGE_WEAPONS 名冊逐一指得到真的武器', EX_SIEGE_WEAPONS.every((k) => {
    const [id, s] = k.split('.');
    return !!CHARACTERS[id]?.[s];
  }), EX_SIEGE_WEAPONS.filter((k) => { const [id, s] = k.split('.'); return !CHARACTERS[id]?.[s]; }).join(' '));
  const siegeOnly = flagged.filter(([, w]) => (w.spPierce || 0) > 0 || (w.vsHp ?? 1) > 1);
  const offRoster = siegeOnly.filter(([k]) => !roster.has(k));
  t(`穿盾 / 反裝甲(${siegeOnly.length} 把)全在 EX_SIEGE_WEAPONS 名冊內`, offRoster.length === 0,
    offRoster.map(([k]) => k).join(' '));
  // Anti-shield travels a different road (strip bonuses + compress base damage) and is deliberately
  // **not** roster-limited — pin this exemption so nobody "helpfully" stuffs it into the roster later,
  // which would bar anti-shield from non-siege weapons for good
  const antiSh = flagged.filter(([, w]) => (w.vsSp ?? 1) > 1);
  t(`反護盾(${antiSh.length} 把)不受名冊限制(走剝加成 + 壓傷害那條路)`,
    antiSh.some(([k]) => !roster.has(k)), antiSh.map(([k]) => k).join(' '));

  // — Discipline 2: anti-shield weapons must carry no other unit bonus —
  const withBonus = antiSh.filter(([, w]) => Object.values(w.vs || {}).some((v) => v > 1));
  t('反護盾武器的 vs 表無任何 > 1 的加成', withBonus.length === 0,
    withBonus.map(([k, w]) => `${k}=${JSON.stringify(w.vs)}`).join(' '));
  t('反護盾武器仍保留 < 1 的懲罰(拿掉的是加成,不是整個剋制關係)',
    antiSh.every(([, w]) => Object.values(w.vs || {}).some((v) => v < 1)));
  // The clamp MUST sit after CLASS_SYM — that section scales armor/air columns wholesale, so an
  // earlier clamp would be pushed back over 1
  t('夾制排在 CLASS_SYM 對稱化之後(排前面會被等比放大重新推過 1)',
    dataSrc.indexOf('CLASS_SYM.SWARM_ARMOR_F = ') < dataSrc.indexOf('const VS_DEFS = ['));
  t('兩道夾制共用同一份 VS_DEFS 名冊(建築 + 反護盾各掃一次 = 遲早漏一張表)',
    count(dataSrc, 'const VS_DEFS = [') === 1 && count(dataSrc, 'for (const w of VS_DEFS)') === 1);

  // — Discipline 3: broader and more general bonuses ⇒ lower base damage —
  t('廣泛加成的單價高於挑目標的加成(BROAD > NARROW)', COUNTER_BUDGET.BROAD > COUNTER_BUDGET.NARROW,
    `${COUNTER_BUDGET.BROAD} vs ${COUNTER_BUDGET.NARROW}`);
  t('沒掛護盾軸 ⇒ 負載 0、折減 ×1(其餘 28 名角色逐位元不變)', (() => {
    for (const [id, c] of Object.entries(CHARACTERS))
      for (const s of ['light', 'heavy']) {
        const w = c[s];
        if (!w) continue;
        const isFlagged = (w.vsSp ?? 1) !== 1 || (w.vsHp ?? 1) !== 1 || (w.spPierce || 0) !== 0;
        if (!isFlagged && (counterLoad(w) !== 0 || counterDmgF(w) !== 1)) return false;
      }
    return true;
  })());
  t('折減對負載單調遞減且恆 ∈ (0, 1]', (() => {
    const seq = [0, 0.2, 0.5, 1, 2].map((L) => 1 / (1 + COUNTER_BUDGET.K * L));
    return seq[0] === 1 && seq.every((v, i) => v > 0 && v <= 1 && (i === 0 || v < seq[i - 1]));
  })());
  // Same numbers cost more on the shield axis than on category counters — that is the "broad-bonus" price tag
  const broadW = { vsSp: 1.5, vs: {} }, narrowW = { vsSp: 1.0001, vs: { armor: 1.5 } };
  t('同樣 +0.5:掛護盾軸的折減重於掛類別剋制', counterDmgF(broadW) < counterDmgF(narrowW),
    `${counterDmgF(broadW).toFixed(3)} vs ${counterDmgF(narrowW).toFixed(3)}`);
  // Flagged weapons' actual damage MUST sit below the unreduced value (the reduction really hooks
  // into heroWeapon, not just a defined-but-unwired function).
  // **Comparison MUST travel the full budget chain**: since 2026-08-02 heroWeapon's dmg also multiplies
  // three more derived factors — aoeTrimF (range-convergence rebate), mobDmgF (mobility budget),
  // rngDmgF (range budget). Comparing counterDmgF alone false-reds on weapons where those three are
  // not 1 (s03/t01/t08/m01 at migration time); what needs pinning is "is counterDmgF wired in" ⇒
  // compare the whole-chain product, and separately verify counterDmgF < 1.
  for (const [k, w] of flagged) {
    const [id, s] = k.split('.');
    if (s !== 'light' && s !== 'heavy') continue;
    const solved = heroWeapon(id, s, 1, false), f = counterDmgF(w);
    const chain = f * aoeTrimF(w) * mobDmgF(id) * rngDmgF(id, s);
    t(`${k} 基礎傷害吃到折減 ×${f.toFixed(3)}(全鏈 ×${chain.toFixed(3)};${(w.dmg?.[0] ?? w.dmg).toFixed?.(0) ?? w.dmg[0]} → ${solved.dmg.toFixed(1)})`,
      f < 1 && near(solved.dmg, (Array.isArray(w.dmg) ? w.dmg[0] : w.dmg) * chain, 1e-6));
  }
  // Broad types (anti-shield/piercing) MUST discount harder than pure-anti-armor vsHp builds — the
  // user's "base damage runs lower" in the original wording
  const broadF = flagged.filter(([, w]) => (w.vsSp ?? 1) > 1 || (w.spPierce || 0) > 0).map(([, w]) => counterDmgF(w));
  const narrowF = flagged.filter(([, w]) => (w.vsSp ?? 1) <= 1 && !(w.spPierce > 0)).map(([, w]) => counterDmgF(w));
  t('反護盾/穿盾的折減重於反裝甲(廣泛性加成 ⇒ 基礎傷害更低)',
    broadF.length > 0 && narrowF.length > 0 && Math.max(...broadF) < Math.min(...narrowF),
    `廣泛 ${broadF.map((v) => v.toFixed(3)).join(',')} / 反裝甲 ${narrowF.map((v) => v.toFixed(3)).join(',')}`);
}

// ---------------------------------------------------------------------------
console.log('\n■ Ⅵ 對建築 DPS 收斂(2026-08-04 使用者定案「重武器之間與輕武器之間對建築的 DPS 不要落差太大」)');
// ---------------------------------------------------------------------------
// This section's two easiest "breaks silently" shapes:
//  1 Compress without refilling the level ⇒ every siege DPS slows together (bal 4 goes red, but only
//    after running the whole file);
//  2 `vs.building` rewritten per weapon by hand ⇒ drifts the moment any of the 32 characters moves
//    (the old A34-1 disease).
// So verify: spread really converged (against the "neutral vs.building" spread control), the level is
// pinned to full-tier siege DPS, and there is exactly one derived write site.
{
  const { BUILD_DPS, buildDps, ECON } = DATA;
  const SPREAD_RAIL = { light: 2.0, heavy: 3.2 };   // guard rail against regression (current light 1.71x / heavy 2.92x)
  t('BUILD_DPS.K ∈ (0, 1](0 = 逐位元同舊制、1 = 完全拉平)', BUILD_DPS.K > 0 && BUILD_DPS.K <= 1);
  t('水位回填有迭代上限(夾在 CAP 的那些補不滿 ⇒ 迴圈 MUST 有界)', BUILD_DPS.LEVEL_ITERS >= 1);
  t('buildDps 只有一份實作(收斂迴圈與本稽核同吃)', count(dataSrc, 'export function buildDps') === 1);
  // Since 2026-08-04 the magazine cycle comes from the data.js `weaponDps`/`weaponCycleS` single seam
  // (the old scheme hand-copied `const cycle = …` twice; a third consumer — the codex hexagon's firepower
  // axis — would have made it three copies). Same formula = same function.
  t('buildDps 與 balance.mjs 的 slotDps 同式(同吃 weaponDps,且走 shieldSplit)',
    /export const weaponCycleS = \(w\) => w\.mag \/ \(w\.rate \|\| RATE_DEF\) \+ w\.reload;/.test(dataSrc)
    && /weaponDps\(w, shieldSplit\(w, w\.dmg, 0\)\.toHp \* vsMult\(w, 'tower'\)/.test(dataSrc)
    && /weaponDps\(w, shieldSplit\(w, w\.dmg, 0\)\.toHp \* vsMult\(w, tk\)/.test(balSrc)
    && !/const cycle = w\.mag \//.test(dataSrc) && !/const cycle = w\.mag \//.test(balSrc));
  t('收斂只有一個 vs.building 寫入點(set() 單一縫;MUST NOT 逐武器手改)',
    count(dataSrc, /\(w\.vs \|\|= \{\}\)\.building = q\(Math\.min\(BUILDING_VS_CAP, v\)\)/g) === 1);

  for (const slot of ['light', 'heavy']) {
    const chs = Object.keys(CHARACTERS).filter((ch) => CHARACTERS[ch][slot]);
    const now = chs.map((ch) => buildDps(ch, slot));
    // Control: neutral vs.building (=1) for all — i.e. the spread "without spending this axis at all".
    // Convergence is defined as "spending this axis makes spread strictly smaller"; pinning only an
    // absolute ratio could pass on already-even weapon ladders without proving this section does anything.
    const flat = chs.map((ch) => buildDps(ch, slot) / (CHARACTERS[ch][slot].vs?.building ?? 1));
    const sp = (v) => Math.max(...v) / Math.min(...v);
    t(`${slot}:對建築 DPS 離散度 ${sp(now).toFixed(2)}× ≤ 守門線 ${SPREAD_RAIL[slot]}×`,
      sp(now) <= SPREAD_RAIL[slot], `實得 ${sp(now).toFixed(3)}×`);
    t(`${slot}:收斂後離散度 ${sp(now).toFixed(2)}× < 中性對照 ${sp(flat).toFixed(2)}×(這一軸真的在收斂)`,
      sp(now) < sp(flat));
    t(`${slot}:每一把的 vs.building 都在 (0, ${BUILDING_VS_CAP}](上夾不得為了收斂而放寬)`,
      chs.every((ch) => {
        const v = CHARACTERS[ch][slot].vs?.building ?? 1;
        return v > 0 && v <= BUILDING_VS_CAP + 1e-9;
      }));
  }
  // Level: full-tier per-character (light + heavy) siege DPS — exactly what bal 4 measures. Convergence
  // MUST move only the spread, never the level, so it MUST land near the neutral control's level
  // (±2%); much lower means the refill never hooked up or got clamped dead.
  const TOPL = 1 + ECON.UPGRADES.lw.max, TOPH = 1 + ECON.UPGRADES.hw.max;
  const chs = Object.keys(CHARACTERS);
  const push = (ch) => buildDps(ch, 'light', TOPL) + buildDps(ch, 'heavy', TOPH);
  const pushFlat = (ch) => buildDps(ch, 'light', TOPL) / (CHARACTERS[ch].light?.vs?.building ?? 1)
    + buildDps(ch, 'heavy', TOPH) / (CHARACTERS[ch].heavy?.vs?.building ?? 1);
  const mean = (f) => chs.reduce((s, ch) => s + f(ch), 0) / chs.length;
  const spread = (f) => Math.max(...chs.map(f)) / Math.min(...chs.map(f));
  t(`滿級拆塔 DPS 離散度 ${spread(push).toFixed(2)}× < 中性對照 ${spread(pushFlat).toFixed(2)}×`,
    spread(push) < spread(pushFlat));
  t(`滿級拆塔 DPS 水位 ${mean(push).toFixed(1)} 落在中性對照 ${mean(pushFlat).toFixed(1)} 的合理帶內`,
    mean(push) > 0 && mean(push) < mean(pushFlat));
}

console.log(`\n${fail ? '❌' : '✅'} 建築加乘移除 / 護盾分軌剋制稽核:${pass}/${pass + fail} 通過`);
process.exit(fail ? 1 : 0);
