// ============ 戰場模擬(伺服器權威)============
// DOTA 式三路兵線:小兵(步兵/裝甲車/坦克)沿真實道路路徑推進,
// 防禦塔與主堡自動迎擊;英雄(無人機/機甲)位置由客戶端回報、
// 血量與傷害由伺服器結算。座標系:以戰場中心為原點的公尺平面
// (x 東、z 北;y 高度只在客戶端管,模擬是 2D 平面 + 兵線路徑)。
import {
  SIDES, OTHER_SIDE, UNITS, GAME, WEAPONS, ECON, HAZARDS, FIELD, LOOT, AIRDROP, AFFIXES, MAPGEO,
  CHARACTERS, charsOf, heroKindOf, heroWeapon, heroAbility, VITALS, armorMul, killScore, tierVal,
  vsMult, upgradePrice, chargeF, heavyMpCost, laneTacticsXZ, SQUAD, MORPH, LOCK, DECOY, DECOY_BOMB, MORPH_BOMB, BARRAGE, heroArmor, BOT_KILL_SCORE, isBotId,
  kamiBlast, selfBoomBlast, decoyBlast, decoyBombBlast, barrageDmgF,
  dmgFalloff, blastFalloff, battleBBox, solveTowerSites, grenadeBuildingMul,
  aoeClass, lanceR, LANCE, lobMinRange,
  EVASION, heroMobility, LOS, IFRAME, THIRD, CIVILIAN, CIVILIANS, civSpeed, hitH,
  ALTITUDE, altScale, WATER, TERRAIN_FX, offGround, airUnit,
} from '../public/js/data.js';

let nextEntId = 1;

// 小隊共用的「玩家狀態」:一名玩家不論操控幾架機體,經濟/電力/彈藥/招式只有一份。
// 三架機體各自是獨立 ent(有自己的 hp/護盾/座標/死亡狀態),但這些欄位透過
// getter/setter 指回同一個 sq.ps —— 讓既有的 h.money / h.abil / h.ammo 全部原樣可用。
const SQUAD_SHARED = [
  'money', 'upg', 'ammo', 'reloadUntil', 'fireAt', 'buffs', 'mp', 'maxMp', 'mpRegen',
  'abil', 'acd', 'kn', 'mods', 'empUntil', 'stealthUntil', 'aiming', 'lastBurst', 'markUntil',
];

/** 經緯度 → 以 center 為原點的「遊戲世界」公尺平面(等距圓柱,5km 內誤差可忽略)。
 *  ×(1/REAL_SCALE):真實範圍縮小,但遊戲世界公尺不變 — 與 terrain.js/llToWorld 必須同倍率。 */
export function llToMeters(lat, lng, center) {
  const R = 6371000;
  const s = 1 / MAPGEO.REAL_SCALE;
  const x = (lng - center.lng) * Math.PI / 180 * R * Math.cos(center.lat * Math.PI / 180) * s;
  const z = (lat - center.lat) * Math.PI / 180 * R * s;
  return [x, z];
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
 * (s=0 / s=L)離開」。側牆先離開 = 穿山體岩盤 → 擋;洞口先離開 = 沿軸出洞口 → 放行
 * (隧道兵線正常對射)。Liang–Barsky:洞內端在框內,比較沿軸 / 垂距兩維各自離框的 τ,
 * 較小者即實際離開的那條邊。伺服器無地形高程,以此 2D 幾何近似「山體擋線」。
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
  return tD < tS;                                    // 側牆先離開 → 穿岩體 → 擋
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
    this.stats = { SWARM: { kills: 0, deaths: 0, creepKills: 0 }, STEEL: { kills: 0, deaths: 0, creepKills: 0 } };
    this._tickN = 0;                   // 快照霧戰爭:同一 tick 內多次呼叫共用同一份事件/飛彈/物資
    this._frameTickN = -1;

    // 兵線折線轉公尺;lane[laneIdx] 方向:SWARM 主堡 → STEEL 主堡
    this.lanes = config.lanes.map((line) =>
      line.map(([lat, lng]) => llToMeters(lat, lng, this.center)));
    this.basePos = {
      SWARM: llToMeters(config.bases.SWARM[0], config.bases.SWARM[1], this.center),
      STEEL: llToMeters(config.bases.STEEL[0], config.bases.STEEL[1], this.center),
    };
    // 地形涵蓋範圍(與 terrain.js buildTerrain 同一份 battleBBox 幾何)內縮空氣牆 40m:
    // 中立物(地雷/障礙/防空/中繼站)散布的越界防線 —— 兵線蜿蜒出對稱方框的路段,
    // 地形邊緣離兵線只有 ROUTE_EDGE_MARGIN_M(160),HAZ_LANE_MAX(300)側偏會落到地形外懸空。
    {
      const bb = battleBBox(config);
      const [x1, z1] = llToMeters(bb.minLat, bb.minLng, this.center);
      const [x2, z2] = llToMeters(bb.maxLat, bb.maxLng, this.center);
      this.bounds = {
        minX: Math.min(x1, x2) + 40, maxX: Math.max(x1, x2) - 40,
        minZ: Math.min(z1, z2) + 40, maxZ: Math.max(z1, z2) - 40,
      };
    }

    // 水沼粗網格(2026-07-19):主機載圖時烘烤上傳 → 中立單位(平民/第三方)佈點與行動迴避。
    // MUST 在 _seedField/_seedCamps/_seedCivilians 之前吃進(初次佈點就避開水沼);
    // 未提供(e2e/headless 或房主尚未上傳)→ _wetGrid 為空,_wetAt 恆 0,佈點行為與舊版一致。
    if (world) this._ingestWorldWet(world);
    this._spawnStructures();
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
      const [x, z, r, h] = o.map(Number);
      if (![x, z, r, h].every(Number.isFinite)) continue;
      occ.push([x, z, Math.min(60, Math.max(0.5, r)), Math.min(300, Math.max(1, h))]);
    }
    // 碉堡淨空:清掉與野營重疊(BLD_CLEAR_R 內)的遮蔽柱 —— 客戶端已移除這些重疊建物,
    // 伺服器 LOS 同步不再當它們擋線(setWorld 契約:上傳資料只能「減少」遮蔽,合規)。
    this.worldOcc = this.camps?.length
      ? occ.filter((o) => !this.camps.some((c) => dist2d(o[0], o[1], c.x, c.z) < THIRD.BLD_CLEAR_R))
      : occ;
    const cor = [];
    for (const c of Array.isArray(w.cor) ? w.cor.slice(0, 2400) : []) {
      if (!Array.isArray(c) || c.length < 5) continue;
      const [x1, z1, x2, z2, hw, tun] = c.map(Number);
      if (![x1, z1, x2, z2, hw].every(Number.isFinite)) continue;
      cor.push([x1, z1, x2, z2, Math.min(20, Math.max(2, hw)), tun ? 1 : 0]);
    }
    if (cor.length) this._pruneCorridors(cor);
    this._ingestSlabs(w);
    this._rebuildLosGrid();
  }

  /**
   * 橋面/隧道天花水平薄板(#1):main.js 房主上傳的 ribbon 平面段 [x1,z1,x2,z2,hw,ty](sim 座標,
   * ty=1 橋面 / 2 隧道天花)。柵格化進 _slabGrid(LOS.CELL_M 格),供 _slabBlocked / _slabLevAt 查。
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
      const seg = [x1, z1, x2, z2, hw, ty];
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
    const fly = !!(UNITS[e.kind]?.fly || e.kind === 'heli' || e.kami || e.decoy);
    if (fly && (e.y || 0) >= LOS.TUN_CLEAR_M) return 0;
    if (!fly && !e.hero && e.lane == null) return 0;
    return this._slabLevAt(e.x, e.z);
  }

  /**
   * 橋面/隧道天花薄板遮蔽:
   *  ①隧道(ty=2)側牆/山體:一端在洞內(lev 2)、一端在洞外,且射線由「側牆」而非「洞口」穿出
   *    → 岩盤擋(tunnelSideExit)。以洞內端所在 cell 取其 ribbon(洞內端必落在自身 cell),
   *    沿軸經洞口穿出不擋(隧道兵線正常對射),側/上方一律擋 —— 砲塔/小兵/英雄穿牆一併封死。
   *  ②橋面/隧道天花薄板(under-block):兩端同 ribbon 且層不符(僅「橋上 ↔ 正下方」一組)→ 擋;
   *    側向射擊不誤擋(橋 ty=1 只走這條,行為與舊版一致)。
   * 用「同 ribbon + 層不符」而非絕對 y(伺服器無地形高程、回報 y 為離站立表面高,橋上/橋下皆 ≈0)。
   */
  _slabBlocked(ax, az, bx, bz, ea, eb) {
    const g = this._slabGrid;
    const C = LOS.CELL_M;
    const levA = this._unitLev(ea), levB = this._unitLev(eb);
    // ① 隧道側牆:恰一端在洞內 → 以洞內端 ribbon 判「側牆穿出」
    if ((levA === 2) !== (levB === 2)) {
      const ix = levA === 2 ? ax : bx, iz = levA === 2 ? az : bz;
      const ox = levA === 2 ? bx : ax, oz = levA === 2 ? bz : az;
      const arrI = g.get((Math.floor(ix / C) + 32768) * 65536 + (Math.floor(iz / C) + 32768));
      if (arrI) for (const s of arrI) {
        if (s[5] === 2 && ptOnRibbon(ix, iz, s) && tunnelSideExit(ix, iz, ox, oz, s)) return true;
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

  /** 射手眼高(離地):塔的砲位過半塔身,能越過矮牆射擊 */
  _eyeY(e) { return (e.y || 0) + (e.kind === 'tower' ? LOS.TOWER_EYE_M : LOS.EYE_M); }

  /** 目標取樣高(離地):塔/主堡是高聳工事,露頭就打得到 */
  _tgtY(e) {
    if (e.kind === 'tower' || e.kind === 'base') return LOS.TOWER_EYE_M;
    return (e.hero || e.kind === 'heli' || e.decoy || e.kami ? (e.y || 0) : 0) + LOS.TGT_M;
  }

  /** 機體垂直帶(離地):[腳底, 腳底 + 實體高度]。飛行體的腳底 = 回報高度,地面單位 = 0。 */
  _bodySpan(e) {
    const y0 = (e.hero || e.kind === 'heli' || e.decoy || e.kami ? (e.y || 0) : 0);
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

  // ---------- 建置:主堡 + 每線每方 2 個塔位 ×(左右各 1 座)----------
  _spawnStructures() {
    for (const side of ['SWARM', 'STEEL']) {
      const [x, z] = this.basePos[side];
      this._add({ kind: 'base', side, x, z, hp: UNITS.base.hp });
    }
    // 塔位一律走 data.js 的 solveTowerSites()(與 biomes 淨空同一個縫):
    // 最前線敵我塔的直線距離 = tower.range × TOWER_SEP_F(射程重疊 TOWER_OVERLAP、且不對射)。
    const sites = solveTowerSites(this.lanes);
    for (let li = 0; li < sites.length; li++) {
      for (const st of sites[li]) {
        for (const side of ['SWARM', 'STEEL']) {
          const p = st[side];
          for (const s of [-1, 1]) {
            this._add({
              kind: 'tower', side, lane: li, hp: UNITS.tower.hp,
              x: p.x + p.nx * GAME.TOWER_SIDE_OFF * s, z: p.z + p.nz * GAME.TOWER_SIDE_OFF * s,
            });
          }
        }
      }
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
      decoy: null, decoyCd: 0,       // 機甲餌機:目前在空中的那架 / 掛點重新組合完成的時刻
      kamis: [], kamiCd: 0,          // 無人機自殺攻擊機:目前在空中的那些 / F 鍵冷卻到期時刻
      ps: {                          // 共用玩家狀態(見 SQUAD_SHARED)
        // 八軌升級(2026-07-20 面向改制):4 戰鬥面向(lw/hw/sk/ult,推進 abil 階)+ 4 防禦系統(見 ECON.UPGRADES)
        money: ECON.START, upg: { lw: 0, hw: 0, sk: 0, ult: 0, hp: 0, ar: 0, sp: 0, ch: 0 },
        ammo: {}, reloadUntil: {}, fireAt: {}, buffs: {},
        mp, maxMp: mp, mpRegen: u.mpRegen,
        // 招式開場即 Lv1 可用(2026-07-20;不再需擊殺數解鎖)
        abil: { light: 1, heavy: 1, skill: 1, ult: 1 },
        acd: { skill: 0, ult: 0 }, kn: 0,
        mods: [],                    // 招式增益 [{k, m, until}]
        empUntil: 0, stealthUntil: 0, aiming: false, lastBurst: 0,
        markUntil: 0,                // 定位標記(下一擊必中必爆;小隊共用 —— 任一架出手都算)
      },
    };
    const n = kind === 'drone' ? SQUAD.N : 1;
    for (let i = 0; i < n; i++) {
      const [ox, oz] = this._spawnPoint(side, idx, i);
      const b = this._add({
        kind, side, pid, ch, si: i, spawnIdx: idx,
        x: ox, z: oz, y: 0, ry: 0,
        hp: Math.round(u.hp * (m.hp ?? 1)), hero: true,
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
    const t = this.ents.get(targetId);
    if (!t || t.neutral || t.gar || t.side === sq.side || t.hp <= 0 || (t.hero && t.dead)) return;
    // 射程閘門:用玩家當下手上那把武器(瞄準中 = 重武器),留與 heroHit 同一份彈道寬容
    const wp = this._heroWeapon(h, h.aiming ? 'heavy' : 'light');
    if (!wp) return;
    const ty = t.hero || t.kind === 'heli' || t.decoy ? (t.y || 0) : 0;
    if (Math.hypot(t.x - h.x, t.z - h.z, ty - (h.y || 0)) > wp.def.range * 1.25) return;
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
    return def.reload * this._buffMul(h, 'reload');
  }

  /**
   * 開火判定:射速上限、填彈中禁射、彈夾耗盡自動填彈。
   * 重武器擊發需電力(heavyMpCost,隨重武器階級)—— 電力不足視同禁射。
   * lenient=true 給網路延遲寬容(真人客戶端);bot 用嚴格射速。
   */
  _gateFire(h, id, def, lenient) {
    const now = this.t;
    // 重砲傾洩窗(非變形機甲重砲模式):此窗內重武器解除射速閘與電力門檻,傾洩剩餘彈夾。
    // 用加成窗(DUR + GRACE)而非 DUR:拋射彈落點才回報 _gateFire,DUR 早過會讓同輪第 2 發起被射速閘擋掉。
    const barrage = id === 'heavy' && this._barragingDmg(h);
    // 填彈完成 → 補滿
    if ((h.reloadUntil[id] || 0) > 0 && now >= h.reloadUntil[id]) {
      h.ammo[id] = def.mag;
      h.reloadUntil[id] = 0;
    }
    if ((h.reloadUntil[id] || 0) > now) return false;              // 填彈中
    if (!barrage && now - (h.fireAt[id] || 0) < 1 / (def.rate * (lenient ? 1.5 : 1))) return false;
    if (h.ammo[id] == null) h.ammo[id] = def.mag;
    if (h.ammo[id] <= 0) { h.reloadUntil[id] = now + this._reloadT(h, def); return false; }
    const mpc = id === 'heavy' ? heavyMpCost(def) : 0;
    if (mpc > 0 && !barrage && h.mp < mpc) return false;   // 重武器電力不足:禁射(重砲窗免電力;小隊電力共用,只扣一次)
    h.fireAt[id] = now;
    h.ammo[id]--;
    if (mpc > 0 && !barrage) h.mp -= mpc;
    if (h.ammo[id] <= 0) h.reloadUntil[id] = now + this._reloadT(h, def);  // 打空自動填彈
    h.stealthUntil = 0;   // 開火即現形(匿蹤破除)
    return true;
  }

  /** 主動填彈(R 鍵):未滿且不在填彈中才會觸發 */
  heroReload(pid, w) {
    const h = this.heroes.get(pid);
    if (!h || h.dead || this.over) return;
    const wp = this._heroWeapon(h, w);
    if (!wp || wp.def.mag == null) return;
    if (h.ammo[wp.id] == null) h.ammo[wp.id] = wp.def.mag;
    if (h.ammo[wp.id] >= wp.def.mag || (h.reloadUntil[wp.id] || 0) > this.t) return;
    h.ammo[wp.id] = 0;
    h.reloadUntil[wp.id] = this.t + this._reloadT(h, wp.def);
  }

  /** 英雄傷害倍率(招式增益 × 榴彈對建築加成 × 重砲模式加成;火力成長走武器面向 lw/hw 的階級數值) */
  _heroDmg(h, def, targetKind) {
    return def.dmg * vsMult(def, targetKind) * grenadeBuildingMul(def, targetKind)
      * this._buffMul(h, 'dmg')
      // 重砲模式:每發倍率由機種絕招預算 ÷ 整夾爆發推導(整夾 ≈ 追加一份預算,與另兩招等值;
      // 加成窗涵蓋彈體飛行時間,見 _barragingDmg)
      * (def.id === 'heavy' && this._barragingDmg(h) ? barrageDmgF(def, h?.abil) : 1);
  }

  /** 重砲傾洩窗(DUR)是否生效:純客戶端傾洩節奏用途,目前無伺服器結算讀它 —— 保留為語意錨。 */
  _barraging(h) { return (h?.barrageUntil || 0) > this.t; }

  /** 重砲加成窗(DUR + DMG_GRACE):涵蓋拋射彈飛行時間,落點才回報的榴彈/火箭/飛彈仍吃 2× 傷害/解射速閘/
   *  加程驗證(見 BARRAGE.DMG_GRACE)。彈夾此時已空且裝填中,不會有非傾洩重武器射擊誤吃加成。 */
  _barragingDmg(h) {
    const bu = h?.barrageUntil || 0;
    return bu > 0 && bu + BARRAGE.DMG_GRACE > this.t;
  }

  /** 空中判定:無人機/直升機/餌機/自殺機恆算飛行;其餘(機甲/變形/NPC)以高度 ≥ AA_MIN_ALT 論 */
  _airborne(e) {
    return e.kind === 'drone' || e.kind === 'heli' || e.kind === 'decoy' || e.kind === 'kami'
      || (e.y || 0) >= GAME.AA_MIN_ALT;
  }

  /**
   * 機體「視線點」絕對高程(高度差空戰用,見 data.js ALTITUDE)。英雄取客戶端回報的絕對視線高程 ay
   * (地形+跳躍+飛行皆含;缺值 = bot/測試,退回離地眼高近似);塔/主堡取砲位視線高(高聳工事);小兵取離地小視線高。
   * 註:伺服器為 2D 平面無地形高程,NPC/塔以離地眼高近似(地形基準視為 0)—— 動態飛行/跳躍(英雄 ay)精確。
   */
  _sightY(e) {
    if (!e) return 0;
    if (e.kind === 'tower' || e.kind === 'base') return LOS.TOWER_EYE_M;
    if (e.hero) return e.ay != null ? e.ay : (e.y || 0) + LOS.EYE_M;
    if (e.kind === 'heli' || e.decoy || e.kami) return (e.y || 0) + LOS.EYE_M;
    return (e.y || 0) + LOS.TGT_M;
  }

  /** 高度差「射程」乘數:較高的一方 +射程(封頂 +RANGE);同高/較低 = 1(見 data.js ALTITUDE) */
  _altRange(shooter, target) {
    if (!shooter || !target) return 1;
    const dh = this._sightY(shooter) - this._sightY(target);
    if (dh <= 0) return 1;                    // 只有較高的一方拉遠射程
    return 1 + ALTITUDE.RANGE * altScale(dh);
  }

  /** 高度差「爆擊」乘數 {rate, dmg}(施加在 shooter→target 這一擊):較高方攻擊時爆率/爆傷↓、受擊時↑ */
  _altCrit(shooter, target) {
    if (!shooter || !target) return { rate: 1, dmg: 1 };
    const dh = this._sightY(shooter) - this._sightY(target);
    const s = altScale(dh);
    if (s <= 0) return { rate: 1, dmg: 1 };
    if (dh > 0) return { rate: 1 - ALTITUDE.ATK_CRIT_RATE * s, dmg: 1 - ALTITUDE.ATK_CRIT_DMG * s };  // 較高方向下攻擊
    return { rate: 1 + ALTITUDE.RCV_CRIT_RATE * s, dmg: 1 + ALTITUDE.RCV_CRIT_DMG * s };              // 較高方受下方仰攻
  }

  /**
   * 爆擊擲骰(FPS:直擊武器限定,AoE 不爆);爆中推事件給客戶端跳橘字。
   * 高度差(_altCrit):爆率 ×rate;爆傷**加成部分**(critX − 1)×dmg —— 較高方攻擊時弱化、受擊時強化。
   */
  _rollCrit(h, def, dmg, t) {
    if (!def.crit) return dmg;
    const ac = this._altCrit(h, t);
    if (Math.random() >= def.crit * ac.rate) return dmg;
    const v = dmg * (1 + ((def.critX || VITALS.CRIT_X) - 1) * ac.dmg);
    this.events.push({ e: 'crit', pid: h.pid, x: t.x, z: t.z, y: t.hero ? (t.y || 0) : 0, v: Math.round(v) });
    return v;
  }

  /** 命中附帶 EMP(訊號矛/諧振波炮之類):敵方英雄武器短暫離線;負面狀態 = 助攻貢獻 */
  _applyHitEmp(h, def, t) {
    if (!def.emp || !t.hero) return;
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
    return m;
  }

  /** 電磁癱瘓中?(武器與招式全數離線) */
  _jammed(h) { return (h.empUntil || 0) > this.t; }

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
    // 領機身處環境(0 乾 / 1 水 / 2 沼;客戶端偵測回報 —— 位置本就客戶端權威,env 同屬輸入非狀態改寫)。
    // 環境改變即重置滯留計時(_wetT);沼澤扣血/停恢復、水域停電力/凍結 CD 換彈 皆在 tick 依此結算。
    const w = wet === 1 || wet === 2 ? wet : 0;
    if (w !== (h.wet || 0)) { h.wet = w; h.wetT = this.t; }
    h.lev = lev === 1 || lev === 2 ? lev : 0;   // 所在結構層(0 地面 / 1 橋面 / 2 隧道):slab LOS 用(#1)
  }

  /** 目標(僚機跟隨領機,故以領機瞬時移速判定)是否移動中 */
  _isMoving(t) {
    const lead = t.sq ? this.heroes.get(t.pid) : t;
    return (lead?._spd ?? 0) >= EVASION.MOVING_SPD;
  }

  /**
   * 閃避擲骰(輕武器直射專用,呼叫端負責只在 def.id==='light' / NPC gun 時呼叫)。
   * 條件:目標是英雄機體 + 有效機動 > MOBILITY_MIN + 移動中;飛行單位額外加成。
   * 只有英雄機體具閃避(NPC 移速 ≤ 20,永遠不符合) ⇒ 玩家打小兵不受影響。
   */
  _dodges(t, shooter) {
    if (!t || !t.hero) return false;
    // 完美迴避(招式追加效果 dodge):生效期間直射武器必閃,不吃機動/移動門檻
    if (this._buffVal(t, 'dodge') > 0) return true;
    const flying = t.kind === 'drone' || (t.y || 0) >= GAME.AA_MIN_ALT;
    const mob = heroMobility(t.kind, CHARACTERS[t.ch]?.mods, flying);
    if (mob <= EVASION.MOBILITY_MIN || !this._isMoving(t)) return false;
    let p = EVASION.GROUND + (flying ? EVASION.AIR_BONUS : 0);
    // 高度差:目標比射手高過門檻 → +閃避率(較高方 +DODGE 封頂;見 data.js ALTITUDE)
    if (shooter) {
      const dh = this._sightY(t) - this._sightY(shooter);
      if (dh > 0) p += ALTITUDE.DODGE * altScale(dh);
    }
    return Math.random() < p;
  }

  /** 瞄準模式切換(按住右鍵):熱兵器(rocket/railgun/siege 等)需瞄準中才能開火 */
  heroAim(pid, on) {
    const h = this.heroes.get(pid);
    if (!h || h.dead || this.over) return;
    h.aiming = !!on;
  }

  /** 英雄射擊命中(客戶端彈道命中回報;傷害/克制/爆擊/破甲、射程/射速/彈藥伺服器把關) */
  heroHit(pid, targetId, w) {
    const h = this.heroes.get(pid);
    const t = this.ents.get(targetId);
    if (!h || h.dead || !t || t.gar || t.side === h.side || this.over) return;
    if (this._jammed(h)) return;   // 電磁癱瘓:武器離線
    const wp = this._heroWeapon(h, w);
    if (!wp || !wp.def.rate) return;
    if (wp.def.needAim && !h.aiming) return;   // 重武器需瞄準模式才能開火
    // 射程驗證(3D:高空狙擊也要吃射程;留 25% 寬容給網路延遲/彈道飛行)
    const d3 = Math.hypot(h.x - t.x, h.z - t.z, (h.y || 0) - (t.hero ? (t.y || 0) : 0));
    if (d3 > wp.def.range * this._altRange(h, t, wp.def) * 1.25
        * (wp.id === 'heavy' && this._barraging(h) ? BARRAGE.RANGE_F : 1)) return;   // 高度制空:對地拉遠/對高空無人機縮短(重砲模式 +20% 射程)
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
    // 閃避(輕武器直射):機動機體移動中可能整發閃開(僚機齊射仍各自擲骰)
    if (!marked && wp.def.id === 'light' && this._dodges(t, h)) {
      this.events.push({ e: 'dodge', x: t.x, z: t.z, y: t.hero ? (t.y || 0) : 0, side: t.side });
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
    this._damage(t, dmg, h, wp.def.pen);
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
      if (d3 > def.range * this._altRange(b, t, def) * 1.25) continue;   // 高度制空(見 heroHit)
      // 僚機自己的射線也吃障礙遮蔽(主機看得到不代表僚機那個角度打得到)
      if (this._losBlocked(b.x, b.z, (b.y || 0) + LOS.EYE_M, t.x, t.z, this._tgtY(t), b, t)) continue;
      // pid/slot:客戶端解析僚機槍口錨(_entMuzzle 取離訊息座標最近那架)+ 開火動畫
      this.events.push({ e: 'shot', pid: b.pid, slot: def.id, from: [b.x, b.z], to: [t.x, t.z],
        ty: (t.hero || t.decoy || t.kind === 'heli') ? Math.round(t.y || 0) : 0, side: b.side });
      if (def.id === 'light' && this._dodges(t, b)) continue;   // 閃避:僚機這一發也被閃開
      const dmg = this._rollCrit(b, def, this._heroDmg(b, def, t.kind) * dmgFalloff(def, d3), t);
      this._applyHitEmp(b, def, t);
      this._damage(t, dmg, b, def.pen);
    }
  }

  /** 射擊來襲防空飛彈(飛彈可被擊毀) */
  hitMissile(pid, missileId, w) {
    const h = this.heroes.get(pid);
    if (!h || h.dead || this.over) return;
    if (this._jammed(h)) return;
    const m = this.missiles.find((x) => x.id === missileId);
    if (!m || m.side === h.side) return;
    const wp = this._heroWeapon(h, w);
    if (!wp || !wp.def.rate) return;
    if (wp.def.needAim && !h.aiming) return;
    const d3 = Math.hypot(h.x - m.x, h.z - m.z, (h.y || 0) - m.y);
    if (d3 > wp.def.range * 1.25) return;
    if (!this._gateFire(h, wp.id, wp.def, true)) return;
    // 僚機同步射擊(單機傷害是 1/3,三機齊射才打得掉飛彈)
    for (const b of this._bodies(h)) {
      if (b.dead) continue;
      const bd = Math.hypot(b.x - m.x, b.z - m.z, (b.y || 0) - m.y);
      if (bd > wp.def.range * 1.25) continue;
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
    if (wp.def.id === 'light' && this._dodges(t, h)) {
      this.events.push({ e: 'dodge', x: t.x, z: t.z, y: t.hero ? (t.y || 0) : 0, side: t.side });
      this._echo(h, t, wp.def);
      return true;
    }
    const dmg = this._rollCrit(h, wp.def, this._heroDmg(h, wp.def, t.kind) * dmgFalloff(wp.def, d3), t);
    this._applyHitEmp(h, wp.def, t);
    this._damage(t, dmg, h, wp.def.pen);
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
        const kd = this._heroDmg(h, wp.def, k.t.kind) * dmgFalloff(wp.def, k.d3) * LANCE.DECAY ** i;
        this._applyHitEmp(h, wp.def, k.t);
        this._damage(k.t, kd, h, wp.def.pen);
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
    if (this._jammed(h)) return;
    y = Number.isFinite(y) ? Math.max(0, Math.min(400, y)) : 0;   // 引爆高度夾範圍(防作弊)
    lev = lev === 2 ? 2 : lev === 1 ? 1 : 0;   // 爆點結構層(客戶端彈道回報;_blast 隧道垂直隔離用)
    const wp = this._heroWeapon(h, 'heavy');
    if (!wp || (wp.def.type !== 'launcher' && wp.def.type !== 'missile')) return;   // 飛彈也是 AoE 戰鬥部
    if (wp.def.needAim && !h.aiming) return;
    const dImp = dist2d(h.x, h.z, x, z);
    if (dImp > wp.def.range * 1.15 * (this._barragingDmg(h) ? BARRAGE.RANGE_F : 1)) return;   // 著彈點超程(留彈道寬容;重砲模式 +20% 射程,加成窗涵蓋彈體飛行)
    if (!this._gateFire(h, wp.id, wp.def, true)) return;
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
      if (dist2d(b.x, b.z, x, z) > wp.def.range * 1.15) continue;
      this._blast(b, wp.def, x, z, y, lev, tooClose);
    }
  }

  /**
   * 扇形攻擊(fan:電漿重武器 / 散彈輕武器):客戶端只回報射向(dx,dz 為 sim 座標單位向量)
   * 與槽位 slot('heavy' 電漿 / 'light' 散彈;預設 heavy 向後相容)。命中判定全在伺服器 —
   * 射程內、水平夾角 ≤ arc、迷霧可見的敵方單位全數受創(× 扇形近距高遠距低衰減)。
   * 一發只扣一次彈藥/射速,錐內敵人全數命中 = 真散彈手感。僚機以各自位置沿同射向齊噴。
   */
  heroPlasma(pid, dx, dz, slot = 'heavy') {
    const h = this.heroes.get(pid);
    if (!h || h.dead || this.over || !Number.isFinite(dx) || !Number.isFinite(dz)) return;
    if (this._jammed(h)) return;
    const wp = this._heroWeapon(h, slot === 'light' ? 'light' : 'heavy');
    if (!wp || !wp.def.fan) return;
    if (wp.def.needAim && !h.aiming) return;
    const len = Math.hypot(dx, dz) || 1;
    dx /= len; dz /= len;
    if (!this._gateFire(h, wp.id, wp.def, true)) return;
    const pulse = this.visionUntil?.[h.side] > this.t;
    const src = this._visionSources(h.side);
    const cosA = Math.cos((wp.def.arc || 15) * Math.PI / 180);
    for (const b of this._bodies(h)) {
      if (b.dead) continue;
      for (const t of [...this.ents.values()]) {
        if (t.side === h.side || t.gar || (t.hero && t.dead)) continue;
        const tx = t.x - b.x, tz = t.z - b.z;
        const d2 = Math.hypot(tx, tz);
        const d3 = Math.hypot(d2, (b.y || 0) - (t.hero ? (t.y || 0) : 0));
        if (d3 > wp.def.range * this._altRange(b, t, wp.def) * 1.25
            * (wp.id === 'heavy' && this._barragingDmg(h) ? BARRAGE.RANGE_F : 1)) continue;   // 高度制空(散彈輕武器;重砲模式 +20%)
        // 圓錐判定取水平夾角;目標近乎正下/正上方(d2 極小)視為在錐內
        if (d2 > 8 && (tx * dx + tz * dz) / d2 < cosA) continue;
        if (!pulse && !this._visibleTo(t, h.side, src)) continue;
        // 扇形焰舌/彈丸也不穿牆:發射機到目標的射線被實體障礙擋住 = 錐內也打不到
        if (this._losBlocked(b.x, b.z, (b.y || 0) + LOS.EYE_M, t.x, t.z, this._tgtY(t), b, t)) continue;
        this._damage(t, this._heroDmg(b, wp.def, t.kind) * dmgFalloff(wp.def, d3), b, wp.def.pen);
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
      let s, perp;
      if (vert) {
        s = (ty - oy) * sy;                                    // 垂直射線:軸向 = 高度差
        perp = Math.hypot(tx, tz);
      } else {
        s = tx * ux + tz * uz;                                 // 水平投影軸距
        // 垂直帶(見上方幾何近似說明):比對的是**機體整條垂直帶**而非單一取樣點 ——
        // 26m 的塔 / 10m 的機甲被瞄準頭部時,單點取樣(_tgtY)會讓整條射線判成落空。
        if (this._bodyDy(t, oy + slope * s) > band) continue;
        perp = Math.hypot(tx - ux * s, tz - uz * s);
      }
      if (s < 0 || s > maxS || perp > R) continue;
      if (!pulse && !this._visibleTo(t, shooter.side, src)) continue;
      if (this._losBlocked(ox, oz, oy, t.x, t.z, ty, shooter, t)) continue;
      out.push({ t, s, d3: Math.hypot(tx, tz, ty - oy) });
    }
    out.sort((a, b) => a.s - b.s);
    return out.length > LANCE.MAX ? out.slice(0, LANCE.MAX) : out;
  }

  /**
   * 直線貫穿攻擊(aoeClass 'line':beam / rail / gun 重武器)。客戶端回報射線:
   *   o = [x, z, y] 槍口(sim 座標,y = 離站立表面高)、d = [dx, dz, dy] 單位方向、len = 射線長
   *   (已被本端地形/障礙截斷 —— 伺服器再夾一次射程 ×1.25 寬容)。
   * 命中判定全在伺服器:圓柱內、射程內、迷霧可見、LOS 未遮蔽的敵方單位全數受創,
   * 依沿線先後套 LANCE.DECAY^i(首個全額 ⇒ 單體 DPS 與 heroHit 相同,bal 不變式不受影響)。
   * 一發只扣一次彈藥/電力/射速 —— 與 heroPlasma(扇形)、heroBurst(爆炸)同一條「AoE 一發一結算」。
   */
  heroLance(pid, o, d, len) {
    const h = this.heroes.get(pid);
    if (!h || h.dead || this.over) return;
    if (this._jammed(h)) return;
    if (!Array.isArray(o) || !Array.isArray(d)) return;
    const ox = +o[0], oz = +o[1], oy = +o[2];
    let dx = +d[0], dz = +d[1], dy = +d[2];
    if (![ox, oz, oy, dx, dz, dy, +len].every(Number.isFinite)) return;
    const wp = this._heroWeapon(h, 'heavy');
    if (!wp || aoeClass(wp.def) !== 'line') return;
    if (wp.def.needAim && !h.aiming) return;
    // 槍口必須在自己身邊(防作弊:不能從任意座標放一條線)
    if (dist2d(h.x, h.z, ox, oz) > 12) return;
    const dl = Math.hypot(dx, dz, dy) || 1;
    dx /= dl; dz /= dl; dy /= dl;   // 3D 單位化(_lanceHits 自行拆水平/垂直分量)
    const rMul = this._barragingDmg(h) ? BARRAGE.RANGE_F : 1;
    const max = Math.min(Math.max(0, +len), wp.def.range * 1.25 * rMul);
    if (!this._gateFire(h, wp.id, wp.def, true)) return;
    for (const b of this._bodies(h)) {
      if (b.dead) continue;
      // 僚機以各自位置沿同射向貫穿(與 heroPlasma 同構;N=1 時只有本機)
      const bx = b === h ? ox : b.x, bz = b === h ? oz : b.z, by = b === h ? oy : (b.y || 0) + LOS.EYE_M;
      const hits = this._lanceHits(b, wp.def, bx, bz, by, dx, dz, dy, max);
      for (let i = 0; i < hits.length; i++) {
        const { t, d3 } = hits[i];
        if (d3 > wp.def.range * this._altRange(b, t, wp.def) * 1.25 * rMul) continue;   // 高度制空
        const dmg = this._rollCrit(b, wp.def,
          this._heroDmg(b, wp.def, t.kind) * dmgFalloff(wp.def, d3) * LANCE.DECAY ** i, t);
        this._applyHitEmp(b, wp.def, t);
        this._damage(t, dmg, b, wp.def.pen);
      }
    }
    // 來襲防空飛彈也在圓柱內被打穿(取代 hitMissile 那條單體路徑 —— line 類一發只過一次
    // _gateFire,若客戶端另送 hitMissile 會重複扣彈)。判定同 hitMissile:射程 ×1.25、掉血歸零即擊落。
    for (let i = this.missiles.length - 1; i >= 0; i--) {
      const m = this.missiles[i];
      if (m.side === h.side) continue;
      const mx = m.x - ox, mz = m.z - oz, my = m.y - oy;
      const s = mx * dx + mz * dz + my * dy;
      if (s < 0 || s > max) continue;
      if (Math.hypot(mx - dx * s, mz - dz * s, my - dy * s) > lanceR(wp.def)) continue;
      const d3 = Math.hypot(mx, mz, my);
      if (d3 > wp.def.range * 1.25 * rMul) continue;
      m.hp -= this._heroDmg(h, wp.def, 'missile') * dmgFalloff(wp.def, d3);
      if (m.hp <= 0) {
        this.missiles.splice(i, 1);
        this.events.push({ e: 'boom', x: m.x, z: m.z, y: m.y, r: 8, side: h.side, sam: true });
        h.money += ECON.BOUNTY.missile;
      }
    }
  }

  /**
   * 無人機 F 鍵(2026-07-17,取代舊自爆):前方左右各釋放一架「自殺攻擊機(kami)」——
   * 體型/血量為本機 1/3、其餘數值相同,以本機 3 倍速撲向目標近炸;CD 固定 KAMI.CD_S。
   * 有準星鎖定 → 直接指定,否則生成後自動索敵。主機不再自爆(單機是玩家唯一機體)。
   * 敵方導引飛彈會被自殺機吸走砲火(見 _tickMissiles)。
   */
  heroKamikaze(pid) {
    const h = this.heroes.get(pid);
    if (!h || h.dead || h.kind !== 'drone' || this.over) return;
    const sq = h.sq;
    if (this.t < (sq.kamiCd || 0)) return;   // 冷卻中
    const K = SQUAD.KAMI;
    sq.kamiCd = this.t + K.CD_S;
    sq.kamis ??= [];
    const t0 = this._lockedTarget(sq);       // 有鎖定 → 直接指定,否則生成後自動索敵
    const ry = h.ry || 0;
    const fx = -Math.sin(ry), fz = Math.cos(ry);   // 前方(sim z=北)
    const rx = Math.cos(ry), rz = Math.sin(ry);    // 右方
    for (let i = 0; i < K.N; i++) {
      const s = i === 0 ? -1 : 1;                  // 左 / 右
      const k = this._add({
        kind: 'kami', side: h.side, pid, ch: h.ch, kami: true,
        x: h.x + fx * K.FWD + rx * K.SIDE * s,
        z: h.z + fz * K.FWD + rz * K.SIDE * s,
        y: h.y || 0, ry: ry + K.SPREAD * s,        // 朝前方左右散開
        hp: Math.max(1, Math.round(h.maxHp * K.HP_F)),
        armor: h.armor, tid: t0 ? t0.id : 0, dieAt: this.t + K.TTL_S,
      });
      k.maxSp = Math.max(0, Math.round((h.maxSp || 0) * K.HP_F)); k.sp = k.maxSp;
      sq.kamis.push(k);
    }
    this.events.push({ e: 'kami', pid, side: h.side, n: K.N });
  }

  /** 自殺攻擊機索敵:半徑內最近的敵方單位(不含中立/駐守/彼此的誘餌munitions);沒有 → null */
  _kamiAcquire(k) {
    let best = null, bd = SQUAD.KAMI.ACQ_R;
    for (const e of this.ents.values()) {
      if (e.side === k.side || e.neutral || e.hp <= 0 || e.kami || e.decoy || e.gar) continue;
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
        if (this.t >= k.dieAt) { this._kamiBoom(k); continue; }
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

  // ---------- 餌機(機甲的 F 鍵:分離發射 = 誘導導彈 + 偵察機 + 誘餌)----------
  /**
   * 發射:航向鎖定發射瞬間的機首朝向(玩家不能操舵);準星有鎖定才追蹤。
   * 空中已有一架 / 冷卻未到 → 忽略。CD 自發射瞬間起算(歸零 = 掛點重新組合完成)。
   */
  heroDecoy(pid) {
    const h = this.heroes.get(pid);
    if (!h || h.dead || h.kind !== 'morph' || this.over) return;   // 2026-07-18:餌機改變形機甲專屬(非變形機甲改重砲)
    const sq = h.sq;
    if (sq.decoy || this.t < sq.decoyCd) return;
    const t = this._lockedTarget(sq);
    const ry = h.ry || 0;
    const d = this._add({
      kind: 'decoy', side: h.side, pid, decoy: true,
      x: h.x, z: h.z, y: (h.y || 0) + DECOY.ALT, ry,
      hp: Math.max(1, Math.round(h.maxHp * DECOY.HP_F)),
      armor: 0, tid: t ? t.id : 0, lost: false, dieAt: this.t + DECOY.TTL_S,
      bombType: MORPH_BOMB[h.ch] || 'fire', bombsLeft: DECOY.BOMB_MAX, nextBomb: 0,   // 沿途投彈(依機體類型)
    });
    sq.decoy = d;
    sq.decoyCd = this.t + DECOY.CD_S;
    this.events.push({ e: 'decoy', pid, side: h.side, id: d.id, homing: t ? 1 : 0, bomb: d.bombType });
  }

  /**
   * 重砲模式(2026-07-18;非變形機甲:狙擊模式長按左鍵)。開一個 BARRAGE.DUR 秒的傾洩窗:
   * 此窗內重武器解除射速閘與電力門檻(客戶端 0.5s 內傾洩剩餘彈夾),傷害 ×DMG_F、射程 ×RANGE_F;
   * 獨立於彈夾裝填的 CD_S 冷卻。加成結算在 _gateFire(解閘)/_heroDmg(傷害)/各射程驗證處(_barraging)。
   */
  heroBarrage(pid) {
    const h = this.heroes.get(pid);
    if (!h || h.dead || h.kind !== 'robot' || this.over) return;   // 非變形機甲專屬
    if (!h.aiming) return;                        // 必須在狙擊模式
    if (this.t < (h.barrageCd || 0)) return;      // 冷卻中(靜默丟棄)
    // 彈夾空 / 裝填中 → 無彈可傾洩(重砲窗解射速閘/電力,但不解裝填閘),不啟動以免白吃 30s CD
    if ((h.reloadUntil?.heavy || 0) > this.t || h.ammo?.heavy === 0) return;
    h.barrageCd = this.t + BARRAGE.CD_S;
    h.barrageUntil = this.t + BARRAGE.DUR;
    this.events.push({ e: 'barrage', pid, side: h.side });
  }

  /**
   * 每 tick:追蹤轉向(限轉率)→ 直線前進 → 失聯判定 → 近炸 / 燃料耗盡自爆。
   * 失聯 = 離主機甲 > LINK_M:斷訊(不再回傳視野與 PiP 畫面)且放棄追蹤,但仍會直飛到自爆。
   */
  _tickDecoys(dt) {
    for (const sq of this.squads.values()) {
      const d = sq.decoy;
      if (!d) continue;
      if (this.t >= d.dieAt) { this._decoyBoom(d); continue; }

      const owner = sq.bodies[sq.act];
      if (!d.lost && dist2d(d.x, d.z, owner.x, owner.z) > DECOY.LINK_M) {
        d.lost = true;
        d.tid = 0;                                   // 失聯 = 失去火控,不再追蹤
        this.events.push({ e: 'decoyLost', pid: sq.pid, id: d.id });
      }

      // 沿途投彈:敵入 BOMB_R(餌機攻擊範圍)才開始丟,間隔 BOMB_GAP、單次任務最多 BOMB_MAX 枚
      if ((d.bombsLeft || 0) > 0 && this.t >= (d.nextBomb || 0) && this._decoyEnemyNear(d, DECOY.BOMB_R)) {
        this._decoyBomb(d, owner);
        d.bombsLeft--;
        d.nextBomb = this.t + DECOY.BOMB_GAP;
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

  /** 隨機取一個非兵線、離主堡與障礙夠遠的平民生成點(比照 _airdropPoint)。 */
  _civPoint() {
    const b = this.bounds;
    for (let tries = 0; tries < 40; tries++) {
      const x = b.minX + Math.random() * (b.maxX - b.minX);
      const z = b.minZ + Math.random() * (b.maxZ - b.minZ);
      if (!this._inBounds(x, z, 2)) continue;
      if (this._distToLanes(x, z) < CIVILIAN.LANE_MIN) continue;
      if (!this._farFromStructures(x, z, CIVILIAN.BASE_CLEAR, 0)) continue;
      if (this.hazBlockers.some(([hx, hz, hr]) => dist2d(x, z, hx, hz) < hr + 2)) continue;
      if (this._terrainBlocked(x, z)) continue;   // 平民生成/重生點避開水域/沼澤/火場(feature 9)
      return { x, z };
    }
    return null;
  }

  /** 徘徊路點:繞出生點 WANDER_R 內、仍在非兵線範圍的隨機點(取不到回原地)。 */
  _civWander(e) {
    for (let i = 0; i < 12; i++) {
      const a = Math.random() * Math.PI * 2, r = Math.random() * CIVILIAN.WANDER_R;
      const x = e.home[0] + Math.cos(a) * r, z = e.home[1] + Math.sin(a) * r;
      if (!this._inBounds(x, z, 2)) continue;
      if (this._distToLanes(x, z) < CIVILIAN.LANE_MIN) continue;
      if (this._terrainBlocked(x, z)) continue;   // 徘徊路點避開水域/沼澤/火場(feature 9)
      return [x, z];
    }
    return [e.home[0], e.home[1]];
  }

  /** 平民朝(away=遠離)目標移動;更新朝向、夾在地圖內。回傳是否有位移。 */
  _moveCiv(e, tx, tz, sp, dt, away = false) {
    let dx = tx - e.x, dz = tz - e.z;
    const d = Math.hypot(dx, dz);
    if (d < 1e-3) return false;
    const s = (away ? -1 : 1) / d;
    const nx = Math.max(this.bounds.minX, Math.min(this.bounds.maxX, e.x + s * dx * sp * dt));
    const nz = Math.max(this.bounds.minZ, Math.min(this.bounds.maxZ, e.z + s * dz * sp * dt));
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
    const sq = this.squads.get(d.pid);
    const owner = sq ? sq.bodies[sq.act] : null;
    this.events.push({ e: 'boom', x: d.x, z: d.z, y: d.y, r: DECOY.R, side: d.side });
    // 撞擊爆風 = 絕招預算 × DECOY_IMPACT(隨主機甲輕/重武器綜合等級成長);爆點層 = 餌機所在層(不穿橋面/隧道天花)
    if (owner) this._blast(owner, decoyBlast(owner.abil), d.x, d.z, d.y, this._unitLev(d));
    // 2026-07-19:自爆(燃料耗盡/近炸)時尚有未投完的炸彈 → 原地補投一枚(復用單一投彈縫,記主機甲)
    if (owner && (d.bombsLeft || 0) > 0) { d.bombsLeft--; this._decoyBomb(d, owner); }
    this._removeDecoy(d);
  }

  _removeDecoy(d) {
    this.ents.delete(d.id);
    const sq = this.squads.get(d.pid);
    if (sq && sq.decoy === d) sq.decoy = null;
  }

  /** 餌機攻擊範圍內是否有敵方戰鬥單位(沿途投彈的觸發條件:敵入範圍才丟) */
  _decoyEnemyNear(d, r) {
    for (const e of this.ents.values()) {
      if (e.side === d.side || !e.side || e.neutral || e.decoy || e.kami || e.gar || e.hp <= 0) continue;
      if (e.hero && e.dead) continue;
      if (this._airborne(e)) continue;   // 投擲範圍偵測只針對地面單位(不對空中無人機/直升機/升空機甲丟彈)
      if (dist2d(e.x, e.z, d.x, d.z) <= r) return true;
    }
    return false;
  }

  /**
   * 餌機投下一枚炸彈(依機體類型:燃燒/凍結/毒霧/雷爆,見 DECOY_BOMB)。
   * 直擊爆風走 _blast(記主機甲火力升級/助攻/擊殺);附加狀態復用既有 bleed/slow/EMP/stun 欄位
   * (與 _applyCC 同一批狀態縫),純狀態貢獻另補 asst 戳記(輔助角色收入)。
   */
  _decoyBomb(d, owner) {
    if (!owner) return;
    const b = DECOY_BOMB[d.bombType] || DECOY_BOMB.fire;
    const def = decoyBombBlast(owner.abil);   // 單枚 = 預算的非撞擊部分 / BOMB_MAX(同吃綜合武器等級)
    this.events.push({ e: 'decoyBomb', x: d.x, z: d.z, y: d.y || 0, r: def.r, side: d.side, bomb: d.bombType });
    this._blast(owner, def, d.x, d.z, d.y || 0, this._unitLev(d));   // 直擊爆風(走 _damage → 自動蓋 asst + 給擊殺信用);爆點層 = 餌機所在層
    // 附加狀態:效果半徑內的敵方單位(建築/中立/無敵幀免疫,比照 _applyCC)
    const rr = def.r * 1.5;
    for (const t of [...this.ents.values()]) {
      if (t.side === d.side || !t.side || t.neutral || t.decoy || t.kami || t.gar || t.hp <= 0) continue;
      if (t.hero && t.dead) continue;
      if (t.kind === 'tower' || t.kind === 'base' || t.kind === 'bunker') continue;   // 工事免控場/狀態
      if (t.hero && (t.invUntil || 0) > this.t) continue;
      if (dist2d(t.x, t.z, d.x, d.z) > rr) continue;
      (t.asst ||= {})[owner.pid] = this.t;   // 純狀態貢獻也記助攻
      if (b.dot) t.bleed = { dps: b.dot, until: this.t + (b.dur || 4), pen: 6, pid: owner.pid };   // 燃燒/毒霧 DoT
      if (b.slow) { t.slowUntil = Math.max(t.slowUntil || 0, this.t + (b.dur || 3)); t.slowF = Math.min(t.slowF ?? 1, b.slow); }   // 凍結/毒霧 減速(取較強 = 較小)
      if (b.emp) t.empUntil = Math.max(t.empUntil || 0, this.t + b.emp);   // 雷爆:武器離線(英雄與 NPC 皆吃)
      if (b.stun) t.stunUntil = Math.max(t.stunUntil || 0, this.t + b.stun);   // 雷爆:短暫麻痺
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
    h.acd[slot] = this.t + A.cd;
    if (A.fx !== 'stealth' && A.fx !== 'vision') h.stealthUntil = 0;   // 出手即現形
    // 一隊只回傳主視野那架當代表:招式增益(mods)是小隊共用的,推三次會疊三倍
    const allies = (r) => [...this.heroes.values()].filter((a) =>
      a.side === h.side && !a.dead && (a === h || dist2d(a.x, a.z, h.x, h.z) <= r));

    if (A.fx === 'buff') {
      const targets = A.target === 'team' ? allies(A.r || 0) : [h];
      for (const a of targets) {
        for (const [k, m] of Object.entries(A.mul || {})) a.mods.push({ k, m, until: this.t + A.dur });
        // 走位/其他類追加效果(haste 衝鋒 / leap 大跳躍 / dodge 完美迴避 / vamp 吸血 → mods 通道;
        // mark 定位 → markUntil 一擊即耗)—— 效果種類與數值全住 data.js 的 add 欄位
        const ad = A.add;
        if (ad) {
          if (ad.fx === 'haste') a.mods.push({ k: 'speed', m: ad.f || 1.25, until: this.t + A.dur });
          else if (ad.fx === 'leap') a.mods.push({ k: 'jump', m: ad.f || 2, until: this.t + A.dur });
          else if (ad.fx === 'dodge') a.mods.push({ k: 'dodge', m: 1, until: this.t + A.dur });
          else if (ad.fx === 'vamp') a.mods.push({ k: 'vamp', m: ad.f || 0.12, until: this.t + A.dur });
          else if (ad.fx === 'mark') a.markUntil = this.t + (ad.dur || A.dur);
        }
      }
    } else if (A.fx === 'heal') {
      // 「特殊招式」是裝甲(第二層 HP)在主堡以外唯一的回復手段(小隊三架一起回)
      const targets = A.target === 'team' ? allies(A.r || 0) : [h];
      for (const a of targets) {
        for (const b of this._bodies(a)) {
          if (b.dead) continue;
          b.hp = Math.min(b.maxHp, b.hp + A.heal);
          if (A.sp) b.sp = b.maxSp;
        }
      }
    } else if (A.fx === 'strike') {
      for (let i = 0; i < A.count; i++) {
        const ang = Math.random() * Math.PI * 2;
        const rr = i === 0 ? 0 : Math.random() * (A.scatter || A.r * 2);
        const ix = x + Math.cos(ang) * rr, iz = z + Math.sin(ang) * rr;
        this.events.push({ e: 'boom', x: ix, z: iz, r: A.r, side: h.side });
        // 空襲自天而降 → 爆點恆為地面層(lev 0):砸在隧道覆蓋段上方不會隔著山體炸到洞內
        this._blast(h, { dmg: A.dmg, r: A.r, vs: A.vs, pen: A.pen }, ix, iz, 0, 0);
        if (A.add) this._applyCC(h, A.add, ix, iz, A.r);   // 控場類追加效果:彈著區內敵人
      }
    } else if (A.fx === 'summon') {
      const { li, d } = this._nearestLane(h.x, h.z);
      const total = this._laneCum(li)[this._laneCum(li).length - 1];
      const comp = A.unit === 'squad'
        ? Array.from({ length: A.count }, (_, i) => (i % 3 === 2 ? 'rocketeer' : 'soldier'))
        : Array(A.count).fill(A.unit);
      comp.forEach((kind, i) => {
        this._add({
          kind, side: h.side, lane: li,
          x: h.x + (Math.random() - 0.5) * 20, z: h.z + (Math.random() - 0.5) * 20,
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
        if (dist2d(e.x, e.z, x, z) > A.r) continue;
        e.empUntil = Math.max(e.empUntil || 0, this.t + A.dur);
        (e.asst ||= {})[h.pid] = this.t;   // 施加負面狀態 = 助攻貢獻(與 _applyCC/_applyHitEmp 同規)
      }
      if (A.vision) this.visionUntil[h.side] = Math.max(this.visionUntil[h.side], this.t + A.vision);
    } else if (A.fx === 'vision') {
      this.visionUntil[h.side] = Math.max(this.visionUntil[h.side], this.t + A.vision);
    } else if (A.fx === 'stealth') {
      h.stealthUntil = this.t + A.dur;
    } else if (A.fx === 'intercept') {
      // 擊落半徑內所有敵方來襲飛彈(悼歌條款:擋子彈的,不是打人的)
      for (let i = this.missiles.length - 1; i >= 0; i--) {
        const ms = this.missiles[i];
        if (ms.side === h.side) continue;
        if (dist2d(ms.x, ms.z, h.x, h.z) > A.r) continue;
        this.missiles.splice(i, 1);
        this.events.push({ e: 'boom', x: ms.x, z: ms.z, y: ms.y, r: 8, side: h.side, sam: true });
      }
      if (A.vision) this.visionUntil[h.side] = Math.max(this.visionUntil[h.side], this.t + A.vision);
    }
    // dash:位移在客戶端(位置本就客戶端回報),伺服器只管 CD/MP 與廣播特效
    if (A.fx === 'buff' && A.vision) this.visionUntil[h.side] = Math.max(this.visionUntil[h.side], this.t + A.vision);
    this.events.push({ e: 'cast', pid, side: h.side, ch: h.ch, slot, fx: A.fx, x, z, r: A.r, dur: A.dur, lvl });
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
   *  ①隧道(任一端 lev 2):岩體/天花包覆,洞內↔洞外互不波及 —— 身處洞內即隔絕,不需 ribbon。
   *  ②橋面(lev 1↔0):僅「正上方↔正下方」被橋面板隔開 —— 爆心與目標同落一條 ty=1 ribbon;
   *    側向溢流照炸(與 _slabBlocked ② under-block 同判定,不誤擋橋旁地面單位)。
   * lev 為 null(導引飛彈著彈)已由鎖定時的 slab LOS 把關,回傳 false 維持舊行為。
   */
  _slabSep(lev, x, z, t) {
    if (lev == null || !this._slabGrid) return false;
    const tl = this._unitLev(t);
    if (tl === lev) return false;                        // 同層 → 無板隔開
    if (tl === 2 || lev === 2) return true;              // 隧道:洞內↔洞外
    const C = LOS.CELL_M;                                // 橋面 1↔0:爆心與目標同落一條橋面 ribbon 才隔
    const arr = this._slabGrid.get((Math.floor(x / C) + 32768) * 65536 + (Math.floor(z / C) + 32768));
    if (arr) for (const s of arr) {
      if (s[5] === 1 && ptOnRibbon(x, z, s) && ptOnRibbon(t.x, t.z, s)) return true;
    }
    return false;
  }

  /** 爆炸範圍傷害(3D 距離:高空引爆炸不到地面;只傷敵方;AoE 不吃爆擊)。
   *  外圍傷害走 blastFalloff:核心全傷、超壓隨距離連續衰減到 1.8r 歸零(物理化舊二段式)。
   *  直升機 2026-07-17 起計入巡航高度(對空化):地面炸點打不到 26m 高的直升機,高空直擊/同高度
   *  自爆才炸得到。lev = 爆心結構層(0 地面/1 橋面/2 隧道內;null = 不查層),經 _slabSep 封住穿頂/穿板。 */
  // friendly=true(榴彈太近的無差別模式):不濾己方 ⇒ 波及友軍與射手自身(皆登記在 ents)。
  // 同陣營目標以 by=null 結算(比照地雷 _tickMines):不吸血、不記助攻/仇恨/賞金,但傷害照吃(自損)。
  _blast(h, def, x, z, y, lev = null, friendly = false) {
    for (const t of [...this.ents.values()]) {
      if (t.hero && t.dead) continue;
      const same = t.side === h.side;
      if (same && !friendly) continue;
      if (this._slabSep(lev, x, z, t)) continue;
      const d = Math.hypot(x - t.x, z - t.z, this._bodyDy(t, y));
      const f = blastFalloff(def.r, d);
      if (f > 0) this._damage(t, this._heroDmg(h, def, t.kind) * f, same ? null : h, def.pen);
    }
  }

  // ---------- 經濟:購買(八軌;2026-07-20 全軌固定單價,4 戰鬥面向 + 4 防禦系統,無擊殺門檻)----------
  /** item: 'lw'|'hw'|'sk'|'ult'(戰鬥面向,推進 abil 階)或 'hp'|'ar'|'sp'|'ch'(防禦系統)。回傳錯誤訊息或 null */
  buy(pid, item) {
    const h = this.heroes.get(pid);
    // 陣亡等待重生也能購買(DOTA 慣例;重生點/死亡畫面補升級)
    if (!h || this.over) return '目前無法購買';
    // hasOwn:item 是客戶端原字串,'toString' 等原型鏈鍵名會取到繼承函式(truthy)
    // → price NaN → 共用 ps.money 污染成 NaN = 八軌全免。
    const up = Object.hasOwn(ECON.UPGRADES, item) ? ECON.UPGRADES[item] : null;
    if (!up) return '沒有這項商品';
    const lvl = h.upg[item] || 0;
    if (lvl >= up.max) return `${up.name} 已滿級`;
    const price = upgradePrice(up, lvl);
    if (h.money < price) return `資金不足(${up.name} 需 $${price})`;
    h.money -= price;
    h.upg[item] = lvl + 1;
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
    this.events.push({ e: 'buy', pid, item, lvl: h.upg[item] });
    return null;
  }

  // ---------- 傷害 / 擊殺(FPS × DOTA:護盾 → 裝甲,護甲值曲線減免,破甲抵銷)----------
  _damage(t, dmg, by, pen = 0, floorHp = 0) {
    if (this.over || t.hp <= 0 || t.inv) return;   // inv = 不可摧毀障礙(塌陷/坍方/火場/淹水)
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
      dmg *= this._buffMul(t, 'dmgTaken');   // 複合裝甲詞綴 / 護盾類招式
      t.lastHitAt = this.t;                  // 進入戰鬥:護盾回復重新計時
      // 第一層護盾先吃(能量護盾不吃護甲減免)
      const toShield = Math.min(t.sp || 0, dmg);
      t.sp = (t.sp || 0) - toShield;
      let rem = dmg - toShield;
      if (rem <= 0) { this._vamp(by, toShield); return; }
      // 第二層裝甲:護甲值減免(破甲抵銷)
      dmg = rem * armorMul(t.armor, pen);
      dealt = toShield + Math.min(t.hp, dmg);
    } else {
      dmg *= armorMul(UNITS[t.kind]?.armor ?? 0, pen);
      dealt = Math.min(t.hp, dmg);
    }
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
  }

  /** 吸血(招式追加效果 vamp):攻擊者按「實際造成傷害 × 比例」回復自身裝甲 */
  _vamp(by, dealt) {
    if (!by || !by.hero || by.dead || !(dealt > 0)) return;
    const f = this._buffVal(by, 'vamp');
    if (f > 0) by.hp = Math.min(by.maxHp, by.hp + dealt * f);
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
      by.money += (ECON.BOUNTY[t.kind] || 0) * this._buffMul(by, 'bounty');
      // 擊殺數:招式解鎖/升級的門檻。電腦玩家(bot)只算 BOT_KILL_SCORE 分,不能靠刷 bot 速成。
      if (!t.neutral) by.kn += (t.hero && isBotId(t.pid)) ? BOT_KILL_SCORE : killScore(t.kind);
    }
    // 助攻(2026-07-17):曾造成傷害/負面狀態的其他英雄,賞金 × ASSIST.F。
    // 「離開可視半徑 10 秒後不算」:tick 內的在場刷新讓「仍在半徑內」的戳記恆新;
    // 戳記逾期 = 離開半徑(或陣亡)超過 TTL —— 此處只驗 TTL,不再看距離
    // (擊殺當下看距離會讓已失效的貢獻因重返半徑復活,違反規格)。
    if (t.asst) {
      const bounty = ECON.BOUNTY[t.kind] || 0;
      for (const pid in t.asst) {
        if (!bounty) break;
        if (by && by.hero && pid === by.pid) continue;   // 擊殺者本人拿全額,不重複領助攻
        const a = this.heroes.get(pid);
        if (!a || a.side === t.side) continue;
        if (this.t - t.asst[pid] > ECON.ASSIST.TTL_S) continue;
        const v = bounty * ECON.ASSIST.F * this._buffMul(a, 'bounty');
        a.money += v;
        this.events.push({ e: 'assist', pid, v: Math.round(v) });
      }
      t.asst = null;
    }
    // 汲能核心詞綴:擊殺(非中立)回復上限血量比例
    if (by && by.hero && bySide !== t.side && !t.neutral && !by.dead) {
      for (const id in by.buffs || {}) {
        if (by.buffs[id] > this.t && AFFIXES[id]?.killHeal) {
          by.hp = Math.min(by.maxHp, by.hp + by.maxHp * AFFIXES[id].killHeal);
        }
      }
    }
    if (t.decoy) {   // 餌機被擊落:誘餌任務達成,不自爆;但尚有未投完的炸彈 → 原地補投一枚(2026-07-22)
      const sq = this.squads.get(t.pid);
      const owner = sq ? sq.bodies[sq.act] : null;
      if (owner && (t.bombsLeft || 0) > 0) { t.bombsLeft--; this._decoyBomb(t, owner); }
      this._removeDecoy(t);
      return;
    }
    if (t.kami) {   // 自殺攻擊機被擊毀(2026-07-22):原地以 50% 傷害與半徑引爆(舊版只消失、不引爆)
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
      // 重生冷卻:三機小隊只有「整隊全滅」才追加重生時間(全隊統一延後),個別墜毀只吃基礎重生;
      // 機甲/變形機甲(單機)沿用陣營死亡數累加。
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
        t.deaths = (t.deaths || 0) + 1;
        const rs = r.base + r.perDeath * this.stats[t.side].deaths;   // 重生倒數秒數(單機累計)
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
      this.nextWaveAt = this.t + waveInterval(this.wave);
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
    // 2026-07-17:被動收入停發(金錢只來自擊殺/助攻/物資);回充速度 × 充能等級(chargeF)。
    for (const h of this.heroes.values()) {
      // 水域(領機泡水,h.wet===1):電子系統失效 —— 停止電力回充;滯留 WATER_FREEZE_S 後再凍結換彈與招式冷卻。
      // reload/acd 是絕對 sim 時間 deadline(this.t 持續前進不會自停),凍結 = 每凍結 tick 把 deadline 往後推 dt。
      const inWater = (h.wet || 0) === 1 && !h.dead;
      if (!inWater && this._aliveN(h) > 0 && h.mp < h.maxMp) {
        h.mp = Math.min(h.maxMp, h.mp + h.mpRegen * chargeF(h.upg?.ch) * dt);
      }
      if (inWater && this.t - (h.wetT || 0) >= TERRAIN_FX.WATER_FREEZE_S) {
        for (const id in h.reloadUntil) if (h.reloadUntil[id] > this.t) h.reloadUntil[id] += dt;
        if ((h.acd?.skill || 0) > this.t) h.acd.skill += dt;
        if ((h.acd?.ult || 0) > this.t) h.acd.ult += dt;
      }
    }
    // 機體層級:重生 / 護盾脫戰回復 / 主堡修裝甲
    for (const sq of this.squads.values()) {
      const hh = this.heroes.get(sq.pid);
      const swamp = (hh?.wet || 0) === 2;   // 沼澤只影響回報環境的領機(玩家所在機體)
      for (const b of sq.bodies) {
        if (b.dead) {
          if (this.t >= b.respawnAt && this._tickN > (b.deadTick || 0) + 1) this._respawn(b);
          continue;
        }
        const bSwamp = swamp && b === hh;   // 沼澤:無法恢復/治療 護盾與裝甲(feature 7)
        // 護盾:脫戰(OOC_S 秒沒受擊)自然回復;裝甲只能回主堡 / 治療招式。
        // 回復速度 × 充能等級(chargeF;SP_REGEN_PS 是滿級規格)
        if (!bSwamp && b.sp < b.maxSp && this.t - b.lastHitAt > VITALS.OOC_S) {
          b.sp = Math.min(b.maxSp, b.sp + b.maxSp * VITALS.SP_REGEN_PS * chargeF(b.upg?.ch) * dt);
        }
        if (!bSwamp && b.hp < b.maxHp) {
          const [bx, bz] = this.basePos[b.side];
          if (dist2d(b.x, b.z, bx, bz) < GAME.HERO_HEAL_R) {
            b.hp = Math.min(b.maxHp, b.hp + UNITS[b.kind].regen * dt);
          }
        }
        // 沼澤滯留:緩慢扣血(火災 1/3 速率,走 _damage 護盾先擋;null 攻擊者 = 不記擊殺信用;
        // floorHp=1 硬地板 → 最多扣到剩 1 滴不致死)
        if (bSwamp && this.t - (hh.wetT || 0) >= TERRAIN_FX.SWAMP_DRAIN_S) this._damage(b, TERRAIN_FX.SWAMP_DRAIN_PS * dt, null, 0, 1);
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
    this._tickDecoys(dt);
    this._tickKamis(dt);
    this._tickCivilians(dt);
    this._tickMines();
    this._tickAmbush(dt);
    this._tickRelays(dt);
    this._tickHazards(dt);
    this._tickAirdrops(dt);
    this._tickCamps(dt);

    // 小兵 / 塔 / 主堡行為
    this._structs = [...this.ents.values()].filter((s) => s.kind === 'tower' || s.kind === 'base');
    for (const e of [...this.ents.values()]) {
      // 餌機/自殺攻擊機:位置由 _tickDecoys/_tickKamis 管、自己不推線,但仍是敵方小兵/塔的合法目標
      if (e.hero || e.neutral || e.decoy || e.kami || e.hp <= 0) continue;
      const u = UNITS[e.kind];
      e.cd = Math.max(0, e.cd - dt);
      if (u.guns) this._tickBaseGuns(e, u.guns, dt);   // 主堡兩門大砲(獨立於本體火砲,砲塔級射程/傷害)
      if (e.tp) this._tpBehave(e, dt);   // 第三方:駐守回血/進出碉堡/繫繩旗標(開火與移動之外的狀態機)
      // 駐守碉堡:射孔限制,射程 ×GAR_RANGE_F(其餘規格照舊)
      const target = this._acquireTarget(e, e.gar ? { ...u, range: u.range * THIRD.GAR_RANGE_F } : u);
      e._eng = !!target;   // 交戰中的不當凝聚錨點(否則整波卡在原地等它)
      if (target && !e.ret) {   // 第三方撤回中(ret)不停下交戰 —— 「馬上撤回碉堡周圍」
        // 電磁癱瘓(EMP 招式):單位武器離線,仍可移動;建築免疫(heroCast 不標記建築)
        if (e.cd === 0 && !((e.empUntil || 0) > this.t)) {
          e.cd = 1 / u.rate;
          const wd = WEAPONS[u.wid];
          // 閃避:小兵的直射槍械(無爆風 r = 機槍/步槍)可被移動中的機動機體閃開;
          // 火箭/榴彈/塔砲(有 r 或塔/主堡)是 AoE / 制式火砲,不可閃。
          if (wd && !wd.r && e.kind !== 'tower' && e.kind !== 'base' && this._dodges(target, e)) {
            this.events.push({ e: 'dodge', x: target.x, z: target.z, y: target.hero ? (target.y || 0) : 0, side: target.side });
          } else {
            this._damage(target, u.dmg, e, wd?.pen || 0);   // 高度差不改基礎傷害(見 §3;閃避/射程仍吃高度差)
          }
          // 開火事件(2026-07-17 起全兵種發送,附射手 id/kind):客戶端解析射手機體的
          // 槍口錨畫曳光/槍口焰 + 標記後座動畫 + 面向攻擊目標(槍口一律朝攻擊方向);
          // ty = 空中目標高度(直升機/英雄),曳光才不會打在目標腳下的地面;
          // oy = 射手離地高(直升機):迷霧邊緣查無 mesh 時曳光退路不再從地面射出;
          // gi(主堡本體砲):兩門砲口輪替,不與 _tickBaseGuns 的 0 號砲搶同一根砲管
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
  }

  /** 單機重生:回主堡、滿血滿盾;全隊都躺著時才重置共用資源(彈藥/增益) */
  _respawn(b) {
    const soloWipe = this._aliveN(b) === 0;
    b.dead = false;
    b.dash = 0;
    b.hp = b.maxHp;
    b.sp = b.maxSp;
    b.lastHitAt = -99;
    b.wet = 0; b.wetT = this.t;   // 重生清環境滯留(下個 pos 回報重新判定)
    const [sx, sz] = this._spawnPoint(b.side, b.spawnIdx || 0, b.si || 0);
    b.x = sx; b.z = sz;
    b.y = b.kind === 'drone' ? SQUAD.REGROUP_ALT : 0;
    b.rg = b.kind === 'drone';   // 僚機:先沿標準路線歸隊
    // 每架獨立的控場狀態(非 SQUAD_SHARED):重生一律清乾淨(助攻貢獻戳記一併清)
    b.stunUntil = 0; b.slowUntil = 0; b.confUntil = 0; b.bleed = null; b.invUntil = 0; b.asst = null; b.barrageUntil = 0;
    if (soloWipe) {
      b.mp = b.maxMp;
      b.empUntil = 0; b.stealthUntil = 0; b.mods = []; b.markUntil = 0;
      b.ammo = {}; b.reloadUntil = {}; b.fireAt = {};   // 重生滿彈
    }
    this.events.push({ e: 'respawn', id: b.id, side: b.side, pid: b.pid });
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
      // 變形機甲照舊只有地面型態(回報高度 y ≤ MORPH.GROUND_Y)會踩,飛行型不觸發。
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
      // 無人機恆為空中目標;變形機甲僅飛行型態(y ≥ AA_MIN_ALT)會被伏擊鎖定
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
        x: best.x, z: best.z, y: 2, speed: A.SPEED, dmg: A.DMG, pen: A.PEN, hp: A.HP, ttl: 14,
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
      body.hp = Math.min(body.maxHp, body.hp + hp);
      body.sp = Math.min(body.maxSp, body.sp + sp);
      ev.hp = hp; ev.sp = sp;
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
          this._damage(t, m.dmg, this.ents.get(m.byId) || { side: m.side }, m.pen || 0);
          this.events.push({ e: 'boom', x: t.x, z: t.z, y: t.y || 0, r: 14, side: m.side, sam: true });
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
            this.events.push({ e: 'boom', x: m.x, z: m.z, y: m.y, r: 8, side: m.side, sam: true });
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
        this.events.push({ e: 'boom', x: m.x, z: m.z, y: m.y, r: 8, side: m.side, sam: true });
        this.missiles.splice(i, 1);
      }
    }
  }

  _spawnWave() {
    for (let li = 0; li < this.lanes.length; li++) {
      for (const side of ['SWARM', 'STEEL']) {
        const pts = this.lanes[li];
        const cum = this._laneCum(li);
        const total = cum[cum.length - 1];
        const off = GAME.WAVE_SPAWN_OFF_M;   // 出生點落在主路線上、主堡外(領隊在 off,列隊向堡內錯開)
        const comp = [];
        for (let i = 0; i < GAME.WAVE_SOLDIERS; i++) comp.push('soldier');
        comp.push(...GAME.WAVE_EXTRAS);   // 固定編制唯一真相住 data.js(2026-07-17 起含坦克)
        comp.forEach((kind, i) => {
          const jx = (Math.random() - 0.5) * 14, jz = (Math.random() - 0.5) * 14;
          // 沿線進度(公尺,從己方端起算);領隊在 off 出主堡,其餘往堡內列隊錯開
          const prog = off - i * 6;
          const d = side === 'SWARM' ? prog : total - prog;
          const [sx, sz] = pointAt(pts, cum, Math.max(0, Math.min(total, d)));
          this._add({
            kind, side, lane: li, wv: this.wave,
            x: sx + jx, z: sz + jz,
            y: kind === 'heli' ? GAME.HELI_ALT : 0,
            hp: UNITS[kind].hp,
            prog,
          });
        });
      }
    }
    this.events.push({ e: 'wave', n: this.wave });
  }

  /** 主堡兩門大砲:各自冷卻、獨立索敵,砲塔級射程/傷害(數值 derive 自 tower,見 data.js)。 */
  _tickBaseGuns(e, g, dt) {
    e.gunCd ??= new Array(g.n).fill(0);
    const gu = { range: g.range };   // _acquireTarget 只讀 range / wid
    for (let i = 0; i < g.n; i++) {
      e.gunCd[i] = Math.max(0, e.gunCd[i] - dt);
      if (e.gunCd[i] > 0) continue;
      const target = this._acquireTarget(e, gu);
      if (!target) continue;
      e.gunCd[i] = 1 / g.rate;
      this._damage(target, g.dmg, e, 0);
      const off = i === 0 ? 10 : -10;   // 左右兩門砲口錯開射源(客戶端曳光管)
      // gi = 第幾門砲:客戶端把該門砲管轉向目標、曳光自實際砲口射出
      this.events.push({
        e: 'shot', id: e.id, kind: 'base', gi: i, from: [e.x + off, e.z], to: [target.x, target.z],
        ty: (target.hero || target.decoy || target.kind === 'heli') ? Math.round(target.y || 0) : 0,
        side: e.side,
      });
    }
  }

  _acquireTarget(e, u) {
    let best = null, bestD = Infinity;
    const wd = u.wid ? WEAPONS[u.wid] : null;
    for (const t of this.ents.values()) {
      if (t.side === e.side || t.neutral || t.hp <= 0) continue;   // 中立障礙不當目標
      if (e.tp && t.tp) continue;   // 第三方不打第三方(游擊隊/民兵互不為敵,只防衛正規軍)
      if (t.gar) continue;   // 駐守碉堡中的第三方步槍兵:躲在工事裡,不可鎖定
      if (t.hero && (t.dead || (t.stealthUntil || 0) > this.t)) continue;   // 匿蹤英雄不被鎖定
      // 高空飛行單位難以直射鎖定:天花板 = min(射程×0.9, GUN_CEIL_M) —— 與射程脫鉤,
      // 塔射程拉到 310 也不會把高空無人機從 SAM 手上搶走(#INC-104 的 y=250 仍在天花板之上)
      if ((t.kind === 'drone' || t.kind === 'heli' || t.kind === 'morph')
        && (t.y || 0) > Math.min(u.range * 0.9, GAME.GUN_CEIL_M)) continue;
      let d = dist2d(e.x, e.z, t.x, t.z);
      if (d > u.range * this._altRange(e, t, wd)) continue;   // 高度制空:地面槍械對高空無人機縮短射程
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
    // 前方卡住的同陣營單位(如被障礙擋住減速者):側移繞過,不疊在一起
    const UNIT_PUSH_R = 4.5;
    for (const o of this.ents.values()) {
      if (o === e || o.side !== e.side || o.lane !== e.lane || o.hero || o.neutral) continue;
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
    if (e.hero) {
      o.pid = e.pid; o.y = Math.round((e.y || 0) * 10) / 10; o.ry = Math.round((e.ry || 0) * 100) / 100;
      o.dead = e.dead; if (e.dead) o.rs = Math.max(0, Math.round(e.respawnAt - this.t));
      o.ch = e.ch;                                               // 角色(客戶端渲染專屬機體)
      o.sp = Math.round(e.sp); o.msp = e.maxSp;                  // 護盾(雙層 HP 第一層)
      o.si = e.si || 0;                                          // 小隊機位(HUD 三機狀態列)
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
        o.ab = { ...e.abil }; o.kn = e.kn;                        // 招式階級 / 擊殺數
        o.cds = [Math.max(0, Math.round((e.acd.skill - this.t) * 10) / 10),
                 Math.max(0, Math.round((e.acd.ult - this.t) * 10) / 10)];   // 招式冷卻倒數
      }
      // 變形機甲餌機:掛點狀態(0 = 已分離/重組中,1 = 已組合就緒)+ 冷卻倒數(HUD / 組合動畫)
      if (e.sq && e.kind === 'morph') {
        o.dcd = Math.max(0, Math.round((e.sq.decoyCd - this.t) * 10) / 10);
        o.dc = !e.sq.decoy && o.dcd === 0 ? 1 : 0;
      }
      // 非變形機甲:重砲模式冷卻倒數(HUD)—— 只跟主視野機發一份
      if (o.act && e.kind === 'robot') o.bcd = Math.max(0, Math.round(((e.barrageCd || 0) - this.t) * 10) / 10);
      // 無人機護衛自殺機:CD 倒數(HUD;歸零 = 兩架護衛機重現)—— 只跟主視野機發一份
      if (o.act && e.sq && e.kind === 'drone') o.kcd = Math.max(0, Math.round((e.sq.kamiCd - this.t) * 10) / 10);
      if ((e.empUntil || 0) > this.t) o.emp = Math.round((e.empUntil - this.t) * 10) / 10;
      if ((e.stealthUntil || 0) > this.t) o.st = Math.round((e.stealthUntil - this.t) * 10) / 10;
      // 控場/追加效果剩餘秒(客戶端自鎖移動 / HUD;條件欄位,讀取端一律 || 0)
      if ((e.stunUntil || 0) > this.t) o.pz = Math.round((e.stunUntil - this.t) * 10) / 10;
      if ((e.slowUntil || 0) > this.t) { o.sl = Math.round((e.slowUntil - this.t) * 10) / 10; o.slf = e.slowF ?? 0.6; }
      if ((e.confUntil || 0) > this.t) o.cf = Math.round((e.confUntil - this.t) * 10) / 10;
      if ((e.markUntil || 0) > this.t) o.mk = Math.round((e.markUntil - this.t) * 10) / 10;
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
    for (const h of this.heroes.values()) fp = (fp * 31 + (h.aiming ? 2 : 0) + (h.dead ? 1 : 0)) | 0;
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
/** 第 n 波的出兵間隔:前期慢,RAMP_FROM→RAMP_TO 之間線性加速到 MIN_S */
export function waveInterval(n) {
  const P = GAME.WAVE_PACE;
  const t = Math.max(0, Math.min(1, (n - P.RAMP_FROM) / (P.RAMP_TO - P.RAMP_FROM)));
  return P.START_S + (P.MIN_S - P.START_S) * t;
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
