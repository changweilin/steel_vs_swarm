// ============ t04 逐機零件檔(dev-only;仿生四足 D.kind 'quad')============
// ── t04「灰犬」獵殺型(hound 機械獵犬):低伏獵姿、背揹長管反器材砲、迴旋襲步 ──
// 2D 定案圖:public/assets/cyberpunk_art/mechs/t04_{static,moving,heavy}.png(★ = t04_moving)
// 幾何語彙一律取自 ../geo.js;MUST NOT 在本檔自建 BufferGeometry。
// 2026-08-12 多面體改寫(照 ★ 圖逐部位):
//   頭 = 楔台顱殼+怒眉稜+收分吻部+齒列+紅光眼帶+finF 雙層耳鰭;
//   軀幹 = 深胸楔台+肩胛甲+肋側甲、中段脊關節(latheF 波紋護套+側軸盤 —— mecha.js gen.note:
//   「脊椎中段那一節 MUST 畫成真的關節」)、後軀收分殼+穿孔消音筒;
//   四腿 = 大圓盤髖關節(一字螺槽蓋)+hydCyl 避震(後腿橘芯)+三趾足爪;
//   武裝 = 一管雙模反器材砲(輕 = 整體式消音 DMR 段、重 = 箱形制退器段;同 models.js hound)。
import * as THREE from 'three';
import {
  matF, dimF, bxF, cylF, sphF, coneF, torusF, tboxF, prismF, latheF, finF, fanF, chainF, cablesF,
  hydCyl, sinew, seg2, IRON, GUNMETAL, COAL, INK, BONE, BRASS,
} from '../geo.js';

// 本機專用色:2D 數位迷彩的橄欖灰綠 / 感測眼帶紅光 / 後腿避震橘色外露桿
const OLIVE = 0x57614b, RED = 0xff2f2f, ORANGE = 0xd8862a;

export default {
  label: '灰犬(t04 機甲・獵犬)', hue: 0x8a97a5, kind: 'quad', height: 4.6,
  frame: {
    hipY: 2.0, legX: 0.78, fz: 1.05, hz: -1.25,
    chest: [0, 0.1, 0.55], neck: [0, 0.28, 0.85], head: [0, 0.18, 0.5],
    tailY: 0.12, tailZ: -1.3, tail2Z: 0.75,
  },
  gait: { gait: 'trot', gallopType: 'rotary', stride: 2.6, top: 7, bob: 0.1, pitchAmp: 0.1 },
  moveSig: { poise: 0.68, idleF: 1.65, idleA: 0.58, launch: 0.92, spool: 0.10, brake: 0.98, settle: 0.45 },
  castSig: { omni: 'roar', dir: 'jab' },
  doc: [
    ['頭(獵犬頭顱)', '楔台顱殼+prismF 怒眉稜+收分吻部(梢端下垂)+下顎;齒列 coneF ×3/側;紅光感測眼帶 ×3 段;耳鰭 = finF 雙層 ×2;鞭天線(noOutline)'],
    ['頸(柔性護套)', 'latheF 波紋頸筒+頸根關節環+cablesF 喉側管束 ×3'],
    ['軀幹(深胸+中脊關節)', '前胸楔台+龍骨+prismF 前甲板/肩胛甲;肋側甲 ×3/側;中段脊關節 = latheF 波紋護套+側軸盤(accent 蓋+一字槽)+腹下纜束;後軀收分殼+「04」臀側板+散熱百葉'],
    ['排氣消音筒(右後)', 'cylF 筒身+INK 散熱孔列 ×6+torusF 端環+cablesF 雙導管(★ 圖右後方穿孔圓筒)'],
    ['四腿(Z 形獸腿)', '楔台股殼+latheF 髖圓盤關節(accent 蓋燈+一字螺槽)+管骨+hydCyl 避震(後腿橘芯)+蹠節+三趾足爪;後股外掛 prismF 圓角臀甲'],
    ['尾(配重舵)', '楔台尾基+節環+finF 舵鰭(後掠下垂)'],
    ['武裝(背揹長管反器材砲)', '砲架前支柱+緩衝滑軌(hydCyl ×2 沿後座軸)+機匣+斜插彈匣+骨架托+M-LOK 護木+latheF 砲管+整體式消音套筒(輕)+箱形制退器(重)+觀瞄鏡組'],
  ],
  body(c, spine, chest) {
    const { PAL, accent } = c;
    // ── 後軀(掛 spine):往尾端收分的主殼(轉軸後楔台頂面朝後 ⇒ 尾端斷面縮小、微上揚)──
    const rear = tboxF(spine, { w0: 0.98, d0: 0.95, w1: 0.72, d1: 0.64, h: 1.5, sz: 0.10 }, 0, 0.05, -0.72, PAL.main, { metalness: 0.5 });
    rear.rotation.x = -Math.PI / 2;
    // 背脊板(頂面薄板)
    tboxF(spine, { w0: 0.8, d0: 1.2, w1: 0.6, d1: 0.9, h: 0.1 }, 0, 0.56, -0.66, dimF(PAL.lite, 0.92), { metalness: 0.55 });
    // 「04」臀側板(prismF 圓角六角;識別數字歸 paint 層)
    for (const sx of [-1, 1]) {
      const p = prismF(spine, [[-0.28, -0.2], [0.05, -0.3], [0.3, -0.12], [0.3, 0.14], [0.02, 0.26], [-0.26, 0.16]], 0.06, sx * 0.5, 0.12, -0.95, OLIVE, { metalness: 0.45 });
      p.rotation.y = sx * Math.PI / 2;
    }
    // 後臀散熱百葉(斜臥排氣片列)
    for (const sx of [-1, 1]) for (const xx of [0.2, 0.36]) {
      const lv = bxF(spine, 0.05, 0.05, 0.36, sx * xx, 0.5, -1.32, PAL.deep, { metalness: 0.7 });
      lv.rotation.x = -0.3;
    }
    // 排氣消音筒(★ 圖右後方穿孔圓筒):筒身 + 散熱孔列 + 端環 + 供氣導管
    const muf = cylF(spine, 0.105, 0.105, 0.8, 10, 0.42, 0.5, -1.05, GUNMETAL, { metalness: 0.75 });
    muf.rotation.x = Math.PI / 2;
    torusF(spine, 0.105, 0.02, 0.42, 0.5, -1.46, IRON, { metalness: 0.8 });
    const mcap = cylF(spine, 0.075, 0.075, 0.03, 8, 0.42, 0.5, -1.47, INK, { metalness: 0.3 });
    mcap.rotation.x = Math.PI / 2;
    for (let i = 0; i < 6; i++)                                 // 孔列:兩排 ×3(索引遞變,零亂數)
      bxF(spine, 0.025, 0.05, 0.08, 0.42 + (i < 3 ? -1 : 1) * 0.09, 0.545, -0.8 - (i % 3) * 0.2, INK);
    cablesF(spine, { p0: [0.3, 0.3, -0.3], p1: [0.42, 0.46, -0.68], k: 2, r: 0.03, sag: 0.03, spread: 0.03 }, COAL, { metalness: 0.7 });
    // 尾根關節環 + 尾部航行燈
    const tr = latheF(spine, [[0.10, -0.05], [0.145, -0.02], [0.145, 0.02], [0.10, 0.05]], 10, 0, 0.12, -1.28, IRON, { metalness: 0.8 });
    tr.rotation.x = Math.PI / 2;
    for (const sx of [-1, 1])
      bxF(spine, 0.05, 0.05, 0.03, sx * 0.34, 0.3, -1.45, accent, { emissive: accent, emissiveIntensity: 0.8 });
    // ── 中段脊關節(mecha.js gen.note:真的關節 = 軸 + 護套)──
    const boot = latheF(spine, [[0.30, -0.13], [0.26, -0.065], [0.31, 0], [0.26, 0.065], [0.30, 0.13]], 12, 0, 0.10, 0.16, GUNMETAL, { metalness: 0.6 });
    boot.rotation.x = Math.PI / 2;
    for (const sx of [-1, 1]) {
      const ax = latheF(spine, [[0.03, -0.05], [0.13, -0.04], [0.15, 0], [0.13, 0.04], [0.03, 0.05]], 10, sx * 0.34, 0.10, 0.16, PAL.deep, { metalness: 0.85 });
      ax.rotation.z = Math.PI / 2;
      const cap = cylF(spine, 0.05, 0.05, 0.03, 8, sx * 0.40, 0.10, 0.16, accent, { emissive: accent, emissiveIntensity: 0.6 });
      cap.rotation.z = Math.PI / 2;
      bxF(spine, 0.02, 0.025, 0.08, sx * 0.42, 0.10, 0.16, INK);   // 一字螺槽
    }
    cablesF(spine, { p0: [0, -0.32, 0.5], p1: [0, -0.28, -0.35], k: 4, r: 0.026, sag: 0.09, spread: 0.08 }, COAL, { metalness: 0.5 });
    // ── 前胸(掛 chest):深胸獵犬剪影(主殼後移讓出脊關節縫)──
    tboxF(chest, { w0: 1.06, d0: 1.1, w1: 0.88, d1: 0.9, h: 1.05, sz: 0.06 }, 0, 0.02, 0.3, PAL.mid, { metalness: 0.55 });
    // 胸下龍骨(底窄頂寬 = 深胸 V 形)
    tboxF(chest, { w0: 0.6, d0: 0.8, w1: 0.94, d1: 1.0, h: 0.45 }, 0, -0.68, 0.32, PAL.deep, { metalness: 0.6 });
    // 前甲板(prismF 角面)+ 胸前識別燈
    prismF(chest, [[-0.42, -0.3], [0.42, -0.3], [0.5, 0.05], [0.3, 0.35], [-0.3, 0.35], [-0.5, 0.05]], 0.07, 0, 0.08, 0.86, PAL.lite, { metalness: 0.55 });
    bxF(chest, 0.5, 0.07, 0.04, 0, 0.42, 0.87, accent, { emissive: accent, emissiveIntensity: 0.9 });
    // 肩胛甲 ×2(prismF 五角板,頂緣前傾外張;「T04」標記歸 paint 層)
    for (const sx of [-1, 1]) {
      const sp = prismF(chest, [[-0.35, -0.28], [0.15, -0.36], [0.42, -0.05], [0.28, 0.3], [-0.3, 0.3]], 0.07, sx * 0.58, 0.32, 0.38, OLIVE, { metalness: 0.5 });
      sp.rotation.y = sx * Math.PI / 2;
      sp.rotation.x = -0.12;
    }
    // 肋側甲 ×3/側(楔台窄板,索引遞變)
    for (const sx of [-1, 1]) for (let i = 0; i < 3; i++)
      tboxF(chest, { w0: 0.05, d0: 0.28 - i * 0.02, w1: 0.05, d1: 0.2 - i * 0.02, h: 0.4 }, sx * 0.55, -0.22, 0.5 - i * 0.28, PAL.main, { metalness: 0.6 });
    // 鞭天線(左肩後;髮絲件不描邊)+ 基座
    bxF(chest, 0.06, 0.08, 0.06, -0.34, 0.52, -0.1, COAL, { metalness: 0.8 });
    const ant = cylF(chest, 0.012, 0.012, 0.9, 5, -0.34, 0.92, -0.32, COAL, { metalness: 0.6 });
    ant.rotation.x = -0.5;
    ant.userData.noOutline = true;
  },
  neckHead(c, neck, head) {
    const { PAL, accent } = c;
    // 波紋頸筒(latheF 柔性護套)+ 頸根關節環 + 喉側管束
    const nk = latheF(neck, [[0.20, -0.30], [0.255, -0.18], [0.215, -0.06], [0.26, 0.06], [0.22, 0.18], [0.265, 0.30], [0.20, 0.40]], 10, 0, 0.02, 0.16, GUNMETAL, { metalness: 0.6 });
    nk.rotation.x = 1.05;
    const nr = latheF(neck, [[0.24, -0.05], [0.29, -0.01], [0.29, 0.03], [0.24, 0.07]], 10, 0, -0.08, -0.02, IRON, { metalness: 0.8 });
    nr.rotation.x = 1.05;
    cablesF(neck, { p0: [0, -0.15, 0.05], p1: [0, 0.0, 0.45], k: 3, r: 0.022, sag: 0.05, spread: 0.05 }, COAL, { metalness: 0.5 });
    // ── 頭(head 局部 +z 前)──
    // 楔台顱殼(頂窄前斜)+ 怒眉稜(prismF 中央下壓 V 帶)
    tboxF(head, { w0: 0.52, d0: 0.6, w1: 0.36, d1: 0.42, h: 0.36, sz: 0.06 }, 0, 0.10, 0.0, PAL.main, { metalness: 0.5 });
    prismF(head, [[-0.24, 0.0], [0, -0.03], [0.24, 0.0], [0.24, 0.07], [0, 0.035], [-0.24, 0.07]], 0.06, 0, 0.245, 0.27, PAL.deep, { metalness: 0.55 });
    // 收分吻部(梢端下垂)+ 下顎(微張)
    const muzz = tboxF(head, { w0: 0.30, d0: 0.22, w1: 0.20, d1: 0.14, h: 0.55, sz: 0.05 }, 0, 0.0, 0.42, PAL.mid, { metalness: 0.55 });
    muzz.rotation.x = Math.PI / 2;
    const jaw = tboxF(head, { w0: 0.24, d0: 0.10, w1: 0.17, d1: 0.08, h: 0.42 }, 0, -0.17, 0.35, PAL.deep, { metalness: 0.55 });
    jaw.rotation.x = Math.PI / 2 + 0.12;
    // 齒列(coneF ×3/側,尖朝下;索引遞變)
    for (const sx of [-1, 1]) for (let i = 0; i < 3; i++) {
      const th = coneF(head, 0.022, 0.07 - i * 0.008, 4, sx * (0.105 - i * 0.012), -0.115, 0.32 + i * 0.13, BONE, { metalness: 0.3 });
      th.rotation.x = Math.PI;
    }
    // 紅光感測眼帶(中央 + 兩側斜段;★ 圖環繞式紅色目視帶)
    bxF(head, 0.30, 0.055, 0.03, 0, 0.15, 0.315, RED, { emissive: RED, emissiveIntensity: 1.8 });
    for (const sx of [-1, 1]) {
      const e = bxF(head, 0.14, 0.05, 0.03, sx * 0.2, 0.15, 0.27, RED, { emissive: RED, emissiveIntensity: 1.8 });
      e.rotation.y = sx * 0.7;
      // 頰甲(prismF 小角板)
      const ck = prismF(head, [[-0.10, -0.08], [0.10, -0.12], [0.14, 0.04], [-0.06, 0.10]], 0.05, sx * 0.25, -0.02, 0.16, PAL.mid, { metalness: 0.6 });
      ck.rotation.y = sx * Math.PI / 2;
      // 耳鰭:finF 雙層 ×2(外層主色刃 + 內層墨色芯;後掠外張,★ 圖是大面刃耳)
      const eo = finF(head, { len: 0.64, w0: 0.21, w1: 0.04, t: 0.055, sweep: 0.16 }, sx * 0.17, 0.24, -0.06, PAL.mid, { metalness: 0.55 });
      eo.rotation.z = -sx * 0.42;
      eo.rotation.x = -0.55;
      const ei = finF(head, { len: 0.44, w0: 0.12, w1: 0.024, t: 0.032, sweep: 0.12 }, sx * 0.17, 0.24, -0.02, INK, { metalness: 0.4 });
      ei.rotation.z = -sx * 0.38;
      ei.rotation.x = -0.5;
    }
  },
  // 前肢:肘朝後折(S=+1);後肢:跗朝前折(S=−1)—— 符號同 models.js mkLeg。
  // 兩鏈共用 _leg(forge 以方法呼叫 legF/legH ⇒ this 可用):楔台股殼 + 大圓盤髖關節
  // (★ 圖招牌:一字螺槽蓋燈)+ 管骨 + hydCyl 避震(後腿橘芯)+ 蹠節 + 三趾足爪。
  _leg(c, front) {
    const { PAL, accent, sx } = c;
    return [
      { len: front ? 0.9 : 0.86, draw: (l) => {
        tboxF(l, { w0: 0.36, d0: front ? 0.5 : 0.56, w1: 0.24, d1: 0.32, h: front ? 0.95 : 0.9 }, 0, -0.42, front ? 0.03 : -0.05, PAL.main, { metalness: 0.5 });
        // 髖致動器圓盤(latheF 側向)+ accent 蓋燈 + 一字螺槽
        const hub = latheF(l, [[0.04, -0.075], [0.20, -0.06], [0.235, 0], [0.20, 0.06], [0.04, 0.075]], 12, sx * 0.24, -0.05, 0, PAL.deep, { metalness: 0.85 });
        hub.rotation.z = Math.PI / 2;
        const cap = cylF(l, 0.085, 0.085, 0.035, 10, sx * 0.33, -0.05, 0, accent, { emissive: accent, emissiveIntensity: 0.7 });
        cap.rotation.z = Math.PI / 2;
        bxF(l, 0.02, 0.03, 0.13, sx * 0.35, -0.05, 0, INK);
        hydCyl(l, 0.03, 0.42, -sx * 0.1, -0.55, front ? -0.17 : 0.17, front ? -0.3 : 0.3, front ? null : ORANGE);
        if (!front) {   // 後股外掛圓角臀甲(★ 圖大面圓弧迷彩板)
          const hp = prismF(l, [[-0.35, -0.4], [0.12, -0.48], [0.39, -0.21], [0.44, 0.12], [0.18, 0.35], [-0.25, 0.3]], 0.06, sx * 0.27, -0.36, -0.05, OLIVE, { metalness: 0.45 });
          hp.rotation.y = sx * Math.PI / 2;
        }
      } },
      { len: front ? 0.76 : 0.8, base: front ? 0.34 : -0.34, k: front ? 0.5 : -0.5, d: 0.15, draw: (l) => {
        tboxF(l, { w0: 0.17, d0: 0.24, w1: 0.13, d1: 0.17, h: front ? 0.8 : 0.84 }, 0, -0.39, 0, PAL.mid, { metalness: 0.6 });
        const kn = latheF(l, [[0.03, -0.05], [0.13, -0.04], [0.15, 0], [0.13, 0.04], [0.03, 0.05]], 10, sx * 0.14, -0.02, 0, COAL, { metalness: 0.85 });
        kn.rotation.z = Math.PI / 2;
        hydCyl(l, 0.026, 0.4, sx * 0.05, -0.35, front ? -0.15 : 0.15, front ? -0.35 : 0.35, front ? null : ORANGE);
      } },
      { len: front ? 0.24 : 0.26, base: front ? -0.2 : 0.2, k: front ? -0.3 : 0.3, d: 0.45, draw: (l) => {
        cylF(l, 0.09, 0.11, front ? 0.26 : 0.28, 8, 0, -0.12, 0, PAL.deep, { metalness: 0.6 });
        const rg = torusF(l, 0.105, 0.018, 0, -0.02, 0, IRON, { metalness: 0.8 });
        rg.rotation.x = Math.PI / 2;
      } },
      { len: 0, base: 0, k: front ? 0.2 : -0.2, d: 0.66, draw: (l) => {
        tboxF(l, { w0: 0.26, d0: 0.3, w1: 0.2, d1: 0.22, h: 0.14, sz: 0.05 }, 0, -0.06, 0.05, COAL, { metalness: 0.6 });
        for (const ox of [-0.085, 0, 0.085]) {   // 三趾(楔台收分、梢端下勾)
          const toe = tboxF(l, { w0: 0.07, d0: 0.08, w1: 0.045, d1: 0.05, h: 0.2, sz: 0.05 }, ox, -0.1, 0.24, GUNMETAL, { metalness: 0.6 });
          toe.rotation.x = Math.PI / 2 + 0.15;
        }
        tboxF(l, { w0: 0.09, d0: 0.09, w1: 0.06, d1: 0.06, h: 0.1 }, 0, -0.09, -0.14, GUNMETAL, { metalness: 0.6 });   // 後踞
      } },
    ];
  },
  legF(c) { return this._leg(c, true); },
  legH(c) { return this._leg(c, false); },
  tail(c, tail, tail2) {
    const { PAL, accent } = c;
    // 尾基楔台(尾端收分)+ 節環
    const t1 = tboxF(tail, { w0: 0.2, d0: 0.24, w1: 0.13, d1: 0.15, h: 0.72 }, 0, 0.02, -0.34, PAL.deep, { metalness: 0.6 });
    t1.rotation.x = -Math.PI / 2 + 0.12;
    const ring = latheF(tail, [[0.09, -0.04], [0.12, -0.01], [0.12, 0.02], [0.09, 0.05]], 8, 0, 0.02, -0.7, IRON, { metalness: 0.8 });
    ring.rotation.x = Math.PI / 2;
    // 配重舵鰭(finF 後掠、微下垂)+ 梢端識別燈
    const fin = finF(tail2, { len: 0.72, w0: 0.18, w1: 0.05, t: 0.045, sweep: 0.12 }, 0, 0.0, -0.04, COAL, { metalness: 0.6 });
    fin.rotation.x = -Math.PI / 2 - 0.15;
    bxF(tail2, 0.05, 0.04, 0.04, 0, -0.12, -0.72, accent, { emissive: accent, emissiveIntensity: 0.8 });
  },
  mount(c, F) {
    const { PAL, accent, K, H } = c;
    // ── 砲架(掛 chest):背部基座 + 前支柱 + 後支座(★ 圖 A 形吊架,砲高架於背)──
    tboxF(F.chest, { w0: 0.34, d0: 0.95, w1: 0.28, d1: 0.8, h: 0.22 }, 0.2, 0.64, 0.0, PAL.deep, { metalness: 0.7 });
    const pyl = prismF(F.chest, [[-0.18, -0.15], [0.18, -0.15], [0.10, 0.13], [-0.10, 0.13]], 0.08, 0.2, 0.9, 0.32, IRON, { metalness: 0.8 });
    pyl.rotation.y = Math.PI / 2;
    tboxF(F.chest, { w0: 0.12, d0: 0.28, w1: 0.1, d1: 0.2, h: 0.26 }, 0.2, 0.88, -0.42, IRON, { metalness: 0.8 });
    // ── 背揹長管反器材砲(gunPitch 俯仰;砲身沿 +y、rotation.x ≈ π/2 前指)──
    const gun = new THREE.Group();
    gun.position.set(0.2, 1.12, -0.15);
    gun.rotation.set(1.42, 0, 0);
    F.chest.add(gun);
    const GL = 0.62 * H * K.barrelF;
    // 緩衝滑軌(bxF 導軌 + hydCyl ×2 沿後座軸 = 局部 y)
    bxF(gun, 0.08, GL * 0.42, 0.05, 0, -GL * 0.02, 0.15, IRON, { metalness: 0.8 });
    for (const sx of [-1, 1]) hydCyl(gun, 0.028, GL * 0.2, sx * 0.075, GL * 0.1, 0.14, 0);
    // 機匣 + 拋殼口 + 握把
    tboxF(gun, { w0: 0.18, d0: 0.30, w1: 0.15, d1: 0.26, h: GL * 0.32 }, 0, 0, 0, GUNMETAL, { metalness: 0.75 });
    bxF(gun, 0.02, 0.14, 0.08, 0.095, GL * 0.04, -0.02, INK);
    const grip = bxF(gun, 0.05, 0.16, 0.09, 0, -GL * 0.1, 0.2, COAL, { metalness: 0.6 });
    grip.rotation.x = 0.5;
    // 斜插彈匣(楔台,底板收分)
    const mag = tboxF(gun, { w0: 0.14, d0: 0.34, w1: 0.11, d1: 0.28, h: 0.34 }, 0, -GL * 0.01, 0.3, COAL, { metalness: 0.6 });
    mag.rotation.x = Math.PI / 2 - 0.3;
    // 骨架托(上桁 + 下斜桁 + 托底板 + 頰貼)
    bxF(gun, 0.055, GL * 0.22, 0.06, 0, -GL * 0.27, -0.02, GUNMETAL, { metalness: 0.7 });
    const lb = bxF(gun, 0.05, GL * 0.24, 0.05, 0, -GL * 0.26, 0.14, GUNMETAL, { metalness: 0.7 });
    lb.rotation.x = -0.35;
    tboxF(gun, { w0: 0.07, d0: 0.3, w1: 0.06, d1: 0.24, h: 0.09 }, 0, -GL * 0.38, 0.06, COAL, { metalness: 0.6 });
    bxF(gun, 0.06, GL * 0.12, 0.045, 0, -GL * 0.3, -0.07, OLIVE, { metalness: 0.4 });
    // M-LOK 護木(楔台 + 側槽 ×4 + 頂軌)
    tboxF(gun, { w0: 0.15, d0: 0.2, w1: 0.13, d1: 0.17, h: GL * 0.3 }, 0, GL * 0.31, 0.0, OLIVE, { metalness: 0.5 });
    for (const sx of [-1, 1]) for (let i = 0; i < 2; i++)
      bxF(gun, 0.015, GL * 0.1, 0.05, sx * 0.074, GL * (0.24 + i * 0.14), 0, INK);
    bxF(gun, 0.07, GL * 0.3, 0.03, 0, GL * 0.31, -0.11, GUNMETAL, { metalness: 0.8 });
    // 砲管(latheF 收分)+ 瓦斯塊
    latheF(gun, [[0.065, GL * 0.44], [0.06, GL * 0.52], [0.045, GL * 0.56], [0.042, GL * 0.9], [0.05, GL * 0.92]], 10, 0, 0, 0, COAL, { metalness: 0.85 });
    bxF(gun, 0.05, 0.07, 0.06, 0, GL * 0.55, -0.06, COAL, { metalness: 0.8 });
    // 整體式消音套筒(輕 = 消音 DMR 段;VSS 語彙)+ 消音段口識別環
    latheF(gun, [[0.062, -GL * 0.09], [0.08, -GL * 0.07], [0.08, GL * 0.07], [0.062, GL * 0.09]], 10, 0, GL * 0.62, 0, GUNMETAL, { metalness: 0.7 });
    const lMuz = latheF(gun, [[0.05, -0.028], [0.076, -0.012], [0.076, 0.012], [0.05, 0.028]], 10, 0, GL * 0.72, 0, accent, { emissive: accent, emissiveIntensity: 1.0 });
    // 箱形制退器(重 = 反器材段):楔台 + 側洩槽 ×4 + 前面膛口 + 重膛口環
    tboxF(gun, { w0: 0.14, d0: 0.17, w1: 0.12, d1: 0.15, h: GL * 0.1 }, 0, GL * 0.96, 0, GUNMETAL, { metalness: 0.8 });
    for (const sx of [-1, 1]) for (let i = 0; i < 2; i++)
      bxF(gun, 0.02, GL * 0.03, 0.12, sx * 0.073, GL * (0.938 + i * 0.045), 0, INK);
    const bf = cylF(gun, 0.055, 0.055, 0.03, 8, 0, GL * 1.012, 0, INK, { metalness: 0.3 });
    const hMuz = latheF(gun, [[0.05, -0.02], [0.07, -0.008], [0.07, 0.008], [0.05, 0.02]], 8, 0, GL * 1.03, 0, accent, { emissive: accent, emissiveIntensity: 0.8 });
    // 觀瞄鏡組(頂軌 + 雙環座 + 鏡筒 + 物鏡/目鏡喇叭 + 物鏡面;★ 圖大型狙擊鏡)
    bxF(gun, 0.06, GL * 0.24, 0.03, 0, -GL * 0.02, -0.16, COAL, { metalness: 0.8 });
    for (const oy of [-GL * 0.06, GL * 0.06]) cylF(gun, 0.062, 0.062, 0.035, 8, 0, -GL * 0.02 + oy, -0.24, GUNMETAL, { metalness: 0.8 });
    cylF(gun, 0.052, 0.052, GL * 0.24, 10, 0, -GL * 0.02, -0.24, COAL, { metalness: 0.7 });
    latheF(gun, [[0.055, -0.03], [0.082, 0.0], [0.082, 0.1], [0.072, 0.12]], 10, 0, GL * 0.11, -0.24, COAL, { metalness: 0.7 });
    latheF(gun, [[0.062, -0.11], [0.072, -0.09], [0.072, -0.01], [0.055, 0.02]], 10, 0, -GL * 0.145, -0.24, COAL, { metalness: 0.7 });
    cylF(gun, 0.064, 0.064, 0.015, 10, 0, GL * 0.155, -0.24, accent, { emissive: accent, emissiveIntensity: 0.4 });
    return {
      gunR: { g: gun, rest: 1.42, aim: 1.57 }, gunL: null,
      muzzles: { light: { n: lMuz, r: 0.08 }, heavy: { n: hMuz, r: 0.11 } },
      lightGlowM: [lMuz], heavyGlowM: [hMuz], heavyPivot: [],
      weap: { light: 'N', heavy: 'N' },
      hvy: { chest: 0.05 },
      aimPose: null,
      wpn: { light: { nodes: [gun], ref: gun, muz: lMuz, fwd: 'y' }, heavy: { nodes: [gun], ref: gun, muz: hMuz, fwd: 'y' } },
    };
  },
};
