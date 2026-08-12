// ============ t06@flight 逐機零件檔(航空機體;dev-only)============
// t06「輕功」齊天式可變機甲 —— **飛行型**(uav 觔斗雲):壓平人形 + 兩束光翼 + 長尾前捲過頂
// 2D 定案圖:public/assets/cyberpunk_art/mechs/t06_flight_static.jpg(/ _moving / _heavy)
// 設計權威 = mecha.js gen.sil:「飛行型身體壓平、雙腿併攏,背後兩束光翼不揮動,多節長尾
// 前捲過頂。」gen.note:「光翼 MUST NOT 畫成會揮動的翅膀,它是兩束固定的噴焰;飛行型也
// MUST NOT 變成飛機外形 —— 身體壓平就是它的飛行姿態。」
//   ⇒ 本檔因此**不回傳 rig.wings**(那會讓 stepAerial 拍它);光翼是 jets 家族的發光刃,
//     靠 accentF 與速度增輝表達,不進撲翼通道。
// 頭部**直接呼叫地面型那一顆**(`t06.head`)—— 同一台機的兩個型態,頭 MUST 是同一顆:
// 各畫一顆的下場是兩頁看起來像兩台機,而兩邊都不會報錯。
import * as THREE from 'three';
import {
  bxF, cylF, sphF, tboxF, prismF, latheF, finF, chainF, jetF, gunPodF,
  IRON, GUNMETAL, COAL, BRASS,
} from '../geo.js';
import t06 from './t06.js';

export default {
  label: '輕功・飛行型(t06 觔斗雲)', hue: 0xffd84d, kind: 'air', height: 4.2,
  air: { tiltY: 1.5, bob: 0.05, top: 30, span: 2.4 },
  moveSig: { hover: 0.30, hoverF: 0.7, hoverA: 0.15, surge: 0.70, flare: 0.85, bank: 0.62 },
  castSig: { omni: 'dance', dir: 'swing' },
  doc: [
    ['壓平軀幹', '輕量骨架軀幹(tbox)壓成水平航向軸 + 胸甲 + 腰環'],
    ['頭部', '直接取地面型 t06.head() —— 同一台機的同一顆頭(金箍在內)'],
    ['併攏雙腿', '兩腿貼合成單一推進體(tbox ×2)+ 足底噴口 ×2'],
    ['長臂 ×2', '沿航向前伸的長臂(掌行機的長臂;飛行時當前緣配平)'],
    ['光翼 ×2', '背後兩束固定噴焰刃(finF 發光片 ×3/束)—— 不揮動,不進 rig.wings'],
    ['多節長尾 + 熔核砲', 'chainF 七節前捲過頂 + 尾端砲口(全機最重的一點)'],
    ['如意棒', '背插長棍(lathe 收分 + 兩端金箍環)'],
  ],

  body(c, t) {
    const { PAL, accent, dark } = c;
    // 壓平軀幹:航向軸 = +z;胸腔在前、骨盆在後(人形被壓成水平)
    tboxF(t, { w0: 0.62, d0: 0.44, w1: 0.5, d1: 0.34, h: 1.1, sz: 0.04 }, 0, 0, 0.1, PAL.main, { metalness: 0.6 })
      .rotation.x = -Math.PI / 2;
    prismF(t, [[-0.3, -0.2], [0.3, -0.2], [0.24, 0.18], [-0.24, 0.18]], 0.5, 0, 0.12, 0.44,
      PAL.mid, { metalness: 0.65 });                                       // 胸甲
    cylF(t, 0.26, 0.28, 0.14, 10, 0, -0.02, -0.36, PAL.deep, { metalness: 0.7 }).rotation.x = Math.PI / 2;  // 腰環
    // 頭(同一顆:地面型 t06.head)
    const head = new THREE.Group();
    head.position.set(0, 0.12, 0.78);
    head.rotation.x = 0.9;                     // 壓平飛行 ⇒ 頭抬起看航向
    t.add(head);
    t06.head(c, head);
    // 併攏雙腿(貼合成單一推進體)+ 足底噴口
    for (const sx of [-1, 1]) {
      tboxF(t, { w0: 0.2, d0: 0.26, w1: 0.15, d1: 0.2, h: 0.9 }, sx * 0.11, -0.06, -0.86, PAL.mid, { metalness: 0.65 })
        .rotation.x = -Math.PI / 2;
      cylF(t, 0.1, 0.12, 0.16, 8, sx * 0.11, -0.06, -1.32, COAL, { metalness: 0.85 }).rotation.x = Math.PI / 2;
    }
    // 長臂 ×2(沿航向前伸;掌行機的長臂在飛行時當前緣配平)
    for (const sx of [-1, 1]) {
      const arm = new THREE.Group();
      arm.position.set(sx * 0.34, 0.04, 0.4);
      arm.rotation.x = 1.35;
      arm.rotation.z = -sx * 0.16;
      t.add(arm);
      tboxF(arm, { w0: 0.17, d0: 0.17, w1: 0.13, d1: 0.13, h: 0.56 }, 0, -0.28, 0, PAL.mid, { metalness: 0.68 });
      cylF(arm, 0.09, 0.09, 0.1, 8, 0, -0.58, 0, COAL, { metalness: 0.88 }).rotation.z = Math.PI / 2;
      tboxF(arm, { w0: 0.14, d0: 0.14, w1: 0.11, d1: 0.11, h: 0.5 }, 0, -0.86, 0.02, PAL.main, { metalness: 0.68 });
      bxF(arm, 0.15, 0.1, 0.2, 0, -1.16, 0.06, PAL.deep, { metalness: 0.6 });          // 掌
    }
    // 如意棒(背插;收分長棍 + 兩端金箍環)
    const staff = new THREE.Group();
    staff.position.set(0, 0.24, -0.1);
    staff.rotation.z = 0.5;
    t.add(staff);
    const st = latheF(staff, [[0.05, -0.9], [0.062, -0.6], [0.062, 0.6], [0.05, 0.9]], 8, 0, 0, 0,
      dark, { metalness: 0.85 });
    for (const y of [-0.76, 0.76]) cylF(staff, 0.078, 0.078, 0.1, 10, 0, y, 0, BRASS, { metalness: 0.9 });
  },

  lift(c, t) {
    const { accent, PAL, K } = c;
    // ---- 光翼 ×2:兩束**固定**噴焰刃(不揮動 ⇒ 不進 rig.wings)----
    for (const sx of [-1, 1]) {
      const root = cylF(t, 0.07, 0.09, 0.2, 8, sx * 0.26, 0.16, -0.02, GUNMETAL, { metalness: 0.9 });
      root.rotation.z = -sx * 0.5;
      for (let i = 0; i < 3; i++) {
        const blade = finF(t, { len: 1.5 - i * 0.28, w0: 0.16, w1: 0.03, t: 0.035, sweep: -0.5 },
          sx * (0.34 + i * 0.06), 0.22, -0.1 - i * 0.16, accent,
          { emissive: accent, emissiveIntensity: 2.4 * K.accentF, transparent: true, opacity: 0.62 });
        blade.rotation.z = -sx * (0.72 + i * 0.12);
        blade.rotation.x = -0.28;
        blade.userData.noOutline = true;      // 焰刃沒有輪廓線(它不是實體)
      }
    }
    // 足底主推(jets:速度驅動焰長,同噴射機種)
    const jets = [];
    for (const sx of [-1, 1]) {
      const fl = jetF(t, 0.1, 1.1, sx * 0.11, -0.06, -1.42, accent);
      fl.g.rotation.x = Math.PI / 2;
      jets.push(fl);
    }
    return { jets };
  },

  tail(c, t) {
    const { PAL, accent } = c;
    // 多節長尾前捲過頂(蠍式):基礎彎曲寫進**節位置編碼**,不靠 chainF 靜姿角
    // (geo.js chainF 檔頭:rot0/rotD 掛進 rig.tailSegs 後會被 whipTail 每幀覆寫)
    const base = new THREE.Group();
    base.position.set(0, 0.2, -0.5);
    base.rotation.x = -1.5;                    // 靜態中介 Group:整條尾先立起來
    t.add(base);
    const ch = chainF(base, {
      n: 7, len0: 0.34, len1: 0.2, r0: 0.14, r1: 0.08, rot0: 0, rotD: 0, seg: 8,
      drawSeg: (gp, i, { r }) => {
        finF(gp, { len: r * 1.4, w0: r * 0.8, w1: r * 0.25, t: 0.025 }, 0, r * 0.6, -0.05,
          PAL.lite, { metalness: 0.7 }).rotation.x = -0.2;
        if (i === 6) {                          // 尾端熔核砲(全機最重的一點)
          latheF(gp, [[0.16, 0], [0.2, 0.12], [0.13, 0.3], [0.16, 0.36]], 10, 0, 0, -0.22,
            COAL, { metalness: 0.9 }).rotation.x = -Math.PI / 2;
          cylF(gp, 0.1, 0.1, 0.03, 10, 0, 0, -0.4, accent, { emissive: accent, emissiveIntensity: 2.0 })
            .rotation.x = Math.PI / 2;
        }
      },
    }, PAL.main, { metalness: 0.66 });
    return ch.segs;
  },

  mount(c, F) {
    const { accent, K, dark } = c;
    const t = F.tilt;
    // 輕武器:前臂下掛短莢(掌行機的手仍要能出拳 ⇒ 掛小的)
    const lp = gunPodF(t, { len: 0.62 * K.barrelF, r: 0.085, accent }, -0.34, -0.24, 0.72, dark, { metalness: 0.8 });
    // 重武器 = 尾端熔核砲(尾鏈末節;槍口另立以免被 whipTail 帶走取景)
    const segs = F.tailSegs || [];
    const tip = segs[segs.length - 1] || t;
    const hMuz = cylF(tip, 0.11, 0.11, 0.03, 10, 0, 0, -0.44, accent,
      { emissive: accent, emissiveIntensity: 2.2 });
    hMuz.rotation.x = Math.PI / 2;
    return {
      muzzles: { light: { n: lp.muz, r: 0.05 }, heavy: { n: hMuz, r: 0.11 } },
      lightGlowM: [lp.muz], heavyGlowM: [hMuz],
      weap: { light: 'N', heavy: 'N' }, hvy: { chest: 0.05 },
      wpn: { light: { nodes: [lp.g], ref: lp.g, muz: lp.muz, fwd: 'z' },
        heavy: { nodes: [tip], ref: tip, muz: hMuz, fwd: '-z' } },
    };
  },
};
