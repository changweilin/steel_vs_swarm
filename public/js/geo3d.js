// ============ Procedural Geometry Primitives (project-wide sole seam) ============
// Single shared implementation for building blocks (`mat`, `bx`, `cyl`, `dim`, `rbz`, `feather`, `jetFlame`, `segLimb`).
// Consolidates legacy duplicates between `models.js` and forge `geo.js`.
//
// Invariants:
//   1. Leaf module: imports only Three.js and toon.js to prevent circular dependencies.
//   2. Materials route strictly through `mat()` -> `toonMat` (cel ramp dark step >= 102; MUST NOT instantiate raw materials).
//   3. Standard canonical naming without suffixes; `mecha/geo.js` re-exports legacy aliases for backwards compatibility.
import * as THREE from 'three';
import { toonMat } from './toon.js';

export function mat(color, opts = {}) {
  // Cel-shading: PBR roughness/metalness parameters adapt to toon shading; high metalness enables hard-edge comic specular highlights (celMetal).
  const { metalness, roughness, ...rest } = opts;
  return toonMat(color, { ...rest, celMetal: (metalness ?? 0) >= 0.5 });
}

/** Outline width scaled to unit bounding radius (~2-3px comic line in screen space). */
export const outlineW = (target) => Math.min(0.45, Math.max(0.05, target * 0.016));

/** Monochromatic tone stepping for comic panel division across large color blocks. */
export const dim = (c, f) => new THREE.Color(c).multiplyScalar(f);

// ---------- Basic primitives (box, cylinder, sphere, cone, torus; auto-parented) ----------
export function bx(parent, w, h, d, x, y, z, color, opts) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat(color, opts));
  m.position.set(x, y, z);
  parent.add(m);
  return m;
}
export function cyl(parent, rt, rb, h, seg, x, y, z, color, opts) {
  const m = new THREE.Mesh(new THREE.CylinderGeometry(rt, rb, h, seg), mat(color, opts));
  m.position.set(x, y, z);
  parent.add(m);
  return m;
}
export function sph(parent, r, x, y, z, color, opts) {
  const m = new THREE.Mesh(new THREE.SphereGeometry(r, 12, 9), mat(color, opts));
  m.position.set(x, y, z);
  parent.add(m);
  return m;
}
export function cone(parent, r, h, seg, x, y, z, color, opts) {
  const m = new THREE.Mesh(new THREE.ConeGeometry(r, h, seg), mat(color, opts));
  m.position.set(x, y, z);
  parent.add(m);
  return m;
}
export function torus(parent, R, r, x, y, z, color, opts, arc = Math.PI * 2) {
  const m = new THREE.Mesh(new THREE.TorusGeometry(R, r, 6, 12, arc), mat(color, opts));
  m.position.set(x, y, z);
  parent.add(m);
  return m;
}

/**
 * Rounded volume (capsule aligned horizontally along z axis): w=width (x), h=height (y), d=depth (z).
 * Replaces sharp boxes for organic hulls and elytra.
 * Scaled in local mesh space along y before 90-deg rotation to preserve major axis proportion.
 */
export function rbz(parent, w, h, d, x, y, z, color, opts) {
  const r = Math.min(w, h) / 2;
  const m = new THREE.Mesh(new THREE.CapsuleGeometry(r, Math.max(0.01, d - 2 * r), 4, 10), mat(color, opts));
  m.rotation.x = Math.PI / 2;
  m.scale.set(w / (2 * r), 1, h / (2 * r));
  m.position.set(x, y, z);
  parent.add(m);
  return m;
}

/**
 * Tapered feather vane (flattened capsule anchored at root, extending along +-x wingspan).
 * Vanes radiate from wing root / wrist, sweeping backward with increasing sweep angle `sw`.
 * sgn = wing side (+1 right / -1 left); sw increases toward -z (rearward).
 */
export function feather(parent, len, wd, x, y, z, sw, sgn, color, opts) {
  const geo = new THREE.CapsuleGeometry(wd / 2, Math.max(0.01, len - wd), 3, 8);
  geo.rotateZ(-Math.PI / 2);        // Align with +x (wingspan axis)
  geo.translate(len / 2, 0, 0);     // Anchor root at origin for sweep rotation
  geo.scale(1, 0.14, 1);            // Flatten into thin vane
  const m = new THREE.Mesh(geo, mat(color, opts));
  m.position.set(x, y, z);
  m.rotation.y = sgn > 0 ? sw : Math.PI - sw;
  parent.add(m);
  return m;
}

/**
 * Jet exhaust flame (white-hot inner cone + accent-colored outer mantle along local -y).
 * Marked `noOutline` to bypass silhouette outline generation.
 * Visibility, length, and intensity are driven dynamically by locomotion based on speed (rig.jets).
 */
export function jetFlame(parent, r, len, x, y, z, accent) {
  const grp = new THREE.Group();
  grp.position.set(x, y, z);
  parent.add(grp);
  const mk = (rr, ll, c, op, ei) => {
    const c2 = new THREE.Mesh(new THREE.ConeGeometry(rr, ll, 8),
      mat(c, { transparent: true, opacity: op, emissive: c, emissiveIntensity: ei }));
    c2.rotation.x = Math.PI;        // Tip points toward -y (exhaust stream direction)
    c2.position.y = -ll / 2;
    c2.userData.noOutline = true;
    grp.add(c2);
    return c2;
  };
  const outer = mk(r, len, accent, 0.5, 2.2);
  const inner = mk(r * 0.5, len * 0.62, 0xfff1cf, 0.85, 2.8);
  grp.visible = false;                // Starts extinguished (ignited by locomotion)
  return { g: grp, m1: outer.material, m2: inner.material };
}

/**
 * Segmented articulated limb: root pivot + child joint pivots extending along -y.
 * Sign convention: +x rotation shifts distal end backward -> positive = knee flexion, negative = elbow flexion.
 * Collects joint definitions `{ g, base, k, d }` consumed by locomotion flexChain.
 */
export function segLimb(parent, pos, segs, chain) {
  const root = new THREE.Group();
  root.position.set(pos[0], pos[1], pos[2]);
  parent.add(root);
  let cur = root;
  segs.forEach((s, i) => {
    if (i > 0) {
      const j = new THREE.Group();
      const pv = s.piv;
      j.position.set(pv ? pv[0] : 0, pv ? pv[1] : -segs[i - 1].len, pv ? pv[2] : 0);
      j.rotation.x = s.base || 0;
      cur.add(j);
      chain.push({ g: j, base: s.base || 0, k: s.k || 0, d: s.d || 0 });
      cur = j;
    }
    s.draw(cur);
  });
  return root;
}
