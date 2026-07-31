// ============ 電腦玩家(伺服器端英雄 AI)============
// 每個 bot 操控一位英雄(無人機/機甲),與人類玩家共用 sim 的英雄規則:
// 角色武器/招式解析、傷害查表、射速/射程/CD/MP 全由 sim 把關(botFire / heroBurst / heroCast)。
// 行為狀態機:PUSH(沿兵線推進)→ ENGAGE(交戰)→ RETREAT(低血撤退回堡補血)。
// NPC 路線 = 房間兵線(與小兵同一份折線),不用另外算路。
import { UNITS, GAME, WEAPONS, ECON, LOS, DECOY, hyperRange, heroWeapon, heroAbility, vsMult, botDiffOf, botOpGap, isThirdSide } from '../public/js/data.js';
import { cumLen, pointAt } from './sim.js';

const CRUISE_ALT = { min: 26, max: 52 };   // 無人機巡航高度(離地;≥AA_MIN_ALT 會吃防空飛彈,故意讓 bot 有風險)
const RETREAT_HP = 0.32;                    // 低於 32% 裝甲撤退
const RESUME_HP = 0.85;                     // 回血到 85% 再出擊

// 消費優先序(八軌,2026-07-20 面向):先重/輕武器,再大/小招,攻防交錯(sim.buy 會擋資金不足/已滿級)
const BUY_ORDER = ['hw', 'lw', 'ult', 'sk', 'hp', 'sp', 'ar', 'ch'];

export class BotBrain {
  /** sim: BattleSim;pid: 'b1' 之類字串;laneIdx: 指派兵線;diffKey: 難度(新手/低/中/高) */
  constructor(sim, pid, side, laneIdx, diffKey) {
    this.sim = sim;
    this.pid = pid;
    this.side = side;
    this.diff = botDiffOf(diffKey);   // { aimErr, heavy, ability, gap, react }
    this.lane = laneIdx % sim.lanes.length;
    this.state = 'PUSH';
    // ---- 操作節奏(見 _op)----
    this._opAt = {};    // 各類操作的下次可用時戳(sim.t)
    this._opNext = 0;   // 全域手速閘:下次可以做「任何」操作的時戳
    this._tid = 0;      // 目前咬住的目標 id(兩次掃描之間保持不變 —— 人不會每幀重選目標)
    this._aimAt = 0;    // 反應時間:換目標後準星拉到位、可以開火的時戳
    this.prog = 0;                          // 沿兵線進度(公尺,從己方端起算)
    this.alt = CRUISE_ALT.min + Math.random() * (CRUISE_ALT.max - CRUISE_ALT.min);
    this.jitter = [(Math.random() - 0.5) * 24, (Math.random() - 0.5) * 24];
    this._cum = cumLen(sim.lanes[this.lane]);
  }

  /** 目前角色輕武器實戰數值(英雄倍率 + 現階級) */
  _gun(h) { return heroWeapon(h.ch, 'light', h.abil.light, true); }

  /** 控場折速係數(招式追加)鏡像:真人玩家由客戶端自鎖,bot 的「客戶端」就是這裡 ——
   *  麻痺 = 0(原地,武器照常)、緩速 ×slowF、混亂 ×0.5(bot 沒有操縱可反轉,折半近似)。
   *  _speed 與 _push 的位置收斂共用這一縫 —— 不得在 update 各處另寫折速。 */
  _ccF(h) {
    const t = this.sim.t;
    if ((h.stunUntil || 0) > t) return 0;
    let f = 1;
    if ((h.slowUntil || 0) > t) f *= h.slowF ?? 0.6;
    if ((h.confUntil || 0) > t) f *= 0.5;
    return f;
  }

  /** 地速:變形者飛行型態用飛行巡航速度(變形趕路才有意義)× 控場折速 */
  _speed(h, u) {
    return (h.kind === 'morph' && (h.y || 0) > 2 ? UNITS.morph.fly : u.speed) * this._ccF(h);
  }

  /**
   * 操作節流(**唯一縫**;2026-07-27):難度決定「每項操作切換的時間間隔」——
   *   ①全域手速閘 `diff.gap`:一次只能做一件事,任兩次操作之間 ≥ gap(最高難度 0.15s ≈ 400 APM);
   *   ②該類操作自身的切換間隔 `botOpGap(diff, kind)` = gap × BOT_OPS[kind]。
   * 回傳 true = 這一拍可以做這項操作,並就地記時戳 ⇒ 呼叫端 MUST 在「真的要執行」時才問。
   * 持續開火不走這裡(扳機是按住的,不是每發重按一次;射速由 sim 的武器 rate 把關)。
   */
  _op(kind) {
    const t = this.sim.t;
    if (t < this._opNext || t < (this._opAt[kind] || 0)) return false;
    this._opAt[kind] = t + botOpGap(this.diff, kind);
    this._opNext = t + this.diff.gap;
    return true;
  }

  /** 開火(含反應時間 + 難度瞄準誤差:擲骰射偏則本發落空,不造成傷害)。難度越低 aimErr 越大。 */
  _fire(tid, slot) {
    if (this.sim.t < this._aimAt) return false;   // 換目標後準星還沒拉上去(反應時間)
    if (Math.random() < this.diff.aimErr) return false;
    return this.sim.botFire(this.pid, tid, slot);
  }

  /**
   * 目標維持/切換:掃描選敵是一項操作(`scan`),兩次掃描之間**咬住同一個目標**;
   * 目標失效(死亡/脫離/匿蹤)才立即放掉。換到新目標 → 加一段反應時間(`diff.react`)才開得了火。
   */
  _target(h) {
    let t = this._tid ? this.sim.ents.get(this._tid) : null;
    if (t && (t.hp <= 0 || t.side === h.side || t.neutral || t.gar
      || (t.hero && (t.dead || (t.stealthUntil || 0) > this.sim.t)))) { t = null; this._tid = 0; }
    if (t && Math.hypot(h.x - t.x, h.z - t.z) > this._gun(h).range * 1.15) { t = null; this._tid = 0; }
    if (!this._op('scan')) return t;                  // 手速/掃描間隔未到:維持現有目標
    const nt = this._acquire(h);
    if ((nt ? nt.id : 0) !== this._tid) {
      this._tid = nt ? nt.id : 0;
      if (nt) this._aimAt = this.sim.t + this.diff.react;   // 新目標:反應時間 + 拉準星
    }
    return nt;
  }

  update(dt) {
    const sim = this.sim;
    const h = sim.heroes.get(this.pid);
    if (!h || sim.over) return;
    if (h.dead) { this.state = 'PUSH'; this.prog = 0; return; }

    const u = UNITS[h.kind];
    const frac = h.hp / h.maxHp;
    // 撤退/回頭是「下決心」型的操作(不是看到血條就瞬間轉身)⇒ 吃 state 間隔,難度越低越晚察覺。
    // ENGAGE/PUSH 不另外收費:它只是「眼前有沒有目標」的結果,目標本身已由 scan + react 節流過。
    if (this.state !== 'RETREAT' && frac < RETREAT_HP && this._op('state')) this.state = 'RETREAT';
    if (this.state === 'RETREAT' && frac >= RESUME_HP && this._op('state')) { this.state = 'PUSH'; this.prog = 0; }

    const target = this._target(h);
    if (this.state !== 'RETREAT') this.state = target ? 'ENGAGE' : 'PUSH';

    // 經濟:依 BUY_ORDER 逐項升級(階梯單價,資金/滿級門檻由 sim.buy 把關)。
    // 開商店也是一項操作 ⇒ 巡店間隔隨難度拉長(高難度 ≈ 4s,同 2026-07-27 前的節奏)
    if (h.money >= ECON.UPG_BASE && this._op('buy')) {
      let bought = false;
      for (const item of BUY_ORDER) {
        // 不使用招式的難度(新手/低):不買招式面向,把錢留給武器/防禦強化
        if (!this.diff.ability && (item === 'sk' || item === 'ult')) continue;
        if (sim.buy(this.pid, item) === null) { bought = true; break; }
      }
      // 八軌全滿後的去化:把錢投進**自己這條兵線**的陣營小兵強化(門檻/價格/上限由 sim.buy 把關)。
      // 沒有這一段的話,滿裝 bot 的錢只會無限囤積,人類玩家單方面享有強化兵線。
      if (!bought) sim.buy(this.pid, 'creep', this.lane);
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
    } else if (h.kind === 'morph') {
      // 變形者:推線時飛行型態趕路,交戰/撤退回堡時落地變形(y=0 才吃地雷、脫離防空)
      const want = this.state === 'PUSH' ? this.alt : 0;
      h.y = (h.y || 0) + (want - (h.y || 0)) * Math.min(1, dt * 1.5);
      if (want === 0 && h.y < 1.5) h.y = 0;
    } else {
      h.y = 0;
    }
  }

  /** 沿指派兵線往敵方端推進(SWARM 端是折線起點) */
  _push(h, u, dt) {
    const pts = this.sim.lanes[this.lane];
    const total = this._cum[this._cum.length - 1];
    this.prog = Math.min(total, this.prog + this._speed(h, u) * 0.85 * dt);
    const d = this.side === 'SWARM' ? this.prog : total - this.prog;
    const [x, z] = pointAt(pts, this._cum, d);
    this._face(h, x, z);
    // 位置收斂同乘控場係數:prog 凍結(麻痺)時機體不得再以指數速率滑回線上目標點
    const cf = this._ccF(h);
    h.x += (x + this.jitter[0] - h.x) * Math.min(1, dt * 2.2 * cf);
    h.z += (z + this.jitter[1] - h.z) * Math.min(1, dt * 2.2 * cf);
    // 繞開阻擋型障礙物,不卡在牆前(貼地移動才會撞到;無人機/飛行型變形者飛越)
    if (h.kind !== 'drone' && (h.y || 0) < 2) {
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
        if (this._op('ability')) this.sim.heroCast(this.pid, slot);   // 按 Q/E 是一項操作
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
    const spd = this._speed(h, u);                       // 控場(麻痺/緩速/混亂)折算後的地速
    const vx = dx / d * radial * spd + (-dz / d) * strafe * spd;
    const vz = dz / d * radial * spd + (dx / d) * strafe * spd;
    h.x += vx * dt;
    h.z += vz * dt;
    this._face(h, t.x, t.z);
    this._fire(t.id, 'light');

    // 重武器(CD 由 sim 的 mag/reload 把關):建築或成群敵人時出手。新手難度不使用重武器。
    const hv = heroWeapon(h.ch, 'heavy', h.abil.heavy, true);
    const packed = [...this.sim.ents.values()].filter((e2) =>
      e2.side !== h.side && !e2.neutral && Math.hypot(e2.x - t.x, e2.z - t.z) <= (hv.r || 10) * 1.5).length;
    // 切瞄準模式 + 打一發重武器 = 一項操作(`weapon`):難度越低,輕/重武器切換越遲鈍。
    // 裝填中/空夾就別付這格手速(打不出來的按鍵不該排擠掃描與招式;比照招式的 _ready 先驗再花)
    const hvReady = !((h.reloadUntil?.heavy || 0) > this.sim.t || h.ammo?.heavy === 0);
    if (this.diff.heavy && (packed >= 3 || t.kind === 'tower' || t.kind === 'base' || t.hero)
      && hvReady && this.sim.t >= this._aimAt && this._op('weapon')) {
      h.aiming = true;   // 重武器需瞄準模式,bot 開火前直接切換(無真人輸入)
      if (hv.type === 'launcher' || hv.type === 'missile') {
        // 對空引爆高度:目標是飛行機體(英雄/直升機)就在其高度炸(火箭筒對空)
        const ty = t.hero || t.kind === 'heli' ? (t.y || 0) : 0;
        // 彈道被大型障礙擋住 = 不發射(真人的火箭由客戶端彈道擋牆、落點回報在牆前;
        // bot 沒有客戶端彈道,這裡補上與 botFire 同一條 LOS 規則,否則火箭穿建物直接命中)
        if (Math.random() >= this.diff.aimErr
          && !this.sim._losBlocked(h.x, h.z, (h.y || 0) + LOS.EYE_M, t.x, t.z, this.sim._tgtY(t), h, t)) {
          this.sim.heroBurst(this.pid, t.x, t.z, ty);
        }
      } else if (hv.type === 'plasma') {
        this.sim.heroPlasma(this.pid, t.x - h.x, t.z - h.z);
      } else this._fire(t.id, 'heavy');
    }

    // 攻擊型招式:對準目標丟(strike/emp/summon;範圍/MP/CD 由 sim 把關)。低/新手難度不使用招式。
    // 每次施放吃一格 `ability` 間隔 —— 真人不可能同一瞬間把 Q 跟 E 一起按下去。
    if (this.diff.ability) for (const slot of ['skill', 'ult']) {
      const A = this._ready(h, slot);
      if (!A) continue;
      const cast = (aimed) => this._op('ability')
        && (aimed ? this.sim.heroCast(this.pid, slot, t.x, t.z) : this.sim.heroCast(this.pid, slot));
      if ((A.fx === 'strike' || A.fx === 'emp') && packed >= 3) cast(true);
      else if (A.fx === 'summon' || A.fx === 'vision') cast(true);
      else if (A.fx === 'buff' && A.mul?.dmg) cast(false);
      else if (A.fx === 'intercept' && this.sim.missiles.some((m) => m.tpid === this.pid)) cast(false);
    }

    // 機種絕招(長按右鍵)= 一項操作,三機種共用同一格 `special` 手速閘;CD 一律由 sim 把關,
    // 但**冷卻中不付這格手速**(30s CD 內每 0.75s 空按一次會吃掉近兩成的操作額度)。
    // 三招的釋放時機都取「打得痛的那一刻」:敵群密集 or 正在拆建築。
    if (h.kind === 'drone') {
      const b = WEAPONS[UNITS.drone.bomb];
      const near = [...this.sim.ents.values()].filter((e2) =>
        e2.side !== h.side && !e2.hero && !e2.neutral
        && Math.hypot(e2.x - h.x, e2.z - h.z, (h.y || 0)) <= b.r * 2).length;
      const onStruct = (t.kind === 'tower' || t.kind === 'base')
        && Math.hypot(t.x - h.x, t.z - h.z, h.y || 0) <= b.r * 3;
      // 機種絕招(長按右鍵)= 一項操作,吃 `special` 間隔;CD 仍由 sim 把關,
      // 但冷卻中不付這格手速(30s CD 內每 0.75s 空按一次會吃掉近兩成的操作額度)
      const kamiReady = this.sim.t >= (h.sq?.kamiCd || 0);
      if ((near >= 3 || onStruct) && kamiReady && this._op('special')) {
        this.sim.heroLock(this.pid, t.id);
        this.sim.heroKamikaze(this.pid);
      }
    }
    // 變形者集束炸彈:轟炸機沿機首直飛,故要求目標大致在正前方(不能操舵 —— 對著側面放等於浪費一次 CD)
    if (h.kind === 'morph') {
      const ready = !h.sq?.decoy && this.sim.t >= (h.sq?.decoyCd || 0);
      const d = Math.hypot(t.x - h.x, t.z - h.z);
      let dr = Math.atan2(-(t.x - h.x), t.z - h.z) - (h.ry || 0);
      while (dr > Math.PI) dr -= Math.PI * 2;
      while (dr < -Math.PI) dr += Math.PI * 2;
      if (ready && d <= DECOY.LINK_M && Math.abs(dr) < 0.5 && this._op('special')) {
        this.sim.heroLock(this.pid, t.id);
        this.sim.heroDecoy(this.pid);
      }
    }
    // 機甲極音速飛彈:射後不理 ⇒ 只要目標在接戰距離內就能放(不必維持瞄準),優先砸建築
    if (h.kind === 'robot') {
      const ready = !h.hyper && this.sim.t >= (h.hyperCd || 0);
      const d = Math.hypot(t.x - h.x, t.z - h.z);
      if (ready && d <= hyperRange() && this._op('special')) {
        this.sim.heroLock(this.pid, t.id);
        this.sim.heroHyper(this.pid);
      }
    }
  }

  _moveToward(h, u, [tx, tz], dt) {
    const dx = tx - h.x, dz = tz - h.z;
    const d = Math.hypot(dx, dz);
    if (d < 30) return;                                  // 到堡附近等補血
    this._face(h, tx, tz);
    h.x += dx / d * this._speed(h, u) * dt;
    h.z += dz / d * this._speed(h, u) * dt;
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
      if (t.side === h.side || t.neutral || t.gar || t.hp <= 0 || (t.hero && t.dead)) continue;   // 不浪費彈藥打中立障礙/駐守兵
      if (t.hero && (t.stealthUntil || 0) > this.sim.t) continue;    // 匿蹤英雄鎖不到
      let d = Math.hypot(h.x - t.x, h.z - t.z, (h.y || 0) - (t.hero ? (t.y || 0) : 0));
      if (d > range * 1.15) continue;                    // 稍微超程也接近(移動中會進圈)
      // 便宜的射程淘汰在前、_visibleTo(LOS 上線後含遮蔽 trace)在後 —— 全圖打不到的目標不付視野成本
      if (sources && !this.sim._visibleTo(t, this.side, sources)) continue;   // 迷霧外 → 看不見,不鎖定
      if (t.hero) d *= 0.55;                             // 優先咬英雄
      else if (t.kind === 'tower' || t.kind === 'base') d *= 1.3;
      else if (isThirdSide(t.side)) d *= 1.8;            // 第三方野營:順路才打,不主動棄線刷錢
      d /= vsMult(wd, t.kind);                            // 優先打武器克制的目標類型
      if (d < bestD) { bestD = d; best = t; }
    }
    return best;
  }
}
