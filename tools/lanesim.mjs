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
// ---- 長按攻擊(機種絕招)也在模型內(2026-08-02 使用者定案「只使用輕/重武器 + 長按攻擊」)----
// 三招都是**可被擊落的載具**(飽和攻擊護衛機 / 集束轟炸機 / 極音速飛彈),而三者的傷害預算
// (data.js SPECIAL)在設計上**逐位元等值** —— e2e「機種絕招三招同預算」已經釘死這一條。
// 所以「把絕招加進模型」如果只是「CD 到就加一份預算的傷害」,三機種會拿到一模一樣的加成,
// 量不到任何東西。真正的差別全在**投射過程**:
//   ・飛過去要幾秒(kami 63m/s 撲擊 / decoy 62m/s 巡航 / hyper 45° 拋射 + 極音速俯衝);
//   ・那幾秒裡敵方砲塔與小兵打不打得下來(HP 全由「一座砲塔打幾秒」反解,見 data.js);
//   ・被打下來之後還剩多少(kami 原地半威力殉爆 / decoy 墜毀補投一顆 / hyper **完全否定**);
//   ・預算怎麼切(kami 4 份均分、decoy 撞擊 + 6 顆逐顆個別瞄準、hyper 單一戰鬥部吃整份)。
// 故本模型把載具當**真的實體**跑:進 foesOf ⇒ 敵方砲塔/小兵/機體都打得到它,擊落也有賞金。
// MUST NOT 簡化成「一次性加一筆傷害」——那等於把上面四項全部抹平,ⓕ 那一段就永遠是三個相同的數字。
// 小招/大招仍不在模型內(使用者:先不考慮大小招),TRACKS 也仍不含 sk/ul。
//
// ---- 與 server/sim.js 的對齊 ----
// 傷害鏈逐項對齊 sim.heroHit/_blast:dmgFalloff → vsMult → 爆擊期望 → 閃避期望 → shieldSplit
// 雙層拆分 → 裝甲層吃 armorMul。差別只有「擲骰改期望值」(稽核要確定性,見全域 A4)。
import {
  CHARACTERS, UNITS, GAME, ECON, VITALS, EVASION, LANCE, SQUAD, DECOY,
  BOT_TACTIC, armorMul, vsMult, heroWeapon, charKind, heroArmor, heroMobility, evasionMinSpeed, chargeF,
  dmgFalloff, fanFalloff, blastFalloff, offAxisFalloff, fanConeHalf, blastFootprintR, aoeClass,
  shieldSplit, heavyMpCost, upgradePrice, waveComp, waveMarchSpeed, hitR, lanceR,
  kamiHp, kamiSide, decoyHp, hyperHp, hyperRange, hyperApex, hyperClimbVx, hyperDiveSpd, hyperTrackR,
  heroAbility, ultDelivered, ultParts, ultPartN, ULT_CARRIER, SELF_ULT, selfUltBoost,
  supportN, supportHp, supportLegS, supportSpeed, supportF, selfUltTempo,
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
  // 補血型大招的施放門檻(EHP 佔比):**鏡射 `bots._castSupport` 的 `hurt = frac < 0.55`**。
  // 那個數字在 bots.js 是行內常數 ⇒ 改那邊 MUST 回頭改這裡,否則模型會在滿血時把治療倒掉。
  HEAL_FRAC: 0.55,
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
    // ---- 長按 = 大招(2026-08-06 第二階段)的量測面(bal ⑦f)----
    // `abil*` = **載具組**的實得傷害帳(strike payload;分三桶,見 detonate 的註解);
    // `car*`  = 載具**份額**的交付率(送出幾份 / 抵達幾份)—— 這一項對每一種 payload 都成立,
    //           效果型(heal/emp/buff/summon)沒有 EHP 可量,但「有沒有飛到」照樣量得到;
    // `supLost` = 輔助機被擊落幾架(2026-08-07 自身型也是載具制之後的改制代價);
    // `ult*`  = **自身型組**的補償兌現帳(EHP 當量:多打出的 + 少挨的 + 補回來的)。
    abilAt: 0, abilN: 0, abilDmg: 0, abilBy: { hero: 0, tower: 0, creep: 0 },
    carN: 0, carHit: 0, carNom: 0, supLost: 0,
    ultN: 0, ultBy: { dealt: 0, dealtEff: 0, prevented: 0, healed: 0 },
    uf: null,   // 目前生效的自身型大招時窗(見 ufFrom / supSync)
    sup: null,  // 目前這一輪輔助機隊的群組紀錄(見 castSelfUlt)
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
const dodgeP = (tgt, U = null) => {
  if (!tgt.hero || tgt.mob <= evasionMinSpeed()) return 0;
  // 招式帶來的閃避率增額(recon / overdrive)疊在基準之上,對齊 sim._dodges 的 `_buffVal(t,'evade')`
  return Math.min(0.95, EVASION.GROUND + (tgt.flying ? EVASION.AIR_BONUS : 0) + (U ? U.evade : 0));
};

/** 目前生效的大招時窗(自身型的補償 / 載具遞送的團隊 buff 共用同一份紀錄;過期 = null) */
const ufAt = (e, now) => (e.hero && e.uf && e.uf.until > now ? e.uf : null);

/** 對目標結算一次傷害(雙層拆分 → 裝甲層吃 armorMul);回傳實際扣掉的 EHP。
 *  now = 模擬時鐘:大招的減傷 / 閃避在此消費(未傳 = 不吃 buff,舊行為)。 */
function damage(tgt, dmg, def, byLight, now = -Infinity) {
  const U = ufAt(tgt, now);
  const takenF = U ? U.takenF : 1;
  const evd = byLight ? dodgeP(tgt, U) : 0;
  const raw = dmg * vsMult(def, tgt.kind) * critF(def) * takenF * (1 - evd);
  const before = (tgt.sp || 0) + tgt.hp;
  const { toSp, toHp } = shieldSplit(def, raw, Math.max(0, tgt.sp || 0));
  if (tgt.sp != null) tgt.sp -= toSp;
  tgt.hp -= toHp * armorMul(tgt.armor, def.pen);
  const got = before - ((tgt.sp || 0) + tgt.hp);
  // 「少挨的」入帳(bal ⑦f 的自身型組):傷害鏈在夾到 0 之前是**線性**的 ⇒
  // 沒有這一招時會扣掉 got × (fBase / fNow),差額就是這一招擋下來的 EHP —— 是等式不是估計。
  if (U && got > 0) {
    const fNow = takenF * (1 - evd), fBase = 1 - (byLight ? dodgeP(tgt, null) : 0);
    if (fNow > 1e-9 && fBase > fNow) tgt.ultBy.prevented += got * (fBase / fNow - 1);
  }
  // 挨打即結束(t02 超載的 `brk`):對齊 sim._breakOnHit —— 全滿彈匣 + 零裝填的爆發
  // 只在沒被打到的前提下成立,吃到一發就回到常態(這條風險正是它的價錢)。
  if (U && U.brk && got > 0) U.until = -Infinity;
  return got;
}

/**
 * 一次**爆風**的命中名冊(逐點對齊 sim._blast:量到命中量體最近點、只吃 blastFalloff)。
 * 爆風本身**沒有距離衰減**(那是彈道飛行的事)⇒ 武器路徑由 hits() 另乘 dmgFalloff,
 * 絕招引爆(kami/decoy/hyper)則直接吃這一支。兩條路 MUST 共用同一份幾何,MUST NOT 各寫一次。
 */
export function blastHits(cx, cy, def, foes) {
  const R = blastFootprintR(def.r), out = [];
  for (const e of foes) {
    if (e.hp <= 0) continue;
    const d = Math.max(0, Math.hypot(cx - e.x, cy - e.y) - hitR(e));
    if (d >= R) continue;
    out.push({ ent: e, f: blastFalloff(def.r, d) });
  }
  return out;
}

/**
 * 一發射擊的命中名冊(**攻擊範圍在此計價**;三類幾何見檔頭)。
 * 回傳 [{ ent, f }] —— f = 該目標吃到的傷害比例(距離衰減 × 偏心遞減 × 貫穿衰減)。
 */
export function hits(shooter, aim, def, foes) {
  const d0 = dist(shooter, aim);
  const cls = aoeClass(def);
  if (cls === 'blast') {
    const k = dmgFalloff(def, d0);                        // 彈道飛了 d0 的距離衰減(爆風本身不吃,見 blastHits)
    return blastHits(aim.x, aim.y, def, foes).map((h) => ({ ent: h.ent, f: h.f * k }));
  }
  const ux = (aim.x - shooter.x) / (d0 || 1), uy = (aim.y - shooter.y) / (d0 || 1);
  if (cls === 'fan') {
    const half = (def.arc || 0) * Math.PI / 180, out = [];
    for (const e of foes) {
      const dx = e.x - shooter.x, dy = e.y - shooter.y, d = Math.hypot(dx, dy);
      if (d > def.range) continue;
      const ang = Math.abs(Math.atan2(dx * uy - dy * ux, dx * ux + dy * uy));
      if (ang > fanConeHalf(def, d, hitR(e))) continue;   // 錐緣算到命中量體(data.js 單一縫;sim/客戶端同吃)
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
 * 下一次擊發的排程時刻(**唯一縫**:機體槽位 / NPC / 砲塔三個排程端 MUST 全吃這一支)。
 *
 * 舊制是 `next = t + 1/rate`,**每一發都把不滿一格的殘量丟掉** ⇒ 模型的有效射速被格點吃掉:
 * 步進 0.125s 之下 rate 7 實際只打 4.0 發/秒(−43%)、rate 3.91 只打 2.67(−32%)。正式對局
 * 的射速閘(`sim._gateFire` / `game._tryFire`)量的是**連續時鐘**,根本沒有這一層量化 ——
 * 也就是說模型量到的不是武器強弱,是「這把武器的射速落在格點的哪一側」。
 *
 * 改成從**排定時刻**累加 ⇒ 長期平均射速 = 標稱射速,與步進無關(這才兌現檔頭「步進收斂」那條)。
 * 落後超過一格(沒有目標而空等)一律只補一格,MUST NOT 讓空窗期把發數存起來事後連射。
 *
 * 2026-08-02:射速壓縮(data.js FIRE_RATE)把全部輕武器重新落到格點上,舊制的量化偏差因此
 * 在 ⑦c 上表現成「無人機憑空變強 3.3pp」—— 那是模型的格點,不是機體的強弱。
 */
function reFire(next, t, iv) {
  return Math.max(next, t - LANE.DT) + iv;
}

/**
 * 一台機體的開火:逐槽位檢查裝填/彈藥/電力,選敵後結算(含範圍命中名冊)。
 * 選敵序 = 敵方機體 > 最近的敵方 NPC > 敵方砲塔(都要在該槽位射程內)——
 * 對線期打人、沒人打就清兵、清完兵才拆塔,與正式對局的優先序同構。
 */
function fire(M, foe, enemyTower, t, foes) {
  if ((M.empUntil || 0) > t) return;   // 大招 EMP:武器離線(移動不受影響,對齊 sim._jammed)
  const U = ufAt(M, t);
  const dmgF = U ? U.dmgF : 1, rangeF = U ? U.rangeF : 1, reloadF = U ? U.reloadF : 1;
  for (const s of M.slots) {
    if (t < s.next) continue;
    if (s.ammo <= 0) {
      s.ammo = s.def.mag;
      // 超載(t02「同步率 100%」):時窗內**免裝填** —— 見底就地補滿,不進填彈計時器
      // (對齊 sim._gateFire 的 noReloadUntil)。`s.shadow` = 沒有這一招時這個槽位會忙到哪一刻,
      // **只用來記帳**(那段窗裡打出去的每一發都是這一招換來的),不影響任何機制。
      if (U && U.noReload) s.shadow = Math.max(s.shadow || 0, t + s.def.reload * reloadF);
      else { s.next = t + s.def.reload * reloadF; continue; }
    }
    if (s.id === 'heavy' && M.mp < s.mp) continue;
    // 射程加成(m04「全境盡職調查」的 mul.range):MUST 連 def 一起換 —— 扇形/貫穿的幾何
    // 也吃 def.range,只改選敵那道閘 = 「鎖得到卻打不到」
    const def = rangeF !== 1 ? { ...s.def, range: s.def.range * rangeF } : s.def;
    const inR = (e) => dist(M, e) - hitR(e) <= def.range;
    let aim = foe.hp > 0 && inR(foe) ? foe : null;
    if (!aim) {
      let td = Infinity;
      for (const e of foes) {
        if (e.tower || e.hero) continue;
        const d = dist(M, e);
        if (d - hitR(e) <= def.range && d < td) { td = d; aim = e; }
      }
    }
    if (!aim && enemyTower && inR(enemyTower)) aim = enemyTower;
    if (!aim) continue;
    const bonus = !!(U && U.noReload && t < (s.shadow || 0));   // 這一發本來打不出來
    s.ammo--; s.next = reFire(s.next, t, 1 / (def.rate || 3));
    if (s.id === 'heavy') M.mp -= s.mp;
    for (const h of hits(M, aim, def, foes)) {
      if (h.f <= 0 || h.ent.hp <= 0) continue;
      if (h.ent.hero) h.ent.hurtT = t;
      const got = damage(h.ent, def.dmg * dmgF * h.f, def, s.id === 'light', t);
      // 「多打出的」入帳:免裝填那幾發整發都算,火力加成則只算增額那一份。
      // **分桶與 detonate 同一條原則**:清兵那一份不計 —— 兵波每 waveInterval 補一批,
      // 對「先擊毀敵方機體或一座砲塔」兩個勝利條件幾乎沒有貢獻。少了這一刀,爆風型武器的
      // 火力加成會被兵波灌爆(實測 s04 一次施放的帳從 925 掉到 hero+tower 才是真正兌現的量)。
      if (U && got > 0) {
        const add = bonus ? got : got * (dmgF - 1) / dmgF;
        M.ultBy.dealt += add;
        if (h.ent.hero || h.ent.tower) M.ultBy.dealtEff += add;
      }
      if (U && U.vamp > 0 && got > 0) {                        // 吸血(m01「回收條款」的 add)
        const before = M.hp;
        M.hp = Math.min(M.maxHp, M.hp + got * U.vamp);
        M.ultBy.healed += M.hp - before;
      }
      reward(M, h.ent);
    }
  }
}

/** 擊殺賞金入帳(1v1 無友軍 ⇒ 助攻不模型化);每個實體只付一次 */
function reward(M, e) {
  if (e.hp > 0 || e.paid) return;
  e.paid = 1;
  M.cash += ECON.BOUNTY[e.kind] ?? 0;
}

// ---------- 長按 = 大招(2026-08-06 使用者定案:一般模式 → 小招 / 狙擊模式 → 大招)----------
// 機種絕招(飽和攻擊 / 集束炸彈 / 極音速飛彈)**整組退場**,本模型裡的「長按」自此只有兩條路:
//   ・**載具組**(23 台,`ultDelivered`)—— 同機種形式的載具點遞送大招 payload。載具仍是
//     **可被擊落的實體**(進 foesOf ⇒ 敵方砲塔/小兵/機體都打得到),所以這一組的價值就是
//     「**送出去的份額有幾份真的飛到**」:kami 魚貫、轟炸機逐批、飛彈全有或全無,三種形式在
//     同一組前線火力下的交付率本來就不同,而那正是 ⑦f 要量的東西。
//   ・**自身型組**(9 台)—— 2026-08-07 起同樣是載具制:派出 `supportN` 架**跟隨玩家的輔助機**
//     (data.js ULT_SUPPORT),飛完投放腿才供輸、被打下來就少一份(疊加是加法)。價值仍在
//     「時窗裡多打出多少 / 少挨多少 / 補回多少」EHP,但那個時窗現在是**可以被打斷的**。
//     輔助機 MUST 當真的實體跑(進 foesOf)—— 模型看不到它就等於這一輪改制沒有發生;
//     損失率由 bal ⑦f 的「輔助機損失」那一行印出來(恆 0 = 這一條沒有兌現)。
//     **本模型的選敵是最近優先**,而輔助機貼著主機 ⇒ 火力多半仍落在主機身上,
//     那個損失率因此是實戰的**下界**(真人會刻意先點掉補給機)。
//
// 兩組的**量測面刻意不同**(bal ⑦f):載具組量份額交付率(對每一種 payload 都成立 —— 效果型的
// heal/emp/buff/summon 沒有 EHP 可量,但「有沒有飛到」照樣量得到),自身型組量 EHP 當量。
// MUST NOT 把兩組硬塞進同一個平均:那正是舊制(三招同預算)在載具化之後失效的原因 ——
// 效果型 payload 的 EHP 恆為 0,混進去會被讀成「這一招不會交付」,而它其實每一發都到了。
//
// **本模型看不到的價值**(逐項列出,MUST NOT 靜默吞掉;bal ⑦f 照樣印出來):
//   匿蹤的不可鎖定(m08)/ 無霧視野(m04·t04)/ 定位 mark(t04)/ 大跳躍 leap(t06)/
//   原地復活 revive(s12;本模型陣亡即分勝負,沒有重生倒數)/ 解除異常 cleanse(除了 EMP)。
//   這些一律**不計價** ⇒ 那幾台在 ⑦f 的自身型欄是**下界**,不是它們真正的強度。

/** 機種 → 這一招的載具類別(名冊唯一縫;`kind` 同時是 TARGET_CLASS / hitR 的鍵) */
const ABIL_KIND = { drone: 'kami', morph: 'decoy', robot: 'hyper' };
/** 絕招傷害預算吃「輕/重武器綜合等級」⇒ 由八軌現況推導(對齊 data.js specialTier) */
const abilOf = (M) => ({ light: 1 + M.up.lw, heavy: 1 + M.up.hw });

/**
 * 一次絕招引爆:對名冊內全員結算(**AoE 不爆擊、不可閃避**,對齊 sim._blast)+ 記帳 + 賞金。
 * 記帳**分三桶**(hero / tower / creep):總實得傷害會被清兵灌爆 —— 集束炸彈一顆 14m 爆風
 * 打在兵波上動輒吃到兩三隻,累積出來的數字是全表最大的,但兵波每 waveInterval 就補一批,
 * 對「先擊毀敵方機體或一座砲塔」這兩個勝利條件幾乎沒有貢獻。要調平衡就 MUST 看分桶。
 */
function detonate(M, wdef, cx, cy, t, foes) {
  // 單軸擾動(bal ⑦b 的模型準確度自驗)MUST 一起作用在長按攻擊上:火力與攻擊範圍這兩軸
  // 現在有一大半是絕招在扛,只擾動武器那半 = 訊號被稀釋到量不出方向性(2026-08-02 實測:
  // 只擾動武器時「攻擊範圍 ×2」的勝率從 54.2% 掉到 49.3%,方向性自驗當場失效)。
  // `range`/`speed` 刻意不套:絕招的施放距離與飛行速度是各招自己的機制,不是機體的那兩軸。
  const T = M.tw;
  const def = T ? { ...wdef, dmg: wdef.dmg * (T.dmg ?? 1), r: wdef.r * (T.aoe ?? 1) } : wdef;
  for (const h of blastHits(cx, cy, def, foes)) {
    if (h.f <= 0) continue;
    if (h.ent.hero) h.ent.hurtT = t;
    const got = damage(h.ent, def.dmg * h.f, def, false, t);
    M.abilDmg += got;
    M.abilBy[h.ent.hero ? 'hero' : h.ent.tower ? 'tower' : 'creep'] += got;
    reward(M, h.ent);
  }
}

/**
 * 長按攻擊的施放判定:CD 到、且施放距離內有目標就放。
 * 選敵序與武器同構(敵方機體 > 最近的敵方 NPC > 敵方砲塔)—— 真人也是「有人打人、沒人拆塔」。
 * 回傳新生成的載具(進 vehicles 名冊 ⇒ 下一格起就是敵方砲塔/小兵/機體都打得到的實體)。
 */
function castAbil(M, foe, enemyTower, t, foes, ownFort) {
  if (t < M.abilAt) return [];
  // `noUlt` = ⑦f 的**反事實對照組**(同一台機體、同一份升級,只是不放大招)。自身型組的價值
  // 有一半本模型無法逐項歸因(射程/移速/視野/匿蹤,見本節檔頭)⇒ 拿「有 vs 沒有」的鏡像勝率量,
  // 就不必替每一種效果各寫一條計價規則,也就不會漏算(漏算的症狀是「這一招看起來沒有用」)。
  if (M.tw?.noUlt) return [];
  // 載具組:同形式載具攜帶大招 payload 點遞送(效果取代傷害),CD/MP 走 heroAbility 解析值
  if (ultDelivered(M.ch)) return castUltCarrier(M, foe, enemyTower, t, foes, ownFort);
  // 自身型組:派出跟隨玩家的輔助機隊(2026-08-07),飛完投放腿才供輸、被打下來就少一份
  return castSelfUlt(M, foe, enemyTower, t, foes, ownFort);
}

/**
 * 自身強化型大招的時窗紀錄(`M.uf`)—— **一份**:自身型大招彼此不疊(一次只放得出一招),
 * 欄位對齊伺服器的 mods 通道:dmgF ← mul.dmg + 補償增額 / takenF ← mul.dmgTaken /
 * reloadF ← mul.reload / evade ← add.evade / speedF ← mul.speed 或 add haste /
 * rangeF ← mul.range / regenF ← rally 的 regen / noReload ← overdrive / vamp ← add vamp /
 * brk ← 挨一發就結束。
 * `f` = 目前在線的輔助機份額(疊加是**加法**:乘數型 1 + (m−1)×f、數值型 v×f;
 * 對齊 sim._castEffect 的 mf/vf —— 模型自己寫一份份額公式就是「bal 說平衡、打起來不是」)。
 */
function ufFrom(A, B, f, until) {
  const ad = A.add || {};
  const mf = (m) => 1 + (m - 1) * f, vf = (v) => v * f;
  const uf = {
    until, dmgF: 1, takenF: 1, reloadF: 1,
    evade: 0, speedF: 1, rangeF: 1, regenF: 1, vamp: 0, noReload: false, brk: !!A.brk,
  };
  if (A.fx === 'stealth') {
    // m08「查無此人」:匿蹤本身(不可鎖定)本模型看不到 —— 這裡只兌現**破隱爆發窗**。
    // 伺服器的窗開在「開火現形」那一刻;本模型的機體恆在開火 ⇒ 就位即開窗(窗長由呼叫端給)。
    uf.dmgF = B.alphaX;
    return uf;
  }
  if (A.mul?.dmg) uf.dmgF = mf(A.mul.dmg + B.dmgMul);   // 補償是**增額**不是再乘一層(對齊 sim._castEffect)
  if (A.mul?.dmgTaken) uf.takenF = mf(A.mul.dmgTaken);
  if (A.mul?.reload) uf.reloadF = mf(A.mul.reload);
  if (A.mul?.speed) uf.speedF = mf(A.mul.speed);
  if (A.mul?.range) uf.rangeF = mf(A.mul.range);
  if (A.regen > 0) uf.regenF = mf(A.regen);
  if (ad.fx === 'haste') uf.speedF = mf(ad.f || 1);
  if (ad.fx === 'evade') uf.evade = vf(ad.evade || 0);
  if (ad.fx === 'vamp') uf.vamp = vf(ad.f || 0);
  if (ad.fx === 'overdrive') { uf.noReload = true; uf.evade = vf(ad.evade || 0); }
  return uf;
}

/** 依**目前在線架數**重算這一段加成(對齊 sim._supSync;全滅 ⇒ 整份下線) */
function supSync(M, live, t) {
  const g = M.sup;
  if (!g || g.tempo === 'burst') return;           // 瞬發型沒有時窗可供輸(交付完就退場)
  if (live <= 0) { M.uf = null; return; }
  // 匿蹤的爆發窗長度是 ALPHA_S 而不是 dur(伺服器同語意:同一份預算換一個更短更硬的窗)
  const until = g.A.fx === 'stealth' ? (g.armAt ?? t) + SELF_ULT.ALPHA_S : g.until;
  M.uf = ufFrom(g.A, g.B, supportF(M.ch, live), until);
}

/** 瞬發型輔助機就位:交付自己那一份(s11 大修 —— 治療 X 點 = 抵銷 X 點傷害) */
function supDeliver(M, frac) {
  const g = M.sup;
  if (!g) return;
  const before = M.hp + M.sp;
  M.hp = Math.min(M.maxHp, M.hp + (g.A.heal + g.B.heal) * frac);
  if (g.A.sp) M.sp = Math.min(M.maxSp, M.sp + M.maxSp * frac);
  M.ultBy.healed += (M.hp + M.sp) - before;
}

/**
 * 自身強化型大招(9 台)= 派出 `supportN` 架**跟隨玩家的輔助機**(2026-08-07 使用者定案)。
 * 效果一律經 `data.js selfUltBoost` 這一個縫取增額 —— 模型自己算一份就是「bal 說平衡、打起來不是」
 * (症狀只會出現在補償那幾台身上,而且沒有任何錯誤訊息)。
 * 輔助機 MUST 當**真的實體**跑(進 foesOf ⇒ 敵方砲塔/小兵/機體都打得到它)—— 這一輪改制的
 * 全部代價就在這裡:少幾架就少幾份加成,而模型看不到它就等於改制沒有發生。
 */
function castSelfUlt(M, foe, enemyTower, t, foes, ownFort) {
  const A = heroAbility(M.ch, 'ult', 1);
  if (M.mp < A.mp) return [];
  // ---- 施放時機:兩道閘,少一道這一招在模型裡就是**淨損** ----
  // ①**交戰中才放**(射程內有敵人):舊制的 `castAbil` 靠「reach 內有 aim」天然擋住開場空放,
  //   自身型沒有落點也就沒有那道閘 ⇒ t = 0 站在射程外就把 A.mp(75~85)倒掉,重武器接下來
  //   好幾秒開不了火。實測 t02/t04/m01/m04 的鏡像對照組因此**放大招的那一側必敗**(0%),
  //   而那量到的是「模型在空放」,不是這一招不好。
  // ②**補血型等真的掉血**(門檻鏡射 bots._castSupport 的 `hurt = frac < 0.55`):滿血放掉的
  //   治療量會被 `Math.min(maxHp, …)` 整份吃掉,帳上卻仍記一次施放 ⇒ ⑦f 讀成「兌現 0」。
  const engaged = (foe.hp > 0 && dist(M, foe) - hitR(foe) <= M.maxRange)
    || (enemyTower && dist(M, enemyTower) - hitR(enemyTower) <= M.maxRange)
    || foes.some((e) => !e.tower && !e.vehicle && e.hp > 0 && dist(M, e) - hitR(e) <= M.maxRange);
  if (!engaged) return [];
  if (A.fx === 'heal' && (M.hp + M.sp) >= (M.maxHp + M.maxSp) * LANE.HEAL_FRAC) return [];
  const B = selfUltBoost(M.ch, 1, abilOf(M));
  M.mp -= A.mp;
  M.abilAt = t + A.cd;
  M.ultN++;
  const n = supportN(M.ch);
  M.uf = null;                                        // 舊時窗先下線(輔助機還沒就位 = 還沒供輸)
  M.sup = {
    A, B, n, tempo: selfUltTempo(M.ch), armAt: null,
    // 效果窗由**第一架就位**那一刻起算(對齊 sim._supArm 的 `g.until ??=`)——
    // 施放當下就定死的話,工事離施放者遠一點就在半路到期 = 這一招永遠交付不到。
    until: null, cleanse: !!A.cleanse,
  };
  M.carN += n;   // 輔助機同樣是「送出去幾份」——⑦f 自身型組另量 EHP,這一欄留給交叉比對
  // 2026-08-07:大招自**最近的我方工事**出發,飛向主機才就位 ⇒ 投放腿是實距(離前線越深越久,
  // 而且整段都在敵方火力下)。生成點 MUST 真的在工事上:寫成 M.x 的話這一輪改制在模型裡不存在。
  const ox = ownFort ? ownFort.x : M.x;
  return Array.from({ length: n }, (_, i) => ({
    side: M.side, owner: M, vehicle: true, sup: true, kind: 'kami', armor: 0,
    hp: supportHp(M.ch, 1), speed: supportSpeed(), tgt: { hp: 0 },
    x: ox, y: M.y + (n === 1 ? 0 : (i - (n - 1) / 2) * SQUAD.KAMI.SIDE),
    tx: M.x, ty: M.y, trav: 0, armed: false, uFrac: 1 / n,
  }));
}

/**
 * converted 角色的長按 = 大招載具(2026-08-06):同形式載具(kami×N / 轟炸機 / 飛彈)點遞送,
 * payload = 大招效果(strike 傷害 / heal 自補 / dmgTaken 減傷 / emp 武器離線 / summon 加兵),
 * **效果取代傷害** ⇒ 引爆不再吃 kamiBlast/decoyBlast/hyperBlast。落點發射當下烤死(pt 模式,
 * 不追蹤 —— 對齊 sim._launchUltCarrier);擊落 = 該份否定(無殉爆、無補投)。
 * CD = ultCarrierCd 解析值([30,60]s)、MP = 大招電力(與重武器搶同一池 —— 正式對局同構)。
 */
function castUltCarrier(M, foe, enemyTower, t, foes, ownFort) {
  const kind = ABIL_KIND[M.kind];
  const A = heroAbility(M.ch, 'ult', 1);
  if (M.mp < A.mp) return [];
  const offensive = A.fx === 'strike' || A.fx === 'emp' || A.fx === 'summon';
  let tx, ty;
  if (offensive) {
    // 選敵序同 castAbil(機體 > 最近 NPC > 塔);遞送距離 = 大招射程(支援型預設已在 heroAbility 補上)
    const reach = A.range || hyperRange();
    const inR = (e) => dist(M, e) - hitR(e) <= reach;
    let aim = foe.hp > 0 && inR(foe) ? foe : null;
    if (!aim) {
      let td = Infinity;
      for (const e of foes) {
        if (e.tower || e.hero || e.vehicle) continue;
        const d = dist(M, e);
        if (d - hitR(e) <= reach && d < td) { td = d; aim = e; }
      }
    }
    if (!aim && enemyTower && inR(enemyTower)) aim = enemyTower;
    if (!aim) return [];
    tx = aim.x; ty = aim.y;
  } else {
    // 支援型(heal/buff):對自身施放 —— 遞送點 = 面前 MIN_LEG(對齊 sim 的最短飛行腿)
    tx = M.x + M.dir * ULT_CARRIER.MIN_LEG; ty = M.y;
  }
  // 2026-08-07:發射點 = 最近的我方工事(不是機體自己)。載具因此要先飛完「工事 → 落點」
  // 這一整段,而它從第一格起就是敵方砲塔/小兵/機體打得到的實體 ⇒ ⑦f 的交付率會跟著掉,
  // 那正是這一輪改制要量的東西。MUST NOT 保留舊的 `x: M.x`(改制在模型裡就不存在了)。
  const ox = ownFort ? ownFort.x : M.x;
  M.mp -= A.mp;
  M.abilAt = t + A.cd;
  M.abilN++;
  const n = ultParts(M.kind, A.fx);
  // 交付率的分母(bal ⑦f 的載具組):送出去幾份 —— 抵達幾份在 ultDetonate 那一頭記。
  // `carNom` 只有 strike 有意義(名目爆風預算),它同時是 SELF_ULT.REALIZED_F 的量測面:
  // 「同一批載具帶著**傷害** payload,實得 ÷ 名目」正是被移除的機種絕招那個實得率的直接類比。
  M.carN += n;
  M.carNom += A.fx === 'strike' ? A.dmg * A.count : 0;
  const divis = A.fx === 'strike' || A.fx === 'summon';
  const part = (i) => ({ uA: A, uFrac: 1 / n, uImp: divis ? ultPartN(A.count, n, i) : null });
  const base = { side: M.side, owner: M, vehicle: true, armor: 0, tgt: { hp: 0 }, tx, ty };
  const fwd = Math.sign(tx - ox) || M.dir;   // 發射點 → 落點(散開/前伸沿這個方向)
  if (kind === 'kami') {
    const sp = UNITS.drone.speed * SQUAD.KAMI.SPEED_MUL;
    return Array.from({ length: n }, (_, i) => ({
      ...base, ...part(i), kind: 'kami', hp: kamiHp(), speed: sp, dieAt: t + SQUAD.KAMI.TTL_S,
      x: ox + fwd * SQUAD.KAMI.FWD, y: M.y + kamiSide(i) * SQUAD.KAMI.SIDE,
    }));
  }
  if (kind === 'decoy') {
    return [{
      ...base, ...part(0), kind: 'decoy', hp: decoyHp(), speed: DECOY.SPEED, dieAt: t + DECOY.TTL_S,
      x: ox, y: M.y, uDrops: Array.from({ length: n }, (_, i) => part(i)), nextBomb: t,
    }];
  }
  const arcD = Math.max(1, Math.hypot(tx - ox, ty - M.y));
  return [{
    ...base, ...part(0), kind: 'hyper', hp: hyperHp(), speed: hyperClimbVx(), x: ox, y: M.y, x0: ox, y0: M.y,
    arcD, trav: 0, dive: hyperApex(arcD) / hyperDiveSpd(), chase: false,
  }];
}

/** 大招 payload 的落點施放(lanesim 端的 _castEffect 鏡射;只模型化模型量得到的量) */
function ultDetonate(M, A, cx, cy, frac, nImp, t, foes, ctx) {
  M.carHit++;   // 這一份真的飛到了(交付率的分子;每呼叫一次 = 一份 payload 抵達)
  if (A.fx === 'strike') {
    const def = { dmg: A.dmg, r: A.r, vs: A.vs, pen: A.pen, vsSp: A.vsSp, vsHp: A.vsHp, spPierce: A.spPierce };
    for (let i = 0; i < (nImp ?? A.count); i++) detonate(M, def, cx, cy, t, foes);   // detonate 吃 tw 擾動 + 分桶記帳
  } else if (A.fx === 'heal') {
    if (Math.hypot(M.x - cx, M.y - cy) <= A.r) {
      const before = M.hp + M.sp;
      M.hp = Math.min(M.maxHp, M.hp + A.heal * frac);
      if (A.sp) M.sp = Math.min(M.maxSp, M.sp + M.maxSp * frac);
      M.ultBy.healed += (M.hp + M.sp) - before;
    }
  } else if (A.fx === 'buff') {
    // 團隊 buff 的減傷與自身型大招共用同一份時窗紀錄(`uf`)—— 兩份紀錄就會有一份被另一份蓋掉,
    // 而症狀只是「這一招的減傷有時候沒生效」
    if (Math.hypot(M.x - cx, M.y - cy) <= A.r && A.mul?.dmgTaken) {
      M.uf = { until: t + A.dur, dmgF: 1, takenF: A.mul.dmgTaken, reloadF: 1,
        evade: 0, speedF: 1, rangeF: 1, regenF: 1, vamp: 0, noReload: false, brk: false };
    }
  } else if (A.fx === 'emp') {
    for (const e of foes) {
      if (e.tower || e.vehicle) continue;   // 工事免疫(對齊 sim heroCast emp 分支)
      if (Math.hypot(e.x - cx, e.y - cy) > A.r) continue;
      e.empUntil = Math.max(e.empUntil || 0, t + A.dur);
    }
  } else if (A.fx === 'summon') {
    ctx?.spawnSummon?.(M.side, A, nImp ?? A.count, cx);
  }
}

/**
 * 每格推進所有在空載具:飛行 → 逐份投遞 / 撲擊 / 俯衝 → 引爆或被擊落。
 * 2026-08-06 機種絕招退場後,在空載具**只剩大招載具**一種 ⇒ 被擊落的收尾也只剩一條規則:
 * **該份完全否定**(kami 無殉爆、轟炸機不補投、飛彈本就不引爆)。三種形式分得出高下的地方
 * 因此換成了「**幾份飛得到**」:kami 魚貫(擊落幾架少幾份)、轟炸機逐批(剩下的整批沒了)、
 * 飛彈全有或全無 —— 這正是 ⑦f 載具組量的那個交付率。
 * 回傳仍在空中的載具(死的/引爆的當格移除)。
 */
function stepAbils(vehicles, t, dt, foesOf, ctx = null) {
  const alive = [];
  for (const v of vehicles) {
    const foes = foesOf(v.side);
    const M = v.owner;
    if (v.hp <= 0) { if (v.sup && v.owner) v.owner.supLost = (v.owner.supLost || 0) + 1; continue; }   // 被擊落 = 該份完全否定(對齊 sim 的四條 uA 引爆路徑)
    // 跟隨型輔助機(2026-08-07):飛完投放腿才就位供輸,之後貼著主機 —— 被打下來就少一份加成。
    // 位置 MUST 真的跟著主機:停在原地的話它會被留在後方,前線的火力永遠打不到它 = 改制沒有發生。
    if (v.sup) {
      if (!v.armed) {
        // 投放腿:自工事**飛向主機**(2026-08-07)—— 到得了才就位。腿長是實距不是固定值,
        // 而整段航程都在場上(進 foesOf)⇒ 「從後方召喚」的代價就在這一段的曝險。
        const dxS = M.x - v.x, stepS = v.speed * dt;
        v.trav += stepS;
        if (Math.abs(dxS) <= stepS) {
          v.x = M.x; v.y = M.y;
          v.armed = true;
          M.sup.armAt ??= t;
          M.sup.until ??= t + (M.sup.A.dur || 0);     // 效果窗自就位起算(對齊 sim._supArm)
          if (M.sup.cleanse) M.empUntil = 0;          // 解除異常:本模型只有 EMP 一種(一次性)
          if (M.sup.tempo === 'burst') { supDeliver(M, v.uFrac); continue; }   // 交付完退場
        } else v.x += Math.sign(dxS) * stepS;
        alive.push(v); continue;
      }
      v.x = M.x; v.y = M.y;
      if (t >= (M.sup?.until ?? Infinity)) continue;
      alive.push(v); continue;
    }
    // 追蹤:對象還活著就更新落點(射後不理 —— 玩家不必維持鎖定)。
    // **極音速飛彈是例外**(2026-08-05 使用者定案的終端追擊射程,與 sim._tickHypers 同一條規則):
    // 前 2/3(爬升)一律不追,後 1/3 也只有通過 hyperTrackR() 判定的那一發才追 ⇒ 這一招的
    // 實得傷害要算得準,就 MUST 把「目標跑掉、飛彈打在原地」也模型化(否則它在模型裡永遠命中)。
    if (v.tgt.hp > 0 && (v.kind !== 'hyper' || v.chase)) { v.tx = v.tgt.x; v.ty = v.tgt.y; }
    if (v.kind === 'hyper') {
      if (v.trav < v.arcD) {                           // 相位一:拋物線爬升(水平等速)
        v.trav = Math.min(v.arcD, v.trav + v.speed * dt);
        const f = v.trav / v.arcD;
        v.x = v.x0 + (v.tx - v.x0) * f; v.y = v.y0 + (v.ty - v.y0) * f;
        // 頂點 = 後 1/3 的入口:目標仍在原定落點的 hyperTrackR() 內才轉螺旋追擊(只判這一次)
        if (v.trav >= v.arcD) {
          v.chase = v.tgt.hp > 0 && Math.hypot(v.tgt.x - v.tx, v.tgt.y - v.ty) <= hyperTrackR();
        }
        alive.push(v); continue;
      }
      v.dive -= dt;                                    // 相位二:極音速俯衝(頂點在目標正上方)
      v.x = v.tx; v.y = v.ty;
      if (v.dive > 0) { alive.push(v); continue; }
      ultDetonate(M, v.uA, v.tx, v.ty, v.uFrac, v.uImp, t, foes, ctx);
      continue;
    }
    // kami / decoy:朝落點直飛
    const dx = v.tx - v.x, dy = v.ty - v.y, d = Math.hypot(dx, dy) || 1;
    const step = Math.min(d, v.speed * dt);
    v.x += dx / d * step; v.y += dy / d * step;
    if (v.kind === 'kami') {
      if (d - step <= SQUAD.KAMI.BOOM_M || t >= v.dieAt) {   // 撲擊命中 / 燃料耗盡自毀
        ultDetonate(M, v.uA, v.x, v.y, v.uFrac, v.uImp, t, foes, ctx);
        continue;
      }
      alive.push(v); continue;
    }
    // 大招轟炸機:進 BOMB_R 起逐份投遞(間斷型);投完短暫飛離解體(不撞擊自爆、不補投)。
    // 下一份的時刻 MUST 由**這一份投出的當下**起算(`= t + GAP`,不是 `+= GAP`):
    // 巡航到接敵之間投不出去,`nextBomb` 會停在生成時刻;累加式一進 BOMB_R 就會在同一格
    // 把積欠的間隔一次補完 = 整批同時落地(正式對局是每 GAP 秒一份)。
    if (v.uDrops.length && t >= v.nextBomb && d <= DECOY.BOMB_R) {
      const p = v.uDrops.shift();
      ultDetonate(M, v.uA, v.tx, v.ty, p.uFrac, p.uImp, t, foes, ctx);
      v.nextBomb = t + DECOY.BOMB_GAP;
      if (!v.uDrops.length) v.dieAt = Math.min(v.dieAt, t + 1.5);
    }
    // 收尾只認 `dieAt`(投完 +1.5s 或燃料耗盡),**MUST NOT 加「飛到落點就自爆」**——
    // 那是機種絕招時代的集束轟炸機(撞擊自爆 + 補投一顆),而載具轟炸機在 sim._tickDecoys
    // 是**留在落點逐批投完**才解體。舊條件留著 = 第一份投出去的當格就把飛機收掉,
    // 剩下的份全數作廢 ⇒ 實測交付率只有 35%(kami 90% / hyper 82%),而那是模型自己弄丟的。
    if (t >= v.dieAt) continue;
    alive.push(v);
  }
  // 輔助機隊:每一格依**在線架數**重算加成(對齊 sim._supSync)。名冊取**這一格開頭**的 vehicles
  // (含這一格剛被打下來的那幾架)⇒ 最後一架陣亡的當格就會把加成收掉;下一格起場上已經沒有
  // sup 載具,也就不需要再算(M.uf 已經是 null)。
  const supOwners = new Set(vehicles.filter((v) => v.sup).map((v) => v.owner));
  for (const M of supOwners) {
    supSync(M, alive.filter((v) => v.sup && v.owner === M && v.armed).length, t);
  }
  return alive;
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

  // 在空的長按攻擊載具(飽和攻擊護衛機 / 集束轟炸機 / 極音速飛彈)——**進 foesOf**:
  // 敵方砲塔/小兵/機體都打得到它,擊落也照付賞金(它們在正式對局裡就是合法目標)。
  let vehicles = [];
  // 大招載具的 summon payload:單位就地投入(落點起沿兵線推進;血量/火力/速度取自 UNITS)
  const ctx = {
    spawnSummon: (side, A, count, cx) => {
      const dir = side === 'SWARM' ? 1 : -1;
      const comp = A.unit === 'squad'
        ? Array.from({ length: count }, (_, i) => (i % 3 === 2 ? 'rocketeer' : 'soldier'))
        : Array(count).fill(A.unit);
      comp.forEach((kind, i) => {
        const u = UNITS[kind];
        creeps.push({
          kind, side, dir, t0: t, x: cx - dir * i * 6, y: LANE.LAT_M * ((i % 3) - 1),
          hp: u.hp, armor: u.armor, speed: u.speed, next: 0,
        });
      });
    },
  };
  const foesOf = (side) => [
    ...creeps.filter((c) => c.side !== side && c.hp > 0),
    ...vehicles.filter((v) => v.side !== side && v.hp > 0),
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
      if ((c.empUntil || 0) > t) continue;   // 大招 EMP:武器離線(仍會推進,對齊 sim)
      if (t < c.next) continue;
      c.next = reFire(c.next, t, 1 / u.rate);
      const wd = { pen: 0, vs: {} };
      if (tgt.hero) { tgt.hurtT = t; }
      damage(tgt, u.dmg, wd, false, t);
    }
    // ---- 砲塔 ----
    for (const side of ['SWARM', 'STEEL']) for (const T of tw[side]) {
      if (T.hp <= 0 || t < T.next) continue;
      const foes = foesOf(side);
      let tgt = null, td = Infinity;
      for (const e of foes) { const d = dist(T, e) - hitR(e); if (d <= UNITS.tower.range && d < td) { td = d; tgt = e; } }
      if (!tgt) continue;
      T.next = reFire(T.next, t, 1 / UNITS.tower.rate);
      if (tgt.hero) tgt.hurtT = t;
      damage(tgt, UNITS.tower.dmg, { pen: 0, vs: {} }, false, t);
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
      // 大招載具的**發射點**(2026-08-07 使用者定案「從最近的砲塔或主堡召喚」):本模型場上
      // 只有自家前線塔位;全滅就退回自家開場站位(= 主堡方向那一端)。少了這一段,模型裡的
      // 大招仍是「就地生成」⇒ 這一輪改制在 ⑦f 上完全看不見(交付率不會動)。
      const ownFort = tw[M.side].filter((x) => x.hp > 0)[0] || { x: M.x0 };
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
      const U = ufAt(M, t);
      const step = Math.min(M.mob * (U ? U.speedF : 1) * LANE.DT, Math.abs(want - M.x));
      M.x += Math.sign(want - M.x) * step;
      fire(M, foe, enemyTower, t, foes);
      // 長按 = 大招:CD 到就放(載具組送載具 / 自身型組就地開窗,見 castAbil)
      vehicles.push(...castAbil(M, foe, enemyTower, t, foes, ownFort));
      // 電力 / 護盾回復(脫戰 OOC_S 後回盾)+ 有錢就升級
      M.mp = Math.min(M.mp0, M.mp + M.mpRegenBase * M.chF * LANE.DT);
      const rg = U ? U.regenF : 1;
      if (t - M.hurtT >= VITALS.OOC_S) {
        const b4 = M.sp;
        M.sp = Math.min(M.maxSp, M.sp + M.maxSp * VITALS.SP_REGEN_PS * M.chF * rg * LANE.DT);
        if (rg > 1) M.ultBy.healed += (M.sp - b4) * (1 - 1 / rg);   // 加速的那一份才是這一招換來的
      }
      // 復甦(s12 rally):裝甲平時只有主堡修得回來,時窗內**全場都修**(對齊 sim 的 rally 分支)
      if (rg > 1 && M.hp < M.maxHp) {
        const b4 = M.hp;
        M.hp = Math.min(M.maxHp, M.hp + UNITS[M.kind].regen * rg * LANE.DT);
        M.ultBy.healed += M.hp - b4;
      }
      buyUp(M);
    }
    // ---- 在空載具:飛行 → 投彈/撲擊/俯衝 → 引爆或被擊落 ----
    vehicles = stepAbils(vehicles, t, LANE.DT, foesOf, ctx);
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
  // 長按 = 大招的量測帳(bal ⑦f)。三組數字各回答一個問題:
  //   n / hero / tower / creep —— 載具組帶**傷害** payload 時實得多少 EHP(分桶,見 detonate);
  //   carN / carHit / carNom  —— 載具**份額**送出幾份、飛到幾份、名目預算多少(交付率 + REALIZED_F);
  //   supLost                 —— 輔助機被擊落幾架(自身型組的改制代價;恆 0 = 模型裡沒有現形);
  //   ultN / dealt·prevented·healed —— 自身型組的補償兌現(EHP 當量)。
  const abilOf2 = (M) => ({
    n: M.abilN, dmg: M.abilDmg, ...M.abilBy,
    carN: M.carN, carHit: M.carHit, carNom: M.carNom, supLost: M.supLost || 0,
    ultN: M.ultN, ...M.ultBy,
  });
  return {
    win, t, why, leftA, leftB, towA: towLeft('SWARM'), towB: towLeft('STEEL'),
    abilA: abilOf2(A), abilB: abilOf2(B),
  };
}

/** A 對 B 的勝率(本模型確定性 ⇒ 單場即結論;取雙向平均消掉「誰站 SWARM 端」的位置偏差) */
export function laneWin(chA, chB, twA = null, twB = null) {
  return (laneBattle(chA, chB, twA, twB).win + (1 - laneBattle(chB, chA, twB, twA).win)) / 2;
}

/**
 * 全角色矩陣;回傳 { rate[a][b], avg[a], stat, abil }。
 * stat = { n, med, p90, timeout } —— 對局長度與逾時率(使用者「測試時間越短越好」的量測面)。
 * abil[ch] = { n, dmg, hero, tower, creep, games } —— 長按攻擊的實得帳(全矩陣累計;bal ⑦f 的量測面)。
 * 逐對只跑一次(rate[b][a] = 1 − rate[a][b]),但每一對仍打**雙向**兩場以消掉位置偏差。
 */
export function laneMatrix(chs = Object.keys(CHARACTERS)) {
  const rate = {}, ts = [], abil = {};
  let timeout = 0;
  const BUCKETS = ['n', 'dmg', 'hero', 'tower', 'creep',
    'carN', 'carHit', 'carNom', 'supLost', 'ultN', 'dealt', 'dealtEff', 'prevented', 'healed'];
  for (const a of chs) { rate[a] = {}; abil[a] = Object.fromEntries(BUCKETS.map((k) => [k, 0])); }
  const tally = (ch, r) => { for (const k of BUCKETS) abil[ch][k] += r[k]; };
  for (let i = 0; i < chs.length; i++) for (let j = i + 1; j < chs.length; j++) {
    const a = chs[i], b = chs[j];
    const r1 = laneBattle(a, b), r2 = laneBattle(b, a);
    for (const r of [r1, r2]) { ts.push(r.t); if (r.why === 'timeout') timeout++; }
    tally(a, r1.abilA); tally(b, r1.abilB); tally(b, r2.abilA); tally(a, r2.abilB);
    const w = (r1.win + (1 - r2.win)) / 2;
    rate[a][b] = w; rate[b][a] = 1 - w;
  }
  for (const a of chs) abil[a].games = 2 * (chs.length - 1);   // 每角在矩陣裡打過幾場(每對雙向兩場)
  const avg = Object.fromEntries(chs.map((a) => {
    const v = Object.values(rate[a]);
    return [a, v.reduce((s, x) => s + x, 0) / v.length];
  }));
  ts.sort((x, y) => x - y);
  return { rate, avg, abil, stat: { n: ts.length, med: ts[ts.length >> 1], p90: ts[Math.floor(ts.length * 0.9)], timeout: timeout / ts.length } };
}
