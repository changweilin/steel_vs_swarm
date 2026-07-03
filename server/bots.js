// ============ 電腦玩家(伺服器端英雄 AI)============
// 每個 bot 操控一位英雄(無人機/機甲),與人類玩家共用 sim 的英雄規則:
// 傷害查表、射速/射程/冷卻全由 sim 把關(botFire / heroBurst)。
// 行為狀態機:PUSH(沿兵線推進)→ ENGAGE(交戰)→ RETREAT(低血撤退回堡補血)。
// NPC 路線 = 房間兵線(與小兵同一份折線),不用另外算路。
import { UNITS, GAME, WEAPONS } from '../public/js/data.js';
import { cumLen, pointAt } from './sim.js';

const CRUISE_ALT = { min: 26, max: 52 };   // 無人機巡航高度(離地;≥AA_MIN_ALT 會吃防空飛彈,故意讓 bot 有風險)
const RETREAT_HP = 0.32;                    // 低於 32% 血撤退
const RESUME_HP = 0.85;                     // 回血到 85% 再出擊

export class BotBrain {
  /** sim: BattleSim;pid: 'b1' 之類字串;laneIdx: 指派兵線 */
  constructor(sim, pid, side, laneIdx) {
    this.sim = sim;
    this.pid = pid;
    this.side = side;
    this.lane = laneIdx % sim.lanes.length;
    this.state = 'PUSH';
    this.prog = 0;                          // 沿兵線進度(公尺,從己方端起算)
    this.alt = CRUISE_ALT.min + Math.random() * (CRUISE_ALT.max - CRUISE_ALT.min);
    this.jitter = [(Math.random() - 0.5) * 24, (Math.random() - 0.5) * 24];
    this._cum = cumLen(sim.lanes[this.lane]);
  }

  update(dt) {
    const sim = this.sim;
    const h = sim.heroes.get(this.pid);
    if (!h || sim.over) return;
    if (h.dead) { this.state = 'PUSH'; this.prog = 0; return; }

    const u = UNITS[h.kind];
    const frac = h.hp / h.maxHp;
    if (this.state !== 'RETREAT' && frac < RETREAT_HP) this.state = 'RETREAT';
    if (this.state === 'RETREAT' && frac >= RESUME_HP) { this.state = 'PUSH'; this.prog = 0; }

    const target = this._acquire(h, u);
    if (this.state !== 'RETREAT') this.state = target ? 'ENGAGE' : 'PUSH';

    // 經濟:有閒錢就升級(火力/裝甲輪流,升級隨處可買)
    if (h.money >= 300 && sim.t - (this._buyAt || 0) > 4) {
      this._buyAt = sim.t;
      sim.buy(this.pid, (h.upg.dmg || 0) <= (h.upg.hull || 0) ? 'dmg' : 'hull');
    }

    if (this.state === 'RETREAT') this._moveToward(h, u, sim.basePos[this.side], dt);
    else if (this.state === 'ENGAGE') this._engage(h, u, target, dt);
    else this._push(h, u, dt);

    // 高度:無人機巡航;交戰時降到武器好瞄的高度(仍在防空威脅圈內)
    if (h.kind === 'drone') {
      const want = this.state === 'ENGAGE' ? Math.max(GAME.AA_MIN_ALT * 0.6, this.alt * 0.6) : this.alt;
      h.y = (h.y || 0) + (want - (h.y || 0)) * Math.min(1, dt * 1.5);
    } else {
      h.y = 0;
    }
  }

  /** 沿指派兵線往敵方端推進(SWARM 端是折線起點) */
  _push(h, u, dt) {
    const pts = this.sim.lanes[this.lane];
    const total = this._cum[this._cum.length - 1];
    this.prog = Math.min(total, this.prog + u.speed * 0.85 * dt);
    const d = this.side === 'SWARM' ? this.prog : total - this.prog;
    const [x, z] = pointAt(pts, this._cum, d);
    this._face(h, x, z);
    h.x += (x + this.jitter[0] - h.x) * Math.min(1, dt * 2.2);
    h.z += (z + this.jitter[1] - h.z) * Math.min(1, dt * 2.2);
    // 掉隊修正:被擊退/重生後 prog 對不上實際位置時,吸附回最近進度
    if (Math.hypot(h.x - x, h.z - z) > 90) this.prog = Math.max(0, this.prog - u.speed * dt * 4);
  }

  /** 交戰:保持在射程 60~85% 的距離環,邊打邊橫移 */
  _engage(h, u, t, dt) {
    const gun = WEAPONS[u.loadout[0]];
    const dx = t.x - h.x, dz = t.z - h.z;
    const d = Math.hypot(dx, dz) || 1;
    const keep = gun.range * (t.kind === 'tower' || t.kind === 'base' ? 0.85 : 0.6);
    const radial = (d - keep) / Math.max(1, d);          // >0 靠近、<0 拉開
    const strafe = Math.sin(this.sim.t * 0.9 + this.lane * 2) * 0.6;
    const vx = dx / d * radial * u.speed + (-dz / d) * strafe * u.speed;
    const vz = dz / d * radial * u.speed + (dx / d) * strafe * u.speed;
    h.x += vx * dt;
    h.z += vz * dt;
    this._face(h, t.x, t.z);
    this.sim.botFire(this.pid, t.id);
    if (h.kind === 'robot') {
      // 肩射火箭:目標周圍 ≥3 個敵人或目標是建築時丟(彈數/填彈由 sim 把關)
      const b = WEAPONS[UNITS.robot.burst];
      if (this.sim.t - h.lastBurst >= 1 / b.rate) {
        const packed = [...this.sim.ents.values()].filter((e2) =>
          e2.side !== h.side && Math.hypot(e2.x - t.x, e2.z - t.z) <= b.r * 1.5).length;
        if (packed >= 3 || t.kind === 'tower' || t.kind === 'base') {
          this.sim.heroBurst(this.pid, t.x, t.z);
        }
      }
    } else {
      // 無人機神風:貼近建築或敵群密集時撞擊引爆(重生無冷卻,值得換)
      const b = WEAPONS[UNITS.drone.bomb];
      const packed = [...this.sim.ents.values()].filter((e2) =>
        e2.side !== h.side && !e2.hero
        && Math.hypot(e2.x - h.x, e2.z - h.z, (h.y || 0)) <= b.r).length;
      const onStruct = (t.kind === 'tower' || t.kind === 'base')
        && Math.hypot(t.x - h.x, t.z - h.z, h.y || 0) <= b.r * 0.8;
      if (packed >= 4 || onStruct) this.sim.heroDetonate(this.pid);
    }
  }

  _moveToward(h, u, [tx, tz], dt) {
    const dx = tx - h.x, dz = tz - h.z;
    const d = Math.hypot(dx, dz);
    if (d < 30) return;                                  // 到堡附近等補血
    this._face(h, tx, tz);
    h.x += dx / d * u.speed * dt;
    h.z += dz / d * u.speed * dt;
  }

  _face(h, tx, tz) {
    // 客戶端 three 座標 z 取負,朝向公式與 game.js 的 pos 回報一致
    h.ry = Math.atan2(-(tx - h.x), tz - h.z);
  }

  /** 目標選擇:射程內最近敵人;優先英雄 > 小兵 > 建築(權重折算) */
  _acquire(h, u) {
    const range = WEAPONS[u.loadout[0]].range;
    let best = null, bestD = Infinity;
    for (const t of this.sim.ents.values()) {
      if (t.side === h.side || t.hp <= 0 || (t.hero && t.dead)) continue;
      let d = Math.hypot(h.x - t.x, h.z - t.z, (h.y || 0) - (t.hero ? (t.y || 0) : 0));
      if (d > range * 1.15) continue;                    // 稍微超程也接近(移動中會進圈)
      if (t.hero) d *= 0.55;                             // 優先咬英雄
      else if (t.kind === 'tower' || t.kind === 'base') d *= 1.3;
      if (d < bestD) { bestD = d; best = t; }
    }
    return best;
  }
}
