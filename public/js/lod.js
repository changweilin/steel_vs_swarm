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
  const d = Math.max(0, dist || 0);
  return lodStrideByD2(d * d, lowPower);
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

// ============ Geometric LOD (sole seam; presentation only) ============
// Tick LOD above decimates *when* heavy channels run; this tier switches *what*
// is drawn by camera distance: small attachments first, outline shells second,
// whole-object cull (cull.js) last. Silhouette never changes, so no pop in shape.
// Vegetation whole-map InstancedMesh batches have no per-instance distance:
// they stay out until batches gain a spatial index; per-entity Groups call in.
//
// Anchors (presentation, NOT balance): TRIM_M ~= tick NEAR_M (inside tower-range
// scale full detail still reads); OUTLINE_M ~= tick MID_M (tower range; the
// screen-space ink pass keeps edges after hull shells drop). TRIM_R_M: a 0.3m
// part reads <=2px at the trim boundary (fov68), sub-pixel past it. All three
// sit inside DOF near (combatReach*1.5), and ZOOM_F slides them into the
// full-blur ring under sniper magnification (mirrors cull.js small-prop extension).
export const GEO = {
  TRIM_M: 150,      // userData.geoDetail nodes hide beyond here
  OUTLINE_M: 300,   // userData.isOutline shells hide beyond here
  TRIM_R_M: 0.15,   // auto-flag threshold: mesh world bounding-sphere radius (m)
  HYST: 0.9,        // re-admit inside base*HYST (wider than CULL.DIST_HYST: slower re-test)
  STRIDE: 4,        // re-test cadence via lodDue (same as CULL.OCCLUDE_STRIDE)
  ZOOM_F: 1.0,      // effective = base*(1+ZOOM_F*aimBlend); full zoom doubles both bands
};

/** Effective far plane with sniper-blend extension (aimBlend = dofAimBlend of fov). */
export function geoFarM(baseM, aimBlend) {
  const a = aimBlend < 0 ? 0 : aimBlend > 1 ? 1 : aimBlend || 0;
  return Math.max(0, baseM || 0) * (1 + GEO.ZOOM_F * a);
}

/**
 * Hysteresis keep test on squared distance. prevHi undefined = first sighting.
 * True = keep the high-detail tier. Sticky both ways: drops past far, returns
 * only inside far*HYST, so interpolation jitter on the boundary never flaps.
 */
export function geoKeep(d2, farM, prevHi) {
  const f2 = farM * farM;
  if (prevHi === undefined) return d2 <= f2;
  if (prevHi) return d2 <= f2;
  const b = farM * GEO.HYST;
  return d2 <= b * b;
}

/** Trim-tier keep (small attachments). */
export function geoTrimKeep(d2, aimBlend, prevHi) {
  return geoKeep(d2, geoFarM(GEO.TRIM_M, aimBlend), prevHi);
}
/** Outline-tier keep (inverted-hull shells). */
export function geoOutlineKeep(d2, aimBlend, prevHi) {
  return geoKeep(d2, geoFarM(GEO.OUTLINE_M, aimBlend), prevHi);
}

/**
 * Micro-part auto-flag predicate (sole seam for the trim rule).
 * rM = mesh world bounding-sphere radius (m); o = role descriptor
 * { outline, ring, keep, transparent, er, eg, eb, ei }.
 * True = this mesh may hide past GEO.TRIM_M. Visibility-driven nodes MUST be
 * excluded by the caller via keep (flames, morph fades: locomotion owns their
 * visible state every heavy frame -- flagging them fights that driver when
 * near). Emissive cues (muzzle rings, visors, headlights) read past trim
 * range, hence stay; the emissive bar mirrors bakeContactAO (toon.js).
 */
export function geoTrimTest(rM, o = {}) {
  if (!(rM < GEO.TRIM_R_M)) return false;
  if (o.outline || o.ring || o.keep || o.transparent) return false;
  const e = (o.er || 0) + (o.eg || 0) + (o.eb || 0);
  if (e > 0.05 && (o.ei ?? 1) >= 0.5) return false;
  return true;
}

/**
 * Apply a geometric LOD verdict to a unit/building Group (duck-typed: traverse
 * + visible + userData only, no THREE import so offline audits run it raw).
 * Touches exactly two node classes, both presentation-only:
 *   isOutline  -> outlineHi controls inverted-hull shells (toon.js outlinify)
 *   geoDetail  -> trimHi controls builder-flagged micro parts (antennae etc)
 * userData.geoKeep opts out of both (muzzle flames, morph fades: locomotion
 * owns their visible state). Everything else (teamRing, muzzle glows, bars,
 * shields, rig anchors) is never matched, so hit volumes, paint order and
 * dissolve ghosts are intact.
 * Dissolve ghosts are already out of ents when they run; live Ents never
 * dissolve, hence no ownership fight over shell visibility.
 * @returns flips applied (0 = already in state; lets callers skip redundant passes)
 */
export function applyGeoLod(root, trimHi, outlineHi) {
  if (!root || typeof root.traverse !== 'function') return 0;
  let n = 0;
  root.traverse((o) => {
    const u = o.userData;
    if (!u || u.geoKeep) return;
    if (u.isOutline) {
      if (o.visible !== outlineHi) { o.visible = outlineHi; n++; }
    } else if (u.geoDetail) {
      if (o.visible !== trimHi) { o.visible = trimHi; n++; }
    }
  });
  return n;
}
