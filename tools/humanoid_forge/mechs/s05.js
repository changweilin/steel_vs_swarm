// ============ s05 逐機零件檔(航空機體;dev-only)============
// s05「超頻」競速 FPV:X 形碳板主架 + 四具外露馬達 + 前傾攝影機座
// 2D 定案圖:public/assets/cyberpunk_art/mechs/s05_static.png(/ _moving / _heavy)
// 設計權威 = mecha.js gen.sil:「一塊 X 形碳板、四具外露馬達、一根往前斜伸的攝影機座;
// 沒有整流罩,骨架就是全部。」gen.note:「不准加整流罩或裝甲板:這台的設計語言就是
// 『什麼都沒有,只有能飛的部分』。」
//   ⇒ 本檔**刻意不呼叫 tboxF 當機殼**:主架是一片有真實輪廓的 X 形碳板(prismF 擠出),
//     所有電子件裸露疊在板上。多一片蓋板就違背這台機存在的理由。
import * as THREE from 'three';
import {
  bxF, cylF, sphF, prismF, rotorF, gunPodF,
  IRON, GUNMETAL, COAL,
} from '../geo.js';

const CARBON = 0x1b1e22;

export default {
  label: '超頻(s05 競速 FPV)', hue: 0xff7a30, kind: 'air', height: 2.2,
  air: { tiltY: 1.2, bob: 0.05, top: 40, span: 2.0 },
  moveSig: { hover: 0.90, hoverF: 3.0, hoverA: 0.12, surge: 1.00, flare: 0.50, bank: 1.00 },
  castSig: { omni: 'spin', dir: 'lunge' },
  doc: [
    ['X 形碳板主架', '真實 X 輪廓的碳板(prism 擠出)×2 層 + 四支鋁立柱 —— 無整流罩'],
    ['馬達 ×4', '外露馬達座 + 五吋三葉槳(rotorF;true-X 收緊軸距)'],
    ['攝影機座', '前傾 35° 鏡頭座(prism 楔形)+ 主色鏡片 + 防撞立柱'],
    ['電子疊層', 'FC/4in1 ESC 疊板 + 狀態呼吸燈 + XT60 辮線(裸露)'],
    ['電池束帶', '頂置電池 + 主色綁帶 ×2 + 擊墜正字刻痕 ×5'],
    ['兔耳天線 ×2', '尾部 V 字雙 VTX 鞭 + 棒棒糖頭'],
  ],

  body(c, t) {
    const { PAL, accent } = c;
    // X 形碳板(下板厚、上板薄):輪廓真的是 X —— 四臂根部收腰、中央留電子艙面
    const X = [
      [-0.9, -0.72], [-0.62, -0.5], [-0.28, -0.2], [-0.3, 0.2], [-0.62, 0.5], [-0.9, 0.72],
      [-0.66, 0.94], [-0.3, 0.62], [0.3, 0.62], [0.66, 0.94], [0.9, 0.72],
      [0.62, 0.5], [0.3, 0.2], [0.28, -0.2], [0.62, -0.5], [0.9, -0.72], [0.66, -0.94], [-0.66, -0.94],
    ];
    const low = prismF(t, X, 0.05, 0, -0.2, 0, CARBON, { metalness: 0.6 });
    low.rotation.x = -Math.PI / 2;
    const up = prismF(t, X.map(([a, b]) => [a * 0.78, b * 0.78]), 0.04, 0, 0.14, 0, CARBON, { metalness: 0.6 });
    up.rotation.x = -Math.PI / 2;
    for (const sx of [-1, 1]) for (const sz of [-1, 1])
      cylF(t, 0.03, 0.03, 0.34, 6, sx * 0.42, -0.03, sz * 0.42, IRON, { metalness: 0.9 });
    // 電子疊層(裸露:FC + 4in1 ESC + 呼吸燈)
    bxF(t, 0.4, 0.05, 0.28, 0, -0.11, -0.06, 0x1d2126, { metalness: 0.5 });
    bxF(t, 0.34, 0.04, 0.24, 0, -0.05, -0.06, COAL, { metalness: 0.6 });
    bxF(t, 0.05, 0.03, 0.02, 0.11, -0.01, 0.02, accent, { emissive: accent, emissiveIntensity: 2.2 });
    // 頂置電池 + 綁帶 ×2 + 擊墜正字刻痕(飛手文化;第五道斜劃)
    bxF(t, 0.36, 0.26, 0.78, 0, 0.32, -0.06, 0x1d2126, { metalness: 0.5 });
    for (const z of [-0.34, 0.16]) bxF(t, 0.42, 0.28, 0.08, 0, 0.32, z, PAL.mid, { metalness: 0.4 });
    for (let i = 0; i < 5; i++) {
      const n = bxF(t, 0.015, 0.14, 0.04, -0.19, 0.32, -0.34 + i * 0.13, accent, { metalness: 0.3 });
      if (i === 4) n.rotation.x = 0.55;
    }
    // XT60 辮線(向後下垂;裸露)
    const xt = cylF(t, 0.026, 0.026, 0.24, 6, 0.14, 0.34, -0.46, COAL, { metalness: 0.6 });
    xt.rotation.x = 1.15;
    bxF(t, 0.07, 0.05, 0.08, 0.14, 0.28, -0.58, PAL.deep, { metalness: 0.5 });
    // 兔耳天線 ×2(尾部 V 字)+ 棒棒糖頭
    for (const sx of [-1, 1]) {
      const va = cylF(t, 0.016, 0.02, 0.5, 5, sx * 0.1, 0.34, -0.6, COAL, { metalness: 0.8 });
      va.rotation.x = -0.62;
      va.rotation.z = -sx * 0.5;
      sphF(t, 0.045, sx * 0.24, 0.5, -0.78, accent, { emissive: accent, emissiveIntensity: 1.3 });
    }
  },

  lift(c, t) {
    const { PAL, K } = c;
    const spin = [];
    const R = 0.42, Q = 0.72;                   // true-X:收緊軸距放大槳身比(小架大槳)
    for (const [sx, sz] of [[-1, -1], [-1, 1], [1, -1], [1, 1]]) {
      cylF(t, 0.085, 0.095, 0.16, 8, sx * Q, -0.06, sz * Q, GUNMETAL, { metalness: 0.9 });   // 外露馬達
      const r = rotorF(t, { r: R * K.barrelF, blades: 3, pitch: 0.16, thick: 0.022 },
        sx * Q, 0.04, sz * Q, PAL.lite, { metalness: 0.4, transparent: true, opacity: 0.8 });
      spin.push(r.prop);
      // 臂底隊色 LED 條(夜賽識別;不掛 glows)
      const led = bxF(t, 0.6, 0.015, 0.04, sx * Q * 0.55, -0.25, sz * Q * 0.55, PAL.mid, { metalness: 0.3 });
      led.rotation.y = Math.atan2(sx * Q, sz * Q);
    }
    return { spin };
  },

  mount(c, F) {
    const { accent, PAL, K, dark } = c;
    const t = F.tilt;
    // 前傾 35° 攝影機座(楔形 prism)+ 主色鏡片 + 防撞立柱 —— 這台的姿態錨點
    const cam = prismF(t, [[-0.16, -0.1], [0.16, -0.1], [0.13, 0.14], [-0.13, 0.14]], 0.2,
      0, 0.06, 0.5, PAL.main, { metalness: 0.6 });
    cam.rotation.x = -0.62;
    const lens = sphF(t, 0.1, 0, 0.19, 0.62, accent, { emissive: accent, emissiveIntensity: 1.5 });
    lens.scale.z = 0.7;
    for (const sx of [-1, 1]) {
      const post = cylF(t, 0.02, 0.02, 0.4, 5, sx * 0.19, 0.06, 0.5, COAL, { metalness: 0.85 });
      post.rotation.x = -0.5;
    }
    // 武裝:競速架沒有裝甲,武器一律是最小體積的裸莢(左輕右重)
    const lp = gunPodF(t, { len: 0.5 * K.barrelF, r: 0.07, accent }, -0.2, -0.3, 0.34, dark, { metalness: 0.75 });
    const hp = gunPodF(t, { len: 0.66 * K.barrelF, r: 0.1, accent }, 0.2, -0.3, 0.3, dark, { metalness: 0.75 });
    return {
      muzzles: { light: { n: lp.muz, r: 0.04 }, heavy: { n: hp.muz, r: 0.07 } },
      lightGlowM: [lp.muz, lens], heavyGlowM: [hp.muz],
      weap: { light: 'N', heavy: 'N' }, hvy: { chest: 0.06 },
      wpn: { light: { nodes: [lp.g], ref: lp.g, muz: lp.muz, fwd: 'z' },
        heavy: { nodes: [hp.g], ref: hp.g, muz: hp.muz, fwd: 'z' } },
    };
  },
};
