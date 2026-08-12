// ============ s12 逐機零件檔(航空機體;dev-only)============
// s12「星圖」鴨翼長航偵察機(fixed / wing:'canard'):楔形機身 + 前鴨翼 + 後掠主翼 + 星象儀窗
// 2D 定案圖:public/assets/cyberpunk_art/mechs/s12_static.png(/ _moving / _heavy)
// 設計權威 = mecha.js gen.sil:「楔形機身前段長出一對小鴨翼,主翼後掠;機背上一具向上開口的
// 星象儀窗,是全機唯一朝天的東西。」
// gen.note:「星象儀窗 MUST 朝正上方且無遮擋 —— 這台機的鴨翼就是為了保住那個視軸才存在的。」
//   ⇒ 機背中段**淨空**:天線/脊條/掛架一律閃開視軸圓(RSIGHT),MUST NOT 為了好看補一根脊條。
import {
  bxF, cylF, sphF, tboxF, prismF, latheF, torusF, wingF, jetF, gunPodF,
  IRON, GUNMETAL, COAL,
} from '../geo.js';

const RSIGHT = 0.34;          // 星象儀視軸淨空半徑(機背中段;任何零件不得侵入)

export default {
  label: '星圖(s12 鴨翼長航偵察機)', hue: 0x9db0d8, kind: 'air', height: 3.6,
  air: { tiltY: 1.3, bob: 0.03, top: 32, level: true, span: 3.4 },
  moveSig: { hover: 0.50, hoverF: 1.6, hoverA: 0.05, surge: 0.80, flare: 0, bank: 0.92 },
  castSig: { omni: 'spin', dir: 'lunge' },
  doc: [
    ['楔形機身', '前尖後收的楔台機身(tbox)+ 機腹側稜 + 尾錐'],
    ['前鴨翼 ×2', 'wingF 小翼面(展約主翼 1/3、力臂長)+ 前緣配平槽'],
    ['後掠主翼 ×2', 'wingF 大後掠 + 翼端小垂片'],
    ['星象儀窗', '機背中段朝天圓窗(lathe 環座 + 玻璃盤)—— 視軸圓內淨空'],
    ['推進槳/尾噴', '尾噴口 + 噴射尾焰(jetF;canard 機種依 models.js 走噴射)'],
    ['長航油箱艙', '機腹保形油箱 ×2 + 加油口'],
  ],

  body(c, t) {
    const { PAL, accent, dark } = c;
    // 楔形機身:前尖後收(tbox 躺平:h 沿 z)
    const fus = tboxF(t, { w0: 0.62, d0: 0.34, w1: 0.18, d1: 0.2, h: 2.3, sz: 0.02 }, 0, 0, 0.1, PAL.main, { metalness: 0.6 });
    fus.rotation.x = -Math.PI / 2;                    // 幾何 +y → 機首 +z
    for (const sx of [-1, 1]) {                       // 機腹側稜(楔面收斂角)
      const ch = prismF(t, [[-1.0, 0], [1.0, 0], [0.8, 0.1], [-0.9, 0.08]], 0.05,
        sx * 0.3, -0.14, 0.05, PAL.deep, { metalness: 0.7 });
      ch.rotation.y = Math.PI / 2;
    }
    // 星象儀窗(機背中段;朝正上方)—— 環座 + 玻璃盤 + 遮光罩緣
    latheF(t, [[0, 0], [RSIGHT * 0.9, 0.02], [RSIGHT, 0.1], [RSIGHT * 0.86, 0.16]], 14, 0, 0.2, -0.1,
      PAL.deep, { metalness: 0.75 });
    const glass = cylF(t, RSIGHT * 0.8, RSIGHT * 0.8, 0.03, 14, 0, 0.3, -0.1, accent,
      { emissive: accent, emissiveIntensity: 1.0, transparent: true, opacity: 0.75 });
    torusF(t, RSIGHT * 0.86, 0.02, 0, 0.31, -0.1, COAL, { metalness: 0.85 }).rotation.x = Math.PI / 2;
    // 機腹保形油箱 ×2(長航的本體)+ 加油口
    for (const sx of [-1, 1])
      latheF(t, [[0, -0.6], [0.11, -0.5], [0.13, 0.2], [0.09, 0.5], [0, 0.58]], 10,
        sx * 0.26, -0.22, -0.1, PAL.mid, { metalness: 0.5 }).rotation.x = Math.PI / 2;
    cylF(t, 0.05, 0.05, 0.04, 8, -0.26, -0.1, 0.42, dark, { metalness: 0.8 });
    // 前鴨翼 ×2(力臂長:掛在機首後方一點)+ 前緣配平槽
    for (const sx of [-1, 1]) {
      const cn = wingF(t, { span: 0.58, c0: 0.34, c1: 0.2, t: 0.06, sweep: 0.16, dihedral: 0.03 },
        sx * 0.2, 0.04, 0.82, PAL.lite, { metalness: 0.6 });
      cn.scale.x = sx;
      bxF(t, 0.3, 0.02, 0.05, sx * 0.45, 0.06, 0.96, PAL.deep, { metalness: 0.7 });
    }
  },

  lift(c, t) {
    const { PAL, accent } = c;
    // 後掠主翼 ×2(大後掠;翼端小垂片)—— 翼根靠後,重心恰在主翼前緣後方
    for (const sx of [-1, 1]) {
      const w = wingF(t, { span: 1.6, c0: 0.86, c1: 0.34, t: 0.11, sweep: 0.66, dihedral: 0.1, twist: -0.06 },
        sx * 0.24, -0.02, -0.36, PAL.main, { metalness: 0.58 });
      w.scale.x = sx;
      const vf = prismF(t, [[-0.16, 0], [0.16, 0], [0.08, 0.3], [-0.12, 0.3]], 0.04,
        sx * 1.8, 0.06, -0.96, PAL.mid, { metalness: 0.6 });
      vf.rotation.y = Math.PI / 2;
    }
    // 尾噴口 + 噴射尾焰(canard 依 models.js FIXED 表是 jet 機種)
    const noz = latheF(t, [[0.18, 0], [0.2, 0.1], [0.15, 0.28], [0.17, 0.34]], 10, 0, 0, -1.12, COAL, { metalness: 0.85 });
    noz.rotation.x = Math.PI / 2;
    const ring = cylF(t, 0.13, 0.13, 0.05, 10, 0, 0, -1.3, accent, { emissive: accent, emissiveIntensity: 1.5 });
    ring.rotation.x = Math.PI / 2;
    const fl = jetF(t, 0.12, 1.3, 0, 0, -1.36, accent);
    fl.g.rotation.x = Math.PI / 2;                    // 焰流局部 −y → 世界 −z(向後噴)
    return { jets: [fl] };
  },

  mount(c, F) {
    const { accent, K, dark } = c;
    const t = F.tilt;
    // 翼下掛莢(左輕右重);MUST 掛在機腹兩側,MUST NOT 上機背(星象儀視軸)
    for (const sx of [-1, 1]) bxF(t, 0.08, 0.09, 0.3, sx * 0.66, -0.14, -0.34, dark, { metalness: 0.75 });
    const lp = gunPodF(t, { len: 0.82 * K.barrelF, r: 0.1, accent }, -0.66, -0.26, -0.3, dark, { metalness: 0.75 });
    const hp = gunPodF(t, { len: 1.0 * K.barrelF, r: 0.14, accent }, 0.66, -0.26, -0.34, dark, { metalness: 0.75 });
    return {
      muzzles: { light: { n: lp.muz, r: 0.05 }, heavy: { n: hp.muz, r: 0.08 } },
      lightGlowM: [lp.muz], heavyGlowM: [hp.muz],
      weap: { light: 'N', heavy: 'N' }, hvy: { chest: 0.04 },
      wpn: { light: { nodes: [lp.g], ref: lp.g, muz: lp.muz, fwd: 'z' },
        heavy: { nodes: [hp.g], ref: hp.g, muz: hp.muz, fwd: 'z' } },
    };
  },
};
