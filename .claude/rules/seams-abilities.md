# §2.1 B — Abilities & Carriers (single seams)

> Layer 2: full definitions. Principles live in root `AGENTS.md`; assertion details live in audit script headers (layer 4). English only; no operations.

| Topic | Single seam | Constraints | Guards |
|---|---|---|---|
| Cast gesture | `abilHoldSlot()` | Hold-input is the ability gesture across mouse, keyboard, and touch through one router; MUST NOT re-branch on aiming per input. | — |
| Carrier origin and cooldown | `abilOrigin()`, `abilDelivered()`, `abilCdBand()`, `ULT_CARRIER` bands; server `_launchOrigin()`, `_launchUltCarrier()` | No instant resolution; slots differ only in origin (self vs nearest fort) and cooldown band under one order-preserving map; skills MUST NOT borrow delivery range. | `audit_ult_carrier` |
| Ult point delivery | `ULT_CARRIER`, `ultDelivered()`, `ultCdBand()`, `ultPartN()`; server `_castEffect()`, `_ultArrive()` | Conversion is derived, not rostered; effect replaces damage — interception fully negates with no blast; divisible budgets batch, indivisible states stay single-carrier. | `audit_ult_carrier` |
| Support fleet ults | `ULT_SUPPORT`, `kindParts()`, `supportStackable()`, `supportN()`, tempo and HP helpers; server `_launchUltSupport()`, `_tickSupport()`, `_supSync()` | Stacking is additive through remove-and-place sync; durability derives from frontline kill HP with legs in parallel; once-effects fire once; cooldown deliberately outside the standard band. | `audit_self_ult` |
| Self-ult compensation | `SELF_ULT`, `selfUltEq()`, `selfUltBoost()`; server rally/recon/overdrive/alpha branches, `_reviveBody()` | Equivalence derives from the special budget; redemption is additive; revive rescues counting-down bodies only through the non-respawn path; realized factor frozen. | `audit_self_ult` |
| Special budget ruler | `SPECIAL`, `specialBudget()`, `SPECIAL_CD_S` | No player-triggerable outlet remains; only equivalence and carrier pricing consume it; the cooldown constant is the conversion denominator, MUST NOT hand-write it. | — |
| Carrier forms | `SQUAD.KAMI`/`kamiSide()`, `DECOY`, `HYPER` trajectory set; sole spawn `_launchUltCarrier()` | All three are ult carriers only; saturation splits budget per airframe; clients render only and MUST NOT compute blast; hypersonic missiles are server entities and interception denies detonation; cluster bombs share one gravity factor between analytic and integrated paths. | `audit_flight_power` |
| Carrier HP pricing | `towerDps()`/`towerSurviveHp()`/`towerKillHp()` chain into `kamiHp()`/`hyperHp()`/`decoyHp()`; radius `specialBlastR()` | All HP derived, MUST NOT hand-write; all carriers armor-zero shield-zero; blast radius scales with budget share so total coverage equalizes; staging radius equals settlement radius. | — |
| Flight dynamics | `FLIGHT`, `airSinkM()`, `liftMax()`/`liftRegen()`/`liftDrainPS()`; bot path `sim._botAirSink()` | Sink is displacement proportional to damage (never velocity- or HP-based); lift drains only on climb; humans resolve client-side and bots server-side on the same measure; scripted paths exempt. | `audit_flight_power` |

Assertion details live in layer-4 audit script headers.
