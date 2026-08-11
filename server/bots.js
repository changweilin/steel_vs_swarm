// ============ 電腦玩家(伺服器端英雄 AI)============
// 每個 bot 操控一位英雄(無人機/機甲),與人類玩家共用 sim 的英雄規則:
// 角色武器/招式解析、傷害查表、射速/射程/CD/MP 全由 sim 把關(botFire / heroBurst / heroCast)。
// 行為狀態機:PUSH(沿兵線推進)→ ENGAGE(交戰)→ RALLY(退到砲塔後方等護盾)→ RETREAT(回堡補血)。
// NPC 路線 = 房間兵線(與小兵同一份折線),不用另外算路。
import { UNITS, GAME, ECON, LOS, heroWeapon, heroAbility, vsMult, botDiffOf, botOpGap, isThirdSide,
  CHARACTERS, heroMobility,
  VITALS,
  BOT_VIEW, botFovHalf, viewLockStep, wrapPi,
  BOT_TACTIC, botTargetPrio, botThreatDecay, botSalvo, botExecW, botKiteF,
  botRoleOf, botRoleTactic, botBuyOrder } from '../public/js/data.js';
import { cumLen, pointAt } from './sim.js';

const CRUISE_ALT = { min: 26, max: 52 };   // 無人機巡航高度(離地;≥AA_MIN_ALT 會吃防空飛彈,故意讓 bot 有風險)
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

// 消費優先序(八軌,2026-07-20 面向)住 `data.js BOT_BUY_ORDER`,逐定位的順序走 `botBuyOrder`
// (2026-08-08 定位分類改制)—— 兩邊各留一份的話,改定位採購順序時基準那份不會跟著動。

export class BotBrain {
  /** sim: BattleSim;pid: 'b1' 之類字串;laneIdx: 指派兵線;diffKey: 難度(新手/低/中/高) */
  constructor(sim, pid, side, laneIdx, diffKey) {
    this.sim = sim;
    this.pid = pid;
    this.side = side;
    this.diff = botDiffOf(diffKey);   // { aimErr, heavy, ability, gap, react }
    // 戰術旋鈕表的**唯一讀取縫**:預設 = 全域 BOT_TACTIC(含 botPolicy.js 學習成果)。
    // 離線學習迴圈(tools/bot_learn.mjs)逐 brain 注入候選策略時只換這一個參照 ——
    // bots.js 其餘各處 MUST 經 this.tac 取旋鈕,MUST NOT 再直接讀 BOT_TACTIC.*。
    this.tac = BOT_TACTIC;
    // 機體定位(2026-08-08「依機體技能等數值為電腦玩家分類,並設計不同策略」)——
    // 解析點只有 `_resolveRole` 一處,且只在有 `tactic` 旗標的難度下發生(A33:新手/低難度
    // 逐位元維持舊制)。這裡不能先解析:角色由 sim.addHero 指派、而學習迴圈是在 **構造之後**
    // 才注入基準策略(`b.tac = candTac`),在構造函式裡定案會被那一行整份蓋掉。
    this._role = null;      // 定位鍵('raider'|'zoner'|'siege'|'support');null = 無定位(同基準)
    this._roleCh = null;    // 已解析過的角色(換角色才重解)
    this._tacBase = null;   // 定位覆寫的基準表(= 解析當下的 this.tac,含學習成果)
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
    this._rallyAt = null;  // 集結點世界座標(RALLY 進場時定案,見 _pickRally)
    this._rallyProg = 0;   // 集結點的沿兵線進度(復出時 prog 從這裡接回,不是從主堡重走)
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

  /** 地速:變形者飛行型態用飛行巡航速度(變形趕路才有意義)× 控場折速。
   *  取速一律經 `heroMobility`(A32「電腦玩家 MUST NOT 比真人多看/多走」的同一條):
   *  那支才含角色 `mods.speed` 與移速壓縮,直接讀 `UNITS[kind].speed` = bot 跑的是機種基準速。 */
  _speed(h) {
    return heroMobility(h.kind, CHARACTERS[h.ch]?.mods, this._fly(h)) * this._ccF(h);
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
    this._resolveRole(h);

    const u = UNITS[h.kind];
    const frac = h.hp / h.maxHp;
    const spF = h.maxSp > 0 ? (h.sp || 0) / h.maxSp : 1;
    // 撤退/回頭是「下決心」型的操作(不是看到血條就瞬間轉身)⇒ 吃 state 間隔,難度越低越晚察覺。
    // ENGAGE/PUSH 不另外收費:它只是「眼前有沒有目標」的結果,目標本身已由 scan + react 節流過。
    // **MUST 維持短路**:`_op` 一旦回 true 就吃掉一格全域手速,無條件問等於每拍都在付錢。
    const want = this._pullWant(h, frac, spF);
    if (want && this.state !== want && this._op('state')) this._enterPull(h, want);
    else if (this.state === 'RETREAT' && frac >= this.tac.RESUME_HP && this._op('state')) this._resume(0);
    else if (this.state === 'RALLY' && spF >= this.tac.RALLY_SP && this._op('state')) this._resume(this._progAt(h));

    const target = this._target(h);
    if (!this._pulling()) this.state = target ? 'ENGAGE' : 'PUSH';

    // 經濟:依 BUY_ORDER 逐項升級(階梯單價,資金/滿級門檻由 sim.buy 把關)。
    // 開商店也是一項操作 ⇒ 巡店間隔隨難度拉長(高難度 ≈ 4s,同 2026-07-27 前的節奏)
    if (h.money >= ECON.UPG_BASE && this._op('buy')) {
      let bought = false;
      // 採購順序隨定位換(攻堅先買重武器與護甲、支援先買招式與充能…);無定位 = 舊制順序
      for (const item of botBuyOrder(this._role)) {
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
    else if (this.state === 'RALLY') this._rally(h, u, target, dt);
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

  /**
   * 機體定位解析(**唯一縫**;每個角色只做一次)。定位怎麼算住 `data.js botRoleOf`,
   * 策略怎麼疊住 `botRoleTactic` —— bots.js MUST NOT 比對定位鍵寫任何 `if (role === …)`
   * 行為分支(那就是第二套決策系統,而且會與難度分層打架)。
   *
   * 三條:①**只在 `diff.tactic` 之下解析** ⇒ 新手/低難度的 `this.tac` 恆是注入/全域那一份,
   * 結構性地逐位元同舊制(A33);②**基準只記一次**(`_tacBase`):不記的話每次重解都會把
   * 上一輪覆寫過的表再乘一次乘數 —— 換角色幾次之後距離環就飄到夾制邊界上,而且完全無聲;
   * ③換角色(換座機/重生抽到別台)才重解,同一台不重複算。
   */
  _resolveRole(h) {
    if (!this.diff.tactic || h.ch === this._roleCh) return;
    this._roleCh = h.ch;
    if (this._tacBase == null) this._tacBase = this.tac;   // 學習迴圈注入的那一份 = 基準
    this._role = botRoleOf(h.ch);
    this.tac = botRoleTactic(this._tacBase, this._role);
  }

  /** 沿指派兵線往敵方端推進(SWARM 端是折線起點) */
  _push(h, u, dt) {
    const pts = this.sim.lanes[this.lane];
    const total = this._cum[this._cum.length - 1];
    this.prog = Math.min(total, this.prog + this._speed(h) * 0.85 * dt);
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
    if (Math.hypot(h.x - x, h.z - z) > 90) this.prog = Math.max(0, this.prog - this._speed(h) * dt * 4);
  }

  /** 目前是否處於「脫離交戰」狀態(回堡 or 退到砲塔後方)—— 兩者共用的判斷,MUST NOT 逐處展開 */
  _pulling() { return this.state === 'RETREAT' || this.state === 'RALLY'; }

  /**
   * 撤退線(2026-08-02 使用者定案)。回傳這一拍**應該**待在哪個脫離狀態(null = 不必脫離):
   *   裝甲 < BASE_HP                     → 'RETREAT'(回主堡補血;唯一會離開兵線的情況)
   *   裝甲 < PULL_HP 且護盾扛掉一半      → 'RALLY' (退到最近砲塔後方等護盾)
   *   高難度:護盾扛掉一半(不看裝甲)   → 'RALLY' (「扛半條護盾就後撤」)
   *
   * 三道閘缺一不可,每一道都對應一個實測到的壞掉方式:
   * ①**進場看 PULL_SP、出場看 RALLY_SP** 的遲滯帶 —— 裝甲離開主堡不會自己回,若進場只看
   *   裝甲,「退到塔後 → 護盾滿 → 回去 → 血還是低 → 又退」會在門檻上無限抖動。
   * ②**RETREAT 不被 RALLY 搶走** —— 回主堡是長途行程,裝甲只有主堡補得回來(sim 的
   *   HERO_HEAL_R 內才回血);半路被護盾規則叫去集結點 = 整趟白跑,還帶著一管殘血回前線。
   * ③**「扛掉半條護盾」量的是這一波真的吃下多少傷害,不是「護盾現在剛好低於一半」** ——
   *   兩者聽起來一樣,實測差了一倍的攻堅產出。兵線上的小兵零星刮擦會讓護盾長時間掛在半條
   *   以下(護盾要脫戰 `VITALS.OOC_S` 秒才開始回),照「當下水位」判 ⇒ bot 幾乎一直在撤退:
   *   2026-08-02 實測 RALLY 吃掉 37% 的場次時間、工事損血腰斬、擊殺 −41%。改量近期傷害後,
   *   一波英雄集火照樣觸發(6 秒內半條護盾),而小兵刮擦不會。近期傷害吃 `_threatOf` 那份帳
   *   (`_hurtLog` 唯一縫,MUST NOT 另開第二份記帳);「還在挨打」吃 `VITALS.OOC_S`
   *   (= 護盾還沒開始回復的那段),MUST NOT 另立第二個交戰判定。
   *
   * 中難度那條刻意**不吃** ③:它的危險訊號是「裝甲只剩三成」,慢慢被磨掉半條護盾一樣該撤。
   * 沒有 tactic 旗標的難度(新手/低)只剩舊制那一條(門檻 PULL_HP、目的地主堡)⇒ 逐位元不變。
   */
  _pullWant(h, frac, spF) {
    if (!this.diff.tactic) return frac < this.tac.PULL_HP ? 'RETREAT' : null;
    if (frac < this.tac.BASE_HP) return 'RETREAT';
    if (this.state === 'RETREAT') return 'RETREAT';
    if (spF >= this.tac.PULL_SP) return null;
    if (!this._inFight(h)) return null;                                   // 已脫戰:護盾正在回,沒有危險
    if (frac < this.tac.PULL_HP) return 'RALLY';                        // 中/高:裝甲也見底
    if (this.diff.elite && this._recentDmg(h) >= this.tac.PULL_SP * (h.maxSp || 0)) return 'RALLY';
    return null;
  }

  /** 還在挨打嗎(**唯一縫**:撤退判定與集結行為同吃)。定義直接借 sim 的脫戰秒數 ——
   *  「護盾還沒開始回復」與「還在戰鬥中」本來就是同一件事,MUST NOT 另立第二個交戰判定。 */
  _inFight(h) { return this.sim.t - (h.lastHitAt ?? -99) < VITALS.OOC_S; }

  /**
   * 最近 `THREAT_S` 秒內**被活的敵人**打掉多少(線性淡出)。與選敵的威脅值同一份帳、同一支
   * 淡出曲線 —— MUST NOT 為撤退另記一份。
   *
   * **塔/主堡的刮傷不算**(與 `_prioritize` 排除工事總輸出同一條理由):拆塔本來就是站在塔的
   * 射程裡挨打,把那份算進「扛了半條護盾」⇒ bot 每次攻堅到一半就自己退掉,攻堅產出直接腰斬
   * (2026-08-02 實測)。工事打不死你的時候該退的訊號是**裝甲**(PULL_HP / BASE_HP 那兩條),
   * 不是護盾。
   */
  _recentDmg(h) {
    let s = 0;
    for (const r of h._threat?.values() || []) {
      if (r.k === 'tower' || r.k === 'base') continue;
      s += r.v * botThreatDecay(this.sim.t - r.t, this.tac);
    }
    return s;
  }

  /** 進入脫離狀態;集結點在**進場當下**定案(退到一半塔被拆了不重算 —— 那會讓機體在半路掉頭) */
  _enterPull(h, want) {
    this.state = want;
    if (want === 'RALLY') this._pickRally(h);
  }

  /** 復出:回到推線,沿兵線進度從 `prog` 接回(回堡的那條從 0 重走,集結的接回**當下位置**) */
  _resume(prog) { this.state = 'PUSH'; this.prog = prog; }

  /**
   * 機體目前位置投影回兵線的「己方端進度」(公尺)。
   * 集結復出 MUST 吃這個而不是集結點的進度:脫離接觸往往在退到砲塔之前就成立(停火 5 秒就
   * 脫戰),此時把 prog 設回砲塔後方 = `_push` 會先把機體**往回**拉到砲塔才開始推,白丟一整段
   * 兵線。`prog` 本身在 ENGAGE/RALLY 期間是凍結的(只有 `_push` 會推進),不能直接沿用。
   */
  _progAt(h) {
    const pts = this.sim.lanes[this.lane];
    const cum = this._cum;
    let bestD = Infinity, bestAt = 0;
    for (let i = 1; i < pts.length; i++) {
      const ax = pts[i - 1][0], az = pts[i - 1][1];
      const ex = pts[i][0] - ax, ez = pts[i][1] - az;
      const L2 = ex * ex + ez * ez || 1;
      let s = ((h.x - ax) * ex + (h.z - az) * ez) / L2;
      s = s < 0 ? 0 : s > 1 ? 1 : s;
      const dx = h.x - (ax + ex * s), dz = h.z - (az + ez * s);
      const d = dx * dx + dz * dz;
      if (d < bestD) { bestD = d; bestAt = cum[i - 1] + (cum[i] - cum[i - 1]) * s; }
    }
    const total = cum[cum.length - 1];
    return this.side === 'SWARM' ? bestAt : total - bestAt;   // 一律換算回「己方端起算」
  }

  /**
   * 集結點 = **最近一座己方存活砲塔後方**的兵線點(使用者定案「撤退到最近砲塔後方兵線」)。
   * 塔位一律吃 `sim.towerSites`(與開場預置兵線同一份解,MUST NOT 再解一次);但 towerSites 是
   * 開局定案的**位置表**,不知道塔死了沒 ⇒ 逐塔位確認還有活著的己方塔,否則等於退進一個空位、
   * 正好落在敵方推進的路線上。一座都不剩就退回主堡(原則 6 降級不例外)。
   */
  _pickRally(h) {
    const sim = this.sim;
    const total = this._cum[this._cum.length - 1];
    let bestD = Infinity, bestFrac = null;
    for (const st of sim.towerSites?.[this.lane] || []) {
      const p = st[this.side];
      if (!p) continue;
      // 同一個塔位左右各一座(GAME.TOWER_SIDE_OFF),取涵蓋兩座的半徑判存活
      let alive = false;
      for (const e of sim.ents.values()) {
        if (e.kind !== 'tower' || e.side !== this.side || e.hp <= 0) continue;
        if (Math.hypot(e.x - p.x, e.z - p.z) <= GAME.TOWER_SIDE_OFF * 1.5) { alive = true; break; }
      }
      if (!alive) continue;
      const d = Math.hypot(h.x - p.x, h.z - p.z);
      if (d < bestD) { bestD = d; bestFrac = st.frac; }
    }
    if (bestFrac == null) { this._rallyProg = 0; this._rallyAt = sim.basePos[this.side]; return; }
    // frac 自**己方端**起算(與 solveTowerSites / this.prog 同框)⇒ 減去 RALLY_BACK_M 就是塔後方
    this._setRally(Math.max(0, total * bestFrac - this.tac.RALLY_BACK_M));
  }

  /** 集結點寫入的唯一縫:己方端進度 → 世界座標(兩種集結點共用同一條換算) */
  _setRally(prog) {
    const total = this._cum[this._cum.length - 1];
    this._rallyProg = prog;
    this._rallyAt = pointAt(this.sim.lanes[this.lane], this._cum, this.side === 'SWARM' ? prog : total - prog);
  }

  /**
   * 集結撤退:**還在挨打就邊退邊打、脫離接觸就停下來等護盾**。
   *
   * 兩半各自對應一個實測到的壞掉方式:
   *   ①退的時候不還手 = 轉身送人頭 ⇒ 還在接觸時照樣開火(這就是「打帶跑」的宏觀版本)。
   *   ②脫離接觸之後還繼續開火 = **護盾永遠回不來**:護盾要脫戰 `VITALS.OOC_S` 秒才開始回,
   *     而開火會引來還擊、把脫戰計時一直重置 ⇒ bot 卡在 RALLY 直到裝甲見底才回主堡
   *     (2026-08-02 實測:RALLY 吃掉 36% 的場次時間,而「等滿護盾」那個出場條件幾乎從沒
   *     成立過)。停火停步 = 真人退到安全處按住不動等盾的那個動作。
   *
   * 位置一樣走 `_moveToward` 的碰撞唯一縫;`_face` 只寫意圖(不動 h.ry)⇒ 排在移動之後
   * 就能把視角搶回目標身上。
   */
  _rally(h, u, t, dt) {
    if (!this._inFight(h)) {                       // 已脫離接觸:原地停火等護盾回滿
      if (t) this._face(h, t.x, t.z);              // 但眼睛還是盯著人(免得被繞後)
      else this._faceLaneFwd(h);
      return;
    }
    this._moveToward(h, u, this._rallyAt || this.sim.basePos[this.side], dt);
    if (t) { this._face(h, t.x, t.z); this._fire(t.id, 'light'); return; }
    this._faceLaneFwd(h);
  }

  /** 面向兵線的敵方端(集結等護盾時的預設朝向)——背對戰場等於白白讓人繞後,
   *  而 `_acquire` 只認前方視野錐,轉錯邊 = 對來襲的敵人整批失明。 */
  _faceLaneFwd(h) {
    const total = this._cum[this._cum.length - 1];
    const fwd = this.side === 'SWARM' ? 1 : -1;
    const d = this.side === 'SWARM' ? this._rallyProg : total - this._rallyProg;
    const [lx, lz] = pointAt(this.sim.lanes[this.lane], this._cum, Math.max(0, Math.min(total, d + fwd * PUSH_LOOK_M)));
    this._face(h, lx, lz);
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
      const hurt = frac < this.tac.CAST_HURT;   // 血線走旋鈕(支援型放得早、攻堅型撐得久)
      if ((A.fx === 'heal' && hurt)
        || (A.fx === 'buff' && A.mul?.dmgTaken && hurt)
        || (A.fx === 'stealth' && this._pulling())) {
        if (this._op('ability')) this.sim.heroCast(this.pid, slot);   // 按 Q/E 是一項操作
      }
    }
  }

  /** 交戰:保持在射程 60~85% 的距離環,邊打邊橫移 */
  _engage(h, u, t, dt) {
    const gun = this._gun(h);
    const dx = t.x - h.x, dz = t.z - h.z;
    const d = Math.hypot(dx, dz) || 1;
    // 打帶跑(高難度):裝填中拉到射程外緣、可擊發時再貼上去 —— 比例走 botKiteF 單一縫。
    // 量的是**裝填**而不是逐發射速間隔:後者只有零點幾秒,照著它進退只會抖成原地震動。
    // 建築(塔/主堡)不套 —— 它們不會追,拉開只是白白少打幾秒。
    const struct = t.kind === 'tower' || t.kind === 'base';
    const kite = this.diff.elite && !struct
      ? botKiteF(!((h.reloadUntil?.light || 0) > this.sim.t), this.tac) : this.tac.KEEP_F;
    const keep = gun.range * (struct ? this.tac.KEEP_STRUCT : kite);
    const radial = (d - keep) / Math.max(1, d);          // >0 靠近、<0 拉開
    const strafe = Math.sin(this.sim.t * 0.9 + this.lane * 2) * 0.6;
    const spd = this._speed(h);                       // 控場(麻痺/緩速/混亂)折算後的地速
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

    // 機種絕招(飽和攻擊 / 集束炸彈 / 極音速飛彈)2026-08-06 整組退場,MUST NOT 復辟:
    // 長按右鍵改成招式手勢(一般 = 小招 / 狙擊 = 大招)⇒ bot 這邊也只剩上面的 heroCast 兩條路,
    // 三種載具只由 sim._launchUltCarrier 生成。`special` 那一格手速因此不再有消費端。
  }

  _moveToward(h, u, [tx, tz], dt) {
    const dx = tx - h.x, dz = tz - h.z;
    const d = Math.hypot(dx, dz);
    if (d < 30) return;                                  // 到堡附近等補血
    this._face(h, tx, tz);
    const [gx, gz] = this._skirt(h, tx, tz);             // 撤退路上一樣會撞牆 ⇒ 同一套繞行
    const gd = Math.hypot(gx - h.x, gz - h.z) || 1;
    const step = this._speed(h) * dt;
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

  /**
   * 這個敵人最近對我造成的傷害(威脅值)。來源**只有** `sim._hurtLog` 那一份帳(與濺血提示、
   * 受擊警戒同一份)—— bots.js MUST NOT 自己從血量落差反推攻擊者(A1 家族)。
   * 英雄以 pid 為鍵:整組小隊打我 = 同一個人打我(記帳端同判)。
   */
  _threatOf(h, t) {
    const r = h._threat?.get(t.hero ? t.pid : t.id);
    return r ? r.v * botThreatDecay(this.sim.t - r.t, this.tac) : 0;
  }

  /**
   * 目標選擇:**前方視野錐內**、射程內最近的敵人;優先英雄 > 小兵 > 建築(權重折算)。
   * 中難度以上再套一層**戰術優先度**(2026-08-02 使用者需求),見 `_prioritize`。
   */
  _acquire(h) {
    const wd = this._gun(h);
    const range = wd.range;
    const fovHalf = this._fovHalf(h);   // 前方視野半角(推導不手寫,見 data.js botFovHalf)
    // 迷霧內的敵人 bot 一律看不見(不再全知作弊):己方視野外的單位不列入鎖定。
    // 塔/主堡/中立恆可見;偵察脈衝生效中該方視同無霧(與 sim.snapshotFor / heroHit 同判定)。
    const pulse = this.sim.visionUntil?.[this.side] > this.sim.t;
    const sources = pulse ? null : this.sim._visionSources(this.side);
    const cand = [];
    for (const t of this.sim.ents.values()) {
      if (t.side === h.side || t.neutral || t.gar || t.hp <= 0 || (t.hero && t.dead)) continue;   // 不浪費彈藥打中立障礙/駐守兵
      if (this.sim.siegeLocked(t)) continue;   // 攻堅順序未到的建築完全免傷 ⇒ 不當目標(唯一縫 sim.siegeLocked)
      if (t.hero && (t.stealthUntil || 0) > this.sim.t) continue;    // 匿蹤英雄鎖不到
      let d = Math.hypot(h.x - t.x, h.z - t.z, (h.y || 0) - (t.hero ? (t.y || 0) : 0));
      if (d > range * 1.15) continue;                    // 稍微超程也接近(移動中會進圈)
      // 前方視野錐(2026-08-02 使用者定案「不可以有全角度視野」):真人只看得到螢幕上那一塊,
      // bot 也只認機體正前方 ±botFovHalf。背後的敵人要嘛開火把它打醒(_alertLook 轉頭),
      // 要嘛自己走進錐內 —— MUST NOT 退回全角度掃描。塔/主堡同樣吃這一條(真人也得轉頭才看得到)。
      if (Math.abs(this._bearing(h, t.x, t.z)) > fovHalf) continue;
      // 便宜的射程/視野錐淘汰在前、_visibleTo(LOS 上線後含遮蔽 trace)在後 —— 打不到的目標不付視野成本
      if (sources && !this.sim._visibleTo(t, this.side, sources)) continue;   // 迷霧外 → 看不見,不鎖定
      // 類別折算走旋鈕(定位覆寫的落點:攻堅型把工事的加價收掉去咬塔、突襲型加得更兇去獵人)
      if (t.hero) d *= this.tac.PRIO_HERO;               // 優先咬英雄
      else if (t.kind === 'tower' || t.kind === 'base') d *= this.tac.PRIO_STRUCT;
      else if (isThirdSide(t.side)) d *= 1.8;            // 第三方野營:順路才打,不主動棄線刷錢
      d /= vsMult(wd, t.kind);                            // 優先打武器克制的目標類型
      cand.push({ t, d });
    }
    if (this.diff.tactic) this._prioritize(h, wd, cand);   // 中難度以上:再套戰術優先度
    let best = null, bestD = Infinity;
    for (const c of cand) if (c.d < bestD) { bestD = c.d; best = c.t; }
    return best;
  }

  /**
   * 戰術優先度(2026-08-02 使用者需求「被打時優先對『對自己傷害最高者、造成敵人最大總傷害、
   * 快要陣亡的目標』進行攻擊」)。就地把候選的加權距離 `c.d` 除以 `botTargetPrio` —— 分數越小
   * 越優先,所以優先度越高、距離「感覺」越近。
   *
   * 三項一律**正規化成候選集內的佔比**(絕對傷害量跨場地/跨時間沒有可比性;開局的 200 點與
   * 後期的 2000 點是同一件事「他是這裡打最兇的那個」)。沒有任何人打過我 ⇒ 威脅項整組為 0,
   * 自動退化成「總輸出 + 快陣亡」,不需要另寫一條「有沒有被打」的分支。
   *
   * 總輸出**排除塔/主堡**:它們的累計傷害必然是全場最高,但建築不是靠集火解決的目標 ——
   * 收進來只會讓 bot 一頭撞進塔的射程裡(而且看起來像「AI 突然發瘋」,很難查)。
   */
  _prioritize(h, wd, cand) {
    let mT = 0, mO = 0;
    for (const c of cand) {
      const t = c.t;
      c.threat = this._threatOf(h, t);
      c.out = (t.kind === 'tower' || t.kind === 'base') ? 0 : (t.dmgOut || 0);
      const ehp = (t.hp || 0) + (t.sp || 0);
      const maxEhp = (t.maxHp || ehp) + (t.maxSp || 0);
      // 撿尾刀只給高難度:salvo 傳 0 = 關掉收割分支(中難度只剩一般的低血偏好),
      // 分歧住 botExecW 那一支,MUST NOT 在這裡另寫一次 if。
      c.exec = botExecW(ehp, maxEhp, this.diff.elite ? botSalvo(wd, t.kind, this.tac) : 0);
      if (c.threat > mT) mT = c.threat;
      if (c.out > mO) mO = c.out;
    }
    for (const c of cand) {
      c.d /= botTargetPrio({
        threat: mT > 0 ? c.threat / mT : 0,
        output: mO > 0 ? c.out / mO : 0,
        exec: c.exec,
      }, this.tac);
    }
  }
}
