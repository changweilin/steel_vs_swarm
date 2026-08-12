// ============ m05 逐機零件檔(自 forge.js MECH_DETAIL 拆出;dev-only)============
// // ── m05「鎖喉」電戰機(wolf):趾行深屈、狼吻齒列、鬃刺羽扇、六管旋砲+彈箱 ──
// 2D 定案圖:public/assets/cyberpunk_art/mechs/m05_ground_static.jpg / m05_flight_static.jpg
// 幾何語彙一律取自 ../geo.js(多面體字母表);MUST NOT 在本檔自建 BufferGeometry。
// 2026-08-12 多面體改版:主殼一律 tboxF/prismF/latheF;鬃毛=雙排羽扇(14 刺一刺一件)、
// 尾=三節狼尾 chainF+逐節毛簇、腰後右側=摺收尾翼組(prismF 翼形 3 片)、六管旋砲照 2D 圖。
import * as THREE from 'three';
import {
  matF, dimF, bxF, cylF, sphF, coneF, torusF, tboxF, prismF, latheF, finF, fanF, chainF, cablesF,
  hydCyl, sinew, seg2, IRON, GUNMETAL, COAL, INK, BONE, BRASS,
} from '../geo.js';

export default {
  label: '鎖喉(m05 變形者・地面型)', hue: 0x5551cc,
  prop: { hips: 0.49, legSplay: 0.09, thigh: 0.45, shin: 0.53, shoulderY: 0.76, shoulderX: 0.175, upperArm: 0.17, foreArm: 0.165, head: 0.84, girth: 1.05 },
  gait: { strideF: 1.35, bob: 0.11, sway: 0.08, top: 9, armBase: 0.1, legBase: -0.2 },
  pose: { knee: { base: 0.42, k: 0.62, d: 0.15 }, ankle: { base: -0.26, k: -0.3, d: 0.55 } },   // 趾行深屈
  moveSig: { poise: 0.82, idleF: 0.85, idleA: 0.42, launch: 0.86, spool: 0.22, brake: 0.32, settle: 1.2 },
  castSig: { omni: 'roar', dir: 'swing' },
  doc: [
    ['head', '楔形狼首:稜柱側輪廓頭殼+分件下顎+錯咬齒列+犬齒+怒眉稜+後掠三角耳殼'],
    ['chest', '楔台主甲+胸毛疊瓦板 ×5(一片一件)+直立進氣塔+電戰背包散熱鰭 ×6(一鰭一件)'],
    ['mane', '頸背鬃冠 = 雙排羽扇 14 刺(中央最長、後掠,一刺一件)+刺尖 accent 點綴'],
    ['hips', '楔台骨盆+腰後右側摺收尾翼組(垂直安定面+斜置翼面 ×2,prismF 一片一件)'],
    ['tail', '三節狼尾節鏈(收分節身+關節環+逐節毛簇)+尾梢毛簇錐'],
    ['leg ×2', '趾行深屈:收分楔台腿殼+圓盤螺栓+跟腱桿+足底噴口+三趾彎爪+後距突'],
    ['arm ×2', '楔台肩甲+肩尖獠刺+識別面板(accent 邊)+圓盤螺栓+外露腱桿'],
    ['hand R', '12.7 六管電磁旋砲(旋轉鼓+束環+雙線圈+砲口簇)'],
    ['hand L', '追債者 2×2 制導彈箱(斜切楔台+四發光膛口+膛口座環)'],
  ],
  head(c, h) {
    const { PAL, accent, G } = c;
    const hd = new THREE.Group();                                                // 頭部放大殼(錨點不動,內部幾何放大)
    hd.scale.setScalar(1.28);
    h.add(hd);
    h = hd;
    // 頭殼:狼首側輪廓稜柱(後高前低、頂稜下顎稜都有折面);profile +x=前,旋 y=-90° 對齊 +z
    const skull = prismF(h, [
      [-0.19, -0.04], [-0.17, 0.16], [0.02, 0.20], [0.17, 0.13], [0.19, 0.0], [0.10, -0.13], [-0.12, -0.14],
    ], 0.34 * G, 0, 0.05, 0.0, PAL.mid, { metalness: 0.6 });
    skull.rotation.y = -Math.PI / 2;
    // 楔形長吻(上吻):稜柱側輪廓,往吻端收窄收薄
    const snout = prismF(h, [
      [0, 0.10], [0.30, 0.05], [0.40, 0.02], [0.40, -0.03], [0.30, -0.06], [0, -0.09],
    ], 0.17 * G, 0, -0.01, 0.16, PAL.main, { metalness: 0.6 });
    snout.rotation.y = -Math.PI / 2;
    // 分件下顎(微張)
    const jaw = prismF(h, [
      [0, 0.0], [0.26, 0.02], [0.34, -0.01], [0.28, -0.05], [0, -0.07],
    ], 0.12 * G, 0, -0.12, 0.16, PAL.deep, { metalness: 0.6 });
    jaw.rotation.y = -Math.PI / 2;
    jaw.rotation.z = 0.06;                                                       // 旋 y 後的張口軸
    bxF(h, 0.09, 0.07, 0.08, 0, 0.02, 0.53, COAL);                               // 鼻端
    for (const sx of [-1, 1]) for (let i = 0; i < 3; i++) {                      // 錯咬雙齒列(小件)
      bxF(h, 0.022, 0.05, 0.022, sx * (0.05 + i * 0.012), -0.105, 0.28 + i * 0.06, BONE, { metalness: 0.6 });
      bxF(h, 0.018, 0.045, 0.018, sx * (0.045 + i * 0.012), -0.135, 0.31 + i * 0.06, BONE, { metalness: 0.6 });
    }
    for (const sx of [-1, 1]) {                                                  // 上下犬齒(彎爪錐)
      const fangU = coneF(h, 0.02, 0.1, 5, sx * 0.075, -0.13, 0.47, BONE, { metalness: 0.6 });
      fangU.rotation.x = 2.95;                                                   // 朝下微前
      const fangL = coneF(h, 0.016, 0.08, 5, sx * 0.062, -0.11, 0.43, BONE, { metalness: 0.6 });
      fangL.rotation.x = 0.25;                                                   // 朝上微前
    }
    bxF(h, 0.26 * G, 0.05, 0.05, 0, 0.1, 0.2, accent, { emissive: accent, emissiveIntensity: 1.5 });  // 面罩感測條
    for (const sx of [-1, 1]) {
      const brow = tboxF(h, { w0: 0.12, d0: 0.10, w1: 0.09, d1: 0.06, h: 0.045, sz: -0.02 },
        sx * 0.09 * G, 0.155, 0.17, PAL.deep, { metalness: 0.6 });
      brow.rotation.z = sx * 0.15; brow.rotation.x = -0.2;                       // 怒眉稜(內高外低)
      // 後掠三角耳殼(2D 是有厚度的角形殼):稜柱三角 + 內耳暗板
      const ear = prismF(h, [[-0.06, 0], [0.06, 0], [0.014, 0.22]], 0.045,
        sx * 0.13 * G, 0.19, -0.05, PAL.mid, { metalness: 0.6 });
      ear.rotation.x = -0.55;                                                    // 後掠
      ear.rotation.z = -sx * 0.12;                                               // 耳尖外傾
      bxF(ear, 0.055, 0.1, 0.02, 0, 0.06, 0.028, COAL);                          // 內耳暗板(隨耳殼)
    }
    cylF(h, 0.09, 0.1, 0.1, 10, 0, -0.18, -0.02, IRON, { metalness: 0.7 });      // 頸根關節環(蛇腹)
  },
  chest(c, ch, d) {
    const { PAL, accent, G } = c;
    const top = d.shoulderY, bot = d.waistY;
    // 銀灰主甲:楔台(肩寬腰窄的 V 形軀幹)
    tboxF(ch, { w0: d.shoulderX * 1.25, d0: 0.68 * G, w1: d.shoulderX * 1.75, d1: 0.9 * G, h: top - bot + 0.25, sz: 0.02 },
      0, (top + bot) / 2 + 0.1, 0, PAL.lite, { metalness: 0.6 });
    bxF(ch, d.shoulderX * 1.15, 0.11, 0.05, 0, top - 0.14, 0.46 * G, accent, { emissive: accent, emissiveIntensity: 1.1 });  // 識別燈
    for (let i = 0; i < 5; i++) {                                                // 胸毛疊瓦板 ×5(一片一件;由寬到窄、往上收、層層外疊)
      const w = (0.74 - i * 0.105) * G;
      const p = tboxF(ch, { w0: w, d0: 0.08, w1: w * 0.76, d1: 0.055, h: 0.2, sz: -0.025 },
        0, top - 0.72 + i * 0.13, 0.48 * G + (4 - i) * 0.014, PAL.main, { metalness: 0.55 });
      p.rotation.x = -0.22;
    }
    for (const sx of [-1, 1]) {                                                  // 肩位直立進氣塔(楔台+暗入口+三片導流葉;立在肩上)
      const ix = sx * (d.shoulderX * 0.78);
      tboxF(ch, { w0: 0.17, d0: 0.38, w1: 0.13, d1: 0.28, h: 0.46, sz: -0.04 },
        ix, top + 0.18, 0.02, PAL.deep, { metalness: 0.6 });
      bxF(ch, 0.11, 0.34, 0.03, ix, top + 0.2, 0.2, COAL);                       // 暗入口槽
      for (let i = 0; i < 3; i++)
        bxF(ch, 0.1, 0.022, 0.05, ix, top + 0.08 + i * 0.11, 0.21, IRON, { metalness: 0.8 });  // 導流葉
    }
    // 電戰背包(楔台)+ 散熱鰭 ×6(一鰭一件,薄刃後掠)
    tboxF(ch, { w0: 0.55 * G, d0: 0.24, w1: 0.6 * G, d1: 0.28, h: 0.5 }, 0, top - 0.4, -0.5 * G, PAL.deep, { metalness: 0.6 });
    for (let i = 0; i < 6; i++) {
      const fx = (-0.25 + i * 0.1) * G;
      const fin = finF(ch, { len: 0.4, w0: 0.045, w1: 0.025, t: 0.03, sweep: 0.06 },
        fx, top - 0.62, -0.62 * G, IRON, { metalness: 0.75 });
      fin.rotation.x = -0.5;                                                     // 後傾
      fin.rotation.y = Math.PI / 2;                                              // 刃面轉成前後向(散熱片方向)
    }
    // ── 頸背鬃冠:雙排羽扇(主排 9 + 副排 5 = 14 刺,一刺一件;中央最長、扇形後掠)──
    const mane = fanF(ch, {
      n: 9, arc: 2.7, len: 1.08, edgeF: 0.32, gap: 0.032,
      fin: { w0: 0.095, w1: 0.014, t: 0.055, sweep: 0.12 },
    }, 0, top + 0.06, -0.3 * G, PAL.mid, { metalness: 0.7 });
    mane.g.rotation.x = -1.05;                                                   // 整冠後掠
    mane.fins[4].material = matF(c.accent, { emissive: c.accent, emissiveIntensity: 0.8 });  // 中央發光刺
    const mane2 = fanF(ch, {
      n: 5, arc: 1.8, len: 0.68, edgeF: 0.46, gap: 0.035,
      fin: { w0: 0.08, w1: 0.012, t: 0.045, sweep: 0.1 },
    }, 0, top - 0.28, -0.44 * G, PAL.deep, { metalness: 0.7 });
    mane2.g.rotation.x = -1.35;                                                  // 副排更貼背(交錯層次)
    for (const [fan, spec, ids] of [[mane, { n: 9, len: 1.08, edgeF: 0.32 }, [1, 4, 7]], [mane2, { n: 5, len: 0.68, edgeF: 0.46 }, [2]]]) {
      for (const i of ids) {                                                     // 刺尖 accent 點綴(保留)
        const u = i / (spec.n - 1) - 0.5;
        const L = spec.len * (1 - (1 - spec.edgeF) * Math.abs(u) * 2);
        sphF(fan.fins[i], 0.028, 0, L * 0.97, 0.07, c.accent, { emissive: c.accent, emissiveIntensity: 0.9 });
      }
    }
  },
  pelvis(c, hips, d) {
    const { PAL, accent, G } = c;
    tboxF(hips, { w0: 0.5 * G, d0: 0.4 * G, w1: 0.62 * G, d1: 0.5 * G, h: 0.3 }, 0, 0.02, 0, PAL.deep, { metalness: 0.6 });  // 楔台骨盆
    tboxF(hips, { w0: 0.16 * G, d0: 0.08, w1: 0.24 * G, d1: 0.1, h: 0.2, sz: 0.03 }, 0, -0.02, 0.26 * G, PAL.mid, { metalness: 0.6 });  // 前檔楔板
    // ── 摺收飛行尾翼組(2D 腰後右側:大型垂直安定面 + 斜置翼面 ×2;prismF 翼形一片一件)──
    const pack = new THREE.Group();
    pack.position.set(0.3 * G, 0.06, -0.28 * G);
    pack.rotation.y = -0.35;                                                     // 整組往 +x 外側掠(+0.35 會掃進身體中線被軀幹遮死)
    hips.add(pack);
    tboxF(pack, { w0: 0.2, d0: 0.26, w1: 0.16, d1: 0.2, h: 0.34 }, 0, 0, 0, IRON, { metalness: 0.8 });  // 摺收鉸鏈座
    const wing = (pts, depth, roll, color, oy = 0) => {                          // 翼片:稜柱輪廓(+x=向後)掛在滾轉樞架上
      const piv = new THREE.Group();
      piv.position.set(0, oy, -0.06);
      piv.rotation.z = roll;
      pack.add(piv);
      const w = prismF(piv, pts, depth, 0, 0, 0, color, { metalness: 0.65 });
      w.rotation.y = Math.PI / 2;                                                // 輪廓面轉入矢狀面(+x → −z 向後)
      return w;
    };
    const stab = wing([[0, 0], [1.0, -0.04], [1.45, 0.78], [0.74, 1.06], [0.11, 0.5]], 0.09, -0.1, PAL.mid, 0.06);    // 垂直安定面(大)
    bxF(stab, 0.9, 0.08, 0.1, 0.85, 0.78, 0, dimF(accent, 0.7), { emissive: accent, emissiveIntensity: 0.5 });        // 安定面 accent 稜線
    wing([[0, 0], [0.92, -0.18], [1.34, -0.08], [1.08, 0.18], [0.26, 0.24]], 0.08, -1.1, PAL.main);                   // 斜置主翼面
    wing([[0, 0], [0.7, -0.15], [1.0, -0.04], [0.78, 0.15], [0.19, 0.19]], 0.07, -1.75, PAL.deep);                    // 斜置下翼面(小)
    // 左側:摺平的小襟翼一片(2D 主包在右側,左側只留收摺薄片)
    const flapL = prismF(hips, [[0, 0], [0.62, -0.05], [0.82, 0.13], [0.48, 0.25], [0.08, 0.16]], 0.06,
      -0.28 * G, -0.02, -0.28 * G, PAL.mid, { metalness: 0.65 });
    flapL.rotation.y = Math.PI / 2 + 0.25;
    flapL.rotation.z = -0.35;
  },
  thigh(c, l, d) {
    const { PAL, G, sx } = c;
    // 收分楔台大腿(髖粗膝細)
    tboxF(l, { w0: 0.26 * G, d0: 0.3 * G, w1: 0.34 * G, d1: 0.4 * G, h: d.len * 1.02, sz: -0.02 },
      0, -d.len * 0.5, 0.02, PAL.main, { metalness: 0.6 });
    cylF(l, 0.1 * G, 0.1 * G, 0.05, 12, sx * 0.18 * G, 0.0, 0, PAL.deep, { metalness: 0.8 }).rotation.z = Math.PI / 2;  // 髖圓盤+螺栓
    cylF(l, 0.03, 0.03, 0.02, 6, sx * 0.19 * G, 0.0, 0.001, COAL, { metalness: 0.9 }).rotation.z = Math.PI / 2;
  },
  shin(c, l, d) {
    const { PAL, G, sx } = c;
    cylF(l, 0.09 * G, 0.09 * G, 0.05, 12, sx * 0.15 * G, -0.01, 0, PAL.deep, { metalness: 0.8 }).rotation.z = Math.PI / 2;  // 膝圓盤
    tboxF(l, { w0: 0.16 * G, d0: 0.1, w1: 0.2 * G, d1: 0.14, h: 0.16, sz: 0.04 }, 0, -0.02, 0.15 * G, PAL.deep, { metalness: 0.6 });  // 膝前護楔
    // 小腿 = 雙發機艙段(上寬下窄楔台)
    tboxF(l, { w0: 0.22 * G, d0: 0.26 * G, w1: 0.28 * G, d1: 0.32 * G, h: d.len * 0.62, sz: -0.02 },
      0, -d.len * 0.31, 0, PAL.mid, { metalness: 0.6 });
    // 長蹠骨段(細長收分)
    tboxF(l, { w0: 0.17 * G, d0: 0.2 * G, w1: 0.22 * G, d1: 0.25 * G, h: d.len * 0.45, sz: 0.03 },
      0, -d.len * 0.76, 0.02, PAL.main, { metalness: 0.6 });
    cylF(l, 0.05, 0.06, 0.1, 8, 0, -d.len * 0.55, -0.17 * G, COAL, { metalness: 0.8 }).rotation.x = -0.4;  // 足底噴口
    cylF(l, 0.02, 0.02, d.len * 0.4, 6, 0, -d.len * 0.72, -0.13 * G, BONE, { metalness: 0.9 }).rotation.x = -0.06;  // 跟腱桿(下端懸空)
    cylF(l, 0.07, 0.07, 0.06, 10, 0, -d.len * 0.95, 0, IRON, { metalness: 0.7 });  // 踝防塵罩環
  },
  foot(c, l, d) {
    const { PAL } = c;
    // 長蹠骨足掌:前寬後窄楔台(前段觸地)
    tboxF(l, { w0: 0.24, d0: d.footL * 0.85, w1: 0.28, d1: d.footL * 0.95, h: 0.12, sz: 0.03 },
      0, -d.clear * 0.5, d.footL * 0.25, PAL.deep, { metalness: 0.6 });
    for (const ox of [-0.09, 0, 0.09]) {                                         // 三趾:趾節楔台 + 彎爪錐(一趾兩件)
      tboxF(l, { w0: 0.06, d0: 0.14, w1: 0.07, d1: 0.16, h: 0.07 }, ox, -d.clear * 0.5, d.footL * 0.6, PAL.mid, { metalness: 0.6 });
      const claw = coneF(l, 0.032, 0.2, 5, ox, -d.clear * 0.55, d.footL * 0.76, BONE, { metalness: 0.7 });
      claw.rotation.x = 1.85;                                                    // 前伸微扣地
    }
    const dew = coneF(l, 0.04, 0.18, 5, 0, -d.clear * 0.3, -d.footL * 0.2, BONE, { metalness: 0.7 });
    dew.rotation.x = -2.6;                                                       // 後距突 dewclaw(不觸地)
  },
  armUp(c, a, d) {
    const { PAL, accent, G, sx } = c;
    // 方形大肩甲:上寬下窄楔台(斜切)
    tboxF(a, { w0: 0.3 * G, d0: 0.34 * G, w1: 0.4 * G, d1: 0.44 * G, h: 0.32, sx: sx * 0.03, sz: -0.02 },
      0, 0.1, 0, PAL.main, { metalness: 0.6 });
    // 識別面板(2D 大肩板 m05 標記位;不做文字,做帶 accent 邊的外側面板)
    tboxF(a, { w0: 0.05, d0: 0.3, w1: 0.05, d1: 0.24, h: 0.26, sz: -0.03 },
      sx * 0.22 * G, 0.1, 0, PAL.lite, { metalness: 0.55 });
    bxF(a, 0.052, 0.04, 0.26, sx * 0.225 * G, -0.05, 0, dimF(accent, 0.7), { emissive: accent, emissiveIntensity: 0.5 });  // 面板 accent 下緣
    const spike = coneF(a, 0.09, 0.5, 5, sx * 0.2 * G, 0.32, 0, PAL.deep, { metalness: 0.7 });
    spike.rotation.z = sx * 0.5;                                                 // 肩尖獠刺
    const spike2 = coneF(a, 0.05, 0.26, 5, sx * 0.13 * G, 0.3, -0.12, PAL.deep, { metalness: 0.7 });
    spike2.rotation.z = sx * 0.65; spike2.rotation.x = -0.3;                     // 副獠刺(後位)
    // 上臂殼:收分楔台
    tboxF(a, { w0: 0.17 * G, d0: 0.2 * G, w1: 0.22 * G, d1: 0.26 * G, h: d.len * 1.0 },
      0, -d.len * 0.5, 0, PAL.mid, { metalness: 0.6 });
  },
  armFore(c, a, d) {
    const { PAL, G, sx } = c;
    cylF(a, 0.08 * G, 0.08 * G, 0.04, 12, sx * 0.12 * G, -0.01, 0, PAL.deep, { metalness: 0.8 }).rotation.z = Math.PI / 2;  // 肘圓盤
    cylF(a, 0.025, 0.025, 0.018, 6, sx * 0.135 * G, -0.01, 0.001, COAL, { metalness: 0.9 }).rotation.z = Math.PI / 2;       // 肘螺栓
    // 前臂殼:腕端外張的護腕楔台
    tboxF(a, { w0: 0.2 * G, d0: 0.24 * G, w1: 0.16 * G, d1: 0.2 * G, h: d.len * 1.0, sz: 0.01 },
      0, -d.len * 0.5, 0.01, PAL.main, { metalness: 0.6 });
    cylF(a, 0.016, 0.016, d.len * 0.55, 6, -sx * 0.02, -d.len * 0.45, -0.1 * G, BONE, { metalness: 0.9 }).rotation.x = -0.05;  // 外露腱桿
  },
  mount(c, F) {
    const { PAL, accent, K } = c;
    const REST = 1.62, AIM = { sh: -0.78, el: -0.5 }, AIMA = 1.57 - (AIM.sh + AIM.el);  // rest 近水平:趾行手位低防戳地
    for (const [g, sx] of [[F.handL, -1], [F.handR, 1]]) {
      tboxF(g, { w0: 0.18, d0: 0.2, w1: 0.2, d1: 0.22, h: 0.2 }, 0, -0.09, 0.02, c.dark);   // 掌甲楔台
      for (const ox of [-0.07, 0, 0.07]) {                                       // 握槍仍露三爪(彎爪錐)
        const claw = coneF(g, 0.03, 0.17, 5, ox + sx * 0.02, -0.17, 0.15, BONE, { metalness: 0.7 });
        claw.rotation.x = 1.9; claw.rotation.z = sx * 0.12;
      }
    }
    // ── 右手 12.7 六管電磁旋砲(輕武器;2D 是長管束加特林)──
    const gr = new THREE.Group();
    gr.position.set(0.15, -0.16, 0.22);
    gr.rotation.set(REST, 0, 0.1);
    F.handR.add(gr);
    const RL = 1.15 * K.barrelF;                                                 // 長管束(照 2D 加長)
    tboxF(gr, { w0: 0.22, d0: 0.26, w1: 0.18, d1: 0.2, h: 0.42, sz: -0.02 }, 0, 0.05, 0, PAL.mid, { metalness: 0.7 });  // 機匣楔台
    bxF(gr, 0.09, 0.18, 0.14, 0, -0.16, -0.16, COAL, { metalness: 0.7 });        // 握把
    latheF(gr, [[0.05, 0], [0.13, 0.03], [0.145, 0.1], [0.11, 0.18], [0.05, 0.2]], 10, 0, 0.26, 0, GUNMETAL, { metalness: 0.85 });  // 旋轉鼓座
    for (let i = 0; i < 6; i++) {                                                // 六管環列(一管一件)
      const th = i / 6 * Math.PI * 2;
      cylF(gr, 0.028, 0.028, RL, 6, Math.cos(th) * 0.075, 0.3 + RL / 2, Math.sin(th) * 0.075, GUNMETAL, { metalness: 0.85 });
    }
    for (const t of [0.32, 0.62])                                                // 束環(旋成體卡箍)
      latheF(gr, [[0.09, 0], [0.108, 0.012], [0.108, 0.05], [0.09, 0.062]], 10, 0, 0.3 + RL * t, 0, IRON, { metalness: 0.85 });
    for (const t of [0.46, 0.82])                                                // 雙加速線圈環(發光)
      cylF(gr, 0.1, 0.1, 0.05, 10, 0, 0.3 + RL * t, 0, accent, { emissive: accent, emissiveIntensity: 0.5 });
    latheF(gr, [[0.055, 0], [0.11, 0.02], [0.11, 0.07], [0.055, 0.09]], 10, 0, 0.28 + RL, 0, GUNMETAL, { metalness: 0.85 });  // 砲口簇座環
    const lMuz = cylF(gr, 0.085, 0.085, 0.05, 10, 0, 0.36 + RL, 0, accent, { emissive: accent, emissiveIntensity: 0.9 });
    const drum = cylF(gr, 0.12, 0.12, 0.14, 10, -0.16, 0.02, -0.04, PAL.deep, { metalness: 0.7 });  // 側掛彈鼓
    drum.rotation.z = Math.PI / 2;
    bxF(gr, 0.1, 0.16, 0.06, -0.1, 0.14, -0.02, IRON, { metalness: 0.8 });       // 供彈槽
    // ── 左手追債者 2×2 制導彈箱(重武器)──
    const gl = new THREE.Group();
    gl.position.set(-0.15, -0.16, 0.22);
    gl.rotation.set(REST, 0, -0.1);
    F.handL.add(gl);
    const BL2 = 0.7 * K.barrelF;
    tboxF(gl, { w0: 0.3, d0: 0.32, w1: 0.26, d1: 0.28, h: BL2, sz: 0.03 }, 0, 0.1 + BL2 / 2, 0, PAL.mid, { metalness: 0.7 });  // 斜切彈箱楔台
    const ports = [];
    for (const ox of [-0.08, 0.08]) for (const oz of [-0.08, 0.08]) {
      latheF(gl, [[0.052, 0], [0.066, 0.01], [0.066, 0.04], [0.052, 0.05]], 8, ox, BL2 + 0.08, oz, PAL.deep, { metalness: 0.8 });  // 膛口座環
      const p = cylF(gl, 0.05, 0.05, 0.05, 8, ox, BL2 + 0.12, oz, accent, { emissive: accent, emissiveIntensity: 0.9 });
      ports.push(p);                                                             // 四發光膛口
    }
    bxF(gl, 0.22, 0.07, 0.03, 0, BL2 + 0.05, 0.17, dimF(accent, 0.6), { emissive: accent, emissiveIntensity: 0.4 });  // 鎖定感測條
    for (const sxr of [-1, 1])
      bxF(gl, 0.02, BL2 * 0.7, 0.24, sxr * 0.16, 0.1 + BL2 / 2, 0, PAL.deep, { metalness: 0.7 });  // 側導軌板
    bxF(gl, 0.09, 0.16, 0.13, 0, -0.04, -0.2, COAL, { metalness: 0.7 });         // 握把
    return {
      gunR: { g: gr, rest: REST, aim: AIMA }, gunL: { g: gl, rest: REST, aim: AIMA },
      muzzles: { light: { n: lMuz, r: 0.09 }, heavy: { n: ports[0], r: 0.05 } },
      lightGlowM: [lMuz], heavyGlowM: ports, heavyPivot: [],
      weap: { light: 'R', heavy: 'L' },
      hvy: { armL: 0.2, armR: 0.08, chest: 0.05, gun: 0.05 },
      aimPose: { rShoulderX: AIM.sh, rElbowX: AIM.el, lShoulderX: AIM.sh, lShoulderY: 0, lElbowX: AIM.el },
      wpn: { light: { nodes: [gr], ref: gr, muz: lMuz, fwd: 'y' }, heavy: { nodes: [gl], ref: gl, muz: ports[0], fwd: 'y' } },
    };
  },
  extra(c, F, rig) {
    const { PAL, G } = c;
    // 三節狼尾配重:節鏈(收分節身+關節環)+ 逐節腹側毛簇 + 尾梢毛簇錐(不發光)
    const tail = chainF(F.hips, {
      n: 3, x: 0, y: -0.02, z: -0.26 * G,
      len0: 0.4, len1: 0.4, r0: 0.06, r1: 0.036,
      rot0: 0.5, rotD: 0, seg: 7, ringColor: IRON,
      drawSeg: (t, i, s) => {
        const tuft = finF(t, { len: 0.13 - i * 0.02, w0: 0.045, w1: 0.008, t: 0.018, sweep: 0.04 },
          0, -s.r * 0.8, -s.len * 0.55, PAL.deep, { metalness: 0.5 });
        tuft.rotation.x = Math.PI - 0.5;                                         // 腹側毛簇(朝下後掠)
      },
    }, PAL.mid, { metalness: 0.55 });
    const tip = coneF(tail.tip, 0.05, 0.18, 6, 0, 0, -0.47, PAL.deep, { metalness: 0.5 });
    tip.rotation.x = -Math.PI / 2;                                               // 尾梢毛簇錐(不發光)
    for (const sx of [-1, 1]) {                                                  // 尾梢側毛(小刃)
      const f = finF(tail.tip, { len: 0.1, w0: 0.03, w1: 0.006, t: 0.014, sweep: 0.02 },
        sx * 0.03, 0, -0.4, PAL.deep, { metalness: 0.5 });
      f.rotation.x = Math.PI - 0.35; f.rotation.z = sx * 0.4;
    }
    rig.tailSegs = tail.segs;
    rig.tailUp = 0.08;
  },
};
