// ============ t02 逐機零件檔(自 forge.js MECH_DETAIL 拆出;dev-only)============
// // ── t02「加拉泰亞-7」神經同步機(seraph):倒三角胸、肌腱缸、單角單眼、雙手長狙 ──
// 2D 定案圖:public/assets/cyberpunk_art/mechs/t02_static.png / t02_moving.png / t02_heavy.png
// 幾何語彙一律取自 ../geo.js(多面體字母表);MUST NOT 在本檔自建 BufferGeometry。
// 2026-08-12 多面體改寫:主要部位一律楔台/稜柱/旋成體(不再用方盒當主殼);
// 軀幹與四肢縫隙的褐色肌束 = cablesF 多條纜束(sinew 續當缸體);
// 肩上 binder 莢 = 後掠翼形莢殼(prism 側輪廓)+ 莢內羽片列(finF ×5,掛 binderPivots 蓄力展翼)。
import * as THREE from 'three';
import {
  matF, dimF, bxF, cylF, sphF, coneF, torusF, tboxF, prismF, latheF, finF, fanF, chainF, cablesF,
  hydCyl, sinew, seg2, IRON, GUNMETAL, COAL, INK, BONE, BRASS,
} from '../geo.js';

// 外露肌束的生體色(2D 定案:軀幹/四肢縫隙全是褐色肌腱束)
const FLESH = 0x8a5a44;

export default {
  label: '加拉泰亞-7(t02 神經同步機)',
  prop: { hips: 0.56, legSplay: 0.055, thigh: 0.5, shin: 0.47, shoulderY: 0.86, shoulderX: 0.21, upperArm: 0.175, foreArm: 0.16, head: 0.94, girth: 0.82 },
  gait: { strideF: 1.5, bob: 0.1, sway: 0.07, top: 8, armBase: 0.05 },
  moveSig: { poise: 0.08, idleF: 2.45, idleA: 0.95, launch: 0.93, spool: 0.05, brake: 0.95, settle: 0.38 },
  castSig: { omni: 'spin', dir: 'jab' },
  doc: [
    ['head', '楔形頭殼(prism 側輪廓,前尖後收)+單眼+前傾單角+後掠頰鰭×2+頸部纜束'],
    ['chest', '倒三角胸殼(prism)+三角紋章+鎖骨斜板+背脊/腰腹肌束(cables)'],
    ['binder ×2', '後掠翼形莢殼(prism 刀形)+莢內羽片列(fin ×5,蓄力展翼)'],
    ['hips', '收分骨盆楔台+髖軸盤+髖肌束'],
    ['leg ×2', '收分楔台腿殼+尖膝甲(prism)+脛前亮刃(fin)+腿肚鰭+肌腱缸+肌束'],
    ['arm ×2', '收分楔台臂殼+肌腱缸+肌束(雙手托長狙)'],
    ['hand R', '同步長狙:收分砲管(lathe)+波紋加速鼓+上導軌稜脊(prism)+雙叉刺軌+下掛高斯模組'],
  ],
  head(c, h) {
    const { PAL, accent, G } = c;
    // 楔形頭殼:側輪廓稜柱(前尖後收);rotation.y=π/2 ⇒ 輪廓 x+ = 機體後方
    prismF(h, [
      [-0.26, -0.05], [-0.05, -0.16], [0.16, -0.10], [0.19, 0.14], [0.03, 0.24], [-0.19, 0.15],
    ], 0.32 * G, 0, 0.05, 0, PAL.mid, { metalness: 0.7 }).rotation.y = Math.PI / 2;
    const eye = sphF(h, 0.09, 0, 0.1, 0.23, accent, { emissive: accent, emissiveIntensity: 2.0 });  // 單圓獨眼
    eye.scale.set(1, 1, 0.6);
    bxF(h, 0.24, 0.05, 0.08, 0, 0.2, 0.19, PAL.deep);                            // 壓眉稜(細條)
    prismF(h, [                                                                   // 楔形顎(前突下收)
      [-0.30, -0.03], [-0.16, -0.15], [0.02, -0.16], [0.06, -0.02],
    ], 0.16, 0, -0.06, 0.05, PAL.main, { metalness: 0.7 }).rotation.y = Math.PI / 2;
    const horn = cylF(h, 0.012, 0.055, 0.72, 5, 0, 0.6, 0.1, 0xe8d9a0, { metalness: 0.8 });
    horn.rotation.x = -0.25;                                                     // 額頂前傾單角
    for (const sx of [-1, 1]) {                                                  // 後掠頰鰭(2D 動圖的側翼)
      const f = finF(h, { len: 0.34, w0: 0.10, w1: 0.02, t: 0.03, sweep: 0.05 },
        sx * 0.16 * G, 0.06, -0.06, PAL.main, { metalness: 0.7 });
      f.rotation.set(-1.3, Math.PI / 2, 0);                                      // 刃面立在矢狀面,指向後上
    }
    bxF(h, 0.18, 0.05, 0.05, 0, 0.04, -0.22, accent, { emissive: accent, emissiveIntensity: 0.8 });  // 後腦識別條
    cylF(h, 0.08, 0.1, 0.26, 8, 0, -0.24, 0.01, IRON, { metalness: 0.8 });       // 頸筒
    cablesF(h, { p0: [0, -0.1, 0.03], p1: [0, -0.36, 0.04], k: 4, r: 0.02, sag: 0.02, spread: 0.05 }, FLESH, { metalness: 0.4 });  // 頸部外露纜束
  },
  chest(c, ch, d) {
    const { PAL, accent, G } = c;
    const top = d.shoulderY, bot = d.waistY;
    const w = d.shoulderX * 1.05;
    prismF(ch, [                                                                 // 倒三角上胸(底邊=肩線)
      [-w, top + 0.12], [w, top + 0.12], [0.13, bot], [-0.13, bot],
    ], 0.55 * G, 0, 0, -0.005 * G, PAL.main, { metalness: 0.7, bevel: { t: 0.05, s: 0.05 } });
    tboxF(ch, { w0: 0.24, d0: 0.36, w1: 0.32, d1: 0.5, h: top - 0.1 }, 0, (top + 0.1) / 2, 0, PAL.deep, { metalness: 0.7 });  // 窄腰心柱(下窄上寬,下延補到骨盆)
    for (const sx of [-1, 1])
      bxF(ch, 0.05, (top - bot) * 0.6, 0.4, sx * 0.19, (top + bot) / 2, 0.02, PAL.mid);  // 窄腰側肋(細條)
    sinew(ch, 0.7, 0, bot + 0.2, -0.3, PAL.lite);                                // 脊柱肌腱缸(缸體)
    sinew(ch, 0.55, 0, bot - 0.25, 0.12, PAL.lite);                              // 腰腹前缸
    cablesF(ch, { p0: [0, top - 0.5, -0.36 * G], p1: [0, bot - 0.1, -0.32 * G], k: 5, r: 0.03, sag: 0.05, spread: 0.06 }, FLESH, { metalness: 0.4 });  // 背脊肌束(探出心柱背面)
    cablesF(ch, { p0: [0, bot + 0.4, 0.16], p1: [0, bot - 0.35, 0.12], k: 4, r: 0.028, sag: 0.03, spread: 0.07 }, FLESH, { metalness: 0.4 });  // 腰腹肌束(2D 裸腰段)
    for (const sx of [-1, 1]) {                                                  // 鎖骨斜板
      const cl = bxF(ch, 0.52, 0.07, 0.06, sx * w * 0.48, top + 0.03, 0.28 * G + 0.02, PAL.mid, { metalness: 0.8 });
      cl.rotation.z = sx * 0.26;
    }
    bxF(ch, w * 2, 0.07, 0.05, 0, top + 0.1, 0.28 * G, dimF(accent, 0.8));       // 肩線識別稜
    cylF(ch, 0.24, 0.24, 0.04, 12, 0, top - 0.55, 0.28 * G + 0.02, PAL.deep, { metalness: 0.7 }).rotation.x = Math.PI / 2;
    prismF(ch, [[-0.26, 0.15], [0.26, 0.15], [0, -0.24]], 0.06, 0, top - 0.52, 0.28 * G + 0.08, accent, { emissive: accent, emissiveIntensity: 1.3 });  // 胸口三角紋章(外)
    prismF(ch, [[-0.13, 0.07], [0.13, 0.07], [0, -0.13]], 0.05, 0, top - 0.54, 0.28 * G + 0.12, PAL.deep, { metalness: 0.7 });  // 紋章內芯(讀成描邊三角)
    for (const sx of [-1, 1]) {                                                  // 肩上 binder 莢(蓄力展翼)
      const piv = new THREE.Group();
      piv.position.set(sx * (w + 0.02), top + 0.3, -0.03);
      ch.add(piv);
      prismF(piv, [                                                              // 後掠翼形莢殼(長刀形,尖端越過頭頂後掠)
        [-0.28, -0.30], [0.10, -0.30], [0.42, 0.25], [1.0, 0.82], [1.12, 1.05], [0.05, 0.45], [-0.18, 0.25],
      ], 0.16, 0, 0, 0, PAL.main, { metalness: 0.7 }).rotation.y = Math.PI / 2;
      const strip = bxF(piv, 0.17, 0.05, 1.15, 0, 0.78, -0.57, dimF(accent, 0.85), { emissive: accent, emissiveIntensity: 0.9 });  // 莢脊識別條(沿刀背)
      strip.rotation.x = 0.51;
      for (let i = 0; i < 5; i++) {                                              // 莢內羽片列:一片羽毛 = 一顆零件(決定性遞變)
        const f = finF(piv, { len: 0.38 + 0.09 * i, w0: 0.13, w1: 0.04, t: 0.032, sweep: 0.05, camber: 0.03 },
          sx * (0.055 - 0.02 * i), -0.24 + 0.22 * i, -(0.12 + 0.2 * i), PAL.lite, { metalness: 0.6 });
        f.rotation.set(-1.55 - 0.14 * i, Math.PI / 2, 0);                        // 刃面立在矢狀面,自水平後方漸掃向後下
      }
      cylF(piv, 0.09, 0.09, 0.2, 8, 0, -0.12, 0.02, IRON, { metalness: 0.85 }).rotation.z = Math.PI / 2;  // 莢根鉸軸
      // 靜置外傾(2D 定案:莢刀朝外斜掠,不是直立雙塔);蓄力再向外展開 + 微抬
      c.binderPivots.push({ obj: piv, rest: { x: 0, y: 0, z: -sx * 0.2 }, deploy: { x: 0.18, y: -sx * 0.55, z: -sx * 0.5 } });
    }
    tboxF(ch, { w0: 0.4, d0: 0.3, w1: 0.46, d1: 0.36, h: 0.42, sz: -0.03 }, 0, top - 0.05, -0.4 * G, PAL.mid, { metalness: 0.7 });  // 背部連接埠(後收楔台)
    const sok = cylF(ch, 0.11, 0.11, 0.12, 10, 0, top - 0.05, -0.6 * G, COAL, { metalness: 0.85 });
    sok.rotation.x = Math.PI / 2;                                                // 臍帶纜圓插座
    const rg = cylF(ch, 0.15, 0.15, 0.04, 10, 0, top - 0.05, -0.57 * G, dimF(accent, 0.8), { emissive: accent, emissiveIntensity: 0.5 });
    rg.rotation.x = Math.PI / 2;
    for (const yy of [0.5, 0.28, 0.06])
      cylF(ch, 0.06, 0.06, 0.09, 8, 0, bot + yy, -0.34 * G, PAL.deep, { metalness: 0.8 }).rotation.x = Math.PI / 2;  // 脊椎神經插栓列
  },
  pelvis(c, hips) {
    const { PAL, G } = c;
    tboxF(hips, { w0: 0.42 * G, d0: 0.32 * G, w1: 0.55 * G, d1: 0.42 * G, h: 0.3 }, 0, 0, 0, PAL.deep, { metalness: 0.7 });  // 收分骨盆(下窄上寬,裸細無裙甲)
    for (const sx of [-1, 1]) {
      cylF(hips, 0.13, 0.13, 0.16, 10, sx * 0.3, -0.04, 0, IRON, { metalness: 0.85 }).rotation.z = Math.PI / 2;  // 髖軸盤
      cablesF(hips, { p0: [sx * 0.1, 0.16, 0.06], p1: [sx * 0.3, -0.14, 0.02], k: 3, r: 0.024, sag: 0.03, spread: 0.04 }, FLESH, { metalness: 0.4 });  // 髖肌束
    }
    tboxF(hips, { w0: 0.16, d0: 0.08, w1: 0.24, d1: 0.12, h: 0.2 }, 0, -0.05, 0.2 * G, PAL.mid, { metalness: 0.7 });  // 前擋小楔
  },
  thigh(c, l, d) {
    const { PAL, G } = c;
    sinew(l, d.len * 0.9, 0, -d.len * 0.46, -0.09 * G, PAL.lite);                // 外露肌腱缸(缸體;走腿後,2D 大腿正面是乾淨甲面)
    cablesF(l, { p0: [-c.sx * 0.08, -d.len * 0.08, 0.04], p1: [-c.sx * 0.06, -d.len * 0.88, 0.03], k: 3, r: 0.024, sag: 0.02, spread: 0.045 }, FLESH, { metalness: 0.4 });  // 大腿內側肌束
    tboxF(l, { w0: 0.19 * G, d0: 0.24 * G, w1: 0.27 * G, d1: 0.32 * G, h: d.len * 1.02 }, 0, -d.len * 0.5, 0.02, PAL.main, { metalness: 0.7 });  // 收分楔台腿殼(上寬下窄)
    bxF(l, 0.1, d.len * 0.66, 0.11, c.sx * 0.16 * G, -d.len * 0.52, -0.05, PAL.mid);  // 側肋條(細條)
  },
  shin(c, l, d) {
    const { PAL, accent, G } = c;
    prismF(l, [                                                                  // 尖膝甲(前尖稜柱)
      [-0.26, -0.03], [-0.04, -0.13], [0.10, -0.10], [0.11, 0.09], [-0.06, 0.12],
    ], 0.24 * G, 0, -0.01, 0.06, dimF(accent, 0.9), { metalness: 0.6 }).rotation.y = Math.PI / 2;
    sinew(l, d.len * 0.85, 0, -d.len * 0.48, -0.03, PAL.lite);
    cablesF(l, { p0: [0, -0.06, -0.1], p1: [0, -d.len * 0.5, -0.08], k: 3, r: 0.02, sag: 0.025, spread: 0.035 }, FLESH, { metalness: 0.4 });  // 膝後腓腸肌束
    tboxF(l, { w0: 0.14 * G, d0: 0.18 * G, w1: 0.24 * G, d1: 0.28 * G, h: d.len * 1.0 }, 0, -d.len * 0.5, 0.01, PAL.main, { metalness: 0.7 });  // 收分脛殼(踝端收細)
    const blade = finF(l, { len: d.len * 0.62, w0: 0.09, w1: 0.025, t: 0.05 }, 0, -d.len * 0.14, 0.14 * G, PAL.lite, { metalness: 0.9 });  // 脛前亮刃(朝下,貼收分面)
    blade.rotation.x = Math.PI + 0.05;
    const cf = finF(l, { len: d.len * 0.42, w0: 0.12, w1: 0.03, t: 0.03, sweep: 0.05 }, c.sx * 0.06 * G, -d.len * 0.5, -0.1, PAL.mid, { metalness: 0.7 });  // 腿肚推進鰭(後掠)
    cf.rotation.set(Math.PI + 0.55, Math.PI / 2, 0);
  },
  foot(c, l, d) {
    const { PAL, accent } = c;
    const L = d.footL, y0 = -d.clear * 0.55;
    prismF(l, [                                                                  // 窄長楔形足(尖頭;輪廓 x+ = 腳跟)
      [-0.78 * L, -0.04], [-0.5 * L, -0.10], [0.30 * L, -0.10], [0.33 * L, 0.05], [0.05 * L, 0.13], [-0.4 * L, 0.07],
    ], 0.2, 0, y0, 0, PAL.deep, { metalness: 0.7 }).rotation.y = Math.PI / 2;
    tboxF(l, { w0: 0.1, d0: 0.1, w1: 0.16, d1: 0.16, h: 0.07, sz: 0.02 }, 0, y0 + 0.14, 0.02, PAL.mid, { metalness: 0.7 });  // 踝蓋小楔
    const toe = finF(l, { len: 0.2, w0: 0.14, w1: 0.04, t: 0.04 }, 0, y0 + 0.04, 0.55 * L, dimF(accent, 0.6), { metalness: 0.6 });  // 足尖亮片(指向前)
    toe.rotation.x = Math.PI / 2 - 0.15;
  },
  armUp(c, a, d) {
    const { PAL, G } = c;
    tboxF(a, { w0: 0.30 * G, d0: 0.34 * G, w1: 0.36 * G, d1: 0.40 * G, h: 0.32, sz: 0.02 }, 0, 0.08, 0, PAL.mid, { metalness: 0.7 });  // 窄肩座楔台(莢艙立肩上,不包肩)
    const dp = tboxF(a, { w0: 0.07, d0: 0.34 * G, w1: 0.1, d1: 0.42 * G, h: 0.42 }, c.sx * 0.2 * G, -0.06, 0, PAL.main, { metalness: 0.7 });
    dp.rotation.z = -c.sx * 0.22;                                                // 三角肌外側斜板(2D 的尖肩罩)
    sinew(a, d.len * 0.9, 0, -d.len * 0.46, 0, PAL.lite);
    cablesF(a, { p0: [0, -d.len * 0.12, 0.05], p1: [0, -d.len * 0.9, 0.04], k: 3, r: 0.022, sag: 0.02, spread: 0.04 }, FLESH, { metalness: 0.4 });  // 上臂肌束
    tboxF(a, { w0: 0.15 * G, d0: 0.18 * G, w1: 0.20 * G, d1: 0.23 * G, h: d.len * 1.0 }, 0, -d.len * 0.5, 0.02, PAL.main, { metalness: 0.7 });  // 收分臂殼
  },
  armFore(c, a, d) {
    const { PAL, G } = c;
    tboxF(a, { w0: 0.19 * G, d0: 0.22 * G, w1: 0.22 * G, d1: 0.25 * G, h: 0.16 }, 0, -0.01, 0, PAL.deep, { metalness: 0.7 });  // 肘節楔塊
    sinew(a, d.len * 0.85, 0, -d.len * 0.46, 0, PAL.lite);
    cablesF(a, { p0: [0, -d.len * 0.15, 0.05], p1: [0, -d.len * 0.88, 0.04], k: 3, r: 0.02, sag: 0.018, spread: 0.035 }, FLESH, { metalness: 0.4 });  // 前臂肌束
    tboxF(a, { w0: 0.13 * G, d0: 0.15 * G, w1: 0.18 * G, d1: 0.21 * G, h: d.len * 1.0 }, 0, -d.len * 0.5, 0.02, PAL.main, { metalness: 0.7 });  // 收分前臂殼(腕端內收)
    tboxF(a, { w0: 0.24 * G, d0: 0.28 * G, w1: 0.18 * G, d1: 0.22 * G, h: 0.15 }, 0, -d.len * 0.98, 0.02, PAL.mid, { metalness: 0.7 });  // 腕部收束護腕(外擴楔)
  },
  mount(c, F) {
    const { PAL, accent, K, H } = c;
    // 雙手托同一把長狙:主砲 + 下掛高斯衝鋒模組 + 前端雙叉刺軌 —— 掛右手,左手扶護木
    const REST = 1.3, AIM = { shR: -0.85, elR: -0.45, shL: -0.85, elL: -0.45 }, AIMA = 1.57 - (AIM.shR + AIM.elR);
    tboxF(F.handR, { w0: 0.16, d0: 0.22, w1: 0.20, d1: 0.26, h: 0.22 }, 0, -0.1, 0.02, c.dark, { metalness: 0.7 });  // 右掌甲楔
    tboxF(F.handL, { w0: 0.16, d0: 0.22, w1: 0.20, d1: 0.26, h: 0.22 }, 0, -0.1, 0.02, c.dark, { metalness: 0.7 });  // 左掌甲楔(扶護木)
    const gr = new THREE.Group();
    gr.position.set(0.16, -0.18, 0.24);
    gr.rotation.set(REST, 0, 0.1);
    F.handR.add(gr);
    const BL = 0.62 * H * K.barrelF;                                             // 比機體略高的反器材長狙
    tboxF(gr, { w0: 0.20, d0: 0.30, w1: 0.16, d1: 0.26, h: 0.70, sz: 0.02 }, 0, 0.03, 0, PAL.mid, { metalness: 0.75 });  // 機匣(前收楔台)
    const grip = tboxF(gr, { w0: 0.08, d0: 0.13, w1: 0.10, d1: 0.16, h: 0.22 }, 0, -0.2, -0.2, c.dark, { metalness: 0.7 });
    grip.rotation.x = 0.25;                                                      // 後傾握把
    tboxF(gr, { w0: 0.09, d0: 0.16, w1: 0.11, d1: 0.18, h: 0.2, sz: -0.03 }, 0, -0.02, -0.21, INK, { metalness: 0.7 });  // 彈匣楔
    prismF(gr, [                                                                 // 托肩尾托(側輪廓;x+ = 槍腹側)
      [-0.04, -0.05], [-0.05, -0.42], [-0.02, -0.60], [0.14, -0.52], [0.10, -0.18], [0.05, -0.06],
    ], 0.14, 0, 0, 0, PAL.main, { metalness: 0.7 }).rotation.y = Math.PI / 2;
    latheF(gr, [                                                                 // 收分主砲管(帶前段束環)
      [0.105, 0], [0.09, 0.06], [0.085, BL * 0.34], [0.072, BL * 0.36], [0.068, BL * 0.78], [0.078, BL * 0.84], [0.062, BL * 0.86], [0.058, BL],
    ], 10, 0, 0.5, 0, GUNMETAL, { metalness: 0.85 });
    const rail = prismF(gr, [[-0.04, 0], [-0.05, -0.035], [0, -0.075], [0.05, -0.035], [0.04, 0]],
      BL * 0.85, 0, 0.5 + BL * 0.44, 0.095, PAL.main, { metalness: 0.75 });
    rail.rotation.x = -Math.PI / 2;                                              // 上導軌稜脊(峰朝外)
    const D = BL * 0.36;
    latheF(gr, [                                                                 // 軌道加速段(波紋鼓)
      [0.10, 0], [0.14, D * 0.1], [0.11, D * 0.24], [0.14, D * 0.42], [0.11, D * 0.56], [0.14, D * 0.74], [0.11, D * 0.88], [0.09, D],
    ], 10, 0, 0.5 + BL * 0.06, 0, PAL.deep, { metalness: 0.8 });
    const core = cylF(gr, 0.032, 0.032, BL * 0.55, 6, 0, 0.5 + BL * 0.45, 0.078, accent, { emissive: accent, emissiveIntensity: 0.9 });  // 軌間電漿(蓄力發光,夾在砲管與導軌間)
    latheF(gr, [[0.06, 0], [0.10, 0.02], [0.10, 0.14], [0.065, 0.18]], 10, 0, 0.48 + BL, 0, GUNMETAL, { metalness: 0.85 });  // 砲口制退器
    const hMuz = cylF(gr, 0.075, 0.075, 0.1, 8, 0, 0.56 + BL, 0, accent, { emissive: accent, emissiveIntensity: 0.4 });  // 主砲膛口
    for (const sz of [-1, 1]) {                                                  // 前端雙叉刺軌(刃面立在射軸面上)
      const p = finF(gr, { len: 0.52, w0: 0.05, w1: 0.014, t: 0.035 }, 0, 0.56 + BL, sz * 0.07, 0xe8d9a0, { metalness: 0.85 });
      p.rotation.y = Math.PI / 2;
    }
    bxF(gr, 0.05, 0.05, 0.19, 0, 0.66 + BL, 0, IRON, { metalness: 0.8 });        // 叉根橫閂(細條)
    // 下掛高斯衝鋒模組(輕武器):楔形本體 + 3 節線圈束環 + 細副槍管
    tboxF(gr, { w0: 0.10, d0: 0.10, w1: 0.12, d1: 0.14, h: 0.5 }, 0, 0.5 + BL * 0.16, -0.15, PAL.deep, { metalness: 0.8 });
    for (const t of [0.1, 0.2, 0.3])
      torusF(gr, 0.062, 0.02, 0, 0.5 + BL * t, -0.13, IRON, { metalness: 0.8 }).rotation.x = Math.PI / 2;
    cylF(gr, 0.028, 0.028, BL * 0.42, 6, 0, 0.5 + BL * 0.32, -0.13, GUNMETAL, { metalness: 0.85 });
    const lMuz = cylF(gr, 0.04, 0.04, 0.06, 8, 0, 0.5 + BL * 0.54, -0.13, accent, { emissive: accent, emissiveIntensity: 0.8 });  // 副槍口
    return {
      gunR: { g: gr, rest: REST, aim: AIMA }, gunL: null,
      muzzles: { light: { n: lMuz, r: 0.04 }, heavy: { n: hMuz, r: 0.08 } },
      lightGlowM: [lMuz], heavyGlowM: [hMuz, core], heavyPivot: c.binderPivots,
      weap: { light: 'R', heavy: 'R' },
      hvy: { armR: 0.18, armL: 0.12, chest: 0.06, gun: 0.05 },
      aimPose: { rShoulderX: AIM.shR, rElbowX: AIM.elR, lShoulderX: AIM.shL, lShoulderY: 0.35, lElbowX: AIM.elL },
      wpn: { light: { nodes: [gr], ref: gr, muz: lMuz, fwd: 'y' }, heavy: { nodes: [gr], ref: gr, muz: hMuz, fwd: 'y' } },
    };
  },
};
