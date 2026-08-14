// ============ s12 逐機零件檔(航空機體;dev-only)============
// s12「星圖」鴨翼長航偵察機(fixed / wing:'canard'):楔形機身 + 前鴨翼 + 後掠主翼 + 星象儀窗
// 2D 定案圖:public/assets/cyberpunk_art/mechs/s12_static.png(/ _moving / _heavy)
//
// ── 2026-08-13 使用者定案:「**放棄新版建模,採用舊版建模直接補強細節**」──────────────
// 「舊版」= 遊戲本體 public/js/models.js buildFixedWing() 的 `W === 'canard'` 分支
// (:922–:974)加上它前面的共用機身區塊(:787–:806)。使用者判定舊版比原本這一檔的
// 「大楔盒 + 兩片薄翼 + 一面大圓盤」讀起來好 —— 病因是**細節密度**:舊版那一支上有
// 二十幾個機能零件(進氣道/摺疊鉸線/電戰吊艙/頰板/LERX/刀天線/方向舵/花瓣裙),
// 每一個都在說「這台機在幹嘛」;新版把它們全省掉,只剩剪影。
// ⇒ 本檔 = 把舊版那份**佈局清單**整批搬進來,逐件升級成多面體語彙(SKILL §2):
//     機身    → tboxF 楔台三段串接(前尖 / 中厚 / 後收;楔形是這台的識別點,
//               舊版是 CapsuleGeometry 流線莢艙 —— 那與 body 'wedge' 的設定相反)
//     主翼/鴨翼 → wingF(有翼型剖面:弦長收分 + 後掠 + 上反 + 扭轉,不是薄板)
//     垂尾/舵/頰板/LERX/翼尖小翼 → prismF(擠出多邊形)
//     進氣唇/噴口/花瓣裙/線圈環/吊艙/星象儀環 → latheF
//     刀天線/格柵條/識別帶/鉸線 → bxF(小零件才准用盒)
//   舊版沒有的只補一件:2D 圖上那具**大面積發光座艙罩**(舊版是一條 accent 識別條)。
//
// ── 唯一保留的「新版比舊版強」的地方(MUST NOT 為了抄舊版而拆掉)──────────────────
// 設計權威 = mecha.js gen.sil:「楔形機身前段長出一對小鴨翼,主翼後掠;機背上一具向上
// 開口的星象儀窗,是全機唯一朝天的東西。」
// gen.note:「星象儀窗 MUST 朝正上方且無遮擋 —— 這台機的鴨翼就是為了保住那個視軸才存在的。」
//   ⇒ 機背中段以 (x=0, z=SIGHT_Z) 為心、半徑 RSIGHT 的圓內**任何零件不得侵入**。
//   舊版的背脊電戰刀片天線陣(models.js:965,z = 0.55 / 0.15 / −0.25)有兩片正落在視軸上,
//   **MUST NOT 直接抄過來** —— 本檔整批後移到散熱格柵之後、垂尾之前(z ≤ −0.64),
//   前方那一格讓給座艙罩(z ≥ 0.30)。視軸圓 [−0.44, +0.24] 之間只有星象儀窗自己。
//
// 座標慣例:+z = 機首、−z = 機尾、+y = 上。tboxF 一律 rotation.x = +π/2
//   ⇒ 幾何 +y → 世界 +z(機首方向),幾何 +z → 世界 −y(所以 d 是「機身高」、
//   sz 是「頂面往下沉多少」= 機鼻下傾量)。⚠ 負號寫反的下場是機身前後顛倒而不報錯。
import {
  bxF, cylF, sphF, tboxF, prismF, latheF, wingF, jetF, gunPodF, dimF,
  GUNMETAL, COAL,
} from '../geo.js';

const RSIGHT = 0.34;          // 星象儀視軸淨空半徑(任何零件不得侵入)
const SIGHT_Z = -0.10;        // 視軸圓心(機背中段)⇒ 淨空帶 z ∈ [−0.44, +0.24]

/**
 * 左右鏡射一件「翼根不在中線」的翼面/板件(2026-08-14 使用者:「有一邊機翼看起來比較短」)。
 *
 * 病灶:`scale.x = sx` **只鏡射子樹的幾何,不鏡射自己的 position** —— wingF/prismF 的翼面
 * 在局部 +x 方向長出去,而翼根 x = ROOT 是**位置**。右翼因此跨 [ROOT, ROOT+span],
 * 左翼卻跨 [ROOT, ROOT−span] = **離中線只有 span − ROOT**,兩邊差整整 2×ROOT
 * (主翼 ROOT 0.26 ⇒ 左 1.19 / 右 1.71,差 30%;鴨翼 ROOT 0.18 ⇒ 左 0.40 / 右 0.76,差 47%)。
 * 而**掛載件全部寫 `sx * 絕對 x`**(鉸線 0.91、光口 0.72、吊艙 1.52、翼尖燈 1.67)⇒ 左側
 * 那幾件有一半浮在翼面之外。正面視角看不出來(兩邊都有翼),只有俯視/斜俯視才讀得到。
 *
 * ⇒ 位置與幾何 MUST 一起鏡射。凡「翼根 x ≠ 0 且以 scale.x 鏡射」的件一律走這一支,
 *   MUST NOT 在呼叫端各自補一次 `position.x = sx * …`(補漏一件就是同一個 bug 的第二份)。
 */
function mirrorX(o, sx) {
  o.scale.x = sx;
  o.position.x *= sx;
  return o;
}

export default {
  label: '星圖(s12 鴨翼長航偵察機)', hue: 0x9db0d8, kind: 'air', height: 3.6,
  air: { tiltY: 1.3, bob: 0.03, top: 32, level: true, span: 3.4 },
  moveSig: { hover: 0.50, hoverF: 1.6, hoverA: 0.05, surge: 0.80, flare: 0, bank: 0.92 },
  castSig: { omni: 'spin', dir: 'lunge' },
  doc: [
    ['楔形機身', '楔台三段串接(前尖 / 中厚 / 後收;tbox)+ 楔形頰板 chine + LERX 前緣延伸'],
    ['發光座艙罩', '罩框楔台 + 內嵌發光罩體(2D 圖上最大的一塊藍)'],
    ['前鴨翼 ×2', 'wingF 小翼面(展約主翼 1/3、力臂長)+ 前緣配平槽'],
    ['後掠主翼 ×2', 'wingF 大後掠 + 筒射摺疊翼鉸線 + 鉸鏈筒 + 翼尖下折小翼 + 翼面識別帶'],
    ['翼面發光口 ×2', '沉頭環座(lathe)+ 發光盤(2D 圖上主翼那兩枚圓形光口)'],
    ['翼尖電戰吊艙 ×2', '吊艙筒(lathe)+ 波束指向端帽 + 干擾線圈環 ×2 + 左紅右綠航行燈'],
    ['側進氣道 ×2', '進氣唇環(lathe)+ 暗色開口 + 附面層分離板'],
    ['星象儀窗', '機背中段朝天圓窗(lathe 環座 + 玻璃盤 + 遮光環)—— 視軸圓內淨空'],
    ['電戰天線farm', '背脊刀片天線 ×3 + 通訊鞭天線 + 腹側收發分置刀天線 ×2(全部避開視軸圓)'],
    ['散熱格柵', '格柵框 + 導流條 ×3(機背;排在視軸圓之後)'],
    ['單垂尾', '後掠垂尾(prism)+ 方向舵分板 + 頂端識別燈'],
    ['尾噴口', '收擴噴口(lathe)+ 花瓣裙 ×8 + 焰環 + 噴射尾焰(jetF)'],
    ['長航油箱艙', '機腹保形油箱 ×2(lathe)+ 加油口 + 下顎感測球 + 空速管'],
  ],

  body(c, t) {
    const { PAL, accent, dark } = c;
    const M = { metalness: 0.6 };

    // ── ① 楔形機身:三段楔台串接(舊版是 Capsule 流線莢艙;楔形才是 body 'wedge')──
    // 中段(最厚:座艙 + 星象儀 + 主翼根)
    tboxF(t, { w0: 0.66, d0: 0.44, w1: 0.58, d1: 0.36, h: 0.80, sz: 0.02 },
      0, 0, 0.05, PAL.main, M).rotation.x = Math.PI / 2;
    // 前段(收成機鼻;sz = 鼻尖下傾)
    tboxF(t, { w0: 0.58, d0: 0.36, w1: 0.14, d1: 0.10, h: 0.90, sz: 0.075 },
      0, 0, 0.90, PAL.main, M).rotation.x = Math.PI / 2;
    // 後段(往尾錐收;鏡射前段的收分節奏)
    tboxF(t, { w0: 0.30, d0: 0.28, w1: 0.66, d1: 0.44, h: 0.90, sz: -0.01 },
      0, 0, -0.80, PAL.mid, M).rotation.x = Math.PI / 2;

    // ── ② 楔形頰板 chine + LERX 前緣延伸(舊版 :951/:953 那兩片,改成擠出多邊形)──
    // 平面形狀寫在 XY,rotation.x = π/2 把它躺平 ⇒ 多邊形的 y 變成世界 z(前後),
    // 擠出深度變成板厚(上下)。左側以 scale.x 鏡射(three 對負行列式會自動翻正面剔除)。
    for (const sx of [-1, 1]) {
      // ⚠ 頰板的外緣 MUST 在鼻尖收回機身半寬之內 —— 平面形狀的最後一點若還在外側,
      // 那一截就變成鼻尖旁邊兩根懸空的刺(r1 實拍)。
      const chine = prismF(t, [[0, -0.42], [0.20, -0.05], [0.21, 0.26], [0.03, 0.55], [0, 0.55]], 0.05,
        0.06, -0.05, 0.80, PAL.deep, { metalness: 0.7 });
      chine.rotation.x = Math.PI / 2;
      mirrorX(chine, sx);
      const lerx = prismF(t, [[0, -0.55], [0.09, -0.45], [0.03, 0.50], [0, 0.52]], 0.035,
        0.26, 0.10, 0.05, PAL.lite, { metalness: 0.5 });
      lerx.rotation.x = Math.PI / 2;
      mirrorX(lerx, sx);
    }

    // ── ③ 發光座艙罩(2D 定案圖上最大的一塊藍;舊版只有一條 accent 識別條)──
    // 罩框(coaming)壓低、罩體騎在它上面凸出來 —— 兩件同高只會讓玻璃整個埋進框裡看不見。
    tboxF(t, { w0: 0.40, d0: 0.11, w1: 0.17, d1: 0.06, h: 0.74, sz: 0.13 },
      0, 0.15, 0.65, PAL.deep, { metalness: 0.8 }).rotation.x = Math.PI / 2;
    tboxF(t, { w0: 0.32, d0: 0.19, w1: 0.11, d1: 0.08, h: 0.68, sz: 0.13 },
      0, 0.235, 0.65, accent, { emissive: accent, emissiveIntensity: 1.15, transparent: true, opacity: 0.9 })
      .rotation.x = Math.PI / 2;

    // ── ④ 星象儀窗(唯一朝天的東西;視軸圓內只有它自己)──
    // 玻璃做成**淺穹頂**而不是沉在環座裡的平盤:平盤讀起來是一個黑碗(r1 實拍),
    // 而這具窗是「朝天開口」的機能,凸出來才看得出它在看天。
    // 三件的半徑一律由 RSIGHT 導出 —— 窗自己就是那圈淨空要保護的東西,寫死數字的話
    // 改淨空半徑時窗不會跟著走,而「有沒有零件擋到」只有截圖看得出來。
    latheF(t, [[0, 0], [RSIGHT * 0.62, 0.02], [RSIGHT * 0.69, 0.085], [RSIGHT * 0.59, 0.12]], 14,
      0, 0.19, SIGHT_Z, PAL.deep, { metalness: 0.75 });
    latheF(t, [[0, 0], [RSIGHT * 0.29, 0.055], [RSIGHT * 0.485, 0.035], [RSIGHT * 0.545, 0]], 14,
      0, 0.30, SIGHT_Z, accent,
      { emissive: accent, emissiveIntensity: 1.35, transparent: true, opacity: 0.82 });
    latheF(t, [[RSIGHT * 0.545, 0], [RSIGHT * 0.66, 0.012], [RSIGHT * 0.60, 0.055]], 14,
      0, 0.295, SIGHT_Z, COAL, { metalness: 0.85 });

    // ── ⑤ 前鴨翼 ×2(力臂長:掛在機鼻後方)+ 前緣配平槽(舊版 :959)──
    for (const sx of [-1, 1]) {
      // 鴨翼掛在**肩線**(y ≈ 機身頂),頰板掛在**吃水線**(y = −0.05)—— 兩者高度分開,
      // 否則從側面看是同一團(r2 實拍:鴨翼被頰板/LERX 吃掉)。
      const cn = wingF(t, { span: 0.58, c0: 0.46, c1: 0.20, t: 0.07, sweep: 0.20, dihedral: 0.09 },
        0.18, 0.10, 0.84, PAL.lite, M);
      mirrorX(cn, sx);                                                    // 翼根 x = 0.18 ⇒ MUST 連位置一起鏡射
      bxF(t, 0.30, 0.025, 0.05, sx * 0.48, 0.15, 0.95, PAL.deep, { metalness: 0.7 });
    }

    // ── ⑥ 側進氣道 ×2:進氣唇環 + 暗色開口 + 附面層分離板(舊版 :946–:949)──
    for (const sx of [-1, 1]) {
      tboxF(t, { w0: 0.26, d0: 0.26, w1: 0.22, d1: 0.22, h: 0.52 },
        sx * 0.40, -0.13, -0.22, PAL.mid, { metalness: 0.7 }).rotation.x = Math.PI / 2;
      // 唇緣:旋成環(舊版是一塊暗色實心盒 —— 環才讀得出「會呼吸」)
      latheF(t, [[0.085, 0], [0.115, 0.015], [0.115, 0.05], [0.085, 0.065]], 10,
        sx * 0.40, -0.13, 0.05, COAL, { metalness: 0.85 }).rotation.x = -Math.PI / 2;
      bxF(t, 0.10, 0.10, 0.03, sx * 0.40, -0.13, 0.01, COAL, { metalness: 0.9 });
      bxF(t, 0.02, 0.26, 0.30, sx * 0.265, -0.13, -0.10, PAL.deep, { metalness: 0.7 });
    }

    // ── ⑦ 機腹保形油箱 ×2 + 加油口 + 下顎感測球 + 空速管(長航機的本體)──
    for (const sx of [-1, 1])
      latheF(t, [[0, -0.42], [0.085, -0.32], [0.10, 0.20], [0.07, 0.38], [0, 0.44]], 10,
        sx * 0.24, -0.18, 0.32, PAL.mid, { metalness: 0.5 }).rotation.x = Math.PI / 2;
    cylF(t, 0.045, 0.045, 0.035, 8, -0.24, -0.10, 0.68, dark, { metalness: 0.8 });
    sphF(t, 0.10, 0, -0.13, 1.08, COAL, { metalness: 0.6 });
    sphF(t, 0.05, 0, -0.16, 1.16, accent, { emissive: accent, emissiveIntensity: 1.5 });
    const pit = cylF(t, 0.012, 0.016, 0.22, 5, 0, -0.03, 1.44, COAL, { metalness: 0.8 });
    pit.rotation.x = Math.PI / 2;
    pit.userData.noOutline = true;                   // 極細件:反轉外殼比零件本身厚(SKILL §2b)

    // ── ⑧ 散熱格柵(2D 圖上機背那一片;排在視軸圓之後 z ≤ −0.45)──
    bxF(t, 0.30, 0.05, 0.20, 0, 0.20, -0.55, COAL, { metalness: 0.85 });
    for (const zz of [-0.49, -0.55, -0.61])
      bxF(t, 0.25, 0.03, 0.025, 0, 0.225, zz, dimF(accent, 0.55), { metalness: 0.6 });

    // ── ⑨ 電戰天線 farm ── 舊版是背脊三片刀天線,原座標有兩片壓在星象儀視軸上
    //     ⇒ 整批後移到格柵之後、垂尾之前(gen.note 的硬規則;MUST NOT 移回去)。
    for (const zz of [-0.70, -0.79, -0.88])
      bxF(t, 0.02, 0.16, 0.12, 0, 0.24, zz, PAL.dark, { metalness: 0.6 }).rotation.x = -0.55;
    const whip = cylF(t, 0.012, 0.018, 0.45, 5, -0.13, 0.26, -0.72, COAL, { metalness: 0.8 });
    whip.rotation.x = 0.5;
    whip.userData.noOutline = true;
    // 腹側收發分置刀天線 ×2(與背脊那排成上下對;舊版 :956)
    for (const [zz, yy] of [[-0.55, -0.24], [-0.85, -0.21]])
      bxF(t, 0.018, 0.13, 0.16, 0, yy, zz, PAL.dark, { metalness: 0.6 }).rotation.x = 0.6;

    // ── ⑩ 單垂尾 + 方向舵分板 + 頂端識別燈(舊版 :966–:969)──
    // 多邊形寫在 XY(x = 弦、y = 高),rotation.y = π/2 把 +x 送到 −z ⇒ 正 x 側是後緣。
    const fin = prismF(t, [[-0.22, 0], [0.22, 0], [0.16, 0.58], [0.02, 0.58]], 0.06,
      0, 0.14, -1.18, PAL.lite, { metalness: 0.55 });
    fin.rotation.y = Math.PI / 2;
    const rud = prismF(t, [[-0.08, 0], [0.06, 0], [0.02, 0.46], [-0.05, 0.46]], 0.05,
      0, 0.16, -1.34, dimF(PAL.lite, 0.82), { metalness: 0.5 });
    rud.rotation.y = Math.PI / 2;
    bxF(t, 0.062, 0.09, 0.20, 0, 0.75, -1.22, accent, { emissive: accent, emissiveIntensity: 0.9 });
  },

  lift(c, t) {
    const { PAL, accent } = c;
    // ── 後掠主翼 ×2(翼根靠後,重心恰在主翼前緣後方)──
    // ⚠ 翼上每一件掛載的座標都是 (ROOT_X, ROOT_Y, ROOT_Z, SPAN, SWEEP, DIHEDRAL) 的函數:
    // 改後掠角 MUST 連鉸線/識別帶/光口/小翼/吊艙/航行燈/掛架**整組重算**,
    // 手改其中一個的下場是那幾件浮在翼面之外(而正面視角剛好看不出來)。
    const ROOT_X = 0.26, ROOT_Y = -0.02, ROOT_Z = -0.30;
    const SPAN = 1.45, SWEEP = 0.92, DIH = 0.07, C0 = 0.95, C1 = 0.30, TH = 0.11;
    const wu = (x) => (x - ROOT_X) / SPAN;                                  // 翼展參數 0~1
    const wz = (u) => ROOT_Z - SWEEP * u;                                   // 該站位的弦中點
    const wy = (u) => ROOT_Y + DIH * u;                                     // 該站位的弦線高
    const wc = (u) => C0 + (C1 - C0) * u;                                   // 該站位的弦長
    const wtop = (u) => wy(u) + 0.5 * TH * (1 - 0.55 * u);                  // 上表面
    for (const sx of [-1, 1]) {
      const w = wingF(t, { span: SPAN, c0: C0, c1: C1, t: TH, sweep: SWEEP, dihedral: DIH, twist: -0.05 },
        ROOT_X, ROOT_Y, ROOT_Z, PAL.main, { metalness: 0.58 });
      mirrorX(w, sx);                                                     // 翼根 x = ROOT_X ⇒ 位置也要鏡射(否則左翼短 2×ROOT_X)

      // 筒射摺疊翼鉸線 + 鉸鏈筒(Harop 是筒射遊蕩彈,翼中段的摺疊鉸線是原型第一識別)
      const uh = wu(0.91);
      bxF(t, 0.05, 0.10, wc(uh), sx * 0.91, wy(uh), wz(uh), PAL.deep, { metalness: 0.8 });
      cylF(t, 0.038, 0.038, 0.10, 8, sx * 0.91, wy(uh), wz(uh) + wc(uh) / 2, PAL.deep, { metalness: 0.8 })
        .rotation.x = Math.PI / 2;

      // 翼面識別帶 + 翼面圓形發光口(2D 圖上主翼那兩枚圓光口)
      const ub = wu(1.02), ug = wu(0.72);
      bxF(t, 0.46, 0.02, 0.28, sx * 1.02, wtop(ub) - 0.006, wz(ub), dimF(accent, 0.8), { metalness: 0.5 });
      latheF(t, [[0.10, 0], [0.12, 0.015], [0.09, 0.04]], 12, sx * 0.72, wtop(ug) - 0.02, wz(ug),
        PAL.deep, { metalness: 0.8 });
      cylF(t, 0.072, 0.072, 0.02, 12, sx * 0.72, wtop(ug) + 0.01, wz(ug), accent,
        { emissive: accent, emissiveIntensity: 1.3 });

      // Harop 式翼尖下折小翼(左右同向:rotation.y 已把弦送到 z,不需鏡射)
      const uw = wu(1.66);
      const wl = prismF(t, [[-0.04, -0.26], [0.10, -0.26], [0.14, 0], [-0.14, 0]], 0.05,
        sx * 1.66, wy(uw) + 0.02, wz(uw), PAL.mid, { metalness: 0.6 });
      wl.rotation.y = Math.PI / 2;

      // 翼尖電戰吊艙:艙筒 + 波束指向端帽 + 干擾線圈環 ×2(急轉時維持指向的耳朵)
      // 艙筒尾端 MUST 蓋過該站位的後緣(pz 起點取弦中點 − 弦長/3),否則從正後方看
      // 吊艙與翼面之間會裂開一道縫(r3 實拍)。
      const up = wu(1.52), pz = wz(up) - wc(up) / 3;
      latheF(t, [[0, 0], [0.055, 0.06], [0.068, 0.34], [0.05, 0.50], [0, 0.54]], 10,
        sx * 1.52, wy(up) + 0.03, pz, PAL.dark, { metalness: 0.7 }).rotation.x = Math.PI / 2;
      sphF(t, 0.05, sx * 1.52, wy(up) + 0.03, pz + 0.56, accent, { emissive: accent, emissiveIntensity: 1.0 });
      for (const dz of [0.18, 0.38])
        cylF(t, 0.088, 0.088, 0.025, 10, sx * 1.52, wy(up) + 0.03, pz + dz, dimF(accent, 0.7), { metalness: 0.7 })
          .rotation.x = Math.PI / 2;

      // 翼尖航行燈(左紅右綠:壓坡時姿態一目了然)
      const ut = wu(1.67);
      bxF(t, 0.13, 0.05, 0.17, sx * 1.67, wy(ut) + 0.02, wz(ut) - 0.04,
        sx < 0 ? 0xff5544 : 0x55ff88,
        { emissive: sx < 0 ? 0xff3322 : 0x22ff66, emissiveIntensity: 1.6 });
    }

    // ── 尾噴口(canard 依 models.js FIXED 表是 jet 機種:畫尾噴、不畫槳)──
    // 旋成體 profile 的 +y 端 = 噴口出口 ⇒ rotation.x = −π/2 把 +y 送到 −z(朝機尾)。
    latheF(t, [[0.155, 0], [0.175, 0.08], [0.135, 0.22], [0.155, 0.32]], 12, 0, 0, -1.22,
      GUNMETAL, { metalness: 0.9 }).rotation.x = -Math.PI / 2;
    // 花瓣裙 ×8(外擴讀成可調噴口;逐片一顆零件,角度是索引函數 = 零亂數)
    for (let i = 0; i < 8; i++) {
      const a = i * Math.PI * 2 / 8;
      const p = tboxF(t, { w0: 0.13, d0: 0.16, w1: 0.10, d1: 0.14, h: 0.05 },
        -Math.sin(a) * 0.175, Math.cos(a) * 0.175, -1.48, COAL, { metalness: 0.85 });
      p.rotation.z = a;
    }
    const ring = cylF(t, 0.135, 0.135, 0.04, 12, 0, 0, -1.57, accent,
      { emissive: accent, emissiveIntensity: 1.6 });
    ring.rotation.x = Math.PI / 2;
    const fl = jetF(t, 0.12, 1.3, 0, 0, -1.60, accent);
    fl.g.rotation.x = Math.PI / 2;                    // 焰流局部 −y → 世界 −z(向後噴)
    return { jets: [fl] };
  },

  mount(c, F) {
    const { accent, K, dark } = c;
    const t = F.tilt;
    // 翼下掛莢(左輕右重);MUST 掛在機腹/翼下,MUST NOT 上機背(星象儀視軸)
    // 掛架 z = 主翼在 x = ±0.62 那一站的弦中點(lift() 的 ROOT_Z − SWEEP·u;改後掠角要同步)
    for (const sx of [-1, 1]) bxF(t, 0.09, 0.10, 0.30, sx * 0.62, -0.08, -0.53, dark, { metalness: 0.75 });
    const lp = gunPodF(t, { len: 0.82 * K.barrelF, r: 0.10, accent }, -0.62, -0.21, -0.48, dark, { metalness: 0.75 });
    const hp = gunPodF(t, { len: 1.0 * K.barrelF, r: 0.13, accent }, 0.62, -0.21, -0.52, dark, { metalness: 0.75 });
    return {
      muzzles: { light: { n: lp.muz, r: 0.05 }, heavy: { n: hp.muz, r: 0.08 } },
      lightGlowM: [lp.muz], heavyGlowM: [hp.muz],
      weap: { light: 'N', heavy: 'N' }, hvy: { chest: 0.04 },
      wpn: { light: { nodes: [lp.g], ref: lp.g, muz: lp.muz, fwd: 'z' },
        heavy: { nodes: [hp.g], ref: hp.g, muz: hp.muz, fwd: 'z' } },
    };
  },
};
