// ============ t01 逐機零件檔(自 forge.js MECH_DETAIL 拆出;dev-only)============
// // ── t01「莫洛茲」過裝甲重機甲(bastion):球肩吞頭、乘員蛋艙、斧砲+轉輪鼓 ──
// 2D 定案圖:public/assets/cyberpunk_art/mechs/t01_static.png / t01_moving.png / t01_heavy.png
// 幾何語彙一律取自 ../geo.js(多面體字母表);MUST NOT 在本檔自建 BufferGeometry。
// 2026-08-12 多面體改寫:主殼一律楔台/稜柱/旋成體(bxF 只留鉚釘、細條、小塊);
// 簽名零件對照 2D 圖 —— 骷髏面甲+雙眼窩+三節彎牛角、旋成體球肩吞頭(邊環+分模帶)、
// 乘員蛋艙=頭部座艙(旋成後碗+艙口邊環;2D 的骷髏頭沉在圓形艙口裡,胸前沒有反應爐圓)、
// 頭後拱衛甲、腹部外露纜束、分段爪指(節座+薄刃爪尖)、鋸齒月牙斧刃(稜柱輪廓點列)、
// Kord 波紋散熱套筒(旋成體)。
import * as THREE from 'three';
import {
  matF, dimF, bxF, cylF, sphF, coneF, torusF, tboxF, prismF, latheF, finF, fanF, chainF, cablesF,
  hydCyl, sinew, seg2, IRON, GUNMETAL, COAL, INK, BONE, BRASS,
} from '../geo.js';

export default {
  label: '莫洛茲(t01 重機甲)', hue: 0xd6e4ef,
  prop: { hips: 0.47, legSplay: 0.13, thigh: 0.45, shin: 0.42, shoulderY: 0.76, shoulderX: 0.24, upperArm: 0.147, foreArm: 0.2, head: 0.83, girth: 1.35 },
  gait: { strideF: 1.45, bob: 0.16, sway: 0.11, top: 7, armBase: 0.12 },
  moveSig: { poise: 0.86, idleF: 0.42, idleA: 1.9, launch: 0.1, spool: 0.95, brake: 0.1, settle: 2.2 },
  castSig: { omni: 'stomp', dir: 'swing' },
  doc: [
    ['head', '骷髏面甲(稜柱正面輪廓)+雙眼窩發光+鼻槽齒列+顱頂旋成蓋+三節彎牛角×2'],
    ['chest', '楔台桶胸+疊層梯形胸板+V 形中脊稜柱+乘員蛋艙=頭部座艙(旋成後碗+艙口邊環+周視鏡)+頭後拱衛拱甲(稜柱)'],
    ['belly', '腹部收腰疊環楔台+中央動力亮縫+兩側外露纜束(cablesF 多零件)'],
    ['hips', '楔台骨盆+倒斜車首甲+斜置裙甲楔板+ERA 反應塊+牽引鉤'],
    ['leg ×2', '楔台樁腿疊殼+大腿盾形稜柱前板+弧形膝蓋稜柱大蓋甲+膝後雙活塞+外露液壓缸'],
    ['foot ×2', '雙趾楔/中段/跟配重楔台巨足'],
    ['arm ×2', '旋成體球形巨肩吞頭(底緣邊環+分模帶+識別稜柱面板)、細上臂楔台→巨手甲楔台疊板'],
    ['hand ×2', '分段爪指:每指節座楔台+薄刃爪尖(finF),拇指同制'],
    ['hand L', 'Kord 重機槍:波紋散熱套筒(旋成體)+彈鏈箱+黃銅彈鏈節+提把'],
    ['hand R', '152mm 斧砲:鋸齒月牙斧刃(稜柱鋸齒輪廓)+轉輪榴彈鼓(旋成體+六膛室)+駐退雙筒+旋成制退器'],
  ],
  head(c, h) {
    const { PAL, accent, G } = c;
    // 骷髏面甲:額寬頰收、下顎尖的多面稜柱(2D 定案的骨白面甲;MUST NOT 用 bevel —— 與描邊救援副本相沖)
    prismF(h, [
      [-0.22 * G, 0.24], [0.22 * G, 0.24],
      [0.27 * G, 0.03], [0.17 * G, -0.2],
      [0.06 * G, -0.36], [-0.06 * G, -0.36],
      [-0.17 * G, -0.2], [-0.27 * G, 0.03],
    ], 0.16, 0, 0.02, 0.26, BONE, { metalness: 0.5 });
    // 雙眼窩發光 + 鼻樑暗槽 + 顎部齒列(小塊允許 bxF;2D:骷髏雙眼)
    for (const sx of [-1, 1])
      bxF(h, 0.11 * G, 0.07, 0.05, sx * 0.1 * G, 0.09, 0.34, accent, { emissive: accent, emissiveIntensity: 1.7 });
    bxF(h, 0.05 * G, 0.1, 0.04, 0, -0.05, 0.345, INK, { metalness: 0.4 });
    for (const tx of [-0.09, -0.03, 0.03, 0.09])
      bxF(h, 0.028, 0.09, 0.03, tx * G, -0.25, 0.335, dimF(BONE, 0.72), { metalness: 0.4 });
    // 顱頂旋成蓋(頭殼主量體)
    latheF(h, [[0.22 * G, -0.12], [0.23 * G, 0.02], [0.2 * G, 0.14], [0.13 * G, 0.26], [0.0001, 0.32]], 10, 0, 0.06, 0.03, PAL.mid, { metalness: 0.6 });
    // 頭頂護甲簷(前傾楔台)
    tboxF(h, { w0: 0.48 * G, d0: 0.34, w1: 0.52 * G, d1: 0.2, h: 0.13, sz: 0.09 }, 0, 0.32, 0.05, PAL.main, { metalness: 0.6 });
    // 下顎面罩楔台(骷髏「牙」的稜面)
    tboxF(h, { w0: 0.22 * G, d0: 0.15, w1: 0.14 * G, d1: 0.1, h: 0.16 }, 0, -0.18, 0.26, PAL.deep, { metalness: 0.6 });
    // 三節彎牛角 ×2:基節外傾 → 中節近直 → 尖端內勾(2D 定案的骷髏面甲角;粗根收梢)
    for (const sx of [-1, 1]) {
      const h1 = cylF(h, 0.062, 0.088, 0.32, 6, sx * 0.33, 0.3, 0.14, BONE, { metalness: 0.5 });
      h1.rotation.z = -sx * 0.6;
      const h2 = cylF(h, 0.045, 0.06, 0.26, 6, sx * 0.45, 0.56, 0.16, BONE, { metalness: 0.5 });
      h2.rotation.z = -sx * 0.15;
      const h3 = coneF(h, 0.042, 0.24, 6, sx * 0.44, 0.79, 0.16, BONE, { metalness: 0.5 });
      h3.rotation.z = sx * 0.42;
    }
  },
  chest(c, ch, d) {
    const { PAL, accent, G } = c;
    const top = d.shoulderY, bot = d.waistY;
    const midY = (top + bot) / 2;
    // 桶胸主體:上寬下收楔台(取代方盒)
    tboxF(ch, { w0: d.shoulderX * 1.16, d0: 0.92 * G, w1: d.shoulderX * 1.5, d1: 1.0 * G, h: top - bot + 0.4, sz: 0.03 }, 0, midY + 0.1, 0, PAL.main, { metalness: 0.6 });
    // 疊層梯形胸板(2D:上寬下收的分割甲面,兩層)
    tboxF(ch, { w0: 1.32, d0: 0.16, w1: 1.92, d1: 0.2, h: 0.6, sz: 0.05 }, 0, midY + 0.62, 0.62 * G, PAL.mid, { metalness: 0.62 });
    tboxF(ch, { w0: 0.86, d0: 0.14, w1: 1.3, d1: 0.16, h: 0.44 }, 0, midY - 0.12, 0.64 * G, PAL.mid, { metalness: 0.62 });
    // 胸口識別斜線(小條)
    for (const sx of [-1, 1]) {
      const v = bxF(ch, 0.3, 0.06, 0.05, sx * 0.32, midY + 0.66, 0.62 * G + 0.12, dimF(accent, 0.9), { emissive: accent, emissiveIntensity: 0.8 });
      v.rotation.z = -sx * 0.45;
    }
    // 乘員蛋艙 = 頭部座艙(2D:骷髏頭沉進圓形艙口):旋成後碗(口朝前)+ 艙口邊環 + 周視鏡
    // 頭座中心 = top + 0.42(forge 的 headYl;錨點已與 rig 校準,MUST 跟著它)
    const bowl = latheF(ch, [[0.54, 0], [0.5, 0.18], [0.36, 0.34], [0.0001, 0.42]], 12, 0, top + 0.42, 0.06, PAL.deep, { metalness: 0.6 });
    bowl.rotation.x = -Math.PI / 2;                                              // 碗口朝前(+z)、碗底朝後
    const rim = latheF(ch, [[0.5, 0], [0.6, 0.05], [0.6, 0.16], [0.5, 0.21]], 12, 0, top + 0.42, 0.38, PAL.lite, { metalness: 0.7 });
    rim.rotation.x = -Math.PI / 2;                                               // 艙口邊環(軸向 +z;亮階前置才讀得出「圓形艙口」)
    for (const sx of [-1, 1]) {
      bxF(ch, 0.09, 0.07, 0.1, sx * 0.24, top + 0.94, 0.2, PAL.deep, { metalness: 0.6 });   // 車長周視鏡對(艙口上緣)
      bxF(ch, 0.06, 0.06, 0.06, sx * 0.5, top + 0.72, 0.24, PAL.deep, { metalness: 0.7 });  // 邊環鉚座
    }
    // 胸口 V 形中脊板(2D:艙口下方的 V 領甲)—— 下尖五邊稜柱
    prismF(ch, [
      [-0.52, 0.3], [0.52, 0.3], [0.6, 0.1], [0, -0.36], [-0.6, 0.1],
    ], 0.1, 0, midY + 0.38, 0.64 * G + 0.05, PAL.mid, { metalness: 0.62 });
    // 頭後拱衛拱甲(2D:雙肩之間吞頭的深色拱)—— 馬蹄形稜柱
    prismF(ch, [
      [0.78, 0], [0.74, 0.34], [0.55, 0.62], [0.28, 0.78], [0, 0.82],
      [-0.28, 0.78], [-0.55, 0.62], [-0.74, 0.34], [-0.78, 0],
      [-0.5, 0], [-0.47, 0.24], [-0.34, 0.42], [-0.17, 0.52], [0, 0.55],
      [0.17, 0.52], [0.34, 0.42], [0.47, 0.24], [0.5, 0],
    ], 0.36, 0, top + 0.14, -0.42, PAL.deep, { metalness: 0.65 });
    // 腹部:收腰疊環楔台 ×3 + 兩側外露纜束(cablesF 多零件)
    for (let i = 0; i < 3; i++)
      tboxF(ch, { w0: 0.88 - i * 0.1, d0: 0.14, w1: 1.0 - i * 0.1, d1: 0.16, h: 0.15 }, 0, 0.56 - i * 0.15, 0.62, PAL.deep, { metalness: 0.65 });
    for (const sx of [-1, 1])
      cablesF(ch, { p0: [sx * 0.36, bot - 0.02, 0.3], p1: [sx * 0.28, 0.18, 0.28], k: 3, r: 0.04, sag: 0.05, spread: 0.025 }, GUNMETAL, { metalness: 0.75 });
    bxF(ch, 0.05, 0.34, 0.04, 0, 0.41, 0.72, accent, { emissive: accent, emissiveIntensity: 1.2 });  // 腹部中央動力亮縫(2D 移動圖的腹部發光)
    // 背部散熱堆(楔台)+散熱柵(細條)+排氣管+指揮天線
    tboxF(ch, { w0: 1.0, d0: 0.42, w1: 0.86, d1: 0.36, h: 0.6 }, 0, top + 0.02, -0.6 * G, PAL.mid, { metalness: 0.6 });
    for (let i = 0; i < 4; i++)
      bxF(ch, 0.15, 0.56, 0.08, -0.35 + i * 0.23, top + 0.02, -0.82 * G, c.dark, { metalness: 0.7 });
    for (const sx of [-1, 1]) {
      const ex = cylF(ch, 0.06, 0.06, 0.4, 8, sx * 0.42, top - 0.2, -0.72 * G, c.dark, { metalness: 0.7 });
      ex.rotation.x = 0.35;                                                      // 排氣管
      const ant = bxF(ch, 0.04, 0.6, 0.04, sx * 0.34, top + 0.55, -0.6 * G, IRON, { metalness: 0.8 });
      ant.rotation.z = sx * 0.18;                                                // 指揮天線
      bxF(ch, 0.09, 0.09, 0.09, sx * 0.43, top + 0.86, -0.6 * G, accent, { emissive: accent, emissiveIntensity: 1.2 });
      tboxF(ch, { w0: 0.26, d0: 0.5, w1: 0.32, d1: 0.42, h: 0.3, sz: -0.04 }, sx * d.shoulderX * 0.62, top + 0.08, 0.04, PAL.mid, { metalness: 0.6 });  // 護頸圍甲(填肩谷)
    }
  },
  pelvis(c, hips, d) {
    const { PAL, G } = c;
    // 主骨盆:上寬下收楔台
    tboxF(hips, { w0: 0.78 * G, d0: 0.58 * G, w1: 0.9 * G, d1: 0.68 * G, h: 0.42 }, 0, 0.04, 0, PAL.deep, { metalness: 0.6 });
    // 車首下裝甲:倒斜楔台(glacis)
    tboxF(hips, { w0: 0.7, d0: 0.13, w1: 0.55, d1: 0.1, h: 0.3, sz: -0.1 }, 0, -0.08, 0.36 * G, PAL.mid, { metalness: 0.6 });
    bxF(hips, 0.13, 0.1, 0.08, 0, -0.24, 0.36 * G, PAL.deep, { metalness: 0.7 }); // 牽引鉤
    // 尾板(倒斜)
    tboxF(hips, { w0: 0.5, d0: 0.1, w1: 0.4, d1: 0.09, h: 0.26, sz: 0.06 }, 0, -0.08, -0.44, PAL.mid, { metalness: 0.6 });
    for (const sx of [-1, 1]) {
      // 斜置裙甲楔板(上寬下收)+ ERA 反應塊 2×2
      const skirt = tboxF(hips, { w0: 0.3, d0: 0.45 * G, w1: 0.42, d1: 0.55 * G, h: 0.6 }, sx * 0.58 * G, -0.12, 0, PAL.main, { metalness: 0.6 });
      skirt.rotation.z = sx * 0.2;
      for (const oy of [-0.14, 0.14])
        for (const oz of [-0.16, 0.16])
          tboxF(skirt, { w0: 0.1, d0: 0.24, w1: 0.08, d1: 0.2, h: 0.2 }, sx * 0.19, oy, oz, PAL.mid, { metalness: 0.65 });
    }
  },
  thigh(c, l, d) {
    const { PAL, G, sx } = c;
    const ball = cylF(l, 0.2 * G, 0.2 * G, 0.3, 8, 0, 0.02, 0, PAL.deep, { metalness: 0.7 });
    ball.rotation.z = Math.PI / 2;                                               // 髖球
    // 主殼:上寬下收楔台
    tboxF(l, { w0: 0.48 * G, d0: 0.52 * G, w1: 0.56 * G, d1: 0.6 * G, h: d.len * 1.02 }, 0, -d.len * 0.5, 0.02, PAL.main, { metalness: 0.6 });
    // 大腿盾形稜柱前板
    prismF(l, [
      [-0.16 * G, 0.34], [0.16 * G, 0.34], [0.21 * G, 0.1],
      [0.13 * G, -0.3], [-0.13 * G, -0.3], [-0.21 * G, 0.1],
    ], 0.14, 0, -d.len * 0.42, 0.3 * G, PAL.mid, { metalness: 0.62 });
    hydCyl(l, 0.055, d.len * 0.62, sx * 0.16 * G, -d.len * 0.48, 0.33 * G, 0.14);  // 大腿主液壓缸
    tboxF(l, { w0: 0.18, d0: 0.14, w1: 0.22, d1: 0.17, h: 0.36 }, sx * 0.33 * G, -d.len * 0.5, -0.15 * G, PAL.mid, { metalness: 0.6 });  // 側推進莢
  },
  shin(c, l, d) {
    const { PAL, G, sx } = c;
    // 弧形膝蓋稜柱大蓋甲(2D:圓拱頂大護膝)+ 外側圓形膝樞盤
    prismF(l, [
      [-0.26 * G, 0.06], [-0.18 * G, 0.2], [0, 0.27], [0.18 * G, 0.2], [0.26 * G, 0.06],
      [0.3 * G, -0.14], [0.14 * G, -0.24], [-0.14 * G, -0.24], [-0.3 * G, -0.14],
    ], 0.26, 0, -0.04, 0.24 * G, PAL.mid, { metalness: 0.62 });
    const hub = cylF(l, 0.1, 0.1, 0.07, 10, sx * 0.3 * G, -0.03, 0.24 * G, PAL.deep, { metalness: 0.75 });
    hub.rotation.z = Math.PI / 2;                                                // 膝樞盤(2D 的膝側圓螺栓)
    for (const ox of [-0.13, 0.13])                                              // 膝後雙活塞桿
      cylF(l, 0.04, 0.04, d.len * 0.55, 6, ox, -d.len * 0.3, -0.3 * G, IRON, { metalness: 0.85 }).rotation.x = -0.18;
    // 主脛殼:上寬下收楔台 + 踝部外擴楔台
    tboxF(l, { w0: 0.4 * G, d0: 0.44 * G, w1: 0.52 * G, d1: 0.56 * G, h: d.len }, 0, -d.len * 0.5, -0.02, PAL.main, { metalness: 0.6 });
    tboxF(l, { w0: 0.48 * G, d0: 0.5 * G, w1: 0.36 * G, d1: 0.4 * G, h: 0.34 }, 0, -d.len * 0.86, 0, PAL.main, { metalness: 0.6 });
    // 脛前稜線板
    tboxF(l, { w0: 0.24 * G, d0: 0.12, w1: 0.18 * G, d1: 0.09, h: d.len * 0.5, sz: 0.05 }, 0, -d.len * 0.52, 0.26 * G, PAL.mid, { metalness: 0.62 });
    tboxF(l, { w0: 0.3 * G, d0: 0.16, w1: 0.34 * G, d1: 0.2, h: 0.3 }, 0, -d.len * 0.6, -0.3 * G, PAL.mid, { metalness: 0.6 });  // 腿肚配重
  },
  foot(c, l, d) {
    const { PAL } = c;
    // 巨足:中段平台 + 雙趾楔(左右各一,前低斜面)+ 跟配重(後斜)
    tboxF(l, { w0: 0.5, d0: d.footL, w1: 0.42, d1: d.footL * 0.8, h: 0.22 }, 0, -d.clear * 0.5, d.footL * 0.15, PAL.deep, { metalness: 0.6 });
    for (const ox of [-0.14, 0.14])
      tboxF(l, { w0: 0.23, d0: 0.26, w1: 0.18, d1: 0.14, h: 0.14, sz: -0.06 }, ox, -d.clear * 0.4, d.footL * 0.58, PAL.mid, { metalness: 0.6 });
    tboxF(l, { w0: 0.36, d0: 0.18, w1: 0.3, d1: 0.12, h: 0.16, sz: 0.05 }, 0, -d.clear * 0.42, -d.footL * 0.34, PAL.mid, { metalness: 0.6 });
  },
  armUp(c, a, d) {
    const { PAL, accent, G, sx } = c;
    // 球形巨肩(吞頭):旋成體圓頂 + 底緣邊環 + 緯線分模帶 + 識別稜柱面板 + 前簷
    const pd = new THREE.Group();
    pd.position.set(sx * 0.24, 0.09, 0);
    pd.rotation.z = -sx * 0.18;
    a.add(pd);
    // 圓頂加大加高:2D 定案的球肩要高過頭側「吞頭」
    latheF(pd, [[0.44 * G, 0], [0.5 * G, 0.12], [0.49 * G, 0.32], [0.4 * G, 0.55], [0.24 * G, 0.72], [0.0001, 0.82]], 12, 0, 0, 0, PAL.main, { metalness: 0.62 });
    latheF(pd, [[0.5 * G, 0], [0.56 * G, 0.05], [0.56 * G, 0.15], [0.5 * G, 0.19]], 12, 0, -0.09, 0, PAL.mid, { metalness: 0.7 });     // 底緣邊環
    latheF(pd, [[0.46 * G, 0], [0.48 * G, 0.04], [0.46 * G, 0.08]], 12, 0, 0.36, 0, PAL.deep, { metalness: 0.7 });                     // 緯線分模帶
    const badge = prismF(pd, [
      [-0.22, 0.15], [0.22, 0.15], [0.29, -0.02], [0, -0.2], [-0.29, -0.02],
    ], 0.05, 0, 0.34, 0.44 * G, dimF(accent, 0.85), { metalness: 0.5 });
    badge.rotation.x = -0.42;                                                    // 識別五邊面板(貼圓頂前坡)
    tboxF(pd, { w0: 0.4 * G, d0: 0.12, w1: 0.46 * G, d1: 0.14, h: 0.26 }, 0, -0.2, 0.4 * G, PAL.mid, { metalness: 0.6 });              // 肩甲下垂前簷
    // 細上臂軸(楔台,與巨肩/巨前臂形成反差)
    tboxF(a, { w0: 0.2, d0: 0.24, w1: 0.26, d1: 0.3, h: d.len * 0.95 }, 0, -d.len * 0.55, 0, PAL.deep, { metalness: 0.65 });
  },
  armFore(c, a, d) {
    const { PAL, G, sx } = c;
    // 肘關節環(旋成體,軸向 = 肘鉸鏈 x)
    const el = latheF(a, [[0.16, 0], [0.2, 0.04], [0.2, 0.12], [0.16, 0.16]], 10, 0, 0.02, 0, PAL.deep, { metalness: 0.75 });
    el.rotation.z = Math.PI / 2;
    // 巨手甲主殼:向腕端外擴的楔台(粗於上臂)
    tboxF(a, { w0: 0.46 * G, d0: 0.5 * G, w1: 0.34 * G, d1: 0.38 * G, h: d.len }, 0, -d.len * 0.5, 0.02, PAL.main, { metalness: 0.6 });
    // 外側疊層甲板 ×2(楔台)
    tboxF(a, { w0: 0.12, d0: 0.3 * G, w1: 0.1, d1: 0.36 * G, h: 0.4 }, sx * 0.27 * G, -d.len * 0.32, 0, PAL.mid, { metalness: 0.62 });
    tboxF(a, { w0: 0.13, d0: 0.34 * G, w1: 0.1, d1: 0.3 * G, h: 0.38 }, sx * 0.3 * G, -d.len * 0.68, 0.02, PAL.mid, { metalness: 0.62 });
    // 腕口外擴楔台
    tboxF(a, { w0: 0.5 * G, d0: 0.54 * G, w1: 0.42 * G, d1: 0.46 * G, h: 0.26 }, 0, -d.len * 0.9, 0.02, PAL.main, { metalness: 0.6 });
    hydCyl(a, 0.04, d.len * 0.5, -sx * 0.13 * G, -d.len * 0.35, 0.28 * G, -0.3); // 前臂液壓缸
  },
  mount(c, F) {
    const { PAL, accent, G, K } = c;
    const REST = 1.36, AIM = { sh: -0.78, el: -0.52 }, AIMA = 1.57 - (AIM.sh + AIM.el);
    // 分段爪指(2D 簽名):拳眼楔台 + 每指節座楔台 + 薄刃爪尖(finF),拇指同制
    const fist = (hand, inn) => {
      tboxF(hand, { w0: 0.34, d0: 0.38, w1: 0.3, d1: 0.34, h: 0.3 }, 0, -0.12, 0.02, c.dark, { metalness: 0.65 });
      for (let i = 0; i < 4; i++) {
        const fx = (i - 1.5) * 0.095;
        const seg = tboxF(hand, { w0: 0.075, d0: 0.09, w1: 0.06, d1: 0.075, h: 0.17 }, fx, -0.26, 0.14, PAL.deep, { metalness: 0.6 });
        seg.rotation.x = 2.5;                                                    // 節座:自拳眼向前下彎
        const claw = finF(hand, { len: 0.24, w0: 0.06, w1: 0.014, t: 0.07, sweep: -0.1 }, fx, -0.3, 0.22, PAL.mid, { metalness: 0.7 });
        claw.rotation.x = Math.PI - 0.6;                                         // 爪尖回勾向下
      }
      const th = tboxF(hand, { w0: 0.07, d0: 0.085, w1: 0.055, d1: 0.07, h: 0.15 }, inn * 0.19, -0.18, 0.06, PAL.deep, { metalness: 0.6 });
      th.rotation.z = inn * 1.0;
      const tc = finF(hand, { len: 0.18, w0: 0.055, w1: 0.012, t: 0.06, sweep: -0.08 }, inn * 0.27, -0.22, 0.1, PAL.mid, { metalness: 0.7 });
      tc.rotation.set(Math.PI - 0.8, 0, inn * 0.8);
    };
    fist(F.handR, -1);
    fist(F.handL, 1);
    // ── 右手斧砲:轉輪榴彈鼓(鼓軸 MUST ∥ 砲軸)+ 階梯旋成砲管 + 鋸齒月牙斧刃 ──
    const gr = new THREE.Group();
    gr.position.set(0.22, -0.2, 0.28);
    gr.rotation.set(REST, 0, 0.14);
    F.handR.add(gr);
    const BL = 1.7 * K.barrelF;
    tboxF(gr, { w0: 0.42, d0: 0.42, w1: 0.34, d1: 0.36, h: 0.55 }, 0, 0.1, 0, PAL.mid, { metalness: 0.7 });   // 後膛托(楔台)
    bxF(gr, 0.14, 0.24, 0.2, 0, -0.2, -0.22, c.dark, { metalness: 0.7 });        // 握把
    // 轉輪榴彈鼓:旋成鼓身(倒角)+六膛室+鼓軸
    latheF(gr, [[0.26, 0], [0.31, 0.04], [0.31, 0.32], [0.26, 0.36]], 12, 0, 0.37, 0.08, PAL.main, { metalness: 0.65 });
    for (let i = 0; i < 6; i++) {
      const th = i / 6 * Math.PI * 2;
      cylF(gr, 0.05, 0.05, 0.38, 6, Math.cos(th) * 0.19, 0.55, 0.08 + Math.sin(th) * 0.19, COAL);  // 六膛室 ∥ 砲管
    }
    cylF(gr, 0.07, 0.07, 0.42, 8, 0, 0.55, 0.08, COAL, { metalness: 0.8 });      // 鼓軸
    cylF(gr, 0.21, 0.21, 0.1, 10, 0, 0.78, 0, PAL.mid, { metalness: 0.75 });     // 砲根束環
    // 152mm 階梯砲管:單支旋成體(粗膛→束環凸帶→前段收徑)
    latheF(gr, [
      [0.2, 0], [0.2, 0.22], [0.165, 0.28], [0.165, BL * 0.5],
      [0.19, BL * 0.54], [0.19, BL * 0.6], [0.155, BL * 0.64], [0.155, BL * 0.96], [0.17, BL],
    ], 10, 0, 0.8, 0, GUNMETAL, { metalness: 0.82 });
    for (const ox of [-0.2, 0.2])
      cylF(gr, 0.06, 0.06, BL * 0.5, 6, ox, 0.75 + BL * 0.35, -0.09, IRON, { metalness: 0.8 });  // 駐退復進雙筒
    latheF(gr, [[0.16, 0], [0.24, 0.05], [0.25, 0.14], [0.2, 0.22], [0.22, 0.3]], 10, 0, 0.8 + BL, 0, INK, { metalness: 0.85 });  // 旋成制退器
    const hMuz = cylF(gr, 0.19, 0.19, 0.1, 10, 0, 1.14 + BL, 0, accent, { emissive: accent, emissiveIntensity: 0.3 });
    // 鋸齒月牙斧刃(稜柱鋸齒輪廓;silhouette 在 zy 面,厚度沿 x)
    const axe = new THREE.Group();
    axe.position.set(0.22, 0.8 + BL * 0.55, 0.02);
    gr.add(axe);
    const blade = prismF(axe, [
      [0.14, 0.98],                                                              // 上月牙回勾角
      [0.5, 0.8], [0.42, 0.66], [0.62, 0.52], [0.5, 0.36], [0.72, 0.24],
      [0.58, 0.08], [0.78, -0.06], [0.6, -0.2], [0.72, -0.36], [0.52, -0.5], [0.56, -0.68],
      [0.16, -0.92],                                                             // 下月牙角
      [0.3, -0.5], [0.36, -0.05], [0.32, 0.5],                                   // 內凹緣(貼砲管側)
    ].map(([px, py]) => [px * 1.12, py * 1.12]), 0.1, 0, 0, 0, PAL.mid, { metalness: 0.72 });  // 整片放大貼齊 2D 比例
    blade.rotation.y = -Math.PI / 2;
    bxF(axe, 0.1, 1.4, 0.06, 0, 0, 0.42, dimF(accent, 0.9), { emissive: accent, emissiveIntensity: 0.5 });  // 刃面月牙符文亮線(細條)
    const hook = prismF(axe, [[-0.1, 0.3], [-0.46, 0.02], [-0.1, -0.26]], 0.07, 0, 0, 0, c.dark, { metalness: 0.7 });
    hook.rotation.y = -Math.PI / 2;                                              // 斧背反刃鉤(三角稜柱)
    tboxF(axe, { w0: 0.3, d0: 0.44, w1: 0.24, d1: 0.36, h: 0.92 }, -0.1, 0, 0.1, c.dark, { metalness: 0.7 });  // 刃座跨接楔台(接回砲管)
    // ── 左手 Kord 重機槍:波紋散熱套筒(旋成體)+ 彈鏈箱 + 黃銅彈鏈節 ──
    const gl = new THREE.Group();
    gl.position.set(-0.22, -0.2, 0.28);
    gl.rotation.set(REST, 0, -0.14);
    F.handL.add(gl);
    const KL = 1.3 * K.barrelF;
    tboxF(gl, { w0: 0.26, d0: 0.3, w1: 0.3, d1: 0.34, h: 0.48 }, 0, 0.06, 0, PAL.mid, { metalness: 0.7 });   // 機匣(楔台)
    bxF(gl, 0.12, 0.22, 0.18, 0, -0.18, -0.2, c.dark, { metalness: 0.7 });       // 握把
    // 波紋散熱套筒:單支旋成體(Kord 識別)
    latheF(gl, [
      [0.115, 0], [0.135, 0.05], [0.1, 0.09], [0.135, 0.14], [0.1, 0.18], [0.135, 0.23],
      [0.1, 0.27], [0.135, 0.32], [0.1, 0.36], [0.135, 0.41], [0.1, 0.45], [0.125, 0.5], [0.08, 0.55],
    ], 10, 0, 0.28, 0, GUNMETAL, { metalness: 0.8 });
    cylF(gl, 0.065, 0.065, KL - 0.53, 8, 0, 0.83 + (KL - 0.53) / 2, 0, GUNMETAL, { metalness: 0.82 });  // 前段槍管
    latheF(gl, [[0.07, 0], [0.12, 0.03], [0.12, 0.12], [0.08, 0.16]], 8, 0, 0.3 + KL, 0, INK, { metalness: 0.85 });  // 旋成制退器
    const lMuz = cylF(gl, 0.07, 0.07, 0.08, 8, 0, 0.5 + KL, 0, accent, { emissive: accent, emissiveIntensity: 0.8 });
    tboxF(gl, { w0: 0.3, d0: 0.26, w1: 0.26, d1: 0.22, h: 0.38 }, -0.25, 0.12, 0.02, PAL.main, { metalness: 0.6 });  // 彈鏈箱(楔台,外側掛)
    bxF(gl, 0.24, 0.06, 0.2, -0.25, 0.33, 0.02, dimF(accent, 0.8));              // 彈箱蓋識別
    for (let i = 0; i < 4; i++) {                                                // 黃銅彈鏈節(小塊,拱進機匣)
      const lk = bxF(gl, 0.07, 0.05, 0.1, -0.2 + i * 0.07, 0.36 + Math.sin(i / 3 * Math.PI) * 0.05, 0.02, BRASS, { metalness: 0.85 });
      lk.rotation.z = 0.5 - i * 0.33;
    }
    bxF(gl, 0.06, 0.36, 0.09, 0, 0.24, -0.24, IRON, { metalness: 0.7 });         // 提把
    return {
      gunR: { g: gr, rest: REST, aim: AIMA }, gunL: { g: gl, rest: REST, aim: AIMA },
      muzzles: { light: { n: lMuz, r: 0.07 }, heavy: { n: hMuz, r: 0.2 } },
      lightGlowM: [lMuz], heavyGlowM: [hMuz], heavyPivot: [],
      weap: { light: 'L', heavy: 'R' },
      hvy: { armR: 0.22, armL: 0.1, chest: 0.07, gun: 0.06 },
      aimPose: { rShoulderX: AIM.sh, rElbowX: AIM.el, lShoulderX: AIM.sh, lShoulderY: 0, lElbowX: AIM.el },
      wpn: { light: { nodes: [gl], ref: gl, muz: lMuz, fwd: 'y' }, heavy: { nodes: [gr], ref: gr, muz: hMuz, fwd: 'y' } },
    };
  },
};
