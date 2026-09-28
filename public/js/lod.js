// ============ Distance LOD tick decimation (sole seam; presentation only) ============
// Far NPCs / objects skip expensive per-frame work (skeletal animation, surface
// sampling, turret aim) and update every Nth frame with accumulated dt. Position
// interpolation stays every frame so nothing pops; only the heavy channels decimate.
//
// Why a separate file: game.js (_updateEnts), biomes.js (wildlife flocks) and any
// future ambient dynamics all need the same bands. A copied constant set rots into
// two LOD systems. This file is the single settlement point.
//
// Boundaries:
//   - Pure presentation (same layer as visualPrefs / lowPower): server MUST NOT
//     import. Authority HP / damage / outcome never decimate.
//   - Zero imports (same reason as animweights.js / rng.js): offline audits run it raw.
//   - Deterministic stagger via FNV-1a of entity id (NOT Math.random, NOT shared
//     mulberry32): reconnects and multi-client agree on which frame updates.
//   - Frame-rate independence: callers accumulate real dt and pass the sum on update
//     frames, so damp() via lerpFPS/frictionFPS converges identically at 30/60/144Hz.
//   - Distance anchors are presentation (tower-range scale / sniper sight / DOF full
//     blur), NOT balance numbers: tuning them never changes damage or range.

/** Distance bands (m). Anchors: NEAR ~= tower-range scale, MID ~= 2x tower range,
 *  FAR ~= DOF full-blur distance (dofAimBlend). Beyond FAR = ambient backdrop. */
export const LOD = {
  NEAR_M: 150,
  MID_M: 300,
  FAR_M: 600,
  STRIDE_NEAR: 1,
  STRIDE_MID: 2,
  STRIDE_FAR: 4,
  STRIDE_VERYFAR: 6,
  STRIDE_MAX_LOWPOWER: 8,
};

/** FNV-1a hash of an entity id -> stable uint (same shape as locomotion phaseOf). */
export function lodHash(id) {
  let h = 2166136261;
  const s = String(id);
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}

/** Distance -> update stride (frames per heavy update). Self / near = 1 (no-op). */
export function lodStride(dist, lowPower = false) {
  let s = dist < LOD.NEAR_M ? LOD.STRIDE_NEAR
    : dist < LOD.MID_M ? LOD.STRIDE_MID
    : dist < LOD.FAR_M ? LOD.STRIDE_FAR
    : LOD.STRIDE_VERYFAR;
  if (lowPower && s > 1) s = Math.min(LOD.STRIDE_MAX_LOWPOWER, s * 2);
  return s;
}

/** Squared-distance variant (hot path: skips sqrt; thresholds pre-squared). */
export function lodStrideByD2(d2, lowPower = false) {
  const n = LOD.NEAR_M * LOD.NEAR_M, m = LOD.MID_M * LOD.MID_M, f = LOD.FAR_M * LOD.FAR_M;
  let s = d2 < n ? LOD.STRIDE_NEAR : d2 < m ? LOD.STRIDE_MID : d2 < f ? LOD.STRIDE_FAR : LOD.STRIDE_VERYFAR;
  if (lowPower && s > 1) s = Math.min(LOD.STRIDE_MAX_LOWPOWER, s * 2);
  return s;
}

/** True on frames this entity owns the heavy channels (staggered by id hash). */
export function lodDue(frame, id, stride) {
  if (stride <= 1) return true;
  return ((frame + lodHash(id)) % stride) === 0;
}

/** Camera-less time slice for ambient flocks: slot [0,div) owns this frame. */
export function lodSlot(frame, slot, div) {
  if (div <= 1) return true;
  return (frame % div) === (slot % div);
}
