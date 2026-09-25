// ============ Polyhedral Component Primitives (Shared Mech Modeling Geometry) ============
// Shared geometric vocabulary: frustums (tboxF), extruded prisms (prismF), lathes (latheF),
// airfoils/fins (finF/wingF), feather fans (fanF), articulated segment chains (chainF),
// cable bundles (cablesF), rotors (rotorF), and weapon pods (gunPodF).
// Mech component modules (mechs/*.js) MUST assemble models using this vocabulary;
// MUST NOT instantiate local BufferGeometry.
//
// Rules:
//   1. Hard-edged faceted geometries (non-indexed, per-face normals) MUST attach welded
//      smooth copies in userData.outlineGeo -- toon.js outlinify expands along normals,
//      and split face normals would tear outlines.
//   2. Zero Math.random: inter-element variations in fans/chains MUST use deterministic index functions.
//   3. Materials MUST use matF -> toonMat; this file imports only Three.js and ../geo3d.js.
import * as THREE from 'three';
// ---- Base primitives: re-exported from ../geo3d.js ----
import {
  mat as matF, dim as dimF, outlineW as outlineWF, segLimb as segLimbF,
  bx as bxF, cyl as cylF, sph as sphF, cone as coneF, torus as torusF, jetFlame as jetF,
} from '../geo3d.js';

export { matF, dimF, outlineWF, segLimbF, bxF, cylF, sphF, coneF, torusF, jetF };

// ---- Palette constants ----
export const IRON = 0x23262a, GUNMETAL = 0x1a1d20, COAL = 0x14171a, INK = 0x0d0f11;
export const BONE = 0xd8d4c8, BRASS = 0xe8b33a;

// ---- Articulated mechanism primitives ----
/**
 * Hydraulic cylinder: single-ended anchor, angled, non-spanning + joint collar ring; optional polished core rod.
 * barrel/head colors are parameterized so callers can recolor joint accents without traversing child meshes.
 */
export function hydCyl(p, r, len, x, y, z, tiltX, core = null, barrel = IRON, head = 0x3a4048) {
  const c = cylF(p, r, r, len, 6, x, y, z, barrel, { metalness: 0.85 });
  c.rotation.x = tiltX;
  cylF(p, r * 1.5, r * 1.5, r * 1.2, 8, x, y + len * 0.55, z, head, { metalness: 0.8 });
  if (core) {
    const k = cylF(p, r * 0.55, r * 0.55, len * 0.5, 6, x, y - len * 0.45, z, core, { metalness: 0.9 });
    k.rotation.x = tiltX;
  }
  return c;
}
/** Two-piece tendon cylinder (dark upper body + exposed polished rod) for biomechanical joints. */
export function sinew(p, h, x, y, z, lite) {
  cylF(p, 0.11, 0.11, h * 0.62, 8, x, y + h * 0.16, z, IRON, { metalness: 0.8 });
  cylF(p, 0.05, 0.05, h * 0.92, 6, x, y - h * 0.06, z, lite, { metalness: 0.9 });
}
/** Centipede segment: layered overlapping plates + exposed joint collar. */
export function seg2(p, w, len, d, y, main, sub) {
  bxF(p, w, len, d, 0, y - len / 2, 0, main, { metalness: 0.55 });
  bxF(p, w * 0.9, len * 0.94, d * 0.92, 0, y - len / 2 - len * 0.03, 0.03, sub, { metalness: 0.55 });
  const ax = cylF(p, w * 0.32, w * 0.32, w * 0.28, 10, 0, y - len, 0, COAL, { metalness: 0.85 });
  ax.rotation.z = Math.PI / 2;
}

// ========== Polyhedral Geometry Primitives ==========

/** Positional vertex welding (1e-4 tolerance) -> indexed geometry + smooth normals for toon outline shell. */
export function weldSmooth(geo) {
  const pos = geo.attributes.position;
  const map = new Map();
  const verts = [];
  const idx = [];
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
    const key = `${Math.round(x * 1e4)},${Math.round(y * 1e4)},${Math.round(z * 1e4)}`;
    let j = map.get(key);
    if (j == null) {
      j = verts.length / 3;
      verts.push(x, y, z);
      map.set(key, j);
    }
    idx.push(j);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

/** Hard facet geometry: non-indexed + per-face normals with smooth outline copy. */
export function facet(geo) {
  const flat = geo.index ? geo.toNonIndexed() : geo;
  flat.computeVertexNormals();
  flat.userData.outlineGeo = weldSmooth(flat);
  return flat;
}
const mesh = (parent, geo, x, y, z, color, opts) => {
  const m = new THREE.Mesh(geo, matF(color, opts));
  if (geo.userData.outlineGeo) m.userData.outlineGeo = geo.userData.outlineGeo;
  m.position.set(x, y, z);
  parent.add(m);
  return m;
};

/** Assembles non-indexed geometry from CCW quad lists [a, b, c, d]. */
export function quadsGeo(quads) {
  const arr = [];
  for (const [a, b, c, d] of quads) arr.push(...a, ...b, ...c, ...a, ...c, ...d);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(arr, 3));
  return facet(g);
}

/**
 * Tapered box / frustum for armor plates and limb shells.
 * Bottom w0 x d0, top w1 x d1, height h; top offset by (sx, sz) for taper/sweep.
 * spec = { w0, d0, w1, d1, h, sx = 0, sz = 0 }
 */
export function tboxF(parent, spec, x, y, z, color, opts) {
  const { w0, d0, h, sx = 0, sz = 0 } = spec;
  const w1 = spec.w1 ?? w0, d1 = spec.d1 ?? d0;
  const b = [
    [-w0 / 2, -h / 2, -d0 / 2], [w0 / 2, -h / 2, -d0 / 2],
    [w0 / 2, -h / 2, d0 / 2], [-w0 / 2, -h / 2, d0 / 2],
  ];
  const t = [
    [sx - w1 / 2, h / 2, sz - d1 / 2], [sx + w1 / 2, h / 2, sz - d1 / 2],
    [sx + w1 / 2, h / 2, sz + d1 / 2], [sx - w1 / 2, h / 2, sz + d1 / 2],
  ];
  const geo = quadsGeo([
    [t[0], t[3], t[2], t[1]],   // Top +y
    [b[0], b[1], b[2], b[3]],   // Bottom -y
    [b[3], b[2], t[2], t[3]],   // Front +z
    [b[1], b[0], t[0], t[1]],   // Back -z
    [b[2], b[1], t[1], t[2]],   // Right +x
    [b[0], b[3], t[3], t[0]],   // Left -x
  ]);
  return mesh(parent, geo, x, y, z, color, opts);
}

/**
 * Extruded polygon for thoracic sections, shields, crescent blades, and head cowls.
 * pts = CCW polygon vertices on XY plane [[x,y],...], extruded along Z by depth (centered).
 * opts.bevel = { t, s } optional beveling.
 */
export function prismF(parent, pts, depth, x, y, z, color, opts = {}) {
  const shape = new THREE.Shape();
  shape.moveTo(pts[0][0], pts[0][1]);
  for (let i = 1; i < pts.length; i++) shape.lineTo(pts[i][0], pts[i][1]);
  const bevel = opts.bevel;
  const { bevel: _b, ...matOpts } = opts;
  const geo = new THREE.ExtrudeGeometry(shape, {
    depth, bevelEnabled: !!bevel,
    bevelThickness: bevel?.t ?? 0, bevelSize: bevel?.s ?? 0, bevelSegments: 1,
  });
  geo.translate(0, 0, -depth / 2);
  const flat = facet(geo);
  // Beveled extrusions already have rounded profiles; welded outline shell creates artifacts on bevels.
  if (bevel) delete flat.userData.outlineGeo;
  return mesh(parent, flat, x, y, z, color, matOpts);
}

/**
 * Lathe body for spherical shoulders, domes, corrugated drums, muzzles, and joint collars.
 * profile = [[r, y], ...] bottom-to-top rotated around Y; seg = radial segments (default 10).
 */
export function latheF(parent, profile, seg, x, y, z, color, opts) {
  const geo = new THREE.LatheGeometry(profile.map(([r, py]) => new THREE.Vector2(Math.max(0.0001, r), py)), seg || 10);
  geo.computeVertexNormals();          // Lathes remain smooth; outlines require no separate weld copy.
  return mesh(parent, geo, x, y, z, color, opts);
}

/**
 * Tapered blade fin (individual feather, blade, spine, rotor blade) extending along +Y; origin at root pivot.
 * spec = { len, w0, w1, t, sweep = 0, camber = 0 }
 *   w0 root width -> w1 tip width (along x); t root thickness (tapered to tip); sweep/camber tip offset along +z.
 * 3-stage profile (root/mid/tip) forms a faceted polygon, not a flat plane.
 *
 * Rules:
 *  1. Fin surface normal lies along local z (len y / width x / thickness z). Control surfaces and flukes
 *     MUST apply rotation.y = PI/2 around the length axis to align width with chordwise flow.
 *  2. sweep/camber offsets local z (thickness axis). Chordwise sweep should be handled by tilting the parent group.
 *  3. rotation.z = sx * PI/2 directs +y to -sx * x; pointing toward +sx * x requires -sx * PI/2.
 *     rotation.y and rotation.z MUST be separated into two parent groups under Euler 'XYZ' order.
 */
export function finF(parent, spec, x, y, z, color, opts) {
  const { len, w0, w1, t, sweep = 0, camber = 0 } = spec;
  const sec = (ty) => {
    const w = w0 + (w1 - w0) * ty;
    const th = t * (1 - 0.7 * ty);
    const zc = sweep * ty + camber * Math.sin(Math.PI * ty);
    return [
      [-w / 2, ty * len, zc - th / 2], [w / 2, ty * len, zc - th / 2],
      [w / 2, ty * len, zc + th / 2], [-w / 2, ty * len, zc + th / 2],
    ];
  };
  const s0 = sec(0), s1 = sec(0.55), s2 = sec(1);
  const band = (a, b) => [
    [a[3], a[2], b[2], b[3]],   // Front +z
    [a[1], a[0], b[0], b[1]],   // Back -z
    [a[2], a[1], b[1], b[2]],   // Right +x
    [a[0], a[3], b[3], b[0]],   // Left -x
  ];
  const geo = quadsGeo([
    [s0[0], s0[1], s0[2], s0[3]],                 // Root cap -y
    ...band(s0, s1), ...band(s1, s2),
    [s2[0], s2[3], s2[2], s2[1]],                 // Tip cap (tapered ridge)
  ]);
  return mesh(parent, geo, x, y, z, color, opts);
}

/**
 * Feather fan (multi-element assembly) for wings, manes, rectrices, and crests.
 * n fins arranged radially along pivot, length decreases deterministically toward edges.
 * spec = { n, arc, len, edgeF = 0.55, gap = 0.012, fin: { w0, w1, t, sweep, camber } }
 * Returns { g (pivot), fins[] }.
 */
export function fanF(parent, spec, x, y, z, color, opts) {
  const { n, arc, len, edgeF = 0.55, gap = 0.012, fin } = spec;
  const g = new THREE.Group();
  g.position.set(x, y, z);
  parent.add(g);
  const fins = [];
  for (let i = 0; i < n; i++) {
    const u = n === 1 ? 0 : i / (n - 1) - 0.5;              // −0.5 ~ +0.5
    const f = finF(g, { ...fin, len: len * (1 - (1 - edgeF) * Math.abs(u) * 2) },
      0, 0, (i - (n - 1) / 2) * gap, color, opts);          // Progressive z-offset prevents z-fighting
    f.rotation.z = -arc * u;
    fins.push(f);
  }
  return { g, fins };
}

/**
 * Articulated segment chain for tails, tentacles, and whips.
 * Each segment = pivot Group + tapered segment body + inter-segment collar ring.
 * Segments extend along -Z (tail convention matching t06/m05; consumed directly by rig.tailSegs).
 * Note: rot0/rotD apply only in static pose. Once hooked into rig.tailSegs, locomotion whipTail
 * overwrites segment pivot rotation.x/y per frame. Baseline curve posture MUST be set via
 * an intermediate static Group above chainF or baked directly into segment geometry.
 * spec = { n, x, y, z, len0, len1, r0, r1, rot0 = 0.5, rotD = -0.05,
 *          ring = true, ringColor = IRON, seg = 8, drawSeg? }
 * Returns { segs[], tip (last segment Group), tipZ }.
 */
export function chainF(parent, spec, color, opts) {
  const { n, x = 0, y = 0, z = 0, len0, len1, r0, r1,
    rot0 = 0.5, rotD = -0.05, ring = true, ringColor = IRON, seg = 8, drawSeg } = spec;
  const segs = [];
  let cur = parent, px = x, py = y, pz = z, prevLen = 0;
  for (let i = 0; i < n; i++) {
    const u = n === 1 ? 0 : i / (n - 1);
    const r = r0 + (r1 - r0) * u;
    const len = len0 + (len1 - len0) * u;
    const t = new THREE.Group();
    t.position.set(px, py, i === 0 ? pz : -prevLen);
    t.rotation.x = rot0 + i * rotD;
    cur.add(t);
    const body = cylF(t, r, r * 0.82, len, seg, 0, 0, -len / 2, color, opts);
    body.rotation.x = Math.PI / 2;
    if (ring) {
      const j = cylF(t, r * 1.18, r * 1.18, r * 0.5, seg, 0, 0, -0.02, ringColor, { metalness: 0.8 });
      j.rotation.x = Math.PI / 2;
    }
    if (drawSeg) drawSeg(t, i, { r, len });
    segs.push(t);
    cur = t; px = 0; py = 0; prevLen = len;
  }
  return { segs, tip: segs[n - 1], tipZ: -(len0 + (len1 - len0)) };
}

// ========== Aerial Craft Primitives ==========
// Primitives for aircraft and UAV archetypes: airfoils (wingF), rotors (rotorF), and jet flames (jetF).
// Component modules MUST construct forms from these primitives without creating local BufferGeometry.

/**
 * Trapezoidal wing with cambered airfoil section, extending along +X (origin at root mid-chord).
 * Features chord taper, sweep, dihedral, and washout twist.
 * spec = { span, c0, c1, t, sweep = 0, dihedral = 0, twist = 0 }
 *   c0 root chord -> c1 tip chord (along Z; +z = leading edge); t root thickness (tapered to tip);
 *   sweep tip aft offset (-z positive); dihedral tip vertical rise; twist tip washout (radians).
 */
export function wingF(parent, spec, x, y, z, color, opts) {
  const { span, c0, c1, t, sweep = 0, dihedral = 0, twist = 0 } = spec;
  // 6-sided cambered airfoil profile: sharp leading edge -> cambered upper surface -> trailing edge -> flat lower surface
  const sec = (u) => {
    const c = c0 + (c1 - c0) * u;
    const th = t * (1 - 0.55 * u);
    const tw = twist * u;
    const pts = [[0.5, 0], [1 / 6, 0.5], [-1 / 3, 0.35], [-0.5, 0], [-1 / 3, -0.2], [1 / 6, -0.3]];
    return pts.map(([cz, cy]) => {
      const pz = cz * c, py = cy * th;
      // Washout twist around spanwise axis (+X); sweep translates section along -z without distorting chord profile
      return [u * span, py * Math.cos(tw) - pz * Math.sin(tw) + dihedral * u,
        pz * Math.cos(tw) + py * Math.sin(tw) - sweep * u];
    });
  };
  const s0 = sec(0), s1 = sec(0.5), s2 = sec(1);
  const band = (a, b) => a.map((_, i) => {
    const j = (i + 1) % a.length;
    return [a[i], a[j], b[j], b[i]];
  });
  const cap = (s, flip) => (flip
    ? [[s[0], s[1], s[2], s[3]], [s[3], s[4], s[5], s[0]]]
    : [[s[3], s[2], s[1], s[0]], [s[0], s[5], s[4], s[3]]]);
  return mesh(parent, quadsGeo([...cap(s0, false), ...band(s0, s1), ...band(s1, s2), ...cap(s2, true)]),
    x, y, z, color, opts);
}

/**
 * Rotor assembly: gimbal holder + rotating rotor hub + n tapered blades.
 * spec = { r, blades = 2, pitch = 0.12, hub = r*0.14, thick = 0.03, tilt = [x,z] }
 *   tilt = gimbal orientation; pitch = blade pitch (collective angle of attack).
 * Returns { holder, prop (spinning hub; animated by caller), blades[] }.
 */
export function rotorF(parent, spec, x, y, z, color, opts) {
  const { r, blades = 2, pitch = 0.12, hub, thick = 0.03, tilt } = spec;
  const hr = hub ?? r * 0.14;
  const holder = new THREE.Group();
  holder.position.set(x, y, z);
  if (tilt) { holder.rotation.x = tilt[0] || 0; holder.rotation.z = tilt[1] || 0; }
  parent.add(holder);
  cylF(holder, hr * 0.85, hr, hr * 1.6, 8, 0, 0, 0, COAL, { metalness: 0.85 });   // Motor housing
  const prop = new THREE.Group();
  prop.position.y = hr * 1.1;
  holder.add(prop);
  latheF(prop, [[0, 0], [hr * 0.9, 0.01], [hr * 0.75, hr * 0.5], [0, hr * 0.62]], 8, 0, 0, 0, GUNMETAL, { metalness: 0.9 });
  const out = [];
  for (let i = 0; i < blades; i++) {
    // Each blade has a dedicated azimuth Group; blade geometry extends purely along +x.
    // MUST NOT combine rotation.y and polar translation on the same mesh due to sign convention disparity.
    const arm = new THREE.Group();
    arm.rotation.y = i * Math.PI * 2 / blades;
    prop.add(arm);
    const b = tboxF(arm, { w0: r * 0.94, d0: r * 0.2, w1: r * 0.94, d1: r * 0.1, h: thick, sz: -r * 0.05 },
      r * 0.5, 0, 0, color, opts);
    b.rotation.x = pitch;              // Blade pitch (angle of attack)
    out.push(b);
  }
  return { holder, prop, blades: out };
}

/**
 * Aircraft gun pod: aerodynamic casing + tapered barrel + muzzle brake + muzzle flash node.
 * Geometry points along local +z (fulfills rig.wpn fwd:'z' contract for FPV parity).
 * spec = { len, r, accent, muzR = r*0.55, brake = true }
 * Returns { g, muz } where muz is the emissive flash mesh for lightGlowM / heavyGlowM.
 */
export function gunPodF(parent, spec, x, y, z, color, opts) {
  const { len, r, accent, muzR = r * 0.55, brake = true } = spec;
  const g = new THREE.Group();
  g.position.set(x, y, z);
  parent.add(g);
  const sh = tboxF(g, { w0: r * 2.0, d0: r * 2.0, w1: r * 1.35, d1: r * 1.15, h: len * 0.52 },
    0, 0, -len * 0.18, color, opts);
  sh.rotation.x = Math.PI / 2;
  const bl = cylF(g, muzR * 0.82, muzR, len * 0.6, 8, 0, 0, len * 0.28, GUNMETAL, { metalness: 0.85 });
  bl.rotation.x = Math.PI / 2;
  if (brake) {
    const bk = cylF(g, muzR * 1.55, muzR * 1.55, r * 0.42, 8, 0, 0, len * 0.5, COAL, { metalness: 0.9 });
    bk.rotation.x = Math.PI / 2;
  }
  const muz = cylF(g, muzR * 0.9, muzR * 0.9, 0.03, 8, 0, 0, len * 0.58, accent,
    { emissive: accent, emissiveIntensity: 1.4 });
  muz.rotation.x = Math.PI / 2;
  return { g, muz };
}

// Jet flame `jetF` = alias of `geo3d.jetFlame` (re-exported at top):
// Contract returns { g, m1, m2 }, consumed by locomotion.js stepAerial (velocity-proportional thrust).
// Cone apex points along local -y; caller rotates rx = PI/2 to direct exhaust aft (-z).

/**
 * Cable bundle (exposed tendon/hydraulic piping): k curves dispersed between p0 and p1 with droop.
 * Deterministic angular distribution across indices without random variance.
 * spec = { p0: [x,y,z], p1: [x,y,z], k, r, sag = 0.06, spread = 0.03 }
 */
export function cablesF(parent, spec, color, opts) {
  const { p0, p1, k, r, sag = 0.06, spread = 0.03 } = spec;
  const out = [];
  const a = new THREE.Vector3(...p0), b = new THREE.Vector3(...p1);
  for (let i = 0; i < k; i++) {
    const th = (i / k) * Math.PI * 2;
    const off = new THREE.Vector3(Math.cos(th) * spread, 0, Math.sin(th) * spread);
    const mid = a.clone().lerp(b, 0.5).add(off).add(new THREE.Vector3(0, -sag, 0));
    const curve = new THREE.QuadraticBezierCurve3(a.clone().add(off), mid, b.clone().add(off));
    const m = new THREE.Mesh(new THREE.TubeGeometry(curve, 6, r, 5), matF(color, opts));
    parent.add(m);
    out.push(m);
  }
  return out;
}
