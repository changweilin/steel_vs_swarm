// ============ s01 逐機零件檔(航空機體;dev-only)============
// s01「第聶伯總譜」—— **主體是大黃蜂**(2026-08-13 使用者定案:
//   「蜂后:放棄新版建模,根據真實照片重製,主體是大黃蜂」)。
//
// ⚠ 2026-08-13 使用者第二輪定案(**覆蓋本檔前一版的三段設計**):
//   「**蜂后移除旋翼,完全靠翅膀飛行,武器裝備在六隻腳上**」⇒ 三件事一起換:
//   ⓐ 六具末端旋翼(rotorF)整批退場,`lift()` 不再回傳 `spin` 名冊(g.userData.spin 恆空);
//   ⓑ 膜翅由「停棲合攏的靜態裝飾」升格成**唯一的升力系統** —— `air.insect = true`
//      ⇒ locomotion.js stepAerial 走昆蟲震翅分支(高頻、行程平面近水平、前後掃掠 +
//      每半衝程翼面翻轉的 8 字軌跡),四片翅全部進 `rig.wings`;
//   ⓒ 武裝自「腹前小莢 + 腹末螫針」搬到**六隻腳**:前四足各一具小莢 = 輕武器組,
//      後兩足各一具大莢 = 重武器組。
//
//   ⓓ **具名偏離**:`mecha.js` 的 gen.note 寫著「螫針是砲管不是裝飾 —— MUST 從艙體尾端
//      連續長出來、有膛口制退器」。使用者這一輪把武器移到六足 ⇒ 兩句話直接衝突,
//      **以使用者這一句為準**(2026-08-13):螫針的**幾何全部保留**(腹末收錐本來就該收成針,
//      它是蜂的識別剪影,含節環/等距橫振子/膛口制退器),但它**不再是武器節點** ——
//      `wpn.heavy` / `muzzles.heavy` / `heavyGlowM` 全部改指六足的後兩具莢。
//      針尖那顆 accent 燈保留為中繼天線的識別燈,不進任何 GlowM 名冊。
//
// 設計權威(依序):
//   ① 真實照片 tools/proto_refs/s01/bionic/user_s01_bionic_1.png(胡蜂側視,黃黑節腹)
//      與 user_s01_bionic_2.jpg(大虎頭蜂側視,橘頭黑胸)—— 照片來的東西:
//      腎形大複眼幾乎佔滿頭側、膝狀觸角(柄節前上 / 鞭節前下彎,側視最顯眼的識別點)、
//      頭頂三顆單眼、胸背絨毛、**明顯收細的腰(petiole)**、腹部逐節重疊環與橫紋、
//      **足為三節(腿節/脛節/跗節)、膝是整條腿的最高點、脛節與跗節細長往下垂**、
//      **前翅幾乎與體長等長**(停棲時才疊在腹背上,飛行時是向兩側展開的大升力面)。
//   ② 2D 定案圖 public/assets/cyberpunk_art/mechs/s01_static.png(/ _moving / _heavy)——
//      圖上是四片發光脈翅(**翅脈的網格清楚可見**)+ 橘色分節長身 + 尾端一根帶等距橫振子的
//      細長螫針。圖上那六具旋翼即本輪退場的東西。
//
// 刻意不做 / 刻意這樣做:
//   ・**橫紋是逐節換色的幾何不是貼圖**:每節腹身橘(PAL.mid)+ 節後緣暗環(COAL/HIVE 交替)。
//   ・前一版的「四支長短不一中繼天線叢」退場:中繼天線就是螫針上那排橫振子,
//     頭前那兩根細長物是**觸角**。
//   ・起落腳架併進足(每足末端一對爪),不另做四柱橇架。
//   ・主體用 PAL.mid(橘)不用 PAL.main —— main 在這個 hue 讀起來是灰白奶油色,不是虎頭蜂。
//   ・**六足在 body() 裡建、莢在 mount() 裡掛**:足是身體、莢是武裝(mount 的契約),
//     兩者靠 `c.legPods`(baseCtx 是三個 builder 共用的同一個物件,同 c.binderPivots 的慣例)
//     交接 —— body 交出**已抵銷旋轉的掛點**,mount 只負責掛莢與回傳武器欄位。
//
// 五輪截圖閉環量出來、寫進數值裡的事(改動前先看,不然會再踩一次):
//   ⑴ **比例**:腹全長 ≈ 胸的兩倍且一路收錐(六節共 1.42、半徑 0.26→0.08),胸的 d0 壓到 0.74。
//   ⑵ **描邊寬 ≈ 0.054(outlineWF(3.4))**:對 r≈0.02 的觸角是三倍粗 ⇒ 觸角全段 noOutline
//      (§2b 細件條款);翅脈同理;翅膜是 transparent,outlinify 本來就跳過。
//   ⑶ **同一個色階不能鋪滿全身**:依照片分三段「亮頭 / 暗胸(PAL.dark,只留亮領 + 背板 +
//      小盾片 + 絨毛)/ 橫紋腹」。
//   ⑷ **昆蟲分支每幀覆寫 `w.rotation` 的 x/y/z 三軸與 `outer.rotation.z`**(locomotion.js:649)
//      ⇒ 靜態的**上反 / 安裝迎角 / 後掠 MUST 住 `w` 底下的子 Group `base`(與 `outer` 底下的
//      `tip`)**,MUST NOT 寫在 `w` / `outer` 自己身上 —— 寫了會被逐幀抹掉,而**靜止那一幀
//      看起來還是對的**(定裝照全綠、只有 run 那張是塊板子)。同 geo.js finF 檔頭紀律 ③ 的
//      「兩個角 MUST 拆兩層 Group」是同一族病灶。
//   ⑸ **翅的展向 MUST 是局部 ±x**:昆蟲分支的三軸各有語意 —— z 拍、y 掃、x 翻,
//      只有沿 x 伸長的翅面吃得到這三個語意(繞 z 轉才是「拍」)。
import * as THREE from 'three';
import {
  bxF, cylF, sphF, coneF, tboxF, prismF, latheF, finF, gunPodF,
  IRON, GUNMETAL, COAL,
} from '../geo.js';

const HIVE = 0x2a2622;        // 蜂腹暗節色(黑褐)
const WING = 0x8fd2f5;        // 膜翅(半透明藍)
const VEIN = 0x2b6d92;        // 翅脈

// 腹末錐尖的 z(body 內部唯一接點:螫針 MUST 自這裡**連續**長出來)
const STING_Z = -1.90;

// 六足的生根位置 / 根部偏航 / 尺寸係數(前足朝前、後足朝後且最長 —— 照片的姿態)
// ⚠ 三對足的生根 z **全部 MUST 落在胸的足跡內**(胸體 z ∈ [−0.11, 0.63]):
// r2 實測後足生根在 −0.14 = 已經退到細腰上方 ⇒ 背視角看到兩顆**浮在空中的基節方塊**
// (足本身接得好好的,只有那一節懸空,而正/側視角剛好被胸擋住看不出來)。
const LEG_Z = [0.46, 0.20, -0.02];
const LEG_TH = [-0.62, -0.05, 0.66];
const LEG_S = [0.92, 1.00, 1.18];
// 三節的相對折角(累積 = 膝在最高點、脛跗往下垂):腿節上抬 → 脛節下折 → 跗節續下
const F_ROT = [0.34, -1.15, -0.10];
const F_LEN = [0.40, 0.46, 0.40];

/** 膝狀觸角(照片來的識別點):柄節前上 → 膝 → 鞭節五節前下彎。原點 = 頭前的觸角窩。 */
function antenna(head, sx, accent) {
  const a0 = new THREE.Group();
  a0.position.set(sx * 0.19, 0.06, 0.14);
  a0.rotation.y = sx * 0.52;                 // 向外岔開(不從正面交叉)
  a0.rotation.x = Math.PI / 2 - 0.52;        // 局部 +y → 機首前上方
  head.add(a0);
  // ⚠ 描邊外殼寬 = outlineWF(3.4) ≈ 0.054 —— 對 r≈0.02 的細桿是**三倍粗**,
  // 觸角會讀成兩根黑砲管(2026-08-13 r2 實測)⇒ 觸角全段 noOutline(§2b 的細件條款)。
  cylF(a0, 0.019, 0.026, 0.26, 6, 0, 0.13, 0, COAL, { metalness: 0.8 })       // 柄節
    .userData.noOutline = true;
  const knee = new THREE.Group();
  knee.position.y = 0.26;
  knee.rotation.x = 0.85;                    // 膝(這個折角就是「膝狀」)
  a0.add(knee);
  sphF(knee, 0.032, 0, 0, 0, IRON, { metalness: 0.85 });
  let cur = knee;
  for (let i = 0; i < 5; i++) {              // 鞭節:逐節下彎收細(零亂數,索引遞變)
    const s = new THREE.Group();
    s.position.y = i === 0 ? 0 : 0.12;
    s.rotation.x = 0.10;
    cur.add(s);
    cylF(s, 0.013 - i * 0.0016, 0.018 - i * 0.0016, 0.125, 6, 0, 0.062, 0, i % 2 ? HIVE : COAL,
      { metalness: 0.75 }).userData.noOutline = true;
    cur = s;
  }
  const tip = sphF(cur, 0.020, 0, 0.13, 0, accent, { emissive: accent, emissiveIntensity: 1.4 });
  tip.userData.noOutline = true;             // 極細件:描邊殼會糊成黑點(§2b)
}

/** 腎形大複眼:外緣一路包到頭側,內緣凹進 —— 外殼 COAL,面板 accent 自發光(2D 的感測格)。 */
function eyePts(sx, k, ky = k) {
  const p = [
    [0.12, -0.24], [0.28, -0.23], [0.36, -0.02], [0.34, 0.16],
    [0.22, 0.28], [0.13, 0.26], [0.22, 0.08], [0.20, -0.10],
  ].map(([x, y]) => [x * k * sx, y * ky]);
  return sx > 0 ? p : p.slice().reverse();   // 鏡射後反轉繞向(維持逆時針)
}

// ───────── 膜翅(升力系統)─────────
// 翅面座標契約:局部 **+x = 展向**(外);多邊形在 XY 平面、mesh 自轉 −π/2 躺平後
// 多邊形 +y → 局部 **−z(機尾)= 後緣**,−y → +z(機首)= 前緣。厚度落在 y。

const L_CROSS = 0.016;                            // 橫脈的展向寬(細)

// 弦長 C(u):線性收分 **× 中段鼓起**(sin 在 u=0/1 恆 0 ⇒ 根弦與梢弦不受影響)——
// 純線性收分的梢部是被切平的方頭(r1 實測:正面讀成兩支藍角),蜂翅是中段最寬、梢部收尖。
const chordAt = (P) => (u) => (P.ch0 + (P.ch1 - P.ch0) * u) * (1 + 0.16 * Math.sin(Math.PI * Math.pow(u, 0.75)));
const bendAt = (P) => (u) => P.bend * Math.pow(u, 1.4);   // 外側逐漸後掠(蜂翅的鐮刀形)

/** 一段翅面的外廓:u0→u1 的展向區間,弦長/後掠由整片翅共用的 P 決定 ⇒
 *  內段梢部與外段根部**共用同一組弦長**,接縫不會錯開。uOrg = 這一段的原點展向位置。 */
function panelPts(P, u0, u1, uOrg) {
  const { len, lead } = P;
  const C = chordAt(P), B = bendAt(P);
  const N = 4;
  const at = (i) => u0 + (u1 - u0) * i / N;
  const pts = [];
  for (let i = 0; i <= N; i++) { const u = at(i); pts.push([(u - uOrg) * len, B(u) - lead * C(u)]); }
  for (let i = N; i >= 0; i--) { const u = at(i); pts.push([(u - uOrg) * len, B(u) + (1 - lead) * C(u)]); }
  return pts;
}

/** 翅膜 + 翅脈(一段)。膜是半透明薄稜柱,脈是逐條收攏的細長條(索引遞變,零亂數)。 */
function panel(parent, sx, P, u0, u1, uOrg, veins) {
  const { len, lead } = P;
  const C = chordAt(P), B = bendAt(P);
  const q = panelPts(P, u0, u1, uOrg).map(([px, py]) => [sx * px, py]);
  const m = prismF(parent, sx > 0 ? q : q.slice().reverse(), 0.022, 0, 0, 0, WING,
    { transparent: true, opacity: 0.46, metalness: 0.15 });
  m.rotation.x = -Math.PI / 2;                    // 多邊形平面躺平成翅面(+y → −z 後緣)
  const xr = (u0 - uOrg) * len, xt = (u1 - uOrg) * len;
  for (let j = 0; j < veins; j++) {
    const f = veins === 1 ? 0 : j / (veins - 1);  // 0 = 前緣縱脈(最粗)→ 1 = 後緣
    const zr = -(B(u0) + (f - lead) * C(u0));
    const zt = -(B(u1) + (f - lead) * C(u1));
    const L = Math.hypot(xt - xr, zt - zr);
    const th = j === 0 ? 0.026 : 0.016;           // 前緣脈(costa)明顯較粗
    const v = bxF(parent, L, th, th * 0.9, sx * (xr + xt) / 2, 0.012, (zr + zt) / 2, VEIN,
      { metalness: 0.45 });
    // 沿 +x 的長條轉到 (Δx, Δz):繞 y 轉 φ 把 +x 送到 (cosφ, 0, −sinφ) ⇒ φ = −atan2(Δz, Δx);
    // 鏡射側整條方向是 (−Δx, Δz),而長方體對 y 軸轉 π 恆等 ⇒ 直接取號 −sx。
    v.rotation.y = -sx * Math.atan2(zt - zr, xt - xr);
    v.userData.noOutline = true;                  // 細件:描邊殼比零件本身還粗(§2b)
  }
  const um = (u0 + u1) / 2;                       // 橫脈(翅室的橫向格)
  const cv = bxF(parent, L_CROSS, 0.014, C(um) * 0.86, sx * (xr + xt) / 2, 0.012, -B(um) - (0.5 - lead) * C(um),
    VEIN, { metalness: 0.45 });
  cv.userData.noOutline = true;
  return m;
}

/** 一片膜翅 = 翅根樞軸 w(⚠ 每幀被覆寫,MUST 無靜態角)+ 靜態安裝角 base
 *  + 內段翅面 + 外段樞軸 outer(⚠ 覆寫 rotation.z)+ 靜態 tip + 外段翅面。 */
function wing(t, c, sx, spec) {
  const { PAL } = c;
  const { x, y, z, dih, inc, sweep, split, veins, pair } = spec;
  const P = spec.P;
  const w = new THREE.Group();                    // ← stepAerial 每幀寫 x/y/z 三軸
  w.position.set(sx * x, y, z);
  t.add(w);
  const base = new THREE.Group();                 // ← 靜態安裝角只准住這一層(⑷)
  base.rotation.set(inc, -sx * sweep, sx * dih);
  w.add(base);
  // 翅基片(腋片)+ 鉸接軸:翅根與胸背之間看得出是「裝上去的關節」
  const ax = cylF(base, 0.055, 0.075, 0.14, 8, sx * 0.045, 0, 0, PAL.dark, { metalness: 0.85 });
  ax.rotation.z = Math.PI / 2;
  tboxF(base, { w0: 0.20, d0: P.ch0 * 0.92, w1: 0.13, d1: P.ch0 * 0.7, h: 0.05 },
    sx * 0.16, 0.01, -P.bend * 0.1, PAL.mid, { metalness: 0.7 });
  panel(base, sx, P, 0, split, 0, veins);
  const outer = new THREE.Group();                // ← stepAerial 每幀寫 rotation.z
  outer.position.x = sx * split * P.len;
  base.add(outer);
  const tip = new THREE.Group();                  // ← 外段的靜態後掠/上反住這一層(⑷)
  tip.rotation.y = -sx * 0.05;
  tip.rotation.z = sx * 0.03;                     // 內外段接縫的靜態折角要小 —— 逐幀的鞭式延遲

  outer.add(tip);
  panel(tip, sx, P, split, 1, split, veins);
  return pair ? { w, outer, sgn: sx, pair: true } : { w, outer, sgn: sx };
}

// ───────── 六足(蜂足:腿節/脛節/跗節 + 關節環 + 末端爪)─────────

/** 一隻蜂足。回傳武器掛點 —— **已抵銷根部偏航與三節累積折角** ⇒ 掛點的局部 +z = 機首正前方,
 *  gunPodF 的 `fwd:'z'` 契約才對得上(莢一律沿 +z 朝前)。
 *  兩層 Group 的理由:總轉置 = Ry(θ0)·Rz(A),其逆 = Rz(−A)·Ry(−θ0),而 three 的尤拉序
 *  'XYZ' 給的是 Rx·Ry·Rz(Rz 最先作用)⇒ **一顆 Group 湊不出這個順序**,MUST 拆兩層。 */
function beeLeg(t, c, i, sx) {
  const { PAL } = c;
  const S = LEG_S[i];
  const g0 = new THREE.Group();
  g0.position.set(sx * 0.40, -0.10, LEG_Z[i]);
  const th0 = sx > 0 ? LEG_TH[i] : Math.PI - LEG_TH[i];
  g0.rotation.y = th0;
  t.add(g0);
  // 基節(髖甲):貼在胸側的收分甲
  const cox = tboxF(g0, { w0: 0.17, d0: 0.19, w1: 0.13, d1: 0.15, h: 0.15 }, 0.06, 0, 0, PAL.dark, { metalness: 0.7 });
  cox.rotation.z = -Math.PI / 2;
  cylF(g0, 0.062, 0.062, 0.10, 8, 0.13, 0, 0, COAL, { metalness: 0.85 }).rotation.x = Math.PI / 2;  // 轉節軸環
  const seg = (parent, x, rot, len, w, d, color) => {
    const g = new THREE.Group();
    g.position.x = x;
    g.rotation.z = rot;
    parent.add(g);
    const m = tboxF(g, { w0: w, d0: d, w1: w * 0.74, d1: d * 0.76, h: len }, len / 2, 0, 0, color, { metalness: 0.7 });
    m.rotation.z = -Math.PI / 2;
    return g;
  };
  const L1 = F_LEN[0] * S, L2 = F_LEN[1] * S, L3 = F_LEN[2] * S;
  // 逐節收細**且逐節變暗**(照片:虎頭蜂的腿節仍是橘的、脛跗一路轉黑褐)。
  // ⚠ **展示台鍵光溢出是取景光不是幾何錯誤,MUST NOT 為它改設計**(技能 §7:板面打光比
  // 2D 定案圖亮,比形不比調)。實測紀錄:側視 45° 那張的中足脛節整支讀成一根**純白**的棒子,
  // 射線實測命中的材質是 PAL.dark(aa9660);把它壓到 PAL.deep(887a56)後**同一顆像素仍是
  // FFFFFE** —— 底色從 (170,150,96) 降到 (136,122,86) 一點都沒救到,證明溢出來自光強而非底色。
  // 下面的四階遞暗(mid → deep → HIVE)因此**是照片的配色**,不是為了修那個白棒;
  // 要再試的話請改板子的光,別再把腿改暗一階(下一階是全黑,六足就從畫面上消失了)。
  const f1 = seg(g0, 0.14, F_ROT[0], L1, 0.105, 0.125, PAL.mid);     // 腿節(往外上;膝是最高點)
  cylF(f1, 0.066, 0.066, 0.11, 8, L1, 0, 0, COAL, { metalness: 0.85 }).rotation.x = Math.PI / 2;   // 膝環
  const f2 = seg(f1, L1, F_ROT[1], L2, 0.075, 0.088, PAL.deep);      // 脛節(下折)
  finF(f2, { len: 0.11, w0: 0.04, w1: 0.012, t: 0.022 }, L2 * 0.72, 0, 0, COAL, { metalness: 0.7 })
    .rotation.z = -2.0;                                              // 脛距(照片:脛節末的刺)
  cylF(f2, 0.050, 0.050, 0.09, 8, L2, 0, 0, COAL, { metalness: 0.85 }).rotation.x = Math.PI / 2;   // 踝環
  const f3 = seg(f2, L2, F_ROT[2], L3, 0.058, 0.068, HIVE);          // 跗節(細長,末端帶爪)
  for (const cz of [-0.035, 0.035])                                  // 末端雙爪(兼起落點)
    coneF(f3, 0.030, 0.15, 6, L3 + 0.06, 0, cz, COAL, { metalness: 0.9 }).rotation.z = -Math.PI / 2;
  // 武器掛點:先抵銷三節累積折角,再抵銷根部偏航(順序不可對調,見上方註解)
  const A = F_ROT[0] + F_ROT[1] + F_ROT[2];
  const podA = new THREE.Group();
  podA.position.x = L3 * 0.42;
  podA.rotation.z = -A;
  f3.add(podA);
  const podB = new THREE.Group();
  podB.rotation.y = -th0;
  podA.add(podB);
  return { pod: podB, leg: f3, S };
}

export default {
  label: '第聶伯總譜(s01 虎頭蜂型撲翼機)', kind: 'air', height: 3.4,
  // insect:昆蟲高頻震翅(8 字軌跡)—— 2026-08-13 使用者「完全靠翅膀飛行」的落點
  air: { tiltY: 1.3, bob: 0.07, top: 24, span: 3.6, insect: true },
  moveSig: { hover: 0.60, hoverF: 2.4, hoverA: 0.45, surge: 0.40, flare: 0.55, bank: 0.35 },
  castSig: { omni: 'flare', dir: 'lunge' },
  doc: [
    ['蜂頭', '窄盾形頭殼(稜柱,亮階)+ 腎形大複眼 ×2(暗殼包到頭側 + accent 感測格 ×3)+ 單眼 ×3 + 大顎 ×2'],
    ['膝狀觸角 ×2', '柄節(前上)+ 膝軸球 + 鞭節五節前下彎(逐節收細)+ 梢端感測燈;全段免描邊'],
    ['蜂胸', '暗階收分胸廓(楔台)+ 亮階胸背板 / 前胸領 / 小盾片 + 絨毛短鰭 ×12 + 暗側甲'],
    ['細腰 petiole', '收細旋成體 + 兩端軸環 —— 蜂與一般蟲最關鍵的一眼'],
    ['節腹 ×6', '逐節收錐旋成體(橘)+ 節後緣重疊暗環(黑褐/煤黑交替)+ 腹下電池艙;全長約胸的兩倍'],
    ['螫針(識別剪影)', '腹末錐尖**連續**接出的收分針(旋成體)+ 節環 ×2 + 等距橫振子 ×7(中繼天線合一)+ 針尖燈;2026-08-13 起**不再是武器節點**'],
    ['膜翅 ×4(升力系統)', '前翅(展 1.62)/ 後翅(展 1.02)各一對:腋片鉸接 + 內外兩段翅膜(半透明稜柱)+ 前緣粗脈 / 縱脈 ×4 / 橫脈;全部進 rig.wings、走昆蟲震翅分支'],
    ['蜂足 ×6', '基節 + 轉節環 + 腿節(上抬,膝為最高點)+ 膝環 + 脛節(下折)+ 脛距 + 踝環 + 跗節 + 末端雙爪(兼起落點);前/中/後足各自偏航、後足最長'],
    ['六足武裝', '前四足下各一具小口徑莢(輕武器組)+ 後兩足下各一具大口徑莢(重武器組);束帶 ×2 + 掛座 + 莢沿 +z 朝前,開火時六具槍口一起亮'],
  ],

  body(c, t) {
    const { PAL, accent } = c;

    // ─────── 頭(+z 最前):扁圓盾形 + 腎形複眼 + 單眼 + 大顎 + 膝狀觸角 ───────
    const H = new THREE.Group();
    H.position.set(0, 0.04, 0.84);
    t.add(H);
    // 頭殼刻意做**窄**(半寬 0.24 < 複眼外緣 0.33):複眼因此真的包到頭側,
    // 正面讀起來是「一張亮臉夾在兩坨黑複眼中間」——照片與 2D 圖的共同特徵。
    prismF(H, [
      [-0.15, -0.28], [0.15, -0.28], [0.24, -0.05], [0.21, 0.18],
      [0.09, 0.30], [-0.09, 0.30], [-0.21, 0.18], [-0.24, -0.05],
    ], 0.30, 0, 0, 0, PAL.mid, { metalness: 0.6 });
    prismF(H, [                                       // 顏面板(照片:虎頭蜂的亮臉)
      [-0.11, -0.24], [0.11, -0.24], [0.15, -0.02], [0.11, 0.18],
      [-0.11, 0.18], [-0.15, -0.02],
    ], 0.06, 0, 0.00, 0.15, PAL.main, { metalness: 0.55 });
    for (const sx of [-1, 1]) {
      prismF(H, eyePts(sx, 0.92, 0.86), 0.30, 0, 0.02, 0, COAL, { metalness: 0.7 });   // 腎形複眼(包到頭側)
      for (let k = 0; k < 3; k++) {                   // 感測格 ×3(2D 圖臉上那幾格面板)
        const p = [[0.16, 0.14], [0.25, 0.01], [0.20, -0.13]][k];
        cylF(H, 0.048, 0.048, 0.04, 6, sx * p[0], p[1] + 0.02, 0.15, accent,
          { emissive: accent, emissiveIntensity: 1.9 }).rotation.x = Math.PI / 2;
      }
      // 大顎:頭下前方一對內鉤楔
      const md = prismF(H, sx > 0
        ? [[0, 0], [0.15, -0.05], [0.10, -0.25], [0.02, -0.19]]
        : [[0, 0], [-0.02, -0.19], [-0.10, -0.25], [-0.15, -0.05]],
      0.10, sx * 0.08, -0.23, 0.10, PAL.deep, { metalness: 0.75 });
      md.rotation.z = sx * 0.22;
      antenna(H, sx, accent);
    }
    for (let i = 0; i < 3; i++) {                     // 單眼 ×3(頭頂三角排列)
      const o = cylF(H, 0.032, 0.032, 0.04, 6, (i - 1) * 0.09, 0.27 + (i === 1 ? 0.02 : 0), 0.04 - (i === 1 ? 0.07 : 0),
        accent, { emissive: accent, emissiveIntensity: 1.5 });
      o.rotation.x = -0.25;
    }

    // ─────── 頸 / 前胸暗環 ───────
    cylF(t, 0.22, 0.25, 0.12, 10, 0, 0.02, 0.64, COAL, { metalness: 0.8 }).rotation.x = Math.PI / 2;

    // ─────── 胸(中段):最粗壯的一節,前高後低 ───────
    // 照片的虎頭蜂:**暗胸** + 亮頭 + 節腹橫紋 ⇒ 胸體 PAL.dark、只留背板/前領/絨毛是亮階。
    tboxF(t, { w0: 0.92, d0: 0.74, w1: 0.78, d1: 0.60, h: 0.66, sz: -0.05 }, 0, 0.02, 0.26, PAL.dark, { metalness: 0.6 });
    const scut = tboxF(t, { w0: 0.72, d0: 0.60, w1: 0.50, d1: 0.38, h: 0.18, sz: -0.06 }, 0, 0.40, 0.28, PAL.mid, { metalness: 0.55 });
    scut.rotation.x = -0.08;                          // 胸背板微微前高後低
    tboxF(t, { w0: 0.80, d0: 0.12, w1: 0.70, d1: 0.10, h: 0.32 }, 0, 0.18, 0.57, PAL.mid, { metalness: 0.6 });  // 前胸亮領
    tboxF(t, { w0: 0.54, d0: 0.16, w1: 0.40, d1: 0.12, h: 0.26 }, 0, 0.26, -0.05, PAL.mid, { metalness: 0.6 }); // 小盾片
    for (const sx of [-1, 1])
      prismF(t, [[-0.26, -0.18], [0.24, -0.22], [0.26, 0.14], [-0.24, 0.18]], 0.07,
        sx * 0.46, -0.02, 0.26, HIVE, { metalness: 0.7 }).rotation.y = sx * Math.PI / 2;
    tboxF(t, { w0: 0.72, d0: 0.62, w1: 0.54, d1: 0.48, h: 0.22 }, 0, -0.36, 0.26, COAL, { metalness: 0.5 });
    // 胸背絨毛:12 支後倒短鰭(照片的絨毛感;一根 = 一顆零件)。
    // ⚠ 展示台的鍵光比 2D 定案圖亮得多 ⇒ 亮階平面會被打到溢出成純白(r2 實測:立起來的絨毛
    // 讀成一排白色鋸齒 = 全機最搶眼的東西)⇒ 壓短並倒得更平貼背,只留絨毛的邊緣感。
    for (let j = 0; j < 2; j++) for (let i = 0; i < 6; i++) {
      const f = finF(t, { len: 0.095 - j * 0.015, w0: 0.05, w1: 0.016, t: 0.020, sweep: 0.02 },
        (i - 2.5) * 0.105, 0.47 - j * 0.05, 0.50 - j * 0.24, PAL.lite, { metalness: 0.5 });
      f.rotation.x = -1.46 - j * 0.10;
      f.rotation.z = (i - 2.5) * 0.08;
    }

    // ─────── 腰(petiole):明顯收細的一小節(蜂與一般蟲最關鍵的一眼)───────
    const pet = latheF(t, [[0.20, 0], [0.115, 0.07], [0.09, 0.19], [0.115, 0.30], [0.19, 0.38]], 10,
      0, -0.02, -0.06, PAL.dark, { metalness: 0.75 });
    pet.rotation.x = -Math.PI / 2;                    // 旋成軸 +y → 機尾 −z
    for (const z of [-0.07, -0.43])
      cylF(t, 0.205, 0.205, 0.05, 10, 0, -0.02, z, COAL, { metalness: 0.85 }).rotation.x = Math.PI / 2;

    // ─────── 腹(−z 後):六節收錐 + 逐節重疊暗環(全長約胸的兩倍,照片的比例)───────
    const R = [0.26, 0.33, 0.34, 0.31, 0.25, 0.17, 0.08];
    const LEN = [0.27, 0.27, 0.25, 0.24, 0.21, 0.18];
    let z = -0.42;
    for (let i = 0; i < 6; i++) {
      const r0 = R[i], r1 = R[i + 1], L = LEN[i];
      const b = latheF(t, [
        [r0 * 0.92, 0], [r0, L * 0.16], [Math.max(r0, r1), L * 0.52],
        [r1 * 1.02, L * 0.9], [r1 * 0.88, L],
      ], 10, 0, -0.02, z, PAL.mid, { metalness: 0.55 });
      b.rotation.x = -Math.PI / 2;
      const band = cylF(t, r1 * 1.14, r0 * 1.02, L * 0.38, 10, 0, -0.02, z - L * 0.82,
        i % 2 ? COAL : HIVE, { metalness: 0.7 });     // 節後緣重疊暗環(逐節換色)
      band.rotation.x = Math.PI / 2;
      z -= L;
    }
    // 腹下電池艙(併進腹節)
    const bat = tboxF(t, { w0: 0.40, d0: 0.54, w1: 0.30, d1: 0.42, h: 0.18 }, 0, -0.33, -0.78, HIVE, { metalness: 0.5 });
    bat.rotation.x = 0.10;
    bxF(t, 0.26, 0.03, 0.36, 0, -0.42, -0.78, accent, { emissive: accent, emissiveIntensity: 1.1 });
    // 腹末錐尖 → 螫針的接點(MUST 連續)
    const tipC = latheF(t, [[0.08, 0], [0.062, 0.07], [0.042, 0.14]], 10, 0, -0.02, -1.84, PAL.deep, { metalness: 0.75 });
    tipC.rotation.x = -Math.PI / 2;

    // ─────── 螫針(識別剪影;2026-08-13 起不再是武器節點,見檔頭 ⓓ)───────
    const sting = new THREE.Group();
    sting.position.set(0, -0.04, STING_Z);
    sting.rotation.x = -0.24;                         // 下彎(照片與 2D 圖同)
    t.add(sting);
    const SL = 1.20;
    const bar = latheF(sting, [[0.085, 0], [0.065, SL * 0.30], [0.040, SL * 0.66], [0.024, SL], [0, SL]], 10,
      0, 0, 0, PAL.deep, { metalness: 0.8 });
    bar.rotation.x = -Math.PI / 2;                    // 旋成體 +y → 機尾 −z
    for (let i = 0; i < 2; i++)                       // 基部節環(蜂針的倒鉤感)
      cylF(sting, 0.082 - i * 0.016, 0.082 - i * 0.016, 0.045, 8, 0, 0, -SL * (0.09 + i * 0.12), COAL,
        { metalness: 0.9 }).rotation.x = Math.PI / 2;
    for (let i = 0; i < 7; i++)                       // 等距橫振子(2D 圖:中繼天線與螫針合一)
      bxF(sting, 0.30 - i * 0.022, 0.019, 0.019, 0, 0, -SL * (0.34 + i * 0.095), GUNMETAL, { metalness: 0.85 });
    const tipL = sphF(sting, 0.030, 0, 0, -SL * 1.02, accent, { emissive: accent, emissiveIntensity: 1.5 });
    tipL.userData.noOutline = true;                   // 針尖識別燈(**不進任何 GlowM 名冊**)

    // ─────── 六足(身體的一部分;莢由 mount 掛上去)───────
    // baseCtx 是 body/lift/mount 共用的同一個物件 ⇒ 掛點沿它交接(同 c.binderPivots 慣例)。
    c.legPods = [];
    for (const sx of [-1, 1]) for (let i = 0; i < 3; i++) {
      const { pod, S } = beeLeg(t, c, i, sx);
      c.legPods.push({ pod, sx, i, S, heavy: i === 2 });   // 後足 = 重武器組
    }
  },

  /** 升力系統 = 四片膜翅(前翅 + 後翅各一對)。旋翼 2026-08-13 整批退場 ⇒ 不回傳 spin。 */
  lift(c, t) {
    const wings = [];
    // 前翅展 1.85 ≈ 體長(頭 0.84 → 腹末 −1.9)的六成半 —— 照片裡蜂的前翅約與體長等長,
    // 這裡收到六成半是因為機體的腹比真蜂長(2D 定案圖的長身)。
    const FORE = { len: 1.85, ch0: 0.56, ch1: 0.07, lead: 0.42, bend: 0.34 };
    const HIND = { len: 1.12, ch0: 0.40, ch1: 0.06, lead: 0.40, bend: 0.22 };
    for (const sx of [-1, 1]) {
      // 前翅:大而長,根部在胸背後緣上方;pair 不給 ⇒ 相位領先
      // dih 是**靜態上反**,而震翅那一支每幀還會再加 ±amp(0.3~0.42 rad)的拍角 ——
      // 兩者相加 ⇒ 上反給大了,定裝照那一幀的四片翅會豎成一對鹿角(r2 實測 0.20 就已經太多)。
      wings.push(wing(t, c, sx, { x: 0.30, y: 0.46, z: 0.20, P: FORE, dih: 0.12, inc: 0.06, sweep: 0.18, split: 0.40, veins: 4 }));
      // 後翅:短一截、位置略低略後;pair: true ⇒ 相位落後前翅半個衝程(蜂類前後翅耦合但非同相)
      wings.push(wing(t, c, sx, { x: 0.26, y: 0.34, z: -0.06, P: HIND, dih: 0.07, inc: 0.05, sweep: 0.14, split: 0.42, veins: 3, pair: true }));
    }
    return { wings };
  },

  mount(c, F) {
    const { accent, PAL, K, dark } = c;
    // ---- 六足武裝(2026-08-13 使用者:「武器裝備在六隻腳上」)----
    // 掛點的局部 +z 已由 beeLeg 抵銷成機首正前方 ⇒ 莢一律走 gunPodF 的 `fwd:'z'` 契約。
    const lightPods = [], heavyPods = [], lightMuz = [], heavyMuz = [];
    for (const e of c.legPods) {
      const { pod, heavy } = e;
      const r = heavy ? 0.125 : 0.085;
      const len = (heavy ? 0.80 : 0.50) * K.barrelF;
      // 掛座:自足下垂下的短柱(看得出莢是**裝上去的**,不是憑空浮著)
      tboxF(pod, { w0: r * 1.3, d0: r * 1.5, w1: r * 1.05, d1: r * 1.25, h: 0.16 }, 0, -0.09, 0.01, COAL, { metalness: 0.85 });
      // 束帶 ×2:抱住莢殼的兩道環(掛座與莢之間的機構語言)
      for (const dz of [-0.06, 0.10])
        cylF(pod, r * 1.35, r * 1.35, 0.035, 8, 0, -0.17 - r, dz, COAL, { metalness: 0.9 }).rotation.x = Math.PI / 2;
      const gp = gunPodF(pod, { len, r, accent }, 0, -0.17 - r, 0.02, dark, { metalness: 0.75 });
      (heavy ? heavyPods : lightPods).push(gp.g);
      (heavy ? heavyMuz : lightMuz).push(gp.muz);
    }
    return {
      // n = 取其中一具槍口當彈道原點(名冊全員的發光由 *GlowM 收);r = 收束半徑
      muzzles: { light: { n: lightMuz[0], r: 0.05 }, heavy: { n: heavyMuz[0], r: 0.09 } },
      lightGlowM: lightMuz, heavyGlowM: heavyMuz,          // 開火時六具一起亮 = 六足齊射
      weap: { light: 'N', heavy: 'N' }, hvy: { chest: 0.05 },
      // 六具莢的幾何全部沿局部 +z 朝前(掛點已抵銷偏航與折角)⇒ 兩組 fwd 都是 'z'
      wpn: { light: { nodes: lightPods, ref: lightPods[0], muz: lightMuz[0], fwd: 'z' },
        heavy: { nodes: heavyPods, ref: heavyPods[0], muz: heavyMuz[0], fwd: 'z' } },
    };
  },
};
