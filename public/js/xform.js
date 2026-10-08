// ============ Part x instance transform math (pure functions, zero dependencies) ============
// Vegetation / sacred trees assemble from declarative part tables + per-plant instance transforms: parts carry px/pz (offset from axis),
// y (height), rx/rz (branch tilt), sy (vertical squash); instances carry x/y/z (landing point), s (build),
// ry (facing), tx/tz (per-plant stance micro-tilt), dj (detail seed, see below).
//
// Single seam (section 2.1): render-side buildVegMeshes in biomes.js and offline audit tools/audit_object_joints.mjs
// share this same file, so part-joint correctness is checked against the real thing.
//
// Contract: instance facing and micro-tilt MUST apply as one rigid whole-plant transform -- place parts in plant-local space first,
// then rotate the whole plant. MUST NOT fold ry/tx/tz into each part's own Euler angles:
//   1. three Euler XYZ = Rx * Ry * Rz, which sandwiches ry in the middle, so any part with rx non-zero
//      (branch forks, hanging lichen, hives) gets its direction scrambled by plant facing, while offsets only take horizontal rotation
//      -- forks point elsewhere and joints split open.
//   2. If micro-tilt rotates each part around its own center, part centers stay put, so the result is not whole-plant tilt but
//      trunk segments shearing past each other (steps appear on joint faces).
// Joint completeness MUST be independent of ry/tx/tz; that is the only reason this file exists.

/** three Euler order XYZ (R = Rx * Ry * Rz) -> quaternion [x,y,z,w] */
export function quatFromEuler(x, y, z) {
  const c1 = Math.cos(x / 2), c2 = Math.cos(y / 2), c3 = Math.cos(z / 2);
  const s1 = Math.sin(x / 2), s2 = Math.sin(y / 2), s3 = Math.sin(z / 2);
  return [
    s1 * c2 * c3 + c1 * s2 * s3,
    c1 * s2 * c3 - s1 * c2 * s3,
    c1 * c2 * s3 + s1 * s2 * c3,
    c1 * c2 * c3 - s1 * s2 * s3,
  ];
}

/** Quaternion multiply (a post-multiplied by b: equivalent rotation matrix Ra * Rb) */
export function quatMul(a, b) {
  const [ax, ay, az, aw] = a, [bx, by, bz, bw] = b;
  return [
    aw * bx + ax * bw + ay * bz - az * by,
    aw * by - ax * bz + ay * bw + az * bx,
    aw * bz + ax * by - ay * bx + az * bw,
    aw * bw - ax * bx - ay * by - az * bz,
  ];
}

/** Rotate a vector by a quaternion */
export function quatApply(q, v) {
  const [x, y, z, w] = q, [vx, vy, vz] = v;
  const tx = 2 * (y * vz - z * vy), ty = 2 * (z * vx - x * vz), tz = 2 * (x * vy - y * vx);
  return [
    vx + w * tx + (y * tz - z * ty),
    vy + w * ty + (z * tx - x * tz),
    vz + w * tz + (x * ty - y * tx),
  ];
}

// ---- Detail jitter (user decision 2026-07-29: natural objects should not look too symmetric or tidy) ----
// dj = per-plant detail seed (0-1, drawn at placement; undefined/0 = no jitter, bit-identical to the old scheme).
// Only two joint-safe degrees of freedom move:
//   1. jr: horizontal radius grows only, never shrinks (scale anchored at part center; y and px/pz offsets plus vertical size untouched) --
//      fattening only buries parts deeper; MUST NOT become two-way jitter (shrinking pulls apart nominally flush joints:
//      eucalyptus trunk clusters / moss clusters FLOAT once shrunk, caught red by audit_object_joints).
//      Crowns / leaf clusters (with key) +0-18 percent, structural parts (trunk/branch) +0-8 percent (visual radius still inside the
//      authoritative collision-column margin, principle 4); parts may carry a j multiplier (e.g. borderrock with j:2) to widen amplitude.
//   2. spin: rotation about the part's own extrusion axis (post-multiplied quaternion = local axis, endpoints fixed) --
//      stacked-cone edges stagger per layer and ico clusters change silhouette, so two plants of the same type no longer share one silhouette.
//      Axial parts only (px/pz = 0): offset parts (trunk-hugging clusters / moss) mate through specifically oriented
//      vertices, and spin would rotate an exact fit open (proven by euc trunk-cluster FLOAT failures in audit).
// MUST NOT jitter y / px / pz / vertical scale (pulls stacked seams apart); jitter depends only on (part identity, dj),
// independent of ry/tx/tz (A27 joint-completeness invariant). Integer hashing (no Math.sin) = bit-identical across engines.
function hash01(i, j) {
  let h = (Math.imul(i | 0, 0x9E3779B1) ^ Math.imul(j | 0, 0x85EBCA77)) | 0;
  h = Math.imul(h ^ (h >>> 15), 0xC2B2AE3D);
  h ^= h >>> 13;
  return (h >>> 0) / 4294967296;
}

/**
 * Part identity (quantized placement key): distinct per part within one plant, identical for the same part across instances, so all variance comes from dj.
 * Single seam: declarative vegetation tables (vegPartXform) and procedural obstacle/landmark subtrees
 * (Object3D child nodes in hazards.js / biomes.js) share this same branch -- computing keys twice,
 * the same part of the same object would jitter differently per path with no visible cause.
 */
export function partId(y, px, pz) {
  return Math.round((y || 0) * 8) * 131 + Math.round((px || 0) * 8) * 373 + Math.round((pz || 0) * 8) * 769;
}

/**
 * The two detail-jitter degrees of freedom (full rationale in the file-header detail-jitter section).
 * @param pid   partId output
 * @param dj    instance detail seed (0-1; 0/undefined = no jitter, bit-identical to the old scheme)
 * @param amp   radius growth upper bound (grow-only)
 * @param axial whether this part is axial (px = pz = 0); only axial parts may spin
 * @returns { jr horizontal radius multiplier >= 1, spin self-rotation radians about the extrusion axis }
 */
export function partJitter(pid, dj, amp, axial) {
  if (!dj) return { jr: 1, spin: 0 };
  const di = (dj * 8191) | 0;
  return {
    jr: 1 + hash01(pid, di) * amp,                                    // Grow-only (see file header)
    spin: axial ? (hash01(pid ^ 0x5bd1e99, di) - 0.5) * Math.PI * 2 : 0,   // Axial parts only (see file header)
  };
}

/**
 * Part x instance -> world transform.
 * @param part { g, y, px, pz, rx, rz, sy, key?, j? }
 * @param it   { x, y, z, s, ry, tx, tz, dj? }
 * @returns { pos:[x,y,z], quat:[x,y,z,w], scl:[x,y,z] }
 */
export function vegPartXform(part, it) {
  const s = it.s ?? 1;
  // Instance rigid rotation: facing ry outside, stance micro-tilt inside (about the plant base)
  const qi = quatMul(quatFromEuler(0, it.ry || 0, 0), quatFromEuler(it.tx || 0, 0, it.tz || 0));
  const off = quatApply(qi, [(part.px || 0) * s, (part.y || 0) * s, (part.pz || 0) * s]);
  // Part identity = quantized placement key (distinct per part in one plant, same across instances, so variance comes only from dj);
  // both jitter degrees of freedom and their rules live in partJitter (shared by procedural obstacle/landmark subtrees)
  const { jr, spin } = partJitter(
    partId(part.y, part.px, part.pz), it.dj,
    (part.key ? 0.18 : 0.08) * (part.j || 1),
    !(part.px || part.pz),
  );
  let quat = quatMul(qi, quatFromEuler(part.rx || 0, part.ry || 0, part.rz || 0));
  if (spin) quat = quatMul(quat, quatFromEuler(0, spin, 0));   // Post-multiply = about own axis, endpoints fixed
  return {
    pos: [it.x + off[0], it.y + off[1], it.z + off[2]],
    quat,
    scl: [s * jr, s * (part.sy || 1), s * jr],
  };
}
