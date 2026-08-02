// ============ 前線交戰模擬器(offline,純 Node,無依賴)============
// 2026-08-02 使用者定案的模擬方式:
//   「平衡性模擬器修改測試方式:須同時考量射程/速度/攻擊/範圍/兵波/砲塔等等,簡易模擬環境只有
//     前線雙砲塔 + 兵波NPC(生成頻率同正式遊戲),模擬從雙方射程外開始接敵,有錢就升級,
//     先擊毀敵方機體或一座砲塔者獲勝,模擬器在確保模擬準確度前提下測試時間越短越好。」
//
// 與既有模型的分工(**MUST NOT** 把兩者合併成一支):
//   `tools/duel.mjs`  1v1 純武器對進戰 + 高度差掃描 —— 快速前置篩,量的是「兩把武器誰硬」。
//                     刻意**沒有**兵波/砲塔/經濟/範圍,所以它對「攻擊範圍」這一軸完全無感。
//   `tools/lanesim.mjs`(本檔)前線交戰 —— 量的是「這台機體在**真的兵線上**打不打得贏」:
//                     射程 / 移速 / 火力 / **攻擊範圍** / 兵波 / 砲塔 / 經濟七軸同時作用。
//                     這是「攻擊範圍」唯一會被計價的模型(bal ①④⑤ 全是單體模型,爆風半徑
//                     在那裡從來沒有進過算式)⇒ 改 AoE 半徑 / AREA_WEAPONS / AOE_BUDGET
//                     MUST 以本檔的 ⑦ 為準,MUST NOT 拿 ⑤ 的結果代替。
//
// ---- 場景(全部由 data.js 推導,MUST NOT 手寫任何距離/秒數)----
// 座標:x = 兵線軸(SWARM 在 −x、STEEL 在 +x),y = 橫向偏移。中線 x = 0。
//   ・前線雙砲塔:各方塔位在 x = ∓SEP/2(SEP = tower.range × GAME.TOWER_SEP_F,= ② 的塔距
//     不變式),每個塔位左右各一座塔於 y = ±GAME.TOWER_SIDE_OFF —— 「同塔位雙塔」與 ④ 同一組幾何。
//   ・兵波:每 waveInterval() 秒自各方塔位推出一波 waveComp() 編制(**生成頻率同正式遊戲**),
//     沿 x 前進;同波成員的縱深散布 = GAME.WAVE_COHESION_M、橫向散布 = ±LANE.LAT_M
//     (橫向散布是「範圍武器一次掃到幾個」的關鍵 ⇒ MUST NOT 收成一維隊列,那會讓扇形/爆風
//      在模型裡變成「一發全中」)。
//   ・機體:雙方各一台,自「雙方最長有效射程 × START_F」的間距開始接敵(開場都打不到)。
//   ・經濟:開場 ECON.START,擊殺照 ECON.BOUNTY 入帳,**有錢就升級**(貪心買最便宜的一階,
//     與 game.js `_sweepPick` 同一條規則)。
//   ・勝負:先擊毀「敵方機體」或「敵方任一座前線砲塔」者獲勝;逾時以戰果比分判(見 outcome())。
//
// ---- 攻擊範圍怎麼算(使用者「考量實質戰鬥角度」)----
// 三類範圍攻擊各按自己的幾何在 2D 平面上選目標,分類縫仍是 data.js aoeClass():
//   blast 圓形超壓:爆心 r × BLAST.EDGE 內全員,逐一吃 blastFalloff(量到命中量體最近點)。
//   fan   錐形:半角 arc 的錐內全員,吃 fanFalloff(越近越強)——**錐寬隨距離張開、傷害隨距離
//         衰減**,兩者同時作用才是扇形武器的真實形狀(貼身掃不到幾個、拉遠掃得到卻不痛)。
//   line  圓柱貫穿:半徑 lanceR + hitR 的圓柱內,依序吃 LANCE.DECAY,最多 LANCE.MAX 個。
// 偏心遞減走 offAxisFalloff(fan/line),與 sim.heroPlasma / _lanceHits 同一條曲線。
//
// ---- 與 server/sim.js 的對齊 ----
// 傷害鏈逐項對齊 sim.heroHit/_blast:dmgFalloff → vsMult → 爆擊期望 → 閃避期望 → shieldSplit
// 雙層拆分 → 裝甲層吃 armorMul。差別只有「擲骰改期望值」(稽核要確定性,見全域 A4)。
import {
  CHARACTERS, UNITS, GAME, ECON, VITALS, EVASION, BLAST, LANCE, AOE_EDGE,
  BOT_TACTIC, armorMul, vsMult, heroWeapon, charKind, heroArmor, heroMobility, chargeF,
  dmgFalloff, fanFalloff, blastFalloff, offAxisFalloff, blastFootprintR, aoeClass,
  shieldSplit, heavyMpCost, upgradePrice, waveComp, waveMarchSpeed, hitR, hitH, lanceR,
} from '../public/js/data.js';
import { waveInterval } from '../server/sim.js';

export const LANE = {
  // 步進(秒)= **伺服器 tick**(GAME.TICK_MS,8Hz)。推導不手寫,而且是真的「一個伺服器格」。
  // 收斂實測(2026-08-02,全 32 角矩陣的三機種平均):
  //   dt 0.05 → 60.1/46.8/39.7(29.6s)  0.10 → 60.6/47.0/38.5(15.2s)
  //   dt 0.125(現值)                    0.15 → 60.8/46.2/39.5(10.7s)  0.20 → 60.2/47.4/38.5(7.7s)
  // 四段結論一致(±1.2pp)⇒ 本模型對步進不敏感,取伺服器 tick 已遠比需要的細
  // (使用者「在確保模擬準確度前提下測試時間越短越好」的落點:先證明收斂,再挑最省的那一格)。
  DT: GAME.TICK_MS / 1000,
  MAX_T: 150,           // 單場上限(秒);逾時以戰果比分判勝(見 outcome)
  START_F: 1.10,        // 起始間距 = 雙方最長有效射程 × 此值(開場雙方都在射程外)
  PREF_STEP_M: 4,       // 偏好交戰距離的掃描解析度(公尺)
  LAT_M: 12,            // 同波成員橫向散布半寬(公尺;< GAME.LANE_SAFE_M ⇒ 仍在走廊內)
  // 升級只買**模型算得到**的六軌:小招/大招不在本模型內(使用者指示「先不考慮長按技和大小招」),
  // 讓它進採購清單等於兩邊都把錢丟進黑洞、只是把戰鬥升級節奏整體拖慢 = 系統性偏誤。
  TRACKS: ['lw', 'hw', 'hp', 'ar', 'sp', 'ch'],
};

const SEP = () => UNITS.tower.range * GAME.TOWER_SEP_F;   // 敵我前線塔位間距(② 的不變式)
const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);

// ---------- 建構 ----------

/**
 * 一台可操作機體(開場 Lv1 / 八軌 Lv0;升級狀態住 up)。
 * `tw` = 單軸擾動倍率 { dmg, range, speed, aoe } —— 只給 bal ⑦ 的**模型準確度自驗**用:
 * 把同一台機體單獨加強一軸去打原版,勝率 MUST 上升,否則就是模型對那一軸沒有反應
 * (使用者「在確保模擬準確度前提下」那句話的落點)。正式對局路徑一律不傳。
 */
export function mech(ch, side, tw = null) {
  const kind = charKind(ch), u = UNITS[kind], m = CHARACTERS[ch].mods || {};
  const flying = kind === 'drone';
  const M = {
    ch, kind, side, hero: true, flying, dir: side === 'SWARM' ? 1 : -1,
    x: 0, y: 0, up: Object.fromEntries(LANE.TRACKS.map((k) => [k, 0])), cash: ECON.START,
    hp0: Math.round(u.hp * (m.hp ?? 1)), sp0: Math.round(u.shield * (m.sp ?? 1)),
    armor0: heroArmor(ch), mp0: u.mp * (m.mp ?? 1), mpRegenBase: u.mpRegen,
    mob: heroMobility(kind, m, flying), slots: [], hurtT: -99,
  };
  M.tw = tw;
  if (tw?.speed) M.mob *= tw.speed;
  M.mp = M.mp0;
  resolve(M);
  M.hp = M.maxHp; M.sp = M.maxSp;
  return M;
}

/** 依八軌等級重新解析武器與生存值(升級後唯一套用點) */
function resolve(M) {
  const U = ECON.UPGRADES;
  M.maxHp = M.hp0 * (1 + U.hp.step * M.up.hp);
  M.maxSp = M.sp0 * (1 + U.sp.step * M.up.sp);
  M.armor = M.armor0 + U.ar.step * M.up.ar;
  M.chF = chargeF(M.up.ch);
  // 槽位的**射擊狀態**(彈藥/下一發時刻)MUST 跨解析保留 —— 升級是換規格不是換彈匣。
  // (前科:每買一階就重建 slots ⇒ 彈藥與裝填計時歸零 = 有錢的一方等於無限彈藥,
  //  實測 mag 3 / reload 12s 的 152mm 榴彈砲在 8.5s 內打出 3071 點傷害。)
  const keep = M.slots || [];
  M.slots = [];
  for (const [id, track] of [['light', 'lw'], ['heavy', 'hw']]) {
    const w = heroWeapon(M.ch, id, 1 + M.up[track], true);
    if (!w) continue;
    const old = keep.find((s) => s.id === id);
    const T = M.tw;
    const def = T ? { ...w, dmg: w.dmg * (T.dmg ?? 1), range: w.range * (T.range ?? 1),
      r: w.r * (T.aoe ?? 1), arc: w.arc * (T.aoe ?? 1) } : w;
    M.slots.push({
      def, id, mp: id === 'heavy' ? heavyMpCost(def) : 0,
      ammo: old ? Math.min(old.ammo, def.mag) : def.mag, next: old ? old.next : 0,
    });
  }
  M.maxRange = Math.max(...M.slots.map((s) => s.def.range));
}

/** 一波 NPC(生成於自方塔位,沿 x 前進);縱深/橫向散布見檔頭 */
function spawnWave(side, t) {
  const dir = side === 'SWARM' ? 1 : -1, comp = waveComp(), n = comp.length;
  const x0 = -dir * SEP() / 2;
  return comp.map((kind, i) => {
    const u = UNITS[kind];
    return {
      kind, side, dir, t0: t,
      x: x0 - dir * (i * GAME.WAVE_COHESION_M / Math.max(1, n - 1)),
      y: LANE.LAT_M * ((i % 3) - 1),
      hp: u.hp, armor: u.armor, speed: waveMarchSpeed(), next: 0,
    };
  });
}

function towers(side) {
  const dir = side === 'SWARM' ? 1 : -1;
  return [-1, 1].map((s) => ({
    kind: 'tower', side, x: -dir * SEP() / 2, y: s * GAME.TOWER_SIDE_OFF,
    hp: UNITS.tower.hp, armor: UNITS.tower.armor, next: 0, tower: true,
  }));
}

// ---------- 傷害鏈(逐項對齊 sim) ----------

/** 爆擊期望倍率(同高度 ⇒ 無 ALTITUDE 修正;高度差那一軸由 duel.mjs 的 ⑤ 掃描負責) */
const critF = (def) => (def.crit ? 1 + def.crit * ((def.critX || VITALS.CRIT_X) - 1) : 1);
/**
 * 閃避期望存活率(對齊 sim._dodges:輕武器直射限定;有效機動 > 門檻;飛行加成)。
 * **刻意不吃「這一步有沒有位移」**:本模型只有兵線軸一個自由度,沒有橫向走位,而真人在交火中
 * 幾乎恆在走位 ⇒ 拿「走到定位就停下 = 不閃避」建模,結果是**加速反而變弱**(2026-08-02 實測:
 * 同一台機體 +15% 移速的鏡像對局勝率 42.2%,方向與常識相反)。那是建模瑕疵,不是設計。
 * duel.mjs 的同名函式亦同(那支連位置都沒有)。
 */
const dodgeP = (tgt) => {
  if (!tgt.hero || tgt.mob <= EVASION.MOBILITY_MIN) return 0;
  return EVASION.GROUND + (tgt.flying ? EVASION.AIR_BONUS : 0);
};

/** 對目標結算一次傷害(雙層拆分 → 裝甲層吃 armorMul);回傳實際扣掉的 EHP */
function damage(tgt, dmg, def, byLight) {
  const raw = dmg * vsMult(def, tgt.kind) * critF(def) * (1 - (byLight ? dodgeP(tgt) : 0));
  const before = (tgt.sp || 0) + tgt.hp;
  const { toSp, toHp } = shieldSplit(def, raw, Math.max(0, tgt.sp || 0));
  if (tgt.sp != null) tgt.sp -= toSp;
  tgt.hp -= toHp * armorMul(tgt.armor, def.pen);
  return before - ((tgt.sp || 0) + tgt.hp);
}

/**
 * 一發射擊的命中名冊(**攻擊範圍在此計價**;三類幾何見檔頭)。
 * 回傳 [{ ent, f }] —— f = 該目標吃到的傷害比例(距離衰減 × 偏心遞減 × 貫穿衰減)。
 */
export function hits(shooter, aim, def, foes) {
  const d0 = dist(shooter, aim);
  const cls = aoeClass(def);
  if (cls === 'blast') {
    const R = blastFootprintR(def.r);
    const out = [];
    for (const e of foes) {
      const d = Math.max(0, dist(aim, e) - hitR(e));      // 量到命中量體最近點(對齊 sim._blast)
      if (d >= R) continue;
      out.push({ ent: e, f: blastFalloff(def.r, d) * dmgFalloff(def, d0) });
    }
    return out;
  }
  const ux = (aim.x - shooter.x) / (d0 || 1), uy = (aim.y - shooter.y) / (d0 || 1);
  if (cls === 'fan') {
    const half = (def.arc || 0) * Math.PI / 180, out = [];
    for (const e of foes) {
      const dx = e.x - shooter.x, dy = e.y - shooter.y, d = Math.hypot(dx, dy);
      if (d > def.range) continue;
      const ang = Math.abs(Math.atan2(dx * uy - dy * ux, dx * ux + dy * uy));
      if (ang > half + Math.atan2(hitR(e), Math.max(1, d))) continue;   // 錐緣算到命中量體
      out.push({ ent: e, f: fanFalloff(def.range, d) * offAxisFalloff(half > 0 ? ang / half : 0) });
    }
    return out;
  }
  if (cls === 'line') {
    const R = lanceR(def), out = [];
    for (const e of foes) {
      const dx = e.x - shooter.x, dy = e.y - shooter.y;
      const s = dx * ux + dy * uy;                        // 線段上最近點(對齊 sim._lanceHits)
      if (s < 0 || s > def.range) continue;
      const off = Math.abs(dx * uy - dy * ux), lim = R + hitR(e);
      if (off > lim) continue;
      out.push({ ent: e, s, f: dmgFalloff(def, s) * offAxisFalloff(off / lim) });
    }
    out.sort((a, b) => a.s - b.s);                        // 排序用原始 s(A18)
    return out.slice(0, LANCE.MAX).map((h, i) => ({ ent: h.ent, f: h.f * LANCE.DECAY ** i }));
  }
  // 非扇形輕武器:單體直擊
  return [{ ent: aim, f: dmgFalloff(def, d0) }];
}

// ---------- 機體策略 ----------

/** 距離 d 上「S 對 T」的單體持續 DPS(偏好距離的啟發式;與 duel.mjs 同一個簡化) */
function dpsAt(S, T, d) {
  let v = 0;
  for (const s of S.slots) {
    if (d > s.def.range) continue;
    const cyc = s.def.mag / (s.def.rate || 3) + s.def.reload;
    const fall = s.def.fan ? fanFalloff(s.def.range, d) : dmgFalloff(s.def, d);
    v += s.def.dmg * vsMult(s.def, T.kind) * fall * critF(s.def)
      * (1 - (s.id === 'light' ? dodgeP(T) : 0)) * s.def.mag / cyc * armorMul(T.armor, s.def.pen);
  }
  return v;
}
/** 偏好交戰距離 = 讓「自身輸出 ÷ 對方輸出」最大的距離(與 duel.mjs 同一條啟發式) */
function prefer(S, T) {
  let best = S.maxRange, score = -1;
  for (let d = LANE.PREF_STEP_M; d <= S.maxRange + 1e-9; d += LANE.PREF_STEP_M) {
    const mine = dpsAt(S, T, d);
    if (mine <= 0) continue;
    const v = mine / Math.max(dpsAt(T, S, d), 1e-6);
    if (v > score + 1e-9) { score = v; best = d; }
  }
  return best;
}
/** 對砲塔的站位(到塔的距離):打得到塔的最遠處 —— 射程夠就站在塔火之外,不夠就只能吃塔火。
 *  推導不手寫:`UNITS.tower.range` 一動,站外/貼身的分界自己跟著走。 */
function towerHold(M) {
  const best = Math.max(...M.slots.map((s) => s.def.range));
  return best > UNITS.tower.range ? Math.min(best, UNITS.tower.range + 1) : best;
}

/** 有錢就升級:貪心買最便宜的一階(與 game.js `_sweepPick` 同一條規則) */
function buyUp(M) {
  const U = ECON.UPGRADES;
  for (;;) {
    let pick = null, cost = Infinity;
    for (const k of LANE.TRACKS) {
      if (M.up[k] >= U[k].max) continue;
      const p = upgradePrice(U[k], M.up[k]);
      if (p < cost) { cost = p; pick = k; }
    }
    if (!pick || cost > M.cash) return;
    M.cash -= cost; M.up[pick]++;
    const hpF = M.hp / M.maxHp, spF = M.maxSp > 0 ? M.sp / M.maxSp : 0;
    resolve(M);
    M.hp = M.maxHp * hpF; M.sp = M.maxSp * spF;   // 升級補上限:既有損傷比例不變
  }
}

/**
 * 一台機體的開火:逐槽位檢查裝填/彈藥/電力,選敵後結算(含範圍命中名冊)。
 * 選敵序 = 敵方機體 > 最近的敵方 NPC > 敵方砲塔(都要在該槽位射程內)——
 * 對線期打人、沒人打就清兵、清完兵才拆塔,與正式對局的優先序同構。
 */
function fire(M, foe, enemyTower, t, foes) {
  for (const s of M.slots) {
    if (t < s.next) continue;
    if (s.ammo <= 0) { s.ammo = s.def.mag; s.next = t + s.def.reload; continue; }
    if (s.id === 'heavy' && M.mp < s.mp) continue;
    const inR = (e) => dist(M, e) - hitR(e) <= s.def.range;
    let aim = foe.hp > 0 && inR(foe) ? foe : null;
    if (!aim) {
      let td = Infinity;
      for (const e of foes) {
        if (e.tower || e.hero) continue;
        const d = dist(M, e);
        if (d - hitR(e) <= s.def.range && d < td) { td = d; aim = e; }
      }
    }
    if (!aim && enemyTower && inR(enemyTower)) aim = enemyTower;
    if (!aim) continue;
    s.ammo--; s.next = t + 1 / (s.def.rate || 3);
    if (s.id === 'heavy') M.mp -= s.mp;
    for (const h of hits(M, aim, s.def, foes)) {
      if (h.f <= 0 || h.ent.hp <= 0) continue;
      if (h.ent.hero) h.ent.hurtT = t;
      damage(h.ent, s.def.dmg * h.f, s.def, s.id === 'light');
      if (h.ent.hp <= 0 && !h.ent.paid) {                  // 賞金:擊殺入帳(1v1 無友軍 ⇒ 助攻不模型化)
        h.ent.paid = 1;
        M.cash += ECON.BOUNTY[h.ent.kind] ?? 0;
      }
    }
  }
}

// ---------- 主迴圈 ----------

/**
 * 打一場前線交戰。回傳 { win, t, why, leftA, leftB, towA, towB }。
 * win:1 = A 勝、0 = B 勝、0.5 = 平手(逾時且戰果相同)。
 */
export function laneBattle(chA, chB, twA = null, twB = null) {
  const A = mech(chA, 'SWARM', twA), B = mech(chB, 'STEEL', twB);
  const gap = Math.max(A.maxRange, B.maxRange) * LANE.START_F;
  A.x = A.x0 = -Math.max(SEP() / 2, gap / 2); B.x = B.x0 = Math.max(SEP() / 2, gap / 2);
  const prefA = prefer(A, B), prefB = prefer(B, A);
  const holdA = towerHold(A), holdB = towerHold(B);
  const tw = { SWARM: towers('SWARM'), STEEL: towers('STEEL') };
  const tw0 = UNITS.tower.hp;
  // 開場預置一波(對齊 sim._prefillLanes 的用意):正式對局的前線恆有兵波在對撞,
  // 沒有預置就等於「前 15 秒沒有兵線」= 兵波這一軸在多數短場次裡完全沒有作用。
  // 預置量 = 剛好走到中線的那一波(推導不手寫:塔位到中線 ÷ 行軍速度)。
  const PRE = SEP() / 2 / waveMarchSpeed();
  let creeps = [...spawnWave('SWARM', -PRE), ...spawnWave('STEEL', -PRE)], t = 0,
    nextWave = waveInterval() - PRE, why = 'timeout', win = 0.5;
  for (const c of creeps) c.x += c.dir * waveMarchSpeed() * PRE;

  const foesOf = (side) => [
    ...creeps.filter((c) => c.side !== side && c.hp > 0),
    ...(side === 'SWARM' ? (B.hp > 0 ? [B] : []) : (A.hp > 0 ? [A] : [])),
    ...tw[side === 'SWARM' ? 'STEEL' : 'SWARM'].filter((x) => x.hp > 0),
  ];

  for (; t < LANE.MAX_T; t += LANE.DT) {
    // ---- 兵波(生成頻率同正式遊戲)----
    if (t >= nextWave) { creeps.push(...spawnWave('SWARM', t), ...spawnWave('STEEL', t)); nextWave += waveInterval(); }

    // ---- NPC:推進到有目標為止,然後開火 ----
    for (const c of creeps) {
      if (c.hp <= 0) continue;
      const u = UNITS[c.kind], foes = foesOf(c.side);
      let tgt = null, td = Infinity;
      for (const e of foes) { const d = dist(c, e) - hitR(e); if (d < td) { td = d; tgt = e; } }
      if (!tgt || td > u.range) { c.x += c.dir * c.speed * LANE.DT; continue; }
      if (t < c.next) continue;
      c.next = t + 1 / u.rate;
      const wd = { pen: 0, vs: {} };
      if (tgt.hero) { tgt.hurtT = t; }
      damage(tgt, u.dmg, wd, false);
    }
    // ---- 砲塔 ----
    for (const side of ['SWARM', 'STEEL']) for (const T of tw[side]) {
      if (T.hp <= 0 || t < T.next) continue;
      const foes = foesOf(side);
      let tgt = null, td = Infinity;
      for (const e of foes) { const d = dist(T, e) - hitR(e); if (d <= UNITS.tower.range && d < td) { td = d; tgt = e; } }
      if (!tgt) continue;
      T.next = t + 1 / UNITS.tower.rate;
      if (tgt.hero) tgt.hurtT = t;
      damage(tgt, UNITS.tower.dmg, { pen: 0, vs: {} }, false);
    }
    // ---- 兵線接觸線:雙方最前線小兵的中點(沒兵就是地圖中線)----
    let fS = null, fT = null;
    for (const c of creeps) {
      if (c.hp <= 0) continue;
      if (c.side === 'SWARM') { if (fS == null || c.x > fS) fS = c.x; }
      else if (fT == null || c.x < fT) fT = c.x;
    }
    const contact = fS != null && fT != null ? (fS + fT) / 2 : (fS ?? fT ?? 0);
    // ---- 機體:撤退判定 → 走位 → 開火 → 回復/升級 ----
    for (const [M, foe, pref, hold] of [[A, B, prefA, holdA], [B, A, prefB, holdB]]) {
      if (M.hp <= 0) continue;
      const enemyTower = tw[M.side === 'SWARM' ? 'STEEL' : 'SWARM'].filter((x) => x.hp > 0)[0];
      const foes = foesOf(M.side);
      // ---- 撤退 / 復出(門檻與遲滯帶沿用 bots.js 的同一組 BOT_TACTIC,MUST NOT 另立第二套數字)----
      // 少了這一段,模型裡的機體就是「站著對射到其中一方倒下」⇒ 機動整條軸沒有價值,
      // 而蜂群的正規求生機制正是機動(單機 80% EHP 的補償)。
      // 護盾脫戰才回、裝甲離開主堡不回 ⇒ 撤退換得回護盾換不回裝甲,對線終究會分出勝負(不會無限拖)。
      if (M.pull) { if (M.maxSp > 0 && M.sp >= M.maxSp * BOT_TACTIC.RALLY_SP) M.pull = 0; }
      else if (M.maxSp > 0 && M.sp < M.maxSp * BOT_TACTIC.PULL_SP) M.pull = 1;
      // ---- 走位 ----
      let want;
      if (M.pull) {
        want = M.x0;                                        // 退回自家塔位等護盾(邊退邊打,見 fire)
      } else {
        // **目標是塔,不是對線**:站位的下限是「打得到敵方前線塔的位置」(towerHold)——
        // 勝利條件有兩個,站在原地對射只兌現得了其中一個。
        want = enemyTower
          ? enemyTower.x - M.dir * Math.sqrt(Math.max(1, hold ** 2 - GAME.TOWER_SIDE_OFF ** 2)) : M.x;
        if (foe.hp > 0) {
          // 偏好交戰距離可以往前壓(貼身武器要貼上去)也可以往後拉開,但**兩邊都被兵線接觸線框住**:
          // 離接觸線超過一個走廊半寬 GAME.LANE_SAFE_M 就不是拉鋸、是棄線(兵波沒人擋、塔自己扛)。
          // 這一條同時擋掉模型的兩個極端(2026-08-02 逐一實測):
          //   ・沒有下限 = 完美風箏 —— 射程長跑得快的一方永遠停在最大射程外(drone 65.5% / robot 41.4%),
          //     量到的是「模型允許無限後撤」,不是機體真的強;
          //   ・沒有上限 = 全員貼臉 —— 射程與機動整條軸失去意義(drone 36.8% / robot 61.8%)。
          // 框的中心取**兵線接觸線**而不是地圖中線:兵線推到哪、對線就在哪(與正式對局同構)。
          const heroWant = foe.x - M.dir * pref;
          want = Math.min(contact + GAME.LANE_SAFE_M, Math.max(contact - GAME.LANE_SAFE_M, heroWant));
        }
        want = M.dir > 0 ? Math.max(M.x0, want) : Math.min(M.x0, want);   // 後撤下限 = 開場站位
      }
      const step = Math.min(M.mob * LANE.DT, Math.abs(want - M.x));
      M.x += Math.sign(want - M.x) * step;
      fire(M, foe, enemyTower, t, foes);
      // 電力 / 護盾回復(脫戰 OOC_S 後回盾)+ 有錢就升級
      M.mp = Math.min(M.mp0, M.mp + M.mpRegenBase * M.chF * LANE.DT);
      if (t - M.hurtT >= VITALS.OOC_S) M.sp = Math.min(M.maxSp, M.sp + M.maxSp * VITALS.SP_REGEN_PS * M.chF * LANE.DT);
      buyUp(M);
    }
    creeps = creeps.filter((c) => c.hp > 0 && Math.abs(c.x) < SEP());
    // ---- 勝負:先擊毀敵方機體或一座敵方砲塔者獲勝 ----
    const towDead = (side) => tw[side].some((x) => x.hp <= 0);
    if (B.hp <= 0 || towDead('STEEL')) { win = 1; why = B.hp <= 0 ? 'kill' : 'tower'; break; }
    if (A.hp <= 0 || towDead('SWARM')) { win = 0; why = A.hp <= 0 ? 'kill' : 'tower'; break; }
  }
  const towLeft = (side) => Math.min(...tw[side].map((x) => x.hp)) / tw0;
  const leftA = (A.sp + A.hp) / (A.maxSp + A.maxHp), leftB = (B.sp + B.hp) / (B.maxSp + B.maxHp);
  if (why === 'timeout') {
    // 逾時:先比「把對方塔打掉多少」(那是勝利條件),再比剩餘 EHP —— 兩者都相同才算平手
    const dA = towLeft('STEEL'), dB = towLeft('SWARM');
    win = Math.abs(dA - dB) > 1e-6 ? (dA < dB ? 1 : 0)
      : Math.abs(leftA - leftB) > 1e-6 ? (leftA > leftB ? 1 : 0) : 0.5;
  }
  return { win, t, why, leftA, leftB, towA: towLeft('SWARM'), towB: towLeft('STEEL') };
}

/** A 對 B 的勝率(本模型確定性 ⇒ 單場即結論;取雙向平均消掉「誰站 SWARM 端」的位置偏差) */
export function laneWin(chA, chB, twA = null, twB = null) {
  return (laneBattle(chA, chB, twA, twB).win + (1 - laneBattle(chB, chA, twB, twA).win)) / 2;
}

/**
 * 全角色矩陣;回傳 { rate[a][b], avg[a], stat }。
 * stat = { n, med, p90, timeout } —— 對局長度與逾時率(使用者「測試時間越短越好」的量測面)。
 * 逐對只跑一次(rate[b][a] = 1 − rate[a][b]),但每一對仍打**雙向**兩場(laneWin)以消掉位置偏差。
 */
export function laneMatrix(chs = Object.keys(CHARACTERS)) {
  const rate = {}, ts = [];
  let timeout = 0;
  for (const a of chs) rate[a] = {};
  for (let i = 0; i < chs.length; i++) for (let j = i + 1; j < chs.length; j++) {
    const a = chs[i], b = chs[j];
    const r1 = laneBattle(a, b), r2 = laneBattle(b, a);
    for (const r of [r1, r2]) { ts.push(r.t); if (r.why === 'timeout') timeout++; }
    const w = (r1.win + (1 - r2.win)) / 2;
    rate[a][b] = w; rate[b][a] = 1 - w;
  }
  const avg = Object.fromEntries(chs.map((a) => {
    const v = Object.values(rate[a]);
    return [a, v.reduce((s, x) => s + x, 0) / v.length];
  }));
  ts.sort((x, y) => x - y);
  return { rate, avg, stat: { n: ts.length, med: ts[ts.length >> 1], p90: ts[Math.floor(ts.length * 0.9)], timeout: timeout / ts.length } };
}
