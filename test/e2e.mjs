// 端對端測試:sim 直測(地雷/彈夾/克制/自爆/角色招式/雙層HP/防空伏擊)
//            → 開房前選圖 → 建房(含隊伍規模/環境)→ 選陣營(N 席)→ 選角
//            → 準備 → 開戰載入 → 快照 → 彈道命中 → 招式養成 → 勝負 → 回房保留地圖
import WebSocket from 'ws';
import { BattleSim, waveInterval, cumLen } from '../server/sim.js';
import { BotBrain } from '../server/bots.js';
import { RoomHub } from '../server/rooms.js';
import {
  UNITS, ECON, GAME, FIELD, HAZARDS, AFFIXES, MAPGEO,
  CHARACTERS, charsOf, heroWeapon, heroAbility, chargeF, heavyMpCost,
  HEROIC, VITALS, armorMul, SQUAD, tierVal, WEAPONS, DECOY_BOMB, HYPER,
  charKind, heroArmor, rangeCap, DECOY, LOCK, BOT_KILL_SCORE, killScore, IFRAME, THIRD, COMBAT_SCALE, hitR,
  SPECIAL, specialTier, specialBudget, kamiBlast, selfBoomBlast, decoyBlast, decoyBombBlast, hyperBlast,
  hyperApex, hyperRange, hyperFlightS, hyperHp, kamiHp, kamiSide, decoyHp, towerDps, kamiExposureS, decoyExposureS,
  upgradePrice, UPG_L3_LVL, BOT_DIFF, BOT_DIFF_KEYS, BOT_OPS, botOpGap,
  BALLISTIC, lobMinRange, offAxisFalloff, AOE_EDGE,
  FLIGHT, airSinkM,
  waveComp, waveMarchSpeed, waveSpacingM, CREEP_UPG, creepUpgMul,
} from '../public/js/data.js';

// #INC-104 高空垂直射擊測試點(隨 COMBAT_SCALE 縮放:全際射程/高度門檻減半 ⇒ 測試高度亦減半)
const HI_ALT = Math.round(250 * COMBAT_SCALE);

/** 清掉第三方野營(游擊隊/民兵):與本節無關的 sim 直測要確定性,不能吃野營流彈 */
function purgeCamps(sim) {
  for (const s of [...sim.ents.values()]) if (s.tp) sim.ents.delete(s.id);
  sim.camps = [];
}

const URL = process.env.WS_URL || 'ws://localhost:8620';
const log = (...a) => console.log(...a);
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

// 模擬戰場設定(合成兵線;台北 101 附近)。L 條兵線,兩堡距離 1600×L
// (刻意比正式的 1000×L 大:留出塔與高空測試點的防空安全邊界)。
function fakeBattleConfig(L = 3) {
  const A = [25.0330, 121.5654];
  const D = 1600 * L, R = 6371000;
  // 幾何用「真實」距離 D×REAL_SCALE;sizeM/distM 為遊戲世界公尺 = D。
  // 因 sim.llToMeters 同步 ×(1/REAL_SCALE),伺服器世界座標與比例尺改制前完全一致 → 斷言不變。
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

// ================= sim 直測(不經 WebSocket,確定性驗證新機制)=================
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
    for (const slot of ['skill', 'ult']) {
      for (let lvl = 1; lvl <= 3; lvl++) {
        const a = heroAbility(id, slot, lvl);
        if (!a || !(a.cd > 0) || !(a.mp > 0)) dataOk = false;
      }
    }
    // #INC-104:e2e 從 y=HI_ALT 高空垂直射擊 → 輕武器英雄射程 ×1.25 必須 > HI_ALT(隨 COMBAT_SCALE 縮)
    if (heroWeapon(id, 'light', 1).range * 1.25 <= HI_ALT) rangeOk = false;
  }
  assert(dataOk, '28 角 × 4 招 × 3 階資料完整(傷害/射程/CD/MP 皆為正值)');
  assert(tierOk, '三階升級傷害遞增');
  assert(rangeOk, `全部輕武器英雄射程 ×1.25 > ${HI_ALT}(高空射擊測試相容,#INC-104)`);
  // t03 輕武器基準 170 → ×1.2 = 204 < robot/drone 的 rangeCap,不會被夾,可驗純倍率
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
      const w = heroWeapon(id, slot, 3);          // 最高階也不得超標
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

log('— sim:傭兵變形者(雙陣營可選;HP/火力同機甲;飛行/地面雙型態)+ 陣亡購買 —');
{
  const mercs = Object.keys(CHARACTERS).filter((id) => CHARACTERS[id].side === 'MERC');
  assert(mercs.length === 8, `傭兵 ${mercs.length} 名(雙陣營共用)`);
  assert(mercs.every((id) => charsOf('SWARM').includes(id) && charsOf('STEEL').includes(id)),
    '雙陣營角色池皆含傭兵');
  assert(mercs.every((id) => CHARACTERS[id].kind === 'morph'),
    '傭兵一律駕駛變形者(kind:morph,不再駕駛無人機/機甲)');
  assert(UNITS.morph.hp === UNITS.robot.hp && UNITS.morph.shield === UNITS.robot.shield,
    `變形者 HP/護盾與機甲相同(${UNITS.morph.hp}/${UNITS.morph.shield})`);
  assert(Math.abs(heroWeapon('m01', 'light', 1, false).dmg - tierVal(CHARACTERS.m01.light.dmg, 1)) < 1e-6,
    '變形者傷害不吃小隊折算(火力同機甲)');
  const sim = new BattleSim(fakeBattleConfig(1));
  const a = sim.addHero('SWARM', 'p_ma', 'm02');
  const b = sim.addHero('STEEL', 'p_mb', 'm02');
  assert(a.kind === 'morph' && b.kind === 'morph', '傭兵受雇雙方皆為變形者(kind 不隨陣營)');
  assert(sim.squads.get('p_ma').bodies.length === 1, '變形者是單機(無三機小隊)');
  assert(a.maxHp === b.maxHp && a.armor === b.armor && a.maxSp === b.maxSp && a.maxMp === b.maxMp,
    `傭兵數值跨陣營一致(HP ${a.maxHp}/護甲 ${a.armor}/護盾 ${a.maxSp}/電力 ${a.maxMp})`);
  // 型態由回報高度 y 判定:飛行型(y>0)不觸發地雷,地面型(y≈0)會踩雷
  const nMines0 = sim.mines.length;
  [b.x, b.z] = sim.mines[0];
  b.y = 30;
  sim.tick(0.125);
  assert(sim.mines.length === nMines0, '飛行型態(y=30)不觸發地雷');
  b.y = 0;
  sim.tick(0.125);
  assert(sim.mines.length === nMines0 - 1 && b.sp < b.maxSp, '地面型態(y=0)踩雷受創');
  // 陣亡等待重生仍可購買(DOTA 慣例;修復「重生位置無法買東西」)
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
  // 注入一段橋面 ribbon(ty=1)與一段隧道天花 ribbon(ty=2);sim 座標,遠離兵線/工事避免流彈
  const ox = 4000, oz = 4000;
  sim._ingestSlabs({ slabs: [
    [ox, oz, ox + 120, oz, 8, 1],              // 橋面:x 軸向,半寬 8
    [ox, oz + 400, ox + 120, oz + 400, 8, 2],  // 隧道天花:平行另一段
  ] });
  assert(!!sim._slabGrid, 'slab 網格建立(_ingestSlabs)');
  // 受測敵方機體(hero,帶明確 lev):放在爆點正下/同層/側旁
  const mk = (x, z, lev) => sim._add({ kind: 'robot', side: 'STEEL', hero: true, dead: false,
    x, z, y: 0, hp: 600, armor: 0, sp: 0, maxSp: 0, lev, buffs: {}, mods: [] });
  const owner = sim.addHero('SWARM', 'p_bl', 'm01');   // 傭兵(雙陣營通用),爆風記在它頭上
  const def = { dmg: 300, r: 40, pen: 0 };             // 半徑 40 > 各測點距離
  const bx = ox + 60, bz = oz;                          // 爆點落在橋面 ribbon 上
  // ── 橋面:爆心在橋面(lev 1)──
  const onBridge = mk(bx, bz, 1);           // 同層(橋上)→ 應受創
  const underBridge = mk(bx, bz, 0);        // 正下方地面(lev 0)→ 橋板隔開,免傷
  const besideBridge = mk(bx, bz + 24, 0);  // 橋旁地面(off-ribbon,半寬 8 外)→ 側向溢流照炸
  sim._blast(owner, def, bx, bz, 0, 1);
  assert(onBridge.hp < onBridge.maxHp, '橋面爆風命中同層(橋上)目標');
  assert(underBridge.hp === underBridge.maxHp, '橋面爆風不穿透橋板打到正下方地面目標');
  assert(besideBridge.hp < besideBridge.maxHp, '橋旁地面(非正下方)仍受側向爆風(不誤擋)');
  // ── 隧道:爆心在洞內(lev 2)──
  const tx = ox + 60, tz = oz + 400;
  const inTunnel = mk(tx, tz, 2);           // 洞內同層 → 受創
  const outTunnel = mk(tx, tz, 0);          // 洞外(山體/天花隔開)→ 免傷
  sim._blast(owner, def, tx, tz, 0, 2);
  assert(inTunnel.hp < inTunnel.maxHp, '隧道內爆風命中同在洞內目標');
  assert(outTunnel.hp === outTunnel.maxHp, '洞內爆風不穿山體/天花波及洞外目標');
  // ── 迴歸:未上傳 slab(headless 常態)→ _slabSep 全放行,行為不變 ──
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
  // 十字交疊雙隧道(澀谷髮夾/交疊走廊的抽象):A 沿 x 軸、B 沿 z 軸,交會於 (cx, cz)
  const ox = 4000, oz = 4000, cx = ox + 100, cz = oz;
  sim._ingestSlabs({ slabs: [
    [ox, oz, ox + 200, oz, 8, 2],                    // 隧道 A:x 軸向,半寬 8
    [cx, oz - 100, cx, oz + 100, 8, 2],              // 隧道 B:z 軸向,交疊於 A 中段
  ] });
  assert(!!sim._slabGrid, 'slab 網格建立(_ingestSlabs)');
  const IN = { hero: true, lev: 2 };                 // 洞內端(客戶端回報 lev 2)
  const OUT = { hero: true, lev: 0 };                // 洞外端(地面)
  // ① 交疊區沿 B 軸出北洞口:穿 A 側牆但全程走在 B 走廊空腔內 → 放行(修正前 ANY-match 誤擋)
  assert(!sim._slabBlocked(cx, cz, cx, cz + 150, IN, OUT),
    '交疊區沿另一走廊軸出洞口:放行(隧道兵線對射不被岩盤誤吃)');
  assert(!sim._slabBlocked(cx, cz + 150, cx, cz, OUT, IN),
    '同一射線攻守互換同判(洞外 → 洞內沿軸):放行 = 洞內單位打得到也被打得到,無免傷掩體');
  // ② 交疊區斜向穿出:A、B 皆判側牆 → 仍擋(岩盤遮蔽不因交疊鬆動)
  assert(sim._slabBlocked(cx, cz, cx + 50, cz + 40, IN, OUT), '交疊區斜向穿雙側牆:仍擋');
  assert(sim._slabBlocked(cx + 50, cz + 40, cx, cz, OUT, IN), '斜向穿雙側牆攻守互換同判:擋');
  // ③ 單一 ribbon 段迴歸:非交疊處行為不變
  assert(sim._slabBlocked(ox + 30, oz, ox + 30, oz + 60, IN, OUT), '單一隧道側向穿出:擋(舊行為不變)');
  assert(!sim._slabBlocked(ox + 30, oz, ox - 60, oz, IN, OUT), '單一隧道沿軸出洞口:放行(舊行為不變)');
  // ④ 兩端皆非 lev 2(lev 抖動的另一相位)→ 側牆規則不套用(既有設計:客戶端 lev 權威)
  assert(!sim._slabBlocked(cx, cz, cx + 50, cz + 40, OUT, OUT), 'lev 0↔0 不觸發側牆規則(行為不變)');
  // ⑤ _losBlocked 佈線:slab 判定先於障礙網格,headless(無 occ)亦生效
  assert(sim._losBlocked(cx, cz, 2, cx + 50, cz + 40, 2, IN, OUT), '_losBlocked 佈線:側牆擋通過 slab 路徑');
  assert(!sim._losBlocked(cx, cz, 2, cx, cz + 150, 2, IN, OUT), '_losBlocked 佈線:沿軸出洞口放行');
}

log('— sim:榴彈類最小射程 → 太近則無差別波及友軍 + 自損(2026-07-27)—');
{
  // ① lobMinRange 推導:只 trajClass 'lob' 非零(= 爆風半徑 × LOB_MIN_F);其餘一律 0
  assert(lobMinRange({ type: 'launcher', r: 20 }) === 20 * BALLISTIC.LOB_MIN_F, 'lobMinRange:榴彈(launcher 無導引)= 爆風半徑 × LOB_MIN_F');
  assert(lobMinRange({ type: 'launcher', guide: 1, r: 20 }) === 0, 'lobMinRange:導引 launcher 不吃(trajClass guide,已有 ARMING)');
  assert(lobMinRange({ type: 'missile', r: 20 }) === 0, 'lobMinRange:飛彈不吃(trajClass fnf,自導武器)');
  assert(lobMinRange({ type: 'gun', r: 5 }) === 0, 'lobMinRange:直擊/輕武器不吃');
  assert(lobMinRange({ type: 'plasma', fan: true, r: 5 }) === 0, 'lobMinRange:扇形不吃');
  // 152 榴彈砲(t01)實際武器解析後 def.r 為純量 ⇒ lobMinRange 良好定義且 > 0
  assert(lobMinRange(heroWeapon('t01', 'heavy', 1)) > 0, 'lobMinRange:t01 152榴彈砲(解析後)> 0');

  const def = { dmg: 300, r: 40, pen: 0 };   // 半徑 40:射手/友軍/敵方三點皆在爆風內
  // ② friendly=true(落點近於最小射程):敵我 + 射手自身皆受創
  const sim = new BattleSim(fakeBattleConfig(1));
  purgeCamps(sim);
  const owner = sim.addHero('STEEL', 'p_lob', 't01');
  owner.x = 4000; owner.z = 4000;   // 遠離工事/兵線,隔離其他 ent
  const ally = sim._add({ kind: 'soldier', side: 'STEEL', x: owner.x + 6, z: owner.z, y: 0, hp: UNITS.soldier.hp });
  const foe = sim._add({ kind: 'soldier', side: 'SWARM', x: owner.x + 6, z: owner.z + 6, y: 0, hp: UNITS.soldier.hp });
  const ohp0 = owner.hp + (owner.sp || 0);
  sim._blast(owner, def, owner.x, owner.z, 0, null, true);
  assert(owner.hp + (owner.sp || 0) < ohp0, '無差別模式:射手自身受創(自損)');
  assert(ally.hp < UNITS.soldier.hp, '無差別模式:友軍被波及(不分敵我)');
  assert(foe.hp < UNITS.soldier.hp, '無差別模式:敵方照樣受創');

  // ③ friendly=false(≥ 最小射程,正常模式):只傷敵,友軍/自身無傷(迴歸:一般榴彈行為不變)
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

log('— sim:地雷佈設(非正規路線)+ 機甲踩雷 —');
{
  const sim = new BattleSim(fakeBattleConfig(1));
  purgeCamps(sim);
  assert(sim.mines.length >= 20, `地雷 ${sim.mines.length} 顆(目標 ${GAME.MINES.PER_LANE}/線)`);
  assert(sim.mines.every(([x, z]) => sim._distToLanes(x, z) >= GAME.MINES.LANE_CLEAR), '雷區避開兵線走廊');
  const rb = sim.addHero('STEEL', 'p_r', 't01');   // 冬將軍(輕武器無爆擊 → 傷害確定性)
  const nMines = sim.mines.length;
  [rb.x, rb.z] = sim.mines[0];
  sim.tick(0.125);
  assert(rb.sp < rb.maxSp && sim.mines.length === nMines - 1,
    `機甲踩雷受創(護盾 ${rb.maxSp} → ${Math.round(rb.sp)},雷被消耗)`);
  assert(sim.events.some((e) => e.e === 'boom' && e.mine && e.tpid === 'p_r'), '地雷爆炸事件帶 tpid');
  assert(sim.events.some((e) => e.e === 'boom' && e.mine && e.mid != null), '地雷爆炸事件帶 mid(客戶端移除微凸起)');
  assert(sim.fieldPayload().mines.every((m) => m.length === 3), 'fieldPayload 地雷格式 [x,z,id]');

  log('— sim:武器克制 × 護甲減免 + 彈夾上限 —');
  // 2026-07-25 起所有武器暴擊率 ≥5%(見 data.VITALS.CRIT_MIN),t01 輕武器已非 crit:0 →
  // 這兩段「確定性傷害」斷言改以 Math.random 樁固定不觸發暴擊/閃避(0.999 ≥ 任何 crit ≤ 0.28)。
  const _rnd0 = Math.random; Math.random = () => 0.999;
  const wl = heroWeapon('t01', 'light', 1);
  const dummy = sim._add({ kind: 'soldier', side: 'SWARM', x: rb.x + 10, z: rb.z, hp: UNITS.soldier.hp });
  sim.t += 1;   // 越過射速下限
  sim.heroHit('p_r', dummy.id);
  const expSoldier = wl.dmg * 1.3 * armorMul(UNITS.soldier.armor, wl.pen);
  assert(Math.abs((UNITS.soldier.hp - dummy.hp) - expSoldier) < 0.5,
    `克制傷害 ${(UNITS.soldier.hp - dummy.hp).toFixed(1)}(= ${wl.dmg} × 肉體 1.3 × 護甲減免)`);
  sim.ents.delete(dummy.id);   // 測試假人沒有 lane,tick 前先移除
  const tw = [...sim.ents.values()].find((e) => e.kind === 'tower' && e.side === 'SWARM');
  rb.x = tw.x + 30; rb.z = tw.z;
  rb.ammo = {}; rb.fireAt = {}; rb.reloadUntil = {};   // 重置彈藥計數
  const hp0t = tw.hp;
  const shots = wl.mag + 10;   // 填彈完成前打完(只吃得進一個彈夾)
  for (let i = 0; i < shots; i++) { sim.t += 0.16; sim.heroHit('p_r', tw.id); }
  const magDmg = hp0t - tw.hp;
  const expMag = wl.mag * wl.dmg * 0.6 * armorMul(UNITS.tower.armor, wl.pen);
  assert(Math.abs(magDmg - expMag) < 1,
    `${shots} 連發只吃進一個彈夾 ${wl.mag} 發 × 建築 0.6 × 護甲減免(傷害 ${magDmg.toFixed(1)},其餘填彈中被拒)`);

  log('— sim:射程閘門量到目標「近側表面」(_surfD3 = d3 − hitR;射程邊界打建築不再被靜默丟棄)—');
  {
    const rr = hitR(tw);
    assert(rr >= 7, `砲塔水平量體 hitR = ${rr}m(彈著停在牆面,離中心就是這麼遠)`);
    rb.ammo = {}; rb.fireAt = {}; rb.reloadUntil = {};
    // 表面剛好壓在 ×1.25 寬容內(中心距離 = 射程 ×1.25 + hitR − 1):舊制量中心 ⇒ 這發被靜默丟棄
    rb.x = tw.x + wl.range * 1.25 + rr - 1; rb.z = tw.z;
    const hpEdge = tw.hp;
    sim.t += 1;
    sim.heroHit('p_r', tw.id);
    assert(tw.hp < hpEdge, '表面在 ×1.25 寬容內(中心超界)命中(舊制以中心量距在此靜默丟棄)');
    // 表面也超出 ×1.25 寬容 → 仍靜默丟棄(防作弊上限不因 hitR 無限放寬)
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
    fh.x = 700; fh.z = 700; fh.y = 0;   // 遠離兵線/塔,避免流彈干擾
    const arc = (wf.arc || 15) * Math.PI / 180;
    const mkT = (ang) => sim._add({ kind: 'soldier', side: 'STEEL',
      x: fh.x + 30 * Math.sin(ang), z: fh.z + 30 * Math.cos(ang), y: 0, hp: 99999 });
    const tc = mkT(0), te = mkT(arc * 0.8);   // 正對錐軸 / 錐緣 80%(同距離 ⇒ 距離衰減互相抵銷)
    sim.t += 5;
    sim.heroPlasma('p_f', 0, 1, 'light');
    const dc = 99999 - tc.hp, de = 99999 - te.hp;
    assert(dc > 0 && de > 0, '錐內兩目標(正對錐軸 / 錐緣 80%)都命中');
    const expF = offAxisFalloff(0.8);
    assert(Math.abs(de / dc - expF) < 0.03,
      `偏心遞減 ×${(de / dc).toFixed(3)}(期望 ${expF.toFixed(3)};正對錐軸滿額)`);
    assert(Math.abs(offAxisFalloff(1) - AOE_EDGE) < 1e-9, `錐緣保底 = AOE_EDGE(${AOE_EDGE})`);
    sim.ents.delete(tc.id); sim.ents.delete(te.id);   // 測試假人沒有 lane,tick 前先移除
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
  assert(Math.abs(heroWeapon('s01', 'light', 1, false).dmg - tierVal(CHARACTERS.s01.light.dmg, 1)) < 1e-6,
    '無人機單機傷害 = 原數值(DMG=1,不折算)');
  assert(Math.abs(heroWeapon('t01', 'light', 1, false).dmg - tierVal(CHARACTERS.t01.light.dmg, 1)) < 1e-6,
    '機甲傷害不被折算');
  assert(Math.abs(UNITS.drone.sight / UNITS.robot.sight - 1.125) < 0.01,
    `無人機射程上限 ≈ 機甲 ×9/8(sight ${UNITS.drone.sight} vs ${UNITS.robot.sight},射程較機甲高約 1/8)`);

  log('— sim:無人機飽和攻擊(長按右鍵:4 架衝出 / 每架半傷 / 3 倍速撲擊 / 吸走導引飛彈 / 主機不自爆)—');
  const $kill0 = dr.money;
  sim.heroKamikaze('p_d');
  assert(sq.kamis.length === SQUAD.KAMI.N, `護衛機衝出 ${SQUAD.KAMI.N} 架(實際 ${sq.kamis.length})`);
  assert(!dr.dead, '主機不自爆(護衛機才是自殺攻擊來源)');
  assert(sq.kamis.every((k) => k.kami && k.side === 'SWARM' && k.hp === kamiHp() && k.armor === 0 && k.maxSp === 0),
    `護衛機 HP = kamiHp() 推導 ${kamiHp()}、armor/護盾 0(校準不隨主機漂移)`);
  // 橫向站位由 kamiSide 單一縫散開(N=4 ⇒ 左右各兩架,MUST NOT 全擠一側)
  assert(sq.kamis.filter((k) => k.ry < dr.ry).length === SQUAD.KAMI.N / 2,
    `${SQUAD.KAMI.N} 架左右對半散開(kamiSide 單一縫)`);
  assert(sq.kamiCd > sim.t, `冷卻啟動(CD ${SQUAD.KAMI.CD_S}s)`);
  sim.heroKamikaze('p_d');
  assert(sq.kamis.length === SQUAD.KAMI.N, '冷卻中再按不會再生成一批');
  // 導引飛彈吸附:朝主機發射的追蹤飛彈 → 改追最近的自殺機(吸走砲火)
  sim.missiles.push({ id: 990001, byId: 0, side: 'STEEL', tid: dr.id, tpid: 'p_d',
    x: dr.x, z: dr.z + 40, y: dr.y || 0, speed: 1, dmg: 10, pen: 0, hp: 40, ttl: 14 });
  sim._tickMissiles(0.001);
  assert(sq.kamis.some((k) => k.id === sim.missiles[0].tid), '敵方導引飛彈被自殺機吸走砲火(改追自殺機)');
  sim.missiles.length = 0;
  // 撲擊近炸:把護衛機挪到孤立敵人旁,tick 引爆 → 重型炸彈爆風命中、擊殺記主機。
  // 2026-08-01 飽和攻擊改制:每架威力減半(預算 / 4)⇒ **一架殺不死一名步槍兵**,兩架才行 ——
  // 這正是「攻擊力減半、數量加倍」的設計面貌(單點爆發下降、覆蓋面上升)。
  const k0 = sq.kamis[0], k0b = sq.kamis[1];
  const victim = sim._add({ kind: 'soldier', side: 'STEEL', x: dr.x + 400, z: dr.z + 400, hp: UNITS.soldier.hp });
  k0.x = victim.x - 1; k0.z = victim.z; k0.y = 0; k0.tid = victim.id;
  sim._tickKamis(0.05);
  assert(sim.ents.has(victim.id) && victim.hp < UNITS.soldier.hp,
    `單架護衛機打掉步槍兵 ${Math.round(UNITS.soldier.hp - victim.hp)} 點但殺不死(每架威力減半)`);
  assert(!sim.ents.has(k0.id) && !sq.kamis.includes(k0), '護衛機引爆後移除');
  k0b.x = victim.x - 1; k0b.z = victim.z; k0b.y = 0; k0b.tid = victim.id;
  sim._tickKamis(0.05);
  assert(!sim.ents.has(victim.id), '第二架補上 → 炸死孤立敵兵(數量取代單發爆發)');
  assert(dr.money - $kill0 >= ECON.BOUNTY.soldier, `擊殺賞金記主機 +$${Math.round(dr.money - $kill0)}`);
  // 傷害驗證(2026-07-27 改制):每架護衛機爆風 = 機種絕招預算 / KAMI.N(N 架打完 = 一份完整預算)
  if (sq.kamis.length) {
    const k1 = sq.kamis[0];
    const beef = sim._add({ kind: 'soldier', side: 'STEEL', x: dr.x - 400, z: dr.z - 400, y: 0, hp: 9999 });
    k1.x = beef.x; k1.z = beef.z; k1.y = 0; k1.tid = beef.id;
    const bhp0 = beef.hp;
    sim._tickKamis(0.05);
    const kd = kamiBlast(dr.abil);
    const expOne = kd.dmg * WEAPONS.bomb.vs.flesh * armorMul(UNITS.soldier.armor, WEAPONS.bomb.pen);
    assert(Math.abs((bhp0 - beef.hp) - expOne) < 2,
      `護衛機近炸 ${(bhp0 - beef.hp).toFixed(0)} ≈ 絕招預算 ${Math.round(specialBudget(dr.abil))}/${SQUAD.KAMI.N}`
      + ` × 肉體 ${WEAPONS.bomb.vs.flesh} × 護甲減免(${expOne.toFixed(0)})`);
    if (sim.ents.has(beef.id)) sim.ents.delete(beef.id);
  }
  for (const k of [...sq.kamis]) sim._removeKami(k);   // 收掉剩餘護衛機

  log('— sim:無人機重生冷卻 —');
  dr.hp = 0; sim._kill(dr, null);
  assert(dr.dead, '無人機被擊落 → dead');
  sim.tick(0.05);
  assert(dr.dead, '死亡當下那個 tick 仍維持 dead(確保至少一份快照廣播 dead:true)');
  assert(UNITS.drone.respawn.base > 0 && UNITS.robot.respawn.base > 0, '無人機/機甲重生都有冷卻(數值檢查)');
  sim.t += UNITS.drone.respawn.base + UNITS.drone.respawn.perDeath * 3;
  sim.tick(0.05); sim.tick(0.05);
  assert(!dr.dead, `重生冷卻結束後歸隊(base ${UNITS.drone.respawn.base}s)`);
  dr.rg = false;
  sim.heroes.set('p_d', dr); sq.act = 0;   // 主視野切回 dr,後續測試對它結算

  log('— sim:變形者集束炸彈(分離集束轟炸機 / 逐顆個別瞄準 / 追蹤 / 失聯;機甲改極音速飛彈無轟炸機)—');
  {
    // 機甲(robot)不會分離集束轟炸機(它走極音速飛彈)
    const rbR = sim.heroes.get('p_r');
    rbR.dead = false; rbR.x = 0; rbR.z = 0; rbR.y = 0;
    sim.squads.get('p_r').decoyCd = 0;
    sim.heroDecoy('p_r');
    assert(!sim.squads.get('p_r').decoy, '機甲(robot)不分離集束轟炸機(改極音速飛彈)');

    // 變形者(morph)分離集束轟炸機
    const mo = sim.addHero('STEEL', 'p_m', 'm01');
    mo.dead = false; mo.hp = mo.maxHp; mo.x = 0; mo.z = 0; mo.y = 0; mo.ry = 0;
    const msq = sim.squads.get('p_m');
    sim.heroDecoy('p_m');
    const d = msq.decoy;
    assert(!!d && d.kind === 'decoy', '變形者長按右鍵分離出集束轟炸機(無鎖定 = 直飛)');
    assert(d.hp === decoyHp() && d.armor === 0,
      `轟炸機 HP = decoyHp() 推導 ${decoyHp()}、armor 0(校準不隨主機漂移)`);
    assert(d.bombType && d.bombsLeft === DECOY.BOMB_MAX && DECOY.BOMB_MAX === 6,
      `集束投彈:類型 ${d.bombType}、彈數 ${d.bombsLeft}(使用者定調最多 6 顆)`);
    assert(DECOY.HP_F === undefined, '舊 DECOY.HP_F(主機血量比例)MUST 已移除');
    assert(msq.decoyCd > sim.t, '發射即進入冷卻,空中同時只有一架');
    const before = msq.decoy;
    sim.heroDecoy('p_m');
    assert(msq.decoy === before, '冷卻/空中有機時再按無效');

    // 集束投彈:敵人進 BOMB_R 才丟一顆,依機體類型(m01 = 雷爆)附加狀態
    const bombDef = DECOY_BOMB[d.bombType];
    const prey = sim._add({ kind: 'soldier', side: 'SWARM', x: d.x + 5, z: d.z, y: 0, hp: 9999 });
    const bl0 = d.bombsLeft, php0 = prey.hp;
    d.nextBomb = 0;
    sim._tickDecoys(0.05);
    assert(d.bombsLeft === bl0 - 1, `敵入攻擊範圍 → 投下一顆(剩 ${d.bombsLeft})`);
    assert(php0 - prey.hp > 0, '投彈直擊造成傷害(略高於輕武器)');
    // 逐顆個別瞄準:落點 = 目標位置(不是轟炸機腳下),事件另帶投擲點 fx/fz(客戶端畫榴彈拋物線)
    {
      const ev = sim.events.filter((e) => e.e === 'decoyBomb').pop();
      assert(ev && Math.abs(ev.x - prey.x) < 1e-6 && Math.abs(ev.z - prey.z) < 1e-6,
        `炸彈落點 = 被瞄準目標的位置(${ev.x.toFixed(1)}, ${ev.z.toFixed(1)})`);
      assert(ev.fx != null && ev.fz != null, '事件帶投擲點 fx/fz ⇒ 客戶端能畫出榴彈拋物線');
    }
    // 多目標 → 個別瞄準:第二顆換打另一個目標(名冊 d.bombed 記已指派過的)
    {
      const prey2 = sim._add({ kind: 'soldier', side: 'SWARM', x: d.x + 12, z: d.z + 3, y: 0, hp: 9999 });
      d.nextBomb = 0;
      sim._tickDecoys(0.05);
      const ev = sim.events.filter((e) => e.e === 'decoyBomb').pop();
      assert(Math.abs(ev.x - prey2.x) < 1e-6 && Math.abs(ev.z - prey2.z) < 1e-6,
        '多目標時第二顆改瞄另一個目標(個別瞄準,不重複轟同一個)');
      sim.ents.delete(prey2.id);
    }
    assert(prey.asst && prey.asst.p_m != null, '投彈貢獻記助攻(輔助收入)');
    if (bombDef.dot) assert(prey.bleed && prey.bleed.pid === 'p_m', '燃燒/毒霧:持續傷害 DoT(記施放者)');
    if (bombDef.slow) assert((prey.slowUntil || 0) > sim.t, '凍結/毒霧:減速');
    if (bombDef.emp) assert((prey.empUntil || 0) > sim.t, '雷爆:武器離線 EMP');
    if (bombDef.stun) assert((prey.stunUntil || 0) > sim.t, '雷爆:短暫麻痺');
    sim.ents.delete(prey.id);

    // 誘餌:它是敵方的合法目標,且被擊落不引爆
    const bait = sim._acquireTarget({ side: 'SWARM', x: d.x, z: d.z }, { range: 200 });
    assert(bait === d || bait?.kind === 'decoy', '集束轟炸機是敵方單位的合法鎖定目標(吸火力)');
    // 「5 + 1」的 +1:墜毀時仍有存彈 → 原地補投一顆
    const bl1 = d.bombsLeft;
    d.hp = 0;
    sim._kill(d, null);
    assert(d.bombsLeft === bl1 - 1, `被擊落時尚有存彈 → 墜毀補投一顆(剩 ${d.bombsLeft})`);
    assert(!sim.ents.has(d.id) && !msq.decoy, '集束轟炸機被擊落 → 從場上與小隊狀態一起清掉');

    // 失聯:超過 LINK_M 即斷訊、放棄追蹤,且不再提供視野
    msq.decoyCd = 0;
    sim.heroDecoy('p_m');
    const d2 = msq.decoy;
    d2.x = mo.x + DECOY.LINK_M + 50;
    d2.tid = 999;
    sim._tickDecoys(0.05);
    assert(d2.lost && !d2.tid, `集束轟炸機超過 ${DECOY.LINK_M}m 失聯(鏈路中斷 → 失去火控)`);
    assert(!sim._visionSources('STEEL').some(([sx]) => Math.abs(sx - d2.x) < 1e-6),
      '失聯的集束轟炸機不再回傳視野');
    // 燃料耗盡自爆(爆風算主機甲頭上)
    const near = sim._add({ kind: 'soldier', side: 'SWARM', x: d2.x + 2, z: d2.z, y: 0, hp: UNITS.soldier.hp });
    near.y = d2.y;
    d2.dieAt = sim.t - 1;
    sim._tickDecoys(0.05);
    assert(!msq.decoy, '燃料耗盡 → 自爆並清場');
    assert(!sim.ents.has(near.id),
      `自爆爆風(${decoyBlast(mo.abil).dmg} × 肉體 ${DECOY.vs.flesh})炸死近旁敵兵`);
    assert(LOCK.TTL > 0 && DECOY.CD_S > 0, '鎖定時效 / 集束炸彈冷卻皆為正值');
  }

  log('— sim:bot 飛行機體受擊掉高(真人那份住客戶端物理;掉幅 ∝ 實際護盾+裝甲損耗)—');
  {
    // bot 沒有客戶端 ⇒ 高度由伺服器寫;規則與客戶端共用同一支 airSinkM(MUST NOT 兩套係數)
    const droneCh = charsOf('SWARM').find((c) => charKind(c) === 'drone');
    const bot = sim.addHero('SWARM', 'b_air', droneCh);
    bot.y = 200; bot.sp = bot.maxSp; bot.hp = bot.maxHp;
    const foe = { side: 'STEEL', hero: false };
    const sp0 = bot.sp;
    sim._damage(bot, 100, foe, 0);
    const lost1 = sp0 - bot.sp;
    assert(Math.abs((200 - bot.y) - airSinkM(lost1)) < 1e-6,
      `護盾階段:掉 ${(200 - bot.y).toFixed(2)}m = airSinkM(損耗 ${lost1.toFixed(0)})`);
    // 打光護盾+裝甲 ⇒ 掉 FLIGHT.SINK_TOWERS 個砲塔高(校準錨;分多次打完累計相同)
    const b2 = sim.addHero('SWARM', 'b_air2', droneCh);
    b2.y = 500; b2.sp = b2.maxSp; b2.hp = b2.maxHp;
    let guard = 0;
    while (b2.hp > 0 && guard++ < 500) sim._damage(b2, 40, foe, 999);   // pen 999 = 無視護甲,損耗 = 傷害
    const drop = 500 - b2.y;
    const want = airSinkM((sim.heroes.get('b_air2')?.maxSp || 0) + 0);
    assert(drop > want * 0.9,
      `打光整條護盾+裝甲掉 ${drop.toFixed(0)}m ≈ ${FLIGHT.SINK_TOWERS} 個砲塔高等級(校準錨)`);
    assert(b2.y >= 0, '掉高夾在地面(不會掉到地表以下)');
    // 地面機體(非飛行)不掉高
    const ground = sim.heroes.get('p_r');
    ground.dead = false; ground.y = 0; ground.hp = ground.maxHp; ground.sp = ground.maxSp;
    sim._damage(ground, 100, foe, 0);
    assert((ground.y || 0) === 0, '地面機甲不掉高(規則只作用於飛行機體)');
    sim.heroes.delete('b_air'); sim.heroes.delete('b_air2');
    sim.squads.delete('b_air'); sim.squads.delete('b_air2');
    for (const e of [...sim.ents.values()]) if (e.pid === 'b_air' || e.pid === 'b_air2') sim.ents.delete(e.id);
  }

  log('— sim:極音速飛彈(2026-08-01;機甲長按招式:高空爬升 → 螺旋俯衝 / 射後不理 / 可被擊落)—');
  {
    const rb3 = sim.heroes.get('p_r');
    rb3.dead = false; rb3.hp = rb3.maxHp; rb3.mp = rb3.maxMp; rb3.x = 0; rb3.z = 0; rb3.y = 0; rb3.ry = 0;
    rb3.hyperCd = 0; rb3.hyper = null;
    rb3.ammo = {}; rb3.fireAt = {}; rb3.reloadUntil = {};
    // 舊巨砲整組移除:資料層與伺服器都不該再有任何殘留入口
    assert(sim.heroBarrage === undefined && sim._barragingDmg === undefined,
      '舊巨砲入口(heroBarrage / _barragingDmg)MUST 已移除');
    // 機種閘門:只有機甲能發射
    sim.heroHyper('p_d'); assert(!sim.heroes.get('p_d').hyper, '無人機不能發射極音速飛彈');
    sim.heroHyper('p_m'); assert(!sim.heroes.get('p_m').hyper, '變形者不能發射極音速飛彈');
    // 射後不理 ⇒ 不需狙擊模式、不吃彈夾(空夾/裝填中照樣發射)
    rb3.aiming = false;
    rb3.reloadUntil = { heavy: sim.t + 5 }; rb3.ammo = { heavy: 0 };
    sim.heroHyper('p_r');
    const m = rb3.hyper;
    assert(!!m && m.kind === 'hyper', '一般模式(非狙擊)+ 空夾/裝填中照樣發射得出極音速飛彈');
    assert((rb3.hyperCd || 0) > sim.t, '發射即進入冷卻');
    assert(m.hp === hyperHp() && m.armor === 0,
      `飛彈 HP = hyperHp() 推導 ${hyperHp()}、armor 0(一座砲塔剛好打不爆)`);
    assert(rb3.ammo.heavy === 0, '發射不消耗一般重武器彈夾(它與彈夾完全脫鉤)');
    const before = rb3.hyper;
    sim.heroHyper('p_r');
    assert(rb3.hyper === before, '冷卻中 / 空中已有一枚時再按無效');
    // 它是敵方的合法鎖定目標(「可以被攻擊」)—— 挪到空曠處量,否則同格的機甲本體(英雄偏好)會先被選走
    m.x = 900; m.z = 900; m.y = 20;
    const lock = sim._acquireTarget({ side: 'SWARM', x: m.x, z: m.z }, { range: 200 });
    assert(lock === m, '飛行中的極音速飛彈是敵方單位的合法鎖定目標(「可以被攻擊」)');
    m.x = 0; m.z = 0;
    // 相位一:垂直爬升到 hyperApex(),期間不吃玩家輸入
    m.y = 0; m.phase = 'climb';
    let guard = 0;
    while (m.phase === 'climb' && guard++ < 400) sim._tickHypers(0.05);
    assert(m.phase === 'dive' && Math.abs(m.y - hyperApex()) < 1e-6,
      `爬到 hyperApex() = ${hyperApex()}m 即轉入俯衝相位(實得 ${m.y.toFixed(1)}m)`);
    // 相位二:螺旋俯衝到落點 → 引爆(整份絕招預算的單一戰鬥部)
    const tgt = sim._add({ kind: 'soldier', side: 'SWARM', x: m.tx, z: m.tz, y: 0, hp: 9999 });
    const spin0 = m.spin;
    sim._tickHypers(0.05);
    assert(m.spin > spin0, '俯衝相位持續累積螺旋相位(SPIN_RPS)');
    guard = 0;
    while (rb3.hyper && guard++ < 400) sim._tickHypers(0.05);
    assert(!rb3.hyper && !sim.ents.has(m.id), '俯衝抵達落點 → 引爆並清場');
    assert(tgt.hp < 9999, `落點爆風命中目標(戰鬥部 ${hyperBlast(rb3.abil).dmg} = 整份絕招預算)`);
    sim.ents.delete(tgt.id);
    // 被攔截:不引爆(攔截成功 = 完全否定這一招)
    rb3.hyperCd = 0;
    sim.heroHyper('p_r');
    const m2 = rb3.hyper;
    const bystander = sim._add({ kind: 'soldier', side: 'SWARM', x: m2.x + 2, z: m2.z, y: 0, hp: UNITS.soldier.hp });
    m2.hp = 0;
    sim._kill(m2, null);
    assert(!rb3.hyper && !sim.ents.has(m2.id), '飛彈被擊落 → 從場上與英雄狀態一起清掉');
    assert(bystander.hp === UNITS.soldier.hp, '被擊落**不引爆**(旁邊的敵兵毫髮無傷)');
    sim.ents.delete(bystander.id);
    rb3.hyperCd = 0; rb3.hyper = null; rb3.ammo = {}; rb3.fireAt = {}; rb3.reloadUntil = {};
  }

  log('— data:機種絕招載具 HP 一律由「一座砲塔打幾秒」反解(2026-08-01 使用者定調)—');
  {
    assert(towerDps() === UNITS.tower.dmg * UNITS.tower.rate,
      `一座砲塔基準 DPS = dmg × rate = ${towerDps()}(砲塔無 wid ⇒ pen 0,不吃 armorMul)`);
    // 飽和攻擊:4 架,一座砲塔剛好擊落 SHOT_DOWN(2)架 ⇒ 成功自爆 2 架
    assert(SQUAD.KAMI.N === 4 && SQUAD.KAMI.SHOT_DOWN === 2,
      `飽和攻擊 ${SQUAD.KAMI.N} 架、一座砲塔擊落 ${SQUAD.KAMI.SHOT_DOWN} 架 ⇒ 成功自爆 ${SQUAD.KAMI.N - SQUAD.KAMI.SHOT_DOWN} 架`);
    assert(SQUAD.KAMI.HP_F === undefined, '舊 KAMI.HP_F(主機血量比例)MUST 已移除');
    assert(Math.abs(kamiHp() / towerDps() * SQUAD.KAMI.SHOT_DOWN - kamiExposureS()) < 0.5,
      `單架護衛機撐 ${(kamiHp() / towerDps()).toFixed(2)}s × ${SQUAD.KAMI.SHOT_DOWN} 架 ≈ 曝險窗 ${kamiExposureS().toFixed(2)}s`);
    // 橫向站位單一縫:N 架均勻散開、對稱、涵蓋 [−1, 1]
    {
      const ss = Array.from({ length: SQUAD.KAMI.N }, (_, i) => kamiSide(i));
      assert(ss[0] === -1 && ss[ss.length - 1] === 1, `kamiSide 涵蓋整個 [−1, 1](${ss.join(', ')})`);
      assert(Math.abs(ss.reduce((a2, b2) => a2 + b2, 0)) < 1e-9, 'kamiSide 左右對稱(總和為 0)');
    }
    // 極音速飛彈:撐得住最長一次飛行 = 剛好不會被打爆(打完仍剩 ≥1 滴)
    assert(hyperHp() > towerDps() * hyperFlightS(),
      `飛彈 HP ${hyperHp()} > 一座砲塔全程輸出 ${(towerDps() * hyperFlightS()).toFixed(0)}(剛好打不爆)`);
    assert(hyperHp() - towerDps() * hyperFlightS() < towerDps(),
      '餘裕 < 一發塔砲 ⇒ 是「剛好」不是「綽綽有餘」(兩座塔就打得下來)');
    assert(hyperRange() > UNITS.tower.range,
      `飛彈接戰距離 ${hyperRange()} > 砲塔射程 ${UNITS.tower.range}(機甲的攻塔手段)`);
    assert(hyperApex() > GAME.GUN_CEIL_M,
      `爬升頂點 ${hyperApex()} > 直射鎖定天花板 ${GAME.GUN_CEIL_M}`);
    // 集束炸彈:撐到投完 DROP_N 顆(5)就被擊落,墜毀補投 1 顆 ⇒ 5 + 1
    assert(DECOY.DROP_N === 5 && DECOY.DROP_N + 1 === DECOY.BOMB_MAX,
      `集束轟炸機在一座砲塔火力下投得完 ${DECOY.DROP_N} 顆 + 墜毀補投 1 顆 = ${DECOY.BOMB_MAX} 顆`);
    assert(Math.abs(decoyHp() / towerDps() - decoyExposureS()) < 0.5,
      `轟炸機撐 ${(decoyHp() / towerDps()).toFixed(2)}s ≈ 曝險窗 ${decoyExposureS().toFixed(2)}s`);
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
    // 三招在同一綜合等級下的「一次絕招總傷害」等值(±2%,只差四捨五入)
    for (const abil of [L1, MIX, L4]) {
      const budget = specialBudget(abil);
      const kami = kamiBlast(abil).dmg * SQUAD.KAMI.N;
      const decoy = decoyBlast(abil).dmg + decoyBombBlast(abil).dmg * DECOY.BOMB_MAX;
      const solo = selfBoomBlast(abil).dmg;
      const hyper = hyperBlast(abil).dmg;
      for (const [name, tot] of [['飽和攻擊', kami], ['集束炸彈', decoy], ['主機自毀', solo], ['極音速飛彈', hyper]]) {
        assert(Math.abs(tot - budget) <= budget * 0.02,
          `綜合 Lv${specialTier(abil)} ${name}總傷害 ${Math.round(tot)} ≈ 預算 ${Math.round(budget)}`);
      }
    }
    // 舊巨砲的發數/開窗常數整組移除(改招後不該再有任何殘留 export)
    assert(HYPER && HYPER.CD_S > 0, 'HYPER 取代 BARRAGE 成為機甲長按招式的常數組');
  }

  log('— data:八軌升級第三階單價 = $200(2026-07-27)—');
  {
    for (const [key, up] of Object.entries(ECON.UPGRADES)) {
      assert(upgradePrice(up, UPG_L3_LVL) === ECON.UPG_L3,
        `${key}(${up.name})第三階 $${upgradePrice(up, UPG_L3_LVL)} = $${ECON.UPG_L3}`);
    }
    assert(ECON.UPG_L3 === 200, `第三階單價常數 = $200(實得 $${ECON.UPG_L3})`);
    assert(upgradePrice(ECON.UPGRADES.lw, 0) === ECON.UPG_BASE
      && upgradePrice(ECON.UPGRADES.lw, 1) === ECON.UPG_BASE + ECON.UPG_INC,
      `前兩階仍走階梯 $${ECON.UPG_BASE} / $${ECON.UPG_BASE + ECON.UPG_INC}`);
    const total = Object.values(ECON.UPGRADES)
      .reduce((s, u) => { for (let l = 0; l < u.max; l++) s += upgradePrice(u, l); return s; }, 0);
    assert(total === 3200, `八軌全滿總價 $${total}(8 ×(75+125+200))`);
  }

  log('— sim:升級快照傳「值」不傳權威物件參考(單機不經 JSON;否則客戶端樂觀購買雙重遞增 → 兩次就滿)—');
  {
    const sim = new BattleSim(fakeBattleConfig(1));
    const h = sim.addHero('SWARM', 'pu', 's01');
    const snap = sim._serializeEnt(h);
    assert(snap.up !== h.upg && snap.ab !== h.abil, '_serializeEnt 的 up/ab 是新物件(非權威參考)');
    snap.up.lw = 99; snap.ab.light = 99;                        // 模擬客戶端 mutate 快照那份
    assert(h.upg.lw === 0 && h.abil.light === 1, 'mutate 快照不污染伺服器權威 upg/abil');
    // 單機真實路徑:每次購買前「客戶端 this.upg = e.up」再樂觀 +1,伺服器再權威結算一次。
    // 修復前 e.up === h.upg ⇒ 樂觀 +1 就地污染權威 ⇒ 伺服器再 +1 = 雙重遞增,三階軌兩次就滿。
    h.money = 99999;
    let presses = 0;
    while ((h.upg.lw || 0) < ECON.UPGRADES.lw.max && presses < 10) {
      presses++;
      const clientUpg = sim._serializeEnt(h).up;               // this.upg = e.up
      clientUpg.lw = (clientUpg.lw || 0) + 1;                   // 客戶端樂觀 +1(不得污染權威)
      sim.buy('pu', 'lw');                                     // 伺服器權威購買
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

    // 實際節流行為(BotBrain._op 是唯一縫):以假 sim 推時鐘,數 10 秒內准許的操作數
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
    // 全域手速閘:不同類操作也互相排擠(一次只能做一件事)
    {
      const brain = new BotBrain(fake, 'bx', 'STEEL', 0, 'high');
      let n = 0;
      for (fake.t = 0; fake.t < 10; fake.t += GAME.TICK_MS / 1000) {
        for (const op of ['scan', 'weapon', 'ability', 'special', 'state', 'buy']) if (brain._op(op)) n++;
      }
      assert(n <= Math.ceil(10 / BOT_DIFF.high.gap),
        `最高難度 10 秒內全類操作合計 ${n} 次 ≤ 手速上限 ${Math.ceil(10 / BOT_DIFF.high.gap)} 次(≈400 APM)`);
    }
    // 反應時間:換目標後的 react 秒內開不了火(連 sim.botFire 都不會被呼叫)
    {
      const brain = new BotBrain(fake, 'bx', 'STEEL', 0, 'high');
      fake.t = 0; brain._aimAt = BOT_DIFF.high.react;
      assert(brain._fire(1, 'light') === false, `反應時間 ${BOT_DIFF.high.react}s 內不開火(準星還沒拉到目標上)`);
    }
  }

  log('— sim:擊殺電腦玩家只算 3 分 —');
  {
    const botHero = sim.addHero('STEEL', 'b9', 't06');
    const killer = sim.heroes.get('p_d');
    const kn0 = killer.kn;
    botHero.hp = 0; botHero.sp = 0;
    sim._kill(botHero, killer);
    assert(killer.kn - kn0 === BOT_KILL_SCORE,
      `擊殺 bot 機甲 = ${BOT_KILL_SCORE} 分(真人英雄仍是 ${killScore('robot')} 分)`);
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
    rb.invUntil = 0; rb.iframeCdUntil = 0;   // 清場:不影響後續傷害測試
    // 無人機完美迴避(2026-07-21):請求被接受 → 1s 免傷,CD = DRONE_CD(30s),CD 內再請求被拒
    const dr2 = sim.heroes.get('p_d');
    sim.heroIframe('p_d');
    assert((dr2.invUntil || 0) > sim.t, '無人機完美迴避:請求被接受 → 1s 免傷');
    assert(Math.abs((dr2.iframeCdUntil || 0) - (sim.t + IFRAME.DRONE_CD)) < 1e-6, `無人機完美迴避 CD = ${IFRAME.DRONE_CD}s`);
    const dinv0 = dr2.invUntil;
    sim.heroIframe('p_d');
    assert(dr2.invUntil === dinv0, `無人機 CD ${IFRAME.DRONE_CD}s 內再請求被拒(免傷視窗不重置)`);
    dr2.invUntil = 0; dr2.iframeCdUntil = 0;   // 清場
  }

  log('— sim:雙層 HP(護盾脫戰回復 / 裝甲只能回堡或招式修)+ 電力 —');
  dr.x = sim.basePos.SWARM[0] + 500; dr.z = sim.basePos.SWARM[1];   // 先遠離主堡補血圈
  dr.sp = 0; dr.hp = Math.round(dr.maxHp * 0.6);
  const hpNow = dr.hp;
  dr.lastHitAt = sim.t;
  sim.tick(0.125);
  assert(dr.sp === 0, '戰鬥中(剛受擊)護盾不回復');
  dr.lastHitAt = sim.t - VITALS.OOC_S - 1;
  sim.tick(0.5);
  assert(dr.sp > 0, `脫戰 ${VITALS.OOC_S}s 後護盾自然回復(sp=${Math.round(dr.sp)})`);
  assert(dr.hp === hpNow, '裝甲在主堡補血圈外不回復(只能回堡或治療招式)');
  [dr.x, dr.z] = sim.basePos.SWARM;
  sim.tick(0.5);
  assert(dr.hp > hpNow, '回主堡 → 裝甲開始修復');
  assert(dr.mp < dr.maxMp || dr.mp === dr.maxMp, `電力欄存在(mp=${Math.floor(dr.mp)}/${dr.maxMp})`);

  log('— sim:八軌養成(2026-07-20 面向改制:開場 Lv1、階梯單價隨等級遞增、無擊殺門檻、Lv4 外推)—');
  dr.money = 9999; dr.kn = 0;
  assert(dr.abil.skill === 1 && dr.abil.ult === 1, '招式開場即 Lv1 可用(無需擊殺解鎖)');
  // 輕/重武器為獨立面向:kn=0 也能買(無擊殺門檻)
  assert(sim.buy('p_d', 'lw') === null && dr.abil.light === 2 && dr.abil.heavy === 1,
    '輕武器強化升 Lv.2(只動輕武器,重武器不變)');
  assert(sim.buy('p_d', 'hw') === null && dr.abil.heavy === 2, '重武器強化升 Lv.2(獨立面向)');
  const dmgL2 = heroWeapon('s01', 'light', 2).dmg;
  assert(dmgL2 > heroWeapon('s01', 'light', 1).dmg, `升階後傷害提升(${heroWeapon('s01', 'light', 1).dmg} → ${dmgL2})`);
  assert(sim.buy('p_d', 'sk') === null && dr.abil.skill === 2 && dr.abil.ult === 1,
    '小招強化升 Lv.2(只動小招,大招不變)');
  // Lv4 外推:輕武器買到滿級(upg.lw 1 → 3 ⇒ abil.light = 4),第 4 階數值沿末段成長外推 > Lv3
  sim.buy('p_d', 'lw'); sim.buy('p_d', 'lw');
  assert(dr.abil.light === 4 && heroWeapon('s01', 'light', 4).dmg > heroWeapon('s01', 'light', 3).dmg,
    '輕武器可升到 Lv4(第 4 階外推,傷害 > Lv3)');
  assert(/已滿級/.test(sim.buy('p_d', 'lw') || ''), 'Lv4 後滿級,再買被拒');
  dr.mp = dr.maxMp;
  const A1 = heroAbility('s01', 'skill', dr.abil.skill);
  const mp0 = dr.mp;
  sim.heroCast('p_d', 'skill', dr.x, dr.z);
  assert(dr.acd.skill > sim.t && Math.round(mp0 - dr.mp) === Math.round(A1.mp),
    `施放小招:CD、電力 -${Math.round(A1.mp)}MP(隨招式階級,無精通折減)`);
  const mp1 = dr.mp;
  sim.heroCast('p_d', 'skill', dr.x, dr.z);
  assert(dr.mp === mp1, 'CD 中重複施放被拒(電力未扣)');
  assert(dr.mods.length > 0, '增益類小招掛上 mods(蜂群協奏)');
  const rb2 = sim.addHero('STEEL', 'p_r2', 't05');
  rb2.money = 999;
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
    // 充能:Lv0 回復 = 滿級 × CHARGE_MIN;滿級 = 現役規格(SP_REGEN_PS / mpRegen)
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

  log('— sim:助攻(傷害/負面狀態 = 貢獻;賞金 × 1/4)—');
  {
    const prey = sim._add({ kind: 'tank', side: 'SWARM', x: rb2.x + 22, z: rb2.z, hp: UNITS.tank.hp });
    rb2.ammo = {}; rb2.fireAt = {}; rb2.reloadUntil = {}; rb2.mp = rb2.maxMp;
    sim.t += 1;
    sim.heroHit('p_r2', prey.id);            // rb2 造成傷害 = 助攻貢獻
    assert(prey.asst && prey.asst.p_r2 != null, '傷害貢獻戳記入帳');
    const $a0 = rb2.money;
    sim._damage(prey, 99999, null, 999);     // 補刀者非英雄(如塔)→ 擊殺無賞金,助攻照發
    assert(!sim.ents.has(prey.id), '測試目標已被擊殺');
    assert(rb2.money - $a0 >= Math.floor(ECON.BOUNTY.tank * ECON.ASSIST.F),
      `助攻入帳 +$${Math.round(rb2.money - $a0)}(= 賞金 ${ECON.BOUNTY.tank} × ${ECON.ASSIST.F})`);
    assert(sim.events.some((e) => e.e === 'assist' && e.pid === 'p_r2'), 'assist 事件廣播(HUD 提示)');
    // 招式型範圍 EMP 也是負面狀態 → 記助攻貢獻(與武器附帶 EMP / _applyCC 同規)
    const empc = sim.addHero('SWARM', 'p_e', 's03');
    const mark = sim._add({ kind: 'tank', side: 'STEEL', x: empc.x + 10, z: empc.z, hp: 9999 });
    empc.abil.skill = 1; empc.mp = empc.maxMp;
    sim.heroCast('p_e', 'skill', empc.x, empc.z);
    assert((mark.empUntil || 0) > sim.t && mark.asst && mark.asst.p_e != null,
      '範圍 EMP(負面狀態)寫入助攻貢獻戳記');
    sim.ents.delete(mark.id);
    // 補刀者**也是英雄**的路徑(舊測只驗非英雄補刀):擊殺者拿全額、其餘貢獻者拿 ASSIST.F
    const ally = sim.addHero('STEEL', 'p_al', charsOf('STEEL')[0]);
    const prey2 = sim._add({ kind: 'tank', side: 'SWARM', x: rb2.x + 24, z: rb2.z, hp: UNITS.tank.hp });
    sim.t += 1;
    sim._damage(prey2, 40, rb2);              // rb2 造成傷害 = 助攻貢獻
    const $b0 = rb2.money, $k0 = ally.money;
    sim._damage(prey2, 99999, ally);          // 另一名英雄補刀
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
    const limit = total * sites.at(-1).frac;   // 「第一座砲塔」= 最前線塔(solveTowerSites 回傳序末項)
    const leads = [...new Set(pre.map((e) => e.wv))].sort((a, b) => b - a)
      .map((wv) => Math.max(...pre.filter((e) => e.wv === wv).map((e) => e.prog)));
    assert(Math.max(...leads) <= limit + 1e-6, `預置最前一波 ${Math.max(...leads).toFixed(0)}m ≤ 第一座砲塔 ${limit.toFixed(0)}m`);
    assert(leads.every((p, i) => i === 0 || Math.abs(p - leads[i - 1] - waveSpacingM()) < 1e-6),
      `預置各波沿兵線等距 ${waveSpacingM().toFixed(0)}m(對應出兵間隔)`);
    assert(new Set(pre.map((e) => e.wv)).size === leads.length && !pre.some((e) => e.wv >= 0),
      '預置波序為負(凝聚錨定桶不與開局第一波混同)');
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
    // 同陣營共用:另一名玩家(八軌全滿)接著買同一條兵線 → 疊在同一個等級上
    for (const [k, u] of Object.entries(ECON.UPGRADES)) b.upg[k] = u.max;
    b.money = CREEP_UPG.PRICE;
    assert(cs.buy('p_c2', 'creep', 1) === null && cs.creepUpg.SWARM[1] === 2, '同陣營全玩家共用同一份等級(隊友續購疊加)');
    assert(cs.buy('p_c2', 'creep', 1) !== null, '資金不足被拒(不透支)');
    // 生成當下定案:hp / dmg / armor / 賞金同吃倍率
    cs.creepUpg.SWARM[2] = CREEP_UPG.MAX;
    const mul = creepUpgMul(CREEP_UPG.MAX);
    cs._spawnLaneWave(2, 'SWARM', 7, GAME.WAVE_SPAWN_OFF_M);
    const up = [...cs.ents.values()].find((e) => e.wv === 7 && e.kind === 'tank');
    const plain = cs._add({ kind: 'tank', side: 'STEEL', x: 1e5, z: 1e5, hp: UNITS.tank.hp });
    assert(up.hp === Math.round(UNITS.tank.hp * mul) && Math.abs(up.cu - mul) < 1e-9,
      `LV${CREEP_UPG.MAX} 小兵 hp ${up.hp}(= ${UNITS.tank.hp} × ${mul.toFixed(2)})`);
    assert(Math.abs(cs._bounty(up) - ECON.BOUNTY.tank * mul) < 1e-9 && cs._bounty(plain) === ECON.BOUNTY.tank,
      `陣亡賞金同步 ×${mul.toFixed(2)}(${ECON.BOUNTY.tank} → ${Math.round(cs._bounty(up))});未強化者不變`);
    // 護甲值同吃倍率 ⇒ 同一發傷害打強化兵吃得更少
    const hp0 = up.hp, hp1 = plain.hp;
    cs._damage(up, 100, null, 0); cs._damage(plain, 100, null, 0);
    assert(hp0 - up.hp < hp1 - plain.hp,
      `護甲值同吃倍率(同一發 100 傷害:強化兵扣 ${(hp0 - up.hp).toFixed(1)} < 未強化 ${(hp1 - plain.hp).toFixed(1)})`);
    assert(JSON.stringify(cs.snapshot().cu.SWARM) === JSON.stringify(cs.creepUpg.SWARM), '快照帶陣營小兵強化等級(商店唯讀顯示)');
  }

  log('— sim:非正規路線防空伏擊(需射程內有存活陣地)+ 飛彈可破壞 —');
  const site0 = [...sim.ents.values()].find((e) => e.kind === 'aasite');
  assert(!!site0, '匿蹤防空陣地已生成');
  // 三架一起擺到陣地正上方(走廊外);y=30 避開火場。
  // 僚機若還在沿兵線歸隊就湊不齊「三機齊射」,飛彈打不掉 → 直接放到編隊位置。
  // 全設不死:防塔砲/流彈/伏擊把測試機打下來(只驗伏擊與飛彈可破壞)。
  sq.bodies.forEach((b, i) => {
    b.x = site0.x + i * 8; b.z = site0.z; b.y = 30;
    b.hp = b.maxHp = 99999; b.rg = false;
  });
  let launched = null;
  for (let i = 0; i < 800 && !launched && !dr.dead; i++) {
    sim.tick(0.125);
    launched = sim.missiles.find((m) => m.tid === dr.id);   // 只認主視野那架(僚機也會各自被伏擊)
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

// ================= sim 直測:霧戰爭(單位類實體限視野,建築/中立物永遠可見)=================
log('— sim:霧戰爭(視野外的敵方單位不進快照;瞄準模式加成視野;建築/中立物永遠可見)—');
{
  const sim = new BattleSim(fakeBattleConfig(1));
  const dr = sim.addHero('SWARM', 'p_fow');
  dr.x = 0; dr.z = 0; dr.y = 0;
  const sightBase = UNITS[dr.kind].sight;                    // 隨機角色機體(drone/robot 傭兵)視野基準,測試不寫死
  const nearSight = sightBase * 0.5;                         // 明確在視野內
  const farOut = sightBase * 1.5;                            // 明確在視野外(未瞄準)
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

  // 塔 / 主堡 / 中立物:不算「單位」,永遠可見(即使在視野外)
  const farTower = [...sim.ents.values()].find((e) => e.kind === 'tower' && e.side === 'STEEL');
  const farBase = [...sim.ents.values()].find((e) => e.kind === 'base' && e.side === 'STEEL');
  const neutral = [...sim.ents.values()].find((e) => e.neutral);
  assert(ids.has(farTower.id) && ids.has(farBase.id), '敵方塔/主堡不受霧戰爭影響,永遠可見');
  assert(!neutral || ids.has(neutral.id), '中立實體(障礙/防空陣地)不受霧戰爭影響');

  // 瞄準模式:視野加成應能看到原本在視野外的敵方小兵
  const aimTarget = sim._add({ kind: 'soldier', side: 'STEEL', x: sightBase * 1.3, z: 0, hp: UNITS.soldier.hp });
  let idsNoAim = new Set(sim.snapshotFor('SWARM').ents.map((e) => e.id));
  assert(!idsNoAim.has(aimTarget.id), '瞄準前:1.3 倍視野外看不到');
  dr.aiming = true;
  let idsAim = new Set(sim.snapshotFor('SWARM').ents.map((e) => e.id));
  assert(idsAim.has(aimTarget.id), `瞄準模式視野加成(×${GAME.AIM_SIGHT_MULT})後看得到`);

  // 觀戰者(side=null)無霧,看得到所有東西
  const specIds = new Set(sim.snapshotFor(null).ents.map((e) => e.id));
  assert(specIds.has(far.id) && specIds.has(enemyHero.id), '觀戰者(無側別)收到無霧全局快照');
}

// ================= sim 直測:危險區(Diablo 式隨機生成)=================
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

  // 擊毀防空陣地:賞金 + die 事件 + 從快照消失
  const rb = sim.addHero('STEEL', 'hz_r');
  const site = sites[0];
  rb.x = site.x + 10; rb.z = site.z;
  const $0 = rb.money;
  for (let i = 0; i < 40 && sim.ents.has(site.id); i++) { sim.t += 0.3; sim.heroHit('hz_r', site.id); }
  assert(!sim.ents.has(site.id), '防空陣地被機槍拆除(= 打出安全空域)');
  assert(rb.money - $0 >= ECON.BOUNTY.aasite, `拆陣地賞金 +$${ECON.BOUNTY.aasite}`);
  assert(sim.events.some((e) => e.e === 'die' && e.kind === 'aasite'), 'die 事件帶 aasite(客戶端播報)');

  // 不可摧毀障礙(塌陷/坍方/火場/淹水)打不掉
  const inv = haz.find((h) => h.inv);
  if (inv) {
    sim.t += 1;
    sim.heroHit('hz_r', inv.id);
    assert(sim.ents.has(inv.id) && inv.hp === inv.maxHp, `不可摧毀障礙(${HAZARDS[inv.kind].name})免疫傷害`);
  }

  // 可擊毀障礙 → 掉落隨機物資 → 靠近拾取
  sim.loots = [];
  sim._spawnLoot(rb.x + 3, rb.z);
  const loot = sim.loots[0];
  const isAmmo = !!loot.ammo, isAffix = !!loot.af;
  const $1 = rb.money;
  rb.ammo.light = 5;                       // 造一個「半彈夾」狀態驗證補彈
  rb.x = loot.x; rb.z = loot.z; rb.y = 0;
  sim.tick(0.05);
  assert(sim.loots.length === 0, `戰場物資被拾取(${isAmmo ? '彈藥補給' : isAffix ? '詞綴強化' : '現金'})`);
  if (isAmmo) assert(rb.ammo.light == null, '彈藥補給清空計數 = 下次開火滿彈夾');
  else if (isAffix) assert(rb.buffs[loot.af] > sim.t, `詞綴強化生效(${AFFIXES[loot.af].name})`);
  else assert(rb.money > $1, `現金物資入帳 +$${Math.round(rb.money - $1)}`);
  assert(sim.events.some((e) => e.e === 'loot' && e.pid === 'hz_r'), 'loot 事件帶 pid');

  // 火場 DoT(確定性):低空/地面才吃,依 maxSp:maxHp 比例同扣護盾/HP(HP 份不吃裝甲),高空免疫。
  // 直接泵 hazard 子系統固定次數(不走整支 sim.tick)⇒ 不受波次/bot/回血/敵火汙染;總傷恰為 dot×時距。
  // 歷來 flaky 真因非 CI tick 節奏:稍早拾取的隨機詞綴若擲中 hardened(dmgTaken 0.75)會把灼傷縮到 22.5 ⇒
  // 清掉 buffs/mods 隔離之,並補滿雙池(無見底夾制)使 split 精確可驗。
  const fire = sim._add({ kind: 'fire', side: null, neutral: true, haz: true, inv: true, x: rb.x + 300, z: rb.z + 300, sc: 1, hp: 1 });
  sim._fires.push(fire);
  rb.buffs = {}; rb.mods = [];                          // 隔離 loot 詞綴(dmgTaken)對灼傷的縮放
  rb.sp = rb.maxSp; rb.hp = rb.maxHp;                   // 補滿雙池 ⇒ 無 Math.max(0,…) 夾制,兩份精確
  rb.x = fire.x; rb.z = fire.z; rb.y = 0;               // 站進火場、貼地(y=0 ⇒ 不觸 offGround/maxY 豁免)
  const spF = rb.sp, hpF = rb.hp, denom = rb.maxSp + rb.maxHp;
  const BURN_DT = 0.125, BURN_N = 8;                    // 8 × 0.125 = 1 秒
  const burnTot = HAZARDS.fire.dot * BURN_DT * BURN_N;  // = dot(每秒灼傷)
  for (let i = 0; i < BURN_N; i++) sim._tickHazards(BURN_DT);
  const spDrop = spF - rb.sp, hpDrop = hpF - rb.hp;
  assert(Math.abs((spDrop + hpDrop) - burnTot) < 1e-6, `火場灼傷 ${Math.round(spDrop + hpDrop)}/秒(確定性總傷 = dot×時距)`);
  assert(Math.abs(spDrop - burnTot * rb.maxSp / denom) < 1e-6, '灼傷護盾份 = 依 maxSp 比例(同扣護盾)');
  assert(Math.abs(hpDrop - burnTot * rb.maxHp / denom) < 1e-6, 'HP 份 = 依 maxHp 比例(不吃裝甲)');
  // 高空免疫灼傷(先拔光防空陣地 + 敵方塔/主堡:塔射程 310 已能打到火場座標,
  // 留著會讓「高空不受灼傷」的血量斷言被塔砲/SAM 汙染)
  // (2026-07-12:塔射程 310 + 小兵強化後,火場座標已落在敵方火網內 → 只留火場,其餘敵方單位全清)
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

// ================= sim 直測:Diablo 進階(TreasureClass / 詞綴 / 中繼站 / 連通性)=================
log('— sim:TreasureClass 分層 + 詞綴強化 + 偵察中繼站 + 連通性保證 —');
{
  const sim = new BattleSim(fakeBattleConfig(2));

  // TreasureClass:tc=1(最硬障礙)比 tc=0 更常擲出稀有階(彈藥/詞綴)
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

  // 詞綴(伺服器結算):淬火軍械縮短填彈、複合裝甲減傷、快照帶 bf 倒數
  const rb = sim.addHero('STEEL', 'af_r', 't01');
  const wl2 = heroWeapon('t01', 'light', 1);
  rb.buffs.tempered = sim.t + 999;
  rb.ammo.light = 5;
  sim.heroReload('af_r', 'light');
  const rl = rb.reloadUntil.light - sim.t;
  assert(Math.abs(rl - wl2.reload * AFFIXES.tempered.reload) < 1e-6,
    `淬火軍械:填彈 ${rl.toFixed(2)}s(${wl2.reload}s × ${AFFIXES.tempered.reload})`);
  rb.buffs.hardened = sim.t + 999;
  rb.sp = 0;   // 清空護盾,直接驗裝甲層公式
  const hp0 = rb.hp;
  sim._damage(rb, 100, null);
  const expArmor = 100 * AFFIXES.hardened.dmgTaken * armorMul(rb.armor);
  assert(Math.abs((hp0 - rb.hp) - expArmor) < 0.5,
    `複合裝甲 × 護甲值:100 傷害實吃 ${(hp0 - rb.hp).toFixed(1)}(減傷 ${AFFIXES.hardened.dmgTaken} × 護甲 ${rb.armor})`);
  assert(sim.snapshotFor('STEEL').ents.find((e) => e.pid === 'af_r').bf?.length === 2, '快照帶詞綴倒數(bf)');

  // 偵察中繼站:每線 1 座、走廊之外(要冒險才吃得到)、佔用 → 視野脈衝 → 用過即毀
  const relays = [...sim.ents.values()].filter((e) => e.kind === 'relay');
  assert(relays.length === sim.lanes.length, `中繼站 ${relays.length} 座(${FIELD.RELAY.PER_LANE}/線)`);
  assert(relays.every((r) => sim._distToLanes(r.x, r.z) >= FIELD.RELAY.laneMin), '中繼站在兵線走廊之外');
  for (const s of [...sim.ents.values()]) if (s.kind === 'aasite') sim.ents.delete(s.id);   // 排除伏擊干擾
  const dr = sim.addHero('SWARM', 'rl_d');
  dr.x = relays[0].x; dr.z = relays[0].z; dr.y = 0;
  dr.hp = 99999;   // 中繼站落在射程 310 的塔火內:同防空伏擊測試,墊高 hp 防塔擊落(否則佔領被打斷 = flaky)
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
  sim.ents.delete(far.id);   // 測試假人無 lane,清掉避免後續 tick 炸

  // 連通性保證(flood-fill):自然生成本就互通;人工橫斷牆會被偵測並拆出缺口
  const nb0 = sim.hazBlockers.length;
  sim._ensureConnectivity();
  assert(sim.hazBlockers.length === nb0, '連通性檢查:走廊淨空保證兩堡互通,無需拆牆');
  const midZ = (sim.basePos.SWARM[1] + sim.basePos.STEEL[1]) / 2;
  for (let x = -1600; x <= 1600; x += 18) sim.hazBlockers.push([x, midZ, 12]);
  const nb1 = sim.hazBlockers.length;
  sim._ensureConnectivity();
  assert(sim.hazBlockers.length < nb1, `人工橫斷牆被偵測,拆 ${nb1 - sim.hazBlockers.length} 段開出缺口`);
}

// ================= sim 直測:第三方軍隊(游擊隊 / 武裝民兵)=================
log('— sim:第三方軍隊(佈營淨空 / 迷霧隱藏 / 碉堡駐守 / 繫繩 / 重生暫停)—');
{
  const sim = new BattleSim(fakeBattleConfig(2));
  const camps = sim.camps || [];
  assert(camps.length > 0 && camps.length <= sim.lanes.length * 2,
    `野營 ${camps.length} 團(上限 = 兵線數 × 2;塞不下的團寧缺勿錯)`);
  const bunkers = [...sim.ents.values()].filter((e) => e.kind === 'bunker');
  assert(bunkers.length === camps.length, '每團一座碉堡');
  assert(UNITS.bunker.hp === Math.round(UNITS.tower.hp / 2), `碉堡 HP = 砲塔一半(${UNITS.bunker.hp})`);
  // 佈營硬約束:離雙方每座砲塔 / 主堡 ≥ 工事射程 × 1.5,且遠離兵線走廊
  const towers = [...sim.ents.values()].filter((e) => e.kind === 'tower');
  const rT = UNITS.tower.range * THIRD.CLEAR_F;
  const rB = Math.max(UNITS.base.range, UNITS.base.guns.range) * THIRD.CLEAR_F;
  assert(camps.every((c) => towers.every((t) => Math.hypot(c.x - t.x, c.z - t.z) >= rT)),
    `野營離所有砲塔 ≥ 塔射程 × ${THIRD.CLEAR_F}(${rT}m)`);
  assert(camps.every((c) => Object.values(sim.basePos).every(([bx, bz]) => Math.hypot(c.x - bx, c.z - bz) >= rB)),
    `野營離兩主堡 ≥ 主堡射程 × ${THIRD.CLEAR_F}(${rB}m)`);
  assert(camps.every((c) => sim._distToLanes(c.x, c.z) >= THIRD.LANE_MIN),
    `野營離兵線走廊 ≥ ${THIRD.LANE_MIN}m(> NPC 最大射程:不掃兵線)`);
  // 編制:游擊隊 = 3 步槍 + 火箭 + 坦克;武裝民兵 = 3 步槍 + 榴彈 + 直升機
  const campEnts = (ci) => [...sim.ents.values()].filter((e) => e.tp && e.ci === ci && e.kind !== 'bunker');
  const kindsOf = (ci) => campEnts(ci).map((e) => e.kind).sort().join(',');
  const gi = camps.findIndex((c) => c.type === 'GUER');
  const mi = camps.findIndex((c) => c.type === 'MILI');
  if (gi >= 0) assert(kindsOf(gi) === [...THIRD.COMP.GUER].sort().join(','), `游擊隊編制(${kindsOf(gi)})`);
  if (mi >= 0) assert(kindsOf(mi) === [...THIRD.COMP.MILI].sort().join(','), `武裝民兵編制(${kindsOf(mi)})`);
  // 開戰時全數藏在戰爭迷霧(單位走一般迷霧規則、碉堡非塔/堡);觀戰無霧看得到
  const ids0 = new Set(sim.snapshotFor('SWARM').ents.map((e) => e.id));
  assert(campEnts(0).every((e) => !ids0.has(e.id)) && !ids0.has(camps[0].bunker.id),
    '第三方單位與碉堡開戰時藏在戰爭迷霧');
  assert(sim.snapshotFor(null).ents.some((e) => e.k === 'bunker'), '觀戰(無霧)快照帶碉堡');
  // 駐守:半血步槍兵進碉堡 → 免傷 + 不可被命中 + 緩慢回血;回滿自動出堡
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
  // 繫繩:離碉堡超過 TETHER_M → 馬上撤回(移動朝碉堡收斂)
  sold.x = c0.x + THIRD.TETHER_M + 30; sold.z = c0.z;
  sim._tpBehave(sold, 0.125);
  assert(sold.ret === 1, `離碉堡 > ${THIRD.TETHER_M}m → 馬上撤回`);
  const dx0 = Math.abs(sold.x - c0.x);
  sim._tpMove(sold, UNITS.soldier, 0.5);
  assert(Math.abs(sold.x - c0.x) < dx0, '撤回中朝碉堡移動');
  // 交戰得賞金 + 陣亡進 60s 重生池
  const $0 = rb.money;
  const prey = campEnts(0).find((e) => e.kind !== 'soldier');
  prey.hp = 1;
  sim.t += 1;
  sim.heroHit('tp_r', prey.id);
  assert(!sim.ents.has(prey.id), '第三方單位可被擊殺');
  assert(rb.money - $0 >= ECON.BOUNTY[prey.kind], `交戰得賞金 +$${Math.round(rb.money - $0)}`);
  assert(c0.pool.length === 1 && c0.pool[0].rem === THIRD.UNIT_RESPAWN_S,
    `陣亡單位進 ${THIRD.UNIT_RESPAWN_S}s 重生池`);
  // 碉堡被拆 → 180s 原地重生;期間單位重生「暫停倒數」
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

// ================= 單機機制:瀏覽器內 RoomHub 迴路(不經 WebSocket)=================
// 單機版(GitHub Pages 靜態站台)= 瀏覽器直接 new 同一支 RoomHub,傳輸層換成同分頁的函式呼叫。
// 這一段用完全相同的方式跑完整局:開房 → 選陣營 → 準備 → 開戰 → 收快照 → 收攤。
// 這裡跑得通 ⇒ 單機特化版跑得通(客戶端只是把 `send` 接到 `sess.recv`,見 public/js/localhost.js)。
log('\n— 單機機制:瀏覽器內 RoomHub 迴路 —');
{
  const hub = new RoomHub({ urls: () => [], log: () => {}, dropMs: 0 });
  const inbox = [];
  const sess = hub.attach((m) => inbox.push(m));
  const last = (t) => [...inbox].reverse().find((m) => m.t === t);
  const snapCount = () => inbox.filter((m) => m.t === 'snap').length;

  // 驗證與伺服器同標準(單機不是「免驗證」的旁路)
  sess.recv({ t: 'createRoom', name: '單機指揮官', teamSize: 1, battleConfig: fakeBattleConfig(3) });
  assert(/兵線/.test(last('error')?.msg || ''), '單機:兵線數不符同樣被拒絕(與伺服器同一支驗證)');

  sess.recv({ t: 'createRoom', name: '單機指揮官', roomName: '離線演習', teamSize: 1, battleConfig: fakeBattleConfig(1) });
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

  // 收攤:MUST 停掉 8Hz tick —— 玩家切回連線模式後若還在跑,就是背景空轉吃電
  hub.shutdown();
  const n = snapCount();
  await new Promise((r) => setTimeout(r, 400));
  assert(snapCount() === n, '單機:shutdown 後 tick 完全停止(不留背景迴圈)');
  assert(hub.stats().rooms === 0, '單機:shutdown 後房間清空');
}

// ================= 無真人玩家逾時:直接結束該場遊戲 =================
// 對局中全部真人(玩家+觀戰)都斷線超過 noHumanMs → 收掉對局並清房(bot 對打沒人看是純空轉);
// 期限內回連(reattach)則計時歸零、對局照常。正式伺服器 noHumanMs 預設 60 秒,這裡縮短快速驗證。
log('\n— 對局中無真人玩家逾時 —');
{
  const hub = new RoomHub({ urls: () => [], log: () => {}, dropMs: 60 * 1000, noHumanMs: 400 });
  const inbox = [];
  const sess = hub.attach((m) => inbox.push(m));
  const last = (t) => [...inbox].reverse().find((m) => m.t === t);
  sess.recv({ t: 'createRoom', name: '獨守指揮官', roomName: '空城計', teamSize: 1, battleConfig: fakeBattleConfig(1) });
  sess.recv({ t: 'pickSide', side: 'SWARM' });
  sess.recv({ t: 'setReady', ready: true });
  sess.recv({ t: 'startBattle' });
  sess.recv({ t: 'loaded' });
  await new Promise((r) => setTimeout(r, 300));
  assert(hub.stats().battles === 1, '前置:對局開打(1 真人 + 補滿電腦)');
  const token = last('sync').token;

  // 斷線後在期限內回連:座位還在(dropMs 保留)、無真人計時歸零,對局照常
  sess.close();
  await new Promise((r) => setTimeout(r, 200));
  const inbox2 = [];
  const sess2 = hub.attach((m) => inbox2.push(m));
  sess2.recv({ t: 'reattach', token });
  await new Promise((r) => setTimeout(r, 500));   // 已超過 noHumanMs:有真人回連就不得收房
  assert(hub.stats().battles === 1, '期限內回連:對局保留(無真人計時歸零)');
  assert(inbox2.some((m) => m.t === 'sync'), '回連認回原座位(補收 sync)');
  assert(inbox2.some((m) => m.t === 'battleConfig'), '回連補收 battleConfig(客戶端據此重建地形)');
  assert(inbox2.some((m) => m.t === 'snap'), '回連後 8Hz 快照恢復送達');

  // 全部真人離線超過 noHumanMs:直接結束該場遊戲並清房(座位 token 隨房失效)
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

// ================= 回連身分:reattach 後 MUST 沿用原座位鍵 =================
// 座位在 room.clients 的鍵、英雄在 sim.heroes 的 pid、hostId 的比對對象,全是「建立座位那條 session」
// 的 clientId。reattach 若沿用新連線自己的 clientId:pos/開火被 sim 靜默丟棄(查無英雄)、房主權限失效、
// leaveRoom/清位刪錯鍵 → 座位永遠留著 = 殭屍房間(首頁一直看得到進行中的無人 bot 對局)。
log('\n— 回連身分(reattach 沿用原座位鍵)—');
{
  const mkBattle = async () => {
    const inbox = [];
    const hub = new RoomHub({ urls: () => [], log: () => {}, dropMs: 60 * 1000, noHumanMs: 400 });
    const sess = hub.attach((m) => inbox.push(m));
    sess.recv({ t: 'createRoom', name: '回連者', roomName: '回連測試', teamSize: 1, battleConfig: fakeBattleConfig(1) });
    sess.recv({ t: 'pickSide', side: 'SWARM' });
    sess.recv({ t: 'setReady', ready: true });
    sess.recv({ t: 'startBattle' });
    sess.recv({ t: 'loaded' });
    await new Promise((r) => setTimeout(r, 250));
    const token = [...inbox].reverse().find((m) => m.t === 'sync').token;
    return { hub, sess, token };
  };
  // ① 英雄操控 + ② 房主權限(斷線 → 新連線 reattach)
  {
    const { hub, sess, token } = await mkBattle();
    const room = [...hub.rooms.values()][0];
    const hero = room.battle.heroes.get(sess.id);
    sess.close();
    const sess2 = hub.attach(() => {});
    sess2.recv({ t: 'reattach', token });
    sess2.recv({ t: 'pos', x: 777, y: 0, z: 888, ry: 0 });
    assert(hero.x === 777 && hero.z === 888, '回連後 pos 回報操控原英雄(座位鍵 = 原 clientId,非新連線的)');
    sess2.recv({ t: 'backToRoom' });
    assert(room.phase === 'room', '回連後房主權限仍在(backToRoom 生效)');
    hub.shutdown();
  }
  // ③ 殭屍舊 socket 晚到的 close 不得奪走座位(伺服器心跳 terminate / OS TCP 逾時都會走到這條路)
  {
    const { hub, sess, token } = await mkBattle();
    const sess2 = hub.attach(() => {});
    sess2.recv({ t: 'reattach', token });   // 舊 socket 未 close 就先回連(手機收後台 → 回前台的常態)
    sess.close();                           // 殭屍連線此刻才死
    await new Promise((r) => setTimeout(r, 700));
    assert(hub.stats().battles === 1, '殭屍舊 socket 晚到 close:座位不受影響、對局不被無真人逾時誤收');
    hub.shutdown();
  }
  // ④ 回連後 leaveRoom 真的離座清房(刪對鍵,不留殭屍房)
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

// ================= WebSocket 端對端 =================
log('— 開房驗證(地圖必須先建立)—');
const host = await client('host');
host.send({ t: 'createRoom', name: '蜂群女王', roomName: '沒有地圖', teamSize: 1 });
await host.wait((c) => c.msgs.find((m) => m.t === 'error' && /不完整/.test(m.msg)));
assert(true, '缺 battleConfig 開房被拒絕');

const wrongLanes = fakeBattleConfig(3);
host.send({ t: 'createRoom', name: '蜂群女王', roomName: '線數錯', teamSize: 1, battleConfig: wrongLanes });
await host.wait((c) => c.msgs.find((m) => m.t === 'error' && /兵線/.test(m.msg)));
assert(true, '兵線數與隊伍規模不符被拒絕(1v1 要 1 線)');

const tooShort = fakeBattleConfig(1);
tooShort.distM = tooShort.diagM * 0.5;
host.send({ t: 'createRoom', name: '蜂群女王', roomName: '太近', teamSize: 1, battleConfig: tooShort });
await host.wait((c) => c.msgs.find((m) => m.t === 'error' && /80%/.test(m.msg)));
assert(true, '主堡距離未達對角線 80% 被拒絕');

log('— 建立房間(1v1,開房即帶地圖與環境)—');
host.send({ t: 'createRoom', name: '蜂群女王', roomName: '測試戰區', isPublic: true, teamSize: 1, battleConfig: fakeBattleConfig(1) });
await host.wait((c) => c.sync);
const pin = host.sync.lobby.pin;
assert(/^\d{4}$/.test(pin), `取得 PIN:${pin}`);
assert(host.sync.isHost === true, '建房者是房主');
const lockedCfg = host.sync.lobby.battleConfig;
assert(lockedCfg && lockedCfg.lanes.length === 1, '房間已鎖定 1 條兵線的地圖');
assert(['spring', 'summer', 'autumn', 'winter'].includes(lockedCfg.env?.season), `環境已定案(${lockedCfg.env?.season}/${lockedCfg.env?.time}/${lockedCfg.env?.weather})`);

// 霧戰爭:觀戰者收無霧全局快照,後面凡是要「發現」敵方單位(host 視野外)都改讀這份
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

log('— 選角(角色綁陣營;不選 = 開戰隨機)—');
host.send({ t: 'pickChar', ch: 't01' });   // 蜂群玩家選鋼鐵角色 → 拒絕
await host.wait((c) => c.msgs.find((m) => m.t === 'error' && /陣營不符/.test(m.msg)));
assert(true, '選敵陣營角色被拒絕');
host.send({ t: 'pickChar', ch: 's02' });   // 鐵匠(重武器溫壓火箭:反建築,後面拆堡用)
await host.wait((c) => c.sync.lobby.clients.find((x) => x.id === c.sync.youId)?.ch === 's02');
assert(true, `host 選角「${CHARACTERS.s02.code}」(lobby 同步)`);
guest.send({ t: 'pickChar', ch: 't04' });
await guest.wait((c) => c.sync.lobby.clients.find((x) => x.id === c.sync.youId)?.ch === 't04');
assert(true, `guest 選角「${CHARACTERS.t04.code}」`);

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
assert(towers.length === 8, `防禦塔 ×8(1 線 × 2 塔位 × 左右 2 座 × 2 方;實際 ${towers.length})`);
assert(heroes.length === 2, `英雄 ×2(主視野機;${heroes.map((h) => h.k).join(',')})`);
assert(specSnap.ents.filter((e) => e.k === 'drone').length === 1,
  '無人機玩家在場 1 架機體(單機)');
const myHero = snap.ents.find((h) => h.pid === host.sync.youId && h.act);
assert(myHero && myHero.k === 'drone', `英雄快照帶 pid,能認出自己的座機(pid=${myHero?.pid})`);
assert(typeof myHero.$ === 'number' && myHero.ab && typeof myHero.kn === 'number',
  `英雄快照帶金錢/招式階級/擊殺數($${myHero.$}・ab=${JSON.stringify(myHero.ab)})`);
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

log('— 無人機自殺攻擊機(F 鍵:前方左右各一;主機不自爆;CD 內再按無效)—');
const droneDies = () => host.snaps.flatMap((s) => s.ev || []).filter((e) => e.e === 'die' && e.kind === 'drone').length;
const dies0 = droneDies();
// 移到高空(250 > SAM 240)避免被塔擊落干擾,再按 F 釋放自殺攻擊機
const foeTower = spec.snaps.at(-1).ents.find((e) => e.k === 'tower' && e.s === 'STEEL');
host.send({ t: 'pos', x: foeTower.x, y: HI_ALT, z: foeTower.z, ry: 0 });
await new Promise((r) => setTimeout(r, 250));
// 累計不同 id(自殺機撲擊敵塔 → 會邊飛邊死,任一瞬間的快照未必同時看到兩架 → 用累計 id 才穩)
const kamiIds = () => { const s = new Set();
  for (const snp of spec.snaps) for (const e of snp.ents) if (e.k === 'kami' && e.pid === host.sync.youId) s.add(e.id);
  return s; };
// WS 端只驗「F → 伺服器 → 快照」這條路走通(冒出自殺機);確切 2 架/HP/吸彈/引爆走上方 sim 直測。
// (自殺機一冒出就撲向敵塔並被塔火集火 → 任一瞬間快照未必同時看到兩架,故只驗 ≥1)
host.send({ t: 'kami' });
await host.wait(() => kamiIds().size >= 1, 3000);
assert(kamiIds().size >= 1, `F 經網路生成自殺攻擊機(累計不同 id ${kamiIds().size};確切數量見 sim 直測)`);
assert(droneDies() === dies0, '主機不再自爆(F 不會炸掉自己)');
const idsAfterFirst = kamiIds().size;
host.send({ t: 'kami' });   // CD 內再按:不應再生成一批
await new Promise((r) => setTimeout(r, 300));
assert(kamiIds().size === idsAfterFirst, 'CD 內再按 F 不會再多一批自殺攻擊機');

log('— 俯衝進兵線 → 被擊殺 → 重生 —');
host.send({ t: 'pos', x: target.x, y: 5, z: target.z, ry: 0 });
const mine = (c) => c.snaps.at(-1).ents.filter((e) => e.pid === host.sync.youId);
const deadSnap = await host.wait((c) => (mine(c).some((e) => e.dead) ? c.snaps.at(-1) : null), 30000);
const downed = deadSnap.ents.filter((e) => e.pid === host.sync.youId && e.dead);
assert(true, `無人機硬闖兵線被擊落 ${downed.length} 架(重生倒數 ${downed[0].rs}s)`);
await host.wait((c) => mine(c).length > 0 && mine(c).every((e) => !e.dead), 40000);
assert(true, '全機重生成功(回到主堡)');

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
  return me && me.$ >= ECON.UPG_BASE ? me : null;   // 首級階梯價 = UPG_BASE;START 200 ≥ 之,必然足夠
}, 30000);
assert(richSnap.$ >= ECON.UPG_BASE, `開局資金 + 擊殺賞金累積 $${richSnap.$}(無被動收入)`);
host.send({ t: 'buy', item: 'hw' });
await host.wait((c) => (meOf(c)?.up?.hw || 0) >= 1, 5000);
clearInterval(homeIv);
assert(true, '重武器強化 Lv.1(快照 up 同步)');

log('— 勝負(重武器溫壓火箭高空拆堡:反建築 ×2.0 + 破甲)—');
const steelBase = snap.ents.find((e) => e.k === 'base' && e.s === 'STEEL');
const t0 = Date.now();
const iv = setInterval(() => {
  host.send({ t: 'pos', x: steelBase.x, y: HI_ALT, z: steelBase.z, ry: 0 });
  host.send({ t: 'aim', on: true });   // 重武器需瞄準模式(死亡重生會被重置,循環內重送)
  host.send({ t: 'burst', x: steelBase.x, z: steelBase.z });
}, 300);
const overSnap = await host.wait((c) => c.snaps.at(-1).over ? c.snaps.at(-1) : null, 240000);
clearInterval(iv);
assert(overSnap.winner === 'SWARM', `蜂群獲勝(${((Date.now() - t0) / 1000).toFixed(0)}s 拆完主堡)`);

log('— 回房再戰:地圖保留 —');
host.send({ t: 'backToRoom' });
await host.wait((c) => c.sync.lobby.phase === 'room');
assert(host.sync.lobby.battleConfig?.placeName === '測試戰區', '返回房間後地圖仍鎖定(不需重選)');

log('— 5v5 房:同陣營多席 + 3 線 —');
const h5 = await client('h5');
h5.send({ t: 'createRoom', name: '五五開', roomName: '大戰場', isPublic: true, teamSize: 5, battleConfig: fakeBattleConfig(3) });
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
assert(towers5.length === 24, `3 線 → 防禦塔 ×24(實際 ${towers5.length})`);
h5.ws.close(); g5.ws.close();

log('— 電腦玩家(單人 + AI 對手)—');
const hb = await client('hb');
hb.send({ t: 'createRoom', name: '獨行俠', roomName: 'BOT房', isPublic: false, teamSize: 2, battleConfig: fakeBattleConfig(1) });
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
const bp0 = { x: botHero.x, z: botHero.z };
await new Promise((r) => setTimeout(r, 3500));
const botHero2 = hbSpec.snaps.at(-1).ents.find((e) => e.pid === botHero.pid && e.act);
const movedM = botHero2 ? Math.hypot(botHero2.x - bp0.x, botHero2.z - bp0.z) : 999;
assert(movedM > 10, `bot 沿兵線推進(3.5 秒移動 ${movedM.toFixed(0)}m)`);
hb.ws.close(); hbSpec.ws.close();

log(failed ? '\n❌ 有測試失敗' : '\n🎉 全部通過');
host.ws.close(); guest2.ws.close(); spec.ws.close();
process.exit(failed ? 1 : 0);
