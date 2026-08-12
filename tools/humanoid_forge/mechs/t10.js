// ============ t10 逐機零件檔(自 forge.js MECH_DETAIL 拆出;dev-only)============
// // ── t10「軌跡」攔截機甲(aegis):塔盾+腕部加特林+雙肩 VLS+雙雷達,關節語彙 =「藏」──
// 2D 定案圖:public/assets/cyberpunk_art/mechs/t10_static.jpg
// 幾何語彙一律取自 ../geo.js(多面體字母表);MUST NOT 在本檔自建 BufferGeometry。
// 2026-08-12 多面體改寫(對照 2D 圖):
//   胸口 = 八角倒角大胸板(prismF)+ 六角腹甲;塔盾 = 三段疊層面板(一片一稜柱)+ 鉚釘列;
//   右手 = 六管加特林(2D 是六管旋轉機砲,不是雙聯管)+ 波紋鼓前臂(latheF 環疊);
//   腿 = 六角護脛/大腿板(prismF)+ 疊層膝甲(tboxF)+ 膝側樞軸螺栓;靴 = 厚底楔台。
import * as THREE from 'three';
import {
  matF, dimF, bxF, cylF, sphF, coneF, torusF, tboxF, prismF, latheF, finF, fanF, chainF, cablesF,
  hydCyl, sinew, seg2, IRON, GUNMETAL, COAL, INK, BONE, BRASS,
} from '../geo.js';

// 拉長七邊形(尖端朝下)—— 大腿板/護脛板共用輪廓(2D 的六角面板,底部收尖)
const legPanelPts = (hw, hl) => [
  [-hw * 0.7, hl], [-hw, hl * 0.45], [-hw * 0.85, -hl * 0.7], [0, -hl],
  [hw * 0.85, -hl * 0.7], [hw, hl * 0.45], [hw * 0.7, hl],
];
// 圓角矩形(切角八邊形)—— 塔盾三段面板共用輪廓
const panelPts = (w, h, c) => [
  [-w / 2 + c, -h / 2], [w / 2 - c, -h / 2], [w / 2, -h / 2 + c], [w / 2, h / 2 - c],
  [w / 2 - c, h / 2], [-w / 2 + c, h / 2], [-w / 2, h / 2 - c], [-w / 2, -h / 2 + c],
];

export default {
  label: '軌跡(t10 攔截機甲)', hue: 0x7fe8c9,
  prop: { hips: 0.52, legSplay: 0.1, thigh: 0.48, shin: 0.46, shoulderY: 0.85, shoulderX: 0.18, upperArm: 0.14, foreArm: 0.16, head: 0.93, girth: 1.1 },
  gait: { strideF: 1.4, bob: 0.12, sway: 0.09, top: 7.5, armBase: 0.1 },
  moveSig: { poise: 0.58, idleF: 0.82, idleA: 1.05, launch: 0.2, spool: 0.58, brake: 0.52, settle: 1.05 },
  castSig: { omni: 'stomp', dir: 'jab' },
  doc: [
    ['head', '楔台小盔+旋成穹頂+遮光簷+梯形面甲(稜柱)+側耳雷達盤(旋成體)'],
    ['chest', '八角倒角大胸板(稜柱+角落鉚釘)+六角腹甲+腋側進氣柵+斜仰相控陣+背部追蹤雷達盤'],
    ['hips', '楔台骨盆+雙層 V 形襠甲(稜柱疊層)+側裙板'],
    ['leg ×2', '樁腿:六角大腿板/護脛板(稜柱)+疊層膝甲(楔台)+膝側樞軸螺栓+攔截彈匣筒'],
    ['arm ×2', '倒角方肩楔台+外緣邊簷;波紋鼓前臂(旋成環疊)+肘腕關節環'],
    ['hand L', '三段疊層塔盾:一片一稜柱+鉚釘列+觀察窗縫+折邊側條+頂簷+接地齒'],
    ['hand R', '六管加特林:後轉子鼓+六管環列+中束環+前束板(旋成體)+側彈藥箱+供彈纜束;肩 VLS 2×3 斜置發射箱'],
  ],
  head(c, h) {
    const { PAL, accent, G } = c;
    // 主盔 = 楔台(往頂收分)+ 旋成體圓穹頂,取代舊制方盒
    tboxF(h, { w0: 0.38 * G, d0: 0.4, w1: 0.32 * G, d1: 0.34, h: 0.3, sz: -0.02 }, 0, 0.05, 0, PAL.mid, { metalness: 0.6 });
    latheF(h, [[0.145, 0], [0.13, 0.04], [0.09, 0.08], [0.02, 0.1]], 10, 0, 0.19, -0.01, PAL.main, { metalness: 0.6 });
    tboxF(h, { w0: 0.34 * G, d0: 0.14, w1: 0.3 * G, d1: 0.1, h: 0.05, sz: 0.03 }, 0, 0.185, 0.16, PAL.main);   // 前額遮光簷
    bxF(h, 0.12, 0.06, 0.05, 0, 0.15, 0.19, PAL.deep, { metalness: 0.7 });        // 前額感測塊
    bxF(h, 0.06, 0.03, 0.02, 0, 0.15, 0.22, accent, { emissive: accent, emissiveIntensity: 1.2 });
    // 梯形面甲(稜柱)+ 暗色目視帶 + 雙感測窗 + 鼻樑肋 + 楔形下顎
    prismF(h, [[-0.15 * G, -0.08], [0.15 * G, -0.08], [0.12 * G, 0.09], [-0.12 * G, 0.09]], 0.06, 0, 0.03, 0.19, PAL.main, { metalness: 0.6 });
    bxF(h, 0.24 * G, 0.06, 0.03, 0, 0.09, 0.215, INK, { metalness: 0.7 });        // 目視帶
    for (const sx of [-1, 1])
      bxF(h, 0.055, 0.04, 0.02, sx * 0.07 * G, 0.09, 0.23, accent, { emissive: accent, emissiveIntensity: 1.6 });  // 雙感測窗
    bxF(h, 0.045, 0.13, 0.045, 0, 0.0, 0.235, PAL.mid);                           // T 形鼻樑肋
    tboxF(h, { w0: 0.15, d0: 0.13, w1: 0.2, d1: 0.19, h: 0.11, sz: -0.03 }, 0, -0.1, 0.14, PAL.main, { metalness: 0.6 });  // 楔形下顎
    for (const sx of [-1, 1]) {
      bxF(h, 0.05, 0.1, 0.05, sx * 0.14 * G, -0.03, 0.19, PAL.deep);              // 頰側通氣柵
      // 側耳雷達盤 = 碟形旋成體(軸轉向 ±x)
      const ear = latheF(h, [[0.02, 0], [0.095, 0], [0.105, 0.02], [0.08, 0.045], [0.03, 0.055]], 10, sx * 0.21 * G, 0.05, 0, dimF(accent, 0.6), { emissive: accent, emissiveIntensity: 0.4 });
      ear.rotation.z = -sx * Math.PI / 2;
    }
    cylF(h, 0.1, 0.12, 0.12, 10, 0, -0.16, 0, COAL, { metalness: 0.8 });          // 頸關節
  },
  chest(c, ch, d) {
    const { PAL, accent, G } = c;
    const top = d.shoulderY, bot = d.waistY;
    // 軀幹核 = 楔台(肩寬腰窄,2D 的倒梯形剪影)
    tboxF(ch, { w0: d.shoulderX * 1.3, d0: 0.72 * G, w1: d.shoulderX * 1.5, d1: 0.85 * G, h: top - bot + 0.3 }, 0, (top + bot) / 2 + 0.1, 0, PAL.mid, { metalness: 0.6 });
    // 八角倒角大胸板(2D 正面那塊有邊框+角落鉚釘的六角大板)
    const plate = prismF(ch, [
      [-0.55, 0.6], [-0.72, 0.28], [-0.56, -0.32], [-0.32, -0.6],
      [0.32, -0.6], [0.56, -0.32], [0.72, 0.28], [0.55, 0.6],
    ], 0.1, 0, (top + bot) / 2 + 0.12, 0.46 * G, PAL.main, { metalness: 0.6, bevel: { t: 0.03, s: 0.03 } });
    for (const [rx, ry] of [[-0.56, 0.45], [0.56, 0.45], [-0.6, -0.2], [0.6, -0.2]])
      cylF(plate, 0.028, 0.028, 0.05, 6, rx, ry, 0.09, PAL.deep, { metalness: 0.8 }).rotation.x = Math.PI / 2;  // 角落鉚釘
    bxF(ch, 0.26, 0.05, 0.03, 0, (top + bot) / 2 + 0.5, 0.53 * G, accent, { emissive: accent, emissiveIntensity: 1.1 });  // 胸口識別縫
    for (const sx of [-1, 1])
      bxF(ch, 0.06, 0.06, 0.03, sx * 0.45, (top + bot) / 2 + 0.18, 0.52 * G, accent, { emissive: accent, emissiveIntensity: 0.8 });  // IFF 識別燈
    // 六角腹甲(第二層,略前凸)+ 暗色分節腰段
    prismF(ch, [[-0.2, 0.25], [-0.28, 0], [-0.2, -0.25], [0.2, -0.25], [0.28, 0], [0.2, 0.25]], 0.14, 0, bot - 0.05, 0.4 * G, PAL.main, { metalness: 0.6, bevel: { t: 0.02, s: 0.02 } });
    tboxF(ch, { w0: 0.5, d0: 0.42, w1: 0.58, d1: 0.5, h: 0.5 }, 0, bot - 0.28, 0, COAL, { metalness: 0.7 });
    // 領口座 + 腋側進氣柵(2D 頭側兩塊暗色柵板)
    tboxF(ch, { w0: 0.78, d0: 0.55, w1: 0.68, d1: 0.48, h: 0.16 }, 0, top + 0.08, 0.06, PAL.deep, { metalness: 0.7 });
    for (const sx of [-1, 1]) {
      bxF(ch, 0.18, 0.13, 0.08, sx * 0.34, top + 0.12, 0.3, PAL.deep, { metalness: 0.7 });
      for (const oz of [-0.04, 0.04])
        bxF(ch, 0.12, 0.025, 0.02, sx * 0.34, top + 0.12 + oz * 0.9, 0.345, INK); // 柵縫
    }
    // 斜仰相控陣搜索雷達(楔台薄板,靠在領口前)
    const arr = tboxF(ch, { w0: 0.52, d0: 0.07, w1: 0.44, d1: 0.06, h: 0.3 }, 0, top + 0.1, 0.42, PAL.deep, { metalness: 0.7 });
    arr.rotation.x = -0.5;
    for (let i = 0; i < 6; i++)
      bxF(arr, 0.07, 0.07, 0.02, -0.15 + (i % 3) * 0.15, i < 3 ? 0.07 : -0.07, 0.04, accent, { emissive: accent, emissiveIntensity: 0.6 });  // 收發單元
    // 背部追蹤雷達盤 = 碟形旋成體 + 發光盤面
    const trk = latheF(ch, [[0.03, 0], [0.2, 0], [0.24, 0.03], [0.2, 0.08], [0.05, 0.1]], 12, 0, top - 0.15, -0.55, PAL.deep, { metalness: 0.7 });
    trk.rotation.x = 1.05;
    const face = cylF(ch, 0.16, 0.16, 0.03, 12, 0, top - 0.09, -0.61, accent, { emissive: accent, emissiveIntensity: 0.5 });
    face.rotation.x = 1.05;
    // 雙肩 VLS 2×3 斜置發射箱(重武器):楔台箱體、管口朝天、往外傾(2D 的 /\ 姿態)。
    // 2D 的發射箱是全機第一大簽名件 —— 比頭大、高過頭頂,MUST 保持這個量級。
    for (const sx of [-1, 1]) {
      const vg = new THREE.Group();
      vg.position.set(sx * (d.shoulderX * 0.78), top + 0.5, -0.15);
      vg.rotation.set(-0.22, 0, -sx * 0.18);                                      // 管口朝上前(2D 看得到管面)
      ch.add(vg);
      tboxF(vg, { w0: 0.72, d0: 0.84, w1: 0.8, d1: 0.95, h: 0.62, sz: 0.03 }, 0, 0, 0, PAL.mid, { metalness: 0.6 });
      tboxF(vg, { w0: 0.74, d0: 0.9, w1: 0.68, d1: 0.84, h: 0.09 }, 0, 0.35, 0.015, PAL.deep, { metalness: 0.7 });  // 管口座板
      for (let i = 0; i < 6; i++) {
        const cx = (i % 2 === 0 ? -0.18 : 0.18), cz = (Math.floor(i / 2) - 1) * 0.28;
        cylF(vg, 0.115, 0.115, 0.1, 8, cx, 0.4, cz, COAL, { metalness: 0.8 });
        const port = cylF(vg, 0.09, 0.09, 0.06, 8, cx, 0.455, cz, accent, { emissive: accent, emissiveIntensity: 1.0 });
        c.vlsPorts.push(port);
      }
      for (const oz of [-0.14, 0.14])
        bxF(vg, 0.42, 0.025, 0.07, 0, 0.4, oz * 2.2, INK);                        // 管間橫縫
      for (const oz of [-0.24, 0.24])
        cylF(vg, 0.025, 0.025, 0.05, 6, sx * 0.42, 0.08, oz, PAL.deep, { metalness: 0.8 }).rotation.z = Math.PI / 2;  // 側面鉚釘
      for (const oz of [-0.2, 0.2])
        cylF(vg, 0.08, 0.08, 0.52, 8, sx * 0.47, -0.06, oz, GUNMETAL, { metalness: 0.8 }).rotation.x = 0.06;  // 再裝填彈筒
      tboxF(vg, { w0: 0.44, d0: 0.5, w1: 0.34, d1: 0.4, h: 0.28 }, 0, -0.44, 0.02, PAL.deep, { metalness: 0.7 });  // 基座
    }
  },
  pelvis(c, hips, d) {
    const { PAL, G } = c;
    // 骨盆核 = 楔台(上寬下收)
    tboxF(hips, { w0: 0.6 * G, d0: 0.5 * G, w1: 0.75 * G, d1: 0.6 * G, h: 0.4 }, 0, 0.02, 0, PAL.deep, { metalness: 0.6 });
    // 雙層 V 形襠甲(稜柱疊層,2D 中央兩塊楔板)
    const v1 = prismF(hips, [[-0.26, 0.22], [-0.22, -0.1], [0, -0.26], [0.22, -0.1], [0.26, 0.22]], 0.1, 0, -0.1, 0.3 * G, PAL.main, { metalness: 0.6 });
    v1.rotation.x = 0.16;
    const v2 = prismF(hips, [[-0.16, 0.13], [-0.13, -0.06], [0, -0.16], [0.13, -0.06], [0.16, 0.13]], 0.08, 0, -0.17, 0.3 * G + 0.08, PAL.mid, { metalness: 0.6 });
    v2.rotation.x = 0.16;
    for (const sx of [-1, 1]) {
      const sk = tboxF(hips, { w0: 0.16, d0: 0.4, w1: 0.2, d1: 0.46, h: 0.34 }, sx * 0.42 * G, -0.1, 0.05, PAL.main, { metalness: 0.6 });
      sk.rotation.z = -sx * 0.14;                                                 // 側裙板
    }
    tboxF(hips, { w0: 0.44 * G, d0: 0.1, w1: 0.5 * G, d1: 0.14, h: 0.26 }, 0, -0.1, -0.3 * G, PAL.mid);  // 後裙板
  },
  thigh(c, l, d) {
    const { PAL, G } = c;
    const ball = cylF(l, 0.17 * G, 0.17 * G, 0.26, 8, 0, 0.02, 0, PAL.deep, { metalness: 0.75 });
    ball.rotation.z = Math.PI / 2;                                                // 唯一外露的髖球關節
    // 大腿殼 = 楔台(髖端粗、膝端收);前面掛六角大腿板(稜柱)
    tboxF(l, { w0: 0.34 * G, d0: 0.38 * G, w1: 0.4 * G, d1: 0.44 * G, h: d.len * 1.02 }, 0, -d.len * 0.5, 0, PAL.mid, { metalness: 0.6 });
    prismF(l, legPanelPts(0.14 * G, d.len * 0.4), 0.07, 0, -d.len * 0.5, 0.2 * G, PAL.main, { metalness: 0.6, bevel: { t: 0.02, s: 0.02 } });
    tboxF(l, { w0: 0.15, d0: 0.3, w1: 0.17, d1: 0.36, h: d.len * 0.55 }, c.sx * 0.24 * G, -d.len * 0.5, 0, PAL.main);  // 大腿側裝甲板
  },
  shin(c, l, d) {
    const { PAL, G, sx } = c;
    // 膝側圓形樞軸螺栓 + 螺絲縫(2D 的大圓盤)
    const bolt = cylF(l, 0.11, 0.11, 0.06, 10, sx * 0.21 * G, -0.02, 0, COAL, { metalness: 0.85 });
    bolt.rotation.z = Math.PI / 2;
    bxF(l, 0.02, 0.04, 0.14, sx * (0.21 * G + 0.032), -0.02, 0, INK);
    // 疊層膝甲(兩層楔台,上大下小)
    tboxF(l, { w0: 0.36 * G, d0: 0.14, w1: 0.28 * G, d1: 0.1, h: 0.24, sz: 0.05 }, 0, 0.02, 0.2 * G, PAL.main, { metalness: 0.6 });
    tboxF(l, { w0: 0.3 * G, d0: 0.1, w1: 0.24 * G, d1: 0.08, h: 0.16, sz: 0.03 }, 0, -0.2, 0.22 * G, PAL.mid, { metalness: 0.6 });
    // 脛殼 = 楔台(踝端收分);前面掛六角護脛板(稜柱,盾線步兵)
    tboxF(l, { w0: 0.26 * G, d0: 0.32 * G, w1: 0.36 * G, d1: 0.42 * G, h: d.len }, 0, -d.len * 0.5, -0.01, PAL.mid, { metalness: 0.6 });
    prismF(l, legPanelPts(0.13 * G, d.len * 0.38), 0.07, 0, -d.len * 0.52, 0.2 * G, PAL.main, { metalness: 0.6, bevel: { t: 0.02, s: 0.02 } });
    tboxF(l, { w0: 0.3 * G, d0: 0.16, w1: 0.34 * G, d1: 0.22, h: d.len * 0.45, sz: -0.03 }, 0, -d.len * 0.32, -0.2 * G, PAL.main, { metalness: 0.6 });  // 腿肚殼
    for (const oy of [-0.35, -0.62])
      cylF(l, 0.05, 0.05, 0.3, 8, sx * 0.22 * G, d.len * oy, -0.1, COAL, { metalness: 0.8 }).rotation.z = Math.PI / 2;  // 攔截彈匣圓筒
    tboxF(l, { w0: 0.24 * G, d0: 0.2, w1: 0.2 * G, d1: 0.16, h: 0.14 }, 0, -d.len * 0.93, 0.06, PAL.deep, { metalness: 0.7 });  // 踝罩
  },
  foot(c, l, d) {
    const { PAL } = c;
    // 厚底楔台靴:靴體(底寬頂窄)+ 疊層趾蓋 + 暗色鞋底(2D 的厚重踏樁靴)
    tboxF(l, { w0: 0.52, d0: d.footL, w1: 0.38, d1: d.footL * 0.75, h: 0.19, sz: 0.04 }, 0, -d.clear * 0.42, d.footL * 0.12, PAL.mid, { metalness: 0.6 });
    tboxF(l, { w0: 0.46, d0: 0.3, w1: 0.34, d1: 0.18, h: 0.14, sz: 0.06 }, 0, -d.clear * 0.38, d.footL * 0.56, PAL.main, { metalness: 0.6 });  // 趾蓋
    tboxF(l, { w0: 0.54, d0: d.footL * 1.08, w1: 0.5, d1: d.footL, h: 0.07 }, 0, -d.clear * 0.5 - 0.055, d.footL * 0.16, COAL, { metalness: 0.7 });  // 鞋底
    for (const oz of [-0.1, 0.35])
      bxF(l, 0.46, 0.03, 0.11, 0, -d.clear * 0.5 - 0.083, d.footL * 0.16 + oz, INK);  // 底面防滑齒
  },
  armUp(c, a, d) {
    const { PAL, accent, G, sx } = c;
    // 倒角方肩楔台(頂寬底收,2D 的大肩甲)+ 外緣邊簷
    tboxF(a, { w0: 0.34 * G, d0: 0.4 * G, w1: 0.46 * G, d1: 0.5 * G, h: 0.36, sx: sx * 0.03 }, 0, 0.1, 0, PAL.main, { metalness: 0.6 });
    const brim = tboxF(a, { w0: 0.1, d0: 0.46 * G, w1: 0.07, d1: 0.4 * G, h: 0.07 }, sx * 0.26 * G, 0.26, 0, PAL.lite, { metalness: 0.6 });
    brim.rotation.z = -sx * 0.15;
    bxF(a, 0.05, 0.09, 0.03, sx * 0.14 * G, 0.06, 0.24 * G, PAL.deep);            // 肩面通氣塊
    if (sx < 0) {                                                                 // 持盾側肩側裙甲(不對稱)
      const sk = tboxF(a, { w0: 0.14, d0: 0.5, w1: 0.1, d1: 0.44, h: 0.5 }, sx * 0.3 * G, -0.12, 0, PAL.mid, { metalness: 0.6 });
      sk.rotation.z = sx * 0.12;
      bxF(sk, 0.05, 0.44, 0.06, sx * 0.04, 0, 0.22, dimF(accent, 0.8));
    }
    tboxF(a, { w0: 0.2, d0: 0.22, w1: 0.24, d1: 0.26, h: d.len * 0.95 }, 0, -d.len * 0.52, 0, PAL.deep, { metalness: 0.6 });  // 上臂核
  },
  armFore(c, a, d) {
    const { PAL, G } = c;
    latheF(a, [[0.12, -0.06], [0.145, -0.03], [0.145, 0.03], [0.12, 0.06]], 10, 0, 0.0, 0, IRON, { metalness: 0.8 });  // 肘關節環
    // 波紋鼓(2D 前臂一節節的圓鼓)= 單顆旋成體,剖面由下而上交替收放
    const RL = d.len * 0.48;
    const prof = [[0.08, -RL]];
    for (let i = 4; i >= 0; i--) {
      const yb = -RL * (i + 1) / 5, yt = -RL * i / 5;
      prof.push([0.15, yb + (RL / 5) * 0.25], [0.15, yt - (RL / 5) * 0.25], [0.115, yt]);
    }
    latheF(a, prof, 10, 0, -d.len * 0.12, 0, IRON, { metalness: 0.7 });
    // 前臂殼 = 楔台(腕端收)+ 腕束環
    tboxF(a, { w0: 0.26 * G, d0: 0.3 * G, w1: 0.3 * G, d1: 0.34 * G, h: d.len * 0.55 }, 0, -d.len * 0.72, 0.01, PAL.main, { metalness: 0.6 });
    latheF(a, [[0.13, 0], [0.15, 0.02], [0.15, 0.06], [0.13, 0.08]], 10, 0, -d.len * 0.99, 0, PAL.deep, { metalness: 0.7 });
  },
  mount(c, F) {
    const { PAL, accent, G, K, H } = c;
    // 左前臂塔盾(高 ≈ 全高六成):2D 是清楚的上/中/下三段疊層面板 —— 一片一稜柱,
    // 圓角矩形輪廓 + 角落鉚釘列 + 頂段觀察窗縫 + 折邊側條 + 頂緣外翻簷 + 盾底接地齒。
    const SH = 0.58 * H, SW = 0.38 * H;
    const sh = new THREE.Group();
    sh.position.set(-0.2 * G, -0.35, 0.2);
    sh.rotation.z = -0.06;
    F.foreL.add(sh);
    const secs = [[0.21, 0.26, 0], [-0.105, 0.34, -0.03], [-0.49, 0.4, 0]];       // [段中心 yF, 段高 hF, 突出 x]
    for (const [cyF, hF, px] of secs) {
      const p = prismF(sh, panelPts(SW, SH * hF - 0.09, 0.1), 0.1, px, SH * cyF, 0, PAL.main, { metalness: 0.6, bevel: { t: 0.02, s: 0.02 } });
      p.rotation.y = Math.PI / 2;                                                 // 厚度轉向 ±x(盾面朝外)
      for (const oy of [-1, 1]) for (const oz of [-1, 1]) {
        const rv = cylF(sh, 0.032, 0.032, 0.05, 6, px - 0.06, SH * cyF + oy * (SH * hF / 2 - 0.16), oz * (SW / 2 - 0.17), PAL.deep, { metalness: 0.8 });
        rv.rotation.z = Math.PI / 2;                                              // 角落鉚釘列
      }
    }
    tboxF(sh, { w0: 0.08, d0: 0.62, w1: 0.06, d1: 0.54, h: 0.2 }, -0.06, SH * 0.21, 0, PAL.mid, { metalness: 0.6 });  // 觀察窗框
    bxF(sh, 0.04, 0.09, 0.46, -0.1, SH * 0.21, 0, INK);                           // 觀察窗縫
    tboxF(sh, { w0: 0.14, d0: 0.16, w1: 0.12, d1: 0.16, h: SH * 1.0 }, 0.03, -SH * 0.175, SW * 0.5, PAL.mid, { metalness: 0.6 });  // 折邊側條
    tboxF(sh, { w0: 0.2, d0: SW * 1.05, w1: 0.16, d1: SW * 0.95, h: 0.1 }, 0, SH * 0.36, 0, PAL.mid);  // 頂緣外翻簷
    for (const oz of [-1, 1])
      tboxF(sh, { w0: 0.12, d0: 0.2, w1: 0.15, d1: 0.28, h: 0.16 }, 0, -SH * 0.75, oz * SW * 0.3, COAL, { metalness: 0.8 });  // 盾底接地齒
    bxF(sh, 0.16, 0.34, 0.2, 0.1, -SH * 0.05, 0, COAL, { metalness: 0.8 });       // 盾背掛臂
    bxF(sh, 0.18, 0.2, 0.24, 0.14, -SH * 0.16, 0, GUNMETAL, { metalness: 0.7 }); // 握拳(2D 盾後外露的指節)
    // 右前臂 30mm 六管加特林(輕武器;2D 是六管旋轉機砲):
    // 後轉子鼓 + 六管環列 + 中束環 + 前束板 + 側彈藥箱 + 供彈纜束。
    // 砲管沿 gg-local +y ⇒ gunPitch 的 aim MUST = 1.57 − 臂鏈總俯仰(−0.5 −0.35)= 2.42
    const gg = new THREE.Group();
    gg.position.set(0.1 * G, -0.5, 0.16);
    gg.rotation.x = 1.45;
    F.foreR.add(gg);
    const BL = 1.25 * K.barrelF;                                                  // 管長仍吃 barrelF 旋鈕
    tboxF(gg, { w0: 0.32, d0: 0.36, w1: 0.36, d1: 0.4, h: 0.52, sz: -0.02 }, 0, 0.1, 0, PAL.main, { metalness: 0.7 });  // 機匣
    tboxF(gg, { w0: 0.24, d0: 0.2, w1: 0.2, d1: 0.16, h: 0.34 }, 0, 0.12, -0.28, GUNMETAL, { metalness: 0.8 });  // 頂部瞄準塊
    tboxF(gg, { w0: 0.18, d0: 0.34, w1: 0.2, d1: 0.38, h: 0.46 }, 0.28, 0.0, -0.1, PAL.deep, { metalness: 0.7 });  // 側彈藥箱
    bxF(gg, 0.02, 0.2, 0.14, 0.39, 0.0, -0.1, PAL.mid);                           // 彈藥箱面板
    cablesF(gg, { p0: [0.28, -0.2, -0.1], p1: [0.08, 0.32, -0.16], k: 3, r: 0.022, sag: 0.05, spread: 0.016 }, COAL, { metalness: 0.7 });  // 供彈纜束
    latheF(gg, [[0.13, 0], [0.17, 0.03], [0.17, 0.17], [0.12, 0.22]], 10, 0, 0.36, 0, PAL.deep, { metalness: 0.75 });  // 後轉子鼓
    for (let i = 0; i < 6; i++) {
      const th = i * Math.PI / 3, bx = Math.cos(th) * 0.095, bz = Math.sin(th) * 0.095;
      cylF(gg, 0.035, 0.035, BL, 6, bx, 0.58 + BL / 2, bz, GUNMETAL, { metalness: 0.85 });  // 六管環列
      cylF(gg, 0.027, 0.027, 0.07, 6, bx, 0.58 + BL + 0.1, bz, COAL, { metalness: 0.8 });   // 膛口短管
    }
    latheF(gg, [[0.115, 0], [0.14, 0.02], [0.14, 0.1], [0.115, 0.12]], 10, 0, 0.58 + BL * 0.5, 0, PAL.mid, { metalness: 0.8 });  // 中束環
    latheF(gg, [[0.02, 0], [0.15, 0.01], [0.15, 0.1], [0.02, 0.11]], 10, 0, 0.58 + BL, 0, INK, { metalness: 0.85 });  // 前束板
    const lMuz = cylF(gg, 0.05, 0.05, 0.05, 8, 0, 0.58 + BL + 0.1, 0, accent, { emissive: accent, emissiveIntensity: 1.0 });  // 砲口燈(束板中心)
    bxF(gg, 0.07, 0.2, 0.09, 0, 0.32, 0.2, COAL, { metalness: 0.7 });             // 前握把
    bxF(gg, 0.15, 0.16, 0.14, 0, 0.22, 0.24, GUNMETAL, { metalness: 0.7 });       // 握拳
    const hMuz = c.vlsPorts[2];                                                   // 重武器槍口錨 = VLS 其中一管
    return {
      gunR: { g: gg, rest: 1.45, aim: 2.42 }, gunL: null,
      muzzles: { light: { n: lMuz, r: 0.09 }, heavy: { n: hMuz, r: 0.06 } },
      lightGlowM: [lMuz], heavyGlowM: c.vlsPorts, heavyPivot: [],
      weap: { light: 'R', heavy: 'N' },
      hvy: { chest: 0.05, gun: 0.04 },
      aimPose: { rShoulderX: -0.5, rElbowX: -0.35 },                              // 只舉砲臂;左臂守盾交還步態
      wpn: { light: { nodes: [gg], ref: gg, muz: lMuz, fwd: 'y' }, heavy: { nodes: [sh], ref: sh, muz: hMuz, fwd: 'z' } },
    };
  },
};
