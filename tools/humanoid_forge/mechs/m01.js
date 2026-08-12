// ============ m01 逐機零件檔(自 forge.js MECH_DETAIL 拆出;dev-only)============
// ── m01「渡鴉」貴族突襲機(vampire):切面寶石+金滾邊、雙層尖翼肩甲、背後長刃羽組 ──
// 2D 定案圖:public/assets/cyberpunk_art/mechs/m01_ground_static.png / _moving.png / _heavy.png
//(+ m01_flight_*.png 參考旋翼形制 —— 地面型的「摺收旋翼」= 長刀狀刃羽收攏貼背/貼腿)
// 幾何語彙一律取自 ../geo.js(多面體字母表);MUST NOT 在本檔自建 BufferGeometry。
// 造型主語彙:斜切楔台(tboxF)胸甲/肢殼 + 稜線金滾邊(細 bxF 貼稜)+ prismF 尖翼領/肩甲/裙板;
// 摺收旋翼 = 長刃羽「多零件」組(finF 一片一件:背後左右各 3 下 1 上;小腿 fanF 3 短刃)。
import * as THREE from 'three';
import {
  dimF, bxF, cylF, torusF, tboxF, prismF, latheF, finF, fanF, cablesF,
  IRON, GUNMETAL, COAL, INK,
} from '../geo.js';

const GOLD = 0xc9a05a;                                   // 金滾邊(2D 每片裝甲的淡金稜線)
const mir = (pts, sx) => (sx >= 0 ? pts : pts.map(([x, y]) => [-x, y]));  // 左右鏡射(ExtrudeGeometry 自校繞向)

export default {
  label: '渡鴉(m01 變形者・地面型)', hue: 0xd94f4f,
  prop: { hips: 0.54, legSplay: 0.06, thigh: 0.48, shin: 0.46, shoulderY: 0.82, shoulderX: 0.145, upperArm: 0.155, foreArm: 0.15, head: 0.9, girth: 0.9 },
  gait: { strideF: 1.3, bob: 0.05, sway: 0.05, top: 8, armBase: 0.05 },
  moveSig: { poise: 0.85, idleF: 0.9, idleA: 0.4, launch: 0.9, spool: 0.1, brake: 0.7, settle: 0.4 },
  castSig: { omni: 'spin', dir: 'swing' },
  doc: [
    ['head', '楔形頭殼(prismF 側輪廓)+面罩感測條+widow’s peak 尖突+中脊尖冠與冠側雙角(finF)+單片眼鏡環(torusF)'],
    ['chest', '切面楔胸(tboxF 上寬下收)+金滾邊稜線+45° 菱形胸針(prismF)+V 形領巾雙斜刃(finF)+高立領尖翼(prismF 外黑內紅)'],
    ['back', '背脊整流罩+摺收旋翼長刃羽組(finF 一片一件:左右各 3 片下垂長短遞減+1 片上揚)+旋翼轂(latheF)'],
    ['hips', '楔骨盆+前檔尖甲+收攏披風三片尖端垂片(prismF)+accent 滾邊'],
    ['leg ×2', '收分楔台腿殼+前稜金滾邊+膝圓盤(latheF)+小腿摺收旋翼(fanF 3 短刃)+尖頭鞋(prismF 側輪廓)'],
    ['arm ×2', '雙層尖翼肩甲(prismF ×2+金滾邊)+收分楔台臂殼+八角禮服袖口(latheF)+袖口金環(torusF)'],
    ['hand R', 'M134 六管環列+束管環與槍口發光環(latheF)+側掛供彈鏈匣(cablesF 供彈鏈)'],
    ['hand L', '地獄火雙聯:tboxF 斜切發射框+latheF 上下雙管(口緣加箍)+管口導引窗'],
  ],
  head(c, h) {
    const { PAL, accent, G } = c;
    // 楔形頭殼:側輪廓稜柱(尖下顎、緩收後腦),沿頭寬擠出後轉正
    const shell = prismF(h, [
      [0.16, -0.16], [0.24, 0.02], [0.20, 0.16], [0.02, 0.30],
      [-0.20, 0.22], [-0.24, -0.05], [-0.10, -0.14],
    ], 0.32 * G, 0, 0.05, 0.01, PAL.mid, { metalness: 0.75 });
    shell.rotation.y = -Math.PI / 2;                     // 側輪廓 +x → 世界 +z(面前)
    bxF(h, 0.27 * G, 0.075, 0.05, 0, 0.10, 0.225, INK, { metalness: 0.4 });  // 面罩 visor 暗帶(2D 黑色橫縫)
    bxF(h, 0.23 * G, 0.024, 0.02, 0, 0.10, 0.258, accent, { emissive: accent, emissiveIntensity: 1.5 });  // 感測細縫(發光)
    tboxF(h, { w0: 0.11, w1: 0.15, d0: 0.13, d1: 0.17, h: 0.12, sz: 0.03 }, 0, -0.11, 0.13, PAL.dark, { metalness: 0.6 });  // 楔形下顎面甲
    const peak = prismF(h, [[-0.045, 0], [0, -0.11], [0.045, 0]], 0.025, 0, 0.19, 0.215, PAL.deep, { metalness: 0.7 });
    peak.rotation.x = -0.45;                             // widow's peak 尖突(貼額斜面的倒三角)
    const crest = finF(h, { len: 0.34, w0: 0.045, w1: 0.014, t: 0.10, sweep: -0.06 }, 0, 0.27, -0.08, PAL.dark, { metalness: 0.75 });
    crest.rotation.x = -0.95;                            // 頭盔中脊後掠尖冠(單刃羽)
    for (const sx of [-1, 1]) {
      const horn = finF(h, { len: 0.16, w0: 0.04, w1: 0.012, t: 0.07, sweep: -0.03 }, sx * 0.09, 0.25, -0.05, PAL.dark, { metalness: 0.75 });
      horn.rotation.set(-0.45, 0, -sx * 0.32);           // 冠側雙尖角(2D 頭頂三尖冠)
      const sb = finF(h, { len: 0.24, w0: 0.13, w1: 0.045, t: 0.04, sweep: 0.05 }, sx * 0.155, 0.14, -0.02, PAL.deep, { metalness: 0.7 });
      sb.rotation.set(Math.PI + 0.32, 0, -sx * 0.10);    // 後掠鬢角刃(下垂後掠)
    }
    const mono = torusF(h, 0.045, 0.007, 0.09 * G, 0.10, 0.252, accent, { emissive: accent, emissiveIntensity: 1.2 });
    mono.userData.noOutline = true;                      // 右眼單片眼鏡環 —— 細管徑撐不起反轉外殼描邊(會糊成黑胖環),關掉
  },
  chest(c, ch, d) {
    const { PAL, accent, G } = c;
    const top = d.shoulderY, bot = d.waistY, mid = (top + bot) / 2;
    tboxF(ch, { w0: 0.55, w1: 0.66, d0: 0.36, d1: 0.44, h: 0.60 }, 0, 0.45, 0, INK, { metalness: 0.5 });  // 暗色內襯腰核(2D 窄腰黑底層)
    tboxF(ch, { w0: 0.95, w1: 1.50, d0: 0.50, d1: 0.64, h: 1.05, sz: 0.03 }, 0, mid + 0.13, 0, PAL.mid, { metalness: 0.75 });  // 切面楔胸(上寬下收、頂面微前傾)
    tboxF(ch, { w0: 0.62, w1: 0.92, d0: 0.38, d1: 0.50, h: 0.50 }, 0, 0.80, 0.01, PAL.mid, { metalness: 0.75 });  // 腹甲(紅色切面段)
    for (const sx of [-1, 1]) {                          // 金滾邊:胸前兩道斜稜線
      const tr = bxF(ch, 0.035, 0.82, 0.022, sx * 0.54, mid + 0.16, 0.30, GOLD, { metalness: 0.9 });
      tr.rotation.z = sx * 0.245; tr.rotation.x = 0.05;
    }
    bxF(ch, 0.03, 0.92, 0.022, 0, mid + 0.12, 0.305, GOLD, { metalness: 0.9 }); // 中央胸線金滾邊
    for (const sx of [-1, 1])
      bxF(ch, 0.055, 0.26, 0.04, sx * 0.30, mid + 0.24, 0.315, accent, { emissive: accent, emissiveIntensity: 1.1 });  // 胸前雙豎燈條(2D 奔跑圖)
    prismF(ch, [[0, 0.10], [-0.08, 0], [0, -0.10], [0.08, 0]], 0.05, 0, top - 0.18, 0.33, accent, { emissive: accent, emissiveIntensity: 1.3 });  // 45° 菱形胸針
    for (const sx of [-1, 1]) {
      const lap = finF(ch, { len: 0.30, w0: 0.10, w1: 0.04, t: 0.035 }, 0, top - 0.02, 0.32, PAL.dark, { metalness: 0.8 });
      lap.rotation.set(0.10, 0, Math.PI + sx * 0.42);    // V 形領巾雙斜刃(自領口中心下外斜)
      for (let i = 0; i < 3; i++)
        cylF(ch, 0.024, 0.024, 0.02, 8, sx * 0.09, 1.10 - i * 0.15, 0.272, dimF(accent, 0.7)).rotation.x = Math.PI / 2;  // 雙排釦 2×3
      // 高立領尖翼(prismF 外黑)+ 內襯紅片(2D 烏鴉展翼領:高過下巴、外張)
      const col = prismF(ch, mir([[0, 0], [0.34, -0.08], [0.56, 0.34], [0.42, 0.80], [0.12, 0.42]], sx),
        0.08, sx * 0.16, top + 0.04, -0.15 * G, COAL, { metalness: 0.75 });
      col.rotation.z = -sx * 0.24;
      const inn = prismF(ch, mir([[0.04, 0.02], [0.29, -0.03], [0.47, 0.31], [0.36, 0.68], [0.13, 0.37]], sx),
        0.03, sx * 0.16, top + 0.05, -0.15 * G + 0.05, 0x8a1f2a, { metalness: 0.4 });
      inn.rotation.z = -sx * 0.24;
    }
    prismF(ch, [[-0.16, 0], [0.16, 0], [0.20, 0.35], [0, 0.55], [-0.20, 0.35]], 0.06, 0, top + 0.06, -0.30 * G, COAL, { metalness: 0.75 });  // 中央後領片(外黑)
    prismF(ch, [[-0.12, 0.02], [0.12, 0.02], [0.15, 0.30], [0, 0.46], [-0.15, 0.30]], 0.03, 0, top + 0.07, -0.30 * G + 0.04, 0x8a1f2a, { metalness: 0.4 });  // 內襯紅
    tboxF(ch, { w0: 0.40, w1: 0.52, d0: 0.10, d1: 0.15, h: 0.80, sz: -0.02 }, 0, 1.35, -0.36, PAL.dark, { metalness: 0.75 });  // 背脊整流罩(旋翼基座)
    bxF(ch, 0.05, 0.68, 0.02, 0, 1.35, -0.44, accent, { emissive: accent, emissiveIntensity: 0.6 });  // 整流罩燈條
    // 摺收旋翼 = 長刃羽組(一片一零件):左右各 3 片向下後掠(長短遞減)+ 1 片上揚 —— 2D 靜態
    // 圖的下垂長刀 + 奔跑/heavy 圖背後 X 剪影;取代舊「一根桅 + 兩片槳葉」
    for (const sx of [-1, 1]) {
      const wing = new THREE.Group();
      wing.position.set(sx * 0.22, 1.68, -0.46);
      wing.rotation.x = Math.PI + 0.42;                  // 指向下後方(收攏貼背)
      ch.add(wing);
      latheF(wing, [[0.04, -0.06], [0.12, -0.035], [0.12, 0.06], [0.05, 0.10]], 8, 0, 0, 0, COAL, { metalness: 0.8 });  // 旋翼轂
      const L = [2.15, 1.75, 1.40];
      for (let i = 0; i < 3; i++) {
        const bl = finF(wing, { len: L[i], w0: 0.30, w1: 0.07, t: 0.06, sweep: 0.22 },
          0, 0, 0.05 + i * 0.07, i === 1 ? COAL : PAL.deep, { metalness: 0.7 });
        bl.rotation.z = -sx * (0.08 + i * 0.22);         // 逐片外展(扇形遞開)
      }
      const up = finF(ch, { len: 1.55, w0: 0.26, w1: 0.07, t: 0.06, sweep: 0.14 }, sx * 0.30, 1.76, -0.42, PAL.deep, { metalness: 0.7 });
      up.rotation.set(-0.55, 0, -sx * 0.44);             // 上揚刃羽(奔跑/heavy 的 X 剪影;外撥不遮頭)
    }
  },
  pelvis(c, hips, d) {
    const { PAL, accent, G } = c;
    tboxF(hips, { w0: 0.40 * G, w1: 0.58 * G, d0: 0.30 * G, d1: 0.42 * G, h: 0.30 }, 0, 0, 0, PAL.deep, { metalness: 0.7 });  // 上寬下收楔骨盆
    const cro = prismF(hips, [[-0.14, 0.02], [0.14, 0.02], [0.10, -0.16], [0, -0.27], [-0.10, -0.16]], 0.05, 0, -0.10, 0.19 * G, PAL.mid, { metalness: 0.75 });
    cro.rotation.x = 0.10;                               // 前檔尖甲(下尖)
    for (const sx of [-1, 1])
      tboxF(hips, { w0: 0.13, w1: 0.17, d0: 0.20, d1: 0.26, h: 0.24 }, sx * 0.30 * G, 0, 0, PAL.mid, { metalness: 0.75 });  // 側髖甲
    for (const [ox, w, L] of [[-0.19, 0.26, 0.72], [0.19, 0.26, 0.72], [0, 0.24, 0.88]]) {
      const p = prismF(hips, [[-w / 2, 0], [w / 2, 0], [w * 0.36, -L * 0.72], [0, -L], [-w * 0.36, -L * 0.72]], 0.04,
        ox * G, 0.08, -0.24 * G, COAL, { metalness: 0.7 });
      p.rotation.x = 0.14;                               // 收攏披風三片尖端垂片
      if (ox === 0) bxF(p, 0.14, 0.05, 0.02, 0, -L * 0.78, 0.03, accent, { emissive: accent, emissiveIntensity: 0.7 });  // 滾邊
    }
  },
  thigh(c, l, d) {
    const { PAL, G } = c;
    tboxF(l, { w0: 0.24 * G, w1: 0.34 * G, d0: 0.26 * G, d1: 0.36 * G, h: d.len * 1.02 }, 0, -d.len * 0.5, 0.01, PAL.mid, { metalness: 0.75 });  // 收分楔台大腿殼
    for (const sx of [-1, 1]) {
      const tr = bxF(l, 0.022, d.len * 0.78, 0.022, sx * 0.13 * G, -d.len * 0.5, 0.145, GOLD, { metalness: 0.9 });
      tr.rotation.z = -sx * 0.045; tr.rotation.x = 0.03; // 前稜金滾邊(跟著收分斜)
    }
    cylF(l, 0.13 * G, 0.13 * G, 0.05, 10, 0, -d.len * 0.98, 0, COAL, { metalness: 0.7 });  // 烤漆蓋板細縫(膝上環帶)
  },
  shin(c, l, d) {
    const { PAL, G, sx } = c;
    const disc = latheF(l, [[0.02, 0], [0.095, 0.008], [0.105, 0.028], [0.06, 0.052], [0.02, 0.058]], 12, sx * 0.15 * G, -0.02, 0, PAL.deep, { metalness: 0.8 });
    disc.rotation.z = -sx * Math.PI / 2;                 // 膝圓盤蓋(旋成體,軸朝外)
    tboxF(l, { w0: 0.18 * G, w1: 0.30 * G, d0: 0.20 * G, d1: 0.32 * G, h: d.len }, 0, -d.len * 0.5, 0.01, PAL.mid, { metalness: 0.75 });  // 收分楔台小腿殼
    for (const st of [-1, 1]) {
      const tr = bxF(l, 0.02, d.len * 0.7, 0.02, st * 0.11 * G, -d.len * 0.45, 0.135, GOLD, { metalness: 0.9 });
      tr.rotation.z = -st * 0.05; tr.rotation.x = 0.03;  // 前稜金滾邊
    }
    // 小腿摺收旋翼:3 片短刃羽扇(fanF 多零件)收攏貼小腿後側
    const rot = fanF(l, { n: 3, arc: 0.42, len: 0.68, edgeF: 0.72, gap: 0.05, fin: { w0: 0.09, w1: 0.03, t: 0.028, sweep: 0.08 } },
      0, -d.len * 0.35, -0.19 * G, PAL.deep, { metalness: 0.75 });
    rot.g.rotation.x = Math.PI + 0.5;                    // 指向下後方
    latheF(rot.g, [[0.02, -0.04], [0.06, -0.02], [0.06, 0.03], [0.025, 0.06]], 8, 0, 0, 0, COAL, { metalness: 0.8 });  // 旋翼轂
    bxF(l, 0.045, 0.045, 0.045, sx * 0.15 * G, -d.len * 0.7, -0.1, sx < 0 ? 0xd23b3b : 0x3bd25a, { emissive: sx < 0 ? 0xd23b3b : 0x3bd25a, emissiveIntensity: 0.8 });  // 航行燈左紅右綠
  },
  foot(c, l, d) {
    const { PAL } = c;
    tboxF(l, { w0: 0.17, w1: 0.22, d0: 0.18, d1: 0.23, h: 0.18 }, 0, -0.03, 0.02, PAL.deep, { metalness: 0.7 });  // 踝口楔套
    const shoe = prismF(l, [[-0.18, 0], [0.50, 0.02], [0.34, 0.12], [0.02, 0.20], [-0.18, 0.16]], 0.28,
      0, -d.clear, 0.04, PAL.mid, { metalness: 0.75 });
    shoe.rotation.y = -Math.PI / 2;                      // 尖頭鞋:側輪廓稜柱(楔形鞋尖)
  },
  armUp(c, a, d) {
    const { PAL, accent, G, sx } = c;
    // 雙層尖翼肩甲(prismF;上層小、下層大,尖端朝外 —— 2D 明顯的雙層尖翼)
    prismF(a, mir([[-0.14, -0.10], [0.24, -0.18], [0.48, 0.10], [0.18, 0.24], [-0.04, 0.16]], sx),
      0.30, sx * 0.04, 0.14, 0, PAL.mid, { metalness: 0.8 });
    prismF(a, mir([[-0.08, -0.05], [0.15, -0.11], [0.30, 0.08], [0.11, 0.17], [-0.03, 0.11]], sx),
      0.26, sx * 0.03, 0.27, 0, PAL.dark, { metalness: 0.75 });
    const tr = bxF(a, 0.24, 0.028, 0.31, sx * 0.11, 0.34, 0, GOLD, { metalness: 0.9 });
    tr.rotation.z = sx * 0.35;                           // 肩甲上稜金滾邊(貼上稜斜率)
    bxF(a, 0.16, 0.03, 0.05, sx * 0.10, 0.19, 0.15, accent, { emissive: accent, emissiveIntensity: 0.6 });  // 肩章飾條
    cylF(a, 0.04, 0.04, 0.03, 8, sx * 0.12 * G, 0.05, -0.12, COAL, { metalness: 0.7 });  // 肩排氣口
    tboxF(a, { w0: 0.17 * G, w1: 0.23 * G, d0: 0.19 * G, d1: 0.25 * G, h: d.len }, 0, -d.len * 0.5, 0, PAL.mid, { metalness: 0.75 });  // 收分楔台上臂殼
    cylF(a, 0.095 * G, 0.095 * G, 0.045, 10, 0, -d.len * 0.98, 0, COAL, { metalness: 0.7 });  // 烤漆蓋板細縫(肘環)
  },
  armFore(c, a, d) {
    const { PAL, G } = c;
    tboxF(a, { w0: 0.15 * G, w1: 0.19 * G, d0: 0.17 * G, d1: 0.21 * G, h: d.len * 0.9 }, 0, -d.len * 0.45, 0.01, PAL.mid, { metalness: 0.75 });  // 收分楔台前臂殼
    latheF(a, [[0.145, 0], [0.15, 0.02], [0.10, 0.15], [0.09, 0.17]], 8, 0, -d.len, 0.01, PAL.main, { metalness: 0.8 });  // 反折禮服袖口(八角喇叭口)
    torusF(a, 0.10, 0.012, 0, -d.len + 0.165, 0.01, GOLD, { metalness: 0.9 }).rotation.x = Math.PI / 2;  // 袖口金滾邊環
  },
  mount(c, F) {
    const { PAL, accent, K } = c;
    const REST = 1.35, AIM = { sh: -0.78, el: -0.5 }, AIMA = 1.57 - (AIM.sh + AIM.el);
    // 右手 M134 六管速射艙(輕武器)
    tboxF(F.handR, { w0: 0.17, w1: 0.21, d0: 0.20, d1: 0.25, h: 0.22 }, 0, -0.10, 0.02, c.dark, { metalness: 0.6 });  // 楔形手甲
    const gr = new THREE.Group();
    gr.position.set(0.16, -0.18, 0.24);
    gr.rotation.set(REST, 0, 0.12);
    F.handR.add(gr);
    const ML = 0.95 * K.barrelF;
    tboxF(gr, { w0: 0.22, w1: 0.26, d0: 0.24, d1: 0.28, h: 0.42, sz: 0.02 }, 0, 0.06, 0, PAL.mid, { metalness: 0.75 });  // 斜切機匣
    bxF(gr, 0.1, 0.2, 0.15, 0, -0.18, -0.18, COAL, { metalness: 0.7 });          // 握把
    for (let i = 0; i < 6; i++) {
      const th = i / 6 * Math.PI * 2;
      cylF(gr, 0.032, 0.032, ML, 6, Math.cos(th) * 0.075, 0.3 + ML / 2, Math.sin(th) * 0.075, GUNMETAL, { metalness: 0.85 });  // 六管環列
    }
    for (const t of [0.35, 0.7])
      latheF(gr, [[0.085, 0], [0.115, 0.012], [0.115, 0.05], [0.085, 0.062]], 10, 0, 0.3 + ML * t, 0, IRON, { metalness: 0.8 });  // 束管環(旋成體)
    const lMuz = latheF(gr, [[0.072, 0], [0.105, 0.014], [0.105, 0.056], [0.072, 0.07]], 10, 0, 0.30 + ML, 0, accent, { emissive: accent, emissiveIntensity: 0.9 });  // 槍口發光環
    tboxF(gr, { w0: 0.14, w1: 0.17, d0: 0.16, d1: 0.20, h: 0.26 }, 0.17, 0.08, 0.02, PAL.deep, { metalness: 0.7 });  // 側掛供彈鏈匣
    cablesF(gr, { p0: [0.17, -0.04, 0.02], p1: [0.03, -0.02, 0.06], k: 3, r: 0.016, sag: 0.05, spread: 0.012 }, COAL, { metalness: 0.6 });  // 供彈鏈(纜束)
    // 左手地獄火雙聯發射管(重武器)
    tboxF(F.handL, { w0: 0.17, w1: 0.21, d0: 0.20, d1: 0.25, h: 0.22 }, 0, -0.10, 0.02, c.dark, { metalness: 0.6 });  // 楔形手甲
    const gl = new THREE.Group();
    gl.position.set(-0.16, -0.18, 0.24);
    gl.rotation.set(REST, 0, -0.12);
    F.handL.add(gl);
    const HL = 0.9 * K.barrelF;
    tboxF(gl, { w0: 0.26, w1: 0.23, d0: 0.34, d1: 0.30, h: HL, sz: 0.05 }, 0, HL / 2, 0, PAL.mid, { metalness: 0.7 });  // 斜切發射器框
    bxF(gl, 0.24, 0.02, 0.30, 0, HL - 0.02, 0, COAL, { metalness: 0.7 });        // 管口面分隔板
    for (const oz of [-0.09, 0.09]) {
      latheF(gl, [[0.062, 0], [0.075, 0.02], [0.075, HL * 0.86], [0.085, HL * 0.88], [0.085, HL * 0.96], [0.058, HL * 0.99]], 8, 0, 0.02, oz, GUNMETAL, { metalness: 0.8 });  // 上下雙管(口緣加箍)
      const win = cylF(gl, 0.06, 0.06, 0.04, 8, 0, HL + 0.03, oz, accent, { emissive: accent, emissiveIntensity: 0.9 });
      if (oz > 0) c.hellfireMuz = win;                                           // 管口導引窗
    }
    bxF(gl, 0.09, 0.18, 0.14, 0, -0.06, -0.26, COAL, { metalness: 0.7 });        // 握把
    return {
      gunR: { g: gr, rest: REST, aim: AIMA }, gunL: { g: gl, rest: REST, aim: AIMA },
      muzzles: { light: { n: lMuz, r: 0.1 }, heavy: { n: c.hellfireMuz, r: 0.08 } },
      lightGlowM: [lMuz], heavyGlowM: [c.hellfireMuz], heavyPivot: [],
      weap: { light: 'R', heavy: 'L' },
      hvy: { armL: 0.2, armR: 0.08, chest: 0.06, gun: 0.05 },
      aimPose: { rShoulderX: AIM.sh, rElbowX: AIM.el, lShoulderX: AIM.sh, lShoulderY: 0, lElbowX: AIM.el },
      wpn: { light: { nodes: [gr], ref: gr, muz: lMuz, fwd: 'y' }, heavy: { nodes: [gl], ref: gl, muz: c.hellfireMuz, fwd: 'y' } },
    };
  },
};
