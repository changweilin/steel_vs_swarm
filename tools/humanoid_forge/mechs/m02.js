// ============ m02 逐機零件檔(dev-only;獸型雙足 biped + tinyArms + 重尾)============
// ── m02「壓艙石」重型突擊機甲(trex 暴龍):水平體軸、巨顎藏無後座砲、重尾配重、退化短前臂 ──
// 2D 定案圖:public/assets/cyberpunk_art/mechs/m02_static.jpg(★ = m02_static)
// 幾何語彙一律取自 ../geo.js;MUST NOT 在本檔自建 BufferGeometry。
// 2026-08-12 照 ★ 定案圖逐部位重建:
//   頭 = prismF 側剖顱殼(稜面楔形)+ 逐顆齒列 + 鉤形前獠牙;顎鉸是真樞軸(mount 的
//   heavyPivot 驅動「張口 = 射擊姿勢」);口腔藏四管旋管砲束(輕/重同膛:lMuz 管束小環、
//   hMuz 充能大環)。頸 = 芯柱 + latheF 三環收分 + 喉管纜束,頸幾何直達頭底(補掉 stub 斷縫)。
//   軀幹 = 斜置深胸艙 + 外凸肋甲環 ×3;背甲大蓋板移到肩後、覆在骨盆與尾根之上(★ 圖語彙),
//   讓開頸/頭的凝視擺動空間。尾 = chainF 九節收分 + 背脊板。圖騰紅黃帶紋 / 鏽蝕補丁 = paint 層。
import * as THREE from 'three';
import {
  matF, dimF, bxF, cylF, sphF, coneF, torusF, tboxF, prismF, latheF, finF, fanF, chainF, cablesF,
  hydCyl, sinew, seg2, IRON, GUNMETAL, COAL, INK, BONE, BRASS,
} from '../geo.js';

// 本機專用色:齒列亮灰 / 口腔暗紅 / 爪鋼 / 活塞亮桿
const TEETH = 0xcfd4d9, MAWRED = 0x6e1a1a, CLAWSTEEL = 0xb9c0c8, PISTON = 0xd8dde2;

export default {
  label: '壓艙石(m02 機甲・暴龍)', hue: 0x9aa3ad, height: 6.0,
  prop: { hips: 0.45, legSplay: 0.1, thigh: 0.5, shin: 0.44, shoulderY: 0.6, shoulderX: 0.1, upperArm: 0.1, foreArm: 0.09, head: 0.72, girth: 1.1 },
  gait: { strideF: 1.25, bob: 0.12, sway: 0.08, top: 7, legBase: 0.05, armBase: 0 },
  pose: {
    knee: { base: 0.28, k: 0.62, d: 0.15 }, ankle: { base: -0.2, k: -0.34, d: 0.55 },
    elbow: { base: -0.55, k: -0.3, d: 0.3 }, wrist: { base: -0.15, k: 0.12, d: 0.5 },   // 短前臂深屈在胸前(暴龍招牌)
  },
  neckAt: [0, 0.55, 0.1],                                       // 頸樞軸(頭前伸的兩段凝視穩定)
  moveSig: { poise: 0.70, idleF: 0.48, idleA: 1.62, launch: 0.14, spool: 0.85, brake: 0.20, settle: 1.90 },
  castSig: { omni: 'roar', dir: 'jab' },
  doc: [
    ['頭(巨顎藏無後座砲)', 'prismF 側剖稜面顱殼+頰甲 ×2+怒眉稜+逐顆齒列(上 10 下 8)+鉤形前獠牙 ×2+latheF 文氏尾噴(頭後)'],
    ['顎鉸+口腔砲', '下顎 prismF 側剖+軸桿+鉸盤 ×2;四管旋管砲束(cylF ×4+芯)+lMuz 管束環+hMuz 充能環;heavyPivot 充能張顎 = 射擊姿勢'],
    ['頸(分節頸甲)', 'cylF 頸芯+latheF 三環收分+cablesF 喉管 ×3+背側鱗板 ×2 —— 頸幾何直達頭底(斷縫已補)'],
    ['軀幹(水平前傾)', 'tboxF 斜置深胸艙+latheF 外凸肋甲環 ×3+prismF 胸甲 ×2+肩領環+腹龍骨+cablesF 腹管+側百葉'],
    ['背甲(散熱大蓋板)', 'prismF 側剖蓋板(肩後覆至尾根)+頂板+INK 百葉 ×4+側鉸座 ×2+後支柱+後排氣 ×2'],
    ['退化短前臂 ×2(tinyArms)', '球肩+亮色楔臂殼+hydCyl 活塞+latheF 肘盤/腕帽+三指鉤爪(tboxF 指節+finF 弧爪,一指一件)'],
    ['強健後腿 ×2', '巨股楔殼+prismF 前甲板+latheF 髖盤/膝盤+hydCyl 腱活塞 ×2+脛前甲+踝環'],
    ['足 ×2', '楔台足身+踝前斜甲+三趾(tboxF 指節+finF 弧爪)+後距爪 —— 爪一趾一件'],
    ['重尾(chainF 九節配重)', '九節收分節鏈+節環+背脊板 ×4(索引遞減)+coneF 尾梢錐'],
  ],
  head(c, h) {
    const { PAL, accent } = c;
    // 側剖稜面顱殼(prismF 剖面 = (前,上) 平面,rotation.y = −π/2 讓剖面 x → +z 前伸)——
    // 水平體軸機種:頭幾何自樞軸往前懸伸(★ 圖:楔形吻部、眉峰隆起、後顱收圓)
    const skull = prismF(h, [
      [-0.22, -0.02], [0.33, -0.15], [1.19, -0.18], [1.47, -0.11], [1.50, 0.04],
      [1.21, 0.18], [0.57, 0.33], [0.26, 0.39], [-0.11, 0.33], [-0.26, 0.13],
    ], 0.76, 0, 0, 0, PAL.main, { metalness: 0.55 });
    skull.rotation.y = -Math.PI / 2;
    // 頰甲板 ×2(prismF 六角側貼;★ 圖眼下層疊頰甲)
    for (const sx of [-1, 1]) {
      const cheek = prismF(h, [
        [0.06, -0.13], [0.44, -0.18], [0.68, -0.02], [0.61, 0.15], [0.22, 0.22], [0.00, 0.09],
      ], 0.10, sx * 0.435, 0, 0, PAL.mid, { metalness: 0.6 });
      cheek.rotation.y = -Math.PI / 2;
      // 怒眉稜(內端下壓的斜楔 = ★ 圖的兇相)+ 眼(眉下暗窩發光)
      const brow = tboxF(h, { w0: 0.22, d0: 0.22, w1: 0.16, d1: 0.14, h: 0.10, sz: 0.02 }, sx * 0.28, 0.35, 0.46, PAL.deep, { metalness: 0.6 });
      brow.rotation.z = -sx * 0.28;
      brow.rotation.x = -0.08;
      bxF(h, 0.055, 0.08, 0.13, sx * 0.385, 0.15, 0.42, accent, { emissive: accent, emissiveIntensity: 1.5 });
      // 鼻孔排氣(吻頂小孔 = 引擎排氣的生物機械雙關)
      cylF(h, 0.03, 0.03, 0.05, 6, sx * 0.12, 0.24, 1.34, INK, { metalness: 0.7 }).rotation.x = 0.4;
      // 鉤形前獠牙(sz 剪切:根前傾、尖端下勾 —— ★ 圖吻端鉤喙)
      tboxF(h, { w0: 0.035, d0: 0.042, w1: 0.10, d1: 0.11, h: 0.29, sz: 0.065 }, sx * 0.175, -0.29, 1.36, TEETH, { metalness: 0.35 });
    }
    // 上齒列(一齒一件:根寬在上、尖端在下,前大後小索引遞變)
    for (let i = 0; i < 5; i++) {
      const th = 0.22 - i * 0.022;
      for (const sx of [-1, 1])
        tboxF(h, { w0: 0.028, d0: 0.033, w1: 0.095, d1: 0.11, h: th }, sx * 0.315, -0.165 - th / 2, 1.15 - i * 0.165, TEETH, { metalness: 0.35 });
    }
    // 口腔頂板(暗紅;張口時從顎縫看得到)
    bxF(h, 0.50, 0.05, 0.80, 0, -0.19, 0.80, MAWRED, { metalness: 0.2 });
    // 文氏尾噴(無後座砲識別:頭後喇叭開口,後噴抵銷後座)
    const vent = latheF(h, [[0.06, 0], [0.09, 0.10], [0.125, 0.21]], 10, 0, 0.07, -0.30, GUNMETAL, { metalness: 0.8 });
    vent.rotation.x = -Math.PI / 2;
  },
  neck(c, nk) {
    const { PAL } = c;
    // 頸芯柱:自胸艙頂一路頂進頭底(頭在 neckG 局部 (0, 1.07, −0.06) —— 芯長 1.2 蓋過去,零斷縫)
    const core = cylF(nk, 0.26, 0.32, 1.2, 10, 0, 0.52, -0.02, PAL.dark, { metalness: 0.65 });
    core.rotation.x = -0.06;
    // 分節頸甲環 ×3(latheF 收分;★ 圖頸部 2~3 圈裝甲帶 —— 圖騰紋歸 paint 層)
    const rings = [[0.62, -0.02, 0.42, PAL.main], [0.80, -0.04, 0.36, PAL.mid], [0.97, -0.05, 0.31, PAL.main]];
    for (const [ry, rz, rr, col] of rings) {
      const ring = latheF(nk, [[rr * 0.86, -0.085], [rr, -0.04], [rr, 0.04], [rr * 0.86, 0.085]], 10, 0, ry, rz, col, { metalness: 0.55 });
      ring.rotation.x = -0.06;
      ring.scale.z = 1.12;
    }
    // 喉側管束(cablesF 一條一件)+ 背側鱗板 ×2
    cablesF(nk, { p0: [0, 0.42, 0.32], p1: [0, 1.0, 0.20], k: 3, r: 0.03, sag: 0.03, spread: 0.065 }, GUNMETAL, { metalness: 0.75 });
    for (const [py, pz] of [[0.62, -0.36], [0.84, -0.33]]) {
      const sc = tboxF(nk, { w0: 0.32, d0: 0.10, w1: 0.24, d1: 0.07, h: 0.17, sz: -0.03 }, 0, py, pz, PAL.deep, { metalness: 0.6 });
      sc.rotation.x = -0.3;
    }
  },
  chest(c, ch, d) {
    const { PAL, accent } = c;
    // 斜置深胸艙(幾何前傾 0.52,樞軸不動):★ 圖體軸斜落、胸深腹厚
    const body = tboxF(ch, { w0: 1.25, d0: 1.5, w1: 1.0, d1: 1.0, h: 1.6, sz: 0.08 }, 0, 0.42, 0.10, PAL.main, { metalness: 0.55 });
    body.rotation.x = 0.52;
    // 外凸肋甲環 ×3(latheF 鼓環貼體軸;★ 圖軀幹一圈圈裝甲帶 = 全機最寬的量體)
    const hoops = [[0.03, -0.12, 0.82, PAL.mid], [0.38, 0.08, 0.88, PAL.main], [0.72, 0.27, 0.78, PAL.mid]];
    for (const [hy, hz, hr, col] of hoops) {
      const hp = latheF(ch, [[hr * 0.92, -0.08], [hr, -0.035], [hr, 0.035], [hr * 0.92, 0.08]], 12, 0, hy, hz, col, { metalness: 0.55 });
      hp.rotation.x = 0.52;
      hp.scale.z = 0.92;
    }
    // 左右胸甲板(prismF 六角,貼前傾面)+ 肩領環(頸根座圈)
    for (const sx of [-1, 1]) {
      const pec = prismF(ch, [[-0.17, -0.24], [0.17, -0.24], [0.28, 0], [0.17, 0.22], [-0.17, 0.22], [-0.28, 0]]
        .map(([x, y]) => [sx * x, y]), 0.10, sx * 0.34, 0.85, 0.80, PAL.lite, { metalness: 0.55 });
      pec.rotation.x = 0.52;
      // 側百葉(散熱開口)
      bxF(ch, 0.06, 0.26, 0.44, sx * 0.60, 0.52, 0.02, INK, { metalness: 0.7 }).rotation.y = sx * 0.1;
    }
    const collar = latheF(ch, [[0.44, -0.06], [0.50, -0.02], [0.50, 0.02], [0.44, 0.06]], 12, 0, 1.12, 0.24, PAL.mid, { metalness: 0.6 });
    collar.rotation.x = 0.35;
    collar.scale.z = 1.12;
    // 腹龍骨(下前緣深色楔)+ 腹側管束
    const keel = tboxF(ch, { w0: 0.55, d0: 0.45, w1: 0.45, d1: 0.35, h: 0.45 }, 0, -0.08, 0.52, PAL.dark, { metalness: 0.65 });
    keel.rotation.x = 0.6;
    cablesF(ch, { p0: [0, 0.35, 0.78], p1: [0, -0.25, 0.48], k: 3, r: 0.03, sag: 0.03, spread: 0.09 }, IRON, { metalness: 0.8 });
    // ── 背甲大蓋板(★ 圖肩後整片斜蓋:覆在骨盆與尾根之上,前緣讓開頸/頭)──
    const slab = prismF(ch, [
      [-0.10, 1.00], [-0.42, 1.66], [-0.85, 1.78], [-1.60, 1.68], [-1.88, 1.32], [-1.74, 0.96],
    ], 1.45, 0, 0, 0, PAL.mid, { metalness: 0.6 });
    slab.rotation.y = -Math.PI / 2;
    const cap = tboxF(ch, { w0: 1.00, d0: 0.88, w1: 0.86, d1: 0.72, h: 0.08 }, 0, 1.78, -1.22, PAL.main, { metalness: 0.55 });
    cap.rotation.x = 0.10;
    // 前斜面散熱百葉 ×4(INK 橫柵,索引沿斜面爬升;面前傾向後 ⇒ 負仰角)
    for (let i = 0; i < 4; i++)
      bxF(ch, 0.78, 0.04, 0.15, 0, 1.12 + i * 0.15, -0.17 - i * 0.075, INK, { metalness: 0.7 }).rotation.x = -0.49;
    // 側鉸座 ×2 + 後支柱(蓋板落在骨盆上的結構件)+ 後排氣 ×2
    for (const sx of [-1, 1]) {
      tboxF(ch, { w0: 0.09, d0: 0.58, w1: 0.075, d1: 0.44, h: 0.32 }, sx * 0.74, 1.30, -0.92, PAL.deep, { metalness: 0.6 });
      cylF(ch, 0.08, 0.08, 0.18, 8, sx * 0.30, 1.36, -1.82, INK, { metalness: 0.75 }).rotation.x = Math.PI / 2 + 0.3;
    }
    const strut = tboxF(ch, { w0: 0.50, d0: 0.70, w1: 0.44, d1: 0.75, h: 0.80, sz: -0.10 }, 0, 0.58, -0.85, PAL.deep, { metalness: 0.6 });
    strut.rotation.x = -0.12;
    // 脊背識別燈
    bxF(ch, 0.42, 0.05, 0.26, 0, 1.83, -0.90, accent, { emissive: accent, emissiveIntensity: 0.8 });
  },
  pelvis(c, hips) {
    const { PAL } = c;
    // 骨盆塊(後傾收分,接尾根)+ 下腹護板 + 尾根座環
    const block = tboxF(hips, { w0: 1.05, d0: 1.05, w1: 0.90, d1: 0.85, h: 0.65, sz: -0.08 }, 0, 0.02, -0.12, PAL.mid, { metalness: 0.6 });
    block.rotation.x = -0.12;
    tboxF(hips, { w0: 0.75, d0: 0.75, w1: 0.62, d1: 0.58, h: 0.32 }, 0, -0.30, -0.18, GUNMETAL, { metalness: 0.7 });
    const tr = latheF(hips, [[0.28, -0.06], [0.34, -0.02], [0.34, 0.02], [0.28, 0.06]], 10, 0, -0.04, -0.55, IRON, { metalness: 0.8 });
    tr.rotation.x = Math.PI / 2;
  },
  thigh(c, l, d) {
    const { PAL } = c;
    // 巨股楔殼(★ 圖後腿全機最大肌群:上寬下收)
    tboxF(l, { w0: 0.62, d0: 0.85, w1: 0.36, d1: 0.48, h: d.len }, 0, -d.len * 0.5, 0.08, PAL.main, { metalness: 0.55 });
    // 前甲板(prismF 圓角六角,層疊在股前 —— 黃紋歸 paint 層)
    const plate = prismF(l, [[-0.23, -0.63], [0.23, -0.63], [0.34, -0.11], [0.21, 0.32], [-0.21, 0.32], [-0.34, -0.11]],
      0.12, 0, -d.len * 0.42, 0.47, PAL.lite, { metalness: 0.55 });
    plate.rotation.x = 0.06;
    // 髖側大圓盤關節(latheF;★ 圖髖部醒目圓盤,盤面圖騰歸 paint)+ 軸帽
    const hd = latheF(l, [[0.06, -0.06], [0.29, -0.05], [0.34, 0], [0.29, 0.05], [0.06, 0.06]], 12, c.sx * 0.36, -0.08, 0.06, PAL.mid, { metalness: 0.7 });
    hd.rotation.z = Math.PI / 2;
    const hub = cylF(l, 0.09, 0.09, 0.06, 10, c.sx * 0.40, -0.08, 0.06, PAL.deep, { metalness: 0.8 });
    hub.rotation.z = Math.PI / 2;
    // 後側腱活塞(hydCyl 亮桿芯)+ 膝前護楔
    hydCyl(l, 0.05, d.len * 0.5, -c.sx * 0.16, -d.len * 0.58, -0.34, 0.12, PISTON);
    const kg = tboxF(l, { w0: 0.32, d0: 0.13, w1: 0.25, d1: 0.10, h: 0.28, sz: 0.04 }, 0, -d.len * 0.94, 0.30, PAL.deep, { metalness: 0.6 });
    kg.rotation.x = -0.15;
  },
  shin(c, l, d) {
    const { PAL } = c;
    // 細瘦趾行小腿(踝端收分,後掠剪影)
    tboxF(l, { w0: 0.32, d0: 0.46, w1: 0.21, d1: 0.27, h: d.len }, 0, -d.len * 0.5, -0.02, PAL.mid, { metalness: 0.6 });
    // 膝側圓盤(latheF)+ 軸帽
    const kd = latheF(l, [[0.04, -0.05], [0.19, -0.038], [0.23, 0], [0.19, 0.038], [0.04, 0.05]], 10, c.sx * 0.21, -0.05, 0.02, PAL.mid, { metalness: 0.7 });
    kd.rotation.z = Math.PI / 2;
    const hub = cylF(l, 0.065, 0.065, 0.05, 8, c.sx * 0.25, -0.05, 0.02, PAL.deep, { metalness: 0.8 });
    hub.rotation.z = Math.PI / 2;
    // 脛前甲(細長楔)+ 後側腱活塞 + 踝座環
    const greave = tboxF(l, { w0: 0.25, d0: 0.11, w1: 0.18, d1: 0.08, h: 0.60 }, 0, -d.len * 0.42, 0.22, PAL.lite, { metalness: 0.55 });
    greave.rotation.x = -0.06;
    hydCyl(l, 0.038, d.len * 0.48, -c.sx * 0.08, -d.len * 0.55, -0.24, 0.1, PISTON);
    latheF(l, [[0.14, -0.05], [0.17, -0.02], [0.17, 0.02], [0.14, 0.05]], 10, 0, -d.len * 0.94, -0.01, IRON, { metalness: 0.8 });
  },
  foot(c, l, d) {
    const { PAL } = c;
    // 足身楔台 + 踝前斜甲(★ 圖深色踝甲圈)
    tboxF(l, { w0: 0.48, d0: d.footL, w1: 0.38, d1: d.footL * 0.7, h: 0.18, sz: 0.06 }, 0, -d.clear * 0.45, d.footL * 0.15, PAL.deep, { metalness: 0.55 });
    const guard = tboxF(l, { w0: 0.32, d0: 0.09, w1: 0.25, d1: 0.07, h: 0.30 }, 0, 0.05, 0.16, PAL.mid, { metalness: 0.6 });
    guard.rotation.x = 0.5;
    // 三趾:tboxF 指節 + finF 弧爪(一趾一件;中趾索引放大)
    for (let i = -1; i <= 1; i++) {
      const k = 1 - Math.abs(i) * 0.16;
      const kn = tboxF(l, { w0: 0.16, d0: 0.15, w1: 0.11 * k, d1: 0.11, h: 0.28 * k }, i * 0.20, -d.clear * 0.45, d.footL * 0.48, PAL.mid, { metalness: 0.6 });
      kn.rotation.x = Math.PI / 2;
      const claw = finF(l, { len: 0.32 * k, w0: 0.12, w1: 0.024, t: 0.10, sweep: 0.05, camber: 0.045 },
        i * 0.20, -d.clear * 0.5, d.footL * 0.64, CLAWSTEEL, { metalness: 0.7 });
      claw.rotation.x = Math.PI / 2 + 0.5;
    }
    // 後距爪(finF 朝後下)
    const spur = finF(l, { len: 0.22, w0: 0.09, w1: 0.022, t: 0.075, sweep: 0.04, camber: 0.035 }, 0, -d.clear * 0.3, -d.footL * 0.28, CLAWSTEEL, { metalness: 0.7 });
    spur.rotation.x = -(Math.PI / 2 + 0.4);
  },
  armUp(c, a, d) {
    const { PAL } = c;
    // 球肩(sphF)+ 亮色楔臂殼 + 活塞:短前臂幾何整組前置(+z 0.30)貼胸前 —— ★ 圖短臂在胸前深屈
    sphF(a, 0.15, 0, 0.02, 0.30, PAL.mid, { metalness: 0.65 });
    tboxF(a, { w0: 0.20, d0: 0.22, w1: 0.15, d1: 0.17, h: d.len * 0.94 }, 0, -d.len * 0.5 - 0.02, 0.30, PAL.lite, { metalness: 0.55 });
    hydCyl(a, 0.026, d.len * 0.5, c.sx * 0.12, -d.len * 0.55, 0.24, -0.06, PISTON);
  },
  armFore(c, a, d) {
    const { PAL } = c;
    // 肘盤(latheF)+ 前臂細殼(root 依肘屈角補償貼回上臂端)+ 活塞
    const ed = latheF(a, [[0.035, -0.045], [0.11, -0.036], [0.13, 0], [0.11, 0.036], [0.035, 0.045]], 10, c.sx * 0.12, -0.01, 0.28, PAL.mid, { metalness: 0.75 });
    ed.rotation.z = Math.PI / 2;
    tboxF(a, { w0: 0.15, d0: 0.17, w1: 0.11, d1: 0.13, h: d.len * 0.94 }, 0, -d.len * 0.56, 0.26, PAL.lite, { metalness: 0.6 });
    hydCyl(a, 0.022, d.len * 0.45, -c.sx * 0.085, -d.len * 0.5, 0.20, -0.05, PISTON);
  },
  mount(c, F) {
    const { PAL, accent } = c;
    // ── 顎鉸 + 下顎(真樞軸:heavyPivot 充能張顎 = 射擊姿勢;rest 常開 0.30 露砲)──
    const jawG = new THREE.Group();
    jawG.position.set(0, -0.18, 0.13);
    jawG.rotation.x = 0.36;
    F.head.add(jawG);
    const axle = cylF(jawG, 0.06, 0.06, 0.64, 8, 0, 0.02, 0, IRON, { metalness: 0.85 });
    axle.rotation.z = Math.PI / 2;
    for (const sx of [-1, 1]) {
      const hd = latheF(jawG, [[0.045, -0.038], [0.11, -0.03], [0.125, 0], [0.11, 0.03], [0.045, 0.038]], 10, sx * 0.34, 0.02, 0, PAL.deep, { metalness: 0.8 });
      hd.rotation.z = Math.PI / 2;
    }
    const jaw = prismF(jawG, [
      [-0.07, -0.18], [0.61, -0.24], [1.05, -0.18], [1.19, -0.02], [1.12, 0.07], [0.88, 0.02], [0.17, 0.02], [-0.11, -0.02],
    ], 0.52, 0, 0, 0, PAL.mid, { metalness: 0.6 });
    jaw.rotation.y = -Math.PI / 2;
    // 下齒列(一齒一件,尖端朝上、前大後小)+ 口腔底板(暗紅)
    for (let i = 0; i < 4; i++) {
      const th = 0.14 - i * 0.016;
      for (const sx of [-1, 1])
        tboxF(jawG, { w0: 0.065, d0: 0.08, w1: 0.022, d1: 0.028, h: th }, sx * 0.21, 0.02 + th / 2, 1.0 - i * 0.19, TEETH, { metalness: 0.35 });
    }
    bxF(jawG, 0.38, 0.05, 0.80, 0, 0.02, 0.55, MAWRED, { metalness: 0.2 });
    // ── 口腔四管旋管砲束(輕/重同膛:lMuz 管束小環、hMuz 充能大環;藏在顎裡,張口才見)──
    const tg = new THREE.Group();
    tg.position.set(0, -0.34, 0.33);
    F.head.add(tg);
    const breech = tboxF(tg, { w0: 0.28, d0: 0.26, w1: 0.24, d1: 0.22, h: 0.32 }, 0, 0, 0.02, GUNMETAL, { metalness: 0.8 });
    breech.rotation.x = Math.PI / 2;
    cylF(tg, 0.08, 0.08, 0.80, 8, 0, 0, 0.46, COAL, { metalness: 0.85 }).rotation.x = Math.PI / 2;
    for (let i = 0; i < 4; i++) {
      const a2 = i * Math.PI / 2 + Math.PI / 4;
      cylF(tg, 0.045, 0.045, 0.86, 8, Math.cos(a2) * 0.09, Math.sin(a2) * 0.09, 0.52, INK, { metalness: 0.85 }).rotation.x = Math.PI / 2;
    }
    const hMuz = latheF(tg, [[0.13, -0.038], [0.17, -0.014], [0.17, 0.014], [0.13, 0.038]], 10, 0, 0, 0.84, accent, { emissive: accent, emissiveIntensity: 1.5 });
    hMuz.rotation.x = Math.PI / 2;
    const lMuz = latheF(tg, [[0.065, -0.026], [0.095, -0.011], [0.095, 0.011], [0.065, 0.026]], 10, 0, 0, 1.02, accent, { emissive: accent, emissiveIntensity: 1.3 });
    lMuz.rotation.x = Math.PI / 2;
    cylF(tg, 0.058, 0.058, 0.05, 8, 0, 0, 1.0, INK, { metalness: 0.3 }).rotation.x = Math.PI / 2;
    // ── 三指鉤爪 ×2(F.hand:腕帽 + tboxF 指節 + finF 弧爪,一指一件;★ 圖多節夾爪)──
    for (const [g, sx] of [[F.handL, -1], [F.handR, 1]]) {
      const cap = latheF(g, [[0.055, -0.045], [0.095, -0.022], [0.095, 0.022], [0.055, 0.045]], 10, 0, -0.02, 0.24, PAL.deep, { metalness: 0.7 });
      cap.rotation.x = 0.2;
      for (let i = -1; i <= 1; i++) {
        const s1 = tboxF(g, { w0: 0.055, d0: 0.06, w1: 0.04, d1: 0.048, h: 0.19 }, i * 0.08, -0.11, 0.37, CLAWSTEEL, { metalness: 0.7 });
        s1.rotation.x = Math.PI / 2 + 0.55 + i * 0.06;
        const s2 = finF(g, { len: 0.21, w0: 0.058, w1: 0.014, t: 0.05, sweep: 0.04, camber: 0.035 }, i * 0.08, -0.17, 0.47, CLAWSTEEL, { metalness: 0.7 });
        s2.rotation.x = Math.PI / 2 + 1.05 + i * 0.08;
      }
    }
    return {
      gunR: null, gunL: null,
      muzzles: { light: { n: lMuz, r: 0.095 }, heavy: { n: hMuz, r: 0.17 } },
      lightGlowM: [lMuz], heavyGlowM: [hMuz],
      heavyPivot: [{ obj: jawG, rest: { x: 0.36, y: 0, z: 0 }, deploy: { x: 0.68, y: 0, z: 0 } }],   // 充能張顎
      weap: { light: 'N', heavy: 'N' },
      hvy: { chest: 0.06 },
      aimPose: null,
      wpn: { light: { nodes: [tg], ref: tg, muz: lMuz, fwd: 'z' }, heavy: { nodes: [tg, jawG], ref: tg, muz: hMuz, fwd: 'z' } },
    };
  },
  extra(c, F, rig) {
    const { PAL } = c;
    // 重尾(chainF 九節收分)—— whipTail 逐幀「覆寫」節樞軸旋轉 ⇒ 垂尾基礎姿勢 MUST 住幾何:
    // 掛在一個下傾的尾根 Group 上(whipTail 摸不到它),行進時 tailUp 再把尾抬回配平。
    // 節間分隔改深色窄環(INK):亮環會把收分節鏈讀成螺紋鑽頭(v2 實測)。
    const tailRoot = new THREE.Group();
    tailRoot.position.set(0, -0.04, -0.60);
    tailRoot.rotation.x = -0.38;
    F.hips.add(tailRoot);
    const { segs, tip } = chainF(tailRoot, {
      n: 9, y: 0, z: 0,
      len0: 0.58, len1: 0.28, r0: 0.42, r1: 0.10,
      rot0: -0.04, rotD: 0.02, ring: false, seg: 10,
      drawSeg: (t, i, { r, len }) => {
        const sep = cylF(t, r * 1.05, r * 1.05, r * 0.22, 10, 0, 0, -0.015, INK, { metalness: 0.7 });
        sep.rotation.x = Math.PI / 2;
        if (i < 4) tboxF(t, { w0: r * 0.55, d0: len * 0.5, w1: r * 0.3, d1: len * 0.32, h: 0.13 - i * 0.02 },
          0, r * 0.9, -len * 0.5, PAL.deep, { metalness: 0.6 });
      },
    }, PAL.main, { metalness: 0.55 });
    // 尾梢錐(coneF 朝後;★ 圖尾端收尖微翹)
    const tipCone = coneF(tip, 0.09, 0.38, 6, 0, 0, -0.45, PAL.deep, { metalness: 0.6 });
    tipCone.rotation.x = -Math.PI / 2;
    rig.tailSegs = segs;
    rig.tailUp = 0.3;
    rig.tinyArms = 1;      // 退化短前臂:不套一般雙足擺臂公式(locomotion)
    rig.leanF = 0.3;       // 水平體軸:加速不再壓頭,改抬尾配平
  },
};
