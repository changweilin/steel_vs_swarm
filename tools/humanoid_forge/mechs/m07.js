// ============ m07 逐機零件檔(dev-only;仿生四足 D.kind 'quad')============
// ── m07「落閘」區域拒止可變機甲(beetle 犀金龜・**陣地態 = 地面型**)──
// 2D 定案圖:public/assets/cyberpunk_art/mechs/m07_ground_static.jpg / m07_flight_static.jpg
// 幾何語彙一律取自 ../geo.js;MUST NOT 在本檔自建 BufferGeometry。
//
// 2026-08-13 使用者定案:「犀角金龜:**頭頂的角大一點,翅膀大一點,地面模式收起翅膀**。」
//   ⇒ 犀角 finF 由 len 1.0 → 1.6、鞘翅由 1.86m → 2.5m、膜翅翼展由 1.5m → 2.6m;
//     地面型鞘翅**闔上**貼背、膜翅收摺藏在鞘翅之下(兩態同一組零件,只差 pivot 的旋轉)。
//   ⇒ 這一格原本**沒有建模**(m07@ground 缺檔,名冊上是空的):兩張 2D 定案圖是同一具軀體,
//     差別只有鞘翅開闔 —— 因此地面型是主體,飛行型(m07_flight)整台由本檔的建構器組出來。
//
// gen.note:「鞘翅是**裝甲**、膜翅才是**動力**」⇒ 只有膜翅進 rig.wings(飛行型),
// 鞘翅兩態都是靜態殼。六足:四足鷹架驅動前後兩對,中間那一對是 body() 裡的靜態件。
import * as THREE from 'three';
import {
  dimF, bxF, cylF, sphF, coneF, torusF, tboxF, prismF, latheF, finF, cablesF,
  IRON, GUNMETAL, COAL, INK, BRASS,
} from '../geo.js';

const TAN = 0xb08a5c;         // 2D 圖的關節/足部土黃機構色

export default {
  label: '落閘(m07 變形者・陣地態)', hue: 0x5fa8d3, kind: 'quad', height: 5.0,
  frame: {
    hipY: 2.05, legX: 1.0, fz: 1.0, hz: -1.0,
    chest: [0, 0.16, 0.9], neck: [0, -0.06, 0.78], head: [0, -0.22, 0.46],
    tailY: -0.1, tailZ: -1.5, tail2Z: 0.5,
  },
  gait: { gait: 'walk', stride: 2.3, top: 6, bob: 0.06, rollSway: 0.05, legAmp: 0.9 },
  moveSig: { poise: 0.30, idleF: 0.55, idleA: 0.9, launch: 0.10, spool: 0.9, brake: 0.12, settle: 1.9 },
  castSig: { omni: 'stomp', dir: 'jab' },
  doc: [
    ['甲殼軀幹', '厚重甲殼(latheF 大旋成)+ 前胸背板 pronotum(prismF)+ 腹節環 ×4 + 腹側氣門'],
    ['犀角(加大)', '上挑主角(finF 厚刃 len 1.6)+ 側叉 ×2 + 角根鎧環 + 複眼 ×2'],
    ['鞘翅 ×2(加大)', '盾狀裝甲殼(prismF 厚片 2.5m)+ 翅脈稜 ×3 + 鉸鏈鼓;**地面態闔上貼背**'],
    ['膜翅 ×2(加大)', '翼展 2.6m 的半透明膜(prismF)+ 翅脈 ×3;地面態摺收藏在鞘翅之下'],
    ['六足', '前後兩對進步態鏈(股節楔台 + 脛節 + 跗節爪);中間一對是靜態定樁足'],
    ['背部防空砲塔', '甲殼中央砲塔(latheF 座 + 雙管 + 俯仰搖架)+ 頭下短莢(輕武器)'],
  ],

  // ---- 兩態共用的具名零件(飛行型 m07_flight 直接呼叫這幾支)-------------------
  /** 犀角(2026-08-13 加大):上挑主角 + 側叉 ×2 + 角根鎧環 */
  horn(c, h) {
    const { PAL, accent } = c;
    const horn = finF(h, { len: 1.6, w0: 0.30, w1: 0.06, t: 0.16, sweep: 0.42, camber: 0.10 },
      0, 0.30, 0.42, BRASS, { metalness: 0.85 });
    horn.rotation.x = -0.66;
    for (const sx of [-1, 1]) {
      const f = finF(h, { len: 0.62, w0: 0.15, w1: 0.035, t: 0.08, sweep: 0.18 }, sx * 0.22, 0.38, 0.48,
        BRASS, { metalness: 0.85 });
      f.rotation.x = -0.74;
      f.rotation.z = -sx * 0.62;
    }
    cylF(h, 0.26, 0.31, 0.14, 12, 0, 0.26, 0.40, COAL, { metalness: 0.85 }).rotation.x = Math.PI / 2 - 0.5;
    for (const sx of [-1, 1]) {                       // 複眼
      const e = sphF(h, 0.11, sx * 0.34, 0.12, 0.30, accent, { emissive: accent, emissiveIntensity: 1.6 });
      e.scale.set(1, 0.8, 0.9);
    }
    // 大顎(prismF 鉗形;2D 頭前下方那對機構)
    for (const sx of [-1, 1]) {
      const j = prismF(h, [[0, 0.06], [0.42, -0.02], [0.30, -0.16], [0, -0.10]].map(([x, y]) => [sx * x, y]),
        0.09, sx * 0.16, -0.12, 0.34, PAL.deep, { metalness: 0.7 });
      j.rotation.y = -sx * Math.PI / 2;
      j.rotation.z = sx * 0.2;
    }
  },

  /**
   * 鞘翅一片(**兩態同一顆零件**:地面闔上貼背 = 裝甲、飛行掀起 = 靜態掀蓋)。
   * 幾何以「躺平在背上」定義:prismF 的多邊形在局部 XY、沿局部 z 擠出 ⇒ 板面法線 = 局部 z,
   * 長軸 = 局部 y。內層網格先 Rx(−π/2) 躺平(局部 +y → 世界 −z 機尾、+z → 世界 +y),
   * **掀起角掛在回傳的 pivot 上** —— 兩個角寫在同一顆網格上會被尤拉序 'XYZ' 互相轉走。
   */
  elytron(c, parent, sx, x, y, z) {
    const { PAL } = c;
    const eg = new THREE.Group();
    eg.position.set(x, y, z);
    parent.add(eg);
    // 外廓(局部 XY):長軸 2.5m 在 y、最寬 0.98m 在 x —— 2026-08-13 使用者「翅膀大一點」
    const ELY = [[0, -1.22], [0.66, -1.06], [0.98, -0.12], [0.82, 0.92], [0.28, 1.30], [0, 1.22]];
    prismF(eg, ELY.map(([px, py]) => [sx * px, py]), 0.13, 0, 0, 0, PAL.mid, { metalness: 0.66 })
      .rotation.x = -Math.PI / 2;
    for (let i = 0; i < 3; i++)                        // 翅脈稜(與殼板同框:長邊沿 eg 的 z = 殼長軸)
      bxF(eg, 0.035, 0.024, 1.9, sx * (0.20 + i * 0.24), 0.074, -0.06, PAL.deep, { metalness: 0.7 });
    latheF(eg, [[0.06, -0.07], [0.17, -0.04], [0.17, 0.07], [0.07, 0.11]], 8, sx * 0.06, 0.02, 0.92, COAL, { metalness: 0.85 });  // 鉸鏈鼓
    return eg;
  },

  /**
   * 膜翅一片(唯一的動力面;飛行型把回傳的 { w, outer } 掛進 rig.wings)。
   * 內/外兩段樞軸 = stepAerial 昆蟲震翅分支要的兩層(w 拍、outer 相位延遲)。
   */
  memWing(c, parent, sx, x, y, z) {
    const { PAL } = c;
    const w = new THREE.Group();
    w.position.set(x, y, z);
    parent.add(w);
    cylF(w, 0.05, 0.062, 0.44, 8, sx * 0.22, 0, 0, PAL.deep, { metalness: 0.8 }).rotation.z = Math.PI / 2;
    const outer = new THREE.Group();
    outer.position.set(sx * 0.44, 0, 0);
    w.add(outer);
    // 翼展 2.6m(2026-08-13 加大);膜面躺平 ⇒ 拍動時看得到面。
    // ⚠ 左右鏡射 MUST 用**多邊形頂點 x 反號**,MUST NOT 用 `scale.x = -1` —— 負縮放翻繞向,
    // 單面材質那一片從此只有背面看得見(俯視只剩三根翅脈,而斷言與網格數都正常)。
    const mem = prismF(outer, [[0, 0], [2.6, -0.52], [2.46, 0.6], [0.1, 0.42]].map(([px, py]) => [sx * px, py]),
      0.012, sx * 0.06, 0, 0, PAL.lite, { metalness: 0.15, transparent: true, opacity: 0.68 });
    mem.rotation.x = -Math.PI / 2;
    mem.userData.noOutline = true;                    // 半透明薄膜:反轉外殼會糊成黑片(A16)
    for (let i = 0; i < 4; i++)                       // 翅脈(膜翅的骨;一根一件)
      cylF(outer, 0.016, 0.022, 2.35, 5, sx * 1.26, 0, 0.34 - i * 0.26, PAL.deep, { metalness: 0.7 })
        .rotation.z = Math.PI / 2;
    return { w, outer, sgn: sx };
  },

  /** 一條足(六足共用;front 決定關節折向與跗節角度)。回傳 segLimbF 規格陣列。 */
  _leg(c, front) {
    const { PAL, sx } = c;
    return [
      { len: 0.86, draw: (l) => {
        tboxF(l, { w0: 0.34, d0: 0.42, w1: 0.24, d1: 0.3, h: 0.92 }, 0, -0.4, front ? 0.04 : -0.04, PAL.main, { metalness: 0.6 });
        const hub = latheF(l, [[0.04, -0.07], [0.19, -0.055], [0.22, 0], [0.19, 0.055], [0.04, 0.07]], 12, sx * 0.22, -0.04, 0, PAL.deep, { metalness: 0.85 });
        hub.rotation.z = Math.PI / 2;
        cylF(l, 0.075, 0.075, 0.03, 10, sx * 0.3, -0.04, 0, TAN, { metalness: 0.8 }).rotation.z = Math.PI / 2;
      } },
      { len: 0.82, base: front ? 0.42 : -0.42, k: front ? 0.5 : -0.5, d: 0.15, draw: (l) => {
        tboxF(l, { w0: 0.2, d0: 0.26, w1: 0.15, d1: 0.19, h: 0.88 }, 0, -0.42, 0, PAL.mid, { metalness: 0.6 });
        bxF(l, 0.1, 0.34, 0.06, sx * 0.11, -0.5, 0, TAN, { metalness: 0.55 });      // 脛節外側護片
      } },
      { len: 0, base: front ? -0.5 : 0.5, k: 0.3, d: 0.5, draw: (l) => {
        tboxF(l, { w0: 0.2, d0: 0.4, w1: 0.16, d1: 0.28, h: 0.16 }, 0, -0.08, 0.1, TAN, { metalness: 0.55 });  // 跗節
        for (const ox of [-0.07, 0.07]) {
          const cl = coneF(l, 0.045, 0.28, 6, ox, -0.12, 0.26, GUNMETAL, { metalness: 0.85 });
          cl.rotation.x = 1.9;                                                      // 前伸扣地爪
        }
      } },
    ];
  },
  legF(c) { return this._leg(c, true); },
  legH(c) { return this._leg(c, false); },

  /** 背部防空砲塔(兩態同一具;回傳 mount 契約要的節點) */
  turret(c, parent, x, y, z) {
    const { PAL, accent, K } = c;
    const tur = new THREE.Group();
    tur.position.set(x, y, z);
    parent.add(tur);
    latheF(tur, [[0.34, 0], [0.36, 0.1], [0.28, 0.28], [0.18, 0.35]], 12, 0, 0, 0, PAL.deep, { metalness: 0.75 });
    torusF(tur, 0.37, 0.04, 0, 0.02, 0, COAL, { metalness: 0.85 }).rotation.x = Math.PI / 2;
    const cradle = new THREE.Group();
    cradle.position.set(0, 0.32, 0);
    cradle.rotation.x = -0.42;
    tur.add(cradle);
    tboxF(cradle, { w0: 0.36, d0: 0.3, w1: 0.28, d1: 0.24, h: 0.34 }, 0, 0, -0.1, PAL.mid, { metalness: 0.7 })
      .rotation.x = Math.PI / 2;
    const muz = [];
    for (const sx of [-1, 1]) {
      cylF(cradle, 0.06, 0.066, 1.15 * K.barrelF, 8, sx * 0.11, 0, 0.58 * K.barrelF, GUNMETAL, { metalness: 0.88 })
        .rotation.x = Math.PI / 2;
      const mz = cylF(cradle, 0.055, 0.055, 0.035, 8, sx * 0.11, 0, 1.17 * K.barrelF, accent,
        { emissive: accent, emissiveIntensity: 1.6 });
      mz.rotation.x = Math.PI / 2;
      muz.push(mz);
    }
    return { tur, cradle, muz };
  },

  // ---- 四足鷹架契約 ----------------------------------------------------------
  body(c, spine, chest) {
    const { PAL, accent, dark } = c;
    // 甲殼腹部(掛 spine)：大旋成體 + 腹節環 + 腹側氣門
    latheF(spine, [[0, -1.5], [0.5, -1.28], [0.86, -0.5], [0.92, 0.2], [0.72, 0.86], [0.34, 1.16], [0, 1.24]], 14,
      0, 0.05, -0.5, PAL.main, { metalness: 0.6 }).rotation.x = Math.PI / 2;
    for (let i = 0; i < 4; i++)
      cylF(spine, 0.78 - i * 0.11, 0.78 - i * 0.11, 0.06, 14, 0, 0.03, -0.9 - i * 0.2, PAL.deep, { metalness: 0.65 })
        .rotation.x = Math.PI / 2;
    for (const sx of [-1, 1]) for (let i = 0; i < 3; i++)
      bxF(spine, 0.05, 0.09, 0.09, sx * 0.8, -0.12, -0.7 - i * 0.28, INK, { metalness: 0.5 });   // 腹側氣門
    // 前胸背板 pronotum(掛 chest)
    prismF(chest, [[-0.62, -0.14], [-0.42, 0.26], [0.42, 0.26], [0.62, -0.14], [0.38, -0.34], [-0.38, -0.34]], 0.42,
      0, 0.16, 0.06, PAL.mid, { metalness: 0.68 }).rotation.x = -Math.PI / 2 + 0.22;
    bxF(chest, 1.0, 0.05, 0.34, 0, 0.42, 0.02, dimF(accent, 0.8), { emissive: accent, emissiveIntensity: 0.5 });
    // 中間那一對足(六足的第三對;靜態定樁 —— 四足鷹架只驅動前後兩對)
    for (const sx of [-1, 1]) {
      const leg = new THREE.Group();
      leg.position.set(sx * 0.92, -0.15, 0.05);
      leg.rotation.set(0.1, 0, sx * 0.62);
      spine.add(leg);
      tboxF(leg, { w0: 0.3, d0: 0.36, w1: 0.2, d1: 0.26, h: 0.86 }, 0, -0.4, 0, PAL.main, { metalness: 0.6 });
      const knee = new THREE.Group();
      knee.position.set(0, -0.84, 0);
      knee.rotation.set(-0.1, 0, -sx * 1.0);
      leg.add(knee);
      tboxF(knee, { w0: 0.18, d0: 0.24, w1: 0.14, d1: 0.18, h: 0.9 }, 0, -0.44, 0, PAL.mid, { metalness: 0.6 });
      tboxF(knee, { w0: 0.18, d0: 0.36, w1: 0.14, d1: 0.26, h: 0.15 }, 0, -0.94, 0.1, TAN, { metalness: 0.55 });
      for (const ox of [-0.06, 0.06])
        coneF(knee, 0.04, 0.24, 6, ox, -1.0, 0.24, GUNMETAL, { metalness: 0.85 }).rotation.x = 1.9;
    }
    // 鞘翅(**地面態:闔上貼背**)+ 其下摺收的膜翅 —— 兩態同一組零件,只差 pivot 旋轉
    c.elytra = []; c.memWings = [];
    for (const sx of [-1, 1]) {
      const eg = this.elytron(c, spine, sx, sx * 0.30, 0.72, -0.42);
      eg.rotation.set(-0.06, 0, sx * 0.12);            // 闔上:僅微微外傾貼在背上
      c.elytra.push(eg);
      const mw = this.memWing(c, spine, sx, sx * 0.24, 0.52, -0.5);
      mw.w.rotation.set(0, sx * 1.45, sx * 0.16);      // 收摺:繞垂直軸摺向機尾,藏在鞘翅之下
      mw.outer.rotation.z = -sx * 0.55;                // 外段再對折一次(甲蟲收翅是兩折)
      c.memWings.push(mw);
    }
  },
  neckHead(c, neck, head) {
    const { PAL } = c;
    latheF(neck, [[0.34, -0.1], [0.4, 0], [0.36, 0.16], [0.3, 0.24]], 12, 0, 0, 0, PAL.deep, { metalness: 0.7 });
    tboxF(head, { w0: 0.72, d0: 0.62, w1: 0.56, d1: 0.5, h: 0.46, sz: 0.06 }, 0, 0.06, 0.06, PAL.main, { metalness: 0.65 });
    this.horn(c, head);
  },
  tail(c, tail) {
    const { PAL } = c;
    // 甲蟲沒有尾:這裡只放腹端的排氣叢(rig.tailSegs 仍取預設 [tail, tail2],擺動幅度極小)
    for (const sx of [-1, 1])
      cylF(tail, 0.09, 0.11, 0.3, 8, sx * 0.16, 0.05, -0.1, COAL, { metalness: 0.85 }).rotation.x = Math.PI / 2;
    latheF(tail, [[0.3, 0], [0.26, 0.1], [0.16, 0.22]], 10, 0, 0, 0.1, PAL.deep, { metalness: 0.7 }).rotation.x = -Math.PI / 2;
  },
  mount(c, F) {
    const { accent, PAL, K, dark } = c;
    const T = this.turret(c, F.spine, 0, 0.95, -0.35);
    // 輕武器:頭下短莢(隨頭轉向)
    const lp = new THREE.Group();
    lp.position.set(0, -0.28, 0.3);
    F.head.add(lp);
    tboxF(lp, { w0: 0.3, d0: 0.44, w1: 0.24, d1: 0.34, h: 0.26 }, 0, 0, -0.06, dark, { metalness: 0.76 })
      .rotation.x = Math.PI / 2;
    cylF(lp, 0.06, 0.07, 0.66 * K.barrelF, 8, 0, 0, 0.4 * K.barrelF, GUNMETAL, { metalness: 0.85 })
      .rotation.x = Math.PI / 2;
    const lMuz = cylF(lp, 0.062, 0.062, 0.03, 8, 0, 0, 0.74 * K.barrelF, accent,
      { emissive: accent, emissiveIntensity: 1.2 });
    lMuz.rotation.x = Math.PI / 2;
    return {
      gunR: null, gunL: null,
      muzzles: { light: { n: lMuz, r: 0.05 }, heavy: { n: T.muz[1], r: 0.09 } },
      lightGlowM: [lMuz], heavyGlowM: T.muz, heavyPivot: [],
      weap: { light: 'N', heavy: 'N' },
      hvy: { chest: 0.06 },
      aimPose: null,
      wpn: { light: { nodes: [lp], ref: lp, muz: lMuz, fwd: 'z' },
        heavy: { nodes: [T.tur], ref: T.cradle, muz: T.muz[1], fwd: 'z' } },
    };
  },
};
