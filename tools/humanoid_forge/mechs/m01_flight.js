// ============ m01@flight 逐機零件檔(航空機體;dev-only)============
// m01「渡鴉」可變式突襲機甲 —— **飛行型**(heli 三旋翼):雙腿當機臂的 Y 字構型
// 2D 定案圖:public/assets/cyberpunk_art/mechs/m01_flight_static.png(/ _moving / _heavy)
// 設計權威 = mecha.js gen.sil:「飛行型雙腿向後外撇打直、與機身構成一個 Y,雙臂沿航向前伸
// 端著武器。」「三具旋翼等距構成正三角。」
// gen.note:「飛行型 MUST 是**雙腿當機臂**的 Y 字(不是長出翅膀);剪影辨識度是這台機的賣點。」
//   ⇒ 三具旋翼 = 機首桅 ×1 + 腿末 ×2,**等距正三角**(TRI 常數推導出位置,不手寫三組座標);
//     左右腿旋翼反向自轉互抵扭矩(spin 名冊逐架交錯,viewer/game 同一份)。
// 頭部與立領直接取地面型(`m01.head`)—— 同一台機的兩個型態,識別點 MUST 是同一顆。
import * as THREE from 'three';
import {
  bxF, cylF, sphF, tboxF, prismF, latheF, finF, rotorF, gunPodF,
  IRON, GUNMETAL, COAL,
} from '../geo.js';
import m01 from './m01.js';

const TRI = 1.15;             // 正三角外接半徑(三具旋翼等距)

export default {
  label: '渡鴉・飛行型(m01 三旋翼)', hue: 0xd94f8f, kind: 'air', height: 4.0,
  air: { tiltY: 1.45, bob: 0.05, top: 30, span: TRI * 2 },
  moveSig: { hover: 0.55, hoverF: 1.8, hoverA: 0.12, surge: 0.85, flare: 0.45, bank: 0.70 },
  castSig: { omni: 'spin', dir: 'swing' },
  doc: [
    ['修長軀幹', '壓平的修長人形軀幹(tbox)+ 胸甲 + 腰掛彈架'],
    ['高豎立領 + 頭', '直接取地面型 m01.head() —— 立領是剪影識別點,MUST 是同一顆'],
    ['機首桅旋翼', 'Y 字前臂:桅柱 + rotorF 三葉(正三角頂點)'],
    ['腿末旋翼 ×2', '向後外撇打直的雙腿 = 機臂;腿末桅指天 + rotorF(左右反轉互抵扭矩)'],
    ['雙臂前伸', '沿航向前伸端武器的雙臂(飛行姿態,不是收在身側)'],
    ['摺收機構', '腿根/桅根的摺收鉸鏈環 ×3 + 液壓桿'],
    ['航行燈', '左紅右綠(航空慣例硬編色;純識別燈不掛 glows)'],
  ],

  body(c, t) {
    const { PAL, accent, dark } = c;
    // 修長軀幹(壓平;航向 +z)
    tboxF(t, { w0: 0.5, d0: 0.4, w1: 0.4, d1: 0.3, h: 1.24, sz: 0.03 }, 0, 0, 0.06, PAL.main, { metalness: 0.62 })
      .rotation.x = -Math.PI / 2;
    prismF(t, [[-0.26, -0.18], [0.26, -0.18], [0.2, 0.16], [-0.2, 0.16]], 0.46, 0, 0.1, 0.4,
      PAL.mid, { metalness: 0.66 });
    // 腰掛彈架
    for (const sx of [-1, 1]) {
      bxF(t, 0.1, 0.16, 0.4, sx * 0.28, -0.1, -0.34, dark, { metalness: 0.7 });
      for (let i = 0; i < 3; i++)
        cylF(t, 0.035, 0.035, 0.3, 6, sx * 0.28, -0.16 + i * 0.06, -0.34, PAL.deep, { metalness: 0.75 })
          .rotation.x = Math.PI / 2;
    }
    // 頭 + 高豎立領(同一顆:地面型 m01.head)
    const head = new THREE.Group();
    head.position.set(0, 0.16, 0.68);
    head.rotation.x = 0.85;
    t.add(head);
    m01.head(c, head);
    // 雙臂沿航向前伸(端著武器的飛行姿態)
    for (const sx of [-1, 1]) {
      const arm = new THREE.Group();
      arm.position.set(sx * 0.3, 0.06, 0.42);
      arm.rotation.x = 1.42;
      arm.rotation.z = -sx * 0.1;
      t.add(arm);
      tboxF(arm, { w0: 0.15, d0: 0.15, w1: 0.12, d1: 0.12, h: 0.44 }, 0, -0.22, 0, PAL.mid, { metalness: 0.68 });
      cylF(arm, 0.08, 0.08, 0.09, 8, 0, -0.46, 0, COAL, { metalness: 0.88 }).rotation.z = Math.PI / 2;
      tboxF(arm, { w0: 0.13, d0: 0.13, w1: 0.1, d1: 0.1, h: 0.42 }, 0, -0.7, 0.02, PAL.main, { metalness: 0.68 });
    }
  },

  lift(c, t) {
    const { PAL, K, accent } = c;
    const spin = [];
    // 三具旋翼等距正三角:機首桅(+z 頂點)+ 腿末 ×2(後兩頂點)
    const P = [0, 1, 2].map((i) => {
      const th = i * Math.PI * 2 / 3;
      return [Math.sin(th) * TRI, Math.cos(th) * TRI];     // i=0 → (0, TRI) = 機首
    });
    // 機首桅:自胸前伸出的桅柱
    cylF(t, 0.07, 0.09, 0.7, 8, 0, 0.06, P[0][1] * 0.5, PAL.deep, { metalness: 0.8 }).rotation.x = Math.PI / 2;
    cylF(t, 0.09, 0.09, 0.12, 8, 0, 0.06, P[0][1], COAL, { metalness: 0.9 });
    const r0 = rotorF(t, { r: 0.72 * K.barrelF, blades: 3, pitch: 0.15, thick: 0.028 },
      0, 0.14, P[0][1], PAL.lite, { metalness: 0.5, transparent: true, opacity: 0.85 });
    spin.push(r0.prop);
    // 腿末 ×2:向後外撇打直的雙腿 = 機臂
    [1, 2].forEach((i, k) => {
      const [x, z] = P[i];
      const sx = x < 0 ? -1 : 1;
      const leg = new THREE.Group();
      leg.position.set(sx * 0.16, -0.06, -0.4);
      leg.rotation.x = -1.42;                              // 打直後撇
      leg.rotation.z = -sx * 0.5;
      t.add(leg);
      cylF(leg, 0.11, 0.13, 0.12, 8, 0, 0, 0, COAL, { metalness: 0.9 });        // 摺收鉸鏈環
      tboxF(leg, { w0: 0.2, d0: 0.22, w1: 0.15, d1: 0.17, h: 0.66 }, 0, -0.35, 0, PAL.mid, { metalness: 0.66 });
      cylF(leg, 0.08, 0.08, 0.1, 8, 0, -0.7, 0, COAL, { metalness: 0.9 }).rotation.z = Math.PI / 2;
      tboxF(leg, { w0: 0.16, d0: 0.18, w1: 0.12, d1: 0.14, h: 0.6 }, 0, -1.0, 0.01, PAL.main, { metalness: 0.66 });
      // 腿末桅(反轉指天,補償腿的後撇)
      const mast = new THREE.Group();
      mast.position.set(0, -1.3, 0);
      mast.rotation.x = 1.42;
      mast.rotation.z = sx * 0.5;
      leg.add(mast);
      cylF(mast, 0.055, 0.07, 0.26, 8, 0, 0.13, 0, PAL.deep, { metalness: 0.8 });
      const r = rotorF(mast, { r: 0.66 * K.barrelF, blades: 3, pitch: 0.15, thick: 0.026 },
        0, 0.28, 0, PAL.lite, { metalness: 0.5, transparent: true, opacity: 0.85 });
      spin.push(r.prop);
      // 航行燈(左紅右綠;硬編色 = 航空慣例,不掛 glows)
      const nc = sx < 0 ? 0xff3b30 : 0x35d07a;
      bxF(leg, 0.05, 0.05, 0.05, sx * 0.12, -1.26, 0.1, nc, { emissive: nc, emissiveIntensity: 1.3 });
    });
    return { spin };
  },

  mount(c, F) {
    const { accent, K, dark } = c;
    const t = F.tilt;
    // 雙臂端著的武器(前伸姿態 ⇒ 莢掛在臂末,沿 +z 朝航向)
    const lp = gunPodF(t, { len: 1.0 * K.barrelF, r: 0.1, accent }, -0.36, -0.44, 0.9, dark, { metalness: 0.8 });
    const hp = gunPodF(t, { len: 1.2 * K.barrelF, r: 0.14, accent }, 0.36, -0.44, 0.86, dark, { metalness: 0.8 });
    return {
      muzzles: { light: { n: lp.muz, r: 0.05 }, heavy: { n: hp.muz, r: 0.09 } },
      lightGlowM: [lp.muz], heavyGlowM: [hp.muz],
      weap: { light: 'N', heavy: 'N' }, hvy: { chest: 0.05 },
      wpn: { light: { nodes: [lp.g], ref: lp.g, muz: lp.muz, fwd: 'z' },
        heavy: { nodes: [hp.g], ref: hp.g, muz: hp.muz, fwd: 'z' } },
    };
  },
};
