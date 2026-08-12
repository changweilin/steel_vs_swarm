// ============ t09 逐機零件檔(航空機體;dev-only)============
// t09「悲歌」巡飛彈母機(fixed / wing:'delta'):三角翼 + 翼端垂尾 + 腹部子機投放艙
// 2D 定案圖:public/assets/cyberpunk_art/mechs/t09_static.png(/ _moving / _heavy)
// 設計權威 = mecha.js gen.sil:「一片乾淨的三角翼,翼端小垂尾,機背後段是一具推進器;
// 腹部整段是可開合的子機投放艙。」「翼面幾乎就是全機,機身厚度小。」
// gen.note:「『便宜』是它的設計語言:MUST 保留粗糙的製造痕(流痕、鉚釘、膠帶),
// 做得精緻就違背它存在的理由。」
//   ⇒ 粗糙痕由**三件事**表達:鉚釘列(逐顆小圓柱)、歪一點的膠帶條、模具流痕溝 ——
//     全部是決定性排列(§2.3 零亂數),但刻意不對稱。
import * as THREE from 'three';
import {
  bxF, cylF, sphF, prismF, latheF, wingF, jetF, gunPodF,
  IRON, GUNMETAL, COAL,
} from '../geo.js';

export default {
  label: '悲歌(t09 巡飛彈母機)', hue: 0xc9a628, kind: 'air', height: 3.4,
  air: { tiltY: 1.3, bob: 0.03, top: 36, level: true, span: 2.9 },
  moveSig: { hover: 0.20, hoverF: 1.1, hoverA: 0.10, surge: 0.90, flare: 0, bank: 0.32 },
  castSig: { omni: 'spin', dir: 'lunge' },
  doc: [
    ['三角翼主體', '一片大後掠三角翼(prism 平面輪廓)+ 薄機身脊 + 前段導引艙'],
    ['翼端垂尾 ×2', '小垂片(prism)+ 翼端配重'],
    ['腹部投放艙', '整段腹艙(tbox)+ 對開艙門 ×2(微張)+ 子機掛排 ×4'],
    ['尾置推進器', '機背後段推進器 + 噴射尾焰(jetF)'],
    ['製造痕', '鉚釘列 ×3(逐顆)+ 歪貼膠帶條 ×2 + 模具流痕溝 —— 便宜是設計語言'],
  ],

  body(c, t) {
    const { PAL, accent, dark } = c;
    // 三角翼主體:一片平面輪廓(前尖後寬),厚度薄
    const DELTA = [[0, 1.45], [0.28, 0.5], [1.32, -1.0], [1.32, -1.22], [-1.32, -1.22], [-1.32, -1.0], [-0.28, 0.5]];
    const wing = prismF(t, DELTA, 0.14, 0, 0, 0, PAL.main, { metalness: 0.5 });
    wing.rotation.x = -Math.PI / 2;
    // 薄機身脊(翼面上唯一的縱向量體)+ 前段導引艙
    prismF(t, [[-0.2, 0], [0.2, 0], [0.14, 0.24], [-0.14, 0.24]], 2.1, 0, 0.06, -0.1,
      PAL.mid, { metalness: 0.55 });
    latheF(t, [[0, -0.3], [0.15, -0.16], [0.17, 0.1], [0.1, 0.28], [0, 0.32]], 10, 0, 0.06, 1.16,
      PAL.deep, { metalness: 0.6 }).rotation.x = Math.PI / 2;
    const seek = sphF(t, 0.11, 0, 0.06, 1.42, accent, { emissive: accent, emissiveIntensity: 1.3 });
    seek.scale.z = 0.8;
    // 翼端垂尾 ×2 + 配重
    for (const sx of [-1, 1]) {
      const vf = prismF(t, [[-0.3, 0], [0.16, 0], [0.06, 0.42], [-0.24, 0.44]], 0.04,
        sx * 1.28, 0.06, -1.02, PAL.mid, { metalness: 0.55 });
      vf.rotation.y = Math.PI / 2;
      bxF(t, 0.09, 0.09, 0.2, sx * 1.28, -0.02, -0.7, dark, { metalness: 0.7 });
    }
    // ---- 製造痕(便宜的證據;決定性排列但刻意不對稱)----
    for (let i = 0; i < 9; i++)                        // 鉚釘列 A(左翼前緣,等距)
      cylF(t, 0.018, 0.018, 0.02, 6, -0.36 - i * 0.1, 0.075, 0.5 - i * 0.14, COAL, { metalness: 0.9 })
        .rotation.x = Math.PI / 2;
    for (let i = 0; i < 7; i++)                        // 鉚釘列 B(右翼,間距不同 = 不對稱)
      cylF(t, 0.018, 0.018, 0.02, 6, 0.42 + i * 0.12, 0.075, 0.3 - i * 0.16, COAL, { metalness: 0.9 })
        .rotation.x = Math.PI / 2;
    for (let i = 0; i < 5; i++)                        // 鉚釘列 C(腹艙門緣)
      cylF(t, 0.016, 0.016, 0.02, 6, -0.28 + i * 0.14, -0.075, -0.9, COAL, { metalness: 0.9 })
        .rotation.x = Math.PI / 2;
    const tp1 = bxF(t, 0.5, 0.012, 0.13, -0.62, 0.076, -0.32, PAL.lite, { metalness: 0.2 });
    tp1.rotation.y = 0.19;                             // 歪貼(整齊就不是這台機)
    const tp2 = bxF(t, 0.36, 0.012, 0.11, 0.5, 0.076, 0.16, PAL.lite, { metalness: 0.2 });
    tp2.rotation.y = -0.26;
    for (let i = 0; i < 3; i++)                        // 模具流痕溝
      bxF(t, 0.02, 0.016, 1.2, -0.9 + i * 0.9, 0.072, -0.4, PAL.deep, { metalness: 0.4 }).rotation.y = 0.05 * (i - 1);
  },

  lift(c, t) {
    const { PAL, accent } = c;
    // 尾置推進器(機背後段)+ 噴射尾焰
    latheF(t, [[0.2, 0], [0.22, 0.12], [0.16, 0.34], [0.18, 0.4]], 10, 0, 0.12, -1.0, COAL, { metalness: 0.85 })
      .rotation.x = Math.PI / 2;
    const ring = cylF(t, 0.14, 0.14, 0.05, 10, 0, 0.12, -1.22, accent, { emissive: accent, emissiveIntensity: 1.6 });
    ring.rotation.x = Math.PI / 2;
    const fl = jetF(t, 0.13, 1.4, 0, 0.12, -1.28, accent);
    fl.g.rotation.x = Math.PI / 2;
    return { jets: [fl] };
  },

  mount(c, F) {
    const { accent, PAL, K, dark } = c;
    const t = F.tilt;
    // ---- 腹部投放艙(整段;對開艙門微張 + 子機掛排 ×4)----
    const bay = new THREE.Group();
    bay.position.set(0, -0.1, -0.2);
    t.add(bay);
    bxF(bay, 0.76, 0.24, 1.5, 0, -0.14, 0, PAL.deep, { metalness: 0.6 });
    for (const sx of [-1, 1]) {
      const door = bxF(bay, 0.36, 0.03, 1.46, sx * 0.24, -0.27, 0, PAL.mid, { metalness: 0.6 });
      door.rotation.z = sx * 0.42;                     // 微張(投放艙是最大的形狀變化)
    }
    for (let i = 0; i < 4; i++) {                      // 子機掛排(細長巡飛彈)
      const z = 0.52 - i * 0.36;
      const sub = latheF(bay, [[0, -0.2], [0.055, -0.14], [0.06, 0.14], [0, 0.22]], 8,
        (i % 2 ? 0.16 : -0.16), -0.2, z, dark, { metalness: 0.7 });
      sub.rotation.x = Math.PI / 2;
      for (const sx2 of [-1, 1])                       // 彈翼(折收)
        bxF(bay, 0.13, 0.012, 0.06, (i % 2 ? 0.16 : -0.16) + sx2 * 0.08, -0.2, z - 0.1, PAL.lite, { metalness: 0.6 });
    }
    const lMuz = cylF(bay, 0.07, 0.07, 0.03, 8, 0, -0.24, 0.74, accent, { emissive: accent, emissiveIntensity: 1.4 });
    lMuz.rotation.x = Math.PI / 2;
    // 重武器:機首下方前射莢
    const hp = gunPodF(t, { len: 1.0 * K.barrelF, r: 0.13, accent }, 0, -0.16, 0.86, dark, { metalness: 0.75 });
    return {
      muzzles: { light: { n: lMuz, r: 0.06 }, heavy: { n: hp.muz, r: 0.09 } },
      lightGlowM: [lMuz], heavyGlowM: [hp.muz],
      weap: { light: 'N', heavy: 'N' }, hvy: { chest: 0.04 },
      wpn: { light: { nodes: [bay], ref: bay, muz: lMuz, fwd: 'z' },
        heavy: { nodes: [hp.g], ref: hp.g, muz: hp.muz, fwd: 'z' } },
    };
  },
};
