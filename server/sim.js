// ============ 戰場模擬(伺服器權威)============
// DOTA 式三路兵線:小兵(步兵/裝甲車/坦克)沿真實道路路徑推進,
// 防禦塔與主堡自動迎擊;英雄(無人機/機甲)位置由客戶端回報、
// 血量與傷害由伺服器結算。座標系:以戰場中心為原點的公尺平面
// (x 東、z 北;y 高度只在客戶端管,模擬是 2D 平面 + 兵線路徑)。
import { SIDES, OTHER_SIDE, UNITS, GAME } from '../public/js/data.js';

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
      dead: false, respawnAt: 0, lastFire: 0, lastBurst: 0,
    });
    this.heroes.set(pid, h);
    return h;
  }

  heroPos(pid, x, y, z, ry) {
    const h = this.heroes.get(pid);
    if (!h || h.dead || this.over) return;
    h.x = x; h.y = y; h.z = z; h.ry = ry;
  }

  /** 英雄射擊命中(客戶端 raycast 回報;傷害查表、射程與射速伺服器把關) */
  heroHit(pid, targetId) {
    const h = this.heroes.get(pid);
    const t = this.ents.get(targetId);
    if (!h || h.dead || !t || t.side === h.side || this.over) return;
    const gun = UNITS[h.kind].gun;
    // 射程驗證(3D:高空狙擊也要吃射程;留 25% 寬容給網路延遲)
    const d3 = Math.hypot(h.x - t.x, h.z - t.z, (h.y || 0) - (t.hero ? (t.y || 0) : 0));
    if (d3 > gun.range * 1.25) return;
    const now = this.t;
    const minGap = 1 / (gun.rate * 1.5);                            // 射速上限驗證
    if (now - h.lastFire < minGap) return;
    h.lastFire = now;
    this._damage(t, gun.dmg, h);
  }

  /**
   * 伺服器端英雄開火(電腦玩家用):射程/射速同 heroHit,
   * 額外廣播 shot 事件讓客戶端畫彈道(節流:每 3 發畫 1 發)。
   */
  botFire(pid, targetId) {
    const h = this.heroes.get(pid);
    const t = this.ents.get(targetId);
    if (!h || h.dead || !t || t.side === h.side || this.over) return false;
    const gun = UNITS[h.kind].gun;
    const d3 = Math.hypot(h.x - t.x, h.z - t.z, (h.y || 0) - (t.hero ? (t.y || 0) : 0));
    if (d3 > gun.range) return false;
    if (this.t - h.lastFire < 1 / gun.rate) return false;
    h.lastFire = this.t;
    h._shotN = (h._shotN || 0) + 1;
    if (h._shotN % 3 === 0) this.events.push({ e: 'shot', from: [h.x, h.z], to: [t.x, t.z], side: h.side });
    this._damage(t, gun.dmg, h);
    return true;
  }

  /** 範圍攻擊(無人機空投炸彈 / 機甲火箭):落點由客戶端回報,冷卻伺服器把關 */
  heroBurst(pid, x, z) {
    const h = this.heroes.get(pid);
    if (!h || h.dead || this.over) return;
    const b = UNITS[h.kind].burst;
    if (this.t - h.lastBurst < b.cd * 0.9) return;
    if (dist2d(h.x, h.z, x, z) > 600) return;
    h.lastBurst = this.t;
    this.events.push({ e: 'boom', x, z, r: b.r, side: h.side });
    for (const t of [...this.ents.values()]) {
      if (t.side === h.side) continue;
      const d = dist2d(x, z, t.x, t.z);
      if (d <= b.r) this._damage(t, b.dmg * (t.kind === 'base' || t.kind === 'tower' ? 0.5 : 1), h);
      else if (d <= b.r * 1.8) this._damage(t, b.dmg * 0.4, h);
    }
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
    if (t.hero) {
      t.dead = true;
      this.stats[t.side].deaths++;
      if (bySide) this.stats[bySide].kills++;
      const delay = GAME.RESPAWN_BASE_S + GAME.RESPAWN_PER_DEATH_S * this.stats[t.side].deaths;
      t.respawnAt = this.t + delay;
      return; // 英雄不移除,等重生
    }
    if (bySide && by.hero) this.stats[bySide].creepKills += UNITS[t.kind]?.bounty || 1;
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

    // 英雄重生 / 主堡補血
    for (const h of this.heroes.values()) {
      if (h.dead && this.t >= h.respawnAt) {
        h.dead = false;
        h.hp = h.maxHp;
        [h.x, h.z] = this.basePos[h.side];
        h.y = 0;
        this.events.push({ e: 'respawn', id: h.id, side: h.side, pid: h.pid });
      }
      if (!h.dead && h.hp < h.maxHp) {
        const [bx, bz] = this.basePos[h.side];
        if (dist2d(h.x, h.z, bx, bz) < GAME.HERO_HEAL_RADIUS) {
          h.hp = Math.min(h.maxHp, h.hp + UNITS[h.kind].regen * dt);
        }
      }
    }

    // 小兵 / 塔 / 主堡行為
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
      x: e.x, z: e.z, y: 18, speed: sam.speed, dmg: sam.dmg, ttl: 12,
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
      if (e.hero) { o.pid = e.pid; o.y = Math.round((e.y || 0) * 10) / 10; o.ry = Math.round((e.ry || 0) * 100) / 100; o.dead = e.dead; if (e.dead) o.rs = Math.max(0, Math.round(e.respawnAt - this.t)); }
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
