// ============ t11@flight 逐機零件檔(航空機體;dev-only)============
// t11「老兵」可變式戰術指導機 —— **飛行型**(tilt 傾轉旋翼母艦):翼端兩具旋翼艙轉成垂直
// 2D 定案圖:public/assets/cyberpunk_art/mechs/t11_flight_static.jpg(/ _moving / _heavy)
// 設計權威 = mecha.js gen.sil:「飛行型兩具旋翼艙在翼端轉成垂直。」
// gen.note:「掛架上 MUST 真的掛滿東西(帆布、水桶、備件):空著的掛架讓『扛人』這件事整個不見。」
//   ⇒ 飛行型照掛:肩掛補給架在飛行時變成**翼上掛載**,一樣掛滿(CARGO 逐件列出)。
// 車長指揮塔(地面型軀幹頂上那具老式塔)在飛行型轉到機背 —— 它是這台機的識別點,
// MUST NOT 因為「飛起來了」就拿掉。
import * as THREE from 'three';
import {
  bxF, cylF, sphF, tboxF, prismF, latheF, torusF, wingF, rotorF, gunPodF,
  IRON, GUNMETAL, COAL,
} from '../geo.js';
import t11 from './t11.js';

// 掛載清單(gen.note:掛架 MUST 真的掛滿)—— [寬,高,深, x, y, z, 顏色鍵]
const CARGO = [
  [0.3, 0.34, 0.26, -1.02, -0.2, 0.1, 'deep'],
  [0.22, 0.26, 0.34, -1.28, -0.18, -0.2, 'lite'],
  [0.26, 0.2, 0.24, 1.06, -0.22, -0.14, 'mid'],
  [0.34, 0.28, 0.22, 1.3, -0.18, 0.16, 'deep'],
];

export default {
  label: '老兵・飛行型(t11 傾轉旋翼母艦)', hue: 0x8a95da, kind: 'air', height: 4.6,
  air: { tiltY: 1.5, bob: 0.04, top: 22, span: 3.8 },
  moveSig: { hover: 0.30, hoverF: 0.7, hoverA: 0.10, surge: 0.55, flare: 0.20, bank: 0.60 },
  castSig: { omni: 'stomp', dir: 'jab' },
  doc: [
    ['厚重機身', '大體格機身(tbox)+ 腰際配重塊 ×2(明顯外凸)+ 腹部貨門'],
    ['車長指揮塔', '老式指揮塔(lathe)+ 環視窗 ×6 + 頂艙蓋 —— 飛行型轉到機背'],
    ['頭部', '直接取地面型 t11.head()(同一台機的同一顆頭)'],
    ['主翼 ×2', 'wingF 厚重平直翼 + 翼端旋翼艙座'],
    ['傾轉旋翼艙 ×2', '翼端艙(lathe)轉成垂直 + rotorF 四葉大槳 + 傾轉軸環'],
    [`翼上掛載 ×${CARGO.length}`, '帆布捲/水桶/備件箱(掛滿才是這台機)'],
    ['寬站腿(收起)', '飛行型雙腿貼機腹收折 + 起落墊'],
  ],

  body(c, t) {
    const { PAL, accent, dark } = c;
    const COL = { deep: PAL.deep, lite: PAL.lite, mid: PAL.mid };
    // 厚重機身(全機種最大的一批)
    tboxF(t, { w0: 0.86, d0: 0.6, w1: 0.7, d1: 0.46, h: 1.7, sz: 0.04 }, 0, 0, 0.05, PAL.main, { metalness: 0.62 })
      .rotation.x = -Math.PI / 2;
    // 腰際配重塊(明顯外凸;地面型的識別點,飛行型照留)
    for (const sx of [-1, 1])
      tboxF(t, { w0: 0.26, d0: 0.4, w1: 0.2, d1: 0.3, h: 0.34 }, sx * 0.5, -0.06, -0.4, dark, { metalness: 0.7 })
        .rotation.z = sx * 0.3;
    // 腹部貨門(對開)
    for (const sx of [-1, 1]) {
      const d = bxF(t, 0.34, 0.03, 0.9, sx * 0.19, -0.32, -0.1, PAL.mid, { metalness: 0.6 });
      d.rotation.z = sx * 0.3;
    }
    // 車長指揮塔(機背;環視窗 ×6 + 頂艙蓋)
    const cup = new THREE.Group();
    cup.position.set(0, 0.34, -0.2);
    t.add(cup);
    latheF(cup, [[0.3, 0], [0.32, 0.06], [0.3, 0.26], [0.24, 0.32]], 12, 0, 0, 0, PAL.mid, { metalness: 0.7 });
    for (let i = 0; i < 6; i++) {
      const th = i / 6 * Math.PI * 2;
      const w = bxF(cup, 0.14, 0.09, 0.04, Math.sin(th) * 0.3, 0.16, Math.cos(th) * 0.3, accent,
        { emissive: accent, emissiveIntensity: 0.9 });
      w.rotation.y = th;
    }
    cylF(cup, 0.22, 0.24, 0.05, 12, 0, 0.34, 0, PAL.deep, { metalness: 0.75 });
    torusF(cup, 0.26, 0.02, 0, 0.36, 0, COAL, { metalness: 0.85 }).rotation.x = Math.PI / 2;
    // 頭(同一顆:地面型 t11.head)
    const head = new THREE.Group();
    head.position.set(0, 0.1, 0.86);
    head.rotation.x = 0.8;
    t.add(head);
    t11.head(c, head);
    // 收折的寬站腿(貼機腹)+ 起落墊
    for (const sx of [-1, 1]) {
      const leg = new THREE.Group();
      leg.position.set(sx * 0.36, -0.3, -0.44);
      leg.rotation.x = -1.35;
      t.add(leg);
      tboxF(leg, { w0: 0.24, d0: 0.26, w1: 0.18, d1: 0.2, h: 0.62 }, 0, -0.31, 0, PAL.mid, { metalness: 0.66 });
      cylF(leg, 0.1, 0.1, 0.1, 8, 0, -0.64, 0, COAL, { metalness: 0.9 }).rotation.z = Math.PI / 2;
      tboxF(leg, { w0: 0.2, d0: 0.22, w1: 0.16, d1: 0.18, h: 0.5 }, 0, -0.92, 0.02, PAL.main, { metalness: 0.66 });
      cylF(leg, 0.16, 0.18, 0.07, 10, 0, -1.2, 0.02, dark, { metalness: 0.7 });
    }
    // 翼上掛載(掛滿;含帆布捲 = 圓柱,其餘方箱)
    for (const [w, h, d, x, y, z, k] of CARGO) bxF(t, w, h, d, x, y, z, COL[k], { metalness: 0.45 });
    for (const sx of [-1, 1])
      cylF(t, 0.1, 0.1, 0.42, 8, sx * 1.16, -0.14, -0.42, PAL.lite, { metalness: 0.35 }).rotation.z = Math.PI / 2;
    for (const sx of [-1, 1]) for (let i = 0; i < 2; i++)          // 綁帶
      bxF(t, 0.5, 0.04, 0.05, sx * 1.14, -0.02, -0.2 + i * 0.5, accent, { metalness: 0.3 });
  },

  lift(c, t) {
    const { PAL, K, dark } = c;
    const spin = [];
    // 厚重平直主翼 + 翼端傾轉旋翼艙(轉成垂直)
    for (const sx of [-1, 1]) {
      const w = wingF(t, { span: 1.6, c0: 0.86, c1: 0.62, t: 0.17, sweep: 0.06, dihedral: 0.06 },
        sx * 0.34, 0.02, -0.1, PAL.main, { metalness: 0.58 });
      w.scale.x = sx;
      // 傾轉軸環 + 旋翼艙(艙軸已轉成垂直 = 飛行型)
      const nac = new THREE.Group();
      nac.position.set(sx * 1.9, 0.02, -0.1);
      t.add(nac);
      torusF(nac, 0.2, 0.045, 0, 0, 0, COAL, { metalness: 0.88 }).rotation.y = Math.PI / 2;
      latheF(nac, [[0, -0.34], [0.19, -0.24], [0.21, 0.18], [0.13, 0.36], [0, 0.4]], 12, 0, 0.06, 0,
        dark, { metalness: 0.72 });
      const r = rotorF(nac, { r: 1.0 * K.barrelF, blades: 4, pitch: 0.16, thick: 0.036 },
        0, 0.48, 0, PAL.lite, { metalness: 0.5, transparent: true, opacity: 0.85 });
      spin.push(r.prop);
    }
    return { spin };
  },

  mount(c, F) {
    const { accent, K, dark } = c;
    const t = F.tilt;
    // 肩掛架的武裝那一半(飛行型轉到翼下);左輕右重
    const lp = gunPodF(t, { len: 1.0 * K.barrelF, r: 0.12, accent }, -0.62, -0.3, 0.5, dark, { metalness: 0.76 });
    const hp = gunPodF(t, { len: 1.3 * K.barrelF, r: 0.17, accent }, 0.62, -0.3, 0.44, dark, { metalness: 0.76 });
    return {
      muzzles: { light: { n: lp.muz, r: 0.06 }, heavy: { n: hp.muz, r: 0.11 } },
      lightGlowM: [lp.muz], heavyGlowM: [hp.muz],
      weap: { light: 'N', heavy: 'N' }, hvy: { chest: 0.04 },
      wpn: { light: { nodes: [lp.g], ref: lp.g, muz: lp.muz, fwd: 'z' },
        heavy: { nodes: [hp.g], ref: hp.g, muz: hp.muz, fwd: 'z' } },
    };
  },
};
