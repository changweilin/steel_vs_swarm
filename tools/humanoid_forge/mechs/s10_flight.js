// ============ s10@flight 逐機零件檔(航空機體;dev-only)============
// s10「靜電」長耳可變訊號機 —— **飛行型**(levi 飛鯨):鯨形浮空囊 + 腹下細長訊號吊艙
// 2D 定案圖:public/assets/cyberpunk_art/mechs/s10_flight_static.jpg
// 設計權威 = mecha.js gen.sil:「飛行型是一具鯨形浮空囊,腹下吊著細長的訊號艙。」
// 「飛行型體積巨大而密度極低。」
// gen.note(耳廓是天線)講的是地面型;飛行型的同一句話是:**囊體是氣囊不是機身** ——
//   囊面 MUST 看得到縱向充氣隔艙的稜線與繫留帶,畫成金屬機身就變成飛船以外的東西。
// 升力來自浮力 ⇒ **沒有旋翼、沒有噴口**,只有兩具低速矢量推進器;top 壓到全機種最低。
import * as THREE from 'three';
import {
  bxF, cylF, sphF, prismF, latheF, finF, rotorF, gunPodF,
  IRON, GUNMETAL, COAL,
} from '../geo.js';

export default {
  label: '靜電・飛行型(s10 飛鯨)', hue: 0xd7c9ff, kind: 'air', height: 5.0,
  air: { tiltY: 1.8, bob: 0.11, top: 12, span: 2.2 },
  moveSig: { hover: 0.15, hoverF: 0.5, hoverA: 0.25, surge: 0.05, flare: 0.05, bank: 0.05 },
  castSig: { omni: 'roar', dir: 'swing' },
  doc: [
    ['浮空囊體', '鯨形氣囊(lathe 大旋成)+ 縱向充氣隔艙稜線 ×8 + 繫留帶 ×3'],
    ['鯨首', '鈍圓頭部(lathe)+ 下頷溝槽 ×5 + 感測眼 ×2'],
    ['訊號情報吊艙', '腹下細長吊艙(lathe)+ 吊掛桿 ×4 + 側面陣列窗 ×6'],
    ['耳廓天線 ×2', '收摺貼囊側的振子格陣板(與地面型同一組面板)'],
    ['尾鰭', '水平鯨尾(finF ×2)+ 垂直尾鰭'],
    ['矢量推進器 ×2', '低速涵道螺槳(rotorF;浮力機的唯一動力)'],
  ],

  body(c, t) {
    const { PAL, accent, dark } = c;
    // 鯨形浮空囊(體積巨大、密度極低):大旋成體 + 隔艙稜線 + 繫留帶
    latheF(t, [[0, -1.9], [0.34, -1.6], [0.7, -0.8], [0.86, 0], [0.8, 0.8], [0.5, 1.4], [0, 1.72]], 16,
      0, 0.1, 0, PAL.main, { metalness: 0.3 }).rotation.x = Math.PI / 2;
    for (let i = 0; i < 8; i++) {                    // 縱向充氣隔艙稜線(它是氣囊不是機身)
      const th = i / 8 * Math.PI * 2;
      const r = prismF(t, [[-1.7, 0], [1.5, 0], [1.4, 0.035], [-1.6, 0.035]], 0.05,
        Math.sin(th) * 0.78, 0.1 + Math.cos(th) * 0.78, 0, PAL.deep, { metalness: 0.35 });
      r.rotation.y = Math.PI / 2;
      r.rotation.z = th;
    }
    for (const z of [-0.9, 0, 0.8])                  // 繫留帶
      cylF(t, 0.86, 0.86, 0.06, 16, 0, 0.1, z, PAL.mid, { metalness: 0.4 }).rotation.x = Math.PI / 2;
    // 鯨首:下頷溝槽 + 感測眼
    for (let i = 0; i < 5; i++)
      bxF(t, 0.5 - i * 0.06, 0.03, 0.5, 0, -0.44 + i * 0.03, 1.24 - i * 0.14, PAL.deep, { metalness: 0.4 });
    for (const sx of [-1, 1]) sphF(t, 0.075, sx * 0.44, 0.1, 1.28, accent, { emissive: accent, emissiveIntensity: 1.6 });
    // 耳廓天線 ×2(收摺貼囊側;與地面型同一組面板)
    for (const sx of [-1, 1]) {
      const ear = bxF(t, 0.06, 0.9, 0.72, sx * 0.9, 0.24, -0.3, PAL.lite, { metalness: 0.55 });
      ear.rotation.z = sx * 0.18;
      ear.rotation.y = -sx * 0.24;
      for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++)
        bxF(t, 0.015, 0.16, 0.16, sx * 0.94, 0.24 + (i - 1) * 0.26, -0.3 + (j - 1) * 0.22,
          accent, { emissive: accent, emissiveIntensity: 0.7 });
    }
    // ---- 腹下訊號情報吊艙(細長)+ 吊掛桿 + 陣列窗 ----
    latheF(t, [[0, -1.1], [0.13, -0.96], [0.17, 0], [0.15, 0.86], [0, 1.0]], 12, 0, -1.16, -0.1,
      PAL.mid, { metalness: 0.6 }).rotation.x = Math.PI / 2;
    for (const sx of [-1, 1]) for (const sz of [-0.6, 0.5]) {
      const rod = cylF(t, 0.022, 0.028, 0.5, 5, sx * 0.16, -0.82, sz, IRON, { metalness: 0.85 });
      rod.rotation.z = sx * 0.28;
    }
    for (let i = 0; i < 6; i++)
      bxF(t, 0.02, 0.1, 0.2, (i % 2 ? 1 : -1) * 0.17, -1.16, 0.6 - Math.floor(i / 2) * 0.5,
        accent, { emissive: accent, emissiveIntensity: 0.9 });
    // 尾鰭:水平鯨尾 + 垂直尾鰭
    // ⚠ finF 的三軸是「長 = 局部 +y、寬 = 局部 x、厚 = 局部 z」⇒ 片面法線在局部 z。
    //   Rz 不動局部 z:單靠 rotation.z 擺出來的「水平」鯨尾,前後弦長只剩 t(一把立起來的刀);
    //   而 Rz(+sx·π/2) 把 +y 送到 (−sx, 0, 0) ⇒ +x 那片指向 −x,兩片在尾根互穿。
    //   轉正 MUST 兩層:內層網格繞自身長軸 rotation.y = π/2 把「寬」送進 z(弦落在前後),
    //   外層 Group 出 rotation.z 把它放平 —— 兩個角寫在同一顆網格上會被尤拉序互相轉走。
    for (const sx of [-1, 1]) {
      const fl = new THREE.Group();
      fl.position.set(sx * 0.1, 0.02, -1.74);
      fl.rotation.z = -sx * Math.PI / 2;             // 長軸 +y → +sx·x(同號,兩片才不交叉)
      t.add(fl);
      // 轉正後 sweep 沿世界 ∓y(不再是側向偏移)⇒ 逐邊反號才是對稱的鯨尾上翹
      finF(fl, { len: 0.8, w0: 0.3, w1: 0.12, t: 0.06, sweep: -sx * 0.1 }, 0, 0, 0,
        PAL.lite, { metalness: 0.45 }).rotation.y = Math.PI / 2;
    }
    // 垂直尾鰭:同樣繞長軸轉正(弦 0.34 落在前後、厚 0.055 落在左右)。
    // 轉正後 finF 的 sweep 落在世界 ±x(側向偏移)⇒ 給不出「梢端往機尾」,
    // 後掠改由外層 Group 的仰角表達(Rx(−θ) 把 +y 的末端送向 −z)。
    const vf = new THREE.Group();
    vf.position.set(0, 0.3, -1.66);
    vf.rotation.x = -0.28;
    t.add(vf);
    finF(vf, { len: 0.66, w0: 0.34, w1: 0.1, t: 0.055 }, 0, 0, 0, PAL.lite, { metalness: 0.45 })
      .rotation.y = Math.PI / 2;
  },

  lift(c, t) {
    const { PAL, K } = c;
    const spin = [];
    // 矢量推進器 ×2(涵道低速螺槳;浮力機的唯一動力)
    for (const sx of [-1, 1]) {
      cylF(t, 0.26, 0.26, 0.3, 12, sx * 0.94, -0.5, -1.0, PAL.deep, { metalness: 0.7 }).rotation.x = Math.PI / 2;
      const r = rotorF(t, { r: 0.22 * K.barrelF, blades: 4, pitch: 0.28, thick: 0.025, tilt: [Math.PI / 2, 0] },
        sx * 0.94, -0.5, -1.0, PAL.lite, { metalness: 0.5, transparent: true, opacity: 0.85 });
      spin.push(r.prop);
    }
    return { spin };
  },

  mount(c, F) {
    const { accent, K, dark } = c;
    const t = F.tilt;
    const lp = gunPodF(t, { len: 0.8 * K.barrelF, r: 0.1, accent }, -0.3, -1.34, 0.4, dark, { metalness: 0.75 });
    const hp = gunPodF(t, { len: 1.16 * K.barrelF, r: 0.15, accent }, 0.3, -1.34, 0.34, dark, { metalness: 0.75 });
    return {
      muzzles: { light: { n: lp.muz, r: 0.05 }, heavy: { n: hp.muz, r: 0.1 } },
      lightGlowM: [lp.muz], heavyGlowM: [hp.muz],
      weap: { light: 'N', heavy: 'N' }, hvy: { chest: 0.02 },
      wpn: { light: { nodes: [lp.g], ref: lp.g, muz: lp.muz, fwd: 'z' },
        heavy: { nodes: [hp.g], ref: hp.g, muz: hp.muz, fwd: 'z' } },
    };
  },
};
