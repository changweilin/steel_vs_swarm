// ============ 電腦玩家(伺服器端英雄 AI)============
// 每個 bot 操控一位英雄(無人機/機甲),與人類玩家共用 sim 的英雄規則:
// 角色武器/招式解析、傷害查表、射速/射程/CD/MP 全由 sim 把關(botFire / heroBurst / heroCast)。
// 行為狀態機:PUSH(沿兵線推進)→ ENGAGE(交戰)→ RETREAT(低血撤退回堡補血)。
// NPC 路線 = 房間兵線(與小兵同一份折線),不用另外算路。
import { UNITS, GAME, WEAPONS, ECON, LOS, DECOY, hyperRange, heroWeapon, heroAbility, vsMult, botDiffOf, botOpGap, isThirdSide,
  BOT_VIEW, botFovHalf, viewLockStep, wrapPi } from '../public/js/data.js';
import { cumLen, pointAt } from './sim.js';

const CRUISE_ALT = { min: 26, max: 52 };   // 無人機巡航高度(離地;≥AA_MIN_ALT 會吃防空飛彈,故意讓 bot 有風險)
const RETREAT_HP = 0.32;                    // 低於 32% 裝甲撤退
const RESUME_HP = 0.85;                     // 回血到 85% 再出擊
const FLY_Y = 2;                            // 離地高於此 = 飛行型態(地速 / 碰撞量體同判,唯一縫)
const LANE_JITTER_M = 24;                   // 兵線側向散開幅度(峰對峰):同線多台 bot 不疊在一起
// 推線時的前瞻距離:視角改吃視野錐之後,「看向線上的目標點」= 看向**側面**(機體站在
// 目標點旁 ±LANE_JITTER_M/2 處,那條連線幾乎垂直於兵線)⇒ 一路側著頭推線、正前方的敵人
// 全數失明。前瞻 MUST 遠大於側向散開,朝向才由兵線走向主導。
const PUSH_LOOK_M = LANE_JITTER_M * 3;
// 撞牆繞行(2026-08-02 隨碰撞上線;bot 沒有尋路,正面頂著建物會原地卡死 = 兵線整條不推)。
// 靠 push-out 的切向分量本來就會沿牆滑,但凹角會鎖死 ⇒ 連續推不動就把目標點往側向挪一段,
// 換個方向再試(左右輪替)。純 AI 決策,不動任何碰撞規則。
const STUCK = { F: 0.35, S: 0.6, SKIRT_S: 1.6, SKIRT_M: 28 };

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
    this.jitter = [(Math.random() - 0.5) * LANE_JITTER_M, (Math.random() - 0.5) * LANE_JITTER_M];
    this._cum = cumLen(sim.lanes[this.lane]);
    this._wantRy = null;   // 這一拍想看的方向(h.ry 由 _turn 逐步逼近,見 _face)
    this._stuckT = 0;      // 撞牆累積秒數
    this._skirtUntil = 0;  // 繞行到期時刻
    this._skirtSide = 1;   // 繞行側(每次卡住輪替)
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

  /** 目前是否為飛行型態(**唯一縫**:地速 / 碰撞量體同判;無人機恆飛、變形者僅飛行型態)。
   *  與客戶端 `game.js _flying()` 同語意 —— 碰撞量體的 fly 旗標兩端 MUST 是同一件事。 */
  _fly(h) { return h.kind === 'drone' || (h.kind === 'morph' && (h.y || 0) > FLY_Y); }

  /** 地速:變形者飛行型態用飛行巡航速度(變形趕路才有意義)× 控場折速 */
  _speed(h, u) {
    return (h.kind === 'morph' && this._fly(h) ? UNITS.morph.fly : u.speed) * this._ccF(h);
  }

  /** 這架機體的水平半視角(弧度);推導不手寫,見 data.js botFovHalf */
  _fovHalf(h) { return botFovHalf(h.kind); }

  /** 世界點相對機體**朝向**的水平方位(rad;0 = 正前方、± = 左右)。視野錐與受擊警戒共用 */
  _bearing(h, tx, tz) { return wrapPi(Math.atan2(-(tx - h.x), tz - h.z) - (h.ry || 0)); }

  /**
   * 位置寫入的**唯一縫**:先經 `sim.solidResolve`(客戶端 `_collide` 的伺服器鏡像)夾在
   * 實體障礙之外,再寫回機體 —— bots.js MUST NOT 有第二處直接指派 `h.x`/`h.z`
   * (2026-08-02 使用者定案「移動與攻擊都不可穿牆穿越各種物理碰撞的物件」)。
   * 回傳「實際位移 ÷ 期望位移」(0~1)供撞牆繞行判斷。
   */
  _move(h, nx, nz) {
    const want = Math.hypot(nx - h.x, nz - h.z);
    const [rx, rz] = this.sim.solidResolve(h, h.x, h.z, nx, nz, this._fly(h));
    const got = Math.hypot(rx - h.x, rz - h.z);
    h.x = rx; h.z = rz;
    return want > 1e-4 ? got / want : 1;
  }

  /** 撞牆繞行:卡住期間把目標點往側向挪一段(垂直於前進方向),讓 push-out 有機會把機體滑出牆角 */
  _skirt(h, tx, tz) {
    if (this.sim.t >= this._skirtUntil) return [tx, tz];
    const dx = tx - h.x, dz = tz - h.z;
    const d = Math.hypot(dx, dz) || 1;
    const s = STUCK.SKIRT_M * this._skirtSide;
    return [tx - dz / d * s, tz + dx / d * s];
  }

  /** 撞牆記帳:`f` = _move 回報的達成率。連續推不動 STUCK.S 秒 → 換一側繞行 */
  _stuck(f, dt) {
    if (f < STUCK.F) this._stuckT += dt; else this._stuckT = 0;
    if (this._stuckT < STUCK.S || this.sim.t < this._skirtUntil) return;
    this._stuckT = 0;
    this._skirtSide = -this._skirtSide;
    this._skirtUntil = this.sim.t + STUCK.SKIRT_S;
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

    // 視角:狀態機先寫下「想看哪裡」,受擊警戒可以搶走,最後統一以角速度上限轉一步。
    this._alertLook(h);
    this._turn(h, dt);

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
    const fwd = this.side === 'SWARM' ? 1 : -1;
    const d = this.side === 'SWARM' ? this.prog : total - this.prog;
    const [x, z] = pointAt(pts, this._cum, d);
    // 朝向取**前進方向**(沿兵線前瞻),不是腳下那個目標點 —— 見 PUSH_LOOK_M
    const [lx, lz] = pointAt(pts, this._cum, Math.max(0, Math.min(total, d + fwd * PUSH_LOOK_M)));
    this._face(h, lx, lz);
    // 位置收斂同乘控場係數:prog 凍結(麻痺)時機體不得再以指數速率滑回線上目標點
    const cf = this._ccF(h);
    const [gx, gz] = this._skirt(h, x + this.jitter[0], z + this.jitter[1]);   // 撞牆繞行的側向偏移
    const k = Math.min(1, dt * 2.2 * cf);
    // 障礙迴避整組交給 `_move`(碰撞唯一縫)—— 舊制只在這裡繞開 hazBlockers,建物/神木/巨岩
    // 照穿不誤,而交戰/撤退兩段連那個都沒有。MUST NOT 在此另寫第二份推擠。
    this._stuck(this._move(h, h.x + (gx - h.x) * k, h.z + (gz - h.z) * k), dt);
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
    this._move(h, h.x + vx * dt, h.z + vz * dt);   // 走位同吃碰撞唯一縫(交戰中一樣不能穿牆)
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
    const [gx, gz] = this._skirt(h, tx, tz);             // 撤退路上一樣會撞牆 ⇒ 同一套繞行
    const gd = Math.hypot(gx - h.x, gz - h.z) || 1;
    const step = this._speed(h, u) * dt;
    this._stuck(this._move(h, h.x + (gx - h.x) / gd * step, h.z + (gz - h.z) / gd * step), dt);
  }

  /** 這一拍**想看**的方向(世界點)。只寫意圖,不動 `h.ry` —— 視角有角速度上限(跟真人一樣
   *  不能瞬間回頭),寫成兩段才不會有第二處偷偷瞬轉。客戶端 three 座標 z 取負,朝向公式與
   *  game.js 的 pos 回報一致。 */
  _face(h, tx, tz) {
    this._wantRy = Math.atan2(-(tx - h.x), tz - h.z);
  }

  /** 把朝向朝 `_wantRy` 轉一步。**`h.ry` 的唯一寫入點**;角速度上限走 `viewLockStep`
   *  (真人視野鎖定輔助的同一支)—— MUST NOT 在此手寫 rad/s,也 MUST NOT 直接指派目標角。 */
  _turn(h, dt) {
    if (this._wantRy == null) return;
    h.ry = wrapPi((h.ry || 0) + viewLockStep(wrapPi(this._wantRy - (h.ry || 0)), dt));
  }

  /**
   * 受擊警戒(2026-08-02 使用者定案「其他方向敵人來襲視角要跟著轉向」)。
   * 視野是前方錐 ⇒ 背後挨打時 bot 看不見攻擊者、也就永遠不會轉身;伺服器 `_hurtLog` 記下最後
   * 一次挨打的來源方位(與濺血提示同一份帳,唯一縫),這裡把視角**搶過去**朝它轉。
   * 轉到攻擊者落進視野錐(或警戒逾時)即交還一般看向邏輯,由 `_acquire` 正常鎖定。
   * MUST 排在狀態機之後 —— 「來襲方向優先於原本想看的方向」就是這條需求本身。
   */
  _alertLook(h) {
    const al = h._alert;
    if (!al) return;
    if (this.sim.t - al.t > BOT_VIEW.ALERT_S || Math.abs(this._bearing(h, al.x, al.z)) <= this._fovHalf(h)) {
      h._alert = null;   // 逾時 / 已經轉到看得見了
      return;
    }
    this._face(h, al.x, al.z);
  }

  /** 目標選擇:**前方視野錐內**、射程內最近的敵人;優先英雄 > 小兵 > 建築(權重折算) */
  _acquire(h) {
    const wd = this._gun(h);
    const range = wd.range;
    const fovHalf = this._fovHalf(h);   // 前方視野半角(推導不手寫,見 data.js botFovHalf)
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
      // 前方視野錐(2026-08-02 使用者定案「不可以有全角度視野」):真人只看得到螢幕上那一塊,
      // bot 也只認機體正前方 ±botFovHalf。背後的敵人要嘛開火把它打醒(_alertLook 轉頭),
      // 要嘛自己走進錐內 —— MUST NOT 退回全角度掃描。塔/主堡同樣吃這一條(真人也得轉頭才看得到)。
      if (Math.abs(this._bearing(h, t.x, t.z)) > fovHalf) continue;
      // 便宜的射程/視野錐淘汰在前、_visibleTo(LOS 上線後含遮蔽 trace)在後 —— 打不到的目標不付視野成本
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
