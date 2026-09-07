# §2.1 C — Weapon Judgment & Ballistics (single seams)

> Layer 2: full definitions. Principles live in root `AGENTS.md`; assertion details live in audit script headers (layer 4).

| Topic | Single seam | Constraints | Guards |
|---|---|---|---|
| AoE/trajectory classification | `aoeClass()`, `trajClass()` | MUST derive from definition type; MUST NOT hand-write per-weapon tables. | — |
| Reach gate | `REACH_RULE`, `reachRule()` into `game._reachable()` | Sole crosshair criterion across all trajectory classes; consumers MUST NOT compare classes directly. | — |
| Shot footprint roster | `game._shotVictims()` with range/band/warn helpers, sole consumer glow updater | MUST classify via AoE class only; geometry mirrors the server per class; blast deliberately ignores LOS and range; fan and line have no whole-shot entry gate; unreachable crosshair targets switch all glows off. | `audit_weapon_gate` |
| Fan cone edge | `fanArcHalf()` nominal plus effective cone helper | Cone inclusion measures to the target hit-volume near surface; all consumers share it; volume widening MUST NOT inflate damage (falloff denominator stays nominal). | `audit_weapon_gate` |
| Evasion and DPS compensation | `EVASION`, `evadable()`, `evadeComped()`, `evadeCompF()`, `sim._dodgeP()`, `_blast` | Light direct fire plus all blast damage take evasion; fan and line exempt by mechanism; criterion is exclusion-based; blast continues per target, MUST NOT return the whole shot; friendly self-damage never rolls; compensation covers only the newly-evaded batch at each target's own odds. | `audit_weapon_gate` |
| High-ground suppression | `HIGH_SUP`, `highSupF()`/`highSupDodgeF()`/`highSupSpeedF()`, `sim._stampSup()` | Intensity scales on one measure only; no advantage means bit-identical legacy; advantage is relative to the attacker; hit-rate and dodge are independent events; speed folds only at the position-authoritative end. | `audit_weapon_gate` |
| Blast overpressure bands | `BLAST` core/edge/exp bands, `blastCoreR()` | Falloff and the reach gate share one breakpoint set; MUST NOT hand-write literals at either end. | — |
| Range envelope | `weaponMaxHoriz()`, `inWeaponRange()` | Upper sphere plus lower cone on the design-plane range with no extra altitude bonus; server and client share the measure; the boundary disarms only, never detonates. | `audit_weapon_gate` |
| Detonation equals collision | `game._updateBullets()` dud flag, lob clamp, flight cap | Leaving the envelope writes dud-only while the body flies on until collision, which takes priority; dud impacts leave dust only. | `audit_weapon_gate` |
| Range origin | `sim._trailPush()`, `_shotOrigin()`, `shotTrailS()` | Origin backtracks from the server position trail; MUST NOT accept client-reported coordinates; short trails fall back to current position; lance and plasma excluded. | `audit_weapon_gate` |
| Muzzle velocity and flight time | `shotV0()`, `shotFlightS()`, `flightCapS()` | The two MUST NOT substitute for each other; ground lobs use the fixed-angle inverse solution with velocity as cap-only; gates holding shell time convert back to fire time. | — |
| Lob fire control | `BALLISTIC.LOB_*`, `_lobAim()` with fire-control state, crosshair/ladder/tracer helpers | One solution shared by aim and reach checks; the crosshair is the sole target source; ground aim uses the fixed-angle inverse solution; mid-flight collision detonates while misses fly until collision. | — |
| Seeker maneuver | `SEEK`, `seekTurn()` | Steering takes the wider of angular rate and radius rules; both steering sites use it; relaxations only, never tightenings. | — |
| Range gate tolerance | `RANGE_TOL`, `altRangeMax()` | Exactly one network tolerance value with no per-site multipliers; tolerance applies only to client self-clamped reports; origins MUST NOT retreat to hull centers. | — |
| Altitude range | `altRangeF()`, server `_altDh()`/`_altRange()`, client range helpers | The extra altitude bonus is removed (function identically one); envelope geometry carries the advantage; hero skill multipliers stay intact. | `audit_weapon_gate` |
| Ridge occlusion | `LOS.HGT_*`/`RIDGE_*`, `hgtEnc()`, `sim._ridgeBlocked()` | Server self-targeting paths only; judgments run in absolute elevation with errors toward unblocked; pass-throughs cover missing grids, tunnel endpoints, and short ranges. | `audit_weapon_gate` |
| Lance presentation | `game._lanceVisual()`, `lanceR(def)` | Shared across self, others, and bots with thickness equal to the server radius; no scenario multipliers of any kind. | — |
| Lazy magazine refill | `sim._refillIfDone()`, consumers `_gateFire()` and `heroReload()` only | With no per-tick server sweep, every path reading ammo passes through it first and MUST NOT read directly. | `audit_weapon_gate` |
| Hull height and radius | `SOLDIER_H`, `HERO_SIZE`, `heroTargetH()`, `hitH()`, `hitR()` | One measure feeds render scale and server hit volumes; blast, lance, and range gates measure to the nearest point of the hit volume; collider keys MUST NOT expand with target radius. | — |

Assertion details live in layer-4 audit script headers.
