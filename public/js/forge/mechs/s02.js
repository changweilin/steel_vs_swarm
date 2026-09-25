// ============ s02 part file (airframe; dev-only) ============
// s02 heavy-lift wing: slab chassis + six oversized arms + detachable cargo rack
// 2D approved art: public/assets/cyberpunk_art/mechs/s02_static.png(/ _moving / _heavy)
// Authority = mecha.js gen: no streamlining anywhere, all right angles and stiffeners; arm
// section about 2x peers. gen.note: keep the asymmetric patches and mismatched panels --
// tidying it up turns it into a different craft. -> patch asymmetry is design, not sloppiness:
// every patch differs in position/angle, in three colors (stock mid / replacement lite / weld deep);
// MUST NOT paste them in a symmetric row.
import {
  bxF, cylF, tboxF, prismF, torusF, rotorF, gunPodF,
  IRON, GUNMETAL, COAL,
} from '../geo.js';

export default {
  label: '鐵匠鋪(s02 重載運翼機)', kind: 'air', height: 3.8,
  air: { tiltY: 1.3, bob: 0.04, top: 18, span: 4.2 },
  moveSig: { hover: 0.35, hoverF: 0.6, hoverA: 0.12, surge: 0.25, flare: 0.40, bank: 0.30 },
  castSig: { omni: 'spin', dir: 'lunge' },
  doc: [
    ['厚板底盤', '兩層厚鋼板(直角無收分)+ 縱橫加強肋 ×5 + 三塊異色補板(不對稱)'],
    ['機臂 ×6', '加粗方管臂(截面積兩倍)+ 補焊角撐板 + 端點防撞環'],
    ['旋翼 ×6', 'rotorF 兩葉大槳(重載低轉速)'],
    ['可拆貨架', '腹下整塊貨架(楔台)+ 四支快拆插銷 + 綁帶 ×2 + 貨箱 ×3'],
    ['重機槍艙', '腹前重機槍莢(gunPodF)+ 彈鏈盒'],
    ['外掛電池組 / 拖曳吊環', '側掛電池 ×2(異色)+ 頂部拖曳吊環'],
  ],

  body(c, t) {
    const { PAL, accent, dark } = c;
    // Slab chassis: two steel plates + posts (right angles, zero taper -- no streamlining here)
    bxF(t, 1.9, 0.16, 1.5, 0, -0.16, 0, PAL.main, { metalness: 0.65 });
    bxF(t, 1.72, 0.13, 1.32, 0, 0.22, 0, PAL.mid, { metalness: 0.65 });
    for (const sx of [-1, 1]) for (const sz of [-1, 1])
      bxF(t, 0.09, 0.36, 0.09, sx * 0.74, 0.03, sz * 0.56, COAL, { metalness: 0.8 });
    // 5 stiffeners (longitudinal + transverse on top plate; right-angle vocabulary)
    for (let i = 0; i < 3; i++) bxF(t, 0.06, 0.09, 1.28, (i - 1) * 0.52, 0.32, 0, PAL.deep, { metalness: 0.7 });
    for (const z of [-0.45, 0.45]) bxF(t, 1.68, 0.08, 0.06, 0, 0.32, z, PAL.deep, { metalness: 0.7 });
    // Three asymmetric patches (gen.note: tidying them turns it into another craft) -- all positions/angles/colors differ
    const p1 = bxF(t, 0.42, 0.035, 0.5, -0.56, 0.4, 0.28, PAL.lite, { metalness: 0.5 });
    p1.rotation.y = 0.13;
    const p2 = bxF(t, 0.5, 0.035, 0.34, 0.48, 0.4, -0.4, PAL.deep, { metalness: 0.5 });
    p2.rotation.y = -0.19;
    const p3 = bxF(t, 0.035, 0.26, 0.44, 0.96, 0.02, 0.2, dark, { metalness: 0.55 });
    p3.rotation.y = 0.1;
    bxF(t, 0.03, 0.045, 0.46, 0.965, 0.16, 0.2, accent, { metalness: 0.4   }).rotation.y = 0.1;   // Weld bead
    // Two add-on battery packs (different heights: replaced parts) + thick cable
    bxF(t, 0.3, 0.3, 0.72, -0.88, 0.26, -0.2, COAL, { metalness: 0.5 });
    bxF(t, 0.3, 0.26, 0.6, 0.9, 0.3, 0.18, GUNMETAL, { metalness: 0.5 });
    const cb = cylF(t, 0.045, 0.045, 0.7, 6, -0.62, 0.3, -0.2, COAL, { metalness: 0.6 });
    cb.rotation.z = Math.PI / 2 - 0.3;
    // Tow ring (top-plate center; heavy-lifter ID)
    torusF(t, 0.16, 0.035, 0, 0.52, -0.02, IRON, { metalness: 0.85 }).rotation.x = Math.PI / 2;
    bxF(t, 0.22, 0.1, 0.22, 0, 0.38, -0.02, IRON, { metalness: 0.8 });
    // ---- Detachable cargo rack (full belly plate; 4 quick-release pins + 2 straps + 3 crates) ----
    tboxF(t, { w0: 1.5, d0: 1.24, w1: 1.36, d1: 1.1, h: 0.16 }, 0, -0.5, -0.02, PAL.mid, { metalness: 0.6 });
    for (const sx of [-1, 1]) for (const sz of [-1, 1])
      cylF(t, 0.05, 0.05, 0.22, 6, sx * 0.6, -0.36, sz * 0.44, accent, { metalness: 0.7 });
    for (const z of [-0.36, 0.36]) bxF(t, 1.42, 0.05, 0.09, 0, -0.44, z, accent, { metalness: 0.4 });
    bxF(t, 0.52, 0.34, 0.44, -0.4, -0.75, 0.2, PAL.deep, { metalness: 0.5 });
    bxF(t, 0.4, 0.28, 0.5, 0.36, -0.72, -0.24, PAL.lite, { metalness: 0.5 });
    bxF(t, 0.3, 0.22, 0.3, 0.3, -0.69, 0.34, COAL, { metalness: 0.5 });
  },

  lift(c, t) {
    const { PAL, K } = c;
    const spin = [];
    const R = 0.78, ARM = 1.62;
    for (let i = 0; i < 6; i++) {
      const th = (i / 6) * Math.PI * 2 + Math.PI / 6;
      const ax = Math.sin(th) * ARM, az = Math.cos(th) * ARM;
      // Oversized square-tube arm (2x section = 0.24 square) + weld gusset
      const arm = bxF(t, 0.24, 0.2, ARM, ax / 2, 0.02, az / 2, PAL.main, { metalness: 0.65 });
      arm.rotation.y = th;
      const gus = prismF(t, [[0, 0], [0.34, 0], [0, 0.26]], 0.05, ax * 0.2, -0.06, az * 0.2,
        PAL.deep, { metalness: 0.7 });
      gus.rotation.y = th;
      cylF(t, 0.13, 0.13, 0.18, 8, ax, 0.02, az, COAL, { metalness: 0.85 });      // Tip motor mount
      torusF(t, R * 1.02, 0.025, ax, 0.16, az, GUNMETAL, { metalness: 0.8 })      // Guard ring
        .rotation.x = Math.PI / 2;
      const r = rotorF(t, { r: R * K.barrelF, blades: 2, pitch: 0.18, thick: 0.04 },
        ax, 0.1, az, PAL.lite, { metalness: 0.5, transparent: true, opacity: 0.85 });
      spin.push(r.prop);
    }
    return { spin };
  },

  mount(c, F) {
    const { accent, PAL, K, dark } = c;
    const t = F.tilt;
    // HMG bay (light weapon: belt-fed garage conversion) + ammo box
    const lp = gunPodF(t, { len: 0.96 * K.barrelF, r: 0.15, accent }, -0.24, -0.66, 0.52, dark, { metalness: 0.7 });
    bxF(t, 0.3, 0.24, 0.3, 0.12, -0.66, 0.4, COAL, { metalness: 0.6 });
    // Heavy weapon: belly-right pod (mismatched color = replaced part, deliberately unlike the left)
    const hp = gunPodF(t, { len: 1.18 * K.barrelF, r: 0.19, accent }, 0.46, -0.62, 0.44, PAL.lite, { metalness: 0.7 });
    return {
      muzzles: { light: { n: lp.muz, r: 0.07 }, heavy: { n: hp.muz, r: 0.12 } },
      lightGlowM: [lp.muz], heavyGlowM: [hp.muz],
      weap: { light: 'N', heavy: 'N' }, hvy: { chest: 0.04 },
      wpn: { light: { nodes: [lp.g], ref: lp.g, muz: lp.muz, fwd: 'z' },
        heavy: { nodes: [hp.g], ref: hp.g, muz: hp.muz, fwd: 'z' } },
    };
  },
};
