// ============ t03 逐機零件檔(dev-only;獸型雙足 biped + knuckle 掌行)============
// ── t03「爐膛」突擊機甲(gorilla 大猩猩):掌行長臂、右肩三管霰彈/左肩噴口、左前臂鍋盾 ──
// 2D 定案圖:public/assets/cyberpunk_art/mechs/t03_{static,moving,heavy}.png(★ = t03_static)
// 幾何語彙一律取自 ../geo.js;MUST NOT 在本檔自建 BufferGeometry。
// 2026-08-12 多面體改寫(照 ★ 圖逐部位拼裝):
//   頭 = 多面猩顱盔(tboxF 收分 + prismF 矢狀嵴/怒眉)+ 灰臉板吻甲(prismF 八角 + tboxF 圓吻);
//   胸 = 桶胸楔台 + prismF 雙胸甲 + 胸骨發光縫 + 菱形爐核 + 腹部三段爐柵;
//   背 = 隆背駝峰 + 打孔煙囪(★ 圖左上招牌)+ torusF 背管弧 + 液壓泵背包;
//   臂 = 巨肩甲 + 液壓破碎缸;左前臂鑄鐵鍋盾(黑灰異色 + 綁帶 + 焊點 = 後加感)、
//   右前臂照 ★ 圖走裸機構(活塞 + 齒輪盤 + 纜管);左手巨拳 / 右手長爪(★ 圖不對稱);
//   武裝 = 右肩三管霰彈(打孔散熱護套 + 同軸彈鼓)+ 左肩電漿噴口(喇叭 + 燃料罐 + 輸送管)。
// 色階:主殼 PAL.mid(工業橘的正確深度;PAL.main 全上會 washed-out)、次板 PAL.main、
//        亮緣 PAL.lite、關節 PAL.deep;鑄鐵鍋刻意跳出色系(POT 黑灰)。
import * as THREE from 'three';
import {
  matF, dimF, bxF, cylF, sphF, coneF, torusF, tboxF, prismF, latheF, finF, fanF, chainF, cablesF,
  hydCyl, sinew, seg2, IRON, GUNMETAL, COAL, INK, BONE, BRASS,
} from '../geo.js';

// 本機專用色:鑄鐵鍋(與全機塗裝刻意不同調 = 後加的)/ 灰臉板 / 亮活塞桿
const POT = 0x2b3138, POTRIM = 0x3a4048, FACE = 0x565b60, ROD = 0xd8dde2;

export default {
  label: '爐膛(t03 機甲・大猩猩)', hue: 0xe08a4a, height: 6.0,
  prop: { hips: 0.40, legSplay: 0.11, thigh: 0.42, shin: 0.40, shoulderY: 0.78, shoulderX: 0.21, upperArm: 0.3, foreArm: 0.32, head: 0.84, girth: 1.15 },
  gait: { strideF: 1.1, bob: 0.12, sway: 0.1, top: 7, legBase: -0.08, armBase: 0.14 },
  knuckle: true,                                                 // 掌行:前肢是前腳(rig.knuckle)
  moveSig: { poise: 0.25, idleF: 0.78, idleA: 1.50, launch: 0.60, spool: 0.52, brake: 0.52, settle: 0.60 },
  castSig: { omni: 'beat', dir: 'swing' },
  doc: [
    ['頭(低伏猩顱)', 'tboxF 多面盔+prismF 矢狀嵴/怒眉稜+prismF 灰臉板+tboxF 圓吻顎+latheF 圓盤耳'],
    ['軀幹(桶胸+爐膛)', 'tboxF 桶胸+prismF 雙胸甲+胸骨發光縫+prismF 菱形爐核+腹部三段爐柵疊板'],
    ['背(隆背+煙囪)', 'tboxF 駝峰+latheF 打孔煙囪(INK 孔珠)+torusF 背管弧+液壓泵背包+散熱柵'],
    ['掌行長臂 ×2(knuckle)', '楔台肩甲+hydCyl 破碎缸×2;左前臂鑄鐵鍋盾(latheF 深鍋+雙耳+綁帶+焊點)、右前臂裸機構(活塞+latheF 齒輪盤+cablesF 纜管);左巨拳/右長爪'],
    ['短後腿 ×2', 'tboxF 收分殼+prismF 外側甲+latheF 膝盤+hydCyl+四趾猩足'],
    ['武裝(右肩三管霰彈/左肩噴口)', '三 cylF 管+latheF 同軸彈鼓+打孔散熱護套+accent 槍口環;latheF 電漿喇叭+燃料罐+cablesF 輸送管'],
  ],
  head(c, h) {
    const { PAL, accent } = c;
    // 多面猩顱盔(tboxF 收分:底寬頂窄、頂面後移 = 後斜顱頂)
    tboxF(h, { w0: 0.78, d0: 0.68, w1: 0.46, d1: 0.48, h: 0.40, sz: -0.06 }, 0, 0.24, -0.02, PAL.mid, { metalness: 0.45 });
    // 矢狀嵴(prismF 低楔沿 z 縱貼顱頂;★ 圖顱頂中央稜線)
    const crest = prismF(h, [[-0.23, 0], [0.26, 0], [0.13, 0.13], [-0.10, 0.15]], 0.09, 0, 0.42, 0.02, GUNMETAL, { metalness: 0.3 });
    crest.rotation.y = Math.PI / 2;
    // 怒眉稜(prismF 中央下壓 V 帶,壓在眼上)
    const brow = [[-0.34, 0], [0, -0.045], [0.34, 0], [0.34, 0.115], [0, 0.07], [-0.34, 0.115]];
    prismF(h, brow, 0.12, 0, 0.17, 0.28, PAL.deep, { metalness: 0.6 });
    // 灰臉板(prismF 八角猩面;★ 圖臉部是灰色機械面)
    const face = [[-0.26, -0.21], [-0.13, -0.33], [0.13, -0.33], [0.26, -0.21], [0.32, 0.07], [0.21, 0.25], [-0.21, 0.25], [-0.32, 0.07]];
    prismF(h, face, 0.10, 0, -0.01, 0.27, FACE, { metalness: 0.4 });
    // 熔爐雙眼(accent 發光;★ 圖橘紅眼)
    sphF(h, 0.07, -0.165, 0.11, 0.35, accent, { emissive: accent, emissiveIntensity: 1.6 });
    sphF(h, 0.07, 0.165, 0.11, 0.35, accent, { emissive: accent, emissiveIntensity: 1.6 });
    // 圓吻(tboxF 前凸收分)+ 鼻孔 ×2 + 嘴縫 + 寬顎
    const muzz = tboxF(h, { w0: 0.44, d0: 0.20, w1: 0.34, d1: 0.15, h: 0.24, sz: -0.02 }, 0, -0.09, 0.40, FACE, { metalness: 0.4 });
    muzz.rotation.x = Math.PI / 2;
    sphF(h, 0.026, -0.075, 0.0, 0.51, INK);
    sphF(h, 0.026, 0.075, 0.0, 0.51, INK);
    bxF(h, 0.28, 0.035, 0.02, 0, -0.18, 0.50, INK);
    tboxF(h, { w0: 0.58, d0: 0.36, w1: 0.48, d1: 0.30, h: 0.18 }, 0, -0.30, 0.22, PAL.deep, { metalness: 0.55 });
    // 頰甲 ×2(prismF 五角側板)+ 圓盤耳 ×2(latheF 側向圓盤)
    for (const sx of [-1, 1]) {
      const ck = prismF(h, [[sx * -0.03, -0.18], [sx * 0.16, -0.13], [sx * 0.20, 0.08], [sx * 0.08, 0.18], [sx * -0.05, 0.13]], 0.08, sx * 0.31, -0.02, 0.19, PAL.main, { metalness: 0.55 });
      ck.rotation.y = sx * 0.5;
      const ear = latheF(h, [[0.025, -0.038], [0.13, -0.03], [0.15, 0], [0.13, 0.03], [0.025, 0.038]], 10, sx * 0.45, 0.08, -0.05, PAL.mid, { metalness: 0.55 });
      ear.rotation.z = Math.PI / 2;
    }
    // 頸環(latheF;頭沉在肩間的接合座)
    latheF(h, [[0.26, -0.05], [0.33, -0.02], [0.33, 0.02], [0.26, 0.05]], 12, 0, -0.44, -0.02, IRON, { metalness: 0.8 });
  },
  chest(c, ch, d) {
    const { PAL, accent, G } = c;
    const top = d.shoulderY, bot = d.waistY;
    // 桶胸主殼(tboxF 收分:肩寬腰窄、頂面微後移 = 聳背前傾剪影)
    tboxF(ch, { w0: d.shoulderX * 1.34, d0: 0.80 * G, w1: d.shoulderX * 1.74, d1: 1.0 * G, h: (top - bot) * 0.66, sz: -0.06 }, 0, top - (top - bot) * 0.33, 0.02, PAL.mid, { metalness: 0.5 });
    // 肩背橫甲(★ 圖肩線厚甲棚;收窄讓位給肩甲)
    tboxF(ch, { w0: d.shoulderX * 1.55, d0: 0.9, w1: d.shoulderX * 1.4, d1: 0.75, h: 0.28, sz: -0.06 }, 0, top - 0.05, -0.18, PAL.main, { metalness: 0.55 });
    // 隆背駝峰(tboxF 斜置)+ 背頂亮鞍 + 散熱柵三條(中央 accent)
    const hump = tboxF(ch, { w0: 0.72 * G, d0: 0.62, w1: 0.5 * G, d1: 0.42, h: 0.42 }, 0, top + 0.20, -0.48, PAL.mid, { metalness: 0.55 });
    hump.rotation.x = -0.35;
    tboxF(ch, { w0: 0.5 * G, d0: 0.4, w1: 0.4 * G, d1: 0.3, h: 0.12 }, 0, top + 0.40, -0.52, PAL.main, { metalness: 0.5 });
    for (let i = 0; i < 3; i++)
      bxF(ch, 0.56, 0.07, 0.05, 0, top + 0.10 - i * 0.12, -0.82, i === 1 ? accent : COAL,
        i === 1 ? { emissive: accent, emissiveIntensity: 0.7 } : { metalness: 0.7 });
    // 領口護甲(頭沉在肩間的前緣)
    tboxF(ch, { w0: 0.66, d0: 0.36, w1: 0.56, d1: 0.30, h: 0.14 }, 0, top - 0.12, 0.26, PAL.dark, { metalness: 0.6 });
    // 左右胸甲(prismF 角板;★ 圖成對大胸片)
    const pec = [[-0.22, -0.33], [0.22, -0.29], [0.37, 0], [0.26, 0.26], [-0.26, 0.30], [-0.35, -0.02]];
    for (const sx of [-1, 1])
      prismF(ch, pec.map(([x, y]) => [sx * x, y]), 0.10, sx * 0.42 * G, top - 0.66, 0.56, PAL.main, { metalness: 0.5 });
    // 胸骨中柱 + 爐膛發光縫(★ 圖胸口中央直條橘光)
    tboxF(ch, { w0: 0.30, d0: 0.14, w1: 0.24, d1: 0.12, h: 0.72 }, 0, top - 0.62, 0.56, PAL.dark, { metalness: 0.6 });
    bxF(ch, 0.10, 0.5, 0.04, 0, top - 0.60, 0.64, accent, { emissive: accent, emissiveIntensity: 1.2 });
    // 菱形爐核(prismF;★ 圖腹前發光菱窗)
    prismF(ch, [[0, -0.17], [0.13, 0], [0, 0.17], [-0.13, 0]], 0.06, 0, bot + 0.70, 0.52, accent, { emissive: accent, emissiveIntensity: 1.4 });
    // 腹部爐柵(三段收分疊板 = 爐膛裝甲;寬體不收腰)+ 段間發光縫 ×2
    for (let i = 0; i < 3; i++) {
      const w = (0.90 - i * 0.06) * G;
      tboxF(ch, { w0: w, d0: 0.62 * G, w1: w + 0.05, d1: 0.66 * G, h: 0.18 }, 0, bot + 0.46 - i * 0.20, 0.05, i % 2 ? PAL.dark : PAL.mid, { metalness: 0.55 });
      if (i < 2) bxF(ch, 0.40, 0.03, 0.02, 0, bot + 0.36 - i * 0.20, 0.05 + 0.34 * G, accent, { emissive: accent, emissiveIntensity: 0.8 });
    }
    // 腰側液壓管束(cablesF 一側 3 條,各自成件)
    for (const sx of [-1, 1])
      cablesF(ch, { p0: [sx * 0.34 * G, bot + 0.55, 0.30], p1: [sx * 0.28 * G, bot - 0.25, 0.22], k: 3, r: 0.024, sag: 0.02, spread: 0.05 }, GUNMETAL, { metalness: 0.7 });
    // 液壓泵背包(tboxF)+ 蓄壓罐 ×2(cylF 直立)+ 罐頂蓋
    tboxF(ch, { w0: 0.92, d0: 0.36, w1: 0.8, d1: 0.3, h: 0.85, sz: 0.04 }, 0, top - 0.95, -0.66 * G, PAL.dark, { metalness: 0.6 });
    for (const sx of [-1, 1]) {
      cylF(ch, 0.11, 0.11, 0.6, 10, sx * 0.30, top - 0.85, -0.86 * G, IRON, { metalness: 0.8 });
      latheF(ch, [[0.115, 0], [0.09, 0.05], [0.0001, 0.08]], 10, sx * 0.30, top - 0.55, -0.86 * G, COAL, { metalness: 0.8 });
    }
    // 打孔煙囪(★ 圖左上招牌:右肩後的多孔散熱筒)+ 頂緣環 + INK 孔珠 8 顆(索引遞變)
    const stk = cylF(ch, 0.10, 0.115, 0.62, 10, 0.58, top + 0.32, -0.52, GUNMETAL, { metalness: 0.8 });
    stk.rotation.z = -0.06;
    latheF(ch, [[0.10, -0.03], [0.13, -0.01], [0.13, 0.01], [0.10, 0.03]], 10, 0.60, top + 0.63, -0.52, COAL, { metalness: 0.8 });
    for (let i = 0; i < 8; i++) {
      const th = (i % 4) / 4 * Math.PI * 2 + (i < 4 ? 0 : Math.PI / 4);
      const oy = i < 4 ? 0.20 : 0.40;
      sphF(ch, 0.024, 0.58 + Math.cos(th) * 0.105, top + 0.12 + oy, -0.52 + Math.sin(th) * 0.105, INK);
    }
    // 背管弧(torusF 半弧,自煙囪跨到左肩;★ 圖頭後的彎管)
    const pipe = torusF(ch, 0.55, 0.045, 0, top + 0.10, -0.56, IRON, { metalness: 0.8 }, Math.PI * 0.8);
    pipe.rotation.z = Math.PI * 0.1;
  },
  pelvis(c, hips) {
    const { PAL, accent, G } = c;
    // 骨盆主體(tboxF 寬體)+ 腰帶(上緣厚板)
    tboxF(hips, { w0: 0.72 * G, d0: 0.56 * G, w1: 0.64 * G, d1: 0.5 * G, h: 0.38 }, 0, 0, 0, PAL.mid, { metalness: 0.55 });
    tboxF(hips, { w0: 0.78 * G, d0: 0.60 * G, w1: 0.70 * G, d1: 0.54 * G, h: 0.10 }, 0, 0.21, 0, PAL.dark, { metalness: 0.6 });
    // 前裆甲(prismF 五角盾,前傾)+ 側裙 ×2(prismF 斜垂)
    const cro = prismF(hips, [[-0.18, -0.26], [0, -0.34], [0.18, -0.26], [0.22, 0.05], [-0.22, 0.05]], 0.06, 0, -0.07, 0.29 * G, PAL.main, { metalness: 0.5 });
    cro.rotation.x = -0.25;
    for (const sx of [-1, 1]) {
      const sk = prismF(hips, [[-0.11, -0.28], [0.11, -0.28], [0.16, 0], [0.11, 0.15], [-0.11, 0.15], [-0.16, 0]], 0.05, sx * 0.38 * G, -0.08, 0.02, PAL.main, { metalness: 0.5 });
      sk.rotation.y = sx * Math.PI / 2;
      sk.rotation.z = sx * 0.18;
    }
  },
  thigh(c, l, d) {
    const { PAL, G } = c;
    // 短粗腿殼(tboxF 收分,膝端加寬)
    tboxF(l, { w0: 0.32 * G, d0: 0.38 * G, w1: 0.40 * G, d1: 0.46 * G, h: d.len }, 0, -d.len * 0.5, 0.01, PAL.mid, { metalness: 0.5 });
    // 外側甲板(prismF 六角;★ 圖大腿外側大片甲)
    const pl = prismF(l, [[-0.11, -0.34], [0.11, -0.34], [0.16, -0.04], [0.11, 0.20], [-0.11, 0.20], [-0.16, -0.04]], 0.06, c.sx * 0.23 * G, -d.len * 0.48, 0.02, PAL.main, { metalness: 0.5 });
    pl.rotation.y = c.sx * Math.PI / 2;
    // 髖側圓盤(latheF)+ 前側液壓缸(hydCyl:工程機具語彙,收在節內不跨膝)
    const hd = latheF(l, [[0.02, -0.034], [0.115, -0.026], [0.13, 0], [0.115, 0.026], [0.02, 0.034]], 10, c.sx * 0.23 * G, -0.04, 0.01, PAL.deep, { metalness: 0.75 });
    hd.rotation.z = Math.PI / 2;
    hydCyl(l, 0.045, d.len * 0.48, 0, -d.len * 0.34, 0.21 * G, -0.14, ROD);
  },
  shin(c, l, d) {
    const { PAL, G } = c;
    // 小腿殼(tboxF 踝端放寬 = 蹠行粗踝)+ 脛前護板
    tboxF(l, { w0: 0.24 * G, d0: 0.28 * G, w1: 0.30 * G, d1: 0.35 * G, h: d.len }, 0, -d.len * 0.5, -0.01, PAL.mid, { metalness: 0.6 });
    const gd = tboxF(l, { w0: 0.30, d0: 0.07, w1: 0.24, d1: 0.06, h: d.len * 0.62 }, 0, -d.len * 0.45, 0.17 * G, PAL.main, { metalness: 0.55 });
    gd.rotation.x = 0.06;
    // 膝圓盤(latheF 正面圓甲;★ 圖圓膝蓋)+ 踝束環
    const kn = latheF(l, [[0.03, -0.03], [0.13, -0.024], [0.15, 0], [0.13, 0.024], [0.03, 0.03]], 10, 0, -0.02, 0.17 * G, PAL.deep, { metalness: 0.7 });
    kn.rotation.x = Math.PI / 2;
    latheF(l, [[0.18 * G, -0.04], [0.21 * G, -0.015], [0.21 * G, 0.015], [0.18 * G, 0.04]], 10, 0, -d.len * 0.90, -0.01, COAL, { metalness: 0.8 });
  },
  foot(c, l, d) {
    const { PAL } = c;
    // 足身楔台 + 四趾猩足(★ 圖灰色分趾)+ 後跟
    tboxF(l, { w0: 0.46, d0: d.footL * 0.78, w1: 0.38, d1: d.footL * 0.6, h: 0.16, sz: 0.05 }, 0, -d.clear * 0.5, d.footL * 0.08, PAL.deep, { metalness: 0.5 });
    for (const ox of [-0.16, -0.055, 0.055, 0.16]) {
      const toe = tboxF(l, { w0: 0.09, d0: 0.10, w1: 0.065, d1: 0.06, h: 0.20, sz: 0.03 }, ox, -d.clear * 0.52, d.footL * 0.44, FACE, { metalness: 0.6 });
      toe.rotation.x = Math.PI / 2 + 0.12;
    }
    tboxF(l, { w0: 0.16, d0: 0.14, w1: 0.10, d1: 0.10, h: 0.10 }, 0, -d.clear * 0.5, -d.footL * 0.28, FACE, { metalness: 0.6 });
  },
  armUp(c, a, d) {
    const { PAL, G } = c;
    // 球肩(latheF 圓頂)+ 巨肩甲(tboxF 頂寬底窄 + 外緣板;★ 圖肩甲近頭高)
    latheF(a, [[0.20 * G, -0.03], [0.24 * G, 0.03], [0.20 * G, 0.10], [0.0001, 0.15]], 12, 0, 0.05, 0, PAL.deep, { metalness: 0.6 });
    tboxF(a, { w0: 0.72 * G, d0: 0.80 * G, w1: 0.95 * G, d1: 0.95 * G, h: 0.62, sz: -0.06 }, c.sx * 0.08, 0.22, 0, PAL.mid, { metalness: 0.5 });
    const rim = prismF(a, [[-0.34, -0.24], [0.34, -0.24], [0.41, 0], [0.29, 0.22], [-0.29, 0.22], [-0.41, 0]], 0.07, c.sx * 0.50 * G, 0.18, 0, PAL.main, { metalness: 0.5 });
    rim.rotation.y = c.sx * Math.PI / 2;
    // 上臂殼(tboxF 肘端加寬 = 巨臂)+ 液壓破碎缸 ×2(前側斜貼,收在節內不跨肘)
    tboxF(a, { w0: 0.42 * G, d0: 0.48 * G, w1: 0.52 * G, d1: 0.58 * G, h: d.len * 0.92 }, 0, -d.len * 0.52, 0.02, PAL.mid, { metalness: 0.5 });
    for (const s2 of [-1, 1])
      hydCyl(a, 0.055, d.len * 0.46, s2 * 0.26 * G, -d.len * 0.42, 0.27 * G, 0.14, ROD);
    // 肘關節環(latheF)
    latheF(a, [[0.25 * G, -0.045], [0.29 * G, -0.018], [0.29 * G, 0.018], [0.25 * G, 0.045]], 10, 0, -d.len * 0.97, 0.01, IRON, { metalness: 0.8 });
  },
  armFore(c, a, d) {
    const { PAL, accent, G } = c;
    if (c.sx < 0) {
      // 左前臂:裝甲殼 + 束環 ×2 + ── 鑄鐵鍋盾(★ 圖招牌:黑灰深鍋、雙耳、綁帶、焊點 = 後加的)──
      tboxF(a, { w0: 0.40 * G, d0: 0.46 * G, w1: 0.48 * G, d1: 0.54 * G, h: d.len * 0.9 }, 0, -d.len * 0.48, 0.01, PAL.mid, { metalness: 0.6 });
      for (const oy of [-0.45, -1.25])
        latheF(a, [[0.26 * G, -0.035], [0.295 * G, -0.014], [0.295 * G, 0.014], [0.26 * G, 0.035]], 10, 0, oy, 0.01, COAL, { metalness: 0.8 });
      // 深鍋(latheF 鼓腹收口 + 外翻鍋沿;軸向外 = 鍋口朝外)
      const pot = latheF(a, [
        [0.20, 0], [0.46, 0.05], [0.60, 0.20], [0.64, 0.40], [0.60, 0.58], [0.66, 0.65], [0.62, 0.70],
      ], 12, -0.36 * G, -d.len * 0.5, 0.10, POT, { metalness: 0.7 });
      pot.rotation.z = Math.PI / 2;                                     // +y → −x:鍋口朝左外側
      pot.rotation.y = 0.5;                                             // 鍋口再前擺(★ 圖鍋口斜朝前,看得到鍋沿與內膛)
      // 鍋內膛(暗腔)+ 鍋沿環 + 雙耳(torusF 半埋環,掛 pot 子節點隨鍋轉)
      cylF(pot, 0.54, 0.54, 0.06, 12, 0, 0.64, 0, INK, { metalness: 0.3 });
      torusF(pot, 0.62, 0.032, 0, 0.68, 0, POTRIM, { metalness: 0.7 }).rotation.x = Math.PI / 2;
      for (const sz of [-1, 1]) {
        const ear = torusF(pot, 0.15, 0.034, 0, 0.55, sz * 0.64, POTRIM, { metalness: 0.7 });
        ear.rotation.y = Math.PI / 2;
      }
      // 鍋底安裝座(latheF 盤)+ 綁帶 ×2(跨過前臂 = 綁上去的)+ 焊點珠圈 6 顆(索引遞變)
      const mnt = latheF(a, [[0.12, -0.04], [0.24, -0.025], [0.26, 0], [0.24, 0.025], [0.12, 0.04]], 10, -0.30 * G, -d.len * 0.5, 0.04, POTRIM, { metalness: 0.7 });
      mnt.rotation.z = Math.PI / 2;
      for (const oy of [-d.len * 0.34, -d.len * 0.66])
        bxF(a, 0.10, 0.07, 0.60 * G, -0.32 * G, oy, 0.02, 0x1c2126, { metalness: 0.6 });
      for (let i = 0; i < 6; i++) {
        const th = i / 6 * Math.PI * 2;
        sphF(a, 0.030, -0.33 * G, -d.len * 0.5 + Math.cos(th) * 0.30, 0.04 + Math.sin(th) * 0.30, POTRIM, { metalness: 0.6 });
      }
    } else {
      // 右前臂:裸機構(★ 圖:外露活塞 + 齒輪盤 + 纜管 —— 沒有整片裝甲)
      cylF(a, 0.20 * G, 0.25 * G, d.len * 0.9, 10, 0, -d.len * 0.48, 0, POTRIM, { metalness: 0.75 });
      hydCyl(a, 0.05, d.len * 0.46, 0.24 * G, -d.len * 0.36, 0.17 * G, 0.10, ROD);
      hydCyl(a, 0.05, d.len * 0.46, 0.20 * G, -d.len * 0.62, -0.16 * G, -0.10, ROD);
      // 齒輪盤(latheF 圓盤 + 8 齒 bxF 索引環列;★ 圖前臂外側齒輪)
      const gear = latheF(a, [[0.05, -0.04], [0.19, -0.032], [0.21, 0], [0.19, 0.032], [0.05, 0.04]], 10, 0.30 * G, -d.len * 0.42, -0.04, IRON, { metalness: 0.85 });
      gear.rotation.z = Math.PI / 2;
      for (let i = 0; i < 8; i++) {
        const th = i / 8 * Math.PI * 2;
        const tooth = bxF(a, 0.05, 0.10, 0.055, 0.30 * G, -d.len * 0.42 + Math.cos(th) * 0.24, -0.04 + Math.sin(th) * 0.24, IRON, { metalness: 0.85 });
        tooth.rotation.x = th;
      }
      // 外露纜管(cablesF 3 條各自成件)+ 腕上束環
      cablesF(a, { p0: [-0.08 * G, -0.12, -0.16 * G], p1: [-0.05 * G, -d.len * 0.86, -0.12 * G], k: 3, r: 0.024, sag: 0.05, spread: 0.055 }, COAL, { metalness: 0.6 });
      latheF(a, [[0.23 * G, -0.035], [0.26 * G, -0.014], [0.26 * G, 0.014], [0.23 * G, 0.035]], 10, 0, -d.len * 0.82, 0, COAL, { metalness: 0.8 });
    }
    // 腕關節環(兩臂同款)
    latheF(a, [[0.21 * G, -0.04], [0.24 * G, -0.016], [0.24 * G, 0.016], [0.21 * G, 0.04]], 10, 0, -d.len * 0.97, 0, IRON, { metalness: 0.8 });
  },
  mount(c, F) {
    const { PAL, accent, G, K, H } = c;
    // ── 掌行前腳(★ 圖不對稱):左 = 巨拳(壓在鍋盾下觸地)、右 = 長爪(指尖觸地)──
    // 左巨拳:掌背楔台 + 四指 ×2 節 + 拇指
    const hl = F.handL;
    tboxF(hl, { w0: 0.56, d0: 0.54, w1: 0.48, d1: 0.46, h: 0.36, sz: 0.05 }, 0, -0.21, 0.10, PAL.deep, { metalness: 0.55 });
    for (const ox of [-0.19, -0.065, 0.065, 0.19]) {
      const s1 = tboxF(hl, { w0: 0.105, d0: 0.115, w1: 0.095, d1: 0.105, h: 0.23 }, ox, -0.31, 0.32, FACE, { metalness: 0.6 });
      s1.rotation.x = Math.PI / 2 + 0.45;
      const s2 = tboxF(hl, { w0: 0.095, d0: 0.105, w1: 0.075, d1: 0.085, h: 0.21, sz: 0.03 }, ox, -0.47, 0.37, FACE, { metalness: 0.6 });
      s2.rotation.x = Math.PI / 2 + 1.0;
    }
    const th1 = tboxF(hl, { w0: 0.10, d0: 0.10, w1: 0.08, d1: 0.08, h: 0.18 }, 0.32, -0.29, 0.12, FACE, { metalness: 0.6 });
    th1.rotation.x = Math.PI / 2 + 0.5;
    th1.rotation.z = -0.5;
    // 右長爪:腕轂 + 四長指 ×2 節(收分到尖、弧垂觸地)
    const hr = F.handR;
    const hub = latheF(hr, [[0.11, -0.06], [0.23, -0.04], [0.25, 0.02], [0.20, 0.09]], 10, 0, -0.14, 0.06, GUNMETAL, { metalness: 0.75 });
    hub.rotation.x = 0.2;
    for (const ox of [-0.22, -0.075, 0.075, 0.22]) {
      const s1 = tboxF(hr, { w0: 0.095, d0: 0.105, w1: 0.075, d1: 0.085, h: 0.36 }, ox, -0.27, 0.23, FACE, { metalness: 0.65 });
      s1.rotation.x = Math.PI / 2 + 0.3;
      const s2 = tboxF(hr, { w0: 0.075, d0: 0.085, w1: 0.032, d1: 0.032, h: 0.34, sz: 0.05 }, ox, -0.49, 0.36, FACE, { metalness: 0.65 });
      s2.rotation.x = Math.PI / 2 + 0.95;
    }
    // ── 右肩三管霰彈(輕;gunPitch 俯仰,肩扛 = weap 'N' + gunR)──
    const sy = c.dims.shoulderYl;
    tboxF(F.chest, { w0: 0.30, d0: 0.44, w1: 0.24, d1: 0.36, h: 0.46 }, 0.78, sy + 0.16, -0.26, PAL.deep, { metalness: 0.7 });   // 肩架支柱(生根肩背甲)
    const gun = new THREE.Group();
    gun.position.set(0.78, sy + 0.48, -0.22);
    gun.rotation.set(1.45, 0, -0.06);
    F.chest.add(gun);
    const GL = 0.24 * H * K.barrelF;
    // 機匣(tboxF)+ 同軸彈鼓(latheF 波紋鼓,鼓軸∥槍管 = 供彈同軸)
    tboxF(gun, { w0: 0.34, d0: 0.46, w1: 0.28, d1: 0.38, h: 0.60 }, 0, -0.34, -0.04, COAL, { metalness: 0.75 });
    latheF(gun, [[0.14, -0.11], [0.19, -0.09], [0.19, -0.03], [0.215, -0.02], [0.215, 0.02], [0.19, 0.03], [0.19, 0.09], [0.14, 0.11]], 10, 0, -0.76, -0.04, PAL.mid, { metalness: 0.7 });
    // 三管(cylF ×3 三角排列,頂 1 底 2)
    for (let i = 0; i < 3; i++) {
      const th = Math.PI / 2 + i / 3 * Math.PI * 2;
      cylF(gun, 0.052, 0.056, GL * 1.1, 8, Math.cos(th) * 0.085, GL * 0.45, Math.sin(th) * 0.085, INK, { metalness: 0.85 });
    }
    // 打孔散熱護套(latheF 圓筒 + INK 孔珠 10 顆索引環列;★ 圖多孔筒)
    latheF(gun, [[0.150, 0], [0.163, 0.05], [0.163, 0.60], [0.150, 0.65]], 10, 0, GL * 0.35, 0, GUNMETAL, { metalness: 0.8 });
    for (let i = 0; i < 10; i++) {
      const th = (i % 5) / 5 * Math.PI * 2 + (i < 5 ? 0 : Math.PI / 5);
      const oy = i < 5 ? 0.18 : 0.42;
      sphF(gun, 0.024, Math.cos(th) * 0.165, GL * 0.35 + oy, Math.sin(th) * 0.165, INK);
    }
    // 槍口環(accent 擊發閃光)
    const lMuz = latheF(gun, [[0.09, -0.035], [0.13, -0.012], [0.13, 0.012], [0.09, 0.035]], 10, 0, GL * 1.04, 0, accent, { emissive: accent, emissiveIntensity: 1.0 });
    // ── 左肩電漿噴口(重;gunL 俯仰)──
    tboxF(F.chest, { w0: 0.30, d0: 0.44, w1: 0.24, d1: 0.36, h: 0.46 }, -0.78, sy + 0.16, -0.26, PAL.deep, { metalness: 0.7 });
    const vent = new THREE.Group();
    vent.position.set(-0.78, sy + 0.46, -0.24);
    vent.rotation.set(1.50, 0, 0.06);
    F.chest.add(vent);
    // 機匣 + 電漿喇叭(latheF 階狀外擴)+ 磁約束光核 + 同軸燃料罐(latheF 膠囊,後掛)
    tboxF(vent, { w0: 0.34, d0: 0.40, w1: 0.28, d1: 0.34, h: 0.50 }, 0, -0.28, -0.02, COAL, { metalness: 0.75 });
    latheF(vent, [[0.10, 0], [0.15, 0.10], [0.12, 0.22], [0.17, 0.34], [0.16, 0.42]], 10, 0, 0.05, 0, GUNMETAL, { metalness: 0.85 });
    const hMuz = sphF(vent, 0.08, 0, 0.48, 0, accent, { emissive: accent, emissiveIntensity: 1.6 });
    const tank = latheF(vent, [[0.0001, -0.30], [0.10, -0.26], [0.13, -0.12], [0.13, 0.12], [0.10, 0.26], [0.0001, 0.30]], 10, 0, -0.78, -0.02, dimF(accent, 0.75), { emissive: accent, emissiveIntensity: 0.4 });
    // 輸送管(cablesF 自液壓泵背包跨到左肩噴口,各自成件)
    cablesF(F.chest, { p0: [-0.42, sy - 0.75, -0.70], p1: [-0.74, sy + 0.34, -0.28], k: 3, r: 0.028, sag: 0.05, spread: 0.05 }, IRON, { metalness: 0.75 });
    return {
      gunR: { g: gun, rest: 1.45, aim: 1.57 }, gunL: { g: vent, rest: 1.50, aim: 1.57 },
      muzzles: { light: { n: lMuz, r: 0.10 }, heavy: { n: hMuz, r: 0.10 } },
      lightGlowM: [lMuz], heavyGlowM: [hMuz, tank], heavyPivot: [],
      weap: { light: 'N', heavy: 'N' },
      hvy: { chest: 0.05, gun: 0.08 },
      aimPose: null,
      wpn: { light: { nodes: [gun], ref: gun, muz: lMuz, fwd: 'y' }, heavy: { nodes: [vent], ref: vent, muz: hMuz, fwd: 'y' } },
    };
  },
  extra(c, F, rig) {
    rig.bound = 1;         // 短腿跳奔:高速「後腿併蹬、雙臂前撐」(locomotion stepBiped)
    rig.leanF = 0.9;
    rig.gunArm = 0;        // 掌行前肢是前腳:不吃持械手收斂(models.js gorilla 同款)
  },
};
