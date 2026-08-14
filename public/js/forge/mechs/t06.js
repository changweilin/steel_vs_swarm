// ============ t06 逐機零件檔(自 forge.js MECH_DETAIL 拆出;dev-only)============
// // ── t06「輕功」齊天式(monkey 人形地面型):掌行長臂、金箍猴面、肩扛如意棒、尾砲 ──
// 2D 定案圖:public/assets/cyberpunk_art/mechs/t06_ground_static.jpg / t06_ground_moving.jpg / t06_flight_static.jpg
// 幾何語彙一律取自 ../geo.js(多面體字母表);MUST NOT 在本檔自建 BufferGeometry。
// 2026-08-12 多面體改寫:主殼一律 tboxF/prismF/latheF(bxF 只留小塊);
// 尾巴 = chainF 十節收分節鏈(2D 是 10+ 節球關節收分尾)、
// 噴焰翎 = fanF 雙層羽扇(外層橙焰 + 內層亮黃芯,一片一零件)、
// 四肢 = 細楔台殼 + 金腱桿(hydCyl 亮芯)+ 圓盤關節(latheF 金盤)的外露構架語彙。
import * as THREE from 'three';
import {
  matF, dimF, bxF, cylF, sphF, coneF, torusF, tboxF, prismF, latheF, finF, fanF, chainF, cablesF,
  hydCyl, sinew, seg2, IRON, GUNMETAL, COAL, INK, BONE, BRASS,
} from '../geo.js';

// 本機專用色:2D 臉色近似膚色 / 暗金虎皮裙 / 亮金腱芯
const SKIN = 0xd8b68a, DGOLD = 0xa8802a, TENDON = 0xffd76a;

export default {
  label: '齊天式(t06 變形者・地面型)',
  prop: { hips: 0.42, legSplay: 0.1, thigh: 0.44, shin: 0.42, shoulderY: 0.78, shoulderX: 0.18, upperArm: 0.3, foreArm: 0.31, head: 0.83, girth: 0.85 },
  // limb:掌行猿 —— 同 t03:前肢承重走趾行曲線、後足蹠行(見 gaitcurve.js POSTURE)
  gait: { strideF: 1.15, bob: 0.14, sway: 0.09, top: 8.5, armBase: 0.15, legBase: -0.1,
    limb: { fore: 'digitigrade', hind: 'plantigrade' } },
  knuckle: true,                                                                 // 掌行:前肢是前腳(rig.knuckle)
  moveSig: { poise: 0.38, idleF: 1.92, idleA: 1.05, launch: 0.94, spool: 0.08, brake: 0.6, settle: 0.42 },
  castSig: { omni: 'dance', dir: 'swing' },
  doc: [
    ['head', '猴面 = prismF 臉板(膚色)+怒眉稜+楔台圓吻;金箍 = torusF 頭環+前額雙螺旋圈;紫金冠 = finF 雙翎'],
    ['chest', 'tboxF 收分胸艙+prismF 雙胸甲+cablesF 腰腹金纜;噴焰翎 = fanF 雙層羽扇 ×2(一片一零件)'],
    ['hips', 'tboxF 裸內構+accent 腰帶+latheF 尾根金環+prismF 虎皮裙鋸齒垂片 ×3'],
    ['leg ×2', '細楔台殼+latheF 圓盤關節+hydCyl 金腱+楔趾爪 ×3+latheF 足底噴口'],
    ['arm ×2', '2 倍長掌行臂:latheF 球肩+細楔台收分殼+cablesF 黑肌束+裸缸亮芯'],
    ['hand ×2', '掌行前腳(prismF 掌背甲+三指 ×2 節分節指+分節拇指)'],
    ['武裝', '肩扛如意棒(latheF 金棒身+雙箍+槍口環)+chainF 十節尾+latheF 階狀熔核砲(重)'],
  ],
  head(c, h) {
    const { PAL, accent, G } = c;
    // 盔頂圓頂(latheF 旋成體,後移讓出臉板)
    latheF(h, [[0.20 * G, -0.04], [0.265 * G, 0.06], [0.245 * G, 0.17], [0.15 * G, 0.26], [0.0001, 0.30]], 12, 0, 0, -0.07, PAL.main, { metalness: 0.5 });
    // 猴面臉板(prismF 圓角輪廓;膚色近似 2D 臉色)
    const face = [[-0.13, -0.13], [-0.05, -0.19], [0.05, -0.19], [0.13, -0.13], [0.19, 0.05], [0.13, 0.15], [-0.13, 0.15], [-0.19, 0.05]]
      .map(([x, y]) => [x * G, y * G]);
    prismF(h, face, 0.07, 0, 0.05, 0.19, SKIN, { metalness: 0.15 });
    // 怒眉稜(prismF 中央下壓的 V 帶)
    const brow = [[-0.16, 0.02], [0, -0.01], [0.16, 0.02], [0.16, 0.07], [0, 0.045], [-0.16, 0.07]].map(([x, y]) => [x * G, y * G]);
    prismF(h, brow, 0.05, 0, 0.135, 0.225, PAL.deep, { metalness: 0.5 });
    // 短圓吻雷公嘴(tboxF 前收分;梢端微下垂)+ 嘴縫
    const muzz = tboxF(h, { w0: 0.20 * G, d0: 0.13, w1: 0.14 * G, d1: 0.09, h: 0.14, sz: -0.012 }, 0, -0.055, 0.26, SKIN, { metalness: 0.15 });
    muzz.rotation.x = Math.PI / 2;
    bxF(h, 0.09, 0.018, 0.02, 0, -0.1, 0.32, INK);
    // 金箍(torusF 頭環)+ 前額雙螺旋圈飾(2D 額前兩個明顯金圈)
    const band = torusF(h, 0.21, 0.036, 0, 0.185, -0.05, BRASS, { metalness: 0.85, emissive: BRASS, emissiveIntensity: 0.4 });
    band.rotation.x = Math.PI / 2;
    for (const sx of [-1, 1]) {
      const coil = torusF(h, 0.045, 0.015, sx * 0.05 * G, 0.23, 0.16, BRASS, { metalness: 0.85, emissive: BRASS, emissiveIntensity: 0.25 });
      coil.rotation.x = -0.25;
      coil.rotation.y = sx * 0.15;
      // 紫金冠雙翎(finF 後掠帶拱)
      const fe = finF(h, { len: 0.55, w0: 0.07, w1: 0.025, t: 0.035, sweep: 0.16, camber: 0.06 }, sx * 0.13 * G, 0.24, -0.05, BRASS, { metalness: 0.7, emissive: BRASS, emissiveIntensity: 0.3 });
      fe.rotation.z = -sx * 0.55;
      fe.rotation.x = -0.55;
      // 圓盤猴耳(latheF 側向圓盤)+ 金色耳軸
      const ear = latheF(h, [[0.02, -0.025], [0.085, -0.02], [0.1, 0], [0.085, 0.02], [0.02, 0.025]], 10, sx * 0.27 * G, 0.06, 0, PAL.mid, { metalness: 0.6 });
      ear.rotation.z = Math.PI / 2;
      const hub = cylF(h, 0.035, 0.035, 0.03, 8, sx * 0.30 * G, 0.06, 0, BRASS, { metalness: 0.85 });
      hub.rotation.z = Math.PI / 2;
      // 火眼金睛(眉稜下、臉板上微凸)
      sphF(h, 0.05, sx * 0.085 * G, 0.10, 0.21, 0xffd76a, { emissive: 0xffd76a, emissiveIntensity: 1.6 });
    }
    // 頸部金色管束(cablesF 多零件;2D 頸側可見)
    cablesF(h, { p0: [0, -0.05, 0.02], p1: [0, -0.34, -0.06], k: 4, r: 0.024, sag: 0.015, spread: 0.07 }, BRASS, { metalness: 0.8 });
  },
  chest(c, ch, d) {
    const { PAL, accent, G } = c;
    const top = d.shoulderY, bot = d.waistY;
    // 圓潤胸艙(tboxF 收分:肩寬腰窄、頂面微前傾 = 掌行前傾剪影)
    tboxF(ch, { w0: d.shoulderX * 1.1, d0: 0.6 * G, w1: d.shoulderX * 1.62, d1: 0.8 * G, h: (top - bot) * 0.72, sz: 0.05 }, 0, top - (top - bot) * 0.3, 0, PAL.main, { metalness: 0.5 });
    // 左右胸甲護板(prismF 圓角六角;2D 前胸是成對圓潤甲片)
    const pec = [[-0.16, -0.28], [0.16, -0.24], [0.28, 0], [0.2, 0.22], [-0.2, 0.26], [-0.26, -0.02]];
    for (const sx of [-1, 1])
      prismF(ch, pec.map(([x, y]) => [sx * x, y]), 0.09, sx * 0.27 * G, top - 0.42, 0.32, PAL.lite, { metalness: 0.5 });
    // 領口金環(2D 頸基金色纜圈)+ 胸前識別燈
    const col = torusF(ch, 0.17, 0.032, 0, top - 0.08, 0.04, BRASS, { metalness: 0.85 });
    col.rotation.x = Math.PI / 2;
    tboxF(ch, { w0: 0.5, d0: 0.05, w1: 0.4, d1: 0.05, h: 0.08 }, 0, top - 0.72, 0.30, accent, { emissive: accent, emissiveIntensity: 1.0 });
    // 腰腹:裸內構核心(tboxF)+ 金色管束(cablesF;2D 裸露腰腹的金管)
    tboxF(ch, { w0: 0.34, d0: 0.3, w1: 0.28, d1: 0.34, h: (top - bot) * 0.42 }, 0, bot + 0.22, -0.05, GUNMETAL, { metalness: 0.7 });
    cablesF(ch, { p0: [0, bot + 0.55, 0.08], p1: [0, bot - 0.55, 0.05], k: 4, r: 0.028, sag: 0.02, spread: 0.1 }, BRASS, { metalness: 0.8 });
    // 搶修背包(tboxF 收分)+ 摺收械爪(prismF 鉤形)+ 工具匣 + 警示條
    tboxF(ch, { w0: 0.62 * G, d0: 0.34, w1: 0.5 * G, d1: 0.26, h: 0.62, sz: -0.05 }, 0, top - 0.5, -0.5 * G, PAL.mid, { metalness: 0.55 });
    const claw = [[0.02, 0], [0.12, 0.02], [0.20, 0.10], [0.22, 0.22], [0.16, 0.32], [0.13, 0.24], [0.14, 0.13], [0.07, 0.06], [0.02, 0.05]];
    const cw = prismF(ch, claw, 0.07, 0.24 * G, top - 0.55, -0.62 * G, PAL.deep, { metalness: 0.6 });
    cw.rotation.y = Math.PI / 2;
    const hgc = cylF(ch, 0.05, 0.05, 0.1, 8, 0.24 * G, top - 0.55, -0.60 * G, IRON, { metalness: 0.8 });
    hgc.rotation.z = Math.PI / 2;
    tboxF(ch, { w0: 0.2, d0: 0.12, w1: 0.16, d1: 0.1, h: 0.26 }, -0.24 * G, top - 0.44, -0.62 * G, PAL.main, { metalness: 0.5 });
    bxF(ch, 0.16, 0.05, 0.02, -0.24 * G, top - 0.28, -0.71 * G, accent, { emissive: accent, emissiveIntensity: 0.8 });
    for (const sx of [-1, 1]) {
      // 光翼翼根盒(tboxF;地面熄滅,只留發光縫)
      const wr = tboxF(ch, { w0: 0.2, d0: 0.3, w1: 0.15, d1: 0.24, h: 0.15, sz: -0.03 }, sx * 0.42 * G, top - 0.15, -0.55 * G, PAL.deep, { metalness: 0.7 });
      bxF(wr, 0.14, 0.03, 0.22, 0, 0.09, 0, dimF(accent, 0.9), { emissive: accent, emissiveIntensity: 0.7 });
      // 噴焰翎:latheF 噴口 + fanF 雙層羽扇(2D 背後兩簇火焰;外層橙焰 + 內層亮黃芯)
      const nz = -0.5 * G;
      const noz = latheF(ch, [[0.07, 0], [0.095, 0.05], [0.078, 0.13], [0.105, 0.20], [0.095, 0.25]], 10, sx * 0.3 * G, top - 0.12, nz, PAL.mid, { metalness: 0.7 });
      noz.rotation.set(-0.7, 0, -sx * 0.38);
      const fx = sx * (0.3 * G + 0.09), fy = top + 0.05, fz = nz - 0.155;
      const fo = fanF(ch, { n: 4, arc: 1.0, len: 0.9, edgeF: 0.55, gap: 0.02, fin: { w0: 0.2, w1: 0.05, t: 0.06, sweep: 0.16, camber: 0.14 } }, fx, fy, fz, 0xff8c2a, { emissive: 0xff6a1a, emissiveIntensity: 0.85 });
      fo.g.rotation.set(-0.7, 0, -sx * 0.38);
      const fi = fanF(ch, { n: 3, arc: 0.66, len: 0.6, edgeF: 0.6, gap: 0.026, fin: { w0: 0.12, w1: 0.035, t: 0.045, sweep: 0.1, camber: 0.1 } }, fx, fy, fz + 0.016, 0xffe9a8, { emissive: 0xffd76a, emissiveIntensity: 1.6 });
      fi.g.rotation.set(-0.7, 0, -sx * 0.38);
      // 噴焰翎的錨(位置 + 朝向):飛行型在同一個錨上接**會動的**噴射尾焰(jetF)與焰尾凝結雲。
      // 讓飛行檔自己抄一份座標的話,這裡改了噴口位置那邊不會跟著改(而兩張圖分開看都正常)。
      (c.jetPods || (c.jetPods = [])).push({ x: fx, y: fy, z: fz, rot: [-0.7, 0, -sx * 0.38], sx });
    }
  },
  pelvis(c, hips, d) {
    const { PAL, accent, G } = c;
    // 裸露內構骨盆(tboxF 收分)+ accent 腰帶
    tboxF(hips, { w0: 0.58 * G, d0: 0.46 * G, w1: 0.64 * G, d1: 0.5 * G, h: 0.34 }, 0, 0, 0, GUNMETAL, { metalness: 0.7 });
    tboxF(hips, { w0: 0.66 * G, d0: 0.54 * G, w1: 0.6 * G, d1: 0.5 * G, h: 0.09 }, 0, 0.2, 0, accent, { emissive: accent, emissiveIntensity: 0.9 });
    // 尾根關節金環(latheF;chainF 尾自此接出)
    const tc = latheF(hips, [[0.07, -0.045], [0.115, -0.02], [0.115, 0.02], [0.07, 0.045]], 10, 0, -0.05, -0.24, BRASS, { metalness: 0.85 });
    tc.rotation.x = Math.PI / 2;
    // 虎皮裙腰甲(prismF 鋸齒垂片 ×3:前 + 兩側;暗金)
    const pelt = [[-0.10, -0.26], [-0.05, -0.34], [0, -0.26], [0.05, -0.34], [0.10, -0.26], [0.16, -0.10], [0.14, 0.04], [-0.14, 0.04], [-0.16, -0.10]]
      .map(([x, y]) => [x * G, y * G]);
    const fr = prismF(hips, pelt, 0.05, 0, -0.02, 0.27 * G, DGOLD, { metalness: 0.4 });
    fr.rotation.x = -0.45;
    for (const sx of [-1, 1]) {
      const sp = prismF(hips, pelt.map(([x, y]) => [x * 0.85, y * 0.85]), 0.05, sx * 0.3 * G, -0.02, 0.06, DGOLD, { metalness: 0.4 });
      sp.rotation.z = sx * 0.5;
      sp.rotation.y = sx * 0.9;
    }
  },
  thigh(c, l, d) {
    const { PAL, G } = c;
    // 細楔台殼(膝端收分;2D 四肢是纖細構架不是方盒)
    tboxF(l, { w0: 0.18 * G, d0: 0.22 * G, w1: 0.3 * G, d1: 0.34 * G, h: d.len * 1.0 }, 0, -d.len * 0.5, 0.02, PAL.main, { metalness: 0.5 });
    // 髖側金色圓盤關節(latheF)
    const hd = latheF(l, [[0.02, -0.03], [0.10, -0.024], [0.115, 0], [0.10, 0.024], [0.02, 0.03]], 10, c.sx * 0.17 * G, -0.03, 0.02, BRASS, { metalness: 0.85 });
    hd.rotation.z = Math.PI / 2;
    // 大腿外側琥珀甲片(prismF 六角)
    const pl = [[-0.09, -0.32], [0.09, -0.32], [0.13, -0.05], [0.09, 0.18], [-0.09, 0.18], [-0.13, -0.05]];
    const p = prismF(l, pl, 0.05, c.sx * 0.17 * G, -d.len * 0.45, 0.02, PAL.lite, { metalness: 0.5 });
    p.rotation.y = c.sx * Math.PI / 2;
    // 後側金腱桿(hydCyl 亮芯)
    hydCyl(l, 0.032, d.len * 0.5, -c.sx * 0.1 * G, -d.len * 0.55, -0.14 * G, 0.1, TENDON);
  },
  shin(c, l, d) {
    const { PAL, G } = c;
    // 細瘦露構造小腿(tboxF 踝端收分)
    tboxF(l, { w0: 0.13 * G, d0: 0.15 * G, w1: 0.19 * G, d1: 0.22 * G, h: d.len * 1.0 }, 0, -d.len * 0.5, 0, GUNMETAL, { metalness: 0.7 });
    // 金色圓盤膝軸(latheF)
    const kd = latheF(l, [[0.02, -0.028], [0.085, -0.022], [0.1, 0], [0.085, 0.022], [0.02, 0.028]], 10, c.sx * 0.12 * G, -0.01, 0, BRASS, { metalness: 0.85 });
    kd.rotation.z = Math.PI / 2;
    // 後側金腱桿 + 足底噴口(latheF 喇叭口,朝後)
    hydCyl(l, 0.026, d.len * 0.5, -c.sx * 0.07 * G, -d.len * 0.5, -0.12 * G, 0.08, TENDON);
    const nz = latheF(l, [[0.028, 0], [0.052, 0.035], [0.045, 0.08], [0.062, 0.13]], 8, 0, -d.len * 0.94, -0.12, COAL, { metalness: 0.8 });
    nz.rotation.x = -0.5;
  },
  foot(c, l, d) {
    const { PAL } = c;
    // 足身楔台 + 三楔趾爪(tboxF 收分、梢端下勾)+ 後爪
    tboxF(l, { w0: 0.3, d0: d.footL * 0.75, w1: 0.22, d1: d.footL * 0.55, h: 0.13, sz: 0.05 }, 0, -d.clear * 0.5, d.footL * 0.08, PAL.deep, { metalness: 0.5 });
    for (const ox of [-0.1, 0, 0.1]) {
      const toe = tboxF(l, { w0: 0.08, d0: 0.09, w1: 0.045, d1: 0.045, h: 0.26, sz: 0.05 }, ox, -d.clear * 0.5, d.footL * 0.42, BONE, { metalness: 0.7 });
      toe.rotation.x = Math.PI / 2;
    }
    tboxF(l, { w0: 0.12, d0: 0.12, w1: 0.07, d1: 0.08, h: 0.1 }, 0, -d.clear * 0.48, -d.footL * 0.26, BONE, { metalness: 0.7 });
  },
  armUp(c, a, d) {
    const { PAL, G } = c;
    // 球肩圓頂(latheF)+ 外側金盤關節
    latheF(a, [[0.15 * G, -0.02], [0.18 * G, 0.03], [0.15 * G, 0.09], [0.07 * G, 0.14], [0.0001, 0.16]], 12, 0, 0, 0, PAL.main, { metalness: 0.5 });
    const sd = latheF(a, [[0.02, -0.026], [0.09, -0.02], [0.10, 0], [0.09, 0.02], [0.02, 0.026]], 10, c.sx * 0.15 * G, 0.02, 0, BRASS, { metalness: 0.85 });
    sd.rotation.z = Math.PI / 2;
    // 細楔台臂殼(肘端收分;2D 纖細管狀構架)
    tboxF(a, { w0: 0.14 * G, d0: 0.16 * G, w1: 0.21 * G, d1: 0.24 * G, h: d.len * 0.95 }, 0, -d.len * 0.5, 0.01, PAL.main, { metalness: 0.5 });
    // 黑色柔性肌束(cablesF 兩條各自成件)+ 裸缸亮桿芯
    cablesF(a, { p0: [c.sx * 0.1 * G, -0.15, -0.09], p1: [c.sx * 0.07 * G, -d.len * 0.9, -0.05], k: 2, r: 0.034, sag: 0.03, spread: 0.024 }, GUNMETAL, { metalness: 0.6 });
    hydCyl(a, 0.032, d.len * 0.55, -c.sx * 0.12 * G, -d.len * 0.62, 0.14 * G, -0.1, 0xd8d4c8);
  },
  armFore(c, a, d) {
    const { PAL, G } = c;
    // 前臂細楔台殼(腕端收分)+ 金色肘軸盤 + 金腱桿
    tboxF(a, { w0: 0.11 * G, d0: 0.13 * G, w1: 0.17 * G, d1: 0.19 * G, h: d.len * 0.96 }, 0, -d.len * 0.5, 0.01, PAL.mid, { metalness: 0.6 });
    const ed = latheF(a, [[0.02, -0.024], [0.08, -0.018], [0.09, 0], [0.08, 0.018], [0.02, 0.024]], 10, c.sx * 0.11 * G, -0.01, 0, BRASS, { metalness: 0.85 });
    ed.rotation.z = Math.PI / 2;
    hydCyl(a, 0.028, d.len * 0.5, c.sx * 0.09 * G, -d.len * 0.55, 0.1 * G, -0.06, TENDON);
  },
  mount(c, F) {
    const { PAL, accent, G, K, H } = c;
    // 掌行前腳:楔台平攤掌 + prismF 掌背甲 + 三指 ×2 節分節指 + 分節拇指(雙手同型;武器全機載)
    for (const [g, sx] of [[F.handL, -1], [F.handR, 1]]) {
      tboxF(g, { w0: 0.26 * G, d0: 0.30, w1: 0.21 * G, d1: 0.24, h: 0.09, sz: 0.03 }, 0, -0.16, 0.06, PAL.deep, { metalness: 0.5 });
      const guard = [[-0.10, -0.11], [0.10, -0.11], [0.145, 0], [0.10, 0.14], [-0.10, 0.14], [-0.145, 0]].map(([x, y]) => [x * G, y * G]);
      const gp = prismF(g, guard, 0.05, 0, -0.095, 0.05, PAL.lite, { metalness: 0.6 });
      gp.rotation.x = -Math.PI / 2;
      for (const ox of [-0.075, 0, 0.075]) {
        const s1 = tboxF(g, { w0: 0.055, d0: 0.055, w1: 0.048, d1: 0.05, h: 0.15 }, ox, -0.155, 0.26, BONE, { metalness: 0.7 });
        s1.rotation.x = Math.PI / 2;
        const s2 = tboxF(g, { w0: 0.048, d0: 0.05, w1: 0.03, d1: 0.04, h: 0.13, sz: 0.035 }, ox, -0.19, 0.38, BONE, { metalness: 0.7 });
        s2.rotation.x = Math.PI / 2 + 0.4;                                       // 末節下折觸地
      }
      const t1 = tboxF(g, { w0: 0.05, d0: 0.05, w1: 0.04, d1: 0.045, h: 0.12 }, sx * -0.15 * G, -0.155, 0.14, BONE, { metalness: 0.7 });
      t1.rotation.x = Math.PI / 2;
      t1.rotation.z = sx * 0.5;                                                  // 拇指指向內前方
      const t2 = tboxF(g, { w0: 0.04, d0: 0.045, w1: 0.028, d1: 0.035, h: 0.1, sz: 0.03 }, sx * -0.185 * G, -0.175, 0.22, BONE, { metalness: 0.7 });
      t2.rotation.x = Math.PI / 2 + 0.45;
      t2.rotation.z = sx * 0.5;
    }
    // 輕武器:右肩肩扛如意棒(2D:金棒身+深色箍線;gunPitch 俯仰)。
    // 棒身沿 +y、掛胸(無臂鏈)⇒ 前指 = rotation.x 1.57;行軍 rest 1.35 微上揚
    const staff = new THREE.Group();
    staff.position.set(0.4, c.dims.shoulderYl + 0.15, 0);
    staff.rotation.set(1.35, 0, -0.05);
    F.chest.add(staff);
    const SL = 0.3 * H * K.barrelF;
    latheF(staff, [[0.042, -SL * 0.88], [0.052, -SL * 0.45], [0.052, SL * 0.9], [0.042, SL * 1.12]], 10, 0, 0, 0, 0xc9a02e, { metalness: 0.85 });  // 金棒身(微鼓腰、前長後短)
    for (const oy of [SL * 1.05, -SL * 0.8])
      latheF(staff, [[0.04, -0.075], [0.068, -0.04], [0.068, 0.04], [0.04, 0.075]], 10, 0, oy, 0, DGOLD, { metalness: 0.85, emissive: BRASS, emissiveIntensity: 0.35 });  // 兩端箍(latheF 束環)
    const lMuz = latheF(staff, [[0.045, -0.03], [0.075, -0.012], [0.075, 0.012], [0.045, 0.03]], 10, 0, SL * 1.16, 0, accent, { emissive: accent, emissiveIntensity: 0.9 });  // 前端槍口環
    tboxF(staff, { w0: 0.11, d0: 0.2, w1: 0.09, d1: 0.16, h: 0.15 }, 0, -SL * 0.2, -0.1, PAL.deep, { metalness: 0.6 });  // 電容匣兼肩墊
    return {
      gunR: { g: staff, rest: 1.35, aim: 1.57 }, gunL: null,                     // 肩扛樞軸(weap 'N' + gunR:猩猩肩砲同款)
      muzzles: { light: { n: lMuz, r: 0.07 }, heavy: null },                     // heavy 由 extra 的尾砲補
      lightGlowM: [lMuz], heavyGlowM: [], heavyPivot: [],
      weap: { light: 'N', heavy: 'N' },
      hvy: { chest: 0.05 },
      aimPose: null,
      wpn: { light: { nodes: [staff], ref: staff, muz: lMuz, fwd: 'y' }, heavy: null },
    };
  },
  extra(c, F, rig) {
    const { PAL, accent, G } = c;
    // 十節收分節鏈長尾(chainF 多零件;2D 是 10+ 節球關節收分尾)——
    // 逐節上捲蓄勢(rot0/rotD)語意同舊制;行軍上捲由 whipTail 的 base 疊加。
    // 逐節捲角:地面型的值是預設(逐位元同舊制);飛行型改由 c.tailCurl 指定 ——
    // 「尾巴繞到背上、尾端向前瞄準」要的是不同的累積轉角,而那是**同一條尾巴的另一個姿態**,
    // MUST NOT 在飛行檔另生一條尾(那就是第二條尾巴,地面型加一節它不會跟著有)。
    const CU = c.tailCurl || { rot0: 0.5, rotD: -0.05 };
    const { segs, tip } = chainF(F.hips, {
      n: 10, y: -0.05, z: -0.3 * G,
      len0: 0.34, len1: 0.22, r0: 0.1 * G, r1: 0.062 * G,
      rot0: CU.rot0, rotD: CU.rotD, ring: true, ringColor: IRON, seg: 8,
    }, PAL.main, { metalness: 0.55 });
    const tipL = 0.22;
    // 尾端熔核砲:latheF 階狀砲身(朝 −z)+ 機匣環 + 砲口內膛 + 充能環
    const gunT = latheF(tip, [
      [0.045 * G, -0.62], [0.075 * G, -0.60], [0.105 * G, -0.50], [0.105 * G, -0.30],
      [0.085 * G, -0.24], [0.085 * G, -0.10], [0.13 * G, -0.04], [0.13 * G, 0], [0.0001, 0],
    ], 10, 0, 0, -(tipL + 0.06), GUNMETAL, { metalness: 0.8 });
    gunT.rotation.x = Math.PI / 2;                                               // 砲身 −y → 尾向 −z
    const rr = latheF(tip, [[0.115 * G, -0.05], [0.15 * G, -0.02], [0.15 * G, 0.02], [0.115 * G, 0.05]], 10, 0, 0, -(tipL + 0.15), IRON, { metalness: 0.8 });
    rr.rotation.x = Math.PI / 2;                                                 // 機匣環
    const bore = cylF(tip, 0.05 * G, 0.05 * G, 0.05, 8, 0, 0, -(tipL + 0.60), INK, { metalness: 0.3 });
    bore.rotation.x = Math.PI / 2;                                               // 砲口內膛(黑)
    const hMuz = latheF(tip, [[0.11 * G, -0.035], [0.14 * G, -0.012], [0.14 * G, 0.012], [0.11 * G, 0.035]], 10, 0, 0, -(tipL + 0.66), accent, { emissive: accent, emissiveIntensity: 1.6 });
    hMuz.rotation.x = Math.PI / 2;                                               // 砲口充能環
    rig.tailSegs = segs;
    rig.tailUp = 0.12;
    // 尾梢那一具熔核砲 = 重武器 ⇒ 交戰時整條尾蠍式前捲、砲口轉向正前
    //(locomotion whipTail 的 aim 分支;舊制走 stepMorph 的 rig.tailPose,那條路已隨單樹變形者退役)。
    // ⚠ 累積角 **MUST 推導**:砲身自己已經轉了 π/2(上面的 `gunT.rotation.x`)⇒ 尾鏈只要再補
    //   π/2 就把砲口帶到機首。抄飛行型那一組(累積 ≈3.3 rad)會多轉半圈 —— 實測 dot(+z) = −0.18,
    //   砲口朝機尾,而畫面上尾巴確實捲起來了,看起來完全正常。
    //   逐節遞減 AIM_D 維持弧形;rot0 由「Σ(rot0 + i·AIM_D) = π/2」反解。
    if (!c.tailCurl) {
      const AIM_D = -0.024, n = segs.length;
      rig.tailAim = { rot0: (Math.PI / 2 - AIM_D * (n * (n - 1) / 2)) / n, rotD: AIM_D };
    }
    rig.muzzles.heavy = { n: hMuz, r: 0.13 * G };
    rig.heavy.glow.push({ mesh: hMuz, base: 1.6 });
    rig.wpn.heavy = { nodes: [gunT], ref: gunT, muz: hMuz, fwd: '-z' };
  },
};
