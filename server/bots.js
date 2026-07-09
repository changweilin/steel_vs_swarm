// ============ 電腦玩家(伺服器端英雄 AI)============
// 每個 bot 操控一位英雄(無人機/機甲),與人類玩家共用 sim 的英雄規則:
// 角色武器/招式解析、傷害查表、射速/射程/CD/MP 全由 sim 把關(botFire / heroBurst / heroCast)。
// 行為狀態機:PUSH(沿兵線推進)→ ENGAGE(交戰)→ RETREAT(低血撤退回堡補血)。
// NPC 路線 = 房間兵線(與小兵同一份折線),不用另外算路。
import { UNITS, GAME, WEAPONS, heroWeapon, heroAbility, vsMult, botDiffOf } from '../public/js/data.js';
import { cumLen, pointAt } from './sim.js';

const CRUISE_ALT = { min: 26, max: 52 };   // 無人機巡航高度(離地;≥AA_MIN_ALT 會吃防空飛彈,故意讓 bot 有風險)
const RETREAT_HP = 0.32;                    // 低於 32% 裝甲撤退
const RESUME_HP = 0.85;                     // 回血到 85% 再出擊

// 消費優先序:先解鎖小招/大招,再升武器,再通用強化(sim.buy 會擋擊殺數/資金不足)
const BUY_ORDER = ['ab:skill', 'ab:ult', 'ab:light', 'ab:heavy', 'dmg', 'hull'];

export class BotBrain {
  /** sim: BattleSim;pid: 'b1' 之類字串;laneIdx: 指派兵線;diffKey: 難度(新手/低/中/高) */
  constructor(sim, pid, side, laneIdx, diffKey) {
    this.sim = sim;
    this.pid = pid;
    this.side = side;
    this.diff = botDiffOf(diffKey);   // { aimErr, heavy, ability }
    this.lane = laneIdx % sim.lanes.length;
    this.state = 'PUSH';
    this.prog = 0;                          // 沿兵線進度(公尺,從己方端起算)
    this.alt = CRUISE_ALT.min + Math.random() * (CRUISE_ALT.max - CRUISE_ALT.min);
    this.jitter = [(Math.random() - 0.5) * 24, (Math.random() - 0.5) * 24];
    this._cum = cumLen(sim.lanes[this.lane]);
  }

  /** 目前角色輕武器實戰數值(英雄倍率 + 現階級) */
  _gun(h) { return heroWeapon(h.ch, 'light', h.abil.light, true); }

  /** 開火(含難度瞄準誤差:擲骰射偏則本發落空,不造成傷害)。難度越低 aimErr 越大。 */
  _fire(tid, slot) {
    if (Math.random() < this.diff.aimErr) return false;
    return this.sim.botFire(this.pid, tid, slot);
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

    const target = this._acquire(h);
    if (this.state !== 'RETREAT') this.state = target ? 'ENGAGE' : 'PUSH';

    // 經濟:優先解鎖/升級招式,再買通用強化(擊殺數/資金門檻由 sim.buy 把關)
    if (h.money >= 150 && sim.t - (this._buyAt || 0) > 4) {
      this._buyAt = sim.t;
      for (const item of BUY_ORDER) {
        // 不使用招式的難度(新手/低):不解鎖招式,把錢留給武器/通用強化
        if (!this.diff.ability && (item === 'ab:skill' || item === 'ab:ult')) continue;
        if (sim.buy(this.pid, item) === null) break;
      }
    }

    // 自保/輔助類招式:低血時放治療/護盾,撤退時也用
    this._castSupport(h, frac);

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
    // 繞開阻擋型障礙物,不卡在牆前(機甲貼地移動才會撞到,無人機飛越)
    if (h.kind !== 'drone') {
      for (const [hx, hz, hr] of this.sim.hazBlockers || []) {
        const dd = Math.hypot(h.x - hx, h.z - hz);
        if (dd >= hr || dd === 0) continue;
        h.x = hx + (h.x - hx) / dd * hr;
        h.z = hz + (h.z - hz) / dd * hr;
      }
    }
    // 掉隊修正:被擊退/重生後 prog 對不上實際位置時,吸附回最近進度
    if (Math.hypot(h.x - x, h.z - z) > 90) this.prog = Math.max(0, this.prog - u.speed * dt * 4);
  }

  /** 招式可用性(解鎖 + CD + MP)——實際結算仍由 sim.heroCast 把關 */
  _ready(h, slot) {
    const lvl = h.abil[slot];
    if (!lvl || (h.acd[slot] || 0) > this.sim.t) return null;
    const A = heroAbility(h.ch, slot, lvl);
    return (A && h.mp >= A.mp) ? A : null;
  }

  /** 輔助/自保招式(不需目標點):治療、護盾、增益、匿蹤撤退 */
  _castSupport(h, frac) {
    if (!this.diff.ability) return;   // 低/新手難度:不使用招式
    for (const slot of ['skill', 'ult']) {
      const A = this._ready(h, slot);
      if (!A) continue;
      const hurt = frac < 0.55;
      if ((A.fx === 'heal' && hurt)
        || (A.fx === 'buff' && A.mul?.dmgTaken && hurt)
        || (A.fx === 'stealth' && this.state === 'RETREAT')) {
        this.sim.heroCast(this.pid, slot);
      }
    }
  }

  /** 交戰:保持在射程 60~85% 的距離環,邊打邊橫移 */
  _engage(h, u, t, dt) {
    const gun = this._gun(h);
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
    this._fire(t.id, 'light');

    // 重武器(CD 由 sim 的 mag/reload 把關):建築或成群敵人時出手。新手難度不使用重武器。
    const hv = heroWeapon(h.ch, 'heavy', h.abil.heavy, true);
    const packed = [...this.sim.ents.values()].filter((e2) =>
      e2.side !== h.side && !e2.neutral && Math.hypot(e2.x - t.x, e2.z - t.z) <= (hv.r || 10) * 1.5).length;
    if (this.diff.heavy && (packed >= 3 || t.kind === 'tower' || t.kind === 'base' || t.hero)) {
      h.aiming = true;   // 重武器需瞄準模式,bot 開火前直接切換(無真人輸入)
      if (hv.type === 'launcher') { if (Math.random() >= this.diff.aimErr) this.sim.heroBurst(this.pid, t.x, t.z); }
      else this._fire(t.id, 'heavy');
    }

    // 攻擊型招式:對準目標丟(strike/emp/summon;範圍/MP/CD 由 sim 把關)。低/新手難度不使用招式。
    if (this.diff.ability) for (const slot of ['skill', 'ult']) {
      const A = this._ready(h, slot);
      if (!A) continue;
      if ((A.fx === 'strike' || A.fx === 'emp') && packed >= 3) this.sim.heroCast(this.pid, slot, t.x, t.z);
      else if (A.fx === 'summon' || A.fx === 'vision') this.sim.heroCast(this.pid, slot, t.x, t.z);
      else if (A.fx === 'buff' && A.mul?.dmg) this.sim.heroCast(this.pid, slot);
      else if (A.fx === 'intercept' && this.sim.missiles.some((m) => m.tpid === this.pid)) {
        this.sim.heroCast(this.pid, slot);
      }
    }

    // 無人機神風:貼近建築或敵群密集時撞擊引爆(重生無冷卻,值得換)
    if (h.kind === 'drone') {
      const b = WEAPONS[UNITS.drone.bomb];
      const near = [...this.sim.ents.values()].filter((e2) =>
        e2.side !== h.side && !e2.hero && !e2.neutral
        && Math.hypot(e2.x - h.x, e2.z - h.z, (h.y || 0)) <= b.r).length;
      const onStruct = (t.kind === 'tower' || t.kind === 'base')
        && Math.hypot(t.x - h.x, t.z - h.z, h.y || 0) <= b.r * 0.8;
      if (near >= 4 || onStruct) this.sim.heroDetonate(this.pid);
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
  _acquire(h) {
    const wd = this._gun(h);
    const range = wd.range;
    // 迷霧內的敵人 bot 一律看不見(不再全知作弊):己方視野外的單位不列入鎖定。
    // 塔/主堡/中立恆可見;偵察脈衝生效中該方視同無霧(與 sim.snapshotFor / heroHit 同判定)。
    const pulse = this.sim.visionUntil?.[this.side] > this.sim.t;
    const sources = pulse ? null : this.sim._visionSources(this.side);
    let best = null, bestD = Infinity;
    for (const t of this.sim.ents.values()) {
      if (t.side === h.side || t.neutral || t.hp <= 0 || (t.hero && t.dead)) continue;   // 不浪費彈藥打中立障礙
      if (sources && !this.sim._visibleTo(t, this.side, sources)) continue;   // 迷霧外 → 看不見,不鎖定
      if (t.hero && (t.stealthUntil || 0) > this.sim.t) continue;    // 匿蹤英雄鎖不到
      let d = Math.hypot(h.x - t.x, h.z - t.z, (h.y || 0) - (t.hero ? (t.y || 0) : 0));
      if (d > range * 1.15) continue;                    // 稍微超程也接近(移動中會進圈)
      if (t.hero) d *= 0.55;                             // 優先咬英雄
      else if (t.kind === 'tower' || t.kind === 'base') d *= 1.3;
      d /= vsMult(wd, t.kind);                            // 優先打武器克制的目標類型
      if (d < bestD) { bestD = d; best = t; }
    }
    return best;
  }
}
