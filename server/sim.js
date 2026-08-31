// ============ 戰場模擬(伺服器權威)============
// DOTA 式三路兵線:小兵(步兵/裝甲車/坦克)沿真實道路路徑推進,
// 防禦塔與主堡自動迎擊;英雄(無人機/機甲)位置由客戶端回報、
// 血量與傷害由伺服器結算。座標系:以戰場中心為原點的公尺平面
// (x 東、z 北;y 高度只在客戶端管,模擬是 2D 平面 + 兵線路徑)。
import {
  SIDES, OTHER_SIDE, UNITS, GAME, WEAPONS, STRUCT_W, BASE_MISSILE, ECON, HAZARDS, FIELD, LOOT, AIRDROP, AFFIXES,
  CHARACTERS, charsOf, heroKindOf, heroWeapon, heroAbility, VITALS, armorMul, battleScoreGain, addBattleScore, tierVal,
  vsMult, upgradePrice, upgradeScore, chargeF, heavyMpCost, laneTacticsXZ, SQUAD, MORPH, LOCK, DECOY, DECOY_BOMB, MORPH_BOMB, HYPER, heroArmor, isBotId,
  kamiBlast, selfBoomBlast, decoyBlast, decoyBombBlast, hyperBlast, hyperRange, hyperDiveSpd,
  hyperClimbVx, hyperArcY, hyperTrackR,
  kamiSide, kamiHp, decoyHp, hyperHp, airSinkM,
  ULT_CARRIER, ultDelivered, ultParts, ultPartN, SELF_ULT, selfUltBoost,
  ULT_SUPPORT, supportN, supportHp, supportLegS, abilTempo, abilOrigin, VISION_BLIND,
  dmgFalloff, blastFalloff, offAxisFalloff, fanArcHalf, fanConeHalf, battleRect, llToXZ, solveTowerSites, shieldSplit,
  SIEGE, siegeSiteStages, siegeOpenStage, siegeTalkS, allyBotDmgF, mapArg, siteCPs,
  BOSS, bossSegOf, bossSegCapF, bossSlotPlan, bossSlotOff, bossZoneR, bossHealF, bossInvulnS, bossScaleF,
  aoeClass, trajClass, lanceR, LANCE, lobMinRange, flightCapS, chaseCapS, shotFlightS, shotTrailS, blastCoreR,
  EVASION, evadable, evadeCompF, heroMobility, evasionMinSpeed, LOS, IFRAME, THIRD, CIVILIAN, CIVILIANS, civSpeed, hitH, hitR,
  HIGH_SUP, highSupF, highSupDodgeF, highSupMissP, unbalMissP,
  selfCollider, COLLIDE_KINDS,
  ALTITUDE, altScale, altRangeF, altRangeMax, RANGE_TOL, HGT_CHARS, HGT_STEP, WATER, TERRAIN_FX, fluidFactor, offGround, airUnit,
  waveComp, waveSpacingM, CREEP_UPG, creepUpgMul, creepDmgTakenF, BOT_TACTIC, botThreatDecay, FLIGHT,
} from '../public/js/data.js';

let nextEntId = 1;

// 小隊共用的「玩家狀態」:一名玩家不論操控幾架機體,經濟/電力/彈藥/招式只有一份。
// 三架機體各自是獨立 ent(有自己的 hp/護盾/座標/死亡狀態),但這些欄位透過
// getter/setter 指回同一個 sq.ps —— 讓既有的 h.money / h.abil / h.ammo 全部原樣可用。
// dmgOut(累計輸出)同樣共用:一名玩家不論操控幾架機體,「這個人打出多少傷害」只有一份帳 ——
// 逐機體各記一份的話,三架均分的小隊在電腦玩家眼裡永遠不是輸出核心(見 _dmgOut)。
const SQUAD_SHARED = [
  'money', 'upg', 'ammo', 'reloadUntil', 'fireAt', 'buffs', 'mp', 'maxMp', 'mpRegen',
  'abil', 'acd', 'kn', 'mods', 'empUntil', 'stealthUntil', 'aiming', 'lastBurst', 'markUntil',
  'dmgOut', 'unbalUntil',
  // 純自身型大招補償(2026-08-06;見 data.js SELF_ULT):免裝填時窗與破隱爆發窗都是**小隊共用**——
  // 彈匣本來就只有一份(ammo/reloadUntil 在上面),免裝填逐機體各記一份就會出現「主視野機免裝填、
  // 僚機照裝填」這種只有拿碼表才量得出來的分歧。
  'noReloadUntil', 'alphaArm', 'alphaX', 'cast',
];

// ---- tick 內加速結構(2026-08-05 手機單機效能:索敵/推擠原是 O(N²) 全掃,實測佔 tick 近九成)----
// 網格與分桶只在 tick() 內存在(tick 尾清空):tick 之外的直接呼叫(訊息處理/e2e 直測)
// 一律退回原全掃路徑,行為逐位元同舊制 —— 位置在 tick 之間仍會變(heroPos 訊息/測試瞬移),
// 過期網格 MUST NOT 留用。格寬/週期只影響效能;索敵合法性仍逐候選走 _tgBlockedD 單一縫。
const TG_CELL = 96;      // 索敵網格格寬(m):最長射程(塔 310 × altRangeMax)的查詢圈也只掃 ~9×9 格
const TG_OFF = 2048, TG_SPAN = 4096;   // 格座標 → 單一整數鍵(±2048 格 ≈ ±196km,遠大於任何戰場)
const TG_RESCAN = 2;     // 索敵快取強制重掃週期(tick):黏著窗 ≤ 2×125ms,克制/英雄偏好的重排語意保留

/** 經緯度 → 以 center 為原點的「遊戲世界」公尺平面(等距圓柱,5km 內誤差可忽略)。
 *  投影本體(含比例尺與**地圖主方位旋轉**)只有 `data.js llToXZ` 一份 —— 本支只負責
 *  **z 鏡射**:客戶端框 z = 南、伺服器框 z = 北(A30)。
 *  ⚠ 鏡射同時把旋轉共軛成反向 ⇒ 這裡 MUST 只是 `[x, -z]`,MUST NOT 自己再套一次 `rotXZ`
 *  (套同號 = 兩端世界差 2θ,而畫面上只表現成「塔的位置對不上 / 打得到卻沒傷害」)。 */
export function llToMeters(lat, lng, center) {
  const [x, z] = llToXZ(lat, lng, center);
  return [x, -z];
}

function dist2d(ax, az, bx, bz) { return Math.hypot(ax - bx, az - bz); }
/** 點 (px,pz) 是否落在 slab ribbon 中心線 [s0,s1]→[s2,s3] 的半寬 hw 內(#1 橋面/隧道天花 LOS)*/
function ptOnRibbon(px, pz, s) {
  const ex = s[2] - s[0], ez = s[3] - s[1], L2 = ex * ex + ez * ez || 1;
  let t = ((px - s[0]) * ex + (pz - s[1]) * ez) / L2;
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  const dx = px - (s[0] + ex * t), dz = pz - (s[1] + ez * t);
  return dx * dx + dz * dz <= s[4] * s[4];
}

/**
 * 隧道側牆判定:洞內端 (ix,iz) → 洞外端 (ox,oz) 的線段,在隧道 ribbon 局部矩形
 * [0,L]×[−hw,hw](L=軸長、hw=半寬)中,是「先由側牆(|d|=hw)離開」還是「先由洞口
 * (s=0 / s=L)離開」。Liang–Barsky:洞內端在框內,比較沿軸 / 垂距兩維各自離框的 τ,
 * 較小者即實際離開的那條邊。伺服器無地形高程,以此 2D 幾何近似「山體擋線」。
 * 回傳離開分類(2026-07-30 明隧道柱列改制):
 *   0 沿軸出洞口(隧道兵線正常對射,放行)
 *   1 由實牆側穿出(穿山體岩盤/深埋側牆,擋)
 *   2 由明隧道開放側穿出(柱間透明可見可穿透,放行)—— s[6] gal 位元遮罩,
 *     bit1(值 1)= 垂距 + 側、bit2(值 2)= − 側;側別在 z 鏡射上傳下不換手
 *     (偏移向量與軸向的 z 分量同時反號,叉積符號不變;audit_open_tunnel Ⅳ 直測)。
 */
function tunnelSideExit(ix, iz, ox, oz, s) {
  const x1 = s[0], z1 = s[1], hw = s[4];
  const ux = s[2] - x1, uz = s[3] - z1;
  const L = Math.hypot(ux, uz) || 1;
  const nx = ux / L, nz = uz / L;                    // 軸向單位向量
  const spI = (ix - x1) * nx + (iz - z1) * nz;       // 洞內端:沿軸座標
  const dpI = -(ix - x1) * nz + (iz - z1) * nx;      // 洞內端:垂距
  const ds = ((ox - x1) * nx + (oz - z1) * nz) - spI;
  const dd = (-(ox - x1) * nz + (oz - z1) * nx) - dpI;
  const tS = ds > 0 ? (L - spI) / ds : ds < 0 ? -spI / ds : Infinity;          // 離洞口(s=0/L)之 τ
  const tD = dd > 0 ? (hw - dpI) / dd : dd < 0 ? (-hw - dpI) / dd : Infinity;   // 離側牆(|d|=hw)之 τ
  if (!(tD < tS)) return 0;                          // 洞口先離開(或未離框)→ 沿軸出洞口
  return ((s[6] | 0) & (dd > 0 ? 1 : 2)) ? 2 : 1;    // 該側開放(gal)→ 柱間穿出;否則穿岩體
}

// ---------- 實體碰撞幾何(2026-08-02;bot 移動用,與客戶端 `game.js _collide`/`_sweepBlockers` 同式)----------
// 使用者定案:「電腦玩家的碰撞法則一律跟正常玩家一樣,移動與攻擊都不可穿牆穿越各種物理碰撞的物件」。
// solid 沿用 occ 的形狀 `[x, z, r, top, hw2, hd2, cs, sn, base?]`:
//   ・`hw2 > 0` = 有向盒(建物/地標;cs=cos(ry)、sn=−sin(ry),收料時算好,見 setWorld),否則圓柱(r);
//   ・`top`/`base` = 垂直帶(base 缺省 0 —— 上傳碰撞柱一律由地面起算,與 `_losBlocked` 的 [0,h] 近似同語意)。
// 兩支幾何函式是客戶端那兩段的**逐行鏡射**:同一顆盒/圓在兩端 MUST 判同一件事,
// 否則就是「真人撞得到、電腦穿得過」(碰撞版的 A30 兩端分家)。
const COL_SKIN = 0.3;   // 掃掠夾在進入面之後再退一截,免貼面(與客戶端 _sweepBlockers 同值)

/** push-out:機體圓盤(半徑 myR)與 solid 重疊時,沿最小穿透軸推出的位移;不重疊回 null */
function solidPush(o, x, z, myR) {
  if (o[4] > 0) {
    const cs = o[6], sn = o[7];
    const rx = x - o[0], rz = z - o[1];
    const lx = rx * cs + rz * sn, lz = -rx * sn + rz * cs;   // world→local(繞 −ry)
    const ex = o[4] + myR, ez = o[5] + myR;                  // Minkowski 近似:盒面外擴機體半徑
    if (Math.abs(lx) >= ex || Math.abs(lz) >= ez) return null;
    const px = ex - Math.abs(lx), pz = ez - Math.abs(lz);
    let dlx = 0, dlz = 0;
    if (px < pz) dlx = lx < 0 ? -px : px; else dlz = lz < 0 ? -pz : pz;
    return [dlx * cs - dlz * sn, dlx * sn + dlz * cs];       // local→world(繞 +ry)
  }
  const dx = x - o[0], dz = z - o[1];
  const d = Math.hypot(dx, dz);
  const min = myR + o[2];
  if (d >= min || d === 0) return null;
  return [dx / d * (min - d), dz / d * (min - d)];
}

/** 掃掠:位移 (ax,az)→(bx,bz) 是否**單幀橫越** solid;回傳進入參數 t ∈ (0,1],否則 null。
 *  終點落在 solid 內的「近半」(fwd < 0)交給 push-out 沿牆滑(手感不變),遠半才夾在進入面。
 *  `fwd === 0`(終點剛好落在通過中心的平面上)歸**遠半** —— 那一刀的最小穿透軸推出符號由
 *  `lx < 0 ? …` 決定,正中央等機率推向另一側 = 直接穿過去。客戶端 `_sweepBlockers` 同判。 */
function solidEnter(o, ax, az, bx, bz, myR) {
  const dx = bx - ax, dz = bz - az;
  const fwd = (bx - o[0]) * dx + (bz - o[1]) * dz;
  if (o[4] > 0) {
    const cs = o[6], sn = o[7];
    const ex = o[4] + myR, ez = o[5] + myR;
    const a0x = (ax - o[0]) * cs + (az - o[1]) * sn, a0z = -(ax - o[0]) * sn + (az - o[1]) * cs;
    if (Math.abs(a0x) < ex && Math.abs(a0z) < ez) return null;   // 起點已在盒內 → push-out 脫出
    const b1x = (bx - o[0]) * cs + (bz - o[1]) * sn, b1z = -(bx - o[0]) * sn + (bz - o[1]) * cs;
    if (Math.abs(b1x) < ex && Math.abs(b1z) < ez && fwd < 0) return null;
    const ux = dx * cs + dz * sn, uz = -dx * sn + dz * cs;
    let tmin = -Infinity, tmax = Infinity;
    for (const [o0, u, e] of [[a0x, ux, ex], [a0z, uz, ez]]) {
      if (Math.abs(u) < 1e-9) { if (o0 < -e || o0 > e) return null; continue; }
      let t1 = (-e - o0) / u, t2 = (e - o0) / u;
      if (t1 > t2) { const s = t1; t1 = t2; t2 = s; }
      if (t1 > tmin) tmin = t1;
      if (t2 < tmax) tmax = t2;
    }
    return (tmax >= tmin && tmin > 0 && tmin <= 1) ? tmin : null;
  }
  const R = o[2] + myR;
  const ox = ax - o[0], oz = az - o[1];
  if (ox * ox + oz * oz <= R * R) return null;                   // 起點已在圓內 → push-out 脫出
  const e1x = bx - o[0], e1z = bz - o[1];
  if (e1x * e1x + e1z * e1z <= R * R && fwd < 0) return null;
  const len2 = dx * dx + dz * dz;
  if (len2 < 1e-9) return null;
  const c = ox * ox + oz * oz - R * R;
  const B2 = 2 * (ox * dx + oz * dz);
  const disc = B2 * B2 - 4 * len2 * c;
  if (disc < 0) return null;
  const t0 = (-B2 - Math.sqrt(disc)) / (2 * len2);
  return (t0 > 0 && t0 <= 1) ? t0 : null;
}

export class BattleSim {
  /**
   * battleConfig(由房主客戶端在選址後送上來):
   * { center:{lat,lng}, bases:{SWARM:[lat,lng], STEEL:[lat,lng]},
   *   lanes:[[ [lat,lng],... ] ×3], sizeM, diagM, distM }
   */
  constructor(config, world = null) {
    this.config = config;
    this.center = config.center;
    this.t = 0;                       // 經過秒數
    this.wave = 0;
    this.nextWaveAt = GAME.FIRST_WAVE_DELAY_S;
    this.airdrops = [];               // 空投物資(時間驅動;非兵線空曠處先到先得)
    this.nextAirdropAt = AIRDROP.INTERVAL_S;
    this.civRespawns = [];            // 平民陣亡重生佇列 [{cs, spy, at}](_tickCivilians 到期補位)
    this.ents = new Map();            // id -> entity
    this.heroes = new Map();          // pid(玩家連線 id;電腦玩家為 'b1' 之類字串)-> 目前主視野機體
    this.squads = new Map();          // pid -> { bodies:[ent], act, lock, lockAt, ps }(機甲小隊只有 1 架)
    this.missiles = [];               // 防空飛彈(伺服器權威 3D 追蹤)
    this.events = [];                 // 快照間累積的事件
    this.over = false;
    this.winner = null;
    this.stats = { SWARM: { kills: 0, deaths: 0, creepKills: 0, assists: 0 }, STEEL: { kills: 0, deaths: 0, creepKills: 0, assists: 0 } };
    this._tickN = 0;                   // 快照霧戰爭:同一 tick 內多次呼叫共用同一份事件/飛彈/物資
    this._frameTickN = -1;
    // 陣營小兵強化等級(2026-07-30):**同陣營全玩家共用、不同兵線分開** ⇒ [side][laneIdx]。
    // 權威只有這一份(_creepMul 是唯一讀取縫);客戶端商店讀快照的 cu 欄(唯讀顯示),
    // 購買一律走 buy(pid, 'creep', lane)。長度於下方 this.lanes 定案後補齊。
    this.creepUpg = { SWARM: [], STEEL: [] };
    // 攻堅順序(劇情戰役專用;見 data.js SIEGE)。旗標由開房的 battleConfig 帶進來,
    // 一般對戰恆 false ⇒ 下面兩張表全空、`siegeLocked()` 恆 false = 逐位元同舊制。
    this.siege = !!config.siege;
    // 迷你地圖(見 data.js MINI):每側只有前線砲塔。旗標由開房的 battleConfig 帶進來(rooms.js
    // 已正規化成布林),一般對戰恆 false ⇒ solveTowerSites 逐位元同舊制。
    this.mini = !!config.mini;
    // 劇情戰役(見 data.js STORY_MAP):防守方 = NPC BOSS 那一邊;一般對戰恆 null。
    // 地圖型態只有 `mapArg` 一份解讀 —— 塔位 / 尺度 / 兵線數與客戶端建圖吃的是同一個入口。
    this.defSide = config.defSide || null;
    this.mapArg = mapArg(config);
    this.teamSize = config.teamSize || 0;          // BOSS 席次分配要知道敵方總人數(見 addHero)
    this.bossHold = new Map();                     // pid → { x, z, r } 活動範圍(bots._move 唯一消費端)
    this._bossSlot = { SWARM: 0, STEEL: 0 };       // 已指派的 BOSS 席次(= addHero 的到場序)
    this._siegeLeft = { SWARM: [], STEEL: [] };   // [階段] = 該方該階仍存活的建築數(_spawnStructures 填)
    this._siegeOpen = { SWARM: 0, STEEL: 0 };     // 該方目前打得動的最高階段(siegeOpenStage 推導)
    // 區域 BOSS 關卡(見 data.js SIEGE.TALK_S):[階段] = 該階仍存活的 BOSS 小隊數 / 對白解禁時刻。
    // 兩張表都在 addHero 點名(建構期還沒有英雄);沒有 BOSS 的階段恆 0 ⇒ 那一階不受本閘影響,
    // 一般對戰(無 defSide ⇒ 一名 BOSS 都沒有)整套恆為中性 = 逐位元同舊制。
    this._bossLeft = { SWARM: [], STEEL: [] };
    this._talkUntil = { SWARM: [], STEEL: [] };
    for (const s of ['SWARM', 'STEEL']) {
      this._bossLeft[s] = new Array(SIEGE.STAGES.length).fill(0);
      this._talkUntil[s] = new Array(SIEGE.STAGES.length).fill(0);
    }

    // 兵線折線轉公尺;lane[laneIdx] 方向:SWARM 主堡 → STEEL 主堡
    this.lanes = config.lanes.map((line) =>
      line.map(([lat, lng]) => llToMeters(lat, lng, this.center)));
    for (const s of ['SWARM', 'STEEL']) this.creepUpg[s] = new Array(this.lanes.length).fill(0);
    this.basePos = {
      SWARM: llToMeters(config.bases.SWARM[0], config.bases.SWARM[1], this.center),
      STEEL: llToMeters(config.bases.STEEL[0], config.bases.STEEL[1], this.center),
    };
    // 地形涵蓋範圍(與 terrain.js buildTerrain 同一份 battleRect 幾何)內縮空氣牆 40m:
    // 中立物(地雷/障礙/防空/中繼站)散布的越界防線 —— 兵線蜿蜒出對稱方框的路段,
    // 地形邊緣離兵線只有 ROUTE_EDGE_MARGIN_M(160),HAZ_LANE_MAX(300)側偏會落到地形外懸空。
    {
      // 世界方框只有 `data.js battleRect` 一份(客戶端框);伺服器框 z 鏡射 ⇒ z 上下界互換取負
      const r = battleRect(config);
      this.bounds = {
        minX: r.minX + 40, maxX: r.maxX - 40,
        minZ: -r.maxZ + 40, maxZ: -r.minZ - 40,
      };
    }

    // 水沼粗網格(2026-07-19):主機載圖時烘烤上傳 → 中立單位(平民/第三方)佈點與行動迴避。
    // MUST 在 _seedField/_seedCamps/_seedCivilians 之前吃進(初次佈點就避開水沼);
    // 未提供(e2e/headless 或房主尚未上傳)→ _wetGrid 為空,_wetAt 恆 0,佈點行為與舊版一致。
    if (world) this._ingestWorldWet(world);
    this._spawnStructures();
    this._prefillLanes();     // 開場預置兵線(MUST 在 _spawnStructures 之後:要用解出的第一座砲塔位置)
    this._seedField();
    this._seedCamps();
    this._seedCivilians();
  }

  // ---------- 世界障礙(2026-07-15:LOS 遮蔽 + 立體交通走廊淨空)----------
  /**
   * 房主客戶端上傳的世界資料(server.js 驗證來源後轉入;sim 座標 z=北):
   *   occ:[[x,z,r,h]…] 建物/神木/巨岩/橋墩碰撞柱 → 視線/彈道遮蔽(塔/NPC/命中驗證不可透視);
   *   cor:[[x1,z1,x2,z2,hw,tun]…] 隧道(tun=1,全段)/橋樑走廊 → 清除走廊內第三方障礙與地雷
   *       (地下道/隧道內只會有道路物件;橋下淨空可通行)。
   * 未上傳(e2e/無瀏覽器headless對局)→ _losGrid 不存在,LOS 遮蔽停用,行為與舊版一致。
   * 數值/數量皆夾上限:上傳資料只能「減少」可打擊目標,不會放大任何傷害。
   */
  setWorld(w) {
    if (!w || this._worldSet) return;   // 房主一份,只收一次
    this._worldSet = true;
    if (!this._wetGrid) this._ingestWorldWet(w);   // 構造時未收到(房主晚傳)→ 這裡補收(初次佈點已過,僅供重生/移動迴避)
    const occ = [];
    for (const o of Array.isArray(w.occ) ? w.occ.slice(0, LOS.MAX_OCC) : []) {
      if (!Array.isArray(o) || o.length < 4) continue;
      const [x, z, r, h] = o.slice(0, 4).map(Number);
      if (![x, z, r, h].every(Number.isFinite)) continue;
      const e = [x, z, Math.min(60, Math.max(0.5, r)), Math.min(300, Math.max(1, h))];
      // 有向盒(建物)多帶 hw2/hd2/ry:圓仍是 broad-phase(r = 外接半對角),命中改逐盒判 ——
      // MUST 與客戶端 `game.js _blockerHitT` 是**同一個**幾何體,否則客戶端算命中、伺服器算被擋,
      // 傷害會靜默蒸發(2026-07-28「打不到建築」同一族病灶)。缺欄位 = 舊格式圓柱,行為不變。
      if (o.length >= 7) {
        const [hw2, hd2, ry] = o.slice(4, 7).map(Number);
        if ([hw2, hd2, ry].every(Number.isFinite) && hw2 > 0 && hd2 > 0) {
          // cos/sin 在收料時算好存進來:_losBlocked 是 8Hz × 逐目標 × 逐格的熱路徑,
          // 每次重算三角函數等於白燒 tick 預算(與「MUST NOT 加回 per-call Set」同一條紀律)
          e.push(Math.min(60, hw2), Math.min(60, hd2), Math.cos(ry), -Math.sin(ry));   // sn 存 −sin(與客戶端同一個 local 軸慣例)
        }
      }
      occ.push(e);
    }
    // 碉堡淨空:清掉與野營重疊(BLD_CLEAR_R 內)的遮蔽柱 —— 客戶端已移除這些重疊建物,
    // 伺服器 LOS 同步不再當它們擋線(setWorld 契約:上傳資料只能「減少」遮蔽,合規)。
    this.worldOcc = this.camps?.length
      ? occ.filter((o) => !this.camps.some((c) => dist2d(o[0], o[1], c.x, c.z) < THIRD.BLD_CLEAR_R))
      : occ;
    const cor = [];
    for (const c of Array.isArray(w.cor) ? w.cor.slice(0, LOS.MAX_CORR) : []) {
      if (!Array.isArray(c) || c.length < 5) continue;
      const [x1, z1, x2, z2, hw, tun] = c.map(Number);
      if (![x1, z1, x2, z2, hw].every(Number.isFinite)) continue;
      cor.push([x1, z1, x2, z2, Math.min(20, Math.max(2, hw)), tun ? 1 : 0]);
    }
    if (cor.length) this._pruneCorridors(cor);
    this._ingestSlabs(w);
    this._ingestHgt(w);
    this._rebuildLosGrid();
  }

  /**
   * 粗高程網格(2026-08-01 使用者需求「直線攻擊與扇形攻擊要避免隔山打牛」)。
   * main.js `bakeHeightGrid` 烘烤、隨 `t:'world'` 上傳:{ minX, minZ, cell, cols, rows, minH, data }
   * (sim 座標 z=北;data = 逐格 2 個 ASCII 字元,編碼唯一縫 = data.js `HGT_CHARS`/`hgtEnc`)。
   * 未上傳(e2e/headless/舊版房主)→ `_hgtGrid` 不存在 → `_ridgeBlocked` 恆 false,行為逐位元不變。
   */
  _ingestHgt(w) {
    const m = w?.hgt;
    if (!m || typeof m.data !== 'string') return;
    const cols = Math.min(LOS.HGT_MAX, Math.max(1, Math.round(+m.cols)));
    const rows = Math.min(LOS.HGT_MAX, Math.max(1, Math.round(+m.rows)));
    const cell = +m.cell, minX = +m.minX, minZ = +m.minZ, minH = +m.minH || 0;
    if (![cols, rows, cell, minX, minZ].every(Number.isFinite) || cell <= 0) return;
    if (m.data.length < cols * rows * 2) return;   // 殘缺就整份不收(寧缺勿錯:半份網格 = 半張地圖隔山打牛)
    const code = new Int8Array(128).fill(-1);
    for (let i = 0; i < HGT_CHARS.length; i++) code[HGT_CHARS.charCodeAt(i)] = i;
    const data = new Float32Array(cols * rows);
    for (let k = 0; k < cols * rows; k++) {
      const a = code[m.data.charCodeAt(k * 2) & 127], b = code[m.data.charCodeAt(k * 2 + 1) & 127];
      if (a < 0 || b < 0) return;                  // 編碼壞掉 ⇒ 整份不收(同上)
      data[k] = minH + ((a << 6) | b) * HGT_STEP;
    }
    this._hgtGrid = { minX, minZ, cell, cols, rows, data };
  }

  /** 粗網格高程取樣(絕對高程,公尺;雙線性內插)。無網格 ⇒ null(呼叫端一律當「不知道」處理)。 */
  _hgtAt(x, z) {
    const g = this._hgtGrid;
    if (!g) return null;
    const fx = Math.max(0, Math.min(g.cols - 1, (x - g.minX) / g.cell - 0.5));
    const fz = Math.max(0, Math.min(g.rows - 1, (z - g.minZ) / g.cell - 0.5));
    const i0 = Math.floor(fx), j0 = Math.floor(fz);
    const i1 = Math.min(g.cols - 1, i0 + 1), j1 = Math.min(g.rows - 1, j0 + 1);
    const tx = fx - i0, tz = fz - j0;
    const d = g.data;
    const a = d[j0 * g.cols + i0], b = d[j0 * g.cols + i1];
    const c = d[j1 * g.cols + i0], e = d[j1 * g.cols + i1];
    return (a + (b - a) * tx) * (1 - tz) + (c + (e - c) * tx) * tz;
  }

  /**
   * 機體視線點的**絕對**高程(公尺):英雄取回報的 ay,其餘取「粗網格地表 + 離地高」。
   * `_sightY` 回的是伺服器內部那套混合框(見 `_altDh`),而稜線判定必須全程在絕對框裡跑。
   */
  _absSightY(e, yRel, x, z) {
    if (e?.hero && e.ay != null) return e.ay;
    const g = this._hgtAt(x, z);
    return (g == null ? 0 : g) + (yRel || 0);
  }

  /**
   * 稜線遮蔽:兩點之間有山擋著 ⇒ true(2026-08-01「避免隔山打牛」)。
   *
   * 只給**伺服器自己選目標**的路徑用(`heroPlasma` 錐內選人、`_lanceHits` 圓柱內選人)——
   * 客戶端回報型的攻擊(heroHit / heroBurst / heroLance 的射線端點)本來就被本端的 193²
   * 解析地形射線截斷過,再驗一次只會因為兩份解析度不同而**多擋**掉合法傷害。
   *
   * 三條保守紀律(偏差一律朝「不擋」;粗網格 vs 客戶端解析射線本來就對不齊,而少擋一發只是
   * 偶爾隔山打牛、多擋一發卻是驗證後靜默丟棄 = 玩家看得到打得到卻零傷害的 A30 家族):
   *   ① 地形 MUST 高過射線 `LOS.RIDGE_M` 才算擋(量化步長 HGT_STEP 遠小於它 ⇒ 量化誤差吃不進來);
   *   ② 兩端各跳過 `LOS.RIDGE_SKIP_M`(雙方都站在地面上,端點附近地表必然貼著射線);
   *   ③ 沒有網格(未上傳)一律放行;
   *   ④ **任一端在隧道內(lev 2)一律放行** —— 高程網格是**未開挖**的山體(洞是客戶端幾何,
   *      不在高度場裡),洞內兩機體頭頂永遠壓著一整座山 ⇒ 不豁免的話洞裡的扇形武器一發都
   *      打不出去。洞內外的隔絕本來就由 `_slabBlocked`(slabs ty=2)那一套負責,不是這裡。
   */
  _ridgeBlocked(ax, az, ayAbs, bx, bz, byAbs, ea, eb) {
    const g = this._hgtGrid;
    if (!g) return false;
    if (this._unitLev(ea) === 2 || this._unitLev(eb) === 2) return false;
    const dx = bx - ax, dz = bz - az;
    const len = Math.hypot(dx, dz);
    const skip = LOS.RIDGE_SKIP_M;
    if (!(len > skip * 2)) return false;              // 太近 ⇒ 全程都在端點豁免帶內
    const t0 = skip / len, t1 = 1 - skip / len;
    const steps = Math.min(96, Math.max(2, Math.ceil(len * (t1 - t0) / (g.cell * 0.5))));
    for (let k = 0; k <= steps; k++) {
      const t = t0 + (t1 - t0) * (k / steps);
      const h = this._hgtAt(ax + dx * t, az + dz * t);
      if (h != null && h > ayAbs + (byAbs - ayAbs) * t + LOS.RIDGE_M) return true;
    }
    return false;
  }

  /**
   * 橋面/隧道天花水平薄板(#1):main.js 房主上傳的 ribbon 平面段 [x1,z1,x2,z2,hw,ty,gal?](sim 座標,
   * ty=1 橋面 / 2 隧道天花;gal = 明隧道開放側位元遮罩,僅 ty=2 有意義,tunnelSideExit 對開放側
   * 穿出的射線/爆風放行 —— 柱間透明可見可穿透,兩端同判)。柵格化進 _slabGrid(LOS.CELL_M 格),
   * 供 _slabBlocked / _slabLevAt 查。
   * 未上傳(e2e/headless)→ _slabGrid 不存在 → slab 遮蔽停用,LOS 行為與舊版一致(確定性斷言不變)。
   */
  _ingestSlabs(w) {
    const raw = Array.isArray(w.slabs) ? w.slabs.slice(0, LOS.MAX_SLAB) : [];
    const C = LOS.CELL_M, grid = new Map();
    let n = 0;
    for (const s of raw) {
      if (!Array.isArray(s) || s.length < 6) continue;
      const x1 = +s[0], z1 = +s[1], x2 = +s[2], z2 = +s[3], hw = Math.min(20, Math.max(1, +s[4])), ty = +s[5];
      if (![x1, z1, x2, z2, hw].every(Number.isFinite) || (ty !== 1 && ty !== 2)) continue;
      const seg = [x1, z1, x2, z2, hw, ty, ty === 2 ? ((+s[6] || 0) & 3) : 0];
      const i0 = Math.floor((Math.min(x1, x2) - hw) / C), i1 = Math.floor((Math.max(x1, x2) + hw) / C);
      const j0 = Math.floor((Math.min(z1, z2) - hw) / C), j1 = Math.floor((Math.max(z1, z2) + hw) / C);
      for (let i = i0; i <= i1; i++) for (let j = j0; j <= j1; j++) {
        const k = (i + 32768) * 65536 + (j + 32768);
        let a = grid.get(k); if (!a) grid.set(k, a = []); a.push(seg);
      }
      n++;
    }
    if (n) this._slabGrid = grid;
  }

  /** 該點所在結構層(0 地面 / 1 橋面 / 2 隧道):由 ribbon 歸屬推定(NPC/bot/飛行體用)。 */
  _slabLevAt(x, z) {
    const g = this._slabGrid;
    if (!g) return 0;
    const C = LOS.CELL_M;
    const arr = g.get((Math.floor(x / C) + 32768) * 65536 + (Math.floor(z / C) + 32768));
    if (!arr) return 0;
    for (const s of arr) if (ptOnRibbon(x, z, s)) return s[5];
    return 0;
  }

  /** 單位所在層:真人英雄用客戶端回報 lev;地面工事恆 0;其餘(小兵/飛行/bot)由 ribbon 推定。
   *  2026-07-22 兩個 ribbon 誤判修正(2D ribbon 分不出「隧道內」vs「覆蓋段山頂上方」):
   *  ①飛行體(波次機/直升機/自殺機/餌機)飛行高度 ≥ 隧道淨空 ⇒ 洞內塞不下,必在山體上方
   *    = 地面層(否則飛越隧道上空的機體被判「洞內」,與洞內單位對射不吃 slab 遮蔽=穿頂互打);
   *  ②無 lane 的地面第三方(中立營地/工事)只可能佈在覆蓋段山頂(_pruneCorridors 已清洞內
   *    第三方)= 地面層;兵線單位(有 lane,含召喚)才會真的走進洞內。 */
  _unitLev(e) {
    if (!e) return 0;
    if (e.kind === 'tower' || e.kind === 'base') return 0;
    if (e.hero && e.lev != null) return e.lev;
    const fly = !!(UNITS[e.kind]?.fly || e.kind === 'heli' || e.kami || e.decoy || e.hyper);
    if (fly && (e.y || 0) >= LOS.TUN_CLEAR_M) return 0;
    if (!fly && !e.hero && e.lane == null) return 0;
    return this._slabLevAt(e.x, e.z);
  }

  /**
   * 橋面/隧道天花薄板遮蔽:
   *  ①隧道(ty=2)側牆/山體:一端在洞內(lev 2)、一端在洞外,且射線由「實牆側」而非「洞口/
   *    明隧道開放側」穿出 → 岩盤擋(tunnelSideExit;開放側 = gal 遮罩,柱間透明可見可穿透,
   *    2026-07-30 柱列改制與客戶端同判)。以洞內端所在 cell 取其 ribbon(洞內端必落在自身 cell),
   *    沿軸經洞口穿出不擋(隧道兵線正常對射),實牆側/上方一律擋 —— 砲塔/小兵/英雄穿牆一併封死
   *    (天花正上方 ↔ 洞內由 ② 同 ribbon 層不符把關,不因 ① 放行而漏)。
   *    交疊 ribbon(髮夾雙腿/兩隧道相交)MUST 全數判實牆側才擋:任一條判「沿軸/開放側穿出」=
   *    射線走在該走廊的空腔內或柱間,照放行 —— ANY-match 會把沿另一走廊的合法對射誤判成穿岩盤,
   *    lev 抖動下更疊成「看不到打不到」的免傷掩體(2026-07-29 澀谷交疊)。
   *  ②橋面/隧道天花薄板(under-block):兩端同 ribbon 且層不符(僅「橋上 ↔ 正下方」一組)→ 擋;
   *    側向射擊不誤擋(橋 ty=1 只走這條,行為與舊版一致)。
   * 用「同 ribbon + 層不符」而非絕對 y(伺服器無地形高程、回報 y 為離站立表面高,橋上/橋下皆 ≈0)。
   */
  _slabBlocked(ax, az, bx, bz, ea, eb) {
    const g = this._slabGrid;
    const C = LOS.CELL_M;
    const levA = this._unitLev(ea), levB = this._unitLev(eb);
    // ① 隧道側牆:恰一端在洞內 → 以洞內端全部所在 ribbon 判「側牆穿出」,全數側牆才擋
    if ((levA === 2) !== (levB === 2)) {
      const ix = levA === 2 ? ax : bx, iz = levA === 2 ? az : bz;
      const ox = levA === 2 ? bx : ax, oz = levA === 2 ? bz : az;
      const arrI = g.get((Math.floor(ix / C) + 32768) * 65536 + (Math.floor(iz / C) + 32768));
      if (arrI) {
        let side = false;   // 至少落在一條隧道 ribbon 上,且每一條都判「實牆側穿出」
        for (const s of arrI) {
          if (s[5] !== 2 || !ptOnRibbon(ix, iz, s)) continue;
          if (tunnelSideExit(ix, iz, ox, oz, s) !== 1) { side = false; break; }   // 沿軸出洞口/開放側柱間 → 放行
          side = true;
        }
        if (side) return true;
      }
    }
    // ② 薄板 under-block:需兩端同 ribbon(A 之 cell 查起)
    const arr = g.get((Math.floor(ax / C) + 32768) * 65536 + (Math.floor(az / C) + 32768));
    if (arr) for (const s of arr) {
      if (ptOnRibbon(ax, az, s) && ptOnRibbon(bx, bz, s) && ((levA === s[5]) !== (levB === s[5]))) return true;
    }
    return false;
  }

  /**
   * 水沼粗網格吃進(2026-07-19):main.js 主機端以 terrainEnvCode 逐格烘烤,sim 座標系
   * (z 北 = −three z);data = 每格 '0'/'1'/'2' 字元(乾/水/沼),原點 + 格粒隨附。
   * 只作中立單位佈點/移動迴避 —— 不影響任何權威傷害/勝負(領機水沼效果走客戶端回報 h.wet)。
   */
  _ingestWorldWet(w) {
    const m = w && w.wet;
    if (!m || typeof m.data !== 'string') return;
    const cols = m.cols | 0, rows = m.rows | 0, cell = +m.cell;
    if (cols <= 0 || rows <= 0 || !(cell > 0) || cols * rows > 90000 || m.data.length < cols * rows) return;
    const data = new Uint8Array(cols * rows);
    for (let k = 0; k < cols * rows; k++) { const c = m.data.charCodeAt(k) - 48; if (c === 1 || c === 2) data[k] = c; }
    this._wetGrid = { minX: +m.minX, minZ: +m.minZ, cell, cols, rows, data };
  }

  /** 該世界座標的水沼分類(0 乾 / 1 水 / 2 沼);無網格(未上傳)恆回 0。 */
  _wetAt(x, z) {
    const g = this._wetGrid;
    if (!g) return 0;
    const j = Math.floor((x - g.minX) / g.cell);
    const i = Math.floor((z - g.minZ) / g.cell);
    if (i < 0 || j < 0 || i >= g.rows || j >= g.cols) return 0;
    return g.data[i * g.cols + j] || 0;
  }

  /** 中立單位佈點/移動迴避:水域/沼澤(網格) + 火場/淹水區(既有危險區 ent) */
  _terrainBlocked(x, z) {
    if (this._wetAt(x, z) > 0) return true;
    for (const zn of this._avoidZones || []) {
      if (dist2d(x, z, zn.x, zn.z) < zn.r + 2) return true;
    }
    return false;
  }

  /** 走廊淨空:隧道內/橋下不留第三方障礙(建物由客戶端 blocked 淨空,這裡清 sim 自己種的) */
  _pruneCorridors(cor) {
    const distToCor = (x, z, tunOnly) => {
      let min = Infinity;
      for (const [x1, z1, x2, z2, hw, tun] of cor) {
        if (tunOnly && !tun) continue;
        const ex = x2 - x1, ez = z2 - z1;
        const L2 = ex * ex + ez * ez || 1;
        let t = ((x - x1) * ex + (z - z1) * ez) / L2;
        t = t < 0 ? 0 : t > 1 ? 1 : t;
        const d = Math.hypot(x - (x1 + ex * t), z - (z1 + ez * t)) - hw;
        if (d < min) min = d;
      }
      return min;
    };
    // 障礙物/防空陣地/中繼站:落在任何走廊內(隧道全段 + 橋下)一律移除
    for (const e of [...this.ents.values()]) {
      if (!e.neutral) continue;
      const def = HAZARDS[e.kind];
      if (!def && e.kind !== 'aasite' && e.kind !== 'relay') continue;
      const r = (def?.r || 3) * (e.sc || 1);
      if (distToCor(e.x, e.z, false) >= r + 2) continue;
      this.ents.delete(e.id);
      if (this.hazBlockers && def?.block) {
        this.hazBlockers = this.hazBlockers.filter(([x, z]) => x !== e.x || z !== e.z);
      }
      if (e.kind === 'fire') this._fires = this._fires.filter((f) => f !== e);
    }
    // 地雷:隧道路面上不留(橋下地雷在地面,不衝突)
    this.mines = this.mines.filter(([x, z]) => distToCor(x, z, true) >= 2);
    this._rebuildAvoidZones();   // 走廊內火場/淹水區可能被清 → 同步迴避快取
  }

  /** 遮蔽物網格 = 上傳碰撞柱 + sim 自己的阻擋型障礙(擊毀障礙後 MUST 重建 → 打穿牆開視野)。
   *  格鍵用整數(i,j 各偏移 32768 打包)、另記全場最高障礙 _losMaxH 供高空快篩 —— 8Hz 熱路徑零字串。 */
  _rebuildLosGrid() {
    if (!this.worldOcc) return;   // 未上傳 → LOS 遮蔽停用
    const occ = [...this.worldOcc];
    for (const e of this.ents.values()) {
      const def = HAZARDS[e.kind];
      if (!e.neutral || !def?.block) continue;
      occ.push([e.x, e.z, def.r * (e.sc || 1), def.hgt || 6]);
    }
    const C = LOS.CELL_M;
    const grid = new Map();
    let maxH = 0;
    for (const o of occ) {
      const [x, z, r, h] = o;
      if (h > maxH) maxH = h;
      const i0 = Math.floor((x - r) / C), i1 = Math.floor((x + r) / C);
      const j0 = Math.floor((z - r) / C), j1 = Math.floor((z + r) / C);
      for (let i = i0; i <= i1; i++) {
        for (let j = j0; j <= j1; j++) {
          const k = (i + 32768) * 65536 + (j + 32768);
          let a = grid.get(k);
          if (!a) grid.set(k, a = []);
          a.push(o);
        }
      }
    }
    this._losGrid = grid;
    this._losMaxH = maxH;
  }

  /**
   * 視線/彈道遮蔽(2026-07-15):線段(射手眼 → 目標)是否被實體障礙(建物/神木/巨岩)擋住。
   * 高度是「離地」近似(伺服器無地形高程):障礙視為 [0, h] 圓柱,線段兩端高度線性內插;
   * 穿越弦長 < LOS.THRU_M(貼牆擦邊)不算遮蔽。看不到單位就不能射擊 —— 塔/NPC/玩家一體適用。
   * 熱路徑注意(2026-07-16 效能修):Amanatides–Woo 沿線走格(不掃 bbox,對角線省 ~3 倍格查詢);
   * 圓柱已按半徑外擴登記進所有重疊格 ⇒ 只訪線格即完備;跨格圓柱會重測,冪等且比配置 Set 去重便宜
   * —— MUST NOT 加回 per-call Set/字串鍵(V8 minor GC 會吃掉 tick 預算)。
   */
  _losBlocked(ax, az, ay, bx, bz, by, ea, eb) {
    // 橋面/隧道天花水平薄板(#1):兩端同 ribbon 且分屬板體兩側 → 擋(未上傳 slabs 則 _slabGrid 不存在,no-op)
    if (this._slabGrid && ea && eb && this._slabBlocked(ax, az, bx, bz, ea, eb)) return true;
    if (this._losDirty) { this._losDirty = false; this._rebuildLosGrid(); }   // 障礙被擊毀後的懶重建
    const grid = this._losGrid;
    if (!grid) return false;
    if (Math.min(ay, by) >= (this._losMaxH || 0)) return false;   // 全程高於最高障礙(高空對高空)
    const dx = bx - ax, dz = bz - az;
    const len = Math.hypot(dx, dz);
    if (len < 1e-6) return false;
    const C = LOS.CELL_M;
    const A2 = dx * dx + dz * dz;
    let i = Math.floor(ax / C), j = Math.floor(az / C);
    const iEnd = Math.floor(bx / C), jEnd = Math.floor(bz / C);
    const stepI = dx > 0 ? 1 : -1, stepJ = dz > 0 ? 1 : -1;
    let tMaxI = dx !== 0 ? ((dx > 0 ? i + 1 : i) * C - ax) / dx : Infinity;
    let tMaxJ = dz !== 0 ? ((dz > 0 ? j + 1 : j) * C - az) / dz : Infinity;
    const tDI = dx !== 0 ? C / Math.abs(dx) : Infinity;
    const tDJ = dz !== 0 ? C / Math.abs(dz) : Infinity;
    for (let guard = 0; guard < 96; guard++) {
      const arr = grid.get((i + 32768) * 65536 + (j + 32768));
      if (arr) {
        for (const o of arr) {
          const [x, z, r, h] = o;
          if (Math.min(ay, by) >= h) continue;   // 兩端都高於此柱 → 穿柱段必也高於(線性內插)
          const ox = ax - x, oz = az - z;
          const B2 = 2 * (ox * dx + oz * dz);
          const C2 = ox * ox + oz * oz - r * r;
          const disc = B2 * B2 - 4 * A2 * C2;
          if (disc <= 0) continue;
          const sq = Math.sqrt(disc);
          let t0 = (-B2 - sq) / (2 * A2), t1 = (-B2 + sq) / (2 * A2);
          if (t1 < 0 || t0 > 1) continue;
          // 有向盒(建物,占位含 hw2/hd2/cos/sin):圓只是 broad-phase(r = 外接半對角),
          // 真正的穿越區間改逐盒 slab 求 —— 與客戶端 `_blockerHitT` 同一個幾何體(見 setWorld)。
          // 舊格式(神木/巨岩/橋墩/sim 自己的阻擋障礙)長度 4,直接沿用圓,行為逐位元不變。
          if (o.length >= 8) {
            const hw2 = o[4], hd2 = o[5], cs = o[6], sn = o[7];
            const olx = ox * cs + oz * sn, olz = -ox * sn + oz * cs;      // world→local(繞 −ry)
            const ulx = dx * cs + dz * sn, ulz = -dx * sn + dz * cs;
            let bmin = -Infinity, bmax = Infinity, ok = true;
            // 逐軸 slab,手動展開(熱路徑不配置暫存陣列);len ≥ 1e-6 ⇒ 兩軸不會同時退化
            if (ulx < -1e-9 || ulx > 1e-9) {
              let s0 = (-hw2 - olx) / ulx, s1 = (hw2 - olx) / ulx;
              if (s0 > s1) { const s = s0; s0 = s1; s1 = s; }
              bmin = s0; bmax = s1;
            } else if (olx < -hw2 || olx > hw2) ok = false;
            if (ok && (ulz < -1e-9 || ulz > 1e-9)) {
              let s0 = (-hd2 - olz) / ulz, s1 = (hd2 - olz) / ulz;
              if (s0 > s1) { const s = s0; s0 = s1; s1 = s; }
              if (s0 > bmin) bmin = s0;
              if (s1 < bmax) bmax = s1;
            } else if (ok && (olz < -hd2 || olz > hd2)) ok = false;
            if (!ok || bmax < bmin || bmax < 0 || bmin > 1) continue;
            t0 = bmin; t1 = bmax;
          }
          t0 = Math.max(0, t0); t1 = Math.min(1, t1);
          if ((t1 - t0) * len < LOS.THRU_M) continue;        // 擦邊不擋
          const y0 = ay + (by - ay) * t0, y1 = ay + (by - ay) * t1;
          if (Math.min(y0, y1) < h) return true;             // 穿柱段低於障礙高 = 被擋
        }
      }
      if (i === iEnd && j === jEnd) break;
      if (tMaxI < tMaxJ) { i += stepI; tMaxI += tDI; }
      else { j += stepJ; tMaxJ += tDJ; }
    }
    return false;
  }

  /**
   * 這一段位移附近、與機體垂直帶重疊的 solid 清單(broad-phase)。
   * 兩個來源,對應客戶端 `_collide` 的兩個迴圈:
   *   ① `terrain.blockers` ⇒ 房主上傳的碰撞柱 `worldOcc`(建物有向盒 / 神木・巨岩・橋墩圓柱)。
   *      查詢走 `_losGrid`(同一份格網,LOS 與碰撞本來就是同一組實體 —— MUST NOT 另建第二份索引);
   *      未上傳世界(e2e / headless)⇒ 沒有格網,只剩下面的實體來源,舊行為不變。
   *   ② `ents` 有碰撞量體者 ⇒ 塔/主堡/戰車/裝甲車/步兵(`COLLIDE_KINDS` 同一份鍵集)+ 英雄
   *      + 阻擋型障礙(`HAZARDS[kind].block`)。
   * 跨格重複登記的柱會被重複收進來(冪等:push-out 第二次就已在外、掃掠取同一個 t)——
   * 與 `_losBlocked` 同一條紀律:MUST NOT 為了去重配置 Set(8Hz 熱路徑的 minor GC 更貴)。
   */
  _solidsNear(self, ax, az, bx, bz, myR, yBot, yTop) {
    const out = [];
    const span = (top, base) => yBot < top - 0.1 && yTop > base;   // 垂直帶重疊(閾值同客戶端)
    const pad = myR + 4;
    const minX = Math.min(ax, bx) - pad, maxX = Math.max(ax, bx) + pad;
    const minZ = Math.min(az, bz) - pad, maxZ = Math.max(az, bz) + pad;
    if (this._losDirty) { this._losDirty = false; this._rebuildLosGrid(); }   // 障礙被擊毀後的懶重建
    const grid = this._losGrid;
    if (grid) {
      const C = LOS.CELL_M;
      const i1 = Math.floor(maxX / C), j1 = Math.floor(maxZ / C);
      for (let i = Math.floor(minX / C); i <= i1; i++) {
        for (let j = Math.floor(minZ / C); j <= j1; j++) {
          const arr = grid.get((i + 32768) * 65536 + (j + 32768));
          if (!arr) continue;
          for (const o of arr) if (span(o[3], 0)) out.push(o);
        }
      }
    }
    for (const e of this.ents.values()) {
      if (e === self || e.gar || e.hp <= 0 || (e.hero && e.dead)) continue;
      if (e.pid != null && e.pid === self.pid) continue;   // 自己的僚機不碰撞(客戶端同判)
      let r, top, base = 0;
      const haz = HAZARDS[e.kind];
      if (e.neutral && haz?.block) {
        if (grid) continue;                                // 已隨 _rebuildLosGrid 進了格網
        r = haz.r * (e.sc || 1); top = haz.hgt || 6;
      } else if (e.hero || COLLIDE_KINDS.includes(e.kind)) {
        r = hitR(e); [base, top] = this._bodySpan(e);   // 命中量體 = 碰撞量體(同一把尺)
      } else continue;
      // bbox 篩選 MUST 帶上**該實體自己的半徑**(所以排在算出 r 之後)—— 只比中心點的話,
      // 20m 半徑的主堡站在 22m 外就被篩掉 = 從主堡牆裡穿過去(半徑越大的越容易漏,
      // 而那正好是最該擋的那些)
      if (e.x < minX - r || e.x > maxX + r || e.z < minZ - r || e.z > maxZ + r) continue;
      if (span(top, base)) out.push([e.x, e.z, r, top, 0, 0, 0, 0, base]);
    }
    return out;
  }

  /**
   * 機體 vs 世界的實體推擠(**唯一縫**;2026-08-02 使用者定案「電腦玩家的碰撞法則一律跟正常
   * 玩家一樣,移動與攻擊都不可穿牆穿越各種物理碰撞的物件」)。舊制 bot 直接寫 `h.x/h.z`,
   * 只在 `_push` 繞開 `hazBlockers`(而且交戰/撤退兩段連那個都沒有)⇒ 電腦玩家從建物中間穿過去。
   *
   * 流程與幾何逐條鏡射客戶端 `game.js _collide` + `_sweepBlockers`(真人座機的權威版本):
   *   ・量體走 `selfCollider`(data.js 唯一縫;兩端各寫一份係數 = 真人撞得到、電腦穿得過);
   *   ・垂直閘:伺服器無地形高程 ⇒ 上傳碰撞柱一律視為 [0, top] 柱(同 `_losBlocked` 的近似),
   *     機體底高過柱頂就飛得過去(無人機飛越屋頂,與客戶端同語意);
   *   ・先掃掠(單幀橫越 → 夾在進入面,防高速擊退/大 dt 穿牆)、再 push-out 至多 3 趟
   *     (密集街廓單趟可能把機體從 A 推進 B)。
   * 位置寫回由呼叫端負責(bots.js `_move` 是唯一呼叫端);回傳夾制後的 `[x, z]`。
   */
  solidResolve(e, ax, az, nx, nz, fly) {
    const col = selfCollider(hitH(e), fly);
    const y = e.y || 0;
    const sol = this._solidsNear(e, ax, az, nx, nz, col.r, y + col.bot, y + col.top);
    if (!sol.length) return [nx, nz];
    let x = nx, z = nz;
    const dx = nx - ax, dz = nz - az;
    const len = Math.hypot(dx, dz);
    if (len > 1e-3) {
      let bestT = Infinity;
      for (const o of sol) {
        const t = solidEnter(o, ax, az, nx, nz, col.r);
        if (t != null && t < bestT) bestT = t;
      }
      if (bestT < Infinity) {
        const t = Math.max(0, bestT - COL_SKIN / len);   // 夾在前緣(留 skin,不越回起點之前)
        x = ax + dx * t; z = az + dz * t;
      }
    }
    for (let pass = 0; pass < 3; pass++) {
      let moved = false;
      for (const o of sol) {
        const p = solidPush(o, x, z, col.r);
        if (!p) continue;
        x += p[0]; z += p[1]; moved = true;
      }
      if (!moved) break;
    }
    return [x, z];
  }

  /** 射手眼高(離地):塔的砲位過半塔身,能越過矮牆射擊 */
  _eyeY(e) { return (e.y || 0) + (e.kind === 'tower' ? LOS.TOWER_EYE_M : LOS.EYE_M); }

  /** 目標取樣高(離地):塔/主堡是高聳工事,露頭就打得到;BOSS 體型巨大,取量體中點避免低矮掩體誤判遮蔽 */
  _tgtY(e) {
    if (e.kind === 'tower' || e.kind === 'base') return LOS.TOWER_EYE_M;
    const base = (e.hero || e.kind === 'heli' || e.decoy || e.kami || e.hyper ? (e.y || 0) : 0);
    if (e.hero && (e.boss || e.sq?.boss)) return base + hitH(e) * 0.5;
    return base + LOS.TGT_M;
  }

  /** 機體垂直帶(離地):[腳底, 腳底 + 實體高度]。飛行體的腳底 = 回報高度,地面單位 = 0。 */
  _bodySpan(e) {
    const y0 = (e.hero || e.kind === 'heli' || e.decoy || e.kami || e.hyper ? (e.y || 0) : 0);
    return [y0, y0 + hitH(e)];
  }

  /**
   * 爆點/射線高 y 到「機體垂直帶」的距離(帶內 = 0)。使用者規則:打中哪個部位就在那裡結算 ——
   * 舊制一律量到單位底部(腳下光圈),塔頂/機甲頭部的直擊會被算成十幾公尺外的邊緣爆風。
   */
  _bodyDy(e, y) {
    const [y0, y1] = this._bodySpan(e);
    return y < y0 ? y0 - y : (y > y1 ? y - y1 : 0);
  }

  // ---------- 危險區(Diablo 式隨機生成:地雷 + 障礙物 + 匿蹤防空陣地 + 中繼站)----------
  _seedField() {
    this.loots = [];
    this.visionUntil = { SWARM: 0, STEEL: 0 };   // 偵察中繼站:全隊無霧視野的到期時刻
    this._seedMines();
    this._seedHazards();
    this._ensureConnectivity();
    this._seedAASites();
    this._seedRelays();
    this._fires = [...this.ents.values()].filter((e) => e.kind === 'fire');
    this._rebuildAvoidZones();
  }

  /** 中立單位迴避的傷害/限制區快取(火場 dot + 淹水區 slow);佈點/移動查表用,ent 增刪後重建。 */
  _rebuildAvoidZones() {
    this._avoidZones = [...this.ents.values()]
      .filter((e) => e.kind === 'fire' || e.kind === 'flood')
      .map((e) => ({ x: e.x, z: e.z, r: (HAZARDS[e.kind]?.r || 6) * (e.sc || 1) }));
  }

  // ---------- 地雷(非正規路線;隱蔽,只有地面機甲會踩)----------
  _seedMines() {
    const M = GAME.MINES;
    this.mines = [];   // 每項 [x, z, id]
    // 佈雷範圍:所有兵線點的外擴包圍盒
    let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
    for (const pts of this.lanes) for (const [x, z] of pts) {
      minX = Math.min(minX, x); maxX = Math.max(maxX, x);
      minZ = Math.min(minZ, z); maxZ = Math.max(maxZ, z);
    }
    // 取樣框外擴 > LANE_CLEAR:淨空條件收緊(走廊 115 / 主堡 260 / 塔 90)後,
    // 貼著兵線的舊框(+120)幾乎每個候選點都被打回票 → 佈雷數湊不滿
    minX -= 220; maxX += 220; minZ -= 220; maxZ += 220;
    // 兵線轉角座標:CUT_BIAS 比例的地雷佈在轉角外圍的「切彎捷徑」帶 —
    // 機甲抄直線切彎省時間 = 承擔雷區風險(限制行動但不封鎖,走廊永遠安全)
    const turnPts = [];
    for (let li = 0; li < this.lanes.length; li++) {
      const cum = this._laneCum(li);
      for (const d of this._laneTurns(li)) turnPts.push(pointAt(this.lanes[li], cum, d));
    }
    const want = M.PER_LANE * this.lanes.length;
    for (let tries = 0; tries < want * 80 && this.mines.length < want; tries++) {
      let x, z;
      if (turnPts.length && Math.random() < M.CUT_BIAS) {
        const [tx, tz] = turnPts[Math.floor(Math.random() * turnPts.length)];
        const ang = Math.random() * Math.PI * 2;
        const rr = M.LANE_CLEAR + Math.random() * M.CUT_R;
        x = tx + Math.cos(ang) * rr; z = tz + Math.sin(ang) * rr;
      } else {
        x = minX + Math.random() * (maxX - minX);
        z = minZ + Math.random() * (maxZ - minZ);
      }
      if (!this._inBounds(x, z)) continue;                        // 不落在地形外/空氣牆外
      if (this._distToLanes(x, z) < M.LANE_CLEAR) continue;       // 兵線走廊 + 緩衝帶淨空
      if (!this._farFromStructures(x, z, M.BASE_CLEAR, M.TOWER_CLEAR)) continue;   // 主堡/重生點/砲塔淨空
      this.mines.push([x, z, nextEntId++]);
    }
  }

  /**
   * 第三方打擊(地雷 / 防空陣地)的結構物淨空:主堡(含外推的重生點,baseClear
   * 已涵蓋 HERO_SPAWN_OFF)與所有砲塔。回 true = 這個點離得夠遠,可以佈設。
   */
  _farFromStructures(x, z, baseClear, towerClear) {
    for (const side of ['SWARM', 'STEEL']) {
      const [bx, bz] = this.basePos[side];
      if (dist2d(x, z, bx, bz) < baseClear) return false;
    }
    for (const e of this.ents.values()) {
      if (e.kind !== 'tower') continue;
      if (dist2d(x, z, e.x, e.z) < towerClear) return false;
    }
    return true;
  }

  /** 兵線轉角(戰術要點)沿線距離清單;與客戶端選路評分共用 laneTacticsXZ 判定 */
  _laneTurns(li) {
    this._turnCache ??= [];
    return (this._turnCache[li] ??= laneTacticsXZ(this.lanes[li]).turns);
  }

  /**
   * 兵線上取一個佈設位置 d:轉角優先(Diablo:轉角 = 房間/伏擊點)。
   * bias 機率錨定在隨機轉角 ±TURN_R,其餘均勻散布;夾在 [lo,hi] 比例區間。
   */
  _pickLaneD(li, total, lo, hi, bias) {
    const turns = this._laneTurns(li);
    if (turns.length && Math.random() < bias) {
      const d = turns[Math.floor(Math.random() * turns.length)] + (Math.random() - 0.5) * 2 * FIELD.TURN_R;
      return Math.max(total * lo, Math.min(total * hi, d));
    }
    // 難度梯度(D1 越深越難):部分改用三角分布向兵線中段(河道)聚攏
    if (Math.random() < FIELD.MID_BIAS) {
      const u = (Math.random() + Math.random()) / 2;
      return total * (lo + u * (hi - lo));
    }
    return total * (lo + Math.random() * (hi - lo));
  }

  /** 兵線上距離 d 處的點與單位法線(垂直於路徑方向;障礙沿「路徑邊緣」擺) */
  _lanePointNormal(li, d) {
    const pts = this.lanes[li];
    const cum = this._laneCum(li);
    const [x, z] = pointAt(pts, cum, d);
    let i = 1;
    while (cum[i] < d && i < cum.length - 1) i++;
    const dx = pts[i][0] - pts[i - 1][0], dz = pts[i][1] - pts[i - 1][1];
    const len = Math.hypot(dx, dz) || 1;
    return { x, z, nx: -dz / len, nz: dx / len };
  }

  /**
   * 障礙物:空白區 / 主要路徑邊緣隨機生成(Diablo 迷宮思想)。
   * 同型 1~CLUSTER_MAX 個連成「短牆」;牆段之間保證 HAZ_GAP 縫隙 —
   * 限制行動但永不完全封鎖。類型依場地地貌 mix 加權(圖資地貌決定選用)。
   */
  _seedHazards() {
    const F = FIELD;
    const mix = this.config.venue?.mix || null;
    const types = Object.keys(HAZARDS);
    const w = types.map((t) => (mix ? (mix[HAZARDS[t].biome] || 0) + 0.05 : 1));
    const wSum = w.reduce((a, b) => a + b, 0);
    const pickType = () => {
      let r = Math.random() * wSum;
      for (let i = 0; i < types.length; i++) { r -= w[i]; if (r <= 0) return types[i]; }
      return types[0];
    };
    this.hazBlockers = [];   // 阻擋型座標(連通性/牆段間距檢查用)
    this._hazAll = [];       // 所有危險區圓 {x,z,r,block,wall}(規則 #1:任兩危險區不重疊,同牆除外)
    const want = F.HAZ_PER_LANE * this.lanes.length;
    let placed = 0;
    for (let tries = 0; tries < want * 20 && placed < want; tries++) {
      const type = pickType();
      const def = HAZARDS[type];
      const li = Math.floor(Math.random() * this.lanes.length);
      const cum = this._laneCum(li);
      const total = cum[cum.length - 1];
      // 轉角優先佈設:過半障礙錨定在兵線彎道(掩體 + 視線遮斷 = 伏擊點),其餘均勻
      const p = this._lanePointNormal(li, this._pickLaneD(li, total, 0.08, 0.92, F.TURN_BIAS));
      const dir = Math.random() < 0.5 ? -1 : 1;
      const off = F.HAZ_LANE_MIN + (F.HAZ_LANE_MAX - F.HAZ_LANE_MIN) * Math.pow(Math.random(), F.HAZ_EDGE_BIAS);
      const n = 1 + Math.floor(Math.random() * F.CLUSTER_MAX);
      const wall = this._hazAll.length;   // 牆 id:同牆(短牆設計)容許緊靠,不同牆不得重疊
      for (let k = 0; k < n && placed < want; k++) {
        const x = p.x + p.nx * dir * off + (Math.random() - 0.5) * def.r * 3;
        const z = p.z + p.nz * dir * off + (Math.random() - 0.5) * def.r * 3;
        const sc = Math.round((0.75 + Math.random() * 0.6) * 100) / 100;   // 每次生成隨機差異化(半徑感知,先算再驗)
        if (!this._hazOk(x, z, def, sc, wall)) continue;
        const r = def.r * sc;
        this._add({
          kind: type, side: null, neutral: true, haz: true, x, z, sc,
          hp: def.hp ? Math.round(def.hp * sc) : 1, inv: !def.hp,
        });
        if (def.block) this.hazBlockers.push([x, z, r]);
        this._hazAll.push({ x, z, r, block: !!def.block, wall });
        placed++;
      }
    }
  }

  /** 中立物散布的越界防線:含半徑 r 整體落在地形(空氣牆內)才准放 */
  _inBounds(x, z, r = 0) {
    const b = this.bounds;
    return x - r >= b.minX && x + r <= b.maxX && z - r >= b.minZ && z + r <= b.maxZ;
  }

  /** 危險區圓(中心 + 邊緣八點)是否觸及水域/沼澤(_wetAt 唯一縫;未上傳網格恆 0 → headless no-op) */
  _hazOnWet(x, z, r) {
    if (this._wetAt(x, z) > 0) return true;
    for (let a = 0; a < 8; a++) {
      const ang = (a / 8) * Math.PI * 2;
      if (this._wetAt(x + Math.cos(ang) * r, z + Math.sin(ang) * r) > 0) return true;
    }
    return false;
  }

  _hazOk(x, z, def, sc, wall = Infinity) {
    const F = FIELD;
    const r = def.r * sc;
    if (!this._inBounds(x, z, r)) return false;                     // 不落在地形外/空氣牆外
    // 2026-07-19:半徑感知 —— 障礙「邊緣」(中心距 − r)須離兵線 ≥ HAZ_LANE_MIN(大半徑危險區不侵 14m 走廊)。
    if (this._distToLanes(x, z) - r < F.HAZ_LANE_MIN) return false;
    for (const side of ['SWARM', 'STEEL']) {
      const [bx, bz] = this.basePos[side];
      if (dist2d(x, z, bx, bz) < F.HAZ_BASE_CLEAR) return false;
    }
    // (規則 #1)不落在水域/沼澤(火場燒在湖裡 = 錯);(規則 #1)不與其他牆的危險區重疊(火/淹水等非阻擋型一併納入)。
    if (this._hazOnWet(x, z, r)) return false;
    for (const h of this._hazAll || []) {
      if (h.wall === wall) continue;                                // 同牆(短牆設計)容許緊靠
      const need = (def.block && h.block) ? Math.max(F.HAZ_GAP, r + h.r) : r + h.r;   // 阻擋牆間留通行縫;其餘只需不重疊
      if (dist2d(x, z, h.x, h.z) < need) return false;
    }
    return true;
  }

  /** 匿蹤防空陣地:非正規路線的伏擊發射源;可被擊毀(= 打出安全空域,有賞金) */
  _seedAASites() {
    const S = FIELD.AA_SITE;
    const want = FIELD.AA_SITES_PER_LANE * this.lanes.length;
    const sites = [];
    for (let tries = 0; tries < want * 30 && sites.length < want; tries++) {
      const li = Math.floor(Math.random() * this.lanes.length);
      const cum = this._laneCum(li);
      const total = cum[cum.length - 1];
      // 防空陣地同樣偏向扼守彎道:轉角處視線被掩體遮斷,伏擊飛彈最難預警
      const p = this._lanePointNormal(li, this._pickLaneD(li, total, 0.1, 0.9, FIELD.TURN_BIAS));
      const dir = Math.random() < 0.5 ? -1 : 1;
      const off = S.laneMin + Math.random() * (S.laneMax - S.laneMin);
      const x = p.x + p.nx * dir * off, z = p.z + p.nz * dir * off;
      if (!this._inBounds(x, z, 6)) continue;
      if (this._distToLanes(x, z) < S.laneMin) continue;                        // 走廊 + 緩衝帶淨空
      if (!this._farFromStructures(x, z, S.baseClear, S.towerClear)) continue;  // 主堡/重生點/砲塔淨空
      if (sites.some(([sx, sz]) => dist2d(x, z, sx, sz) < S.spacing)) continue;
      sites.push([x, z]);
      this._add({ kind: 'aasite', side: null, neutral: true, x, z, hp: S.hp, sc: 1 });
    }
  }

  /**
   * 連通性保證(DevilutionX DRLG 思想:生成後 flood-fill 驗證,不通就拆牆)。
   * 粗網格 BFS 驗證兩堡地面互通;HAZ_GAP/HAZ_LANE_MIN 依構造已保證走廊暢通,
   * 此為防禦性檢查 — 未來調參(如障礙半徑 > 走廊淨空)才可能觸發。
   */
  _ensureConnectivity() {
    const cell = FIELD.CONNECT_CELL_M;
    const [ax, az] = this.basePos.SWARM, [bx, bz] = this.basePos.STEEL;
    let minX = Math.min(ax, bx), maxX = Math.max(ax, bx);
    let minZ = Math.min(az, bz), maxZ = Math.max(az, bz);
    for (const pts of this.lanes) for (const [x, z] of pts) {
      minX = Math.min(minX, x); maxX = Math.max(maxX, x);
      minZ = Math.min(minZ, z); maxZ = Math.max(maxZ, z);
    }
    minX -= cell * 2; maxX += cell * 2; minZ -= cell * 2; maxZ += cell * 2;
    const W = Math.ceil((maxX - minX) / cell), H = Math.ceil((maxZ - minZ) / cell);
    const idx = (x, z) => (Math.min(H - 1, Math.max(0, Math.floor((z - minZ) / cell)))) * W
      + Math.min(W - 1, Math.max(0, Math.floor((x - minX) / cell)));
    const reachable = () => {
      const blocked = new Uint8Array(W * H);
      for (const [hx, hz, hr] of this.hazBlockers) {
        const rr = hr + 2.5;   // 機甲半身寬裕度
        for (let gz = Math.floor((hz - rr - minZ) / cell); gz <= (hz + rr - minZ) / cell; gz++) {
          for (let gx = Math.floor((hx - rr - minX) / cell); gx <= (hx + rr - minX) / cell; gx++) {
            if (gx >= 0 && gz >= 0 && gx < W && gz < H) blocked[gz * W + gx] = 1;
          }
        }
      }
      const start = idx(ax, az), goal = idx(bx, bz);
      const seen = new Uint8Array(W * H);
      const q = [start];
      seen[start] = 1;
      while (q.length) {
        const c = q.pop();
        if (c === goal) return true;
        const cx = c % W, cz = (c / W) | 0;
        for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          const nx = cx + dx, nz = cz + dz;
          const n = nz * W + nx;
          if (nx < 0 || nz < 0 || nx >= W || nz >= H || seen[n] || blocked[n]) continue;
          seen[n] = 1;
          q.push(n);
        }
      }
      return false;
    };
    for (let tries = 0; tries < 12 && this.hazBlockers.length && !reachable(); tries++) {
      // 不通:拆掉最靠近兩堡連線的阻擋障礙,重驗
      const dx = bx - ax, dz = bz - az;
      const len2 = dx * dx + dz * dz || 1;
      let worst = 0, worstD = Infinity;
      for (let i = 0; i < this.hazBlockers.length; i++) {
        const [hx, hz] = this.hazBlockers[i];
        const t = Math.max(0, Math.min(1, ((hx - ax) * dx + (hz - az) * dz) / len2));
        const d = dist2d(hx, hz, ax + dx * t, az + dz * t);
        if (d < worstD) { worstD = d; worst = i; }
      }
      const [hx, hz] = this.hazBlockers[worst];
      this.hazBlockers.splice(worst, 1);
      for (const e of [...this.ents.values()]) {
        if (e.haz && e.x === hx && e.z === hz) { this.ents.delete(e.id); break; }
      }
    }
  }

  /**
   * 偵察中繼站(D1 神龕):非正規路線的一次性正向誘因 —
   * 冒雷區/防空風險去佔用,換全隊限時無霧視野;擺兵線中段 = 河道高風險高報酬。
   */
  _seedRelays() {
    const R = FIELD.RELAY;
    this._relays = [];
    for (let li = 0; li < this.lanes.length && this._relays.length < R.PER_LANE * this.lanes.length; li++) {
      const cum = this._laneCum(li);
      const total = cum[cum.length - 1];
      for (let tries = 0; tries < 30; tries++) {
        const p = this._lanePointNormal(li, total * (R.dLo + Math.random() * (R.dHi - R.dLo)));
        const dir = Math.random() < 0.5 ? -1 : 1;
        const off = R.laneMin + Math.random() * (R.laneMax - R.laneMin);
        const x = p.x + p.nx * dir * off, z = p.z + p.nz * dir * off;
        if (!this._inBounds(x, z, R.R)) continue;
        if (this._distToLanes(x, z) < R.laneMin) continue;
        if (this.hazBlockers.some(([hx, hz, hr]) => dist2d(x, z, hx, hz) < hr + 10)) continue;
        this._relays.push(this._add({
          kind: 'relay', side: null, neutral: true, inv: true, x, z, hp: 1, sc: 1, charge: 0,
        }));
        break;
      }
    }
  }

  // ---------- 第三方軍隊(2026-07-17;DOTA 野區:游擊隊 / 武裝民兵,見 data.js THIRD)----------
  /**
   * 佈營:每條兵線兩側各一團(左 = 游擊隊 GUER、右 = 武裝民兵 MILI;總團數 = 兵線數 × 2)。
   * 硬不變式:離雙方每座砲塔 ≥ tower.range × CLEAR_F、離兩主堡 ≥ max(主堡射程) × CLEAR_F ——
   * 淨空 > max(塔射程, 野營最大射程) ⇒ 雙方互不可及、野營永遠在正規工事火網之外(CLEAR_F 只准 > 1.0);
   * 另離所有兵線走廊 ≥ LANE_MIN(> NPC 最大射程)⇒ 不掃兵線。取樣不到合法點 → 該團不生成(寧缺勿錯)。
   */
  _seedCamps() {
    this.camps = [];
    const rTower = UNITS.tower.range * THIRD.CLEAR_F;
    const rBase = Math.max(UNITS.base.range, UNITS.base.guns.range) * THIRD.CLEAR_F;
    const towers = [...this.ents.values()].filter((e) => e.kind === 'tower');
    const clearOk = (x, z) => {
      for (const side of ['SWARM', 'STEEL']) {
        const [bx, bz] = this.basePos[side];
        if (dist2d(x, z, bx, bz) < rBase) return false;
      }
      for (const tw of towers) if (dist2d(x, z, tw.x, tw.z) < rTower) return false;
      return true;
    };
    for (let li = 0; li < this.lanes.length; li++) {
      const cum = this._laneCum(li);
      const total = cum[cum.length - 1];
      for (const dir of [-1, 1]) {
        const type = dir < 0 ? 'GUER' : 'MILI';
        let best = null, bestScore = -Infinity, bestN = null;
        // 兩輪取樣:第二輪放寬「側偏上限」(硬約束照舊)—— 山谷/小圖的合法區常在斜後方遠處
        for (const maxOff of [THIRD.LANE_MAX, THIRD.LANE_MAX * 1.6]) {
          for (let tries = 0; tries < 320; tries++) {
            const p = this._lanePointNormal(li, total * (0.1 + Math.random() * 0.8));
            const off = THIRD.LANE_MIN + Math.random() * (maxOff - THIRD.LANE_MIN);
            const x = p.x + p.nx * dir * off, z = p.z + p.nz * dir * off;
            if (!this._inBounds(x, z, 16)) continue;
            const dl = this._distToLanes(x, z);                        // 其他兵線也要淨空
            if (dl < THIRD.LANE_MIN) continue;
            if (!clearOk(x, z)) continue;                              // 1.5× 工事射程(硬)
            if (this.camps.some((c) => dist2d(x, z, c.x, c.z) < THIRD.SPACING)) continue;
            if ((this.hazBlockers || []).some(([hx, hz, hr]) => dist2d(x, z, hx, hz) < hr + 16)) continue;
            if (this._terrainBlocked(x, z)) continue;                  // 第三方營地不設在水域/沼澤/火場(feature 9)
            const score = -Math.abs(dl - (THIRD.LANE_MIN + 90));       // 偏好取樣帶中段
            if (score > bestScore) { bestScore = score; best = [x, z]; bestN = [p.nx * dir, p.nz * dir]; }
          }
          if (best) break;
        }
        if (!best) continue;
        this._spawnCamp(type, li, best[0], best[1], bestN);
      }
    }
  }

  _spawnCamp(type, li, x, z, outN) {
    const ci = this.camps.length;
    // 出堡/重生朝向 = 兵線方向(外法線反向):駐守與重生集中在朝戰場的清空側(_campHome 用)
    const exitA = outN ? Math.atan2(-outN[1], -outN[0]) : 0;
    const camp = { type, li, x, z, exitA, bunker: null, bunkerRem: 0, pool: [] };
    this.camps.push(camp);
    camp.bunker = this._spawnBunker(camp, ci);
    THIRD.COMP[type].forEach((kind, i) => this._spawnCampUnit(camp, ci, kind, i));
  }

  _spawnBunker(camp, ci) {
    return this._add({ kind: 'bunker', side: camp.type, tp: 1, ci, x: camp.x, z: camp.z, hp: UNITS.bunker.hp });
  }

  /** 團員生成/重生:繞碉堡的駐守位(slot 定角);直升機吃巡航高度 */
  _spawnCampUnit(camp, ci, kind, slot) {
    const [hx, hz] = this._campHome(camp, slot);
    return this._add({
      kind, side: camp.type, tp: 1, ci, slot,
      x: hx, z: hz, y: kind === 'heli' ? GAME.HELI_ALT : 0,
      hp: UNITS[kind].hp,
    });
  }

  /** 團員的駐守位(碉堡周圍等角環列) */
  _campHome(camp, slot) {
    const n = THIRD.COMP[camp.type].length;
    // 保留清空側:駐守/重生位集中在 exitA ± EXIT_ARC 的扇形(朝兵線),而非整圈環列 ⇒ 碉堡至少一面清空作重生點
    const spread = n > 1 ? ((slot || 0) / (n - 1) - 0.5) * 2 * THIRD.EXIT_ARC : 0;
    const a = (camp.exitA || 0) + spread;
    return [camp.x + Math.cos(a) * THIRD.FORM_R, camp.z + Math.sin(a) * THIRD.FORM_R];
  }

  /** 團員陣亡 → 進重生池(60s);碉堡陣亡 → 原地重生倒數(180s)+ 駐守者被迫出堡 */
  _onThirdDeath(t, by) {
    const camp = this.camps?.[t.ci];
    if (!camp) return;
    if (t.kind === 'bunker') {
      camp.bunker = null;
      camp.bunkerRem = THIRD.BUNKER_RESPAWN_S;
      // 碉堡塌了:駐守中的步槍兵被迫出堡(免傷/射孔限制即刻解除)
      for (const e of this.ents.values()) if (e.tp && e.ci === t.ci && e.gar) this._ungarrison(e);
    } else {
      camp.pool.push({ kind: t.kind, slot: t.slot || 0, rem: THIRD.UNIT_RESPAWN_S });
    }
    // 全清獎勵(首次觸發):碉堡與所有團員同時陣亡 → 釋出 THIRD.CLEAR_CIVS 名脫困平民
    // (隨機陣營、自動跟隨清營者、不重生)。營地仍會照常重生,但獎勵只給第一次清空。
    if (!camp.freed && this._campCleared(t.ci)) {
      camp.freed = true;
      this._freeCampCivilians(camp, by);
    }
  }

  /** 該營是否已全清(this.ents 中無任何存活團員/碉堡;呼叫點在死者已從 ents 移除之後)。 */
  _campCleared(ci) {
    for (const e of this.ents.values()) if (e.tp && e.ci === ci) return false;
    return true;
  }

  /** 離座標最近的存活英雄(清營者非英雄時的跟隨對象備援);無 → null。 */
  _nearestHero(x, z) {
    let best = null, bd = Infinity;
    for (const h of this.heroes.values()) {
      if (h.dead) continue;
      const d = dist2d(x, z, h.x, h.z);
      if (d < bd) { bd = d; best = h; }
    }
    return best;
  }

  /** 清空營地釋出的平民:繞碉堡等角散布、隨機陣營、不重生、自動跟隨清營者(非英雄則跟最近英雄)。 */
  _freeCampCivilians(camp, by) {
    const owner = (by && by.hero && this.heroes.has(by.pid) && !by.dead) ? by : this._nearestHero(camp.x, camp.z);
    const n = THIRD.CLEAR_CIVS;
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2;
      const pt = { x: camp.x + Math.cos(a) * THIRD.FORM_R, z: camp.z + Math.sin(a) * THIRD.FORM_R };
      const cs = Math.random() < 0.5 ? 'SWARM' : 'STEEL';   // 陣營隨機
      const civ = this._spawnCiv(cs, false, Math.floor(Math.random() * CIVILIANS.length), pt);
      civ.noRespawn = true;                    // 不重生(_kill 略過 civRespawns)
      civ.home = [camp.x, camp.z];             // 失聯後繞營地徘徊,而非出生點
      if (owner) { civ.follow = owner.pid; civ.followT = 0; }   // 自動跟隨
    }
    if (owner) this.events.push({ e: 'civfree', pid: owner.pid, side: owner.side, x: camp.x, z: camp.z, n });
  }

  /** 重生管理:碉堡倒數恆走(原地重生);單位倒數只在碉堡存在時前進(暫停規則) */
  _tickCamps(dt) {
    for (let ci = 0; ci < (this.camps || []).length; ci++) {
      const camp = this.camps[ci];
      if (!camp.bunker) {
        camp.bunkerRem -= dt;
        if (camp.bunkerRem <= 0) camp.bunker = this._spawnBunker(camp, ci);
        continue;   // 碉堡不存在:單位重生暫停倒數
      }
      for (let i = camp.pool.length - 1; i >= 0; i--) {
        const p = camp.pool[i];
        p.rem -= dt;
        if (p.rem > 0) continue;
        camp.pool.splice(i, 1);
        this._spawnCampUnit(camp, ci, p.kind, p.slot);
      }
    }
  }

  /** 駐守中的團員數(容量閘門) */
  _garCount(ci) {
    let n = 0;
    for (const e of this.ents.values()) if (e.tp && e.ci === ci && e.gar) n++;
    return n;
  }

  /**
   * 第三方單位的狀態機(開火/移動之外):
   * 駐守 = 免傷(_damage 早退)+ 緩慢回血 + 射程 ×GAR_RANGE_F,回滿出堡;
   * 半血步槍兵 → 尋堡(seek);離碉堡 > TETHER_M → 繫繩撤回(ret,途中不交戰)。
   */
  _tpBehave(e, dt) {
    const camp = this.camps?.[e.ci];
    if (!camp || e.kind === 'bunker') return;
    if (e.gar) {
      if (!camp.bunker) { this._ungarrison(e); return; }   // 防禦性:碉堡消失即出堡
      e.hp = Math.min(e.maxHp, e.hp + e.maxHp * THIRD.GAR_REGEN_PS * dt);
      e.x = camp.x; e.z = camp.z;                          // 人在堡內,位置鎖定
      if (e.hp >= e.maxHp * THIRD.GAR_EXIT_F) this._ungarrison(e);
      return;
    }
    const dHome = dist2d(e.x, e.z, camp.x, camp.z);
    if (!e.ret && dHome > THIRD.TETHER_M) e.ret = 1;
    else if (e.ret && dHome <= THIRD.HOME_R) e.ret = 0;
    e.seek = 0;
    if (e.kind === 'soldier' && camp.bunker && e.hp <= e.maxHp * THIRD.GAR_ENTER_F) {
      if (dHome > 7) e.seek = 1;                           // 朝碉堡移動(_tpMove 消費)
      else if (this._garCount(e.ci) < THIRD.GAR_CAP) {
        e.gar = 1; e.ret = 0;
        e.x = camp.x; e.z = camp.z;
      }
    }
  }

  /** 記仇目標:被攻擊後鎖定攻擊者 THIRD.AGGRO_TTL 秒(脫離視野仍追);過期/陣亡/匿蹤/同陣營 → 清除。
   *  追擊本身的越界撤回由 _tpBehave 的 TETHER_M 繫繩把關(追過頭即 ret 撤回)。 */
  _tpAggroTarget(e) {
    const t = e.aggro;
    if (!t) return null;
    if (this.t - (e.aggroAt || 0) > THIRD.AGGRO_TTL || t.hp <= 0 || t.dead
        || t.side === e.side || (t.stealthUntil || 0) > this.t) { e.aggro = null; return null; }
    return t;
  }

  /** 第三方移動:撤回/尋堡 > 追擊(記仇攻擊者 > 視野內射程外)> 歸位駐守;吃控場折速、繞阻擋障礙 */
  _tpMove(e, u, dt) {
    const camp = this.camps?.[e.ci];
    if (!camp || e.gar) return;
    let sf = 1;   // 控場折速(與 _advance 同規則;無兵線可倒退,混亂折半)
    if ((e.stunUntil || 0) > this.t) sf = 0;
    else {
      if ((e.slowUntil || 0) > this.t) sf *= e.slowF ?? 0.6;
      if ((e.confUntil || 0) > this.t) sf *= 0.5;
    }
    if (sf <= 0) return;
    let tx, tz, arrive = 2;
    if (e.ret || e.seek) { tx = camp.x; tz = camp.z; arrive = e.seek ? 5 : THIRD.HOME_R * 0.6; }
    else {
      // 追擊:優先「記仇的攻擊者」(被打後即使脫離視野仍持續追);否則沿用「視野內、射程外」的一般追擊;
      // 兩者皆繫繩由 _tpBehave 把關(追過 TETHER_M 就撤回);都沒有 → 回駐守位。
      const chase = this._tpAggroTarget(e) || this._acquireTarget(e, { range: u.sight ?? u.range, wid: u.wid });
      if (chase) { tx = chase.x; tz = chase.z; arrive = Math.max(6, u.range * 0.7); }
      else { [tx, tz] = this._campHome(camp, e.slot); }
    }
    const dx = tx - e.x, dz = tz - e.z;
    const d = Math.hypot(dx, dz);
    if (d <= arrive) return;
    const step = Math.min(d, u.speed * sf * dt);
    const nx = e.x + dx / d * step, nz = e.z + dz / d * step;
    // 不踏入水域/沼澤/火場(feature 9;地面型才判定,直升機飛越)——目的地是傷害/限制區且當前不是 → 停步。
    if (e.kind !== 'heli' && this._terrainBlocked(nx, nz) && !this._terrainBlocked(e.x, e.z)) return;
    e.x = nx;
    e.z = nz;
    if (e.kind !== 'heli') {   // 阻擋型障礙:比照 _advance 繞開(直升機飛越)
      for (const [hx, hz, hr] of this.hazBlockers || []) {
        const dd = dist2d(e.x, e.z, hx, hz);
        if (dd >= hr || dd === 0) continue;
        e.x = hx + (e.x - hx) / dd * hr;
        e.z = hz + (e.z - hz) / dd * hr;
      }
    }
  }

  /** 出堡:回到駐守位(免傷/射孔限制一併解除) */
  _ungarrison(e) {
    e.gar = 0;
    const camp = this.camps?.[e.ci];
    if (!camp) return;
    [e.x, e.z] = this._campHome(camp, e.slot);
  }

  /** 點到所有兵線折線的最短距離(判定「非正規路線」用) */
  _distToLanes(x, z) {
    let best = Infinity;
    for (const pts of this.lanes) {
      for (let i = 1; i < pts.length; i++) {
        const [ax, az] = pts[i - 1], [bx, bz] = pts[i];
        const dx = bx - ax, dz = bz - az;
        const len2 = dx * dx + dz * dz || 1;
        const t = Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / len2));
        best = Math.min(best, dist2d(x, z, ax + dx * t, az + dz * t));
        if (best === 0) return 0;
      }
    }
    return best;
  }

  // ---------- 建置:主堡 + 每線每方 towerStages 個塔位 ×(左右各 1 座)----------
  // 塔位階數 = 完整戰場 2(前線 + 後方)/ 迷你地圖 1(只有前線);由 solveTowerSites 定案。
  _spawnStructures() {
    for (const side of ['SWARM', 'STEEL']) {
      const [x, z] = this.basePos[side];
      this._add({ kind: 'base', side, x, z, hp: UNITS.base.hp, sg: SIEGE.BASE });
    }
    // 塔位一律走 data.js 的 solveTowerSites()(與 biomes 淨空同一個縫):
    // 最前線敵我塔的直線距離 = tower.range × TOWER_SEP_F(射程重疊 TOWER_OVERLAP、且不對射)。
    // 留存塔位(帶 frac):開場預置兵線 _prefillLanes 要「第一座砲塔」的沿線位置,
    // MUST 吃同一份解(再解一次 = 第二份實作,兩邊會分家)。
    const sites = this.towerSites = solveTowerSites(this.lanes, this.mapArg);
    for (let li = 0; li < sites.length; li++) {
      // 攻堅階段一律走 `siegeSiteStages`(唯一縫;MUST NOT 拿 st 的陣列索引推,見 data.js SIEGE 註)
      const stages = siegeSiteStages(sites[li]);
      for (let si = 0; si < sites[li].length; si++) {
        const st = sites[li][si];
        // 劇情戰役只有防守方有塔(我方前線就是主堡)⇒ 名冊走 `siteCPs`,MUST NOT 直接讀
        // `st[side]`(那一份在劇情戰役會拿到 undefined,展開成 p.x 就是靜默的 NaN 座標)
        for (const p of siteCPs(st)) {
          for (const s of [-1, 1]) {
            this._add({
              kind: 'tower', side: p.side, lane: li, hp: UNITS.tower.hp, sg: stages[si],
              x: p.x + p.nx * GAME.TOWER_SIDE_OFF * s, z: p.z + p.nz * GAME.TOWER_SIDE_OFF * s,
            });
          }
        }
      }
    }
    // 逐階存活數 —— 建築只減不增(沒有重建),故只在 `_kill` 遞減、開場點一次名
    for (const side of ['SWARM', 'STEEL']) {
      const left = this._siegeLeft[side] = new Array(SIEGE.STAGES.length).fill(0);
      for (const e of this.ents.values()) if (e.side === side && e.sg != null) left[e.sg]++;
      this._siegeOpen[side] = siegeOpenStage(left);
    }
  }

  /**
   * 攻堅鎖血(劇情戰役):前一階建築沒清完,後一階完全免傷。
   * **三個消費端 MUST 全吃這一支**(`_damage` 擋傷害、`_tgBlockedD` 與 `bots._acquire` 擋索敵)——
   * 只擋傷害的話,小兵與砲塔會停在打不動的目標前面把整條兵線卡死,而畫面上只表現成「兵不推了」。
   */
  siegeLocked(t) {
    return !!(this.siege && t && t.sg != null && t.sg > this._siegeOpen[t.side]);
  }

  /**
   * 區域 BOSS 關卡的 HP 地板(2026-08-14 使用者:「敵方砲塔主堡會鎖住 HP1 直到區域 BOSS 被擊敗
   * 且對話結束」)。回 0 = 不夾(一般對戰、沒有 BOSS 的階段、已經解禁的階段)。
   *
   * 與 `siegeLocked` 是**兩道不同語意的閘**,MUST NOT 合併:那一支是階段順序、完全免傷 + 排除
   * 索敵;這一支是同一階之內的 BOSS 關卡,建築照樣被索敵、照樣掉血,只是死不了 —— 所以
   * 消費端**只有 `_damage`** 一處(`_tgBlockedD` / `bots._acquire` MUST NOT 吃這一支,不然
   * 小兵會集體無視一座還在對它們開火的塔)。
   * BOSS 自己不吃(`t.sg` 在 BOSS 身上也有值,但它不是建築)—— 判據是 `!t.hero`。
   */
  siegeHpFloor(t) {
    if (!this.siege || t.hero || t.sg == null) return 0;
    const left = this._bossLeft[t.side], until = this._talkUntil[t.side];
    if (!left) return 0;
    const gated = (left[t.sg] || 0) > 0 || this.t < (until[t.sg] || 0);
    return gated ? SIEGE.BLD_HP_FLOOR : 0;
  }

  /**
   * 我方電腦玩家對 BOSS / 建築的傷害折減(2026-08-14 使用者定案;倍率唯一縫 = data.allyBotDmgF)。
   * 只認「**攻方的 bot 英雄** → **守方的 BOSS 或建築**」這一格:真人玩家(關卡是他的)、守方
   * 自己的輸出、小兵與第三方 NPC 一律 ×1。沒有 defSide ⇒ 恆 ×1 = 一般對戰逐位元同舊制。
   */
  _allyBotDmgF(t, by) {
    if (!this.defSide || !by?.hero || by.side === this.defSide || !isBotId(by.pid)) return 1;
    if (t.side !== this.defSide) return 1;
    if (t.sq?.boss) return allyBotDmgF('boss');
    if (t.kind === 'tower' || t.kind === 'base') return allyBotDmgF('building');
    return 1;
  }

  /**
   * 建築陣亡後推進階段;整階被推平時發事件(客戶端劇情對話的觸發來源,見 public/js/storytalk.js)。
   * `stage` = **剛被推平的那一階**(不是新開放的那一階):對話的語意是「你剛剛拔掉了他們的前線砲塔」。
   * 非劇情戰役照樣記帳(成本是一個整數遞減),但不發事件也不鎖血 ⇒ 對局行為逐位元不變。
   */
  _siegeFell(t) {
    const left = this._siegeLeft[t.side];
    if (!left || t.sg == null) return;
    left[t.sg] = Math.max(0, left[t.sg] - 1);
    const open = siegeOpenStage(left);
    if (open === this._siegeOpen[t.side]) return;
    const fell = this._siegeOpen[t.side];
    this._siegeOpen[t.side] = open;
    if (this.siege) this.events.push({ e: 'siege', side: t.side, stage: fell });
  }

  /**
   * 區域 BOSS 全滅(整隊,呼叫端 = `_kill` 的 BOSS 分支)。這一階的最後一名 BOSS 倒下時:
   *   ① 起算對白窗(`siegeTalkS`;主堡那一階回 0 = 當場解禁,見 SIEGE.TALK_S 的 ⚠);
   *   ② 發 `siegeTalk` 事件 —— **劇情對白的觸發點自 2026-08-14 起是這裡,不再是「整階被推平」**。
   *      使用者的順序是「BOSS 被擊敗 → 對話 → 才拆得掉建築」,對白掛在推平上就永遠慢一步
   *      (而且那時建築早就沒了,鎖不鎖已經沒有意義)。
   * 逐階記帳而不是「全場剩幾個 BOSS」:三名 BOSS 各守一階,前線那位倒下時中段的還活著。
   */
  _bossFell(t) {
    const left = this._bossLeft[t.side];
    if (!left || t.sg == null) return;
    left[t.sg] = Math.max(0, left[t.sg] - 1);
    if (left[t.sg] > 0) return;
    this._talkUntil[t.side][t.sg] = this.t + siegeTalkS(t.sg);
    this.events.push({ e: 'siegeTalk', side: t.side, stage: t.sg });
  }

  // ---------- NPC BOSS(劇情戰役的敵方電腦玩家;見 data.js BOSS)----------
  /**
   * 這一隊是 BOSS 嗎。判據 = **這一場有防守方、而且它就是那一邊** —— 劇情戰役的敵方席位
   * 全是電腦玩家(main.launchStoryBattle 逐一 addBot),故不必也 MUST NOT 另外判「是不是 bot」:
   * 判 bot 的話,日後只要有人以觀戰/接管的方式坐進那個席位,同一台機體就會在 BOSS 與
   * 一般英雄之間切換(HP 上限、狂暴進度、活動範圍全部跟著跳)。
   */
  isBoss(h) { return !!(this.defSide && h && h.side === this.defSide); }

  /**
   * BOSS 據點的世界座標(公尺)。階段 0/1 = 前線/中段塔位,SIEGE.BASE = 主堡;
   * 同一據點多名 BOSS 沿**該處的法線**左右錯開(`bossSlotOff`)。
   * 塔位一律吃 `this.towerSites`(與 `_spawnStructures` 同一份解),MUST NOT 再解一次。
   */
  _bossAnchor(stage, k) {
    const def = this.defSide;
    const off = bossSlotOff(k);
    const sites = this.towerSites?.[0] || [];
    // 回傳序 = [後塔, 前塔] ⇒ 階段 0(前線)取末項、階段 1(中段)取其前一項(見 solveTowerSites)
    const site = stage < SIEGE.BASE ? sites[sites.length - 1 - stage] : null;
    const p = site && site[def];
    if (p) return { x: p.x + p.nx * off, z: p.z + p.nz * off };
    // 主堡沒有塔位法線可用 ⇒ 取兵線在主堡那一端的切向的法線(單兵線:index 0 / 末端 = 兩座主堡)
    const [bx, bz] = this.basePos[def];
    const pts = this.lanes[0] || [];
    const a = def === 'SWARM' ? pts[0] : pts[pts.length - 1];
    const b = def === 'SWARM' ? pts[1] : pts[pts.length - 2];
    if (!a || !b) return { x: bx, z: bz + off };
    const dx = b[0] - a[0], dz = b[1] - a[1], L = Math.hypot(dx, dz) || 1;
    return { x: bx + (dz / L) * off, z: bz - (dx / L) * off };
  }

  /**
   * 這一隊 BOSS 的段位同步(**唯一縫**):HP 比例 → 已擊破段數,進位就讓攻擊四軌各升一級。
   * 段位量的是**小隊總量**(含已墜毀那幾架:BOSS 不重生 ⇒ 那份 HP 是永久沒了),見 BOSS 檔頭 ①。
   * 只增不減 —— 恢復被 `_healBody` 夾在當前段的天花板之下,理論上回不去,這一格是保險。
   */
  _bossSync(sq) {
    if (!sq || !sq.boss) return;
    let hp = 0, max = 0;
    for (const b of sq.bodies) { hp += Math.max(0, b.hp); max += b.maxHp; }
    const seg = max > 0 ? bossSegOf(hp / max) : 0;
    if (seg <= sq.bossSeg) return;
    for (let k = sq.bossSeg; k < seg; k++) this._bossEnrage(sq);
    // 進入新階段 ⇒ **無敵時間**(第2/3/4階段為 2/3/4 秒)與**護盾補滿**(MUST 排在狂暴之後)
    const invS = bossInvulnS(seg);
    for (const b of sq.bodies) {
      if (!b.dead) {
        b.sp = b.maxSp;
        if (invS > 0) b.invUntil = Math.max(b.invUntil || 0, this.t + invS);
      }
    }
    sq.bossSeg = seg;
    this.events.push({ e: 'bossSeg', pid: sq.pid, side: sq.side, seg });
  }

  /**
   * 狂暴化一級:**八軌各 +1 階**(2026-08-14 使用者「敵方 BOSS 防禦面也會隨著 HP 階段升級」——
   * 舊制只推攻擊四軌)。名冊走 `ECON.UPGRADES` 全表,MUST NOT 手寫「防禦四軌」的清單:
   * 加第九軌時手寫的那一份會靜默過期。陣營小兵強化仍恆 Lv0(入口只有 `buy`,而 `buy` 對 BOSS
   * 直接拒絕)。階級推進走 `_applyUpg` 同一支(與玩家購買共用),MUST NOT 在這裡自己寫
   * `h.abil[x] = …`:升階可能加大彈夾,漏掉那一段清空的話 BOSS 會拿著舊彈匣計數打到下一次裝填。
   *
   * **裝甲上限(`hp` 軌)MUST 等比放大當下 HP**(見 data.js BOSS 檔頭 ⑥㋑):`_applyUpg` 的 hp 軌
   * 是「上限與當下血量同時 +Δ」= 把新增的那一截補滿,直接違反「補血不得回到上一階」;而只放大
   * 上限的話 `Σhp/Σmaxhp` 當場掉下去 ⇒ `_bossSync` 連鎖狂暴到頂。等比放大兩個坑都躲得掉:
   * 段位比例逐位元不變,拿到的是純粹的 EHP。
   */
  _bossEnrage(sq) {
    const h = this.heroes.get(sq.pid) || sq.bodies[0];
    if (!h) return;
    for (const [item, up] of Object.entries(ECON.UPGRADES)) {
      if ((h.upg[item] || 0) >= up.max) continue;
      const bodies = this._bodies(h);
      const frac = item === 'hp' ? bodies.map((b) => (b.maxHp > 0 ? b.hp / b.maxHp : 0)) : null;
      h.upg[item] = (h.upg[item] || 0) + 1;
      this._applyUpg(h, item, up);
      if (frac) bodies.forEach((b, i) => { b.hp = Math.min(b.maxHp, Math.round(b.maxHp * frac[i])); });
    }
  }

  _add(e) {
    e.id = nextEntId++;
    e.maxHp = e.hp;
    e.cd = 0;
    this.ents.set(e.id, e);
    return e;
  }

  /**
   * 出生/重生點:每名玩家(squadIdx)分配到不同兵線 + 交替左右側,彼此避開;沿該兵線推出
   * 主堡 HERO_SPAWN_OFF(> NPC 波次生成點沿線距離 WAVE_SPAWN_OFF_M,故落在 NPC 隊列之前),
   * 再垂直偏到路旁(避開落在兵線中央的 NPC 生成點)。同隊各機(bodyIdx)沿側向再錯開不疊在一起。
   */
  _spawnPoint(side, squadIdx = 0, bodyIdx = 0) {
    const [bx, bz] = this.basePos[side];
    const lanes = this.lanes.filter((p) => p.length >= 2);
    if (!lanes.length) return [bx + squadIdx * 14 + bodyIdx * 8, bz + squadIdx * 8 + bodyIdx * 5];
    const nL = lanes.length;
    const li = squadIdx % nL;                                     // 不同玩家分散到不同兵線
    const layer = Math.floor(squadIdx / nL);                      // 兵線數用罄後的外圈
    const s = layer % 2 === 0 ? 1 : -1;                           // 交替兵線左右兩側
    const pts = lanes[li];
    const end = side === 'SWARM' ? pts[0] : pts[pts.length - 1];
    const nxt = side === 'SWARM' ? pts[1] : pts[pts.length - 2];
    let dx = nxt[0] - end[0], dz = nxt[1] - end[1];
    const l = Math.hypot(dx, dz) || 1; dx /= l; dz /= l;          // 沿兵線指向戰場
    const px = dz, pz = -dx;                                      // 兵線垂直向(路旁)
    // 側偏:基準偏移 + 外圈漸遠 + 同隊各機錯開(都 < 走廊半寬 LANE_SAFE_M 45,仍貼兵線)
    const lat = GAME.HERO_SPAWN_SIDE + Math.floor(layer / 2) * 11 + bodyIdx * 10;
    return [end[0] + dx * GAME.HERO_SPAWN_OFF + px * lat * s,
      end[1] + dz * GAME.HERO_SPAWN_OFF + pz * lat * s];
  }

  // ---------- 英雄(每陣營可多位,以玩家 pid 為鍵;ch = 角色 id)----------
  addHero(side, pid, ch) {
    if (this.heroes.has(pid)) return this.heroes.get(pid);
    // 角色未指定(默認隨機):抽同陣營未被使用的角色(池含雙陣營共用的傭兵)
    if (!CHARACTERS[ch] || (CHARACTERS[ch].side !== side && CHARACTERS[ch].side !== 'MERC')) {
      const used = new Set([...this.heroes.values()].filter((x) => x.side === side).map((x) => x.ch));
      const pool = charsOf(side).filter((id) => !used.has(id));
      ch = (pool.length ? pool : charsOf(side))[Math.floor(Math.random() * (pool.length ? pool.length : charsOf(side).length))];
    }
    const kind = heroKindOf(ch, side); // drone | robot(傭兵機體綁角色,不隨陣營)
    const c = CHARACTERS[ch];
    const m = c.mods || {};
    const u = UNITS[kind];
    const idx = this.squads.size ? [...this.squads.values()].filter((s) => s.side === side).length : 0;
    // 同陣營多英雄:分散到不同兵線兩側 + 避開 NPC 生成點(見 _spawnPoint;逐機於下方 body 迴圈取點)
    const mp = Math.round(u.mp * (m.mp ?? 1));
    const sq = {
      pid, side, ch, kind, act: 0, bodies: [],
      lock: 0, lockAt: -99,          // 準星鎖定(光暈 / 被鎖定警告 / 自殺攻擊機的追蹤目標)
      decoys: [], decoyCd: 0,        // 機甲餌機:目前在空中的那些(2026-08-07 起兩個槽位可能各一架)
      kamis: [], kamiCd: 0,          // 無人機自殺攻擊機:目前在空中的那些 / F 鍵冷卻到期時刻
      ps: {                          // 共用玩家狀態(見 SQUAD_SHARED)
        // 八軌升級(2026-07-20 面向改制):4 戰鬥面向(lw/hw/sk/ult,推進 abil 階)+ 4 防禦系統(見 ECON.UPGRADES)
        money: ECON.START, upg: { lw: 0, hw: 0, sk: 0, ult: 0, hp: 0, ar: 0, sp: 0, ch: 0 },
        ammo: {}, reloadUntil: {}, fireAt: {}, buffs: {},
        mp, maxMp: mp, mpRegen: u.mpRegen,
        // 招式開場即 Lv1 可用(2026-07-20;不再需擊殺數解鎖)
        abil: { light: 1, heavy: 1, skill: 1, ult: 1 },
        acd: { skill: 0, ult: 0 }, kn: 0,   // kn = 戰鬥分數(八軌升級門檻;只增不減,見 data.BATTLE_SCORE)
        mods: [],                    // 招式增益 [{k, m, until}]
        empUntil: 0, stealthUntil: 0, blindUntil: 0, aiming: false, lastBurst: 0,
        markUntil: 0, unbalUntil: 0, // 定位標記 / 失衡異常狀態
      },
    };
    // ---- NPC BOSS(劇情戰役的防守方;見 data.js BOSS)----
    // 席次順序 = **到場序**(main.launchStoryBattle 逐一 addBot ⇒ b1…bn 依序落在前/中/後),
    // 名額表由 `bossSlotPlan` 定(3 名 1:1:1、5 名 1:2:2,使用者指定)。
    // 三件事在這裡一次定案:HP ×BOSS.HP_MUL(逐機體 ⇒ 小隊總量也剛好 ×10)、據點階段 `sg`
    // (= 攻堅鎖血吃的那一格,BOSS 因此與同階砲塔同進退)、活動範圍(bots._move 的唯一消費端)。
    const boss = this.isBoss({ side });
    let hold = null;
    if (boss) {
      const plan = bossSlotPlan(this.teamSize || 0);
      const slot = this._bossSlot[side]++;
      sq.bossStage = plan[slot] ?? SIEGE.BASE;
      sq.bossSeg = 0;
      sq.boss = true;
      // 同一階第幾名(左右錯開用):數一數前面有幾個人也分到這一階
      const k = plan.slice(0, slot).filter((s) => s === sq.bossStage).length;
      hold = { ...this._bossAnchor(sq.bossStage, k), r: bossZoneR() };
      this.bossHold.set(pid, hold);
      // 逐階存活數點名:`_spawnStructures` 在建構期就數完了(那時還沒有英雄)⇒ BOSS 進場時
      // MUST 自己補記一筆,否則它守的那一階在鎖血眼裡是空的 —— 前線 BOSS 還活著中段就解鎖了。
      const left = this._siegeLeft[side];
      if (left) { left[sq.bossStage] = (left[sq.bossStage] || 0) + 1; this._siegeOpen[side] = siegeOpenStage(left); }
      // 區域 BOSS 關卡的點名(見 siegeHpFloor):同一階可能不只一名(5 名 BOSS = 前中後 1:2:2)
      this._bossLeft[side][sq.bossStage] = (this._bossLeft[side][sq.bossStage] || 0) + 1;
    }
    const n = kind === 'drone' ? SQUAD.N : 1;
    for (let i = 0; i < n; i++) {
      const [ox, oz] = hold
        ? [hold.x + bossSlotOff(i) , hold.z]          // BOSS:整組就位在據點上(小隊多架則橫向錯開)
        : this._spawnPoint(side, idx, i);
      const b = this._add({
        kind, side, pid, ch, si: i, spawnIdx: idx,
        x: ox, z: oz, y: 0, ry: 0,
        ...(boss ? { boss: true, sg: sq.bossStage } : {}),
        hp: Math.round(u.hp * (m.hp ?? 1) * (boss ? BOSS.HP_MUL : 1)), hero: true,
        dead: false, respawnAt: 0, deaths: 0, aaCd: 0,
        // 雙層 HP:護盾(脫戰自然回復)+ 裝甲(hp;護甲值 armor 減免)
        armor: heroArmor(ch), lastHitAt: -99,   // 無人機護甲等比縮放至機甲平均 ×HP_F(見 data.heroArmor)
        dash: 0, rg: false,          // 僚機:衝刺自爆目標 / 歸隊中
      });
      b.maxSp = Math.round(u.shield * (m.sp ?? 1));
      b.sp = b.maxSp;
      this._bindShared(b, sq);
      sq.bodies.push(b);
    }
    this.squads.set(pid, sq);
    this.heroes.set(pid, sq.bodies[0]);
    return sq.bodies[0];
  }

  /** 把共用玩家狀態掛成 ent 上的存取器 —— 三架機體讀寫同一份 sq.ps */
  _bindShared(b, sq) {
    b.sq = sq;
    const props = {};
    for (const k of SQUAD_SHARED) {
      props[k] = { get: () => sq.ps[k], set: (v) => { sq.ps[k] = v; }, enumerable: true, configurable: true };
    }
    Object.defineProperties(b, props);
  }

  /** 全體機體(所有小隊的所有機體;跟 heroes.values() 不同,後者一隊只有主視野那架) */
  *_allBodies() {
    for (const sq of this.squads.values()) for (const b of sq.bodies) yield b;
  }

  _bodies(h) { return h.sq ? h.sq.bodies : [h]; }
  _aliveN(h) { return this._bodies(h).filter((b) => !b.dead).length; }

  /**
   * 指定主視野機體。i 為 null / 已陣亡 → 自動挑第一架存活的;
   * 全滅時主視野留在原機(客戶端才看得到死亡畫面與重生倒數)。
   */
  _promote(sq, i = null) {
    if (i == null || !sq.bodies[i] || sq.bodies[i].dead) {
      const k = sq.bodies.findIndex((b) => !b.dead);
      i = k >= 0 ? k : sq.act;
    }
    const b = sq.bodies[i];
    if (this.heroes.get(sq.pid) === b) return false;
    sq.act = i;
    b.dash = 0;      // 接管主視野 = 玩家操控,取消自爆衝刺
    b.rg = false;
    this.heroes.set(sq.pid, b);
    this.events.push({ e: 'swap', pid: sq.pid, id: b.id });
    return true;
  }

  /** 切換主視野(客戶端 V / 1~3);目標機體陣亡則忽略 */
  heroSwap(pid, i) {
    const sq = this.squads.get(pid);
    if (!sq || this.over || sq.bodies.length < 2) return;
    if (i == null) {   // 循環切換到下一架存活機體
      for (let k = 1; k < sq.bodies.length; k++) {
        const j = (sq.act + k) % sq.bodies.length;
        if (!sq.bodies[j].dead) { this._promote(sq, j); return; }
      }
      return;
    }
    if (!sq.bodies[i] || sq.bodies[i].dead) return;
    this._promote(sq, i);
  }

  /**
   * 準星鎖定敵方目標:客戶端「射程內 + 準星對準」時回報,伺服器複驗距離與視野後成立。
   * 成立 → 廣播 lock 事件(施放者畫光暈、目標本人跳被鎖定警告);
   * 無人機另外沿用它當自爆衝刺目標、機甲當餌機的追蹤目標。中立物與友軍不鎖。
   */
  heroLock(pid, targetId) {
    const sq = this.squads.get(pid);
    if (!sq || this.over) return;
    const h = this.heroes.get(pid);
    if (!h || h.dead) return;
    if (this._blinded(h)) return;
    const t = this.ents.get(targetId);
    if (!t || t.neutral || t.gar || t.side === sq.side || t.hp <= 0 || (t.hero && t.dead)) return;
    // 射程閘門:用玩家當下手上那把武器(瞄準中 = 重武器),留與 heroHit 同一份彈道寬容
    const wp = this._heroWeapon(h, h.aiming ? 'heavy' : 'light');
    if (!wp) return;
    const ty = t.hero || t.kind === 'heli' || t.decoy ? (t.y || 0) : 0;
    // 量到近側表面(_surfD3):鎖定光暈的語意 = 「準星壓在表面上且打得到」,與 heroHit 閘門同一把尺
    if (this._surfD3(Math.hypot(t.x - h.x, t.z - h.z, ty - (h.y || 0)), t) > wp.def.range * RANGE_TOL) return;
    // 迷霧內的目標不可鎖定(與 heroHit 同一條規則:看不見 = 沒有火控解)
    const pulse = this.visionUntil?.[h.side] > this.t;
    if (!pulse && !this._visibleTo(t, h.side, this._visionSources(h.side))) return;
    // 實體障礙後的目標沒有火控解(與 heroHit 同一條 LOS 規則)
    if (this._losBlocked(h.x, h.z, (h.y || 0) + LOS.EYE_M, t.x, t.z, this._tgtY(t), h, t)) return;
    sq.lock = targetId;
    sq.lockAt = this.t;
    this.events.push({ e: 'lock', pid, side: sq.side, tid: targetId, tpid: t.pid ?? null });
  }

  // ---------- 武器解析 / 開火閘門(射速 + 彈夾 + 填彈,伺服器把關)----------
  /** w: 'light'|'heavy';'gun'/缺值 = 輕武器。回傳 {id, def}(def 已含英雄倍率與階級) */
  _heroWeapon(h, w) {
    const id = (!w || w === 'gun' || w === 'light') ? 'light' : (w === 'heavy' ? 'heavy' : null);
    if (!id) return null;
    const def = heroWeapon(h.ch, id, h.abil[id] || 1, true);
    return def ? { id, def } : null;
  }

  /** 填彈/冷卻時間:武器基準 × 招式增益(2026-07-20:填彈折減併入武器階級,無獨立精通;客戶端 HUD 同一條公式) */
  _reloadT(h, def) {
    let r = def.reload * this._buffMul(h, 'reload');
    if (h.sq?.boss && (h.sq.bossSeg || 0) >= 3) r *= BOSS.ENRAGE_RELOAD_F;
    return r;
  }

  /**
   * 開火判定:射速上限、填彈中禁射、彈夾耗盡自動填彈。
   * 重武器擊發需電力(heavyMpCost,隨重武器階級)—— 電力不足視同禁射。
   * lenient=true 給網路延遲寬容(真人客戶端);bot 用嚴格射速。
   *
   * back(秒):**回報延遲** —— AoE 彈頭是著彈才回報,這一發其實是 back 秒前擊發的。
   *   只用來把**裝填計時器**接回擊發時刻:客戶端的彈夾/裝填一向從擊發當下起算(平衡模型
   *   tools/duel.mjs 也只看 rate/reload,不含飛行時間),伺服器從著彈起算 = 整個週期比客戶端
   *   晚 back 秒 ⇒ 下一輪第一發只要打在**比上一發更近**的目標,著彈時伺服器還在裝填 = 靜默丟棄
   *   (巡飛彈的 back 在 0~3.3 秒之間浮動,幾乎每個裝填週期都中一次)。
   *   **射速閘刻意仍量真實時鐘**:著彈順序可能與擊發順序相反(遠打完再打近),拿回推時鐘量
   *   間隔會把後到的那一發誤判成「太快」而誤殺。
   */
  _gateFire(h, id, def, lenient, back = 0) {
    const now = this.t;
    // 2026-08-01:舊巨砲(重砲模式)的「這一發免彈夾/免電力/免射速閘」旁路隨機甲改招整組移除。
    // **MUST NOT 復辟**:機甲的長按招式已是獨立實體(極音速飛彈),與重武器彈夾完全脫鉤 ——
    // 重武器射擊路徑上不該再存在任何跳過彈夾/電力/射速閘的分支。
    this._refillIfDone(h, id, def);                                // 填彈完成 → 補滿(單一縫)
    if ((h.reloadUntil[id] || 0) > now) return false;              // 填彈中
    const rateMul = (h.sq?.boss && (h.sq.bossSeg || 0) >= 3 ? BOSS.ENRAGE_RATE_F : 1);
    if (now - (h.fireAt[id] || 0) < 1 / (def.rate * rateMul * (lenient ? 1.5 : 1))) return false;
    if (h.ammo[id] == null) h.ammo[id] = def.mag;
    // 超載(t02「同步率 100%」):時窗內免裝填 —— 見底就地補滿,不進填彈計時器。
    // MUST 排在「打空 → 開始填彈」之前,否則彈匣一見底就先被推進填彈窗,免裝填等於沒有。
    if (h.ammo[id] <= 0 && (h.noReloadUntil || 0) > now) h.ammo[id] = def.mag;
    if (h.ammo[id] <= 0) { h.reloadUntil[id] = now - back + this._reloadT(h, def); return false; }
    const mpc = id === 'heavy' ? heavyMpCost(def) : 0;
    if (mpc > 0 && h.mp < mpc) return false;   // 重武器電力不足:禁射(小隊電力共用,只扣一次)
    h.fireAt[id] = now;
    h.ammo[id]--;
    if (mpc > 0) h.mp -= mpc;
    if (h.ammo[id] <= 0 && (h.noReloadUntil || 0) <= now) h.reloadUntil[id] = now - back + this._reloadT(h, def);  // 打空自動填彈(接回擊發時刻)
    // 破隱爆發窗(m08;2026-08-06):**開火現形那一刻**才開窗 —— 這一行正是唯一的「現形」時刻,
    // 所以窗也只能開在這裡(在 _castEffect 就開 = 躲著不開火也在燒那一秒)。
    if ((h.alphaArm || 0) > now && (h.stealthUntil || 0) > now) {
      h.mods.push({ k: 'dmg', m: h.alphaX || 1, until: now + SELF_ULT.ALPHA_S });
      h.alphaArm = 0;
    }
    h.stealthUntil = 0;   // 開火即現形(匿蹤破除)
    return true;
  }

  /**
   * 填彈完成 → 補滿彈匣(**單一縫**:`_gateFire` 與 `heroReload` 同吃)。
   *
   * 伺服器的補彈是**惰性**的(沒有逐 tick 掃描):`reloadUntil` 過期之後彈匣仍寫著 0,
   * 要等下一次開火判定才補回去。⇒ 任何要讀 `h.ammo` 下決定的路徑 MUST 先過這一支,
   * 否則讀到的是「其實早就填完了」的 0。
   *
   * 2026-08-03 使用者回報「榴彈投擲/射後不理/雷射導引只有第一擊有傷害、後續都沒傷害」
   * 就是漏了這一步:客戶端彈匣見底會送 `{t:'reload'}`(而且送的時刻是**擊發當下**,
   * AoE 彈頭還在天上),`heroReload` 讀到過期的 `ammo = 0` ⇒「彈匣已滿就不重裝」那道
   * 守衛失效 ⇒ 每個彈匣都把 `reloadUntil` 重新推到一整個 reload 之後,而下一批彈頭全部
   * 落在那個填彈窗裡被靜默丟棄;彈匣因此永遠補不回來 = 從第二個彈匣起整場零傷害。
   */
  _refillIfDone(h, id, def) {
    if ((h.reloadUntil[id] || 0) > 0 && this.t >= h.reloadUntil[id]) {
      h.ammo[id] = def.mag;
      h.reloadUntil[id] = 0;
    }
  }

  /** 主動填彈(R 鍵 / 客戶端彈匣見底的回報):未滿且不在填彈中才會觸發 */
  heroReload(pid, w) {
    const h = this.heroes.get(pid);
    if (!h || h.dead || this.over) return;
    const wp = this._heroWeapon(h, w);
    if (!wp || wp.def.mag == null) return;
    if (h.ammo[wp.id] == null) h.ammo[wp.id] = wp.def.mag;
    this._refillIfDone(h, wp.id, wp.def);   // 先結清上一輪填彈,再判「要不要重裝」(見 _refillIfDone)
    if (h.ammo[wp.id] >= wp.def.mag || (h.reloadUntil[wp.id] || 0) > this.t) return;
    h.ammo[wp.id] = 0;
    h.reloadUntil[wp.id] = this.t + this._reloadT(h, wp.def);
  }

  /** 英雄傷害倍率(目標類別剋制 × 招式增益;火力成長走武器面向 lw/hw 的階級數值)。
   *  2026-08-01:巨砲移除後這裡**恆無任何情境倍率**;MUST NOT 為新招式在此加特例(招式傷害走 hyperBlast)。
   *  2026-08-02:對建築的額外加成(舊 grenadeBuildingMul)已整組移除,MUST NOT 復辟。
   *  護盾/裝甲分軌剋制**不在這裡** —— 那要看目標當下的護盾水位,只能在 _damage 分層時結算。 */
  _heroDmg(h, def, targetKind) {
    return def.dmg * vsMult(def, targetKind) * this._buffMul(h, 'dmg');
  }

  /** 空中判定:無人機/直升機/集束轟炸機/護衛機/極音速飛彈恆算飛行;其餘以高度 ≥ AA_MIN_ALT 論 */
  _airborne(e) {
    return e.kind === 'drone' || e.kind === 'heli' || e.kind === 'decoy' || e.kind === 'kami' || e.kind === 'hyper'
      || e.kind === 'hyper' || (e.y || 0) >= GAME.AA_MIN_ALT;
  }

  /**
   * 機體「視線點」絕對高程(高度差空戰用,見 data.js ALTITUDE)。英雄取客戶端回報的絕對視線高程 ay
   * (地形+跳躍+飛行皆含;缺值 = bot/測試,退回離地眼高近似);塔/主堡取砲位視線高(高聳工事);小兵取離地小視線高。
   * 註:伺服器為 2D 平面無地形高程,NPC/塔以離地眼高近似(地形基準視為 0)—— 動態飛行/跳躍(英雄 ay)精確。
   * `abs=false` = 強制**離地框**(英雄也吃 `y`):跨框比較的唯一出口見 `_altDh`。
   */
  _sightY(e, abs = true) {
    if (!e) return 0;
    if (e.kind === 'tower' || e.kind === 'base') return LOS.TOWER_EYE_M;
    if (e.hero) return abs && e.ay != null ? e.ay : (e.y || 0) + LOS.EYE_M;
    if (e.kind === 'heli' || e.decoy || e.kami || e.hyper) return (e.y || 0) + LOS.EYE_M;
    return (e.y || 0) + LOS.TGT_M;
  }

  /**
   * 兩機體視線點的高度差 `a − b`(高度差空戰的**唯一量法**;射程/爆擊/閃避三個消費端同吃)。
   *
   * **同框才准相減**:`_sightY` 對英雄回的是客戶端量測的**絕對**高程 `ay`(含地形海拔),
   * 對 NPC/塔/主堡回的是**離地**高(伺服器是無地形的 2D 平面,地基恆 0)—— 兩者相減
   * 等於拿場地海拔當高度差。真實場地海拔動輒數百公尺,遠超 altScale 的封頂門檻
   * (3 個砲塔高 = 78m)⇒ 英雄對**所有** NPC 恆判「高出一整個封頂」= 恆 +25% 射程、
   * 爆擊代價也恆數套用。而客戶端射程光暈量的是本地地形高差(平地恆 1)⇒ 光暈與伺服器
   * 實際結算差 25%:2026-08-01 使用者回報的「攻擊範圍異常,沒有射程光暈的敵人也打得到」。
   *
   * 規則只有一條:**兩邊都拿得到絕對高程**(= 雙方都是回報 `ay` 的英雄)才用絕對框,
   * 否則一律退回離地框。伺服器算不出 NPC 的地形海拔 ⇒「寧缺勿錯」(原則 6):
   * 寧可不給高地加成,也 MUST NOT 給一個客戶端看不到、光暈對不上的加成。
   */
  _altDh(a, b) {
    if (!a || !b) return 0;
    if (a.hero && a.ay != null && b.hero && b.ay != null) return a.ay - b.ay;
    return this._sightY(a, false) - this._sightY(b, false);
  }

  /** 高度差「射程」乘數:較高的一方 +射程(封頂 +RANGE);同高/較低 = 1(曲線見 data.js altRangeF)。
   *  2026-08-06 起同時併入招式的**射程加成**(mods 的 `range` 鍵,m04「全境盡職調查」)——
   *  每一道射程閘門本來就都經過這一支,加在這裡才只有一份;散到各閘門去乘就是第二份實作,
   *  症狀是「某幾條攻擊路徑吃得到加成、某幾條吃不到」,而且沒有任何錯誤訊息。 */
  _altRange(shooter, target) {
    if (!shooter || !target) return 1;
    return altRangeF(this._altDh(shooter, target)) * (shooter.hero ? this._buffMul(shooter, 'range') : 1);
  }

  /** 高度差「爆擊」乘數 {rate, dmg}(施加在 shooter→target 這一擊):較高方攻擊時爆率/爆傷↓、受擊時↑ */
  _altCrit(shooter, target) {
    if (!shooter || !target) return { rate: 1, dmg: 1 };
    const dh = this._altDh(shooter, target);
    const s = altScale(dh);
    if (s <= 0) return { rate: 1, dmg: 1 };
    if (dh > 0) return { rate: 1 - ALTITUDE.ATK_CRIT_RATE * s, dmg: 1 - ALTITUDE.ATK_CRIT_DMG * s };  // 較高方向下攻擊
    return { rate: 1 + ALTITUDE.RCV_CRIT_RATE * s, dmg: 1 + ALTITUDE.RCV_CRIT_DMG * s };              // 較高方受下方仰攻
  }

  /**
   * 爆擊擲骰(FPS:直擊武器限定,AoE 不爆);爆中推事件給客戶端跳橘字。
   * 高度差(_altCrit):爆率 ×rate;爆傷**加成部分**(critX − 1)×dmg —— 較高方攻擊時弱化、受擊時強化。
   * 失衡狀態(_isUnbalanced):飛行機體受擊失衡時暴擊率減半(FLIGHT.UNBAL_CRIT_MUL, 2026-09-01 使用者需求)。
   */
  _rollCrit(h, def, dmg, t) {
    if (!def.crit) return dmg;
    const ac = this._altCrit(h, t);
    const unbalF = this._isUnbalanced(h) ? FLIGHT.UNBAL_CRIT_MUL : 1;
    if (Math.random() >= def.crit * ac.rate * unbalF) return dmg;
    const v = dmg * (1 + ((def.critX || VITALS.CRIT_X) - 1) * ac.dmg);
    this.events.push({ e: 'crit', pid: h.pid, x: t.x, z: t.z, y: t.hero ? (t.y || 0) : 0, v: Math.round(v) });
    return v;
  }

  /** 命中附帶 EMP(訊號矛/諧振波炮之類):敵方英雄武器短暫離線;負面狀態 = 助攻貢獻 */
  _applyHitEmp(h, def, t) {
    if (!def.emp || !t.hero) return;
    if (this._buffVal(t, 'ccImm') > 0) return;   // 異常免疫(s12「滿天星座」)
    t.empUntil = Math.max(t.empUntil || 0, this.t + def.emp);
    if (h && h.hero && h.side !== t.side) (t.asst ||= {})[h.pid] = this.t;
  }

  /** 詞綴強化 × 招式增益乘數(dmg/reload/dmgTaken/bounty;過期即清,全部伺服器結算) */
  _buffMul(h, key) {
    let m = 1;
    for (const id in h.buffs || {}) {
      if (h.buffs[id] <= this.t) { delete h.buffs[id]; continue; }
      const a = AFFIXES[id];
      if (a?.[key]) m *= a[key];
    }
    if (h.mods) {
      for (let i = h.mods.length - 1; i >= 0; i--) {
        const md = h.mods[i];
        if (md.until <= this.t) { h.mods.splice(i, 1); continue; }
        if (md.k === key) m *= md.m;
      }
    }
    if (key === 'dmg' && h.sq?.boss && (h.sq.bossSeg || 0) >= 3) m *= BOSS.ENRAGE_DMG_F;
    return m;
  }

  /** 電磁癱瘓中?(武器與招式全數離線) */
  _jammed(h) { return (h.empUntil || 0) > this.t; }

  /** 閃光彈致盲中?(視野來源與火控皆暫停) */
  _blinded(h) { return (h.blindUntil || 0) > this.t; }

  /** 招式增益的「數值型」欄位(吸血比例/完美迴避旗標):取生效中最大值,無則 0。
   *  與 _buffMul(乘數疊加)分開 —— 這類效果多來源取最強,不相乘。 */
  _buffVal(h, key) {
    let v = 0;
    if (h.mods) for (const md of h.mods) {
      if (md.k === key && md.until > this.t) v = Math.max(v, md.m);
    }
    return v;
  }

  heroPos(pid, x, y, z, ry, wet, lev, ay) {
    const h = this.heroes.get(pid);
    if (!h || h.dead || this.over) return;
    // 瞬時移速(閃避判定用):this.t 只在 tick 前進(8Hz),同一 tick 內多次回報 dt=0 略過。
    // 首次回報先初始化 _posT(否則 dt 恆為 0、_spd 永遠算不出來 = 閃避永遠不觸發)。
    if (h._posT == null) h._posT = this.t;
    const dt = this.t - h._posT;
    if (dt > 0) { h._spd = Math.hypot(x - h.x, z - h.z) / dt; h._posT = this.t; }
    h.x = x; h.y = y; h.z = z; h.ry = ry;
    // 絕對視線高程(地形+跳躍+飛行;高度差空戰 _sightY 用)—— 位置本就客戶端權威,ay 同屬輸入。缺值退回離地眼高近似。
    if (Number.isFinite(ay)) h.ay = ay;
    // 領機身處環境(0 乾 / 1 水 / 2 沼 / 3 凍結;客戶端偵測回報 —— 位置本就客戶端權威,env 同屬輸入非狀態改寫)。
    // 環境改變即重置滯留計時(_wetT);沼澤扣血/停恢復、水域停電力/凍結 CD 換彈 皆在 tick 依此結算。
    const w = wet === 1 || wet === 2 || wet === 3 ? wet : 0;
    if (w !== (h.wet || 0)) { h.wet = w; h.wetT = this.t; }
    h.lev = lev === 1 || lev === 2 ? lev : 0;   // 所在結構層(0 地面 / 1 橋面 / 2 隧道):slab LOS 用(#1)
  }

  // ---------- 擊發位置軌跡(射程球心的唯一來源)----------
  /**
   * 每 tick 記一筆機體位置(扁平三元組 `t, x, z`)。
   *
   * 2026-08-05 使用者定案「射程半球的計算應該要是由彈藥擊發的那個位置計算,後續機體的移動
   * 不影響」。客戶端一向如此(`b.origin = muzzle.clone()`);伺服器沒有這份記憶 —— AoE 彈頭
   * 是**著彈**才回報,而回報進來的時候機體早就走掉了。**唯一寫入點**是這一支(每 tick 一次、
   * 每架機體一筆:真人領機的位置來自 `heroPos`、僚機來自 `_tickSquads`、bot 來自 `bots._move`,
   * 三條路都在 tick 尾端沉澱完畢 ⇒ 收在同一個取樣點才不會三份時間軸各走各的)。
   *
   * 取樣率 = tick 率(8Hz):粗到 125ms,但落點閘門本來就有 `RANGE_TOL` 這道網路寬容可以吸收
   * (最快機體 125ms 走不到 3m),而球心從「跟著機體跑」變成「釘在擊發那一刻」是差**幾十公尺**
   * 的事 —— 拿更高的取樣率換那 3m 不划算。
   *
   * 陣亡中不記(重生是瞬移:`_respawn` 一併清帳,否則會回推到上一條命的位置)。
   */
  _trailPush(b) {
    if (b.dead) return;
    const tr = b._trail || (b._trail = []);
    tr.push(this.t, b.x, b.z);
    // 保留窗推導不手寫(data.js shotTrailS)。**多留一筆早於窗口的樣本**:回推的解可能剛好落在
    // 窗口邊界上,砍到剛好就沒有東西可以內插到那一刻。
    const cut = this.t - shotTrailS();
    let i = 0;
    while (i + 3 < tr.length && tr[i + 3] <= cut) i += 3;
    if (i > 0) tr.splice(0, i);
  }

  /**
   * 這一發的**擊發位置**(射程球心)與擊發時刻回推量 `back`。
   *
   * 回推方式:由新到舊掃軌跡,取第一筆滿足「已經過去的時間 ≥ 從那個位置打到落點要飛的時間」
   * 的樣本 —— 那就是物理上唯一自洽的擊發時刻(往回走 elapsed 遞增、飛行時間隨距離變化慢得多,
   * 機體速度遠低於彈頭速度 ⇒ 交點存在且唯一)。**MUST NOT 改成迭代逼近**:拋物線的
   * `dT/dd ≈ 0.017 s/m` 配上高速機體的收縮率只有 0.68,三五次迭代還差著幾十公尺。
   *
   * 軌跡不足以回推(剛進場 / headless 沒跑過 tick / 窗口太短)⇒ 退回機體當下位置 = **逐位元
   * 同舊制**(原則 6 降級不例外)。`back` 一律回傳「從解出的球心飛到落點」的飛行時間而非
   * elapsed:站著不動的射手因此與舊制逐位元相同(elapsed 有 tick 量化,飛行時間沒有)。
   */
  _shotOrigin(b, def, x, z, cap) {
    const tr = b._trail;
    if (tr) {
      for (let i = tr.length - 3; i >= 0; i -= 3) {
        if (this.t - tr[i] > cap) break;                       // 超出可容許的飛行窗:不再往回找
        const ft = shotFlightS(def, dist2d(tr[i + 1], tr[i + 2], x, z));
        if (this.t - tr[i] >= ft) return { x: tr[i + 1], z: tr[i + 2], back: Math.min(ft, cap) };
      }
    }
    return { x: b.x, z: b.z, back: Math.min(shotFlightS(def, dist2d(b.x, b.z, x, z)), cap) };
  }

  /** 目標(僚機跟隨領機,故以領機瞬時移速判定)是否移動中 */
  _isMoving(t) {
    const lead = t.sq ? this.heroes.get(t.pid) : t;
    return (lead?._spd ?? 0) >= EVASION.MOVING_SPD;
  }

  /**
   * 閃避擲骰。**哪一擊吃閃避由 `evadable(def)` 這個唯一縫決定**(輕武器直射 + 一切爆炸傷害),
   * 呼叫端負責先過那道判定;爆風那一半住 `_blast`(逐目標各自擲,見該處註)。
   * 條件:目標是英雄機體 + 有效機動 > 閃避門檻(evasionMinSpeed,與機體速度同一張映射)+ 移動中;飛行單位額外加成。
   * 只有英雄機體具閃避(NPC 移速 ≤ 20,永遠不符合) ⇒ 玩家打小兵不受影響。
   */
  _dodgeP(t, shooter) {
    if (!t || !t.hero) return 0;
    // 完美迴避(招式追加效果 dodge):生效期間直射武器必閃,不吃機動/移動門檻
    if (this._buffVal(t, 'dodge') > 0) return 1;
    const flying = t.kind === 'drone' || (t.y || 0) >= GAME.AA_MIN_ALT;
    const mob = heroMobility(t.kind, CHARACTERS[t.ch]?.mods, flying);
    if (mob <= evasionMinSpeed() || !this._isMoving(t)) return 0;
    let p = EVASION.GROUND + (flying ? EVASION.AIR_BONUS : 0) + this._buffVal(t, 'evade');
    // 高度差:目標比射手高過門檻 → +閃避率(較高方 +DODGE 封頂;見 data.js ALTITUDE)
    if (shooter) {
      const dh = this._altDh(t, shooter);   // 同框比較(見 _altDh:跨框相減 = 拿場地海拔當高度差)
      if (dh > 0) p += ALTITUDE.DODGE * altScale(dh);
    }
    // 高地壓制:剛被打到的高處目標閃不掉(2026-08-12;見 data.js HIGH_SUP)。
    // 套在**加總之後**是刻意的 —— 壓制打折的是「這台機體現在還閃不閃得掉」,不是逐項扣掉某一份加成。
    return Math.min(p, EVASION.P_MAX) * highSupDodgeF(this._supF(t));
  }

  /**
   * 高地壓制的**唯一戳記處**(`_damage` 的英雄分支)。強度 = 這一擊當下的高度優勢 `altScale(dh)`,
   * 窗長固定 `HIGH_SUP.DUR_S` —— 持續火力下逐發續期是這條規則的重點,不是漏算(見 data.js HIGH_SUP)。
   *
   * 兩條範圍限制:
   * ① **只壓制機體**(英雄與電腦玩家):砲塔/主堡/小兵沒有機動也不閃避,把命中率壓制加到它們身上
   *    等於直接改動 `towerHp` 的推導錨(bal ④)與一波 NPC 的火力(bal ①)—— 那是另一件事。
   * ② **沒有攻擊者就沒有壓制**:地雷/火場/沼澤/淹水的傷害不帶 `by`,而「高度優勢」是相對某個
   *    射手才成立的量(同 `_altRange`/`_altCrit`/`_dodgeP` 三處的 dh 來源)。
   * 同一個窗內多發:取**較強**的那一份(與 slowF「取較強」同一個處理),窗一律續到最新一發。
   */
  _stampSup(t, by) {
    if (!by) return;
    const f = highSupF(this._altDh(t, by));
    if (f <= 0) return;
    t.supF = Math.max(this._supF(t), f);
    t.supUntil = this.t + HIGH_SUP.DUR_S;
  }

  /** 這台機體當下的高地壓制強度(0 = 沒被壓制;窗過期即歸零)。唯一讀取處。 */
  _supF(e) {
    return e && (e.supUntil || 0) > this.t ? (e.supF || 0) : 0;
  }

  /** 機體是否為飛行狀態英雄? */
  _isFlyingHero(e) {
    if (!e || !e.hero) return false;
    return e.kind === 'drone' || (e.kind === 'morph' && (e.y || 0) > MORPH.GROUND_Y) || (e.y || 0) >= GAME.AA_MIN_ALT;
  }

  /** 飛行機體受擊失衡戳記(2026-09-01 使用者需求:跌落到穩住期間進入失衡狀態) */
  _stampUnbal(t) {
    if (!this._isFlyingHero(t)) return;
    t.unbalUntil = Math.max(t.unbalUntil || 0, this.t + FLIGHT.UNBAL_S);
  }

  /** 這台機體當下是否處於失衡狀態? */
  _isUnbalanced(e) {
    return !!(e && (e.unbalUntil || 0) > this.t);
  }

  /**
   * 這一發打不中的機率 = 目標閃避 ⊕ **射手**被高地壓制而失準 ⊕ 射手受擊失衡(獨立事件,見 data.highSupMissP, unbalMissP)。
   * 伺服器只擲一顆骰 ⇒ 兩條路徑(`_dodges` 與 `_blast`)MUST 都經這一支;
   * 而閃避補償 `evadeCompF` 的分母 MUST 仍只吃 `_dodgeP`(壓制不在「維持 DPS」那個帳裡,A45 ⑦)。
   */
  _missP(t, shooter) {
    const p = highSupMissP(this._dodgeP(t, shooter), this._supF(shooter));
    return unbalMissP(p, this._isUnbalanced(shooter));
  }

  /** 擲骰。`p > 0` 的短路 MUST 留著:不合格的目標**不消耗亂數**(與拆成 _dodgeP 之前逐位元同流) */
  _dodges(t, shooter) {
    const p = this._missP(t, shooter);
    return p > 0 && Math.random() < p;
  }

  /** 瞄準模式切換(按住右鍵):熱兵器(rocket/railgun/siege 等)需瞄準中才能開火 */
  heroAim(pid, on) {
    const h = this.heroes.get(pid);
    if (!h || h.dead || this.over) return;
    if (on && this._blinded(h)) return;
    // 退出瞄準的時刻(heroBurst 的飛行時間寬容用:已經合法離架的彈頭不該因為玩家收鏡而蒸發)
    if (h.aiming && !on) h.aimOffAt = this.t;
    h.aiming = !!on;
  }

  /**
   * 射程閘門用「到目標**近側表面**」的距離:d3(到中心)扣掉目標水平量體 hitR(= hitH 的水平版)。
   * 客戶端的準星射線/彈道停在目標**表面**(碰撞體),而舊閘門量的是**中心**——半徑 7m 的砲塔 /
   * 20m 的主堡把 ×1.25 網路寬容吃掉大半,再疊上客戶端的 `_effRange` 有效射程與彈道飛行時間,
   * 射程邊界的合法彈著就被「驗證後靜默丟棄」= 使用者回報「光暈亮著卻打不到建築」(A30 靜默丟包家族;
   * 與 2026-07-28 _lanceHits 的 R + hitR(t) 同一條病灶,這裡補的是**射程閘門**那一半)。
   * 只放寬閘門;傷害衰減仍以 d3(中心)結算 —— 平衡數值不動。
   */
  _surfD3(d3, t) { return Math.max(0, d3 - hitR(t)); }

  /**
   * 貫穿圓柱垂直帶用的「射線高」——**換算到目標自己的垂直框**(離目標腳下地表)。
   *
   * 2026-08-04 使用者回報「反器材武器打建築會跳傷害數據,但血條沒變」的伺服器側成因:
   * `_lanceHits` 拿 `oy + slope × s`(射手回報的**離站立表面**高 + 射線爬升)直接去比對
   * `_bodySpan(t)`(目標**離自己腳下地表**的量體帶)—— 兩個框各自以「自己腳下」為 0,
   * 高低差一大就完全對不上:射手站在稜線上往下打山谷裡的砲塔,射線在塔位的「伺服器算高」
   * 會是 −37m,`_bodyDy` 量出 37m ≫ 垂直帶(gun 只有 7.26m)⇒ 整發靜默丟棄,而客戶端
   * `_lanceFeedback` 的圓柱鏡射沒有這一道、照樣跳傷害數字(A18/A30 家族的兩端分家)。
   * 實測門檻:120m 水平距下高低差超過約 ±25m 就開始整發落空 —— 山地圖(太魯閣一族)的
   * 常態,而**只有 line 類重武器有這道垂直帶**(輕武器 heroHit 回報目標 id、扇形 heroPlasma
   * 沒有垂直帶)⇒ 症狀集中在反器材/貫穿砲,建築又是唯一「固定站在兵線上任你從高處狙」的目標。
   *
   * 修法遵守 `_altDh` 的同一條紀律:**兩端都拿得到絕對高程才用絕對框**(射手 = 回報的 `ay`
   * 或粗高程網格、目標 = 粗高程網格),否則逐位元退回舊近似(原則 6 寧缺勿錯 —— e2e/headless
   * 沒有上傳 `hgt`,行為與舊制完全相同)。
   */
  _lanceBandY(shooter, ox, oz, oy, t, relY) {
    const gT = this._hgtAt(t.x, t.z);
    if (gT == null) return relY;                          // 未上傳高程網格 ⇒ 維持舊制近似
    const abs = shooter?.hero && shooter.ay != null;
    if (!abs && this._hgtAt(ox, oz) == null) return relY;  // 射手端也解不出絕對框 ⇒ 同上
    // relY − oy = 射線相對槍口的爬升(客戶端回報的 d 是世界向量 ⇒ 這一段本來就是絕對量)
    return this._absSightY(shooter, oy, ox, oz) + (relY - oy) - gT;
  }

  /** 英雄射擊命中(客戶端彈道命中回報;傷害/克制/爆擊/破甲、射程/射速/彈藥伺服器把關) */
  heroHit(pid, targetId, w) {
    const h = this.heroes.get(pid);
    const t = this.ents.get(targetId);
    if (!h || h.dead || !t || t.gar || t.side === h.side || this.over) return;
    if (this._blinded(h)) return;
    if (this._jammed(h)) return;   // 電磁癱瘓:武器離線
    const wp = this._heroWeapon(h, w);
    if (!wp || !wp.def.rate) return;
    const cap = (trajClass(wp.def) === 'fnf' ? chaseCapS(wp.def) : flightCapS(wp.def)) || 0.5;
    if (wp.def.needAim && !h.aiming && this.t - (h.aimOffAt ?? -Infinity) > cap) return;   // 重武器需瞄準模式才能開火(容差窗與 heroBurst 同縫)
    // 射程驗證(3D:高空狙擊也要吃射程;留 25% 寬容給網路延遲/彈道飛行)
    // 量到目標**近側表面**(_surfD3):彈著本來就停在建築牆面上,量中心會讓砲塔/主堡吃掉整段寬容
    const d3 = Math.hypot(h.x - t.x, h.z - t.z, (h.y || 0) - (t.hero ? (t.y || 0) : 0));
    if (this._surfD3(d3, t) > wp.def.range * this._altRange(h, t, wp.def) * RANGE_TOL) return;   // 高度制空:對地拉遠/對高空無人機縮短
    // 迷霧內的目標不可命中:射手陣營看不見(非瞄準模式看不到)就打不到 —
    // 塔/主堡/中立恆可見;偵察脈衝生效中該方視同無霧(與 snapshotFor 同判定)。
    const pulse = this.visionUntil?.[h.side] > this.t;
    if (!pulse && !this._visibleTo(t, h.side, this._visionSources(h.side))) return;
    // 實體障礙遮蔽:射手自己的彈道被建物/神木/巨岩擋住 = 打不到(客戶端彈道已擋,此為防作弊複驗;
    // 偵察脈衝給的是「情報」,不會讓砲彈穿牆 —— 不吃 pulse 旁路)
    if (this._losBlocked(h.x, h.z, (h.y || 0) + LOS.EYE_M, t.x, t.z, this._tgtY(t), h, t)) return;
    if (!this._gateFire(h, wp.id, wp.def, true)) return;
    // 定位標記(招式追加效果 mark):下一擊必中(無視閃避)必爆(強制爆擊);一擊即耗
    const marked = (h.markUntil || 0) > this.t;
    if (marked) h.markUntil = 0;
    // 閃避(範圍見 evadable 單一縫;走到這裡的恆是輕武器直射,爆炸型的那一半住 _blast):
    // 機動機體移動中可能整發閃開(僚機齊射仍各自擲骰)
    if (!marked && evadable(wp.def) && this._dodges(t, h)) {
      // pid = 射手:客戶端據此讓「自己的攻擊被閃」跳 Miss(不吃旁觀距離上限)
      this.events.push({ e: 'dodge', pid: h.pid, x: t.x, z: t.z, y: t.hero ? (t.y || 0) : 0, side: t.side });
      this._echo(h, t, wp.def);
      return;
    }
    // 物理衰減:動能存速 / 大氣消光,按實際射擊距離折傷害(dmgFalloff 依 type 分模型)。高度差不改基礎傷害(見 §3)。
    let dmg = this._heroDmg(h, wp.def, t.kind) * dmgFalloff(wp.def, d3);
    if (marked) {
      dmg *= wp.def.critX || VITALS.CRIT_X;
      this.events.push({ e: 'crit', pid: h.pid, x: t.x, z: t.z, y: t.hero ? (t.y || 0) : 0, v: Math.round(dmg) });
    } else {
      dmg = this._rollCrit(h, wp.def, dmg, t);
    }
    this._applyHitEmp(h, wp.def, t);
    this._damage(t, dmg, h, wp.def.pen, 0, wp.def);
    this._echo(h, t, wp.def);
  }

  /**
   * 僚機同步射擊:主視野機命中什麼,射程內的存活僚機就跟著打同一個目標。
   * 單機傷害已在 heroWeapon() 折成 1/3,所以「三機齊射 ≈ 一台機甲」。
   * 彈藥/射速只在主視野機那次 _gateFire 扣一份(小隊共用同一個彈匣)。
   */
  _echo(h, t, def) {
    const sq = h.sq;
    if (!sq || sq.bodies.length < 2) return;
    for (const b of sq.bodies) {
      if (b === h || b.dead) continue;
      if (t.hp <= 0 || (t.hero && t.dead)) return;
      const d3 = Math.hypot(b.x - t.x, b.z - t.z, (b.y || 0) - (t.hero ? (t.y || 0) : 0));
      if (this._surfD3(d3, t) > def.range * this._altRange(b, t, def) * RANGE_TOL) continue;   // 高度制空(見 heroHit);量到近側表面(_surfD3)
      // 僚機自己的射線也吃障礙遮蔽(主機看得到不代表僚機那個角度打得到)
      if (this._losBlocked(b.x, b.z, (b.y || 0) + LOS.EYE_M, t.x, t.z, this._tgtY(t), b, t)) continue;
      // pid/slot:客戶端解析僚機槍口錨(_entMuzzle 取離訊息座標最近那架)+ 開火動畫
      this.events.push({ e: 'shot', pid: b.pid, slot: def.id, from: [b.x, b.z], to: [t.x, t.z],
        ty: (t.hero || t.decoy || t.kind === 'heli') ? Math.round(t.y || 0) : 0, side: b.side });
      if (evadable(def) && this._dodges(t, b)) continue;   // 閃避:僚機這一發也被閃開
      const dmg = this._rollCrit(b, def, this._heroDmg(b, def, t.kind) * dmgFalloff(def, d3), t);
      this._applyHitEmp(b, def, t);
      this._damage(t, dmg, b, def.pen, 0, def);
    }
  }

  /** 射擊來襲防空飛彈(飛彈可被擊毀) */
  hitMissile(pid, missileId, w) {
    const h = this.heroes.get(pid);
    if (!h || h.dead || this.over) return;
    if (this._blinded(h)) return;
    if (this._jammed(h)) return;
    const m = this.missiles.find((x) => x.id === missileId);
    if (!m || m.side === h.side) return;
    const wp = this._heroWeapon(h, w);
    if (!wp || !wp.def.rate) return;
    if (wp.def.needAim && !h.aiming) return;
    const d3 = Math.hypot(h.x - m.x, h.z - m.z, (h.y || 0) - m.y);
    if (d3 > wp.def.range * RANGE_TOL) return;
    if (!this._gateFire(h, wp.id, wp.def, true)) return;
    // 僚機同步射擊(單機傷害是 1/3,三機齊射才打得掉飛彈)
    for (const b of this._bodies(h)) {
      if (b.dead) continue;
      const bd = Math.hypot(b.x - m.x, b.z - m.z, (b.y || 0) - m.y);
      if (bd > wp.def.range * RANGE_TOL) continue;
      m.hp -= this._heroDmg(h, wp.def, 'missile') * dmgFalloff(wp.def, bd);
    }
    if (m.hp <= 0) {
      this.missiles.splice(this.missiles.indexOf(m), 1);
      this.events.push({ e: 'boom', x: m.x, z: m.z, y: m.y, r: 8, side: h.side, sam: true });
      h.money += ECON.BOUNTY.missile;
    }
  }

  /**
   * 伺服器端英雄開火(電腦玩家用):射程/射速同 heroHit,
   * 額外廣播 shot 事件讓客戶端畫彈道(節流:每 3 發畫 1 發)。
   */
  botFire(pid, targetId, w = 'light') {
    const h = this.heroes.get(pid);
    const t = this.ents.get(targetId);
    if (!h || h.dead || !t || t.side === h.side || this.over) return false;
    if (this._blinded(h)) return false;
    if (this._jammed(h)) return false;
    const wp = this._heroWeapon(h, w);
    if (!wp) return false;
    const d3 = Math.hypot(h.x - t.x, h.z - t.z, (h.y || 0) - (t.hero ? (t.y || 0) : 0));
    if (d3 > wp.def.range * this._altRange(h, t, wp.def)) return false;   // 高度制空(見 heroHit)
    // 電腦玩家不能透視:彈道被實體障礙擋住 = 不開火(與真人 heroHit 同一條 LOS 規則)
    if (this._losBlocked(h.x, h.z, (h.y || 0) + LOS.EYE_M, t.x, t.z, this._tgtY(t), h, t)) return false;
    if (!this._gateFire(h, wp.id, wp.def, false)) return false;
    h._shotN = (h._shotN || 0) + 1;
    // pid/slot:客戶端據此解析 bot 英雄機體的 rig 槍口錨 + 標記開火動畫(後座/射姿,與真人 tracer 同路)
    if (h._shotN % 3 === 0 || wp.id === 'heavy') {
      this.events.push({ e: 'shot', pid, slot: wp.id, from: [h.x, h.z], to: [t.x, t.z],
        ty: (t.hero || t.decoy || t.kind === 'heli') ? Math.round(t.y || 0) : 0, side: h.side });
    }
    if (evadable(wp.def) && this._dodges(t, h)) {
      this.events.push({ e: 'dodge', pid: h.pid, x: t.x, z: t.z, y: t.hero ? (t.y || 0) : 0, side: t.side });
      this._echo(h, t, wp.def);
      return true;
    }
    const dmg = this._rollCrit(h, wp.def, this._heroDmg(h, wp.def, t.kind) * dmgFalloff(wp.def, d3), t);
    this._applyHitEmp(h, wp.def, t);
    this._damage(t, dmg, h, wp.def.pen, 0, wp.def);
    // 直線貫穿(line 類重武器):bot 也吃同一條範圍規則 —— 主目標之後的「順路」目標依序衰減。
    // 主目標本身已於上方全額結算,故這裡跳過它(貫穿序 i 仍沿用整條射線的名次)。
    if (aoeClass(wp.def) === 'line') {
      const oy = (h.y || 0) + LOS.EYE_M;
      const hx = t.x - h.x, hz = t.z - h.z, hy = this._tgtY(t) - oy;
      const hl = Math.hypot(hx, hz, hy) || 1;
      const hits = this._lanceHits(h, wp.def, h.x, h.z, oy, hx / hl, hz / hl, hy / hl,
        wp.def.range * this._altRange(h, t, wp.def));
      for (let i = 0; i < hits.length; i++) {
        const k = hits[i];
        if (k.t === t) continue;
        const kd = this._heroDmg(h, wp.def, k.t.kind) * dmgFalloff(wp.def, k.d3) * offAxisFalloff(k.off) * LANCE.DECAY ** i;
        this._applyHitEmp(h, wp.def, k.t);
        this._damage(k.t, kd, h, wp.def.pen, 0, wp.def);
      }
    }
    this._echo(h, t, wp.def);
    return true;
  }

  /**
   * 重武器(launcher 型)著彈:落點由客戶端彈道回報,
   * CD(mag=1 + reload=cd)/瞄準/射程/電磁癱瘓皆伺服器把關。
   * y(2026-07-17 火箭筒對空):彈頭直擊空中目標時客戶端回報引爆高度 →
   * 爆風在高空結算(_blast 的 3D 距離)⇒ 火箭筒/榴彈可對空;缺值 = 地面引爆(向後相容)。
   */
  heroBurst(pid, x, z, y = 0, lev = 0) {
    const h = this.heroes.get(pid);
    if (!h || h.dead || this.over) return;
    if (this._blinded(h)) return;
    if (this._jammed(h)) return;
    y = Number.isFinite(y) ? Math.max(0, Math.min(400, y)) : 0;   // 引爆高度夾範圍(防作弊)
    lev = lev === 2 ? 2 : lev === 1 ? 1 : 0;   // 爆點結構層(客戶端彈道回報;_blast 隧道垂直隔離用)
    const wp = this._heroWeapon(h, 'heavy');
    if (!wp || (wp.def.type !== 'launcher' && wp.def.type !== 'missile')) return;   // 飛彈也是 AoE 戰鬥部
    // 瞄準閘門量的是「擊發資格」,但爆點是**著彈**才回報 —— 兩者之間隔著整段飛行時間。
    // 巡飛彈初速 90m/s、滿射程飛 3 秒以上:合法離架後玩家右鍵收鏡(很自然:開完砲就要移動),
    // 這一發會在天上被靜默丟棄 = 使用者回報的「射後不理/雷射導引常常光暈亮著卻沒命中」。
    // 寬容窗 = 這把武器的最長飛行時間(data.js flightCapS,推導不手寫);超過才算「收鏡後才開砲」。
    // 45° 拋投的榴彈滿射程要飛近 6 秒(不是 shotV0 除出來的 1.7 秒)—— 窗口一短,玩家開完砲
    // 收鏡去移動,那一整輪就在天上被丟掉(2026-08-03 使用者回報「只有遊戲一開始有傷害」)。
    // 射後不理(2026-08-01 使用者定案)「鎖定之後持續追擊,不受射程影響 —— 但只能在射程內鎖定」:
    // 落點閘門因此**追加**一條綁鎖定目標的放行。「射程內才鎖得到」由 heroLock 把關(它自己驗
    // 射程 / 迷霧 / LOS 三道),之後彈頭飛多遠都算數;鎖定過期/目標陣亡 ⇒ 只剩一般落點閘門。
    // 防作弊沒有變鬆:沒有鎖定就沒有豁免,有鎖定也只有炸在**那個目標身上**(核心帶內)才豁免,
    // MUST NOT 放寬成「有鎖定就隨便一個遠點都收」。
    const fnf = trajClass(wp.def) === 'fnf';
    const lockT = fnf ? this._lockedTarget(this.squads.get(pid)) : null;
    // 追擊的實際飛行時間可達滿射程的 CHASE_F 倍 ⇒ 凡是「拿著彈時刻回推擊發時刻」的換算
    // MUST 跟著換上 chaseCapS,否則合法的長程追擊會在收鏡/裝填兩道閘門上被靜默丟棄(A30)。
    const cap = fnf ? chaseCapS(wp.def) : flightCapS(wp.def);
    if (wp.def.needAim && !h.aiming && this.t - (h.aimOffAt ?? -Infinity) > cap) return;
    // 射程球心 = **彈藥擊發當下的位置**,後續機體的移動不影響(2026-08-05 使用者定案)。
    // 舊制拿機體的**當下**位置當球心 —— 而 AoE 彈頭是著彈才回報,45° 拋投的榴彈滿射程要飛
    // 近 6 秒,那 6 秒裡球心一路跟著機體跑,兩個方向都是無聲的:
    //   ・開完砲往後退(最自然的動作)⇒ dImp 憑空變大 ⇒ 合法彈著被驗證後靜默丟棄 = 零傷害;
    //   ・開完砲往前衝 ⇒ dImp 憑空變小 ⇒ 射程外的彈著反而收下 = 25% 之外的隱形射程。
    // 客戶端的彈體一向以 `b.origin`(擊發槍口)為心量球面、射程光暈也是,這裡補的正是
    // 「兩端同量體」少掉的那一半(原則 3 / A30 靜默丟包家族)。球心由**伺服器自己的位置軌跡**
    // 回推(`_shotOrigin`),MUST NOT 改成收客戶端回報的擊發座標 —— 那等於把落點閘門的球心
    // 交給客戶端指定,`impCap` 當場失效(A1)。
    const org = this._shotOrigin(h, wp.def, x, z, cap);
    const dImp = dist2d(org.x, org.z, x, z);
    // 著彈點超程閘門。上界 = 射程 × 高度制空上限 × 網路寬容 × 重砲窗 —— 三個因子都是**推導值**:
    //   ・RANGE_TOL:與 heroHit/heroLance/heroPlasma 同一個縫(舊制此處獨自寫 1.15,比其餘閘門緊)
    //   ・altRangeMax():落點是一個「點」,伺服器算不出射手與目標的高程差 ⇒ 只能取機制上限當誠實界。
    //     客戶端的彈道上限本來就是 `range × _altRangeTo`(最高 1 + ALTITUDE.RANGE),閘門比它緊
    //     = 高地上合法的那一發被驗證後靜默丟棄:玩家看到砲彈在敵人身上炸開、傷害卻是 0
    //     (2026-07-30 使用者回報「榴彈類常常光暈亮著卻沒命中」的伺服器側那一半)。
    const impCap = wp.def.range * altRangeMax() * RANGE_TOL;
    // 追擊命中:落點落在鎖定目標的爆風核心帶內(量到近側表面,與 _blast/_reachable 同一把尺)
    // ⇒ 射程包絡整條讓位給追擊燃料。**這是一道加分題,不是替代題**(2026-08-03 使用者定案
    // 「中途爆炸也要有傷害」):彈頭在半路撞到小兵/建物/地形就地引爆時,爆點當然不在鎖定
    // 目標身上 —— 舊制的 `if (lockT) … else` 把它連同一般落點閘門一起判掉,前線一有東西擋路
    // 整發飛彈就靜默丟包(開局空曠打得到、兵線一鋪開就再也打不到)。沒炸在鎖定目標上就退回
    // 一般閘門照常結算;防作弊沒有變鬆 —— impCap 那條原封不動,遠距落點仍要有鎖定才收。
    const chased = !!lockT
      && this._surfD3(dist2d(lockT.x, lockT.z, x, z), lockT) <= blastCoreR(wp.def);
    if (!chased && dImp > impCap) return;
    // 這一發其實是「飛行時間」秒之前擊發的 —— 把裝填計時器接回擊發時刻(見 _gateFire 的 back)。
    // 飛行時間只准經 `shotFlightS` 這個縫(拋物線是 45° 反解初速,MUST NOT 自己拿 shotV0 除一次:
    // 那會低估 2.2 倍 ⇒ 伺服器的裝填窗比客戶端晚 4 秒);球心與回推量是**同一個解**,故一律取
    // `_shotOrigin` 已經夾好的那一份,MUST NOT 在這裡拿 dImp 再算一次(兩份會在機體移動時分家)。
    const back = org.back;
    if (!this._gateFire(h, wp.id, wp.def, true, back)) return;
    h.lastBurst = this.t;
    // 榴彈類最小安全射程(2026-07-27):落點近於 lobMinRange ⇒ 射手落在自身爆風內 → 爆風改「無差別」
    // (不分敵我,波及友軍 + 自身),自損量由 blastFalloff 自然導出。決策以回報射手 h 定案、整組僚機齊射一致套用。
    const minR = lobMinRange(wp.def);
    const tooClose = minR > 0 && dImp < minR;
    // bot 重武器「發射端」視覺(2026-07-22 規則 3):真人開火自帶 tracer 訊息轉播,
    // bot 沒有 → 只剩落點 boom = 發射瞬間無槍口焰/彈體離架。補發 shot 事件
    // (客戶端 pid 分支解析槍口錨 → launcher/missile 畫視覺彈體 + 槍口爆 + 後座)
    if (isBotId(pid)) {
      this.events.push({
        e: 'shot', pid, slot: 'heavy', from: [h.x, h.z], to: [x, z],
        ty: Math.round(y || 0), side: h.side,
      });
    }
    this.events.push({ e: 'boom', x, z, y, r: wp.def.r, side: h.side, ...(tooClose ? { self: 1 } : {}) });
    this._blast(h, wp.def, x, z, y, lev, tooClose);
    // 僚機同步齊射同一個落點(單發只畫一次爆炸,傷害疊三份 1/3)
    for (const b of this._bodies(h)) {
      if (b === h || b.dead) continue;
      // 僚機吃同一道閘門、也吃同一條球心規則(各自的擊發位置 —— 整個小隊在那 6 秒裡是一起
      // 移動的,只修主視野機那一份等於僚機那 1/3 傷害照樣被靜默丟棄)。追擊命中才豁免。
      const bo = this._shotOrigin(b, wp.def, x, z, cap);
      if (!chased && dist2d(bo.x, bo.z, x, z) > impCap) continue;
      this._blast(b, wp.def, x, z, y, lev, tooClose);
    }
  }

  /**
   * 扇形攻擊(fan:電漿重武器 / 散彈輕武器):客戶端只回報射向(dx,dz 為 sim 座標單位向量)
   * 與槽位 slot('heavy' 電漿 / 'light' 散彈;預設 heavy 向後相容)。命中判定全在伺服器 —
   * 射程內、水平夾角 ≤ arc、迷霧可見的敵方單位全數受創(× 扇形近距高遠距低衰減)。
   * 一發只扣一次彈藥/射速,錐內敵人全數命中 = 真散彈手感。僚機以各自位置沿同射向齊噴。
   *
   * **射程閘門 MUST NOT 乘 `RANGE_TOL`**(2026-08-01 使用者回報「攻擊範圍異常,沒有射程光暈
   * 的敵人也打得到」):`RANGE_TOL` 是放給「客戶端已自行夾過射程的**回報**」的網路寬容 ——
   * heroHit/heroLance/heroBurst 的彈道本來就飛不出 `range × 高度制空`,寬容只能防止合法彈著
   * 被誤丟。扇形武器沒有彈道也**沒有任何客戶端閘門**(只回報一個射向,選誰中彈全在這裡),
   * 寬容於是直接變成 25% 的隱形射程:光暈不亮的敵人照樣掉血。這裡是伺服器自己選目標的
   * 唯一一條英雄武器路徑,MUST 吃誠實界(與 `botFire` 同一條規則)。
   *
   * **射程球心 = 客戶端回報的槍口 `o`**(2026-08-02 使用者定案「射程是射擊點為中心的球面」;
   * 與 `heroLance` 同一組座標約定與同一道 12m 防作弊閘)。誠實界沒有 `RANGE_TOL` 可以吸收
   * 兩端的球心差 ⇒ 舊制從**機體中心**量、而客戶端的扇形彈舌與射程光暈 `_reachable` 都是從
   * **槍口**量:槍口在機體前方,同一個敵人從機體量比從槍口量遠一個前伸量(閘門允許到 12m)
   * ⇒ 那一整條邊界帶「光暈亮著卻不掉血」。取不到 `o`(bot 的 `botFire` 側呼叫 / 舊版客戶端)
   * 退回機體中心 —— bot 沒有客戶端也沒有槍口回報,機體中心就是它的射擊點。
   */
  heroPlasma(pid, dx, dz, slot = 'heavy', o = null) {
    const h = this.heroes.get(pid);
    if (!h || h.dead || this.over || !Number.isFinite(dx) || !Number.isFinite(dz)) return;
    if (this._blinded(h)) return;
    if (this._jammed(h)) return;
    const wp = this._heroWeapon(h, slot === 'light' ? 'light' : 'heavy');
    if (!wp || !wp.def.fan) return;
    const cap = (trajClass(wp.def) === 'fnf' ? chaseCapS(wp.def) : flightCapS(wp.def)) || 0.5;
    if (wp.def.needAim && !h.aiming && this.t - (h.aimOffAt ?? -Infinity) > cap) return;
    const len = Math.hypot(dx, dz) || 1;
    dx /= len; dz /= len;
    if (!this._gateFire(h, wp.id, wp.def, true)) return;
    const pulse = this.visionUntil?.[h.side] > this.t;
    const src = this._visionSources(h.side);
    const arcHalf = fanArcHalf(wp.def);   // 偏心遞減的分母(量體只放寬「打不打得到」,不放大傷害)
    // 槍口必須在自己身邊(防作弊:不能從任意座標噴一個錐;與 heroLance 同一道閘)
    const mz = Array.isArray(o) && [+o[0], +o[1], +o[2]].every(Number.isFinite)
      && dist2d(h.x, h.z, +o[0], +o[1]) <= 12 ? [+o[0], +o[1], +o[2]] : null;
    for (const b of this._bodies(h)) {
      if (b.dead) continue;
      // 僚機以各自機體中心發射(它們沒有槍口回報);主視野機用回報的槍口 ⇒ 射程球心與客戶端同一點
      const lead = mz && b === h;
      const bx = lead ? mz[0] : b.x, bz = lead ? mz[1] : b.z;
      const byD = lead ? mz[2] : (b.y || 0);                  // 量距離的球心高
      const byE = lead ? mz[2] : (b.y || 0) + LOS.EYE_M;      // 射線起點高(LOS / 稜線)
      for (const t of [...this.ents.values()]) {
        if (t.side === h.side || t.gar || (t.hero && t.dead)) continue;
        const tx = t.x - bx, tz = t.z - bz;
        const d2 = Math.hypot(tx, tz);
        const d3 = Math.hypot(d2, byD - (t.hero ? (t.y || 0) : 0));
        if (this._surfD3(d3, t) > wp.def.range * this._altRange(b, t, wp.def)) continue;   // 誠實界(見上方註解);高度制空 + 量到近側表面(_surfD3)
        // 圓錐判定取水平夾角;目標近乎正下/正上方(d2 極小)視為在錐內。
        // 錐緣量到目標**命中量體的近側表面**(fanConeHalf 單一縫,lanesim / 客戶端光暈同吃):
        // 量中心的話,貼著砲塔(hitR 7)/ 主堡(hitR 20)的牆面噴,整個錐子都打在牆上而中心
        // 還在 30~70° 之外 = 一發都不掉血,同一處的小兵卻照樣被噴死(2026-08-03 使用者回報)。
        const ang = d2 > 8 ? Math.acos(Math.min(1, Math.max(-1, (tx * dx + tz * dz) / d2))) : 0;
        if (d2 > 8 && ang > fanConeHalf(wp.def, d2, hitR(t))) continue;
        if (!pulse && !this._visibleTo(t, h.side, src)) continue;
        // 扇形焰舌/彈丸也不穿牆:發射機到目標的射線被實體障礙擋住 = 錐內也打不到
        // (起點吃同一個 byE ⇒ 射線與射程球心同源,與客戶端 `_reachable` 的 `_layerHitT(from…)` 同一點)
        if (this._losBlocked(bx, bz, byE, t.x, t.z, this._tgtY(t), b, t)) continue;
        // 也不穿**山**:扇形是伺服器自己在錐內選目標(客戶端只送一個射向)⇒ 沒有任何本端
        // 地形截斷可以依靠,不補這一道就是隔山打牛 —— 而射程光暈吃的是 `hit:'clear'`
        // (線段整段淨空,含地形),早就說打不到(2026-08-01 使用者需求)。
        if (this._ridgeBlocked(bx, bz, this._absSightY(b, byE, bx, bz),
                               t.x, t.z, this._absSightY(t, this._tgtY(t), t.x, t.z), b, t)) continue;
        // 偏心傷害遞減:夾角偏離錐軸越多傷害越低(正對錐軸滿額;d2 極小的正上/正下視為正中)。
        // 分母仍是**標稱**半角 —— 量體只放寬「打不打得到」,MUST NOT 讓大目標連傷害一起變高;
        // 靠量體才進錐的目標一律吃錐緣保底 AOE_EDGE(offAxisFalloff 自帶 [0,1] 夾制)。
        const offF = offAxisFalloff(ang / arcHalf);
        this._damage(t, this._heroDmg(b, wp.def, t.kind) * dmgFalloff(wp.def, d3) * offF, b, wp.def.pen, 0, wp.def);
      }
    }
    this.events.push({ e: 'plasma', pid, side: h.side, x: h.x, z: h.z, y: h.y || 0,
      dx, dz, r: wp.def.range, arc: wp.def.arc || 15, slot: slot === 'light' ? 'light' : 'heavy' });
  }

  /**
   * 直線貫穿命中列表(line 類重武器:beam 光束 / rail 電磁彈射 / gun 反器材砲)。
   * 回傳沿射線由近至遠排序的敵方單位(至多 LANCE.MAX 個),供呼叫端逐一套貫穿衰減。
   *
   * 幾何近似(刻意):圓柱判定取**水平**垂距 + 一條垂直帶 —— 伺服器無地形高程,
   * y 的語意是「離站立表面高」,射線的絕對高度算不出來(見 _losBlocked 同一組近似)。
   * 垂直帶用客戶端回報的 dy 外推射線高度,寬容 R × LANCE.VBAND_F;
   * 真正的遮蔽仍由逐目標 _losBlocked 把關(與 heroPlasma 同一條規則)。
   *
   * 判定量體(2026-07-28,使用者回報「常常打不到單位,特別是建築」)——兩處舊病:
   *   ① **目標是點**:半徑 R 的圓柱只比對單位中心,7m 半徑的砲塔 / 20m 的主堡打在牆面上
   *      離中心 5~18m ⇒ 明明命中卻整發落空。改為 R + hitR(t)(垂直帶的水平版,見 data.js)。
   *   ② **射線被目標自己截斷**:客戶端回報的 len 止於「彈道終點」—— beam 的準星射線、
   *      動能彈的落點都停在目標**近側表面**,而目標中心在那之後 ⇒ s > maxS 判成落空。
   *      改為量到「線段上最近點」(s 夾制到 [0, maxS])而非要求中心落在線段內。
   */
  _lanceHits(shooter, def, ox, oz, oy, dx, dz, dy, len) {
    const R = lanceR(def);
    const band = R * LANCE.VBAND_F;
    const hd = Math.hypot(dx, dz);
    // 近乎垂直的射線(仰俯角 > 81°:對正上方的無人機開火)水平投影會退化 —— 改以高度差當軸向。
    const vert = hd < 0.15;
    const ux = vert ? 0 : dx / hd, uz = vert ? 0 : dz / hd;   // 水平單位向量
    const slope = vert ? 0 : dy / hd;                          // 每水平公尺的爬升
    const maxS = vert ? len : len * hd;                        // 軸向長度(水平模式取射線的水平投影長)
    const sy = dy >= 0 ? 1 : -1;
    const pulse = this.visionUntil?.[shooter.side] > this.t;
    const src = this._visionSources(shooter.side);
    const out = [];
    for (const t of this.ents.values()) {
      if (t.side === shooter.side || t.gar || (t.hero && t.dead)) continue;
      const ty = this._tgtY(t);
      const tx = t.x - ox, tz = t.z - oz;
      const rr = R + hitR(t);                                  // 圓柱半徑 + 目標自身水平量體
      let s, perp;
      if (vert) {
        s = (ty - oy) * sy;                                    // 垂直射線:軸向 = 高度差
        perp = Math.hypot(tx, tz);
      } else {
        s = tx * ux + tz * uz;                                 // 水平投影軸距
        perp = Math.hypot(tx - ux * s, tz - uz * s);
      }
      // 軸向:量到**線段**(而非無限長軸)—— 中心落在線段外時夾回端點再量,
      // 目標近側表面就是彈道終點的情形(建築/大機體)才不會被判成落空。
      const sc = s < 0 ? 0 : (s > maxS ? maxS : s);
      if (!vert) {
        // 垂直帶(見上方幾何近似說明):比對的是**機體整條垂直帶**而非單一取樣點 ——
        // 26m 的塔 / 10m 的機甲被瞄準頭部時,單點取樣(_tgtY)會讓整條射線判成落空。
        // 射線高 MUST 先換算到**目標自己的垂直框**(`_lanceBandY` 單一縫)—— 兩邊各自以
        // 「自己腳下」為 0,高低差一大就整發靜默丟棄(2026-08-04 反器材打建築零傷害)。
        if (this._bodyDy(t, this._lanceBandY(shooter, ox, oz, oy, t, oy + slope * sc)) > band) continue;
        if (s !== sc) perp = Math.hypot(tx - ux * sc, tz - uz * sc);
      }
      const dev = Math.hypot(perp, s - sc);                  // 偏離圓柱軸的量(含端點外溢)
      if (dev > rr) continue;
      if (!pulse && !this._visibleTo(t, shooter.side, src)) continue;
      if (this._losBlocked(ox, oz, oy, t.x, t.z, ty, shooter, t)) continue;
      // 稜線遮蔽(2026-08-01「避免隔山打牛」):真人的射線 len 已被本端地形截斷,這一道主要
      // 是給 bot 的 botFire —— 它自建一條 range 長的射線,沒有任何地形截斷 ⇒ 隔山打牛。
      // 順帶收掉真人那條的端點外溢(圓柱端帽可以外溢 R + hitR,剛好落在山背後)。
      if (this._ridgeBlocked(ox, oz, this._absSightY(shooter, oy, ox, oz),
                             t.x, t.z, this._absSightY(t, ty, t.x, t.z), shooter, t)) continue;
      // off = 偏心比例(0 正中 / 1 貼邊):heroLance 據此套 offAxisFalloff(偏心傷害遞減)
      out.push({ t, s, d3: Math.hypot(tx, tz, ty - oy), off: Math.min(1, dev / rr) });   // 排序用**原始**軸距,貫穿先後才對
    }
    out.sort((a, b) => a.s - b.s);
    return out.length > LANCE.MAX ? out.slice(0, LANCE.MAX) : out;
  }

  /**
   * 直線貫穿攻擊(aoeClass 'line':beam / rail / gun 重武器)。客戶端回報射線:
   *   o = [x, z, y] 槍口(sim 座標,y = 離站立表面高)、d = [dx, dz, dy] 單位方向、len = 射線長
   *   (已被本端地形/障礙截斷 —— 伺服器再夾一次射程 ×RANGE_TOL 寬容)。
   * 命中判定全在伺服器:圓柱內、射程內、迷霧可見、LOS 未遮蔽的敵方單位全數受創,
   * 依沿線先後套 LANCE.DECAY^i(首個全額 ⇒ 單體 DPS 與 heroHit 相同,bal 不變式不受影響)。
   * 一發只扣一次彈藥/電力/射速 —— 與 heroPlasma(扇形)、heroBurst(爆炸)同一條「AoE 一發一結算」。
   */
  heroLance(pid, o, d, len) {
    const h = this.heroes.get(pid);
    if (!h || h.dead || this.over) return;
    if (this._blinded(h)) return;
    if (this._jammed(h)) return;
    if (!Array.isArray(o) || !Array.isArray(d)) return;
    const ox = +o[0], oz = +o[1], oy = +o[2];
    let dx = +d[0], dz = +d[1], dy = +d[2];
    if (![ox, oz, oy, dx, dz, dy, +len].every(Number.isFinite)) return;
    const wp = this._heroWeapon(h, 'heavy');
    if (!wp || aoeClass(wp.def) !== 'line') return;
    const cap = (trajClass(wp.def) === 'fnf' ? chaseCapS(wp.def) : flightCapS(wp.def)) || 0.5;
    if (wp.def.needAim && !h.aiming && this.t - (h.aimOffAt ?? -Infinity) > cap) return;
    // 槍口必須在自己身邊(防作弊:不能從任意座標放一條線)
    if (dist2d(h.x, h.z, ox, oz) > 12) return;
    const dl = Math.hypot(dx, dz, dy) || 1;
    dx /= dl; dz /= dl; dy /= dl;   // 3D 單位化(_lanceHits 自行拆水平/垂直分量)
    // 射線長上限 = 射程 × 高度制空**機制上限**(誠實界;落點/線長沒有目標實體可以算高程差,
    // 與 heroBurst 的 impCap 同一條理由)。len 本來就是客戶端夾過的,這裡只防作弊放大。
    const max = Math.min(Math.max(0, +len), wp.def.range * altRangeMax());
    if (!this._gateFire(h, wp.id, wp.def, true)) return;
    for (const b of this._bodies(h)) {
      if (b.dead) continue;
      // 僚機以各自位置沿同射向貫穿(與 heroPlasma 同構;N=1 時只有本機)
      const bx = b === h ? ox : b.x, bz = b === h ? oz : b.z, by = b === h ? oy : (b.y || 0) + LOS.EYE_M;
      const hits = this._lanceHits(b, wp.def, bx, bz, by, dx, dz, dy, max);
      for (let i = 0; i < hits.length; i++) {
        const { t, d3, off } = hits[i];
        // 誠實界(2026-08-01「超過射程範圍就沒傷害」):`d3` 是從**回報的槍口** ox/oz/oy 量起
        // (見 _lanceHits),與客戶端射程光暈 `_reachable` 的 from 是同一個點 ⇒ 兩端量的是同一段
        // 距離,不需要也不能再乘 RANGE_TOL —— 圓柱端帽本來就可以外溢 R + hitR,再放 25% 等於
        // 光暈不亮的敵人照樣掉血(與 heroPlasma 同一條規則)。
        if (this._surfD3(d3, t) > wp.def.range * this._altRange(b, t, wp.def)) continue;   // 高度制空;量到近側表面(_surfD3,與 _lanceHits 的 R+hitR 同一條尺)
        const dmg = this._rollCrit(b, wp.def,
          this._heroDmg(b, wp.def, t.kind) * dmgFalloff(wp.def, d3) * offAxisFalloff(off) * LANCE.DECAY ** i, t);
        this._applyHitEmp(b, wp.def, t);
        this._damage(t, dmg, b, wp.def.pen, 0, wp.def);
      }
    }
    // 來襲防空飛彈也在圓柱內被打穿(取代 hitMissile 那條單體路徑 —— line 類一發只過一次
    // _gateFire,若客戶端另送 hitMissile 會重複扣彈)。判定同 hitMissile:射程 ×RANGE_TOL、掉血歸零即擊落。
    for (let i = this.missiles.length - 1; i >= 0; i--) {
      const m = this.missiles[i];
      if (m.side === h.side) continue;
      const mx = m.x - ox, mz = m.z - oz, my = m.y - oy;
      const s0 = mx * dx + mz * dz + my * dy;
      const s = s0 < 0 ? 0 : (s0 > max ? max : s0);   // 量到線段最近點(與 _lanceHits 同一條規則)
      if (Math.hypot(mx - dx * s, mz - dz * s, my - dy * s) > lanceR(wp.def)) continue;
      const d3 = Math.hypot(mx, mz, my);
      if (d3 > wp.def.range * RANGE_TOL) continue;
      m.hp -= this._heroDmg(h, wp.def, 'missile') * dmgFalloff(wp.def, d3);
      if (m.hp <= 0) {
        this.missiles.splice(i, 1);
        this.events.push({ e: 'boom', x: m.x, z: m.z, y: m.y, r: 8, side: h.side, sam: true });
        h.money += ECON.BOUNTY.missile;
      }
    }
  }

  // 機種絕招「飽和攻擊」(heroKamikaze)2026-08-06 整組退場,MUST NOT 復辟:長按右鍵改成招式手勢
  // (一般 = 小招 / 狙擊 = 大招,見 data.js abilHoldSlot),kami 只剩「大招載具」這一個身分
  // (唯一生成點 = _launchUltCarrier)。失去它的 9 台純自身型大招改由 SELF_ULT 折算補償。

  /** 自殺攻擊機索敵:半徑內最近的敵方單位(不含中立/駐守/彼此的誘餌munitions);沒有 → null */
  _kamiAcquire(k) {
    let best = null, bd = SQUAD.KAMI.ACQ_R;
    for (const e of this.ents.values()) {
      if (e.side === k.side || e.neutral || e.hp <= 0 || e.kami || e.decoy || e.hyper || e.gar) continue;
      if (e.hero && (e.dead || (e.stealthUntil || 0) > this.t)) continue;
      const ty = e.hero || e.kind === 'heli' ? (e.y || 0) : 0;
      const d = Math.hypot(e.x - k.x, e.z - k.z, ty - (k.y || 0));
      if (d < bd) { bd = d; best = e; }
    }
    return best;
  }

  /**
   * 每 tick:鎖定目標無效則自動索敵 → 限轉率撲擊(3 倍速)→ 近炸 / 燃料耗盡自爆。
   * 爆風算主機頭上(吃火力升級/招式增益,擊殺記給它);被擊毀則原地半爆(見 _kill → _kamiDeathBoom)。
   */
  _tickKamis(dt) {
    const K = SQUAD.KAMI;
    const spd = UNITS.drone.speed * K.SPEED_MUL;
    for (const sq of this.squads.values()) {
      if (!sq.kamis || !sq.kamis.length) continue;
      for (let i = sq.kamis.length - 1; i >= 0; i--) {
        const k = sq.kamis[i];
        if (k.hp <= 0) { sq.kamis.splice(i, 1); continue; }   // 已被 _kill 移除
        // 輔助機隊(2026-08-07):同一具小型載具的第二種身分 —— 不撲擊、不引爆,跟著主機供輸加成
        if (k.supG) { this._tickSupport(k, dt, spd); continue; }
        if (this.t >= k.dieAt) { this._kamiBoom(k); continue; }
        if (k.pt) {
          // 點遞送(大招載具):直飛落點近炸 —— 不索敵、不追擊(效果落在瞄準點,不被路過的敵人拉走)
          if (Math.hypot(k.pt.x - k.x, k.pt.z - k.z, k.y || 0) <= K.BOOM_M) { this._kamiBoom(k); continue; }
          const want = Math.atan2(-(k.pt.x - k.x), k.pt.z - k.z);
          let dr = want - k.ry;
          while (dr > Math.PI) dr -= Math.PI * 2;
          while (dr < -Math.PI) dr += Math.PI * 2;
          k.ry += Math.max(-K.TURN * dt, Math.min(K.TURN * dt, dr));
          k.y += Math.max(-spd * dt, Math.min(spd * dt, 0 - k.y));
          k.x += -Math.sin(k.ry) * spd * dt;
          k.z += Math.cos(k.ry) * spd * dt;
          k.y = Math.max(0, k.y);
          continue;
        }
        let t = k.tid ? this.ents.get(k.tid) : null;
        if (t && (t.hp <= 0 || t.side === k.side || t.neutral || t.gar || (t.hero && t.dead))) { t = null; k.tid = 0; }
        if (!t) { t = this._kamiAcquire(k); k.tid = t ? t.id : 0; }
        if (t) {
          const ty = t.hero || t.kind === 'heli' || t.decoy || t.kami ? (t.y || 0) : 0;
          if (Math.hypot(t.x - k.x, t.z - k.z, ty - k.y) <= K.BOOM_M) { this._kamiBoom(k); continue; }
          const want = Math.atan2(-(t.x - k.x), t.z - k.z);
          let dr = want - k.ry;
          while (dr > Math.PI) dr -= Math.PI * 2;
          while (dr < -Math.PI) dr += Math.PI * 2;
          k.ry += Math.max(-K.TURN * dt, Math.min(K.TURN * dt, dr));
          k.y += Math.max(-spd * dt, Math.min(spd * dt, ty - k.y));
        }
        k.x += -Math.sin(k.ry) * spd * dt;
        k.z += Math.cos(k.ry) * spd * dt;
        k.y = Math.max(0, k.y);
      }
    }
  }

  /**
   * 自爆攻擊的爆風定義(2026-07-27 改制):傷害改吃「機種絕招傷害預算」——
   * 隨**輕/重武器綜合等級**成長,且與轟炸餌機/重砲模式同額(見 data.js SPECIAL)。
   * solo=true = 主機自毀撞擊(一架機體吃整份預算);否則 = 單架護衛自殺機(N 架均分)。
   * 半徑/破甲/vs 仍照 UNITS.drone.bomb;owner 缺值/無 abil → 綜合 Lv1(向後相容)。
   */
  _bombDef(owner, solo = false) {
    const abil = owner?.abil;
    return solo ? selfBoomBlast(abil) : kamiBlast(abil);
  }

  /** 自殺攻擊機引爆:重型炸彈爆風(同餌機:算主機頭上,吃其火力升級/增益,擊殺記給它) */
  _kamiBoom(k) {
    if (k.uA) {
      // 大招載具:效果取代傷害(2026-08-06 使用者定案)—— 引爆 = 施放該架攜帶的份,不附爆風
      this.events.push({ e: 'boom', x: k.x, z: k.z, y: k.y || 0, r: 6, side: k.side, kami: 1 });
      this._ultArrive(k, k.x, k.z);
      this._removeKami(k);
      return;
    }
    const sq = this.squads.get(k.pid);
    const owner = sq ? sq.bodies[sq.act] : null;
    const def = this._bombDef(owner);   // 每架 = 絕招預算 / KAMI.N(N 架打完 = 一份完整預算)
    this.events.push({ e: 'boom', x: k.x, z: k.z, y: k.y || 0, r: def.r, side: k.side });
    if (owner) this._blast(owner, def, k.x, k.z, k.y || 0, this._unitLev(k));   // 爆點層 = 自殺機所在層
    this._removeKami(k);
  }

  /**
   * 自殺攻擊機被擊毀(2026-07-22 使用者需求):原地以正常撲擊爆風的 50% 傷害與半徑引爆
   * (舊版被擊落只消失、不引爆)。爆點仍算主機頭上(吃其火力升級/增益,擊殺記給它);
   * 客戶端 boom 事件帶 kami 旗標 → 播殉爆演出。呼叫端(_kill)另行 _removeKami。
   */
  _kamiDeathBoom(k) {
    if (k.uA) {
      // 大招載具被擊落 = 該份完全否定(效果已取代傷害 ⇒ 沒有殉爆可留);只留碎裂演出
      this.events.push({ e: 'boom', x: k.x, z: k.z, y: k.y || 0, r: 6, side: k.side, sam: true });
      return;
    }
    const sq = this.squads.get(k.pid);
    const owner = sq ? sq.bodies[sq.act] : null;
    const def = this._bombDef(owner);
    def.dmg = Math.round(def.dmg * SQUAD.KAMI.DEATH_F);   // 撲擊爆風的 50%
    def.r = def.r * SQUAD.KAMI.DEATH_F;                   // 半徑減半
    this.events.push({ e: 'boom', x: k.x, z: k.z, y: k.y || 0, r: def.r, side: k.side, kami: 1 });
    if (owner) this._blast(owner, def, k.x, k.z, k.y || 0, this._unitLev(k));
  }

  _removeKami(k) {
    k.hp = 0;
    this.ents.delete(k.id);
    const sq = this.squads.get(k.pid);
    if (sq && sq.kamis) { const j = sq.kamis.indexOf(k); if (j >= 0) sq.kamis.splice(j, 1); }
  }

  /**
   * 原地復活(s12「滿天星座」;2026-08-06 使用者定案「限重生倒數中、半血復活」)。
   * **只救仍在重生倒數中的機體** —— 已經自己回場的不算(呼叫端以 `respawnAt > this.t` 把關);
   * 位置刻意不動(原地站起來),故 MUST NOT 走 `_respawn`(那支會把人瞬移回主堡)。
   * `_trail` 一併清掉:復活在時間軸上是一段空白,留著上一條命的位置軌跡會讓落點閘門回推到死前的位置。
   */
  _reviveBody(b, f) {
    if (b.sq?.boss) return;   // NPC BOSS 不重生(使用者定案)⇒ 復活招式對它也是重生,一併擋掉
    b.dead = false;
    b.respawnAt = 0;
    b.dash = 0;
    b.hp = Math.max(1, Math.round(b.maxHp * f));
    b.sp = b.maxSp * f;
    b.lastHitAt = this.t;
    b.invUntil = this.t + SELF_ULT.REVIVE_INV_S;   // 站起來那一瞬不該被同一發爆風再收一次
    b.stunUntil = 0; b.slowUntil = 0; b.confUntil = 0; b.blindUntil = 0; b.bleed = null; b.asst = null;
    b.supUntil = 0; b.supF = 0;   // 高地壓制:站起來那一刻不該還帶著倒下前的壓制
    b._trail = null;
    this.events.push({ e: 'respawn', id: b.id, side: b.side, pid: b.pid, revive: 1 });
  }

  /** 挨一發就結束的招式(`brk`;t02 超載):撤銷該批 mods 與免裝填時窗。
   *  只由 `_damage` 的英雄分支呼叫 —— 判定散出去就會變成「有些傷害來源不會打斷」。 */
  _breakOnHit(h) {
    if (!h.mods || !h.mods.length) return;
    let hit = false;
    for (let i = h.mods.length - 1; i >= 0; i--) {
      if (h.mods[i].brk) { h.mods.splice(i, 1); hit = true; }
    }
    if (hit) h.noReloadUntil = 0;
  }

  /**
   * 詠唱中受擊強制立即施展(2026-08-22 使用者定案):
   * 詠唱期間被攻擊時會強制立即施展(已詠唱時間比例平方的效果)。
   * f = (t_elapsed / T_cast)^2
   */
  _interruptCast(h) {
    const hero = h.pid ? this.heroes.get(h.pid) : h;
    if (!hero || !hero.cast) return;
    const c = hero.cast;
    hero.cast = null;
    const elapsed = Math.max(0, Math.min(c.dur, this.t - c.start));
    const r = c.dur > 0 ? elapsed / c.dur : 1;
    const f = r * r;
    this._castEffect(hero, c.A, c.x, c.z, f, null, true);
    this.events.push({ e: 'cast', pid: hero.pid, side: hero.side, ch: hero.ch, slot: 'skill', fx: c.A.fx, x: c.x, z: c.z, r: c.A.r, dur: c.A.dur, lvl: c.lvl, frac: f, interrupted: true });
  }

  /** 目前仍有效的準星鎖定目標(存活、敵方、未過期);沒有 → null */
  _lockedTarget(sq) {
    if (this.t - sq.lockAt > LOCK.TTL) return null;
    const t = this.ents.get(sq.lock);
    if (!t || t.hp <= 0 || t.side === sq.side || (t.hero && t.dead)) return null;
    return t;
  }

  /** 單機自毀引爆:不給任何一方擊殺數;傷害同吃機種絕招預算(整份;見 _bombDef) */
  _boom(b) {
    const def = this._bombDef(b, true);
    this.events.push({ e: 'boom', x: b.x, z: b.z, y: b.y || 0, r: def.r, side: b.side });
    this._blast(b, def, b.x, b.z, b.y || 0, this._unitLev(b));   // 爆點層 = 自毀機所在層
    b.dash = 0;
    b.hp = 0;
    this._kill(b, null);
  }

  // ---------- 集束轟炸機(2026-08-06 起只服務大招載具遞送)----------
  // 機種絕招「集束炸彈」(heroDecoy)整組退場,MUST NOT 復辟(見上方 heroKamikaze 同註):
  // decoy 只剩「大招載具」這一個身分,唯一生成點 = _launchUltCarrier。

  // ---------- 極音速飛彈(2026-08-06 起只服務大招載具遞送)----------
  // 機種絕招「極音速飛彈」(heroHyper)整組退場,MUST NOT 復辟(見上方 heroKamikaze 同註):
  // hyper 只剩「大招載具」這一個身分,唯一生成點 = _launchUltCarrier。

  /**
   * 每 tick:拋物線爬升 → 到頂點(目標正上方)轉俯衝 → 螺旋落向目標 → 觸地/近炸引爆。
   * 兩相位都不吃玩家輸入(射後不理);追蹤對象死亡/消失 → 沿用發射瞬間的落點 tx/tz 打下去。
   * 爬升段:水平**等速** hyperClimbVx()、高度只由 hyperArcY(單一縫)給 ⇒ 出膛角恆為 LAUNCH_DEG。
   * 俯衝段:彈道軸 = 「頂點 → 落點」的直線,位置再疊上**水平圓**螺旋偏擺(SPIN_RPS / SPIRAL_R)。
   *   螺旋基底刻意取**固定的水平法向 ±(uz, −ux)**,而不是由彈道軸現算 —— 頂點就在目標正上方,
   *   軸的水平分量趨近 0,拿它當基底會在最需要螺旋的「垂直落下」那一發整個退化成沒有螺旋。
   * 兩端同吃同一份參數就會畫出同一條航跡(客戶端只插值 y/x/z,不自己另算彈道)。
   *
   * **終端追擊(2026-08-05 使用者定案;見 data.js HYPER 檔頭 ①②③)**:
   *   ・前 2/3(爬升段)一律不讀目標的即時位置 —— 落點就是發射瞬間烤死的 tx/tz;
   *   ・後 1/3(俯衝段)的入口**判定一次** `m.chase`:目標仍在 hyperTrackR() 內才轉為追擊,
   *     否則放掉 tid、沿原軌跡打下去。判定 MUST 只做這一次 —— 逐 tick 重判會讓兩個相距
   *     可達 hyperTrackR() 的落點在最後零點幾秒互相搶,彈道當場折斷(客戶端只做插值,
   *     那一折在兩端會插出不同的航跡)。
   *   ・距離量到**發射瞬間的落點**(= 頂點正下方,也就是這一刻飛彈自己的水平位置):
   *     「目標有沒有跑出這一發的打擊範圍」問的是它離**原定落點**多遠,不是離飛彈多遠。
   */
  _tickHypers(dt) {
    for (const h of this.heroes.values()) {
      // 名冊是**陣列**(2026-08-07):小招也載具化之後,同一名機甲玩家的小招與大招都可能是
      // 極音速飛彈形式(t01 / m06)⇒ 單槽位的 `h.hyper` 會被第二發覆寫,第一發從此不再被推進、
      // 也不會被移除 = 一顆卡在空中的殭屍實體(打得到、擋 LOS、永不落地),而且沒有任何錯誤訊息。
      const list = h.hypers;
      if (!list || !list.length) continue;
      for (let i = list.length - 1; i >= 0; i--) {
      const m = list[i];
      if (m.hp <= 0) { list.splice(i, 1); continue; }   // 已被擊落(_kill 走 _hyperShotDown)
      // 追擊候選(射後不理:飛彈自己追,玩家不必維持鎖定);死亡/離場即放掉,落點維持原軌跡
      const t0 = m.tid ? this.ents.get(m.tid) : null;
      const t = t0 && t0.hp > 0 && !(t0.hero && t0.dead) ? t0 : null;
      if (!t) m.tid = 0;
      // 追擊中才改寫落點;未追擊(含爬升段)一律沿用發射瞬間的 tx/tz
      if (m.chase && t) { m.tx = t.x; m.tz = t.z; }

      if (m.phase === 'climb') {
        m.trav = Math.min(m.arcD, m.trav + hyperClimbVx() * dt);
        const f = m.trav / m.arcD;
        m.x = m.x0 + m.ux * m.trav;
        m.z = m.z0 + m.uz * m.trav;
        m.y = m.y0 + hyperArcY(m.arcD, f);
        if (f >= 1) {
          m.phase = 'dive'; m.dive = { x: m.x, z: m.z, y: m.y }; m.trav = 0;
          // 後 1/3 的入口:目標還在原定落點的 hyperTrackR() 內 ⇒ 螺旋追擊;否則保持原軌跡
          m.chase = !!t && Math.hypot(t.x - m.tx, t.z - m.tz) <= hyperTrackR();
          if (!m.chase) m.tid = 0;   // 放棄追擊 = 這一發從此與那個實體無關(高度也回地面)
        }
        continue;
      }
      // 俯衝:沿「頂點 → 目標地面點」的軸線前進,位置再疊上繞軸的水平圓螺旋偏擺
      const ty = t ? this._tgtY(t) : 0;
      const ax = m.tx - m.dive.x, az = m.tz - m.dive.z, ay = ty - m.dive.y;
      const al = Math.hypot(ax, az, ay) || 1;
      m.trav += hyperDiveSpd() * dt;
      const f = Math.min(1, m.trav / al);
      m.spin += HYPER.SPIN_RPS * Math.PI * 2 * dt;
      // 螺旋半徑隨接近目標收斂到 0(否則落點會被偏擺推開一個 SPIRAL_R)
      const sr = HYPER.SPIRAL_R * (1 - f);
      const c = Math.cos(m.spin) * sr, s = Math.sin(m.spin) * sr;
      m.x = m.dive.x + ax * f + m.uz * c + m.ux * s;    // 水平圓:基底 = 發射方位與其法向
      m.z = m.dive.z + az * f - m.ux * c + m.uz * s;
      m.y = Math.max(0, m.dive.y + ay * f);
      m.ry = Math.atan2(-ax, az);
      if (f >= 1) this._hyperBoom(m);
      }
    }
  }

  /** 極音速飛彈命中引爆:整份絕招預算的單一戰鬥部(爆點算主機頭上 ⇒ 吃其增益、擊殺記給它) */
  _hyperBoom(m) {
    if (m.uA) {
      // 大招載具:效果取代傷害(2026-08-06 使用者定案)—— 著彈只施放大招效果,不再有戰鬥部爆風
      this.events.push({ e: 'boom', x: m.x, z: m.z, y: m.y || 0, r: 8, side: m.side, hyper: 1 });
      this._ultArrive(m, m.x, m.z);
      this._removeHyper(m);
      return;
    }
    const h = this.heroes.get(m.pid);
    const def = hyperBlast(h?.abil);
    this.events.push({ e: 'boom', x: m.x, z: m.z, y: m.y || 0, r: def.r, side: m.side, hyper: 1 });
    if (h) this._blast(h, def, m.x, m.z, m.y || 0, this._unitLev(m));
    this._removeHyper(m);
  }

  /** 被擊落(_kill 呼叫):**不引爆**(攔截成功就該是完全否定)—— 只留一團碎裂演出 */
  _hyperShotDown(m) {
    this.events.push({ e: 'boom', x: m.x, z: m.z, y: m.y || 0, r: 6, side: m.side, sam: true });
  }

  _removeHyper(m) {
    m.hp = 0;
    this.ents.delete(m.id);
    const h = this.heroes.get(m.pid);
    const i = h?.hypers ? h.hypers.indexOf(m) : -1;
    if (i >= 0) h.hypers.splice(i, 1);
  }

  /**
   * 每 tick:追蹤轉向(限轉率)→ 直線前進 → 失聯判定 → 近炸 / 燃料耗盡自爆。
   * 失聯 = 離主機甲 > LINK_M:斷訊(不再回傳視野與 PiP 畫面)且放棄追蹤,但仍會直飛到自爆。
   */
  _tickDecoys(dt) {
    for (const sq of this.squads.values()) {
      // 名冊是**陣列**(2026-08-07,同 h.hypers):小招也載具化之後,同一名變形者玩家的小招與
      // 大招都可能是集束轟炸機形式(s03 / t11 / m05)⇒ 單槽位會被第二架覆寫,第一架成為殭屍實體。
      const list = sq.decoys;
      if (!list || !list.length) continue;
      for (let di = list.length - 1; di >= 0; di--) {
      const d = list[di];
      if (d.hp <= 0) { list.splice(di, 1); continue; }
      if (this.t >= d.dieAt) { this._decoyBoom(d); continue; }

      if (d.uA) {
        // 大招載具(點遞送):限轉率飛向落點,進 BOMB_R 起每 BOMB_GAP 投遞一份(間斷型);
        // 投完短暫飛離後解體。不吃鏈路距離(射後不理)、不索敵 —— 效果落在瞄準點。
        if (d.uDrops.length && this.t >= (d.nextBomb || 0)
          && dist2d(d.x, d.z, d.pt.x, d.pt.z) <= DECOY.BOMB_R) {
          const part = d.uDrops.shift();
          this._ultArrive(d, d.pt.x, d.pt.z, part.frac, part.n);
          d.nextBomb = this.t + DECOY.BOMB_GAP;
          if (!d.uDrops.length) d.dieAt = Math.min(d.dieAt, this.t + 1.5);   // 任務完成
        }
        const want = Math.atan2(-(d.pt.x - d.x), d.pt.z - d.z);
        let dr = want - d.ry;
        while (dr > Math.PI) dr -= Math.PI * 2;
        while (dr < -Math.PI) dr += Math.PI * 2;
        d.ry += Math.max(-DECOY.TURN * dt, Math.min(DECOY.TURN * dt, dr));
        d.x += -Math.sin(d.ry) * DECOY.SPEED * dt;
        d.z += Math.cos(d.ry) * DECOY.SPEED * dt;
        continue;
      }

      const owner = sq.bodies[sq.act];
      if (!d.lost && dist2d(d.x, d.z, owner.x, owner.z) > DECOY.LINK_M) {
        d.lost = true;
        d.tid = 0;                                   // 失聯 = 失去火控,不再追蹤
        this.events.push({ e: 'decoyLost', pid: sq.pid, id: d.id });
      }

      // 集束投彈:敵入 BOMB_R(攻擊範圍)才開始丟,間隔 BOMB_GAP、單次任務最多 BOMB_MAX 顆。
      // **逐顆個別瞄準**(2026-08-01):每次取範圍內最近的、這一輪還沒被指派過的敵人 ——
      // 多目標時炸彈分散到不同目標,單目標時才連續補刀(舊制是「炸在自己腳下」)。
      if ((d.bombsLeft || 0) > 0 && this.t >= (d.nextBomb || 0)) {
        const tgt = this._decoyBombTarget(d);
        if (tgt) {
          this._decoyBomb(d, owner, tgt);
          d.bombsLeft--;
          d.nextBomb = this.t + DECOY.BOMB_GAP;
        }
      }

      const t = d.tid ? this.ents.get(d.tid) : null;
      if (t && (t.hp <= 0 || (t.hero && t.dead))) d.tid = 0;
      else if (t) {
        const ty = t.hero || t.kind === 'heli' ? (t.y || 0) : 0;
        if (Math.hypot(t.x - d.x, t.z - d.z, ty - d.y) <= DECOY.BOOM_M) { this._decoyBoom(d); continue; }
        // 限轉率追蹤(水平航向 + 直接對齊高度;無法瞬間掉頭 = 可被走位甩掉)
        const want = Math.atan2(-(t.x - d.x), t.z - d.z);
        let dr = want - d.ry;
        while (dr > Math.PI) dr -= Math.PI * 2;
        while (dr < -Math.PI) dr += Math.PI * 2;
        d.ry += Math.max(-DECOY.TURN * dt, Math.min(DECOY.TURN * dt, dr));
        d.y += Math.max(-DECOY.SPEED * dt, Math.min(DECOY.SPEED * dt, ty - d.y));
      }
      d.x += -Math.sin(d.ry) * DECOY.SPEED * dt;
      d.z += Math.cos(d.ry) * DECOY.SPEED * dt;
      d.y = Math.max(0, d.y);
      }
    }
  }

  // ---------- 平民與間諜(非兵線隨機放置的非戰鬥人員;neutral ent)----------
  /** 每陣營在非兵線空曠處生成 ~10 名平民(隨兵線數縮放),其中 SPY_RATE 為間諜(9:1)。 */
  _seedCivilians() {
    const n = CIVILIAN.PER_SIDE_BASE + CIVILIAN.PER_SIDE_PER_LANE * this.lanes.length;
    const spies = Math.round(n * CIVILIAN.SPY_RATE);
    for (const side of ['SWARM', 'STEEL']) {
      for (let i = 0; i < n; i++) {
        const pt = this._civPoint();
        if (!pt) continue;   // 地圖太擠取不到合法點:寧缺勿錯
        this._spawnCiv(side, i < spies, Math.floor(Math.random() * CIVILIANS.length), pt);
      }
    }
  }

  /** 在合法點生成一名平民/間諜(seed 與陣亡重生共用,避免兩處各抄一份 ent 欄位)。回傳生成的 ent。 */
  _spawnCiv(cs, spy, prof, pt) {
    return this._add({
      kind: 'civilian', side: null, neutral: true, civ: true,
      cs, spy, prof,
      x: pt.x, z: pt.z, y: 0, ry: 0, hp: UNITS.civilian.hp,
      home: [pt.x, pt.z], wp: null, wpPause: Math.random() * CIVILIAN.WANDER_PAUSE[1],
      follow: null, followT: 0, flee: false, fleeTtl: 0, fleeX: 0, fleeZ: 0,
    });
  }

  /** 隨機取一個非兵線、離主堡與障礙夠遠的平民生成點(比照 _airdropPoint，邊界預留安全餘量)。 */
  _civPoint() {
    const b = this.bounds;
    for (let tries = 0; tries < 40; tries++) {
      const x = b.minX + Math.random() * (b.maxX - b.minX);
      const z = b.minZ + Math.random() * (b.maxZ - b.minZ);
      if (!this._inBounds(x, z, 4)) continue;
      if (this._distToLanes(x, z) < CIVILIAN.LANE_MIN) continue;
      if (!this._farFromStructures(x, z, CIVILIAN.BASE_CLEAR, 0)) continue;
      if (this.hazBlockers.some(([hx, hz, hr]) => dist2d(x, z, hx, hz) < hr + 2)) continue;
      if (this._terrainBlocked(x, z)) continue;   // 平民生成/重生點避開水域/沼澤/火場(feature 9)
      return { x, z };
    }
    return null;
  }

  /** 徘徊路點:繞出生點 WANDER_R 內、仍在非兵線範圍的隨機點(取不到回原地，嚴守邊界內)。 */
  _civWander(e) {
    for (let i = 0; i < 12; i++) {
      const a = Math.random() * Math.PI * 2, r = Math.random() * CIVILIAN.WANDER_R;
      const x = e.home[0] + Math.cos(a) * r, z = e.home[1] + Math.sin(a) * r;
      if (!this._inBounds(x, z, 4)) continue;
      if (this._distToLanes(x, z) < CIVILIAN.LANE_MIN) continue;
      if (this._terrainBlocked(x, z)) continue;   // 徘徊路點避開水域/沼澤/火場(feature 9)
      return [x, z];
    }
    return [e.home[0], e.home[1]];
  }

  /** 平民朝(away=遠離)目標移動;更新朝向、夾在地圖安全邊界內。回傳是否有位移。 */
  _moveCiv(e, tx, tz, sp, dt, away = false) {
    let dx = tx - e.x, dz = tz - e.z;
    const d = Math.hypot(dx, dz);
    if (d < 1e-3) return false;
    const s = (away ? -1 : 1) / d;
    const margin = 4.0;
    const nx = Math.max(this.bounds.minX + margin, Math.min(this.bounds.maxX - margin, e.x + s * dx * sp * dt));
    const nz = Math.max(this.bounds.minZ + margin, Math.min(this.bounds.maxZ - margin, e.z + s * dz * sp * dt));
    // 不走進水域/沼澤/火場(feature 9;逃離/跟隨的動態目標可能穿越危險區 → 逐步擋在邊緣;
    // 當前已在危險區內才放行走出來)。與第三方 _tpMove 邊緣守衛一致。
    if (this._terrainBlocked(nx, nz) && !this._terrainBlocked(e.x, e.z)) return false;
    e.x = nx;
    e.z = nz;
    e.ry = Math.atan2(-(s * dx), s * dz);   // 面向移動方向(sim z=北,與餌機同慣例)
    return true;
  }

  /** 平民/間諜每 tick:先處理陣亡重生,再逃離(驅趕)> 跟隨(我方跟隨者週期給物資)> 徘徊。 */
  _tickCivilians(dt) {
    // 陣亡重生:到期者於隨機合法點補位;取不到點(地圖太擠)留佇列下 tick 再試
    if (this.civRespawns.length) {
      const still = [];
      for (const r of this.civRespawns) {
        if (this.t < r.at) { still.push(r); continue; }
        const pt = this._civPoint();
        if (!pt) { still.push(r); continue; }
        this._spawnCiv(r.cs, r.spy, Math.floor(Math.random() * CIVILIANS.length), pt);
      }
      this.civRespawns = still;
    }
    for (const e of this.ents.values()) {
      if (!e.civ) continue;
      const sp = civSpeed(e.spy);
      // 被驅趕:朝相反方向快步離開,計時到就消失
      if (e.flee) {
        e.fleeTtl -= dt;
        if (e.fleeTtl <= 0) { this.ents.delete(e.id); continue; }
        this._moveCiv(e, e.fleeX, e.fleeZ, sp * CIVILIAN.FLEE_SPEED_F, dt, true);
        continue;
      }
      // 跟隨:保持 FOLLOW_R;主人陣亡/失聯 → 回復徘徊
      if (e.follow != null) {
        const owner = this.heroes.get(e.follow);
        if (!owner || owner.dead || dist2d(e.x, e.z, owner.x, owner.z) > CIVILIAN.FOLLOW_LINK_M) {
          e.follow = null; e.followT = 0;
        } else {
          if (dist2d(e.x, e.z, owner.x, owner.z) > CIVILIAN.FOLLOW_R) this._moveCiv(e, owner.x, owner.z, sp, dt);
          // 我方跟隨者存活:每 FOLLOW_REWARD_S 給一次「依職業」的小空投物資
          if (e.cs === owner.side) {
            e.followT += dt;
            if (e.followT >= CIVILIAN.FOLLOW_REWARD_S) {
              e.followT -= CIVILIAN.FOLLOW_REWARD_S;
              const ev = { e: 'civaid', pid: owner.pid, side: owner.side, x: e.x, z: e.z, prof: e.prof,
                ...this._grantReward(owner, CIVILIANS[e.prof].reward, CIVILIAN.FOLLOW_MUL) };
              this.events.push(ev);
            }
          }
          continue;
        }
      }
      // 徘徊:繞出生點慢走 + 抵達後停留
      if (e.wpPause > 0) { e.wpPause -= dt; continue; }
      if (!e.wp || dist2d(e.x, e.z, e.wp[0], e.wp[1]) < 2) {
        e.wp = this._civWander(e);
        e.wpPause = CIVILIAN.WANDER_PAUSE[0] + Math.random() * (CIVILIAN.WANDER_PAUSE[1] - CIVILIAN.WANDER_PAUSE[0]);
        continue;
      }
      this._moveCiv(e, e.wp[0], e.wp[1], sp, dt);
    }
  }

  /**
   * 平民互動(客戶端靠近 INTERACT_R 內回報):act='follow' 要求跟隨 / 'away' 驅趕。
   * 兩者不分陣營皆可;跟隨的週期報酬只有「我方平民(cs === 玩家陣營)」才有(見 _tickCivilians)。
   */
  civInteract(pid, id, act) {
    const h = this.heroes.get(pid);
    const t = this.ents.get(id);
    if (!h || h.dead || !t || !t.civ || t.hp <= 0 || this.over) return;
    if (dist2d(h.x, h.z, t.x, t.z) > CIVILIAN.INTERACT_R * 1.25) return;   // 留一成寬容給延遲
    if (act === 'away') {
      t.follow = null; t.followT = 0;
      t.flee = true; t.fleeTtl = CIVILIAN.FLEE_TTL_S;
      t.fleeX = h.x; t.fleeZ = h.z;   // 逃離「玩家所在」方向
      this.events.push({ e: 'civact', pid, act: 'away', side: h.side, x: t.x, z: t.z, cs: t.cs });
    } else {
      t.flee = false;
      t.follow = pid; t.followT = 0;
      this.events.push({ e: 'civact', pid, act: 'follow', side: h.side, x: t.x, z: t.z, cs: t.cs });
    }
  }

  /** 餌機自爆:爆風算在主機甲頭上(吃它的火力升級 / 招式增益,擊殺也記給它) */
  _decoyBoom(d) {
    if (d.uA) {
      // 大招載具:效果取代傷害 —— 任務結束/燃料耗盡只解體;未投完的份**不補投**(擊落/逾時 = 否定)
      this.events.push({ e: 'boom', x: d.x, z: d.z, y: d.y, r: 8, side: d.side, sam: true });
      this._removeDecoy(d);
      return;
    }
    const sq = this.squads.get(d.pid);
    const owner = sq ? sq.bodies[sq.act] : null;
    // 撞擊爆風 = 絕招預算 × DECOY_IMPACT(隨主機甲輕/重武器綜合等級成長);爆點層 = 餌機所在層(不穿橋面/隧道天花)
    // 演出半徑 MUST 取結算用的同一份 def.r(面積計價後半徑是推導值)—— 看到多大 = 打到多大
    const def = decoyBlast(owner?.abil);
    this.events.push({ e: 'boom', x: d.x, z: d.z, y: d.y, r: def.r, side: d.side });
    if (owner) this._blast(owner, def, d.x, d.z, d.y, this._unitLev(d));
    // 2026-07-19:自爆(燃料耗盡/近炸)時尚有未投完的炸彈 → 原地補投一枚(復用單一投彈縫,記主機甲)
    if (owner && (d.bombsLeft || 0) > 0) { d.bombsLeft--; this._decoyBomb(d, owner, this._decoyBombTarget(d)); }
    this._removeDecoy(d);
  }

  _removeDecoy(d) {
    this.ents.delete(d.id);
    const sq = this.squads.get(d.pid);
    const i = sq?.decoys ? sq.decoys.indexOf(d) : -1;
    if (i >= 0) sq.decoys.splice(i, 1);
  }


  /**
   * 集束投彈的**逐顆瞄準解**(2026-08-01 使用者需求「有多目標時個別瞄準」):
   * BOMB_R 內的敵方單位取最近者,且優先挑這一趟任務還沒被指派過的(d.bombed 記名冊)——
   * 目標數 ≥ 剩餘彈數時等於一顆一個,目標打完/只剩一個時名冊清空、回到連續補刀。
   * 沒有合法目標 → 回 null,呼叫端**不投**(寧缺勿錯:炸彈不浪費在空地上)。
   */
  _decoyBombTarget(d) {
    let best = null, bd = Infinity, fallback = null, fd = Infinity;
    for (const e of this.ents.values()) {
      if (e.side === d.side || !e.side || e.neutral || e.decoy || e.kami || e.hyper || e.gar || e.hp <= 0) continue;
      if (e.hero && (e.dead || (e.stealthUntil || 0) > this.t)) continue;
      if (this._airborne(e)) continue;   // 投彈只對地(不對空中無人機/直升機/升空機甲丟炸彈)
      const dist = dist2d(e.x, e.z, d.x, d.z);
      if (dist > DECOY.BOMB_R) continue;
      if (dist < fd) { fd = dist; fallback = e; }
      if ((d.bombed ||= new Set()).has(e.id)) continue;
      if (dist < bd) { bd = dist; best = e; }
    }
    if (best) { d.bombed.add(best.id); return best; }
    if (fallback) { d.bombed = new Set([fallback.id]); return fallback; }   // 名冊用盡 → 重新一輪
    return null;
  }

  /**
   * 集束轟炸機投下一顆炸彈(依機體類型:燃燒/凍結/毒霧/雷爆,見 DECOY_BOMB)。
   * 落點 = **指定目標的位置**(個別瞄準);沒帶目標(墜毀補投)才落在機體正下方。
   * 直擊爆風走 _blast(記主機火力升級/助攻/擊殺);附加狀態復用既有 bleed/slow/EMP/stun 欄位
   * (與 _applyCC 同一批狀態縫),純狀態貢獻另補 asst 戳記(輔助角色收入)。
   * 事件帶 fx/fz/fy(投擲點)⇒ 客戶端把炸彈畫成**榴彈拋物線**(使用者需求);傷害仍於事件當下
   * 即結算(拋物線純表現層,MUST NOT 改成客戶端落地才回報 —— 那就是把結算下放到客戶端,A1)。
   */
  _decoyBomb(d, owner, tgt = null) {
    if (!owner) return;
    const b = DECOY_BOMB[d.bombType] || DECOY_BOMB.fire;
    const def = decoyBombBlast(owner.abil);   // 單顆 = 預算的非撞擊部分 / BOMB_MAX(同吃綜合武器等級)
    const bx = tgt ? tgt.x : d.x, bz = tgt ? tgt.z : d.z;
    const by = tgt ? (tgt.hero || tgt.kind === 'heli' ? (tgt.y || 0) : 0) : (d.y || 0);
    this.events.push({
      e: 'decoyBomb', x: bx, z: bz, y: by, r: def.r, side: d.side, bomb: d.bombType,
      fx: d.x, fz: d.z, fy: d.y || 0,
    });
    this._blast(owner, def, bx, bz, by, this._unitLev(tgt || d));   // 直擊爆風(走 _damage → 自動蓋 asst + 給擊殺信用)
    // 附加狀態:效果半徑內的敵方單位(建築/中立/無敵幀免疫,比照 _applyCC)
    const rr = def.r * 1.5;
    for (const t of [...this.ents.values()]) {
      if (t.side === d.side || !t.side || t.neutral || t.decoy || t.kami || t.hyper || t.gar || t.hp <= 0) continue;
      if (t.hero && t.dead) continue;
      if (t.kind === 'tower' || t.kind === 'base' || t.kind === 'bunker') continue;   // 工事免控場/狀態
      if (t.hero && (t.invUntil || 0) > this.t) continue;
      if (dist2d(t.x, t.z, bx, bz) > rr) continue;
      (t.asst ||= {})[owner.pid] = this.t;   // 純狀態貢獻也記助攻
      if (b.dot) t.bleed = { dps: b.dot, until: this.t + (b.dur || 4), pen: 6, pid: owner.pid };   // 燃燒/毒霧 DoT
      if (b.slow) { t.slowUntil = Math.max(t.slowUntil || 0, this.t + (b.dur || 3)); t.slowF = Math.min(t.slowF ?? 1, b.slow); }   // 凍結/毒霧 減速(取較強 = 較小)
      if (b.emp) t.empUntil = Math.max(t.empUntil || 0, this.t + b.emp);   // 雷爆:武器離線(英雄與 NPC 皆吃)
      if (b.stun) t.stunUntil = Math.max(t.stunUntil || 0, this.t + b.stun);   // 雷爆:短暫麻痺
      if (b.blind) {
        if (t.hero && this._buffVal(t, 'ccImm') > 0) continue;   // 異常免疫不吃閃光
        t.blindUntil = Math.max(t.blindUntil || 0, this.t + VISION_BLIND.DUR_S);
        t.aiming = false;
        const tsq = t.hero ? this.squads.get(t.pid) : null;
        if (tsq) { tsq.lock = 0; tsq.lockAt = this.t; }
        this._visMemo = null;   // 同 tick 後續索敵/快照不可沿用施加前的視野來源
      }
    }
  }

  // ---------- 招式(小招 Q / 大招 E:解鎖階級 + CD + 電力 MP,全部伺服器結算)----------
  /** 最近兵線與沿線進度(召喚單位入線用) */
  _nearestLane(x, z) {
    let best = { li: 0, d: 0, dist: Infinity };
    for (let li = 0; li < this.lanes.length; li++) {
      const pts = this.lanes[li];
      const cum = this._laneCum(li);
      for (let i = 1; i < pts.length; i++) {
        const [ax, az] = pts[i - 1], [bx, bz] = pts[i];
        const dx = bx - ax, dz = bz - az;
        const len2 = dx * dx + dz * dz || 1;
        const f = Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / len2));
        const dist = dist2d(x, z, ax + dx * f, az + dz * f);
        if (dist < best.dist) best = { li, d: cum[i - 1] + Math.sqrt(len2) * f, dist };
      }
    }
    return best;
  }

  /** slot: 'skill'|'ult';x,z = 指向型招式的目標點(超程時夾回射程邊界) */
  heroCast(pid, slot, x, z) {
    const h = this.heroes.get(pid);
    if (!h || h.dead || this.over || (slot !== 'skill' && slot !== 'ult')) return;
    const lvl = h.abil[slot] || 0;
    if (!lvl) return;                                  // 尚未解鎖
    if ((h.acd[slot] || 0) > this.t) return;           // 冷卻中
    if (this._jammed(h)) return;                       // 電磁癱瘓:招式一併離線
    if (slot === 'skill' && h.cast) return;            // 詠唱中不重複發動
    const A = heroAbility(h.ch, slot, lvl);
    // 2026-07-20:招式冷卻/電力隨招式階級(小招 sk / 大招 ult)成長,無獨立精通折減
    const mpc = Math.round(A ? A.mp : 0);
    if (!A || h.mp < mpc) return;                      // 電力不足
    // 指向型招式:目標點夾在射程內(FPS/DOTA 施法距離)
    if (A.range && x != null) {
      const d = dist2d(h.x, h.z, x, z);
      if (d > A.range) {
        x = h.x + (x - h.x) / d * A.range;
        z = h.z + (z - h.z) / d * A.range;
      }
    } else { x = h.x; z = h.z; }
    h.mp -= mpc;
    const cdMul = (h.sq?.boss && (h.sq.bossSeg || 0) >= 3 ? BOSS.ENRAGE_CD_F : 1);
    h.acd[slot] = this.t + A.cd * cdMul;
    if (A.fx !== 'stealth' && A.fx !== 'vision' && A.fx !== 'rally' && A.fx !== 'recon') h.stealthUntil = 0;   // 出手即現形

    // 2026-08-22 小招改制(本體詠唱施展):
    // 小招非召喚物/載具模式,需要詠唱時間才會生效,被攻擊時強制立即施展(已詠唱時間比例平方的效果)。
    if (slot === 'skill') {
      h.cast = { slot: 'skill', start: this.t, dur: A.castTime, x, z, A, lvl };
      this.events.push({ e: 'cast_start', pid, side: h.side, ch: h.ch, slot: 'skill', dur: A.castTime, x, z, fx: A.fx });
      return;
    }

    // 大招載具遞送(2026-08-06 大招 / 2026-08-22 小招改為詠唱後大招專屬):
    // 發射該機種形式的載具(kami×N / 集束轟炸機 / 極音速飛彈)或派出跟隨主機的輔助機隊,
    // 效果由載具抵達時經同一支 _castEffect 施放(單一縫;擊落 = 該份否定)。
    // 發射點只有 `abilOrigin` 一份(大招 = 最近的我方砲塔/主堡,見 _launchOrigin)。
    const org = this._launchOrigin(h, slot);
    if (A.carrier) {
      this._launchUltCarrier(h, A, x, z, org);
      this.events.push({ e: 'cast', pid, side: h.side, ch: h.ch, slot, fx: A.fx, x, z, r: A.r, dur: A.dur, lvl, carrier: 1, ox: org.x, oz: org.z });
      return;
    }
    // 自身強化型大招:派出 supportN 架跟隨玩家的輔助機
    this._launchUltSupport(h, A, org, slot);
    this.events.push({ e: 'cast', pid, side: h.side, ch: h.ch, slot, fx: A.fx, x: h.x, z: h.z, r: A.r, dur: A.dur, lvl, carrier: 1, sup: supportN(h.ch, slot), ox: org.x, oz: org.z });
  }

  /**
   * 招式載具的**發射點**(2026-08-07 使用者定案「大招改為從最近的砲塔或主堡召喚」;單一縫)。
   * 'self'(小招)= 主機身邊;'fort'(大招)= 離施放者最近的**我方**砲塔或主堡 ——
   * 大招自此是後方戰略資產:整段航程都在場上,可以被鎖定、被打下來。
   * 一座工事都沒有(理論上主堡恆在;測試場景可能真的沒有)⇒ 退回主機自己
   * (原則 6:寧可少一段航程,也不要讓這一招發不出去而且沒有任何錯誤訊息)。
   */
  _launchOrigin(h, slot) {
    const self = { x: h.x, z: h.z, y: h.y || 0 };
    if (abilOrigin(slot) !== 'fort') return self;
    let best = null, bd = Infinity;
    for (const e of this.ents.values()) {
      if (e.side !== h.side || e.hp <= 0) continue;
      if (e.kind !== 'tower' && e.kind !== 'base') continue;
      const d = dist2d(h.x, h.z, e.x, e.z);
      if (d < bd) { bd = d; best = e; }
    }
    return best ? { x: best.x, z: best.z, y: best.y || 0 } : self;
  }

  /**
   * 招式效果的**唯一結算點**(2026-08-06 抽縫):三種點遞送載具的抵達(_kamiBoom / _hyperBoom /
   * _tickDecoys 逐批投遞)與跟隨型輔助機隊(_supSync / _supArm)共用 —— 效果分支 MUST NOT 在
   * 載具端另抄一份。**2026-08-07 起 heroCast 不再是消費端**:兩個槽位一律載具化 ⇒ 施放當下
   * 只發載具,效果一律從載具端進來(heroCast 裡再冒出一個 _castEffect = 某一招又變回瞬發)。
   * (cx, cz) = 效果中心(點遞送 = 抵達點;跟隨編隊 = 主機當下位置)。
   * frac = 可分預算的份額(heal 量 × frac;單載具 = 1);nImp = 這一份攜帶的整數預算
   * (strike 彈著數 / summon 隻數;null = A.count 全額)。emp/buff 恆整份單載(見 ultParts)。
   *
   * 2026-08-07(輔助機隊,見 data.js ULT_SUPPORT):`frac` 自此**同時**縮放狀態值 ——
   *   乘數型 `mf`:1 + (m − 1) × frac(疊加是**加法**;逐架各推一筆會被 `_buffMul` 相乘 ⇒ 全員在線時
   *     的效果高於舊制,而且只在「剛好幾架活著」時對得上帳,沒有任何錯誤訊息);
   *   數值型 `vf`:v × frac(evade / vamp 走 `_buffVal` 取最大值,不相乘)。
   *   frac = 1 ⇒ mf/vf 皆為恆等 ⇒ 瞬發與點遞送三條路徑**逐位元同舊制**。
   * `once` = 這一次是不是這一段效果的第一次施放。輔助機每次增減都要**重算** mods(撤下再放),
   *   而一次性的部分(復活 / 解除異常 / 彈匣全滿 / 定位 / 匿蹤 / 無霧視野)MUST 只在第一次做 ——
   *   重放會把時窗一路往後展期(症狀是「這一招怎麼一直沒結束」)。
   */
  _castEffect(h, A, cx, cz, frac = 1, nImp = null, once = true) {
    const mf = (m) => 1 + (m - 1) * frac;   // 乘數型狀態的份額(疊加 = 加法)
    const vf = (v) => v * frac;             // 數值型狀態的份額
    // 純自身型大招補償(2026-08-06;見 data.js SELF_ULT):機種絕招退場之後,那 9 台把被移除的
    // 預算折進大招本身。**單一縫**:倍率/治療增額只在這裡取一次,MUST NOT 在客戶端或平衡模型
    // 另算一份(算出兩個數字的症狀是「HUD 說 ×2.3、實際掉血是 ×1.35」,兩邊都不報錯)。
    const B = A.id === 'ult'
      ? selfUltBoost(h.ch, h.abil?.ult || 1, h.abil)
      : { dmgMul: 0, heal: 0, alphaX: 1 };
    // 一隊只回傳主視野那架當代表:招式增益(mods)是小隊共用的,推三次會疊三倍。
    // 中心取 (cx, cz):瞬發路徑 cx/cz = 施放者位置 ⇒ 距離 0 恆入列,行為逐位元同舊制。
    const allies = (r) => [...this.heroes.values()].filter((a) =>
      a.side === h.side && !a.dead && dist2d(a.x, a.z, cx, cz) <= r);
    const x = cx, z = cz;

    if (A.fx === 'buff') {
      const targets = A.target === 'team' ? allies(A.r || 0) : [h];
      for (const a of targets) {
        for (const [k, m] of Object.entries(A.mul || {})) {
          // 補償是**增額**不是再乘一層:1.35 + 1.00 = 2.35(相乘會變 2.70 = 多發一份預算)。
          // `brk` 的招式(t02 超載)把 mods 標記起來,挨一發就整批撤銷(見 _breakOnHit)。
          const mm = k === 'dmg' ? m + B.dmgMul : m;
          a.mods.push({ k, m: mf(mm), until: this.t + A.dur, ...(A.brk ? { brk: 1 } : {}) });
        }
        // 走位/其他類追加效果(haste 衝鋒 / leap 大跳躍 / dodge 完美迴避 / vamp 吸血 → mods 通道;
        // mark 定位 → markUntil 一擊即耗)—— 效果種類與數值全住 data.js 的 add 欄位
        const ad = A.add;
        if (ad) {
          if (ad.fx === 'haste') a.mods.push({ k: 'speed', m: mf(ad.f || 1.25), until: this.t + A.dur });
          else if (ad.fx === 'leap') a.mods.push({ k: 'jump', m: mf(ad.f || 2), until: this.t + A.dur });
          else if (ad.fx === 'dodge') a.mods.push({ k: 'dodge', m: 1, until: this.t + A.dur });
          else if (ad.fx === 'vamp') a.mods.push({ k: 'vamp', m: vf(ad.f || 0.12), until: this.t + A.dur });
          else if (ad.fx === 'mark') { if (once) a.markUntil = this.t + (ad.dur || A.dur); }
          else if (ad.fx === 'evade') a.mods.push({ k: 'evade', m: vf(ad.evade || 0), until: this.t + A.dur, ...(A.brk ? { brk: 1 } : {}) });
          else if (ad.fx === 'overdrive') {
            // 超載(t02「同步率 100%」;2026-08-06 使用者定案):彈匣全滿 + 期間免裝填 + 閃避率加成。
            // 「全滿」= 清掉彈藥/填彈帳,下一次 _gateFire 的 `??= def.mag` 就是滿匣(與重生同一條路);
            // 免裝填只是一個時窗旗標,MUST NOT 改成「彈匣無限大」(那會把彈匣整數化與射速壓縮一起繞過)。
            if (once) { a.ammo = {}; a.reloadUntil = {}; a.noReloadUntil = this.t + A.dur; }
            a.mods.push({ k: 'evade', m: vf(ad.evade || 0), until: this.t + A.dur, ...(A.brk ? { brk: 1 } : {}) });
          }
        }
      }
    } else if (A.fx === 'heal') {
      // 「特殊招式」是裝甲(第二層 HP)在主堡以外唯一的回復手段(小隊三架一起回)。
      // frac = 載具分批份額(heal 量與護盾補量等比;瞬發 frac = 1 逐位元同舊制)
      const targets = A.target === 'team' ? allies(A.r || 0) : [h];
      const healAmt = A.heal + B.heal;   // 補償增額(s11「大修」;治療 X 點 = 抵銷 X 點傷害)
      for (const a of targets) {
        for (const b of this._bodies(a)) {
          if (b.dead) continue;
          this._healBody(b, healAmt * frac, 'skill');
          if (A.sp) b.sp = Math.min(b.maxSp, b.sp + b.maxSp * frac);
        }
      }
    } else if (A.fx === 'strike') {
      const nStrike = nImp ?? A.count;
      for (let i = 0; i < nStrike; i++) {
        const ang = Math.random() * Math.PI * 2;
        const rr = i === 0 ? 0 : Math.random() * (A.scatter || A.r * 2);
        const ix = x + Math.cos(ang) * rr, iz = z + Math.sin(ang) * rr;
        this.events.push({ e: 'boom', x: ix, z: iz, r: A.r, side: h.side });
        // 空襲自天而降 → 爆點恆為地面層(lev 0):砸在隧道覆蓋段上方不會隔著山體炸到洞內
        // 重建的 def MUST 帶齊剋制欄位:漏抄 vsSp/vsHp/spPierce 的話,招式版與武器版
        // 會對同一個護盾軸有兩種行為(A34 的第二份拆分邏輯,只是換了個地方漏)。
        this._blast(h, { dmg: A.dmg * frac, r: A.r, vs: A.vs, pen: A.pen,
          vsSp: A.vsSp, vsHp: A.vsHp, spPierce: A.spPierce }, ix, iz, 0, 0);
        if (A.add) this._applyCC(h, A.add, ix, iz, A.r);   // 控場類追加效果:彈著區內敵人
      }
    } else if (A.fx === 'summon') {
      // 召喚中心 = 效果落點(瞬發 = 施放者位置;載具遞送 = 抵達點,單位就地投入最近兵線)
      const nSum = nImp ?? Math.max(1, Math.round(A.count * frac));
      const { li, d } = this._nearestLane(x, z);
      const total = this._laneCum(li)[this._laneCum(li).length - 1];
      const comp = A.unit === 'squad'
        ? Array.from({ length: nSum }, (_, i) => (i % 3 === 2 ? 'rocketeer' : 'soldier'))
        : Array(nSum).fill(A.unit);
      comp.forEach((kind, i) => {
        this._add({
          kind, side: h.side, lane: li,
          x: x + (Math.random() - 0.5) * 20, z: z + (Math.random() - 0.5) * 20,
          y: kind === 'heli' ? GAME.HELI_ALT : 0,
          hp: UNITS[kind].hp,
          prog: (h.side === 'SWARM' ? d : total - d) - i * 12,
        });
      });
    } else if (A.fx === 'emp') {
      // 區域電磁癱瘓:敵方英雄與小兵武器離線(建築免疫);可附帶回傳視野
      for (const e of this.ents.values()) {
        if (e.side === h.side || !e.side || e.neutral) continue;
        if (e.kind === 'tower' || e.kind === 'base') continue;
        if (e.hero && e.dead) continue;
        if (e.hero && this._buffVal(e, 'ccImm') > 0) continue;   // 異常免疫(s12「滿天星座」)
        if (dist2d(e.x, e.z, x, z) > A.r) continue;
        e.empUntil = Math.max(e.empUntil || 0, this.t + A.dur * frac);
        (e.asst ||= {})[h.pid] = this.t;   // 施加負面狀態 = 助攻貢獻(與 _applyCC/_applyHitEmp 同規)
      }
      if (A.vision) this.visionUntil[h.side] = Math.max(this.visionUntil[h.side], this.t + A.vision * frac);
    } else if (A.fx === 'vision') {
      this.visionUntil[h.side] = Math.max(this.visionUntil[h.side], this.t + A.vision * frac);
    } else if (A.fx === 'stealth') {
      if (once) h.stealthUntil = this.t + A.dur * frac;
      // 破隱爆發窗(m08「查無此人」;2026-08-06 使用者定案「破隱一秒內傷害增加」):這裡只**上膛**,
      // 真正開窗在 `_gateFire` 那一行 `stealthUntil = 0`(= 開火現形的唯一時刻)——
      // 在這裡就開窗的話,玩家躲著不開火也在燒那一秒,而畫面上只表現成「爆發好像沒生效」。
      if (A.add?.fx === 'alpha' && once) { h.alphaX = B.alphaX; h.alphaArm = this.t + A.dur; }
    } else if (A.fx === 'rally' || A.fx === 'recon') {
      // 2026-08-06 純自身型大招補償的兩個新效果(見 data.js SELF_ULT):
      //   rally 復甦(s12)—— 全隊回復加速 + 解除並免疫異常 + **重生倒數中**的隊友原地復活;
      //   recon 偵搜(m04)—— 全隊無霧視野 + 射程 / 跑速 / 閃避加成。
      // 兩者刻意**不吃半徑**(使用者定案「全隊」)⇒ 不走 allies();mods 推在英雄身上
      // (SQUAD_SHARED 讓小隊三架共用同一份),MUST NOT 逐機體各推一次 = 疊三倍。
      const team = [...this.heroes.values()].filter((a) => a.side === h.side);
      for (const a of team) {
        // 復活排在增益之前:剛站起來的那一架也要吃得到同一段窗。
        if (A.revive > 0 && once) {
          for (const b of this._bodies(a)) {
            if (b.dead && b.respawnAt > this.t) this._reviveBody(b, A.revive);
          }
        }
        if (a.dead) continue;
        for (const [k, m] of Object.entries(A.mul || {})) a.mods.push({ k, m: mf(m), until: this.t + A.dur });
        if (A.regen > 0) a.mods.push({ k: 'regen', m: mf(A.regen), until: this.t + A.dur });
        if (A.add?.fx === 'evade') a.mods.push({ k: 'evade', m: vf(A.add.evade || 0), until: this.t + A.dur });
        if (A.cleanse) {
          // 解除既有異常 + 期間免疫(`ccImm` 由 _applyCC / _applyHitEmp / emp 分支同判)。
          // 二元狀態沒有「一半」⇒ 只要還有一架輔助機在線就是整份(同 vision;見 ULT_SUPPORT)。
          if (once) { a.stunUntil = 0; a.slowUntil = 0; a.confUntil = 0; a.empUntil = 0; a.bleed = null; }
          a.mods.push({ k: 'ccImm', m: 1, until: this.t + A.dur });
        }
      }
      if (A.vision && once) this.visionUntil[h.side] = Math.max(this.visionUntil[h.side], this.t + A.vision);
    } else if (A.fx === 'intercept') {
      // 擊落半徑內所有敵方來襲飛彈(悼歌條款:擋子彈的,不是打人的)
      const ir = A.r * Math.sqrt(Math.max(0.01, frac));
      for (let i = this.missiles.length - 1; i >= 0; i--) {
        const ms = this.missiles[i];
        if (ms.side === h.side) continue;
        if (dist2d(ms.x, ms.z, h.x, h.z) > ir) continue;
        this.missiles.splice(i, 1);
        this.events.push({ e: 'boom', x: ms.x, z: ms.z, y: ms.y, r: 8, side: h.side, sam: true });
      }
      if (A.vision) this.visionUntil[h.side] = Math.max(this.visionUntil[h.side], this.t + A.vision * frac);
    }
    // dash:位移在客戶端(位置本就客戶端回報),伺服器只管 CD/MP 與廣播特效
    if (A.fx === 'buff' && A.vision && once) this.visionUntil[h.side] = Math.max(this.visionUntil[h.side], this.t + A.vision * frac);
  }

  /**
   * 大招載具遞送(2026-08-06 使用者定案;唯一發射縫):以**該機種絕招的載具形式**把大招效果
   * 送到落點 (x, z) —— 無人機 = KAMI.N 架自殺攻擊機、變形者 = 集束轟炸機逐批投遞、
   * 機甲 = 極音速飛彈拋物線。載具全是 sim 實體(可被鎖定/擊落),HP 沿用三招同一把尺
   * (kamiHp/decoyHp/hyperHp),armor/護盾恆 0;**效果取代傷害**(引爆只施放 _castEffect,
   * 不再附機種絕招爆風)。可分預算(strike/heal/summon)依 ultParts 分批 —— 擊落幾份就少幾份;
   * emp/buff 單載具,攔截 = 完全否定(同極音速飛彈語意)。
   * 最短飛行腿 ULT_CARRIER.MIN_LEG:自身/團隊型瞄在腳邊也保證有攔截窗(使用者定案「需要飛行時間」)。
   */
  _launchUltCarrier(h, A, x, z, org = null) {
    // 發射點(2026-08-07):小招 = 主機、大招 = 最近的我方砲塔/主堡(見 _launchOrigin)。
    // 最短飛行腿一律**自發射點量**:站在自家塔下對腳邊施放也要有攔截窗。
    const o = org || { x: h.x, z: h.z, y: h.y || 0 };
    const dx0 = x - o.x, dz0 = z - o.z;
    const d0 = Math.hypot(dx0, dz0);
    if (d0 < ULT_CARRIER.MIN_LEG) {
      const ry = h.ry || 0;
      const ux = d0 > 1 ? dx0 / d0 : -Math.sin(ry), uz = d0 > 1 ? dz0 / d0 : Math.cos(ry);
      x = o.x + ux * ULT_CARRIER.MIN_LEG;
      z = o.z + uz * ULT_CARRIER.MIN_LEG;
    }
    const n = ultParts(h.kind, A.fx);
    const total = A.fx === 'strike' || A.fx === 'summon' ? A.count : 0;   // 整數預算(heal 走 frac)
    const partImp = (i) => (total ? ultPartN(total, n, i) : null);
    // 發射朝向 = **發射點 → 落點**(上面的 MIN_LEG 閘保證這一段 > 0)。舊制取的是主機機首,
    // 而工事召喚的載具離主機可能有一整條兵線遠 ⇒ 用主機的朝向會讓它先朝著無關的方向衝出去。
    // 自身召喚且瞄在腳邊時,落點本來就是沿機首推出去的 ⇒ 這一支與舊制同解。
    const lry = Math.atan2(-(x - o.x), z - o.z);
    const ult = A.id === 'ult' ? 1 : 0;
    if (h.kind === 'robot') {
      // 極音速飛彈形式:單彈頭、拋物線 + 螺旋俯衝(彈道機制沿用 _tickHypers;點遞送 ⇒ 不追擊)
      const dx = x - o.x, dz = z - o.z;
      const arcD = Math.max(1, Math.hypot(dx, dz));
      const m = this._add({
        kind: 'hyper', side: h.side, pid: h.pid, hyper: true,
        uA: A, uFrac: 1, uImp: partImp(0),
        x: o.x, z: o.z, y: o.y || 0, ry: lry,
        hp: hyperHp(), armor: 0,
        tid: 0, tx: x, tz: z,
        x0: o.x, z0: o.z, y0: o.y || 0,
        ux: dx / arcD, uz: dz / arcD, arcD,
        trav: 0, phase: 'climb', spin: 0, dive: null, chase: false,
      });
      m.maxSp = 0; m.sp = 0;
      (h.hypers ||= []).push(m);
      this.events.push({ e: 'hyper', pid: h.pid, side: h.side, id: m.id, homing: 0, ult, slot: A.id });
    } else if (h.kind === 'morph') {
      // 集束轟炸機形式:飛向落點,進 BOMB_R 起每 BOMB_GAP 投遞一份(間斷型);投完飛離解體。
      // 擊落 = 剩餘份全數否定(_kill 的 decoy 分支對 uA 載具沒有 bombsLeft ⇒ 天然不補投)。
      const sq = h.sq;
      const d = this._add({
        kind: 'decoy', side: h.side, pid: h.pid, decoy: true,
        uA: A, uDrops: Array.from({ length: n }, (_, i) => ({ frac: 1 / n, n: partImp(i) })),
        pt: { x, z }, nextBomb: 0,
        x: o.x, z: o.z, y: (o.y || 0) + DECOY.ALT, ry: lry,
        hp: decoyHp(), armor: 0, tid: 0, lost: false, dieAt: this.t + DECOY.TTL_S,
      });
      d.maxSp = 0; d.sp = 0;
      if (sq) { (sq.decoys ||= []).push(d); }
      this.events.push({ e: 'decoy', pid: h.pid, side: h.side, id: d.id, homing: 0, ult, slot: A.id });
    } else {
      // 自殺攻擊機形式:n 架自發射點前方散開衝出、直飛落點近炸,各攜 1/n 份(擊落 = 該份否定)
      const K = SQUAD.KAMI;
      const sq = h.sq;
      if (sq) sq.kamis ??= [];
      const fx = -Math.sin(lry), fz = Math.cos(lry);
      const rx = Math.cos(lry), rz = Math.sin(lry);
      for (let i = 0; i < n; i++) {
        const s = kamiSide(i);
        const k = this._add({
          kind: 'kami', side: h.side, pid: h.pid, ch: h.ch, kami: true,
          uA: A, uFrac: 1 / n, uImp: partImp(i),
          pt: { x, z },
          x: o.x + fx * K.FWD + rx * K.SIDE * s,
          z: o.z + fz * K.FWD + rz * K.SIDE * s,
          y: o.y || 0, ry: lry + K.SPREAD * s,
          hp: kamiHp(), armor: 0, tid: 0, dieAt: this.t + K.TTL_S,
        });
        k.maxSp = 0; k.sp = 0;
        if (sq) sq.kamis.push(k);
      }
      this.events.push({ e: 'kami', pid: h.pid, side: h.side, n, ult, slot: A.id });
    }
  }

  /** 載具抵達的效果施放(單一縫的載具端出口):owner 缺席(離場)= 寧缺勿錯不施放。
   *  frac/nImp 預設取載具自身攜帶份(kami/hyper);轟炸機逐批投遞由呼叫端逐份傳入。 */
  _ultArrive(v, bx, bz, frac = v.uFrac ?? 1, nImp = v.uImp ?? null) {
    const owner = this.heroes.get(v.pid);
    if (!owner) return;
    this._castEffect(owner, v.uA, bx, bz, frac, nImp);
    this.events.push({
      e: 'ultfx', pid: v.pid, side: v.side, ch: owner.ch, slot: v.uA.id || 'ult',
      fx: v.uA.fx, x: bx, z: bz, r: v.uA.r, dur: v.uA.dur, lvl: owner.abil?.[v.uA.id] || 1,
      frac,
    });
  }

  /**
   * 自身強化型招式的輔助機隊(2026-08-07 使用者定案;**唯一發射縫**,見 data.js ULT_SUPPORT)。
   * 派出 `supportN(ch, slot)` 架跟隨主機的輔助機,飛完**投放腿**才開始供輸加成;
   * 加成**按在線架數疊加**(`_supSync` 撤下再放,倍率 = 1 + (m−1)×k/N);被擊落 = 那一份下線。
   * HP 走 `supportHp` 這把尺(armor / 護盾恆 0),MUST NOT 手寫。
   *
   * 2026-08-07 第二輪(兩個槽位共用這一支)——投放腿的**形狀由發射點決定**(`abilOrigin`):
   *   ・'self'(小招「從玩家身邊召喚」):生成在主機身上,沿**發射瞬間的機首**衝出 MIN_LEG 才就位
   *     (既有行為;攔截窗由這一段固定長度保證,與主機之後怎麼走位無關);
   *   ・'fort'(大招「從最近的砲塔或主堡召喚」):生成在工事上,**飛向主機**的編隊站位,到了才就位
   *     —— 腿長 = 當下那段實距(HP 校準吃的是與站位無關的代表值 `supportLegS('ult')`)。
   */
  _launchUltSupport(h, A, org = null, slot = 'ult') {
    const n = supportN(h.ch, slot);
    if (n <= 0) return;
    const o = org || { x: h.x, z: h.z, y: h.y || 0 };
    const fort = abilOrigin(slot) === 'fort';
    const sq = h.sq;
    if (sq) sq.kamis ??= [];
    const g = {
      id: (this._supSeq = (this._supSeq || 0) + 1),
      pid: h.pid, side: h.side, ch: h.ch, A, n, slot,
      tempo: abilTempo(h.ch, slot), live: 0, applied: false,
      // 效果窗**由第一架就位那一刻**起算(_supArm 寫入),施放當下是 null。
      // MUST NOT 在施放當下就把 until 定死成「施放 + 代表腿 + dur」:工事召喚的實際腿長隨
      // 站位變(代表腿 93m 只服務 HP 校準,真正可能是好幾百公尺)⇒ 定死的話瞬發型(dur = 0)
      // 的 until = 施放 + 1.5s,飛得比那久就在半路到期 = 這一招在「離自家工事遠一點」的時候
      // **永遠交付不到**,而且沒有任何錯誤訊息(2026-08-07 同一個坑的第二次:第一次是
      // 投放腿被到期判定搶先收掉,見 _tickSupport 檔頭)。
      // 飛得遠的代價因此是**曝險**(整段航程都在場上、可被鎖定擊落)而不是「窗被吃掉」。
      until: null,
    };
    if (sq) (sq.sups ||= {})[slot] = g;
    const ry = h.ry || 0;
    const fx = -Math.sin(ry), fz = Math.cos(ry);
    const hp = supportHp(h.ch, h.abil?.[slot] || 1, slot);
    for (let i = 0; i < n; i++) {
      // 環形編隊:同一個相位角同時決定「投放時的散開位置」與「就位後的站位」——
      // 兩份相位就會出現「從左邊彈出去、卻繞到右邊站位」的無意義迴轉。
      const a0 = (i / n) * Math.PI * 2;
      const k = this._add({
        kind: 'kami', side: h.side, pid: h.pid, ch: h.ch, kami: true, sup: g.id, supG: g, slotA: a0,
        uA: A, uFrac: 1 / n, uImp: null, org: fort ? 'fort' : 'self',
        x: o.x + (fort ? 0 : fx * SQUAD.KAMI.FWD) + Math.cos(ry + a0) * SQUAD.KAMI.SIDE,
        z: o.z + (fort ? 0 : fz * SQUAD.KAMI.FWD) + Math.sin(ry + a0) * SQUAD.KAMI.SIDE,
        y: (o.y || 0) + ULT_SUPPORT.SLOT_ALT, ry,
        hp, armor: 0, tid: 0, phase: 'deploy', trav: 0,
      });
      k.maxSp = 0; k.sp = 0;
      if (sq) sq.kamis.push(k);
    }
    this.events.push({ e: 'kami', pid: h.pid, side: h.side, n, ult: A.id === 'ult' ? 1 : 0, slot, sup: 1 });
  }

  /** 一架輔助機的推進(由 _tickKamis 分流):投放腿 → 就位供輸 → 跟隨編隊 */
  _tickSupport(k, dt, spd) {
    const h = this.heroes.get(k.pid);
    if (!h || h.dead) { this._supLost(k); return; }
    // 投放腿**不吃時窗到期**:它自己就是有限的(飛完 MIN_LEG 就結束),而 dieAt 恰好也是
    // 「投放腿 + dur」⇒ 瞬發型(dur = 0)的兩者同值,先驗到期就會在 tick 量化那一格把它收掉
    // = 這一招**永遠交付不到**(2026-08-07 實測:s11 補血恆為 0,而且沒有任何錯誤訊息)。
    if (k.phase === 'deploy') {
      k.trav += spd * dt;
      if (k.org === 'fort') {
        // 工事召喚(大招):飛向主機的編隊站位 —— 到得了才就位。腿長是實距,不是固定值。
        const p = this._supSlot(h, k);
        const dx = p.x - k.x, dz = p.z - k.z, dy = p.y - k.y;
        const d = Math.hypot(dx, dz, dy), step = spd * dt;
        if (d <= step) { k.x = p.x; k.z = p.z; k.y = Math.max(0, p.y); this._supArm(k); return; }
        k.x += dx / d * step; k.z += dz / d * step; k.y = Math.max(0, k.y + dy / d * step);
        k.ry = Math.atan2(-dx, dz);
        return;
      }
      k.x += -Math.sin(k.ry) * spd * dt;
      k.z += Math.cos(k.ry) * spd * dt;
      if (k.trav >= ULT_CARRIER.MIN_LEG) this._supArm(k);
      return;
    }
    if (this.t >= (k.supG?.until ?? Infinity)) { this._supLost(k); return; }
    // 編隊:朝站位點**收斂**(不硬貼)—— 硬貼在主機身上就是一群打不中的無敵護衛。
    const p = this._supSlot(h, k);
    const w = Math.min(1, ULT_SUPPORT.TURN_K * dt);
    const dx = (p.x - k.x) * w, dz = (p.z - k.z) * w, dy = (p.y - k.y) * w;
    const d = Math.hypot(dx, dz, dy), cap = spd * dt;
    const f = d > cap ? cap / d : 1;
    k.x += dx * f; k.z += dz * f; k.y = Math.max(0, k.y + dy * f);
    k.ry = h.ry || 0;
  }

  /** 這一架輔助機的編隊站位(**唯一縫**:投放腿的會合點與就位後的收斂點同一份 ——
   *  兩份站位就會出現「飛到 A 點才就位、下一格又被拉去 B 點」的無意義擺盪)。 */
  _supSlot(h, k) {
    const ang = (h.ry || 0) + k.slotA;
    return {
      x: h.x + Math.cos(ang) * ULT_SUPPORT.SLOT_R,
      z: h.z + Math.sin(ang) * ULT_SUPPORT.SLOT_R,
      y: (h.y || 0) + ULT_SUPPORT.SLOT_ALT,
    };
  }

  /** 輔助機就位:瞬發型交付自己那一份就功成身退,其餘轉入編隊並讓那一份加成上線 */
  _supArm(k) {
    const g = k.supG;
    k.phase = 'escort';
    if (!g) return;
    g.until ??= this.t + (g.A.dur || 0);   // 效果窗自第一架就位起算(見 _launchUltSupport)
    if (g.tempo === 'burst') {
      // 瞬發型(s11 大修):沒有時窗可供輸 ⇒ 抵達即交付(走 _ultArrive 這一個既有出口)
      this._ultArrive(k, k.x, k.z);
      this._removeKami(k);
      return;
    }
    g.live++;
    this._supSync(g);
  }

  /**
   * 依**目前在線架數**重算這一段加成(單一縫:撤下這一組舊 mods → 以新份額重放一次 `_castEffect`)。
   * 逐架各推一筆 mods 會被 `_buffMul` 相乘 ⇒ MUST 走「撤下再放」;
   * 新推出來的那幾筆一律改寫成群組的 `until`(不改 = 每死一架就把時窗往後展期一次)。
   */
  _supSync(g) {
    const h = this.heroes.get(g.pid);
    if (!h) return;
    const team = [...this.heroes.values()].filter((a) => a.side === g.side);
    for (const a of team) {
      if (!a.mods) continue;
      for (let i = a.mods.length - 1; i >= 0; i--) if (a.mods[i].sup === g.id) a.mods.splice(i, 1);
    }
    if (g.live <= 0) { this._supRevoke(g, h); return; }   // 一架都不剩 ⇒ 只撤不放
    const marks = team.map((a) => (a.mods ? a.mods.length : 0));
    const first = !g.applied;
    g.applied = true;
    this._castEffect(h, g.A, h.x, h.z, g.live / g.n, null, first);
    team.forEach((a, i) => {
      if (!a.mods) return;
      for (let j = marks[i]; j < a.mods.length; j++) { a.mods[j].sup = g.id; a.mods[j].until = g.until; }
    });
  }

  /** 機隊清空:撤下**不住在 mods** 的二元狀態(匿蹤 / 免裝填)——
   *  留著就是「輔助機全被打下來了,對方還是看不到我」。視野(visionUntil)是具名例外:
   *  已經給出去的情報收不回來,而且它是陣營層級的取大值。
   *  **另一個槽位還撐著同一種狀態時 MUST NOT 撤**(2026-08-07 小招也載具化之後,同一名角色的
   *  小招與大招可能都是匿蹤 —— m08:大招機隊被打光就把小招那份匿蹤一起關掉,而畫面上只是
   *  「這一招好像縮短了」)。 */
  _supRevoke(g, h) {
    const held = (pred) => {
      for (const o of Object.values(h.sq?.sups || {})) if (o !== g && o.live > 0 && pred(o.A)) return true;
      return false;
    };
    if (g.A.fx === 'stealth' && !held((A) => A.fx === 'stealth')) { h.stealthUntil = 0; h.alphaArm = 0; h.alphaX = 1; }
    if (g.A.add?.fx === 'overdrive' && !held((A) => A.add?.fx === 'overdrive')) h.noReloadUntil = 0;
  }

  /** 一架輔助機下線(被擊落 / 時窗到期 / 主機離場):扣掉那一份再重算 */
  _supLost(k) {
    const g = k.supG;
    this._removeKami(k);
    if (!g) return;
    if (k.phase === 'escort') g.live = Math.max(0, g.live - 1);
    this._supSync(g);
  }

  /** 控場類追加效果(strike 彈著區 r×1.5 內敵人;建築/中立/無敵幀免疫)。
   *  麻痺=禁移動(武器照常,與 EMP 互補)/緩速/混亂 = 時間戳欄位 → 快照帶剩餘秒 → 客戶端自鎖、
   *  NPC 在 _advance 折算;出血 = DoT(tick 結算,擊殺記給施放者);
   *  拉近:NPC/bot/僚機位置在伺服器 → 直接位移;真人主視野機位置客戶端權威 →
   *  推 cc 事件由受害客戶端自套衝量(dash 先例的反向)。 */
  _applyCC(h, ad, x, z, r) {
    const rr = r * 1.5;
    for (const t of [...this.ents.values()]) {
      if (t.side === h.side || !t.side || t.neutral || t.decoy || t.gar || t.hp <= 0) continue;
      if (t.hero && t.dead) continue;
      if (t.kind === 'tower' || t.kind === 'base' || t.kind === 'bunker') continue;   // 工事免控場
      if (t.hero && (t.invUntil || 0) > this.t) continue;
      if (t.hero && this._buffVal(t, 'ccImm') > 0) continue;   // 異常免疫(s12「滿天星座」)
      const d = dist2d(t.x, t.z, x, z);
      if (d > rr) continue;
      if (h && h.hero) (t.asst ||= {})[h.pid] = this.t;   // 施加負面狀態 = 助攻貢獻
      if (ad.fx === 'stun') {
        t.stunUntil = Math.max(t.stunUntil || 0, this.t + (ad.dur || 1));
      } else if (ad.fx === 'slow') {
        t.slowUntil = Math.max(t.slowUntil || 0, this.t + (ad.dur || 2.5));
        t.slowF = ad.f ?? 0.6;
      } else if (ad.fx === 'confuse') {
        t.confUntil = Math.max(t.confUntil || 0, this.t + (ad.dur || 2));
      } else if (ad.fx === 'bleed') {
        t.bleed = { dps: ad.dps || 15, until: this.t + (ad.dur || 4), pen: ad.pen || 10, pid: h.pid };
      } else if (ad.fx === 'pull') {
        const imp = ad.imp || 18;
        const dd = d || 1;
        // 真人玩家的主視野機:位置客戶端權威,事件指名 tpid 由客戶端自套衝量
        const act = t.hero && !isBotId(t.pid) && this.heroes.get(t.pid) === t;
        if (act) {
          this.events.push({ e: 'cc', k: 'pull', tpid: t.pid, x, z, imp });
        } else {
          const m = Math.min(imp * 0.5, dd);   // 伺服器擁有的位置(NPC/bot/僚機):直接拖向彈著中心
          t.x += (x - t.x) / dd * m;
          t.z += (z - t.z) / dd * m;
        }
      }
    }
  }

  /** 無敵幀(蓄力跳躍 / 升空變形起跳離地 / 無人機完美迴避):客戶端於起跳離地當下請求,
   *  伺服器驗 CD 後給 1s 免傷。時長/CD 皆夾在伺服器(data.js IFRAME)—— 客戶端只能決定何時用。
   *  CD 依機種:機甲/傭兵 = IFRAME.CD(15s);無人機完美迴避 = IFRAME.DRONE_CD(30s)。 */
  heroIframe(pid) {
    const h = this.heroes.get(pid);
    if (!h || h.dead || this.over) return;
    if ((h.iframeCdUntil || 0) > this.t) return;
    h.iframeCdUntil = this.t + (h.kind === 'drone' ? IFRAME.DRONE_CD : IFRAME.CD);
    h.invUntil = this.t + IFRAME.DUR;
    this.events.push({ e: 'iframe', pid, side: h.side, dur: IFRAME.DUR });
  }

  /**
   * 爆風垂直隔離(2026-07-22 隧道 → 2026-07-24 橋面天花一併封死):爆心層 lev 與目標層被結構板
   * 隔開 ⇒ 爆風不越層。A11「爆風不吃 LOS 遮蔽」是**水平**繞射近似,MUST NOT 引申成可以穿透
   * 垂直岩盤/隧道天花/橋面板。伺服器無高程,以「lev 位元 + ribbon 疊放」近似垂直層(見 _slabBlocked)。
   *  ①隧道(任一端 lev 2):岩體/天花包覆,洞內↔洞外互不波及 —— 身處洞內即隔絕。
   *    明隧道開放側例外(2026-07-30 柱列改制):洞內端所在的**每一條** ty=2 ribbon 都判
   *    「由開放側(gal)穿出」才解除隔離 —— 柱間透明可見可穿透,爆風與直擊同判(兩端同量體);
   *    沿軸出洞口維持舊隔離(A11 是水平繞射近似,不含洞口衍射),天花正上方 ↔ 洞內落在
   *    「未離框 = 0」也維持隔離(頂板規則與一般隧道相同)。
   *  ②橋面(lev 1↔0):僅「正上方↔正下方」被橋面板隔開 —— 爆心與目標同落一條 ty=1 ribbon;
   *    側向溢流照炸(與 _slabBlocked ② under-block 同判定,不誤擋橋旁地面單位)。
   * lev 為 null(導引飛彈著彈)已由鎖定時的 slab LOS 把關,回傳 false 維持舊行為。
   */
  _slabSep(lev, x, z, t) {
    if (lev == null || !this._slabGrid) return false;
    const tl = this._unitLev(t);
    const C = LOS.CELL_M;
    if (tl === lev) return false;                        // 同層 → 無板隔開
    if (tl === 2 || lev === 2) {                         // 隧道:洞內↔洞外(僅開放側柱間解除)
      const ix = lev === 2 ? x : t.x, iz = lev === 2 ? z : t.z;
      const ex = lev === 2 ? t.x : x, ez = lev === 2 ? t.z : z;
      const arrI = this._slabGrid.get((Math.floor(ix / C) + 32768) * 65536 + (Math.floor(iz / C) + 32768));
      let open = false;
      if (arrI) for (const s of arrI) {
        if (s[5] !== 2 || !ptOnRibbon(ix, iz, s)) continue;
        if (tunnelSideExit(ix, iz, ex, ez, s) !== 2) { open = false; break; }
        open = true;
      }
      if (!open) return true;
    }
    const arr = this._slabGrid.get((Math.floor(x / C) + 32768) * 65536 + (Math.floor(z / C) + 32768));
    if (arr) for (const s of arr) {                      // 橋面 1↔0:爆心與目標同落一條橋面 ribbon 才隔
      if (s[5] === 1 && ptOnRibbon(x, z, s) && ptOnRibbon(t.x, t.z, s)) return true;
    }
    return false;
  }

  /** 爆炸範圍傷害(3D 距離,量到目標命中量體的最近點 = 水平 hitR + 垂直帶;高空引爆炸不到地面;只傷敵方;AoE 不吃爆擊)。
   *  外圍傷害走 blastFalloff:核心全傷、超壓隨距離連續衰減到 1.8r 歸零(物理化舊二段式)。
   *  直升機 2026-07-17 起計入巡航高度(對空化):地面炸點打不到 26m 高的直升機,高空直擊/同高度
   *  自爆才炸得到。lev = 爆心結構層(0 地面/1 橋面/2 隧道內;null = 不查層),經 _slabSep 封住穿頂/穿板。 */
  // friendly=true(榴彈太近的無差別模式):不濾己方 ⇒ 波及友軍與射手自身(皆登記在 ents)。
  // 同陣營目標以 by=null 結算(比照地雷 _tickMines):不吸血、不記助攻/仇恨/賞金,但傷害照吃(自損)。
  //
  // npcDmg(2026-08-11):NPC 爆炸型武器(肩射火箭)的基礎傷害。NPC 傷害住 `UNITS[kind].dmg`、
  // 且**刻意不吃 vs 剋制**(見 WEAPONS.rocket 註)⇒ 不能走 `_heroDmg`。給值就改吃它,順帶在
  // 這裡套陣營小兵強化 `h.cu`(只對非英雄目標,與 tick 主迴圈那條直射路徑同一條規則)。
  _blast(h, def, x, z, y, lev = null, friendly = false, npcDmg = null) {
    for (const t of [...this.ents.values()]) {
      if (t.hero && t.dead) continue;
      const same = t.side === h.side;
      if (same && !friendly) continue;
      if (this._slabSep(lev, x, z, t)) continue;
      // 量到目標命中量體的**最近點**,水平與垂直同一把尺:垂直是 _bodyDy(垂直帶),
      // 水平就該是 hitR(t)(水平量體;_surfD3 / _lanceHits 的 R + hitR(t) 同一支)。
      // 舊制水平量到**中心**:半徑 20m 的主堡被榴彈直擊牆面時,爆心離中心就是 20m
      // ⇒ r=16 的 152mm 榴彈只結算到 52% 超壓、r≤11 的直接歸零 —— 使用者回報「打不到建築」
      // 的爆風版(與 2026-07-28 _lanceHits、2026-07-29 _surfD3 同一條病灶的最後一塊)。
      // 砲塔(hitR 7)本就多半落在核心帶內,平衡位移極小;bal 四不變式不模型化爆風幾何。
      const dh = Math.max(0, Math.hypot(x - t.x, z - t.z) - hitR(t));
      const d = Math.hypot(dh, this._bodyDy(t, y));
      const f = blastFalloff(def.r, d);
      if (f <= 0) continue;
      // 閃避:**逐目標各自擲骰**(2026-08-11 使用者定案「爆炸傷害就算沒擊中原先的目標,也會造成
      // 範圍傷害(閃避率各自計算)」)。爆風是整片鋪開的,沒有「這一發瞄的是誰」——「原先的目標」
      // 閃掉的只是**它自己那一份**,同一個爆點內的其他人照樣吃滿。這是全遊戲爆炸傷害的唯一擲骰處
      // (武器爆炸型 / 攻擊招式 / 三種載具戰鬥部 / NPC 肩射火箭全部匯流到這一支)。
      // 自損不擲(`!same`):榴彈最小安全射程的無差別模式是**代價**不是別人打過來的攻擊,
      // 讓射手有機會閃開自己的砲等於把那道懲罰做成擲骰。
      // 骰的是「打不中」(閃避 ⊕ 射手被高地壓制而失準),補償的分母只有閃避那一半 ——
      // 壓制不在 A45 ⑦「維持 DPS」的帳裡,補進去等於這條新規則對爆炸傷害完全沒有作用。
      // 兩者在 supF = 0 時逐位元相同(`highSupMissP(p, 0) === p`)⇒ 亂數流不變。
      const p = same ? 0 : this._dodgeP(t, h);
      const pm = same ? 0 : this._missP(t, h);
      if (pm > 0 && Math.random() < pm) {
        // pid = 射手(有才附):客戶端據此讓「自己的攻擊被閃」跳 Miss;NPC 爆風無 pid ⇒ 只跳「閃」
        this.events.push({ e: 'dodge', ...(h.pid != null ? { pid: h.pid } : {}),
          x: t.x, z: t.z, y: t.hero ? (t.y || 0) : 0, side: t.side });
        continue;
      }
      const base = npcDmg != null ? npcDmg * (t.hero ? 1 : (h.cu || 1)) : this._heroDmg(h, def, t.kind);
      // 閃避補償(2026-08-12 使用者定案「維持 DPS 提高傷害,閃避率不動」):被閃掉的那一份還給
      // 沒被閃掉的這一發 ⇒ 期望傷害 = base × (1−p) × 1/(1−p) ≡ base。分母 MUST 是**這個目標自己的**
      // p(逐目標,與上面那一顆骰同一個值)—— 閃不掉的小兵/建築/重甲 p = 0 ⇒ 係數恆 1 ⇒ 逐位元同舊制。
      this._damage(t, base * f * evadeCompF(p), same ? null : h, def.pen, 0, def);
    }
  }

  /** 八軌是否全滿(陣營小兵強化的解鎖門檻;唯一判定處,商店 UI 讀快照的 up 自行同判) */
  _upgAllMax(h) {
    return Object.entries(ECON.UPGRADES).every(([k, u]) => (h.upg[k] || 0) >= u.max);
  }

  // ---------- 經濟:購買(八軌;2026-07-20 全軌固定單價,4 戰鬥面向 + 4 防禦系統,無擊殺門檻)----------
  /** item: 'lw'|'hw'|'sk'|'ult'(戰鬥面向,推進 abil 階)/ 'hp'|'ar'|'sp'|'ch'(防禦系統)
   *  / 'creep'(陣營小兵強化,需帶 lane;八軌全滿才解鎖)。回傳錯誤訊息或 null */
  buy(pid, item, lane = null) {
    const h = this.heroes.get(pid);
    // 陣亡等待重生也能購買(DOTA 慣例;重生點/死亡畫面補升級)
    if (!h || this.over) return '目前無法購買';
    // NPC BOSS 不使用升級系統(使用者:「防禦面與小兵永不升級」;攻擊面改由擊破 HP 段推進,
    // 見 `_bossEnrage`)。閘門住這裡而不是 bots.js —— 那是 AI 的節流,這裡才是權威(A1)。
    if (this.isBoss(h)) return 'NPC BOSS 不使用升級系統';
    if (item === 'creep') return this._buyCreepUpg(h, lane);
    // hasOwn:item 是客戶端原字串,'toString' 等原型鏈鍵名會取到繼承函式(truthy)
    // → price NaN → 共用 ps.money 污染成 NaN = 八軌全免。
    const up = Object.hasOwn(ECON.UPGRADES, item) ? ECON.UPGRADES[item] : null;
    if (!up) return '沒有這項商品';
    const lvl = h.upg[item] || 0;
    if (lvl >= up.max) return `${up.name} 已滿級`;
    const price = upgradePrice(up, lvl), need = upgradeScore(up, lvl);
    // 兩道閘(2026-08-11):金錢 + 戰鬥分數。分數是資格不是貨幣 —— 通過不扣分。
    if ((h.kn || 0) < need) return `戰鬥分數不足(${up.name} 需 ${need} 分,現有 ${h.kn || 0} 分)`;
    if (h.money < price) return `資金不足(${up.name} 需 $${price})`;
    h.money -= price;
    h.upg[item] = lvl + 1;
    this._applyUpg(h, item, up);
    this.events.push({ e: 'buy', pid, item, lvl: h.upg[item] });
    return null;
  }

  /**
   * 把 `h.upg[item]` 的新等級套進實際數值(**唯一縫**)。呼叫端恰兩處:玩家購買(`buy`,付款
   * 之後)與 BOSS 狂暴化(`_bossEnrage`,不付款)。等級本身由呼叫端遞增 —— 這一支只負責兌現。
   */
  _applyUpg(h, item, up) {
    if (up.abil) {
      // 戰鬥面向:直接推進該武器/招式階級(開場 Lv1 → 升 3 次到 Lv4)
      h.abil[up.abil] = 1 + h.upg[item];
      if (up.abil === 'light' || up.abil === 'heavy') {   // 升階可能加大彈夾:清空該槽計數,_gateFire 視為新彈夾
        delete h.ammo[up.abil]; delete h.reloadUntil[up.abil];
      }
    } else if (item === 'hp') {
      const nm = Math.round(UNITS[h.kind].hp * (CHARACTERS[h.ch].mods?.hp ?? 1) * (1 + up.step * h.upg.hp));
      for (const b of this._bodies(h)) {       // 機殼升級套用到小隊每一架
        if (!b.dead) b.hp += nm - b.maxHp;     // 陣亡中只擴上限,重生時 hp = maxHp
        b.maxHp = nm;
      }
    } else if (item === 'sp') {
      const nm = Math.round(UNITS[h.kind].shield * (CHARACTERS[h.ch].mods?.sp ?? 1) * (1 + up.step * h.upg.sp));
      for (const b of this._bodies(h)) {
        if (!b.dead) b.sp += nm - b.maxSp;
        b.maxSp = nm;
      }
    } else if (item === 'ar') {
      // 護甲是絕對值疊加(armorMul 曲線);不影響體型(heroTargetH 只看角色 mods.armor)。
      // 基底走 heroArmor()(無人機已等比縮放)—— 與 _add 生成同一個縫,升級才不會把縮放洗掉。
      const na = heroArmor(h.ch) + up.step * h.upg.ar;
      for (const b of this._bodies(h)) b.armor = na;
    }
  }

  /**
   * 陣營小兵強化(2026-07-30 使用者定案):八軌全滿後解鎖的無限金錢去化。
   * **同陣營全玩家共用**(等級記在 this.creepUpg[side][lane],誰買都是加在陣營帳上)、
   * **不同兵線分開**(lane 指定要強化哪一條)。每階固定 CREEP_UPG.PRICE,LV 上限 CREEP_UPG.MAX。
   * 已生成的小兵不追溯(倍率於 _spawnLaneWave 生成當下寫進 e.cu),下一波起生效。
   */
  _buyCreepUpg(h, lane) {
    if (!this._upgAllMax(h)) return '八軌強化全滿後才解鎖陣營小兵強化';
    // lane 是客戶端原值:null/undefined/'0x1' 一律當非法(Number(null) === 0 會誤買第一條兵線)
    const li = typeof lane === 'number' || (typeof lane === 'string' && lane.trim() !== '') ? Number(lane) : NaN;
    const arr = this.creepUpg?.[h.side];
    if (!arr || !Number.isInteger(li) || li < 0 || li >= arr.length) return '沒有這條兵線';
    const lvl = arr[li] || 0;
    if (lvl >= CREEP_UPG.MAX) return `第 ${li + 1} 兵線小兵強化已滿級(LV${CREEP_UPG.MAX})`;
    if (h.money < CREEP_UPG.PRICE) return `資金不足(小兵強化需 $${CREEP_UPG.PRICE})`;
    h.money -= CREEP_UPG.PRICE;
    arr[li] = lvl + 1;
    // 全陣營共用 ⇒ 事件帶 side/lane(客戶端播報給同陣營全員,不是只有買的人)
    this.events.push({ e: 'creepUp', pid: h.pid, side: h.side, lane: li, lvl: arr[li] });
    return null;
  }

  // ---------- 傷害 / 擊殺(FPS × DOTA:護盾 → 裝甲,護甲值曲線減免,破甲抵銷)----------
  /** wd = 造成這次傷害的武器/招式 def(護盾分軌剋制 vsSp/vsHp/spPierce 的來源,見 data.shieldSplit)。
   *  環境傷害(沼澤/地雷/火場)與塔 SAM 一律不帶 ⇒ 中性參數 = 逐位元同舊制。 */
  _damage(t, dmg, by, pen = 0, floorHp = 0, wd = null) {
    if (this.over || t.hp <= 0 || t.inv) return;   // inv = 不可摧毀障礙(塌陷/坍方/火場/淹水)
    if (this.siegeLocked(t)) return;               // 攻堅順序未到:前一階沒清完的建築完全免傷(劇情戰役)
    // 區域 BOSS 關卡(劇情戰役):BOSS 還沒被擊敗 / 對白還沒播完 ⇒ 這座建築**打得掉血但死不了**。
    // 併進既有的 `floorHp` 通道(沼澤那條)而不是另寫一段:那條路徑的語意逐字就是「扣得動、
    // 夾在地板、不呼叫 _kill」—— 自己寫一份的話「不呼叫 _kill」很容易漏,而漏掉的症狀是塔照樣
    // 被拆掉、階段照樣推進,鎖血等於沒有發生。
    floorHp = Math.max(floorHp, this.siegeHpFloor(t));
    dmg *= this._allyBotDmgF(t, by);               // 我方電腦玩家對 BOSS ×10% / 對建築 ×25%
    if (t.sq?.boss && (t.sq.bossSeg || 0) >= 3 && (!by || !by.hero)) {
      dmg *= BOSS.ENRAGE_NPC_DMG_F;                // 狂暴模式:受到兵波NPC/砲塔/主堡的傷害減少至25%
    }
    if (t.gar) return;                             // 駐守碉堡中的第三方步槍兵:碉堡保護,免傷
    if (t.hero && (t.invUntil || 0) > this.t) return;   // 無敵幀(蓄力跳/變形中段):完全免傷
    // 攻堅需兵線配合:附近沒有己方小兵時,打主堡傷害折減
    if (t.kind === 'base' && by && by.side) {
      const near = [...this.ents.values()].some((e) =>
        e.side === by.side && !e.hero && !e.neutral
        && dist2d(e.x, e.z, t.x, t.z) < 320);
      if (!near) dmg *= GAME.BASE_ARMOR_NEED_CREEP;
    }
    // 助攻貢獻戳記(2026-07-17):英雄對敵方目標造成傷害 = 貢獻;_kill 結算時複驗時效/距離
    if (by && by.hero && by.side !== t.side) (t.asst ||= {})[by.pid] = this.t;
    // 第三方機動 NPC 被攻擊 → 記仇追擊攻擊者(脫離視野仍持續 THIRD.AGGRO_TTL 秒;追擊受 TETHER_M 繫繩上限)。
    // 駐守中(t.gar)已於開頭免傷早退 ⇒ 此處必為出堡機動單位;碉堡不動故排除。
    if (t.tp && t.kind !== 'bunker' && by && by.side && by.side !== t.side && !by.neutral) {
      t.aggro = by; t.aggroAt = this.t;
    }
    let dealt;   // 實際造成的護盾 + 裝甲損耗(吸血結算基準)
    if (t.hero) {
      const wet = t.wet || (t.pid ? this.heroes.get(t.pid)?.wet : 0) || 0;
      dmg *= this._buffMul(t, 'dmgTaken') * fluidFactor(wet);   // 複合裝甲詞綴 / 護盾招式 / 流體沉浸減傷(水域 1/2, 沼澤 1/4)
      t.lastHitAt = this.t;                  // 進入戰鬥:護盾回復重新計時
      this._stampSup(t, by);                 // 高地壓制:站得越高、挨這一發之後越打不準/閃不掉/跑不動
      this._stampUnbal(t);                   // 飛行受擊失衡:跌落到穩住期間命中/暴擊減半、飛行動力鎖定
      this._breakOnHit(t);                   // 「挨一發就結束」的招式(t02 超載)在此撤銷
      this._interruptCast(t);                // 詠唱中受擊:強制立即施展 (t/T)^2 效果(2026-08-22)
      // 雙層拆分走 shieldSplit 單一縫(反護盾 / 穿盾 / 反裝甲三型;中性參數 = 舊制的「護盾先吃、
      // 溢出進裝甲」)。護盾層恆不吃護甲減免 —— 能量護盾與裝甲板是兩套防護,這一點沒有改。
      const { toSp: toShield, toHp } = shieldSplit(wd, dmg, t.sp || 0);
      t.sp = (t.sp || 0) - toShield;
      if (toHp <= 0) {
        this._botAirSink(t, toShield); this._hurtLog(t, by, toShield);
        this._dmgOut(by, t, toShield); this._vamp(by, toShield); return;
      }
      // 第二層裝甲:護甲值減免(破甲抵銷)
      dmg = toHp * armorMul(t.armor, pen);
      dealt = toShield + Math.min(t.hp, dmg);
      this._botAirSink(t, dealt);   // 飛行機體受擊掉高(bot 專用;真人那份住客戶端物理)
      this._hurtLog(t, by, dealt);  // 受擊濺血提示(方位 + 傷害量;純表現層,客戶端畫在座艙玻璃上)
    } else {
      // NPC/建築沒有護盾層 ⇒ 同一支 shieldSplit 以 sp=0 呼叫,結果就是「整發吃 vsHp」——
      // 「主 HP 傷害較弱」對小兵/塔一樣成立(只對英雄生效的話那是隱形的第二套規則)。
      dmg = shieldSplit(wd, dmg, 0).toHp;
      const ar = UNITS[t.kind]?.armor ?? 0;
      dmg *= armorMul(ar, pen);
      // 陣營小兵強化的耐久側(2026-08-11 使用者改制):**只對非玩家攻擊者生效**。
      // hp 不再 ×cu ⇒ 整份耐久折進這個係數(creepDmgTakenF 逐 pen 還原舊制 EHP);
      // 攻擊者是玩家(含電腦玩家)機體時 ×1 = 這隻小兵在玩家眼裡與未強化逐位元相同。
      if (t.cu > 1 && !by?.hero) dmg *= creepDmgTakenF(t.cu, ar, pen);
      dealt = Math.min(t.hp, dmg);
    }
    this._dmgOut(by, t, dealt);
    this._vamp(by, dealt);
    if (floorHp) {
      // 環境傷害硬地板(沼澤:最多扣到剩 floorHp 滴,不致死)。只作下限、不回血 ——
      // 早已低於地板者(戰鬥打到瀕死)保持原血,不被沼澤拉高;亦不 _kill。
      t.hp = Math.max(t.hp - dmg, Math.min(t.hp, floorHp));
      return;
    }
    t.hp -= dmg;
    if (t.hp <= 0) {
      t.hp = 0;
      this._kill(t, by);
    }
    // NPC BOSS 的段位推進:掛在 HP 唯一的**減損點**上(治療只會被夾在天花板之下,不會退段)。
    // MUST 排在 `_kill` 之後 —— 這一發打死的那一架,它那份 HP 也算進段位(小隊總量,見 _bossSync)。
    if (t.sq?.boss) this._bossSync(t.sq);
  }

  /**
   * 飛行機體受擊掉高(2026-07-30 使用者需求)—— **bot 駕駛的那一半**。
   * 真人的位置本就客戶端權威(見 heroPos),掉高住客戶端物理(game._airSinkHit);bot 沒有客戶端,
   * 高度由 bots.js 直接寫 h.y ⇒ 同一條規則 MUST 在這裡補上,否則單人對戰只有玩家會被打掉高度。
   * 掉幅公式共用 `airSinkM`(MUST NOT 在此手寫係數);量的是**實際損耗的護盾 + 裝甲**,與客戶端
   * 以快照 vital 落差入帳同語意。NPC 直升機/餌機/自殺機刻意不套(伺服器腳本航線,掉高會陷進地形)。
   */
  _botAirSink(t, dealt) {
    if (!t.hero || !isBotId(t.pid) || !(dealt > 0)) return;
    const flying = t.kind === 'drone' || (t.kind === 'morph' && (t.y || 0) > MORPH.GROUND_Y);
    if (!flying) return;
    t.y = Math.max(0, (t.y || 0) - airSinkM(dealt));
  }

  /**
   * 累計輸出記帳(2026-08-02;電腦玩家選敵的「造成敵人最大總傷害者」**唯一真相**)。
   * 量的是**實際造成的護盾 + 裝甲損耗**(與 `_vamp`/`_botAirSink` 同一份 dealt),因此
   * **兩條結算路徑都 MUST 記** —— 只掛在一般結算那條的話,高護盾對手的輸出會被系統性低估
   * (護盾全擋的那些發全部漏帳),而那正好是最該被集火的人。
   * 英雄走 SQUAD_SHARED ⇒ 一名玩家不論幾架機體只有一份帳(見 SQUAD_SHARED 註)。
   * MUST NOT 在 bots.js 另開第二份統計(客戶端/AI 自算 = A1 家族)。
   */
  _dmgOut(by, t, dealt) {
    if (!by || !by.side || by.side === t.side || !(dealt > 0)) return;
    by.dmgOut = (by.dmgOut || 0) + dealt;
  }

  /**
   * 受擊濺血提示的**方位來源**(2026-08-02 使用者需求「濺血位置視敵人射擊方向而定、傷害越高血滴越大」)。
   * 客戶端本來只從快照的血量落差知道「被打了」,不知道被誰從哪打 ⇒ 方位只能由伺服器給(A1)。
   *
   * 同一 tick 內**同一個攻擊者併成一筆**(散彈一次多發、貫穿一次多段 = 一坨大血漬而不是一排小點),
   * 於 `_frame()` 統一 flush 成 `hurt` 事件 —— 事件在整個 tick 的傷害都結算完之後才被取走,
   * 而傷害同時發生在 tick 內與訊息處理當下(heroHit/detonate)⇒ **flush 點 MUST 是 `_frame()`**,
   * 放進 `tick()` 會漏掉 tick 之間回報進來的那些命中。
   *
   * 高程只在**攻擊者也是英雄**時附上(`ay` 絕對高程,與受擊者客戶端自己的 `pos.y + _eyeH()` 同框)——
   * NPC/塔在伺服器是離地高、地基恆 0,跨框相減等於拿場地海拔當高度差(見 `_altDh` 的同一個坑)。
   * 取不到就不給,客戶端退回「只吃水平方位、垂直畫在中線」(原則 6 寧缺勿錯)。
   */
  _hurtLog(t, by, dealt) {
    if (!t.hero || t.dead || !(dealt > 0)) return;
    if (!by || by.x == null || by.z == null) return;   // 環境傷害(沼澤/火場/地雷)無攻擊者方位 ⇒ 不濺血
    // 電腦玩家的**受擊警戒**(2026-08-02 使用者定案「其他方向敵人來襲視角要跟著轉向」):
    // bot 的視野是前方錐(bots.js `_acquire`)⇒ 背後挨打時它看不到攻擊者、也就永遠不會轉身。
    // 這裡是全伺服器唯一知道「被誰從哪裡打」的地方,順手把方位交給 AI —— MUST NOT 在 bots.js
    // 另開一份記帳(第二份必定與濺血這份分家)。掛在**主視野機**上(BotBrain 只操控它),
    // 但**僚機挨打也算**(整組小隊在同一個位置,打僚機就是打這一隊)⇒ 排在下面的主視野機閘之前。
    // 同一個地方順手記下**威脅帳**(2026-08-02 使用者需求「被打時優先打對自己傷害最高者」):
    // 「誰對我造成多少傷害」與「被誰從哪裡打」是同一件事的兩個欄位,分兩份帳必定分家。
    // 英雄以 pid 為鍵(整組小隊打我 = 同一個人打我);逾時的攻擊者就地清掉 —— 這張表只該
    // 留「還在打我的人」,而不是整場的傷害排行(那是 dmgOut 的工作)。
    if (isBotId(t.pid)) {
      const lead = this.heroes.get(t.pid);
      if (lead && !lead.dead) {
        lead._alert = { x: by.x, z: by.z, t: this.t };
        const tb = (lead._threat ||= new Map());
        for (const [k, r] of tb) if (this.t - r.t > BOT_TACTIC.THREAT_S) tb.delete(k);
        const tk = by.hero ? by.pid : by.id;
        const pv = tb.get(tk);
        // 累加前**先把舊帳淡出**(同一支 `botThreatDecay`):同一個攻擊者的紀錄只會在
        // 「連續 THREAT_S 秒沒再打我」時才整筆過期,若只是 `v += dealt` 就等於永不遺忘 ——
        // 每秒刮 2% 的持續騷擾一分鐘後會累積成「剛剛扛了半條護盾」,bot 於是無故後撤。
        // `k` = 攻擊者機種:撤退判定要分得出「被人打」與「站在塔下面被刮」(見 bots._recentDmg)
        if (pv) { pv.v = pv.v * botThreatDecay(this.t - pv.t) + dealt; pv.t = this.t; }
        else tb.set(tk, { v: dealt, t: this.t, k: by.kind });
      }
    }
    // 只記**主視野機**:玩家看到的血量落差(受傷暈影)本來就只認這一架,僚機挨打不該噴在座艙玻璃上。
    // 同時保證 `_flushHurt` 走 `heroes` 就能收乾淨(掛在僚機上的帳沒有 flush 點,會一路累積)。
    if (this.heroes.get(t.pid) !== t) return;
    const acc = (t._hurt ||= new Map());
    const key = by.id ?? by.pid ?? 'x';
    const prev = acc.get(key);
    if (prev) { prev.v += dealt; return; }
    acc.set(key, {
      x: by.x, z: by.z, v: dealt,
      ...(by.hero && by.ay != null ? { ay: by.ay } : {}),
    });
  }

  /** 把本 tick 累積的濺血方位倒進事件流(`_frame()` 取走事件之前的唯一 flush 點) */
  _flushHurt() {
    for (const h of this.heroes.values()) {
      const src = h._hurt;
      if (!src) continue;
      for (const s of src.values()) {
        this.events.push({
          e: 'hurt', tpid: h.pid,
          x: Math.round(s.x * 10) / 10, z: Math.round(s.z * 10) / 10,
          ...(s.ay != null ? { ay: Math.round(s.ay * 10) / 10 } : {}),
          v: Math.round(s.v * 10) / 10,
        });
      }
      h._hurt = null;
    }
  }

  /** 火場灼傷(feature 6 調整):同時扣護盾/HP,依「最大值比例」拆分 → 兩池同步見底;HP 份不吃裝甲。
   *  仍受減傷詞綴(dmgTaken)與無敵幀影響;可致死(走 _kill,環境傷害不記擊殺信用)。
   *  MUST NOT 改回 _damage —— 那是護盾先扣的循序結算,與本需求的並行扣血相斥。 */
  _fireBurn(h, amt) {
    if (this.over || h.hp <= 0 || h.inv || h.gar) return;
    if (h.hero && (h.invUntil || 0) > this.t) return;
    const maxSp = h.maxSp || 0, maxHp = h.maxHp || 0, denom = maxSp + maxHp;
    if (denom <= 0) return;
    amt *= this._buffMul(h, 'dmgTaken');
    h.lastHitAt = this.t;   // 灼傷 = 進入戰鬥:護盾脫戰回復重新計時
    h.sp = Math.max(0, (h.sp || 0) - amt * maxSp / denom);
    h.hp -= amt * maxHp / denom;   // 不吃裝甲:依最大值比例,與護盾同步見底
    if (h.hp <= 0) { h.hp = 0; this._kill(h, null); }
    if (h.sq?.boss) this._bossSync(h.sq);   // 火場也扣得動 HP ⇒ 段位同步同樣要掛(見 _damage)
  }

  /**
   * 裝甲(HP)恢復的**唯一結算點**。`src` = 恢復來源:'skill'(治療/吸血/汲能/rally 全場修)
   * 或其他(主堡修裝甲 'base'、醫療包 'item' …)。回傳實際補上的量(呼叫端要回報數字時用)。
   *
   * 一般單位:恆等於舊制的 `hp = min(maxHp, hp + amt)`(倍率 1、上限 maxHp)。
   * NPC BOSS(使用者定案):技能來源減半、其他來源無效,而且**補血不得越過當前這一段的天花板**
   * —— 已擊破的段是永久的。三條規則 MUST 寫在同一個點:分開寫必漏其一,而漏掉上限的症狀是
   * 「BOSS 被治療招式一路推回滿血,狂暴等級卻留在最高」—— 每一條既有斷言照樣全綠。
   */
  _healBody(b, amt, src) {
    if (!b || b.dead || !(amt > 0)) return 0;
    const boss = b.sq?.boss;
    const f = boss ? bossHealF(src) : 1;
    if (!(f > 0)) return 0;
    const cap = b.maxHp * (boss ? bossSegCapF(b.sq.bossSeg) : 1);
    const before = b.hp;
    b.hp = Math.min(cap, b.hp + amt * f);
    return Math.max(0, b.hp - before);
  }

  /** 吸血(招式追加效果 vamp):攻擊者按「實際造成傷害 × 比例」回復自身裝甲 */
  _vamp(by, dealt) {
    if (!by || !by.hero || by.dead || !(dealt > 0)) return;
    const f = this._buffVal(by, 'vamp');
    if (f > 0) this._healBody(by, dealt * f, 'skill');
  }

  /** 陣亡賞金(擊殺全額 / 助攻 ×ASSIST.F 共用的唯一縫)= 表列賞金。
   *  2026-08-11 起**不再**乘小兵強化倍率 e.cu:強化已收斂成「只對非玩家生效」,
   *  這隻兵在玩家眼裡與未強化一樣好打 —— 還加成賞金就是白送錢(見 data.CREEP_UPG)。 */
  _bounty(t) {
    return ECON.BOUNTY[t.kind] || 0;
  }

  _kill(t, by) {
    const bySide = by?.side || null;
    this.events.push({ e: 'die', id: t.id, kind: t.kind, x: t.x, z: t.z, side: t.side, ...(t.hero || t.decoy ? { pid: t.pid } : {}) });
    // 平民/間諜:誤殺平民一律負值賞金,揪出敵方間諜才 +6(以步槍兵賞金 ECON.BOUNTY.soldier 為單位)。
    // 死亡瞬間才在事件裡揭露身分(spy);快照從不帶 spy —— 生前只能靠移動速度猜。
    if (t.civ) {
      if (by && by.hero) {
        const own = by.side === t.cs;
        const f = t.spy ? (own ? CIVILIAN.KILL_F.ownSpy : CIVILIAN.KILL_F.enemySpy)
                        : (own ? CIVILIAN.KILL_F.ownCiv : CIVILIAN.KILL_F.enemyCiv);
        const v = Math.round(ECON.BOUNTY.soldier * f);
        by.money = Math.max(0, by.money + v);
        this.events.push({ e: 'civkill', pid: by.pid, side: by.side, x: t.x, z: t.z, v, spy: t.spy ? 1 : 0, cs: t.cs });
      }
      // 陣亡重生:保留陣營/間諜身分(維持 9:1 與全場數量),RESPAWN_S 後於隨機合法點補位。
      // 清營釋出的脫困平民(noRespawn)例外:陣亡即永久消失,不回補。
      if (!t.noRespawn) this.civRespawns.push({ cs: t.cs, spy: t.spy, at: this.t + CIVILIAN.RESPAWN_S });
      this.ents.delete(t.id);
      return;
    }
    // 擊殺賞金:高價值單位報酬越高(自毀/中立傷害不給錢)
    if (by && by.hero && bySide !== t.side) {
      by.money += this._bounty(t) * this._buffMul(by, 'bounty');
      // 戰鬥分數(八軌升級的第二道門檻):擊殺 +4,對玩家(含電腦玩家)與砲塔 ×5;夾 MAX、只增不減。
      if (!t.neutral) by.kn = addBattleScore(by.kn, battleScoreGain(t.kind, !!t.hero));
    }
    // 助攻(2026-07-17):曾造成傷害/負面狀態的其他英雄,賞金 × ASSIST.F。
    // 「離開可視半徑 10 秒後不算」:tick 內的在場刷新讓「仍在半徑內」的戳記恆新;
    // 戳記逾期 = 離開半徑(或陣亡)超過 TTL —— 此處只驗 TTL,不再看距離
    // (擊殺當下看距離會讓已失效的貢獻因重返半徑復活,違反規格)。
    if (t.asst) {
      const bounty = this._bounty(t);
      for (const pid in t.asst) {
        if (by && by.hero && pid === by.pid) continue;   // 擊殺者本人拿全額,不重複領助攻
        const a = this.heroes.get(pid);
        if (!a || a.side === t.side) continue;
        if (this.t - t.asst[pid] > ECON.ASSIST.TTL_S) continue;
        // 戰鬥分數:助攻 +1(硬目標 ×5)。**與賞金脫鉤** —— 賞金 0 的目標(如砲塔)一樣算戰績,
        // 舊制的 `if (!bounty) break` 只該擋錢,擋到分數就是「拆塔的助攻不計分」。
        if (!t.neutral) a.kn = addBattleScore(a.kn, battleScoreGain(t.kind, !!t.hero, true));
        if (!bounty) continue;
        const v = bounty * ECON.ASSIST.F * this._buffMul(a, 'bounty');
        a.money += v;
        if (this.stats[a.side]) this.stats[a.side].assists++;   // 計分板「助攻」欄(玩家看得到入帳)
        this.events.push({ e: 'assist', pid, v: Math.round(v) });
      }
      t.asst = null;
    }
    // 汲能核心詞綴:擊殺(非中立)回復上限血量比例
    if (by && by.hero && bySide !== t.side && !t.neutral && !by.dead) {
      for (const id in by.buffs || {}) {
        if (by.buffs[id] > this.t && AFFIXES[id]?.killHeal) {
          this._healBody(by, by.maxHp * AFFIXES[id].killHeal, 'skill');
        }
      }
    }
    if (t.decoy) {   // 餌機被擊落:誘餌任務達成,不自爆;但尚有未投完的炸彈 → 原地補投一枚(2026-07-22)
      const sq = this.squads.get(t.pid);
      const owner = sq ? sq.bodies[sq.act] : null;
      if (owner && (t.bombsLeft || 0) > 0) { t.bombsLeft--; this._decoyBomb(t, owner, this._decoyBombTarget(t)); }
      this._removeDecoy(t);
      return;
    }
    if (t.hyper) {   // 極音速飛彈被攔截:不引爆(攔截成功 = 完全否定這一招),只留碎裂演出
      this._hyperShotDown(t);
      this._removeHyper(t);
      return;
    }
    if (t.supG) {   // 輔助機被擊落(2026-08-07):沒有彈頭可爆 —— 只把它那一份加成下線
      this.events.push({ e: 'boom', x: t.x, z: t.z, y: t.y || 0, r: 5, side: t.side, sam: true });
      this._supLost(t);
      return;
    }
    if (t.kami) {   // 護衛自殺機被擊毀(2026-07-22):原地以 50% 傷害與半徑引爆(舊版只消失、不引爆)
      this._kamiDeathBoom(t);
      this._removeKami(t);
      return;
    }
    if (t.hero) {
      t.dead = true;
      t.dash = 0;
      if (this._aliveN(t) === 0) t.aiming = false;   // 小隊全滅才收瞄準(aiming 是共用狀態)
      this.stats[t.side].deaths++;
      // 第三方軍隊(GUER/MILI)沒有 stats 欄:擊殺英雄只記受害方 deaths,不記殺手 kills
      if (bySide && bySide !== t.side && this.stats[bySide]) this.stats[bySide].kills++;
      // ---- NPC BOSS:不重生(使用者定案「打掉就是打掉」)----
      // 重生倒數推到 Infinity 而不是另外加一個旗標:`_respawn` 的條件是 `t >= respawnAt`,
      // 一個永遠到不了的時刻就是「不重生」,重生罰金 / 倒數 HUD / 僚機邏輯全部照舊不用改。
      // 整隊全滅 ⇒ 它守的那一階跟著推進(BOSS 與砲塔同屬一階,見 `_siegeLeft` 的點名)。
      if (t.sq?.boss) {
        for (const b of t.sq.bodies) b.respawnAt = Infinity;
        t.deadTick = this._tickN;
        if (this._aliveN(t) === 0) {
          this._siegeFell(t);
          this._bossFell(t);   // 區域 BOSS 關卡:這一階最後一名倒下 ⇒ 起算對白窗、發 siegeTalk
          this.events.push({ e: 'bossDown', pid: t.pid, side: t.side, ch: t.ch, sg: t.sg });
        }
        if (this.heroes.get(t.pid) === t) this._promote(t.sq);
        return;
      }
      // 重生冷卻:三機小隊只有「整隊全滅」才追加重生時間(全隊統一延後),個別墜毀只吃基礎重生;
      // 機甲/變形者(單機)沿用陣營死亡數累加。
      const r = UNITS[t.kind].respawn;
      if (t.sq && t.sq.bodies.length > 1) {
        if (this._aliveN(t) === 0) {              // 這一架墜毀 = 三艘全滅 → 追加時間、三架一起延後重生
          t.sq.wipes = (t.sq.wipes || 0) + 1;
          const rs = r.base + r.perDeath * t.sq.wipes;   // 重生倒數秒數(整隊全滅)
          for (const b of t.sq.bodies) b.respawnAt = this.t + rs;
          this._deathPenalty(t, rs);              // DOTA 式陣亡罰金:整隊全滅才扣一次(不三重收費)
        } else {
          t.respawnAt = this.t + r.base;          // 尚有僚機存活 → 個別快速重生,不累加(玩家未真正陣亡,不罰金)
        }
      } else {
        const sq = t.sq;
        if (sq) sq.deaths = (sq.deaths || 0) + 1;
        t.deaths = (t.deaths || 0) + 1;
        const playerDeaths = sq?.deaths ?? t.deaths;
        const rs = r.base + r.perDeath * playerDeaths;   // 重生倒數秒數(該玩家單機獨立累計)
        t.respawnAt = this.t + rs;
        this._deathPenalty(t, rs);
      }
      // 死亡多發生在 tick() 之外的訊息處理當下(detonate/hit),respawnAt 用的是
      // 上一個 tick 結束時的 this.t;若 r.base=0(無人機),下一個 tick 就會立刻
      // 达成重生條件,導致 dead:true 從未出現在任何一份快照裡(客戶端永遠不知道自己死過,
      // 見 _applySnap 的 dead 邊緣觸發邏輯)。強制至少跨過一次完整 tick 週期才能重生,
      // 確保至少有一份快照廣播出 dead:true。
      t.deadTick = this._tickN;
      // 主視野機陣亡 → 立刻讓給存活僚機(全滅時留在原機,客戶端才會進死亡畫面)
      if (t.sq && this.heroes.get(t.pid) === t) this._promote(t.sq);
      return; // 英雄不移除,等重生
    }
    if (t.neutral) {
      this.ents.delete(t.id);
      if (this.hazBlockers && HAZARDS[t.kind]?.block) {
        this.hazBlockers = this.hazBlockers.filter(([x, z]) => x !== t.x || z !== t.z);
        // 擊毀障礙 = 打穿牆開視野:標記待重建,下一次 _losBlocked 需要時才重建一次
        // (一發爆風掃掉整道短牆 = 同 tick 多殺,不逐殺全量重建)
        this._losDirty = true;
      }
      // Diablo 式隨機掉落:擊毀障礙有機率掉戰場物資(TreasureClass:越硬掉越高階)
      const def = HAZARDS[t.kind];
      if (def?.salvage && Math.random() < def.salvage) {
        this._spawnLoot(t.x, t.z, Math.min(1, (t.maxHp || 0) / LOOT.TC.HP_REF));
      }
      if (t.kind === 'fire') this._fires = this._fires.filter((f) => f !== t);
      return;
    }
    if (bySide && by.hero && bySide !== t.side && this.stats[bySide]) {
      this.stats[bySide].creepKills += UNITS[t.kind]?.bounty || 1;
    }
    this.ents.delete(t.id);
    if (t.tp) { this._onThirdDeath(t, by); return; }   // 第三方軍隊:進重生池(碉堡沒了就暫停倒數;全清釋出平民)
    this._siegeFell(t);                                // 攻堅階段推進(整階推平時發 siege 事件)
    if (t.kind === 'base') {
      this.over = true;
      this.winner = OTHER_SIDE[t.side];
      this.events.push({ e: 'gameOver', winner: this.winner });
    }
  }

  /**
   * DOTA 式陣亡罰金:額外自玩家共用金錢扣除「重生倒數秒數 × ECON.DEATH_PENALTY_PER_S」。
   * 只在玩家真正陣亡時呼叫(機甲單機死亡 / 無人機整隊全滅)—— 個別僚機墜毀不呼叫,避免三重收費。
   * money 是 sq.ps 共用欄位(SQUAD_SHARED),扣在死亡機體上即扣整隊共用錢包;不透支(floor 0)。
   */
  _deathPenalty(t, respawnSeconds) {
    const pen = respawnSeconds * ECON.DEATH_PENALTY_PER_S;
    t.money = Math.max(0, t.money - pen);
    this.events.push({ e: 'penalty', pid: t.pid, side: t.side, v: Math.round(pen) });
  }

  // ---------- 主迴圈 ----------
  tick(dt) {
    this._tickN++;   // 快照霧戰爭:同一 tick 內多次呼叫共用同一份事件/飛彈/物資
    if (this.over) return;
    this.t += dt;

    // 波次
    if (this.t >= this.nextWaveAt) {
      this.wave++;
      this.nextWaveAt = this.t + waveInterval();
      this._spawnWave();
    }
    // 空投物資(時間驅動;每分鐘一批,批量 ∝ 玩家數)
    if (this.t >= this.nextAirdropAt) {
      this.nextAirdropAt = this.t + AIRDROP.INTERVAL_S;
      this._spawnAirdropWave();
    }
    // 波次凝聚錨點(上一 tick 的交戰狀態):每 tick 算一次,_advance 查表
    this._anchors = this._waveAnchors();

    // 小隊層級(每名玩家一次):電力回充 — mp 是三架共用的。
    // 2026-07-17:被動收入停發(金錢只來自擊殺/助攻/物資);回充速度 × 充能等級(chargeF) × 流體沉浸倍率(fluidFactor)。
    for (const h of this.heroes.values()) {
      // 流體沉浸異常狀態(2026-08-22):電力回充速度減至 1/2(水域) / 1/4(沼澤)。
      const wetMul = fluidFactor(h.wet || 0);
      if (!h.dead && this._aliveN(h) > 0 && h.mp < h.maxMp) {
        h.mp = Math.min(h.maxMp, h.mp + h.mpRegen * chargeF(h.upg?.ch) * wetMul * dt);
      }
    }
    // 機體層級:重生 / 護盾脫戰回復 / 主堡修裝甲
    for (const sq of this.squads.values()) {
      const hh = this.heroes.get(sq.pid);
      for (const b of sq.bodies) {
        if (b.dead) {
          if (this.t >= b.respawnAt && this._tickN > (b.deadTick || 0) + 1) this._respawn(b);
          continue;
        }
        const bWet = b === hh ? (hh?.wet || 0) : 0;
        const wetMul = fluidFactor(bWet);
        // 護盾:脫戰(OOC_S 秒沒受擊)自然回復;裝甲只能回主堡 / 治療招式。
        // 回復速度 × 充能等級(chargeF) × 護盾恢復倍率(rg) × 流體沉浸倍率(wetMul)
        const rg = b.hero ? this._buffMul(b, 'regen') : 1;
        if (b.sp < b.maxSp && this.t - b.lastHitAt > VITALS.OOC_S) {
          b.sp = Math.min(b.maxSp, b.sp + b.maxSp * VITALS.SP_REGEN_PS * chargeF(b.upg?.ch) * rg * wetMul * dt);
        }
        if (b.hp < b.maxHp) {
          const [bx, bz] = this.basePos[b.side];
          // 裝甲平時只有主堡修得回來;rally 生效期間**全場都修**(那正是這一招換來的東西),
          // 速率同吃 rg。MUST NOT 把「全場都修」寫成永久旗標 —— 它只活在 mods 的時窗裡。
          if (rg > 1 || dist2d(b.x, b.z, bx, bz) < GAME.HERO_HEAL_R) {
            // 來源分流:rally 生效中(rg > 1)= 招式,否則 = 主堡修裝甲。BOSS 只認前者(減半),
            // 主堡那一份對 BOSS 恆 0 —— 否則守在自家主堡旁的那名 BOSS 會一直把血補回去。
            this._healBody(b, UNITS[b.kind].regen * rg * dt, rg > 1 ? 'skill' : 'base');
          }
        }
        if (bWet === 3 && !b.dead) {
          // 凍結異常狀態(大雪時機體部分在水面下):持續扣血直到死亡
          this._fireBurn(b, TERRAIN_FX.FROZEN_DOT * dt);
          if ((b._freezeAt || 0) + 2 < this.t) {
            b._freezeAt = this.t;
            this.events.push({ e: 'freeze', pid: b.pid, x: b.x, z: b.z });
          }
        }
      }
      if (hh.dead) this._promote(sq);   // 全滅後第一架回歸 → 接管主視野
    }
    // 出血 DoT(招式追加效果):走 _damage 常規結算(護盾/護甲照規則),擊殺記給施放者;
    // 施放者查 heroes 活參照 —— 施放者陣亡仍持續失血,擊殺信用照記(狙擊手的創口不因重生消失)
    for (const e of [...this.ents.values()]) {
      if (!e.bleed) continue;
      if (e.bleed.until <= this.t || e.hp <= 0 || (e.hero && e.dead)) { e.bleed = null; continue; }
      this._damage(e, e.bleed.dps * dt, this.heroes.get(e.bleed.pid) || null, e.bleed.pen);
    }
    // 助攻貢獻「在場」刷新:貢獻者仍在自身可視半徑內 → 戳記刷新為現在
    // ⇒「離開可視半徑 10 秒後不算」語意精確(TTL 從離開那一刻起算);
    // 已失效(> TTL)不因重返半徑復活 —— 要重新造成傷害/負面狀態才算。
    for (const e of this.ents.values()) {
      if (!e.asst) continue;
      for (const pid in e.asst) {
        if (this.t - e.asst[pid] > ECON.ASSIST.TTL_S) continue;
        const a = this.heroes.get(pid);
        if (a && !a.dead && dist2d(a.x, a.z, e.x, e.z) <= (UNITS[a.kind].sight || 0)) e.asst[pid] = this.t;
      }
    }
    this._tickSquads(dt);
    this._tickCasts(dt);
    this._tickDecoys(dt);
    this._tickKamis(dt);
    this._tickHypers(dt);
    this._tickCivilians(dt);
    this._tickMines();
    this._tickAmbush(dt);
    this._tickRelays(dt);
    this._tickHazards(dt);
    this._tickAirdrops(dt);
    this._tickCamps(dt);

    // 小兵 / 塔 / 主堡行為
    this._structs = [...this.ents.values()].filter((s) => s.kind === 'tower' || s.kind === 'base');
    this._buildTickIndex();   // 索敵網格 + (side|lane) 推擠分桶:一趟建好,tick 尾清空
    for (const e of [...this.ents.values()]) {
      // 集束轟炸機/護衛機/極音速飛彈:位置由各自的 _tick* 管、自己不推線,但仍是敵方小兵/塔的合法目標
      if (e.hero || e.neutral || e.decoy || e.kami || e.hyper || e.hp <= 0) continue;
      const u = UNITS[e.kind];
      e.cd = Math.max(0, e.cd - dt);
      if (u.guns) this._tickBaseGuns(e, u.guns, dt);   // 主堡兩門大砲(獨立於本體火砲,砲塔級射程/傷害)
      if (e.tp) this._tpBehave(e, dt);   // 第三方:駐守回血/進出碉堡/繫繩旗標(開火與移動之外的狀態機)
      // 駐守碉堡:射孔限制,射程 ×GAR_RANGE_F(其餘規格照舊);主迴圈索敵走快取層(_acquireCached)
      const target = this._acquireCached(e, e.gar ? { ...u, range: u.range * THIRD.GAR_RANGE_F } : u);
      e._eng = !!target;   // 交戰中的不當凝聚錨點(否則整波卡在原地等它)
      if (target && !e.ret) {   // 第三方撤回中(ret)不停下交戰 —— 「馬上撤回碉堡周圍」
        // 電磁癱瘓(EMP 招式):單位武器離線,仍可移動;建築免疫(heroCast 不標記建築)。
        // `u.guns`(主堡)在這裡**不開火**:2026-08-13 起它的兩把武器已合併成一把,
        // 開火路徑只剩 `_tickBaseGuns` 一條(合併卻留著本體那一支 = 又變回兩把)。
        if (e.cd === 0 && !u.guns && !((e.empUntil || 0) > this.t)) {
          e.cd = 1 / u.rate;
          // 塔/主堡是制式火砲:沒有 `wid` ⇒ 舊制 wd 為 undefined = 既不可閃也不爆風。
          // 2026-08-13 使用者「**所有爆炸傷害武器都套用**」⇒ 它們也是爆炸彈頭,改吃 `STRUCT_W`
          // 這個只帶「半徑 + 破甲」的 def(傷害/射速/射程仍住 UNITS,MUST NOT 在那裡複製第二份)。
          const wd = WEAPONS[u.wid] || STRUCT_W[e.kind];
          if (wd?.r) {
            // 爆炸型小兵武器(肩射火箭 r=20 / 攻城榴彈砲 r≈18 —— 後者 2026-08-13 才補上半徑,
            // 使用者「榴彈類…無論是對地或對目標發射,都會對範圍內所有單位造成傷害」;半徑是
            // 推導值,見 data.js 那一段)。2026-08-11 使用者定案「爆炸傷害就算沒擊中原先的
            // 目標,也會造成範圍傷害(閃避率各自計算)」⇒ 它不再是「不可閃的單體直擊」,而是
            // **真的在目標身上引爆**:範圍內敵方逐個各自擲閃避(_blast 內建),閃掉的只是自己
            // 那一份。傷害基準 MUST 走 npcDmg(NPC 傷害住 UNITS[kind].dmg 且刻意不吃 vs 剋制)。
            const ty = target.hero || target.kind === 'heli' ? (target.y || 0) : 0;
            this._blast(e, wd, target.x, target.z, ty, this._unitLev(target), false, u.dmg);
            // 爆風看得見才讀得出危險區(原則 4:演出取用的尺寸 MUST 來自權威值)——
            // 舊制只有一條曳光,十幾二十公尺的超壓帶在畫面上完全沒有交代。
            this.events.push({ e: 'boom', x: target.x, z: target.z, y: ty, r: wd.r, side: e.side });
          } else if (evadable(wd) && this._dodges(target, e)) {
            // 直射槍械(重型機槍):整發被閃 ⇒ 只跳 Miss。
            // 判據走 evadable 同一個縫(走到這裡的恆是無爆風的那一類 —— 爆炸型已在上一支結束)
            this.events.push({ e: 'dodge', x: target.x, z: target.z, y: target.hero ? (target.y || 0) : 0, side: target.side });
          } else {
            // 陣營小兵強化:傷害吃 e.cu(生成時定案;塔/主堡/第三方無此欄 ⇒ ×1),但
            // **只對非玩家目標**(2026-08-11 使用者改制:打玩家機體一律原始傷害)。
            // 高度差不改基礎傷害(見 §3;閃避/射程仍吃高度差)
            this._damage(target, u.dmg * (target.hero ? 1 : (e.cu || 1)), e, wd?.pen || 0, 0, wd);
          }
          // 開火事件(2026-07-17 起全兵種發送,附射手 id/kind):客戶端解析射手機體的
          // 槍口錨畫曳光/槍口焰 + 標記後座動畫 + 面向攻擊目標(槍口一律朝攻擊方向);
          // ty = 空中目標高度(直升機/英雄),曳光才不會打在目標腳下的地面;
          // oy = 射手離地高(直升機):迷霧邊緣查無 mesh 時曳光退路不再從地面射出;
          // gi(主堡):兩門砲口輪替。2026-08-13 武器合併之後主堡在這條路徑上已經不開火
          // (見上方 `!u.guns`),這一欄留著是給其他也想輪替砲口的建築用的
          this.events.push({
            e: 'shot', id: e.id, kind: e.kind, from: [e.x, e.z], to: [target.x, target.z],
            ty: (target.hero || target.decoy || target.kind === 'heli') ? Math.round(target.y || 0) : 0,
            ...(e.kind === 'heli' ? { oy: Math.round(e.y || 0) } : {}),
            ...(e.kind === 'base' ? { gi: (e._gN = ((e._gN || 0) + 1) % 2) } : {}),
            side: e.side,
          });
        }
        continue; // 交戰中不前進
      }
      if (u.speed > 0) {
        if (e.tp) this._tpMove(e, u, dt);
        else this._advance(e, u, dt);
      }
    }

    this._tickMissiles(dt);

    // 擊發位置軌跡:**唯一取樣點**,排在最後 —— 領機(heroPos)/僚機(_tickSquads)/bot
    // (bots._move)三條位置寫入路徑到這裡全部沉澱完畢,一個取樣點才記得住同一個時間切片。
    for (const b of this._allBodies()) this._trailPush(b);

    // tick 內加速結構只活在 tick 裡(見 TG_CELL 檔頭註解):清掉之後,
    // tick 之外的直接呼叫一律走原全掃路徑 —— 過期網格 MUST NOT 留用。
    this._tgGrid = null;
    this._pushBuckets = null;
  }

  /** 單機重生:回主堡、滿血滿盾;全隊都躺著時才重置共用資源(彈藥/增益) */
  _respawn(b) {
    if (b.sq?.boss) return;   // NPC BOSS 不重生(respawnAt 已是 Infinity,這一格是保險)
    const soloWipe = this._aliveN(b) === 0;
    b.dead = false;
    b.dash = 0;
    b.hp = b.maxHp;
    b.sp = b.maxSp;
    b.lastHitAt = -99;
    b.wet = 0; b.wetT = this.t;   // 重生清環境滯留(下個 pos 回報重新判定)
    b._trail = null;              // 重生是瞬移:留著上一條命的軌跡會讓落點閘門回推到主堡外
    const [sx, sz] = this._spawnPoint(b.side, b.spawnIdx || 0, b.si || 0);
    b.x = sx; b.z = sz;
    // 無人機重生落在離地下限(FLIGHT.HOVER_M),不直接放到 SQUAD.REGROUP_ALT 那個(三機小隊時代
    // 遺留的)巡航高度 —— 重生動力補滿是為了讓玩家/bot 自己爬升,不是省了這段爬升(單一縫:
    // 與客戶端 game._spawnAt/飛行下限鉗制同吃 FLIGHT.HOVER_M)。
    b.y = b.kind === 'drone' ? FLIGHT.HOVER_M : 0;
    b.rg = b.kind === 'drone';   // 僚機:先沿標準路線歸隊
    // 每架獨立的控場狀態(非 SQUAD_SHARED):重生一律清乾淨(助攻貢獻戳記一併清)
    b.stunUntil = 0; b.slowUntil = 0; b.confUntil = 0; b.blindUntil = 0; b.bleed = null; b.invUntil = 0; b.asst = null;
    b.supUntil = 0; b.supF = 0;   // 高地壓制:重生一律清乾淨(同上列控場狀態)
    if (soloWipe) {
      b.mp = b.maxMp;
      b.empUntil = 0; b.stealthUntil = 0; b.mods = []; b.markUntil = 0; b.unbalUntil = 0; b.cast = null;
      b.ammo = {}; b.reloadUntil = {}; b.fireAt = {};   // 重生滿彈
    }
    this.events.push({ e: 'respawn', id: b.id, side: b.side, pid: b.pid });
  }

  /** 小招詠唱推進:時間到自然施展(100% 效果) */
  _tickCasts(dt) {
    for (const h of this.heroes.values()) {
      if (!h.cast) continue;
      if (h.dead) { h.cast = null; continue; }
      if (this.t >= h.cast.start + h.cast.dur) {
        const c = h.cast;
        h.cast = null;
        this._castEffect(h, c.A, c.x, c.z, 1, null, true);
        this.events.push({ e: 'cast', pid: h.pid, side: h.side, ch: h.ch, slot: 'skill', fx: c.A.fx, x: c.x, z: c.z, r: c.A.r, dur: c.A.dur, lvl: c.lvl, frac: 1 });
      }
    }
  }

  // ---------- 僚機 AI(伺服器權威;主視野那架的位置由客戶端回報)----------
  /**
   * 僚機三種行為,優先序由上而下:
   *   1. dash   — 主視野機按下自爆且有鎖定目標:直線衝向它,進入引爆距離就同歸於盡。
   *   2. regroup— 離主視野太遠(剛重生):先切回標準兵線路線,沿線飛到離主視野最近的線上點,再直接歸隊。
   *   3. follow — 保持編隊(主視野機後方左右各一),動作與目標跟著主視野走。
   */
  _tickSquads(dt) {
    for (const sq of this.squads.values()) {
      if (this.t - sq.lockAt > LOCK.TTL) sq.lock = 0;   // 鎖定過期
      if (sq.bodies.length < 2) continue;
      const lead = this.heroes.get(sq.pid);
      let slot = 0;
      for (const b of sq.bodies) {
        if (b === lead || b.dead) continue;
        const si = slot++;
        if (b.dash) { this._dash(b, dt); continue; }
        if (lead.dead) continue;   // 主視野機陣亡(= 全滅):僚機原地待命
        this._follow(b, lead, si, dt);
      }
    }
  }

  /** 自爆衝刺:目標消失就取消(不會亂撞),進入 DASH_BOOM_M 即引爆 */
  _dash(b, dt) {
    const t = this.ents.get(b.dash);
    if (!t || t.hp <= 0 || (t.hero && t.dead)) { b.dash = 0; return; }
    const ty = t.hero || t.kind === 'heli' ? (t.y || 0) : 0;
    const d = Math.hypot(t.x - b.x, t.z - b.z, ty - (b.y || 0));
    if (d <= SQUAD.DASH_BOOM_M) { this._boom(b); return; }
    this._moveTo(b, t.x, ty, t.z, UNITS.drone.speed * SQUAD.DASH_MUL, dt);
  }

  /** 僚機控場折速(位置權威第四縫,與 NPC _advance / bots._speed 同規則):
   *  麻痺 = 0(原地,_echo 火力照常)、緩速 ×slowF、混亂 ×0.5(無兵線可倒退,折半近似)。
   *  dash 自爆衝刺刻意不吃(與真人施放 dash 掙脫控場同一條規則)。 */
  _ccSpeedF(b) {
    if ((b.stunUntil || 0) > this.t) return 0;
    let f = 1;
    if ((b.slowUntil || 0) > this.t) f *= b.slowF ?? 0.6;
    if ((b.confUntil || 0) > this.t) f *= 0.5;
    return f;
  }

  /** 編隊 / 歸隊 */
  _follow(b, lead, si, dt) {
    // 模擬座標系:客戶端 yaw 對應的前方向量(見 game.js three z = -sim z)
    const fx = -Math.sin(lead.ry || 0), fz = Math.cos(lead.ry || 0);
    const lat = (si === 0 ? -1 : 1) * SQUAD.FORM_SIDE;
    let tx = lead.x - fx * SQUAD.FORM_BACK + fz * lat;
    let tz = lead.z - fz * SQUAD.FORM_BACK - fx * lat;
    let ty = lead.y || 0;
    let speed = UNITS.drone.speed;

    const gap = dist2d(b.x, b.z, lead.x, lead.z);
    if (gap > SQUAD.REGROUP_M) b.rg = true;
    else if (gap <= SQUAD.REGROUP_M * SQUAD.REJOIN_F) b.rg = false;

    if (b.rg) {
      const L = this._nearestLane(lead.x, lead.z);   // 主視野機所在兵線 + 沿線進度
      const P = this._projLane(L.li, b.x, b.z);      // 僚機在同一條線上的投影
      const pts = this.lanes[L.li], cum = this._laneCum(L.li);
      if (P.dist > GAME.LANE_SAFE_M) {
        [tx, tz] = pointAt(pts, cum, P.d);           // 先切回標準路線(走廊內 = 不吃地雷/防空伏擊)
      } else if (Math.abs(L.d - P.d) > SQUAD.LANE_SNAP_M) {
        const step = Math.max(-SQUAD.LANE_STEP_M, Math.min(SQUAD.LANE_STEP_M, L.d - P.d));
        [tx, tz] = pointAt(pts, cum, P.d + step);    // 沿線飛到離主視野最近的線上點
      } else {
        b.rg = false;                                // 已到最近線上點 → 直接飛向主視野
      }
      if (b.rg) {
        ty = Math.max(lead.y || 0, SQUAD.REGROUP_ALT);
        speed *= SQUAD.REGROUP_MUL;
      }
    }
    this._moveTo(b, tx, ty, tz, speed * this._ccSpeedF(b), dt);
  }

  _moveTo(b, tx, ty, tz, speed, dt) {
    const dx = tx - b.x, dy = ty - (b.y || 0), dz = tz - b.z;
    const d = Math.hypot(dx, dy, dz);
    if (d < 0.01) return;
    const k = Math.min(1, speed * dt / d);
    b.x += dx * k;
    b.z += dz * k;
    b.y = Math.max(0, (b.y || 0) + dy * k);
    if (Math.hypot(dx, dz) > 1) b.ry = Math.atan2(-dx, dz);   // 與 game.js 的 yaw 同慣例
  }

  /** 點在指定兵線上的投影:{ d 沿線進度, dist 垂距 } */
  _projLane(li, x, z) {
    const pts = this.lanes[li];
    const cum = this._laneCum(li);
    let best = { d: 0, dist: Infinity };
    for (let i = 1; i < pts.length; i++) {
      const [ax, az] = pts[i - 1], [bx, bz] = pts[i];
      const ddx = bx - ax, ddz = bz - az;
      const len2 = ddx * ddx + ddz * ddz || 1;
      const f = Math.max(0, Math.min(1, ((x - ax) * ddx + (z - az) * ddz) / len2));
      const dist = dist2d(x, z, ax + ddx * f, az + ddz * f);
      if (dist < best.dist) best = { d: cum[i - 1] + Math.sqrt(len2) * f, dist };
    }
    return best;
  }

  // ---------- 地雷觸發(地面機體踩到 → 爆炸,無差別範圍傷害)----------
  _tickMines() {
    const M = GAME.MINES;
    for (const h of this.heroes.values()) {
      // 機甲會踩雷,但**蓄力跳躍高過一般跳躍頂點的區間 = 空中狀態**(airUnit)不觸發
      // ——「小跳跳不過雷區、蓄力跳才過得去」是刻意的門檻,見 data.js AIR;
      // 變形者照舊只有地面型態(回報高度 y ≤ MORPH.GROUND_Y)會踩,飛行型不觸發。
      const grounded = h.kind === 'robot'
        ? !airUnit(h.kind, h.y)
        : (h.kind === 'morph' && (h.y || 0) <= MORPH.GROUND_Y);
      if (h.dead || !grounded) continue;
      if ((h.thirdCd || 0) > this.t) continue;   // 第三方打擊冷卻中(踩雷/被伏擊共用,3 分鐘)
      for (let i = this.mines.length - 1; i >= 0; i--) {
        const [mx, mz, mid] = this.mines[i];
        if (dist2d(h.x, h.z, mx, mz) > M.TRIGGER_R) continue;
        this.mines.splice(i, 1);
        h.thirdCd = this.t + GAME.THREAT_CD_S;
        this.events.push({ e: 'boom', x: mx, z: mz, r: M.R, mine: true, mid, tpid: h.pid });
        for (const t of [...this.ents.values()]) {   // 中立危害:雙方都炸
          if (t.hero && t.dead) continue;
          const d = dist2d(mx, mz, t.x, t.z);
          if (t.hero && (t.y || 0) > M.R) continue;  // 空中不受地雷波及
          if (d <= M.R) this._damage(t, M.DMG, null, M.PEN);
          else if (d <= M.R * 1.8) this._damage(t, M.DMG * 0.4, null, M.PEN);
        }
        break;
      }
    }
  }

  // ---------- 匿蹤防空伏擊(非正規路線上的無人機,命中直接擊墜)----------
  // 發射源 = 射程內最近的存活防空陣地(aasite);陣地被拔掉 = 該區安全空域。
  _tickAmbush(dt) {
    const A = GAME.AA_AMBUSH;
    const S = FIELD.AA_SITE;
    let sites = null;   // lazy:多數 tick 沒人觸發
    for (const h of this._allBodies()) {   // 每一架無人機各自可能被伏擊
      // 全場同時只准 1 發第三方伏擊飛彈在空中(THREAT_MISSILES_MAX)
      if (this.missiles.filter((m) => m.amb).length >= GAME.THREAT_MISSILES_MAX) return;
      // 無人機恆為空中目標;變形者僅飛行型態(y ≥ AA_MIN_ALT)會被伏擊鎖定
      if (h.dead) continue;
      if (h.kind !== 'drone' && !(h.kind === 'morph' && (h.y || 0) >= GAME.AA_MIN_ALT)) continue;
      if ((h.thirdCd || 0) > this.t) continue;   // 第三方打擊冷卻中(踩雷/被伏擊共用,3 分鐘)
      if ((h.stealthUntil || 0) > this.t) continue;                    // 匿蹤中不被伏擊鎖定
      if (this._distToLanes(h.x, h.z) <= GAME.AMBUSH_M) continue;   // 走廊 + 緩衝帶內安全(稍微偏離不吃伏擊)
      if (Math.random() > A.CHANCE_PER_S * dt) continue;
      sites ??= [...this.ents.values()].filter((e) => e.kind === 'aasite');
      let best = null, bestD = Infinity;
      for (const s of sites) {
        const d = dist2d(h.x, h.z, s.x, s.z);
        if (d <= S.range && d < bestD) { bestD = d; best = s; }
      }
      if (!best) continue;   // 附近陣地已被摧毀 → 這條非正規路線是打出來的安全通道
      h.thirdCd = this.t + GAME.THREAT_CD_S;
      this.missiles.push({
        id: nextEntId++, byId: best.id, side: OTHER_SIDE[h.side], tid: h.id, tpid: h.pid,
        x: best.x, z: best.z, y: 2, speed: A.SPEED, dmg: A.DMG, pen: A.PEN, r: A.R, hp: A.HP, ttl: 14,
        amb: true, ox: best.x, oy: 2, oz: best.z, range: S.range,   // 出了陣地射程就失鎖直飛
      });
      this.events.push({ e: 'sam', from: [best.x, best.z], side: OTHER_SIDE[h.side], tpid: h.pid, ambush: true });
    }
  }

  // ---------- 偵察中繼站(佔用 → 全隊限時無霧視野;先到先得,用過即毀)----------
  _tickRelays(dt) {
    const R = FIELD.RELAY;
    for (let i = (this._relays || []).length - 1; i >= 0; i--) {
      const r = this._relays[i];
      let side = null, contested = false;
      for (const h of this._allBodies()) {
        if (h.dead || dist2d(h.x, h.z, r.x, r.z) > R.R) continue;
        if (side && h.side !== side) { contested = true; break; }
        side = h.side;
      }
      if (!side || contested) {
        r.charge = Math.max(0, r.charge - dt * 2);   // 無人 / 兩軍僵持:進度倒退
        continue;
      }
      if (r.chargeSide !== side) r.charge = 0;       // 換邊搶佔:歸零重計
      r.chargeSide = side;
      r.charge += dt;
      if (r.charge < R.CHANNEL_S) continue;
      this.visionUntil[side] = this.t + R.VISION_S;
      this.events.push({ e: 'relay', side, x: r.x, z: r.z });
      this.ents.delete(r.id);
      this._relays.splice(i, 1);
    }
  }

  // ---------- 障礙物效果(火場灼傷)+ 戰場物資(過期 / 拾取)----------
  _tickHazards(dt) {
    const fireDef = HAZARDS.fire;
    for (const f of this._fires || []) {
      for (const h of this._allBodies()) {
        // 2026-07-23:地面機甲跳躍/蓄力跳躍**離地期間不吃地面火場**(offGround;水域/沼澤同理,
        // 走客戶端 wet=0 回報)。飛行機種照舊吃 maxY 以下的煙柱高度規則,平衡不動。
        if (h.dead || (h.y || 0) > fireDef.maxY || offGround(h.kind, h.y)) continue;
        if (dist2d(h.x, h.z, f.x, f.z) > fireDef.r * (f.sc || 1)) continue;
        this._fireBurn(h, fireDef.dot * dt);   // 同時扣護盾/HP(依最大值比例,不吃裝甲)
        if ((h._burnAt || 0) + 2 < this.t) {   // 事件節流:每 2 秒提示一次
          h._burnAt = this.t;
          this.events.push({ e: 'burn', pid: h.pid, x: f.x, z: f.z });
        }
      }
    }
    for (let i = this.loots.length - 1; i >= 0; i--) {
      const l = this.loots[i];
      l.ttl -= dt;
      if (l.ttl <= 0) { this.loots.splice(i, 1); continue; }
      for (const h of this._allBodies()) {   // 任一架拾取 → 記在共用的玩家狀態上
        if (h.dead || (h.y || 0) > LOOT.MAX_Y) continue;
        if (dist2d(h.x, h.z, l.x, l.z) > LOOT.PICK_R) continue;
        if (l.ammo) { h.ammo = {}; h.reloadUntil = {}; }   // 清空 = _gateFire 下次視為滿彈夾
        else if (l.af) h.buffs[l.af] = this.t + AFFIXES[l.af].dur;   // 詞綴強化(限時)
        else h.money += l.v;
        this.events.push({
          e: 'loot', pid: h.pid, x: l.x, z: l.z,
          ...(l.ammo ? { ammo: 1 } : l.af ? { af: l.af } : { v: l.v }),
        });
        this.loots.splice(i, 1);
        break;
      }
    }
  }

  /** tc 0~1:TreasureClass 稀有度偏移(越硬的障礙 → 擲骰往稀有階推) */
  _spawnLoot(x, z, tc = 0) {
    let r = Math.random() + tc * LOOT.TC.SHIFT;
    let tier = LOOT.TIERS[LOOT.TIERS.length - 1];   // 偏移溢出 = 最稀有階
    for (const t of LOOT.TIERS) { r -= t.p; if (r <= 0) { tier = t; break; } }
    const affixIds = Object.keys(AFFIXES);
    this.loots.push({
      id: nextEntId++,
      x: x + (Math.random() - 0.5) * 6, z: z + (Math.random() - 0.5) * 6,
      ttl: LOOT.TTL_S,
      ...(tier.ammo ? { ammo: true }
        : tier.affix ? { af: affixIds[Math.floor(Math.random() * affixIds.length)] }
        : { v: Math.round(tier.min + Math.random() * (tier.max - tier.min)) }),
    });
  }

  // ---------- 空投物資(時間驅動;非兵線空曠處先到先得,不分陣營)----------
  /** 每分鐘一批:批量 = ceil(玩家數 × PER_PLAYER),夾 [1, MAX_LIVE − 現存]。 */
  _spawnAirdropWave() {
    const R = AIRDROP;
    const players = this.squads.size;
    if (players <= 0) return;
    const room = R.MAX_LIVE - this.airdrops.length;
    if (room <= 0) return;
    const n = Math.min(room, Math.max(1, Math.ceil(players * R.PER_PLAYER)));
    let dropped = 0;
    for (let i = 0; i < n; i++) {
      const pt = this._airdropPoint();
      if (!pt) continue;   // 取不到合法點(地圖太擠):寧缺勿錯
      const sz = this._rollAirdropSize();
      this.airdrops.push({
        id: nextEntId++, x: pt.x, z: pt.z, s: sz.key, mul: sz.mul,
        ttl: R.TTL_S, landAt: this.t + R.LAND_S,
      });
      dropped++;
    }
    if (dropped > 0) this.events.push({ e: 'airfall', n: dropped });
  }

  /** 箱型加權抽樣(S:M:L = 15:4:1)。 */
  _rollAirdropSize() {
    const sizes = AIRDROP.SIZES;
    const total = sizes.reduce((s, z) => s + z.w, 0);
    let r = Math.random() * total;
    for (const z of sizes) { r -= z.w; if (r <= 0) return z; }
    return sizes[0];
  }

  /** 隨機取一個非兵線、離主堡與障礙夠遠的落點(~40 次嘗試,失敗回 null)。 */
  _airdropPoint() {
    const R = AIRDROP, b = this.bounds;
    for (let tries = 0; tries < 40; tries++) {
      const x = b.minX + Math.random() * (b.maxX - b.minX);
      const z = b.minZ + Math.random() * (b.maxZ - b.minZ);
      if (!this._inBounds(x, z, R.PICK_R)) continue;
      if (this._distToLanes(x, z) < R.LANE_MIN) continue;            // 非兵線位置
      if (!this._farFromStructures(x, z, R.BASE_CLEAR, 0)) continue; // 不投在主堡/重生點
      if (this.hazBlockers.some(([hx, hz, hr]) => dist2d(x, z, hx, hz) < hr + R.PICK_R)) continue;   // 不投進障礙裡
      if (this._terrainBlocked(x, z)) continue;                      // 不投在火場/水域/沼澤/淹水區(2026-07-20)
      return { x, z };
    }
    return null;
  }

  /** 過期自毀;落地後任一陣營機體靠近即開箱(先到先得)。 */
  _tickAirdrops(dt) {
    const R = AIRDROP;
    for (let i = this.airdrops.length - 1; i >= 0; i--) {
      const a = this.airdrops[i];
      a.ttl -= dt;
      if (a.ttl <= 0) { this.airdrops.splice(i, 1); continue; }
      if (this.t < a.landAt) continue;   // 降落傘飄降中,尚未落地
      for (const body of this._allBodies()) {
        if (body.dead || (body.y || 0) > R.MAX_Y) continue;
        if (dist2d(body.x, body.z, a.x, a.z) > R.PICK_R) continue;
        this._openAirdrop(body, a);
        this.airdrops.splice(i, 1);
        break;
      }
    }
  }

  /**
   * 授予一份物資報酬(空投開箱 / 平民跟隨共用):reward='medkit'|'battery'|'money'、
   * mul = 量倍率(空投 = 箱型 mul、平民跟隨 = CIVILIAN.FOLLOW_MUL)。回傳事件欄位片段(含 r 與數值)。
   * medkit 補該機體 HP/護盾;battery/money 進小隊共用池(電池電力可 overcharge 超過上限)。
   */
  _grantReward(body, reward, mul) {
    const R = AIRDROP;
    const ev = { r: reward };
    if (reward === 'medkit') {
      const hp = Math.round(body.maxHp * R.MEDKIT_HP * mul);
      const sp = Math.round(body.maxSp * R.MEDKIT_SP * mul);
      // 回報的 hp MUST 是**實際補上的量**(BOSS 的非技能恢復恆 0 ⇒ 拾取提示不能報一個沒發生的數字)
      ev.hp = Math.round(this._healBody(body, hp, 'item'));
      body.sp = Math.min(body.maxSp, body.sp + sp);
      ev.sp = sp;
    } else if (reward === 'battery') {
      const mp = Math.round(body.maxMp * R.BATTERY_MP * mul);
      body.mp += mp;                                            // 可超過 maxMp:一次性 overcharge
      const cd = R.BATTERY_CD * mul;
      body.acd.skill = Math.max(0, (body.acd.skill || 0) - cd); // acd 為絕對可用時刻:減去 = 縮短剩餘冷卻
      body.acd.ult = Math.max(0, (body.acd.ult || 0) - cd);
      ev.mp = mp; ev.cd = Math.round(cd * 10) / 10;
    } else {
      const money = Math.round(R.MONEY * mul);
      body.money += money;
      ev.v = money;
    }
    return ev;
  }

  /** 開箱:等機率抽 medkit / battery / money,量 = 基準 × 箱型 mul(見 _grantReward)。 */
  _openAirdrop(body, a) {
    const reward = AIRDROP.REWARDS[Math.floor(Math.random() * AIRDROP.REWARDS.length)];
    this.events.push({ e: 'airdrop', pid: body.pid, side: body.side, x: a.x, z: a.z, sz: a.s,
      ...this._grantReward(body, reward, a.mul) });
  }

  /**
   * `this.missiles` 通用飛彈引爆(唯一縫;2026-08-13「所有爆炸傷害武器都套用」)。三個引爆點
   * (近炸引信命中 / 追蹤中撞障礙 / 失鎖後撞障礙)MUST 全走這一支 —— 舊制只有第一個結算傷害而且
   * 是**單體直擊**,另兩個純放煙火,三處各自手寫 `boom` 的半徑,沒有一個對得上任何權威值。
   * 半徑一律讀**發射時就寫進飛彈本身的 `m.r`**(2026-08-13 主堡飛彈化後不再只有防空伏擊一個
   * 來源,MUST NOT 在這裡假設固定常數 —— 那會讓所有非防空伏擊來源的飛彈半徑跟著讀錯);
   * 演出取用的就是結算用的那一份(原則 4)。傷害基準走 npcDmg = `m.dmg`(建築/第三方陣地皆
   * 不吃 `vs` 剋制,與 NPC 分支同一條)。
   */
  _samBlast(m, x, z, y, lev = null) {
    const by = this.ents.get(m.byId) || { side: m.side };
    this._blast(by, { r: m.r, pen: m.pen || 0 }, x, z, y, lev, false, m.dmg);
    this.events.push({ e: 'boom', x, z, y, r: m.r, side: m.side, sam: true });
  }

  /**
   * 追蹤飛彈。**失鎖規則(2026-07-12,全飛彈通用)**:目標一旦離開「發射源的攻擊範圍」
   * (m.range,以發射點為圓心),飛彈立刻失鎖 → 只沿當下航向直線飛行,不再追擊
   * (still 有近炸引信,撞上算它走運),ttl 到期自毀。飛出射程 = 逃掉了。
   */
  _tickMissiles(dt) {
    // 大型障礙物攔截:本步位移線段撞上 occ 圓柱(建物/神木/巨岩/橋墩)→ 就地引爆自毀。
    // 無 world 上傳(e2e/headless)→ _losGrid 不存在 → no-op(降級縫,與其他 LOS 入口同模式);
    // A7 失鎖直線規則不變(失鎖後照樣會撞牆),slab 薄板不查(飛彈無 lev 語意,圓柱已涵蓋橋墩)。
    const hitObst = (ox, oz, oy, m) => this._losGrid
      && this._losBlocked(ox, oz, oy, m.x, m.z, m.y);
    for (let i = this.missiles.length - 1; i >= 0; i--) {
      const m = this.missiles[i];
      m.ttl -= dt;
      if (m.ttl <= 0) { this.missiles.splice(i, 1); continue; }
      const ox = m.x, oy = m.y, oz = m.z;
      const step = m.speed * dt;
      // 導引飛彈吸附(2026-07-17):目標是「有存活自殺攻擊機的無人機玩家」→ 改追最近的自殺機
      // (吸走砲火);自殺機炸掉/被擊落後其 tid 失效 → 下方目標消失分支使飛彈自毀。
      if (!m.lost) {
        const cur = this.ents.get(m.tid);
        if (cur && cur.hero && cur.kind === 'drone' && cur.sq && cur.sq.kamis && cur.sq.kamis.length) {
          let best = null, bd = Infinity;
          for (const k of cur.sq.kamis) {
            if (k.hp <= 0) continue;
            const d = Math.hypot(k.x - m.x, (k.y || 0) - m.y, k.z - m.z);
            if (d < bd) { bd = d; best = k; }
          }
          if (best) m.tid = best.id;
        }
      }
      // 追蹤特定機體(tpid 只給客戶端判斷「是不是在打我」)
      const t = m.lost ? null : this.ents.get(m.tid);
      if (t && !t.dead) {
        const dx = t.x - m.x, dy = (t.y || 0) - m.y, dz = t.z - m.z;
        const d = Math.hypot(dx, dy, dz) || 1;
        if (d <= Math.max(12, step)) {   // 命中:近炸引信
          // 飛彈 = 導彈類 ⇒ 近炸引信引爆的是**爆風**,不是單發直擊(2026-08-13 使用者「所有爆炸
          // 傷害武器都套用」)。舊制這裡 `_damage` 單體結算,而下一行的 `boom` 事件卻畫著 r = 14
          // 的超壓帶 —— 演出與結算分家(原則 4)。半徑是推導值 GAME.AA_AMBUSH.R(data.js),
          // 演出取用的就是結算用的那一份。
          this._samBlast(m, t.x, t.z, t.y || 0, this._unitLev(t));
          this.missiles.splice(i, 1);
          continue;
        }
        // 目標跑出發射源的攻擊範圍 → 失鎖(記下當下航向,之後直線飛)
        const out = m.range != null
          && Math.hypot(t.x - m.ox, (t.y || 0) - (m.oy || 0), t.z - m.oz) > m.range;
        if (out) {
          m.lost = true;
          m.vx = dx / d * m.speed; m.vy = dy / d * m.speed; m.vz = dz / d * m.speed;
        } else {
          m.x += dx / d * step; m.y += dy / d * step; m.z += dz / d * step;
          if (hitObst(ox, oz, oy, m)) {
            this._samBlast(m, m.x, m.z, m.y);   // 半路撞上障礙就地引爆:一樣是爆風(與 A7 「中途爆炸也要有傷害」同一條)
            this.missiles.splice(i, 1);
          }
          continue;
        }
      } else if (!m.lost) {
        this.missiles.splice(i, 1);   // 目標消失(陣亡/離場):飛彈自毀
        continue;
      }
      // 失鎖:等速直線
      m.x += (m.vx || 0) * dt;
      m.y += (m.vy || 0) * dt;
      m.z += (m.vz || 0) * dt;
      if (hitObst(ox, oz, oy, m)) {
        this._samBlast(m, m.x, m.z, m.y);   // 半路撞上障礙就地引爆:一樣是爆風(與 A7 「中途爆炸也要有傷害」同一條)
        this.missiles.splice(i, 1);
      }
    }
  }

  /** 陣營小兵強化倍率(唯一縫):對非玩家目標的傷害 + 對非玩家攻擊者的耐久共用同一條 log 曲線。
   *  第三方(GUER/MILI)與無兵線的單位查不到等級 ⇒ 恆 ×1。 */
  _creepMul(side, lane) {
    return creepUpgMul(this.creepUpg?.[side]?.[lane] ?? 0);
  }

  /**
   * 下一波(或開場預置波)在單一兵線單一陣營的落位。**波次編制與擺位只有這一份實作** ——
   * _spawnWave(常規出兵)與 _prefillLanes(開場預置)共用,MUST NOT 各寫一套。
   * lead = 領隊的沿線進度(公尺,從己方端起算);其餘成員往己方端列隊錯開。
   * 強化倍率在**生成當下**定案並存進 e.cu:同一波的數值不會因為中途買強化而追溯變動。
   * 賞金自 2026-08-11 起不吃 cu(強化只對非玩家生效,見 data.CREEP_UPG)。
   */
  _spawnLaneWave(li, side, wv, lead) {
    const pts = this.lanes[li];
    const cum = this._laneCum(li);
    const total = cum[cum.length - 1];
    const cu = this._creepMul(side, li);
    waveComp().forEach((kind, i) => {
      const jx = (Math.random() - 0.5) * 14, jz = (Math.random() - 0.5) * 14;
      const prog = lead - i * 6;
      const d = side === 'SWARM' ? prog : total - prog;
      const [sx, sz] = pointAt(pts, cum, Math.max(0, Math.min(total, d)));
      this._add({
        kind, side, lane: li, wv,
        x: sx + jx, z: sz + jz,
        y: kind === 'heli' ? GAME.HELI_ALT : 0,
        hp: UNITS[kind].hp,          // hp 不吃 cu(那對玩家也生效)—— 耐久側走 _damage 的 creepDmgTakenF
        ...(cu > 1 ? { cu } : {}),   // ×1 不寫欄位:未強化的對局逐位元同舊制
        prog,
      });
    });
  }

  _spawnWave() {
    for (let li = 0; li < this.lanes.length; li++) {
      // 出生點落在主路線上、主堡外(領隊在 WAVE_SPAWN_OFF_M,列隊向堡內錯開)
      for (const side of ['SWARM', 'STEEL']) this._spawnLaneWave(li, side, this.wave, GAME.WAVE_SPAWN_OFF_M);
    }
    this.events.push({ e: 'wave', n: this.wave });
  }

  /**
   * 開場預置兵線(2026-07-30 使用者定案):開局時小兵**已經**沿兵線以固定間隔排開,
   * 最遠到「第一座砲塔」(該兵線最前線塔)的沿線位置 —— 開局不再是兩邊空兵線對跑。
   * 間隔 = waveSpacingM()(= 出兵間隔 × 波次行軍速度,data.js 單一縫)⇒ 預置隊形與
   * 開打後的穩態隊形完全同density,第一波出堡時整條線的節奏就是接續的。
   * 波序 wv 用**負數**往前推(−1 = 比第一波早一個間隔出發):凝聚錨定桶是 `side|lane|wv`,
   * 用負數才不會把預置波與開局第一波併成同一波互相等待(_waveAnchors)。
   */
  _prefillLanes() {
    const gap = waveSpacingM();
    if (!(gap > 0)) return;
    for (let li = 0; li < this.lanes.length; li++) {
      const cum = this._laneCum(li);
      const total = cum[cum.length - 1];
      // 「第一座砲塔」= 該兵線最前線的塔位(solveTowerSites 回傳序末項);frac 自己方端起算 ⇒
      // 兩陣營的預置上限沿線進度相同(對稱),MUST NOT 各自換算成絕對座標再比。
      const sites = this.towerSites?.[li];
      if (!sites?.length) continue;
      const front = sites[sites.length - 1];
      // 逐側可預置的深度:有塔的那一側 = 自己那座前線塔(舊制);**沒有塔的那一側**(劇情戰役的
      // 攻方 —— 我方前線就是主堡)= 「敵方前線塔往回退一個塔距」,因為對稱戰場的己方前線塔
      // 本來就落在敵塔的一個塔距之外(invariant ②)⇒ 同語意:預置的隊伍停在敵塔火力圈外。
      const SEP = UNITS.tower.range * GAME.TOWER_SEP_F;
      const depth = (side) =>
        (front[side] ? total * front.frac : Math.max(0, total * (1 - front.frac) - SEP));
      // 上限**取兩側較小者**:預置是「開場兩軍已經走到接觸線」的替身,兩邊 MUST 等量 ——
      // 逐側各用各的深度,在非對稱地圖上會變成「守方三十幾隻兵已經上路、攻方一隻都沒有」。
      // 對稱戰場兩側同值 ⇒ min 取到同一個數 = 逐位元同舊制。
      const limit = Math.min(depth('SWARM'), depth('STEEL'));
      // 劇情戰役(2026-08-14 使用者:「開場敵方兵線 NPC 要補到前線砲塔」)—— 守方(BOSS 方)
      // 改吃**自己那一側的深度** = 它自己那座前線砲塔的沿線位置,攻方仍吃兩側較小者。這是刻意
      // 破例:那一場本來就不對稱(守方已經佈好防線、攻方剛推進到接觸線),上面那條「兩側取
      // 較小者」防的是對稱地圖上的不公平。沒有 defSide ⇒ 兩側都回 limit = 逐位元同舊制。
      const lim = {
        SWARM: this.defSide === 'SWARM' ? depth('SWARM') : limit,
        STEEL: this.defSide === 'STEEL' ? depth('STEEL') : limit,
      };
      // 迴圈仍以 k 為外圈、兩陣營為內圈:兩側同值時 `_spawnLaneWave` 的呼叫序逐位元同舊制
      // (那一支每隻兵抽兩枚 `Math.random()` 抖動 —— 換個順序整批落點就跟著換)。
      const far = Math.max(lim.SWARM, lim.STEEL);
      for (let k = 1; GAME.WAVE_SPAWN_OFF_M + k * gap <= far; k++) {
        const lead = GAME.WAVE_SPAWN_OFF_M + k * gap;
        for (const side of ['SWARM', 'STEEL']) if (lead <= lim[side]) this._spawnLaneWave(li, side, -k, lead);
      }
    }
  }

  /**
   * 主堡火砲(2026-08-13 起是**唯一**一把:本體火砲與雙聯裝砲已合併,逐項取最大值,見 data.js)。
   * 兩根砲管各自冷卻、獨立索敵 —— 砲管數也是那條「取最大值」的一部分,不是第二把武器。
   * 主迴圈那一支對 `u.guns` 的單位不開火,開火路徑只有這裡一條。
   *
   * **射後不理導彈**(2026-08-13 使用者定案「主堡改為射後不理導彈」):鎖定時**推入 `this.missiles`**
   * 交給既有的 `_tickMissiles` / `_samBlast` 通用飛彈追蹤機制結算(與第三方防空伏擊飛彈同一條
   * 唯一縫,MUST NOT 另寫第二套追蹤/命中/失鎖邏輯)——「射後不理」的字面意思就是**這裡不用再等
   * 飛彈飛到**,砲管冷卻與命中結算從此解耦(舊制的即時 `_blast` 反而是兩者綁死在同一個 tick)。
   * 傷害/半徑/破甲仍住 `UNITS.base`/`STRUCT_W.base`(MUST NOT 複製第二份),飛行參數住
   * `BASE_MISSILE`。飛彈途中可被玩家擊落(`hitMissile` 通用,擊落 = 完全否定不引爆)。
   */
  _tickBaseGuns(e, g, dt) {
    e.gunCd ??= new Array(g.n).fill(0);
    const gu = { range: g.range };   // _acquireTarget 只讀 range / wid
    for (let i = 0; i < g.n; i++) {
      e.gunCd[i] = Math.max(0, e.gunCd[i] - dt);
      if (e.gunCd[i] > 0) continue;
      const target = this._acquireTarget(e, gu);
      if (!target) continue;
      e.gunCd[i] = 1 / g.rate;
      const off = i === 0 ? 10 : -10;   // 左右兩門砲口錯開射源(客戶端曳光管)
      const mx = e.x + off, mz = e.z, my = BASE_MISSILE.LAUNCH_Y;
      this.missiles.push({
        id: nextEntId++, byId: e.id, side: e.side, tid: target.id, tpid: target.pid,
        x: mx, y: my, z: mz, speed: BASE_MISSILE.SPEED, dmg: g.dmg, pen: STRUCT_W.base.pen || 0,
        r: STRUCT_W.base.r, hp: BASE_MISSILE.HP, ttl: g.range / BASE_MISSILE.SPEED + BASE_MISSILE.TTL_PAD,
        ox: mx, oy: my, oz: mz, range: g.range,   // 出了主堡射程就失鎖直飛(與其他飛彈同一條規則)
      });
      // gi = 第幾門砲:客戶端把該門砲管轉向目標、播放槍口焰(飛彈本身由 sm 快照另行渲染飛行路徑)
      this.events.push({
        e: 'shot', id: e.id, kind: 'base', gi: i, from: [mx, mz], to: [target.x, target.z],
        ty: (target.hero || target.decoy || target.kind === 'heli') ? Math.round(target.y || 0) : 0,
        side: e.side,
      });
    }
  }

  /** 索敵網格 + (side|lane) 推擠分桶:主迴圈前一趟建好(2026-08-05 手機單機效能)。
   *  兩者都只是「候選集縮小」,判定本身一個都沒動:
   *  ・索敵格只收「恆非目標」以外的實體(同 _tgBlockedD 首行早退),合法性仍逐候選驗;
   *  ・推擠桶依 ents.values() 順序收集 ⇒ 掃描順序 = 原全掃的同序子集(浮點累加順序不變),
   *    主迴圈中途的死亡移除由消費端以 ents.has 鏡射 live 迭代語意 ⇒ 推擠行為逐位元不變。 */
  _buildTickIndex() {
    const grid = new Map(), buckets = new Map();
    for (const t of this.ents.values()) {
      if (t.lane != null && !t.hero && !t.neutral) {
        const k = `${t.side}|${t.lane}`;
        let arr = buckets.get(k);
        if (!arr) buckets.set(k, arr = []);
        arr.push(t);
      }
      if (t.neutral || t.hp <= 0) continue;   // 恆非索敵目標:中立障礙是 ents 的大宗,先剪掉
      const ck = (Math.floor(t.x / TG_CELL) + TG_OFF) * TG_SPAN + (Math.floor(t.z / TG_CELL) + TG_OFF);
      let cell = grid.get(ck);
      if (!cell) grid.set(ck, cell = []);
      cell.push(t);
    }
    this._tgGrid = grid;
    this._pushBuckets = buckets;
  }

  /** 索敵候選集:tick 內走網格(只掃射程圈涵蓋的格),tick 外退回全掃。
   *  只縮小候選、不做任何判定 —— 合法性只有 _tgBlockedD 一份。
   *  查詢圈上界取 range × altRangeMax():高度制空至多把射程放大到這裡 ⇒ 圈外恆出局;
   *  掃描順序改變只影響「折算距離恰好同分」的極端同分裁決,合法候選集與全掃相同。 */
  _tgCandidates(e, u) {
    if (!this._tgGrid) return this.ents.values();
    const out = this._tgScratch ??= [];   // 重用暫存(同步消費完才會再進來,不跨 tick 持有)
    out.length = 0;
    const r = u.range * altRangeMax();
    const cx0 = Math.floor((e.x - r) / TG_CELL), cx1 = Math.floor((e.x + r) / TG_CELL);
    const cz0 = Math.floor((e.z - r) / TG_CELL), cz1 = Math.floor((e.z + r) / TG_CELL);
    for (let cx = cx0; cx <= cx1; cx++) for (let cz = cz0; cz <= cz1; cz++) {
      const cell = this._tgGrid.get((cx + TG_OFF) * TG_SPAN + (cz + TG_OFF));
      if (cell) for (const t of cell) out.push(t);
    }
    return out;
  }

  /** 索敵合法性(單一縫:全掃 / 網格 / _acquireCached 快取沿用三路同吃;d = 已算好的 2D 距離)。
   *  回 true = 不可鎖定;條款自舊制 _acquireTarget 逐字搬入,語意一字未動。 */
  _tgBlockedD(e, u, wd, t, d) {
    if (this._blinded(e)) return true;   // bot/NPC 被閃到時不能索敵
    if (t.side === e.side || t.neutral || t.hp <= 0) return true;   // 中立障礙不當目標
    if (this.siegeLocked(t)) return true;   // 鎖血建築不列入索敵(只擋傷害會把兵線卡死,見 siegeLocked)
    if (e.tp && t.tp) return true;   // 第三方不打第三方(游擊隊/民兵互不為敵,只防衛正規軍)
    if (t.gar) return true;   // 駐守碉堡中的第三方步槍兵:躲在工事裡,不可鎖定
    if (t.hero && (t.dead || (t.stealthUntil || 0) > this.t)) return true;   // 匿蹤英雄不被鎖定
    // 高空飛行單位難以直射鎖定:天花板 = min(射程×0.9, GUN_CEIL_M) —— 與射程脫鉤,
    // 塔射程拉到 310 也不會把高空無人機從 SAM 手上搶走(#INC-104 的 y=250 仍在天花板之上)
    if ((t.kind === 'drone' || t.kind === 'heli' || t.kind === 'morph')
      && (t.y || 0) > Math.min(u.range * 0.9, GAME.GUN_CEIL_M)) return true;
    if (d > u.range * this._altRange(e, t, wd)) return true;   // 高度制空:地面槍械對高空無人機縮短射程
    return false;
  }

  _acquireTarget(e, u) {
    let best = null, bestD = Infinity;
    const wd = u.wid ? WEAPONS[u.wid] : null;
    for (const t of this._tgCandidates(e, u)) {
      let d = dist2d(e.x, e.z, t.x, t.z);
      if (this._tgBlockedD(e, u, wd, t, d)) continue;
      if (t.hero) d /= GAME.CREEP_AGGRO_HERO_BIAS; // 小兵偏好打兵線目標
      if (wd) d /= vsMult(wd, t.kind);             // 優先打武器克制的目標類型
      if (d >= bestD) continue;
      // 塔/NPC 不能透視:實體障礙(建物/神木/巨岩)後的目標不列入鎖定(看不到就不能射擊)。
      // LOS trace 只付給「會成為新 best」的候選(running-minimum 惰性驗證;被擋者不更新
      // bestD ⇒ 結果 = 未被擋候選中折算距離最小者,與逐一檢查完全相同,trace 數期望 ~O(ln n))
      if (this._losGrid && this._losBlocked(e.x, e.z, this._eyeY(e), t.x, t.z, this._tgtY(t), e, t)) continue;
      bestD = d; best = t;
    }
    return best;
  }

  /** 主迴圈索敵的快取層(恰主迴圈一個呼叫端;主堡砲/第三方各帶自己的 u,不吃這份快取):
   *  上個 tick 的目標仍合法(活著/射程內/LOS 通)就沿用 —— 免掃描,每 tick 只付 1 次距離
   *  + 至多 1 次 LOS;沒有目標的單位仍逐 tick 全新索敵(交戰觸發延遲不變)。
   *  每 TG_RESCAN tick 強制重掃一次(相位逐實體錯開,攤平尖峰),保住「優先打克制目標 /
   *  偏好英雄」的逐 tick 重排語意 —— 黏著窗 ≤ TG_RESCAN × TICK_MS = 0.25s。 */
  _acquireCached(e, u) {
    e._tgPh ??= (this._tgSeq = ((this._tgSeq || 0) + 1) % TG_RESCAN);
    if ((this._tickN + e._tgPh) % TG_RESCAN !== 0 && e._tgId != null) {
      const t = this.ents.get(e._tgId);
      if (t) {
        const wd = u.wid ? WEAPONS[u.wid] : null;
        const d = dist2d(e.x, e.z, t.x, t.z);
        if (!this._tgBlockedD(e, u, wd, t, d)
          && !(this._losGrid && this._losBlocked(e.x, e.z, this._eyeY(e), t.x, t.z, this._tgtY(t), e, t))) return t;
      }
    }
    const t = this._acquireTarget(e, u);
    e._tgId = t ? t.id : null;
    return t;
  }

  /** 同波、同線、同陣營的「最慢進度」;交戰中的成員不列入(否則整波停下來等它打完) */
  _waveAnchors() {
    const m = new Map();
    for (const e of this.ents.values()) {
      if (e.hero || e.neutral || e.hp <= 0 || e.lane == null || e.wv == null || e._eng) continue;
      const k = `${e.side}|${e.lane}|${e.wv}`;
      const p = e.prog ?? 0;
      if (!(m.get(k) <= p)) m.set(k, p);
    }
    return m;
  }

  _advance(e, u, dt) {
    const pts = this.lanes[e.lane];
    const cum = this._laneCum(e.lane);
    const total = cum[cum.length - 1];
    // 隊形凝聚:領先最慢僚兵超過 WAVE_COHESION_M 就原地待命(仍會靠攏兵線/繞障礙)
    const anchor = e.wv != null ? this._anchors?.get(`${e.side}|${e.lane}|${e.wv}`) : null;
    const hold = anchor != null && (e.prog ?? 0) > anchor + GAME.WAVE_COHESION_M;
    // 控場效果(招式追加):麻痺原地(武器照常)、緩速折速、混亂沿線倒退亂走
    let sf = 1;
    if ((e.stunUntil || 0) > this.t) sf = 0;
    else {
      if ((e.slowUntil || 0) > this.t) sf *= e.slowF ?? 0.6;
      if ((e.confUntil || 0) > this.t) sf *= -0.5;
    }
    if (!hold && sf !== 0) e.prog = Math.max(0, (e.prog ?? 0) + u.speed * sf * dt);
    const d = e.side === 'SWARM' ? e.prog : total - e.prog;
    const [x, z] = pointAt(pts, cum, Math.max(0, Math.min(total, d)));
    // 平滑靠攏路徑(保留生成時的隊形抖動,不瞬移)
    e.x = x + (e.x - x) * 0.6;
    e.z = z + (e.z - z) * 0.6;
    // 地面單位不穿越建築:圓形推擠(塔在兵線上,小兵繞塔而行)
    const STRUCT_R = { tower: 9, base: 22 };
    for (const s of this._structs || []) {
      const r = STRUCT_R[s.kind];
      const dd = dist2d(e.x, e.z, s.x, s.z);
      if (dd >= r || dd === 0) continue;
      e.x = s.x + (e.x - s.x) / dd * r;
      e.z = s.z + (e.z - s.z) / dd * r;
    }
    // 阻擋型障礙物:比照建築繞開,不卡在牆前
    for (const [hx, hz, hr] of this.hazBlockers || []) {
      const dd = dist2d(e.x, e.z, hx, hz);
      if (dd >= hr || dd === 0) continue;
      e.x = hx + (e.x - hx) / dd * hr;
      e.z = hz + (e.z - hz) / dd * hr;
    }
    // 前方卡住的同陣營單位(如被障礙擋住減速者):側移繞過,不疊在一起。
    // 候選走 (side|lane) 分桶(_buildTickIndex,tick 內才有):同序子集 + ents.has 鏡射
    // live 迭代的中途刪除語意 ⇒ 逐位元同全掃;tick 外(直測)退回全掃。
    const UNIT_PUSH_R = 4.5;
    const near = this._pushBuckets ? this._pushBuckets.get(`${e.side}|${e.lane}`) || [] : this.ents.values();
    for (const o of near) {
      if (o === e || o.side !== e.side || o.lane !== e.lane || o.hero || o.neutral) continue;
      if (!this.ents.has(o.id)) continue;   // 分桶是主迴圈前的快照:已死移除者不推
      const dd = dist2d(e.x, e.z, o.x, o.z);
      if (dd >= UNIT_PUSH_R || dd === 0) continue;
      const push = (UNIT_PUSH_R - dd) / 2;
      e.x += (e.x - o.x) / dd * push;
      e.z += (e.z - o.z) / dd * push;
    }
  }

  _laneCum(li) {
    this._cumCache ??= [];
    return (this._cumCache[li] ??= cumLen(this.lanes[li]));
  }

  // ---------- 快照(霧戰爭:單位類實體限視野範圍,建築/中立物永遠可見)----------
  _serializeEnt(e) {
    const o = { id: e.id, k: e.kind, s: e.side, x: Math.round(e.x * 10) / 10, z: Math.round(e.z * 10) / 10, hp: Math.round(e.hp), m: e.maxHp };
    if (e.sc) o.sc = e.sc;   // 障礙物實例尺寸(客戶端外觀 / 碰撞半徑)
    // 攻堅鎖血:客戶端血條變灰 + 掛鎖,並把它排除在射程光暈之外(打不掉的東西不該亮燈)
    if (this.siegeLocked(e)) o.lk = 1;
    if (e.kind === 'heli') o.y = Math.round((e.y || 0) * 10) / 10;   // 攻擊直升機巡航高度(純渲染用)
    if (e.gar) o.gar = 1;    // 第三方步槍兵駐守碉堡中(客戶端隱藏機體)
    if (e.civ) {             // 平民/間諜:客戶端只知陣營(cs)與職業(pf)——MUST NOT 送 spy(生前只能靠移速猜)
      o.cs = e.cs; o.pf = e.prof;
      if (e.follow != null) o.fo = 1;   // 跟隨中
      if (e.flee) o.fl = 1;             // 逃離中
    }
    if (e.kind === 'relay' && e.charge > 0) {   // 佔用進度(客戶端進度環 / 警示)
      o.cp = Math.min(100, Math.round(e.charge / FIELD.RELAY.CHANNEL_S * 100));
      o.cps = e.chargeSide;
    }
    if (e.decoy) {   // 餌機:客戶端要姿態(PiP 攝影機)+ 失聯旗標(斷訊雜訊)
      o.pid = e.pid; o.y = Math.round(e.y * 10) / 10; o.ry = Math.round(e.ry * 100) / 100;
      if (e.lost) o.lost = 1;
    }
    if (e.kami) {   // 護衛自殺機衝出:客戶端要姿態 + 角色(縮小 SIZE_F 渲染成該角色的無人機)
      o.pid = e.pid; o.ch = e.ch; o.y = Math.round((e.y || 0) * 10) / 10; o.ry = Math.round((e.ry || 0) * 100) / 100;
    }
    if (e.hyper) {   // 極音速飛彈:客戶端要姿態 + 相位(爬升 = 尾焰柱,俯衝 = 音爆錐)
      o.pid = e.pid; o.y = Math.round((e.y || 0) * 10) / 10; o.ry = Math.round((e.ry || 0) * 100) / 100;
      o.ph = e.phase === 'dive' ? 1 : 0;
    }
    if (e.hero) {
      o.pid = e.pid; o.y = Math.round((e.y || 0) * 10) / 10; o.ry = Math.round((e.ry || 0) * 100) / 100;
      o.dead = e.dead; if (e.dead) o.rs = Math.max(0, Math.round(e.respawnAt - this.t));
      o.ch = e.ch;                                               // 角色(客戶端渲染專屬機體)
      o.sp = Math.round(e.sp); o.msp = e.maxSp;                  // 護盾(雙層 HP 第一層)
      o.si = e.si || 0;                                          // 小隊機位(HUD 三機狀態列)
      // NPC BOSS:目前段位(0 起算)。**存在這一格 = 這是 BOSS** —— 客戶端據此把血條外圍
      // 光暈換成該段的顏色(黑>青>銀>金)。段位是小隊層級的,同隊每架都帶同一個值。
      if (e.sq?.boss) o.bs = e.sq.bossSeg | 0;
      // 主視野機(小隊只有一架):共用的玩家狀態只跟著它發一份
      o.act = !e.sq || e.sq.bodies[e.sq.act] === e ? 1 : 0;
      if (o.act) {
        // 升級/招式階級 MUST 傳「值快照」不可傳權威物件本身:單機模式(LocalNet)不經 JSON
        // 序列化 —— 快照直接以參考傳到客戶端。客戶端 `this.upg = e.up` 後樂觀購買會 mutate
        // 這個物件,若是同一份就地污染伺服器的 h.upg ⇒ 每買一次雙重遞增,三階軌兩次就滿(單機
        // 才會、連線因 JSON 複製而正常 = 使用者回報的「有時候升級只有 2 階」)。展開成新物件斷開參考;
        // WS 路徑 JSON.stringify 後位元級不變。abil 同理(客戶端雖已 spread,seam 一併收口不留地雷)。
        o.$ = Math.floor(e.money); o.up = { ...e.upg };           // 經濟(客戶端 HUD / 商店)
        o.mp = Math.floor(e.mp); o.mm = e.maxMp;                 // 電力(招式資源)
        o.ab = { ...e.abil }; o.kn = e.kn;                        // 招式階級 / 戰鬥分數
        o.cds = [Math.max(0, Math.round((e.acd.skill - this.t) * 10) / 10),
                 Math.max(0, Math.round((e.acd.ult - this.t) * 10) / 10)];   // 招式冷卻倒數
      }
      // 變形者餌機:掛點狀態(0 = 已分離/重組中,1 = 已組合就緒)+ 冷卻倒數(HUD / 組合動畫)
      if (e.sq && e.kind === 'morph') {
        o.dcd = Math.max(0, Math.round((e.sq.decoyCd - this.t) * 10) / 10);
        o.dc = !e.sq.decoys?.length && o.dcd === 0 ? 1 : 0;
      }
      // 機甲:重砲模式冷卻倒數(HUD)—— 只跟主視野機發一份
      // 機甲:極音速飛彈冷卻倒數(HUD)+ 空中是否已有一枚(有 → 鈕面顯示「飛行中」)
      if (o.act && e.kind === 'robot') {
        o.hcd = Math.max(0, Math.round(((e.hyperCd || 0) - this.t) * 10) / 10);
        o.hfly = e.hypers?.length ? 1 : 0;
      }
      // 無人機護衛自殺機:CD 倒數(HUD;歸零 = 兩架護衛機重現)—— 只跟主視野機發一份
      if (o.act && e.sq && e.kind === 'drone') o.kcd = Math.max(0, Math.round((e.sq.kamiCd - this.t) * 10) / 10);
      if ((e.empUntil || 0) > this.t) o.emp = Math.round((e.empUntil - this.t) * 10) / 10;
      if ((e.blindUntil || 0) > this.t) o.vb = Math.round((e.blindUntil - this.t) * 10) / 10;
      if ((e.stealthUntil || 0) > this.t) o.st = Math.round((e.stealthUntil - this.t) * 10) / 10;
      // 控場/追加效果剩餘秒(客戶端自鎖移動 / HUD;條件欄位,讀取端一律 || 0)
      if ((e.stunUntil || 0) > this.t) o.pz = Math.round((e.stunUntil - this.t) * 10) / 10;
      if ((e.slowUntil || 0) > this.t) { o.sl = Math.round((e.slowUntil - this.t) * 10) / 10; o.slf = e.slowF ?? 0.6; }
      if ((e.confUntil || 0) > this.t) o.cf = Math.round((e.confUntil - this.t) * 10) / 10;
      // 高地壓制:客戶端要這兩欄才折得出移速(位置本就客戶端權威 ⇒ 伺服器 MUST NOT 再折一次)
      if (this._supF(e) > 0) { o.hs = Math.round((e.supUntil - this.t) * 100) / 100; o.hsf = Math.round(e.supF * 100) / 100; }
      if ((e.markUntil || 0) > this.t) o.mk = Math.round((e.markUntil - this.t) * 10) / 10;
      if ((e.unbalUntil || 0) > this.t) o.ub = Math.round((e.unbalUntil - this.t) * 10) / 10;
      if (e.bleed && e.bleed.until > this.t) o.bl = Math.round((e.bleed.until - this.t) * 10) / 10;
      if ((e.invUntil || 0) > this.t) o.iv = Math.round((e.invUntil - this.t) * 10) / 10;   // 無敵幀
      const bf = [];
      for (const id in e.buffs || {}) if (e.buffs[id] > this.t) bf.push([id, Math.round(e.buffs[id] - this.t)]);
      if (bf.length) o.bf = bf;   // 詞綴強化(HUD 倒數)
      const md = (e.mods || []).filter((m) => m.until > this.t).map((m) => [m.k, m.m, Math.round(m.until - this.t)]);
      if (md.length) o.md = md;   // 招式增益(HUD 倒數)
    }
    return o;
  }

  /** 同 tick 視野快取(2026-07-16 效能修):snapshotFor ×2 + 每次 heroHit/heroLock/bot _acquire
   *  都要視野來源與可見性;LOS 遮蔽上線後 trace 不便宜,而位置只在 tick 間有意義地變動
   *  —— 比照 _frame() 以 _tickN 換代。位置以外的離散視野狀態(瞄準加成/死亡/單位增減)
   *  可能在 tick 之間的訊息處理中變動 → 換代鍵再疊一個便宜指紋(≤10 名英雄 + ents 數),
   *  同 tick 內狀態一變快取即失效(e2e 的「瞄準後立刻看得到」正是這個路徑)。 */
  _visMemoFor() {
    let fp = this.ents.size | 0;
    for (const h of this.heroes.values()) fp = (fp * 31 + (h.aiming ? 2 : 0) + (h.dead ? 1 : 0)
      + (this._blinded(h) ? 4 : 0)) | 0;
    if (!this._visMemo || this._visMemo.tickN !== this._tickN || this._visMemo.fp !== fp) {
      this._visMemo = { tickN: this._tickN, fp, src: {}, vis: { SWARM: new Map(), STEEL: new Map() } };
    }
    return this._visMemo;
  }

  /** 一方目前的視野來源(英雄 + 小兵 + 塔 + 主堡,各自 sight 半徑;瞄準模式加成視野) */
  _visionSources(side) {
    const m = this._visMemoFor();
    if (m.src[side]) return m.src[side];
    const sources = [];
    for (const e of this.ents.values()) {
      if (e.side !== side || e.hp <= 0) continue;
      if (e.decoy && e.lost) continue;   // 失聯的餌機不再回傳遙測 → 不提供視野
      if (this._blinded(e)) continue;    // 閃光彈:受害單位不再提供視野
      const sight = UNITS[e.kind]?.sight;
      if (sight == null) continue;
      const r = e.hero && e.aiming ? sight * GAME.AIM_SIGHT_MULT : sight;
      sources.push([e.x, e.z, r, this._eyeY(e)]);   // 眼高:LOS 遮蔽用(高飛的無人機看得過建物)
    }
    m.src[side] = sources;
    return sources;
  }

  /** 建築/中立物永遠可見(非「單位」);敵方英雄/小兵要在己方視野內才可見。
   *  2026-07-15 起視野吃實體障礙遮蔽(_losBlocked):躲在建物/神木/巨岩後 = 看不到
   *  (快照過濾 → 敵標消失;heroHit/heroLock 同一條規則 → 看不到就打不到)。
   *  只在 sources 是本 tick 的正典視野來源(_visionSources 回傳的那份)時走 (side, ent) 快取
   *  —— 呼叫端自組 sources(測試/特例)不吃快取,語意不變。 */
  _visibleTo(e, side, sources) {
    if (e.side === side || e.neutral || e.kind === 'tower' || e.kind === 'base') return true;
    if (e.hero && (e.stealthUntil || 0) > this.t) return false;   // 匿蹤:連視野內也看不到
    const m = this._visMemoFor();
    const memo = sources === m.src[side] ? m.vis[side] : null;
    if (memo) {
      const c = memo.get(e.id);
      if (c !== undefined) return c;
    }
    const ty = this._tgtY(e);
    let vis = false;
    for (const [sx, sz, r, sy] of sources) {
      if (dist2d(e.x, e.z, sx, sz) > r) continue;
      if (this._losGrid && this._losBlocked(sx, sz, sy ?? LOS.EYE_M, e.x, e.z, ty)) continue;
      vis = true;
      break;
    }
    if (memo) memo.set(e.id, vis);
    return vis;
  }

  /** 同一 tick 內共用的事件/飛彈/物資(events 只能清一次,多個收件者快照要共用同一份) */
  _frame() {
    if (this._frameTickN === this._tickN) return this._frameCache;
    this._frameTickN = this._tickN;
    this._flushHurt();   // 濺血方位:MUST 排在取走 events 之前(見 _hurtLog)
    const ev = this.events;
    this.events = [];
    const sm = this.missiles.map((m) => ({
      id: m.id, x: Math.round(m.x * 10) / 10, y: Math.round(m.y * 10) / 10, z: Math.round(m.z * 10) / 10,
    }));
    const lt = this.loots.map((l) => ({
      id: l.id, x: Math.round(l.x * 10) / 10, z: Math.round(l.z * 10) / 10, a: l.ammo ? 1 : 0,
      ...(l.af ? { f: 1 } : {}),   // 詞綴物資(客戶端紫色補給箱)
    }));
    // 空投物資:恆可見(不吃迷霧,雙陣營競搶);s = 箱型、d = 尚未落地(客戶端演出飄降 + 禁互動)
    const ad = this.airdrops.map((a) => ({
      id: a.id, x: Math.round(a.x * 10) / 10, z: Math.round(a.z * 10) / 10, s: a.s,
      ...(this.t < a.landAt ? { d: 1 } : {}),
    }));
    this._frameCache = { ev, sm, lt, ad };
    return this._frameCache;
  }

  /** side=null → 無霧(觀戰者);'SWARM'/'STEEL' → 依該陣營視野過濾單位類實體。
   *  偵察中繼站的視野脈衝生效中 → 該陣營暫時走無霧路徑。 */
  snapshotFor(side) {
    const pulse = side && this.visionUntil?.[side] > this.t;
    const sources = side && !pulse ? this._visionSources(side) : null;
    const ents = [];
    for (const e of this.ents.values()) {
      if (sources && !this._visibleTo(e, side, sources)) continue;
      ents.push(this._serializeEnt(e));
    }
    const { ev, sm, lt, ad } = this._frame();
    return {
      t: 'snap', time: Math.round(this.t),
      nextWave: Math.max(0, Math.round(this.nextWaveAt - this.t)), wave: this.wave,
      // 陣營小兵強化等級(唯讀顯示;每側每兵線一個整數)—— 商店與 HUD 讀這份權威值,MUST NOT 客戶端自算
      cu: { SWARM: [...this.creepUpg.SWARM], STEEL: [...this.creepUpg.STEEL] },
      // 攻堅開放階段(只在劇情戰役發;一般對戰整個欄位不存在 ⇒ 快照逐位元同舊制)。
      // HUD 的「目前該打哪一階」MUST 讀這一份權威值,MUST NOT 客戶端自己數塔(A1 家族)。
      ...(this.siege ? { sg: { SWARM: this._siegeOpen.SWARM, STEEL: this._siegeOpen.STEEL } } : {}),
      ents, ev, sm, lt, ad, stats: this.stats, over: this.over, winner: this.winner,
    };
  }

  /** 無霧完整快照(觀戰者 / 內部工具用) */
  snapshot() {
    return this.snapshotFor(null);
  }

  /** 靜態危險區資料(開戰 / 重連時發一次;地雷不進快照,雙方都要「用眼睛掃雷」) */
  fieldPayload() {
    return {
      t: 'field',
      mines: this.mines.map(([x, z, id]) => [Math.round(x * 10) / 10, Math.round(z * 10) / 10, id]),
    };
  }
}

// ---------- 折線工具(bots.js 也用)----------
export function cumLen(pts) {
  const cum = [0];
  for (let i = 1; i < pts.length; i++) {
    cum.push(cum[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]));
  }
  return cum;
}
/** 出兵間隔(2026-07-30 使用者定案:**固定**,不再逐波加速)。
 *  數值住 data.js GAME.WAVE_S(單一縫);sim / balance.mjs / 開場預置間距共用這一支。 */
export function waveInterval() {
  return GAME.WAVE_S;
}

export function pointAt(pts, cum, d) {
  if (d <= 0) return [...pts[0]];
  const total = cum[cum.length - 1];
  if (d >= total) return [...pts[pts.length - 1]];
  let i = 1;
  while (cum[i] < d) i++;
  const f = (d - cum[i - 1]) / (cum[i] - cum[i - 1] || 1);
  return [
    pts[i - 1][0] + (pts[i][0] - pts[i - 1][0]) * f,
    pts[i - 1][1] + (pts[i][1] - pts[i - 1][1]) * f,
  ];
}
