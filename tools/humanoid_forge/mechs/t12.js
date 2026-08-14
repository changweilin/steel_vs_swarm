// ============ t12 逐機零件檔(自 forge.js MECH_DETAIL 拆出;dev-only)============
// // ── t12「巨兵」訊號掃描機(colossus):圓角大頭雙圓眼、米其林疊節、眉心砲、天線叢 ──
// 2D 定案圖:public/assets/cyberpunk_art/mechs/t12_static.jpg
// 幾何語彙一律取自 ../geo.js(多面體字母表);MUST NOT 在本檔自建 BufferGeometry。
// t12 的拼字 =「圓角」:圓角矩形稜柱(rrect × prismF)+ 楔台收分 + 旋成體圓頂/疊環。
// 多零件紀律:天線叢一根一零件(mastF)、腹節一節一零件、前臂疊環一環一零件(ringF)。
import * as THREE from 'three';
import {
  matF, dimF, bxF, cylF, sphF, coneF, torusF, tboxF, prismF, latheF, finF, fanF, chainF, cablesF,
  hydCyl, sinew, seg2, IRON, GUNMETAL, COAL, INK, BONE, BRASS,
} from '../geo.js';

// ---- t12 專用拼字助手(全部由 geo.js 字母組成;零亂數)----------------------
/** 圓角矩形輪廓(prismF 用):w×h、圓角半徑 r、每角 k+1 點(k=1 ⇒ 八邊形,k=2 ⇒ 12 邊)。 */
const rrect = (w, h, r, k = 2) => {
  const pts = [];
  const cs = [
    [w / 2 - r, h / 2 - r, 0], [-w / 2 + r, h / 2 - r, Math.PI / 2],
    [-w / 2 + r, -h / 2 + r, Math.PI], [w / 2 - r, -h / 2 + r, -Math.PI / 2],
  ];
  for (const [cx, cy, a0] of cs)
    for (let i = 0; i <= k; i++) {
      const a = a0 + (Math.PI / 2) * (i / k);
      pts.push([cx + r * Math.cos(a), cy + r * Math.sin(a)]);
    }
  return pts;
};
/** 桶形疊環(旋成體;前臂/腕/踝「一環一零件」的單位環)。 */
function ringF(p, r, h, x, y, z, color, opts) {
  return latheF(p, [[r * 0.78, -h / 2], [r, -h * 0.2], [r, h * 0.2], [r * 0.78, h / 2]], 10, x, y, z, color, opts ?? { metalness: 0.6 });
}
/** 側向軸盤(旋成體階梯盤,面朝 ±x;膝軸/髖軸/踝軸的同心圓)。 */
function axleF(p, r, x, y, z, sx, color) {
  const d = latheF(p, [[r * 0.35, 0], [r, r * 0.16], [r, r * 0.5], [r * 0.66, r * 0.72], [r * 0.3, r * 0.86]], 10, x, y, z, color, { metalness: 0.8 });
  d.rotation.z = -sx * Math.PI / 2;                                            // +y → 外側 ±x
  return d;
}
/** 鉚釘盤(面朝 +z;2D 圖上裝甲板四角的圓螺絲)。 */
const boltF = (p, x, y, z) => {
  const b = cylF(p, 0.045, 0.045, 0.03, 6, x, y, z, IRON, { metalness: 0.85 });
  b.rotation.x = Math.PI / 2;
  return b;
};
/** 山形紋章(單件稜柱 V 板;肩甲/胸甲的深色識別紋)。 */
const chevF = (p, s, x, y, z, color) =>
  prismF(p, [[-0.2 * s, 0.02 * s], [0, -0.12 * s], [0.2 * s, 0.02 * s], [0.2 * s, 0.14 * s], [0, 0], [-0.2 * s, 0.14 * s]], 0.03, x, y, z, color);
/** 天線鞭(一根一零件):細鞭桿+基座束環+梢端三式(0 配重球/1 碟形帽/2 節點筒/3 球+雙節環)。 */
function mastF(p, [x, y, z, L, lz, lx, tip], PAL) {
  const g = new THREE.Group();
  g.position.set(x, y, z);
  g.rotation.set(lx, 0, lz);
  p.add(g);
  cylF(g, 0.016, 0.026, L, 5, 0, L / 2, 0, IRON, { metalness: 0.85 });
  latheF(g, [[0.055, 0], [0.062, 0.04], [0.045, 0.09], [0.028, 0.13]], 8, 0, 0, 0, PAL.deep, { metalness: 0.7 });
  if (tip === 1) latheF(g, [[0.012, 0], [0.078, 0.014], [0.078, 0.032], [0.02, 0.052]], 8, 0, L - 0.01, 0, PAL.mid, { metalness: 0.6 });
  else if (tip === 2) cylF(g, 0.032, 0.032, 0.1, 6, 0, L - 0.03, 0, PAL.deep, { metalness: 0.7 });
  else sphF(g, 0.038, 0, L + 0.01, 0, PAL.deep, { metalness: 0.6 });
  if (tip === 3) for (const t of [0.34, 0.6]) ringF(g, 0.05, 0.05, 0, L * t, 0, PAL.deep, { metalness: 0.8 });
  return g;
}

export default {
  label: '巨兵(t12 訊號掃描機)',
  prop: { hips: 0.44, legSplay: 0.1, thigh: 0.41, shin: 0.37, shoulderY: 0.82, shoulderX: 0.22, upperArm: 0.16, foreArm: 0.19, head: 0.95, girth: 1.25 },
  gait: { strideF: 1.55, bob: 0.13, sway: 0.1, top: 8, armBase: 0.08 },
  moveSig: { poise: 0.2, idleF: 0.7, idleA: 0.85, launch: 0.15, spool: 0.4, brake: 0.3, settle: 1.4 },
  castSig: { omni: 'dance', dir: 'jab' },
  doc: [
    ['head', '圓角矩形稜柱大頭(16 邊圓角輪廓+前傾)+雙層圓角臉板:雙圓眼(旋成眼眶環)+眉心砲白燈+耳盤+側排氣柵'],
    ['antenna', '天線叢一根一零件:頭頂 7 根+背艙 3 根+雙肩 2 根不等長細鞭(基座束環;配重球/碟形帽/節點筒/疊節環四式)+左頂無線電匣'],
    ['chest', '圓角稜柱上胸殼+四鉚前板+山形紋章+縱列三光點+米其林橫置腹節 ×3(一節一零件,附淺色嵌板)+腰側軸栓+背部訊號艙+小碟'],
    ['hips', '橫置膠囊骨盆(旋成體橫放)+大直徑平端腰環+半埋髖軸盤+四鉚圓角胯板'],
    ['leg ×2', '圓角稜柱腿殼(斜紋識別條)+圓角方膝甲+側膝軸盤+圓角疊節脛 ×3+踝軸盤+圓膠鞋足(旋成圓頭+斜跨帶+三趾板)'],
    ['arm ×2', '旋成半球圓肩(雙山形紋+肩頂天線)+腋下軸環 ×2+圓角上臂節+疊環前臂(旋成環 ×4 由粗到細)+腕口束環'],
    ['hand L', 'RF 測向環(靜態微光,不進戰鬥 glow)+三根圓角兩節長指'],
    ['hand R', '掃描脈衝槍:圓角楔台機匣+喇叭聚束座+細圓錐射束管(旋成)+聚焦環 ×2+管口光球;重武器=眉心標定砲(機載)'],
  ],
  head(c, h) {
    const { PAL, accent, G } = c;
    const hd = new THREE.Group();                                              // 前傾殼組(功能節點留 h,不隨傾)
    hd.rotation.x = 0.06;
    h.add(hd);
    prismF(hd, rrect(0.72 * G, 0.9, 0.21, 3), 0.62, 0, 0.2, -0.02, PAL.main, { metalness: 0.55 });  // 圓角矩形巨頭殼(2D:頭近軀幹寬;不加 bevel — 焊接描邊殼會在臉上亂竄)
    prismF(hd, rrect(0.64 * G, 0.74, 0.18, 2), 0.06, 0, 0.2, 0.32, PAL.mid, { metalness: 0.55 });   // 臉板外框
    prismF(hd, rrect(0.56 * G, 0.64, 0.16, 2), 0.07, 0, 0.2, 0.35, PAL.lite, { metalness: 0.5 });   // 第二層圓角臉板
    latheF(hd, [[0.22, -0.42], [0.19, -0.3], [0.16, -0.2], [0.15, -0.1]], 10, 0, 0, 0, PAL.deep, { metalness: 0.7 });  // 短頸柱(上細下粗,旋成)
    // 眉心標定砲 = 額頭白燈(heavy muzzle 契約:c.browCannon;砲口 MUST 凸出燈座環)
    const lampRim = latheF(h, [[0.085, 0], [0.13, 0.02], [0.13, 0.045], [0.095, 0.055]], 12, 0, 0.52, 0.36, PAL.deep, { metalness: 0.7 });
    lampRim.rotation.x = Math.PI / 2;                                          // 燈座環(面朝 +z)
    const lampBk = cylF(h, 0.12, 0.12, 0.02, 12, 0, 0.52, 0.355, PAL.lite, { metalness: 0.5 });
    lampBk.rotation.x = Math.PI / 2;                                           // 白色燈碗底
    const brow = cylF(h, 0.075, 0.075, 0.06, 10, 0, 0.52, 0.42, accent, { emissive: accent, emissiveIntensity: 1.4 });
    brow.rotation.x = Math.PI / 2;                                             // 眉心砲口(全機最亮)
    c.browCannon = brow;
    for (const sx of [-1, 1]) {
      sphF(h, 0.125, sx * 0.17 * G, 0.2, 0.34, accent, { emissive: accent, emissiveIntensity: 0.9 });  // 雙大圓眼(柔光)
      const rim = latheF(h, [[0.13, 0], [0.17, 0.018], [0.17, 0.05], [0.135, 0.065]], 12, sx * 0.17 * G, 0.2, 0.35, PAL.deep, { metalness: 0.7 });
      rim.rotation.x = Math.PI / 2;                                            // 眼眶環(旋成)
      const ear = latheF(hd, [[0.06, 0], [0.14, 0.025], [0.155, 0.06], [0.12, 0.095], [0.05, 0.12]], 10, sx * (0.36 * G + 0.01), 0.22, 0, PAL.deep, { metalness: 0.65 });
      ear.rotation.z = -sx * Math.PI / 2;                                      // 耳盤(Laputa 收音孔,階梯盤)
    }
    tboxF(hd, { w0: 0.24, d0: 0.05, w1: 0.18, d1: 0.05, h: 0.07 }, 0, -0.06, 0.39, COAL, { metalness: 0.5 });  // 小嘴縫(梯形)
    // 右側排氣柵(2D 圖頭側深色柵板)
    tboxF(hd, { w0: 0.05, d0: 0.22, w1: 0.05, d1: 0.18, h: 0.34 }, 0.36 * G + 0.03, 0.36, 0.04, PAL.mid, { metalness: 0.6 });
    for (let i = 0; i < 3; i++) bxF(hd, 0.02, 0.28, 0.034, 0.36 * G + 0.055, 0.36, -0.02 + i * 0.055, COAL);
    // 左頂無線電匣(小方匣+短桅+發光面板)
    cylF(hd, 0.018, 0.022, 0.2, 5, -0.32, 0.72, -0.08, IRON, { metalness: 0.85 });
    const rbox = bxF(hd, 0.17, 0.11, 0.08, -0.32, 0.85, -0.08, PAL.mid, { metalness: 0.6 });
    rbox.rotation.y = 0.35;
    const rpl = bxF(hd, 0.11, 0.055, 0.012, -0.305, 0.85, -0.038, dimF(accent, 0.7), { emissive: accent, emissiveIntensity: 0.4 });
    rpl.rotation.y = 0.35;
    // 頭頂後緣天線叢:7 根不等長細鞭(一根一零件;第 4 根 = 粗節疊環式;整叢後收)
    const MASTS = [
      [-0.34, 0.56, -0.2, 0.55, 0.30, -0.14, 0],
      [-0.18, 0.62, -0.24, 0.90, 0.14, -0.16, 0],
      [-0.02, 0.64, -0.28, 0.62, 0.02, -0.26, 2],
      [0.12, 0.62, -0.22, 1.00, -0.10, -0.14, 3],
      [0.24, 0.58, -0.28, 0.72, -0.22, -0.3, 1],
      [0.36, 0.5, -0.22, 0.85, -0.34, -0.2, 0],
      [0.4, 0.42, -0.3, 0.55, -0.46, -0.34, 2],
    ];
    for (const m of MASTS) mastF(hd, m, PAL);
  },
  chest(c, ch, d) {
    const { PAL, accent, G } = c;
    const top = d.shoulderY, bot = d.waistY;
    const W = d.shoulderX * 1.5;
    prismF(ch, rrect(W, 1.15, 0.28, 2), 1.0 * G, 0, top - 0.2, 0, PAL.main, { metalness: 0.55 });  // 圓角稜柱上胸殼(不加 bevel,同頭殼理由)
    latheF(ch, [[0.36, 0], [0.45, 0.04], [0.45, 0.12], [0.35, 0.16]], 12, 0, top + 0.3, 0.04, PAL.deep, { metalness: 0.7 });   // 頸座環(頭半沉進殼)
    // 前胸圓角板(第二層)+ 四角鉚釘 + 右上山形紋章 + 縱列三光點紋章
    prismF(ch, rrect(W * 0.72, 0.8, 0.2, 2), 0.12, 0, top - 0.2, 0.5 * G + 0.05, PAL.lite, { metalness: 0.5 });
    for (const sx of [-1, 1]) for (const sy of [-1, 1]) boltF(ch, sx * (W * 0.36 - 0.14), top - 0.2 + sy * 0.28, 0.5 * G + 0.12);
    const em = chevF(ch, 1.0, W * 0.22, top - 0.02, 0.5 * G + 0.12, PAL.deep);
    em.rotation.z = -0.25;
    for (let i = 0; i < 3; i++)
      cylF(ch, 0.05, 0.05, 0.03, 10, 0, top - 0.0 - i * 0.24, 0.5 * G + 0.13, accent, { emissive: accent, emissiveIntensity: 1.2 }).rotation.x = Math.PI / 2;
    // 米其林式橫置腹節 ×3(一節一零件,由寬到窄)+ 各節淺色嵌板
    const bands = [
      { w: W * 0.82, h: 0.36, y: top - 0.98, dep: 0.92 * G },
      { w: W * 0.74, h: 0.34, y: top - 1.36, dep: 0.84 * G },
      { w: W * 0.66, h: 0.32, y: top - 1.71, dep: 0.76 * G },
    ];
    for (const b of bands) {
      prismF(ch, rrect(b.w, b.h, 0.13, 2), b.dep, 0, b.y, 0, PAL.main, { metalness: 0.55 });
      prismF(ch, rrect(b.w * 0.66, b.h * 0.52, 0.08, 1), 0.06, 0, b.y + 0.03, b.dep / 2 + 0.02, PAL.lite, { metalness: 0.5 });
    }
    for (const sx of [-1, 1]) {                                                // 腰側關節塊+外側軸栓盤
      tboxF(ch, { w0: 0.26, d0: 0.52, w1: 0.2, d1: 0.44, h: 0.52 }, sx * (W * 0.4 + 0.06), top - 1.2, 0, PAL.deep, { metalness: 0.65 });
      axleF(ch, 0.12, sx * (W * 0.4 + 0.14), top - 1.2, 0.02, sx, COAL);
    }
    // 背部訊號處理艙:楔台艙體+後向小碟+3 根天線鞭(一根一零件)
    const podZ = -0.5 * G - 0.06;
    tboxF(ch, { w0: 0.72, d0: 0.42, w1: 0.62, d1: 0.34, h: 0.5 }, 0.14, top - 0.02, podZ, PAL.mid, { metalness: 0.6 });
    const dish = latheF(ch, [[0.02, 0], [0.14, 0.02], [0.18, 0.07], [0.19, 0.12]], 10, -0.16, top + 0.06, podZ - 0.08, PAL.deep, { metalness: 0.7 });
    dish.rotation.x = -1.9;                                                    // 小碟朝後上
    for (const m of [[0.0, top + 0.2, podZ, 0.7, 0.12, -0.12, 0], [0.18, top + 0.22, podZ + 0.06, 0.95, -0.1, -0.2, 1], [0.32, top + 0.16, podZ - 0.04, 0.55, -0.26, -0.1, 2]])
      mastF(ch, m, PAL);
  },
  pelvis(c, hips, d) {
    const { PAL, G } = c;
    const cap = latheF(hips, [[0.001, -0.5 * G], [0.18, -0.46 * G], [0.28, -0.36 * G], [0.32, -0.18 * G], [0.32, 0.18 * G], [0.28, 0.36 * G], [0.18, 0.46 * G], [0.001, 0.5 * G]], 10, 0, 0, 0, PAL.deep, { metalness: 0.6 });
    cap.rotation.z = Math.PI / 2;                                              // 橫置膠囊骨盆(旋成體橫放)
    latheF(hips, [[0.42, 0.1], [0.48, 0.16], [0.48, 0.32], [0.38, 0.38]], 12, 0, 0, 0, PAL.mid, { metalness: 0.7 });  // 大直徑平端腰環(封腹節縫)
    for (const sx of [-1, 1]) axleF(hips, 0.15, sx * 0.44 * G, -0.05, 0, sx, COAL);  // 半埋髖軸盤
    prismF(hips, rrect(0.38 * G, 0.32, 0.1, 2), 0.1, 0, -0.1, 0.32 * G, PAL.mid, { metalness: 0.55 });  // 胯前圓角護板
    boltF(hips, -0.1, -0.04, 0.3 * G + 0.06);
    boltF(hips, 0.1, -0.04, 0.3 * G + 0.06);
    tboxF(hips, { w0: 0.4 * G, d0: 0.16, w1: 0.34 * G, d1: 0.12, h: 0.26 }, 0, -0.06, -0.3 * G, PAL.mid, { metalness: 0.55 });  // 尾板
  },
  thigh(c, l, d) {
    const { PAL, G, sx } = c;
    prismF(l, rrect(0.46 * G, d.len * 1.04, 0.16, 2), 0.48 * G, 0, -d.len / 2, 0.01, PAL.main, { metalness: 0.55 });  // 圓角稜柱腿殼
    for (const [yy, s] of [[-d.len * 0.42, 0.24], [-d.len * 0.56, 0.2]]) {
      const st = bxF(l, 0.05, s, 0.02, sx * 0.1 * G, yy, 0.22 * G + 0.03, PAL.deep);
      st.rotation.z = sx * 0.7;                                                // 斜紋識別條 ×2(2D 大腿深色斜杠)
    }
    const ka = ringF(l, 0.15, 0.22, 0, -d.len * 0.98, 0, COAL, { metalness: 0.8 });
    ka.rotation.z = Math.PI / 2;                                               // 膝軸橫環
  },
  shin(c, l, d) {
    const { PAL, G, sx } = c;
    const pad = prismF(l, rrect(0.36 * G, 0.4, 0.11, 2), 0.16, 0, -0.04, 0.2 * G + 0.02, PAL.lite, { metalness: 0.5 });
    pad.rotation.x = -0.1;                                                     // 圓角方膝甲(略前傾)
    boltF(l, -0.12, 0.06, 0.2 * G + 0.12);
    boltF(l, 0.12, 0.06, 0.2 * G + 0.12);
    axleF(l, 0.13, sx * 0.18 * G, -0.06, 0.02, sx, COAL);                      // 側膝軸盤(同心圓)
    const bands = [                                                            // 圓角疊節脛 ×3(一節一零件,由粗到細)
      { w: 0.4 * G, h: d.len * 0.34, y: -d.len * 0.28, dep: 0.44 * G, col: PAL.main },
      { w: 0.37 * G, h: d.len * 0.32, y: -d.len * 0.60, dep: 0.41 * G, col: PAL.mid },
      { w: 0.34 * G, h: d.len * 0.28, y: -d.len * 0.88, dep: 0.38 * G, col: PAL.main },
    ];
    for (const b of bands) prismF(l, rrect(b.w, b.h, 0.1, 2), b.dep, 0, b.y, 0.01, b.col, { metalness: 0.55 });
    axleF(l, 0.09, sx * 0.16 * G, -d.len * 0.97, 0.02, sx, COAL);              // 踝軸盤
  },
  foot(c, l, d) {
    const { PAL, G } = c;
    ringF(l, 0.17 * G, 0.16, 0, -d.clear * 0.25, 0, PAL.mid);                  // 踝口束環
    tboxF(l, { w0: 0.54, d0: d.footL * 1.02, w1: 0.46, d1: d.footL * 0.88, h: 0.15 }, 0, -d.clear + 0.1, d.footL * 0.12, PAL.main, { metalness: 0.5 });  // 圓角鞋底台
    const toe = latheF(l, [[0.23, 0], [0.22, 0.06], [0.18, 0.14], [0.1, 0.2], [0.001, 0.23]], 10, 0, -d.clear + 0.16, d.footL * 0.36, PAL.lite, { metalness: 0.5 });
    toe.scale.z = 1.3;                                                         // 圓膠鞋圓頭(旋成圓頂,前後拉長)
    const strap = tboxF(l, { w0: 0.5, d0: 0.2, w1: 0.46, d1: 0.16, h: 0.09 }, 0, -d.clear + 0.38, d.footL * 0.28, PAL.deep, { metalness: 0.6 });
    strap.rotation.x = -0.55;                                                  // 斜跨帶(涼鞋扣帶,搭在圓頭上)
    tboxF(l, { w0: 0.42, d0: 0.26, w1: 0.36, d1: 0.2, h: 0.2 }, 0, -d.clear + 0.22, -d.footL * 0.2, PAL.mid, { metalness: 0.55 });  // 後跟塊
    for (const ox of [-0.15, 0, 0.15])
      tboxF(l, { w0: 0.13, d0: 0.16, w1: 0.11, d1: 0.12, h: 0.1 }, ox, -d.clear + 0.1, d.footL * 0.6, PAL.mid, { metalness: 0.5 });  // 三枚圓角趾板
  },
  armUp(c, a, d) {
    const { PAL, G, sx } = c;
    latheF(a, [[0.44 * G, -0.05], [0.44 * G, 0.06], [0.4 * G, 0.17], [0.34 * G, 0.28], [0.24 * G, 0.37], [0.13 * G, 0.43], [0.001, 0.46]], 12, sx * 0.1, 0.1, 0, PAL.main, { metalness: 0.55 });  // 大半球圓肩甲(旋成圓頂;2D 巨球肩)
    latheF(a, [[0.38 * G, -0.02], [0.45 * G, 0.02], [0.45 * G, 0.09], [0.37 * G, 0.14]], 12, sx * 0.1, -0.08, 0, PAL.mid, { metalness: 0.6 });  // 肩甲基環
    const v1 = chevF(a, 1.1, sx * 0.18 * G, 0.34, 0.37 * G, PAL.deep);
    v1.rotation.set(-0.45, sx * 0.3, 0);
    const v2 = chevF(a, 0.8, sx * 0.28 * G, 0.18, 0.4 * G, PAL.deep);
    v2.rotation.set(-0.2, sx * 0.35, 0);                                       // 肩甲雙山形紋(貼圓頂前外側)
    mastF(a, [sx * 0.24 * G, 0.42, -0.1, 0.55, sx * 0.35, -0.06, 0], PAL);     // 肩頂天線鞭
    ringF(a, 0.2 * G, 0.1, 0, -0.16, 0, PAL.deep, { metalness: 0.8 });         // 腋下軸環 ×2(2D 腋下疊環)
    ringF(a, 0.18 * G, 0.1, 0, -0.28, 0, PAL.deep, { metalness: 0.8 });
    prismF(a, rrect(0.32 * G, d.len * 0.55, 0.12, 2), 0.32 * G, 0, -d.len * 0.64, 0.01, PAL.main, { metalness: 0.55 });  // 上臂圓角短節
  },
  armFore(c, a, d) {
    const { PAL, G } = c;
    const rs = [0.27, 0.31, 0.29, 0.25];                                       // 疊環由肘到腕:先鼓後收(2D 前臂剖面)
    const ys = [0.1, 0.33, 0.56, 0.79];
    for (let i = 0; i < 4; i++)
      ringF(a, rs[i] * G, d.len * 0.26, 0, -d.len * ys[i], 0.01, i % 2 ? PAL.mid : PAL.main, { metalness: 0.55 });  // 一環一零件 ×4
    ringF(a, 0.2 * G, d.len * 0.12, 0, -d.len * 0.95, 0.01, PAL.deep, { metalness: 0.75 });  // 腕口束環
  },
  mount(c, F) {
    const { PAL, accent, G, K } = c;
    // 掌 + 三根圓角兩節長指(兩手同構;楔台收分,末節內曲;2D 厚手套感)
    for (const hand of [F.handL, F.handR]) {
      tboxF(hand, { w0: 0.38, d0: 0.32, w1: 0.32, d1: 0.28, h: 0.3 }, 0, -0.17, 0.02, PAL.main, { metalness: 0.55 });
      for (const ox of [-0.12, 0, 0.12]) {
        const p1 = tboxF(hand, { w0: 0.11, d0: 0.13, w1: 0.1, d1: 0.12, h: 0.28 }, ox, -0.44, 0.05, PAL.mid, { metalness: 0.55 });
        p1.rotation.x = 0.12;
        const p2 = tboxF(hand, { w0: 0.1, d0: 0.12, w1: 0.08, d1: 0.09, h: 0.22 }, ox, -0.62, 0.12, PAL.mid, { metalness: 0.55 });
        p2.rotation.x = 0.55;
      }
    }
    // 左腕 RF 測向環(靜態微光,MUST NOT 進戰鬥 glow)
    ringF(F.handL, 0.19, 0.1, 0, -0.02, 0, PAL.deep, { metalness: 0.8 });
    cylF(F.handL, 0.195, 0.195, 0.03, 12, 0, -0.02, 0, accent, { emissive: accent, emissiveIntensity: 0.6 });
    cylF(F.handR, 0.05, 0.05, 0.02, 8, 0, -0.12, 0.15, accent, { emissive: accent, emissiveIntensity: 1.0 }).rotation.x = Math.PI / 2;  // 右掌心測向器
    // 右手掃描脈衝槍(輕武器):對照 2D 圓角語彙逐件組
    const gr = new THREE.Group();
    gr.position.set(0.14, -0.22, 0.2);
    gr.rotation.set(1.4, 0, 0.1);
    F.handR.add(gr);
    const BL = 0.85 * K.barrelF;
    tboxF(gr, { w0: 0.26, d0: 0.3, w1: 0.2, d1: 0.24, h: 0.6 }, 0, 0.1, 0, PAL.main, { metalness: 0.55 });  // 圓角楔台機匣(上收分)
    prismF(gr, rrect(0.18, 0.4, 0.06, 1), 0.05, 0, 0.12, 0.14, PAL.lite, { metalness: 0.5 });  // 機匣淺色嵌板
    const grip = tboxF(gr, { w0: 0.1, d0: 0.16, w1: 0.09, d1: 0.13, h: 0.24 }, 0, -0.2, -0.17, PAL.deep, { metalness: 0.6 });
    grip.rotation.x = 0.3;                                                     // 圓角握把
    latheF(gr, [[0.05, 0], [0.12, 0.05], [0.16, 0.12], [0.17, 0.18]], 10, 0, 0.36, 0, PAL.mid, { metalness: 0.65 });  // 喇叭聚束座(訊號號角,開口朝管)
    latheF(gr, [[0.062, 0], [0.052, BL * 0.35], [0.045, BL * 0.7], [0.03, BL]], 8, 0, 0.42, 0, GUNMETAL, { metalness: 0.8 });  // 細圓錐射束管(旋成)
    for (const t of [0.32, 0.64])
      ringF(gr, 0.095, 0.07, 0, 0.42 + BL * t, 0, IRON, { metalness: 0.75 });  // 聚焦環 ×2
    const lMuz = sphF(gr, 0.065, 0, 0.48 + BL, 0, accent, { emissive: accent, emissiveIntensity: 1.0 });  // 管口光球
    bxF(gr, 0.08, 0.05, 0.12, 0, 0.42, -0.16, dimF(accent, 0.5));              // 照門
    return {
      gunR: { g: gr, rest: 1.4, aim: 2.72 }, gunL: null,                       // aim = 1.57 − (−0.8 − 0.35)
      muzzles: { light: { n: lMuz, r: 0.07 }, heavy: { n: c.browCannon, r: 0.05 } },
      lightGlowM: [lMuz], heavyGlowM: [c.browCannon], heavyPivot: [],
      weap: { light: 'R', heavy: 'N' },                                        // 重武器 = 眉心砲(機載)
      hvy: { chest: 0.04, gun: 0.04 },
      aimPose: { rShoulderX: -0.8, rElbowX: -0.35 },                           // 單手托一把,左臂自由
      wpn: { light: { nodes: [gr], ref: gr, muz: lMuz, fwd: 'y' }, heavy: { nodes: [c.browCannon], ref: c.browCannon, muz: c.browCannon, fwd: 'z' } },
    };
  },
};
