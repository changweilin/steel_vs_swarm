// ============ 戰場模擬(伺服器權威)============
// DOTA 式三路兵線:小兵(步兵/裝甲車/坦克)沿真實道路路徑推進,
// 防禦塔與主堡自動迎擊;英雄(無人機/機甲)位置由客戶端回報、
// 血量與傷害由伺服器結算。座標系:以戰場中心為原點的公尺平面
// (x 東、z 北;y 高度只在客戶端管,模擬是 2D 平面 + 兵線路徑)。
import { SIDES, OTHER_SIDE, UNITS, GAME, WEAPONS, ECON, vsMult, upgradePrice } from '../public/js/data.js';

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

    // 兵線折線轉公尺;lane[laneIdx] 方向:SWARM 主堡 → STEEL 主堡
    this.lanes = config.lanes.map((line) =>
      line.map(([lat, lng]) => llToMeters(lat, lng, this.center)));
    this.basePos = {
      SWARM: llToMeters(config.bases.SWARM[0], config.bases.SWARM[1], this.center),
      STEEL: llToMeters(config.bases.STEEL[0], config.bases.STEEL[1], this.center),
    };

    this._spawnStructures();
    this._seedMines();
  }

  // ---------- 地雷(非正規路線;隱蔽,只有地面機甲會踩)----------
  _seedMines() {
    const M = GAME.MINES;
    this.mines = [];
    // 佈雷範圍:所有兵線點的外擴包圍盒
    let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
    for (const pts of this.lanes) for (const [x, z] of pts) {
      minX = Math.min(minX, x); maxX = Math.max(maxX, x);
      minZ = Math.min(minZ, z); maxZ = Math.max(maxZ, z);
    }
    minX -= 120; maxX += 120; minZ -= 120; maxZ += 120;
    const want = M.PER_LANE * this.lanes.length;
    for (let tries = 0; tries < want * 30 && this.mines.length < want; tries++) {
      const x = minX + Math.random() * (maxX - minX);
      const z = minZ + Math.random() * (maxZ - minZ);
      if (this._distToLanes(x, z) < M.LANE_CLEAR) continue;       // 兵線走廊淨空
      let nearBase = false;
      for (const side of ['SWARM', 'STEEL']) {
        const [bx, bz] = this.basePos[side];
        if (dist2d(x, z, bx, bz) < M.BASE_CLEAR) { nearBase = true; break; }
      }
      if (!nearBase) this.mines.push([x, z]);
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
      dead: false, respawnAt: 0, lastBurst: 0,
      // 經濟 / 武器狀態(彈藥伺服器權威)
      money: ECON.START, items: [], upg: { dmg: 0, hull: 0 },
      ammo: {}, reloadUntil: {}, fireAt: {}, aaCd: 0,
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
    if (h.ammo[id] <= 0) { h.reloadUntil[id] = now + def.reload; return false; }
    h.fireAt[id] = now;
    h.ammo[id]--;
    if (h.ammo[id] <= 0) h.reloadUntil[id] = now + def.reload;     // 打空自動填彈
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
    h.reloadUntil[wp.id] = this.t + wp.def.reload;
  }

  /** 英雄傷害倍率(火力升級) */
  _heroDmg(h, def, targetKind) {
    return def.dmg * vsMult(def, targetKind) * (1 + ECON.UPGRADES.dmg.step * (h.upg?.dmg || 0));
  }

  heroPos(pid, x, y, z, ry) {
    const h = this.heroes.get(pid);
    if (!h || h.dead || this.over) return;
    h.x = x; h.y = y; h.z = z; h.ry = ry;
  }

  /** 英雄射擊命中(客戶端 raycast 回報;傷害/克制查表、射程/射速/彈藥伺服器把關) */
  heroHit(pid, targetId, w) {
    const h = this.heroes.get(pid);
    const t = this.ents.get(targetId);
    if (!h || h.dead || !t || t.side === h.side || this.over) return;
    const wp = this._heroWeapon(h, w);
    if (!wp || !wp.def.rate) return;
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
    if (this.over || t.hp <= 0) return;
    // 攻堅需兵線配合:附近沒有己方小兵時,打主堡傷害折減
    if (t.kind === 'base' && by && by.side) {
      const near = [...this.ents.values()].some((e) =>
        e.side === by.side && !e.hero && (e.kind === 'soldier' || e.kind === 'apc' || e.kind === 'tank')
        && dist2d(e.x, e.z, t.x, t.z) < 320);
      if (!near) dmg *= GAME.BASE_ARMOR_NEED_CREEP;
    }
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
    if (by && by.hero && bySide !== t.side) by.money += ECON.BOUNTY[t.kind] || 0;
    if (t.hero) {
      t.dead = true;
      this.stats[t.side].deaths++;
      if (bySide && bySide !== t.side) this.stats[bySide].kills++;
      // 重生冷卻依兵種:機甲越死越久,無人機無冷卻
      const r = UNITS[t.kind].respawn;
      t.respawnAt = this.t + r.base + r.perDeath * this.stats[t.side].deaths;
      return; // 英雄不移除,等重生
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
      if (h.dead && this.t >= h.respawnAt) {
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

    // 小兵 / 塔 / 主堡行為
    this._structs = [...this.ents.values()].filter((s) => s.kind === 'tower' || s.kind === 'base');
    for (const e of [...this.ents.values()]) {
      if (e.hero || e.hp <= 0) continue;
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
        const [mx, mz] = this.mines[i];
        if (dist2d(h.x, h.z, mx, mz) > M.TRIGGER_R) continue;
        this.mines.splice(i, 1);
        this.events.push({ e: 'boom', x: mx, z: mz, r: M.R, mine: true, tpid: h.pid });
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
  _tickAmbush(dt) {
    const A = GAME.AA_AMBUSH;
    for (const h of this.heroes.values()) {
      if (h.dead || h.kind !== 'drone') continue;
      h.aaCd = Math.max(0, (h.aaCd || 0) - dt);
      if (h.aaCd > 0) continue;
      if (this._distToLanes(h.x, h.z) <= GAME.LANE_SAFE_M) continue;   // 走廊內安全
      if (Math.random() > A.CHANCE_PER_S * dt) continue;
      h.aaCd = A.CD_S;
      const ang = Math.random() * Math.PI * 2;
      this.missiles.push({
        id: nextEntId++, byId: null, side: OTHER_SIDE[h.side], tpid: h.pid,
        x: h.x + Math.cos(ang) * A.SPAWN_DIST, z: h.z + Math.sin(ang) * A.SPAWN_DIST,
        y: 0, speed: A.SPEED, dmg: A.DMG, hp: A.HP, ttl: 14,
      });
      this.events.push({ e: 'sam', from: [h.x, h.z], side: OTHER_SIDE[h.side], tpid: h.pid, ambush: true });
    }
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
    const withTank = this.wave % GAME.TANK_EVERY_WAVE === 0;
    for (let li = 0; li < this.lanes.length; li++) {
      for (const side of ['SWARM', 'STEEL']) {
        const pts = this.lanes[li];
        const start = side === 'SWARM' ? pts[0] : pts[pts.length - 1];
        const comp = [];
        for (let i = 0; i < GAME.WAVE_SOLDIERS; i++) comp.push('soldier');
        for (let i = 0; i < GAME.WAVE_APC; i++) comp.push('apc');
        if (withTank) comp.push('tank');
        comp.forEach((kind, i) => {
          const jx = (Math.random() - 0.5) * 24, jz = (Math.random() - 0.5) * 24;
          this._add({
            kind, side, lane: li,
            x: start[0] + jx, z: start[1] + jz,
            hp: UNITS[kind].hp,
            // 沿線進度(公尺,從己方端起算);錯開避免疊隊
            prog: -i * 14,
          });
        });
      }
    }
    this.events.push({ e: 'wave', n: this.wave, tank: withTank });
  }

  _acquireTarget(e, u) {
    let best = null, bestD = Infinity;
    for (const t of this.ents.values()) {
      if (t.side === e.side || t.hp <= 0) continue;
      if (t.hero && (t.dead || t.kind === 'drone' && (t.y || 0) > u.range * 0.9)) continue; // 高空無人機難鎖定
      let d = dist2d(e.x, e.z, t.x, t.z);
      if (d > u.range) continue;
      if (t.hero) d /= GAME.CREEP_AGGRO_HERO_BIAS; // 小兵偏好打兵線目標
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
  }

  _laneCum(li) {
    this._cumCache ??= [];
    return (this._cumCache[li] ??= cumLen(this.lanes[li]));
  }

  // ---------- 快照 ----------
  snapshot() {
    const ents = [];
    for (const e of this.ents.values()) {
      const o = { id: e.id, k: e.kind, s: e.side, x: Math.round(e.x * 10) / 10, z: Math.round(e.z * 10) / 10, hp: Math.round(e.hp), m: e.maxHp };
      if (e.hero) {
        o.pid = e.pid; o.y = Math.round((e.y || 0) * 10) / 10; o.ry = Math.round((e.ry || 0) * 100) / 100;
        o.dead = e.dead; if (e.dead) o.rs = Math.max(0, Math.round(e.respawnAt - this.t));
        o.$ = Math.floor(e.money); o.it = e.items; o.up = e.upg;   // 經濟(客戶端 HUD / 商店)
      }
      ents.push(o);
    }
    const ev = this.events;
    this.events = [];
    const sm = this.missiles.map((m) => ({
      id: m.id, x: Math.round(m.x * 10) / 10, y: Math.round(m.y * 10) / 10, z: Math.round(m.z * 10) / 10,
    }));
    return {
      t: 'snap', time: Math.round(this.t),
      nextWave: Math.max(0, Math.round(this.nextWaveAt - this.t)), wave: this.wave,
      ents, ev, sm, stats: this.stats, over: this.over, winner: this.winner,
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
