// ============ Dual-Mode Morph Shared Seam (dev-only; helper module) ============
// Variable-geometry mechs MUST construct their flight variant from the ground form's
// component generators. The two modes differ only in spatial placement and rotation.
//
// This module contains shared stance utilities with zero local geometry:
//   1. bipedDims: mirrors humanoid scaffold metrics in forge.js so flight models match scale exactly.
//   2. groundCtx: backfills ground form c.G / c.dims into aerial baseCtx to prevent girth drift.
//   3. staticLimb: statically evaluates segLimbF segment specs for folded/stowed limb configurations.
//   4. upright: intermediate transform group that counters parent pitch tilt.
// Defaults are intentionally omitted: all keys must exist explicitly on ground presets to fail loud on drift.
import * as THREE from 'three';

const KEYS = ['hips', 'legSplay', 'thigh', 'shin', 'shoulderY', 'shoulderX', 'upperArm', 'foreArm', 'head', 'girth'];

/**
 * Derives humanoid scaffold dimensions in meters for flight variant builders.
 * D = ground default export (reads D.prop and D.height). Returns keys matching forge.js locals.
 */
export function bipedDims(D, height) {
  const P = D.prop || {};
  for (const k of KEYS) if (typeof P[k] !== 'number') throw new Error(`[_morph] ${D.label}:prop.${k} 缺席 —— 變形者地面型 MUST 把十個人形特徵寫滿(飛行型吃同一份)`);
  const H = height ?? D.height ?? 6.0;
  const G = P.girth;
  const hipY = P.hips * H;
  const thighL = P.thigh * hipY, shinL = P.shin * hipY;
  const shoulderY = P.shoulderY * H;
  return {
    H, G, hipY, thighL, shinL,
    clear: Math.max(0.1, hipY - thighL - shinL),
    legX: P.legSplay * H * Math.max(1, G * 0.9),
    shoulderX: P.shoulderX * H * Math.max(1, G * 0.9),
    upperArmL: P.upperArm * H, foreArmL: P.foreArm * H,
    waistYl: 0.12 * H, shoulderYl: shoulderY - hipY, headYl: P.head * H - hipY,
    footL: 0.3 + 0.22 * G,
  };
}

/**
 * Builds construction context by injecting ground c.G and c.dims into aerial baseCtx.
 * Prevents girth-scaled components (e.g. t11 girth 1.15) from shrinking in aerial mode.
 */
export function groundCtx(c, dim) {
  c.G = dim.G;
  c.dims = { shoulderYl: dim.shoulderYl, waistYl: dim.waistYl, shoulderX: dim.shoulderX, headYl: dim.headYl };
  return c;
}

/**
 * Statically composes segLimbF segment specifications into a posed hierarchy.
 * Used for flight stowage where gait kinematic chains are unneeded.
 * poses[i] = segment i rotation.x (falls back to s.base if omitted).
 */
export function staticLimb(parent, segs, poses = [], pos = [0, 0, 0], rot = null) {
  const root = new THREE.Group();
  root.position.set(pos[0], pos[1], pos[2]);
  if (rot) root.rotation.set(rot[0] || 0, rot[1] || 0, rot[2] || 0);
  parent.add(root);
  let cur = root;
  segs.forEach((s, i) => {
    if (i > 0) {
      const j = new THREE.Group();
      const pv = s.piv;
      j.position.set(pv ? pv[0] : 0, pv ? pv[1] : -segs[i - 1].len, pv ? pv[2] : 0);
      j.rotation.x = poses[i] != null ? poses[i] : (s.base || 0);
      cur.add(j);
      cur = j;
    } else if (poses[0] != null) root.rotation.x += poses[0];
    s.draw(cur);
  });
  return root;
}

/** Pitch-compensating intermediate group: negates parent pitch tilt to keep children level with world horizon. */
export function upright(parent, pitch, x = 0, y = 0, z = 0) {
  const g = new THREE.Group();
  g.position.set(x, y, z);
  g.rotation.x = -pitch;
  parent.add(g);
  return g;
}
