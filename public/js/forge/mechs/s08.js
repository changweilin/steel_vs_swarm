// ============ s08 逐機零件檔(航空機體;dev-only)============
// s08「燭台」醫療運補機:球形主艙 + 共軸雙旋翼塔 + 恆溫吊艙 + 收放吊索
// 2D 定案圖:public/assets/cyberpunk_art/mechs/s08_static.png(/ _moving / _heavy)
// 設計權威 = mecha.js gen.sil:「一顆渾圓的白綠色艙體,頭頂一組上下同軸的雙旋翼,腹下垂著
// 一具恆溫吊艙與收放式吊索;沒有任何武裝突出物。」「整台機從側面看是一條垂直軸線。」
// gen.note:「機體本身 MUST 完全沒有武器(章程明定)。」
//   ⇒ 本檔的兩個 rig.wpn 錨點刻意**不是槍**:輕 = 投放口(血袋尾門)、重 = 探照燈莢。
//     rig 契約要求 muzzles/wpn 齊全(FPV 同源),而「章程明定不武裝」是外觀上的事 ——
//     掛兩根砲管上去才是真的違反那句話。醫療識別(綠十字/頻閃)一律 noPaint 不吃花紋。
import * as THREE from 'three';
import {
  bxF, cylF, sphF, tboxF, latheF, torusF, rotorF,
  IRON, GUNMETAL, COAL,
} from '../geo.js';

const MED = 0x39d98a;         // 醫療綠(固定識別色,不隨主色走)

export default {
  label: '燭台(s08 醫療運補機)', kind: 'air', height: 3.2,
  air: { tiltY: 1.35, bob: 0.03, top: 20, span: 2.6 },
  moveSig: { hover: 0.05, hoverF: 0.5, hoverA: 0.06, surge: 0.10, flare: 0.25, bank: 0.10 },
  castSig: { omni: 'spin', dir: 'lunge' },
  doc: [
    ['球形主艙', '渾圓艙體(lathe 旋成)+ 赤道分模線 + 側面醫療圓盤(白底綠十字)×2'],
    ['共軸雙旋翼塔', '塔柱 + 上下反轉雙槳盤(rotorF ×2)+ 傳動整流罩'],
    ['恆溫吊艙', '腹下膠囊吊艙(lathe)+ 箍帶 ×2 + 冷排鰭 ×3 + 尾門與恆溫燈'],
    ['吊索絞盤', '絞盤鼓 + 導纜架 + 垂纜 + J 形吊鉤'],
    ['起落滑橇', '兩支橫向弓形橇(cyl)+ 支柱 ×4'],
    ['識別燈組', '綠十字燈 ×2(腹側)+ 機頂綠頻閃 + 著陸探照燈'],
  ],

  body(c, t) {
    const { PAL, accent, dark } = c;
    // 球形主艙:旋成體(不是 sphere.scale —— 側輪廓要看得到肩部收分)
    latheF(t, [[0, -0.62], [0.34, -0.56], [0.56, -0.3], [0.62, 0], [0.54, 0.28], [0.3, 0.46], [0, 0.5]],
      14, 0, -0.02, 0, PAL.main, { metalness: 0.5 });
    torusF(t, 0.615, 0.022, 0, -0.02, 0, PAL.deep, { metalness: 0.6 }).rotation.x = Math.PI / 2;   // 赤道分模線
    // 側面醫療徽記圓盤(白底 + 綠十字;凸出球面最寬處,否則側視被球弧吞掉)
    for (const sx of [-1, 1]) {
      const rg = new THREE.Group();
      rg.position.set(sx * 0.585, -0.02, 0);
      rg.rotation.z = -sx * Math.PI / 2;
      t.add(rg);
      const disc = cylF(rg, 0.19, 0.19, 0.055, 16, 0, 0.01, 0, 0xf2f5f7, { metalness: 0.2 });
      const c1 = bxF(rg, 0.3, 0.03, 0.09, 0, 0.045, 0, MED, { metalness: 0.2 });
      const c2 = bxF(rg, 0.09, 0.03, 0.3, 0, 0.045, 0, MED, { metalness: 0.2 });
      for (const m of [disc, c1, c2]) m.userData.noPaint = true;
    }
    // 前緣感測窗(取代座艙罩)
    const win = cylF(t, 0.17, 0.2, 0.06, 12, 0, 0.06, 0.56, accent, { emissive: accent, emissiveIntensity: 0.9 });
    win.rotation.x = Math.PI / 2 - 0.25;
    // ---- 恆溫吊艙(腹下膠囊)+ 箍帶 + 冷排鰭 + 尾門 ----
    latheF(t, [[0, -0.5], [0.2, -0.44], [0.26, -0.2], [0.26, 0.2], [0.18, 0.36], [0, 0.4]],
      12, 0, -0.98, -0.06, PAL.lite, { metalness: 0.45 });
    for (const z of [-0.3, 0.16]) bxF(t, 0.42, 0.3, 0.05, 0, -0.98, z + -0.06, PAL.mid, { metalness: 0.6 });
    for (let i = 0; i < 3; i++) bxF(t, 0.075, 0.014, 0.16, 0.23, -0.86 - i * 0.06, -0.2, PAL.mid, { metalness: 0.7 });
    const door = bxF(t, 0.16, 0.16, 0.02, 0, -1.0, -0.34, dark, { metalness: 0.5 });
    door.rotation.x = 0.3;
    const dl = bxF(t, 0.24, 0.035, 0.03, 0, -0.82, -0.32, MED, { emissive: MED, emissiveIntensity: 1.4 });
    dl.userData.noPaint = true;
    // 腹側綠十字燈 ×2(固定識別色)
    for (const sx of [-1, 1]) {
      const a = bxF(t, 0.02, 0.24, 0.07, sx * 0.22, -0.94, -0.2, MED, { emissive: MED, emissiveIntensity: 1.8 });
      const b = bxF(t, 0.02, 0.07, 0.24, sx * 0.22, -0.94, -0.2, MED, { emissive: MED, emissiveIntensity: 1.8 });
      a.userData.noPaint = true; b.userData.noPaint = true;
    }
    // 機頂綠頻閃(對空「勿擊」宣告;收在下層槳掃掠面之下)
    const st = sphF(t, 0.045, 0, 0.56, 0.24, MED, { emissive: MED, emissiveIntensity: 1.9 });
    st.userData.noPaint = true;
    // 起落滑橇:兩支橫向弓形橇 + 支柱 ×4
    for (const sx of [-1, 1]) {
      const sk = cylF(t, 0.035, 0.035, 1.24, 6, sx * 0.46, -1.24, 0, IRON, { metalness: 0.8 });
      sk.rotation.x = Math.PI / 2;
      for (const sz of [-1, 1]) {
        const leg = cylF(t, 0.028, 0.032, 0.56, 6, sx * 0.4, -0.96, sz * 0.4, IRON, { metalness: 0.8 });
        leg.rotation.z = sx * 0.22;
        leg.rotation.x = -sz * 0.14;
      }
    }
  },

  lift(c, t) {
    const { PAL, K } = c;
    const spin = [];
    // 共軸塔:塔柱 + 傳動整流罩 + 上下反轉雙槳盤(側視是一條垂直軸線的上半)
    cylF(t, 0.11, 0.15, 0.56, 10, 0, 0.78, 0, GUNMETAL, { metalness: 0.85 });
    latheF(t, [[0, 0], [0.2, 0.06], [0.22, 0.2], [0.12, 0.32], [0, 0.36]], 12, 0, 0.5, 0, PAL.mid, { metalness: 0.7 });
    for (const [y, blades] of [[0.94, 3], [1.16, 3]]) {
      const r = rotorF(t, { r: 1.24 * K.barrelF, blades, pitch: 0.13, thick: 0.028 },
        0, y, 0, PAL.lite, { metalness: 0.45, transparent: true, opacity: 0.82 });
      spin.push(r.prop);
    }
    return { spin };
  },

  mount(c, F) {
    const { accent, PAL, K, dark } = c;
    const t = F.tilt;
    // ---- 輕「武器」錨 = 血袋投放口(章程:機體不武裝)----
    const drop = new THREE.Group();
    drop.position.set(0, -1.16, 0.1);
    t.add(drop);
    cylF(drop, 0.13, 0.15, 0.14, 10, 0, 0, 0, PAL.deep, { metalness: 0.6 });
    const lMuz = cylF(drop, 0.1, 0.1, 0.03, 10, 0, 0, 0.12, accent, { emissive: accent, emissiveIntensity: 1.2 });
    lMuz.rotation.x = Math.PI / 2;
    // ---- 重「武器」錨 = CASEVAC 絞車 + 著陸探照燈莢 ----
    const win = new THREE.Group();
    win.position.set(0, -0.72, 0.5);
    t.add(win);
    const drum = cylF(win, 0.09, 0.09, 0.24, 8, 0, 0, 0, COAL, { metalness: 0.85 });
    drum.rotation.z = Math.PI / 2;
    for (const sx of [-1, 1]) bxF(win, 0.025, 0.15, 0.025, sx * 0.09, -0.1, 0.05, IRON, { metalness: 0.75 });
    const fair = cylF(win, 0.02, 0.02, 0.16, 6, 0, -0.17, 0.05, PAL.deep, { metalness: 0.8 });
    fair.rotation.z = Math.PI / 2;
    cylF(win, 0.013, 0.013, 0.4 * K.barrelF, 5, 0, -0.36, 0.05, COAL, { metalness: 0.7 });   // 垂纜
    bxF(win, 0.03, 0.07, 0.03, 0, -0.58, 0.05, PAL.deep, { metalness: 0.7 });                // J 形吊鉤
    bxF(win, 0.03, 0.03, 0.08, 0, -0.61, 0.08, PAL.deep, { metalness: 0.7 });
    const lamp = cylF(win, 0.055, 0.065, 0.08, 8, -0.2, 0.02, 0.02, dark, { metalness: 0.7 });
    lamp.rotation.x = -1.05;
    const hMuz = sphF(win, 0.04, -0.2, -0.02, 0.06, 0xfff4d6, { emissive: 0xfff4d6, emissiveIntensity: 1.7 });
    return {
      muzzles: { light: { n: lMuz, r: 0.06 }, heavy: { n: hMuz, r: 0.09 } },
      lightGlowM: [lMuz], heavyGlowM: [hMuz],
      weap: { light: 'N', heavy: 'N' }, hvy: { chest: 0.03 },
      wpn: { light: { nodes: [drop], ref: drop, muz: lMuz, fwd: 'z' },
        heavy: { nodes: [win], ref: win, muz: hMuz, fwd: 'z' } },
    };
  },
};
