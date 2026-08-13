// ============ s03@flight 逐機零件檔(航空機體;dev-only)============
// s03「羽陣」始祖式可變機甲 —— **飛行型**(archo 始祖鳥):前緣帶爪的寬羽翼 + 相控陣翼板
// 2D 定案圖:public/assets/cyberpunk_art/mechs/s03_flight_static.jpg(/ _moving / _heavy)
// 設計權威 = mecha.js gen.sil:「飛行型是一對前緣帶爪的寬羽翼,翼面平整得像一塊板;
// 地面型收翼後翼板沿背脊摺成一根長天線。」
// gen.note:「兩種型態 MUST 是**同一組翼板**的兩個狀態(張開 = 陣列面、收攏 = 背脊天線),
// 各畫一組就失去這台機的全部設計理由。」
//   ⇒ 翼面因此**不是羽扇**而是一片**平整的相控陣板**(振子格陣看得見);前緣爪掛在板根,
//     地面型 s03@ground 收攏後就是同一塊板貼背 —— 兩個檔案的板尺寸 MUST 一致(PANEL)。
//
// 2026-08-13 翼向稽核(前後裝反)—— 本檔的機首方向基準先釘死再談:
//   機身 lathe 鼻端 +0.56 / 配平尾桿 −1.06 / 尾端配平塊 −1.56 / gunPodF 的 fwd:'z'
//   ⇒ **+z = 機首**。四處零件當時朝著 −z,逐項:
//   ① 尖頭殼:prismF 的多邊形尖端在 +x,`rotation.y = +π/2` 把 (x,y,z) 送到 (z,y,−x)
//      ⇒ 尖端落在 head-local z = −0.30(機尾),平切後緣反而成了最前端 —— 改 −π/2。
//      連帶:感測條原本從那面平切後緣「戳出來」才看得見,尖端轉正之後整條埋進殼裡
//      ⇒ 移到冠頂當一道橫向感測帶(雙眼是側面凸起,換框後仍露出 0.03,不動)。
//   ② 龍骨突:同一顆 prism 同一個轉法,最深處(0.2)本來落在機尾 ⇒ 同改 −π/2,
//      深胸在前、往尾收成薄片(鳥的龍骨就是這個走向)。
//   ③ 尾舵片:finF 的片寬在 x、片厚在 z ⇒ 面法線留在前後向 = 兩片正對氣流的擋板;
//      而 `rotation.z = +sx·1.15` 把 (0,1,0) 送到 (−sin, cos, 0) ⇒ 兩片還往對側交叉。
//      拆兩層(同 m04 featherRow):外層 Group 出 V 形(−sx),finF 自己 Ry(π/2) 把弦長
//      轉回前後向。⚠ finF 的 sweep/camber 位移在**厚度軸(z)**上,轉 90° 之後會變成
//      離面彎折(不是後掠)⇒ 這裡 MUST 留空;要後掠得等 geo.js 補一個沿片寬軸的參數。
//   ④ 前緣爪:cylF 沿 +y,`rotation.x = −1.0` 把爪尖送到 −z ⇒ 三根爪往機尾倒、平貼在
//      板面上。2D 定案圖(static/moving 兩張)的爪一律**伸出前緣之外朝機首** ⇒ 改正號。
//   不動:相控陣板本身(wingF 的翼型前緣點 cz=+0.5 已經朝 +z)、獵足、武器莢。
import * as THREE from 'three';
import {
  bxF, cylF, sphF, prismF, latheF, finF, wingF, gunPodF,
  IRON, GUNMETAL, COAL,
} from '../geo.js';

// 相控陣翼板尺寸(s03@ground 收攏態的背脊天線 MUST 用同一組數字)
export const PANEL = { span: 1.9, chord: 0.86, thick: 0.07, cells: 6 };

export default {
  label: '羽陣・飛行型(s03 始祖式)', hue: 0x9ee0a6, kind: 'air', height: 3.4,
  air: { tiltY: 1.4, bob: 0.07, top: 27, span: PANEL.span * 2 },
  moveSig: { hover: 0.22, hoverF: 0.75, hoverA: 0.65, surge: 0.38, flare: 0.75, bank: 0.52 },
  castSig: { omni: 'roar', dir: 'kick' },
  doc: [
    ['瘦長軀幹', '輕結構軀幹(lathe)+ 龍骨突(深胸在前、往尾收薄)+ 胸腹電戰艙(艙門微張)'],
    ['頭部感測莢', '尖頭殼(prism,尖端朝機首)+ 冠頂感測帶 + 側面雙眼 —— 與地面型同一顆頭'],
    ['相控陣翼板 ×2', '平整板(wingF 極低厚度)+ 振子格陣 6×3 + 板緣導波槽'],
    ['前緣爪 ×2', '板根前緣的三指爪,爪尖伸出前緣朝機首(收折時就是背脊天線的根部鉸鏈)'],
    ['配平尾', '長尾桿 + 尾端配平塊 + V 形尾舵片 ×2(弦長沿前後向;尾巴是配平桿不是裝飾)'],
    ['獵足 ×2', '飛行時後收的獵足(鐮爪朝後)'],
  ],

  body(c, t) {
    const { PAL, accent, dark } = c;
    latheF(t, [[0, -0.66], [0.13, -0.5], [0.2, -0.06], [0.19, 0.3], [0.11, 0.5], [0, 0.56]], 12,
      0, 0, 0.04, PAL.main, { metalness: 0.6 }).rotation.x = Math.PI / 2;
    // 龍骨突:−π/2 讓多邊形 +x(最深的 0.2)落在 +z = 機首 ⇒ 深胸在前、往尾收成薄片
    prismF(t, [[-0.4, 0], [0.34, 0], [0.26, -0.2], [-0.32, -0.16]], 0.05, 0, -0.17, 0.06, PAL.deep, { metalness: 0.7 })
      .rotation.y = -Math.PI / 2;
    // 胸腹電戰艙(艙門微張 = 陣列散熱)
    const door = bxF(t, 0.3, 0.03, 0.34, 0, -0.2, 0.16, PAL.lite, { metalness: 0.6 });
    door.rotation.x = 0.3;
    bxF(t, 0.24, 0.1, 0.26, 0, -0.12, 0.16, COAL, { metalness: 0.75 });
    // 頭(與地面型同一顆:尖頭殼 + 感測條)
    const head = new THREE.Group();
    head.position.set(0, 0.14, 0.6);
    head.rotation.x = -0.1;
    t.add(head);
    // −π/2:(x,y,z) → (−z, y, x) ⇒ 多邊形尖端(x=+0.3)落在 head-local z = +0.30 = 機首
    prismF(head, [[-0.15, -0.08], [0.24, -0.1], [0.3, 0.02], [0.18, 0.12], [-0.13, 0.14]], 0.18,
      0, 0, 0, PAL.mid, { metalness: 0.65 }).rotation.y = -Math.PI / 2;
    // 感測帶:尖端轉正之後 z=0.14 已在殼內(殼跨 z −0.15~+0.30)⇒ 移到**冠頂最高處**
    // (多邊形上緣 z=−0.13 那端 y≈0.14)當一道橫向帶,露出 0.03 才讀得到
    bxF(head, 0.16, 0.04, 0.06, 0, 0.145, -0.06, accent, { emissive: accent, emissiveIntensity: 1.8 });
    // 雙眼:殼寬恆 ±0.09(擠出深度),球心 ±0.08 + r0.04 ⇒ 換框後仍是側面凸起,不動
    for (const sx of [-1, 1]) sphF(head, 0.04, sx * 0.08, 0.02, 0.14, accent, { emissive: accent, emissiveIntensity: 2.0 });
    // 配平尾(gen.mass:尾巴是配平桿不是裝飾)
    cylF(t, 0.045, 0.06, 1.0, 8, 0, -0.02, -1.06, PAL.mid, { metalness: 0.7 }).rotation.x = Math.PI / 2;
    bxF(t, 0.14, 0.12, 0.2, 0, -0.02, -1.56, GUNMETAL, { metalness: 0.85 });
    // V 形尾舵片:外層 Group 出 V(−sx ⇒ +x 那片往 +x 倒,不交叉)、
    // finF 自己 Ry(π/2) 把片寬(0.06→0.2)轉成前後向弦長、片厚(0.028)轉成側向。
    // sweep/camber 刻意留空:它們的位移在厚度軸上,轉 90° 之後是離面彎折不是後掠(見檔頭 ③)
    for (const sx of [-1, 1]) {
      const fin = new THREE.Group();
      fin.position.set(sx * 0.05, -0.02, -1.5);
      fin.rotation.z = -sx * 1.15;
      t.add(fin);
      finF(fin, { len: 0.3, w0: 0.06, w1: 0.2, t: 0.028 }, 0, 0, 0,
        PAL.lite, { metalness: 0.6 }).rotation.y = Math.PI / 2;
    }
    // 獵足 ×2(飛行時後收;鐮爪朝後 —— 與地面型同一組腿)
    for (const sx of [-1, 1]) {
      const leg = new THREE.Group();
      leg.position.set(sx * 0.15, -0.22, -0.14);
      leg.rotation.x = 1.15;
      t.add(leg);
      cylF(leg, 0.05, 0.06, 0.38, 6, 0, -0.19, 0, PAL.mid, { metalness: 0.7 });
      const shin = new THREE.Group();
      shin.position.set(0, -0.38, 0);
      shin.rotation.x = -1.3;
      leg.add(shin);
      cylF(shin, 0.035, 0.05, 0.34, 6, 0, -0.17, 0, PAL.deep, { metalness: 0.7 });
      const sickle = finF(shin, { len: 0.24, w0: 0.07, w1: 0.02, t: 0.03, sweep: 0.1 }, 0, -0.34, 0.05,
        GUNMETAL, { metalness: 0.9 });
      sickle.rotation.x = 1.9;                              // 鐮爪(始祖鳥/迅猛龍的識別點)
    }
  },

  lift(c, t) {
    const { PAL, accent, dark } = c;
    const wings = [];
    // 相控陣翼板:平整得像一塊板(wingF 極低厚度 + 零扭轉)+ 振子格陣 + 導波槽
    for (const sx of [-1, 1]) {
      const w = new THREE.Group();
      w.position.set(sx * 0.18, 0.12, 0.04);
      t.add(w);
      cylF(w, 0.05, 0.065, 0.36, 8, sx * 0.18, 0, 0, PAL.deep, { metalness: 0.75 }).rotation.z = Math.PI / 2;
      const outer = new THREE.Group();
      outer.position.set(sx * 0.36, 0, 0);
      w.add(outer);
      const panel = wingF(outer, { span: PANEL.span, c0: PANEL.chord, c1: PANEL.chord * 0.86, t: PANEL.thick, sweep: 0.14 },
        0, 0, 0, PAL.main, { metalness: 0.5 });
      panel.scale.x = sx;
      // 振子格陣(6×3;板面上看得見 = 它是陣列面不是羽毛)
      for (let i = 0; i < PANEL.cells; i++) for (let j = 0; j < 3; j++)
        bxF(outer, 0.1, 0.012, 0.1, sx * (0.18 + i * 0.28), PANEL.thick * 0.4, 0.24 - j * 0.24,
          accent, { emissive: accent, emissiveIntensity: 0.7 });
      bxF(outer, PANEL.span * 0.94, 0.02, 0.05, sx * PANEL.span * 0.5, PANEL.thick * 0.4, PANEL.chord * 0.42,
        PAL.deep, { metalness: 0.7 });                       // 板緣導波槽
      // 前緣爪(板根;收折時就是背脊天線的鉸鏈)
      for (let i = 0; i < 3; i++) {
        const f = cylF(outer, 0.014, 0.024, 0.2, 5, sx * (0.16 + i * 0.1), 0.02, PANEL.chord * 0.46,
          GUNMETAL, { metalness: 0.9 });
        f.rotation.x = 1.0 + i * 0.15;      // +:爪尖(cylF 的細端 +y)朝 +z 伸出前緣之外
      }
      wings.push({ w, outer, sgn: sx });
    }
    return { wings };
  },

  mount(c, F) {
    const { accent, K, dark } = c;
    const t = F.tilt;
    const lp = gunPodF(t, { len: 0.7 * K.barrelF, r: 0.085, accent }, -0.2, -0.3, 0.4, dark, { metalness: 0.8 });
    const hp = gunPodF(t, { len: 0.98 * K.barrelF, r: 0.13, accent }, 0.2, -0.3, 0.34, dark, { metalness: 0.8 });
    return {
      muzzles: { light: { n: lp.muz, r: 0.05 }, heavy: { n: hp.muz, r: 0.09 } },
      lightGlowM: [lp.muz], heavyGlowM: [hp.muz],
      weap: { light: 'N', heavy: 'N' }, hvy: { chest: 0.05 },
      wpn: { light: { nodes: [lp.g], ref: lp.g, muz: lp.muz, fwd: 'z' },
        heavy: { nodes: [hp.g], ref: hp.g, muz: hp.muz, fwd: 'z' } },
    };
  },
};
