// End-to-end: direct sim checks (mines/magazines/counters/self-detonation/character kits/double-HP/AA ambush)
//            pre-room map pick, room creation (with party size/env), faction pick (N seats), character pick
//            ready, battle load, snapshot, ballistic hits, kit progression, map retained on return
import WebSocket from 'ws';
import { BattleSim, waveInterval, cumLen } from '../server/sim.js';
import { BotBrain } from '../server/bots.js';
import { RoomHub, validateBattleConfig } from '../server/rooms.js';
import {
  UNITS, ECON, GAME, FIELD, HAZARDS, AFFIXES, MAPGEO,
  CHARACTERS, charsOf, heroWeapon, heroAbility, chargeF, heavyMpCost,
  HEROIC, VITALS, armorMul, SQUAD, tierVal, WEAPONS, DECOY_BOMB, HYPER,
  charKind, heroArmor, rangeCap, DECOY, LOCK, IFRAME, THIRD, COMBAT_SCALE, hitR,
  SPECIAL, specialTier, specialBudget, kamiBlast, selfBoomBlast, decoyBlast, decoyBombBlast, hyperBlast,
  specialBlastR, hyperShare,
  hyperApex, hyperRange, hyperFlightS, hyperMaxArcM, hyperHp, hyperTrackR, hyperTerminalF,
  kamiHp, kamiSide, decoyHp, towerDps, kamiExposureS, decoyExposureS,
  TOWER_SITE_N, frontDps, overflyDps, waveDps, blastFootprintR,
  upgradePrice, upgradeScore, BATTLE_SCORE, battleScoreGain, addBattleScore, BOT_DIFF, BOT_DIFF_KEYS, BOT_OPS, botOpGap,
  BALLISTIC, lobMinRange, offAxisFalloff, AOE_EDGE, fanBinSpan,
  FLIGHT, airSinkM,
  waveComp, waveMarchSpeed, waveSpacingM, CREEP_UPG, creepUpgMul,
  BUILDING_VS_CAP, shieldSplit, SHIELD_DEFENSE, shieldRoleName, shieldDefKindFactor, EX_SIEGE_WEAPONS, counterDmgF,
  aoeTrimF, mobDmgF, rngDmgF, AREA_WEAPONS, soloBlastRmax, towerPairSepM, aoeClass, blastFalloff, TARGET_R,
  trajClass, shotFlightS, vsMult, blastFamily, buildDps, heroRange,
  altRangeMax, RANGE_TOL,
  ATK_CARRIER, atkDelivered, abilDelivered, abilOrigin, atkCarrierCd, atkCdBand, atkParts, atkPartN,
  SELF_ATK, selfAtkEq, selfAtkBoost, abilHoldSlot,
  ATK_SUPPORT, supportN, supportHp, supportLegS, supportStackable, supportTempoF, selfAtkTempo,
  kindParts, frontKillHp,
  TERRAIN_FX, fluidFactor, envTrigger, WATER, liftRegen,
  DEF_CAST, defCastTime,
} from '../public/js/data.js';
// Story-campaign room creation needs a real map (flag defSide flows from venueConfig into battleConfig)
import { VENUES, venueConfig } from '../public/js/venues.js';

// e2e scenes spawn mines, AA sites, and civilians; pin the random sequence so random events cannot shift test premises.
const TEST_RANDOM_ORIGINAL = Math.random;
let testRandomState = 0x5eed1234;
Math.random = () => {
  testRandomState = (Math.imul(testRandomState, 1664525) + 1013904223) >>> 0;
  return testRandomState / 0x100000000;
};

/**
 * Unscaled baseline damage = tier value x the four derived counter/range/mobility/reach factors.
 * The assertions below pin that squad scaling SQUAD.DMG stays inactive, not that the dmg field must carry no factor at all --
 * since 2026-08-02 heroWeapon dmg also multiplies counterDmgF (building/shield counter budget), aoeTrimF
 * (firepower payback for range convergence), mobDmgF (mobility budget), rngDmgF (range budget). Comparing raw tier values
 * would false-red on characters whose factors differ from 1, while the real pin is squad scaling.
 */
const rawDmg = (ch, slot) => tierVal(CHARACTERS[ch][slot].dmg, 1)
  * counterDmgF(CHARACTERS[ch][slot]) * aoeTrimF(CHARACTERS[ch][slot]) * mobDmgF(ch) * rngDmgF(ch, slot);

// #INC-104 high-altitude vertical-fire probe (scales with COMBAT_SCALE: full range/altitude thresholds halve, so probe height halves too)
const HI_ALT = Math.round(250 * COMBAT_SCALE);

/** Clear third-party camps (guerrillas/militia): unrelated direct sim checks need determinism, must not take camp stray fire */
function purgeCamps(sim) {
  for (const s of [...sim.ents.values()]) if (s.tp) sim.ents.delete(s.id);
  sim.camps = [];
}

const URL = process.env.WS_URL || 'ws://localhost:8620';
const log = (...a) => console.log(...a);
// e2e owns server start/stop (reuse an external listener without stealing the port; shut down self-started servers on exit)
let _autoServer = null;
async function ensureServer() {
  if (process.env.WS_URL) return;   // remote target given, leave local processes alone
  try {
    await new Promise((res, rej) => {
      const probe = new WebSocket(URL);
      const to = setTimeout(() => { try { probe.close(); } catch {} rej(new Error('probe timeout')); }, 1500);
      probe.on('open', () => { clearTimeout(to); probe.close(); res(); });
      probe.on('error', (e) => { clearTimeout(to); rej(e); });
    });
    return;   // a server is already listening
  } catch { /* nobody listening, start our own */ }
  const { spawn } = await import('node:child_process');
  _autoServer = spawn(process.execPath, ['server/server.js', '--port', '8620'],
    { cwd: process.cwd(), stdio: 'ignore' });
  for (let i = 0; i < 50; i++) {
    try {
      await new Promise((res, rej) => {
        const probe = new WebSocket(URL);
        const to = setTimeout(() => { try { probe.close(); } catch {} rej(new Error('wait')); }, 400);
        probe.on('open', () => { clearTimeout(to); probe.close(); res(); });
        probe.on('error', (e) => { clearTimeout(to); rej(e); });
      });
      log('  ℹ e2e 自起本地伺服器(localhost:8620)');
      return;
    } catch { await new Promise((r) => setTimeout(r, 200)); }
  }
  throw new Error('e2e 自起伺服器逾時(10 秒連不上 ws://localhost:8620)');
}
process.on('exit', () => { try { _autoServer?.kill(); } catch {} });
await ensureServer();
let failed = false;
const assert = (cond, msg) => {
  if (cond) log(`  ✅ ${msg}`);
  else { failed = true; log(`  ❌ ${msg}`); }
};

function client(name) {
  const ws = new WebSocket(URL);
  const c = { ws, name, msgs: [], sync: null, snaps: [], pin: null };
  ws.on('message', (raw) => {
    const m = JSON.parse(raw);
    c.msgs.push(m);
    if (m.t === 'sync') c.sync = m;
    if (m.t === 'snap') c.snaps.push(m);
    if (m.t === 'battleConfig') c.battleConfig = m.config;
    if (m.t === 'error') log(`  [${name}] ⚠️ error: ${m.msg}`);
  });
  c.send = (m) => ws.send(JSON.stringify(m));
  c.wait = (pred, timeout = 5000) => new Promise((res, rej) => {
    const t0 = Date.now();
    const iv = setInterval(() => {
      const hit = pred(c);
      if (hit) { clearInterval(iv); res(hit); }
      else if (Date.now() - t0 > timeout) { clearInterval(iv); rej(new Error(`timeout: ${name}`)); }
    }, 30);
  });
  return new Promise((res) => ws.on('open', () => res(c)));
}

// Synthetic battlefield (synthetic lanes; near Taipei 101). L lanes, forts 1600xL apart
// (deliberately larger than the production 1000xL: reserves the AA safety margin for towers and high-altitude probes).
function fakeBattleConfig(L = 3) {
  const A = [25.0330, 121.5654];
  const D = 1600 * L, R = 6371000;
  // Geometry uses the true distance DxREAL_SCALE; sizeM/distM stay game-world meters = D.
  // sim.llToMeters scales by (1/REAL_SCALE) in sync, so server world coordinates match the pre-rescale system and assertions hold.
  const realD = D * MAPGEO.REAL_SCALE;
  const dLat = realD / R * 180 / Math.PI;
  const B = [A[0] + dLat, A[1]];
  const mid = [(A[0] + B[0]) / 2, (A[1] + B[1]) / 2];
  const mkLane = (off) => {
    const dLng = off / (R * Math.cos(A[0] * Math.PI / 180)) * 180 / Math.PI;
    const c = [mid[0], mid[1] + dLng];
    const pts = [];
    for (let t = 0; t <= 1.001; t += 0.05) {
      const u = 1 - t;
      pts.push([u * u * A[0] + 2 * u * t * c[0] + t * t * B[0], u * u * A[1] + 2 * u * t * c[1] + t * t * B[1]]);
    }
    return pts;
  };
  const offs = L === 1 ? [0] : L === 2 ? [0.3 * realD, -0.3 * realD] : [0.3 * realD, 0, -0.3 * realD];
  const sizeM = D / (0.85 * Math.SQRT2);
  return {
    center: { lat: mid[0], lng: mid[1] },
    bases: { SWARM: A, STEEL: B },
    lanes: offs.map(mkLane),
    sizeM, diagM: sizeM * Math.SQRT2, distM: D,
    geoScaleVer: MAPGEO.GEO_SCALE_VER,
    maxOverlap: 0.05, synthetic: true, placeName: '測試戰區',
    env: { season: 'summer', time: 'day', weather: 'clear' },
  };
}

/** Room integration uses a qualified preset; combat fixtures keep their deliberately oversized frame. */
function roomBattleConfig(L = 3) {
  const cfg = venueConfig(VENUES.find(v => v.id === 'berlin'), L === 1 ? 1 : L === 2 ? 3 : 5);
  cfg.placeName = '測試戰區';
  cfg.env = { season: 'summer', time: 'day', weather: 'clear' };
  return cfg;
}
// ================= direct sim checks (no WebSocket; deterministic verification of new mechanics) =================
log('— sim:角色系統(24 陣營角 + 8 傭兵 × 專屬武器/招式 × 三階;英雄 vs NPC 倍率)—');
{
  assert(charsOf('SWARM').length === 20 && charsOf('STEEL').length === 20, '雙陣營各 20 名可選角色(12 專屬 + 8 傭兵)');
  let dataOk = true, rangeOk = true, tierOk = true;
  for (const id of Object.keys(CHARACTERS)) {
    for (const slot of ['light', 'heavy']) {
      for (let lvl = 1; lvl <= 3; lvl++) {
        const w = heroWeapon(id, slot, lvl);
        if (!w || !(w.dmg > 0) || !(w.range > 0) || !(w.reload > 0) || !(w.mag > 0)) dataOk = false;
      }
      if (heroWeapon(id, slot, 3).dmg <= heroWeapon(id, slot, 1).dmg) tierOk = false;
    }
    for (const slot of ['def', 'atk']) {
      for (let lvl = 1; lvl <= 3; lvl++) {
        const a = heroAbility(id, slot, lvl);
        if (!a || !(a.cd > 0) || !(a.mp > 0)) dataOk = false;
      }
    }
    // #INC-104: e2e vertical fire from y=HI_ALT altitude needs light hero range x1.25 > HI_ALT (scales with COMBAT_SCALE)
    if (heroWeapon(id, 'light', 1).range * 1.25 <= HI_ALT) rangeOk = false;
  }
  assert(dataOk, '28 角 × 4 招 × 3 階資料完整(傷害/射程/CD/MP 皆為正值)');
  assert(tierOk, '三階升級傷害遞增');
  assert(rangeOk, `全部輕武器英雄射程 ×1.25 > ${HI_ALT}(高空射擊測試相容,#INC-104)`);
  // t03 light baseline 170 gives x1.2 = 204 below robot/drone rangeCap, so no clamp; verifies pure multiplier
  const wn = heroWeapon('t03', 'light', 1, false), wh = heroWeapon('t03', 'light', 1, true);
  assert(Math.abs(wh.range / wn.range - HEROIC.range) < 1e-9 && Math.abs(wh.dmg / wn.dmg - HEROIC.dmg) < 1e-9,
    `玩家英雄同型武器(未觸頂):射程 ×${HEROIC.range}、威力 ×${HEROIC.dmg}(vs NPC 基準)`);
}

log('— sim:玩家射程恆小於視野(rangeCap;重武器吃狙擊視角加成)—');
{
  let capOk = true, clamped = 0;
  for (const id of Object.keys(CHARACTERS)) {
    const kind = charKind(id);
    for (const slot of ['light', 'heavy']) {
      const w = heroWeapon(id, slot, 3);          // top tier must also stay within cap
      const cap = rangeCap(kind, slot);
      if (w.range > cap + 1e-9) capOk = false;
      if (CHARACTERS[id][slot].range * HEROIC.range > cap + 1e-9) clamped++;
    }
  }
  assert(capOk, '全角色輕/重武器射程 ≤ rangeCap(= 視野 × RANGE_SIGHT_F,重武器再 ×AIM_SIGHT_MULT)');
  assert(GAME.RANGE_SIGHT_F < 1, `RANGE_SIGHT_F = ${GAME.RANGE_SIGHT_F} < 1 ⇒ 射程一定小於視野`);
  assert(rangeCap('robot', 'heavy') > rangeCap('robot', 'light'),
    '重武器需開狙擊視角,射程上限跟著視野放大');
  assert(clamped > 0, `${clamped} 支武器被射程上限夾住(遠程狙擊不再打霧裡的東西)`);
  assert(heroWeapon('t01', 'light', 1).range * 1.25 > HI_ALT,
    `夾住後仍滿足 #INC-104(y=${HI_ALT} 高空垂直射擊)`);
}

log('— sim:機體混編陣營分佈(2026-08-02)+ 傭兵變形者雙型態 + 陣亡購買 —');
{
  const mercs = Object.keys(CHARACTERS).filter((id) => CHARACTERS[id].side === 'MERC');
  assert(mercs.length === 8, `傭兵 ${mercs.length} 名(雙陣營共用)`);
  assert(mercs.every((id) => charsOf('SWARM').includes(id) && charsOf('STEEL').includes(id)),
    '雙陣營角色池皆含傭兵');
  // Mixed hulls (user decision): side does not imply kind; all three sides field all three hull kinds.
  assert(Object.keys(CHARACTERS).every((id) => CHARACTERS[id].kind),
    '32 名角色一律顯式標註 kind(charKind MUST NOT 由 side 推機種)');
  const MIX = { SWARM: { drone: 7, robot: 3, morph: 2 }, STEEL: { drone: 3, robot: 7, morph: 2 },
    MERC: { drone: 2, robot: 2, morph: 4 } };
  for (const [side, want] of Object.entries(MIX)) {
    const got = { drone: 0, robot: 0, morph: 0 };
    for (const id of Object.keys(CHARACTERS)) if (CHARACTERS[id].side === side) got[charKind(id)]++;
    assert(['drone', 'robot', 'morph'].every((k) => got[k] === want[k]),
      `${side} 機體編制 無人機 ${got.drone}/機甲 ${got.robot}/變形機甲 ${got.morph}`
      + `(目標 ${want.drone}/${want.robot}/${want.morph})`);
  }
  // Hull designs map 1:1 -- 12 drones / 12 robots / 8 morphs, each design used by exactly one character
  const designOf = (id) => {
    const v = CHARACTERS[id].visual, k = charKind(id);
    if (k === 'drone') return v.form === 'avian' ? `avian:${v.creature}` : v.form === 'fixed' ? `fixed:${v.wing}` : `rotor:${v.frame}/${v.body}`;
    if (k === 'robot') return v.proto ? `proto:${v.proto}` : `${v.form}:${v.creature}`;
    return `${v.flight}/${v.ground}`;
  };
  for (const [k, n] of [['drone', 12], ['robot', 12], ['morph', 8]]) {
    const ds = Object.keys(CHARACTERS).filter((id) => charKind(id) === k).map(designOf);
    assert(ds.length === n && new Set(ds).size === n, `${k} 機體設計 ${new Set(ds).size}/${ds.length} 款不重複(應 ${n})`);
  }
  assert(UNITS.morph.hp === UNITS.robot.hp && UNITS.morph.shield === UNITS.robot.shield,
    `變形者 HP/護盾與機甲相同(${UNITS.morph.hp}/${UNITS.morph.shield})`);
  assert(Math.abs(heroWeapon('m01', 'light', 1, false).dmg - rawDmg('m01', 'light')) < 1e-6,
    '變形者傷害不吃小隊折算(火力同機甲)');
  const sim = new BattleSim(fakeBattleConfig(1));
  const a = sim.addHero('SWARM', 'p_ma', 'm01');
  const b = sim.addHero('STEEL', 'p_mb', 'm01');
  assert(a.kind === 'morph' && b.kind === 'morph', '傭兵受雇雙方機種一致(kind 綁角色不隨陣營)');
  assert(sim.squads.get('p_ma').bodies.length === 1, '變形者是單機(無三機小隊)');
  assert(a.maxHp === b.maxHp && a.armor === b.armor && a.maxSp === b.maxSp && a.maxMp === b.maxMp,
    `傭兵數值跨陣營一致(HP ${a.maxHp}/護甲 ${a.armor}/護盾 ${a.maxSp}/電力 ${a.maxMp})`);
  // Morph form follows reported height y: airborne (y>0) ignores mines, grounded (y near 0) triggers them
  const nMines0 = sim.mines.length;
  [b.x, b.z] = sim.mines[0];
  b.y = 30;
  sim.tick(0.125);
  assert(sim.mines.length === nMines0, '飛行型態(y=30)不觸發地雷');
  b.y = 0;
  sim.tick(0.125);
  assert(sim.mines.length === nMines0 - 1 && b.sp < b.maxSp, '地面型態(y=0)踩雷受創');
  // Dead heroes awaiting respawn can still buy (DOTA convention; fixes cannot-buy-while-dead at spawn)
  a.money = 999;
  sim._damage(a, 99999, null, 999);
  assert(a.dead, '測試前置:傭兵陣亡');
  assert(sim.buy('p_ma', 'hw') === null && a.upg.hw === 1, '陣亡等待重生仍可購買升級');
  assert(sim.buy('p_ma', 'hp') === null && a.hp === 0, '陣亡買裝甲強化只擴上限(重生才回滿)');
}

log('— sim:爆風不穿透橋面/隧道天花(#1 slab 垂直隔離;所有 AoE 攻擊共用 _slabSep)—');
{
  const sim = new BattleSim(fakeBattleConfig(1));
  purgeCamps(sim);
  // Inject one bridge-deck ribbon (ty=1) and one tunnel-ceiling ribbon (ty=2); sim coords kept clear of lanes and works to avoid stray fire
  const ox = 4000, oz = 4000;
  sim._ingestSlabs({ slabs: [
    [ox, oz, ox + 120, oz, 8, 1],              // Bridge deck: along x axis, half-width 8
    [ox, oz + 400, ox + 120, oz + 400, 8, 2],  // Tunnel ceiling: parallel to the other segment
  ] });
  assert(!!sim._slabGrid, 'slab 網格建立(_ingestSlabs)');
  // Target enemy hull (hero, explicit lev): placed directly below / same level / beside the blast point
  const mk = (x, z, lev) => sim._add({ kind: 'robot', side: 'STEEL', hero: true, dead: false,
    x, z, y: 0, hp: 600, armor: 0, sp: 0, maxSp: 0, lev, buffs: {}, mods: [] });
  const owner = sim.addHero('SWARM', 'p_bl', 'm01');   // Mercenary usable by both sides; blast is attributed to this owner
  const def = { dmg: 300, r: 40, pen: 0 };             // Radius 40 exceeds every probe distance
  const bx = ox + 60, bz = oz;                          // Blast point sits on the bridge ribbon
  // -- Bridge case: blast centered on deck (lev 1) --
  const onBridge = mk(bx, bz, 1);           // Same level (on deck) takes damage
  const underBridge = mk(bx, bz, 0);        // Ground directly below (lev 0) is shielded by deck: no damage
  const besideBridge = mk(bx, bz + 24, 0);  // Ground beside bridge (off-ribbon, outside half-width 8) still takes lateral spill damage
  sim._blast(owner, def, bx, bz, 0, 1);
  assert(onBridge.hp < onBridge.maxHp, '橋面爆風命中同層(橋上)目標');
  assert(underBridge.hp === underBridge.maxHp, '橋面爆風不穿透橋板打到正下方地面目標');
  assert(besideBridge.hp < besideBridge.maxHp, '橋旁地面(非正下方)仍受側向爆風(不誤擋)');
  // -- Tunnel case: blast centered inside (lev 2) --
  const tx = ox + 60, tz = oz + 400;
  const inTunnel = mk(tx, tz, 2);           // Same level inside takes damage
  const outTunnel = mk(tx, tz, 0);          // Outside (rock/ceiling blocks path) takes no damage
  sim._blast(owner, def, tx, tz, 0, 2);
  assert(inTunnel.hp < inTunnel.maxHp, '隧道內爆風命中同在洞內目標');
  assert(outTunnel.hp === outTunnel.maxHp, '洞內爆風不穿山體/天花波及洞外目標');
  // -- Regression: no slab uploaded (headless norm) means _slabSep passes everything, behavior unchanged --
  const bare = new BattleSim(fakeBattleConfig(1));
  const bareOwner = bare.addHero('SWARM', 'p_bl2', 'm01');
  const bareT = bare._add({ kind: 'robot', side: 'STEEL', hero: true, dead: false,
    x: 5000, z: 5000, y: 0, hp: 600, armor: 0, sp: 0, maxSp: 0, lev: 0, buffs: {}, mods: [] });
  bare._blast(bareOwner, def, 5000, 5000, 0, 1);
  assert(bareT.hp < bareT.maxHp, '未上傳 slab 時爆風不受層隔(headless 迴歸,確定性斷言不變)');
}

log('— sim:隧道側牆 LOS(_slabBlocked ①)—— 交疊 ribbon 沿軸出洞口不誤擋(2026-07-29 澀谷)—');
{
  const sim = new BattleSim(fakeBattleConfig(1));
  // Crossing twin tunnels (abstract Shibuya hairpin / overlapping corridor): A along x axis, B along z axis, crossing at (cx, cz)
  const ox = 4000, oz = 4000, cx = ox + 100, cz = oz;
  sim._ingestSlabs({ slabs: [
    [ox, oz, ox + 200, oz, 8, 2],                    // Tunnel A: along x axis, half-width 8
    [cx, oz - 100, cx, oz + 100, 8, 2],              // Tunnel B: along z axis, overlapping midspan of A
  ] });
  assert(!!sim._slabGrid, 'slab 網格建立(_ingestSlabs)');
  const IN = { hero: true, lev: 2 };                 // Inside end (client reports lev 2)
  const OUT = { hero: true, lev: 0 };                // Outside end (ground level)
  // 1: exit north portal along B axis from overlap: crosses A side wall but stays inside B corridor cavity, so allow (pre-fix ANY-match overblocked)
  assert(!sim._slabBlocked(cx, cz, cx, cz + 150, IN, OUT),
    '交疊區沿另一走廊軸出洞口:放行(隧道兵線對射不被岩盤誤吃)');
  assert(!sim._slabBlocked(cx, cz + 150, cx, cz, OUT, IN),
    '同一射線攻守互換同判(洞外 → 洞內沿軸):放行 = 洞內單位打得到也被打得到,無免傷掩體');
  // 2: diagonal exit from overlap: both A and B count as side walls, so still blocked (rock cover holds despite overlap)
  assert(sim._slabBlocked(cx, cz, cx + 50, cz + 40, IN, OUT), '交疊區斜向穿雙側牆:仍擋');
  assert(sim._slabBlocked(cx + 50, cz + 40, cx, cz, OUT, IN), '斜向穿雙側牆攻守互換同判:擋');
  // 3: single ribbon segment regression: behavior off overlap unchanged
  assert(sim._slabBlocked(ox + 30, oz, ox + 30, oz + 60, IN, OUT), '單一隧道側向穿出:擋(舊行為不變)');
  assert(!sim._slabBlocked(ox + 30, oz, ox - 60, oz, IN, OUT), '單一隧道沿軸出洞口:放行(舊行為不變)');
  // 4: neither end is lev 2 (other phase of lev jitter) skips side-wall rule (standing design: client lev is authoritative)
  assert(!sim._slabBlocked(cx, cz, cx + 50, cz + 40, OUT, OUT), 'lev 0↔0 不觸發側牆規則(行為不變)');
  // 5: _losBlocked wiring: slab check runs before obstacle grid, and still applies headless (no occ)
  assert(sim._losBlocked(cx, cz, 2, cx + 50, cz + 40, 2, IN, OUT), '_losBlocked 佈線:側牆擋通過 slab 路徑');
  assert(!sim._losBlocked(cx, cz, 2, cx, cz + 150, 2, IN, OUT), '_losBlocked 佈線:沿軸出洞口放行');
}

log('— sim:榴彈類最小射程 → 太近則無差別波及友軍 + 自損(2026-07-27)—');
{
  // 1: lobMinRange is derived: only trajClass 'lob' is nonzero (blast radius x LOB_MIN_F); all others are 0
  assert(lobMinRange({ type: 'launcher', r: 20 }) === 20 * BALLISTIC.LOB_MIN_F, 'lobMinRange:榴彈(launcher 無導引)= 爆風半徑 × LOB_MIN_F');
  assert(lobMinRange({ type: 'launcher', guide: 1, r: 20 }) === 0, 'lobMinRange:導引 launcher 不吃(trajClass guide,已有 ARMING)');
  assert(lobMinRange({ type: 'missile', r: 20 }) === 0, 'lobMinRange:飛彈不吃(trajClass fnf,自導武器)');
  assert(lobMinRange({ type: 'gun', r: 5 }) === 0, 'lobMinRange:直擊/輕武器不吃');
  assert(lobMinRange({ type: 'plasma', fan: true, r: 5 }) === 0, 'lobMinRange:扇形不吃');
  // 152 howitzer (t03) resolves to scalar def.r, so lobMinRange is well-defined and > 0
  assert(lobMinRange(heroWeapon('t03', 'heavy', 1)) > 0, 'lobMinRange:t03 152榴彈砲(解析後)> 0');

  const def = { dmg: 300, r: 40, pen: 0 };   // Radius 40: shooter, ally, and foe points all sit inside the blast
  // 2: friendly=true (impact near minimum range) damages foe, ally, and shooter alike
  const sim = new BattleSim(fakeBattleConfig(1));
  purgeCamps(sim);
  const owner = sim.addHero('STEEL', 'p_lob', 't01');
  owner.x = 4000; owner.z = 4000;   // Kept clear of works and lanes to isolate from other ents
  const ally = sim._add({ kind: 'soldier', side: 'STEEL', x: owner.x + 6, z: owner.z, y: 0, hp: UNITS.soldier.hp });
  const foe = sim._add({ kind: 'soldier', side: 'SWARM', x: owner.x + 6, z: owner.z + 6, y: 0, hp: UNITS.soldier.hp });
  const ohp0 = owner.hp + (owner.sp || 0);
  sim._blast(owner, def, owner.x, owner.z, 0, null, true);
  assert(owner.hp + (owner.sp || 0) < ohp0, '無差別模式:射手自身受創(自損)');
  assert(ally.hp < UNITS.soldier.hp, '無差別模式:友軍被波及(不分敵我)');
  assert(foe.hp < UNITS.soldier.hp, '無差別模式:敵方照樣受創');

  // 3: friendly=false (at or beyond minimum range, normal mode) harms only foes; allies and shooter stay safe (regression: plain grenade behavior unchanged)
  const sim2 = new BattleSim(fakeBattleConfig(1));
  purgeCamps(sim2);
  const owner2 = sim2.addHero('STEEL', 'p_lob2', 't01');
  owner2.x = 4000; owner2.z = 4000;
  const ally2 = sim2._add({ kind: 'soldier', side: 'STEEL', x: owner2.x + 6, z: owner2.z, y: 0, hp: UNITS.soldier.hp });
  const foe2 = sim2._add({ kind: 'soldier', side: 'SWARM', x: owner2.x + 6, z: owner2.z + 6, y: 0, hp: UNITS.soldier.hp });
  const ohp2 = owner2.hp + (owner2.sp || 0);
  sim2._blast(owner2, def, owner2.x, owner2.z, 0, null, false);
  assert(owner2.hp + (owner2.sp || 0) === ohp2, '正常模式:射手自身不受傷(同陣營濾除)');
  assert(ally2.hp === UNITS.soldier.hp, '正常模式:友軍不被波及');
  assert(foe2.hp < UNITS.soldier.hp, '正常模式:敵方受創(一般榴彈行為不變)');
}

log('— sim:AoE 彈頭在天上時的填彈訊息(2026-08-03「只有第一擊有傷害」)—');
{
  // Lobbed / fire-and-forget / laser-guided hits only report on impact, while the client sends reload as soon as the magazine runs dry
  // {t:'reload'} (sent at fire time, while that magazine's warheads are still airborne). Server reload is lazy
  // So heroReload without first settling the prior reload reads a stale ammo=0 as already done and pushes reloadUntil
  // out by a full reload; the next magazine then lands inside the reload window and is silently dropped, and the magazine never refills.
  const byTraj = {};
  for (const id of Object.keys(CHARACTERS)) {
    const w = heroWeapon(id, 'heavy', 1);
    if (w) (byTraj[trajClass(w)] ||= []).push(id);
  }
  assert(['lob', 'fnf', 'guide'].every((k) => byTraj[k]?.length), '三類 AoE 重武器都有現役角色');
  for (const cls of ['lob', 'fnf', 'guide']) {
    const ch = byTraj[cls][0];
    const side = charsOf('SWARM').includes(ch) ? 'SWARM' : 'STEEL';
    const sim = new BattleSim(fakeBattleConfig(1));
    purgeCamps(sim);
    const h = sim.addHero(side, 'p_ai', ch);
    h.x = 4000; h.z = 4000; h.y = 0; h.ay = 1.8; h.aiming = true; h.mp = 1e6;
    const w = sim._heroWeapon(h, 'heavy').def;
    const dist = w.range * 0.8, tx = h.x + dist, flight = shotFlightS(w, dist);
    // Replay the client event order: fire (sends reload) / impact (sends burst), fed to the server by arrival time
    const ev = [];
    let ammo = w.mag, reloadEnd = 0, t = 5, fired = 0;
    const SHOTS = w.mag * 3;   // Three magazines: the defect only surfaces from the second magazine on
    while (fired < SHOTS) {
      if (reloadEnd > 0 && t >= reloadEnd) { ammo = w.mag; reloadEnd = 0; }
      if (reloadEnd === 0 && ammo > 0) {
        ammo--; fired++;
        ev.push({ at: t + flight, kind: 'burst', n: fired });
        if (ammo <= 0) { reloadEnd = t + w.reload; ev.push({ at: t, kind: 'reload' }); }
        t += 1 / w.rate;
      } else t += 0.05;
    }
    ev.sort((a, b) => a.at - b.at || (a.kind === 'reload' ? -1 : 1));
    let dry = 0;
    for (const e of ev) {
      sim.t = e.at;
      if (e.kind === 'reload') { sim.heroReload('p_ai', 'heavy'); continue; }
      const tgt = sim._add({ kind: 'soldier', side: side === 'SWARM' ? 'STEEL' : 'SWARM', x: tx, z: h.z, y: 0, hp: 1e9 });
      sim.heroBurst('p_ai', tx, h.z, 0, 0);
      if (tgt.hp >= 1e9) dry++;
      sim.ents.delete(tgt.id);
    }
    assert(dry === 0, `${cls}(${ch} ${w.name}):${SHOTS} 發跨三個彈匣全數結算(靜默丟棄 ${dry} 發)`);
  }
  // Manual reload still works as before (this branch only adds settle-prior-reload first; MUST NOT break the R key)
  const sim = new BattleSim(fakeBattleConfig(1));
  purgeCamps(sim);
  const rb = sim.addHero('STEEL', 'p_ar', 't01');
  const wl = heroWeapon('t01', 'light', 1);
  sim.t = 10; rb.ammo.light = 1; rb.reloadUntil = {};
  sim.heroReload('p_ar', 'light');
  assert(rb.ammo.light === 0 && Math.abs(rb.reloadUntil.light - (10 + wl.reload)) < 1e-6, '主動填彈:半彈匣照樣重裝');
  // Expired prior reload means refill first, then apply magazine-full skips reload (must not defer the window again)
  sim.t = 30; rb.ammo.light = 0; rb.reloadUntil.light = 20;
  sim.heroReload('p_ar', 'light');
  assert(rb.ammo.light === wl.mag && rb.reloadUntil.light === 0, '填彈已完成:結清後視為滿彈匣,不再重新起算填彈窗');
}

log('— sim:射程球心 = 彈藥擊發的位置,後續機體的移動不影響(2026-08-05)—');
{
  // User decision: range hemisphere is measured from the firing position; later hull movement has no effect.
  // Client has always done this (projectile centered on b.origin); the old server impact gate used the hull current position,
  // while AoE warheads only report on impact -- a 45-degree full-range lob flies nearly 6s, during which the center followed the hull:
  // Backing off after firing silently dropped legal impacts (zero damage); pushing forward accepted out-of-range impacts (invisible range).
  const ch = Object.keys(CHARACTERS).find((id) => {
    const w = heroWeapon(id, 'heavy', 1);
    return w && trajClass(w) === 'lob';
  });
  const side = charsOf('SWARM').includes(ch) ? 'SWARM' : 'STEEL';
  const foe = side === 'SWARM' ? 'STEEL' : 'SWARM';
  /**
   * Fire at (4000, 4000+atFire), then retreat by away along z over the full flight time, then report impact at (4000, 4000+IMP).
   * trail=false means no trail is recorded (headless / legacy fallback path).
   */
  const shootThenMove = ({ away, trail = true, atFire = 0 }) => {
    const sim = new BattleSim(fakeBattleConfig(1));
    purgeCamps(sim);
    const h = sim.addHero(side, 'p_mv', ch);
    const w = sim._heroWeapon(h, 'heavy').def;
    const impCap = w.range * altRangeMax(w) * RANGE_TOL;
    const IMP = impCap * 0.9;                       // Impact: due north of firing position at 0.9x upper bound (legal)
    const flight = shotFlightS(w, IMP);
    h.x = 4000; h.z = 4000 + atFire; h.y = 0; h.ay = 1.8; h.aiming = true; h.mp = 1e6;
    sim.t = 50;
    if (trail) sim._trailPush(h);
    const steps = Math.max(1, Math.ceil(flight / 0.125));
    for (let k = 1; k <= steps; k++) {
      sim.t += 0.125;
      h.z = 4000 + atFire - away * (k / steps);
      if (trail) sim._trailPush(h);
    }
    const tgt = sim._add({ kind: 'soldier', side: foe, x: 4000, z: 4000 + IMP, y: 0, hp: 1e9 });
    h.ammo = {}; h.reloadUntil = {}; h.fireAt = {};
    sim.heroBurst('p_mv', 4000, 4000 + IMP, 0, 0);
    return { hit: tgt.hp < 1e9, impCap, flight };
  };
  const base = shootThenMove({ away: 0 });
  assert(base.hit, `原地不動:射程內的落點照常結算(飛行 ${base.flight.toFixed(1)}s)`);
  const AWAY = base.impCap * 1.2;                   // Retreat until measuring from the current position would exceed range
  assert(shootThenMove({ away: AWAY }).hit,
    `擊發後退 ${AWAY.toFixed(0)}m(當下位置量已超程)⇒ 傷害仍結算 —— 球心釘在擊發位置`);
  assert(!shootThenMove({ away: AWAY, trail: false }).hit,
    '反面對照:沒有軌跡 = 舊制以當下位置為球心 ⇒ 同一發被靜默丟棄');
  assert(!shootThenMove({ away: -AWAY, atFire: -base.impCap * 1.4 }).hit,
    '反向:擊發時就在射程外、飛行中衝進來 ⇒ 仍然丟棄(MUST NOT 給隱形射程)');
  // Trail is accounted by tick (samples truly connect); respawn teleport must not keep the previous life position
  {
    const sim = new BattleSim(fakeBattleConfig(1));
    purgeCamps(sim);
    const h = sim.addHero(side, 'p_tk', ch);
    h.x = 1234; h.z = 5678;
    sim.tick(0.125);
    assert(Array.isArray(h._trail) && h._trail[1] === 1234 && h._trail[2] === 5678,
      'sim.tick 一跑就記下這一格的位置(取樣點接上)');
    h.dead = true; h.respawnAt = sim.t;
    sim._respawn(h);
    assert(h._trail == null, '重生清軌跡(瞬移;否則落點閘門會回推到上一條命的位置)');
  }
}

log('— sim:扇形錐緣量到命中量體(2026-08-03「打得到一般單位、但不到建築」)—');
{
  const sim = new BattleSim(fakeBattleConfig(1));
  purgeCamps(sim);
  const ch = Object.keys(CHARACTERS).find((id) => heroWeapon(id, 'heavy', 1)?.fan);
  const side = charsOf('SWARM').includes(ch) ? 'SWARM' : 'STEEL';
  const foe = side === 'SWARM' ? 'STEEL' : 'SWARM';
  const h = sim.addHero(side, 'p_fan', ch);
  h.x = 4000; h.z = 4000; h.y = 0; h.ay = 1.8; h.aiming = true; h.mp = 1e6;
  const w = sim._heroWeapon(h, 'heavy').def;
  /** From gap meters outside the volume surface, aim at the wall point offset f x volume angular size from center: how much this spray deals */
  const spray = (kind, f, gap = 5) => {
    const hr = hitR({ kind, side: foe });
    const d2 = hr + gap;
    const th = Math.asin(Math.min(1, hr / d2)) * f;
    const e = sim._add({ kind, side: foe, x: h.x + d2, z: h.z, y: 0, hp: 1e9 });
    sim.t += 10; h.fireAt = {}; h.ammo = {}; h.reloadUntil = {};
    sim.heroPlasma('p_fan', Math.cos(th), Math.sin(th), 'heavy', null);
    const dealt = 1e9 - e.hp;
    sim.ents.delete(e.id);
    return dealt;
  };
  for (const kind of ['tower', 'base']) {
    assert(spray(kind, 0) > 0, `${kind}:準星壓在牆面正中 → 有傷害(迴歸)`);
    assert(spray(kind, 0.9) > 0, `${kind}:準星壓在牆面邊緣(中心遠在錐外)→ 仍有傷害`);
    // Volume only widens hit eligibility; MUST NOT raise damage on large targets with it
    assert(spray(kind, 0.9) <= spray(kind, 0) + 1e-9, `${kind}:靠量體才進錐 → 吃錐緣保底,不高於正中`);
  }
  // Outside the volume the old rule stands: soldiers outside the cone still miss
  // Under fan subdivision, a close soldier angular size spans several bins, so one target takes multiple hits; per-bin damage still equals the centered amount
  // (Volume only widens hit eligibility without inflating per-bin damage -- binned version of the 2026-08-03 invariant).
  const sd = hitR({ kind: 'soldier', side: foe });
  const s0 = spray('soldier', 0), s09 = spray('soldier', 0.9);
  const awS = Math.atan2(sd, sd + 5);
  const n0 = fanBinSpan(w, 0, awS), n09 = fanBinSpan(w, Math.asin(Math.min(1, sd / (sd + 5))) * 0.9, awS);
  const perBin0 = s0 / (n0[1] - n0[0] + 1), perBin09 = s09 / (n09[1] - n09[0] + 1);
  assert(s0 > 0 && s09 > 0 && Math.abs(perBin0 - perBin09) < 1e-9,
    `小兵(hitR ${sd}):單格傷害不受量體/瞄準偏移影響(${perBin0.toFixed(1)} = ${perBin09.toFixed(1)};格數 ${n0} vs ${n09})`);
  const far = sim._add({ kind: 'soldier', side: foe, x: h.x + 40, z: h.z + 60, y: 0, hp: 1e9 });
  sim.t += 10; h.fireAt = {}; h.ammo = {}; h.reloadUntil = {};
  sim.heroPlasma('p_fan', 1, 0, 'heavy', null);
  assert(far.hp === 1e9, `錐外(56°)的小兵一發都不掉血 —— 量體張角 ${(Math.atan2(sd, 72) * 180 / Math.PI).toFixed(1)}° 撐不開這個錐`);
}

log('— sim:地雷佈設(非正規路線)+ 機甲踩雷 —');
{
  const sim = new BattleSim(fakeBattleConfig(1));
  purgeCamps(sim);
  assert(sim.mines.length >= 20, `地雷 ${sim.mines.length} 顆(目標 ${GAME.MINES.PER_LANE}/線)`);
  assert(sim.mines.every(([x, z]) => sim._distToLanes(x, z) >= GAME.MINES.LANE_CLEAR), '雷區避開兵線走廊');
  const rb = sim.addHero('STEEL', 'p_r', 't01');   // Winter General (light weapon has no crit, so damage is deterministic)
  const nMines = sim.mines.length;
  [rb.x, rb.z] = sim.mines[0];
  sim.tick(0.125);
  assert(rb.sp < rb.maxSp && sim.mines.length === nMines - 1,
    `機甲踩雷受創(護盾 ${rb.maxSp} → ${Math.round(rb.sp)},雷被消耗)`);
  assert(sim.events.some((e) => e.e === 'boom' && e.mine && e.tpid === 'p_r'), '地雷爆炸事件帶 tpid');
  assert(sim.events.some((e) => e.e === 'boom' && e.mine && e.mid != null), '地雷爆炸事件帶 mid(客戶端移除微凸起)');
  assert(sim.fieldPayload().mines.every((m) => m.length === 3), 'fieldPayload 地雷格式 [x,z,id]');

  log('— sim:武器克制 × 護甲減免 + 彈夾上限 —');
  // Since 2026-07-25 every weapon crit rate is at least 5 percent (see data.VITALS.CRIT_MIN); t01 light is no longer crit:0, so
  // these two deterministic-damage assertions stub Math.random to never trigger crit or dodge (0.999 above any crit at or below 0.28).
  const _rnd0 = Math.random; Math.random = () => 0.999;
  const wl = heroWeapon('t01', 'light', 1);
  const dummy = sim._add({ kind: 'soldier', side: 'SWARM', x: rb.x + 10, z: rb.z, hp: UNITS.soldier.hp });
  sim.t += 1;   // Step past the rate-of-fire floor
  sim.heroHit('p_r', dummy.id);
  const expSoldier = wl.dmg * 1.3 * armorMul(UNITS.soldier.armor, wl.pen);
  assert(Math.abs((UNITS.soldier.hp - dummy.hp) - expSoldier) < 0.5,
    `克制傷害 ${(UNITS.soldier.hp - dummy.hp).toFixed(1)}(= ${wl.dmg} × 肉體 1.3 × 護甲減免)`);
  sim.ents.delete(dummy.id);   // Test dummy has no lane; remove before tick
  const tw = [...sim.ents.values()].find((e) => e.kind === 'tower' && e.side === 'SWARM');
  rb.x = tw.x + 30; rb.z = tw.z;
  rb.ammo = {}; rb.fireAt = {}; rb.reloadUntil = {};   // Reset ammo counters
  const hp0t = tw.hp;
  // Step and extra-shot counts MUST derive from the resolved weapon (after the 2026-08-02 rate compression, hardcoded seconds silently break:
  // the hardcoded 0.16s was the lenient rate gate at rate 4.5; once rate drops to 3.28 every second shot is rejected).
  const step = 1 / wl.rate;                                       // Always wider than the lenient gate (gate = 1/(rate x 1.5))
  const extra = Math.max(1, Math.floor(wl.reload / step) - 1);    // Extra shots all land inside the reload window, so all are rejected
  const shots = wl.mag + extra;   // Fired before reload completes (only one magazine gets through)
  for (let i = 0; i < shots; i++) { sim.t += step; sim.heroHit('p_r', tw.id); }
  const magDmg = hp0t - tw.hp;
  // Building multiplier MUST derive from the resolved weapon (since 2026-08-04 building-DPS convergence made vs.building derived --
  // a hardcoded 0.6 silently breaks when the convergence factor moves; this section really verifies only-one-magazine throughput).
  const vsB = vsMult(wl, 'tower');
  const expMag = wl.mag * wl.dmg * vsB * armorMul(UNITS.tower.armor, wl.pen);
  assert(Math.abs(magDmg - expMag) < 1,
    `${shots} 連發只吃進一個彈夾 ${wl.mag} 發 × 建築 ${vsB.toFixed(3)} × 護甲減免(傷害 ${magDmg.toFixed(1)},其餘填彈中被拒)`);

  log('— data:攻擊範圍收斂(一發打不到兩座塔;2026-08-02 使用者定案)—');
  {
    // User decision: light and heavy weapons shrink blast coverage; except range-specialist weapons, none should hit two towers at once.
    // Geometry is fully derived: same-site tower gap = 2 x TOWER_SIDE_OFF, distance measured to the hit volume surface, blast falls to zero at r x EDGE.
    const half = towerPairSepM() / 2, R = TARGET_R.tower;
    const twoTowers = (r) => {
      for (let c = 0; c <= half; c += 0.1)
        if (blastFalloff(r, Math.max(0, Math.abs(half - c) - R)) > 0
          && blastFalloff(r, Math.max(0, half + c - R)) > 0) return true;
      return false;
    };
    assert(Math.abs(towerPairSepM() - 2 * GAME.TOWER_SIDE_OFF) < 1e-9
      && Math.abs(soloBlastRmax() - (half - R) / 1.8) < 1e-9,
      `同塔位塔距 ${towerPairSepM()}m、爆風半徑上限 ${soloBlastRmax().toFixed(2)}m(推導不手寫)`);
    const MAXT = 1 + ECON.UPGRADES.hw.max;
    const bad = [], areaMiss = [];
    for (const ch of Object.keys(CHARACTERS)) for (const slot of ['light', 'heavy']) {
      const w = heroWeapon(ch, slot, MAXT, true);
      if (!w || aoeClass(w) !== 'blast') continue;
      if (AREA_WEAPONS[`${ch}.${slot}`]) { if (!twoTowers(w.r)) areaMiss.push(`${ch}.${slot}`); }
      else if (twoTowers(w.r)) bad.push(`${ch}.${slot}`);
    }
    assert(bad.length === 0, `非「範圍見長」的爆炸型武器滿級(Lv${MAXT})一發打不到兩座塔(違規 ${bad.join('、') || '無'})`);
    // 2026-08-04 user decision grenade types must never hit two turrets at once means the three listed grenade weapons were all removed,
    // now empty. The list stays the only named exemption seam: once someone adds a name, that weapon MUST truly hit two towers
    // (otherwise the list is just a comment), so both directions are verified.
    assert(areaMiss.length === 0,
      `範圍見長名冊 ${Object.keys(AREA_WEAPONS).length} 把,每一把都仍打得到兩座塔(名冊不是裝飾)`);
    // Compensation is redistribution, not inflation: geometric mean of the compensation factors = 1
    const trimmed = [];
    for (const ch of Object.keys(CHARACTERS)) for (const slot of ['light', 'heavy'])
      if (CHARACTERS[ch][slot]?._aoeRaw) trimmed.push(CHARACTERS[ch][slot]);
    const geo = Math.exp(trimmed.reduce((a, w) => a + Math.log(aoeTrimF(w)), 0) / trimmed.length);
    assert(trimmed.length > 0 && Math.abs(geo - 1) < 1e-12,
      `被夾過的 ${trimmed.length} 把武器,火力補償幾何平均 = 1(重分配,不是整批加強)`);
    // Three-axis budget: higher mobility/range means lower base firepower; unclamped weapons keep range compensation at x1
    const fast = Object.keys(CHARACTERS).reduce((a, c) => (mobDmgF(c) < mobDmgF(a) ? c : a));
    const slow = Object.keys(CHARACTERS).reduce((a, c) => (mobDmgF(c) > mobDmgF(a) ? c : a));
    assert(mobDmgF(fast) < 1 && mobDmgF(slow) > 1,
      `機動預算:最快 ${fast} ×${mobDmgF(fast).toFixed(3)} < 1 < 最慢 ${slow} ×${mobDmgF(slow).toFixed(3)}`);
    const far = Object.keys(CHARACTERS).reduce((a, c) => (rngDmgF(c, 'heavy') < rngDmgF(a, 'heavy') ? c : a));
    assert(rngDmgF(far, 'heavy') < 1,
      `射程預算:重武器射程最長的 ${far} 基礎火力 ×${rngDmgF(far, 'heavy').toFixed(3)} < 1`);
    assert(Object.keys(CHARACTERS).every((c) => ['light', 'heavy'].every((s) => {
      const w = CHARACTERS[c][s];
      return !w || w._aoeRaw || aoeTrimF(w) === 1;
    })), '沒被夾過的武器範圍補償恆 ×1(fan/line/名冊內的角色逐位元不受影響)');
    // Blast family band (2026-08-04 user decision): grenade types short range at full cap; guided types long range and always smaller
    const fam = { lob: [], guided: [] };
    for (const ch of Object.keys(CHARACTERS)) {
      const d1 = heroWeapon(ch, 'heavy', 1, true);
      if (aoeClass(d1) !== 'blast') continue;
      const f = blastFamily(trajClass(d1));
      for (let lv = 1; lv <= MAXT; lv++) fam[f].push(heroWeapon(ch, 'heavy', lv, true).r);
    }
    assert(fam.lob.length > 0 && fam.guided.length > 0
      && Math.max(...fam.guided) < Math.max(...fam.lob)
      && Math.min(...fam.guided) < Math.min(...fam.lob),
      `導引類爆風 ${Math.min(...fam.guided).toFixed(2)}~${Math.max(...fam.guided).toFixed(2)}m`
      + ` 恆小於榴彈類 ${Math.min(...fam.lob).toFixed(2)}~${Math.max(...fam.lob).toFixed(2)}m(逐階,含 Lv${MAXT} 外推)`);
    const heavyR = Object.keys(CHARACTERS).map((ch) => heroRange(ch, 'heavy'));
    const minHeavyR = Math.min(...heavyR);
    const lobChs = Object.keys(CHARACTERS).filter((ch) => trajClass(heroWeapon(ch, 'heavy', 1, true)) === 'lob');
    assert(lobChs.length > 0 && lobChs.every((ch) => Math.abs(heroRange(ch, 'heavy') - minHeavyR) < 1e-9),
      `榴彈類 ${lobChs.length} 把射程 = 全體重武器最短的那一帶 ${minHeavyR.toFixed(1)}m`);
  }

  log('— data:對建築 DPS 收斂(2026-08-04 使用者定案「重武器/輕武器之間落差不要太大」)—');
  {
    for (const [slot, rail] of [['light', 2.0], ['heavy', 3.2]]) {
      const chs = Object.keys(CHARACTERS).filter((ch) => CHARACTERS[ch][slot]);
      const now = chs.map((ch) => buildDps(ch, slot));
      // Control = spread when this axis is inert (all vs.building neutral) -- convergence MUST be tighter than it
      const flat = chs.map((ch) => buildDps(ch, slot) / (CHARACTERS[ch][slot].vs?.building ?? 1));
      const sp = (v) => Math.max(...v) / Math.min(...v);
      assert(sp(now) <= rail && sp(now) < sp(flat),
        `${slot} 對建築 DPS 離散度 ${sp(now).toFixed(2)}× ≤ ${rail}×,且緊於中性對照 ${sp(flat).toFixed(2)}×`);
      assert(chs.every((ch) => {
        const v = CHARACTERS[ch][slot].vs?.building ?? 1;
        return v > 0 && v <= BUILDING_VS_CAP + 1e-9;
      }), `${slot} 每一把的 vs.building ∈ (0, ${BUILDING_VS_CAP}](上夾不得為了收斂而放寬)`);
    }
  }

  log('— sim/data:流體沉浸異常狀態整合(水域 1/2、沼澤 1/4;減傷/減速/飛行動力/電力/護盾)—');
  {
    // 1: trigger rule: normally fully submerged (footY + bodyH < planeY); partially submerged on frozen snow (footY < planeY)
    assert(envTrigger(1, 0, -10, 6) === 1, '水域:機頂高 -4 < 水面 0 觸發沉浸(wet=1)');
    assert(envTrigger(1, 0, -5, 6) === 0, '水域:機頂高 1 >= 水面 0 未完全沉浸(wet=0)');
    assert(envTrigger(2, 0, -1, 3) === 2, '沼澤:機頂高 2 < 沼面 2.2 觸發沉浸(wet=2)');
    assert(envTrigger(2, 0, 0, 3) === 0, '沼澤:機頂高 3 >= 沼面 2.2 未完全沉浸(wet=0)');
    assert(envTrigger(0, 0, -10, 6) === 0, '乾地:不觸發異常狀態(wet=0)');
    assert(envTrigger(1, 0, -1, 6, true) === 3, '結冰水域:腳高 -1 < 水面 0 部分沒入觸發凍結(wet=3)');
    assert(envTrigger(1, 0, 0, 6, true) === 0, '結冰水域:腳高 0 >= 水面 0 站立於冰面上(wet=0)');
    assert(envTrigger(2, 0, 1.5, 3, true) === 3, '結冰沼澤:腳高 1.5 < 沼面 2.2 部分沒入觸發凍結(wet=3)');
    assert(envTrigger(2, 0, 2.2, 3, true) === 0, '結冰沼澤:腳高 2.2 >= 沼面 2.2 站立於冰面上(wet=0)');

    // 2: fluidFactor single-source-of-truth seam values
    assert(fluidFactor(0) === 1.0, '正常狀態倍率 = 1.0');
    assert(fluidFactor(1) === 0.5, '水域沉浸倍率 = 1/2 (0.5)');
    assert(fluidFactor(2) === 0.25, '沼澤沉浸倍率 = 1/4 (0.25)');
    assert(fluidFactor(3) === 0.125, '凍結異常狀態倍率 = 1/8 (0.125)');

    // 3: damage taken halved / cut to 1/4 (server _damage authoritative settlement)
    const testSim = new BattleSim(fakeBattleConfig(1));
    purgeCamps(testSim);
    const heroDry = testSim.addHero('STEEL', 'h_dry', 't01');
    const heroWater = testSim.addHero('STEEL', 'h_water', 't01');
    const heroSwamp = testSim.addHero('STEEL', 'h_swamp', 't01');
    const heroFrozen = testSim.addHero('STEEL', 'h_frozen', 't01');
    heroDry.wet = 0; heroWater.wet = 1; heroSwamp.wet = 2; heroFrozen.wet = 3;
    heroDry.sp = 500; heroWater.sp = 500; heroSwamp.sp = 500; heroFrozen.sp = 500;
    heroDry.maxSp = 500; heroWater.maxSp = 500; heroSwamp.maxSp = 500; heroFrozen.maxSp = 500;
    heroFrozen.hp = 100; heroFrozen.maxHp = 100;
    testSim._damage(heroDry, 100, null, 0);
    testSim._damage(heroWater, 100, null, 0);
    testSim._damage(heroSwamp, 100, null, 0);
    const dmgDry = 500 - heroDry.sp;
    const dmgWater = 500 - heroWater.sp;
    const dmgSwamp = 500 - heroSwamp.sp;
    assert(Math.abs(dmgDry - 100) < 1e-6, `乾地受傷全額(100)`);
    assert(Math.abs(dmgWater - 50) < 1e-6, `水域沉浸受傷減至 1/2 (${dmgWater} = 100 × 0.5)`);
    assert(Math.abs(dmgSwamp - 25) < 1e-6, `沼澤沉浸受傷減至 1/4 (${dmgSwamp} = 100 × 0.25)`);

    // 4: power regen and shield out-of-combat recovery rate
    heroDry.mp = 0; heroWater.mp = 0; heroSwamp.mp = 0;
    heroDry.sp = 0; heroWater.sp = 0; heroSwamp.sp = 0;
    heroDry.lastHitAt = -100; heroWater.lastHitAt = -100; heroSwamp.lastHitAt = -100; // Out of combat
    testSim.t = 10;
    testSim.tick(1.0); // Step 1 second
    assert(Math.abs(heroWater.mp / (heroDry.mp || 1) - 0.5) < 0.05, `水域沉浸電力回充速度減至 1/2 (實得 ${heroWater.mp.toFixed(1)} vs 乾地 ${heroDry.mp.toFixed(1)})`);
    assert(Math.abs(heroSwamp.mp / (heroDry.mp || 1) - 0.25) < 0.05, `沼澤沉浸電力回充速度減至 1/4 (實得 ${heroSwamp.mp.toFixed(1)} vs 乾地 ${heroDry.mp.toFixed(1)})`);
    assert(Math.abs(heroWater.sp / (heroDry.sp || 1) - 0.5) < 0.05, `水域沉浸護盾回復速度減至 1/2 (實得 ${heroWater.sp.toFixed(1)} vs 乾地 ${heroDry.sp.toFixed(1)})`);
    assert(Math.abs(heroSwamp.sp / (heroDry.sp || 1) - 0.25) < 0.05, `沼澤沉浸護盾回復速度減至 1/4 (實得 ${heroSwamp.sp.toFixed(1)} vs 乾地 ${heroDry.sp.toFixed(1)})`);

    // 5: frozen status: keeps draining HP until death
    assert(heroFrozen.hp < 100 && heroFrozen.sp < 500, '凍結異常狀態(wet=3)在 tick 中持續扣除 HP 與護盾');
    // Step until drained to death
    testSim.tick(20.0);
    assert(heroFrozen.dead || heroFrozen.hp <= 0, '凍結異常狀態持續扣血至死');

    // 6: flight power recovery
    const regenDry = liftRegen(10, 0) * fluidFactor(0);
    const regenWater = liftRegen(10, 0) * fluidFactor(1);
    const regenSwamp = liftRegen(10, 0) * fluidFactor(2);
    const regenFrozen = liftRegen(10, 0) * fluidFactor(3);
    assert(Math.abs(regenWater / regenDry - 0.5) < 1e-9 && Math.abs(regenSwamp / regenDry - 0.25) < 1e-9 && Math.abs(regenFrozen / regenDry - 0.125) < 1e-9,
      `飛行動力回充速度:水域 1/2 (${regenWater})、沼澤 1/4 (${regenSwamp})、凍結 1/8 (${regenFrozen})`);
  }

  log('— sim/data:建築加乘移除 + 護盾分軌剋制(2026-08-02 使用者定案)—');
  {
    // 1: buildings drop all bonuses and keep penalties: every weapon/ability vs.building is at most 1, and some are below 1
    const over = [];
    for (const [id, c] of Object.entries(CHARACTERS))
      for (const s of ['light', 'heavy', 'def', 'atk'])
        if (c[s]?.vs?.building > BUILDING_VS_CAP) over.push(`${id}.${s}=${c[s].vs.building}`);
    for (const [k, w] of Object.entries(WEAPONS))
      if (w.vs?.building > BUILDING_VS_CAP) over.push(`WEAPONS.${k}=${w.vs.building}`);
    assert(!over.length, `全武器/招式對建築一律無加乘(違規:${over.join(' ') || '無'})`);
    assert(Object.values(CHARACTERS).some((c) => c.heavy?.vs?.building < 1),
      '懲罰保留:仍有武器 vs.building < 1(防空/反甲特化拆建築照樣吃虧)');

    // 2: neutral params restore the old system bit-identically (weapons without the new knobs MUST be fully unaffected)
    for (const [dmg, sp] of [[100, 250], [100, 40], [100, 0]]) {
      const r = shieldSplit({}, dmg, sp);
      assert(Math.abs(r.toSp - Math.min(sp, dmg)) < 1e-9
        && Math.abs(r.toHp - (dmg - Math.min(sp, dmg))) < 1e-9,
        `中性武器 dmg${dmg}/盾${sp}:護盾 ${r.toSp}、裝甲 ${r.toHp}(同舊制「先扣盾、溢出進甲」)`);
    }

    // 3: anti-shield: shields lose extra; overflow on shield break folds back by budget (MUST NOT pour spilled shield damage straight into armor)
    const anti = { vsSp: 2, vsHp: 0.5 };
    const a1 = shieldSplit(anti, 100, 1000);
    assert(a1.toSp === 200 && a1.toHp === 0, `反護盾打滿盾:護盾 -${a1.toSp}(×2)、裝甲 -${a1.toHp}`);
    const a2 = shieldSplit(anti, 100, 100);
    assert(Math.abs(a2.toSp - 100) < 1e-9 && Math.abs(a2.toHp - 25) < 1e-9,
      `反護盾打穿盾:護盾 -${a2.toSp}、剩餘 50 點預算 ×vsHp 0.5 = 裝甲 -${a2.toHp}(不是把溢出的 100 倒進去)`);

    // 4: shield-pierce: even full shields always leak blood; leaked amount = pierce fraction x vsHp
    const p1 = shieldSplit({ spPierce: 0.5, vsHp: 0.8 }, 100, 1000);
    assert(Math.abs(p1.toSp - 50) < 1e-9 && Math.abs(p1.toHp - 40) < 1e-9,
      `穿盾打滿盾仍見血:護盾 -${p1.toSp}、裝甲 -${p1.toHp}(50 穿透 × 0.8)`);

    // 5: vsSp=0 degrades to full-block by shield rather than ignoring the shield (rule 6: bias toward shield effectiveness)
    const bk = shieldSplit({ vsSp: 0 }, 100, 1000);
    assert(bk.toSp === 0 && bk.toHp === 0, 'vsSp=0 = 打不動護盾、也穿不過去(盾全擋)');

    // 6: character tags derive from knobs (codex use; neutral weapons carry no tags)
    assert(shieldRoleName({}) === '' && shieldRoleName({ vsSp: 1.7, vsHp: 0.7 }) === '反護盾'
      && shieldRoleName({ spPierce: 0.5 }) === '穿盾' && shieldRoleName({ vsSp: 0.7, vsHp: 1.2 }) === '反裝甲',
      '護盾軸標籤 ← 旋鈕推導(反護盾 / 穿盾 / 反裝甲;中性武器空字串)');

    // 7: true BattleSim _damage check: the same 200 damage lands differently on hero dual-layer HP across the three types.
    //    Borrow the existing rb (MUST NOT addHero then delete -- that leaves dangling refs between heroes/squad,
    //    and the next tick _promote blows up). Restore hp/sp/hit timestamps for later assertions after measuring.
    const keep = { sp: rb.sp, hp: rb.hp, at: rb.lastHitAt };
    const hitBy = (wd) => {
      rb.sp = rb.maxSp; rb.hp = rb.maxHp; rb.lastHitAt = -999;
      sim._damage(rb, 100, null, 0, 0, wd);
      return { sp: rb.maxSp - rb.sp, hp: rb.maxHp - rb.hp };
    };
    const dN = hitBy(null), dA = hitBy({ vsSp: 1.7, vsHp: 0.7 }), dP = hitBy({ spPierce: 0.5, vsHp: 0.9 });
    assert(dA.sp > dN.sp, `反護盾削盾更快(護盾 ${dN.sp.toFixed(0)} → ${dA.sp.toFixed(0)})`);
    assert(dN.hp === 0 && dP.hp > 0,
      `穿盾:中性武器打滿盾目標裝甲 0 傷,穿盾武器仍打進 ${dP.hp.toFixed(1)}`);
    rb.sp = keep.sp; rb.hp = keep.hp; rb.lastHitAt = keep.at;

    // 8: weaker damage to main HP also holds for shieldless NPCs (hero-only would be a hidden second rule set)
    const npc = sim._add({ kind: 'soldier', side: 'STEEL', x: rb.x + 40, z: rb.z, hp: UNITS.soldier.hp });
    sim._damage(npc, 100, null, 0, 0, { vsHp: 0.5 });
    const weak = UNITS.soldier.hp - npc.hp;
    npc.hp = UNITS.soldier.hp;
    sim._damage(npc, 100, null, 0, 0, null);
    const full = UNITS.soldier.hp - npc.hp;
    assert(Math.abs(weak - full * 0.5) < 1e-6,
      `NPC 也吃 vsHp:弱化 ${weak.toFixed(1)} = 中性 ${full.toFixed(1)} × 0.5`);
    sim.ents.delete(npc.id);

    // 9: config triple discipline (2026-08-02): 1 pierce/anti-armor only rides on weapons that had building bonuses
    //    2 anti-shield takes no other unit bonus; 3 broader and stronger bonuses mean lower base damage
    const flagged = [];
    for (const [id, c] of Object.entries(CHARACTERS))
      for (const s of ['light', 'heavy'])
        if (c[s] && ((c[s].vsSp ?? 1) !== 1 || (c[s].vsHp ?? 1) !== 1 || (c[s].spPierce || 0) !== 0))
          flagged.push([`${id}.${s}`, c[s]]);
    const roster = new Set(EX_SIEGE_WEAPONS);
    const siege = flagged.filter(([, w]) => (w.spPierce || 0) > 0 || (w.vsHp ?? 1) > 1);
    assert(siege.length > 0 && siege.every(([k]) => roster.has(k)),
      `紀律①:穿盾/反裝甲 ${siege.length} 把全在 EX_SIEGE_WEAPONS 名冊內(${siege.map(([k]) => k).join(' ')})`);
    const antiList = flagged.filter(([, w]) => (w.vsSp ?? 1) > 1);
    assert(antiList.length > 0 && antiList.every(([, w]) => !Object.values(w.vs || {}).some((v) => v > 1)),
      `紀律②:反護盾 ${antiList.length} 把的 vs 表無任何加成(${antiList.map(([k]) => k).join(' ')})`);
    assert(flagged.every(([, w]) => counterDmgF(w) < 1),
      '紀律③:掛旗標的武器基礎傷害一律吃折減');
    assert(Math.max(...antiList.map(([, w]) => counterDmgF(w)))
      < Math.min(...flagged.filter(([, w]) => (w.vsSp ?? 1) <= 1 && !(w.spPierce > 0)).map(([, w]) => counterDmgF(w))),
      '紀律③:廣泛性加成(反護盾)的折減重於只挑一層的反裝甲');
    // Weapons without flags MUST stay bit-identical (this is fine-tuning, not a full-table repricing)
    assert(counterDmgF(CHARACTERS.s02.heavy) === 1 && counterDmgF(CHARACTERS.t12.heavy) === 1,
      '未掛護盾軸的武器折減恆 ×1(其餘 28 名角色傷害逐位元不變)');
  }

  log('— sim:射程閘門量到目標「近側表面」(_surfD3 = d3 − hitR;射程邊界打建築不再被靜默丟棄)—');
  {
    const rr = hitR(tw);
    assert(rr >= 7, `砲塔水平量體 hitR = ${rr}m(彈著停在牆面,離中心就是這麼遠)`);
    rb.ammo = {}; rb.fireAt = {}; rb.reloadUntil = {};
    // Surface just inside the x1.25 tolerance (center distance = range x1.25 + hitR - 1): old center-based measure silently dropped this shot
    rb.x = tw.x + wl.range * 1.25 + rr - 1; rb.z = tw.z;
    const hpEdge = tw.hp;
    sim.t += 1;
    sim.heroHit('p_r', tw.id);
    assert(tw.hp < hpEdge, '表面在 ×1.25 寬容內(中心超界)命中(舊制以中心量距在此靜默丟棄)');
    // Surface beyond the x1.25 tolerance is still silently dropped (anti-cheat cap does not stretch with hitR)
    rb.x = tw.x + wl.range * 1.25 + rr + 5;
    const hpOut = tw.hp;
    sim.t += 1;
    sim.heroHit('p_r', tw.id);
    assert(tw.hp === hpOut, '表面超出 ×1.25 寬容仍被靜默丟棄(射程上限不動)');
  }

  log('— sim:範圍攻擊偏心傷害遞減(fan 扇形:偏離錐軸線性遞減到 AOE_EDGE;line 見 audit_lance_hit)—');
  {
    const fanCh = Object.keys(CHARACTERS).find((c) => heroWeapon(c, 'light', 1)?.fan);
    assert(!!fanCh, `有扇形輕武器角色可測(${fanCh})`);
    const wf = heroWeapon(fanCh, 'light', 1, true);
    const fh = sim.addHero('SWARM', 'p_f', fanCh);
    fh.x = 700; fh.z = 700; fh.y = 0;   // Kept clear of lanes and towers to avoid stray fire
    const arc = (wf.arc || 15) * Math.PI / 180;
    const mkT = (ang) => sim._add({ kind: 'soldier', side: 'STEEL',
      x: fh.x + 30 * Math.sin(ang), z: fh.z + 30 * Math.cos(ang), y: 0, hp: 99999 });
    const tc = mkT(0), te = mkT(arc * 0.8);   // On cone axis / 80 percent to cone edge (same distance; damage no longer varies with distance)
    sim.t += 5;
    sim.heroPlasma('p_f', 0, 1, 'light');
    const dc = 99999 - tc.hp, de = 99999 - te.hp;
    assert(dc > 0 && de > 0, '錐內兩目標(正對錐軸 / 錐緣 80%)都命中');
    // Fan subdivision: tc straddles a bin boundary for 2 bins, te takes 1 bin, so total ratio = off-axis ratio x bin-count ratio
    const awL = Math.atan2(hitR({ kind: 'soldier' }), 30);
    const nTc = fanBinSpan(wf, 0, awL), nTe = fanBinSpan(wf, arc * 0.8, awL);
    const expF = offAxisFalloff(0.8) * (nTe[1] - nTe[0] + 1) / (nTc[1] - nTc[0] + 1);
    assert(Math.abs(de / dc - expF) < 0.03,
      `偏心遞減 ×${(de / dc).toFixed(3)}(期望 ${expF.toFixed(3)};正對錐軸滿額,格數 [${nTc}] vs [${nTe}])`);
    assert(Math.abs(offAxisFalloff(1) - AOE_EDGE) < 1e-9, `錐緣保底 = AOE_EDGE(${AOE_EDGE})`);
    sim.ents.delete(tc.id); sim.ents.delete(te.id);   // Test dummies have no lane; remove before tick
  }
  Math.random = _rnd0;

  log('— sim:單架無人機(共用玩家狀態 / 生存值 80% / 傷害同機甲 / 射程高約 1/8)—');
  const dr = sim.addHero('SWARM', 'p_d', 's01');
  const sq = sim.squads.get('p_d');
  assert(sq.bodies.length === SQUAD.N && SQUAD.N === 1, `無人機為單機(SQUAD.N=${SQUAD.N},實際 ${sq.bodies.length} 架)`);
  assert(sim.squads.get('p_r').bodies.length === 1, '機甲仍是單機');
  dr.money = 1234;
  assert(sq.bodies.every((b) => b.money === 1234), '經濟/彈藥/招式住共用玩家狀態');
  const avgOf = (kind, f) => {
    const cs = Object.keys(CHARACTERS).filter((c) => charKind(c) === kind);
    return cs.reduce((s, c) => s + f(c), 0) / cs.length;
  };
  const totHP = (c) => {
    const k = charKind(c), m = CHARACTERS[c].mods;
    return UNITS[k].hp * (m.hp ?? 1) + UNITS[k].shield * (m.sp ?? 1);
  };
  assert(Math.abs(avgOf('drone', totHP) - SQUAD.HP_F * avgOf('robot', totHP)) < avgOf('robot', totHP) * 0.02,
    `無人機平均總血量 = 機甲平均 ×${SQUAD.HP_F}(${avgOf('drone', totHP).toFixed(0)} vs ${(SQUAD.HP_F * avgOf('robot', totHP)).toFixed(0)})`);
  assert(Math.abs(avgOf('drone', heroArmor) - SQUAD.HP_F * avgOf('robot', heroArmor)) < 0.5,
    `無人機平均護甲 = 機甲平均 ×${SQUAD.HP_F}(${avgOf('drone', heroArmor).toFixed(1)} vs ${(SQUAD.HP_F * avgOf('robot', heroArmor)).toFixed(1)})`);
  assert(Math.abs(SQUAD.DMG - 1) < 1e-9, `單機傷害不折算(SQUAD.DMG=${SQUAD.DMG})`);
  assert(Math.abs(heroWeapon('s01', 'light', 1, false).dmg - rawDmg('s01', 'light')) < 1e-6,
    '無人機單機傷害 = 原數值(DMG=1,不折算)');
  assert(Math.abs(heroWeapon('t01', 'light', 1, false).dmg - rawDmg('t01', 'light')) < 1e-6,
    '機甲傷害不被折算');
  assert(Math.abs(UNITS.drone.sight / UNITS.robot.sight - 1.125) < 0.01,
    `無人機射程上限 ≈ 機甲 ×9/8(sight ${UNITS.drone.sight} vs ${UNITS.robot.sight},射程較機甲高約 1/8)`);

  log('— sim:無人機重生冷卻 —');
  dr.hp = 0; sim._kill(dr, null);
  assert(dr.dead, '無人機被擊落 → dead');
  sim.tick(0.05);
  assert(dr.dead, '死亡當下那個 tick 仍維持 dead(確保至少一份快照廣播 dead:true)');
  const deadView = sim.snapshotFor(dr.side).ents.find((e) => e.id === dr.id);
  assert(deadView?.dead && deadView.rs > 0, `陣營快照帶 dead:true 與重生倒數 rs:${deadView?.rs}`);
  assert(UNITS.drone.respawn.base > 0 && UNITS.robot.respawn.base > 0, '無人機/機甲重生都有冷卻(數值檢查)');
  sim.t += UNITS.drone.respawn.base + UNITS.drone.respawn.perDeath * 3;
  sim.tick(0.05); sim.tick(0.05);
  assert(!dr.dead, `重生冷卻結束後歸隊(base ${UNITS.drone.respawn.base}s)`);
  assert(sim.snapshotFor(dr.side).ents.find((e) => e.id === dr.id)?.dead === false, '重生後陣營快照恢復 dead:false');
  dr.rg = false;
  sim.heroes.set('p_d', dr); sq.act = 0;   // Switch main view back to dr; later tests settle against it

  log('— sim:機體重生倒數不同玩家分開計算(單機獨立計數)—');
  {
    const robotCh = charsOf('STEEL').find((c) => charKind(c) === 'robot');
    const p1 = sim.addHero('STEEL', 'p_test1', robotCh);
    const p2 = sim.addHero('STEEL', 'p_test2', robotCh);
    const r = UNITS.robot.respawn;
    const t0 = sim.t;
    p1.hp = 0; sim._kill(p1, null);
    const p1_rs1 = p1.respawnAt - t0;
    assert(p1_rs1 === r.base + r.perDeath * 1, `p1 第 1 次陣亡倒數 = ${r.base + r.perDeath}s(實得 ${p1_rs1}s)`);
    p1.hp = 0; sim._kill(p1, null);
    p1.hp = 0; sim._kill(p1, null);
    const p1_rs3 = p1.respawnAt - t0;
    assert(p1_rs3 === r.base + r.perDeath * 3, `p1 第 3 次陣亡倒數 = ${r.base + r.perDeath * 3}s(實得 ${p1_rs3}s)`);
    p2.hp = 0; sim._kill(p2, null);
    const p2_rs1 = p2.respawnAt - t0;
    assert(p2_rs1 === r.base + r.perDeath * 1,
      `不同玩家重生倒數獨立計算:p2 首次陣亡倒數 ${r.base + r.perDeath}s,不受隊友 3 次陣亡影響(實得 ${p2_rs1}s)`);
  }

  log('— sim:bot 飛行機體受擊掉高(真人那份住客戶端物理;掉幅 ∝ 實際護盾+裝甲損耗)—');
  {
    // Bots have no client, so the server writes height; the rule shares one airSinkM with the client (MUST NOT fork coefficients)
    const droneCh = charsOf('SWARM').find((c) => charKind(c) === 'drone');
    const bot = sim.addHero('SWARM', 'b_air', droneCh);
    bot.y = 200; bot.sp = bot.maxSp; bot.hp = bot.maxHp;
    const foe = { side: 'STEEL', hero: false };
    const sp0 = bot.sp;
    sim._damage(bot, 100, foe, 0);
    const lost1 = sp0 - bot.sp;
    assert(Math.abs((200 - bot.y) - airSinkM(lost1)) < 1e-6,
      `護盾階段:掉 ${(200 - bot.y).toFixed(2)}m = airSinkM(損耗 ${lost1.toFixed(0)})`);
    // Draining shield plus armor drops FLIGHT.SINK_TOWERS tower heights (calibration anchor; split across hits accumulates the same)
    const b2 = sim.addHero('SWARM', 'b_air2', droneCh);
    b2.y = 500; b2.sp = b2.maxSp; b2.hp = b2.maxHp;
    let guard = 0;
    while (b2.hp > 0 && guard++ < 500) sim._damage(b2, 40, foe, 999);   // pen 999 ignores armor, so wear equals damage
    const drop = 500 - b2.y;
    const want = airSinkM((sim.heroes.get('b_air2')?.maxSp || 0) + 0);
    assert(drop > want * 0.9,
      `打光整條護盾+裝甲掉 ${drop.toFixed(0)}m ≈ ${FLIGHT.SINK_TOWERS} 個砲塔高等級(校準錨)`);
    assert(b2.y >= 0, '掉高夾在地面(不會掉到地表以下)');
    // Grounded hulls (non-flying) never lose altitude
    const ground = sim.heroes.get('p_r');
    ground.dead = false; ground.y = 0; ground.hp = ground.maxHp; ground.sp = ground.maxSp;
    sim._damage(ground, 100, foe, 0);
    assert((ground.y || 0) === 0, '地面機甲不掉高(規則只作用於飛行機體)');
    sim.heroes.delete('b_air'); sim.heroes.delete('b_air2');
    sim.squads.delete('b_air'); sim.squads.delete('b_air2');
    for (const e of [...sim.ents.values()]) if (e.pid === 'b_air' || e.pid === 'b_air2') sim.ents.delete(e.id);
  }

  // Hull ultimates (saturation strike / cluster bombs / hypersonic missile) fully retired 2026-08-06, so the three entry-based
  // direct checks retire with them and MUST NOT return. Carrier ballistics / HP / shoot-down semantics stay; only the entry becomes
  // atk-ability carrier delivery -- covered by the atk-carrier delivery section below (it runs _launchAtkCarrier).

  log('— data:機種絕招載具 HP 一律由「一座砲塔打幾秒」反解(2026-08-01 使用者定調)—');
  {
    assert(towerDps() === UNITS.tower.dmg * UNITS.tower.rate,
      `一座砲塔基準 DPS = dmg × rate = ${towerDps()}(砲塔無 wid ⇒ pen 0,不吃 armorMul)`);
    // Saturation strike: 4 craft, one tower shoots down SHOT_DOWN (2), so 2 break through to detonate
    assert(SQUAD.KAMI.N === 4 && SQUAD.KAMI.SHOT_DOWN === 2,
      `飽和攻擊 ${SQUAD.KAMI.N} 架、一座砲塔擊落 ${SQUAD.KAMI.SHOT_DOWN} 架 ⇒ 成功自爆 ${SQUAD.KAMI.N - SQUAD.KAMI.SHOT_DOWN} 架`);
    assert(SQUAD.KAMI.HP_F === undefined, '舊 KAMI.HP_F(主機血量比例)MUST 已移除');
    assert(Math.abs(kamiHp() / frontDps() * SQUAD.KAMI.SHOT_DOWN - kamiExposureS()) < 0.5,
      `單架護衛機撐 ${(kamiHp() / frontDps()).toFixed(2)}s × ${SQUAD.KAMI.SHOT_DOWN} 架 ≈ 曝險窗 ${kamiExposureS().toFixed(2)}s`);
    // Lateral placement single seam: N craft spread evenly, symmetric, covering [-1, 1]
    {
      const ss = Array.from({ length: SQUAD.KAMI.N }, (_, i) => kamiSide(i));
      assert(ss[0] === -1 && ss[ss.length - 1] === 1, `kamiSide 涵蓋整個 [−1, 1](${ss.join(', ')})`);
      assert(Math.abs(ss.reduce((a2, b2) => a2 + b2, 0)) < 1e-9, 'kamiSide 左右對稱(總和為 0)');
    }
    // Hypersonic missile: survives the longest single flight with barely no shoot-down (at least 1 HP left at the end)
    // 2026-08-07: atk carriers launch from the nearest turret/main base, so the longest shot gains a representative launch leg
    // (hyperMaxArcM); exposure window grows with it and HP drifts too -- this still measures the same barely-survives claim.
    const hyFly = hyperFlightS(hyperMaxArcM());
    assert(hyperHp() > overflyDps() * hyFly,
      `飛彈 HP ${hyperHp()} > 飛越整條前線(塔位 + 一波兵)的全程輸出 ${(overflyDps() * hyFly).toFixed(0)}(剛好打不爆)`);
    assert(hyperHp() - overflyDps() * hyFly < towerDps(),
      '餘裕 < 一發塔砲 ⇒ 是「剛好」不是「綽綽有餘」(再多一把槍就打得下來)');
    assert(hyperRange() > UNITS.tower.range,
      `飛彈接戰距離 ${hyperRange()} > 砲塔射程 ${UNITS.tower.range}(機甲的攻塔手段)`);
    assert(hyperApex() > GAME.GUN_CEIL_M,
      `最遠一發的爬升頂點 ${hyperApex().toFixed(1)} > 直射鎖定天花板 ${GAME.GUN_CEIL_M}(「飛向高空」)`);
    assert(HYPER.APEX_F === undefined,
      '舊制固定頂點係數 APEX_F MUST 已移除(頂點改由 45° 發射角 × 交戰距離推導)');
    // Cluster bombs: survive until DROP_N (5) are released, then get shot down; the crash adds 1 more, so 5 + 1
    assert(DECOY.DROP_N === 5 && DECOY.DROP_N + 1 === DECOY.BOMB_MAX,
      `集束轟炸機在一座砲塔火力下投得完 ${DECOY.DROP_N} 顆 + 墜毀補投 1 顆 = ${DECOY.BOMB_MAX} 顆`);
    assert(Math.abs(decoyHp() / frontDps() - decoyExposureS()) < 0.5,
      `轟炸機撐 ${(decoyHp() / frontDps()).toFixed(2)}s ≈ 曝險窗 ${decoyExposureS().toFixed(2)}s`);
    // Calibration baseline = one front-line tower set (fixed by bal item 7f on 2026-08-02; missiles also count the wave they overfly)
    assert(TOWER_SITE_N === 2 && frontDps() === towerDps() * TOWER_SITE_N,
      `前線一組塔位 = ${TOWER_SITE_N} 座塔 ⇒ 基準 DPS ${frontDps()}(舊制單塔 ${towerDps()} 讓兩招在有塔的前線結構性歸零)`);
    assert(overflyDps() === frontDps() + waveDps(),
      `飛越前線的基準 = 塔位 ${frontDps()} + 一波兵 ${waveDps().toFixed(1)} = ${overflyDps().toFixed(1)}`);
    // Blast-radius area pricing: splitting one budget across N bomblets keeps total covered area constant
    // (2026-08-06 changed firepower only, never range, so this stays bit-identical to the old system)
    {
      const ab = { light: 1, heavy: 1 }, A = (r, n) => n * Math.PI * blastFootprintR(r) ** 2;
      const kam = A(kamiBlast(ab).r, SQUAD.KAMI.N);
      const dec = A(decoyBombBlast(ab).r, DECOY.BOMB_MAX) + A(decoyBlast(ab).r, 1);
      const hyp = A(hyperBlast(ab).r, 1);
      assert(Math.abs(kam / hyp - 1) < 1e-9 && Math.abs(dec / hyp - 1) < 1e-9,
        `三招總覆蓋面積相同(${(kam / 1000).toFixed(1)}k / ${(dec / 1000).toFixed(1)}k / ${(hyp / 1000).toFixed(1)}k m²)—— 半徑 ∝ √預算比例`);
      assert(Math.abs(hyperBlast(ab).r - specialBlastR(1)) < 1e-9 && HYPER.BLAST_R_F === undefined,
        `極音速飛彈爆風 ${hyperBlast(ab).r.toFixed(1)}m = share 1 的基準(火力減半 MUST NOT 順手連範圍也削)`);
      assert(DECOY.R === undefined && DECOY.BOMB_BLAST_R === undefined,
        '舊制逐招手寫半徑(DECOY.R / BOMB_BLAST_R)MUST 已退場');
    }
  }

  log('— data:機種絕招三招同預算 + 隨輕/重武器綜合等級成長(2026-07-27)—');
  {
    const L1 = { light: 1, heavy: 1 }, L4 = { light: 4, heavy: 4 }, MIX = { light: 4, heavy: 1 };
    assert(specialTier(L1) === 1 && specialTier(L4) === 4, '綜合等級 = 輕/重兩軌平均(Lv1/Lv4)');
    assert(specialTier(MIX) === 2.5, `輕 4 / 重 1 → 綜合 2.5 分數階(實得 ${specialTier(MIX)})`);
    assert(Math.abs(specialTier({ light: 4, heavy: 1 }) - specialTier({ light: 1, heavy: 4 })) < 1e-9,
      '兩軌對稱:只點輕武器與只點重武器的綜合等級相同');
    assert(specialTier(undefined) === 1 && specialTier({}) === 1, 'abil 缺值 → 綜合 Lv1(向後相容)');
    assert(specialBudget(L4) > specialBudget(MIX) && specialBudget(MIX) > specialBudget(L1),
      `預算隨綜合等級單調成長($${Math.round(specialBudget(L1))} → $${Math.round(specialBudget(MIX))}`
      + ` → $${Math.round(specialBudget(L4))})`);
    assert(Math.abs(specialBudget(L4) / specialBudget(L1) - (1 + SPECIAL.PER_LVL * 3)) < 1e-9,
      `綜合 Lv4 = Lv1 ×${(1 + SPECIAL.PER_LVL * 3).toFixed(2)}`);
    // Saturation strike / cluster bombs still take the full budget (within 2 percent, rounding only);
    // hypersonic missiles since 2026-08-06 take only 2.5 mech-bomber shares (user decision: one-shots were too strong),
    // while blast radius stays put (still the share-1 baseline) -- verify per tier; quietly restoring the full share reintroduces the defect.
    for (const abil of [L1, MIX, L4]) {
      const budget = specialBudget(abil);
      const kami = kamiBlast(abil).dmg * SQUAD.KAMI.N;
      const decoy = decoyBlast(abil).dmg + decoyBombBlast(abil).dmg * DECOY.BOMB_MAX;
      const solo = selfBoomBlast(abil).dmg;
      for (const [name, tot] of [['飽和攻擊', kami], ['集束炸彈', decoy], ['主機自毀', solo]]) {
        assert(Math.abs(tot - budget) <= budget * 0.02,
          `綜合 Lv${specialTier(abil)} ${name}總傷害 ${Math.round(tot)} ≈ 預算 ${Math.round(budget)}`);
      }
      const hyper = hyperBlast(abil).dmg;
      assert(Math.abs(hyper - kamiBlast(abil).dmg * HYPER.KAMI_EQ) <= 2,
        `綜合 Lv${specialTier(abil)} 極音速飛彈 ${hyper} = ${HYPER.KAMI_EQ} 架自爆無人機`
        + `(${kamiBlast(abil).dmg} 每架;整份預算為 ${Math.round(budget)})`);
      assert(hyper < budget * 0.9, `極音速飛彈 MUST NOT 悄悄調回整份預算(實得佔比 ${(hyper / budget * 100).toFixed(1)}%)`);
    }
    assert(Math.abs(hyperShare() - HYPER.KAMI_EQ / SQUAD.KAMI.N) < 1e-9,
      `戰鬥部佔預算 ${(hyperShare() * 100).toFixed(1)}% = KAMI_EQ ÷ KAMI.N(推導不手寫)`);
    // Old cannon count/window constants fully removed (no leftover export may survive the rework)
    assert(HYPER && HYPER.CD_S > 0, 'HYPER 取代 BARRAGE 成為機甲長按招式的常數組');
  }

  log('— sim/data:攻招載具遞送(2026-08-06 使用者定案「長按招式取代部分機體的攻招」)—');
  {
    // 1: conversion rule is derived (all area/targeted convert: strike/emp/summon plus team heal/buff = 22 hulls);
    //    10 pure self-only hulls stay instant and heroAbility output (cd/range) stays bit-identical
    const conv = Object.keys(CHARACTERS).filter((c) => atkDelivered(c));
    assert(conv.length === 22, `區域/指向型攻招共 22 台轉載具(實得 ${conv.length})`);
    for (const c of Object.keys(CHARACTERS)) {
      const u = CHARACTERS[c].atk;
      const inst = !(u.fx === 'strike' || u.fx === 'emp' || u.fx === 'summon'
        || ((u.fx === 'heal' || u.fx === 'buff') && u.target === 'team'));
      assert(atkDelivered(c) === !inst, `${c} 轉換判定與「區域/指向型」定義一致`);
      const A = heroAbility(c, 'atk', 1);
      if (inst) {
        assert(!A.carrier && A.cd === tierVal(u.cd, 1), `${c} 純自身型攻招維持瞬發、cd 不動(${A.cd}s)`);
      } else {
        assert(A.carrier && A.cd >= ATK_CARRIER.CD_LO - 1e-9 && A.cd <= ATK_CARRIER.CD_HI + 1e-9,
          `${c} 載具攻招 CD ${A.cd.toFixed(1)}s 落在 [${ATK_CARRIER.CD_LO}, ${ATK_CARRIER.CD_HI}]`);
        assert(A.range > 0, `${c} 載具攻招有遞送距離(${A.range.toFixed(0)}m)`);
      }
    }
    // CD mapping preserves order (affine): shorter original cd still maps to shorter new cd
    const pairs = conv.map((c) => [tierVal(CHARACTERS[c].atk.cd, 1), heroAbility(c, 'atk', 1).cd]);
    pairs.sort((a, b) => a[0] - b[0]);
    assert(pairs.every((p, i) => i === 0 || p[1] >= pairs[i - 1][1] - 1e-9), 'CD 帶映射嚴格保序');

    // 2: robot strike atk = hypersonic-missile form: has flight time, lands strike on impact, effect replaces damage
    const s2 = new BattleSim(fakeBattleConfig(1));
    const rc = s2.addHero('STEEL', 'uc_r', 't01');
    rc.x = 400; rc.z = 0; rc.mp = 999; rc.abil.atk = 1;
    const dum = s2._add({ kind: 'bunker', side: 'SWARM', x: 500, z: 0, y: 0, hp: 4000 }); delete dum.lane;
    s2.heroCast('uc_r', 'atk', 500, 0);
    // 2026-08-07: the roster is an array (one robot guard and atk may both be missile-form)
    assert(rc.hypers?.length === 1 && !!rc.hypers[0].uA, 't01 攻招發射極音速飛彈載具(uA payload、點遞送)');
    // Atk now launches from the nearest friendly turret/main base (2026-08-07 user decision) -- trajectory no longer starts at the hull itself
    {
      const m0 = rc.hypers[0];
      const fort = [...s2.ents.values()].filter((e) => e.side === rc.side && (e.kind === 'tower' || e.kind === 'base'))
        .sort((a, b) => Math.hypot(a.x - rc.x, a.z - rc.z) - Math.hypot(b.x - rc.x, b.z - rc.z))[0];
      assert(!!fort && Math.hypot(m0.x0 - fort.x, m0.z0 - fort.z) < 1e-6 && Math.hypot(m0.x0 - rc.x, m0.z0 - rc.z) > 1,
        `攻招載具自最近的我方工事(${fort?.kind})發射,不是自機體 —— 距機體 ${Math.hypot(m0.x0 - rc.x, m0.z0 - rc.z).toFixed(0)}m`);
    }
    assert((rc.acd.atk - s2.t) >= ATK_CARRIER.CD_LO && (rc.acd.atk - s2.t) <= ATK_CARRIER.CD_HI, 'CD 已收進 [15,30] 帶');
    const hp0 = dum.hp;
    let flew = 0, fxN = 0;
    for (let i = 0; i < 400 && rc.hypers.length; i++) {
      s2.tick(0.125); flew++;
      fxN += s2.events.filter((e) => e.e === 'atkfx' && e.fx === 'strike').length;
      s2.events.length = 0;
    }
    assert(!rc.hypers.length && flew * 0.125 >= 1, `飛彈有飛行時間(${(flew * 0.125).toFixed(1)}s ≥ 1s)後引爆`);
    assert(fxN === 1 && dum.hp < hp0, `著彈推送 atkfx 並以 strike 結算(${Math.round(hp0)} → ${Math.round(dum.hp)})`);

    // 3: drone team heal atk = 4 suicide attackers in waves; losing half halves the heal (that share denied, no martyrdom damage)
    const s3 = new BattleSim(fakeBattleConfig(1));
    const dc = s3.addHero('SWARM', 'uc_d', 's02');
    dc.x = 400; dc.z = 0; dc.mp = 999; dc.abil.atk = 1; dc.hp = 100;
    // 2026-08-07: atk summons from the nearest friendly work, so carriers fly seconds before arriving; meanwhile this 100 HP dummy is killed by
    // nearby enemy works (the old window was only 0.7s, so it never met them). What is measured is heal amount, not survival,
    // so grant invulnerability frames to move the damage axis away (heal still writes hp and ignores invUntil).
    dc.invUntil = 1e9;
    // Spectator picks bunker (speed 0): test dummies have no lane, and speed > 0 arms would crash _advance on an undefined lane
    const bys = s3._add({ kind: 'bunker', side: 'STEEL', x: 450, z: 0, y: 0, hp: 4000 }); delete bys.lane;
    s3.heroCast('uc_d', 'atk', 450, 0);
    const uk = [...s3.ents.values()].filter((e) => e.kami);
    assert(uk.length === SQUAD.KAMI.N && uk.every((k) => k.uA && k.pt), `s02 攻招生成 ${SQUAD.KAMI.N} 架點遞送 kami(分批)`);
    uk[0].hp = 0; s3._kill(uk[0], null);
    uk[1].hp = 0; s3._kill(uk[1], null);
    // Dummy pinned in combat (lastHitAt): out-of-combat armor regen at 1/4 would pollute the heal measurement; healing itself ignores OOC
    for (let i = 0; i < 200 && [...s3.ents.values()].some((e) => e.kami); i++) { dc.lastHitAt = s3.t; s3.tick(0.125); }
    const healFull = heroAbility('s02', 'atk', 1).heal;
    assert(Math.abs((dc.hp - 100) - healFull / 2) < 12,
      `擊落 2/${SQUAD.KAMI.N} ⇒ 只補一半(${(dc.hp - 100).toFixed(0)} / 全額 ${healFull})`);
    assert(bys.hp === 4000, '效果取代傷害:heal 載具抵達不產生任何爆風傷害(落點敵方單位毫髮無傷)');

    // 4: morph emp atk = single bomber (indivisible single payload); enemies in the drop zone lose weapons on arrival
    const s4 = new BattleSim(fakeBattleConfig(1));
    const mc = s4.addHero('SWARM', 'uc_m', 's03');
    mc.x = 400; mc.z = 0; mc.mp = 999; mc.abil.atk = 1;
    const dum4 = s4._add({ kind: 'bunker', side: 'STEEL', x: 520, z: 0, y: 0, hp: 4000 }); delete dum4.lane;
    s4.heroCast('uc_m', 'atk', 520, 0);
    const ub = [...s4.ents.values()].filter((e) => e.decoy);
    assert(ub.length === 1 && ub[0].uA && ub[0].uDrops.length === 1, 's03(emp)= 單一轟炸機、單份投遞(emp/buff 不可分)');
    assert(atkParts('morph', 'emp') === 1 && atkParts('drone', 'buff') === 1
      && atkParts('drone', 'heal') === SQUAD.KAMI.N && atkParts('morph', 'strike') === DECOY.BOMB_MAX,
      'atkParts:可分預算分批、不可分狀態單載(推導規則)');
    for (let i = 0; i < 300 && [...s4.ents.values()].some((e) => e.decoy); i++) s4.tick(0.125);
    assert((dum4.empUntil || 0) > s4.t, '轟炸機抵達 ⇒ 落點敵人 EMP 武器離線(效果取代傷害)');

    // 5: hull ultimates fully retired 2026-08-06, so the converted-role old-path guard section has no target:
    //    heroKamikaze / heroDecoy / heroHyper entries no longer exist (sim.js keeps a named retirement record).
    //    The only spawn point for all three carriers = _launchAtkCarrier, covered by 1-4 above.

    // 6: unconverted roles stay instant (no carrier); heal = base value plus the ultimate-retirement compensation.
    //    Expected value MUST go through selfAtkBoost -- hardcoding 400 means a later SELF_ATK or s11 cd change
    //    reds the test on a number that is actually right, while the real split (server vs HUD each computing one) goes unverified.
    const s6 = new BattleSim(fakeBattleConfig(1));
    const h6 = s6.addHero('SWARM', 'uc_i', 's11');
    h6.mp = 999; h6.abil.atk = 1; h6.hp = 50;
    s6.heroCast('uc_i', 'atk');
    const A6 = heroAbility('s11', 'atk', 1);
    const B6 = selfAtkBoost('s11', 1, h6.abil);
    // 2026-08-07: self-buff types are now supplied by the player-following support squadron (see next section), so here only pin
    // not-a-point-delivery carrier and compensation really flows through selfAtkBoost into settlement; delivery waits for the squadron to fly the drop leg.
    assert(!A6.carrier && A6.support, 's11 是輔助機隊型攻招(不是點遞送載具)');
    assert(B6.heal > 0, `s11 領到機種絕招退場的補償(+${Math.round(B6.heal)} 治療)`);
    assert(Math.abs(h6.hp - 50) < 0.01, 's11 施放當下不回血 —— 輔助機還在飛投放腿(有攔截窗)');
    // Four craft each deliver 1/4: wait until the whole team arrives (stopping at the first arrival measures only one quarter)
    for (let i = 0; i < 400 && [...s6.ents.values()].some((e) => e.supG); i++) s6.tick(0.125);
    assert(Math.abs(h6.hp - Math.min(h6.maxHp, 50 + A6.heal + B6.heal)) < 1,
      `s11 自補 = 原值 ${A6.heal} + 補償 ${Math.round(B6.heal)}(cd ${A6.cd}s 不變)`);
  }

  log('— sim/data:自身強化型攻招 = 跟隨玩家的輔助機隊(2026-08-07 使用者定案)—');
  {
    // 1: category and craft counts are derived: some abilities become multi-craft (stackable ones batch by hull), binary states stay single-craft
    const SELF9 = Object.keys(CHARACTERS).filter((c) => !atkDelivered(c));
    assert(SELF9.length === 10 && SELF9.every((c) => heroAbility(c, 'atk', 1).support),
      `自身強化型 10 台全走輔助機隊(${SELF9.join(' ')})`);
    assert(SELF9.every((c) => supportN(c) === (supportStackable(c) ? kindParts(charKind(c)) : 1)),
      '機數 = 可疊加 ? 該機種分批數 : 1(與 atkParts 同一張機種表)');
    assert(supportN('s04') === SQUAD.KAMI.N && supportN('t06') === DECOY.BOMB_MAX
      && supportN('t02') === 1 && supportN('m08') === 1,
      `多機 ${supportN('s04')}(drone)/ ${supportN('t06')}(morph),單機 robot 與純二元狀態(m08 匿蹤)`);
    assert(new Set(SELF9.map((c) => selfAtkTempo(c))).size === 3,
      '三種節奏(瞬發/間斷/持續)在現役角色上都有人');

    // 2: durability: sustain > intermittent > instant, and longer dur means tougher (recomputed per hull -- derived, never hardcoded)
    for (const c of SELF9) {
      const n = supportN(c), dur = tierVal(CHARACTERS[c].atk.dur ?? 0, 1);
      const tf = supportTempoF(selfAtkTempo(c));
      assert(supportHp(c, 1) === frontKillHp(supportLegS() + tf * dur / n),
        `${c} 每架 ${supportHp(c, 1)} = 前線一組塔位 ×(投放腿 + ${selfAtkTempo(c)} 窗 ÷ ${n})`);
    }
    {
      const hpAt = (tempo, dur) => frontKillHp(supportLegS() + supportTempoF(tempo) * dur / 4) * 4;
      assert(hpAt('sustain', 8) > hpAt('pulse', 8) && hpAt('pulse', 8) > hpAt('burst', 8),
        `同 dur:持續 ${hpAt('sustain', 8)} > 間斷 ${hpAt('pulse', 8)} > 瞬發 ${hpAt('burst', 8)}`);
      assert(hpAt('sustain', 12) > hpAt('sustain', 8) && hpAt('pulse', 12) > hpAt('pulse', 8),
        '持續時間越久,輔助機隊越硬');
    }

    // Support squadron wait: atk summons from the nearest friendly work (2026-08-07), so the drop leg is a real distance, not a fixed value,
    // MUST NOT reuse fixed-cell supportLegS over dt math (flight time grows with distance from the work to the caster).
    const armWait = (sim, pred, maxS = 30) => {
      for (let i = 0; i < Math.ceil(maxS / 0.125) && !pred(); i++) sim.tick(0.125);
    };

    // 3: behavior: buffs apply only once in place, stacking is additive, kills remove one share, wipe removes the whole buff
    const sS = new BattleSim(fakeBattleConfig(1));
    const hS = sS.addHero('SWARM', 'sup_d', 's04');
    hS.x = 400; hS.z = 0; hS.mp = 999; hS.abil.atk = 1;
    sS.heroCast('sup_d', 'atk');
    const cS = [...sS.ents.values()].filter((e) => e.supG);
    assert(cS.length === supportN('s04') && cS.every((k) => k.hp === supportHp('s04', 1) && k.armor === 0),
      `s04 派出 ${cS.length} 架輔助機、每架 HP ${supportHp('s04', 1)}(armor 0)`);
    assert(Math.abs(sS._buffMul(hS, 'dmg') - 1) < 1e-9, '投放腿飛行中 ⇒ 加成尚未上線(每一發都有攔截窗)');
    // Atk summons from the nearest friendly work, so spawn sits a real distance from the caster (this also pins not-spawned-in-place)
    assert(cS.every((k) => Math.hypot(k.x - hS.x, k.z - hS.z) > ATK_SUPPORT.SLOT_R * 2),
      '攻招輔助機自後方工事出發(生成點不在主機身邊)');
    armWait(sS, () => [...sS.ents.values()].some((e) => e.supG && e.phase === 'escort'));
    const fullS = heroAbility('s04', 'atk', 1).mul.dmg + selfAtkBoost('s04', 1, hS.abil).dmgMul;
    assert(Math.abs(sS._buffMul(hS, 'dmg') - fullS) < 1e-6,
      `全員就位 ⇒ 效果值逐位元同舊制(×${fullS.toFixed(3)})`);
    const aliveS = [...sS.ents.values()].filter((e) => e.supG);
    aliveS[0].hp = 0; sS._kill(aliveS[0], null);
    aliveS[1].hp = 0; sS._kill(aliveS[1], null);
    assert(Math.abs(sS._buffMul(hS, 'dmg') - (1 + (fullS - 1) * 0.5)) < 1e-6,
      `擊落 2/4 ⇒ ×${(1 + (fullS - 1) * 0.5).toFixed(3)}(加法疊加;相乘會是 ${((1 + (fullS - 1) / 4) ** 2).toFixed(3)})`);
    for (const k of [...sS.ents.values()].filter((e) => e.supG)) { k.hp = 0; sS._kill(k, null); }
    assert(Math.abs(sS._buffMul(hS, 'dmg') - 1) < 1e-9, '機隊全滅 ⇒ 加成整份下線');

    // 4: binary state (stealth) is single-craft: losing the support craft breaks stealth at once
    const sT = new BattleSim(fakeBattleConfig(1));
    const hT = sT.addHero('STEEL', 'sup_m', 'm08');
    hT.x = 400; hT.z = 0; hT.mp = 999; hT.abil.atk = 1;
    sT.heroCast('sup_m', 'atk');
    armWait(sT, () => hT.stealthUntil > sT.t);
    assert(hT.stealthUntil > sT.t, 'm08 輔助機就位 ⇒ 匿蹤上線');
    const kT = [...sT.ents.values()].filter((e) => e.supG)[0];
    kT.hp = 0; sT._kill(kT, null);
    assert(hT.stealthUntil === 0, '輔助機被擊落 ⇒ 當場現形(二元狀態顯式撤掉)');

    // 5: the 22 point-delivery hulls are fully unaffected
    const sC = new BattleSim(fakeBattleConfig(1));
    const hC = sC.addHero('SWARM', 'sup_c', 's02');
    hC.x = 400; hC.z = 0; hC.mp = 999; hC.abil.atk = 1;
    sC.heroCast('sup_c', 'atk', 450, 0);
    assert(![...sC.ents.values()].some((e) => e.supG)
      && [...sC.ents.values()].filter((e) => e.kami).length === SQUAD.KAMI.N,
      's02(點遞送)仍生 kami 載具、一架輔助機都沒有');
  }

  log('— sim/data:守招詠唱機制 + 攻招載具遞送(2026-08-22 使用者定案)—');
  {
    // 1: all 32 atk are carrier-based (point delivery / escort formation); all 32 guard skills are cast by the hull itself (no carrier/squadron)
    const CHS2 = Object.keys(CHARACTERS);
    assert(CHS2.every((c) => {
      const uA = heroAbility(c, 'atk', 1);
      const sA = heroAbility(c, 'def', 1);
      return (uA.carrier !== uA.support && uA.carrier === abilDelivered(c, 'atk'))
        && (!sA.carrier && !sA.support && !abilDelivered(c, 'def') && sA.castTime > 0);
    }), '攻招全數載具化、守招全數為本體施展技能(castTime > 0)');

    // 2: guard CD band [15,30] with strict order preservation (rank-stability guarantee)
    const skCd = [];
    let skIn = true;
    for (const c of CHS2) for (let lvl = 1; lvl <= 3; lvl++) {
      const cd = heroAbility(c, 'def', lvl).cd;
      if (cd < 15 - 1e-9 || cd > 30 + 1e-9) skIn = false;
      skCd.push([tierVal(CHARACTERS[c].def.cd, lvl), cd]);
    }
    assert(skIn, '守招 CD 全落 [15, 30]s(使用者定案)');
    skCd.sort((a, b) => a[0] - b[0]);
    assert(skCd.every((g, i) => i === 0 || g[1] >= skCd[i - 1][1] - 1e-9), '守招 CD 映射嚴格保序');
    assert(abilOrigin('def') === 'self' && abilOrigin('atk') === 'fort',
      '發射點單一縫:守招 = 主機身邊 / 攻招 = 最近的我方砲塔或主堡');

    // 3: direct check that atk sorties from works
    const sk = new BattleSim(fakeBattleConfig(1));
    const hk = sk.addHero('SWARM', 'ab_o', 's03');
    hk.x = 320; hk.z = 140; hk.mp = 999; hk.abil.def = 1; hk.abil.atk = 1;
    const fortP = sk._launchOrigin(hk, 'atk');
    assert(Math.hypot(fortP.x - hk.x, fortP.z - hk.z) > ATK_CARRIER.MIN_LEG,
      `最近的我方工事離施放者 ${Math.hypot(fortP.x - hk.x, fortP.z - hk.z).toFixed(0)}m(不是就地生成)`);
    sk.heroCast('ab_o', 'atk', hk.x + 60, hk.z);
    const vUl = [...sk.ents.values()].filter((e) => e.decoy)[0];
    assert(!!vUl && Math.hypot(vUl.x - fortP.x, vUl.z - fortP.z) < 1e-6,
      '攻招載具自最近的我方工事升空(「從最近的砲塔或主堡召喚」)');

    // 4: direct check of guard cast mechanic: no bonus while casting, full value on natural completion, hit forces immediate (t/T)^2 trigger
    const sb = new BattleSim(fakeBattleConfig(1));
    const hb = sb.addHero('SWARM', 'ab_b', 's01');
    hb.x = 320; hb.z = 140; hb.mp = 999; hb.abil.def = 1;
    const ct = defCastTime('s01', 1);
    sb.heroCast('ab_b', 'def');
    assert(!!hb.cast && hb.cast.dur === ct, `s01 守招開始詠唱(${ct.toFixed(2)}s)`);
    assert(Math.abs(sb._buffMul(hb, 'dmgTaken') - 1) < 1e-9, '守招詠唱中效果未生效');
    // Cast interrupted at 50 percent by a hit
    sb.tick(ct * 0.5);
    sb._damage(hb, 10, null);
    assert(!hb.cast, '受擊後立即結束詠唱強制施法');
    const fExp = 0.25; // (0.5)^2
    const rawMul = heroAbility('s01', 'def', 1).mul.dmgTaken;
    const expMul = 1 + (rawMul - 1) * fExp;
    assert(Math.abs(sb._buffMul(hb, 'dmgTaken') - expMul) < 1e-6,
      `受擊強制施展效果比例 (t/T)² = ${(fExp * 100).toFixed(0)}%(dmgTaken ×${expMul.toFixed(3)})`);
  }

  log('— 攻/守招式 CD 15~30s 與多充能獨立平行冷卻測試 —');
  {
    const CHS_ALL = Object.keys(CHARACTERS);
    // 1: every role at every tier keeps atk/guard CD strictly inside [15, 30]
    for (const c of CHS_ALL) {
      for (let lvl = 1; lvl <= 3; lvl++) {
        const uA = heroAbility(c, 'atk', lvl);
        const sA = heroAbility(c, 'def', lvl);
        assert(uA.cd >= 15 - 1e-9 && uA.cd <= 30 + 1e-9, `${c} Lv${lvl} 攻招 CD ${uA.cd}s 落入 [15, 30]s`);
        assert(sA.cd >= 15 - 1e-9 && sA.cd <= 30 + 1e-9, `${c} Lv${lvl} 守招 CD ${sA.cd}s 落入 [15, 30]s`);
      }
    }

    // 2: multi-charge cast, sequential casts, and parallel independent CDs (t06 guard with 3 charges as example)
    const simChg = new BattleSim(fakeBattleConfig(1));
    const hChg = simChg.addHero('STEEL', 'chg_hero', 't06');
    hChg.x = 320; hChg.z = 140; hChg.mp = 999; hChg.abil.def = 1;
    const t06Sk = heroAbility('t06', 'def', 1);
    assert(t06Sk.charges === 3, 't06 守招具備 3 次充能');
    assert(simChg._readyCharges(hChg, 'def') === 3, '初始具備 3 次完整充能');

    // First cast
    simChg.heroCast('chg_hero', 'def');
    simChg.tick(t06Sk.castTime + 0.05);
    assert(simChg._readyCharges(hChg, 'def') === 2, '施放一次後剩餘 2 次充能');
    assert(hChg.acd.def === 0, '仍有可用充能時 acd.def 保持 0 (可立即再次施放)');

    // Second cast after a 2s gap (separately timed)
    simChg.tick(2.0);
    simChg.heroCast('chg_hero', 'def');
    simChg.tick(t06Sk.castTime + 0.05);
    assert(simChg._readyCharges(hChg, 'def') === 1, '再次施放後剩餘 1 次充能');

    // Third cast after a 1s gap (drains all charges)
    simChg.tick(1.0);
    simChg.heroCast('chg_hero', 'def');
    simChg.tick(t06Sk.castTime + 0.05);
    assert(simChg._readyCharges(hChg, 'def') === 0, '三次施放後充能耗盡 (0 次)');
    assert(hChg.acd.def > simChg.t, '充能耗盡後 acd.def 進入冷卻狀態 (指向最早到期時戳)');

    // Cannot cast once charges are spent
    const canCastBefore = simChg.heroCast('chg_hero', 'def');
    assert(!canCastBefore, '充能為 0 時無法施放');

    // Snapshot packaging check
    const snapChg = simChg.snapshot();
    const entChg = snapChg.ents.find((e) => e.pid === 'chg_hero');
    assert(entChg && Array.isArray(entChg.chg), '快照 ents 包含 chg 充能陣列');
    const defChgSnap = entChg.chg[0];
    assert(defChgSnap[0] === 0 && defChgSnap[1] === 3 && defChgSnap[2] > 0,
      `快照反映當前充能狀態: [${defChgSnap.join(', ')}] = [ready=0, max=3, nextCd>0]`);

    // Wait for the first charge to come due (first one expires at t06Sk.cd)
    const tFirstRecharge = hChg.achg.def.rechargeAt[0];
    const waitTime1 = Math.max(0, tFirstRecharge - simChg.t + 0.05);
    simChg.tick(waitTime1);
    assert(simChg._readyCharges(hChg, 'def') === 1, '第一筆充能到期，恢復 1 次充能');
    assert(hChg.acd.def === 0, '恢復充能後 acd.def 再次為 0 (可施放)');

    // Pick up a battery supply (battery cooldown reduction shortens rechargeAt)
    simChg._grantReward(hChg, 'battery', 1);
    assert(hChg.achg.def.rechargeAt.length > 0, '電池縮減充能時間後依然有效維護');
  }

  log('— data:八軌升級階梯 = $75/$150/$300 + 戰鬥分數 0/20/100(2026-08-11)—');
  {
    const WANT = [[75, 0], [150, 20], [300, 100]];
    for (const [key, up] of Object.entries(ECON.UPGRADES)) {
      assert(up.max === WANT.length, `${key}(${up.name})階數 ${up.max} = 階梯列數 ${WANT.length}`);
      for (let l = 0; l < WANT.length; l++) {
        assert(upgradePrice(up, l) === WANT[l][0] && upgradeScore(up, l) === WANT[l][1],
          `${key} 第 ${l + 1} 階 $${upgradePrice(up, l)} / 戰鬥分數 ${upgradeScore(up, l)}`);
      }
    }
    const total = Object.values(ECON.UPGRADES)
      .reduce((s, u) => { for (let l = 0; l < u.max; l++) s += upgradePrice(u, l); return s; }, 0);
    assert(total === 4200, `八軌全滿總價 $${total}(8 ×(75+150+300))`);
  }

  log('— data:戰鬥分數(擊殺 +4 / 助攻 +1;玩家與砲塔 ×5;夾 100 只增不減)—');
  {
    assert(battleScoreGain('soldier', false) === 4 && battleScoreGain('soldier', false, true) === 1,
      '小兵:擊殺 4 分 / 助攻 1 分');
    assert(battleScoreGain('robot', true) === 20 && battleScoreGain('tower', false) === 20,
      '硬目標(玩家機體 / 砲塔)擊殺 ×5 = 20 分');
    assert(battleScoreGain('tower', false, true) === 5, '砲塔助攻 5 分');
    assert(addBattleScore(BATTLE_SCORE.MAX - 1, 20) === BATTLE_SCORE.MAX, `分數夾在 ${BATTLE_SCORE.MAX}`);
    assert(addBattleScore(30, -50) === 30, '只增不減(負增益不扣分)');
  }

  log('— sim:升級快照傳「值」不傳權威物件參考(單機不經 JSON;否則客戶端樂觀購買雙重遞增 → 兩次就滿)—');
  {
    const sim = new BattleSim(fakeBattleConfig(1));
    const h = sim.addHero('SWARM', 'pu', 's01');
    const snap = sim._serializeEnt(h);
    assert(snap.up !== h.upg && snap.ab !== h.abil, '_serializeEnt 的 up/ab 是新物件(非權威參考)');
    snap.up.lw = 99; snap.ab.light = 99;                        // Simulate the client mutating its snapshot copy
    assert(h.upg.lw === 0 && h.abil.light === 1, 'mutate 快照不污染伺服器權威 upg/abil');
    // True solo path: before each purchase the client sets this.upg = e.up then optimistically adds 1, and the server authoritatively settles once more.
    // Before the fix e.up === h.upg, so the optimistic +1 polluted authority in place, then the server +1 meant double increment: two presses maxed a three-tier track.
    h.money = 99999; h.kn = BATTLE_SCORE.MAX;   // This section only checks for double increment, so pre-fill the battle-score gate
    let presses = 0;
    while ((h.upg.lw || 0) < ECON.UPGRADES.lw.max && presses < 10) {
      presses++;
      const clientUpg = sim._serializeEnt(h).up;               // this.upg = e.up
      clientUpg.lw = (clientUpg.lw || 0) + 1;                   // Client optimistic +1 (must not pollute authority)
      sim.buy('pu', 'lw');                                     // Server authoritative purchase
    }
    assert(presses === ECON.UPGRADES.lw.max,
      `單機輕武器升滿需按 ${ECON.UPGRADES.lw.max} 次(實得 ${presses};修復前雙重遞增只需 2 次 = 使用者回報的「升級只有 2 階」)`);
    assert(h.abil.light === 1 + ECON.UPGRADES.lw.max, `升滿後 abil.light = ${h.abil.light}(= Lv${h.abil.light})`);
  }

  log('— data:電腦難度操作節奏(每項操作切換間隔;最高難度 = 頂尖 FPS 電競數值)—');
  {
    const keys = BOT_DIFF_KEYS;
    for (const k of keys) {
      const D = BOT_DIFF[k];
      assert(D.gap > 0 && D.react > 0, `${D.name}:手速 ${D.gap}s / 反應 ${D.react}s 皆為正值`);
    }
    for (let i = 1; i < keys.length; i++) {
      const lo = BOT_DIFF[keys[i - 1]], hi = BOT_DIFF[keys[i]];
      assert(hi.gap < lo.gap && hi.react < lo.react,
        `難度越高手速/反應越快(${lo.name} ${lo.gap}s/${lo.react}s → ${hi.name} ${hi.gap}s/${hi.react}s)`);
    }
    const top = BOT_DIFF.high;
    assert(top.gap <= 0.15 + 1e-9 && top.react <= 0.20 + 1e-9 && top.react >= 0.15 - 1e-9,
      `最高難度對齊頂尖 FPS 電競:反應 ${top.react}s(150~200ms)、手速 ${top.gap}s(≈400 APM)`);
    assert(top.gap >= GAME.TICK_MS / 1000 * 0.8,
      `最高難度仍受限(gap ${top.gap}s 不低於伺服器 tick ${GAME.TICK_MS}ms 的量級 = 人類頂點,不是無限手速)`);
    for (const op of Object.keys(BOT_OPS)) {
      assert(botOpGap(top, op) < botOpGap(BOT_DIFF.novice, op),
        `${op}:高難度切換間隔 ${botOpGap(top, op).toFixed(2)}s < 新手 ${botOpGap(BOT_DIFF.novice, op).toFixed(2)}s`);
      assert(botOpGap(top, op) >= top.gap - 1e-9, `${op}:單項間隔 ≥ 全域手速閘`);
    }
    assert(Math.abs(botOpGap(top, 'buy') - 4.05) < 0.01,
      `高難度巡店間隔 ${botOpGap(top, 'buy').toFixed(2)}s ≈ 舊硬編碼 4s`);
    assert(botOpGap(top, '不存在的操作') === top.gap, '未列名的操作 = 一次基本操作(× 1)');

    // Real pacing behavior (BotBrain._op is the only seam): advance a fake sim clock and count allowed ops in 10s
    const fake = { t: 0, lanes: sim.lanes };
    const countOps = (key, op) => {
      const brain = new BotBrain(fake, 'bx', 'STEEL', 0, key);
      let n = 0;
      for (fake.t = 0; fake.t < 10; fake.t += GAME.TICK_MS / 1000) if (brain._op(op)) n++;
      return n;
    };
    let prev = Infinity;
    for (const k of [...keys].reverse()) {          // high → novice
      const n = countOps(k, 'scan');
      assert(n < prev, `${BOT_DIFF[k].name}:10 秒內掃描選敵 ${n} 次(難度越低次數越少)`);
      prev = n;
    }
    // Global APM gate: different op kinds still crowd each other out (one action at a time)
    {
      const brain = new BotBrain(fake, 'bx', 'STEEL', 0, 'high');
      let n = 0;
      for (fake.t = 0; fake.t < 10; fake.t += GAME.TICK_MS / 1000) {
        for (const op of ['scan', 'weapon', 'ability', 'special', 'state', 'buy', 'defend']) if (brain._op(op)) n++;
      }
      assert(n <= Math.ceil(10 / BOT_DIFF.high.gap),
        `最高難度 10 秒內全類操作合計 ${n} 次 ≤ 手速上限 ${Math.ceil(10 / BOT_DIFF.high.gap)} 次(≈400 APM)`);
    }
    // Reaction time: no firing within react seconds after switching targets (sim.botFire is never even called)
    {
      const brain = new BotBrain(fake, 'bx', 'STEEL', 0, 'high');
      fake.t = 0; brain._aimAt = BOT_DIFF.high.react;
      assert(brain._fire(1, 'light') === false, `反應時間 ${BOT_DIFF.high.react}s 內不開火(準星還沒拉到目標上)`);
    }
  }

  log('— sim:電腦玩家操作新防守姿態與新攻防技能(分難度策略/切盾減傷/攻防技能)—');
  {
    const bSim = new BattleSim(fakeBattleConfig(1));
    purgeCamps(bSim);
    // 1. defend flags and capability tiers per difficulty
    const bNovice = new BotBrain(bSim, 'b_novice', 'STEEL', 0, 'novice');
    const bLow = new BotBrain(bSim, 'b_low', 'STEEL', 1, 'low');
    const bMed = new BotBrain(bSim, 'b_med', 'STEEL', 2, 'medium');
    const bHigh = new BotBrain(bSim, 'b_high', 'STEEL', 3, 'high');
    assert(bNovice.diff.defend === false, '新手難度: defend 旗標為 false(不持盾)');
    assert(bLow.diff.defend === true && bMed.diff.defend === true && bHigh.diff.defend === true,
      '低/中/高難度: defend 旗標為 true(具備防守姿態能力)');

    // 2. high difficulty: tactically raise shield during reload windows, and drop guard to re-engage once reloaded and aimed
    const hHigh = bSim.addHero('STEEL', 'b_high', 't01');
    const foe = bSim.addHero('SWARM', 'p_foe', 's01');
    hHigh.ry = 0; // Facing straight ahead (+z)
    foe.x = hHigh.x; foe.z = hHigh.z + 50; foe.y = 0;
    bSim.t = 10;
    hHigh.reloadUntil = { light: 15, heavy: 15 };
    hHigh.lastHitAt = 10;
    bHigh.state = 'ENGAGE';
    bHigh._updateDefending(hHigh, foe);
    assert(hHigh.defending === true, '高難度: 換彈空窗期戰術切換防守姿態(正面護盾)');

    // 3. guard-stance shield reduction (frontal shield cut by hull: robot 20 percent, drone 25 percent, morph 30 percent)
    const rawDmg = 100;
    const hp0 = hHigh.hp, sp0 = hHigh.sp;
    bSim._damage(hHigh, rawDmg, foe, 0);
    const lostSp = sp0 - hHigh.sp;
    const expDirectF = shieldDefKindFactor(hHigh.kind, false, false);
    assert(Math.abs(lostSp - rawDmg * expDirectF) < 1e-3,
      `防守姿態正面護盾承受直擊: 傷害折減為 ${(expDirectF * 100).toFixed(0)}%(消耗護盾 ${lostSp} = 100 × ${expDirectF})`);

    // 4. drop guard once reloaded and aimed
    bSim.t = 16;
    hHigh.reloadUntil = { light: 5, heavy: 5 };
    bHigh._aimAt = 5;
    bHigh._updateDefending(hHigh, foe);
    assert(!hHigh.defending, '高難度: 換彈就緒瞄準完成時主動解除防守姿態投入射擊');

    // 5. low difficulty: guards only when hit while retreating to base (RETREAT); no guard flipping in normal fights
    const hLow = bSim.addHero('STEEL', 'b_low', 't01');
    bLow.state = 'ENGAGE';
    hLow.reloadUntil = { light: 15, heavy: 15 };
    bLow._updateDefending(hLow, foe);
    assert(!hLow.defending, '低難度: 一般交戰換彈不具備戰術切盾意識');
    bSim.t = 18;
    bLow.state = 'RETREAT';
    hLow.lastHitAt = bSim.t;
    bLow._updateDefending(hLow, foe);
    assert(hLow.defending === true, '低難度: 撤退回主堡受擊中進入防守姿態保命');

    // 6. novice difficulty: no guard even when hit while retreating
    const hNovice = bSim.addHero('STEEL', 'b_novice', 't01');
    bNovice.state = 'RETREAT';
    hNovice.lastHitAt = bSim.t;
    bNovice._updateDefending(hNovice, foe);
    assert(!hNovice.defending, '新手難度: 撤退挨打亦不進入防守姿態');

    // 7. support-skill casting: fire guard/charge skill once shield is over half gone (t03 guard as example)
    const bSup = new BotBrain(bSim, 'b_sup', 'STEEL', 4, 'high');
    const hSup = bSim.addHero('STEEL', 'b_sup', 't03');
    bSim.t = 25;
    hSup.sp = hSup.maxSp * 0.3;
    hSup.lastHitAt = bSim.t;
    let castCalled = false;
    const origCast = bSim.heroCast.bind(bSim);
    bSim.heroCast = (pid, slot) => { castCalled = true; return origCast(pid, slot); };
    bSup._castSupport(hSup, hSup.hp / hSup.maxHp);
    assert(castCalled, '高難度: 磁力損耗過半時及時施放防守/護盾充能招式');
    bSim.heroCast = origCast;
  }

  log('— sim:擊殺電腦玩家 = 玩家同一個係數(2026-08-11;舊制的刷 bot 折價已退場)—');
  {
    const botHero = sim.addHero('STEEL', 'b9', 't06');
    const killer = sim.heroes.get('p_d');
    killer.kn = 0;
    const kn0 = killer.kn;
    botHero.hp = 0; botHero.sp = 0;
    sim._kill(botHero, killer);
    assert(killer.kn - kn0 === battleScoreGain('robot', true),
      `擊殺 bot 機甲 = ${battleScoreGain('robot', true)} 分(與真人同一個係數)`);
    killer.kn = 0;
    sim.squads.delete('b9');
    sim.heroes.delete('b9');
    for (const b of botHero.sq.bodies) sim.ents.delete(b.id);
  }

  log('— sim:無敵幀(起跳離地 1s 免傷;機甲/傭兵 15s CD、無人機完美迴避 30s CD)—');
  {
    const rb = sim.heroes.get('p_r');
    sim.heroIframe('p_r');
    assert((rb.invUntil || 0) > sim.t, `機甲請求無敵幀 → ${IFRAME.DUR}s 免傷(時長夾在伺服器)`);
    const hp0 = rb.hp, sp0 = rb.sp;
    sim._damage(rb, 100, sim.heroes.get('p_d'), 0);
    assert(rb.hp === hp0 && rb.sp === sp0, '無敵幀期間 _damage 免傷(護盾/裝甲皆不動)');
    const inv0 = rb.invUntil;
    sim.heroIframe('p_r');
    assert(rb.invUntil === inv0, `機甲 CD ${IFRAME.CD}s 內再請求被拒(免傷視窗不重置)`);
    rb.invUntil = 0; rb.iframeCdUntil = 0;   // Clear the field: keep later damage tests clean
    // Drone perfect dodge (2026-07-21): accepted request means 1s immunity, CD = DRONE_CD (30s), re-request during CD denied
    const dr2 = sim.heroes.get('p_d');
    sim.heroIframe('p_d');
    assert((dr2.invUntil || 0) > sim.t, '無人機完美迴避:請求被接受 → 1s 免傷');
    assert(Math.abs((dr2.iframeCdUntil || 0) - (sim.t + IFRAME.DRONE_CD)) < 1e-6, `無人機完美迴避 CD = ${IFRAME.DRONE_CD}s`);
    const dinv0 = dr2.invUntil;
    sim.heroIframe('p_d');
    assert(dr2.invUntil === dinv0, `無人機 CD ${IFRAME.DRONE_CD}s 內再請求被拒(免傷視窗不重置)`);
    dr2.invUntil = 0; dr2.iframeCdUntil = 0;   // Clear the field
  }

  log('— sim:雙層 HP(護盾脫戰滿速回復 / 裝甲脫戰 1/4 回復,回堡/招式加速)+ 電力 —');
  dr.x = sim.basePos.SWARM[0] + 500; dr.z = sim.basePos.SWARM[1];   // Move clear of the base heal aura first
  dr.sp = 0; dr.hp = Math.round(dr.maxHp * 0.6);
  const hpNow = dr.hp;
  dr.lastHitAt = sim.t;
  sim.tick(0.125);
  assert(dr.sp === 0, '戰鬥中(剛受擊)護盾不回復');
  assert(dr.hp === hpNow, '戰鬥中(剛受擊)裝甲不回復');
  dr.lastHitAt = sim.t - VITALS.OOC_S - 1;
  sim.tick(0.5);
  assert(dr.sp > 0, `脫戰 ${VITALS.OOC_S}s 後護盾自然回復(sp=${Math.round(dr.sp)})`);
  assert(dr.hp > hpNow, `脫戰 ${VITALS.OOC_S}s 後裝甲依護盾 1/4 速率自然回復(hp=${Math.round(dr.hp)})`);
  const hpOoc = dr.hp;
  [dr.x, dr.z] = sim.basePos.SWARM;
  sim.tick(0.5);
  assert(dr.hp > hpOoc, '回主堡 → 裝甲修復');
  assert(dr.mp < dr.maxMp || dr.mp === dr.maxMp, `電力欄存在(mp=${Math.floor(dr.mp)}/${dr.maxMp})`);

  log('— sim:八軌養成(開場 Lv1、階梯 $75/$150/$300、戰鬥分數門檻 0/20/100、Lv4 外推)—');
  dr.money = 9999; dr.kn = 0;
  assert(dr.abil.def === 1 && dr.abil.atk === 1, '招式開場即 Lv1 可用(無需擊殺解鎖)');
  // Tier 1 has no battle-score gate: money alone suffices. Tier 2 and up need battle score (topped up after the gate checks below)
  assert(sim.buy('p_d', 'ar') === null && (dr.upg.ar || 0) === 1, '第一階無戰鬥分數門檻(只看錢)');
  assert(/戰鬥分數不足/.test(sim.buy('p_d', 'ar') || ''),
    `戰鬥分數 0 買不起第二階(需 ${upgradeScore(ECON.UPGRADES.ar, 1)} 分)`);
  dr.kn = upgradeScore(ECON.UPGRADES.ar, 1);
  const $ar0 = dr.money;
  assert(sim.buy('p_d', 'ar') === null && (dr.upg.ar || 0) === 2
    && $ar0 - dr.money === upgradePrice(ECON.UPGRADES.ar, 1), '分數達標 ⇒ 第二階成交(分數不被扣掉)');
  assert(dr.kn === upgradeScore(ECON.UPGRADES.ar, 1), '戰鬥分數是資格不是貨幣(購買後不減)');
  assert(/戰鬥分數不足/.test(sim.buy('p_d', 'ar') || ''),
    `第三階要 ${upgradeScore(ECON.UPGRADES.ar, 2)} 分`);
  dr.kn = BATTLE_SCORE.MAX;
  // Light/heavy weapons are independent tracks
  assert(sim.buy('p_d', 'lw') === null && dr.abil.light === 2 && dr.abil.heavy === 1,
    '輕武器強化升 Lv.2(只動輕武器,重武器不變)');
  assert(sim.buy('p_d', 'hw') === null && dr.abil.heavy === 2, '重武器強化升 Lv.2(獨立面向)');
  const dmgL2 = heroWeapon('s01', 'light', 2).dmg;
  assert(dmgL2 > heroWeapon('s01', 'light', 1).dmg, `升階後傷害提升(${heroWeapon('s01', 'light', 1).dmg} → ${dmgL2})`);
  assert(sim.buy('p_d', 'def') === null && dr.abil.def === 2 && dr.abil.atk === 1,
    '防守招式強化升 Lv.2(只動防守招式,攻擊招式不變)');
  // Lv4 extrapolation: buying light to max (upg.lw 1 to 3 gives abil.light = 4); tier-4 values extrapolate past Lv3 along the last segment
  sim.buy('p_d', 'lw'); sim.buy('p_d', 'lw');
  assert(dr.abil.light === 4 && heroWeapon('s01', 'light', 4).dmg > heroWeapon('s01', 'light', 3).dmg,
    '輕武器可升到 Lv4(第 4 階外推,傷害 > Lv3)');
  assert(/已滿級/.test(sim.buy('p_d', 'lw') || ''), 'Lv4 後滿級,再買被拒');
  dr.mp = dr.maxMp;
  const A1 = heroAbility('s01', 'def', dr.abil.def);
  const mp0 = dr.mp;
  sim.heroCast('p_d', 'def', dr.x, dr.z);
  assert((dr.achg?.def?.rechargeAt?.length > 0 || dr.acd.def > sim.t) && Math.round(mp0 - dr.mp) === Math.round(A1.mp),
    `施放防守招式:CD、電力 -${Math.round(A1.mp)}MP(隨招式階級,無精通折減)`);
  const mp1 = dr.mp;
  sim.heroCast('p_d', 'def', dr.x, dr.z);
  assert(dr.mp === mp1, 'CD/詠唱中重複施放被拒(電力未扣)');
  // 2026-08-22: guard skills need cast time before taking effect
  assert(dr.mods.length === 0, '守招詠唱中尚未掛 mods');
  sim.tick(A1.castTime + 0.1);
  assert(dr.mods.length > 0, '增益類守招詠唱完成 ⇒ 掛上 mods(蜂群協奏)');
  const rb2 = sim.addHero('STEEL', 'p_r2', 't05');
  rb2.money = 999; rb2.kn = BATTLE_SCORE.MAX;
  assert(sim.buy('p_r2', 'hp') === null && rb2.maxHp > Math.round(UNITS.robot.hp * CHARACTERS.t05.mods.hp),
    `裝甲強化隨處可買(HP 上限 → ${rb2.maxHp})`);
  const sp0max = rb2.maxSp;
  assert(sim.buy('p_r2', 'sp') === null && rb2.maxSp > sp0max, `護盾強化擴上限(${sp0max} → ${rb2.maxSp})`);
  const ar0 = CHARACTERS.t05.mods.armor ?? 0;
  assert(sim.buy('p_r2', 'ar') === null && rb2.armor === ar0 + ECON.UPGRADES.ar.step,
    `複合裝甲 +${ECON.UPGRADES.ar.step} 護甲值(${ar0} → ${rb2.armor})`);
  assert(/沒有這項商品/.test(sim.buy('p_r2', 'railgun') || ''), '舊制軍械庫武器已下架(輕重武器外無其他配置)');
  const $g0 = rb2.money;
  assert(/沒有這項商品/.test(sim.buy('p_r2', 'toString') || '') && rb2.money === $g0 && Number.isFinite(rb2.money),
    '原型鏈鍵名(toString)被拒 —— 共用經濟不被 NaN 污染(hasOwn 守衛)');

  log('— sim:經濟改制(無被動收入 + 重武器耗電 + 充能回復)—');
  {
    const $t0 = rb2.money;
    sim.tick(0.5); sim.tick(0.5);
    assert(rb2.money === $t0, '被動收入停發(金錢只來自擊殺/助攻/物資)');
    const whv = heroWeapon('t05', 'heavy', 1);
    const cost = heavyMpCost(whv);
    assert(cost > 0, `重武器每發耗電 ${cost}MP(彈夾週期 × ${ECON.HEAVY_MP_PER_CD}/s 均攤)`);
    rb2.mp = cost - 1;
    rb2.aiming = true;
    const foe2 = sim._add({ kind: 'tank', side: 'SWARM', x: rb2.x + 20, z: rb2.z, hp: 9999 });
    sim.t += 1;
    const hpF0 = foe2.hp;
    sim.heroHit('p_r2', foe2.id, 'heavy');
    assert(foe2.hp === hpF0, '電力不足 → 重武器禁射');
    rb2.mp = rb2.maxMp;
    sim.t += 1;
    sim.heroHit('p_r2', foe2.id, 'heavy');
    assert(foe2.hp < hpF0 && Math.round(rb2.maxMp - rb2.mp) === cost, `電力充足 → 擊發並扣 ${cost}MP`);
    sim.ents.delete(foe2.id);
    // Charge: Lv0 regen = max x CHARGE_MIN; max = live spec (SP_REGEN_PS / mpRegen)
    assert(Math.abs(chargeF(0) - ECON.CHARGE_MIN) < 1e-9 && Math.abs(chargeF(ECON.UPGRADES.ch.max) - 1) < 1e-9,
      `充能曲線:Lv0 = ${ECON.CHARGE_MIN * 100}% 規格、滿級 = 100% 現役規格`);
    const mpLow = rb2.mp = 10;
    sim.tick(1.0);
    const gain0 = rb2.mp - mpLow;
    rb2.upg.ch = ECON.UPGRADES.ch.max;
    rb2.mp = 10;
    sim.tick(1.0);
    const gainMax = rb2.mp - 10;
    assert(gainMax > gain0 * 1.5, `充能滿級電力回速 ×${(gainMax / gain0).toFixed(2)}(Lv0 ${gain0.toFixed(1)} → 滿級 ${gainMax.toFixed(1)} MP/s)`);
    rb2.upg.ch = 0;
  }

  log('— sim:助攻(純傷害 = 貢獻;賞金 × 1/4)—');
  {
    const prey = sim._add({ kind: 'tank', side: 'SWARM', x: rb2.x + 22, z: rb2.z, hp: UNITS.tank.hp });
    rb2.ammo = {}; rb2.fireAt = {}; rb2.reloadUntil = {}; rb2.mp = rb2.maxMp;
    sim.t += 1;
    sim.heroHit('p_r2', prey.id);            // rb2 deals damage = assist credit
    assert(prey.asst && prey.asst.p_r2 != null, '傷害貢獻戳記入帳');
    const $a0 = rb2.money;
    sim._damage(prey, 99999, null, 999);     // Killer is not a hero (e.g. tower), so no kill bounty, but assists still pay
    assert(!sim.ents.has(prey.id), '測試目標已被擊殺');
    assert(rb2.money - $a0 >= Math.floor(ECON.BOUNTY.tank * ECON.ASSIST.F),
      `助攻入帳 +$${Math.round(rb2.money - $a0)}(= 賞金 ${ECON.BOUNTY.tank} × ${ECON.ASSIST.F})`);
    assert(sim.events.some((e) => e.e === 'assist' && e.pid === 'p_r2'), 'assist 事件廣播(HUD 提示)');
    // Pure-damage rule: area EMP (pure debuff) writes no assist credit
    const empc = sim.addHero('SWARM', 'p_e', 's03');
    const mark = sim._add({ kind: 'tank', side: 'STEEL', x: empc.x + 10, z: empc.z, hp: 9999 });
    empc.abil.atk = 1; empc.mp = empc.maxMp;
    sim.heroCast('p_e', 'atk', empc.x, empc.z);
    // Atk is carrier-delivered: EMP is cast by the bomber at the drop point, so wait out its delivery leg
    for (let i = 0; i < 400 && !((mark.empUntil || 0) > sim.t); i++) sim.tick(0.125);
    assert((mark.empUntil || 0) > sim.t && !(mark.asst && mark.asst.p_e != null),
      '範圍 EMP(純負面狀態)不寫入助攻貢獻戳記');
    sim.ents.delete(mark.id);
    // Killer-is-also-hero path (old test only covered non-hero finishers): killer takes full bounty, other contributors take ASSIST.F
    const ally = sim.addHero('STEEL', 'p_al', charsOf('STEEL')[0]);
    const prey2 = sim._add({ kind: 'tank', side: 'SWARM', x: rb2.x + 24, z: rb2.z, hp: UNITS.tank.hp });
    sim.t += 1;
    sim._damage(prey2, 40, rb2);              // rb2 deals damage = assist credit
    const $b0 = rb2.money, $k0 = ally.money;
    sim._damage(prey2, 99999, ally);          // Another hero lands the finishing blow
    assert(Math.round(ally.money - $k0) === ECON.BOUNTY.tank, `英雄補刀拿全額賞金 +$${Math.round(ally.money - $k0)}`);
    assert(Math.abs((rb2.money - $b0) - ECON.BOUNTY.tank * ECON.ASSIST.F) < 1e-6,
      `英雄補刀時助攻仍入帳 +$${(rb2.money - $b0).toFixed(2)}(= ${ECON.BOUNTY.tank} × ${ECON.ASSIST.F})`);
    assert(sim.stats.STEEL.assists >= 1, '計分板助攻欄位累計(玩家看得見助攻在發)');
    sim.heroes.delete('p_al'); sim.squads.delete('p_al');
    for (const b of [...sim.ents.values()]) if (b.pid === 'p_al') sim.ents.delete(b.id);
  }

  log('— sim:出兵間隔固定 + 開場預置兵線(到第一座砲塔為止)—');
  {
    const iv = waveInterval();
    assert(iv === GAME.WAVE_S && waveInterval(1) === waveInterval(99),
      `出兵間隔固定 ${iv}s(不隨波次加速;GAME.WAVE_S 單一縫)`);
    assert(Math.abs(waveSpacingM() - iv * waveMarchSpeed()) < 1e-9 && waveMarchSpeed() === Math.min(...waveComp().map((k) => UNITS[k].speed)),
      `預置間距 ${waveSpacingM().toFixed(0)}m = 間隔 ${iv}s × 行軍速度 ${waveMarchSpeed()}m/s(編制最慢者,推導不手寫)`);
    const ps = new BattleSim(fakeBattleConfig(1));
    const KINDS = waveComp();
    const pre = [...ps.ents.values()].filter((e) => KINDS.includes(e.kind) && e.wv < 0);
    assert(pre.length > 0 && pre.length % (KINDS.length * 2) === 0,
      `開場預置 ${pre.length / (KINDS.length * 2)} 波/線/側(雙方對稱)`);
    const total = cumLen(ps.lanes[0]).at(-1);
    const sites = ps.towerSites[0];
    const limit = total * sites.at(-1).frac;   // First turret = frontmost tower (last item returned by solveTowerSites)
    const leads = [...new Set(pre.map((e) => e.wv))].sort((a, b) => b - a)
      .map((wv) => Math.max(...pre.filter((e) => e.wv === wv).map((e) => e.prog)));
    assert(Math.max(...leads) <= limit + 1e-6, `預置最前一波 ${Math.max(...leads).toFixed(0)}m ≤ 第一座砲塔 ${limit.toFixed(0)}m`);
    assert(leads.every((p, i) => i === 0 || Math.abs(p - leads[i - 1] - waveSpacingM()) < 1e-6),
      `預置各波沿兵線等距 ${waveSpacingM().toFixed(0)}m(對應出兵間隔)`);
    assert(new Set(pre.map((e) => e.wv)).size === leads.length && !pre.some((e) => e.wv >= 0),
      '預置波序為負(凝聚錨定桶不與開局第一波混同)');
  }

  log('— sim:招式詠唱前搖鎖定(武器/招式不可用)與異常狀態致死擊殺結算 —');
  {
    const simLock = new BattleSim(fakeBattleConfig(1));
    purgeCamps(simLock);
    const h1 = simLock.addHero('SWARM', 'p_lock1', 's01');
    h1.mp = 999; h1.abil.def = 1; h1.abil.atk = 1;
    // 1. guard windup locks weapons and other abilities
    simLock.heroCast('p_lock1', 'def');
    assert(!!h1.cast, '守招進入詠唱狀態');
    assert(!simLock._gateFire(h1, 'light', simLock.t), '守招詠唱中武器開火被鎖定');
    assert(!simLock._gateFire(h1, 'heavy', simLock.t), '守招詠唱中重武器被鎖定');
    const castStartN = simLock.events.filter((e) => e.e === 'cast_start').length;
    simLock.heroCast('p_lock1', 'atk');
    assert(simLock.events.filter((e) => e.e === 'cast_start').length === castStartN, '詠唱中無法施放其他招式');

    // 2. kills by status (bleed / DoT) credit the applier
    const victim = simLock._add({ kind: 'tank', side: 'STEEL', x: h1.x + 10, z: h1.z, hp: 50 });
    victim.bleed = { dps: 30, until: simLock.t + 5, pid: 'p_lock1' };
    const $m0 = h1.money;
    const kn0 = h1.kn;
    simLock._damage(victim, 100, null); // Killed by DoT drain (by is null)
    assert(!simLock.ents.has(victim.id), '目標被異常狀態扣死');
    assert(h1.money > $m0, '異常狀態致死:施加者獲得賞金');
    assert(h1.kn > kn0, '異常狀態致死:施加者獲得戰鬥分數');
    assert(simLock.events.some((e) => e.e === 'die' && e.id === victim.id), '異常狀態致死:正確派發 die 陣亡事件');
  }

  log('— sim:陣營小兵強化(同陣營共用・兵線分開・成長率 log(LV))—');
  {
    const cs = new BattleSim(fakeBattleConfig(3));
    purgeCamps(cs);
    const a = cs.addHero('SWARM', 'p_c1', charsOf('SWARM')[0]);
    const b = cs.addHero('SWARM', 'p_c2', charsOf('SWARM')[1]);
    assert(creepUpgMul(0) === 1 && Math.abs(creepUpgMul(CREEP_UPG.MAX) - (1 + Math.log10(1 + CREEP_UPG.MAX))) < 1e-9,
      `倍率曲線 1+log10(1+LV):LV0 ×1.00 → LV${CREEP_UPG.MAX} ×${creepUpgMul(CREEP_UPG.MAX).toFixed(2)}`);
    a.money = 99999;
    assert(cs.buy('p_c1', 'creep', 0) !== null, '八軌未滿級不得購買陣營小兵強化');
    for (const [k, u] of Object.entries(ECON.UPGRADES)) a.upg[k] = u.max;
    a.money = CREEP_UPG.PRICE * 2;
    assert(cs.buy('p_c1', 'creep', 99) !== null && cs.buy('p_c1', 'creep', null) !== null, '非法兵線編號被拒');
    const $c0 = a.money;
    assert(cs.buy('p_c1', 'creep', 1) === null && cs.creepUpg.SWARM[1] === 1 && $c0 - a.money === CREEP_UPG.PRICE,
      `每階 $${CREEP_UPG.PRICE}(LV1 到帳)`);
    assert(cs.creepUpg.SWARM[0] === 0 && cs.creepUpg.SWARM[2] === 0 && cs.creepUpg.STEEL[1] === 0,
      '不同兵線分開強化、敵方陣營不受影響');
    // Shared within a side: a second player (all eight tracks maxed) buying the same lane stacks onto the same level
    for (const [k, u] of Object.entries(ECON.UPGRADES)) b.upg[k] = u.max;
    b.money = CREEP_UPG.PRICE;
    assert(cs.buy('p_c2', 'creep', 1) === null && cs.creepUpg.SWARM[1] === 2, '同陣營全玩家共用同一份等級(隊友續購疊加)');
    assert(cs.buy('p_c2', 'creep', 1) !== null, '資金不足被拒(不透支)');
    // 2026-08-11 user rework: creep upgrades only apply versus non-players (bots included) --
    // only e.cu is fixed at spawn; hp and bounty no longer take the multiplier.
    cs.creepUpg.SWARM[2] = CREEP_UPG.MAX;
    const mul = creepUpgMul(CREEP_UPG.MAX);
    cs._spawnLaneWave(2, 'SWARM', 7, GAME.WAVE_SPAWN_OFF_M);
    const up = [...cs.ents.values()].find((e) => e.wv === 7 && e.kind === 'tank');
    const plain = cs._add({ kind: 'tank', side: 'STEEL', x: 1e5, z: 1e5, hp: UNITS.tank.hp });
    assert(up.hp === UNITS.tank.hp && Math.abs(up.cu - mul) < 1e-9,
      `hp 不吃倍率(${up.hp} = 表列 ${UNITS.tank.hp};耐久改走受擊側)`);
    assert(cs._bounty(up) === ECON.BOUNTY.tank && cs._bounty(plain) === ECON.BOUNTY.tank,
      `陣亡賞金不再 ×${mul.toFixed(2)}(強化兵與未強化兵同為 $${ECON.BOUNTY.tank})`);
    // Durability side: non-hero attackers versus upgraded creeps take the same total-durability boost as the old (hp x cu + armor x cu), bit-identical
    const AR = UNITS.tank.armor || 0;
    const oldEhp = UNITS.tank.hp * mul / armorMul(AR * mul, 0);
    const hp0 = up.hp, hp1 = plain.hp;
    cs._damage(up, 100, null, 0); cs._damage(plain, 100, null, 0);
    const tookUp = hp0 - up.hp, tookPlain = hp1 - plain.hp;
    assert(tookUp < tookPlain, `非玩家來源的傷害吃強化護甲(強化兵扣 ${tookUp.toFixed(1)} < 未強化 ${tookPlain.toFixed(1)})`);
    assert(Math.abs(UNITS.tank.hp / (tookUp / 100) - oldEhp) < 1e-6,
      `對非玩家的總耐久 = 舊制 hp×${mul.toFixed(2)} + armor×${mul.toFixed(2)}(EHP ${Math.round(oldEhp)},逐位元相同)`);
    // Players (bots included) versus upgraded creeps: bit-identical to unupgraded
    const hero = cs.heroes.get('p_c2');
    const up2 = cs._add({ kind: 'tank', side: 'STEEL', x: 1e5, z: 1e5, hp: UNITS.tank.hp, cu: mul });
    const pl2 = cs._add({ kind: 'tank', side: 'STEEL', x: 1e5, z: 1e5, hp: UNITS.tank.hp });
    const a0 = up2.hp, b0 = pl2.hp;
    cs._damage(up2, 100, hero, 0); cs._damage(pl2, 100, hero, 0);
    assert(Math.abs((a0 - up2.hp) - (b0 - pl2.hp)) < 1e-9,
      `玩家打強化兵 = 打未強化兵(各扣 ${(a0 - up2.hp).toFixed(1)});強化在玩家眼裡完全不存在`);
    assert(JSON.stringify(cs.snapshot().cu.SWARM) === JSON.stringify(cs.creepUpg.SWARM), '快照帶陣營小兵強化等級(商店唯讀顯示)');
  }

  log('— sim:非正規路線防空伏擊(需射程內有存活陣地)+ 飛彈可破壞 —');
  const site0 = [...sim.ents.values()].find((e) => e.kind === 'aasite');
  assert(!!site0, '匿蹤防空陣地已生成');
  // Park all three above the site (off-corridor); y=30 stays clear of fire fields.
  // Wingmen still regrouping along the lane cannot mass a three-ship volley to kill the missile, so place them straight into formation.
  // Make them immortal: keep turret fire, stray rounds, and ambushes from downing the test ships (only ambush and missile damage are under test).
  sq.bodies.forEach((b, i) => {
    b.x = site0.x + i * 8; b.z = site0.z; b.y = 30;
    b.hp = b.maxHp = 99999; b.rg = false;
  });
  let launched = null;
  for (let i = 0; i < 800 && !launched && !dr.dead; i++) {
    sim.tick(0.125);
    launched = sim.missiles.find((m) => m.tid === dr.id);   // Only the main-view hull counts (wingmen are ambushed separately too)
  }
  assert(!!launched, '偏離兵線走廊 → 匿蹤防空飛彈升空');
  assert(sim.events.some((e) => e.e === 'sam' && e.ambush), 'sam 事件帶 ambush 旗標(客戶端警告)');
  if (launched && !dr.dead) {
    dr.ammo = {}; dr.fireAt = {}; dr.reloadUntil = {};
    const $0 = dr.money;
    for (let i = 0; i < 5 && sim.missiles.includes(launched); i++) {
      sim.t += 0.2;
      sim.hitMissile('p_d', launched.id, 'gun');
    }
    assert(!sim.missiles.includes(launched), '來襲飛彈被機槍擊毀');
    assert(dr.money - $0 >= ECON.BOUNTY.missile, `擊落飛彈賞金 +$${ECON.BOUNTY.missile}`);
  }
}

// ================= direct sim checks: win/loss settlement =================
// A full-HP fortress takedown takes about 480s; re-verifying DPS and official HP already guarded by bal would only repeat work.
// Here the base is squeezed to the critical value, keeping only the needed authoritative settlement, event, and snapshot contracts.
log('— sim:勝負結算(gameOver 事件 + 快照)—');
{
  const sim = new BattleSim(fakeBattleConfig(1));
  purgeCamps(sim);
  const attacker = sim.addHero('SWARM', 'p_win', 's02');
  const base = [...sim.ents.values()].find((e) => e.kind === 'base' && e.side === 'STEEL');
  base.hp = 1;
  sim._damage(base, 99999, attacker, 999);
  const snap = sim.snapshotFor(null);
  assert(sim.over && sim.winner === 'SWARM', '敵方主堡被摧毀後立即結算蜂群獲勝');
  assert(snap.ev.some((e) => e.e === 'gameOver' && e.winner === 'SWARM'),
    '勝負快照送出 gameOver 事件與勝方');
  assert(snap.over && snap.winner === 'SWARM', '權威快照帶 over 與 winner');
}

// ================= direct sim checks: fog of war (unit-type entities are sight-limited; buildings/neutrals always visible) =================
log('— sim:霧戰爭(視野外的敵方單位不進快照;瞄準模式加成視野;建築/中立物永遠可見)—');
{
  const sim = new BattleSim(fakeBattleConfig(1));
  const dr = sim.addHero('SWARM', 'p_fow');
  dr.x = 0; dr.z = 0; dr.y = 0;
  const sightBase = UNITS[dr.kind].sight;                    // Randomized hull (drone/robot merc) sight baseline; the test never hardcodes it
  const nearSight = sightBase * 0.5;                         // Clearly inside sight
  const farOut = sightBase * 1.5;                            // Clearly outside sight (not aiming)
  const near = sim._add({ kind: 'soldier', side: 'STEEL', x: nearSight, z: 0, hp: UNITS.soldier.hp });
  const far = sim._add({ kind: 'soldier', side: 'STEEL', x: farOut, z: 0, hp: UNITS.soldier.hp });
  const enemyHero = sim.addHero('STEEL', 'p_fow2');
  enemyHero.x = farOut; enemyHero.z = 50;

  let snap = sim.snapshotFor('SWARM');
  const ids = new Set(snap.ents.map((e) => e.id));
  assert(ids.has(near.id), '視野內的敵方小兵有進快照');
  assert(!ids.has(far.id), '視野外的敵方小兵不進快照');
  assert(!ids.has(enemyHero.id), '視野外的敵方英雄不進快照');
  assert(ids.has(dr.id), '己方英雄永遠看得到自己');

  // Towers / bases / neutrals do not count as units and stay visible even outside sight
  const farTower = [...sim.ents.values()].find((e) => e.kind === 'tower' && e.side === 'STEEL');
  const farBase = [...sim.ents.values()].find((e) => e.kind === 'base' && e.side === 'STEEL');
  const neutral = [...sim.ents.values()].find((e) => e.neutral);
  assert(ids.has(farTower.id) && ids.has(farBase.id), '敵方塔/主堡不受霧戰爭影響,永遠可見');
  assert(!neutral || ids.has(neutral.id), '中立實體(障礙/防空陣地)不受霧戰爭影響');

  // Aim mode: sight bonus should reveal enemy creeps previously outside sight
  const aimTarget = sim._add({ kind: 'soldier', side: 'STEEL', x: sightBase * 1.3, z: 0, hp: UNITS.soldier.hp });
  let idsNoAim = new Set(sim.snapshotFor('SWARM').ents.map((e) => e.id));
  assert(!idsNoAim.has(aimTarget.id), '瞄準前:1.3 倍視野外看不到');
  dr.aiming = true;
  let idsAim = new Set(sim.snapshotFor('SWARM').ents.map((e) => e.id));
  assert(idsAim.has(aimTarget.id), `瞄準模式視野加成(×${GAME.AIM_SIGHT_MULT})後看得到`);

  // Spectators (side=null) have no fog and see everything
  const specIds = new Set(sim.snapshotFor(null).ents.map((e) => e.id));
  assert(specIds.has(far.id) && specIds.has(enemyHero.id), '觀戰者(無側別)收到無霧全局快照');
}

// ================= direct sim checks: hazard zones (Diablo-style random spawns) =================
log('— sim:障礙物生成(避開走廊/主堡)+ 防空陣地可擊毀 —');
{
  const sim = new BattleSim(fakeBattleConfig(2));
  purgeCamps(sim);
  const haz = [...sim.ents.values()].filter((e) => e.haz);
  const sites = [...sim.ents.values()].filter((e) => e.kind === 'aasite');
  assert(haz.length >= FIELD.HAZ_PER_LANE, `障礙物 ${haz.length} 個(目標 ${FIELD.HAZ_PER_LANE}/線)`);
  assert(haz.every((h) => sim._distToLanes(h.x, h.z) >= FIELD.HAZ_LANE_MIN), '障礙物避開兵線走廊(不擋正規路線)');
  assert(sites.length >= FIELD.AA_SITES_PER_LANE, `防空陣地 ${sites.length} 座`);
  const bases = Object.values(sim.basePos);
  assert(haz.concat(sites).every((h) =>
    bases.every(([bx, bz]) => Math.hypot(h.x - bx, h.z - bz) >= FIELD.HAZ_BASE_CLEAR)), '主堡周圍淨空');
  assert(haz.every((h) => h.sc > 0 && HAZARDS[h.kind]), `每個障礙帶隨機尺寸差異(sc)與合法類型`);

  // Killing an AA site pays bounty plus a die event, and it drops out of snapshots
  const rb = sim.addHero('STEEL', 'hz_r');
  const site = sites[0];
  rb.x = site.x + 10; rb.z = site.z;
  const $0 = rb.money;
  for (let i = 0; i < 40 && sim.ents.has(site.id); i++) { sim.t += 0.3; sim.heroHit('hz_r', site.id); }
  assert(!sim.ents.has(site.id), '防空陣地被機槍拆除(= 打出安全空域)');
  assert(rb.money - $0 >= ECON.BOUNTY.aasite, `拆陣地賞金 +$${ECON.BOUNTY.aasite}`);
  assert(sim.events.some((e) => e.e === 'die' && e.kind === 'aasite'), 'die 事件帶 aasite(客戶端播報)');

  // Indestructible obstacles (collapse / landslide / fire / flood) cannot be destroyed
  const inv = haz.find((h) => h.inv);
  if (inv) {
    sim.t += 1;
    sim.heroHit('hz_r', inv.id);
    assert(sim.ents.has(inv.id) && inv.hp === inv.maxHp, `不可摧毀障礙(${HAZARDS[inv.kind].name})免疫傷害`);
  }

  // Destructible obstacle drops random loot, then pickup on approach
  sim.loots = [];
  sim._spawnLoot(rb.x + 3, rb.z);
  const loot = sim.loots[0];
  const isAmmo = !!loot.ammo, isAffix = !!loot.af;
  const $1 = rb.money;
  rb.ammo.light = 5;                       // Build a half-magazine state to verify reload refill
  rb.x = loot.x; rb.z = loot.z; rb.y = 0;
  sim.tick(0.05);
  assert(sim.loots.length === 0, `戰場物資被拾取(${isAmmo ? '彈藥補給' : isAffix ? '詞綴強化' : '現金'})`);
  if (isAmmo) assert(rb.ammo.light == null, '彈藥補給清空計數 = 下次開火滿彈夾');
  else if (isAffix) assert(rb.buffs[loot.af] > sim.t, `詞綴強化生效(${AFFIXES[loot.af].name})`);
  else assert(rb.money > $1, `現金物資入帳 +$${Math.round(rb.money - $1)}`);
  assert(sim.events.some((e) => e.e === 'loot' && e.pid === 'hz_r'), 'loot 事件帶 pid');

  // Fire-field DoT (deterministic): only low-altitude/ground suffer; shield and HP drain together by maxSp:maxHp split (HP share ignores armor); high altitude immune.
  // Pump the hazard subsystem a fixed count directly (no full sim.tick), so waves, bots, regen, and enemy fire cannot pollute it; total equals dot x duration.
  // Historical flaky root cause was not CI tick pacing: an earlier random affix roll of hardened (dmgTaken 0.75) shrinks the burn to 22.5, so
  // clear buffs/mods to isolate it, and top up both pools (no bottom clamp) so the split verifies exactly.
  const fire = sim._add({ kind: 'fire', side: null, neutral: true, haz: true, inv: true, x: rb.x + 300, z: rb.z + 300, sc: 1, hp: 1 });
  sim._fires.push(fire);
  rb.buffs = {}; rb.mods = [];                          // Isolate the loot-affix (dmgTaken) scaling of the burn
  rb.sp = rb.maxSp; rb.hp = rb.maxHp;                   // Top up both pools, so no Math.max floor clamp applies and both shares verify exactly
  rb.x = fire.x; rb.z = fire.z; rb.y = 0;               // Stand in the fire field at ground level (y=0 avoids the offGround/maxY exemption)
  const spF = rb.sp, hpF = rb.hp, denom = rb.maxSp + rb.maxHp;
  const BURN_DT = 0.125, BURN_N = 8;                    // 8 x 0.125 = 1 second
  const burnTot = HAZARDS.fire.dot * BURN_DT * BURN_N;  // = dot (burn per second)
  for (let i = 0; i < BURN_N; i++) sim._tickHazards(BURN_DT);
  const spDrop = spF - rb.sp, hpDrop = hpF - rb.hp;
  assert(Math.abs((spDrop + hpDrop) - burnTot) < 1e-6, `火場灼傷 ${Math.round(spDrop + hpDrop)}/秒(確定性總傷 = dot×時距)`);
  assert(Math.abs(spDrop - burnTot * rb.maxSp / denom) < 1e-6, '灼傷護盾份 = 依 maxSp 比例(同扣護盾)');
  assert(Math.abs(hpDrop - burnTot * rb.maxHp / denom) < 1e-6, 'HP 份 = 依 maxHp 比例(不吃裝甲)');
  // High altitude immune to burn (first remove AA sites plus enemy towers/base: tower range 310 already reaches the fire coords,
  // keeping them would let tower/SAM fire pollute the high-altitude-no-burn HP assertions)
  // (2026-07-12: tower range 310 plus creep buffs put the fire coords inside the enemy fire net, so keep only the fire and clear all other enemy units)
  for (const s of [...sim.ents.values()]) {
    if (s.kind === 'aasite' || s.side === 'STEEL') sim.ents.delete(s.id);
  }
  sim.missiles.length = 0;
  const dr2 = sim.addHero('SWARM', 'hz_d');
  dr2.x = fire.x; dr2.z = fire.z; dr2.y = HAZARDS.fire.maxY + 20;
  const hpD = dr2.hp;
  for (let i = 0; i < 8; i++) sim.tick(0.125);
  assert(dr2.hp === hpD, '高空飛越火場不受灼傷,且陣地拔光後無伏擊');
}

// ================= direct sim checks: Diablo progression (TreasureClass / affixes / relays / connectivity) =================
log('— sim:TreasureClass 分層 + 詞綴強化 + 偵察中繼站 + 連通性保證 —');
{
  const sim = new BattleSim(fakeBattleConfig(2));

  // TreasureClass: tc=1 (hardest obstacles) rolls rare tiers (ammo/affix) more often than tc=0
  const rareRate = (tc) => {
    let n = 0;
    for (let i = 0; i < 400; i++) {
      sim.loots = [];
      sim._spawnLoot(0, 0, tc);
      const l = sim.loots[0];
      if (l.ammo || l.af) n++;
    }
    return n / 400;
  };
  const r0 = rareRate(0), r1 = rareRate(1);
  assert(r1 > r0 + 0.1, `TC 稀有度偏移生效(tc=0 → ${(r0 * 100).toFixed(0)}%,tc=1 → ${(r1 * 100).toFixed(0)}% 稀有)`);
  sim.loots = [];

  // Affixes (server-settled): tempered ordnance shortens reload, composite armor reduces damage, snapshots carry bf countdown
  const rb = sim.addHero('STEEL', 'af_r', 't01');
  const wl2 = heroWeapon('t01', 'light', 1);
  rb.buffs.tempered = sim.t + 999;
  rb.ammo.light = 5;
  sim.heroReload('af_r', 'light');
  const rl = rb.reloadUntil.light - sim.t;
  assert(Math.abs(rl - wl2.reload * AFFIXES.tempered.reload) < 1e-6,
    `淬火軍械:填彈 ${rl.toFixed(2)}s(${wl2.reload}s × ${AFFIXES.tempered.reload})`);
  rb.buffs.hardened = sim.t + 999;
  rb.sp = 0;   // Drain shields to verify the armor-layer formula directly
  const hp0 = rb.hp;
  sim._damage(rb, 100, null);
  const expArmor = 100 * AFFIXES.hardened.dmgTaken * armorMul(rb.armor);
  assert(Math.abs((hp0 - rb.hp) - expArmor) < 0.5,
    `複合裝甲 × 護甲值:100 傷害實吃 ${(hp0 - rb.hp).toFixed(1)}(減傷 ${AFFIXES.hardened.dmgTaken} × 護甲 ${rb.armor})`);
  assert(sim.snapshotFor('STEEL').ents.find((e) => e.pid === 'af_r').bf?.length === 2, '快照帶詞綴倒數(bf)');

  // Scout relay: 1 per lane, off-corridor (must risk reaching it); capture, vision pulse, then self-destruct
  const relays = [...sim.ents.values()].filter((e) => e.kind === 'relay');
  assert(relays.length === sim.lanes.length, `中繼站 ${relays.length} 座(${FIELD.RELAY.PER_LANE}/線)`);
  assert(relays.every((r) => sim._distToLanes(r.x, r.z) >= FIELD.RELAY.laneMin), '中繼站在兵線走廊之外');
  for (const s of [...sim.ents.values()]) if (s.kind === 'aasite') sim.ents.delete(s.id);   // Rule out ambush interference
  const dr = sim.addHero('SWARM', 'rl_d');
  dr.x = relays[0].x; dr.z = relays[0].z; dr.y = 0;
  dr.hp = 99999;   // Relay sits inside tower range 310: as in the AA ambush test, pad HP against tower kills (an interrupted capture = flaky)
  for (let i = 0; i < 28; i++) sim.tick(0.125);   // 3.5s > CHANNEL_S
  assert(sim.visionUntil.SWARM > sim.t, '佔用 3 秒 → 全隊視野脈衝啟動');
  assert([...sim.ents.values()].filter((e) => e.kind === 'relay').length === relays.length - 1, '中繼站用過即毀');
  assert(sim.events.some((e) => e.e === 'relay' && e.side === 'SWARM'), 'relay 事件帶陣營(客戶端播報)');
  const far = sim._add({ kind: 'soldier', side: 'STEEL', x: relays[0].x + 2000, z: relays[0].z, hp: UNITS.soldier.hp });
  let ids = new Set(sim.snapshotFor('SWARM').ents.map((e) => e.id));
  assert(ids.has(far.id), '視野脈衝生效中:霧外敵軍照樣進快照');
  sim.t += FIELD.RELAY.VISION_S + 2;
  ids = new Set(sim.snapshotFor('SWARM').ents.map((e) => e.id));
  assert(!ids.has(far.id), '脈衝過期:恢復正常迷霧');
  sim.ents.delete(far.id);   // Test dummy has no lane; clear it so later ticks do not blow up

  // Connectivity guarantee (flood-fill): natural spawns already connect; artificial cross walls are detected and breached
  const nb0 = sim.hazBlockers.length;
  sim._ensureConnectivity();
  assert(sim.hazBlockers.length === nb0, '連通性檢查:走廊淨空保證兩堡互通,無需拆牆');
  const midZ = (sim.basePos.SWARM[1] + sim.basePos.STEEL[1]) / 2;
  for (let x = -1600; x <= 1600; x += 18) sim.hazBlockers.push([x, midZ, 12]);
  const nb1 = sim.hazBlockers.length;
  sim._ensureConnectivity();
  assert(sim.hazBlockers.length < nb1, `人工橫斷牆被偵測,拆 ${nb1 - sim.hazBlockers.length} 段開出缺口`);
}

// ================= direct sim checks: third-party armies (guerrillas / armed militia) =================
log('— sim:第三方軍隊(佈營淨空 / 迷霧隱藏 / 碉堡駐守 / 繫繩 / 重生暫停)—');
{
  const sim = new BattleSim(fakeBattleConfig(2));
  const camps = sim.camps || [];
  assert(camps.length > 0 && camps.length <= sim.lanes.length * 2,
    `野營 ${camps.length} 團(上限 = 兵線數 × 2;塞不下的團寧缺勿錯)`);
  const bunkers = [...sim.ents.values()].filter((e) => e.kind === 'bunker');
  assert(bunkers.length === camps.length, '每團一座碉堡');
  assert(UNITS.bunker.hp === Math.round(UNITS.tower.hp / 2), `碉堡 HP = 砲塔一半(${UNITS.bunker.hp})`);
  // Camp placement hard constraint: every turret/base on both sides at range x 1.5 or more, and clear of lane corridors
  const towers = [...sim.ents.values()].filter((e) => e.kind === 'tower');
  const rT = UNITS.tower.range * THIRD.CLEAR_F;
  const rB = Math.max(UNITS.base.range, UNITS.base.guns.range) * THIRD.CLEAR_F;
  assert(camps.every((c) => towers.every((t) => Math.hypot(c.x - t.x, c.z - t.z) >= rT)),
    `野營離所有砲塔 ≥ 塔射程 × ${THIRD.CLEAR_F}(${rT}m)`);
  assert(camps.every((c) => Object.values(sim.basePos).every(([bx, bz]) => Math.hypot(c.x - bx, c.z - bz) >= rB)),
    `野營離兩主堡 ≥ 主堡射程 × ${THIRD.CLEAR_F}(${rB}m)`);
  assert(camps.every((c) => sim._distToLanes(c.x, c.z) >= THIRD.LANE_MIN),
    `野營離兵線走廊 ≥ ${THIRD.LANE_MIN}m(> NPC 最大射程:不掃兵線)`);
  // Order of battle: guerrillas = 3 rifles + rockets + tank; armed militia = 3 rifles + grenades + helicopter
  const campEnts = (ci) => [...sim.ents.values()].filter((e) => e.tp && e.ci === ci && e.kind !== 'bunker');
  const kindsOf = (ci) => campEnts(ci).map((e) => e.kind).sort().join(',');
  const gi = camps.findIndex((c) => c.type === 'GUER');
  const mi = camps.findIndex((c) => c.type === 'MILI');
  if (gi >= 0) assert(kindsOf(gi) === [...THIRD.COMP.GUER].sort().join(','), `游擊隊編制(${kindsOf(gi)})`);
  if (mi >= 0) assert(kindsOf(mi) === [...THIRD.COMP.MILI].sort().join(','), `武裝民兵編制(${kindsOf(mi)})`);
  // At battle start all hide in fog of war (units follow normal fog rules; bunkers are not towers/bases); spectators see through fog
  const ids0 = new Set(sim.snapshotFor('SWARM').ents.map((e) => e.id));
  assert(campEnts(0).every((e) => !ids0.has(e.id)) && !ids0.has(camps[0].bunker.id),
    '第三方單位與碉堡開戰時藏在戰爭迷霧');
  assert(sim.snapshotFor(null).ents.some((e) => e.k === 'bunker'), '觀戰(無霧)快照帶碉堡');
  // Garrison: half-HP rifleman enters bunker for defense, immune plus untargetable plus slow regen; exits at full HP
  const c0 = camps[0];
  const sold = campEnts(0).find((e) => e.kind === 'soldier');
  sold.hp = Math.round(sold.maxHp * 0.4);
  sold.x = c0.x + 3; sold.z = c0.z;
  sim._tpBehave(sold, 0.125);
  assert(sold.gar === 1, '半血步槍兵進碉堡駐守');
  const hpG = sold.hp;
  sim._damage(sold, 9999, null, 999);
  assert(sold.hp === hpG, '駐守中免傷(碉堡保護)');
  const rb = sim.addHero('STEEL', 'tp_r', 't01');
  rb.x = c0.x + 20; rb.z = c0.z;
  sim.t += 1;
  sim.heroHit('tp_r', sold.id);
  assert(sold.hp === hpG, '駐守中不可被命中(heroHit 早退)');
  sim._tpBehave(sold, 10);
  assert(sold.hp > hpG, `駐守緩慢回血(${THIRD.GAR_REGEN_PS * 100}%/s)`);
  assert(sim.snapshotFor(null).ents.find((e) => e.id === sold.id)?.gar === 1, '快照帶 gar 旗標(客戶端隱藏機體)');
  sold.hp = sold.maxHp;
  sim._tpBehave(sold, 0.125);
  assert(!sold.gar, '回滿血自動出堡');
  // Tether: beyond TETHER_M from the bunker means instant recall (movement converges on the bunker)
  sold.x = c0.x + THIRD.TETHER_M + 30; sold.z = c0.z;
  sim._tpBehave(sold, 0.125);
  assert(sold.ret === 1, `離碉堡 > ${THIRD.TETHER_M}m → 馬上撤回`);
  const dx0 = Math.abs(sold.x - c0.x);
  sim._tpMove(sold, UNITS.soldier, 0.5);
  assert(Math.abs(sold.x - c0.x) < dx0, '撤回中朝碉堡移動');
  // Fighting pays bounty, and the dead enter the 60s respawn pool
  const $0 = rb.money;
  const prey = campEnts(0).find((e) => e.kind !== 'soldier');
  prey.hp = 1;
  sim.t += 1;
  sim.heroHit('tp_r', prey.id);
  assert(!sim.ents.has(prey.id), '第三方單位可被擊殺');
  assert(rb.money - $0 >= ECON.BOUNTY[prey.kind], `交戰得賞金 +$${Math.round(rb.money - $0)}`);
  assert(c0.pool.length === 1 && c0.pool[0].rem === THIRD.UNIT_RESPAWN_S,
    `陣亡單位進 ${THIRD.UNIT_RESPAWN_S}s 重生池`);
  // Destroyed bunker respawns in place after 180s; unit respawns pause their countdown meanwhile
  const bk = c0.bunker;
  const $b = rb.money;
  bk.hp = 0;
  sim._kill(bk, rb);
  assert(!c0.bunker && c0.bunkerRem === THIRD.BUNKER_RESPAWN_S,
    `碉堡被拆 → ${THIRD.BUNKER_RESPAWN_S}s 原地重生倒數`);
  assert(rb.money - $b >= ECON.BOUNTY.bunker, `拆碉堡賞金 +$${ECON.BOUNTY.bunker}`);
  const rem0 = c0.pool[0].rem;
  sim._tickCamps(10);
  assert(c0.pool[0].rem === rem0, '碉堡不存在:單位重生暫停倒數');
  sim._tickCamps(THIRD.BUNKER_RESPAWN_S);
  assert(!!c0.bunker && c0.bunker.kind === 'bunker'
    && Math.hypot(c0.bunker.x - c0.x, c0.bunker.z - c0.z) < 1, '碉堡時限到 → 原地重生');
  sim._tickCamps(THIRD.UNIT_RESPAWN_S + 1);
  assert(c0.pool.length === 0 && campEnts(0).length === THIRD.COMP[c0.type].length,
    '碉堡回來後單位恢復倒數並重生歸隊');
}

// ================= solo mode: in-browser RoomHub loop (no WebSocket) =================
// Solo build (GitHub Pages static site) news up the same RoomHub directly in the browser, with transport swapped for same-page function calls.
// This section runs a full game the exact same way: create room, pick side, ready, battle, snapshots, teardown.
// Passing here means the solo build passes (the client just wires send to sess.recv, see public/js/localhost.js).
log('\n— 單機機制:瀏覽器內 RoomHub 迴路 —');
{
  const hub = new RoomHub({ urls: () => [], log: () => {}, dropMs: 0 });
  const inbox = [];
  const sess = hub.attach((m) => inbox.push(m));
  const last = (t) => [...inbox].reverse().find((m) => m.t === t);
  const snapCount = () => inbox.filter((m) => m.t === 'snap').length;

  // Verified to the same bar as the server (solo is not an unverified side path)
  sess.recv({ t: 'createRoom', name: '單機指揮官', teamSize: 1, battleConfig: roomBattleConfig(3) });
  assert(/兵線/.test(last('error')?.msg || ''), '單機:兵線數不符同樣被拒絕(與伺服器同一支驗證)');

  sess.recv({ t: 'createRoom', name: '單機指揮官', roomName: '離線演習', teamSize: 1, battleConfig: roomBattleConfig(1) });
  const sync = last('sync');
  assert(/^\d{4}$/.test(sync?.lobby?.pin || ''), `單機:開出房間(PIN ${sync?.lobby?.pin})`);
  assert(sync.lobby.urls.length === 0, '單機:不廣播任何加入網址(沒有伺服器可連)');
  assert(hub.stats().rooms === 1, '單機:hub 統計得到房間數');

  sess.recv({ t: 'pickSide', side: 'SWARM' });
  sess.recv({ t: 'setReady', ready: true });
  sess.recv({ t: 'startBattle' });
  assert(!!last('battleConfig'), '單機:開戰指令送回 battleConfig(客戶端據此建地形)');
  const lobbyAfter = last('sync').lobby;
  assert(lobbyAfter.clients.filter((c) => c.isBot).length === 1, '單機:人數不足自動補電腦玩家到滿編');

  sess.recv({ t: 'loaded' });
  assert(!!last('field'), '單機:收到危險區靜態資料(地雷等只發一次)');
  await new Promise((r) => setTimeout(r, 600));
  assert(snapCount() >= 3, `單機:8Hz 快照持續送達(${snapCount()} 份)`);
  const solo = last('snap');
  assert(solo.ents.some((e) => e.k === 'base') && solo.ents.some((e) => e.k === 'tower'),
    '單機:快照含主堡與防禦塔(權威模擬確實在瀏覽器端跑起來)');
  assert(solo.ents.some((e) => e.pid === sess.id && e.act), '單機:自機英雄在場');

  // Teardown: MUST stop the 8Hz tick -- a loop left running after switching back to online mode is idle battery drain
  hub.shutdown();
  const n = snapCount();
  await new Promise((r) => setTimeout(r, 400));
  assert(snapCount() === n, '單機:shutdown 後 tick 完全停止(不留背景迴圈)');
  assert(hub.stats().rooms === 0, '單機:shutdown 後房間清空');
}

// ================= rematch re-rolls base side assignment =================
// If map side-vs-side assignment rolled only at room creation, ten rematches in one room would all start from the same end (2026-08-01 user report
// of base positions never randomizing). Roll once at creation plus once per rematch return (rooms.js rollSideSwap single seam).
// Assertion style: wrap Math.random only around the synchronous backToRoom call and verify both outcomes once each --
// roll-a-few-times-and-hope statistical assertions flake, so MUST NOT serve as regression cover.
log('\n— 再戰重擲主堡陣營歸屬 —');
{
  const hub = new RoomHub({ urls: () => [], log: () => {}, dropMs: 0 });
  const sess = hub.attach(() => {});
  sess.recv({ t: 'createRoom', name: '再戰指揮官', roomName: '換邊測試', teamSize: 1, battleConfig: roomBattleConfig(1) });
  const room = [...hub.rooms.values()][0];
  sess.recv({ t: 'pickSide', side: 'SWARM' });

  const cfg = () => room.battleConfig;
  const shot = () => JSON.stringify([cfg().bases.SWARM, cfg().bases.STEEL, cfg().lanes[0]]);
  /** Play one game then press back-to-room for a rematch; the roll only takes effect in backToRoom (everything else still eats true randomness) */
  const rematch = (roll) => {
    sess.recv({ t: 'setReady', ready: true });
    sess.recv({ t: 'startBattle' });
    sess.recv({ t: 'loaded' });
    const live = !!room.battle;
    const rnd = Math.random;
    Math.random = () => roll;
    try { sess.recv({ t: 'backToRoom' }); } finally { Math.random = rnd; }
    return live;
  };

  const swarm0 = JSON.stringify(cfg().bases.SWARM), steel0 = JSON.stringify(cfg().bases.STEEL);
  const lane0 = cfg().lanes[0].slice();
  assert(rematch(0.1), '再戰:對局開得起來(backToRoom 的前提)');
  assert(room.phase === 'room' && !room.battle, '再戰:回到房間階段');
  assert(JSON.stringify(cfg().bases.SWARM) === steel0 && JSON.stringify(cfg().bases.STEEL) === swarm0,
    '再戰擲中 ⇒ 兩主堡的陣營歸屬對調(下一場換邊開打)');
  assert(JSON.stringify(cfg().lanes[0]) === JSON.stringify(lane0.slice().reverse()),
    '再戰擲中 ⇒ 兵線點序同步反轉(維持 sim 約定 lane[0] ≈ SWARM 主堡端)');
  assert(!validateBattleConfig(cfg(), 1), '再戰:重擲後的 battleConfig 仍通過開房驗證(反轉換標不動幾何)');

  const before = shot();
  rematch(0.9);
  assert(shot() === before, '再戰沒擲中 ⇒ battleConfig 逐位元不變(另外五成維持原歸屬)');
  hub.shutdown();
}

// ================= no-human timeout: end the game directly =================
// Once every human (player plus spectator) stays offline past noHumanMs, close the game and the room (unwatched bot games are pure idle burn);
// a reattach within the limit zeroes the timer and the game continues. Production noHumanMs defaults to 60s; shortened here for a fast check.
log('\n— 對局中無真人玩家逾時 —');
{
  const hub = new RoomHub({ urls: () => [], log: () => {}, dropMs: 60 * 1000, noHumanMs: 400 });
  const inbox = [];
  const sess = hub.attach((m) => inbox.push(m));
  const last = (t) => [...inbox].reverse().find((m) => m.t === t);
  sess.recv({ t: 'createRoom', name: '獨守指揮官', roomName: '空城計', teamSize: 1, battleConfig: roomBattleConfig(1) });
  sess.recv({ t: 'pickSide', side: 'SWARM' });
  sess.recv({ t: 'setReady', ready: true });
  sess.recv({ t: 'startBattle' });
  sess.recv({ t: 'loaded' });
  await new Promise((r) => setTimeout(r, 300));
  assert(hub.stats().battles === 1, '前置:對局開打(1 真人 + 補滿電腦)');
  const token = last('sync').token;

  // Reconnected within the limit: seat survives (dropMs hold), no-human timer zeroes, game continues
  sess.close();
  await new Promise((r) => setTimeout(r, 200));
  const inbox2 = [];
  const sess2 = hub.attach((m) => inbox2.push(m));
  sess2.recv({ t: 'reattach', token });
  await new Promise((r) => setTimeout(r, 500));   // Past noHumanMs: a human reconnect must not close the room
  assert(hub.stats().battles === 1, '期限內回連:對局保留(無真人計時歸零)');
  assert(inbox2.some((m) => m.t === 'sync'), '回連認回原座位(補收 sync)');
  assert(inbox2.some((m) => m.t === 'battleConfig'), '回連補收 battleConfig(客戶端據此重建地形)');
  assert(inbox2.some((m) => m.t === 'snap'), '回連後 8Hz 快照恢復送達');

  // Every human offline past noHumanMs: end the game and clear the room (seat tokens die with the room)
  sess2.close();
  await new Promise((r) => setTimeout(r, 800));
  assert(hub.stats().rooms === 0 && hub.stats().battles === 0, '無真人玩家逾時:對局結束、房間清除');
  const inbox3 = [];
  const sess3 = hub.attach((m) => inbox3.push(m));
  sess3.recv({ t: 'reattach', token });
  const err = inbox3.find((m) => m.t === 'error');
  assert(err?.code === 'reattach', '逾時後才回連:座位已失效(code=reattach,客戶端據此清掉過期憑證)');
  hub.shutdown();
}

// ================= reattach identity: reattach MUST reuse the original seat key =================
// The seat key in room.clients, the hero pid in sim.heroes, and the hostId comparison target are all the clientId of the seat-creating session.
// If reattach reused the new connection own clientId: pos/fire silently dropped by sim (no hero found), host rights lost,
// leaveRoom/clear-seat deletes the wrong key, so the seat never frees = zombie room (lobby forever shows a bot game with nobody in it).
log('\n— 回連身分(reattach 沿用原座位鍵)—');
{
  const mkBattle = async () => {
    const inbox = [];
    const hub = new RoomHub({ urls: () => [], log: () => {}, dropMs: 60 * 1000, noHumanMs: 400 });
    const sess = hub.attach((m) => inbox.push(m));
    sess.recv({ t: 'createRoom', name: '回連者', roomName: '回連測試', teamSize: 1, battleConfig: roomBattleConfig(1) });
    sess.recv({ t: 'pickSide', side: 'SWARM' });
    sess.recv({ t: 'setReady', ready: true });
    sess.recv({ t: 'startBattle' });
    sess.recv({ t: 'loaded' });
    await new Promise((r) => setTimeout(r, 250));
    const token = [...inbox].reverse().find((m) => m.t === 'sync').token;
    return { hub, sess, token };
  };
  // 1: hero control + 2: host rights (disconnect, then reattach on a new connection)
  {
    const { hub, sess, token } = await mkBattle();
    const room = [...hub.rooms.values()][0];
    const hero = room.battle.heroes.get(sess.id);
    sess.close();
    const sess2 = hub.attach(() => {});
    sess2.recv({ t: 'reattach', token });
    // Keep identity verification inside the qualified frame and above unrelated ground collisions.
    sess2.recv({ t: 'pos', x: 1, y: HI_ALT, z: 2, ry: 0 });
    assert(hero.x === 1 && hero.z === 2 && hero.y === HI_ALT, '回連後 pos 回報操控原英雄(座位鍵 = 原 clientId,非新連線的)');
    sess2.recv({ t: 'backToRoom' });
    assert(room.phase === 'room', '回連後房主權限仍在(backToRoom 生效)');
    hub.shutdown();
  }
  // 3: late close from the zombie old socket must not steal the seat (server heartbeat terminate / OS TCP timeout both walk this path)
  {
    const { hub, sess, token } = await mkBattle();
    const sess2 = hub.attach(() => {});
    sess2.recv({ t: 'reattach', token });   // Old socket reattaches before closing (app backgrounded then foregrounded on phones is the norm)
    sess.close();                           // Zombie connection dies only now
    await new Promise((r) => setTimeout(r, 700));
    assert(hub.stats().battles === 1, '殭屍舊 socket 晚到 close:座位不受影響、對局不被無真人逾時誤收');
    hub.shutdown();
  }
  // 4: leaveRoom after reattach truly vacates and clears the room (right key deleted, no zombie room)
  {
    const { hub, sess, token } = await mkBattle();
    sess.close();
    const sess2 = hub.attach(() => {});
    sess2.recv({ t: 'reattach', token });
    sess2.recv({ t: 'leaveRoom' });
    assert(hub.stats().rooms === 0, '回連後離開戰局:房間清除(唯一真人離開不留殭屍房)');
    hub.shutdown();
  }
}

// ================= WebSocket end to end =================
log('— 開房驗證(地圖必須先建立)—');
const host = await client('host');
host.send({ t: 'createRoom', name: '蜂群女王', roomName: '沒有地圖', teamSize: 1 });
await host.wait((c) => c.msgs.find((m) => m.t === 'error' && /不完整/.test(m.msg)));
assert(true, '缺 battleConfig 開房被拒絕');

const wrongLanes = roomBattleConfig(3);
host.send({ t: 'createRoom', name: '蜂群女王', roomName: '線數錯', teamSize: 1, battleConfig: wrongLanes });
await host.wait((c) => c.msgs.find((m) => m.t === 'error' && /兵線/.test(m.msg)));
assert(true, '兵線數與隊伍規模不符被拒絕(1v1 要 1 線)');

const tooShort = roomBattleConfig(1);
for (const side of ['SWARM', 'STEEL']) {
  const base = tooShort.bases[side];
  tooShort.bases[side] = [(base[0] + tooShort.center.lat) / 2, (base[1] + tooShort.center.lng) / 2];
}
// Keep the advertised distance high: authority must reject the actual short span.
tooShort.distM = tooShort.diagM;
host.send({ t: 'createRoom', name: '蜂群女王', roomName: '太近', teamSize: 1, battleConfig: tooShort });
await host.wait((c) => c.msgs.find((m) => m.t === 'error' && /80%/.test(m.msg)));
assert(true, '主堡距離未達對角線 80% 被拒絕');

// Story-campaign flags (2026-08-13): only the defSide slot exists; siege is derived by the server.
// This section verifies the whole client-sent bundle MUST NOT count as-is: a bogus defSide is cleared to null
// (siege goes false with it); legal ones take full effect -- a split shows as sequential HP locks with no BOSS.
{
  const mkRoom = async (name, cfg) => {
    const c = await client(name);
    c.send({ t: 'createRoom', name: '蜂群女王', roomName: name, isPublic: false, teamSize: 1, battleConfig: cfg });
    await c.wait((x) => x.sync);
    const out = c.sync.lobby.battleConfig;
    c.send({ t: 'leaveRoom' });
    c.ws.close();
    return out;
  };
  const bogus = roomBattleConfig(1);
  bogus.defSide = 'FOO'; bogus.siege = true;
  const bc = await mkRoom('亂填防守方', bogus);
  assert(bc.defSide === null && bc.siege === false,
    `亂填的 defSide 清成 null,siege 跟著 false(defSide=${bc.defSide} siege=${bc.siege})`);
  const sc = await mkRoom('劇情戰役', venueConfig(VENUES[0], 1, 'STEEL'));
  assert(sc.defSide === 'STEEL' && sc.siege === true && !('mini' in sc),
    '劇情戰役:defSide=STEEL ⇒ siege 推導為 true、不再帶 mini 旗標');
  assert(sc.lanes.length === 1, `劇情戰役恆單兵線(收到 ${sc.lanes.length} 條)`);
}

log('— 建立房間(1v1,開房即帶地圖與環境)—');
host.send({ t: 'createRoom', name: '蜂群女王', roomName: '測試戰區', isPublic: true, teamSize: 1, battleConfig: roomBattleConfig(1) });
await host.wait((c) => c.sync);
const pin = host.sync.lobby.pin;
assert(/^\d{4}$/.test(pin), `取得 PIN:${pin}`);
assert(host.sync.isHost === true, '建房者是房主');
const lockedCfg = host.sync.lobby.battleConfig;
assert(lockedCfg && lockedCfg.lanes.length === 1, '房間已鎖定 1 條兵線的地圖');
assert(['spring', 'summer', 'autumn', 'winter'].includes(lockedCfg.env?.season), `環境已定案(${lockedCfg.env?.season}/${lockedCfg.env?.time}/${lockedCfg.env?.weather})`);

// Fog of war: spectators get the fog-free global snapshot; later enemy-unit spotting (outside host sight) reads from it
const spec = await client('spec');
spec.send({ t: 'joinRoom', pin, name: '觀戰者', mode: 'spectator' });
await spec.wait((c) => c.sync);

log('— 房間列表 —');
const lurker = await client('lurker');
lurker.send({ t: 'listRooms' });
const roomsMsg = await lurker.wait((c) => c.msgs.find((m) => m.t === 'rooms'));
const entry = roomsMsg.rooms.find((r) => r.pin === pin);
assert(!!entry, '大廳列表含公開房與 PIN');
assert(entry.teamSize === 1 && entry.place === '測試戰區', `列表帶隊伍規模與地點(${entry.teamSize}v${entry.teamSize}・${entry.place})`);
lurker.ws.close();

log('— 加入 + 選陣營(每陣營 1 席)—');
const guest = await client('guest');
guest.send({ t: 'joinRoom', pin, name: '鋼鐵上校', mode: 'player' });
await guest.wait((c) => c.sync);
host.send({ t: 'pickSide', side: 'SWARM' });
guest.send({ t: 'pickSide', side: 'STEEL' });
await host.wait((c) => c.sync.lobby.clients.filter((x) => x.side).length === 2);
assert(true, '雙方各佔一個陣營');
guest.send({ t: 'pickSide', side: 'SWARM' });
await guest.wait((c) => c.msgs.find((m) => m.t === 'error' && /已滿/.test(m.msg)));
assert(true, '陣營滿員(1 席)再搶被拒絕');
guest.send({ t: 'pickSide', side: 'STEEL' });

// 2026-07-31 user decision: control scheme is a room setting (same for the whole room), no longer a per-player preference.
// The client half (effective value written only by broadcast, reverting to own default outside the zone) is covered by tools/audit_ctrl_mode.mjs.
log('— 操作方式由房主選擇 —');
assert(host.sync.lobby.config.ctrl === 'any', '開房未帶 ctrl ⇒ 預設「不限定」');
host.send({ t: 'setRoomConfig', ctrl: 'pad' });
await host.wait((c) => c.sync.lobby.config.ctrl === 'pad');
await guest.wait((c) => c.sync.lobby.config.ctrl === 'pad');
assert(true, '房主改操作方式 → 廣播全房(隊友的版型跟著換)');
guest.send({ t: 'setRoomConfig', ctrl: 'kbm' });          // 非房主:靜默忽略
host.send({ t: 'setRoomConfig', ctrl: '亂填的值' });        // 房主但非法值:靜默忽略
host.send({ t: 'setRoomConfig', botDiff: 'high' });        // 之後這一筆的廣播 = 前兩筆的觀測點
await guest.wait((c) => c.sync.lobby.config.botDiff === 'high');
assert(guest.sync.lobby.config.ctrl === 'pad', '非房主改不動操作方式(由房主選擇)');
assert(host.sync.lobby.config.ctrl === 'pad', '非法值靜默忽略,MUST NOT 把整房設成壞值');
{
  const l2 = await client('lurker2');
  l2.send({ t: 'listRooms' });
  const rooms2 = await l2.wait((c) => c.msgs.find((m) => m.t === 'rooms'));
  assert(rooms2.rooms.find((r) => r.pin === pin)?.ctrl === 'pad',
    '戰區列表帶出操作方式(手機玩家加入前就看得到限定與否)');
  l2.ws.close();
}
host.send({ t: 'setRoomConfig', ctrl: 'any' });            // 還原,免影響後續段落的預設語意
await host.wait((c) => c.sync.lobby.config.ctrl === 'any');

log('— 選角(角色綁陣營;不選 = 開戰隨機)—');
host.send({ t: 'pickChar', ch: 't01' });   // 蜂群玩家選鋼鐵角色 → 拒絕
await host.wait((c) => c.msgs.find((m) => m.t === 'error' && /陣營不符/.test(m.msg)));
assert(true, '選敵陣營角色被拒絕');
host.send({ t: 'pickChar', ch: 's02' });   // 鐵匠(重武器溫壓火箭:高破甲,後面拆堡用)
await host.wait((c) => c.sync.lobby.clients.find((x) => x.id === c.sync.youId)?.ch === 's02');
assert(true, `host 選角「${CHARACTERS.s02.code}」(lobby 同步)`);
guest.send({ t: 'pickChar', ch: 't04' });
await guest.wait((c) => c.sync.lobby.clients.find((x) => x.id === c.sync.youId)?.ch === 't04');
assert(true, `guest 選角「${CHARACTERS.t04.code}」`);

log('— 路網中繼:房主的 OSM 圖資經伺服器轉給入房者 —');
// 形狀/上限/單調的完整斷言住 tools/audit_osm_relay.mjs(離線、含反向驗證);
// 這裡驗的是**真的 WebSocket 來回**:訊息走得過傳輸層、非房主進不來、晚到的觀戰者補得到。
{
  const relayBox = { minLat: 25.03, minLng: 121.55, maxLat: 25.06, maxLng: 121.59 };
  const mkRoads = (name) => [{
    tags: { highway: 'primary', name },
    geometry: [{ lat: 25.04, lon: 121.56 }, { lat: 25.05, lon: 121.57 }],
  }];
  host.send({ t: 'osm', bbox: relayBox, feats: null, roads: mkRoads('中繼大道') });
  const got = await guest.wait((c) => c.msgs.find((m) => m.t === 'osm'));
  assert(got.roads?.[0]?.tags?.name === '中繼大道', '路網中繼:入房者收到房主那一份路網');
  // 單調:房主重試成功再送一次,已定案的格 MUST NOT 被換掉(否則早/晚進房的人建不同的世界)
  host.send({ t: 'osm', bbox: relayBox, feats: null, roads: mkRoads('第二份') });
  guest.send({ t: 'osm', bbox: relayBox, feats: null, roads: mkRoads('冒名') });
  await new Promise((r) => setTimeout(r, 300));
  assert(guest.msgs.filter((m) => m.t === 'osm').length === 1, '路網中繼:已定案的格不再轉播(非房主的一律丟棄)');
  const lateSpec = await client('lateSpec');
  lateSpec.send({ t: 'joinRoom', pin, name: '晚到觀戰', mode: 'spectator' });
  const lateGot = await lateSpec.wait((c) => c.msgs.find((m) => m.t === 'osm'));
  assert(lateGot.roads?.[0]?.tags?.name === '中繼大道', '路網中繼:晚到者一進房就補到同一份');
  lateSpec.ws.close();
}

log('— 滿房拒收第三位玩家(2N=2)—');
const third = await client('third');
third.send({ t: 'joinRoom', pin, name: '第三者', mode: 'player' });
await third.wait((c) => c.msgs.find((m) => m.t === 'error' && /席位已滿/.test(m.msg)));
assert(true, '第 3 位玩家被拒(可觀戰)');
third.ws.close();

log('— 準備 + 開戰 → loading —');
host.send({ t: 'setReady', ready: true });
guest.send({ t: 'setReady', ready: true });
await host.wait((c) => c.sync.lobby.clients.every((x) => x.mode !== 'player' || x.ready));
host.send({ t: 'startBattle' });
await guest.wait((c) => c.battleConfig);
assert(guest.battleConfig.placeName === '測試戰區', '雙方收到 battleConfig');
assert(guest.sync.lobby.phase === 'loading' || guest.battleConfig != null, '進入 loading 階段');

log('— 雙方載入完成 → 開戰 —');
host.send({ t: 'loaded' });
guest.send({ t: 'loaded' });
await host.wait((c) => c.snaps.length > 3, 8000);
await spec.wait((c) => c.snaps.length > 3, 8000);
const snap = host.snaps.at(-1);
const specSnap = spec.snaps.at(-1);   // 無霧視角:雙方主堡/塔/英雄都在
const bases = specSnap.ents.filter((e) => e.k === 'base');
const towers = specSnap.ents.filter((e) => e.k === 'tower');
const heroes = specSnap.ents.filter((e) => (e.k === 'drone' || e.k === 'robot') && e.act);
assert(bases.length === 2, `主堡 ×2(hp=${bases[0]?.hp})`);
assert(towers.length === 4, `防禦塔 ×4(1 線 × 1 塔位 × 左右 2 座 × 2 方;實際 ${towers.length})`);
assert(heroes.length === 2, `英雄 ×2(主視野機;${heroes.map((h) => h.k).join(',')})`);
assert(specSnap.ents.filter((e) => e.k === 'drone').length === 1,
  '無人機玩家在場 1 架機體(單機)');
const myHero = snap.ents.find((h) => h.pid === host.sync.youId && h.act);
assert(myHero && myHero.k === 'drone', `英雄快照帶 pid,能認出自己的座機(pid=${myHero?.pid})`);
assert(typeof myHero.$ === 'number' && myHero.ab && typeof myHero.kn === 'number',
  `英雄快照帶金錢/招式階級/戰鬥分數($${myHero.$}・ab=${JSON.stringify(myHero.ab)})`);
assert(myHero.ch === 's02', `快照帶角色 id(ch=${myHero.ch},客戶端渲染專屬機體)`);
assert(myHero.sp != null && myHero.msp > 0 && myHero.mp != null && myHero.mm > 0,
  `快照帶護盾/電力(sp=${myHero.sp}/${myHero.msp}・mp=${myHero.mp}/${myHero.mm})`);
const botAssigned = specSnap.ents.filter((e) => (e.k === 'drone' || e.k === 'robot') && e.act && e.ch);
assert(botAssigned.length === heroes.length, '所有英雄(含未選角者)開戰時都有角色(默認隨機)');

log('— 危險區:field 訊息 + 快照帶中立障礙 —');
const fieldMsg = host.msgs.find((m) => m.t === 'field');
assert(fieldMsg && fieldMsg.mines.length > 0, `開戰收到 field(地雷 ${fieldMsg?.mines?.length} 顆)`);
assert(snap.ents.some((e) => e.k === 'aasite'), '快照帶匿蹤防空陣地(中立實體)');
assert(snap.ents.some((e) => e.sc && !e.s), '中立障礙帶尺寸 sc 且無陣營');

log('— 等第一波兵線 —');
// 第三方野營的步槍兵開戰即在場(觀戰無霧看得到)→ 等波次 MUST 篩雙陣營
const isFaction = (e) => e.s === 'SWARM' || e.s === 'STEEL';
await spec.wait((c) => {
  const s = c.snaps.at(-1);
  return s.ents.some((e) => e.k === 'soldier' && isFaction(e));
}, 15000);
const snapWave = spec.snaps.at(-1);   // 無霧視角:才看得到雙方全部小兵
const WAVE_KINDS = ['soldier', ...GAME.WAVE_EXTRAS];
const wavePer = GAME.WAVE_SOLDIERS + GAME.WAVE_EXTRAS.length;
const creeps = snapWave.ents.filter((e) => WAVE_KINDS.includes(e.k) && isFaction(e));
// 2026-07-30 起開局兵線是**預先鋪好的**(_prefillLanes:沿兵線每 waveSpacingM 一波,到第一座砲塔為止)
// ⇒ 期望值 MUST 由同一份規則推出,不可手寫。參照 sim 用同一份 battleConfig 建(確定性 ⇒ 波數相同)。
const refSim = new BattleSim(spec.battleConfig);
const refPre = [...refSim.ents.values()].filter((e) => WAVE_KINDS.includes(e.kind) && isFaction({ s: e.side })).length;
const expectCreeps = refPre + wavePer * 2;   // 預置 + 開局第一波(FIRST_WAVE_DELAY_S = 0)
assert(creeps.length === expectCreeps,
  `開局兵線 ${expectCreeps} 隻(預置 ${refPre} + 第一波 ${wavePer * 2};1線×2方×${wavePer},含坦克;實際 ${creeps.length})`);
assert(refPre > 0 && refPre % (wavePer * 2) === 0, `開場預置兵線 ${refPre / (wavePer * 2)} 波/線(雙方對稱,每波 ${wavePer} 隻)`);

log('— 英雄移動 + 射擊 —');
const target = snapWave.ents.find((e) => e.k === 'soldier' && e.s === 'STEEL');
host.send({ t: 'pos', x: target.x, y: HI_ALT, z: target.z, ry: 0 });
await new Promise((r) => setTimeout(r, 300));
const hp0 = target.hp;
for (let i = 0; i < 6; i++) {
  host.send({ t: 'hit', id: target.id });
  await new Promise((r) => setTimeout(r, 160));
}
const after = await host.wait((c) => {
  const s = c.snaps.at(-1);
  const t2 = s.ents.find((e) => e.id === target.id);
  return (!t2 || t2.hp < hp0) ? s : null;
}, 4000);
const t2 = after.ents.find((e) => e.id === target.id);
assert(!t2 || t2.hp < hp0, `射擊生效(${hp0} → ${t2 ? t2.hp : '陣亡'})`);

log('— 射速上限(狂發 hit 不會全吃)—');
const t3 = spec.snaps.at(-1).ents.find((e) => e.k === 'howitzer' && e.s === 'STEEL');   // 無霧視角找目標(host 視野外)
if (t3) {
  host.send({ t: 'pos', x: t3.x, y: HI_ALT, z: t3.z, ry: 0 });
  await new Promise((r) => setTimeout(r, 250));
  const before = (host.snaps.at(-1).ents.find((e) => e.id === t3.id) || {}).hp ?? t3.hp;
  for (let i = 0; i < 50; i++) host.send({ t: 'hit', id: t3.id });
  await new Promise((r) => setTimeout(r, 400));
  const nowT = host.snaps.at(-1).ents.find((e) => e.id === t3.id);
  const dmgDone = before - (nowT ? nowT.hp : 0);
  const wLight = heroWeapon('s02', 'light', 1);
  const cap = wLight.dmg * 1.3 * (wLight.critX ?? 1.6) * 10;   // 遠小於 50 發全吃
  assert(dmgDone < cap, `50 連發只吃進 ${Math.round(dmgDone)} 傷害 < ${Math.round(cap)}(限速生效)`);
}

log('— 重武器 CD(瞄準 + 著彈回報;CD 中連發被拒)—');
host.send({ t: 'pos', x: target.x, y: HI_ALT, z: target.z, ry: 0 });   // 回到著彈點正上方(射程內)
const boomsBefore = host.snaps.flatMap((s) => s.ev || []).filter((e) => e.e === 'boom').length;
host.send({ t: 'aim', on: true });
await new Promise((r) => setTimeout(r, 200));
host.send({ t: 'burst', x: target.x, z: target.z });
host.send({ t: 'burst', x: target.x, z: target.z });
await new Promise((r) => setTimeout(r, 400));
host.send({ t: 'aim', on: false });
const boomsAfter = host.snaps.flatMap((s) => s.ev || []).filter((e) => e.e === 'boom').length;
assert(boomsAfter - boomsBefore === 1, `連按兩次只炸一次(重武器 CD 生效;實際 ${boomsAfter - boomsBefore})`);

log('— 無人機長按 = 攻招載具(2026-08-06:s02 攻招已轉載具遞送;kami 事件帶 ult 旗標)—');
const droneDies = () => host.snaps.flatMap((s) => s.ev || []).filter((e) => e.e === 'die' && e.kind === 'drone').length;
const dies0 = droneDies();
// 移到高空(250 > SAM 240)避免被塔擊落干擾,再觸發
const foeTower = spec.snaps.at(-1).ents.find((e) => e.k === 'tower' && e.s === 'STEEL');
host.send({ t: 'pos', x: foeTower.x, y: HI_ALT, z: foeTower.z, ry: 0 });
await new Promise((r) => setTimeout(r, 250));
// WS 端只驗「長按 → 伺服器 → 廣播」這條路走通;確切架數/HP/payload/擊落否定走上方 sim 直測與稽核。
// host = s02(團隊 heal 攻招,已轉載具)⇒ ①舊 {t:'kami'} 路徑被 atkDelivered 守衛擋下;
// ②長按改送 {t:'cast', slot:'atk'}(client._fireHoldAbility 同一縫)⇒ kami 事件帶 atk:1。
// **判據是 `kami` 事件而不是快照裡的機體**(2026-08-01):每架只有 kamiHp()(刻意的脆),
// 8Hz 快照可能一幀都沒拍到;事件是伺服器「確實受理」的權威回報,不受存活時間影響。
const kamiEvs = () => host.snaps.flatMap((snp) => snp.ev || []).filter((e) => e.e === 'kami' && e.pid === host.sync.youId);
host.send({ t: 'kami' });   // 舊機種絕招路徑:converted 角色 MUST 被守衛擋下
await new Promise((r) => setTimeout(r, 400));
assert(kamiEvs().length === 0, 'converted 角色(s02)按舊 kami 路徑被守衛擋下(不生成護衛機)');
// 長按 = 施放攻招(與 E 鍵同縫):電力由前面測試消耗過 ⇒ 等回充到夠再送(wait 內重送無妨,CD 擋重複)
host.send({ t: 'cast', slot: 'atk', x: foeTower.x, z: foeTower.z });
await host.wait(() => { host.send({ t: 'cast', slot: 'atk', x: foeTower.x, z: foeTower.z }); return kamiEvs().length >= 1; }, 15000);
assert(kamiEvs().length === 1, `攻招經網路發射載具(收到 ${kamiEvs().length} 次 kami 事件)`);
assert(kamiEvs()[0].atk === 1 && kamiEvs()[0].n === SQUAD.KAMI.N,
  `kami 事件帶 ult 旗標與架數 n = ${SQUAD.KAMI.N}(實得 atk:${kamiEvs()[0].atk} n:${kamiEvs()[0].n})`);
assert(droneDies() === dies0, '主機不自爆(攻招載具不會炸掉自己)');
host.send({ t: 'cast', slot: 'atk', x: foeTower.x, z: foeTower.z });   // CD 內再按:不應再放一次
await new Promise((r) => setTimeout(r, 300));
assert(kamiEvs().length === 1, 'CD 內再按不會再放一次攻招載具');

log('— 斷線重連 —');
const token = guest.sync.token;
guest.ws.close();
await new Promise((r) => setTimeout(r, 300));
const guest2 = await client('guest2');
guest2.send({ t: 'reattach', token });
await guest2.wait((c) => c.sync);
assert(guest2.sync.lobby.clients.some((x) => x.name === '鋼鐵上校' && x.connected), '用 token 認回原座位');
assert(guest2.battleConfig != null, '重連後補收 battleConfig');

log('— 經濟:開局資金 + 擊殺賞金 → 通用強化(隨處可買;被動收入已停發)—');
const swarmBase = snap.ents.find((e) => e.k === 'base' && e.s === 'SWARM');
const homeIv = setInterval(() => host.send({ t: 'pos', x: swarmBase.x, y: 30, z: swarmBase.z, ry: 0 }), 200);
// 金錢/升級只序列化在「主視野(act)」那架上;三機小隊死亡讓位後 act 可能不是 bodies[0],
// 故讀取這些欄位 MUST 篩 e.act(與後面 e.act 讀法一致),不能用第一個 pid 命中的僚機。
const meOf = (c) => c.snaps.at(-1).ents.find((e) => e.pid === host.sync.youId && e.act);
const richSnap = await host.wait((c) => {
  const me = meOf(c);
  return me && me.$ >= upgradePrice(ECON.UPGRADES.hw, 0) ? me : null;   // 首階階梯價;START 200 ≥ 之,必然足夠
}, 30000);
assert(richSnap.$ >= upgradePrice(ECON.UPGRADES.hw, 0), `開局資金 + 擊殺賞金累積 $${richSnap.$}(無被動收入)`);
host.send({ t: 'buy', item: 'hw' });
await host.wait((c) => (meOf(c)?.up?.hw || 0) >= 1, 5000);
clearInterval(homeIv);
assert(true, '重武器強化 Lv.1(快照 up 同步)');

log('— 回房再戰:地圖保留 —');
const previousArchitectureSeed = host.sync.lobby.battleConfig.architectureSeed;
assert(Number.isInteger(previousArchitectureSeed), '建築種子由房間定案');
assert(previousArchitectureSeed === spec.battleConfig.architectureSeed, '同房玩家共用建築種子');
host.send({ t: 'backToRoom' });
await host.wait((c) => c.sync.lobby.phase === 'room');
assert(host.sync.lobby.battleConfig?.placeName === '測試戰區', '返回房間後地圖仍鎖定(不需重選)');
assert(host.sync.lobby.battleConfig.architectureSeed !== previousArchitectureSeed, '再戰更換建築種子');

log('— 5v5 房:同陣營多席 + 3 線 —');
const h5 = await client('h5');
h5.send({ t: 'createRoom', name: '五五開', roomName: '大戰場', isPublic: true, teamSize: 5, battleConfig: roomBattleConfig(3) });
await h5.wait((c) => c.sync);
const pin5 = h5.sync.lobby.pin;
const g5 = await client('g5');
g5.send({ t: 'joinRoom', pin: pin5, name: '僚機', mode: 'player' });
await g5.wait((c) => c.sync);
h5.send({ t: 'pickSide', side: 'SWARM' });
g5.send({ t: 'pickSide', side: 'SWARM' });
await h5.wait((c) => c.sync.lobby.clients.filter((x) => x.side === 'SWARM').length === 2);
assert(true, '5v5 允許兩人同選蜂群(N 席)');
h5.send({ t: 'setReady', ready: true });
g5.send({ t: 'setReady', ready: true });
await h5.wait((c) => c.sync.lobby.clients.every((x) => x.mode !== 'player' || x.ready));
h5.send({ t: 'startBattle' });
await g5.wait((c) => c.battleConfig);
h5.send({ t: 'loaded' });
g5.send({ t: 'loaded' });
await h5.wait((c) => c.snaps.length > 2, 8000);
const s5 = h5.snaps.at(-1);
// 人數不足一律補電腦到滿編:只看真人 pid(數字),電腦 pid 是 'b' 開頭字串
const drones5 = s5.ents.filter((e) => e.act && e.pid != null && !String(e.pid).startsWith('b'));
const towers5 = s5.ents.filter((e) => e.k === 'tower');
assert(drones5.length === 2, `同陣營 2 位真人英雄同時在場(pid:${drones5.map((d) => d.pid).join(',')})`);
assert(s5.ents.filter((e) => e.pid != null && !String(e.pid).startsWith('b') && e.k !== 'kami').length
  === drones5.length, '每位真人 = 單一機體(無人機/機甲皆單機)');
assert(towers5.length === 12, `3 線 → 防禦塔 ×12(實際 ${towers5.length})`);
h5.ws.close(); g5.ws.close();

log('— 電腦玩家(單人 + AI 對手)—');
const hb = await client('hb');
hb.send({ t: 'createRoom', name: '獨行俠', roomName: 'BOT房', isPublic: false, teamSize: 2, battleConfig: roomBattleConfig(1) });
await hb.wait((c) => c.sync);
// 霧戰爭:觀戰者收無霧全局快照,用來驗證「敵方」bot 位置(hb 本身在自己視野外看不到對面 bot)
const hbSpec = await client('hbSpec');
hbSpec.send({ t: 'joinRoom', pin: hb.sync.lobby.pin, name: '觀戰者', mode: 'spectator' });
await hbSpec.wait((c) => c.sync);
hb.send({ t: 'pickSide', side: 'SWARM' });
hb.send({ t: 'pickChar', ch: 's02' });   // 固定角色,結果穩定可重現
hb.send({ t: 'addBot', side: 'STEEL' });
hb.send({ t: 'addBot', side: 'STEEL' });
hb.send({ t: 'addBot', side: 'STEEL' });   // 第 3 個超過 2 席應被拒
await hb.wait((c) => c.msgs.find((m) => m.t === 'error' && /已滿/.test(m.msg)));
assert(true, '電腦玩家超出席位被拒絕(2 席)');
await hb.wait((c) => c.sync.lobby.clients.filter((x) => x.isBot).length === 2);
const botsInLobby = hb.sync.lobby.clients.filter((c) => c.isBot);
assert(botsInLobby.every((b) => b.ready && b.side === 'STEEL'), `電腦玩家 ×2 進房自動就緒(${botsInLobby.map((b) => b.name).join('、')})`);
hb.send({ t: 'removeBot', id: botsInLobby[1].id });
await hb.wait((c) => c.sync.lobby.clients.filter((x) => x.isBot).length === 1);
assert(true, '房主可移除電腦玩家');
hb.send({ t: 'setReady', ready: true });
await hb.wait((c) => c.sync.lobby.clients.every((x) => x.mode !== 'player' || x.ready));
hb.send({ t: 'startBattle' });
await hb.wait((c) => c.battleConfig);
hb.send({ t: 'loaded' });   // 只需真人載入完成即可開戰(bot 不用載地形)
await hb.wait((c) => c.snaps.length > 3, 8000);
await hbSpec.wait((c) => c.snaps.length > 3, 8000);
const sbSpec = hbSpec.snaps.at(-1);   // 無霧視角:才看得到對面(STEEL)的 bot
const isBot = (e) => typeof e.pid === 'string' && e.pid.startsWith('b') && e.act;
const botHero = sbSpec.ents.find(isBot);   // bot 角色隨機,機體可能是無人機(傭兵)
assert(!!botHero, `bot 英雄在場(pid=${botHero?.pid})`);
// 「bot 會不會推線」= 它有沒有真的離開起點(原地卡死 / 完全不推線才是要抓的退化)。
// **MUST 輪詢到達成為止,MUST NOT 只量「第 3.5 秒那一刻」的位移**:bot 角色隨機(機體移速差
// 一個檔次)、開場那幾秒還要先轉向面對兵線(視野錐上線後 `h.ry` 只能經 viewLockStep 逐步轉),
// 中途也可能被交戰打斷 —— 固定窗量到的是「這一次剛好走到哪」而不是「會不會推線」,
// 門檻就壓在分佈的尾巴上(實測 3.5 秒窗散佈 10~59m,約 3% 落在門檻下;CI 上已紅過兩次:
// main c5eb469 的 7m 與 PR #90 的 10m)。到達 10m 的耗時實測中位 0.8s / 最慢 2.95s(n=60),
// 上限給 10 秒 = 三倍餘裕;真的卡死就是永遠到不了,一樣紅字。
const bp0 = { x: botHero.x, z: botHero.z };
const botAt = () => hbSpec.snaps.at(-1).ents.find((e) => e.pid === botHero.pid && e.act);
let movedM = 0, pushS = 0;
for (; pushS < 10 && movedM <= 10; pushS += 0.25) {
  await new Promise((r) => setTimeout(r, 250));
  const b = botAt();
  if (b) movedM = Math.hypot(b.x - bp0.x, b.z - bp0.z);
}
assert(movedM > 10, `bot 沿兵線推進(${pushS.toFixed(1)} 秒內移動 ${movedM.toFixed(0)}m;上限 10 秒)`);
hb.ws.close(); hbSpec.ws.close();

// — 快速開始:完全相同配置直接開戰(含電腦敵人指名)—
log('— 快速開始:完全相同配置直接開戰(含電腦敵人指名)—');
const qrHost = await client('qrHost');
qrHost.send({
  t: 'createRoom', name: '快開指揮官', roomName: '快速戰區', isPublic: false,
  teamSize: 2, botDiff: 'medium', battleConfig: roomBattleConfig(1),
});
await qrHost.wait((c) => c.sync?.lobby?.phase === 'room');
qrHost.send({ t: 'pickSide', side: 'STEEL' });
qrHost.send({ t: 'pickChar', ch: 't01' });
qrHost.send({ t: 'addBot', side: 'STEEL' });
qrHost.send({ t: 'setBotChar', id: 'b1', ch: 't02' });
qrHost.send({ t: 'addBot', side: 'SWARM' });
qrHost.send({ t: 'setBotChar', id: 'b2', ch: 's01' });
qrHost.send({ t: 'addBot', side: 'SWARM' });
qrHost.send({ t: 'setBotChar', id: 'b3', ch: 's03' });
qrHost.send({ t: 'setReady', ready: true });
qrHost.send({ t: 'startBattle' });
await qrHost.wait((c) => c.battleConfig);
qrHost.send({ t: 'loaded' });
await qrHost.wait((c) => c.snaps.length > 2, 8000);
const qrSnap = qrHost.snaps.at(-1);
assert(qrSnap.ents.some((e) => e.pid === qrHost.sync.youId && e.ch === 't01'), '快速開戰:自機角色正確指派(t01)');
assert(qrSnap.ents.some((e) => e.pid === 'b1' && e.ch === 't02'), '快速開戰:我方僚機正確指派(b1=t02)');
qrHost.ws.close();

log(failed ? '\n❌ 有測試失敗' : '\n🎉 全部通過');
Math.random = TEST_RANDOM_ORIGINAL;
host.ws.close(); guest2.ws.close(); spec.ws.close();
process.exit(failed ? 1 : 0);
