// ============ s10 逐機零件檔(dev-only;仿生四足 D.kind 'quad')============
// ── s10「靜電」長耳可變訊號機(**機械巨象 = 地面型**)──
// 2D 定案圖:public/assets/cyberpunk_art/mechs/s10_ground_static.jpg / s10_flight_static.jpg
// 幾何語彙一律取自 ../geo.js;MUST NOT 在本檔自建 BufferGeometry。
//
// 2026-08-13 使用者定案:「利維坦+巨像:**保持飛艇形象,加入飛鯨頭部與胸鰭特徵**;
// 地面形態胸鰭充當象耳;飛行形態四肢象腿與象牙內縮,地面形態才展開;
// 飛行形態象鼻變獨角鯨的角連帶武器挺直,地面形態象鼻保持柔軟持武器攻擊。」
//   ⇒ 這一格原本沒有建模(s10@ground 缺檔)。兩張 2D 定案圖其實是**同一具氣囊 + 同一顆鯨首**,
//     差別只有:耳/胸鰭張開還是後掠、象腿與象牙伸出還是內縮、象鼻垂軟還是挺成獨角。
//   ⇒ 因此四件事各只有一個旋鈕(`earOut` / `legOut` / `tuskOut` / `trunkDown`),
//     兩態同一批零件;各建一組的話,飛行型的鰭與地面型的耳會是兩片不同的板。
import * as THREE from 'three';
import {
  dimF, bxF, cylF, sphF, coneF, torusF, tboxF, prismF, latheF, finF, chainF,
  IRON, GUNMETAL, COAL, INK, BONE,
} from '../geo.js';

export default {
  label: '靜電(s10 變形者・機械巨象)', hue: 0xd7b8ff, kind: 'quad', height: 5.6,
  frame: {
    hipY: 2.66, legX: 1.02, fz: 1.30, hz: -1.20,
    chest: [0, 0.10, 1.05], neck: [0, -0.06, 0.88], head: [0, -0.18, 0.52],
    tailY: 0.18, tailZ: -1.9, tail2Z: 0.55,
  },
  gait: { gait: 'walk', stride: 3.4, top: 5, bob: 0.05, rollSway: 0.06, legAmp: 0.8 },
  moveSig: { poise: 0.2, idleF: 0.4, idleA: 1.0, launch: 0.05, spool: 0.95, brake: 0.06, settle: 2.0 },
  castSig: { omni: 'roar', dir: 'swing' },
  doc: [
    ['浮空囊體(飛艇形象)', '大旋成氣囊 + 縱向充氣隔艙稜線 ×8 + 繫留帶 ×3 —— 兩態都是它'],
    ['艦橋', '囊背指揮塔(latheF)+ 桅桿 + 雷達碟 + 天線 ×2'],
    ['鯨首', '鈍圓鯨頭(latheF)+ 下頷溝槽 ×5 + 感測眼 ×2 + 額隆'],
    ['胸鰭/象耳 ×2', '同一片大板:地面態外張當象耳(振子格陣朝外)、飛行態後掠成胸鰭'],
    ['象牙 ×2', '同一對 BONE 錐:地面態前伸、飛行態內縮進頰囊'],
    ['象鼻', 'chainF 十節軟鼻:地面態垂軟持武器、飛行態挺直成獨角鯨的角(連武器一起)'],
    ['四肢象腿', '柱狀象腿(楔台 + 環箍 + 圓足墊 + 趾甲 ×4);飛行態上收進腹艙'],
    ['鯨尾', '水平尾鰭 ×2(finF)+ 垂直安定鰭'],
    ['武裝', '鼻端短莢(輕)+ 腹下訊號吊艙砲(重)'],
  ],

  // ---- 兩態共用的具名零件 -----------------------------------------------------
  /** 浮空囊體 + 隔艙稜線 + 繫留帶 + 艦橋(飛艇形象;兩態一模一樣) */
  envelope(c, parent) {
    const { PAL, accent } = c;
    latheF(parent, [[0, -2.0], [0.4, -1.72], [0.78, -0.9], [0.92, 0], [0.86, 0.9], [0.54, 1.5], [0, 1.82]], 16,
      0, 0.15, -0.4, PAL.main, { metalness: 0.3 }).rotation.x = Math.PI / 2;
    // 縱向充氣隔艙稜線(它是氣囊不是機身)。
    // ⚠ 稜條的**位置**在 (sinθ, cosθ) 的徑向、而滾轉 MUST 是 **−θ**:Rz(θ) 把 +y 送到
    // (−sinθ, cosθ) —— 同號的話稜條的厚度方向與它自己的半徑方向差一個鏡射,遠端就翹出囊外
    // 變成一叢黑刺(2026-08-13 實測第一版)。長度也 MUST 收在囊體半徑 ≥ R 的那一段內。
    const R = 0.80, LEN = 2.5, CZ = -0.45;
    for (let i = 0; i < 8; i++) {
      const th = i / 8 * Math.PI * 2;
      const r = bxF(parent, 0.07, 0.05, LEN, Math.sin(th) * R, 0.15 + Math.cos(th) * R, CZ,
        PAL.deep, { metalness: 0.35 });
      r.rotation.z = -th;
    }
    for (const z of [-1.3, -0.4, 0.5])               // 繫留帶
      cylF(parent, 0.92, 0.92, 0.07, 16, 0, 0.15, z, PAL.mid, { metalness: 0.4 }).rotation.x = Math.PI / 2;
    // 艦橋(囊背;2D 兩張圖都有這一具)
    const br = new THREE.Group();
    br.position.set(0, 1.06, -0.5);
    parent.add(br);
    tboxF(br, { w0: 0.42, d0: 0.7, w1: 0.32, d1: 0.5, h: 0.3 }, 0, 0, 0, PAL.deep, { metalness: 0.7 });
    cylF(br, 0.03, 0.04, 0.8, 6, 0, 0.56, -0.06, IRON, { metalness: 0.85 });
    latheF(br, [[0.2, 0], [0.17, 0.08], [0.06, 0.14]], 10, 0, 0.34, 0.16, PAL.lite, { metalness: 0.6 }).rotation.x = -1.0;
    for (const sx of [-1, 1])
      cylF(br, 0.012, 0.012, 0.5, 5, sx * 0.14, 0.42, -0.1, IRON, { metalness: 0.85 });
    bxF(br, 0.3, 0.05, 0.06, 0, 0.14, 0.24, accent, { emissive: accent, emissiveIntensity: 0.9 });
  },

  /**
   * 胸鰭 / 象耳一片(**兩態同一片板**)。out ∈ [0,1]:1 = 外張成象耳、0 = 後掠成胸鰭。
   * 板面是振子格陣(gen.note:耳廓就是天線陣)—— 兩態都看得到,只是指向不同。
   */
  earFin(c, parent, sx, x, y, z, out) {
    const { PAL, accent } = c;
    const piv = new THREE.Group();
    piv.position.set(x, y, z);
    piv.rotation.set(0.1 - out * 0.05, -sx * (1.25 - out * 1.05), sx * (0.18 + out * 0.22));
    parent.add(piv);
    const pts = [[0, -0.75], [0.5, -1.0], [1.28, -0.5], [1.42, 0.55], [0.86, 1.06], [0.1, 0.86]]
      .map(([px, py]) => [sx * px, py]);
    prismF(piv, pts, 0.07, 0, 0, 0, PAL.lite, { metalness: 0.5 });
    for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++)   // 振子格陣(耳 = 天線)
      bxF(piv, 0.16, 0.16, 0.02, sx * (0.35 + i * 0.36), -0.3 + j * 0.4, 0.05,
        accent, { emissive: accent, emissiveIntensity: 0.65 });
    bxF(piv, 0.06, 1.7, 0.06, sx * 0.1, 0.05, 0.02, PAL.deep, { metalness: 0.7 });   // 耳根加強樑
    return piv;
  },

  /** 象牙一根(out = 1 前伸 / 0 內縮進頰囊)。回傳 pivot。 */
  tusk(c, parent, sx, out) {
    const piv = new THREE.Group();
    piv.position.set(sx * 0.28, -0.26 + (1 - out) * 0.14, 0.28 - (1 - out) * 0.42);
    piv.rotation.set(1.85 + (1 - out) * 0.9, 0, -sx * 0.3);
    parent.add(piv);
    const t = coneF(piv, 0.085, 1.15, 7, 0, 0.5, 0, BONE, { metalness: 0.6 });
    t.rotation.x = Math.PI;                         // 錐尖朝 −y = pivot 的前方
    torusF(piv, 0.1, 0.022, 0, 0.06, 0, IRON, { metalness: 0.85 }).rotation.x = Math.PI / 2;
    return piv;
  },

  /**
   * 象鼻(**兩態同一條十節軟鼻**)。down = true 垂軟(地面持武器)/ false 挺直朝前(獨角)。
   * ⚠ 基礎彎曲 MUST 寫在**靜態中介 Group** 與 chainF 的 rot0/rotD 上,而本條**不進
   * rig.tailSegs** —— whipTail 會每幀覆寫節樞軸,「挺成一根角」當場被打回一段亂擺的鞭子。
   */
  trunk(c, parent, down) {
    const { PAL } = c;
    const base = new THREE.Group();
    base.position.set(0, -0.24, 0.42);
    base.rotation.x = down ? -Math.PI / 2 + 0.25 : Math.PI;
    parent.add(base);
    const ch = chainF(base, {
      n: 10, len0: 0.3, len1: 0.2, r0: 0.17, r1: 0.075,
      rot0: down ? 0.10 : 0, rotD: down ? 0.02 : 0, ring: true, ringColor: IRON, seg: 8,
      drawSeg: (gp, i, { r }) => {
        for (let k = 0; k < 2; k++)                 // 鼻環褶(一褶一件;象鼻的橫紋)
          torusF(gp, r * 1.05, r * 0.16, 0, 0, -0.07 - k * 0.1, PAL.deep, { metalness: 0.5 }).rotation.x = Math.PI / 2;
      },
    }, PAL.mid, { metalness: 0.5 });
    if (!down) {                                    // 獨角鯨的角:挺直時外覆螺旋稜
      for (let i = 0; i < 3; i++) {
        const s = bxF(ch.segs[Math.min(9, 2 + i * 3)], 0.05, 0.05, 0.3, 0, 0, -0.12, BONE, { metalness: 0.7 });
        s.rotation.z = i * 1.1;
      }
    }
    return ch;
  },

  /** 柱狀象腿(四足共用) */
  _leg(c, front) {
    const { PAL, sx } = c;
    return [
      { len: 1.05, draw: (l) => {
        tboxF(l, { w0: 0.56, d0: 0.62, w1: 0.42, d1: 0.48, h: 1.12 }, 0, -0.5, front ? 0.03 : -0.04, PAL.main, { metalness: 0.5 });
        const hub = latheF(l, [[0.05, -0.09], [0.24, -0.07], [0.28, 0], [0.24, 0.07], [0.05, 0.09]], 12, sx * 0.28, -0.06, 0, PAL.deep, { metalness: 0.8 });
        hub.rotation.z = Math.PI / 2;
      } },
      { len: 0.95, base: front ? 0.16 : -0.18, k: front ? 0.34 : -0.34, d: 0.15, draw: (l) => {
        tboxF(l, { w0: 0.42, d0: 0.46, w1: 0.38, d1: 0.42, h: 1.0 }, 0, -0.48, 0, PAL.mid, { metalness: 0.5 });
        for (const oy of [-0.2, -0.62])
          torusF(l, 0.24, 0.035, 0, oy, 0, IRON, { metalness: 0.8 }).rotation.x = Math.PI / 2;
      } },
      { len: 0, base: front ? -0.16 : 0.18, k: 0.24, d: 0.5, draw: (l) => {
        latheF(l, [[0.34, -0.2], [0.4, -0.1], [0.4, 0.02], [0.3, 0.1]], 12, 0, -0.06, 0.02, PAL.deep, { metalness: 0.5 });  // 圓足墊
        for (const ox of [-0.19, -0.065, 0.065, 0.19])
          tboxF(l, { w0: 0.11, d0: 0.1, w1: 0.09, d1: 0.07, h: 0.09 }, ox, -0.14, 0.24, BONE, { metalness: 0.6 });          // 趾甲 ×4
      } },
    ];
  },
  legF(c) { return this._leg(c, true); },
  legH(c) { return this._leg(c, false); },

  /** 腹下訊號吊艙砲(重武器;兩態同一具) */
  bellyPod(c, parent, x, y, z) {
    const { PAL, accent, K } = c;
    const g = new THREE.Group();
    g.position.set(x, y, z);
    parent.add(g);
    latheF(g, [[0, -1.05], [0.15, -0.9], [0.19, 0], [0.16, 0.8], [0, 0.95]], 12, 0, 0, 0, PAL.mid, { metalness: 0.6 })
      .rotation.x = Math.PI / 2;
    for (let i = 0; i < 6; i++)
      bxF(g, 0.022, 0.11, 0.22, (i % 2 ? 1 : -1) * 0.19, 0, 0.5 - Math.floor(i / 2) * 0.5,
        accent, { emissive: accent, emissiveIntensity: 0.9 });
    cylF(g, 0.1, 0.11, 0.72 * K.barrelF, 8, 0, 0, 1.2 + 0.3 * K.barrelF, GUNMETAL, { metalness: 0.86 })
      .rotation.x = Math.PI / 2;
    const muz = cylF(g, 0.105, 0.105, 0.035, 10, 0, 0, 1.24 + 0.68 * K.barrelF, accent,
      { emissive: accent, emissiveIntensity: 1.4 });
    muz.rotation.x = Math.PI / 2;
    return { g, muz };
  },

  /** 鼻端短莢(輕武器;地面由軟鼻持著、飛行與獨角同軸) */
  trunkPod(c, parent) {
    const { PAL, accent, K } = c;
    const g = new THREE.Group();
    g.position.set(0, 0, -0.16);
    parent.add(g);
    tboxF(g, { w0: 0.2, d0: 0.28, w1: 0.16, d1: 0.22, h: 0.24 }, 0, 0, 0.04, PAL.deep, { metalness: 0.75 })
      .rotation.x = Math.PI / 2;
    cylF(g, 0.05, 0.058, 0.56 * K.barrelF, 8, 0, 0, -0.3 * K.barrelF, GUNMETAL, { metalness: 0.86 })
      .rotation.x = Math.PI / 2;
    const muz = cylF(g, 0.052, 0.052, 0.03, 8, 0, 0, -0.6 * K.barrelF, accent,
      { emissive: accent, emissiveIntensity: 1.2 });
    muz.rotation.x = Math.PI / 2;
    return { g, muz };
  },

  // ---- 四足鷹架契約 ----------------------------------------------------------
  body(c, spine) {
    this.envelope(c, spine);
  },
  neckHead(c, neck, head) {
    const { PAL, accent } = c;
    const out = c.earOut ?? 1;                       // 1 = 象耳外張(地面)/ 0 = 胸鰭後掠(飛行)
    latheF(neck, [[0.5, -0.2], [0.56, 0], [0.5, 0.24], [0.4, 0.4]], 12, 0, 0, 0, PAL.deep, { metalness: 0.5 });
    // 鯨首:鈍圓頭 + 額隆 + 下頷溝槽 + 感測眼
    latheF(head, [[0, -0.5], [0.44, -0.36], [0.56, 0.1], [0.44, 0.5], [0, 0.66]], 14, 0, 0.02, 0.1, PAL.main, { metalness: 0.4 })
      .rotation.x = Math.PI / 2;
    latheF(head, [[0, 0], [0.3, 0.06], [0.24, 0.2], [0, 0.26]], 12, 0, 0.26, 0.16, PAL.lite, { metalness: 0.35 });   // 額隆
    for (let i = 0; i < 5; i++)
      bxF(head, 0.44 - i * 0.06, 0.03, 0.4, 0, -0.34 + i * 0.03, 0.5 - i * 0.12, PAL.deep, { metalness: 0.4 });
    for (const sx of [-1, 1]) sphF(head, 0.08, sx * 0.42, 0.06, 0.3, accent, { emissive: accent, emissiveIntensity: 1.5 });
    // 胸鰭 / 象耳 + 象牙(同一批零件,只差旋鈕)
    c.ears = [];
    for (const sx of [-1, 1]) c.ears.push(this.earFin(c, head, sx, sx * 0.44, 0.18, -0.14, out));
    c.tusks = [];
    for (const sx of [-1, 1]) c.tusks.push(this.tusk(c, head, sx, c.tuskOut ?? 1));
    // 象鼻(地面:垂軟持武器)
    c._trunk = this.trunk(c, head, c.trunkDown ?? true);
  },
  tail(c, tail, tail2) {
    const { PAL } = c;
    // 鯨尾:水平尾鰭 ×2(內層網格繞長軸 Ry(π/2) 把弦轉到前後、外層 Group 放平 —— geo.js finF ①③)
    for (const sx of [-1, 1]) {
      const fl = new THREE.Group();
      fl.position.set(sx * 0.12, 0, -0.3);
      fl.rotation.z = -sx * Math.PI / 2;
      tail.add(fl);
      finF(fl, { len: 0.95, w0: 0.36, w1: 0.14, t: 0.07, sweep: -sx * 0.1 }, 0, 0, 0, PAL.lite, { metalness: 0.45 })
        .rotation.y = Math.PI / 2;
    }
    const vf = new THREE.Group();
    vf.position.set(0, 0.24, -0.2);
    vf.rotation.x = -0.3;
    tail.add(vf);
    finF(vf, { len: 0.72, w0: 0.38, w1: 0.12, t: 0.06 }, 0, 0, 0, PAL.lite, { metalness: 0.45 }).rotation.y = Math.PI / 2;
    return [tail, tail2];
  },
  mount(c, F) {
    const P = this.trunkPod(c, c._trunk.tip);
    const B = this.bellyPod(c, F.spine, 0, -1.15, -0.3);
    return {
      gunR: null, gunL: null,
      muzzles: { light: { n: P.muz, r: 0.05 }, heavy: { n: B.muz, r: 0.1 } },
      lightGlowM: [P.muz], heavyGlowM: [B.muz], heavyPivot: [],
      weap: { light: 'N', heavy: 'N' },
      hvy: { chest: 0.02 },
      aimPose: null,
      wpn: { light: { nodes: [P.g], ref: P.g, muz: P.muz, fwd: '-z' },
        heavy: { nodes: [B.g], ref: B.g, muz: B.muz, fwd: 'z' } },
    };
  },
};
