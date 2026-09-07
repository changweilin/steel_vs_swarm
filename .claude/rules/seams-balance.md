# §2.1 A — Balance & Roles (single seams)

> Layer 2: full definitions. Principles live in root `AGENTS.md`; assertion details live in audit script headers (layer 4). English only; no operations.

| Topic | Single seam | Constraints | Guards |
|---|---|---|---|
| Balance values | `data.js` | All range, damage, economy, wave, role, and ability numbers settle here; simulation and game MUST NOT hardcode; narrative text lives apart. | — |
| Character kinds | `CHARACTERS[ch].kind`, `charKind()`, `heroKindOf()` | Faction MUST NOT imply kind; every character carries an explicit kind with fixed faction/kind quotas; moving faction moves models, signatures, and lore bonds together; weapons and abilities stay character-bound. | — |
| Hero weapon resolution | `heroWeapon()`, `heroAbility()` | Heroic multipliers, squad conversion, and range caps apply exactly once here; MUST NOT re-multiply downstream. | — |
| Damage falloff | `dmgFalloff`, `blastFalloff`, `fanFalloff` | Settlement and client HUD MUST consume the same functions. | — |
| Faction symmetry | `CLASS_SYM` derivation block | Correction factors scale back as a proportional group; MUST NOT hand-tune per-weapon values (adjust per-character damage steps instead). | — |
| Target-class building clamp | `TARGET_CLASS`, `vsMult()`, `BUILDING_VS_CAP` | Building bonuses removed (`vs.building ≤ 1`); the clamp loop runs after characters and MUST cover every definition carrying `vs`; hero damage carries no situational multiplier. | `audit_shield_counter` |
| Shield/armor split | `shieldSplit()`, `shieldRoleName()`, `vsSp`/`vsHp`/`spPierce` columns | All four consumers MUST consume them; overflow refunds by budget; zero shield-piercing degrades to full-block; armor values apply to shieldless targets. | `audit_shield_counter` |
| Shield-axis loadout discipline | `EX_SIEGE_WEAPONS`, `VS_DEFS` clamp, `COUNTER_BUDGET`/`counterLoad()`/`counterDmgF()` | Shield-piercing and anti-armor exist only on rostered ex-siege heavies; anti-shield columns clamp at one; broader bonuses imply lower base damage. | `audit_shield_counter` |
| Building DPS convergence | `BUILD_DPS`, `buildDps()`, convergence loop, sole write point `vs.building` | Tune `vs.building`, not damage steps; axis is the per-slot geometric midpoint; convergence redistributes without inflation; MUST NOT alter counter damage. | `audit_shield_counter` |
| Three-axis budgets | `AOE_BUDGET`/`aoeTrimF()`, `MOB_BUDGET`/`mobDmgF()`, `RANGE_BUDGET`/`rngDmgF()` | Every axis prices against the peer geometric midpoint; resolved range reads through one accessor; abilities are deliberately exempt. | `audit_aoe_trim` |
| Blast convergence | `AREA_WEAPONS` roster, `soloBlastRmax()`, `blastFootprintR()`, `blastFamily()`, `blastCapR()`, clamp loop | One blast MUST NOT catch two towers of one site; only blast enters clamping (fan/line exempt by mechanism); guided family stays below grenade tier; clamp maps authorized steps into the cap band. | `audit_aoe_trim` |
| Fire-rate compression | `RATE_DEF`, `FIRE_RATE`, `rateComp()`, `compressWeapon()`, `fireBurstN()` | Derivation loop, not edited values; curve strictly increasing so rankings hold; DPS invariance moves rate, damage, and magazine together; bursts are presentation-only. | `audit_fire_rate` |
| Movespeed compression | `SPEED_COMP`, `speedMid()`, `spdComp()`, `heroMobility()` | Geometric-midpoint axis; `heroMobility()` is the sole speed source; evasion thresholds follow the same map in every consumer. | `audit_speed_comp` |
| Recoil move penalty | `RECOIL`, `recoilMoveF()` | One climb scale gates client-side movement input only; the window is the recoil state itself; knockback exempt; flyers use the air branch; server uninvolved. | `audit_recoil_move` |
| Hex stat chart | `HEX_AXES`, `heroHexStats()`, `hexBand()` | Six axes derive from existing seams; UI only draws; sustained DPS reads through one function. | `audit_hex_stats` |
| Wave composition | `waveComp()`, `waveMarchSpeed()`, `waveSpacingM()`, `sim.waveInterval()` | Spawn interval fixed; prefill spacing and placement share one spawner; prefill capped at the lane's first tower. | — |
| Creep upgrades | `CREEP_UPG`, `creepUpgMul()`, `creepDmgTakenF()`, `sim._creepMul()` | Level stored per side per lane and stamped at spawn with no retroactivity; damage bonus applies only versus non-heroes; bounty unscaled. | — |
| Upgrade ladder | `ECON.UPG_STEPS`, `upgradePrice()`, `upgradeScore()`, `canUpgrade()` | Price and score thresholds are two dimensions of one table, MUST NOT split; `canUpgrade()` is the sole affordability check for all consumers. | — |
| Battle score | `BATTLE_SCORE`, `battleScoreGain()`, `addBattleScore()` | Kills and assists score higher versus players and towers; clamped at max and monotonic (never spent or deducted); both kill ledgers use the same gain. | — |
| Siege order | `SIEGE`, `siegeSiteStages()`, `siegeOpenStage()`, `sim.siegeLocked()`, `sim._siegeFell()` | Front-to-fortress order with full immunity plus targeting exclusion until the prior stage falls; battlefield-wide stages; HUD reads snapshots; the boss gate is a separate HP floor on the damage path only. | `audit_story_talk` |
| Story dialogue | `storytalk.js` (`STORY_TALK`, `talkOf()`), `dialogue.js` | Content, staging, and triggers MUST NOT intermix; cast covers chapter rosters; base scenes play on results screens, front lines as non-blocking radio bars. | `audit_story_talk` |
| Story UI markup | `storyui.js` | Game and storybook share one markup, one style, one staging; zero DOM/engine dependencies; event-free. | `audit_story_talk`, `audit_ui_layout` |
| Env label | `data.js envLabel()` | Single naming lookup for environments; lives in `data.js` for server-side loadability. | — |
| Duel model | `tools/duel.mjs` | Weapon-only by design (ability-driven characters exempt); chassis control runs through resolution seams only. | — |
| Lane sim model | `tools/lanesim.mjs`, sole schedule seam `reFire()` | All distances and times derive from `data.js`; never merged with the duel model (sole model pricing attack area); ledgers split by bucket. | — |

Assertion details live in layer-4 audit script headers.
