// ============ t03 逐機零件檔(dev-only;獸型雙足 biped + knuckle 掌行)============
// ── t03「爐膛」突擊機甲(gorilla 大猩猩):掌行長臂、右肩三管霰彈/左肩噴口、左前臂鍋盾 ──
// 2D 定案圖:public/assets/cyberpunk_art/mechs/t03_{static,moving,heavy}.png(★ = t03_static)
// 幾何語彙一律取自 ../geo.js;MUST NOT 在本檔自建 BufferGeometry。
//
// ══ 2026-08-13 使用者:「大猩猩:肉體零件更圓潤一些」⇒ 本檔的分界(改動的唯一依據)══
//   舊版病灶:胸廓/肩/上臂/大腿/背全是**平板楔台**拼的,轉折是硬稜線 ⇒ 讀起來像紙箱人,
//   而大猩猩的識別點正是「鼓起來的肌肉量體」。★ 圖逐處都是圓弧隆起接硬機構環。
//
//   【肉 = 圓潤量體】 —— 手法只有兩種,都不是「把方塊縮角」:
//     ㋐ `belly()`  latheF 旋成肌腹,剖面**根細 → 腹鼓 → 梢收**(≥5 段),兩端封口;
//        `scale(sx,1,sz)` 把圓斷面壓成橢圓 ⇒ 圓潤靠**剖面**不是靠段數(徑向恆 12 = 低模上限)。
//        用於:上臂/前臂/大腿/小腿/桶胸肋廓/圓腹/前臂機殼。
//     ㋑ `bulge()`  sphF 壓扁的隆起(單塊肌肉的鼓面)。
//        用於:胸大肌 ×2、斜方肌隆起、背闊駝峰、臀 ×2、小腿肚 ×2、拳丘、三角肌罩。
//     兩端封口 + 梢收 是 run 那一張的保命條:屈伸時肌腹的**細端**才在關節側,
//     粗腹留在節中段 ⇒ 肘/膝彎到底也不會互穿(關節環半徑 > 梢端半徑,環才是外露的那一圈)。
//
//   【機構 = 維持硬邊】 —— tboxF / prismF / cylF / torusF,一律不圓化:
//     肩砲(三管霰彈)、背砲(電漿噴口)、打孔煙囪、背管弧、液壓泵背包與蓄壓罐、
//     肩/肘/腕/膝/踝關節環、液壓缸(hydCyl)、齒輪盤與齒、指節與趾爪、腳掌、
//     胸口裝甲板(胸骨中柱/菱形爐核/腹前爐柵)、散熱柵條、鍋盾綁帶與焊點、肩甲外緣板。
//     硬與軟**並置**才讀得出「生體 × 機械」;整台圓掉就變成玩偶。
//
//   【掌行(knuckle:true)三條】 —— ★/moving 圖上肩明顯高於臀、重心壓在前肢:
//     ① 前臂與拳的量體跟著加大(左拳丘 0.28→0.374 半寬、左前臂肌腹 0.276→0.31、
//        右機殼 0.2875→0.30 半徑;指節/爪一併放大);
//     ② 肩線靠**三角肌罩 + 斜方肌稜 + 桶胸頂緣**三層疊出來抬過臀(`prop` 是對 locomotion
//        校準過的凍結區塊 ⇒ MUST NOT 動 shoulderY 去換這個效果);
//     ③ 拳/爪是著地面 ⇒ 指節、趾爪、腕轂一律維持硬邊。
//
//   ⚠ c1 實測的反例(留著免得再走一次):把斜方肌/胸大肌/駝峰做成**大顆罩**(r 0.62/0.43/0.60)
//     會把肩砲、打孔煙囪、肩背橫甲、胸骨中柱、腹前爐柵整批吞進肉裡 —— 畫面上是一台
//     沒有任何硬件的橘色玩偶,而每一條契約都還是對的。⇒ 肉的尺寸上限由「硬件還讀不讀得到」
//     決定:斜方肌收成一道**稜**(0.40×[1.50,0.58,0.96])、肩砲同時上抬到 sy+0.66 才夠。
//
// 色階:主殼 PAL.mid(工業橘的正確深度;PAL.main 全上會 washed-out)、次板 PAL.main、
//        亮緣 PAL.lite、關節 PAL.deep;鑄鐵鍋刻意跳出色系(POT 黑灰)。
import * as THREE from 'three';
import {
  matF, dimF, bxF, cylF, sphF, coneF, torusF, tboxF, prismF, latheF, finF, fanF, chainF, cablesF,
  hydCyl, sinew, seg2, IRON, GUNMETAL, COAL, INK, BONE, BRASS,
} from '../geo.js';

// 本機專用色:鑄鐵鍋(與全機塗裝刻意不同調 = 後加的)/ 灰臉板 / 亮活塞桿
const POT = 0x2b3138, POTRIM = 0x3a4048, FACE = 0x565b60, ROD = 0xd8dde2;

// ── 肌腹剖面表([沿肢長比例 u, 半徑倍率];u=0 在根、u=1 在梢)──
// 三者都是「根細 → 腹鼓 → 梢收」,差別只在腹峰的位置:
const ARM = [[0, 0.66], [0.16, 0.92], [0.36, 1.00], [0.60, 0.94], [0.82, 0.80], [1, 0.68]];  // 腹峰偏上(肱二頭/前臂屈肌)
const THG = [[0, 0.80], [0.14, 0.98], [0.34, 1.00], [0.60, 0.93], [0.82, 0.80], [1, 0.70]];  // 腹峰更靠髖(股四頭)
const CLF = [[0, 0.86], [0.18, 1.00], [0.42, 0.92], [0.70, 0.76], [1, 0.60]];                // 腹峰極上(腓腸肌)

/** 肌腹:沿 −y 生長的旋成量體(剖面「根細→腹鼓→梢收」,兩端封口);sx/sz 把圓斷面壓成橢圓。 */
function belly(p, len, R, x, y, z, color, opts, sx = 1, sz = 1, prof = ARM) {
  const pts = [[0.0001, -len - 0.002]];
  for (let i = prof.length - 1; i >= 0; i--) pts.push([R * prof[i][1], -prof[i][0] * len]);
  pts.push([0.0001, 0.002]);
  const m = latheF(p, pts, 12, x, y, z, color, opts);   // 徑向恆 12(低模紀律上限)
  m.scale.set(sx, 1, sz);
  return m;
}
/** 隆起:壓扁的球 = 一塊會鼓起來的肌肉(胸大肌/斜方肌/臀/小腿肚/拳丘)。 */
function bulge(p, r, x, y, z, color, opts, s) {
  const m = sphF(p, r, x, y, z, color, opts);
  m.scale.set(s[0], s[1], s[2]);
  return m;
}

export default {
  label: '爐膛(t03 機甲・大猩猩)', hue: 0xe08a4a, height: 6.0,
  prop: { hips: 0.40, legSplay: 0.11, thigh: 0.42, shin: 0.40, shoulderY: 0.78, shoulderX: 0.21, upperArm: 0.3, foreArm: 0.32, head: 0.84, girth: 1.15 },
  gait: { strideF: 1.1, bob: 0.12, sway: 0.1, top: 7, legBase: -0.08, armBase: 0.14 },
  knuckle: true,                                                 // 掌行:前肢是前腳(rig.knuckle)
  moveSig: { poise: 0.25, idleF: 0.78, idleA: 1.50, launch: 0.60, spool: 0.52, brake: 0.52, settle: 0.60 },
  castSig: { omni: 'beat', dir: 'swing' },
  doc: [
    ['頭(低伏猩顱)', '肉:latheF 圓顱穹 + latheF 圓吻;機構:prismF 矢狀嵴/怒眉稜/灰臉板 + latheF 圓盤耳'],
    ['軀幹(桶胸+爐膛)', '肉:latheF 桶胸肋廓 + latheF 圓腹 + sphF 胸大肌 ×2/斜方肌隆起/背闊駝峰;機構:胸骨中柱+菱形爐核+腹前爐柵疊板+肩背橫甲'],
    ['背(隆背+煙囪)', '肉:sphF 背闊駝峰;機構:latheF 打孔煙囪(INK 孔珠)+torusF 背管弧+液壓泵背包+散熱柵條'],
    ['掌行長臂 ×2(knuckle)', '肉:latheF 三角肌罩+上臂肌腹+左前臂肌腹(掌行加大);機構:prismF 肩甲外緣+hydCyl 破碎缸+關節環;左鑄鐵鍋盾(latheF 深鍋+雙耳+綁帶+焊點)、右前臂裸機構(latheF 機殼+活塞+齒輪盤+cablesF 纜管)'],
    ['短後腿 ×2', '肉:latheF 股肌腹+脛肌腹+sphF 小腿肚+sphF 臀 ×2;機構:prismF 外側甲+latheF 膝盤/踝環+hydCyl+四趾猩足'],
    ['武裝(右肩三管霰彈/左肩噴口)', '全硬邊:三 cylF 管+latheF 同軸彈鼓+打孔散熱護套+accent 槍口環;latheF 電漿喇叭+燃料罐+cablesF 輸送管'],
  ],
  head(c, h) {
    const { PAL, accent } = c;
    // 【肉】圓顱穹(latheF 旋成:低矮圓頂,scale 壓成前後長的猩顱)
    const skull = latheF(h, [
      [0.0001, -0.02], [0.30, 0.02], [0.39, 0.15], [0.41, 0.30], [0.35, 0.42], [0.20, 0.50], [0.0001, 0.53],
    ], 12, 0, 0.02, -0.03, PAL.mid, { metalness: 0.45 });
    skull.scale.set(1.00, 1, 1.12);
    // 【機構】矢狀嵴(prismF 低楔沿 z 縱貼顱頂;★ 圖顱頂中央稜線 —— 硬稜壓在圓顱上)
    const crest = prismF(h, [[-0.24, 0], [0.27, 0], [0.13, 0.12], [-0.10, 0.14]], 0.09, 0, 0.42, 0.00, GUNMETAL, { metalness: 0.3 });
    crest.rotation.y = Math.PI / 2;
    // 【機構】怒眉稜(prismF 中央下壓 V 帶,壓在眼上)
    const brow = [[-0.34, 0], [0, -0.045], [0.34, 0], [0.34, 0.115], [0, 0.07], [-0.34, 0.115]];
    prismF(h, brow, 0.12, 0, 0.17, 0.28, PAL.deep, { metalness: 0.6 });
    // 【機構】灰臉板(prismF 八角猩面;★ 圖臉部是灰色機械面)
    const face = [[-0.26, -0.21], [-0.13, -0.33], [0.13, -0.33], [0.26, -0.21], [0.32, 0.07], [0.21, 0.25], [-0.21, 0.25], [-0.32, 0.07]];
    prismF(h, face, 0.10, 0, -0.01, 0.27, FACE, { metalness: 0.4 });
    // 熔爐雙眼(accent 發光;★ 圖橘紅眼)
    sphF(h, 0.07, -0.165, 0.11, 0.35, accent, { emissive: accent, emissiveIntensity: 1.6 });
    sphF(h, 0.07, 0.165, 0.11, 0.35, accent, { emissive: accent, emissiveIntensity: 1.6 });
    // 【肉】圓吻(latheF 鼓腹收口,軸朝 +z;scale 壓扁成寬吻)+ 鼻孔 ×2 + 嘴縫
    const muzz = latheF(h, [
      [0.0001, -0.02], [0.19, 0], [0.235, 0.08], [0.225, 0.17], [0.17, 0.24], [0.0001, 0.27],
    ], 12, 0, -0.09, 0.34, FACE, { metalness: 0.4 });
    muzz.rotation.x = Math.PI / 2;                                    // 軸 +y → +z:吻向前
    muzz.scale.set(1.10, 1, 0.82);                                    // 寬 × 長 × 高(壓扁)
    sphF(h, 0.026, -0.075, -0.02, 0.55, INK);
    sphF(h, 0.026, 0.075, -0.02, 0.55, INK);
    bxF(h, 0.28, 0.035, 0.02, 0, -0.17, 0.52, INK);
    // 【肉】寬顎隆起(sphF 壓扁:下顎的肉,不是一塊板)
    bulge(h, 0.30, 0, -0.30, 0.20, PAL.deep, { metalness: 0.5 }, [1.05, 0.42, 0.72]);
    // 【機構】頰甲 ×2(prismF 五角側板)+ 圓盤耳 ×2(latheF 側向圓盤)
    for (const sx of [-1, 1]) {
      const ck = prismF(h, [[sx * -0.03, -0.18], [sx * 0.16, -0.13], [sx * 0.20, 0.08], [sx * 0.08, 0.18], [sx * -0.05, 0.13]], 0.08, sx * 0.31, -0.02, 0.19, PAL.main, { metalness: 0.55 });
      ck.rotation.y = sx * 0.5;
      const ear = latheF(h, [[0.025, -0.038], [0.13, -0.03], [0.15, 0], [0.13, 0.03], [0.025, 0.038]], 10, sx * 0.45, 0.08, -0.05, PAL.mid, { metalness: 0.55 });
      ear.rotation.z = Math.PI / 2;
    }
    // 【機構】頸環(latheF;頭沉在肩間的接合座)
    latheF(h, [[0.26, -0.05], [0.33, -0.02], [0.33, 0.02], [0.26, 0.05]], 12, 0, -0.44, -0.02, IRON, { metalness: 0.8 });
  },
  chest(c, ch, d) {
    const { PAL, accent, G } = c;
    const top = d.shoulderY, bot = d.waistY;
    // ══【肉】桶胸肋廓(latheF:肩線最寬 → 往腰收;scale z 壓成前後略扁的猩猩胸廓)══
    // 剖面 y 一律遞增(latheF 要求),半徑峰值 1.19 ≈ 舊楔台頂寬 shoulderX×1.74 的一半。
    const rib = latheF(ch, [
      [0.0001, bot + 0.18], [0.66, bot + 0.24], [0.90, bot + 0.52],
      [1.04, top - 0.76], [1.15, top - 0.48], [1.18, top - 0.24],
      [1.02, top - 0.04], [0.60, top + 0.06], [0.0001, top + 0.11],
    ], 12, 0, 0, 0.02, PAL.mid, { metalness: 0.5 });
    rib.scale.set(1, 1, 0.54);
    // 【肉】斜方肌隆起(sphF 壓扁;★/moving 圖:頭沉在兩道肉稜之間 ⇒ 這是一道**稜**不是一顆罩,
    //   罩起來就把肩砲/煙囪/頭全吞掉,整台變成沒有硬件的玩偶 —— c1 實測過)
    bulge(ch, 0.40, 0, top - 0.02, -0.40, PAL.mid, { metalness: 0.5 }, [1.50, 0.58, 0.96]);
    // 【肉】背闊駝峰(sphF 壓扁;貼在肋廓背面)
    bulge(ch, 0.52, 0, top - 0.30, -0.56, PAL.mid, { metalness: 0.55 }, [1.16, 1.06, 0.86]);
    // 【機構】肩背橫甲(硬邊裝甲棚,壓在圓胸頂上 = 軟硬並置的主要對比面)
    tboxF(ch, { w0: d.shoulderX * 1.24, d0: 0.88, w1: d.shoulderX * 1.06, d1: 0.68, h: 0.22, sz: -0.10 }, 0, top + 0.02, 0.04, PAL.dark, { metalness: 0.6 });
    // 【機構】背散熱柵三條(中央 accent;貼在駝峰背面)
    for (let i = 0; i < 3; i++)
      bxF(ch, 0.56, 0.07, 0.05, 0, top - 0.16 - i * 0.13, -0.98, i === 1 ? accent : COAL,
        i === 1 ? { emissive: accent, emissiveIntensity: 0.7 } : { metalness: 0.7 });
    // 【機構】領口護甲(頭沉在肩間的前緣)
    tboxF(ch, { w0: 0.66, d0: 0.36, w1: 0.56, d1: 0.30, h: 0.14 }, 0, top - 0.06, 0.30, PAL.dark, { metalness: 0.6 });
    // 【肉】胸大肌 ×2(sphF 壓扁的鼓面;半寬 0.38、前凸 ≈0.12m ⇒ 是胸肌的弧,不是氣球)
    for (const sx of [-1, 1])
      bulge(ch, 0.34, sx * 0.44, top - 0.50, 0.40, PAL.main, { metalness: 0.5 }, [1.12, 0.90, 0.68]);
    // 【機構】胸骨中柱 + 爐膛發光縫(★ 圖胸口中央直條橘光 —— 硬板嵌在兩塊胸肌之間並凸出於它們)
    tboxF(ch, { w0: 0.34, d0: 0.16, w1: 0.26, d1: 0.13, h: 0.80 }, 0, top - 0.58, 0.66, PAL.dark, { metalness: 0.6 });
    bxF(ch, 0.11, 0.56, 0.04, 0, top - 0.56, 0.76, accent, { emissive: accent, emissiveIntensity: 1.2 });
    // ══【肉】圓腹(latheF 鼓腹:猩猩的桶腹不收腰;半徑峰 0.78 = 舊三段疊板的 1.5 倍)══
    const gut = latheF(ch, [
      [0.0001, bot - 0.34], [0.54, bot - 0.28], [0.71, bot - 0.10],
      [0.78, bot + 0.08], [0.75, bot + 0.24], [0.60, bot + 0.36], [0.0001, bot + 0.42],
    ], 12, 0, 0, 0.04, PAL.mid, { metalness: 0.5 });
    gut.scale.set(1, 1, 0.72);
    // 【機構】菱形爐核(prismF;★ 圖腹前發光菱窗)
    prismF(ch, [[0, -0.17], [0.13, 0], [0, 0.17], [-0.13, 0]], 0.06, 0, bot + 0.62, 0.50, accent, { emissive: accent, emissiveIntensity: 1.4 });
    // 【機構】腹前爐柵(三段硬邊疊板 + 段間發光縫 ×2 —— 貼在圓腹前面,弧背硬板;
    //   z 需比腹的前緣(0.04 + 0.78×0.72 ≈ 0.60)再外推,否則整排沉進肉裡看不見)
    for (let i = 0; i < 3; i++) {
      const w = 0.86 - i * 0.11;
      tboxF(ch, { w0: w, d0: 0.20, w1: w - 0.07, d1: 0.16, h: 0.16 }, 0, bot + 0.22 - i * 0.18, 0.60 - i * 0.05, i % 2 ? PAL.dark : PAL.main, { metalness: 0.55 });
      if (i < 2) bxF(ch, 0.38, 0.035, 0.02, 0, bot + 0.13 - i * 0.18, 0.69 - i * 0.05, accent, { emissive: accent, emissiveIntensity: 0.8 });
    }
    // 【機構】腰側液壓管束(cablesF 一側 3 條,各自成件)
    for (const sx of [-1, 1])
      cablesF(ch, { p0: [sx * 0.42 * G, bot + 0.50, 0.26], p1: [sx * 0.32 * G, bot - 0.28, 0.18], k: 3, r: 0.024, sag: 0.02, spread: 0.05 }, GUNMETAL, { metalness: 0.7 });
    // 【機構】液壓泵背包(tboxF)+ 蓄壓罐 ×2(cylF 直立)+ 罐頂蓋
    tboxF(ch, { w0: 0.92, d0: 0.36, w1: 0.8, d1: 0.3, h: 0.85, sz: 0.04 }, 0, top - 0.95, -0.72 * G, PAL.dark, { metalness: 0.6 });
    for (const sx of [-1, 1]) {
      cylF(ch, 0.11, 0.11, 0.6, 10, sx * 0.30, top - 0.85, -0.92 * G, IRON, { metalness: 0.8 });
      latheF(ch, [[0.115, 0], [0.09, 0.05], [0.0001, 0.08]], 10, sx * 0.30, top - 0.55, -0.92 * G, COAL, { metalness: 0.8 });
    }
    // 【機構】打孔煙囪(★ 圖左上招牌:右肩後的多孔散熱筒)+ 頂緣環 + INK 孔珠 8 顆(索引遞變)
    const stk = cylF(ch, 0.10, 0.115, 0.62, 10, 0.48, top + 0.44, -0.60, GUNMETAL, { metalness: 0.8 });
    stk.rotation.z = -0.06;
    latheF(ch, [[0.10, -0.03], [0.13, -0.01], [0.13, 0.01], [0.10, 0.03]], 10, 0.50, top + 0.75, -0.60, COAL, { metalness: 0.8 });
    for (let i = 0; i < 8; i++) {
      const th = (i % 4) / 4 * Math.PI * 2 + (i < 4 ? 0 : Math.PI / 4);
      const oy = i < 4 ? 0.20 : 0.40;
      sphF(ch, 0.024, 0.48 + Math.cos(th) * 0.105, top + 0.24 + oy, -0.60 + Math.sin(th) * 0.105, INK);
    }
    // 【機構】背管弧(torusF 半弧,自煙囪跨到左肩;★ 圖頭後的彎管)
    const pipe = torusF(ch, 0.58, 0.045, 0, top + 0.22, -0.70, IRON, { metalness: 0.8 }, Math.PI * 0.8);
    pipe.rotation.z = Math.PI * 0.1;
  },
  pelvis(c, hips) {
    const { PAL, accent, G } = c;
    // 骨盆主體(tboxF 寬體)+ 腰帶(上緣厚板)—— 骨盆是承力機構,維持硬邊
    tboxF(hips, { w0: 0.72 * G, d0: 0.56 * G, w1: 0.64 * G, d1: 0.5 * G, h: 0.38 }, 0, 0, 0, PAL.mid, { metalness: 0.55 });
    tboxF(hips, { w0: 0.78 * G, d0: 0.60 * G, w1: 0.70 * G, d1: 0.54 * G, h: 0.10 }, 0, 0.21, 0, PAL.dark, { metalness: 0.6 });
    // 【肉】臀 ×2(sphF 壓扁;掌行姿態下臀低於肩,但仍要有肉的弧)
    for (const sx of [-1, 1])
      bulge(hips, 0.27, sx * 0.24 * G, -0.09, -0.30 * G, PAL.mid, { metalness: 0.55 }, [1.06, 0.94, 0.96]);
    // 【機構】臀上腰甲(硬邊橫板壓在臀丘上緣 —— 少了它背面是一整團肉)
    tboxF(hips, { w0: 0.68 * G, d0: 0.26, w1: 0.58 * G, d1: 0.20, h: 0.13, sz: -0.03 }, 0, 0.13, -0.34 * G, PAL.dark, { metalness: 0.6 });
    // 【機構】前裆甲(prismF 五角盾,前傾)+ 側裙 ×2(prismF 斜垂)
    const cro = prismF(hips, [[-0.18, -0.26], [0, -0.34], [0.18, -0.26], [0.22, 0.05], [-0.22, 0.05]], 0.06, 0, -0.07, 0.29 * G, PAL.main, { metalness: 0.5 });
    cro.rotation.x = -0.25;
    for (const sx of [-1, 1]) {
      const sk = prismF(hips, [[-0.11, -0.28], [0.11, -0.28], [0.16, 0], [0.11, 0.15], [-0.11, 0.15], [-0.16, 0]], 0.05, sx * 0.40 * G, -0.08, 0.02, PAL.main, { metalness: 0.5 });
      sk.rotation.y = sx * Math.PI / 2;
      sk.rotation.z = sx * 0.18;
    }
  },
  thigh(c, l, d) {
    const { PAL, G } = c;
    // 【肉】股肌腹(latheF 收分:髖端細 → 股腹鼓 → 膝端收;膝端半徑 0.19 < 膝盤 0.15?
    //   不 —— 膝盤是正面貼片,梢端 0.19 讓踝/膝環仍是外露的那一圈)
    belly(l, d.len, 0.27, 0, 0, 0.01, PAL.mid, { metalness: 0.5 }, 1.00, 1.10, THG);
    // 【機構】外側甲板(prismF 六角;★ 圖大腿外側大片甲 —— 硬板貼在圓腿上)
    const pl = prismF(l, [[-0.11, -0.34], [0.11, -0.34], [0.16, -0.04], [0.11, 0.20], [-0.11, 0.20], [-0.16, -0.04]], 0.06, c.sx * 0.27 * G, -d.len * 0.46, 0.02, PAL.main, { metalness: 0.5 });
    pl.rotation.y = c.sx * Math.PI / 2;
    // 【機構】髖側圓盤(latheF)+ 前側液壓缸(hydCyl:工程機具語彙,收在節內不跨膝)
    const hd = latheF(l, [[0.02, -0.034], [0.115, -0.026], [0.13, 0], [0.115, 0.026], [0.02, 0.034]], 10, c.sx * 0.26 * G, -0.06, 0.01, PAL.deep, { metalness: 0.75 });
    hd.rotation.z = Math.PI / 2;
    hydCyl(l, 0.045, d.len * 0.48, 0, -d.len * 0.34, 0.25 * G, -0.14, ROD);
  },
  shin(c, l, d) {
    const { PAL, G } = c;
    // 【肉】脛肌腹(latheF;腹峰極上 = 腓腸肌)+ 小腿肚隆起(sphF 壓扁,偏後)
    belly(l, d.len, 0.235, 0, 0, -0.01, PAL.mid, { metalness: 0.6 }, 1.00, 1.08, CLF);
    bulge(l, 0.23, 0, -d.len * 0.30, -0.13, PAL.mid, { metalness: 0.6 }, [0.94, 1.30, 0.86]);
    // 【機構】脛前護板 + 膝圓盤(★ 圖圓膝蓋)+ 踝束環
    const gd = tboxF(l, { w0: 0.30, d0: 0.07, w1: 0.24, d1: 0.06, h: d.len * 0.62 }, 0, -d.len * 0.45, 0.20 * G, PAL.main, { metalness: 0.55 });
    gd.rotation.x = 0.06;
    const kn = latheF(l, [[0.03, -0.03], [0.13, -0.024], [0.15, 0], [0.13, 0.024], [0.03, 0.03]], 10, 0, -0.02, 0.20 * G, PAL.deep, { metalness: 0.7 });
    kn.rotation.x = Math.PI / 2;
    latheF(l, [[0.18 * G, -0.04], [0.21 * G, -0.015], [0.21 * G, 0.015], [0.18 * G, 0.04]], 10, 0, -d.len * 0.92, -0.01, COAL, { metalness: 0.8 });
  },
  foot(c, l, d) {
    const { PAL } = c;
    // 腳掌是著地機構:維持硬邊(足身楔台 + 四趾猩足 + 後跟)
    tboxF(l, { w0: 0.46, d0: d.footL * 0.78, w1: 0.38, d1: d.footL * 0.6, h: 0.16, sz: 0.05 }, 0, -d.clear * 0.5, d.footL * 0.08, PAL.deep, { metalness: 0.5 });
    for (const ox of [-0.16, -0.055, 0.055, 0.16]) {
      const toe = tboxF(l, { w0: 0.09, d0: 0.10, w1: 0.065, d1: 0.06, h: 0.20, sz: 0.03 }, ox, -d.clear * 0.52, d.footL * 0.44, FACE, { metalness: 0.6 });
      toe.rotation.x = Math.PI / 2 + 0.12;
    }
    tboxF(l, { w0: 0.16, d0: 0.14, w1: 0.10, d1: 0.10, h: 0.10 }, 0, -d.clear * 0.5, -d.footL * 0.28, FACE, { metalness: 0.6 });
  },
  armUp(c, a, d) {
    const { PAL, G } = c;
    // 【肉】三角肌罩(latheF 圓頂,外側微垂;取代舊的大楔台肩甲 —— 那塊平板是「紙箱人」的主因)
    const del = latheF(a, [
      [0.0001, -0.44], [0.28, -0.40], [0.44, -0.24], [0.52, -0.04], [0.50, 0.13], [0.42, 0.24], [0.26, 0.32], [0.0001, 0.37],
    ], 12, c.sx * 0.10, 0.04, 0, PAL.mid, { metalness: 0.5 });
    del.scale.set(1.10, 1, 1.06);
    // 【機構】肩甲外緣板(prismF 硬邊六角 —— 蓋在三角肌的**上外側**當肩章,
    //   掛在赤道就從背面讀成一片橫向的槳板;軟硬並置靠的是硬件壓在肉上,不是硬件伸出去)
    const rim = prismF(a, [[-0.30, -0.20], [0.30, -0.20], [0.36, 0.02], [0.24, 0.22], [-0.24, 0.22], [-0.36, 0.02]], 0.08, c.sx * 0.50 * G, 0.20, 0, PAL.main, { metalness: 0.5 });
    rim.rotation.y = c.sx * Math.PI / 2;   // 只轉 Ry:同顆網格再補 Rz 只會讓六角在自己的平面內自轉(geo.js finF 紀律 ③)
    // 【肉】上臂肌腹(latheF;梢端 0.68R = 0.23 < 肘環 0.29 ⇒ 肘環仍是外露的一圈,屈肘不互穿)
    belly(a, d.len * 0.97, 0.34, 0, -0.04, 0.02, PAL.mid, { metalness: 0.5 }, 1.00, 1.06, ARM);
    // 【機構】液壓破碎缸 ×2(前側斜貼,貼著肌腹外緣,收在節內不跨肘)
    for (const s2 of [-1, 1])
      hydCyl(a, 0.055, d.len * 0.46, s2 * 0.23 * G, -d.len * 0.42, 0.25 * G, 0.14, ROD);
    // 【機構】肘關節環(latheF)
    latheF(a, [[0.25 * G, -0.045], [0.29 * G, -0.018], [0.29 * G, 0.018], [0.25 * G, 0.045]], 10, 0, -d.len * 0.97, 0.01, IRON, { metalness: 0.8 });
  },
  armFore(c, a, d) {
    const { PAL, accent, G } = c;
    if (c.sx < 0) {
      // ── 左前臂:【肉】前臂肌腹(掌行承重 ⇒ 量體加大到 R 0.31)+ ── 鑄鐵鍋盾 ──
      belly(a, d.len * 0.94, 0.31, 0, -0.02, 0.01, PAL.mid, { metalness: 0.6 }, 1.00, 1.08, ARM);
      // 【機構】束環 ×2
      for (const oy of [-0.45, -1.25])
        latheF(a, [[0.28 * G, -0.035], [0.315 * G, -0.014], [0.315 * G, 0.014], [0.28 * G, 0.035]], 10, 0, oy, 0.01, COAL, { metalness: 0.8 });
      // 深鍋(latheF 鼓腹收口 + 外翻鍋沿;軸向外 = 鍋口朝外)
      const pot = latheF(a, [
        [0.20, 0], [0.46, 0.05], [0.60, 0.20], [0.64, 0.40], [0.60, 0.58], [0.66, 0.65], [0.62, 0.70],
      ], 12, -0.40 * G, -d.len * 0.5, 0.10, POT, { metalness: 0.7 });
      pot.rotation.z = Math.PI / 2;                                     // +y → −x:鍋口朝左外側
      pot.rotation.y = 0.5;                                             // 鍋口再前擺(★ 圖鍋口斜朝前,看得到鍋沿與內膛)
      // 鍋內膛(暗腔)+ 鍋沿環 + 雙耳(torusF 半埋環,掛 pot 子節點隨鍋轉)
      cylF(pot, 0.54, 0.54, 0.06, 12, 0, 0.64, 0, INK, { metalness: 0.3 });
      torusF(pot, 0.62, 0.032, 0, 0.68, 0, POTRIM, { metalness: 0.7 }).rotation.x = Math.PI / 2;
      for (const sz of [-1, 1]) {
        const ear = torusF(pot, 0.15, 0.034, 0, 0.55, sz * 0.64, POTRIM, { metalness: 0.7 });
        ear.rotation.y = Math.PI / 2;
      }
      // 【機構】鍋底安裝座(latheF 盤)+ 綁帶 ×2(跨過前臂 = 綁上去的)+ 焊點珠圈 6 顆(索引遞變)
      const mnt = latheF(a, [[0.12, -0.04], [0.24, -0.025], [0.26, 0], [0.24, 0.025], [0.12, 0.04]], 10, -0.33 * G, -d.len * 0.5, 0.04, POTRIM, { metalness: 0.7 });
      mnt.rotation.z = Math.PI / 2;
      for (const oy of [-d.len * 0.34, -d.len * 0.66])
        bxF(a, 0.10, 0.07, 0.66 * G, -0.34 * G, oy, 0.02, 0x1c2126, { metalness: 0.6 });
      for (let i = 0; i < 6; i++) {
        const th = i / 6 * Math.PI * 2;
        sphF(a, 0.030, -0.36 * G, -d.len * 0.5 + Math.cos(th) * 0.30, 0.04 + Math.sin(th) * 0.30, POTRIM, { metalness: 0.6 });
      }
    } else {
      // ── 右前臂:【機構】裸機構(★ 圖:外露活塞 + 齒輪盤 + 纜管 —— 沒有整片裝甲)──
      // 機殼仍走 latheF 但剖面是「機件收分」不是肌腹(圓的是筒身,轉折仍在環上)
      const cse = latheF(a, [
        [0.0001, -d.len * 0.95], [0.24, -d.len * 0.93], [0.28, -d.len * 0.74], [0.30, -d.len * 0.42],
        [0.29, -d.len * 0.18], [0.23, -0.02], [0.0001, 0],
      ], 12, 0, 0, 0, POTRIM, { metalness: 0.75 });
      cse.scale.set(1, 1, 1.04);
      hydCyl(a, 0.05, d.len * 0.46, 0.26 * G, -d.len * 0.36, 0.19 * G, 0.10, ROD);
      hydCyl(a, 0.05, d.len * 0.46, 0.22 * G, -d.len * 0.62, -0.18 * G, -0.10, ROD);
      // 齒輪盤(latheF 圓盤 + 8 齒 bxF 索引環列;★ 圖前臂外側齒輪)
      const gear = latheF(a, [[0.05, -0.04], [0.19, -0.032], [0.21, 0], [0.19, 0.032], [0.05, 0.04]], 10, 0.32 * G, -d.len * 0.42, -0.04, IRON, { metalness: 0.85 });
      gear.rotation.z = Math.PI / 2;
      for (let i = 0; i < 8; i++) {
        const th = i / 8 * Math.PI * 2;
        const tooth = bxF(a, 0.05, 0.10, 0.055, 0.32 * G, -d.len * 0.42 + Math.cos(th) * 0.24, -0.04 + Math.sin(th) * 0.24, IRON, { metalness: 0.85 });
        tooth.rotation.x = th;
      }
      // 外露纜管(cablesF 3 條各自成件)+ 腕上束環
      cablesF(a, { p0: [-0.10 * G, -0.12, -0.20 * G], p1: [-0.06 * G, -d.len * 0.86, -0.16 * G], k: 3, r: 0.024, sag: 0.05, spread: 0.055 }, COAL, { metalness: 0.6 });
      latheF(a, [[0.25 * G, -0.035], [0.28 * G, -0.014], [0.28 * G, 0.014], [0.25 * G, 0.035]], 10, 0, -d.len * 0.82, 0, COAL, { metalness: 0.8 });
    }
    // 【機構】腕關節環(兩臂同款)
    latheF(a, [[0.22 * G, -0.04], [0.25 * G, -0.016], [0.25 * G, 0.016], [0.22 * G, 0.04]], 10, 0, -d.len * 0.97, 0, IRON, { metalness: 0.8 });
  },
  mount(c, F) {
    const { PAL, accent, G, K, H } = c;
    // ── 掌行前腳(★ 圖不對稱):左 = 巨拳(壓在鍋盾下觸地)、右 = 長爪(指尖觸地)──
    // 【肉】左拳丘(sphF 壓扁的掌背肉丘;掌行承重 ⇒ 半寬 0.37 > 舊楔台 0.28)
    const hl = F.handL;
    bulge(hl, 0.34, 0, -0.20, 0.10, PAL.deep, { metalness: 0.55 }, [1.10, 1.00, 1.16]);
    // 【機構】四指 ×2 節 + 拇指(著地面 ⇒ 硬邊指節)
    for (const ox of [-0.21, -0.07, 0.07, 0.21]) {
      const s1 = tboxF(hl, { w0: 0.115, d0: 0.125, w1: 0.105, d1: 0.115, h: 0.25 }, ox, -0.32, 0.33, FACE, { metalness: 0.6 });
      s1.rotation.x = Math.PI / 2 + 0.45;
      const s2 = tboxF(hl, { w0: 0.105, d0: 0.115, w1: 0.085, d1: 0.095, h: 0.23, sz: 0.03 }, ox, -0.49, 0.39, FACE, { metalness: 0.6 });
      s2.rotation.x = Math.PI / 2 + 1.0;
    }
    const th1 = tboxF(hl, { w0: 0.11, d0: 0.11, w1: 0.09, d1: 0.09, h: 0.19 }, 0.35, -0.30, 0.12, FACE, { metalness: 0.6 });
    th1.rotation.x = Math.PI / 2 + 0.5;
    th1.rotation.z = -0.5;
    // 【機構】右長爪:腕轂 + 四長指 ×2 節(收分到尖、弧垂觸地)
    const hr = F.handR;
    const hub = latheF(hr, [[0.12, -0.06], [0.25, -0.04], [0.27, 0.02], [0.21, 0.09]], 10, 0, -0.14, 0.06, GUNMETAL, { metalness: 0.75 });
    hub.rotation.x = 0.2;
    for (const ox of [-0.23, -0.08, 0.08, 0.23]) {
      const s1 = tboxF(hr, { w0: 0.10, d0: 0.11, w1: 0.08, d1: 0.09, h: 0.38 }, ox, -0.28, 0.24, FACE, { metalness: 0.65 });
      s1.rotation.x = Math.PI / 2 + 0.3;
      const s2 = tboxF(hr, { w0: 0.08, d0: 0.09, w1: 0.034, d1: 0.034, h: 0.35, sz: 0.05 }, ox, -0.51, 0.38, FACE, { metalness: 0.65 });
      s2.rotation.x = Math.PI / 2 + 0.95;
    }
    // ── 右肩三管霰彈(輕;gunPitch 俯仰,肩扛 = weap 'N' + gunR)—— 武裝全硬邊 ──
    const sy = c.dims.shoulderYl;
    tboxF(F.chest, { w0: 0.30, d0: 0.44, w1: 0.24, d1: 0.36, h: 0.46 }, 0.80, sy + 0.34, -0.26, PAL.deep, { metalness: 0.7 });   // 肩架支柱(拉高越過斜方肌稜:c1/c2 實測肩砲被肉埋掉)(生根肩背甲)
    const gun = new THREE.Group();
    gun.position.set(0.80, sy + 0.66, -0.22);
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
    tboxF(F.chest, { w0: 0.30, d0: 0.44, w1: 0.24, d1: 0.36, h: 0.46 }, -0.80, sy + 0.34, -0.26, PAL.deep, { metalness: 0.7 });
    const vent = new THREE.Group();
    vent.position.set(-0.80, sy + 0.64, -0.24);
    vent.rotation.set(1.50, 0, 0.06);
    F.chest.add(vent);
    // 機匣 + 電漿喇叭(latheF 階狀外擴)+ 磁約束光核 + 同軸燃料罐(latheF 膠囊,後掛)
    tboxF(vent, { w0: 0.34, d0: 0.40, w1: 0.28, d1: 0.34, h: 0.50 }, 0, -0.28, -0.02, COAL, { metalness: 0.75 });
    latheF(vent, [[0.10, 0], [0.15, 0.10], [0.12, 0.22], [0.17, 0.34], [0.16, 0.42]], 10, 0, 0.05, 0, GUNMETAL, { metalness: 0.85 });
    const hMuz = sphF(vent, 0.08, 0, 0.48, 0, accent, { emissive: accent, emissiveIntensity: 1.6 });
    const tank = latheF(vent, [[0.0001, -0.30], [0.10, -0.26], [0.13, -0.12], [0.13, 0.12], [0.10, 0.26], [0.0001, 0.30]], 10, 0, -0.78, -0.02, dimF(accent, 0.75), { emissive: accent, emissiveIntensity: 0.4 });
    // 輸送管(cablesF 自液壓泵背包跨到左肩噴口,各自成件)
    cablesF(F.chest, { p0: [-0.42, sy - 0.75, -0.76], p1: [-0.78, sy + 0.50, -0.28], k: 3, r: 0.028, sag: 0.05, spread: 0.05 }, IRON, { metalness: 0.75 });
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
