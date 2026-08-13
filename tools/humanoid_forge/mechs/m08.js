// ============ m08 逐機零件檔(dev-only;仿生四足 D.kind 'quad')============
// ── m08「空號」隱形狙擊可變機甲(**夜豹 = 地面型**)──
// 2D 定案圖:public/assets/cyberpunk_art/mechs/m08_ground_static.jpg / m08_flight_static.jpg
// 幾何語彙一律取自 ../geo.js;MUST NOT 在本檔自建 BufferGeometry。
//
// 2026-08-13 使用者定案:「夜豹+夜梟:**重製為夜豹特徵優先**,飛行型態夜梟現形,展開隱藏在
// 後背的翅膀,武器在雙肩朝前。」+ 總則「盡量用相同零件變形」。
//   ⇒ 兩張 2D 定案圖是**同一具豹身**,差別只有背上那對翅膀摺著還是張開 ⇒ 地面型是主體(75%),
//     夜梟那 25% = 翅膀 + 面盤(兩者在地面型都收著,飛行型才現形)。
//   ⇒ 這一格原本沒有建模(m08@ground 缺檔),飛行型卻早就在架上 —— 那台是另畫的一隻夜梟。
//
// gen.note:「整台機 MUST 沒有高光與硬邊(絨質吸音層吃掉輪廓)」⇒ 全機材質走 SOFT
// (metalness ≤ 0.15);這是這一台唯一不准調的旋鈕,兩態同吃。
import * as THREE from 'three';
import {
  dimF, bxF, cylF, sphF, coneF, torusF, tboxF, prismF, latheF, finF, fanF, chainF,
  IRON, GUNMETAL, COAL, INK,
} from '../geo.js';

const SOFT = { metalness: 0.12 };      // 絨質吸音:全機 MUST 走這一組(不准有高光)
const SERR = 11;                       // 翼前緣鋸齒數(夜梟前緣梳;逐齒成件)

export default {
  label: '空號(m08 變形者・夜豹)', hue: 0x8f7fd0, kind: 'quad', height: 4.6,
  frame: {
    hipY: 1.86, legX: 0.60, fz: 1.10, hz: -1.05,
    chest: [0, 0.08, 0.62], neck: [0, 0.20, 0.74], head: [0, 0.04, 0.46],
    tailY: 0.10, tailZ: -1.34, tail2Z: 0.7,
  },
  gait: { gait: 'trot', gallopType: 'rotary', stride: 2.5, top: 9, bob: 0.08, pitchAmp: 0.08 },
  moveSig: { poise: 0.86, idleF: 0.7, idleA: 0.35, launch: 0.9, spool: 0.12, brake: 0.9, settle: 0.38 },
  castSig: { omni: 'flare', dir: 'lunge' },
  doc: [
    ['豹首', '圓潤顱殼(latheF)+ 短吻(tboxF)+ 三角耳 ×2(prismF)+ 眼帶 + 絨質頰板'],
    ['面盤 ×2(收著)', '夜梟聲學碟的兩半(prismF)—— 地面態摺貼頰側,飛行型才向前合成面盤'],
    ['軀幹', '深胸楔台 + 肩胛甲 + 脊椎波紋護套(latheF)+ 迷彩背板 + 絨質分片 ×4'],
    ['翅膀 ×2(收著)', 'wingF 寬短翼 + 前緣鋸齒 ×11 + 後緣流蘇 ×9 + 覆羽列(finF ×7);地面態摺平貼背'],
    ['四腿', '貓科腿(股殼楔台 + 管骨 + 掌墊 + 四爪);後腿跗節反折'],
    ['尾', 'chainF 五節細長尾 + 尾梢絨叢'],
    ['武裝', '長狙擊莢(消音節管 ×3)+ 短莢;地面態架在背脊上,飛行型移到雙肩朝前'],
  ],

  // ---- 兩態共用的具名零件 -----------------------------------------------------
  /** 夜梟面盤的一半(地面摺貼頰側、飛行向前合成聲學碟)。回傳 pivot。 */
  faceHalf(c, parent, sx, x, y, z) {
    const { PAL } = c;
    const piv = new THREE.Group();
    piv.position.set(x, y, z);
    parent.add(piv);
    const pts = [[0, -0.30], [0.30, -0.24], [0.36, 0.06], [0.20, 0.30], [0, 0.34]].map(([px, py]) => [sx * px, py]);
    prismF(piv, pts, 0.05, 0, 0, 0, PAL.lite, SOFT);
    for (let i = 0; i < 3; i++)                       // 碟面環紋(聲學槽)
      bxF(piv, 0.03, 0.02, 0.42, sx * (0.09 + i * 0.09), 0.03, 0.03, PAL.deep, SOFT);
    return piv;
  },

  /**
   * 翅膀一片(**兩態同一顆零件**:地面摺平貼背、飛行張開)。
   * 回傳 { w, outer, sgn } —— 飛行型把它掛進 rig.wings(內/外兩段樞軸 = 撲翼的兩層)。
   */
  wing(c, parent, sx, x, y, z) {
    const { PAL } = c;
    const w = new THREE.Group();
    w.position.set(x, y, z);
    parent.add(w);
    cylF(w, 0.055, 0.065, 0.36, 8, sx * 0.18, 0, 0, PAL.mid, SOFT).rotation.z = Math.PI / 2;
    const outer = new THREE.Group();
    outer.position.set(sx * 0.36, 0, 0);
    w.add(outer);
    // 翼板(2D 圖是有迷彩底板 + 一整排覆羽的硬翼,不是一團羽毛)
    const panel = prismF(outer, [[0, -0.52], [2.35, -0.42], [2.20, 0.46], [0.05, 0.56]].map(([px, py]) => [sx * px, py]),
      0.06, 0, 0, 0, PAL.main, SOFT);
    panel.rotation.x = -Math.PI / 2;
    // 覆羽列(一片一件;沿後緣排開 —— 2D 背上那一排尖羽)
    for (let i = 0; i < 7; i++) {
      const u = i / 6;
      const f = finF(outer, { len: 0.66 - u * 0.14, w0: 0.16, w1: 0.05, t: 0.03 },
        sx * (0.24 + u * 1.9), 0.035, -0.42 - u * 0.02, PAL.lite, SOFT);
      f.rotation.x = -Math.PI / 2;
      f.rotation.z = -sx * 0.08;
    }
    for (let i = 0; i < SERR; i++) {                  // 前緣鋸齒(夜梟前緣梳;逐齒成件)
      const u = 0.14 + (i / (SERR - 1)) * 2.05;
      const s = finF(outer, { len: 0.12, w0: 0.1, w1: 0.02, t: 0.02 }, sx * u, 0.015, 0.5 - u * 0.045, PAL.lite, SOFT);
      s.rotation.x = Math.PI / 2;
      s.rotation.z = sx * 0.1;
    }
    for (let i = 0; i < 9; i++) {                     // 後緣流蘇(消音的第二個機構)
      const u = 0.2 + (i / 8) * 1.9;
      const f = finF(outer, { len: 0.16, w0: 0.05, w1: 0.015, t: 0.012 }, sx * u, -0.01, -0.5 + u * 0.03, PAL.lite, SOFT);
      f.rotation.x = -Math.PI / 2 + 0.2;
    }
    return { w, outer, sgn: sx };
  },

  /** 長狙擊莢(重武器;兩態同一具)。回傳 { g, muz } */
  rifle(c, parent, x, y, z) {
    const { PAL, accent, K } = c;
    const g = new THREE.Group();
    g.position.set(x, y, z);
    parent.add(g);
    latheF(g, [[0, -1.0], [0.1, -0.88], [0.11, 0.44], [0.08, 0.88], [0, 1.0]], 10, 0, 0, 0, PAL.deep, SOFT)
      .rotation.x = Math.PI / 2;
    for (let i = 0; i < 3; i++)                       // 消音節管(前段三節)
      cylF(g, 0.13 - i * 0.013, 0.13 - i * 0.013, 0.22, 10, 0, 0, 0.56 + i * 0.24, PAL.mid, SOFT)
        .rotation.x = Math.PI / 2;
    bxF(g, 0.1, 0.16, 0.5, 0, -0.14, -0.3, PAL.mid, SOFT);                   // 彈匣/機匣
    const muz = cylF(g, 0.08, 0.08, 0.035, 10, 0, 0, 1.18 * K.barrelF, accent,
      { emissive: accent, emissiveIntensity: 1.2 });
    muz.rotation.x = Math.PI / 2;
    return { g, muz };
  },

  /** 頦下短莢(輕武器;兩態同一具)。回傳 { g, muz } */
  pod(c, parent, x, y, z) {
    const { PAL, accent, K } = c;
    const g = new THREE.Group();
    g.position.set(x, y, z);
    parent.add(g);
    tboxF(g, { w0: 0.24, d0: 0.34, w1: 0.19, d1: 0.26, h: 0.24 }, 0, 0, -0.06, PAL.mid, SOFT)
      .rotation.x = Math.PI / 2;
    cylF(g, 0.05, 0.058, 0.6 * K.barrelF, 8, 0, 0, 0.36 * K.barrelF, GUNMETAL, SOFT).rotation.x = Math.PI / 2;
    const muz = cylF(g, 0.052, 0.052, 0.03, 8, 0, 0, 0.68 * K.barrelF, accent,
      { emissive: accent, emissiveIntensity: 1.1 });
    muz.rotation.x = Math.PI / 2;
    return { g, muz };
  },

  /** 一條貓科腿 */
  _leg(c, front) {
    const { PAL, sx } = c;
    return [
      { len: 0.72, draw: (l) => {
        tboxF(l, { w0: 0.30, d0: front ? 0.42 : 0.52, w1: 0.2, d1: 0.28, h: 0.8 }, 0, -0.34, front ? 0.03 : -0.06, PAL.main, SOFT);
        const hub = latheF(l, [[0.04, -0.06], [0.16, -0.05], [0.19, 0], [0.16, 0.05], [0.04, 0.06]], 12, sx * 0.19, -0.04, 0, PAL.deep, SOFT);
        hub.rotation.z = Math.PI / 2;
        if (!front) {
          const hp = prismF(l, [[-0.3, -0.34], [0.1, -0.4], [0.34, -0.16], [0.36, 0.12], [0.14, 0.3], [-0.22, 0.26]], 0.05, sx * 0.22, -0.3, -0.06, PAL.mid, SOFT);
          hp.rotation.y = sx * Math.PI / 2;
        }
      } },
      { len: 0.68, base: front ? 0.3 : -0.34, k: front ? 0.5 : -0.5, d: 0.15, draw: (l) => {
        tboxF(l, { w0: 0.15, d0: 0.2, w1: 0.11, d1: 0.15, h: 0.72 }, 0, -0.34, 0, PAL.mid, SOFT);
        cylF(l, 0.07, 0.07, 0.05, 10, sx * 0.09, -0.02, 0, PAL.deep, SOFT).rotation.z = Math.PI / 2;
      } },
      { len: 0, base: front ? -0.34 : 0.4, k: 0.3, d: 0.5, draw: (l) => {
        tboxF(l, { w0: 0.2, d0: 0.28, w1: 0.17, d1: 0.22, h: 0.14 }, 0, -0.06, 0.05, PAL.deep, SOFT);   // 掌墊
        for (const ox of [-0.08, -0.027, 0.027, 0.08]) {                       // 四爪(貓科)
          const cl = coneF(l, 0.032, 0.19, 5, ox, -0.1, 0.18, PAL.lite, SOFT);
          cl.rotation.x = 1.95;
        }
      } },
    ];
  },
  legF(c) { return this._leg(c, true); },
  legH(c) { return this._leg(c, false); },

  // ---- 四足鷹架契約 ----------------------------------------------------------
  body(c, spine, chest) {
    const { PAL, accent } = c;
    // 後軀(掛 spine)+ 脊椎波紋護套 + 迷彩背板
    tboxF(spine, { w0: 0.82, d0: 0.86, w1: 0.6, d1: 0.6, h: 1.4, sz: 0.08 }, 0, 0.02, -0.66, PAL.main, SOFT)
      .rotation.x = -Math.PI / 2;
    latheF(spine, [[0.3, -0.5], [0.34, -0.2], [0.3, 0.2], [0.34, 0.5]], 12, 0, 0.2, -0.1, PAL.deep, SOFT)
      .rotation.x = Math.PI / 2;
    tboxF(spine, { w0: 0.66, d0: 0.9, w1: 0.5, d1: 0.66, h: 0.1 }, 0, 0.48, -0.62, dimF(PAL.lite, 0.92), SOFT);
    for (let i = 0; i < 4; i++)                       // 絨質分片(壓過稜線 = 輪廓被吃掉)
      bxF(spine, 0.7 - i * 0.06, 0.05, 0.3, 0, 0.34 - i * 0.03, -0.1 - i * 0.34, PAL.mid, SOFT);
    // 深胸(掛 chest)+ 肩胛甲
    tboxF(chest, { w0: 0.78, d0: 0.8, w1: 0.66, d1: 0.62, h: 0.96, sz: -0.04 }, 0, 0.02, -0.1, PAL.main, SOFT)
      .rotation.x = -Math.PI / 2;
    for (const sx of [-1, 1]) {
      const sc = prismF(chest, [[-0.26, -0.2], [0.1, -0.3], [0.32, -0.06], [0.24, 0.24], [-0.14, 0.28]], 0.06, sx * 0.42, 0.2, -0.1, PAL.mid, SOFT);
      sc.rotation.y = sx * Math.PI / 2;
    }
    bxF(chest, 0.5, 0.04, 0.2, 0, -0.3, 0.28, dimF(accent, 0.7), { emissive: accent, emissiveIntensity: 0.4 });
    // 翅膀(**地面態:摺平貼背**;兩態同一對零件)
    c.wings = [];
    for (const sx of [-1, 1]) {
      const mw = this.wing(c, spine, sx, sx * 0.22, 0.56, -0.34);
      mw.w.rotation.set(0, sx * 1.42, 0);             // 繞垂直軸摺向機尾 ⇒ 翼板順著背脊躺平
      mw.outer.rotation.set(0, sx * 0.14, 0);
      c.wings.push(mw);
    }
  },
  neckHead(c, neck, head) {
    const { PAL, accent } = c;
    latheF(neck, [[0.28, -0.14], [0.32, 0], [0.3, 0.2], [0.24, 0.3]], 12, 0, 0, 0, PAL.deep, SOFT);
    // 圓潤豹顱 + 短吻 + 眼帶 + 三角耳
    latheF(head, [[0, -0.3], [0.26, -0.2], [0.3, 0.08], [0.22, 0.28], [0, 0.34]], 12, 0, 0.02, 0, PAL.main, SOFT)
      .rotation.x = Math.PI / 2;
    tboxF(head, { w0: 0.3, d0: 0.28, w1: 0.24, d1: 0.2, h: 0.3, sz: 0.02 }, 0, -0.05, 0.34, PAL.mid, SOFT)
      .rotation.x = Math.PI / 2;
    bxF(head, 0.08, 0.06, 0.06, 0, -0.02, 0.5, INK, SOFT);                      // 鼻
    for (const sx of [-1, 1]) {
      const eye = sphF(head, 0.07, sx * 0.14, 0.08, 0.3, accent, { emissive: accent, emissiveIntensity: 1.4 });
      eye.scale.z = 0.6;
      const ear = prismF(head, [[-0.11, 0], [0.11, 0], [0.02, 0.3]], 0.05, sx * 0.2, 0.26, -0.02, PAL.mid, SOFT);
      ear.rotation.x = -0.3;
      ear.rotation.z = -sx * 0.16;
      bxF(ear, 0.08, 0.14, 0.02, 0, 0.09, 0.03, COAL, SOFT);                    // 內耳暗板
      // 面盤半片(**地面態:摺貼頰側**;飛行型由 m08_flight 轉向前合成聲學碟)
      const fh = this.faceHalf(c, head, sx, sx * 0.24, 0.0, 0.06);
      fh.rotation.set(0, -sx * 1.32, 0);
      (c.faceHalves || (c.faceHalves = [])).push({ piv: fh, sx });   // 飛行型的消費端(不靠遍歷猜)
    }
  },
  tail(c, tail, tail2) {
    const { PAL } = c;
    const ch = chainF(tail, {
      n: 5, len0: 0.38, len1: 0.3, r0: 0.075, r1: 0.04,
      rot0: 0.22, rotD: 0.03, ring: true, ringColor: IRON, seg: 7,
    }, PAL.mid, SOFT);
    coneF(ch.tip, 0.06, 0.2, 6, 0, 0, -0.4, PAL.deep, SOFT).rotation.x = -Math.PI / 2;
    return ch.segs;
  },
  mount(c, F) {
    // 地面態:長狙擊莢架在背脊上、短莢在頦下(飛行型改掛雙肩朝前 —— 見 m08_flight)
    const R = this.rifle(c, F.spine, 0, 0.78, -0.2);
    const P = this.pod(c, F.head, 0, -0.22, 0.3);
    return {
      gunR: null, gunL: null,
      muzzles: { light: { n: P.muz, r: 0.04 }, heavy: { n: R.muz, r: 0.08 } },
      lightGlowM: [P.muz], heavyGlowM: [R.muz], heavyPivot: [],
      weap: { light: 'N', heavy: 'N' },
      hvy: { chest: 0.04 },
      aimPose: null,
      wpn: { light: { nodes: [P.g], ref: P.g, muz: P.muz, fwd: 'z' },
        heavy: { nodes: [R.g], ref: R.g, muz: R.muz, fwd: 'z' } },
    };
  },
};
