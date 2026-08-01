// ============ 攀爬路線(長梯 / 攀岩抓點 / 垂降技術繩)—— 唯一真相縫 ============
// 需求(2026-07-28):隨機挑選約三成的**建築 / 巨石 / 神木**,對應加上一條連通「地面 ↔ 頂端」
// 的攀爬路線,讓地面機種爬上爬下、上到頂端立足射擊。地面端 MUST 落在無障礙的那一側。
// 追加:上下兩端加提示箭頭(類似兵線但縮到適當大小);已掛路線的結構若有**相鄰**結構,
// 七成機率在相鄰處再架一條把兩者的頂面接起來。
//
// **為什麼是獨立一支**:路線同時被三個消費端讀 ——
//   ① `biomes.js` 生成期(規劃 + 建 3D 幾何)
//   ② `game.js` 執行期(攀爬狀態機:抓握半徑 / 上下速度 / 登頂落腳點)
//   ③ `tools/audit_climb.mjs` 離線稽核(直接執行本檔原文驗幾何)
// 三端 MUST 共用同一份規劃結果與同一組常數;**MUST NOT** 在擺位端或移動端各自再算一次表面點、
// 法線或頂面高(那正是 A26「擺位方向與旋轉方向不同調」與「兩份平衡數值」那類病灶的形狀)。
//
// **與既有系統的接縫**:
//   - 候選集 = `blockers` 裡帶 `bld`(建物/地標)或 `std`(神木/巨岩)旗標者 —— 與
//     `biomes.js makeBlockerTopIndex()`「頂面可站立」**同一組判準**。頂面高 `y1` 也一律取
//     `b.y + b.h`(= blockerTopAt 的回傳值)⇒ 爬到頂剛好等於 `main.js surfaceAt` 認得的站立面,
//     MUST NOT 另外量一次屋頂高(差 0.1m 就是「爬到頂卻站不住,直接掉下去」)。
//   - 攀爬軸 MUST 落在結構碰撞體**之外** `OFF` 公尺:`game.js _collide` 的推擠半徑上限 =
//     最大機體高 × SELF_F.groundR = (SOLDIER_H × 2.5) × 0.317 ≈ 1.43m,`OFF` 大於它 ⇒ 攀爬途中
//     機體本來就不與碰撞盒重疊,**不需要**在 _collide 開任何豁免洞(開了就等於在牆裡走路)。
//   - 確定性(A4):抽樣 / 方位起相位 / 相鄰相接 / 高側取捨一律走傳入的 `rnd`(mulberry32),
//     **每個候選固定消耗 4 枚**、淘汰檢查一律排在抽樣**之後** —— 否則佈局序列會跨客戶端分歧。
//   - **相鄰相接**(2026-07-28 追加):已掛路線的結構若有相鄰結構,七成機率再架一條把兩者的**頂面**
//     接起來。那條路線的資料形狀與一般路線**完全相同**(`y0` 換成低者的頂面高、`bx/bz` 換成低頂落腳點)
//     ⇒ 抓握索引 / 攀爬狀態機 / 提示箭頭一行都不必改。MUST NOT 為它另開第二種路線型別。
//
// **攀爬柱 vs 設施幾何是兩件事(2026-07-31 使用者回報「屋頂不平的建築,長梯會過高」)**:
//   `y0/y1` = **攀爬柱**(權威):頂端恆 = 碰撞柱頂 `b.y + b.h`,也就是 `makeBlockerTopIndex`
//   認得的站立面。這個值 **MUST NOT** 為了視覺往下修 —— `game.js _collide` 的建物垂直閘是
//   `myBot >= b.y + b.h − 0.1` 才放行,站立面一低於碰撞柱頂,人站上屋頂就會被 push-out 推下去。
//   `vy0/vy1` = **設施幾何兩端**(純表現層):碰撞柱是**刻意加高**的(一般建物 +0.5、巨岩 +1.5、
//   地標取涵蓋尖頂/天線的 `LANDMARK_COL.h`),頂面不平的結構因此讓長梯/抓點/繩高出可見屋頂一截。
//   生成期量到實體頂面就寫進 `b.ty`,設施改吃 `facilityEndY()` 貼齊實體面;沒量到就退回攀爬柱端點。
//   落差恆夾在 `GRAB_UP` 內(頂端上緣容差)⇒ 設施頂端與站立面之間永遠仍在同一段抓握帶裡。
//
// 純表現層 + 客戶端移動:伺服器不參與(位置本就客戶端權威),故 `npm run bal` / e2e 天然不受影響。

import * as THREE from 'three';
import { markShared, envMat } from './toon.js';
import { SOLDIER_H, HERO_SIZE, SLOPE, slopeDeg } from './data.js';

/** 最大機體碰撞半徑(公尺):機種身高上界 × game.js SELF_F.groundR —— OFF 的下界由它推導,MUST NOT 手寫。
 *  也是「設施離結構表面的縫」上限(biomes.js 巨岩正面實測 ATT_GAP):縫 ≤ 機體半徑 ⇒ 機體仍貼著設施 */
export const MAX_BODY_R = SOLDIER_H * Math.max(...Object.values(HERO_SIZE).map((s) => s.mul[1])) * 0.317;

export const CLIMB = {
  SHARE: 0.3,        // **平緩帶**的抽中比例(使用者需求「約 3 成」);越陡越高,見 climbShare()
  SLOPE_N: 8,        // 地形陡度取樣方位數(繞腳印一圈;取樣距離走 SLOPE.PROBE_M 單一縫)
  MIN_H: 9,          // 低於此不掛路線:蓄力跳頂點就上得去,擺個梯子只是雜訊
  MAX_H: 120,        // 高於此不掛路線:單一出入口的垂直通道爬太久 = 站著給人打(神木可達 220m)
  OFF: MAX_BODY_R + 0.4,   // 攀爬軸離結構表面(MUST > MAX_BODY_R,否則爬到一半被 _collide 推開)
  GRAB_R: 3.2,       // 抓握半徑(水平):走進來 + 有朝向路線的推杆量 = 掛上
  GRAB_UP: 4.0,      // 頂端上緣容差:自屋頂邊緣走出去(或被擊退落下)仍抓得到
  SPD: 12,           // 攀爬速度(m/s);推杆量 |f| 線性折算,受控場 _ccMoveF 影響
  KICK: 7,           // 脫手跳離的向外初速(m/s)
  CLEAR_R: 6,        // 地面端無障礙淨空半徑:此半徑內不得有別的碰撞體
  STEP: 3.0,         // 地面端最大高差(相對結構基座地表):斜坡上的那一側不算「無障礙」
  AZ: 16,            // 側向候選方位數(22.5° 一格)
  TOP_STEP: 2.2,     // 登頂後往結構內側踏進的距離(踏上頂面,不停在邊緣)
  // ---- 相鄰結構相接(2026-07-28 使用者需求)----
  // 已經掛了路線的結構,若「相鄰」還有另一座建築/巨石/神木,七成機率在相鄰處再架一條把兩者的
  // **頂面**接起來 —— 上得去之後不必回地面就能換棟推進(高處連成一片)。
  LINK: 0.7,         // **平緩帶**的相接機率;越陡越高,與地面路線共用 climbShare()
  LINK_GAP: 3.0,     // 「相鄰」= 兩者表面最短距離 ≤ 此值(> 這個距離,從低頂伸手就搆不到高牆上的梯子)
  LINK_DROP: 5,      // 兩頂高差門檻:低於此不是通道而是一階台階,不值得架
  LINK_STEP: 1.6,    // 低頂落腳點自鄰體表面往內踏進(比 TOP_STEP 短 ⇒ 抓握距離撐得住,見 GRAB_R 夾制)
  RUNG: 0.62,        // 長梯踏桿間距
  HOLD: 1.15,        // 攀岩抓點間距
  KNOT: 1.6,         // 技術繩繩結間距
};

/**
 * 上下兩端的提示箭頭(2026-07-28 使用者需求「類似兵線但縮到適當大小」)。
 * 沿用兵線的「ㄑ 字形 chevron + 沿行進方向流動 + 脹縮」語彙(`game.js _initLanes`),
 * 但**尺寸縮到約 1/3**(桿長 5.5 → 1.9m)且**立在垂直面上** —— 兵線是貼地路標,攀爬是垂直通道,
 * 箭頭的行進方向本來就是上/下。底端一組**朝上**(這裡可以上去)、頂端一組**朝下**(這裡可以下來)。
 * 兩色分工:上行青綠、下行琥珀 —— MUST NOT 用兵線的三條線色(那組色是「往敵方主堡推」的語意)。
 */
export const CLIMB_ARROW = {
  BAR: 1.9,          // 桿長(兵線 5.5 的約 1/3)
  W: 0.5,            // 桿寬
  T: 0.1,            // 桿厚(貼片,不是立體箭頭)
  SPREAD: 0.62,      // chevron 半張角(與兵線同一個張角 ⇒ 認得出是同一套語彙)
  OUT: 0.55,         // 自攀爬軸再往外推(不與長梯/抓點/繩本體疊在一起)
  RUN: 4.2,          // 流動循環長度(公尺)
  SPD: 2.6,          // 流動速度(m/s)
  N: 3,              // 每端幾支(相位均分 ⇒ 連續的流動感)
  FOOT: 1.5,         // 底端起算高(離地;約機體胸高,走過去就看得到)
  HEAD: 1.4,         // 頂端起算高(頂面之上;站在屋頂邊緣往外看得到,地面抬頭也看得到)
  FADE: 0.7,         // 循環兩端的淡入淡出距離(公尺)
  UP: 0x8ef0c0,      // 上行(青綠)
  DOWN: 0xffc45a,    // 下行(琥珀)
};

/** 結構型別 → 攀爬設施(使用者列舉的三種,對應真實世界的做法) */
export const CLIMB_KIND = { bld: 'ladder', rock: 'holds', tree: 'rope' };
export const CLIMB_LABEL = { ladder: '長梯', holds: '攀岩抓點', rope: '垂降技術繩' };

// ---------------------------------------------------------------------------
// 幾何工具:結構表面點 + 向外法線(圓柱 / 有向盒各一條,與 _collide / _cameraDeClip 同式)
// ---------------------------------------------------------------------------

/**
 * 自結構中心沿方位角 `a` 射出,求「表面交點 + 該面的向外法線 + 沿法線的半徑」。
 * 有向盒(建物 hw2/hd2/ry)走 slab 求出射參數並取決定面的法線;其餘(神木/巨岩)走圓柱。
 * 回傳 { fx, fz, nx, nz, rad }。
 *
 * **盒面朝向 MUST 與實例矩陣同調(2026-07-30 修)**:碰撞盒的 `ry` 與建物實例矩陣吃的是
 * **同一個值**(`E.set(0, b.ry, 0)`),所以 local 軸的反解 MUST 是那個矩陣的反矩陣。
 * three 的 `makeRotationY(θ)` 把 local (1,0,0) 轉到世界 (cosθ, 0, −sinθ) —— 方位是 **−θ**,
 * 故 world→local 是「繞 −ry」= `(wx·cs − wz·sn, wx·sn + wz·cs)`,程式上以 `sn = −sin(ry)`
 * 代入既有式子(同一組 cs/sn 也把 local→world 一起修正,兩個方向仍互為反解)。
 * 寫成 `sn = +sin(ry)` 的舊版等於把盒子鏡射(差 2·ry):**看得見的牆在這裡、擋彈與掛梯的牆在
 * 鏡射的那一邊** —— 45° 的樓就差 90°,長梯看起來斜插在牆邊(使用者回報「不要有其他角度」)。
 * 客戶端 `_blockerHitT`/`_collide`/`_cameraDeClip` 與伺服器 `_losBlocked`(占位存 cos/−sin)
 * MUST 同時吃這個慣例 —— 只改一邊 = 兩端分家靜默丟包(A30)。稽核 `audit_climb.mjs` Ⅲ/Ⅶ。
 */
export function surfacePoint(b, a) {
  const dx = Math.cos(a), dz = Math.sin(a);
  if (b.hw2 == null) {
    return { fx: b.x + dx * b.r, fz: b.z + dz * b.r, nx: dx, nz: dz, rad: b.r };
  }
  const cs = Math.cos(b.ry), sn = -Math.sin(b.ry);   // 見檔頭:sn 取 −sin 才與實例矩陣同調
  const ux = dx * cs + dz * sn, uz = -dx * sn + dz * cs;      // world→local(繞 −ry)
  const tx = Math.abs(ux) < 1e-9 ? Infinity : b.hw2 / Math.abs(ux);
  const tz = Math.abs(uz) < 1e-9 ? Infinity : b.hd2 / Math.abs(uz);
  const t = Math.min(tx, tz);
  // 決定面的 local 法線(較小的出射參數那一軸);再轉回世界(繞 +ry)
  const lnx = tx <= tz ? Math.sign(ux) : 0, lnz = tx <= tz ? 0 : Math.sign(uz);
  return {
    fx: b.x + dx * t, fz: b.z + dz * t,
    nx: lnx * cs - lnz * sn, nz: lnx * sn + lnz * cs,
    rad: t,
  };
}

/**
 * 可掛設施的「**正面**」候選(2026-07-30 使用者需求:長梯/攀岩抓點/垂降技術繩的正面
 * MUST 面對建築/巨石/神木,不要有其他角度)。回傳陣列,每項與 `surfacePoint` 同形
 * `{ fx, fz, nx, nz, rad }`,三種結構三種正面:
 *   ① **有向盒**(建物/地標):四個面法線 + 該面**中心點**。MUST NOT 用「自中心沿任意方位射出的
 *      交點」—— 那個點落在牆面上任何位置(含牆角),設施看起來就是斜插在牆邊。
 *   ② **帶 `attA` 的結構**(巨岩:外廓不規則,碰撞圓與岩面不等距):只准生成期**實測驗過**的方位;
 *      驗不過的巨岩一顆方位都不給 ⇒ 不掛路線(§4 寧缺勿錯,好過掛一條浮在空中的)。
 *   ③ **圓柱**(神木):幹身是旋轉對稱體,任一徑向都是正面 —— 維持 16 方位掃描取最空的一側。
 * `phase`(每候選固定抽的那一枚)只用來輪轉起掃順序,不改變候選集合。
 */
export function attachFaces(b, phase = 0) {
  if (b.hw2 != null) {
    // 面法線的世界方位:local +x = **−ry**、local +z = π/2 − ry(three Euler(0,ry,0) 的反解,
    // 見 surfacePoint 檔頭)。沿面法線射出的 surfacePoint 交點**就是該面的中心點**
    // (`rad` 剛好等於該軸半寬)⇒ 直接復用同一支幾何,MUST NOT 在這裡另寫第二份盒面公式。
    const k0 = Math.floor(phase / (Math.PI / 2)) & 3;
    return Array.from({ length: 4 }, (_, i) =>
      surfacePoint(b, -b.ry + ((k0 + i) & 3) * Math.PI / 2));
  }
  // 逐方位自帶 gap/top(生成期實測):gap = 碰撞面到岩面的內縮量、top = 頂端處的剩餘縫
  if (b.attA) return b.attA.map((f) => ({ ...surfacePoint(b, f.a), gap: f.gap, arm: f.top }));
  // 圓柱(神木):幹身**向上收窄**,碰撞半徑吃的是基部 ⇒ 頂端錨件離幹身還差 `r − tr`
  // (`tr` = 生成期由 trunkR() 同一縫算出的頂端半徑;沒帶就是等徑柱體,arm = 0)。
  // 不吃這一段的話,繩錨會吊在幹外好幾公尺的空中 —— 與「長梯高出屋頂」是同一族病灶。
  const arm = b.tr != null ? Math.max(0, b.r - b.tr) : 0;
  return Array.from({ length: CLIMB.AZ },
    (_, k) => ({ ...surfacePoint(b, phase + k / CLIMB.AZ * Math.PI * 2), arm }));
}

/** 候選結構?= 頂面可站立的大型障礙(與 makeBlockerTopIndex 同一組旗標)且高度落在窗口內 */
export function climbCandidate(b) {
  if (!b || (!b.bld && !b.std)) return false;
  return b.h >= CLIMB.MIN_H && b.h <= CLIMB.MAX_H;
}

/**
 * 結構所在地的**地形陡度**(度,非負;純量測,不消耗亂數)。繞結構腳印外緣一圈取
 * `CLIMB.SLOPE_N` 個方位,每個方位量「腳印外緣 → 再往外 `SLOPE.PROBE_M`」那一段的坡度,
 * 回傳最陡的一段。
 *
 * 取**絕對值**是刻意的:同一道坡從下面上不去、從上面下不來,兩側都是「這裡沒有梯子過不去」;
 * 只認上坡的話,坐在崖頂的結構會被判成平地(它四周全是下坡)。取樣距離吃 `SLOPE.PROBE_M`
 * 單一縫(移動速度倍率的前瞻距離)—— MUST NOT 另手寫一個取樣尺度。
 */
export function siteSlopeDeg(b, heightAt) {
  const rr = (b.hw2 != null ? Math.hypot(b.hw2, b.hd2) : b.r) + CLIMB.OFF;
  let worst = 0;
  for (let k = 0; k < CLIMB.SLOPE_N; k++) {
    const a = k / CLIMB.SLOPE_N * Math.PI * 2;
    const dx = Math.cos(a), dz = Math.sin(a);
    const h0 = heightAt(b.x + dx * rr, b.z + dz * rr);
    const h1 = heightAt(b.x + dx * (rr + SLOPE.PROBE_M), b.z + dz * (rr + SLOPE.PROBE_M));
    const d = Math.abs(slopeDeg(h1 - h0, SLOPE.PROBE_M));
    if (d > worst) worst = d;
  }
  return worst;
}

/**
 * 陡度 → [0,1] 正規化斜率(**全檔唯一一份 ramp**)。轉折點與 `slopeMoveF` 同一組
 * (MUST NOT 手寫第二套角度):平緩帶(≤ `SLOPE.EASE_DEG`)= 0、阻擋角(`SLOPE.BLOCK_DEG`)= 1,
 * 更陡夾在 1。取**絕對值**:同一道坡從上/從下量是同一件事。
 * 三個消費端(抽中機率 / 相鄰相接 / 高側取捨)MUST 全部走這一支 —— 各寫一次,調 `BLOCK_F` 就分家。
 */
export function slopeRamp(deg) {
  return Math.min(1, Math.max(0, Math.abs(deg || 0) - SLOPE.EASE_DEG) / (SLOPE.BLOCK_DEG - SLOPE.EASE_DEG));
}

/**
 * 抽中機率 ← 地形陡度(2026-07-31 使用者需求:「越陡的地形機率越高,在不可陡上的區域則是 100%」)。
 *   平緩帶 = 基準 `base` —— 這種地形走路就上得去,梯子只是雜訊;之後線性升到阻擋角 = 1(100%)。
 * 「不可陡上」(> `SLOPE.BLOCK_DEG`)落在 `slopeRamp` 的夾制段 ⇒ 恆 1,**由曲線推導**而非另寫一條
 * if:兩條路各寫一次,調 BLOCK_F 就會分家(稽核 Ⅸ 直接以 slopeBlocked 逐度反查這條)。
 *
 * `base` 就是「平地時的那個機率」:地面路線吃 `CLIMB.SHARE`、**相鄰相接**吃 `CLIMB.LINK`
 * (2026-07-31 使用者追加:相鄰結構之間的設施也隨坡度變化)。兩者共用這一支 ⇒ 曲線只有一份,
 * MUST NOT 為相接另寫一條 ramp。
 */
export function climbShare(deg, base = CLIMB.SHARE) {
  return base + (1 - base) * slopeRamp(deg);
}

/**
 * **掛在「等高線相對最高那一面」的機率** ← 地形陡度(2026-08-01 使用者需求:
 * 「出現在等高線相對最高那一面的機率隨坡度降低,最低 0%」)。與 `climbShare` 是同一條
 * `slopeRamp` 的反向:平緩帶 = 1(四面等價,不必挑),線性降到阻擋角 = 0(**那一面一律不掛**)。
 *
 * 設計語意:高側那一面的地表本來就已經抬到接近頂端,再插一支長梯既沒有攀爬價值、看起來也像
 * 半截埋在山坡裡;真正需要垂直通道的是**低側**。上限 1 / 下限 0 由曲線兩端推導,MUST NOT 手寫。
 * 平地(四面等高)沒有「最高面」可言 ⇒ 消費端以「hi > lo」擋在前面,這條曲線不必為它開特例。
 */
export function highFaceShare(deg) {
  return 1 - slopeRamp(deg);
}

/**
 * 設施幾何的端點(貼齊**可見實體面**;見檔頭「攀爬柱 vs 設施幾何」)。
 * `yAuth` = 攀爬柱那一端(權威站立面)、`measured` = 生成期實測的結構實體頂面(`b.ty`;缺 = null)。
 * 只准把設施往結構那一側收(measured ≥ yAuth 一律不理:設施 MUST NOT 長得比攀爬柱高),
 * 且落差夾在 `GRAB_UP` 內 —— 那是「自頂緣走出去仍抓得到」的容差,設施端點與站立面的落差
 * 超出它就不再是同一段路線了(碰撞柱高過實體太多是結構自己的事,寧可留一小截也不要斷開)。
 */
export function facilityEndY(yAuth, measured) {
  if (measured == null || !(measured < yAuth)) return yAuth;
  return Math.max(measured, yAuth - CLIMB.GRAB_UP);
}

// ---------------------------------------------------------------------------
// 路線規劃
// ---------------------------------------------------------------------------

/**
 * 規劃攀爬路線。純幾何 + 一支確定性 rnd,無 THREE 依賴 ⇒ 稽核可直接執行本函式原文。
 *
 * @param blockers  全部碰撞柱(建物/神木/巨岩/橋墩…;候選由 climbCandidate 篩)
 * @param heightAt  (x,z) → 地表高
 * @param envCodeAt (x,z) → 0 乾 / 1 水 / 2 沼(地面端 MUST 是乾地)
 * @param bounds    { minX, maxX, minZ, maxZ }
 * @param rnd       mulberry32(確定性;每個候選固定消耗 3 枚)
 * @returns 路線陣列 [{ b, kind, x, z, nx, nz, fx, fz, y0, y1, vy0, vy1, bx, bz, tx, tz }];
 *          相鄰相接的那一條另帶 `link`(接到的低者)與 `pair`(去重鍵)。
 *          `y0/y1` = 攀爬柱(權威站立面)、`vy0/vy1` = 設施幾何兩端(貼齊可見實體面),見檔頭。
 */
export function planClimbRoutes({ blockers, heightAt, envCodeAt, bounds, rnd }) {
  const list = blockers || [];
  // 障礙查詢網格:候選 × 16 方位逐一問「附近有沒有別的碰撞體」,線性掃全表會是 O(n²)
  const CELL = 32, grid = new Map();
  for (const b of list) {
    const rr = (b.hw2 != null ? Math.hypot(b.hw2, b.hd2) : b.r) + CLIMB.CLEAR_R;
    const i0 = Math.floor((b.x - rr) / CELL), i1 = Math.floor((b.x + rr) / CELL);
    const j0 = Math.floor((b.z - rr) / CELL), j1 = Math.floor((b.z + rr) / CELL);
    for (let i = i0; i <= i1; i++) {
      for (let j = j0; j <= j1; j++) {
        const k = i * 65536 + j;
        let arr = grid.get(k); if (!arr) grid.set(k, arr = []); arr.push(b);
      }
    }
  }
  /** (x,z) 到某個碰撞體表面的最短距離(體內為負) */
  const surfDist = (o, x, z) => {
    if (o.hw2 == null) return Math.hypot(x - o.x, z - o.z) - o.r;
    const cs = Math.cos(o.ry), sn = Math.sin(o.ry);
    const rx = x - o.x, rz = z - o.z;
    const lx = Math.abs(rx * cs + rz * sn) - o.hw2, lz = Math.abs(-rx * sn + rz * cs) - o.hd2;
    return Math.hypot(Math.max(0, lx), Math.max(0, lz)) + Math.min(0, Math.max(lx, lz));
  };
  /** (x,z) 到「其他碰撞體」表面的最短距離(self / self2 不算);全空回 Infinity */
  const clearance = (x, z, self, yLo, yHi, self2) => {
    const arr = grid.get(Math.floor(x / CELL) * 65536 + Math.floor(z / CELL));
    if (!arr) return Infinity;
    let best = Infinity;
    for (const o of arr) {
      if (o === self || o === self2) continue;
      if (o.y + o.h < yLo || o.y > yHi) continue;          // 垂直不重疊 = 不擋這條通道
      const d = surfDist(o, x, z);
      if (d < best) best = d;
    }
    return best;
  };
  /** b 周邊 pad 公尺內登記過的碰撞體(掃 b 的 bbox 擴張範圍,去重);相鄰判定用 */
  const nearby = (b, pad) => {
    const rr = (b.hw2 != null ? Math.hypot(b.hw2, b.hd2) : b.r) + pad;
    const i0 = Math.floor((b.x - rr) / CELL), i1 = Math.floor((b.x + rr) / CELL);
    const j0 = Math.floor((b.z - rr) / CELL), j1 = Math.floor((b.z + rr) / CELL);
    const out = new Set();
    for (let i = i0; i <= i1; i++) {
      for (let j = j0; j <= j1; j++) {
        const arr = grid.get(i * 65536 + j);
        if (arr) for (const o of arr) if (o !== b) out.add(o);
      }
    }
    return out;
  };

  const routes = [];
  const linked = new Set();   // 已相接的結構對(高者 → 低者),避免 A→B 與 B→A 生成兩條同樣的路線
  for (const b of list) {
    // 抽樣紀律(A4/§2.3):**先抽固定 4 枚**(抽中與否、方位起相位、相鄰相接、高側取捨),
    // 淘汰檢查一律排在抽樣之後。後三枚即使沒掛成路線也照抽 ⇒ 每個候選的消耗量恆定。
    const pick = rnd();
    const phase = rnd() * Math.PI * 2;
    const linkRoll = rnd();
    const faceRoll = rnd();
    if (!climbCandidate(b)) continue;
    // 抽中門檻隨**該地的地形陡度**放寬:平緩帶 = 基準機率,阻擋角(爬不上去)= 100%。
    // 量測純函式不消耗亂數 ⇒ 排在四枚抽樣之後仍不影響序列(§2.3);
    // 地面路線與**相鄰相接**共用同一份量測(同一個地點只量一次,也保證兩道閘同調)。
    const deg = siteSlopeDeg(b, heightAt);
    if (pick >= climbShare(deg)) continue;

    const baseY = heightAt(b.x, b.z);
    const y1 = b.y + b.h;                     // = makeBlockerTopIndex 的頂面高(唯一縫)
    // 先把每一面的落腳點與地表高量出來:「等高線相對最高的是哪一面」要看過全部候選才知道
    // (逐面邊掃邊比會把「最高」誤判成「目前為止最高」)。出圖界的面不進來 —— 它本來就掛不上,
    // 讓它參與比較會把真正掛得上的那一面誤標成高側。
    const faces = [];
    for (const sp of attachFaces(b, phase)) {
      const x = sp.fx + sp.nx * CLIMB.OFF, z = sp.fz + sp.nz * CLIMB.OFF;
      if (x < bounds.minX + 45 || x > bounds.maxX - 45 || z < bounds.minZ + 45 || z > bounds.maxZ - 45) continue;
      faces.push({ ...sp, x, z, gy: heightAt(x, z) });
    }
    // 高側取捨(2026-08-01 使用者需求):掛在「等高線相對最高那一面」的機率隨陡度降到 0%。
    // 四面等高(平地/平台)時沒有「最高面」⇒ `hi > lo` 先擋掉,一律不排除任何一面。
    let hiY = -Infinity, loY = Infinity;
    for (const f of faces) { if (f.gy > hiY) hiY = f.gy; if (f.gy < loY) loY = f.gy; }
    const dropHigh = hiY > loY && faceRoll >= highFaceShare(deg);
    let best = null;
    for (const f of faces) {
      if (dropHigh && f.gy >= hiY - 1e-9) continue;                 // 這一面是高側,本次擲骰不掛
      if (Math.abs(f.gy - baseY) > CLIMB.STEP) continue;            // 斜坡側:落腳點與基座差太多
      if (envCodeAt(f.x, f.z) !== 0) continue;                      // 水域/沼澤不是「無障礙」
      const cl = clearance(f.x, f.z, b, f.gy, y1);
      if (cl < CLIMB.CLEAR_R) continue;                             // 被別的建物/巨岩/橋墩擋住
      // 取淨空最大的那一側(嚴格大於 ⇒ 同分時取先掃到的,序列確定)
      if (!best || cl > best.cl) best = { ...f, cl };
    }
    if (!best) continue;                                            // 四面都有障礙 → 寧缺勿錯,不掛路線

    // 登頂落腳點:自表面點往結構內側踏進(夾在該方向半徑的 80% 內,細瘦結構不會踏過頭)
    const step = Math.min(CLIMB.TOP_STEP, best.rad * 0.8);
    routes.push({
      b,
      kind: CLIMB_KIND[b.cl] || 'ladder',
      x: best.x, z: best.z,                   // 攀爬軸(結構表面外 OFF)
      nx: best.nx, nz: best.nz,               // 向外法線
      fx: best.fx, fz: best.fz,               // 結構表面附著點
      gap: best.gap || 0,                     // 碰撞面 → 實際可見岩面的內縮量(設施貼實體那一面)
      arm: best.arm || 0,                     // 頂端處還差多少才碰到結構(頂端錨件的跨接臂長)
      y0: best.gy,                            // 地面端
      y1,                                     // 頂端(= surfaceAt 認得的站立面)
      vy0: best.gy,                           // 設施底端 = 地面(地面路線兩者同值)
      vy1: facilityEndY(y1, b.ty),            // 設施頂端:貼齊實測的實體屋頂(碰撞柱刻意高一截)
      bx: best.x, bz: best.z,                 // 下端落腳點(地面路線 = 攀爬軸本身)
      tx: best.fx - best.nx * step,           // 登頂落腳點(結構內側)
      tz: best.fz - best.nz * step,
    });

    // ---- 相鄰結構相接(平地七成,陡地形同樣往上調到 100%;與地面路線同一支曲線)----
    if (linkRoll < climbShare(deg, CLIMB.LINK)) {
      const link = planLink(b, { nearby, clearance, surfDist, bounds, linked });
      if (link) { routes.push(link); linked.add(link.pair); }
    }
  }
  return routes;
}

/**
 * 把「已掛路線的結構 b」與**相鄰**結構的頂面接起來:設施架在**較高者**的牆面上,下端落腳在
 * 較低者的**屋頂**(而不是地面)—— 資料形狀與一般路線完全相同(`y0` 換成低頂高、`bx/bz` 換成
 * 低頂落腳點),故 `makeClimbIndex` / `game.js _stepClimb` / 提示箭頭**一行都不必改**。
 *
 * 幾何硬約束(不滿足就不架 —— §4 寧缺勿錯):
 *   ① 兩者表面距離 ≤ `LINK_GAP`(真的相鄰;太遠的話從低頂根本搆不到高牆上的梯子)
 *   ② 兩頂高差 ≥ `LINK_DROP`(低於此是一階台階,不是垂直通道)
 *   ③ 低頂落腳點與攀爬軸的水平距離 < `GRAB_R`(**站在低頂上要抓得到**;這條是①的真正理由)
 *   ④ 攀爬軸在 [低頂, 高頂] 區間內不被第三座結構擋住、且不出圖界
 * 設施型別跟著**架設面所屬的結構**走(神木 → 技術繩、巨石 → 抓點、建物 → 長梯),與一般路線同一張表。
 */
function planLink(b, { nearby, clearance, surfDist, bounds, linked }) {
  let best = null;
  for (const o of nearby(b, CLIMB.LINK_GAP)) {
    if (!o.bld && !o.std) continue;                                  // 只接「頂面站得住」的結構
    const [H, L] = (b.y + b.h) >= (o.y + o.h) ? [b, o] : [o, b];     // H 高者(架設面)/ L 低者(落腳)
    const y1 = H.y + H.h, y0 = L.y + L.h;
    if (y1 - y0 < CLIMB.LINK_DROP) continue;                         // ② 高差不足
    const pair = `${H.x},${H.z},${H.h}|${L.x},${L.z},${L.h}`;
    if (linked.has(pair)) continue;                                  // A→B 與 B→A 只留一條
    const dx = L.x - H.x, dz = L.z - H.z;
    if (!dx && !dz) continue;                                        // 同心(不該發生)
    const dl = Math.hypot(dx, dz);
    // 高者**面向低者的那個正面**:候選集與一般路線同一支 attachFaces(同樣不准斜角),
    // 取法線最朝向低者的那一面(MUST NOT 直接拿「指向低者的方位」去射盒面 —— 那會落在牆角)
    let sp = null, dot = -Infinity;
    for (const f of attachFaces(H)) {
      const d = (f.nx * dx + f.nz * dz) / dl;
      if (d > dot) { dot = d; sp = f; }
    }
    if (!sp || dot <= 0) continue;
    const gap = surfDist(L, sp.fx, sp.fz);                           // ① 兩表面距離(重疊為負)
    if (gap > CLIMB.LINK_GAP) continue;
    const x = sp.fx + sp.nx * CLIMB.OFF, z = sp.fz + sp.nz * CLIMB.OFF;
    if (x < bounds.minX + 45 || x > bounds.maxX - 45 || z < bounds.minZ + 45 || z > bounds.maxZ - 45) continue;
    // 低頂落腳點:自低者「面向攀爬軸」的那一面往內踏進(細瘦結構夾在 rad×0.8 內)
    const lp = surfacePoint(L, Math.atan2(z - L.z, x - L.x));
    const lstep = Math.min(CLIMB.LINK_STEP, lp.rad * 0.8);
    const bx = lp.fx - lp.nx * lstep, bz = lp.fz - lp.nz * lstep;
    if (Math.hypot(bx - x, bz - z) > CLIMB.GRAB_R - 0.2) continue;    // ③ 站在低頂上抓不到 → 不架
    if (clearance(x, z, H, y0, y1, L) < CLIMB.CLEAR_R) continue;      // ④ 第三座結構擋在通道上
    // 高差最大的那一位優先(爬得最有價值);嚴格大於 ⇒ 同分取先掃到的,序列確定
    if (!best || y1 - y0 > best.drop) best = { H, L, y0, y1, sp, x, z, bx, bz, pair, drop: y1 - y0 };
  }
  if (!best) return null;
  const step = Math.min(CLIMB.TOP_STEP, best.sp.rad * 0.8);
  return {
    b: best.H, link: best.L, pair: best.pair,
    kind: CLIMB_KIND[best.H.cl] || 'ladder',
    x: best.x, z: best.z,
    nx: best.sp.nx, nz: best.sp.nz,
    fx: best.sp.fx, fz: best.sp.fz,
    gap: best.sp.gap || 0, arm: best.sp.arm || 0,
    y0: best.y0,                              // 下端 = 低者的頂面(= blockerTopAt 的回傳值)
    y1: best.y1,                              // 上端 = 高者的頂面
    // 設施兩端各自貼齊該座結構的**實體**面(兩端的碰撞柱都比實體高一截 ⇒ 兩端都要收):
    // 上端收到高者的屋頂、下端**往下延伸**到低者的屋頂(不然梯腳浮在低頂上方半公尺)
    vy0: facilityEndY(best.y0, best.L.ty),
    vy1: facilityEndY(best.y1, best.H.ty),
    bx: best.bx, bz: best.bz,                 // 下端落腳點(低者屋頂內側)
    tx: best.sp.fx - best.sp.nx * step,       // 上端落腳點(高者屋頂內側)
    tz: best.sp.fz - best.sp.nz * step,
  };
}

// ---------------------------------------------------------------------------
// 執行期查詢索引
// ---------------------------------------------------------------------------

/**
 * (x, z, y) → 可抓握的路線 | null。水平在 GRAB_R 內、垂直落在 [y0 − 1, y1 + GRAB_UP] 內即命中;
 * 同格多條取水平最近。**不含「推杆朝向路線」的意圖判定** —— 那是輸入層的事,住 game.js。
 */
export function makeClimbIndex(routes) {
  const list = routes || [];
  if (!list.length) return () => null;
  const CELL = 32, grid = new Map();
  for (const r of list) {
    const i0 = Math.floor((r.x - CLIMB.GRAB_R) / CELL), i1 = Math.floor((r.x + CLIMB.GRAB_R) / CELL);
    const j0 = Math.floor((r.z - CLIMB.GRAB_R) / CELL), j1 = Math.floor((r.z + CLIMB.GRAB_R) / CELL);
    for (let i = i0; i <= i1; i++) {
      for (let j = j0; j <= j1; j++) {
        const k = i * 65536 + j;
        let arr = grid.get(k); if (!arr) grid.set(k, arr = []); arr.push(r);
      }
    }
  }
  return (x, z, y) => {
    const arr = grid.get(Math.floor(x / CELL) * 65536 + Math.floor(z / CELL));
    if (!arr) return null;
    let best = null, bd = CLIMB.GRAB_R;
    for (const r of arr) {
      if (y < r.y0 - 1 || y > r.y1 + CLIMB.GRAB_UP) continue;
      const d = Math.hypot(x - r.x, z - r.z);
      if (d <= bd) { bd = d; best = r; }
    }
    return best;
  };
}

// ---------------------------------------------------------------------------
// 3D 幾何(純表現層)
// ---------------------------------------------------------------------------
// A25:高頻/大量物件一律「單位幾何 + scale」+ InstancedMesh,共用幾何一律 markShared()
// (整場共用的那份被 disposeTree 放掉 ⇒ 所有借用者變空白)。三種設施各 2~3 個 draw call。

const UNIT = {};
const unitBox = () => (UNIT.box ??= markShared(new THREE.BoxGeometry(1, 1, 1)));
const unitCyl = () => (UNIT.cyl ??= markShared(new THREE.CylinderGeometry(0.5, 0.5, 1, 6)));
const unitIco = () => (UNIT.ico ??= markShared(new THREE.IcosahedronGeometry(0.5, 0)));

const MAT = {
  ladder: () => envMat(0x8d9299, { wash: 0.3, cool: 0.5 }),   // 鍍鋅鋼梯
  holds:  () => envMat(0xd8622f, { wash: 0.35, cool: 0.3 }),  // 岩場抓點(橘色樹脂)
  rope:   () => envMat(0xd9cf9a, { wash: 0.4, cool: 0.35 }),  // 米色編織繩
  anchor: () => envMat(0x6f757c, { wash: 0.3, cool: 0.5 }),   // 固定件(繩錨 / 梯腳)
};

/**
 * 建攀爬設施幾何。每條路線沿「攀爬軸」自 vy0 立到 vy1,朝向由該路線的向外法線 `nx/nz` 推 ——
 * A26:擺位方向與旋轉方向 MUST 同調,設施一律 `ry = atan2(nx, nz)`(local +z 指向法線外側),
 * **MUST NOT** 在此另算一次中央差分法線。回傳 THREE.Group(空路線回 null)。
 *
 * 垂直範圍吃的是 **`vy0/vy1`(設施端點,貼齊可見實體面)而非 `y0/y1`(攀爬柱)** —— 碰撞柱
 * 刻意高過實體(見檔頭),照 y1 畫就是使用者回報的「屋頂不平的建築,長梯會過高」。
 * 兩者的分工 MUST NOT 反過來:攀爬狀態機 / 抓握索引一律吃 y0/y1。
 */
export function buildClimbMeshes(routes) {
  const list = routes || [];
  if (!list.length) return null;
  const g = new THREE.Group();
  g.name = 'climbRoutes';

  const M = new THREE.Matrix4(), Q = new THREE.Quaternion(), E = new THREE.Euler();
  const P = new THREE.Vector3(), S = new THREE.Vector3();
  const put = (bucket, x, y, z, ry, sx, sy, sz) => {
    E.set(0, ry, 0); Q.setFromEuler(E); P.set(x, y, z); S.set(sx, sy, sz);
    bucket.push(M.clone().compose(P, Q, S));
  };
  const rails = [], rungs = [], holds = [], ropes = [], anchors = [];

  for (const r of list) {
    const ry = Math.atan2(r.nx, r.nz);          // local +z = 向外法線(擺位與旋轉同調)
    const y0 = r.vy0 ?? r.y0, y1 = r.vy1 ?? r.y1;   // 設施端點(貼齊實體面;見本函式檔頭)
    const H = Math.max(1, y1 - y0);
    const midY = (y0 + y1) / 2;
    // 設施貼在結構表面外緣一點點(軸在表面外 OFF,設施本體貼牆 → 玩家爬在設施「外側」)。
    // `gap` = 碰撞面到**可見實體面**的內縮量(巨岩:碰撞圓比岩面大;建物 = 0):設施吃它才會
    // 真的靠在岩面上而不是浮在碰撞圈上;`gap ≤ 最大機體碰撞半徑`(生成期驗過)⇒ 機體仍貼著設施。
    const off = 0.35 - r.gap;
    const sx = r.fx + r.nx * off, sz = r.fz + r.nz * off;
    // 頂端錨件的跨接臂:結構頂端比路線半徑細(神木幹身向上收窄)時,錨件 MUST 伸回結構上
    // (否則「繩子吊在半空、上面什麼都沒有」)。arm = 頂端處還差多少,0 = 貼齊的結構。
    const arm = Math.max(0, r.arm);
    // 錨件由「咬進結構 0.2m」跨到「設施外側」:長度與中心位移一併由兩端推導,MUST NOT 手寫
    const anch = (inner, outer, w, h) => {
      const i0 = -(arm + inner), o0 = off + outer;   // 內端(咬進結構)/ 外端(蓋住設施),沿法線
      const L = o0 - i0, c = (i0 + o0) / 2;
      return { L, cx: r.fx + r.nx * c, cz: r.fz + r.nz * c, w, h };
    };
    if (r.kind === 'ladder') {
      for (const s of [-1, 1]) {                // 兩根立桅
        put(rails, sx + -r.nz * s * 0.42, midY, sz + r.nx * s * 0.42, ry, 0.12, H, 0.12);
      }
      const n = Math.min(320, Math.floor(H / CLIMB.RUNG));
      for (let i = 1; i <= n; i++) put(rungs, sx, y0 + i * CLIMB.RUNG, sz, ry, 0.92, 0.09, 0.09);
      const A = anch(0.2, 0.32, 1.1, 1.1);      // 頂端護框(跨接臂把框接回結構)
      put(anchors, A.cx, y1 + 0.55, A.cz, ry, A.w, A.h, A.L);
    } else if (r.kind === 'holds') {
      const n = Math.min(200, Math.floor(H / CLIMB.HOLD));
      for (let i = 1; i <= n; i++) {            // 左右交錯的抓點(攀岩路線的手點/腳點)
        const s = i % 2 ? 1 : -1;
        put(holds, sx + -r.nz * s * 0.34, y0 + i * CLIMB.HOLD, sz + r.nx * s * 0.34, ry, 0.5, 0.34, 0.5);
      }
      const A = anch(0.2, 0.15, 0.8, 0.5);      // 頂端確保站
      put(anchors, A.cx, y1 + 0.45, A.cz, ry, A.w, A.h, A.L);
    } else {
      put(ropes, sx, midY, sz, ry, 0.16, H, 0.16);                                          // 主繩
      const n = Math.min(120, Math.floor(H / CLIMB.KNOT));
      for (let i = 1; i <= n; i++) put(anchors, sx, y0 + i * CLIMB.KNOT, sz, ry, 0.3, 0.16, 0.3);  // 繩結
      const A = anch(0.2, 0.8, 0.7, 0.28);      // 頂端繩錨(懸臂樑:自幹身伸出來吊住主繩)
      put(anchors, A.cx, y1 + 0.4, A.cz, ry, A.w, A.h, A.L);
    }
  }

  // 材質每型別各一份(rails/rungs 共用鋼梯那一份;每建一次戰場一組,隨 disposeTree 回收)
  const mats = { ladder: MAT.ladder(), holds: MAT.holds(), rope: MAT.rope(), anchor: MAT.anchor() };
  const add = (mtx, geo, mat) => {
    if (!mtx.length) return;
    const im = new THREE.InstancedMesh(geo, mat, mtx.length);
    mtx.forEach((m, i) => im.setMatrixAt(i, m));
    im.instanceMatrix.needsUpdate = true;
    im.frustumCulled = false;      // 逐路線散布全圖,單一 bbox 剔除會整批消失
    im.userData.noOutline = true;  // 細桿描邊會糊成一團
    g.add(im);
  };
  add(rails, unitBox(), mats.ladder);
  add(rungs, unitBox(), mats.ladder);
  add(holds, unitIco(), mats.holds);
  add(ropes, unitCyl(), mats.rope);
  add(anchors, unitBox(), mats.anchor);
  buildClimbArrows(g, list);
  return g;
}

/**
 * 上下兩端的提示箭頭(見 `CLIMB_ARROW`)。掛在同一個 group 底下,動畫函式放進
 * `group.userData.update(dt)` —— `biomes.js` 把它併進既有的 `dynamics` 桶(火車/瀑布同一條路徑),
 * `main.js → terrain.biomesUpdate → game.js` 每幀驅動,**MUST NOT** 在 game.js 另開第二條更新迴圈。
 *
 * 姿態由三個世界向量直接組基底(A26:擺位方向與旋轉方向同調,**MUST NOT** 手寫歐拉角鏡射式):
 *   桿的延伸方向 `d`(自頂點往後)= −行進方向·cos(SPREAD) ± 切向·sin(SPREAD);
 *   幾何自頂點朝 local −z 延伸 ⇒ **Z 軸 = −d**;貼片正面朝外 ⇒ **Y 軸 = 向外法線**;X = Y × Z。
 */
function buildClimbArrows(g, list) {
  const A = CLIMB_ARROW;
  const bars = { up: [], down: [] };            // 逐根桿的靜態資料(位置每幀重算)
  for (const r of list) {
    const tx = -r.nz, tz = r.nx;                // 切向(與向外法線正交的水平向量)
    const ax = r.x + r.nx * A.OUT, az = r.z + r.nz * A.OUT;
    // 起算高刻意吃 `y0/y1`(攀爬柱)而非設施端點:箭頭標的是「人站在哪裡上/下」——
    // 底端 = 落地點、頂端 = 站立面,兩者都是攀爬柱的端點(設施端點貼的是可見實體面)
    for (const [key, dir, y0] of [['up', 1, r.y0 + A.FOOT], ['down', -1, r.y1 + A.HEAD]]) {
      for (let i = 0; i < A.N; i++) {
        for (const s of [-1, 1]) {              // chevron 的左右兩根桿
          bars[key].push({ ax, az, y0, dir, s, tx, tz, nx: r.nx, nz: r.nz, ph: (i / A.N) * A.RUN });
        }
      }
    }
  }
  if (!bars.up.length) return;

  // 單位桿:自頂點朝 local −z 延伸(與兵線 chevron 同一款幾何,只是尺寸縮到約 1/3)
  const geo = (UNIT.bar ??= markShared(new THREE.BoxGeometry(1, 1, 1).translate(0, 0, -0.5)));
  const mk = (color, n) => {
    const im = new THREE.InstancedMesh(geo, new THREE.MeshBasicMaterial({
      color, transparent: true, opacity: 0.9, depthWrite: false,
    }), n);
    im.frustumCulled = false;
    im.renderOrder = 3;              // 與兵線箭頭同層:壓在地物之上但不遮 HUD
    im.userData.noOutline = true;
    g.add(im);
    return im;
  };
  const im = { up: mk(A.UP, bars.up.length), down: mk(A.DOWN, bars.down.length) };

  const M = new THREE.Matrix4();
  const X = new THREE.Vector3(), Y = new THREE.Vector3(), Z = new THREE.Vector3(), P = new THREE.Vector3();
  const cs = Math.cos(A.SPREAD), sn = Math.sin(A.SPREAD);
  let t = 0;
  const step = (dt) => {
    t += dt;
    for (const key of ['up', 'down']) {
      const arr = bars[key], mesh = im[key];
      for (let i = 0; i < arr.length; i++) {
        const b = arr[i];
        const flow = (t * A.SPD + b.ph) % A.RUN;                 // 沿行進方向前送後回捲
        const edge = Math.min(1, flow / A.FADE, (A.RUN - flow) / A.FADE);
        const sc = 0.35 + 0.65 * Math.max(0, edge);              // 兩端淡入淡出(縮小)
        // 行進方向 u = (0, dir, 0)、切向 t = (tx, 0, tz);桿自頂點往後延伸 d = −u·cos + s·t·sin,
        // 幾何朝 local −z 延伸 ⇒ Z = −d(已是單位向量,且與水平法線 Y 正交 ⇒ 兩個 normalize 都省得掉)
        Z.set(-b.s * b.tx * sn, b.dir * cs, -b.s * b.tz * sn);
        Y.set(b.nx, 0, b.nz);
        X.crossVectors(Y, Z);
        Z.multiplyScalar(A.BAR * sc); X.multiplyScalar(A.W * sc); Y.multiplyScalar(A.T);
        P.set(b.ax, b.y0 + b.dir * flow, b.az);
        M.makeBasis(X, Y, Z).setPosition(P);
        mesh.setMatrixAt(i, M);
      }
      mesh.instanceMatrix.needsUpdate = true;
    }
  };
  step(0);                                        // 首幀就位(還沒進戰場也不會是一堆疊在原點的桿)
  g.userData.update = step;
}
