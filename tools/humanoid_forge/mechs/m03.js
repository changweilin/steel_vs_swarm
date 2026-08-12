// ============ m03 逐機零件檔(航空機體;dev-only)============
// m03「續命」雙尾桁運補機(fixed / wing:'twinboom'):中央短艙 + 平行尾桁 ×2 + 桁間貨艙
// 2D 定案圖:public/assets/cyberpunk_art/mechs/m03_static.png(/ _moving / _heavy)
// 設計權威 = mecha.js gen.sil:「中央短艙加兩根平行尾桁,尾桁之間橫著一片尾翼;桁間的空腔
// 塞滿貨箱,底下垂著一具可拋的修理臂。」
// gen.note:「桁間 MUST 塞著東西(血漿箱/備件):空的桁間就只是一架普通的貨運機。」
//   ⇒ 貨箱是**必要零件**不是擺飾:三只不同尺寸的箱體 + 綁帶,MUST NOT 為了乾淨拿掉。
import * as THREE from 'three';
import {
  bxF, cylF, sphF, tboxF, prismF, latheF, wingF, rotorF, gunPodF,
  IRON, GUNMETAL, COAL,
} from '../geo.js';

const BOOM = 0.62;            // 尾桁半間距(gen.mass:間距約機身寬的三倍)

export default {
  label: '續命(m03 雙尾桁運補機)', hue: 0x59c1a5, kind: 'air', height: 3.5,
  air: { tiltY: 1.3, bob: 0.03, top: 28, level: true, span: 3.6 },
  moveSig: { hover: 0.30, hoverF: 1.0, hoverA: 0.12, surge: 0.35, flare: 0, bank: 0.55 },
  castSig: { omni: 'spin', dir: 'lunge' },
  doc: [
    ['中央短艙', '短胖艙體(lathe)+ 前緣感測窗 + 醫療識別帶'],
    ['平行尾桁 ×2', '等徑圓桁(cyl)+ 桁根整流 + 桁端垂尾'],
    ['桁間貨艙', '貨箱 ×3(尺寸各異)+ 綁帶 ×2 + 橫尾翼(wingF)'],
    ['平直主翼 ×2', 'wingF 平直中展弦比 + 翼上發動機艙'],
    ['推進槳 ×2', 'rotorF 兩葉(桁前牽引)'],
    ['可拋修理臂', '腹下三節機械臂 + 夾爪 + 快拋插銷'],
  ],

  body(c, t) {
    const { PAL, accent, dark } = c;
    // 中央短艙(短胖;+z 機首)
    latheF(t, [[0, -0.62], [0.22, -0.52], [0.3, -0.1], [0.31, 0.3], [0.22, 0.56], [0, 0.64]], 12,
      0, 0, 0.24, PAL.main, { metalness: 0.55 }).rotation.x = Math.PI / 2;
    const win = sphF(t, 0.16, 0, 0.08, 0.8, accent, { emissive: accent, emissiveIntensity: 1.1 });
    win.scale.z = 0.72;
    bxF(t, 0.56, 0.05, 0.14, 0, -0.18, 0.4, PAL.lite, { metalness: 0.4 });         // 識別帶
    // 平行尾桁 ×2(等徑圓桁)+ 桁根整流 + 桁端垂尾
    for (const sx of [-1, 1]) {
      const bm = cylF(t, 0.12, 0.13, 2.1, 10, sx * BOOM, 0.02, -0.66, PAL.mid, { metalness: 0.6 });
      bm.rotation.x = Math.PI / 2;
      latheF(t, [[0, 0], [0.14, 0.08], [0.13, 0.3], [0, 0.36]], 10, sx * BOOM, 0.02, 0.42, PAL.deep, { metalness: 0.65 })
        .rotation.x = Math.PI / 2;
      const vf = prismF(t, [[-0.28, 0], [0.14, 0], [0.04, 0.46], [-0.22, 0.48]], 0.045,
        sx * BOOM, 0.1, -1.6, PAL.mid, { metalness: 0.6 });
      vf.rotation.y = Math.PI / 2;
    }
    // 桁間橫尾翼(兩桁之間橫著一片)
    const ht = wingF(t, { span: BOOM * 2, c0: 0.42, c1: 0.42, t: 0.07 }, -BOOM, 0.42, -1.66, PAL.mid, { metalness: 0.6 });
    // ---- 桁間貨箱 ×3(gen.note:空的桁間就只是普通貨運機)+ 綁帶 ----
    bxF(t, 0.46, 0.4, 0.5, -0.22, -0.14, -0.86, PAL.deep, { metalness: 0.5 });
    bxF(t, 0.38, 0.3, 0.4, 0.26, -0.2, -1.2, PAL.lite, { metalness: 0.5 });
    bxF(t, 0.3, 0.26, 0.3, 0.1, -0.16, -0.5, dark, { metalness: 0.5 });
    for (const z of [-0.6, -1.1]) bxF(t, BOOM * 2.05, 0.05, 0.07, 0, 0.06, z, accent, { metalness: 0.35 });
  },

  lift(c, t) {
    const { PAL, K, dark } = c;
    const spin = [];
    // 平直主翼(接在兩桁上)+ 翼上發動機艙 + 桁前牽引槳
    for (const sx of [-1, 1]) {
      const w = wingF(t, { span: 1.24, c0: 0.6, c1: 0.44, t: 0.11, sweep: 0.05, dihedral: 0.06 },
        sx * BOOM, 0.02, 0.06, PAL.main, { metalness: 0.55 });
      w.scale.x = sx;
      const w2 = wingF(t, { span: BOOM, c0: 0.62, c1: 0.6, t: 0.12 }, 0, 0.02, 0.06, PAL.main, { metalness: 0.55 });
      w2.scale.x = sx;
      latheF(t, [[0, 0], [0.11, 0.06], [0.12, 0.26], [0.06, 0.34]], 10, sx * BOOM, 0.02, 0.62, dark, { metalness: 0.7 })
        .rotation.x = Math.PI / 2;
      const r = rotorF(t, { r: 0.72 * K.barrelF, blades: 2, pitch: 0.3, thick: 0.03, tilt: [Math.PI / 2, 0] },
        sx * BOOM, 0.02, 0.78, PAL.lite, { metalness: 0.5, transparent: true, opacity: 0.85 });
      spin.push(r.prop);
    }
    return { spin };
  },

  mount(c, F) {
    const { accent, PAL, K, dark } = c;
    const t = F.tilt;
    // ---- 可拋修理臂(輕武器錨):三節機械臂 + 夾爪 + 快拋插銷 ----
    const arm = new THREE.Group();
    arm.position.set(0, -0.5, 0.14);
    arm.rotation.x = 0.3;
    t.add(arm);
    cylF(arm, 0.06, 0.07, 0.1, 8, 0, 0, 0, accent, { metalness: 0.8 });             // 快拋插銷
    for (let i = 0; i < 3; i++) {
      const seg = tboxF(arm, { w0: 0.11 - i * 0.02, d0: 0.11 - i * 0.02, w1: 0.09 - i * 0.02, d1: 0.09 - i * 0.02, h: 0.3 },
        0, -0.2 - i * 0.3, i * 0.06, PAL.mid, { metalness: 0.7 });
      cylF(arm, 0.055, 0.055, 0.09, 8, 0, -0.35 - i * 0.3, i * 0.06, COAL, { metalness: 0.9 }).rotation.z = Math.PI / 2;
    }
    for (const sx of [-1, 1]) {
      const cl = bxF(arm, 0.04, 0.2, 0.05, sx * 0.06, -1.06, 0.2, GUNMETAL, { metalness: 0.85 });
      cl.rotation.z = sx * 0.35;
    }
    const lMuz = sphF(arm, 0.05, 0, -1.14, 0.24, accent, { emissive: accent, emissiveIntensity: 1.3 });
    // 重武器:艙腹前射莢
    const hp = gunPodF(t, { len: 1.02 * K.barrelF, r: 0.14, accent }, 0, -0.34, 0.6, dark, { metalness: 0.75 });
    return {
      muzzles: { light: { n: lMuz, r: 0.05 }, heavy: { n: hp.muz, r: 0.09 } },
      lightGlowM: [lMuz], heavyGlowM: [hp.muz],
      weap: { light: 'N', heavy: 'N' }, hvy: { chest: 0.04 },
      wpn: { light: { nodes: [arm], ref: arm, muz: lMuz, fwd: '-y' },
        heavy: { nodes: [hp.g], ref: hp.g, muz: hp.muz, fwd: 'z' } },
    };
  },
};
