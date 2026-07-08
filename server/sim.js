// ============ 戰場模擬(伺服器權威)============
// DOTA 式三路兵線:小兵(步兵/裝甲車/坦克)沿真實道路路徑推進,
// 防禦塔與主堡自動迎擊;英雄(無人機/機甲)位置由客戶端回報、
// 血量與傷害由伺服器結算。座標系:以戰場中心為原點的公尺平面
// (x 東、z 北;y 高度只在客戶端管,模擬是 2D 平面 + 兵線路徑)。
import { SIDES, OTHER_SIDE, UNITS, GAME, WEAPONS, ECON, HAZARDS, FIELD, LOOT, AFFIXES, vsMult, upgradePrice, laneTacticsXZ } from '../public/js/data.js';

let nextEntId = 1;

/** 經緯度 → 以 center 為原點的公尺平面(等距圓柱,5km 內誤差可忽略) */
export function llToMeters(lat, lng, center) {
  const R = 6371000;
  const x = (lng - center.lng) * Math.PI / 180 * R * Math.cos(center.lat * Math.PI / 180);
  const z = (lat - center.lat) * Math.PI / 180 * R;
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
    this.heroes = new Map();          // pid(玩家連線 id;電腦玩家為 'b1' 之類字串)-> hero entity
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
    minX -= 120; maxX += 120; minZ -= 120; maxZ += 120;
    // 兵線轉角座標:CUT_BIAS 比例的地雷佈在轉角外圍的「切彎捷徑」帶 —
    // 機甲抄直線切彎省時間 = 承擔雷區風險(限制行動但不封鎖,走廊永遠安全)
    const turnPts = [];
    for (let li = 0; li < this.lanes.length; li++) {
      const cum = this._laneCum(li);
      for (const d of this._laneTurns(li)) turnPts.push(pointAt(this.lanes[li], cum, d));
    }
    const want = M.PER_LANE * this.lanes.length;
    for (let tries = 0; tries < want * 30 && this.mines.length < want; tries++) {
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
      if (this._distToLanes(x, z) < M.LANE_CLEAR) continue;       // 兵線走廊淨空
      let nearBase = false;
      for (const side of ['SWARM', 'STEEL']) {
        const [bx, bz] = this.basePos[side];
        if (dist2d(x, z, bx, bz) < M.BASE_CLEAR) { nearBase = true; break; }
      }
      if (!nearBase) this.mines.push([x, z, nextEntId++]);
    }
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

  _hazOk(x, z, def, wallStart = Infinity) {
    const F = FIELD;
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
      if (this._distToLanes(x, z) < S.laneMin) continue;
      let bad = false;
      for (const side of ['SWARM', 'STEEL']) {
        const [bx, bz] = this.basePos[side];
        if (dist2d(x, z, bx, bz) < FIELD.HAZ_BASE_CLEAR) { bad = true; break; }
      }
      if (bad || sites.some(([sx, sz]) => dist2d(x, z, sx, sz) < S.spacing)) continue;
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

  // ---------- 建置:主堡 + 每線每方 2 座防禦塔 ----------
  _spawnStructures() {
    for (const side of ['SWARM', 'STEEL']) {
      const [x, z] = this.basePos[side];
      this._add({ kind: 'base', side, x, z, hp: UNITS.base.hp });
    }
    for (let li = 0; li < this.lanes.length; li++) {
      const pts = this.lanes[li];
      const cum = cumLen(pts);
      const total = cum[cum.length - 1];
      for (const side of ['SWARM', 'STEEL']) {
        for (const frac of GAME.TOWER_FRACS) {
          // 塔位:距「己方端」frac 比例(SWARM 端是折線起點)
          const d = side === 'SWARM' ? total * frac : total * (1 - frac);
          const [x, z] = pointAt(pts, cum, d);
          this._add({ kind: 'tower', side, x, z, hp: UNITS.tower.hp, lane: li });
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

  // ---------- 英雄(每陣營可多位,以玩家 pid 為鍵)----------
  addHero(side, pid) {
    if (this.heroes.has(pid)) return this.heroes.get(pid);
    const kind = SIDES[side].hero; // drone | robot
    const idx = [...this.heroes.values()].filter((h) => h.side === side).length;
    const [bx, bz] = this.basePos[side];
    // 同陣營多英雄:繞主堡錯開出生點,避免疊在一起
    const ang = idx * (Math.PI * 2 / 5);
    const h = this._add({
      kind, side, pid,
      x: bx + Math.cos(ang) * 30 * Math.min(idx, 1),
      z: bz + Math.sin(ang) * 30 * Math.min(idx, 1),
      y: 0, ry: 0, spawnIdx: idx,
      hp: UNITS[kind].hp, hero: true,
      dead: false, respawnAt: 0, lastBurst: 0, aiming: false,
      // 經濟 / 武器狀態(彈藥伺服器權威)
      money: ECON.START, items: [], upg: { dmg: 0, hull: 0 },
      ammo: {}, reloadUntil: {}, fireAt: {}, aaCd: 0, buffs: {},
    });
    this.heroes.set(pid, h);
    return h;
  }

  // ---------- 武器解析 / 開火閘門(射速 + 彈夾 + 填彈,伺服器把關)----------
  /** w: 武器 id;'gun'/缺值 = 自帶主武器。回傳 {id, def} 或 null(未持有) */
  _heroWeapon(h, w) {
    const loadout = UNITS[h.kind].loadout;
    const id = (!w || w === 'gun') ? loadout[0] : String(w);
    if (!WEAPONS[id]) return null;
    if (!loadout.includes(id) && !h.items.includes(id)) return null;
    return { id, def: WEAPONS[id] };
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

  /** 英雄傷害倍率(火力升級) */
  _heroDmg(h, def, targetKind) {
    return def.dmg * vsMult(def, targetKind) * (1 + ECON.UPGRADES.dmg.step * (h.upg?.dmg || 0));
  }

  /** 詞綴強化乘數(reload/dmgTaken/bounty;過期即清,全部伺服器結算) */
  _buffMul(h, key) {
    let m = 1;
    for (const id in h.buffs || {}) {
      if (h.buffs[id] <= this.t) { delete h.buffs[id]; continue; }
      const a = AFFIXES[id];
      if (a?.[key]) m *= a[key];
    }
    return m;
  }

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

  /** 英雄射擊命中(客戶端 raycast 回報;傷害/克制查表、射程/射速/彈藥伺服器把關) */
  heroHit(pid, targetId, w) {
    const h = this.heroes.get(pid);
    const t = this.ents.get(targetId);
    if (!h || h.dead || !t || t.side === h.side || this.over) return;
    const wp = this._heroWeapon(h, w);
    if (!wp || !wp.def.rate) return;
    if (wp.def.needAim && !h.aiming) return;   // 熱兵器(狙擊/火箭等)需瞄準模式才能開火
    // 射程驗證(3D:高空狙擊也要吃射程;留 25% 寬容給網路延遲)
    const d3 = Math.hypot(h.x - t.x, h.z - t.z, (h.y || 0) - (t.hero ? (t.y || 0) : 0));
    if (d3 > wp.def.range * 1.25) return;
    if (!this._gateFire(h, wp.id, wp.def, true)) return;
    this._damage(t, this._heroDmg(h, wp.def, t.kind), h);
  }

  /** 射擊來襲防空飛彈(飛彈可被擊毀) */
  hitMissile(pid, missileId, w) {
    const h = this.heroes.get(pid);
    if (!h || h.dead || this.over) return;
    const m = this.missiles.find((x) => x.id === missileId);
    if (!m || m.side === h.side) return;
    const wp = this._heroWeapon(h, w);
    if (!wp || !wp.def.rate) return;
    if (wp.def.needAim && !h.aiming) return;   // 熱兵器(狙擊/火箭等)需瞄準模式才能開火
    const d3 = Math.hypot(h.x - m.x, h.z - m.z, (h.y || 0) - m.y);
    if (d3 > wp.def.range * 1.25) return;
    if (!this._gateFire(h, wp.id, wp.def, true)) return;
    m.hp -= wp.def.dmg * (1 + ECON.UPGRADES.dmg.step * h.upg.dmg);
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
  botFire(pid, targetId) {
    const h = this.heroes.get(pid);
    const t = this.ents.get(targetId);
    if (!h || h.dead || !t || t.side === h.side || this.over) return false;
    const wp = this._heroWeapon(h, 'gun');
    const d3 = Math.hypot(h.x - t.x, h.z - t.z, (h.y || 0) - (t.hero ? (t.y || 0) : 0));
    if (d3 > wp.def.range) return false;
    if (!this._gateFire(h, wp.id, wp.def, false)) return false;
    h._shotN = (h._shotN || 0) + 1;
    if (h._shotN % 3 === 0) this.events.push({ e: 'shot', from: [h.x, h.z], to: [t.x, t.z], side: h.side });
    this._damage(t, this._heroDmg(h, wp.def, t.kind), h);
    return true;
  }

  /**
   * 右鍵範圍攻擊。機甲=肩射火箭(彈數/填彈伺服器把關,落點由客戶端回報);
   * 無人機=重型炸彈,一律在自身位置引爆(原地或撞擊)→ 轉 heroDetonate。
   */
  heroBurst(pid, x, z) {
    const h = this.heroes.get(pid);
    if (!h || h.dead || this.over) return;
    if (h.kind === 'drone') { this.heroDetonate(pid); return; }
    const def = WEAPONS[UNITS[h.kind].burst];
    if (def.needAim && !h.aiming) return;   // 肩射火箭需瞄準模式才能開火
    if (dist2d(h.x, h.z, x, z) > def.range) return;
    if (!this._gateFire(h, UNITS[h.kind].burst, def, false)) return;
    h.lastBurst = this.t;
    this.events.push({ e: 'boom', x, z, r: def.r, side: h.side });
    this._blast(h, def, x, z, 0);
  }

  /** 無人機重型炸彈:右鍵原地引爆 / 高速撞擊引爆 — 座機同歸於盡(重生無冷卻) */
  heroDetonate(pid) {
    const h = this.heroes.get(pid);
    if (!h || h.dead || h.kind !== 'drone' || this.over) return;
    const def = WEAPONS[UNITS.drone.bomb];
    this.events.push({ e: 'boom', x: h.x, z: h.z, y: h.y || 0, r: def.r, side: h.side });
    this._blast(h, def, h.x, h.z, h.y || 0);
    h.hp = 0;
    this._kill(h, null);   // 自毀:不給任何一方擊殺數
  }

  /** 爆炸範圍傷害(3D 距離:高空引爆炸不到地面;只傷敵方) */
  _blast(h, def, x, z, y) {
    for (const t of [...this.ents.values()]) {
      if (t.side === h.side || (t.hero && t.dead)) continue;
      const d = Math.hypot(x - t.x, z - t.z, y - (t.hero ? (t.y || 0) : 0));
      const dmg = this._heroDmg(h, def, t.kind);
      if (d <= def.r) this._damage(t, dmg, h);
      else if (d <= def.r * 1.8) this._damage(t, dmg * 0.4, h);
    }
  }

  // ---------- 經濟:購買(升級隨處可買;熱兵器要在主堡補給圈)----------
  /** 回傳錯誤訊息字串或 null(成功) */
  buy(pid, item) {
    const h = this.heroes.get(pid);
    if (!h || h.dead || this.over) return '目前無法購買';
    const up = ECON.UPGRADES[item];
    if (up) {
      const lvl = h.upg[item] || 0;
      if (lvl >= up.max) return `${up.name} 已滿級`;
      const price = upgradePrice(up, lvl);
      if (h.money < price) return `資金不足(${up.name} 需 $${price})`;
      h.money -= price;
      h.upg[item] = lvl + 1;
      if (item === 'hull') {
        const nm = Math.round(UNITS[h.kind].hp * (1 + up.step * h.upg.hull));
        h.hp += nm - h.maxHp;
        h.maxHp = nm;
      }
      this.events.push({ e: 'buy', pid, item, lvl: h.upg[item] });
      return null;
    }
    const wd = WEAPONS[item];
    if (!wd || !wd.price) return '沒有這項商品';
    const [bx, bz] = this.basePos[h.side];
    if (dist2d(h.x, h.z, bx, bz) > GAME.HERO_HEAL_RADIUS) return '熱兵器需回主堡補給圈內購買';
    if (h.items.includes(item)) return `已擁有${wd.name}`;
    if (h.items.length >= UNITS[h.kind].slots) return `武器槽已滿(${UNITS[h.kind].slots} 件)`;
    if (h.money < wd.price) return `資金不足(${wd.name} 需 $${wd.price})`;
    h.money -= wd.price;
    h.items.push(item);
    h.ammo[item] = wd.mag;
    this.events.push({ e: 'buy', pid, item });
    return null;
  }

  // ---------- 傷害 / 擊殺 ----------
  _damage(t, dmg, by) {
    if (this.over || t.hp <= 0 || t.inv) return;   // inv = 不可摧毀障礙(塌陷/坍方/火場/淹水)
    // 攻堅需兵線配合:附近沒有己方小兵時,打主堡傷害折減
    if (t.kind === 'base' && by && by.side) {
      const near = [...this.ents.values()].some((e) =>
        e.side === by.side && !e.hero && !e.neutral
        && dist2d(e.x, e.z, t.x, t.z) < 320);
      if (!near) dmg *= GAME.BASE_ARMOR_NEED_CREEP;
    }
    if (t.hero) dmg *= this._buffMul(t, 'dmgTaken');   // 複合裝甲詞綴
    t.hp -= dmg;
    if (t.hp <= 0) {
      t.hp = 0;
      this._kill(t, by);
    }
  }

  _kill(t, by) {
    const bySide = by?.side || null;
    this.events.push({ e: 'die', id: t.id, kind: t.kind, x: t.x, z: t.z, side: t.side, ...(t.hero ? { pid: t.pid } : {}) });
    // 擊殺賞金:高價值單位報酬越高(自毀/中立傷害不給錢)
    if (by && by.hero && bySide !== t.side) {
      by.money += (ECON.BOUNTY[t.kind] || 0) * this._buffMul(by, 'bounty');
      // 汲能核心詞綴:擊殺(非中立)回復上限血量比例
      if (!t.neutral && !by.dead) {
        for (const id in by.buffs || {}) {
          if (by.buffs[id] > this.t && AFFIXES[id]?.killHeal) {
            by.hp = Math.min(by.maxHp, by.hp + by.maxHp * AFFIXES[id].killHeal);
          }
        }
      }
    }
    if (t.hero) {
      t.dead = true;
      t.aiming = false;
      this.stats[t.side].deaths++;
      if (bySide && bySide !== t.side) this.stats[bySide].kills++;
      // 重生冷卻依兵種:機甲越死越久,無人機無冷卻
      const r = UNITS[t.kind].respawn;
      t.respawnAt = this.t + r.base + r.perDeath * this.stats[t.side].deaths;
      // 死亡多發生在 tick() 之外的訊息處理當下(detonate/hit),respawnAt 用的是
      // 上一個 tick 結束時的 this.t;若 r.base=0(無人機),下一個 tick 就會立刻
      // 达成重生條件,導致 dead:true 從未出現在任何一份快照裡(客戶端永遠不知道自己死過,
      // 見 _applySnap 的 dead 邊緣觸發邏輯)。強制至少跨過一次完整 tick 週期才能重生,
      // 確保至少有一份快照廣播出 dead:true。
      t.deadTick = this._tickN;
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
      this.nextWaveAt = this.t + GAME.WAVE_INTERVAL_S;
      this._spawnWave();
    }

    // 英雄:被動收入 / 重生 / 主堡補血
    for (const h of this.heroes.values()) {
      h.money += ECON.INCOME_PER_S * dt;
      if (h.dead && this.t >= h.respawnAt && this._tickN > (h.deadTick || 0) + 1) {
        h.dead = false;
        h.hp = h.maxHp;
        [h.x, h.z] = this.basePos[h.side];
        h.y = 0;
        h.ammo = {}; h.reloadUntil = {}; h.fireAt = {};   // 重生滿彈
        this.events.push({ e: 'respawn', id: h.id, side: h.side, pid: h.pid });
      }
      if (!h.dead && h.hp < h.maxHp) {
        const [bx, bz] = this.basePos[h.side];
        if (dist2d(h.x, h.z, bx, bz) < GAME.HERO_HEAL_RADIUS) {
          h.hp = Math.min(h.maxHp, h.hp + UNITS[h.kind].regen * dt);
        }
      }
    }
    this._tickMines();
    this._tickAmbush(dt);
    this._tickRelays(dt);
    this._tickHazards(dt);

    // 小兵 / 塔 / 主堡行為
    this._structs = [...this.ents.values()].filter((s) => s.kind === 'tower' || s.kind === 'base');
    for (const e of [...this.ents.values()]) {
      if (e.hero || e.neutral || e.hp <= 0) continue;
      const u = UNITS[e.kind];
      e.cd = Math.max(0, e.cd - dt);
      if (u.sam) this._tryLaunchSam(e, u.sam, dt);
      const target = this._acquireTarget(e, u);
      if (target) {
        if (e.cd === 0) {
          e.cd = 1 / u.rate;
          this._damage(target, u.dmg, e);
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

  // ---------- 地雷觸發(地面機甲踩到 → 爆炸,無差別範圍傷害)----------
  _tickMines() {
    const M = GAME.MINES;
    for (const h of this.heroes.values()) {
      if (h.dead || h.kind !== 'robot') continue;
      for (let i = this.mines.length - 1; i >= 0; i--) {
        const [mx, mz, mid] = this.mines[i];
        if (dist2d(h.x, h.z, mx, mz) > M.TRIGGER_R) continue;
        this.mines.splice(i, 1);
        this.events.push({ e: 'boom', x: mx, z: mz, r: M.R, mine: true, mid, tpid: h.pid });
        for (const t of [...this.ents.values()]) {   // 中立危害:雙方都炸
          if (t.hero && t.dead) continue;
          const d = dist2d(mx, mz, t.x, t.z);
          if (t.hero && (t.y || 0) > M.R) continue;  // 空中不受地雷波及
          if (d <= M.R) this._damage(t, M.DMG, null);
          else if (d <= M.R * 1.8) this._damage(t, M.DMG * 0.4, null);
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
    for (const h of this.heroes.values()) {
      if (h.dead || h.kind !== 'drone') continue;
      h.aaCd = Math.max(0, (h.aaCd || 0) - dt);
      if (h.aaCd > 0) continue;
      if (this._distToLanes(h.x, h.z) <= GAME.LANE_SAFE_M) continue;   // 走廊內安全
      if (Math.random() > A.CHANCE_PER_S * dt) continue;
      sites ??= [...this.ents.values()].filter((e) => e.kind === 'aasite');
      let best = null, bestD = Infinity;
      for (const s of sites) {
        const d = dist2d(h.x, h.z, s.x, s.z);
        if (d <= S.range && d < bestD) { bestD = d; best = s; }
      }
      if (!best) continue;   // 附近陣地已被摧毀 → 這條非正規路線是打出來的安全通道
      h.aaCd = A.CD_S;
      this.missiles.push({
        id: nextEntId++, byId: best.id, side: OTHER_SIDE[h.side], tpid: h.pid,
        x: best.x, z: best.z, y: 2, speed: A.SPEED, dmg: A.DMG, hp: A.HP, ttl: 14,
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
      for (const h of this.heroes.values()) {
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
      for (const h of this.heroes.values()) {
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
      for (const h of this.heroes.values()) {
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
    for (const h of this.heroes.values()) {
      if (h.side === e.side || h.dead || h.kind !== 'drone') continue;
      const y = h.y || 0;
      if (y < GAME.AA_MIN_ALT) continue;                 // 低飛交給塔砲
      const d = Math.hypot(h.x - e.x, h.z - e.z, y);
      if (d <= sam.range && d < bestD) { bestD = d; best = h; }
    }
    if (!best) return;
    e.samCd = sam.cd;
    this.missiles.push({
      id: nextEntId++, byId: e.id, side: e.side, tpid: best.pid,
      x: e.x, z: e.z, y: 18, speed: sam.speed, dmg: sam.dmg, hp: sam.hp, ttl: 12,
    });
    this.events.push({ e: 'sam', from: [e.x, e.z], side: e.side, tpid: best.pid });
  }

  _tickMissiles(dt) {
    for (let i = this.missiles.length - 1; i >= 0; i--) {
      const m = this.missiles[i];
      const t = this.heroes.get(m.tpid);
      m.ttl -= dt;
      if (!t || t.dead || m.ttl <= 0) { this.missiles.splice(i, 1); continue; }  // 目標消失:飛彈自毀
      const dx = t.x - m.x, dy = (t.y || 0) - m.y, dz = t.z - m.z;
      const d = Math.hypot(dx, dy, dz);
      const step = m.speed * dt;
      if (d <= Math.max(12, step)) {
        // 命中:近炸引信
        this._damage(t, m.dmg, this.ents.get(m.byId) || { side: m.side });
        this.events.push({ e: 'boom', x: t.x, z: t.z, y: t.y || 0, r: 14, side: m.side, sam: true });
        this.missiles.splice(i, 1);
        continue;
      }
      m.x += dx / d * step;
      m.y += dy / d * step;
      m.z += dz / d * step;
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
          const jx = (Math.random() - 0.5) * 24, jz = (Math.random() - 0.5) * 24;
          this._add({
            kind, side, lane: li,
            x: start[0] + jx, z: start[1] + jz,
            y: kind === 'heli' ? GAME.HELI_ALT : 0,
            hp: UNITS[kind].hp,
            // 沿線進度(公尺,從己方端起算);錯開避免疊隊
            prog: -i * 14,
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
      if (t.hero && t.dead) continue;
      if ((t.kind === 'drone' || t.kind === 'heli') && (t.y || 0) > u.range * 0.9) continue; // 高空飛行單位難鎖定
      let d = dist2d(e.x, e.z, t.x, t.z);
      if (d > u.range) continue;
      if (t.hero) d /= GAME.CREEP_AGGRO_HERO_BIAS; // 小兵偏好打兵線目標
      if (wd) d /= vsMult(wd, t.kind);             // 優先打武器克制的目標類型
      if (d < bestD) { bestD = d; best = t; }
    }
    return best;
  }

  _advance(e, u, dt) {
    const pts = this.lanes[e.lane];
    const cum = this._laneCum(e.lane);
    const total = cum[cum.length - 1];
    e.prog = (e.prog ?? 0) + u.speed * dt;
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
    if (e.hero) {
      o.pid = e.pid; o.y = Math.round((e.y || 0) * 10) / 10; o.ry = Math.round((e.ry || 0) * 100) / 100;
      o.dead = e.dead; if (e.dead) o.rs = Math.max(0, Math.round(e.respawnAt - this.t));
      o.$ = Math.floor(e.money); o.it = e.items; o.up = e.upg;   // 經濟(客戶端 HUD / 商店)
      const bf = [];
      for (const id in e.buffs || {}) if (e.buffs[id] > this.t) bf.push([id, Math.round(e.buffs[id] - this.t)]);
      if (bf.length) o.bf = bf;   // 詞綴強化(HUD 倒數)
    }
    return o;
  }

  /** 一方目前的視野來源(英雄 + 小兵 + 塔 + 主堡,各自 sight 半徑;瞄準模式加成視野) */
  _visionSources(side) {
    const sources = [];
    for (const e of this.ents.values()) {
      if (e.side !== side || e.hp <= 0) continue;
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
