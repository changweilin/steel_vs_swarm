// ============ m05@flight 逐機零件檔(航空機體;dev-only)============
// m05「鎖喉」電戰可變機甲 —— **飛行型**(jet 噴射戰機):機身壓平 + 肩部進氣口 + 干擾吊艙
// 2D 定案圖:public/assets/cyberpunk_art/mechs/m05_flight_static.jpg(/ _moving / _heavy)
// 設計權威 = mecha.js gen.sil:「飛行型機身壓平、肩部進氣口張開,翼下掛著粗短的干擾吊艙。」
// gen.parts 逐件:趾行後肢 ×2(飛行時後伸當推進艙)/ 前傾軀幹 / 頸背鬃刺天線 / 干擾吊艙 ×2 /
//   肩部進氣口 / 爪手 ×2。
// 頸背鬃刺**天線**在飛行型照留(它是電戰機的天線陣,不是裝飾毛):MUST NOT 因為壓平就收掉。
// 頭部取地面型 m05.head() —— 同一台機的同一顆頭。
// jet 機種 ⇒ moveSig.flare = 0(定翼式攻角管理,不揚頭煞停)且掛 rig.jets(速度驅動尾焰)。
import * as THREE from 'three';
import {
  bxF, cylF, sphF, tboxF, prismF, latheF, finF, wingF, jetF, gunPodF,
  IRON, GUNMETAL, COAL,
} from '../geo.js';
import m05 from './m05.js';

export default {
  label: '鎖喉・飛行型(m05 噴射戰機)', hue: 0x5555cc, kind: 'air', height: 4.2,
  air: { tiltY: 1.45, bob: 0.03, top: 38, level: true, span: 3.2 },
  moveSig: { hover: 0.24, hoverF: 0.9, hoverA: 0.05, surge: 0.95, flare: 0, bank: 0.72 },
  castSig: { omni: 'roar', dir: 'swing' },
  doc: [
    ['壓平軀幹', '前傾軀幹壓成航向軸(tbox)+ 胸脊 + 腹側稜'],
    ['頭部', '直接取地面型 m05.head()(狼首;同一顆)'],
    ['肩部進氣口 ×2', '張開的方形進氣口(prism 唇口)+ 內壁隔板 + 附面層分離板'],
    ['頸背鬃刺天線', '鬃刺列 ×7(finF,逐根變短)—— 電戰天線陣,不是裝飾毛'],
    ['後肢推進艙 ×2', '趾行長蹠骨後伸成推進艙 + 噴口 + 尾焰(jetF)'],
    ['翼面 ×2', 'wingF 中後掠翼(壓平後的手臂/披掛面)'],
    ['干擾吊艙 ×2', '粗短吊艙(lathe)+ 螺旋天線 + 散熱鰭'],
  ],

  body(c, t) {
    const { PAL, accent, dark } = c;
    tboxF(t, { w0: 0.56, d0: 0.42, w1: 0.44, d1: 0.32, h: 1.5, sz: 0.05 }, 0, 0, 0.12, PAL.main, { metalness: 0.62 })
      .rotation.x = -Math.PI / 2;
    prismF(t, [[-0.24, -0.16], [0.24, -0.16], [0.18, 0.16], [-0.18, 0.16]], 0.6, 0, 0.12, 0.4,
      PAL.mid, { metalness: 0.66 });                              // 胸脊
    for (const sx of [-1, 1])
      prismF(t, [[-0.7, 0], [0.7, 0], [0.6, 0.09], [-0.62, 0.08]], 0.05, sx * 0.28, -0.16, 0.05,
        PAL.deep, { metalness: 0.7 }).rotation.y = Math.PI / 2;    // 腹側稜
    // 頭(同一顆:地面型 m05.head)
    const head = new THREE.Group();
    head.position.set(0, 0.1, 0.84);
    head.rotation.x = 0.85;
    t.add(head);
    m05.head(c, head);
    // 肩部進氣口 ×2(張開;唇口 + 內壁隔板 + 附面層分離板)
    for (const sx of [-1, 1]) {
      const lip = prismF(t, [[-0.16, -0.14], [0.16, -0.14], [0.13, 0.14], [-0.13, 0.14]], 0.34,
        sx * 0.42, 0.06, 0.42, dark, { metalness: 0.75 });
      lip.rotation.y = -sx * 0.16;
      bxF(t, 0.02, 0.24, 0.3, sx * 0.42, 0.06, 0.42, COAL, { metalness: 0.85 });
      bxF(t, 0.03, 0.2, 0.26, sx * 0.28, 0.06, 0.5, PAL.deep, { metalness: 0.8 });   // 附面層分離板
    }
    // 頸背鬃刺天線 ×7(逐根變短)
    for (let i = 0; i < 7; i++)
      finF(t, { len: 0.4 - i * 0.04, w0: 0.07, w1: 0.02, t: 0.028, sweep: -0.12 },
        0, 0.24, 0.34 - i * 0.16, PAL.lite, { metalness: 0.75 }).rotation.x = -0.3;
    // 干擾吊艙 ×2(粗短 + 螺旋天線 + 散熱鰭)
    for (const sx of [-1, 1]) {
      latheF(t, [[0, -0.42], [0.16, -0.32], [0.19, 0.1], [0.14, 0.34], [0, 0.4]], 10,
        sx * 0.94, -0.34, -0.1, PAL.mid, { metalness: 0.65 }).rotation.x = Math.PI / 2;
      for (let i = 0; i < 6; i++)                                  // 螺旋天線
        cylF(t, 0.015, 0.015, 0.1, 5, sx * 0.94 + Math.cos(i) * 0.13, -0.34 + Math.sin(i) * 0.13, 0.34 + i * 0.05,
          accent, { emissive: accent, emissiveIntensity: 0.9 });
      for (let i = 0; i < 3; i++)
        bxF(t, 0.06, 0.014, 0.2, sx * 1.08, -0.28 + i * 0.06, -0.14, PAL.deep, { metalness: 0.75 });
    }
  },

  lift(c, t) {
    const { PAL, accent, dark } = c;
    // 翼面 ×2(壓平後的手臂/披掛面 → 中後掠翼)
    for (const sx of [-1, 1]) {
      const w = wingF(t, { span: 1.4, c0: 0.8, c1: 0.4, t: 0.12, sweep: 0.5, dihedral: 0.06, twist: -0.05 },
        sx * 0.26, -0.06, -0.12, PAL.main, { metalness: 0.58 });
      w.scale.x = sx;
    }
    // 後肢推進艙 ×2(趾行長蹠骨後伸)+ 噴口 + 尾焰
    const jets = [];
    for (const sx of [-1, 1]) {
      tboxF(t, { w0: 0.26, d0: 0.3, w1: 0.2, d1: 0.24, h: 1.0 }, sx * 0.24, -0.14, -0.86, PAL.mid, { metalness: 0.66 })
        .rotation.x = -Math.PI / 2;
      latheF(t, [[0.17, 0], [0.19, 0.1], [0.13, 0.28], [0.15, 0.34]], 10, sx * 0.24, -0.14, -1.36, COAL, { metalness: 0.85 })
        .rotation.x = Math.PI / 2;
      const ring = cylF(t, 0.11, 0.11, 0.04, 10, sx * 0.24, -0.14, -1.54, accent,
        { emissive: accent, emissiveIntensity: 1.6 });
      ring.rotation.x = Math.PI / 2;
      const fl = jetF(t, 0.1, 1.3, sx * 0.24, -0.14, -1.6, accent);
      fl.g.rotation.x = Math.PI / 2;
      jets.push(fl);
    }
    return { jets };
  },

  mount(c, F) {
    const { accent, PAL, K, dark } = c;
    const t = F.tilt;
    // 爪手 ×2 前伸(飛行型仍是爪,不是掛架)+ 爪握的莢
    const pods = [];
    for (const sx of [-1, 1]) {
      const claw = new THREE.Group();
      claw.position.set(sx * 0.44, -0.16, 0.5);
      claw.rotation.x = 1.35;
      t.add(claw);
      cylF(claw, 0.09, 0.1, 0.16, 8, 0, -0.08, 0, PAL.deep, { metalness: 0.78 });
      for (let i = 0; i < 3; i++) {
        const th = -0.4 + i * 0.4;
        const f = cylF(claw, 0.018, 0.026, 0.2, 5, Math.sin(th) * 0.07, -0.22, Math.cos(th) * 0.07,
          GUNMETAL, { metalness: 0.88 });
        f.rotation.x = 0.45;
      }
      pods.push(gunPodF(claw, { len: (sx < 0 ? 0.9 : 1.16) * K.barrelF, r: sx < 0 ? 0.1 : 0.14, accent },
        0, -0.3, 0.1, dark, { metalness: 0.8 }));
    }
    const [lp, hp] = pods;
    return {
      muzzles: { light: { n: lp.muz, r: 0.05 }, heavy: { n: hp.muz, r: 0.09 } },
      lightGlowM: [lp.muz], heavyGlowM: [hp.muz],
      weap: { light: 'N', heavy: 'N' }, hvy: { chest: 0.05 },
      wpn: { light: { nodes: [lp.g], ref: lp.g, muz: lp.muz, fwd: 'z' },
        heavy: { nodes: [hp.g], ref: hp.g, muz: hp.muz, fwd: 'z' } },
    };
  },
};
