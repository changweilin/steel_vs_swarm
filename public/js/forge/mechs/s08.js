// ============ s08 Mech Component (Flight Variant; dev-only) ============
// s08 "Candelabrum" medical transport craft: spherical cabin + coaxial dual rotor mast + ventral pod + hoist.
// Design constraint: craft is canonically unarmed. Rig contract requires muzzles/wpn for FPV compatibility.
// Therefore weapon mounts are mapped to civilian utility nodes: light = drop chute, heavy = searchlight pod.
// Medical insignia and strobes set userData.noPaint = true to avoid livery tinting.
import * as THREE from 'three';
import {
  bxF, cylF, sphF, tboxF, latheF, torusF, rotorF,
  IRON, GUNMETAL, COAL,
} from '../geo.js';

const MED = 0x39d98a;         // Medical green (fixed identification color, invariant to palette hue).

export default {
  label: '燭台(s08 醫療運補機)', kind: 'air', height: 3.2,
  air: { tiltY: 1.35, bob: 0.03, top: 20, span: 2.6 },
  moveSig: { hover: 0.05, hoverF: 0.5, hoverA: 0.06, surge: 0.10, flare: 0.25, bank: 0.10 },
  castSig: { omni: 'spin', dir: 'lunge' },
  doc: [
    ['球形主艙', '渾圓艙體(lathe 旋成)+ 赤道分模線 + 側面醫療圓盤(白底綠十字)×2'],
    ['共軸雙旋翼塔', '塔柱 + 上下反轉雙槳盤(rotorF ×2)+ 傳動整流罩'],
    ['恆溫吊艙', '腹下膠囊吊艙(lathe)+ 箍帶 ×2 + 冷排鰭 ×3 + 尾門與恆溫燈'],
    ['吊索絞盤', '絞盤鼓 + 導纜架 + 垂纜 + J 形吊鉤'],
    ['起落滑橇', '兩支橫向弓形橇(cyl)+ 支柱 ×4'],
    ['識別燈組', '綠十字燈 ×2(腹側)+ 機頂綠頻閃 + 著陸探照燈'],
  ],

  body(c, t) {
    const { PAL, accent, dark } = c;
    // Spherical cabin: lathe body preserving shoulder taper.
    latheF(t, [[0, -0.62], [0.34, -0.56], [0.56, -0.3], [0.62, 0], [0.54, 0.28], [0.3, 0.46], [0, 0.5]],
      14, 0, -0.02, 0, PAL.main, { metalness: 0.5 });
    torusF(t, 0.615, 0.022, 0, -0.02, 0, PAL.deep, { metalness: 0.6 }).rotation.x = Math.PI / 2;   // Equatorial parting line
    // Lateral medical badge discs (white base + green cross; offset from widest sphere contour to prevent z-fighting).
    for (const sx of [-1, 1]) {
      const rg = new THREE.Group();
      rg.position.set(sx * 0.585, -0.02, 0);
      rg.rotation.z = -sx * Math.PI / 2;
      t.add(rg);
      const disc = cylF(rg, 0.19, 0.19, 0.055, 16, 0, 0.01, 0, 0xf2f5f7, { metalness: 0.2 });
      const c1 = bxF(rg, 0.3, 0.03, 0.09, 0, 0.045, 0, MED, { metalness: 0.2 });
      const c2 = bxF(rg, 0.09, 0.03, 0.3, 0, 0.045, 0, MED, { metalness: 0.2 });
      for (const m of [disc, c1, c2]) m.userData.noPaint = true;
    }
    // Forward sensor aperture (replaces canopy).
    const win = cylF(t, 0.17, 0.2, 0.06, 12, 0, 0.06, 0.56, accent, { emissive: accent, emissiveIntensity: 0.9 });
    win.rotation.x = Math.PI / 2 - 0.25;
    // ---- Ventral insulated pod: capsule + retaining straps + radiator fins + tail hatch ----
    latheF(t, [[0, -0.5], [0.2, -0.44], [0.26, -0.2], [0.26, 0.2], [0.18, 0.36], [0, 0.4]],
      12, 0, -0.98, -0.06, PAL.lite, { metalness: 0.45 });
    for (const z of [-0.3, 0.16]) bxF(t, 0.42, 0.3, 0.05, 0, -0.98, z + -0.06, PAL.mid, { metalness: 0.6 });
    for (let i = 0; i < 3; i++) bxF(t, 0.075, 0.014, 0.16, 0.23, -0.86 - i * 0.06, -0.2, PAL.mid, { metalness: 0.7 });
    const door = bxF(t, 0.16, 0.16, 0.02, 0, -1.0, -0.34, dark, { metalness: 0.5 });
    door.rotation.x = 0.3;
    const dl = bxF(t, 0.24, 0.035, 0.03, 0, -0.82, -0.32, MED, { emissive: MED, emissiveIntensity: 1.4 });
    dl.userData.noPaint = true;
    // Ventral green cross markers (fixed identification color).
    for (const sx of [-1, 1]) {
      const a = bxF(t, 0.02, 0.24, 0.07, sx * 0.22, -0.94, -0.2, MED, { emissive: MED, emissiveIntensity: 1.8 });
      const b = bxF(t, 0.02, 0.07, 0.24, sx * 0.22, -0.94, -0.2, MED, { emissive: MED, emissiveIntensity: 1.8 });
      a.userData.noPaint = true; b.userData.noPaint = true;
    }
    // Roof green strobe (IFF identification; positioned below lower rotor disc).
    const st = sphF(t, 0.045, 0, 0.56, 0.24, MED, { emissive: MED, emissiveIntensity: 1.9 });
    st.userData.noPaint = true;
    // Landing skids: dual curved skids + 4 struts.
    for (const sx of [-1, 1]) {
      const sk = cylF(t, 0.035, 0.035, 1.24, 6, sx * 0.46, -1.24, 0, IRON, { metalness: 0.8 });
      sk.rotation.x = Math.PI / 2;
      for (const sz of [-1, 1]) {
        const leg = cylF(t, 0.028, 0.032, 0.56, 6, sx * 0.4, -0.96, sz * 0.4, IRON, { metalness: 0.8 });
        leg.rotation.z = sx * 0.22;
        leg.rotation.x = -sz * 0.14;
      }
    }
  },

  lift(c, t) {
    const { PAL, K } = c;
    const spin = [];
    // Coaxial rotor mast: pylon + transmission fairing + counter-rotating dual rotor discs.
    cylF(t, 0.11, 0.15, 0.56, 10, 0, 0.78, 0, GUNMETAL, { metalness: 0.85 });
    latheF(t, [[0, 0], [0.2, 0.06], [0.22, 0.2], [0.12, 0.32], [0, 0.36]], 12, 0, 0.5, 0, PAL.mid, { metalness: 0.7 });
    for (const [y, blades] of [[0.94, 3], [1.16, 3]]) {
      const r = rotorF(t, { r: 1.24 * K.barrelF, blades, pitch: 0.13, thick: 0.028 },
        0, y, 0, PAL.lite, { metalness: 0.45, transparent: true, opacity: 0.82 });
      spin.push(r.prop);
    }
    return { spin };
  },

  mount(c, F) {
    const { accent, PAL, K, dark } = c;
    const t = F.tilt;
    // ---- Light weapon mount: blood pack drop chute (fulfills rig weapon contract without visible armament) ----
    const drop = new THREE.Group();
    drop.position.set(0, -1.16, 0.1);
    t.add(drop);
    cylF(drop, 0.13, 0.15, 0.14, 10, 0, 0, 0, PAL.deep, { metalness: 0.6 });
    const lMuz = cylF(drop, 0.1, 0.1, 0.03, 10, 0, 0, 0.12, accent, { emissive: accent, emissiveIntensity: 1.2 });
    lMuz.rotation.x = Math.PI / 2;
    // ---- Heavy weapon mount: CASEVAC hoist winch + landing searchlight pod ----
    const win = new THREE.Group();
    win.position.set(0, -0.72, 0.5);
    t.add(win);
    const drum = cylF(win, 0.09, 0.09, 0.24, 8, 0, 0, 0, COAL, { metalness: 0.85 });
    drum.rotation.z = Math.PI / 2;
    for (const sx of [-1, 1]) bxF(win, 0.025, 0.15, 0.025, sx * 0.09, -0.1, 0.05, IRON, { metalness: 0.75 });
    const fair = cylF(win, 0.02, 0.02, 0.16, 6, 0, -0.17, 0.05, PAL.deep, { metalness: 0.8 });
    fair.rotation.z = Math.PI / 2;
    cylF(win, 0.013, 0.013, 0.4 * K.barrelF, 5, 0, -0.36, 0.05, COAL, { metalness: 0.7 });   // Hoist cable
    bxF(win, 0.03, 0.07, 0.03, 0, -0.58, 0.05, PAL.deep, { metalness: 0.7 });                // J-hook
    bxF(win, 0.03, 0.03, 0.08, 0, -0.61, 0.08, PAL.deep, { metalness: 0.7 });
    bxF(win, 0.03, 0.03, 0.08, 0, -0.61, 0.08, PAL.deep, { metalness: 0.7 });
    const lamp = cylF(win, 0.055, 0.065, 0.08, 8, -0.2, 0.02, 0.02, dark, { metalness: 0.7 });
    lamp.rotation.x = -1.05;
    const hMuz = sphF(win, 0.04, -0.2, -0.02, 0.06, 0xfff4d6, { emissive: 0xfff4d6, emissiveIntensity: 1.7 });
    return {
      muzzles: { light: { n: lMuz, r: 0.06 }, heavy: { n: hMuz, r: 0.09 } },
      lightGlowM: [lMuz], heavyGlowM: [hMuz],
      weap: { light: 'N', heavy: 'N' }, hvy: { chest: 0.03 },
      wpn: { light: { nodes: [drop], ref: drop, muz: lMuz, fwd: 'z' },
        heavy: { nodes: [win], ref: win, muz: hMuz, fwd: 'z' } },
    };
  },
};
