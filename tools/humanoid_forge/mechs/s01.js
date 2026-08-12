// ============ s01 逐機零件檔(航空機體;dev-only)============
// s01「第聶伯總譜」指揮型六旋翼(bee):六臂旋翼盤 + 方形指揮艙 + 天線叢 + 螫針砲管
// 2D 定案圖:public/assets/cyberpunk_art/mechs/s01_static.png(/ _moving / _heavy)
// 設計權威 = mecha.js gen.sil/parts:「六臂旋翼盤上蓋著一具短胖的方形指揮艙,尾端拖出
// 一根下彎的螫針砲管;艙背立著四支長短不一的中繼天線,是全機唯一超出盤面的東西。」
// gen.note:「螫針是砲管不是裝飾 —— MUST 從艙體尾端**連續**長出來、有膛口制退器。」
//   ⇒ 螫針 = heavy 武器本體(mount 掛在艙尾,不是另外一根尾巴)。
// 蜜蜂原型走「複眼感測 + 黃黑節腹 + 螫針」三件事表達,**不畫蟲翼**:gen.sil 講的是旋翼盤,
// 給它一對膜翅就同時有兩套升力系統(而畫面上只表現成「這台機好像多了什麼」)。
import * as THREE from 'three';
import {
  bxF, cylF, sphF, tboxF, prismF, latheF, finF, rotorF, gunPodF,
  IRON, GUNMETAL, COAL, BRASS,
} from '../geo.js';

const HIVE = 0x2a2622;        // 蜂腹暗節色

export default {
  label: '第聶伯總譜(s01 指揮型六旋翼)', hue: 0xffd857, kind: 'air', height: 3.4,
  air: { tiltY: 1.3, bob: 0.07, top: 24, span: 3.6 },
  moveSig: { hover: 0.60, hoverF: 2.4, hoverA: 0.45, surge: 0.40, flare: 0.55, bank: 0.35 },
  castSig: { omni: 'flare', dir: 'lunge' },
  doc: [
    ['指揮艙', '短胖方形艙(收分楔台)+ 前緣複眼感測列 + 艙背檢修蓋板'],
    ['旋翼盤 ×6', '六支可折機臂(收分楔台)+ 六具旋翼(rotorF 三葉)+ 折疊鉸鏈環'],
    ['天線叢', '四支長短不一的中繼鞭(cyl)+ 束線環 —— 全機唯一超出盤面的東西'],
    ['螫針砲管', '艙尾連續長出的收分砲管(lathe)+ 膛口制退器 = 重武器本體'],
    ['腹部電池艙', '腹掛電池組(楔台)+ 黃黑蜂腹節紋(prism 斜帶 ×3)'],
    ['起落腳架', '四支外撇斜柱 + 橫桿橇'],
  ],

  body(c, t) {
    const { PAL, accent, dark } = c;
    // 指揮艙:短胖收分楔台(頂窄底寬),前緣切一刀當複眼面
    tboxF(t, { w0: 1.12, d0: 1.36, w1: 0.86, d1: 1.02, h: 0.62, sz: 0.06 }, 0, 0.06, 0.02, PAL.main, { metalness: 0.6 });
    // 複眼感測列:艙前斜面上五顆六角複眼(蜜蜂原型的第一件事)
    for (let i = 0; i < 5; i++) {
      const u = i - 2;
      const e = cylF(t, 0.075, 0.075, 0.05, 6, u * 0.16, 0.1 - Math.abs(u) * 0.02, 0.7, accent,
        { emissive: accent, emissiveIntensity: 1.8 });
      e.rotation.x = Math.PI / 2 - 0.3;
    }
    bxF(t, 0.9, 0.05, 0.1, 0, 0.26, 0.62, PAL.deep, { metalness: 0.7 });          // 壓眉稜
    bxF(t, 0.62, 0.04, 0.46, 0, 0.38, -0.14, PAL.lite, { metalness: 0.55 });      // 艙背檢修蓋板
    // 腹部電池艙 + 蜂腹節紋(黃黑斜帶 ×3:蜜蜂的第二件事)
    tboxF(t, { w0: 0.82, d0: 1.1, w1: 0.66, d1: 0.86, h: 0.3 }, 0, -0.34, -0.04, HIVE, { metalness: 0.5 });
    for (let i = 0; i < 3; i++)
      prismF(t, [[-0.4, 0], [0.4, 0], [0.34, 0.08], [-0.46, 0.08]], 0.09,
        0, -0.34, 0.3 - i * 0.3, i % 2 ? COAL : BRASS, { metalness: 0.6 }).rotation.y = Math.PI / 2;
    // 起落腳架:四支外撇斜柱 + 橫桿橇
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
      const p = cylF(t, 0.035, 0.045, 0.52, 6, sx * 0.34, -0.62, sz * 0.42, IRON, { metalness: 0.8 });
      p.rotation.z = sx * 0.28;
      p.rotation.x = -sz * 0.2;
    }
    for (const sx of [-1, 1]) bxF(t, 0.06, 0.05, 1.1, sx * 0.48, -0.88, 0, COAL, { metalness: 0.75 });
    // 中繼天線叢:四支長短不一(gen.sil 明講「長短不一」)+ 根部束線環
    const LEN = [1.15, 0.86, 0.62, 0.98];
    LEN.forEach((h, i) => {
      const x = (i - 1.5) * 0.15;
      const a = cylF(t, 0.018, 0.028, h, 5, x, 0.42 + h / 2, -0.18 - (i % 2) * 0.08, COAL, { metalness: 0.8 });
      a.rotation.z = (i - 1.5) * 0.08;
      sphF(t, 0.04, x + (i - 1.5) * 0.08 * h * 0.5, 0.42 + h, -0.18 - (i % 2) * 0.08, accent,
        { emissive: accent, emissiveIntensity: 1.2 });
    });
    cylF(t, 0.16, 0.18, 0.09, 8, 0, 0.44, -0.2, dark, { metalness: 0.7 });        // 束線環
  },

  lift(c, t) {
    const { PAL, K } = c;
    const spin = [];
    const R = 0.62, ARM = 1.34;
    // 六臂:hexa 佈局(±30°/±90°/±150°),機臂 = 收分楔台(不是圓管),端點折疊鉸鏈環
    for (let i = 0; i < 6; i++) {
      const th = (i / 6) * Math.PI * 2 + Math.PI / 6;
      const ax = Math.sin(th) * ARM, az = Math.cos(th) * ARM;
      const arm = tboxF(t, { w0: 0.16, d0: ARM, w1: 0.11, d1: ARM, h: 0.11 }, ax / 2, -0.06, az / 2,
        PAL.mid, { metalness: 0.7 });
      arm.rotation.y = th;
      cylF(t, 0.09, 0.09, 0.14, 8, ax * 0.42, -0.06, az * 0.42, COAL, { metalness: 0.85 })
        .rotation.z = Math.PI / 2;                                                // 折疊鉸鏈環
      const r = rotorF(t, { r: R * K.barrelF, blades: 3, pitch: 0.14, thick: 0.028 },
        ax, 0.02, az, PAL.lite, { metalness: 0.5, transparent: true, opacity: 0.85 });
      spin.push(r.prop);
    }
    return { spin };
  },

  mount(c, F) {
    const { accent, PAL, K, dark } = c;
    const t = F.tilt;
    // ---- 螫針砲管(重武器):艙尾**連續**長出的下彎收分砲管 + 膛口制退器 ----
    const sting = new THREE.Group();
    sting.position.set(0, -0.1, -0.66);
    sting.rotation.x = -0.34;                       // 下彎(gen.sil:「尾端拖出一根下彎的螫針」)
    t.add(sting);
    const L = 1.25 * K.barrelF;
    const bar = latheF(sting, [[0.19, 0], [0.15, L * 0.3], [0.1, L * 0.68], [0.075, L], [0, L]], 10,
      0, 0, -L / 2, PAL.deep, { metalness: 0.8 });
    bar.rotation.x = -Math.PI / 2;                  // 旋成體 +y → 機尾 −z
    for (let i = 0; i < 3; i++)                     // 節環(蜂針的倒鉤感)
      cylF(sting, 0.17 - i * 0.03, 0.17 - i * 0.03, 0.05, 8, 0, 0, -L * (0.28 + i * 0.24), COAL,
        { metalness: 0.9 }).rotation.x = Math.PI / 2;
    const brake = cylF(sting, 0.11, 0.11, 0.14, 8, 0, 0, -L * 0.98, COAL, { metalness: 0.9 });
    brake.rotation.x = Math.PI / 2;
    for (const sx of [-1, 1]) bxF(sting, 0.03, 0.14, 0.1, sx * 0.1, 0, -L * 0.98, GUNMETAL, { metalness: 0.9 });
    const hMuz = cylF(sting, 0.075, 0.075, 0.03, 8, 0, 0, -L * 1.06, accent,
      { emissive: accent, emissiveIntensity: 1.6 });
    hMuz.rotation.x = Math.PI / 2;
    // ---- 輕武器:腹前小口徑莢(指揮機的自衛武裝;沿 +z 朝前)----
    const lp = gunPodF(t, { len: 0.72 * K.barrelF, r: 0.11, accent }, 0, -0.5, 0.42, dark, { metalness: 0.7 });
    return {
      muzzles: { light: { n: lp.muz, r: 0.05 }, heavy: { n: hMuz, r: 0.1 } },
      lightGlowM: [lp.muz], heavyGlowM: [hMuz],
      weap: { light: 'N', heavy: 'N' }, hvy: { chest: 0.05 },
      // 螫針朝機尾 −z(下彎);FPV 同源方向因此是 '-z',MUST NOT 抄輕莢的 'z'
      wpn: { light: { nodes: [lp.g], ref: lp.g, muz: lp.muz, fwd: 'z' },
        heavy: { nodes: [sting], ref: sting, muz: hMuz, fwd: '-z' } },
    };
  },
};
