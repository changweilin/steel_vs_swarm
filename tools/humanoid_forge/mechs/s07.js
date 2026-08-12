// ============ s07 逐機零件檔(dev-only;仿生四足 D.kind 'quad' + soft 觸手腿)============
// ── s07「證明完畢」八臂防空機甲(cthulhu 頭足類):四觸手步行 + 四觸手持武、複眼群 ──
// 2D 定案圖:public/assets/cyberpunk_art/mechs/s07_{static,moving,heavy}.jpg(★ = s07_heavy)
// 幾何語彙一律取自 ../geo.js;MUST NOT 在本檔自建 BufferGeometry。
// 2026-08-12 多面體改寫(照 ★ 圖逐部位):
//   外套膜 = latheF 橢殼(scale.z 前後拉長)+ torusF 腹縫肋環 + tboxF 三片深色背甲罩;
//   背頂 = tboxF 艙盒(前通風柵)+ latheF 雷達碟(桅杆 + 饋源三桿,★ 圖頂部招牌件);
//   臉 = prismF 蒼白臉板 + 雙大複眼(torusF 眶環 + sphF 玻璃頂)+ 小眼列 ×6 + torusF 弧眉
//        + 口部通風柵;面鬚 = chainF 三節收分 ×5(垂墜前捲)+ cablesF 側細鬚;
//   步行腿 ×4 = 鏈契約不動(root+四節小 k),節身改 tboxF 甲殼 + latheF 側關節盤 + hydCyl
//        活塞 + 雙爪蹄(★ 圖是甲殼多節腿不是軟管);
//   持武觸手 ×4 = chainF 六節環節(節間 IRON 關節環 + 腹面吸盤列),生根點方位 = 對應
//        步行腿 (±legX, fz/hz) 的方位(章魚八臂環狀輻射、上下成對;_tentAt 同一份推導),
//        自錨點向外上弧起再回捲;前對持 25mm 空爆機砲 / 諧振器 orb、後對各托一枚攔截彈;
//   腹下 = chainF 虹吸管 + 發射軌條;全機纜束 = cablesF(罩下垂落,★ 圖前肩明顯)。
import * as THREE from 'three';
import {
  matF, dimF, bxF, cylF, sphF, coneF, torusF, tboxF, prismF, latheF, finF, fanF, chainF, cablesF,
  hydCyl, sinew, seg2, IRON, GUNMETAL, COAL, INK, BONE, BRASS,
} from '../geo.js';

// 本機專用色:攔截彈淺鋼灰(★ 圖的白灰飛彈)/ 複眼玻璃深藍
const STEEL2 = 0xcfd8e0, GLASS = 0x16222e;

export default {
  label: '證明完畢(s07 機甲・頭足類)', hue: 0x7fd8ff, kind: 'quad', height: 4.8,
  frame: {
    hipY: 2.1, legX: 0.95, fz: 0.8, hz: -1.1,
    chest: [0, 0.15, 0.4], neck: [0, 0.35, 0.5], head: [0, 0.25, 0.3],
    tailY: 0, tailZ: -0.9, tail2Z: 0.6,     // 尾已退場語意(遊戲同款):tail/tail2 留空樞軸
  },
  gait: { gait: 'crawl', stride: 1.7, top: 7, bob: 0.05, legAmp: 0.8, pitchAmp: 0.04, soft: 1 },
  moveSig: { poise: 0.08, idleF: 0.70, idleA: 1.72, launch: 0.05, spool: 0.14, brake: 0.05, settle: 1.65 },
  castSig: { omni: 'dance', dir: 'swing' },
  doc: [
    ['外套膜(囊狀主體)', 'latheF 橢殼(前後拉長)+ torusF 腹縫肋環 + tboxF 三片深色背甲罩 + 罩下 cablesF 纜束 ×2'],
    ['背頂(艙盒 + 雷達碟)', 'tboxF 艙盒(bxF 通風柵 ×3)+ latheF 雷達碟(cylF 桅杆/饋源三桿 + sphF 饋源燈)'],
    ['頭(複眼群 + 面鬚)', 'prismF 蒼白臉板 + 雙大複眼(torusF 眶環 + sphF 玻璃頂)+ 小眼列 ×6 + torusF 弧眉 + 口柵;面鬚 = chainF 三節收分 ×5 + cablesF 側細鬚'],
    ['觸手步行腿 ×4(五節行進波)', '節身 tboxF 甲殼(逐節收分)+ latheF 側關節盤 + hydCyl 活塞 + prismF 根部護甲弧板 + 雙爪蹄(tboxF 爪 + coneF 後距)'],
    ['持武觸手 ×4(rig.tents)', 'chainF 六節環節(IRON 關節環 + 腹面吸盤列)+ sphF 球窩罩;生根點 = 對應步行腿方位貼殼收斂(右前/左前/右後/左後上下成對),向外上弧起再回捲;末端世界對齊樞軸(槍口恆朝前)'],
    ['武裝(25mm 空爆機砲 / 諧振器 / 攔截彈 ×2)', '機砲 = tboxF 機匣 + latheF 階狀砲身 + 彈鼓;諧振器 = latheF 托座 + sphF 諧振球 + torusF 環 ×2;攔截彈 = latheF 彈體 + coneF 彈頭 + finF 尾翼 ×4'],
    ['腹部(虹吸管 + 發射軌)', 'chainF 三節下垂虹吸管 + bxF 發射軌條 ×2'],
  ],
  body(c, spine, chest) {
    const { PAL, accent } = c;
    // 外套膜:橢圓旋成殼(scale.z 前後拉長 = ★ 圖的囊狀剖面)
    const mant = latheF(spine, [
      [0.55, -0.85], [0.95, -0.55], [1.12, -0.05], [0.95, 0.5], [0.55, 0.85], [0.0001, 1.0],
    ], 12, 0, 0.05, -0.1, PAL.main, { metalness: 0.45 });
    mant.scale.z = 1.28;
    // 腹縫肋環(★ 圖下殼那一圈水平接縫)
    const seam = torusF(spine, 1.12, 0.05, 0, -0.32, -0.1, dimF(PAL.main, 0.8), { metalness: 0.55 });
    seam.scale.y = 1.28;                     // 先縮後轉:local y → world z 的橢圓拉長
    seam.rotation.x = Math.PI / 2;
    // 深色背甲頂蓋(latheF 上半殼 + 三片角面甲板)—— ★ 圖:上半整片深色碳殼、下半淺色囊殼
    const cap = latheF(spine, [[1.03, 0.28], [0.97, 0.55], [0.66, 0.84], [0.0001, 1.0]], 12, 0, 0.05, -0.1, dimF(PAL.deep, 0.72), { metalness: 0.6 });
    cap.scale.z = 1.28;
    const hood = tboxF(spine, { w0: 1.3, d0: 1.0, w1: 0.95, d1: 0.7, h: 0.34, sz: 0.12 }, 0, 0.78, 0.5, PAL.deep, { metalness: 0.6 });
    hood.rotation.x = 0.45;
    tboxF(spine, { w0: 1.5, d0: 1.35, w1: 1.1, d1: 1.05, h: 0.36 }, 0, 0.88, -0.25, dimF(PAL.deep, 0.85), { metalness: 0.6 }).rotation.x = 0.06;
    const back = tboxF(spine, { w0: 1.25, d0: 1.0, w1: 0.85, d1: 0.6, h: 0.3, sz: -0.15 }, 0, 0.68, -0.95, dimF(PAL.deep, 0.85), { metalness: 0.6 });
    back.rotation.x = -0.42;
    // 鞍部檢修口 + 識別燈縫(★ 圖背甲上的小方格細節)
    bxF(spine, 0.26, 0.05, 0.18, 0.32, 1.1, -0.15, dimF(PAL.deep, 0.75), { metalness: 0.7 });
    bxF(spine, 0.4, 0.03, 0.05, -0.28, 1.08, 0.1, accent, { emissive: accent, emissiveIntensity: 0.7 });
    // 背頂艙盒(★ 圖正中的深色方艙;前面通風柵 ×3)
    tboxF(spine, { w0: 0.95, d0: 0.85, w1: 0.82, d1: 0.72, h: 0.44 }, 0, 1.22, -0.32, GUNMETAL, { metalness: 0.65 });
    for (let i = 0; i < 3; i++)
      bxF(spine, 0.5, 0.045, 0.03, 0, 1.1 + i * 0.09, 0.11, COAL, { metalness: 0.5 });
    bxF(spine, 0.3, 0.06, 0.22, 0.16, 1.46, -0.5, dimF(GUNMETAL, 0.8), { metalness: 0.7 });
    // 雷達碟(★ 圖頂部招牌件:桅杆 + 淺拋物碟 + 饋源三桿 + 饋源燈)—— 碟口朝前上(正面看得到凹面)
    const dishG = new THREE.Group();
    dishG.position.set(0.06, 1.42, -0.18);
    spine.add(dishG);
    cylF(dishG, 0.05, 0.07, 0.32, 8, 0, 0.16, 0, IRON, { metalness: 0.8 });
    const dish = latheF(dishG, [[0.02, 0], [0.29, 0.055], [0.49, 0.13], [0.56, 0.19], [0.56, 0.22]], 12, 0, 0.34, 0, dimF(STEEL2, 0.85), { metalness: 0.6 });
    dish.rotation.set(0.5, 0, 0.25);
    for (let i = 0; i < 3; i++) {
      const a = i * 2.094;
      const st = cylF(dish, 0.012, 0.012, 0.36, 5, Math.cos(a) * 0.24, 0.3, Math.sin(a) * 0.24, COAL, { metalness: 0.8 });
      st.rotation.z = Math.cos(a) * 0.5;
      st.rotation.x = -Math.sin(a) * 0.5;
      st.userData.noOutline = true;
    }
    sphF(dish, 0.05, 0, 0.46, 0, accent, { emissive: accent, emissiveIntensity: 1.2 });
    // 罩下纜束 ×2(★ 圖前肩垂落的管線;一條一零件)—— 細管掛 noOutline(描邊殼比管粗會整條變黑)
    for (const sx of [-1, 1])
      cablesF(spine, { p0: [sx * 0.3, 0.8, 0.6], p1: [sx * 0.85, 0.0, 0.8], k: 4, r: 0.026, sag: 0.16, spread: 0.09 }, GUNMETAL, { metalness: 0.6 })
        .forEach((m) => { m.userData.noOutline = true; });
    // 腹下:虹吸管(chainF 三節下垂)+ 發射軌條 ×2
    chainF(spine, {
      n: 3, y: -0.55, z: -0.72, len0: 0.42, len1: 0.26, r0: 0.13, r1: 0.07,
      rot0: -1.62, rotD: -0.14, ring: true, ringColor: COAL, seg: 8,
    }, GUNMETAL, { metalness: 0.5 });
    for (const sx of [-1, 1])
      bxF(spine, 0.09, 0.07, 1.5, sx * 0.22, -0.72, 0.05, COAL, { metalness: 0.6 });
    // 持武觸手根部球窩罩 ×4(觸手在罩內轉動;生根點 = mount 同一份 _tentAt 推導)
    for (const [sx, front] of [[-1, true], [1, true], [-1, false], [1, false]]) {
      const sock = sphF(chest, 0.24, ...this._tentAt(c, sx, front).p, dimF(PAL.deep, 0.8), { metalness: 0.6 });
      sock.scale.y = 0.75;
    }
  },
  // 持武觸手生根點(body 球窩罩與 mount 共用的唯一推導):
  // 方位 = 對應步行腿 —— 腿掛世界根 (±legX, fz/hz)、外套膜中心在 chest 座標是 (0, ·, -chest.z)
  // ⇒ 自中心看的腿方位向量恰為 (±legX, fz/hz);沿它貼殼收斂(半徑 rad)、y 取外套膜上側翼。
  // yaw = 讓 chain 初始 -z 指向該方位(root 'YXZ':先仰後轉方位,弧線恆落在腿的鉛直方位面)。
  _tentAt(c, sx, front) {
    const d = c.dims, zLeg = front ? d.fz : d.hz, rad = front ? 0.85 : 0.9;
    const n = Math.hypot(d.legX, zLeg);
    return {
      p: [sx * (d.legX / n) * rad, 0.5, -d.chest[2] + (zLeg / n) * rad],
      yaw: Math.atan2(-sx * d.legX, -zLeg),
    };
  },
  neckHead(c, neck, head) {
    const { PAL, accent } = c;
    // 蒼白臉板(prismF 圓角盾形;★ 圖淺青白的正面大臉)
    const face = prismF(head, [
      [-0.16, -0.62], [0.16, -0.62], [0.44, -0.3], [0.58, 0.1], [0.5, 0.42],
      [0.26, 0.56], [-0.26, 0.56], [-0.5, 0.42], [-0.58, 0.1], [-0.44, -0.3],
    ], 0.12, 0, -0.05, 0.1, PAL.lite, { metalness: 0.35 });
    face.rotation.x = -0.1;
    for (const sx of [-1, 1]) {
      // 雙大複眼:torusF 眶環(蒼白)+ sphF 玻璃頂(深藍微光)
      const rim = torusF(head, 0.24, 0.04, sx * 0.34, 0.08, 0.2, PAL.lite, { metalness: 0.4 });
      const eye = sphF(head, 0.24, sx * 0.34, 0.08, 0.16, GLASS, { metalness: 0.3, emissive: accent, emissiveIntensity: 0.35 });
      eye.scale.z = 0.7;
      // 弧眉稜(torusF 弧段拱在眼上)
      const brow = torusF(head, 0.3, 0.03, sx * 0.34, 0.12, 0.22, PAL.mid, { metalness: 0.5 }, 1.9);
      brow.rotation.z = Math.PI / 2 - 0.95;
      // 小眼列 ×3(★ 圖每眼上方的三顆小圓點,沿眉外斜排)
      for (let i = 0; i < 3; i++)
        sphF(head, 0.035, sx * (0.16 + i * 0.11), 0.46 - i * 0.025, 0.17, accent, { emissive: accent, emissiveIntensity: 1.0 });
    }
    // 中央鼻盾(prismF 小三角)+ 口部通風柵(tboxF 框 + bxF 柵條 ×3)
    prismF(head, [[0, -0.16], [0.08, 0.02], [-0.08, 0.02]], 0.05, 0, 0.0, 0.19, PAL.mid, { metalness: 0.5 });
    tboxF(head, { w0: 0.3, d0: 0.07, w1: 0.26, d1: 0.07, h: 0.28 }, 0, -0.33, 0.16, INK, { metalness: 0.4 });
    for (let i = 0; i < 3; i++)
      bxF(head, 0.2, 0.035, 0.02, 0, -0.24 - i * 0.08, 0.21, GUNMETAL, { metalness: 0.6 });
    // 面鬚 ×5(chainF 三節收分;中央最長、垂墜後前捲 —— 片間差異 = 索引遞變)。
    // 垂墜角住 wrapper Group:chainF 的 rot0 是逐關節相對角,塞大角會逐節捲成死結
    for (let i = -2; i <= 2; i++) {
      const s = 1 - 0.14 * Math.abs(i);
      const dg = new THREE.Group();
      dg.position.set(i * 0.15, -0.5, 0.14);
      dg.rotation.x = -1.8 + Math.abs(i) * 0.12;
      head.add(dg);
      chainF(dg, {
        n: 3, len0: 0.4 * s, len1: 0.24 * s, r0: 0.065 * s, r1: 0.02,
        rot0: -0.06, rotD: -0.14, ring: false, seg: 6,
      }, PAL.lite, { metalness: 0.3 });
      dg.traverse((o) => { if (o.isMesh) o.userData.noOutline = true; });   // 細鬚吞不下描邊殼
    }
    // 側細鬚(cablesF;★ moving 圖往兩側甩開的細鬚)
    for (const sx of [-1, 1])
      cablesF(head, { p0: [sx * 0.4, -0.38, 0.08], p1: [sx * 0.95, -0.85, 0.3], k: 2, r: 0.014, sag: 0.26, spread: 0.05 }, GUNMETAL, { metalness: 0.6 })
        .forEach((m) => { m.userData.noOutline = true; });
  },
  legF(c) { return this._tentLeg(c, 1); },
  legH(c) { return this._tentLeg(c, -1); },
  // 步行腿:鏈契約不動(root = 肩基座,stepQuad 直接擺 + 四節小 k 行進波)——
  // 節身照 ★ 圖改甲殼多節腿:tboxF 收分殼 + latheF 側關節盤 + hydCyl 活塞 + 雙爪蹄
  _tentLeg(c, S) {
    const { PAL } = c;
    const disc = (l, r, y) => {
      const d = latheF(l, [[0.02, -r * 0.28], [r * 0.85, -r * 0.22], [r, 0], [r * 0.85, r * 0.22], [0.02, r * 0.28]], 10, c.sx * 0.17, y, 0, IRON, { metalness: 0.85 });
      d.rotation.z = Math.PI / 2;
      return d;
    };
    const segs = [{
      len: 0.7,
      draw: (l) => {
        // 根節(髖甲):tboxF 收分殼 + 髖側關節盤 + 根部護甲弧板(★ 圖腿根的蒼白弧甲)
        tboxF(l, { w0: 0.32, d0: 0.34, w1: 0.44, d1: 0.46, h: 0.62 }, 0, -0.33, 0, PAL.mid, { metalness: 0.55 });
        disc(l, 0.14, -0.08);
        const fd = prismF(l, [[-0.24, -0.18], [0.24, -0.18], [0.3, 0], [0.19, 0.2], [-0.19, 0.2], [-0.3, 0]], 0.07, c.sx * 0.26, -0.12, 0, PAL.lite, { metalness: 0.45 });
        fd.rotation.y = c.sx * Math.PI / 2;
      },
    }];
    const lens = [0.62, 0.55, 0.48, 0.4];
    const draws = [
      (l) => {   // 大腿:收分殼 + 膝上關節盤 + 前側活塞
        tboxF(l, { w0: 0.26, d0: 0.28, w1: 0.34, d1: 0.36, h: 0.58 }, 0, -0.3, 0, PAL.deep, { metalness: 0.6 });
        disc(l, 0.12, -0.02);
        hydCyl(l, 0.03, 0.36, -c.sx * 0.05, -0.3, 0.16, 0.14);
      },
      (l) => {   // 小腿上節:收分殼 + 關節盤 + 後側活塞
        tboxF(l, { w0: 0.2, d0: 0.22, w1: 0.27, d1: 0.29, h: 0.52 }, 0, -0.27, 0, PAL.dark, { metalness: 0.6 });
        disc(l, 0.1, -0.02);
        hydCyl(l, 0.024, 0.3, c.sx * 0.04, -0.26, -0.13, -0.12);
      },
      (l) => {   // 小腿下節:收分殼 + 踝環
        tboxF(l, { w0: 0.14, d0: 0.16, w1: 0.2, d1: 0.22, h: 0.46 }, 0, -0.24, 0, PAL.deep, { metalness: 0.6 });
        const r = latheF(l, [[0.11, -0.04], [0.13, 0], [0.11, 0.04]], 8, 0, -0.03, 0, IRON, { metalness: 0.8 });
        r.rotation.z = Math.PI / 2;
      },
      (l) => {   // 蹠節 + 雙爪蹄(★ 圖的小型二爪蹄足)+ 後距
        tboxF(l, { w0: 0.1, d0: 0.12, w1: 0.14, d1: 0.15, h: 0.3 }, 0, -0.16, 0, GUNMETAL, { metalness: 0.7 });
        tboxF(l, { w0: 0.2, d0: 0.2, w1: 0.13, d1: 0.15, h: 0.14, sz: 0.03 }, 0, -0.35, 0.03, PAL.deep, { metalness: 0.55 });
        for (const ox of [-0.06, 0.06]) {
          const toe = tboxF(l, { w0: 0.06, d0: 0.07, w1: 0.03, d1: 0.035, h: 0.16, sz: 0.03 }, ox, -0.39, 0.13, STEEL2, { metalness: 0.75 });
          toe.rotation.x = Math.PI / 2 + 0.35;
        }
        const spur = coneF(l, 0.035, 0.12, 5, 0, -0.37, -0.1, STEEL2, { metalness: 0.75 });
        spur.rotation.x = -2.5;
      },
    ];
    lens.forEach((len, i) => segs.push({
      len, base: (i === 0 ? 0.16 : -0.1) * S, k: 0.16 * S, d: (i + 1) * 0.55,
      draw: draws[i],
    }));
    return segs;
  },
  mount(c, F) {
    const { PAL, accent } = c;
    // ── 持武觸手 ×4(★ 圖:環節 + 腹面吸盤列;章魚式自外套膜側翼向外上弧起再回捲)──
    // 生根點方位 = 對應步行腿(_tentAt 唯一推導;右前/左前/右後/左後一一對應、上下成對):
    // 前對:右 = 25mm 空爆機砲、左 = 諧振器 orb;後對:各托一枚攔截彈。
    // 末端掛「世界對齊樞軸」(models.js 同款單一保證縫):槍口恆朝機體正前,蠕動波不歪槍口。
    const mkTent = (sx, front, def) => {
      // 抬升角住根部 wrapper(chainF 的 rot0 是逐關節相對角 —— 塞大角 = 整條捲死結);
      // 'YXZ' = 先仰(x)再轉到腿方位(y):初始指向「方位 × 仰角」,curl(+x)續在同一鉛直方位面內
      const at = this._tentAt(c, sx, front);
      const root = new THREE.Group();
      root.position.set(...at.p);
      root.rotation.order = 'YXZ';
      root.rotation.set(def.pitch, at.yaw, sx * -def.roll);
      F.chest.add(root);
      const { segs, tip } = chainF(root, {
        n: 6, len0: 0.7, len1: 0.36, r0: 0.16, r1: 0.055,
        rot0: def.rot0, rotD: def.rotD, ring: true, ringColor: IRON, seg: 8,
        drawSeg: (t, i, { r, len }) => {
          // 腹面吸盤列(內彎面;i=0 靠根不放,梢節太細不放)—— 一盤一零件
          if (i < 1 || i > 4) return;
          const pad = cylF(t, r * 0.28, r * 0.24, 0.035, 6, 0, r * 0.9, -len * 0.45, PAL.lite, { metalness: 0.3 });
          pad.userData.noOutline = true;
        },
      }, PAL.dark, { metalness: 0.55 });
      const tipP = new THREE.Group();
      tipP.position.set(0, 0, -0.4);
      tip.add(tipP);
      F.g.updateMatrixWorld(true);
      tipP.quaternion.copy(tip.getWorldQuaternion(new THREE.Quaternion()).invert());
      return { segs, tip, tipP };
    };
    // 彎度平均分到每一關節(累積 ≈ 0.6π:向外上弧起、頂端回捲但不過頂下扎 —— 過捲會讓
    // 梢節垂到臉前);roll 把捲曲面往外傾(★ 圖的側向迴圈外倒,梢端收在外上角不擠向中線)
    const front = { pitch: 0.95, roll: 0.75, rot0: 0.26, rotD: 0.03 };
    const rear = { pitch: 0.9, roll: 0.75, rot0: 0.24, rotD: 0.028 };
    const tGun = mkTent(1, true, front), tOrb = mkTent(-1, true, front);
    const tPodL = mkTent(-1, false, rear), tPodR = mkTent(1, false, rear);
    // 25mm 空爆機砲(右上觸手梢):tboxF 機匣 + latheF 階狀砲身 + 側彈鼓 + 砲口充能環
    const gp = tGun.tipP;
    tboxF(gp, { w0: 0.2, d0: 0.44, w1: 0.17, d1: 0.36, h: 0.2 }, 0, 0, 0, GUNMETAL, { metalness: 0.75 });
    const brl = latheF(gp, [[0.052, -0.05], [0.052, 0.3], [0.04, 0.33], [0.04, 0.72]], 10, 0, 0, 0.2, COAL, { metalness: 0.85 });
    brl.rotation.x = Math.PI / 2;
    const drum = cylF(gp, 0.09, 0.09, 0.12, 10, 0.16, -0.04, 0.02, IRON, { metalness: 0.7 });
    drum.rotation.z = Math.PI / 2;
    const lMuz = latheF(gp, [[0.045, -0.025], [0.065, -0.01], [0.065, 0.01], [0.045, 0.025]], 8, 0, 0, 0.95, accent, { emissive: accent, emissiveIntensity: 1.2 });
    lMuz.rotation.x = Math.PI / 2;
    // 諧振器(左上觸手梢):latheF 托座 + 諧振球 + 斜交 torusF 環 ×2
    const op = tOrb.tipP;
    const cup = latheF(op, [[0.05, 0], [0.16, 0.06], [0.2, 0.17]], 10, 0, 0, 0.12, GUNMETAL, { metalness: 0.75 });
    cup.rotation.x = Math.PI / 2;
    const orb = sphF(op, 0.17, 0, 0, 0.36, accent, { emissive: accent, emissiveIntensity: 1.5 });
    for (const ry of [-0.7, 0.7]) {
      const ring = torusF(op, 0.23, 0.018, 0, 0, 0.36, PAL.lite, { metalness: 0.6 });
      ring.rotation.y = ry;
      ring.userData.noOutline = true;
    }
    // 攔截彈 ×2(下對觸手各托一枚;★ 圖的白灰飛彈):托架 + latheF 彈體 + coneF 彈頭 + finF 尾翼 ×4
    const mkPod = (tipP) => {
      tboxF(tipP, { w0: 0.14, d0: 0.55, w1: 0.18, d1: 0.65, h: 0.1 }, 0, -0.14, 0, GUNMETAL, { metalness: 0.7 });
      const rk = new THREE.Group();
      rk.rotation.x = -0.08;
      tipP.add(rk);
      const bd = latheF(rk, [[0.07, -0.55], [0.075, -0.3], [0.075, 0.42], [0.06, 0.5]], 10, 0, 0, 0, STEEL2, { metalness: 0.6 });
      bd.rotation.x = Math.PI / 2;
      const nose = coneF(rk, 0.062, 0.3, 10, 0, 0, 0.64, STEEL2, { metalness: 0.6 });
      nose.rotation.x = Math.PI / 2;
      for (let k = 0; k < 4; k++) {
        const fn = finF(rk, { len: 0.2, w0: 0.03, w1: 0.018, t: 0.16, sweep: -0.06 }, 0, 0, -0.44, STEEL2, { metalness: 0.7 });
        fn.rotation.z = Math.PI / 4 + k * Math.PI / 2;
      }
    };
    mkPod(tPodL.tipP);
    mkPod(tPodR.tipP);
    c._tents = [tGun.segs, tOrb.segs, tPodL.segs, tPodR.segs];
    return {
      gunR: null, gunL: null,
      muzzles: { light: { n: lMuz, r: 0.06 }, heavy: { n: orb, r: 0.14 } },
      lightGlowM: [lMuz], heavyGlowM: [orb],
      heavyPivot: [{
        obj: op,
        rest: { x: op.rotation.x, y: op.rotation.y, z: op.rotation.z },
        deploy: { x: op.rotation.x - 0.3, y: op.rotation.y, z: op.rotation.z },
      }],
      weap: { light: 'N', heavy: 'N' },
      hvy: { chest: 0.04 },
      aimPose: null,
      wpn: { light: { nodes: [gp], ref: gp, muz: lMuz, fwd: 'z' }, heavy: { nodes: [op], ref: op, muz: orb, fwd: 'z' } },
    };
  },
  extra(c, F, rig) {
    // 持武觸手進 tentGuard(蓄勢 S 形 + 節節延遲蠕動):chain 條目 {g, base, k, d};
    // 梢節 k 收小 —— 武器要穩得住(models.js 同語意)
    rig.tents = c._tents.map((segs) => segs.map((t, i) => ({
      g: t, base: t.rotation.x, k: i === segs.length - 1 ? 0.1 : 0.26, d: i * 0.55,
    })));
  },
};
