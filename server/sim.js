// ============ 戰場模擬(伺服器權威)============
// DOTA 式三路兵線:小兵(步兵/裝甲車/坦克)沿真實道路路徑推進,
// 防禦塔與主堡自動迎擊;英雄(無人機/機甲)位置由客戶端回報、
// 血量與傷害由伺服器結算。座標系:以戰場中心為原點的公尺平面
// (x 東、z 北;y 高度只在客戶端管,模擬是 2D 平面 + 兵線路徑)。
import {
  SIDES, OTHER_SIDE, UNITS, GAME, WEAPONS, ECON, HAZARDS, FIELD, LOOT, AFFIXES, MAPGEO,
  CHARACTERS, charsOf, heroKindOf, heroWeapon, heroAbility, PROG, VITALS, armorMul, killScore,
  vsMult, upgradePrice, laneTacticsXZ, SQUAD, MORPH, LOCK, DECOY, decoyBlast, BOT_KILL_SCORE, isBotId,
  dmgFalloff, blastFalloff, battleBBox,
} from '../public/js/data.js';

let nextEntId = 1;

// 小隊共用的「玩家狀態」:一名玩家不論操控幾架機體,經濟/電力/彈藥/招式只有一份。
// 三架機體各自是獨立 ent(有自己的 hp/護盾/座標/死亡狀態),但這些欄位透過
// getter/setter 指回同一個 sq.ps —— 讓既有的 h.money / h.abil / h.ammo 全部原樣可用。
const SQUAD_SHARED = [
  'money', 'upg', 'ammo', 'reloadUntil', 'fireAt', 'buffs', 'mp', 'maxMp', 'mpRegen',
  'abil', 'acd', 'kn', 'mods', 'empUntil', 'stealthUntil', 'aiming', 'lastBurst',
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

export class BattleSim {
  /**
   * battleConfig(由房主客戶端在選址後送上來):
   * { center:{lat,lng}, bases:{SWARM:[lat,lng], STEEL:[lat,lng]},
   *   lanes:[[ [lat,lng],... ] ×3], sizeM, diagM, distM }
   */
  constructor(config) {
    this.config = config;
    this.center = config.center;
    this.t = 0;                       // 經過秒數
    this.wave = 0;
    this.nextWaveAt = GAME.FIRST_WAVE_DELAY_S;
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

    this._spawnStructures();
    this._seedField();
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
    this.hazBlockers = [];   // 阻擋型座標(牆段間距檢查用)
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
      const wallStart = this.hazBlockers.length;   // 牆內可緊靠,牆之間才查縫隙
      for (let k = 0; k < n && placed < want; k++) {
        const x = p.x + p.nx * dir * off + (Math.random() - 0.5) * def.r * 3;
        const z = p.z + p.nz * dir * off + (Math.random() - 0.5) * def.r * 3;
        if (!this._hazOk(x, z, def, wallStart)) continue;
        const sc = Math.round((0.75 + Math.random() * 0.6) * 100) / 100;   // 每次生成隨機差異化
        this._add({
          kind: type, side: null, neutral: true, haz: true, x, z, sc,
          hp: def.hp ? Math.round(def.hp * sc) : 1, inv: !def.hp,
        });
        if (def.block) this.hazBlockers.push([x, z, def.r * sc]);
        placed++;
      }
    }
  }

  /** 中立物散布的越界防線:含半徑 r 整體落在地形(空氣牆內)才准放 */
  _inBounds(x, z, r = 0) {
    const b = this.bounds;
    return x - r >= b.minX && x + r <= b.maxX && z - r >= b.minZ && z + r <= b.maxZ;
  }

  _hazOk(x, z, def, wallStart = Infinity) {
    const F = FIELD;
    if (!this._inBounds(x, z, def.r)) return false;                  // 不落在地形外/空氣牆外
    if (this._distToLanes(x, z) < F.HAZ_LANE_MIN) return false;      // 不擋正規路線
    for (const side of ['SWARM', 'STEEL']) {
      const [bx, bz] = this.basePos[side];
      if (dist2d(x, z, bx, bz) < F.HAZ_BASE_CLEAR) return false;
    }
    if (def.block) {
      const upto = Math.min(wallStart, this.hazBlockers.length);
      for (let i = 0; i < upto; i++) {
        const [ox, oz] = this.hazBlockers[i];
        if (dist2d(x, z, ox, oz) < F.HAZ_GAP) return false;          // 保證通行縫隙
      }
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
    // 塔距守衛:兵線可能 90°(或更銳)急彎 ⇒ 沿線距離拉得再開,兩座敵對塔的**直線距離**
    // 仍可能落在彼此射程內。做法 —— 先按 TOWER_FRACS 算出塔位,再逐塔往己方主堡收
    // (每次 −0.01 frac),直到與**所有**敵方塔的直線距離 > tower.range × TOWER_SEP_F。
    // MUST 用直線距離判定,沿線距離會被急彎騙過去。
    const SEP = UNITS.tower.range * GAME.TOWER_SEP_F;
    const site = (li, side, frac) => {
      const pts = this.lanes[li], cum = cumLen(pts), total = cum[cum.length - 1];
      const d = side === 'SWARM' ? total * frac : total * (1 - frac);
      const [x, z] = pointAt(pts, cum, d);
      const [ax, az] = pointAt(pts, cum, Math.max(0, d - 1));
      const [bx, bz] = pointAt(pts, cum, Math.min(total, d + 1));
      const len = Math.hypot(bx - ax, bz - az) || 1;
      return { x, z, nx: (bz - az) / len, nz: -(bx - ax) / len };
    };
    // 左右兩座塔各偏移 TOWER_SIDE_OFF ⇒ 兩個塔位中心的最壞塔對塔距離要再讓開 2×
    const need = SEP + GAME.TOWER_SIDE_OFF * 2;
    const placed = [];   // { side, x, z }:已定案的塔位中心
    for (let li = 0; li < this.lanes.length; li++) {
      for (const frac0 of GAME.TOWER_FRACS) {
        // 雙方同步後退(對稱):任一側單獨退會讓地圖偏心
        let frac = frac0, pS = site(li, 'SWARM', frac), pT = site(li, 'STEEL', frac);
        const clash = () => dist2d(pS.x, pS.z, pT.x, pT.z) < need
          || placed.some((q) => (q.side === 'STEEL' && dist2d(pS.x, pS.z, q.x, q.z) < need)
                             || (q.side === 'SWARM' && dist2d(pT.x, pT.z, q.x, q.z) < need));
        while (frac > GAME.TOWER_MIN_FRAC && clash()) {
          frac -= 0.01;
          pS = site(li, 'SWARM', frac);
          pT = site(li, 'STEEL', frac);
        }
        for (const [side, p] of [['SWARM', pS], ['STEEL', pT]]) {
          placed.push({ side, x: p.x, z: p.z });
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
    const [bx, bz] = this.basePos[side];
    // 同陣營多英雄:繞主堡錯開出生點,避免疊在一起
    const ang = idx * (Math.PI * 2 / 5);
    const ox = bx + Math.cos(ang) * 30 * Math.min(idx, 1);
    const oz = bz + Math.sin(ang) * 30 * Math.min(idx, 1);
    const mp = Math.round(u.mp * (m.mp ?? 1));
    const sq = {
      pid, side, ch, kind, act: 0, bodies: [],
      lock: 0, lockAt: -99,          // 準星鎖定(光暈 / 被鎖定警告 / 無人機自爆衝刺目標)
      decoy: null, decoyCd: 0,       // 機甲餌機:目前在空中的那架 / 掛點重新組合完成的時刻
      ps: {                          // 共用玩家狀態(見 SQUAD_SHARED)
        money: ECON.START, upg: { dmg: 0, hull: 0 },
        ammo: {}, reloadUntil: {}, fireAt: {}, buffs: {},
        mp, maxMp: mp, mpRegen: u.mpRegen,
        abil: { light: 1, heavy: 1, skill: 0, ult: 0 },
        acd: { skill: 0, ult: 0 }, kn: 0,
        mods: [],                    // 招式增益 [{k, m, until}]
        empUntil: 0, stealthUntil: 0, aiming: false, lastBurst: 0,
      },
    };
    const n = kind === 'drone' ? SQUAD.N : 1;
    for (let i = 0; i < n; i++) {
      const b = this._add({
        kind, side, pid, ch, si: i, spawnIdx: idx,
        x: ox + i * 12, z: oz + i * 6, y: 0, ry: 0,
        hp: Math.round(u.hp * (m.hp ?? 1)), hero: true,
        dead: false, respawnAt: 0, deaths: 0, aaCd: 0,
        // 雙層 HP:護盾(脫戰自然回復)+ 裝甲(hp;護甲值 armor 減免)
        armor: m.armor ?? 0, lastHitAt: -99,
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
    if (!t || t.neutral || t.side === sq.side || t.hp <= 0 || (t.hero && t.dead)) return;
    // 射程閘門:用玩家當下手上那把武器(瞄準中 = 重武器),留與 heroHit 同一份彈道寬容
    const wp = this._heroWeapon(h, h.aiming ? 'heavy' : 'light');
    if (!wp) return;
    const ty = t.hero || t.kind === 'heli' || t.decoy ? (t.y || 0) : 0;
    if (Math.hypot(t.x - h.x, t.z - h.z, ty - (h.y || 0)) > wp.def.range * 1.25) return;
    // 迷霧內的目標不可鎖定(與 heroHit 同一條規則:看不見 = 沒有火控解)
    const pulse = this.visionUntil?.[h.side] > this.t;
    if (!pulse && !this._visibleTo(t, h.side, this._visionSources(h.side))) return;
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

  /**
   * 開火判定:射速上限、填彈中禁射、彈夾耗盡自動填彈。
   * lenient=true 給網路延遲寬容(真人客戶端);bot 用嚴格射速。
   */
  _gateFire(h, id, def, lenient) {
    const now = this.t;
    // 填彈完成 → 補滿
    if ((h.reloadUntil[id] || 0) > 0 && now >= h.reloadUntil[id]) {
      h.ammo[id] = def.mag;
      h.reloadUntil[id] = 0;
    }
    if ((h.reloadUntil[id] || 0) > now) return false;              // 填彈中
    if (now - (h.fireAt[id] || 0) < 1 / (def.rate * (lenient ? 1.5 : 1))) return false;
    if (h.ammo[id] == null) h.ammo[id] = def.mag;
    if (h.ammo[id] <= 0) { h.reloadUntil[id] = now + def.reload * this._buffMul(h, 'reload'); return false; }
    h.fireAt[id] = now;
    h.ammo[id]--;
    if (h.ammo[id] <= 0) h.reloadUntil[id] = now + def.reload * this._buffMul(h, 'reload');  // 打空自動填彈
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
    h.reloadUntil[wp.id] = this.t + wp.def.reload * this._buffMul(h, 'reload');
  }

  /** 英雄傷害倍率(火力升級 × 招式增益) */
  _heroDmg(h, def, targetKind) {
    return def.dmg * vsMult(def, targetKind)
      * (1 + ECON.UPGRADES.dmg.step * (h.upg?.dmg || 0))
      * this._buffMul(h, 'dmg');
  }

  /** 爆擊擲骰(FPS:直擊武器限定,AoE 不爆);爆中推事件給客戶端跳橘字 */
  _rollCrit(h, def, dmg, t) {
    if (!def.crit || Math.random() >= def.crit) return dmg;
    const v = dmg * (def.critX || VITALS.CRIT_X);
    this.events.push({ e: 'crit', pid: h.pid, x: t.x, z: t.z, y: t.hero ? (t.y || 0) : 0, v: Math.round(v) });
    return v;
  }

  /** 命中附帶 EMP(訊號矛/諧振波炮之類):敵方英雄武器短暫離線 */
  _applyHitEmp(h, def, t) {
    if (def.emp && t.hero) t.empUntil = Math.max(t.empUntil || 0, this.t + def.emp);
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

  heroPos(pid, x, y, z, ry) {
    const h = this.heroes.get(pid);
    if (!h || h.dead || this.over) return;
    h.x = x; h.y = y; h.z = z; h.ry = ry;
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
    if (!h || h.dead || !t || t.side === h.side || this.over) return;
    if (this._jammed(h)) return;   // 電磁癱瘓:武器離線
    const wp = this._heroWeapon(h, w);
    if (!wp || !wp.def.rate) return;
    if (wp.def.needAim && !h.aiming) return;   // 重武器需瞄準模式才能開火
    // 射程驗證(3D:高空狙擊也要吃射程;留 25% 寬容給網路延遲/彈道飛行)
    const d3 = Math.hypot(h.x - t.x, h.z - t.z, (h.y || 0) - (t.hero ? (t.y || 0) : 0));
    if (d3 > wp.def.range * 1.25) return;
    // 迷霧內的目標不可命中:射手陣營看不見(非瞄準模式看不到)就打不到 —
    // 塔/主堡/中立恆可見;偵察脈衝生效中該方視同無霧(與 snapshotFor 同判定)。
    const pulse = this.visionUntil?.[h.side] > this.t;
    if (!pulse && !this._visibleTo(t, h.side, this._visionSources(h.side))) return;
    if (!this._gateFire(h, wp.id, wp.def, true)) return;
    // 物理衰減:動能存速 / 大氣消光,按實際射擊距離折傷害(dmgFalloff 依 type 分模型)
    const dmg = this._rollCrit(h, wp.def, this._heroDmg(h, wp.def, t.kind) * dmgFalloff(wp.def, d3), t);
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
      if (d3 > def.range * 1.25) continue;
      this.events.push({ e: 'shot', from: [b.x, b.z], to: [t.x, t.z], side: b.side });
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
      m.hp -= wp.def.dmg * (1 + ECON.UPGRADES.dmg.step * h.upg.dmg) * dmgFalloff(wp.def, bd);
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
    if (d3 > wp.def.range) return false;
    if (!this._gateFire(h, wp.id, wp.def, false)) return false;
    h._shotN = (h._shotN || 0) + 1;
    if (h._shotN % 3 === 0) this.events.push({ e: 'shot', from: [h.x, h.z], to: [t.x, t.z], side: h.side });
    const dmg = this._rollCrit(h, wp.def, this._heroDmg(h, wp.def, t.kind) * dmgFalloff(wp.def, d3), t);
    this._applyHitEmp(h, wp.def, t);
    this._damage(t, dmg, h, wp.def.pen);
    this._echo(h, t, wp.def);
    return true;
  }

  /**
   * 重武器(launcher 型)著彈:落點由客戶端彈道回報,
   * CD(mag=1 + reload=cd)/瞄準/射程/電磁癱瘓皆伺服器把關。
   */
  heroBurst(pid, x, z) {
    const h = this.heroes.get(pid);
    if (!h || h.dead || this.over) return;
    if (this._jammed(h)) return;
    const wp = this._heroWeapon(h, 'heavy');
    if (!wp || (wp.def.type !== 'launcher' && wp.def.type !== 'missile')) return;   // 飛彈也是 AoE 戰鬥部
    if (wp.def.needAim && !h.aiming) return;
    if (dist2d(h.x, h.z, x, z) > wp.def.range * 1.15) return;   // 著彈點超程(留彈道寬容)
    if (!this._gateFire(h, wp.id, wp.def, true)) return;
    h.lastBurst = this.t;
    this.events.push({ e: 'boom', x, z, r: wp.def.r, side: h.side });
    this._blast(h, wp.def, x, z, 0);
    // 僚機同步齊射同一個落點(單發只畫一次爆炸,傷害疊三份 1/3)
    for (const b of this._bodies(h)) {
      if (b === h || b.dead) continue;
      if (dist2d(b.x, b.z, x, z) > wp.def.range * 1.15) continue;
      this._blast(b, wp.def, x, z, 0);
    }
  }

  /**
   * 電漿扇形攻擊(type:'plasma'):客戶端只回報射向(dx,dz 為 sim 座標單位向量),
   * 命中判定全在伺服器 — 射程內、水平夾角 ≤ arc、迷霧可見的敵方單位全數受創
   * (× 電漿消散衰減)。小隊僚機以各自位置沿同射向齊噴,彈藥/射速只扣一份。
   */
  heroPlasma(pid, dx, dz) {
    const h = this.heroes.get(pid);
    if (!h || h.dead || this.over || !Number.isFinite(dx) || !Number.isFinite(dz)) return;
    if (this._jammed(h)) return;
    const wp = this._heroWeapon(h, 'heavy');
    if (!wp || wp.def.type !== 'plasma') return;
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
        if (t.side === h.side || (t.hero && t.dead)) continue;
        const tx = t.x - b.x, tz = t.z - b.z;
        const d2 = Math.hypot(tx, tz);
        const d3 = Math.hypot(d2, (b.y || 0) - (t.hero ? (t.y || 0) : 0));
        if (d3 > wp.def.range * 1.25) continue;
        // 圓錐判定取水平夾角;目標近乎正下/正上方(d2 極小)視為在錐內
        if (d2 > 8 && (tx * dx + tz * dz) / d2 < cosA) continue;
        if (!pulse && !this._visibleTo(t, h.side, src)) continue;
        this._damage(t, this._heroDmg(b, wp.def, t.kind) * dmgFalloff(wp.def, d3), b, wp.def.pen);
      }
    }
    this.events.push({ e: 'plasma', pid, side: h.side, x: h.x, z: h.z, y: h.y || 0,
      dx, dz, r: wp.def.range, arc: wp.def.arc || 15 });
  }

  /**
   * 無人機重型炸彈:F 鍵必須有準星鎖定的敵方目標才會動作 — 主視野機引爆、
   * 僚機朝鎖定目標衝刺直到引爆;沒鎖定 = 完全不動作(不再原地白白自爆)。
   * 高速撞擊(crash)是物理引爆,不吃鎖定閘門。
   * 爆風走 _blast(同陣營一律跳過)→ 不會炸到友軍。
   */
  heroDetonate(pid, crash = false) {
    const h = this.heroes.get(pid);
    if (!h || h.dead || h.kind !== 'drone' || this.over) return;
    if (crash) { this._boom(h); return; }   // 撞擊引爆:FPV 神風,不需鎖定
    const t = this._lockedTarget(h.sq);
    if (!t) return;                          // 無鎖定 → 不動作
    for (const b of h.sq.bodies) if (b !== h && !b.dead) b.dash = t.id;
    this._boom(h);   // 主視野機引爆(_kill 內部會把主視野讓給存活僚機)
  }

  /** 目前仍有效的準星鎖定目標(存活、敵方、未過期);沒有 → null */
  _lockedTarget(sq) {
    if (this.t - sq.lockAt > LOCK.TTL) return null;
    const t = this.ents.get(sq.lock);
    if (!t || t.hp <= 0 || t.side === sq.side || (t.hero && t.dead)) return null;
    return t;
  }

  /** 單機自毀引爆:不給任何一方擊殺數 */
  _boom(b) {
    const def = WEAPONS[UNITS.drone.bomb];
    this.events.push({ e: 'boom', x: b.x, z: b.z, y: b.y || 0, r: def.r, side: b.side });
    this._blast(b, def, b.x, b.z, b.y || 0);
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
    if (!h || h.dead || h.kind === 'drone' || this.over) return;
    const sq = h.sq;
    if (sq.decoy || this.t < sq.decoyCd) return;
    const t = this._lockedTarget(sq);
    const ry = h.ry || 0;
    const d = this._add({
      kind: 'decoy', side: h.side, pid, decoy: true,
      x: h.x, z: h.z, y: (h.y || 0) + DECOY.ALT, ry,
      hp: Math.max(1, Math.round(h.maxHp * DECOY.HP_F)),
      armor: 0, tid: t ? t.id : 0, lost: false, dieAt: this.t + DECOY.TTL_S,
    });
    sq.decoy = d;
    sq.decoyCd = this.t + DECOY.CD_S;
    this.events.push({ e: 'decoy', pid, side: h.side, id: d.id, homing: t ? 1 : 0 });
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

  /** 餌機自爆:爆風算在主機甲頭上(吃它的火力升級 / 招式增益,擊殺也記給它) */
  _decoyBoom(d) {
    const sq = this.squads.get(d.pid);
    const owner = sq ? sq.bodies[sq.act] : null;
    this.events.push({ e: 'boom', x: d.x, z: d.z, y: d.y, r: DECOY.R, side: d.side });
    if (owner) this._blast(owner, decoyBlast(), d.x, d.z, d.y);
    this._removeDecoy(d);
  }

  _removeDecoy(d) {
    this.ents.delete(d.id);
    const sq = this.squads.get(d.pid);
    if (sq && sq.decoy === d) sq.decoy = null;
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
    if (!A || h.mp < A.mp) return;                     // 電力不足
    // 指向型招式:目標點夾在射程內(FPS/DOTA 施法距離)
    if (A.range && x != null) {
      const d = dist2d(h.x, h.z, x, z);
      if (d > A.range) {
        x = h.x + (x - h.x) / d * A.range;
        z = h.z + (z - h.z) / d * A.range;
      }
    } else { x = h.x; z = h.z; }
    h.mp -= A.mp;
    h.acd[slot] = this.t + A.cd;
    if (A.fx !== 'stealth' && A.fx !== 'vision') h.stealthUntil = 0;   // 出手即現形
    // 一隊只回傳主視野那架當代表:招式增益(mods)是小隊共用的,推三次會疊三倍
    const allies = (r) => [...this.heroes.values()].filter((a) =>
      a.side === h.side && !a.dead && (a === h || dist2d(a.x, a.z, h.x, h.z) <= r));

    if (A.fx === 'buff') {
      const targets = A.target === 'team' ? allies(A.r || 0) : [h];
      for (const a of targets) {
        for (const [k, m] of Object.entries(A.mul || {})) a.mods.push({ k, m, until: this.t + A.dur });
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
        this._blast(h, { dmg: A.dmg, r: A.r, vs: A.vs, pen: A.pen }, ix, iz, 0);
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

  /** 爆炸範圍傷害(3D 距離:高空引爆炸不到地面;只傷敵方;AoE 不吃爆擊)。
   *  外圍傷害走 blastFalloff:核心全傷、超壓隨距離連續衰減到 1.8r 歸零(物理化舊二段式)。 */
  _blast(h, def, x, z, y) {
    for (const t of [...this.ents.values()]) {
      if (t.side === h.side || (t.hero && t.dead)) continue;
      const d = Math.hypot(x - t.x, z - t.z, y - (t.hero || t.decoy ? (t.y || 0) : 0));
      const f = blastFalloff(def.r, d);
      if (f > 0) this._damage(t, this._heroDmg(h, def, t.kind) * f, h, def.pen);
    }
  }

  // ---------- 經濟:購買(通用升級 + 招式升級;招式要擊殺數 + 金錢)----------
  /** item: 'dmg'|'hull' 或 'ab:light'|'ab:heavy'|'ab:skill'|'ab:ult'。回傳錯誤訊息或 null */
  buy(pid, item) {
    const h = this.heroes.get(pid);
    // 陣亡等待重生也能購買(DOTA 慣例;重生點/死亡畫面補升級)
    if (!h || this.over) return '目前無法購買';
    const up = ECON.UPGRADES[item];
    if (up) {
      const lvl = h.upg[item] || 0;
      if (lvl >= up.max) return `${up.name} 已滿級`;
      const price = upgradePrice(up, lvl);
      if (h.money < price) return `資金不足(${up.name} 需 $${price})`;
      h.money -= price;
      h.upg[item] = lvl + 1;
      if (item === 'hull') {
        const nm = Math.round(UNITS[h.kind].hp * (CHARACTERS[h.ch].mods?.hp ?? 1) * (1 + up.step * h.upg.hull));
        for (const b of this._bodies(h)) {       // 機殼升級套用到小隊每一架
          if (!b.dead) b.hp += nm - b.maxHp;     // 陣亡中只擴上限,重生時 hp = maxHp
          b.maxHp = nm;
        }
      }
      this.events.push({ e: 'buy', pid, item, lvl: h.upg[item] });
      return null;
    }
    if (item?.startsWith?.('ab:')) {
      const slot = item.slice(3);
      const prog = PROG[slot];
      const a = CHARACTERS[h.ch]?.[slot];
      if (!prog || !a) return '沒有這項招式';
      const cur = h.abil[slot] || 0;
      if (cur >= 3) return `${a.name} 已滿階`;
      const needK = prog.kills[cur];
      const cost = prog.cost[cur];
      if (h.kn < needK) return `擊殺數不足(${a.name} Lv.${cur + 1} 需 ${needK} 擊殺,目前 ${h.kn})`;
      if (h.money < cost) return `資金不足(${a.name} Lv.${cur + 1} 需 $${cost})`;
      h.money -= cost;
      h.abil[slot] = cur + 1;
      // 輕/重武器升階可能加大彈夾:清空計數,_gateFire 下次視為新彈夾
      if (slot === 'light' || slot === 'heavy') { delete h.ammo[slot]; h.reloadUntil[slot] = 0; }
      this.events.push({ e: 'buy', pid, item, lvl: h.abil[slot] });
      return null;
    }
    return '沒有這項商品';
  }

  // ---------- 傷害 / 擊殺(FPS × DOTA:護盾 → 裝甲,護甲值曲線減免,破甲抵銷)----------
  _damage(t, dmg, by, pen = 0) {
    if (this.over || t.hp <= 0 || t.inv) return;   // inv = 不可摧毀障礙(塌陷/坍方/火場/淹水)
    // 攻堅需兵線配合:附近沒有己方小兵時,打主堡傷害折減
    if (t.kind === 'base' && by && by.side) {
      const near = [...this.ents.values()].some((e) =>
        e.side === by.side && !e.hero && !e.neutral
        && dist2d(e.x, e.z, t.x, t.z) < 320);
      if (!near) dmg *= GAME.BASE_ARMOR_NEED_CREEP;
    }
    if (t.hero) {
      dmg *= this._buffMul(t, 'dmgTaken');   // 複合裝甲詞綴 / 護盾類招式
      t.lastHitAt = this.t;                  // 進入戰鬥:護盾回復重新計時
      // 第一層護盾先吃(能量護盾不吃護甲減免)
      const toShield = Math.min(t.sp || 0, dmg);
      t.sp = (t.sp || 0) - toShield;
      let rem = dmg - toShield;
      if (rem <= 0) return;
      // 第二層裝甲:護甲值減免(破甲抵銷)
      dmg = rem * armorMul(t.armor, pen);
    } else {
      dmg *= armorMul(UNITS[t.kind]?.armor ?? 0, pen);
    }
    t.hp -= dmg;
    if (t.hp <= 0) {
      t.hp = 0;
      this._kill(t, by);
    }
  }

  _kill(t, by) {
    const bySide = by?.side || null;
    this.events.push({ e: 'die', id: t.id, kind: t.kind, x: t.x, z: t.z, side: t.side, ...(t.hero || t.decoy ? { pid: t.pid } : {}) });
    // 擊殺賞金:高價值單位報酬越高(自毀/中立傷害不給錢)
    if (by && by.hero && bySide !== t.side) {
      by.money += (ECON.BOUNTY[t.kind] || 0) * this._buffMul(by, 'bounty');
      // 擊殺數:招式解鎖/升級的門檻。電腦玩家(bot)只算 BOT_KILL_SCORE 分,不能靠刷 bot 速成。
      if (!t.neutral) by.kn += (t.hero && isBotId(t.pid)) ? BOT_KILL_SCORE : killScore(t.kind);
      // 汲能核心詞綴:擊殺(非中立)回復上限血量比例
      if (!t.neutral && !by.dead) {
        for (const id in by.buffs || {}) {
          if (by.buffs[id] > this.t && AFFIXES[id]?.killHeal) {
            by.hp = Math.min(by.maxHp, by.hp + by.maxHp * AFFIXES[id].killHeal);
          }
        }
      }
    }
    if (t.decoy) {   // 餌機被擊落:誘餌任務達成,不引爆(引爆只在自爆/近炸)
      this._removeDecoy(t);
      return;
    }
    if (t.hero) {
      t.dead = true;
      t.dash = 0;
      if (this._aliveN(t) === 0) t.aiming = false;   // 小隊全滅才收瞄準(aiming 是共用狀態)
      this.stats[t.side].deaths++;
      if (bySide && bySide !== t.side) this.stats[bySide].kills++;
      // 重生冷卻:每一架各自計數(小隊三架共用陣營死亡數會讓 CD 三倍速膨脹)
      const r = UNITS[t.kind].respawn;
      t.deaths = (t.deaths || 0) + 1;
      const dn = t.sq && t.sq.bodies.length > 1 ? t.deaths : this.stats[t.side].deaths;
      t.respawnAt = this.t + r.base + r.perDeath * dn;
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
      }
      // Diablo 式隨機掉落:擊毀障礙有機率掉戰場物資(TreasureClass:越硬掉越高階)
      const def = HAZARDS[t.kind];
      if (def?.salvage && Math.random() < def.salvage) {
        this._spawnLoot(t.x, t.z, Math.min(1, (t.maxHp || 0) / LOOT.TC.HP_REF));
      }
      if (t.kind === 'fire') this._fires = this._fires.filter((f) => f !== t);
      return;
    }
    if (bySide && by.hero && bySide !== t.side) this.stats[bySide].creepKills += UNITS[t.kind]?.bounty || 1;
    this.ents.delete(t.id);
    if (t.kind === 'base') {
      this.over = true;
      this.winner = OTHER_SIDE[t.side];
      this.events.push({ e: 'gameOver', winner: this.winner });
    }
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
    // 波次凝聚錨點(上一 tick 的交戰狀態):每 tick 算一次,_advance 查表
    this._anchors = this._waveAnchors();

    // 小隊層級(每名玩家一次):被動收入 / 電力回充 — money/mp 是三架共用的
    for (const h of this.heroes.values()) {
      h.money += ECON.INCOME_PER_S * dt;
      if (this._aliveN(h) > 0) h.mp = Math.min(h.maxMp, h.mp + h.mpRegen * dt);
    }
    // 機體層級:重生 / 護盾脫戰回復 / 主堡修裝甲
    for (const sq of this.squads.values()) {
      for (const b of sq.bodies) {
        if (b.dead) {
          if (this.t >= b.respawnAt && this._tickN > (b.deadTick || 0) + 1) this._respawn(b);
          continue;
        }
        // 護盾:脫戰(OOC_S 秒沒受擊)自然回復;裝甲只能回主堡 / 治療招式
        if (b.sp < b.maxSp && this.t - b.lastHitAt > VITALS.OOC_S) {
          b.sp = Math.min(b.maxSp, b.sp + b.maxSp * VITALS.SP_REGEN_PS * dt);
        }
        if (b.hp < b.maxHp) {
          const [bx, bz] = this.basePos[b.side];
          if (dist2d(b.x, b.z, bx, bz) < GAME.HERO_HEAL_RADIUS) {
            b.hp = Math.min(b.maxHp, b.hp + UNITS[b.kind].regen * dt);
          }
        }
      }
      if (this.heroes.get(sq.pid).dead) this._promote(sq);   // 全滅後第一架回歸 → 接管主視野
    }
    this._tickSquads(dt);
    this._tickDecoys(dt);
    this._tickMines();
    this._tickAmbush(dt);
    this._tickRelays(dt);
    this._tickHazards(dt);

    // 小兵 / 塔 / 主堡行為
    this._structs = [...this.ents.values()].filter((s) => s.kind === 'tower' || s.kind === 'base');
    for (const e of [...this.ents.values()]) {
      // 餌機:位置由 _tickDecoys 管、自己不開火,但仍是敵方小兵/塔的合法目標(誘餌本體)
      if (e.hero || e.neutral || e.decoy || e.hp <= 0) continue;
      const u = UNITS[e.kind];
      e.cd = Math.max(0, e.cd - dt);
      if (u.sam) this._tryLaunchSam(e, u.sam, dt);
      const target = this._acquireTarget(e, u);
      e._eng = !!target;   // 交戰中的不當凝聚錨點(否則整波卡在原地等它)
      if (target) {
        // 電磁癱瘓(EMP 招式):單位武器離線,仍可移動;建築免疫(heroCast 不標記建築)
        if (e.cd === 0 && !((e.empUntil || 0) > this.t)) {
          e.cd = 1 / u.rate;
          this._damage(target, u.dmg, e, WEAPONS[u.wid]?.pen || 0);
          if (e.kind === 'tower' || e.kind === 'base' || e.kind === 'tank') {
            this.events.push({ e: 'shot', from: [e.x, e.z], to: [target.x, target.z], side: e.side });
          }
        }
        continue; // 交戰中不前進
      }
      if (u.speed > 0) this._advance(e, u, dt);
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
    const [bx, bz] = this.basePos[b.side];
    b.x = bx + (b.si || 0) * 12;
    b.z = bz + (b.si || 0) * 6;
    b.y = b.kind === 'drone' ? SQUAD.REGROUP_ALT : 0;
    b.rg = b.kind === 'drone';   // 僚機:先沿標準路線歸隊
    if (soloWipe) {
      b.mp = b.maxMp;
      b.empUntil = 0; b.stealthUntil = 0; b.mods = [];
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
    this._moveTo(b, tx, ty, tz, speed, dt);
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
      // 機甲恆貼地會踩雷;變形機甲只有地面型態(回報高度 y ≈ 0)會踩,飛行型不觸發
      const grounded = h.kind === 'robot' || (h.kind === 'morph' && (h.y || 0) <= MORPH.GROUND_Y);
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
        if (h.dead || (h.y || 0) > fireDef.maxY) continue;
        if (dist2d(h.x, h.z, f.x, f.z) > fireDef.r * (f.sc || 1)) continue;
        this._damage(h, fireDef.dot * dt, null);
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

  // ---------- 防空飛彈(對高空無人機的 3D 追蹤彈)----------
  _tryLaunchSam(e, sam, dt) {
    e.samCd = Math.max(0, (e.samCd ?? 0) - dt);
    if (e.samCd > 0) return;
    let best = null, bestD = Infinity;
    for (const h of this._allBodies()) {   // 小隊每一架都可能被塔 SAM 鎖定
      // 變形機甲飛行型態同樣是防空目標(下方 AA_MIN_ALT 高度閘門擋掉地面型)
      if (h.side === e.side || h.dead || (h.kind !== 'drone' && h.kind !== 'morph')) continue;
      if ((h.stealthUntil || 0) > this.t) continue;      // 匿蹤中不被防空鎖定
      const y = h.y || 0;
      if (y < GAME.AA_MIN_ALT) continue;                 // 低飛交給塔砲
      const d = Math.hypot(h.x - e.x, h.z - e.z, y);
      if (d <= sam.range && d < bestD) { bestD = d; best = h; }
    }
    if (!best) return;
    e.samCd = sam.cd;
    this.missiles.push({
      id: nextEntId++, byId: e.id, side: e.side, tid: best.id, tpid: best.pid,
      x: e.x, z: e.z, y: 18, speed: sam.speed, dmg: sam.dmg, pen: sam.pen, hp: sam.hp, ttl: 12,
      ox: e.x, oy: 18, oz: e.z, range: sam.range,   // 目標飛出塔的防空射程 → 失鎖直飛
    });
    this.events.push({ e: 'sam', from: [e.x, e.z], side: e.side, tpid: best.pid });
  }

  /**
   * 追蹤飛彈。**失鎖規則(2026-07-12,全飛彈通用)**:目標一旦離開「發射源的攻擊範圍」
   * (m.range,以發射點為圓心),飛彈立刻失鎖 → 只沿當下航向直線飛行,不再追擊
   * (still 有近炸引信,撞上算它走運),ttl 到期自毀。飛出射程 = 逃掉了。
   */
  _tickMissiles(dt) {
    for (let i = this.missiles.length - 1; i >= 0; i--) {
      const m = this.missiles[i];
      m.ttl -= dt;
      if (m.ttl <= 0) { this.missiles.splice(i, 1); continue; }
      const step = m.speed * dt;
      // 追蹤特定機體(小隊三架各自可被鎖定;tpid 只給客戶端判斷「是不是在打我」)
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
    }
  }

  _spawnWave() {
    for (let li = 0; li < this.lanes.length; li++) {
      for (const side of ['SWARM', 'STEEL']) {
        const pts = this.lanes[li];
        const start = side === 'SWARM' ? pts[0] : pts[pts.length - 1];
        const comp = [];
        for (let i = 0; i < GAME.WAVE_SOLDIERS; i++) comp.push('soldier');
        comp.push('rocketeer', 'howitzer', 'heli');
        comp.forEach((kind, i) => {
          const jx = (Math.random() - 0.5) * 14, jz = (Math.random() - 0.5) * 14;
          this._add({
            kind, side, lane: li, wv: this.wave,
            x: start[0] + jx, z: start[1] + jz,
            y: kind === 'heli' ? GAME.HELI_ALT : 0,
            hp: UNITS[kind].hp,
            // 沿線進度(公尺,從己方端起算);錯開避免疊隊
            prog: -i * 8,
          });
        });
      }
    }
    this.events.push({ e: 'wave', n: this.wave });
  }

  _acquireTarget(e, u) {
    let best = null, bestD = Infinity;
    const wd = u.wid ? WEAPONS[u.wid] : null;
    for (const t of this.ents.values()) {
      if (t.side === e.side || t.neutral || t.hp <= 0) continue;   // 中立障礙不當目標
      if (t.hero && (t.dead || (t.stealthUntil || 0) > this.t)) continue;   // 匿蹤英雄不被鎖定
      // 高空飛行單位難以直射鎖定:天花板 = min(射程×0.9, GUN_CEIL_M) —— 與射程脫鉤,
      // 塔射程拉到 310 也不會把高空無人機從 SAM 手上搶走(#INC-104 的 y=250 仍在天花板之上)
      if ((t.kind === 'drone' || t.kind === 'heli' || t.kind === 'morph')
        && (t.y || 0) > Math.min(u.range * 0.9, GAME.GUN_CEIL_M)) continue;
      let d = dist2d(e.x, e.z, t.x, t.z);
      if (d > u.range) continue;
      if (t.hero) d /= GAME.CREEP_AGGRO_HERO_BIAS; // 小兵偏好打兵線目標
      if (wd) d /= vsMult(wd, t.kind);             // 優先打武器克制的目標類型
      if (d < bestD) { bestD = d; best = t; }
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
    if (!hold) e.prog = (e.prog ?? 0) + u.speed * dt;
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
    if (e.kind === 'relay' && e.charge > 0) {   // 佔用進度(客戶端進度環 / 警示)
      o.cp = Math.min(100, Math.round(e.charge / FIELD.RELAY.CHANNEL_S * 100));
      o.cps = e.chargeSide;
    }
    if (e.decoy) {   // 餌機:客戶端要姿態(PiP 攝影機)+ 失聯旗標(斷訊雜訊)
      o.pid = e.pid; o.y = Math.round(e.y * 10) / 10; o.ry = Math.round(e.ry * 100) / 100;
      if (e.lost) o.lost = 1;
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
        o.$ = Math.floor(e.money); o.up = e.upg;                 // 經濟(客戶端 HUD / 商店)
        o.mp = Math.floor(e.mp); o.mm = e.maxMp;                 // 電力(招式資源)
        o.ab = e.abil; o.kn = e.kn;                              // 招式階級 / 擊殺數
        o.cds = [Math.max(0, Math.round((e.acd.skill - this.t) * 10) / 10),
                 Math.max(0, Math.round((e.acd.ult - this.t) * 10) / 10)];   // 招式冷卻倒數
      }
      // 機甲餌機:掛點狀態(0 = 已分離/重組中,1 = 已組合就緒)+ 冷卻倒數(HUD / 組合動畫)
      if (e.sq && e.kind !== 'drone') {
        o.dcd = Math.max(0, Math.round((e.sq.decoyCd - this.t) * 10) / 10);
        o.dc = !e.sq.decoy && o.dcd === 0 ? 1 : 0;
      }
      if ((e.empUntil || 0) > this.t) o.emp = Math.round((e.empUntil - this.t) * 10) / 10;
      if ((e.stealthUntil || 0) > this.t) o.st = Math.round((e.stealthUntil - this.t) * 10) / 10;
      const bf = [];
      for (const id in e.buffs || {}) if (e.buffs[id] > this.t) bf.push([id, Math.round(e.buffs[id] - this.t)]);
      if (bf.length) o.bf = bf;   // 詞綴強化(HUD 倒數)
      const md = (e.mods || []).filter((m) => m.until > this.t).map((m) => [m.k, m.m, Math.round(m.until - this.t)]);
      if (md.length) o.md = md;   // 招式增益(HUD 倒數)
    }
    return o;
  }

  /** 一方目前的視野來源(英雄 + 小兵 + 塔 + 主堡,各自 sight 半徑;瞄準模式加成視野) */
  _visionSources(side) {
    const sources = [];
    for (const e of this.ents.values()) {
      if (e.side !== side || e.hp <= 0) continue;
      if (e.decoy && e.lost) continue;   // 失聯的餌機不再回傳遙測 → 不提供視野
      const sight = UNITS[e.kind]?.sight;
      if (sight == null) continue;
      const r = e.hero && e.aiming ? sight * GAME.AIM_SIGHT_MULT : sight;
      sources.push([e.x, e.z, r]);
    }
    return sources;
  }

  /** 建築/中立物永遠可見(非「單位」);敵方英雄/小兵要在己方視野內才可見 */
  _visibleTo(e, side, sources) {
    if (e.side === side || e.neutral || e.kind === 'tower' || e.kind === 'base') return true;
    if (e.hero && (e.stealthUntil || 0) > this.t) return false;   // 匿蹤:連視野內也看不到
    for (const [sx, sz, r] of sources) {
      if (dist2d(e.x, e.z, sx, sz) <= r) return true;
    }
    return false;
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
    this._frameCache = { ev, sm, lt };
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
    const { ev, sm, lt } = this._frame();
    return {
      t: 'snap', time: Math.round(this.t),
      nextWave: Math.max(0, Math.round(this.nextWaveAt - this.t)), wave: this.wave,
      ents, ev, sm, lt, stats: this.stats, over: this.over, winner: this.winner,
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
