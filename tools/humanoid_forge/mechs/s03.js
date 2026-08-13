// ============ s03 逐機零件檔(dev-only;仿生四足 D.kind 'quad')============
// ── s03「羽陣」始祖式可變機甲(**迅猛龍 = 地面型**)──
// 2D 定案圖:public/assets/cyberpunk_art/mechs/s03_ground_static.jpg / s03_flight_static.jpg
// 幾何語彙一律取自 ../geo.js;MUST NOT 在本檔自建 BufferGeometry。
//
// 2026-08-13 使用者定案:「迅猛龍+始祖鳥:**重製為迅猛龍為主體**,地面形態前爪與尾巴的羽毛
// 收合,飛行形態時前爪展開變翅膀,尾巴羽毛也水平展開變尾翼,武器在後背朝前。」
//   ⇒ 這一格原本沒有建模(s03@ground 缺檔),而飛行型是另畫的一具「相控陣翼板」機身。
//     兩張 2D 定案圖其實是同一具龍體:前肢的飛羽收在臂上還是張成翼、尾羽豎著還是攤平。
//   ⇒ 羽毛的**收/放只有一個旋鈕** `c.featherSpread`(地面 0 / 飛行 1),兩態同一批羽片;
//     各建一組的話,收起來的羽與張開的翼會是兩批不同數量、不同長度的羽毛。
// 零件比例:迅猛龍 75% / 始祖鳥 25%(飛羽 + 尾羽扇)。
import * as THREE from 'three';
import {
  dimF, bxF, cylF, sphF, coneF, torusF, tboxF, prismF, latheF, finF, fanF, chainF,
  IRON, GUNMETAL, COAL, INK, BONE,
} from '../geo.js';

export default {
  label: '羽陣(s03 變形者・迅猛龍)', hue: 0x9ef2e6, kind: 'quad', height: 4.4,
  frame: {
    hipY: 1.78, legX: 0.54, fz: 0.94, hz: -0.82,
    chest: [0, 0.14, 0.60], neck: [0, 0.38, 0.62], head: [0, 0.06, 0.42],
    tailY: 0.06, tailZ: -1.06, tail2Z: 0.9,
  },
  gait: { gait: 'trot', gallopType: 'rotary', stride: 2.4, top: 10, bob: 0.09, pitchAmp: 0.1 },
  moveSig: { poise: 0.6, idleF: 1.4, idleA: 0.6, launch: 0.95, spool: 0.1, brake: 0.8, settle: 0.4 },
  castSig: { omni: 'roar', dir: 'kick' },
  doc: [
    ['龍首', '尖楔顱殼(prismF 側輪廓)+ 長吻 + 齒列 + 冠頂感測帶 + 側面雙眼 + 頷下管束'],
    ['軀幹', '輕結構胸廓(tboxF)+ 龍骨突(prismF)+ 背脊板 + 胸腹電戰艙(艙門微張)'],
    ['前爪 ×2', '前肢:臂殼 + 三指爪(BONE 錐);臂後緣掛**飛羽列**(fanF 一片一件)'],
    ['飛羽(收合)', 'c.featherSpread = 0 ⇒ 羽片收攏貼臂;飛行型設 1 就是張開的翼'],
    ['後腿 ×2', '獵足:股殼 + 脛節 + 蹠節 + 鐮爪(finF;迅猛龍的識別點)'],
    ['尾 + 尾羽', 'chainF 六節配平尾 + 尾端羽扇(收合 = 豎直;飛行 = 水平尾翼)'],
    ['武裝', '背脊武器架(長莢 + 短莢)—— 兩態都朝機首(使用者:武器在後背朝前)'],
  ],

  // ---- 兩態共用的具名零件 -----------------------------------------------------
  /**
   * 飛羽列(**兩態同一批羽片**)。spread ∈ [0,1]:0 = 收攏貼臂、1 = 張開成翼面。
   * 一片羽毛 = 一顆零件(fanF);張角與長度由 spread 內插 —— 兩態各建一組的話,
   * 收起來的羽與張開的翼會是兩批不同數量的羽毛。
   */
  featherRow(c, parent, sx, y0, dy, n, len, spread) {
    const { PAL } = c;
    // ⚠ 肢體鏈的局部 **z 恆等於世界 z**(前肢展開只繞 z 轉,Rz 不動 z 軸)—— 羽片因此
    // 兩態都沿局部 −z 往後長,收/放只是**俯仰**與**長度**在變。這一條是這一族唯一
    // 「不用重新推導朝向」的軸;拿 fanF 在局部 XY 排一圈的話,張開後那個扇面會躺在
    // 與翼展垂直的平面上(實測第一版:羽毛整批埋進臂殼裡看不見)。
    for (let i = 0; i < n; i++) {
      const u = n === 1 ? 0 : i / (n - 1);
      const L = len * (0.62 + 0.38 * Math.sin(Math.PI * (0.22 + 0.66 * u))) * (0.42 + 0.58 * spread);
      const f = finF(parent, { len: L, w0: 0.17, w1: 0.05, t: 0.026 },
        sx * 0.08, y0 - u * dy, -0.11, PAL.lite, { metalness: 0.5 });
      f.rotation.x = -Math.PI / 2 + (1 - spread) * 1.18;   // 展開 = 朝正後方;收合 = 貼著臂垂下
      f.rotation.z = sx * (0.05 + u * 0.12) * (0.3 + 0.7 * spread);
    }
  },

  /**
   * 尾羽扇(收合 = 豎直的一排、展開 = 水平尾翼)。**兩層 Group**:
   * 內層 fanF 的 pivot 繞 x 轉 −π/2 讓羽片朝正後方(扇面落在水平的 XZ);
   * 外層繞 z 滾轉 (1−spread)·π/2 把扇面立起來 = 收合態。
   * 兩個角寫在同一顆 pivot 上會被尤拉序 'XYZ' 互相轉走(geo.js finF ③ 的同一族)。
   */
  tailFan(c, parent, spread) {
    const { PAL } = c;
    const roll = new THREE.Group();
    roll.rotation.z = (1 - spread) * Math.PI / 2;
    parent.add(roll);
    const f = fanF(roll, {
      n: 9, arc: 0.5 + spread * 1.35, len: 0.76 + spread * 0.55, edgeF: 0.6, gap: 0.022,
      fin: { w0: 0.14, w1: 0.04, t: 0.024 },
    }, 0, 0, -0.18, PAL.lite, { metalness: 0.5 });
    f.g.rotation.x = -Math.PI / 2;
    return f;
  },

  /** 背脊武器架(兩態同一組;槍口恆朝機首 = 使用者「武器在後背朝前」)。 */
  backGuns(c, parent) {
    const { PAL, accent, K, dark } = c;
    const g = new THREE.Group();
    g.position.set(0, 0.62, -0.1);
    parent.add(g);
    tboxF(g, { w0: 0.52, d0: 0.7, w1: 0.44, d1: 0.56, h: 0.2 }, 0, 0, -0.1, PAL.deep, { metalness: 0.7 });
    const mk = (ox, len, r) => {
      const p = new THREE.Group();
      p.position.set(ox, 0.16, 0.1);
      g.add(p);
      tboxF(p, { w0: r * 2.2, d0: r * 2.2, w1: r * 1.5, d1: r * 1.3, h: len * 0.5 }, 0, 0, -len * 0.16, dark, { metalness: 0.78 })
        .rotation.x = Math.PI / 2;
      cylF(p, r * 0.8, r * 0.9, len * 0.62, 8, 0, 0, len * 0.3, GUNMETAL, { metalness: 0.86 }).rotation.x = Math.PI / 2;
      const mz = cylF(p, r * 0.82, r * 0.82, 0.03, 8, 0, 0, len * 0.62, accent,
        { emissive: accent, emissiveIntensity: 1.3 });
      mz.rotation.x = Math.PI / 2;
      return { g: p, muz: mz };
    };
    return { lp: mk(-0.24, 0.9 * K.barrelF, 0.09), hp: mk(0.24, 1.24 * K.barrelF, 0.13) };
  },

  /** 前肢(帶飛羽列)/ 後肢(帶鐮爪)—— 兩態同一組規格陣列 */
  _leg(c, front) {
    const { PAL, sx } = c;
    const spread = c.featherSpread ?? 0;
    return [
      { len: front ? 0.66 : 0.8, draw: (l) => {
        tboxF(l, { w0: front ? 0.24 : 0.34, d0: front ? 0.28 : 0.46, w1: 0.17, d1: 0.24, h: front ? 0.72 : 0.88 },
          0, front ? -0.32 : -0.4, front ? 0.02 : -0.05, PAL.main, { metalness: 0.6 });
        const hub = latheF(l, [[0.03, -0.055], [0.14, -0.045], [0.17, 0], [0.14, 0.045], [0.03, 0.055]], 12, sx * 0.16, -0.03, 0, PAL.deep, { metalness: 0.85 });
        hub.rotation.z = Math.PI / 2;
        if (front) this.featherRow(c, l, sx, -0.08, 0.56, 5, 1.5, spread);   // 上臂後緣飛羽(次級飛羽)
      } },
      { len: front ? 0.6 : 0.74, base: front ? 0.4 : -0.42, k: front ? 0.5 : -0.5, d: 0.15, draw: (l) => {
        tboxF(l, { w0: front ? 0.16 : 0.2, d0: front ? 0.18 : 0.26, w1: 0.12, d1: 0.15, h: front ? 0.64 : 0.8 },
          0, front ? -0.3 : -0.38, 0, PAL.mid, { metalness: 0.6 });
        if (front) this.featherRow(c, l, sx, -0.05, 0.52, 6, 2.0, spread);   // 前臂飛羽(初級飛羽,最長)
      } },
      { len: 0, base: front ? -0.4 : 0.44, k: 0.3, d: 0.5, draw: (l) => {
        if (front) {                                   // 三指爪(始祖鳥翼緣還留著的那三根)
          for (const ox of [-0.07, 0, 0.07]) {
            const fg = tboxF(l, { w0: 0.05, d0: 0.05, w1: 0.035, d1: 0.04, h: 0.22 }, ox, -0.1, 0.1, PAL.deep, { metalness: 0.7 });
            fg.rotation.x = Math.PI / 2 + 0.3;
            coneF(l, 0.028, 0.16, 5, ox, -0.14, 0.26, BONE, { metalness: 0.8 }).rotation.x = 1.9;
          }
        } else {                                       // 獵足 + 鐮爪
          tboxF(l, { w0: 0.2, d0: 0.36, w1: 0.16, d1: 0.26, h: 0.14 }, 0, -0.06, 0.1, PAL.deep, { metalness: 0.6 });
          for (const ox of [-0.08, 0.08])
            coneF(l, 0.035, 0.2, 5, ox, -0.1, 0.24, BONE, { metalness: 0.8 }).rotation.x = 1.9;
          const sk = finF(l, { len: 0.36, w0: 0.09, w1: 0.025, t: 0.035, sweep: 0.12 }, 0, -0.12, -0.02, GUNMETAL, { metalness: 0.9 });
          sk.rotation.x = 1.5;                          // 鐮爪(上舉)
        }
      } },
    ];
  },
  legF(c) { return this._leg(c, true); },
  legH(c) { return this._leg(c, false); },

  // ---- 四足鷹架契約 ----------------------------------------------------------
  body(c, spine, chest) {
    const { PAL, accent } = c;
    tboxF(spine, { w0: 0.6, d0: 0.66, w1: 0.4, d1: 0.42, h: 1.3, sz: 0.06 }, 0, 0.02, -0.55, PAL.main, { metalness: 0.6 })
      .rotation.x = -Math.PI / 2;
    tboxF(spine, { w0: 0.46, d0: 0.9, w1: 0.34, d1: 0.66, h: 0.09 }, 0, 0.36, -0.5, dimF(PAL.lite, 0.94), { metalness: 0.6 });
    tboxF(chest, { w0: 0.62, d0: 0.66, w1: 0.54, d1: 0.5, h: 0.86, sz: -0.04 }, 0, 0.02, -0.06, PAL.main, { metalness: 0.6 })
      .rotation.x = -Math.PI / 2;
    // 龍骨突(深胸在前、往尾收成薄片)
    prismF(chest, [[-0.42, 0], [0.36, 0], [0.28, -0.26], [-0.34, -0.2]], 0.06, 0, -0.28, 0.02, PAL.deep, { metalness: 0.7 })
      .rotation.y = -Math.PI / 2;
    // 胸腹電戰艙(艙門微張 = 陣列散熱)
    const door = bxF(chest, 0.34, 0.03, 0.36, 0, -0.3, 0.3, PAL.lite, { metalness: 0.6 });
    door.rotation.x = 0.3;
    bxF(chest, 0.28, 0.12, 0.28, 0, -0.22, 0.3, COAL, { metalness: 0.75 });
    bxF(chest, 0.4, 0.04, 0.16, 0, 0.3, 0.3, dimF(accent, 0.8), { emissive: accent, emissiveIntensity: 0.5 });
  },
  neckHead(c, neck, head) {
    const { PAL, accent } = c;
    latheF(neck, [[0.2, -0.2], [0.24, 0], [0.22, 0.22], [0.17, 0.36]], 12, 0, 0, 0, PAL.deep, { metalness: 0.7 });
    // 尖楔顱殼:多邊形尖端在 +x,MUST 用 −π/2 送到 +z(機首);寫 +π/2 會把尖端送到腦後
    prismF(head, [[-0.2, -0.1], [0.3, -0.13], [0.4, 0.02], [0.24, 0.16], [-0.17, 0.18]], 0.24,
      0, 0, 0, PAL.mid, { metalness: 0.65 }).rotation.y = -Math.PI / 2;
    tboxF(head, { w0: 0.17, d0: 0.14, w1: 0.12, d1: 0.1, h: 0.2 }, 0, -0.1, 0.42, PAL.deep, { metalness: 0.6 })
      .rotation.x = Math.PI / 2;                        // 下顎
    for (const sx of [-1, 1]) {
      for (let i = 0; i < 3; i++)
        bxF(head, 0.02, 0.05, 0.02, sx * 0.05, -0.055, 0.24 + i * 0.06, BONE, { metalness: 0.6 });
      sphF(head, 0.055, sx * 0.11, 0.05, 0.16, accent, { emissive: accent, emissiveIntensity: 2.0 });
    }
    bxF(head, 0.2, 0.05, 0.07, 0, 0.19, -0.04, accent, { emissive: accent, emissiveIntensity: 1.6 });   // 冠頂感測帶
  },
  tail(c, tail) {
    const { PAL } = c;
    const spread = c.featherSpread ?? 0;
    const ch = chainF(tail, {
      n: 6, len0: 0.4, len1: 0.3, r0: 0.11, r1: 0.05,
      rot0: 0.1, rotD: 0.02, ring: true, ringColor: IRON, seg: 7,
    }, PAL.mid, { metalness: 0.6 });
    // 尾羽扇:收合 = 豎直的一排(繞尾軸立起)/ 展開 = 水平尾翼
    const f = this.tailFan(c, ch.tip, spread);
    f.g.rotation.set(Math.PI / 2, spread * Math.PI / 2, 0);
    return ch.segs;
  },
  mount(c, F) {
    const G = this.backGuns(c, F.spine);
    return {
      gunR: null, gunL: null,
      muzzles: { light: { n: G.lp.muz, r: 0.05 }, heavy: { n: G.hp.muz, r: 0.09 } },
      lightGlowM: [G.lp.muz], heavyGlowM: [G.hp.muz], heavyPivot: [],
      weap: { light: 'N', heavy: 'N' },
      hvy: { chest: 0.05 },
      aimPose: null,
      wpn: { light: { nodes: [G.lp.g], ref: G.lp.g, muz: G.lp.muz, fwd: 'z' },
        heavy: { nodes: [G.hp.g], ref: G.hp.g, muz: G.hp.muz, fwd: 'z' } },
    };
  },
};
