// ============ Pre-shading culling math (sole seam; presentation only) ============
// Goal: filter invisible objects before they enter the expensive shading pipeline.
// Three culls, one file:
//
//   frustum   - evaluated in game.js with THREE.Frustum (already a single impl);
//               this file holds no second copy of the plane math.
//   occlusion - conservative angular cover: a target sphere hides only when a
//               building sphere strictly in front covers its full angular extent.
//   distance  - hide beyond the fully-blurred ring so the pop sits inside DOF
//               blur (data.js DOF header: disappearance was pre-aligned there).
//
// Why a separate file: game.js (main render), lod.js (tick decimation) and any
// future static-chunk culling all need the same thresholds. A copied constant
// set rots into two culling systems. Threshold derivations live here; the
// absolute anchors (dofNearM/dofFarM, AIM_SIGHT_MULT, scopeRvminFog) stay in
// data.js and are passed in -- this file MUST NOT hand-write meters.
//
// Boundaries:
//   - Pure presentation (same layer as lod.js / visualPrefs): server MUST NOT
//     import. Authority HP / damage / outcome never cull.
//   - Zero imports (same reason as lod.js / rng.js): offline audits run it raw.
//   - Stagger via lod.js lodDue (NOT a second hash here): reconnects agree.
//   - Render-window only: game.js flips visibility around the synchronous main
//     render and restores before PiP/deathcam. Gameplay gates that read
//     mesh.visible (collision, audio, foe()) never observe the culled state.
//   - Sniper vs normal is one continuous blend (dofAimBlend of camera.fov),
//     NOT an aiming boolean: fov eases while the boolean flips instantly, so a
//     boolean gate would pop one frame early on scope-in and linger on scope-out.
//
// Normal vs sniper behavior:
//   - Normal (fov 68, wide): frustum is large so frustum culling saves little;
//     distance + occlusion carry the savings.
//   - Sniper (fov 35, ~2.14x zoom, narrow): frustum volume collapses so frustum
//     culling is highly effective; but magnified small props resolve farther,
//     hence the small-object far plane extends with aim blend. The scope mask
//     (DOM overlay) shades nothing -- the matching GPU saving comes from
//     scopeKeep(), which culls what the black mask would cover anyway.

/** Tunables (presentation only; changing them never changes damage or range). */
export const CULL = {
  SMALL_R_M: 2,       // Below this bounding radius = "small prop" tier.
  OCCLUDE_MARGIN: 0.03, // Angular slack (rad) against false occlusion pops.
  SCOPE_PAD_F: 1.12,  // Screen-space pad on the scope-circle test.
  FRUSTUM_PAD_F: 1.08, // Sphere growth for the frustum test only (edge shimmer).
  DIST_HYST: 0.95,    // Distance re-admit band: cull past far, return inside far*HYST.
  OCCLUDE_STRIDE: 4,  // Occlusion re-tests per entity (frames; via lodDue).
  OCCLUDE_MIN_M: 60,  // Below this camera distance occlusion never pays off.
  OCCLUDE_MIN_R_M: 8, // Only buildings this wide qualify as occluders.
};

const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);

/**
 * Distance far plane (m) for one object.
 * baseNear/baseFar = dofNearM()/dofFarM() from data.js (caller-owned truth).
 * Units always reach baseFar (threat readability outranks savings); small props
 * hide mid-blur-ramp normally and extend to baseFar under full zoom, so the
 * sniper never watches a distant prop wink out through 2.14x magnification.
 */
export function cullFarM(baseNear, baseFar, radius, aimBlend, isUnit) {
  const n = Math.max(0, baseNear || 0), f = Math.max(n, baseFar || 0);
  if (isUnit) return f;
  if ((radius || 0) < CULL.SMALL_R_M) return n + (f - n) * (0.5 + 0.5 * clamp01(aimBlend || 0));
  return f;
}

/** Squared-distance keep test (hot path: skips sqrt). True = keep rendering. */
export function keepDistance(d2, farM) {
  return d2 <= farM * farM;
}

/**
 * Conservative sphere-occluded predicate on precomputed scalars.
 * dTgt/dOcc = camera distance to target / occluder centers; perp = shortest
 * distance from occluder center to the camera->target axis; rTgt/rOcc bound
 * the real geometry from outside / inside respectively (caller-owned).
 * True only when the occluder sits strictly in front AND its angular radius
 * covers the target's angular radius plus separation, minus margin.
 */
export function occludedBySphere(dTgt, dOcc, perp, rTgt, rOcc, margin = CULL.OCCLUDE_MARGIN) {
  if (!(dOcc > 0) || !(dTgt > dOcc)) return false;
  if (!(dOcc + rOcc < dTgt - rTgt)) return false;
  return (perp + rTgt) / dTgt < rOcc / dOcc - margin;
}

/**
 * Sniper scope-circle keep test in pixels. (dxPx, dyPx) = target center offset
 * from screen center; rPx = scopeRvminFog circle; padPx = target screen radius
 * (caller projects with the live camera so zoom is structural, not a second
 * curve). True = keep rendering. Normal mode never calls this (no mask).
 */
export function scopeKeep(dxPx, dyPx, rPx, padPx) {
  const rr = Math.max(0, rPx || 0) + Math.max(0, padPx || 0);
  return dxPx * dxPx + dyPx * dyPx <= rr * rr;
}
