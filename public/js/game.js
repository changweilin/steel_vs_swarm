import { generateCivilian } from './civilianAppearance.js';
// ============ Combat client: first-person drones vs mechs + DOTA lanes ============
// Server-authoritative (HP/damage/waves); client owns:
//  - 3D rendering (terrain + units + effects)
//  - First-person controls (swarm = flying drone, steel = ground mech)
//  - Shooting raycast hit reports, AoE landing reports
//  - 2D tactical map (minimap, inherits 2D map concept from mapping_elf)
import * as THREE from 'three';
import {
  SIDES, UNITS, GAME, ECON, upgradePrice, upgradeScore, canUpgrade, HAZARDS, FIELD, AFFIXES,
   CHARACTERS, heroWeapon, heroAbility, castDirF, abilHoldSlot, heavyMpCost, BALLISTIC, vsMult, shieldSplit, dmgFalloff, offAxisFalloff, blastFalloff, MORPH, morphLiftCost, LOCK, VIEW_LOCK, viewLockStep, dofNearM, dofFarM, dofAimBlend, DECOY, DECOY_BOMB, SQUAD, RECOIL, recoilMoveF,
  heroMobility, highSupSpeedF,
  WATER, CJUMP, cjumpLiftCost, IFRAME, AIR, envTrigger, fluidFactor, sideInfo, isThirdSide, THIRD, AIRDROP, CIVILIAN, CIVILIANS,
  altRangeF, altRangeMax, LOS, TERRAIN_FX, SHAKE, TARGET_CLASS, CC_FLASH, ccFlashAlpha, ccFlashDur, VISION_BLIND,
  weaponMaxHoriz, inWeaponRange,
  BLOOD, bloodDur, bloodAlpha, bloodFrac, bloodDropR, bloodDropN, bloodScreenUv,
  GLINT, glintDur, glintAlpha, glintDropR,
  FLIGHT, airSinkM, liftMax, liftRegen, liftDrainPS, liftDescentPS, liftAltF, worldCeilY, edgeWallInsetM, SHIELD_DEFENSE,
  SLOPE, slopeDeg, slopeMoveF, slopeBlocked, slopeSnapM,
   aoeClass, trajClass, fanConeHalf, fanSubs, fanBinSpan, fanBinHitD, FAN_RANGE_CENTER_F, fanBinRangeF, lanceR, lancePen, lancePenCost, lanceZones, lanceZonePen, lanceRehitF, LANCE, ARMING, armingOf, guidedLaunchOf, guidedLaunchPitchDeg, guidedLaunchDist, lobMinRange, hitR, hitH, TARGET_H, chaseCapS,
  fireBurstN, fireBurstGap,
  reachRule, blastCoreR, shotV0, SEEK, seekTurn, SIEGE, bossGlow, bossSegFill, bossSegFrac, bossSegN, bossScaleF,
  SPEC_CAM, PLAYER_TPS, specViewNext, specViewLocked, lerpFPS, frictionFPS, camAngleStep,
  SELF_F, selfCollider, COLLIDE_KINDS, PUSH_EPS, baseCollideR,
   CREEP_UPG, DISSOLVE, dissolveOutAt, ATK_CAST_S, fogSightMult, scopeRvminFog,
  isSuperSide, SUPER_UPG, superCombatLvl, superScaleF,
  WEATHER_DEBUFFS, windSpeedFactor, laneCssColor,
  FIRE_WEATHER, fireDotMul,
    SCENE_STRUCT, sceneIsPhysical, clampHeroSpawn, solveTowerSites, mapArg,
} from './data.js';
import { llToWorld } from './terrain.js';
import { terrainEnvCode } from './biomes.js';
import { aquaticTransition } from './aquatics.js';
import { makeUnit, heroTargetH, SOLDIER_H, MORPH_HUMANOID, podWeapon } from './models.js';
import { applyEnvironment } from './environment.js';
import { Pipeline } from './postfx.js';
import { buildHazard, buildMineBump, buildLoot, buildAirdrop, stepFireVisual } from './hazards.js';
import { applySceneDamage, sceneDamageStage, sceneDamageProfile, sceneDamageBurst, releaseMobileDamage } from './sceneDamage.js';
import { syncLightningScorch, releaseLightningScorch } from './lightningScorch.js';
import { buildHpSkillObject } from './vfx.js';
import { MAP_BUILDING, collapseBuildingBoxes, buildingRoofIndex } from './mapBuilding.js';
import { detachMapBuilding, mapBuildingTarget } from './mapBuildingRender.js';
import { toonMat, outlinify, updateCelLight, stepCelWind, setCelChar, stepSwampRipples, setDissolve, CHAR, disposeTree, isWeatherFrozen } from './toon.js';
import { heroPalette, paintUnit } from './paint.js';
import { stepLocomotion, stepCombatFx } from './locomotion.js';
import { fireUnitMotion, stepUnitSpinners } from './unitMotion.js';
import { buildBaseBattery } from './buildingUnitModels.js';
import { lodStrideByD2, lodDue, GEO, geoTrimKeep, geoOutlineKeep, applyGeoLod } from './lod.js';
import { CULL, cullFarM, keepDistance, occludedBySphere, scopeKeep, scopeRadiusPx } from './cull.js';
import { TEX_STREAM, finishTex, collectMatStreamTexs, collectTreeStreamTexs, meshStreamAnchors, noteTexDemand, notePageDemand, flushTexStream } from './tex.js';
import { DRS, drsComplexity, drsEffectiveMs, drsStepDown, drsHoldS, drsRecoverLoMs } from './taa.js';
import { animWeights } from './animweights.js';
import { unitShotStyle, unitShotFx, comicPop, starburst, shockRing, impactBurst, explosionBurst, damageNumber, debrisBurst, makeHitShell, makeShieldMaterial, stepShieldMaterial, shieldHitStrength, lockGlow, glowTexture, beamLine, projectileMesh, stepProjectileFx, decoyBombMesh, cycloneJet, gundamBeam, ionBreath, makeDamageFx, makeStatusFx, DMG_FX, spawnTreesVFX, spawnDarkMoonVFX, spawnCubicSlabsVFX, spawnFogVFX, spawnHarpoonVFX, spawnReflectBarrierVFX, spawnEntangleLinkVFX, spawnThermiteMinesVFX, spawnThermitePuddleVFX, spawnPhaseShiftVFX, spawnPhaseExitVFX, spawnDecoyBeaconVFX, spawnFlashbangVFX, spawnNaniteSwarmVFX, spawnNaniteSplitVFX, spawnSingularityVFX, spawnSingularityImplosionVFX } from './vfx.js';
import { spawnCastFx, characterShieldTexture } from './castfx.js';
import { characterCombatStyle } from './characterStyle.js';
import { SHIELD_PRESENTATION_EXPAND } from './vfx.js';
import { CutIn } from './cutin.js';
import { isTouchUI, lowPower, TouchControls, onViewportSettled } from './mobile.js';
import { onCtrlChange, viewMode, setViewMode, onViewModeChange } from './ctrlmode.js';
import { lookPref } from './lookPrefs.js';
import { movePref } from './movePrefs.js';
import { visualPref } from './visualPrefs.js';
import { CLIMB, CLIMB_LABEL } from './climb.js';
import { planLaneGuidance } from './laneGuidancePlan.js';
import { buildLaneGuidance, laneGuidePlates } from './laneGuidance.js';
import { Pool } from './pool.js';
// audio is created by the app layer (main.js) and passed via opts.audio (BGM must survive across matches); consumed here only.

// All fire-field kinds (module-level constant; MUST NOT rebuild in _spawnEnt or per-frame hot path)
const FIRE_KINDS_C = new Set(['fire', 'forestfire', 'grassfire', 'factoryfire']);

const KIND_KEY = {
  soldier: 'creep:soldier', apc: 'creep:apc', tank: 'creep:tank',
  rocketeer: 'creep:rocketeer', howitzer: 'creep:howitzer', heli: 'creep:heli',
  tower: 'tower', drone: 'hero:drone', robot: 'hero:robot', morph: 'hero:morph', decoy: 'decoy',
  bunker: 'bunker',   // third-party bunker (GUER/MILI)
  kami: 'hero:drone', // escort kamikaze: rendered as that character drone (_spawnUnit scaled by SIZE_F)
  hyper: 'hyper',     // hypersonic missile (mech hold-ability projectile; position/orientation fully server-reported)
  drone_wingman: 'summon:drone_wingman',
  assault_rover: 'summon:assault_rover',
  decoy_beacon: 'summon:drone_wingman',
  heli_squad: 'summon:heli_squad',
  main_battle_tank: 'summon:main_battle_tank',
  veteran_squad: 'summon:veteran_squad',
  carnival_heli: 'summon:carnival_heli',
};
const HERO_KINDS = new Set(['drone', 'robot', 'morph']);
// Max samples for ballistic integration (step <=0.03s and about 3m per point). Draw buffer (_ensureArcGuide) and
// undrawn hittability check (_arcTrace draw=false) MUST share one cap, else they diverge on long arcs.
// 384 = covers 11.5s flight (2026-08-02 45-degree ground-lob rework): 45-degree solution back-solves v0 to only 41-46m/s,
// step pinned by 0.03s cap means full range needs 200-250 points, plus downhill long arcs (pitch -100m about 268 points).
// Old cap 264 exhausted the buffer before impact -- integration never reached aim point, so minD never closed into LOB_TOL;
// symptom was range glow never lit on valley-floor targets with the dashed line breaking off mid-air.
const ARC_MAXP = 384;
// Range-glow segment clearance tolerance (m). After 2026-08-03 rework the only costly check left is the reticle shot
// (at most one _reachable per frame); per-enemy evaluation degraded to pure geometry scan, so the old frame budgets / TTL
// cache (ARC_PER_FRAME / RAY_PER_FRAME / TTL_S) retired as a group, MUST NOT revive (that throttled the era when each enemy ran its own integration).
const RANGE_GLOW = { SURF_TOL_M: 0.5 };
// Third-person sight occlusion (presentation only): low-rate check avoids per-frame raycast against all Meshes;
// only fades opaque parts the ray actually pierces; fast fade-in plus slow fade-out with short hold after leaving sight,
// so grazing edges rest at translucent instead of binary flicker.
const TPS_OCCLUSION = {
  OPACITY_F: 0.24,
  UPDATE_S: 0.05,
  RELEASE_S: 0.25,
  FADE_IN_K: 10,    // fade-in (toward transparent) rate 1/s: fade on touch so view is never blocked
  FADE_OUT_K: 2.5,  // fade-out (recover) rate 1/s: slow release + hold window, no flicker on grazing edges
};
// Cluster-bomb throw arc (presentation only; user asked bomb throw arcs match grenades).
// GRAV_F: heavier-than-freefall feel (throw solver and per-frame integration MUST use the same value, else drawn landing drifts).
// T: flight time = horizontal distance / SPD, clamped to [MIN, MAX], so near throws snap out fast and far throws lob high, arc height varying naturally with distance.
const DECOY_BOMB_GRAV_F = 1.6;
const DECOY_BOMB_T = { MIN: 0.7, MAX: 2.2, SPD: 45 };
// ESC (battle menu) debounce window, seconds. While pointer is locked, pressing ESC makes the browser unlock first (which opens the menu via _onPlc),
// and a few browsers still deliver that same ESC keydown to the page, so without a guard the menu opens then instantly closes itself.
// One physical ESC press counts once; no human taps twice that fast (menu open/close needs a glance between presses).
const ESC_GAP_S = 0.35;
// Shop reservation resend window, seconds (see _tickReserve). MUST exceed one round trip plus one 8Hz snapshot (125ms) --
// shorter would reorder the same tier before the authoritative value returns; longer (seconds) is harmless (it is only a relief valve on rejection,
// the normal path always unlocks the next tier via authoritative level advance, never via timeout).
const RESERVE_RESEND_S = 2;
// Key prefix for faction creep-upgrade rows in the reservation list (lane index appended, creep:0). The eight-track keys are ECON.UPGRADES
// keys living in the same Set, so they need a prefix that can never collide with the eight tracks. Single canonical format:
// creation via _creepResKey, parsing via _resCreepLane; shop UI always takes the opaque string from _shopState().creepKey(lane)
// and MUST NOT build it inside main.js (a typo never errors, it just leaves the star lit but never completes).
const RES_CREEP = 'creep:';
// Hero collision cylinder: radius scales with body height. Factors preserve the old feel (robot 6m to r 2.6, drone 3m to r 2.4);
// once size binds to character armor, collision follows proportionally -- huge mechs are hard to dodge and hard to hide.
// Radius is never hand-written: always via data.js hitR (penetration horizontal bulk and collision bulk MUST use one ruler --
// separate copies cause hittable-but-untouchable mismatches); height follows heroTargetH x1.08 (headroom).
const heroCollider = (kind, ch, sv = 0) => ({
  r: hitR({ hero: true, kind, ch, sv }),
  h: heroTargetH(kind, ch) * superScaleF(sv) * 1.08,
});
// Own-collision / eye height ratios: homed in data.js since 2026-08-02 (server bot collision eats the same copy -- see selfCollider)
// FPV eye = actual cockpit/head position on that body geometry (2026-07-12):
//   e = fraction of body height (old regime used 0.567 for all = humanoid chest, which put horizontal-axis beasts on belly view)
//   f = forward (-z) offset fraction -- horizontal-axis beast heads sit far ahead, humanoid mech heads sit nearly overhead.
// Keys = visual.proto / visual.creature / visual.ground (morph ground form); miss falls back to DEF.
const VIEW_SHAPE = {
  // Humanoid mech (cockpit at chest top to neck root)
  bastion: { e: 0.72, f: 0.10 }, seraph: { e: 0.76, f: 0.08 },
  aegis: { e: 0.70, f: 0.10 }, colossus: { e: 0.80, f: 0.06 },
  // Head cockpit (upright form): eye sits inside the cranium
  gorilla: { e: 0.82, f: 0.18 }, roo: { e: 0.86, f: 0.14 }, cthulhu: { e: 0.74, f: 0.16 },
  // Neck cockpit (horizontal form): eye at neck root, head below-ahead, so forward shift stays small (head itself fills front view)
  hound: { e: 0.74, f: 0.12 }, trex: { e: 0.80, f: 0.10 }, ostrich: { e: 0.84, f: 0.12 },
  stego: { e: 0.62, f: 0.14 }, centaur: { e: 0.88, f: 0.08 },
  // Morph ground forms (humanoid = head cockpit / beast = neck cockpit)
  vampire: { e: 0.80, f: 0.08 }, monkey: { e: 0.76, f: 0.16 },
  wolf: { e: 0.78, f: 0.12 }, atlas: { e: 0.74, f: 0.16 },
  elephant: { e: 0.74, f: 0.12 }, raptor: { e: 0.78, f: 0.10 },
  beetle: { e: 0.66, f: 0.14 }, panther: { e: 0.72, f: 0.12 },
};
const VIEW_DEF = { e: SELF_F.eye, f: 0.10 };
// Light-weapon mounts (2026-07-12): body plan decides where the weapon lives --
//   hand / tentacle / mouth (dragon, trex, plasma mouth) / back turret (handless bio)
//   / body fixed (rotor-drone pod) / wing fixed (jet hardpoint) / claw gun pod
const GUN_MOUNT = {
  // Humanoid mechs + handed bios (2026-07-17: trex light weapon moved to hand, gorilla shoulder-carry = back anchor)
  bastion: 'hand', seraph: 'hand', aegis: 'hand', colossus: 'hand',
  gorilla: 'back', roo: 'hand', centaur: 'hand', cthulhu: 'tentacle',
  // Handless bios: mouth cannon or dorsal or wing-hidden (ostrich 2026-07-17 light weapon hidden in left wing)
  trex: 'hand', hound: 'back', ostrich: 'wing', stego: 'back',
  // Morph ground forms (2026-07-17: raptor two-hand grip, monkey staff-cannon shoulder-carry = back anchor)
  wolf: 'hand', vampire: 'hand', monkey: 'back', atlas: 'hand',
  raptor: 'hand', elephant: 'mouth', beetle: 'mouth', panther: 'back',
  // Mimic drones / mimic flight forms
  bee: 'mouth', eagle: 'mouth', dragon: 'mouth', ptero: 'claw',
  levi: 'mouth', archo: 'mouth', owl: 'mouth',
  // Mechanical flight forms
  heli: 'body', tilt: 'body', jet: 'wing', uav: 'wing',
};
// Mount anchors (single copy since 2026-08-15): x = right-side mount (wing/claw mirrored as pair), s = caliber scale.
// Old regime had one copy per cockpit builder with fallback here; those builders retired with the old modeling,
// so only this table remains -- it gives just the start point, and _mountCockpitWeapon four framing clamps decide the final
// (radial push out of reticle cone / press under top-edge line / aim at vanishing point / bisect to largest compliant size).
const DEF_ANCHOR = {
  hand: { x: 0.5, y: -0.4, z: -1.0, s: 1.12 },
  tentacle: { x: 0.52, y: -0.5, z: -0.95, s: 1.2 },
  mouth: { x: 0, y: -0.6, z: -1.35, s: 1.05 },
  back: { x: 0.52, y: 0.48, z: -1.55, s: 0.85 },
  body: { x: 0.2, y: -0.34, z: -0.7, s: 1.0 },
  wing: { x: 0.9, y: -0.22, z: -1.0, s: 1.0 },
  claw: { x: 0.42, y: -0.72, z: -1.05, s: 0.9 },
};
// Heavy-weapon mounts (2026-07-22 FPV armament same-source): FPV heavy model mounts (lights follow GUN_MOUNT).
// Handheld rigs (rig.weap L/R/B) prefer hand and skip this table; miss falls back to that body light mount.
// Aligned to third-person model spots: aegis twin-shoulder VLS / colossus brow cannon / stego dorsal fin / elephant dorsal cannon / monkey tail cannon = back,
// trex oral recoilless / dragon oral missile nest / beetle submaxillary plasma array = mouth, eagle/ostrich wing mounts = wing.
const HEAVY_MOUNT = {
  aegis: 'back', colossus: 'back', trex: 'mouth', stego: 'back', hound: 'back',
  gorilla: 'back', ostrich: 'wing', cthulhu: 'tentacle',
  elephant: 'back', monkey: 'back', panther: 'back', beetle: 'mouth',
  bee: 'body', eagle: 'wing', dragon: 'mouth', ptero: 'claw',
};
/** Key resolution for gunMount (morph ground/flight forms, drone mimic beasts; same rule as inside gunMount) */
function mountKey(vis, kind, air) {
  if (kind === 'morph') return air ? vis.flight : vis.ground;
  if (kind === 'drone') return vis.form === 'avian' ? vis.creature : null;
  return vis.proto || vis.creature;
}
// Correction rotation from rig.wpn.fwd (weapon forward axis in own/reference frame) to FPV forward (-z)
const WPN_FWD_ROT = {
  z: [0, Math.PI, 0], '-z': [0, 0, 0],
  y: [-Math.PI / 2, 0, 0], '-y': [Math.PI / 2, 0, 0],
  x: [0, Math.PI / 2, 0], '-x': [0, -Math.PI / 2, 0],
};
// Cockpit weapon target length (m, by mount; times anchor caliber scale s) -- sizing datum for scaling third-person armament into the cockpit
const COCK_WLEN = { hand: 1.25, tentacle: 1.05, mouth: 1.1, back: 1.25, body: 0.9, wing: 0.85, claw: 0.85 };
/**
 * FPV framing rules (2026-07-24 user demand, single source of truth; audit = tools/audit_cockpit.mjs):
 * 0 Center cell of the 3x3 screen grid MUST stay clear (2026-08-15 user; GRID_NDC) -- runtime clamps honor only this,
 *    parts inside the cell shift out sideways or down (MUST NOT move up). Rule 1 follows from it (cell covers cone), kept as witness.
 * 1 View must not block sight -- inside SIGHT_DEG reticle-cone half-angle MUST stay clear (no cockpit part projection may intrude)
 * 2 Each part top edge MUST stay at or below TOP_NDC = two-thirds from HUD lower-band top edge to reticle (never rise past this line toward reticle)
 * 3 Area must stay small -- total cockpit occlusion <= AREA_MAX, armament <= WPN_AREA_MAX;
 *    and each device unrelated to weapons/abilities MUST stay <= that cockpit largest single weapon part (DEV_AREA; audit hard rule)
 * 4 Perspective with vanishing point at reticle -- armament always converges toward VP_Z meters on the sight axis (= reticle direction),
 *    wide-near narrow-far wedge silhouette leading the eye to the reticle; same as real boresight harmonisation.
 * Geometry (fov 68 all bodies, A8): half-height half-angle 34 deg gives tan34 = 0.6745;
 * screen half-height at depth z = 0.6745|z|, half-width = half-height times aspect. NDC bounds +-1.
 */
// HUD lower band share of screen height. 2026-08-15 user locked HUD to at most 1/6 of screen height, so this number is
// a ceiling not a measurement: CSS (--hud-h, style.css .hud-bottom) and this constant MUST be the same 1/6,
// because it decides both HUD height and where cockpit part top edges press (TOP_NDC derives from it).
// A split shows as a cockpit top-edge line landing mid-HUD or above -- on screen it just looks like HUD covering something.
const HUD_BOTTOM_F = 1 / 6;
const HUD_TOP_NDC = -1 + 2 * HUD_BOTTOM_F;       // HUD lower-band top edge NDC y (= -2/3)
export const COCKPIT = {
  // Center cell of the 3x3 screen grid MUST stay clear (2026-08-15 user: nothing in the middle cell,
  // move what is inside). Outermost hard rule, and it covers the 11-degree reticle cone below:
  // the closest point on the center-cell border to the sight axis is the edge midpoint (0, 1/3), angle atan(1/3 x TAN_V) = 12.7 deg > 11 deg
  // so the cone sits fully inside the cell. Both stay on purpose -- cone is the minimum aiming clearance (same bound as flare push-out),
  // cell is picture composition; two rulers for one thing, clamps honor the stricter cell, audit keeps the cone as witness.
  // Reposition means translate not shrink: parts inside move along the shortest exit (sideways or down, MUST NOT move up --
  // sky and distant aircraft live above), shrink only when push cannot clear.
  GRID_NDC: 1 / 3,
  // Tolerance (deg) for whether fov has returned to normal. _updatePlayer zoom in/out stops when gap < 0.05
  // so this MUST exceed 0.05, else the cockpit never comes back.
  FOV_EPS: 0.1,
  SIGHT_DEG: 11,        // reticle-cone half-angle (= central 1/3 view, same bound as flare push-out). Hard rule: zero occlusion inside cone
  AREA_MAX: 0.21,       // total cockpit occlusion cap (screen share) -- at least 79 percent stays fully clear (busiest cockpit = rotor/intake/beast ears)
  WPN_AREA_MAX: 0.12,   // armament (gunGroup: arms/mounts/bodies) occlusion cap -- light plus heavy visible together with gun arms
  // Top-edge ceiling: two-thirds from HUD top edge to reticle (= HUD_TOP_NDC/3 about -0.222). No part top edge may rise past this line, so
  // the third above the reticle stays clear and all cockpit elements press into the lower screen. Weapons and structure share one line (MUST NOT split).
  TOP_NDC: HUD_TOP_NDC / 3,
  // Single-part area cap (2026-08-15 user locked: no single part may exceed 5 percent of screen).
  // This is the user-visible hard ceiling; every cockpit piece (weapon body / grip mechanism / body silhouette / frame)
  // must stay under it; audit measures real rendered occlusion (tools/audit_cockpit.mjs, per-part solo render reading back alpha).
  // The two below are runtime clamp knobs, both MUST stay below PART_AREA_MAX -- they clamp the NDC bounding box,
  // and box area is always >= rendered area, so clamping the box constructively clamps the 5 percent, not vice versa.
  // Knobs tighter than the ceiling is deliberate (first half of the same user line: must not dominate the view);
  // to relax, walk the grid toward PART_AREA_MAX, MUST NOT set knobs straight to 0.05.
  PART_AREA_MAX: 0.05,
  // 2026-08-14 new modeling: the same box is packed fuller (old weapons were a few tubes, new ones dozens of parts), so
  // the same box cap converts to larger real occlusion (measured s04 11.5 to 12.1 percent, m05 11.6 to 12.0 percent, both over WPN_AREA_MAX).
  // Box cap therefore stepped down one notch to press real occlusion back in budget; the user-visible WPN_AREA_MAX rule did not move.
  WPN_BOX_MAX: 0.048,   // NDC box screen share cap per armament part (one light plus one heavy adds to about WPN_AREA_MAX)
  DEV_AREA_MAX: 0.042,  // per-device cap for non-weapon/ability gear -- always below WPN_BOX_MAX (devices stay smaller than weapons)
  VP_Z: 25,             // vanishing-point distance (m): convergence point on sight axis, on screen it is the reticle
  VP_TOL_DEG: 12,       // allowed angle between weapon axis and weapon-to-vanishing-point line
  TAN_V: 0.674443,      // tan(fov/2) at fov 68
};
/**
 * Cockpit body-silhouette part-pick params (2026-08-15; single seam, see _cockBody header).
 * All are fractions of body height or screen share -- MUST NOT use absolute meters (body height differs per character).
 */
const COCK_BODY = {
  // Sample point recedes from eye along sight axis (times full height). Ground-form true eyes sit in chest/cranium (pauldron bulk center z about 0);
  // flight-form eyes sit at the nose (VIEW_FLY_F, whole body behind), so without receding there is nothing ahead,
  // and the symptom is empty cockpits on those frames (existing asserts all green, because an empty cockpit passes every rule).
  BACK_F: 0.22,
  BACK_F_AIR: 0.62,
  R_F: 0.90,      // sample radius (times full height): farther parts are only pixels in the cockpit
  D: 1.15,        // reprojection sphere radius (m): uniform scale to near field, projection stays pixel-identical
  ZNEAR: 0.75,    // min depth after reprojection (m; camera near plane 0.5)
  K_MAX: 5,       // magnification cap: beyond this it is a plate pasted on the lens, not own parts in view
  FRONT_F: 0.16,  // bulk-center forward-component floor (times distance): too-sideways parts have noisy reprojected direction
  N: 8,           // max parts (draw-call vs recognizability tradeoff)
  BUDGET: 0.15,   // NDC box area sum cap for structure (AREA_MAX total minus armament and frame headroom)
  MIN_F: 3e-4,    // skip tiny parts: unreadable, just noise
};
/** World half-height (m) for NDC radius 1 at depth |z|: single seam for cockpit part edge/clearance math */
const ndcH = (z) => Math.abs(z) * COCKPIT.TAN_V;
/**
 * Outline-shell world push-out (m; outlinify(g, 0.012) expands along normals plus margin) --
 * single seam shared by top-edge and area clamps. Shell expands in the vertex shader, never in geometry, so any
 * box-based clamp MUST add this span itself, else it clamps the no-outline version.
 */
const INK_W = 0.016;
/**
 * Animation-pose sample count (one spin round / one sway cycle) -- clamp envelope precision.
 * 12 is the lower bound that never skips the widest paddle angle: three-blade prop repeats every 120 deg, 12 samples = one bin per 30 deg,
 * worst missed lateral span is cos(15 deg) = 96.6 percent, remaining 3.4 percent eaten by outline push-out INK_W.
 */
const ANIM_N = 12;
/**
 * Armament-animation search bound (single seam; effective value back-solved by _solveGunPose, see that header).
 * PULL_MAX = recoil springback 0.11 + reload full-tube pull 0.4 (beam/rail branch largest) -- both can coincide.
 * Elevation bound takes BALLISTIC.LOB_SUP_MAX directly (that number is the vision-only clamp).
 */
const GUN_POSE = { PULL_MAX: 0.51, DROP_MAX: 0.5, PULL_N: 4 };
/**
 * ?cockanim=0 -- turns off the whole clamp-measures-animation-envelope behavior, back to pre-2026-08-15
 * (measure only the rest frame, armament raised around the camera to LOB_SUP_MAX). Reverse-check entry for audit
 * (audit_cockpit --break-anim), same convention as ?sag=0 / ?morph=0 / ?gait=0.
 */
const COCK_ANIM = typeof location === 'undefined'
  || new URLSearchParams(location.search).get('cockanim') !== '0';
/**
 * ?selfbed=1 -- includes self in the movement ground bed (footstep/engine kinds).
 * Current regime (same since 2026-07) explicitly skips ent.isSelf, so players never hear their own body,
 * while 7-2 line about stepping hollow over water semantically means own footsteps. Inclusion is the first time players hear
 * their own body = audible behavior change, a user-ruling topic (see docs pending lane-motion.md ruling 2)
 * so per project convention it is a knob defaulting to off (bit-identical to old regime). Same convention as ?amb=0 / ?cockanim=0.
 */
const SELF_BED = typeof location !== 'undefined'
  && new URLSearchParams(location.search).get('selfbed') === '1';
/**
 * ?tread=0 -- turns off bodies brushing grass aside at their feet (5-1; seam = CHAR / setCelChar in toon.js).
 * When off, _charSlots returns an empty array, so setCelChar writes spd 0 into every slot, and that vertex-shader span
 * early-outs per slot with continue (early-out adds nothing instead of adding 0: x + 0.0 is not identity for -0.0),
 * hence bit-identical to old regime. Also the control entry for audit_soft_stroke --break-char,
 * same convention as ?sag=0 / ?morph=0 / ?gait=0 / ?cockanim=0.
 */
const TREAD = typeof location === 'undefined'
  || new URLSearchParams(location.search).get('tread') !== '0';
const _ZERO3 = new THREE.Vector3();
/**
 * Cockpit part screen share (NDC bounding-box area / full screen) -- single seam shared by structure and weapon bodies.
 *
 * MUST project all eight corners for the bounding box, MUST NOT use span-divided-by-near-plane screen width as approximation:
 * that approximation only holds for a thin plate facing the camera. Cockpit parts are almost all off-axis and deep
 * (a gun slung at lower right, nearly a meter deep) -- its screen box runs from far-end min NDC to
 * near-end max NDC, while the approximation projects the same lateral span at the near end, undercounting by half
 * (measured s03 handgun: approximation 12.3 pct x 21.8 pct, real render 25.3 pct x 35.8 pct).
 * Symptom is the clamp believing 3.6 percent while the user rule single part <= 5 percent measures 5.2 percent.
 *
 * Pad one outline shell per axis (see INK_W). Depth always clamped above 0.05 (things inside the near plane do not draw,
 * but a near-zero denominator blows the share up).
 */
const ndcBox = (lo, hi) => {
  const ASPECT = 16 / 9;                        // framing datum (never drifts with window; same value as audit plane)
  let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
  for (const z of [Math.max(0.05, Math.abs(hi.z)), Math.max(0.05, Math.abs(lo.z))]) {
    const hh = ndcH(z), hw = hh * ASPECT;
    x0 = Math.min(x0, (lo.x - INK_W) / hw); x1 = Math.max(x1, (hi.x + INK_W) / hw);
    y0 = Math.min(y0, (lo.y - INK_W) / hh); y1 = Math.max(y1, (hi.y + INK_W) / hh);
  }
  return { x0, x1, y0, y1 };
};
const ndcFrac = (lo, hi) => {
  const b = ndcBox(lo, hi);
  return ((b.x1 - b.x0) / 2) * ((b.y1 - b.y0) / 2);
};
/**
 * Center-cell push-out (single seam; three consumers: structure clamp / grip-mechanism acceptance / weapon framing).
 *
 * Returns the shortest shift (world meters, only x or y nonzero) that pushes this part out of the center cell;
 * null when already outside. Directions consider horizontal and down only -- pushing up wedges the part between sky and distant aircraft,
 * which the top-edge line (TOP_NDC) already forbids.
 *
 * Displacement is computed in world space (NDC delta times screen half-height at that depth): parts are rigid bodies, translation edits world coords,
 * editing NDC directly would either push per depth (shearing the part) or iterate guesses. Depth choice is critical --
 * MUST take the near face (min |z|): the same world shift converts to the largest NDC shift at the near end, far-end math under-pushes.
 */
const mid9Push = (lo, hi) => {
  const b = ndcBox(lo, hi);
  const G = COCKPIT.GRID_NDC;
  if (b.x0 >= G || b.x1 <= -G || b.y0 >= G || b.y1 <= -G) return null;   // already outside cell
  const zn = Math.max(0.05, Math.min(Math.abs(lo.z), Math.abs(hi.z)));
  const hh = ndcH(zn), hw = hh * (16 / 9);
  const right = (G - b.x0) * hw;        // push right until left edge meets +1/3
  const left = (b.x1 + G) * hw;         // push left until right edge meets -1/3
  const down = (b.y1 + G) * hh;         // sink until top edge meets -1/3
  const m = Math.min(right, left, down);
  const EPS = 0.01;                     // flush fit gets eaten by float and outline shell, so push a hair more
  if (m === down) return { x: 0, y: -(down + EPS) };
  return { x: (m === right ? right + EPS : -(left + EPS)), y: 0 };
};
export { HUD_BOTTOM_F };
const HUD_FIT_S = 0.5;                           // throttle interval (s) for HUD-fit remeasurement
/**
 * HUD lower-band fit (2026-08-15 user: HUD at most 1/6 of screen height) --
 * single seam, both callers (_onResize and tick throttle) MUST route here.
 *
 * Why this helper must exist instead of sizing all CSS in vh: band height is content-driven
 * (ten data rows plus minimap, each with its own font size and margins), and CSS cannot divide a length into a unitless
 * scale factor, so at-most-1/6-of-screen is inexpressible in pure CSS without converting every row to vh and hand-reconciling,
 * and missing any row shows as HUD eating a third of the screen on small windows. Measure natural height once here, compute one ratio,
 * hand it to CSS --hud-k -- one number governs all.
 *
 * Three rules: 1 restore --hud-k to 1 before measuring (measure natural height, not the last shrunk result,
 * else it shrinks into a line over rounds); 2 touch .hud-bottom is a positioning frame not a data band (inset:0),
 * shrinking it shrinks the whole touch HUD, so the CSS side disables this variable under body.touch-ui;
 * 3 ratio may only shrink never grow (min(1, ...)) -- growing sparse content turns a cap into fill.
 */
export function fitHudBand() {
  const el = document.querySelector('.hud-bottom');
  if (!el) return;
  el.style.setProperty('--hud-k', '1');
  const nat = el.getBoundingClientRect().height;
  const cap = (el.parentElement?.clientHeight || window.innerHeight) * HUD_BOTTOM_F;
  el.style.setProperty('--hud-k', nat > cap && nat > 0 ? String(cap / nat) : '1');
}
// Heavy-weapon third-person mount animation (2026-07-13; moved to locomotion.js stepCombatFx on 2026-07-15):
// charge/fire/recoil/stance animation driven by ent.heavyFx / ent.fireFx events all lives in stepCombatFx --
// battlefield (here) and picker stage (charPreview) share one copy, MUST NOT write a second copy in game.js.
/** Light-weapon mount for this body (this form). Plasma is a mouth weapon: dorsal mounts on handless bios always become mouth */
function gunMount(vis, kind, air, wtype) {
  let m;
  if (kind === 'morph') m = GUN_MOUNT[air ? vis.flight : vis.ground] || (air ? 'body' : 'hand');
  else if (kind === 'drone') {
    m = vis.form === 'avian' ? (GUN_MOUNT[vis.creature] || 'mouth')
      : vis.form === 'fixed' ? 'wing' : 'body';
  } else m = GUN_MOUNT[vis.proto || vis.creature] || 'hand';
  if (wtype === 'plasma' && m === 'back') m = 'mouth';   // plasma vents from the mouth, never from the back
  return m;
}
// Flight form: body axis horizontal, eye at the nose (height takes body center 0, shifted forward only)
const VIEW_FLY_F = { avian: 0.42, fixed: 0.55, rotor: 0.25, morph: 0.45 };
/** FPV eye ratio for this character body (by shape, not by class). flying = flight form */
const heroView = (kind, ch, flying) => {
  const vis = (ch && CHARACTERS[ch]?.visual) || {};
  if (flying) {
    const cls = kind === 'morph' ? 'morph' : (vis.form === 'avian' || vis.form === 'fixed' ? vis.form : 'rotor');
    return { e: 0, f: VIEW_FLY_F[cls] };
  }
  return VIEW_SHAPE[vis.proto || vis.creature || vis.ground] || VIEW_DEF;
};

// ---- Shared scratch for per-frame hot paths (ballistics/reticle run dozens of times per frame; one new per call is GC jitter) ----
// Single discipline: use-and-drop inside the same sync block only, MUST NOT store into cross-frame bullets/effects structures.
const _ZERO2 = new THREE.Vector2(0, 0);        // reticle NDC (always screen center)
const _NO_HITS = [];                           // empty hit list (avoids allocating per raycast)
const _TMP_A = new THREE.Vector3();
const _TMP_B = new THREE.Vector3();
const _TMP_C = new THREE.Vector3();
const _TMP_D = new THREE.Vector3();            // hit-point scratch (_updateBullets/_updateVisShells: consumed this frame, never across frames)
const _TMP_E = new THREE.Vector3();            // second-hit scratch (cyclone/trail direction solve; same rule)
const _TMP_F = new THREE.Vector3();            // cyclone orthogonal-axis scratch (_spinCyclone private; D/E/F count as borrowed during the call)
const _FWD_Z = new THREE.Vector3(0, 0, 1);     // projectile geometry faces +z; fixed datum axis for heading alignment
const _UP_Y = new THREE.Vector3(0, 1, 0);      // vertical axis +y; fixed datum for cylinder/normal alignment
const _shotColCache = new Map();               // faction tracer color cache (avoids new THREE.Color string parse per shot)

// ---- Shared fade for pooled effects (no closures: params all in obj.userData, one function serves all pools) ----
// Per-shot closures (fade: (o,f) => ...) are themselves per-shot allocations; pooled sprites/tracers with closures
// make the pool pointless. Carry params in userData plus a shared function, so acquire writes values without allocating functions.
function _tracerFade(o, f) { o.material.opacity = 0.9 * f; }
// Constant-drift sprite (smoke/fire trail/touchdown smoke/burst fire-smoke column): userData { vel (steady, with rise), base, grow, op, delay? }
function _spriteDriftFade(o, f, dt) {
  const u = o.userData;
  const p = 1 - f;
  if (u.delay > 0) {
    if (p < u.delay) { o.visible = false; return; }
    o.visible = true;
  }
  o.position.addScaledVector(u.vel, dt);
  o.scale.setScalar(u.base + p * u.grow);
  o.material.opacity = u.op * f;
}
// Gravity ember: userData { vel (falls per frame), op }; fixed size (base frozen at acquire)
function _spriteGravFade(o, f, dt) {
  const u = o.userData;
  u.vel.y -= 6 * dt;
  o.position.addScaledVector(u.vel, dt);
  o.material.opacity = u.op * f;
}

/**
 * Rays only accept solid meshes (single seam; two consumers: reticle resolve _resolveAim and ballistics _updateBullets).
 *
 * Both call intersectObjects(cand, true) -- recursing into the whole ent.mesh tree, but a body carries more
 * than its body: range glow (_updateRangeGlows) and lock glow (vfx.lockGlow) are child Sprites of ent.mesh,
 * and three Sprite.raycast tests that camera-facing quad. Glow diameter =
 * larger of body height/width times 1.15, so that heli glow measured 11.7m (body hitR only 3m):
 *   - reticle: counts as hitting that unit 6m off the hull, then air-burst aiming moves the aim point to the body geometric center,
 *     so the grenade landing ring sits 9.4 deg off the reticle (3m / 4.6 deg after filtering glows = truly hitting the rotor disk).
 *     It also self-locks -- the glow is lit because the unit sits inside this shot damage footprint, and sticking to the reticle keeps it inside.
 *   - ballistics: shells passing a glow-lit unit detonate 6m off the hull in mid-air.
 * Both symptoms log nothing and appear only when units light up (= in combat).
 *
 * Criterion is is-Mesh not is-Sprite: every hittable bulk in this project is Mesh / SkinnedMesh /
 * InstancedMesh, while Sprite / Line / Points are always presentation overlays (principle 4) --
 * exclusion keeps the next wall sign hung under ent.mesh from silently regressing.
 */
const raySolid = (o) => o.isMesh === true;

// ---- Enemy marks: enemies entering view get a down-arrow in their faction main visual (spotted marker) ----
// Main visual = faction identity color + emblem geometry (STEEL upright triangle / SWARM inverted triangle, same logo language).
// Fog is server-filtered: appearing in the snapshot means already in view, so any mesh deserves its mark.
const _markTex = new Map();
function factionMarkTex(side) {
  if (_markTex.has(side)) return _markTex.get(side);
  const S = 128;
  const cv = document.createElement('canvas');
  cv.width = cv.height = S;
  const g = cv.getContext('2d');
  const col = sideInfo(side).color;                // third parties (GUER/MILI) have identity colors too
  const tri = (cx, cy, r, up) => {                 // faction emblem: steel upright / swarm inverted triangle
    g.beginPath();
    for (let k = 0; k < 3; k++) {
      const a = (up ? -Math.PI / 2 : Math.PI / 2) + k * Math.PI * 2 / 3;
      const x = cx + Math.cos(a) * r, y = cy + Math.sin(a) * r;
      k ? g.lineTo(x, y) : g.moveTo(x, y);
    }
    g.closePath();
  };
  const diamond = (cx, cy, r) => {                 // third-party emblem: diamond (split from dual-faction triangles)
    g.beginPath();
    g.moveTo(cx, cy - r); g.lineTo(cx + r * 0.72, cy); g.lineTo(cx, cy + r); g.lineTo(cx - r * 0.72, cy);
    g.closePath();
  };
  g.lineJoin = 'round';
  g.strokeStyle = 'rgba(10,14,18,0.9)';
  g.fillStyle = col;
  g.lineWidth = 7;
  g.beginPath();                                   // down-arrow body (V wedge)
  g.moveTo(20, 46); g.lineTo(64, 108); g.lineTo(108, 46);
  g.lineTo(86, 46); g.lineTo(64, 76); g.lineTo(42, 46);
  g.closePath();
  g.stroke(); g.fill();
  if (SIDES[side]) tri(64, 26, 22, side === 'STEEL');   // emblem floats above the arrow
  else diamond(64, 26, 24);
  g.stroke(); g.fill();
  g.strokeStyle = 'rgba(255,255,255,0.85)';        // inner white rim: legible on dark and bright ground
  g.lineWidth = 2;
  g.stroke();
  const t = finishTex(new THREE.CanvasTexture(cv), { srgb: true, stream: false });
  _markTex.set(side, t);
  return t;
}
// ---- Ally marks: small round emblem over same-faction units (split shape from enemy down-arrow) ----
// Enemy/friend two tracks: enemy = down-arrow (alert), friend = ring emblem (safe); colors share faction identity,
// and split shapes let silhouettes alone tell friend from foe in a melee without reading color first.
const _allyTex = new Map();
function allyMarkTex(side) {
  if (_allyTex.has(side)) return _allyTex.get(side);
  const S = 128;
  const cv = document.createElement('canvas');
  cv.width = cv.height = S;
  const g = cv.getContext('2d');
  const col = sideInfo(side).color;
  g.lineJoin = 'round';
  g.strokeStyle = 'rgba(10,14,18,0.9)';
  g.fillStyle = col;
  g.lineWidth = 8;
  g.beginPath();                                   // outer ring
  g.arc(64, 62, 34, 0, Math.PI * 2);
  g.stroke(); g.fill();
  g.strokeStyle = 'rgba(255,255,255,0.9)';         // inner white ring: every friend carries a white rim
  g.lineWidth = 4;
  g.beginPath();
  g.arc(64, 62, 26, 0, Math.PI * 2);
  g.stroke();
  g.fillStyle = 'rgba(10,14,18,0.85)';             // emblem base plate
  g.beginPath();
  g.arc(64, 62, 18, 0, Math.PI * 2);
  g.fill();
  g.fillStyle = col;                               // center faction emblem (steel upright / swarm inverted / third-party diamond)
  g.strokeStyle = 'rgba(10,14,18,0.9)';
  g.lineWidth = 3;
  g.beginPath();
  if (SIDES[side]) {
    const up = side === 'STEEL', cx = 64, cy = 62, r = 13;
    for (let k = 0; k < 3; k++) {
      const a = (up ? -Math.PI / 2 : Math.PI / 2) + k * Math.PI * 2 / 3;
      const x = cx + Math.cos(a) * r, y = cy + Math.sin(a) * r;
      k ? g.lineTo(x, y) : g.moveTo(x, y);
    }
  } else {
    g.moveTo(64, 49); g.lineTo(75, 62); g.lineTo(64, 75); g.lineTo(53, 62);
  }
  g.closePath();
  g.fill();
  const t = finishTex(new THREE.CanvasTexture(cv), { srgb: true, stream: false });
  _allyTex.set(side, t);
  return t;
}
// Sub-window (PiP): drone wingman view / morph cluster-bomber view
// Top-left: minimap sits bottom-right, kill-feed top-right (both DOM, always above the WebGL canvas)
const PIP = { W_FRAC: 0.17, MAX_W: 250, ASPECT: 0.62, PAD: 12, TOP: 58, GAP: 8, FOV: 78 };

// Minimap vicinity mode (KeyM / touch d-pad right switches) window size. Pure display constant, not a balance number, so it lives here not in data.js.
// Radius takes own sight x aim bonus x PAD: aim bonus is always included, else entering scope mode would rescale the map under the reader
// and cause motion sickness; fixed at max visible range so scoped and unscoped share one scale.
const MM_NEAR = {
  PAD: 1.15,     // margin ring outside sight (targets just entering sight never hug the frame)
  MIN_R: 140,    // floor radius (m): short-sight bodies still show bearings
  SPEC_R: 420,   // free-spectate camera has no own body, hence no sight to take, so use a fixed radius
};

// Spectate view: constants and pure math all live in data.js SPEC_CAM (audit audit_spectator_cam.mjs tests the originals),
// game.js is only a consumer -- MUST NOT open a second coefficient table here (see that file header).
// Player-view yaw eats server-authoritative ry; snapshots carry no pitch, so pitch stays with the spectator (degraded, no exception).

// ---- Presentation resource caps (pure perf insurance, not balance numbers, so they live here not in data.js) ----
// One fan volley spits 20-30 effect objects; sustained fire plus many players on screen grows effects into the hundreds,
// and per-frame fade over each is pure CPU load. Over cap drops the oldest (they were nearly faded out, visually negligible).
const FX_MAX = 260;
// Same-type projectile pool depth: same-type shells aloft at once stay far below this; overflow means weapons changed, so really release
const PROJ_POOL_MAX = 24;
// ---- Hot-object pool depths (pure perf insurance, not balance numbers, so they live here not in data.js) ----
// Bullet/tracer/particle sprites allocate per shot/hit/frame, so depth rounds up the on-screen aloft ceiling:
// tracers (light rate 8 plus others/bot volleys), fire/smoke sprites (blast embers plus trails plus crash smoke),
// projectile records (own bullets plus others _visShells plus thrown _decoyBombs share one record kind).
// Over-cap returns drop directly and take the original dispose path (one slow shot, no leak).
const TRACER_POOL_MAX = 48;
const SPRITE_POOL_MAX = 96;
const BULLET_REC_MAX = 64;
const FX_SHELL_MAX = 128;
// Touch-device pixel-ratio cap: phone DPR is often 2.5-3.5, accepting it raw means 6-12x logical-resolution pixels,
// and mobile GPUs are fill-rate bound, so even high-power mode drops frames. 1.5 shows no visible aliasing gap (plus DPR-level AA at FXAA grade).
const TOUCH_DPR_MAX = 1.5;
// Adaptive resolution (all platforms; desktop enabled too since 2026-08-12): _dpr is the quality ceiling
// (low-power 1 / touch 1.5 / desktop 2, audit-locked), and the governor floats only below the ceiling -- it lowers
// render resolution for frame rate when frame time cannot hold, and climbs back to full when headroom returns.
// Phone GPU spread is huge (same scene differs 3x between flagship and mid tier), so a fixed pixel ratio pleases neither end:
// high strands weak devices, low wastes strong displays; letting measured frame time decide serves both speed and quality.
//
// Why desktop too (old regime touched touch-only on purpose, changed 2026-08-12): desktop spread is just as wide -- 4K screens
// hit a _dpr ceiling of 2, meaning 4x logical-resolution pixels per frame, while iGPU vs dGPU differ by an order of magnitude. Old behavior there
// was to just drop frames, with nothing on screen telling players to switch quality; the governor makes that automatic.
// When desktop holds full rate, _resScale parks at 1, so bit-identical to the old regime (the upscale branch
// early-outs at _resScale < 1 without firing a single setPixelRatio).
const RES_GOV = {
  ...DRS,
  MIN: DRS.MIN,        // scale floor (times the _dpr ceiling): blurrier would hurt aim readability, better to drop frames
  STEP: DRS.STEP,      // one base step per adjust (drawing-buffer realloc has cost, walk small with cooldown against oscillation)
  HI_MS: DRS.HI_MS,    // avg frame time above 20ms (below 50fps) means step down
  LO_MS: DRS.LO_MS,    // avg frame time below 17.2ms (60Hz vsync full speed) means headroom, step up
  HOLD_S: DRS.HOLD_S,  // min gap between any two adjusts (also gives the EMA time to reconverge)
  COOL_S: DRS.COOL_S,  // upscale base cooldown (downscale eats only HOLD_S: rescue drops fast, quality returns slowly)
  FAIL_S: DRS.FAIL_S,  // knocked back this soon after upscaling means it cannot hold, so double the upscale cooldown
  COOL_MAX: DRS.COOL_MAX, // upscale cooldown cap (avoids endless oscillation at the capability edge without giving up forever)
  SPIKE_MS: DRS.SPIKE_MS, // single-frame spikes (GC / asset load / tab return) never count, steady state only
  EMA: DRS.EMA,        // exponential moving average weight (about 10 frames time constant)
  // Oscillation cutout: this many direction flips stops the governor permanently at the current step. Exponential backoff stretches how long
  // before the next try, but it cannot save machines whose capability sits between two steps -- those would alternate up/down forever,
  // and every adjust reallocs the drawing buffer (the whole post chain RTs rebuild with it). Better to concede and park on one step.
  // CUTOUT MUST NOT pull _resScale back to 1 on the way out: that throws the player back to the step that cannot hold,
  // and the next round steps down again -- cutout means stay right here.
  FLIP_MAX: DRS.FLIP_MAX,
};

const _GLOBAL_UNIT_DIM_CACHE = new Map();

export class BattleClient {
  /**
   * opts: { canvas, minimapCanvas, cfg, side (may be null = spectate), youId, net, terrain, hud }
   * youId: own connection id; heroes in snapshots carry pid, used to recognize own frame (same faction may hold many players).
   * hud: { self, aiming, bases, wave, feed, dead, over, cooldown, hitmark }
   */
  constructor(opts) {
    Object.assign(this, opts);
    this.center = this.cfg.center;
    this.ents = new Map();
    this._viewOcclusionMeshes = [];
    this._viewOcclusionSet = new Set();
    this._viewOcclusionSkip = new Set();
    this._viewFades = new Map();
    this._viewOcclusionNext = 0;
    this._dissolveGhosts = [];        // render-only ghosts; MUST NOT stay in ents / lock / animation consumers
    this.effects = [];
    this.keys = {};
    this.yaw = 0; this.pitch = -0.1;
    this.bodyYaw = 0;                 // TPS body heading; yaw stays with camera/reticle
    this.vel = new THREE.Vector3();
    this.pos = new THREE.Vector3();
    this.hp = 0; this.maxHp = 1;
    this.dead = false;
    this._deathSeq = null;   // death-transition state machine: null = not played (sentinel); object = playing. Gates read truthiness, teardown writes null
    this.lastPosSend = 0;
    this.mixers = new Set();
    this.spinners = new Set();
    this.hitShells = new Set();      // tower/keep hit-feedback shell (hex shader, flashes on hit; not a shield layer, works have no sp)
    this.disposed = false;
    this._snapQueue = null;
    this._spawnPend = new Map();   // staggered opening modeling: id to latest snapshot raw (first burst of about 200 kinds never builds in one frame)
    // Physics: recoil (view kick), camera shake (trauma), FPV roll
    this.recoil = { p: 0, y: 0 };
    this.trauma = 0;
    this.roll = 0;
    this.weaponKick = 0;
    this._flashHeavy = false;       // whether the last shot was heavy (bigger muzzle flash)
    // Recoil regime (see data.js RECOIL): burst re-settle plus pre-fire steady for high-recoil heavies plus displacement penalty while firing
    this._burstN = {};              // slot to burst count (forced re-settle once profile.burst reached)
    this._settleUntil = {};         // slot to settle-release timestamp (cannot fire while pending)
    this._steadyAt = 0;             // high-recoil heavy: timestamp when steadying started (0 = not steady yet)
    this._recoilMoveF0 = 1;         // move-speed factor for this recoil round (from data.js recoilMoveF; 1 = unaffected)
    // View lock (touch ZR hold; see data.js VIEW_LOCK and _tickViewLock) -- pure client view assist
    this._vlockHold = false;        // whether the button is held (hold-type, same layer as firing)
    this._vlockId = null;           // currently locked ent id (null = no lock; cleared on release)
    this._vlockPrev = null;         // cycle anchor: last locked ent id, kept across releases (see _tickViewLock 3)
    this._vlockNext = false;        // this press has not cycled yet (one press = next target)
    this._vlockAt = 0;              // last seek time (throttle; 0 = research next frame)
    this._vlockUi = false;          // button lit state (body class) right now
    this._scopeFog = 0;             // fire-field fog density 0-1 (scope constriction; same value as hud.envFog)
    this._weatherFogD = 0;          // weather dense-fog density 0-1 (sight scales down plus fog mask; same value as hud.weatherFog)
    this.samMeshes = new Map();      // AA missiles (server-authoritative, snapshot sm sync)
    this._visShells = [];            // others heavy visual shells (2026-07-22 ammo same-source; presentation only)
    this._decoyBombs = [];           // cluster-bomb thrown-body animation (grenade parabola, detonation show only on landing, tinted by type)
    this._initFxPools();             // hot-object pools (tracer/sprite/projectile-record/effect-shell; preallocated, see pool.js)
    this._wdefCache = new Map();     // others weapon-def cache (ch:slot to heroWeapon Lv1)
    this.lootMeshes = new Map();     // battlefield loot (snapshot lt sync)
    this.airdropMeshes = new Map();  // airdrop supply crates (snapshot ad sync)
    this.mineMeshes = new Map();     // mines as small bumps (one-shot field-message sync)
    this.flamers = new Set();        // fire fields (tongue-flicker animation)
    this.damaged = new Set();        // damaged bodies/buildings (smoke/cracks/burning, per-frame animation)
    this.floods = [];                // flooded zones (mech slowdown check)
    this.fires = [];                 // fire fields (dwell view-fog check; damage settles on the server)
    this._fireDwell = 0;             // fire dwell seconds (clears faster after leaving, so vision clears gradually)
    this._swampDwell = 0;            // swamp dwell seconds (sinks deeper over time, movement down to 1/8; zeroed on exit)
    this._env = { code: 0, depth: 0, ground: 0, air: false }; // leader current-frame environment (updated per frame by _envAt; see that function)
    this._mineCheckAt = 0;
    this._floodWarnAt = 0;
    this._slopeWarnAt = 0;           // steep-slope block hint throttle (8s; sliding along contours does not count as a slope hit)
    this.cutin = new CutIn(document.getElementById('cutinLayer'));

    // Body kind binds to character (since 2026-08-02 every character carries its own kind, never by faction); no pick / spectate falls back to faction main
    // (super sides have no SIDES main, so fall back to mech -- the opening snapshot brings the true character back)
    this.heroKind = this.side ? (CHARACTERS[this.ch]?.kind || SIDES[this.side]?.hero || 'robot') : null;
    this.isDrone = this.heroKind === 'drone';
    this.isMorph = this.heroKind === 'morph';   // morph mech (flight and ground dual forms)
    this.flight = false;                        // morph: whether currently in flight form
    this.charge = 0;                            // morph: charged-jump progress 0-1 (hold Space)
    // Flight dynamics (2026-07-30; single seam data.js FLIGHT): climb power bar plus hit-induced altitude loss
    this.lift = null;                           // current climb power (null = refill to unified cap on first frame)
    this._airSink = 0;                          // hit-induced sink: pending meters (digested per frame at _airSinkV)
    this._airSinkV = 0;                         // descent rate for the pending meters (= pending total / FLIGHT.SINK_S)
    this._liftLockUntil = 0;                    // power-recovery lockout deadline after hits (FLIGHT.HIT_LOCK_S)
    this.unbalLeft = 0;                         // hit-imbalance debuff seconds left (server snapshot sync)

    // Character (dedicated body plus light/heavy weapons plus guard/attack abilities); lobby broadcast carries ch, snapshots also sync it
    this.abil = { light: 1, heavy: 1, def: 1, atk: 1 };   // abilities start at Lv1 usable (2026-07-20)
    this.wdef = {};                   // slot to resolved weapon numbers (with hero multipliers and tiers)
    this.wstate = {};                 // slot to { ammo, reloadEnd } (local HUD; server enforces separately)
    this.lastFireAt = { light: 0, heavy: 0 };
    this.bullets = [];                // ballistic shells (muzzle velocity mv plus gravity, capped range)
    this._setChar(this.ch || null);
    this.money = 0;
    this.upg = { lw: 0, hw: 0, def: 0, atk: 0, hp: 0, ar: 0, sp: 0, ch: 0 };   // eight-track upgrades (snapshot o.up writes back)
    this._reserve = new Set();        // shop reservation list (auto-orders once money suffices; pure client schedule, see _tickReserve)
    // Super-battle auto-buy defaults checked: super upgrade reserves itself on entering the battle (players may uncheck, and it never re-adds itself)
    if (isSuperSide(this.side)) this._reserve.add('super');
    this._resSent = {};               // reservation tiers already ordered (item to lvl, t): blocks repeat orders before authority replies
    this.sp = 0; this.maxSp = 1;      // shield (first layer of dual HP, regens out of combat)
    this.mp = 0; this.maxMp = 1;      // power (ability resource)
    this._mpAuth = false;             // whether maxMp has received the server authoritative value (for power; climb power is a fixed cap, never gated here)
    this.kn = 0;                      // combat score (second gate for eight-track upgrades; server-authoritative, only grows)
    this.cds = [0, 0];                // [guard, attack] cooldowns (server counts down)
    this.chg = [[1, 1, 0], [1, 1, 0]]; // [[guard ready, guard cap, next cooldown], [attack ready, attack cap, next cooldown]]
    this.castLeft = 0;                // ability windup seconds left (snapshot sync)
    this._castingUntil = 0;           // local optimistic windup end stamp
    this.empLeft = 0;                 // EMP-paralysis seconds left (weapons/abilities offline)
    this.blindLeft = 0;               // flashbang-blind seconds left (server-authoritative vision state)
    this.stealthLeft = 0;
    this._buffsLeft = [];             // affix buffs [[id, remS], ...] (AFFIXES seconds left; pushed from snapshot bf field)
    // Debuff white flash (presentation only; constants/curves live in data.js CC_FLASH): full white on apply, then fades
    this._ccFlashLeft = 0;            // white-screen seconds left (counts down from ccFlashDur)
    this._ccFlashPeak = 0;            // peak opacity of this flash (= blinding strength of that state)
    // Hit blood splash hint (presentation only; constants/curves live in data.js BLOOD): server hurt events spray by bearing onto the cockpit glass
    this._blood = [];                 // [{ id, u, v, drops, left }] (oldest retires first, capped at BLOOD.MAX)
    this._bloodSeq = 0;               // blood/flash serial (HUD builds/recycles DOM from it, MUST grow monotonically)
    this._bloodOn = false;            // whether blood remained last frame (still push one empty array on the zeroing frame before early-out)
    // Block-spark flash on shield catch (presentation only; constants/curves live in data.js GLINT): blood slots spray sparks when the shield takes the hit
    this._glints = [];                // [{ id, u, v, drops, left }] (same shape as blood, capped at GLINT.MAX)
    this._glintOn = false;            // whether sparks remained last frame (still push one empty array on the zeroing frame before early-out)
    this.shopOpen = false;
    this.paused = false;              // battle menu open (inputs frozen)
    this._everLocked = false;         // pointer lock was once acquired (never-locked sessions never pop the pause menu)
    this._plcSelf = false;            // next pointer-unlock is self-initiated (death transition), so _onPlc skips once
    this._gameOver = false;           // outcome decided (over overlay showing, never pop the pause menu)
    this._crashSent = false;          // crash-detonation dedupe
    this.aiming = false;              // RMB short-press toggles aim (zoom view, switch to heavy); hold = class special
    this._aimViewRestore = null;      // stashes the prior view during scope, restored on exit
    this.defending = false;           // guard stance (spawns low-opacity shield of body size ahead)
    this._lastWheelAimAt = 0;         // wheel scope-toggle debounce stamp
    this._rmbDownAt = 0;              // RMB press time (0 = not pressed); past threshold fires the ability, quick release toggles mode (see _tickHoldAbility / _rmbUp)
    this._rmbAbilityFired = false;    // whether this RMB hold already fired the special (release after firing never toggles mode, so toggle and fire never conflict)

    this.viewMode = viewMode();       // view mode (fpv first-person / tps third-person, single truth in ctrlmode.js)
    this._offView = onViewModeChange((vm) => this._onViewModeChange(vm));

    this._initScene();
    this._initLanes();
    this._initInput();
    this._initMinimap();
    this._buildCockpit();
    if (this.cockpit && this.viewMode === 'tps') this.cockpit.visible = false;

    // Spawn: push from own keep toward the enemy keep by GAME.HERO_SPAWN_OFF (avoids spawning inside the keep model), facing the enemy
    this._spawnAt();
    if (!this.side) {
      const [cx, cz] = llToWorld(this.center.lat, this.center.lng, this.center);
      // Spectate: high overlook. Start height likewise tucks under the game ceiling -- _updateSpectator clamps every frame,
      // so skipping the clamp here only lets the first frame jump (instead of a real bug like a spectate start above the ceiling).
      this.pos.set(cx, Math.min(this.terrain.heightAt(cx, cz) + 400, this._ceilY()), cz);
      this.pitch = -0.9;
      this._specFov = this.camera.fov;   // current view angle for wheel zoom (shared across the four views)
      this._specPid = null;              // followed pid in player view (null = god view)
      this._specHid = null;              // body hidden to avoid looking out of its own nose (only first-person hides)
      this._specView = SPEC_CAM.VIEWS[0];        // current view (single write point = _specSetView)
      this._specAnchor = new THREE.Vector3();    // follow anchor (smoothed target position; keeps 8Hz snapshot jitter out of the camera)
      this._specAnchorOk = false;                // whether the anchor is valid (switching target / first follow snaps instead of panning)
      this._specYaw = 0;                         // smoothed follow yaw (shared by first-person gaze and third-person behind-body bearing)
    }

    this.clock = new THREE.Clock();
    // Opening reveal effect cancelled per requirement (avoids opening blackout / blocked view).
    this._raf = requestAnimationFrame(() => this._loop());
  }

  /** Set / refresh character and resolved weapons (recompute on tier-up; server already reset ammo, so local refills full mag) */
  _setChar(ch, refill = false) {
    if (ch && CHARACTERS[ch]) {
      const changed = ch !== this.ch;
      this.ch = ch;
      // Character arrives late from snapshots (random assignment): body kind and cockpit rebuild with the character
      if (changed && this.side) {
        this.heroKind = CHARACTERS[ch].kind || SIDES[this.side]?.hero || 'robot';
        this.isDrone = this.heroKind === 'drone';
        this.isMorph = this.heroKind === 'morph';
        this.flight = false;
        this.charge = 0;
        this.baseFov = UNITS[this.heroKind].fov;
        if (this.cockpit) {
          this.camera.remove(this.cockpit);
          this._buildCockpit();
          if (this.viewMode === 'tps') this.cockpit.visible = false;
        }
      }
    }
    if (!this.ch || !this.side) return;
    for (const slot of ['light', 'heavy']) {
      const def = heroWeapon(this.ch, slot, this.abil[slot] || 1, true);
      this.wdef[slot] = def;
      if (!this.wstate[slot] || refill) this.wstate[slot] = { ammo: def.mag, reloadEnd: 0 };
    }
  }

  /** Live view-mode switch (fpv first-person vs tps third-person) */
  _onViewModeChange(vm) {
    if (this.aiming && vm === 'tps') {
      this._aimViewRestore ||= 'tps';
      setViewMode('fpv');
      return;
    }
    if (vm === 'tps') this.bodyYaw = this.yaw;
    else this.yaw = this.bodyYaw;
    this.viewMode = vm;
    if (this.cockpit) this.cockpit.visible = (vm === 'fpv');
    if (vm !== 'tps') this._clearViewOcclusion();
    for (const ent of this.ents.values()) {
      if (ent.isSelf) {
        ent.mesh.visible = (vm === 'tps' && !ent.dead);
      }
    }
  }

  // ---------------- Scene ----------------
  _initScene() {
    // antialias (MSAA) is bandwidth cost on mobile GPUs: small tile memory degrades the whole render pass,
    // while phones already supersample at pixel ratio 1.5 or more, so touch devices turn it off -- tiny visual gap, large frame-rate gap.
    // stencil/depth: this project has no stencil-test need, so dropping it saves one tile attachment.
    // Three switches for the post pipeline (V-A fixed-camera set must isolate layer by layer): ?ink=0 / ?grade=0 / ?fxaa=0 each turn off one layer,
    // ?post=0 turns the whole chain off. MUST parse before building the renderer -- the MSAA switch follows it (see next paragraph).
    const q = new URLSearchParams(location.search);
    const off = (k) => q.get(k) === '0';
    // MSAA does nothing for lines drawn by passes (outlines are not geometry edges), so FXAA owns AA once the pipeline is up:
    // desktop saves MSAA resolve bandwidth, touch devices get AA for the first time. Only ?post=0 (legacy direct render)
    // turns MSAA back on, still keeping the old touch-always-off rule.
    this.renderer = new THREE.WebGLRenderer({
      canvas: this.canvas,
      antialias: off('post') && !isTouchUI(),
      stencil: false,
      powerPreference: 'high-performance',
    });
    this.renderer.setPixelRatio(this._dpr());   // low-power mode (svs_lowpower) clamps to 1
    this.renderer.setSize(this.canvas.clientWidth, this.canvas.clientHeight, false);
    // Adaptive-resolution governor: all platforms (2026-08-12; when desktop always holds full rate it never steps, so behavior is unchanged)
    this._resScale = 1;
    this._resGov = { ema: (RES_GOV.HI_MS + RES_GOV.LO_MS) / 2, last: 0, raiseAt: -1e9, cool: RES_GOV.COOL_S, dir: 0, flips: 0, off: false };
    this.scene = new THREE.Scene();
    const span = Math.max(this.terrain.worldW, this.terrain.worldH);
    // FPV is always UNITS kind fov = 68 (same for all bodies since 2026-07-12): same-distance targets must read the same size for both factions,
    // wide angle would shrink NPCs -- body differences show only in cockpit styling and eye position (heroView), never in FOV.
    const fov = this.heroKind ? UNITS[this.heroKind].fov : 68;
    this.baseFov = fov;
    this.camera = new THREE.PerspectiveCamera(fov, this.canvas.clientWidth / this.canvas.clientHeight, 0.5, span * 2);
    this._fpsShieldMesh = this._createFrontShieldMesh(2.2, 2.6, 130 * Math.PI / 180);
    this._fpsShieldMesh.rotation.y = Math.PI;
    this._fpsShieldMesh.position.set(0, -0.2, 0);
    this.camera.add(this._fpsShieldMesh);
    // PiP shares the camera (wingman / decoy view; repositioned and reused every frame)
    this.pipCam = new THREE.PerspectiveCamera(PIP.FOV, 1 / PIP.ASPECT, 0.5, span * 2);

    // Season/day-night/weather (locked at room creation, same for the whole room) plus sun/moon projection for the day-night cycle.
    // Shadow-map toggles live here (renderer is this file), extent and resolution live in data.js SHADOW --
    // environment.js only hangs that light in the right place. ?shadow=0 shares the pass switch group,
    // used when the fixed-camera set shoots before/after comparisons.
    const lowGpu = lowPower() || isTouchUI();
    const shadowOn = visualPref('shadow') === 'on' && !off('shadow');
    this.renderer.shadowMap.enabled = shadowOn;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.shadowMap.autoUpdate = shadowOn;
    this.envFx = applyEnvironment(this.scene, this.terrain, this.cfg.env,
      { shadow: shadowOn, lowPower: lowGpu, surface: (x, z) => this._surf(x, z, Infinity) });
    this._simT = 0;      // server-authoritative elapsed seconds (snapshot time); sole source for the day-night clock

    this.scene.add(this.terrain.group);
    // Terrain body is continuous ground, not a scene object to fade; other visible props never substitute the outline flag for occlusion eligibility.
    const terrainSurface = this.terrain.group.children.find((o) => o.isMesh && o.receiveShadow);
    if (terrainSurface) this._viewOcclusionSkip.add(terrainSurface);
    this._registerViewOccluders(this.terrain.group);

    this._onResize = () => {
      const w = this.canvas.clientWidth, h = this.canvas.clientHeight;
      this.renderer.setSize(w, h, false);
      this.camera.aspect = w / h;
      this.camera.updateProjectionMatrix();
      fitHudBand();
    };
    // MUST go through the onViewportSettled debounce, MUST NOT bind window resize directly:
    // one rotation fires several sizes (iOS especially), and reallocating render targets per event is one hitch plus a chance
    // to park on a wrong middle size (see mobile.js VIEWPORT). _applyRes still calls _onResize directly
    // -- that is a pixel-ratio change not a window change, no burst problem, and should not wait another 50-500ms.
    this._offResize = onViewportSettled(this._onResize);

    // Cel post pipeline (outline, depth of field, grade, TAA, FXAA); switches see off above.
    // Low-power/touch take 8-bit RT (half-float is bandwidth cost on tile GPUs, same bottleneck as disabling MSAA).
    this.pipeline = off('post') ? null : new Pipeline(this.renderer, this.scene, this.camera, {
      ink: !off('ink'), dof: !off('dof'), grade: !off('grade'), taa: !off('taa'), fxaa: !off('fxaa'),
      lowPower: lowPower() || isTouchUI(),
    });
    this.pipeline?.setResScale?.(this._resScale);
    // 景深的兩個轉折點:**一律到 data.js 取**(由全場最遠交戰距離推導),game.js MUST NOT
    // 自己乘 sight / 射程 —— 第二份實作的症狀是「射程調了之後遠景糊的距離沒跟著走」,
    // 而那要等到有人抱怨「打得到卻看不清楚」才會發現。與機種無關(交戰上界是全場的性質:
    // 對面那台帶什麼武器不由你決定)⇒ 換座機不必重設。
    this.pipeline?.setDof(dofNearM(), dofFarM());
    // 空氣透視(雙色霧):顏色與距離**一律取 environment.js 那一份**(它同時寫了 scene.fog)——
    // 這裡自己乘一次 span × W.fogNear 就是第二份實作,而症狀是遠景多一圈色帶(見 postfx AIR)。
    const air = this.envFx?.air;
    if (air) this.pipeline?.setAirFog(air.near, air.far, air.fogNear, air.fogFar);

    this.raycaster = new THREE.Raycaster();
    this._viewRaycaster = new THREE.Raycaster();
    // 障礙碰撞柱空間索引(建物/神木/巨岩/橋墩):彈道/準星射線的遮蔽判定用。
    // 障礙有物理碰撞就不可讓砲火穿越 —— 與 _collide 用同一份 terrain.blockers,牆與彈道一致。
    this._blockGrid = this._buildBlockGrid(this.terrain.blockers || []);
    this.mapBuildings = new Map();
    this._buildingRoofHit = buildingRoofIndex([...(this.terrain.mapBuildings?.values() || [])].flatMap(r=>r.platforms));
    for (const [key, record] of this.terrain.mapBuildings || []) {
      this.mapBuildings.set(key,mapBuildingTarget(record));
    }
    if (this.renderer?.compile) {
      try { this.renderer.compile(this.scene, this.camera); } catch { /* 容錯降級 */ }
    }
  }

  _syncMapBuildings(rows) {
    const initial = !this._mapBuildingsSynced;
    this._mapBuildingsSynced = true;
    let collisionChanged = false;
    for (const [key, hp, max] of rows || []) {
      const ent = this.mapBuildings?.get(key);
      if (!ent || ent.record.cleared || !Number.isFinite(hp) || !(max > 0) || ent.collapsed) continue;
      const stage = sceneDamageStage(hp,max);
      ent.hp = hp; ent.max = max;
      if (stage || hp < max) {
        ent.mesh = detachMapBuilding(ent.record);
        if (!ent.sceneDamageNodes) { ent.sceneStage = undefined; applySceneDamage(ent,0); }
      }
      if (stage === 3) {
        applySceneDamage(ent,3);
        ent.collapsed = true;
        if (ent.bar) { ent.mesh.remove(ent.bar); disposeTree(ent.bar); ent.bar = null; }
        if (ent.dmgFx) { ent.mesh.remove(ent.dmgFx); disposeTree(ent.dmgFx); ent.dmgFx = null; this.damaged.delete(ent); }
        collapseBuildingBoxes(ent.record.boxes, ent.record.bounds.y);
        for (const p of ent.record.platforms) p.y = ent.record.bounds.y + (p.y-ent.record.bounds.y) * MAP_BUILDING.RUBBLE_H;
        const pose = (f) => { ent.mesh.scale.y = 1-(1-MAP_BUILDING.RUBBLE_H)*f; };
        if (initial) pose(1);
        else {
          sceneDamageBurst(this.scene,this.effects,ent,3);
          this.effects.push({ obj: new THREE.Group(), ttl: 0.85, fade: (o,f) => pose(1-f*f), dispose: () => pose(1) });
        }
        collisionChanged = true;
      } else {
        if (!initial && stage > ent.sceneStage) sceneDamageBurst(this.scene,this.effects,ent,stage);
        applySceneDamage(ent,stage);
        this._updateSceneHpBar(ent);
        this._updateDamageStage(ent);
      }
    }
    if (collisionChanged) {
      this._cullOccDirty = true;
      this._blockGrid = this._buildBlockGrid(this.terrain.blockers || []);
      this.terrain.rebuildBlockerTops?.();
      const climbs = this.terrain.climbs;
      if (climbs) for (let i=climbs.length-1; i>=0; i--) {
        if ((climbs[i].b?.buildingKey && !climbs[i].b.cl) || (climbs[i].link?.buildingKey && !climbs[i].link.cl)) climbs.splice(i,1);
      }
      this.terrain.rebuildClimbs?.();
    }
  }

  /**
   * 障礙體 → 64m 均勻網格(彈道線段只掃沿途格)。
   * 登記半徑 MUST 用**外接**(建物取盒對角 hypot(hw2,hd2),非 0.8×半對角的內切近似)——
   * 內切半徑會讓貼牆角的格子漏登記,盒判定再準也掃不到那顆(見 _cameraDeClip 同一條前科)。
   */
  _buildBlockGrid(blockers) {
    const C = 64;
    const grid = new Map();
    blockers.forEach((b) => {
      // 有向盒的 local 軸餘弦收料時算好:_blockerHitT 是交火期逐發逐盒的熱路徑,
      // 逐盒重算三角函數等於白燒幀預算(格鍵亦改整數,見下 —— 逐格配字串鍵同屬 per-call 配置)。
      if (b.hw2 != null) { b._cs = Math.cos(b.ry); b._sn = -Math.sin(b.ry); }
      const r = b.hw2 != null ? Math.hypot(b.hw2, b.hd2) : b.r;
      const i0 = Math.floor((b.x - r) / C), i1 = Math.floor((b.x + r) / C);
      const j0 = Math.floor((b.z - r) / C), j1 = Math.floor((b.z + r) / C);
      for (let i = i0; i <= i1; i++) {
        for (let j = j0; j <= j1; j++) {
          const k = (i + 32768) * 65536 + (j + 32768);
          let a = grid.get(k);
          if (!a) grid.set(k, a = []);
          a.push(b);
        }
      }
    });
    return { C, grid };
  }

  /**
   * 查詢座標 (x, z) 半徑 r 範圍內可能相交的障礙碰撞體(由 64m 空間網格快篩)。
   * 若空間網格未就位則退回全場 blockers。
   */
  _blockersNear(x, z, r) {
    if (!this._blockGrid) return this.terrain?.blockers || [];
    const { C, grid } = this._blockGrid;
    const i0 = Math.floor((x - r) / C), i1 = Math.floor((x + r) / C);
    const j0 = Math.floor((z - r) / C), j1 = Math.floor((z + r) / C);
    if (i0 === i1 && j0 === j1) {
      return grid.get((i0 + 32768) * 65536 + (j0 + 32768)) || [];
    }
    const out = [];
    const seen = this._blockerNearSet || (this._blockerNearSet = new Set());
    seen.clear();
    for (let i = i0; i <= i1; i++) {
      for (let j = j0; j <= j1; j++) {
        const list = grid.get((i + 32768) * 65536 + (j + 32768));
        if (!list) continue;
        for (let k = 0; k < list.length; k++) {
          const b = list[k];
          if (!seen.has(b)) {
            seen.add(b);
            out.push(b);
          }
        }
      }
    }
    return out;
  }

  /**
   * 線段 vs 障礙體(建物/神木/巨岩/橋墩):回傳最近命中距離(沿線段),沒打到回 null。
   * 橫斷面 = _collide 同一份碰撞體:**建物走有向盒**(hw2/hd2/ry)、其餘走圓柱(r);
   * 側面進入 / 打頂面 / 打底面**皆算,且不分上下方向**。有物理障礙的物件不可讓砲火穿越;
   * 植被(無碰撞)照舊不擋彈。
   *
   * **2026-07-28「所有方向皆可抵擋射擊」**:舊制建物一律以 r = 0.8×半對角 的圓柱近似,兩頭都不對 ——
   * ①牆角外露在圓外 ⇒ 對角線方向的砲火穿過**看得見的牆**;②細長樓的圓比盒寬 ⇒ 側面十幾公尺外的
   * 空氣擋彈。改吃 `_collide`/`_cameraDeClip` 已在用的有向盒 ⇒ 撞得到 = 打得到 = 看得到,三者同一把尺。
   * 圓仍是 broad-phase(盒的 r MUST 是**外接**半對角,見 main.js occ 上傳處的同一條註)。
   */
  _blockerHitT(ax, ay, az, bx, by, bz) {
    this._hitBuildingKey = null;
    if (!this._blockGrid) return null;
    const { C, grid } = this._blockGrid;
    const i0 = Math.floor(Math.min(ax, bx) / C), i1 = Math.floor(Math.max(ax, bx) / C);
    const j0 = Math.floor(Math.min(az, bz) / C), j1 = Math.floor(Math.max(az, bz) / C);
    const dx = bx - ax, dy = by - ay, dz = bz - az;
    const len = Math.hypot(dx, dy, dz) || 1;
    let bestT = null;
    const seen = this._blockerHitSet || (this._blockerHitSet = new Set());
    seen.clear();
    const lenXZ2 = dx * dx + dz * dz;
    const maxCellDistSq = (C * 0.85) * (C * 0.85);
    for (let i = i0; i <= i1; i++) {
      for (let j = j0; j <= j1; j++) {
        if (lenXZ2 > 1e-6 && (i0 !== i1 || j0 !== j1)) {
          const cx = (i + 0.5) * C, cz = (j + 0.5) * C;
          const tProj = Math.max(0, Math.min(1, ((cx - ax) * dx + (cz - az) * dz) / lenXZ2));
          const nx = ax + tProj * dx - cx, nz = az + tProj * dz - cz;
          if (nx * nx + nz * nz > maxCellDistSq) continue;
        }
        const a = grid.get((i + 32768) * 65536 + (j + 32768));
        if (!a) continue;
        for (const b of a) {
          if (seen.has(b)) continue;
          seen.add(b);
          const A2 = dx * dx + dz * dz;
          let t0, t1;
          if (b.hw2 != null) {
            // 有向盒:射線在盒 local frame 走 slab(與 _cameraDeClip clampBox / _sweepBlockers 同式)
            const cs = b._cs ?? Math.cos(b.ry), sn = b._sn ?? -Math.sin(b.ry);   // 有向盒 local 軸:three Euler(0,ry,0) 的反解(sn 取 −sin);收料預算見 _buildBlockGrid
            const ox = ax - b.x, oz = az - b.z;
            const olx = ox * cs + oz * sn, olz = -ox * sn + oz * cs;
            if (A2 < 1e-8) {                        // 垂直線段:XZ 不動,只看是否在盒內
              if (Math.abs(olx) > b.hw2 || Math.abs(olz) > b.hd2) continue;
              t0 = 0; t1 = 1;
            } else {
              const ulx = dx * cs + dz * sn, ulz = -dx * sn + dz * cs;
              // 逐軸 slab,手動展開(熱路徑不配置暫存陣列;與伺服器 _losBlocked 同一條紀律)
              let tmin = -Infinity, tmax = Infinity, ok = true;
              if (Math.abs(ulx) < 1e-9) { if (olx < -b.hw2 || olx > b.hw2) ok = false; }
              else {
                let s0 = (-b.hw2 - olx) / ulx, s1 = (b.hw2 - olx) / ulx;
                if (s0 > s1) { const s = s0; s0 = s1; s1 = s; }
                if (s0 > tmin) tmin = s0;
                if (s1 < tmax) tmax = s1;
              }
              if (ok) {
                if (Math.abs(ulz) < 1e-9) { if (olz < -b.hd2 || olz > b.hd2) ok = false; }
                else {
                  let s0 = (-b.hd2 - olz) / ulz, s1 = (b.hd2 - olz) / ulz;
                  if (s0 > s1) { const s = s0; s0 = s1; s1 = s; }
                  if (s0 > tmin) tmin = s0;
                  if (s1 < tmax) tmax = s1;
                }
              }
              if (!ok || tmax < tmin || tmax < 0 || tmin > 1) continue;
              t0 = tmin; t1 = tmax;
            }
          } else {
            // 2D 射線 × 圓:|A + t·D − O|² = r²
            const ox = ax - b.x, oz = az - b.z;
            const B2 = 2 * (ox * dx + oz * dz);
            const C2 = ox * ox + oz * oz - b.r * b.r;
            if (A2 < 1e-8) {                        // 垂直線段:XZ 不動,只看是否在圓內
              if (C2 > 0) continue;
              t0 = 0; t1 = 1;
            } else {
              const disc = B2 * B2 - 4 * A2 * C2;
              if (disc < 0) continue;
              const sq = Math.sqrt(disc);
              t0 = (-B2 - sq) / (2 * A2);
              t1 = (-B2 + sq) / (2 * A2);
              if (t1 < 0 || t0 > 1) continue;
            }
          }
          // 垂直帶 [b.y − 0.5, b.y + b.h] ∩ 水平區間 [t0,t1] —— **方向無關**的一條式子:
          // 側面進入 / 自上而下打頂面 / 自下而上打底面(路塹・地下道裡朝地面開火)同判。
          // 舊制只驗「入點高度」+ 頂面加掛 `dy < 0`,由下往上穿過樓體的射線整條漏放;而伺服器
          // `_losBlocked` 一向是「穿越區間 ∩ [0,h]」語意(min(y0,y1) < h)⇒ 客戶端算命中、
          // 伺服器算被擋 = 傷害靜默蒸發(A30 兩端 MUST 同橫斷面)。
          let tA = t0 < 0 ? 0 : t0, tB = t1 > 1 ? 1 : t1;
          if (tB < tA) continue;
          const yLo = b.y - 0.5, yHi = b.y + b.h;
          if (dy > 1e-6 || dy < -1e-6) {
            let s0 = (yLo - ay) / dy, s1 = (yHi - ay) / dy;
            if (s0 > s1) { const s = s0; s0 = s1; s1 = s; }
            if (s0 > tA) tA = s0;
            if (s1 < tB) tB = s1;
          } else if (ay <= yLo || ay >= yHi) continue;   // 水平線段整條在柱身之上/之下
          if (tB < tA) continue;
          if (bestT === null || tA < bestT) { bestT = tA; this._hitBuildingKey = b.buildingKey || null; }
        }
      }
    }
    return bestT === null ? null : bestT * len;
  }

  /**
   * 線段 vs 水平薄板(橋面 / 隧道天花 / 隧道路面):回傳最近穿越距離(沿線段),沒穿回 null。
   * 橋墩等垂直障礙走 _blockerHitT(圓柱);這裡補「橋面/天花」這種水平薄板 —— 只走 surfaceAt/
   * ceilingAt 管移動碰撞、原本不擋彈道/LOS 的缺口(#1)。沿射線 ~SLAB_STEP 取樣查 deckY/tunnelAt
   * (絕對世界 y):橋面板體 = [deckY − deckUnder, deckY]、隧道頂板板體 = [tn.ceil, tn.roof](兩者
   * 同語意,此步 y 區間與板體重疊 = 穿越),隧道路面 = 零厚度塗層(跨越 fy 即穿越)。沿橋面/頂板
   * 走(全程高於頂面)/ 橋下・洞內走(全程低於底緣)不擋,唯穿越才擋。
   * 伺服器以 lev bit + ribbon 權威複驗(_losBlocked);此處是客戶端彈道本體。
   */
  _slabHitT(ax, ay, az, bx, by, bz) {
    const t = this.terrain;
    const hasDecks = !!t?.deckY && t.deckY.hasItems !== false;
    const hasTunnels = !!t?.tunnelAt && t.tunnelAt.hasItems !== false;
    if (!hasDecks && !hasTunnels) return null;
    const dx = bx - ax, dy = by - ay, dz = bz - az;
    const len = Math.hypot(dx, dy, dz);
    if (len < 1e-3) return null;
    const n = Math.min(240, Math.max(1, Math.ceil(len / 2)));   // ~2m 取樣、上限 240(≈480m)
    const du = t.deckUnder || 1.2;
    let py = ay;
    for (let s = 1; s <= n; s++) {
      const f = s / n;
      const x = ax + dx * f, y = ay + dy * f, z = az + dz * f;
      const yLo = Math.min(py, y), yHi = Math.max(py, y);
      if (hasDecks) {
        const d = t.deckY(x, z, 0, yLo, yHi + du);
        if (d != null && yLo <= d && yHi >= d - du) return (s - 0.5) / n * len;
      }
      if (hasTunnels) {
        const tn = t.tunnelAt(x, z);
        // open 段(地下道引道露天路塹)頭上是天空、腳下就是地形本體 —— MUST NOT 當隱形天花
        // 或隱形路面擋彈道(A29)。天花與**路面**都是雙面塗層,同一條判定即涵蓋
        // 洞內往上打天花 / 洞內往下打路面 / 洞外往下打進洞裡。路面漏判的代價:洞內朝地面
        // 開火的彈頭穿過馬路鑽進岩盤(地形射線在山體內側找不到交點),一路飛到山腹另一側才炸。
        // 天花是**有厚度的頂板**(底面 tn.ceil、頂面 tn.roof = 站得上去的那一面;2026-08-03
        // 使用者定案「跟橋面一樣…不可穿越或穿透攻擊」)⇒ 與橋面板體 [deckY − deckUnder, deckY]
        // 同語意,此步的 y 區間與板體**重疊**即算穿越。只驗「跨過底面」會漏掉貼著頂板削過去
        // 的擦邊彈 —— 站在明隧道頂板上朝洞口方向低伸射擊那一發正好是它,而那恰恰是本次要
        // 擋掉的「從上面穿透攻擊」。路面那一項維持跨越語意(零厚度)。
        if (tn && !tn.open
            && ((yLo <= tn.roof && yHi >= tn.ceil)
                || (yHi !== yLo && (py - tn.floor) * (y - tn.floor) <= 0))) {
          return (s - 0.5) / n * len;
        }
      }
      py = y;
    }
    return null;
  }

  /** 彈道遮擋合併:垂直圓柱(_blockerHitT)∪ 水平薄板(_slabHitT),回較近命中距;皆無回 null。 */
  _obstHitT(ax, ay, az, bx, by, bz) {
    const a = this._blockerHitT(ax, ay, az, bx, by, bz);
    const b = this._slabHitT(ax, ay, az, bx, by, bz);
    if (b != null && (a == null || b < a)) this._hitBuildingKey = null;
    const nearest = a == null ? b : b == null ? a : Math.min(a,b);
    const roof = this._buildingRoofHit?.(ax,ay,az,bx,by,bz);
    const roofDistance = roof ? roof.f*Math.hypot(bx-ax,by-ay,bz-az) : Infinity;
    if (roof && (nearest == null || roofDistance < nearest)) { this._hitBuildingKey = roof.key; return roofDistance; }
    return nearest;
  }

  /**
   * 線段版地形射線:兩點 → 最近命中距離(公尺)或 null。內部走 `_terrainHitT`(rayTerrain
   * 唯一縫),只多做「方向正規化 + far = 段長」。
   * 高度場是**雙面**塗層:由上往下、由下往上穿過同一片三角形都要擋;被 `punchPortalHoles`
   * 打掉的三角形(洞口 = 看得穿的地方)兩個方向一律放行(透明可穿透處例外)。
   * **MUST NOT** 退回 `p.y <= heightAt(p.x, p.z)` 的單面判定 —— 那問的是「在地表以下」而不是
   * 「穿過地表」:①由下往上的射線整條漏放;②heightAt 不吃打洞,覆蓋段的山體高度原封不動
   * ⇒ 洞口/洞內成了看得見卻打不穿的隱形山體(在隧道裡開火 = 彈體在槍口原地就炸)。
   */
  _terrainSegT(ax, ay, az, bx, by, bz) {
    const dx = bx - ax, dy = by - ay, dz = bz - az;
    const len = Math.hypot(dx, dy, dz);
    if (len < 1e-4) return null;
    // 熱路徑(_arcTrace 每幀最多 264 步 × 逐級降裝藥)MUST NOT 逐次配置暫存物件
    const o = this._segRo || (this._segRo = { x: 0, y: 0, z: 0 });
    const d = this._segRd || (this._segRd = { x: 0, y: 0, z: 0 });
    o.x = ax; o.y = ay; o.z = az;
    d.x = dx / len; d.y = dy / len; d.z = dz / len;
    return this._terrainHitT(o, d, len);
  }

  /** 塗層總截斷:地形高度場(_terrainSegT)∪ 障礙圓柱/盒 ∪ 水平薄板(_obstHitT)。皆無回 null。 */
  _layerHitT(ax, ay, az, bx, by, bz) {
    const a = this._terrainSegT(ax, ay, az, bx, by, bz);
    const b = this._obstHitT(ax, ay, az, bx, by, bz);
    return a == null ? b : b == null ? a : Math.min(a, b);
  }

  /**
   * 站得住的表面高度 = 地形 ∪ 高架橋面(main.js 掛上的 terrain.surfaceAt)。
   * curY = 該物體目前的高度:高過橋面一個台階內 → 站在橋上;更低 → 從橋下經過踩地形。
   * 玩家物理、位置回報、NPC/敵機貼地渲染全走這一個縫。
   */
  _surf(x, z, curY) {
    return this.terrain.surfaceAt ? this.terrain.surfaceAt(x, z, curY) : this.terrain.heightAt(x, z);
  }

  /**
   * 飛行體(NPC 直升機 / 餌機 / 護衛自殺機 / 極音速飛彈)的高度基準面 —— **(x, z) 的純函式**。
   *
   * 為什麼不能沿用 `_surf` 的逐幀棘輪(2026-08-04 使用者回報「NPC 飛行單位在橋上會越飛越低」):
   * `surfaceAt(x, z, curY)` 是為**地面**單位設計的「我現在在橋上還是橋下」消歧規則,curY 由
   * 上一幀的高度回填 ⇒ 它是**單向棘輪**。飛行體的 curY 種子 = `cur.y − heroY`,一旦某一幀掉回
   * 橋下的河床(兵線擁擠時 sim `_advance` 的側推會把直升機推出橋面足跡 ⇒ `deckY` 回 null),
   * 上橋的兩個條件就再也不成立(距橋面 > `DECK_STEP`、橋腹淨空又 ≥ 最大機體)⇒ 基準面**永久**
   * 停在河床:直升機從此貼著谷底飛、穿過橋面板 = 使用者看到的「越飛越低」+ 破圖。同一個棘輪在
   * 隧道段更糟(`curY < ceil` ⇒ 回傳洞內路面,直升機一頭鑽進山肚子裡)。
   *
   * 飛行體根本不需要那條消歧規則:它本來就在所有結構之上飛。基準面 = **地表 ∪ 橋面 ∪ 隧道頂板**
   * 取最高者,對每個座標只有一個答案 ⇒ 沒有路徑相依、沒有回不去的狀態。
   * 大型障礙頂(`blockerTopAt` 的建物/神木/巨岩/地標)**刻意不收**:那是點狀物件不是連續結構面,
   * 收了會讓直升機經過路邊電塔時整台彈到 35m 再落回來;兵線走廊本就淨空,漏收無代價。
   */
  _flySurf(x, z) {
    const t = this.terrain;
    let s = t.heightAt(x, z);
    const d = t.deckY?.(x, z, t.deckMargin || 0);   // 橋面(側向容差與站立查詢同一份)
    if (d != null && d > s) s = d;
    const tn = t.tunnelAt?.(x, z);                  // 明隧道頂板露在地形之外(深埋段恆低於地表 ⇒ no-op)
    if (tn && !tn.open && tn.roof > s) s = tn.roof;
    return s;
  }

  // Roadside guidance consumes the same profile as NPC standing and the minimap.
  _initLanes() {
    this.lanePts = this.cfg.lanes.map(lane => lane.map(([lat, lng]) => {
      const [x, z] = llToWorld(lat, lng, this.center);
      return new THREE.Vector3(x, this.terrain.heightAt(x, z) + 2, z);
    }));
    this._buildLaneSurf();
    const baseSites = Object.entries(this.cfg.bases || {}).map(([side, point]) => ({
      point: llToWorld(point[0], point[1], this.center), radius: baseCollideR(side),
    }));
    const plan = planLaneGuidance(this._laneSurf, {
      laneIds: this.cfg.laneIds,
      roadRuns: this.terrain.roadRuns,
      surfaceAt: (x, z, y) => this._surf(x, z, y),
      ceilingAt: (x, z, y) => this.terrain.ceilingAt?.(x, z, y),
      contains: (x, z, r) => x - r > this.terrain.minX && x + r < this.terrain.maxX
        && z - r > this.terrain.minZ && z + r < this.terrain.maxZ
        && baseSites.every(b => Math.hypot(x - b.point[0], z - b.point[1]) > b.radius + r),
    });
    const accepted = this.terrain.setLaneSigns?.(laneGuidePlates(plan)) || [];
    plan.signs = plan.signs.filter((p, i) => accepted.includes(i));
    this.laneGuidance = buildLaneGuidance(plan);
    this.scene.add(this.laneGuidance);
  }


  /**
   * 兵線貼地剖面場(唯一縫,取代 NPC 站位的逐幀棘輪):對每條兵線「從線頭沿線行進式取樣」——
   * 帶「上一步表面高 + 1.2」問 surfaceAt ⇒ 上橋段落在橋面、穿隧道段落在隧道路面、其餘地面。
   * 靜態地形/橋/隧建圖後不再變 ⇒ 這份剖面算一次存進空間網格,供兩處共用:
   *   ① _updateEnts 兵線小兵/敵機貼地:以最近取樣高當 surfaceAt 的 curY 種子 —— 不再吃
   *      迷霧刪重建(裸地形重播種,curY 落地形上方山體)/重生瞬移/插值橫移汙染的 cur.y,
   *      故隧道小兵不再彈上山頂(天花)、陸橋小兵不再掉到橋下(使用者回報症狀的根因)。
   *   ② _gradeLanes 小地圖分級(同一份取樣;MUST NOT 再 march 一次,否則兩份剖面分家)。
   * 兵線中段互距 MUST ≥ MAPGEO.LANE_MIN_SEP_M(40)且不交叉(audit_lane_sep 稽核)⇒ 半徑 R
   * 內取「最近」取樣必屬小兵自己那條線,不會誤吸鄰線;查無取樣(離線 > R,如繞塔遠側)則回
   * null → 退回原逐幀棘輪(空曠地無立體歧義,棘輪本就安全)。
   */
  _buildLaneSurf() {
    const SEG = 4, R = 20, CELL = 20;   // 取樣間距 / 查詢半徑(< LANE_MIN_SEP 40 ⇒ 取最近仍屬本線)
    const grid = new Map();
    const surf = [];
    for (const raw of this.lanePts) {
      const pts = raw.map((p) => [p.x, p.z]);
      if (pts.length < 2) { surf.push(null); continue; }
      const cum = [0];
      for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]));
      const total = cum[cum.length - 1];
      const at = (s) => {
        let i = 1;
        while (i < pts.length - 1 && cum[i] < s) i++;
        const f = (s - cum[i - 1]) / ((cum[i] - cum[i - 1]) || 1);
        return [pts[i - 1][0] + (pts[i][0] - pts[i - 1][0]) * f, pts[i - 1][1] + (pts[i][1] - pts[i - 1][1]) * f];
      };
      const samples = [];
      let py = this.terrain.heightAt(pts[0][0], pts[0][1]);
      for (let s = 0; s <= total; s += SEG) {
        const [sx, sz] = at(Math.min(s, total));
        py = this._surf(sx, sz, py + 1.2);
        const smp = { x: sx, z: sz, y: py };
        samples.push(smp);
        const gk = `${Math.floor(sx / CELL)},${Math.floor(sz / CELL)}`;
        let arr = grid.get(gk);
        if (!arr) { arr = []; grid.set(gk, arr); }
        arr.push(smp);
      }
      surf.push({ samples });
    }
    this._laneSurf = surf;
    const R2 = R * R;
    // (x, z) → 最近兵線取樣的表面高;離所有兵線 > R 回 null(呼叫端退回逐幀棘輪)
    this._laneSurfAt = (x, z) => {
      const i0 = Math.floor((x - R) / CELL), i1 = Math.floor((x + R) / CELL);
      const j0 = Math.floor((z - R) / CELL), j1 = Math.floor((z + R) / CELL);
      let best = null, bd = R2;
      for (let i = i0; i <= i1; i++) for (let j = j0; j <= j1; j++) {
        const arr = grid.get(`${i},${j}`);
        if (!arr) continue;
        for (const s of arr) {
          const dd = (s.x - x) * (s.x - x) + (s.z - z) * (s.z - z);
          if (dd < bd) { bd = dd; best = s.y; }
        }
      }
      return best;
    };
  }


  // ---------------- FPV 座艙(武器/彈藥與 HUD,3D 賽璐璐)----------------
  // 2026-08-22 使用者定案:「第一人稱的駕駛艙除了武器/彈藥與HUD之外,其餘機體自身的物件從駕駛艙畫面移除」
  // 武裝走 `_mountCockpitWeapon`(複製 rig.wpn 子樹),變形者兩型態各取自己那一棵。
  // 機體自身結構件不再加進駕駛艙,保持畫面清爽只見武器、開火回饋與 HUD。
  // 取景一律按 fov 68(全機種統一,z=-0.8 處畫面邊緣 y≈±0.54):周邊件貼邊、不擋準星。
  _buildCockpit() {
    if (!this.side) return;
    this.scene.add(this.camera);   // 相機要在場景樹裡,座艙子物件才會渲染
    const c = this.ch && CHARACTERS[this.ch];
    const vis = c?.visual || {};
    // 座艙塗裝 = 機體塗裝(唯一的縫仍是 paint.js):色版 heroPalette + 花紋 paintUnit,
    // tone 與 models.js 同一條規則(無人機/變形者/四足獸 = dark,人形機甲/雙足獸 = light)。
    const tone = (this.isDrone || this.isMorph || vis.form === 'beast') ? 'dark' : 'light';
    const PAL = heroPalette(vis, this.side, tone);
    // builder 內的結構灰階常數在此映射成角色色版階梯 —— 機體是什麼顏色,座艙就是什麼顏色。
    // 非裝甲件(牙/喙/亮金屬/膜翼/發光識別燈)不在表內 → 保留原色。
    const ARMOR = {
      0x4b545e: 'main', 0x5b6772: 'lite', 0x5a6673: 'lite', 0x515e6b: 'lite',
      0x46505b: 'mid', 0x4d5865: 'mid', 0x4a5560: 'mid',
      0x3f4852: 'dark', 0x39424b: 'dark', 0x39414a: 'dark',
      0x3d454e: 'deep', 0x3c444d: 'deep', 0x30373f: 'deep', 0x2b3239: 'deep',
      0x2f353c: 'deep', 0x272c31: 'deep',
    };
    const mk = (geo, color, opts = {}) => {
      // 座艙同樣走賽璐璐;高金屬度 → 漫畫硬邊高光帶
      const { metalness, roughness, noPaint, ...rest } = opts;
      const col = ARMOR[color] ? PAL[ARMOR[color]] : color;
      const m = new THREE.Mesh(geo, toonMat(col, { ...rest, celMetal: (metalness ?? 0) >= 0.5 }));
      if (noPaint) m.userData.noPaint = true;   // 牙/眼/羽:花紋不吃掉辨識訊號
      return m;
    };
    const accent = PAL.accent;
    const g = new THREE.Group();
    this.cockpitSpin = [];    // 自轉件(繞樞軸 y 自轉;來源 = 第三人稱 userData.spin)
    this.cockpitFlap = [];    // 撲翼/觸手:每幀 rot[ax] = base + amp·sin(2π·hz·t + ph)
    this.cockGround = null;   // 變形者:地面型態組件
    this.cockAir = null;      // 變形者:飛行型態組件
    this._cockT = 0;
    this.gunGroup = new THREE.Group();

    // 人類駕駛艙罩:全機種共通(座艙裡坐的是人),機體自身結構一律在艙框之外
    this._cockCanopy(g, mk, accent);

    // 武裝(2026-07-22 同源改制):FPV 武器 = 複製第三人稱機體的武裝子樹(models.js rig.wpn 登記),
    // 輕/重兩把與第三人稱一樣「同時可見」;瞄準只切換作用中的槍口(_syncCockpitWeapon)。
    // 缺登記(GLB 覆蓋等)退回 podWeapon 依 def.type 重建 —— 同一條外觀語彙,不再有通用機槍。
    // 拋棄式參照機體:只取 rig(從未 render = 無 GPU 資源,交給 GC;複本共享其幾何/材質故 MUST NOT dispose)
    const unit3p = makeUnit(`hero:${this.heroKind}`, this.side, { ch: this.ch }).group;
    unit3p.updateMatrixWorld(true);
    const rig3p = unit3p.userData.rig || {};
    const wpn = rig3p.wpn || {};
    // 機體剪影(2026-08-15 使用者「駕駛艙畫面基於新版機體更新設計」):與武裝同源 ——
    // 兩者都是**這台新版機體自己的零件**,差別只在武裝另有四條取景規則(_mountCockpitWeapon)。
    const spin3p = unit3p.userData.spin || [];
    const mp = unit3p.userData.morph;
    if (this.isMorph) {
      this.cockGround = new THREE.Group();
      this.cockAir = new THREE.Group();
      g.add(this.cockGround, this.cockAir);
      this.cockAir.visible = false;
    }
    this._muzzles = { G: {}, A: {} };
    this._mountAudit = {};
    // 輕重同一具(同型雙模:hound/centaur/seraph/cthulhu/panther/raptor/同型機腹莢…)= 只建一次,兩槍口同複本
    const sameRoot = wpn.light?.nodes?.[0] && wpn.light.nodes[0] === wpn.heavy?.nodes?.[0];
    const jobs = sameRoot ? [['light', 'heavy']] : [['light'], ['heavy']];
    if (this.isMorph) {
      // 變形者:兩型態各一套武裝(地面手持/嘴砲 ↔ 飛行機翼硬點/機身吊艙),隨變形整組切換
      this._gunG = new THREE.Group();
      this._gunA = new THREE.Group();
      this.gunGroup.add(this._gunG, this._gunA);
      // 2026-08-14 新版建模:變形者的兩個型態是**兩棵樹兩份 rig**(models.forgeMorphUnit)——
      // 飛行武裝 MUST 取飛行那一份(`rigAir`),取地面型的會把手持槍複製到機翼硬點上。
      const rigA = unit3p.userData.rigAir || rig3p;
      const wpnA = rigA.wpn || wpn;
      for (const slots of jobs) {
        Object.assign(this._muzzles.G, this._mountCockpitWeapon(mk, accent, PAL, vis, slots, wpn, rig3p, this._gunG, null, false));
        Object.assign(this._muzzles.A, this._mountCockpitWeapon(mk, accent, PAL, vis, slots, wpnA, rigA, this._gunA, null, true));
      }
      this._gunA.visible = false;
    } else {
      for (const slots of jobs) {
        Object.assign(this._muzzles.G, this._mountCockpitWeapon(mk, accent, PAL, vis, slots, wpn, rig3p, this.gunGroup, null, this.isDrone));
      }
    }
    this._muzzle = this._muzzles.G.light || this._muzzles.G.heavy;

    // 槍口焰(開火瞬間顯示):與第三人稱焰球同語彙(加法混色暖白,attachMuzzleFlames 的 FPV 對應物);
    // 位置隨作用中槍口走(_syncCockpitWeapon)。
    // ⚠ **取景七條規則的具名例外**(2026-08-15):它是**開火回饋**不是機體零件 —— 加法混色、
    // 不描邊、不寫深度、只亮 `_flashTtl` 那零點幾秒,而且它的位置就是槍口的定義(挪開它 =
    // 說謊)。實測滿尺寸(重武器 ×2.3)時 32 台裡有 25 台會掃到中央格 0.15~0.57%、
    // 自身佔畫面 2.1~6.0%。**要不要把它也收進規則裡是使用者的決定**,MUST NOT 自行夾制:
    // 夾了就是「開了槍卻看不出來」,而狙擊模式裡它是唯一剩下的回饋(見 _syncCockpitWeapon)。
    this.flash = new THREE.Mesh(
      new THREE.SphereGeometry(0.09, 8, 6),
      new THREE.MeshBasicMaterial({
        color: 0xffe9b0, transparent: true, opacity: 0.9,
        blending: THREE.AdditiveBlending, depthWrite: false,
      }),
    );
    this.flash.userData.noOutline = true;
    this.flash.userData.noPaint = true;
    this.flash.position.copy(this._muzzle);
    this.flash.visible = false;
    this.gunGroup.add(this.flash);
    this._gunBaseZ = this.gunGroup.position.z;

    g.add(this.gunGroup);
    g.userData.mount = `${this._mountAudit.light || '?'}/${this._mountAudit.heavy || '?'}`;   // 稽核用:輕/重武器掛點
    paintUnit(g, vis, this.side, tone);   // 性格花紋:與機體同一份程序貼圖(MUST 在 outlinify 之前)
    outlinify(g, 0.012);                  // 座艙近距離,細描邊即可(≈2px)
    // 取景夾制 MUST 在 outlinify **之後**:描邊殼掛在各 mesh 底下會外擴頂緣 ≈0.012m,
    // 夾制的包圍盒要含殼才量得準(否則頂緣夾在 −0.187 但描邊把它頂回 −0.14)。件平移/縮放時描邊子件同動。
    this._frameCockpitStruct(g);
    this._solveGunPose();                 // 武裝動畫(後座/填彈/超高仰角)的包絡上限,見該支檔頭
    // FPV 座艙 MUST NOT 投影(2026-08-14):它掛在**相機底下**,武裝是從第三人稱機體
    // `makeUnit` 複製過來的子樹 ⇒ 那一份的 `castShadow` 也跟著複製過來,而它離鏡頭一公尺、
    // 離地兩公尺,在陰影圖裡就是一大塊糊在正前方地面上的黑影(2026-08-14 實測 taroko dusk:
    // 近景整片暗掉,而畫面上讀起來像「這一版的地面變髒了」)。座艙是視角模型不是世界物件。
    // 收影子照留:它站在世界的光裡,被建物擋到本來就該暗下來。
    g.traverse((o) => { if (o.isMesh) o.castShadow = false; });
    this.cockpit = g;
    this.camera.add(g);
  }

  /**
   * 座艙**結構件**取景夾制(2026-07-24 使用者三條追加規則;武器本體由 _mountCockpitWeapon 自帶求解器):
   *  ② 每個結構件頂緣 MUST ≤ TOP_NDC(HUD→準星 2/3 處)—— 高過就整件下移。
   *  ③ 與武器/招式無關的裝置每件面積 MUST ≤ 該座艙最大單一武器件 —— 超過就等比縮小;
   *     持械機構夾在 `PART_AREA_MAX`(使用者的 5% 硬天花板),武器本體由 framed 自帶求解器夾。
   *  ① 下移後不得落進準星錐 —— 沿離軸方向(置中件則直接下沉)推到錐外。
   * 只處理「非武器」頂層件(cockpit.children 去掉 gunGroup;morph 另含 cockGround/cockAir 子件);
   * 武器本體在 gunGroup 內、由 `framed` 的二分解定案。件彼此獨立掛在容器上(非骨架鏈),
   * 逐件平移/縮放不會拆散關節 —— 唯一縫,MUST NOT 在各 builder 另寫夾制。
   */
  _frameCockpitStruct(g) {
    const capY = COCKPIT.TOP_NDC, tanV = COCKPIT.TAN_V;
    const INFL_W = INK_W;                         // 唯一縫(見 INK_W)
    g.updateMatrixWorld(true);                    // g 尚未掛上 camera ⇒ 先把容器矩陣算出來(否則子件世界座標是舊的)
    const _v = new THREE.Vector3();
    /**
     * 動畫姿勢取樣(2026-08-15 使用者:「螺旋槳放進去的時候會不會轉?不轉的話很奇怪,
     * 會轉的話要考慮旋轉後的範圍」)——
     * **夾制量的 MUST 是這一件在所有姿勢下的包絡,不是靜止那一幀**。
     * 座艙裡真的每幀在動的有兩種:自轉件(`cockpitSpin`,繞樞軸 y 連續 360°)與擺動件
     * (`cockpitFlap`,正弦 ±amp)。只量靜止那一幀的代價是:一片停在側面的槳葉量起來很窄,
     * 轉起來卻掃出一整個圓盤 —— 實測 s11/m03 的槳盤轉到某個角度時**頂緣爬到 NDC +0.19**
     * (門檻 −0.222)並吃掉中央格 0.8%,而每一條斷言在靜止那一幀上都是綠的。
     * 取樣而不解析:自轉的掃掠是旋轉體、擺動的是圓弧帶,兩者的解析包絡各是一套公式,
     * 而取樣一套管兩種、加第三種動畫時不必再推一次(這是**建構期**的成本,執行期一格未動)。
     */
    const spinSet = new Set(this.cockpitSpin);
    const flapMap = new Map(this.cockpitFlap.map((f) => [f.o, f]));
    const posesOf = (o) => {
      const sp = [], fl = [];
      o.traverse((n) => { if (spinSet.has(n)) sp.push(n); const f = flapMap.get(n); if (f) fl.push(f); });
      return (sp.length || fl.length) ? { sp, fl } : null;
    };
    /** 對每個取樣姿勢呼叫 fn();沒有動畫件就只呼叫一次(⇒ 逐位元同舊行為)。用完 MUST 還原 */
    const withPoses = (o, fn) => {
      const a = COCK_ANIM ? posesOf(o) : null;
      if (!a) { o.updateWorldMatrix(true, true); fn(); return; }
      const y0 = a.sp.map((n) => n.rotation.y);
      const r0 = a.fl.map((f) => f.o.rotation[f.ax]);
      for (let k = 0; k < ANIM_N; k++) {
        const u = (k / ANIM_N) * Math.PI * 2;
        for (const n of a.sp) n.rotation.y = u;
        for (const f of a.fl) f.o.rotation[f.ax] = f.base + f.amp * Math.sin(u);
        o.updateWorldMatrix(true, true);
        fn();
      }
      a.sp.forEach((n, i) => { n.rotation.y = y0[i]; });
      a.fl.forEach((f, i) => { f.o.rotation[f.ax] = r0[i]; });
      o.updateWorldMatrix(true, true);
    };
    const boxOf = (o) => {
      const out = new THREE.Box3();
      withPoses(o, () => out.union(new THREE.Box3().setFromObject(o)));
      return out;
    };
    const frac = (bb) => (bb.isEmpty() ? 0 : ndcFrac(bb.min, bb.max));   // 唯一縫
    // 頂緣 MUST 逐頂點投影量(不是 AABB):傾斜件(EVA 肩莢/斜掛槍)的實渲染頂緣比軸對齊盒高
    // 出 ~0.05m,AABB 估計會漏。回傳最高 NDC 頂點的 {ndc,z,y}(y 已含描邊外推 INFL_W)。
    const topVert = (o) => {
      let best = null;
      withPoses(o, () => {
        o.traverse((m) => {
          const pos = m.isMesh && !m.userData.isOutline && m.geometry?.attributes?.position;
          if (!pos) return;
          for (let i = 0; i < pos.count; i++) {
            _v.fromBufferAttribute(pos, i).applyMatrix4(m.matrixWorld);
            if (_v.z >= -0.05) continue;
            const ndc = (_v.y + INFL_W) / (Math.abs(_v.z) * tanV);
            if (!best || ndc > best.ndc) best = { ndc, z: _v.z, y: _v.y };
          }
        });
      });
      return best;
    };
    /** o:件根;areaCap:面積上限(Infinity=不縮);doCone:是否夾準星錐(武器 wrap 已由 framed 處理故 false) */
    const clamp = (o, areaCap, doCone) => {
      let bb = boxOf(o);
      if (bb.isEmpty()) return;
      // ③ 裝置面積 ≤ areaCap。兩條:
      //  ・MUST **迭代**:佔比對縮放不是單純的平方關係(深度也跟著縮)—— 一步到位在跨度大的
      //    件上收不回來。
      //  ・縮放 MUST **保持量體中心不動**。`o.scale` 是繞**件自己的原點**縮的,而掛載機構
      //    (`_cockMountStruct`)那幾件的原點就在**相機上**(零件各自帶絕對座標)⇒ 繞原點縮
      //    等於把整組往鏡頭裡吸:深度跟著趨近 0、佔比永遠收不下來,六輪之後縮成 0.005 倍的
      //    一粒灰塵貼在鏡頭上(實測 s03:持槍手臂整組消失,而每一條斷言都還是綠的)。
      if (areaCap < Infinity) {
        for (let it = 0; it < 6; it++) {
          const f = frac(bb);
          if (!(f > areaCap) || f <= 1e-5) break;
          const c0 = bb.getCenter(new THREE.Vector3());
          o.scale.multiplyScalar(Math.sqrt(areaCap / f));
          bb = boxOf(o);
          o.position.add(c0.sub(bb.getCenter(new THREE.Vector3())));
          bb = boxOf(o);
        }
      }
      for (let it = 0; it < 4; it++) {            // ② 頂緣(逐頂點,含描邊外推)
        const tv = topVert(o);
        if (!tv || tv.ndc <= capY) break;
        o.position.y += capY * Math.abs(tv.z) * tanV - (tv.y + INFL_W);
        o.updateMatrixWorld(true);
      }
      if (!doCone) return;
      // ① 中央九宮格淨空(2026-08-15 使用者;涵蓋舊的 11° 準星錐,見 COCKPIT.GRID_NDC)。
      // 迭代是因為位移換算取的是**當下**的近面深度,而下沉會把近面推遠一點 ⇒ 一步通常夠、
      // 偶爾要補第二步。推不出去(格子比件還小)就停手,由稽核紅字接手,MUST NOT 無限推。
      for (let it = 0; it < 5; it++) {
        bb = boxOf(o);
        const push = mid9Push(bb.min, bb.max);
        if (!push) break;
        o.position.x += push.x;
        o.position.y += push.y;
        o.updateMatrixWorld(true);
      }
    };
    // 結構件(艙罩 + 機體剪影):裝置面積 + 頂緣 + 中央格
    const skip = new Set([this.gunGroup, this.cockGround, this.cockAir]);
    for (const c of [...g.children]) if (!skip.has(c)) clamp(c, COCKPIT.DEV_AREA_MAX, true);
    if (this.isMorph) for (const cg of [this.cockGround, this.cockAir]) for (const c of [...cg.children]) clamp(c, COCKPIT.DEV_AREA_MAX, true);
    // 武器持槍機構(cockStruct:手臂/砲座/喉管)頂緣 + 準星錐,豁免面積(它是武器的一部分)。
    // 武器本體 wrap **MUST NOT** 在此平移 —— 頂緣/面積/準星錐/消失點全由 framed 二分解定案,
    // 事後平移會破壞 VP 對準(平移改變砲管軸線與消失點的夾角)。
    // 面積上限自 2026-08-15 起**不再豁免**:使用者定案「單一物件面積不可超過全畫面的 5%」是
    // 對**任何一件**說的,持械機構(手臂/砲座/喉管)也是一件。夾在 PART_AREA_MAX 而不是
    // DEV_AREA_MAX ⇒ 「機構恆比裝置寬鬆、比 5% 嚴格」,舊制的無上限只差在少數幾件會被縮一級。
    const guns = this.isMorph ? [this._gunG, this._gunA] : [this.gunGroup];
    for (const gun of guns) for (const c of [...gun.children]) if (c.userData.cockStruct) clamp(c, COCKPIT.PART_AREA_MAX, true);
  }

  /**
   * 武裝動畫的包絡上限(2026-08-15;唯一縫,兩個輸出 `_gunLift` / `_gunPull` 只在 tick 被讀)。
   *
   * 取景夾制定案的是**靜止那一幀**,但 `gunGroup` 每幀都在動:後座回彈(+z)、填彈動作
   * (beam/rail 整管後拉 +0.4z、發射器上掀 −0.5rad、槍械退彈匣 −0.22y/+0.12rad)、
   * 以及榴彈火控的**超高仰角**(`BALLISTIC.LOB_SUP_MAX` 0.70rad ≈ 40°)。三者都在夾制之後才套上去。
   * 實測(靜止全綠的同一份座艙):仰角只要 **0.10rad(5.7°)** 就把 s02 的武裝推進中央格,
   * 頂到 40° 時整把槍掃過準星(中央格被吃掉 6.6%、頂緣爬到 NDC +0.73);t11 空中型、m06、
   * t01、t11 地面型同族。畫面上就是「瞄準的時候槍管擋在準星上」,而每一條既有斷言都是綠的。
   *
   * 兩件事一起做:
   *  ⓐ **繞武器自己的掛點抬,不是繞鏡頭**。舊制 `gunGroup.rotation.x = θ` 的樞軸在**相機原點**
   *     ⇒ 抬 θ 等於讓整把槍沿半徑 ≈1.3m 的圓弧掃過畫面(那不是砲管抬高,是整個座艙在翻)。
   *     改繞武裝量體中心 `_gunPivot`:槍在原地翹起來,槍口抬得看得見而槍身待在角落。
   *     樞軸補償寫進 `position`(T = P − R·P)⇒ `_muzzle` 仍是 gunGroup 的局部點,
   *     `gunGroup.localToWorld(_muzzle)` 那四個彈道消費端一行不改。
   *  ⓑ **上限由取景規則反解**,MUST NOT 手寫角度:二分找「仍然滿足頂緣 + 中央格」的最大值。
   *     `LOB_SUP_MAX` 本來就註明是**只夾視覺、不夾彈道解** ⇒ 收緊它不動任何一發砲彈的落點。
   *
   * ❗ **往下轉也要夾**:旋轉的樞軸在量體中心 ⇒ 槍口壓下去的同時**槍尾翹上來**。
   * 發射器/飛彈/電漿的填彈動作是「上掀開膛」(rx = −0.5rad),實測把 t06 飛行型的槍尾掀到
   * NDC **+0.24**(門檻 −0.222)—— 只夾正向的話,這一族在填彈的半秒裡把東西掀進準星。
   * 位移則只夾**往前**(dz>0 = 靠近鏡頭);dy 恆 ≤ 0(往下)不會違規。
   */
  _solveGunPose() {
    const parts = [];
    this.gunGroup.traverse((o) => { if (o.userData.cockWpn || o.userData.cockStruct) parts.push(o); });
    // 樞軸 = 武裝量體(不含機構)的中心;查無武裝退回原點 ⇒ 逐位元同舊行為
    const pb = new THREE.Box3();
    for (const o of parts) if (o.userData.cockWpn) pb.expandByObject(o);
    this._gunPivot = pb.isEmpty() ? new THREE.Vector3() : pb.getCenter(new THREE.Vector3());
    this._gunLift = 0;
    this._gunDrop = 0;
    this._gunPull = 0;
    if (!parts.length) return;
    if (!COCK_ANIM) {                      // 壞版:不夾、樞軸退回鏡頭原點(= 改制前那一版)
      this._gunPivot.set(0, 0, 0);
      this._gunLift = BALLISTIC.LOB_SUP_MAX;
      this._gunDrop = GUN_POSE.DROP_MAX;
      this._gunPull = GUN_POSE.PULL_MAX;
      return;
    }
    const base = this._gunBaseZ;
    const P = this._gunPivot;
    const ok = (lift, pull) => {
      this.gunGroup.rotation.x = lift;
      const c = Math.cos(lift), sn = Math.sin(lift);
      this.gunGroup.position.set(0, P.y - (P.y * c - P.z * sn), base + pull + P.z - (P.y * sn + P.z * c));
      this.gunGroup.updateMatrixWorld(true);
      for (const o of parts) {
        const bb = new THREE.Box3().setFromObject(o);
        if (bb.isEmpty()) continue;
        if (mid9Push(bb.min, bb.max)) return false;                       // 中央九宮格
        if (ndcBox(bb.min, bb.max).y1 > COCKPIT.TOP_NDC) return false;    // 頂緣線
      }
      return true;
    };
    const solve = (lo, hi, f) => {
      if (f(hi)) return hi;
      for (let i = 0; i < 16; i++) { const m = (lo + hi) / 2; if (f(m)) lo = m; else hi = m; }
      return lo;   // 回的恆是**驗過**的那一點(lo 起始 0 = 靜止姿勢)
    };
    // ⚠ 兩軸 MUST NOT 只在「另一軸頂到上限」那一點上驗:**位移最大不是最壞的情況**。
    // 把武裝往鏡頭拉近會讓一個在視軸下方的件投影得**更低**(NDC y = y / (|z|·tanV),|z| 變小
    // ⇒ 負值更負)⇒ 在 pull = 0.51 上驗「往下轉 0.31rad」是綠的,而執行期填彈只 pull 0.11 時
    // 同一個角度把槍尾掀到 NDC −0.13(實測 s04,門檻 −0.222)。旋轉那兩軸因此 MUST **掃過**
    // 整段位移範圍;位移那一軸在靜止姿態上解(旋轉的解已經掃過它)。
    this._gunPull = solve(0, GUN_POSE.PULL_MAX, (v) => ok(0, v));
    const sweep = (lift) => {
      for (let i = 0; i <= GUN_POSE.PULL_N; i++) {
        if (!ok(lift, (this._gunPull * i) / GUN_POSE.PULL_N)) return false;
      }
      return true;
    };
    this._gunLift = solve(0, BALLISTIC.LOB_SUP_MAX, (v) => sweep(v));
    this._gunDrop = solve(0, GUN_POSE.DROP_MAX, (v) => sweep(-v));
    ok(0, 0);                              // 還原成靜止姿勢(稽核與第一幀都從這裡出發)
  }

  /**
   * 座艙武裝同步(2026-07-22 同源改制):
   * 變形者隨型態切換整組結構+武裝;所有機種隨瞄準狀態切換「作用中槍口」(輕⇄重)——
   * 輕/重武器與第三人稱一樣同時可見,只有彈道起點與槍口焰跟著當前武器走。
   */
  _syncCockpitWeapon() {
    const fly = !!this.flight;
    // **狙擊模式不出現機體零件**(2026-08-15 使用者定案):進鏡 ⇒ 座艙件整組收起。
    // 三條:
    //  ① 收的是**全部**座艙件(機體剪影 / 武裝 / 持械機構 / 艙框),MUST NOT 只收「擋到鏡圈的
    //     那幾件」—— 鏡圈外一樣是瞄準用的畫面,而且「擋不擋得到」逐機體不同 = 又一份判定。
    //  ② **槍口焰留著**:它不是機體零件而是開火回饋(這一發打出去了沒有,鏡裡也要看得見)。
    //     它掛在 `gunGroup` 底下(後座回彈與火控抬角要跟著走)⇒ 收的是 gunGroup 的**子件**,
    //     MUST NOT 收 gunGroup 本身。
    //  ③ 收顯只准住這一支(每幀跑,與型態切換同一個結算點)—— 在別處另寫一份 `aiming ?` 分支,
    //     兩份判定遲早分家,而症狀是「切回一般模式後某幾件沒回來」。
    // ⚠ 收顯 MUST **同時**看布林與**已定案的 `camera.fov`**:取景那七條規則每一條都是在
    // fov 68 上算的(A8 全機種統一),而狙擊鏡是 `UNITS[kind].zoomFov` = 35 —— **放大 2.14 倍**。
    // fov 是**漸變**的(`_updatePlayer` 每幀拉近/拉遠),而 `aiming` 是當場翻的布林 ⇒
    //  ・只判布林:退出狙擊那一瞬間零件全部回來,而 fov 還在 35 往 68 收 —— 那幾幀的座艙是
    //    被放大兩倍畫出來的(中央格、頂緣、5% 三條同時破,而每一支稽核都在 fov 68 上驗)。
    //  ・只判 fov:進鏡的第一幀 fov 還是 68,零件還在(只差一幀,但那一幀是滿版的)。
    // 兩個都判 ⇒ 進鏡當場收、出鏡等 fov 真的回到 68 才放,中間沒有任何一幀是放大的。
    const hide = !!this.aiming
      || (this.baseFov > 0 && this.camera.fov < this.baseFov - COCKPIT.FOV_EPS);
    if (this.cockAir) {
      this.cockAir.visible = !hide && fly;
      this.cockGround.visible = !hide && !fly;
      this._gunA.visible = !hide && fly;
      this._gunG.visible = !hide && !fly;
    }
    for (const c of this.cockpit?.children || []) {
      if (c !== this.gunGroup && c !== this.cockAir && c !== this.cockGround) c.visible = !hide;
    }
    for (const c of this.gunGroup?.children || []) {
      if (c !== this.flash && c !== this._gunG && c !== this._gunA) c.visible = !hide;
    }
    const set = (this.isMorph && fly) ? this._muzzles?.A : this._muzzles?.G;
    if (!set) return;
    const id = this.aiming && this.wdef?.heavy ? 'heavy' : 'light';   // 與 _curWeapon 同一條選槽規則
    const mz = set[id] || set.light || set.heavy;
    if (mz && this._muzzle !== mz) { this._muzzle = mz; this.flash.position.copy(mz); }
  }

  /** 週期擺動件(撲翼/觸手/尾):註冊後由 tick 以正弦驅動 */
  _flap(o, ax, base, amp, hz, ph = 0) {
    o.rotation[ax] = base;
    this.cockpitFlap.push({ o, ax, base, amp, hz, ph });
    return o;
  }

  /**
   * 座艙的機體剪影 = **這台新版機體自己的零件**(2026-08-15 使用者:「駕駛艙畫面基於新版機體
   * 更新設計」)。舊制那十支手繪 builder(擬態獸 / 定翼 / 旋翼 / 人形原型 / 獸首 / 頸艙 /
   * 變形雙態,逐 `visual.proto`·`creature`·`wing`·`pod` 分支)整組退場 —— 它們畫的是**舊版建模**
   * 的識別剪影,而英雄機體自 2026-08-14 起一律由 `forge/` 鍛造:座艙裡那顆頭跟機體上那顆頭
   * 從此是兩件不同的東西,而畫面上只表現成「座艙好像不是這台機體的」,沒有任何錯誤訊息。
   *
   * 取件規則(唯一縫。武裝**不走這裡** —— 它有自己的四條取景規則,見 `_mountCockpitWeapon`):
   *  ⓐ **視點自機體實高推導**(`heroView`,與 `_updatePlayer` 的相機眼位**同一份**):只收眼位
   *     周圍 `R_F × 全高` 內、且在前方的零件 ——「駕駛看得到自己機體的哪幾塊」是幾何問題,
   *     不是美術問題。取樣點再沿視軸**後退** `BACK_F × 全高`:真眼位就坐在胸腔/顱腔裡,
   *     肩甲與頭罩的量體中心幾乎恰落在眼位平面上(z ≈ 0)⇒ 不退一步的話它們不是被近裁面
   *     切掉就是方向本身是雜訊(同 `_mountCockpitWeapon` 那條「軸線短到是雜訊」的病灶)。
   *  ⓑ **重投影 = 以眼位為心的等比縮放**(位置 ×k、尺寸 ×k,k = D / 距離)⇒ **投影逐像素不變**:
   *     把零件搬進 z ≈ −D 的近場只是為了不被相機近裁面切掉,看到的角度大小仍然是真的那一塊。
   *     這同時就是規則④「消失點在準星」對結構件那一半的實現 —— 真透視本來就收斂在視軸上;
   *     MUST NOT 再對結構件套一次武器那條「砲管軸線對齊消失點」(結構件沒有砲管軸線可對,
   *     硬套只會把肩甲轉成一個指著準星的奇怪角度)。
   *  ⓒ **預算制**:逐件盒面積(各自夾在 `DEV_AREA_MAX` 之下)由大到小累加到 `BUDGET` 為止,
   *     其餘丟掉 —— 留大的那幾件是因為小碎片在座艙裡讀不出是什麼,只是雜訊加 draw call。
   *  ⓓ 收進來的件一律再經 `_frameCockpitStruct` 的三條夾制(面積 / 頂緣 / 準星錐)。
   *
   * 「一件」= **同一個父節點底下的那批網格**:forge 的建構器把同一塊裝甲的零件畫進同一個
   * Group,那就是天然的分件單位,MUST NOT 逐 mesh 拆(一塊裝甲會碎成十幾片各自被夾制,
   * 看起來像散落的碎屑)、也 MUST NOT 整棵收(整台機體變成一件 = 5% 規則下縮成一個小點)。
   *
   * @param src   要取件的那一棵(變形者 = 該型態那一棵,見 `userData.morph.gg`/`.ag`)
   * @param rig   該棵的 rig(取 `wpn` 名冊,武裝子樹要排除)
   * @param spin  自轉名冊(`userData.spin`):命中的件改以該節點為樞軸,座艙裡照樣轉
   * @param par   掛載容器(一般 = 座艙根;變形者 = `cockGround`/`cockAir`)
   * @param air   飛行型態(眼位查表用)
   */
  _cockBody(src, rig, spin, par, air) {
    const B = COCK_BODY;
    const H = heroTargetH(this.heroKind, this.ch) || SOLDIER_H;
    const vw = heroView(this.heroKind, this.ch, air);
    // 眼位:與 _updatePlayer 同一式(y = 全高 × e、沿正面 −z 前移 全高 × f),再後退 BACK_F
    const eye = new THREE.Vector3(0, H * vw.e, -H * vw.f + H * (air ? B.BACK_F_AIR : B.BACK_F));
    src.updateMatrixWorld(true);

    // 武裝子樹排除:它由 _mountCockpitWeapon 另複製一份並自帶取景解,兩份疊起來 = 同一把槍畫兩次
    const skip = new Set();
    for (const s of ['light', 'heavy']) {
      for (const n of (rig?.wpn?.[s]?.nodes || [])) n?.traverse((o) => skip.add(o));
    }
    const spinSet = new Set(spin || []);
    const inSet = (o, set) => { for (let p = o; p; p = p.parent) if (set.has(p)) return p; return null; };

    // ---- 分件:同一個父節點底下的網格算一件 ----
    // 逐**顆**濾掉跨過取樣平面的網格(不是逐件):件是「同一個父節點底下那批」,而那批裡
    // 常常有一兩顆從眼位旁邊往後延伸(脊樑/掛架)。留著它們的代價是整件的包圍盒跨過 z = 0,
    // 而螢幕佔比的分母取的是**近面深度** ⇒ 分母趨近 0、佔比爆成幾百趴,面積夾制一步收不回來。
    const _mb = new THREE.Box3();
    const parts = new Map();
    src.traverse((o) => {
      if (!o.isMesh || o.userData.isOutline || !o.geometry?.attributes?.position) return;
      if (inSet(o, skip)) return;
      _mb.setFromObject(o);
      if (_mb.max.z >= eye.z - 0.08) return;
      const key = o.parent || src;
      let arr = parts.get(key);
      if (!arr) parts.set(key, arr = []);
      arr.push(o);
    });

    // ---- 逐件量投影(投影不變量:直接以眼位框的包圍盒算,不必先搬過去)----
    // 取樣半徑錨在**這具機體的實際尺寸**,MUST NOT 只錨全高:飛行體是又寬又扁的
    // (實測 s11 展長 10.1m 而全高 2.1m)⇒ 拿全高當半徑會把整對翼與引擎莢判成「太遠」,
    // 而症狀同樣是「這幾台的座艙是空的」。
    const _sz = new THREE.Box3().setFromObject(src).getSize(new THREE.Vector3());
    const R = B.R_F * Math.max(H, _sz.x * 0.5, _sz.z * 0.5);
    const _bb = new THREE.Box3();
    const cand = [];
    for (const [key, meshes] of parts) {
      // 自轉件的包圍盒 MUST 量**掃掠後**的(繞樞軸轉一圈的包絡):選件與預算都吃這個佔比,
      // 拿靜止那一幀的窄槳葉去排序,會把一整個圓盤當成一片薄板收進來。
      // 這裡直接在**來源樹**上轉(那一棵是拋棄式的參照機體,從未 render)。
      const piv = inSet(meshes[0], spinSet);
      const y0 = piv ? piv.rotation.y : 0;
      _bb.makeEmpty();
      for (let k = 0; k < (piv ? ANIM_N : 1); k++) {
        if (piv) { piv.rotation.y = (k / ANIM_N) * Math.PI * 2; piv.updateWorldMatrix(true, true); }
        for (const m of meshes) _bb.expandByObject(m);
      }
      if (piv) { piv.rotation.y = y0; piv.updateWorldMatrix(true, true); }
      if (_bb.isEmpty()) continue;
      const lo = _bb.min.clone().sub(eye), hi = _bb.max.clone().sub(eye);
      const ctr = lo.clone().add(hi).multiplyScalar(0.5);
      const d = ctr.length();
      // 「在前方」判的是**量體中心**不是近面:座艙裡看得到的那幾塊(肩甲/引擎莢/機鼻)幾乎都
      // 跨過取樣平面 —— 要求整件都在前方等於一件都收不到(實測 t03/t09 一件不剩,而空座艙
      // 每一條既有規則都過)。中心在後(ctr.z > 0)則 MUST 丟掉:那一件的重投影方向是反的,
      // 硬算會把它丟到相機後方數十公尺(實測 33361% 那一族)。
      if (ctr.z > -B.FRONT_F * d) continue;
      if (!(d > H * 0.10) || d > R) continue;                        // 太近(貼著眼位)/ 太遠(剩幾個像素)
      const f = ndcFrac(lo, hi);                                     // 佔比走唯一縫(投影不變)
      if (f < B.MIN_F) continue;
      // 等比放大到近場:D/d 讓量體中心落在球面上,ZNEAR/zRef 再把整件推出相機近裁面(取大)。
      // zRef = 近面深度,但**恆取在中心之前的一段**(min 的第二項)—— 近面落在取樣平面後方時,
      // 直接拿它當分母就是拿一個負數/近零數當放大倍率的分母。倍率有上限,推不出去就**不收**
      // (原則 6:寧缺勿錯)—— 硬放大會把量體撐到數十公尺,而後面的頂緣/準星錐夾制是**平移**,
      // 平移一塊比戰場還大的板子只是把它推到畫面外。
      const zRef = -Math.min(hi.z, ctr.z * 0.35);
      const k = Math.min(B.K_MAX, Math.max(B.D / d, B.ZNEAR / zRef));
      if (zRef * k < B.ZNEAR * 0.7) continue;
      cand.push({ key, meshes, ctr, f: Math.min(f, COCKPIT.DEV_AREA_MAX), k });
    }
    cand.sort((a, b) => b.f - a.f);

    // ---- 預算:大件優先,累加到 BUDGET / N 為止 ----
    let used = 0, n = 0;
    for (const c of cand) {
      if (n >= B.N || used + c.f > B.BUDGET) continue;
      used += c.f; n++;
      const pivotSrc = inSet(c.meshes[0], spinSet);                 // 自轉件:改以自轉節點為樞軸
      const w = new THREE.Group();
      // ⚠ 容器原點 MUST 落在**這一件自己身上**(量體中心的重投影位置),MUST NOT 留在眼位:
      //   以眼位為心的等比縮放**恰好保持投影不變**(這正是 ⓑ 的本錢)⇒ 原點留在眼位的話,
      //   `_frameCockpitStruct` 的面積夾制(`o.scale.multiplyScalar`)就是個 **no-op** ——
      //   件照樣佔滿畫面,而逐項斷言只在「最大裝置」那一欄紅字(實測 562%~1880%)。
      const org = c.ctr.clone().multiplyScalar(c.k);
      w.position.copy(org);
      w.scale.setScalar(c.k);
      w.userData.cockBody = true;                                   // 稽核標記(逐件面積量測用)
      const baseInv = new THREE.Matrix4().makeTranslation(
        -(eye.x + c.ctr.x), -(eye.y + c.ctr.y), -(eye.z + c.ctr.z));
      let frame = w, fInv = baseInv;
      if (pivotSrc) {
        const piv = new THREE.Group();
        piv.matrix.multiplyMatrices(baseInv, pivotSrc.matrixWorld);
        piv.matrix.decompose(piv.position, piv.quaternion, piv.scale);
        w.add(piv);
        frame = piv;
        fInv = pivotSrc.matrixWorld.clone().invert();
        this.cockpitSpin.push(piv);                                 // 與第三人稱 spinners 同一條驅動
      }
      for (const m of c.meshes) {
        const cl = m.clone(false);                                  // 只複製這一顆:描邊殼與子件另計
        cl.matrix.multiplyMatrices(fInv, m.matrixWorld);
        cl.matrix.decompose(cl.position, cl.quaternion, cl.scale);
        cl.userData.noPaint = true;                                 // 來源已上過塗裝,座艙不再疊一層
        frame.add(cl);
      }
      par.add(w);
    }
  }


  /**
   * 人類駕駛艙罩(**全機種共通**,2026-07-12;2026-07-16 拆除 A 柱/頂樑):儀表台 / HUD 燈條 + 左肩角色掛件。
   * 座艙裡坐的是人 —— 不論外面那具機體是人形、獸型還是無人機,看出去一律先隔著這面艙框,
   * 機體自身的結構(頭顱/吻部/翼/旋翼/武器)都在艙框之外。**MUST NOT** 退回「從獸的眼窩看出去」。
   * 上方與兩側視野全開放(無 A 柱/無頂樑)—— 艙外的機體特徵不被艙框遮擋。
   */
  _cockCanopy(g, mk, accent) {
    // 儀表台(2026-07-24 取景改制):舊版 1.7×0.28 @ z −0.85 單件就吃掉 **26.4% 畫面**、
    // 頂緣爬到 NDC −0.40(高過 HUD 下帶上緣)—— 全 32 角色共用,是「面積太大」的最大單一來源。
    // 收窄 + 下沉 + 後推:整片壓在 HUD 下帶之內,遮擋降到個位數,座艙感不變。
    // 2026-08-15:左肩掛件座與 `visual.pod` 六分支一併退場 —— 那是**舊版建模**的識別掛件,
    // 新版機體自己的掛件已由 `_cockBody` 從真品零件複製過來,再畫一份就是同一個東西畫兩次
    // (而且是畫**錯**的那一份:pod 的形狀來自舊建模,新機體上根本沒有那個東西)。
    const dash = mk(new THREE.BoxGeometry(0.88, 0.16, 0.32), 0x46505b);
    dash.position.set(0, -0.72, -1.25);
    dash.rotation.x = 0.5;
    g.add(dash);
    const light = mk(new THREE.BoxGeometry(0.42, 0.04, 0.05), accent, { emissive: accent, emissiveIntensity: 0.9 });
    light.position.set(0, -0.64, -1.14);
    g.add(light);
  }

  /**
   * 輕/重武器座艙掛載(2026-07-22 同源改制):
   * **掛點(mount)決定長在機體哪裡;外觀直接複製第三人稱武裝子樹(models.js rig.wpn 登記)**,
   * 缺登記退回 podWeapon 依 def.type 建同語彙莢艙 —— 展示台/戰場/座艙三處武器同源。
   * 掛點錨統一走 `DEF_ANCHOR`(2026-08-15:逐機錨隨舊版座艙 builder 退場);`anchors` 參數保留
   * 給未來逐機覆寫,現役呼叫端一律傳 null。
   * 異型雙持(雙手/雙莢/雙翼)左右分掛(與第三人稱同約定:左輕右重;rig.weap 'L'/'R' 優先);
   * 同型雙模(slots 含輕+重)只建一次,回傳兩個槍口。
   * @returns {Object} 每 slot 的槍口局部座標(gunGroup 空間;彈道與槍口焰共用)
   */
  _mountCockpitWeapon(mk, accent, PAL, vis, slots, wpn, rig3p, parent, anchors, air) {
    const slot0 = slots[0];
    const both = slots.length > 1;
    const cdef = CHARACTERS[this.ch]?.[slot0] || {};   // 原始武器定義(只取 type/fan,不受 _setChar 內部順序影響)
    const wtype = cdef.type || 'gun';
    const kindArg = this.isMorph ? 'morph' : this.heroKind;
    const handSide = rig3p.weap?.[slot0];
    // 掛點:輕武器沿用 gunMount;地面重武器優先手持邊(rig.weap 'L'/'R'/'B'),否則查 HEAVY_MOUNT;
    // 飛行型態(morph 空中/無人機)輕重共用同族硬點,由左右分掛區分。
    // backPair = 輕重「雙肩分扛」(gorilla 2026-07-22):兩件都在 back 錨 → 左右鏡射分掛,
    // 且電漿破例不改口噴(第三人稱就長在左肩,FPV 同源)
    const hHand2 = ['L', 'R', 'B'].includes(rig3p.weap?.heavy);
    const heavyM = (!air && hHand2) ? 'hand'
      : (HEAVY_MOUNT[mountKey(vis, kindArg, air)] || gunMount(vis, kindArg, air, CHARACTERS[this.ch]?.heavy?.type || 'gun'));
    const backPair = !air && heavyM === 'back'
      && gunMount(vis, kindArg, air, CHARACTERS[this.ch]?.light?.type || 'gun') === 'back';
    let mount;
    if (slot0 === 'heavy' && !both && !air) {
      mount = heavyM;
      if (wtype === 'plasma' && mount === 'back' && !backPair) mount = 'mouth';   // 電漿口噴(雙肩分扛破例)
    } else {
      mount = gunMount(vis, kindArg, air, wtype);
    }
    // 左右分掛:hand/tentacle 依第三人稱持手邊;雙莢/翼/爪 = 左輕右重(buildDrone/buildFixedWing
    // 同約定);雙肩分扛 back 對 = 右輕左重(對齊 buildBipedBeast gorilla 第三人稱)
    let sideSign = 0;
    if (mount === 'hand' || mount === 'tentacle') sideSign = handSide === 'L' ? -1 : 1;
    else if (mount === 'back' && backPair && !both) sideSign = slot0 === 'light' ? 1 : -1;
    else if (mount === 'body' || mount === 'wing' || mount === 'claw') sideSign = both ? 0 : (slot0 === 'light' ? -1 : 1);
    const a = (anchors && anchors[mount]) || DEF_ANCHOR[mount] || DEF_ANCHOR.body;
    const s = a.s ?? 1.0;
    const ax0 = sideSign !== 0 ? Math.abs(a.x) * sideSign
      : (both && (mount === 'body' || mount === 'wing' || mount === 'claw')) ? 0 : a.x;
    // 輕重同掛點(dragon 頦下砲+口腔巢 / stego 背塔+背鰭):重武器沿**離心方向**錯開,重現上下疊放。
    // MUST NOT 一律上抬 —— 嘴砲錨在視軸正下方,上抬就是把砲管推進準星(2026-07-24 取景稽核打回)。
    let ax = ax0, ay = a.y, az = a.z;
    if (slot0 === 'heavy' && !both && sideSign === 0
      && mount === gunMount(vis, kindArg, air, CHARACTERS[this.ch]?.light?.type || 'gun')) {
      const rr = Math.hypot(ax, ay) || 1;
      ax += (ax / rr) * 0.26; ay += (ay / rr) * 0.26; az -= 0.1;
    }
    // ---- 取景夾制(2026-07-24 四條 + 2026-08-15 的中央九宮格;唯一縫 = COCKPIT)----
    // ① 錨點推到**中央九宮格之外**(2026-08-15 起取代舊的「徑向推出準星錐」——
    //    格子涵蓋錐,見 COCKPIT.GRID_NDC)。格在深度 |az| 的世界半跨:
    //    橫向 GRID_NDC × ndcH(az) × 16/9、縱向 GRID_NDC × ndcH(az)。
    //    再各加掛載機構自身的半尺寸(≈0.24s)—— 手臂/砲座/喉管與武器同進退,只推武器不推機構的話,
    //    砲座量體會自己坐進中央格裡(gorilla 雙肩分扛實測 2.5°)。
    // ② 錨點高度夾在武裝頂緣線之下,留 0.2m 讓武器本體長得出來(背載砲塔原本高過畫面上緣)。
    // 順序 MUST 是「先壓高度、再推出格」—— 反過來會用未夾制的高度算出「已在格外」而放行,
    // 壓下來之後量體就坐進中央格裡。
    const topCap = COCKPIT.TOP_NDC * ndcH(az) - 0.2;
    ay = Math.min(ay, topCap);
    {
      const pad = 0.24 * s;
      const cw = COCKPIT.GRID_NDC * ndcH(az) * (16 / 9) + pad;
      const ch = COCKPIT.GRID_NDC * ndcH(az) + pad;
      // 已在格外就不動;要動的話取**較近**的那個方向(水平 or 下沉),與 mid9Push 同一條規則。
      // MUST NOT 往上(上方是天空與遠處敵機,而且 topCap 本來就禁止)。
      if (Math.abs(ax) < cw && ay > -ch) {
        if (cw - Math.abs(ax) <= ay + ch) ax = (ax < 0 ? -1 : 1) * cw;
        else ay = -ch;
      }
    }
    // 掛載機構(臂/觸手/喉管/砲座支柱/翼下掛架/爪/吊莢座)。
    // 機構是剛體(手臂連著手、砲座連著支柱)⇒ 侵入中央格時 MUST 整組外推重建,
    // 不能只挪其中一件;各分支自身的偏移量(吊莢座 +0.1s、砲座 −0.1s…)也因此不必逐條算進 pad。
    let struct = null;
    for (let it = 0; it < 6; it++) {
      const flapN = this.cockpitFlap.length;   // tentacle 機構會 _flap 進 cockpitFlap;被駁回要一併回收
      struct = new THREE.Group();
      struct.userData.cockStruct = true;       // 標記:武器相關掛載機構(取景夾制吃頂緣/中央格,但豁免裝置面積規則)
      parent.add(struct);
      this._cockMountStruct(mk, mount, { x: ax, y: ay, z: az, s }, sideSign || 1, struct);
      struct.updateMatrixWorld(true);
      const sb = new THREE.Box3().setFromObject(struct);
      if (sb.isEmpty() || !mid9Push(sb.min, sb.max)) break;
      parent.remove(struct);
      this.cockpitFlap.length = flapN;         // 丟棄本次機構的擺動註冊(否則指向已移除的孤兒節點)
      ax *= 1.12;
      ay = Math.min(ay * 1.12, topCap);
    }
    // 武器本體:複製第三人稱武裝子樹;缺登記退回 podWeapon(幾何 +z 朝前 → 轉 π 朝 -z)
    const set = wpn[slot0] || (both ? wpn[slots[1]] : null);
    const wrap = new THREE.Group();
    wrap.userData.cockWpn = slots.join('+');   // 稽核標記(tools/audit_cockpit.mjs 取景量測用)
    parent.add(wrap);
    const LEN = (COCK_WLEN[mount] ?? 1.0) * s;
    const muzNodes = {};
    let cloned = null;
    if (set?.nodes?.length && set.ref) cloned = this._cloneWpnSet(set);
    // ⚠ 2026-08-14(新版建模):複製過來的子樹**量不出砲管軸線**時 MUST 退回 podWeapon。
    //   軸線 = 「量體中心 → 最遠槍口」;槍口離中心太近(t06 尾梢熔核砲、t10 雙肩 VLS 都是
    //   短而胖的量體)⇒ 那條向量短到方向本身是雜訊,規則 ④ 的不動點迭代因此收不到準星上
    //   (實測殘留 43.8° / 36.4°,門檻 12°)。畫面上只表現成「座艙裡那把槍指著斜上方」。
    //   podWeapon 依 def.type 重建的是同一套外觀語彙的**長砲管**,軸線量得出來 —— 這是既有的
    //   缺登記退路,不是新開的分支(原則 6:降級不例外)。
    if (cloned) {
      const bb0 = new THREE.Box3().setFromObject(cloned.grp);
      const sz0 = bb0.getSize(new THREE.Vector3()), c0 = bb0.getCenter(new THREE.Vector3());
      let lever = 0;
      for (const sl of slots) {
        const mz = wpn[sl]?.muz && cloned.pairs.get(wpn[sl].muz);
        if (mz) lever = Math.max(lever, mz.getWorldPosition(new THREE.Vector3()).sub(c0).length());
      }
      if (lever < 0.22 * Math.max(sz0.x, sz0.y, sz0.z)) cloned = null;
    }
    if (cloned) {
      const rot = WPN_FWD_ROT[set.fwd || 'z'] || WPN_FWD_ROT.z;
      const inner = new THREE.Group();
      inner.rotation.set(rot[0], rot[1], rot[2]);
      inner.add(cloned.grp);
      wrap.add(inner);
      for (const sl of slots) muzNodes[sl] = (wpn[sl]?.muz && cloned.pairs.get(wpn[sl].muz)) || null;
    } else {
      const inner = new THREE.Group();
      inner.rotation.y = Math.PI;
      wrap.add(inner);
      const pw = podWeapon(inner, cdef, accent, PAL, { L: LEN * 0.75, R: slot0 === 'heavy' ? 0.1 : 0.07 });
      for (const sl of slots) muzNodes[sl] = pw.muz;
    }
    // ---- ④ 消失點在準星:把實測**砲管軸線**轉到指向視軸上 VP_Z 公尺處(螢幕上就是準星)----
    // 軸線 = **視覺量體中心 → 離中心最遠的那個槍口**。
    //  ·起點取量體中心(不取 ref 框原點):散件武裝(口腔飛彈巢/背鰭/雙肩 VLS)的 ref 是軀幹節點,
    //   原點根本不在武器上,拿它當槍尾會把整組轉到奇怪的方向(實測 dragon 147.8°)。
    //  ·終點取最遠槍口:同型雙模的兩個膛口常一前一後(seraph 騎槍:輕模副槍口在 1/3 處、
    //   重模主砲膛口在槍尖),取近的那個會把整把槍轉反(實測 159°)。
    //  ·AABB 中心不隨旋轉共變 ⇒ 這是不動點迭代;直接套完整修正會在細長 L 形量體上震盪(實測殘留 16°),
    //   故每步只套 DAMP 比例的修正(阻尼迭代),收斂後殘留 <1°。
    wrap.updateMatrixWorld(true);
    const vpDir = new THREE.Vector3(-ax, -ay, -COCKPIT.VP_Z - az).normalize();
    // ⚠ 2026-08-14(新版建模):迭代 MUST **記住迄今最好的那一次**並在震盪時**自動收阻尼**。
    //   舊制是固定 16 步 × DAMP 0.6,對細長 L 形量體剛好收斂;新版建模的量體更極端
    //   (t06 尾梢熔核砲離量體中心很遠、t10 六管加特林配雙肩 VLS)⇒ 同一組參數會在
    //   兩個姿勢之間來回跳,而**最後一步剛好停在壞的那一邊**(實測殘留 43.8° / 36.4°,
    //   門檻 12°)。畫面上只表現成「座艙裡那把槍指著斜上方」,沒有任何錯誤訊息。
    const axisOf = () => {
      const ctr = new THREE.Box3().setFromObject(wrap).getCenter(new THREE.Vector3());
      let axis = null, far = 1e-2;
      for (const sl of slots) {
        if (!muzNodes[sl]) continue;
        const v = muzNodes[sl].getWorldPosition(new THREE.Vector3()).sub(ctr);
        if (v.length() > far) { far = v.length(); axis = v; }
      }
      return axis?.normalize() || null;
    };
    let damp = 0.6, best = null, bestDot = -2;
    for (let it = 0; it < 48; it++) {
      const axis = axisOf();
      if (!axis) break;
      const dot = axis.dot(vpDir);
      if (dot > bestDot) { bestDot = dot; best = wrap.quaternion.clone(); }
      else damp *= 0.6;                                           // 這一步走壞了 ⇒ 收阻尼再試
      if (dot > 0.99985) break;                                   // 已對準(<1°)
      const q = new THREE.Quaternion().setFromUnitVectors(axis, vpDir);
      wrap.quaternion.premultiply(new THREE.Quaternion().slerp(q, damp));
      wrap.updateMatrixWorld(true);
    }
    if (best && bestDot > -2) { wrap.quaternion.copy(best); wrap.updateMatrixWorld(true); }
    // 量測定尺 + 置位:前端朝 -z、包圍盒對齊錨點;近場保護(任何件不越過 z = -0.55,免糊滿畫面)
    const q0 = wrap.quaternion.clone();
    const bb = new THREE.Box3().setFromObject(wrap);
    const size = bb.getSize(new THREE.Vector3());
    // 背載散件對(雙肩 VLS/四背鰭)橫跨左右 → X 預算收緊,整組貼住砲座不外擴到畫面中央
    const xBudget = (mount === 'back' && cloned && set.nodes.length > 1 ? 0.55 : 0.9) * s;
    const sc0 = Math.min(
      LEN / Math.max(size.z, 0.05),
      (0.54 * s) / Math.max(size.y, 0.05),   // 高度預算收緊(手持長槍垂直佔畫面過高)
      xBudget / Math.max(size.x, 0.05),
    );
    // 依縮放 k 就位(z 吃近場保護 −0.7,與掛載機構同一條近端界;背載另坐上砲座頂)
    const place = (k) => {
      wrap.quaternion.copy(q0);
      wrap.scale.setScalar(k);
      const c0 = bb.getCenter(new THREE.Vector3()).multiplyScalar(k);
      wrap.position.set(ax - c0.x, ay - c0.y, Math.min(-0.7 - bb.max.z * k, az - c0.z));
      if (mount === 'back') wrap.position.y += (ay - 0.02) - (wrap.position.y + bb.min.y * k);
      return {
        lo: bb.min.clone().multiplyScalar(k).add(wrap.position),
        hi: bb.max.clone().multiplyScalar(k).add(wrap.position),
      };
    };
    // 頂緣逐頂點量(不是 AABB):VP 旋轉後的長槍(嘴砲喉管/騎槍)傾斜頂緣比軸對齊盒高出 ~0.05,
    // AABB 會漏 ⇒ 武器戳出 HUD 線上。+0.016 = 描邊殼外推(outlinify 尚未執行,先預留)。
    const _tv = new THREE.Vector3();
    const wrapTopNdc = () => {
      let best = -9;
      wrap.updateWorldMatrix(true, true);
      wrap.traverse((m) => {
        const pos = m.isMesh && !m.userData.isOutline && m.geometry?.attributes?.position;
        if (!pos) return;
        for (let i = 0; i < pos.count; i++) {
          _tv.fromBufferAttribute(pos, i).applyMatrix4(m.matrixWorld);
          if (_tv.z >= -0.05) continue;
          const n = (_tv.y + 0.016) / (Math.abs(_tv.z) * COCKPIT.TAN_V);
          if (n > best) best = n;
        }
      });
      return best;
    };
    // 取景判定:①中央九宮格淨空(涵蓋 11° 準星錐)②頂緣 ≤ TOP_NDC(逐頂點)③盒 ≤ WPN_BOX_MAX
    // 武器本體**不平移**(平移會改變砲管軸線與消失點的夾角)⇒ 這裡只當**判定**用,
    // 出格就縮(下面的二分),MUST NOT 在這裡呼叫 mid9Push 事後挪。
    const framed = (b) => !mid9Push(b.lo, b.hi) && ndcFrac(b.lo, b.hi) <= COCKPIT.WPN_BOX_MAX;
    const okAt = (k) => framed(place(k)) && wrapTopNdc() <= COCKPIT.TOP_NDC;   // place(k) 先就位,再逐頂點量頂緣
    // 二分取「合規的最大尺寸」:單調(縮小 → 離視軸更遠、頂緣更低),故無需迭代求解器
    let sc = sc0;
    if (!okAt(sc0)) {
      let lo = 0, hi = sc0;
      for (let i = 0; i < 20; i++) { const mid = (lo + hi) / 2; if (okAt(mid)) lo = mid; else hi = mid; }
      // 下限只在**二分完全解不出來**時才頂上(寧可留一項稽核紅字,也不要武器縮成看不見的點)。
      // 2026-08-15 收緊:解得出來就 MUST 用解 —— 舊制的 `max(lo, sc0*0.2)` 會把一個**合規的**
      // 較小解換成一個違規的較大值,而使用者的 5% 是硬天花板不是建議值(實測 s03 5.2%)。
      sc = lo > 0 ? lo : sc0 * 0.2;
    }
    place(sc);
    // 槍口(gunGroup 局部座標):複本槍口節點實位;查無節點退回包圍盒前緣中心
    this.gunGroup.updateMatrixWorld(true);
    const out = {};
    for (const sl of slots) {
      out[sl] = muzNodes[sl]
        ? muzNodes[sl].getWorldPosition(new THREE.Vector3())
        : new THREE.Vector3(ax, ay, wrap.position.z + bb.min.z * sc - 0.05);
      this._mountAudit[sl] = mount;
    }
    return out;
  }

  /**
   * 複製 rig.wpn 登記的武裝子樹:以 ref.matrixWorld⁻¹ × node.matrixWorld 烘相對變換 →
   * 散件武器(嘴砲/背鰭/翼掛)保持第三人稱排列。剔除描邊殼(寬度是機體尺度烤死的,
   * 座艙統一重描)與待機槍口焰(隱形死件);複本共享來源幾何/材質(已含 paintUnit 塗裝)
   * → 標 noPaint 避免座艙塗裝二次上色。來源機體從未 render,幾何/材質由複本續用,MUST NOT dispose。
   */
  _cloneWpnSet(set) {
    const grp = new THREE.Group();
    const pairs = new Map();   // 原節點 → 複本節點(槍口對應查找)
    const refInv = set.ref.matrixWorld.clone().invert();
    const walk = (o, cl) => {
      pairs.set(o, cl);
      for (let i = 0; i < o.children.length; i++) walk(o.children[i], cl.children[i]);
    };
    for (const node of set.nodes) {
      if (!node) continue;
      const cl = node.clone(true);
      walk(node, cl);
      const rel = new THREE.Matrix4().multiplyMatrices(refInv, node.matrixWorld);
      rel.decompose(cl.position, cl.quaternion, cl.scale);
      grp.add(cl);
    }
    if (!grp.children.length) return null;
    const dead = [];
    grp.traverse((o) => { if (o.userData.isOutline || (!o.visible && o.userData.noOutline)) dead.push(o); });
    for (const o of dead) o.parent?.remove(o);
    grp.traverse((o) => { if (o.isMesh) o.userData.noPaint = true; });
    return { grp, pairs };
  }

  /** 掛載機構(手臂/觸手/喉管/砲座支柱/翼下掛架/爪/吊莢座):只建結構,不建武器本體。
   *  a.x 已含左右符號;sx = 鏡射符號(額外偏移與傾角用)。
   *  近場的件會整片糊在畫面上(實測手臂/砲座曾佔掉半個螢幕),一律夾回 NEAR_Z。
   *  NEAR_Z 從 −0.55(= 相機近裁面 0.5 的貼面)退到 −0.75:貼著近裁面的 0.26m 吊莢座
   *  在畫面上有 39% 寬(2026-07-24 實測 6.9% 遮擋 ×2),而且會被近裁面切掉一半。 */
  _cockMountStruct(mk, mount, a, sx, parent) {
    const s = a.s ?? 1.0;
    // hd = 該件自身的半深度:夾的是**近端面**不是中心。只夾中心的話,一個 0.48 深的砲座
    // 中心停在 −0.75、近面就落到 −0.51(相機近裁面 0.5),在畫面上炸成 15.9%(gorilla 實測)。
    const zb = (v, hd = 0) => Math.min(v, -0.75 - hd);
    if (mount === 'hand') {
      // 手持:前臂 → 握把,武器在手上(人形機甲 / 有手的仿生體 / 騎士)。
      // 只留「前臂 + 手」暗示持握 —— 上臂原本從畫面外斜插進來,雙持時兩隻整臂佔掉兩個下角
      // (使用者回報「手部超出太多」);前臂縮細(0.08r)貼下緣即可,識別為「手持」不需整條手臂。
      const upper = mk(new THREE.CylinderGeometry(0.08 * s, 0.1 * s, 0.42 * s, 8), 0x5b6772);
      upper.rotation.set(0.9, 0, -0.25 * sx);
      upper.position.set(a.x + 0.22 * s * sx, a.y - 0.42 * s, zb(a.z + 0.5 * s, 0.21 * s));
      parent.add(upper);
      const fore = mk(new THREE.CylinderGeometry(0.07 * s, 0.09 * s, 0.5 * s, 8), 0x4b545e);
      fore.rotation.set(1.35, 0, -0.12 * sx);
      fore.position.set(a.x + 0.1 * s * sx, a.y - 0.24 * s, zb(a.z + 0.22 * s, 0.25 * s));
      parent.add(fore);
      const hand = mk(new THREE.BoxGeometry(0.16 * s, 0.16 * s, 0.2 * s), 0x39424b);
      hand.position.set(a.x, a.y - 0.1 * s, zb(a.z + 0.02, 0.1 * s));
      parent.add(hand);
      return;
    }
    if (mount === 'tentacle') {
      // 觸手持械:多節觸手從下側卷上來握住武器(靜止也蠕動)
      let node = parent;
      for (let i = 0; i < 4; i++) {
        const seg = new THREE.Group();
        seg.position.set(i === 0 ? a.x + 0.34 * sx : 0, i === 0 ? a.y - 0.62 : 0.1, i === 0 ? zb(a.z + 0.45, 0.13) : -0.22);
        const m = mk(new THREE.CylinderGeometry(0.09 - i * 0.012, 0.11 - i * 0.012, 0.26, 7), 0x4b545e);
        m.rotation.x = Math.PI / 2;
        m.position.z = -0.1;
        seg.add(m);
        node.add(seg);
        this._flap(seg, 'x', -0.16, 0.09, 0.4, i * 0.9);   // 眼鏡蛇預備式的微蠕動
        node = seg;
      }
      return;
    }
    if (mount === 'mouth') {
      // 嘴砲:喉管從自己的口中/鼻端接出(無握把、無槍機 —— 武器就是機體的一部分)
      const throat = mk(new THREE.CylinderGeometry(0.1 * s, 0.14 * s, 0.3 * s, 8), 0x39424b);
      throat.rotation.x = Math.PI / 2;
      throat.position.set(a.x, a.y, a.z + 0.2 * s);
      parent.add(throat);
      return;
    }
    if (mount === 'back') {
      // 背載砲塔(無手仿生體/肩扛/背載加農):基座在頸背,支柱 MUST 連回畫面下緣的頸背
      // —— 否則砲塔看起來浮在空中(沒有機體接點)。
      const bz = zb(a.z + 0.4 * s, 0.17 * s);
      const base = mk(new THREE.BoxGeometry(0.28 * s, 0.2 * s, 0.34 * s), 0x46505b);
      base.position.set(a.x, a.y - 0.1 * s, bz);
      parent.add(base);
      const napeP = new THREE.Vector3(a.x * 0.8, -0.6, -0.7);            // 肩背接點(砲塔不是浮空的)
      const top = new THREE.Vector3(a.x, a.y - 0.25 * s, bz);
      const mid = napeP.clone().lerp(top, 0.5);
      const mast = mk(new THREE.CylinderGeometry(0.05 * s, 0.075 * s, napeP.distanceTo(top), 8), 0x39424b);
      mast.position.copy(mid);
      mast.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), top.clone().sub(napeP).normalize());
      parent.add(mast);
      return;
    }
    if (mount === 'wing') {
      // 機翼硬點掛架(該側單具;異型雙掛「左輕右重」由呼叫端分兩次建)
      const pylon = mk(new THREE.BoxGeometry(0.08 * s, 0.16 * s, 0.22 * s), 0x46505b);
      pylon.position.set(a.x, a.y + 0.14 * s, zb(a.z + 0.3 * s, 0.11 * s));
      parent.add(pylon);
      return;
    }
    if (mount === 'claw') {
      // 爪掛槍莢(該側單爪;翼龍雙爪 = 呼叫端左輕右重各建一次)
      const claw = mk(new THREE.CylinderGeometry(0.03 * s, 0.05 * s, 0.3 * s, 5), 0x5b6772);
      claw.rotation.z = sx * 0.35;
      claw.position.set(a.x, a.y + 0.2 * s, a.z + 0.25 * s);
      parent.add(claw);
      return;
    }
    // body:機身固定吊莢座(旋翼無人機吊艙 / 直升機短翼掛架)
    const pod = mk(new THREE.BoxGeometry(0.26 * s, 0.16 * s, 0.3 * s), 0x3d454e);
    pod.position.set(a.x, a.y + 0.1 * s, zb(a.z + 0.3 * s, 0.15 * s));
    parent.add(pod);
  }

  // ---------------- 物理:爆炸衝擊 / 碰撞 ----------------
  /** 爆炸衝擊波:把自己(座機)往外推 + 鏡頭震動。強度隨距離平方衰減、隨爆炸半徑(能量)遞增 —
   *  近炸猛烈、遠處迅速歸零;同距離下大爆炸比小爆炸更晃(符合爆壓物理直覺)。
   *  作用半徑 = 該武器攻擊半徑 r × SHAKE.BLAST_F(2026-07-23 使用者指示:震波不可無限遠傳遞),
   *  超出即完全無感 —— MUST NOT 加回固定下限或倍數放大。 */
  _applyBlast(x, y, z, r) {
    if (!this.side || this.dead) return;
    const eye = this.camera.position;
    const d = Math.hypot(eye.x - x, eye.y - y, eye.z - z);
    const R = r * SHAKE.BLAST_F;
    if (!(R > 0) || d > R) return;
    const f = 1 - d / R;
    const k = f * f;                 // 平方衰減(距離越遠震動掉得越快)
    const eScale = Math.min(1.6, Math.max(0.4, r / 12));   // 爆炸半徑代表能量:小彈少晃、重砲/主堡更晃
    const dir = new THREE.Vector3(eye.x - x, eye.y - y, eye.z - z);
    if (dir.lengthSq() < 0.01) dir.set(0, 1, 0);
    dir.normalize();
    const power = k * eScale * (this._flying() ? 55 : 26);
    this.vel.addScaledVector(dir, power);
    if (!this._flying()) this.vy = (this.vy ?? 0) + k * eScale * 10;   // 機甲被掀離地
    this.trauma = Math.min(1, this.trauma + k * eScale * 0.8);
  }

  // 單位碰撞半徑 / 高度(公尺):玩家座機不能穿過單位與建築。
  // 人員/載具 = 真實世界尺寸(見 models.js TARGET_H);英雄機體體型綁角色護甲,
  // 故不查此表,改由 heroCollider() 依 heroTargetH 動態推導(見 _makeEnt 的 ent.heroCol)。
  // **數值不手寫**:一律由 data.js 的 hitR / hitH 推導(伺服器貫穿判定同一把尺);
  // 唯主堡吃 `baseCollideR`(命中圓 + 視覺外擴,見 data.js —— 裙樓頂點貼著 r=20,機體槍械會輕微穿牆)。
  // 鍵集 = 「會擋住玩家座機」的機種,MUST NOT 隨 TARGET_R 增列而擴張(那會讓直升機/碉堡
  // 突然開始擋路);量體本身則永遠與命中判定同步。
  static COLLIDER = Object.fromEntries(
    COLLIDE_KINDS.map((kind) => [kind, kind === 'base'
      ? { r: baseCollideR('STEEL'), h: hitH({ kind, side: 'STEEL' }) }
      : { r: hitR({ kind, side: 'STEEL' }), h: hitH({ kind, side: 'STEEL' }) }]),
  );

  /** 自機機體實高(公尺):碰撞圓柱與座艙視點高度一律由它推導;超級升級同步放大 */
  get selfH() {
    if (!this.heroKind) return SOLDIER_H * 4;
    return heroTargetH(this.heroKind, this.ch) * superScaleF(isSuperSide(this.side) ? this.upg?.super : 0);
  }

  /** 目前是否為飛行機體(無人機恆飛;變形者僅飛行型態) */
  _flying() { return this.isDrone || (this.isMorph && this.flight); }

  /**
   * 這台機體的水平巡航速度(m/s;**唯一取速處** = data.js heroMobility)。
   * 三個消費端(地面移動 / 飛行推杆 / 蓄力跳彈射初速)MUST 全走這一支:
   * `UNITS[kind].speed` 是**機種基準**,少乘角色 `mods.speed`、也吃不到移速壓縮(見 SPEED_COMP)
   * ⇒ 伺服器閃避門檻(EVASION 吃 heroMobility)、平衡模型、圖鑑機動欄與腳下實際跑起來的速度
   * 會分成兩份,而這種分歧只有拿碼表量才看得出來。
   */
  _mobility(flying) {
    // 高地壓制折速(2026-08-12;見 data.js HIGH_SUP ⑤):位置是客戶端權威 ⇒ 真人這一半住這裡,
    // 電腦玩家那一半住 `bots._speed`,兩端同一支 `highSupSpeedF`;強度由伺服器快照給(hsf)。
    const sup = highSupSpeedF((this.hiSupLeft || 0) > 0 ? this.hiSupF || 0 : 0);
    return heroMobility(this.heroKind, CHARACTERS[this.ch]?.mods, flying) * sup;
  }

  /**
   * 移動輸入唯一縫:回傳 { f 前後, r 左右, mag 推杆量, boost 衝刺 }。
   * 鍵盤 WASD(±1 數位)與觸控虛擬蘑菇頭(0~1 類比)在此收束成同一組軸值 ——
   * 移動結算端(地面/飛行/觀戰三處)MUST 只讀這支,MUST NOT 各自去讀 this.keys.KeyW。
   * 蘑菇頭推到底(≥ SPRINT_MAG)等同按住 Shift;有鍵盤輸入時以鍵盤為準(桌機行為完全不變)。
   */
  _moveAxis() {
    const k = this.keys;
    let f = (k.KeyW ? 1 : 0) - (k.KeyS ? 1 : 0);
    let r = (k.KeyD ? 1 : 0) - (k.KeyA ? 1 : 0);
    let boost = !!(k.ShiftLeft || k.ShiftRight);
    const t = this.touch?.axis;
    if (!f && !r && t && t.mag > 0) { f = t.f; r = t.r; }
    const mag = Math.hypot(f, r);
    return { f, r, mag, boost };
  }

  /** 玩家是否有移動輸入(高後座重武器的「停穩才能開火」判定) */
  _moveInput() {
    const k = this.keys;
    if (k.Space || k.KeyC || k.ControlLeft) return true;
    return this._moveAxis().mag > 0.02;
  }

  /** 第三人稱的機體朝向:移動時面向移動方向,瞄準/開火/防守時面向相機視線。 */
  _stepThirdPersonBody(dt, move) {
    if (this.viewMode !== 'tps' || this.defending) {
      this.bodyYaw = this.yaw;
      return;
    }
    const moving = move.lengthSq() > 0.0004;
    const target = this.aiming || this.firing
      ? this.yaw
      : (moving ? Math.atan2(-move.x, -move.z) : null);
    if (target != null) this.bodyYaw = camAngleStep(this.bodyYaw, target, PLAYER_TPS.BODY_TURN_K, dt);
  }

  /**
   * 後座力是否仍未結束 —— 位移懲罰的**唯一**時間窗(使用者:「直到後座力結束」)。
   * 時間窗就是 `recoil.p` 這個狀態本身:準星上踢回穩到 `END_RAD` 以內即視為結束
   * (回穩是 `_updatePlayer` 的指數衰減 ⇒ 連射自然累積、停火後才逐步解除)。
   * MUST NOT 退回舊制的「到下一發窗口」計時器:那條與後座回穩無關,重武器打完一發
   * 早就恢復全速,使用者要的那段「歸零直到後座結束」根本量不到。
   */
  _recoiling() {
    return Math.abs(this.recoil.p) > RECOIL.END_RAD;
  }

  /**
   * 開火中位移懲罰係數(1 = 不受影響、0 = 移動歸零)。
   * 係數由**後座量**推導(data.js `recoilMoveF`,唯一縫),擊發當下定案存進 `_recoilMoveF0`;
   * 這裡只負責兩件事:時間窗(`_recoiling`)與飛行機體的 `AIR_F` 折扣(空中減半)。
   */
  _recoilMoveF(fly) {
    if (!this._recoiling()) return 1;
    let f = this._recoilMoveF0 ?? 1;
    if (fly && f < 1) f = 1 - (1 - f) * RECOIL.AIR_F;
    return f;
  }

  /** 招式增益倍率(伺服器 mods 快照 [k, m, remS]):同鍵取最強;查無 = 1(speed 衝鋒 / jump 大跳躍) */
  _modF(k) {
    let v = 1;
    for (const md of this.selfMods || []) if (md[0] === k && md[1] > v) v = md[1];
    return v;
  }

  /** 控場移動係數(麻痺 = 0、緩速 ×slowF)—— 與伺服器 NPC(_advance)/bot(_speed)同一套規則 */
  _ccMoveF() {
    if ((this.stunLeft || 0) > 0) return 0;
    return (this.slowLeft || 0) > 0 ? (this.slowF || 0.6) : 1;
  }

  /**
   * 控場/標記狀態的上升沿播報(比照 _empWarnAt 的自我節流模式;快照 8Hz 驅動)。
   * 上升沿同時是**致盲白幕**的觸發點(第三參數 = data.js CC_FLASH.PEAK 的鍵;省略 = 不致盲):
   * 光學/電子系狀態(EMP / 纏擾致盲 conf / 電擊麻痺 stun)才白幕,物理系不白(見 CC_FLASH)。
   */
  _ccFeed() {
    const edge = (key, left, msg, flash) => {
      const on = (left || 0) > 0;
      if (on && !this[key]) {
        this.hud.feed?.(msg);
        const peak = typeof flash === 'number' ? flash : CC_FLASH.PEAK[flash];
        if (peak) this._blindFlash(peak);
      }
      this[key] = on;
    };
    edge('_stunOn', this.stunLeft, '⛓️ 機體麻痺:動力系統離線(武器仍可運作)!', 'stun');
    edge('_slowOn', this.slowLeft, '🕸️ 機體緩速:行動遲滯!');
    edge('_confOn', this.confLeft, '💫 操縱混亂:控制訊號反轉!', 'conf');
    edge('_bleedOn', this.bleedLeft, '🩸 裝甲破口:持續失血中!');
    edge('_markOn', this.markLeft, '🎯 定位完成:下一擊必中必爆!');
    edge('_invOn', this.invLeft, '🛡️ 相位護盾:1 秒無敵!');
    edge('_empOn', this.empLeft, '⚡ 電磁干擾:武器系統離線(仍可移動)!', 'emp');
    edge('_blindOn', this.blindLeft, '💥 閃光彈:視野受阻!', VISION_BLIND.PEAK);
    edge('_unbalOn', this._unbalanced() ? 1 : 0, '⚠️ 機體失衡:攻擊命中與暴擊減半、飛行動力鎖定!');
  }

  /**
   * 觸發致盲白幕(唯一入口;peak = 該狀態致盲強度)。白幕長度固定 = ccFlashDur(),
   * 不隨狀態剩餘秒數延長(見 data.js CC_FLASH)。重疊觸發時「當下更亮者勝」——
   * 比現值暗的新狀態 MUST NOT 把正在全白的畫面打回較暗的峰值(閃到一半忽然變亮再變暗 = 假)。
   */
  _blindFlash(peak) {
    if (!(peak > 0)) return;
    if (peak >= ccFlashAlpha(this._ccFlashLeft, this._ccFlashPeak)) {
      this._ccFlashLeft = ccFlashDur();
      this._ccFlashPeak = peak;
    }
  }

  /** 致盲白幕逐幀衰減 → 推 HUD(0 = 清晰);歸零那幀仍推一次 0,之後早退不再碰 DOM */
  _updateCcFlash(dt) {
    if (this._ccFlashLeft <= 0) return;
    this._ccFlashLeft = Math.max(0, this._ccFlashLeft - dt);
    this.hud.ccFlash?.(ccFlashAlpha(this._ccFlashLeft, this._ccFlashPeak));
  }

  /** 清除致盲白幕(陣亡/重生/換座機:白幕是上一具機體的感光反應,MUST NOT 留到下一條命) */
  _clearCcFlash() {
    this._ccFlashLeft = 0; this._ccFlashPeak = 0;
    this._blindOn = false;
    this.hud.ccFlash?.(0);
  }

  /**
   * 受擊濺血(2026-08-02 使用者需求「半透明紅色濺血、位置視敵人射擊方向、傷害越高血滴越大」)。
   * 唯一觸發點 = 伺服器 `hurt` 事件(帶攻擊者座標與這一擊的實際損耗)—— 客戶端 MUST NOT 自己
   * 從血量落差猜方位(那份落差只知道「被打了」;猜出來的方向必定與伺服器分家)。
   *
   * 方位一律量**當下鏡頭**的相機空間(含後座力/震動/視野鎖定的即時姿態):
   *   bearing = atan2(右, 前) ⇒ 0 正前、±π 背後,背後中彈自然夾到畫面左右緣;
   *   elev    = 仰角,只有攻擊者也是英雄(事件帶 `ay` 絕對高程)時才算,否則畫在中線(見 sim._hurtLog)。
   * 相機矩陣 MUST 自己 invert `matrixWorld` —— `matrixWorldInverse` 是 renderer.render 才寫的
   * (與 `_coneAcquire` 同一個坑)。
   */
  _bloodSplat(ev) {
    if (this.dead || !this.side) return;
    const pool = (this.maxHp || 0) + (this.maxSp || 0);
    const frac = bloodFrac(ev.v, pool);
    if (!(frac > 0)) return;
    // 攻擊者世界座標(sim 的 z 是鏡射的,與 boom/die 等事件同一條換算)
    const ax = ev.x, az = -ev.z;
    const cam = this.camera;
    cam.updateMatrixWorld();
    const p = new THREE.Vector3(ax, ev.ay != null ? ev.ay : 0, az)
      .applyMatrix4(new THREE.Matrix4().copy(cam.matrixWorld).invert());
    const fwd = -p.z;                                  // 相機空間:−z 為前
    const bearing = Math.atan2(p.x, fwd);
    // 仰角:只有兩端都拿得到絕對高程才算(我方 = pos.y + _eyeH(),與回報伺服器的 ay 同一式)
    const elev = ev.ay != null ? Math.atan2(p.y, Math.hypot(p.x, fwd)) : 0;
    const halfV = THREE.MathUtils.degToRad(cam.fov) * 0.5;
    const halfH = Math.atan(Math.tan(halfV) * (cam.aspect || 1));
    const { u, v } = bloodScreenUv(bearing, elev, halfH, halfV);
    // 血滴:主滴在斑心,其餘依份量散開(純視覺抖動,不涉場景確定性 ⇒ Math.random 無妨);
    // 舉盾時改噴螢光閃光,滴形走 GLINT 自己的大一圈曲線(尺寸仍 ∝ 份量,見 data.js)
    const shielded = this.defending && (this.sp || 0) > 0;
    const r0 = shielded ? glintDropR(frac) : bloodDropR(frac);
    const n = bloodDropN(frac);
    const drops = [{ x: 0, y: 0, r: r0 }];
    for (let i = 1; i < n; i++) {
      const th = Math.random() * Math.PI * 2;
      const rad = Math.sqrt(Math.random()) * BLOOD.SPREAD * (0.35 + 0.65 * frac);
      drops.push({
        x: Math.cos(th) * rad, y: Math.sin(th) * rad,
        r: r0 * (0.18 + 0.42 * Math.random()),   // 衛星滴恆小於主滴
      });
    }
    // 舉盾接住那一發:不噴血,原血滴位置改噴螢光閃光(同位置、同份量、同滴形,短閃快退)
    if (shielded) {
      this._glints.push({ id: ++this._bloodSeq, u, v, drops, left: glintDur() });
      while (this._glints.length > GLINT.MAX) this._glints.shift();   // 上限:最舊的先退場
      return;
    }
    this._blood.push({ id: ++this._bloodSeq, u, v, drops, left: bloodDur() });
    while (this._blood.length > BLOOD.MAX) this._blood.shift();   // 上限:最舊的先退場
  }

  /** 濺血逐幀衰減 → 推 HUD(空陣列 = 全部退場);清空那幀仍推一次,之後早退不再碰 DOM */
  _updateBlood(dt) {
    if (!this._blood.length) {
      if (!this._bloodOn) return;
      this._bloodOn = false;
      this.hud.blood?.([]);
      return;
    }
    for (const b of this._blood) b.left -= dt;
    this._blood = this._blood.filter((b) => b.left > 0);
    this._bloodOn = true;
    this.hud.blood?.(this._blood.map((b) => ({
      id: b.id, u: b.u, v: b.v, drops: b.drops, a: bloodAlpha(b.left),
    })));
  }

  /** 螢光閃光逐幀衰減 → 推 HUD(與 _updateBlood 同一條早退/DOM 節約契約,見 main.js hud.glint) */
  _updateGlint(dt) {
    if (!this._glints.length) {
      if (!this._glintOn) return;
      this._glintOn = false;
      this.hud.glint?.([]);
      return;
    }
    for (const g of this._glints) g.left -= dt;
    this._glints = this._glints.filter((g) => g.left > 0);
    this._glintOn = true;
    this.hud.glint?.(this._glints.map((g) => ({
      id: g.id, u: g.u, v: g.v, drops: g.drops, a: glintAlpha(g.left),
    })));
  }

  /** 清除濺血(陣亡/重生/換座機:血漬留在上一具機體的座艙玻璃上,MUST NOT 跟著視野搬過來) */
  _clearBlood() {
    this._blood.length = 0;
    this._bloodOn = false;
    this.hud.blood?.([]);
    this._glints.length = 0;   // 閃光同是螢幕空間殘留,同理不跟著視野搬過來
    this._glintOn = false;
    this.hud.glint?.([]);
  }

  /**
   * 扇形武器彈著演出(散彈 / 電漿):沿射向水平張開 def.arc 半角,佐以少量垂直散布 =
   * 真散彈的圓形彈著。散彈 = 動能彈丸(細短曳光、密);電漿 = 焰舌(粗長、稀)。命中判定在伺服器。
   */
  _fanBlast(muzzle, dir, def, rng = def.range) {
    const up = new THREE.Vector3(0, 1, 0);
    const right = new THREE.Vector3().crossVectors(dir, up).normalize();
    const half = (def.arc || 15) * Math.PI / 180;
    const plasma = def.type === 'plasma';
    const col = CHARACTERS[def.ch]?.visual?.hue ?? (plasma
      ? (this.side === 'SWARM' ? 0xffcf7f : 0x7fe8ff)
      : (this.side === 'SWARM' ? 0xffe08a : 0xbfe6ff));
    const blades = plasma ? 7 : 9;
    const wF = 1, rF = 1;
    this._muzzleBurst(muzzle, plasma, this.side);   // 電漿重武器槍口爆(明顯度)
    // 離子吐息主噴流(哥吉拉式;使用者指定參考):錐狀噴口 + 螺旋纏繞能量帶(只表範圍錐形)。
    // 主噴流走中央格射程(×FAN_RANGE_CENTER_F),與 heroPlasma 逐格結算同界。
    if (plasma) {
      const core = this._shotCols(this.side).hot;
      const clip = this._clipBeam(muzzle, muzzle.clone().addScaledVector(dir, rng * rF * 0.82 * FAN_RANGE_CENTER_F));
      ionBreath(this.scene, this.effects, muzzle, clip.to, col,
        { r: 2.2 * wF, ttl: 0.45, coil: 3, core, def });
      shockRing(this.scene, this.effects, muzzle.x, muzzle.y, muzzle.z, 2.6 * wF, core);
    }
    for (let i = 0; i < blades; i++) {
      const f = blades === 1 ? 0 : (i / (blades - 1)) * 2 - 1;          // −1..1 橫向
      const dk = dir.clone()
        .applyAxisAngle(up, half * f)
        .applyAxisAngle(right, half * 0.5 * (Math.random() * 2 - 1));   // 垂直散布 = 圓形彈著
      // 每條火舌走自己方位的逐格射程:中央 ×1.1、邊緣 ×1.0 線性(與 fanBinRangeF 同式),與結算同界
      const binF = 1 + (FAN_RANGE_CENTER_F - 1) * (1 - Math.abs(f));
      const len = rng * rF * binF * (plasma ? 0.7 + Math.random() * 0.3 : 0.85 + Math.random() * 0.15);
      const end = muzzle.clone().addScaledVector(dk, len);
      const clip = this._clipBeam(muzzle, end);   // 自機扇形彈舌同樣止於障礙面(彈著花打在牆上)
      beamLine(this.scene, this.effects, muzzle, clip.to, col, plasma ? { ttl: 0.24, w: 0.16 * wF } : { ttl: 0.12, w: 0.07 * wF });
      starburst(this.scene, this.effects, clip.to.x, clip.to.y, clip.to.z, plasma ? 3 : 1.5, col);
    }
  }

  /**
   * 這一幀「有碰撞量體的單位」清單(NPC 兵團 / 敵方英雄 / 阻擋型障礙),形狀 { x, z, r, base, top }。
   * **掃掠與 push-out MUST 吃同一份名冊**(各自掃一次 `ents` 就是兩份實作,遲早挑到不同的單位 ——
   * 症狀是「衝過去那一下穿過小兵,停下來才被推開」)。垂直帶判定 `myBot < top − 0.1 && myTop > base`
   * 與伺服器 `sim._solidsNear` 的 `span()` 逐字同式:兩端各寫一份 = 真人撞得到、電腦穿得過(A30 家族)。
   */
  _unitSolids(myBot, myTop) {
    const out = [];
    for (const ent of this.ents.values()) {
      if (ent.isSelf || !ent.mesh.visible) continue;
      // 自己的僚機不碰撞:歸隊時牠們以 50m/s 貼上來,會誤觸下面的高速撞擊自爆
      if (ent.hero && ent.pid != null && ent.pid === this.youId) continue;
      let c = ent.heroCol || BattleClient.COLLIDER[ent.kind];
      if (!c && ent.colR) c = { r: ent.colR, h: ent.colH || 6 };   // 阻擋型障礙物
      if (!c) continue;
      const p = ent.mesh.position;
      const base = p.y, top = p.y + c.h;
      if (myBot >= top - 0.1 || myTop <= base) continue;   // 垂直不重疊(ε 與伺服器 _solidsNear 同值)
      out.push({ x: p.x, z: p.z, r: c.r, base, top });
    }
    return out;
  }

  /**
   * 圓柱 push-out(**唯一實作**;逐行鏡射伺服器 `solidPush` 的圓柱分支):機體圓盤與圓柱重疊時
   * 沿圓心→機體推出,並吃掉衝向它的速度分量(不回彈)。推出點落在外緣 + PUSH_EPS(見 data.js:
   * 貼邊靜止 + 掃掠起點判定合起來會穿牆)。回傳這一趟有沒有真的動到。
   */
  _pushOutCircle(cx, cz, cr, myR) {
    const dx = this.pos.x - cx, dz = this.pos.z - cz;
    const d = Math.hypot(dx, dz);
    const min = myR + cr;
    if (d >= min || d === 0) return false;
    const nx = dx / d, nz = dz / d;
    this.pos.x += nx * (min - d + PUSH_EPS);
    this.pos.z += nz * (min - d + PUSH_EPS);
    const into = this.vel.x * nx + this.vel.z * nz;
    if (into < 0) { this.vel.x -= into * nx; this.vel.z -= into * nz; }
    return true;
  }

  /**
   * 圓柱掃掠(**唯一實作**;逐行鏡射伺服器 `solidEnter` 的圓柱分支):位移 (ax,az)→(bx,bz) 是否
   * **單幀橫越**這根圓柱;回進入參數 t ∈ (0,1],否則 null。起點已在圓內 → 交給 push-out 脫出;
   * 終點落在圓內的「近半」(fwd < 0)→ 交給 push-out 沿邊滑(手感不變),遠半才夾在進入面。
   */
  _circleEnter(cx, cz, cr, ax, az, bx, bz, myR) {
    const dx = bx - ax, dz = bz - az;
    const len2 = dx * dx + dz * dz;
    if (len2 < 1e-9) return null;
    const R = cr + myR;
    const ox = ax - cx, oz = az - cz;
    if (ox * ox + oz * oz <= R * R) return null;                    // 起點已在圓內 → push-out 脫出
    const e1x = bx - cx, e1z = bz - cz;
    const fwd = e1x * dx + e1z * dz;
    if (e1x * e1x + e1z * e1z <= R * R && fwd < 0) return null;     // 終點在圓內近半 → push-out 沿邊滑
    const c = ox * ox + oz * oz - R * R;
    const B2 = 2 * (ox * dx + oz * dz);
    const disc = B2 * B2 - 4 * len2 * c;
    if (disc < 0) return null;
    const t0 = (-B2 - Math.sqrt(disc)) / (2 * len2);
    return (t0 > 0 && t0 <= 1) ? t0 : null;
  }

  /**
   * 玩家 vs 單位/建築:水平量體碰撞(考慮飛行高度,飛過塔頂不碰撞)。
   * 流程 = 收名冊(`_unitSolids` + `terrain.blockers`)→ 掃掠(單幀橫越夾在進入面)→ push-out
   * 交錯收斂;與伺服器 `sim.solidResolve` 逐段同構(兩端 MUST NOT 只改一邊)。
   */
  _collide(px0, pz0) {
    const fly = this._flying();
    // 碰撞量體:與伺服器的 bot 碰撞(sim.solidResolve)MUST 同吃 selfCollider —— 兩端各寫一份
    // 半徑/垂直帶就是「真人撞得到、電腦穿得過」(2026-08-02 使用者定案「碰撞法則一律一樣」)
    const col = selfCollider(this.selfH, fly);
    const myR = col.r;
    const myBot = this.pos.y + col.bot;
    const myTop = this.pos.y + col.top;
    // 單位(NPC/敵機/阻擋型障礙)與世界障礙走**同一套**流程:先掃掠、再交錯 push-out。
    // 舊制單位只做 push-out(而且排在掃掠之前、自成一段迴圈)—— 「掃掠與 push-out 缺一不可」
    // 對建物成立、對單位一樣成立:擊退/蓄力跳/掉幀那一幀的位移動輒數公尺 ≫ 一名步兵的直徑,
    // 終點早就落在另一側 ⇒ 整台機體從小兵/戰車/敵方機甲身上穿過去(使用者回報的破圖),
    // 而伺服器那半(`sim.solidResolve`)一向是掃掠 + push-out ⇒ 兩端分家(A30 家族)。
    const units = this._unitSolids(myBot, myTop);
    // 圖資建物(biomes 客戶端幾何,全房間同一 OSM 來源 → 各端一致):
    // 純推擠不結算傷害,伺服器權威不受影響;無人機可飛越屋頂
    // 站在高架橋面上時,橋面「下方」街廓的建物(基座低於腳下一截)不推擠 —— 高架路飛越街廓,
    // 否則橋下高樓的碰撞柱垂直涵蓋橋面高度 → 走在橋上會被橋下建物側推撞下橋(#INC 高架橋掉橋)。
    const surfHere = this._surf(this.pos.x, this.pos.z, this.pos.y);
    // onDeck = 真的站在高架橋面(deck ribbon 上,查 deckY 對得上站立面),不是任何「高於地表
    // 的站立面」—— 站障礙物頂(建物/神木/巨岩,2026-07-22 起可站)時 MUST NOT 吃橋面豁免,
    // 否則「基座低於腳下 3m」的鄰樓(含更高的樓)全部不推擠 = 從屋頂側向走進鄰棟破圖
    const dkY = this.terrain.deckY?.(this.pos.x, this.pos.z, 3.0, surfHere - .6, surfHere + .6);
    const onDeck = surfHere > this.terrain.heightAt(this.pos.x, this.pos.z) + 1.0
      && dkY != null && Math.abs(surfHere - dkY) < 0.6;
    this._surfHere = surfHere; this._onDeck = onDeck;   // 供 _cameraDeClip 共用(免重算)

    // 掃掠防穿透(2026-07-23):高速擊退 / 掉幀大 dt 會讓本幀位移「終點」落在障礙另一側 —— push-out
    // 只查終點重疊,穿到另一側就偵測不到 → 破圖穿透。先沿位移 P0(px0,pz0)→P1(pos)掃掠,夾在「首個
    // 真正被橫越(P0/P1 皆在外、線段進入)障礙」的前緣;正常慢速貼牆(終點落在障礙內)不觸發,交由
    // 下方 push-out 沿牆滑。與 push-out 共用同一垂直閘 + onDeck 豁免。px0/pz0 缺(舊呼叫)則跳過。
    if (px0 != null) this._sweepBlockers(px0, pz0, surfHere, onDeck, myR, myBot, myTop, units);

    // push-out:密集街廓單趟推擠可能把機體從 A 推進 B(殘留重疊)→ 至多 3 趟收斂(穩定即止)。
    // 單位 MUST 與世界障礙**同一趟交錯**收斂(舊制單位自成一段迴圈跑在最前面 = 只解一次)。
    // **順序刻意是「先單位、後世界障礙」**:擠得下時兩者都滿足、順序無關;擠不下時(小兵把機體
    // 頂在牆面上,而牆與小兵之間根本不夠一台機體寬)最後一趟說了算 ⇒ MUST 讓世界幾何贏。
    // 陷進 NPC 只是兩個模型交疊,陷進建物是**鏡頭看穿牆面**的破圖(而且爬不出來)。
    for (let pass = 0; pass < 3; pass++) {
      let moved = false;
      for (const u of units) if (this._pushOutCircle(u.x, u.z, u.r, myR)) moved = true;
      const blockers = this._blockersNear ? this._blockersNear(this.pos.x, this.pos.z, myR + 15) : (this.terrain.blockers || []);
      for (const b of this.terrain.blockers ? blockers : []) {
        if (onDeck && b.y < surfHere - 3) continue;   // 橋下街廓建物:玩家在橋面上,不推擠
        // myBot 貼在頂面(surfaceAt mount 站上頂)不側推 —— 與橋墩「柱頂封底緣」同一課(biomes 2668);
        // ε 0.1 併吞原嚴格不等式的 myBot > top 分支
        if (myBot >= b.y + b.h - 0.1 || myTop < b.y) continue;
        // broad-phase 半徑 MUST 用**外接**(對角 hypot)非 max(內切):與 `_buildBlockGrid` 登記半徑
        // 同一把尺。旋轉盒的牆角落在 max 之外、hypot 之內 —— 用 max 會誤判「太遠」而跳過,
        // 倒退撞牆角直接穿進建物、之後每幀在盲區/可見區邊界來回抖動 = 卡在裡面出不來
        // (前科見 `_cameraDeClip` 同一條註;`b.r` 可能是 0.8× 內切近似,一律以 hypot 為準)。
        const maxR = (b.hw2 != null ? Math.hypot(b.hw2, b.hd2) : b.r) + myR;
        if (Math.abs(this.pos.x - b.x) > maxR || Math.abs(this.pos.z - b.z) > maxR) continue;
        if (b.hw2 != null) {
          // 建物 = 有向盒推擠(圓柱內切於盒角 → 斜向進入會鑽進盒角破圖;改用真實盒面 + 機體半徑外擴)
          const cs = b._cs ?? Math.cos(b.ry), sn = b._sn ?? -Math.sin(b.ry);   // 有向盒 local 軸:three Euler(0,ry,0) 的反解(sn 取 −sin)
          const rx = this.pos.x - b.x, rz = this.pos.z - b.z;
          const lx = rx * cs + rz * sn, lz = -rx * sn + rz * cs;   // world→local(繞 -ry)
          const ex = b.hw2 + myR, ez = b.hd2 + myR;                // Minkowski 近似:盒面外擴機體半徑
          if (Math.abs(lx) >= ex || Math.abs(lz) >= ez) continue;  // 盒外
          const px = ex - Math.abs(lx), pz = ez - Math.abs(lz);    // 各軸穿透深度 → 沿最小穿透軸推出
          let dlx = 0, dlz = 0;
          if (px < pz) dlx = lx < 0 ? -(px + PUSH_EPS) : px + PUSH_EPS; else dlz = lz < 0 ? -(pz + PUSH_EPS) : pz + PUSH_EPS;
          const dwx = dlx * cs - dlz * sn, dwz = dlx * sn + dlz * cs;   // local→world(繞 +ry)
          this.pos.x += dwx; this.pos.z += dwz; moved = true;
          const nl = Math.hypot(dwx, dwz) || 1, nx = dwx / nl, nz = dwz / nl;
          const into = this.vel.x * nx + this.vel.z * nz;
          if (into < 0) { this.vel.x -= into * nx; this.vel.z -= into * nz; }
          continue;
        }
        // 撞神木/巨岩/橋墩:圓柱 push-out(與單位共用同一支 —— 兩份實作就是兩套推擠規則)
        if (this._pushOutCircle(b.x, b.z, b.r, myR)) moved = true;
      }
      if (!moved) break;
    }
  }

  /**
   * 掃掠防穿透:沿本幀水平位移 P0(px0,pz0)→P1(this.pos)檢查機體圓盤(半徑 myR)是否「單幀橫越」
   * 任一障礙。push-out 只查終點重疊,故高速擊退 / 掉幀大 dt 穿到另一側時偵測不到 → 破圖。此處求「首個
   * 真正被橫越(P0 與 P1 皆在障礙外、進入參數 ∈(0,1])障礙」的進入點,夾住 pos 於其前緣(留 SKIN),
   * 吃掉沿位移方向的速度;隨後 push-out 解殘留 + 切向。終點落在障礙內(正常慢速貼牆)不觸發 → 手感不變。
   * 垂直閘 / onDeck 豁免與 push-out 同式;幾何式與 _blockerHitT / 盒推擠一致(圓柱 & 有向盒各一條)。
   * `units`(`_unitSolids` 的同一份名冊)一併掃:小兵/戰車/敵方機甲的直徑遠小於一次擊退的位移,
   * 少了這一段就是「衝過去那一下整台穿過去」——與伺服器 `solidResolve` 把 ents 和碰撞柱一起掃同判。
   */
  _sweepBlockers(px0, pz0, surfHere, onDeck, myR, myBot, myTop, units = []) {
    const dx = this.pos.x - px0, dz = this.pos.z - pz0;
    const len2 = dx * dx + dz * dz;
    if (len2 < 1e-4) return;                          // 幾乎沒位移 → 交給 push-out
    const len = Math.sqrt(len2);
    const SKIN = 0.3;                                 // 停在前緣再退一截,免貼面
    let bestT = Infinity;
    const minX = Math.min(px0, this.pos.x), maxX = Math.max(px0, this.pos.x);
    const minZ = Math.min(pz0, this.pos.z), maxZ = Math.max(pz0, this.pos.z);
    const sweepR = Math.max(len, myR + 15);
    const midX = (px0 + this.pos.x) * 0.5, midZ = (pz0 + this.pos.z) * 0.5;
    const sweepBlockers = this._blockersNear ? this._blockersNear(midX, midZ, sweepR) : (this.terrain.blockers || []);
    for (const b of this.terrain.blockers ? sweepBlockers : []) {
      if (onDeck && b.y < surfHere - 3) continue;
      if (myBot >= b.y + b.h - 0.1 || myTop < b.y) continue;
      // broad-phase 半徑與 push-out 同式(外接 hypot —— 見上;兩處 MUST NOT 只改一處)。
      const maxR = (b.hw2 != null ? Math.hypot(b.hw2, b.hd2) : b.r) + myR;
      if (b.x < minX - maxR || b.x > maxX + maxR || b.z < minZ - maxR || b.z > maxZ + maxR) continue;
      let tEnter = null;
      // 終點在障礙「內」時的取捨(fwd = (P1−中心)·位移):近半(fwd<0)push-out 沿中心→P1 反向推 =
      // 退回進入側 → 交給 push-out 沿牆滑(手感不變);遠半(fwd≥0)push-out 會把機體推出「另一側」
      // = 半穿透,故此處夾在進入面。終點在外(fwd 恆 >0 的真穿越)一律夾。
      // **fwd === 0(終點剛好落在通過中心的那個平面)歸「遠半」**:此時最小穿透軸的推出符號
      // 由 `lx<0 ? … : …` 決定,正中央那一刀等機率推向另一側 = 直接穿過去(2026-08-02 稽核
      // 以合成方牆逐位元復現;伺服器 `solidEnter` MUST 同步,兩端 MUST NOT 只改一邊)。
      // (圓柱那半的同一條規則住 `_circleEnter`,此處是有向盒版)
      if (b.hw2 != null) {
        const fwd = (this.pos.x - b.x) * dx + (this.pos.z - b.z) * dz;
        const cs = b._cs ?? Math.cos(b.ry), sn = b._sn ?? -Math.sin(b.ry);   // 有向盒 local 軸:three Euler(0,ry,0) 的反解(sn 取 −sin)
        const ex = b.hw2 + myR, ez = b.hd2 + myR;
        const o0x = (px0 - b.x) * cs + (pz0 - b.z) * sn, o0z = -(px0 - b.x) * sn + (pz0 - b.z) * cs;
        if (Math.abs(o0x) < ex && Math.abs(o0z) < ez) continue;    // P0 已在盒內 → push-out 脫出
        const p1x = (this.pos.x - b.x) * cs + (this.pos.z - b.z) * sn;
        const p1z = -(this.pos.x - b.x) * sn + (this.pos.z - b.z) * cs;
        if (Math.abs(p1x) < ex && Math.abs(p1z) < ez && fwd < 0) continue;   // 終點在盒內近半 → push-out 沿牆滑
        const ux = dx * cs + dz * sn, uz = -dx * sn + dz * cs;     // 位移轉盒 local
        let tmin = -Infinity, tmax = Infinity, ok = true;
        if (Math.abs(ux) < 1e-9) { if (o0x < -ex || o0x > ex) ok = false; }
        else {
          let t1 = (-ex - o0x) / ux, t2 = (ex - o0x) / ux; if (t1 > t2) { const s = t1; t1 = t2; t2 = s; }
          if (t1 > tmin) tmin = t1; if (t2 < tmax) tmax = t2;
        }
        if (ok) {
          if (Math.abs(uz) < 1e-9) { if (o0z < -ez || o0z > ez) ok = false; }
          else {
            let t1 = (-ez - o0z) / uz, t2 = (ez - o0z) / uz; if (t1 > t2) { const s = t1; t1 = t2; t2 = s; }
            if (t1 > tmin) tmin = t1; if (t2 < tmax) tmax = t2;
          }
        }
        if (ok && tmax >= tmin && tmin > 0 && tmin <= 1) tEnter = tmin;
      } else {
        // 圓柱(神木/巨岩/橋墩):與單位共用同一支掃掠(兩份實作 = 兩套穿透規則)
        tEnter = this._circleEnter(b.x, b.z, b.r, px0, pz0, this.pos.x, this.pos.z, myR);
      }
      if (tEnter != null && tEnter < bestT) bestT = tEnter;
    }
    for (const u of units) {
      const t = this._circleEnter(u.x, u.z, u.r, px0, pz0, this.pos.x, this.pos.z, myR);
      if (t != null && t < bestT) bestT = t;
    }
    if (bestT === Infinity) return;                    // 無穿越
    const t = Math.max(0, bestT - SKIN / len);         // 夾在前緣(留 skin,不越回 P0 之前)
    this.pos.x = px0 + dx * t;
    this.pos.z = pz0 + dz * t;
    const ux = dx / len, uz = dz / len;                // 吃掉沿位移方向(正面撞牆)的速度
    const into = this.vel.x * ux + this.vel.z * uz;
    if (into > 0) { this.vel.x -= into * ux; this.vel.z -= into * uz; }
  }

  /**
   * 相機防穿模(純視覺,不動 pos/vel/權威狀態):第一人稱鏡頭掛在機體「頭艙」= pos 前方 headF 處,
   * _collide 只把 pos 擋在障礙圓柱外,鏡頭仍會戳進建物/神木/巨岩等障礙內看穿牆面(破圖)。
   * 此處沿「pos→鏡頭」水平軸把鏡頭拉回柱體外緣(留 SKIN 餘裕,絕不拉到 pos 後方 → pos 已被 _collide
   * 擋在 myR 外,退回 pos 必在牆外)。與 _collide 用同一份 blockers/colliders,牆面判定一致。
   */
  _cameraDeClip() {
    const cam = this.camera.position;
    const ox = this.pos.x, oz = this.pos.z, camY = cam.y;
    const dx = cam.x - ox, dz = cam.z - oz;
    const dlen = Math.hypot(dx, dz);
    if (dlen < 1e-3) return;
    const ux = dx / dlen, uz = dz / dlen;
    const SKIN = 1.2;                       // near(0.5)+餘裕:障礙外緣再退一截,免貼面破圖
    let maxT = dlen;                        // 鏡頭相對 pos 的前伸量上限(不超過原本 headF 水平量)
    // 射線 P(t)=pos+t·u 進入圓柱(半徑 R,水平圓)的最小 t(較小根);pos 在柱內 → 縮回 pos(t=0)
    const clamp = (cx, cz, cr) => {
      const R = cr + SKIN;
      const ex = ox - cx, ez = oz - cz;
      const proj = ex * ux + ez * uz;
      const c = ex * ex + ez * ez - R * R;
      if (c <= 0) { maxT = 0; return; }      // pos 已在柱內(理論上不會)
      const disc = proj * proj - c;
      if (disc <= 0) return;                 // 射線不進柱體
      const t = -proj - Math.sqrt(disc);
      if (t > 0 && t < maxT) maxT = t;
    };
    // 有向盒版(建物):射線在盒 local frame 走 slab 求進入 t(盒外擴 SKIN);pos 已在盒內 → 縮回 pos
    const clampBox = (b) => {
      const cs = b._cs ?? Math.cos(b.ry), sn = b._sn ?? -Math.sin(b.ry);   // 有向盒 local 軸:three Euler(0,ry,0) 的反解(sn 取 −sin)
      const olx = (ox - b.x) * cs + (oz - b.z) * sn, olz = -(ox - b.x) * sn + (oz - b.z) * cs;
      const ulx = ux * cs + uz * sn, ulz = -ux * sn + uz * cs;
      const ex = b.hw2 + SKIN, ez = b.hd2 + SKIN;
      if (Math.abs(olx) < ex && Math.abs(olz) < ez) { maxT = 0; return; }
      let tmin = -Infinity, tmax = Infinity;
      if (Math.abs(ulx) < 1e-9) { if (olx < -ex || olx > ex) return; }
      else {
        let t1 = (-ex - olx) / ulx, t2 = (ex - olx) / ulx; if (t1 > t2) { const s = t1; t1 = t2; t2 = s; }
        if (t1 > tmin) tmin = t1; if (t2 < tmax) tmax = t2;
      }
      if (Math.abs(ulz) < 1e-9) { if (olz < -ez || olz > ez) return; }
      else {
        let t1 = (-ez - olz) / ulz, t2 = (ez - olz) / ulz; if (t1 > t2) { const s = t1; t1 = t2; t2 = s; }
        if (t1 > tmin) tmin = t1; if (t2 < tmax) tmax = t2;
      }
      if (tmax < tmin || tmax < 0) return;   // 射線不進盒體(或盒在後方)
      const t = tmin > 0 ? tmin : 0;
      if (t < maxT) maxT = t;
    };
    const onDeck = this._onDeck, surfHere = this._surfHere ?? this._surf(ox, oz, this.pos.y);
    const midCamX = (ox + cam.x) * 0.5, midCamZ = (oz + cam.z) * 0.5;
    const deClipBlockers = this._blockersNear(midCamX, midCamZ, dlen + 25);
    for (const b of deClipBlockers) {
      if (onDeck && b.y < surfHere - 3) continue;                       // 站橋面上:橋下街廓不處理(高架飛越)
      if (camY < b.y || camY > b.y + b.h) continue;                     // 垂直不重疊
      // broad-phase 半徑 MUST 用**外接**(對角 hypot)非 max(內切):貼牆角時 pos 在盒對角外緣,
      // 用 max 會誤判「太遠」而跳過 → 牆面過(pos 近盒面)但牆角漏(前科:撞牆角仍破圖)
      const rr = b.hw2 != null ? Math.hypot(b.hw2, b.hd2) : b.r;
      const maxDist = dlen + rr + SKIN + 1;
      if (Math.abs(ox - b.x) > maxDist || Math.abs(oz - b.z) > maxDist) continue;
      if (Math.hypot(ox - b.x, oz - b.z) > maxDist) continue;  // broad-phase:太遠不可能戳到
      if (b.hw2 != null) clampBox(b); else clamp(b.x, b.z, b.r);
      if (maxT <= 0) break;
    }
    if (maxT > 0) for (const ent of this.ents.values()) {
      if (!ent.colR || ent.isSelf) continue;                            // 阻擋型障礙(危險區/防空/中繼)
      const p = ent.mesh.position, ch = ent.colH || 6;
      if (camY < p.y || camY > p.y + ch) continue;
      if (Math.hypot(ox - p.x, oz - p.z) > dlen + ent.colR + SKIN + 1) continue;
      clamp(p.x, p.z, ent.colR);
      if (maxT <= 0) break;
    }
    if (maxT < dlen) { cam.x = ox + ux * maxT; cam.z = oz + uz * maxT; }
    // 真 3D 拉回詳見 _cameraPullSegment(第三人稱全擋修復):錨點取機體中段,
    // 與 _updateViewOcclusion 的取樣高度同一條(約 0.55h)。
    this._cameraPullSegment(ox, this.pos.y + (this.viewMode === 'tps' ? this.selfH * 0.55 : this._eyeH()), oz);
  }

  /**
   * 真 3D 線段拉回(純視覺,不動 pos/vel/權威狀態):水平版只看 camY 會漏掉
   * 「低處機體→高處鏡頭」斜穿盒側/頂角的情形,且丘陵/橋板不在 blockers 內,
   * 鏡頭卡進物件內部或被隔開時就是整個畫面全擋。
   * 沿「錨點→鏡頭」用 _blockerHitT(與彈道同一把尺)再夾一次,並沿線取樣
   * _surf(地形∪橋面唯一縫;terrain.mesh 絕不進 raycaster)防丘陵擋視線。
   * 只往錨點方向拉,錨點已被 _collide 擋在障礙外,絕不推出去。
   */
  _cameraPullSegment(ax, ay, az) {
    const cam = this.camera.position;
    const dx = cam.x - ax, dy = cam.y - ay, dz = cam.z - az;
    const len = Math.hypot(dx, dy, dz);
    if (len < 1e-3) return;
    let f = 1;
    if (this._blockerHitT) {
      const hit = this._blockerHitT(ax, ay, az, cam.x, cam.y, cam.z);
      if (hit != null) f = Math.min(f, Math.max(0, (hit - 1.8) / len));
    }
    if (typeof this._surf === 'function') {
      const N = Math.max(2, Math.min(12, Math.ceil(len / 4)));
      for (let i = 1; i <= N; i++) {
        const t = i / N;
        const px = ax + dx * t, py = ay + dy * t, pz = az + dz * t;
        let s = null;
        try { s = this._surf(px, pz, py); } catch (e) { s = null; }
        if (s == null || !Number.isFinite(s)) continue;
        if (py < s + 1.5) { f = Math.min(f, Math.max(0, (i - 1) / N - 0.02)); break; }
      }
    }
    if (f < 1) { cam.x = ax + dx * f; cam.y = ay + dy * f; cam.z = az + dz * f; }
  }

  /** 註冊第三人稱視線可淡化的 Mesh;描邊旗標與碰撞旗標彼此獨立。 */
  _registerViewOccluders(root) {
    root?.traverse?.((o) => {
      if (!o.isMesh || this._viewOcclusionSkip.has(o)
        || o.userData?.isOutline || o.userData?.noViewOcclusion) return;
      const mats = Array.isArray(o.material) ? o.material : [o.material];
      if (!mats.some((m) => m && !m.transparent)) return;
      if (this._viewOcclusionSet.has(o)) return;
      this._viewOcclusionSet.add(o);
      this._viewOcclusionMeshes.push(o);
    });
  }

  /** 移除短命單位的視線候選,並把其可能殘留的淡化材質還原。 */
  _unregisterViewOccluders(root) {
    const gone = [];
    const descendants = new Set();
    root?.traverse?.((o) => descendants.add(o));
    for (const o of descendants) {
      if (this._viewOcclusionSet.has(o)) gone.push(o);
      this._restoreViewFade(o);                  // 描邊殼不在 raycast 名冊,仍要還原
    }
    for (const o of gone) {
      this._viewOcclusionSet.delete(o);
    }
    if (gone.length) this._viewOcclusionMeshes = this._viewOcclusionMeshes.filter((o) => !gone.includes(o));
  }

  _isViewDescendant(o, root) {
    for (let p = o; p; p = p.parent) if (p === root) return true;
    return false;
  }

  /** 將命中的 Mesh 與其描邊殼一起換成獨立半透明材質,不污染共用材質。
   *  每件獨立 clone(逐件透明度動畫互不干擾);k = 目前淡化係數(0 不透明 → 1 全淡),
   *  由 _stepViewFade 每幀快進慢出推進,掠過射線邊緣時停在半透明不閃爍。 */
  _fadeViewMesh(mesh, now) {
    if (!mesh?.isMesh || this._viewOcclusionSkip.has(mesh)) return;
    const fade = (o) => {
      if (!o.isMesh || this._viewFades.has(o)) return;
      const base = o.material;
      const mats = Array.isArray(base) ? base : [base];
      const items = [];
      const faded = mats.map((m) => {
        if (!m || m.transparent) return m;
        const c = m.clone();
        c.transparent = true;
        c.opacity = m.opacity ?? 1;
        c.depthWrite = false;
        c.needsUpdate = true;
        items.push({ c, o: m.opacity ?? 1 });
        return c;
      });
      if (!items.length) return;
      o.material = Array.isArray(base) ? faded : faded[0];
      this._viewFades.set(o, { base, faded: o.material, items, lastHit: now, k: 0 });
    };
    fade(mesh);
    mesh.traverse?.((o) => { if (o.userData?.isOutline) fade(o); });
  }

  _restoreViewFade(mesh) {
    const state = this._viewFades.get(mesh);
    if (!state) return;
    if (mesh.material === state.faded) mesh.material = state.base;
    for (const it of state.items || []) it.c.dispose?.();
    this._viewFades.delete(mesh);
  }

  /** 每幀推進淡化透明度(快進慢出):命中保留窗內 → 目標全淡,否則 → 目標不透明;
   *  完全恢復才換回原材質。描邊殼各有獨立 state,與本體同受 refresh,不會先跳回。 */
  _stepViewFade(now) {
    if (!this._viewFades.size) { this._viewFadePrev = now; return; }
    const p = this._viewFadePrev ?? now;
    const dt = Math.min(0.1, Math.max(0, now - p));
    this._viewFadePrev = now;
    if (dt <= 0) return;
    for (const [mesh, state] of [...this._viewFades]) {
      const want = (now - state.lastHit <= TPS_OCCLUSION.RELEASE_S) ? 1 : 0;
      const rate = want > state.k ? TPS_OCCLUSION.FADE_IN_K : TPS_OCCLUSION.FADE_OUT_K;
      state.k += Math.max(-rate * dt, Math.min(rate * dt, want - state.k));
      const f = 1 - (1 - TPS_OCCLUSION.OPACITY_F) * state.k;
      for (const it of state.items) it.c.opacity = it.o * f;
      if (want === 0 && state.k <= 0) this._restoreViewFade(mesh);
    }
  }

  _clearViewOcclusion() {
    for (const mesh of [...this._viewFades.keys()]) this._restoreViewFade(mesh);
    this._viewOcclusionNext = 0;
    this._viewFadePrev = 0;
  }

  /**
   * 第三人稱相機完成定位後,從相機向機體包圍盒取 9 條視線。
   * 命中的不透明 Mesh 進透明佇列且停止寫深度,因此機體仍可穿透讀取。
   */
  _updateViewOcclusion(now) {
    if (this.viewMode !== 'tps' || !this.side || this.dead) {
      this._clearViewOcclusion();
      return;
    }
    this._stepViewFade(now);   // 透明度每幀推進(射線檢測仍低頻);掠邊時停在半透明不閃
    if (now < this._viewOcclusionNext) return;
    this._viewOcclusionNext = now + TPS_OCCLUSION.UPDATE_S;
    const self = [...this.ents.values()].find((ent) => ent.isSelf && ent.mesh?.visible && !ent.dead);
    if (!self || !this._viewOcclusionMeshes.length) {
      this._clearViewOcclusion();
      return;
    }

    this.camera.updateMatrixWorld(true);
    self.mesh.updateWorldMatrix(true, true);
    const box = this._tpsBox || (this._tpsBox = new THREE.Box3());
    box.makeEmpty();
    self.mesh.traverse((o) => {
      if (!o.isMesh || o.userData?.teamRing || o.userData?.isOutline || o.userData?.noOutline) return;
      box.expandByObject(o);
    });
    if (box.isEmpty()) {
      this._clearViewOcclusion();
      return;
    }
    const size = box.getSize(this._tpsSize || (this._tpsSize = new THREE.Vector3()));
    const center = box.getCenter(this._tpsCenter || (this._tpsCenter = new THREE.Vector3()));
    const right = (this._tpsRight || (this._tpsRight = new THREE.Vector3())).set(1, 0, 0).applyQuaternion(this.camera.quaternion);
    right.y = 0;
    if (right.lengthSq() < 1e-6) right.set(1, 0, 0); else right.normalize();
    const span = Math.max(0.25, Math.max(size.x, size.z) * 0.45);
    const y0 = box.min.y, h = Math.max(size.y, this.selfH, 0.5);
    const targets = this._tpsTargets || (this._tpsTargets = [
      new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3(),
      new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3(),
    ]);
    targets[0].set(center.x, y0 + h * 0.52, center.z);
    targets[1].set(center.x, y0 + h * 0.80, center.z);
    targets[2].set(center.x, y0 + h * 0.22, center.z);
    targets[3].set(center.x, y0 + h * 0.52, center.z).addScaledVector(right, span);
    targets[4].set(center.x, y0 + h * 0.52, center.z).addScaledVector(right, -span);
    targets[5].set(center.x, y0 + h * 0.80, center.z).addScaledVector(right, span);
    targets[6].set(center.x, y0 + h * 0.80, center.z).addScaledVector(right, -span);
    targets[7].set(center.x, y0 + h * 0.22, center.z).addScaledVector(right, span);
    targets[8].set(center.x, y0 + h * 0.22, center.z).addScaledVector(right, -span);

    const eye = this.camera.position;
    const camDist = eye.distanceTo(center);

    // 空間快篩: 僅對相機至角色連線鄰近 (camDist + span + 20m) 的候選 Mesh 做射線檢測
    // 消除對全地圖數千個模型進行逐面碰撞與矩陣計算的重大掉幀
    const cand = this._tpsCandMeshes || (this._tpsCandMeshes = []);
    cand.length = 0;
    const midX = (eye.x + center.x) * 0.5, midZ = (eye.z + center.z) * 0.5;
    const maxRange = (camDist * 0.5) + span + 20;
    const maxRangeSq = maxRange * maxRange;
    const allMeshes = this._viewOcclusionMeshes;
    for (let i = 0; i < allMeshes.length; i++) {
      const m = allMeshes[i];
      if (!m.visible) continue;
      const el = m.matrixWorld.elements;
      const dx = el[12] - midX, dz = el[14] - midZ;
      if (dx * dx + dz * dz > maxRangeSq) continue;
      cand.push(m);
    }

    const blocked = this._tpsBlocked || (this._tpsBlocked = new Set());
    blocked.clear();
    const delta = this._tpsDelta || (this._tpsDelta = new THREE.Vector3());

    if (cand.length) {
      for (let i = 0; i < targets.length; i++) {
        const target = targets[i];
        delta.copy(target).sub(eye);
        const dist = delta.length();
        if (dist <= 0.2) continue;
        delta.normalize();
        this._viewRaycaster.set(eye, delta);
        this._viewRaycaster.near = 0.05;
        this._viewRaycaster.far = Math.max(0.05, dist - 0.05);
        const hits = this._viewRaycaster.intersectObjects(cand, false);
        for (const hit of hits) {
          if (hit.distance >= dist - 0.05) break;
          const mesh = hit.object;
          if (!mesh.isMesh || this._isViewDescendant(mesh, self.mesh)) continue;
          blocked.add(mesh);
        }
        // 反向再掃一次:眼在物件內部時,正向打到的是出口內壁(FrontSide 背面剔除 ⇒ 零命中),
        // 反向(機體→眼)打到的是入口外壁(正面),才能把罩住鏡頭的那一件淡化。
        delta.copy(eye).sub(target);
        delta.normalize();
        this._viewRaycaster.set(target, delta);
        this._viewRaycaster.near = 0.05;
        this._viewRaycaster.far = Math.max(0.05, dist - 0.05);
        const hitsR = this._viewRaycaster.intersectObjects(cand, false);
        for (const hit of hitsR) {
          if (hit.distance >= dist - 0.05) break;
          const mesh = hit.object;
          if (!mesh.isMesh || this._isViewDescendant(mesh, self.mesh)) continue;
          blocked.add(mesh);
        }
      }
    }
    for (const mesh of blocked) {
      this._fadeViewMesh(mesh, now);
      const state = this._viewFades.get(mesh);
      if (state) state.lastHit = now;
      // 描邊殼各有獨立 state:一併 refresh,否則殼會比本體早跳回不透明(閃爍)
      mesh.traverse?.((o) => {
        if (o.userData?.isOutline) {
          const s = this._viewFades.get(o);
          if (s) s.lastHit = now;
        }
      });
    }
  }

  // ---------------- 輸入 ----------------
  _initInput() {
    this._onKey = (e) => {
      // ESC:**遊戲中隨時**都叫得出 / 收得回戰場選單(2026-08-01 使用者需求「遊戲中隨時都可以 esc」)。
      // MUST 排在 `paused` 早退與 `this.side` 分支**之前** —— 交戰中、觀戰、陣亡倒數、選單已開著、
      // 以及**指標還沒鎖定**的那些時刻(剛進場還沒點畫面、剛從選單回來、重生後尚未重新鎖定)
      // 全部同一條路,唯一出口 = `_escMenu()`(與觸控 ☰ 同縫)。
      // 指標**鎖定中**的那顆 ESC 會被瀏覽器吃掉(keydown 不派發)⇒ 由解鎖事件 `_onPlc` 接手,
      // 故兩條路都要留;重複觸發由 `_escMenu` 的去彈跳窗擋掉。
      if (e.type === 'keydown' && e.code === 'Escape') { this._escMenu(); return; }
      if (this.paused) return;   // 戰場選單開啟:凍結其餘輸入(keys 已清空 ⇒ 機體停住)
      // 小地圖顯示範圍切換:純顯示層,**不設 this.side 門檻**(觀戰同樣看小地圖),
      // 也不受陣亡限制(倒數中看戰況正是要用的時候)。觸控版走十字鍵右(_cmd('map'))。
      if (e.type === 'keydown' && e.code === 'KeyM') this._toggleMmMode();
      if (e.type === 'keydown' && this.side) {
        // 商店不受死亡限制:陣亡等待重生也能買升級(DOTA 慣例)
        if (e.code === 'KeyB') this._toggleShop();
        if (!this.dead) {
          if (e.code === 'KeyQ') this._castAbility('def');   // 守招
          if (e.code === 'KeyE') this._castAbility('atk');     // 攻招
          if (e.code === 'KeyR') this._startReload();
          if (e.code === 'KeyF') this._toggleDefense();        // 防守姿態(正面生成磁力護盾)
          // 平民互動(靠近平民時 HUD 顯示提示):G 要求跟隨 / H 驅趕
          if (e.code === 'KeyG') this._civAct('follow');
          if (e.code === 'KeyH') this._civAct('away');
        }
        // 三機小隊:V 循環切換主視野、1~3 直選(陣亡中也能切到存活的僚機)
        if (this.isDrone) {
          if (e.code === 'KeyV') this._swapDrone(null);
          const n = /^Digit([123])$/.exec(e.code);
          if (n) this._swapDrone(Number(n[1]) - 1);
        }
      }
      // 觀戰視角切換:F 循環四種視角(上帝 → 第一人稱 → 第三人稱跟隨 → 第三人稱自由)、
      // Q/E 名冊前後換人。這三顆在交戰中另有他用(招式/裝填),故一律關在 side=null 分支內。
      if (e.type === 'keydown' && !this.side && !this.paused) {
        if (e.code === 'KeyF') this._specCycleView();
        if (e.code === 'KeyQ') this._specFollow(-1);
        if (e.code === 'KeyE') this._specFollow(1);
      }
      // ── 全鍵盤操作:方向鍵 = WASD 移動 ──────────────────────────────
      // 寫入對應的 KeyW/S/A/D,讓 _moveAxis() 正常消費;不另開分支。
      const _AK = { ArrowUp: 'KeyW', ArrowDown: 'KeyS', ArrowLeft: 'KeyA', ArrowRight: 'KeyD' };
      if (_AK[e.code]) this.keys[_AK[e.code]] = e.type === 'keydown';
      // ── 全鍵盤操作:數字鍵盤 +/- = 滾輪;* = 左鍵開火;/ = 右鍵招式 ──
      if (e.type === 'keydown') {
        // +/- 直接複用 _onWheel 邏輯(節流已在 _lastWheelAimAt 內部處理)
        if (e.code === 'NumpadAdd')      this._onWheel({ deltaY: -1, preventDefault() {} });
        if (e.code === 'NumpadSubtract') this._onWheel({ deltaY:  1, preventDefault() {} });
        // * 開火(守衛與 _onMouseDown 相同)
        if (e.code === 'NumpadMultiply' && !this.touch && this.side && !this.dead && !this.shopOpen)
          this.firing = true;
        // / 右鍵招式
        if (e.code === 'NumpadDivide' && !this.touch) this._rmbDown();
      }
      if (e.type === 'keyup') {
        if (e.code === 'NumpadMultiply') this.firing = false;
        if (e.code === 'NumpadDivide')   this._rmbUp();
      }
      this.keys[e.code] = e.type === 'keydown';
    };
    window.addEventListener('keydown', this._onKey);
    window.addEventListener('keyup', this._onKey);

    this._onMouseMove = (e) => {
      if (document.pointerLockElement !== this.canvas) return;
      this._applyLook(-e.movementX * 0.0023, -e.movementY * 0.0023);
    };
    document.addEventListener('mousemove', this._onMouseMove);

    this._onMouseDown = (e) => {
      if (this.touch) return;                       // 觸控版:相容用滑鼠事件不參與(避免與觸控層雙送)
      if (this.shopOpen) return;
      // **觀戰也要鎖指標**:自由視角的轉向唯一來源是鎖定後的 mousemove;
      // 順帶讓觀戰的 ESC 與交戰時同一條路(解鎖 → `_onPlc` → 戰場選單)。
      if (document.pointerLockElement !== this.canvas) { this.canvas.requestPointerLock(); return; }
      if (!this.side) return;                       // 觀戰沒有座機:鎖了指標也不開火/不瞄準
      if (e.button === 0) this.firing = true;
      if (e.button === 2) this._rmbDown();
    };
    this._onMouseUp = (e) => {
      if (this.touch) return;
      if (e.button === 0) this.firing = false;
      if (e.button === 2) this._rmbUp();
    };
    this.canvas.addEventListener('mousedown', this._onMouseDown);
    window.addEventListener('mouseup', this._onMouseUp);
    this._onCtx = (e) => e.preventDefault();
    this.canvas.addEventListener('contextmenu', this._onCtx);

    // 滾輪:觀戰縮放視野;交戰切換狙擊鏡(FOV ← UNITS[kind].zoomFov)
    this._onWheel = (e) => {
      if (this.paused) return;
      e.preventDefault();
      if (!this.side) {
        const f = e.deltaY > 0 ? SPEC_CAM.FOV_STEP : 1 / SPEC_CAM.FOV_STEP;
        this._specFov = Math.max(SPEC_CAM.FOV_MIN, Math.min(SPEC_CAM.FOV_MAX, this._specFov * f));
        return;
      }
      if (this.dead || this.shopOpen) return;
      const now = performance.now() / 1000;
      if (now - this._lastWheelAimAt < 0.15) return;
      this._lastWheelAimAt = now;
      this._setAiming(!this.aiming);
    };
    this.canvas.addEventListener('wheel', this._onWheel, { passive: false });

    // 戰場選單:指標鎖定 = 交戰;解鎖(ESC / 切走視窗)= 跳出暫停選單(繼續 / 離開)。
    // 用 pointerlockchange 而非 ESC keydown —— 指標鎖定時瀏覽器會吃掉那顆 ESC 的 keydown。
    this._onPlc = () => {
      if (this.touch) return;                       // 觸控版無指標鎖定:選單一律走 ☰ 鈕(_cmd('menu'))
      const locked = document.pointerLockElement === this.canvas;
      if (locked) {
        this._everLocked = true;
        this._plcSelf = false;
        if (this.paused) this._setPaused(false);
      } else if (this._plcSelf) {
        // **我方主動解鎖**(陣亡過場的 exitPointerLock)不是玩家按的 ESC ⇒ 吃掉這一次事件。
        // 用戳記而非 `!this.dead` 條件:後者會把**陣亡倒數中真的按下的那顆 ESC** 一起擋掉 ——
        // 陣亡頁是 `pointer-events: none`,玩家隨手一點畫面就重新鎖上指標,那顆 ESC 的 keydown
        // 會被瀏覽器吃掉、只剩這條解鎖路,於是「倒數中按 ESC 沒反應」(2026-08-02 使用者回報)。
        this._plcSelf = false;
      } else if (this._everLocked && !this.shopOpen && !this._gameOver && !this.paused) {
        // 走 `_escMenu`(而非直接 `_setPaused`)= 順手蓋上去彈跳戳記:若瀏覽器**接著**又補送
        // 同一顆 ESC 的 keydown,那顆會被擋掉,不會把剛開的選單立刻關回去。
        this._escMenu();
      }
    };
    document.addEventListener('pointerlockchange', this._onPlc);

    // 觸控版(手機/平板):建虛擬蘑菇頭 + 動作鈕 + 陀螺儀。輸入一律經 _applyLook/_moveAxis/_cmd
    // 三個共用縫,MUST NOT 讓 mobile.js 直接改 yaw/keys/firing(見 mobile.js 檔頭)。
    // 操作方式選「不限定」時戰鬥中可切換 ⇒ 建/毀都走 `_applyCtrlScheme`,MUST NOT 在此另寫一次。
    this._applyCtrlScheme();
    this._offCtrl = onCtrlChange(() => this._applyCtrlScheme());
  }

  /**
   * 操作方式落地:依 `ctrlmode.js` 的結論建立或銷毀虛擬搖桿層。
   * 進場時呼叫一次;「不限定」時玩家在設定頁切換也回到這裡(限定模式根本不會發事件 ——
   * `setCtrlScheme` 對非 any 一律拒絕,這就是「遊戲中不可變更」的落點,MUST NOT 在此再判一次)。
   */
  _applyCtrlScheme() {
    const pad = isTouchUI();
    if (pad === !!this.touch) return;
    if (pad) {
      document.exitPointerLock?.();     // 搖桿層與指標鎖定互斥(鎖著的話滑鼠事件會與觸控雙送)
      this.touch = new TouchControls(this);   // 建構子自己會 setKind + syncBlocked(選單開著就整層收起,A19)
    } else {
      this.touch.dispose();
      this.touch = null;
    }
  }

  /**
   * 視角套用唯一縫(弧度增量)。滑鼠 movement、數字九宮格、觸控拖曳、視角搖桿、
   * 陀螺儀、觀戰自由視角全部共用 ——
   * 俯仰夾制與水平/垂直方向反轉只准住這裡,MUST NOT 在各輸入端各做一次。
   * 系統驅動(視野鎖定自動追瞄)走 system=true 繞過反轉:反轉只反使用者手,不反系統。
   */
  _applyLook(dYaw, dPitch, system = false) {
    let ix = 1, iy = 1;
    if (!system) {
      ix = lookPref('invertX') ? -1 : 1;
      iy = lookPref('invertY') ? -1 : 1;
    }
    this.yaw += dYaw * ix;
    this.pitch = Math.max(-1.45, Math.min(1.45, this.pitch + dPitch * iy));
  }

  /**
   * 數字九宮格持續按住 → 每幀以 dt 驅動視角,效果等同滑鼠 movementX/Y。
   * 4 左 / 6 右偏航;8 上 / 2 下俯仰;斜向鍵 1/3/7/9 同時改兩軸。
   * 正向定義與滑鼠一致:右移向右、上移抬頭。方向反轉由 _applyLook 統一處理。
   * 俯仰夾制由 _applyLook 統一處理,此處不重複夾。
   */
  _tickNumpadLook(dt) {
    if (this.paused) return;
    const k = this.keys;
    const dYaw   = (k.Numpad4 ?  1 : 0) + (k.Numpad6 ? -1 : 0)
                 + (k.Numpad7 ?  1 : 0) + (k.Numpad9 ? -1 : 0)
                 + (k.Numpad1 ?  1 : 0) + (k.Numpad3 ? -1 : 0);
    const dPitch = (k.Numpad8 ?  1 : 0) + (k.Numpad2 ? -1 : 0)
                 + (k.Numpad7 ?  1 : 0) + (k.Numpad1 ? -1 : 0)
                 + (k.Numpad9 ?  1 : 0) + (k.Numpad3 ? -1 : 0);
    if (!dYaw && !dPitch) return;
    const LOOK_SPEED = 1.4;   // rad/s;與 mousemove 0.0023 px⁻¹ 等效的手感速率
    this._applyLook(dYaw * LOOK_SPEED * dt, dPitch * LOOK_SPEED * dt);
  }

  /** 右鍵按下:直接施放招式(一般模式 = 守招 / 狙擊模式 = 攻招,見 _fireHoldAbility)。 */
  _rmbDown() {
    if (!this.side || this.dead || this.shopOpen) return;
    this._fireHoldAbility();
  }

  /** 右鍵放開 */
  _rmbUp() {
    this._rmbDownAt = 0;
    this._rmbAbilityFired = false;
  }

  /**
   * 動作派發唯一縫(act 名稱 + 按下/放開)。觸控鈕全部走這裡,與鍵盤/滑鼠共用同一組方法 ——
   * MUST NOT 讓觸控層自行呼叫 _castAbility/_toggleShop 等內部方法(兩套操作分家就是 bug)。
   * 按住型:fire / aim / jump / dive / sprint;點擊型:其餘(down=true 才動作)。
   */
  _cmd(act, down) {
    // 戰場選單:與鍵盤 ESC 同一個出口(`_escMenu`)—— 兩套操作 MUST NOT 各判一次「該不該開」
    if (act === 'menu') { if (down) this._escMenu(); return; }
    if (this.paused) return;
    // 小地圖顯示範圍:純顯示層,觀戰/陣亡皆可切(與 KeyM 同一條件,見 _initInput)
    if (act === 'map') { if (down) this._toggleMmMode(); return; }
    // 純移動類:觀戰自由視角也要能升降/加速(_updateSpectator 讀同一組 keys)
    if (act === 'jump') { this.keys.Space = !!down; return; }
    if (act === 'dive') { this.keys.KeyC = !!down; return; }
    if (act === 'sprint') { this.keys.ShiftLeft = !!down; return; }
    // 視野鎖定(觸控 ZR 按住):純客戶端視角輔助,MUST 排在 `dead` 閘**之前**受理 ——
    // 與 firing 同一族的按住型旗標,陣亡瞬間的放開事件若被吃掉,重生後視角會自己黏著目標。
    // 實際收斂與索敵住 `_tickViewLock`(那裡另有 dead/paused/shopOpen 閘)。
    if (act === 'lock') {
      this._vlockHold = !!down;
      if (down) this._vlockNext = true;    // 按一次 = 輪替到視野內的下一個敵人(即刻生效,並回饋一次)
      else this._vlockId = null;           // 放開只清「現在鎖著誰」;輪替錨點 `_vlockPrev` MUST 留著
      return;
    }
    // 觀戰視角(觸控):十字鍵左(絕招位)= 循環四種視角、⇄(換機位)= 換下一位玩家。
    // 與鍵鼠 F / Q・E 共用 `_specCycleView` / `_specFollow` 兩個縫;鈕面字由 mobile.js setKind 換。
    if (!this.side) {
      if (down && act === 'special') this._specCycleView();
      if (down && act === 'swap') this._specFollow(1);
      return;
    }
    // 商店不受死亡限制:陣亡等待重生也能買升級(DOTA 慣例),與 KeyB 同條件
    if (act === 'shop') { if (down) this._toggleShop(); return; }
    if (this.shopOpen) return;
    if (act === 'swap') { if (down && this.isDrone) this._swapDrone(null); return; }   // 陣亡中也能切存活僚機
    if (this.dead) { this.firing = false; return; }
    switch (act) {
      case 'fire': this.firing = !!down; break;
      case 'aim': if (down) this._setAiming(!this.aiming); break;
      case 'def': if (down) this._castAbility('def'); break;
      case 'atk': if (down) this._castAbility('atk'); break;
      case 'reload': if (down) this._startReload(); break;
      // 招式鈕(十字鍵左):與「長按右鍵 / 長按 R」同一個派發縫(_fireHoldAbility)——
      // 一般模式放守招、狙擊模式放攻招,MUST NOT 在此另寫一次模式判斷
      case 'special': if (down) this._fireHoldAbility(); break;
      case 'civFollow': if (down) this._civAct('follow'); break;
      case 'civAway': if (down) this._civAct('away'); break;
      default: break;
    }
  }

  /**
   * ESC / ☰ 的**唯一出口**(2026-08-01 使用者需求「遊戲中隨時都可以 esc」)。
   * 三個來源共用:鍵盤 keydown(`_onKey`)、指標鎖定解除(`_onPlc`)、觸控 ☰(`_cmd('menu')`)——
   * MUST NOT 在任何一端另寫「這個狀態該不該開選單」的條件,散成第二份實作就會出現
   * 「某個時刻按了沒反應」(前科:未鎖定指標的交戰玩家、剛重生還沒點畫面時 ESC 全無效)。
   *
   * 兩條規則:
   *   ① 疊層**逐層退出** —— 商店開著先收商店,再按一次才是戰場選單(退出順序符合直覺)。
   *   ② 其餘一律**切換**戰場選單 —— 交戰/觀戰(side=null)/陣亡倒數/選單已開著皆同。
   * 唯一不受理的是分出勝負(`_gameOver`,結束頁獨佔;與 `_setPaused` 同判)。
   */
  _escMenu() {
    if (this._gameOver) return;
    // 去彈跳:指標鎖定中的那顆 ESC,瀏覽器先解鎖(`_onPlc` 已開選單),部分瀏覽器**還會**
    // 補送 keydown ⇒ 沒這道窗就是「開了又立刻關」。同一顆 ESC 只准生效一次。
    const now = performance.now() / 1000;
    if (now - (this._escAt || -1e9) < ESC_GAP_S) return;
    this._escAt = now;
    if (this.shopOpen) { this._toggleShop(false); return; }
    this._setPaused(!this.paused);
  }

  /**
   * 戰場選單開關;伺服器持續模擬(多人不是真暫停),此處只凍結本機輸入 + 叫出選單。
   * **觀戰(side=null)同樣受理**(2026-07-31 使用者需求「觀戰也可以按 ESC」)——
   * 觀戰者需要「離開戰場」這個出口,MUST NOT 再加回 `!this.side` 早退。
   */
  _setPaused(on) {
    if (this._gameOver) return;
    this.paused = on;
    if (on) {
      this.keys = {}; this.firing = false;
      this.touch?.reset();      // 觸控:放掉所有按住中的鈕(選單蓋住後收不到 pointerup 會卡住)
      this.hud.pause?.(true);
      document.exitPointerLock?.();
    } else {
      this.hud.pause?.(false);
      // 陣亡倒數中「繼續」= 回到陣亡頁(不需鎖定指標);存活時才重新鎖定進入交戰
      // 觸控版無指標鎖定(改由觸控層直接吃事件),不必也不能鎖
      if (!this.dead && !this.touch) this.canvas?.requestPointerLock?.();
    }
  }

  /**
   * 目標像素比。低功耗模式夾到 1;否則桌機上限 2、**觸控裝置上限 1.5**。
   * (旗標唯一真相 = mobile.js lowPower(),手機預設開)
   *
   * 為什麼觸控要另夾:手機 devicePixelRatio 普遍 2.5~3.5,舊版 `min(dpr, 2)` 在高功耗模式下
   * 等於每幀算 4 倍於邏輯解析度的像素,再疊上 MSAA 的解析頻寬 —— 行動 GPU 是**填充率/頻寬**
   * 瓶頸而非三角形瓶頸,這正是「高功耗模式很 lag」的直接原因。1.5 對 5~6 吋螢幕已足夠銳利。
   */
  _dpr() {
    if (lowPower()) return 1;
    const dpr = window.devicePixelRatio || 1;
    return Math.min(dpr, isTouchUI() ? TOUCH_DPR_MAX : 2);
  }
  /** 設定頁「低功耗模式」即時套用(main.js 已寫入 localStorage,此處只重設像素比與尺寸)*/
  setLowPower() { this._applyRes(); }

  /** 像素比落地的唯一出口:天花板 `_dpr()` × 動態縮放 `_resScale`(桌機恆為 1)*/
  _applyRes() {
    this.renderer.setPixelRatio(this._dpr() * this._resScale);
    this.pipeline?.setResScale?.(this._resScale);
    this._onResize();
  }

  /**
   * 畫面複雜度取樣(0~1):聚合 WebGL 繪製呼叫數、三角形數、同場實體與粒子特效壓力。
   * 供 DRS(_tickResGov)在畫面複雜度飆升且幀率下滑時加速降解析度穩幀。
   */
  _sceneComplexity() {
    const ren = this.renderer?.info?.render;
    return drsComplexity({
      calls: ren?.calls || 0,
      triangles: ren?.triangles || 0,
      entities: this.ents?.size || 0,
      effects: (this.effects?.length || 0) + (this.bullets?.length || 0) + (this._visShells?.length || 0),
    }, RES_GOV);
  }

  /**
   * 動態解析度調節器(DRS,**全平台**;每幀餵入未夾制的原始幀時與畫面複雜度)。
   * 規則:結合畫面複雜度加權後的 EMA 幀時 > HI_MS 動態降階(重度複雜度 + 嚴重掉幀可跨雙階、縮短觀察窗)、
   * < 複雜度調變後之 LO_MS 升一階;降階只受 HOLD_S 節流(掉幀要快救),
   * 升階吃指數退避(升上去 FAIL_S 內又被打回 ⇒ 冷卻翻倍),避免在 GPU 能力邊界反覆震盪。
   * 尖峰幀(GC / 載入 / 分頁切回的補償幀)不入帳 —— 調節器只回應穩態負載。
   * 退避仍壓不住(方向反轉累計 FLIP_MAX 次)⇒ **永久熄火**,停在當下那一階。
   *
   * 分頁在背景時 MUST NOT 入帳:`requestAnimationFrame` 在背景分頁停擺,切回來的第一幀
   * 幀時是整段背景時間 —— 那一幀被 SPIKE_MS 濾掉,但緊接著的幾幀(重新編譯/貼圖回填)
   * 是真的慢而且不代表穩態負載,會白白吃掉一階。
   */
  _tickResGov(ms, now) {
    const g = this._resGov;
    if (!g || g.off || !(ms > 0) || ms > RES_GOV.SPIKE_MS) return;
    if (typeof document !== 'undefined' && document.hidden) return;
    const complexity = this._sceneComplexity();
    g.complexity = complexity;
    const effMs = drsEffectiveMs(ms, complexity, RES_GOV);
    g.ema += (effMs - g.ema) * RES_GOV.EMA;
    if (now - g.last < drsHoldS(g.ema, complexity, RES_GOV)) return;
    let dir = 0;
    if (g.ema > RES_GOV.HI_MS && this._resScale > RES_GOV.MIN) {
      const stepDown = drsStepDown(g.ema, complexity, RES_GOV);
      this._resScale = Math.max(RES_GOV.MIN, +(this._resScale - stepDown).toFixed(2));
      if (now - g.raiseAt < RES_GOV.FAIL_S) g.cool = Math.min(RES_GOV.COOL_MAX, g.cool * 2);
      dir = -1;
    } else if (g.ema < drsRecoverLoMs(complexity, RES_GOV) && this._resScale < 1 && now - g.last >= g.cool) {
      this._resScale = Math.min(1, +(this._resScale + RES_GOV.STEP).toFixed(2));
      g.raiseAt = now;
      dir = 1;
    } else return;
    // 震盪熄火:只數**方向反轉**(連續同向是在收斂,不是震盪)。熄火後停在當下這一階,
    // MUST NOT 回彈到 1 —— 那一階正是量測認可撐得住的那一階。
    if (g.dir !== 0 && dir !== g.dir) g.flips++;
    g.dir = dir;
    if (g.flips >= RES_GOV.FLIP_MAX) g.off = true;
    g.last = now;
    g.ema = (RES_GOV.HI_MS + RES_GOV.LO_MS) / 2;   // 調整後重新量測(舊均值屬於舊解析度)
    this._applyRes();
  }

  // ---------------- 快照同步 ----------------
  onSnap(m) { this._snapQueue = m; }

  _applySnap(m) {
    this.envFx?.syncSurface(m.weatherSurface, m.weatherScars);
    if (m.mb) this._syncMapBuildings(m.mb);
    // 日夜時鐘對錶(權威 = 伺服器經過秒數):平常只把本地那份**拉向**快照值,
    // 差太多(斷線重連 / 分頁背景化很久)才直接貼上。硬貼每一格的話,快照的整數量化
    // 會讓太陽每 1/8 秒抖一下(48× 速率下那是可見的)。
    if (typeof m.time === 'number') {
      const d = m.time - this._simT;
      this._simT = Math.abs(d) > 3 ? m.time : this._simT + d * 0.25;
    }
    // 陣營小兵強化等級(伺服器權威;每側每兵線一個整數)—— MUST 在 ents 迴圈之前落地,
    // 商店重繪簽章要讀得到本快照的值。
    if (m.cu) this.creepUpg = m.cu;
    // 攻堅開放階段(劇情戰役才發;伺服器權威 —— 客戶端 MUST NOT 自己數還剩幾座塔)。
    // 斷線重連補快照時 HUD 也拿得到正確的目標,不必靠「開場一定是第 0 階」猜。
    // 快照 8Hz ⇒ 只在**變動時**上拋(每幀重繪進度條 = 每秒 8 次 innerHTML,純浪費)
    if (m.sg) {
      const sig = `${m.sg.SWARM}/${m.sg.STEEL}`;
      this.siegeOpen = m.sg;
      if (sig !== this._sgSig) { this._sgSig = sig; this.onSiegeTrack?.(m.sg); }
    }
    const seen = new Set();
    for (const e of m.ents) {
      seen.add(e.id);
      let ent = this.ents.get(e.id);
      if (!ent) {
        // 開場分幀建模:自機(主視野接管不能等)與靜態工事(戰場地標)立即建,其餘排隊由
        // _drainSpawnPend 每幀限量建 —— 首包 ~200 隻不同一幀全建,避免開場長凍結。
        // 純表現層排程,權威狀態不受影響(A1 相容);tgt/hp 等欄位在建模幀由最新快照回填。
        const selfHero = HERO_KINDS.has(e.k) && e.pid != null && e.pid === this.youId && !!e.act;
        const statik = e.k === 'tower' || e.k === 'base' || e.k === 'bunker';
        if (selfHero || statik) ent = this._spawnEnt(e);
        else { this._spawnPend.set(e.id, e); continue; }
      }
      if (!ent) continue;
      // 受擊回饋二分(純表現層):無護盾一律火光濺射 + 點煙(含塔/主堡/雜兵,走 _victimHitFx);
      // 工事舊制閃 hex 殼,讀感像護盾 ⇒ 不再閃殼(網格留著,平時不可見)。英雄見下方舉盾分流。
      const prevHpSnap = ent.hp;
      if (e.hp < prevHpSnap && !HERO_KINDS.has(e.k)) this._victimHitFx(ent, false);
      ent.hp = e.hp; ent.max = e.m;
      if (!ent.collapsed && sceneDamageProfile(ent.kind)) {
        const stage = sceneDamageStage(e.hp, e.m, !!e.col);
        if (stage < 3 || (ent.hero && e.dead)) {
          if (stage > ent.sceneStage) sceneDamageBurst(this.scene, this.effects, ent, stage);
          applySceneDamage(ent, stage);
        }
      }
      ent.lk = !!e.lk;   // 攻堅鎖血:這一座打不動(範圍光暈把它排除,見 _updateRangeGlows)
      // 場景物件坍塌(伺服器權威 col 旗標):傾倒為低矮殘骸,只做一次
      if (e.col && ent.neutral && !ent.collapsed) this._applyCollapse(ent, false);
      syncLightningScorch(ent, !!e.charred);
      ent.tgt.set(e.x, 0, -e.z);           // 模擬 z=北 → three z=南
      if (e.k === 'heli') ent.heroY = e.y ?? 0;   // 攻擊直升機巡航高度(共用英雄的高度渲染欄位)
      // 第三方步槍兵駐守碉堡:人在工事裡,機體隱藏(出堡的快照會把 gar 拿掉 → 復現)
      if (!ent.hero && !ent.decoy && !ent.isStatic) { ent.gar = !!e.gar; ent.mesh.visible = !e.gar; if (ent.aura) ent.aura.visible = ent.mesh.visible; }
      if (e.k === 'decoy') {
        ent.heroY = e.y ?? 0;
        ent.ry = e.ry ?? 0;
        ent.lost = !!e.lost;
      }
      if (e.k === 'kami') { ent.heroY = e.y ?? 0; ent.ry = e.ry ?? 0; }
      // 極音速飛彈:方位/高度全由伺服器給(彈道在 sim._tickHypers 走完),客戶端只插值 + 補俯仰姿態
      if (e.k === 'hyper') { ent.heroY = e.y ?? 0; ent.ry = e.ry ?? 0; }
      if (e.k === 'civilian') { ent.fo = !!e.fo; ent.fl = !!e.fl; }   // 跟隨/逃離旗標(頭頂提示)
      // 第三方碉堡進視野 = 情報永久留存:記位置(量化去重),小地圖離開視野後仍標示。
      // MUST 存 three 世界座標(z = −e.z);_world2mm 與其他標記(ent.mesh.position / this.pos)同框,
      // 舊版直接存 sim 的 e.z 未翻軸 → 標記畫在 Z 鏡像位置(看似「離開後就不見」)。
      if (e.k === 'bunker') { const bz = -e.z; this._seenBunkers.set(`${Math.round(e.x)},${Math.round(bz)}`, { x: e.x, z: bz, side: e.s }); }
      if (HERO_KINDS.has(e.k)) {
        ent.heroY = e.y ?? 0;
        ent.ry = e.ry ?? 0;
        ent.rx = e.rx ?? 0;
        ent.si = e.si || 0;
        ent.act = !!e.act;   // 主視野機(三機小隊只有一架):觀戰玩家視角的跟隨名冊只收它
        // 受擊二分:舉盾且護盾水位下降 = 打在盾上 → 小火光 + 護盾劇烈發光(舊峰值 ×1.6,封頂 2.5);
        // 裝甲掉血(穿盾/盾空/沒舉盾) = 無護盾 → 火光濺射 + 點煙(與工事/雜兵同一支 _victimHitFx)。
        const _spDrop = (e.sp != null && ent.sp != null) ? ent.sp - e.sp : 0;
        if (!!e.df && (e.sp ?? 0) > 0 && _spDrop > 0) {
          ent.shieldMesh?.userData.hit?.(Math.min(2.5, shieldHitStrength(_spDrop) * 1.6));
          this._victimHitFx(ent, true);
        } else if (e.hp < prevHpSnap) {
          this._victimHitFx(ent, false);
        }
        ent.sp = e.sp ?? 0; ent.maxSp = e.msp ?? 0;   // 磁力(血條玻璃藍段;所有英雄機體都送)
        ent.df = !!e.df;
        // NPC BOSS 段位(有這一格 = 這是 BOSS):血條外圍光暈顏色與體型縮放由它決定。
        // 純表現層 —— 段位本身、狂暴化、恢復規則全在伺服器(見 sim._bossSync)。
        ent.bossSeg = e.bs;
        if (e.bs != null || (this.cfg?.defSide && ent.side === this.cfg.defSide && ent.hero)) {
          ent.isBoss = true;
        }
        if (ent.bossSeg != null && ent.mesh) ent.mesh.scale.setScalar(bossScaleF(ent.bossSeg));
        // 超級體型:升級即時放大(只在等級變動時重設,平時不碰 —— 每幀 setScalar 會髒掉矩陣快取)
        if (e.sv != null && e.sv !== ent.sv && ent.mesh) ent.mesh.scale.setScalar(superScaleF(e.sv));
        ent.sv = e.sv ?? ent.sv ?? 0;
        ent.inv = e.iv || 0;   // 無敵幀剩餘秒(伺服器完全免傷 → 本地命中回饋改跳 -0,不誤導)
        // 觀戰玩家資訊面板(2026-08-02 使用者需求「會顯示該玩家所有資訊,包括商店升級」):
        // 這些欄位**伺服器本來就發**(見 sim._serializeEnt 的 o.act 區塊),客戶端只是留存下來 ——
        // 一律照抄快照,MUST NOT 在觀戰端自算任何一項(A1)。只在觀戰時留存:交戰中沒有消費端。
        if (!this.side && e.act) {
          ent.mp = e.mp ?? 0; ent.mm = e.mm ?? 1;
          ent.money = e.$ ?? 0; ent.kn = e.kn ?? 0;
          ent.up = e.up || ent.up; ent.ab = e.ab || ent.ab; ent.cds = e.cds || ent.cds;
          if (e.chg) ent.chg = e.chg;
          ent.emp = e.emp || 0; ent.rs = e.rs || 0;
          ent.dcd = e.dcd ?? 0; ent.dock = e.dc != null ? !!e.dc : ent.dock; ent.hcd = e.hcd ?? 0; ent.hfly = !!e.hfly;
        }
        const wasDead = ent.dead;
        ent.dead = !!e.dead;
        // 三機小隊:主視野由伺服器指定(e.act);換機時整個座機狀態接管過去
        if (e.pid === this.youId && !!e.act !== ent.isSelf) this._takeOver(ent, e);
        if (wasDead && !e.dead && !ent.isSelf) ent._snapPos = true;
        ent.mesh.visible = !e.dead && (!ent.isSelf || this.viewMode === 'tps');
        if (e.dc != null) ent.dock = !!e.dc;   // 餌機掛點:已組合就緒(組合/分離動畫)
        ent.emp = e.emp || 0;
        ent.vb = e.vb || 0;
        ent.st = e.st || 0;
        ent.pz = e.pz || 0;
        ent.sl = e.sl || 0;
        ent.slf = e.slf ?? 0.6;
        ent.cf = e.cf || 0;
        ent.hs = e.hs || 0;
        ent.hsf = e.hsf || 0;
        ent.mk = e.mk || 0;
        ent.ub = e.ub || 0;
        ent.bl = e.bl || 0;
        ent.iv = e.iv || 0;
        ent.cst = e.cst || 0;
        if (ent.isSelf) {
          this.castLeft = e.cst || 0;
          this.decoyCd = e.dcd ?? 0;
          this.decoyDocked = !!e.dc;
          this.kamiCd = e.kcd ?? 0;   // 無人機自殺攻擊機冷卻(HUD;歸零 = 可再次觸發)
          this.hyperCd = e.hcd ?? 0;     // 機甲極音速飛彈冷卻(HUD)
          this.hyperFly = !!e.hfly;      // 空中已有一枚(鈕面顯示「飛行中」)

          this.hp = e.hp; this.maxHp = e.m;
          this.sp = e.sp ?? this.sp; this.maxSp = e.msp ?? this.maxSp;
          if (this.defending && (this.sp || 0) <= 0) this._toggleDefense(false);
          // 受擊回饋分流:護盾吃下這一發(舉盾中且護盾水位下降) → 護盾位置閃光(強度 ∝ 傷害),
          // 取代全屏血光;裝甲掉血(盾沒接住:穿盾/盾已空/沒舉盾)才閃紅暈影。
          // 重生/補血的上升不觸發;換主視野(_takeOver 清 _prevVital/_prevSp)不誤觸
          const vital = this.hp + this.sp;
          if (this._prevVital != null && vital < this._prevVital - 0.5 && !e.dead) {
            const spLoss = (this._prevSp ?? this.sp) - this.sp;
            this._lastHurtAt = performance.now() / 1000;   // 被攻擊時戳(無人機完美迴避的戰鬥狀態判定)
            this._airSinkHit(this._prevVital - vital);     // 飛行機體受擊掉高(掉幅 ∝ 這次掉的護盾+裝甲)
            if (this.defending && (this.sp || 0) > 0 && spLoss > 0.5) {
              const s = Math.min(2.5, shieldHitStrength(spLoss) * 1.6);   // 劇烈發光:舊峰值 ×1.6
              this._fpsShieldMesh?.userData.hit?.(s);
              ent.shieldMesh?.userData.hit?.(s);
            } else {
              this.hud.hurt?.();
            }
          }
          this._prevVital = vital;
          this._prevSp = this.sp;
          this.mp = e.mp ?? this.mp; this.maxMp = e.mm ?? this.maxMp;
          if (e.mm != null) this._mpAuth = true;   // 電力上限定案(爬升動力為固定上限,不吃此閘)
          this.money = e.$ ?? this.money;
          this.upg = e.up || this.upg;
          this.kn = e.kn ?? this.kn;
          this.cds = e.cds || this.cds;
          if (e.chg) this.chg = e.chg;
          this.empLeft = e.emp || 0;
          this.blindLeft = e.vb || 0;
          this.stealthLeft = e.st || 0;
          // 控場/追加效果狀態(伺服器權威剩餘秒;條件欄位缺省 = 已結束)
          this.stunLeft = e.pz || 0;
          this.slowLeft = e.sl || 0;
          this.slowF = e.slf ?? 0.6;
          // 高地壓制(伺服器權威;欄位缺省 = 窗已過)—— 只折移速,命中/閃避由伺服器結算
          this.hiSupLeft = e.hs || 0;
          this.hiSupF = e.hsf || 0;
          this.confLeft = e.cf || 0;
          this.markLeft = e.mk || 0;
          this.unbalLeft = e.ub || 0;
          this.bleedLeft = e.bl || 0;
          this.invLeft = e.iv || 0;
          this.selfMods = e.md || [];   // 招式增益 [k, m, remS](speed/jump 由客戶端物理消費)
          this._buffsLeft = e.bf || []; // 詞綴強化 [[id, remS], …](AFFIXES: tempered/hardened/…)
          this._ccFeed();
          // 角色 / 招式階級同步(伺服器權威;升階 → 重算武器數值並滿彈夾)
          if (e.ch && e.ch !== this.ch) this._setChar(e.ch);
          if (e.ab) {
            const changed = ['light', 'heavy'].some((s) => e.ab[s] !== this.abil[s]);
            this.abil = { ...e.ab };
            if (changed) this._setChar(this.ch, true);
          }
          if (e.dead && !this.dead) this._onSelfDeath();
          if (!e.dead && this.dead) this._onSelfRespawn(e.x, -e.z);
          // 過場播放中壓住倒數頁(#deadOverlay/砲塔 PiP),過場結束(_deathSeq=null)下一快照才顯示;
          // 開著戰場選單(this.paused)時亦壓住倒數頁 → 讓離開/繼續選單獨佔畫面(ESC 開的離開頁)
          this.hud.dead?.(e.dead && !this._deathSeq && !this.paused ? e.rs : null);
          // 商店預約:錢一夠就自動下單。MUST 排在商店重繪簽章**之前** —— 這一份快照剛把 money
          // 寫進來,先成交才算得出正確的簽章;而且它 MUST NOT 關在 `if (this.shopOpen)` 裡
          //(預約的用途正是「關著商店去打仗,錢到了自己買」)。
          this._tickReserve();
          // 商店只在數值變動時重繪(2026-07-17):每 8Hz 全量重建 DOM 會在點擊瞬間銷毀按鈕 →
          // 掉點擊(「沒辦法馬上購買」)。以 money/擊殺/升級/角色/階級簽章 gate,idle 時完全不重繪。
          if (this.shopOpen) {
            const u = this.upg;
            const sig = `${Math.floor(this.money)}|${this.kn}|${this.ch}|${this.abil.light}.${this.abil.heavy}.${this.abil.def}.${this.abil.atk}|`
              + ['lw', 'hw', 'def', 'atk', 'hp', 'ar', 'sp', 'ch'].map((k) => u[k] || 0).join(',')
              + `|sup:${u.super || 0}`   // 超級升級(一般對戰恆 0,簽章穩定不誤觸重繪)
              + `|${[...this._reserve].join('.')}`   // 預約名單(成交/退場都要讓 ★ 跟著更新)
              + `|${(this.creepUpg?.[this.side] || []).join('.')}`;   // 陣營小兵強化(共用值,別人買了也要重繪)
            if (sig !== this._shopSig) { this._shopSig = sig; this.hud.shop?.(true, this._shopState()); }
          }
        }
      }
      this._updateHpBar(ent);
      this._updateDamageStage(ent);
    }
    // 移除消失的單位。快照缺席也可能是迷霧過濾;只有同幀權威 die 事件可留純渲染殘影。
    const deadIds = new Set((m.ev || []).filter((ev) => ev.e === 'die' || ev.e === 'moon_boom').map((ev) => ev.id));
    for (const [id, ent] of this.ents) {
      if (!seen.has(id)) { this._removeEnt(id, ent, deadIds.has(id)); }
    }
    // 事件
    for (const ev of m.ev || []) this._onEvent(ev);
    // 防空飛彈(伺服器權威 3D 追蹤)
    this._syncMissiles(m.sm || [],m.ev || []);
    // 戰場物資(擊毀障礙物掉落,靠近拾取)
    this._syncLoot(m.lt || []);
    // 空投物資(非兵線隨機空投,降落傘飄降後靠近拾取)
    this._syncAirdrop(m.ad || []);

    // HUD
    const bases = {};
    for (const ent of this.ents.values()) {
      if (ent.kind === 'base') bases[ent.side] = { hp: ent.hp, max: ent.max };
    }
    // 三機小隊狀態列(各機 HP / 陣亡倒數 / 誰是主視野)
    if (this.isDrone) {
      this.hud.squad?.(m.ents
        .filter((e) => e.pid === this.youId)
        .sort((a, b) => (a.si || 0) - (b.si || 0))
        .map((e) => ({ si: e.si || 0, hp: e.hp, max: e.m, dead: !!e.dead, rs: e.rs || 0, act: !!e.act })));
    }
    this.hud.bases?.(bases, m.stats);
    this.hud.wave?.(m.wave, m.nextWave);
    // 角色數據面板:交戰 = 自機(_weaponHud);觀戰 = 跟隨中那位玩家(_specHud,同一個形狀)
    const sh = this._specHud();
    this.hud.self?.(sh ? sh.hp : this.hp, sh ? sh.max : this.maxHp,
      sh ? 0 : this._burstCdLeft(), sh || this._weaponHud());
    // 異常狀態圖示列(僅自機;觀戰不顯示)
    if (!sh) {
      const icons = [];
      this._statusMax = this._statusMax || {};
      const activeIds = new Set();
      const push = (id, remS, positive, label, stacks) => {
        if (remS > 0) {
          activeIds.add(id);
          if (!this._statusMax[id] || remS > this._statusMax[id]) this._statusMax[id] = remS;
          icons.push({ id, remS, positive, label, stacks, maxS: this._statusMax[id] });
        }
      };

      // ── 控場:麻痺 / 癱瘓 / 暈眩 ──────────────────────────────────────
      // 1. 麻痺 (pz/stunLeft): 動力系統離線,武器仍可運作
      // 2. 癱瘓 (emp/empLeft): 武器系統離線,機體仍可移動
      // 3. 暈眩 (stun): 動力+武器雙重離線 (全行動鎖定組合狀態)
      if (this.stunLeft > 0 && this.empLeft > 0) {
        const stunRem = Math.min(this.stunLeft, this.empLeft);
        push('stun', stunRem, false, '暈眩');
        if (this.stunLeft > this.empLeft + 0.1) push('paralyze', this.stunLeft, false, '麻痺');
        if (this.empLeft > this.stunLeft + 0.1) push('emp', this.empLeft, false, '電磁干擾');
      } else {
        if (this.stunLeft > 0) push('paralyze', this.stunLeft, false, '麻痺');
        if (this.empLeft > 0) push('emp', this.empLeft, false, '電磁干擾');
      }

      // ── 減速/凍結:用 slowF 區分(≤0.4=凍結,>0.4=一般減速) ───────────────
      if (this.slowLeft > 0) {
        const sf = this.slowF || 0.6;
        // 中毒同時帶減速(slowF≈0.7):稍後由 poison 組合處理,此處只處理純減速/凍結
        // 「中毒減速」判定:bleed 也在效果中,且 slowF > 0.5(poison slow 特徵)
        const isPoisonSlow = this.bleedLeft > 0 && sf > 0.5;
        if (!isPoisonSlow) {
          push(sf <= 0.4 ? 'freeze' : 'slow', this.slowLeft, false, sf <= 0.4 ? '凍結' : '減速');
        }
      }

      // ── 灼燒/流血/中毒:bleed 欄位(火焰=純DoT,流血=裝甲破口,毒=DoT+減速組合) ──
      if (this.bleedLeft > 0) {
        const sf = this.slowF || 0.6;
        const hasPoisonSlow = this.slowLeft > 0 && sf > 0.5;
        const isBurn = !!this._burnAt && (performance.now() / 1000 - this._burnAt < 2.5);
        if (hasPoisonSlow) {
          // 中毒(組合):以兩者較短的剩餘時間顯示毒圖示(代表 DoT+減速並行期)
          const poisonRem = Math.min(this.bleedLeft, this.slowLeft);
          push('poison', poisonRem, false, '中毒');
          // 若 bleed 超過 slow,剩餘純 DoT 段顯示為灼燒或流血
          if (this.bleedLeft > this.slowLeft + 0.1) {
            push(isBurn ? 'burn' : 'bleed', this.bleedLeft, false, isBurn ? '灼燒' : '流血');
          }
        } else {
          push(isBurn ? 'burn' : 'bleed', this.bleedLeft, false, isBurn ? '灼燒' : '流血');
        }
      }

      // ── 視野+火控喪失 ─────────────────────────────────────────────────
      push('blind', this.blindLeft, false, '致盲');
      // ── 移速折半+方向反轉 ─────────────────────────────────────────────
      push('conf', this.confLeft, false, '混亂');
      // ── 取消閃避 ──────────────────────────────────────────────────────
      push('mark', this.markLeft, false, '標記');
      // ── 命中率懲罰(精度下降) ────────────────────────────────────────
      push('unbal', this.unbalLeft, false, '失衡');
      // ── 命中+閃避雙懲罰(高地壓制) ──────────────────────────────────
      push('hiSup', this.hiSupLeft, false, '高地壓制');
      // ── 正面效果 ──────────────────────────────────────────────────────
      push('stealth', this.stealthLeft, true, '隱身');
      push('inv',     this.invLeft,     true, '無敵');
      // 招式增益(多層,stacks = 生效中的條數)
      const activeMods = (this.selfMods || []).filter((m) => m[2] > 0);
      if (activeMods.length) {
        const minRem = Math.min(...activeMods.map((m) => m[2]));
        push('mod', minRem, true, '招式增益', activeMods.length);
      }
      // 詞綴強化(AFFIXES: tempered/hardened/vampiric/bounty)
      const affixNames = { tempered: '淬火', hardened: '複合裝甲', vampiric: '汲能', bounty: '懸賞' };
      for (const [id, remS] of (this._buffsLeft || [])) push(id, remS, true, affixNames[id] || id);

      // 清理已結束狀態的最大秒數紀錄
      for (const id in this._statusMax) if (!activeIds.has(id)) delete this._statusMax[id];

      icons.sort((a, b) => a.remS - b.remS);
      this.hud.statusIcons?.(icons);
    } else {
      this.hud.statusIcons?.([]);
    }


    if (m.over) {
      const first = !this._gameOver;
      this._gameOver = true; this._deathSeq = null; this.hud.deathCine?.(false);
      // 結算遮幕(序 8 ④-1):前三件是**狀態閘**,照舊立刻做 —— 延後會讓暫停選單在結算時
      // 彈出來。只有結算頁本身排在切點上,而且**只有第一份帶 over 的快照**才起幕:
      // `m.over` 之後每一份快照都是 true,不擋就是幕一直重刷。
      // 旋鈕關著時 `_wipeCut` 當場同步走回呼 ⇒ 兩條路都逐位元同舊制。
      if (first) this._wipeCut(() => this.hud.over?.(m.winner, m.stats),
        m.winner ? sideInfo(m.winner).color : null);
      else this.hud.over?.(m.winner, m.stats);
    }
  }

  _spawnEnt(e) {
    if (['tree','moon','slab'].includes(e.k)) {
      const mesh=buildHpSkillObject(e.k), box=new THREE.Box3().setFromObject(mesh), size=box.getSize(new THREE.Vector3());
      const padY=this.terrain.heightAt(e.x,-e.z)+(e.y || 0);
      mesh.position.set(e.x,padY,-e.z); mesh.rotation.y=-(e.ang || 0);
      mesh.userData.kind=e.k;
      const ent={id:e.id,kind:e.k,side:e.s,mesh,hp:e.hp,max:e.m,isStatic:true,padY,ownedDamageBody:true,
        tgt:new THREE.Vector3(e.x,0,-e.z),dimR:Math.max(size.x,size.z)/2,dimH:size.y,dimTop:box.max.y};
      this.scene.add(mesh); this.ents.set(e.id,ent);
      applySceneDamage(ent,sceneDamageStage(e.hp,e.m));
      this._updateHpBar(ent); this._updateDamageStage(ent);
      return ent;
    }
    // 中立危險區實體(障礙物 / 防空陣地 / 偵察中繼站):程序生成低多邊形,不吃 makeUnit
    const hazDef = HAZARDS[e.k];
    if (hazDef || e.k === 'aasite' || e.k === 'relay') {
      const r = (hazDef?.r ?? 6) * (e.sc || 1);
      const group = buildHazard(e.k, e.id, r);
      this.scene.add(group);
      this._registerViewOccluders(group);
      const ent = {
        id: e.id, kind: e.k, side: null, mesh: group,
        tgt: new THREE.Vector3(e.x, 0, -e.z), hp: e.hp, max: e.m,
        neutral: true, isStatic: true, hero: false, collapsed: false,
        // 阻擋型障礙:限制行動但不完全封鎖(縫隙由伺服器佈局保證,無人機可飛越)
        colR: hazDef?.block ? r : (e.k === 'aasite' ? 3.2 : e.k === 'relay' ? 1.6 : 0),
        colH: e.k === 'aasite' ? 3.5 : e.k === 'relay' ? 8 : (hazDef?.hgt || 6),
      };
      const czw = -e.z, cyw = this._surf(e.x, czw, this.terrain.heightAt(e.x, czw));
      // 擱淺船浮於水面(湖床在水面下時不下沉;無水面資訊或高灘上則貼地)
      const wy = (e.k === 'ship' && Number.isFinite(this.terrain.waterY)) ? this.terrain.waterY : -Infinity;
      group.position.set(e.x, Math.max(cyw, wy), czw);
      // 淹水/坑洞:水面是寬平盤,單一中心高度會在斜坡上飄空、在橋面下沉 —— 逐頂點貼地
      if (e.k === 'flood' || e.k === 'pothole') this._conformWater(group, e.x, czw, cyw);
      if (group.userData.flames) this.flamers.add(group);
      if (e.k === 'flood') this.floods.push({ x: e.x, z: -e.z, r, slow: hazDef.slow });
      if (FIRE_KINDS_C.has(e.k)) this.fires.push({ x: e.x, z: -e.z, r });   // 火場滯留霧化判定
      this.ents.set(e.id, ent);
      // Measure pristine geometry before damage, bars, and effects can expand its bounds.
      const bounds = new THREE.Box3().setFromObject(group);
      ent.dimR = Math.max(1, (bounds.max.x - bounds.min.x) / 2, (bounds.max.z - bounds.min.z) / 2);
      ent.dimTop = Math.max(1, bounds.max.y - group.position.y);
      ent.dimH = Math.max(1, bounds.max.y - bounds.min.y);
      applySceneDamage(ent, sceneDamageStage(e.hp, e.m, !!e.col));
      // 坍塌殘骸(重進視野/重連):直接套用傾倒姿態,不走動畫
      if (e.col) this._applyCollapse(ent, true);
      this._updateDamageStage(ent);
      return ent;
    }
    // 覆蓋:此處回退,續建一般單位
    return this._spawnUnit(e);
  }

  // 開場分幀建模排程(_applySnap 只排隊,這裡每幀限量建;唯一消費端 = _loop)。
  // raw 取建模當下最新的一份 ⇒ 排隊期間的位置/血量不靠舊快照,首幀即落在最新 tgt。
  // _snapPos = 建模幀直接貼上最新位置,不從原點插值滑過去(舊制同幀建模同幀插值,首幀同樣不在 tgt 上)。
  _drainSpawnPend() {
    if (!this._spawnPend?.size) return;
    const statik = (e) => (e.k === 'tower' || e.k === 'base' || e.k === 'bunker') ? 0 : 1;
    const ids = [...this._spawnPend.keys()]
      .sort((a, b) => statik(this._spawnPend.get(a)) - statik(this._spawnPend.get(b)));
    const startT = performance.now();
    let n = 0;
    for (const id of ids) {
      // 節流分幀建模:靜態工事優先;每幀至多 8 隻且超過 6ms 讓步以維持 60 FPS
      if (n >= 1 && (n >= 8 || (performance.now() - startT) > 6)) break;
      if (this.ents.has(id)) { this._spawnPend.delete(id); continue; }
      const raw = this._spawnPend.get(id);
      this._spawnPend.delete(id);
      const ent = this._spawnEnt(raw);
      if (ent) {
        ent._snapPos = true;
        n++;
      }
    }
  }

  /**
   * 淹水/坑洞水面貼地:平放水盤 + 漂浮雜物本來全掛在「群心單一高度」,斜坡上整塊飄空、
   * 橋面下沉。改為:寬水盤重建成三角扇逐頂點貼地(緊貼地貌),漣漪圈/雜物各自依所在地表升降。
   * 一次性(危險區靜止),用 _surf 走橋面 ∪ 地形的統一貼地縫。
   */
  _conformWater(group, cx, cz, cy) {
    const surf = (x, z) => this._surf(x, z, this.terrain.heightAt(x, z));
    for (const o of group.children) {
      if (o.userData?.water && o.geometry?.parameters) {
        const p = o.geometry.parameters;
        const rad = p.radiusTop ?? p.radius ?? 6;
        const off = o.position.y || 0;   // 保留原水面相對地面的高差(flood +0.32 站水 / pothole −0.05 積水)
        const N = 28;
        const pos = [0, surf(cx, cz) - cy + off, 0], idx = [];
        for (let i = 0; i < N; i++) {
          const a = i / N * Math.PI * 2, dx = Math.cos(a) * rad, dz = Math.sin(a) * rad;
          pos.push(dx, surf(cx + dx, cz + dz) - cy + off, dz);
        }
        for (let i = 0; i < N; i++) idx.push(0, 1 + i, 1 + (i + 1) % N);
        const geo = new THREE.BufferGeometry();
        geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
        geo.setIndex(idx);
        geo.computeVertexNormals();
        o.geometry.dispose();
        o.geometry = geo;
        o.position.set(0, 0, 0);
        o.rotation.set(0, 0, 0);
      } else {
        // 漣漪圈 / 漂浮雜物:依所在地表升降,跟著坡度走(不再全部平放在群心高度)
        o.position.y += surf(cx + o.position.x, cz + o.position.z) - cy;
      }
    }
  }

  // The fallback plane clears the body; authored rigs use their sampled pose envelope.
  // Both views share makeShieldMaterial; shield settlement remains in sim._shieldDefFactor.
  _createFrontShieldMesh(r = 2.5, h = 4.0, arc = 140 * Math.PI / 180, ch = this.ch) {
    const sg = new THREE.Group();
    const R = Math.max(0.8, r * Math.sin(arc / 2));
    const geo = new THREE.CircleGeometry(R, 6);
    const style = characterCombatStyle(ch);
    const mat = makeShieldMaterial(style?.color ?? 0x38bdf8, { planar: true, hexR: R,
      accent: style?.accent, pattern: characterShieldTexture(ch) });
    const m = new THREE.Mesh(geo, mat);
    m.position.z = r * 1.12;
    m.userData.noOutline = true; m.userData.noPaint = true;
    sg.add(m);
    sg.userData.mat = mat;
    sg.userData.character = ch;
    sg.userData.hit = (s = 1) => { mat.uniforms.uFlash.value = Math.max(mat.uniforms.uFlash.value, s); };
    sg.userData.noOutline = true;
    sg.userData.noPaint = true;
    sg.visible = false;
    return sg;
  }

  _spawnUnit(e) {
    const civ = e.k === 'civilian';
    const key = e.k === 'base' ? `base:${e.s}` : civ ? 'civ' : KIND_KEY[e.k];
    if (!key) return null;
    // 平民:陣營看 cs(伺服器 side=null,讓兩陣營都能開槍),ch = 職業 index(選 buildCivilian 變體)
    // 餌機:不畫陣營光環(它是一枚飛行中的彈體,不是站在地上的單位)
    const { group, mixer } = makeUnit(key, civ ? e.cs : e.s,
      { ch: civ ? e.pf : e.ch, appearanceSeed: civ ? e.id : 0,
        ring: e.k !== 'decoy' && e.k !== 'kami' && e.k !== 'hyper', dissolve: true });
    if (e.k === 'kami') group.scale.setScalar(SQUAD.KAMI.SIZE_F);   // 護衛自殺機衝出:SIZE_F(1/2)體型
    if (e.bs != null) group.scale.setScalar(bossScaleF(e.bs));      // NPC BOSS 階段體型縮放
    if (e.sv != null) group.scale.setScalar(superScaleF(e.sv));   // 超級戰士升級體型(命中/碰撞同一把尺)
    const hero = HERO_KINDS.has(e.k);
    const isStatic = e.k === 'tower' || e.k === 'base' || e.k === 'bunker';
    // 三機小隊:只有主視野那架(e.act)才是「自己」,另外兩架當一般友軍渲染
    const isSelf = hero && e.pid != null && e.pid === this.youId && !!e.act;
    if (isSelf) group.visible = (this.viewMode === 'tps');
    this.scene.add(group);
    if (isStatic) this._registerViewOccluders(group);
    if (mixer) this.mixers.add(mixer);
    if (group.userData.spin) this.spinners.add(group);
    // 基準包圍盒:MUST 在掛受擊殼/血條/敵方標記之前量(它們都是 mesh 子節點,事後 Box3 會被
    // 撐大 —— 塔的受擊殼半徑(舊制手寫 11m),曾把鎖定光暈吹成 49m 巨球、血條抬到半空)。
    // 貼地陣營光環(teamRing,塔的圈 r≈14)同樣排除:光暈/血條要包的是機體本體。
    // 同類機種/陣營的原始體積純為確定性靜態幾何,透過跨場快取消除每波小兵生成時數十毫秒的遍歷卡頓。
    const dimCache = _GLOBAL_UNIT_DIM_CACHE;
    const dimKey = `${key}:${e.s}:${e.bs ?? ''}:${civ ? e.pf : (e.ch ?? '')}:${e.k === 'kami' ? 1 : 0}`;
    // Generated civilians have per-entity dimensions; do not grow the archetype cache with their IDs.
    let dims = civ ? null : dimCache.get(dimKey);
    if (!dims) {
      const bb = new THREE.Box3();
      const bbT = new THREE.Box3();
      group.updateWorldMatrix(true, true);
      group.traverse((o) => {
        if (!o.isMesh || !o.geometry || o.userData.teamRing || o.userData.presentationEffect) return;
        if (!o.geometry.boundingBox) o.geometry.computeBoundingBox();
        bbT.copy(o.geometry.boundingBox).applyMatrix4(o.matrixWorld);
        bb.union(bbT);
      });
      dims = {
        dimTop: bb.max.y,
        dimH: bb.max.y - bb.min.y,
        dimR: Math.max(bb.max.x - bb.min.x, bb.max.z - bb.min.z) / 2,
      };
      if (!civ) dimCache.set(dimKey, dims);
    }
    const isBoss = (e.bs != null) || !!(this.cfg?.defSide && e.s === this.cfg.defSide && hero);
    const ent = {
      dimTop: dims.dimTop, dimH: dims.dimH, dimR: dims.dimR,
      id: e.id, kind: e.k, side: e.s, mesh: group, mixer, ch: e.ch, pid: e.pid ?? null, sv: e.sv ?? 0,
      tgt: new THREE.Vector3(e.x, 0, -e.z), hp: e.hp, max: e.m,
      isSelf, hero, heroY: 0, ry: 0,
      isBoss, bossSeg: e.bs ?? (isBoss ? 0 : null),
      flies: e.k === 'heli' || e.k === 'decoy' || e.k === 'kami' || e.k === 'hyper' || e.k === 'drone_wingman' || e.k === 'heli_squad' || e.k === 'carnival_heli',
      decoy: e.k === 'decoy', kami: e.k === 'kami', hyper: e.k === 'hyper', si: e.si || 0,
      isStatic, isClone: !!e.clone,
      // 英雄機體:碰撞圓柱綁角色體型(高防禦=巨大=難閃避),不吃 COLLIDER 表
      heroCol: hero ? heroCollider(e.k, e.ch, e.sv || 0) : null,
    };
    if (sceneDamageProfile(ent.kind)) applySceneDamage(ent,sceneDamageStage(e.hp,e.m));
    if (hero) {
      const r = (ent.heroCol?.r || dims.dimR || 2.5) * 1.15;
      const h = ent.heroCol?.h || dims.dimH || 5.0;
      const sm = group.userData.rig?.combat?.guard || this._createFrontShieldMesh(r, h, undefined, e.ch);
      if (!sm.userData.authoredCombat) {
        sm.position.y = h * 0.5;
        group.add(sm);
      }
      ent.shieldMesh = sm;
    }
    // 極音速飛彈:偏航 + 俯仰同時套(_updateEnts 的姿態段)⇒ 歐拉序 MUST 是 'YXZ',
    // 否則俯仰會繞世界橫軸轉,大偏航時 45° 抬頭看起來變成側傾。
    if (e.k === 'hyper') group.rotation.order = 'YXZ';
    // 平民/間諜:side 保持 null(兩陣營皆可開槍),陣營記在 cs 供頭頂箭頭;neutral = 不進準星敵人推測
    if (e.k === 'civilian') { ent.civ = true; ent.cs = e.cs; ent.prof = e.pf; ent.neutral = true; ent.fo = !!e.fo; ent.fl = !!e.fl; }
    // 防禦塔 / 主堡:受擊回饋殼(平時不存在,受擊才亮起 hex 格紋 → 淡出)。
    // 尺寸吃**權威命中量體**(hitR/hitH 單一縫)⇒ 殼一亮就是在說「這一發打在量體上」;
    // MUST NOT 手寫半徑(舊制 r=30 而主堡 hitR 只有 20 ⇒ 寬了 50%、頂端外溢到主堡上空)。
    if (e.k === 'tower' || e.k === 'base') {
      const hv = { kind: e.k, side: e.s };   // hitR/hitH 只吃 kind/side(主堡兩陣營量體不同)
      const shell = makeHitShell(hitR(hv), hitH(hv), SIDES[e.s].color);
      group.add(shell);
      ent.hitShell = shell;
      this.hitShells.add(shell);
    }
    // 橋上砲塔:蓋在橋面墩座台上(biomes buildTowerBridgePads 定案;查無 = 一般貼地塔)
    if (e.k === 'tower') ent.padY = this.terrain.towerPadY?.(e.x, -e.z) ?? null;
    else if (e.k === 'base') ent.padY = this.terrain.basePadY?.(e.x, -e.z) ?? null;
    group.position.set(e.x, ent.padY ?? this.terrain.heightAt(e.x, -e.z), -e.z);
    if (e.k === 'base') { this._addHealAura(ent, e); this._addBaseGuns(ent, e); }
    else if (isThirdSide(e.s)) this._addRangeRing(ent, e);   // 第三方(GUER/MILI)戰鬥單位與碉堡:貼地射程光暈
    if (e.k === 'bunker') this._clearAroundBunker(e);        // 碉堡淨空:移除重疊建物 + 清同區碰撞柱
    // 自殺攻擊機**不常駐**(2026-08-06 使用者定案「拿掉常駐模組,攻擊時再出現」):
    // 觸發時由 sim 生成 kind 'kami' 實體,走 _spawnEnt 的一般渲染路徑(SIZE_F 縮小)⇒ 這裡什麼都不做。
    this.ents.set(e.id, ent);
    syncLightningScorch(ent, !!e.charred);
    return ent;
  }

  // 碉堡淨空:碉堡進場時移除與其重疊的客戶端建物/地標(視覺 + 碰撞柱一併,由 clearAround 內部同判定處理,
  // 只動建物/地標、不動植被/巨岩/橋墩 —— A6 砲火/碰撞與視覺一致)。讓碉堡不半插樓體、周圍留出駐守/重生空間。
  // clearAround 有動碰撞柱時回 true → 重建 _blockGrid。以四捨五入位置去重,避免重進視野/重生時重複全掃。
  _clearAroundBunker(e) {
    const wx = e.x, wz = -e.z, R = THIRD.BLD_CLEAR_R;
    const key = `${Math.round(wx)},${Math.round(wz)}`;
    (this._bldCleared ??= new Set());
    if (this._bldCleared.has(key)) return;
    this._bldCleared.add(key);
    const removed = this.terrain.clearBuildingsAround?.(wx, wz, R);
    if (removed) {
      this._blockGrid = this._buildBlockGrid(this.terrain.blockers || []);   // 碰撞柱與視覺一致(A6)
      this.terrain.rebuildBlockerTops?.();   // 頂面站立索引同步重建(拆掉的樓不留幽靈站立面)
      this.terrain.rebuildClimbs?.();        // 攀爬路線索引同步重建(拆掉的樓不留通往空中的梯子)
      this._ambDens?.clear();                // 地點床密度快取(拆掉的樓不留幽靈市區聲;與上兩行同一族)
    }
  }

  // 主堡治癒光環:標出 HERO_HEAL_R 範圍(貼地環,陣營色,緩慢脈動)
  _addHealAura(ent, e) {
    const R = GAME.HERO_HEAL_R;
    const wx = e.x, wz = -e.z, y = (ent.padY ?? this.terrain.heightAt(wx, wz)) + 0.6;
    const col = SIDES[e.s].color;
    const g = new THREE.Group();
    g.position.set(wx, y, wz);
    const ring = new THREE.Mesh(new THREE.RingGeometry(R * 0.9, R, 64),
      new THREE.MeshBasicMaterial({ color: col, transparent: true, opacity: 0.28, depthWrite: false, side: THREE.DoubleSide }));
    const disc = new THREE.Mesh(new THREE.CircleGeometry(R, 64),
      new THREE.MeshBasicMaterial({ color: col, transparent: true, opacity: 0.06, depthWrite: false, side: THREE.DoubleSide }));
    ring.rotation.x = disc.rotation.x = -Math.PI / 2;
    g.add(disc); g.add(ring);
    g.renderOrder = 2;
    this.scene.add(g);
    ent.aura = g; ent.auraRing = ring;
    (this._auras ??= []).push(ent);
  }

  // 第三方(GUER/MILI)射程範圍光暈:貼地環 + 極淡填色,陣營識別色,緩慢脈動(共用 base 補血光環的
  // ent.aura/_auras 機制 ⇒ 移除清理(_removeEnt)與脈動(update:_auras 迴圈)免額外接線)。
  // 半徑取自 data.js 射程唯一真相(MUST NOT 手寫/量 bbox):戰鬥單位 = UNITS[kind].range;
  // 碉堡本身 range 0 ⇒ 取駐守步槍兵實際火力半徑 = soldier.range × THIRD.GAR_RANGE_F。
  _addRangeRing(ent, e) {
    const R = e.k === 'bunker' ? UNITS.soldier.range * THIRD.GAR_RANGE_F : (UNITS[e.k]?.range || 0);
    if (R <= 0) return;   // 寧缺勿錯:無射程不畫(bunker.range=0 走上面 derive)
    const wx = e.x, wz = -e.z, y = this.terrain.heightAt(wx, wz) + 0.6;
    const col = sideInfo(e.s).color;   // GUER 綠 / MILI 橙紅;MUST NOT 用 SIDES[e.s](第三方不在表內 → undefined)
    const g = new THREE.Group();
    g.position.set(wx, y, wz);
    const ring = new THREE.Mesh(new THREE.RingGeometry(R * 0.96, R, 64),
      new THREE.MeshBasicMaterial({ color: col, transparent: true, opacity: 0.22, depthWrite: false, side: THREE.DoubleSide }));
    const disc = new THREE.Mesh(new THREE.CircleGeometry(R, 64),
      new THREE.MeshBasicMaterial({ color: col, transparent: true, opacity: 0.035, depthWrite: false, side: THREE.DoubleSide }));
    ring.rotation.x = disc.rotation.x = -Math.PI / 2;
    g.add(disc); g.add(ring);
    g.renderOrder = 2;
    this.scene.add(g);
    ent.aura = g; ent.auraRing = ring;
    (this._auras ??= []).push(ent);
  }

  // 主堡兩門大砲(視覺):砲管朝敵方主堡,伺服器 _tickBaseGuns 開火時走既有 shot 曳光
  _addBaseGuns(ent, e) {
    const wx = e.x, wz = -e.z;
    const box = new THREE.Box3().setFromObject(ent.mesh);
    const bh = box.max.y - box.min.y;
    const foe = e.s === 'SWARM' ? 'STEEL' : 'SWARM';
    const eb = this.cfg.bases?.[foe];
    let dirX = 0, dirZ = 1;
    if (eb) { const [ex, ez] = llToWorld(eb[0], eb[1], this.center); dirX = ex - wx; dirZ = ez - wz; }
    const g = buildBaseBattery(e.s, bh);
    g.position.set(wx, box.min.y + g.position.y, wz);
    g.rotation.y = Math.atan2(dirX, dirZ);
    ent.gunPivots = g.userData.pivots;
    ent.gunMuzzles = g.userData.muzzles;
    ent.mesh.userData.rig.attacks = g.userData.attacks;
    this.scene.add(g);
    ent.guns = g;
  }

  _removeEnt(id, ent, dissolve = false) {
    releaseLightningScorch(ent);
    if (!dissolve) releaseMobileDamage(ent);
    if (dissolve && ent.neutral && !ent.collapsed) sceneDamageBurst(this.scene, this.effects, ent, 3);
    if (this._lockId === id) this._clearLockGlow();   // 光暈是目標 mesh 的子節點,別留下懸空參照
    if (ent._rgGlow) { ent._rgGlow.parent?.remove(ent._rgGlow); this._rgPool?.push(ent._rgGlow); ent._rgGlow = null; }   // 武器射程光暈回收進池(共用材質,MUST NOT 隨 mesh 一起丟)
    if (ent._rgGlowS) { ent._rgGlowS.parent?.remove(ent._rgGlowS); this._rgPoolS?.push(ent._rgGlowS); ent._rgGlowS = null; }  // 招式光暈同上
    if (ent.aura) { this.scene.remove(ent.aura); this._auras = (this._auras || []).filter((x) => x !== ent); }
    if (ent.statusFx) { ent.statusFx.userData?.dispose?.(); ent.statusFx = null; }
    if (ent.guns) this.scene.remove(ent.guns);
    if (ent.mixer) this.mixers.delete(ent.mixer);
    if (ent.hitShell) this.hitShells.delete(ent.hitShell);
    this.spinners.delete(ent.mesh);
    this.flamers.delete(ent.mesh);
    this.damaged.delete(ent);
    this._unregisterViewOccluders(ent.mesh);
    this.ents.delete(id);
    if (dissolve && !ent.neutral && sceneDamageProfile(ent.kind)) {
      applySceneDamage(ent,3);
      sceneDamageBurst(this.scene,this.effects,ent,3);
      if (ent.bar) ent.bar.visible = false;
      if (ent.dmgFx) ent.dmgFx.visible = false;
      const scaleY = ent.mesh.scale.y;
      this.effects.push({ obj: ent.mesh, ttl: 0.85,
        dispose: () => { releaseMobileDamage(ent); disposeTree(ent.mesh); },
        fade: (o,f) => { o.scale.y = scaleY * (sceneDamageProfile(ent.kind).mobile ? .6+.4*f : MAP_BUILDING.RUBBLE_H + (1-MAP_BUILDING.RUBBLE_H)*f*f); } });
      return;
    }
    // 戰鬥參照全部已在上面清掉,之後才能把 mesh 當純渲染殘影留在 scene。
    // 迷霧消失(dissolve=false)必須即時收起,不得洩漏視野外位置。
    const origin = ent.mesh.position.clone();
    if (dissolve && ent.mesh.visible && DISSOLVE.OUT_S > 0 && setDissolve(ent.mesh, 1, origin) > 0) {
      if (ent.bar) ent.bar.visible = false;
      this._dissolveGhosts.push({ mesh: ent.mesh, origin, t: 0, damageEnt:ent, dispose: ent.neutral || ent.ownedDamageBody });
    } else {
      this.scene.remove(ent.mesh);
      releaseMobileDamage(ent);
      if (ent.neutral || ent.ownedDamageBody) disposeTree(ent.mesh);
    }
  }

  /** 權威死亡的純渲染收尾;不讀 ents、不回寫任何戰鬥狀態。 */
  _updateDissolveGhosts(dt) {
    for (let i = this._dissolveGhosts.length - 1; i >= 0; i--) {
      const g = this._dissolveGhosts[i];
      g.t += dt;
      const k = dissolveOutAt(g.t);
      setDissolve(g.mesh, k, g.origin);
      if (k > 0) continue;
      this.scene.remove(g.mesh);
      if (g.damageEnt) releaseMobileDamage(g.damageEnt);
      if (g.dispose) disposeTree(g.mesh);
      this._dissolveGhosts.splice(i, 1);
    }
  }

  // 血條:HP 用紅色標示現有值,護盾(英雄雙層 HP 第一層)用玻璃藍疊在上方一列
  // 場景物件(中立可破壞物):被攻擊前不顯示,一旦受損掛無框細血條(與砲塔/主堡的有框條區分)
  _updateHpBar(ent) {
    if (ent.isSelf) return;
    // 中立場景物(障礙/防空陣地)走無框細血條;平民維持舊有框條(同一般單位讀感)
    if (ent.neutral && !ent.civ) return this._updateSceneHpBar(ent);
    const frac = Math.max(0, ent.hp / ent.max);
    const maxSp = ent.maxSp || 0;
    const sfrac = maxSp > 0 ? Math.max(0, (ent.sp || 0) / maxSp) : 0;
    if (frac >= 1 && (maxSp <= 0 || sfrac >= 1) && !ent.bar) return;   // 滿血且護盾滿(或無護盾)→ 不建條
    if (!ent.bar) {
      const w = ent.isStatic ? 18 : 5, hh = w * 0.09;
      const M = hh * 0.26;                      // 框邊寬
      const hasSp = maxSp > 0;
      const pitch = hh * 1.55;                   // 護盾列高(與 HP 列間留間隔,沿用舊 shY)
      // BOSS 多段血條:上層覆蓋下層 —— 四段同軌同幾何疊放、早段在前(z 高),
      // 各段寬 = 自身區間剩餘,上段扣掉的部分才露出下段;一般單位維持單列。
      const isBossBar = ent.bossSeg != null;
      const stackH = hasSp ? pitch + hh : hh, cy = hasSp ? pitch / 2 : 0;
      // 全部走 transparent + 顯式 renderOrder(z 疊序直翻繪製順序):框→槽→填色→刻痕的
      // 分層不再賭 three 的排序細節,紅 HP / 玻璃藍護盾在任何角度都壓在框與底槽之上。
      const plane = (color, opacity, z, pw = w, ph = hh) => {
        const m = new THREE.Mesh(new THREE.PlaneGeometry(pw, ph),
          new THREE.MeshBasicMaterial({ color, transparent: true, opacity, depthTest: false, depthWrite: false }));
        m.position.z = z;
        m.renderOrder = 990 + Math.round(z * 100);
        return m;
      };
      const grp = new THREE.Group();
      // 外框:雙層描邊(暗外緣 + 金屬灰內緣)罩住整組,擺脫舊版單調的裸長條
      // NPC BOSS:再往外一圈**光暈**,顏色隨已擊破的 HP 段數走(黑>藍>銀>金,見 data.js BOSS)。
      // 只有 BOSS 建這一片(一般單位連幾何都不生 ⇒ 逐位元同舊制);顏色逐幀由下方更新。
      if (isBossBar) {
        const glow = plane(0x000000, 0.55, -0.05, w + M * 5.2, stackH + M * 5.2);
        glow.position.y = cy;
        grp.add(glow);
        ent.barGlow = glow;
      }
      const frame = plane(0x05070a, 0.94, -0.03, w + M * 2.4, stackH + M * 2.4); frame.position.y = cy;
      // BOSS 外框吃逐段色(黑>藍>銀>金,與光暈同一格);一般單位維持深色框
      if (isBossBar) ent.barFrame = frame;
      const inner = plane(0x39424c, 0.95, -0.02, w + M, stackH + M);            inner.position.y = cy;
      grp.add(frame); grp.add(inner);
      grp.add(plane(0x111417, 1, 0));            // HP 底槽
      // HP 填充:一般單位沿用敵我單色;BOSS 四段同軌疊放(z 階梯:早段在前蓋住晚段,
      // 色建條時烤死 SEG_FILL,寬逐幀由下方按自身區間剩餘推)
      const fills = [];
      if (isBossBar) {
        for (let k = 0; k < bossSegN(); k++) {
          const fg = plane(new THREE.Color(bossSegFill(k)).getHex(), 1,
            0.02 + (bossSegN() - 1 - k) * 0.01);
          grp.add(fg);
          fills.push(fg);
        }
      } else {
        // 敵我配色:敵方紅 / 友方綠(護盾玻璃藍不動);中立/未知沿用紅
        const foeInit = ent.side && this.side ? ent.side !== this.side : true;
        const fg = plane(foeInit ? 0xe23b34 : 0x35d06a, 1, 0.02);
        grp.add(fg);
        fills.push(fg);
      }
      // 分段刻痕(間隔):一般單位才有 —— BOSS 的段就是列本身,不再畫線
      if (!isBossBar) {
        const segN = ent.isStatic ? 10 : 5, tickW = Math.max(0.05, w * 0.014);
        for (let s = 1; s < segN; s++) {
          const tk = plane(0x111417, 0.95, 0.05, tickW, hh);
          tk.position.set(-w / 2 + (w / segN) * s, 0, 0); grp.add(tk);
        }
      }
      let sfg = null;
      if (hasSp) {                               // 護盾:玻璃藍,獨立一列並與 HP 列留間隔
        const sbg = plane(0x0a1723, 0.85, 0.01); sbg.position.y = pitch;
        sfg = plane(0x7fd4ff, 0.95, 0.03);       sfg.position.y = pitch;
        grp.add(sbg); grp.add(sfg);
        if (!isBossBar) {
          const segN = ent.isStatic ? 10 : 5, tickW = Math.max(0.05, w * 0.014);
          for (let s = 1; s < segN; s++) {
            const tk = plane(0x0a1723, 0.95, 0.05, tickW, hh);
            tk.position.set(-w / 2 + (w / segN) * s, pitch, 0); grp.add(tk);
          }
        }
      }
      // 靜態建築(砲塔/主堡)的血條貼著頂端(剛好在上方,不再高高浮起);單位維持 2.2 抬高。
      // 高度用 spawn 時的基準包圍盒(dimTop)—— 事後的 Box3 會把受擊殼/敵方標記一起量進去。
      const top = ent.dimTop ?? (() => {
        const box = new THREE.Box3().setFromObject(ent.mesh);
        return box.max.y - box.min.y;
      })();
      grp.position.y = top + (ent.isStatic ? 1.4 : 2.2);
      ent.mesh.add(grp);
      ent.bar = grp; ent.barFills = fills; ent.barSfg = sfg; ent.barW = w;
    }
    // 敵我配色逐幀對齊(觀戰切換視角邊跟著換色,不只建條那一幀)。
    // BOSS 不吃敵我色:各段填充是建條時烤死的段純色(SEG_FILL 淺白→鮮豔),
    // 寬 = 自身區間剩餘(上段蓋下段,扣掉才露出來);外框與光暈走逐段框色,
    // 進段才換(純表現,權威段位來自快照 bs)。
    if (ent.bossSeg != null) {
      if (ent.barGlow && ent.barGlowSeg !== ent.bossSeg) {
        ent.barGlowSeg = ent.bossSeg;
        const segCol = bossGlow(ent.bossSeg);
        ent.barGlow.material.color.set(segCol);
        if (ent.barFrame) ent.barFrame.material.color.set(segCol);
      }
      for (let k = 0; k < ent.barFills.length; k++) {
        const f = bossSegFrac(frac, k);
        ent.barFills[k].scale.x = Math.max(0.001, f);
        ent.barFills[k].position.x = -(1 - f) * ent.barW / 2;
      }
    } else {
      ent.barFills[0].material.color.set(ent.side && this.side && ent.side === this.side ? 0x35d06a : 0xe23b34);
      ent.barFills[0].scale.x = Math.max(0.001, frac);
      ent.barFills[0].position.x = -(1 - frac) * ent.barW / 2;
    }
    if (ent.barSfg) {
      ent.barSfg.scale.x = Math.max(0.001, sfrac);
      ent.barSfg.position.x = -(1 - sfrac) * ent.barW / 2;
      ent.barSfg.visible = sfrac > 0;
    }
  }

  /**
   * 場景物件無框細血條:滿血不建條(被攻擊才顯示);殘骸/地面狀態不掛條。
   * 純表現層,HP 權威值來自快照。
   */
  _updateSceneHpBar(ent) {
    if (ent.collapsed) return;   // 殘骸不再顯示血條
    // 可破壞場景物才掛條:實體障礙 + 防空陣地;地面狀態/中繼站/火場不掛
    if (!sceneDamageProfile(ent.kind)) return;
    const frac = ent.max > 0 ? Math.max(0, ent.hp / ent.max) : 1;
    if (frac >= 1) {
      if (ent.bar) { ent.mesh.remove(ent.bar); ent.bar = null; ent.barFg = null; }
      return;
    }
    if (!ent.bar) {
      const w = 10, hh = 0.28;
      const plane = (color, opacity, z) => {
        const m = new THREE.Mesh(new THREE.PlaneGeometry(w, hh),
          new THREE.MeshBasicMaterial({ color, transparent: true, opacity, depthTest: false, depthWrite: false }));
        m.position.z = z;
        m.renderOrder = 990 + Math.round(z * 100);
        return m;
      };
      const grp = new THREE.Group();
      grp.add(plane(0x111417, 1, 0));            // 無框底槽
      const fg = plane(0xe23b34, 1, 0.02);       // 現有 HP:紅
      grp.add(fg);
      grp.position.y = (ent.colH || 6) + 1.0;
      ent.mesh.add(grp);
      ent.bar = grp; ent.barFg = fg; ent.barW = w;
    }
    ent.barFg.scale.x = Math.max(0.001, frac);
    ent.barFg.position.x = -(1 - frac) * ent.barW / 2;
  }

  /**
   * 場景物件坍塌演出:壓成低矮殘骸 + 確定性傾倒(種子 = 實體 id,跨端一致),
   * 藏血條、卸受損特效(殘留火場是伺服器另發的火場實體)。只做一次。
   */
  _applyCollapse(ent, instant) {
    if (!ent || ent.collapsed) return;
    applySceneDamage(ent, 3);
    ent.collapsed = true;
    if (ent.bar) { ent.mesh.remove(ent.bar); ent.bar = null; ent.barFg = null; }
    if (ent.dmgFx) { ent.mesh.remove(ent.dmgFx); disposeTree(ent.dmgFx); ent.dmgFx = null; this.damaged.delete(ent); }
    ent.dmgStage = 0;
    const s = (ent.id % 2 === 0 ? 1 : -1);
    const scaleY = ent.mesh.scale.y, rx = ent.mesh.rotation.x, rz = ent.mesh.rotation.z;
    const pose = (f) => {
      ent.mesh.scale.y = scaleY * (1 - 0.65 * f);
      ent.mesh.rotation.z = rz + s * 0.12 * f;
      ent.mesh.rotation.x = rx + 0.08 * f;
    };
    if (instant) pose(1);
    else {
      const controller = new THREE.Group();
      this.effects.push({ obj: controller, ttl: 0.7, fade: (o, f) => pose(1 - f * f), dispose: () => pose(1) });
    }
    const rf = SCENE_STRUCT?.RUBBLE_F || 0.45;
    ent.colR = (ent.colR || 0) * rf;
    ent.colH = (ent.colH || 6) * 0.35;
    if (!instant) {
      sceneDamageBurst(this.scene, this.effects, ent, 3);
    }
  }

  /**
   * 受損視覺化(vfx makeDamageFx):依快照 HP 比例掛/卸兩階特效(1=冒煙+裂痕、2=失火+破損)。
   * 純表現層,只驅動視覺;跳過自機(FPV 機體隱藏)/中立物/平民/餌機/自殺機(體型縮放或短命)。
   * 用 dimTop/dimH/dimR(spawn 時基準包圍盒,已排除受擊殼/血條)量體 —— 與血條/標記同一把尺。
   */
  _updateDamageStage(ent) {
    if (ent.isSelf || ent.civ || ent.decoy || ent.kami) return;
    // 中立物:只有可破壞場景物(實體障礙 + 防空陣地)掛火災階段,
    // 與砲塔/主堡同閾值(DMG_FX);地面狀態與坍塌殘骸不掛
    if (ent.neutral && !sceneDamageProfile(ent.kind)) return;
    if (ent.collapsed) return;
    if (!ent.max || ent.max <= 0) return;
    let stage = 0;
    if (!ent.dead) {
      const frac = ent.hp / ent.max;
      if (frac <= DMG_FX.HEAVY_F) stage = 2;
      else if (frac <= DMG_FX.LIGHT_F) stage = 1;
    }
    if (stage === (ent.dmgStage || 0)) return;
    ent.dmgStage = stage;
    if (stage === 0) {
      if (ent.dmgFx) { ent.mesh.remove(ent.dmgFx); disposeTree(ent.dmgFx); ent.dmgFx = null; }
      this.damaged.delete(ent);
      return;
    }
    if (!ent.dmgFx) {
      ent.dmgFx = makeDamageFx({ r: ent.dimR || 2, top: ent.dimTop || 3, h: ent.dimH || 3,
        fire: sceneDamageProfile(ent.kind)?.fire !== false, surfaceCracks: !sceneDamageProfile(ent.kind) });
      ent.mesh.add(ent.dmgFx);
      ent._streamMesh = null;
      this.damaged.add(ent);
    }
    ent.dmgFx.userData.setStage(stage);
  }

  /** 受損特效逐幀動畫(煙上升/火舌閃爍/火星飄散);機體不可見(陣亡/駐守)時略過 */
  _updateDamageFx(dt, now) {
    for (const ent of this.damaged) {
      if (ent.mesh.visible) ent.dmgFx.userData.update(dt, now);
    }
  }

  /**
   * 敵方標示:目標一進視野(= 出現在快照裡)就在頭上掛陣營箭頭,淡入 + 上下浮沉。
   * depthTest 關掉 = 被掩體擋住仍看得到標記(標的已被己方偵知);離開視野時 ent 被移除,
   * 標記是 mesh 的子節點 → 自動消失。
   */
  _enemyMark(ent, dt, now) {
    if (!ent.mark) {
      // 基準包圍盒(排除受擊殼/血條):否則塔的標記會疊在受擊殼頂上再 +3.4
      const h = Math.max(2, ent.dimH ?? (() => {
        const box = new THREE.Box3().setFromObject(ent.mesh);
        return box.max.y - box.min.y;
      })());
      const sp = new THREE.Sprite(new THREE.SpriteMaterial({
        map: factionMarkTex(ent.side), transparent: true, opacity: 0, depthTest: false, depthWrite: false,
      }));
      sp.scale.setScalar(Math.max(3.6, h * 0.75));
      sp.renderOrder = 998;
      ent.markY = (ent.dimTop ?? h) + 3.4 + sp.scale.y * 0.5;   // 讓開血條(頂端 + 2.2)
      ent.mesh.add(sp);
      ent.mark = sp;
    }
    const m = ent.mark.material;
    m.opacity = Math.min(0.92, m.opacity + dt * 3.5);                 // 進入視野:淡入
    ent.mark.position.y = ent.markY + Math.sin(now * 2.6) * 0.45;     // 浮沉
  }

  /**
   * 友方標示:同陣營單位頭上的小型圓徽,淡入 + 輕微浮沉。
   * 與 `_enemyMark` 分形(圓徽 vs 下指箭頭),混戰中只看輪廓即分敵我;
   * 尺寸與不透明度刻意小一號 —— 友軍是背景資訊,不搶敵方箭頭的注意。
   */
  _allyMark(ent, dt, now) {
    if (!ent.side) return;
    if (!ent.allyMark) {
      const h = Math.max(2, ent.dimH ?? (() => {
        const box = new THREE.Box3().setFromObject(ent.mesh);
        return box.max.y - box.min.y;
      })());
      const sp = new THREE.Sprite(new THREE.SpriteMaterial({
        map: allyMarkTex(ent.side), transparent: true, opacity: 0, depthTest: false, depthWrite: false,
      }));
      sp.scale.setScalar(Math.max(2.4, h * 0.5));
      sp.renderOrder = 997;
      ent.allyMarkY = (ent.dimTop ?? h) + 2.6 + sp.scale.y * 0.5;
      ent.mesh.add(sp);
      ent.allyMark = sp;
    }
    const m = ent.allyMark.material;
    m.opacity = Math.min(0.8, m.opacity + dt * 3);
    ent.allyMark.position.y = ent.allyMarkY + Math.sin(now * 2.2 + 1.3) * 0.3;
  }

  /** 快照裡的飛彈同步:建/移/更新目標點(渲染時再插值) */
  _syncMissiles(sm, events = []) {
    const seen = new Set();
    for (const s of sm) {
      seen.add(s.id);
      let ms = this.samMeshes.get(s.id);
      if (!ms) {
        // 彈藥同源(2026-07-22):塔射防空飛彈與英雄飛彈同一顆 projectileMesh(放大 1.55 = 舊 SAM 長度)
        const mesh = projectileMesh({ type: 'missile' }, { hue: 0xff6633 });
        mesh.scale.setScalar(1.55);
        this.scene.add(mesh);
        const size=new THREE.Box3().setFromObject(mesh).getSize(new THREE.Vector3());
        ms = { id:s.id,kind:'missile',mesh,dimH:size.y,dimTop:size.y/2,dimR:Math.max(size.x,size.z)/2,
          tgt: new THREE.Vector3(), prev: new THREE.Vector3(), age: 0 };
        const y0 = this.terrain.heightAt(s.x, -s.z) + s.y;
        mesh.position.set(s.x, y0, -s.z);
        ms.tgt.copy(mesh.position);
        this.samMeshes.set(s.id, ms);
      }
      if (Number.isFinite(s.hp) && s.m>0) {
        const stage=sceneDamageStage(s.hp,s.m);
        if (ms.sceneStage!=null && stage>ms.sceneStage) sceneDamageBurst(this.scene,this.effects,ms,stage);
        ms.hp=s.hp; ms.max=s.m;
        applySceneDamage(ms,stage); this._updateDamageStage(ms);
      }
      ms.prev.copy(ms.tgt);
      // 飛彈 y 是離地高度(以目標地面為準做近似)
      ms.tgt.set(s.x, this.terrain.heightAt(s.x, -s.z) + s.y, -s.z);
    }
    for (const [id, ms] of this.samMeshes) {
      if (!seen.has(id)) {
        if (events.some(ev=>ev.e==='boom' && ev.missileId===id)) sceneDamageBurst(this.scene,this.effects,ms,3);
        this.damaged.delete(ms); this.scene.remove(ms.mesh); releaseMobileDamage(ms); disposeTree(ms.mesh); this.samMeshes.delete(id);
      }
    }
  }

  // ---------------- 危險區:地雷 / 物資 / 火場 / 淹水 ----------------
  /** 開戰時伺服器發一次的靜態危險區資料(地雷位置;雙方都要用眼睛掃雷) */
  onField(m) {
    for (const mesh of this.mineMeshes.values()) this.scene.remove(mesh);
    this.mineMeshes.clear();
    for (const [x, z, id] of m.mines || []) {
      const wz = -z;   // 模擬 z=北 → three z=南
      const bump = buildMineBump(this.terrain.sampleColor?.(x, wz));
      bump.position.set(x, this.terrain.heightAt(x, wz) + 0.05, wz);
      this.scene.add(bump);
      this.mineMeshes.set(id, bump);
    }
  }

  /** 地雷突起:靠近才浮現(SEE_M 內漸顯、CLEAR_M 內全顯);節流 8Hz */
  _updateMines(now) {
    if (now - this._mineCheckAt < 0.12) return;
    this._mineCheckAt = now;
    const M = GAME.MINES;
    const px = this.pos.x, py = this.pos.y, pz = this.pos.z;
    for (const bump of this.mineMeshes.values()) {
      const p = bump.position;
      const d = Math.hypot(px - p.x, py - p.y, pz - p.z);
      if (d > M.SEE_M) { bump.visible = false; continue; }
      bump.visible = true;
      bump.material.opacity = Math.min(1, (M.SEE_M - d) / Math.max(1, M.SEE_M - M.CLEAR_M));
    }
  }

  _syncLoot(lt) {
    const seen = new Set();
    for (const l of lt) {
      seen.add(l.id);
      if (this.lootMeshes.has(l.id)) continue;
      const g = buildLoot(!!l.a, !!l.f);
      g.position.set(l.x, this.terrain.heightAt(l.x, -l.z), -l.z);
      this.scene.add(g);
      this.lootMeshes.set(l.id, g);
    }
    for (const [id, g] of this.lootMeshes) {
      if (!seen.has(id)) { this.scene.remove(g); this.lootMeshes.delete(id); }
    }
  }

  _syncAirdrop(ad) {
    const seen = new Set();
    for (const a of ad) {
      seen.add(a.id);
      if (this.airdropMeshes.has(a.id)) continue;
      const g = buildAirdrop(a.s || 'S');
      const gy = this.terrain.heightAt(a.x, -a.z);
      g.position.set(a.x, gy, -a.z);
      // 首見即起飄降:d=1(尚未落地)從 DROP_H 高處下降;無 d 表示中途進場,直接落地
      g.userData.groundY = gy;
      g.userData.bornT = performance.now() / 1000;   // 與 _updateAirdrop 的 now 同時基
      g.userData.landing = !!a.d;
      this.scene.add(g);
      this.airdropMeshes.set(a.id, g);
    }
    for (const [id, g] of this.airdropMeshes) {
      if (!seen.has(id)) { this.scene.remove(g); this.airdropMeshes.delete(id); }
    }
  }

  _updateAirdrop(dt, now) {
    for (const g of this.airdropMeshes.values()) {
      const u = g.userData;
      const age = now - (u.bornT || now);
      const t = AIRDROP.LAND_S > 0 ? Math.min(1, age / AIRDROP.LAND_S) : 1;
      const landed = !u.landing || t >= 1;
      // 飄降:從 DROP_H 高處等速下降到地面(ease-out 收尾),落地後空投傘收起、改顯示地面攤開傘
      g.position.y = u.groundY + (u.landing ? AIRDROP.DROP_H * (1 - t) * (1 - t) : 0);
      if (u.chute) u.chute.visible = !landed;
      if (u.groundChute) u.groundChute.visible = landed;
      if (u.halo) u.halo.visible = landed;
      if (landed) {
        // 攤開傘/光柱是偏置的 → 整體不再旋轉(否則傘會繞著箱子公轉);只讓木箱自轉+起伏當拾取提示
        if (u.crate) {
          u.crate.rotation.y += dt * 0.6;
          u.crate.position.y = Math.sin(now * 2.0 + g.position.x) * 0.14;
        }
      } else {
        g.rotation.y += dt * 0.3;   // 飄降中整傘微轉
      }
    }
  }

  _updateLoot(dt, now) {
    for (const g of this.lootMeshes.values()) {
      g.rotation.y += dt * 1.6;
      g.children[0].position.y = 1.0 + Math.sin(now * 2.2 + g.position.x) * 0.18;
    }
    // 火場火舌閃爍（天氣聯動：大雨/大雪熄火、強風增強）
    // fireDotMul 取本地天氣動態（純表現層；客戶端自算，不改任何權威狀態）
    const _weatherDyn = this.envFx?.getWeatherDynamics?.() ?? null;
    const _firVisMul = fireDotMul(_weatherDyn);   // 0 = 完全熄滅；>1 = 強風助燃
    for (const grp of this.flamers) {
      stepFireVisual(grp, now, _firVisMul, _weatherDyn);
    }
  }

  /** 淹水區:地面機體深水行進大幅減速(限制但不封鎖;飛行型態/騰空不受影響) */
  _zoneSlow() {
    if (this._flying() || this._env?.air) return 1;
    for (const f of this.floods) {
      if (Math.hypot(this.pos.x - f.x, this.pos.z - f.z) <= f.r) {
        const now = performance.now() / 1000;
        if (now - this._floodWarnAt > 8) {
          this._floodWarnAt = now;
          this.hud.feed?.('🌊 淹水區:機甲涉水速度大減!');
        }
        return f.slow;
      }
    }
    return 1;
  }

  /**
   * 座艙眼位離機體底的高度(公尺)。唯一縫:_updatePlayer 末段的相機 eye 與 _envAt 的
   * 「視線高度 vs 觸發水平面」共用同一式 —— 蓄力下蹲(CROUCH_M)一併計入,所以蓄力時
   * 眼位真的會沉進水面/沼面,狀態判定與畫面一致。
   */
  _eyeH() {
    const vw = heroView(this.heroKind, this.ch, this._flying());
    return this.selfH * vw.e
      - (!this._flying() ? this.charge * (this.isMorph ? MORPH.CROUCH_M : CJUMP.CROUCH_M) : 0);
  }

  /**
   * 領機當幀環境。回傳 { code, depth, ground, air }:
   *  - ground:腳下地表分類(0 乾 / 1 水 / 2 沼,biomes.terrainEnvCode 同規則 WYSIWYG)——
   *    驅動「涉水/陷沼」移動減速,只看有沒有踩在水沼裡。
   *  - code:**地形異常狀態**(0/1/2)= ground 再過 data.envTrigger 的完全沉浸門檻 ——
   *    驅動 wet 回報(伺服器減傷/電力與護盾減速)、水下帷幕。
   *    機體(含地面與飛行)進入水域/沼澤下沉至機頂在水面/沼澤面下時觸發異常狀態。
   *  - air:騰空(跳躍/蓄力跳躍離地)—— 一律當乾地零狀態,即「跳躍期間不吃地面傷害」。
   * 空中飛行(在水面之上)、站在橋面/結構物上(表面高於地形 >1.2m)同樣視為乾地。
   * 每幀 _updatePlayer 開頭算一次存 this._env;移動減速、pos 回報、火場霧化皆讀它。
   */
  _envAt() {
    const DRY = { code: 0, depth: 0, ground: 0, air: false };
    const x = this.pos.x, z = this.pos.z;
    const s = this._surf(x, z, this.pos.y);
    const wy = this.terrain.waterY;
    const floor = s;
    const ground = terrainEnvCode(this.terrain, x, z);
    const planeY = ground === 1 ? wy : (ground === 2 && wy != null ? wy + WATER.SWAMP_BAND : null);
    const depth = planeY != null ? Math.max(0, planeY - this.pos.y) : 0;
    const isFrozen = isWeatherFrozen();
    const code = envTrigger(ground, wy, this.pos.y, this.selfH, isFrozen);

    // 飛行型態:沒入水面/沼面下 (code > 0) 觸發流體沉浸異常狀態;空中 (code === 0) 恆為乾地
    if (this._flying()) {
      if (code > 0) return { code, depth, ground, air: false };
      return DRY;
    }
    // 地面型態:騰空跳躍 (離地且機頂未沒入流體) 視為乾地
    if (this.pos.y - floor > AIR.OFF_GROUND) {
      if (code > 0) return { code, depth, ground, air: false };
      return { ...DRY, air: true };
    }
    if (s - this.terrain.heightAt(x, z) > 1.2) return DRY;   // 橋面/結構物/冰面 = 乾
    return { code, depth, ground, air: false };
  }

  /**
   * 地形環境移動減速(2026-07-19 / 2026-08-22 重構):
   * 機體沉浸在水面/沼面下(code > 0)時,水下移動速度減至 1/2(水域) / 1/4(沼澤) / 1/8(凍結)。
   * 結冰水面上行走(code === 0)維持全速; 未完全沉浸之涉水/淺沼,維持線性過渡減速。飛行型態不受影響。
   */
  _terrainSlowF() {
    const e = this._env;
    if (!e || e.ground === 0) return 1;
    if (e.code > 0) return fluidFactor(e.code);   // 完全沉浸/凍結異常狀態:水域 1/2, 沼澤 1/4, 凍結 1/8
    if (isWeatherFrozen()) return 1;              // 結冰水面上行走維持全速
    if (e.ground === 2) {
      return Math.min(1, 1 - (1 - TERRAIN_FX.SWAMP_SLOW) * Math.min(1, e.depth / WATER.SWAMP_BAND));
    }
    // 水域淺水涉水:依深度插值
    return Math.min(WATER.SLOW, 1 - (1 - WATER.SLOW_MIN) * Math.min(1, e.depth / WATER.FULL_D));
  }

  /**
   * 沿水平方向 (dx,dz) 的**帶號地形坡度**(度;+ 上坡 / − 下坡)。移動減速與「爬不上去」共用
   * 這一支(唯一縫;倍率/阻擋角的規則住 data.js SLOPE)。三條豁免一律回 0(= 平地):
   *   ①飛行型態 / 騰空(_env.air):腳沒踩在坡上 —— 跳過懸崖邊緣、飛越山脊 MUST NOT 被坡度擋
   *   ②人造鋪面:站立面與裸地形高差 > SLOPE.STRUCT_M(橋面 / 隧道路面 / 屋頂)—— 工程結構不是山坡;
   *     隧道天花之下(tunnelAt 捕捉,含明隧道/引道路塹)一律視同人造鋪面 —— 明隧道段的側坡
   *     地表可與路面同高(高差閘抓不到),量到的是山坡橫斷坡度 = 洞內行進忽走忽卡
   *     (2026-07-31 使用者回報「進明隧道卡卡的」;洞內站的本來就是結構路面)
   *   ③位移量趨近 0
   * 坡度一律量**裸地形 heightAt**,MUST NOT 改量站立面 _surf:_surf 在上橋捕捉(deckAt)與隧道
   * 天花之下會整段跳階,拿它量坡度 = 上引道那一步被當成垂直峭壁,橋直接上不去。
   */
  _slopeDegAlong(x0, z0, y0, dx, dz) {
    const run = Math.hypot(dx, dz);
    const t = this.terrain;
    if (run < 1e-4 || !t?.heightAt || this._flying() || this._env?.air || this.vy > 0) return 0;
    const bare = (x, z) => {
      const tn = t.tunnelAt?.(x, z);
      if (tn && y0 < tn.ceil) return false;   // 洞內(隧道/明隧道/引道路塹):站的是結構路面
      const d = t.deckY?.(x, z, t.deckMargin || 3.0);
      if (d != null && Math.abs(this._surf(x, z, y0) - d) < 0.6) return false; // 橋面/引道:站的是結構路面
      return Math.abs(this._surf(x, z, y0) - t.heightAt(x, z)) <= SLOPE.STRUCT_M;
    };
    if (!bare(x0, z0) || !bare(x0 + dx, z0 + dz)) return 0;
    return slopeDeg(t.heightAt(x0 + dx, z0 + dz) - t.heightAt(x0, z0), run);
  }

  /**
   * 地形坡度的移動速度倍率(2026-07-30 使用者需求):上坡減速、下坡加速,平緩帶(兵線坡度
   * 限制 16° 內)恆 1。取樣走固定前瞻 SLOPE.PROBE_M —— MUST NOT 拿當幀位移量坡,否則同一道
   * 坡在不同幀率下會量出不同陡度(手感隨掉幀浮動)。move 為移動方向(長度 ≤ 1 的推杆量)。
   */
  _slopeMoveF(move) {
    const m = Math.hypot(move.x, move.z);
    if (m < 1e-4) return 1;
    const k = SLOPE.PROBE_M / m;
    return slopeMoveF(this._slopeDegAlong(this.pos.x, this.pos.z, this.pos.y, move.x * k, move.z * k));
  }

  /** 火場滯留 → 視野漸霧化(feature 6;純客戶端表現,傷害由伺服器 _tickHazards 結算)。
   *  進火場累積、離場 2× 速消散;滯留超過 FIRE_FOG_S 起霧、FIRE_FOG_MAX_S 達最濃。 */
  _updateEnvFog(dt) {
    // 騰空(跳躍/蓄力跳躍)不吃火場:與伺服器 _tickHazards 的離地豁免同一條規則
    let inFire = false;
    if (!this._flying() && !this._env?.air) {
      for (const f of this.fires) {
        if (Math.hypot(this.pos.x - f.x, this.pos.z - f.z) <= f.r) { inFire = true; break; }
      }
    }
    this._fireDwell = Math.max(0, this._fireDwell + (inFire ? dt : -dt * 2));
    const { FIRE_FOG_S, FIRE_FOG_MAX_S } = TERRAIN_FX;
    // 濃度存一份:狙擊鏡縮圈(`scopeRvminFog` 的火場輸入)與視野鎖定的鏡圈取景吃同一個值,MUST NOT 去讀 CSS 變數
    this._scopeFog = Math.max(0, Math.min(1, (this._fireDwell - FIRE_FOG_S) / (FIRE_FOG_MAX_S - FIRE_FOG_S)));
    this.hud.envFog?.(this._scopeFog);
  }

  /** 天氣濃霧 → 視野外霧罩(純客戶端表現;權威視野縮減由伺服器 `_visionSources` 結算)。
   *  密度存一份:全屏霧罩 opacity、狙擊鏡圈組合半徑(`scopeRvminFog`)、視野鎖定鏡圈取景吃同一個值。
   *  濃霧天遮罩蓋在狙擊鏡圈之內照樣生效(它與 scope-vig 同層、DOM 在後 ⇒ 霧在鏡圈裡、不擋 HUD)。 */
  _updateWeatherFog() {
    const d = Math.max(0, Math.min(1, this.envFx?.getWeatherDynamics?.()?.effectiveFog ?? 0));
    this._weatherFogD = d;
    this.hud.weatherFog?.(d);
  }

  /**
   * 水下/沼澤視野變色(2026-07-22,純表現層):鏡頭「眼位」沒入水面下 → 藍色帷幕,依沒入深度
   * 插值到近黑(FULL_D×2 ≈ 10m 滿檔);沒入點屬沼澤帶 → 混濁紫黑。判定用最終 camera.position
   * (非 _env.depth —— 那是腳下站立面深度,淺水站立眼在水上時會誤觸;2026-07-23 起 _envAt 的
   * 異常狀態改用同一把「眼位 vs 水平面」尺,見 data.envTrigger ⇒ 畫面變色與狀態生效同進同出),陣亡過場鏡頭墜水 /
   * 觀戰潛水同樣生效。
   * 每幀重算、無狀態殘留(死亡/重生/離水自然歸零)。
   */
  _updateWaterVeil() {
    if (!this.hud.waterVeil) return;
    const t = this.terrain;
    let v = null;
    if (t) {
      const cam = this.camera.position;
      const wy = t.waterY;
      if (wy != null) {
        // 水域帷幕在 waterY;沼澤帷幕在 swampY = waterY+SWAMP_BAND;過渡帶使用 aquaticTransition 漸進插值
        const trans = aquaticTransition(t, cam.x, cam.z);
        const lineY = trans.isSwamp ? wy + WATER.SWAMP_BAND : wy;
        if ((trans.isWater || trans.isSwamp || trans.mix > 0) && cam.y < lineY) {
          const k = Math.min(1, (lineY - cam.y) / (WATER.FULL_D * 2));
          const mixc = (a, b) => [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k, a[2] + (b[2] - a[2]) * k];
          const baseC = trans.veilCol;
          const darkC = trans.mix > 0.5 ? [22, 10, 34] : [3, 8, 14];
          const alpha = 0.42 + 0.13 * trans.mix + 0.45 * k;
          v = { c: mixc(baseC, darkC), a: alpha };
        }
      }
      if (!v && this._env?.code === 2 && !this._flying() && !this.dead) {
        v = { c: [98, 72, 124], a: 0.20 };   // 站沼:泥沼濁氣(淡紫)
      }
    }
    this.hud.waterVeil(v);
  }

  _updateMissiles(dt) {
    for (const ms of this.samMeshes.values()) {
      ms.age += dt;
      const p = ms.mesh.position;
      p.lerp(ms.tgt, lerpFPS(10, dt));
      // 朝飛行方向 + 煙尾
      const dir = ms.tgt.clone().sub(ms.prev);
      if (dir.lengthSq() > 0.5) {
        // projectileMesh 幾何 +z 朝前(舊 SAM 錐是 +y;2026-07-22 彈藥同源後統一 +z)
        ms.mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), dir.normalize());
      }
      stepProjectileFx(ms.mesh, ms.age, 260);
      ms.smoke = (ms.smoke || 0) + dt;
      if (ms.smoke > 0.06) {
        ms.smoke = 0;
        const puff = new THREE.Mesh(
          new THREE.SphereGeometry(0.5, 5, 4),
          new THREE.MeshBasicMaterial({ color: 0xcfd6da, transparent: true, opacity: 0.5 }),
        );
        puff.position.copy(p);
        this.scene.add(puff);
        this.effects.push({ obj: puff, ttl: 0.7, fade: (o, f) => { o.material.opacity = 0.5 * f; o.scale.setScalar(1 + (1 - f) * 3); } });
      }
    }
  }

  _onEvent(ev) {
    this.audio?.onEvent(ev, this.camera, this.youId);   // 遠端事件音效(單一縫;略過自身已本地播過的音)
    if (ev.e === 'die') {
      if (ev.kind === 'civilian') {   // 平民非機械:輕量倒地演出,不炸開(擊殺報酬走 civkill 事件)
        const [cx, cz] = [ev.x, -ev.z], cy = this.terrain.heightAt(cx, cz) + 1;
        comicPop(this.scene, this.effects, cx, cy + 1.6, cz, { hue: 0 });
        debrisBurst(this.scene, this.effects, cx, cy, cz, { accent: 0xb03030 });
        return;
      }
      const [x, z] = [ev.x, -ev.z];
      const big = ev.kind === 'tower' || ev.kind === 'base' || ev.kind === 'tank' || ev.kind === 'heli' || ev.kind === 'bunker';
      const hero = HERO_KINDS.has(ev.kind);
      // 實體場景物件的爆炸演出走 collapse 事件(殘骸保留);die 只留播報,避免雙重爆炸
      const sceneCollapse = ev.kind && sceneIsPhysical(ev.kind);
      if (!sceneCollapse) {
        const ey = this.terrain.heightAt(x, z) + 3;
        this._explosion(x, ey, z, big ? 14 : 5, big ? 0xff8844 : 0xffcc66);
        this._applyBlast(x, ey, z, big ? 16 : 6);   // 近距離看拆塔/坦克殉爆會被衝擊波推開
        // 漫畫式破壞回饋:機械碎片噴散 + BOOM 字卡 + hitstop(頓點強調重量感)
        debrisBurst(this.scene, this.effects, x, ey + (big ? 6 : 1), z,
          { big, accent: ev.side ? sideInfo(ev.side).color : 0xd8b04a });
        if (big || hero) {
          comicPop(this.scene, this.effects, x, ey + (ev.kind === 'base' ? 30 : ev.kind === 'tower' ? 20 : 8), z,
            { big: true, hue: hero ? 2 : 18 });
          this._hitstop = Math.max(this._hitstop || 0,
            ev.kind === 'base' ? 0.12 : ev.kind === 'tower' ? 0.08 : 0.05);
        }
      }
      if (ev.kind === 'aasite') {
        this.hud.feed?.('🎯 匿蹤防空陣地被摧毀,該片空域安全了!');
      } else if (ev.kind === 'decoy') {
        // 餌機被攔截擊落:誘餌任務結束(PiP 隨實體消失一起收掉)
        if (ev.pid === this.youId) this.hud.feed?.('💥 集束轟炸機被擊落,回傳畫面終止');
      } else if (HAZARDS[ev.kind] && !sceneIsPhysical(ev.kind)) {
        this.hud.feed?.(`🧹 ${HAZARDS[ev.kind].name}被清除,通道打開了!`);
      } else if (ev.kind === 'bunker') {
        this.hud.feed?.(`🏚️ ${sideInfo(ev.side).name}的碉堡被摧毀!(${THIRD.BUNKER_RESPAWN_S / 60} 分鐘後原地重建)`);
      } else if (hero) {
        this.hud.feed?.(`💥 ${SIDES[ev.side].name}的${UNITS[ev.kind].name}被擊毀!`);
      } else if (ev.kind === 'tower') {
        this.hud.feed?.(`🏗️ ${SIDES[ev.side].name}的防禦塔倒了!`);
      } else if (ev.kind === 'base') {
        this.hud.feed?.(`🏰 ${SIDES[ev.side].name}主堡被摧毀!`);
      }
    } else if (ev.e === 'collapse') {
      // 場景物件坍塌/傾倒:殘骸保留阻擋 + 地面殘留火場(伺服器另發火場實體經快照同步)
      const ent = this.ents.get(ev.id);
      if (ent && !ent.collapsed) this._applyCollapse(ent, false);
      const [cx, cz] = [ev.x, -ev.z];
      const cy = this.terrain.heightAt(cx, cz) + 2;
      if (!ent) debrisBurst(this.scene, this.effects, cx, cy + 1, cz, { big: false, accent: 0x8a7a5a });
      if (HAZARDS[ev.kind]) {
        if (ev.kind === 'car') this.hud.feed?.(ev.ev ? '⚡ 電動車起火了!鋰電池燒得久,遠離殘骸!' : '🚗 汽車被擊毀起火了!');
        else if (ev.kind === 'ship') this.hud.feed?.('🚢 擱淺船被擊毀起火了!');
        else this.hud.feed?.(`🏚️ ${HAZARDS[ev.kind].name}坍塌了,殘骸仍會阻擋!`);
      }
    } else if (ev.e === 'boom') {
      const [x, z] = [ev.x, -ev.z];
      const y = this.terrain.heightAt(x, z) + (ev.y != null ? ev.y : 2);   // 防空飛彈在空中炸
      // 自殺攻擊機被擊毀的原地半爆(2026-07-22):熾橙火球 + 迸射火星,讀感 = 無人機殉爆
      const col = ev.kami ? 0xff7a2a : (ev.sam ? 0xff7744 : 0xffaa33);
      this._explosion(x, y, z, ev.r * 0.8, col);
      // AoE:放射衝擊環擴張到傷害半徑邊界(貼地),空中炸點只留星爆
      if ((ev.y ?? 0) < 12) shockRing(this.scene, this.effects, x, this.terrain.heightAt(x, z), z, ev.r, ev.kami ? 0xffb066 : 0xffd27a);
      if (ev.kami) this._emberBurst(x, y + 1, z, 12, 3);
      this._applyBlast(x, y, z, ev.r);
      if (ev.mine && ev.tpid === this.youId) this.hud.feed?.('💣 你踩到地雷了!非正規路線佈有雷區!');
      if (ev.mid != null) {   // 觸發的地雷:移除微凸起
        const bump = this.mineMeshes.get(ev.mid);
        if (bump) { this.scene.remove(bump); this.mineMeshes.delete(ev.mid); }
      }
    } else if (ev.e === 'decoyBomb') {
      // 變形者集束炸彈(逐顆個別瞄準 / 被擊毀補投):拋擲一顆依機體類型上色/造型的炸彈,
      // **榴彈拋物線** + 翻滾拖尾 → 落地才引爆(依類型的地面演出)。伺服器傷害在事件當下即結算(純視覺延後)。
      this._spawnDecoyBomb(ev.x, -ev.z, ev.y != null ? ev.y : 8, ev.bomb || 'fire', ev.r || 14,
        ev.fx != null ? { x: ev.fx, z: -ev.fz, y: ev.fy || 0 } : null);
    } else if (ev.e === 'tree_grow') {
      shockRing(this.scene,this.effects,ev.x,this.terrain.heightAt(ev.x,-ev.z),-ev.z,8,0x587443);
    } else if (ev.e === 'moon_spawn') {
      shockRing(this.scene,this.effects,ev.x,this.terrain.heightAt(ev.x,-ev.z)+(ev.y || 4.5),-ev.z,ev.r || 3.5,0xc8d8ff);
    } else if (ev.e === 'moon_boom') {
      starburst(this.scene, this.effects, ev.x, ev.y || 4.5, -ev.z, (ev.r || 16) * 1.5, 0xcfd8ff);
      shockRing(this.scene, this.effects, ev.x, this.terrain.heightAt(ev.x, -ev.z), -ev.z, ev.r || 16, 0x8aa8ff);
    } else if (ev.e === 'cube_spawn') {
      shockRing(this.scene,this.effects,ev.x,this.terrain.heightAt(ev.x,-ev.z),-ev.z,ev.r || 5.5,0xffe28a);
    } else if (ev.e === 'fog_spawn') {
      const isAlly = ev.side === this.side;
      spawnFogVFX(this.scene, this.effects, { x: ev.x, z: -ev.z, r: ev.r || 35, dur: ev.dur, isAlly });
    } else if (ev.e === 'harpoon') {
      const fromX = ev.from ? ev.from[0] : (ev.sx ?? 0);
      const fromZ = ev.from ? ev.from[1] : (ev.sz ?? 0);
      const toX = ev.to ? ev.to[0] : (ev.tx ?? 0);
      const toZ = ev.to ? ev.to[1] : (ev.tz ?? 0);
      const fromY = this.terrain.heightAt(fromX, -fromZ) + 1.6;
      const toY = this.terrain.heightAt(toX, -toZ) + 1.6;
      spawnHarpoonVFX(this.scene, this.effects, {
        fx: fromX, fy: fromY, fz: -fromZ,
        tx: toX, ty: toY, tz: -toZ,
        hit: ev.hit ?? (ev.hitTargetId != null),
      });
    } else if (ev.e === 'reflect_barrier') {
      const getPos = () => {
        if (ev.pid === this.youId) return { x: this.pos.x, y: this.pos.y, z: this.pos.z, ry: this.yaw };
        const hero = this.remoteHeroes?.get(ev.pid) || this.bots?.get(ev.pid);
        if (hero) return { x: hero.x, y: hero.y, z: -hero.z, ry: hero.ry };
        return null;
      };
      spawnReflectBarrierVFX(this.scene, this.effects, { getPos, dur: ev.dur });
    } else if (ev.e === 'reflect_hit') {
      if (ev.x != null && ev.z != null) {
        starburst(this.scene, this.effects, ev.x, this.terrain.heightAt(ev.x, -ev.z) + 1.5, -ev.z, 0x66e0ff);
      }
    } else if (ev.e === 'entangle_link') {
      const getPositions = () => {
        const res = [];
        for (const tid of (ev.targets || [])) {
          const e = this.ents?.get(tid) || (tid === this.youId ? { x: this.pos.x, y: this.pos.y, z: -this.pos.z } : null);
          if (e) res.push({ x: e.x, y: e.y || this.terrain.heightAt(e.x, -e.z), z: -e.z });
        }
        return res;
      };
      spawnEntangleLinkVFX(this.scene, this.effects, { getPositions, dur: ev.dur });
    } else if (ev.e === 'thermite_spawn') {
      const mines = (ev.mines || []).map(m => ({
        x: m.x, y: this.terrain.heightAt(m.x, -m.z) + 0.15, z: -m.z, dur: m.dur || 12
      }));
      spawnThermiteMinesVFX(this.scene, this.effects, { mines });
    } else if (ev.e === 'thermite_detonate') {
      const py = this.terrain.heightAt(ev.x, -ev.z) + 0.1;
      spawnThermitePuddleVFX(this.scene, this.effects, { x: ev.x, z: -ev.z, y: py, r: ev.r || 6, dur: ev.dur || 5 });
      shockRing(this.scene, this.effects, ev.x, py, -ev.z, ev.r || 6, 0xff4500);
    } else if (ev.e === 'phase_start') {
      const getPos = () => {
        if (ev.pid === this.youId) return { x: this.pos.x, y: this.pos.y, z: this.pos.z };
        const hero = this.remoteHeroes?.get(ev.pid) || this.bots?.get(ev.pid);
        if (hero) return { x: hero.x, y: hero.y, z: -hero.z };
        return null;
      };
      spawnPhaseShiftVFX(this.scene, this.effects, { getPos, dur: ev.dur || 1.8 });
    } else if (ev.e === 'phase_exit') {
      const py = this.terrain.heightAt(ev.x, -ev.z);
      spawnPhaseExitVFX(this.scene, this.effects, { x: ev.x, z: -ev.z, y: py, r: ev.r || 6 });
    } else if (ev.e === 'decoy_beacon_spawn') {
      const dy = this.terrain.heightAt(ev.x, -ev.z) + 2.0;
      spawnDecoyBeaconVFX(this.scene, this.effects, { id: ev.id, x: ev.x, z: -ev.z, y: dy, dur: ev.dur || 6 });
    } else if (ev.e === 'flashbang_detonate') {
      const fy = this.terrain.heightAt(ev.x, -ev.z) + 2.0;
      spawnFlashbangVFX(this.scene, this.effects, { x: ev.x, z: -ev.z, y: fy, r: ev.r || 14 });
    } else if (ev.e === 'nanite_infected') {
      const getPos = () => {
        if (ev.targetId === this.youId) return { x: this.pos.x, y: this.pos.y, z: this.pos.z };
        const e = this.ents?.get(ev.targetId);
        if (e) return { x: e.x, y: e.y || this.terrain.heightAt(e.x, -e.z), z: -e.z };
        return null;
      };
      spawnNaniteSwarmVFX(this.scene, this.effects, { getPos, dur: ev.dur || 4.0 });
    } else if (ev.e === 'nanite_split') {
      const fEnt = this.ents?.get(ev.fromId);
      const tEnt = this.ents?.get(ev.toId);
      if (fEnt && tEnt) {
        spawnNaniteSplitVFX(this.scene, this.effects, {
          fx: fEnt.x, fz: -fEnt.z,
          tx: tEnt.x, tz: -tEnt.z,
        });
      }
    } else if (ev.e === 'singularity_launch') {
      const sy = this.terrain.heightAt(ev.x, -ev.z) + 2.5;
      spawnSingularityVFX(this.scene, this.effects, { x: ev.x, z: -ev.z, y: sy, dur: ev.dur || 3.0, r: ev.r || 18 });
    } else if (ev.e === 'singularity_implosion') {
      const iy = this.terrain.heightAt(ev.x, -ev.z) + 2.5;
      spawnSingularityImplosionVFX(this.scene, this.effects, { x: ev.x, z: -ev.z, y: iy, r: ev.r || 18 });
    } else if (ev.e === 'burn') {
      if (ev.pid === this.youId) {
        this._burnAt = performance.now() / 1000;
        // mul 由伺服器傳入:強風助燃 >1.0,正常 ≈1.0（舊事件無 mul 欄位時退回預設值 1）
        const mul = ev.mul ?? 1;
        this.trauma = Math.min(1, this.trauma + (mul >= 1.4 ? 0.40 : 0.25));
        if (mul >= 1.4) {
          this.hud.feed?.('🔥 強風助燃！火場極度猛烈，立刻撤離！');
        } else {
          this.hud.feed?.('🔥 你在火場中持續受創，快離開！');
        }
      }
    } else if (ev.e === 'freeze') {
      if (ev.pid === this.youId) {
        this.trauma = Math.min(1, this.trauma + 0.25);
        this.hud.feed?.('❄️ 機體沒入冰凍水面! 受到凍結異常狀態(行動力 1/8)並持續受創!');
      }
    } else if (ev.e === 'lightning_strike') {
      for (const p of ev.pts || []) {
        const x = p.x, z = -p.z;
        const y = this.terrain ? this.terrain.heightAt(x, z) + (p.y || 0) : (p.y || 0);
        this.envFx?.strikeLightningAt?.(x, p.absolute ? p.y : y, z);
        if (p.id === this.bodyId || (this.hero && p.id === this.hero.id) || p.id === this.youId) {
          this.hud?.feed?.(`⚡ 遭打雷閃電擊中! 受損 ${WEATHER_DEBUFFS.LIGHTNING.BASE_DMG} HP`);
          this._lastHurtAt = performance.now() / 1000;
          this.trauma = Math.min(1, this.trauma + 0.4);
        }
      }
    } else if (ev.e === 'loot') {
      if (ev.pid === this.youId) {
        if (ev.ammo) {
          // 稀有掉落:全武器彈藥即刻補滿、重武器 CD 清空(本地 HUD 同步)
          for (const [id, st] of Object.entries(this.wstate)) { st.ammo = this.wdef[id]?.mag ?? st.ammo; st.reloadEnd = 0; }
          this.hud.feed?.('🔋 拾獲彈藥補給:全武器裝滿!');
        } else if (ev.af) {
          const a = AFFIXES[ev.af];
          this.hud.feed?.(`✨ 拾獲詞綴強化【${a?.name || ev.af}】${a?.desc || ''}(${a?.dur || 0} 秒)`);
        } else {
          this.hud.feed?.(`💰 拾獲戰場物資 +$${ev.v}`);
        }
      }
    } else if (ev.e === 'airfall') {
      this.hud.feed?.(`🪂 偵測到 ${ev.n} 批空投物資落入戰場,搶先取得補給!`);
    } else if (ev.e === 'airdrop') {
      // 開箱星爆(稀有色由箱型決定;所有人可見「補給被拿走了」)
      const tone = ev.sz === 'L' ? 0xffd24a : ev.sz === 'M' ? 0xc9ced6 : 0xffb066;
      starburst(this.scene, this.effects, ev.x, this.terrain.heightAt(ev.x, -ev.z) + 3, -ev.z, tone);
      if (ev.pid === this.youId) {
        const box = ev.sz === 'L' ? '大型' : ev.sz === 'M' ? '中型' : '小型';
        if (ev.r === 'medkit') this.hud.feed?.(`🩹 拾獲${box}空投【急救包】裝甲 +${ev.hp}・護盾 +${ev.sp}`);
        else if (ev.r === 'battery') this.hud.feed?.(`🔋 拾獲${box}空投【電池】電力 +${ev.mp}(可破上限)・招式冷卻 −${ev.cd}s`);
        else this.hud.feed?.(`💰 拾獲${box}空投物資 +$${ev.v}`);
      } else if (ev.side && ev.side !== this.side) {
        this.hud.feed?.(`⚠️ ${(sideInfo(ev.side)?.name) || '敵方'}搶走了一箱空投物資!`);
      }
    } else if (ev.e === 'civkill') {
      // 擊殺平民/間諜的報酬回饋(死亡瞬間才揭露身分):只有擊殺者本人看得到明細
      if (ev.pid === this.youId) {
        const enemy = ev.cs !== this.side;
        const who = ev.spy ? (enemy ? '敵方間諜' : '我方間諜') : (enemy ? '敵方平民' : '我方平民');
        const gain = ev.v >= 0;
        this.hud.feed?.(`${gain ? '🎯' : '☠️'} ${who}:${gain ? '+' : ''}$${ev.v}`);
      }
    } else if (ev.e === 'civaid') {
      // 我方跟隨平民每 3 分提供的物資(依職業)
      if (ev.pid === this.youId) {
        const nm = ev.id == null ? (CIVILIANS[ev.prof]?.name || '平民')
          : generateCivilian(ev.id, ev.prof).occupation;
        const msg = ev.r === 'medkit' ? `急救包(裝甲 +${ev.hp}・護盾 +${ev.sp})`
          : ev.r === 'battery' ? `電池(電力 +${ev.mp}・冷卻 −${ev.cd}s)`
            : `資金(+$${ev.v})`;
        this.hud.feed?.(`🤝 跟隨的${nm}提供物資:${msg}`);
      }
    } else if (ev.e === 'civact') {
      if (ev.pid === this.youId) this.hud.feed?.(ev.act === 'follow' ? '🚶 平民開始跟隨你' : '👋 你驅離了一名平民');
    } else if (ev.e === 'civfree') {
      if (ev.pid === this.youId) this.hud.feed?.(`🕊️ 清空第三方營地!${ev.n} 名平民脫困並自動跟隨你(隨機陣營・不重生)`);
    } else if (ev.e === 'relay') {
      this.hud.feed?.(ev.side === this.side
        ? `📡 我方啟動偵察中繼站:全隊 ${FIELD.RELAY.VISION_S} 秒無霧視野!`
        : `⚠️ ${SIDES[ev.side].name}啟動了偵察中繼站,我方位置全數曝光!`);
      // 小地圖迷霧全掀(鏡像 sim.visionUntil 的 pulse 旁路)
      if (ev.side === this.side) this._pulseUntil = performance.now() / 1000 + FIELD.RELAY.VISION_S;
      starburst(this.scene, this.effects, ev.x, this.terrain.heightAt(ev.x, -ev.z) + 9, -ev.z,
        8, ev.side ? SIDES[ev.side].color : 0x66ffe0);
    } else if (ev.e === 'sam') {
      // 發射端視覺(2026-07-22 規則 3):防空陣地發射點火光 + 揚塵 —— 飛彈不再憑空出現
      if (ev.from) {
        const sx = ev.from[0], sz = -ev.from[1];
        const sy = this.terrain.heightAt(sx, sz) + 2;
        const launch = new THREE.Vector3(sx, sy, sz);
        unitShotFx(this.scene, this.effects, launch, launch, { kind: 'base', color: 0xffc79a, core: 0xffe9c8 });
      }
      if (ev.tpid === this.youId) {
        this.hud.feed?.(ev.ambush
          ? '🚨 匿蹤防空陣地開火!命中即墜毀,快擊落飛彈或回兵線走廊!'
          : '🚨 防空飛彈鎖定你了,快規避!');
      }
    } else if (ev.e === 'lock') {
      // 伺服器確認的準星鎖定:我鎖到人 → 目標亮光暈;我被鎖 → HUD 警告(LOCK.WARN_S 後自動退)
      if (ev.pid === this.youId) {
        const ent = this.ents.get(ev.tid);
        if (ent) this._setLockGlow(ent);
      } else if (ev.tpid === this.youId) {
        this._lockedUntil = performance.now() / 1000 + LOCK.WARN_S;
      }
    } else if (ev.e === 'hurt') {
      // 受擊濺血:指名自己的事件才畫(伺服器已把同一 tick 同一攻擊者併成一筆)
      if (ev.tpid === this.youId) this._bloodSplat(ev);
    } else if (ev.e === 'cc') {
      // 控場位移(拉近):位置客戶端權威 —— 指名自己的事件才生效,自套朝彈著中心的衝量
      // (dash 先例的反向;NPC/bot/僚機由伺服器直接位移,不會收到這條)
      if (ev.k === 'pull' && ev.tpid === this.youId && !this.dead) {
        const wx = ev.x, wz = -ev.z;
        const dx = wx - this.pos.x, dz = wz - this.pos.z;
        const d = Math.hypot(dx, dz);
        if (d > 1) {
          const imp = Math.min(ev.imp || 18, d * 2);   // 近距離不過衝
          this.vel.x += dx / d * imp;
          this.vel.z += dz / d * imp;
          if (!this._flying()) this.vy = (this.vy ?? 0) + 3;   // 地面機體被拉離地(掀起感)
          this.trauma = Math.min(1, this.trauma + 0.3);
          this.hud.feed?.('🪝 被拉向彈著中心!');
        }
      }
    } else if (ev.e === 'iframe') {
      // 無敵幀(蓄力跳/變形中段):施放者機體亮相位光環;自己的由 _ccFeed 播報
      const ent = [...this.ents.values()].find((e2) => e2.pid === ev.pid && e2.hero && e2.mesh.visible);
      if (ent) {
        const p = ent.mesh.position;
        shockRing(this.scene, this.effects, p.x, p.y + (ent.dimH || 4) * 0.5, p.z, (ent.dimR || 3) * 1.6, 0xcfe8ff);
      }
    } else if (ev.e === 'decoy') {
      if (ev.pid === this.youId) {
        // 餌機(轟炸機)彈射分離:掛點瞬間抽離的機體震動(伺服器確認才震,請求被拒不會誤震)
        this.trauma = Math.min(1, this.trauma + SHAKE.DECOY);
        this.hud.feed?.(ev.slot === 'atk' ? '💣 攻擊招式載具升空:轟炸機自後方工事飛往落點投遞!'
          : ev.slot === 'def' ? '💣 防守招式載具升空:轟炸機自機側飛往落點投遞!'
          : ev.homing ? '💣 集束炸彈投放:轟炸機追蹤鎖定目標!' : '💣 集束炸彈投放:轟炸機直飛(無法操舵)');
      }
    } else if (ev.e === 'decoyLost') {
      if (ev.pid === this.youId) this.hud.feed?.(`📡 集束轟炸機超出 ${DECOY.LINK_M}m,鏈路中斷`);
    } else if (ev.e === 'hyper') {
      // 極音速飛彈發射:彈體本身是伺服器實體(走 ents 渲染),這裡只播報 + 發射點後燄
      if (ev.pid === this.youId) {
        this.hud.feed?.(ev.slot === 'atk' ? '🚀 攻擊招式載具發射:飛彈自後方工事飛往落點!'
          : ev.homing ? '🚀 極音速飛彈發射:鎖定目標,射後不理!' : '🚀 極音速飛彈發射:無鎖定,打向正前方');
      }
    } else if (ev.e === 'cast_start') {
      // 詠唱開始:播報 + 施法動作
      const c = CHARACTERS[ev.ch];
      const a = c?.[ev.slot];
      if (ev.pid === this.youId) {
        this.hud.feed?.(`⏳ ${c?.code || ''}【${a?.name || '招式'}】詠唱中...(${ev.dur?.toFixed(1)}s)`);
        this._castingUntil = performance.now() / 1000 + (ev.dur || 0.8);
        this.castLeft = ev.dur || 0.8;
      }
      const wx = ev.x, wz = -ev.z;
      let casterPos = null;
      if (ev.pid === this.youId) {
        casterPos = () => this.pos;
      } else {
        let best = null, bd = Infinity;
        for (const ent of this.ents.values()) {
          if (ent.pid !== ev.pid || ent.isSelf || !ent.hero || !ent.mesh.visible) continue;
          const d = (ent.mesh.position.x - wx) ** 2 + (ent.mesh.position.z - wz) ** 2;
          if (d < bd) { bd = d; best = ent; }
        }
        if (best) casterPos = () => best.mesh.position;
      }
      const cpNow = casterPos ? casterPos() : null;
      const dirCast = castDirF(ev.fx, cpNow && Math.hypot(wx - cpNow.x, wz - cpNow.z) > 12);
      const castT0 = performance.now() / 1000;
      for (const ent of this.ents.values()) {
        if (ent.pid !== ev.pid || ent.isSelf || !ent.hero) continue;
        ent.castFx = { t0: castT0, slot: ev.slot, dir: dirCast };
      }
    } else if (ev.e === 'cast') {
      // 招式施放:角色專屬演出(castfx.js:魔法陣/元素環繞/拳影劍氣/靈魂束縛……)+ 播報
      const c = CHARACTERS[ev.ch];
      const a = c?.[ev.slot];
      const wx = ev.x, wz = -ev.z;
      // 施放者錨點:自己 = 即時位置;他人 = 快照插值中的 ent(迷霧看不見 → null,錨定落點)。
      // 蜂群一 pid 三架 → 取離施放座標最近那架(自身型招式 ev.x/z 就是施放機位置)。
      let casterPos = null, scale = 4;
      if (ev.pid === this.youId) {
        casterPos = () => this.pos;
        scale = heroTargetH(this.heroKind, this.ch);
      } else {
        let best = null, bd = Infinity;
        for (const ent of this.ents.values()) {
          if (ent.pid !== ev.pid || ent.isSelf || !ent.hero || !ent.mesh.visible) continue;
          const d = (ent.mesh.position.x - wx) ** 2 + (ent.mesh.position.z - wz) ** 2;
          if (d < bd) { bd = d; best = ent; }
        }
        if (best) { casterPos = () => best.mesh.position; scale = best.dimH || 4; }
      }
      // 地面高走 surfaceAt 唯一縫(§2):以施放者當下高度當 curY —— 隧道內施放
      // 特效貼隧道路面、橋上施放貼橋面;裸 heightAt 會把演出釘上覆蓋段山頂。
      const surfY = (x, z) => this._surf(x, z, casterPos ? casterPos().y : this.terrain.heightAt(x, z));
      // 攻招載具遞送(ev.carrier):效果還在天上飛 —— 施法當下只演施法動作/立繪/播報,
      // 落點效果等載具抵達的 atkfx 事件再演(在這裡就開演 = 演出跑在結算前面,擊落也收不回來)
      if (!ev.carrier) {
        spawnCastFx(this.scene, this.effects, {
          ch: ev.ch, slot: ev.slot, lvl: ev.lvl || 1, fx: ev.fx, side: ev.side,
          at: new THREE.Vector3(wx, surfY(wx, wz), wz),
          casterPos, groundY: surfY,
          r: ev.r || 0, dur: ev.dur || 0, scale,
        });
      }
      // 施法動作(locomotion stepCastPose;與展示台共用,MUST NOT 另寫分叉):
      // 指向型招式(strike/dash/遠端 emp)= 定向動作(揮武/刺拳/踢腿),其餘 = 全向(吼叫/跺腳/旋轉…)
      const cpNow = casterPos ? casterPos() : null;
      const dirCast = castDirF(ev.fx, cpNow && Math.hypot(wx - cpNow.x, wz - cpNow.z) > 12);
      const castT0 = performance.now() / 1000;
      for (const ent of this.ents.values()) {
        if (ent.pid !== ev.pid || ent.isSelf || !ent.hero) continue;
        ent.castFx = { t0: castT0, slot: ev.slot, dir: dirCast };
      }
      // 偵察類招式(vision > 0)= 全隊無霧脈衝:小地圖迷霧全掀(鏡像 sim.visionUntil)
      const abV = heroAbility(ev.ch, ev.slot, ev.lvl)?.vision;
      if (abV && ev.side === this.side) {
        this._pulseUntil = Math.max(this._pulseUntil, performance.now() / 1000 + abV);
      }
      if (a) {
        const pct = Math.round((ev.frac ?? 1) * 100);
        const tag = ev.interrupted ? `⚡ [受擊強制施展 ${pct}%]` : `✨`;
        this.hud.feed?.(ev.side === this.side
          ? `${tag} ${c.code}【${a.name}】`
          : `⚠️ 敵方 ${c.code} 施放【${a.name}】!`);
        // 立繪演出:自己的招式一律演;敵方只演攻招(守招太頻繁會蓋住視野)
        const self = ev.pid === this.youId;
        if (self) { this._castingUntil = 0; this.castLeft = 0; }
        this.cutin.show(ev, self, ev.side ? SIDES[ev.side].color : '#ffffff');
        if (ev.slot === 'atk') this.trauma = Math.min(1, this.trauma + (self ? 0.45 : 0.25));
      } else if (ev.pid === this.youId) {
        this._castingUntil = 0; this.castLeft = 0;
      }
    } else if (ev.e === 'atkfx') {
      // 攻招載具抵達:效果在落點結算(伺服器 _atkArrive)—— 這裡補上落點演出。
      // 錨定落點(casterPos null),分批遞送(frac < 1)縮小尺寸 —— 看到多大 ≈ 拿到多少份
      const wx = ev.x, wz = -ev.z;
      const surfY = (x, z) => this._surf(x, z, this.terrain.heightAt(x, z));
      spawnCastFx(this.scene, this.effects, {
        ch: ev.ch, slot: ev.slot || 'atk', lvl: ev.lvl || 1, fx: ev.fx, side: ev.side,
        at: new THREE.Vector3(wx, surfY(wx, wz), wz),
        casterPos: null, groundY: surfY,
        r: ev.r || 0, dur: ev.dur || 0, scale: 4 * Math.sqrt(Math.max(0.25, ev.frac ?? 1)),
      });
    } else if (ev.e === 'crit') {
      // 爆擊(伺服器擲骰):自己打出 → 橘色大字回饋
      if (ev.pid === this.youId) {
        const wx = ev.x, wz = -ev.z;
        const y = this.terrain.heightAt(wx, wz) + (ev.y || 0) + 3;
        damageNumber(this.scene, this.effects, new THREE.Vector3(wx, y, wz), ev.v, { big: true });
        comicPop(this.scene, this.effects, wx, y + 2, wz, { big: false, hue: 28 });
        this.hud.hitmark?.();
      }
    } else if (ev.e === 'dodge') {
      // 閃避(伺服器擲骰):自己的攻擊被閃 → 目標頭上跳「Miss」(自己的射擊回饋,
      // 不吃旁觀距離上限 —— 射程邊界也要看得到);他人的閃避維持「閃」,只畫鏡頭附近的,避免全場刷字
      const wx = ev.x, wz = -ev.z, cam = this.camera.position;
      const mine = ev.pid != null && ev.pid === this.youId;
      if (mine || Math.hypot(wx - cam.x, wz - cam.z) < 140) {
        const y = this.terrain.heightAt(wx, wz) + (ev.y || 0) + 3;
        comicPop(this.scene, this.effects, wx, y, wz, mine ? { text: 'Miss', hue: 210 } : { text: '閃', hue: 190 });
      }
    } else if (ev.e === 'buy') {
      if (ev.pid === this.youId && ev.lvl != null) {
        // 超級升級只有一軌,直接顯示 LV(降級也會走這裡,見 sim._setSuperLvl)
        if (ev.item === 'super') { this.hud.feed?.(`⚡ 超級升級 LV${ev.lvl}/${SUPER_UPG.MAX}`); }
        else {
          const up = ECON.UPGRADES[ev.item];
          // 戰鬥面向(abil = 1 + upg):顯示階級 = 已購步數 + 1;防禦系統直接顯示 Lv
          this.hud.feed?.(`⬆️ ${up?.name || ev.item} Lv.${up?.abil ? ev.lvl + 1 : ev.lvl}`);
        }
      }
    } else if (ev.e === 'assist') {
      if (ev.pid === this.youId) this.hud.feed?.(`🤝 助攻 +$${ev.v}`);
    } else if (ev.e === 'creepUp') {
      // 陣營小兵強化:同陣營全員都看得到(共用強化,不是只有出錢的人)
      if (ev.side === this.side) this.hud.feed?.(`🐜 第 ${ev.lane + 1} 兵線小兵強化 LV${ev.lvl}${ev.pid === this.youId ? '' : '(隊友出資)'}`);
    } else if (ev.e === 'penalty') {
      if (ev.pid === this.youId && ev.v > 0) this.hud.feed?.(`💀 陣亡罰金 -$${ev.v}`);
    } else if (ev.e === 'siege') {
      // 攻堅階段被推平(劇情戰役;階段由伺服器定案,客戶端 MUST NOT 自己數塔)。
      // 2026-08-14 起**對白不掛在這裡**:使用者的順序是「區域 BOSS 被擊敗 → 對話 → 才拆得掉
      // 建築」⇒ 觸發點搬到 `siegeTalk`(伺服器的 `_bossFell`),這裡只剩戰況播報。
      this.hud.feed?.(ev.side === this.side
        ? `🛡 我方${SIEGE.NAMES[ev.stage] || ''}全數失守`
        : `⚔ 敵方${SIEGE.NAMES[ev.stage] || ''}已推平`);
    } else if (ev.e === 'siegeTalk') {
      // 區域 BOSS 被擊敗(該階最後一名)⇒ 播該階對白,同時伺服器開始倒數解鎖那一階的建築。
      // **只有敵方那一階才演出** —— 自己這邊的 BOSS 倒下播一段勝利者的對白等於幫對手慶祝。
      // 演出本身住 main.js(它才知道現在打的是哪一章、哪一個陣營),這裡只上拋。
      if (ev.side !== this.side) this.onSiege?.(ev.stage, ev.side);
    } else if (ev.e === 'bossSeg') {
      // 劇情戰役 BOSS 進入新階段:播放護盾補滿與對應血條框顏色特效
      const col = new THREE.Color(bossGlow(ev.seg)).getHex();
      for (const ent of this.ents.values()) {
        if (ent.pid === ev.pid && ent.mesh) {
          shockRing(this.scene, this.effects, ent.mesh.position.x, ent.mesh.position.y, ent.mesh.position.z, 22 * bossScaleF(ev.seg), col);
          starburst(this.scene, this.effects, ent.mesh.position.x, ent.mesh.position.y + (ent.dimH || 4) * 0.5, ent.mesh.position.z, 14 * bossScaleF(ev.seg), col);
        }
      }
    } else if (ev.e === 'plasma') {
      // 他人施放電漿扇形(自己那份已在 _tryFire 本地畫過)
      if (ev.pid !== this.youId) {
        const fx = ev.x, fz = -ev.z;
        // 起點優先解析射手機體的 rig 槍口錨(嘴砲/噴口);退路才用 ent 座標 + 高度概略
        const from = this._entMuzzle(ev.pid, ev.slot !== 'light' ? 'heavy' : 'light',
          new THREE.Vector3(fx, this.terrain.heightAt(fx, fz) + (ev.y || 0) + 2, fz));
        const dir3 = new THREE.Vector3(ev.dx, 0, -ev.dz).normalize();
        const arc = (ev.arc || 15) * Math.PI / 180;
        const up = new THREE.Vector3(0, 1, 0);
        const shooter = this._heroEntByPid(ev.pid);
        const pcol = CHARACTERS[shooter?.ch]?.visual?.hue ?? (ev.side === 'SWARM' ? 0xffcf7f : 0x7fe8ff);
        const heavy = ev.slot !== 'light';   // 電漿重武器 = 明顯焰舌;散彈輕武器 = 細一號
        const bar = !!ev.bar;
        const wF = 1, kMax = 2;
        this._muzzleBurst(from, heavy, ev.side);
        // 他人的離子吐息(與自機 _fanBlast 同一支 ionBreath —— 共用視覺入口,不另寫一套)
        if (heavy) {
          const core = this._shotCols(ev.side).hot;
          const clip = this._clipBeam(from, from.clone().addScaledVector(dir3, (ev.r || 150) * 0.82));
          ionBreath(this.scene, this.effects, from, clip.to, pcol,
            { r: 2.2 * wF, ttl: 0.45 * (bar ? 1.4 : 1), coil: bar ? 4 : 3, core,
              def: shooter ? this._heroDefOf(shooter.ch, 'heavy') : undefined });
        }
        for (let k = -kMax; k <= kMax; k++) {
          const dk = dir3.clone().applyQuaternion(new THREE.Quaternion().setFromAxisAngle(up, arc * k / kMax));
          const end = from.clone().addScaledVector(dk, (ev.r || 150) * 0.8);
          const clip = this._clipBeam(from, end);   // 扇形焰舌不畫穿牆(伺服器逐目標 LOS 已擋傷害)
          beamLine(this.scene, this.effects, from, clip.to, pcol, heavy ? { ttl: 0.26 * (bar ? 1.5 : 1), w: 0.22 * wF } : { ttl: 0.2, w: 0.09 });
          if (bar) starburst(this.scene, this.effects, clip.to.x, clip.to.y, clip.to.z, 3.2, pcol);
        }
        // 扇形武器不走 tracer 訊息 → 在此標記射手開火動畫(電漿噴湧的後座/射姿)
        this._markFire(ev.pid, heavy ? 'heavy' : 'light', performance.now() / 1000);
      }
    } else if (ev.e === 'shot') {
      // 開火事件(2026-07-17 全兵種化):曳光/槍口焰一律自射手機體的實際槍口射出、
      // 射手標記後座動畫並面向攻擊目標;榴彈兵(howitzer)畫拋物線曳光、砲管仰角與弧線一致
      const fx = ev.from ? ev.from[0] : (ev.x ?? 0);
      const fz = ev.from ? -ev.from[1] : -(ev.z ?? 0);
      const tx = ev.to ? ev.to[0] : (ev.tx ?? 0);
      const tz = ev.to ? -ev.to[1] : -(ev.tz ?? 0);
      const to = new THREE.Vector3(tx, this.terrain.heightAt(tx, tz) + (ev.ty || 0) + 2, tz);
      const t0 = performance.now() / 1000;
      if (ev.pid != null) {
        // bot 英雄 / 僚機齊射:走真人 tracer 同一條槍口/後座路徑(曳光被障礙截斷,火花打在障礙面)
        const from = this._entMuzzle(ev.pid, ev.slot,
          new THREE.Vector3(fx, this.terrain.heightAt(fx, fz) + 2, fz));
        const sh = ev.slot === 'heavy' ? this._heroEntByPid(ev.pid) : null;
        const def = sh ? this._heroDefOf(sh.ch, 'heavy') : null;
        const d3 = to.clone().sub(from);
        if (def && (def.type === 'launcher' || def.type === 'missile') && d3.lengthSq() > 0.01) {
          // bot 重武器(heroBurst 補發的 shot):彈藥同源 —— 與真人 tracer 同一顆視覺彈體;
          // launcher 拋物線命中目標,砲管仰角與實際發射角一致(規則 1)
          const ldir = this._spawnVisShell(from, to, def, ev.side, sh.ch);
          this._muzzleBurst(from, true, ev.side);
          if (def.type === 'launcher') this._aimHeavyBarrel(ev.pid, ldir);
        } else if (def && aoeClass(def) === 'line') {
          // bot 的直線貫穿重武器:與真人 tracer 同一支 _lanceVisual(圓柱粗細 = 貫穿半徑)
          this._lanceVisual(from, this._clipBeam(from, to).to, def, ev.side);
          this._muzzleBurst(from, true, ev.side);
        } else {
          const clip = this._clipBeam(from, to);
          this._shotFx(from, clip.to, { heavy: ev.slot === 'heavy', side: ev.side, impact: true });
          // bot / 僚機的輕武器齊射同樣走連發演出(與真人 tracer 共用 _burstEchoOther)
          this._burstEchoOther(ev.pid, ev.slot, ev.side, to);
        }
        this._markFire(ev.pid, ev.slot, t0, { x: tx, z: tz, y: to.y });
      } else {
        const ent = ev.id != null ? this.ents.get(ev.id) : null;
        const from = this._npcMuzzle(ent, ev, fx, fz);
        const wid = ev.wid || (ent ? UNITS[ent.kind]?.wid : null);
        const kind = ev.kind || ent?.kind;
        const style = unitShotStyle(kind, wid);
        if (ent) {
          ent._aimAt = { x: tx, z: tz, y: to.y, until: t0 + 2.5 };   // 交戰面向:槍口朝攻擊方向
          ent.fireFx = { t0, slot: style.mode === 'gun' || style.mode === 'beam' ? 'light' : 'heavy' };
          const muzzle = ent.kind === 'base' ? ent.gunMuzzles?.[ev.gi ?? 0]
            : ent.mesh.userData.turretMuzzles?.[ent._mzi] || ent.mesh.userData.rig?.muzzles?.light?.n;
          fireUnitMotion(ent.mesh.userData.rig, muzzle, t0);
          if (ent.kind === 'base') {
            (ent._gunAim ??= [])[ev.gi ?? 0] = { x: tx, z: tz, y: to.y, until: t0 + 3 };
          }
        }
        const { col, hot } = this._shotCols(ev.side);
        if (style.mode === 'shell') {
          this._arcTracer(from, to, col, ent, kind, wid);
        } else {
          unitShotFx(this.scene, this.effects, from, to, {
            kind, wid, color: col, core: hot, clip: (a, b) => this._clipBeam(a, b),
          });
        }
      }
    } else if (ev.e === 'wave') {
      this.hud.feed?.(`⚔️ 第 ${ev.n} 波兵線出擊(含攻擊直升機)`);
    } else if (ev.e === 'respawn') {
      if (this.side === ev.side) this.hud.feed?.('🔁 你已重生,守住防線!');
    }
  }

  onTracer(m) {
    // 他人開火視覺:槍口爆 + 發光曳光束 +(命中點)火花。重武器(slot:'heavy')明顯放大。
    // 起點解析成射手機體的 rig 槍口錨(找不到才用訊息座標)—— 曳光從對方手上/背上的槍管射出
    const from = this._entMuzzle(m.pid, m.slot,
      new THREE.Vector3(m.from[0], m.from[1], m.from[2]));
    const to0 = new THREE.Vector3(m.to[0], m.to[1], m.to[2]);
    // 彈藥同源(2026-07-22):launcher/missile 在他人畫面也是「飛行彈體」(重力彈道,純視覺)
    // 而非直線光束 —— pid→ent.ch 解析射手武器 def,與自機 FPV 同一顆 projectileMesh。
    if (m.slot === 'heavy') {
      const shooter = this._heroEntByPid(m.pid);
      const def = shooter ? this._heroDefOf(shooter.ch, 'heavy') : null;
      // 直線貫穿(beam/rail/gun 重武器):他人畫面同樣看得到圓柱貫穿的粗細 = 危險區(規則可讀性)
      if (def && aoeClass(def) === 'line') {
        this._lanceVisual(from, this._clipBeam(from, to0).to, def, m.side);
        this._muzzleBurst(from, true, m.side);
        this._markFire(m.pid, m.slot, performance.now() / 1000, { x: to0.x, z: to0.z, y: to0.y });
        return;
      }
      if (def && (def.type === 'launcher' || def.type === 'missile')) {
        const dir = to0.clone().sub(from);
        if (dir.lengthSq() > 0.01) {
          const ldir = this._spawnVisShell(from, to0, def, m.side, shooter.ch, m.mv);
          this._muzzleBurst(from, true, m.side);
          // 拋物線武器(launcher)砲管仰角與實際發射角一致(規則 1;missile 導引不回寫)
          if (def.type === 'launcher') this._aimHeavyBarrel(m.pid, ldir);
          this._markFire(m.pid, m.slot, performance.now() / 1000, { x: to0.x, z: to0.z, y: to0.y });
          return;
        }
      }
    }
    // 他人曳光同吃障礙截斷(對方客戶端已擋彈道,這裡的 60m 示意曳光也不可畫穿牆)
    const clip = this._clipBeam(from, to0);
    this._shotFx(
      from,
      clip.to,
      { heavy: m.slot === 'heavy', side: m.side, impact: !!m.hit || clip.cut },
    );
    // 射手機體的開火動畫(後座 + 射姿保持):pid 由伺服器轉播時附上(server.js tracer relay)
    this._markFire(m.pid, m.slot, performance.now() / 1000, { x: to0.x, z: to0.z, y: to0.y });
    // 連發演出:他人的機槍在我畫面上同樣要是連續的(N 由對方的武器 def 推導,兩端同一支
    // fireBurstN ⇒ 不必為此加任何網路欄位)。槍口逐發重解 —— 射手在這 0.2 秒裡還在動。
    this._burstEchoOther(m.pid, m.slot, m.side, to0);
  }

  /**
   * 他人 / bot / 僚機開火的連發補畫(第 2~N 發)。純表現層:只重畫曳光 + 槍口焰 + 後座動畫,
   * 傷害早已由伺服器結算完畢。射手 ch 解不出來(觀戰剛進場、實體已離場)就整段不做 —— 寧缺勿錯。
   */
  _burstEchoOther(pid, slot, side, to0) {
    if (pid == null) return;
    const shooter = this._heroEntByPid(pid);
    const def = shooter ? this._heroDefOf(shooter.ch, slot) : null;
    if (!def) return;
    const aim = to0.clone();
    this._queueBurst(def, () => {
      const from = this._entMuzzle(pid, slot, aim);
      const clip = this._clipBeam(from, aim);
      this._shotFx(from, clip.to, { heavy: slot === 'heavy', side, impact: clip.cut });
      this._markFire(pid, slot, performance.now() / 1000, { x: aim.x, z: aim.z, y: aim.y });
    });
  }

  /** 手持重武器(launcher 彈道)砲管仰角回寫:發射方向的仰角調整 gunPitch 目標角。
   *  aim0 = 建模解算的水平據槍角(首次寫入時快取);仰角向上 = rotation.x 減小,
   *  與 _arcTracer 的 comp − atan 同號約定 —— 拋物線武器的槍管角度與射擊角度一致。 */
  _aimHeavyBarrel(pid, dir) {
    const elev = Math.atan2(dir.y, Math.hypot(dir.x, dir.z) || 1);
    for (const ent of this.ents.values()) {
      if (ent.pid !== pid || ent.isSelf) continue;
      const rig = ent.mesh?.userData?.rig;
      const gp = rig?.weap?.heavy === 'L' ? rig?.gunL : rig?.gunR;
      if (!gp) continue;
      gp.aim0 ??= gp.aim;
      gp.aim = gp.aim0 - elev;
    }
  }

  /** 以 pid 找英雄 ent(有 ch 才算 —— 解析射手武器 def 用) */
  _heroEntByPid(pid) {
    if (pid == null) return null;
    for (const ent of this.ents.values()) if (ent.pid === pid && ent.ch) return ent;
    return null;
  }

  // ---------------- 連發演出(2026-08-02 使用者定案)----------------
  /**
   * 射速壓縮之後,一次擊發 = `fireBurstN(def)` 發**視覺**子彈(實質仍是一次結算 —— 伺服器
   * 只收到一發、只結算一份傷害)。使用者定案:「高射速武器動畫做對應調整,例如機槍做成
   * 3 連發實質一次傷害,整體看起來攻擊動畫是連續的」。
   *
   * **純表現層**(原則 4):排程只在客戶端,MUST NOT 送任何 hit/tracer/plasma —— 多送一發就是
   * A1(客戶端自己加傷害)。三個消費端(自機 FPV / 他人 tracer / bot·僚機 shot 事件)共用這一支
   * 排程器,MUST NOT 各寫一份計時器 —— 連發數與間隔的真相只有 `fireBurstN`/`fireBurstGap`。
   *
   * 間隔由 `fireBurstGap` 把 N 發**平均鋪滿整個擊發週期** ⇒ 週期內與跨週期的間隔完全相同,
   * 這正是「看起來是連續的」的來源(打成「一串急促連發 + 一段空白」就不是使用者要的)。
   */
  _queueBurst(def, fn) {
    const n = fireBurstN(def);
    if (n <= 1) return;
    const gap = fireBurstGap(def), t0 = performance.now() / 1000;
    for (let i = 1; i < n; i++) (this._burstQ ||= []).push({ at: t0 + gap * i, fn, i, n });
  }

  /** 連發排程逐幀消化(排在 `_tickWeapons` 之後:本幀擊發的那一輪同幀就進佇列) */
  _tickBurstFx(now) {
    const q = this._burstQ;
    if (!q || !q.length) return;
    for (let i = q.length - 1; i >= 0; i--) {
      if (now < q[i].at) continue;
      const b = q[i];
      q.splice(i, 1);
      // 演出失敗(射手中途離場 / 場景已拆)一律靜默略過 —— 純視覺 MUST NOT 中斷戰鬥迴圈
      // (前科:_tryFire 裡一個未宣告變數讓整幀含彈體更新與渲染當場斷掉)。
      try { b.fn(b.i, b.n); } catch { /* 降級,不例外 */ }
    }
  }

  /** 他人武器 def 解析(heroWeapon Lv1;純視覺用 type/mv/range,不涉結算)—— 依 ch:slot 快取 */
  _heroDefOf(ch, slot) {
    if (!ch || !CHARACTERS[ch]) return null;
    const key = `${ch}:${slot}`;
    let d = this._wdefCache.get(key);
    if (!d) { d = heroWeapon(ch, slot, 1, true); this._wdefCache.set(key, d); }
    return d;
  }

  /** 他人重武器的視覺彈體(純表現層:直線+重力近似,不結算;真實爆點由伺服器 boom 事件呈現) */
  /** 彈道初速:榴彈/火箭(launcher)拋物線武器降速(→ BALLISTIC.LAUNCH_MV),讓拋物線軌跡明顯;
   *  其餘武器用真實 mv。純客戶端視覺(伺服器不模擬彈道),與瞄準虛線 _updateArcGuide 同一組值。
   *  aa = 對空彈射模式(見 _updateAaMode):改用 BALLISTIC.AA_MV,彈道拉成高速近直線。
   *  夾制規則本身住 `data.js shotV0()`(唯一縫)。**對地拋投的實際初速不是這個值** —— 45°
   *  解由 `_lob45Vel` 反解(這裡只當它的上限 vmax);伺服器把著彈時刻換算回擊發時刻要的是
   *  「飛多久」而不是「出膛多快」,那條縫是 `data.js shotFlightS()`(拋物線走 45° 解,
   *  拿本值除一次會低估 2 倍以上 ⇒ 榴彈整輪靜默丟包)。 */
  _shotV0(def, aa = false) {
    return shotV0(def, aa);
  }

  /**
   * 拋射角解算(真實彈道學):自 from 以速率 v0 命中 to 的兩組解。
   *   lo = 低伸解(彈道平、飛行時間短)、hi = 高角度解(越過遮蔽物的曲射)。
   * 同一距離兩個仰角都命中同一點 —— 這就是「弧線隨距離與仰角改變」的物理根據。
   * ok:false = 超出該初速的射程包絡(判別式 < 0,無實數解)→ 兩解都退回 45°(最大射程角)盡力射。
   */
  _lobSolve(from, to, v0) {
    const hx = to.x - from.x, hz = to.z - from.z;
    const L = Math.hypot(hx, hz) || 1e-3;
    const dy = to.y - from.y, g = BALLISTIC.G, v2 = v0 * v0;
    const disc = v2 * v2 - g * (g * L * L + 2 * dy * v2);
    if (disc < 0) return { ok: false, lo: 1, hi: 1, L, hx, hz };   // 射不到:45° 盡力(視覺落短仍呈拋物)
    const s = Math.sqrt(disc);
    return { ok: true, lo: (v2 - s) / (g * L), hi: (v2 + s) / (g * L), L, hx, hz };
  }

  /** 拋物線發射初速向量:預設低伸解;high = 高角度解(真實榴彈砲越過稜線/建物的曲射)。 */
  _lobVel(from, to, v0, high = false) {
    const s = this._lobSolve(from, to, v0);
    const tan = high ? s.hi : s.lo;
    const vh = v0 / Math.sqrt(1 + tan * tan);
    return new THREE.Vector3((s.hx / s.L) * vh, vh * tan, (s.hz / s.L) * vh);
  }

  /** 他人/bot 重武器視覺彈體。launcher 走拋物線命中 to(慢速明顯弧),其餘直指;回傳實際發射方向(供砲管仰角回寫)。 */
  // heavy:彈體外觀走輕/重哪一款(預設 true = 既有的重武器呼叫端逐位元不變;
  //        連發演出補畫的輕武器視覺彈體傳 false,與自機 `_takeProjectile(def, false)` 同一顆)。
  _spawnVisShell(from, to, def, side, ch, mv = null, heavy = true) {
    // mv = 射手回報的實際初速(火控解定案的裝藥號數 / 彈射模式全速)⇒ 兩端看到同一條弧。
    // bot 的 shot 事件不帶初速,退回以落點離地高度推定對空(> AA_ALT = 打空中目標)→ 高速近直線。
    const aa = def.type === 'launcher' && to.y - this.terrain.heightAt(to.x, to.z) > BALLISTIC.AA_ALT;
    const v0 = mv || this._shotV0(def, aa);
    // 對地榴彈走射手同一支 45° 解(2026-08-02):兩端只要一端用低伸解,同一個落點就會畫出
    // 兩條不同的弧(對方看到的砲彈從山腰擦過去、我這邊是吊過山頭)。初速由幾何反解(與射手同式),
    // 上限吃全裝藥 —— 拿回報的 mv 當上限會在四捨五入邊界上忽解忽不解。
    const v45 = def.type === 'launcher' && !aa ? this._lob45Vel(from, to, this._shotV0(def, false)) : null;
    const baseDir = _TMP_D.copy(to).sub(from).normalize();       // baseDir(暫存 _TMP_D, _guidedLaunchVel 只讀)
    const launch = this._guidedLaunchVel(from, baseDir, def, v0);
    const b = this._recPool.acquire();                           // 記錄走池(向量常駐,下段逐個覆寫)
    b.pos.copy(from); b.origin.copy(from); b.target.copy(to);
    if (launch?.vel) b.vel.copy(launch.vel);
    else if (v45) b.vel.copy(v45);
    else if (def.type === 'launcher') b.vel.copy(this._lobVel(from, to, v0));   // 對空彈射:初速高 ⇒ 解自然拉平
    else b.vel.copy(to).sub(from).normalize().multiplyScalar(v0);              // 飛彈/動能:直指目標(近似,純視覺)
    const mesh = this._takeProjectile(def, heavy, side, ch);   // 同池:他人彈體與自機彈體共用回收路徑
    mesh.position.copy(from);
    mesh.quaternion.setFromUnitVectors(_FWD_Z, _TMP_D.copy(b.vel).normalize());
    this.scene.add(mesh);
    b.mesh = mesh;
    b.max = (def.range || 300) * 1.35;   // 射程 = 以射擊點為中心的球面(與自機彈體同一把尺)
    b.cyclone = null; b.cycAcc = 0; b.cycCol = this._shotCols(side).col; b.age = 0;
    b.guided = !!launch; b.launchDist = launch?.dist || 0;
    b.guide = false; b.homing = null; b.slot = null;
    this._visShells.push(b);
    return b.vel.clone().normalize();    // 發射角回寫(呼叫端同步消費;保留新向量,不借暫存)
  }

  /** 視覺彈體逐幀積分:低空導引彈先抬頭,其餘重力下墜 + 地形/實體障礙截斷(純視覺不進 A6 raycast 目標;暫存零配置) */
  _updateVisShells(dt) {
    for (let i = this._visShells.length - 1; i >= 0; i--) {
      const b = this._visShells[i];
      b.age += dt;
      const prev = _TMP_D.copy(b.pos);                               // prev(暫存 _TMP_D,當次迭代有效)
      const climbing = b.guided && prev.distanceTo(b.origin) < b.launchDist;
      if (climbing) b.vel.y -= BALLISTIC.G * dt;
      else if (b.guided) {
        _TMP_E.copy(b.target).sub(b.pos);                            // want
        if (_TMP_E.lengthSq() > 1e-6) {
          _TMP_E.normalize();
          // 等速改向(舊 steer 閉包內聯:逐彈每幀一個閉包 + 一顆 clone,現全暫存)
          _TMP_F.copy(b.vel).normalize();
          const ang = _TMP_F.angleTo(_TMP_E);
          if (ang > 1e-4) _TMP_F.lerp(_TMP_E, Math.min(1, seekTurn(SEEK.RIDE_W, b.vel.length()) * dt / ang)).normalize();
          b.vel.copy(_TMP_F.multiplyScalar(b.vel.length()));
        }
      } else b.vel.y -= BALLISTIC.G * dt;
      b.pos.addScaledVector(b.vel, dt);
      const seg = _TMP_E.copy(b.pos).sub(prev);                      // seg(prev 仍有效)
      const len = seg.length();
      // 地形/障礙/薄板一律走 _layerHitT 的**雙面**解析截斷(與 _updateBullets 同一組規則):
      // 舊制 `pos.y <= heightAt` 是單面「在地表以下」判定 —— 覆蓋段山體高度沒被開挖,隧道裡
      // 每一發他人彈體都在槍口原地炸;由下往上穿地表也整條漏放。
      const dB = len > 0.01 ? this._layerHitT(prev.x, prev.y, prev.z, b.pos.x, b.pos.y, b.pos.z) : null;
      let hit = false;
      if (dB != null) { b.pos.copy(prev).addScaledVector(_TMP_F.copy(seg).divideScalar(len), dB); hit = true; }
      if (hit || b.pos.distanceTo(b.origin) >= b.max) {
        starburst(this.scene, this.effects, b.pos.x, b.pos.y, b.pos.z, hit ? 1.6 : 0.8, 0xffc79a);
        this._dropBullet(b);
        this._visShells.splice(i, 1);
        continue;
      }
      b.mesh.position.copy(b.pos);
      if (len > 0.001) b.mesh.quaternion.setFromUnitVectors(_FWD_Z, _TMP_E.normalize());
      stepProjectileFx(b.mesh, b.age, b.vel.length());
      if (b.cyclone) this._spinCyclone(b, dt);
    }
  }

  // ---------------- 氣旋噴射(巨炮砲彈尾流,2026-07-22)----------------
  /** 建立氣旋渦輪並掛在砲彈子體底下;回傳群組(逐幀由 _spinCyclone 自旋 + 撒螺旋煙圈) */
  _attachCyclone(mesh, side) {
    const cyc = cycloneJet(this._shotCols(side).col);
    mesh.add(cyc);
    return cyc;
  }

  /** 氣旋自旋 + 沿行進軸撒外旋螺旋煙圈(讀感 = 氣旋捲動);b.cycAcc 節流撒點,b.cycCol 陣營色(池化 sprite + 暫存向量,逐點不配物件) */
  _spinCyclone(b, dt) {
    b.cyclone.rotation.z += dt * 26;                 // 高速自旋
    b.cycAcc = (b.cycAcc || 0) + dt;
    if (b.cycAcc < 0.03) return;
    b.cycAcc = 0;
    // 行進軸的兩條正交向量 → 在垂直於航向的平面上取旋轉相位,撒一顆略微外旋的加法煙點
    // 暫存紀律:呼叫端(_updateBullets/_updateVisShells 的 !done 分支)至此已用完 A/B,D/E/F 出借中
    const dir = _TMP_D.copy(b.vel).normalize();
    if (Math.abs(dir.y) > 0.9) _TMP_F.set(1, 0, 0); else _TMP_F.set(0, 1, 0);
    const rx = _TMP_E.crossVectors(dir, _TMP_F).normalize();
    const ry = _TMP_F.crossVectors(dir, rx).normalize();
    const ph = (b.cycPh = (b.cycPh || 0) + 1.1);     // 相位遞進 → 螺旋
    const rad = 0.9, c = Math.cos(ph), s = Math.sin(ph);
    const sp = this._takeSprite(true,
      b.pos.x - dir.x * 0.6 + rx.x * c * rad + ry.x * s * rad,
      b.pos.y - dir.y * 0.6 + rx.y * c * rad + ry.y * s * rad,
      b.pos.z - dir.z * 0.6 + rx.z * c * rad + ry.z * s * rad,
      1.5, b.cycCol || 0xffd27a, 0.85);
    // 切向速度(繞航向旋轉)+ 略外擴,快速淡出 → 拖成氣旋螺旋
    // off 單位化 = (rx*c + ry*s)(rad>0 約掉)⇒ 外擴項 = (rx*c + ry*s)*3
    sp.userData.vel.set(
      rx.x * (-s * 9 + c * 3) + ry.x * (c * 9 + s * 3) - dir.x * 6,
      rx.y * (-s * 9 + c * 3) + ry.y * (c * 9 + s * 3) - dir.y * 6,
      rx.z * (-s * 9 + c * 3) + ry.z * (c * 9 + s * 3) - dir.z * 6);
    sp.userData.base = 1.5;
    sp.userData.grow = 2.2;
    sp.userData.op = 0.85;
    this._pushSpriteFx(sp, 0.32, _spriteDriftFade);
  }

  // ---------------- 集束炸彈投擲動畫(2026-08-01 使用者需求:軌跡同榴彈)----------------
  /**
   * 投出一顆依機體類型上色/造型的炸彈,**走榴彈拋物線**:自轟炸機的投擲點 (fx,fy,fz) 拋向
   * 伺服器指定的落點 (x,z) —— 初速由「同一條重力 G×GRAV_F、指定飛行時間 T」的解析解求出,
   * 逐幀積分(_updateDecoyBombs)用的就是同一個 G ⇒ **算出來的落點就是畫出來的落點**。
   * T 由水平距離推導(距離越遠丟得越高越久),夾在 [MIN, MAX] 秒。
   * 沒帶投擲點(舊訊息)→ 退回原本的正上方垂直投放。
   * 傷害在伺服器事件當下即結算,這條拋物線純表現層(MUST NOT 改成落地才回報 —— 那是 A1)。
   */
  _spawnDecoyBomb(x, z, alt, type, r, from = null) {
    const gy = this.terrain.heightAt(x, z);
    const col = (DECOY_BOMB[type] || DECOY_BOMB.fire).color;
    const mesh = decoyBombMesh(type, col);
    const G = BALLISTIC.G * DECOY_BOMB_GRAV_F;
    // 起/落點走暫存(同步消費,不進記錄);記錄向量常駐,下段覆寫
    if (from) _TMP_D.set(from.x, this.terrain.heightAt(from.x, from.z) + Math.max(1, from.y), from.z);
    else _TMP_D.set(x, gy + Math.max(4, alt), z);
    _TMP_E.set(x, gy + 0.5, z);
    const b = this._recPool.acquire();
    if (from) {
      // 拋擲解:水平勻速 + 垂直 (Δy + ½G·T²)/T ⇒ T 秒後精準落在 end(與榴彈火控同一條物理)
      const d = Math.hypot(_TMP_E.x - _TMP_D.x, _TMP_E.z - _TMP_D.z);
      const T = Math.max(DECOY_BOMB_T.MIN, Math.min(DECOY_BOMB_T.MAX, d / DECOY_BOMB_T.SPD));
      b.vel.set(
        (_TMP_E.x - _TMP_D.x) / T, (_TMP_E.y - _TMP_D.y + 0.5 * G * T * T) / T, (_TMP_E.z - _TMP_D.z) / T);
    } else {
      b.vel.set((Math.random() - 0.5) * 4, -2, (Math.random() - 0.5) * 4);
    }
    b.pos.copy(_TMP_D);
    b.spin.set(Math.random() * 6 - 3, Math.random() * 6 - 3, Math.random() * 6 - 3);
    b.mesh = mesh; b.type = type; b.col = col; b.r = r;
    b.gy = this.terrain.heightAt(_TMP_D.x, _TMP_D.z);
    b.trailAcc = 0; b.age = 0;
    b.guide = false; b.guided = false; b.homing = null; b.cyclone = null;
    mesh.position.copy(_TMP_D);
    this.scene.add(mesh);
    this._decoyBombs.push(b);
  }

  /** 拋擲彈體逐幀:重力墜落 + 翻滾 + 類型拖尾;觸地(或逾時)→ 引爆演出 */
  _updateDecoyBombs(dt) {
    for (let i = this._decoyBombs.length - 1; i >= 0; i--) {
      const b = this._decoyBombs[i];
      b.vel.y -= BALLISTIC.G * DECOY_BOMB_GRAV_F * dt;   // 與 _spawnDecoyBomb 的拋擲解同一個 G(不同 ⇒ 落點分家)
      b.pos.addScaledVector(b.vel, dt);
      b.mesh.position.copy(b.pos);
      b.mesh.rotation.x += b.spin.x * dt;
      b.mesh.rotation.y += b.spin.y * dt;
      b.mesh.rotation.z += b.spin.z * dt;
      b.gy = this.terrain.heightAt(b.pos.x, b.pos.z);
      // 類型拖尾(節流):燃燒/雷爆 = 加法火星,凍結/毒霧 = 柔煙(池化 sprite + 共用 fade)
      b.trailAcc += dt;
      if (b.trailAcc >= 0.045) {
        b.trailAcc = 0;
        const additive = b.type === 'fire' || b.type === 'thunder';
        const base = additive ? 1.0 : 1.4, op = additive ? 0.9 : 0.6;
        const sp = this._takeSprite(additive, b.pos.x, b.pos.y + 0.2, b.pos.z, base, b.col, op);
        sp.userData.vel.set(0, 0, 0);
        sp.userData.base = base;
        sp.userData.grow = base;
        sp.userData.op = op;
        this._pushSpriteFx(sp, 0.4, _spriteDriftFade);
      }
      if (b.pos.y <= b.gy + 0.5) {
        b.mesh.parent && this.scene.remove(b.mesh);
        disposeTree(b.mesh);   // decoyBombMesh 每顆都是新幾何/材質(含描邊外殼)⇒ 落地即釋放
        this._decoyBombLandFx(b.pos.x, b.gy, b.pos.z, b.type, b.col, b.r);
        this._decoyBombs.splice(i, 1);
        b.mesh = null;
        this._recPool?.release(b);   // 記錄回池(炸彈本體仍逐顆釋放,見上)
      }
    }
  }

  /** 落地引爆:依類型上色的火球 + 地環 + 衝擊波,再疊類型專屬地面演出 */
  _decoyBombLandFx(x, gy, z, type, col, r) {
    const y = gy + 1.2;
    this._explosion(x, y, z, r * 0.9, col);
    shockRing(this.scene, this.effects, x, gy, z, r * 1.6, col);
    this._applyBlast(x, y, z, r);
    if (type === 'fire') {
      this._emberBurst(x, y, z, 14, 4);
    } else if (type === 'freeze') {
      for (let k = 0; k < 8; k++) {   // 迸射冰晶(慢速、淺藍)
        const a = Math.random() * Math.PI * 2, d = 1 + Math.random() * r * 0.5;
        starburst(this.scene, this.effects, x + Math.cos(a) * d, gy + 0.6 + Math.random() * 2, z + Math.sin(a) * d, 1.6, 0xbfeaff);
      }
    } else if (type === 'poison') {
      for (let k = 0; k < 4; k++) this._crashSmoke(x + (Math.random() - 0.5) * r, gy + 0.5, z + (Math.random() - 0.5) * r, 1.3);
      for (let k = 0; k < 3; k++) starburst(this.scene, this.effects, x + (Math.random() - 0.5) * r, gy + 1 + Math.random() * 2, z + (Math.random() - 0.5) * r, 2.0, 0x9be36a);
    } else if (type === 'thunder') {
      for (let k = 0; k < 6; k++) {   // 放射電弧
        const a = (k / 6) * Math.PI * 2, d = r * (0.6 + Math.random() * 0.5);
        const to = new THREE.Vector3(x + Math.cos(a) * d, gy + 0.5 + Math.random() * 2, z + Math.sin(a) * d);
        beamLine(this.scene, this.effects, new THREE.Vector3(x, y, z), to, 0xffe14f, { ttl: 0.18, w: 0.06 });
      }
    }
  }

  // ---------------- 榴彈對空彈射模式(2026-07-23)----------------
  /**
   * launcher(榴彈/火箭)準星掃到飛行單位 → 切「彈射模式」:初速拉到 BALLISTIC.AA_MV,
   * 彈道變成高速近直線(拋物線吊射對會動的飛行目標毫無火控意義)。射程/傷害/彈藥全不變。
   * **唯一判定縫**:每幀在 `_tickWeapons`(擊發)之前更新 `this._aaAim`,擊發與瞄準虛線
   * 消費同一份結果 ⇒ 所見即所射;MUST NOT 在擊發處另做一次掃描(兩份會分家)。
   *
   * **準星是唯一目標來源**(2026-08-02 使用者定案「榴彈鎖定目標以準星優先」→ 2026-08-10 收成
   * 唯一規則「拋物線準星沒有瞄敵人時就是打地面」):目標一律由準星射線(`_lobCrosshair` 單一縫,
   * 與 `_lobAim` 的瞄準點同源)定案 —— 準星底下是飛行單位才進彈射模式,**其餘一律 45° 對地拋投**。
   * 錐形瞄準輔助 `_aaTarget`(8° 錐內最正對的飛行單位)自此**整支退場**:它是唯一能把瞄準點從
   * 準星底下拉走的路徑(使用者兩次回報「遠離準星的目標卻還是被拉過去」),而 `_aimTarget` 對 lob
   * 又是直接吃火控解 ⇒ 連鎖定也跟著被拉走。MUST NOT 以「準星什麼都沒解到時才接手」之類的條件復辟
   * —— 準星沒解到單位就是打地面,那是規則不是缺口。
   */
  _updateAaMode() {
    const def = (this.side && !this.dead && !this.shopOpen) ? this._curWeapon().def : null;
    const ent = def && def.type === 'launcher' ? this._lobCrosshair(def).ent : null;
    this._aaEnt = ent && TARGET_CLASS[ent.kind] === 'air' ? ent : null;
    const on = !!this._aaEnt;
    if (on === this._aaAim) return;
    this._aaAim = on;
    const now = performance.now() / 1000;
    if (on && now - (this._aaFeedAt || 0) > 4) {   // 準星掃過機群會反覆切換,提示節流
      this._aaFeedAt = now;
      this.hud.feed?.('🎯 對空彈射模式:切換為高速平射彈道');
    }
  }

  // ---------------- 榴彈火控(trajClass 'lob';2026-07-22 瞄準指示 → 2026-07-23 改火控解)----------------
  /**
   * 榴彈火控的**準星解**(單一縫):`_updateAaMode`(要不要進彈射模式)與 `_lobAim`(瞄準點)
   * 同一幀吃同一份 —— 兩端各打一條射線就會出現「模式判成對地、瞄準點卻鎖在飛機上」。
   * 準星射線每幀重打太貴(地形解析射線 + 全場機體 mesh)⇒ 鏡頭與槍口都幾乎沒動就沿用上一幀的解
   * (靜止架砲是榴彈的主要用法);轉動/位移一超過門檻立刻重打 ⇒ 瞄準精度不打折。
   * 回傳的快取物件另帶 `from`(本幀槍口世界座標),消費端只讀不改。
   */
  _lobCrosshair(def) {
    this.camera.updateMatrixWorld();
    const c = this._lobCache || (this._lobCache = {
      d: new THREE.Vector3(), o: new THREE.Vector3(), t: -1, ent: null,
      pt: new THREE.Vector3(), from: new THREE.Vector3(),
    });
    if (this.viewMode === 'tps') c.from.copy(this._selfMuzzle(null, this._maxRange(def), 'heavy'));
    else if (this.gunGroup) this.gunGroup.localToWorld(c.from.copy(this._muzzle));
    else c.from.copy(this.camera.position);
    const dir = this.camera.getWorldDirection(this._lobFwd || (this._lobFwd = new THREE.Vector3()));
    const t = performance.now();
    if (t - c.t > 60 || c.d.dot(dir) < 0.999998 || c.o.distanceToSquared(c.from) > 0.0225
        || (c.ent && (c.ent.dead || !c.ent.mesh.visible))) {
      const r = this._resolveAim(this._maxRange(def));
      c.pt.copy(r.point); c.ent = r.ent || null; c.d.copy(dir); c.o.copy(c.from); c.t = t;
    }
    return c;
  }

  /**
   * 拋物線武器的火控解 —— **唯一判定縫**,每幀在 `_tickWeapons`(擊發)之前定案。
   * 擊發 `_tryFire`、瞄準虛線 `_updateArcGuide`、鎖定光暈 `_tickLock`、砲口仰角(`_loop` 的
   * gunGroup.rotation.x)全部消費同一份 `this._lobFc` ⇒ 所見即所射;
   * **MUST NOT** 在任何一端另解一次(兩份會分家)。
   *
   * 火控流程(遵守真實彈道學,使用者 2026-07-23 定案;2026-08-02 對地改 45° 固定投擲角):
   *  ① 瞄準點:**準星優先** —— 準星射線的交點,打到機體就取**那個部位**的世界座標
   *     (規則:瞄哪個部位打哪個部位)。只有準星本身解到飛行單位(或準星壓在空無處而錐內有
   *     飛行目標)才切彈射模式取機體幾何中心;判定住 `_updateAaMode`,這裡不另掃一次。
   *  ② 解算:對地 = 固定 45° 反解初速(落點恆為瞄準點);對空 = 以初速 AA_MV 求拋射角。
   *  ③ 驗證:逐步積分;對空的低伸解被地形/障礙截斷 → 逐級降裝藥(仰角自動抬高)重解。
   *     打不通 / 超出射程包絡 ⇒ ok:false,虛線轉警示色且**鎖定光暈不亮**
   *     (使用者規則「射程光暈要在拋物線對準時才亮」)。
   */
  _lobAim() {
    const fc = this._lobFc || (this._lobFc = {
      on: false, ok: false, aa: false, high: false, close: false, cut: false, ent: null,
      v0: 0, sup: 0, n: 0, max: 0,
      aim: new THREE.Vector3(), vel: new THREE.Vector3(), impact: new THREE.Vector3(), hasImpact: false,
    });
    fc.on = false; fc.ok = false; fc.ent = null; fc.sup = 0; fc.close = false; fc.cut = false;
    const { id, def } = this._curWeapon();
    // 雷射導引(trajClass 'guide')由 _updateGuideLaser 指示 —— 彈體解保險後朝固定打擊點修正,
    // 走拋物線火控是錯的指示,兩者互斥。
    if (this.dead || this.shopOpen || !this.side || !this.ch || id !== 'heavy'
        || !def || trajClass(def) !== 'lob' || !this.gunGroup) return;
    // ① 瞄準點(**準星優先**:準星解與彈射模式判定同吃 `_lobCrosshair`,不另掃一次)
    const c = this._lobCrosshair(def);
    const from = c.from;
    const aaEnt = this._aaAim ? this._aaEnt : null;
    if (aaEnt && !aaEnt.dead && aaEnt.mesh.visible) {
      const p = aaEnt.mesh.position;
      fc.aim.set(p.x, p.y + (aaEnt.dimTop != null ? aaEnt.dimTop - aaEnt.dimH * 0.5 : 1.5), p.z);
      fc.ent = aaEnt;
    } else {
      fc.aim.copy(c.pt);
      fc.ent = c.ent;
    }
    fc.on = true;
    fc.aa = !!this._aaAim;
    const base = this._shotV0(def, fc.aa);
    // 射程包絡 = **對這個瞄準目標**的有效射程(唯一縫 `_effRange`;瞄地面 ⇒ ent=null ⇒ 基礎射程)。
    // 火控階梯決定的是真正的出膛向量 ⇒ 這裡放寬多少,砲彈就真的飛多遠 = 射程光暈與實際落點分家。
    const max = this._effRange(def, fc.ent);
    // ①-b **瞄準點夾進射程包絡**(2026-08-15 使用者定案「沒有引爆就繼續飛到碰撞才爆」的另一半)。
    // 45° 拋投的落點恆為瞄準點 ⇒ 瞄準點在包絡外 = 這一發注定在**半空中**飛出射程球面,而彈體在
    // 那裡不再武裝(見 `_updateBullets`)⇒ 打出去的是一顆不會爆的啞彈。夾進來之後落點恆在射程內的
    // **地面**上:短彈,但一定撞得到、一定引爆、一定有傷害 —— 這正是使用者要的「碰撞後爆炸」。
    // 三條:
    //   ① 落點退一個**爆風核心帶**(`blastCoreR`,推導不手寫):核心超壓整個留在射程內,同時讓
    //      「著地」與「出射程球面」不會擠在同一格浮點數上(擠在一起 = 有時引爆有時啞彈,而且隨幀率變)。
    //   ② 夾完的瞄準點 MUST 落在**地面**(逐次以該處地表高重解水平距離,斜坡兩三次就收斂)——
    //      沿準星射線退到「離槍口恰 max」的那一點是在半空中的,弧線會從它旁邊穿過去繼續飛。
    //   ③ `fc.ok` MUST 跟著轉為 false:準星底下那個東西其實在射程外,鎖定光暈(`_aimTarget` 吃
    //      `fc.ok`)亮起來就又是「光暈亮著卻沒命中」。對空彈射不夾(目標在天上,沒有地面落點可退)。
    fc.max = max;
    fc.cut = false;
    // 最小安全射程(下面的太近警示與夾制的「MUST NOT 夾進自己的爆風」同吃這一份 —— 讀兩次
    // 就是第二份規則,而它們本來就該同進同退)
    const mr = lobMinRange(def);
    if (!fc.aa) {
      // 觸發條件是「準星真的在包絡外」(> max),退的距離才是 max − 核心帶 —— 兩個門檻寫成同一個
      // 數字的話,射程界內側那一條核心帶寬的環會被當成出界:那裡的敵人射程光暈亮著、鎖定光暈卻
      // 熄滅(而且落點被無故往回拉),又是一種兩把尺。射程內 ⇒ 這一整段是 no-op(逐位元同舊制)。
      const lim = Math.max(1, max - Math.min(blastCoreR(def), max * 0.5));
      const hx = fc.aim.x - from.x, hz = fc.aim.z - from.z;
      const hl = Math.hypot(hx, hz);
      const dyAim = fc.aim.y - from.y;
      if (from.distanceTo(fc.aim) > max || hl > weaponMaxHoriz(max, dyAim)) {
        let L = Math.min(hl, lim);
        for (let k = 0; k < 3 && hl > 0; k++) {
          const gy = this.terrain.heightAt(from.x + hx / hl * L, from.z + hz / hl * L);
          L = Math.min(hl, Math.max(1, weaponMaxHoriz(lim, gy - from.y)));
        }
        const gx = from.x + hx / hl * L, gz = from.z + hz / hl * L;
        // **MUST NOT 把落點夾進自己的爆風**:準星指著天空(幾乎垂直)時水平距離趨近 0,
        // 沿著它退下來的地面點就在腳邊 —— 那是把「打不到」夾成一發自殺砲。夾不出合法落點就
        // 整段放棄(維持原瞄準點 ⇒ 那一發飛出球面變啞彈,原則 6 寧缺勿錯)。
        if (hl > 0 && Math.hypot(gx - from.x, this.terrain.heightAt(gx, gz) - from.y, gz - from.z) >= mr) {
          fc.aim.set(gx, this.terrain.heightAt(gx, gz), gz);
          fc.cut = true;
        }
      }
    }
    // ② + ③ 對地 45° / 對空逐級降裝藥:共用 `_lobLadder`(唯一縫)—— 射程光暈吃同一份解
    const { ok, v0, vel, arc, high } = this._lobLadder(from, fc.aim, max, base, BALLISTIC.LOB_TOL, true, fc.aa);
    fc.ok = ok && !fc.cut;
    fc.v0 = v0;
    fc.high = high;
    fc.vel.copy(vel);
    fc.n = arc.n;
    fc.hasImpact = !!arc.impact;
    if (arc.impact) fc.impact.copy(arc.impact);
    // 最小安全射程警示(純 HUD 建議;命中/自損由伺服器結算):落點近於 lobMinRange ⇒ 太近,
    // 開砲會落在自身爆風內(無差別波及友軍 + 自損)。以「射手 → 落點/瞄準點」水平+垂直距離判定。
    fc.close = mr > 0 && from.distanceTo(fc.hasImpact ? fc.impact : fc.aim) < mr;
    if (fc.close && this.hud?.feed && (this._lobWarnAt || 0) < performance.now() - 1500) {
      this._lobWarnAt = performance.now();
      this.hud.feed('⚠️ 太近!低於最小安全射程,爆風將無差別波及友軍與自身');
    }
    // 砲口實際指向 = 火控解的出膛角(FPV 砲管跟著抬,所見即所射)
    const fwdY = this.camera.getWorldDirection(this._lobFwd || (this._lobFwd = new THREE.Vector3())).y;
    fc.sup = Math.max(-0.35, Math.min(BALLISTIC.LOB_SUP_MAX,
      Math.asin(Math.max(-1, Math.min(1, fc.vel.y / (fc.vel.length() || 1)))) - Math.asin(Math.max(-1, Math.min(1, fwdY)))));
  }

  /**
   * 固定 45° 投擲解(2026-08-02 使用者定案「準星瞄準地面敵人時,榴彈投擲角度 45 度,軌跡是以
   * 目標物件瞄準點為落點進行拋物線投擲」)—— 角度定死、**初速反解**:
   *   dy = L − g·L²/v0²  ⇒  v0² = g·L² / (L − dy)   (L = 水平距離、dy = 目標高差)
   * 45° 同時是最大射程角、也是 dy=0 時的最小能量解 ⇒ 弧線恆高於同初速的低伸解,越障能力
   * 本來就優於舊裝藥階梯的任一級(階梯因此對地面目標整組讓位,MUST NOT 兩套並存)。
   * 回 null 的兩種情形交給呼叫端退回裝藥階梯:
   *   ① L ≤ dy(目標仰角 ≥ 45°,懸崖正上方):45° 無解,而低伸解的仰角本來就比 45° 更陡
   *      ⇒ 兩者在 45° 處連續,不是特例而是同一條曲線的延伸。
   *   ② 反解初速超過全裝藥 vmax:超出物理射程包絡(45° 射程 = v0²/g,已是最遠)。
   */
  _lob45Vel(from, aim, vmax) {
    const hx = aim.x - from.x, hz = aim.z - from.z;
    const L = Math.hypot(hx, hz);
    const dy = aim.y - from.y;
    if (L <= Math.max(dy, 1e-3)) return null;
    const v0 = Math.sqrt(BALLISTIC.G * L * L / (L - dy));
    if (v0 > vmax) return null;
    const c = v0 * Math.SQRT1_2;   // 45°:水平分量 = 垂直分量
    return new THREE.Vector3((hx / L) * c, c, (hz / L) * c);
  }

  /**
   * 榴彈火控解(**唯一縫**),兩段:
   *  ① 對地(aa=false):固定 45° 拋投,初速由 `_lob45Vel` 反解 ⇒ 落點恆為瞄準點。
   *  ② 對空彈射(aa=true)/ 45° 無解:逐級降裝藥階梯 —— 全裝藥低伸解 → 被地形/障礙擋住就降一號,
   *     初速降低 ⇒ 命中同一點所需仰角自動抬高、弧線變高(真實榴彈砲「選裝藥號數」越過稜線的作法;
   *     MUST NOT 改用同初速的高角度解:現尺度下那是 85° 迫砲彈,飛行 20 秒沒有戰術意義)。
   *     降到打不到(射程包絡外)即停;出射程/無解的截斷降裝藥也沒用,不白跑積分。
   *
   * 回傳 { ok:tol 內對準了嗎, v0:定案初速, vel:出膛向量, arc:該次積分結果, high:非全裝藥標準解 }。
   * **兩個消費端 MUST 吃這一份**:
   *   ① `_lobAim` 的火控解(draw=true,寫繪製緩衝 → 虛線/落點環/砲管仰角/鎖定光暈)
   *   ② `_reachable` 的射程光暈可命中判定(draw=false,不動繪製緩衝)
   * 另寫一份簡化積分 = 光暈與實際彈道分家,又回到使用者回報的「光暈亮著卻沒命中」。
   */
  _lobLadder(from, aim, max, base, tol, draw, aa = false) {
    if (!aa) {
      const v45 = this._lob45Vel(from, aim, base);
      if (v45) {
        const a = this._arcTrace(from, v45, max, aim, draw);
        return { ok: a.minD <= tol, v0: v45.length(), vel: v45, arc: a, high: false };
      }
    }
    const Z = BALLISTIC.LOB_CHARGE;
    let arc = null, vel = null, v0 = base, ok = false, high = false;
    for (let k = 0; k < Z.length; k++) {
      const v = base * Z[k];
      if (!this._lobSolve(from, aim, v).ok) break;   // 該裝藥打不到:更低號更打不到
      const lv = this._lobVel(from, aim, v);
      const a = this._arcTrace(from, lv, max, aim, draw);
      arc = a; vel = lv; v0 = v; high = k > 0;
      if (a.minD <= tol) { ok = true; break; }
      if (a.cut !== 'block') break;
    }
    if (!arc && draw) {   // 全裝藥都沒有實數解(超出射程包絡):畫盡力弧當落短指示
      vel = this._lobVel(from, aim, base);
      arc = this._arcTrace(from, vel, max, aim, true);
    }
    return { ok, v0, vel, arc, high };
  }

  /**
   * 彈道積分(與 _updateBullets 同一組 G / 地形 / 障礙截斷規則);draw=true 才寫入 `_arcGuide`
   * 預配置緩衝(繪製用),判定路徑走 draw=false 以免踩壞正在顯示的瞄準虛線。
   * 回傳 { n:點數, impact:落點或 null, minD:彈道與瞄準點的最近距離, cut:截斷原因 }。
   * minD 即「拋物線有沒有對準」的判據 —— 解算保證彈道通過瞄準點,積分卻可能先被地形/障礙/
   * 射程終點截斷,截斷了就永遠靠不近(單位不擋積分:命中由伺服器結算,虛線只是指示)。
   * cut:'block' 撞地形/障礙(降裝藥抬高彈道可能越過)/ 'range' 射程終點 / 'pass' 飛過瞄準點 / null 緩衝用盡。
   * step 隨初速自適應(恆 ~3m/點):彈射模式 720m/s 若照 0.03s 走,一步 21m 會跳過整條稜線。
   *
   * **射程 = 以射擊點為中心的球面,與軌跡無關**(2026-08-02 使用者定案;與 `_updateBullets`、
   * 伺服器 `heroBurst` 落點閘門 `dist2d(射手, 落點)`、射程光暈 `_reachable` 的
   * `from.distanceTo(aim)` 同一把尺)。舊制量航跡長是對低伸解說的;45° 拋投的弧長恆為水平距離的
   * 1.148 倍 ⇒ 繼續扣航跡長 = 射程無聲砍掉 13%,而且砲彈會在抵達瞄準點**之前**於半空自爆
   * (玩家看到的是「射程變短 + 光暈在 87% 射程外就熄」)。
   */
  _arcTrace(from, vel, max, aim, draw = true) {
    if (draw) this._ensureArcGuide();
    const ag = draw ? this._arcGuide : null;
    const arr = ag?.arr, ld = ag?.ld, MAXP = ag ? ag.maxp : ARC_MAXP;
    let n = 0;
    // lineDistance 自算進預配置緩衝 —— 不呼叫 line.computeLineDistances()(它每幀重建 attribute 洩漏 buffer)
    const put = draw
      ? (v, d) => { if (n < MAXP) { arr[n * 3] = v.x; arr[n * 3 + 1] = v.y; arr[n * 3 + 2] = v.z; ld[n] = d; n++; } }
      : () => { n++; };
    put(from, 0);
    const p = from.clone(), v = vel.clone();
    const step = Math.min(0.03, 3 / Math.max(1, vel.length()));
    // 「飛過瞄準點」的判據 = 沿 from→aim 軸的投影長(不用水平距離:正上方的飛行目標水平距離為 0,
    // 會在第一步就誤判成飛過去了)
    const aimD = Math.max(1e-3, from.distanceTo(aim));
    const ux = (aim.x - from.x) / aimD, uy = (aim.y - from.y) / aimD, uz = (aim.z - from.z) / aimD;
    let dist = 0, impact = null, minD = aimD, cut = null;
    const prev = new THREE.Vector3();
    for (let i = 0; i < MAXP - 1; i++) {
      prev.copy(p);
      v.y -= BALLISTIC.G * step;
      p.addScaledVector(v, step);
      dist += prev.distanceTo(p);
      // 雙面塗層截斷(_layerHitT):打洞的洞口放行 —— 單面 `p.y <= heightAt` 會讓洞內架砲的
      // 瞄準虛線在槍口就被截斷(cut='block' → 逐級降裝藥全滅 → 鎖定光暈永遠不亮)。
      let hit = false;
      const dB = this._layerHitT(prev.x, prev.y, prev.z, p.x, p.y, p.z);
      if (dB != null) { p.copy(prev).addScaledVector(v.clone().normalize(), dB); hit = true; }
      put(p, dist);
      minD = Math.min(minD, p.distanceTo(aim));
      // 飛過瞄準點即收線(落點環畫在目標上,虛線不再穿過機體往後方山腳延伸)
      const s = (p.x - from.x) * ux + (p.y - from.y) * uy + (p.z - from.z) * uz;
      const spent = p.distanceTo(from);   // 射程包絡 = 離發射點的直線距離(見上方註解)
      if (hit || spent >= max || s >= aimD) {
        impact = p.clone();
        cut = hit ? 'block' : (spent >= max ? 'range' : 'pass');
        break;
      }
    }
    return { n, impact, minD, cut };
  }

  /** 拋物線瞄準指示(純繪製):虛線 + 落點環,幾何與顏色全部取自 `_lobFc`,MUST NOT 在此重解彈道。 */
  _updateArcGuide() {
    const fc = this._lobFc;
    if (!fc?.on || !this.aiming) { if (this._arcGuide) this._arcGuide.group.visible = false; return; }
    const ag = this._arcGuide;
    ag.group.visible = true;
    const geo = ag.line.geometry;
    geo.attributes.position.needsUpdate = true;
    geo.attributes.lineDistance.needsUpdate = true;
    geo.setDrawRange(0, fc.n);
    geo.computeBoundingSphere();
    // 太近 = 危險紅(落在自身爆風內,無差別+自損)優先;未對準 = 警示紅;彈射模式冷色;高角度曲射琥珀色
    const col = fc.close ? 0xff2020 : !fc.ok ? 0xff6a6a : fc.aa ? 0x9adfff : fc.high ? 0xffd24a : this._shotCols(this.side).col;
    ag.line.material.color.setHex(col);
    if (fc.hasImpact) {
      ag.marker.visible = true;
      // 對空/直擊機體的交會點在半空(投影到地面會落在遠方山腳,讀不出交會位置)→ 環直接畫在彈道終點
      const gy = this.terrain.heightAt(fc.impact.x, fc.impact.z);
      ag.marker.position.set(fc.impact.x,
        fc.impact.y - gy > (fc.aa ? BALLISTIC.AA_ALT : 1.2) ? fc.impact.y : gy + 0.3, fc.impact.z);
      ag.marker.material.color.setHex(col);
    } else ag.marker.visible = false;
  }

  /** 懶建拋物線指示物件(虛線 + 落點環,預配置緩衝持久重用;避免每幀重建 attribute 洩漏 GPU buffer) */
  _ensureArcGuide() {
    if (this._arcGuide) return;
    const MAXP = ARC_MAXP;
    const arr = new Float32Array(MAXP * 3);
    const ld = new Float32Array(MAXP);
    const geo = new THREE.BufferGeometry();
    const posAttr = new THREE.BufferAttribute(arr, 3);
    posAttr.setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute('position', posAttr);
    const ldAttr = new THREE.BufferAttribute(ld, 1);
    ldAttr.setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute('lineDistance', ldAttr);
    geo.setDrawRange(0, 0);
    const group = new THREE.Group();
    group.userData.noOutline = true;
    const line = new THREE.Line(geo,
      new THREE.LineDashedMaterial({ color: 0xffd27a, dashSize: 2.2, gapSize: 1.6, transparent: true, opacity: 0.9, depthWrite: false }));
    line.userData.noOutline = true;
    const marker = new THREE.Mesh(
      new THREE.RingGeometry(1.4, 2.0, 24),
      new THREE.MeshBasicMaterial({ color: 0xffd27a, transparent: true, opacity: 0.85, side: THREE.DoubleSide, depthWrite: false }));
    marker.rotation.x = -Math.PI / 2;
    marker.userData.noOutline = true;
    group.add(line); group.add(marker);
    this.scene.add(group);
    this._arcGuide = { group, line, marker, arr, ld, maxp: MAXP };
  }

  /** 重武器(rail 類)蓄力狀態:純視覺轉播(同 onTracer),驅動射手第三人稱機體的掛點動畫 —
   *  蓄力窗是敵方可利用的戰術情報,MUST 即時轉播(不等 8Hz 快照),讓被瞄準的一方有反應時間。 */
  onHeavyCharge(m) {
    const t0 = performance.now() / 1000;
    for (const ent of this.ents.values()) {
      if (ent.pid !== m.pid) continue;
      ent.heavyFx = m.on ? { phase: 'charge', t0 } : null;
    }
  }

  /** 重武器擊發瞬間:third-person 掛點的釋放/後座演出(所有類型共通,不限 rail) */
  onHeavyFire(m) {
    const t0 = performance.now() / 1000;
    for (const ent of this.ents.values()) {
      if (ent.pid !== m.pid) continue;
      ent.heavyFx = { phase: 'fire', t0 };
    }
  }

  // ---------------- 三機小隊:主視野接管 ----------------
  /**
   * 伺服器是主視野的唯一決定者(死亡自動讓位 / V 鍵手動切換)。
   * 接管 = 座艙瞬移到新座機的伺服器座標(e.y 是離地高度),舊座機交還給僚機 AI 渲染。
   */
  _takeOver(ent, e) {
    if (!e.act) { ent.isSelf = false; ent._snapPos = true; return; }
    for (const o of this.ents.values()) {
      if (o.hero && o.isSelf && o !== ent) { o.isSelf = false; o._snapPos = true; }
    }
    // 切換前的視野方向與位置(this.pos 此刻仍是舊座機):新座機在跟隨距離內就沿用原視野方向
    // (含被擊墜自動讓位),太遠(還沒歸隊到編隊距離)才用該機自身朝向。
    const prevYaw = this.yaw, prevX = this.pos.x, prevZ = this.pos.z;
    ent.isSelf = true;
    const wx = e.x, wz = -e.z;
    this.pos.set(wx, this.terrain.heightAt(wx, wz) + (e.y ?? 0), wz);
    this.vel.set(0, 0, 0);
    this.vy = 0;
    const near = Math.hypot(wx - prevX, wz - prevZ) <= SQUAD.REGROUP_M;
    this.yaw = near ? prevYaw : (e.ry ?? this.yaw);
    this.bodyYaw = this.yaw;
    this.firing = false;
    this._crashSent = false;
    this.trauma = 0.35;
    this._airSink = 0;        // 換座機:掉高待落帳是上一具機體的,不跟著搬(_prevVital 同理)
    this._liftLockUntil = 0;
    this.unbalLeft = 0;
    this._prevVital = null;   // 換座機:重置受傷偵測基準,避免血量落差誤觸暈影
    this._prevSp = null;      // 同上:護盾損耗基準一併重置,否則首包快照誤閃大盾光
    this._clearCcFlash();     // 換座機:白幕是上一具機體的感光反應,不跟著視野搬過來
    this._clearBlood();       // 換座機:血漬是上一具機體座艙玻璃上的,同理不跟著搬
    this._burstQ = null;      // 換座機:未補畫完的連發是上一具機體的槍口,不跟著搬
    this.recoil.p = 0; this.recoil.y = 0; this._recoilMoveF0 = 1;   // 換座機:後座是上一具機體那發的,不跟著搬
    this.hud.feed?.(`🔀 主視野切換至 ${(e.si ?? 0) + 1} 號機`);
  }

  /** 切換主視野(V 循環 / 1~3 直選);實際換機由伺服器裁決 */
  _swapDrone(i) {
    if (!this.isDrone || !this.side) return;
    this.net.send(i == null ? { t: 'swap' } : { t: 'swap', i });
  }

  /**
   * 準星鎖定:準星掃到「射程內」的敵方單位就回報伺服器(全機種通用)。
   * 伺服器複驗距離/視野後廣播 lock 事件 → 施放者看到光暈、目標本人跳警告。
   * 只送變化與心跳,避免每幀灌訊息。
   */
  _tickLock(now) {
    if (this.dead || this.shopOpen || !this.side) return;
    if (now - (this._lockAt || 0) < 0.25) return;
    this._lockAt = now;
    const def = this._curWeapon().def;
    if (!def) return;
    // 索敵半徑取機制上限,再以**對這個目標**的有效射程誠實夾回(與射程光暈同一個數字 ——
    // 鎖定目標刻意不亮射程光暈而改亮 lockGlow,兩者若不同界就會出現「鎖得到卻打不到」;
    // 扇形取中央格最遠,與 _shotVictims 逐格射程同界)。
    const t0 = this._aimTarget(this._maxRange(def));
    const lockMul = aoeClass(def) === 'fan' ? FAN_RANGE_CENTER_F : 1;
    const t = t0 && this.pos.distanceTo(t0.mesh.position) - this._hitR(t0) <= this._effRange(def, t0) * lockMul ? t0 : null;
    if (t) { this.net.send({ t: 'lock', id: t.id }); return; }
    // 在外彈頭的鎖定維持(射後不理):收鏡切回輕武器後,離架時已鎖定的目標超出輕武器射程,
    // 準星解從此報 miss;若放任不報,伺服器 LOCK.TTL 到期後著彈被當無鎖定丟棄 = 收鏡即丟追擊。
    // 在外 fnf 彈頭的 homing(擊發當下的準星解)輪流續報,仍以重武器有效射程誠實夾回
    // (「只能在射程內鎖定」不變,只是改吃重武器那一把;伺服器 heroLock 另以同一目標續報複驗)。
    // 都報不上才清光暈。
    const hd = this.wdef.heavy;
    if (hd && trajClass(hd) === 'fnf') {
      const cands = [];
      for (const b of this.bullets) {
        if (!b.fnf || b.homing == null) continue;
        const ht = this.ents.get(b.homing);
        if (!ht || ht.dead || !this._isFoeEnt(ht)) continue;
        if (this.pos.distanceTo(ht.mesh.position) - this._hitR(ht) > this._effRange(hd, ht)) continue;
        if (!cands.includes(ht)) cands.push(ht);
      }
      if (cands.length) {
        this._lockKeepRi = ((this._lockKeepRi || 0) + 1) % cands.length;
        this.net.send({ t: 'lock', id: cands[this._lockKeepRi].id });
        return;
      }
    }
    this._clearLockGlow();
  }

  /**
   * 「準星現在對著哪個敵人」——**唯一實作**。兩個消費端共用:`_tickLock`(回報伺服器求鎖定)
   * 與 `_tryFire`(射後不理飛彈的追蹤對象);MUST NOT 在擊發端另寫一份目標解析。
   *
   * 三段依序(與舊制 `_tickLock` 逐條相同):
   *  ① 拋物線武器(trajClass 'lob'):吃**火控解**而非準星直射線 —— 使用者規則「射程光暈要在
   *     拋物線對準時才亮」:準星壓在敵人身上但彈道被稜線擋住/超出包絡 = 打不到,就不該鎖。
   *     MUST NOT 在此另解一次彈道;火控解不合格即回 null(不往下退回直射線)。
   *  ② 準星精確射線掃到射程內敵方(伺服器仍會複驗)。
   *  ③ 錐形瞄準輔助:中心單射線常穿過 humanoid 四肢縫隙,或狙擊模式移動靠近時準星微偏 →
   *     射線瞬間掃空。取準星小錐內、射程內、視線無遮擋的敵方英雄(遲滯優先既有鎖定)。
   */
  _aimTarget(rng) {
    const fc = this._lobFc;
    if (fc?.on) {
      return fc.ok && this._isFoeEnt(fc.ent) && !fc.ent.dead ? fc.ent : null;
    }
    const { ent, point } = this._resolveAim(rng);
    if (ent && this._isFoeEnt(ent) && point && this.pos.distanceTo(point) <= rng) return ent;
    return this._coneAcquire(rng) || null;
  }

  /** 瞄準點 = 機體幾何中心(**單一縫**):錐形索敵與視野鎖定量的是同一個點,
   *  各寫一份就會出現「鎖得到卻瞄到腳邊」。`dimTop/dimH` 是 spawn 時量好的機體尺寸。 */
  _entAimPoint(ent) {
    const c = ent.mesh.position.clone();
    const scale = (ent.bossSeg != null ? bossScaleF(ent.bossSeg) : 1) * superScaleF(ent.sv || 0);
    c.y += (ent.dimTop != null ? (ent.dimTop - ent.dimH * 0.5) * scale : 2 * scale);
    return c;
  }

  /** 敵對判定(單一縫):同陣營/中立非敵;超級方與第三方野營互為中立(傷害端見 sim._damage) */
  _isFoeEnt(ent) {
    if (!ent || !ent.side || ent.side === this.side || ent.neutral) return false;
    if (isSuperSide(this.side) && isThirdSide(ent.side)) return false;
    return true;
  }

  /**
   * 索敵 + 黏著(**唯一實作**):取景內、射程內、`_obstHitT` 無遮擋的存活敵方單位裡,
   * 取最正對準星的那個;既有目標仍合格則優先保留(遲滯,防忽明忽滅)。
   *
   * 三個消費端共用這一份,差異只在具名參數 —— MUST NOT 為了其中一邊另寫一份掃描
   * (兩份「哪個敵人在準星上」必定漂移,玩家會看到鎖定光暈與視野鎖定各指一個人):
   *   ① `_aimTarget`(準星鎖定 / 射後不理追蹤):預設值 —— 準星錐 ~8°、**只鎖英雄**
   *      (NPC/塔體型大,精確射線本就打得中)、遲滯錨在伺服器複驗過的 `_lockId`。
   *   ② `_tickViewLock` 黏著:取景換成**視野框**(`ndc`)、放行所有敵方單位(塔與小兵一樣要能鎖)、
   *      遲滯錨在自己的 `_vlockId` 且放寬到 `VIEW_LOCK.DROP` 才脫鎖。
   *   ③ `_tickViewLock` 輪替(`list`):同一次掃描改回傳**整份名冊**(依畫面由左至右),
   *      給「按一次切下一個」用 —— 名冊與黏著判定同一份條件,MUST NOT 各判一次「看不看得見」。
   *
   * 取景兩種(`ndc` 旗標),門檻與回傳值一律正規化到同一把尺(見 data.js VIEW_LOCK)。
   */
  _coneAcquire(rng, opt) {
    const ndc = !!opt?.ndc;                      // true = 取景吃「畫面/鏡圈」,false = 準星錐
    const LIM = opt?.lim ?? 0.14;                // 取得門檻(錐 = rad ~8°;視野框 = 正規化偏離度)
    const KEEP = opt?.keepLim ?? LIM;            // 既有目標放寬到這個門檻才脫鎖
    const heroOnly = opt?.hero !== false;
    const keepId = opt && 'keepId' in opt ? opt.keepId : this._lockId;
    const ro = this.camera.position;
    const fwd = this.camera.getWorldDirection(new THREE.Vector3());
    const v = new THREE.Vector3();
    // 相機矩陣的反矩陣自己算:`camera.matrixWorldInverse` 是 renderer.render 才寫的,
    // 開場第一幀還是單位矩陣(整份名冊會算在錯的地方)。matrixWorld 與 `fwd` 同樣是上一幀的姿態 ⇒ 同調。
    const mvi = ndc ? new THREE.Matrix4().copy(this.camera.matrixWorld).invert() : null;
    const W = this.canvas.clientWidth || 1, H = this.canvas.clientHeight || 1;
    // 狙擊模式的取景邊界 = 鏡圈正圓(半寬單位 vmin ⇒ 換成像素);曲線是 data.js `scopeRvminFog` 那一份
    // (火場縮圈 × 天氣霧等比縮,與主畫面 `--scope-r` 同一支,遮罩黑掉的地方 MUST NOT 鎖得到)
    const rPx = Math.max(1, scopeRvminFog(this._scopeFog, this._weatherFogD) / 100 * Math.min(W, H));
    let lastX = 0;                               // off() 的副產品:水平投影(NDC x),名冊排序用
    /**
     * 偏離度(**取景唯一判定**):錐模式回傳夾角(rad,與門檻同單位);視野框模式回傳
     * 正規化值 —— 0 = 準星正中央、1 = 取景邊界(狙擊 = 鏡圈半徑、一般 = 畫面邊緣)、>1 = 看不見。
     */
    const off = (c) => {
      if (!ndc) return fwd.angleTo(v.copy(c).sub(ro));
      v.copy(c).applyMatrix4(mvi);
      if (v.z > -0.05) return Infinity;               // 相機後方:投影會左右鏡射 ⇒ MUST 先擋掉
      v.applyMatrix4(this.camera.projectionMatrix);   // Vector3.applyMatrix4 自帶透視除法
      lastX = v.x;
      return this.aiming ? Math.hypot(v.x * W, v.y * H) * 0.5 / rPx
        : Math.max(Math.abs(v.x), Math.abs(v.y));
    };
    const score = (ent, lim) => {   // 合格回傳偏離度(越小越正對),不合格回 -1
      if (!this._isFoeEnt(ent) || (heroOnly && !ent.hero)
        || !ent.mesh?.visible || ent.dead) return -1;
      const c = this._entAimPoint(ent);
      if (this.pos.distanceTo(c) > rng) return -1;                     // 出射程
      const o = off(c);
      if (!(o <= lim)) return -1;                                      // 取景外
      const dB = this._obstHitT(ro.x, ro.y, ro.z, c.x, c.y, c.z);
      return (dB != null && dB < ro.distanceTo(c) - 1) ? -1 : o;       // 障礙擋在目標前 = 失去火控
    };
    const cur = keepId != null ? this.ents.get(keepId) : null;
    const list = opt?.list ? [] : null;
    if (!list && cur && score(cur, KEEP) >= 0) return cur;             // 遲滯:既有目標仍合格不切換
    let best = null, bestOff = Infinity;
    for (const ent of this.ents.values()) {
      const a = score(ent, ent === cur ? KEEP : LIM);
      if (a < 0) continue;
      if (list) list.push({ ent, off: a, x: lastX });
      if (a < bestOff) { best = ent; bestOff = a; }
    }
    // 名冊模式:依**畫面由左至右**排序。MUST NOT 改成「離準星遠近」——
    // 鎖定會把視角收斂到目標身上,依遠近排的名冊每切一次就重排 ⇒ 第三個以後永遠輪不到。
    return list ? list.sort((a, b) => a.x - b.x) : best;
  }

  /**
   * 視野鎖定(觸控 ZR;常數見 `data.js VIEW_LOCK`)。**按一次 = 輪替到前方視野內的下一個敵人**,
   * 按住期間把**基準視角**朝該目標收斂 —— 純客戶端視角輔助,伺服器不參與(送出去的仍只有
   * 本來就會回報的視角)。
   *
   * 四條 MUST:
   *   ① 只動 `yaw/pitch`(經 `_applyLook` 單一縫),**MUST NOT** 直接設相機朝向 ——
   *      相機角 = 基準角 + `recoil` + 震動,直接設等於把後座力與鏡頭震動一起吃掉,
   *      而使用者要的是「鎖定了但還是會有後座力」:上踢照舊,只是回穩後準星自己回到目標身上。
   *   ② 目標解析走 `_coneAcquire`(唯一實作,只放寬參數),MUST NOT 另寫一份掃描;
   *      「看得見誰」= 視野框取景(狙擊模式自動吃鏡圈),MUST NOT 在這裡另判一次。
   *   ③ 輪替錨點 `_vlockPrev` MUST **跨放開保留**(`_vlockId` 放開即清)—— 這顆是按住型鈕,
   *      不留著的話每次按下都從名冊頭開始,永遠只鎖得到同一個人(= 使用者要的「輪流」失效)。
   *   ④ 索敵節流 8Hz:逐幀對全場實體跑障礙射線是熱路徑,而鎖定目標本來就該黏著不跳
   *      (按下輪替/目標消失才重找)。收斂本身仍逐幀跑,不然轉頭會一格一格的。
   */
  _tickViewLock(dt, now) {
    if (!this._vlockHold || this.dead || this.paused || this.shopOpen || !this.side) {
      this._vlockId = null; this._vlockNext = false; this._setVlockUi(false); return;
    }
    const def = this._curWeapon().def;
    const rng = def ? this._maxRange(def) : 0;   // 索敵半徑取機制上限(視角輔助不涉傷害;與 `_tickLock` 同一把尺)
    const opt = { ndc: true, lim: VIEW_LOCK.EDGE, keepLim: VIEW_LOCK.DROP, hero: false };
    if (this._vlockNext) {
      // 這一次按下 = 切到名冊的下一個(由左至右輪替,到底再回到最左邊)
      this._vlockNext = false; this._vlockAt = now;
      const list = rng > 0 ? this._coneAcquire(rng, { ...opt, keepId: this._vlockPrev, list: true }) : [];
      const i = list.findIndex((e) => e.ent.id === this._vlockPrev);
      // 上一個還在名冊裡 → 輪下一個;不在(第一次按/跑出視野)→ 先鎖最正對準星的那個
      const t = !list.length ? null
        : (i >= 0 ? list[(i + 1) % list.length] : list.reduce((a, b) => (b.off < a.off ? b : a))).ent;
      this._vlockId = t ? t.id : null;
      this._vlockPrev = this._vlockId;
      // 按下去 MUST 講一聲(第幾個/共幾個):沒有回饋玩家只會覺得「這顆鈕壞了」(寧缺勿錯的可見版)
      this.hud?.feed?.(t
        ? `🎯 視野鎖定 ${list.findIndex((e) => e.ent === t) + 1}/${list.length}`
        : `🎯 ${this.aiming ? '狙擊鏡' : '前方視野'}內沒有可鎖定的敵人`);
    } else if (now - (this._vlockAt || 0) >= 0.12) {
      // 黏著:目標還在取景內(放寬到 DROP)就不換人;跑掉/被擋住/死了才交棒給最正對準星的
      this._vlockAt = now;
      const t = rng > 0 ? this._coneAcquire(rng, { ...opt, keepId: this._vlockId }) : null;
      this._vlockId = t ? t.id : null;
      if (this._vlockId != null) this._vlockPrev = this._vlockId;
    }
    const t = this._vlockId != null ? this.ents.get(this._vlockId) : null;
    if (!t || t.dead || !t.mesh?.visible) { this._vlockId = null; this._setVlockUi(false); return; }
    this._setVlockUi(true);
    const c = this._entAimPoint(t);
    const ro = this.camera.position;
    const dx = c.x - ro.x, dy = c.y - ro.y, dz = c.z - ro.z;
    const flat = Math.hypot(dx, dz);
    if (flat < 0.01) return;
    // 相機前向 = (−sin yaw·cos pitch, sin pitch, −cos yaw·cos pitch)(three:−z 為前)
    let dYaw = Math.atan2(-dx, -dz) - this.yaw;
    dYaw = Math.atan2(Math.sin(dYaw), Math.cos(dYaw));           // 收進 ±π,免得繞遠路轉一圈
    const dPitch = Math.atan2(dy, flat) - this.pitch;
    // 每幀轉多少 = `data.js viewLockStep`(唯一縫:逼近係數與角速度上限取小者),兩軸同吃;
    // 套用走 `_applyLook`(視角套用唯一縫,俯仰夾制只住那裡;系統追瞄繞過方向反轉)。
    this._applyLook(viewLockStep(dYaw, dt), viewLockStep(dPitch, dt), true);
  }

  /** 鎖定中的鈕面亮燈:狀態唯一真相在此(比照 `body.mm-near`),觸控層不必自己記一份 */
  _setVlockUi(on) {
    if (on === this._vlockUi) return;
    this._vlockUi = on;
    document.body.classList.toggle('vlock', on);
  }

  /**
   * 劇情模式 BOSS 視野生命條:
   * 劇情戰役(defSide)中,當敵方 BOSS 進入視野(錐內 + 無遮擋)時最上方顯示 BOSS 生命條。
   * 具備 3.0 秒視角轉開遲滯,避免轉頭或閃避時閃爍;BOSS 陣亡或離開戰場時熄滅。
   */
  _updateBossBar(now) {
    if (!this.cfg?.defSide) return;
    const eye = this.camera.position;
    if (!this._bossMvi) this._bossMvi = new THREE.Matrix4();
    this._bossMvi.copy(this.camera.matrixWorld).invert();
    const v = this._bossV || (this._bossV = new THREE.Vector3());

    let targetBoss = null;
    let minD = Infinity;

    for (const ent of this.ents.values()) {
      if (!ent.isBoss || ent.dead || !ent.mesh?.visible || ent.side !== this.cfg.defSide) continue;
      if ((ent.hp || 0) <= 0) continue;

      const c = this._entAimPoint ? this._entAimPoint(ent) : ent.mesh.position;
      v.copy(c).applyMatrix4(this._bossMvi);
      if (v.z > -0.1) continue; // 相機後方

      v.applyMatrix4(this.camera.projectionMatrix);
      if (Math.abs(v.x) > 1.15 || Math.abs(v.y) > 1.15) continue; // 視野框外

      const dist = eye.distanceTo(c);
      const hitT = this._obstHitT ? this._obstHitT(eye.x, eye.y, eye.z, c.x, c.y, c.z) : null;
      if (hitT != null && hitT < dist - 1.0) continue; // 障礙遮蔽

      if (dist < minD) {
        minD = dist;
        targetBoss = ent;
      }
    }

    if (targetBoss) {
      this._activeBossId = targetBoss.id;
      this._bossLastSeenAt = now;
    }

    let active = this._activeBossId != null ? this.ents.get(this._activeBossId) : null;
    if (active && (!active.isBoss || active.dead || (active.hp || 0) <= 0 || (now - (this._bossLastSeenAt || 0) > 3.0))) {
      active = null;
      this._activeBossId = null;
    }

    if (active) {
      const seg = active.bossSeg != null ? active.bossSeg : 0;
      const phase = Math.min(bossSegN(), Math.max(1, seg + 1));
      const ch = CHARACTERS[active.ch];
      // 小隊總量(data.js ①:段位量的是 Σhp/Σmaxhp,含已墜毀機體):同 pid 的 BOSS 機體加總。
      // MUST NOT 用單機 hp/maxHp —— active 只是小隊其中一架,打中別架時它根本不動;
      // 且非自機 ent 沒有 maxHp 那一格(只有快照 max),分母會掉成 1、整條恆滿。
      let hp = 0, max = 0, sp = 0, maxSp = 0;
      if (active.pid != null) {
        for (const ent of this.ents.values()) {
          if (!ent.isBoss || ent.pid !== active.pid) continue;
          hp += Math.max(0, ent.hp || 0);
          max += ent.max || 0;
          sp += ent.sp || 0;
          maxSp += ent.maxSp || 0;
        }
      }
      if (!(max > 0)) { hp = active.hp || 0; max = active.max || 1; sp = active.sp || 0; maxSp = active.maxSp || 0; }
      this.hud.bossBar?.({
        name: ch?.name || active.name || '戰地首領',
        sub: ch?.machine || (active.side === 'STEEL' ? '鋼鐵帝國 BOSS' : '異星蜂群 BOSS'),
        phase,
        hp,
        maxHp: max,
        sp,
        maxSp,
        seg,   // 已擊破段數:頂部條的填充/外框逐段色由 main.js 向 data.js 取,不經此轉手
        ch: active.ch || null,       // BOSS 頭像:角色 ID(main.js 走 avatarURL,與名冊同一縫)
        side: active.side || null,   // BOSS 頭像站位與框體:SWARM 左 / STEEL 右
        pch: this.ch || null,        // 自機頭像:擺另一端(觀戰無座機則隱藏)
        pside: this.side || null,
      });
    } else {
      this.hud.bossBar?.(null);
    }
  }


  // ---------------- 餌機掛點(純外觀;2026-08-06 起只服務攻招載具遞送)----------------
  /** 掛點餌機:組合(慢慢裝上)/ 分離(瞬間彈出)的縮放動畫 */
  _updateDecoyPod(ent, dt) {
    const pod = ent.mesh.userData.decoyPod;
    pod.userData.s0 ??= pod.scale.x;
    pod.userData.x0 ??= pod.position.x;
    const want = ent.dock ? 1 : 0;
    const s = ent.podS ?? want;
    const rate = want ? 2.4 : 9;   // 組合:機械臂慢慢裝填;分離:彈射瞬間抽離
    ent.podS = s + Math.max(-rate * dt, Math.min(rate * dt, want - s));
    pod.visible = ent.podS > 0.02;
    pod.scale.setScalar(pod.userData.s0 * ent.podS);
    pod.position.x = pod.userData.x0 - (1 - ent.podS) * 1.2;   // 分離時往外滑開
  }

  /**
   * 範圍光暈 —— 語意演進三代,每一代都是使用者回報推動的:
   *   ① 2026-07-29「武器範圍內所有敵人都會出現範圍光暈」= 距離夠近就亮。
   *   ② 2026-07-30「榴彈類武器常常出現射程光暈卻沒命中對方」= 這一發**打得到**才亮
   *      (彈道解過得去 / 視線通,`_reachable` 逐彈道分派)。
   *   ③ 2026-08-03 使用者定案「範圍光暈不是單純在射程範圍內就亮,而是:**準星的目標在射程內
   *      被擊中時、同時會受到傷害的單位才亮**」= 這一發的**傷害足跡**預覽。
   *
   * ② 亮的是「我打得到的每一個敵人」—— 一把 190m 的重武器在前線會讓半個畫面同時發光,而其中
   * 絕大多數不是**這一發**會傷到的人;玩家真正要的資訊是「現在扣扳機,誰會掉血」。③ 因此把名冊
   * 從「逐敵人可命中」換成「這一發的結算足跡」(`_shotVictims`,依 `aoeClass` 逐類鏡射伺服器幾何)。
   * ② 的判據沒有被丟掉,而是收斂成足跡的**入口閘**:準星那一發打不到 ⇒ 誰都不會受傷 ⇒ 全場熄燈。
   *
   * 三種光暈同時存在、語意不重疊:準星鎖定目標 = lockGlow(較亮,本層跳過不疊兩層)、
   * 會受傷 = 陣營色淡光暈、會受傷但命中率低/會自損(榴彈最小安全射程內、導引彈軌跡修正期內)
   * = 琥珀警示色 —— ③ 起警示是**整發**的性質(名冊一起轉色),不再逐敵人各判一次。
   * 純表現層(迷霧由快照過濾 → mesh.visible 天然把關,A10 不涉)。
   * A25:sprite 走物件池、共用兩份 SpriteMaterial 與快取光暈貼圖 —— 進出名冊只是
   * add/remove + 縮放,MUST NOT 每幀重配材質/貼圖;ent 移除時回收進池(_removeEnt)。
   */
  _updateRangeGlows() {
    const pool = this._rgPool || (this._rgPool = []);
    const poolS = this._rgPoolS || (this._rgPoolS = []);
    const drop = (ent) => {
      if (ent._rgGlow) { ent._rgGlow.parent?.remove(ent._rgGlow); pool.push(ent._rgGlow); ent._rgGlow = null; }
    };
    const dropS = (ent) => {
      if (ent._rgGlowS) { ent._rgGlowS.parent?.remove(ent._rgGlowS); poolS.push(ent._rgGlowS); ent._rgGlowS = null; }
    };
    // ---- ① 武器光暈(現有邏輯不變)----
    // shopOpen 一併擋掉:`_lobAim` 對它早退 ⇒ `_lobFc.on` 為假,不擋的話拋物線武器會掉進
    // 直射線那條分支去解一個根本不存在的準星解。
    const def = (this.side && !this.dead && !this.shopOpen) ? this._curWeapon().def : null;
    const shot = def ? this._shotVictims(def, reachRule(def)) : null;
    // 武器無目標時只收回武器光暈;招式光暈走獨立路徑(允許在掩體後施放補血/增益時仍顯示足跡)
    if (!shot) {
      for (const ent of this.ents.values()) drop(ent);
    } else {
      const mat = this._rgMaterial(shot.warn);
      const lit = this._rgLit || (this._rgLit = new Set());
      lit.clear();
      // 鎖定目標另有 lockGlow,不疊兩層;攻堅鎖血的建築完全免傷 ⇒ 亮燈是騙人(伺服器 siegeLocked 同判)
      for (const ent of shot.hits) if (ent.id !== this._lockId && !ent.lk) lit.add(ent);
      for (const ent of this.ents.values()) {
        if (!lit.has(ent)) { drop(ent); continue; }
        if (ent._rgGlow) { ent._rgGlow.material = mat; continue; }
        const sp = pool.pop() || new THREE.Sprite(mat);
        sp.material = mat;
        sp.userData.noOutline = true;
        // 尺寸/定位與 lockGlow 的 halo 同一條規則:直徑 = 機體高/寬取大 ×1.15、貼機體幾何中心
        const h = ent.dimH ?? 4, r = ent.dimR ?? 1.5, top = ent.dimTop ?? h;
        sp.scale.setScalar(Math.max(3, Math.max(h, r * 2) * 1.15));
        sp.position.set(0, top - h * 0.5, 0);
        ent.mesh.add(sp);
        ent._rgGlow = sp;
      }
    }
    // ---- ② 招式光暈(詠唱期間顯示,與武器光暈並存)----
    // 獨立於武器光暈:即使武器無目標(如在掩體後施法)也能顯示招式足跡。
    const castA = (this._isCasting() && this._lastCastA) ? this._lastCastA : null;
    const skillHits = castA ? this._skillVictims(castA.A, castA.x, castA.z) : [];
    const matS = castA ? this._rgMaterial(false, true) : null;
    const litS = this._rgLitS || (this._rgLitS = new Set());
    litS.clear();
    for (const ent of skillHits) litS.add(ent);
    for (const ent of this.ents.values()) {
      if (!litS.has(ent)) { dropS(ent); continue; }
      if (ent._rgGlowS) { ent._rgGlowS.material = matS; continue; }
      const sp = poolS.pop() || new THREE.Sprite(matS);
      sp.material = matS;
      sp.userData.noOutline = true;
      // 招式光暈略大(×1.35 vs ×1.15),視覺可與武器光暈區分
      const h = ent.dimH ?? 4, r = ent.dimR ?? 1.5, top = ent.dimTop ?? h;
      sp.scale.setScalar(Math.max(3.5, Math.max(h, r * 2) * 1.35));
      sp.position.set(0, top - h * 0.5, 0);
      ent.mesh.add(sp);
      ent._rgGlowS = sp;
    }
  }


  /**
   * 「這一發會傷到誰」——**範圍光暈的唯一名冊**(2026-08-03 使用者定案,見 `_updateRangeGlows`)。
   * 回 `null` = 誰都傷不到(整場熄燈);否則 `{ hits:[ent], warn }`,warn 是**整發**的性質。
   *
   * ① 入口閘(準星這一發成不成立)——判定 MUST 走既有單一縫,MUST NOT 在此另解一次:
   *    ・拋物線:吃每幀已定案的火控解 `this._lobFc`(`fc.ok` 已含 45°/裝藥階梯 + 射程包絡 +
   *      地形截斷),落點取積分的實際著彈點 `fc.impact`。
   *    ・其餘:準星解走 `_lobCrosshair`(準星優先的同一份快取);準星壓在敵人身上 ⇒ 用
   *      `_reachable` 定案(② 代那份判據原封不動搬過來當閘門)。準星壓在地形/障礙/空無處時:
   *      爆炸型只要落點還在射程球內就照樣炸(落點本來就不必是單位);扇形/貫穿的足跡由**射向**
   *      定案(錐 / 圓柱都從槍口張開,伺服器 heroPlasma / heroLance 同樣不需要準星目標),
   *      逐目標各自吃射程與視線;單體直擊沒有準星目標就是誰都傷不到。
   *
   * ② 傷害足跡 —— **分類只走 `aoeClass(def)` 這一份**(MUST NOT 在此比對 def.type),
   *    逐類鏡射伺服器結算幾何(兩端分家 = 光暈亮著卻沒掉血 / 掉血卻沒亮):
   *    ・blast → `sim._blast`:量到命中量體最近點(水平 `_hitR` + 垂直帶 `_bodyDy`),
   *      `blastFalloff > 0` 即入列。**刻意不吃 LOS 也不吃射程**(A11):牆邊炸開照樣傷到牆後
   *      的人、落點外緣的敵人照吃濺射 —— 這正是 ③ 這一代最想讓玩家看見的那一組單位。
   *    ・fan → `sim.heroPlasma`:水平夾角在錐內(d2 ≤ 8 的正上/正下視為錐內)+ 逐目標有效
   *      射程 + 射線淨空。
    *    ・line → `sim._lanceHits` 的客戶端鏡射 `_lancePierced`(圓柱半徑 = lanceR + 目標水平量體,
    *      含穿透力截斷);射程再以逐目標誠實界夾回(伺服器 heroLance 同一條)。
   *    ・null(單體直擊輕武器)→ 只有準星那一個目標。
   */
  _shotVictims(def, rule) {
    const from = this._rgFrom || (this._rgFrom = new THREE.Vector3());
    const impact = this._rgAim || (this._rgAim = new THREE.Vector3());
    const cls = aoeClass(def);
    const foe = (e) => e && !e.isSelf && this._isFoeEnt(e)
      && !e.dead && !e.gar && e.mesh.visible;
    // ---- ① 入口閘:準星這一發的落點 / 打不打得到 ----
    // 球心恆是槍口(與 `_reachable` / 伺服器誠實界同一個點)
    if (this.gunGroup) this.gunGroup.localToWorld(from.copy(this._muzzle));
    else from.copy(this.camera.position);
    const fc = this._lobFc?.on ? this._lobFc : null;
    let ent = null, ok = false, warn = false;
    if (fc) {
      ent = foe(fc.ent) ? fc.ent : null;
      impact.copy(fc.hasImpact ? fc.impact : fc.aim);
      ok = fc.ok; warn = fc.close;   // fc.close = 落點近於最小安全射程(與 _shotWarn 同一條,已在 _lobAim 定案)
    } else if (cls === 'fan' || cls === 'line') {
      // 扇形 / 貫穿**刻意沒有整發性的入口閘**:錐與圓柱都是從槍口張開的,伺服器
      // heroPlasma / heroLance 同樣不看準星解到誰 —— 準星壓在射程外的遠方敵人身上時,
      // 錐內 5m 的那一個照樣會掉血,把整組熄掉才是騙人。射程與視線一律由逐目標的
      // `_inShotRange` 夾回。貫穿的端點另走 pierce 射線(MUST NOT 停在第一個單位身上,
      // 與 `_tryFire` 同一條規則);端點取機制上限只決定圓柱的軸向夾制,只寬不緊。
      if (cls === 'line') impact.copy(this._resolveAim(this._maxRange(def), true).point);
      ok = true;
    } else {
      const c = this._lobCrosshair(def);
      impact.copy(c.pt);
      ent = foe(c.ent) ? c.ent : null;
      if (ent) {
        const g = this._reachable(ent, def, rule, this._effRange(def, ent));
        ok = g.ok; warn = g.warn;
      } else {
        // 準星壓在地形/障礙/空無處:爆炸型的落點本來就不必是單位,還在射程球內就照樣炸;
        // 單體直擊沒有準星目標 = 誰都傷不到。
        ok = cls === 'blast' && from.distanceTo(impact) <= this._effRange(def, null);
        warn = ok && this._shotWarn(def, rule, from.distanceTo(impact));
      }
    }
    if (!ok) return null;
    // ---- ② 傷害足跡 ----
    const hits = [];
    if (cls === 'blast') {
      for (const e of this.ents.values()) {
        if (!foe(e)) continue;
        const p = e.mesh.position;
        const dh = Math.max(0, Math.hypot(impact.x - p.x, impact.z - p.z) - this._hitR(e));
        if (blastFalloff(def.r, Math.hypot(dh, this._bodyDy(e, impact.y))) > 0) hits.push(e);
      }
    } else if (cls === 'fan') {
      const fwd = this.camera.getWorldDirection(this._rgDir || (this._rgDir = new THREE.Vector3()));
      const hl = Math.hypot(fwd.x, fwd.z) || 1;
      // 小錐分格(與 sim.heroPlasma 同式):每格只列最近的一名,跨格大目標可列多次
      const NSUB = fanSubs(def);
      const ax = fwd.x / hl, az = fwd.z / hl;
      const bins = new Array(NSUB).fill(null);
      for (const e of this.ents.values()) {
        if (!foe(e)) continue;
        const p = e.mesh.position;
        const tx = p.x - from.x, tz = p.z - from.z;
        const d2 = Math.hypot(tx, tz);
        const hr = this._hitR(e);
        const h = e.dimH ?? 4;
        const y1 = p.y + (e.dimTop ?? h), y0 = y1 - h;
        const rayY = from.y + (d2 > 0 ? (fwd.y / hl) * d2 : 0);
        const tyTarget = Math.max(y0, Math.min(y1, rayY));
        const ty = tyTarget - from.y;
        const d3 = Math.hypot(tx, ty, tz);
        // 3D 錐緣量到命中量體近側表面(fanConeHalf 單一縫,與 sim.heroPlasma 逐位元同式)
        const dot = (tx * fwd.x + ty * fwd.y + tz * fwd.z) / (d3 || 1);
        if (dot <= 0) continue;
        if (d3 > 8) {
          const ang = Math.acos(Math.min(1, Math.max(-1, dot)));
          if (ang > fanConeHalf(def, d3, hr)) continue;
        }
        if (!this._inShotRange(e, def, from)) continue;   // 目標級快篩(含淨空;中央格最遠,逐格只會更嚴)
        const phi = Math.atan2(tx * az - tz * ax, tx * ax + tz * az);
        const aw = Math.atan2(hr, Math.max(1, d2));
        const [b0, b1] = fanBinSpan(def, phi, aw);   // 分格走單一縫
        const rng = this._effRange(def, e);
        const surf = Math.max(0, from.distanceTo(this._entAimPoint(e)) - hr);
        const surfH = Math.max(0, d2 - hr);
        for (let bi = b0; bi <= b1; bi++) {
          const hitD = fanBinHitD(def, bi, d2, phi, hr);
          if (hitD == null || surf + (hitD - surfH) > rng * fanBinRangeF(def, bi)) continue;   // 每格各自吃逐格球面射程
          if (!bins[bi] || d3 < bins[bi].d3) bins[bi] = { e, d3 };
        }
      }
      // 光暈名冊去重:同一敵人只亮一次(跨格多次傷害是伺服器結算的事;相鄰格同一人恆連續)
      let prev = null;
      for (const win of bins) {
        if (!win || win.e === prev) continue;
        prev = win.e;
        hits.push(win.e);
      }
    } else if (cls === 'line') {
      // 光暈名冊去重:同一敵人只亮一次(跨區多次傷害是伺服器結算的事;同區同人恆連續)
      let prevLine = null;
      for (const h of this._lancePierced(from, impact, lanceR(def), def)) {
        if (!foe(h.ent) || !this._inShotRange(h.ent, def, from) || h.ent === prevLine) continue;
        prevLine = h.ent;
        hits.push(h.ent);
      }
    } else if (ent) hits.push(ent);
    return hits.length ? { hits, warn } : null;
  }

  /**
   * 逐目標「射程內 + 射線淨空」(扇形 / 貫穿的足跡共用):量到**近側表面**、比對逐目標有效射程
   * `_effRange`(與伺服器誠實界同一把尺),扇形取中央格最遠(×FAN_RANGE_CENTER_F,逐格只會更嚴),
   * 線段淨空與 `_reachable` 的 `hit:'clear'` 同一式(`_layerHitT` + `RANGE_GLOW.SURF_TOL_M`)。
   */
  _inShotRange(ent, def, from) {
    const aim = this._entAimPoint(ent);
    const hr = this._hitR(ent);
    const rng = this._effRange(def, ent);
    const surf = Math.max(0, from.distanceTo(aim) - hr);
    const lim = aoeClass(def) === 'fan' ? rng * FAN_RANGE_CENTER_F : rng;
    if (surf > lim) return false;
    const cut = this._layerHitT(from.x, from.y, from.z, aim.x, aim.y, aim.z);
    return cut == null || cut >= surf - RANGE_GLOW.SURF_TOL_M;
  }

  /** 爆點高度 y 到機體垂直帶的距離(帶內 = 0);伺服器 `sim._bodyDy` 的客戶端鏡射 ——
   *  兩端分家就會出現「炸在腳邊沒亮、炸在頭頂亮了」這種只在高低差才現形的偏差。 */
  _bodyDy(ent, y) {
    const p = ent.mesh.position;
    const h = ent.dimH ?? 4;
    const y1 = p.y + (ent.dimTop ?? h), y0 = y1 - h;
    return y < y0 ? y0 - y : (y > y1 ? y - y1 : 0);
  }

  /**
   * 「打得到但會偏 / 會自損」的警示語意(**唯一實作**):榴彈落在最小安全射程內(開砲會落在
   * 自身爆風裡)、導引 / 射後不理還在 `ARMING.m` 的軌跡修正期。兩個消費端 —— `_reachable`
   * (逐目標)與 `_shotVictims`(整發);各寫一份就會出現「同一發在準星上是琥珀、在濺射名冊上是陣營色」。
   */
  _shotWarn(def, rule, d) {
    const mr = lobMinRange(def);
    const arm = rule.arm ? (armingOf(def)?.m || 0) : 0;
    return (mr > 0 && d < mr) || (arm > 0 && d < arm);
  }

  /** 射程光暈的共用材質(A25:全場共用,MUST NOT 逐 ent 配置)。
   *  warn = 琥珀警示色; skill = 青白色招式足跡(與武器陣營色並存、可視區分)。 */
  _rgMaterial(warn, skill = false) {
    if (skill) return this._rgMatSkill || (this._rgMatSkill = new THREE.SpriteMaterial({
      map: glowTexture(), color: 0x66eeff,
      transparent: true, opacity: 0.28,
      blending: THREE.AdditiveBlending, depthWrite: false, depthTest: false,
    }));
    const key = warn ? '_rgMatWarn' : '_rgMat';
    return this[key] || (this[key] = new THREE.SpriteMaterial({
      map: glowTexture(), color: warn ? 0xffb03a : sideInfo(this.side).color,
      transparent: true, opacity: warn ? 0.32 : 0.26,
      blending: THREE.AdditiveBlending, depthWrite: false, depthTest: false,
    }));
  }

  /**
   * 「這一招詠唱中會影響到誰」——招式光暈的足跡名冊。只在 `_isCasting()` 為真時被呼叫。
   * 不鏡射伺服器複雜幾何(招式伺服器結算多樣,精確複製成本高);以招式 `range` 為球半徑做
   * 保守估算(只要有 range 且目標類型符合就入列)。
   *   ・`target: 'self'` → 空(不標記他人)
   *   ・`target: 'enemy'` → 在 range 球內的敵方單位
   *   ・`target: 'team'` / `'ground'` → 在 range 球內的我方單位(含自機)
   * 落點 (cx, cz) 是施放當下的準星落點(已存在 _lastCastA)。
   */
  _skillVictims(A, cx, cz) {
    const hits = [];
    if (!A.range || A.target === 'self') return hits;
    const targetFoe = A.target === 'enemy';
    const ox = this.pos?.x ?? 0, oz = this.pos?.z ?? 0;
    const r = A.range + 4;   // 給一點寬容(招式 range 是傷害半徑,包圍球再放大一點)
    for (const e of this.ents.values()) {
      if (!e.mesh?.visible || e.dead || e.gar || e.neutral) continue;
      const isFoe = e.side && e.side !== this.side;
      if (targetFoe ? !isFoe : isFoe) continue;
      const p = e.mesh.position;
      if (Math.hypot(p.x - cx, p.z - cz) - (this._hitR(e) || 1) > r) continue;
      hits.push(e);
    }
    return hits;
  }

  /**
   * 「這一發打得到嗎」——**準星目標**的唯一判據(2026-08-03 起是範圍光暈足跡的入口閘;
   * 判據本身逐位元不變,只是消費端從「逐敵人」收斂成「準星那一個」),
   * 依 `data.js reachRule()` 逐彈道類型分派
   * (五類 lob/guide/fnf/flat/line 全部住在那張表;此處 MUST NOT 再比對一次 def.type)。
   *
   *   path 'arc' 拋物線:跑**與 `_lobAim` 同一份**火控解(`_lobLadder`,draw=false;對地 45° / 對空階梯)。
   *   path 'ray' 直線:槍口 → 目標命中量體中心的線段,被地形/障礙截斷處即落點(`_layerHitT`)。
   *   hit 'blast' 爆炸戰鬥部:落點落在**爆風核心帶**(blastCoreR + 目標水平量體)內才算打得到 ——
   *        刻意不要求視線通:爆風不吃 LOS(A11 繞射近似),貼著掩體外側炸開照樣傷得到後面的人。
   *   hit 'clear' 直擊/貫穿:線段 MUST 整段淨空到目標近側表面(伺服器 `_losBlocked` 同一條規則)。
   *   arm 導引/射後不理:目標落在 `ARMING.m` 內 = 還在軌跡修正期,打得到但會偏 ⇒ 警示色不熄滅。
   */
  _reachable(ent, def, rule, rng) {
    // 每幀最多評估 RANGE_GLOW.*_PER_FRAME 個目標,暫存向量仍預配置(與 _arcTrace 同一條紀律)
    const from = this._rgFrom || (this._rgFrom = new THREE.Vector3());
    const aim = this._rgAim || (this._rgAim = new THREE.Vector3());
    if (this.gunGroup) this.gunGroup.localToWorld(from.copy(this._muzzle));
    else from.copy(this.camera.position);
    const p = ent.mesh.position;
    // 瞄機體幾何中心(與 _coneAcquire 同一條):打頭/打腳都算打中同一具機體
    aim.set(p.x, p.y + (ent.dimTop != null ? ent.dimTop - ent.dimH * 0.5 : 1.5), p.z);
    const hr = this._hitR(ent);
    if (rule.path === 'arc') {
      if (!inWeaponRange(rng, aim.x - from.x, aim.z - from.z, aim.y - from.y, hr)) return { ok: false, warn: false };
    }
    const full = from.distanceTo(aim);
    const surf = Math.max(0, full - hr);   // 到近側表面(與伺服器 _surfD3 同一把尺)
    // 射程本身也住這裡(**唯一縫**):呼叫端的候選閘刻意只寬不緊,「打得到嗎」的距離判據
    // MUST 與伺服器同一式 —— 量到近側表面、比對逐目標有效射程 `rng`(= _effRange)。
    if (surf > rng) return { ok: false, warn: false };
    if (rule.hit === 'blast') {
      const tol = blastCoreR(def) + hr;    // 落點落在核心帶內 ⇒ 目標吃滿額爆風(blastFalloff)
      let miss;                            // 落點與目標命中量體中心的距離
      if (rule.path === 'arc') {
        // 對空彈射模式(高初速近直線)在準星解到飛行單位時自動生效 ⇒ 判定要用同一個初速與同一段
        // 解法(對地 = 45° 拋投、對空 = 裝藥階梯);少傳這個旗標,光暈就會拿另一條彈道回答
        const aa = TARGET_CLASS[ent.kind] === 'air';
        const L = this._lobLadder(from, aim, rng, this._shotV0(def, aa), tol, false, aa);
        if (!L.arc) return { ok: false, warn: false };   // 全裝藥都超出射程包絡
        miss = L.arc.minD;
      } else {
        const cut = this._layerHitT(from.x, from.y, from.z, aim.x, aim.y, aim.z);
        miss = cut == null ? 0 : Math.max(0, full - cut);   // 被牆截斷 ⇒ 落點離目標還有這麼遠
      }
      if (miss > tol) return { ok: false, warn: false };
      return { ok: true, warn: this._shotWarn(def, rule, surf) };
    }
    const cut = this._layerHitT(from.x, from.y, from.z, aim.x, aim.y, aim.z);
    return { ok: cut == null || cut >= surf - RANGE_GLOW.SURF_TOL_M, warn: false };
  }

  /** 目前被自己鎖定的目標:加上脈動光暈 */
  _setLockGlow(ent) {
    if (this._lockId === ent.id) return;
    this._clearLockGlow();
    this._lockId = ent.id;
    // 基準尺寸(排除受擊殼等子節點)→ 光暈剛好包住目標,塔不再是巨球
    // 鎖定光暈吃「目標」陣營色(舊制吃自機色會誤導成自己人)
    this._lockGlow = lockGlow(ent.mesh, sideInfo(ent.side || this.side).color,
      ent.dimH != null ? { h: ent.dimH, r: ent.dimR, top: ent.dimTop } : null);
    this.hud.feed?.(`🎯 鎖定 ${UNITS[ent.kind]?.name || ent.kind}`);
  }

  _clearLockGlow() {
    if (!this._lockGlow) { this._lockId = null; return; }
    this._lockGlow.parent?.remove(this._lockGlow);
    this._lockGlow = null;
    this._lockId = null;
  }

  /** 命中鎖定目標:讓其鎖定光暈短暫閃亮(vfx.lockGlow 讀 userData.flashAt 衰減)*/
  _flashLockGlow() {
    if (this._lockGlow) this._lockGlow.userData.flashAt = performance.now();
  }

  // ---------------- 自身死亡 / 重生 ----------------
  _onSelfDeath() {
    this.dead = true;
    this.firing = false;
    this.aiming = false;
    if (this.camera && this.camera.fov !== this.baseFov) {
      this.camera.fov = this.baseFov;
      this.camera.updateProjectionMatrix();
    }
    if (this._aimViewRestore) {
      const restore = this._aimViewRestore;
      this._aimViewRestore = null;
      setViewMode(restore);
    }
    this._climb = null;   // 掛在梯上陣亡:狀態 MUST 清掉,否則重生後第一幀會被吸回原本那條路線
    this._airSink = 0;    // 死亡:清掉高待落帳(墜機過場自有物理,兩套下降會打架)
    this._liftLockUntil = 0;
    this._castingUntil = 0;
    this.castLeft = 0;
    this.unbalLeft = 0;
    this._fireDwell = 0; this._swampDwell = 0; this._scopeFog = 0; this._weatherFogD = 0; this.hud.envFog?.(0); this.hud.weatherFog?.(0); this._env = { code: 0, depth: 0, ground: 0, air: false };   // 死亡:清火場霧化/沼澤滯留(_updatePlayer 已早退不再更新)
    this._clearCcFlash();   // 死亡:清致盲白幕(陣亡過場自有白閃,兩層白疊著會蓋掉過場演出)
    this._clearBlood();     // 死亡:清濺血(_updatePlayer 對 dead 早退不再衰減 ⇒ 不清會凍在畫面上)
    this._burstQ = null;    // 死亡:清連發演出佇列(自機那半的閉包會在重生後的新機體上補畫舊武器)
    // 死亡:清後座(`_updatePlayer` 已早退不再衰減 ⇒ 不清就凍在那裡,重生後第一步先被上一具
    // 機體那發重砲的位移懲罰黏住,而準星上踢也還掛在鏡頭上)
    this.recoil.p = 0; this.recoil.y = 0; this._recoilMoveF0 = 1;
    // 死亡:清視野鎖定的目標與鈕面亮燈 —— `_updatePlayer` 對 dead 早退,`_tickViewLock` 不會再跑到
    //(鈕還按著沒關係:重生後照樣重新索敵,與 `firing` 同語意)
    this._vlockId = null; this._vlockPrev = null; this._setVlockUi(false);
    // 陣亡不再跳戰場選單:若當下正開著暫停選單(可能暫停中被擊殺),收掉它,只留陣亡頁
    if (this.paused) { this.paused = false; this.hud.pause?.(false); }
    // 商店保持開啟(陣亡購物):死亡畫面疊在商店下層,B/ESC 仍可開關
    // 這一次解鎖是**我方主動**(要放開滑鼠看陣亡頁),不是玩家按 ESC ⇒ 打戳記讓 `_onPlc` 略過,
    // 否則一死就自動彈出戰場選單。MUST 只在真的鎖著時打:沒鎖就不會有 pointerlockchange,
    // 戳記會留下來把玩家**下一顆**真的 ESC 吃掉。
    if (document.pointerLockElement === this.canvas) this._plcSelf = true;
    document.exitPointerLock?.();

    // ── 陣亡過場(純表現層;伺服器已權威判定死亡)──
    // 於 _applySnap 觸發、早於本幀 _updatePlayer(對 dead 早退未覆寫 camera)→ camera/pos/vel 仍是死亡瞬間的活體姿態
    const fly = this._flying();
    const eye = this.camera.position.clone();                    // 死亡瞬間眼位(過場錨點)
    const surf = this._surf(this.pos.x, this.pos.z, this.pos.y); // 腳下站立表面(橋面/路面/地表)
    const col = sideInfo(this.side).color;                       // 陣營色(碎片 accent / 地環色)
    const dur = fly ? 2.4 : 2.0;
    // 飛行:重力依墜落高度自適應,確保多數高度在收尾前真正墜地(而非半空硬切鏡頭);仍以觸地偵測為準
    const T = dur - 0.55;
    const g = fly ? Math.min(95, Math.max(30, 2 * Math.max(2, eye.y - surf) / (T * T))) : 0;
    this._deathSeq = {
      t: 0, dur, fly, col, eye, surf, g,
      p: eye.clone(),                                            // 飛行墜落積分位置
      v: fly ? this.vel.clone().add(new THREE.Vector3(0, 5, 0)) : null, // 初速 + 微上拋讓弧線明顯
      yaw: this.yaw, pitch: this.pitch, roll: this.roll,
      // 飛行翻滾角速度(rad/s;per-axis 隨機,roll 為主翻滾);地面 null
      spin: fly ? new THREE.Vector3(
        (Math.random() * 2 - 1) * 2.4,                           // pitch
        (Math.random() * 2 - 1) * 1.6,                           // yaw
        (Math.random() < 0.5 ? -1 : 1) * (3.0 + Math.random() * 1.5), // roll
      ) : null,
      smokeAcc: 0, climax: false, holdUntil: 0,
    };
    this.hud.deathCine?.(true);                                  // 紅警邊框亮(白閃只在高潮/觸地觸發)
    // 地面:腳下起火煙柱(~2s);飛行:死亡高度補一記空中火花(die 事件的地面爆在下方,補視覺缺口)
    if (fly) starburst(this.scene, this.effects, eye.x, eye.y, eye.z, 3.0, 0xffb050);
    else this._deathPlume(this.pos.x, surf, this.pos.z);
  }
  _onSelfRespawn(sx, sz) {
    this.dead = false;
    this._deathSeq = null;        // 過場未播完就重生:硬切,交還 _updatePlayer 控制鏡頭
    this.hud.deathCine?.(false);  // 熄紅框(#deadOverlay 由本幀 e.dead=false 的 hud.dead(null) 自動隱藏)
    if (isSuperSide(this.side)) {
      if (sx != null && sz != null) {
        this._lastSuperSpawn = [sx, sz];
        this._placeAt(sx, sz, -sx, -sz);
      } else {
        const [rx, rz] = this._superSpawnAt();
        this._lastSuperSpawn = [rx, rz];
        this._placeAt(rx, rz, -rx, -rz);
      }
    } else if (sx != null && sz != null) {
      // 重生:落在伺服器權威座標(出生/重生點已在己方兵波之後、緊貼兵線那一側),
      // 視線看向「主堡→下一據點中點」(不本地重算落點,免與權威分家)。
      const pick = this._laneDirAt(sx, sz);
      if (pick) {
        const [ax, az] = this._laneAimAt(sx, sz, pick[2], pick[0], pick[1]);
        this._placeAt(sx, sz, ax, az);
      } else this._spawnAt();
    } else {
      this._spawnAt();
    }
    this.vel.set(0, 0, 0);
    this._airSink = 0;        // 重生:清掉高待落帳
    this._liftLockUntil = 0;
    this._castingUntil = 0;
    this.castLeft = 0;
    this.unbalLeft = 0;
    this.lift = null;         // 重生:爬升動力補滿(首幀由 _stepLift 夾到上限)
    // 重生滿彈、重武器 CD 清空
    for (const [id, st] of Object.entries(this.wstate)) { st.ammo = this.wdef[id]?.mag ?? st.ammo; st.reloadEnd = 0; }
    this._crashSent = false;
  }

  // ---------------- 主堡軍械庫(B 鍵)----------------
  _atBase() {
    if (!this.side) return false;
    // 超級方無主堡:雙陣營主堡旁皆視為可補給(與伺服器修裝甲規則同)
    const sides = isSuperSide(this.side) ? ['SWARM', 'STEEL'] : [this.side];
    return sides.some((s) => {
      const b = this.cfg.bases?.[s];
      if (!b) return false;
      const [bx, bz] = llToWorld(b[0], b[1], this.center);
      return Math.hypot(this.pos.x - bx, this.pos.z - bz) <= GAME.HERO_HEAL_RADIUS;
    });
  }

  _shopState() {
    const superMode = isSuperSide(this.side);
    return {
      money: this.money, upg: this.upg,
      ch: this.ch, ab: { ...this.abil }, kn: this.kn,
      kind: this.heroKind, atBase: this._atBase(),
      // 超級大戰:單軌超級升級(LV0~MAX,每階固定 PRICE)+ 自動購買預設勾選(見 _tickReserve)
      super: superMode,
      superLvl: superMode ? (this.upg.super || 0) : 0,
      buySuper: () => this._optimisticBuySuper(),
      // 陣營小兵強化:等級是同陣營共用的權威值(唯讀顯示),購買不做樂觀更新 —— 共用狀態
      // 樂觀扣款會在別人同時買的時候顯示錯位,交給下一份 8Hz 快照校正即可。
      creepUpg: [...(this.creepUpg?.[this.side] || [])],
      // 小兵強化的解鎖門檻:與 `_tickReserve` 共用這一份(UI 自己再算一次 = 兩份門檻會漂)
      allMax: this._upgAllMax(),
      buy: (item) => this._optimisticBuy(item),
      buyCreep: (lane) => this.net.send({ t: 'buy', item: 'creep', lane }),
      // 掃貨 / 預約(2026-08-02 使用者需求):UI 只負責畫,判定與排程一律住這裡
      reserve: [...this._reserve],
      sweep: () => this._sweepBuy(),
      toggleReserve: (item) => this._toggleReserve(item),
      sweepable: this._sweepPick() != null,
      creepKey: (lane) => this._creepResKey(lane),
    };
  }

  /**
   * 八軌全滿 = 陣營小兵強化的解鎖門檻(與伺服器 `sim._upgAllMax` 同一條規則)。
   * 商店 UI(要不要畫那個區塊)與預約排程(送出去會不會被拒)MUST 共用這一份。
   */
  _upgAllMax() {
    return Object.entries(ECON.UPGRADES).every(([k, u]) => (this.upg[k] || 0) >= u.max);
  }

  /** 兵線 → 預約鍵(格式單一縫,見 `RES_CREEP`)*/
  _creepResKey(lane) { return RES_CREEP + lane; }
  /** 預約鍵 → 兵線索引;不是合法的小兵強化鍵(含八軌鍵、原型鏈鍵名)一律回 null */
  _resCreepLane(item) {
    if (typeof item !== 'string' || !item.startsWith(RES_CREEP)) return null;
    const li = Number(item.slice(RES_CREEP.length));
    return Number.isInteger(li) && li >= 0 && li < (this.creepUpg?.[this.side]?.length || 0) ? li : null;
  }

  /**
   * 「現在買得起、最便宜」的那一軌(掃貨挑選 + 掃貨鈕的可用狀態**共用這一支**)。
   * 兩處各寫一次判定 = 鈕面說買得起、按下去卻沒動作(或反過來),而畫面上看不出哪一邊錯。
   * 便宜優先:階梯單價 `price(lvl)` 隨等級遞增 ⇒ 貪心地先買便宜的,同一筆錢換到最多階。
   */
  _sweepPick() {
    let pick = null, best = Infinity;
    for (const [id, up] of Object.entries(ECON.UPGRADES)) {
      const lvl = this.upg[id] || 0;
      // 兩道閘一起看(錢 + 戰鬥分數)—— 與鈕面、伺服器 sim.buy 同一支 `canUpgrade`
      if (!canUpgrade(up, lvl, this.money, this.kn)) continue;
      const price = upgradePrice(up, lvl);
      if (price >= best) continue;
      pick = id; best = price;
    }
    return pick;
  }

  /**
   * **掃貨**(2026-08-02 使用者需求「商店加入掃貨與預約選項」):把現在買得起的升級一次買到底 ——
   * 每一輪挑 `_sweepPick()` 那一軌下單,直到一項都買不起為止。
   * **只掃八軌**:陣營小兵強化是同陣營共用的無底金錢去化(刻意不做樂觀更新,等級由快照校正),
   * 掃進去 = 迴圈條件永遠成立 = 一次掃光全部身家 ⇒ MUST NOT 併入。
   *(預約則收 —— 那是一次一階的排程,見 `_toggleReserve`。)
   * 每一筆都走 `_optimisticBuy` ⇒ 伺服器逐筆複驗(客戶端只是替玩家連按了很多次,不涉 A1)。
   */
  _sweepBuy() {
    if (!this.side) return 0;
    // 迴圈邊界 = 八軌總階數(推導不手寫)。單價 > 0 ⇒ 每買一筆餘額必減,本來就會停;
    // 這道上限只是「萬一有人把單價調成 0」的防呆,MUST NOT 拿它當節流。
    const cap = Object.values(ECON.UPGRADES).reduce((s, u) => s + u.max, 0);
    let n = 0;
    for (; n < cap; n++) {
      const pick = this._sweepPick();
      if (!pick) break;
      this._optimisticBuy(pick);
    }
    this.hud.feed?.(n ? `🛒 掃貨:一次購入 ${n} 階升級` : '🛒 掃貨:目前沒有買得起的升級');
    return n;
  }

  /**
   * **預約**(同上需求):把某一軌掛進候補名單,**錢一夠就自動下單**(商店關著也生效 —— 那正是預約)。
   * 純客戶端排程 = 替玩家按下那顆按鈕,權威仍由伺服器逐筆複驗 ⇒ 不涉 A1。
   * 名單收**八軌 + 陣營小兵強化**(2026-08-02 使用者定案「商店的預約包含兵線升級」)——
   * 掃貨仍只作用於八軌:那是「一次買到底」的迴圈,而小兵強化沒有上限也沒有樂觀扣款,
   * 掃進去等於把全部身家一次倒進兵線(見 `_sweepBuy`)。預約是**一次一階**,不吃這個坑。
   */
  _toggleReserve(item) {
    if (item !== 'super' && !Object.hasOwn(ECON.UPGRADES, item) && this._resCreepLane(item) == null) return;
    if (this._reserve.has(item)) this._reserve.delete(item);
    else this._reserve.add(item);
    if (this.shopOpen) { this._shopSig = null; this.hud.shop?.(true, this._shopState()); }
  }

  /** 每份快照跑一次:預約名單依**加入順序**逐項檢查,買得起就下單;滿級即退出名單(留著是死預約)*/
  _tickReserve() {
    if (!this.side || !this._reserve.size) return;
    const now = performance.now() / 1000;
    // 本輪已下單但**尚未**從 `this.money` 扣掉的金額(只有小兵強化會累加,理由見下)。
    let pend = 0;
    for (const item of [...this._reserve]) {
      // 超級升級預約(超級大戰自動購買):固定 $200 一階,樂觀扣款 ⇒ 不記 pend(同八軌)
      if (item === 'super') {
        if (!isSuperSide(this.side)) { this._reserve.delete(item); continue; }
        const slvl = this.upg.super || 0;
        if (slvl >= SUPER_UPG.MAX) { this._reserve.delete(item); continue; }
        if (this.money < SUPER_UPG.PRICE) continue;
        const sent = this._resSent[item];
        if (sent && sent.lvl === slvl && now - sent.t < RESERVE_RESEND_S) continue;
        this._resSent[item] = { lvl: slvl, t: now };
        if (this._optimisticBuySuper()) this.hud.feed?.(`📌 預約成交:超級升級 LV${slvl + 1}`);
        continue;
      }
      const lane = this._resCreepLane(item);
      const up = lane == null ? ECON.UPGRADES[item] : null;
      const lvl = lane == null ? (this.upg[item] || 0) : (this.creepUpg?.[this.side]?.[lane] || 0);
      const max = lane == null ? up.max : CREEP_UPG.MAX;
      const price = lane == null ? upgradePrice(up, lvl) : CREEP_UPG.PRICE;
      if (lvl >= max) { this._reserve.delete(item); continue; }
      // 八軌未滿:伺服器根本不受理小兵強化 ⇒ 靜靜等著(門檻與 `_shopState().allMax` 同一份)
      if (lane != null && !this._upgAllMax()) continue;
      // 八軌的戰鬥分數門檻同樣是「送出去會不會被拒」的一部分(與 `_sweepPick` 同一支 canUpgrade)
      if (lane == null && !canUpgrade(up, lvl, this.money - pend, this.kn)) continue;
      if (this.money - pend < price) continue;
      // **同一階只送一次**:樂觀更新會被下一份快照的權威值校正回去,而那份快照可能比伺服器處理
      // 這筆購買還早到(RTT > 125ms 就會發生)⇒ 沒有這道閘就會對同一階重複下單,第二筆被拒
      // 而玩家只看到一句莫名其妙的「資金不足」。逾時 `RESERVE_RESEND_S` 後放行重送 ——
      // 萬一真的被拒(例如同隊共用資金被別人先花掉),這一軌才不會永久卡死(降級不例外)。
      const sent = this._resSent[item];
      if (sent && sent.lvl === lvl && now - sent.t < RESERVE_RESEND_S) continue;
      this._resSent[item] = { lvl, t: now };
      if (lane == null) {
        this._optimisticBuy(item);
        this.hud.feed?.(`📌 預約成交:${up.name}`);
        if ((this.upg[item] || 0) >= up.max) this._reserve.delete(item);
        continue;
      }
      // 小兵強化是**同陣營共用**的等級,刻意不做樂觀更新(別人同時買會顯示錯位,交給快照校正)
      // ⇒ 這一輪的餘額不會自己變少。沒有 `pend` 記帳的話,同一份快照裡三條兵線都看到同一筆錢
      // 而全數下單,後兩筆被伺服器拒 = 玩家看到假的「資金不足」。
      pend += price;
      this.net.send({ t: 'buy', item: 'creep', lane });
      this.hud.feed?.(`📌 預約成交:第 ${lane + 1} 兵線小兵強化`);
    }
  }

  /**
   * 商店購買:樂觀本地更新(立即扣款/升級 → UI 馬上回饋)+ 送伺服器(權威)。
   * 伺服器拒絕會回 error toast,下一份快照把 money/upg 校正回權威值(僅顯示層,不動 abil —— 讓
   * 快照的 _setChar 重算武器/招式)。修「點了要等一下才生效」的延遲感。
   */
  _optimisticBuy(item) {
    const applied = (() => {
      const up = Object.hasOwn(ECON.UPGRADES, item) ? ECON.UPGRADES[item] : null;
      if (!up) return false;
      const lvl = this.upg[item] || 0;
      if (!canUpgrade(up, lvl, this.money, this.kn)) return false;
      this.money -= upgradePrice(up, lvl); this.upg[item] = lvl + 1;
      // 戰鬥面向:同步樂觀推進 abil 階(權威快照會校正);光/重武器另重算武器數值
      if (up.abil) {
        this.abil[up.abil] = 1 + this.upg[item];
        if (up.abil === 'light' || up.abil === 'heavy') this._setChar(this.ch, true);
      }
      return true;
    })();
    if (applied && this.shopOpen) { this._shopSig = null; this.hud.shop?.(true, this._shopState()); }
    this.net.send({ t: 'buy', item });
  }

  /**
   * 超級升級購買:樂觀本地更新(扣款/升階/重算武器 → UI 馬上回饋)+ 送伺服器(權威 _buySuperUpg)。
   * 伺服器拒絕回 error toast,下一份快照把 money/upg/abil 校正回權威值(與八軌同機制)。
   */
  _optimisticBuySuper() {
    if (!isSuperSide(this.side)) return false;
    const lvl = this.upg.super || 0;
    if (lvl >= SUPER_UPG.MAX || this.money < SUPER_UPG.PRICE) return false;
    this.money -= SUPER_UPG.PRICE;
    this.upg.super = lvl + 1;
    const combat = superCombatLvl(lvl + 1);
    let changed = false;
    for (const s of ['light', 'heavy', 'def', 'atk']) {
      if (this.abil[s] !== combat) { this.abil[s] = combat; changed = true; }
    }
    if (changed) this._setChar(this.ch, true);
    if (this.shopOpen) { this._shopSig = null; this.hud.shop?.(true, this._shopState()); }
    this.net.send({ t: 'buy', item: 'super' });
    return true;
  }

  _toggleShop(force) {
    if (!this.side) return;   // 死亡不擋:重生等待也能購買
    const want = force != null ? force : !this.shopOpen;
    if (want === this.shopOpen) return;
    this.shopOpen = want;
    this._shopSig = null;   // 重置商店重繪簽章(見 _applySnap 的 gate)
    this.firing = false;
    this.hud.shop?.(want, want ? this._shopState() : null);
    if (want) document.exitPointerLock?.();
  }

  /**
   * 超級重生點(客戶端呈現用;權威在伺服器 _superSpawnPoint):
   * 不可在雙陣營兵線/砲塔/主堡射程的 125% 以內,每次陣亡重生地都隨機不同。
   * 座標全為 three 系(與 _spawnAt 同)。
   */
  _superSpawnAt() {
    const clearDist = (UNITS.tower?.range || 155) * 1.25;
    const baseClearDist = Math.max(UNITS.base?.range || 0, UNITS.base?.guns?.range || 0, UNITS.tower?.range || 155) * 1.25;
    const half = Math.max(200, (this.cfg.sizeM || 1200) / 2 - 40);
    const guns = [];
    for (const s of ['SWARM', 'STEEL']) {
      const b = this.cfg.bases?.[s];
      if (b) {
        const [bx, bz] = llToWorld(b[0], b[1], this.center);
        guns.push({ x: bx, z: bz, isBase: true });
      }
    }
    for (const ent of this.ents?.values?.() || []) {
      if ((ent.kind === 'tower' || ent.kind === 'base') && (ent.hp > 0 || ent.hp == null)) {
        const gx = ent.tgt ? ent.tgt.x : ent.mesh?.position?.x;
        const gz = ent.tgt ? ent.tgt.z : ent.mesh?.position?.z;
        if (gx != null && gz != null) guns.push({ x: gx, z: gz, isBase: ent.kind === 'base' });
      }
    }
    const worldLanes = [];
    for (const L of (this.cfg.lanes || [])) {
      if (L?.length) worldLanes.push(L.map(([lat, lng]) => llToWorld(lat, lng, this.center)));
    }
    const distToLanes = (x, z) => {
      let best = Infinity;
      for (const pts of worldLanes) {
        for (let i = 1; i < pts.length; i++) {
          const [ax, az] = pts[i - 1], [bx, bz] = pts[i];
          const dx = bx - ax, dz = bz - az;
          const len2 = dx * dx + dz * dz || 1;
          const t = Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / len2));
          const d = Math.hypot(x - (ax + dx * t), z - (az + dz * t));
          if (d < best) best = d;
        }
      }
      return best;
    };
    const mines = [...(this.mineMeshes?.values?.() || [])].map((m) => [m.position.x, m.position.z]);
    const candidates = [];
    let best = null, bestScore = -Infinity;
    for (let k = 0; k < 240; k++) {
      const x = (Math.random() * 2 - 1) * half, z = (Math.random() * 2 - 1) * half;
      if (mines.length && mines.some(([mx, mz]) => Math.hypot(x - mx, z - mz) < 25)) continue;
      const dl = worldLanes.length ? distToLanes(x, z) : Infinity;
      if (dl < clearDist) continue;
      let gunOk = true;
      let minGunD = Infinity;
      for (const g of guns) {
        const d = Math.hypot(x - g.x, z - g.z);
        if (d < minGunD) minGunD = d;
        if (d < (g.isBase ? baseClearDist : clearDist)) { gunOk = false; break; }
      }
      if (gunOk) {
        candidates.push([x, z]);
      } else {
        const score = Math.min(dl, minGunD);
        if (score > bestScore) { bestScore = score; best = [x, z]; }
      }
    }
    const last = this._lastSuperSpawn;
    let pick = null;
    if (candidates.length > 0) {
      if (last) {
        const cDiff = candidates.filter(([x, z]) => Math.hypot(x - last[0], z - last[1]) >= 80);
        if (cDiff.length > 0) pick = cDiff[Math.floor(Math.random() * cDiff.length)];
        else {
          pick = candidates.reduce((b, cur) => {
            const d = Math.hypot(cur[0] - last[0], cur[1] - last[1]);
            return d > b.d ? { pt: cur, d } : b;
          }, { pt: candidates[0], d: -1 }).pt;
        }
      } else {
        pick = candidates[Math.floor(Math.random() * candidates.length)];
      }
    }
    pick = pick || best || [0, 0];
    this._lastSuperSpawn = [pick[0], pick[1]];
    return pick;
  }

  /** 重生點所屬兵線的前進方向(three 系):權威落點是哪條兵線放的,就面向那條兵線;回傳 [dx, dz, li] */
  _laneDirAt(x, z) {
    const mySide = this.side || 'SWARM';
    const b = this.cfg.bases?.[mySide];
    if (!b) return null;
    const [bx, bz] = llToWorld(b[0], b[1], this.center);
    const vx = x - bx, vz = z - bz;
    let best = null, bs = Infinity;
    (this.cfg.lanes || []).forEach((L, li) => {
      const w = L.map(([lat, lng]) => llToWorld(lat, lng, this.center));
      if (w.length < 2) return;
      const seq = mySide === 'SWARM' ? w : w.slice().reverse();   // 從我方主堡端往敵方排序
      let dx = seq[1][0] - seq[0][0], dz = seq[1][1] - seq[0][1];
      const dl = Math.hypot(dx, dz) || 1; dx /= dl; dz /= dl;
      // 落點 = 主堡 + 該兵線方向×OFF + 側偏 ⇒ 所屬兵線的側向殘差最小、 forward 最接近 OFF
      const fwd = vx * dx + vz * dz, lat = Math.abs(vx * dz - vz * dx);
      const score = lat + Math.abs(fwd - GAME.HERO_SPAWN_OFF) * 0.1;
      if (score < bs) { bs = score; best = [dx, dz, li]; }
    });
    return best;
  }

  /** 所屬兵線下一據點塔位項 {frac,[side]}(與伺服器 towerSites[li] 同一解;劇情攻方看末組防守方) */
  _towerSiteW(li, side) {
    try {
      this._towerSitesW ??= solveTowerSites(
        (this.cfg.lanes || []).map((L) => L.map(([lat, lng]) => llToWorld(lat, lng, this.center))),
        mapArg(this.cfg));
    } catch { return null; }
    const sites = this._towerSitesW?.[li];
    if (sites?.[0]?.[side]) return { entry: sites[0], tSide: side };
    const def = this.cfg?.defSide;
    const front = sites?.[sites.length - 1];
    if (def && front?.[def]) return { entry: front, tSide: def };
    return null;
  }

  /** 出生/重生視線(three 系):由落點看向「主堡→下一據點」兵線的弧長中點(與伺服器 _spawnAimDir 同式);無塔位/中點在身後回退兵線前進方向 */
  _laneAimAt(x, z, li, ldx, ldz) {
    const fallback = () => [ldx, ldz];
    const mySide = this.side || 'SWARM';
    if (li == null) return fallback();
    const w = (this.cfg.lanes || [])[li]?.map(([lat, lng]) => llToWorld(lat, lng, this.center));
    if (!w || w.length < 2) return fallback();
    const tw = this._towerSiteW(li, mySide);
    if (!tw) return fallback();
    const cum = [0];
    for (let i = 1; i < w.length; i++) cum.push(cum[i - 1] + Math.hypot(w[i][0] - w[i - 1][0], w[i][1] - w[i - 1][1]));
    const total = cum[cum.length - 1];
    if (!(total > 0)) return fallback();
    // frac 量尺:SWARM 端為 0(見 solveTowerSites:site());換算成「我方端起算」再取半
    const dFromSwarm = tw.tSide === 'SWARM' ? total * tw.entry.frac : total * (1 - tw.entry.frac);
    const fromMine = mySide === 'SWARM' ? dFromSwarm : total - dFromSwarm;
    const dMid = mySide === 'SWARM' ? fromMine / 2 : total - fromMine / 2;
    const d = Math.max(0, Math.min(total, dMid));
    let i = 1;
    while (i < cum.length - 1 && cum[i] < d) i++;
    const f = (d - cum[i - 1]) / ((cum[i] - cum[i - 1]) || 1);
    const tx = w[i - 1][0] + (w[i][0] - w[i - 1][0]) * f, tz = w[i - 1][1] + (w[i][1] - w[i - 1][1]) * f;
    let mx = tx - x, mz = tz - z;
    const l = Math.hypot(mx, mz);
    if (!(l > 0)) return fallback();
    mx /= l; mz /= l;
    if (mx * ldx + mz * ldz <= 0.15) return fallback();
    return [mx, mz];
  }

  /** 主堡沿所屬兵線推出、緊貼兵線那一側,視線看向「主堡→下一據點中點」(兵線全線壓住視線中心,兵波在正前方) */
  _spawnAt() {
    if (isSuperSide(this.side)) {
      const [sx, sz] = this._superSpawnAt();
      this._lastSuperSpawn = [sx, sz];
      this._placeAt(sx, sz, -sx, -sz);   // 面向戰場中心
      return;
    }
    const mySide = this.side || 'SWARM';
    const other = mySide === 'SWARM' ? 'STEEL' : 'SWARM';
    const [bx, bz] = llToWorld(this.cfg.bases[mySide][0], this.cfg.bases[mySide][1], this.center);
    // 沿「主堡所在的那條兵線」推出生成點 + 視線看向「主堡→下一據點中點」(而非直線指向敵堡)。
    // 與伺服器 _spawnPoint 同式:由主堡中心沿首段直線推出(彎曲兵線的沿線取點會把落點推回堡內,
    // 兩端分家),終點吃 clampHeroSpawn 唯一縫:不與主堡重疊 + 平台上 + 治療環內。
    let sx, sz, dx, dz;
    let bestLane = null, bestLi = null, bd = Infinity;
    (this.cfg.lanes || []).forEach((L, li) => {
      const w = L.map(([lat, lng]) => llToWorld(lat, lng, this.center));
      if (w.length < 2) return;
      const seq = mySide === 'SWARM' ? w : w.slice().reverse();   // 從我方主堡端往敵方排序
      const d = Math.hypot(seq[0][0] - bx, seq[0][1] - bz);
      if (d < bd) { bd = d; bestLane = seq; bestLi = li; }
    });
    if (bestLane) {
      dx = bestLane[1][0] - bestLane[0][0]; dz = bestLane[1][1] - bestLane[0][1];
      const dl = Math.hypot(dx, dz) || 1; dx /= dl; dz /= dl;
      sx = bx + dx * GAME.HERO_SPAWN_OFF; sz = bz + dz * GAME.HERO_SPAWN_OFF;
    } else {
      const [ex, ez] = llToWorld(this.cfg.bases[other][0], this.cfg.bases[other][1], this.center);
      dx = ex - bx; dz = ez - bz; const len = Math.hypot(dx, dz) || 1; dx /= len; dz /= len;
      sx = bx + dx * GAME.HERO_SPAWN_OFF; sz = bz + dz * GAME.HERO_SPAWN_OFF;
    }
    // 橫向偏移到路旁緊貼兵線:落點在己方兵波之後,沿線已與波次生成點錯開,
    // 側偏只需偏出波次抖動帶即不與 NPC 撞到。符號是伺服器 _spawnPoint 的鏡射:
    // 伺服器框 z=北、客戶端框 z=南,同一個物理側在這裡是 (-dz,+dx)(寫成 (+dz,-dx)
    // 會落在兵線另一側,與權威落點差兩倍側偏 —— 彎曲兵線直接把兵線甩出視野)。
    // (垂直於兵線前進方向,不影響視線 yaw)
    const pl = Math.hypot(dx, dz) || 1;
    sx += (-dz / pl) * GAME.HERO_SPAWN_SIDE;
    sz += (dx / pl) * GAME.HERO_SPAWN_SIDE;
    [sx, sz] = clampHeroSpawn(bx, bz, sx, sz);
    // 視線:由落點看向「主堡→下一據點中點」(與伺服器 _spawnAimDir 同式)
    this._placeAt(sx, sz, ...this._laneAimAt(sx, sz, bestLi, dx, dz));
  }

  /** 落點安置(出生/重生共用尾段):貼地 + 面向行進方向 + 變形者歸零,超級與常規同吃這一支 */
  _placeAt(sx, sz, dx, dz) {
    const gy = this._surf(sx, sz, Infinity);
    // 無人機重生落在離地下限(FLIGHT.HOVER_M)貼地起飛,不直接放到巡航高度 —— 重生動力補滿
    // (見 _onSelfRespawn 的 this.lift = null)MUST 真的被拿來爬升,不然滿動力形同虛設。
    this.pos.set(sx, gy + (this.isDrone ? FLIGHT.HOVER_M : 0), sz);
    this.yaw = Math.atan2(-dx, -dz);   // 面向「主堡→下一據點」兵線(three:-z 前方)→ 兵線全線壓住視線中心
    this.bodyYaw = this.yaw;
    this.pitch = -0.05;
    this.roll = 0;
    // 變形者:重生一律地面型態
    // 蓄力/騰空狀態一律歸零(robot 蓄力中陣亡 → 重生殘留 charge 會立刻誤觸蓄力跳)
    this.charge = 0;
    this._lowG = false;
    if (this.isMorph) {
      this.flight = false;
      this.baseFov = UNITS.morph.fov;
    }
  }

  // ---------------- 變形者:型態切換(蓄力彈射 ↔ 觸地變形)----------------
  /** 地面型 → 飛行型:蓄力彈射(初速 ∝ 蓄力比例),FOV 拉廣;變形中段附無敵幀請求 */
  _morphLaunch(gy) {
    this.flight = true;
    this.vel.y = MORPH.JUMP_V * this.charge;
    this.vy = 0;
    this.pos.y = gy + 1.0;   // 抬離地表,避免下一幀立即觸發觸地變形
    this.charge = 0;
    this.baseFov = UNITS.morph.fovAir;
    this.trauma = Math.min(1, this.trauma + 0.4);
    this._reqIframe();
    shockRing(this.scene, this.effects, this.pos.x, gy, this.pos.z, 7, 0xffd27a);
    this.hud.feed?.('🛫 蓄力彈射:變形為飛行型態!(觸地變形回地面型)');
  }

  /** 飛行型 → 地面型:觸地變形;變形中段附無敵幀請求 */
  _morphLand(gy) {
    this.flight = false;
    this.pos.y = gy;
    this.vy = 0;
    this.vel.y = 0;
    this.baseFov = UNITS.morph.fov;
    this.trauma = Math.min(1, this.trauma + 0.3);
    this._reqIframe();
    shockRing(this.scene, this.effects, this.pos.x, gy, this.pos.z, 5, 0x9adfff);
    this.hud.feed?.('🦿 觸地變形:地面型態!(按住 Space 蓄力跳返回飛行)');
  }

  // ---------------- 機甲蓄力跳躍(2026-07-16;robot 限定,常數住 data.js CJUMP)----------------
  /** 垂直彈射 ∝ 蓄力 + 沿視線水平推進(距離 ∝ 機體速度);騰空低重力 = 太空漫步;起跳離地即請求無敵幀 */
  _chargeJump() {
    const k = this.charge;
    this.vy = CJUMP.V * k * this._modF('jump');
    this._lowG = true;
    const look = this.camera.getWorldDirection(new THREE.Vector3());
    look.y = 0;
    if (look.lengthSq() > 0) look.normalize();
    // 前向彈射初速 ∝ 機體速度 ⇒ 最大距離同比;× AIR_SPD_F = 蓄力跳水平移速加倍(唯一縫,騰空操縱同吃)
    const fwd = this._mobility(false) * this._modF('speed') * CJUMP.FWD_F * CJUMP.AIR_SPD_F * k;
    this.vel.x += look.x * fwd;
    this.vel.z += look.z * fwd;
    this.trauma = Math.min(1, this.trauma + 0.25);
    this._reqIframe();   // 起跳離地即 1s 無敵(伺服器驗 IFRAME.CD)
    shockRing(this.scene, this.effects, this.pos.x, this.pos.y, this.pos.z, 5, 0xbfe6ff);
    this.hud.feed?.('🦿 蓄力跳躍!(騰空低重力滑行)');
  }

  // ---------------- 無人機完美迴避(2026-07-21;drone 限定,常數住 data.js IFRAME)----------------
  /** 戰鬥中按空白鍵飛行:向上迴避衝刺 + 起飛離地當下請求 1s 無敵(伺服器驗 30s CD);本地 _dodgeCd 樂觀閘門 + HUD */
  _perfectDodge(u, now) {
    this._dodgeCd = now + IFRAME.DRONE_CD;   // 樂觀本地 CD(HUD + 客戶端閘門;伺服器 heroIframe 為權威後盾)
    this.vel.y += u.vspeed;                   // 向上迴避衝刺(疊在正常爬升上)
    this.trauma = Math.min(1, this.trauma + 0.3);
    this._reqIframe();
    shockRing(this.scene, this.effects, this.pos.x, this.pos.y, this.pos.z, 6, 0x8fd7ff);
    this.hud.feed?.('🛡️ 完美迴避!(向上飛・1s 無敵)');
  }

  // ---------------- 攀爬(長梯 / 攀岩抓點 / 垂降技術繩;2026-07-28)----------------
  // 路線規劃、抓握半徑、上下速度、登頂落腳點全部住 `climb.js`(唯一縫);這裡只做「輸入 → 狀態機」。
  // **地面機種專屬**:飛行型態自己飛得上去,掛上去只會變成一條慢速上升的軌道。
  //
  // 為什麼不需要在 `_collide` 開豁免:攀爬軸 MUST 落在碰撞體外 `CLIMB.OFF`(> 最大機體碰撞半徑),
  // 爬的過程機體本來就不與盒/柱重疊。登頂那一步是「同一幀把 y 設到頂面 + xz 踏進結構內側」——
  // 推擠與掃掠的垂直閘(`myBot >= b.y + b.h − 0.1`)天然跳過,MUST NOT 為此另加旗標判斷。

  /**
   * 攀爬狀態機。回傳 true = 本幀由攀爬接管移動(呼叫端跳過地面/飛行物理)。
   * 掛上條件:地面機種 + 抓握範圍內 + **推杆朝著路線**(不然沿街跑過梯腳就被黏住);
   * 上下 = 前後推杆(觸控搖桿同一條,MUST NOT 另開鈕 —— 見 A21/A22 的第二份輸入分支之戒)。
   */
  _stepClimb(dt, now, move, ax, u) {
    const T = this.terrain;
    if (!T.climbAt || this._flying() || this.dead) { this._climb = null; return false; }
    let r = this._climb;
    // 自癒守衛:被瞬移/重生/大幅擊退甩離路線時 MUST 自己脫手 —— 否則下一幀的水平吸附會把機體
    // 從半張地圖外拉回梯子上(狀態機的持有者是 pos,不是反過來)
    if (r && (Math.hypot(this.pos.x - r.x, this.pos.z - r.z) > CLIMB.GRAB_R * 2
      || this.pos.y < r.y0 - 2 || this.pos.y > r.y1 + 2)) { this._climb = null; r = null; }
    if (!r) {
      if (now < (this._climbOff || 0)) return false;          // 剛脫手:同一顆梯子不立刻重新黏上
      const cand = T.climbAt(this.pos.x, this.pos.z, this.pos.y);
      if (!cand) return false;
      // 意圖判定:推杆要有朝向攀爬軸的分量。地面端(往結構走)與頂端(走到屋頂邊緣)
      // 剛好是相反的兩個方向,故 MUST 用「指向軸」的向量而非法線 —— 用法線就會有一端永遠掛不上。
      const gx = cand.x - this.pos.x, gz = cand.z - this.pos.z;
      const gl = Math.hypot(gx, gz);
      // 已經站在軸上(方向向量退化)改看「前進推杆」= 上攀意圖 —— MUST NOT 無條件掛上:
      // 從梯底放手落地後若還按著後退,會在「掛上 → 立刻掉出底端」之間空轉,人黏在梯腳走不掉。
      if (gl > 1.2 ? (move.x * gx + move.z * gz) / gl <= 0.25 : ax.f <= 0.25) return false;
      r = this._climb = cand;
      this.charge = 0; this.vy = 0; this._lowG = false;
      this.hud.feed?.(`🧗 ${CLIMB_LABEL[r.kind]}:推前進上攀 / 後退下降,跳躍鍵脫手`);
    }
    // 脫手跳離:向外彈開 + 小跳(機甲的 Space 蓄力跳在攀爬中改作用為脫手,不留第二顆鍵)
    if (this.keys.Space) {
      this.vel.x += r.nx * CLIMB.KICK; this.vel.z += r.nz * CLIMB.KICK;
      this.vy = (u?.jump || 8) * 0.5;
      this._climb = null; this._climbOff = now + 0.5;
      return false;
    }
    // 垂直位移:前後推杆 × 攀爬速度 × 控場係數(麻痺 = 掛在原地不動,不是掉下去)
    this.pos.y += ax.f * CLIMB.SPD * this._ccMoveF() * this._modF('speed') * dt;
    // 水平吸附到攀爬軸(被爆風/後座推開後自己回到梯子上)
    const k = lerpFPS(10, dt);
    this.pos.x += (r.x - this.pos.x) * k;
    this.pos.z += (r.z - this.pos.z) * k;
    const fr6 = frictionFPS(6, dt);
    this.vel.x *= fr6; this.vel.z *= fr6; this.vel.y = 0;
    this.vy = 0;
    if (this.pos.y >= r.y1) {
      // 登頂:落腳點在結構內側(climb.js 已按該方向半徑夾制),高度取頂面 = surfaceAt 的 mount 台階
      this.pos.set(r.tx, r.y1, r.tz);
      this._climb = null; this._climbOff = now + 0.4;
      return false;
    }
    if (this.pos.y <= r.y0) {
      // 下端落地:回一般地面物理。落腳點是路線自帶的 `bx/bz` —— 一般路線 = 攀爬軸本身(原地),
      // **相鄰相接的那一條 = 較低那座結構的屋頂內側**(不然放手就從兩棟之間的縫掉到地面)。
      this.pos.set(r.bx, r.y0, r.bz);
      this._climb = null; this._climbOff = now + 0.35;
      return false;
    }
    this.roll += (0 - this.roll) * lerpFPS(6, dt);
    return true;
  }

  /** 請求無敵幀(蓄力跳 / 升空變形起跳離地 / 無人機完美迴避):時長與 CD 由伺服器 heroIframe 權威把關
   *  (機甲/變形機甲 15s、無人機 30s),這裡只做防連發節流 —— 被伺服器拒絕(CD 中)就什麼都不會發生。 */
  _reqIframe() {
    const now = performance.now() / 1000;
    if (now < (this._ifReqAt || 0) + 1.5) return;
    this._ifReqAt = now;
    this.net?.send({ t: 'iframe' });
  }

  // ---------------- 射擊(彈道學:初速 mv + 重力 9.81,射程上限)----------------
  /** 目前武器:平時 = 輕武器,右鍵切換瞄準 = 重武器(CD 型) */
  _curWeapon() {
    const id = this.aiming && this.wdef.heavy ? 'heavy' : 'light';
    return { id, def: this.wdef[id], st: this.wstate[id] };
  }

  /** 狙擊中重武器打空:保留冷卻,退出狙擊讓持續扳機接著走輕武器。 */
  _fallbackFromEmptyHeavy(id, st) {
    if (id === 'heavy' && this.aiming && st?.ammo <= 0) this._setAiming(false);
  }

  /**
   * 高度差空戰(客戶端):**逐目標**的射程乘數,與伺服器 `sim._altRange`/`_altDh` 逐條同構
   * (曲線走 `data.js altRangeF` 這個唯一縫)。
   *
   * 2026-08-01 使用者回報「攻擊範圍異常,沒有射程光暈的敵人也打得到」的客戶端那一半:
   * 舊制拿「基礎射程處**前方地表**」當目標高程近似,刻意寬鬆 —— 而伺服器量的是雙方視線點。
   * 兩端各寫一份近似 = 兩個數字,射程光暈(客戶端)與實際結算(伺服器)必然分家。現在改成
   * 同一條規則、同一組輸入:
   *   ・對方是英雄(兩端都拿得到絕對高程)⇒ 用**絕對**視線高程差(= 伺服器的 `ay` 差)。
   *   ・對方是小兵/塔/主堡(伺服器是無地形的 2D 平面,地基恆 0)⇒ 退回**離地**框:
   *     我方用回報給伺服器的同一個 `_altAG`,對方用 `sim._sightY` 的離地常數。
   * 兩端同框才有意義,細節與病灶見 `sim._altDh`。ent = null(打地面/沒解到目標)⇒ 1。
   */
  _altRangeTo(ent, def) {
    if (!this.side || this.dead) return 1;
    if (!ent) return 1;
    if (ent.hero) {
      // 絕對框:我方 ay 與回報伺服器的同一式(pos.y + _eyeH);對方取機體世界高 + 標準眼高
      return altRangeF((this.pos.y + this._eyeH()) - (ent.mesh.position.y + LOS.EYE_M), def);
    }
    // 離地框:對方的離地視線高照抄 sim._sightY(塔/主堡砲位高、飛行類眼高、其餘目標身高)
    const tgt = (ent.kind === 'tower' || ent.kind === 'base') ? LOS.TOWER_EYE_M
      : (ent.kind === 'heli' || ent.decoy || ent.kami || ent.hyper)
        ? (ent.heroY || 0) + LOS.EYE_M
        : (ent.heroY || 0) + LOS.TGT_M;
    return altRangeF(((this._altAG || 0) + LOS.EYE_M) - tgt, def);
  }

  /** 對某個目標的**有效射程**(公尺):射程光暈與擊發閘門吃的同一個數字(唯一縫)。 */
  _effRange(def, ent) {
    return (def?.range || 0) * this._altRangeTo(ent, def);
  }

  /**
   * 還沒解到目標時的**搜尋上限**:高度制空的機制上限(`altRangeMax`,與伺服器 `heroBurst`
   * 的 `impCap` 同一個誠實界)。只准用在「先找目標」的射線/索敵半徑;找到目標之後
   * MUST 以 `_effRange(def, ent)` 誠實夾回 —— 拿這個上限當射程 = 又一次兩端分家。
   */
  _maxRange(def) {
    return (def?.range || 0) * altRangeMax(def);
  }

  /** 磁軌蓄力狀態切換:廣播離散事件(比照 heroCast 的 'cast' 事件),
   *  讓其他玩家的畫面也能看到我方 rail 重武器的蓄力窗(戰術情報,非美術裝飾)。 */
  _setRailCharge(on) {
    if (!!this._railCharging === !!on) return;
    this._railCharging = on;
    this.net?.send({ t: 'heavyCharge', on });
  }

  /** 填彈:R 鍵手動 / 打空自動(重武器的「填彈」= CD);完成在 _tickWeapons 補滿 */
  _startReload(id) {
    const wid = id || this._curWeapon().id;
    const def = this.wdef[wid], st = this.wstate[wid];
    if (!def || !st || st.reloadEnd > 0 || st.ammo >= def.mag) return;
    st.ammo = 0;
    // 填彈/冷卻時長 = 武器階級解析後的 reload × 大雪氣候倍率(伺服器 _reloadT 同一條)
    const snowMul = this.env?.getWeatherDynamics?.()?.snowCdMul ?? 1;
    st.reloadDur = def.reload * snowMul;
    st.reloadEnd = performance.now() / 1000 + st.reloadDur;
    if (this.net) this.net.send({ t: 'reload', w: wid });
    this.hud.feed?.(wid === 'heavy' ? `⏳ ${def.name} 冷卻中…` : `🔄 ${def.name} 填彈中…`);
  }

  /**
   * 換彈夾動作(疊加在 gunGroup 上,無獨立手臂模型,用現有槍身/槍管代理呈現):
   * p 為填彈進度 0→1,依武器機構分類給不同動作曲線。
   */
  _reloadAnimOffset(def, p) {
    const swing = Math.sin(Math.min(1, Math.max(0, p)) * Math.PI); // 0→1→0,填彈完歸零
    if (def?.type === 'beam' || def?.type === 'rail') return { dz: swing * 0.4, dy: 0, rx: 0 };  // 能量/磁軌:整管後拉充能
    if (def?.type === 'launcher' || def?.type === 'missile' || def?.type === 'plasma')
      return { dz: 0, dy: 0, rx: -swing * 0.5 };   // 發射器/飛彈/電漿罐:上掀開膛裝填
    return { dz: 0, dy: -swing * 0.22, rx: swing * 0.12 };                     // 槍械:退彈匣再扣回
  }

  // (重武器掛點動畫已整併進 locomotion.js stepCombatFx —— _updateEnts 於 stepLocomotion 前呼叫)

  /** 第三人稱槍口世界座標:依 pid 找機體 rig.muzzles 錨(models.js 各 builder 登記),
   *  曳光/槍口爆從機體實際槍管射出,不再用射手 FPV 座標(機體越大偏差越大)。
   *  找不到錨(NPC/舊模型)、自己(FPV 已畫)一律退回訊息座標;三機小隊取離訊息座標
   *  最近那架(訊息只描述開火的那一架)。變形者飛行型 2026-07-17 起不再退回訊息座標 ——
   *  手持機種雙臂前伸、肩扛機種轉到背部,槍口錨在飛行中一樣朝航向(models.js 變形時窗)。 */
  _entMuzzle(pid, slot, fallback) {
    if (pid == null) return fallback;
    let best = null, bd = Infinity;
    for (const ent of this.ents.values()) {
      if (ent.pid !== pid || ent.isSelf) continue;
      const mz = ent.mesh?.userData?.rig?.muzzles?.[slot === 'heavy' ? 'heavy' : 'light'];
      if (!mz?.n || mz.fxOnly) continue;   // fxOnly = 只掛槍口焰的後向錨(蜂后螫針),曳光不從它出
      const d = ent.mesh.position.distanceToSquared(fallback);
      if (d < bd) { bd = d; best = mz.n; }
    }
    if (!best) return fallback;
    return best.getWorldPosition(new THREE.Vector3());
  }

  /** 開火事件 → 射手第三人稱機體的戰鬥動畫(後座/射姿保持;stepCombatFx 以 t0 邊緣觸發)。
   *  一個 pid 底下可能有三架(蜂群小隊)—— 全數標記,僚機齊射的視覺一致。
   *  重武器擊發同步標記 heavyFx(掛點反向過衝/槍口焰):bot 英雄沒有 heavyFire 訊息,
   *  只靠 shot 事件走到這裡,不標記就看不到重武器的擊發演出。 */
  _markFire(pid, slot, t0, aim) {
    if (pid == null) return;
    for (const ent of this.ents.values()) {
      if (ent.pid !== pid || ent.isSelf) continue;
      ent.fireFx = { t0, slot: slot === 'heavy' ? 'heavy' : 'light' };
      if (slot === 'heavy') ent.heavyFx = { phase: 'fire', t0 };
      // 交戰面向(2026-07-22 規則 1):記下攻擊目標 —— 靜止的 bot/僚機在 _updateEnts
      // 轉身面向它(槍口朝攻擊方向;移動中照舊面向移動方向)
      if (aim) ent._aimAt = { x: aim.x, z: aim.z, y: aim.y, until: t0 + 2.5 };
    }
  }

  /** NPC/建築的槍口世界座標(shot 事件):塔 = 砲塔砲口輪替、主堡 = 兩門大砲(ev.gi)、
   *  其餘 = rig.muzzles.light 錨;查無錨(舊模型/駐守碉堡隱藏)退回訊息座標 + 機體高度概略。 */
  _npcMuzzle(ent, ev, fx, fz) {
    if (ent && ent.mesh.visible) {
      const ms = ent.mesh.userData.turretMuzzles;
      if (ms?.length) {
        // 多槍口輪替擊發:塔(雙管/六管)、直升機(左右莢/側掛雙槍)與自律載具共用同一條
        ent._mzi = ((ent._mzi ?? -1) + 1) % ms.length;
        return ms[ent._mzi].getWorldPosition(new THREE.Vector3());
      }
      if (ent.mesh.userData.muzzle) {
        return ent.mesh.userData.muzzle.getWorldPosition(new THREE.Vector3());
      }
      if (ent.kind === 'base') {
        const mz = ent.gunMuzzles?.[ev.gi ?? 0];
        if (mz) return mz.getWorldPosition(new THREE.Vector3());
      } else {
        const mz = ent.mesh.userData.rig?.muzzles?.light;
        if (mz?.n) return mz.n.getWorldPosition(new THREE.Vector3());
      }
    }
    // 駐守碉堡的步槍兵(gar:機體隱藏在工事裡):曳光自「面向目標的射孔」射出,
    // 不再從碉堡中心上方憑空冒出(規則 3;碉堡射孔高度 ≈ 1.9m、八角主體外緣半徑 ≈ 3.0)
    if (ent?.gar && !ent.mesh.visible) {
      const dx = ev.to[0] - fx, dz = -ev.to[1] - fz;
      const d = Math.hypot(dx, dz) || 1;
      const gy0 = this.terrain.heightAt(fx, fz);
      return new THREE.Vector3(fx + dx / d * 3.0, gy0 + 1.9, fz + dz / d * 3.0);
    }
    const gy = this.terrain.heightAt(fx, fz);
    const oy = ev.oy ?? (ent ? (ent.mesh.position.y - gy) + ent.dimH * 0.6 : 2);
    return new THREE.Vector3(fx, gy + oy, fz);
  }

  /** Artillery presentation and barrel elevation share the existing ballistic solution. */
  _arcTracer(from, to, col, ent, kind = ent?.kind, wid = UNITS[kind]?.wid) {
    // 彈道學真解(2026-07-23):舊制用 h = 射距 × 0.22 畫弧 —— 那是一條與距離等比的裝飾曲線,
    // 不是彈道(使用者:「拋物線都固定線條」)。改與玩家榴彈共用 _lobVel:取**打得到的最低裝藥號數**
    // (真實榴彈砲選裝藥的作法),弧高與出膛仰角因此隨射距/高差改變。
    const dx = to.x - from.x, dz = to.z - from.z;
    const d = Math.hypot(dx, dz) || 1;
    const Z = BALLISTIC.LOB_CHARGE;
    let v0 = BALLISTIC.LAUNCH_MV;
    for (let k = Z.length - 1; k >= 0; k--) {   // 由最低號數往上找第一個有實數解的
      const v = BALLISTIC.LAUNCH_MV * Z[k];
      if (this._lobSolve(from, to, v).ok) { v0 = v; break; }
    }
    const vel = this._lobVel(from, to, v0);
    const T = d / Math.max(1e-3, Math.hypot(vel.x, vel.z));   // 飛抵目標的飛行時間
    unitShotFx(this.scene, this.effects, from, to, {
      kind, wid, color: col, velocity: vel, gravity: BALLISTIC.G, flight: T,
      clip: (a, b) => this._clipBeam(a, b),
    });
    const ang = Math.atan2(vel.y, Math.hypot(vel.x, vel.z));   // 出膛仰角 = 火控解的發射角
    const gp = ent?.mesh?.userData?.rig?.gunR;
    if (gp) gp.aim = (gp.comp || 0) - ang;
    else if (ent?.mesh?.userData?.turret?.userData?.pitch)
      ent._arcPitch = { v: ang, until: performance.now() / 1000 + 2.5 };
  }

  _tickWeapons(now) {
    for (const [id, st] of Object.entries(this.wstate)) {
      if (st.reloadEnd > 0 && now >= st.reloadEnd) {
        st.ammo = this.wdef[id]?.mag ?? st.ammo;
        st.reloadEnd = 0;
      }
    }
  }

  /**
   * 射線目標的**廣相過濾**(唯一縫:準星解析與彈道共用)。
   * 舊版把「所有可見敵方 mesh」整批丟進 `intersectObjects(…, true)` —— 每個 mesh 遞迴進數十個
   * 子件、每個子件再逐三角測試,而射線通常一個單位都沒碰到。這裡先用「線段到包圍球」的
   * 解析距離篩掉絕大多數,只把真正可能命中的 mesh 交給 raycaster 做精確判定
   * ⇒ **命中結果不變**(包圍球是保守外包),只是不再為不可能的目標付逐三角成本。
   */
  _rayCandidates(ro, rd, far, out) {
    out.length = 0;
    for (const ent of this.ents.values()) {
      if (ent.side === this.side || !ent.mesh.visible) continue;
      const scale = ent.bossSeg != null ? bossScaleF(ent.bossSeg) : 1;
      const c = ent.heroCol || BattleClient.COLLIDER[ent.kind] || (ent.colR ? { r: ent.colR, h: ent.colH || 6 } : null);
      const cr = (c ? c.r : 12) * scale, chh = (c ? c.h : 12) * 0.5 * scale;
      const p = ent.mesh.position;
      // 包圍球:圓心抬到機體中段,半徑含 1.3 倍餘裕(動畫/骨架外擴、飛行體 heroY 位移)
      const R = Math.hypot(cr, chh) * 1.3 + 2;
      const ex = p.x - ro.x, ey = p.y + chh - ro.y, ez = p.z - ro.z;
      let s = ex * rd.x + ey * rd.y + ez * rd.z;
      if (s < -R || s > far + R) continue;
      s = s < 0 ? 0 : s > far ? far : s;
      const dx = ex - rd.x * s, dy = ey - rd.y * s, dz = ez - rd.z * s;
      if (dx * dx + dy * dy + dz * dz > R * R) continue;
      out.push(ent.mesh);
    }
    for (const [mid, ms] of this.samMeshes) {
      const p = ms.mesh.position;
      const ex = p.x - ro.x, ey = p.y - ro.y, ez = p.z - ro.z;
      let s = ex * rd.x + ey * rd.y + ez * rd.z;
      if (s < -6 || s > far + 6) continue;
      s = s < 0 ? 0 : s > far ? far : s;
      const dx = ex - rd.x * s, dy = ey - rd.y * s, dz = ez - rd.z * s;
      if (dx * dx + dy * dy + dz * dz > 36) continue;
      ms.mesh.userData.missileId = mid;
      out.push(ms.mesh);
    }
    return out;
  }

  /**
   * 地形射線(唯一縫):走 `terrain.rayTerrain` 的解析網格行進,**不再**把 `terrain.mesh`
   * 丟進 raycaster。地形是 193² 高度場 = 73,728 個三角形,three 的 `Mesh.raycast` 每次都整批
   * 線性掃完(包圍球/盒對「射點在圖內」的射線一律通過,`far` 不參與剪枝)⇒ 每顆子彈每幀約
   * 1ms(桌機;手機 3~6 倍),飛行中的子彈一多就整幀卡死 —— 這是「開火更 lag、低功耗也 lag」
   * 的主因(純 CPU 成本,調像素比救不了)。解析版只測射線真的穿過的格,**同一組三角形、
   * 同一條 Möller–Trumbore ⇒ 命中點完全一致**(見 tools/audit_terrain_ray.mjs)。
   * @returns 命中距離(公尺)或 null
   */
  _terrainHitT(ro, rd, far) {
    const r = this.terrain.rayTerrain?.(ro.x, ro.y, ro.z, rd.x, rd.y, rd.z, far);
    return r ? r.t : null;
  }

  /**
   * 準星射線命中解析:回傳 { point, ent, missileId }(共用:beam 直擊 / 招式落點)。
   * pierce = true(貫穿光束):單位不擋射線,只有地形/障礙才終止 —— 回報給伺服器的射線長
   * 才涵蓋整條圓柱(止於第一個目標的表面 = 連它自己的中心都在射線之外,見 sim._lanceHits)。
   */
  _resolveAim(far, pierce = false) {
    this.raycaster.setFromCamera(_ZERO2, this.camera);
    const ro = this.raycaster.ray.origin, rd = this.raycaster.ray.direction;
    const camDist = (this.viewMode === 'tps' && this.pos) ? ro.distanceTo(this.pos) : 0;
    const totalFar = far + camDist;
    this.raycaster.far = totalFar;
    // 只對單位/飛彈做 raycast(地貌植被是純視覺,不擋子彈也不吃效能);地形走解析高度場
    // (_terrainHitT);建物/神木/巨岩等「有物理碰撞的障礙」另以解析圓柱判定(_blockerHitT)——
    // 準星射線先撞到障礙 → 視同打在障礙上(看不到的單位就不能射擊/鎖定,beam/招式落點同樣被擋)。
    // 貫穿光束不吃單位 ⇒ 連逐三角 raycast 都不必付(A6 的效能紀律:能不掃就不掃)
    const targets = pierce ? _NO_HITS : this._rayCandidates(ro, rd, totalFar, this._rayBuf || (this._rayBuf = []));
    const hits = targets.length ? this.raycaster.intersectObjects(targets, true) : _NO_HITS;
    const rEnd = this.raycaster.ray.at(totalFar, new THREE.Vector3());
    const dBlock = this._obstHitT(ro.x, ro.y, ro.z, rEnd.x, rEnd.y, rEnd.z);
    const dTerr = this._terrainHitT(ro, rd, totalFar);
    // 地形/障礙都是解析距離:比它們更遠的單位命中一律不算(舊版靠 hits 已排序 + break 達成同效)
    let dStop = Math.min(dBlock ?? Infinity, dTerr ?? Infinity);
    if (dStop < camDist * 0.8) dStop = Infinity;   // 忽略相機與自機之間(身後)的地貌/障礙截斷
    for (const h of hits) {
      if (h.distance > dStop) break;
      if (!raySolid(h.object)) continue;   // 光暈/招牌等表現層子件不參與準星解析(唯一縫 `raySolid`)
      let o = h.object;
      while (o && !o.userData.kind && o.userData.missileId == null && o.parent) o = o.parent;
      if (o && o.userData.missileId != null) return { point: h.point, ent: null, missileId: o.userData.missileId };
      if (o && o.userData.kind) return { point: h.point, ent: this._entByMesh(o), missileId: null };
      return { point: h.point, ent: null, missileId: null };   // 無 kind 標記的目標:照舊當落點
    }
    if (dStop < Infinity) {
      return { point: this.raycaster.ray.at(dStop, new THREE.Vector3()),
        ent: dBlock != null && dBlock <= (dTerr ?? Infinity) ? this.mapBuildings?.get(this._hitBuildingKey) || null : null, missileId: null };
    }
    return { point: rEnd, ent: null, missileId: null };
  }

  /** mesh → ent 反查(舊版每次命中都 `[...this.ents.values()].find(…)` 重建整份陣列) */
  _entByMesh(mesh) {
    for (const en of this.ents.values()) if (en.mesh === mesh) return en;
    return undefined;
  }

  /**
   * 命中火光距離補償(純表現層):狙擊鏡交戰 150~300m,世界單位火光在 FOV 35 下只剩幾個像素,
   * 再被狙擊專屬景深(postfx DOF)糊掉 ⇒ 按鏡頭距離放大,維持視角大小可讀。
   * 60m 內恆 1(近戰外觀逐位元不動),封頂 4。只管大小,不讀寫傷害/命中。
   */
  _hitFxScale(p) {
    const d = this.camera ? this.camera.position.distanceTo(p) : 0;
    return Math.max(1, Math.min(4, d / 60));
  }

  /**
   * 受擊端世界火光唯一縫(快照 hp/sp 掉血那一拍,全員可見):
   * 無護盾 → 火光濺射(雙層星爆 + 火星 + 單縷灰煙;塔/主堡放大一號);
   * 舉盾接住 → 小火光,不撒煙(護盾閃光由呼叫端另觸發)。
   * 純表現層;位置取機體當下渲染座標,不讀寫權威狀態。
   */
  _victimHitFx(ent, shielded) {
    const m = ent?.mesh?.position;
    if (!m) return;
    const y = m.y + (ent.dimH || 4) * 0.5;
    const _k = this._hitFxScale(m);   // 狙擊距離補償(近戰恆 1,不動舊外觀)
    if (shielded) {
      starburst(this.scene, this.effects, m.x, y, m.z, 1.2 * _k, 0xbfdcff);
      return;
    }
    // 與低血量燃燒(makeDamageFx:常駐火舌 + 上升煙柱 + 裂痕)的區隔:受擊是「爆」——
    // 白熱核心 + 貼地快擴衝擊環 + 速散火星,全 <1s 即收;燃燒是「燒」——慢速常駐,不帶衝擊環。
    if (ent.kind === 'tower' || ent.kind === 'base') {
      const base = ent.kind === 'base';
      starburst(this.scene, this.effects, m.x, y, m.z, (base ? 9 : 7) * _k, 0xfff3d0);
      starburst(this.scene, this.effects, m.x, y, m.z, (base ? 12 : 9) * _k, 0xffb055);
      shockRing(this.scene, this.effects, m.x, m.y, m.z, (base ? 15 : 11) * Math.min(_k, 2), 0xffc98a);
      this._emberBurst(m.x, y, m.z, base ? 16 : 12, (base ? 8 : 6) * _k);
      this._crashSmoke(m.x, y + 1, m.z, (base ? 1.5 : 1.2) * Math.min(_k, 2));
      return;
    }
    starburst(this.scene, this.effects, m.x, y, m.z, 2.2 * _k, 0xfff3d0);
    starburst(this.scene, this.effects, m.x, y, m.z, 2.8 * _k, 0xffb055);
    this._emberBurst(m.x, y, m.z, 5, 2 * _k);
    this._crashSmoke(m.x, y + 1, m.z, 0.55 * Math.min(_k, 2));
  }

  /** 命中回饋:星爆 + 準星標記 + 本地估算傷害數字(伺服器仍是權威) */
  _hitFeedback(def, ent, point) {
    this.hud.hitmark?.();
    // 命中鎖定目標 → 該目標的鎖定光暈短暫閃爍(射程範圍提示回饋)
    if (ent && this._lockId === ent.id) this._flashLockGlow();
    // 護盾二分:舉盾接住 → 小火光 + 護盾劇烈發光(即時,不等 8Hz 快照);
    // 無護盾 → 火光濺射 + 火星(煙由受擊端快照那一拍補,逐發不撒煙避免洗版)。
    const _shielded = !!(ent && ent.hero && ent.df && (ent.sp || 0) > 0);
    const _k = this._hitFxScale(point);   // 狙擊距離補償(近戰恆 1)
    if (_shielded) {
      starburst(this.scene, this.effects, point.x, point.y, point.z, 1.2 * _k, 0xbfdcff);
      ent.shieldMesh?.userData.hit?.(1.8);
    } else if (ent) {
      starburst(this.scene, this.effects, point.x, point.y, point.z, 2.8 * _k, 0xffb055);
      this._emberBurst(point.x, point.y, point.z, 4, 1.6 * _k);
    } else {
      starburst(this.scene, this.effects, point.x, point.y, point.z, 2.6, 0xfff2b8);
    }
    if (ent) {
      // 無敵幀中的目標:伺服器 _damage 完全免傷 —— 跳灰字「-0」而非誤導性的滿額估算數字
      if ((ent.inv || 0) > 0) {
        damageNumber(this.scene, this.effects,
          _TMP_A.set(point.x, point.y + 1.2, point.z), 0, { text: '-0' });
        return;
      }
      const mult = vsMult(def, ent.kind);
      // 本地估算含距離物理衰減(伺服器結算同一條公式,HUD 數字才對得上;火力成長走武器品質階級)
      // + 護盾分軌拆分(shieldSplit 單一縫):反護盾武器打滿盾目標的數字本來就該比打空盾時高,
      //   估算不吃這一層的話,新原型的武器在 HUD 上會整場對不上帳。
      const raw = def.dmg * mult * dmgFalloff(def, this.pos.distanceTo(point));
      const sp = shieldSplit(def, raw, ent.sp || 0);
      const est = Math.round(sp.toSp + sp.toHp);
      damageNumber(this.scene, this.effects,
        _TMP_A.set(point.x, point.y + 1.2, point.z), est, { big: mult >= 1.5 });
    }
  }

  // ---------------- 直線貫穿(aoeClass 'line':beam / rail / gun 重武器;2026-07-23)----------------
  /**
   * 回報射線給伺服器 heroLance(唯一權威),回傳本地估算的貫穿目標(由近至遠)供 HUD 回饋。
   * 座標轉換:three z 南 → 模擬 z 北(取負);y 一律送「離站立表面高」(與 {t:'pos'} 的 _altAG 同源)。
   * oy 由呼叫端在**擊發當下**取樣後傳入 —— 動能彈飛行 0.1~0.4 秒才定案落點,拿當幀高度會漂。
   */
  _sendLance(from, to, def, oy = null) {
    const seg = to.clone().sub(from);
    const len = seg.length();
    if (len < 0.01) return [];
    const d = seg.clone().divideScalar(len);
    const y = oy != null ? oy : (this._altAG || 0) + (from.y - this.pos.y);
    const q = (v) => Math.round(v * 1000) / 1000;
    this.net?.send({
      t: 'lance',
      o: [Math.round(from.x * 10) / 10, Math.round(-from.z * 10) / 10, Math.round(y * 10) / 10],
      d: [q(d.x), q(-d.z), q(d.y)],
      len: Math.round(len * 10) / 10,
    });
    return this._lancePierced(from, to, lanceR(def), def);
  }

  /**
   * 射線圓柱內的敵方單位(純本地估算:傷害數字/命中標記;伺服器另有迷霧 + LOS 複驗)。
   * 幾何 MUST 與伺服器 sim._lanceHits 同構:半徑 = r + 目標自身水平量體 hitR(ent),
   * 軸距量到**線段**最近點(射線止於目標近側表面時,中心仍在線段外 —— 見該處註解),
   * 截面分區 + 逐區穿透截斷(lanceZones/lanceZonePen 單一縫;投影是各自的近似:
   * 客戶端扇區基底取自射向,伺服器取水平投影,兩端扇區劃分不逐位元相同 —— 名冊只看有無)。
   */
  _lancePierced(from, to, r, def = null) {
    const seg = to.clone().sub(from);
    const len = seg.length() || 1;
    const d = seg.clone().divideScalar(len);
    // 截面基底:與射向垂直的兩軸(分區用;幾乎垂直射線時換參考軸,免退化)
    // local Vector3 — called once per fire (not per-frame); audit sandbox
    // extracts this method via new Function() and has no module-level _TMP_*
    const up = Math.abs(d.y) > 0.99 ? new THREE.Vector3(1, 0, 0) : new THREE.Vector3(0, 1, 0);
    const e1 = new THREE.Vector3().crossVectors(d, up).normalize();
    const e2 = new THREE.Vector3().crossVectors(d, e1);
    const rel = new THREE.Vector3();
    const out = [];
    for (const ent of this.ents.values()) {
      if (ent.isSelf || ent.side === this.side || !ent.mesh.visible) continue;
      rel.copy(ent.mesh.position).sub(from);
      const s = rel.dot(d);
      const sc = s < 0 ? 0 : (s > len ? len : s);
      const hr = this._hitR(ent);
      const rr = r + hr;
      const dev = rel.addScaledVector(d, -sc).length();
      if (dev > rr) continue;
      // off = 偏心比例(與 sim._lanceHits 同構):估算數字套 offAxisFalloff 才與伺服器結算對得上
      const off = Math.min(1, dev / rr);
      const ex = rel.dot(e1), ez = rel.dot(e2);
      for (const zone of lanceZones(ex, ez, hr, r)) out.push({ ent, s, off, zone });
    }
    out.sort((a, b) => a.s - b.s || a.zone - b.zone);
    if (def) {
      const kept = [];
      const rem = [], shut = [], cnt = [];
      for (const k of out) {
        const z = k.zone;
        if (shut[z]) continue;
        if (rem[z] === undefined) rem[z] = lanceZonePen(def, z);
        rem[z] -= lancePenCost(k.ent);
        k.j = cnt[z] || 0; cnt[z] = k.j + 1;
        kept.push(k);
        if (rem[z] < 0) shut[z] = true;
      }
      const seenQ = new Map();   // 同一單位跨區多吃收斂(與 sim._lanceHits 同式):同 ent 第 2 個起的區 ×lanceRehitF
      for (const k of kept) {
        const n = seenQ.get(k.ent) || 0;
        seenQ.set(k.ent, n + 1);
        k.q = n;
      }
      return kept;
    }
    for (const k of out) k.j = 0;   // 無 def(舊呼叫端):不做穿透截斷,全按首個估算
    return out;
  }

  /** 單位水平量體(公尺):走 data.js hitR 單一真相縫(含 BOSS 階段體型縮放) */
  _hitR(ent) {
    return hitR(ent);
  }

  /** 貫穿命中回饋:各區首個全額,同區之後逐個 ×LANCE.DECAY,同一單位第 2 區起 ×lanceRehitF × 偏心遞減 offAxisFalloff(與伺服器 heroLance 同一條公式) */
  _lanceFeedback(def, hits, point) {
    if (!hits.length) { starburst(this.scene, this.effects, point.x, point.y, point.z, 1.4, 0xcfc4a8); return; }
    this.hud.hitmark?.();
    for (let i = 0; i < hits.length; i++) {
      const { ent, off, j, q } = hits[i];
      const p = ent.mesh.position;
      if (this._lockId === ent.id) this._flashLockGlow();
      // 護盾二分(同 _hitFeedback):舉盾接住 → 小火光 + 護盾劇烈發光;無護盾 → 火光濺射 + 火星。
      const _k = this._hitFxScale(p);   // 狙擊距離補償(近戰恆 1)
      if (ent.hero && ent.df && (ent.sp || 0) > 0) {
        starburst(this.scene, this.effects, p.x, p.y + 1.4, p.z, (i === 0 ? 1.4 : 1.0) * _k, 0xbfdcff);
        ent.shieldMesh?.userData.hit?.(1.8);
      } else {
        starburst(this.scene, this.effects, p.x, p.y + 1.4, p.z, (i === 0 ? 3.0 : 2.2) * _k, 0xffb055);
        this._emberBurst(p.x, p.y + 1.4, p.z, 4, 1.6 * _k);
      }
      // 無敵幀目標:同 _hitFeedback,跳灰字 -0(伺服器免傷)
      if ((ent.inv || 0) > 0) {
        damageNumber(this.scene, this.effects, _TMP_A.set(p.x, p.y + 1.2, p.z), 0, { text: '-0' });
        continue;
      }
      const mult = vsMult(def, ent.kind);
      const raw = def.dmg * mult * dmgFalloff(def, this.pos.distanceTo(p)) * offAxisFalloff(off || 0) * LANCE.DECAY ** (j || 0) * lanceRehitF(q || 0);
      const sp = shieldSplit(def, raw, ent.sp || 0);   // 護盾分軌(見 _hitFeedback 同註)
      const est = Math.round(sp.toSp + sp.toHp);
      damageNumber(this.scene, this.effects,
        _TMP_A.set(p.x, p.y + 1.2, p.z), est, { big: i === 0 && mult >= 1.5 });
    }
  }

  /**
   * 貫穿彈道演出(自機與他人共用):
   *   beam  → 鋼彈式光束(熾白內芯 + 外暈 + 行進能量環);
   *   rail/gun → 高速穿透通道(細亮曳光柱 + 兩端衝擊環 —— 空氣被撕開的彈道)。
   * 圓柱半徑一律取 lanceR(def) ⇒ **看到多粗就是打到多粗**,不是裝飾性放大 ——
   * 重砲傾洩窗的加粗也收在同一支(舊制只有這裡 ×1.5,伺服器沒跟上 = 看得到打不到)。
   */
  _lanceVisual(from, to, def, side) {
    const { col, hot } = this._shotCols(side);
    const r = lanceR(def);
    if (def.type === 'beam') {
      const bcol = CHARACTERS[def.ch]?.visual?.hue ?? (side === 'SWARM' ? 0xa8fff2 : 0xd2b8ff);
      gundamBeam(this.scene, this.effects, from, to, bcol,
        { r, ttl: 0.5, rings: 4, core: hot, def });
      shockRing(this.scene, this.effects, from.x, from.y, from.z, r * 1.15, bcol);
      return;
    }
    // 動能貫穿(rail/gun):外層通道**滿寬 = 判定半徑**(低透明度的破壞管道),內層是熾芯曳光。
    // 舊制外層只有 0.45r ⇒ 玩家看到的是一條細線,實際判定卻寬一倍多,兩邊對不上。
    beamLine(this.scene, this.effects, from, to, col, { ttl: 0.26, w: r, op: 0.28 });
    beamLine(this.scene, this.effects, from, to, hot, { ttl: 0.16, w: r * 0.16 });
    shockRing(this.scene, this.effects, from.x, from.y, from.z, r * 1.2, hot);
    starburst(this.scene, this.effects, to.x, to.y, to.z, r * 1.5, col);
  }

  /**
   * 雷射導引武器(trajClass 'guide')的第一人稱導引雷射:瞄準時自槍口射出一條指向準星目標的
   * 細雷射 + 落點十字環 —— 擊發瞬間把落點凍結為固定打擊點(見 _updateBullets 的 guide 分支),
   * 離架後不再隨準星/目標移動。
   * 逐幀更新故 **MUST NOT** 每幀重建幾何:單一持久 Mesh 以 position/scale/quaternion 驅動
   * (與 _arcGuide 的預配置緩衝同一條紀律)。
   */
  _updateGuideLaser() {
    const showable = this.side && !this.dead && !this.shopOpen && this.aiming;
    const { def } = showable ? this._curWeapon() : {};
    if (!showable || !def || trajClass(def) !== 'guide') {
      if (this._gLaser) this._gLaser.group.visible = false;
      return;
    }
    if (!this._gLaser) this._ensureGuideLaser();
    const g = this._gLaser;
    g.group.visible = true;
    this.camera.updateMatrixWorld();
    const dir = this.camera.getWorldDirection(_TMP_D);
    const from = this.viewMode === 'tps'
      ? this._selfMuzzle(null, this._maxRange(def), 'heavy')
      : this.gunGroup?.localToWorld(this._muzzle.clone()) || this.camera.position.clone();
    const { point } = this._resolveAim(this._maxRange(def));
    const seg = _TMP_E.copy(point).sub(from);
    const len = Math.max(0.5, seg.length());
    g.beam.position.copy(from).addScaledVector(seg, 0.5);
    g.beam.quaternion.setFromUnitVectors(_UP_Y, _TMP_F.copy(seg).normalize());
    g.beam.scale.set(1, len, 1);
    g.ring.position.copy(point).addScaledVector(dir, -0.4);
    g.ring.quaternion.setFromUnitVectors(_FWD_Z, dir);
    // 導引窗:最短距離(ARMING.guide.m)內彈體仍在軌跡修正期 —— 環變紅示警「太近,會打歪」
    const armed = len >= ARMING.guide.m;
    g.ring.material.color.setHex(armed ? 0xff5f4a : 0xffd24a);
    g.ring.scale.setScalar(armed ? 1 : 1.5 + 0.4 * Math.sin(performance.now() / 90));
  }

  _ensureGuideLaser() {
    if (this._gLaser) return;
    const group = new THREE.Group();
    group.userData.noOutline = true;
    const mat = (c, o) => new THREE.MeshBasicMaterial({ color: c, transparent: true, opacity: o, blending: THREE.AdditiveBlending, depthWrite: false });
    const beam = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 1, 5, 1, true), mat(0xff5f4a, 0.25));
    const ring = new THREE.Mesh(new THREE.RingGeometry(0.5, 0.72, 20), mat(0xff5f4a, 0.9));
    ring.material.side = THREE.DoubleSide;
    beam.userData.noOutline = ring.userData.noOutline = true;
    group.add(beam, ring);
    this.scene.add(group);
    this._gLaser = { group, beam, ring };
  }

  _selfMuzzle(dir, rng = 100, slot = 'light') {
    if (this.viewMode === 'tps') {
      const eyeH = this._eyeH();
      let muz = null;
      for (const ent of this.ents.values()) {
        if (!ent.isSelf) continue;
        const mz = ent.mesh?.userData?.rig?.muzzles?.[slot];
        if (mz?.n && !mz.fxOnly) { muz = mz.n.getWorldPosition(new THREE.Vector3()); break; }
      }
      const fwd = new THREE.Vector3(-Math.sin(this.bodyYaw), 0, -Math.cos(this.bodyYaw));
      muz ||= this.pos.clone().add(new THREE.Vector3(0, eyeH, 0)).addScaledVector(fwd, 1.2);
      if (dir) {
        const targetPoint = this.camera.position.clone().add(dir.clone().multiplyScalar(rng));
        dir.copy(targetPoint).sub(muz).normalize();
      }
      return muz;
    }
    return this.gunGroup
      ? this.gunGroup.localToWorld(this._muzzle.clone())
      : this.camera.position.clone().add(dir ? dir.clone().multiplyScalar(2) : new THREE.Vector3());
  }

  _isCasting(now = performance.now() / 1000) {
    if ((this.castLeft || 0) > 0) return true;
    if (this._castingUntil && now < this._castingUntil) return true;
    return false;
  }

  _tryFire(now) {
    if (!this.side || this.dead || this.shopOpen || !this.ch) return;
    const { id, def, st } = this._curWeapon();
    if (!def || !st) return;
    // 2026-08-01:舊巨砲的「窗內免彈夾/免射速閘 + 自動擊發」旁路隨機甲改招整組移除 ——
    // 重武器射擊路徑上不該再有任何跳過彈夾/電力/射速閘的分支(MUST NOT 復辟)。
    if (!this.firing) return;
    if (this._isCasting(now)) {
      if (now - (this._castWarnAt || 0) > 1.2) {
        this._castWarnAt = now;
        this.hud.feed?.('⏳ 招式詠唱前搖中，無法使用武器！');
      }
      return;
    }
    if (this.empLeft > 0) {
      if (now - (this._empWarnAt || 0) > 1.5) { this._empWarnAt = now; this.hud.feed?.('⚡ 武器離線(遭電磁癱瘓)!'); }
      return;
    }
    // 蓄力中切換武器(放開瞄準)= 取消磁軌蓄力
    if (this._railAt && def.type !== 'rail') { this._railAt = 0; this.flash?.scale.setScalar(1); this._setRailCharge(false); }
    if (now - (this.lastFireAt[id] || 0) < 1 / def.rate) return;
    const defRateMul = (this.defending && (this.sp || 0) > 0) ? 0.5 : 1;
    const effRate = def.rate * defRateMul;
    if (defRateMul < 1 && now - (this.lastFireAt[id] || 0) < 1 / effRate) return;
    const sandMul = this.env?.getWeatherDynamics?.()?.sandRateMul ?? 1;
    if (sandMul < 1 && now - (this.lastFireAt[id] || 0) < 1 / (effRate * sandMul)) return;
    this._fallbackFromEmptyHeavy(id, st);
    if (st.reloadEnd > 0) return;                       // 填彈 / 冷卻中
    if (st.ammo <= 0) { this._startReload(id); return; } // 打空自動填彈
    // 重武器擊發需電力(伺服器 _gateFire 權威;此為本地預測 + HUD 提示)
    const mpc = id === 'heavy' ? heavyMpCost(def) : 0;
    if (mpc > 0 && this.mp < mpc) {
      if (now - (this._mpWarnAt || 0) > 1.5) { this._mpWarnAt = now; this.hud.feed?.(`🔋 電力不足(【${def.name}】每發需 ${mpc} MP)`); }
      return;
    }

    const prof = def.recoil || {};
    // 連射回穩(中後座輕武器):連發 N 發後強制回穩,此間不能擊發(與換彈匣機制分離)
    if ((this._settleUntil[id] || 0) > now) return;
    // 高後座重武器:須先「停下 + 穩定」steady 秒才能擊發(狙擊 / 超電磁炮 / 導引飛彈)——
    // rail 用既有 charge 當穩定時間,其餘型別用 steady 計時器;移動中一律無法穩定。
    if (prof.steady > 0) {
      if (this._moveInput()) {
        if (this._railAt || this._steadyAt) { this._railAt = 0; this._steadyAt = 0; this._setRailCharge(false); this.flash?.scale.setScalar(1); }
        if (now - (this._steadyWarnAt || 0) > 1.2) { this._steadyWarnAt = now; this.hud.feed?.(`🎯【${def.name}】須停下穩定後才能擊發`); }
        return;
      }
      if (def.type !== 'rail') {   // 非磁軌的高後座重武器:停穩計時到滿才擊發
        if (!this._steadyAt) { this._steadyAt = now; this._setRailCharge(true); this.hud.feed?.(`🎯【${def.name}】穩定中…`); }
        const sp = (now - this._steadyAt) / prof.steady;
        this.flash.visible = true; this._flashTtl = 0.06;
        this.flash.scale.setScalar(0.4 + Math.min(1, sp) * 2.4);
        if (sp < 1) return;
        this._steadyAt = 0; this.flash.scale.setScalar(1); this._setRailCharge(false);
      }
    }

    // 磁軌炮:按住開火鍵蓄力 charge 秒,蓄滿才擊發;提前放開 = 取消(不耗彈,歸零見 _updateSelf)
    if (def.type === 'rail' && def.charge) {
      if (!this._railAt) { this._railAt = now; this.hud.feed?.(`⚡【${def.name}】蓄力中…`); this._setRailCharge(true); }
      const p = (now - this._railAt) / def.charge;
      this.flash.visible = true;           // 蓄力視覺:槍口電光隨進度增亮
      this._flashTtl = 0.06;
      this.flash.scale.setScalar(0.4 + Math.min(1, p) * 2.4);
      if (p < 1) return;
      this._railAt = 0;
      this.flash.scale.setScalar(1);
      this._setRailCharge(false);
    }
    this.lastFireAt[id] = now;
    this.audio?.fire(def, id, this.side);   // 自機開火音(真實 def → 精確音色;閘門全過才播)
    st.ammo--;
    if (mpc > 0) this.mp = Math.max(0, this.mp - mpc);   // 本地預測扣電;快照回寫校正
    // 連射回穩計數(中後座輕武器;扇形武器不吃 —— 慢射速本身就是節奏)。
    // 回穩短暫(settle 秒)且準星上踢自明,不下 HUD 提示以免連射時洗版。
    if (prof.burst && !def.fan) {
      // 計**發**不計**次扳機**:一次擊發現在等於 fireBurstN 發(見 _queueBurst),
      // 逐次 +1 會讓 prof.burst=4 的回穩窗變成 8 發才觸發一次(射速壓縮前是 4 發)。
      this._burstN[id] = (this._burstN[id] || 0) + fireBurstN(def);
      if (this._burstN[id] >= prof.burst) {
        this._burstN[id] = 0;
        this._settleUntil[id] = now + (prof.settle || 0.4);
      }
    }
    if (st.ammo <= 0) {
      this._startReload(id);
      this._fallbackFromEmptyHeavy(id, st);
    }
    // 重武器擊發:廣播離散事件,驅動第三人稱機體的掛點動畫(自己與他人皆可見)
    if (id === 'heavy') this.net?.send({ t: 'heavyFire' });

    // 這一發的有效射程(**唯一縫**:射程光暈 `_reachable` 吃的是同一個 `_effRange`)。
    const rMul = this._altRangeTo(this._aimTarget(this._maxRange(def)), def);
    const rng = def.range * rMul;

    // 槍口與射向(座艙槍管末端或 TPS 機體發射點,世界座標)
    this.camera.updateMatrixWorld();
    const dir = this.camera.getWorldDirection(this._fireDir || (this._fireDir = new THREE.Vector3()));
    const muzzle = this._selfMuzzle(dir, rng, id);

    // 後座力(依武器分級 def.recoil):視角上踢(準星上移)+ 偏擺 + 槍身後坐 + 鏡頭震動 + 位移擊退
    // 位移懲罰在 _updatePlayer 依 `_recoilMoveF()` 夾住(係數 ← 後座量);'back' 每發沿槍口反向擊退。
    const fly = this._flying();
    const airRecoil = fly ? (RECOIL.AIR_RECOIL_MUL ?? 1.5) : 1;          // 飛行時後座力更大(2026-09-01 使用者需求)
    const climb = (prof.climb ?? (id === 'heavy' ? 0.033 : 0.011)) * airRecoil; // 這一發的後座量(= 位移懲罰的尺)
    // 位移懲罰係數:MUST 排在下面 `recoil.p +=` **之前** —— 加完之後 `_recoiling()` 恆為真,
    // 「上一輪還沒結束就取較嚴者」會把這一發自己也算成上一輪,係數再也降不回來(單向棘輪)。
    // 取較嚴者的用意:重砲那一發的歸零 MUST NOT 被隨手切一把輕武器補一槍就提早解除。
    this._recoilMoveF0 = this._recoiling()
      ? Math.min(this._recoilMoveF0 ?? 1, recoilMoveF({ climb }))
      : recoilMoveF({ climb });
    this.recoil.p += climb;                                              // 準星上踢(開火停止後快速回穩)
    this.recoil.y += (Math.random() - 0.5) * 0.006 * (prof.kick ?? 1) * airRecoil;
    // 鏡頭震動:重砲擊發要有頓挫感(輕武器維持細碎抖動)
    this.trauma = Math.min(1, this.trauma + SHAKE.FIRE * (prof.kick ?? 1) * airRecoil
      * (id === 'heavy' ? SHAKE.HEAVY_F : 1));
    this.weaponKick = 1;
    this.flash.visible = true;
    this._flashTtl = 0.045;
    this._flashHeavy = id === 'heavy';   // 重武器槍口焰放大(FPV 明顯度)
    if (prof.back) this.vel.addScaledVector(dir, -prof.back * airRecoil);     // 擊退走 vel:空中後座推力加大

    // 連發演出:這一發若是 N 連發,補畫剩下 N−1 發(純視覺,不再回報命中 —— 見 _queueBurst)。
    // N = 1 時整段是 no-op ⇒ 重武器與慢速輕武器逐位元維持舊路徑。
    this._queueBurst(def, () => this._burstEchoSelf(def, id, prof));

    if (def.fan) {
      // 扇形武器(散彈 / 電漿):無彈道,命中由伺服器 heroPlasma 以「射向 + 夾角 + 射程」錐狀結算;
      // 本地畫扇形彈著(近距密、遠距散),slot 分輕(散彈)/ 重(電漿)。
      this._fanBlast(muzzle, dir, def, rng);
      // o = 槍口(與 lance 同一組座標約定:[x, −z, 離站立表面高])= **射程球心**。扇形吃誠實界
      // (無 RANGE_TOL 吸收兩端差),球心 MUST 與射程光暈 `_reachable` 的 from 是同一個點 ——
      // 少送這一欄,伺服器就退回機體中心量,槍口前伸的那一段變成「光暈亮著卻不掉血」的邊界帶。
      this.net.send({ t: 'plasma', dx: dir.x, dz: -dir.z, slot: id, dy: dir.y,   // three z 南 → 模擬 z 北
        o: [Math.round(muzzle.x * 10) / 10, Math.round(-muzzle.z * 10) / 10,
          Math.round(((this._altAG || 0) + (muzzle.y - this.pos.y)) * 10) / 10] });
      return;
    }

    if (def.type === 'beam' || def.type === 'rail') {
      // 定向能 / 電磁砲:光速/準光速直擊(trajClass 'line',無彈道下墜),仍受射程限制。
      // 貫穿光束/電磁彈(aoeClass 'line')的準星射線 MUST NOT 停在第一個單位身上(pierce)——
      // 停下來的話回報給伺服器的 len 只到「目標近側表面」,而目標中心在那之後 ⇒ 整發落空,
      // 更別說貫穿後排。與動能貫穿彈(_updateBullets 的 b.pierce)同一條規則:只有地形/障礙才終止。
      const pierce = aoeClass(def) === 'line';
      const { point, ent, missileId } = this._resolveAim(rng, pierce);   // 高度制空:逐目標有效射程(與射程光暈同一個數字)
      const col = def.type === 'beam'
        ? (this.side === 'SWARM' ? 0xa8fff2 : 0xd2b8ff)
        : this._shotCols(this.side).col;
      this.net.send({ t: 'tracer', from: [muzzle.x, muzzle.y, muzzle.z], to: [point.x, point.y, point.z], slot: id, hit: 1 });
      // 直線貫穿一發只過一次 _gateFire ⇒ 來襲飛彈的擊落併進 heroLance 的圓柱掃描,
      // 這裡 MUST NOT 另送 hitMissile(會重複扣彈藥/電力)。
      if (missileId != null && aoeClass(def) !== 'line') this.net.send({ t: 'hitMissile', id: missileId, w: id });
      if (aoeClass(def) === 'line') {
        // 重武器光束 / 電磁砲 = 圓柱貫穿(伺服器 heroLance 沿射線結算全部目標);演出見 _lanceVisual
        this._lanceVisual(muzzle, point, def, this.side);
        this._muzzleBurst(muzzle, true, this.side);
        const oy = (this._altAG || 0) + (muzzle.y - this.pos.y);
        this._lanceFeedback(def, this._sendLance(muzzle, point, def, oy), point);
        return;
      }
      // 輕武器光束 / 電磁砲:不屬重武器三分類 —— 維持單體直擊(heroHit)
      const hitEnt = ent || (missileId == null ? this._aimTarget(rng) : null);
      this._tracer(muzzle, point, col, 0.35);
      this._muzzleBurst(muzzle, false, this.side);
      starburst(this.scene, this.effects, point.x, point.y, point.z, 2.2, col);
      if (missileId != null) this._hitFeedback(def, null, point);
      else if (hitEnt && hitEnt.side !== this.side && !hitEnt.neutral && !hitEnt.dead) {
        this.net.send({ t: 'hit', id: hitEnt.id, w: id });
        this._hitFeedback(def, hitEnt, point);
      }
      return;
    }

    // 彈道學子彈:初速 mv(真實參數)+ 重力下墜;超出射程即失效(FPS/DOTA 射程上限)
    // launcher/missile 皆為 AoE 戰鬥部;missile 帶著發射瞬間的準星鎖定 → 飛行中自動追蹤
    // 彈體同源(2026-07-22):與第三人稱/展示台同一顆 projectileMesh(飛彈=彈體+尾翼+導引頭、
    // 火箭=外露彈頭、動能=曳光條);曳光色 = 第三人稱曳光束同色(_shotCols)
    const aoe = def.type === 'launcher' || def.type === 'missile';
    const pierce = aoeClass(def) === 'line';   // rail 電磁彈射 / gun 反器材砲重武器:圓柱貫穿(不停在第一個目標)
    // 拋物線武器:出膛向量取本幀火控解(_lobAim 已於擊發前定案)—— 不是沿準星直射
    const lobFc = trajClass(def) === 'lob' && this._lobFc?.on ? this._lobFc : null;
    const mesh = this._takeProjectile(def, id === 'heavy');
    this.scene.add(mesh);
    mesh.position.copy(muzzle);
    // 射後不理(trajClass 'fnf')的追蹤對象 = **擊發當下的準星解**(`_aimTarget`,與 `_tickLock`
    // 同一份實作)。三條紀律:
    //   ① 目標只認準星,**MUST NOT 拿 `this._lockId` 當來源**(2026-08-04 使用者回報「準星沒有
    //      照到目標時,彈體會往先前鎖定的敵人飛去」):`_lockId` 是伺服器複驗過的**上一個**鎖定,
    //      準星移開之後要等 `_tickLock` 下一次 4Hz 心跳才清得掉 ⇒ 那段空窗裡開火,彈體會繞過
    //      準星飛向一個玩家已經不再瞄的人。`_aimTarget` 本身在 `_coneAcquire` 裡已經拿 `_lockId`
    //      當**遲滯錨**(準星仍在同一個錐內才續留)—— 鎖定該有的黏著在那裡,不在這裡。
    //   ② 準星什麼都沒解到 ⇒ **不追蹤**(直飛),MUST NOT 退回任何舊目標。
    //   ③ 仍 MUST 用擊發當下的準星解而非等鎖定成立:鎖定要一趟伺服器往返(`_tickLock` 4Hz 送出
    //      → sim.heroLock 複驗 → lock 事件回來),甩準星立刻開火的那一發等不到。
    // 無導引的飛彈只吃重力直飛:離架散布(_armSpread)+ 滿射程 2 秒以上的墜距,實測全部落在
    // 爆風核心帶之外(tools/audit_weapon_gate.mjs Ⅵ)。導引對象是**表現層決策**(彈道本就客戶端
    // 權威),傷害仍由伺服器驗落點 —— 不涉 A1。
    const homing = def.type === 'missile' ? (this._aimTarget(rng)?.id ?? null) : null;
    const v0 = this._shotV0(def, !!this._aaAim);   // 對空彈射(_updateAaMode 於本幀擊發前定案,與瞄準虛線同一份)
    // 最短距離(軌跡修正期):導引/射後不理武器離架後 arm.m 內導引尚未接手,且帶一次性初期散布
    // ⇒ 貼臉開導引彈會偏(命中率較低),拉開距離後導引/追蹤才把偏差修回來。
    const arm = armingOf(def);
    const fdir = arm ? this._armSpread(dir, arm.spread) : dir;
    const launch = lobFc ? null : this._guidedLaunchVel(muzzle, fdir, def, v0);
    // 彈體記錄走池(向量常駐逐發覆寫,不 clone;mesh 由 _takeProjectile 另池)
    const b = this._recPool.acquire();
    b.slot = id; b.aoe = aoe; b.pierce = pierce; b.r = def.r || 0; b.core = blastCoreR(def);   // core:近炸引信半徑的爆風項(見 _updateBullets)
    b.pos.copy(muzzle);
    if (lobFc) b.vel.copy(lobFc.vel);
    else if (launch?.vel) b.vel.copy(launch.vel);
    else b.vel.copy(fdir).multiplyScalar(v0);
    // 射程球面 = 火控解夾制時用的**同一個**包絡(`lobFc.max`)—— 兩個數字差一格浮點數,
    // 夾好的落點就會落在球面外側 = 那一發變成不會爆的啞彈(見 _lobAim 的瞄準點夾制 ①)。
    b.max = lobFc ? lobFc.max : rng; b.mesh = mesh; b.origin.copy(muzzle);   // origin:射程球面/失鎖判定的球心(攻擊範圍);高度制空拉遠
    b.oy = (this._altAG || 0) + (muzzle.y - this.pos.y);   // 擊發當下的槍口離地高(貫穿回報用;落點定案時本機可能已位移)
    b.cyclone = null; b.cycAcc = 0; b.cycCol = this._shotCols(this.side).col;
    b.mv = v0; b.guide = !!def.guide;
    // 雷射導引(2026-09-28 使用者定案):與射後不理同為「發射瞬間凍結」—— 打擊點取擊發當下
    // 的準星解落點(`_resolveAim`,與導引雷射圓環同一點),離架後不再隨準星/目標移動。
    if (b.guide) b.guidePt.copy(this._resolveAim(rng).point);
    b.homing = homing; b.arm = arm ? arm.m : 0;
    b.launchDist = launch?.dist || 0;
    // 射後不理(2026-08-01 使用者定案):鎖定之後持續追擊,不受射程影響。
    // fnf 只是「這顆彈有沒有資格改吃燃料」的旗標;真正切換在 _updateBullets 的 b.chase。
    b.fnf = trajClass(def) === 'fnf'; b.fuel = chaseCapS(def); b.age = 0; b.chase = false;
    b.homePtSet = false; b.hx = 0; b.hy = 0; b.hz = 0; b.hr = 0;   // 射後不理最後已知點(目標離開快照後的追擊錨,見 _updateBullets)
    b.dud = false;   // 飛出射程球面 = 解除武裝(引爆 = 碰撞;見 _updateBullets)
    b.guided = false; b.type = null;
    mesh.quaternion.setFromUnitVectors(_FWD_Z, _TMP_D.copy(b.vel).normalize());
    this.bullets.push(b);
    if (def.type === 'missile') this.hud.feed?.(homing ? '🚀 飛彈離架:追蹤鎖定目標!' : '🚀 飛彈離架:未鎖定,直飛');
    else if (def.guide) this.hud.feed?.('🔦 雷射導引:打擊位置鎖定,發射後不再追蹤');
    // 自己 FPV 的槍口爆:重武器一律比輕武器大一號(輕武器已有 this.flash 球體,重武器再補世界爆閃)
    if (id === 'heavy') this._muzzleBurst(muzzle, true, this.side);
    // 其他客戶端的槍口視覺(對方不模擬我的彈道,給一條短曳光示意射向;帶 slot 讓對方分辨輕/重)。
    // 拋物線武器改送**火控瞄準點**:對方的 _spawnVisShell 以同一支 _lobVel 解算 ⇒ 兩端看到同一條弧
    // (送 60m 直線示意點會讓對方的彈體吊到我根本沒瞄的地方)。
    const to = lobFc
      ? [lobFc.aim.x, lobFc.aim.y, lobFc.aim.z]
      : [muzzle.x + dir.x * 60, muzzle.y + dir.y * 60, muzzle.z + dir.z * 60];
    this.net.send({
      t: 'tracer', from: [muzzle.x, muzzle.y, muzzle.z], to, slot: id,
      mv: lobFc ? Math.round(lobFc.v0) : undefined,   // 拋物線武器帶實際初速(裝藥號數),對方重現同一條弧
    });
  }

  /**
   * 自機 FPV 的連發補畫(第 2~N 發;第 1 發由 `_tryFire` 本體畫)。
   *
   * **不碰任何權威狀態**:不扣彈藥、不扣電力、不送 hit/tracer、不進 `this.bullets`
   * (那條路徑會回報命中 = 傷害翻倍 = A1)。動能/磁軌走 `_spawnVisShell` 的**純視覺**彈體
   * (同一個物件池,擊中/逾程照樣 `_dropBullet` 回收 —— A25),光束走 `_shotFx` 同一支曳光。
   *
   * **後座與震動刻意逐發補上**:兩者都是 `RECOIL`/`SHAKE` 註明的純客戶端手感,而且原本是
   * **逐發**累加的 —— 射速從 10 壓到 3.91 之後,只在扳機那一下加一次會讓每秒後座量與鏡頭
   * 震動一起掉到舊制的四成(手感無聲變輕,但沒有任何數字看得出來)。補回 N−1 份 ⇒ 每秒
   * 後座/震動/擊退量與壓縮前一致。準星上踢 `recoil.p` 同理(伺服器不涉入視角)。
   */
  _burstEchoSelf(def, id, prof) {
    if (!this.side || this.dead || !this.ch) return;
    const rng = def.range * this._altRangeTo(this._aimTarget(this._maxRange(def)), def);
    this.camera.updateMatrixWorld();
    const dir = this.camera.getWorldDirection(this._echoDir || (this._echoDir = new THREE.Vector3()));
    const muzzle = this._selfMuzzle(dir, rng, id);

    // 逐發手感(見上方註):槍口焰 / 槍身後坐 / 鏡頭震動 / 準星上踢 / 擊退
    const fly = this._flying();
    const airRecoil = fly ? (RECOIL.AIR_RECOIL_MUL ?? 1.5) : 1;
    this.flash.visible = true;
    this._flashTtl = 0.045;
    this._flashHeavy = false;               // 連發只發生在輕武器(重武器 N 恆為 1)
    this.weaponKick = 1;
    this.trauma = Math.min(1, this.trauma + SHAKE.FIRE * (prof.kick ?? 1) * airRecoil);
    this.recoil.p += (prof.climb ?? 0.011) * airRecoil;
    this.recoil.y += (Math.random() - 0.5) * 0.006 * (prof.kick ?? 1) * airRecoil;
    if (prof.back) this.vel.addScaledVector(dir, -prof.back * airRecoil);

    if (def.type === 'beam' || def.type === 'rail') {
      const col = def.type === 'beam'
        ? (this.side === 'SWARM' ? 0xa8fff2 : 0xd2b8ff)
        : this._shotCols(this.side).col;
      const { point } = this._resolveAim(rng, aoeClass(def) === 'line');
      this._tracer(muzzle, point, col, 0.35);
      this._muzzleBurst(muzzle, false, this.side);
      starburst(this.scene, this.effects, point.x, point.y, point.z, 2.2, col);
      return;
    }
    // 動能:與本體同初速同重力 ⇒ 三發走同一條彈道,看起來就是一串連續的曳光
    const to = (this._echoTo || (this._echoTo = new THREE.Vector3())).copy(muzzle).addScaledVector(dir, rng);
    this._spawnVisShell(muzzle, to, def, this.side, this.ch, this._shotV0(def, false), false);
  }

  // ---------------- 彈體物件池(2026-07-27)----------------
  /**
   * 自機彈體是**全遊戲配置最頻繁的 3D 物件**:一把 rate 8 的輕武器按住就是每秒 8 顆,
   * 而一顆 `projectileMesh('missile')` = Group(彈身/彈頭/兩片尾翼 + 描邊外殼 ×4 + 尾焰)
   * ≈ 9 個 mesh、9 份新幾何、9 份新材質。舊版擊中後只 `scene.remove` ⇒ 幾何/材質全數留在 GPU 上
   * (three 要 dispose 才釋放)⇒ 打越久顯存越脹、手機越卡。
   *
   * 彈體除了 position/quaternion 之外**沒有任何個體狀態**,因此可以整顆重複使用:
   * 以「武器型別 + 輕重 + 配色」為鍵分池,擊中即歸還。MUST NOT 在別處自行 `projectileMesh()`
   * 進 `this.bullets` —— 那條路徑不會回池,leak 就從那裡漏回來。
   */
  _takeProjectile(def, heavy, side = this.side, ch = this.ch) {
    const col = this._shotCols(side).col;
    const hue = CHARACTERS[ch]?.visual?.hue ?? 0xffd27a;
    const key = `${def?.ch || ''}|${def?.slot || ''}|${def?.type || 'gun'}|${heavy ? 1 : 0}|${col}|${hue}`;
    const pool = this._projPool || (this._projPool = new Map());
    const free = pool.get(key);
    if (free && free.length) {
      const m = free.pop();
      m.scale.set(1, 1, 1);
      m.visible = true;
      return m;
    }
    const m = projectileMesh(def, { col, hue, heavy });
    m.userData.poolKey = key;
    return m;
  }

  /** 彈體歸還(命中/逾程):自場景摘下,附掛的氣旋尾流獨立回收(那份是每發新建的) */
  _dropBullet(b) {
    const m = b.mesh;
    this.scene.remove(m);
    if (b.cyclone) { m.remove(b.cyclone); disposeTree(b.cyclone); b.cyclone = null; }
    const key = m.userData.poolKey;
    const pool = this._projPool;
    if (!key || !pool) { disposeTree(m); }
    else {
      const free = pool.get(key) || pool.set(key, []).get(key);
      // 池深上限:同型彈體同時在空中的數量有限,超量就真的釋放(避免換武器後留一堆殭屍)
      if (free.length < PROJ_POOL_MAX) free.push(m); else disposeTree(m);
    }
    // 彈體記錄本體回池(向量常駐,下發覆寫;mesh/cyclone 引用已在上段清空,見 _initFxPools)
    b.mesh = null;
    this._recPool?.release(b);
  }

  // ---------------- 高頻物件池(子彈記錄/曳光/粒子 sprite/特效殼)----------------
  /**
   * 子彈/曳光/粒子是**開火即配置**的熱路徑:輕武器 rate 8 按住就是每秒 8 發,
   * 每發舊制 = 彈體記錄物件 + 2~4 顆 Vector3 + 曳光(幾何 + 材質)+ 命中星爆/餘燼若干,
   * 加上每顆子彈每幀的 `clone()` 內插 —— 年輕代 GC 轉一圈就是一次掉幀(GC Spike)。
   * 本池預先分配並循環重用(A25 同一處置:超量溢出才走原 dispose,不漏):
   *   ・彈體記錄(`_recPool`):自機 bullets + 他人 _visShells + 拋擲 _decoyBombs 共用一種
   *     記錄,向量常駐逐發覆寫。`guide` 布林承接原 `guidePt=null` 語義(無導引不讀向量)。
   *   ・曳光(`_tracerPool`):2 點預分配 position + 獨立材質(透明度逐條動畫)。
   *   ・粒子 sprite(火/煙兩池):貼圖 + 混色固定(免切 map 重編 shader),顏色/透明度逐發寫。
   *   ・特效殼(`_fxShellPool`):{obj,ttl,fade,dispose,age} 殼本體;fade/dispose 皆共用函式
   *     引用(`_tracerFade`/`_spriteDriftFade`/`_spriteGravFade` + 各自 userData.releaseFx),
   *     逐發不配閉包。releaseFx 一生一條(隨池物件出生),讀當下 userData.shell 動態歸還。
   * MUST NOT 把 _TMP_* 存進任何池化記錄(暫存只准同同步區塊用完即丟,見上)。
   */
  _initFxPools() {
    const mkTracer = () => {
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(6), 3));
      const line = new THREE.Line(g, new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.9 }));
      line.frustumCulled = false;
      line.visible = false;
      line.userData.releaseFx = () => this._releaseFxLine(line);
      return line;
    };
    this._tracerPool = new Pool(mkTracer, { max: TRACER_POOL_MAX });
    const mkSprite = (fire) => () => {
      const sp = new THREE.Sprite(new THREE.SpriteMaterial({
        map: fire ? this._fireTex() : this._smokeTex(),
        color: 0xffffff, transparent: true, opacity: 1, depthWrite: false,
        blending: fire ? THREE.AdditiveBlending : THREE.NormalBlending,
      }));
      sp.userData.noOutline = true;
      sp.userData.fire = fire;
      sp.userData.vel = new THREE.Vector3();
      sp.userData.releaseFx = () => this._releaseFxSprite(sp);
      sp.visible = false;
      return sp;
    };
    this._spritePoolFire = new Pool(mkSprite(true), { max: SPRITE_POOL_MAX });
    this._spritePoolSmoke = new Pool(mkSprite(false), { max: SPRITE_POOL_MAX });
    const mkRec = () => ({
      slot: null, aoe: false, pierce: false, r: 0, core: 0,
      pos: new THREE.Vector3(), vel: new THREE.Vector3(), origin: new THREE.Vector3(),
      guidePt: new THREE.Vector3(), target: new THREE.Vector3(), spin: new THREE.Vector3(),
      max: 0, mesh: null, oy: 0, cyclone: null, cycAcc: 0, cycCol: 0, cycPh: 0,
      mv: 0, guide: false, homing: null, arm: 0, launchDist: 0, guided: false,
      fnf: false, fuel: 0, age: 0, chase: false, dud: false,
      type: null, col: 0, gy: 0, trailAcc: 0,
    });
    this._recPool = new Pool(mkRec, { max: BULLET_REC_MAX,
      reset: (b) => {
        b.mesh = null; b.cyclone = null; b.homing = null;
        b.age = 0; b.chase = false; b.dud = false;
        b.guide = false; b.guided = false; b.trailAcc = 0; b.cycAcc = 0; b.cycPh = 0;
      } });
    this._fxShellPool = new Pool(() => ({ obj: null, ttl: 0, fade: null, dispose: null, age: 0 }),
      { max: FX_SHELL_MAX,
        reset: (e) => { e.obj = null; e.ttl = 0; e.fade = null; e.dispose = null; e.age = 0; } });
    // 開場預熱(避開首發卡頓;只填空閒棧,不進場景)
    this._tracerPool.prewarm(16);
    this._spritePoolFire.prewarm(24);
    this._spritePoolSmoke.prewarm(12);
    this._recPool.prewarm(16);
    this._fxShellPool.prewarm(32);
  }

  /** 池化曳光殼:呼叫端只給端點/色/壽命,本體(線 + 殼)全重用,不配閉包。 */
  _pushTracerFx(line, ttl) {
    const sh = this._fxShellPool.acquire();
    sh.obj = line; sh.ttl = ttl; sh.fade = _tracerFade; sh.dispose = line.userData.releaseFx; sh.age = 0;
    line.userData.shell = sh;
    this.effects.push(sh);
  }

  /** 池化曳光線歸還(特效殼 dispose 唯一入口;重入保護:殼已取走即 no-op)。 */
  _releaseFxLine(line) {
    const sh = line.userData.shell;
    if (!sh) return;
    line.userData.shell = null;
    line.visible = false;
    this.scene.remove(line);
    if (!this._tracerPool.release(line)) { line.geometry.dispose(); line.material.dispose(); }
    this._fxShellPool.release(sh);
  }

  /** 池化粒子 sprite 取用(火/煙兩池;顏色/透明度/尺寸逐發覆寫)。 */
  _takeSprite(fire, x, y, z, scale, color, op) {
    const sp = (fire ? this._spritePoolFire : this._spritePoolSmoke).acquire();
    sp.position.set(x, y, z);
    sp.scale.setScalar(scale);
    sp.material.color.setHex(color);
    sp.material.opacity = op;
    sp.userData.delay = 0;
    sp.visible = true;
    this.scene.add(sp);
    return sp;
  }

  /** 池化 sprite 特效殼:fade 為共用函式引用,dispose 為 sprite 自帶 releaseFx(不配閉包)。 */
  _pushSpriteFx(sp, ttl, fade) {
    const sh = this._fxShellPool.acquire();
    sh.obj = sp; sh.ttl = ttl; sh.fade = fade; sh.dispose = sp.userData.releaseFx; sh.age = 0;
    sp.userData.shell = sh;
    this.effects.push(sh);
  }

  /** 池化 sprite 歸還(特效殼 dispose 唯一入口;超量才真釋材質,幾何是 three 全域共用不動)。 */
  _releaseFxSprite(sp) {
    const sh = sp.userData.shell;
    if (!sh) return;
    sp.userData.shell = null;
    sp.visible = false;
    this.scene.remove(sp);
    const pool = sp.userData.fire ? this._spritePoolFire : this._spritePoolSmoke;
    if (!pool.release(sp)) sp.material.dispose();
    this._fxShellPool.release(sh);
  }

  /** 軌跡修正期的初期散布:在 dir 周圍的圓錐內取一個隨機偏角(離架瞬間一次性,之後由導引修正) */
  _armSpread(dir, spread) {
    const up = Math.abs(dir.y) > 0.9 ? _TMP_A.set(1, 0, 0) : _TMP_A.set(0, 1, 0);
    const nx = _TMP_B.crossVectors(dir, up).normalize();
    const nz = _TMP_C.crossVectors(dir, nx).normalize();
    const a = Math.random() * Math.PI * 2, m = Math.tan(Math.random() * spread);
    const out = this._armDir || (this._armDir = new THREE.Vector3());
    return out.copy(dir).addScaledVector(nx, m * Math.cos(a)).addScaledVector(nz, m * Math.sin(a)).normalize();
  }

  /** 低空導引彈的抬頭段:直到 ARMING 距離前只向上離地,避免槍口前的地面/背景物件提早引爆。 */
  _guidedLaunchVel(from, dir, def, v0) {
    const cfg = guidedLaunchOf(def);
    const height = from.y - this._surf(from.x, from.z, from.y);
    const pitchDeg = guidedLaunchPitchDeg(def, height);
    if (!cfg || pitchDeg <= 0) return null;
    const flat = (this._guidedVel || (this._guidedVel = new THREE.Vector3())).set(dir.x, 0, dir.z);
    if (flat.lengthSq() <= 1e-6) flat.set(0, 0, 1);
    flat.normalize();
    const pitch = pitchDeg * Math.PI / 180;
    const out = this._guidedOut || (this._guidedOut = { dist: 0, vel: null });
    out.dist = guidedLaunchDist(def);
    out.vel = flat.multiplyScalar(v0 * Math.cos(pitch)).setY(v0 * Math.sin(pitch));
    return out;
  }

  /**
   * 彈道模擬:逐幀積分 + 線段判定(高初速子彈一幀飛 10m+,用線段補內插)。
   *
   * **效能紀律(2026-07-27)**:本迴圈是「開火就掉幀」的主現場 —— 舊版對**每顆子彈每幀**
   * 做一次 `intersectObjects([…全部敵方 mesh…, terrain.mesh], true)`,其中 `terrain.mesh`
   * 是 193² 高度場共 73,728 個三角形,three 每次都整批線性掃完。改制後:
   *   ① 地形走解析網格行進(`_terrainHitT`,只測射線穿過的格,命中點完全一致)
   *   ② 單位先過包圍球廣相(`_rayCandidates`),通常一個候選都不剩
   *   ③ 暫存向量共用(`_TMP_*`),不再每顆子彈每幀配 5~8 顆 Vector3
   * MUST NOT 為了「寫起來順」把 `terrain.mesh` 加回 raycast 目標(見 /CLAUDE.md A6 效能條)。
   */
  _updateBullets(dt) {
    if (!this.bullets.length) return;
    const cand = this._bulletBuf || (this._bulletBuf = []);
    // 轉向助手:等速改向(推力彈體),每秒最大轉角 maxTurn(弧度)
    const steer = (b, want, maxTurn) => {
      const cur = _TMP_C.copy(b.vel).normalize();
      const ang = cur.angleTo(want);
      if (ang > 1e-4) cur.lerp(want, Math.min(1, maxTurn * dt / ang)).normalize();
      b.vel.copy(cur.multiplyScalar(b.mv));
    };
    for (let i = this.bullets.length - 1; i >= 0; i--) {
      const b = this.bullets[i];
      const prev = _TMP_B.copy(b.pos);
      // 失鎖規則(與伺服器 _tickMissiles 同一條):追蹤目標跑出「攻擊範圍」(以發射點為圓心)
      // → 導引失效,之後只沿當下航向直線飛(吃重力),不再追擊。
      let tgt = b.homing ? this.ents.get(b.homing) : null;
      // 射後不理(2026-08-01 使用者定案)與雷射導引(2026-09-28 使用者定案)**不吃這條**:前者鎖定
      // 之後一路追到底,後者打擊點在發射瞬間凍結、根本沒有鎖可失;射程只管「能不能鎖定」
      // (客戶端 _tickLock 的 _effRange 閘門 + 伺服器 heroLock 複驗)。
      if (tgt && !b.fnf && tgt.mesh.position.distanceTo(b.origin) > b.max) {
        b.homing = null; tgt = null;
        this.hud.feed?.('📡 目標脫離射程:飛彈失鎖(直線飛行)');
      }
      b.age += dt;
      if (b.fnf && tgt) b.chase = true;   // 曾經以鎖定目標追擊過 ⇒ 射程包絡換成追擊燃料(不可逆:目標中途陣亡也照飛)
      // 最短距離(軌跡修正期):離架 b.arm 公尺內導引/追蹤尚未接手 —— 只吃重力直飛,
      // 離架時的初期散布(_armSpread)因此無法被修正 ⇒ 近距離命中率較低(使用者定案規則)。
      // 與射程同一把尺:量**離發射點的直線距離**(球面),而非航跡長 —— `_reachable` 的軌跡修正期
      // 警示帶(`surf < arm`)本來就是直線量的,兩邊不同尺 = 琥珀色的範圍與實際偏差期對不上。
      const armed = prev.distanceTo(b.origin) >= (b.arm || 0);
      const climbing = b.launchDist > 0 && prev.distanceTo(b.origin) < b.launchDist;
      if (climbing) {
        b.vel.y -= BALLISTIC.G * dt;
      } else if (tgt && armed) {
        // 飛彈自動追蹤:朝鎖定目標修正航向(動力飛行,升力抵銷重力)
        const want = _TMP_A.copy(tgt.mesh.position); want.y += 1.5;
        steer(b, want.sub(b.pos).normalize(), seekTurn(SEEK.HOME_W, b.mv));   // 轉彎半徑上限見 data.js SEEK
        // 射後不理最後已知點:目標因收鏡縮視野/迷霧離開快照被移除後,彈頭改朝此點追擊
        // (下方 fnf 分支),而不是當場變直線 —— 收鏡即丟追擊的使用者回報。只記接手後的解算點。
        if (b.fnf) { b.hx = tgt.mesh.position.x; b.hy = tgt.mesh.position.y + 1.5; b.hz = tgt.mesh.position.z; b.hr = this._hitR(tgt); b.homePtSet = true; }
      } else if (armed && b.guide) {
        // 雷射導引(2026-09-28 使用者定案):與射後不理**同一條**「發射瞬間凍結」—— 朝擊發當下
        // 的固定打擊點修正(同一個追蹤頭 HOME_W),發射後不再讀準星,打擊位置不隨目標移動。
        // 使用者定案(2026-08-02)與榴彈**同一條**:中途碰撞就爆(下方 hit 分支)、掠過鎖定點即引爆
        // (下方固定點近炸引信)、飛到射程球面就解除武裝(下方 `b.dud`)。
        steer(b, _TMP_A.copy(b.guidePt).sub(b.pos).normalize(), seekTurn(SEEK.HOME_W, b.mv));
      } else if (armed && b.fnf && b.chase && b.homePtSet && !tgt) {
        // 射後不理失聯追擊:目標已不在快照(收鏡縮視野/迷霧),朝最後已知點修正 —— 與雷射導引
        // 同一具追蹤頭;目標重回快照即由上方 tgt 分支接手(位置即時更新),此處只是不斷線。
        // 雷射導引(固定打擊點)優先:兩者皆有時打擊點才是定案(2026-09-28 發射瞬間凍結)。
        steer(b, _TMP_A.set(b.hx, b.hy, b.hz).sub(b.pos).normalize(), seekTurn(SEEK.HOME_W, b.mv));
      } else {
        b.vel.y -= BALLISTIC.G * dt;                  // 重力下墜(拋物線彈道)
      }
      b.pos.addScaledVector(b.vel, dt);
      const seg = _TMP_A.copy(b.pos).sub(prev);
      const len = seg.length();
      // 命中改旗標 + 命中點暫存 _TMP_D(舊制每分支一個 {point,…} 物件 + clone,每顆每幀配;
      // kind:0 無 1 地形 2 飛彈 3 單位 4 通用(導引固定點近炸,無分類);D 只在當次迭代消費)
      let hitKind = 0, hitMissileId = null, hitEnt = null;
      let hitDist = Infinity;
      if (len > 0.01) {
        const dir = seg.divideScalar(len);          // seg 就地正規化(之後只當方向用)
        const far = len + 0.3;
        // 地形:解析高度場行進(舊版把 terrain.mesh 丟進 raycaster = 每顆子彈每幀掃 73,728 面)
        const dT = this._terrainHitT(prev, dir, far);
        if (dT != null) {
          _TMP_D.copy(prev).addScaledVector(dir, dT); hitKind = 1;
          hitDist = dT;
        }
        // 單位/飛彈:先過包圍球廣相(通常 0 個候選),再交給 raycaster 做精確判定
        this._rayCandidates(prev, dir, far, cand);
        if (cand.length) {
          this.raycaster.set(prev, dir);
          this.raycaster.far = far;
          for (const h of this.raycaster.intersectObjects(cand, true)) {
            if (h.distance >= hitDist) break;       // 地形更近 → 單位不算
            if (!raySolid(h.object)) continue;      // 光暈/招牌不擋彈(唯一縫 `raySolid`)
            let o = h.object;
            while (o && !o.userData.kind && o.userData.missileId == null && o.parent) o = o.parent;
            // 貫穿彈(aoeClass 'line'):單位不擋彈道,只有地形/障礙才終止 —— 圓柱內的目標
            // 由伺服器 heroLance 一次結算(這裡不逐個回報,避免同一發送出多筆傷害)
            if (o && o.userData.missileId != null) { if (b.pierce) continue; _TMP_D.copy(h.point); hitKind = 2; hitMissileId = o.userData.missileId; hitDist = h.distance; break; }
            if (o && o.userData.kind) { if (b.pierce) continue; _TMP_D.copy(h.point); hitKind = 3; hitEnt = this._entByMesh(o); hitDist = h.distance; break; }
            _TMP_D.copy(h.point); hitKind = 1; hitDist = h.distance;
            break;
          }
        }
        // 實體障礙擋彈(建物/神木/巨岩/橋墩):障礙柱比上述命中更近 → 彈頭止於障礙,
        // 不穿越造成傷害(伺服器 heroHit 另有 LOS 複驗,這裡是彈道本體)。
        const dB = this._obstHitT(prev.x, prev.y, prev.z, b.pos.x, b.pos.y, b.pos.z);
        if (dB != null && dB < hitDist) {
          const building = this.mapBuildings?.get(this._hitBuildingKey);
          _TMP_D.copy(prev).addScaledVector(dir, dB);
          hitKind = building ? 3 : 1; hitEnt = building || null;
          hitDist = dB;
        }
      }
      // 追蹤飛彈近炸引信:掠過鎖定目標即引爆(戰鬥部 AoE 由伺服器 heroBurst 結算)。舊制
      // `b.pos.distanceTo(中心) < Math.max(4, r * 0.5)` 有三個病灶,三個都直接造成使用者回報的
      // 「射後不理光暈亮著卻沒命中」:
      //   ① **點取樣**:量的是幀末端點。初速 1000m/s 的攔截彈一幀就飛 16.7m —— 彈頭在兩幀之間
      //      跨過目標,掠過 5m 也不引信,一路飛到射程終點才在空地爆炸;而且跳多遠隨幀率浮動
      //      (低幀率更打不中)。改量**這一幀掃過的線段**上的最近點,與 sim._lanceHits 同一條規則。
      //   ② `r * 0.5` 是手寫的 BLAST.CORE(第二份實作,改超壓帶不會跟著走)。
      //   ③ 只量到目標**中心**:對砲塔/主堡這種 hitR 7~20m 的量體,彈頭貼著牆面飛過去卻不引信
      //      (A18 / _blast / _surfD3 同一條「量中心而非近側表面」的病灶)。
      // 引信半徑因此 = 爆風核心帶 + 目標水平量體,與射程光暈承諾「打得到」的 tol
      // (`_reachable` 的 `blastCoreR(def) + hr`)逐位元同一式:掠過「會吃滿額超壓」的範圍就引爆。
      if (!hitKind && tgt) {
        const c = tgt.mesh.position;
        const dx = b.pos.x - prev.x, dy = b.pos.y - prev.y, dz = b.pos.z - prev.z;
        const l2 = dx * dx + dy * dy + dz * dz;
        const s = l2 > 1e-9
          ? Math.max(0, Math.min(1, ((c.x - prev.x) * dx + (c.y - prev.y) * dy + (c.z - prev.z) * dz) / l2))
          : 0;
        const nx = prev.x + dx * s, ny = prev.y + dy * s, nz = prev.z + dz * s;
        if (Math.hypot(nx - c.x, ny - c.y, nz - c.z) < (b.core || 0) + this._hitR(tgt)) {
          _TMP_D.set(nx, ny, nz); hitKind = 3; hitEnt = tgt;
        }
      }
      // 雷射導引固定打擊點的近炸引信:與上方追蹤引信同一條線段最近點規則,半徑只取爆風核心帶
      // (固定點沒有目標量體)。鎖定空域目標後目標移開,彈體掠過鎖定點即引爆 —— MUST NOT 穿點
      // 而過後繞圈飛到解除武裝。(池化記錄 guidePt 常駐向量,閘門改吃 b.guide 布林,語義同舊 `b.guidePt` 空判)
      // 射後不理失聯引信:目標已不在快照時朝最後已知點(b.hx/hy/hz,上文失聯追擊分支的同一點)
      // 掠過即引爆 —— 同一條線段最近點規則(半徑多含當時目標量體 b.hr,與追蹤引信同一式),
      // MUST NOT 穿點而過後繞圈。目標重回快照即由上方追蹤引信接手,此處只是不斷線。
      if (!hitKind && (b.guide || (!tgt && b.fnf && b.chase && b.homePtSet))) {
        const cx = b.guide ? b.guidePt.x : b.hx, cy = b.guide ? b.guidePt.y : b.hy, cz = b.guide ? b.guidePt.z : b.hz;
        const cr = (b.core || 0) + (b.guide ? 0 : (b.hr || 0));
        const dx = b.pos.x - prev.x, dy = b.pos.y - prev.y, dz = b.pos.z - prev.z;
        const l2 = dx * dx + dy * dy + dz * dz;
        const s = l2 > 1e-9
          ? Math.max(0, Math.min(1, ((cx - prev.x) * dx + (cy - prev.y) * dy + (cz - prev.z) * dz) / l2))
          : 0;
        const nx = prev.x + dx * s, ny = prev.y + dy * s, nz = prev.z + dz * s;
        if (Math.hypot(nx - cx, ny - cy, nz - cz) < cr) {
          _TMP_D.set(nx, ny, nz); hitKind = 4;
        }
      }
      // 射程 = **以射擊點為中心的球面,與軌跡無關**(2026-08-02 使用者定案)—— 逐彈道**唯一一把尺**:
      // `|彈頭 − 發射點| ≥ b.max` 就到界,拋物線的弧、導引彈的修正航跡、離架散布繞的路一律不計。
      // 這條同時把其餘三處量法對齊成同一個球:失鎖判定(目標離 b.origin 超過 b.max)、伺服器落點
      // 閘門(dist2d(射手, 落點))、射程光暈(`_reachable` 的 from.distanceTo(aim))。
      // 舊制對無導引彈量**航跡長**,兩個症狀都是靜默丟包(玩家只看到零傷害):
      //   ・導引彈的航跡恆長於直線(離架散布 + 一路修正航向)⇒ 打射程邊緣的目標,彈頭必定在飛到
      //     之前就自毀(實測微型攔截彈滿射程恆差 5.5m,任何轉向率都救不回來)。
      //   ・45° 拋投的弧長恆為水平距離的 1.148 倍 ⇒ 射程無聲砍掉 13%,砲彈在抵達瞄準點之前半空自爆。
      // 唯一的例外是射後不理**鎖定後**(b.chase):射程包絡整條讓位給追擊燃料 `chaseCapS`
      // (使用者定案「鎖定後持續追擊,不受射程影響」)—— 燃料只是不讓失控彈體永遠留在場上。
      const spent = b.pos.distanceTo(b.origin);
      // **引爆 = 碰撞**(2026-08-15 使用者定案「無論引爆原因是什麼都要造成範圍爆炸傷害」+
      // 「目標移動導致沒有引爆時會繼續沿著軌跡運動,直到碰撞後爆炸」)。爆炸戰鬥部飛出自己的
      // 射程球面時**只是解除武裝**(`b.dud`)—— 彈體照樣沿彈道飛到撞上東西為止,只是那一下不再
      // 是引爆(不畫爆炸、不回報,見下方 aoe 分支)。舊制在球面上**原地引爆**,而球面幾乎總是
      // 落在半空中:實測 158m 射程的榴彈,準星只要落在射程 ×1.05 處,彈頭就在 **8.7m 高空**炸開
      // (爆風 1.8r = 7.1m 外歸零)⇒ 玩家看到一朵爆炸、地面上一個人都沒掉血;×1.5 處是 57m、
      // 對空彈射打空是 32~130m。那正是使用者回報的「爆炸沒有傷害」。
      // **碰撞與出界落在同一幀時 `hit` 優先** ⇒ 落在射程界上的那一發照樣引爆;拋物線的落點由
      // `_lobAim` 的瞄準點夾制退進包絡內(退一個爆風核心帶),所以對地拋投**恆在武裝狀態下著地**。
      // 解除武裝的門檻 MUST 維持 `b.max`(誠實界)—— 放寬成 `b.max × RANGE_TOL` 等於送給爆炸型
      // 武器 25% 的隱形射程(光暈不亮的敵人照樣掉血,見 heroPlasma 檔頭同一條)。
      if (b.aoe && !hitKind && (b.chase ? b.age >= b.fuel : spent >= b.max)) b.dud = true;
      // 啞彈的存活上限沿用彈體本來就帶著的燃料(`chaseCapS`,推導不手寫)= 這把武器的彈頭
      // 最長可以合法留在空中的時間;碰撞優先,所以正常情況下它在落地那一刻就結束了。
      const done = hitKind !== 0 || (b.aoe ? (b.dud && b.age >= b.fuel) : spent >= b.max);
      if (!done) {
        b.mesh.position.copy(b.pos);
        // 彈體一律對準航向(2026-07-22 彈藥同源:火箭/飛彈也是有頭尾的彈體,不再是無方向灰球)
        // seg 在 len > 0.01 的分支已就地正規化;此處只補 0.001~0.01 的極短段
        if (len > 0.001) b.mesh.quaternion.setFromUnitVectors(_FWD_Z, len > 0.01 ? seg : seg.normalize());
        stepProjectileFx(b.mesh, b.age, b.mv);
        if (b.cyclone) this._spinCyclone(b, dt);
        continue;
      }
      // 落點快照:_dropBullet 把記錄回池即清旗標(dud 首當其衝),MUST 先讀完再歸還。
      // p 走 _TMP_D(命中,當次迭代現算現用,下方消費全同步)或彈頭當下位置(脫靶);
      // 其餘落點欄(slot/r/aoe/origin/oy/向量)reset() 不動,留給下方結算讀完,下發覆寫。
      const wasDud = b.dud;
      this._dropBullet(b);
      this.bullets.splice(i, 1);
      const p = hitKind ? _TMP_D : b.pos;
      const def = this.wdef[b.slot];
      if (b.aoe) {
        // 啞彈(已飛出射程球面才碰上東西):MUST NOT 畫爆炸、MUST NOT 回報 —— 伺服器的落點閘門
        // (`heroBurst` 的 impCap)收不下這一發,畫了就正好是使用者回報的那個症狀:看得到爆炸、
        // 範圍內一個人都沒掉血。落地留土塵(與下方直擊彈的地形分支同一支),彈體本身照樣回收。
        if (wasDud) {
          if (hitKind) starburst(this.scene, this.effects, p.x, p.y, p.z, 1.2, 0xcfc4a8);
          continue;
        }
        // 發射器:著彈點回報伺服器結算範圍傷害(直擊/落地皆引爆)
        // 洞內著彈的「地面」是隧道路面,不是頭頂那座山:覆蓋段的地形高度**沒有**被開挖,拿
        // heightAt 當基準會把爆點抬到山頂(爆炸畫在山上、離地高歸 1、lev 掉回 0 = 洞內單位
        // 被 _slabSep 判成板體另一側 ⇒ 整發榴彈打在洞裡卻零傷害)。2026-07-30 起彈頭會真的
        // 停在隧道路面上(_slabHitT 補了路面),這條基準才成為熱路徑。
        // open 段(地下道引道露天路塹)腳下就是地形本體,照走 heightAt(A29)。
        const btn = this.terrain.tunnelAt?.(p.x, p.z);
        const inTun = !!(btn && !btn.open && p.y < btn.ceil);
        const gy = inTun ? btn.floor : this.terrain.heightAt(p.x, p.z);
        const by = Math.max(p.y, gy + 1);
        this._explosion(p.x, by, p.z, (b.r || 12) * 0.8, 0xffaa33);
        this._applyBlast(p.x, by, p.z, b.r || 12);   // 太近開砲,自己也會被衝擊波掀飛
        // y = 離地引爆高度(對空:直擊飛行目標時在其高度炸;sim._blast 吃 3D 距離)
        // lev = 爆點結構層(sim 隧道垂直隔離)。**橋面刻意不報 1**:伺服器 _unitLev 讓塔/主堡
        //       恆為 0,爆點報 1 會被 _slabSep 判成「與橋上砲塔分屬板體兩側」= 塔對 AoE 完全免傷。
        this.net.send({ t: 'burst', x: p.x, z: -p.z,
          y: Math.max(0, Math.round((by - gy) * 10) / 10), lev: inTun ? 2 : 0 });   // three z 南 → 模擬 z 北
      } else if (b.pierce) {   // (貫穿彈的 missileId 分支不會成立:_updateBullets 已讓飛彈不擋彈道)
        // 直線貫穿:落點定案(地形/障礙/射程終點)才回報整條射線,伺服器沿圓柱一次結算全部目標。
        // 高初速近似直線(trajClass 'flat')⇒ 以「槍口→終點」的直線圓柱近似實際彈道,誤差 < 0.4m。
        this._lanceVisual(b.origin, p, def, this.side);
        this._lanceFeedback(def, this._sendLance(b.origin, p, def, b.oy), p);
      } else if (hitMissileId != null) {
        this.net.send({ t: 'hitMissile', id: hitMissileId, w: b.slot });
        this._hitFeedback(def, null, p);
      } else if (hitEnt) {
        this.net.send({ t: 'hit', id: hitEnt.id, w: b.slot });
        this._hitFeedback(def, hitEnt, p);
      } else if (hitKind === 1) {
        starburst(this.scene, this.effects, p.x, p.y, p.z, 1.2, 0xcfc4a8);   // 打土塵
      }
    }
  }

  // ---------------- 招式(Q 守招 / E 攻招:解鎖 + CD + 電力,伺服器結算)----------------
  _castAbility(slot) {
    if (!this.side || this.dead || this.shopOpen || !this.ch) return;
    const now = performance.now() / 1000;
    if (this._isCasting(now)) {
      if (now - (this._castWarnAt || 0) > 1.2) {
        this._castWarnAt = now;
        this.hud.feed?.('⏳ 招式詠唱前搖中，無法施放其他招式！');
      }
      return;
    }
    const idx = slot === 'def' ? 0 : 1;
    const lvl = this.abil[slot] || 1;
    const A = heroAbility(this.ch, slot, lvl);
    if (!A) return;
    const cdLeft = this.cds[idx] || 0;
    const chgInfo = this.chg?.[idx];
    const readyCharges = chgInfo ? chgInfo[0] : (cdLeft <= 0 ? 1 : 0);
    if (readyCharges <= 0 && cdLeft > 0) { this.hud.feed?.(`⏳【${A.name}】冷卻中(${cdLeft.toFixed(0)}s)`); return; }
    // 招式電力隨招式階級(sk/ult)成長(2026-07-20:無獨立精通折減;伺服器 heroCast 同一條)
    const mpc = Math.round(A.mp);
    if (this.mp < mpc) { this.hud.feed?.(`🔋 電力不足(【${A.name}】需 ${mpc} MP)`); return; }
    if (this.empLeft > 0) { this.hud.feed?.('⚡ 系統離線(遭電磁癱瘓),無法施放!'); return; }
    // 指向型攻擊招式必須鎖定敵方目標(2026-09-03):fx: 'strike'/'emp' 且有 range 的招式
    // 需要準星已鎖定敵人(_lockId 由伺服器 lock 事件確認)才能施放。
    // 豁免:buff/heal/stealth/vision/intercept/rally/recon/summon 以及 range=0 的招式
    //   ─ 移動類(fx: 'dash')顯式豁免:突進不需敵人,未來帶 range 的位移招式亦同。
    //   ─ target:'self'/'team' 的增益/治療光環天然無 fx:'strike'/'emp',不進這個閘。
    if (A.range > 0 && (A.fx === 'strike' || A.fx === 'emp') && A.fx !== 'dash' && this._lockId == null) {
      this.hud.feed?.(`🎯【${A.name}】需要鎖定敵方目標才能施放！`);
      return;
    }
    // 指向型招式:準星與地形/單位交點為目標落點(超程由伺服器夾回射程)
    let x = this.pos.x, z = this.pos.z;
    if (A.range) {
      const { point } = this._resolveAim(Math.max(A.range * 1.4, 200));
      x = point.x; z = point.z;
    }
    this.net.send({ t: 'cast', slot, x: Math.round(x * 10) / 10, z: Math.round(-z * 10) / 10 });
    if (A.shieldExpand) {
      this.shieldExpandUntil = now + (A.dur || 8);
      this._updateShieldVisibility();
    }
    if (A.defJump) {
      this.defJumpUntil = now + (A.dur || 8);
    }
    const snowMul = this.env?.getWeatherDynamics?.()?.snowCdMul ?? 1;
    if (chgInfo && chgInfo[1] > 1) {
      chgInfo[0] = Math.max(0, chgInfo[0] - 1);
      if (chgInfo[0] <= 0) {
        this.cds[idx] = (A.cd || 10) * snowMul;
      } else {
        this.cds[idx] = 0;
      }
    } else {
      this.cds[idx] = (A.cd || 10) * snowMul;
    }
    const castDur = slot === 'atk' ? (A.castTime || ATK_CAST_S) : (A.castTime || 0);
    if (castDur > 0) {
      this._castingUntil = now + castDur;
      this.castLeft = castDur;
    }
    // 招式光暈:記錄最後施放的招式資訊供 _updateRangeGlows 在詠唱期間顯示招式足跡色光暈
    this._lastCastA = { A, x, z };
    // 突進 / 相位穿梭:位移本就客戶端權威,樂觀立即生效(CD/MP 伺服器把關)
    if (A.fx === 'dash' || A.fx === 'phaseshift') {
      const look = this.camera.getWorldDirection(new THREE.Vector3());
      if (!this._flying()) { look.y = 0; look.normalize(); this.vy = (this.vy ?? 0) + 5; }
      this.vel.addScaledVector(look, A.imp || 30);
      this.trauma = Math.min(1, this.trauma + 0.3);
    }
  }

  /** 重武器冷卻(HUD 顯示) */
  _burstCdLeft() {
    if (!this.side) return 0;
    const st = this.wstate.heavy;
    if (!st || st.reloadEnd <= 0) return 0;
    return Math.max(0, st.reloadEnd - performance.now() / 1000);
  }

  /** 瞄準模式(右鍵點一下切換):拉近視角、切換重武器(伺服器另行把關開火權限) */
  _setAiming(on) {
    if (!this.side || this.aiming === on) return;
    if (on && this.viewMode === 'tps') {
      // 狙擊時回到第一人稱,但退出狙擊仍回到玩家原本選的第三人稱。
      this.bodyYaw = this.yaw;
      this._aimViewRestore = this.viewMode;
      setViewMode('fpv');
    }
    this.aiming = on;
    // 黑邊是本地表現層，必須跟著輸入當場切換，不能等下一個 8Hz 快照。
    this.hud.aiming?.(on);
    this.net.send({ t: 'aim', on });
    if (!on && this._aimViewRestore) {
      const restore = this._aimViewRestore;
      this._aimViewRestore = null;
      setViewMode(restore);
    }
  }

  /** 能否進入防守姿態:非死亡/非商店、磁力>0 */
  _canEnterDefense() {
    if (!this.side || this.dead || this.shopOpen) return false;
    if ((this.sp || 0) <= 0) return false;
    return true;
  }

  /** 防守姿態切換(正面生成機體大小的低透明度護盾;磁力歸零無法生成) */
  _toggleDefense(on) {
    const next = (on !== undefined) ? !!on : !this.defending;
    if (next) {
      if (!this._canEnterDefense()) {
        if ((this.sp || 0) <= 0) this.hud.feed?.('⚠️ 磁力歸零，無法生成護盾！');
        return;
      }
      this.defending = true;
      this.hud.feed?.('🛡️ 進入防守姿態');
    } else {
      if (!this.defending) return;
      this.defending = false;
      this.hud.feed?.('🛡️ 解除防守姿態');
    }
    this.net?.send({ t: 'defend', on: this.defending });
    this._updateShieldVisibility();
  }

  /** 更新自機護盾網格可見度 */
  _updateShieldVisibility() {
    const hasShield = this.defending && (this.sp || 0) > 0 && !this.dead;
    const isExpanded = (this.shieldExpandUntil || 0) > (performance.now() / 1000);
    const s = isExpanded ? SHIELD_PRESENTATION_EXPAND : 1.0;
    if (this._fpsShieldMesh) {
      this._fpsShieldMesh.visible = (this.viewMode === 'fpv' && hasShield);
      this._fpsShieldMesh.scale.set(s, 1.0, 1.0);
    }
    for (const ent of this.ents.values()) {
      if (ent.isSelf && ent.shieldMesh && !ent.shieldMesh.userData.authoredCombat) {
        ent.shieldMesh.visible = (this.viewMode === 'tps' && hasShield);
        ent.shieldMesh.scale.set(s, 1.0, s);
      }
    }
  }

  /** 長按右鍵 / 觸控 R 達 GAME.ABILITY_HOLD_S → 施放招式(見 _fireHoldAbility 的模式分流)。
   *  短按右鍵仍 = 切換模式(見 _rmbUp);達門檻才出招,一次按住只觸發一次,
   *  觸發後放開不再切換 → 切換與出招互不衝突。左鍵射擊獨立(狙擊模式重武器照常連射)。 */
  _tickHoldAbility(now) {
    if (!this.side || this.dead || this.shopOpen || !this._rmbDownAt || this._rmbAbilityFired) return;
    if (now - this._rmbDownAt < GAME.ABILITY_HOLD_S) return;
    this._fireHoldAbility();
  }

  /**
   * 招式手勢的**唯一派發縫**(攻防雙招式改制:防守型態下使用為防守招式，非防守型態使用則為攻擊招式):
   * 長按右鍵 / 觸控長按 R(_tickHoldAbility)與觸控招式鈕(_cmd('special'))都走這裡,
   * 由**當下防守狀態**分流 —— 非防守 = 攻擊招式(skill)、防守中 = 防守招式(ult)。
   *
   * 分流本身只有 `data.js abilHoldSlot` 一份,MUST NOT 在任一輸入端另寫 `defending ? …`。
   */
  _fireHoldAbility() {
    if (!this.side || this.dead || this.shopOpen) return;
    if (this._isCasting(performance.now() / 1000)) return;
    this._rmbAbilityFired = true;   // 同一次按住只觸發一次;放開時也據此不再切換模式
    this._castAbility(abilHoldSlot(this.defending));
  }

  /** HUD 資料:輕/重武器 / 招式 / 資源(彈藥為本地 HUD,與伺服器小幅漂移是 by design) */
  _weaponHud() {
    if (!this.side || !this.ch) return null;
    const now = performance.now() / 1000;
    const c = CHARACTERS[this.ch];
    const slotHud = (id) => {
      const def = this.wdef[id], st = this.wstate[id];
      if (!def || !st) return null;
      return {
        name: def.name, lvl: this.abil[id], ammo: st.ammo, mag: def.mag,
        reload: st.reloadEnd > 0 ? Math.max(0, st.reloadEnd - now) : 0,
        // 填彈總長(HUD 進度條分母;天氣雪地倍率已烤進 st.reloadDur,見 _startReload)
        reloadMax: Math.max(0.001, st.reloadDur || def.reload || 0),
      };
    };
    const snowMul = this.env?.getWeatherDynamics?.()?.snowCdMul ?? 1;
    const abHud = (slot, idx) => {
      const lvl = this.abil[slot] || 1;
      const A = heroAbility(this.ch, slot, lvl);
      const mpc = Math.round(A.mp);   // 招式電力(隨階級,無精通折減)
      const chg = this.chg && this.chg[idx] ? this.chg[idx] : [1, 1, 0];
      const charges = chg[0] != null ? chg[0] : 1;
      const maxCharges = chg[1] != null ? chg[1] : (A.charges || 1);
      const nextCd = chg[2] || 0;
      return {
        name: A.name, lvl, cd: this.cds[idx] || 0, mp: mpc,
        // 冷卻總長(HUD 進度條分母;與 _tryCast 落子時的 (A.cd||10)*snowMul 同一條)
        cdMax: Math.max(0.001, (A.cd || 10) * snowMul),
        ready: (this.cds[idx] || 0) <= 0 && this.mp >= mpc,
        charges, maxCharges, nextCd,
      };
    };
    return {
      money: this.money, atBase: this._atBase(),
      defending: this.defending,
      code: c.code, machine: c.machine, aiming: this.aiming,
      light: slotHud('light'), heavy: slotHud('heavy'),
      def: abHud('def', 0), atk: abHud('atk', 1),
      sp: this.sp, msp: this.maxSp, mp: this.mp, mm: this.maxMp,
      // 動力(全機種皆有;地面機體大跳躍/變形消耗動力,飛行機體爬升消耗動力)
      lift: { v: Math.max(0, this.lift ?? this._liftMax()), max: this._liftMax() },
      kn: this.kn, emp: this.empLeft, stealth: this.stealthLeft,
      // 機種絕招(飽和攻擊 / 集束炸彈 / 極音速飛彈)自 2026-08-06 起整組退場 ⇒ 這裡不再有
      // kami / decoy / hyper 三格。長按右鍵改成招式手勢(一般 = 守招、狙擊 = 攻招),
      // CD 一律由上面的 def / atk 兩格顯示 —— 再畫一顆機種絕招格就是「鈕面說有、按下去沒有」的假招。
      morph: this.isMorph ? { flight: this.flight, charge: this.charge } : null,
      // 空白鍵機動能力(HUD):無人機完美迴避吃 CD;機甲蓄力跳躍/變形升空改吃動力(無 CD,顯示滿蓄耗動力)
      mobil: this.isDrone ? { name: '完美迴避', cd: Math.max(0, (this._dodgeCd || 0) - now), cdMax: IFRAME.DRONE_CD }
        : this.isMorph ? { name: '升空變形', lift: morphLiftCost(1), liftMax: this._liftMax(), cur: Math.max(0, this.lift ?? this._liftMax()) }
          : { name: '蓄力跳躍', lift: cjumpLiftCost(1), liftMax: this._liftMax(), cur: Math.max(0, this.lift ?? this._liftMax()) },
    };
  }

  // ---------------- 特效 ----------------
  // 曳光短線(池化:每發舊制 = 幾何 + 材質各一份;現本體循環重用,只寫兩端點與顏色)
  _tracer(from, to, color, ttl = 0.1) {
    const line = this._tracerPool.acquire();
    const p = line.geometry.attributes.position;
    p.setXYZ(0, from.x, from.y, from.z);
    p.setXYZ(1, to.x, to.y, to.z);
    p.needsUpdate = true;
    line.material.color.setHex(color);
    line.material.opacity = 0.9;
    line.visible = true;
    this.scene.add(line);
    this._pushTracerFx(line, ttl);
  }

  /**
   * 曳光遮蔽截斷(2026-07-22):NPC/塔/主堡/bot/他人開火視覺與伺服器 LOS 對齊 ——
   * 伺服器判「可射」仍可能因幾何不同形(occ r/h 夾制、THRU_M 擦邊放行、y 離地近似、
   * 射點用 ent 座標非實際槍口)讓客戶端全精度下的束線削過障礙;一律以本端 _obstHitT
   * (圓柱 ∪ 橋面/天花薄板)把 to 夾短到障礙面(cut=true 時呼叫端在截斷點畫火花)。
   * 純表現層 —— 傷害結算在伺服器,不受影響。
   */
  _clipBeam(from, to) {
    const d = this._obstHitT(from.x, from.y, from.z, to.x, to.y, to.z);
    if (d == null) return { to, cut: false };
    const len = from.distanceTo(to) || 1;
    if (d >= len) return { to, cut: false };
    return { to: from.clone().lerp(to, Math.max(0, (d - 0.2) / len)), cut: true };
  }

  /** 陣營射擊配色(曳光主色 / 槍口熱芯);第三方(GUER/MILI)走各自識別色 */
  _shotCols(side) {
    const cached = _shotColCache.get(side);
    if (cached) return cached;
    const res = side === 'SWARM' ? { col: 0xffb300, hot: 0xffe6a0 }
      : side === 'STEEL' ? { col: 0x4fc3f7, hot: 0xcdeeff }
      : { col: new THREE.Color(sideInfo(side).color).getHex(), hot: 0xf4ffd9 };
    _shotColCache.set(side, res);
    return res;
  }

  /**
   * 統一的「開火視覺」:槍口閃光 + 發光曳光束(取代細線)+(命中點)火花。
   * heavy 重武器一律比 light 更粗、更亮、更持久、槍口爆更大 —— 第一/第三人稱皆適用。
   * @param opts.heavy 重武器  @param opts.side 陣營  @param opts.impact `to` 是真實命中點(才畫落點火花)
   */
  _shotFx(from, to, { heavy = false, side, impact = false } = {}) {
    const { col, hot } = this._shotCols(side);
    this._muzzleBurst(from, heavy, side);
    beamLine(this.scene, this.effects, from, to, col,
      heavy ? { ttl: 0.30, w: 0.30 } : { ttl: 0.13, w: 0.075 });
    if (heavy) beamLine(this.scene, this.effects, from, to, hot, { ttl: 0.18, w: 0.11 });  // 高熱內芯
    if (impact) impactBurst(this.scene, this.effects, to,
      { r: heavy ? 4.2 : 1.6, color: col, core: hot, heavy });
  }

  /** 槍口爆閃(世界座標):heavy 加一圈衝擊環 */
  _muzzleBurst(pos, heavy, side) {
    const { col, hot } = this._shotCols(side);
    impactBurst(this.scene, this.effects, pos,
      { r: heavy ? 2.6 : 1.3, color: col, core: hot, heavy });
  }

  _explosion(x, y, z, r, color) {
    explosionBurst(this.scene, this.effects, x, y, z, r, color);
  }

  /**
   * 一次性特效的**回收唯一縫**。舊版只 `scene.remove` 就算了 —— three 的 WebGLRenderer 以
   * `geometry.dispose()` / `material.dispose()` 事件釋放 GPU 緩衝,沒呼叫就一直留在顯示卡上:
   * 一場十分鐘、每發十幾條光束的對局會累積出上萬份殭屍緩衝,手機顯存吃緊後就是「打越久越卡」。
   * 共用幾何(vfx/castfx 的單位體、碎塊池)由 `toon.js markShared` 註冊,`disposeTree` 自動跳過;
   * 特效自帶 `dispose()` 者(材質池/專屬資源)優先走自己那條。
   */
  _freeEffect(e) {
    this.scene.remove(e.obj);
    if (e.dispose) e.dispose(); else disposeTree(e.obj);
  }

  _updateEffects(dt) {
    // 上限保險:扇形武器一次擊發就吐 20~30 個特效,連發 + 多人同框時清單會爆長
    // (每幀逐個 fade = 純 CPU)。超量時先砍最舊的 —— 舊特效本來就快淡出,肉眼幾乎無感。
    const over = this.effects.length - FX_MAX;
    if (over > 0) {
      for (let i = 0; i < over; i++) this._freeEffect(this.effects[i]);
      this.effects.splice(0, over);
    }
    for (let i = this.effects.length - 1; i >= 0; i--) {
      const e = this.effects[i];
      e.ttl -= dt;
      e.age = (e.age || 0) + dt;
      const f = Math.max(0, e.ttl / (e.ttl + e.age));
      e.fade?.(e.obj, f, dt);
      if (e.ttl <= 0) {
        this._freeEffect(e);
        this.effects.splice(i, 1);
      }
    }
  }

  // ---------------- 陣亡過場(第一人稱被擊毀動畫)----------------
  /** 陣亡過場逐幀驅動:地面=劇震+緩傾覆+火煙柱+尾段殉爆白閃;飛行=拋物墜毀+翻滾+拖煙+觸地(或逾時空中)爆+俯看殘骸。
   *  完整獨佔 this.camera(_updatePlayer 對 dead 早退,無他者寫 camera);cockpit 為 camera 子物件自動隨傾倒/翻滾
   *  → 第一人稱「還在艙內爆」讀感。純表現層不動權威狀態;dt 吃 hitstop 定格,時長確定;結束時 _deathSeq=null 並熄紅框。 */
  _updateDeathSeq(dt, now) {
    const s = this._deathSeq;
    s.t += dt;
    const cam = this.camera;
    let done = false;

    if (!s.fly) {
      // ── 地面機體:原地劇震(0.9s 內衰減)+ smoothstep 側翻下陷,尾段主爆白閃 ──
      const decay = Math.max(0, 1 - s.t / 0.9);
      const n = decay * decay;
      const shP = (Math.random() * 2 - 1) * n * 0.11;
      const shY = (Math.random() * 2 - 1) * n * 0.11;
      const shR = (Math.random() * 2 - 1) * n * 0.13;
      const tp = Math.min(1, Math.max(0, (s.t - 0.2) / 1.4));   // 0.2s→1.6s 之間側翻
      const topple = tp * tp * (3 - 2 * tp);                    // smoothstep
      cam.position.copy(s.eye);
      cam.position.y -= topple * 1.2;                           // 隨傾覆下陷 ~1.2m
      const minCamY = s.surf + 0.4;
      if (cam.position.y < minCamY) cam.position.y = minCamY;   // 防鏡頭鑽入地表下
      cam.rotation.set(0, 0, 0);
      cam.rotateY(s.yaw + shY);
      cam.rotateX(s.pitch + topple * 0.35 + shP);               // pitch 次(~20°)
      cam.rotateZ(s.roll + topple * 1.0 + shR);                 // roll 主(~57°)
      s.smokeAcc += dt;                                         // 週期小火花(燃燒感)
      if (s.smokeAcc >= 0.22) {
        s.smokeAcc = 0;
        starburst(this.scene, this.effects,
          s.eye.x + (Math.random() * 2 - 1) * 2, s.surf + 1 + Math.random() * 2,
          s.eye.z + (Math.random() * 2 - 1) * 2, 1.2, 0xffb055);
      }
      // 尾段殉爆高潮(t≈1.45):主爆 + 地環 + 碎片 + 大字卡 + hitstop + 白閃(各一次)
      if (!s.climax && s.t >= 1.45) {
        s.climax = true;
        const fx = s.eye.x, fy = s.surf, fz = s.eye.z;
        this._explosion(fx, fy + 3, fz, 11, 0xff8a3a);
        shockRing(this.scene, this.effects, fx, fy, fz, 10, s.col);
        debrisBurst(this.scene, this.effects, fx, fy + 2, fz, { big: true, accent: s.col });
        comicPop(this.scene, this.effects, fx, fy + 9, fz, { big: true, hue: 18 });
        this._deathPlume(fx, fy, fz);                          // 殉爆後持續燃燒的火煙柱
        this._emberBurst(fx, fy + 2, fz, 22, 7);               // 大量迸射火星
        this._hitstop = Math.max(this._hitstop || 0, 0.06);
        this.hud.deathCine?.(true, true);                      // 白閃
      }
      if (s.t >= s.dur) done = true;

    } else if (!s.climax) {
      // ── 飛行機體:自適應重力拋物墜落 + per-axis 翻滾 + 拖尾煙 ──
      s.v.y -= s.g * dt;
      const frAir = frictionFPS(0.7, dt);
      s.v.x *= frAir; s.v.z *= frAir;   // 微空氣阻力:墜點不飄太遠
      s.p.addScaledVector(s.v, dt);
      s.yaw += s.spin.y * dt; s.pitch += s.spin.x * dt; s.roll += s.spin.z * dt;
      s.smokeAcc += dt;
      if (s.smokeAcc > 0.06) { s.smokeAcc = 0; this._crashSmoke(s.p.x, s.p.y, s.p.z, 1.0); }
      cam.position.copy(s.p);
      const minCamY = this._surf(s.p.x, s.p.z, s.p.y) + 0.4;
      if (cam.position.y < minCamY) cam.position.y = minCamY;   // 防鏡頭鑽入地表下
      cam.rotation.set(0, 0, 0);
      cam.rotateY(s.yaw); cam.rotateX(s.pitch); cam.rotateZ(s.roll);
      // 觸地偵測(_surf → 橋面/地表);逾時仍在空中則就地空中爆(不瞬移鏡頭到地面),時長有界
      const gy = this._surf(s.p.x, s.p.z, s.p.y);
      const hitGround = s.p.y <= gy + 1.6;
      const timeout = s.t >= s.dur - 0.45;
      if (hitGround || timeout) {
        s.climax = true;
        const iy = hitGround ? gy + 1.0 : s.p.y;               // 落地→貼地爆;逾時→原空中位置爆
        s.p.y = iy;
        this._explosion(s.p.x, iy + 2, s.p.z, 13, 0xff7a30);
        shockRing(this.scene, this.effects, s.p.x, iy, s.p.z, 9, s.col);
        debrisBurst(this.scene, this.effects, s.p.x, iy + 1, s.p.z, { big: true, accent: s.col });
        this._deathPlume(s.p.x, iy, s.p.z);                    // 觸地後燃燒火煙柱
        this._emberBurst(s.p.x, iy + 1, s.p.z, 22, 7);         // 大量迸射火星
        this._hitstop = Math.max(this._hitstop || 0, 0.06);
        this.hud.deathCine?.(true, true);                      // 白閃
        s.v.set(0, 0, 0); s.holdUntil = s.t + 0.45;            // 釘爆點,俯看殘骸
      }

    } else {
      // ── 飛行觸地保留:鏡頭在殘骸上方緩緩下俯、翻滾歸零,煙續冒 ──
      s.pitch += (-0.5 - s.pitch) * lerpFPS(3, dt);
      s.roll += (0 - s.roll) * lerpFPS(3, dt);
      cam.position.copy(s.p);
      const minCamY = this._surf(s.p.x, s.p.z, s.p.y) + 0.4;
      if (cam.position.y < minCamY) cam.position.y = minCamY;   // 防鏡頭鑽入地表下
      cam.rotation.set(0, 0, 0);
      cam.rotateY(s.yaw); cam.rotateX(s.pitch); cam.rotateZ(s.roll);
      s.smokeAcc += dt;
      if (s.smokeAcc > 0.12) { s.smokeAcc = 0; this._crashSmoke(s.p.x, s.p.y, s.p.z, 1.6); }
      if (s.t >= s.holdUntil) done = true;
    }

    // 第一人稱燃燒吞沒:鏡頭定位「之後」在其前方近距離持續撒火 + 火星,填滿 FPV(座艙被火吞沒感)。
    // climax 前密、climax 後轉稀疏餘燼;純加法火焰不擋操作視覺、隨鏡頭一起翻滾。
    s.fpvAcc = (s.fpvAcc || 0) + dt;
    if (s.fpvAcc >= (s.climax ? 0.26 : 0.12)) { s.fpvAcc = 0; this._engulfFPV(cam); }

    if (done && !s.cut) {
      // 陣亡過場 → 重生倒數頁的切點(序 8 ④-1)。`s.cut` 的守衛不可少:過場結束之後
      // `done` 每一幀都是 true,不擋就是幕每 0.34 秒重刷一次;而旋鈕關著時 `_wipeCut`
      // 當場同步走回呼 ⇒ 這兩行的執行時機逐位元同舊制(下一幀 `_deathSeq` 已是 null)。
      s.cut = true;
      this._wipeCut(() => {
        this._deathSeq = null;
        this.hud.deathCine?.(false);   // 熄紅框(倒數頁由下一 8Hz 快照顯示)
      }, sideInfo(this.side).color);
    }
  }

  /** 第一人稱「座艙被火吞沒」:在鏡頭前方近距離撒火焰 + 火星,填滿 FPV(殉爆過場專用,強化第一人稱燃燒感)。 */
  _engulfFPV(cam) {
    const fwd = _TMP_A.set(0, 0, -1).applyQuaternion(cam.quaternion);
    const right = _TMP_B.set(1, 0, 0).applyQuaternion(cam.quaternion);
    // 火 + 煙集中在左右兩側帶,中央 ~1/3 正前方留空 —— 被擊殺過場仍看得見前方戰況(可讀性優先)。
    // 交替左右均衡;每顆側向強制外推(lat 絕對值 ≥1.7),焰/煙球不侵入正前方視野。
    for (let i = 0; i < 4; i++) {
      const side = (i % 2) ? 1 : -1;                     // 交替左右兩側
      const smoke = i >= 2;                              // 後兩顆為煙(灰、法線混色),前兩顆為火(加法)
      const d = (smoke ? 1.8 : 1.6) + Math.random() * 1.2;
      const base = smoke ? 1.8 + Math.random() * 1.3 : 1.1 + Math.random() * 1.0;
      // 側向外推量與尺寸掛鉤:大焰球推更遠 → 內緣不越過中央 1/3(FOV 68°,中央 1/3 = ±11°);
      // 焰/煙自畫面左右邊緣舔入(集中兩側),正前方 1/3 保持視野。
      const lat = side * ((smoke ? 2.4 : 1.9) + base * 0.35 + Math.random() * 1.2);
      // 火從下往上舔、煙齊眼高翻騰(池化 sprite;暫存只在本同步區塊用,不進池化記錄)
      _TMP_D.copy(cam.position).addScaledVector(fwd, d).addScaledVector(right, lat);
      _TMP_D.y += (smoke ? 0.2 : -0.4) - Math.random() * 0.9;
      const rise = smoke ? 2 : 3 + Math.random() * 3, grow = smoke ? 1.2 : 0.8, op = smoke ? 0.55 : 0.9;
      const sp = this._takeSprite(!smoke, _TMP_D.x, _TMP_D.y, _TMP_D.z, base,
        smoke ? 0x4a4e52 : (Math.random() < 0.5 ? 0xff7a2a : 0xffd166), op);
      sp.userData.vel.set(0, rise, 0);
      sp.userData.base = base;
      sp.userData.grow = base * grow;
      sp.userData.op = op;
      this._pushSpriteFx(sp, (smoke ? 0.5 : 0.32) + Math.random() * 0.26, _spriteDriftFade);
    }
    // 火星只沿兩側迸射(以 right 軸偏移),中央不撒 → 正前方保持通透
    for (const s of [-1, 1]) this._emberBurst(
      cam.position.x + right.x * s * 2.2, cam.position.y - 0.3, cam.position.z + right.z * s * 2.2, 2, 1.6);
  }

  /** 火焰粒子貼圖(快取,512px):白熱核心 + 中層暖輝 + 大量細火舌 + 熱斑點 → 加法混色的高解析度火光。 */
  _fireTex() {
    if (this._fireTexC) return this._fireTexC;
    const S = 512, cv = document.createElement('canvas'); cv.width = cv.height = S;
    const c = cv.getContext('2d'), cx = S / 2, cy = S / 2;
    const g = c.createRadialGradient(cx, cy, 0, cx, cy, S / 2);
    g.addColorStop(0, 'rgba(255,255,255,1)');
    g.addColorStop(0.22, 'rgba(255,248,224,0.95)');
    g.addColorStop(0.5, 'rgba(255,168,72,0.55)');
    g.addColorStop(0.78, 'rgba(255,110,34,0.24)');
    g.addColorStop(1, 'rgba(230,70,16,0)');
    c.fillStyle = g; c.fillRect(0, 0, S, S);
    c.globalCompositeOperation = 'lighter';
    for (let i = 0; i < 130; i++) {                  // 細火舌:徑向亮條(高密度內部結構)
      const a = Math.random() * Math.PI * 2;
      const r0 = S * (0.04 + Math.random() * 0.08), r1 = S * (0.24 + Math.random() * 0.24);
      const wob = (Math.random() - 0.5) * 0.25;
      c.strokeStyle = `rgba(255,${(180 + Math.random() * 70) | 0},${(70 + Math.random() * 90) | 0},${0.03 + Math.random() * 0.06})`;
      c.lineWidth = 1 + Math.random() * 4;
      c.beginPath();
      c.moveTo(cx + Math.cos(a) * r0, cy + Math.sin(a) * r0);
      c.quadraticCurveTo(cx + Math.cos(a + wob) * (r0 + r1) * 0.5, cy + Math.sin(a + wob) * (r0 + r1) * 0.5,
        cx + Math.cos(a) * r1, cy + Math.sin(a) * r1);
      c.stroke();
    }
    for (let i = 0; i < 60; i++) {                   // 熱斑點:亮核心散布(火花感)
      const a = Math.random() * Math.PI * 2, rr = S * Math.random() * 0.32;
      const px = cx + Math.cos(a) * rr, py = cy + Math.sin(a) * rr, pr = 2 + Math.random() * 6;
      const pg = c.createRadialGradient(px, py, 0, px, py, pr);
      pg.addColorStop(0, `rgba(255,250,220,${0.3 + Math.random() * 0.4})`); pg.addColorStop(1, 'rgba(255,180,90,0)');
      c.fillStyle = pg; c.beginPath(); c.arc(px, py, pr, 0, 7); c.fill();
    }
    const t = finishTex(new THREE.CanvasTexture(cv), { srgb: true, stream: false });
    this._fireTexC = t; return t;
  }

  /** 煙霧粒子貼圖(快取,512px):多層 fBm 濃度斑塊 + 暗紋(翻騰立體感)+ 圓形遮罩 → 高解析度雲絮,由 sprite 色染灰。 */
  _smokeTex() {
    if (this._smokeTexC) return this._smokeTexC;
    const S = 512, cv = document.createElement('canvas'); cv.width = cv.height = S;
    const c = cv.getContext('2d');
    c.globalCompositeOperation = 'lighter';          // 亮斑:疊多團白斑 → 濃度不均的雲
    for (let i = 0; i < 60; i++) {
      const bx = S / 2 + (Math.random() - 0.5) * S * 0.46, by = S / 2 + (Math.random() - 0.5) * S * 0.46;
      const br = S * (0.06 + Math.random() * 0.22);
      const g = c.createRadialGradient(bx, by, 0, bx, by, br);
      g.addColorStop(0, `rgba(255,255,255,${0.08 + Math.random() * 0.1})`); g.addColorStop(1, 'rgba(255,255,255,0)');
      c.fillStyle = g; c.beginPath(); c.arc(bx, by, br, 0, 7); c.fill();
    }
    c.globalCompositeOperation = 'destination-out';  // 暗紋:挖掉小塊 → 翻騰的立體暗部(fBm 近似)
    for (let i = 0; i < 34; i++) {
      const bx = S / 2 + (Math.random() - 0.5) * S * 0.5, by = S / 2 + (Math.random() - 0.5) * S * 0.5;
      const br = S * (0.03 + Math.random() * 0.1);
      const g = c.createRadialGradient(bx, by, 0, bx, by, br);
      g.addColorStop(0, `rgba(0,0,0,${0.12 + Math.random() * 0.16})`); g.addColorStop(1, 'rgba(0,0,0,0)');
      c.fillStyle = g; c.beginPath(); c.arc(bx, by, br, 0, 7); c.fill();
    }
    c.globalCompositeOperation = 'destination-in';   // 圓形遮罩:邊緣淡出
    const m = c.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S / 2);
    m.addColorStop(0, 'rgba(0,0,0,1)'); m.addColorStop(0.66, 'rgba(0,0,0,1)'); m.addColorStop(1, 'rgba(0,0,0,0)');
    c.fillStyle = m; c.fillRect(0, 0, S, S);
    const t = finishTex(new THREE.CanvasTexture(cv), { stream: false });
    this._smokeTexC = t; return t;
  }

  /** 火星/餘燼(加法小亮點,上升飄散淡出):替殉爆火煙補細節顆粒感。n 顆一批(池化 sprite + 共用 fade,逐顆不配物件)。 */
  _emberBurst(x, y, z, n = 8, spread = 2) {
    for (let i = 0; i < n; i++) {
      const sp = this._takeSprite(true,
        x + (Math.random() - 0.5) * spread, y + (Math.random() - 0.5) * spread, z + (Math.random() - 0.5) * spread,
        0.35 + Math.random() * 0.5, Math.random() < 0.5 ? 0xffd27a : 0xff9840, 0.95);
      sp.userData.vel.set((Math.random() - 0.5) * 6, 4 + Math.random() * 8, (Math.random() - 0.5) * 6);
      sp.userData.op = 0.95;
      this._pushSpriteFx(sp, 0.7 + Math.random() * 0.6, _spriteGravFade);
    }
  }

  /** 殉爆火煙柱(~2s):噴發火(加法橙)+ 煙(灰上升),沿飛彈煙尾 idiom;地面路徑起始演出。
   *  改用池化柔邊 sprite billboard(徑向漸層貼圖):恆面向相機、無 facet,共用 _spriteDriftFade 零新配置。 */
  _deathPlume(x, y, z) {
    const NF = 22, NS = 18;
    for (let i = 0; i < NF + NS; i++) {
      const fire = i < NF;
      const th = Math.random() * Math.PI * 2, rad = Math.random() * 3;
      const base = fire ? 3.0 + Math.random() * 2 : 5 + Math.random() * 3;
      const op = fire ? 0.95 : 0.62;
      const sp = this._takeSprite(fire,
        x + Math.cos(th) * rad, y + Math.random() * 2, z + Math.sin(th) * rad,
        base, fire ? (Math.random() < 0.5 ? 0xff8a3a : 0xffd166) : 0x4a4e52, op);
      sp.userData.vel.set(
        (Math.random() - 0.5) * 2,
        fire ? 4 + Math.random() * 4 : 7 + Math.random() * 6,
        (Math.random() - 0.5) * 2,
      );
      sp.userData.base = base;
      sp.userData.grow = base * (fire ? 1.8 : 3.2);
      sp.userData.op = op;
      sp.userData.delay = fire ? 0 : Math.random() * 0.5;
      if (sp.userData.delay > 0) sp.visible = false;
      this._pushSpriteFx(sp, 2.0, _spriteDriftFade);
    }
    this._emberBurst(x, y + 1, z, 14, 4);   // 起始迸射一批火星補顆粒細節
  }

  /** 單顆上升灰煙(墜機拖尾 / 觸地煙,單一縫共用);scale 控大小。柔邊 sprite,恆面向相機、無 facet(池化)。 */
  _crashSmoke(x, y, z, scale = 1) {
    const base = 3.4 * scale;
    const sp = this._takeSprite(false,
      x + (Math.random() - 0.5) * 2, y, z + (Math.random() - 0.5) * 2, base, 0x484c50, 0.6);
    sp.userData.vel.set(0, 5 + Math.random() * 4, 0);
    sp.userData.base = base;
    sp.userData.grow = base * 2.2;
    sp.userData.op = 0.6;
    this._pushSpriteFx(sp, 1.1, _spriteDriftFade);
  }

  /**
   * 遊戲最高高度(**絕對**高程;2026-08-08 使用者定案)—— 客戶端的唯一取值處。
   * 公式住 `data.js worldCeilY`(= max(平均海拔 + 4 倍砲塔高, 最高海拔 + 2.5 倍砲塔高)),
   * 本支只負責把這張圖的高程統計餵進去並快取:兩個輸入都是**整張地形一次算完**的常數
   * (terrain.avgH / maxH),逐幀重取只是浪費,但更重要的是「一場只有一個天花板」——
   * 逐處各自去讀地形統計就是第二份實作,而它壞掉的樣子只是「有些地方飛得比較高」。
   * 取不到地形統計(程序生成備援)一律回 Infinity = 不設限(原則 6 降級不例外)。
   */
  _ceilY() {
    if (this._worldCeil == null) {
      const t = this.terrain;
      this._worldCeil = (t && Number.isFinite(t.maxH))
        ? worldCeilY(Number.isFinite(t.avgH) ? t.avgH : t.maxH, t.maxH) : Infinity;
    }
    return this._worldCeil;
  }

  /**
   * 高度曲線的起算點(**絕對**高程;2026-09-30 使用者需求)—— 有海面吃海面(`terrain.waterY`,
   * 無水域 = null),否則吃全圖地形最低點(`terrain.minH`)。與 `_ceilY` 不同,這裡**不快取**:
   * 潮汐會動海面(`updateTide`),快取等於把起點凍在第一幀。取不到一律回 null ⇒ `liftAltF`
   * 降級回 1(原則 6)。`_stepLift` 爬升扣 + 下降回充兩處同吃這一支。
   */
  _liftBaseY() {
    const t = this.terrain;
    if (t && Number.isFinite(t.waterY)) return t.waterY;
    if (t && Number.isFinite(t.minH)) return t.minH;
    return null;
  }

  // ---------------- 飛行動力學(2026-07-30;唯一縫 data.js FLIGHT)----------------
  /** 爬升動力上限(全機體共用固定值 FLIGHT.LIFT_MAX) */
  _liftMax() { return liftMax(); }

  /** 飛行機體是否處於受擊失衡狀態?(2026-09-01 使用者需求:跌落到穩住期間進入失衡,命中/暴擊減半,無法恢復動力) */
  _unbalanced(now) {
    if (!this._flying() || this.dead) return false;
    if (this.isDrone && (this._altAG || 0) < TARGET_H.tower) return false;   // 無人機低空飛行(離地低於砲塔高)不失衡(與伺服器 _stampUnbal 同判)
    const t = now ?? (typeof performance !== 'undefined' ? performance.now() / 1000 : 0);
    return (this._airSink > 0) || (t < (this._liftLockUntil || 0)) || ((this.unbalLeft || 0) > 0);
  }

  /**
   * 爬升動力條:往上飛消耗、其餘時間回充。**唯一消費點** —— target.y > 0 才扣,扣速 ∝ 爬升率
   * (全速 = liftDrainPS ⇒ 滿動力撐 FLIGHT.DRAIN_S 秒);動力見底把上升分量歸零(= 爬不上去,
   * 不是變慢),水平/下降/懸停不受影響。回速為固定值(liftRegen)。
   * 正常操作下降高度時會回充 2/3 的電力(liftDescentPS ∝ 下降率,2026-09-11 使用者需求)。
   * 高度越高同速爬升越耗動力、同速下降回充也越多(× 同一條高度曲線 liftAltF,連續無階梯)。
   */
  _stepLift(dt, now, target, u) {
    const lMax = this._liftMax();
    if (this.lift == null || this.lift > lMax) this.lift = lMax;   // 首幀 → 夾回統一上限
    const upV = Math.max(1e-6, u?.vspeed || 0);                   // 上升全速(變形者 = 無人機 × MORPH.UP_F)
    const dnV = Math.max(1e-6, u?.vdown ?? u?.vspeed ?? 0);        // 下降全速(變形者 = 無人機 × MORPH.DOWN_F)
    if (target.y > 0) {
      if (this.lift <= 0) {
        target.y = 0;                                  // 動力耗盡:爬不上去(仍可懸停/下降/平飛)
        if (now - (this._liftWarnAt || 0) > 3) {
          this._liftWarnAt = now;
          this.hud.feed?.('🪫 爬升動力耗盡:無法繼續上升(降低高度或稍候回充)');
        }
      } else {
        this.lift = Math.max(0, this.lift
          - liftDrainPS() * liftAltF(this.pos.y, this._liftBaseY(), this._ceilY()) * Math.min(1, target.y / upV) * dt);
      }
    } else {
      // 受擊失衡期間禁止回充(2026-09-01 使用者需求:失衡時無法恢復飛行動力)
      if (!this._unbalanced(now)) {
        const wet = this._env?.code || 0;
        const descF = target.y < 0 ? Math.min(1, -target.y / dnV) : 0;
        // 下降回充吃同一條高度曲線:高處爬升貴、同高下降回得也多 ⇒ 2/3 比例在任何高度都成立
        const descRecharge = liftDescentPS() * liftAltF(this.pos.y, this._liftBaseY(), this._ceilY()) * descF;
        this.lift = Math.min(lMax, this.lift
          + (liftRegen() + descRecharge) * fluidFactor(wet) * dt);
      }
    }
  }

  /**
   * 受擊掉高入帳(飛行機體限定):掉的總公尺數 ∝ 該次傷害(airSinkM 推導,MUST NOT 在此手寫係數)。
   * 只記帳不直接改高度 —— 8Hz 快照一次入帳的傷害若直接扣 y,畫面上是瞬移;
   * 逐幀以「待落總量 / FLIGHT.SINK_S」的速率消化 ⇒ **總掉幅只由傷害決定**,SINK_S 只管節奏。
   * 飛行受擊下降時設定鎖定窗 FLIGHT.HIT_LOCK_S(此期間無法恢復飛行動力)。
   * 掉高歸類於失衡效果:無人機低空飛行(離地低於砲塔高)不失衡 ⇒ 也不掉高、不鎖動力
   * (與 _unbalanced / 伺服器 _stampUnbal + _botAirSink 同判)。
   */
  _airSinkHit(dmg, now) {
    if (!this._flying() || !(dmg > 0)) return;
    if (this.isDrone && (this._altAG || 0) < TARGET_H.tower) return;
    this._airSink = (this._airSink || 0) + airSinkM(dmg);
    this._airSinkV = this._airSink / FLIGHT.SINK_S;
    const t = now ?? (typeof performance !== 'undefined' ? performance.now() / 1000 : 0);
    const defF = (this.defending && (this.sp || 0) > 0) ? SHIELD_DEFENSE.FLIGHT_UNBAL_DIRECT_F : 1;
    this._liftLockUntil = Math.max(this._liftLockUntil || 0, t + FLIGHT.HIT_LOCK_S * defF);
  }

  // ---------------- 玩家移動 ----------------
  _updatePlayer(dt, now) {
    if (!this.side) { this._updateSpectator(dt); return; }
    if (this.dead) return;
    if (this.defending && (this.sp || 0) <= 0) this._toggleDefense(false);
    this._env = this._envAt();   // 當幀環境(水/沼):移動減速、pos 回報、狀態結算(伺服器)皆讀它
    this._updateEnvFog(dt);      // 火場滯留 → 視野漸霧化(純客戶端表現)
    this._updateWeatherFog();    // 天氣濃霧 → 全屏霧罩 + 狙擊鏡圈等比縮(純客戶端表現;視野縮減由伺服器結算)
    this._updateBlood(dt);       // 受擊濺血 → 依方位噴在座艙玻璃上後漸淡(純客戶端表現)
    this._updateGlint(dt);       // 舉盾受擊螢光閃光 → 原血滴位置短閃快退(純客戶端表現)
    // 結構物硬碰撞的參考狀態:位移前的座標與「是否在地下道內」(隧道側壁判定要以移動前為準)。
    // open 段(地下道引道露天路塹)**刻意不濾**:側壁閘(單步高差 + tunnelWallCross 幾何牆線)
    // 正是「溝底不能爬牆側出、出入口只在道路兩端」的物理 —— 這是 open 段唯二的消費端之一
    //(另一個是 surfaceAt 站立捕捉);lev/彈道/天花那幾路才要濾 !open。
    const px0 = this.pos.x, pz0 = this.pos.z, py0 = this.pos.y;
    const tn0 = this.terrain.tunnelAt?.(px0, pz0);
    const inTun0 = !!(tn0 && py0 < tn0.ceil);
    const u = UNITS[this.heroKind];
    const fwd = _TMP_A.set(-Math.sin(this.yaw), 0, -Math.cos(this.yaw));
    const right = _TMP_B.set(-fwd.z, 0, fwd.x);
    // 移動軸一律經 _moveAxis(鍵盤 ±1 / 觸控類比共用);對角線鍵盤輸入 mag=√2 → 夾回 1(與舊版 normalize 等價)
    const ax = this._moveAxis();
    const boost = ax.boost ? 1.35 : 1;
    const move = _TMP_C.set(0, 0, 0).addScaledVector(fwd, ax.f).addScaledVector(right, ax.r);
    if (ax.mag > 1) move.multiplyScalar(1 / ax.mag);
    this._stepThirdPersonBody(dt, move);

    // 攀爬(長梯/攀岩抓點/垂降技術繩)接管:掛在梯上時不吃重力、不吃地面加速,其餘(結構物硬碰撞 /
    // 天花 / _collide / 邊界 / 回報)照走下方共用路徑 —— MUST NOT 為攀爬另開一條位置回報。
    const climbing = this._stepClimb(dt, now, move, ax, u);

    if (climbing) {
      // 攀爬中:位移已由 _stepClimb 定案(垂直沿路線、水平吸附到攀爬軸)
    } else if (this._flying()) {
      // FPV 3D 操作:2D 按鍵(W/S)預設沿「視線方向」飛 — 抬頭爬升、低頭俯衝;
      // 開啟「水平移動鎖定」(movePrefs.js levelMove)時只走水平面、不改變上下方向,
      // 上下改由 Space/C 控制。A/D 恆為水平橫移;Space/C 純垂直(懸停微調)。變形者飛行型態用 fly 巡航速度。
      const spd = this._mobility(true);   // 飛行巡航(變形者取 fly);唯一取速處,見 _mobility
      const level = movePref('levelMove');
      const look = _TMP_D.set(
        -Math.sin(this.yaw) * (level ? 1 : Math.cos(this.pitch)),
        level ? 0 : Math.sin(this.pitch),
        -Math.cos(this.yaw) * (level ? 1 : Math.cos(this.pitch)),
      );
      // look 與 right 互為正交單位向量 ⇒ target 長度 = 推杆量;>1(鍵盤對角線)才夾回 1
      const target = _TMP_E.set(0, 0, 0).addScaledVector(look, ax.f).addScaledVector(right, ax.r);
      // 控場:垂直升降同樣折速(麻痺 = 禁移動含爬升/下降,否則被暈仍可垂直脫離)
      const ccF = this._ccMoveF();
      const tmag = target.length();
      const tSlow = this._terrainSlowF();
      let windMul = 1;
      const dyn = this.env?.getWeatherDynamics?.();
      if (dyn && dyn.wind > WEATHER_DEBUFFS.THRESHOLD && (target.x !== 0 || target.z !== 0)) {
        windMul = windSpeedFactor(target.x, target.z, dyn.windDir, dyn.wind);
      }
      if (tmag > 0) target.multiplyScalar(spd * boost * this._recoilMoveF(true)
        * ccF * this._modF('speed') * tSlow * windMul / Math.max(1, tmag));
      // 混亂(招式追加效果):水平操縱反轉 + 慢速航向漂移(垂直升降不反轉,免得直接砸地)
      if ((this.confLeft || 0) > 0) { target.x *= -1; target.z *= -1; this.yaw += Math.sin(now * 2.7) * 0.5 * dt; }
      // 無人機完美迴避(2026-07-21):戰鬥狀態(近 COMBAT_S 秒攻擊或被攻擊)下按空白鍵飛行 →
      //   向上飛的同時 1s 無敵,30s CD。空白鍵上升邊觸發(避免每幀連發);伺服器 heroIframe 為 CD/免傷權威。
      if (this.isDrone) {
        if (this.keys.Space && !this._spaceWas) {
          const inCombat = now - Math.max(this.lastFireAt.light || 0, this.lastFireAt.heavy || 0) < IFRAME.COMBAT_S
            || now - (this._lastHurtAt || 0) < IFRAME.COMBAT_S;
          if (inCombat && now >= (this._dodgeCd || 0)) this._perfectDodge(u, now);
          else if (inCombat) this.hud.feed?.(`🛡️ 完美迴避冷卻中(${Math.ceil((this._dodgeCd || 0) - now)}s)`);
        }
        this._spaceWas = this.keys.Space;
      }
      if (this.keys.Space) target.y += u.vspeed * ccF * tSlow;
      if (this.keys.KeyC || this.keys.ControlLeft) target.y -= (u.vdown ?? u.vspeed) * ccF * tSlow;
      // 爬升動力(2026-07-30 使用者需求;唯一縫 data.js FLIGHT):**往上飛才耗動力** ——
      // 耗速/回充 ∝ (爬升率/下降率) × 高度曲線(起點全速爬升 = liftDrainPS × 1 ⇒ 起點滿動力恰好撐 FLIGHT.DRAIN_S 秒),
      // 見底 = 爬不上去(上升分量歸零,水平/下降/懸停完全不受影響)。上限/回速全機固定(FLIGHT.LIFT_MAX/REGEN_PS),
      // 升降速率上限見 UNITS(變形者 vdown ≠ vspeed)⇒ MUST NOT 在此手寫係數。
      this._stepLift(dt, now, target, u);
      this.vel.x += (target.x - this.vel.x) * lerpFPS(4, dt);
      this.vel.z += (target.z - this.vel.z) * lerpFPS(4, dt);
      this.vel.y += (target.y - this.vel.y) * lerpFPS(4, dt);
      this.pos.addScaledVector(this.vel, dt);
      // 受擊掉高(2026-07-30 使用者需求):待落公尺數逐幀消化 —— 總掉幅 ∝ 傷害(airSinkM,
      // 於快照偵測到掉血時入帳,見 _airSinkHit),SINK_S 只決定「掉多快」不改總量。
      if (this._airSink > 0) {
        const d = Math.min(this._airSink, this._airSinkV * dt);
        this.pos.y -= d;
        this._airSink -= d;
      }
      // 飛行體受擊下降/落下時遇到高架橋等結構面(2026-09-01 使用者需求:落下遇到高架橋等物件要遵守碰撞機制,不會穿越到橋下)
      // 以位移前高度 py0 與當前高度取較高者查詢表面,確保從上方落下時在橋面/頂板擋住,不穿越至橋下
      const gyS = this._surf(this.pos.x, this.pos.z, Math.max(py0, this.pos.y));
      // 飛行體(無人機/變形者)飛行基準面為實際地表/結構面 gyS,可沉入水面/沼面下飛行
      const gy = gyS;
      const hoverY = gy + (this.isMorph ? 0 : FLIGHT.HOVER_M);
      if (this.pos.y <= hoverY) {
        this.pos.y = hoverY;
        this._airSink = 0;              // 落下接觸到地表/橋面結構,停止掉高
        if (this.vel.y < 0) this.vel.y = 0;
      }
      // 無人機不貼地(下限 +HOVER_M);變形者允許降到地表 → 觸地即變形回地面型。
      // 上限兩道取嚴者:①離站立面 3 個砲塔高(2026-10-06 使用者定案的飛行高度上限;
      // 唯一縫 data.js FLIGHT.ALT_TOP_F,與爬升指數曲線的封頂同一個數,防止在深谷上空一路飛出大氣層)
      // ②**遊戲最高高度**(2026-08-08 使用者定案的絕對天花板,見 `_ceilY`)。
      // 兩者問的是不同的問題(「離腳下多高」vs「離海平面多高」)⇒ 刻意都留著;
      // 位置本就客戶端權威(同 FLIGHT 全族)⇒ 伺服器不再驗一次(A1 的另一半:
      // 真人那半住客戶端物理,bot 那半見 `_ceilY` 檔頭與稽核 Ⅴ)。
      this.pos.y = Math.max(hoverY,
        Math.min(gy + TARGET_H.tower * FLIGHT.ALT_TOP_F, this._ceilY(), this.pos.y));
      // 變形者下降觸地著陸變形(進入水域/沼澤可著陸於水底/沼底地表)
      if (this.isMorph && (this.vel.y <= 0) && this.pos.y <= gy + MORPH.LAND_M) this._morphLand(gy);
      // FPV 側傾:橫移/轉向時機身壓坡度
      const lat = this.vel.x * right.x + this.vel.z * right.z;
      this.roll += (-lat / spd * 0.16 - this.roll) * lerpFPS(5, dt);
    } else {
      this._airSink = 0;   // 地面型態不掉高(變形者觸地即清帳,免落地後被舊帳往下拉)
      // 機甲:貼地 + 跳躍;this.vel 是爆炸/後座的擊退速度(地面摩擦快速衰減)
      // 蓄力中重心下沉、移動減速(起跳預備動作;morph 變形彈射與 robot 蓄力跳共用 this.charge)
      const slowK = 1 - 0.6 * this.charge;
      // 混亂(招式追加效果):操縱反轉 + 慢速航向漂移
      if ((this.confLeft || 0) > 0) { move.multiplyScalar(-1); this.yaw += Math.sin(now * 2.7) * 0.5 * dt; }
      // 蓄力跳騰空(_lowG)期間水平操縱移速 × CJUMP.AIR_SPD_F(與起跳彈射初速同一個縫)
      const airK = this._lowG ? CJUMP.AIR_SPD_F : 1;
      // 地形坡度:上坡減速 / 下坡加速(平緩帶 = 兵線坡度限制內恆 1;騰空與人造鋪面回 1)
      const slopeF = this._slopeMoveF(move);
      let windMul = 1;
      const dyn = this.env?.getWeatherDynamics?.();
      if (dyn && dyn.wind > WEATHER_DEBUFFS.THRESHOLD && (move.x !== 0 || move.z !== 0)) {
        windMul = windSpeedFactor(move.x, move.z, dyn.windDir, dyn.wind);
      }
      this.pos.addScaledVector(move, this._mobility(false) * boost * this._zoneSlow() * slowK * this._terrainSlowF()
        * slopeF * this._recoilMoveF(false) * this._ccMoveF() * this._modF('speed') * windMul * airK * dt);
      this.pos.x += this.vel.x * dt;
      this.pos.z += this.vel.z * dt;
      // 蓄力跳騰空(_lowG):水平近乎無阻力滑行(太空漫步的慣性);觸地恢復地面摩擦
      const fr = frictionFPS(this._lowG ? 0.8 : 6, dt);
      this.vel.x *= fr; this.vel.z *= fr; this.vel.y = 0;
      const gyS = this._surf(this.pos.x, this.pos.z, this.pos.y);
      // 地面站立面:機體進入水域/沼澤踩至地底(河床/湖底/沼底 gyS),不卡在水面或 FULL_D 浮層
      const gy = gyS;
      this.vy = this.vy ?? 0;
      // 觸地判定 MUST 吃「本幀地表在腳下掉了多少」(下坡步進落差)——
      // 走下坡時水平位移先發生、pos.y 仍留在上一幀高度,固定 0.05 容差會讓每一幀都判成騰空:
      // 蓄力/變形彈射整組失效(charge 甚至在 else 分支被清零)。落差只來自地形(兩端同吃 _surf),
      // 且只在 vy ≤ 0(沒有正在往上跳)時放行 ⇒ 真正的跳躍上升段不受影響。
      const stepDrop = Math.max(0, this._surf(px0, pz0, py0) - gyS);
      const onGround = this.pos.y <= gy + 0.05
        || (this.vy <= 0 && this.pos.y <= gy + stepDrop + 0.05);
      // 下坡貼地(2026-08-03 使用者回報「偏陡的斜坡移動時累積蓄力會中斷」):上面那道容差只擋得住
      // 一幀 —— 坡一陡,地表每幀掉的比自由落體同時間掉的還多,離地量逐幀累加,兩三幀後 onGround
      // 轉偽,蓄力被當成騰空在 else 分支清零。判定既然已經說「在地面上」,位置就 MUST 跟著吸回
      // 地面並歸零 vy,離地量才不會累積(只判不吸 = 判定與物理分家)。上界走 slopeBlocked 同一把
      // 尺(slopeSnapM ← 阻擋角):走得上去的坡才貼地 ⇒ 斷崖/跳台那種單步落差仍照舊彈飛。
      // 跳躍上升段(vy > 0)與蓄力跳騰空(_lowG 太空漫步)一律不吸。
      if (onGround && !this._lowG && this.vy <= 0 && this.pos.y > gy
          && this.pos.y - gy <= slopeSnapM(Math.hypot(this.pos.x - px0, this.pos.z - pz0))) {
        this.pos.y = gy; this.vy = 0;
      }
      // 麻痺 = 禁移動:蓄力/起跳/變形彈射一併封鎖(已騰空的物理慣性不受影響)
      if ((this.stunLeft || 0) > 0) {
        this.charge = 0;
      } else if (this.isMorph) {
        // 蓄力彈射:按住 Space 蓄力 → 放開時蓄力足夠且動力足夠即彈射變形為飛行型,否則只是小跳(無 CD,改吃動力)
        if (onGround && this.keys.Space) {
          this.charge = Math.min(1, this.charge + dt / MORPH.CHARGE_S);
        } else if (this.charge > 0) {
          const k = this.charge;
          const free = this.defending && (this.defJumpUntil || 0) > now;   // 防守大跳窗:免動力追加次數
          const cost = free ? 0 : morphLiftCost(k);
          const curLift = this.lift ?? this._liftMax();
          if (onGround && k >= MORPH.JUMP_MIN && (free || curLift >= cost)) {
            if (!free) { this.lift = Math.max(0, curLift - cost); this.net?.send({ t: 'jump', k, morph: true }); }
            this._morphLaunch(gy);
          } else if (onGround) {
            if (k >= MORPH.JUMP_MIN) this.hud.feed?.(`🪫 動力不足(變形起飛需 ${cost} 動力)`);
            this.vy = u.jump * this._modF('jump'); this.charge = 0;
          } else this.charge = 0;
        }
      } else if (onGround && this.keys.Space) {
        // 機甲蓄力跳躍(2026-07-16,CJUMP;robot 限定):長按 Space 蓄力 → 放開彈射高跳,
        // 騰空低重力 = 太空漫步;蓄力不足 = 普通小跳。與 morph 共用 this.charge(下蹲/減速一致)。
        this.charge = Math.min(1, this.charge + dt / CJUMP.CHARGE_S);
      } else if (!this.isMorph && this.charge > 0) {
        const k = this.charge;
        const free = this.defending && (this.defJumpUntil || 0) > now;   // 防守大跳窗:免動力追加次數
        const cost = free ? 0 : cjumpLiftCost(k);
        const curLift = this.lift ?? this._liftMax();
        if (onGround && k >= CJUMP.MIN && (free || curLift >= cost)) {
          if (!free) { this.lift = Math.max(0, curLift - cost); this.net?.send({ t: 'jump', k }); }
          this._chargeJump();
        } else if (onGround && k >= CJUMP.MIN) {
          this.vy = u.jump * this._modF('jump');
          this.hud.feed?.(`🪫 動力不足(蓄力跳躍需 ${cost} 動力)`);
        } else if (onGround) this.vy = u.jump * this._modF('jump');
        this.charge = 0;
      }
      // 地面機體動力回充(爬升 target.y = 0 ⇒ _stepLift 只做回充,不扣動力)
      this._stepLift(dt, now, { y: 0 }, u);
      // 蓄力跳騰空吃低重力(月面滯空);無敵幀已於起跳離地(_chargeJump / _morphLaunch)請求
      this.vy -= AIR.GRAV * (this._lowG ? CJUMP.GRAV_F : 1) * dt;
      this.pos.y += this.vy * dt;
      if (this.pos.y < gy) { this.pos.y = gy; this.vy = 0; this._lowG = false; }
      this.roll += (0 - this.roll) * lerpFPS(6, dt);
    }

    // 結構物硬碰撞(高架橋/地下道):機體與橋體/山體不可重疊 ——
    //  ①隧道側壁:洞內只能沿路面走到洞口。側向跨出走廊時 surfaceAt 會瞬移到上方山體
    //    (表面高度躍升 >2.6m)= 穿牆,一律擋下。
    //  ①' 地下道幾何側壁(2026-07-29):引道垂直路塹被高度場網格(格距 ~8.2m)雙線性攤成
    //    每步 ≤0.6m 的緩坡,①的單步高差在洞口內側永不觸發(澀谷殘餘破口的機制)——
    //    改由 tunnelWallCross 幾何判定:步進跨出 ±hw 牆線且擋土牆頂高出腳下逾可跨步高
    //    即擋(唯一縫 makeTunnelIndex;山體隧道無 by 恆放行,行為不變)。
    //  ②淨空不足:天花(橋面底緣/隧道天花板)與地面的夾縫塞不下機高 → 進不去(引道漸低段)。
    //  ③陡坡(2026-07-30 使用者需求):上坡坡度超過 SLOPE.BLOCK_DEG 的裸地形爬不上去 ——
    //    逐軸滑行順勢成了「沿等高線橫走」,只是上不去;下坡與騰空一律放行(見 _slopeDegAlong)。
    // 撞牆時逐軸嘗試滑行(沿牆保留另一軸位移),都不行才整步還原;
    // 位移前的位置若本來就違規(例外狀態)則放行,避免卡死。
    // 閘門條件由 ceilingAt 放寬成 heightAt(裸地形恆有):橋隧判定各自 optional,
    // 沒有橋隧的地圖照樣要吃坡度③。
    if (this.terrain.heightAt) {
      const hover = this._flying() ? (this.isMorph ? 0 : FLIGHT.HOVER_M) : 0;
      let slopeStop = false;
      const passable = (cx, cz) => {
        const g = this._surf(cx, cz, py0);
        if (inTun0 && g > py0 + 2.6) return false;                        // 隧道側壁/上方山體
        if (this.terrain.tunnelWallCross?.(px0, pz0, cx, cz, py0)) return false;   // 地下道幾何側壁
        // 2026-07-19:深水不再是牆 —— 水域/沼澤可通行,依深度減速(_terrainSlowF),
        // 有效地板 = 水面 − FULL_D(可涉水橫渡河湖)。深水不再由此擋下。
        const ce = this.terrain.ceilingAt?.(cx, cz, py0);
        if (ce != null && ce - this.selfH - 0.2 < g + hover) return false; // 夾縫 < 機高
        if (!this._flying() && g > Math.max(this.pos.y, py0) + 1.2) return false; // 垂直峭壁高於跳躍淨空
        // 攀爬中豁免:掛在梯/抓點上的位移是「沿路線垂直 + 水平吸附到攀爬軸」,那一小段水平位移
        // 配上峭壁高差必然超標 —— 擋下來會連同 y 一起還原(見下方撞牆幀),等於整套攀爬失效。
        // 陡壁的垂直通道本來就是攀爬路線在提供(A31),兩者 MUST NOT 互相否決。
        if (!climbing && slopeBlocked(this._slopeDegAlong(px0, pz0, py0, cx - px0, cz - pz0))) { slopeStop = true; return false; }
        return true;
      };
      if (!passable(this.pos.x, this.pos.z) && passable(px0, pz0)) {
        let cx = px0, cz = pz0;
        for (const [tx, tz] of [[this.pos.x, pz0], [px0, this.pos.z]]) {
          if (passable(tx, tz)) { cx = tx; cz = tz; break; }
        }
        this.pos.x = cx; this.pos.z = cz;
        this.vel.x = 0; this.vel.z = 0;
        // 撞牆幀的高度 MUST 一併還原上限:位移分支已先用「牆外的 gy」把機體吸上山
        // (貼坡吸附),只還原 x/z 會留下被抬高的 y → 下一幀 py0 > ceil = 誤判已在山上,
        // 側壁規則就此解除(實測就是這樣穿牆的)。
        this.pos.y = Math.min(this.pos.y, py0);
        const gy2 = this._surf(cx, cz, py0);
        if (this._flying()) this.pos.y = Math.max(gy2 + hover, Math.min(gy2 + TARGET_H.tower * FLIGHT.ALT_TOP_F, this.pos.y));
        else if (this.pos.y < gy2) { this.pos.y = gy2; this.vy = 0; }
      }
      // 陡坡完全擋死(逐軸滑行也走不動)才提示:沿等高線橫走仍通 = 不算撞坡,別洗頻道
      if (slopeStop && this.pos.x === px0 && this.pos.z === pz0 && now - this._slopeWarnAt > 8) {
        this._slopeWarnAt = now;
        this.hud.feed?.('⛰️ 坡度過陡:機甲爬不上去(向前跳躍或找攀爬路線)');
      }
    }

    // 天花碰撞:地下道天花板 / 高架橋底緣 —— 頭頂(pos.y + 機高)不得穿過。ceilingAt 只在「人在其下方」時回值,
    // 站上方地表 / 橋面時回 null → 不受影響(上方照常通行)。
    // 查詢高度取 min(位移前, 位移後):蓄力跳/大 dt 單幀跨越天花時,位移後 y 已在天花之上,
    // 事後查詢回 null = 誤判已在上層 → 直接站上山頂穿模;以位移前高度評估即無此洞。
    const ceil = this.terrain.ceilingAt?.(this.pos.x, this.pos.z, Math.min(py0, this.pos.y));
    if (ceil != null) {
      const cap = ceil - this.selfH - 0.2;   // 頭頂留餘裕,機高由角色動態推導(最大機甲亦保證淨空)
      if (this.pos.y > cap) {
        this.pos.y = cap;
        if (this.vy > 0) this.vy = 0;
        if (this.vel?.y > 0) this.vel.y = 0;
      }
    }

    // 碰撞:不能穿過單位 / 塔 / 主堡 / 建物 / 神木 / 巨岩(px0,pz0 = 本幀位移起點,供掃掠防穿透)
    this._collide(px0, pz0);

    // 邊界(= 障礙環內緣;唯一縫 `data.js edgeWallInsetM()`,環體佈置與封路障礙同吃這一支)。
    // 這道夾制**與高度無關** ⇒ 它才是「緩衝空間不可進入」的權威:障礙環只有 `edgeWallHM()` 高,
    // 飛行機體翻得過環頂,但翻過去照樣被這兩行擋在同一條線上(見 data.js WORLD_EDGE 檔頭)。
    // 地面那一半反過來:環體在夾制線**之外**且與夾制線齊平 ⇒ 機體恆先撞到環、這兩行永遠用不到。
    const eIn = edgeWallInsetM();
    this.pos.x = Math.max(this.terrain.minX + eIn, Math.min(this.terrain.maxX - eIn, this.pos.x));
    this.pos.z = Math.max(this.terrain.minZ + eIn, Math.min(this.terrain.maxZ - eIn, this.pos.z));

    // 後座力回復 + 鏡頭震動(trauma² 噪聲)
    // 回穩速率 = RECOIL.DECAY(唯一縫):位移懲罰的時間窗 `_recoiling()` 量的正是這條衰減曲線,
    // 在這裡手寫一個數字 = 兩邊分家(改了回穩快慢,懲罰時長卻不動,而畫面上完全看不出來)。
    const rk = frictionFPS(RECOIL.DECAY, dt);
    this.recoil.p *= rk; this.recoil.y *= rk;
    this.trauma = Math.max(0, this.trauma - dt * 1.4);
    const n = this.trauma * this.trauma;
    const shP = (Math.random() * 2 - 1) * n * 0.045;
    const shY = (Math.random() * 2 - 1) * n * 0.045;
    const shR = (Math.random() * 2 - 1) * n * 0.05;

    // 視野鎖定(觸控 ZR 按住):MUST 排在下面的相機合成**之前** —— 它改的是基準角 yaw/pitch,
    // 晚一步就要等下一幀才看得到,鎖定會慢半拍。後座力/震動仍疊在合成那一行(刻意不抵銷)。
    this._tickViewLock(dt, now);

    // 座艙眼位高程(唯一縫:FPV 視點與 10Hz 位置回報的 ay 絕對視線高程共用同一式)
    const eye = this._eyeH();

    // 視角模式:第一人稱(fpv) vs 第三人稱(tps)
    if (this.viewMode === 'tps') {
      if (this.cockpit && this.cockpit.visible) this.cockpit.visible = false;
      const h = this.selfH;
      const dist = Math.max(PLAYER_TPS.MIN_DIST, h * PLAYER_TPS.DIST_F);
      const fwd = _TMP_A.set(-Math.sin(this.yaw), 0, -Math.cos(this.yaw));
      const right = _TMP_B.set(-fwd.z, 0, fwd.x);
      const cp = Math.cos(this.pitch);
      const viewDir = _TMP_C.set(
        fwd.x * cp, Math.sin(this.pitch), fwd.z * cp,
      );
      this.camera.position.copy(this.pos)
        .addScaledVector(fwd, -dist * cp)
        .addScaledVector(right, h * PLAYER_TPS.SHOULDER_F);
      this.camera.position.y += h * PLAYER_TPS.HEIGHT_F - Math.sin(this.pitch) * dist;
      const floor = this._surf(this.camera.position.x, this.camera.position.z, this.camera.position.y)
        + PLAYER_TPS.FLOOR_M;
      if (this.camera.position.y < floor) this.camera.position.y = floor;
      this.camera.lookAt(_TMP_D.copy(this.camera.position).addScaledVector(viewDir, PLAYER_TPS.AIM_DISTANCE_M));
      this.camera.rotateY(this.recoil.y + shY);
      this.camera.rotateX(this.recoil.p + shP);
      this.camera.rotateZ(this.roll + shR);
      this._cameraDeClip();   // 鏡頭防穿模:退回障礙外緣,不看穿建物/神木/巨岩
    } else {
      // 座艙視點 = 機體實高 × heroView(依機體形狀的頭艙位置):人形在胸腔/頸根、獸型在獸首
      // (低且遠前)、飛行型在機鼻。與 models.js 的 heroTargetH 同一個縫,改角色護甲即連動。
      // 蓄力中重心下沉(鏡頭跟著蹲)。
      const vw = heroView(this.heroKind, this.ch, this._flying());
      const headF = this.selfH * vw.f;   // 沿正面方向前移(three:-z 為前)
      this.camera.position.set(
        this.pos.x - Math.sin(this.yaw) * headF,
        this.pos.y + eye,
        this.pos.z - Math.cos(this.yaw) * headF,
      );
      this.camera.rotation.set(0, 0, 0);
      this.camera.rotateY(this.yaw + this.recoil.y + shY);
      this.camera.rotateX(this.pitch + this.recoil.p + shP);
      this.camera.rotateZ(this.roll + shR);
      this._cameraDeClip();   // 鏡頭防穿模:貼牆時退回障礙外緣,不看穿建物/神木/巨岩
    }

    // 瞄準縮放:右鍵切換拉近視角(FOV 越小越像瞄準鏡)
    const wantFov = this.aiming ? (UNITS[this.heroKind]?.zoomFov ?? this.baseFov) : this.baseFov;
    if (Math.abs(this.camera.fov - wantFov) > 0.05) {
      this.camera.fov += (wantFov - this.camera.fov) * lerpFPS(10, dt);
      this.camera.updateProjectionMatrix();
    } else if (this.camera.fov !== wantFov) {
      this.camera.fov = wantFov;
      this.camera.updateProjectionMatrix();
    }
    if (this.viewMode === 'tps') {
      // 第三人稱構圖以腳下光環為錨點；NDC -1 是畫面底部、0 是準星所在的畫面中心。
      let ringY = null;
      for (const ent of this.ents.values()) {
        if (!ent.isSelf) continue;
        const ring = ent.mesh.children.find((child) => child.userData?.teamRing);
        if (ring) ringY = this.pos.y + ring.position.y;
        break;
      }
      if (ringY != null) {
        this.camera.updateMatrixWorld(true);
        const ringView = _TMP_A.set(this.pos.x, ringY, this.pos.z)
          .applyMatrix4(this.camera.matrixWorldInverse);
        const proj = this.camera.projectionMatrix.elements;
        const view = this.camera.matrixWorldInverse.elements;
        const targetY = PLAYER_TPS.RING_NDC_Y;
        const denom = targetY * view[9] + proj[5] * view[5];
        if (Math.abs(denom) > 1e-6) {
          const dy = (targetY * ringView.z + proj[5] * ringView.y) / denom;
          if (Number.isFinite(dy)) this.camera.position.y += dy;
        }
      }
    }
    // 位置回報(10Hz;模擬 z=北)
    if (now - this.lastPosSend > 0.1) {
      this.lastPosSend = now;
      // y = 離「站立表面」的高度(橋上算 0):伺服器的地面型/防空判定不會因為站上橋面而誤判;
      // 深水處的站立表面 = 水面 − 全滅頂深(泡在水裡的機體是地面單位,不是空中目標)
      const sy = this._surf(this.pos.x, this.pos.z, this.pos.y);
      const th = this.terrain.heightAt(this.pos.x, this.pos.z);
      const tn = this.terrain.tunnelAt?.(this.pos.x, this.pos.z);
      // open 段(地下道引道露天路塹)不是洞內:回報 lev=2 會吃 sim 的隧道隔絕(_slabSep ①
      // 「任一端 lev 2 → 洞內外互不波及」),露天溝裡的單位會變成外部爆風打不到的鬼影
      const inTun = !!(tn && !tn.open && this.pos.y < tn.ceil);
      // 所在結構層(#1 slab LOS):2 隧道內 / 1 真・橋面(deck ribbon 對得上站立面)/ 0 地面。
      // 伺服器 y 為離站立表面高(橋上/橋下皆 ≈0 無法區辨),故另回報此層供 _slabBlocked 判板體兩側。
      // 站障礙物頂(建物/神木/巨岩,2026-07-22 可站立)≠ 橋層:屋頂不是 slab ribbon,回報 lev=0,
      // 且 y 基準改「地形」—— 伺服器把障礙視為 [0,h] 圓柱,離地高回報讓射手眼位越過自身柱頂,
      // 站樓頂開火才不會被自己腳下那根 occ 柱誤判遮蔽(高度制空加成隨之生效 = 高地俯射,物理一致)。
      const dY2 = !inTun && sy > th + 1 ? this.terrain.deckY?.(this.pos.x, this.pos.z, 3.0) : null;
      const onBridge = dY2 != null && Math.abs(sy - dY2) < 0.6;
      const yRef = (!inTun && !onBridge && sy > th + 1) ? th : sy;   // 障礙物頂 → 地形基準
      const sEff = yRef;
      this._altAG = this.pos.y - sEff;   // 離基準面高度(與回報伺服器的 y 同源;高度制空 _altRangeTo 的離地框用)
      const lev = inTun ? 2 : onBridge ? 1 : 0;
      this.net.send({
        t: 'pos',
        x: Math.round(this.pos.x * 10) / 10,
        y: Math.round(this._altAG * 10) / 10,
        z: Math.round(-this.pos.z * 10) / 10,
        ry: Math.round((this.viewMode === 'tps' && !this.defending ? this.bodyYaw : this.yaw) * 100) / 100,
        rx: Math.round(this.pitch * 100) / 100,
        wet: this._env.code,   // 地形異常狀態(0 無 / 1 水 / 2 沼):伺服器結算流體沉浸減傷與電力/護盾回充減速。
                               // 完全沉浸制 + 騰空歸零(見 _envAt)⇒ 跳躍/蓄力跳躍期間回報 0 = 狀態解除
        lev,
        ay: Math.round((this.pos.y + eye) * 10) / 10,   // 絕對視線高程(地形+跳躍+飛行;高度差空戰 sim._sightY 用)
      });
    }
    // 放開開火鍵:取消磁軌/穩定蓄力(不耗彈)、連射計數歸零(下次扣扳機重新起算 N 連發)
    if (!this.firing) {
      if (this._railAt || this._steadyAt) { this._railAt = 0; this._steadyAt = 0; this.flash?.scale.setScalar(1); this._setRailCharge(false); }
      this._burstN = {};
    }
    this._tickHoldAbility(now);    // 長按右鍵 → 機種專屬能力(一般/狙擊模式皆可;在 _tryFire 之前判定手勢)
    this._tryFire(now);
    this._tickLock(now);
    this._stepSelfWeights(dt);     // 自機的動畫權重(⑥-3;`?selfbed=1` 才算,預設零成本)
  }

  /**
   * 自機的動畫權重向量。自機在 `_updateEnts` 早退(位置由 `this.pos` 直接指派)⇒ 它沒有
   * `ent.loco`,也就沒有權重。這裡用**同一支** `animWeights` 從位置差分組一份 `this._selfW`
   * ——`MUST NOT` 在音效端另寫一條「玩家版」的速度判斷(那就是第二份實作)。
   * 差分 + 阻尼逐字沿用 `locomotion.js` 的 `L.vx/L.vz/L.amp`(同 k = 6、同 `lerpFPS`),
   * 而 **MUST NOT** 拿 `this.vel`:攀爬 / push-out / 蓄力跳三條路徑都不經過它。
   *
   * 交出兩份、來源同一個 `L`:`this._selfW`(權重向量,音效那一半讀)與 `this._selfSpd`
   * (**同一份差分的 m/s 地速**,⑤-1 的植被擾動讀)。⚠ 兩者 MUST NOT 各自差分一次 ——
   * 那就是 ⑥-3 花一整輪刪掉的 `ent._moveSpd` 的第二次投胎。`_selfSpd` 是「自機版的
   * `ent.loco.speed`」:自機在 `_updateEnts` 早退 ⇒ 它沒有 `loco`,這一支就是它的替身。
   *
   * 閘門吃**兩個**消費端(`?selfbed=1` 的移動床 / `?tread` 的植被擾動),任一開著就要跑;
   * 兩個都關才整支早退。`_selfW` 在只有 `?tread` 開著時算了但沒有人讀(`_updateMoveAudio`
   * 仍 `continue` 掉自機)⇒ 音效端逐位元同舊制。
   */
  _stepSelfWeights(dt) {
    if ((!SELF_BED && !TREAD) || dt <= 0) return;
    const L = (this._selfL ??= { px: this.pos.x, pz: this.pos.z, vx: 0, vz: 0, speed: 0, amp: 0 });
    const k = lerpFPS(6, dt);
    L.vx += ((this.pos.x - L.px) / dt - L.vx) * k;
    L.vz += ((this.pos.z - L.pz) / dt - L.vz) * k;
    L.px = this.pos.x; L.pz = this.pos.z;
    L.speed = Math.hypot(L.vx, L.vz);
    this._selfSpd = L.speed;   // 自機版的 `ent.loco.speed`(⑤-1 的槽 0 讀它;同一份差分)
    let rig = null;
    for (const e of this.ents.values()) if (e.isSelf) { rig = e.mesh?.userData?.rig || null; break; }
    const top = rig?.top || 0;
    L.amp += ((top > 0 ? Math.min(1.2, L.speed / top) : 0) - L.amp) * k;
    this._selfW = animWeights(L, rig, {
      groundY: MORPH.GROUND_Y, y: this._altAG || 0, flies: this._flying(), top,
    });
  }

  /**
   * 這一幀的**植被擾動源**(⑤-1 的餵入端;唯一呼叫點 = 主迴圈 `stepCelWind(dt)` 之後)。
   * 槽 0 = **主視野機體**(交戰中 = 自機、觀戰 / 陣亡過場 = 正在跟隨的那一台),
   * 其餘依「離相機距離」升冪補到 `CHAR.N`。
   *
   * ⚠ **速率不在這裡推導**。`CHAR.SPD_K` 那條「位置差分 + `lerpFPS` 平滑」的規則已經有
   * 現成的實作:他機走 `locomotion.stepLocomotion` 的 `L.speed`(位移差分 + `damp` k = 6),
   * 自機走 `_stepSelfWeights` 的 `_selfSpd`(**逐字同一條**)。在這裡再差分一次就是
   * ⑥-3 花一整輪刪掉的 `ent._moveSpd` 換個名字回來 —— 而兩份速度的差別只表現成
   * 「草被撥開的時機跟腳步聲對不上」,沒有任何錯誤訊息。
   *
   * ⚠ MUST 排在 `_updateEnts` **之後**:`ent.mesh.position` 那時才是本幀插值完的值
   * (8Hz 快照 → `lerpFPS(9)`),早一步拿到的是上一幀的位置。
   *
   * 換手的代價寫在 `CHAR.N` 旁邊:被擠出槽位的那一台下一幀 `spd` 歸 0(`setCelChar` 顯式寫),
   * 它腳邊的草會彈回去。進來的那一台則從它自己**已經在跑**的 `L.speed` 接手 ⇒ 不是從 0 淡入,
   * 也不會瞬跳(那份阻尼從它出生就一直在積分)。
   *
   * 零配置:輸出陣列與槽物件都是重用的池(逐幀 60 次 × 4 槽的 GC 不值得付)。
   */
  _charSlots() {
    const out = (this._charOut ??= []);
    out.length = 0;
    if (!TREAD) return out;        // ?tread=0 ⇒ 空陣列 ⇒ setCelChar 全槽歸零 ⇒ 位移項恆早退
    const pool = (this._charPool ??= Array.from({ length: CHAR.N },
      () => ({ x: 0, y: 0, z: 0, spd: 0 })));
    const add = (p, spd) => {
      const s = pool[out.length];
      s.x = p.x; s.y = p.y; s.z = p.z;
      s.spd = spd > 0 ? spd : 0;
      out.push(s);
    };
    // 槽 0:交戰中的自機位置權威在 `this.pos`(它的 ent 只是每幀 copy 過去的影子);
    // 觀戰 / 陣亡過場時主視野是 `_specPid` 跟隨的那一台。兩者都可能不存在(剛進場 / 沒人可跟)
    // ⇒ 那就直接讓最近的機體遞補,MUST NOT 留一個空的槽 0(空槽 = 少一台會撥草的機體)。
    let lead = null;
    if (this.side && !this.dead) {
      add(this.pos, this._selfSpd);
    } else if (this._specPid != null) {
      for (const e of this.ents.values()) {
        if (e.pid === this._specPid && e.hero && e.mesh) { lead = e; break; }
      }
      if (lead) add(lead.mesh.position, lead.loco?.speed);
    }
    const cap = CHAR.N - out.length;
    if (cap <= 0) return out;
    // 其餘槽:離相機最近的 cap 台。固定長度的插入排序 ⇒ 不整串排序、不配置。
    const cam = this.camera.position;
    const nd = (this._charND ??= new Float64Array(CHAR.N));
    const ne = (this._charNE ??= new Array(CHAR.N));
    let n = 0;
    for (const e of this.ents.values()) {
      if (e === lead || e.isSelf || !e.hero || e.dead || !e.mesh?.visible) continue;
      const p = e.mesh.position;
      const dx = p.x - cam.x, dy = p.y - cam.y, dz = p.z - cam.z;
      const d = dx * dx + dy * dy + dz * dz;
      let i = n;
      while (i > 0 && nd[i - 1] > d) i--;
      if (i >= cap) continue;
      for (let j = Math.min(n, cap - 1); j > i; j--) { nd[j] = nd[j - 1]; ne[j] = ne[j - 1]; }
      nd[i] = d; ne[i] = e;
      if (n < cap) n++;
    }
    for (let i = 0; i < n; i++) add(ne[i].mesh.position, ne[i].loco?.speed);
    return out;
  }

  /** 可跟隨名冊(含 bot)。排序 MUST 穩定,否則 Q/E 循環會隨快照跳位 */
  _specRoster() {
    return [...this.ents.values()]
      .filter((e) => e.hero && e.pid && e.act !== false)
      .sort((a, b) => (a.side === b.side ? String(a.pid).localeCompare(String(b.pid)) : (a.side < b.side ? -1 : 1)));
  }

  /** 跟隨中那位的名字(播報 / HUD 標題共用一份,MUST NOT 各拼一次) */
  _specName(ent) {
    const c = ent && CHARACTERS[ent.ch];
    const who = c ? `「${c.code}」${c.name}` : (ent?.pid ?? '—');
    return `${who}${ent?.side ? ` ・ ${SIDES[ent.side].name}` : ''}`;
  }

  /**
   * 觀戰視角切換。step:null = 退回上帝視角 / 0 = 進入玩家視角(取最近的一位)/ ±1 = 名冊循環。
   * **只管「跟誰」**;「怎麼看」(第一人稱 / 第三人稱跟隨 / 第三人稱自由)住 `_specSetView`。
   */
  _specFollow(step) {
    if (step == null) { this._specSetView('god'); return; }
    const list = this._specRoster();
    if (!list.length) { this.hud.feed?.('👁 目前沒有可跟隨的玩家'); return; }
    let ent;
    if (step === 0 && !this._specPid) {
      // 剛剛在看誰就跟誰:取離自由視角相機最近的一位
      ent = list.reduce((a, b) => (this.pos.distanceToSquared(a.mesh.position)
        <= this.pos.distanceToSquared(b.mesh.position) ? a : b));
    } else {
      const i = list.findIndex((o) => o.pid === this._specPid);
      ent = list[(((i < 0 ? 0 : i + step) % list.length) + list.length) % list.length];
    }
    const swapped = this._specPid !== ent.pid;
    this._specPid = ent.pid;
    if (swapped) this._specAnchorOk = false;   // 換人 = 換錨點:直接貼上去,MUST NOT 平滑成一條長鏡頭
    // 從上帝視角被 Q/E 拉進來 ⇒ 順勢進第一人稱(否則按了換人卻還在高空,看起來像沒反應);
    // 播報一律由 `_specSetView` 那一份發,這裡只在「已經在跟隨中換人」時補一句
    if (this._specView === 'god') this._specSetView('fpv');
    else this.hud.feed?.(`🎥 ${SPEC_CAM.NAMES[this._specView]}:${this._specName(ent)}(Q/E 換人 ・ F 換視角)`);
  }

  /**
   * 觀戰視角的**唯一寫入點**(鍵盤 F / 觸控十字鍵左 / `_specFollow` 三個來源共用)。
   * MUST NOT 在任何呼叫端另判「該不該切」或直接指派 `_specView` —— 條件一散出去,
   * 兩種輸入就會走出不同的循環序(前科:觸控只做 god ⇄ 玩家視角的二態切換)。
   * 進入跟隨類視角時若尚未選定目標,順手取最近的一位;完全沒有可跟隨的人就退回上帝視角(降級不例外)。
   */
  _specSetView(id) {
    let view = SPEC_CAM.VIEWS.includes(id) ? id : SPEC_CAM.VIEWS[0];
    let none = false;
    if (view !== 'god' && !this._specPid) {
      const list = this._specRoster();
      if (!list.length) { view = 'god'; none = true; }   // 沒人可跟 ⇒ 維持上帝視角(降級,不例外)
      else {
        this._specPid = list.reduce((a, b) => (this.pos.distanceToSquared(a.mesh.position)
          <= this.pos.distanceToSquared(b.mesh.position) ? a : b)).pid;
        this._specAnchorOk = false;
      }
    }
    const prev = this._specView;
    this._specView = view;   // **唯一寫入點**(另一處只有建構子的初值)
    if (view === 'god') {
      this._specPid = null;
      this._specAnchorOk = false;
      // 自高空俯瞰的預設俯仰只在「從跟隨類切回來」時重設(在上帝視角裡自己調過的角度不該被吃掉)
      if (prev !== 'god') this.pitch = Math.min(this.pitch, SPEC_CAM.ORBIT_PITCH);
    } else if (prev === 'god' || prev === 'fpv') {
      // 高空俯瞰(−0.9)切進跟隨類:俯仰先擺到該視角的預設值,否則第一幀是對著地面
      this.pitch = view === 'fpv' ? 0 : view === 'tps' ? SPEC_CAM.TPS_PITCH : SPEC_CAM.ORBIT_PITCH;
    }
    if (none) { this.hud.feed?.(`👁 目前沒有可跟隨的玩家 ・ 維持${SPEC_CAM.NAMES.god}`); return; }
    const tgt = this._specPid ? this._specRoster().find((o) => o.pid === this._specPid) : null;
    this.hud.feed?.(view === 'god'
      ? `👁 ${SPEC_CAM.NAMES.god}:WASD 飛行 ・ Space/C 升降 ・ F 換視角`
      : `🎥 ${SPEC_CAM.NAMES[view]}:${this._specName(tgt)}(Q/E 換人 ・ F 換視角)`);
  }

  /** F / 十字鍵左:循環下一個視角(序取自 `SPEC_CAM.VIEWS` 這一份) */
  _specCycleView() { this._specSetView(specViewNext(this._specView)); }

  /**
   * 觀戰玩家資訊(2026-08-02 使用者需求「會顯示該玩家所有資訊,包括商店升級」)。
   * 回傳的形狀**刻意與 `_weaponHud()` 一致** —— 交戰 HUD(main.js `hud.self`)是唯一渲染來源,
   * 觀戰只是換一組數字餵進去,MUST NOT 為觀戰另寫一塊面板 DOM(兩份必漂)。
   * 三個「觀戰沒有」的欄位一律回 null 而不是假值:彈藥(伺服器不發別人的彈夾狀態)、
   * 爬升動力與空白鍵機動 CD(純客戶端量,別人的算不出來)—— 寧缺勿錯,HUD 端顯示「—」。
   */
  _specHud() {
    if (this.side) return null;
    const vname = SPEC_CAM.NAMES[this._specView] || SPEC_CAM.NAMES.god;
    const tgt = this._specPid ? this._specRoster().find((o) => o.pid === this._specPid) : null;
    if (!tgt) return { spec: true, follow: false, who: `觀戰模式 ・ ${vname}`, hp: 0, max: 1 };
    const c = CHARACTERS[tgt.ch];
    const kind = c?.kind || (tgt.side && SIDES[tgt.side].hero) || 'robot';
    const ab = tgt.ab || { light: 1, heavy: 1, def: 1, atk: 1 };
    const mp = tgt.mp ?? 0, mm = tgt.mm || 1;
    const slotHud = (id) => {
      const def = heroWeapon(tgt.ch, id, ab[id] || 1);
      // 取不到就給一格空欄(HUD 端無條件讀 .name/.mag;回 null 會直接炸掉整個面板)
      return def ? { name: def.name, lvl: ab[id] || 1, ammo: null, mag: def.mag, reload: 0, reloadMax: def.reload || 0 }
        : { name: '—', lvl: 0, ammo: null, mag: 0, reload: 0, reloadMax: 0 };
    };
    const abHud = (slot, idx) => {
      const lvl = ab[slot] || 1;
      const A = heroAbility(tgt.ch, slot, lvl);
      if (!A) return { name: '—', lvl: 0, cd: 0, cdMax: 0, mp: 0, ready: false };
      const mpc = Math.round(A.mp);
      const cd = (tgt.cds || [])[idx] || 0;
      return { name: A.name, lvl, cd, cdMax: A.cd || 10, mp: mpc, ready: cd <= 0 && mp >= mpc };
    };
    return {
      spec: true, follow: true,
      who: `${this._specName(tgt)}${c ? ` ・ ${c.machine}` : ''} ・ ${vname}`,
      ch: tgt.ch,   // 跟隨頭像:Hud 自機頭像同一縫(main.js avatarURL),快照實值不虛構
      hp: tgt.hp, max: tgt.max, dead: !!tgt.dead, rs: tgt.rs || 0,
      upg: tgt.up || null,        // 八軌商店升級(名稱取自 ECON.UPGRADES 同一份,見 main.js)
      money: tgt.money || 0, kn: tgt.kn || 0, atBase: false, aiming: false,
      code: c?.code, machine: c?.machine,
      light: slotHud('light'), heavy: slotHud('heavy'),
      def: abHud('def', 0), atk: abHud('atk', 1),
      sp: tgt.sp || 0, msp: tgt.maxSp || 1, mp, mm,
      lift: null, mobil: null, morph: null,
      emp: tgt.emp || 0, stealth: 0,
      // 機種絕招 2026-08-06 整組退場 ⇒ 觀戰面板與交戰 HUD 同樣只剩 def / atk 兩格招式冷卻。
    };
  }

  /**
   * 觀戰相機。四種視角共用這一支:
   *   god   上帝視角 —— 自由飛行(WASD + Space 升 / C・Ctrl 降;降到站立面上方 FLOOR_M 停住)
   *   fpv   第一人稱 —— 視點與交戰 FPV 吃**同一個縫**(heroView + heroTargetH),看到的畫面與該玩家一致
   *   tps   第三人稱跟隨 —— 相機掛在機背後上方,偏航自動跟著該玩家的 ry
   *   orbit 第三人稱自由 —— 相機環繞該玩家,偏航/俯仰全由觀戰者自控
   * **運鏡不晃的三道保險**(2026-08-02 使用者需求「運鏡時避免太晃」):
   *   ①跟隨錨點 `_specAnchor` 平滑目標位置 —— **只作用在第三人稱自由**(見 SPEC_CAM.LOCK_VIEWS:
   *     第一人稱與第三人稱跟隨是掛在機體上的鏡頭,MUST 剛體貼合,否則鏡頭會落後機體一段);
   *   ②偏航 `_specYaw` 平滑伺服器 ry(量化到 0.01 rad,直接賦值會一格一格跳);
   *   ③兩者都經 `camSmoothF`(幀率無關),且換人/重生瞬移超過 SNAP_M 就直接貼上不拉長鏡頭。
   */
  _updateSpectator(dt) {
    const tgt = this._specPid ? this._specRoster().find((o) => o.pid === this._specPid) : null;
    // 目標退場/離線:降級回上帝視角(寧缺勿錯)。走 `_specSetView` 同一個縫 ——
    // 「跟著誰」「怎麼看」「錨點」三件事一起收乾淨,MUST NOT 在這裡就地指派 `_specView`
    if (this._specPid && !tgt) this._specSetView('god');
    const view = tgt ? this._specView : 'god';
    // 上一幀藏起來的機體先還原(換人 / 換視角 / 回上帝視角都會走到);死亡中的機體本來就該是隱形的。
    // **只有第一人稱會藏機體** —— 第三人稱要看得到人,藏掉就只剩一個空鏡頭。
    const hide = view === 'fpv' ? tgt : null;
    if (this._specHid && this._specHid !== hide) {
      this._specHid.mesh.visible = !this._specHid.dead;
      this._specHid = null;
    }
    if (tgt) {
      const kind = CHARACTERS[tgt.ch]?.kind || (tgt.side && SIDES[tgt.side].hero) || 'robot';
      const h = heroTargetH(kind, tgt.ch);
      const p = tgt.mesh.position;
      // ① 錨點:第一人稱 / 第三人稱跟隨**剛體貼合機體**(specViewLocked 單一縫),
      //    第三人稱自由才走平滑(超過 SNAP_M = 換人/重生瞬移 ⇒ 一律直接貼上)。
      //    機體位置本身已由 `_updateEnts` 逐幀插值 ⇒ 貼合不抖;再套一次 POS_K 就是雙重平滑,
      //    穩態落後 = 速度 ÷ POS_K,畫面上正是「鏡頭沒跟上機體」(見 SPEC_CAM.LOCK_VIEWS)。
      if (specViewLocked(view) || !this._specAnchorOk
        || this._specAnchor.distanceTo(p) > SPEC_CAM.SNAP_M) {
        this._specAnchor.copy(p);
        this._specAnchorOk = true;
      } else {
        this._specAnchor.lerp(p, lerpFPS(SPEC_CAM.POS_K, dt));
      }
      const a = this._specAnchor;
      // ② 偏航平滑(ry 是相機朝向慣例,模型才 +π);第一人稱要跟手 ⇒ 係數明顯較大
      this._specYaw = camAngleStep(this._specYaw, tgt.ry ?? this._specYaw,
        view === 'fpv' ? SPEC_CAM.FPV_YAW_K : SPEC_CAM.YAW_K, dt);
      this.pos.set(a.x, a.y, a.z);              // 迷霧/小地圖/音場一併跟著跑(它們都讀 this.pos)
      if (view === 'fpv') {
        // 第一人稱:偏航吃該玩家的視線;俯仰快照沒有 ⇒ 仍由觀戰者自控(降級,不例外)
        const vw = heroView(kind, tgt.ch, (tgt.heroY || 0) > SPEC_CAM.FLY_M);
        this.yaw = this._specYaw;
        if (!tgt.dead) tgt.mesh.visible = false;   // 不要從自己的鼻子裡往外看(與 PiP 副視窗同一手法)
        this._specHid = tgt;
        const headF = h * vw.f;
        this.camera.position.set(a.x - Math.sin(this.yaw) * headF, a.y + h * vw.e, a.z - Math.cos(this.yaw) * headF);
      } else {
        // 第三人稱:距離/抬高一律以**該機體實高**為尺(重機甲與小無人機共用固定距離必然一頭穿模)。
        // 跟隨 = 相機站在機背後方(偏航自動);自由 = 觀戰者自己繞著看(偏航自控),兩者只差這一行。
        if (view === 'tps') this.yaw = this._specYaw;
        const dist = Math.max(SPEC_CAM.MIN_DIST, h * SPEC_CAM.DIST_F);
        const cp = Math.cos(this.pitch);
        // 注視點恆為機體頂高 × AIM_F;相機的抬高由俯仰推導 ⇒ 不論怎麼轉,人都在畫面中心
        this.camera.position.set(
          a.x + Math.sin(this.yaw) * dist * cp,
          a.y + h * SPEC_CAM.AIM_F - Math.sin(this.pitch) * dist,
          a.z + Math.cos(this.yaw) * dist * cp,
        );
        // 鏡頭卡進建物內或被隔開時整個畫面全擋 ⇒ 沿注視點(視軸必經點)→鏡頭拉回(與交戰第三人稱同一縫)
        this._cameraPullSegment(a.x, a.y + h * SPEC_CAM.AIM_F, a.z);
        // 鑽進地形/橋面底下只會看到黑畫面 ⇒ 抬回站立面上方(與上帝視角同一條地板規則)
        const floor = this._surf(this.camera.position.x, this.camera.position.z, this.camera.position.y)
          + SPEC_CAM.FLOOR_M;
        if (this.camera.position.y < floor) this.camera.position.y = floor;
      }
    } else {
      // 上帝視角:自由飛行。升降是**移動**不是姿態 ⇒ 與飛行機體同一組鍵(Space 升 / C・Ctrl 降),
      // 觸控 B・ZL 經 `_cmd` 對映到同兩顆鍵,MUST NOT 在觸控層另寫一套垂直位移。
      const fx = -Math.sin(this.yaw), fz = -Math.cos(this.yaw);
      const rx = -fz, rz = fx;
      const ax = this._moveAxis();
      const sp = SPEC_CAM.MOVE_MPS * (ax.boost ? SPEC_CAM.BOOST_F : 1);
      const k = ax.mag > 1 ? 1 / ax.mag : 1;   // 鍵盤對角線夾回單位長(舊版逐軸相加會快 √2 倍,此處與交戰視角一致)
      const step = k * sp * dt;
      this.pos.x += (fx * ax.f + rx * ax.r) * step;
      this.pos.z += (fz * ax.f + rz * ax.r) * step;
      if (this.keys.Space) this.pos.y += sp * dt;
      if (this.keys.KeyC || this.keys.ControlLeft) this.pos.y -= sp * dt;
      // 下降的地板:降到站立面上方 FLOOR_M 就停住(地形/橋面同一個縫 `_surf`)
      const floor = this._surf(this.pos.x, this.pos.z, this.pos.y) + SPEC_CAM.FLOOR_M;
      if (this.pos.y < floor) this.pos.y = floor;
      // 上升的天花板 = **遊戲最高高度**(同飛行機體那一份 `_ceilY`):上帝視角照樣是在這個
      // 世界裡飛,升到全場沒有任何東西的高度只會看到一片天空。地板與天花板兩條夾制的順序
      // MUST 是「先地板後天花板」—— 極平坦場地上兩者相距仍有數個砲塔高,順序其實不影響,
      // 但反過來寫會在天花板低於地板的退化輸入下把相機塞進地形裡(原則 6)。
      const ceil = this._ceilY();
      if (this.pos.y > ceil) this.pos.y = Math.max(floor, ceil);
      this.camera.position.copy(this.pos);
    }
    this.camera.rotation.set(0, 0, 0);
    this.camera.rotateY(this.yaw);
    this.camera.rotateX(this.pitch);
    // 滾輪縮放視野(四種視角共用)。A8 禁的是「用 FOV 做**機種**差異化」,觀戰不是機種。
    if (Math.abs(this.camera.fov - this._specFov) > 0.01) {
      this.camera.fov = this._specFov;
      this.camera.updateProjectionMatrix();
    }
  }

  // ---------------- 單位插值 ----------------
  /**
   * 最近的可見敵方單位(0.25s 快取)。純視覺:只用來轉砲塔 / 讓 NPC 面向交戰方向,
   * 命中與鎖定一律以伺服器為準(見 CLAUDE.md:server-authoritative)。
   */
  _nearestEnemy(ent, now, range, structs = false) {
    if (!ent._aimNext || now >= ent._aimNext) {
      ent._aimNext = now + 0.25;
      let best = null, bestD = range;
      const tp = ent.mesh.position;
      for (const o of this.ents.values()) {
        if (!o.side || o.side === ent.side || o.neutral || o.dead) continue;
        if (o.isStatic && !structs) continue;   // 塔:只追單位;小兵:也會打建築
        if (!o.mesh.visible && !o.isSelf) continue;
        const p = o.mesh.position;
        const d = Math.hypot(p.x - tp.x, p.z - tp.z);
        if (d < bestD) { bestD = d; best = o; }
      }
      ent._aimTarget = best;
    }
    const t = ent._aimTarget;
    return t && this.ents.has(t.id) ? t : null;
  }

  /**
   * 防禦塔砲塔追蹤(計畫 Task 2.2):0.25s 挑一次最近敵目標,
   * 每幀平滑轉向(不瞬移),俯仰夾在 -30°~+60° 機械極限;無目標慢速掃描。
   */
  _aimTurret(ent, dt, now) {
    const tur = ent.mesh.userData.turret;
    if (!tur) return;
    // 開火過(shot 事件)優先咬住「實際攻擊目標」,其次追蹤最近敵人 —— 砲口朝攻擊方向
    const aim = ent._aimAt && now < ent._aimAt.until ? ent._aimAt : null;
    const t = aim ? null : this._nearestEnemy(ent, now, UNITS.tower.range);   // 追蹤半徑同砲塔射程
    let wantYaw, wantPitch;
    if (aim || t) {
      const p = aim || (t.isSelf ? this.pos : t.mesh.position);
      const dx = p.x - ent.mesh.position.x, dz = p.z - ent.mesh.position.z;
      wantYaw = Math.atan2(dx, dz);
      const turY = tur.getWorldPosition(_TMP_A).y;
      wantPitch = Math.atan2(((p.y ?? turY - 2) + 2) - turY, Math.hypot(dx, dz));
    } else {
      wantYaw = tur.rotation.y + dt * 2;   // 警戒掃描
      wantPitch = 0;
    }
    wantPitch = Math.max(-Math.PI / 6, Math.min(Math.PI / 3, wantPitch));
    const wrap = (a) => Math.atan2(Math.sin(a), Math.cos(a));
    tur.rotation.y += wrap(wantYaw - tur.rotation.y) * lerpFPS(4, dt);
    const pit = tur.userData.pitch;
    pit.rotation.x += (-wantPitch - pit.rotation.x) * lerpFPS(4, dt);
  }

  /** 主堡兩門大砲追瞄:shot 事件記下各門砲的攻擊目標(_gunAim),砲管平滑轉向它;
   *  Each gun tracks its own event target; recoil lives below the pitch joint. */
  _aimBaseGuns(ent, dt, now) {
    const g = ent.guns;
    if (!g || !ent.gunPivots) return;
    const wrap = (a) => Math.atan2(Math.sin(a), Math.cos(a));
    ent.gunPivots.forEach((c, i) => {
      const aim = ent._gunAim?.[i];
      let wantLocal = 0, wantPitch = -0.14;
      if (aim && now < aim.until) {
        const origin = c.getWorldPosition(_TMP_A);
        const dx = aim.x - origin.x, dz = aim.z - origin.z;
        const world = Math.atan2(dx, dz);
        wantLocal = wrap(world - g.rotation.y);
        wantPitch = -Math.max(-Math.PI / 6, Math.min(Math.PI / 3,
          Math.atan2((aim.y ?? origin.y) - origin.y, Math.hypot(dx, dz))));
      }
      c.rotation.y += wrap(wantLocal - c.rotation.y) * lerpFPS(3, dt);
      const pitch = c.userData.pitch;
      pitch.rotation.x += (wantPitch - pitch.rotation.x) * lerpFPS(3, dt);
    });
  }

  /**
   * 車載砲塔追蹤(坦克):車體照常朝移動方向,砲塔獨立咬住射程內最近敵人,
   * 換目標跟著轉;無目標平滑歸中(砲管回正對齊車頭)。純視覺,命中仍由伺服器結算。
   */
  _aimVehicleTurret(ent, tur, dt, now) {
    // 開火過(shot 事件)優先咬住「實際攻擊目標」,其次最近敵人 —— 砲口朝攻擊方向
    const aim = ent._aimAt && now < ent._aimAt.until ? ent._aimAt : null;
    const t = aim ? null : this._nearestEnemy(ent, now, (UNITS[ent.kind]?.range || 0) * 1.2, true);
    const wrap = (a) => Math.atan2(Math.sin(a), Math.cos(a));
    // 有敵人:砲管咬住攻擊目標(任意方向,含車後);無敵人:歸中對齊車頭 = 前進方向。
    // 純視覺,命中仍由伺服器結算。
    let wantLocal = 0, wantPitch = 0;
    if (aim || t) {
      const p = aim || (t.isSelf ? this.pos : t.mesh.position);
      const world = Math.atan2(p.x - ent.mesh.position.x, p.z - ent.mesh.position.z);
      wantLocal = wrap(world - ent.mesh.rotation.y);
      const dx = p.x - ent.mesh.position.x, dz = p.z - ent.mesh.position.z;
      const turY = tur.getWorldPosition(_TMP_A).y;
      wantPitch = Math.atan2(((p.y ?? turY) - turY), Math.hypot(dx, dz) || 1);
    }
    tur.rotation.y += wrap(wantLocal - tur.rotation.y) * lerpFPS(5, dt);
    // 砲管俯仰(2026-07-22 規則 1):有 pitch 節點的車砲把砲管指向目標仰角;
    // 拋物線攻城砲(tank 'siege')的「出膛仰角」由 _arcTracer 逐發回寫 _arcPitch 優先 ——
    // 砲管角度與實際彈道弧線一致
    const pit = tur.userData?.pitch;
    if (pit) {
      const arc = ent._arcPitch && now < ent._arcPitch.until ? ent._arcPitch.v : null;
      const wp = Math.max(-Math.PI / 6, Math.min(Math.PI / 3, arc ?? wantPitch));
      pit.rotation.x += (-wp - pit.rotation.x) * lerpFPS(4, dt);
    }
  }

  /** 共軛俯仰槍架(直升機頜砲/側掛槍/莢艙):機身朝向照舊(移動=航向、停懸=面向目標),
   *  槍架只補「對目標的垂直仰角」—— 對地射擊槍口下壓,曳光與槍管同一條線(規則 1 的俯仰半邊)。 */
  _aimGunTilt(ent, piv, dt, now) {
    const aim = ent._aimAt && now < ent._aimAt.until ? ent._aimAt : null;
    let want = 0;
    if (aim) {
      const py = piv.getWorldPosition(_TMP_A).y;
      const d = Math.hypot(aim.x - ent.mesh.position.x, aim.z - ent.mesh.position.z) || 1;
      want = Math.max(-1.1, Math.min(0.5, Math.atan2((aim.y ?? py) - py, d)));
    }
    piv.rotation.x += (-want - piv.rotation.x) * lerpFPS(4, dt);
  }

  _updateStatusFx(ent, dt, now) {
    if (!ent.mesh) return;
    const hasStatus = (ent.pz || 0) > 0 || (ent.sl || 0) > 0 || (ent.emp || 0) > 0 ||
      (ent.cf || 0) > 0 || (ent.vb || 0) > 0 || (ent.bl || 0) > 0 ||
      (ent.mk || 0) > 0 || (ent.ub || 0) > 0 || (ent.hs || 0) > 0;
    if (hasStatus) {
      if (!ent.statusFx) {
        const r = ent.hitR || 1.8;
        const top = ent.dimH || 2.8;
        const h = ent.dimH || 2.4;
        const isMajor = !!(ent.hero || ent.isSelf || ent.isBoss || ent.kind === 'base');
        ent.statusFx = makeStatusFx({ r, top, h, isMajor });
        ent.mesh.add(ent.statusFx);
      }
      ent.statusFx.visible = true;
      ent.statusFx.userData?.update?.(dt, now, ent);
    } else if (ent.statusFx) {
      ent.statusFx.visible = false;
    }
  }

  _updateEnts(dt, now) {
    // Distance LOD decimation (presentation only; authority untouched): heavy
    // channels update every Nth frame with accumulated dt. Position stays per-frame.
    const lodFrame = (this._lodFrame = ((this._lodFrame | 0) + 1) >>> 0);
    const camP = this.camera.position;
    const lp = (() => { try { return lowPower(); } catch { return false; } })();
    for (const ent of this.mapBuildings?.values() || []) if (ent.bar) ent.bar.lookAt(camP);
    if (this._fpsShieldMesh) {
      const shield = this._fpsShieldMesh;
      if (shield.userData.character !== this.ch) {
        const style = characterCombatStyle(this.ch);
        if (style) {
          const uniforms = shield.userData.mat.uniforms;
          uniforms.uColor.value.setHex(style.color);
          uniforms.uAccent.value.setHex(style.accent);
          uniforms.uPattern.value = characterShieldTexture(this.ch);
          uniforms.uHasPattern.value = 1;
          shield.userData.character = this.ch;
        }
      }
      shield.scale.x = (this.shieldExpandUntil || 0) > now ? SHIELD_PRESENTATION_EXPAND : 1;
      this._fpsShieldMesh.visible = (this.viewMode === 'fpv' && this.defending && (this.sp || 0) > 0 && !this.dead);
      if (shield.userData.mat) stepShieldMaterial(shield.userData.mat, dt);
    }
    for (const ent of this.ents.values()) {
      if (ent.isSelf) {
        const defenseCast = ent.castFx?.slot === 'def'
          && now >= ent.castFx.t0
          && now - ent.castFx.t0 < (ent.mesh.userData.rig?.combat?.clips.def.duration ?? 0);
        if (this._fpsShieldMesh && defenseCast) this._fpsShieldMesh.visible = this.viewMode === 'fpv' && !this.dead;
        if (this.viewMode === 'tps') {
          ent.mesh.visible = !ent.dead;
          const px = ent.mesh.position.x, pz = ent.mesh.position.z, pyaw = ent.mesh.rotation.y;
          ent.mesh.position.copy(this.pos);
          ent.mesh.rotation.y = (this.viewMode === 'tps' ? this.bodyYaw : this.yaw) + Math.PI;
          if (ent.bar) ent.bar.lookAt(this.camera.position);
          ent.visualDefense = this.defending && (this.sp || 0) > 0;
          ent.visualShieldExpand = (this.shieldExpandUntil || 0) > now;
          stepCombatFx(ent, now, dt);
          stepLocomotion(ent, dt, now, px, pz, pyaw);
        } else {
          ent.mesh.visible = false;
          ent.mesh.position.copy(this.pos);
        }
        if (ent.shieldMesh && !ent.shieldMesh.userData.authoredCombat) {
          ent.shieldMesh.visible = (this.viewMode === 'tps' && this.defending && (this.sp || 0) > 0 && !ent.dead);
          if (ent.shieldMesh.visible) {
            const isExpanded = (this.shieldExpandUntil || 0) > now;
            const s = isExpanded ? SHIELD_PRESENTATION_EXPAND : 1.0;
            ent.shieldMesh.scale.set(s, 1.0, s);
            ent.shieldMesh.rotation.x = -this.pitch;
            if (ent.shieldMesh.userData.mat) stepShieldMaterial(ent.shieldMesh.userData.mat, dt);
          }
        }
        this._updateStatusFx(ent, dt, now);
        continue;
      }
      if (ent.isStatic) {
        const y = ent.padY ?? this.terrain.heightAt(ent.tgt.x, ent.tgt.z);   // padY:橋上砲塔的墩座台面
        ent.mesh.position.set(ent.tgt.x, y, ent.tgt.z);
        const sdx = ent.tgt.x - camP.x, sdz = ent.tgt.z - camP.z;
        const sDue = lodDue(lodFrame, ent.id ?? ent.kind, lodStrideByD2(sdx * sdx + sdz * sdz, lp));
        ent._lodAcc = (ent._lodAcc || 0) + dt;
        if (sDue) {
          const acc = ent._lodAcc || dt;
          ent._lodAcc = 0;
          if (ent.kind === 'tower') this._aimTurret(ent, acc, now);
          if (ent.kind === 'base') this._aimBaseGuns(ent, acc, now);
          stepCombatFx(ent, now, acc);
          if (ent.bar) ent.bar.lookAt(camP);
          this._updateStatusFx(ent, acc, now);
        }
        continue;
      }
      if (ent.hero && ent.shieldMesh && !ent.shieldMesh.userData.authoredCombat) {
        ent.shieldMesh.visible = (!ent.dead && !!ent.df && (ent.sp == null || ent.sp > 0));
        if (ent.shieldMesh.visible) {
          const s = ent.df === 2 ? SHIELD_PRESENTATION_EXPAND : 1.0;
          ent.shieldMesh.scale.set(s, 1.0, s);
          ent.shieldMesh.rotation.x = -(ent.rx || 0);
          if (ent.shieldMesh.userData.mat) stepShieldMaterial(ent.shieldMesh.userData.mat, dt);
        }
      }
      if (ent.hero && ent.mesh.userData.decoyPod) this._updateDecoyPod(ent, dt);
      const cur = ent.mesh.position;
      const px = cur.x, pz = cur.z, pyaw = ent.mesh.rotation.y;
      let nx, nz, snapped = false;
      if (ent._snapPos) {
        nx = ent.tgt.x; nz = ent.tgt.z;
        ent._snapPos = false;
        snapped = true;
        ent.loco = null;   // 重生瞬移:骨架動畫狀態歸零,不殘留舊速度
        ent.cfx = null; ent.fireFx = null; ent.heavyFx = null; ent.castFx = null;   // 戰鬥動畫狀態一併歸零
        ent._lodAcc = 0; ent._lodX = undefined; ent._lodZ = undefined; ent._lodYaw = undefined; ent._lodGy = undefined;
      } else {
        const k = lerpFPS(9, dt);
        nx = cur.x + (ent.tgt.x - cur.x) * k;
        nz = cur.z + (ent.tgt.z - cur.z) * k;
      }
      // LOD stride by camera distance (presentation only): self never decimates.
      const ddx = cur.x - camP.x, ddz = cur.z - camP.z;
      const stride = lodStrideByD2(ddx * ddx + ddz * ddz, lp);
      const due = snapped || lodDue(lodFrame, ent.id ?? 0, stride);
      ent._lodAcc = (ent._lodAcc || 0) + dt;
      // 貼地取樣吃橋面/隧道:主陣營兵線小兵/敵機改以「兵線貼地剖面場」的最近取樣高當 surfaceAt
      // 種子(_buildLaneSurf 從線頭穩定 march,不吃迷霧刪重建/重生瞬移/插值橫移汙染的 cur.y)⇒
      // 隧道段一定落在洞內、陸橋段一定落在橋面。離線遠(繞塔遠側等)查無取樣 → 退回逐幀棘輪(cur.y)。
      // 第三方(GUER/MILI)可駐守隧道正上方山頂 ⇒ 只主陣營(SWARM/STEEL)兵線單位吃剖面場,
      // 免把山頂的第三方吸進洞內;英雄自由走位 → 退回棘輪。
      // 飛行體(NPC 直升機/餌機/自殺機/飛彈)MUST 走 `_flySurf`(座標的純函式)—— 逐幀棘輪
      // 對它們是**單向**的:在橋上被側推出橋面足跡一次,基準面就永久掉回河床(見 _flySurf 檔頭)。
      // 遠距降頻:地形採樣只在 heavy 幀重算,其餘幀沿用快取(幾幀位移 < 1m,遠處不可見)。
      const lift = (ent.hero || ent.flies) ? ent.heroY : 0;
      let gy;
      if (due || ent._lodGy === undefined) {
        if (ent.flies) {
          gy = this._flySurf(nx, nz);
        } else {
          let curSeed = cur.y - lift;
          if (!ent.hero && (ent.side === 'SWARM' || ent.side === 'STEEL')) {
            const laneY = this._laneSurfAt?.(nx, nz);
            if (laneY != null) curSeed = laneY + 1.2;   // +1.2:維持上橋 mount 台階 + 洞內 curY<ceil(同 march 配方)
          }
          gy = this._surf(nx, nz, curSeed);
        }
        ent._lodGy = gy;
      } else {
        gy = ent._lodGy;
      }
      let ny = gy + lift;
      // 兵線過水必走橋(#2 倫敦泡水保底 + 2026-07-22 棘輪修):地面小兵設計上過水一律走橋、
      // 不會游泳。surfaceAt 的 mount 台階(curY ≥ deck − DECK_STEP)是單向棘輪 —— 生成抖動/
      // 塔推擠/迷霧刪重建(curY 以裸地形重播種)把 y 落到水面後,永遠爬不回 7.5m 高的橋面。
      // 故泡水點(ny < waterY)上方查得到 deck 就直接貼橋:泡水點不存在「橋下通行」的合法情境;
      // 乾地高架下 ny ≥ waterY 不進此分支,照舊可鑽橋下。查無 deck 才退回浮水面保底(漏建/錯位
      // 橋面時至多浮在水面)。純客戶端渲染,伺服器權威 y 不受影響(A1 相容);英雄/飛行體不夾
      // (英雄可涉水吃凍結、飛行體本在空中)。waterY==null(無水盤)時 no-op。
      const wy = this.terrain.waterY;
      if (wy != null && !ent.hero && !ent.flies && ny < wy) {
        const d = this.terrain.deckY?.(nx, nz, this.terrain.deckMargin || 0);
        ny = (d != null && d > wy) ? d : wy;
      }
      // 朝向:平滑轉向(mobility_plan:8Hz 快照的方位跳變不直接進畫面)
      let wantYaw = null;
      if (ent.decoy || ent.kami || ent.hyper) {
        wantYaw = ent.ry + Math.PI;   // 機首朝 +z,與機甲同慣例
      } else if (ent.hero) {
        // ry 是「相機朝向」慣例(前方 = -z),機體模型一律朝 +z(見 buildRobotMech 腳尖/駕駛艙)
        // → 直接套用會讓所有英雄(含 bot)倒著走。差 π。
        wantYaw = ent.ry + Math.PI;
        // 交戰面向(2026-07-22 規則 1):靜止中開火的僚機/bot 面向實際攻擊目標
        // (_markFire 記 _aimAt)—— 齊射不再側著身;移動中照舊面向 ry(伺服器權威朝向)
        const adx = ent.tgt.x - cur.x, adz = ent.tgt.z - cur.z;
        if (adx * adx + adz * adz <= 0.04 && ent._aimAt && now < ent._aimAt.until)
          wantYaw = Math.atan2(ent._aimAt.x - cur.x, ent._aimAt.z - cur.z);
      } else {
        // NPC 沒有伺服器方位,靠插值殘差推朝向。殘差 ≈ 速度/插值增益(小兵 6 m/s → 僅 0.7m),
        // 門檻設 0.5(距離平方)等於永遠不轉向 — 全場小兵一律朝 +z。改用 0.2m 門檻。
        const dx = ent.tgt.x - cur.x, dz = ent.tgt.z - cur.z;
        if (dx * dx + dz * dz > 0.04) wantYaw = Math.atan2(dx, dz);
        else if (ent._aimAt && now < ent._aimAt.until) {
          // 停止 + 開火過(shot 事件):面向「實際攻擊目標」—— 槍口一律朝攻擊方向
          wantYaw = Math.atan2(ent._aimAt.x - cur.x, ent._aimAt.z - cur.z);
        } else {
          // 停止 = 交戰中(sim:有目標就不前進):面向最近的敵人
          const t = this._nearestEnemy(ent, now, UNITS[ent.kind]?.range || 0, true);
          if (t) {
            const p = t.isSelf ? this.pos : t.mesh.position;
            wantYaw = Math.atan2(p.x - cur.x, p.z - cur.z);
          }
        }
      }
      if (wantYaw != null) {
        if (snapped) ent.mesh.rotation.y = wantYaw;
        else {
          const dy = Math.atan2(Math.sin(wantYaw - pyaw), Math.cos(wantYaw - pyaw));
          ent.mesh.rotation.y = pyaw + dy * lerpFPS(8, dt);
        }
      }
      // 極音速飛彈:機首俯仰跟著彈道(45° 出膛 → 頂點放平 → 極音速垂直俯衝)。
      // **純表現層**:角度由伺服器給的位置逐幀差分推導,客戶端不自己算彈道(A1);
      // 機首朝 +z ⇒ 抬頭 = rotation.x 取負。需 'YXZ' 序(見 _spawnEnt):偏航先套、
      // 俯仰才落在機體自己的橫軸上,否則大偏航時 45° 抬頭會歪成側傾。
      if (ent.hyper) {
        const dh = Math.hypot(nx - px, nz - pz), dv = ny - cur.y;
        if (dh + Math.abs(dv) > 1e-3) {
          const wantPit = -Math.atan2(dv, dh);
          ent.mesh.rotation.x = snapped ? wantPit
            : ent.mesh.rotation.x + (wantPit - ent.mesh.rotation.x) * lerpFPS(8, dt);
        }
      }
      cur.set(nx, ny, nz);
      // ⑥-3:舊制在這裡還有一份 `ent._moveSpd`(未阻尼的位移差分 + 逐幀常數 `* 0.6`
      // = 幀率相依)專門餵移動環境音 —— 那是與 `locomotion.js` 的 `L.speed` 量同一件事
      // 而不同結果的**第二份速度推導**。已整行刪除,消費端改讀 `ent.loco.w`
      // (唯一產生點 = `stepLocomotion` 收尾的 `animWeights`)。
      // 遠距 heavy 通道:骨骼/戰鬥特效/砲塔/狀態/標示只在 due 幀跑,dt 用累積值保持幀率無關。
      if (due) {
        const acc = ent._lodAcc || dt;
        ent._lodAcc = 0;
        // 車載砲塔(坦克):獨立於車體轉向,咬住交戰目標
        const tur = ent.mesh.userData.turret;
        if (tur) this._aimVehicleTurret(ent, tur, acc, now);
        // 共軛俯仰槍架(直升機):槍管補對目標仰角
        const gt = ent.mesh.userData.gunTilt;
        if (gt) this._aimGunTilt(ent, gt, acc, now);
        // 戰鬥開火/蓄力動畫(locomotion stepCombatFx):由 fireFx/heavyFx 事件推導 rig 驅動場
        // (射姿保持/後座脈衝/蓄力反向)+ 直接驅動掛點 glow/pivot 與槍口閃光 ——
        // MUST 在 stepLocomotion 之前呼叫,本幀步態才吃得到驅動場
        stepCombatFx(ent, now, acc);
        // 程序化骨架動畫:實際位移驅動步態/輪速/壓坡(locomotion.js)。
        // 位移基準是上次 heavy 幀的位置,速度 = 多幀位移 ÷ 累積 dt(平均速度,阻尼收斂不變)。
        stepLocomotion(ent, acc, now,
          ent._lodX ?? px, ent._lodZ ?? pz, ent._lodYaw ?? pyaw);
        ent._lodX = nx; ent._lodZ = nz; ent._lodYaw = ent.mesh.rotation.y;
        // 血條面向相機
        if (ent.bar) ent.bar.lookAt(camP);
        this._updateStatusFx(ent, acc, now);
        // 敵我標示(在快照裡 = 已進入我方視野):敵 = 下指箭頭,友 = 小圓徽
        if (ent.civ) this._civMark(ent, acc, now);   // 平民:不分我方/敵方都掛陣營箭頭(外觀只能分辨陣營)
        else if (this.side && ent.side && ent.side !== this.side) this._enemyMark(ent, acc, now);
        else if (this.side && ent.side && ent.side === this.side && !ent.isSelf) this._allyMark(ent, acc, now);
      }
    }
  }

  /** 單位的移動音類別(rotor 旋翼 / engine 引擎 / wingflap 振翅 / stomp 重機具震地);無 = 不發聲。
   *  NPC 依兵種;英雄(含變形者)依 visual + 當前騰空狀態(落地=踏地、升空=依飛行型)。 */
  _moveCat(ent) {
    const k = ent.kind;
    if (k === 'heli') return 'rotor';
    if (k === 'tank') return 'engine';
    if (k === 'drone') return 'wingflap';            // 蜂群無人機 = 拍翼/嗡鳴
    if (k === 'soldier' || ent.civ) return null;     // 步兵/平民非重機具,不進環境床
    if (ent.hero && ent.ch) {
      const v = CHARACTERS[ent.ch]?.visual || {};
      // 「升空了沒有」吃動畫權重向量的 air 軌(⑥-3)—— 那一軌的過渡帶恰在
      // `MORPH.GROUND_Y` 上跨過 0.5 ⇒ 與 locomotion 換樹**同一條線**。
      // 2026-08-19 已放行:移除舊制寫死 `> 3` 的第三個門檻;2m 由 `MORPH.GROUND_Y`
      // 統一進 `animWeights().air`,音床與換樹共用同一條過渡線。
      if (ent.flies || (ent.loco?.w?.air || 0) > 0.5) {       // 升空:依飛行型
        const fl = v.flight;
        if (fl === 'heli' || fl === 'tilt') return 'rotor';
        if (fl === 'jet' || fl === 'uav') return 'engine';
        return 'wingflap';                           // archo/owl/levi/beetle 等鳥翼/膜翼 → 拍翼氣流
      }
      return 'stomp';                                // 落地的機甲/獸型 = 踏地
    }
    return null;
  }

  /** 一個實體的動畫權重向量(⑥-3 的唯一讀取縫)。自機在 `_updateEnts` 早退、沒有 `loco`
   *  ⇒ 走 `_updatePlayer` 收尾組好的 `this._selfW`(**同一支** `animWeights`)。
   *  MUST NOT 在音效端另寫一條「玩家版」的速度判斷 —— 那就是第二份實作。 */
  _entWeights(ent) {
    return (ent.isSelf ? this._selfW : ent.loco?.w) || null;
  }

  /** 每幀:掃全場,每類別挑「最近的可聞移動源」餵 audio.setMove(存在感/平移/速率/濕度)。
   *  低功耗全關(audio.setMove 內亦擋);單位靜止則音量趨近 0(聲道續存)。純表現層。
   *  「他在不在動」一律吃 `ent.loco.w`(⑥-3 的動畫權重向量),MUST NOT 在這裡再寫一條
   *  速度曲線 —— 舊制的 `moveGate`/`rate` 吃的是已刪除的 `ent._moveSpd`(第二份速度推導)。*/
  _updateMoveAudio() {
    const a = this.audio;
    if (!a || a._dead) return;
    // 地點床在低功耗仍留**恆亮床**(降級是「少幾床」不是「整片靜音」;`_ambRide` 自己分流)
    // ⇒ MUST 排在 lowPower 早退**之前**,移動床那一半照舊在低功耗全關。
    this._updatePlaceAudio();
    if (a.lowPower) return;
    const cl = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
    const MAXD = 200, REF = 32;
    const RATE_K = 0.7;            // 跑步權重 → 音高/斬波速的斜率(上界仍夾在 1.5)
    const cam = this.camera.position, e = this.camera.matrixWorld.elements;  // 世界右向量 = 矩陣第一欄
    const best = { rotor: null, engine: null, wingflap: null, stomp: null };
    const cnt = { rotor: 0, engine: 0, wingflap: 0, stomp: 0 };
    for (const ent of this.ents.values()) {
      // 自機納入移動床是**可聽的行為改變**(玩家第一次聽到自己的機體),使用者尚未裁決
      // ⇒ 做成旋鈕,預設 = 不生效 = 逐位元同舊制(`?selfbed=1` 開)。
      if ((ent.isSelf && !SELF_BED) || ent.isStatic || ent.dead || !ent.mesh.visible) continue;
      const cat = this._moveCat(ent);
      if (!cat) continue;
      if (ent.isSelf && cat !== 'stomp' && cat !== 'engine') continue;   // 自機只納入地面型兩床
      const p = ent.mesh.position;
      const dx = p.x - cam.x, dz = p.z - cam.z, dy = p.y - cam.y;
      const d = ent.isSelf ? 0 : Math.sqrt(dx * dx + dz * dz + dy * dy);
      if (d > MAXD) continue;
      cnt[cat]++;
      const b = best[cat];
      if (!b || d < b.d) {
        best[cat] = {
          d, dx: ent.isSelf ? 0 : dx, dz: ent.isSelf ? 0 : dz,
          w: this._entWeights(ent), self: !!ent.isSelf, x: p.x, z: p.z,
        };
      }
    }
    for (const cat of ['rotor', 'engine', 'wingflap', 'stomp']) {
      const b = best[cat];
      if (!b) { a.setMove(cat, 0, 0, 1, 0); continue; }
      // ⚠ null 守衛不可少:`ent.loco` 在重生瞬移那一幀被設成 null(_updateEnts 的 _snapPos
      // 分支)⇒ 沒有守衛就是 NaN 進 AudioParam.setTargetAtTime、把整條幀迴圈打斷。
      const w = b.w;
      const mv = w ? cl(w.walk + w.run, 0, 1) : 0;                     // 「他在不在走/跑」
      const rn = w ? cl(w.run, 0, 1) : 0;
      const dist = REF / (REF + b.d);                                  // 距離衰減
      const dens = cl(0.55 + cnt[cat] * 0.14, 0.55, 1);                // 密度:場上越多同類越響
      // 地面型(引擎/踏地)靜止仍有怠速底噪但小;飛行型(旋翼/翅膀)本就常動
      const floor = (cat === 'stomp' || cat === 'engine') ? 0.35 : 0.5;
      const moveGate = floor + (1 - floor) * mv;
      const presence = cl(dist * dens * moveGate, 0, 1);               // 0..1;類別基準響度在 audio 端乘
      const hl = Math.hypot(b.dx, b.dz) || 1;
      const pan = cl((e[0] * b.dx + e[2] * b.dz) / hl, -1, 1);
      const rate = cl(0.8 + rn * RATE_K, 0.7, 1.5);                    // 跑步權重→音高/斬波速
      // 濕度只對 stomp 有意義(乾/濕兩條鏈由 audio 端的**同一顆 LFO** 開合 ⇒ 不會踏空一拍),
      // 而且只對**勝出那一台**量一次:自機讀當幀已算好的 `this._env.ground`,不再查第二次。
      const wet = cat !== 'stomp' ? 0
        : (b.self ? (this._env?.ground === 1 ? 1 : 0)
          : (terrainEnvCode(this.terrain, b.x, b.z) === 1 ? 1 : 0));
      a.setMove(cat, presence, pan, rate, wet);
    }
  }

  /** 地點環境音(⑦-1)每幀量測端:組一份查詢 `q` 交給 `audio.setAmbience`。
   *  三件事都**複用既有的量**,零新索引、零新地形取樣、零共享 `rnd()`:
   *   ① water / swamp ← `this._env.ground`(`_envAt` 每幀已算過,見 `_updatePlayer`)
   *   ② tunnel ← 既有的 `terrain.tunnelAt`
   *   ③ urban / forest ← **既有的 A6 碰撞網格** `this._blockGrid`(64m 格)逐格計數,
    *      結果快取在 `this._ambDens`(鍵同為整數格鍵)⇒ 走進新格才算一次。
   *      四鄰格心雙線性內插:不插的話走過格界會有一次聽得出來的音量跳變,
   *      而每一條離線斷言都會過(gain 仍在 [0,1]、優先序仍對)。
   *  「哪一床贏」的規則住 `audio.ambienceMix`(純函式,宣告順序 = 優先序);本處只量。 */
  _updatePlaceAudio() {
    const a = this.audio;
    if (!a?.ambOn || !a.setAmbience) return;
    const t = this.terrain;
    const x = this.pos.x, z = this.pos.z;
    const g = this._env?.ground || 0;
    const dens = this._ambDensityAt(x, z);
    // 據點(主堡/砲塔/碉堡)最近距離:靜態實體數十個以內,逐幀線性掃即可
    let camp = Infinity;
    for (const ent of this.ents.values()) {
      if (!ent.isStatic || ent.dead) continue;
      const p = ent.mesh.position;
      const d = Math.hypot(p.x - x, p.z - z);
      if (d < camp) camp = d;
    }
    a.setAmbience({
      tunnel: t?.tunnelAt?.(x, z) ? 0 : 1,     // 二元查詢:0 = 在裡面
      water: g === 1 ? 0 : 1,
      swamp: g === 2 ? 0 : 1,
      camp,                                    // 公尺
      urban: 1 - dens.bld,                     // 密度查詢:0 = 最密
      forest: 1 - dens.tree,
    });
  }

  /** 64m 碰撞網格的逐格密度(0..1),四鄰格心雙線性內插。逐格結果快取於 `this._ambDens`。 */
  _ambDensityAt(x, z) {
    const bg = this._blockGrid;
    if (!bg) return { bld: 0, tree: 0 };
    const C = bg.C;
    const URB_FULL = 26, FOR_FULL = 14;        // 「一格算滿」的計數(純聽感調校旋鈕)
    const cache = (this._ambDens ??= new Map());
    const cell = (i, j) => {
      const k = (i + 32768) * 65536 + (j + 32768);
      let v = cache.get(k);
      if (v) return v;
      let nb = 0, nt = 0;
      for (const b of bg.grid.get(k) || []) { if (b.bld) nb++; else if (b.cl === 'tree') nt++; }
      cache.set(k, v = { bld: Math.min(1, nb / URB_FULL), tree: Math.min(1, nt / FOR_FULL) });
      return v;
    };
    const u = x / C - 0.5, v = z / C - 0.5;
    const i0 = Math.floor(u), j0 = Math.floor(v);
    const fx = u - i0, fz = v - j0;
    const c00 = cell(i0, j0), c10 = cell(i0 + 1, j0), c01 = cell(i0, j0 + 1), c11 = cell(i0 + 1, j0 + 1);
    const mix = (key) => (c00[key] * (1 - fx) + c10[key] * fx) * (1 - fz)
      + (c01[key] * (1 - fx) + c11[key] * fx) * fz;
    return { bld: mix('bld'), tree: mix('tree') };
  }

  /** 平民/間諜:頭頂掛「其陣營」箭頭(我方/敵方都顯示 —— 外觀只能分辨陣營,不揭露間諜);
   *  跟隨中(fo)略微加亮。marker 由陣營色決定,和一般敵標分開一份(cs ≠ side)。 */
  _civMark(ent, dt, now) {
    if (!ent.civMark) {
      const h = Math.max(1.8, ent.dimH ?? 2);
      const sp = new THREE.Sprite(new THREE.SpriteMaterial({
        map: factionMarkTex(ent.cs), transparent: true, opacity: 0, depthTest: false, depthWrite: false,
      }));
      sp.scale.setScalar(Math.max(2.6, h * 0.6));
      sp.renderOrder = 998;
      ent.civMarkY = (ent.dimTop ?? h) + 2.4 + sp.scale.y * 0.5;
      ent.mesh.add(sp);
      ent.civMark = sp;
    }
    const m = ent.civMark.material;
    m.opacity = Math.min(ent.fo ? 0.95 : 0.66, m.opacity + dt * 3);
    ent.civMark.position.y = ent.civMarkY + Math.sin(now * 2.4) * 0.35;
  }

  /** 互動半徑內、水平距離最近的平民(靠近可驅趕/跟隨)。 */
  _nearestCiv() {
    if (!this.side || this.dead) return null;
    let best = null, bd = CIVILIAN.INTERACT_R;
    for (const ent of this.ents.values()) {
      if (!ent.civ || !ent.mesh.visible) continue;
      const d = Math.hypot(ent.mesh.position.x - this.pos.x, ent.mesh.position.z - this.pos.z);
      if (d < bd) { bd = d; best = ent; }
    }
    return best;
  }

  /** 送出平民互動(act='follow'|'away'):以本幀算好的最近平民為目標。 */
  _civAct(act) {
    const ent = this._civTarget || this._nearestCiv();
    if (ent) this.net.send({ t: 'civ', id: ent.id, act });
  }

  // ---------------- 2D 戰術地圖 ----------------
  _initMinimap() {
    this.mmCtx = this.minimapCanvas.getContext('2d');
    this._mmLast = 0;
    this._mmWarmUntil = performance.now() / 1000 + 3;   // 開場 3 秒小地圖降為 1Hz,把主線程讓給 _drainSpawnPend
    // 顯示範圍:'full' 全圖(預設,與舊版相同)/ 'near' 周遭(以自機為中心,涵蓋視野可見範圍)。
    // 切換走 KeyM 或觸控十字鍵右(兩者共用 _toggleMmMode)。
    this.mmMode = 'full';
    this._mmWin = null;   // 本幀的世界顯示窗(_mmWindow() 每次繪製前定案;_world2mm 讀它)
    const w = this.minimapCanvas.width, h = this.minimapCanvas.height;
    this._mmBase = this._bakeMmBase(w, h);   // 底圖 = 原始圖資地形(一次性烤好,之後只 drawImage)
    // 戰爭迷霧:已探索累積遮罩 + 每 tick 重組的迷霧層(觀戰 side=null 無霧,鏡像伺服器規則)
    this._mmSeen = document.createElement('canvas');
    this._mmSeen.width = w; this._mmSeen.height = h;
    this._mmFog = document.createElement('canvas');
    this._mmFog.width = w; this._mmFog.height = h;
    // 每個視野源的獨立遮蔽罩(先畫視野圓、再挖掉障礙陰影),再合成進 seen/fog —— 用暫存畫布隔離,
    // destination-out 挖陰影才不會誤刪其他源已照亮的區域。
    this._mmScr = document.createElement('canvas');
    this._mmScr.width = w; this._mmScr.height = h;
    this._pulseUntil = 0;   // 全隊無霧脈衝(偵察中繼站/偵察招式)到期時刻:迷霧全掀
    this._mmLanes = this._gradeLanes();   // 兵線分級取樣(地面/高架橋/地下道)— 一次算好
    // 已探索的第三方碉堡:一旦進過視野就永久標示(即使離開視野、被摧毀待重建也保留位置)。
    // 位置量化為鍵 → 同一營地重生的碉堡自動去重。
    this._seenBunkers = new Map();
  }

  /**
   * 兵線立體交通分級(小地圖圖例):**消費 _buildLaneSurf 的同一份兵線貼地剖面**(單一縫,
   * MUST NOT 再自行 march 一次)—— 逐取樣依高度回判:洞內 = tunnel、橋面 = bridge、其餘 ground。
   * 回傳每條線的 [{x, z, grade}] 取樣序列(世界座標,_drawMinimap 轉小地圖再分段畫虛線)。
   */
  _gradeLanes() {
    return (this._laneSurf || []).map((ls) => {
      if (!ls) return [];
      return ls.samples.map(({ x, z, y }) => {
        let grade = 'ground';
        const tn = this.terrain.tunnelAt?.(x, z);
        if (tn && !tn.open && y + 1.2 < tn.ceil && Math.abs(y - tn.floor) < 0.6) {   // open 引道 = 露天下沉段,照 ground 畫
          grade = 'tunnel';
        } else {
          const d = this.terrain.deckY?.(x, z);
          if (d != null && d > this.terrain.heightAt(x, z) + 0.5 && Math.abs(y - d) < 0.6) grade = 'bridge';
        }
        return { x, z, grade };
      });
    });
  }

  /**
   * 小地圖底圖 = 原始圖資:衛星影像原始像素(terrain.sampleColor,stylize 前捕捉的那份)上色,
   * 高程(terrain.heightAt)做西北光暈渲(hillshade)畫出稜線/谷地;海平面以下鋪水色。
   * 無衛星影像(離線 fallback)→ 高程分層設色。
   */
  _bakeMmBase(w, h) {
    const t = this.terrain;
    const cv = document.createElement('canvas');
    cv.width = w; cv.height = h;
    const bctx = cv.getContext('2d');
    const img = bctx.createImageData(w, h);
    const stepX = (t.maxX - t.minX) / w, stepZ = (t.maxZ - t.minZ) / h;
    const hRange = Math.max(1e-6, t.maxH - t.minH);
    // 高程先取進緩衝:hillshade 梯度直接查鄰格,不重複三角取樣
    const hs = new Float32Array(w * h);
    for (let py = 0; py < h; py++) {
      const z = t.minZ + (py + 0.5) * stepZ;
      for (let px = 0; px < w; px++) hs[py * w + px] = t.heightAt(t.minX + (px + 0.5) * stepX, z);
    }
    // 高程分層設色(無影像時的底色):谷地深綠 → 山腰黃褐 → 稜線灰白
    const RAMP = [[46, 77, 64], [96, 108, 74], [139, 121, 88], [205, 200, 190]];
    const rampAt = (f) => {
      const s = Math.max(0, Math.min(0.999, f)) * (RAMP.length - 1);
      const i = Math.floor(s), k = s - i;
      return [0, 1, 2].map((c) => RAMP[i][c] + (RAMP[i + 1][c] - RAMP[i][c]) * k);
    };
    for (let py = 0; py < h; py++) {
      const z = t.minZ + (py + 0.5) * stepZ;
      for (let px = 0; px < w; px++) {
        const x = t.minX + (px + 0.5) * stepX;
        const k = py * w + px, y = hs[k];
        let rgb = t.sampleColor?.(x, z) || rampAt((y - t.minH) / hRange);
        if (t.waterY != null && y < t.waterY) rgb = [38, 66, 92];   // 海平面以下 = 水色
        // 西北光 hillshade:高度朝東南遞增(= 坡面朝西北)的斜面亮、背光面暗
        const dx = (px > 0 && px < w - 1) ? hs[k + 1] - hs[k - 1] : 0;
        const dz = (py > 0 && py < h - 1) ? hs[k + w] - hs[k - w] : 0;
        const shade = Math.max(0.55, Math.min(1.3, 0.92 + (dx + dz) / (stepX + stepZ) * 0.9));
        const o = k * 4;
        img.data[o] = Math.min(255, rgb[0] * shade);
        img.data[o + 1] = Math.min(255, rgb[1] * shade);
        img.data[o + 2] = Math.min(255, rgb[2] * shade);
        img.data[o + 3] = 255;
      }
    }
    bctx.putImageData(img, 0, 0);
    // 壓一層暗紗:單位/兵線標記才拉得開對比
    bctx.fillStyle = 'rgba(5, 9, 13, 0.34)';
    bctx.fillRect(0, 0, w, h);
    return cv;
  }

  /** 戰爭迷霧視野來源(鏡像 sim._visionSources):己方存活單位各自 sight 半徑。
   *  瞄準視野加成:aiming 是小隊共用狀態(SQUAD_SHARED)→ 自機與僚機一起放大;
   *  其他友方英雄的瞄準狀態快照未攜帶,不鏡像 —— 僅顯示層誤差(單位標記本就畫在迷霧之上)。
   *  天氣濃霧等比縮減:與伺服器同一支 `fogSightMult`(raw fog),狙擊/步行同率。 */
  _mmVision() {
    const out = [];
    const aimF = this.aiming ? GAME.AIM_SIGHT_MULT : 1;
    const fogMult = fogSightMult(this.envFx?.getWeatherDynamics?.()?.fog ?? 0);
    for (const ent of this.ents.values()) {
      if (ent.side !== this.side || ent.isSelf || ent.dead || ent.hp <= 0) continue;
      if (ent.decoy && ent.lost) continue;   // 失聯餌機不回傳遙測(與伺服器同規則)
      const sight = UNITS[ent.kind]?.sight;
      if (sight == null) continue;
      out.push([ent.mesh.position.x, ent.mesh.position.z, sight * (ent.hero && ent.pid === this.youId ? aimF : 1) * fogMult]);
    }
    if (!this.dead && this.heroKind) {
      const sight = UNITS[this.heroKind]?.sight;
      if (sight != null) out.push([this.pos.x, this.pos.z, sight * aimF * fogMult]);
    }
    return out;
  }

  /**
   * 視野源(vx,vz,半徑 r)被障礙圓柱擋出的陰影多邊形(**世界座標**),供迷霧挖除。
   * 障礙 = terrain.blockers(建物/神木/巨岩/橋墩),半徑取 min(60, b.r)。建物的真正遮蔽體是**有向盒**
   * (2026-07-28 起彈道 `_blockerHitT` 與伺服器 `_losBlocked` 皆改吃盒),此處**刻意**維持圓近似:
   * 陰影是逐柱兩條切線圍出的扇形,換成盒得逐柱求輪廓四點,而這一層是**純顯示**的地圖罩 ——
   * 單位標記本來就由伺服器快照過濾(A10),罩畫寬畫窄都不影響誰看得到誰。高度不入帳同理。
   * 每柱兩條切線之外(遠端)= 本影:自切點沿切線方向延伸出視野外,由暫存罩的視野圓自然裁掉。
   * 高度不入帳:伺服器對「地面觀察者→地面目標」任何有碰撞的柱皆擋(眼高/目標高皆低於柱頂),
   * 這裡對齊地面偵測語意,一律當不透明圓 —— 寧可多霧(躲掩體者完全不可檢測)也不漏。
   *
   * **回傳世界座標而非小地圖座標**:同一組陰影要被畫進兩個不同的座標系 —— 「已探索」累積罩恆為
   * 全圖框(_world2mmFull),而目前視野的迷霧層跟著顯示窗走(_world2mm,周遭模式會縮放)。
   * 在這裡就轉成畫布座標的話,兩者只能對上一個,另一個的陰影會整片錯位。
   */
  _mmShadows(vx, vz, r) {
    const bl = this._blockersNear(vx, vz, r);
    if (!bl || !bl.length) return null;
    const out = [];
    const FAR = r * 2;   // 遠端延伸(超出視野圓,溢出部分被暫存罩裁掉)
    for (const b of bl) {
      const br = Math.min(60, b.r);
      if (br < 0.5) continue;
      const dx = b.x - vx, dz = b.z - vz;
      if (Math.abs(dx) > r + br || Math.abs(dz) > r + br) continue;
      const d = Math.hypot(dx, dz);
      if (d <= br) continue;          // 光源在障礙內 → 不投影
      if (d - br >= r) continue;       // 障礙整體在視野外
      if (br / d < 0.02) continue;     // 角徑過小(≈1°)→ 陰影可忽略
      const th = Math.atan2(dz, dx);
      const al = Math.asin(br / d);    // 切線半張角
      const tD = Math.sqrt(d * d - br * br);   // 切點距離
      const a0 = th - al, a1 = th + al;
      const c0 = Math.cos(a0), s0 = Math.sin(a0), c1 = Math.cos(a1), s1 = Math.sin(a1);
      out.push([
        [vx + c0 * tD, vz + s0 * tD],
        [vx + c0 * FAR, vz + s0 * FAR],
        [vx + c1 * FAR, vz + s1 * FAR],
        [vx + c1 * tD, vz + s1 * tD],
      ]);
      if (out.length >= 96) break;     // 密集市區防爆:上限 96 柱
    }
    return out;
  }

  /**
   * 小地圖顯示範圍切換(周遭 ⇄ 全部)。鍵盤 M 與觸控十字鍵右共用這一支 ——
   * MUST NOT 在任一輸入端自己翻旗標(舊版的 `minimapBig` 就是只有寫、沒有讀的死旗標)。
   * 鈕面亮燈走 body class(比照 `body.aiming .gb-aim`),觸控層不必知道有這個模式。
   */
  _toggleMmMode() {
    this.mmMode = this.mmMode === 'near' ? 'full' : 'near';
    this._mmLast = 0;   // 立刻重畫(小地圖是 5Hz,不歸零的話按下去要等一下才有反應)
    document.body.classList.toggle('mm-near', this.mmMode === 'near');
    this.hud?.feed?.(this.mmMode === 'near' ? '🗺️ 小地圖:周遭(視野範圍)' : '🗺️ 小地圖:全部(整張戰場)');
  }

  /**
   * 本幀的世界顯示窗 { x0, z0, x1, z1 }。full = 整張戰場(與舊版相同);
   * near = 以自機為中心、邊長 2r 的方窗(r 見 MM_NEAR)。
   * 方窗貼齊地圖邊界(不讓顯示窗跑到圖外留空白),故靠近邊界時自機不再置中 —— 這是刻意的。
   */
  _mmWindow() {
    const t = this.terrain;
    if (this.mmMode !== 'near') return { x0: t.minX, z0: t.minZ, x1: t.maxX, z1: t.maxZ };
    const sight = (this.heroKind && UNITS[this.heroKind]?.sight) || MM_NEAR.SPEC_R;
    const r = Math.max(MM_NEAR.MIN_R, sight * GAME.AIM_SIGHT_MULT * MM_NEAR.PAD);
    // 地圖比顯示窗還小的軸向 → 該軸退回全圖(不然會放大到超出邊界)
    const hw = Math.min(r, (t.maxX - t.minX) / 2), hh = Math.min(r, (t.maxZ - t.minZ) / 2);
    const cx = Math.max(t.minX + hw, Math.min(t.maxX - hw, this.pos.x));
    const cz = Math.max(t.minZ + hh, Math.min(t.maxZ - hh, this.pos.z));
    return { x0: cx - hw, z0: cz - hh, x1: cx + hw, z1: cz + hh };
  }

  /** 世界 → 小地圖畫布(**目前顯示窗**;標記/兵線/目前視野都用這支) */
  _world2mm(x, z, w, h) {
    const v = this._mmWin || this._mmWindow();
    return [(x - v.x0) / (v.x1 - v.x0) * w, (z - v.z0) / (v.z1 - v.z0) * h];
  }

  /**
   * 世界 → 小地圖畫布(**恆為全圖框**)。「已探索」累積罩 `_mmSeen` 是整場累積的持久資料,
   * 座標框 MUST NOT 隨顯示窗改變 —— 跟著窗跑的話,每切一次模式先前探索過的區域就整片錯位。
   * 周遭模式改在合成迷霧時裁切這張全圖罩(見 _drawMinimap 的 drawImage 九參數版)。
   */
  _world2mmFull(x, z, w, h) {
    const t = this.terrain;
    return [(x - t.minX) / (t.maxX - t.minX) * w, (z - t.minZ) / (t.maxZ - t.minZ) * h];
  }

  _drawMinimap(now) {
    // 開場暖機期降為 1Hz(純表現層節流,底圖/迷霧/標記算法一格未動)
    const mmGate = now < (this._mmWarmUntil || 0) ? 1.0 : 0.2;
    if (now - this._mmLast < mmGate) return;
    this._mmLast = now;
    const ctx = this.mmCtx;
    const w = this.minimapCanvas.width, h = this.minimapCanvas.height;
    const v = this._mmWin = this._mmWindow();   // 本幀顯示窗:_world2mm 與底圖裁切共用同一份
    // 底圖:原始圖資地形。周遭模式取全圖框裡對應的那一塊放大(底圖只烤全圖一次,見 _bakeMmBase)
    const [bx0, bz0] = this._world2mmFull(v.x0, v.z0, w, h);
    const [bx1, bz1] = this._world2mmFull(v.x1, v.z1, w, h);
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(this._mmBase, bx0, bz0, bx1 - bx0, bz1 - bz0, 0, 0, w, h);
    // 戰爭迷霧(觀戰無迷霧):未探索近全黑、已探索留暗紗、目前視野全亮。
    // 迷霧只壓底圖 —— 兵線(已知情報)與單位(快照本身就是伺服器迷霧過濾後的結果,
    // 塔/主堡恆可見)一律畫在迷霧之上,與伺服器可見性規則一致。
    if (this.side) {
      // 視野圈按 x/z 各自比例尺畫橢圓 —— battleBBox 是兵線包絡聯集,非恆正方形,
      // 正圓會與逐軸縮放的單位標記在被拉伸的軸向上對不齊。
      // **兩套比例尺**:F = 全圖框(已探索累積罩用)、V = 目前顯示窗(迷霧層用),周遭模式兩者不同。
      const scXF = w / (this.terrain.maxX - this.terrain.minX);
      const scZF = h / (this.terrain.maxZ - this.terrain.minZ);
      const scXV = w / (v.x1 - v.x0), scZV = h / (v.z1 - v.z0);
      const pulse = now < this._pulseUntil;   // 偵察脈衝:全隊無霧(鏡像 snapshotFor 的 pulse 旁路)
      const vis = this._mmVision();
      const sctx = this._mmSeen.getContext('2d');
      // 每源在暫存罩上先畫視野圓、再挖掉障礙陰影(_mmShadows),隔離後才合成 —— 建物/神木/巨岩背後
      // 的本影維持迷霧,與伺服器 _losBlocked 過濾單位同一份圓柱幾何(躲掩體者完全不可檢測)。
      const scc = this._mmScr.getContext('2d');
      const shadows = pulse ? null : vis.map(([vx, vz, r]) => this._mmShadows(vx, vz, r));
      // toMm = 本次要畫進哪個座標框(全圖罩 / 顯示窗迷霧層);陰影是世界座標,在這裡才落地
      const drawReveal = (mx, my, rx, ry, soft, polys, toMm) => {
        scc.globalCompositeOperation = 'source-over';
        scc.clearRect(0, 0, w, h);
        if (soft) {                    // 目前視野:柔邊漸層(縮放座標系畫橢圓)
          scc.save(); scc.translate(mx, my); scc.scale(1, ry / rx);
          const grad = scc.createRadialGradient(0, 0, rx * 0.72, 0, 0, rx);
          grad.addColorStop(0, 'rgba(0,0,0,1)'); grad.addColorStop(1, 'rgba(0,0,0,0)');
          scc.fillStyle = grad; scc.beginPath(); scc.arc(0, 0, rx, 0, 7); scc.fill(); scc.restore();
        } else {                       // 已探索累積:硬邊實心橢圓
          scc.fillStyle = '#fff';
          scc.beginPath(); scc.ellipse(mx, my, rx, ry, 0, 0, 7); scc.fill();
        }
        if (polys && polys.length) {   // 挖掉障礙本影(僅動本源暫存罩,不誤刪他源已照亮區)
          scc.globalCompositeOperation = 'destination-out';
          for (const p of polys) {
            const q = p.map(([wx, wz]) => toMm(wx, wz));
            scc.beginPath(); scc.moveTo(q[0][0], q[0][1]);
            for (let k = 1; k < q.length; k++) scc.lineTo(q[k][0], q[k][1]);
            scc.closePath(); scc.fill();
          }
        }
      };
      const toFull = (x, z) => this._world2mmFull(x, z, w, h);
      const toView = (x, z) => this._world2mm(x, z, w, h);
      if (pulse) { sctx.globalCompositeOperation = 'source-over'; sctx.fillStyle = '#fff'; sctx.fillRect(0, 0, w, h); }  // 脈衝看過的全圖進「已探索」
      else {
        sctx.globalCompositeOperation = 'source-over';
        for (let n = 0; n < vis.length; n++) {   // 已探索累積(整場保留:走過的地圖記得住,陰影區從未照亮不入帳)
          const [vx, vz, r] = vis[n];
          const [mx, my] = toFull(vx, vz);
          drawReveal(mx, my, Math.max(6, r * scXF), Math.max(6, r * scZF), false, shadows[n], toFull);
          sctx.drawImage(this._mmScr, 0, 0);
        }
        const f = this._mmFog.getContext('2d');
        f.globalCompositeOperation = 'source-over';
        f.globalAlpha = 1;
        f.clearRect(0, 0, w, h);
        f.fillStyle = 'rgba(4, 7, 11, 0.9)';
        f.fillRect(0, 0, w, h);
        f.globalCompositeOperation = 'destination-out';
        f.globalAlpha = 0.5;
        // 已探索:掀掉一半暗紗。全圖罩裁出顯示窗那一塊(full 模式即整張,等同舊版的 drawImage(0,0))
        f.drawImage(this._mmSeen, bx0, bz0, bx1 - bx0, bz1 - bz0, 0, 0, w, h);
        f.globalAlpha = 1;
        for (let n = 0; n < vis.length; n++) {   // 目前視野:全亮(柔邊 − 障礙陰影)
          const [vx, vz, r] = vis[n];
          const [mx, my] = toView(vx, vz);
          drawReveal(mx, my, Math.max(6, r * scXV), Math.max(6, r * scZV), true, shadows[n], toView);
          f.globalCompositeOperation = 'destination-out';
          f.drawImage(this._mmScr, 0, 0);
        }
        ctx.drawImage(this._mmFog, 0, 0);
      }
    }
    // 兵線:依立體交通分段畫線 —— 地面實線、高架橋 --- 虛線、地下道/隧道 ⋯ 點線
    // 顏色吃 data.js laneCssColor 唯一縫(中性引導色,避開陣營色),MUST NOT 手寫色表。
    ctx.lineWidth = 1.5;
    ctx.globalAlpha = 0.7;
    this._mmLanes.forEach((samples, i) => {
      if (samples.length < 2) return;
      ctx.strokeStyle = laneCssColor(this.cfg.laneIds?.[i] ?? i);
      let k = 0;
      while (k < samples.length - 1) {
        const gr = samples[k].grade;
        let e = k + 1;
        while (e < samples.length - 1 && samples[e].grade === gr) e++;
        ctx.setLineDash(gr === 'bridge' ? [5, 4] : gr === 'tunnel' ? [1.5, 3.5] : []);
        ctx.beginPath();
        for (let j = k; j <= e; j++) {
          const [mx, my] = this._world2mm(samples[j].x, samples[j].z, w, h);
          j === k ? ctx.moveTo(mx, my) : ctx.lineTo(mx, my);
        }
        ctx.stroke();
        k = e;
      }
    });
    ctx.setLineDash([]);
    ctx.globalAlpha = 1;
    // 單位(中立障礙不上圖:偵察情報要親眼看)
    for (const ent of this.ents.values()) {
      if (ent.neutral) continue;
      const [mx, my] = this._world2mm(ent.mesh.position.x, ent.mesh.position.z, w, h);
      const c = sideInfo(ent.side).color;   // 第三方(GUER/MILI)走各自識別色
      ctx.fillStyle = c;
      if (ent.kind === 'base') {
        ctx.fillRect(mx - 5, my - 5, 10, 10);
        ctx.strokeStyle = c; ctx.strokeRect(mx - 7, my - 7, 14, 14);
      } else if (ent.kind === 'tower') {
        ctx.fillRect(mx - 3, my - 3, 6, 6);
      } else if (ent.kind === 'bunker') {
        continue;   // 碉堡改由 _seenBunkers 永久標示(見下方持久層),避免離開視野即消失
      } else if (ent.hero) {
        if (!ent.isSelf) {
          ctx.beginPath(); ctx.arc(mx, my, 4, 0, 7); ctx.fill();
          // 英雄描邊即敵我:敵紅 / 友白(填充仍是陣營色,兩軌並存)
          const foe = this.side && ent.side !== this.side;
          ctx.lineWidth = foe ? 2 : 1.2;
          ctx.strokeStyle = foe ? '#ff5252' : '#ffffff'; ctx.stroke();
          if (foe) { ctx.beginPath(); ctx.arc(mx, my, 5.6, 0, 7); ctx.stroke(); }
        }
      } else {
        // NPC 兵團:填充 = 陣營色,描邊 = 敵我(敵紅/友白);直升機加外環,一眼看出空中單位
        const r = ent.kind === 'heli' ? 3 : 2.4;
        const foe = this.side && ent.side !== this.side;
        ctx.beginPath(); ctx.arc(mx, my, r, 0, 7); ctx.fill();
        ctx.lineWidth = foe ? 1.6 : 0.8;
        ctx.strokeStyle = foe ? '#ff5252' : (ent.side === this.side ? 'rgba(255,255,255,0.9)' : 'rgba(0,0,0,0.55)');
        ctx.stroke();
        if (ent.kind === 'heli') {
          ctx.beginPath(); ctx.arc(mx, my, r + 1.6, 0, 7);
          ctx.lineWidth = 1; ctx.strokeStyle = c; ctx.stroke();
        }
      }
    }
    // 已探索的第三方碉堡:永久標示(方塊 + 白框標記為已知據點),即使離開視野/摧毀待重建也保留
    for (const b of this._seenBunkers.values()) {
      const [mx, my] = this._world2mm(b.x, b.z, w, h);
      ctx.fillStyle = sideInfo(b.side).color;
      ctx.fillRect(mx - 2.5, my - 2.5, 5, 5);
      ctx.lineWidth = 1; ctx.strokeStyle = 'rgba(255,255,255,0.75)';
      ctx.strokeRect(mx - 3.5, my - 3.5, 7, 7);
    }
    // 防空飛彈(紅點)
    ctx.fillStyle = '#ff5533';
    for (const ms of this.samMeshes.values()) {
      const [mx, my] = this._world2mm(ms.mesh.position.x, ms.mesh.position.z, w, h);
      ctx.fillRect(mx - 1.5, my - 1.5, 3, 3);
    }
    // 自己(視角箭頭)
    if (this.side) {
      const [mx, my] = this._world2mm(this.pos.x, this.pos.z, w, h);
      ctx.save();
      ctx.translate(mx, my);
      ctx.rotate(-(this.viewMode === 'tps' ? this.bodyYaw : this.yaw));   // 前方 = (−sinYaw,−cosYaw);世界→小地圖同號 ⇒ θ = −yaw(舊 +π 讓箭頭反向)
      ctx.fillStyle = '#ffffff';
      ctx.beginPath();
      ctx.moveTo(0, -7); ctx.lineTo(4.5, 5); ctx.lineTo(-4.5, 5);
      ctx.closePath(); ctx.fill();
      ctx.restore();
    }
    // 目前顯示範圍(左下角):兩種模式的畫面在市區可能長得很像 —— 沒有這一行,
    // 玩家會以為地圖壞了而不是自己切過模式。周遭模式另加標尺寬度(公尺)當比例尺。
    const label = this.mmMode === 'near' ? `周遭 ${Math.round(v.x1 - v.x0)}m` : '全部';
    ctx.font = '10px monospace';
    ctx.textAlign = 'left'; ctx.textBaseline = 'bottom';
    ctx.fillStyle = 'rgba(4, 7, 11, 0.72)';
    ctx.fillRect(2, h - 14, ctx.measureText(label).width + 8, 13);
    ctx.fillStyle = this.mmMode === 'near' ? '#a9dd6b' : 'rgba(255,255,255,0.78)';
    ctx.fillText(label, 6, h - 3);
  }

  // ---------------- 畫面轉場(序 8 ④-1)----------------
  /**
   * 「遮幕 → 切 → 揭幕」的**唯一實作**(三個呼叫點:陣亡過場收尾 / 結算 / 未來的章節切換)。
   * 幕本體、時間軸與 pass 都住 `postfx.js` + `data.js WIPE`(lane-ink 的 S 契約);
   * 這一支只決定**什麼時候切**與**切點上要做什麼**。
   *
   * ⚠ `cover` 播完之後幕停在**全覆蓋**(`wipeAt` 的 `t ≥ dur ⇒ w1 = 1, w2 = 0` 是定義)——
   * 呼叫端 MUST 自己接一段 `reveal`,否則畫面就停在一整片幕色上而且沒有任何錯誤訊息。
   * 那一對 MUST 寫在**同一個地方**:分散到三個呼叫點各寫一次,遲早有一個只寫了前半。
   *
   * 旋鈕 `wipe` = 0(預設)時 `playWipe` **當場同步走回呼並回 false** ⇒ 這一支等價於
   * `onCut()` 一行 —— 連呼叫時序都逐位元同舊制(`hud.over` 不會晚 0.34 秒)。
   * `pipeline` 不存在(`?post=0`)或那支 API 還沒上線時同理降級(原則 6)。
   * @returns 有沒有真的播幕(false = 旋鈕關著 / 沒有管線,呼叫端不必自己判)
   */
  _wipeCut(onCut, color = null) {
    const p = this.pipeline;
    if (typeof p?.playWipe !== 'function') { onCut?.(); return false; }
    const opts = color != null ? { color } : null;
    return p.playWipe('cover', () => {
      onCut?.();
      p.playWipe('reveal', null, opts);
    }, opts);
  }

  // ---------------- 主迴圈 ----------------
  _loop() {
    if (this.disposed) return;
    this._raf = requestAnimationFrame(() => this._loop());
    const raw = this.clock.getDelta();          // 未夾制幀時:自適應解析度要看真實負載
    let dt = Math.min(0.1, raw);
    const now = performance.now() / 1000;
    this._tickResGov(raw * 1000, now);          // 全平台(撐得住時一次都不會調)

    // Hitstop(頓點):拆塔/擊殺瞬間全域凍結 50~120ms 強調打擊重量,期間照常渲染
    if (this._hitstop > 0) { this._hitstop -= dt; dt = 0; }

    if (this._snapQueue) { this._applySnap(this._snapQueue); this._snapQueue = null; }
    this._drainSpawnPend();   // 開場分幀建模:MUST 在 _updateEnts 之前,建好的首幀即進插值

    // 觸控版每幀入口:①疊層(選單/商店/結束)開著就收起虛擬搖桿 ②視角搖桿積分。
    // 兩件事都 MUST 在幀迴圈做 —— 疊層的開關散在 _setPaused / _toggleShop / 結束事件三處,
    // 漏接一處就會回到「疊層點不動」(見 mobile.js syncBlocked 的堆疊脈絡說明);
    // 視角搖桿則是持續輸入,只在 pointermove 算的話手指不動就會停住。
    this.touch?.tick(dt);

    this._updateAaMode();             // 榴彈對空彈射模式:MUST 在 _tickWeapons(擊發)之前定案
    this._lobAim();                   // 榴彈火控解(消費 _aaEnt):同樣 MUST 在擊發之前 —— 所見即所射
    this._tickWeapons(now);
    this._tickBurstFx(now);           // 連發演出補畫:MUST 排在擊發之後(本幀那一輪同幀進佇列)
    this._tickNumpadLook(dt);         // 數字九宮格持續視角:MUST 在 _updatePlayer(消費 yaw/pitch)之前
    this._updatePlayer(dt, now);
    // 致盲白幕是整個視野的表現層，不綁玩家移動或 FPV 座艙；TPS 與 FPV 共用同一消費點。
    if (this.side && !this.dead) this._updateCcFlash(dt);
    if (this._deathSeq && !this._gameOver) this._updateDeathSeq(dt, now);   // 陣亡過場獨佔鏡頭(_updatePlayer 已對 dead 早退)
    this._updateEnts(dt, now);
    this._updateBossBar(now);
    this._updateViewOcclusion(now);
    this._updateDissolveGhosts(dt);   // 實體先摘出 ents,殘影只在這條純渲染路徑收尾
    this._updateRangeGlows();         // 這一發會傷到的單位才亮範圍光暈(鎖定目標另有 lockGlow)
    this._updateMoveAudio();          // 移動環境音(旋翼/引擎/振翅/震地;低功耗自動全關)
    this._updateBullets(dt);
    this._updateMissiles(dt);
    this._updateVisShells(dt);
    this._updateDecoyBombs(dt);       // 餌機投彈拋擲動畫(2026-07-22)
    this._updateArcGuide();           // 榴彈拋物線瞄準指示(2026-07-22)
    this._updateGuideLaser();         // 雷射導引武器的第一人稱導引雷射(2026-07-23)
    this.laneGuidance?.userData.update(now);
    this._updateMines(now);
    this._updateLoot(dt, now);
    this._updateAirdrop(dt, now);
    this._updateDamageFx(dt, now);
    this._updateEffects(dt);
    for (const s of this.hitShells) s.userData.update(dt);
    if (this._auras) for (const ent of this._auras) {   // 補血光環 / 第三方射程環:緩慢脈動
      const p = 0.22 + 0.12 * Math.sin(now * 1.6);
      ent.auraRing.material.opacity = p;
      // 移動的第三方單位(soldier/tank/heli 巡邏/追擊):射程環跟著機體貼地移動;
      // 靜態的 base 補血光環與 bunker 射程環(isStatic)固定不動。
      if (!ent.isStatic && ent.aura) {
        const mx = ent.mesh.position.x, mz = ent.mesh.position.z;
        ent.aura.position.set(mx, this.terrain.heightAt(mx, mz) + 0.6, mz);
      }
    }
    // 全場風的時鐘(植被/旗幟的頂點擺動 + 雲的漂移同吃)。MUST 排在 `envFx.update` 之前:
    // 雲那半讀的是 `celWindTime()`,晚一步就跟地面上的草差一幀。
    stepCelWind(dt);
    // ⑤-1 玩家位移擾動:把「誰在哪裡、走多快」餵給同一批軟性材質(唯一寫入點 = setCelChar)。
    // MUST 排在 `_updateEnts` **之後** —— 那時 `ent.mesh.position` 才是本幀插值完的值;
    // 也 MUST NOT 併進 `stepCelWind(dt)` 的簽章(`audit_soft_stroke` Ⅴ 釘死那一支的呼叫形狀)。
    setCelChar(this._charSlots());
    // 沼澤漣漪(2026-08-26):推進沼澤水面的局部圓形漣漪(純表現層)。
    // MUST 排在 stepCelWind 之後(漣漪吃 windT 作為生成時間戳)。
    // 沼澤格點只在首次呼叫時建(地形在對局中不變);無沼澤 ⇒ 空陣列 ⇒ 早退。
    // 沼澤格點分 ~6 幀掃完:全圖 terrainEnvCode 掃描不擠開場首幀,結果與一次掃完逐項相同。
    // 掃完前 _swampCells 維持 undefined ⇒ stepSwampRipples 早退(見 toon.js 檔頭),純表現層缺席數幀。
    if (!this._swampCells && this.terrain?.waterY != null) {
      const t = this.terrain, step = 20;
      const rows = Math.ceil((t.maxZ - t.minZ) / step);
      const perFrame = Math.max(1, Math.ceil(rows / 6));
      const sc = this._swampAcc ?? (this._swampAcc = []);
      let z = this._swampZ ?? t.minZ, done = 0;
      for (; z < t.maxZ && done < perFrame; z += step, done++)
        for (let x = t.minX; x < t.maxX; x += step)
          if (terrainEnvCode(t, x, z) === 2) sc.push({ x, z });
      if (z >= t.maxZ) { this._swampCells = sc; this._swampAcc = null; this._swampZ = null; }
      else this._swampZ = z;
    }
    stepSwampRipples(this._swampCells, dt);
    // 日夜循環:鐘點 = f(開場時段, **伺服器權威的經過秒數**)。快照 8Hz 且秒數取整 ⇒ 兩幀之間
    // 自己補 dt(48× 的速率下,1 秒的量化誤差 = 太陽轉 0.8°,補不補都看不出來;不補的話
    // 天色會以 8Hz 一格一格跳)。MUST NOT 改成純本地時鐘 —— 那會讓兩台客戶端的天色分家。
    this._simT += dt;
    this.envFx?.update(dt, this.camera, this._simT);
    // 空氣透視的兩個顏色跟著天色走 ⇒ **每幀重推**(它們是 environment.js 那一份的同一個實例)
    const airNow = this.envFx?.air;
    if (airNow) this.pipeline?.setAirFog(airNow.near, airNow.far, airNow.fogNear, airNow.fogFar);
    this.terrain.biomesUpdate?.(dt);   // 地貌動態物件(火車 / 瀑布)
    for (const m of this.mixers) m.update(dt);
    for (const g of this.spinners) {
      stepUnitSpinners(g.userData.spin, dt);
    }
    // 座艙:旋翼恆轉、撲翼拍動、型態切換、槍身後坐回彈、槍口焰熄滅
    if (this.cockpit) {
      const ct = (this._cockT += dt);
      // 自轉件是**真品旋翼的複本**(_cockBody 以自轉節點為樞軸複製)⇒ 轉速 MUST 與第三人稱
      // 那一條(上面的 `spinners`)同值,否則同一具旋翼在座艙裡與世界裡轉得不一樣快。
      stepUnitSpinners(this.cockpitSpin, dt);
      for (const f of this.cockpitFlap) f.o.rotation[f.ax] = f.base + f.amp * Math.sin(ct * f.hz * 6.283 + f.ph);
      this._syncCockpitWeapon();
      this.weaponKick = Math.max(0, this.weaponKick - dt * 9);
      const cur = this._curWeapon();
      let reloadOff = { dz: 0, dy: 0, rx: 0 };
      if (cur.def && cur.st && cur.st.reloadEnd > 0) {
        // 進度分母 = 武器階級解析後的填彈時長(含大雪氣候倍率)
        const rl = cur.st.reloadDur || (cur.def.reload * (this.env?.getWeatherDynamics?.()?.snowCdMul ?? 1));
        const p = 1 - Math.max(0, cur.st.reloadEnd - now) / Math.max(0.001, rl);
        reloadOff = this._reloadAnimOffset(cur.def, p);
      }
      // 武裝姿勢:後座 + 填彈 + 榴彈超高仰角。三者都 MUST 夾在 `_solveGunPose` 反解出來的
      // 包絡內(見那一支檔頭),而抬升繞的是**武裝自己的掛點**不是鏡頭。
      // 榴彈砲口跟著火控解抬高:拋物線武器本就不是沿準星直射,砲管平指才是穿幫。
      const want = reloadOff.rx + (this._lobFc?.on ? this._lobFc.sup : 0);
      const lift = Math.max(-(this._gunDrop || 0), Math.min(want, this._gunLift || 0));
      const pull = Math.min(this.weaponKick * 0.11 + reloadOff.dz, this._gunPull || 0);
      const P = this._gunPivot || _ZERO3;
      const lc = Math.cos(lift), ls = Math.sin(lift);
      this.gunGroup.rotation.x = lift;
      this.gunGroup.position.set(
        0,
        reloadOff.dy + P.y - (P.y * lc - P.z * ls),
        this._gunBaseZ + pull + P.z - (P.y * ls + P.z * lc),
      );
      if (this._flashTtl != null) {
        this._flashTtl -= dt;
        if (this._flashTtl <= 0) { this.flash.visible = false; this._flashTtl = null; }
        else this.flash.scale.setScalar((0.7 + Math.random() * 0.7) * (this._flashHeavy ? 2.3 : 1));
      }
      this.cockpit.visible = this.viewMode === 'fpv' && (!this.dead || !!this._deathSeq);   // 只在第一人稱顯示座艙;第三人稱死亡過場仍保留機體
    }
    this._updateWaterVeil();   // 水下/沼澤視野變色(最終 camera 定案後、render 前)
    // HUD 下帶的高是內容撐出來的(爬升條 / 觀戰面板 / 僚機列會增減)⇒ 逐幀量會強制 layout,
    // 節流到 HUD_FIT_S 一次:那是「多久之後才發現超線」的上限,不是動畫,肉眼看不出來。
    if (now - (this._hudFitAt || 0) > HUD_FIT_S) { this._hudFitAt = now; fitHudBand(); }
    this._drawMinimap(now);
    updateCelLight(this.camera);   // 硬邊金屬高光帶的 view-space 光向
    // 景深**只在狙擊模式**(2026-08-09 使用者補充)。強度由**已定案的 camera.fov** 反解 ⇒
    // 與右鍵拉近是結構上同一條曲線,MUST NOT 改判 `this.aiming` 布林(進鏡瞬間硬切)、
    // 更 MUST NOT 自己跑一條淡入(第二條時間曲線 = 模糊比鏡頭慢半拍)。與 `updateCelLight`
    // 同一層:相機定案之後、render 之前,而且**這是唯一的呼叫點** —— 散在狀態機裡的話,
    // 陣亡/觀戰那幾條路留著上一幀的值就是「死了畫面還糊著」。
    // 觀戰的滾輪縮放也吃 camera.fov ⇒ 明確排除(否則拉遠會被誤讀成進鏡)。
    this.pipeline?.setDofBlend(this.side && !this.dead
      ? dofAimBlend(this.camera.fov, this.baseFov, UNITS[this.heroKind]?.zoomFov ?? this.baseFov) : 0);
    // 後製管線結束時 render target 一律歸零 ⇒ 後面的 PiP / 陣亡鏡頭照樣直接畫在畫布上(行為不變)
    // MUST run after `_updateEnts` (positions are this frame's interpolated values)
    // and before `_tickCull`: shells/attachments are persistent child switches,
    // cull is a whole-mesh switch restored around render -- the layers never meet.
    this._tickGeoLod();
    this._tickCull();
    this._tickTexStream();
    this._renderCulledMain();
    this._renderPips();
    this._renderDeathCam();
    this.hud.locked?.(now < (this._lockedUntil || 0));
    // 平民互動提示:靠近平民時顯示「[G]跟隨 [H]驅趕」+ 其陣營(不揭露間諜)
    const nc = this._nearestCiv();
    this._civTarget = nc;
    this.hud.civPrompt?.(nc ? { cs: nc.cs, self: nc.cs === this.side, follow: !!nc.fo } : null);
  }

  // ---------------- Geometric LOD (presentation only) ----------------
  /**
   * Per-entity detail verdict: hides geoDetail micro parts past GEO.TRIM_M and
   * inverted-hull outline shells past GEO.OUTLINE_M. Child visibility only --
   * mesh.visible (collision/audio/foe gates) and hit volumes never change, so
   * unlike _tickCull no render-window restore is needed. Staggered by lodDue
   * (same hash as tick LOD/cull: reconnects agree), hysteresis in geoKeep stops
   * boundary flapping, aimBlend extends both bands under sniper magnification.
   * First sighting evaluates immediately (prev undefined bypasses the stagger
   * gate) so far spawns never pay one full-detail frame. Self never trims.
   * Vegetation whole-map InstancedMesh batches have no per-instance distance
   * and stay out until batches gain a spatial index; they already opt out of
   * outlines (noOut) and decimate per-frame work via lod.js tick bands.
   */
  _tickGeoLod() {
    if (!this.camera || !this.ents) return;
    const camP = this.camera.position;
    const frame = this._lodFrame | 0;
    let aimBlend = 0;
    try {
      aimBlend = (this.side && !this.dead)
        ? dofAimBlend(this.camera.fov, this.baseFov, UNITS[this.heroKind]?.zoomFov ?? this.baseFov) : 0;
    } catch { aimBlend = 0; }
    const tick = (ent, key) => {
      if (ent.isSelf || ent.dead || ent.gar) return;
      const mesh = ent.mesh;
      if (!mesh || !mesh.visible) return;
      if (ent._geoTrim !== undefined && !lodDue(frame, key, GEO.STRIDE)) return;
      const p = mesh.position;
      const h = ent.dimH || 4;
      const dx = p.x - camP.x, dy = (p.y + h * 0.5) - camP.y, dz = p.z - camP.z;
      const d2 = dx * dx + dy * dy + dz * dz;
      const trimHi = geoTrimKeep(d2, aimBlend, ent._geoTrim);
      const outHi = geoOutlineKeep(d2, aimBlend, ent._geoOut);
      if (trimHi === ent._geoTrim && outHi === ent._geoOut) return;
      ent._geoTrim = trimHi;
      ent._geoOut = outHi;
      applyGeoLod(mesh, trimHi, outHi);
    };
    for (const ent of this.ents.values()) tick(ent, ent.id ?? ent.kind ?? 0);
    for (const b of this.mapBuildings?.values() || []) if (b.record?.mesh) tick(b, b.id ?? 0);
  }

  // ---------------- Pre-shading cull (presentation only) ----------------
  /**
   * Collect this._culled WITHOUT touching visibility: gameplay gates read
   * mesh.visible (collision, audio, foe()), so the hide/restore pair lives
   * strictly inside the synchronous _renderCulledMain window below. PiP and
   * deathcam render after restore, hence always see the full scene (small
   * viewports; correctness over savings there). Threshold truth stays in
   * data.js (dofNearM/dofFarM/scopeRvminFog) and lod.js (lodDue stagger);
   * predicates stay in cull.js. Spectators/dead gate aimBlend to 0 (wheel zoom
   * would misread as sniper blend, same reason setDofBlend gates on side).
   */
  _tickCull() {
    this._culled = null;
    if (!this.camera || !this.ents) return;
    const cam = this.camera, camP = cam.position;
    cam.updateMatrixWorld();
    const frustum = this._cullFrustum || (this._cullFrustum = new THREE.Frustum());
    const cm = this._cullM || (this._cullM = new THREE.Matrix4());
    frustum.setFromProjectionMatrix(cm.multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse));
    let aimBlend = 0;
    try {
      aimBlend = (this.side && !this.dead)
        ? dofAimBlend(cam.fov, this.baseFov, UNITS[this.heroKind]?.zoomFov ?? this.baseFov) : 0;
    } catch { aimBlend = 0; }
    const farNear = dofNearM(), farFar = dofFarM();
    let rPx = 0, projF = 0, HW = 0, HH = 0;
    if (aimBlend > CULL.AIM_BLEND_EPS) {
      const W = this.canvas.clientWidth, H = this.canvas.clientHeight;
      HW = W / 2; HH = H / 2;
      const rScope = scopeRvminFog(this._scopeFog || 0, this._weatherFogD || 0) / 100 * Math.min(W, H);
      rPx = scopeRadiusPx(rScope, HW, HH, aimBlend);
      projF = HH / Math.tan(THREE.MathUtils.degToRad(cam.fov) * 0.5);
    }
    let occ = this._cullOcc;
    if (!occ || this._cullOccDirty) {
      occ = this._cullOcc || (this._cullOcc = []);
      occ.length = 0;
      for (const b of this.mapBuildings?.values() || []) {
        const r = b.record?.bounds;
        if (!r || b.collapsed || b.record?.cleared) continue;
        // Inscribed sphere radius of the building AABB/OBB: never protrudes
        // outside walls or roof (circumscribed hypot false-occludes on narrow/low boxes).
        const or = Math.min(r.w, r.d, r.h) * 0.5;
        if (or < CULL.OCCLUDE_MIN_R_M) continue;
        occ.push(r.x, r.y + r.h * 0.5, r.z, or);
      }
      this._cullOccDirty = false;
    }
    const frame = this._lodFrame | 0;
    const v = this._cullV || (this._cullV = new THREE.Vector3());
    const s = this._cullS || (this._cullS = new THREE.Sphere());
    const out = this._cullOut || (this._cullOut = []);
    out.length = 0;
    const occMin2 = CULL.OCCLUDE_MIN_M * CULL.OCCLUDE_MIN_M;
    const consider = (ent, isUnit) => {
      if (ent.isSelf || ent.dead || ent.gar) return;
      const mesh = ent.mesh;
      if (!mesh || !mesh.visible) return;
      if (ent.id != null && ent.id === this._vlockId) return;   // locked target never culls (no lock flicker)
      const p = mesh.position;
      // Live scale widens the authored spawn-time bounds: boss / super-form
      // scaling with an unscaled sphere is a straight false-cull of the crown.
      const msc = mesh.scale;
      const sk = Math.max(1, msc.x || 1, msc.y || 1, msc.z || 1);
      const h = ent.dimH || 4;
      const top = ent.dimTop ?? h;
      const rHoriz = ent.dimR || 2;
      const rTgt = Math.max(rHoriz, h * 0.5) * sk;
      // 3D circumsphere + additive guard (FRUSTUM_PAD_M): overhead HP bars,
      // faction markers, ground rings, and rotated 3D box corners extend beyond
      // the 1D axial max rTgt and must never pop at viewport/scope edges.
      const rFrustum = Math.hypot(rHoriz * Math.SQRT2, h * 0.5) * sk * CULL.FRUSTUM_PAD_F + CULL.FRUSTUM_PAD_M;
      const cx = p.x, cy = p.y + (top - h * 0.5) * sk, cz = p.z;
      const dx = cx - camP.x, dy = cy - camP.y, dz = cz - camP.z;
      const d2 = dx * dx + dy * dy + dz * dz;
      // Distance hysteresis: cull past far, re-admit inside far*HYST.
      // Interpolation jitter exactly on the boundary otherwise shimmers in/out.
      // Static blockers skip this tier: their colliders stay live while culled,
      // so a far tower reads as open road then pops in on approach (invisible
      // wall). Frustum/occlusion/scope below still apply.
      const staticBlocker = ent.isStatic || ent.kind === 'tower' || ent.kind === 'base'
        || ent.kind === 'mapbuilding';
      const far = cullFarM(farNear, farFar, rTgt, aimBlend, isUnit);
      let dc = ent._distCull;
      if (staticBlocker) dc = false;
      else if (dc === undefined) dc = !keepDistance(d2, far);
      else if (dc) { const b = far * CULL.DIST_HYST; dc = d2 > b * b; }
      else dc = !keepDistance(d2, far);
      ent._distCull = dc;
      if (dc) { ent._cullFrame = frame; out.push(ent); return; }
      s.center.set(cx, cy, cz); s.radius = rFrustum;
      if (!frustum.intersectsSphere(s)) { ent._cullFrame = frame; out.push(ent); return; }
      // Scope mask skips the near field and any sphere straddling the camera:
      // perspective projection inside rFrustum (or behind camera z > 1) produces
      // inverted/wild NDC while the object still covers the screen.
      if (rPx > 0 && d2 > Math.max(25, rFrustum * rFrustum)) {
        v.set(cx, cy, cz).project(cam);
        const d = Math.sqrt(d2) || 1;
        if (v.z <= 1 && !scopeKeep(v.x * HW, v.y * HH, rPx, (rFrustum / d) * projF * CULL.SCOPE_PAD_F)) { ent._cullFrame = frame; out.push(ent); return; }
      }
      // Occlusion verdict persists between staggered re-tests: testing 1-in-4
      // frames while hiding only on test frames is a 15Hz blink (and the
      // per-frame visibility flapping churns the render list = stutter).
      // Re-test when due, or when either end moved enough (3D) to void the stamp.
      // Static blockers skip this tier too: an occluded tower still collides
      // and fires while hidden, and parallax on approach flaps the single-margin
      // verdict into a disappear/reappear blink. Frustum/scope still apply.
      if (!staticBlocker && d2 > occMin2 && occ.length) {
        const moved = ent._occX === undefined
          || (p.x - ent._occX) * (p.x - ent._occX) + (p.y - ent._occY) * (p.y - ent._occY) + (p.z - ent._occZ) * (p.z - ent._occZ) > 1
          || (camP.x - ent._occCX) * (camP.x - ent._occCX) + (camP.y - ent._occCY) * (camP.y - ent._occCY) + (camP.z - ent._occCZ) * (camP.z - ent._occCZ) > 4;
        if (moved || lodDue(frame, ent.id ?? ent.kind ?? 0, CULL.OCCLUDE_STRIDE)) {
          ent._occCull = false;
          const dTgt = Math.sqrt(d2);
          const ix = dx / dTgt, iy = dy / dTgt, iz = dz / dTgt;
          for (let i = 0; i < occ.length; i += 4) {
            const ox = occ[i] - camP.x, oy = occ[i + 1] - camP.y, oz = occ[i + 2] - camP.z;
            const t = ox * ix + oy * iy + oz * iz;
            if (t <= 0 || t >= dTgt) continue;
            const qx = ox - ix * t, qy = oy - iy * t, qz = oz - iz * t;
            if (occludedBySphere(dTgt, Math.sqrt(ox * ox + oy * oy + oz * oz),
              Math.sqrt(qx * qx + qy * qy + qz * qz), rTgt, occ[i + 3])) { ent._occCull = true; break; }
          }
          ent._occX = p.x; ent._occY = p.y; ent._occZ = p.z;
          ent._occCX = camP.x; ent._occCY = camP.y; ent._occCZ = camP.z;
        }
        if (ent._occCull) { ent._cullFrame = frame; out.push(ent); return; }
      } else {
        ent._occCull = false;
      }
    };
    for (const ent of this.ents.values())
      consider(ent, !!(ent.hero || ent.decoy || ent.civ || ent.isStatic || ent.kind === 'tower' || ent.kind === 'base'));
    for (const b of this.mapBuildings?.values() || []) if (b.record?.mesh) consider(b, true);
    if (out.length) this._culled = out;
    this._cullStamp = frame;
    this._cullAimBlend = aimBlend;
    this._cullRPx = rPx;
    this._cullProjF = projF;
    this._cullHW = HW;
    this._cullHH = HH;
  }

  // ---------------- Texture streaming / Virtual Texturing (presentation only) ----------------
  /**
   * Camera-view & distance-driven VRAM mip streaming:
   * - Runs after `_tickCull()` and before `_renderCulledMain()` so frame-0 (`forceAll`)
   *   downgrades distant/off-screen textures before `renderer.render()` uploads them.
   * - Only textures inside the camera frustum (and sniper scope circle when zoomed,
   *   and unoccluded for dynamic entities) keep their distance-matched mip tier
   *   (level 0/1/2); distant (`> FAR_M`) or invisible/culled textures drop to
   *   `maxDrop` (`chain.slice(maxDrop)`) in VRAM via `applyTexLevel`.
   */
  _tickTexStream() {
    if (!this.camera) return;
    const cam = this.camera, camP = cam.position;
    const frame = this._lodFrame | 0;
    let frustum = this._cullFrustum;
    let aimBlend = 0, rPx = 0, projF = 0, HW = 0, HH = 0;
    if (frustum && this._cullStamp === frame) {
      aimBlend = this._cullAimBlend || 0;
      rPx = this._cullRPx || 0;
      projF = this._cullProjF || 0;
      HW = this._cullHW || 0;
      HH = this._cullHH || 0;
    } else {
      cam.updateMatrixWorld();
      frustum = frustum || (this._cullFrustum = new THREE.Frustum());
      const cm = this._cullM || (this._cullM = new THREE.Matrix4());
      frustum.setFromProjectionMatrix(cm.multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse));
      try {
        aimBlend = (this.side && !this.dead)
          ? dofAimBlend(cam.fov, this.baseFov, UNITS[this.heroKind]?.zoomFov ?? this.baseFov) : 0;
      } catch { aimBlend = 0; }
      if (aimBlend > CULL.AIM_BLEND_EPS && this.canvas) {
        const W = this.canvas.clientWidth, H = this.canvas.clientHeight;
        HW = W / 2; HH = H / 2;
        const rScope = scopeRvminFog(this._scopeFog || 0, this._weatherFogD || 0) / 100 * Math.min(W, H);
        rPx = scopeRadiusPx(rScope, HW, HH, aimBlend);
        projF = HH / Math.tan(THREE.MathUtils.degToRad(cam.fov) * 0.5);
      }
    }
    const me = cam.matrixWorld?.elements;
    let camFx = me ? -me[8] : 0, camFy = me ? -me[9] : 0, camFz = me ? -me[10] : -1;
    const camFL = Math.hypot(camFx, camFy, camFz) || 1;
    camFx /= camFL; camFy /= camFL; camFz /= camFL;

    let occ = this._cullOcc;
    if ((!occ || this._cullOccDirty) && this.mapBuildings) {
      occ = this._cullOcc || (this._cullOcc = []);
      occ.length = 0;
      for (const b of this.mapBuildings.values()) {
        const r = b.record?.bounds;
        if (!r || b.collapsed || b.record?.cleared) continue;
        const or = Math.min(r.w, r.d, r.h) * 0.5;
        if (or < CULL.OCCLUDE_MIN_R_M) continue;
        occ.push(r.x, r.y + r.h * 0.5, r.z, or);
      }
      this._cullOccDirty = false;
    }
    const occMin = CULL.OCCLUDE_MIN_M;
    const isSphereOccluded = (dx, dy, dz, dTgt, rTgt) => {
      if (!occ || !occ.length || dTgt <= occMin) return false;
      const ix = dx / dTgt, iy = dy / dTgt, iz = dz / dTgt;
      for (let i = 0; i < occ.length; i += 4) {
        const ox = occ[i] - camP.x, oy = occ[i + 1] - camP.y, oz = occ[i + 2] - camP.z;
        const t = ox * ix + oy * iy + oz * iz;
        if (t <= 0 || t >= dTgt) continue;
        const qx = ox - ix * t, qy = oy - iy * t, qz = oz - iz * t;
        if (occludedBySphere(dTgt, Math.sqrt(ox * ox + oy * oy + oz * oz),
          Math.sqrt(qx * qx + qy * qy + qz * qz), rTgt, occ[i + 3])) return true;
      }
      return false;
    };

    const v = this._cullV || (this._cullV = new THREE.Vector3());
    const s = this._cullS || (this._cullS = new THREE.Sphere());
    const reg = this._streamTexReg || (this._streamTexReg = new Set());
    const cullActive = this._cullStamp === frame;
    const forceAll = !this._texStreamInit;
    const anyDue = (texs) => {
      if (forceAll) return true;
      for (let i = 0; i < texs.length; i++) {
        const st = texs[i].userData?.texStream;
        if (st && (!st.init || lodDue(frame, st.id, TEX_STREAM.STRIDE))) return true;
      }
      return false;
    };

    const evalEnt = (ent) => {
      const mesh = ent?.mesh;
      if (!mesh) return;
      if (ent._streamMesh !== mesh) {
        ent._streamMesh = mesh;
        ent._streamTexs = collectTreeStreamTexs(mesh);
        for (const t of ent._streamTexs) reg.add(t);
      }
      const texs = ent._streamTexs;
      if (!texs || !texs.length || !anyDue(texs)) return;
      if (ent.isSelf && !ent.dead) {
        for (const t of texs) noteTexDemand(t, 0, true, frame);
        return;
      }
      if (ent.dead || ent.gar || ent.record?.cleared || !mesh.visible || (cullActive && ent._cullFrame === frame)) {
        for (const t of texs) noteTexDemand(t, Infinity, false, frame);
        return;
      }
      const p = mesh.position;
      const msc = mesh.scale;
      const sk = Math.max(1, msc?.x || 1, msc?.y || 1, msc?.z || 1);
      const h = ent.dimH || 4;
      const top = ent.dimTop ?? h;
      const rHoriz = ent.dimR || 2;
      const rTgt = Math.max(rHoriz, h * 0.5) * sk;
      const rFrustum = Math.hypot(rHoriz * Math.SQRT2, h * 0.5) * sk * CULL.FRUSTUM_PAD_F + CULL.FRUSTUM_PAD_M;
      const cx = p.x, cy = p.y + (top - h * 0.5) * sk, cz = p.z;
      const dx = cx - camP.x, dy = cy - camP.y, dz = cz - camP.z;
      const dCenter = Math.sqrt(dx * dx + dy * dy + dz * dz);
      const dSurf = Math.max(0, dCenter - rTgt);
      const d2 = dSurf * dSurf;
      let vis = dx * camFx + dy * camFy + dz * camFz >= -rTgt;
      if (vis && !cullActive) {
        s.center.set(cx, cy, cz);
        s.radius = rFrustum;
        vis = frustum.intersectsSphere(s);
        if (vis && rPx > 0 && dCenter * dCenter > Math.max(25, rFrustum * rFrustum)) {
          v.set(cx, cy, cz).project(cam);
          if (v.z <= 1 && !scopeKeep(v.x * HW, v.y * HH, rPx, (rFrustum / (dCenter || 1)) * projF * CULL.SCOPE_PAD_F)) vis = false;
        }
      }
      if (vis) {
        const staticBlocker = ent.isStatic || ent.kind === 'tower' || ent.kind === 'base' || ent.kind === 'mapbuilding';
        if ((staticBlocker || !cullActive) && isSphereOccluded(dx, dy, dz, dCenter, rTgt)) vis = false;
      }
      for (const t of texs) noteTexDemand(t, d2, vis, frame);
    };

    if (this.ents) for (const ent of this.ents.values()) evalEnt(ent);
    if (this.mapBuildings) for (const b of this.mapBuildings.values()) if (b.record?.mesh) evalEnt(b);

    const evalStaticRoot = (root) => {
      if (!root) return;
      const ud = root.userData || (root.userData = {});
      if (!ud._streamEntries) {
        root.updateMatrixWorld(true);
        const entries = [];
        const pagedEntries = [];
        root.traverse((o) => {
          if (!o.isMesh) return;
          const texs = [];
          const m = o.material;
          if (Array.isArray(m)) {
            for (const sub of m) collectMatStreamTexs(sub, texs);
          } else if (m) {
            collectMatStreamTexs(m, texs);
          }
          const st = o.userData?.signTex;
          if (st?.userData?.texStream && !texs.includes(st)) texs.push(st);
          if (!texs.length) return;
          const nonPaged = [];
          for (const t of texs) {
            reg.add(t);
            if (t.userData?.texStream?.pages?.length) {
              pagedEntries.push({ mesh: o, tex: t });
            } else {
              nonPaged.push(t);
            }
          }
          if (nonPaged.length) {
            entries.push({
              mesh: o,
              texs: nonPaged,
              anchors: meshStreamAnchors(o, TEX_STREAM.CELL_M),
            });
          }
        });
        ud._streamEntries = entries;
        ud._streamPagedTexs = pagedEntries;
      }
      for (const entry of ud._streamEntries) {
        if (!anyDue(entry.texs)) continue;
        if (!entry.mesh.visible) {
          for (const t of entry.texs) noteTexDemand(t, Infinity, false, frame);
          continue;
        }
        let bestD2 = Infinity;
        let anyVis = false;
        for (const a of entry.anchors) {
          const r = Math.max(2, a.r || 2);
          const dx = a.x - camP.x, dy = a.y - camP.y, dz = a.z - camP.z;
          if (dx * camFx + dy * camFy + dz * camFz < -r) continue;
          const rFrustum = r * CULL.FRUSTUM_PAD_F;
          s.center.set(a.x, a.y, a.z);
          s.radius = rFrustum;
          if (!frustum.intersectsSphere(s)) continue;
          const dCenter = Math.sqrt(dx * dx + dy * dy + dz * dz);
          if (rPx > 0 && dCenter * dCenter > Math.max(25, rFrustum * rFrustum)) {
            v.set(a.x, a.y, a.z).project(cam);
            if (v.z <= 1 && !scopeKeep(v.x * HW, v.y * HH, rPx, (rFrustum / (dCenter || 1)) * projF * CULL.SCOPE_PAD_F)) continue;
          }
          if (isSphereOccluded(dx, dy, dz, dCenter, r)) continue;
          const dSurf = Math.max(0, dCenter - r);
          const d2 = dSurf * dSurf;
          anyVis = true;
          if (d2 < bestD2) bestD2 = d2;
        }
        for (const t of entry.texs) noteTexDemand(t, bestD2, anyVis, frame);
      }
      if (ud._streamPagedTexs) {
        for (const pe of ud._streamPagedTexs) {
          const t = pe.tex;
          if (!anyDue([t])) continue;
          const pages = t.userData?.texStream?.pages;
          if (!pages || !pages.length) continue;
          if (!pe.mesh.visible) {
            for (let i = 0; i < pages.length; i++) notePageDemand(t, i, Infinity, false, frame);
            continue;
          }
          for (let i = 0; i < pages.length; i++) {
            const pg = pages[i];
            const r = Math.max(2, pg.r || 2);
            const dx = pg.x - camP.x, dy = pg.y - camP.y, dz = pg.z - camP.z;
            if (dx * camFx + dy * camFy + dz * camFz < -r) {
              notePageDemand(t, i, Infinity, false, frame);
              continue;
            }
            const rFrustum = r * CULL.FRUSTUM_PAD_F;
            s.center.set(pg.x, pg.y, pg.z);
            s.radius = rFrustum;
            if (!frustum.intersectsSphere(s)) {
              notePageDemand(t, i, Infinity, false, frame);
              continue;
            }
            const dCenter = Math.sqrt(dx * dx + dy * dy + dz * dz);
            if (rPx > 0 && dCenter * dCenter > Math.max(25, rFrustum * rFrustum)) {
              v.set(pg.x, pg.y, pg.z).project(cam);
              if (v.z <= 1 && !scopeKeep(v.x * HW, v.y * HH, rPx, (rFrustum / (dCenter || 1)) * projF * CULL.SCOPE_PAD_F)) {
                notePageDemand(t, i, Infinity, false, frame);
                continue;
              }
            }
            if (isSphereOccluded(dx, dy, dz, dCenter, r)) {
              notePageDemand(t, i, Infinity, false, frame);
              continue;
            }
            const dSurf = Math.max(0, dCenter - r);
            notePageDemand(t, i, dSurf * dSurf, true, frame);
          }
        }
      }
    };

    evalStaticRoot(this.biomes);
    evalStaticRoot(this.terrain?.group);

    const maxAniso = this._maxAniso || (this._maxAniso = this.renderer?.capabilities?.getMaxAnisotropy?.() || 0);
    this._texStreamInit = true;
    this._texStreamStats = flushTexStream(reg, frame, aimBlend, { isDue: lodDue, forceAll, maxAniso });
  }

  /** Main-scene render with the culled set hidden; restores before PiP. */
  _renderCulledMain() {
    const list = this._culled;
    if (list) for (const ent of list) ent.mesh.visible = false;
    if (this.pipeline) this.pipeline.render(); else this.renderer.render(this.scene, this.camera);
    if (list) { for (const ent of list) ent.mesh.visible = true; this._culled = null; }
  }

  // ---------------- 副視窗(PiP)----------------
  /**
   * 需要小螢幕的視角:蜂群 = 非主視野的僚機(最多 2 個);機甲 = 空中的餌機(1 個)。
   * 集束轟炸機失聯後不再回傳畫面 → 不渲染(HUD 由 hud.feed 播報鏈路中斷)。
   */
  _pipSources() {
    const out = [];
    if (!this.side || this.dead) return out;
    for (const ent of this.ents.values()) {
      if (ent.pid !== this.youId) continue;
      if (this.isDrone) {
        if (ent.hero && !ent.isSelf && !ent.dead) out.push({ ent, tag: `${ent.si + 1}號機` });
      } else if (ent.decoy && !ent.lost) {
        out.push({ ent, tag: '餌機' });
      }
    }
    // 每個小螢幕 = **再繪一次整個場景**(scissor 只縮小填充範圍,幾何照樣整批送出);
    // 蜂群兩架僚機 ⇒ 一幀畫三次場景。低功耗模式(手機預設開)或負載調降時(_resScale < 1)收成 1 個,主視野幀率優先。
    // 高功耗/桌機維持 2 個,行為不變。
    const maxPips = (lowPower() || (this._resScale && this._resScale < 1)) ? 1 : 2;
    return out.sort((a, b) => a.ent.si - b.ent.si).slice(0, maxPips);
  }

  /**
   * 在主畫面左上角疊畫小螢幕:scissor 限制清除/繪製範圍,同一個 scene 重繪。
   * 座艙掛在主相機底下、來源機體自己的模型 → 兩者都要在該次繪製中藏起來。
   */
  _renderPips() {
    const list = this._pipSources();
    if (!list.length) return;
    const W = this.canvas.clientWidth, H = this.canvas.clientHeight;
    const pw = Math.round(Math.min(PIP.MAX_W, W * PIP.W_FRAC));
    const ph = Math.round(pw * PIP.ASPECT);
    const r = this.renderer;
    const cockVis = this.cockpit?.visible;
    if (this.cockpit) this.cockpit.visible = false;
    // setClearColor 是 renderer 全域狀態:畫外框會蓋掉它,收工前必須還原
    const clear0 = r.getClearColor(this._pipClear0 || (this._pipClear0 = new THREE.Color()));
    const alpha0 = r.getClearAlpha();
    this.pipCam.aspect = pw / ph;
    this.pipCam.updateProjectionMatrix();
    r.setScissorTest(true);
    list.forEach((p, i) => {
      const x = PIP.PAD;
      const y = H - PIP.TOP - ph - i * (ph + PIP.GAP);   // scissor 原點在左下,由上往下疊
      const m = p.ent.mesh;
      this.pipCam.position.copy(m.position);
      this.pipCam.position.y += p.ent.decoy ? 0.6 : 1.2;
      // ry 是相機朝向慣例(前方 = -z),模型才要 +π
      this.pipCam.rotation.set(0, p.ent.ry, 0, 'YXZ');
      // 外框:先清一圈陣營色,再把內圈交給場景繪製
      r.setScissor(x - 2, y - 2, pw + 4, ph + 4);
      r.setClearColor(sideInfo(this.side).color, 1);
      r.clear(true, false, false);
      r.setViewport(x, y, pw, ph);
      r.setScissor(x, y, pw, ph);
      const wasVisible = m.visible;
      m.visible = false;              // 不要從自己的鼻子裡往外看
      r.render(this.scene, this.pipCam);
      m.visible = wasVisible;
    });
    r.setScissorTest(false);
    r.setViewport(0, 0, W, H);
    r.setClearColor(clear0, alpha0);
    if (this.cockpit) this.cockpit.visible = cockVis;
  }

  /**
   * 陣亡頁的「最前線砲塔視角」小視窗:離敵堡最近的存活我方砲塔往敵方看(無砲塔 → 我方主堡;皆無 → 陣亡點俯瞰)。
   * 與 _renderPips 同法(scissor 在主 canvas 上重繪場景),但視窗位置對齊 DOM 框 #deadCam
   * (該框內部透明,外圈由 CSS box-shadow 打洞式變暗);共用 pipCam(陣亡時 _renderPips 早退不衝突)。
   */
  _renderDeathCam() {
    if (!this.dead || this._deathSeq || this._gameOver || !this.side || !this.cfg) return;   // 過場播放中不繪砲塔視窗
    const frame = document.getElementById('deadCam');
    if (!frame || frame.offsetParent === null) return;   // 陣亡頁未顯示 → 不繪

    const enemy = this.side === 'SWARM' ? 'STEEL' : 'SWARM';
    const [ex, ez] = llToWorld(this.cfg.bases[enemy][0], this.cfg.bases[enemy][1], this.center);
    // 最前線 = 離敵堡最近的存活我方砲塔;查無 → 我方主堡
    let src = null, best = Infinity;
    for (const e of this.ents.values()) {
      if (e.kind !== 'tower' || e.side !== this.side || e.dead || !e.mesh) continue;
      const d = (e.mesh.position.x - ex) ** 2 + (e.mesh.position.z - ez) ** 2;
      if (d < best) { best = d; src = e; }
    }
    if (!src) for (const e of this.ents.values()) {
      if (e.kind === 'base' && e.side === this.side && e.mesh) { src = e; break; }
    }

    const cam = this.pipCam;
    if (src) {
      const m = src.mesh.position;
      cam.position.set(m.x, m.y + (src.dimTop || 14) + 2, m.z);
      cam.up.set(0, 1, 0);
      // 朝敵堡方向 100m 外近地面看 → 自然俯瞰兵線來襲方向
      const dx = ex - m.x, dz = ez - m.z, dl = Math.hypot(dx, dz) || 1;
      cam.lookAt(m.x + dx / dl * 100, m.y + 1, m.z + dz / dl * 100);
    } else {
      // 降級視角(無存活防禦塔與主堡時,如劇情戰役進攻方或殘局):由陣亡點高空俯瞰戰場
      const px = this.pos.x, pz = this.pos.z;
      const py = this._surf(px, pz, Infinity) + 18;
      cam.position.set(px, py, pz);
      cam.up.set(0, 1, 0);
      const dx = ex - px, dz = ez - pz, dl = Math.hypot(dx, dz) || 1;
      cam.lookAt(px + dx / dl * 80, py - 6, pz + dz / dl * 80);
    }

    const r = this.renderer, canvas = this.canvas;
    const cr = canvas.getBoundingClientRect(), fr = frame.getBoundingClientRect();
    const bw = 2;   // 內縮 CSS 邊框
    const px = fr.left - cr.left + bw, pw = fr.width - bw * 2, ph = fr.height - bw * 2;
    const y = canvas.clientHeight - (fr.top - cr.top + bw) - ph;   // scissor 原點左下
    if (pw < 6 || ph < 6) return;
    cam.aspect = pw / ph;
    cam.updateProjectionMatrix();

    const cockVis = this.cockpit?.visible;
    if (this.cockpit) this.cockpit.visible = false;
    const srcVis = src?.mesh?.visible;
    if (src?.mesh) src.mesh.visible = false;   // 隱藏自身模型,避免相機在幾何內部被遮擋穿模
    const clear0 = r.getClearColor(this._pipClear0 || (this._pipClear0 = new THREE.Color())), alpha0 = r.getClearAlpha();
    r.setScissorTest(true);
    r.setViewport(px, y, pw, ph);
    r.setScissor(px, y, pw, ph);
    r.render(this.scene, cam);   // autoClear 只清 scissor 內
    r.setScissorTest(false);
    r.setViewport(0, 0, canvas.clientWidth, canvas.clientHeight);
    r.setClearColor(clear0, alpha0);
    if (src?.mesh) src.mesh.visible = srcVis;
    if (this.cockpit) this.cockpit.visible = cockVis;
  }

  dispose() {
    for (const ent of this.ents.values()) { releaseLightningScorch(ent); releaseMobileDamage(ent); }
    for (const ent of this.samMeshes.values()) releaseMobileDamage(ent);
    for (const ghost of this._dissolveGhosts || []) if (ghost.damageEnt) releaseMobileDamage(ghost.damageEnt);
    this.disposed = true;
    this._clearViewOcclusion();
    this.audio?.setScene('menu');   // 離開戰場 → BGM 交還大廳(audio 為 app 層物件,不在此銷毀)
    this.audio?._stopMove();        // 移動環境音聲道靜音(離場後 _updateMoveAudio 不再餵值 → 需主動收)
    this.cutin?.dispose();
    this.envFx?.dispose();
    this.pipeline?.dispose();        // A25:3 個 RT + depthTexture + 3 個全螢幕材質
    this.pipeline = null;
    cancelAnimationFrame(this._raf);
    this._offResize?.();             // 視窗尺寸定案的訂閱(mobile.js onViewportSettled)
    window.removeEventListener('keydown', this._onKey);
    window.removeEventListener('keyup', this._onKey);
    document.removeEventListener('mousemove', this._onMouseMove);
    this.canvas.removeEventListener('mousedown', this._onMouseDown);
    window.removeEventListener('mouseup', this._onMouseUp);
    this.canvas.removeEventListener('contextmenu', this._onCtx);
    this.canvas.removeEventListener('wheel', this._onWheel);
    document.removeEventListener('pointerlockchange', this._onPlc);
    this._offCtrl?.();               // 操作方式訂閱 MUST 跟著戰局收掉(留著 = 下一局重建一個殭屍搖桿層)
    this._offCtrl = null;
    this._offView?.();
    this._offView = null;
    this.touch?.dispose();
    this.touch = null;
    document.body.classList.remove('mm-near');   // 小地圖模式的鈕面亮燈掛在 body,跟著戰局收掉
    document.body.classList.remove('aiming');    // 狙擊遮罩的鈕面/黑邊跟著戰局收掉
    document.body.classList.remove('spectating', 'spec-follow');   // 觀戰版型同理(留著 = 下一局角色數據面板被收起)
    document.body.classList.remove('has-boss-bar');
    this.hud?.bossBar?.(null);
    this._vlockHold = false; this._vlockId = null; this._vlockPrev = null;
    this._setVlockUi(false);                     // 視野鎖定的亮燈同理(留著 = 下一局開場就亮)
    document.exitPointerLock?.();
    // 離場清帳:一次性特效 / 飛行中彈體 / 彈體池全部釋放 GPU 資源。
    // 不釋放的話「回大廳再開一局」會把上一局的殭屍緩衝一路帶著走(共用幾何由註冊表跳過)。
    for (const e of this.effects) this._freeEffect(e);
    this.effects.length = 0;
    for (const list of [this.bullets, this._visShells, this._decoyBombs]) {
      for (const b of list || []) { this.scene.remove(b.mesh); disposeTree(b.mesh); }
      if (list) list.length = 0;
    }
    if (this._projPool) { for (const l of this._projPool.values()) for (const m of l) disposeTree(m); this._projPool = null; }
    // 高頻池一併釋放(曳光幾何 + sprite/曳光材質;記錄/殼是純 CPU 物件,置空即回收)
    this._tracerPool?.clear((line) => { line.geometry.dispose(); line.material.dispose(); });
    this._tracerPool = null;
    this._spritePoolFire?.clear((sp) => sp.material.dispose());
    this._spritePoolFire = null;
    this._spritePoolSmoke?.clear((sp) => sp.material.dispose());
    this._spritePoolSmoke = null;
    this._fireTexC?.dispose(); this._fireTexC = null;
    this._smokeTexC?.dispose(); this._smokeTexC = null;
    this._recPool?.clear(); this._recPool = null;
    this._fxShellPool?.clear(); this._fxShellPool = null;
    this._cullOcc = null; this._cullOut = null; this._culled = null;
    this._streamTexReg?.clear(); this._streamTexReg = null;
    this._texStreamStats = null;
    if (this.laneGuidance) { this.scene.remove(this.laneGuidance); disposeTree(this.laneGuidance); this.laneGuidance = null; }
    this.renderer.dispose();
  }
}
