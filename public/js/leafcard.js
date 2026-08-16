// ============ 葉片卡冠層(排列規則層;anime_style_plan ②-1 / 序 7)============
// 2026-08-16。這一支只回答三個問題:**這一列的葉團是什麼形狀的包絡**(球 / 錐 / 圓台)、
// **要撒幾張卡**、**每一張撒在哪、多大、轉幾度**。用什麼幾何畫、掛什麼材質、接進哪一顆
// InstancedMesh 是 `biomes.js` 的事 —— 與 `edgewall.js → buildEdgeWall`、
// `flags.js → placeBaseFlags`、`wallpanel.js → biomes.alignedGeo`、`petals.js → buildPetals`
// 同一條分工。
//
// ---- 五條邊界 ----
// ① **零 THREE、只 import `rng.js`**。卡片的排列是一疊純量,張數與外廓是純函式 ⇒
//    「張數真的由保險絲幾何推導嗎」「卡片會不會伸出佈局用的冠幅」在 Node 端就量得到,
//    不必開瀏覽器。這是 `audit_leaf_card` 能離線驗**真品**的唯一理由。
// ② **零共享 `rnd()` 消耗**(§2.3 / A4)。呼叫端交進來的 `rnd` MUST 是專屬 `mulberry32`
//    (`cardRnd(type, rowIndex)`)—— 從共享序列多抽一枚,後面每一株植被、每一棟建物的佈局
//    就整條推移,而畫面上只表現成「整張圖變了」,沒有任何錯誤訊息。逐張消耗**固定**
//    `DRAWS` 枚,而且抽樣排在任何淘汰之前(這裡根本沒有淘汰 ⇒ 恆真)。
// ③ **包絡只讀保險絲幾何的 `parameters`**(呼叫端傳 `p.g.parameters`,不是 `partGeo(p)` 的
//    解析結果)——與 `giantCrownR` / `vegSpan` 同一條紀律(`partGeo` 檔頭 ①):庫幾何載不
//    載得到逐客戶端不同,佈局讀它就是跨客戶端分家。卡片是「畫什麼」的第三個解析結果,
//    它的包絡 MUST 與佈局用的那一份是**同一組參數**,兩者才不可能分家。
// ④ **水平外廓 ≤ 包絡半徑是結構保證不是校準**:卡心先沿徑向內縮 `1 − hr / rc`,於是
//    「卡心距 + 卡半徑」恆 ≤ `rc`(代數上是等號的上界)。`giantCrownR` 量的正是同一個
//    `rc`(它讀 `p.g.parameters` 的 radius / radiusTop / radiusBottom)⇒ 畫出來的冠幅
//    **恆不可能**大過佈局用的冠幅,樹冠羞避 / 淨空 / 碰撞一格都不用改。
//    ⚠ 縱向刻意不收:卡片尺寸不吃 `sy`(壓扁的冠上面的卡片仍是方的,見 toon.js 的
//    `CEL_LEAFCARD` 區塊),所以壓扁的冠上卡片會略高過包絡 —— 那是取景取捨,而
//    「冠幅」在本專案的每一個消費端都是**水平**量。
// ⑤ **純表現層**:`data.js` / `sim.js` / `server/**` 一行不動。
//
// ---- 幾個會靜默壞掉的地方 ----
// ・**張數逐型手寫**:加一款樹 / 改一顆葉團的半徑之後,那一列的卡片密度停在舊值,而每一條
//   斷言都會過(反向驗證 `--break-count` 就是那個壞版本)。張數 MUST 由包絡面積推導。
// ・**卡片半徑純比例**(`hr = R_F × rc`):球的面積與卡面面積都 ∝ r² ⇒ 張數**與半徑無關**,
//   「換一個包絡半徑張數要跟著變」這條就恆假,而畫面上只表現成「小葉團上的卡跟大葉團一樣多」。
//   故卡片尺寸錨在**世界公稱邊長** `SIZE_M`,只用 `MIN_F`/`MAX_F` 夾在包絡的比例帶內。
// ・**抖動抖位置**:直接推 (x,y,z) 會把卡心推離包絡表面 ⇒ ④ 的等號上界破掉。抖動一律抖
//   **參數座標**(沿面的 t 與 θ),卡心因此恆在包絡上。
// ・**張數上限當成美術值**:`N_MAX` 是 **alpha-test 重疊繪製的填充率預算**,不是「好看的張數」。
//   放大它的代價不在 draw call(換的是列的幾何不是列數)而在填充率,而 `RES_GOV` 會把它
//   表現成「解析度自己降了」不是掉幀。
import { mulberry32 } from './rng.js';

/**
 * 排列參數。
 * ⚠ `SIZE_M` / `COVER` / `N_MAX` 是**授權值不是量測值**(同 `PETAL.SIZE`、`MINI.BUFFER_F`):
 * 一叢真實葉片在這個尺度上是幾公分,日系背景一律誇張成「一筆畫得出來的一叢」。
 * 校準面是定裝照(㋓)與真機填充率(㋕),兩者沙箱都跑不動。
 */
export const CARD = {
  SIZE_M: 1.1,     // 一張葉片卡的公稱**邊長**(遊戲公尺);半邊長 = SIZE_M / 2
  MIN_F: 0.28,     // 卡半邊長的下界(佔包絡特徵半徑)—— 巨木的冠上不會出現一堆小碎卡
  MAX_F: 0.5,      // 上界。**MUST < 1**:內縮量 = 1 − hr/rc,取到 1 就是整叢塌進圓心
  COVER: 0.85,     // 覆蓋率(卡面總面積 ÷ 包絡面積);alpha 遮罩本身有孔 ⇒ < 1 仍蓋得滿
  N_MIN: 5,        // 少於這個張數讀不出「一叢」
  N_MAX: 24,       // 填充率預算(見檔頭最後一條)
  JIT: 0.55,       // 參數座標抖動(佔一格間距;抖的是 t 與 θ 不是位置)
  R_JIT: 0.3,      // 卡半邊長逐張走樣(±)
  DRAWS: 4,        // 逐張**固定**消耗的亂數枚數(§2.3 的抽樣紀律)
};

/** 黃金角(Fibonacci 格點的唯一常數;取它是為了「任意張數都不成列」) */
const GOLDEN = Math.PI * (3 - Math.sqrt(5));

/**
 * 這一列的葉團包絡。**輸入 MUST 是保險絲幾何的 `parameters`**(three 的
 * Icosahedron/Sphere/Cone/Cylinder 都把建構參數留在那裡),與 `giantCrownR` 讀的是同一份。
 * 認不出來的形狀回 `null` ⇒ 呼叫端退回保險絲團塊(原則 6:降級不例外)。
 * @param p 幾何的 `parameters` 物件
 */
export function cardEnvelope(p) {
  if (!p) return null;
  const h = p.height;
  // 圓柱 / 圓台(整樹節點的保險絲、雪松的平展枝盤)MUST 排在錐之前:ConeGeometry 只有
  // `radius`,CylinderGeometry 只有 `radiusTop`/`radiusBottom`,兩者都帶 `height`。
  if (p.radiusTop != null || p.radiusBottom != null) {
    const rt = p.radiusTop ?? 0, rb = p.radiusBottom ?? 0, rc = Math.max(rt, rb);
    if (!(h > 0) || !(rc > 0)) return null;
    return { kind: 'cyl', rTop: rt, rBot: rb, h, rc };
  }
  if (p.radius > 0 && h > 0) return { kind: 'cone', r: p.radius, h, rc: p.radius };
  if (p.radius > 0) return { kind: 'sphere', r: p.radius, rc: p.radius };
  return null;
}

/** 包絡的側面積(球取全表面;錐 / 圓台取側面 —— 葉子長在側面上,底面朝下看不到) */
export function envArea(e) {
  if (!e) return 0;
  if (e.kind === 'sphere') return 4 * Math.PI * e.r * e.r;
  if (e.kind === 'cone') return Math.PI * e.r * Math.hypot(e.r, e.h);
  return Math.PI * (e.rTop + e.rBot) * Math.hypot(e.rTop - e.rBot, e.h);
}

/**
 * 一張卡的半邊長(遊戲公尺)。錨在世界公稱邊長,再夾進包絡的比例帶 —— 純比例會讓
 * 張數與半徑無關(見檔頭第二條)。
 */
export const cardHalf = (e) => (e ? Math.min(Math.max(CARD.SIZE_M / 2, CARD.MIN_F * e.rc), CARD.MAX_F * e.rc) : 0);

/**
 * 張數:覆蓋率 × 包絡面積 ÷ 卡面面積,夾在 [N_MIN, N_MAX]。
 * **MUST NOT 逐型手寫** —— 改一顆葉團的半徑,密度自己跟著走。
 */
export function cardCount(e) {
  const hr = cardHalf(e);
  if (!(hr > 0)) return 0;
  const n = Math.round(CARD.COVER * envArea(e) / (4 * hr * hr));
  return Math.max(CARD.N_MIN, Math.min(CARD.N_MAX, n));
}

/** 圓台上「面積均勻」的高度參數(側面積元 ∝ 半徑 ⇒ 解一元二次;等半徑退化成 u = t) */
function frustumU(a, b, t) {
  const A = (b - a) / 2;
  if (Math.abs(A) < 1e-9) return t;
  const B = a, C = -t * (a + b) / 2;
  const d = Math.sqrt(Math.max(0, B * B - 4 * A * C));
  const u1 = (-B + d) / (2 * A), u2 = (-B - d) / (2 * A);
  const ok = (u) => u >= -1e-9 && u <= 1 + 1e-9;
  return Math.min(1, Math.max(0, ok(u1) ? u1 : (ok(u2) ? u2 : t)));
}

/**
 * 卡片排列。回傳 `[{ cx, cy, cz, nx, ny, nz, hr, rot }]`(局部座標,原點 = 葉團中心,
 * 與保險絲幾何**同一個框**:`ico`/`cone`/`cyl` 在 `VEG_DEFS` 裡都沒有 `.translate`)。
 * ・`c*`  = 卡心(已內縮;`hypot(cx,cz) + hr ≤ rc` 恆成立)
 * ・`n*`  = **球面法線**(卡心 − 冠心)。MUST NOT 用面向相機的面法線 —— 那會讓整叢冠在
 *          轉頭時同時換一階明暗(賽璐璐階梯尤其明顯),而且折邊項會沿每一張卡的邊出線。
 * ・`hr`  = 這一張的半邊長;`rot` = 在視域空間裡的自轉(弧度)
 * @param e   `cardEnvelope()` 的結果
 * @param rnd **專屬** mulberry32(`cardRnd()`);逐張固定 `CARD.DRAWS` 枚
 */
export function planCards(e, rnd) {
  const out = [];
  if (!e) return out;
  const n = cardCount(e), hr0 = cardHalf(e);
  if (!(n > 0) || !(hr0 > 0)) return out;
  for (let i = 0; i < n; i++) {
    // 逐張**固定** DRAWS 枚(§2.3:每候選消耗固定枚數;這裡沒有淘汰 ⇒「淘汰排在抽樣之後」恆真)
    const j1 = rnd(), j2 = rnd(), j3 = rnd(), j4 = rnd();
    // 抖的是**參數座標**不是位置:卡心因此恆留在包絡表面上(見檔頭第三條)
    const t = Math.min(1, Math.max(0, (i + 0.5) / n + (j1 - 0.5) * CARD.JIT / n));
    const th = i * GOLDEN + (j2 - 0.5) * CARD.JIT * 2;
    const hr = hr0 * (1 + (j3 - 0.5) * CARD.R_JIT);
    let sx, sy, sz;
    if (e.kind === 'sphere') {
      const y = 1 - 2 * t, rr = Math.sqrt(Math.max(0, 1 - y * y));
      sx = Math.cos(th) * rr * e.r; sy = y * e.r; sz = Math.sin(th) * rr * e.r;
    } else if (e.kind === 'cone') {
      const f = Math.sqrt(t);                    // 側面積元 ∝ 半徑 ⇒ 距頂點的比例取根號
      sx = Math.cos(th) * e.r * f; sz = Math.sin(th) * e.r * f; sy = e.h * (0.5 - f);
    } else {
      const u = frustumU(e.rBot, e.rTop, t);
      const rr = e.rBot + (e.rTop - e.rBot) * u;
      sx = Math.cos(th) * rr; sz = Math.sin(th) * rr; sy = e.h * (u - 0.5);
    }
    // **內縮量是推導的**:sink = 1 − hr/rc ⇒ 卡心距 × sink + hr ≤ rc × sink + hr = rc。
    // 這一行就是「畫出來的冠幅恆 ≤ 佈局用的冠幅」那條保證的全部內容。
    const sink = Math.max(0, 1 - hr / e.rc);
    const cx = sx * sink, cy = sy * sink, cz = sz * sink;
    const L = Math.hypot(sx, sy, sz) || 1;
    out.push({ cx, cy, cz, nx: sx / L, ny: sy / L, nz: sz / L, hr, rot: j4 * Math.PI * 2 });
  }
  return out;
}

/**
 * 卡片排列的**專屬**亂數(零共享 `rnd()` 消耗)。種子只由「哪一型的第幾列」決定 ⇒
 * 同一列全房逐位元同值,而且插在建構流程的任何位置都不推移植被佈局(§2.3)。
 */
export function cardRnd(type, rowIndex) {
  let h = 0x1EAF ^ ((rowIndex | 0) * 0x9E3779B1);
  for (let i = 0; i < String(type).length; i++) h = Math.imul(h ^ String(type).charCodeAt(i), 0x85EBCA77);
  return mulberry32((Math.imul(h ^ (h >>> 15), 0xC2B2AE3D) >>> 0));
}

/**
 * 逐株面號(`aSurfId`)。**落點雜湊**,零共享 `rnd()` 消耗:同一株的幹 / 枝 / 冠(不同列、
 * 同一個 `it`)拿到逐位元相同的號,相鄰兩株拿到不同號 ⇒ 群組早退把「這是一棵樹」讀出來,
 * 而兩株之間仍然有線。
 * 值域刻意是**半整數格** `(k + 0.5) / 64`(k ∈ [1, 63]),與 `toon.js` 的逐材質號同一條環:
 * 避開 `SURF_ID.LAND = 0`,也不會與 `surfGroup()` 的整數格撞號(S3 ①)。
 * ⚠ 64 階 ⇒ 相鄰兩株約 1.6% 的機率同號 = 那一對之間少一條線。既有檔頭已認可「撞號 =
 * 少一條線,不是壞掉」,但灌木密度下會零星可見。
 */
export function leafSurfId(x, z) {
  const h = (Math.imul(Math.round(x * 4) | 0, 0x27D4EB2D) ^ Math.imul(Math.round(z * 4) | 0, 0x165667B1)) | 0;
  const k = (Math.imul(h ^ (h >>> 13), 0x9E3779B1) >>> 0) % 63 + 1;
  return (k + 0.5) / 64;
}
