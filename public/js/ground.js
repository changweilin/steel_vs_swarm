// ============ 地被覆蓋層:開闊地的賽璐璐地表精修(doc/botw_plan.html)============
// 無障礙的空曠地面也要有「畫上去的地表」:依地貌分類鋪設特徵色塊(patch)+
// 立體細節,取代裸露衛星照片質感。50 種地表 × 每種 6 變體貼圖,像無限隨機花磚:
//   綠地   — 草皮 / 芒草原 / 灌木叢 / 水田 / 旱田 / 花田 / 果園 / 茶園 / 箭竹林
//            / 枯木林 / 混亂倒木 / 砍伐跡地 / 木材堆置場 / 腐朽木屋 / 葡萄園 / 溫室棚
//   裸露地 — 荒野 / 碎石 / 沙漠風沙 / 越野泥地 / 龜裂旱地 / 紅土地 / 倒塌石板屋
//            / 死林 / 乾草原 / 廢棄農田 / 鹽田 / 採石場
//   高地   — 高原 / 岩屑坡 / 冰原(相對高程觸發;冬季裸露地也混入冰原)
//   市區   — 草坪 / 水泥地 / 磚瓦地 / PU 球場 / 停車場 / 人行道磚 / 跑道 / 廢棄工地
//            / 加油站 / 公園 / 廣場 / 廢車場 / 貨櫃場 / 墓園 / 太陽能場 / 直升機坪
//   濕地   — 泥灘蘆葦 / 荷塘 / 魚塭
// 雙層結構(2026-07-10 改制):
//   底毯層 — 抖動網格把「全部陸地」鋪滿(不留衛星底圖空隙):角點以格點雜湊
//            抖動且相鄰 cell 共用 → 水密無縫;**2026-08-13 起「畫什麼」與「畫在哪些三角形
//            上」分家** —— 規劃格照舊(含抖動),發射改成逐地形四邊形認養主人格(emitCell
//            檔頭)⇒ 皮的三角形 === 地形的三角形、共面、斜坡破圖恆 0,圖內底毯因此不再
//            套貼合抬升;地表種類由低頻雜訊分區指派成大片
//            連續區域(2026-08-12 改制:**顏色與花紋分家** —— 款(顏色)的取值點量化成
//            選款區塊 carpetLotAt,同一種地貌裡至少走過一個 lot 才換色;變體(花紋)改由
//            planCarpetVariants 逐格挑成「共邊同款恆不同」,同款異變體共用底色 baseFill
//            且不發交界外溢);異類交界疊「角點隸屬度雙線性外溢」做兩格寬對稱 cross-fade
//            (planSeamOverlays,含對角鄰格;2026-07-29 邊界鋸齒改制,詳該函式檔頭),
//            交界樣態逐分區組合查表(SEAM_STYLES:市區界明確壓窄 / 生態界寬淡出
//            + 間歇中間過渡帶(乾草原/蘆葦/泥灘脊帶)/ 雪線斑塊 dither / 其餘柔和),
//            過渡帶再以準晶體場擾動出手繪碎形邊,無硬縫、無 90° 階梯。
//   特徵層 — 原 patch 散佈,降級為「場所」點綴(農田/球場/遺跡/工地…),
//            疊在底毯上;fade 邊融入底毯、ink 邊讀作田埂/路緣,不再是磁磚縫。
//   界線拼圖 — 異「地表」大區塊交界再鋪一條分界線(2026-08-11 使用者需求):
//            planBorderPuzzle 把交界邊鏈成 16 方向直線/轉彎/岔路拼圖(卡卡頌語彙),
//            逐交界對配專屬圖案(步道小徑/林道/碎石土徑/田埂/水溝/小溪/圍籬/灌木矮牆/
//            沙灘/岩塊/紅樹林),異種類切點共用 = 接力連結;取代舊「邊界遮蔽物」。
//            轉彎與岔路是**整片畫出來的接頭拼圖**(直段先退縮讓位;圓弧與兩臂相切 /
//            逐臂楔形在中心交會),MUST NOT 退回「把直段對接再貼墊片」。
//            2026-08-11 使用者回報四項的改法(細節見各縫檔頭):①繞向唯一縫 sweepUpY ——
//            舊制每一片直段的正面都朝下,DoubleSide 把法線反轉成死黑,而轉彎隨 sweep
//            正負忽明忽暗 =「分界線顏色不連續」;②界線是**結構**、拼圖是點綴 ⇒ 田/停車場/
//            球場/3D 擺件先讓開(tryPatch/addDetail 的 bdCross),不是界線讓路;③兩側地貌
//            的換手改吃「到畫出來的線」的帶號距離(borderCutAlpha),橫跨界線的中間過渡
//            脊帶不出 ⇒ 恰以線為界;④帶加寬(每種都有貼地帶)、圖案加細、帶緣沿世界座標
//            起伏(中心線仍是直的)、接力短 run 併回鄰段(不再每格換一次色)。
// 無縫拼接原則(避免大面積重複感,無限延伸;2026-07-12 反重複改制):
//   1. 自然類 edge:'fade' — 外圈頂點 alpha 淡出,與底毯(或彼此)交融
//   2. 底毯 tile 型 UV 用世界座標投影 + 鏡射重複:同類相鄰花紋自動連續延伸;
//      特徵 patch 的 blob UV 每塊隨機旋轉 + rect fit 隨機鏡射(U/V)→ 同款不同貌
//   3. 低頻水彩 wash 頂點色 + 家族延伸擺放(農田拼布/運動園區/綠地群落)
//   4. 特徵拼圖不疊置:**功能性區塊(edge:'ink' 的田/停車場/球場…)量真實足跡零重疊**
//      (footNear + PATCH_GAP;2026-08-11 使用者定案),自然類彼此才容邊緣小比例交疊
//      (SEP_F 圓近似,fade 邊互融是刻意的);且英雄視野(VIS_R)內同款「地表#變體」
//      只准出現一次,同款用罄輪替其他變體/地表。3D 物件同樣互不穿模、且不站進別人的區塊。
//   5. 特徵層分區走純圖資分類(classifyPure,不吃場地 mix 隨機改寫)→
//      球場/停車場只落市區、水田/果園只落綠地、沙漠/碎石只落裸露地
//   6. 整齊度沿路對齊(2026-07-23):每型拼圖/物件帶 reg(0..1)整齊規律程度,
//      越規律越高機率沿最近道路方向擺放(DEFS.reg / REG 表 + opts.roadDirAt),
//      其餘機率(或附近無路)維持隨機朝向;自然件 reg=0 恆隨機
// 規律/不規律雙軌拼貼(2026-07-25 使用者需求):
//   7. 規律結構(ink rect、reg≥0.7:停車場/球場/太陽能板/稻田/農田)沿道路兩側主動鋪
//      「連續等尺寸格陣」(layRegularArrays + opts.roadPolys):鎖路向、同陣列共 rot、法線
//      偏移讓開路面 → 街廓般整齊;近路規律型交陣列,遠路/無路退回主迴圈隨機散佈。
//   8. 不規律(自然:草木/風沙碎石)走準晶體概念(qcVal 五向平面波、十重對稱非週期):
//      底毯角點位移(cornerAt,保 (i,j) 純函數 = 水密)+ 選格群聚(cellSubAt)+ 主散佈
//      候選點陣(全循環雙射走訪)+ 細節 blue-noise 微推(qcNudge)皆吃同一場 → 無方格重複感。
//  10. 緩衝空間(2026-08-12 使用者需求):圖界之外那一圈裙也鋪底毯 —— 分區與選款鏡射回圖內
//      取(接縫恆等)、格距放粗 BUF_CELL_F 倍、高度走 terrain.bufferHeightAt、角點抖動 +
//      交界外溢照走(少了這兩樣,粗格 + 硬邊就是一床方塊拼被),但界線拼圖/特徵拼圖/3D 細節
//      都不進去;發射進圖內同一批 buckets ⇒ 一個 draw call 都沒有多。
//   9. 圖層交會分級(lift):底毯 < 外溢 < 不規律 fade < 規律 ink,規律再依所對齊道路分級
//      (opts.roadRank)抬高 = 大馬路 > 小馬路,整體仍 < 道路;規律↔規律 overlapPs 全分離
//      (INK_SEP_F)不破壞結構完整性(停車場不疊球場)。
// 手法與 buildRoads 同族:貼地多邊形 + 程序生成 canvas 筆刷貼圖 + 頂點色墨線,
// 每「地表×變體」合併成單一 Mesh(常數 draw call);細節物件全 InstancedMesh。
// 純視覺:不進射擊 raycast、不描邊、不產生碰撞柱(空地依然自由通行)。
// 亂數決定性:呼叫端傳入以戰場中心為種子的 rnd + seed,全房間一致。
import * as THREE from 'three';
import { ENV, inkCtrM } from './data.js';
import { envMat, surfGroup } from './toon.js';
import { gridAngle } from './roadgrid.js';

const MAX_DETAIL = 19000;  // 3D 細節實例總上限(特徵層 + 底毯撒佈;全 InstancedMesh,draw call 不變;
                           // 2026-07-12 15000→19000:綠地雜草/花帶密集散佈需要更多實例配額)
const FEAT_DETAIL = 12000; // 特徵層細節配額;剩餘留給底毯,空地才不會光禿
const VARIANTS = 6;        // 每種地表的貼圖變體數(變體貼圖惰性生成,只有實際用到才建;
                           // 2026-07-12 4→6:視野內同款不重複需要更多款式輪替)
const CARPET_VARIANTS = 3; // 底毯的變體數(逐格互異,planCarpetVariants):同款每多一個變體就多
                           // 一個 mesh(每 `sub#variant` 一批),而本渲染器是 draw call 瓶頸;
                           // **3 是共邊全異的下界**(共邊鄰最多兩格已定案 ⇒ 恆挑得到第三個)
const BUF_CELL_F = 3;      // 緩衝空間底毯的格距倍率(× cell):那一圈離可玩區 40m 以上、最遠
                           // 455m,細節看不到 —— 原尺寸鋪滿要多兩倍半的格子(純 overdraw)
const RSCALE = 1.3;        // 特徵 patch 半徑全域放大
const VIS_R = 300;         // 反重複半徑 = 英雄最大視野(UNITS.drone.sight)
const SEP_F = 0.85;        // **自然類**拼圖間距係數(圓近似):d ≥ (r1+r2)×0.85,僅容邊緣小比例交疊(fade 邊互融,刻意)
const INK_SEP_F = 1.06;    // 廣相搜尋半徑用的保守係數(舊制的規律↔規律圓近似係數;精判已改真實足跡,見 footNear)
// ==== 功能性區塊 / 3D 物件的「不可互相重疊」(2026-08-11 使用者定案)====
// 「田/停車場/球場這類功能性區塊與 3D 物件等等也不可互相重疊」。三件事分開量:
//   ① 功能性區塊(edge:'ink' 的田/停車場/球場/廣場/太陽能場…)對**任何**拼圖零重疊 ——
//      判定改吃**真實足跡**(rect = 有向盒、blob = 手繪輪廓的外接圓),MUST NOT 退回等面積
//      圓近似:等面積圓在長軸上短 16%、短軸上長 20% ⇒ 一塊球場的角疊進停車場而圓判定
//      說「沒事」,而畫面上那是兩塊互相切穿的整齊區塊。
//   ② 3D 物件彼此不穿模:足跡半徑**量零件實幾何**(detailR,同 beacons 的 foot 紀律)× 實例縮放。
//   ③ 3D 物件不得站進**不屬於它的**功能性區塊(停車場裡不會長出隔壁草地的蘆葦)。
// 自然類↔自然類(fade↔fade)刻意維持 SEP_F 的邊緣互融:那是 2026-07-12 的反重複手段,
// 而且它們不是「功能性區塊」——兩叢草的輪廓互相咬進去正是自然的樣子。
export const PATCH_GAP = 1.0;     // 功能性區塊的淨距(m)。MUST < 陣列間隙 ARR_GAP(1.6)與家族延伸間隙(1.2),
                           // 否則沿街連續格陣與農田拼布會被自己的規則拆散
export const DET_GAP = 0.0;       // 3D 物件之間:足跡相切即可(0 = 不重疊;再加淨距會把密植草叢打稀）

// 三支都 export:離線稽核 MUST 執行原文(自己抄一份幾何公式去驗 = 驗自己抄對沒有)
// 點到有向盒的最近距離(0 = 落在盒內);ry 的軸向與 emitRect 同調(局部 x 軸 = (cos, sin))
export function obbDist(px, pz, o) {
  const ca = Math.cos(o.ry), sa = Math.sin(o.ry), dx = px - o.x, dz = pz - o.z;
  const lx = dx * ca + dz * sa, lz = -dx * sa + dz * ca;
  return Math.hypot(Math.max(0, Math.abs(lx) - o.hw), Math.max(0, Math.abs(lz) - o.hd));
}
// 兩個有向盒是否靠得比 gap 近(SAT 四軸;分離軸上的間距 ≥ gap 就不算近)
export function obbNear(a, b, gap) {
  const dx = b.x - a.x, dz = b.z - a.z;
  const axes = [[Math.cos(a.ry), Math.sin(a.ry)], [-Math.sin(a.ry), Math.cos(a.ry)],
                [Math.cos(b.ry), Math.sin(b.ry)], [-Math.sin(b.ry), Math.cos(b.ry)]];
  for (const [ax, az] of axes) {
    const proj = (o) => Math.abs(Math.cos(o.ry) * ax + Math.sin(o.ry) * az) * o.hw
                      + Math.abs(-Math.sin(o.ry) * ax + Math.cos(o.ry) * az) * o.hd;
    if (Math.abs(dx * ax + dz * az) >= proj(a) + proj(b) + gap) return false;
  }
  return true;
}
// 足跡唯一縫:{ x, z, r }(圓)或 { x, z, hw, hd, ry, r }(有向盒,r = 外接半徑供廣相用)
export function footNear(a, b, gap) {
  if (!a.hd && !b.hd) return Math.hypot(a.x - b.x, a.z - b.z) < a.r + b.r + gap;
  if (a.hd && b.hd) return obbNear(a, b, gap);
  const c = a.hd ? b : a, o = a.hd ? a : b;
  return obbDist(c.x, c.z, o) < c.r + gap;
}

function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// 低頻值雜訊:subtype / 變體分區(鄰近 patch 同類同變體 → 連片延伸不斷紋)
function vnoise(x, z, seed) {
  const h = (i, j) => {
    let n = ((i * 374761393 + j * 668265263) ^ seed) | 0;
    n = Math.imul(n ^ (n >>> 13), 1274126177);
    return ((n ^ (n >>> 16)) >>> 0) / 4294967296;
  };
  const xi = Math.floor(x), zi = Math.floor(z);
  let fx = x - xi, fz = z - zi;
  fx = fx * fx * (3 - 2 * fx); fz = fz * fz * (3 - 2 * fz);
  return (h(xi, zi) * (1 - fx) + h(xi + 1, zi) * fx) * (1 - fz)
       + (h(xi, zi + 1) * (1 - fx) + h(xi + 1, zi + 1) * fx) * fz;
}

// ---- 程序生成地表筆刷貼圖(固定種子;「地表#變體」為鍵快取共用)----
// 季節只進**快取鍵**(bucket 鍵仍是 `sub#variant`)⇒ 一場戰鬥只有一個季節,draw call 不變;
// 畫筆種子仍只由 `sub#variant` 導 ⇒ 同一塊田的壟溝/缺株位置四季不動,只有作物換了(§四季設計 ③)
const _texCache = new Map();
function groundTex(sub, variant, fit, season) {
  const key = `${sub}#${variant}`;
  const ck = `${key}@${season}`;
  if (_texCache.has(ck)) return _texCache.get(ck);
  const S = 256;
  const cv = document.createElement('canvas');
  cv.width = cv.height = S;
  let hs = 0;
  for (let i = 0; i < key.length; i++) hs = (hs * 31 + key.charCodeAt(i)) | 0;
  PAINTERS[sub](cv.getContext('2d'), S, mulberry32(0x67D0 ^ hs), season);
  const t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.SRGBColorSpace;
  // 鏡射重複:筆刷特徵跨磚無接縫(fit 型單張鋪滿,不重複)
  t.wrapS = t.wrapT = fit ? THREE.ClampToEdgeWrapping : THREE.MirroredRepeatWrapping;
  _texCache.set(ck, t);
  return t;
}

// 手繪筆刷小色塊(painterly blob;photoreal 噪點禁用)
function brushBlob(g, x, y, r, rnd) {
  g.beginPath();
  for (let a = 0; a <= 10; a++) {
    const t = a / 10 * Math.PI * 2;
    const rr = r * (0.7 + rnd() * 0.5);
    const px = x + Math.cos(t) * rr, py = y + Math.sin(t) * rr;
    a ? g.lineTo(px, py) : g.moveTo(px, py);
  }
  g.closePath();
  g.fill();
}
// 底色(hex → css rgb):**同種地表的全部變體共用同一個底色**(2026-08-12 使用者定案
// 「同顏色的地貌拼圖上面可以繪製多個不同的紋路/圖案/點綴/裝飾等細節」)—— 變體之間
// 只換花紋、不換顏色。舊制(vary)每個變體把底色抖 ±10/255,而底毯自從逐格挑變體
// (planCarpetVariants)之後,那個抖動就是**逐格換顏色** = 使用者回報的另一半「短距離
// 快速變化」;而且「**同顏色的**相鄰拼圖」這句話本身就要求變體同色。
// 仍照抽三枚亂數 ⇒ 每一支畫筆後續的筆觸序列逐位元同舊制(改的只有底色那一格)。
function baseFill(hex, rnd) {
  for (let k = 0; k < 3; k++) rnd();
  return `rgb(${hex >> 16 & 255},${hex >> 8 & 255},${hex & 255})`;
}

// ==== 農牧地表的四季設計(2026-08-13 使用者需求)====
// 使用者原話:「田除了田也加入菜園/牧場/魚塭與果園等農牧區,**包含原本的田在內依四季不同
// 而對應設計**」。舊制的季節只有 `SEASON_TINT` 一個乘色濾鏡 —— 那是把整張圖調黃,不是
// 「秋天的水田長什麼樣」(秋天的水田是割過的稻茬與金黃穗浪,不是綠稻加濾鏡)。三條:
//  ①**畫筆吃季節,材質不吃**:季節只進 `groundTex` 的**快取鍵**,bucket 鍵仍是 `sub#variant`
//    ⇒ 一場戰鬥只有一個季節,**draw call 一個都沒有多**。
//  ②有四季設計的地表 MUST 標 `seasonal` 並**跳過 `SEASON_TINT`** —— 不跳就是調兩次色
//    (畫筆已經畫成金黃,再乘一層 0xffd9a8 就成了褪色的舊照片)。
//  ③畫筆吃的是自己那一支 `mulberry32`(不是共享 `rnd`)⇒ 季節分支要抽幾枚都不推移佈局(§2.3)。
const SEASON_I = { spring: 0, summer: 1, autumn: 2, winter: 3 };
const seasonI = (season) => SEASON_I[season] ?? 1;     // 認不得的季節退夏(同 ENV.seasons 預設)

// ==== 底毯地表的代表色(2026-08-13 使用者需求「同一類型不要短距離快速變化子類別」)====
// 底色本來只寫在各 PAINTERS 的第一行 `baseFill(0x…)` 裡 —— 那等於「畫得出來才知道它是什麼
// 顏色」。而使用者這一輪的兩件事都要在**畫之前**就知道顏色:
//   ①底毯選款清單要照顏色排序(索引相鄰 = 顏色相鄰),雜訊掃過去才是漸層而不是綠→紅→灰;
//   ②顏色劇烈變化處要補畫分界線(borderKindOf 的同地貌分支)。
// ⇒ 代表色收成**一張表**,畫筆與這兩個消費端同吃(MUST NOT 在排序/界線那邊另抄一份色表:
//    改一支畫筆的底色而排序還照舊 = 清單順序悄悄不再是漸層,而畫面上只是「又開始跳色了」)。
//
// 三條:
//  ①名冊 MUST **恰好**涵蓋「會出現在底毯上的款」(CARPET ∪ ENCLAVE_STYLES[].carpet 的聯集,
//    稽核逐款雙向比對)—— 特徵拼圖(球場/加油站/工地)不進底毯格網,沒有排序也沒有界線可言;
//  ②該款的畫筆 MUST 真的吃這張表(稽核抽原文驗 `baseFill(SUB_COL.<款>` 逐款到位);
//  ③**磚瓦地是具名例外**:它的底是磚縫砂漿、讀出來的顏色是那五塊磚 ⇒ 代表色由磚色**推導**
//    (BRICK_C 的平均),MUST NOT 手寫第二個數字。
const BRICK_C = ['#b06a4a', '#a35f3f', '#bd7855', '#9d5a3e', '#b57050'];
const hexOf = (css) => parseInt(css.slice(1), 16);
const meanHex = (list) => {
  let r = 0, g = 0, b = 0;
  for (const c of list) { const h = hexOf(c); r += h >> 16 & 255; g += h >> 8 & 255; b += h & 255; }
  const n = list.length;
  return ((Math.round(r / n) << 16) | (Math.round(g / n) << 8) | Math.round(b / n));
};
export const SUB_COL = {
  // 綠地
  turf: 0x7db159, lawn: 0x6fae5a, meadow: 0xb3a468, bushfield: 0x6f9a4c, flowerfield: 0x78a854,
  arrowbamboo: 0x8ba757, deadwood: 0x9c9070, fallenlogs: 0x7c8a55, park: 0x74a85c,
  // 裸露地
  wild: 0x8d835f, gravel: 0x9a9384, sand: 0xdcc28f, mud: 0x6d5940, crackedearth: 0xb08d5f,
  redsoil: 0xa05f42, deadforest: 0x6b655c, steppe: 0xbca95e,
  // 市區
  concrete: 0xa2a49e, pavement: 0x98948b, brick: meanHex(BRICK_C),
  // 濕地 / 水域
  marsh: 0x5d5647, lotus: 0x41616b, watertile: 0x2f6f96, deepwater: 0x1c4560,
  // 高地
  plateau: 0xa08c6a, icefield: 0xd8e8ee, scree: 0x8f8c84,
};
// 感知色距(redmean 近似;值域 0~765)。純函式、零查表、零依賴 —— 純 RGB 歐氏距離會把
// 「深綠 vs 深藍」判得比「草綠 vs 土黃」還近,而使用者說的「突兀」量的正是人眼的那把尺。
export function colDist(h1, h2) {
  const r1 = h1 >> 16 & 255, g1 = h1 >> 8 & 255, b1 = h1 & 255;
  const r2 = h2 >> 16 & 255, g2 = h2 >> 8 & 255, b2 = h2 & 255;
  const rm = (r1 + r2) / 2, dr = r1 - r2, dg = g1 - g2, db = b1 - b2;
  return Math.sqrt((2 + rm / 256) * dr * dr + 4 * dg * dg + (2 + (255 - rm) / 256) * db * db);
}
// 底毯選款清單的顏色排序(純函式;零 rnd / 零 Math.random,§2.3)。
// 病灶:`cellSubAt` 是「低頻雜訊 t → 清單索引」,而清單本身**不是**色階 —— 綠地那一份的
// 索引 8→9→10 是 meadow(土黃)→ deadwood(灰)→ turf(綠)。t 平滑地走過去,顏色卻在跳。
// 選款區塊(CARPET_LOT)只能讓它**跳得沒那麼頻繁**,跳的幅度一格未動。
// 新制:排成一條顏色路徑 ⇒ 索引相鄰 = 顏色相鄰,雜訊掃過清單就是一條漸層帶。
//   ①**重複項 = 權重**,排序 MUST 保留重數並讓同款相鄰(權重變成漸層上的一段平台);
//   ②路徑起點取離色彩重心最遠的那一款 —— 從中間起步的話會往兩邊各走一半,接回來就是一個
//     大跳(貪婪最近鄰的經典壞法);
//   ③同距並列取清單原序(決定性,跨客戶端逐位元一致)。
export function carpetOrder(list, colOf = (s) => SUB_COL[s]) {
  const uniq = [];
  for (const s of list) if (!uniq.includes(s)) uniq.push(s);
  // 只有「一款」或「有款查不到代表色」才原序退回。**兩款也要排** —— 那不是為了排序,是為了
  // 把同款收成一段(['lotus','marsh','lotus'] 這種清單裡的 lotus 被 marsh 從中間切開,
  // 走過去就是 荷塘→沼澤→荷塘 的來回跳)
  if (uniq.length <= 1 || uniq.some((s) => colOf(s) == null)) return list.slice();
  let cr = 0, cg = 0, cb = 0;
  for (const s of uniq) { const h = colOf(s); cr += h >> 16 & 255; cg += h >> 8 & 255; cb += h & 255; }
  const ctr = ((Math.round(cr / uniq.length) << 16) | (Math.round(cg / uniq.length) << 8)
               | Math.round(cb / uniq.length));
  let start = uniq[0], bd = -1;
  for (const s of uniq) { const d = colDist(colOf(s), ctr); if (d > bd) { bd = d; start = s; } }
  const path = [start], left = uniq.filter((s) => s !== start);
  while (left.length) {
    const cur = colOf(path[path.length - 1]);
    let bi = 0, bdd = Infinity;
    for (let i = 0; i < left.length; i++) {
      const d = colDist(cur, colOf(left[i]));
      if (d < bdd) { bdd = d; bi = i; }
    }
    path.push(left.splice(bi, 1)[0]);
  }
  const out = [];
  for (const s of path) for (const q of list) if (q === s) out.push(s);
  return out;
}

const PAINTERS = {
  turf(g, S, rnd) {                                    // 草皮:筆刷色塊 + 草叢短撇 + 野花
    g.fillStyle = baseFill(SUB_COL.turf, rnd); g.fillRect(0, 0, S, S);
    for (let i = 0; i < 22; i++) {
      g.fillStyle = `rgba(214,238,160,${0.10 + rnd() * 0.12})`;
      brushBlob(g, rnd() * S, rnd() * S, 14 + rnd() * 30, rnd);
    }
    g.strokeStyle = 'rgba(42,84,36,0.4)'; g.lineWidth = 2;
    for (let i = 0; i < 60; i++) {
      const x = rnd() * S, y = rnd() * S;
      g.beginPath(); g.moveTo(x, y); g.lineTo(x + (rnd() - 0.5) * 6, y - 4 - rnd() * 5); g.stroke();
    }
    for (let i = 0; i < 8; i++) {
      g.fillStyle = rnd() < 0.5 ? '#f2ee9a' : '#f5f5f5';
      g.beginPath(); g.arc(rnd() * S, rnd() * S, 1.6, 0, 7); g.fill();
    }
  },
  lawn(g, S, rnd) {                                    // 市區草坪:割草機平行紋
    g.fillStyle = baseFill(SUB_COL.lawn, rnd); g.fillRect(0, 0, S, S);
    for (let x = 0; x < S; x += 64) {
      g.fillStyle = 'rgba(255,255,255,0.09)';
      g.fillRect(x, 0, 32, S);
    }
    g.strokeStyle = 'rgba(40,80,36,0.3)'; g.lineWidth = 1.6;
    for (let i = 0; i < 30; i++) {
      const x = rnd() * S, y = rnd() * S;
      g.beginPath(); g.moveTo(x, y); g.lineTo(x + (rnd() - 0.5) * 5, y - 4); g.stroke();
    }
  },
  meadow(g, S, rnd) {                                  // 芒草原:直立草束筆觸 + 抽穗點
    g.fillStyle = baseFill(SUB_COL.meadow, rnd); g.fillRect(0, 0, S, S);
    const cs = ['#d9d0a8', '#8f8352', '#c4b87e'];
    g.lineWidth = 2; g.lineCap = 'round';
    for (let i = 0; i < 110; i++) {
      const x = rnd() * S, y = rnd() * S;
      g.strokeStyle = cs[(rnd() * cs.length) | 0];
      g.beginPath(); g.moveTo(x, y); g.lineTo(x + (rnd() - 0.5) * 8, y - 8 - rnd() * 8); g.stroke();
    }
    g.fillStyle = '#e8dfb8';
    for (let i = 0; i < 24; i++) { g.beginPath(); g.arc(rnd() * S, rnd() * S, 1.4, 0, 7); g.fill(); }
  },
  bushfield(g, S, rnd) {                               // 灌木叢地:深色團塊 + 左上受光
    g.fillStyle = baseFill(SUB_COL.bushfield, rnd); g.fillRect(0, 0, S, S);
    for (let i = 0; i < 14; i++) {                     // 灌木淡影(灌木本體 = 3D 實例;受光壓淡不立體)
      const x = rnd() * S, y = rnd() * S, r = 12 + rnd() * 20;
      g.fillStyle = '#537c39'; brushBlob(g, x, y, r, rnd);
      g.fillStyle = 'rgba(150,190,110,0.35)'; brushBlob(g, x - r * 0.3, y - r * 0.3, r * 0.45, rnd);
    }
  },
  flowerfield(g, S, rnd) {                             // 花田:彩色花帶漂流在綠底上
    g.fillStyle = baseFill(SUB_COL.flowerfield, rnd); g.fillRect(0, 0, S, S);
    const cs = ['#e88bb0', '#f2d24a', '#f5f5f5', '#c77ddb', '#e8734a'];
    for (let i = 0; i < 7; i++) {
      const c = cs[(rnd() * cs.length) | 0];
      const x = rnd() * S, y = rnd() * S, r = 14 + rnd() * 22;
      g.fillStyle = c; g.globalAlpha = 0.55; brushBlob(g, x, y, r, rnd);
      g.globalAlpha = 0.9;
      for (let k = 0; k < 14; k++) {                   // 花帶內的點狀花簇
        g.beginPath(); g.arc(x + (rnd() - 0.5) * r * 1.6, y + (rnd() - 0.5) * r * 1.6, 1.8, 0, 7); g.fill();
      }
      g.globalAlpha = 1;
    }
    g.strokeStyle = 'rgba(42,84,36,0.35)'; g.lineWidth = 2;
    for (let i = 0; i < 30; i++) {
      const x = rnd() * S, y = rnd() * S;
      g.beginPath(); g.moveTo(x, y); g.lineTo(x, y - 5); g.stroke();
    }
  },
  // 果園:滿樹花(春)→ 綠冠(夏)→ 結果 + 落葉(秋)→ 枯枝 + 修剪堆(冬);果樹本體 = 3D 實例
  orchard(g, S, rnd, season) {
    const s = seasonI(season);
    g.fillStyle = baseFill([0x8fb864, 0x82ab5e, 0x9a9a58, 0x8e8c72][s], rnd); g.fillRect(0, 0, S, S);
    for (let y = 0; y < S; y += 42) {
      g.fillStyle = 'rgba(255,255,255,0.06)'; g.fillRect(0, y, S, 20);   // 除草帶
    }
    // 樹行淡影:只給定位感,不畫樹體。冬天剩下的是枝影 ⇒ 影子變小變淡
    const shade = ['rgba(74,112,52,0.26)', 'rgba(60,100,46,0.28)',
                   'rgba(112,96,44,0.28)', 'rgba(104,94,76,0.18)'][s];
    for (let y = 21; y < S; y += 42) {
      for (let x = 16 + (rnd() * 10 | 0); x < S; x += 40) {
        g.fillStyle = shade;
        brushBlob(g, x, y, (s === 3 ? 5 : 8) + rnd() * 4, rnd);
        if (s === 0) {                                 // 春:花冠(白粉點)
          for (let k = 0; k < 5; k++) {
            g.fillStyle = rnd() < 0.5 ? 'rgba(252,246,248,0.9)' : 'rgba(240,196,214,0.85)';
            g.beginPath(); g.arc(x + (rnd() - 0.5) * 14, y + (rnd() - 0.5) * 12, 1.8 + rnd(), 0, 7); g.fill();
          }
        } else if (s === 2) {                          // 秋:果實 + 樹下落果落葉
          for (let k = 0; k < 4; k++) {
            g.fillStyle = ['#d9722e', '#e0a52c', '#c24a30'][(rnd() * 3) | 0];
            g.beginPath(); g.arc(x + (rnd() - 0.5) * 15, y + (rnd() - 0.5) * 13, 1.7 + rnd(), 0, 7); g.fill();
          }
        } else if (s === 3) {                          // 冬:修剪下來的枝條堆
          g.strokeStyle = 'rgba(96,80,58,0.8)'; g.lineWidth = 1.6;
          for (let k = 0; k < 3; k++) {
            const a = rnd() * Math.PI, bx = x + (rnd() - 0.5) * 12, by = y + (rnd() - 0.5) * 10;
            g.beginPath(); g.moveTo(bx, by); g.lineTo(bx + Math.cos(a) * 9, by + Math.sin(a) * 6); g.stroke();
          }
        }
      }
    }
  },
  // 菜園:幼苗(春)→ 葉菜球(夏)→ 採收後空畦 + 殘株(秋)→ 塑膠布覆蓋(冬)
  veggiefield(g, S, rnd, season) {
    const s = seasonI(season);
    g.fillStyle = baseFill([0x8d7150, 0x8a6e4a, 0x8a7452, 0x8a7a62][s], rnd); g.fillRect(0, 0, S, S);
    for (let y = 10; y < S - 8; y += 22) {
      g.fillStyle = 'rgba(110,88,60,0.55)';            // 畦溝
      g.fillRect(4, y + 13, S - 8, 6);
      g.fillStyle = 'rgba(160,132,96,0.5)';            // 畦頂受光
      g.fillRect(4, y, S - 8, 4);
      if (s === 3) {                                   // 冬:整畦鋪白色塑膠布(留幾個種植孔)
        g.fillStyle = 'rgba(238,242,244,0.8)'; g.fillRect(4, y - 1, S - 8, 12);
        g.fillStyle = 'rgba(120,104,80,0.6)';
        for (let x = 12; x < S - 8; x += 20) { g.beginPath(); g.arc(x, y + 5, 2.2, 0, 7); g.fill(); }
        continue;
      }
      // 葉菜球(缺株 = 手種不勻);春幼苗小、秋採收後只剩零星殘株
      const [big, small, miss, rad] = [['#a8cf76', '#87ad55', 0.12, 2.4],
                                       ['#9ec462', '#6f9a44', 0.12, 4.0],
                                       ['#9aa86a', '#7d8a55', 0.68, 3.0]][s];
      for (let x = 12; x < S - 8; x += 14) {
        if (rnd() < miss) continue;
        g.fillStyle = rnd() < 0.3 ? big : small;
        g.beginPath(); g.arc(x + (rnd() - 0.5) * 4, y + 6 + (rnd() - 0.5) * 3, rad + rnd() * 1.5, 0, 7); g.fill();
      }
    }
    g.strokeStyle = '#7a5c3e'; g.lineWidth = 8;        // 畦邊框
    g.strokeRect(2, 2, S - 4, S - 4);
  },
  // 茶園:新芽亮頂(春)→ 深綠(夏)→ 採後平頭(秋)→ 覆霜(冬)
  teafield(g, S, rnd, season) {
    const s = seasonI(season);
    g.fillStyle = baseFill([0x6ba04b, 0x5f8f46, 0x5b8446, 0x5f7b52][s], rnd); g.fillRect(0, 0, S, S);
    const rows = [[['#4c7a36', 12, 0], ['#a6d472', 5, -5]],      // 春:新芽最亮最厚
                  [['#3f6b30', 12, 0], ['#7fae57', 4, -5]],      // 夏:今日的深綠
                  [['#3d6631', 12, 0], ['#6d9a4c', 3, -5]],      // 秋:採過 ⇒ 亮頂變窄
                  [['#3a5c38', 12, 0], ['#c8d8cc', 3, -5]]][s];  // 冬:壟頂覆霜
    for (let y = 6; y < S; y += 22) {
      const ph = rnd() * 7, amp = 2 + rnd() * 3;
      for (const [c, w, dy] of rows) {
        g.strokeStyle = c; g.lineWidth = w;
        g.beginPath();
        for (let x = -4; x <= S + 4; x += 8) {
          const yy = y + dy + Math.sin(x * 0.05 + ph) * amp;
          x < 0 ? g.moveTo(x, yy) : g.lineTo(x, yy);
        }
        g.stroke();
      }
    }
    if (rnd() < 0.7) {                                 // 縱向採茶小徑
      const x = 40 + rnd() * (S - 80);
      g.strokeStyle = '#8a744e'; g.lineWidth = 5;
      g.beginPath(); g.moveTo(x, 0); g.lineTo(x + (rnd() - 0.5) * 20, S); g.stroke();
    }
  },
  // 水田:插秧水鏡(春)→ 綠稻分蘗(夏)→ 金黃穗浪 + 割痕(秋)→ 稻茬休耕(冬)
  paddy(g, S, rnd, season) {
    const s = seasonI(season);
    g.fillStyle = baseFill([0x8fb0a6, 0x7ba393, 0xb99a4e, 0x8d8672][s], rnd); g.fillRect(0, 0, S, S);
    const sheen = [0.22, 0.16, 0, 0.10][s];            // 水面天光(秋收前放乾 ⇒ 沒有水鏡)
    if (sheen) {
      g.fillStyle = `rgba(255,255,255,${sheen})`;
      for (let i = 0; i < 10; i++) g.fillRect(rnd() * S, rnd() * S, 20 + rnd() * 40, 2);
    }
    // 秧苗 / 稻叢 / 稻穗 / 稻茬:同一組行列,只換筆色、筆寬與筆長
    const [col, lw, len] = [['#6ea24f', 3, 2], ['#5c8f46', 4, 3], ['#d8b552', 5, 4], ['#9d9276', 2.5, 1.5]][s];
    g.strokeStyle = col; g.lineWidth = lw; g.lineCap = 'round';
    for (let y = 20; y < S - 14; y += 16) {
      for (let x = 12; x < S - 10; x += 9) {
        if (rnd() < 0.08) continue;                    // 缺株:手插不勻
        g.beginPath(); g.moveTo(x, y + (rnd() - 0.5) * 2); g.lineTo(x + len, y + (rnd() - 0.5) * 2); g.stroke();
      }
    }
    if (s === 2) {                                     // 秋:割過的條帶(一塊田不會同一天割完)
      g.fillStyle = 'rgba(150,132,84,0.55)';
      for (let y = 26 + (rnd() * 30 | 0); y < S; y += 64) g.fillRect(0, y, S, 18);
    }
    g.strokeStyle = '#7a5c3e'; g.lineWidth = 14;       // 田埂(patch 外框,配外圈頂點隆起)
    g.strokeRect(3, 3, S - 6, S - 6);
  },
  // 旱田:新耕幼苗(春)→ 作物覆蓋(夏)→ 枯莖 + 收割空帶(秋)→ 裸壟覆霜(冬)
  dryfield(g, S, rnd, season) {
    const s = seasonI(season);
    g.fillStyle = baseFill([0x9a7850, 0x96714a, 0x9c8452, 0x8d7a5e][s], rnd); g.fillRect(0, 0, S, S);
    for (let x = 6; x < S; x += 18) {
      g.fillStyle = '#7a5836'; g.fillRect(x, 0, 7, S);
      g.fillStyle = '#a5825a'; g.fillRect(x + 7, 0, 3, S);   // 壟頂受光
    }
    // 作物:壟頂上的一條帶(春細嫩、夏滿版、秋枯黃、冬無)
    const crop = [['rgba(140,178,92,0.55)', 4], ['rgba(86,140,64,0.85)', 11], ['rgba(160,142,80,0.7)', 8], null][s];
    if (crop) for (let x = 6; x < S; x += 18) { g.fillStyle = crop[0]; g.fillRect(x + 3, 0, crop[1], S); }
    if (s === 2) {                                     // 秋:已收割的空帶(壟還在,作物沒了)
      g.fillStyle = 'rgba(154,132,86,0.6)';
      for (let y = 18 + (rnd() * 40 | 0); y < S; y += 88) g.fillRect(0, y, S, 26);
    }
    g.fillStyle = s === 3 ? 'rgba(226,232,236,0.5)' : '#6f5030';   // 冬:霜斑;其餘:土塊
    for (let i = 0; i < 26; i++) { g.beginPath(); g.arc(rnd() * S, rnd() * S, 1.5 + rnd() * 2, 0, 7); g.fill(); }
    g.strokeStyle = '#7a5c3e'; g.lineWidth = 10;
    g.strokeRect(2, 2, S - 4, S - 4);
  },
  // 牧場(2026-08-13 使用者「加入菜園/牧場/魚塭與果園等農牧區」):圍籬牧草地 + 啃食斑 +
  // 獸徑 + 飲水槽。春嫩綠野花 / 夏深綠啃食斑 / 秋乾黃草捲 / 冬枯褐覆霜。
  pasture(g, S, rnd, season) {
    const s = seasonI(season);
    g.fillStyle = baseFill([0x89b862, 0x6f9c52, 0xa89a5c, 0x8c8a72][s], rnd); g.fillRect(0, 0, S, S);
    const patch = ['rgba(168,206,120,0.45)', 'rgba(122,158,80,0.5)',
                   'rgba(188,172,104,0.5)', 'rgba(158,158,140,0.45)'][s];
    for (let i = 0; i < 16; i++) {                     // 啃食斑:牛羊吃出來的深淺塊
      g.fillStyle = patch;
      brushBlob(g, rnd() * S, rnd() * S, 10 + rnd() * 18, rnd);
    }
    g.strokeStyle = 'rgba(150,132,96,0.55)'; g.lineWidth = 5; g.lineCap = 'round';
    for (let i = 0; i < 3; i++) {                      // 獸徑:往飲水槽去的踏出路
      const y = 30 + rnd() * (S - 60);
      g.beginPath(); g.moveTo(0, y); g.lineTo(S, y + (rnd() - 0.5) * 40); g.stroke();
    }
    if (s === 0) {                                     // 春:野花點
      for (let i = 0; i < 34; i++) {
        g.fillStyle = ['#f2e6a2', '#e8a8c2', '#fdfdfd'][(rnd() * 3) | 0];
        g.beginPath(); g.arc(rnd() * S, rnd() * S, 1.6 + rnd(), 0, 7); g.fill();
      }
    }
    if (s === 2) {                                     // 秋:打包好的圓形草捲(俯視 = 亮邊圓餅)
      for (let i = 0; i < 5; i++) {
        const cx = 24 + rnd() * (S - 48), cy = 24 + rnd() * (S - 48);
        g.fillStyle = '#c9b271'; g.beginPath(); g.arc(cx, cy, 9 + rnd() * 3, 0, 7); g.fill();
        g.strokeStyle = 'rgba(240,228,178,0.9)'; g.lineWidth = 2;
        g.beginPath(); g.arc(cx, cy, 5, 0, 7); g.stroke();
      }
    }
    if (s === 3) {                                     // 冬:霜斑
      g.fillStyle = 'rgba(228,236,238,0.4)';
      for (let i = 0; i < 20; i++) brushBlob(g, rnd() * S, rnd() * S, 6 + rnd() * 10, rnd);
    }
    g.strokeStyle = 'rgba(120,98,66,0.8)'; g.lineWidth = 6;   // 圍籬(牧場的識別特徵)
    g.strokeRect(3, 3, S - 6, S - 6);
    g.strokeStyle = 'rgba(96,78,52,0.9)'; g.lineWidth = 3;    // 柵欄樁
    for (let x = 10; x < S; x += 26) {
      g.beginPath(); g.moveTo(x, 3); g.lineTo(x, 11); g.moveTo(x, S - 11); g.lineTo(x, S - 3); g.stroke();
    }
  },
  wild(g, S, rnd) {                                    // 荒野:乾草/土斑駁色塊
    g.fillStyle = baseFill(SUB_COL.wild, rnd); g.fillRect(0, 0, S, S);
    const cs = ['rgba(124,138,85,0.45)', 'rgba(156,141,102,0.45)', 'rgba(132,122,88,0.4)'];
    for (let i = 0; i < 18; i++) {
      g.fillStyle = cs[(rnd() * cs.length) | 0];
      brushBlob(g, rnd() * S, rnd() * S, 14 + rnd() * 26, rnd);
    }
    g.fillStyle = '#6e6650';
    for (let i = 0; i < 16; i++) { g.beginPath(); g.arc(rnd() * S, rnd() * S, 1.2 + rnd() * 1.6, 0, 7); g.fill(); }
  },
  gravel(g, S, rnd) {                                  // 碎石:兩階色卵石 + 硬邊高光點
    g.fillStyle = baseFill(SUB_COL.gravel, rnd); g.fillRect(0, 0, S, S);
    const cs = ['#a8a294', '#b4ae9e', '#8c8678'];
    for (let i = 0; i < 70; i++) {
      const x = rnd() * S, y = rnd() * S, r = 3 + rnd() * 7;
      g.save(); g.translate(x, y); g.rotate(rnd() * 3.2);
      g.fillStyle = cs[(rnd() * cs.length) | 0];
      g.beginPath(); g.ellipse(0, 0, r, r * (0.55 + rnd() * 0.3), 0, 0, 7); g.fill();
      g.strokeStyle = 'rgba(90,86,74,0.7)'; g.lineWidth = 1.5; g.stroke();
      g.fillStyle = 'rgba(255,255,255,0.45)';          // 賽璐璐硬邊高光
      g.beginPath(); g.ellipse(-r * 0.3, -r * 0.25, r * 0.3, r * 0.16, 0, 0, 7); g.fill();
      g.restore();
    }
  },
  sand(g, S, rnd) {                                    // 沙漠風沙:平行風紋波線 + 亮脊
    g.fillStyle = baseFill(SUB_COL.sand, rnd); g.fillRect(0, 0, S, S);
    for (let y = 8; y < S; y += 13) {
      const ph = rnd() * 7, amp = 2 + rnd() * 3;
      for (const [c, w, dy] of [['rgba(178,144,90,0.85)', 3, 0], ['rgba(255,244,214,0.5)', 1.5, -2.5]]) {
        g.strokeStyle = c; g.lineWidth = w;
        g.beginPath();
        for (let x = -4; x <= S + 4; x += 8) {
          const yy = y + dy + Math.sin(x * 0.06 + ph) * amp;
          x < 0 ? g.moveTo(x, yy) : g.lineTo(x, yy);
        }
        g.stroke();
      }
    }
  },
  mud(g, S, rnd) {                                     // 越野泥地:車轍雙線 + 水窪
    g.fillStyle = baseFill(SUB_COL.mud, rnd); g.fillRect(0, 0, S, S);
    g.lineCap = 'round';
    for (let t = 0; t < 3; t++) {                      // 三道彎曲車轍(左右輪距 ±7)
      const x0 = 30 + rnd() * (S - 60), ph = rnd() * 7, amp = 8 + rnd() * 10;
      for (const off of [-7, 7]) {
        for (const [c, w] of [['#4a3a26', 6], ['#7d6848', 2]]) {
          g.strokeStyle = c; g.lineWidth = w;
          g.beginPath();
          for (let y = -4; y <= S + 4; y += 10) {
            const xx = x0 + off + Math.sin(y * 0.03 + ph) * amp;
            y < 0 ? g.moveTo(xx, y) : g.lineTo(xx, y);
          }
          g.stroke();
        }
      }
    }
    for (let i = 0; i < 4; i++) {                      // 水窪:亮天光 + 白邊
      const x = rnd() * S, y = rnd() * S, r = 8 + rnd() * 12;
      g.fillStyle = 'rgba(142,162,171,0.8)'; brushBlob(g, x, y, r, rnd);
      g.strokeStyle = 'rgba(255,255,255,0.5)'; g.lineWidth = 1.5;
      g.beginPath(); g.arc(x, y, r * 0.9, 3.4, 5.2); g.stroke();
    }
  },
  crackedearth(g, S, rnd) {                            // 龜裂旱地:裂縫網 + 泥板塊亮面
    g.fillStyle = baseFill(SUB_COL.crackedearth, rnd); g.fillRect(0, 0, S, S);
    for (let i = 0; i < 8; i++) {
      g.fillStyle = 'rgba(255,255,255,0.10)';
      brushBlob(g, rnd() * S, rnd() * S, 12 + rnd() * 18, rnd);
    }
    g.strokeStyle = '#7a5c38'; g.lineWidth = 2; g.lineCap = 'round';
    for (let i = 0; i < 14; i++) {                     // 分岔裂縫(隨機折線)
      let x = rnd() * S, y = rnd() * S;
      g.beginPath(); g.moveTo(x, y);
      const n = 3 + (rnd() * 3 | 0);
      for (let k = 0; k < n; k++) {
        x += (rnd() - 0.5) * 44; y += (rnd() - 0.5) * 44;
        g.lineTo(x, y);
        if (rnd() < 0.4) {                             // 分岔
          g.moveTo(x, y); g.lineTo(x + (rnd() - 0.5) * 30, y + (rnd() - 0.5) * 30); g.moveTo(x, y);
        }
      }
      g.stroke();
    }
  },
  redsoil(g, S, rnd) {                                 // 紅土地:侵蝕條痕 + 土礫
    g.fillStyle = baseFill(SUB_COL.redsoil, rnd); g.fillRect(0, 0, S, S);
    g.lineCap = 'round';
    for (let i = 0; i < 40; i++) {
      const x = rnd() * S, y = rnd() * S, l = 10 + rnd() * 30;
      g.strokeStyle = rnd() < 0.5 ? 'rgba(127,70,48,0.6)' : 'rgba(184,122,85,0.6)';
      g.lineWidth = 2 + rnd() * 2;
      g.beginPath(); g.moveTo(x, y); g.lineTo(x + l, y + (rnd() - 0.5) * 8); g.stroke();
    }
    g.fillStyle = '#824c34';
    for (let i = 0; i < 14; i++) { g.beginPath(); g.arc(rnd() * S, rnd() * S, 1.4 + rnd() * 2, 0, 7); g.fill(); }
  },
  concrete(g, S, rnd) {                                // 水泥地:伸縮縫格線 + 髮絲裂縫 + 污漬(降亮:遠處不刷白)
    g.fillStyle = baseFill(SUB_COL.concrete, rnd); g.fillRect(0, 0, S, S);
    g.strokeStyle = '#8d8f8b'; g.lineWidth = 3;
    for (let p = 0; p <= S; p += 85) {
      g.beginPath(); g.moveTo(p, 0); g.lineTo(p, S); g.stroke();
      g.beginPath(); g.moveTo(0, p); g.lineTo(S, p); g.stroke();
    }
    for (let i = 0; i < 6; i++) {
      g.fillStyle = 'rgba(80,86,80,0.15)';
      brushBlob(g, rnd() * S, rnd() * S, 10 + rnd() * 20, rnd);
    }
    g.strokeStyle = '#9a9c96'; g.lineWidth = 1.5;
    for (let i = 0; i < 5; i++) {
      let x = rnd() * S, y = rnd() * S;
      g.beginPath(); g.moveTo(x, y);
      for (let k = 0; k < 4; k++) { x += (rnd() - 0.5) * 26; y += (rnd() - 0.5) * 26; g.lineTo(x, y); }
      g.stroke();
    }
  },
  brick(g, S, rnd) {                                   // 磚瓦地:交丁磚縫 + 每磚色差 + 受光邊
    g.fillStyle = '#b3a698'; g.fillRect(0, 0, S, S);
    const cs = BRICK_C;   // 代表色 SUB_COL.brick 由這一份推導(見該表檔頭 ③)
    const bw = 34, bh = 18;
    for (let row = 0; row * bh < S; row++) {
      const off = row % 2 ? -bw / 2 : 0;
      for (let x = off; x < S; x += bw) {
        g.fillStyle = cs[(rnd() * cs.length) | 0];
        g.fillRect(x + 1.5, row * bh + 1.5, bw - 3, bh - 3);
        g.fillStyle = 'rgba(255,255,255,0.18)';
        g.fillRect(x + 1.5, row * bh + 1.5, bw - 3, 3);
      }
    }
  },
  pavement(g, S, rnd) {                                // 人行道磚:方格地磚 + 雙色交錯(降亮:遠處不刷白)
    g.fillStyle = baseFill(SUB_COL.pavement, rnd); g.fillRect(0, 0, S, S);
    for (let y = 0; y < S; y += 32) {
      for (let x = 0; x < S; x += 32) {
        if ((x / 32 + y / 32) % 2 < 1) { g.fillStyle = 'rgba(255,255,255,0.07)'; g.fillRect(x, y, 32, 32); }
        if (rnd() < 0.08) { g.fillStyle = 'rgba(90,88,80,0.25)'; g.fillRect(x, y, 32, 32); }   // 換色磚
      }
    }
    g.strokeStyle = '#8c8880'; g.lineWidth = 2;
    for (let p = 0; p <= S; p += 32) {
      g.beginPath(); g.moveTo(p, 0); g.lineTo(p, S); g.stroke();
      g.beginPath(); g.moveTo(0, p); g.lineTo(S, p); g.stroke();
    }
  },
  parking(g, S, rnd) {                                 // 停車場:瀝青 + 白色車格線(fit)
    g.fillStyle = baseFill(0x3f444a, rnd); g.fillRect(0, 0, S, S);
    for (let i = 0; i < 5; i++) {
      g.fillStyle = 'rgba(255,255,255,0.05)';
      brushBlob(g, rnd() * S, rnd() * S, 12 + rnd() * 20, rnd);
    }
    g.strokeStyle = '#e8eae6'; g.lineWidth = 3;
    for (const [y0, y1] of [[16, 96], [S - 96, S - 16]]) {   // 兩排車格,中間行車道
      g.beginPath(); g.moveTo(8, y0 === 16 ? 96 : S - 96); g.lineTo(S - 8, y0 === 16 ? 96 : S - 96); g.stroke();
      for (let x = 16; x < S - 8; x += 36) {
        g.beginPath(); g.moveTo(x, y0); g.lineTo(x, y1); g.stroke();
      }
    }
  },
  court(g, S, rnd) {                                   // PU 球場:變體換配色(籃球紅/硬地藍/紅土)(fit)
    const [outer, inner] = [['#3f7f63', '#b5674d'], ['#4a7d94', '#38618f'], ['#5f8f46', '#b5744d']][(rnd() * 3) | 0];
    g.fillStyle = outer; g.fillRect(0, 0, S, S);
    const m = 34;
    g.fillStyle = inner; g.fillRect(m, m, S - m * 2, S - m * 2);
    g.strokeStyle = '#f2f4f0'; g.lineWidth = 3;
    g.strokeRect(m, m, S - m * 2, S - m * 2);
    g.beginPath(); g.moveTo(m, S / 2); g.lineTo(S - m, S / 2); g.stroke();   // 中線
    g.beginPath(); g.arc(S / 2, S / 2, 30, 0, 7); g.stroke();                // 中圈
    g.strokeRect(S / 2 - 28, m, 56, 34);                                     // 兩端禁區
    g.strokeRect(S / 2 - 28, S - m - 34, 56, 34);
  },
  track(g, S, rnd) {                                   // 操場:完整一圈 PU 跑道(直道 + 兩端彎道)+ 內場草皮(fit)
    // 跑道是「環」不是「條」:外緣圓角矩形 → 內場草皮 → 白分道線沿整圈繞行。
    // canvas 為正方,rect 以 aspect 0.5 貼上 → 畫面上自然拉成真實操場的長橢圓。
    const ring = (inset, r) => {                        // 圓角矩形路徑(跑道等距內縮 = 一條分道線)
      g.beginPath();
      g.moveTo(inset + r, inset);
      g.lineTo(S - inset - r, inset);
      g.arcTo(S - inset, inset, S - inset, inset + r, r);
      g.lineTo(S - inset, S - inset - r);
      g.arcTo(S - inset, S - inset, S - inset - r, S - inset, r);
      g.lineTo(inset + r, S - inset);
      g.arcTo(inset, S - inset, inset, S - inset - r, r);
      g.lineTo(inset, inset + r);
      g.arcTo(inset, inset, inset + r, inset, r);
      g.closePath();
    };
    g.fillStyle = baseFill(0x6f8a52, rnd); g.fillRect(0, 0, S, S);            // 場外草地
    const OUT = 10, LANES = 6, LW = 12;                 // 外緣內縮 / 分道數 / 單道寬
    g.fillStyle = baseFill(0xb85a44, rnd);
    ring(OUT, 52); g.fill();                            // PU 跑道環(外緣)
    g.fillStyle = 'rgba(255,255,255,0.06)';
    for (let i = 0; i < 80; i++) g.fillRect(rnd() * S, rnd() * S, 2, 2);     // PU 顆粒
    g.fillStyle = baseFill(0x5f8f46, rnd);
    ring(OUT + LANES * LW, 52 - LANES * LW * 0.6); g.fill();                 // 內場草皮(足球場)
    g.strokeStyle = '#f2f4f0'; g.lineWidth = 2;                              // 分道線:整圈繞行
    for (let k = 0; k <= LANES; k++) { ring(OUT + k * LW, Math.max(6, 52 - k * LW * 0.6)); g.stroke(); }
    g.lineWidth = 4;                                    // 起跑/終點線:橫跨直道
    g.beginPath(); g.moveTo(S * 0.72, OUT); g.lineTo(S * 0.72, OUT + LANES * LW); g.stroke();
  },
  marsh(g, S, rnd) {                                   // 濕地泥灘:混濁紫水窪 + 蘆葦筆觸(沼澤識別色 = 濁紫)
    g.fillStyle = baseFill(SUB_COL.marsh, rnd); g.fillRect(0, 0, S, S);
    for (let i = 0; i < 8; i++) {
      const x = rnd() * S, y = rnd() * S, r = 10 + rnd() * 16;
      g.fillStyle = 'rgba(128,106,150,0.65)'; brushBlob(g, x, y, r, rnd);
      g.strokeStyle = 'rgba(255,255,255,0.4)'; g.lineWidth = 1.4;
      g.beginPath(); g.arc(x, y, r * 0.85, 3.4, 5.0); g.stroke();
    }
    g.strokeStyle = '#a9b06a'; g.lineWidth = 2; g.lineCap = 'round';
    for (let i = 0; i < 50; i++) {
      const x = rnd() * S, y = rnd() * S;
      g.beginPath(); g.moveTo(x, y); g.lineTo(x + (rnd() - 0.5) * 5, y - 7 - rnd() * 7); g.stroke();
    }
  },
  lotus(g, S, rnd) {                                   // 荷塘:深水 + 天光 + 水深暗影(荷葉 = 3D 實例)
    g.fillStyle = baseFill(SUB_COL.lotus, rnd); g.fillRect(0, 0, S, S);
    g.fillStyle = 'rgba(255,255,255,0.10)';
    for (let i = 0; i < 10; i++) g.fillRect(rnd() * S, rnd() * S, 16 + rnd() * 30, 2);   // 水面天光
    for (let i = 0; i < 8; i++) {                      // 水下暗影:水深錯落
      g.fillStyle = `rgba(30,52,58,${0.15 + rnd() * 0.15})`;
      brushBlob(g, rnd() * S, rnd() * S, 10 + rnd() * 14, rnd);
    }
  },
  watertile(g, S, rnd) {                               // 水域(淺):亮藍波光弧 + 岸沫點 —— 一眼可辨「這是水」
    g.fillStyle = baseFill(SUB_COL.watertile, rnd); g.fillRect(0, 0, S, S);
    g.lineCap = 'round';
    for (let i = 0; i < 16; i++) {                     // 波光弧(同向排列 = 水流感)
      const x = rnd() * S, y = rnd() * S, r = 8 + rnd() * 16;
      g.strokeStyle = `rgba(210,236,255,${0.35 + rnd() * 0.3})`; g.lineWidth = 1.6 + rnd();
      g.beginPath(); g.arc(x, y, r, Math.PI * 1.1, Math.PI * 1.65); g.stroke();
    }
    g.fillStyle = 'rgba(255,255,255,0.28)';
    for (let i = 0; i < 26; i++) g.fillRect(rnd() * S, rnd() * S, 2 + rnd() * 3, 1.5);   // 碎浪沫
    g.fillStyle = 'rgba(24,58,84,0.30)';
    for (let i = 0; i < 6; i++) brushBlob(g, rnd() * S, rnd() * S, 10 + rnd() * 14, rnd);   // 水色深斑
  },
  deepwater(g, S, rnd) {                               // 水域(深):暗藍底 + 稀疏天光 —— 與淺水同語彙、更深沉
    g.fillStyle = baseFill(SUB_COL.deepwater, rnd); g.fillRect(0, 0, S, S);
    g.fillStyle = 'rgba(190,224,246,0.16)';
    for (let i = 0; i < 8; i++) g.fillRect(rnd() * S, rnd() * S, 12 + rnd() * 26, 1.6);  // 稀疏天光
    for (let i = 0; i < 9; i++) {                      // 深水暗湧
      g.fillStyle = `rgba(10,28,42,${0.18 + rnd() * 0.16})`;
      brushBlob(g, rnd() * S, rnd() * S, 12 + rnd() * 18, rnd);
    }
    g.lineCap = 'round'; g.strokeStyle = 'rgba(150,196,224,0.22)'; g.lineWidth = 1.4;
    for (let i = 0; i < 6; i++) {
      const x = rnd() * S, y = rnd() * S, r = 10 + rnd() * 14;
      g.beginPath(); g.arc(x, y, r, Math.PI * 1.15, Math.PI * 1.55); g.stroke();
    }
  },
  // ======== 綠地擴充 ========
  arrowbamboo(g, S, rnd) {                             // 箭竹林:密集細稈直豎 + 竹節 + 斜葉短撇
    g.fillStyle = baseFill(SUB_COL.arrowbamboo, rnd); g.fillRect(0, 0, S, S);
    for (let i = 0; i < 10; i++) {
      g.fillStyle = `rgba(60,96,44,${0.10 + rnd() * 0.1})`;
      brushBlob(g, rnd() * S, rnd() * S, 12 + rnd() * 22, rnd);
    }
    g.lineCap = 'round';
    for (let i = 0; i < 70; i++) {
      const x = rnd() * S, y = rnd() * S, h = 14 + rnd() * 14;
      g.strokeStyle = rnd() < 0.5 ? '#c8d47e' : '#a9bd63';
      g.lineWidth = 1.8;
      g.beginPath(); g.moveTo(x, y); g.lineTo(x + (rnd() - 0.5) * 4, y - h); g.stroke();
      g.fillStyle = '#7d8f43';
      g.fillRect(x - 1.5, y - h * 0.5, 3, 1.5);        // 竹節
    }
    g.strokeStyle = 'rgba(220,236,150,0.7)'; g.lineWidth = 1.4;
    for (let i = 0; i < 40; i++) {
      const x = rnd() * S, y = rnd() * S;
      g.beginPath(); g.moveTo(x, y); g.lineTo(x + 5 + rnd() * 4, y - 2 - rnd() * 3); g.stroke();
    }
  },
  deadwood(g, S, rnd) {                                // 枯木林:乾草底 + 細碎小枝(枯木本體 = 3D 實例)
    g.fillStyle = baseFill(SUB_COL.deadwood, rnd); g.fillRect(0, 0, S, S);
    for (let i = 0; i < 12; i++) {
      g.fillStyle = `rgba(120,110,88,${0.2 + rnd() * 0.2})`;
      brushBlob(g, rnd() * S, rnd() * S, 10 + rnd() * 20, rnd);
    }
    g.lineCap = 'round';
    g.strokeStyle = 'rgba(110,97,82,0.6)'; g.lineWidth = 1.6;
    for (let i = 0; i < 22; i++) {                     // 細碎小枝:只是地面質感,不畫成倒枝
      const x = rnd() * S, y = rnd() * S, a = rnd() * 7;
      g.beginPath(); g.moveTo(x, y); g.lineTo(x + Math.cos(a) * 7, y + Math.sin(a) * 7); g.stroke();
    }
    g.fillStyle = '#b8a67e';
    for (let i = 0; i < 18; i++) { g.beginPath(); g.arc(rnd() * S, rnd() * S, 1.3, 0, 7); g.fill(); }
  },
  fallenlogs(g, S, rnd) {                              // 混亂倒木:草土底 + 壓倒草痕(倒木本體 = 3D 實例)
    g.fillStyle = baseFill(SUB_COL.fallenlogs, rnd); g.fillRect(0, 0, S, S);
    for (let i = 0; i < 8; i++) {
      g.fillStyle = `rgba(110,96,66,${0.2 + rnd() * 0.15})`;
      brushBlob(g, rnd() * S, rnd() * S, 10 + rnd() * 16, rnd);
    }
    g.lineCap = 'round';
    g.strokeStyle = 'rgba(90,80,52,0.35)'; g.lineWidth = 5;
    for (let i = 0; i < 8; i++) {                      // 倒木壓出的草痕(淡影,非木身)
      const x = rnd() * S, y = rnd() * S, a = rnd() * 7, l = 20 + rnd() * 30;
      g.beginPath(); g.moveTo(x, y); g.lineTo(x + Math.cos(a) * l, y + Math.sin(a) * l); g.stroke();
    }
  },
  clearcut(g, S, rnd) {                                // 砍伐跡地:泥土 + 木屑斑 + 拖木刮痕(樹頭 = 3D 實例)
    g.fillStyle = baseFill(0x8a7350, rnd); g.fillRect(0, 0, S, S);
    for (let i = 0; i < 10; i++) {
      g.fillStyle = `rgba(214,196,150,${0.15 + rnd() * 0.15})`;
      brushBlob(g, rnd() * S, rnd() * S, 8 + rnd() * 16, rnd);
    }
    g.fillStyle = '#d9c49a';
    for (let i = 0; i < 26; i++) { g.beginPath(); g.arc(rnd() * S, rnd() * S, 1.2 + rnd() * 1.6, 0, 7); g.fill(); }
    g.strokeStyle = 'rgba(90,70,46,0.5)'; g.lineWidth = 2; g.lineCap = 'round';
    for (let i = 0; i < 10; i++) {
      const x = rnd() * S, y = rnd() * S;
      g.beginPath(); g.moveTo(x, y); g.lineTo(x + 20 + rnd() * 26, y + (rnd() - 0.5) * 10); g.stroke();
    }
  },
  lumberyard(g, S, rnd) {                              // 木材堆置場:土面 + 木屑帶 + 車轍(木堆/板材 = 3D 實例)
    g.fillStyle = baseFill(0x8f7854, rnd); g.fillRect(0, 0, S, S);
    for (let i = 0; i < 10; i++) {
      g.fillStyle = `rgba(214,196,150,${0.18 + rnd() * 0.18})`;
      brushBlob(g, rnd() * S, rnd() * S, 8 + rnd() * 16, rnd);
    }
    g.lineCap = 'round'; g.strokeStyle = 'rgba(90,70,46,0.5)'; g.lineWidth = 3;
    for (let i = 0; i < 6; i++) {                      // 搬運車轍
      const x = rnd() * S, y = rnd() * S;
      g.beginPath(); g.moveTo(x, y); g.lineTo(x + 26 + rnd() * 30, y + (rnd() - 0.5) * 12); g.stroke();
    }
  },
  rottencabin(g, S, rnd) {                             // 腐朽木屋地:苔草底 + 爛木板 + 青苔斑 + 朽洞
    g.fillStyle = baseFill(0x74855a, rnd); g.fillRect(0, 0, S, S);
    g.lineCap = 'round';
    for (let i = 0; i < 16; i++) {
      const x = rnd() * S, y = rnd() * S, a = rnd() * 7, l = 12 + rnd() * 16;
      g.strokeStyle = rnd() < 0.4 ? '#4f3a28' : '#5c452e'; g.lineWidth = 4 + rnd() * 3;
      g.beginPath(); g.moveTo(x, y); g.lineTo(x + Math.cos(a) * l, y + Math.sin(a) * l); g.stroke();
    }
    for (let i = 0; i < 12; i++) {
      g.fillStyle = `rgba(96,138,70,${0.25 + rnd() * 0.25})`;
      brushBlob(g, rnd() * S, rnd() * S, 6 + rnd() * 12, rnd);
    }
    g.fillStyle = '#3f4a35';
    for (let i = 0; i < 8; i++) { g.beginPath(); g.arc(rnd() * S, rnd() * S, 1.6 + rnd() * 2, 0, 7); g.fill(); }
  },
  // 葡萄園:新梢(春)→ 綠帳(夏)→ 紅黃葉(秋)→ 光禿藤架(冬);木樁與行距四季不動
  vineyard(g, S, rnd, season) {
    const s = seasonI(season);
    g.fillStyle = baseFill([0x9c9060, 0x9a8a5e, 0x9d8a54, 0x8f8468][s], rnd); g.fillRect(0, 0, S, S);
    // [籬色, 籬寬, 頂色, 行間草帶色]:冬天沒有葉 ⇒ 籬退成一條細藤
    const [vc, vw, tc, gc] = [['#568a3c', 6, '#a6d472', 'rgba(158,182,104,0.42)'],
                              ['#3f6b30', 9, '#7fae57', 'rgba(140,160,90,0.40)'],
                              ['#8a6a2c', 8, '#d8a94e', 'rgba(156,150,86,0.40)'],
                              ['#6b5a44', 2.5, '#8a7a60', 'rgba(140,140,116,0.35)']][s];
    for (let y = 14; y < S - 8; y += 24) {
      g.fillStyle = gc;                                // 行間草帶
      g.fillRect(0, y + 7, S, 10);
      const ph = rnd() * 7;
      g.strokeStyle = vc; g.lineWidth = vw; g.lineCap = 'round';
      g.beginPath();
      for (let x = 2; x <= S - 2; x += 8) {
        const yy = y + Math.sin(x * 0.08 + ph) * 1.5;
        x <= 2 ? g.moveTo(x, yy) : g.lineTo(x, yy);
      }
      g.stroke();
      g.strokeStyle = tc; g.lineWidth = 2.5;           // 籬頂受光(冬天是裸藤的亮邊)
      g.beginPath(); g.moveTo(2, y - 3); g.lineTo(S - 2, y - 3); g.stroke();
      g.fillStyle = '#6e5138';
      for (let x = 8; x < S; x += 26) g.fillRect(x, y - 6, 3, 12);   // 木樁
    }
  },
  // 溫室棚地:育苗(春)→ 滿床(夏)→ 採收後翻土(秋)→ 棚布積雪(冬);拱棚本體 = 3D 實例
  greenhouse(g, S, rnd, season) {
    const s = seasonI(season);
    g.fillStyle = baseFill([0x8c7c5e, 0x8a7a5c, 0x877758, 0x8e8878][s], rnd); g.fillRect(0, 0, S, S);
    const bed = ['rgba(140,160,90,0.30)', 'rgba(140,160,90,0.35)',
                 'rgba(126,104,72,0.55)', 'rgba(236,240,242,0.72)'][s];   // 冬 = 積雪、秋 = 翻過的土
    for (let y = 6; y < S - 20; y += 34) {
      g.fillStyle = 'rgba(120,100,70,0.5)';            // 苗床翻土帶
      g.fillRect(4, y, S - 8, 22);
      g.fillStyle = bed;                               // 苗床作物(冬天是棚頂那層雪)
      g.fillRect(4, y + 8, S - 8, s === 3 ? 12 : 7);
      if (s === 0) {                                   // 春:一格一格的育苗盤
        g.strokeStyle = 'rgba(96,80,56,0.5)'; g.lineWidth = 1.2;
        for (let x = 8; x < S - 8; x += 16) { g.beginPath(); g.moveTo(x, y + 7); g.lineTo(x, y + 16); g.stroke(); }
      }
    }
  },
  // ======== 裸露地擴充 ========
  deadforest(g, S, rnd) {                              // 死林:灰燼地 + 焦木倒影 + 白灰斑
    g.fillStyle = baseFill(SUB_COL.deadforest, rnd); g.fillRect(0, 0, S, S);
    for (let i = 0; i < 10; i++) {
      g.fillStyle = `rgba(40,38,34,${0.18 + rnd() * 0.18})`;
      brushBlob(g, rnd() * S, rnd() * S, 10 + rnd() * 18, rnd);
    }
    g.strokeStyle = '#3a3632'; g.lineWidth = 3; g.lineCap = 'round';
    for (let i = 0; i < 16; i++) {
      const x = rnd() * S, y = rnd() * S, l = 12 + rnd() * 18, a = rnd() * 7;
      g.beginPath(); g.moveTo(x, y); g.lineTo(x + Math.cos(a) * l, y + Math.sin(a) * l); g.stroke();
    }
    g.fillStyle = 'rgba(214,210,200,0.5)';
    for (let i = 0; i < 10; i++) brushBlob(g, rnd() * S, rnd() * S, 5 + rnd() * 8, rnd);
  },
  slabruin(g, S, rnd) {                                // 倒塌石板屋:殘存牆基 + 瓦礫斑(石板本體 = 3D 實例)
    g.fillStyle = baseFill(0x8d867a, rnd); g.fillRect(0, 0, S, S);
    for (let i = 0; i < 10; i++) {
      g.fillStyle = `rgba(154,160,164,${0.2 + rnd() * 0.2})`;
      brushBlob(g, rnd() * S, rnd() * S, 8 + rnd() * 14, rnd);
    }
    g.strokeStyle = 'rgba(90,86,78,0.7)'; g.lineWidth = 3;
    g.strokeRect(30 + rnd() * (S - 120), 30 + rnd() * (S - 120), 60 + rnd() * 40, 44 + rnd() * 30);
    g.fillStyle = '#6e6a60';
    for (let i = 0; i < 24; i++) { g.beginPath(); g.arc(rnd() * S, rnd() * S, 1.4 + rnd() * 2, 0, 7); g.fill(); }
  },
  steppe(g, S, rnd) {                                  // 乾草原:金黃草浪(風向一致)+ 深草叢
    g.fillStyle = baseFill(SUB_COL.steppe, rnd); g.fillRect(0, 0, S, S);
    for (let i = 0; i < 14; i++) {
      g.fillStyle = `rgba(220,204,140,${0.12 + rnd() * 0.12})`;
      brushBlob(g, rnd() * S, rnd() * S, 12 + rnd() * 24, rnd);
    }
    g.lineCap = 'round';
    for (let i = 0; i < 60; i++) {
      const x = rnd() * S, y = rnd() * S;
      g.strokeStyle = rnd() < 0.5 ? 'rgba(150,130,70,0.6)' : 'rgba(228,214,156,0.6)';
      g.lineWidth = 1.8;
      g.beginPath(); g.moveTo(x, y); g.quadraticCurveTo(x + 7, y - 3, x + 14, y - 2); g.stroke();
    }
    g.fillStyle = '#7d7040';
    for (let i = 0; i < 10; i++) brushBlob(g, rnd() * S, rnd() * S, 3 + rnd() * 4, rnd);
  },
  // 廢棄農田:雜草返青(春)→ 雜草茂盛(夏)→ 枯黃(秋)→ 枯褐覆霜(冬);壟溝與傾倒圍籬四季不變
  abandonedfarm(g, S, rnd, season) {
    const s = seasonI(season);
    g.fillStyle = baseFill([0x8f8460, 0x8f7f5e, 0x91825a, 0x8a8270][s], rnd); g.fillRect(0, 0, S, S);
    for (let x = 6; x < S; x += 18) {
      g.fillStyle = 'rgba(110,92,64,0.45)'; g.fillRect(x, 0, 7, S);
    }
    const weed = [[140, 176, 92], [120, 150, 80], [166, 152, 82], [148, 146, 128]][s];
    for (let i = 0; i < 14; i++) {
      g.fillStyle = `rgba(${weed[0]},${weed[1]},${weed[2]},${0.3 + rnd() * 0.3})`;
      brushBlob(g, rnd() * S, rnd() * S, 8 + rnd() * 16, rnd);
    }
    g.strokeStyle = 'rgba(90,72,50,0.8)'; g.lineWidth = 3; g.lineCap = 'round';
    for (let i = 0; i < 6; i++) {
      const x = rnd() * S, y = rnd() * S, a = rnd() * 0.8 - 0.4;
      g.beginPath(); g.moveTo(x, y); g.lineTo(x + Math.cos(a) * 18, y + Math.sin(a) * 18); g.stroke();
    }
  },
  saltpan(g, S, rnd) {                                 // 鹽田:結晶白池格 + 淡粉滷水 + 埂道(fit)
    g.fillStyle = baseFill(0xd8d4c8, rnd); g.fillRect(0, 0, S, S);
    const cs = ['#f2f4f0', '#e8dfe0', '#edd8d2', '#dfe8ea'];
    const gw = 58, gh = 44;
    for (let y = 6; y < S - 8; y += gh) {
      for (let x = 6; x < S - 8; x += gw) {
        g.fillStyle = cs[(rnd() * cs.length) | 0];     // 每池結晶度/滷水色不同
        g.fillRect(x, y, gw - 6, gh - 6);
        g.fillStyle = 'rgba(255,255,255,0.8)';
        for (let k = 0; k < 5; k++) g.fillRect(x + rnd() * (gw - 10), y + rnd() * (gh - 10), 3, 1.6);
      }
    }
    g.strokeStyle = '#a09884'; g.lineWidth = 4;
    for (let y = 3; y < S; y += gh) { g.beginPath(); g.moveTo(0, y); g.lineTo(S, y); g.stroke(); }
    for (let x = 3; x < S; x += gw) { g.beginPath(); g.moveTo(x, 0); g.lineTo(x, S); g.stroke(); }
  },
  quarry(g, S, rnd) {                                  // 採石場:階狀採掘帶 + 垂直切割線 + 碎石(fit)
    g.fillStyle = baseFill(0xa39a8c, rnd); g.fillRect(0, 0, S, S);
    for (let y = 0; y < S; y += 40) {
      g.fillStyle = rnd() < 0.5 ? 'rgba(150,140,124,0.6)' : 'rgba(190,182,166,0.6)';
      g.fillRect(0, y, S, 22 + rnd() * 10);
      g.strokeStyle = 'rgba(80,74,64,0.7)'; g.lineWidth = 3;
      g.beginPath(); g.moveTo(0, y); g.lineTo(S, y); g.stroke();
    }
    g.strokeStyle = 'rgba(110,102,90,0.6)'; g.lineWidth = 1.6;
    for (let x = 20; x < S; x += 34 + (rnd() * 20 | 0)) {
      g.beginPath(); g.moveTo(x, 0); g.lineTo(x + (rnd() - 0.5) * 8, S); g.stroke();
    }
    g.fillStyle = '#8a8274';
    for (let i = 0; i < 20; i++) { g.beginPath(); g.arc(rnd() * S, rnd() * S, 1.5 + rnd() * 2.5, 0, 7); g.fill(); }
  },
  // ======== 高地擴充 ========
  plateau(g, S, rnd) {                                 // 高原:層積岩階帶 + 階緣受光 + 高地矮草
    g.fillStyle = baseFill(SUB_COL.plateau, rnd); g.fillRect(0, 0, S, S);
    for (let y = 0; y < S; y += 26 + (rnd() * 14 | 0)) {
      g.fillStyle = rnd() < 0.5 ? 'rgba(140,116,84,0.5)' : 'rgba(180,158,120,0.5)';
      g.fillRect(0, y, S, 12 + rnd() * 10);
      g.strokeStyle = 'rgba(240,228,200,0.5)'; g.lineWidth = 2;
      g.beginPath(); g.moveTo(0, y); g.lineTo(S, y); g.stroke();
      g.strokeStyle = 'rgba(90,74,54,0.6)'; g.lineWidth = 2.5;
      g.beginPath(); g.moveTo(0, y + 13); g.lineTo(S, y + 13); g.stroke();
    }
    g.fillStyle = 'rgba(122,138,84,0.8)';
    for (let i = 0; i < 16; i++) brushBlob(g, rnd() * S, rnd() * S, 2.5 + rnd() * 3.5, rnd);
  },
  icefield(g, S, rnd) {                                // 冰原:青白冰面 + 裂隙分岔 + 雪斑 + 晶點
    g.fillStyle = baseFill(SUB_COL.icefield, rnd); g.fillRect(0, 0, S, S);
    for (let i = 0; i < 10; i++) {
      g.fillStyle = `rgba(255,255,255,${0.25 + rnd() * 0.3})`;
      brushBlob(g, rnd() * S, rnd() * S, 10 + rnd() * 20, rnd);
    }
    g.strokeStyle = 'rgba(124,168,190,0.8)'; g.lineWidth = 2; g.lineCap = 'round';
    for (let i = 0; i < 10; i++) {
      let x = rnd() * S, y = rnd() * S;
      g.beginPath(); g.moveTo(x, y);
      for (let k = 0; k < 4; k++) {
        x += (rnd() - 0.5) * 50; y += (rnd() - 0.5) * 50;
        g.lineTo(x, y);
        if (rnd() < 0.35) { g.moveTo(x, y); g.lineTo(x + (rnd() - 0.5) * 26, y + (rnd() - 0.5) * 26); g.moveTo(x, y); }
      }
      g.stroke();
    }
    g.fillStyle = 'rgba(255,255,255,0.9)';
    for (let i = 0; i < 20; i++) g.fillRect(rnd() * S, rnd() * S, 2, 2);
  },
  scree(g, S, rnd) {                                   // 岩屑坡:角礫三角碎片 + 陰影錯落
    g.fillStyle = baseFill(SUB_COL.scree, rnd); g.fillRect(0, 0, S, S);
    const cs = ['#a2a09a', '#8a8880', '#b0aea6', '#7c7a72'];
    for (let i = 0; i < 90; i++) {
      const x = rnd() * S, y = rnd() * S, r = 3 + rnd() * 6, a = rnd() * 7;
      g.fillStyle = cs[(rnd() * cs.length) | 0];
      g.beginPath();
      g.moveTo(x + Math.cos(a) * r, y + Math.sin(a) * r);
      g.lineTo(x + Math.cos(a + 2.1) * r, y + Math.sin(a + 2.1) * r);
      g.lineTo(x + Math.cos(a + 4.2) * r, y + Math.sin(a + 4.2) * r);
      g.closePath(); g.fill();
      if (rnd() < 0.4) { g.strokeStyle = 'rgba(60,58,52,0.5)'; g.lineWidth = 1; g.stroke(); }
    }
  },
  // ======== 市區擴充 ========
  construction(g, S, rnd) {                            // 廢棄工地:翻土 + 弧形車轍 + 鏽色鋼筋束 + 水泥板(fit)
    g.fillStyle = baseFill(0x9c8a70, rnd); g.fillRect(0, 0, S, S);
    for (let i = 0; i < 10; i++) {
      g.fillStyle = `rgba(120,100,72,${0.2 + rnd() * 0.2})`;
      brushBlob(g, rnd() * S, rnd() * S, 10 + rnd() * 18, rnd);
    }
    g.lineCap = 'round';
    const cx = rnd() * S, cy = rnd() * S, a0 = rnd() * 4;
    g.strokeStyle = '#6b5a42'; g.lineWidth = 4;
    for (const off of [-6, 6]) {                       // 履帶雙轍
      g.beginPath(); g.arc(cx, cy, 60 + off, a0, a0 + 2.2); g.stroke();
    }
    g.strokeStyle = '#8a5a3a'; g.lineWidth = 1.6;
    for (let i = 0; i < 4; i++) {                      // 鏽色鋼筋束
      const x = rnd() * S, y = rnd() * S, a = rnd() * 7;
      for (let k = 0; k < 4; k++) {
        const ox = k * 3 * Math.sin(a), oy = k * 3 * Math.cos(a);
        g.beginPath(); g.moveTo(x + ox, y + oy);
        g.lineTo(x + Math.cos(a) * 30 + ox, y + Math.sin(a) * 30 + oy); g.stroke();
      }
    }
    g.fillStyle = '#b0b4b8';
    for (let i = 0; i < 4; i++) g.fillRect(rnd() * S, rnd() * S, 20 + rnd() * 14, 10 + rnd() * 8);
  },
  gasstation(g, S, rnd) {                              // 加油站:水泥坪 + 黃邊加油島 + 油漬 + 導引虛線(fit)
    g.fillStyle = baseFill(0xb8bab6, rnd); g.fillRect(0, 0, S, S);
    for (let i = 0; i < 7; i++) {
      g.fillStyle = `rgba(50,52,56,${0.15 + rnd() * 0.2})`;
      brushBlob(g, rnd() * S, S * 0.3 + rnd() * S * 0.5, 6 + rnd() * 12, rnd);
    }
    g.fillStyle = '#d9b23d';
    g.fillRect(S * 0.28, S * 0.42, S * 0.44, 16);
    g.fillStyle = '#c8cac6';
    g.fillRect(S * 0.28 + 3, S * 0.42 + 3, S * 0.44 - 6, 10);
    g.strokeStyle = 'rgba(255,255,255,0.8)'; g.lineWidth = 3;
    g.setLineDash([14, 10]);
    for (const y of [S * 0.2, S * 0.78]) {
      g.beginPath(); g.moveTo(8, y); g.lineTo(S - 8, y); g.stroke();
    }
    g.setLineDash([]);
    g.strokeStyle = '#e04a3a'; g.lineWidth = 2;        // 禁停紅框
    g.strokeRect(S * 0.06, S * 0.34, 26, 30);
  },
  park(g, S, rnd) {                                    // 公園:草坪 + 蜿蜒步道 + 樹蔭 + 花圃
    g.fillStyle = baseFill(SUB_COL.park, rnd); g.fillRect(0, 0, S, S);
    const ph = rnd() * 7;
    g.strokeStyle = '#c9b98e'; g.lineWidth = 12; g.lineCap = 'round';
    g.beginPath();
    for (let x = -4; x <= S + 4; x += 10) {
      const y = S * 0.5 + Math.sin(x * 0.03 + ph) * S * 0.22;
      x < 0 ? g.moveTo(x, y) : g.lineTo(x, y);
    }
    g.stroke();
    for (let i = 0; i < 6; i++) {                      // 樹蔭淡影(樹體 = 3D 實例)
      g.fillStyle = 'rgba(60,110,52,0.35)';
      brushBlob(g, rnd() * S, rnd() * S, 9 + rnd() * 9, rnd);
    }
    const cs = ['#e88bb0', '#f2d24a', '#f5f5f5'];
    for (let i = 0; i < 3; i++) {
      const x = rnd() * S, y = rnd() * S;
      g.fillStyle = '#5c8a44'; g.beginPath(); g.arc(x, y, 8, 0, 7); g.fill();
      g.fillStyle = cs[(rnd() * cs.length) | 0];
      for (let k = 0; k < 7; k++) { g.beginPath(); g.arc(x + (rnd() - 0.5) * 10, y + (rnd() - 0.5) * 10, 1.6, 0, 7); g.fill(); }
    }
  },
  plaza(g, S, rnd) {                                   // 廣場:同心圓環雙色舖面 + 放射縫線(fit)
    g.fillStyle = baseFill(0xb0a898, rnd); g.fillRect(0, 0, S, S);
    const cx = S / 2, cy = S / 2;
    for (let r = S * 0.62; r > 10; r -= 16) {
      g.fillStyle = (r / 16 | 0) % 2 ? '#a89a86' : '#c0b4a0';
      g.beginPath(); g.arc(cx, cy, r, 0, 7); g.fill();
    }
    g.strokeStyle = 'rgba(120,110,96,0.7)'; g.lineWidth = 2;
    for (let a = 0; a < 6.28; a += 0.52) {
      g.beginPath(); g.moveTo(cx, cy);
      g.lineTo(cx + Math.cos(a) * S * 0.62, cy + Math.sin(a) * S * 0.62); g.stroke();
    }
    g.fillStyle = '#8a7c68';
    g.beginPath(); g.arc(cx, cy, 9, 0, 7); g.fill();
  },
  scrapyard(g, S, rnd) {                               // 廢車場:鏽水漬 + 油污 + 廢鐵散件(fit)
    g.fillStyle = baseFill(0x86766a, rnd); g.fillRect(0, 0, S, S);
    for (let i = 0; i < 12; i++) {
      g.fillStyle = `rgba(150,80,42,${0.18 + rnd() * 0.22})`;
      brushBlob(g, rnd() * S, rnd() * S, 6 + rnd() * 14, rnd);
    }
    for (let i = 0; i < 8; i++) {                      // 油污(廢鐵散件 = 3D 實例)
      g.fillStyle = `rgba(40,40,44,${0.2 + rnd() * 0.2})`;
      brushBlob(g, rnd() * S, rnd() * S, 5 + rnd() * 10, rnd);
    }
  },
  containeryard(g, S, rnd) {                           // 貨櫃場:瀝青 + 黃色櫃位格線 + 走道白斑馬點(fit)
    g.fillStyle = baseFill(0x4a4e52, rnd); g.fillRect(0, 0, S, S);
    for (let i = 0; i < 6; i++) {
      g.fillStyle = 'rgba(255,255,255,0.05)';
      brushBlob(g, rnd() * S, rnd() * S, 10 + rnd() * 18, rnd);
    }
    g.strokeStyle = '#d9b23d'; g.lineWidth = 2.5;
    for (let y = 14; y < S; y += 46) {
      for (let x = 10; x < S - 30; x += 40) g.strokeRect(x, y, 34, 16);
    }
    g.fillStyle = 'rgba(240,242,238,0.85)';
    for (let x = 8; x < S; x += 22) g.fillRect(x, S / 2 - 2, 12, 4);
  },
  cemetery(g, S, rnd) {                                // 墓園:草坪 + 十字步道 + 墓位淡列(墓碑 = 3D 實例)(fit)
    g.fillStyle = baseFill(0x7fa35e, rnd); g.fillRect(0, 0, S, S);
    g.strokeStyle = '#cfc8b4'; g.lineWidth = 9;
    g.beginPath(); g.moveTo(S / 2, 4); g.lineTo(S / 2, S - 4); g.stroke();
    g.beginPath(); g.moveTo(4, S / 2); g.lineTo(S - 4, S / 2); g.stroke();
    g.strokeStyle = 'rgba(90,110,80,0.4)'; g.lineWidth = 2;
    for (let y = 18; y < S - 8; y += 24) {             // 墓位列的踏痕淡線
      g.beginPath(); g.moveTo(8, y); g.lineTo(S - 8, y); g.stroke();
    }
  },
  solarfarm(g, S, rnd) {                               // 太陽能場:碎石地 + 支架軌道列(板體 = 3D 實例)(fit)
    g.fillStyle = baseFill(0x9a9584, rnd); g.fillRect(0, 0, S, S);
    g.fillStyle = 'rgba(255,255,255,0.07)';
    for (let i = 0; i < 40; i++) g.fillRect(rnd() * S, rnd() * S, 2, 2);
    g.strokeStyle = 'rgba(140,136,124,0.8)'; g.lineWidth = 3;
    for (let y = 14; y < S - 8; y += 30) {             // 支架軌道(板列由 3D solarpanel 對齊排上)
      g.beginPath(); g.moveTo(6, y); g.lineTo(S - 6, y); g.stroke();
    }
  },
  helipad(g, S, rnd) {                                 // 直升機坪:圓標 + H 字 + 外框虛線(fit)
    g.fillStyle = baseFill(0x8f9294, rnd); g.fillRect(0, 0, S, S);
    g.strokeStyle = '#f2f4f0'; g.lineWidth = 6;
    g.beginPath(); g.arc(S / 2, S / 2, S * 0.34, 0, 7); g.stroke();
    g.lineWidth = 10;
    g.beginPath(); g.moveTo(S * 0.42, S * 0.36); g.lineTo(S * 0.42, S * 0.64); g.stroke();
    g.beginPath(); g.moveTo(S * 0.58, S * 0.36); g.lineTo(S * 0.58, S * 0.64); g.stroke();
    g.beginPath(); g.moveTo(S * 0.42, S / 2); g.lineTo(S * 0.58, S / 2); g.stroke();
    g.setLineDash([10, 8]); g.lineWidth = 3;
    g.strokeRect(8, 8, S - 16, S - 16); g.setLineDash([]);
  },
  // ======== 濕地擴充 ========
  // 魚塭:放苗滿水(春)→ 水車全開(夏)→ 收成拉網 + 水位降(秋)→ 乾塘曬池(冬)
  fishpond(g, S, rnd, season) {
    const s = seasonI(season);
    g.fillStyle = baseFill(0x9a8a68, rnd); g.fillRect(0, 0, S, S);   // 土堤四季不變
    const water = [0x4a6e70, 0x3f5e63, 0x53696a, 0x8a7f66][s];       // 冬:池底泥
    const gw = 74, gh = 56;
    for (let y = 8; y < S - 10; y += gh) {
      for (let x = 8; x < S - 10; x += gw) {
        g.fillStyle = baseFill(water, rnd);
        g.fillRect(x, y, gw - 10, gh - 10);
        if (s === 3) {                                 // 冬:曬池 —— 龜裂的池底
          g.strokeStyle = 'rgba(122,108,82,0.8)'; g.lineWidth = 1.2;
          for (let k = 0; k < 7; k++) {
            const ax = x + 4 + rnd() * (gw - 18), ay = y + 4 + rnd() * (gh - 18), a = rnd() * Math.PI * 2;
            g.beginPath(); g.moveTo(ax, ay); g.lineTo(ax + Math.cos(a) * 12, ay + Math.sin(a) * 9); g.stroke();
          }
          continue;
        }
        g.fillStyle = `rgba(255,255,255,${s === 2 ? 0.10 : 0.16})`;   // 水面天光(秋水位降 ⇒ 反光弱)
        g.fillRect(x + 4, y + 4, gw - 26, 2.5);
        if (s === 2) {                                 // 秋:收成的拉網(池面上的網格)
          g.strokeStyle = 'rgba(228,232,220,0.55)'; g.lineWidth = 1;
          for (let k = 6; k < gw - 10; k += 9) { g.beginPath(); g.moveTo(x + k, y); g.lineTo(x + k, y + gh - 10); g.stroke(); }
          continue;
        }
        const wx = x + 10 + rnd() * (gw - 30), wy = y + 8 + rnd() * (gh - 24);
        g.fillStyle = 'rgba(240,248,250,0.85)';        // 增氧水車白花
        for (let k = 0; k < (s === 0 ? 3 : 6); k++) {  // 春:剛放苗,水車開一半
          g.beginPath(); g.arc(wx + (rnd() - 0.5) * 10, wy + (rnd() - 0.5) * 7, 1.6, 0, 7); g.fill();
        }
      }
    }
  },
};

// ---- 地表定義 ----
// shape:blob=不規則色塊 / rect=田塊、場地;uv:'fit'=單張鋪滿(否則世界投影 tile)
// edge:'fade'=外圈 alpha 淡出融入地形(自然類)/ 'ink'=硬邊墨線(人造類)
// slope:允許的高差/半徑比;rim:外圈隆起(田埂);fam:延伸擺放家族
// reg:整齊規律程度(0..1)= 放置時沿最近道路方向整齊擺放的機率(orient());
//     其餘機率、或附近無路 → 隨機朝向。人造耕地/場地高,自然色塊 0 恆隨機
const DEFS = {
  turf:         { shape: 'blob', uvS: 1 / 14, edge: 'fade', slope: 0.40, reg: 0, green: true, fam: 'blobGreen' },
  meadow:       { shape: 'blob', uvS: 1 / 16, edge: 'fade', slope: 0.45, reg: 0, green: true, fam: 'blobGreen' },
  bushfield:    { shape: 'blob', uvS: 1 / 13, edge: 'fade', slope: 0.40, reg: 0, green: true, fam: 'blobGreen' },
  flowerfield:  { shape: 'blob', uvS: 1 / 15, edge: 'fade', slope: 0.35, reg: 0.15, green: true, fam: 'blobGreen' },
  orchard:      { shape: 'blob', uvS: 1 / 20, edge: 'fade', slope: 0.30, reg: 0.45, green: true, fam: 'blobGreen', seasonal: 1 },
  teafield:     { shape: 'rect', uv: 'fit', aspect: 0.8, edge: 'ink', slope: 0.22, reg: 0.8, green: true, fam: 'rectFarm', seasonal: 1 },
  veggiefield:  { shape: 'rect', uv: 'fit', aspect: 0.7, edge: 'ink', slope: 0.12, reg: 0.8, green: true, fam: 'rectFarm', seasonal: 1 },
  pasture:      { shape: 'rect', uv: 'fit', aspect: 0.75, edge: 'ink', slope: 0.26, reg: 0.6, green: true, fam: 'rectFarm', seasonal: 1 },
  paddy:        { shape: 'rect', uv: 'fit', aspect: 0.7, edge: 'ink', slope: 0.09, rim: 0.5, reg: 0.8, green: true, fam: 'rectFarm', seasonal: 1 },
  dryfield:     { shape: 'rect', uv: 'fit', aspect: 0.7, edge: 'ink', slope: 0.14, rim: 0.35, reg: 0.7, fam: 'rectFarm', seasonal: 1 },
  wild:         { shape: 'blob', uvS: 1 / 15, edge: 'fade', slope: 0.50, reg: 0, fam: 'blobBare' },
  gravel:       { shape: 'blob', uvS: 1 / 10, edge: 'fade', slope: 0.40, reg: 0, fam: 'blobBare' },
  sand:         { shape: 'blob', uvS: 1 / 18, edge: 'fade', slope: 0.35, reg: 0, fam: 'blobBare' },
  mud:          { shape: 'blob', uvS: 1 / 12, edge: 'fade', slope: 0.30, reg: 0, fam: 'blobBare' },
  crackedearth: { shape: 'blob', uvS: 1 / 14, edge: 'fade', slope: 0.35, reg: 0, fam: 'blobBare' },
  redsoil:      { shape: 'blob', uvS: 1 / 15, edge: 'fade', slope: 0.40, reg: 0, fam: 'blobBare' },
  lawn:         { shape: 'blob', uvS: 1 / 12, edge: 'fade', slope: 0.30, reg: 0.2, green: true },
  concrete:     { shape: 'rect', uvS: 1 / 16, aspect: 0.8, edge: 'ink', slope: 0.14, reg: 0.75, fam: 'rectUrban' },
  brick:        { shape: 'rect', uvS: 1 / 8, aspect: 0.8, edge: 'ink', slope: 0.12, reg: 0.7 },
  pavement:     { shape: 'blob', uvS: 1 / 8, edge: 'ink', slope: 0.20, reg: 0.6 },
  parking:      { shape: 'rect', uv: 'fit', aspect: 0.7, edge: 'ink', slope: 0.10, reg: 0.95, fam: 'rectUrban' },
  court:        { shape: 'rect', uv: 'fit', aspect: 0.54, edge: 'ink', slope: 0.08, reg: 0.9, fam: 'rectUrban' },
  track:        { shape: 'rect', uv: 'fit', aspect: 0.5, edge: 'ink', slope: 0.08, reg: 0.9, fam: 'rectUrban' },
  marsh:        { shape: 'blob', uvS: 1 / 14, edge: 'fade', slope: 0.25, reg: 0, green: true, fam: 'wetFam', aq: 1 },
  lotus:        { shape: 'blob', uvS: 1 / 12, edge: 'fade', slope: 0.15, reg: 0, fam: 'wetFam', aq: 1 },
  // — 水域專屬底毯(aq:灘線/水面高度淘汰放行,頂點高夾到水面上;terrainEnvCode===1 專用)—
  watertile:    { shape: 'blob', uvS: 1 / 13, edge: 'fade', slope: 1.0, reg: 0, aq: 1 },
  deepwater:    { shape: 'blob', uvS: 1 / 13, edge: 'fade', slope: 1.0, reg: 0, aq: 1 },
  // — 綠地擴充:竹林/枯朽森林/伐木業/棚架農業 —
  arrowbamboo:  { shape: 'blob', uvS: 1 / 14, edge: 'fade', slope: 0.50, reg: 0, green: true, fam: 'blobGreen' },
  deadwood:     { shape: 'blob', uvS: 1 / 15, edge: 'fade', slope: 0.50, reg: 0, fam: 'deadFam' },
  fallenlogs:   { shape: 'blob', uvS: 1 / 13, edge: 'fade', slope: 0.45, reg: 0, green: true, fam: 'deadFam' },
  clearcut:     { shape: 'blob', uvS: 1 / 14, edge: 'fade', slope: 0.35, reg: 0.2, fam: 'deadFam' },
  lumberyard:   { shape: 'blob', uvS: 1 / 11, edge: 'fade', slope: 0.20, reg: 0.65, fam: 'deadFam' },
  rottencabin:  { shape: 'blob', uvS: 1 / 12, edge: 'fade', slope: 0.25, reg: 0.3, green: true, fam: 'ruinFam' },
  vineyard:     { shape: 'rect', uv: 'fit', aspect: 0.7, edge: 'ink', slope: 0.18, reg: 0.85, green: true, fam: 'rectFarm', seasonal: 1 },
  greenhouse:   { shape: 'rect', uv: 'fit', aspect: 0.6, edge: 'ink', slope: 0.10, reg: 0.9, fam: 'rectFarm', seasonal: 1 },
  // — 裸露地擴充:遺跡/死林/乾草原/廢耕/產業 —
  deadforest:   { shape: 'blob', uvS: 1 / 15, edge: 'fade', slope: 0.50, reg: 0, fam: 'deadFam' },
  slabruin:     { shape: 'blob', uvS: 1 / 10, edge: 'fade', slope: 0.45, reg: 0.15, fam: 'ruinFam' },
  steppe:       { shape: 'blob', uvS: 1 / 16, edge: 'fade', slope: 0.50, reg: 0, green: true, fam: 'alpFam' },
  abandonedfarm:{ shape: 'rect', uv: 'fit', aspect: 0.7, edge: 'ink', slope: 0.16, reg: 0.55, fam: 'rectFarm', seasonal: 1 },
  saltpan:      { shape: 'rect', uv: 'fit', aspect: 0.75, edge: 'ink', slope: 0.06, reg: 0.85, fam: 'panFam' },
  quarry:       { shape: 'rect', uv: 'fit', aspect: 0.8, edge: 'ink', slope: 0.45, reg: 0.5, fam: 'digFam' },
  // — 高地(相對高程分區;冬季裸露地也混入冰原)—
  plateau:      { shape: 'blob', uvS: 1 / 12, edge: 'fade', slope: 0.60, reg: 0, fam: 'alpFam' },
  icefield:     { shape: 'blob', uvS: 1 / 14, edge: 'fade', slope: 0.40, reg: 0, fam: 'alpFam' },
  scree:        { shape: 'blob', uvS: 1 / 11, edge: 'fade', slope: 0.80, reg: 0, fam: 'alpFam' },
  // — 市區擴充:工業/服務/休憩設施 —
  construction: { shape: 'rect', uv: 'fit', aspect: 0.75, edge: 'ink', slope: 0.20, reg: 0.7, fam: 'digFam' },
  gasstation:   { shape: 'rect', uv: 'fit', aspect: 0.7, edge: 'ink', slope: 0.08, reg: 0.95, fam: 'rectUrban' },
  park:         { shape: 'blob', uvS: 1 / 13, edge: 'fade', slope: 0.30, reg: 0.15, green: true, fam: 'blobGreen' },
  plaza:        { shape: 'rect', uv: 'fit', aspect: 0.85, edge: 'ink', slope: 0.08, reg: 0.9, fam: 'rectUrban' },
  scrapyard:    { shape: 'rect', uv: 'fit', aspect: 0.75, edge: 'ink', slope: 0.15, reg: 0.55, fam: 'yardFam' },
  containeryard:{ shape: 'rect', uv: 'fit', aspect: 0.7, edge: 'ink', slope: 0.08, reg: 0.9, fam: 'yardFam' },
  cemetery:     { shape: 'rect', uv: 'fit', aspect: 0.8, edge: 'ink', slope: 0.18, reg: 0.85, green: true },
  solarfarm:    { shape: 'rect', uv: 'fit', aspect: 0.7, edge: 'ink', slope: 0.12, reg: 0.9, fam: 'solarFam' },
  helipad:      { shape: 'rect', uv: 'fit', aspect: 1.0, edge: 'ink', slope: 0.06, reg: 0.6 },
  // — 濕地擴充 —
  fishpond:     { shape: 'rect', uv: 'fit', aspect: 0.8, edge: 'ink', slope: 0.06, reg: 0.8, fam: 'panFam', seasonal: 1 },
};
// 分區切片(值雜訊挑選;重複項 = 權重,首尾 = 稀有)
// 特徵層分區切片(值雜訊挑選;重複項 = 權重,首尾 = 稀有):
// 只放「場所」型地物 — 有立體細節或明確邊界;純地面型全數改由底毯負責
// 跨地貌形式差異(2026-07-12):太陽能板/貨櫃「市區零星件、裸露地大面積陣列」——
// solarfarm/containeryard 場所 patch 移到裸露地(荒地光電場/內陸貨櫃堆場),
// 市區改由 scatterDetails 在水泥地/停車場撒零星單件(見 concrete 分支)
const ZONES = {
  green: ['rottencabin', 'deadwood', 'paddy', 'flowerfield', 'orchard', 'arrowbamboo',
          'dryfield', 'bushfield', 'teafield', 'vineyard', 'paddy', 'clearcut',
          'veggiefield', 'pasture', 'flowerfield', 'fallenlogs', 'greenhouse', 'lumberyard'],
  bare:  ['slabruin', 'quarry', 'abandonedfarm', 'crackedearth', 'gravel', 'abandonedfarm',
          'solarfarm', 'containeryard', 'saltpan'],
  // 2026-08-13 使用者「紅磚地和水泥地大幅調降使用率」:brick 退出特徵層(它在底毯清單裡
  // 仍留一格 ⇒ 磚地沒有絕跡,只是不再是隨處可見的鋪面)
  urban: ['helipad', 'park', 'parking', 'plaza', 'court',
          'construction', 'track', 'gasstation', 'cemetery', 'scrapyard'],
  wet:   ['fishpond', 'lotus', 'marsh', 'fishpond'],
  alpine: ['slabruin', 'scree', 'plateau', 'slabruin'],
};
// 底毯分區切片:全為 tile 型(世界投影 UV)地面,大片連續鋪滿全部陸地
const CARPET = {
  green: ['turf', 'meadow', 'turf', 'bushfield', 'meadow', 'flowerfield', 'turf',
          'arrowbamboo', 'meadow', 'deadwood', 'turf', 'fallenlogs'],
  bare:  ['wild', 'gravel', 'steppe', 'crackedearth', 'sand', 'redsoil', 'wild',
          'deadforest', 'mud', 'scree'],
  // 2026-08-13 使用者「紅磚地和水泥地大幅調降使用率」:舊制 concrete×2 + brick×1 = 7 格裡的
  // 3 格,而 concrete 與 brick 又剛好是端點 ⇒ **實測佔市區底毯 36%**(端點加成見 CARPET_SEL)。
  // 各留一格(21 格裡的 2 格)⇒ 實測降到 11%,讓出來的份額給人行道鋪面與草坪/公園
  // (市區的開闊地實際上多半是這些)。**權重 MUST 用格數表達** —— 顏色路徑排序之後「排在
  // 清單哪個位置」已經由代表色決定,MUST NOT 再想靠挪位置調用量
  urban: ['pavement', 'pavement', 'pavement', 'pavement', 'pavement', 'pavement',
          'pavement', 'pavement', 'pavement', 'pavement', 'pavement', 'pavement',
          'lawn', 'lawn', 'lawn', 'lawn', 'park', 'park', 'park', 'concrete', 'brick'],
  wet:   ['marsh', 'marsh', 'lotus'],
  water: ['watertile'],   // 水域專屬(深水格由 cellKeyAt 依水深改配 deepwater,不走雜訊輪替)
  alpine: ['plateau', 'scree', 'icefield', 'steppe', 'plateau'],
};
// 延伸擺放家族:同族 patch 相互毗鄰延伸(農田拼布 / 運動園區 / 綠地群落 /
// 伐木跡地群 / 聚落遺跡 / 高地帶 / 鹽田魚塭 / 工地採石 / 堆置場)
const FAMS = {
  rectFarm:  ['paddy', 'dryfield', 'teafield', 'vineyard', 'greenhouse', 'veggiefield', 'abandonedfarm', 'pasture'],
  rectUrban: ['parking', 'court', 'track', 'concrete', 'plaza', 'gasstation'],
  blobGreen: ['turf', 'meadow', 'flowerfield', 'bushfield', 'orchard', 'park', 'arrowbamboo'],
  blobBare:  ['wild', 'gravel', 'sand', 'crackedearth', 'redsoil', 'mud'],
  wetFam:    ['marsh', 'lotus'],
  deadFam:   ['deadwood', 'deadforest', 'fallenlogs', 'clearcut', 'lumberyard'],
  ruinFam:   ['slabruin', 'rottencabin'],
  alpFam:    ['plateau', 'scree', 'icefield', 'steppe'],
  panFam:    ['saltpan', 'fishpond'],
  digFam:    ['quarry', 'construction'],
  yardFam:   ['scrapyard', 'containeryard'],
  solarFam:  ['solarfarm'],
};
// 田埂適用名冊:**推導不手寫** —— 農田拼布(rectFarm)+ 池區(panFam,魚塭/鹽田的土堤是
// 同一件事)。手寫一份名冊會在新增地表時靜默過期(牧場 pasture 只要進了 rectFarm 就自動有埂)。
const BUND_SUBS = new Set([...FAMS.rectFarm, ...FAMS.panFam]);
// 尺寸 [基準半徑, 變幅](rect 半寬;court/track 接近真實場地)
const SIZE = {
  turf: [9, 10], meadow: [10, 12], bushfield: [8, 8], flowerfield: [10, 8], orchard: [11, 8],
  lawn: [8, 8], wild: [10, 12], gravel: [8, 9], sand: [11, 12], mud: [8, 9],
  crackedearth: [11, 10], redsoil: [10, 9], marsh: [8, 8], lotus: [8, 6], watertile: [10, 8], deepwater: [10, 8],
  paddy: [13, 8], dryfield: [12, 8], teafield: [12, 6], veggiefield: [10, 6], pasture: [15, 10], concrete: [9, 7], brick: [7, 6],
  pavement: [8, 6], parking: [14, 4], court: [16, 3], track: [15, 3],
  arrowbamboo: [10, 8], deadwood: [11, 10], deadforest: [12, 10], fallenlogs: [9, 8],
  clearcut: [12, 8], lumberyard: [8, 6], rottencabin: [7, 4], vineyard: [13, 6],
  greenhouse: [11, 5], abandonedfarm: [12, 8], saltpan: [12, 6], fishpond: [11, 6],
  slabruin: [9, 6], steppe: [12, 12], plateau: [13, 10], icefield: [12, 10], scree: [10, 10],
  quarry: [14, 6], construction: [12, 6], gasstation: [11, 4], park: [12, 8], plaza: [10, 6],
  scrapyard: [11, 6], containeryard: [13, 5], cemetery: [10, 6], solarfarm: [14, 5], helipad: [9, 3],
};
// 綠色系季節色偏(材質 color 乘上貼圖)
const SEASON_TINT = { spring: 0xeaffe0, summer: 0xffffff, autumn: 0xffd9a8, winter: 0xdfe8ea };
const FLOWER_C = [0xe88bb0, 0xf2d24a, 0xf5f5f5, 0xc77ddb, 0xe8734a];
const CONTAINER_C = [0xd94f3d, 0x3d7ad9, 0x4f9a55, 0xe8a03d, 0x8a8f96];   // 貨櫃塗裝
const CAR_C = [0x9a4a3a, 0x5a6a7a, 0x7a6a3a, 0x4a5a4a, 0x8a3a2a];         // 廢車鏽色
const PUMP_C = [0xd94f3d, 0x3d6ed9, 0xf2d24a];                            // 加油機品牌色
const DRUM_C = [0x3d6ed9, 0xd94f3d, 0x4f9a55, 0xd9b23d, 0x8a8f96];        // 油桶塗裝
const AD_C = [0xe8734a, 0x3d7ad9, 0xf2d24a, 0x4f9a55, 0xc77ddb];          // 廣告看板底色

// ---- 3D 附件材質塗層:小型程序貼圖(白底 × 材質色/instance tint 相乘)----
// 人造附件不再是純色塊:貨櫃浪板/太陽能電池格/看板畫面/木箱板紋,與 2D 地表同語彙
const _detTexCache = new Map();
function detailTex(name) {
  if (_detTexCache.has(name)) return _detTexCache.get(name);
  const S = 128;
  const cv = document.createElement('canvas');
  cv.width = cv.height = S;
  const g = cv.getContext('2d');
  const rnd = mulberry32(0xDE7A ^ name.charCodeAt(0));
  g.fillStyle = '#f2f2f2'; g.fillRect(0, 0, S, S);
  if (name === 'corrugated') {                       // 貨櫃浪板:縱向明暗條
    for (let x = 0; x < S; x += 16) {
      g.fillStyle = 'rgba(120,120,124,0.35)'; g.fillRect(x, 0, 5, S);
      g.fillStyle = 'rgba(255,255,255,0.5)'; g.fillRect(x + 9, 0, 3, S);
    }
    g.fillStyle = 'rgba(150,90,50,0.3)';             // 鏽斑
    for (let i = 0; i < 5; i++) g.fillRect(rnd() * S, rnd() * S, 6 + rnd() * 10, 4 + rnd() * 6);
  } else if (name === 'solarcell') {                 // 太陽能板:電池片格線 + 天光反射
    g.fillStyle = '#dfe6f0'; g.fillRect(0, 0, S, S);
    g.strokeStyle = 'rgba(255,255,255,0.85)'; g.lineWidth = 2;
    for (let p = 0; p <= S; p += 21) {
      g.beginPath(); g.moveTo(p, 0); g.lineTo(p, S); g.stroke();
      g.beginPath(); g.moveTo(0, p); g.lineTo(S, p); g.stroke();
    }
    g.fillStyle = 'rgba(255,255,255,0.4)';
    g.fillRect(0, 0, S * 0.4, S * 0.22);             // 斜角天光
  } else if (name === 'ad') {                        // 廣告看板:色塊構圖 + 標語筆畫
    g.fillStyle = '#f4f0e6'; g.fillRect(0, 0, S, S);
    g.fillStyle = 'rgba(150,150,158,0.8)';
    g.fillRect(S * 0.08, S * 0.12, S * 0.5, S * 0.45);   // 主視覺色塊(乘 tint 後 = 品牌色)
    g.fillStyle = 'rgba(90,90,98,0.9)'; g.lineWidth = 5; g.lineCap = 'round';
    g.strokeStyle = 'rgba(90,90,98,0.9)';
    for (let i = 0; i < 3; i++) {                    // 標語行(抽象筆畫,不寫實際字)
      const y = S * (0.68 + i * 0.11);
      g.beginPath(); g.moveTo(S * 0.1, y); g.lineTo(S * (0.5 + rnd() * 0.35), y); g.stroke();
    }
  } else {                                           // wood 木箱:板條縫 + 木紋短撇
    for (let y = 0; y < S; y += 26) {
      g.strokeStyle = 'rgba(120,96,60,0.7)'; g.lineWidth = 3;
      g.beginPath(); g.moveTo(0, y); g.lineTo(S, y); g.stroke();
    }
    g.strokeStyle = 'rgba(140,112,72,0.5)'; g.lineWidth = 1.6;
    for (let i = 0; i < 20; i++) {
      const x = rnd() * S, y = rnd() * S;
      g.beginPath(); g.moveTo(x, y); g.lineTo(x + 10 + rnd() * 14, y + (rnd() - 0.5) * 3); g.stroke();
    }
  }
  const t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  _detTexCache.set(name, t);
  return t;
}

// ---- 3D 細節(多零件;底部貼地,pebble 不平移 = 半埋入土)----
// c:'grass'/'foliage' = 季節色;'palette' = 每實例指定色(材質白底 × instance tint);
// tex = 材質塗層貼圖(detailTex;與 2D 地表同為程序 canvas)
// sf = 軟性物質分類(A39;鍵 = toon.js SOFT_KINDS)。2026-08-13 使用者「稻浪 / 草波 / 芒草波」:
//   這一整張表在 2026-08-04 那一輪**整批漏標** —— 芒草在 biomes.js 的 VEG_DEFS 那半會飄,
//   而同一張圖上散在稻田/草原/河灘的這一半是硬的。症狀正是 A39 ④「那一叢草不會飄,而旁邊
//   同款的會」:沒有錯誤訊息,只是看起來不對。稻(rice)是**稻浪**的唯一實體,漏了它
//   「稻浪」就只剩地表那張畫上去的秧苗貼圖在原地不動。
//   **與 biomes.js 的 VEG_DEFS 有一個關鍵差別**:那邊的零件高度住 `part.y`(幾何置中),
//   這裡一律 `.translate(0, h/2, 0)` **烤進幾何**了 ⇒ 擺動錨點傳 `base: 0`(頂點自己的 y
//   就已經是整株座標),傳 part.y 那一套會把權重整個推高一截。
//   浮葉(lotuspad)刻意不標:它浮在水面上,沿風向的水平位移會讓葉片滑出水塘(同 turf 的
//   取捨 —— 那是鋪面,擺起來只會跟步道錯開)。木質件(幹/枝/枯立木)照舊一律不是軟性。
const cone = (r, h, n) => new THREE.ConeGeometry(r, h, n).translate(0, h / 2, 0);
const box = (w, h, d) => new THREE.BoxGeometry(w, h, d).translate(0, h / 2, 0);
const cyl = (r0, r1, h, n) => new THREE.CylinderGeometry(r0, r1, h, n).translate(0, h / 2, 0);
const DETAIL_DEFS = {
  tuft:     [{ geo: cone(0.5, 1.2, 5), c: 'grass', sf: 'grass' }],
  rice:     [{ geo: cone(0.26, 0.95, 4), c: 0x7fb257, sf: 'grass' }],
  reed:     [{ geo: cone(0.3, 1.7, 4), c: 0xa9b06a, sf: 'grass' }],
  bush:     [{ geo: new THREE.IcosahedronGeometry(0.85, 0).translate(0, 0.55, 0), c: 'foliage', sy: 0.8, sf: 'leaf' }],
  pebble:   [{ geo: new THREE.IcosahedronGeometry(0.42, 0), c: 0x938c7e, sy: 0.55 }],
  hay:      [{ geo: new THREE.CylinderGeometry(1.0, 1.0, 1.5, 9).rotateZ(Math.PI / 2).translate(0, 1.0, 0), c: 0xc9a85c }],
  sapling:  [{ geo: new THREE.CylinderGeometry(0.09, 0.13, 1.3, 5).translate(0, 0.65, 0), c: 0x6b4a2f },
             { geo: new THREE.IcosahedronGeometry(0.9, 0).translate(0, 1.7, 0), c: 'foliage', sy: 0.9, sf: 'leaf' }],
  flower:   [{ geo: cone(0.07, 0.5, 4), c: 0x5f8f44, sf: 'grass' },
             { geo: new THREE.IcosahedronGeometry(0.16, 0).translate(0, 0.55, 0), c: 'palette', sf: 'grass' }],
  lotuspad: [{ geo: new THREE.CylinderGeometry(0.6, 0.65, 0.06, 9).translate(0, 0.16, 0), c: 0x4f8f4f }],
  // — 枯朽森林/伐木業 —
  bamboo:   [{ geo: cyl(0.05, 0.08, 2.6, 4), c: 0xa9c364 },
             { geo: new THREE.IcosahedronGeometry(0.5, 0).translate(0, 2.7, 0), c: 'foliage', sy: 0.7 }],
  // 枯立木:分枝基部 MUST 落在該高度的主幹半徑內(骨折感 = 基部懸在幹外)
  snag:     [{ geo: cyl(0.12, 0.3, 3.0, 5), c: 0x8a7a66 },
             { geo: cone(0.09, 1.5, 4).rotateZ(-0.9).translate(0.1, 1.8, 0), c: 0x8a7a66 },
             { geo: cone(0.08, 1.2, 4).rotateZ(1.1).translate(-0.08, 2.1, 0), c: 0x8a7a66 }],
  charsnag: [{ geo: cyl(0.1, 0.26, 2.4, 5), c: 0x3a3632 },
             { geo: cone(0.08, 1.2, 4).rotateZ(-1.0).translate(0.08, 1.5, 0), c: 0x3a3632 }],
  log:      [{ geo: new THREE.CylinderGeometry(0.32, 0.36, 3.4, 7).rotateZ(Math.PI / 2).translate(0, 0.34, 0), c: 0x8a6a48 }],
  stump:    [{ geo: cyl(0.42, 0.55, 0.55, 7), c: 0x6e5138 },
             { geo: new THREE.CylinderGeometry(0.36, 0.36, 0.08, 7).translate(0, 0.58, 0), c: 0xd9c49a }],
  logpile:  [{ geo: new THREE.CylinderGeometry(0.3, 0.3, 3.0, 6).rotateZ(Math.PI / 2).translate(0, 0.3, 0), c: 0x9a744e },
             { geo: new THREE.CylinderGeometry(0.3, 0.3, 3.0, 6).rotateZ(Math.PI / 2).translate(0, 0.3, 0.62), c: 0x8a6a48 },
             { geo: new THREE.CylinderGeometry(0.28, 0.28, 2.8, 6).rotateZ(Math.PI / 2).translate(0, 0.82, 0.3), c: 0xa5825a }],
  plank:    [{ geo: box(2.2, 0.8, 1.1), c: 0xc9a86a }],
  cabin:    [{ geo: box(3.2, 1.7, 2.6), c: 0x6e5138 },
             { geo: new THREE.BoxGeometry(3.8, 0.2, 3.0).rotateZ(0.34).translate(0, 2.0, 0), c: 0x4f3a28 },
             { geo: new THREE.BoxGeometry(0.18, 2.6, 0.18).rotateZ(1.15).translate(1.9, 0.5, 0.6), c: 0x5c452e }],
  fencepost:[{ geo: cyl(0.07, 0.09, 1.1, 4), c: 0x6e5138 }],
  // — 棚架農業(半埋圓管 = 拱棚)—
  vinerow:  [{ geo: box(3.0, 1.0, 0.5), c: 0x4f7a38 },
             { geo: cyl(0.06, 0.06, 1.4, 4), c: 0x6e5138 }],
  ghouse:   [{ geo: new THREE.CylinderGeometry(1.0, 1.0, 3.2, 10).rotateZ(Math.PI / 2).translate(0, 0.32, 0), c: 0xd4dcd8 }],
  // — 遺跡/高地 —
  slab:     [{ geo: new THREE.BoxGeometry(1.7, 0.22, 1.2).rotateZ(0.16).translate(0, 0.3, 0), c: 0x9aa0a4 },
             { geo: box(0.7, 0.5, 0.6), c: 0x8d9094 }],
  iceshard: [{ geo: new THREE.IcosahedronGeometry(0.5, 0).translate(0, 0.28, 0), c: 0xcfe8f2 }],
  rockflat: [{ geo: new THREE.IcosahedronGeometry(0.7, 0), c: 0x8f887a, sy: 0.45 }],
  saltmound:[{ geo: cone(0.6, 0.9, 6), c: 0xf2f4f0 }],
  // — 工地/工業 —
  pipe:     [{ geo: new THREE.CylinderGeometry(0.5, 0.5, 2.6, 9).rotateZ(Math.PI / 2).translate(0, 0.5, 0), c: 0xb4b8bc }],
  spoil:    [{ geo: cone(1.2, 0.9, 7), c: 0x9a9384 }],
  barrier:  [{ geo: box(1.6, 0.7, 0.3), c: 0xe0dcd0 }],
  canopy:   [{ geo: cyl(0.14, 0.14, 3.2, 5), c: 0xc8ccc8 },
             { geo: new THREE.BoxGeometry(4.6, 0.28, 3.2).translate(0, 3.3, 0), c: 0xe8e4da }],
  pump:     [{ geo: box(0.5, 1.1, 0.35), c: 'palette' }],
  // 20ft ISO 貨櫃 / 轎車真實公稱外廓。此處是 BufferGeometry 消費端，不另寫 vehicles 轉接器；
  // 尺寸改變會刻意遷移 detailR → detFree 後續散布序列(2026-08-17 使用者裁決)。
  container:[{ geo: box(6.058, 2.591, 2.438), c: 'palette', tex: 'corrugated' }],
  carwreck: [{ geo: box(4.8, 1.45, 1.9), c: 'palette' }],
  solarpanel: [{ geo: new THREE.BoxGeometry(2.4, 0.1, 1.4).rotateX(-0.42).translate(0, 0.85, 0), c: 0x2e4a6e, tex: 'solarcell' },
             { geo: cyl(0.07, 0.07, 0.6, 4), c: 0x9aa0a4 }],
  // — 休憩設施 —
  bench:    [{ geo: box(1.4, 0.45, 0.5), c: 0x8a6a48, tex: 'wood' }],
  headstone:[{ geo: box(0.5, 0.85, 0.16), c: 0xb0b2ae }],
  // — 通用散件(2026-07-10:貼圖上的 2D 物件全面 3D 化)—
  boulder:  [{ geo: new THREE.IcosahedronGeometry(1.0, 0).translate(0, 0.5, 0), c: 0x8a8578, sy: 0.75 },
             { geo: new THREE.IcosahedronGeometry(0.5, 0).translate(0.75, 0.22, 0.3), c: 0x9a948a, sy: 0.7 }],
  drybush:  [{ geo: new THREE.IcosahedronGeometry(0.7, 0).translate(0, 0.4, 0), c: 0xa08c58, sy: 0.7 }],
  drum:     [{ geo: cyl(0.34, 0.34, 0.95, 8), c: 'palette' }],
  crate:    [{ geo: box(0.95, 0.9, 0.95), c: 0xb8935a, tex: 'wood' }],
  // — 2026-07-12 附件擴充:飄逸芒草/雜草/菜園葉球/看板/盆栽/籃球架 —
  miscanthus:[{ geo: cone(0.5, 1.6, 5), c: 'grass', sf: 'grass' },        // 芒草束:斜出抽穗 = 飄逸剪影
             // 花穗基部埋進草束錐內(該高度錐半徑 ~0.15),自叢心斜出才不像折枝
             // 三支花穗與草束**MUST 同一個 sf**:漏一支就是「草在飄、穗釘在空中」(A39 ④)
             { geo: cone(0.15, 1.1, 4).rotateZ(0.4).translate(0.1, 1.1, 0), c: 0xe8dfb8, sf: 'grass' },
             { geo: cone(0.14, 1.0, 4).rotateZ(-0.32).translate(-0.09, 1.05, 0.04), c: 0xd8cfa8, sf: 'grass' },
             { geo: cone(0.13, 0.9, 4).rotateX(0.35).translate(0, 1.0, 0.1), c: 0xe0d5ae, sf: 'grass' }],
  weed:     [{ geo: cone(0.3, 0.75, 4), c: 0x9aa060, sf: 'grass' },       // 雜草:歪斜雙叢
             { geo: cone(0.2, 0.55, 4).rotateZ(0.5).translate(0.25, 0, 0), c: 0x8a9050, sf: 'grass' }],
  cabbage:  [{ geo: new THREE.IcosahedronGeometry(0.34, 0).translate(0, 0.24, 0), c: 0x6f9a44, sy: 0.75 }],
  // 街邊廣告看板:板面是抽象色塊 + 標語筆畫。**這裡刻意不寫字** —— 它是散佈細節,沒有
  // 「這塊看板屬於哪個店家」的語意可依附;有名字的招牌一律走 worldtext(唯一文字圖層)。
  billboard:[{ geo: cyl(0.09, 0.12, 3.4, 5).translate(-1.4, 0, 0), c: 0x8a8f96 },
             { geo: cyl(0.09, 0.12, 3.4, 5).translate(1.4, 0, 0), c: 0x8a8f96 },
             { geo: box(3.8, 2.0, 0.16).translate(0, 2.2, 0), c: 'palette', tex: 'ad' },
             { geo: new THREE.BoxGeometry(4.0, 0.16, 0.2).translate(0, 2.16, 0), c: 0x5a6066 }],
  planter:  [{ geo: box(1.0, 0.5, 1.0), c: 0xa8654a },                    // 盆栽:陶盆 + 修剪灌木
             { geo: new THREE.IcosahedronGeometry(0.58, 0).translate(0, 0.95, 0), c: 'foliage', sy: 0.85 }],
  hoop:     [{ geo: cyl(0.1, 0.13, 3.0, 5), c: 0x8a8f96 },                // 籃球架:柱 + 白板 + 橘框
             { geo: box(1.8, 1.15, 0.1).translate(0, 2.55, -0.08), c: 0xf2f4f0 },
             { geo: new THREE.TorusGeometry(0.29, 0.045, 4, 9).rotateX(Math.PI / 2).translate(0, 2.8, 0.32), c: 0xd9622e }],
  // — 2026-08-13 點綴擴充:「同顏色的地貌拼圖上面可以繪製多個不同的細節,草地的小花,
  //   沙地的小石頭,水域的游魚,以此類推」。補的是**只有一種點綴的那幾款底毯**(沙地只有
  //   小石頭、沼澤只有蘆葦、深水一片全空、林地地被只有枯木),不是把每一款都塞滿。
  // 游魚:魚身(八面體壓扁)+ 尾鰭。**擺在水面下**(DIVE),不是貼在水面上 —— 水盤
  //   opacity 0.82 ⇒ 透得過去,而貼在面上就成了「浮在水上的魚」
  fish:     [{ geo: new THREE.OctahedronGeometry(0.34, 0).scale(1.6, 0.5, 0.62), c: 0xc8823c },
             { geo: cone(0.22, 0.34, 3).rotateZ(Math.PI / 2).translate(-0.5, 0, 0), c: 0xd8a05a }],
  // 貝殼:半顆壓扁的球 —— 沙灘上除了小石頭之外最不突兀的一種點綴
  shell:    [{ geo: new THREE.SphereGeometry(0.2, 6, 3, 0, Math.PI * 2, 0, Math.PI / 2)
               .scale(1, 0.42, 0.78), c: 0xe8ddc8 }],
  // 林地菇:柄 + 傘(枯木林/竹林/倒木地的地被)
  mushroom: [{ geo: cyl(0.05, 0.06, 0.22, 5), c: 0xe4d8bc },
             { geo: cone(0.19, 0.16, 7).translate(0, 0.2, 0), c: 0xa9603f }],
};

// 每型別的最大隨機傾角(rad;繞 x/z 各自抽):自然件歪斜、人造件近直立,
// 加上既有的隨機朝向 ry / 尺寸抖動 → 同型實例不再複製貼上
const TILT = {
  tuft: 0.22, rice: 0.16, reed: 0.2, bush: 0.1, sapling: 0.09, flower: 0.16, lotuspad: 0.05,
  bamboo: 0.13, snag: 0.18, charsnag: 0.18, log: 0.07, stump: 0.06, logpile: 0.05, plank: 0.08,
  fencepost: 0.14, vinerow: 0.04, ghouse: 0.03, slab: 0.22, iceshard: 0.35, rockflat: 0.3,
  saltmound: 0.06, pipe: 0.06, spoil: 0.05, barrier: 0.08, pebble: 0.4, hay: 0.07,
  boulder: 0.3, drybush: 0.18, drum: 0.07, crate: 0.06, carwreck: 0.05, bench: 0.04, headstone: 0.1,
  miscanthus: 0.24, weed: 0.3, cabbage: 0.12, billboard: 0.04, planter: 0.05, hoop: 0.03,
  fish: 0.12, shell: 0.5, mushroom: 0.14,
};

// 每型 3D 物件的整齊規律程度(0..1)= 隨機朝向路徑改為「沿最近道路方向擺放」的
// 機率(addDetail 經 orient() 擲骰;rows()/固定 ry 呼叫端已對齊 patch 軸,不經此表)。
// 人造直線件(貨櫃/太陽能板/看板/長凳/墓碑/拱棚)高;自然件與旋轉對稱件 0 恆隨機。
const REG = {
  tuft: 0, rice: 0, reed: 0, bush: 0, pebble: 0, hay: 0.3, sapling: 0, flower: 0, lotuspad: 0,
  bamboo: 0, snag: 0, charsnag: 0, log: 0.15, stump: 0, logpile: 0.6, plank: 0.4, cabin: 0.7,
  fencepost: 0.2, vinerow: 0.9, ghouse: 0.85, slab: 0.1, iceshard: 0, rockflat: 0, saltmound: 0,
  pipe: 0.5, spoil: 0, barrier: 0.75, canopy: 0.9, pump: 0.9, container: 0.9, carwreck: 0.45,
  solarpanel: 0.9, bench: 0.8, headstone: 0.85, boulder: 0, drybush: 0, drum: 0.2, crate: 0.5,
  miscanthus: 0, weed: 0, cabbage: 0, billboard: 0.85, planter: 0.6, hoop: 0.9,
  fish: 0, shell: 0, mushroom: 0,
};

// 3D 物件的水平足跡半徑(scale=1):**量零件實幾何**,MUST NOT 手寫 —— 零件表一改
// (換模型/加零件)手寫值就靜默過期,而畫面上的症狀是「兩台貨櫃長在一起」
const _detR = new Map();
/**
 * 一款細節的公稱高度(擺動權重的分母;A39 ⑤「span 推導不手寫」)。
 * 與 `biomes.js vegSpan` 同一條紀律:改零件表(加高花穗、換 sy)擺幅自己跟著走 ——
 * 手寫一個數字的話,加高之後梢端的權重停在 1 以下,那一款就整批擺不動而沒有任何錯誤訊息。
 * 幾何的落地平移已烤進 boundingBox(見 DETAIL_DEFS 檔頭),故直接取 max.y × sy。
 */
const _detSpan = new Map();
function detailSpan(type) {
  let s = _detSpan.get(type);
  if (s != null) return s;
  s = 0;
  for (const p of DETAIL_DEFS[type]) {
    if (!p.geo.boundingBox) p.geo.computeBoundingBox();
    s = Math.max(s, p.geo.boundingBox.max.y * (p.sy ?? 1));
  }
  s = Math.max(0.3, s);   // 分母 MUST NOT 為零(同 vegSpan 的下限)
  _detSpan.set(type, s);
  return s;
}

function detailR(type) {
  let r = _detR.get(type);
  if (r != null) return r;
  r = 0;
  for (const p of DETAIL_DEFS[type]) {
    p.geo.computeBoundingBox();
    const bb = p.geo.boundingBox;
    r = Math.max(r, Math.hypot(Math.max(Math.abs(bb.min.x), Math.abs(bb.max.x)),
                               Math.max(Math.abs(bb.min.z), Math.abs(bb.max.z))));
  }
  _detR.set(type, r);
  return r;
}

function bucketOf(buckets, key) {
  let b = buckets.get(key);
  if (!b) { b = { pos: [], nrm: [], uv: [], col: [], idx: [], base: 0, lnrm: [] }; buckets.set(key, b); }
  return b;
}

// ==== 貼地地被層的「地形法線」(2026-08-13 使用者定案「地形變化受 LUT 與勾線作用」)====
// 一切貼地拼圖的 `normal` 都是 **(0,1,0)** —— 它是一張鋪在地形上的皮,受光刻意不隨坡面走。
// 那個謊在勾線資訊緩衝上要付兩次錢:①拼圖底下的稜線與路塹一條線都畫不出來(法線是常數);
// ②拼圖鋪到盡頭接上裸地形時,常數法線撞上真法線 ⇒ 沿著拼圖的外緣畫出一條**假的**折邊線。
// 故另存一份 `aLandN` 只餵 gInfo(受光一行未動,見 toon.js 的 CEL_LAND_N)。
//
// 三條:
//   ①**取樣距 = 地形高程網格的格距**(`terrain.gridM`)。取更小是在同一個雙線性面內取樣
//     ⇒ 法線在格內是常數、差分退化成逐格階梯,折邊線又長回成格線;取更大則把稜線抹平。
//   ②**只吃 (x,z) 的純函式** ⇒ 相鄰拼圖在共用邊上取到**逐位元相同**的法線(拼圖之間天生
//     沒有折邊,seam 因此不是「壓下去」而是根本不存在)。
//   ③高度取樣走呼叫端給的 `hAt`:圖內 `terrain.heightAt`、緩衝空間 `terrain.bufferHeightAt`
//     (拿錯那一支 = 界外整圈法線被夾回圖界的值)。
function landNrmAt(hAt, x, z, d) {
  const s = d > 0 ? d : 1;
  const nx = (hAt(x - s, z) - hAt(x + s, z)) / (2 * s);
  const nz = (hAt(x, z - s) - hAt(x, z + s)) / (2 * s);
  const l = Math.hypot(nx, 1, nz) || 1;
  return [nx / l, 1 / l, nz / l];
}
/** 與 `b.nrm.push(0, 1, 0)` 成對出現的那一行(稽核逐檔比對兩者的數量) */
function pushLandN(b, hAt, x, z, d) {
  const n = landNrmAt(hAt, x, z, d);
  b.lnrm.push(n[0], n[1], n[2]);
}
// ==== 貼合抬升:斜坡破圖(2026-08-13 使用者回報「斜坡時地貌拼圖很容易破圖」)====
// 地被是一層皮:頂點取 `heightAt` ⇒ **頂點恆在地形上**,而頂點與頂點之間是**直的**。
// 地形不是 —— 它是逐格三角化的高度場,兩片三角面相接處有折角。一條跨過折角的皮邊(弦)
// 因此沉在地形之下,沉多少 = 折角 × 弦長 ÷ 4。皮的邊長是半個 cell(6.5m)、地形格距 8.5m
// ⇒ 幾乎每一條皮邊都跨過折角,而底毯的抬升只有 `CLIFT = 0.07m`。
// 2026-08-13 taroko 實測(`audit_ground_drape`):**22% 的三角形被地形戳穿**,
// p90 0.057m / p99 0.446m。平地看不到(折角 = 0),坡越陡越碎越明顯 —— 正是「斜坡時」。
//
// ⚠ **消費端自同日縮到三個**(使用者定案「A 認養地形三角形」):圖內底毯 / 外溢 / 脊帶已改
// 成直接吃地形自己的三角形(emitCell 檔頭)⇒ 那三層的弦虧損**在結構上就是 0**,MUST NOT
// 再對它們套這一支(再抬 = 浮在地形上,就是下面 ④ 講的另一半破圖)。剩下的三個消費端是
// **特徵拼圖 / 界線拼圖 / 緩衝空間底毯**:前兩者是任意旋轉的獨立面(鋪到地形格上邊緣會變
// 鋸齒,而它們本來就有坡度閘),後者站在裙上、根本沒有高程網格可以認養。
//
// 修法 = **逐頂點把弦虧損補回去**:抬升量 = 該點往八方的「中點高 − 兩端平均」最大值。
// 四條:
//   ①**MUST 是 (x,z) 的純函式**(同 landNrmAt)—— 相鄰面在共用頂點上取到逐位元同值,
//     否則抬升本身就把皮撕開;
//   ②**平面恆 0**(折角 = 0 ⇒ 虧損 = 0)⇒ 平地與緩坡**逐位元同舊制**,這一層只在真的
//     有折角的地方生效;
//   ③**兩端對稱**:邊 (v,n) 的中點虧損在 v 與 n 兩邊算出來是同一個數 ⇒ 兩端都抬了它,
//     弦在中點恰好回到地形上(不是「差不多」);
//   ④**MUST 夾上限**:抬過頭就不是貼合而是**浮在地形上**(懸空的地被同樣是破圖)。
//     上限分三種:道路走廊內 `ROAD` < 路面 lift 0.18 − 底毯 0.07 的餘裕(抬到比路面高
//     = 草皮蓋過馬路);圖內 `MAX`;緩衝空間 `BUF` 放寬(格距 ×BUF_CELL_F、離玩家 400m 以上,
//     那裡沒有別的東西要疊,而不放寬就是 30m 級的破口)。
const SAG = {
  MAX: 0.6,    // 圖內抬升上限(m)
  ROAD: 0.10,  // 道路走廊內(路面 lift 0.18 − 底毯 CLIFT 0.07 = 0.11 的餘裕)
  BUF: 6,      // 緩衝空間(格距 ×BUF_CELL_F,實測未修正時 p99 10.8m / max 37.6m)
};
//   ⑥**尺寸 MUST 是「這一層自己的弦長」**(2026-08-13 使用者回報「分界線如果是土路/潮間帶/
//     海灘不要凸起…田埂之類的也不要凸太多」的**根因**):抬升量 ∝ 弦長²,而舊制三個消費端
//     一律吃底毯的 `cell/2`(6.5m)。界線拼圖的環距只有 2m 上下、田埂的取樣間距 3m ——
//     拿 6.5m 的虧損去抬 2m 的弦,抬的是**十倍於自己需要**的量,直接頂到 `MAX` 0.6m。
//     這在底毯也吃 sag 的年代只是「整條 lift 階梯平移」(檔頭「同一份場餵給每一層」的理由);
//     自從底毯/外溢/脊帶改成**認養地形三角形**(sag ≡ 0)之後,那個理由就沒了 —— 界線與
//     田埂變成浮在**恰好貼著地形**的底毯上方半公尺的一條台,正是使用者看到的「凸起」。
//     故 `drapeSag` 收一個選用的 `r`,呼叫端 MUST 傳自己的弦長;不傳 = 底毯尺度(特徵拼圖
//     的 7×6 網格恰是那個量級,維持舊制)。
// ⑤**多尺度**:一條弦的虧損 ∝ 弦長 × 折角,而地被不是只有一種弦長 —— 底毯是半個 cell
//   (6.5m)、界線拼圖的環距只有 2m 上下。只量最長的那一尺,近處的小凸起就漏掉了
//   (2026-08-13 實測:單尺度把底毯的破圖從 22.0% 壓到 3.8%,而界線拼圖 29.6% → 29.5%
//   **一格未動**)。故三個尺度取最大值:大尺度給底毯、小尺度給窄帶,同一份場照樣單調。
// `?sag=0`:整層關掉,給定場照與 `audit_ground_drape --break-sag` 做前後對照 ——
// 同 `toon.js` 的 `?curve=0`(那一層也是「只有前後兩張擺在一起才看得出來」)。
const SAG_OFF = typeof location !== 'undefined' && /[?&]sag=0/.test(location.search);
const SAG_DIRS = [[1, 0], [-1, 0], [0, 1], [0, -1],
  [0.70711, 0.70711], [0.70711, -0.70711], [-0.70711, 0.70711], [-0.70711, -0.70711]];
// 尺度與方向數的取捨(2026-08-13 實測,taroko):最大尺度**要八方**(皮的三角化對角線在
// 那一尺上),小尺度只取四軸就夠 —— 逐頂點 48 次取樣 → 32 次,`buildBiomes` 1331 → 1252ms,
// 而三層破圖率一格未動(3.8% / 2.8% / 0.0%)。整條加起來的代價是 963 → 1252ms(+30%),
// 全部落在建構期(§建構期讓步的 buildYield 會讓出畫面),執行期一格未動。
const SAG_SCALES = [[1, 8], [0.45, 4], [0.2, 4]];
function groundSagAt(hAt, x, z, r) {
  if (!(r > 0)) return 0;
  const h0 = hAt(x, z);
  let s = 0;
  for (const [f, nd] of SAG_SCALES) {
    const rr = r * f;
    for (let k = 0; k < nd; k++) {
      const [dx, dz] = SAG_DIRS[k];
      // 中點高 − 兩端平均 = 這條弦在中點沉下去多少(平面恆 0 ⇒ 平地逐位元同舊制)
      const d = hAt(x + dx * rr * 0.5, z + dz * rr * 0.5)
        - (h0 + hAt(x + dx * rr, z + dz * rr)) * 0.5;
      if (d > s) s = d;
    }
  }
  return s;
}
/** 幾何附上 `aLandN`(缺席 ⇒ 材質端退回自己的法線,原則 6) */
function setLandN(geo, b) {
  if (b.lnrm?.length === b.pos.length) geo.setAttribute('aLandN', new THREE.Float32BufferAttribute(b.lnrm, 3));
}

// 不規則色塊。edge:'fade' 外圈 alpha=0 淡入地形;'ink' 外圈墨線頂點色(手繪描邊)
// 手繪輪廓的半徑抖動範圍(×r):**外緣最遠到 (MIN+JIT)·r,不是 r** —— 迴避半徑
// (tryPatch 的 bdCross)與這裡同源,拿 r 去算會讓 14% 的外緣壓上分界線帶
const BLOB_R = { MIN: 0.72, JIT: 0.42 };
function emitBlob(b, terrain, x, z, r, lift, uvS, edge, pt, rnd, sag) {
  const n = 12;
  // 每塊 UV 隨機旋轉:同款貼圖不同朝向(視野內同款已不重複,無需跨塊花紋連續)
  const ua = rnd() * Math.PI * 2, cu = Math.cos(ua), su = Math.sin(ua);
  const push = (vx, vz, cr, cg, cb, ca) => {
    b.pos.push(vx, terrain.heightAt(vx, vz) + lift + sag(vx, vz), vz);
    b.nrm.push(0, 1, 0);
    pushLandN(b, terrain.heightAt, vx, vz, terrain.gridM);
    b.uv.push((vx * cu - vz * su) * uvS, (vx * su + vz * cu) * uvS);
    b.col.push(cr * pt[0], cg * pt[1], cb * pt[2], ca);
  };
  const ph = rnd() * Math.PI * 2;               // 輪廓隨機起始相位:同半徑 blob 形狀互異
  const angs = [], rads = [];
  for (let i = 0; i < n; i++) {
    angs.push(ph - i / n * Math.PI * 2);        // 角度遞減 → 三角形面朝 +y
    rads.push(r * (BLOB_R.MIN + rnd() * BLOB_R.JIT));   // 邊界抖動 = 手繪輪廓
  }
  const eC = edge === 'fade' ? [1, 1, 1, 0] : [0.55, 0.56, 0.62, 1];
  const mR = edge === 'fade' ? 0.66 : 0.6;
  for (let i = 0; i < n; i++) push(x + Math.cos(angs[i]) * rads[i], z + Math.sin(angs[i]) * rads[i], ...eC);
  for (let i = 0; i < n; i++) push(x + Math.cos(angs[i]) * rads[i] * mR, z + Math.sin(angs[i]) * rads[i] * mR, 1, 1, 1, 1);
  push(x, z, 1, 1, 1, 1);
  const k = b.base, c = k + 2 * n;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    b.idx.push(k + i, k + j, k + n + i, k + j, k + n + j, k + n + i, k + n + i, k + n + j, c);
  }
  b.base += 2 * n + 1;
}

// ==== 農田田埂(2026-08-13 使用者定案「修對齊 + 組合夠大片才加田埂」)====
// 使用者原話:「地貌拼圖部分區塊沒有接得很好,例如田與田之間沒有整齊對準,**沒對準也可以
// 但要使用田埂隔開**」。兩件事分開修 —— 對齊那半住家族延伸(鄰塊尺寸依毗鄰軸反解),
// 這裡是田埂。
// 田埂**跨在足跡邊界上**(只往外長 `HW`):兩塊正鄰位的田相距 `FARM_GAP = 2 × HW` ⇒ 兩條埂
// 在小路中線背靠背接上 = 一條連續的埂;錯開的兩塊就讀成「田埂在這裡轉個折」,而真實的
// 梯田/水田本來就長這樣。往外那半仍在 `PATCH_GAP`(1.0)與帶緣 `BORDER_BAND.PAD`(1.6)之內
// ⇒ 不疊置與不橫跨分界線那兩道閘一格未動。
// **斷面三環**(往外量):
//   R0 = 足跡邊,dy = `def.rim ?? 0` —— **與田塊自己的外圈同高**,不開縫也不互戳;
//   R1 = 埂頂外緣,dy = max(rim, RISE);
//   R2 = R1 的正下方,dy = 0。
// 兩條帶:R0→R1 是埂頂、**R1→R2 是外側垂直面** —— 少了垂直面,掠射角就看穿一片浮空的
// 土色薄片(同 A44 ③「演出 ⊆ 碰撞盒」那一族的道理:看得見的東西要有厚度)。
// 「夠大片才加」= `BUND.MIN_N`:一塊孤田圍一圈埂讀起來像花壇,連成一片的拼布才是農地。
export const BUND = {
  HW: 0.6,      // 半寬(m):只往外長。FARM_GAP = 2×HW 是**推導**不是巧合(見上)
  // 埂高(m);田塊自己有 rim 時取較高者 ⇒ 埂恆蓋得住 rim,不會兩條脊打架。
  // 2026-08-13 使用者「田埂之類的也不要凸太多」:0.30 → 0.18(真實水田埂就是腳踝高;
  // 另一半的「凸」是貼合抬升拿錯弦長,見 SAG 檔頭 ⑥ 與上面 emitBund 的呼叫端)
  RISE: 0.18,
  MIN_N: 3,     // 「組合夠大片」的門檻(同一叢集內的農田塊數)
  SEG_M: 3,     // 沿埂的取樣間距(m):要跟得上地形起伏,又不必比田塊自己的 7×6 網格細
  UVS: 1 / 6,   // 埂頂的世界投影 UV 尺度 ⇒ 相鄰兩塊的夯土紋路連續延伸
};
export const FARM_GAP = BUND.HW * 2;   // 家族延伸的田間小路寬(兩條埂恰好在中線接上)
// 矩形環:同一組參數只差半跨 ⇒ 逐 index 對應(內外環的角落互相對到角落)
function bundRing(a, c, ns, nd) {
  const p = [];
  for (let i = 0; i < ns; i++) p.push([-a + 2 * a * i / ns, -c]);
  for (let i = 0; i < nd; i++) p.push([a, -c + 2 * c * i / nd]);
  for (let i = 0; i < ns; i++) p.push([a - 2 * a * i / ns, c]);
  for (let i = 0; i < nd; i++) p.push([-a, c - 2 * c * i / nd]);
  return p;
}
function emitBund(b, terrain, x, z, r, rot, def, lift, sag) {
  const hw = r, hd = r * (def.aspect || 0.7), H = BUND.HW;
  const rim = def.rim || 0, crest = Math.max(rim, BUND.RISE);
  const ns = Math.max(4, Math.round(2 * hw / BUND.SEG_M)), nd = Math.max(4, Math.round(2 * hd / BUND.SEG_M));
  const IN = bundRing(hw, hd, ns, nd), OUT = bundRing(hw + H, hd + H, ns, nd);
  const ca = Math.cos(rot), sa = Math.sin(rot);
  const world = ([lx, lz]) => [x + lx * ca - lz * sa, z + lx * sa + lz * ca];
  const L = IN.length;
  // 外環的累積周長:垂直面的 u 走弧長(拿頂投影會把 0.3m 高的面拉成一條抹開的條紋)
  const arc = new Array(L + 1).fill(0);
  for (let k = 0; k < L; k++) {
    const [ax, az] = OUT[k], [bx, bz] = OUT[(k + 1) % L];
    arc[k + 1] = arc[k] + Math.hypot(bx - ax, bz - az);
  }
  const base0 = b.base;
  // 四圈頂點:0 埂內緣 / 1 埂頂外緣 / 2 垂直面上緣(與 1 同位,只換 UV 與法線)/ 3 裙底。
  // 2 之所以要另存一圈:埂頂走世界投影 UV、垂直面走弧長 UV,共用頂點就是把 0.3m 高的面
  // 拉成一條抹開的條紋。帶 = 0→1(埂頂)與 2→3(外側垂直面)。
  const RINGS = [[IN, rim, 0], [OUT, crest, 0], [OUT, crest, 1], [OUT, 0, 1]];
  RINGS.forEach(([P, dy, wall]) => {
    for (let k = 0; k < L; k++) {
      const [wx, wz] = world(P[k]);
      b.pos.push(wx, terrain.heightAt(wx, wz) + lift + dy + sag(wx, wz), wz);
      if (wall) {                                       // 外側垂直面:法線朝外(折邊才畫得出線)
        const [ox, oz] = world(OUT[k]), [ix, iz] = world(IN[k]);
        const nl = Math.hypot(ox - ix, oz - iz) || 1;
        b.nrm.push((ox - ix) / nl, 0, (oz - iz) / nl);
        b.lnrm.push((ox - ix) / nl, 0, (oz - iz) / nl);   // 勾線資訊緩衝吃**真的**面法線 ⇒ 埂頂折邊出線
        b.uv.push(arc[k] * BUND.UVS, dy > 0 ? 0 : 1);
      } else {
        // 埂頂與其他貼地層同規:受光走 (0,1,0)(不隨坡面翻),勾線那一份給真地形法線 ——
        // 少了後者,埂底下的稜線畫不出來、而埂與田的交界會冒出一條假線(landNrmAt 檔頭)
        b.nrm.push(0, 1, 0);
        pushLandN(b, terrain.heightAt, wx, wz, terrain.gridM);
        b.uv.push(wx * BUND.UVS, wz * BUND.UVS);
      }
      // 埂頂暖土、內緣略帶田色(與田塊外圈銜接)、裙底壓暗
      const s = P === IN ? 0.88 : wall && dy === 0 ? 0.72 : 1;
      b.col.push(0.78 * s, 0.66 * s, 0.5 * s, 1);
    }
  });
  for (const A of [base0, base0 + 2 * L]) {             // 0→1 埂頂、2→3 垂直面
    const B = A + L;
    for (let k = 0; k < L; k++) {
      const k2 = (k + 1) % L;
      // 繞向同 emitRect 的 (a, f, e) 慣例:(p0, p0+沿環, p0+往外/往下)⇒ 埂頂朝 +y、面朝外
      b.idx.push(A + k, A + k2, B + k, A + k2, B + k2, B + k);
    }
  }
  b.base += 4 * L;
}

// 矩形田塊/場地:6×7 網格貼地;rim = 外圈隆起田埂(暖土頂點色),否則外圈墨線
function emitRect(b, terrain, x, z, r, rot, def, lift, pt, flipU, flipV, rnd, sag) {
  const w = r * 2, d = r * 2 * (def.aspect || 0.7);
  const nx = 7, nz = 6;
  const ca = Math.cos(rot), sa = Math.sin(rot);
  for (let j = 0; j < nz; j++) {
    for (let i = 0; i < nx; i++) {
      const lx = (i / (nx - 1) - 0.5) * w, lz = (j / (nz - 1) - 0.5) * d;
      const vx = x + lx * ca - lz * sa, vz = z + lx * sa + lz * ca;
      const edge = i === 0 || j === 0 || i === nx - 1 || j === nz - 1;
      let dy = 0, cr = 1, cg = 1, cb = 1;
      if (edge) {
        if (def.rim) { dy = def.rim; cr = 0.78; cg = 0.66; cb = 0.5; }
        else { cr = 0.6; cg = 0.6; cb = 0.64; }
      }
      b.pos.push(vx, terrain.heightAt(vx, vz) + lift + dy + sag(vx, vz), vz);
      b.nrm.push(0, 1, 0);
      pushLandN(b, terrain.heightAt, vx, vz, terrain.gridM);
      if (def.uv === 'fit') {
        const u = i / (nx - 1), v = j / (nz - 1);
        b.uv.push(flipU ? 1 - u : u, flipV ? 1 - v : v);   // 隨機雙軸鏡射:同變體場地四款朝向
      } else b.uv.push(vx * def.uvS, vz * def.uvS);
      b.col.push(cr * pt[0], cg * pt[1], cb * pt[2], 1);
    }
  }
  for (let j = 0; j < nz - 1; j++) {
    for (let i = 0; i < nx - 1; i++) {
      const a = b.base + j * nx + i, e = a + 1, f = a + nx, g = f + 1;
      b.idx.push(a, f, e, e, f, g);
    }
  }
  b.base += nx * nz;
  void rnd;
}

// ==== 底毯選款區塊:同一種地貌裡「顏色」的最小尺度(2026-08-12 使用者需求)====
// 「地貌拼圖有時候綠突然變紅又突然變灰,如果是同一類型(市區/綠地/裸露地/水域/濕地),
//   盡可能不要短距離快速變化地貌拼圖顏色」。
// 病灶:選款是「低頻雜訊 t → 清單索引」的**逐格**取值,而一份清單有 10~12 款、t 的梯度在
// 雜訊場的陡處可以在十幾公尺內橫掃好幾個索引 ⇒ 沿著那條帶走過去就是 turf→flowerfield→
// deadwood(綠→紅→灰)。每一格自己都「照規則」選的,沒有任何既有斷言看得出問題。
// 新制:選款的**取值點**改成區塊(lot)—— 抖動格點的最近點分割(jittered-Voronoi / Worley),
// 同一個 lot 內的格子一律拿 lot 中心那一個 t ⇒ 同一種地貌裡的顏色至少走過一個 lot 才會換。
// 四條:
//   ①**純函式**(座標雜湊,零 rnd / 零 Math.random,§2.3)⇒ 跨客戶端逐位元一致、插在
//     建構流程任何位置都不推移植被佈局;
//   ②**只作用在分區之內** —— 分區(green/bare/urban/wet/water/alpine)仍逐格由影像/坡度/
//     envCode 定,lot 只決定「這一格在它自己的分區清單裡挑哪一款」⇒ 真實的地貌界線一格
//     都沒有被推移(界線拼圖與外溢吃的是同一份 zoneGrid);
//   ③**抖動 MUST < 0.5 格距**:超過的話最近的 lot 中心可能落在 3×3 候選之外,分割會出現
//     「兩格中間各自認不同 lot」的破洞,而畫面上只表現成偶爾一格顏色跳掉;
//   ④間距以底毯格數計 ⇒ 改 cell(隨圖幅推導)時自己跟著走,MUST NOT 手寫公尺數。
// 2026-08-13 使用者再次回報「同一類型盡可能不要短距離快速變化子類別」⇒ 這一輪三管齊下,
// 三件事各修病灶的一半,MUST NOT 只做其中一件:
//   ㋐ 換款的**頻率**:lot 6 → 9 格(78m → 117m)+ 選款場的波長加倍(CARPET_SEL);
//   ㋑ 換款的**幅度**:清單改成顏色路徑(carpetOrder)⇒ 索引相鄰 = 顏色相鄰;
//   ㋒ 剩下那幾個結構上避不掉的大跳(色距 > CARPET_DE.LINE,例如雪線 icefield↔steppe 253)
//      改成「畫一條對應地貌的分界線」(borderKindOf 的同地貌分支)—— 界線覆蓋上去,
//      那個跳就從「突兀」變成「這裡本來就是兩片不一樣的地」。
export const CARPET_LOT = { CELLS: 9, JIT: 0.42 };
// 選款場的取樣(唯一縫;`cellSubAt` 與稽核的對照組同吃 —— 手抄一份頻率進稽核,調完頻率
// 那一段就在量一個已經不存在的舊制)。W/QC_W = 波數(1/m);SPAN/QC_A = 值域與準晶體項權重。
// 兩項的尺度算法不同(vnoise 是單位格距的值雜訊 ⇒ 特徵尺度 = 1/W;準晶體是平面波和 ⇒
// 波長 = 2π/QC_W):W 0.006 → 0.0032 是 167m → 313m,QC_W 0.035 → 0.018 是 180m → 349m。
// **兩者 MUST 同步放大** —— 只放大其中一個,另一個就成了新的最短換款尺度,而畫面上看起來
// 完全沒改善。
// SPAN 2.2 → 1.4 是**這一輪不得不動的一格**:`vnoise` 的邊際分布是鐘形(實測 p05 0.148 /
// p95 0.851,不是均勻),×2.2 的有效取樣窗只有 [0.273, 0.727] ⇒ **三成的取樣被夾在兩端**,
// 首尾兩個槽位各拿到 ~20% 而中間每一格只有 4~5%(實測 8 顆種子 × 90000 格)。清單改成顏色
// 路徑之後,「首尾」就是**顏色的兩個極端** —— 也就是說每一種地貌的畫面會被它自己最極端的
// 兩個顏色佔掉四成,那正是使用者說的「突兀」的另一半;而「紅磚地大幅調降」在舊制下根本
// 做不到(brick 是市區清單裡色相最遠的一款 ⇒ 恆落在端點 ⇒ 恆拿 20%,寫幾格權重都沒用)。
// 1.4 是實測**逐槽位佔比最接近宣告權重**的值(清單長 10:7.6~11.9% vs 宣告 10%;長 15:
// 4.1~8.6% vs 6.7%;2.2 是 6.2~22.5%,1.0 又倒過來變成中間 16.8% / 兩端 2.1%)。
export const CARPET_SEL = { W: 0.0032, SPAN: 1.4, QC_W: 0.018, QC_A: 0.30 };
// 「顏色劇烈變化」的門檻(redmean 色距;2026-08-13 使用者「顏色劇烈變化處也使用對應地貌的
// 分界線覆蓋」)。實測(carpetOrder 排序後的清單內相鄰步距):p50 49 / p90 134 / max 253
// ⇒ 100 恰好只圈住**結構上避不掉的那幾個大跳**:雪線 icefield↔steppe 253、龜裂地↔泥灘 157、
// 磚地↔人行道 137、水泥↔公園 127、枯林↔礫石 134、草坪↔人行道 114、沙↔乾草原 103。
// 門檻再低就會把整片綠地切成網狀(2026-08-11「同地貌不畫線」那條定案的病灶),再高就只剩
// 雪線一種。**同地貌的線只由色距觸發**,地表級覆寫(BORDER_SUB_RULES)仍只作用在跨地貌。
export const CARPET_DE = { LINE: 100 };
// 回傳 [li, lj, ci, cj]:lot 索引 + lot 中心(**格索引空間**,呼叫端自行換算成世界座標取樣)
export function carpetLotAt(i, j, seed, cells = CARPET_LOT.CELLS, jit = CARPET_LOT.JIT) {
  const S = Math.max(1, cells);
  const gi = Math.floor(i / S), gj = Math.floor(j / S);
  let best = null, bd = Infinity;
  for (let oj = -1; oj <= 1; oj++) {
    for (let oi = -1; oi <= 1; oi++) {
      const li = gi + oi, lj = gj + oj;
      // vnoise 取整數座標 = 純雜湊(雙線性的 fx/fz 皆為 0),不另寫第二支雜湊
      const ci = (li + 0.5 + (vnoise(li, lj, (seed ^ 0x1F3A) | 0) - 0.5) * 2 * jit) * S;
      const cj = (lj + 0.5 + (vnoise(li, lj, (seed ^ 0x77C1) | 0) - 0.5) * 2 * jit) * S;
      const dx = ci - (i + 0.5), dz = cj - (j + 0.5);
      const d = dx * dx + dz * dz;
      if (d < bd) { bd = d; best = [li, lj, ci, cj]; }
    }
  }
  return best;
}

// ==== 底毯花紋:同顏色的相鄰拼圖畫不同的圖案(2026-08-12 使用者需求)====
// 「同顏色的地貌拼圖上面可以繪製多個不同的紋路/圖案/點綴/裝飾等細節,同顏色的相鄰拼圖的
//   紋路/圖案/點綴/裝飾等細節盡可能是不同的」。
// 舊制變體是低頻雜訊(波長 ~400m)⇒ 一整片草皮從頭到尾同一張貼圖,反重複全靠鏡射平鋪與
// wash 撐;新制逐格挑,**硬條件 = 共邊的同款鄰格恆不同變體**(掃描序已定案的左/上兩格),
// 軟條件 = 連對角也盡量不同(3 變體 × 8 鄰在數學上做不到全異 —— 一個 2×2 方塊裡四格兩兩
// 相鄰,要全異得要 4 色;使用者原話也是「盡可能」)。
// 三條刻意設計:
//   ①**純函式**(掃描序貪婪,零 rnd,§2.3)—— 決定性 = 跨客戶端一致;
//   ②約束只在**同一款**之間成立(異款本來就是兩張不同的貼圖,不必再換變體);
//   ③**同款異變體不發交界外溢**(見 planSeamOverlays):變體共用底色(baseFill),交界只換
//     花紋、沒有顏色要 cross-fade;而底毯逐格換變體之後,為它發外溢等於在整張圖上再鋪
//     兩層半透明底毯(每格約 2 張),那是純粹的 overdraw。
export function planCarpetVariants(subs, gnx, gnz, { seed = 0, variants = 3 } = {}) {
  const out = new Array(gnx * gnz).fill(0);
  const at = (i, j) => (i < 0 || j < 0 || i >= gnx || j >= gnz) ? null : subs[j * gnx + i];
  const V = Math.max(1, variants);
  for (let j = 0; j < gnz; j++) {
    for (let i = 0; i < gnx; i++) {
      const s = subs[j * gnx + i];
      if (s == null || s === '!') continue;
      const hard = [], soft = [];                       // 已定案的鄰格:共邊(硬)/ 對角(軟)
      const look = (di, dj, arr) => {
        if (at(i + di, j + dj) === s) arr.push(out[(j + dj) * gnx + i + di]);
      };
      look(-1, 0, hard); look(0, -1, hard);
      look(-1, -1, soft); look(1, -1, soft);
      const v0 = ((vnoise(i, j, (seed ^ 0x3C7B) | 0) * V) | 0) % V;   // 起手偏好逐格雜湊 ⇒ 不排成條紋
      let best = -1, ok = -1;
      for (let k = 0; k < V; k++) {
        const v = (v0 + k) % V;
        if (hard.includes(v)) continue;
        if (ok < 0) ok = v;                             // 過得了硬條件的第一個(保底)
        if (!soft.includes(v)) { best = v; break; }     // 連對角都不同 = 最佳
      }
      out[j * gnx + i] = best >= 0 ? best : (ok >= 0 ? ok : v0);
    }
  }
  return out;
}

// ==== 異類交界外溢配置(2026-07-29 邊界鋸齒改制;唯一縫,稽核執行原文)====
// 舊制 = 整格單向外溢:kA<kB 的一側把整張 cell 貼進「四鄰」鄰格(共享邊 α=1 → 對邊 0)。
// 兩個結構性病灶就是使用者回報的「不同類型地貌邊界的不自然鋸齒」:
//   ①交界輪廓被量化在 13m 級 cell 邊上,斜向邊界變成 90° 階梯狀鋸齒(角點抖動只能
//     讓每段扭一下,消不掉階梯本身);②對角鄰格之間沒有任何淡出,階梯每個轉角都留
//     一個硬缺口,鋸齒感被進一步強化(同格互疊的兩張外溢還會共面深度互吃)。
// 新制 = 角點隸屬度雙線性淡出(dual-grid / marching-squares 語彙):
//   角點對某 key 的權重 = 圍著該角點的四格中屬於該 key 的比例,分母只算「有毯格」
//   (崖 '!' / 未鋪 null 不計 ⇒ 底毯淡出到崖面/圖界時交界角點權重收斂到 1,與不透明
//   底毯無縫銜接);每格對每個「異類鄰 key」(含對角鄰)各發一張 α=角點權重的外溢格。
//   兩側對稱互溢 ⇒ 交界中線恰為 50/50 混色;雙線性 0.5 等值線把 90° 階梯削成平滑
//   斜線,對角權重把階梯轉角的缺口補齊;孤立單格(影像分類雜訊斑點)角點權重達
//   0.75,自動被鄰區軟化吞掉。
// 純函式(零 rnd / 零 Math.random,§2.3;不碰 THREE):輸入 keys 格網,輸出
// [{ i, j, key, alphas, st }];alphas 對應 emitCell 四角 [P0(i,j), P1(i+1,j), P2(i+1,j+1), P3(i,j+1)]。
//
// —— 逐組合交界樣式(2026-07-29 追加,使用者定案「真實世界的邊界通常不是用融合的,
//    不同類型地貌有各自多元的邊界,有的明確、有的有各種中間過渡樣態」)——
// 樣式以 coarse 分區「無序對」查表(SEAM_STYLES;查無 → SEAM_SOFT 柔和淡出),四種樣態:
//   sharp  明確邊界(人工):過渡壓窄 ×sharp、擾動壓低 —— 市區對任何地貌是路緣/牆基的
//          直線切換,不是漸層(市區↔市區換鋪面切線最直);遮蔽物層的矮牆/圍籬同組把關。
//   soft   柔和淡出(預設):同分區異款(草皮↔花田)與其餘組合,維持雙線性 + 碎形擾動。
//   dither 斑塊過渡:雪線/高地界不是漸層也不是直線,是「殘雪/岩屑斑塊」—— 過渡帶把 α
//          往準晶體場的 0/1 斑塊推(端點錨定,見 seamAlpha)。
//   mid    中間過渡樣態:交界脊帶(4·w自·w鄰,恰在 50/50 混色線達峰)疊第三種地表 ——
//          綠地↔裸露地夾乾草原帶(steppe)、綠地/水↔濕地夾蘆葦帶(marsh)、裸露地↔濕地
//          夾泥灘帶(mud);以低頻值雜訊「間歇」出現(midP 蓋率,峰寬 ~65m)—— 真實
//          過渡帶本來就時有時無,整條都鑲滿反而假。
// 三個水密不變式(稽核 Ⅴ):①脊帶用「兩 key 權重乘積」不是單邊 w(1−w) —— 三分區交點
// 兩側才會算出同值;②間歇閘 gateAt 吃「角點座標」不是格索引 —— 逐格閘門會在格邊切出
// 新的硬縫;③樣式端點恆定(α=0→0、1→1,見 seamAlpha)—— 交界帶盡頭與不透明底毯無縫。
export const SEAM_STYLES = {
  // — 明確(人工)邊界 —
  'green|urban':  { sharp: 3.2, noise: 0.12 },
  'bare|urban':   { sharp: 3.2, noise: 0.12 },
  'urban|wet':    { sharp: 3.2, noise: 0.12 },
  'alpine|urban': { sharp: 3.2, noise: 0.12 },
  'urban|urban':  { sharp: 3.6, noise: 0.06 },
  'urban|water':  { sharp: 3.2, noise: 0.10 },   // 碼頭/堤岸:硬岸線
  // — 生態過渡帶(ecotone):寬淡出 + 高擾動 + 間歇中間樣態 —
  'bare|green':   { noise: 0.5,  mid: 'steppe', midP: 0.55 },
  'green|wet':    { noise: 0.45, mid: 'marsh',  midP: 0.7 },
  'bare|wet':     { noise: 0.45, mid: 'mud',    midP: 0.6 },
  'green|water':  { noise: 0.45, mid: 'marsh',  midP: 0.45 },   // 自然岸零星蘆葦緣(泡沫另住 buildWaterEdges)
  'water|wet':    { noise: 0.45, mid: 'marsh',  midP: 0.6 },
  // — 雪線/高地界:斑塊狀 —
  'alpine|bare':  { dither: 1 },
  'alpine|green': { dither: 1 },
};
export const SEAM_SOFT = { noise: 0.4 };   // 預設:柔和淡出(同分區異款與其餘組合)

// 交界頂點 α 塑形(純函式;emitCell 對外溢層逐頂點呼叫,稽核直測):
// q = 準晶體場值 ∈[-1,1]。端點恆定:a=0→0、a=1→1(所有樣式)⇒ 與不透明底毯水密。
export function seamAlpha(a, q, st) {
  if (a <= 0) return 0;
  if (a >= 1) return 1;
  const s = st || SEAM_SOFT;
  if (s.sharp) a = Math.min(1, Math.max(0, (a - 0.5) * s.sharp + 0.5));
  const band = a * (1 - a) * 4;                 // 過渡帶包絡:端點歸零
  if (band <= 0) return a;
  if (s.dither) {                               // 斑塊:帶內把 α 推向場的 0/1 斑塊、兩端錨定
    const f = Math.min(1, Math.max(0, (a + q * 0.5 - 0.5) * 3 + 0.5));
    return a * (1 - band) + f * band;
  }
  return Math.min(1, Math.max(0, a + q * (s.noise ?? 0.4) * band));
}

// hardOf(k0, kn, i, j, ni, nj) → 這一對「畫得出分界線」嗎(呼叫端注入,規則仍只有 borderKindOf
// 一份)。true ⇒ ①外溢改走 borderCutAlpha 的切線(overlay 帶 `cut`,見 emitCell)②中間過渡
// 樣態脊帶**不出**:那是一條橫跨界線的第三種地表,恰好就是使用者說的「沒有正確分隔兩側地貌」。
export function planSeamOverlays(keys, gnx, gnz, opts = {}) {
  const { coarseOf = null, seed = 0, variants = 6, hardOf = null } = opts;
  const keyAt = (i, j) => (i < 0 || j < 0 || i >= gnx || j >= gnz) ? null : keys[j * gnx + i];
  const solid = (k) => k != null && k !== '!';          // 有毯格才算隸屬度分母/外溢來源
  // 同款異變體不發外溢(2026-08-12):變體之間共用底色(baseFill)⇒ 交界只換花紋、沒有
  // 顏色要 cross-fade;而底毯自從逐格挑變體(planCarpetVariants)之後,為它發外溢就是在
  // 整張圖上再鋪兩層半透明底毯(每格約 2 張)。隸屬度分母不受影響(solid 照算)。
  const subOf = (k) => { const p = k.indexOf('#'); return p < 0 ? k : k.slice(0, p); };
  const zoneOf = (k) => (coarseOf && k != null && k !== '!') ? coarseOf(k) : null;
  const styleOf = (za, zb) => {                         // 分區無序對 → 樣式(查無/分區未知 → 柔和)
    if (!za || !zb) return SEAM_SOFT;
    return SEAM_STYLES[za < zb ? `${za}|${zb}` : `${zb}|${za}`] || SEAM_SOFT;
  };
  const hash01 = (i, j, s) => {
    let n = (Math.imul(i | 0, 374761393) ^ Math.imul(j | 0, 668265263) ^ Math.imul(s | 0, 2246822519) ^ seed) | 0;
    n = Math.imul(n ^ (n >>> 13), 1274126177);
    return ((n ^ (n >>> 16)) >>> 0) / 4294967296;
  };
  const vn01 = (x, z, s) => {                           // 平滑值雜訊(雙線性;間歇閘用,純函數)
    const xi = Math.floor(x), zi = Math.floor(z);
    let fx = x - xi, fz = z - zi;
    fx = fx * fx * (3 - 2 * fx); fz = fz * fz * (3 - 2 * fz);
    return (hash01(xi, zi, s) * (1 - fx) + hash01(xi + 1, zi, s) * fx) * (1 - fz)
         + (hash01(xi, zi + 1, s) * (1 - fx) + hash01(xi + 1, zi + 1, s) * fx) * fz;
  };
  // 中間樣態間歇閘:吃「角點座標」(逐角純函數 → 相鄰脊帶格共用角同值,水密);
  // 波長 5 格 ≈ 65m,midP = 期望蓋率,0.18 軟肩讓帶頭帶尾漸收不硬切
  const gateAt = (ci, cj, p) => Math.min(1, Math.max(0, (p - vn01(ci / 5, cj / 5, 0x51AB)) / 0.18));
  const cornerW = (k, ci, cj) => {                      // 角點 (ci,cj) 由 (ci-1..ci, cj-1..cj) 四格圍繞
    let n = 0, valid = 0;
    for (const [oi, oj] of [[-1, -1], [0, -1], [-1, 0], [0, 0]]) {
      const kk = keyAt(ci + oi, cj + oj);
      if (solid(kk)) { valid++; if (kk === k) n++; }
    }
    return valid ? n / valid : 0;
  };
  const midVar = (sub) => {                             // 脊帶變體:每圖每樣態固定一款 —— 帶與帶之間
    let h = seed | 0;                                   // 沒有 crossfade,逐格/逐區換款會在帶峰上切出換款縫
    for (let c = 0; c < sub.length; c++) h = (Math.imul(h, 31) + sub.charCodeAt(c)) | 0;
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    return ((h ^ (h >>> 16)) >>> 0) % variants;
  };
  const out = [];
  for (let j = 0; j < gnz; j++) {
    for (let i = 0; i < gnx; i++) {
      const k0 = keyAt(i, j);
      if (k0 == null) continue;                        // 未鋪格(水色灰帶/岸線)維持留空,不收外溢
      const z0 = zoneOf(k0);
      const seen = new Set(), seenMid = new Set();     // '!' 崖格可收外溢(淡出融入崖面)但不外溢
      const cs = [[i, j], [i + 1, j], [i + 1, j + 1], [i, j + 1]];
      for (let oj = -1; oj <= 1; oj++) {
        for (let oi = -1; oi <= 1; oi++) {
          if (!oi && !oj) continue;
          const kn = keyAt(i + oi, j + oj);
          if (!solid(kn) || kn === k0 || seen.has(kn)) continue;
          seen.add(kn);
          if (subOf(kn) === subOf(k0)) continue;       // 只換花紋不換底色 ⇒ 沒有要 cross-fade 的東西
          const st = styleOf(z0, zoneOf(kn));
          const hard = hardOf ? !!hardOf(k0, kn, i, j, i + oi, j + oj) : false;
          const alphas = [cornerW(kn, i, j), cornerW(kn, i + 1, j),
                          cornerW(kn, i + 1, j + 1), cornerW(kn, i, j + 1)];
          // cut = 鄰格方向(格索引差,只取方向)⇒ 消費端據此判「分界線的哪一側是鄰格的地盤」。
          // 取方向而不是取鄰格中心點:拉直後的弦可能從格子中間穿過,拿點去比會讓整格翻面。
          if (alphas[0] || alphas[1] || alphas[2] || alphas[3]) {
            out.push({ i, j, key: kn, alphas, st, cut: hard ? { di: oi, dj: oj } : null });
          }
          // 中間過渡樣態:兩 key 權重乘積的脊帶(50/50 混色線達峰 → 蓋住殘縫),間歇出現
          if (st.mid && z0 && !hard && !seenMid.has(st.mid)) {
            const bandAl = [0, 0, 0, 0];
            let mx = 0;
            for (let c = 0; c < 4; c++) {
              const wS = cornerW(k0, cs[c][0], cs[c][1]);
              const wF = alphas[c];
              bandAl[c] = 4 * wS * wF * gateAt(cs[c][0], cs[c][1], st.midP ?? 0.5);
              if (bandAl[c] > mx) mx = bandAl[c];
            }
            if (mx > 0.03) {
              seenMid.add(st.mid);
              out.push({ i, j, key: `${st.mid}#${midVar(st.mid)}`, alphas: bandAl, st: { band: 1 } });
            }
          }
        }
      }
    }
  }
  return out;
}

// ==== 多層次地貌:大區域中的小區域組合風格(2026-07-29 使用者需求)====
// 「大區域中的小區域的樣貌風格不同」:同一種 coarse 分區,包在誰裡面就長成誰的樣子 ——
//   市區內的小綠地 = 公園/私人庭園、小水域 = 公園埤塘/滯洪池、小裸露地 = 待建工地;
//   綠地內的小市區 = 農村市集/村落、小水域 = 天然湖泊/堰塞湖;裸露地內的小綠地 = 綠洲、
//   小市區 = 小鎮 …… 逐「內@外」組合查表(ENCLAVE_STYLES),查無 = 維持原分區清單。
// planEnclaves = 包裹判定唯一縫(純函式:零 rnd / 零 Math.random / 零 THREE,§2.3;
// 稽核 tools/audit_ground_enclave.mjs 執行原文):對 coarse 分區格網做 4-鄰連通元件,
// 面積 ∈ [MIN_CELLS, MAX_CELLS] 且實心鄰格邊界的單一外側分區佔比 ≥ OUTER_MIN 的元件
// = 被包裹的小區域(enclave),整個元件標上 `${內}@${外}` 樣式鍵。三條刻意設計:
//   ①崖 '!' / 未鋪 null 不算邊界分母 —— 被崖圈住 ≠ 被誰包住(全崖邊界 = 不標);
//   ②超過 MAX_CELLS 的元件照樣走訪完(標 seen)只是不標 —— 大區域維持本色、不重複掃描;
//   ③外側分區不夠單一(< OUTER_MIN)不標 —— 交界犬牙的凸出部不是「被包住」;
//   ④觸圖界不標 —— 貼著地圖邊的區域延伸到圖外、範圍不明,不算被包住(§4 寧缺勿錯;
//     同時堵住「甜甜圈區域被自己包著的洞反標」:環外緣若在圖界上就直接淘汰)。
// 消費端全在 buildGroundCover(樣式表 = 唯一真相,MUST NOT 在消費端硬編第二份組合表):
//   底毯 cellKeyAt 換 carpet 清單、特徵層主散佈與沿街陣列換 feats 池、tryPatch 分區
//   把關對 enclave 格內的樣式地表放行(僅限格內,不外漏)、watertile 細節依 det 換
//   水生點綴(埤塘荷葉/天然湖蘆葦岸/荒漠湧泉)。純表現層:不動碰撞/raycast/伺服器。
export const ENCLAVE = { MAX_CELLS: 160, MIN_CELLS: 2, OUTER_MIN: 0.6 };
// carpet = 底毯清單(重複項 = 權重;subs MUST ∈ CARPET/ZONES 聯集,coarse 歸屬才查得到)
// feats  = 特徵拼圖池(subs MUST ∈ DEFS 且有 SIZE);det = 水域點綴樣態(watertile 分支)
export const ENCLAVE_STYLES = {
  // — 市區內的小片異類 —
  'green@urban': { name: '公園/私人庭園',
    carpet: ['park', 'lawn', 'park', 'flowerfield', 'turf', 'lawn'],
    feats:  ['park', 'flowerfield', 'park', 'veggiefield'] },
  'bare@urban':  { name: '待建工地',
    carpet: ['gravel', 'mud', 'gravel', 'crackedearth'],
    feats:  ['construction', 'scrapyard', 'construction', 'containeryard'] },
  'wet@urban':   { name: '公園荷塘/滯洪池畔',
    carpet: ['lotus', 'marsh', 'lotus'],
    feats:  ['lotus', 'park'] },
  'water@urban': { name: '公園埤塘/滯洪池', det: 'pond' },
  // — 綠地內 —
  'urban@green': { name: '農村市集/村落',
    // brick 由 2/4 稀釋到 1/9(小鎮/農村的 enclave 正是市區底毯最集中的地方 —— 實測 kyoto
    // 這一格沒稀釋時,紅磚仍佔全圖底毯 21%,而 CARPET.urban 那邊早就降到 7%)
    carpet: ['pavement', 'lawn', 'pavement', 'pavement', 'lawn', 'pavement', 'pavement', 'lawn', 'brick'],
    feats:  ['plaza', 'veggiefield', 'greenhouse', 'gasstation'] },
  'bare@green':  { name: '廢耕地/伐採跡地',
    carpet: ['crackedearth', 'gravel', 'wild'],
    feats:  ['abandonedfarm', 'clearcut', 'quarry', 'abandonedfarm'] },
  'water@green': { name: '天然湖泊/堰塞湖', det: 'lake' },
  'wet@green':   { name: '天然湖沼',
    carpet: ['marsh', 'lotus', 'marsh'],
    feats:  ['marsh', 'lotus'] },
  // — 裸露地內 —
  'green@bare':  { name: '綠洲',
    carpet: ['turf', 'bushfield', 'flowerfield', 'turf'],
    feats:  ['orchard', 'bushfield', 'flowerfield'] },
  'urban@bare':  { name: '小鎮/驛站聚落',
    carpet: ['pavement', 'pavement', 'pavement', 'pavement', 'pavement', 'pavement',
             'pavement', 'concrete', 'brick'],
    feats:  ['gasstation', 'parking', 'plaza', 'scrapyard'] },
  'water@bare':  { name: '荒漠湧泉/鹹水湖', det: 'spring' },
  'wet@bare':    { name: '鹽沼窪地',
    carpet: ['marsh', 'marsh'],
    feats:  ['saltpan', 'marsh'] },
  // — 濕地內 —
  'green@wet':   { name: '沙洲草澤島',
    carpet: ['meadow', 'turf', 'bushfield'],
    feats:  ['bushfield', 'flowerfield'] },
  'urban@wet':   { name: '漁村埠頭',
    carpet: ['pavement', 'pavement', 'pavement', 'pavement', 'lawn', 'pavement', 'pavement', 'brick'],
    feats:  ['fishpond', 'plaza'] },
  // — 高地相關(alpine 由相對高程觸發,孤峰/山中草甸天然形成 enclave)—
  'green@alpine': { name: '高山草甸',
    carpet: ['steppe', 'meadow', 'steppe', 'turf'],
    feats:  ['steppe', 'flowerfield'] },
  'alpine@green': { name: '孤峰岩場',
    carpet: ['scree', 'plateau', 'scree'],
    feats:  ['slabruin', 'quarry'] },
};
export function planEnclaves(zones, gnx, gnz, opts = {}) {
  const { styles = ENCLAVE_STYLES, maxCells = ENCLAVE.MAX_CELLS,
          minCells = ENCLAVE.MIN_CELLS, outerMin = ENCLAVE.OUTER_MIN } = opts;
  const solid = (z) => z != null && z !== '!';
  const out = new Array(gnx * gnz).fill(null);
  const seen = new Uint8Array(gnx * gnz);
  for (let j0 = 0; j0 < gnz; j0++) {
    for (let i0 = 0; i0 < gnx; i0++) {
      const idx0 = j0 * gnx + i0;
      if (seen[idx0]) continue;
      seen[idx0] = 1;
      const zn = zones[idx0];
      if (!solid(zn)) continue;
      // 4-鄰連通元件(BFS);邊界計數 = 元件周長上每段「實心異類鄰格」各記一票(周長加權)
      const comp = [idx0];
      const border = Object.create(null);
      let nb = 0, edge = false;
      for (let q = 0; q < comp.length; q++) {
        const idx = comp[q], ci = idx % gnx, cj = (idx / gnx) | 0;
        if (ci === 0 || cj === 0 || ci === gnx - 1 || cj === gnz - 1) edge = true;
        for (const [oi, oj] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          const ni = ci + oi, nj = cj + oj;
          if (ni < 0 || nj < 0 || ni >= gnx || nj >= gnz) continue;
          const nidx = nj * gnx + ni, znb = zones[nidx];
          if (znb === zn) {
            if (!seen[nidx]) { seen[nidx] = 1; comp.push(nidx); }
          } else if (solid(znb)) { border[znb] = (border[znb] || 0) + 1; nb++; }
        }
      }
      if (edge || comp.length < minCells || comp.length > maxCells || !nb) continue;
      let outer = null, bestN = 0;
      for (const z in border) if (border[z] > bestN) { bestN = border[z]; outer = z; }
      if (bestN < nb * outerMin) continue;   // 外側不夠單一 = 交界犬牙,不是被包住
      const key = `${zn}@${outer}`;
      if (!styles[key]) continue;            // 查無組合 = 維持原分區樣貌
      for (const idx of comp) out[idx] = key;
    }
  }
  return out;
}

// ==== 地貌界線拼圖(2026-08-11 使用者需求)====
// 「不同類型大面積地貌區塊之間的邊界,透過設計 16 個方向的直線/轉彎/岔路的拼圖組合拼接,
//   作為地貌類型的分界(拼圖概念類似卡卡頌);地貌界線拼圖採用步道小徑/林道/碎石土徑/
//   田埂/水溝/小溪/圍籬/灌木矮牆/沙灘/岩塊/紅樹林等自然或人工分界線作為專屬拼貼圖案,
//   不同類型的分界線可接力連結。」
// 分層(單一縫 = 本區塊;稽核 tools/audit_ground_border.mjs 執行原文,對照組內建):
//   型錄 BORDER_KINDS —— 11 種分界線(flat 貼地紋理帶 / ridge 立體梯形脊,或兩者兼有);
//   樣式 BORDER_STYLES(coarse 分區無序對 → 種類;查無 = 不擺,寧缺勿錯)+
//        BORDER_SUB_RULES(地表級覆寫:竹林/枯木 → 林道、花田 → 田埂、沙 → 沙灘);
//        解析只有 borderKindOf 一份,消費端 MUST NOT 另寫第二份對照表;
//   規劃 planBorderPuzzle —— 純函式(零 rnd / 零 Math.random / 零 THREE,§2.3):
//     ① 底毯 keys 格網上「地表(sub)不同」的相鄰實心格之間收邊界邊(同地表異變體花紋
//        本就連續,不成界;'!' 崖與 null 未鋪不成界),逐邊解析種類(null 的邊不收);
//     ② 邊接共享角點成圖,度數 ≠2 的角點 = 鏈端點/岔路(fork),圖遍歷成鏈(含閉環);
//     ③ 16 方向量化(BORDER_DIRS):鏈內貪婪合併直段 —— 被略過角點到弦的垂距 ≤ driftMax
//        才併入;切點恆取自原始共享角點(端點錨定 ⇒ 鏈間/岔路拼接零開縫;拼接優先於
//        「弦角恰為格心」—— 弦方位與 bin 中心的誤差由 round 保證 ≤ 半格 11.25°);
//     ④ tile 輸出 { x0,z0,x1,z1, bin, kind, turn, drift }:相鄰 tile bin 改變 = 轉彎;
//        種類逐邊解析、同鏈內隨鄰區改變 = 接力(切點雙方共用);度數 ≥3 的角點進 forks
//        (岔路拼圖,多種分界線在此交會接力)。
// 發射(buildGroundCover 內的消費端)只負責畫;純表現層:無碰撞、不描邊、不進 raycast
// (原則 4;空地照常通行)。
export const BORDER_DIRS = 16;   // 拼圖方向數(22.5° 一格;與道路 16 方向量化同語彙)
// flat = 貼地紋理帶(w 寬 m、tex 畫筆鍵 → BORDER_PAINTERS)/ ridge = 梯形脊(w 底寬/wt 頂寬/
// h 高/jit 頂高抖動比/color,'foliage' = 季節葉色);aq = 貼水種類(允許落在水線下,頂點夾
// 到水面上)。
// **每一種 MUST 有 flat**(2026-08-11 使用者定案「分界線可以粗一點、上面的圖畫可以更細緻」):
// 貼地帶才是「界線」本體 —— 它同時扛三件事 ①看得出這是一條有圖案的界線(純立體脊只有一根
// 細桿,遠看就是「意義不明的線條」)②蓋住底毯 13m 格網被拉直時跳過的那段真實界線
// (§ planBorderPuzzle 的 driftMax)③兩側地貌的切線(borderCut)恰在它底下換手。
// 立體脊自此是**加在帶上的擺件**(田埂的土埂、圍籬的木樁、樹籬、岩塊),不再單獨成界。
//
// **`form` = 這個東西在現實裡是連續的還是離散的**(2026-08-13 使用者「柵欄要看起來像木柵欄
// 而不是單調土牆」+「土路/潮間帶/海灘不要凸起…以此類推」)。舊制只有一種脊 = 沿中心線掃出來
// 的**連續梯形柱**,那對田埂與樹籬是對的(它們本來就是連續的土堤/樹牆),對圍籬/岩塊/紅樹林
// 就是把「一排木樁」「幾顆落石」「一叢支柱根」畫成一道齊高的實心牆 —— 顏色再土一點就是使用者
// 說的「單調土牆」。三種:
//   (無)  連續梯形柱(田埂、樹籬)—— 逐位元同舊制;
//   posts 樁 + 橫桿(木柵欄):樁**恆落在兩端**(n = round(len/pitch),i/n)⇒ 相鄰片與轉角
//         共用端樁,接縫處不會擠成兩根;桿在樁與樁之間、`rail.y` 是佔全高的比例;
//   clumps 離散團塊(岩塊、紅樹林支柱根叢):pitch 一顆,尺寸/高度/橫向偏移吃 ehash 抖動。
// 離散件一律**低於**舊制的連續脊 —— 使用者要的是「看得出是什麼」而不是「擋在那裡」。
export const BORDER_KINDS = {
  trail:      { name: '步道小徑', flat: { w: 4.2, tex: 'trail' } },
  forestroad: { name: '林道',     flat: { w: 6.0, tex: 'forestroad' } },
  gravelpath: { name: '碎石土徑', flat: { w: 5.0, tex: 'gravelpath' } },
  fieldridge: { name: '田埂',     flat: { w: 4.2, tex: 'fieldpath' },
                // 0.32 → 0.18:與 BUND.RISE 同一個決定(「田埂之類的也不要凸太多」)
                ridge: { w: 0.85, wt: 0.5, h: 0.18, jit: 0.18, color: 0x87704a } },
  ditch:      { name: '水溝',     flat: { w: 4.2, tex: 'ditch' } },
  stream:     { name: '小溪',     flat: { w: 5.4, tex: 'stream' } },
  // 木柵欄:2.4m 一根樁(真實牧場圍籬的柱距),樁 0.14 見方、兩道橫桿在 40%/76% 高。
  // 色改成曬過的木頭(0x6b5138 深土色正是「土牆」讀感的一半)
  fence:      { name: '圍籬',     flat: { w: 4.2, tex: 'fenceline' },
                ridge: { form: 'posts', w: 0.14, wt: 0.14, h: 1.15, jit: 0.10, color: 0x9c7a4c,
                         pitch: 2.4, pw: 0.14, rail: { y: [0.40, 0.76], h: 0.18, t: 0.07 } } },
  hedgerow:   { name: '灌木矮牆', flat: { w: 4.4, tex: 'hedgebank' },
                ridge: { w: 1.15, wt: 0.72, h: 1.4, jit: 0.55, color: 'foliage' } },
  beach:      { name: '沙灘',     flat: { w: 9.0, tex: 'beach', wet: 1 }, aq: 1 },
  // 泥灘過渡帶(2026-08-13 使用者「水域與沼澤的分界使用專屬的泥地過渡帶」)——
  // 水域↔沼澤自此走這一款,紅樹林退到蓮花池那一格(見 BORDER_SUB_RULES)
  mudflat:    { name: '泥灘',     flat: { w: 8.0, tex: 'mudflat', wet: 1 }, aq: 1 },
  // 岩塊:一道 0.7m 高的灰牆 → 3m 一顆的落石(高度只剩 0.42,細節回到 rubble 畫筆上)
  rocks:      { name: '岩塊',     flat: { w: 5.2, tex: 'rubble' },
                ridge: { form: 'clumps', w: 1.3, wt: 0.7, h: 0.42, jit: 0.6, color: 0x8f8c83,
                         pitch: 3.0, lat: 0.55 }, aq: 1 },
  // 紅樹林(潮間帶):1.15m 的連續綠牆 → 3.4m 一叢的支柱根,泥灘那一半全交給畫筆
  mangrove:   { name: '紅樹林',   flat: { w: 7.0, tex: 'mangrove', wet: 1 },
                ridge: { form: 'clumps', w: 1.6, wt: 1.35, h: 0.5, jit: 0.5, color: 0x3f6b3f,
                         pitch: 3.4, lat: 0.6 }, aq: 1 },
};
// 地貌(coarse 分區)無序對 → 種類。**不同地貌之間一律有分界線**(2026-08-11 使用者定案
// 「兩側若是相同地貌,則不需要分界線」)—— 同一片綠地裡換底毯款式(草皮↔芒草原↔灌木叢)
// 那是同一種地貌的花紋變化,不是界;逐款畫線會把大片綠地切成密集網狀。
// **2026-08-13 追加一條窄門**(使用者「顏色劇烈變化處也使用對應地貌的分界線覆蓋」):同地貌
// 之間色距 ≥ `CARPET_DE.LINE` 的那幾對改走 `BORDER_SAME_ZONE`。這**不是**推翻上面那條定案 ——
// 08-11 擋掉的是「逐款畫線」(綠地那一份清單裡任兩款都畫 = 網狀),這一條只圈住排序之後仍
// 避不掉的大跳(現役 7 對,見 CARPET_DE 檔頭的實測清單)。
// 15 個跨地貌對 MUST 全數有解(沒有哪一種交界是「畫不出來」的);水域交界一律貼水種類
// (沙灘/岩塊/紅樹林),泡沫與潮間帶仍住 buildWaterEdges。
export const BORDER_STYLES = {
  'bare|green': 'gravelpath', 'green|urban': 'hedgerow',  'green|wet': 'stream',
  'green|water': 'beach',     'alpine|green': 'trail',
  'bare|urban': 'fence',      'bare|wet': 'ditch',        'bare|water': 'rocks',
  'alpine|bare': 'rocks',     'urban|wet': 'ditch',       'urban|water': 'rocks',
  // 水域↔沼澤 = 專屬的泥灘過渡帶(2026-08-13 使用者定案;舊制是紅樹林)
  'alpine|urban': 'fence',    'water|wet': 'mudflat',     'alpine|wet': 'rocks',
  'alpine|water': 'rocks',
};
// 地表級覆寫(某些底毯款式自帶專屬分界):sub 命中且「對側」地貌 ∈ vs 才作用
// (市區界不覆寫 = 人工界優先)。`vs` **MUST NOT 含該 sub 自己的地貌** —— 同地貌不畫線,
// 列進去只是永遠不會命中的死設定。表序即優先序,兩側同時命中取先命中列。
export const BORDER_SUB_RULES = [
  // 紅樹林在 2026-08-13 把 water|wet 讓給泥灘之後的家:蓮花池(熱帶水生)臨開闊水面那一格。
  // 沼澤本體(marsh)↔ 水域走泥灘 —— 那正是使用者要的「專屬的泥地過渡帶」
  { sub: 'lotus',       kind: 'mangrove',   vs: ['water'] },
  { sub: 'sand',        kind: 'beach',      vs: ['water', 'wet'] },
  { sub: 'flowerfield', kind: 'fieldridge', vs: ['bare'] },
  { sub: 'arrowbamboo', kind: 'forestroad', vs: ['bare', 'alpine'] },
  { sub: 'deadwood',    kind: 'forestroad', vs: ['bare', 'alpine'] },
  { sub: 'fallenlogs',  kind: 'forestroad', vs: ['bare', 'alpine'] },
  { sub: 'deadforest',  kind: 'forestroad', vs: ['green', 'alpine'] },
];
// 同地貌內「顏色劇烈變化」時用的分界線(2026-08-13 使用者「顏色劇烈變化處也使用**對應地貌**
// 的分界線覆蓋」)—— 一地貌一種,取那片地貌裡最不突兀的一款自然界:綠地 = 踏出來的步道、
// 裸露地 = 碎石土徑、市區 = 行道樹籬(市區的大跳恆是鋪面↔綠地那一對)、濕地 = 水溝、
// 高地 = 岩塊(雪線)。**水域沒有** —— 深淺水本來就是同一片水,查無 = 不擺(§4 寧缺勿錯)。
export const BORDER_SAME_ZONE = {
  green: 'trail', bare: 'gravelpath', urban: 'hedgerow', wet: 'ditch', alpine: 'rocks',
};
// 分界線種類解析唯一縫(對稱:交換兩側回傳相同;查無 → null = 不擺)。
// 同地貌**只走色距那一道窄門**(BORDER_SAME_ZONE),地表級覆寫(BORDER_SUB_RULES)仍
// 一律擋在跨地貌那一側 ⇒ 該表的 `vs` MUST NOT 含該 sub 自己的地貌(那仍是死設定)。
export function borderKindOf(subA, subB, za, zb) {
  if (!za || !zb) return null;
  if (za === zb) {
    if (subA === subB) return null;
    const ca = SUB_COL[subA], cb = SUB_COL[subB];
    if (ca == null || cb == null) return null;   // 沒有代表色 = 不是底毯款 ⇒ 不畫
    return colDist(ca, cb) >= CARPET_DE.LINE ? (BORDER_SAME_ZONE[za] || null) : null;
  }
  for (const r of BORDER_SUB_RULES) {
    if (subA === r.sub && r.vs.includes(zb)) return r.kind;
    if (subB === r.sub && r.vs.includes(za)) return r.kind;
  }
  return BORDER_STYLES[za < zb ? `${za}|${zb}` : `${zb}|${za}`] || null;
}
// 離散脊件(木樁/橫桿/岩塊/根叢)的盒子面表。局部框 (t, up, n) 恆右手(t × up = n),
// 每一列 = [局部外法線, 四角 (i,j,k) 自外側看的逆時針序];i 沿 t、j 沿 up(−1 底 / +1 頂)、
// k 沿 n。四點序是由右手三元組推出來的,**MUST NOT 憑感覺重排** —— 排錯的那一面法線朝內,
// three 把它畫成死黑,而每一條離線斷言照樣全綠(同 sweepUpY 檔頭那一族)。
// 六面各自四頂點(不共用)⇒ 折邊真的出得了線,盒子讀起來才是有稜角的木頭/石頭。
const BOX_FACES = [
  [[1, 0, 0], [[1, -1, -1], [1, 1, -1], [1, 1, 1], [1, -1, 1]]],
  [[-1, 0, 0], [[-1, -1, -1], [-1, -1, 1], [-1, 1, 1], [-1, 1, -1]]],
  [[0, 1, 0], [[-1, 1, -1], [-1, 1, 1], [1, 1, 1], [1, 1, -1]]],
  [[0, -1, 0], [[-1, -1, -1], [1, -1, -1], [1, -1, 1], [-1, -1, 1]]],
  [[0, 0, 1], [[-1, -1, 1], [1, -1, 1], [1, 1, 1], [-1, 1, 1]]],
  [[0, 0, -1], [[-1, -1, -1], [-1, 1, -1], [1, 1, -1], [1, -1, -1]]],
];
// 轉彎接頭的解(純函式;規劃器與稽核同吃)——「完整畫出來的轉彎拼圖」的幾何定義。
// 兩臂單位方向 a、b 皆**背離節點**;Lmax = 允許的最大退縮長;hw = 帶半寬。
// 圓角(arc):與兩臂相切的圓弧,半徑 R = L·tan(ψ/2)(ψ = 兩臂夾角)⇒ 切點恰在退縮後的
//   直段端點上、切線方向恰等於臂向 ⇒ 圖案彎過轉角而不是在轉角對接。
// 圓帽(cap):彎太急(R 容不下帶寬,內緣會翻面)時退圓帽接頭 —— 半徑 hw 的圓盤,
//   等同標準的 round line join;仍是完整畫出來的一片,不是把兩段直帶疊在一起。
// 回傳含 `L`(實際要退縮多少)—— 呼叫端 MUST 用它設退縮量,直段端點才會與接頭切點重合。
export function borderCornerArc(px, pz, ax, az, bx, bz, Lmax, hw) {
  const psi = Math.acos(Math.max(-1, Math.min(1, ax * bx + az * bz)));   // 兩臂夾角
  const phi = Math.PI - psi;                                            // 路徑偏轉角
  const at = (L) => ({ Pa: [px + ax * L, pz + az * L], Pb: [px + bx * L, pz + bz * L] });
  if (phi < 1e-4) return { mode: 'straight', L: 0, phi, len: 0, ...at(0) };
  const tan = Math.tan(psi / 2);
  const Lneed = hw * 1.1 / Math.max(tan, 1e-6);      // R ≥ 1.1·hw 才容得下帶寬(內緣不翻面)
  if (!(Lneed <= Lmax)) {
    const L = Math.min(Lmax, hw);
    return { mode: 'cap', L, phi, cx: px, cz: pz, r: hw, len: hw * phi, ...at(L) };
  }
  const L = Lmax, R = L * tan;
  const sx = ax + bx, sz = az + bz, sl = Math.hypot(sx, sz) || 1;
  const d = L / Math.cos(psi / 2);                   // 圓心沿角平分線的距離
  const cx = px + sx / sl * d, cz = pz + sz / sl * d;
  const g = at(L);
  const a0 = Math.atan2(g.Pa[1] - cz, g.Pa[0] - cx);
  let sweep = Math.atan2(g.Pb[1] - cz, g.Pb[0] - cx) - a0;
  while (sweep > Math.PI) sweep -= Math.PI * 2;
  while (sweep < -Math.PI) sweep += Math.PI * 2;
  return { mode: 'arc', L, phi, cx, cz, R, a0, sweep, len: Math.abs(sweep) * R, ...g };
}

// ---- 兩側地貌以分界線為界(2026-08-11 使用者需求)----
// 「很多地方分界線沒有正確分隔兩側地貌,有一側地貌滲透過去另一側」的成因是**兩條不同的線**:
// 底毯交界的原始解析度是 13m 抖動格網,舊制外溢(planSeamOverlays 的角點隸屬度)把兩側各往
// 對面推一整格 ⇒ 混色帶寬 ~26m;而分界線是格邊鏈**拉直後的弦**(driftMax 內偏離)。兩者
// 從來沒有對齊過,畫面上就是「線在這裡、地貌卻換在那裡」。
// 新制:凡**畫得出分界線**的組合(borderKindOf ≠ null),外溢 α 改由頂點到**畫出來的那條線**
// 的帶號距離決定 ⇒ 換手處恰在線上、且恆落在帶寬之內被圖案蓋住;查不到線才退回舊制淡出。
// 同地貌換款(草皮↔芒草原)本來就沒有線,維持柔和淡出不受影響。
// 純函式:d = 帶號距離(正 = 落在鄰格那一側),端點恆定 0/1 ⇒ 與不透明底毯水密。
// 換手帶寬 m / 有機擾動振幅 m / 找線半徑(×cell)。
// **不變式**:W/2 + JIT/2 ≤ 最窄那一種的帶半寬 —— 換手若寬過圖案,滲透就露在帶外面了。
export const BORDER_CUT = { W: 2.8, JIT: 1.2, R_F: 1.7 };
// 帶本身的量測與外觀旋鈕(單一縫;讓路取樣、迴避半徑、貼圖節距一律由這裡推導,MUST NOT 手寫)
//   EDGE_A/EDGE_W = 帶緣有機起伏的振幅比與波數(1/m)——「分界線本身是直的,線的兩側邊緣
//     可以不用筆直」(2026-08-11 使用者):中心線仍是 16 方向的弦,只有兩緣沿世界座標起伏
//     (純函式 vnoise ⇒ 相鄰 tile 與接頭在共用端點上取到同值,邊緣連續不開叉)。
//   PAD  = 特徵拼圖 / 3D 細節與帶緣之間的淨距(田/停車場/球場不得橫跨,也不得貼著壓上來)。
//   TEX_F/TEX_MIN = 貼圖一輪的世界長 = max(TEX_MIN, w × TEX_F):寬帶配長節距,圖案才不會
//     被橫向拉扁成「意義不明的線條」。
//   RUN_MIN_CELL = 一段接力至少要走過幾個底毯格 —— 種類是逐邊解析的,而底毯款式本身就是
//     13m 格網上挑的:短於這個長度的「換款」是格網雜訊而不是地貌變化,MUST 併回鄰居。
//     **3 是實測的上界**:拉到 5 會把只在小片花田邊上出現的田埂整種併掉(11 種裡有一種
//     永遠不出現,而 shot_borders 只會安靜地說「實見地貌級的解」);2 以下逐格抖動就回來了。
export const BORDER_BAND = { EDGE_A: 0.26, EDGE_W: 0.2, PAD: 1.6, TEX_F: 1.5, TEX_MIN: 7, RUN_MIN_CELL: 3 };
export function borderCutAlpha(d, w) {
  return d <= -w / 2 ? 0 : d >= w / 2 ? 1 : 0.5 + d / w;
}
// 掃掠繞向唯一縫(純函式):斷面掃掠出來的三角形**幾何法線的 y 分量**正負。
// t = 中心線切向、n = 斷面橫向(f 遞增方向);flat 以「先切向後橫向」的繞向送出 ⇒ 本函式
// 回傳 > 0 才是正面朝上(ridge 的斷面順序是鏡像的,判準取反,見 sweepRidge)。
// **這件事會完全無聲地壞掉**:繞向反了在 DoubleSide 底下不會破圖,three 只是把法線反轉 ⇒
// 整段帶變成「從地底下打光」的死黑,而頂點數/位置/α/UV/貼圖每一條離線斷言照樣全綠。
// 2026-08-11 實測:linePath 恆為負(每一片直段都死黑)、arcPath 隨 sweep 正負翻面(轉彎
// 忽明忽暗)= 使用者回報的「好幾個分界線顏色不連續」。
export function sweepUpY(tx, tz, nx, nz) { return tz * nx - tx * nz; }

// 分界線帶的「強制乾地」查詢工廠(2026-08-13 使用者「確保水域/沼澤在分界線的區塊內不會
// 觸發異常狀態」;規則本體與接線紀律見 buildGroundCover 內的呼叫點註解)。
// **住模組層是刻意的**:回傳的函式要掛在 terrain 上活到戰鬥結束,寫成 buildGroundCover 的
// 內層閉包會把那一整個作用域的 context(底毯 buckets / 細節清單 / landCells…)一起留住。
// grid = 中心線段的空間索引(`${ci},${cj}` → 段陣列,段自帶自己的帶半寬 hw)、
// sc = 索引格邊長、hwMax = 型錄裡最寬的一種半寬(掃描格數由它推導,不手寫)。
export function makeBandMask(grid, sc, hwMax) {
  const n = Math.max(1, Math.ceil(hwMax / sc));
  return (x, z) => {
    const ci = Math.floor(x / sc), cj = Math.floor(z / sc);
    for (let dj = -n; dj <= n; dj++) {
      for (let di = -n; di <= n; di++) {
        const l = grid.get(`${ci + di},${cj + dj}`);
        if (!l) continue;
        for (const sg of l) {
          const dx = sg.x1 - sg.x0, dz = sg.z1 - sg.z0, l2 = dx * dx + dz * dz || 1;
          let t = ((x - sg.x0) * dx + (z - sg.z0) * dz) / l2;
          t = t < 0 ? 0 : t > 1 ? 1 : t;
          if (Math.hypot(sg.x0 + dx * t - x, sg.z0 + dz * t - z) <= sg.hw) return true;
        }
      }
    }
    return false;
  };
}

export function planBorderPuzzle(keys, gnx, gnz, opts = {}) {
  // zoneOf(i,j) = 該格**真正的地貌**(呼叫端已算好的 zoneGrid)。MUST 優先於用款式反查
  // (coarseOf):`steppe`/`scree` 同時在裸露地與高地的底毯清單裡,反查恆取先出現的那個
  // ⇒ 高地格會被判成裸露地,於是高地內部憑空長出一片「跨地貌」的界線網。
  const { zoneOf = null, coarseOf = null, cornerXZ = (ci, cj) => [ci, cj], driftMax = 1,
          kindOf = borderKindOf, halfWidthOf = () => 1, jointF = 2.2, forkF = 1, runMinM = 0 } = opts;
  const solid = (k) => k != null && k !== '!';
  const subOf = (k) => { const p = k.indexOf('#'); return p < 0 ? k : k.slice(0, p); };
  const keyAt = (i, j) => (i < 0 || j < 0 || i >= gnx || j >= gnz) ? null : keys[j * gnx + i];
  // ① 邊界邊:兩實心格、地表不同、種類解得出來;邊 = 兩共享角點(角點格網 (gnx+1)×(gnz+1))
  const NKW = gnx + 2;                                  // 節點鍵步幅(角點 ci ∈ 0..gnx)
  const zoneAt = (i, j) => {
    if (zoneOf) return zoneOf(i, j) ?? null;
    const k = keyAt(i, j);
    return (coarseOf && solid(k)) ? coarseOf(k) : null;
  };
  const edges = [];                                     // { a, b: 節點鍵, kind, used }
  const adj = new Map();                                // 節點鍵 → [edges 索引](插入序 = 決定性)
  const addEdge = (ci0, cj0, ci1, cj1, k0, k1, z0, z1) => {
    const s0 = subOf(k0), s1 = subOf(k1);
    if (s0 === s1) return;                              // 同地表異變體:花紋連續,不成界
    const kind = kindOf(s0, s1, z0, z1);                // 同地貌 → borderKindOf 恆回 null
    if (!kind) return;
    const e = { a: cj0 * NKW + ci0, b: cj1 * NKW + ci1, kind, used: false };
    const ei = edges.length;
    edges.push(e);
    for (const n of [e.a, e.b]) {
      let l = adj.get(n);
      if (!l) { l = []; adj.set(n, l); }
      l.push(ei);
    }
  };
  for (let j = 0; j < gnz; j++) {
    for (let i = 0; i < gnx; i++) {
      const k0 = keyAt(i, j);
      if (!solid(k0)) continue;
      const z0 = zoneAt(i, j);
      const kR = keyAt(i + 1, j), kD = keyAt(i, j + 1);
      if (solid(kR)) addEdge(i + 1, j, i + 1, j + 1, k0, kR, z0, zoneAt(i + 1, j));   // 與右鄰共享的豎邊
      if (solid(kD)) addEdge(i, j + 1, i + 1, j + 1, k0, kD, z0, zoneAt(i, j + 1));   // 與下鄰共享的橫邊
    }
  }
  // ② 角點圖遍歷成鏈:先從度數 ≠2 的節點(端點/岔路)起走,剩下的是閉環
  const deg = (n) => (adj.get(n) || []).length;
  const walk = (ei0, n0) => {
    const pts = [n0], kinds = [];
    let e = edges[ei0], n = n0;
    for (;;) {
      e.used = true;
      const m = e.a === n ? e.b : e.a;
      pts.push(m);
      kinds.push(e.kind);
      if (deg(m) !== 2) break;                          // 端點(1)/岔路(≥3):鏈到此為止
      const ni = adj.get(m).find((k) => !edges[k].used);
      if (ni == null) break;                            // 閉環走回起點
      e = edges[ni]; n = m;
    }
    return { pts, kinds };
  };
  const raw = [];
  for (const [n, l] of adj) {
    if (l.length === 2) continue;
    for (const ei of l) if (!edges[ei].used) raw.push(walk(ei, n));
  }
  for (let ei = 0; ei < edges.length; ei++) if (!edges[ei].used) raw.push(walk(ei, edges[ei].a));
  // ③④ 16 方向量化 + 接力切分 → tile
  const STEP = (Math.PI * 2) / BORDER_DIRS;
  const binOf = (dx, dz) => ((Math.round(Math.atan2(dz, dx) / STEP) % BORDER_DIRS) + BORDER_DIRS) % BORDER_DIRS;
  const posOf = (n) => cornerXZ(n % NKW, (n / NKW) | 0);
  const chains = [];
  for (const ch of raw) {
    const P = ch.pts.map(posOf);
    const closed = ch.pts.length > 2 && ch.pts[0] === ch.pts[ch.pts.length - 1];
    // ---- 接力是「換一段」不是「每格換一次」:短 run 併回鄰居 ----
    // 種類逐邊解析,而底毯款式是 13m 格網上挑的 ⇒ 沿著界線走,款式會在區界附近來回抖動,
    // 解出來的種類就跟著碎成「碎石土徑 / 林道 / 碎石土徑」的雜訊(2026-08-11 實拍每 ~20m
    // 換一次色)= 使用者回報的「分界線顏色不連續」的另一半。併法與 edgewall 的 run 併法
    // 同紀律(A44 ⑦):短的讓給**較長**的鄰居、併完同款再併、逐輪取最短者 ⇒ 決定性且收斂。
    // runMinM = 0(預設)逐位元同未併。
    if (runMinM > 0 && ch.kinds.length > 1) {
      const eLen = [];
      for (let e = 0; e < ch.kinds.length; e++) {
        eLen.push(Math.hypot(P[e + 1][0] - P[e][0], P[e + 1][1] - P[e][1]));
      }
      const mkRuns = () => {
        const rs = [];
        for (let e = 0; e < ch.kinds.length; e++) {
          const last = rs[rs.length - 1];
          if (last && last.kind === ch.kinds[e]) { last.e = e + 1; last.len += eLen[e]; }
          else rs.push({ s: e, e: e + 1, kind: ch.kinds[e], len: eLen[e] });
        }
        return rs;
      };
      let runs = mkRuns();
      while (runs.length > 1) {
        let pick = -1;
        for (let r = 0; r < runs.length; r++) {
          if (runs[r].len >= runMinM) continue;
          if (pick < 0 || runs[r].len < runs[pick].len) pick = r;
        }
        if (pick < 0) break;
        const pv = runs[pick - 1], nx = runs[pick + 1];
        const into = !pv ? nx : !nx ? pv : (nx.len > pv.len ? nx : pv);
        for (let e = runs[pick].s; e < runs[pick].e; e++) ch.kinds[e] = into.kind;
        runs = mkRuns();
      }
    }
    // 先依種類切段(接力切點與岔路切點一樣是共享角點),段內再做方向量化
    const segs = [];
    let s0 = 0;
    for (let e = 1; e <= ch.kinds.length; e++) {
      if (e === ch.kinds.length || ch.kinds[e] !== ch.kinds[s0]) { segs.push([s0, e, ch.kinds[s0]]); s0 = e; }
    }
    const tiles = [];
    for (const [e0, e1, kind] of segs) {
      let i0 = e0;
      while (i0 < e1) {
        let i1 = i0 + 1;
        while (i1 < e1) {                               // 貪婪延伸:略過角點的垂距全 ≤ driftMax 才併
          const [ax, az] = P[i0], [bx, bz] = P[i1 + 1];
          const dx = bx - ax, dz = bz - az, L = Math.hypot(dx, dz) || 1;
          let fit = true;
          for (let k = i0 + 1; k <= i1; k++) {
            const d = Math.abs((P[k][0] - ax) * dz - (P[k][1] - az) * dx) / L;
            if (d > driftMax) { fit = false; break; }
          }
          if (!fit) break;
          i1++;
        }
        const [ax, az] = P[i0], [bx, bz] = P[i1];
        const dx = bx - ax, dz = bz - az, L = Math.hypot(dx, dz) || 1;
        let drift = 0;                                  // 誠實重算(貪婪檢查壞掉時稽核仍量得到)
        for (let k = i0 + 1; k < i1; k++) {
          const d = Math.abs((P[k][0] - ax) * dz - (P[k][1] - az) * dx) / L;
          if (d > drift) drift = d;
        }
        tiles.push({ x0: ax, z0: az, x1: bx, z1: bz, bin: binOf(dx, dz), kind, drift,
                     n0: ch.pts[i0], n1: ch.pts[i1] });
        i0 = i1;
      }
    }
    for (let t = 0; t < tiles.length; t++) {
      const tl = tiles[t];
      const prev = tiles[t - 1] || (closed ? tiles[tiles.length - 1] : null);
      const next = tiles[t + 1] || (closed ? tiles[0] : null);
      tl.turn = !!(prev && prev !== tl && prev.bin !== tl.bin);   // 轉彎拼圖:與前一片方向格不同
      tl.j0 = !!prev; tl.j1 = !!next;                             // 端點是否接續(接力/同段續接)
    }
    chains.push({ closed, ns: ch.pts, tiles });
  }
  // ---- ⑤ 接頭:轉彎與岔路一律「完整畫出來的拼圖片」,MUST NOT 把直段對接 ----
  // 作法只有一條:直段自接頭處**退縮**(tr0/tr1),讓出來的空間專屬接頭拼圖 ⇒ 沒有重疊、
  // 沒有共面互吃、也沒有「兩段疊在一起假裝轉彎」。退縮量由接頭自己解(borderCornerArc 回
  // 傳的 L),兩側同值 ⇒ 直段端點與接頭切點逐位元重合(端點錨定的推廣)。
  // 一個節點只被一個接頭處理(tile 的每一端恰屬於一個節點)⇒ tr0/tr1 不會被寫兩次。
  const hwOf = (k) => halfWidthOf(k) || 1;
  const arms = new Map();                        // 節點 → 入射臂(方向恆「背離節點」)
  for (const ch of chains) {
    for (const tl of ch.tiles) {
      const dx = tl.x1 - tl.x0, dz = tl.z1 - tl.z0, l = Math.hypot(dx, dz) || 1;
      for (const e of [0, 1]) {
        const n = e ? tl.n1 : tl.n0, s = e ? -1 : 1;
        let a = arms.get(n);
        if (!a) { a = []; arms.set(n, a); }
        a.push({ tl, e, dx: dx / l * s, dz: dz / l * s, kind: tl.kind, len: l });
      }
    }
  }
  const corners = [], forks = [];
  for (const [n, l] of arms) {
    const [x, z] = posOf(n);
    if (l.length === 2) {
      const [A, B] = l;
      if (A.tl.bin === B.tl.bin) continue;       // 同方向格(純接力換款)= 直線,不需轉彎拼圖
      const hw = Math.max(hwOf(A.kind), hwOf(B.kind));
      const g = borderCornerArc(x, z, A.dx, A.dz, B.dx, B.dz,
        Math.min(jointF * hw, A.len * 0.4, B.len * 0.4), hw);
      if (g.mode === 'straight') continue;
      A.tl[A.e ? 'tr1' : 'tr0'] = g.L;
      B.tl[B.e ? 'tr1' : 'tr0'] = g.L;
      const cor = { type: 'corner', n, x, z, hw, geo: g,
                    a: { dx: A.dx, dz: A.dz, kind: A.kind, hw: hwOf(A.kind) },
                    b: { dx: B.dx, dz: B.dz, kind: B.kind, hw: hwOf(B.kind) } };
      corners.push(cor);
      A.tl[A.e ? 'c1' : 'c0'] = cor; B.tl[B.e ? 'c1' : 'c0'] = cor;
    } else if (l.length >= 3) {
      // 岔路:共用一個退縮長 ⇒ 逐臂斷面等距,接頭多邊形規整。
      // 係數與轉彎**分開**(forkF 而不是 jointF):轉彎的 L 決定圓弧半徑要大一點才順,
      // 交叉口的 L 卻是「路口有多大」—— 取 ~一個帶半寬,路口才是帶寬見方的一塊;
      // 沿用 jointF 會把逐臂楔形拉成星芒(2026-08-11 實拍踩過)。
      let hw = 0, lim = Infinity;
      for (const a of l) { hw = Math.max(hw, hwOf(a.kind)); lim = Math.min(lim, a.len * 0.4); }
      const L = Math.min(forkF * hw, lim);
      const list = l.map((a) => {
        a.tl[a.e ? 'tr1' : 'tr0'] = L;
        a.tl[a.e ? 'f1' : 'f0'] = true;      // 這一端接的是岔路(≠ 鏈內有下一片)⇒ 端點不得淡出
        return { dx: a.dx, dz: a.dz, kind: a.kind, hw: hwOf(a.kind) };
      });
      list.sort((p, q) => Math.atan2(p.dz, p.dx) - Math.atan2(q.dz, q.dx));   // 逆時針排序
      const ks = [];
      for (const a of list) if (!ks.includes(a.kind)) ks.push(a.kind);
      forks.push({ type: 'fork', n, x, z, L, hw, arms: list, kinds: ks });
    }
  }
  // 退縮後的端點(發射端只讀這一組;未退縮處與原端點逐位元相同)
  for (const ch of chains) {
    for (const tl of ch.tiles) {
      tl.tr0 = tl.tr0 || 0; tl.tr1 = tl.tr1 || 0;
      const dx = tl.x1 - tl.x0, dz = tl.z1 - tl.z0, l = Math.hypot(dx, dz) || 1;
      tl.ax = tl.x0 + dx / l * tl.tr0; tl.az = tl.z0 + dz / l * tl.tr0;
      tl.bx = tl.x1 - dx / l * tl.tr1; tl.bz = tl.z1 - dz / l * tl.tr1;
      tl.len = l - tl.tr0 - tl.tr1;
    }
  }
  return { chains, corners, forks };
}

// ---- 地貌界線拼圖:貼地帶畫筆(透明底 + 沿 x 圖案;鏡射重複 = 跨 tile 無縫)----
// **畫筆契約**:圖案 MUST 鋪滿整個 v 值域(= 整個貼圖高度)—— 帶的柔邊由**頂點 α**
// 負責(sweepFlat 兩緣 α0、中線 α1)。只在貼圖中央畫一小條的話,實得寬度遠小於型錄
// 宣告的 `w`,再被頂點 α 淡一次就整條糊掉;而畫布只有瀏覽器裡才畫得出來 ⇒ **沒有任何
// 離線稽核量得到這件事**,只有 tools/shot_borders.mjs 的實拍看得見(2026-08-11 踩過)。
// 橫向位置一律經 bandY 表達,MUST NOT 在畫筆裡手寫 S * 0.xx 的 y 偏移。
const bandY = (S, f) => S / 2 + f * S * 0.46;      // f ∈ [-1,1] 橫過帶的位置 → 畫布 y
// 沿 x 手繪帶:重疊色塊 = 有機邊緣(photoreal 噪點禁用,同 PAINTERS 語彙)
function bandBlob(g, S, rnd, f, color, alpha = 1) {
  const h = S * 0.92 * f;                          // f = 佔滿帶寬的比例
  g.fillStyle = color;
  for (let x = -12; x < S + 12; x += 9) {
    g.globalAlpha = alpha * (0.7 + rnd() * 0.3);
    brushBlob(g, x, S / 2 + (rnd() - 0.5) * S * 0.04, h / 2 + rnd() * h * 0.16, rnd);
  }
  g.globalAlpha = 1;
}
// 兩緣草撇(多數畫筆共用):貼在帶的兩側邊緣,把「筆直的幾何邊」咬碎成有機邊
function bandFringe(g, S, rnd, color, n = 34, len = 6) {
  g.strokeStyle = color; g.lineWidth = 2; g.lineCap = 'round';
  for (let i = 0; i < n; i++) {
    const x = rnd() * S, y = bandY(S, (rnd() < 0.5 ? -1 : 1) * (0.7 + rnd() * 0.3));
    g.beginPath(); g.moveTo(x, y);
    g.lineTo(x + (rnd() - 0.5) * 5, y + (y < S / 2 ? -1 : 1) * (len + rnd() * len * 0.9));
    g.stroke();
  }
  g.lineCap = 'butt';
}
// **v 契約(2026-08-13 使用者:「海灘的左右兩邊都是水域,但作為分界線的話應該是兩邊不同
// 類型的區域才對」)**:多數分界線是**對稱**的(小徑/林道/碎石徑/田埂/水溝/小溪/圍籬/樹籬/
// 岩塊 —— 兩側同性質,一條路的兩邊本來就一樣),畫筆愛怎麼畫都行。
// 但**過渡型**的三種(沙灘 / 泥灘 / 紅樹林)兩側是不同的東西:一邊是水、一邊是陸。畫成對稱的
// 就是「海灘的左右兩邊都是水」—— 浪花跑到陸側去了。這三種在型錄標 `flat.wet: 1`,
// 發射端據此把 v 軸轉正(見 wetFlipAt),契約是:
//     **f = +1(v = 1)恆為水側,f = −1(v = 0)恆為陸側**。
// 標了 `wet` 的畫筆 MUST 把水的元素(浪花/潮溝/積水)畫在 f > 0 那半,陸的元素(乾沙/貝殼/
// 草/樹冠)畫在 f < 0 那半;沒標的畫筆 MUST NOT 依賴 f 的正負(方向不保證)。
const BORDER_PAINTERS = {
  trail(g, S, rnd) {                                   // 步道小徑:土色踏面 + 踏石 + 車轍水窪 + 兩緣草撇
    bandBlob(g, S, rnd, 1, 'rgb(150,124,90)');
    bandBlob(g, S, rnd, 0.44, 'rgb(133,108,76)', 0.75);   // 踏實的中央踏道(比兩側深)
    g.fillStyle = 'rgb(126,102,72)';
    for (let x = 8; x < S; x += 26 + (rnd() * 10 | 0)) {
      g.beginPath();
      g.ellipse(x, bandY(S, (rnd() - 0.5) * 0.7), 9 + rnd() * 5, 7 + rnd() * 4, rnd(), 0, 7); g.fill();
      g.fillStyle = rnd() < 0.5 ? 'rgb(166,140,104)' : 'rgb(126,102,72)';
    }
    g.fillStyle = 'rgba(96,84,64,0.5)';                // 淺水窪(踏面低窪處)
    for (let i = 0; i < 5; i++) brushBlob(g, rnd() * S, bandY(S, (rnd() - 0.5) * 0.5), 5 + rnd() * 7, rnd);
    g.fillStyle = 'rgba(188,166,128,0.8)';             // 乾燥浮土斑
    for (let i = 0; i < 22; i++) { g.beginPath(); g.arc(rnd() * S, bandY(S, (rnd() - 0.5) * 1.6), 1.2 + rnd() * 2, 0, 7); g.fill(); }
    bandFringe(g, S, rnd, 'rgba(74,110,52,0.7)', 40, 7);
  },
  forestroad(g, S, rnd) {                              // 林道:雙輪轍 + 中央草帶 + 落葉點
    bandBlob(g, S, rnd, 1, 'rgb(122,100,72)', 0.92);
    g.fillStyle = 'rgba(88,70,50,0.85)';
    for (const f of [-0.5, 0.5]) {                     // 輪轍:一左一右
      for (let x = -8; x < S + 8; x += 10) brushBlob(g, x, bandY(S, f + (rnd() - 0.5) * 0.06), 13 + rnd() * 4, rnd);
    }
    g.strokeStyle = 'rgba(96,128,66,0.8)'; g.lineWidth = 2;
    for (let i = 0; i < 24; i++) {                     // 中央草帶
      const x = rnd() * S, y = bandY(S, (rnd() - 0.5) * 0.22);
      g.beginPath(); g.moveTo(x, y); g.lineTo(x + (rnd() - 0.5) * 4, y - 6); g.stroke();
    }
    g.fillStyle = 'rgba(150,110,60,0.7)';
    for (let i = 0; i < 16; i++) { g.beginPath(); g.arc(rnd() * S, bandY(S, (rnd() - 0.5) * 1.9), 2.2, 0, 7); g.fill(); }
    bandFringe(g, S, rnd, 'rgba(84,116,58,0.65)', 30, 8);
  },
  gravelpath(g, S, rnd) {                              // 碎石土徑:灰土帶 + 深淺碎石斑 + 級配粗細分層
    bandBlob(g, S, rnd, 1, 'rgb(160,148,128)');
    bandBlob(g, S, rnd, 0.5, 'rgb(178,168,148)', 0.6);    // 中央被輾亮的細級配
    for (let i = 0; i < 190; i++) {                       // 細粒:滿版
      g.fillStyle = rnd() < 0.5 ? 'rgba(120,112,98,0.9)' : 'rgba(196,188,170,0.9)';
      g.beginPath(); g.arc(rnd() * S, bandY(S, (rnd() - 0.5) * 1.9), 1.2 + rnd() * 1.8, 0, 7); g.fill();
    }
    for (let i = 0; i < 26; i++) {                        // 粗粒:多角形碎石(有稜有角才讀得出「碎石」)
      const x = rnd() * S, y = bandY(S, (rnd() - 0.5) * 1.7), r = 2.6 + rnd() * 3.4;
      g.fillStyle = rnd() < 0.5 ? 'rgb(146,138,124)' : 'rgb(206,198,182)';
      g.beginPath();
      for (let a = 0; a < 5; a++) {
        const t = a / 5 * Math.PI * 2, rr = r * (0.65 + rnd() * 0.55);
        a ? g.lineTo(x + Math.cos(t) * rr, y + Math.sin(t) * rr) : g.moveTo(x + Math.cos(t) * rr, y + Math.sin(t) * rr);
      }
      g.closePath(); g.fill();
    }
    // 從碎石縫裡長出來的雜草(2026-08-13 使用者「土路有碎石雜草」):bandFringe 只長在兩緣,
    // 而土路的草是**長在路面上**的 —— 少了它,不凸起的碎石帶就只剩一條灰色的紋理
    for (let i = 0; i < 26; i++) {
      const x = rnd() * S, y = bandY(S, (rnd() - 0.5) * 1.75);
      g.strokeStyle = rnd() < 0.5 ? 'rgba(112,134,72,0.85)' : 'rgba(146,152,88,0.8)';
      g.lineWidth = 1.3;
      for (let k = 0; k < 3; k++) {                        // 一叢三葉
        g.beginPath(); g.moveTo(x, y);
        g.quadraticCurveTo(x + (rnd() - 0.5) * 4, y - 4, x + (rnd() - 0.5) * 8, y - 6 - rnd() * 4);
        g.stroke();
      }
    }
    bandFringe(g, S, rnd, 'rgba(122,132,86,0.55)', 22, 5);
  },
  fieldpath(g, S, rnd) {                               // 田埂:夯土埂道 + 兩側田水映邊 + 稻梗屑 + 草冠
    bandBlob(g, S, rnd, 1, 'rgb(146,124,88)');
    bandBlob(g, S, rnd, 0.36, 'rgb(122,102,72)', 0.85);   // 中央踏實的埂頂
    g.fillStyle = 'rgba(108,120,96,0.55)';                // 兩側田水/濕土映邊
    for (const f of [-0.86, 0.86]) {
      for (let x = -8; x < S + 8; x += 11) brushBlob(g, x, bandY(S, f + (rnd() - 0.5) * 0.12), 9 + rnd() * 5, rnd);
    }
    g.strokeStyle = 'rgba(186,164,112,0.85)'; g.lineWidth = 1.5;   // 稻梗屑
    for (let i = 0; i < 26; i++) {
      const x = rnd() * S, y = bandY(S, (rnd() - 0.5) * 1.2), a = rnd() * Math.PI;
      g.beginPath(); g.moveTo(x, y); g.lineTo(x + Math.cos(a) * 7, y + Math.sin(a) * 4); g.stroke();
    }
    bandFringe(g, S, rnd, 'rgba(96,128,60,0.8)', 46, 8);
  },
  ditch(g, S, rnd) {                                   // 水溝:混凝土溝緣直線 + 深色水面 + 藻斑水光
    const y = (f) => bandY(S, f);
    g.fillStyle = 'rgb(70,84,88)';                     // 溝內水面(中央 60%)
    g.fillRect(0, y(-0.3), S, y(0.3) - y(-0.3));
    g.fillStyle = 'rgb(178,180,176)';                  // 兩側混凝土溝緣
    g.fillRect(0, y(-0.98), S, y(-0.3) - y(-0.98));
    g.fillRect(0, y(0.3), S, y(0.98) - y(0.3));
    g.fillStyle = 'rgba(140,142,138,0.7)';             // 溝緣暗邊(收邊)
    g.fillRect(0, y(-0.36), S, 3); g.fillRect(0, y(0.33), S, 3);
    g.fillStyle = 'rgba(96,120,96,0.6)';
    for (let i = 0; i < 18; i++) brushBlob(g, rnd() * S, y((rnd() - 0.5) * 0.5), 4 + rnd() * 5, rnd);
    g.strokeStyle = 'rgba(210,220,222,0.5)'; g.lineWidth = 1.4;
    for (let i = 0; i < 10; i++) {
      const x = rnd() * S, yy = y((rnd() - 0.5) * 0.45);
      g.beginPath(); g.moveTo(x, yy); g.lineTo(x + 8 + rnd() * 8, yy); g.stroke();
    }
    g.fillStyle = 'rgba(150,148,142,0.6)';             // 溝緣接縫(預鑄溝蓋的節)
    for (let x = 6; x < S; x += 30 + (rnd() * 12 | 0)) { g.fillRect(x, y(-0.98), 2, y(-0.3) - y(-0.98)); g.fillRect(x, y(0.3), 2, y(0.98) - y(0.3)); }
    bandFringe(g, S, rnd, 'rgba(92,124,64,0.7)', 26, 6);
  },
  fenceline(g, S, rnd) {                               // 圍籬腳:踩踏出來的土帶 + 樁腳陰影 + 高雜草
    bandBlob(g, S, rnd, 1, 'rgb(138,132,96)');
    bandBlob(g, S, rnd, 0.34, 'rgb(120,110,80)', 0.8);    // 沿籬走出來的細徑
    g.fillStyle = 'rgba(74,66,48,0.5)';                   // 樁腳落影(規律間距 = 人工界)
    for (let x = 10; x < S + 10; x += 32) brushBlob(g, x, bandY(S, 0.02), 5 + rnd() * 2, rnd);
    g.fillStyle = 'rgba(158,150,112,0.7)';
    for (let i = 0; i < 30; i++) { g.beginPath(); g.arc(rnd() * S, bandY(S, (rnd() - 0.5) * 1.8), 1.3 + rnd() * 2, 0, 7); g.fill(); }
    bandFringe(g, S, rnd, 'rgba(112,134,66,0.85)', 52, 10);
  },
  hedgebank(g, S, rnd) {                               // 樹籬腳:落葉腐土 + 苔痕 + 枯枝(樹籬本體是立體脊)
    bandBlob(g, S, rnd, 1, 'rgb(104,94,68)');
    g.fillStyle = 'rgba(70,64,48,0.6)';                   // 樹籬落下的濃蔭(壓在中線)
    for (let x = -8; x < S + 8; x += 10) brushBlob(g, x, bandY(S, (rnd() - 0.5) * 0.2), 13 + rnd() * 5, rnd);
    for (let i = 0; i < 46; i++) {                        // 落葉
      g.fillStyle = rnd() < 0.5 ? 'rgba(146,116,62,0.85)' : 'rgba(112,92,54,0.85)';
      const x = rnd() * S, y = bandY(S, (rnd() - 0.5) * 1.8);
      g.beginPath(); g.ellipse(x, y, 3.4 + rnd() * 2.4, 1.8 + rnd() * 1.2, rnd() * 3, 0, 7); g.fill();
    }
    g.fillStyle = 'rgba(96,132,74,0.55)';                 // 苔痕
    for (let i = 0; i < 14; i++) brushBlob(g, rnd() * S, bandY(S, (rnd() - 0.5) * 1.5), 5 + rnd() * 6, rnd);
    g.strokeStyle = 'rgba(84,70,50,0.85)'; g.lineWidth = 1.6;
    for (let i = 0; i < 14; i++) {                        // 枯枝
      const x = rnd() * S, y = bandY(S, (rnd() - 0.5) * 1.4), a = rnd() * Math.PI;
      g.beginPath(); g.moveTo(x, y); g.lineTo(x + Math.cos(a) * 12, y + Math.sin(a) * 6); g.stroke();
    }
    bandFringe(g, S, rnd, 'rgba(88,124,58,0.8)', 40, 9);
  },
  rubble(g, S, rnd) {                                  // 岩塊帶:崩落的多角岩屑 + 地衣 + 石縫暗線
    bandBlob(g, S, rnd, 1, 'rgb(150,146,138)');
    for (let i = 0; i < 60; i++) {                        // 多角岩塊(大小分層,不是均勻噪點)
      const x = rnd() * S, y = bandY(S, (rnd() - 0.5) * 1.9), r = 3 + rnd() * rnd() * 12;
      const c = 120 + (rnd() * 70 | 0);
      g.fillStyle = `rgb(${c},${c - 3},${c - 10})`;
      g.beginPath();
      for (let a = 0; a < 6; a++) {
        const t = a / 6 * Math.PI * 2, rr = r * (0.6 + rnd() * 0.6);
        a ? g.lineTo(x + Math.cos(t) * rr, y + Math.sin(t) * rr) : g.moveTo(x + Math.cos(t) * rr, y + Math.sin(t) * rr);
      }
      g.closePath(); g.fill();
      g.strokeStyle = 'rgba(78,76,72,0.5)'; g.lineWidth = 1.2; g.stroke();   // 石縫暗線
    }
    g.fillStyle = 'rgba(154,168,118,0.45)';               // 地衣
    for (let i = 0; i < 18; i++) brushBlob(g, rnd() * S, bandY(S, (rnd() - 0.5) * 1.7), 3.5 + rnd() * 4, rnd);
  },
  stream(g, S, rnd) {                                  // 小溪:藍綠水帶 + 白水光 + 兩岸溪石
    bandBlob(g, S, rnd, 1, 'rgb(88,138,148)');
    bandBlob(g, S, rnd, 0.5, 'rgb(70,120,134)', 0.8);  // 深槽
    g.strokeStyle = 'rgba(226,240,242,0.75)'; g.lineWidth = 1.6; g.lineCap = 'round';
    for (let i = 0; i < 18; i++) {
      const x = rnd() * S, y = bandY(S, (rnd() - 0.5) * 0.9);
      g.beginPath(); g.moveTo(x, y); g.quadraticCurveTo(x + 6, y - 2, x + 12 + rnd() * 6, y); g.stroke();
    }
    g.fillStyle = 'rgb(140,138,126)';
    for (let i = 0; i < 18; i++) {                     // 兩岸溪石
      const y = bandY(S, (rnd() < 0.5 ? -1 : 1) * (0.66 + rnd() * 0.3));
      g.beginPath(); g.ellipse(rnd() * S, y, 4.5 + rnd() * 3, 3.5 + rnd() * 2.5, rnd(), 0, 7); g.fill();
      g.fillStyle = rnd() < 0.5 ? 'rgb(158,154,142)' : 'rgb(126,124,114)';
    }
    g.fillStyle = 'rgba(214,236,238,0.45)';            // 石頭下游的白沫尾
    for (let i = 0; i < 10; i++) brushBlob(g, rnd() * S, bandY(S, (rnd() - 0.5) * 0.8), 4 + rnd() * 5, rnd);
    bandFringe(g, S, rnd, 'rgba(88,126,66,0.8)', 34, 9);
  },
  // ⚠ 以下三支標了 `wet`(見上面的 v 契約):**f > 0 是水、f < 0 是陸**,MUST NOT 畫成對稱
  beach(g, S, rnd) {                                   // 沙灘:陸側乾沙 → 潮線 → 水側濕沙 + 浪花
    bandBlob(g, S, rnd, 1, 'rgb(216,198,158)');
    g.save(); g.beginPath();                              // 濕沙只鋪水側(f > 0.05)
    g.rect(0, bandY(S, 0.05), S, S); g.clip();
    bandBlob(g, S, rnd, 1, 'rgb(186,168,132)', 0.75);
    g.restore();
    g.strokeStyle = 'rgba(168,150,116,0.7)'; g.lineWidth = 2.2;   // 潮線:沖刷到最遠的那幾道
    for (const f of [-0.1, 0.14]) {
      g.beginPath();
      for (let x = -8; x <= S + 8; x += 12) {
        const y = bandY(S, f + (rnd() - 0.5) * 0.16);
        x < 0 ? g.moveTo(x, y) : g.lineTo(x, y);
      }
      g.stroke();
    }
    for (let i = 0; i < 44; i++) {                        // 貝殼/卵石:堆在潮線與陸側
      g.fillStyle = rnd() < 0.6 ? 'rgba(240,232,214,0.9)' : 'rgba(150,140,120,0.9)';
      g.beginPath(); g.arc(rnd() * S, bandY(S, -0.95 + rnd() * 1.1), 1.2 + rnd() * 1.8, 0, 7); g.fill();
    }
    g.strokeStyle = 'rgba(150,152,102,0.75)'; g.lineWidth = 1.5;  // 陸側:沙丘草
    for (let i = 0; i < 22; i++) {
      const x = rnd() * S, y = bandY(S, -1 + rnd() * 0.28);
      g.beginPath(); g.moveTo(x, y);
      g.quadraticCurveTo(x + (rnd() - 0.5) * 5, y + 4, x + (rnd() - 0.5) * 9, y + 8 + rnd() * 4);
      g.stroke();
    }
    // 浪花(2026-08-13 使用者「海灘有浪花」)—— **只在水側**。畫成對稱的話兩邊都讀成水,
    // 而分界線的兩側本來就該是不同類型的區域(使用者同日第二輪回報)
    for (const [f, a] of [[0.42, 0.7], [0.8, 0.9]]) {
      g.fillStyle = `rgba(252,252,250,${a})`;
      for (let x = -6; x < S + 6; x += 7) {               // 沫線本體:一顆顆氣泡連成扇貝邊
        const y = bandY(S, f + (rnd() - 0.5) * 0.13);
        g.beginPath(); g.arc(x + rnd() * 5, y, 2 + rnd() * 3.4, 0, 7); g.fill();
      }
      g.strokeStyle = `rgba(206,228,234,${a * 0.7})`; g.lineWidth = 1.4;   // 沫線後緣的濕沙暗邊
      g.beginPath();
      for (let x = -6; x <= S + 6; x += 10) {
        const y = bandY(S, f - 0.1 + (rnd() - 0.5) * 0.1);
        x < 0 ? g.moveTo(x, y) : g.lineTo(x, y);
      }
      g.stroke();
    }
    g.fillStyle = 'rgba(255,255,255,0.5)';                // 餘沫:只散在水側
    for (let i = 0; i < 46; i++) { g.beginPath(); g.arc(rnd() * S, bandY(S, 0.2 + rnd() * 0.8), 0.8 + rnd() * 1.4, 0, 7); g.fill(); }
  },
  mudflat(g, S, rnd) {                                 // 泥灘過渡帶(水域↔沼澤):陸側鹽生草 → 泥灘 → 水側潮溝積水
    bandBlob(g, S, rnd, 1, 'rgb(122,110,88)');
    g.save(); g.beginPath();                              // 水側:泡水的深色濕泥
    g.rect(0, bandY(S, 0.1), S, S); g.clip();
    bandBlob(g, S, rnd, 1, 'rgb(92,86,72)', 0.8);
    g.restore();
    g.fillStyle = 'rgba(70,92,96,0.55)';                  // 潮溝:退潮留下的積水蜿蜒帶(水側)
    for (let i = 0; i < 10; i++) {
      const y0 = bandY(S, 0.15 + rnd() * 0.8);
      g.beginPath(); g.moveTo(-8, y0);
      for (let x = 0; x <= S + 8; x += 18) g.quadraticCurveTo(x + 6, y0 + (rnd() - 0.5) * 9, x + 18, y0 + (rnd() - 0.5) * 5);
      g.lineWidth = 3 + rnd() * 5; g.strokeStyle = 'rgba(70,92,96,0.5)'; g.stroke();
    }
    g.fillStyle = 'rgba(150,140,116,0.6)';                // 乾裂泥龜背(陸側)
    for (let i = 0; i < 26; i++) brushBlob(g, rnd() * S, bandY(S, -1 + rnd() * 1.0), 4 + rnd() * 7, rnd);
    g.strokeStyle = 'rgba(96,84,64,0.5)'; g.lineWidth = 1;
    for (let i = 0; i < 30; i++) {                        // 泥裂縫
      const x = rnd() * S, y = bandY(S, -1 + rnd() * 0.9), a = rnd() * Math.PI;
      g.beginPath(); g.moveTo(x, y); g.lineTo(x + Math.cos(a) * 9, y + Math.sin(a) * 6); g.stroke();
    }
    g.fillStyle = 'rgba(140,132,104,0.85)';               // 貝殼/蟹洞
    for (let i = 0; i < 34; i++) { g.beginPath(); g.arc(rnd() * S, bandY(S, (rnd() - 0.5) * 1.9), 1 + rnd() * 1.6, 0, 7); g.fill(); }
    g.strokeStyle = 'rgba(118,138,84,0.8)'; g.lineWidth = 1.6; g.lineCap = 'round';
    for (let i = 0; i < 34; i++) {                        // 陸側:鹽生草叢(沼澤那一邊)
      const x = rnd() * S, y = bandY(S, -1 + rnd() * 0.35);
      g.beginPath(); g.moveTo(x, y + 5); g.lineTo(x + (rnd() - 0.5) * 4, y - 4 - rnd() * 6); g.stroke();
    }
    g.lineCap = 'butt';
  },
  mangrove(g, S, rnd) {                                // 紅樹林:陸側樹冠 → 支柱根 → 水側潮溝
    bandBlob(g, S, rnd, 1, 'rgb(112,98,76)');
    g.save(); g.beginPath();
    g.rect(0, bandY(S, 0.15), S, S); g.clip();            // 水側:泡水的深泥
    bandBlob(g, S, rnd, 1, 'rgb(84,80,68)', 0.75);
    g.restore();
    g.fillStyle = 'rgba(63,107,63,0.8)';                  // 陸側:密實樹冠
    for (let i = 0; i < 20; i++) brushBlob(g, rnd() * S, bandY(S, -1 + rnd() * 0.85), 7 + rnd() * 9, rnd);
    g.fillStyle = 'rgba(96,140,80,0.7)';
    for (let i = 0; i < 14; i++) brushBlob(g, rnd() * S, bandY(S, -1 + rnd() * 0.7), 4 + rnd() * 6, rnd);
    g.strokeStyle = 'rgba(84,66,48,0.9)'; g.lineWidth = 2; g.lineCap = 'round';
    for (let i = 0; i < 40; i++) {                        // 支柱根:自樹冠往水側伸出去
      const x = rnd() * S, y = bandY(S, -0.35 + rnd() * 1.1);
      g.beginPath(); g.moveTo(x, y + 5 + rnd() * 4); g.lineTo(x + (rnd() - 0.5) * 4, y - 5 - rnd() * 5); g.stroke();
    }
    g.lineCap = 'butt';
    g.fillStyle = 'rgba(58,74,62,0.5)';                   // 潮溝積水:只在水側
    for (let i = 0; i < 12; i++) brushBlob(g, rnd() * S, bandY(S, 0.25 + rnd() * 0.75), 6 + rnd() * 8, rnd);
  },
};
// 畫筆鍵取自型錄的 `flat.tex`(單一縫;快取仍以種類為鍵)—— MUST NOT 退回「拿種類名直接
// 當畫筆鍵」:那讓 `tex` 變成沒有消費端的裝飾欄位,改名時不會有任何地方報錯
const _bdTexCache = new Map();
function borderTex(kind) {
  let t = _bdTexCache.get(kind);
  if (t) return t;
  const S = 256;
  const cv = document.createElement('canvas');
  cv.width = cv.height = S;
  let hs = 0;
  for (let i = 0; i < kind.length; i++) hs = (hs * 31 + kind.charCodeAt(i)) | 0;
  BORDER_PAINTERS[BORDER_KINDS[kind].flat.tex](cv.getContext('2d'), S, mulberry32(0xB07D ^ hs));
  t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.MirroredRepeatWrapping;
  _bdTexCache.set(kind, t);
  return t;
}

/**
 * 鋪設地被覆蓋層。加進 biomes group,回傳統計 { patches, details }。
 * @param group     biomes 的 THREE.Group
 * @param terrain   buildTerrain() 回傳物
 * @param opts.isBlocked  (x,z)=>bool 兵線/塔/主堡淨空
 * @param opts.classifyAt (x,z)=>'green'|'bare'|'urban'|'wet'|'water'(classifyPureAt 缺席時的備援)
 * @param opts.classifyPureAt 純圖資分類(無場地 mix 改寫);底毯與特徵層一律用它,
 *                            拼圖類型才與衛星影像相符(球場限市區/水田限綠地/碎石限裸露地)
 * @param opts.blockers   建物碰撞柱(patch 避開建物)
 * @param opts.season / opts.seed / opts.rnd  決定性環境參數
 * @param opts.roadDirAt  (x,z)=>最近道路方位角(rad,atLocal 平面角)或 null(附近無路);
 *                        整齊件沿路擺放用,可缺席 = 全部隨機朝向(行為同舊版)
 * @param opts.roadClear  (x,z)=>是否落在道路走廊上(bool);特徵拼圖避開路面免 3D 件戳穿,
 *                        可缺席 = 不遮罩(行為同舊版)。查詢不吃 rnd(拒絕在首個 rnd() 前 = 序列不變)
 */
export function buildGroundCover(group, terrain, { isBlocked, classifyAt, classifyPureAt, envCodeAt, blockers, season, seed, rnd, roadDirAt, roadRank, roadClear, roadPolys, surfaceField = null }) {
  const classifyPure = classifyPureAt || classifyAt;   // 底毯用:無隨機改寫的分區
  const envAt = envCodeAt || (() => 0);                // 水/沼分類唯一縫(biomes.terrainEnvCode;缺席 = 全乾)
  const AQ_DET = new Set(['reed', 'lotuspad', 'fish']);   // 水生細節:免吃岸線高度淘汰、貼水面擺放
  // 沉在水面下多少(m);2026-08-13 游魚。**這是 AQ_DET 的子集而不是第二張名冊** ——
  // 蘆葦/荷葉貼在水面上、魚在水面下,兩者共用同一道岸線豁免。水深不足(池底離水面比這個
  // 數字還淺)就不擺:魚半個身子插在泥裡比沒有魚還糟(§4 寧缺勿錯)
  const DIVE = { fish: 0.5 };
  const buckets = new Map();   // `${sub}#${variant}` -> 幾何桶
  const det = {};
  for (const t in DETAIL_DEFS) det[t] = [];
  let detCount = 0;
  let detCap = FEAT_DETAIL;   // 特徵層先用配額,底毯撒佈前放寬到 MAX_DETAIL
  // ==== 都市規劃格網方位(2026-07-29 使用者需求「球場/操場/停車場/太陽能板這類單獨
  // 完整的區塊看起來沒有規劃 —— 盡可能跟道路一致的都市規劃」)====
  // 舊病灶:roadDirAt 只在 46m 內有答案,更遠的規律結構退回完全隨機朝向;即使近路
  // 還有 reg 擲骰(court 0.9 ⇒ 10% 隨機)—— 路邊一塊斜著擺的停車場就是「沒規劃」感。
  // 新制:規律結構(edge:'ink')朝向**恆對齊**,三段退避 —— 近路(46m)取最近路向 →
  // 離路擴大半徑(GRID_FAR)找同街區幹道 → 全圖格網主方位 gridA(道路線段長度加權的
  // mod 90° 圓平均;地籍格網對 90° 旋轉對稱 ⇒ 取 4 倍角圓平均,垂直街道不互相抵銷)。
  // 無圖資(roadPolys 空)→ gridA=null,退回隨機(離線備援行為不變)。零 rnd 純幾何。
  const GRID_FAR_R2 = 220 * 220;
  // 主方位公式只有 `roadgrid.gridAngle` 一份(2026-08-10 收口):場地主方位的離線烘焙吃的是
  // 同一支,差別只在取樣面 —— 那邊只收大馬路(要的是「地籍格網對準哪」),這裡收全部道路
  // (要的是「這一帶的擺件該朝哪」)。逐位元同舊制。
  let gridA = null;
  if (roadPolys?.length) {
    const segs = [];
    for (const [pts] of roadPolys) {
      for (let i = 1; i < pts.length; i++) segs.push([pts[i - 1][0], pts[i - 1][1], pts[i][0], pts[i][1]]);
    }
    gridA = gridAngle(segs);
  }
  // 整齊度 → 沿路對齊:reg = 該型拼圖/物件沿最近道路方向擺放的機率,其餘機率
  // (或附近無路)隨機朝向;ink 規律結構不擲骰,恆走三段退避對齊(見上)。
  // 亂數紀律(§2.3):兩分支都固定先抽兩枚再決策 —— 對齊與否不改變 rnd 消耗序列;
  // roadDirAt / gridA 本身不吃 rnd。回傳 atLocal 平面角。
  let aligned = 0;   // 沿路對齊次數(拼圖 + 物件;冒煙稽核用)
  let bStat = { planned: 0, drawn: 0, forks: 0, forksDrawn: 0 };   // 界線拼圖:規劃 vs 實畫
  const orient = (x, z, reg, halfTurn, ink = false) => {
    const ra = rnd() * (halfTurn ? Math.PI : Math.PI * 2);   // 隨機朝向候選(固定枚數)
    const roll = rnd();                                       // 對齊擲骰(固定枚數)
    if (ink) {                                                // 都市規劃件:恆對齊道路格網
      const a = (roadDirAt ? (roadDirAt(x, z) ?? roadDirAt(x, z, GRID_FAR_R2)) : null) ?? gridA;
      if (a == null) return ra;
      aligned++;
      return a;
    }
    if (!reg || !roadDirAt || roll >= reg) return ra;
    const a = roadDirAt(x, z);
    if (a == null) return ra;
    aligned++;
    return a;
  };
  // ry:null = 依 REG[type] 整齊度擲骰(沿路對齊或隨機朝向);
  // 傳入固定角 = 對齊列陣(藤架/太陽能板/貨櫃與貼圖行列同向),不經整齊度擲骰
  const addDetail = (type, px, pz, s, tintHex = null, sy = 1, ry = null) => {
    // 3D 擺件同樣不得站在分界線上(使用者:「還有各種 3D 物件都不應該橫跨分界線」)——
    // 界線本身該長什麼(踏石/樁/樹籬/岩塊)由 BORDER_KINDS 的 ridge 出,不是讓地被的
    // 雜草稻苗貨櫃長到界線上。與既有早退同位 ⇒ 不消耗 rnd
    if (detCount >= detCap || isBlocked(px, pz) || bdCross(px, pz, 0)) return;
    // 互不重疊 + 不站進別人的功能性區塊(足跡量零件實幾何 × 本實例縮放);
    // 與既有早退同位 ⇒ 不消耗 rnd(s 由呼叫端先抽好,序列不變)
    const dr = detailR(type) * s;
    if (!detFree(px, pz, dr)) return;
    let y = terrain.heightAt(px, pz);
    if (y < 0.4) {
      if (!AQ_DET.has(type)) return;                   // 水生細節(蘆葦/荷葉/魚)放行
      if (terrain.waterY != null) y = Math.max(y, terrain.waterY);
    }
    const dive = DIVE[type];
    if (dive) {                                        // 沉在水面下:水不夠深就不擺(見 DIVE)
      const wy = terrain.waterY;
      if (wy == null || terrain.heightAt(px, pz) > wy - dive - 0.2) return;
      y = wy - dive;
    }
    const tl = TILT[type] || 0;   // 隨機傾角:每實例姿態互異
    // atLocal 平面角 → three.js rotation.y 取負(同 rows 的 ry=-rot 慣例)
    det[type].push({ x: px, y, z: pz, s, sy, ry: ry ?? -orient(px, pz, REG[type] || 0, false),
                     tx: (rnd() - 0.5) * 2 * tl, tz: (rnd() - 0.5) * 2 * tl, tint: tintHex });
    detPut(px, pz, dr);
    detCount++;
  };

  const inb = 30;
  const area = terrain.worldW * terrain.worldH / 1e6;
  const target = Math.max(140, Math.min(1800, Math.round(area * 420)));
  let placed = 0;
  let arraysN = 0;   // 沿街規律陣列落塊數(冒煙稽核用;patches 含此數)

  // ---- 高地/季節分區:量測全場高程「起伏」(絕對海拔無意義,高原城市會誤判),
  // 相對高處改鋪高原/岩屑/冰原 ----
  let hMin = Infinity, hMax = -Infinity;
  for (let j = 0; j <= 20; j++) {
    for (let i = 0; i <= 20; i++) {
      const h = terrain.heightAt(terrain.minX + terrain.worldW * i / 20, terrain.minZ + terrain.worldH * j / 20);
      if (h < hMin) hMin = h;
      if (h > hMax) hMax = h;
    }
  }
  const relief = hMax - hMin;
  const alpineH = relief > 40 ? hMin + relief * 0.62 : Infinity;   // 平坦地圖不出現高地地貌
  const zoneLists = { ...ZONES };
  const carpetLists = { ...CARPET };
  if (season === 'winter') {                            // 冬季:裸露地混入冰原、高地以冰原為主
    zoneLists.bare = ['icefield', ...ZONES.bare, 'icefield'];
    zoneLists.alpine = ['plateau', 'icefield', 'scree', 'icefield', 'plateau', 'icefield'];
    carpetLists.bare = ['icefield', ...CARPET.bare, 'icefield'];
    carpetLists.alpine = ['icefield', 'plateau', 'icefield', 'scree', 'icefield'];
  }
  // 底毯清單排成顏色路徑(carpetOrder;2026-08-13 使用者「同一類型盡可能不要短距離快速變化
  // 子類別」)—— 選款是「低頻雜訊 t → 清單索引」,索引相鄰若不是顏色相鄰,t 再平滑顏色照樣跳。
  // MUST 排在冬季覆寫**之後**(冬季那兩份是新組的清單,不排就沒被排到)、且 enclave 的清單
  // 也 MUST 排(encRt 建表處),兩條清單來源少一條就是「有些地方還在跳色」。
  for (const zn in carpetLists) carpetLists[zn] = carpetOrder(carpetLists[zn]);
  // coarse 分區查詢(sub → zone):交界樣式(planSeamOverlays)與邊界遮蔽物共用同一份(單一縫)
  const subCoarse = new Map();
  for (const zn in carpetLists) for (const s of carpetLists[zn]) if (!subCoarse.has(s)) subCoarse.set(s, zn);
  subCoarse.set('watertile', 'water'); subCoarse.set('deepwater', 'water');
  const coarseOfKey = (key) => subCoarse.get(key.slice(0, key.indexOf('#'))) || 'green';
  // 每地表允許出現的分區(特徵 + 底毯清單聯集):tryPatch 一律據此把關,
  // 家族延伸(鹽田→魚塭、農田拼布)跨進異分區/越過圖資邊界時直接擋下
  const subZones = new Map();
  for (const lists of [zoneLists, carpetLists]) {
    for (const zn in lists) {
      for (const sub of lists[zn]) {
        let s = subZones.get(sub);
        if (!s) { s = new Set(); subZones.set(sub, s); }
        s.add(zn);
      }
    }
  }
  const zoneAt = (x, z) => {
    if (surfaceField) return surfaceField.sample(x, z);
    // 水/沼優先走 envCode(與伺服器遮罩/涉水判定同一規則 = WYSIWYG):
    // 水域回 'water'(無特徵 patch 清單 ⇒ 任何場所拼圖不得落水),沼澤回 'wet'(啟用濕地特徵)
    const ec = envAt(x, z);
    if (ec === 1) return 'water';
    if (ec === 2) return 'wet';
    let zn = classifyPure(x, z);
    if ((zn === 'green' || zn === 'bare') && terrain.heightAt(x, z) > alpineH) zn = 'alpine';
    return zn;
  };

  // ==== 底毯層:抖動網格無縫鋪滿全部陸地 ====
  // 角點位置只由「格點索引雜湊」決定 → 相鄰 cell 引用同一角點,拼面天生水密;
  // 抖動幅度 ±0.45 格(不足半格,拓撲不翻面)讓交界呈手繪碎形而非直線格線。
  const carpetBuckets = new Map(), spillBuckets = new Map(), bandBuckets = new Map();
  const CLIFT = 0.07, SLIFT = 0.10;                     // 底毯 0.070 < 外溢 [0.100,0.107] < 不規律 fade[.110,.124] < 規律 ink[.135,.172] < 道路 0.18
  const cell = Math.max(13, Math.max(terrain.worldW, terrain.worldH) / 232);
  // 貼合抬升(見檔頭 SAG):同一支場、但**每一層傳自己的弦長**(檔頭 ⑥)—— 界線拼圖的環距
  // 2m 上下、田埂 3m,拿底毯的 6.5m 去抬就是抬十倍(∝ 弦長²)⇒ 頂到 MAX 0.6m 浮成一條台。
  // 圖內底毯 / 外溢 / 脊帶**不在消費端之列**(2026-08-13 起直接吃地形三角形,虧損恆 0)。
  // 上限依所在位置分流,而三個分支全是 (x,z) 的純函式 ⇒ 同一點恆同值,抬升本身不會撕開皮。
  const inMap = (x, z) => x >= terrain.minX && x <= terrain.maxX && z >= terrain.minZ && z <= terrain.maxZ;
  const drapeSag = (hAt, x, z, r) => {
    if (SAG_OFF) return 0;
    const inb = inMap(x, z);
    const s = groundSagAt(hAt, x, z, r ?? (inb ? cell : cell * BUF_CELL_F) / 2);
    if (!inb) return Math.min(s, SAG.BUF);
    // 道路走廊內夾得更緊:路基已被 gradeRoadBeds 整平 ⇒ 那裡本來就幾乎沒有折角,
    // 而抬過 0.11 就會把草皮推到路面之上(§lift 階梯)
    return Math.min(s, roadClear?.(x, z) ? SAG.ROAD : SAG.MAX);
  };
  // 外溢每 key 微升差(0~0.007,合計仍 < fade 下限 0.110):異 key 外溢在同一格互疊時
  // 避免共面深度互吃(舊制後畫的整張被深度測試丟棄 = 交界轉角硬缺口);繪序(renderOrder)
  // 依同一雜湊 ⇒ 低者先畫、高者後蓋,混色連續且跨客戶端決定性(§2.3,不吃 rnd)
  const seamLift = (key) => {
    let h = 0;
    for (let i = 0; i < key.length; i++) h = (h * 31 + key.charCodeAt(i)) | 0;
    return ((h >>> 3) % 8) * 0.001;
  };
  // 過渡帶手繪碎形擾動波數(世界波長 ≈ 1.6 cell:小於交界帶寬、大於頂點間距)
  const SEAM_QC_W = (2 * Math.PI) / (cell * 1.6);
  const gnx = Math.ceil(terrain.worldW / cell), gnz = Math.ceil(terrain.worldH / cell);
  // ==== 準晶體場(quasicrystal;不規律拼貼的非週期骨架;底毯角點/選格/細節共用縫)====
  // 5 向平面波和(方向 kπ/5 → 十重對稱 = 各向同性、非週期)。純函數:同 seed 同座標 ⇒ 同值,
  // 全房間/跨客戶端一致(§2.3);相位由 seed 導 → 每圖不同、同房相同。零 rnd / 零 Math.random(A4)。
  // 以波數 w 縮放同一支餵三尺度:角點去格化(粗)、底毯選格群聚(中)、細節 blue-noise(細)。
  const QC_N = 5;
  const QC_DIR = [];
  for (let k = 0; k < QC_N; k++) QC_DIR.push([Math.cos(k * Math.PI / QC_N), Math.sin(k * Math.PI / QC_N)]);
  const QC_PH = QC_DIR.map((_, k) => {
    let n = (seed ^ Math.imul(k + 1, 0x9E3779B1)) | 0;
    n = Math.imul(n ^ (n >>> 15), 0x2C1B3C6D);
    return ((n ^ (n >>> 13)) >>> 0) / 4294967296 * Math.PI * 2;
  });
  // 場值 ∈[-1,1] 嚴格(N 道 cos /N)→ 角點位移可精確編列 ±0.45 預算
  const qcVal = (x, z, w) => {
    let s = 0;
    for (let k = 0; k < QC_N; k++) s += Math.cos(w * (QC_DIR[k][0] * x + QC_DIR[k][1] * z) + QC_PH[k]);
    return s / QC_N;
  };
  // ∇場單位向量(指向最近波峰);近平坦回 [0,0]
  const qcGrad = (x, z, w) => {
    let gx = 0, gz = 0;
    for (let k = 0; k < QC_N; k++) {
      const s = -Math.sin(w * (QC_DIR[k][0] * x + QC_DIR[k][1] * z) + QC_PH[k]);
      gx += s * QC_DIR[k][0]; gz += s * QC_DIR[k][1];
    }
    const m = Math.hypot(gx, gz);
    return m < 1e-6 ? [0, 0] : [gx / m, gz / m];
  };
  // 細節 blue-noise 微推:白噪落點沿最近峰偏置 0.7m(<¼ 波長 → 去叢聚不硬吸);純函數,不吃 rnd
  const DET_QC_W = (2 * Math.PI) / 2.6;
  const qcNudge = (px, pz) => { const [gx, gz] = qcGrad(px, pz, DET_QC_W); return [px + gx * 0.7, pz + gz * 0.7]; };
  const QC_SEL_W = CARPET_SEL.QC_W;   // 底毯 subtype 群聚調變波數(唯一縫,見 CARPET_SEL)

  const cornH = (i, j, s) => {                          // 手繪顆粒(疊在準晶體場上加碎形細節)
    let n = ((i * 374761393 + j * 668265263) ^ (seed ^ s)) | 0;
    n = Math.imul(n ^ (n >>> 13), 1274126177);
    return ((n ^ (n >>> 16)) >>> 0) / 4294967296;
  };
  // 角點位移 = 準晶體場(主 ±0.34)+ cornH 顆粒(次 ±0.10),輸入格點索引 (i,j) → 天生 (i,j) 純函數
  // ⇒ 相鄰 cell 共用角索引 ⇒ 同位移 ⇒ 水密。dz 取座標偏移的第二組準晶體樣本解耦。合計振幅 0.44<0.45,
  // clampD 再保險 ⇒ 相鄰角最壞相向 0.88<1.0,拓撲不翻面。快取(i,j)→[x,z]:省重算 + 共用角位元相同保證。
  const QC_CORN_W = 1.75, QC_CORN_A = 0.34, QC_CORN_G = 0.20;
  const clampD = (d) => (d < -0.45 ? -0.45 : d > 0.45 ? 0.45 : d);
  const _cornCache = new Map();
  const cornerAt = (i, j) => {
    const ck = i * 65536 + j;
    let c = _cornCache.get(ck);
    if (c) return c;
    const dx = clampD(QC_CORN_A * qcVal(i, j, QC_CORN_W) + QC_CORN_G * (cornH(i, j, 0x9E37) - 0.5)) * cell;
    const dz = clampD(QC_CORN_A * qcVal(i + 8123.5, j + 2971.3, QC_CORN_W) + QC_CORN_G * (cornH(i, j, 0x85EB) - 0.5)) * cell;
    const x = terrain.minX + i * cell + dx, z = terrain.minZ + j * cell + dz;
    c = [Math.min(terrain.maxX, Math.max(terrain.minX, x)),
         Math.min(terrain.maxZ, Math.max(terrain.minZ, z))];
    _cornCache.set(ck, c);
    return c;
  };
  // 低頻水彩 wash(連續函數 → 跨 cell 無階差;botw_plan Task 2.1 的反重複手段)
  const wash = (x, z) => 0.88 + (vnoise(x * 0.011, z * 0.011, seed ^ 0x5A5A) - 0.5) * 0.34;
  // cell 分區:5 點多數決(抹平衛星像素雜訊的逐格跳動)+ 坡度規則
  //   懸崖(>0.75)→ '!' 不鋪(頂投影 UV 在近垂直面會拉絲,露地形岩面較自然,
  //                  鄰格外溢淡出補縫);中坡(>0.28)→ 強制 bare(山坡不會是停車場)
  //   低窪綠地(水面 +2.2m 內)→ wet(河岸蘆葦帶)
  // 底毯 coarse 分區(cellKeyAt 的分區半段;純函數零 rnd):'water' / '!' / null(不鋪)/ zone。
  // 先整張算成 zoneGrid 再交 planEnclaves 判小區域包裹,cellKeyAt 吃預算好的 zn 選 sub。
  const cellZoneAt = (i, j) => {
    const cx = terrain.minX + (i + 0.5) * cell, cz = terrain.minZ + (j + 0.5) * cell;
    // 水/沼專屬拼圖(2026-07-22,envCode 與伺服器遮罩同一規則 = WYSIWYG):
    // 水域(1)必鋪水拼圖(免坡度/灘線淘汰 —— 水面是平的,易辨識優先)。
    const ec = envAt(cx, cz);
    if (ec === 1) return 'water';
    const hC = terrain.heightAt(cx, cz);
    const slope = Math.max(
      Math.abs(terrain.heightAt(cx + cell, cz) - hC),
      Math.abs(terrain.heightAt(cx, cz + cell) - hC)) / cell;
    if (slope > 0.75) return 'cliff';
    const votes = {};
    for (const [ox, oz] of [[0, 0], [cell * 0.4, 0], [-cell * 0.4, 0], [0, cell * 0.4], [0, -cell * 0.4]]) {
      const zn0 = classifyPure(cx + ox, cz + oz);
      votes[zn0] = (votes[zn0] || 0) + 1;
    }
    let zn = Object.keys(votes).reduce((a, b) => (votes[b] > votes[a] ? b : a));
    if (zn === 'water') zn = slope > 0.28 ? 'bare' : 'green'; // 乾地不再露衛星；在面層級安全降級。
    if (slope > 0.28 && zn !== 'wet') zn = 'bare';
    // 沼澤(2)一律鋪濕地拼圖(取代舊「green 且 hC<2.2 且 minH<0.5」私規則 —— 與 envCode 統一)
    if (ec === 2) zn = 'wet';
    if ((zn === 'green' || zn === 'bare') && hC > alpineH) zn = 'alpine';
    return zn;
  };
  // 選款(顏色)的半段:zn = zoneGrid 預算分區 → 地表款名 / '!' / null。
  // **變體(花紋)不在這裡挑** —— 整張 subGrid 算完之後交 planCarpetVariants 逐格挑,
  // 才做得到「同顏色的相鄰拼圖花紋不同」(逐格獨立挑一定挑得出相鄰同款)。
  const cellSubAt = (i, j, zn) => {
    if (zn == null || zn === 'cliff') return zn;
    const cx = terrain.minX + (i + 0.5) * cell, cz = terrain.minZ + (j + 0.5) * cell;
    if (zn === 'water') {                               // 依水深配淺/深款(水深是物理量,逐格看)
      const wy = terrain.waterY;
      return wy != null && terrain.heightAt(cx, cz) < wy - 2.5 ? 'deepwater' : 'watertile';
    }
    // 多層次組合風格:被包在異類大區域裡的小區域換 enclave 專屬 carpet(唯一真相 ENCLAVE_STYLES)
    const list = encRt.get(encGrid[j * gnx + i])?.style.carpet || carpetLists[zn];
    if (!list) return null;
    // 取值點 = **選款區塊(lot)中心**而不是格心(carpetLotAt 單一縫,2026-08-12 使用者需求):
    // 同一個 lot 內恆為同一款 ⇒ 同一種地貌裡的顏色至少走過一個 lot(~6 格)才會換。
    // 場的公式一格未動(同一支 vnoise + 同一個準晶體項),換的只有「在哪裡取樣」。
    const [, , li, lj] = carpetLotAt(i, j, seed);
    const lx = terrain.minX + li * cell, lz = terrain.minZ + lj * cell;
    let t = (vnoise(lx * CARPET_SEL.W, lz * CARPET_SEL.W, seed) - 0.5) * CARPET_SEL.SPAN + 0.5;
    if (zn !== 'urban') t += qcVal(lx, lz, QC_SEL_W) * CARPET_SEL.QC_A;   // 不規律 zone 疊準晶體 → 群聚邊界非週期
    t = Math.min(0.999, Math.max(0, t));
    return list[(t * list.length) | 0];
  };
  // cell 幾何:3×3 貼地網格(邊中點 = 共用角點的中點 → 相鄰 cell 完全同點,水密;
  // ~半格取樣讓 cell 貼合地形起伏,丘頂不再戳穿底毯),頂點色 = wash
  // cut = { di, dj }(鄰格方向)⇒ 這一張外溢的 α 不取角點雙線性,改由 bdCutAt 以
  // 「到畫出來的分界線的帶號距離」決定(兩側地貌以線為界);查不到線才退回舊制淡出。
  // 貼地 3×3 面的發射核心。**2026-08-13 起只服務緩衝空間**(圖內底毯 / 外溢 / 脊帶改由
  // emitCell 認養地形三角形,見該處檔頭):界外站的是 terrain.js 那一圈裙,沒有高程網格
  // 可以認養 ⇒ 那半仍是「鋪一層皮」,照樣要 drapeSag 把弦虧損補回去(上限 SAG.BUF)。
  //   G  = 9 個 [x, z](3×3 排列,列沿 z、行沿 x)
  //   hAt = 取高度的函式 —— 緩衝空間走 terrain.bufferHeightAt(裙的外推高度唯一縫;
  //         拿 heightAt 會被夾回圖界,整圈底毯貼在錯誤的高度上)
  const emitFace = (bmap, key, G, hAt, alphas, st, cut) => {
    const sub = key.slice(0, key.indexOf('#'));
    const aq = !!DEFS[sub].aq;                          // 水生拼圖:免灘線淘汰、頂點夾到水面上(可見)
    let hs = G.map(([px, pz]) => hAt(px, pz));
    if (!aq && Math.min(...hs) < 0.45) return null;     // 岸際留空 = 灘線,不鋪下水
    if (aq && terrain.waterY != null) hs = hs.map((hh) => Math.max(hh, terrain.waterY + 0.05));
    const [aA, aB, aC, aD] = alphas || [1, 1, 1, 1];
    const AL = [aA, (aA + aB) / 2, aB,
                (aD + aA) / 2, (aA + aB + aC + aD) / 4, (aB + aC) / 2,
                aD, (aC + aD) / 2, aC];
    const uvS = DEFS[sub].uvS || 1 / 12;
    // 中間樣態脊帶(st.band)固定壓在其他外溢之上(0.108 仍 < fade 下限 0.110)—— 它是
    // 「疊在兩側淡出上的第三種地表」;一般外溢走每 key 微升差
    const lift = alphas ? (st?.band ? SLIFT + 0.008 : SLIFT + seamLift(key)) : CLIFT;
    const b = bucketOf(bmap, key);
    G.forEach(([px, pz], k) => {
      const w = wash(px, pz);
      let a = AL[k];
      // 切線優先且**逐頂點無條件覆寫**(不看角點權重):線可能自格子中間穿過,拿角點權重
      // 當閘門會讓「該換手卻權重為 0」的那半格留在原本的地貌上 = 滲透照樣發生
      const cutA = cut ? bdCutAt(px, pz, cut.di, cut.dj) : null;
      if (cutA != null) a = cutA;
      else if (alphas && a > 0 && a < 1) {
        // 交界頂點 α 塑形(seamAlpha 純函式,樣式 = 逐分區組合查表):明確邊界壓窄、
        // 柔和淡出疊碎形擾動、雪線推成斑塊。端點 α=0/1 恆定 ⇒ 與不透明底毯/淡出盡頭
        // 仍水密;純函數(世界座標+seed)⇒ 相鄰外溢格共用頂點同值不開縫(§2.3 零 rnd)
        a = seamAlpha(a, qcVal(px, pz, SEAM_QC_W), st);
      }
      b.pos.push(px, hs[k] + lift + drapeSag(hAt, px, pz), pz);
      b.nrm.push(0, 1, 0);
      pushLandN(b, hAt, px, pz, terrain.gridM);
      b.uv.push(px * uvS, pz * uvS);
      b.col.push(w, w, w, a);
    });
    for (let v = 0; v < 2; v++) {                       // 2×2 小格,面朝 +y
      for (let u = 0; u < 2; u++) {
        const a2 = b.base + v * 3 + u, e = a2 + 1, f = a2 + 3, g2 = f + 1;
        b.idx.push(a2, f, e, e, f, g2);
      }
    }
    b.base += 9;
    return G[4];
  };
  // 四角 → 3×3 排列(列沿 z、行沿 x):P0 E01 P1 / E30 M E12 / P3 E23 P2。
  // 邊中點 = 共用角點的中點 ⇒ 相鄰 cell 完全同點,拼面天生水密(圖內與緩衝空間同吃)
  const face9 = (P0, P1, P2, P3) => {
    const mid = (a2, b2) => [(a2[0] + b2[0]) / 2, (a2[1] + b2[1]) / 2];
    return [P0, mid(P0, P1), P1,
            mid(P3, P0), mid(mid(P0, P1), mid(P3, P2)), mid(P1, P2),
            P3, mid(P3, P2), P2];
  };
  // ==== 圖內底毯:認養地形三角形(2026-08-13 使用者定案「A 認養地形三角形」)====
  // 舊制底毯自己切一張 3×3 貼地網格,頂點取 heightAt ⇒ **頂點恆在地形上,而頂點與頂點之間
  // 是直的**;地形不是(逐格三角化的高度場,格線上有折角)。皮的邊長 ≈ 半個 cell(6.5m)
  // 而地形格距 8.5m ⇒ 幾乎每一條邊都橫跨折角,弦沉在地形下 = 使用者回報的「斜坡破圖」
  // (taroko 實測 22% 三角形被戳穿),SAG 那一層就是在補這件事。
  // 新制:**皮的三角形就是地形的三角形** —— 規劃層一行不動,只把「畫在哪些三角形上」改成
  // 逐地形四邊形認養主人格。共面 ⇒ 破圖恆為 0(是結構保證,不是「小於門檻」)。四條:
  //  ①**規劃層零改動**:cornerAt 抖動 / zoneGrid / subGrid / varGrid / planSeamOverlays 全部
  //    照舊 ⇒ lot 尺度、SEAM_QC_W、界線 run 長、BUF_CELL_F 那一票 cell 衍生常數一個都不用重調。
  //  ②**灘線閘仍以 face9 九點整格判**,MUST NOT 改成逐四邊形判:那一閘決定 landCells,而
  //    landCells 餵底毯細節撒佈 ⇒ 逐四邊形會多鋪半格、多撒幾株草,共享 rnd 序列整條推移(§2.3)。
  //  ③**圖內底毯 MUST NOT 再套 drapeSag**:頂點與三角形都已經是地形自己的,再抬就是**浮在
  //    地形上**,那同樣是破圖(SAG 檔頭 ⑤ 的同一條)。緩衝空間那一半站在裙上、沒有地形網格
  //    可認養,仍走 emitFace + SAG.BUF。
  //  ④**認養判定用 PNPOLY**(射線穿越數),MUST NOT 拿對角線拆成兩個三角形:抖動後的四邊形
  //    可以是凹的,對角線會跑到多邊形外 ⇒ 那一塊沒有主人、地形直接露出來,而畫面上只是偶爾
  //    一格禿掉。候選只掃 3×3(抖動 < 0.45 格 ⇒ 主人恆在其中;稽核以暴力搜尋逐格對照)。
  // 地形頂點數**推導不手寫**(terrain 只對外給 gridM = x 軸格距;z 軸格距要用 worldH 自己回推,
  // 非方形戰場兩軸不同)。
  const NTV = Math.round(terrain.worldW / terrain.gridM) + 1;
  const TGX = terrain.worldW / (NTV - 1), TGZ = terrain.worldH / (NTV - 1);
  const tvx = (a) => terrain.minX + a * TGX;
  const tvz = (b) => terrain.minZ + b * TGZ;
  // 切線帶內的細分數**推導不手寫**:子邊長 ≤ 半個 `BORDER_CUT.W` ⇒ α 的斜坡收得進換手帶。
  // 只作用在線真的穿過的那一排四邊形(見 emitCell),其餘一格未動。
  const CUT_SUB = Math.max(1, Math.ceil(Math.max(TGX, TGZ) / BORDER_CUT.W));
  const quadOf = (ti, tj) => [cornerAt(ti, tj), cornerAt(ti + 1, tj),
                              cornerAt(ti + 1, tj + 1), cornerAt(ti, tj + 1)];
  // PNPOLY:半開邊 ⇒ 落在兩格共用邊上的點恰有一個主人(不會兩格都畫或都不畫)
  const inQuad = (Q, px, pz) => {
    let inside = false;
    for (let a = 0, c = 3; a < 4; c = a++) {
      const zi = Q[a][1], zc = Q[c][1];
      if ((zi > pz) !== (zc > pz)
          && px < (Q[c][0] - Q[a][0]) * (pz - zi) / (zc - zi) + Q[a][0]) inside = !inside;
    }
    return inside;
  };
  // 反雙線性(P(u,v) = A + u·e + v·f + uv·g 的解):外溢 α 是給在**規劃格四角**的,而地形
  // 頂點落在格內任意位置。角上恆等 ⇒ 相鄰格共用的那顆地形頂點兩邊算出同一個 α,淡出不開縫。
  const invBil = (Q, px, pz) => {
    const [A, B, C, D] = Q;
    const ex = B[0] - A[0], ez = B[1] - A[1];
    const fx = D[0] - A[0], fz = D[1] - A[1];
    const gx = A[0] - B[0] + C[0] - D[0], gz = A[1] - B[1] + C[1] - D[1];
    const hx = px - A[0], hz = pz - A[1];
    const cr = (ax, az, bx, bz) => ax * bz - az * bx;
    const k2 = cr(gx, gz, fx, fz);
    const k1 = cr(ex, ez, fx, fz) + cr(hx, hz, gx, gz);
    const k0 = cr(hx, hz, ex, ez);
    // 給定 v 回 u:分母取兩軸絕對值大的那一個(另一軸可能剛好退化成 0)
    const uOf = (v) => {
      const dx = ex + gx * v, dz = ez + gz * v;
      const u = Math.abs(dx) > Math.abs(dz) ? (hx - fx * v) / dx : (hz - fz * v) / dz;
      return Number.isFinite(u) ? u : 0;
    };
    let v;
    if (Math.abs(k2) < 1e-9) {
      if (Math.abs(k1) < 1e-12) return [0, 0];
      v = -k0 / k1;
    } else {
      const w2 = k1 * k1 - 4 * k0 * k2;
      if (!(w2 >= 0)) return [0.5, 0.5];                 // 落在映射像之外(數值邊緣)⇒ 取格心
      const w = Math.sqrt(w2), ik2 = 0.5 / k2;
      v = (-k1 - w) * ik2;
      const u0 = uOf(v);
      if (u0 < -1e-6 || u0 > 1 + 1e-6 || v < -1e-6 || v > 1 + 1e-6) v = (-k1 + w) * ik2;
    }
    const u = uOf(v);
    return [Math.min(1, Math.max(0, u)), Math.min(1, Math.max(0, v))];
  };
  // 主人格 → 地形四邊形索引扁平表 [a0, b0, a1, b1, …](純函式、零 rnd,建一次共用)
  const cellQuads = new Array(gnx * gnz);
  let orphanQuads = 0;
  for (let b = 0; b < NTV - 1; b++) {
    const cz = tvz(b + 0.5), nj = Math.floor((cz - terrain.minZ) / cell);
    for (let a = 0; a < NTV - 1; a++) {
      const cx = tvx(a + 0.5), ni = Math.floor((cx - terrain.minX) / cell);
      let own = -1;
      for (let dj = -1; dj <= 1 && own < 0; dj++) {
        const tj = nj + dj;
        if (tj < 0 || tj >= gnz) continue;
        for (let di = -1; di <= 1; di++) {
          const ti = ni + di;
          if (ti < 0 || ti >= gnx) continue;
          if (inQuad(quadOf(ti, tj), cx, cz)) { own = tj * gnx + ti; break; }
        }
      }
      if (own < 0) { orphanQuads++; continue; }
      (cellQuads[own] || (cellQuads[own] = [])).push(a, b);
    }
  }
  // 這一格的底毯是不是貼水種類(切線細分的閘;subGrid 在下面才建,呼叫時早已定案)
  const cellAq = (ti, tj) => {
    const s = subGrid[tj * gnx + ti];
    return !!(s && s !== '!' && DEFS[s]?.aq);
  };
  const emitCell = (bmap, key, ti, tj, alphas, st, cut) => {
    const sub = key.slice(0, key.indexOf('#'));
    const aq = !!DEFS[sub].aq;                          // 水生拼圖:免灘線淘汰、頂點夾到水面上(可見)
    const Q = quadOf(ti, tj);
    const G = face9(Q[0], Q[1], Q[2], Q[3]);
    // ② 灘線閘:仍以整格九點判(landCells 與共享 rnd 序列逐位元同舊制)
    if (!aq && Math.min(...G.map(([px, pz]) => terrain.heightAt(px, pz))) < 0.45) return null;
    const quads = cellQuads[tj * gnx + ti];
    if (!quads) return null;
    const uvS = DEFS[sub].uvS || 1 / 12;
    // 中間樣態脊帶(st.band)固定壓在其他外溢之上(0.108 仍 < fade 下限 0.110)—— 它是
    // 「疊在兩側淡出上的第三種地表」;一般外溢走每 key 微升差
    const lift = alphas ? (st?.band ? SLIFT + 0.008 : SLIFT + seamLift(key)) : CLIFT;
    const wy = aq && terrain.waterY != null ? terrain.waterY + 0.05 : null;
    const b = bucketOf(bmap, key);
    const putQuad = (x0, x1, z0, z1) => {
      // 頂點序 (x,z)/(x+1,z)/(x,z+1)/(x+1,z+1),索引取**反對角線** —— 與 terrain.js 的
      // (a,c,b)(b,c,d) 逐字同向 ⇒ 兩張皮的三角形完全重合(共面的本錢在這一行)
      for (const [px, pz] of [[x0, z0], [x1, z0], [x0, z1], [x1, z1]]) {
        const w = wash(px, pz);
        let al = 1;
        if (alphas) {
          // 切線優先且**逐頂點無條件覆寫**(不看角點權重):線可能自格子中間穿過,拿角點權重
          // 當閘門會讓「該換手卻權重為 0」的那半格留在原本的地貌上 = 滲透照樣發生
          const cutA = cut ? bdCutAt(px, pz, cut.di, cut.dj) : null;
          if (cutA != null) al = cutA;
          else {
            const [u, v] = invBil(Q, px, pz);
            al = (1 - u) * (1 - v) * alphas[0] + u * (1 - v) * alphas[1]
               + u * v * alphas[2] + (1 - u) * v * alphas[3];
            // 交界頂點 α 塑形(seamAlpha 純函式,樣式 = 逐分區組合查表):明確邊界壓窄、
            // 柔和淡出疊碎形擾動、雪線推成斑塊。端點 α=0/1 恆定 ⇒ 與不透明底毯/淡出盡頭
            // 仍水密;純函數(世界座標+seed)⇒ 相鄰外溢格共用頂點同值不開縫(§2.3 零 rnd)
            if (al > 0 && al < 1) al = seamAlpha(al, qcVal(px, pz, SEAM_QC_W), st);
          }
        }
        const hy = terrain.heightAt(px, pz);
        b.pos.push(px, (wy != null ? Math.max(hy, wy) : hy) + lift, pz);
        b.nrm.push(0, 1, 0);
        pushLandN(b, terrain.heightAt, px, pz, terrain.gridM);
        b.uv.push(px * uvS, pz * uvS);
        b.col.push(w, w, w, al);
      }
      b.idx.push(b.base, b.base + 2, b.base + 1, b.base + 1, b.base + 2, b.base + 3);
      b.base += 4;
    };
    for (let n = 0; n < quads.length; n += 2) {
      const x0 = tvx(quads[n]), x1 = tvx(quads[n] + 1);
      const z0 = tvz(quads[n + 1]), z1 = tvz(quads[n + 1] + 1);
      // ---- 切線的解析度(2026-08-13 使用者「還是看到沙灘兩側都有海水」)----
      // 換手是**逐頂點**算的,而自 08-13 認養地形三角形之後頂點就是地形網格頂點(格距 8.5m)
      // ⇒ α 從 1 掉到 0 的斜坡實際寬度是**一整格**,不是 `BORDER_CUT.W`(2.8m)。水那一側的
      // 外溢因此一路淡進陸地將近十公尺,而它是貼水種類(頂點夾到水面)⇒ 讀起來就是
      // 「沙灘的陸側也有海水」。斜坡比帶還寬,帶再怎麼畫都蓋不住。
      // 修法:線真的穿過的那些四邊形細分到 ≤ 半個切線帶寬。**只細分穿過的那一排**
      // (四角 α 不全等)⇒ 其餘逐位元同舊制;而 `terrain.heightAt` 與地形網格是**同一組
      // 三角形內插**(sampleField 的 (a,c,b)/(b,c,d) 分割)⇒ 子頂點恆落在地形面上,
      // 共面一格未失、不會回頭長出貼合破圖。
      // **只給沾到水的那些外溢**:水藍 vs 陸綠是全場色差最大的一對,斜坡寬過帶就直接讀成
      // 「這一側也是水」;陸對陸(圍籬/樹籬/碎石徑那幾種)的兩款顏色相近,同樣寬的斜坡在
      // 畫面上讀不出來,而細分整份外溢層要多十倍的三角形(實測 buildBiomes 1.2 → 4.2s)。
      let div = 1;                                       // (MUST NOT 叫 sub —— 那是上面的地表名)
      if (cut && (aq || cellAq(ti, tj))) {
        const a4 = [[x0, z0], [x1, z0], [x0, z1], [x1, z1]]
          .map(([px, pz]) => bdCutAt(px, pz, cut.di, cut.dj));
        if (a4.some((v) => v !== a4[0])) div = CUT_SUB;
      }
      if (div === 1) { putQuad(x0, x1, z0, z1); continue; }
      for (let sj = 0; sj < div; sj++) {
        for (let si = 0; si < div; si++) {
          putQuad(x0 + (x1 - x0) * si / div, x0 + (x1 - x0) * (si + 1) / div,
                  z0 + (z1 - z0) * sj / div, z0 + (z1 - z0) * (sj + 1) / div);
        }
      }
    }
    return G[4];
  };
  // ==== 多層次地貌:整張 coarse 分區格網 → 小區域包裹判定(planEnclaves 唯一縫)====
  // encGrid[cell] = `${內}@${外}` 樣式鍵或 null;encRt = 樣式執行期物件(set = 該樣式
  // 允許的全部地表 —— tryPatch 放行閘,僅對 enclave 格生效,不讓樣式地表外漏到一般分區)
  const zoneGrid = new Array(gnx * gnz).fill(null);
  for (let j = 0; j < gnz; j++) for (let i = 0; i < gnx; i++) {
    const x = terrain.minX + (i + 0.5) * cell, z = terrain.minZ + (j + 0.5) * cell;
    zoneGrid[j * gnx + i] = surfaceField ? surfaceField.sample(x, z) : cellZoneAt(i, j);
  }
  const encGrid = surfaceField ? new Array(gnx * gnz).fill(null) : planEnclaves(zoneGrid, gnx, gnz, {});
  const encRt = new Map();
  for (const k in ENCLAVE_STYLES) {
    // 樣式的底毯清單同樣排成顏色路徑(carpetOrder;與 carpetLists 同一條規則)。原樣式物件
    // MUST NOT 就地改寫 —— ENCLAVE_STYLES 是模組級常數,改它等於這一場的排序漏到下一場
    const st = ENCLAVE_STYLES[k];
    const style = st.carpet ? { ...st, carpet: carpetOrder(st.carpet) } : st;
    encRt.set(k, { key: k, style, set: new Set([...(st.carpet || []), ...(st.feats || [])]) });
  }
  const encAt = (x, z) => {   // 世界座標 → enclave 執行期樣式(非 enclave = null;不吃 rnd)
    const i = Math.floor((x - terrain.minX) / cell), j = Math.floor((z - terrain.minZ) / cell);
    if (i < 0 || j < 0 || i >= gnx || j >= gnz) return null;
    const k = encGrid[j * gnx + i];
    return k ? encRt.get(k) : null;
  };

  // 底毯 = 兩段:先整張挑**顏色**(款;lot 量化 ⇒ 同地貌內顏色慢慢換),再整張挑**花紋**
  // (變體;逐格互異 ⇒ 同顏色的相鄰拼圖圖案不同)。兩支都是純函式,不動共享 rnd 序列。
  const subGrid = new Array(gnx * gnz).fill(null);
  for (let j = 0; j < gnz; j++) for (let i = 0; i < gnx; i++) subGrid[j * gnx + i] = cellSubAt(i, j, zoneGrid[j * gnx + i]);
  const varGrid = planCarpetVariants(subGrid, gnx, gnz, { seed, variants: CARPET_VARIANTS });
  const keys = new Array(gnx * gnz).fill(null);
  const landCells = [];                                 // [x, z, key]:底毯細節撒佈用
  if (!surfaceField) for (let j = 0; j < gnz; j++) {
    for (let i = 0; i < gnx; i++) {
      const sub = subGrid[j * gnx + i];
      if (!sub) continue;
      if (sub === 'cliff') { keys[j * gnx + i] = 'cliff'; continue; }
      const key = `${sub}#${varGrid[j * gnx + i]}`;
      const mid = emitCell(carpetBuckets, key, i, j, null);
      if (!mid) continue;
      keys[j * gnx + i] = key;
      landCells.push([mid[0], mid[1], key]);
    }
  }
  // ==== 緩衝空間的底毯(2026-08-12 使用者需求「邊界延伸不可進入的緩衝空間也要貼地貌拼圖」)====
  // 緩衝空間 = terrain.js 那一圈外緣裙(深度 terrain.bufferM,見該檔 ⑧);舊制它只有地形材質(影像鏡射
  // 平鋪 / 屬性場色階)⇒ 站在邊界往外看是「圖內鋪著拼圖、過了圖界突然變回一張照片」的硬界。
  // 五條:
  //  ①**分區與選款一律鏡射回圖內取**(與 terrain.js 裙的 UV 同一個三角波):鏡射在圖界上是
  //    恆等 ⇒ 接縫兩側取到同一格 = 同一款,再往外是這張圖自己的地貌翻過去又翻回來。界外沒有
  //    影像也沒有圖資,classifyPure 在那裡本來就沒有答案(§4 寧缺勿錯:不是猜一個,是照抄自己)。
  //  ②**格距放粗** BUF_CELL_F 倍:它離可玩區至少 `edgeWallInsetM()`、最遠 455m,細節看不到,
  //    而原尺寸鋪滿要多兩倍半的格子。
  //  ③**高度走 terrain.bufferHeightAt**(裙的外推高度唯一縫);取不到就整圈不鋪(降級不例外)。
  //  ④**只鋪底毯**:界線拼圖/特徵拼圖/3D 細節一律不進緩衝空間(看不到,而那些都要吃共享
  //    rnd 序列與空間索引)。底毯與**交界外溢**共用圖內那兩批 buckets ⇒ 一個 draw call 都沒有多。
  //  ⑤**零共享 rnd 消耗**(§2.3):整段純函式取值,插在哪裡都不推移植被佈局。
  //  ⑥**角點抖動 + 交界外溢照走** —— 少了這兩樣,粗格 + 硬邊就是一床方塊拼被(2026-08-12 實拍:
  //    站在邊界往外看是一片直角接直角的色塊,比舊制那張糊掉的衛星圖更假)。圖界那兩條線上的
  //    角點**不准抖**(那是與真地形的接縫,動了就開縫);外溢走的是圖內同一支 planSeamOverlays。
  let bufCells = 0;
  if (!surfaceField && terrain.bufferHeightAt) {
    const B = terrain.bufferM;   // 深度讀地形實際鋪的那一份(迷你地圖縮到 1/3;見 terrain.js ⑧)
    const bcell = cell * BUF_CELL_F;
    const nOut = Math.max(1, Math.ceil(B / bcell));
    // 三角波鏡射(同 terrain.js 裙):在 [lo, hi] 的兩端恆等 ⇒ 接縫逐點同款
    const mirror = (v, lo, hi) => {
      const span = hi - lo;
      if (!(span > 0)) return lo;
      const t = Math.abs(((v - lo) % (2 * span) + 2 * span) % (2 * span));
      return lo + (t <= span ? t : 2 * span - t);
    };
    // 非均勻軸:外帶(nOut 格粗格)+ 內域(照樣切成粗格,但整塊跳過 = 真地形的地盤)+ 外帶
    const axis = (lo, hi) => {
      const nin = Math.max(1, Math.ceil((hi - lo) / bcell)), a = [];
      for (let k = nOut; k > 0; k--) a.push(lo - (B * k) / nOut);
      for (let k = 0; k <= nin; k++) a.push(lo + ((hi - lo) * k) / nin);
      for (let k = 1; k <= nOut; k++) a.push(hi + (B * k) / nOut);
      return a;
    };
    const xs = axis(terrain.minX, terrain.maxX), zs = axis(terrain.minZ, terrain.maxZ);
    const bnx = xs.length - 1, bnz = zs.length - 1;
    const inX = bnx - nOut, inZ = bnz - nOut;            // 內域格索引 [nOut, in*)
    const BJ = bcell * 0.3;                              // 角點抖動幅度(< 半格 ⇒ 拓撲不翻面)
    const bcorner = (i, j) => [
      xs[i] + ((i === nOut || i === inX) ? 0 : (vnoise(i, j, (seed ^ 0x2AC1) | 0) - 0.5) * 2 * BJ),
      zs[j] + ((j === nOut || j === inZ) ? 0 : (vnoise(i, j, (seed ^ 0x5D31) | 0) - 0.5) * 2 * BJ)];
    const bFace = (i, j) => face9(bcorner(i, j), bcorner(i + 1, j), bcorner(i + 1, j + 1), bcorner(i, j + 1));
    const bkeys = new Array(bnx * bnz).fill(null);
    for (let j = 0; j < bnz; j++) {
      for (let i = 0; i < bnx; i++) {
        if (i >= nOut && i < inX && j >= nOut && j < inZ) continue;
        const mx = mirror((xs[i] + xs[i + 1]) / 2, terrain.minX, terrain.maxX);
        const mz = mirror((zs[j] + zs[j + 1]) / 2, terrain.minZ, terrain.maxZ);
        const ki = Math.min(gnx - 1, Math.max(0, Math.floor((mx - terrain.minX) / cell)));
        const kj = Math.min(gnz - 1, Math.max(0, Math.floor((mz - terrain.minZ) / cell)));
        const key = keys[kj * gnx + ki];
        if (!key || key === '!') continue;               // 圖內那一格沒鋪(崖/灘線/灰帶)⇒ 界外也不鋪
        if (!emitFace(carpetBuckets, key, bFace(i, j), terrain.bufferHeightAt, null, null, null)) continue;
        bkeys[j * bnx + i] = key;
        bufCells++;
      }
    }
    // 交界外溢:走圖內同一支規劃器(單一縫)—— 沒有它,粗格之間就是硬邊直角
    for (const ov of planSeamOverlays(bkeys, bnx, bnz, { coarseOf: coarseOfKey, seed, variants: VARIANTS })) {
      emitFace(ov.st?.band ? bandBuckets : spillBuckets, ov.key, bFace(ov.i, ov.j),
               terrain.bufferHeightAt, ov.alphas, ov.st, null);
    }
  }
  // ==== 地貌界線拼圖:規劃 + 空間索引(2026-08-11)====
  // 規劃 MUST 排在**底毯之後、外溢與特徵拼圖之前** —— 三個消費端全吃這一份(單一縫):
  //   ①外溢切線 bdCutAt(兩側地貌恰以線為界)
  //   ②特徵拼圖與 3D 細節的迴避 bdCross(田/停車場/球場/擺件不得橫跨分界線)
  //   ③幾何發射(下方「地貌界線拼圖發射」區塊)
  // planBorderPuzzle 是純函式(零 rnd)⇒ 提前呼叫不動共享 rnd 序列(§2.3);tryPatch 的
  // bdCross 拒絕與 roadClear 同位,排在首個 rnd() 之前 ⇒ 散布序列的紀律不變。
  const coarseOf = (key) => (key && key !== '!') ? coarseOfKey(key) : null;
  const bdSubOf = (k) => { const p = k.indexOf('#'); return p < 0 ? k : k.slice(0, p); };
  // 半寬取型錄真值;flat 再乘上帶緣起伏的最外緣 ⇒ 讓路取樣與迴避半徑恆蓋得住真的畫出來的邊
  const hwOfKind = (k) => {
    const d = BORDER_KINDS[k];
    return Math.max(d.flat ? d.flat.w / 2 * (1 + BORDER_BAND.EDGE_A) : 0, d.ridge ? d.ridge.w / 2 : 0);
  };
  const bdPlan = surfaceField ? { chains: [], corners: [], forks: [] } : planBorderPuzzle(keys, gnx, gnz, {
    // 地貌取**格子自己的分區**(zoneGrid,與底毯選款同一份),不由款式反查
    zoneOf: (i, j) => zoneGrid[j * gnx + i],
    coarseOf, cornerXZ: cornerAt, driftMax: cell * 0.6,
    halfWidthOf: hwOfKind, runMinM: cell * BORDER_BAND.RUN_MIN_CELL,
  });
  // 中心線段空間索引:存**退縮前**的端點 —— 那才是完整連續的界線曲線(退縮只是把接頭那一小段
  // 空間讓給轉彎/岔路拼圖,界線並沒有斷)。逐段沿線走訪、每個取樣點連 3×3 鄰格一起登記 ⇒
  // 查詢只掃自己那一格,而半徑 ≤ BSC 的東西保證找得到。
  const BSC = Math.max(24, cell * 2);
  const BD_HW_MAX = Math.max(...Object.keys(BORDER_KINDS).map(hwOfKind));   // 最寬的一種(掃描格數用)
  const bdGrid = new Map();
  for (const ch of bdPlan.chains) {
    for (const tl of ch.tiles) {
      const sg = { x0: tl.x0, z0: tl.z0, x1: tl.x1, z1: tl.z1, hw: hwOfKind(tl.kind) };
      const dx = sg.x1 - sg.x0, dz = sg.z1 - sg.z0;
      const n = Math.max(1, Math.ceil(Math.hypot(dx, dz) / (BSC * 0.5)));
      const seenC = new Set();
      for (let s = 0; s <= n; s++) {
        const ci = Math.floor((sg.x0 + dx * s / n) / BSC), cj = Math.floor((sg.z0 + dz * s / n) / BSC);
        for (let oj = -1; oj <= 1; oj++) {
          for (let oi = -1; oi <= 1; oi++) {
            const gk = `${ci + oi},${cj + oj}`;
            if (seenC.has(gk)) continue;
            seenC.add(gk);
            let arr = bdGrid.get(gk);
            if (!arr) { arr = []; bdGrid.set(gk, arr); }
            arr.push(sg);
          }
        }
      }
    }
  }
  // 掃過查詢半徑覆蓋到的每一格。**格數 MUST 由半徑推導**:索引只保證「段附近一圈」的格子
  // 有它,而拼圖的迴避半徑(足跡 + 帶半寬 + PAD)可以到 45m 遠大於一格 —— 只掃自己那一格
  // 的話,大塊水田的中心離線 30m 就查不到那條線,而它的角早就壓在帶上了(2026-08-11 實測)
  const bdEach = (x, z, R, fn) => {
    const n = Math.ceil(R / BSC);
    const ci = Math.floor(x / BSC), cj = Math.floor(z / BSC);
    for (let dj = -n; dj <= n; dj++) {
      for (let di = -n; di <= n; di++) {
        const l = bdGrid.get(`${ci + di},${cj + dj}`);
        if (l) for (const sg of l) fn(sg);
      }
    }
  };
  const bdSegD = (sg, x, z) => {
    const dx = sg.x1 - sg.x0, dz = sg.z1 - sg.z0, l2 = dx * dx + dz * dz || 1;
    let t = ((x - sg.x0) * dx + (z - sg.z0) * dz) / l2;
    t = t < 0 ? 0 : t > 1 ? 1 : t;
    return Math.hypot(sg.x0 + dx * t - x, sg.z0 + dz * t - z);
  };
  // 迴避:半徑 r 的足跡與任何分界線帶(含帶緣起伏 + PAD 淨距)相交即擋下
  const bdCross = (x, z, r) => {
    let hit = false;
    bdEach(x, z, r + BD_HW_MAX + BORDER_BAND.PAD, (sg) => {
      if (!hit && bdSegD(sg, x, z) < r + sg.hw + BORDER_BAND.PAD) hit = true;
    });
    return hit;
  };
  // ---- 分界線帶內不觸發地形異常狀態(2026-08-13 使用者定案)----
  // 「確保水域/沼澤在分界線的區塊內不會觸發異常狀態」。成因是**兩條線從來沒有對齊過**:
  // 權威的水沼分類(terrainEnvCode)量的是真實地形高程與衛星影像,而底毯的換手在**畫出來的
  // 那條線**上(borderCut),那條線是格邊鏈拉直後的弦、最寬的一種帶(沙灘)有 9m ⇒ 兩者
  // 最多可以差半個帶寬。畫面上你站在沙灘/泥灘/小溪的圖案上,伺服器算的卻是「泡在水裡」——
  // 涉水凍結與陷沼扣血就在這裡冒出來,而每一條既有斷言都是綠的。
  // 修法 = 帶內一律當乾地(比照 `terrain.inDryBand` 兵線外接帶那一層,同樣是「這一塊強制乾」)。
  // 三條:
  //  ①**純幾何、(x,z) 的純函式**:只問「離任何一段界線中心線的垂距 ≤ 該種類的帶半寬嗎」,
  //    半寬取 `hwOfKind`(= 真的畫出來的外緣,含帶緣起伏)⇒ 遮罩恰好蓋住圖案,不多不少;
  //  ②**寧缺勿錯往「不觸發」偏**:規劃出來但發射時被讓路規則(道路/建物)剔掉的那幾段仍在
  //    索引裡 ⇒ 那裡沒畫帶卻也不觸發。反過來(畫了帶卻照樣扣血)才是使用者回報的症狀;
  //  ③**MUST 在 buildBiomes 之外才裝上去**(見 biomes.js 的清空 + main.js 的安裝點):底毯
  //    分區自己就吃 terrainEnvCode,建圖期就掛上等於「界線改變分區 → 分區改變界線」的循環,
  //    而症狀是同一張圖每次建出來都不一樣。
  //  ④遮罩要活到戰鬥結束 ⇒ MUST 走**模組層**工廠(`makeBandMask`):在 buildGroundCover 裡
  //    寫一個閉包的話,V8 會把整個函式作用域的 context 一起留住(底毯 buckets、細節清單、
  //    landCells…幾十 MB),而畫面上什麼都看不出來(A25 的同一條)。
  const bandDryAt = makeBandMask(bdGrid, BSC, BD_HW_MAX);
  // 底毯切線:頂點落在「鄰格那一側」多遠 → borderCutAlpha。側別由**鄰格方向**判(格索引差),
  // 不拿鄰格中心點去比 —— 拉直後的弦可能自格子中間穿過,拿點比會整格翻面
  const bdCutAt = (x, z, di, dj) => {
    let best = null, bd = cell * BORDER_CUT.R_F;
    bdEach(x, z, bd, (sg) => { const d = bdSegD(sg, x, z); if (d < bd) { bd = d; best = sg; } });
    if (!best) return null;
    const ex = best.x1 - best.x0, ez = best.z1 - best.z0;
    const nb = ex * dj - ez * di;                        // 鄰格方向落在線的哪一側
    if (!nb) return null;
    const vs = ex * (z - best.z0) - ez * (x - best.x0);  // 這個頂點落在哪一側
    const sgn = (vs >= 0) === (nb > 0) ? 1 : -1;
    // 切線本身不必筆直:沿世界座標的低頻擾動(純函式,相鄰格共用頂點恆同值)
    return borderCutAlpha(sgn * bd + BORDER_CUT.JIT * (vnoise(x * 0.19, z * 0.19, seed ^ 0x2B0D) - 0.5) * 2,
                          BORDER_CUT.W);
  };

  // 異類交界(含對角)外溢:角點隸屬度雙線性淡出 —— 配置全住 planSeamOverlays
  // (純函式,稽核執行原文;舊制單向整格外溢的鋸齒病灶見該函式檔頭),此處只發幾何。
  // 兩側對稱互溢 + 對角補角 ⇒ 交界中線 = 50/50 混色的平滑等值線,90° 階梯縫消失。
  // 交界樣式逐分區組合查表(明確/柔和/斑塊/中間過渡帶,SEAM_STYLES);中間樣態脊帶
  // 進獨立 bandBuckets(固定壓在兩側淡出之上,renderOrder 見 mesh 段)。
  // hardOf = 「這一對畫得出分界線嗎」(規則仍只有 borderKindOf 一份):畫得出來就改走切線,
  // 中間過渡脊帶也不出 —— 那條橫跨界線的第三種地表正是「沒有正確分隔兩側地貌」的一半成因。
  const bdHard = (k0, kn, i, j, ni, nj) => !!borderKindOf(
    bdSubOf(k0), bdSubOf(kn), zoneGrid[j * gnx + i], zoneGrid[nj * gnx + ni]);
  for (const ov of planSeamOverlays(keys, gnx, gnz,
      { coarseOf: coarseOfKey, seed, variants: VARIANTS, hardOf: bdHard })) {
    emitCell(ov.st?.band ? bandBuckets : spillBuckets, ov.key, ov.i, ov.j, ov.alphas, ov.st, ov.cut);
  }

  // ---- 特徵拼圖登錄:不疊置(邊緣小比例交疊)+ 視野內同款不重複 ----
  const MAXRE = 26;                       // 最大有效半徑(SIZE 上限 × RSCALE)
  const PCELL = 64;                       // 疊置查詢空間網格(交疊半徑 ≤ ~50m)
  const pGrid = new Map();                // `${i},${j}` -> [{x,z,re}]:疊置檢查
  const keyPos = new Map();               // 'sub#variant' -> [{x,z}]:同款反重複
  // 有效半徑:rect 以等面積圓近似(半寬 × √aspect),blob 直接用 r
  const rEffOf = (def, r) => def.shape === 'rect' ? r * Math.sqrt(def.aspect || 0.7) : r;
  // 廣相搜尋半徑:**外接**半徑的上界(推導,MUST NOT 手寫)—— 等面積半徑 MAXRE 不夠,
  // 一塊長條球場的角比它的等面積圓遠 15%,漏掉就等於沒判
  const MAXRC = Math.max(...Object.keys(SIZE).map((s) => {
    const d = DEFS[s];
    if (!d) return 0;
    const rr = (SIZE[s][0] + SIZE[s][1]) * RSCALE;
    return rr * (d.shape === 'rect' ? Math.hypot(1, d.aspect || 0.7) : (BLOB_R.MIN + BLOB_R.JIT));
  }));
  const overlapPs = (x, z, re, foot, isInk) => {
    const R = Math.max((re + MAXRE) * INK_SEP_F, foot.r + MAXRC + PATCH_GAP);
    const i0 = Math.floor((x - R) / PCELL), i1 = Math.floor((x + R) / PCELL);
    const j0 = Math.floor((z - R) / PCELL), j1 = Math.floor((z + R) / PCELL);
    for (let j = j0; j <= j1; j++) {
      for (let i = i0; i <= i1; i++) {
        const arr = pGrid.get(`${i},${j}`);
        if (!arr) continue;
        for (const p of arr) {
          // 任一方是功能性區塊 ⇒ 量**真實足跡**零重疊(rect 有向盒 / blob 外接圓);
          // 自然類彼此才走圓近似的邊緣互融
          if (isInk || p.ink) { if (footNear(foot, p.foot, PATCH_GAP)) return true; continue; }
          const dx = p.x - x, dz = p.z - z, rr = (re + p.re) * SEP_F;
          if (dx * dx + dz * dz < rr * rr) return true;
        }
      }
    }
    return false;
  };
  const usedNear = (x, z, key) => {
    const arr = keyPos.get(key);
    if (!arr) return false;
    for (const p of arr) {
      const dx = p.x - x, dz = p.z - z;
      if (dx * dx + dz * dz < VIS_R * VIS_R) return true;
    }
    return false;
  };
  // 功能性區塊(ink)專屬索引:3D 物件的「不得站進別人的區塊」逐件都要查一次 ⇒
  // 用比 PCELL 細的格,查詢只掃一格(拿 pGrid 的 64m 格逐次掃 3×3 會是每個擺件近百次比對)
  const ICELL = 32;
  const iGrid = new Map();
  const regPatch = (x, z, re, key, ink, foot) => {
    const gk = `${Math.floor(x / PCELL)},${Math.floor(z / PCELL)}`;
    let arr = pGrid.get(gk);
    if (!arr) { arr = []; pGrid.set(gk, arr); }
    arr.push({ x, z, re, ink, foot });   // ink = 規律結構拼圖(edge:'ink'):邊界物件避開其覆蓋範圍
    if (ink) {
      const i0 = Math.floor((x - foot.r) / ICELL), i1 = Math.floor((x + foot.r) / ICELL);
      const j0 = Math.floor((z - foot.r) / ICELL), j1 = Math.floor((z + foot.r) / ICELL);
      for (let j = j0; j <= j1; j++) {
        for (let i = i0; i <= i1; i++) {
          const ik = `${i},${j}`;
          let l = iGrid.get(ik);
          if (!l) { l = []; iGrid.set(ik, l); }
          l.push(foot);
        }
      }
    }
    let ps = keyPos.get(key);
    if (!ps) { ps = []; keyPos.set(key, ps); }
    ps.push({ x, z });
  };
  // ---- 3D 物件:互不重疊 + 不站進別人的功能性區塊 ----
  const DCELL = 6;
  const dGrid = new Map();          // 已擺放的 3D 物件足跡(圓)
  const DET_R_MAX = Math.max(...Object.keys(DETAIL_DEFS).map(detailR)) * 2;   // 廣相上界(含實例放大)
  let curInk = null;                // 正在撒細節的那一塊功能性區塊(它自己的擺件當然站得上去)
  const detFree = (px, pz, dr) => {
    const R = dr + DET_R_MAX + DET_GAP;
    const i0 = Math.floor((px - R) / DCELL), i1 = Math.floor((px + R) / DCELL);
    const j0 = Math.floor((pz - R) / DCELL), j1 = Math.floor((pz + R) / DCELL);
    for (let j = j0; j <= j1; j++) {
      for (let i = i0; i <= i1; i++) {
        const l = dGrid.get(`${i},${j}`);
        if (!l) continue;
        for (const o of l) {
          const rr = dr + o.r + DET_GAP;
          if ((o.x - px) ** 2 + (o.z - pz) ** 2 < rr * rr) return false;
        }
      }
    }
    const il = iGrid.get(`${Math.floor(px / ICELL)},${Math.floor(pz / ICELL)}`);
    if (il) {
      const me = { x: px, z: pz, r: dr };
      for (const f of il) if (f !== curInk && footNear(me, f, 0)) return false;
    }
    return true;
  };
  const detPut = (px, pz, dr) => {
    const gk = `${Math.floor(px / DCELL)},${Math.floor(pz / DCELL)}`;
    let l = dGrid.get(gk);
    if (!l) { l = []; dGrid.set(gk, l); }
    l.push({ x: px, z: pz, r: dr });
  };
  // 自雜訊指定變體起輪替,回傳視野內未用的變體;全數用罄回 -1(改試其他地表)
  const freeVariant = (sub, x, z, v0) => {
    for (let k = 0; k < VARIANTS; k++) {
      const v = (v0 + k) % VARIANTS;
      if (!usedNear(x, z, `${sub}#${v}`)) return v;
    }
    return -1;
  };

  // ---- 農田叢集:「組合夠大片才加田埂」(2026-08-13 使用者定案)----
  // 一塊孤田圍一圈埂讀起來像花壇 ⇒ 田埂**不是逐塊的屬性,是叢集的屬性**。開一本帳把同一次
  // 遞迴(或同一條路的沿街陣列)裡的農田塊記下來,收工時才決定畫不畫 —— 門檻 BUND.MIN_N。
  // 帳本身零 rnd(只是記帳),畫不畫也不影響任何淘汰閘 ⇒ 共享 rnd 序列與佈局一格未動。
  const bundBuckets = new Map();
  let farmCluster = null;
  const withCluster = (fn) => {
    const prev = farmCluster;
    farmCluster = [];
    const out = fn();
    if (farmCluster.length >= BUND.MIN_N) {
      const b = bucketOf(bundBuckets, 'fieldbund');
      // 弦長傳 `BUND.SEG_M`(埂自己的取樣間距)不是底毯的 cell/2 —— 見 SAG 檔頭 ⑥:
      // 拿 6.5m 的弦虧損去抬 3m 的弦就是「凸太多」的來源
      for (const p of farmCluster) emitBund(b, terrain, p.x, p.z, p.r, p.rot, p.def, p.lift + 0.004,
                                            (px, pz) => drapeSag(terrain.heightAt, px, pz, BUND.SEG_M));
    }
    farmCluster = prev;
    return out;
  };

  // ---- 單塊 patch:檢查 → 幾何 → 細節 → 家族延伸(遞迴,同族異款毗鄰)----
  const tryPatch = (x, z, sub, variant, r, rot, depth) => {
    if (placed >= target) return false;
    if (x < terrain.minX + inb || x > terrain.maxX - inb || z < terrain.minZ + inb || z > terrain.maxZ - inb) return false;
    if (isBlocked(x, z)) return false;
    if (roadClear?.(x, z)) return false;   // 道路走廊上不鋪特徵拼圖(免細節件戳穿路面);與 isBlocked 同位、首個 rnd() 前 = 確定性不變
    const zn = zoneAt(x, z);
    const enc = encAt(x, z);
    // 類型必須與所在圖資分區相符;enclave 格內另放行該組合樣式的地表(公園拼圖只准落在
    // 「市區內的小綠地」格上,不會因此漏到整片綠地 —— 放行閘只看 encAt 命中的格)
    if (!subZones.get(sub)?.has(zn) && !enc?.set.has(sub)) return false;
    const def = DEFS[sub];
    // 田/停車場/球場…一律不得橫跨分界線(2026-08-11 使用者定案)。理由不只是「線被蓋住」——
    // 規律結構的 lift(.135↑)本來就高過帶(.126~.134)⇒ 它會**整片壓在界線上**;而一塊
    // 橫跨界線的水田同時也是「一側地貌滲透到另一側」。擋在這裡而不是讓界線讓路:界線是
    // 地貌的分界(結構),拼圖是點綴。半徑取**外接**(rect 的角落比 r 遠:半寬 r × 半深
    // r·aspect ⇒ 用 r 會讓角壓上帶緣)。與 roadClear 同位 = 首個 rnd() 之前,確定性紀律不變
    if (bdCross(x, z, def.shape === 'rect' ? r * Math.hypot(1, def.aspect || 0.7)
                                           : r * (BLOB_R.MIN + BLOB_R.JIT))) return false;
    // 坡度/水面檢查:整塊落在陸地、高差在容許內(田與球場要平)
    let mn = Infinity, mx = -Infinity;
    for (const [ox, oz] of [[0, 0], [r, 0], [-r, 0], [0, r], [0, -r]]) {
      const h = terrain.heightAt(x + ox, z + oz);
      if (h < mn) mn = h;
      if (h > mx) mx = h;
    }
    if ((mn < 0.45 && !def.aq) || mx - mn > r * def.slope) return false;   // 水生拼圖(marsh/lotus/魚塭)可貼岸線
    for (const bl of blockers) {
      const dx = x - bl.x, dz = z - bl.z, rr = bl.r + r * 0.7;
      if (dx * dx + dz * dz < rr * rr) return false;
    }
    // 拼圖不疊置。**功能性區塊(ink)量真實足跡零重疊**(含陣列 tile 與家族延伸 —— 舊制
    // 的 `depth === 0` 把它們排除在外,於是沿街格陣與農田拼布之間可以互切);自然類彼此
    // 才走圓近似的邊緣互融(fade 邊互融是刻意的)
    const rEff = rEffOf(def, r);
    const foot = def.shape === 'rect'
      ? { x, z, hw: r, hd: r * (def.aspect || 0.7), ry: rot, r: r * Math.hypot(1, def.aspect || 0.7) }
      : { x, z, r: r * (BLOB_R.MIN + BLOB_R.JIT) };
    if (overlapPs(x, z, rEff, foot, def.edge === 'ink')) return false;

    // 圖層優先(使用者定):規律(ink)疊不規律(fade)之上;規律再依所對齊道路分級抬高(大馬路>小馬路),
    // 整體仍 < 道路 0.18。rank 為決定性查詢(不吃 rnd);每分支恰一枚 rnd。ink_min .135 > fade_max .124 恆成立。
    let lift;
    if (def.edge === 'ink') {
      const rk = roadRank ? (roadRank(x, z) ?? 0) : 0;
      lift = 0.135 + rk * 0.033 + rnd() * 0.004;
    } else {
      lift = 0.110 + rnd() * 0.014;
    }
    const pt = [0.88 + rnd() * 0.24, 0.88 + rnd() * 0.24, 0.88 + rnd() * 0.24];   // 每塊色調抖動
    const b = bucketOf(buckets, `${sub}#${variant}`);
    const patchSag = (px, pz) => drapeSag(terrain.heightAt, px, pz);
    if (def.shape === 'rect') emitRect(b, terrain, x, z, r, rot, def, lift, pt, rnd() < 0.5, rnd() < 0.5, rnd, patchSag);
    else emitBlob(b, terrain, x, z, r, lift, def.uvS, def.edge, pt, rnd, patchSag);
    regPatch(x, z, rEff, `${sub}#${variant}`, def.edge === 'ink', foot);
    placed++;
    if (BUND_SUBS.has(sub)) farmCluster?.push({ x, z, r, rot, def, lift });   // 田埂帳(收工才決定畫不畫)

    // curInk = 這一塊自己的足跡:它自己的擺件當然站得上去(球場的籃球架/加油站的油槍),
    // 擋的是**別人的**擺件走進來。家族延伸在 scatterDetails 之後才遞迴 ⇒ 還原後再往下走
    const prevInk = curInk;
    curInk = def.edge === 'ink' ? foot : null;
    scatterDetails(sub, x, z, r, rot, def, zn, enc);
    curInk = prevInk;

    // 家族延伸:農田拼布 / 運動園區 / 綠地群落(rect 沿軸毗鄰、blob 邊緣淡接);
    // 每鄰塊經 freeVariant 換款 → 拼布連片但視野內無同款重複
    if (def.fam && depth < 2 && rnd() < 0.65) {
      const k = 1 + (rnd() * 2 | 0);
      for (let i = 0; i < k; i++) {
        const sub2 = rnd() < 0.7 ? sub : FAMS[def.fam][(rnd() * FAMS[def.fam].length) | 0];
        const def2 = DEFS[sub2];
        if (def2.shape !== def.shape) continue;
        let nx2, nz2, r2, rot2;
        if (def.shape === 'rect') {
          // 沿本塊局部軸擺到正鄰位(間留 FARM_GAP 小路),同 rot → 田字拼布。
          // **鄰塊尺寸依毗鄰軸反解**(2026-08-13 使用者「田與田之間沒有整齊對準」):
          //   側向毗鄰 ⇒ 共用的是**長邊** ⇒ 深度要一樣 ⇒ r2 = r × aspect ÷ aspect2;
          //   前後毗鄰 ⇒ 共用的是**短邊** ⇒ 寬度要一樣 ⇒ r2 = r。
          // 舊制兩種情形都取 r2 = r,於是 aspect 不同的鄰款(水田 0.7 / 茶園 0.8 / 溫室 0.6)
          // 側向毗鄰時長邊差了 14~33% —— 畫面上就是「兩塊田沒對齊」。
          // 兩枚 rnd 的順序與枚數逐位元同舊制(先毗鄰軸、後方向)。
          const as1 = def.aspect || 0.7, as2 = def2.aspect || 0.7;
          const side = rnd() < 0.5, sgn = rnd() < 0.5 ? 1 : -1;
          r2 = side ? r * as1 / as2 : r;
          const [ox, oz] = side ? [(r + r2 + FARM_GAP) * sgn, 0]
                                : [0, (r * as1 + r2 * as2 + FARM_GAP) * sgn];
          const ca = Math.cos(rot), sa = Math.sin(rot);
          nx2 = x + ox * ca - oz * sa; nz2 = z + ox * sa + oz * ca; rot2 = rot;
        } else {
          r2 = (SIZE[sub2][0] + rnd() * SIZE[sub2][1]) * RSCALE;
          const th = rnd() * Math.PI * 2, dist = (r + r2) * 0.86;   // 邊緣小比例交疊:fade 邊互融(> SEP_F)
          nx2 = x + Math.cos(th) * dist; nz2 = z + Math.sin(th) * dist;
          rot2 = orient(nx2, nz2, def2.reg, true);   // 鄰塊各自依整齊度擲骰(rect 拼布已同 rot 延伸)
        }
        const v2 = freeVariant(sub2, nx2, nz2, variant);
        if (v2 >= 0) tryPatch(nx2, nz2, sub2, v2, r2, rot2, depth + 1);
      }
    }
    return true;
  };

  // ---- 3D 細節(表面特徵輪廓)----
  // zn = 所在分區:同物件跨地貌形式不同(雜草/花/灌木 — 綠地大面積密集、
  // 市區/裸露地零星;貨櫃/太陽能板 — 裸露地大陣列、市區零星單件)
  function scatterDetails(sub, x, z, r, rot, def, zn, enc = null) {
    const w = r * 2, dp = r * 2 * (def.aspect || 0.7);
    const ca = Math.cos(rot), sa = Math.sin(rot);
    const atLocal = (lx, lz) => [x + lx * ca - lz * sa, z + lx * sa + lz * ca];
    // 數量隨 patch 面積縮放(大 patch 不再顯得稀疏)+ 每次呼叫再抖 ±40%;
    // 散佈型態每 patch×型別隨機:cluster 群聚(1~3 簇)/ ring 沿緣 / uniform 均勻
    const kMul = Math.min(3, Math.max(0.7, (r / ((SIZE[sub]?.[0] || 9) * RSCALE)) ** 1.6));
    const scatter = (type, k, s0, sv, tintPick = null) => {
      k = Math.max(1, Math.round(k * kMul * (0.55 + rnd() * 1.1)));   // 數量抖動 ±55%
      const mode = rnd();
      let centers = null, arc0 = 0, arcSpan = Math.PI * 2;
      if (mode < 0.3) {
        centers = [];
        const nC = 1 + (rnd() * 3 | 0);
        for (let c = 0; c < nC; c++) centers.push([(rnd() - 0.5) * r * 1.1, (rnd() - 0.5) * r * 1.1]);
      } else if (mode < 0.45) {                        // ring 改隨機弧段:C 形/半圈,不再恆整圈
        arc0 = rnd() * Math.PI * 2; arcSpan = Math.PI * (0.5 + rnd() * 1.5);
      }
      for (let i = 0; i < k; i++) {
        let px, pz;
        if (centers) {                                 // cluster:簇心 + 高斯狀聚攏
          const [ox, oz] = centers[(rnd() * centers.length) | 0];
          const rr = r * 0.3 * rnd(), th = rnd() * Math.PI * 2;
          px = x + ox + Math.cos(th) * rr; pz = z + oz + Math.sin(th) * rr;
        } else if (mode < 0.45) {                      // ring:沿 patch 邊緣的隨機弧段
          const rr = r * (0.55 + rnd() * 0.35), th = arc0 + rnd() * arcSpan;
          px = x + Math.cos(th) * rr; pz = z + Math.sin(th) * rr;
        } else {                                       // uniform:面積均勻
          const rr = r * 0.75 * Math.sqrt(rnd()), th = rnd() * Math.PI * 2;
          px = x + Math.cos(th) * rr; pz = z + Math.sin(th) * rr;
        }
        const tint = tintPick ? tintPick[(rnd() * tintPick.length) | 0] : null;
        const [jpx, jpz] = qcNudge(px, pz);           // 準晶體 blue-noise 位移:去叢聚/去重複,純函數不動 rnd 序列
        addDetail(type, jpx, jpz, s0 + rnd() * sv, tint);
      }
    };
    // 對齊列陣:沿 patch 局部軸整齊排列;ry=-rot 使 3D 件與貼圖行列同向
    // (atLocal 的平面旋轉正向 = three.js rotation.y 的負向);格位/朝向微抖不豆腐格
    const rows = (type, stepX, stepZ, mX, mZ, cap, skip, tintPick = null, s0 = 1, sv = 0) => {
      let k = 0;
      const jx = stepX * 0.18, jz = stepZ * 0.18;
      // 列陣隨機起點相位:同款場地的排列位置塊塊互異
      const px0 = (rnd() - 0.5) * stepX * 0.6, pz0 = (rnd() - 0.5) * stepZ * 0.6;
      for (let lz = -dp * mZ + pz0; lz <= dp * mZ && k < cap; lz += stepZ) {
        for (let lx = -w * mX + px0; lx <= w * mX && k < cap; lx += stepX) {
          if (rnd() < skip) continue;
          const [px, pz] = atLocal(lx + (rnd() - 0.5) * jx, lz + (rnd() - 0.5) * jz);
          const tint = tintPick ? tintPick[(rnd() * tintPick.length) | 0] : null;
          addDetail(type, px, pz, s0 + rnd() * sv, tint, 1, -rot + (rnd() - 0.5) * 0.1);
          k++;
        }
      }
    };
    if (sub === 'turf' || sub === 'lawn') {
      scatter('tuft', 3 + (rnd() * 4 | 0), 0.7, 0.6);
      // 雜草/花:綠地大面積密集,市區草坪只零星幾叢
      scatter('weed', zn === 'green' ? 7 + (rnd() * 5 | 0) : 2, 0.7, 0.5);
      if (zn === 'green' || rnd() < 0.4) scatter('flower', zn === 'green' ? 5 : 2, 0.7, 0.4, FLOWER_C);
    }
    else if (sub === 'meadow') { scatter('miscanthus', 9 + (rnd() * 7 | 0), 0.9, 0.7); scatter('tuft', 4, 1.0, 0.7); scatter('weed', 4, 0.7, 0.5); }
    else if (sub === 'bushfield') { scatter('bush', 5 + (rnd() * 4 | 0), 0.8, 0.9); scatter('tuft', 3, 0.7, 0.5); scatter('weed', 3, 0.7, 0.4); }
    else if (sub === 'flowerfield') { scatter('flower', 12 + (rnd() * 8 | 0), 0.8, 0.6, FLOWER_C); scatter('tuft', 4, 0.6, 0.4); scatter('weed', 3, 0.6, 0.4); }
    else if (sub === 'orchard') {
      let k = 0;                                  // 果樹成行成列(局部軸網格 + 微抖)
      for (let lz = -r * 0.7; lz <= r * 0.7 && k < 14; lz += 5) {
        for (let lx = -r * 0.7; lx <= r * 0.7 && k < 14; lx += 5) {
          if (rnd() < 0.2) continue;
          const [px, pz] = atLocal(lx + (rnd() - 0.5) * 1.4, lz + (rnd() - 0.5) * 1.4);
          addDetail('sapling', px, pz, 0.9 + rnd() * 0.5);
          k++;
        }
      }
    } else if (sub === 'teafield') scatter('tuft', 2, 0.5, 0.3);
    else if (sub === 'veggiefield') { rows('cabbage', 1.7, 2.4, 0.4, 0.34, 36, 0.15, null, 0.8, 0.5); if (rnd() < 0.5) scatter('fencepost', 3 + (rnd() * 3 | 0), 0.9, 0.3); }
    // 牧場:圍籬樁沿緣 + 牧草叢 + 秋收草捲(貼圖畫的是俯視圓餅,3D 這一份給它厚度)
    else if (sub === 'pasture') {
      scatter('fencepost', 6 + (rnd() * 4 | 0), 1, 0.3);
      scatter('tuft', 7 + (rnd() * 5 | 0), 0.8, 0.6);
      scatter('weed', 3, 0.6, 0.4);
      if (rnd() < 0.55) scatter('hay', 1 + (rnd() * 2 | 0), 0.9, 0.4);
    }
    else if (sub === 'paddy') {
      let k = 0;                                  // 秧苗列:沿田塊軸向整齊插秧
      for (let lz = -dp * 0.32; lz <= dp * 0.32 && k < 34; lz += 2.6) {
        for (let lx = -w * 0.38; lx <= w * 0.38 && k < 34; lx += 2.8) {
          if (rnd() < 0.15) continue;
          const [px, pz] = atLocal(lx, lz);
          addDetail('rice', px, pz, 0.8 + rnd() * 0.4);
          k++;
        }
      }
    } else if (sub === 'dryfield') {
      if (rnd() < 0.6) scatter('hay', 1 + (rnd() < 0.3 ? 1 : 0), 0.8, 0.5);
      scatter('pebble', 2, 0.5, 0.5);
    } else if (sub === 'gravel') {
      scatter('pebble', 6 + (rnd() * 6 | 0), 0.5, 0.9);
      // 落石堆:大岩塊 + 岩板聚成一簇(自邊坡崩落的散置感)
      if (rnd() < 0.3) { scatter('boulder', 2 + (rnd() * 3 | 0), 0.8, 0.7); scatter('rockflat', 2, 0.7, 0.5); }
      scatter('weed', 2, 0.6, 0.4);
    }
    else if (sub === 'wild') {
      scatter('pebble', 3, 0.5, 0.8); scatter('tuft', 3, 0.6, 0.4); scatter('drybush', 2, 0.7, 0.5);
      if (rnd() < 0.35) scatter('boulder', 1, 0.7, 0.5);
      if (rnd() < 0.25) { scatter('boulder', 2 + (rnd() * 2 | 0), 0.8, 0.6); scatter('rockflat', 2, 0.6, 0.5); }   // 落石堆
      scatter('weed', 2 + (rnd() * 2 | 0), 0.7, 0.4); scatter('miscanthus', 2, 0.8, 0.5);   // 裸露地飄逸雜草(零星)
      if (rnd() < 0.15) scatter('flower', 1, 0.6, 0.3, FLOWER_C);   // 荒地零星野花
    }
    // 沙地:小石頭 + 貝殼 + 零星乾草(2026-08-13 使用者「沙地的小石頭,以此類推」——
    // 舊制只有一種點綴,一整片沙地上就是同一顆石頭複製貼上)
    else if (sub === 'sand') { scatter('pebble', 4 + (rnd() * 3 | 0), 0.7, 1.1); scatter('shell', 3 + (rnd() * 3 | 0), 0.8, 0.6); if (rnd() < 0.5) scatter('drybush', 1, 0.6, 0.4); }
    else if (sub === 'mud' || sub === 'crackedearth') { scatter('pebble', 2, 0.5, 0.4); scatter('weed', 2, 0.6, 0.3); if (sub === 'crackedearth') scatter('drybush', 1, 0.6, 0.4); else scatter('reed', 2, 0.6, 0.4); }
    else if (sub === 'redsoil') { scatter('pebble', 2, 0.5, 0.4); scatter('tuft', 1, 0.5, 0.3); scatter('weed', 1, 0.6, 0.3); }
    // 沼澤:蘆葦 + 草叢 + 漂流木 + 淺水的魚(舊制只有蘆葦)
    else if (sub === 'marsh') { scatter('reed', 8 + (rnd() * 6 | 0), 0.8, 0.6); scatter('tuft', 3, 0.6, 0.5); if (rnd() < 0.4) scatter('log', 1, 0.7, 0.3); scatter('fish', 2, 0.7, 0.4); }
    else if (sub === 'lotus') { scatter('lotuspad', 12 + (rnd() * 8 | 0), 0.8, 0.8); scatter('reed', 4, 0.7, 0.5); scatter('fish', 3 + (rnd() * 3 | 0), 0.8, 0.5); }
    else if (sub === 'watertile') {   // 淺水點綴依包裹情境換樣(deepwater 全空;det 住 ENCLAVE_STYLES):
      // 市區埤塘/滯洪池 = 公園感荷葉;綠地天然湖 = 濃密蘆葦岸;荒漠湧泉 = 稀疏蘆葦;其餘零星蘆葦
      const det = enc?.style.det;
      if (det === 'pond') { scatter('lotuspad', 6 + (rnd() * 5 | 0), 0.8, 0.7); if (rnd() < 0.5) scatter('reed', 2, 0.8, 0.4); }
      else if (det === 'lake') scatter('reed', 4 + (rnd() * 4 | 0), 0.8, 0.6);
      else if (det === 'spring') { if (rnd() < 0.6) scatter('reed', 1 + (rnd() * 2 | 0), 0.8, 0.5); }
      else if (rnd() < 0.35) scatter('reed', 2 + (rnd() * 3 | 0), 0.8, 0.5);
      // 游魚(2026-08-13 使用者「水域的游魚」):水深不足的格子由 addDetail 的 DIVE 閘擋下
      // ⇒ 淺灘不會出現半截插在泥裡的魚,這裡照常抽數量(§2.3 序列不因地形而分岔)
      scatter('fish', 3 + (rnd() * 4 | 0), 0.8, 0.5);
    }
    // 深水:只有游魚(舊制一片全空;蘆葦荷葉在深水本來就不該有)
    else if (sub === 'deepwater') scatter('fish', 4 + (rnd() * 4 | 0), 0.9, 0.6);
    // — 綠地擴充 —
    // 林地地被再加一種:朽木旁的菇(2026-08-13「以此類推」)
    else if (sub === 'arrowbamboo') { scatter('bamboo', 9 + (rnd() * 6 | 0), 0.8, 0.6); scatter('tuft', 3, 0.6, 0.4); scatter('mushroom', 3, 0.7, 0.5); }
    else if (sub === 'deadwood') { scatter('snag', 5 + (rnd() * 4 | 0), 0.8, 0.7); scatter('log', 2, 0.7, 0.4); scatter('pebble', 2, 0.5, 0.4); scatter('mushroom', 4, 0.7, 0.5); }
    else if (sub === 'fallenlogs') { scatter('log', 7 + (rnd() * 5 | 0), 0.8, 0.7); scatter('stump', 2, 0.8, 0.4); scatter('tuft', 3, 0.6, 0.4); scatter('mushroom', 4, 0.8, 0.5); }
    else if (sub === 'clearcut') { scatter('stump', 8 + (rnd() * 6 | 0), 0.8, 0.5); scatter('log', 2, 0.7, 0.4); }
    else if (sub === 'lumberyard') { rows('logpile', 4.2, 3.4, 0.3, 0.28, 7, 0.2, null, 0.9, 0.4); scatter('plank', 2 + (rnd() * 3 | 0), 0.8, 0.4); scatter('crate', 1, 0.9, 0.3); }
    else if (sub === 'rottencabin') { addDetail('cabin', x, z, 0.85 + rnd() * 0.35); scatter('fencepost', 5 + (rnd() * 3 | 0), 0.9, 0.3); scatter('bush', 3, 0.6, 0.5); }
    else if (sub === 'vineyard') rows('vinerow', 3.4, 3.0, 0.36, 0.32, 16, 0.12, null, 0.9, 0.3);
    else if (sub === 'greenhouse') rows('ghouse', 3.8, 3.2, 0.3, 0.3, 10, 0.08, null, 1.1, 0.4);
    // — 裸露地/高地擴充 —
    else if (sub === 'deadforest') { scatter('charsnag', 6 + (rnd() * 5 | 0), 0.8, 0.8); scatter('pebble', 2, 0.4, 0.4); scatter('stump', 2, 0.7, 0.4); scatter('drybush', 2, 0.6, 0.4); }
    else if (sub === 'slabruin') { scatter('slab', 7 + (rnd() * 5 | 0), 0.8, 0.6); scatter('pebble', 4, 0.5, 0.6); scatter('boulder', 1, 0.6, 0.4); }
    else if (sub === 'steppe') { scatter('miscanthus', 6 + (rnd() * 4 | 0), 0.9, 0.7); scatter('tuft', 4, 0.9, 0.6); scatter('drybush', 3, 0.7, 0.5); scatter('weed', 3, 0.7, 0.4); scatter('pebble', 1, 0.5, 0.4); }
    else if (sub === 'abandonedfarm') { scatter('tuft', 4, 0.7, 0.5); scatter('drybush', 2, 0.7, 0.4); scatter('fencepost', 3, 0.9, 0.3); if (rnd() < 0.4) scatter('hay', 1, 0.7, 0.3); }
    else if (sub === 'saltpan') scatter('saltmound', 4 + (rnd() * 3 | 0), 0.7, 0.5);
    else if (sub === 'quarry') { scatter('rockflat', 4, 0.9, 0.8); scatter('spoil', 1 + (rnd() * 2 | 0), 0.8, 0.6); scatter('boulder', 1 + (rnd() * 2 | 0), 0.7, 0.5); }
    else if (sub === 'plateau') { scatter('rockflat', 3 + (rnd() * 3 | 0), 0.8, 0.7); scatter('boulder', 1, 0.7, 0.5); scatter('tuft', 3, 0.6, 0.4); }
    else if (sub === 'icefield') { scatter('iceshard', 6 + (rnd() * 5 | 0), 0.7, 0.8); scatter('pebble', 1, 0.4, 0.4); if (rnd() < 0.5) scatter('boulder', 1, 0.6, 0.4); }
    else if (sub === 'scree') { scatter('pebble', 9 + (rnd() * 7 | 0), 0.5, 0.9); scatter('rockflat', 3, 0.7, 0.6); scatter('boulder', 1, 0.6, 0.5); }
    // — 市區擴充 —
    else if (sub === 'construction') { scatter('pipe', 1 + (rnd() * 2 | 0), 0.9, 0.4); scatter('spoil', 1 + (rnd() * 2 | 0), 0.8, 0.5); scatter('barrier', 3, 0.9, 0.3); scatter('plank', 1, 0.8, 0.3); scatter('drum', 2, 0.9, 0.2, DRUM_C); scatter('crate', 1, 0.9, 0.3); }
    else if (sub === 'gasstation') {
      addDetail('canopy', x, z, 1 + rnd() * 0.2, null, 1, -rot);   // 中柱雨棚 + 兩座加油機
      for (const lx of [-1.4, 1.4]) {
        const [px, pz] = atLocal(lx, 0);
        addDetail('pump', px, pz, 1, PUMP_C[(rnd() * PUMP_C.length) | 0], 1, -rot);
      }
      scatter('drum', 2, 0.9, 0.2, DRUM_C);
    }
    else if (sub === 'park') { scatter('sapling', 4 + (rnd() * 3 | 0), 0.9, 0.5); scatter('bench', 1 + (rnd() * 2 | 0), 0.9, 0.2); scatter('flower', 8, 0.7, 0.5, FLOWER_C); scatter('tuft', 3, 0.6, 0.4); if (rnd() < 0.5) scatter('planter', 1 + (rnd() * 2 | 0), 0.9, 0.2); }
    else if (sub === 'plaza') { scatter('bench', 2 + (rnd() * 2 | 0), 0.9, 0.2); scatter('planter', 2 + (rnd() * 2 | 0), 0.9, 0.2); if (rnd() < 0.4) scatter('billboard', 1, 0.9, 0.15, AD_C); }
    else if (sub === 'concrete' || sub === 'pavement' || sub === 'brick') {   // 市區空地:偶發街道家具,不再一片全空
      if (rnd() < 0.4) scatter('bench', 1, 0.9, 0.2);
      if (rnd() < 0.3) scatter('drum', 1, 0.9, 0.2, DRUM_C);
      if (rnd() < 0.3) scatter('crate', 1, 0.9, 0.3);
      // 市區綠意/招牌:盆栽/灌木/零星樹/廣告看板(全零星,不成片)
      if (rnd() < 0.35) scatter('planter', 1 + (rnd() * 2 | 0), 0.9, 0.2);
      if (rnd() < 0.3) scatter('bush', 1 + (rnd() * 2 | 0), 0.7, 0.4);
      if (rnd() < 0.25) scatter('sapling', 1, 0.9, 0.3);
      if (rnd() < 0.22) scatter('billboard', 1, 0.9, 0.15, AD_C);
      if (rnd() < 0.3) scatter('flower', 2, 0.7, 0.3, FLOWER_C);
      if (rnd() < 0.3) scatter('weed', 2, 0.6, 0.3);   // 縫隙雜草(市區零星)
      // 貨櫃/太陽能板:市區零星單件(裸露地才是大面積陣列)
      if (rnd() < 0.15) scatter('container', 1, 0.9, 0.2, CONTAINER_C);
      if (rnd() < 0.12) scatter('solarpanel', 1, 0.9, 0.2);
    }
    else if (sub === 'court') {   // 球場附件:兩端籃球架(沿場地軸向、面朝場心)+ 場邊長凳
      for (const e of [-1, 1]) {
        const [px, pz] = atLocal(0, dp * 0.42 * e);
        addDetail('hoop', px, pz, 1, null, 1, -rot + (e > 0 ? Math.PI : 0));
      }
      if (rnd() < 0.6) scatter('bench', 1 + (rnd() * 2 | 0), 0.9, 0.2);
    }
    else if (sub === 'scrapyard') { scatter('carwreck', 4 + (rnd() * 3 | 0), 0.9, 0.4, CAR_C); scatter('drum', 2, 0.9, 0.2, DRUM_C); scatter('crate', 1, 0.9, 0.3); scatter('pipe', 1, 0.7, 0.3); scatter('pebble', 2, 0.5, 0.4); scatter('weed', 3, 0.6, 0.4); }
    // 貨櫃/太陽能板陣列:裸露地大面積密排,市區(僅家族延伸殘留)小陣列
    else if (sub === 'containeryard') { rows('container', 4.0, 2.6, 0.4, 0.36, zn === 'bare' ? 26 : 12, zn === 'bare' ? 0.15 : 0.25, CONTAINER_C, 0.9, 0.3); scatter('crate', 2, 0.9, 0.3); }
    else if (sub === 'cemetery') { rows('headstone', 2.2, 2.6, 0.36, 0.3, 24, 0.25, null, 0.9, 0.3); scatter('sapling', 1, 0.9, 0.3); }
    else if (sub === 'solarfarm') rows('solarpanel', 3.0, 2.8, 0.4, 0.36, zn === 'bare' ? 32 : 18, 0.08, null, 0.9, 0.2);
    // — 濕地擴充 —
    else if (sub === 'fishpond') { scatter('reed', 6, 0.7, 0.4); scatter('fish', 4 + (rnd() * 4 | 0), 0.8, 0.5); }
  }

  // ==== 沿街連續規律陣列(2026-07-25 使用者需求「規律拼貼順著道路整齊排列」)====
  // 規律結構型(ink rect、reg≥ARR_MINREG:停車場/球場/太陽能板/稻田/農田…)沿道路兩側(法線偏移讓開
  // 路面)鋪成連續等尺寸格陣,朝向鎖道路角、同陣列共 rot ⇒ 無接歪。決定性:錨點沿 roadPolys(geocache
  // 定案、跨客戶端同序)以固定步距推進;變體走決定性輪替。tryPatch depth=2 ⇒ 無家族延伸、overlapPs 走
  // SEP_F(陣列 tile 相接不重疊,獨立結構才對它們全分離)。無道路圖資 → 不鋪(規律型退回主迴圈隨機散佈)。
  const ARR_MINREG = 0.7;
  const arrayable = new Set(Object.keys(DEFS).filter(
    (s) => DEFS[s].edge === 'ink' && DEFS[s].shape === 'rect' && (DEFS[s].reg || 0) >= ARR_MINREG));
  const arrPools = {};
  for (const zn in zoneLists) arrPools[zn] = zoneLists[zn].filter((s) => arrayable.has(s));
  const layRegularArrays = () => {
    if (!roadPolys?.length) return;
    const ARR_MARGIN = 3, ARR_GAP = 1.6, ARR_DEPTH = 2, ARR_MINSTEP = 28, ARR_FREQ = 0.004;
    const arrCap = Math.round(target * 0.55);            // 陣列最多吃 55% 配額,其餘留主迴圈填不規律
    const dropAt = (px, pz, a, hw, station) => {
      const zn = zoneAt(px, pz);
      const enc = encAt(px, pz);
      // enclave 內只鋪該組合樣式的規律結構(公園裡不長一般市區停車陣列);樣式無可陣列型 → 空推進
      const pool = enc
        ? (enc.arr ??= (enc.style.feats || []).filter((s) => arrayable.has(s)))
        : arrPools[zn];
      if (!pool || !pool.length) return ARR_MINSTEP;     // 水域/高地/無候選 → 空推進
      const t = Math.min(0.999, Math.max(0, (vnoise(px * ARR_FREQ, pz * ARR_FREQ, seed ^ 0x1A77) - 0.5) * 2 + 0.5));
      const sub = pool[(t * pool.length) | 0], def = DEFS[sub];
      const r = SIZE[sub][0] * RSCALE;                   // 固定半徑(不抖):同陣列等尺寸才對齊
      const d = 2 * r * (def.aspect || 0.7);
      const stepA = 2 * r + ARR_GAP, stepP = d + ARR_GAP, off0 = hw + ARR_MARGIN + d / 2;
      const ca = Math.cos(a), sa = Math.sin(a), nx = -sa, nz = ca;   // 道路法線
      for (let side = -1; side <= 1; side += 2) {
        for (let c = 0; c < ARR_DEPTH; c++) {
          if (placed >= arrCap) return stepA;
          const off = off0 + c * stepP;
          const tx = px + nx * side * off, tz = pz + nz * side * off;
          const variant = (station * 2 + c * 3 + (side > 0 ? 1 : 0)) % VARIANTS;   // 決定性變體輪替(同陣列不死板同款)
          if (tryPatch(tx, tz, sub, variant, r, a, 2)) arraysN++;   // depth=2:鎖路向、無家族延伸、overlapPs 走 SEP_F
        }
      }
      return stepA;
    };
    for (const [pts, hw] of roadPolys) {
      if (placed >= arrCap) break;
      // 一條路 = 一本田埂帳:沿街連續格陣本來就是「夠大片的組合」,而它與主迴圈的家族延伸
      // 是兩條互不相干的產線 ⇒ 各記各的(外層 `placed >= arrCap` 仍是唯一的收手閘,
      // 內層改為只結束這條路,語意與舊制的 return 相同)
      withCluster(() => {
        let carry = 0, station = 0;
        for (let si = 1; si < pts.length; si++) {
          const x0 = pts[si - 1][0], z0 = pts[si - 1][1];
          const dx = pts[si][0] - x0, dz = pts[si][1] - z0, segLen = Math.hypot(dx, dz);
          if (segLen < 1e-3) continue;
          const ux = dx / segLen, uz = dz / segLen, a = Math.atan2(dz, dx);
          let dcur = carry;
          while (dcur < segLen) {
            if (placed >= arrCap) return;
            dcur += dropAt(x0 + ux * dcur, z0 + uz * dcur, a, hw, station++);
          }
          carry = dcur - segLen;                         // 跨段連續推進(街廓不因節點斷開)
        }
      });
    }
  };
  layRegularArrays();

  // ---- 不規律主散佈:準晶體點陣候選 + tryPatch(近路規律型讓給沿街陣列)----
  // 候選由均勻 rnd 改「準晶體全循環走訪」(去格化 blue-noise、非週期不重複);保留完整 zone 清單內層重試,
  // 分區仍走純圖資分類(球場只落市區、水田只落綠地…)。qStride⊥nCells ⇒ 走訪為雙射(每格恰訪一次)。
  const qcArea = terrain.worldW * terrain.worldH;
  const qs = Math.max(18, Math.min(40, Math.sqrt(qcArea / Math.max(1, target * 4))));
  const QC_PT_W = (2 * Math.PI) / (qs * 1.7);
  const qcPoint = (cx, cz) => { const [gx, gz] = qcGrad(cx, cz, QC_PT_W); return [cx + gx * qs * 0.42, cz + gz * qs * 0.42]; };
  const nqx = Math.ceil(terrain.worldW / qs), nqz = Math.ceil(terrain.worldH / qs);
  const nCells = nqx * nqz;
  const gcd = (m, n) => { while (n) { const t = m % n; m = n; n = t; } return m; };
  let qStride = Math.max(1, Math.round(nCells * 0.61803));   // 黃金步幅、與 nCells 互質 ⇒ 全循環雙射走訪
  while (gcd(qStride, nCells) !== 1) qStride++;
  const qOff = (seed >>> 0) % Math.max(1, nCells);
  for (let a = 0; a < nCells && placed < target; a++) {
    const idx = (qOff + a * qStride) % nCells;
    const gi = idx % nqx, gj = (idx / nqx) | 0;
    const cx = terrain.minX + (gi + 0.5) * qs, cz = terrain.minZ + (gj + 0.5) * qs;
    const [qx, qz] = qcPoint(cx, cz);
    const x = qx + (rnd() - 0.5) * qs * 0.2;              // 固定 2 枚 rnd(破殘餘對稱;淘汰前抽 = 序列穩定)
    const z = qz + (rnd() - 0.5) * qs * 0.2;
    // enclave 內主散佈改抽該組合樣式的 feats 池(水域 enclave 無 feats → 照舊走 zoneLists 淘汰)
    const encM = encAt(x, z);
    const zones = encM?.style.feats?.length ? encM.style.feats : zoneLists[zoneAt(x, z)];
    if (!zones) continue;
    const t = Math.min(0.999, Math.max(0, (vnoise(x * 0.006, z * 0.006, seed) - 0.5) * 2.2 + 0.5));
    const zi = (t * zones.length) | 0;
    const v0 = Math.min(VARIANTS - 1, (vnoise(x * 0.0025, z * 0.0025, seed ^ 0x7E11) * VARIANTS) | 0);
    for (let s = 0; s < zones.length; s++) {
      const sub = zones[(zi + s) % zones.length];
      if (roadPolys?.length && arrayable.has(sub) && roadDirAt?.(x, z) != null) continue;   // 近路規律型 → 已交陣列
      const v = freeVariant(sub, x, z, v0);
      if (v < 0) continue;
      const r = (SIZE[sub][0] + rnd() * SIZE[sub][1]) * RSCALE;
      // 一次遞迴 = 一本田埂帳(root + 家族延伸的全部後代 = 這一片農田拼布)
      if (withCluster(() => tryPatch(x, z, sub, v, r, orient(x, z, DEFS[sub].reg, true, DEFS[sub].edge === 'ink'), 0))) break;
    }
  }

  // ---- 底毯細節:剩餘配額撒進大片空地(準晶體疏密,不留隨機禿斑;仍避開兵線走廊/建物)----
  detCap = MAX_DETAIL;
  const remain = MAX_DETAIL - detCount;
  if (remain > 60 && landCells.length) {
    const pDet = Math.min(0.3, remain / (landCells.length * 5));
    const CAR_QC_W = (2 * Math.PI) / (cell * 3);
    for (const [cx2, cz2, key] of landCells) {
      if (detCount >= MAX_DETAIL) break;
      const q = 0.5 + 0.5 * qcVal(cx2, cz2, CAR_QC_W);     // [0,1] 準晶體疏密調變(峰密谷疏,去隨機禿斑)
      if (rnd() >= pDet * (0.35 + 1.3 * q)) continue;       // 先抽 1 枚;E[0.35+1.3q]=1 ⇒ 總量不變
      const sub = key.slice(0, key.indexOf('#'));
      scatterDetails(sub, cx2, cz2, cell * 0.55, rnd() * Math.PI * 2, DEFS[sub], zoneAt(cx2, cz2), encAt(cx2, cz2));
    }
  }

  // ---- 底毯 Mesh(不透明,墊在最底)+ 外溢 Mesh(透明淡出)+ 中間樣態脊帶 Mesh
  //      (透明,壓在外溢之上),皆先於特徵/特效繪製 ----
  for (const [bmap, pass] of [[carpetBuckets, 0], [spillBuckets, 1], [bandBuckets, 2]]) {
    for (const [key, b] of bmap) {
      if (!b.idx.length) continue;
      const [sub, v] = key.split('#');
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.Float32BufferAttribute(b.pos, 3));
      geo.setAttribute('normal', new THREE.Float32BufferAttribute(b.nrm, 3));
      geo.setAttribute('uv', new THREE.Float32BufferAttribute(b.uv, 2));
      geo.setAttribute('color', new THREE.Float32BufferAttribute(b.col, 4));
      setLandN(geo, b);
      geo.setIndex(b.idx);
      // 有四季設計的地表**跳過**季節濾鏡:畫筆已經畫成那個季節了,再乘一層 = 調兩次色
      const tint = DEFS[sub].green && !DEFS[sub].seasonal ? (SEASON_TINT[season] ?? 0xffffff) : 0xffffff;
      const m = new THREE.Mesh(geo, envMat(tint, {
        map: groundTex(sub, +v, false, season),
        vertexColors: true, wash: 0.5, cool: 0.5, rim: 0,   // 貼地面關 rim:掠射角全開會把遠處洗白
        transparent: pass > 0,   // 外溢/脊帶靠頂點 alpha 淡出;depthWrite 保持 true
        landNrm: true,           // 地貌類別 + 真地形法線(見 landNrmAt 那一段)
      }));
      // 外溢在透明佇列裡必須早於特徵 patch / 特效(renderOrder 0)繪製,
      // 否則 depthWrite 會把後畫的底層擋掉出現描圈破洞。
      // 同佇列內再依 seamLift 同一雜湊排序(低者先畫)⇒ 異 key 外溢互疊時
      // 高者後蓋、深度不互吃,混色連續且決定性(範圍 [-2, -1.3] 仍恆 < 0);
      // 中間樣態脊帶 -1.2:恆在全部外溢之後、特徵層之前(與 lift 0.108 同序)
      if (pass === 1) m.renderOrder = -2 + seamLift(key) * 100;
      else if (pass === 2) m.renderOrder = -1.2;
      m.frustumCulled = false;
      m.userData.noOutline = true;
      // 冒煙測試識別標記(同特徵拼圖的 gsub/gvar 慣例):截圖工具據此認出「這一格是哪種地表」
      m.userData.gsub = sub; m.userData.gvar = +v;
      m.userData.glayer = pass === 0 ? 'carpet' : pass === 1 ? 'spill' : 'band';
      group.add(m);
    }
  }

  // ==== 地貌界線拼圖發射(2026-08-11 使用者需求;取代 2026-07-24 邊界遮蔽物)====
  // 配置全住 planBorderPuzzle(純函式單一縫:16 方向直線/轉彎/岔路、種類解析 borderKindOf、
  // 接力切點共用、'!'/null 不成界),這裡只發幾何:
  //   flat 種類 = 貼地紋理帶(透明;lift 帶 [0.126, 0.134] 介於不規律 fade 上限 0.124 與
  //   規律 ink 下限 0.135 之間、renderOrder ∈ [-1.1, -1.05] 恆晚於脊帶 -1.2 早於特徵層 0);
  //   ridge 種類 = 梯形脊(沿用舊遮蔽物的幾何語彙;接續端各外延半寬 → 轉角互搭無楔縫)。
  // 與地被同契約:純視覺、無碰撞、不描邊、不進 raycast(空地照常通行)。
  // 道路/兵線淨空/規律結構拼圖優先 —— 沿 tile 密取樣任一點命中即整片跳過(鏈斷口兩端
  // alpha 收尾 = 步道讓路給馬路);貼水種類(aq)頂點夾到水面上,其餘不下水。
  // 決定性只吃 seed + 節點索引雜湊(零共享 rnd,§2.3)⇒ 佈局不變、跨客戶端一致。
  {
    bStat = { planned: 0, drawn: 0, forks: 0, forksDrawn: 0 };
    const ehash = (a, b, c) => {
      let n = (Math.imul(a | 0, 374761393) ^ Math.imul(b | 0, 668265263) ^ Math.imul(c | 0, 2246822519) ^ seed) | 0;
      n = Math.imul(n ^ (n >>> 13), 1274126177);
      return ((n ^ (n >>> 16)) >>> 0) / 4294967296;
    };
    const snB = ENV.seasons[season] || ENV.seasons.summer;
    // 規律結構拼圖(edge:'ink' 球場/停車場/農田/廣場…)覆蓋範圍:分界線一律避開,不切穿
    // 整齊區塊(2026-07-25 使用者回報「球場/停車場上放邊界拼圖很亂」的裁決沿用)。
    const onRegular = (x, z) => {
      const R = MAXRE * SEP_F;
      const i0 = Math.floor((x - R) / PCELL), i1 = Math.floor((x + R) / PCELL);
      const j0 = Math.floor((z - R) / PCELL), j1 = Math.floor((z + R) / PCELL);
      for (let jj = j0; jj <= j1; jj++) for (let ii = i0; ii <= i1; ii++) {
        const arr = pGrid.get(`${ii},${jj}`);
        if (!arr) continue;
        for (const p of arr) if (p.ink && (p.x - x) ** 2 + (p.z - z) ** 2 < p.re * p.re) return true;
      }
      return false;
    };
    const wy = terrain.waterY;
    // 配置吃上面就規劃好的那一份(bdPlan;底毯切線與拼圖迴避是同一份 = 單一縫),
    // 接頭退縮量由**真實帶寬**推導(hwOfKind:型錄是唯一真相,MUST NOT 手寫公尺數)
    const plan = bdPlan;
    const bKinds = Object.keys(BORDER_KINDS);
    const bLift = (kind) => 0.126 + bKinds.indexOf(kind) * 0.0008;  // 異種類互疊(接力/岔路)不共面
    // 帶紋理一輪的世界長:寬帶配長節距(推導,MUST NOT 手寫固定公尺)—— 固定 9m 會把
    // 9m 寬的沙灘壓成 1:1 而 3.6m 的步道橫向拉扁 2.5×,圖案就讀不出是什麼了
    const bTexL = (kd) => Math.max(BORDER_BAND.TEX_MIN, kd.w * BORDER_BAND.TEX_F);
    const flatB = new Map(), ridgeB = new Map();
    const bkOf = (m, kind, uv) => {
      let b = m.get(kind);
      if (!b) {
        // flat(貼地紋理帶)吃 aLandN;ridge(立體脊)的法線是**真的**,不需要也不准換
        b = uv ? { pos: [], nrm: [], uv: [], col: [], idx: [], base: 0, lnrm: [] } : { pos: [], nrm: [], idx: [], base: 0 };
        m.set(kind, b);
      }
      return b;
    };
    const gY = (px, pz, aq) => {
      const h = terrain.heightAt(px, pz);
      return aq && wy != null ? Math.max(h, wy + 0.05) : h;
    };
    // 讓路判定唯一縫:道路走廊 / 兵線淨空 / 規律結構拼圖 / 不下水。
    // **直段與接頭吃同一支** —— 接頭只驗節點那一個點的話,轉彎圓弧掃過的那一塊完全沒驗到,
    // 分界線就會橫過馬路(道路的圖層本來就在分界線之上,但那只保證被蓋住,不保證不該畫)。
    // onRegular 自 2026-08-11 起是**保險絲**而不是主力:tryPatch 的 bdCross 已讓規律結構
    // 一開始就不落在界線上(讓路的方向反過來了 —— 界線是結構,拼圖是點綴),留著只為
    // 擋住家族延伸之類的漏網。
    const ptOk = (px, pz, aq) => !isBlocked(px, pz) && !(roadClear && roadClear(px, pz))
      && !onRegular(px, pz)
      && (aq || terrain.heightAt(px, pz) > (wy != null ? wy + 0.15 : 0.45));
    // 逐 ~3m 取樣,**每個取樣點連兩側帶緣一起驗**(帶是有寬度的:只驗中心線的話,
    // 中心線剛好貼著走廊外緣時帶緣仍伸進馬路 —— 實測 150 個頂點漏 2 個就是這樣來的)
    const segOk = (x0, z0, x1, z1, aq, hw) => {
      const dx = x1 - x0, dz = z1 - z0, l = Math.hypot(dx, dz) || 1;
      const nx = -dz / l * hw, nz = dx / l * hw;
      const steps = Math.max(2, Math.ceil(l / 3));
      for (let s = 0; s <= steps; s++) {
        const t = s / steps, px = x0 + dx * t, pz = z0 + dz * t;
        if (!ptOk(px, pz, aq) || !ptOk(px + nx, pz + nz, aq) || !ptOk(px - nx, pz - nz, aq)) return false;
      }
      return true;
    };
    // 直段的可畫區間(沿退縮後的中心線,參數 0..1):逐 ~3m 判定,連續可畫的收成一段。
    // MUST NOT 退回「整片一個布林」—— 見 chains 迴圈的檔頭。
    const tileRuns = (tl, aq, hw) => {
      const dx = tl.bx - tl.ax, dz = tl.bz - tl.az, l = Math.hypot(dx, dz) || 1;
      const nx = -dz / l * hw, nz = dx / l * hw;
      const steps = Math.max(2, Math.ceil(l / 3));
      const runs = [];
      let s0 = -1;
      for (let s = 0; s <= steps; s++) {
        const t = s / steps, px = tl.ax + dx * t, pz = tl.az + dz * t;
        const good = ptOk(px, pz, aq) && ptOk(px + nx, pz + nz, aq) && ptOk(px - nx, pz - nz, aq);
        if (good) { if (s0 < 0) s0 = s; } else if (s0 >= 0) {
          if (s - 1 > s0) runs.push([s0 / steps, (s - 1) / steps]);
          s0 = -1;
        }
      }
      if (s0 >= 0 && steps > s0) runs.push([s0 / steps, 1]);
      return runs;
    };
    // 接頭:轉彎沿弧取樣(半徑取 R 與 R±hw 三圈)、圓帽驗整個圓盤、岔路逐臂連帶緣
    const cornerOk = (cor, aq) => {
      const g = cor.geo, hw = cor.hw;
      if (g.mode === 'cap') {
        if (!ptOk(g.cx, g.cz, aq)) return false;
        for (let s = 0; s < 8; s++) {
          const a = s / 8 * Math.PI * 2;
          if (!ptOk(g.cx + Math.cos(a) * g.r, g.cz + Math.sin(a) * g.r, aq)) return false;
        }
        return true;
      }
      const n = Math.max(3, Math.round(g.len / 3));
      for (let s = 0; s <= n; s++) {
        const a = g.a0 + g.sweep * (s / n), ca = Math.cos(a), sa = Math.sin(a);
        for (const rr of [g.R - hw, g.R, g.R + hw]) {
          if (!ptOk(g.cx + ca * rr, g.cz + sa * rr, aq)) return false;
        }
      }
      return true;
    };
    const forkOkAt = (fk) => {
      if (!ptOk(fk.x, fk.z, fk.arms.some((a) => BORDER_KINDS[a.kind].aq))) return false;
      for (const a of fk.arms) {
        if (!segOk(fk.x, fk.z, fk.x + a.dx * fk.L, fk.z + a.dz * fk.L,
                   !!BORDER_KINDS[a.kind].aq, hwOfKind(a.kind))) return false;
      }
      return true;
    };
    const forkOk = new Map();
    for (const fk of plan.forks) forkOk.set(fk.n, forkOkAt(fk));
    // 冒煙統計(同 aligned/arrays 性質):規劃了幾片 vs 真的畫出幾片 —— 分得開
    // 「沒有交界」與「有交界但整段讓路掉了」,否則兩者在畫面上都是「什麼都沒有」
    bStat.planned = plan.chains.reduce((s, c) => s + c.tiles.length, 0);
    bStat.forks = plan.forks.length;
    // ---- 掃掠核心:直段與轉彎共用同一支,差別只在中心線 ----
    // path(t) → [cx, cz, nx, nz](中心點 + 單位法向);直段是直線、轉彎是圓弧
    // ⇒ 轉彎不是「兩段直帶對接」,是同一套斷面沿著彎過去的中心線掃出來的完整一片。
    // flat:三頂點斷面(兩緣 α0、中線 α1)貼地;u = 沿線累計弧長 / bTexL(圖案連續彎過轉角)
    // 橫斷面:α 中段是**平台**不是尖峰 —— 只用三點(0,1,0)會讓整條帶變成軟糊的暈,
    // 讀不出「這是一條有邊的小徑」;平台佔內側 62%,柔邊只留最外側兩成。
    const XS = [[-1, 0, 0], [-0.62, 0.19, 1], [0, 0.5, 1], [0.62, 0.81, 1], [1, 1, 0]];
    // 接頭(楔形/圓帽)逐點取同一條剖面:平台 62%、外側兩成柔邊 —— 與直段同一把尺,
    // 接起來才是同一條帶,MUST NOT 在接頭另寫線性淡出
    const xsAlpha = (t, hw) => Math.min(1, Math.max(0, (1 - Math.abs(t) / hw) / 0.38));
    // 帶緣有機起伏(純函式,吃**世界座標**):中心線仍是 16 方向的弦,只有兩緣沿線起伏 ——
    // 田埂/土路/灌木/潮間帶/海灘的邊本來就不是尺畫出來的。取世界座標而不是取沿線參數 ⇒
    // 相鄰 tile 與轉彎接頭在共用端點上取到同一個值,邊緣連續、不會在接頭處開叉。
    const eN = (x, z, s) => 1 + BORDER_BAND.EDGE_A
      * (vnoise(x * BORDER_BAND.EDGE_W, z * BORDER_BAND.EDGE_W, seed ^ s) - 0.5) * 2;
    // 掃掠繞向:正面 MUST 朝上(sweepUpY 唯一縫)。DoubleSide 底下繞向反了不會破圖,
    // three 只是把法線反轉 ⇒ 整段帶像從地底打光的死黑,而每一條離線斷言照樣全綠。
    const flipOf = (path, rings) => {
      const [ax, az, nx, nz] = path(0);
      const [bx, bz] = path(Math.min(1, 1 / Math.max(1, rings)));
      return sweepUpY(bx - ax, bz - az, nx, nz) < 0;
    };
    // 這一層自己的弦長(餵 drapeSag,見 SAG 檔頭 ⑥):沿線 = 環距、橫向 = XS 的 0.38 步 × 半寬,
    // 取大者。**MUST NOT 用底毯的 cell/2** —— 抬升 ∝ 弦長²,拿 6.5m 去抬 2m 的環就是頂到
    // MAX 0.6m 浮成一條台(使用者:「土路/潮間帶/海灘不要凸起」)
    const bandSagR = (kd, ringLen) => Math.max(ringLen, kd.w * 0.38 / 2);
    // 帶的方向性(2026-08-13 使用者「作為分界線的話應該是兩邊不同類型的區域才對」):
    // 標了 `flat.wet` 的過渡型畫筆約定 **v = 1 是水側**(見 BORDER_PAINTERS 檔頭的 v 契約),
    // 而中心線的法向由鏈的走向決定 —— 同一種分界線在圖上兩處可以剛好相反。發射端據此把 v 軸
    // 轉正:水側 = **地形較低**的那一邊(貼水種類的水面恆低於陸地,這是判準而不是查表)。
    // 逐**片**定案不是逐頂點 —— 逐頂點在兩側幾乎等高處會來回翻,那是把圖案沿線撕開。
    // (ax, az) = v 遞增方向;沒標 wet 的畫筆恆回 false ⇒ 逐位元同舊制。
    const wetFlipAt = (kd, x, z, ax, az, r) => !!kd.wet
      && terrain.heightAt(x - ax * r, z - az * r) < terrain.heightAt(x + ax * r, z + az * r);
    const sweepFlat = (kind, kd, aq, path, rings, u0, len, a0, a1) => {
      const b = bkOf(flatB, kind, true);
      const w2 = kd.w / 2, lift = bLift(kind), NC = XS.length, texL = bTexL(kd);
      const sagR = bandSagR(kd, len / Math.max(1, rings));
      const flip = flipOf(path, rings);
      const [mx, mz, mnx, mnz] = path(0.5);
      const vflip = wetFlipAt(kd, mx, mz, mnx, mnz, w2);
      for (let s = 0; s <= rings; s++) {
        const t = s / rings;
        const [cx, cz, nx, nz] = path(t);
        const ea = s === 0 ? a0 : s === rings ? a1 : 1;   // 自由端 α=0 收尾、接頭端 α=1 對接
        const u = (u0 + len * t) / texL;
        const eL = eN(cx, cz, 0x1F17), eR = eN(cx, cz, 0x2E29);   // 兩緣各自起伏
        for (const [f, v, va] of XS) {
          const ff = f * (f < 0 ? eL : eR);
          const gx = cx + nx * w2 * ff, gz = cz + nz * w2 * ff;
          const wsh = wash(gx, gz);
          b.pos.push(gx, gY(gx, gz, aq) + lift + drapeSag(terrain.heightAt, gx, gz, sagR), gz);
          b.nrm.push(0, 1, 0);
          pushLandN(b, terrain.heightAt, gx, gz, terrain.gridM);
          b.uv.push(u, vflip ? 1 - v : v);
          b.col.push(wsh, wsh, wsh, va * ea);
        }
        if (s) {
          const p0 = b.base + (s - 1) * NC, q0 = p0 + NC;
          for (let k = 0; k < NC - 1; k++) {
            if (flip) b.idx.push(p0 + k, p0 + k + 1, q0 + k, p0 + k + 1, q0 + k + 1, q0 + k);
            else b.idx.push(p0 + k, q0 + k, p0 + k + 1, p0 + k + 1, q0 + k, q0 + k + 1);
          }
        }
      }
      b.base += (rings + 1) * NC;
    };
    // 離散件的盒子(木柵欄的樁與橫桿 / 岩塊 / 紅樹林支柱根叢):沿路徑的局部框
    // (t 切向、up、n 法向;t×up = n ⇒ 右手系,六個面各自帶外法線)。
    // 六面各自四頂點 = 折邊真的出得了線;繞向逐面由右手三元組定,**不吃 flip** ——
    // 盒子是封閉體,朝向由自己的面法線決定,與掃掠帶「哪一側朝上」無關。
    const ridgeBox = (b, cx, cz, tx, tz, hl, hw, y0, y1) => {
      const nx = -tz, nz = tx;                       // n = t × up(右手系)
      // 角點:i 沿 t、j 沿 up(−1 = y0 / +1 = y1)、k 沿 n
      const P = (i, j, k) => [cx + tx * hl * i + nx * hw * k, j > 0 ? y1 : y0, cz + tz * hl * i + nz * hw * k];
      for (const [N, Q] of BOX_FACES) {
        const o = b.base;
        for (const [i, j, k] of Q) {
          const p = P(i, j, k);
          b.pos.push(p[0], p[1], p[2]);
          b.nrm.push(N[0] * tx + N[2] * nx, N[1], N[0] * tz + N[2] * nz);   // 局部法線 → 世界
        }
        b.idx.push(o, o + 1, o + 2, o, o + 2, o + 3);
        b.base += 4;
      }
    };
    // 離散脊:`form` 決定「這東西在現實裡是不是連續的」(見 BORDER_KINDS 檔頭)。
    //   posts —— 樁恆落在**兩端**(i/n)⇒ 相鄰片與轉角共用端樁,接縫不擠成兩根;
    //            橫桿在樁與樁之間、`rail.y` 是佔全高的比例 ⇒ 讀起來是木柵欄不是一道牆。
    //   clumps —— pitch 一顆,尺寸/高度/橫向偏移吃 ehash(零共享 rnd,§2.3)。
    const partRidge = (kind, kd, aq, path, hseed, len) => {
      const b = bkOf(ridgeB, kind, false);
      const n = Math.max(1, Math.round((len || kd.pitch) / kd.pitch));
      const at = (t) => {
        const [cx, cz, nx, nz] = path(Math.min(1, Math.max(0, t)));
        return [cx, cz, nz, -nx];                    // 切向 = 法向轉 90°(path 的 n = (−dz, dx))
      };
      if (kd.form === 'posts') {
        const R = kd.rail, pw = (kd.pw ?? kd.w) / 2, hw = kd.w / 2;
        const P = [];
        for (let i = 0; i <= n; i++) {
          const [cx, cz, tx, tz] = at(i / n);
          const gy = gY(cx, cz, aq) - 0.12;
          const h = kd.h * (1 + (ehash(hseed + i, hseed * 7, 13) - 0.5) * (kd.jit || 0));
          ridgeBox(b, cx, cz, tx, tz, pw, hw, gy, gy + h);
          P.push([cx, cz, gy, h]);
        }
        if (!R) return;
        for (let i = 0; i < n; i++) {                 // 橫桿:兩樁之間,量到樁心(端頭埋進樁裡)
          const [ax, az, ay, ah] = P[i], [bx, bz, by, bh] = P[i + 1];
          const dx = bx - ax, dz = bz - az, l = Math.hypot(dx, dz);
          if (l < 1e-3) continue;
          const mx = (ax + bx) / 2, mz = (az + bz) / 2;
          for (const ry of R.y) {
            const y0 = (ay + ah * ry + by + bh * ry) / 2;
            ridgeBox(b, mx, mz, dx / l, dz / l, l / 2, R.t / 2, y0, y0 + R.h);
          }
        }
        return;
      }
      for (let i = 0; i < n; i++) {                   // clumps
        const [cx, cz, tx, tz] = at((i + 0.5) / n);
        const j1 = ehash(hseed + i, hseed * 7, 13), j2 = ehash(hseed * 3 + i, 5, hseed | 1);
        const j3 = ehash(i, hseed * 11, 29);
        const off = (j3 - 0.5) * 2 * (kd.lat ?? 0) * (kd.w / 2);
        const ox = cx - tz * off, oz = cz + tx * off;
        const gy = gY(ox, oz, aq) - 0.12;
        const sc = 1 + (j1 - 0.5) * (kd.jit || 0);
        ridgeBox(b, ox, oz, tx, tz, kd.wt / 2 * sc, kd.w / 2 * (0.45 + j2 * 0.4),
          gy, gy + kd.h * sc);
      }
    };
    // ridge:梯形斷面沿同一條中心線掃掠;端面封口。斷面順序(底左/底右/頂左/頂右)是
    // flat 的鏡像 ⇒ 繞向判準取反(sweepUpY > 0 才要翻)。DoubleSide 只保證看得見,
    // 不保證亮度 —— 側面繞向反了同樣是整根死黑
    const sweepRidge = (kind, kd, aq, path, spans, hseed, len) => {
      const b = bkOf(ridgeB, kind, false);
      if (kd.form) { partRidge(kind, kd, aq, path, hseed, len); return; }
      const w2 = kd.w / 2, wt2 = kd.wt / 2;
      const flip = !flipOf(path, spans);
      const nrm = (v) => { const l = Math.hypot(v[0], v[1], v[2]) || 1; return [v[0] / l, v[1] / l, v[2] / l]; };
      const first = b.base;
      let prev = null;
      for (let s = 0; s <= spans; s++) {
        const [cx, cz, nx, nz] = path(s / spans);
        const NL = nrm([-nx, 0.25, -nz]), NR = nrm([nx, 0.25, nz]);   // 側面外法線(略朝上,倒角)
        const NLt = nrm([-nx * 0.4, 1, -nz * 0.4]), NRt = nrm([nx * 0.4, 1, nz * 0.4]);
        const gy = gY(cx, cz, aq) - 0.12;                             // 底埋入地表,無縫接地
        const topY = gy + kd.h * (1 + (ehash(hseed + s, hseed * 7, 13) - 0.5) * kd.jit);
        const idx0 = b.base;
        const push = (px, py, pz, n) => { b.pos.push(px, py, pz); b.nrm.push(n[0], n[1], n[2]); };
        push(cx - nx * w2, gy, cz - nz * w2, NL);
        push(cx + nx * w2, gy, cz + nz * w2, NR);
        push(cx - nx * wt2, topY, cz - nz * wt2, NLt);
        push(cx + nx * wt2, topY, cz + nz * wt2, NRt);
        b.base += 4;
        if (prev != null) {
          const p0 = prev, q0 = idx0;
          const tri = (a2, b2, c2) => (flip ? b.idx.push(a2, c2, b2) : b.idx.push(a2, b2, c2));
          tri(p0, p0 + 2, q0); tri(q0, p0 + 2, q0 + 2);               // 左側面
          tri(p0 + 1, q0 + 1, p0 + 3); tri(p0 + 3, q0 + 1, q0 + 3);   // 右側面
          tri(p0 + 2, p0 + 3, q0 + 2); tri(q0 + 2, p0 + 3, q0 + 3);   // 頂面
        }
        prev = idx0;
      }
      const cap = (a2, b2, c2) => (flip ? b.idx.push(a2, c2, b2) : b.idx.push(a2, b2, c2));
      cap(first, first + 1, first + 3); cap(first, first + 3, first + 2);
      cap(prev, prev + 3, prev + 1); cap(prev, prev + 2, prev + 3);
    };
    // 直段中心線(吃**退縮後**的端點:接頭那一段空間讓給接頭拼圖)
    const linePath = (tl) => {
      const dx = tl.bx - tl.ax, dz = tl.bz - tl.az, l = Math.hypot(dx, dz) || 1;
      const nx = -dz / l, nz = dx / l;
      return [(t) => [tl.ax + dx * t, tl.az + dz * t, nx, nz], l];
    };
    // 圓弧中心線(轉彎接頭):法向 = 徑向,取「指向圓心外側」的一致方向
    const arcPath = (g, t0, t1) => {
      const sgn = g.sweep >= 0 ? 1 : -1;
      return (t) => {
        const a = g.a0 + g.sweep * (t0 + (t1 - t0) * t);
        const rx = Math.cos(a), rz = Math.sin(a);
        return [g.cx + rx * g.R, g.cz + rz * g.R, rx * sgn, rz * sgn];
      };
    };
    // 圓帽接頭(急彎):半徑 hw 的圓盤 —— 標準 round join,一片完整拼圖。
    // 接力急彎時沿角平分線切半,兩臂各畫各的;立體脊另立一根接頭墩。
    const emitCap = (cor, fromA, tlKind) => {
      const g = cor.geo;
      const arms2 = [cor.a, cor.b];
      const halves = cor.a.kind === cor.b.kind ? [[0, 2, tlKind]] : [[0, 1, cor.a.kind], [1, 2, cor.b.kind]];
      // 切半基準:角平分線的法線方向(a 臂那半 / b 臂那半)
      const sx = cor.a.dx + cor.b.dx, sz = cor.a.dz + cor.b.dz;
      const sl2 = Math.hypot(sx, sz) || 1;
      const base = Math.atan2(-sx / sl2, sz / sl2);   // 平分線的法線 ⇒ 半圓切在兩臂之間
      const NF = 12;
      const bxu = sx / sl2, bzu = sz / sl2;            // 平分線單位向量 = 圓帽的局部框
      for (const [h0, h1, kk] of halves) {
        const kdef = BORDER_KINDS[kk];
        if (!kdef.flat) continue;
        const b = bkOf(flatB, kk, true), lift = bLift(kk), aq = !!kdef.aq;
        const sagR = bandSagR(kdef.flat, g.r * Math.PI / NF);   // 扇形的弦 = 圓帽半徑上的弧步
        const vflip = wetFlipAt(kdef.flat, g.cx, g.cz, -bzu, bxu, g.r);   // v 軸 = 平分線的法線
        // 以平分線為框取 UV 與 α:橫過帶的方向仍走**帶剖面**(中線實、兩緣 0),
        // MUST NOT 用「徑向淡出 + v 固定」—— 那會把紋理最深的中線鋪成一塊實心圓斑
        const put = (px, pz) => {
          const s2 = (px - g.cx) * bxu + (pz - g.cz) * bzu;
          const t2 = (px - g.cx) * -bzu + (pz - g.cz) * bxu;
          const wsh = wash(px, pz);
          b.pos.push(px, gY(px, pz, aq) + lift + drapeSag(terrain.heightAt, px, pz, sagR), pz);
          b.nrm.push(0, 1, 0);
          pushLandN(b, terrain.heightAt, px, pz, terrain.gridM);
          const vv = Math.min(1, Math.max(0, 0.5 + t2 / (g.r * 2)));
          b.uv.push(s2 / bTexL(kdef.flat), vflip ? 1 - vv : vv);
          b.col.push(wsh, wsh, wsh, xsAlpha(t2, g.r));
        };
        put(g.cx, g.cz);
        const n2 = Math.max(3, Math.round(NF * (h1 - h0) / 2));
        for (let s = 0; s <= n2; s++) {
          const ang = base + Math.PI * (h0 + (h1 - h0) * (s / n2));
          put(g.cx + Math.cos(ang) * g.r, g.cz + Math.sin(ang) * g.r);
          // 扇形沿**遞增角**展開 ⇒ 在 (x,z) 俯視是逆向,繞向必須倒過來才正面朝上(同 sweepUpY)
          if (s) b.idx.push(b.base, b.base + s + 1, b.base + s);
        }
        b.base += n2 + 2;
      }
      for (const arm of arms2) {                       // 立體脊:自節點沿臂掃到斷面 = 接頭墩
        const kdef = BORDER_KINDS[arm.kind];
        if (!kdef.ridge) continue;
        const nx = -arm.dz, nz = arm.dx;
        sweepRidge(arm.kind, kdef.ridge, !!kdef.aq,
          (t) => [g.cx + arm.dx * g.L * t, g.cz + arm.dz * g.L * t, nx, nz],
          Math.max(1, Math.round(g.L / 2)), cor.n, g.L);
      }
    };
    // 接頭端的累計弧長(節點+種類為鍵):岔路拼圖據此接上該臂的圖案相位,不會在交會處跳格
    const uAt = new Map();
    const uKey = (n, kind) => `${n}|${kind}`;
    for (const ch of plan.chains) {
      const nT = ch.tiles.length;
      // 逐片先算「可畫的區間」:讓路 MUST 是**逐段**的,不是整片全有或全無 ——
      // 共線的交界會被 16 方向量化併成一整片(實測一條 900m 的直線交界 = 1 片),
      // 整片判定的話,沿線任何一處有停車場就讓整條界線消失(2026-08-11 實測:
      // 市區側規劃 1 片 → 實畫 0 片 = 0% 覆蓋)。改逐段後,界線只在該讓的地方斷開。
      const info = ch.tiles.map((tl) => {
        const kdef = BORDER_KINDS[tl.kind];
        const runs = tileRuns(tl, !!kdef.aq, hwOfKind(tl.kind));
        return { kdef, runs, head: runs.length > 0 && runs[0][0] === 0,
                 tail: runs.length > 0 && runs[runs.length - 1][1] === 1 };
      });
      let u = 0;
      for (let t = 0; t < nT; t++) {
        const tl = ch.tiles[t], nf = info[t];
        const kdef = nf.kdef;
        const [path, len] = linePath(tl);
        if (!nf.runs.length) { u = 0; continue; }       // 整片都該讓路:紋理弧長歸零重起
        // 接續端 = 相鄰 tile 那一頭真的畫到底,或這一端接的是**真的畫得出來的**岔路
        // (岔路是鏈的邊界 ⇒ j0/j1 恆 false,只看 j 會讓每條臂在路口前淡出成殘影);
        // 轉彎同理:接頭讓路而沒畫時,直段那一端 MUST 收成 α=0,不能停在半空
        const cOk0 = !tl.c0 || cornerOk(tl.c0, !!kdef.aq);
        const cOk1 = !tl.c1 || cornerOk(tl.c1, !!kdef.aq);
        const okPrev = nf.head && cOk0
          && (tl.f0 ? forkOk.get(tl.n0) : (tl.j0 && info[(t - 1 + nT) % nT].tail));
        const okNext = nf.tail && cOk1
          && (tl.f1 ? forkOk.get(tl.n1) : (tl.j1 && info[(t + 1) % nT].head));
        uAt.set(uKey(tl.n0, tl.kind), u);
        bStat.drawn++;
        for (const [r0, r1] of nf.runs) {
          const sl = len * (r1 - r0);
          const p = (tt) => path(r0 + (r1 - r0) * tt);
          const a0 = r0 === 0 ? (okPrev ? 1 : 0) : 0;    // 區間內側的斷口一律淡出收尾
          const a1 = r1 === 1 ? (okNext ? 1 : 0) : 0;
          // 環距 4 → 2.2m(與轉彎圓弧同密度):弦短一截,貼合抬升就少 (2.2/4)² ≈ 三成
          if (kdef.flat) sweepFlat(tl.kind, kdef.flat, !!kdef.aq, p,
                                   Math.max(1, Math.round(sl / 2.2)), u + len * r0, sl, a0, a1);
          if (kdef.ridge) sweepRidge(tl.kind, kdef.ridge, !!kdef.aq, p,
                                     Math.max(1, Math.round(sl / 5)), tl.n0 + ((r0 * 97) | 0), sl);
        }
        u += len;
        uAt.set(uKey(tl.n1, tl.kind), u);
        // ---- 轉彎拼圖:整片畫出來(圓弧掃掠 / 急彎走圓帽),不是把下一段直帶黏上來 ----
        const cor = tl.c1;
        if (!cor || !okNext || !cOk1) { u += cor ? cor.geo.len : 0; continue; }
        const g = cor.geo;
        const mixed = cor.a.kind !== cor.b.kind;        // 接力轉彎:前後半各畫各的圖案
        // 這一片是自 tl 那一臂轉向另一臂:tl 的臂在 cor 裡可能是 a 也可能是 b,
        // 弧的參數方向恆自 Pa→Pb,所以要先認出自己是哪一端
        const fromA = Math.abs(g.Pa[0] - tl.bx) + Math.abs(g.Pa[1] - tl.bz) < 1e-6;
        if (g.mode === 'arc') {
          const segs = mixed ? [[0, 0.5, fromA ? cor.a.kind : cor.b.kind],
                               [0.5, 1, fromA ? cor.b.kind : cor.a.kind]]
                             : [[0, 1, tl.kind]];
          let uu = u;
          for (const [s0, s1, kk] of segs) {
            const kdf = BORDER_KINDS[kk];
            const sl = g.len * (s1 - s0);
            const p = fromA ? arcPath(g, s0, s1) : arcPath(g, 1 - s0, 1 - s1);
            const rings = Math.max(2, Math.round(sl / 2.2));   // 弧段取樣密一點,彎才圓順
            if (kdf.flat) sweepFlat(kk, kdf.flat, !!kdf.aq, p, rings, uu, sl, 1, 1);
            if (kdf.ridge) sweepRidge(kk, kdf.ridge, !!kdf.aq, p, rings, cor.n, sl);
            uu += sl;
          }
          u = uu;
        } else if (g.mode === 'cap') {
          // 急彎:圓帽接頭(標準 round join)—— 一片完整的圓盤,兩臂各佔半邊圖案
          emitCap(cor, fromA, tl.kind);
          u += g.len;
        }
      }
    }
    // ---- 岔路拼圖:逐臂楔形在中心交會,各自帶自己的圖案(接力);MUST NOT 用墊片蓋縫 ----
    // 多邊形(逆時針)= [B0,A0,B1,A1,…],Bi/Ai = 第 i 臂斷面的兩緣;臂與臂之間以中點切開,
    // 每一楔形進自己那一種的桶 ⇒ 三種分界線交會處是三片真的拼圖,不是一張蓋板。
    for (const fk of plan.forks) {
      if (!forkOk.get(fk.n)) continue;     // 讓路判定與直段同一支(逐臂取樣,不是只驗中心點)
      bStat.forksDrawn++;
      const k = fk.arms.length;
      // 逐臂斷面:**沿用直段的 XS 橫斷面表**(自 f=-1 到 +1;A = 逆時針側 f=+1)。
      // 只放兩緣的話,α 會自中心線性內插到 0,正好在直段起點開一個洞(路口變成白十字)。
      const E = fk.arms.map((a) => {
        const nx = -a.dz, nz = a.dx;
        const cx = fk.x + a.dx * fk.L, cz = fk.z + a.dz * fk.L;
        const hw = (BORDER_KINDS[a.kind].flat?.w ?? BORDER_KINDS[a.kind].ridge.w) / 2;
        // 帶緣起伏取**斷面中心的世界座標** ⇒ 與該臂直段退縮端那一圈同值,楔形與直段接得上
        const eL = eN(cx, cz, 0x1F17), eR = eN(cx, cz, 0x2E29);
        const xs = XS.map(([f]) => {
          const ff = f * (f < 0 ? eL : eR);
          return [cx + nx * hw * ff, cz + nz * hw * ff];
        });
        return { xs, B: xs[0], A: xs[xs.length - 1] };
      });
      const M = E.map((e, i) => {                       // 相鄰臂之間的切分中點
        const nx = E[(i + 1) % k].B;
        return [(e.A[0] + nx[0]) / 2, (e.A[1] + nx[1]) / 2];
      });
      for (let i = 0; i < k; i++) {
        const a = fk.arms[i], kdef = BORDER_KINDS[a.kind];
        const aq = !!kdef.aq;
        if (kdef.flat) {
          const b = bkOf(flatB, a.kind, true);
          const lift = bLift(a.kind), hw = kdef.flat.w / 2;
          const sagR = bandSagR(kdef.flat, fk.L);              // 楔形自節點量到斷面 = fk.L
          const vflip = wetFlipAt(kdef.flat, fk.x, fk.z, -a.dz, a.dx, hw);
          const u0 = uAt.get(uKey(fk.n, a.kind)) ?? 0;
          // 楔形 = 扇形過 [M(i-1), B_i, A_i, M_i];UV 與 α 都取**該臂的局部框 + 帶剖面**
          // (中線實、兩緣 0)⇒ 交會處讀起來是三條帶匯進來,MUST NOT 用徑向淡出(會糊成一團)
          const ring = [M[(i - 1 + k) % k], ...E[i].xs, M[i]];
          const put = (px, pz) => {
            const s = (px - fk.x) * a.dx + (pz - fk.z) * a.dz;
            const t2 = (px - fk.x) * -a.dz + (pz - fk.z) * a.dx;
            const wsh = wash(px, pz);
            b.pos.push(px, gY(px, pz, aq) + lift + drapeSag(terrain.heightAt, px, pz, sagR), pz);
            b.nrm.push(0, 1, 0);
            pushLandN(b, terrain.heightAt, px, pz, terrain.gridM);
            const vv = Math.min(1, Math.max(0, 0.5 + t2 / (hw * 2)));
            b.uv.push((u0 - fk.L + s) / bTexL(kdef.flat), vflip ? 1 - vv : vv);
            b.col.push(wsh, wsh, wsh, xsAlpha(t2, hw));
          };
          put(fk.x, fk.z);
          for (const p of ring) put(p[0], p[1]);
          // 楔形扇自 f=-1 掃到 +1 ⇒ 俯視是逆向,繞向倒過來才正面朝上(同 sweepUpY / emitCap)
          for (let s = 0; s < ring.length - 1; s++) b.idx.push(b.base, b.base + 2 + s, b.base + 1 + s);
          b.base += 1 + ring.length;
        }
        if (kdef.ridge) {
          // 立體脊的交會 = 一根接頭墩(角柱/樹叢/岩堆),自節點沿該臂掃到斷面
          const dx = a.dx, dz = a.dz, nx = -dz, nz = dx;
          sweepRidge(a.kind, kdef.ridge, aq,
            (t) => [fk.x + dx * fk.L * t, fk.z + dz * fk.L * t, nx, nz],
            Math.max(1, Math.round(fk.L / 2)), fk.n + i, fk.L);
        }
      }
    }
    for (const [kind, b] of flatB) {
      if (!b.idx.length) continue;
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.Float32BufferAttribute(b.pos, 3));
      geo.setAttribute('normal', new THREE.Float32BufferAttribute(b.nrm, 3));
      geo.setAttribute('uv', new THREE.Float32BufferAttribute(b.uv, 2));
      geo.setAttribute('color', new THREE.Float32BufferAttribute(b.col, 4));
      setLandN(geo, b);
      geo.setIndex(b.idx);
      const m = new THREE.Mesh(geo, envMat(0xffffff, {
        map: borderTex(kind), vertexColors: true, wash: 0.5, cool: 0.5, rim: 0, landNrm: true,
        // 繞向由 sweepUpY / flipOf 定案(正面恆朝上);DoubleSide 只是「自下方也看得見」的
        // 保險,MUST NOT 拿它當繞向的替代品 —— 它讓背面看得見,卻同時把法線反轉成死黑
        transparent: true, side: THREE.DoubleSide,
      }));
      m.renderOrder = -1.1 + bKinds.indexOf(kind) * 0.005;   // ∈ [-1.1, -1.05]:晚於脊帶 -1.2、早於特徵層 0
      m.frustumCulled = false;
      m.userData.noOutline = true;
      m.userData.gborder = kind; m.userData.glayer = 'border';   // 冒煙識別標記(同上)
      group.add(m);
    }
    for (const [kind, b] of ridgeB) {
      if (!b.idx.length) continue;
      const kd = BORDER_KINDS[kind].ridge;
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.Float32BufferAttribute(b.pos, 3));
      geo.setAttribute('normal', new THREE.Float32BufferAttribute(b.nrm, 3));
      geo.setIndex(b.idx);
      // 立體脊:`land` 但**不換法線** —— 它是真的有形狀的東西(梯形斷面),折邊那一項照舊
      // 出線;共用 id 只是讓它與底下的地被之間不再多一條「不同材質」的假線。
      const m = new THREE.Mesh(geo, envMat(kd.color === 'foliage' ? snB.foliage : kd.color,
        { wash: 0.4, cool: 0.45, side: THREE.DoubleSide, land: true }));
      m.frustumCulled = false;
      m.userData.noOutline = true;
      m.userData.gborder = kind; m.userData.glayer = 'border';   // 冒煙識別標記(同上)
      group.add(m);
    }
  }

  // ---- 特徵色塊 Mesh(每「地表×變體」一個 draw call)----
  for (const [key, b] of buckets) {
    if (!b.idx.length) continue;
    const [sub, v] = key.split('#');
    const def = DEFS[sub];
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(b.pos, 3));
    geo.setAttribute('normal', new THREE.Float32BufferAttribute(b.nrm, 3));
    geo.setAttribute('uv', new THREE.Float32BufferAttribute(b.uv, 2));
    geo.setAttribute('color', new THREE.Float32BufferAttribute(b.col, 4));   // RGBA:fade 邊用頂點 alpha
    setLandN(geo, b);
    geo.setIndex(b.idx);
    const tint = def.green && !def.seasonal ? (SEASON_TINT[season] ?? 0xffffff) : 0xffffff;   // 同底毯:四季設計不再吃濾鏡
    const m = new THREE.Mesh(geo, envMat(tint, {
      map: groundTex(sub, +v, def.uv === 'fit', season),
      vertexColors: true, wash: 0.5, cool: 0.5, rim: 0,   // 貼地面關 rim(同底毯)
      transparent: def.edge === 'fade',   // 淡出邊融入地形;depthWrite 保持 true(貼花式)
      landNrm: true,                      // 地貌類別 + 真地形法線(同底毯)
    }));
    m.frustumCulled = false;
    m.userData.noOutline = true;
    // 特徵拼圖識別標記:冒煙測試核對不疊置/反重複/分區相符用
    m.userData.gsub = sub; m.userData.gvar = +v; m.userData.gshape = def.shape;
    group.add(m);
  }

  // ---- 農田田埂 Mesh(全場一個 draw call;2026-08-13)----
  // 畫筆走 `borderTex('fieldridge')` = 界線拼圖那一份 `fieldpath` 夯土畫筆(**同一個縫**;
  // 田埂就是田埂,沒有理由多養一支)。`land: true` 但**不換法線** —— 同立體脊的處理:
  // 它是真的有斷面的東西,折邊那一項要照樣出線(埂頂與外側垂直面的 90° 折角就是那條線),
  // 共用 id 只是不要在埂與底下的田之間多畫一條「不同材質」的假線。
  for (const [, b] of bundBuckets) {
    if (!b.idx.length) continue;
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(b.pos, 3));
    geo.setAttribute('normal', new THREE.Float32BufferAttribute(b.nrm, 3));
    geo.setAttribute('uv', new THREE.Float32BufferAttribute(b.uv, 2));
    geo.setAttribute('color', new THREE.Float32BufferAttribute(b.col, 4));
    setLandN(geo, b);
    geo.setIndex(b.idx);
    const m = new THREE.Mesh(geo, envMat(0xffffff, {
      map: borderTex('fieldridge'), vertexColors: true, wash: 0.45, cool: 0.5, rim: 0,
      land: true, landNrm: true,   // 埂頂吃真地形法線、垂直面吃自己的面法線(見 emitBund)
    }));
    m.frustumCulled = false;
    m.userData.noOutline = true;
    m.userData.glayer = 'bund';   // 冒煙識別標記(同拼圖的 gsub/glayer 慣例)
    group.add(m);
  }

  // ---- 細節 InstancedMesh(每零件一個 draw call;實例色抖動同植被)----
  const sn = ENV.seasons[season] || ENV.seasons.summer;
  const partColor = (c) => c === 'grass' ? sn.grass : c === 'foliage' ? sn.foliage : c === 'palette' ? 0xffffff : c;
  const M = new THREE.Matrix4(), Q = new THREE.Quaternion(), E = new THREE.Euler();
  const P = new THREE.Vector3(), S = new THREE.Vector3(), tint = new THREE.Color();
  for (const type in det) {
    const items = det[type];
    if (!items.length) continue;
    // ---- 表面群組 + outlineContribution(2026-08-16;序 3 的 S3 / S4 消費端)----
    // 使用者追加的「石堆的處置」:一顆石頭在畫面上是**一個東西**。現況是 `boulder` 的大小
    // 兩瓣、`slab` 的板 + 墩、`snag` 的幹 + 兩枝各自是一個逐材質 surfaceId ⇒ **每一顆石頭
    // 中間被切一刀**(而兩顆不同的石頭反而同號 —— 一款 = 一個 InstancedMesh = 一份材質)。
    // ①**取號 MUST 在零件迴圈之外**(逐 `type` 一次):放進去就是逐零件各一號 = 完全沒做,
    //   而「有沒有呼叫 surfGroup」看起來一模一樣(反向驗證 `--break-detsurf` 咬的正是位置)。
    // ②**粒度是「一顆」不是「一堆」**:兩顆之間的輪廓由**深度**那一項給(它們是分開的實體,
    //   深度真的有落差)⇒ 這裡刻意**不標 `ink: 'group'`**。標了的話群組早退會把「五格同號」
    //   的判定套到全世界同款的石頭上,岩屑坡上那十幾顆當場糊成一坨(rock-silhouette 規格
    //   點名的那個坑)。同號只讓 `INK_MRT.ID` 那一項閉嘴、並讓法線折邊改吃 `SELF_F` 的門檻。
    // ③**貢獻由既有的實測縫 `detailR(type)` 推導**(量零件真幾何;手寫值會靜默過期),
    //   直徑 = ×2 ⇒ `pebble`(r≈0.42)之類「畫面上只有幾個像素」的東西不值得一條線,
    //   而 `boulder`(r≈1.25)以上恆為 1(= 舊制)。零新名冊。
    // **零亂數消耗**:`surfGroup()` 吃的是 toon.js 的模組級序不是共享 `rnd()`(§2.3)。
    const sg = surfGroup(), sCtr = inkCtrM(detailR(type) * 2);
    for (const part of DETAIL_DEFS[type]) {
      // 材質塗層與 2D 地表同語彙:低頻水彩 wash + 冷藍陰影(envMat),
      // 人造附件再疊程序貼圖(貨櫃浪板/太陽能電池格/看板畫面/木箱板紋)
      // 軟性(A39):稻/草/芒草/蘆葦/花/灌木隨風飄揚 + 細勾線。錨點 base = 0 —— 這一張表的
      // 落地平移烤在幾何裡,頂點的 y 本身就是整株座標(見 DETAIL_DEFS 檔頭那一段)。
      const mat = envMat(partColor(part.c), {
        map: part.tex ? detailTex(part.tex) : null, wash: 0.35, cool: 0.4,
        surf: sg, contrib: sCtr,
        ...(part.sf ? { soft: { k: part.sf, span: detailSpan(type), base: 0, sy: part.sy ?? 1 } } : {}),
      });
      const m = new THREE.InstancedMesh(part.geo, mat, items.length);
      items.forEach((it, i) => {
        E.set(it.tx || 0, it.ry, it.tz || 0);   // 隨機傾角(TILT 表)+ 隨機朝向
        Q.setFromEuler(E);
        P.set(it.x, it.y, it.z);
        S.set(it.s, it.s * (part.sy ?? 1) * it.sy, it.s);
        M.compose(P, Q, S);
        m.setMatrixAt(i, M);
        if (part.c === 'palette' && it.tint != null) tint.setHex(it.tint);
        else {
          const j1 = ((i * 2654435761) >>> 0) % 100 / 100;
          const j2 = ((i * 1597334677) >>> 0) % 100 / 100;
          const j3 = ((i * 3812015801) >>> 0) % 100 / 100;
          tint.setRGB(0.84 + j1 * 0.3, 0.84 + j2 * 0.3, 0.84 + j3 * 0.3);
        }
        m.setColorAt(i, tint);
      });
      m.instanceMatrix.needsUpdate = true;
      if (m.instanceColor) m.instanceColor.needsUpdate = true;
      m.castShadow = false;
      m.frustumCulled = false;
      group.add(m);
    }
  }
  // orphans = 找不到主人格的地形四邊形數(結構上應恆為 0:抖動 < 0.45 格 ⇒ 主人恆在 3×3 內。
  // > 0 就是認養搜尋範圍或抖動幅度有人動過,而畫面上只表現成偶爾一格禿掉露出地形)
  // 影子的**承接面**(2026-08-14):地貌那幾層蓋住了絕大部分的地形三角形 ——
  // 只讓 `terrain.mesh` 收影子的話,機體的影子會在有底毯的地方整片消失(而空地上有,
  // 讀起來像「影子時有時無」)。投射一律不開:這些是貼地面,自己投不出東西,
  // 而 3D 細節那一批本來就顯式 `castShadow = false`(instanced 的陰影 pass 是純浪費)。
  group.traverse((o) => { if (o.isMesh) o.receiveShadow = true; });
  return { patches: placed, details: detCount, cells: landCells.length, aligned, arrays: arraysN,
           border: bStat, bufCells, orphans: orphanQuads, bandDryAt };
}
