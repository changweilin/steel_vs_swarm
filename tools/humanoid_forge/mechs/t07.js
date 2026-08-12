// ============ t07 逐機零件檔(航空機體;dev-only)============
// t07「屏息」翼龍狙擊機(avian / creature:'ptero'):指骨膜翼 + 尖喙感測頭 + 雙爪抓槍莢
// 2D 定案圖:public/assets/cyberpunk_art/mechs/t07_static.jpg(/ _moving / _heavy)
// 設計權威 = mecha.js gen.sil:「一對指骨撐開的細長膜翼,頭部是尖長的感測喙;兩隻爪各抓著
// 一具狙擊槍莢,爪一鬆槍就掉。」
// gen.note:「槍莢是**抓著的**不是掛架焊死的:爪與槍身之間 MUST 看得出是可鬆開的握持關係。」
//   ⇒ 槍莢掛在**爪 Group 之下**且爪指真的環抱槍身(四指 + 對握拇指),兩者之間留可見縫隙。
// 撲翼契約:rig.wings = [{ w(內翼樞軸), outer(外翼樞軸), sgn }] —— outer 相位延遲 = 鞭式
// follow-through(stepAerial 鳥類分支);翼膜與指骨都掛在樞軸之下才會跟著拍。
import * as THREE from 'three';
import {
  bxF, cylF, sphF, prismF, latheF, finF, wingF, gunPodF,
  IRON, GUNMETAL, COAL, BONE,
} from '../geo.js';

export default {
  label: '屏息(t07 翼龍狙擊機)', hue: 0x3faaca, kind: 'air', height: 3.4,
  air: { tiltY: 1.35, bob: 0.05, top: 26, span: 4.2 },
  moveSig: { hover: 0.12, hoverF: 0.7, hoverA: 0.35, surge: 0.40, flare: 0.82, bank: 0.50 },
  castSig: { omni: 'flare', dir: 'lunge' },
  doc: [
    ['瘦長軀幹', '流線軀幹(lathe)+ 龍骨突 + 背脊裝甲片 ×4'],
    ['尖喙感測頭', '尖長喙(prism 側輪廓)+ 頭冠(fin)+ 單眼 + 頸節 ×2'],
    ['指骨膜翼 ×2', '內翼/外翼兩段樞軸 + 前臂骨 + 四根指骨(cyl 收分)+ 翼膜(prism 薄片)'],
    ['抓握爪 ×2', '爪根 + 四指(cyl)+ 對握拇指 —— 與槍身之間留可見縫隙'],
    ['狙擊槍莢 ×2', 'gunPodF 長莢(掛在爪之下,可拋)'],
    ['尾舵', '細長尾桿 + 菱形尾舵(fin)'],
  ],

  body(c, t) {
    const { PAL, accent, dark } = c;
    // 瘦長軀幹 + 龍骨突 + 背脊裝甲
    latheF(t, [[0, -0.8], [0.12, -0.6], [0.22, -0.1], [0.24, 0.34], [0.14, 0.62], [0, 0.7]], 12,
      0, 0, 0, PAL.main, { metalness: 0.6 }).rotation.x = Math.PI / 2;
    prismF(t, [[-0.5, 0], [0.4, 0], [0.3, -0.24], [-0.4, -0.18]], 0.06, 0, -0.22, 0.06, PAL.deep, { metalness: 0.65 })
      .rotation.y = Math.PI / 2;                              // 龍骨突(撲翼機的胸肌錨)
    for (let i = 0; i < 4; i++)
      finF(t, { len: 0.16, w0: 0.14, w1: 0.05, t: 0.04, sweep: -0.06 }, 0, 0.2, 0.3 - i * 0.28, PAL.lite, { metalness: 0.6 });
    // 頸節 ×2 + 尖喙頭
    cylF(t, 0.11, 0.13, 0.24, 8, 0, 0.1, 0.66, PAL.mid, { metalness: 0.65 }).rotation.x = Math.PI / 2 - 0.3;
    const head = new THREE.Group();
    head.position.set(0, 0.18, 0.86);
    t.add(head);
    prismF(head, [[-0.16, -0.08], [0.5, -0.03], [0.56, 0.02], [0.44, 0.08], [-0.13, 0.14]], 0.16,
      0, 0, 0, BONE, { metalness: 0.4 }).rotation.y = Math.PI / 2;   // 尖長喙(側輪廓)
    finF(head, { len: 0.42, w0: 0.2, w1: 0.06, t: 0.045, sweep: -0.24 }, 0, 0.06, -0.1, accent, { metalness: 0.5 })
      .rotation.x = 0.5;                                       // 頭冠(翼龍的識別點)
    const eye = sphF(head, 0.055, 0.09, 0.05, 0.1, accent, { emissive: accent, emissiveIntensity: 2.0 });
    sphF(head, 0.055, -0.09, 0.05, 0.1, accent, { emissive: accent, emissiveIntensity: 2.0 });
    // 尾桿 + 菱形尾舵
    cylF(t, 0.05, 0.07, 0.9, 8, 0, -0.06, -1.1, PAL.mid, { metalness: 0.7 }).rotation.x = Math.PI / 2;
    finF(t, { len: 0.4, w0: 0.06, w1: 0.3, t: 0.035, sweep: -0.1 }, 0, 0.02, -1.5, PAL.lite, { metalness: 0.6 })
      .rotation.x = -0.2;
  },

  lift(c, t) {
    const { PAL, accent, dark } = c;
    const wings = [];
    // 指骨膜翼:內翼樞軸 → 外翼樞軸(相位延遲);翼膜是薄片 prism,指骨是收分圓柱
    for (const sx of [-1, 1]) {
      const w = new THREE.Group();
      w.position.set(sx * 0.22, 0.08, 0.04);
      t.add(w);
      cylF(w, 0.06, 0.075, 0.66, 8, sx * 0.33, 0, 0, PAL.mid, { metalness: 0.7 }).rotation.z = Math.PI / 2;  // 肱骨
      const outer = new THREE.Group();
      outer.position.set(sx * 0.66, 0, 0);
      w.add(outer);
      cylF(outer, 0.04, 0.055, 0.5, 8, sx * 0.25, 0, -0.02, PAL.mid, { metalness: 0.7 }).rotation.z = Math.PI / 2;  // 前臂骨
      // 四根指骨(逐根變長變細)+ 翼膜(指骨之間各一片)
      const FING = [1.28, 1.06, 0.78, 0.5];
      FING.forEach((len, i) => {
        const ang = -0.34 + i * 0.28;
        const f = cylF(outer, 0.02, 0.035, len, 6, sx * (0.5 + Math.cos(ang) * len / 2), 0, -Math.sin(ang) * len / 2,
          BONE, { metalness: 0.5 });
        f.rotation.z = Math.PI / 2;
        f.rotation.y = sx * ang;
      });
      const mem = prismF(outer, [[0, 0], [1.7, -0.5], [1.62, 0.32], [0.1, 0.2]], 0.012,
        sx * 0.5, 0, 0, PAL.lite, { metalness: 0.2, transparent: true, opacity: 0.72 });
      mem.rotation.x = -Math.PI / 2;
      mem.scale.x = sx;
      wings.push({ w, outer, sgn: sx });
    }
    return { wings };
  },

  mount(c, F) {
    const { accent, PAL, K, dark } = c;
    const t = F.tilt;
    const pods = [];
    // 抓握爪 ×2:爪根 + 四指 + 對握拇指;槍莢掛在爪之下,兩者之間留縫(可鬆開的握持關係)
    for (const sx of [-1, 1]) {
      const claw = new THREE.Group();
      claw.position.set(sx * 0.3, -0.36, 0.1);
      claw.rotation.z = sx * 0.16;
      t.add(claw);
      latheF(claw, [[0, 0], [0.11, 0.04], [0.1, 0.18], [0.05, 0.24]], 8, 0, 0, 0, PAL.deep, { metalness: 0.75 });
      for (let i = 0; i < 4; i++) {
        const th = -0.5 + i * 0.34;
        const fg = cylF(claw, 0.022, 0.032, 0.26, 6, Math.sin(th) * 0.09, -0.14, Math.cos(th) * 0.09,
          GUNMETAL, { metalness: 0.85 });
        fg.rotation.x = Math.cos(th) * 0.5;
        fg.rotation.z = -Math.sin(th) * 0.5;
      }
      const th2 = cylF(claw, 0.024, 0.034, 0.24, 6, -sx * 0.1, -0.14, -0.05, GUNMETAL, { metalness: 0.85 });
      th2.rotation.z = sx * 0.75;
      // 槍莢:掛在爪下 0.1m(可見縫隙 = 「抓著的」)
      const pod = gunPodF(claw, { len: 1.5 * K.barrelF, r: 0.13, accent }, 0, -0.36, 0.1, dark, { metalness: 0.8 });
      pods.push(pod);
    }
    const [lp, hp] = pods;
    return {
      muzzles: { light: { n: lp.muz, r: 0.06 }, heavy: { n: hp.muz, r: 0.1 } },
      lightGlowM: [lp.muz], heavyGlowM: [hp.muz],
      weap: { light: 'N', heavy: 'N' }, hvy: { chest: 0.05 },
      wpn: { light: { nodes: [lp.g], ref: lp.g, muz: lp.muz, fwd: 'z' },
        heavy: { nodes: [hp.g], ref: hp.g, muz: hp.muz, fwd: 'z' } },
    };
  },
};
