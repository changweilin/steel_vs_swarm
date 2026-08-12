// ============ s11 逐機零件檔(航空機體;dev-only)============
// s11「錶芯」精密工作機(fixed / wing:'vtail'):圓桿機身 + 高展弦比主翼 + V 形尾 + 尾推槳
// 2D 定案圖:public/assets/cyberpunk_art/mechs/s11_static.png(/ _moving / _heavy)
// 設計權威 = mecha.js gen.sil:「細長的等直弦主翼加一組 V 形尾,機身是一根乾淨的圓桿;
// 整台機看不到一根多餘的桿件。」gen.note:「活動關節 MUST 剛好數得出 11 個。」
//   ⇒ 外露軸承座恰 **11 個**(JOINTS 常數,逐顆生成;改數量請改那一個數字並回頭看 gen.note)。
// 等直弦(c0 === c1)是這台的識別點:MUST NOT 給它收分翼(那就變成別台長航機)。
import {
  bxF, cylF, sphF, latheF, prismF, wingF, rotorF, gunPodF,
  IRON, GUNMETAL, COAL,
} from '../geo.js';

const JOINTS = 11;            // gen.note 明列的數字:外露軸承座剛好 11 個

export default {
  label: '錶芯(s11 精密工作機)', hue: 0xd8c9d0, kind: 'air', height: 3.4,
  air: { tiltY: 1.3, bob: 0.02, top: 26, level: true, span: 4.6 },
  moveSig: { hover: 0.08, hoverF: 0.6, hoverA: 0.05, surge: 0.15, flare: 0, bank: 0.25 },
  castSig: { omni: 'spin', dir: 'lunge' },
  doc: [
    ['圓桿機身', '等徑圓桿(lathe;直徑只夠塞傳動軸)+ 前段酬載艙 + 尾錐'],
    ['高展弦比主翼 ×2', 'wingF 等直弦(c0 = c1)+ 翼展 = 機身長 ×3 + 翼尖小端板'],
    ['V 形尾 ×2', 'wingF 上反 45°(V 尾)+ 尾桁'],
    ['推進槳(尾置)', 'rotorF 兩葉細槳(後推)+ 槳轂整流錐'],
    [`外露軸承座 ×${JOINTS}`, '銅色軸承環(cyl)—— 數量 MUST 恰為 11(gen.note)'],
    ['酬載艙', '前段可拆酬載莢 + 觀測窗'],
  ],

  body(c, t) {
    const { PAL, accent, dark } = c;
    // 圓桿機身(等徑;+z 機首)
    const fus = latheF(t, [[0, -1.6], [0.09, -1.5], [0.11, -0.4], [0.11, 0.7], [0.09, 1.0], [0, 1.12]],
      12, 0, 0, 0, PAL.main, { metalness: 0.6 });
    fus.rotation.x = Math.PI / 2;
    // 前段酬載莢 + 觀測窗
    latheF(t, [[0, -0.34], [0.14, -0.26], [0.16, 0.1], [0.1, 0.3], [0, 0.34]], 12, 0, -0.06, 0.76,
      PAL.mid, { metalness: 0.55 }).rotation.x = Math.PI / 2;
    const win = sphF(t, 0.1, 0, -0.1, 1.02, accent, { emissive: accent, emissiveIntensity: 1.2 });
    win.scale.z = 0.7;
    // 外露軸承座 ×11(精密機的美學:每一顆都看得見、數得出來)
    for (let i = 0; i < JOINTS; i++) {
      const u = i / (JOINTS - 1);
      const z = 0.9 - u * 2.3;
      const b = cylF(t, 0.125, 0.125, 0.045, 10, 0, 0, z, 0xb98a4a, { metalness: 0.9 });
      b.rotation.x = Math.PI / 2;
    }
    // V 形尾:尾桁 + 兩片上反 45°
    cylF(t, 0.05, 0.06, 0.5, 8, 0, 0.08, -1.42, dark, { metalness: 0.7 }).rotation.x = Math.PI / 2 - 0.16;
    for (const sx of [-1, 1]) {
      const v = wingF(t, { span: 0.72, c0: 0.36, c1: 0.24, t: 0.055, sweep: 0.16, dihedral: 0.62 },
        sx * 0.06, 0.14, -1.5, PAL.mid, { metalness: 0.6 });
      v.scale.x = sx;
    }
  },

  lift(c, t) {
    const { PAL, K } = c;
    // 等直弦高展弦比主翼(c0 === c1;這台的識別點)+ 翼尖小端板
    for (const sx of [-1, 1]) {
      const w = wingF(t, { span: 2.28, c0: 0.4, c1: 0.4, t: 0.075, sweep: 0.03, dihedral: 0.12 },
        sx * 0.1, 0.1, 0.02, PAL.main, { metalness: 0.55 });
      w.scale.x = sx;
      bxF(t, 0.025, 0.2, 0.34, sx * 2.36, 0.14, 0.02, PAL.lite, { metalness: 0.5 });
    }
    // 尾置推進槳(後推)+ 整流錐
    latheF(t, [[0, 0], [0.07, 0.06], [0.05, 0.16], [0, 0.2]], 8, 0, 0, -1.68, PAL.deep, { metalness: 0.75 })
      .rotation.x = Math.PI / 2;
    const r = rotorF(t, { r: 0.66 * K.barrelF, blades: 2, pitch: 0.3, thick: 0.026, tilt: [-Math.PI / 2, 0] },
      0, 0, -1.76, PAL.lite, { metalness: 0.5, transparent: true, opacity: 0.85 });
    return { spin: [r.prop] };
  },

  mount(c, F) {
    const { accent, K, dark } = c;
    const t = F.tilt;
    // 精密機的武裝也是「少而精」:翼根兩具細莢,不掛外掛梁(桿件不准多)
    const lp = gunPodF(t, { len: 0.72 * K.barrelF, r: 0.075, accent }, -0.34, -0.1, 0.44, dark, { metalness: 0.8 });
    const hp = gunPodF(t, { len: 0.92 * K.barrelF, r: 0.1, accent }, 0.34, -0.1, 0.4, dark, { metalness: 0.8 });
    return {
      muzzles: { light: { n: lp.muz, r: 0.04 }, heavy: { n: hp.muz, r: 0.07 } },
      lightGlowM: [lp.muz], heavyGlowM: [hp.muz],
      weap: { light: 'N', heavy: 'N' }, hvy: { chest: 0.03 },
      wpn: { light: { nodes: [lp.g], ref: lp.g, muz: lp.muz, fwd: 'z' },
        heavy: { nodes: [hp.g], ref: hp.g, muz: hp.muz, fwd: 'z' } },
    };
  },
};
