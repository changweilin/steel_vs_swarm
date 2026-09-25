// ============ m06 Mech Part Specification (dev-only; Bionic Quadruped kind: 'quad', slow walk) ============
// m06 "Downpour" Carrier-Type Mech (Stegosaurus archetype): dorsal plates = launch rails loaded with drones, thagomizer tail, columnar legs.
// Reference 2D static art: public/assets/cyberpunk_art/mechs/m06_static.jpg
// Geometry vocabulary sourced strictly from ../geo.js; MUST NOT instantiate BufferGeometry directly.
// Main hull uses tboxF/prismF/latheF.
// Dorsal plates = 8 swept pentagonal prismF plates staggered in two rows, loaded with ordnance (2x 6-tube cluster pods + 2x missile canisters + 4x folding drones).
// Tail thagomizer = raw steel latheF wavy profile with cross-axis secondary club; heraldry paint lives in paint layer.
// Tail structure = 6 segmental rings + 3 pairs of tapering tail plates + thagomizer tip; upward curvature encoded in mesh offsets.
import * as THREE from 'three';
import {
  matF, dimF, bxF, cylF, sphF, coneF, torusF, tboxF, prismF, latheF, finF, fanF, chainF, cablesF,
  hydCyl, sinew, seg2, IRON, GUNMETAL, COAL, INK, BONE, BRASS,
} from '../geo.js';

// Raw steel gray (thagomizer / secondary club; unpainted raw steel excludes PAL gold tier).
const STEEL = 0x7d838b;

// Swept pentagonal plate contour (shared between dorsal launch rails and tail plates; scaled at callsite).
const PLATE = [[-0.5, 0], [0.5, 0], [0.7, 0.35], [0.45, 1.0], [-0.25, 0.45]];

export default {
  label: '傾盆(m06 機甲・劍龍)', kind: 'quad', height: 5.0,
  frame: {
    hipY: 1.9, legX: 0.95, fz: 1.2, hz: -1.6,
    chest: [0, 0.1, 0.6], neck: [0, -0.05, 1.25], head: [0, -0.2, 0.7],
    tailY: 0.15, tailZ: -2.0, tail2Z: 1.6,
  },
  // Heavy columnar quadruped limbs (elephantine): vertical bone axes, distal stride 0.3-0.4x digitigrade.
  // Stance phase locks carpus/tarsus into load-bearing columns (lock: 0.70) without spring compression.
  gait: { gait: 'walk', stride: 2.3, top: 8, bob: 0.05, rollSway: 0.11, pitchAmp: 0.03,
    limb: { fore: 'columnar', hind: 'columnar' } },
  moveSig: { poise: 0.48, idleF: 0.48, idleA: 1.85, launch: 0.10, spool: 0.88, brake: 0.10, settle: 2.10 },
  castSig: { omni: 'tailwhip', dir: 'tailwhip' },
  doc: [
    ['軀幹(重載四足獸軀)', 'tboxF 前後雙段厚殼+下緣裙殼+GUNMETAL 腹艙(裝載升降口 accent 縫)+側面散熱格柵+側裙'],
    ['背骨板 ×2 列(發射軌)', 'prismF 後掠五角板 ×8 交錯兩列(高度前升後降、基部咬進背脊)—— 骨板即發射軌'],
    ['子機掛格(每格掛貨)', '6 管集束莢 ×2(外側軌位)+方彈筒 ×2(兩列之間中溝)+摺翼子機 ×4(tboxF 艙身+coneF 鼻錐+finF 摺翼+IRON 托架)—— 貨滿到像會走路的碼頭'],
    ['小頭+層疊頸甲', 'latheF 八角頸甲環 ×3 逐環收分+tboxF 楔顱/喙吻/下顎+prismF 怒眉稜+sphF 雙眼+cablesF 頸下管束'],
    ['象柱腿 ×4(後肢加粗)', 'tboxF 肩殼+cylF 直柱+hydCyl 後腱+膝防塵環+prismF 外側甲片+三楔趾;肩髖 latheF 大圓盤(髖側 torusF 大圓口)'],
    ['節環尾(粗根收梢、上弧高舉)', 'latheF 微鼓節身 ×6(根半徑貼後軀下緣、逐節收分抬升)+IRON 節間環 ×3+prismF 沿尾小背板 3 對逐對縮小(同背板語彙);長度接近體長'],
    ['尾錘(素鐵、被打得變形)', '錘頭 = STEEL 灰 latheF 波浪剖面(打凹)接在尾梢高舉+IRON 錘柄+橫軸副錘+COAL 凹痕補片'],
    ['武裝', '輕:頸側雙聯機槍莢;重:左前集束莢(hMuz 充能格),charge 時全部掛載仰起(heavyPivot ×4);圖騰塗裝歸 paint 層'],
  ],
  body(c, spine, chest) {
    const { PAL, accent } = c;
    // Double-tier torso hull: long, heavy volume tapering upward; rear section anchors hind legs and tail.
    tboxF(chest, { w0: 2.3, d0: 2.1, w1: 1.5, d1: 1.7, h: 1.35, sz: 0.12 }, 0, 0.22, 0.25, PAL.main, { metalness: 0.45 });
    tboxF(chest, { w0: 2.4, d0: 1.9, w1: 2.2, d1: 1.75, h: 0.55 }, 0, -0.45, 0.2, PAL.mid, { metalness: 0.5 });
    tboxF(spine, { w0: 2.2, d0: 2.7, w1: 1.45, d1: 2.15, h: 1.3, sz: -0.18 }, 0, 0.28, -0.85, PAL.mid, { metalness: 0.45 });
    tboxF(spine, { w0: 2.3, d0: 2.4, w1: 2.1, d1: 2.2, h: 0.5 }, 0, -0.42, -0.8, PAL.main, { metalness: 0.5 });
    // Ventral cargo bay (GUNMETAL) + cargo lift gate (COAL hatch + dual accent seams).
    tboxF(chest, { w0: 1.35, d0: 3.4, w1: 1.6, d1: 3.6, h: 0.5 }, 0, -0.85, -0.55, GUNMETAL, { metalness: 0.7 });
    tboxF(chest, { w0: 0.95, d0: 1.2, w1: 1.05, d1: 1.3, h: 0.16 }, 0, -1.12, 0.1, COAL, { metalness: 0.6 });
    for (const dz of [-1, 1])
      bxF(chest, 0.9, 0.05, 0.05, 0, -1.16, 0.1 + dz * 0.62, dimF(accent, 0.8), { emissive: accent, emissiveIntensity: 0.6 });
    // Lateral radiator louvers: inset + 3 vertical slats with indexed stepping.
    for (const sx of [-1, 1]) {
      bxF(chest, 0.1, 0.36, 0.6, sx * 0.99, -0.12, 0.25, COAL, { metalness: 0.6 });
      for (let i = 0; i < 3; i++)
        bxF(chest, 0.12, 0.36, 0.07, sx * 1.0, -0.12, 0.06 + i * 0.19, PAL.deep, { metalness: 0.7 });
    }
    // Side skirts: hanging skirts between fore and hind legs with accent trim.
    for (const sx of [-1, 1]) {
      tboxF(chest, { w0: 0.12, d0: 1.5, w1: 0.12, d1: 1.7, h: 0.55 }, sx * 1.06, -0.6, -0.55, PAL.deep, { metalness: 0.55 });
      bxF(chest, 0.13, 0.07, 1.45, sx * 1.07, -0.34, -0.55, dimF(accent, 0.7), { emissive: accent, emissiveIntensity: 0.4 });
    }
    // Shoulder discs (fore): circular cowl and hub above forelegs.
    for (const sx of [-1, 1]) {
      const d1 = latheF(chest, [[0.12, -0.1], [0.5, -0.08], [0.58, 0], [0.46, 0.09], [0.12, 0.13]], 12, sx * 0.98, -0.15, 0.6, PAL.lite, { metalness: 0.5 });
      d1.rotation.z = -sx * Math.PI / 2;
      const hb = torusF(chest, 0.2, 0.035, sx * 1.1, -0.15, 0.6, PAL.deep, { metalness: 0.8 });
      hb.rotation.y = Math.PI / 2;
      const hc = cylF(chest, 0.14, 0.14, 0.1, 10, sx * 1.1, -0.15, 0.6, IRON, { metalness: 0.85 });
      hc.rotation.z = Math.PI / 2;
    }
    // Hip discs (aft): large dome cowl and port above hindlegs.
    for (const sx of [-1, 1]) {
      const d2 = latheF(spine, [[0.15, -0.1], [0.62, -0.06], [0.78, 0.02], [0.6, 0.15], [0.15, 0.2]], 12, sx * 0.92, 0.02, -1.55, PAL.lite, { metalness: 0.5 });
      d2.rotation.z = -sx * Math.PI / 2;
      const pr = torusF(spine, 0.28, 0.045, sx * 1.13, 0.02, -1.55, IRON, { metalness: 0.8 });
      pr.rotation.y = Math.PI / 2;
      const pc = cylF(spine, 0.25, 0.25, 0.08, 12, sx * 1.12, 0.02, -1.55, COAL, { metalness: 0.6 });
      pc.rotation.z = Math.PI / 2;
    }
    // Segmented collar rings (outer two rings at chest front; third ring at neckHead).
    const c1 = latheF(chest, [[0.62, -0.12], [0.7, 0.02], [0.54, 0.28]], 8, 0, -0.1, 1.3, PAL.mid, { metalness: 0.55 });
    c1.rotation.x = Math.PI / 2;
    const c2 = latheF(chest, [[0.5, -0.1], [0.58, 0.02], [0.42, 0.24]], 8, 0, -0.14, 1.54, PAL.main, { metalness: 0.5 });
    c2.rotation.x = Math.PI / 2;
    // Dorsal plates (8x staggered in two rows across +/-x and z; ascending then descending height).
    // Swept pentagon: local +x (apex offset side) rotated via Ry(-PI/2) to point rearward (-z).
    const tier = [PAL.lite, PAL.main, PAL.mid];             // Geometric 3-tier approximation; per-plate heraldry lives in paint layer.
    const plateAt = (parent, i, y, z, h) => {
      const sx = i % 2 ? 1 : -1;
      const p = prismF(parent, PLATE.map(([px, py]) => [px * 0.66 * h, py * h]), 0.14,
        sx * 0.26, y, z, tier[i % 3], { metalness: 0.5 });
      p.rotation.y = -Math.PI / 2;                          // Ry(-PI/2) directs apex rearward (-z).
      return p;
    };
    plateAt(chest, 0, 0.72, 0.9, 0.66);
    plateAt(chest, 1, 0.8, 0.45, 1.05);
    plateAt(chest, 2, 0.85, 0.0, 1.32);
    plateAt(chest, 3, 0.85, -0.45, 1.45);
    plateAt(spine, 4, 0.86, -0.3, 1.4);
    plateAt(spine, 5, 0.82, -0.8, 1.2);
    plateAt(spine, 6, 0.78, -1.35, 0.95);
    plateAt(spine, 7, 0.68, -1.8, 0.7);
    // Folding-wing drones (4x): mounted on outboard rail slots.
    // Modular payload: IRON pylon + tboxF fuselage + coneF nose cone + dual finF folding wings + accent taillight.
    const droneAt = (parent, sx, y, z, i) => {
      const g = new THREE.Group();
      g.position.set(sx * 0.55, y, z);
      parent.add(g);
      bxF(g, 0.4, 0.12, 0.68, 0, -0.2, 0, IRON, { metalness: 0.75 });
      const bd = tboxF(g, { w0: 0.42, d0: 0.3, w1: 0.24, d1: 0.2, h: 0.78, sz: 0.04 }, 0, 0, 0.02, i % 2 ? PAL.lite : BONE, { metalness: 0.5 });
      bd.rotation.x = Math.PI / 2;
      tboxF(g, { w0: 0.22, d0: 0.38, w1: 0.15, d1: 0.26, h: 0.14 }, 0, 0.16, -0.03, PAL.deep, { metalness: 0.6 });
      const no = coneF(g, 0.11, 0.22, 6, 0, 0, 0.52, GUNMETAL, { metalness: 0.7 });
      no.rotation.x = Math.PI / 2;
      for (const wx of [-1, 1]) {
        const fn = finF(g, { len: 0.5, w0: 0.16, w1: 0.05, t: 0.03, sweep: 0.1 }, wx * 0.16, 0.02, 0.24, PAL.mid, { metalness: 0.55 });
        fn.rotation.x = -Math.PI / 2;
        fn.rotation.z = -wx * 0.3;
      }
      bxF(g, 0.1, 0.08, 0.06, 0, 0.0, -0.42, accent, { emissive: accent, emissiveIntensity: 0.8 + 0.2 * (i % 3) });
    };
    droneAt(chest, 1, 1.06, 0.0, 0);        // Outboard rail slot right (+0.6)
    droneAt(chest, -1, 1.06, -0.45, 1);     // Outboard rail slot left (+0.15)
    droneAt(spine, 1, 1.04, -0.33, 2);      // Outboard rail slot right (-0.33)
    droneAt(spine, -1, 1.0, -0.8, 3);       // Outboard rail slot left (-0.8)
  },
  neckHead(c, neck, head) {
    const { PAL, accent } = c;
    // Third collar ring (innermost) + neck bridge + ventral cable bundle.
    const c3 = latheF(neck, [[0.4, -0.08], [0.46, 0.04], [0.32, 0.2]], 8, 0, -0.02, 0.1, IRON, { metalness: 0.6 });
    c3.rotation.x = Math.PI / 2;
    const nk = cylF(neck, 0.2, 0.32, 0.9, 8, 0, -0.06, 0.28, PAL.mid, { metalness: 0.55 });
    nk.rotation.x = 1.25;
    cablesF(neck, { p0: [0, -0.22, 0.12], p1: [0, -0.38, 0.58], k: 3, r: 0.022, sag: 0.03, spread: 0.06 }, IRON, { metalness: 0.6 });
    // Compact head: wedge skull + tapered beak + brow ridge (small relative to massive torso).
    const cr = tboxF(head, { w0: 0.42, d0: 0.34, w1: 0.32, d1: 0.27, h: 0.5, sz: 0.02 }, 0, 0.02, 0.1, PAL.main, { metalness: 0.5 });
    cr.rotation.x = Math.PI / 2;
    const brow = [[-0.15, 0], [0, -0.025], [0.15, 0], [0.15, 0.06], [0, 0.035], [-0.15, 0.06]];
    prismF(head, brow, 0.07, 0, 0.18, 0.28, PAL.deep, { metalness: 0.6 });
    const sn = tboxF(head, { w0: 0.3, d0: 0.23, w1: 0.17, d1: 0.14, h: 0.46, sz: -0.02 }, 0, -0.03, 0.5, PAL.lite, { metalness: 0.5 });
    sn.rotation.x = Math.PI / 2;
    const bk = tboxF(head, { w0: 0.16, d0: 0.12, w1: 0.09, d1: 0.06, h: 0.16, sz: -0.03 }, 0, -0.07, 0.78, GUNMETAL, { metalness: 0.7 });
    bk.rotation.x = Math.PI / 2 + 0.15;
    const jw = tboxF(head, { w0: 0.2, d0: 0.12, w1: 0.13, d1: 0.08, h: 0.34 }, 0, -0.17, 0.42, PAL.deep, { metalness: 0.55 });
    jw.rotation.x = Math.PI / 2 - 0.1;
    for (const sx of [-1, 1]) {
      sphF(head, 0.045, sx * 0.16, 0.07, 0.28, accent, { emissive: accent, emissiveIntensity: 1.5 });
      const ck = latheF(head, [[0.02, -0.02], [0.09, -0.015], [0.1, 0], [0.09, 0.015], [0.02, 0.02]], 10, sx * 0.22, 0.02, 0.12, IRON, { metalness: 0.8 });
      ck.rotation.z = -sx * Math.PI / 2;
    }
  },
  legF(c) { return this._leg(c, 1); },
  legH(c) { return this._leg(c, -1); },
  // Columnar limbs (stego branch: load-bearing, minimal flexion); hindlimbs scaled 1.1x.
  _leg(c, S) {
    const { PAL, sx } = c;
    const b = S < 0 ? 1.1 : 1;
    return [
      { len: 0.86, draw: (l) => {
        tboxF(l, { w0: 0.58 * b, d0: 0.66 * b, w1: 0.46 * b, d1: 0.54 * b, h: 0.52, sz: S * 0.03 }, 0, -0.16, 0, PAL.lite, { metalness: 0.5 });
        cylF(l, 0.25 * b, 0.28 * b, 0.95, 10, 0, -0.45, 0, PAL.main, { metalness: 0.5 });
        hydCyl(l, 0.03, 0.5, sx * 0.17 * b, -0.5, -0.27 * b, 0.12, BONE);
        const ap = prismF(l, [[-0.14, -0.3], [0.14, -0.3], [0.19, -0.02], [0.12, 0.2], [-0.12, 0.2], [-0.19, -0.02]], 0.06,
          sx * 0.31 * b, -0.42, 0.02, PAL.mid, { metalness: 0.55 });
        ap.rotation.y = sx * Math.PI / 2;
      } },
      { len: 0.53, base: S * 0.12, k: S * 0.3, d: 0.16, draw: (l) => {
        cylF(l, 0.23 * b, 0.25 * b, 0.13, 10, 0, 0, 0, PAL.deep, { metalness: 0.7 });
        cylF(l, 0.21 * b, 0.25 * b, 0.6, 10, 0, -0.28, 0, PAL.main, { metalness: 0.5 });
        const kg = tboxF(l, { w0: 0.3 * b, d0: 0.07, w1: 0.22 * b, d1: 0.06, h: 0.34 }, 0, -0.3, 0.23 * b, PAL.lite, { metalness: 0.55 });
        kg.rotation.x = -0.12;
      } },
      { len: 0.23, base: -S * 0.1, k: -S * 0.24, d: 0.45, draw: (l) => {
        cylF(l, 0.25 * b, 0.3 * b, 0.28, 10, 0, -0.13, 0, PAL.mid, { metalness: 0.5 });
      } },
      { len: 0, base: 0, k: S * 0.16, d: 0.66, draw: (l) => {
        cylF(l, 0.32 * b, 0.36 * b, 0.26, 10, 0, -0.1, 0, COAL, { metalness: 0.6 });
        for (let ti = 0; ti < 3; ti++) {
          const toe = tboxF(l, { w0: 0.13, d0: 0.12, w1: 0.1, d1: 0.08, h: 0.2, sz: 0.03 }, (ti - 1) * 0.15 * b, -0.14, 0.31 * b, PAL.lite, { metalness: 0.55 });
          toe.rotation.x = Math.PI / 2 + 0.12;
        }
      } },
    ];
  },
  tail(c, tail, tail2) {
    const { PAL } = c;
    // Segmented ring tail: thick root tapering to thagomizer, arching upward.
    // whipTail dynamically updates tail/tail2 pivot rotations; upward curvature encoded statically in segment offsets:
    // Progressive Y lift + tilt angle per segment; rotation.x = tilt - PI/2 along curve tangent.
    const segAt = (parent, z, y, r, len, tilt, col) => {
      const s = latheF(parent, [[r * 0.8, -len * 0.5], [r, -len * 0.13], [r, len * 0.17], [r * 0.86, len * 0.5]], 10, 0, y, z, col, { metalness: 0.5 });
      s.rotation.x = tilt - Math.PI / 2;
      return s;
    };
    const ringAt = (parent, z, y, r, tilt) => {
      const rg = cylF(parent, r, r, 0.14, 8, 0, y, z, IRON, { metalness: 0.8 });
      rg.rotation.x = tilt - Math.PI / 2;
      return rg;
    };
    // Tail segments 1-3: thick root tapering down, anchored into rear torso.
    segAt(tail, -0.35, -0.05, 0.55, 0.8, 0.12, PAL.main);
    ringAt(tail, -0.78, 0.06, 0.42, 0.25);
    segAt(tail, -1.05, 0.15, 0.44, 0.7, 0.3, PAL.mid);
    ringAt(tail, -1.42, 0.3, 0.33, 0.45);
    segAt(tail, -1.5, 0.36, 0.37, 0.55, 0.5, PAL.main);
    // Tail2 segments 4-6: extends rearward before arching upward.
    segAt(tail2, -0.3, 0.42, 0.3, 0.6, 0.55, PAL.mid);
    ringAt(tail2, -0.62, 0.6, 0.24, 0.75);
    segAt(tail2, -0.85, 0.72, 0.24, 0.55, 0.9, PAL.main);
    segAt(tail2, -1.1, 0.98, 0.19, 0.5, 1.15, PAL.mid);
    // Tail dorsal plate pairs (3 pairs, tapering rearward with apex pointing toward tail tip).
    const tplateAt = (parent, sx, z, y, h) => {
      const p = prismF(parent, PLATE.map(([px, py]) => [px * 0.66 * h, py * h]), 0.1,
        sx * 0.16, y, z, sx > 0 ? PAL.lite : PAL.mid, { metalness: 0.5 });
      p.rotation.y = -Math.PI / 2;
      return p;
    };
    tplateAt(tail, 1, -0.55, 0.4, 0.72);
    tplateAt(tail, -1, -0.82, 0.44, 0.62);
    tplateAt(tail, 1, -1.3, 0.56, 0.52);
    tplateAt(tail, -1, -1.54, 0.62, 0.46);
    tplateAt(tail2, 1, -0.4, 0.64, 0.38);
    tplateAt(tail2, -1, -0.66, 0.74, 0.32);
    // Thagomizer club: shaft anchored to distal segment + elevated club head + cross-axis secondary bar + dent patches.
    const hf = cylF(tail2, 0.08, 0.1, 0.5, 8, 0, 1.32, -1.22, IRON, { metalness: 0.8 });
    hf.rotation.x = 1.3 - Math.PI / 2;
    const bd = torusF(tail2, 0.12, 0.028, 0, 1.18, -1.18, COAL, { metalness: 0.8 });
    bd.rotation.x = 1.3;
    const hd = latheF(tail2, [
      [0.23, -0.44], [0.38, -0.34], [0.33, -0.18], [0.4, -0.02], [0.34, 0.14], [0.39, 0.28], [0.25, 0.4], [0.0001, 0.44],
    ], 9, 0, 1.72, -1.28, STEEL, { metalness: 0.7 });
    hd.rotation.x = 1.3 - Math.PI / 2;
    // Secondary cross-bar: spans beyond main club radius (0.4) to expose dual lateral studs.
    const pl = cylF(tail2, 0.15, 0.17, 0.95, 8, 0, 1.95, -1.34, GUNMETAL, { metalness: 0.8 });
    pl.rotation.z = Math.PI / 2;
    const dt1 = bxF(tail2, 0.2, 0.15, 0.06, 0.2, 1.78, -1.42, COAL, { metalness: 0.5 });
    dt1.rotation.z = 0.4;
    const dt2 = bxF(tail2, 0.16, 0.12, 0.06, -0.18, 1.55, -1.15, INK, { metalness: 0.5 });
    dt2.rotation.x = 0.5;
  },
  mount(c, F) {
    const { PAL, accent } = c;
    // Heavy weapon: dual 6-tube cluster pods (left-front on chest, right-rear on spine; elevated forward).
    const rackAt = (parent, x, y, z, hot) => {
      const rk = new THREE.Group();
      rk.position.set(x, y, z);
      rk.rotation.x = -0.35;                                // Tube array (+z face) angled forward-upward.
      // Tubes aimed forward-upward (+z face) so weapon tracers originate forward toward targets
      // while retaining MLRS elevated trajectory stance.
      parent.add(rk);
      tboxF(rk, { w0: 0.7, d0: 1.15, w1: 0.64, d1: 1.05, h: 0.5 }, 0, 0.25, 0, PAL.lite, { metalness: 0.5 });
      bxF(rk, 0.66, 0.46, 0.06, 0, 0.25, 0.58, COAL, { metalness: 0.7 });
      for (let i = 0; i < 6; i++) {
        const cell = cylF(rk, 0.095, 0.095, 0.14, 10, (i % 3 - 1) * 0.21, 0.14 + Math.floor(i / 3) * 0.23, 0.62, INK, { metalness: 0.8 });
        cell.rotation.x = Math.PI / 2;
      }
      for (const dz of [-1, 1]) bxF(rk, 0.56, 0.14, 0.16, 0, -0.02, dz * 0.42, IRON, { metalness: 0.75 });
      const mz = cylF(rk, 0.105, 0.105, 0.05, 10, 0, 0.37, 0.66, accent, { emissive: accent, emissiveIntensity: hot ? 1.4 : 0.7 });
      mz.rotation.x = Math.PI / 2;
      return { rk, mz };
    };
    const rk1 = rackAt(F.chest, -0.58, 1.0, 0.45, true);    // Left-front mount
    const rk2 = rackAt(F.spine, 0.58, 1.02, -1.28, false);  // Right-rear mount
    // Dual missile canisters: central trough between plate rows, pitched rearward.
    const tubeAt = (parent, x, z, len, yb) => {
      const tg = new THREE.Group();
      tg.position.set(x, yb, z);
      tg.rotation.x = 0.45;                                 // Positive pitch tilts canister opening rearward.
      parent.add(tg);
      tboxF(tg, { w0: 0.26, d0: 0.26, w1: 0.3, d1: 0.3, h: len }, 0, len * 0.5, 0, GUNMETAL, { metalness: 0.75 });
      tboxF(tg, { w0: 0.36, d0: 0.36, w1: 0.33, d1: 0.33, h: 0.14 }, 0, len - 0.02, 0, PAL.deep, { metalness: 0.7 });
      bxF(tg, 0.22, 0.07, 0.22, 0, len + 0.04, 0, INK, { metalness: 0.4 });
      return tg;
    };
    const tb1 = tubeAt(F.chest, -0.06, -0.25, 1.55, 0.8);
    const tb2 = tubeAt(F.spine, 0.06, -0.35, 1.7, 0.82);
    // Light weapon: dual machine gun pod mounted along right neck collar.
    const pod = tboxF(F.chest, { w0: 0.24, d0: 0.5, w1: 0.2, d1: 0.42, h: 0.26 }, 0.85, -0.05, 1.05, PAL.deep, { metalness: 0.6 });
    const bs = [];
    for (const bxx of [-1, 1]) {
      const bl = cylF(F.chest, 0.035, 0.035, 0.55, 6, 0.85 + bxx * 0.055, -0.05, 1.45, INK, { metalness: 0.85 });
      bl.rotation.x = Math.PI / 2;
      bs.push(bl);
    }
    const lMuz = cylF(F.chest, 0.06, 0.06, 0.05, 8, 0.85, -0.05, 1.75, accent, { emissive: accent, emissiveIntensity: 1.1 });
    lMuz.rotation.x = Math.PI / 2;
    return {
      gunR: null, gunL: null,
      muzzles: { light: { n: lMuz, r: 0.055 }, heavy: { n: rk1.mz, r: 0.1 } },
      lightGlowM: [lMuz], heavyGlowM: [rk1.mz, rk2.mz],
      // charge: dual cluster pods + dual missile canisters elevate concurrently (rest -> deploy).
      heavyPivot: [
        { obj: rk1.rk, rest: { x: -0.35, y: 0, z: 0 }, deploy: { x: -0.9, y: 0, z: 0 } },
        { obj: rk2.rk, rest: { x: -0.35, y: 0, z: 0 }, deploy: { x: -0.9, y: 0, z: 0 } },
        { obj: tb1, rest: { x: 0.45, y: 0, z: 0 }, deploy: { x: 0.85, y: 0, z: 0 } },
        { obj: tb2, rest: { x: 0.45, y: 0, z: 0 }, deploy: { x: 0.85, y: 0, z: 0 } },
      ],
      weap: { light: 'N', heavy: 'N' },
      hvy: { chest: 0.03 },
      aimPose: null,
      wpn: {
        light: { nodes: [pod, ...bs, lMuz], ref: F.chest, muz: lMuz, fwd: 'z' },
        heavy: { nodes: [rk1.rk, rk2.rk], ref: rk1.rk, muz: rk1.mz, fwd: 'z' },
      },
    };
  },
};
