// ============ Computer players (server-side hero AI) ============
// Each bot drives one hero (drone/mech) under the same hero rules as humans:
// character weapon/ability resolution, damage tables, and rate/range/CD/MP all gated by sim (botFire / heroBurst / heroCast).
// Behavior state machine: PUSH (advance along lane) -> ENGAGE -> RALLY (wait behind tower for shield) -> RETREAT (recall for heals).
// NPC paths = room lanes (same polylines as creeps); no separate pathfinding.
import { UNITS, GAME, ECON, LOS, heroWeapon, heroAbility, heavyMpCost, vsMult, botDiffOf, botOpGap, isThirdSide,
  CHARACTERS, heroMobility, highSupSpeedF, BOSS,
  VITALS,
  BOT_VIEW, botFovHalf, botFovVerticalHalf, viewLockStep, wrapPi,
  botScopeSearchRad, botScopeSearchPitchRad, botScopeSearchFreq,
  bloodScreenUv, bloodDirFromUv,
  BOT_TACTIC, botTargetPrio, botThreatDecay, botSalvo, botExecW, botKiteF,
  botRoleOf, botRoleTactic, botBuyOrder, canUpgrade, CREEP_UPG, FLY_Y,
  WEATHER_DEBUFFS, windSpeedFactor, altTier } from '../public/js/data.js';
import { cumLen, pointAt } from './sim.js';

const CRUISE_ALT = { min: 26, max: 52 };   // Drone cruise altitude (AGL; at/above AA_MIN_ALT eats air-defense missiles -- bots fly at deliberate risk)
// FLY_Y (flight threshold) lives in the data.js single seam, shared with human verification in sim.heroPos (see note there).
const LANE_JITTER_M = 24;                   // Lateral lane spread (peak-to-peak): bots on one lane never stack
// Push lookahead: once vision runs through the view cone, "looking at the lane target point"
// means looking sideways (the body stands beside the target point at +-LANE_JITTER_M/2, so that
// link runs nearly perpendicular to the lane) -- pushing sideways would blind the bot to enemies
// ahead. Lookahead MUST far exceed lateral spread so lane direction dominates heading.
const PUSH_LOOK_M = LANE_JITTER_M * 3;
// Wall unsticking (bots have no pathfinding; head-on against a building wedges forever = the lane stalls).
// Push-out's tangential component already slides along walls, but concave corners lock -- after sustained
// stall the target point sidesteps and retries from another angle (alternating sides). Pure AI decision,
// touching no collision rules.
const STUCK = { F: 0.35, S: 0.6, SKIRT_S: 1.6, SKIRT_M: 28 };

// Spend priority (eight tracks) lives in `data.js BOT_BUY_ORDER`; per-role order goes through `botBuyOrder`
// -- keeping a copy on either side would let role-order edits silently desync from the baseline.

export class BotBrain {
  /** sim: BattleSim; pid: 'b1'-style string; laneIdx: assigned lane; diffKey: difficulty (novice/low/mid/high) */
  constructor(sim, pid, side, laneIdx, diffKey) {
    this.sim = sim;
    this.pid = pid;
    this.side = side;
    this.diff = botDiffOf(diffKey);   // { aimErr, heavy, ability, gap, react }
    // Single read seam for the tactic knob table: default = global BOT_TACTIC (incl. botPolicy.js learned results).
    // Offline learning loop (tools/bot_learn.mjs) swaps only this reference when injecting candidate policies per brain --
    // every other site in bots.js MUST read knobs via this.tac, MUST NOT read BOT_TACTIC.* directly.
    this.tac = BOT_TACTIC;
    // Body role (2026-08-08 "classify bots by kit stats and design per-role tactics") --
    // single resolve point `_resolveRole`, only on difficulties with the `tactic` flag (A33: novice/low stay bit-identical).
    // Cannot resolve here: role is assigned by sim.addHero, while the learning loop injects the baseline
    // policy AFTER construction (`b.tac = candTac`), finalizing in the ctor would be wholly overwritten by that line.
    this._role = null;      // Role key ('raider'|'zoner'|'siege'|'support'); null = unroled (baseline)
    this._roleCh = null;    // Already-resolved character (re-resolve only on swap)
    this._tacBase = null;   // Baseline table for role overrides (= this.tac at resolve time, incl. learned results)
    this.lane = laneIdx % sim.lanes.length;
    this.state = 'PUSH';
    // ---- Op cadence (see _op) ----
    this._opAt = {};    // Next usable timestamp per op kind (sim.t)
    this._opNext = 0;   // Global APM gate: timestamp when ANY op may run next
    this._tid = 0;      // Currently held target id (sticky between scans -- humans do not reselect every frame)
    this._aimAt = 0;    // Reaction time: timestamp when the sight settles on a new target and firing may start
    this.prog = 0;                          // Progress along lane (m, from own end)
    this.alt = CRUISE_ALT.min + Math.random() * (CRUISE_ALT.max - CRUISE_ALT.min);
    this.jitter = [(Math.random() - 0.5) * LANE_JITTER_M, (Math.random() - 0.5) * LANE_JITTER_M];
    this._cum = cumLen(sim.lanes[this.lane]);
    this._wantRy = null;   // Heading wanted this beat (h.ry eases toward it via _turn, see _face)
    this._wantRx = 0;      // Pitch wanted this beat (h.rx eases toward it via _turn)
    this._stuckT = 0;      // Wall-contact accumulation (s)
    this._skirtUntil = 0;  // Skirt expiry time
    this._skirtSide = 1;   // Skirt side (alternates per stuck event)
    this._rallyAt = null;  // Rally world point (finalized on RALLY entry, see _pickRally)
    this._rallyProg = 0;   // Lane progress of rally point (resume rejoins prog here, not from base)
  }

  /** Current light-weapon combat stats for this character (hero multiplier + current tier) */
  _gun(h) { return heroWeapon(h.ch, 'light', h.abil.light, true); }

  /** Current heavy-weapon combat stats for this character (hero multiplier + current tier) */
  _heavy(h) { return heroWeapon(h.ch, 'heavy', h.abil.heavy, true); }

  /** Whether the heavy can fire now (mag/reload/power plus difficulty flags share the sim settlement fields) */
  _heavyReady(h, hv = this._heavy(h)) {
    if (!this.diff.heavy || !hv) return false;
    this.sim._refillIfDone(h, 'heavy', hv);
    const reload = (h.reloadUntil?.heavy || 0) > this.sim.t;
    const ammo = h.ammo?.heavy;
    const overdrive = (h.noReloadUntil || 0) > this.sim.t;
    return !reload && (ammo == null || ammo > 0 || overdrive) && (h.mp || 0) >= heavyMpCost(hv);
  }

  /** Effective weapon for target selection: scoped range extends only while the heavy is truly usable, else light still fires */
  _targetGun(h) {
    const hv = h.aiming ? this._heavy(h) : null;
    return hv && this._heavyReady(h, hv) ? hv : this._gun(h);
  }

  /** Stationary check (rallying for shield / recalling for heals / holding a post) */
  _isStationary(h) {
    if (this.state === 'RALLY' && !this._inFight(h)) return true;
    if (this.state === 'RETREAT' && Math.hypot(h.x - this._home()[0], h.z - this._home()[1]) < 30) return true;
    if (this.sim.bossHold?.has(this.pid) && Math.hypot(h.x - this._home()[0], h.z - this._home()[1]) < 30) return true;
    return false;
  }

  /**
   * Scoped mode is a recon posture, not just a heavy-shot windup:
   *   (1) hold scope while halted for shield or stationary, sweeping the lane area with scoped vision;
   *   (2) scope early once the heavy is usable, so the next scan sees heavy-range enemies;
   *   (3) on hit without seeing the enemy (mid/high tactic response): reactive scoped search;
   *   (4) unscope once moving again with heavy unusable and no hit alert, so an empty mag does not hog long-range vision.
   * Switching still costs the `weapon` op gate, so scoping never bypasses bot APM limits.
   */
  _updateAiming(h) {
    const hv = this._heavy(h);
    const stationary = this._isStationary(h) && (this.diff.scopeSearchDeg > 0 || this.diff.tactic);
    const reactive = this.diff.tactic && h._alert && (this.sim.t - h._alert.t <= BOT_VIEW.ALERT_S) && !this._tid && !this._acquire(h);
    const want = stationary || this._heavyReady(h, hv) || !!reactive;
    if (want !== !!h.aiming && this._op('weapon')) this.sim.heroAim(this.pid, want);
  }

  /**
   * Guard stance toggle (F key / heroDefend):
   * needs charge above 0 and no cast in progress (frontal 120-degree shield cuts 75% direct and 50% blast damage).
   * Tiered policy:
   *   - novice: defend false, never guards;
   *   - low: only turtles with shield while critically retreating to base (RETREAT) under fire;
   *   - medium: shields on retreat/rally under fire, across light reload gaps, and on heavy burst or missile lock;
   *   - high (elite): reload-shield micro, shields while kiting out, and faces the threat; drops shield to fire once reloaded and on aim.
   * Toggling costs the defend op gate (APM limit).
   */
  _updateDefending(h, target) {
    if (!this.diff.defend || h.dead || (h.sp || 0) <= 0 || h.cast) {
      if (h.defending) this.sim.heroDefend(this.pid, false);
      return;
    }

    let want = false;
    if (!this.diff.tactic) {
      // Low: only turtles with shield while critically retreating to base under fire
      want = this.state === 'RETREAT' && this._inFight(h);
    } else {
      // Mid and high: tactical guard
      // (1) hit while disengaging (retreat or rally): shield the remaining charge and armor
      if (this._pulling() && this._inFight(h)) {
        want = true;
      }
      // (2) light reload gap in a fight with heavy not ready: shield the 75% while unable to fire
      else if (this.state === 'ENGAGE' && (h.reloadUntil?.light || 0) > this.sim.t && !this._heavyReady(h)) {
        want = true;
      }
      // (3) heavy damage taken or AA/AT missile lock: absorb the heavy fire
      else if (this._inFight(h) && (this._recentDmg(h) >= (h.maxSp || 0) * 0.35 || this.sim.missiles.some((m) => m.tpid === this.pid))) {
        want = true;
      }
      // (4) skilled-flight handling: shield while hit in flight to soften altitude loss and upset (blast to 1/2, frontal to 1/4)
      else if (this._fly(h) && this._inFight(h)) {
        want = true;
      }

      // High (elite) micro: drop the shield to fire once reloaded with the target already in the sight picture
      if (this.diff.elite && target && (h.reloadUntil?.light || 0) <= this.sim.t && this.sim.t >= this._aimAt) {
        want = false;
      }
    }

    // Face the threat target or alert direction while shielded
    if (want || h.defending) {
      if (target) this._face(h, target.x, target.z);
      else if (h._alert) this._face(h, h._alert.x, h._alert.z);
    }

    if (want !== !!h.defending && this._op('defend')) {
      this.sim.heroDefend(this.pid, want);
    }
  }

  /** Stationary scoped-search yaw offset (rad; lane heading fanned 30/45/60 deg; expand scales the fan) */
  _scopeSearchAngle(h, expand = 1) {
    const rad = botScopeSearchRad(this.diff, expand);
    if (!rad || !h.aiming || !this._isStationary(h)) return 0;
    const freq = botScopeSearchFreq(this.diff);
    return Math.sin(this.sim.t * freq + this.lane) * rad;
  }

  /** Stationary scoped-search pitch offset (rad; lane heading fanned 15/20/25 deg vertically; expand scales the fan) */
  _scopeSearchPitch(h, expand = 1) {
    const rad = botScopeSearchPitchRad(this.diff, expand);
    if (!rad || !h.aiming || !this._isStationary(h)) return 0;
    const freq = botScopeSearchFreq(this.diff);
    return Math.sin(this.sim.t * freq * 2 + this.lane) * rad;
  }

  /** CC slow-factor mirror (kit-appended): humans self-lock on the client, the bot client lives here --
   *  paralyze = 0 (planted, weapons live), slow x slowF, confuse x 0.5 (no input to invert, halving approximates).
   *  _speed and _push position convergence share this seam -- no second slow factor inside update. */
  _ccF(h) {
    const t = this.sim.t;
    if ((h.stunUntil || 0) > t) return 0;
    let f = 1;
    if ((h.slowUntil || 0) > t) f *= h.slowF ?? 0.6;
    if ((h.confUntil || 0) > t) f *= 0.5;
    return f;
  }

  /** Whether this body counts as flying (single seam: ground speed / collider share it; drones always, morphs only in flight).
   *  Same semantics as client game.js _flying() -- the collider fly flag MUST agree on both ends. */
  _fly(h) { return h.kind === 'drone' || (h.kind === 'morph' && (h.y || 0) > FLY_Y); }

  /** Drone fight-altitude choice: one layer above the locked target (altTier) for +range/+dodge.
   *  Only on difficulties with the `tactic` flag (novice/low keep the old fixed altitude, bit-identical);
   *  reads the locked target snapshot height (same `t.y` as aim/fuze, no omniscience) -- unlocked = hold cruise.
   *  Clamped inside the existing envelope, no new exposure: floor = existing low fight alt (guns track well), ceiling = cruise max
   *  (existing SAM risk; above AA_MIN_ALT still eats air-defense missiles, see CRUISE_ALT). */
  _wantAlt(h, target) {
    const floor = Math.max(GAME.AA_MIN_ALT * 0.6, this.alt * 0.6);
    if (this.state !== 'ENGAGE' || !this.diff.tactic) return this.state === 'ENGAGE' ? floor : this.alt;
    const ty = target && (target.hero || target.kind === 'heli') ? (target.y || 0) : 0;
    return Math.min(CRUISE_ALT.max, Math.max(floor, ty + altTier()));
  }

  /** Ground speed: morphs in flight use cruise speed (morphing only pays off en route) x CC factor.
   *  Always via `heroMobility` (same A32 bar "bots MUST NOT see/move beyond humans"):
   *  only it carries role `mods.speed` and speed compression, raw `UNITS[kind].speed` would run bots at chassis baseline. */
  _speed(h, dx = 0, dz = 0) {
    // High-ground suppression slow (2026-08-12; see data.js HIGH_SUP (5)): the human half lives in client game._mobility,
    // the bot client lives here -- both ends share `highSupSpeedF`, server never slows humans twice.
    const sup = highSupSpeedF(this.sim._supF(h));
    let spd = heroMobility(h.kind, CHARACTERS[h.ch]?.mods, this._fly(h)) * this._ccF(h) * sup;
    if (h.sq?.boss && (h.sq.bossSeg || 0) >= 3) spd *= BOSS.ENRAGE_SPD_F;
    if ((dx !== 0 || dz !== 0) && this.sim?.curWeatherDyn && this.sim.curWeatherDyn.wind > WEATHER_DEBUFFS.THRESHOLD) {
      const wDir = this.sim.curWeatherDyn.windDirServer || this.sim.curWeatherDyn.windDir;
      spd *= windSpeedFactor(dx, dz, wDir, this.sim.curWeatherDyn.wind);
    }
    return spd;
  }

  /** Horizontal half-FOV of this body (rad); derived, never hand-written, see data.js botFovHalf */
  _fovHalf(h) { return botFovHalf(h.kind); }

  /** Horizontal bearing of a world point off body HEADING (rad; 0 = ahead, +- = sides). Shared by view cone and hit alerts */
  _bearing(h, tx, tz) { return wrapPi(Math.atan2(-(tx - h.x), tz - h.z) - (h.ry || 0)); }

  /**
   * The single seam for position writes: clamp outside solid bodies via sim.solidResolve (server mirror of client _collide) first,
   * then write back -- bots.js MUST NOT assign h.x/h.z directly anywhere else
   * (2026-08-02 user decision "move and attacks never cross walls/any physical collider").
   * Returns actual-over-desired displacement (0~1) for wall-skirt decisions.
   */
  _move(h, nx, nz) {
    if ((h.rootedUntil || 0) > this.sim.t) return 0;
    [nx, nz] = this._zoneClamp(nx, nz);
    const want = Math.hypot(nx - h.x, nz - h.z);
    const [rx, rz] = this.sim.solidResolve(h, h.x, h.z, nx, nz, this._fly(h));
    const got = Math.hypot(rx - h.x, rz - h.z);
    h.x = rx; h.z = rz;
    return want > 1e-4 ? got / want : 1;
  }

  /**
   * NPC BOSS bounds (user: "confine movement around base/towers").
   * Clamps the INTENDED point, not the result -- clamp first, then solidResolve keeps collision authoritative
   * (hard-pulling back inside the circle after solving would push the body into walls). Non-BOSS passes through.
   * Center/radius live in sim.bossHold (server decided, see sim._bossAnchor); bots.js MUST NOT compute them.
   * Stage-4 enrage lifts the leash and keeps pushing forward.
   */
  _zoneClamp(nx, nz) {
    const sq = this.sim.squads?.get(this.pid);
    if (sq?.boss && (sq.bossSeg || 0) >= 3) return [nx, nz];
    const z = this.sim.bossHold?.get(this.pid);
    if (!z) return [nx, nz];
    const dx = nx - z.x, dz = nz - z.z, d = Math.hypot(dx, dz);
    return d <= z.r ? [nx, nz] : [z.x + dx / d * z.r, z.z + dz / d * z.r];
  }

  /** Where this unit falls back to (retreat / push origin): BOSS returns to its post, others to base */
  _home() {
    const z = this.sim.bossHold?.get(this.pid);
    return z ? [z.x, z.z] : this.sim.basePos[this.side];
  }

  /** Wall skirt: while stuck, offset the target sideways (off the travel dir) so push-out can slide the body out of the corner */
  _skirt(h, tx, tz) {
    if (this.sim.t >= this._skirtUntil) return [tx, tz];
    const dx = tx - h.x, dz = tz - h.z;
    const d = Math.hypot(dx, dz) || 1;
    const s = STUCK.SKIRT_M * this._skirtSide;
    return [tx - dz / d * s, tz + dx / d * s];
  }

  /** Stuck accounting: `f` = _move completion ratio. Stalled STUCK.S seconds straight -> skirt from the other side */
  _stuck(f, dt) {
    if (f < STUCK.F) this._stuckT += dt; else this._stuckT = 0;
    if (this._stuckT < STUCK.S || this.sim.t < this._skirtUntil) return;
    this._stuckT = 0;
    this._skirtSide = -this._skirtSide;
    this._skirtUntil = this.sim.t + STUCK.SKIRT_S;
  }

  /**
   * Op throttle (single seam; 2026-07-27): difficulty sets the per-op switch interval --
   *   1) global APM gate diff.gap: one thing at a time, any two ops spaced by at least gap (top difficulty 0.15s, about 400 APM);
   *   2) per-kind switch interval botOpGap(diff, kind) = gap x BOT_OPS[kind].
   * Returning true means this beat may run that op, timestamped in place, so callers MUST ask only when really executing.
   * Sustained fire bypasses this (trigger is held, not re-pressed per shot; rate is gated by the sim weapon rate).
   */
  _op(kind) {
    const t = this.sim.t;
    if (t < this._opNext || t < (this._opAt[kind] || 0)) return false;
    this._opAt[kind] = t + botOpGap(this.diff, kind);
    this._opNext = t + this.diff.gap;
    return true;
  }

  /** Fire (with reaction time + difficulty aim error: a failed roll misses and deals no damage). Lower difficulty means larger aimErr. */
  _fire(tid, slot) {
    if (this.sim.t < this._aimAt) return false;   // sight still settling after target switch (reaction time)
    if (Math.random() < this.diff.aimErr) return false;
    return this.sim.botFire(this.pid, tid, slot);
  }

  /**
   * Target hold/switch: scanning for enemies is one op (scan), and the same target is held between scans;
   * a dead/lost/stealthed target is dropped at once. Switching to a new target adds a reaction delay (diff.react) before firing.
   */
  _target(h) {
    let t = this._tid ? this.sim.ents.get(this._tid) : null;
    if (t && (t.hp <= 0 || t.side === h.side || t.neutral || t.gar
      || (t.hero && (t.dead || (t.stealthUntil || 0) > this.sim.t)))) { t = null; this._tid = 0; }
    if (t && Math.hypot(h.x - t.x, h.z - t.z) > this._targetGun(h).range * 1.15) { t = null; this._tid = 0; }
    if (!this._op('scan')) return t;                  // APM/scan interval not reached: keep current target
    const nt = this._acquire(h);
    if ((nt ? nt.id : 0) !== this._tid) {
      this._tid = nt ? nt.id : 0;
      if (nt) this._aimAt = this.sim.t + this.diff.react;   // new target: reaction time + sight settle
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
    // Retreat/turn is a commit-type op (not an instant turn on sight of the health bar), so it pays the state interval; lower difficulty notices later.
    // ENGAGE/PUSH cost nothing extra: they only report whether a target is in front, and targets are already throttled by scan + react.
    // MUST keep short-circuit: a successful _op consumes one global-APM slot, so asking unconditionally pays every beat.
    const want = this._pullWant(h, frac, spF);
    if (want && this.state !== want && this._op('state')) this._enterPull(h, want);
    else if (this.state === 'RETREAT' && frac >= this.tac.RESUME_HP && this._op('state')) this._resume(0);
    else if (this.state === 'RALLY' && spF >= this.tac.RALLY_SP && this._op('state')) this._resume(this._progAt(h));

    this._updateAiming(h);
    const target = this._target(h);
    if (!this._pulling()) this.state = target ? 'ENGAGE' : 'PUSH';
    this._updateDefending(h, target);

    // Economy: upgrade track by track per BUY_ORDER (step price + combat-score gate, always rechecked by sim.buy).
    // Pre-filtering uses the same canUpgrade helper (2026-08-11): upgrades gained a combat-score gate, so checking money alone
    // would spend one APM slot per round asking for purchases that must be refused when money suffices but score does not.
    // Opening the shop is also an op, so the shop-check interval grows with lower difficulty (high difficulty about 4s, the pre-2026-07-27 rhythm)
    // NPC BOSS units skip the upgrade system (authority gate in sim.buy; this only avoids wasting an APM slot on doomed purchases)
    const canBuy = !sim.isBoss(h) && Object.entries(ECON.UPGRADES)
      .some(([k, u]) => canUpgrade(u, h.upg[k] || 0, h.money, h.kn));
    if ((canBuy || (!sim.isBoss(h) && h.money >= CREEP_UPG.PRICE)) && this._op('buy')) {
      let bought = false;
      // Buy order rotates with role (assault buys heavy and armor first, support buys skills and charge...); unroled = legacy order
      for (const item of botBuyOrder(this._role)) {
        // Difficulties that never cast (novice/low): skip skill tracks, save money for weapon and defense upgrades
        if (!this.diff.ability && (item === 'def' || item === 'atk')) continue;
        if (sim.buy(this.pid, item) === null) { bought = true; break; }
      }
      // Sink after all eight tracks fill: invest in this lane faction-creep upgrades (gates/price/caps enforced by sim.buy).
      // Without this, maxed bots would hoard money forever while humans alone enjoy reinforced lanes.
      if (!bought) sim.buy(this.pid, 'creep', this.lane);
    }

    // Self/assist skills: heal or shield at low HP, also used while retreating
    this._castSupport(h, frac);

    if (this.state === 'RETREAT') this._moveToward(h, u, this._home(), dt);
    else if (this.state === 'RALLY') this._rally(h, u, target, dt);
    else if (this.state === 'ENGAGE') this._engage(h, u, target, dt);
    else if (sim.bossHold?.has(this.pid) && !(h.sq?.bossSeg >= 3)) this._hold(h, u, dt);   // NPC BOSS: holds the post, no pushing (keeps pushing once enraged)
    else this._push(h, u, dt);

    // View: the state machine first writes where it wants to look, guard stance locks the threat target, hit alerts can steal it, then one yaw-limited turn applies.
    if (h.defending) {
      if (target) this._face(h, target.x, target.z, target.y);
      else if (h._alert) this._face(h, h._alert.x, h._alert.z, h._alert.y);
    }
    this._alertLook(h);
    this._turn(h, dt);

    // Altitude: drones cruise; in a fight grab one level above the target (see _wantAlt), with the same vertical rate cap as humans
    if (h.kind === 'drone') {
      const want = this._wantAlt(h, target);
      const vsp = u?.vspeed || 0;   // UNITS.vspeed = human Space full climb rate (same helper as game._updatePlayer)
      const y0 = h.y || 0, dy = want - y0;
      h.y = Math.abs(dy) <= vsp * dt ? want : y0 + Math.sign(dy) * vsp * dt;
    } else if (h.kind === 'morph') {
      // Morph: fly form hurries along while pushing, lands to morph when fighting or retreating to base (y=0 takes mines and leaves AA)
      const want = this.state === 'PUSH' ? this.alt : 0;
      h.y = (h.y || 0) + (want - (h.y || 0)) * Math.min(1, dt * 1.5);
      if (want === 0 && h.y < 1.5) h.y = 0;
    } else {
      h.y = 0;
    }
  }

  /**
   * Body role resolution (single seam; resolved once per character). Role math lives in data.js botRoleOf,
   * tactic layering lives in botRoleTactic -- bots.js MUST NOT branch on role keys with any role-equals check
   * (that would be a second decision system, and it would fight difficulty layering).
   *
   * Three rules: 1) resolve only under diff.tactic, so novice/low keep the injected/global table in this.tac,
   * structurally bit-identical to the old system (A33); 2) remember the baseline once (_tacBase): without it each
   * re-resolve would multiply the already-overridden table again -- range rings drift onto clamp edges after a few swaps, silently;
   * 3) re-resolve only on character change (new frame or respawn draw), never twice for the same frame.
   */
  _resolveRole(h) {
    if (!this.diff.tactic || h.ch === this._roleCh) return;
    this._roleCh = h.ch;
    if (this._tacBase == null) this._tacBase = this.tac;   // the injected learning-loop table = baseline
    this._role = botRoleOf(h.ch);
    this.tac = botRoleTactic(this._tacBase, this._role);
  }

  /** Advance along the assigned lane toward the enemy end (SWARM side starts at the polyline head) */
  _push(h, u, dt) {
    const pts = this.sim.lanes[this.lane];
    const total = this._cum[this._cum.length - 1];
    const fwd = this.side === 'SWARM' ? 1 : -1;
    const d = this.side === 'SWARM' ? this.prog : total - this.prog;
    const [x, z] = pointAt(pts, this._cum, d);
    // Heading takes the forward direction (lookahead along the lane), not the foot target point -- see PUSH_LOOK_M
    const [lx, lz] = pointAt(pts, this._cum, Math.max(0, Math.min(total, d + fwd * PUSH_LOOK_M)));
    this.prog = Math.min(total, this.prog + this._speed(h, lx - x, lz - z) * 0.85 * dt);
    this._face(h, lx, lz);
    // Position converges with the same control-loss factor: while prog is frozen (paralyzed) the body MUST NOT keep sliding back to the lane target exponentially
    const cf = this._ccF(h);
    const [gx, gz] = this._skirt(h, x + this.jitter[0], z + this.jitter[1]);   // lateral offset while skirting a wall
    const k = Math.min(1, dt * 2.2 * cf);
    // Obstacle avoidance is delegated as a set to _move (the single collision seam) -- the old build only skirted hazBlockers here while
    // buildings/trees/rocks passed through, and ENGAGE/RETREAT had not even that. MUST NOT write a second push-out here.
    this._stuck(this._move(h, h.x + (gx - h.x) * k, h.z + (gz - h.z) * k), dt);
    // Straggler fix: after knockback or respawn, when prog no longer matches position, snap back to nearest progress
    if (Math.hypot(h.x - x, h.z - z) > 90) this.prog = Math.max(0, this.prog - this._speed(h) * dt * 4);
  }

  /**
   * NPC BOSS pushing = holding the post (replaces _push). BOSS units never advance along lanes -- if prog kept accumulating,
   * the body would pin on the zone edge via _zoneClamp while its target runs to the enemy core, so _stuck would misread wall contact
   * and skirt sideways all game. Returning to the post center + facing the enemy end of the lane (where attackers come from) is the guard post.
   */
  _hold(h, u, dt) {
    this._moveToward(h, u, this._home(), dt);
    this._faceLaneFwd(h);
  }

  /** Whether currently disengaged (returning to base or back behind a tower) -- shared check for both, MUST NOT inline per site */
  _pulling() { return this.state === 'RETREAT' || this.state === 'RALLY'; }

  /**
   * Retreat line (2026-08-02 user decision). Returns which disengage state this beat should hold (null = hold position):
   *   armor below BASE_HP                    -> RETREAT (return to core for heals; the only case that leaves the lane)
   *   armor below PULL_HP and shield lost half -> RALLY (fall behind the nearest tower and wait for shield)
   *   high difficulty: shield lost half (any armor) -> RALLY (fall back once half the shield is absorbed)
   *
   * All three gates are required, each maps to one measured failure mode:
   * 1) enter on PULL_SP, exit on RALLY_SP hysteresis band -- armor never self-heals outside base, so entering on
   *   armor alone oscillates on the threshold (fall to tower, shield fills, return, HP still low, fall again).
   * 2) RETREAT is never stolen by RALLY -- the base trip is long and armor only heals inside HERO_HEAL_R;
   *   diverting to the rally point midway wastes the trip and returns a crippled body to the front.
   * 3) half-shield-lost measures damage actually absorbed this wave, not whether the shield happens to sit below half now --
   *   they sound alike but measured a 2x assault-output gap. Chip damage from lane creeps parks shields below half for a long
   *   time (shields only regen after VITALS.OOC_S seconds out of combat), so level-based checks retreat almost always:
   *   2026-08-02 measurement had RALLY eat 37 percent of game time, halved fort damage, and cut kills by 41 percent. Measuring
   *   recent damage still triggers on a real hero burst (half a shield in 6s) but not on creep chip. Recent damage reads the
   *   _threatOf ledger (single _hurtLog seam, MUST NOT open a second ledger); still-in-fight reads VITALS.OOC_S
   *   (= the window before shields start regen), MUST NOT invent a second engage check.
   *
   * Mid difficulty deliberately skips rule 3: its danger signal is armor down to 30 percent, and slowly grinding half a shield still warrants retreat.
   * Difficulties without the tactic flag (novice/low) keep only the legacy rule (PULL_HP threshold, destination base), bit-identical.
   */
  _pullWant(h, frac, spF) {
    if (h.sq?.boss) {
      if ((h.sq.bossSeg || 0) >= 3) return null;             // enraged mode: keep attacking, never retreat
      if (frac < this.tac.BASE_HP) return 'RETREAT';
      if (this.state === 'RETREAT') return 'RETREAT';
      if (spF >= this.tac.PULL_SP) return null;
      if (!this._inFight(h)) return null;                   // already out of combat: shield regen has no danger
      // BOSS falls back only when its shield is about to break (below 15 percent in combat, wait at post center for regen)
      if (spF <= 0.15) return 'RALLY';
      return null;
    }
    if (!this.diff.tactic) return frac < this.tac.PULL_HP ? 'RETREAT' : null;
    if (frac < this.tac.BASE_HP) return 'RETREAT';
    if (this.state === 'RETREAT') return 'RETREAT';
    if (spF >= this.tac.PULL_SP) return null;
    if (!this._inFight(h)) return null;                                   // already out of combat: shield regen has no danger
    if (frac < this.tac.PULL_HP) return 'RALLY';                        // mid/high: armor also bottomed out
    if (spF <= 0.20) return 'RALLY';                                      // tactical bots: shield about to break in combat (at or below 20 percent), fall back and wait
    if (this.diff.elite && this._recentDmg(h) >= this.tac.PULL_SP * (h.maxSp || 0)) return 'RALLY';
    return null;
  }

  /** Still taking fire (single seam: retreat checks and rally behavior share it). Borrows the sim out-of-combat seconds directly --
   *  shield-not-yet-regenerating and still-in-combat are the same thing by definition, MUST NOT invent a second engage check. */
  _inFight(h) { return this.sim.t - (h.lastHitAt ?? -99) < VITALS.OOC_S; }

  /**
   * Damage taken from live enemies in the last THREAT_S seconds (linear fade). Shares one ledger and one fade curve
   * with target threat values -- MUST NOT keep a separate ledger for retreat.
   *
   * Tower and core chip damage does not count (same reason _prioritize excludes fort output): sieging means standing
   * in tower range taking hits, so counting that toward half-shield-lost would retreat every assault halfway and halve
   * assault output directly (measured 2026-08-02). When forts cannot kill, the retreat signal is armor (the PULL_HP and BASE_HP rules),
   * not shield.
   */
  _recentDmg(h) {
    let s = 0;
    for (const r of h._threat?.values() || []) {
      if (r.k === 'tower' || r.k === 'base') continue;
      s += r.v * botThreatDecay(this.sim.t - r.t, this.tac);
    }
    return s;
  }

  /** Enter a disengage state; the rally point is fixed on entry (no recompute when a tower falls midway -- that would U-turn the body) */
  _enterPull(h, want) {
    this.state = want;
    if (want === 'RALLY') this._pickRally(h);
  }

  /** Resume: back to pushing, rejoining lane progress from prog (base returns restart at 0, rally rejoins at the current position) */
  _resume(prog) { this.state = 'PUSH'; this.prog = prog; }

  /**
   * Current position projected back onto the lane as own-end progress (meters).
   * Rally resume MUST use this instead of the rally-point progress: disengages often complete before reaching the tower (5s without fire
   * already exits combat), so resetting prog behind the tower would drag the body backward to the tower in _push first, wasting a whole
   * lane segment. prog itself freezes during ENGAGE and RALLY (only _push advances it), so it cannot be reused directly.
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
    return this.side === 'SWARM' ? bestAt : total - bestAt;   // always convert back to own-end origin
  }

  /**
   * Rally point = the lane point behind the nearest surviving friendly tower (user decision: fall back behind the nearest tower line).
   * Tower spots always come from sim.towerSites (same solution as the pre-seeded lanes, MUST NOT solve again); but towerSites is a
   * fixed-at-start position table with no death info, so confirm a live friendly tower per spot, else the retreat lands on an empty spot
   * right in the enemy push path. With zero towers left, fall back to base (principle 6 degrades without exception).
   */
  _pickRally(h) {
    const sim = this.sim;
    // NPC BOSS rally point is always its own post: the lane tower-behind spot usually lies outside the activity zone,
    // retreating there only wedges on the _zoneClamp circle edge and never arrives (= sliding along the edge forever).
    if (sim.bossHold?.has(this.pid)) { this._rallyProg = this.prog; this._rallyAt = this._home(); return; }
    const total = this._cum[this._cum.length - 1];
    let bestD = Infinity, bestFrac = null;
    for (const st of sim.towerSites?.[this.lane] || []) {
      const p = st[this.side];
      if (!p) continue;
      // One tower spot holds one tower per side (GAME.TOWER_SIDE_OFF); survival is judged with a radius covering both
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
    // frac counts from the own end (same frame as solveTowerSites and this.prog), so minus RALLY_BACK_M lands behind the tower
    this._setRally(Math.max(0, total * bestFrac - this.tac.RALLY_BACK_M));
  }

  /** Single seam writing the rally point: own-end progress -> world coords (both rally-point kinds share one conversion) */
  _setRally(prog) {
    const total = this._cum[this._cum.length - 1];
    this._rallyProg = prog;
    this._rallyAt = pointAt(this.sim.lanes[this.lane], this._cum, this.side === 'SWARM' ? prog : total - prog);
  }

  /**
   * Rally retreat: keep firing while falling back under contact, hold still for shields once contact breaks.
   *
   * Each half maps to one measured failure mode:
   *   1) retreating without returning fire = turning to feed, so keep firing while in contact (the macro version of shoot-and-scoot).
   *   2) firing after breaking contact = shields never return: shields only regen after VITALS.OOC_S seconds out of combat,
   *     while firing draws return fire and keeps resetting the out-of-combat clock, so bots sit in RALLY until armor bottoms out and only then return
   *     (measured 2026-08-02: RALLY ate 36 percent of game time, while the wait-for-full-shield exit almost never
   *     fired). Stop firing and stop moving = the human act of sitting still in safety waiting for shields.
   *
   * Position still uses the _moveToward collision seam; _face only writes intent (never moves h.ry), so running after movement
   * hands the view back to the target.
   */
  _rally(h, u, t, dt) {
    if (!this._inFight(h)) {                       // contact broken: hold still and stop firing until shields refill
      if (t) this._face(h, t.x, t.z);              // but eyes stay on the enemy (no free flanking)
      else this._faceLaneFwd(h);
      return;
    }
    this._moveToward(h, u, this._rallyAt || this._home(), dt);
    if (t) { this._face(h, t.x, t.z); this._fire(t.id, 'light'); return; }
    this._faceLaneFwd(h);
  }

  /** Face the enemy end of the lane (default heading while rallying for shields) -- waiting with back to the field invites flanking,
   *  and _acquire only sees the forward view cone, so facing away blinds the bot to whole incoming waves.
   *  While stationary and scoped, fan a 3D search about the lane direction (horizontal +-30/45/60 deg, vertical +-15/20/25 deg). */
  _faceLaneFwd(h) {
    const total = this._cum[this._cum.length - 1];
    const fwd = this.side === 'SWARM' ? 1 : -1;
    const prog = this.state === 'RALLY' ? this._rallyProg : this._progAt(h);
    const d = this.side === 'SWARM' ? prog : total - prog;
    const [lx, lz] = pointAt(this.sim.lanes[this.lane], this._cum, Math.max(0, Math.min(total, d + fwd * PUSH_LOOK_M)));
    const searchAng = this._scopeSearchAngle(h);
    const searchPitch = this._scopeSearchPitch(h);
    if (!searchAng && !searchPitch) {
      this._face(h, lx, lz);
      return;
    }
    const baseRy = Math.atan2(-(lx - h.x), lz - h.z);
    const targetRy = baseRy + searchAng;
    const dist = Math.hypot(lx - h.x, lz - h.z) || PUSH_LOOK_M;
    const targetY = (h.y || 0) + Math.sin(searchPitch) * dist;
    this._face(h, h.x - Math.sin(targetRy) * dist, h.z + Math.cos(targetRy) * dist, targetY);
  }

  /** Skill readiness (unlock + CD + MP) -- actual settlement still gated by sim.heroCast */
  _ready(h, slot) {
    if (h.cast || (h.castLockUntil || 0) > this.sim.t) return null;
    const lvl = h.abil[slot];
    if (!lvl || (h.acd[slot] || 0) > this.sim.t) return null;
    const A = heroAbility(h.ch, slot, lvl);
    return (A && h.mp >= A.mp) ? A : null;
  }

  /** Assist/self skills (no target point): heal, shield, buff, stealth retreat */
  _castSupport(h, frac) {
    if (!this.diff.ability) return;   // low/novice difficulty: never casts
    for (const slot of ['def', 'atk']) {
      const A = this._ready(h, slot);
      if (!A) continue;
      const hurt = frac < this.tac.CAST_HURT;   // HP line follows the knob (support casts early, assault holds longer)
      const lowSp = (h.maxSp > 0) && ((h.sp || 0) / h.maxSp < 0.5) && this._inFight(h); // top up defense once magnetic wear passes half
      const fullChg = this.diff.elite && (A.charges > 1) && this._inFight(h) && (this.sim._readyCharges(h, slot) >= A.charges);
      const isDefFx = A.fx === 'heal' || !!A.spRestore || !!A.shieldDefBoost || !!A.shieldExpand
        || !!A.spRegenHit || A.fx === 'reflect' || A.fx === 'phaseshift' || A.fx === 'fog' || A.fx === 'cube';
      if ((isDefFx && (hurt || lowSp || fullChg))
        || (A.fx === 'buff' && A.mul?.dmgTaken && (hurt || lowSp || fullChg))
        || (A.fx === 'stealth' && this._pulling())) {
        if (this._op('ability')) this.sim.heroCast(this.pid, slot);   // pressing Q/E is one op
      }
    }
  }

  /** Engage: hold the 60-85 percent range ring, firing while strafing */
  _engage(h, u, t, dt) {
    const gun = this._targetGun(h);
    const dx = t.x - h.x, dz = t.z - h.z;
    const d = Math.hypot(dx, dz) || 1;
    // 打帶跑(高難度):裝填中拉到射程外緣、可擊發時再貼上去 —— 比例走 botKiteF 單一縫。
    // 量的是**裝填**而不是逐發射速間隔:後者只有零點幾秒,照著它進退只會抖成原地震動。
    // 建築(塔/主堡)不套 —— 它們不會追,拉開只是白白少打幾秒。
    const struct = t.kind === 'tower' || t.kind === 'base';
    const kite = this.diff.elite && !struct
      ? botKiteF(!((h.reloadUntil?.light || 0) > this.sim.t), this.tac) : this.tac.KEEP_F;
    const keep = gun.range * (struct ? this.tac.KEEP_STRUCT : kite);
    const radial = (d - keep) / Math.max(1, d);          // positive = close in, negative = pull out
    const strafe = Math.sin(this.sim.t * 0.9 + this.lane * 2) * 0.6;
    const dirX = dx / d * radial + (-dz / d) * strafe;
    const dirZ = dz / d * radial + (dx / d) * strafe;
    const spd = this._speed(h, dirX, dirZ);              // ground speed after control-loss (stun/slow/confuse) and weather wind
    const vx = dirX * spd;
    const vz = dirZ * spd;
    this._move(h, h.x + vx * dt, h.z + vz * dt);   // strafing uses the same collision seam (no wall-passing in combat either)
    this._face(h, t.x, t.z);
    this._fire(t.id, 'light');

    // Heavy weapons (CD gated by sim mag/reload): fired at structures or packed enemies. Novice never uses heavies.
    const hv = this._heavy(h);
    const packed = [...this.sim.ents.values()].filter((e2) =>
      e2.side !== h.side && !e2.neutral && Math.hypot(e2.x - t.x, e2.z - t.z) <= (hv.r || 10) * 1.5).length;
    // Switching aim mode + firing one heavy = one weapon op: lower difficulty switches light/heavy ever more sluggishly.
    // Do not pay that APM slot while reloading or on an empty mag (keys that cannot fire MUST NOT crowd out scan and skills; pre-check like _ready for skills)
    const hvReady = this._heavyReady(h, hv);
    if (this.diff.heavy && (packed >= 3 || t.kind === 'tower' || t.kind === 'base' || t.hero)
      && hvReady && this.sim.t >= this._aimAt && this._op('weapon')) {
      if (!h.aiming) this.sim.heroAim(this.pid, true);   // heavies need scoped mode; bots switch directly before firing (no human input)
      if (hv.type === 'launcher' || hv.type === 'missile') {
        // Airburst height: detonate at the target height for flying bodies (heroes/helis) so launchers work AA
        const ty = t.hero || t.kind === 'heli' ? (t.y || 0) : 0;
        // Do not fire when a large blocker covers the arc (human rockets are stopped by client ballistics and report short;
        // bots have no client ballistics, so apply the same LOS rule as botFire here, else rockets pass through buildings)
        if (Math.random() >= this.diff.aimErr
          && !this.sim._losBlocked(h.x, h.z, (h.y || 0) + LOS.EYE_M, t.x, t.z, this.sim._tgtY(t), h, t)) {
          this.sim.heroBurst(this.pid, t.x, t.z, ty);
        }
      } else if (hv.type === 'plasma') {
        const ty = this.sim._tgtY(t);
        const oy = (h.y || 0) + LOS.EYE_M;
        this.sim.heroPlasma(this.pid, t.x - h.x, t.z - h.z, 'heavy', null, ty - oy);
      } else this._fire(t.id, 'heavy');
    }

    // Attack skills: aimed at the target (strike/emp/summon; range/MP/CD enforced by sim). Low/novice never casts.
    // Each cast pays one ability interval -- a human cannot press Q and E in the same instant.
    if (this.diff.ability) for (const slot of ['def', 'atk']) {
      const A = this._ready(h, slot);
      if (!A) continue;
      const cast = (aimed) => this._op('ability')
        && (aimed ? this.sim.heroCast(this.pid, slot, t.x, t.z) : this.sim.heroCast(this.pid, slot));
      if ((A.fx === 'strike' || A.fx === 'emp') && packed >= 3) cast(true);
      else if (A.fx === 'summon' || A.fx === 'vision') cast(true);
      else if (A.fx === 'buff' && A.mul?.dmg) cast(false);
      else if (A.fx === 'intercept' && this.sim.missiles.some((m) => m.tpid === this.pid)) cast(false);
      else if (A.fx === 'shield_bash' && (h.defending || d <= 35 || packed >= 2)) cast(false);
      else if (this.diff.elite && (A.charges > 1) && this.sim._readyCharges(h, slot) >= A.charges) {
        if (A.fx === 'strike' || A.fx === 'emp') cast(true);
        else cast(false);
      } else if (this.diff.elite && t.hero && (A.dmg || A.baseDmg || A.fx === 'strike')
        && t.hp <= botSalvo(this._gun(h), t.kind, this.tac)) {
        cast(true);
      }
    }

    // 機種絕招(飽和攻擊 / 集束炸彈 / 極音速飛彈)2026-08-06 整組退場,MUST NOT 復辟:
    // 長按右鍵改成招式手勢(一般 = 守招 / 狙擊 = 攻招)⇒ bot 這邊也只剩上面的 heroCast 兩條路,
    // 三種載具只由 sim._launchAtkCarrier 生成。`special` 那一格手速因此不再有消費端。
  }

  _moveToward(h, u, [tx, tz], dt) {
    const dx = tx - h.x, dz = tz - h.z;
    const d = Math.hypot(dx, dz);
    const home = this._home();
    if (d < (tx === home[0] && tz === home[1] ? 30 : 5)) return; // 到堡附近(30m)或集結點附近(5m)等
    if (!h.defending) this._face(h, tx, tz);
    const [gx, gz] = this._skirt(h, tx, tz);             // 撤退路上一樣會撞牆 ⇒ 同一套繞行
    const gd = Math.hypot(gx - h.x, gz - h.z) || 1;
    const step = this._speed(h, gx - h.x, gz - h.z) * dt;
    this._stuck(this._move(h, h.x + (gx - h.x) / gd * step, h.z + (gz - h.z) / gd * step), dt);
  }

  /** 這一拍**想看**的方向(世界點)。只寫意圖,不動 `h.ry`/`h.rx` —— 視角有角速度上限(跟真人一樣
   *  不能瞬間回頭),寫成兩段才不會有第二處偷偷瞬轉。客戶端 three 座標 z 取負,朝向公式與
   *  game.js 的 pos 回報一致。 */
  _face(h, tx, tz, ty = null) {
    this._wantRy = Math.atan2(-(tx - h.x), tz - h.z);
    const flat = Math.hypot(tx - h.x, tz - h.z);
    this._wantRx = (ty != null && flat > 0.01) ? Math.atan2(ty - (h.y || 0), flat) : 0;
  }

  /** 把朝向朝 `_wantRy`/`_wantRx` 轉一步。**`h.ry` 與 `h.rx` 的唯一寫入點**;角速度上限走 `viewLockStep`
   *  (真人視野鎖定輔助的同一支,兩軸同吃)—— MUST NOT 在此手寫 rad/s,也 MUST NOT 直接指派目標角。 */
  _turn(h, dt) {
    if (this._wantRy != null) {
      h.ry = wrapPi((h.ry || 0) + viewLockStep(wrapPi(this._wantRy - (h.ry || 0)), dt));
    }
    if (this._wantRx != null) {
      h.rx = wrapPi((h.rx || 0) + viewLockStep(wrapPi(this._wantRx - (h.rx || 0)), dt));
    }
  }

  /**
   * 受擊警戒(2026-08-02 使用者定案「其他方向敵人來襲視角要跟著轉向」)。
   * 視野是前方錐 ⇒ 背後挨打時 bot 看不見攻擊者、也就永遠不會轉身;伺服器 `_hurtLog` 記下最後
   * 一次挨打的來源方位(與濺血提示同一份帳,唯一縫),這裡把視角**搶過去**朝它轉。
   * 轉到攻擊者落進視野錐(或警戒逾時)即交還一般看向邏輯,由 `_acquire` 正常鎖定。
   * 被攻擊時如果沒看到敵人:中難度擴大狙擊鏡搜索角度區域,高難度依出血動畫方向判定搜索方位。
   * MUST 排在狀態機之後 —— 「來襲方向優先於原本想看的方向」就是這條需求本身。
   */
  _alertLook(h) {
    const al = h._alert;
    if (!al) return;
    if (this.sim.t - al.t > BOT_VIEW.ALERT_S) {
      h._alert = null;   // 逾時
      return;
    }
    // 已鎖定目標或視野內已看見敵人:警戒達成,交回交戰邏輯
    if (this._tid || this._acquire(h)) {
      h._alert = null;
      return;
    }
    // 新手與低難度:逐位元維持舊制(轉到正面視野錐即清除)
    if (!this.diff.tactic) {
      if (Math.abs(this._bearing(h, al.x, al.z)) <= this._fovHalf(h)) {
        h._alert = null;
        return;
      }
      this._face(h, al.x, al.z);
      return;
    }
    // 高難度:根據出血動畫方向判斷狙擊鏡搜索方位 (含水平與仰角方位)
    if (this.diff.elite) {
      const alY = al.y != null ? al.y : (h.y || 0);
      const eyeY = (h.y || 0) + LOS.EYE_M;
      const flatD = Math.hypot(al.x - h.x, al.z - h.z);
      const curBear = wrapPi(Math.atan2(-(al.x - h.x), al.z - h.z) - (h.ry || 0));
      const curElev = flatD > 0.01 ? wrapPi(Math.atan2(alY - eyeY, flatD) - (h.rx || 0)) : 0;
      const halfH = this._fovHalf(h);
      const halfV = botFovVerticalHalf(h.kind);
      const { u, v } = bloodScreenUv(curBear, curElev, halfH, halfV);
      const { bearing, elev } = bloodDirFromUv(u, v, halfH, halfV);
      const targetRy = wrapPi((h.ry || 0) + bearing);
      const targetRx = wrapPi((h.rx || 0) + elev);
      const dist = flatD || 60;
      const tx = h.x - Math.sin(targetRy) * dist;
      const tz = h.z + Math.cos(targetRy) * dist;
      const ty = eyeY + Math.sin(targetRx) * dist;
      this._face(h, tx, tz, ty);
      return;
    }
    // 中難度:擴大狙擊鏡搜索角度區域 (水平 45°→67.5°、垂直 20°→30° 立體正弦波搜索)
    const baseRy = Math.atan2(-(al.x - h.x), al.z - h.z);
    const rad = botScopeSearchRad(this.diff, BOT_VIEW.ALERT_SEARCH_EXPAND);
    const pitchRad = botScopeSearchPitchRad(this.diff, BOT_VIEW.ALERT_SEARCH_EXPAND);
    const freq = botScopeSearchFreq(this.diff);
    const searchAng = Math.sin(this.sim.t * freq + this.lane) * rad;
    const searchPitch = Math.sin(this.sim.t * freq * 2 + this.lane) * pitchRad;
    const targetRy = baseRy + searchAng;
    const dist = Math.hypot(al.x - h.x, al.z - h.z) || 60;
    const targetY = (al.y != null ? al.y : (h.y || 0)) + Math.sin(searchPitch) * dist;
    this._face(h, h.x - Math.sin(targetRy) * dist, h.z + Math.cos(targetRy) * dist, targetY);
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
    const wd = this._targetGun(h);
    const range = wd.range;
    const fovHalf = this._fovHalf(h);   // 前方視野半角(推導不手寫,見 data.js botFovHalf)
    const bossHold = this.sim.bossHold?.get(this.pid);
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
      // BOSS 守備主動性:敵人在據點活動圈內(或射程內)即納入警戒,具備全向防衛能力
      const inBossZone = bossHold && Math.hypot(t.x - bossHold.x, t.z - bossHold.z) <= bossHold.r * 1.1;
      const maxAcq = inBossZone ? Math.max(range * 1.15, bossHold.r * 1.1) : range * 1.15;
      if (d > maxAcq) continue;                    // 稍微超程也接近(移動中會進圈)
      // 前方視野錐(2026-08-02 使用者定案「不可以有全角度視野」):真人只看得到螢幕上那一塊,
      // bot 也只認機體正前方 ±botFovHalf。背後的敵人要嘛開火把它打醒(_alertLook 轉頭),
      // 要嘛自己走進錐內 —— MUST NOT 退回全角度掃描。塔/主堡同樣吃這一條(真人也得轉頭才看得到)。
      // BOSS 守備範圍內的入侵者享有全向防衛感知。
      if (!inBossZone && Math.abs(this._bearing(h, t.x, t.z)) > fovHalf) continue;
      // 3D 狙擊鏡視角錐:開鏡時垂直維度受限於垂直半視角 botFovVerticalHalf(h.kind)
      if (h.aiming && !inBossZone) {
        const ty = t.hero || t.kind === 'heli' ? (t.y || 0) : (t.kind === 'tower' || t.kind === 'base' ? 8 : 0);
        const eyeY = (h.y || 0) + LOS.EYE_M;
        const flatD = Math.hypot(t.x - h.x, t.z - h.z);
        const pitchToTgt = Math.atan2(ty - eyeY, flatD);
        if (Math.abs(wrapPi(pitchToTgt - (h.rx || 0))) > botFovVerticalHalf(h.kind)) continue;
      }
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
