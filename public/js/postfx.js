// ============ 賽璐璐後製管線(螢幕空間勾線 → 調色 → FXAA)============
// 2026-08-03。在此之前畫面上的描邊**只有反轉外殼**,而 `biomes.js` 一次都沒有呼叫
// `outlinify` ⇒ 機體有黑線、世界沒有,機體看起來像貼在照片上的貼紙。
// 用外殼把整個世界包起來不可行:那是幾百個額外 draw call,而本渲染器已經是 draw call 瓶頸。
// 螢幕空間勾線是**一個 pass 蓋全場**,成本與場景複雜度無關。
//
// ---- 勾線為什麼是深度的「二階差分」而不是一階 ----
// 一階差分(相鄰深度相減)在**掠射面**上恆為大值 —— 地面往遠處延伸時每個像素的深度都在
// 快速變化,結果整片地面刷滿線。二階差分量的是深度的**曲率**:平面(不論多斜)恆為 0,
// 只有真正的折邊才有值。這是「地面不該有線、屋角該有線」唯一分得開的判據。
// 凸邊(物體輪廓)給全強度、凹邊(牆角內側)乘 CONCAVE_F —— 手繪的內角線本來就比外輪廓輕。
//
// ---- 三個一定要有的細節 ----
//   ① 墨色 MUST 與底色相混而不是塗黑:純黑線疊在暗部上會糊成一塊。
//   ② 遠處淡出:遠景的線密到一定程度就變成雜訊(而且會蓋掉霧)。
//   ③ 天空早退:天空的深度是 far,不early-out 的話整條天際線會被畫成一條粗黑邊。
//
// ---- 軟性物質的細線(2026-08-04;契約寫在 `toon.js` 的「軟性物質」段)----
// 使用者定案「雲朵/芒草/草原/花園/樹葉/旗幟這些軟性的物質的線條會細得多,其他堅硬的
// 物體則依據設定的數值」。本 pass 是**螢幕空間**的,天生不認識「這個像素是什麼東西」⇒
// 逐像素的通道只有一條:**場景 RT 的 alpha ≡ 這一格的勾線門檻倍率**(1 = 硬性 = 舊制)。
// 材質端怎麼寫進去、為什麼那個通道是空的,全部住 toon.js;本檔只負責讀它、乘進門檻。
// 「細」= 抬高門檻而不是縮小取樣半徑:半徑已經是 1 像素(`INK.THICK`,再小就斷線),
// 而 `|e|` 從邊緣往外遞減 ⇒ 門檻抬高,越過門檻的像素帶真的變窄(不是只變淡)。
//
// ---- 景深模糊(2026-08-09;距離與不變式住 `data.js DOF`)----
// 使用者定案「加入遠的物件隨距離景深模糊的效果」。四件事先講清楚,因為每一件寫反了都不報錯:
//   ① **這一 pass 是加成本的**。它不省效能(同日已向使用者說明);採用理由是畫面。
//      代價收在兩處:拉桿 0% 時**整個 pass 退出鏈**(不是跑一個乘 0 的 pass),
//      以及焦內像素在第一行就早退(只留 1 次深度 + 1 次顏色取樣)。
//   ② **順序 MUST 排在勾線之後**。勾線讀的是**深度**、畫的是線;先糊後勾 = 深度仍然銳利
//      ⇒ 在已經糊掉的色塊上畫出銳利的黑線(「糊掉的物件卻有清楚的輪廓」)。反過來排,
//      線本身跟著一起糊,遠景才真的退到背景去。
//   ③ **鄰居取樣 MUST 過焦外閘**(`step(coc*0.5, ct)`):不擋的話近處清晰物件的顏色會被抹進
//      遠景 = 前景剪影外一圈光暈,而剪影正是玩家在看的東西(FPV 的座艙/武器占畫面很大一塊)。
//   ④ 取樣點是**黃金角螺旋**(填滿圓盤)不是單一圓環:圓環在低取樣數下會糊成甜甜圈邊。
//
// ---- A25 GPU 生命週期 ----
// 這支持有 3 個 RenderTarget + 1 張 depthTexture + **`_quads` 那張表上的每一支**
// FullScreenQuad 材質(現役 5 支:ink / dof / grade / wipe / fxaa),
// **全部** MUST 在 `dispose()` 釋放,而名冊 MUST 由 `_quads` 推導不手寫
// —— 手寫的那一份會在加 pass 時靜默過期。`audit_gpu_lifecycle.mjs` ⑦ 逐項釘住。
//
// ---- RES_GOV 交互(最容易靜默壞掉的一條)----
// RT 尺寸 MUST 由 `renderer.getDrawingBufferSize()` 取得 —— 那已經是
// `_dpr() × _resScale` 的結果。管線自己算像素比 = 調節器降階時 RT 尺寸不動 =
// **調節器整個變成 no-op**,而畫面上只表現成「手機還是一樣卡」,不會有任何錯誤。
import * as THREE from 'three';
import { FullScreenQuad } from 'three/addons/postprocessing/Pass.js';
import { visualPref, onVisualChange } from './visualPrefs.js';
import { INK_UNPACK_GLSL } from './toon.js';
import { DOF, WIPE, combatReachM, wipeAt } from './data.js';

// ---- 勾線資訊緩衝(2026-08-12;材質端的契約住 `toon.js` 的同名段)----
// 第二張附件帶著**視空間法線與 surfaceId**,補上深度看不見的那些線(牆腳與地面、退縮平台的
// 轉折、機體零件的接縫)。實測(shibuya 實景 640×360):上墨像素 7173 → 16243,**2.26 倍**。
//
// 三條:
//   ① **哨兵**:`.a = 0` 代表這一格沒有法線資訊(天空穹頂、護盾殼、粒子、招牌都不寫)。
//      把 0 當法線用就是沿天際線與每一團特效畫粗黑邊。
//   ② 哨兵靠**把第二張單獨清成 0** 成立:`renderer.clear()` 拿 renderer 的 clearColor 清
//      **每一張**附件,而那個顏色不是 0 ⇒ MUST 另外 `clearBufferfv(COLOR, 1, [0,0,0,0])`。
//   ③ 拿不到 MRT(WebGL1)或開關關著 ⇒ 整組退回深度那一份,**逐位元**同這批改動之前。
//
// ---- 第四條:`.a` 帶的是**表面類別**(2026-08-13)----
// 類別碼與寫入端全住 `toon.js INK_CLASS`。本檔兩個消費端:勾線的哨兵、以及 3D LUT 的地貌
// 分支(見下方 `LUT` 段)。勾線本身**不再需要**為地貌寫任何特例:地貌共用一個 surfaceId
// (id 項自動歸零)、貼地拼圖改寫真地形法線(折邊項因此量到地形)—— 兩件事都在寫入端解決。
//
// ---- 第五條:`.a` 自 2026-08-16 起是**打包**(半位元組切;計畫 §0-c / 序 3)----
// 高半位元組 = 類別**索引**(NONE 0 / LAND 1 / HARD 2 / GROUP 3)、低半位元組 = 這一格的
// `outlineContribution`(16 階)。編解碼**只住** `toon.js INK_PACK_GLSL` / `INK_UNPACK_GLSL`,
// 本檔三個讀取點(勾線哨兵 / 勾線貢獻 / LUT 地貌帶)一律轉呼 —— 魔數 16 / 15 / 255 在本檔
// **一個都不准出現**。三條會靜默壞掉的事寫在原地(第 ④ 層):
//   ① **NONE = 「沒有意見」不是「不畫線」**:天空穹頂 / 護盾殼 / 粒子 / 招牌今天都寫哨兵 0,
//      把它們讀成貢獻 0 會把它們**今天有的**深度線整批滅掉(那些線來自深度二階差分,
//      與資訊緩衝無關)⇒ 不是逐位元中性。中心 cls == NONE ⇒ 貢獻 1。
//   ② **沒有資訊的鄰居 MUST 不投票**:一顆飄過去的粒子(cls NONE、深度比背景近)會以
//      floor(0) 把它後面所有的線關掉,症狀是「特效經過的地方線會閃掉」。
//   ③ **最近面覆寫是 `ceil`/`floor` 硬決定,MUST NOT 換成 `mix`/`smoothstep`** —— 那會在
//      每一個與否決面相鄰的物件外圈長出半強度光暈,而那正是這個通道要消掉的東西。
// ⚠ 舊的哨兵門檻 `> 0.25` 在新編碼下**恆不成立**(`.a` 上限 = (3×16+15)/255 = 0.247)⇒
//   折邊勾線整個變 no-op,而使用者看到的是「開了那顆開關沒反應」、console 一個字都沒有。
const INK_MRT = {
  NRM0: 0.05,        // 法線折邊起畫(相鄰兩格視空間法線 xy 的中央差分長度)
  NRM1: 0.42,        // 全強度。實測:同一塊平板 < 0.02、90° 折邊 ≈ 1.0
  ID: 0.55,          // id 不同(不同材質相接)給的強度 —— 比折邊輕,它只是「不同東西」
  // ---- 內部折邊的抑制(2026-08-16;S8)----
  // 五格**同一個表面群組**時把法線折邊那一項的門檻抬高 ⇒ ico 碎面 / 圓柱小面 / 高度場
  // 網格線退場,而節理 / 崖階 / 棧道(它們是**另一個**群組)照樣出線。
  // **深度那一項刻意不抬**:深度跳變 = 前面有東西擋住後面 = 剪影的定義,不管兩邊是不是
  // 同一個表面;順手抬了就是兩顆重疊的石頭糊成一坨。
  SELF_F: 2.4,       // 2026-08-17 定場照 4×4 掃描；MUST > 1(= 1 就是恆等式)
  GRAZE_K: 1.5,      // 同輪定案；門檻 × (1 + K·(1 − n.z))，與 INK.K_S 語意相同
                     // 但**單位不同、值不可共用**。MUST > 0
};
// ---- 勾線參數 ----
const INK = {
  THICK: 1.0,        // 取樣半徑(像素);> 1 會讓細線斷開
  // 門檻的兩項係數與起畫/全強度全部是 **2026-08-03 用 `tools/shot_scene.mjs` 逐輪實測**出來的
  // (定場照 + 除錯輸出把 e 直接畫成紅色通道),不是猜的;調校紀錄見下方 shader 內註解。
  K_D: 0.020,        // 門檻的「距離項」係數(× 該像素深度)—— 遠近一致的那一半
  K_S: 3.0,          // 門檻的「掠射項」係數(× 一階差分)—— 壓掉高度場的網格折邊
  EDGE0: 0.14,       // 起畫(實測:地形網格折邊 e ≈ 0.1、建物輪廓 e ≈ 0.4~1.2)
  EDGE1: 0.36,       // 全強度
  CONCAVE_F: 0.42,   // 凹邊強度倍率(手繪內角線比外輪廓輕)
  DARK: 0.14,        // 墨色(與底色相混的目標值,不是純黑)
  // ---- 遠處淡出的兩個端點(2026-08-16 起是**形狀比**,錨換成霧;序 8 ④-3)----
  // 舊制錨在 `camera.far`(= 地圖邊長 × 2)。那與 `data.js DOF` 檔頭那句「錨也 MUST NOT 取
  // 相機 far 平面:那隨隊制變」是同一條規則,而勾線淡出是**唯一還沒照做的**那一個。
  // 實測(camera.far = span × 2 ⇒ 舊制淡出帶恆為 [1.10, 1.90] × span):
  //   clear 1.9 / cloudy 1.6 / rain 1.0 / snow 1.1 / fog 0.35 —— 霧的遠端只有 `clear` 對得上
  //   (1.90 ≡ 0.95 × 2,這就是這兩個常數當初是在晴天定場照上調出來的證據);
  //   rain / snow / fog **連淡出的起點都排在霧飽和之後** ⇒ 線整段畫在已經全白的霧色上,
  //   那正是「背景在中距離變成線框」。
  FADE0: 0.55,       // 淡出起點 / 終點的**比**(舊制的分母是 camera.far,新制是 fadeEnd)
  FADE1: 0.95,       // 完全不畫線
  FADE_F: 0,         // = FADE0 / FADE1(推導,見下一行;MUST NOT 手寫 0.578…)
};
INK.FADE_F = INK.FADE0 / INK.FADE1;
// ---- 調色(split-tone + 陰影抬升)----
// 賽璐璐的陰影 MUST 是**有顏色的**,不是壓黑的。`uLift` 把最暗的部分抬離 0,
// split-tone 讓暗部偏冷、亮部偏暖 —— 這與 toon.js 的 `CEL_COOL` 是同一個需求的兩個尺度
// (那個逐材質、這個逐畫面),兩者相加才是完整的「陰影是天光反射」。
const GRADE = {
  LIFT: 0.0055,
  SHADOW: [0.86, 0.94, 1.10],
  HIGH: [1.05, 1.01, 0.94],
  SAT: 1.06,
};
// ---- 空氣透視(雙色霧)----
// three 的 `Fog` 只有**一個**顏色:近處與地平線同色 ⇒ 霧讀起來像一層均勻的灰玻璃。
// 兩色霧 = 近端帶當下的日照色、遠端收斂到地平線色(顏色的推導住 `environment.js
// nearFogColor`,強度是 visualPrefs 的 `air` 拉桿)。
//
// **為什麼做在後製而不是材質**:兩色霧要改的是 three 的 `fog_fragment` chunk,而那需要每個
// 材質多一個 uniform —— 內建材質的 uniform 是逐 program 從 `ShaderLib` **clone** 出來的,
// 沒有任何入口能餵一份共享的顏色進去。把它挪到後製之後,材質端一行都不用動。
//
// **這是恆等式不是近似**。材質端已經算完 `out0 = mix(色, 遠端色, f)`,而我們要的是
// `mix(色, mix(近端色, 遠端色, s), f)`,兩者相減 ⇒ `out = out0 + f·(1−s)·(近端色 − 遠端色)`。
// 後製只要用**同一份** near/far 重算 f 就能精確補回那個差額。
// 兩個推論(都是這一段成立的前提,不是巧合):
//   ① f → 1 時 s → 1 ⇒ 補正歸零 ⇒ **「地平線 = 霧色」那條恆等式一格未動**(environment.js
//      的 skyStops 靠它讓遠景融進天空)。
//   ② 天空穹頂 `fog: false` 且深度在遠平面 ⇒ f = 1 ⇒ 一樣補 0,天空不會被染色。
//      (仍留著遠平面早退:那是省一次取樣,不是靠它才對。)
const AIR = {
  // 交接點:像素霧到這個程度時,近端色已經完全讓位給地平線色。abeto 那支叫 `uFogDistance`,
  // 同一個形狀(`smoothstep(0, KNEE, f)`)。太大 ⇒ 近端色一路撐到地平線,與 ① 打架。
  KNEE: 0.65,
};
// ---- 3D LUT 調色(2026-08-12)----
// `GRADE` 那四個常數是**寫死在 commit 裡的美術方向**:改一次就換掉所有人的畫面,而且只能
// 用「乘一個係數」表達得出來的東西。LUT 把整條色彩映射變成一張圖 —— 分區調色、色相旋轉、
// 膠片曲線這些用常數寫不出來的東西,都變成美術可以在外部工具裡調完丟進來的資產。
//
// **兩個來源**(2026-08-12 使用者定案「可設定 2 或 3」):
//   ㋐ `baked` —— 由現行 `GRADE` 的數學**程序生成**一張條狀圖。它不是為了改變畫面(那一段
//      數學一模一樣),而是給美術一個「與現況等價的起點」可以匯出去改。
//   ㋑ `file` —— 讀 `assets/lut.png`(標準條狀 LUT:寬 = size²、高 = size)。**檔案不存在
//      就靜靜地不套**(原則 6):出貨版沒有這張圖 ⇒ 畫面逐位元同今天。
//
// **格式刻意是 2D 條狀而不是 `sampler3D`**:①外部工具(Photoshop / Resolve / Lightroom)
// 匯出的就是這個格式,`Data3DTexture` 還得先在瀏覽器裡拆一次;②GLSL1 就寫得出來,不必為了
// 它把整支 shader 綁上 WebGL2 —— 而「綁上 WebGL2」正是同一輪 MRT 勾線踩到的那顆地雷。
//
// ---- 地貌:LUT **不吃色度、只吃亮度**(2026-08-13 使用者定案)----
// 原話:「LUT 與勾線不針對地貌作用,不要看出地貌拼圖接縫,但地形變化受 LUT 與勾線作用」。
// LUT 是一條任意的映射 ⇒ 它的**局部增益**可以遠大於 1(對比 S 曲線、彩度提升都是),而地被
// 是幾十款拼圖鋪出來的:相鄰兩塊本來只差一兩階的顏色,過完表就被推開成看得見的色塊界 ——
// 使用者看到的「地貌拼圖接縫」。同一條映射在**亮度**上做的事卻正是我們要的:坡面受光、
// 稜線的明暗、路塹的陰影,那是**地形**。
//
// 故地貌走一條仿射的分解(`lutApply` 的 land 分支):
//
//     out = lutApply( vec3(y) ) + ( c − vec3(y) )       , y = 這一格的亮度
//
// 兩個性質是**恆等式**不是調校:
//   ① 色度差**原樣通過**(增益恆為 1)⇒ 兩塊只差顏色、受光相同的拼圖,過表之後差多少
//      就還是差多少 —— LUT 再怎麼激進都不會把接縫「顯影」出來;
//   ② 恆等 LUT ⇒ `lutApply(vec3(y)) = vec3(y)` ⇒ `out ≡ c`,逐位元。
// 拿不到類別(WebGL1 / 沒配第二張附件)⇒ 整片走原本那條(降級不例外,原則 6)。
const LUT = {
  // 程序生成的邊長(條狀圖 1024×32)。**2026-08-12 兩種都量過**:`none` vs `baked` 的
  // 逐像素差 32³ 是 mean 1.28 / max 29(滿分 765)、64³ 是 mean 1.16 / max 29 ——
  // 也就是說**加大格子救不了那個 max**(它來自勾線邊緣那種一格之差的取樣跳動,不是格子太粗),
  // 而貼圖會變成 4096×64(4 倍記憶體)。取 32。
  SIZE: 32,
  // 相鄰兩片之間 MUST 手動內插:硬體只在**片內**做雙線性,片與片之間是不連續的
  // ⇒ 不內插的話漸層上會出現與片數等距的橫向色帶(32 條),而那看起來像「LUT 做壞了」。
};

const QUAD_VS = `
  varying vec2 vUv;
  void main() { vUv = uv; gl_Position = vec4( position.xy, 0.0, 1.0 ); }`;

/**
 * 圓盤取樣點(黃金角螺旋 = 向日葵排列):`a = i × 137.5°`、`r = √((i+0.5)/n)`。
 * √ 是**面積均勻**的來源(不開根號會全部擠在圓心);單一圓環則在低取樣數下糊成甜甜圈邊。
 * 展開成一串具名運算式而不是 GLSL 迴圈 + const 陣列:WebGL1 的 GLSL ES 1.00 沒有陣列
 * 建構式,而這一層本來就該完全展開。
 */
const dofTaps = (n) => Array.from({ length: n }, (_, i) => {
  const a = i * 2.39996323, r = Math.sqrt((i + 0.5) / n);
  return `TAP( ${(Math.cos(a) * r).toFixed(4)}, ${(Math.sin(a) * r).toFixed(4)} )`;
}).join('\n          ');

/** 線性 → sRGB(RT 是 NoColorSpace,最後一 pass 自己轉;three 只對預設 framebuffer 轉) */
const SRGB_GLSL = `
  vec3 toSRGB( vec3 c ) {
    c = clamp( c, 0.0, 1.0 );
    return mix( c * 12.92, 1.055 * pow( c, vec3( 0.41666 ) ) - 0.055, step( 0.0031308, c ) );
  }`;

/**
 * 把現行 `GRADE` 那一段數學**程序生成**成一張條狀 LUT(寬 = size²、高 = size)。
 * 用途不是改變畫面(數學一模一樣),而是給美術「與現況等價的起點」—— 在設定頁切到
 * 「內建(程序生成)」看到的就該與「不使用」幾乎一樣,差的只有量化;把它另存下來丟進
 * Photoshop / Resolve 調完再換成 `assets/lut.png`,就是完整的第 ㋑ 條路。
 *
 * **表是 sRGB 進 sRGB 出**(與 shader 的索引空間同一套,見 `lutApply` ①)。
 * 這裡的數學 MUST 與 shader 那一段逐項相同 —— 兩份會分家,而症狀是「切到內建之後畫面
 * 微妙地不一樣」,沒有人查得出來為什麼。故兩邊都只寫一次 `GRADE` 的四個常數。
 */
export function makeGradeLut(size = LUT.SIZE) {
  const cv = document.createElement('canvas');
  cv.width = size * size; cv.height = size;
  const ctx = cv.getContext('2d', { willReadFrequently: false });
  const img = ctx.createImageData(cv.width, cv.height);
  const toLin = (v) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
  const toS = (v) => (v <= 0.0031308 ? v * 12.92 : 1.055 * v ** (1 / 2.4) - 0.055);
  const smooth = (e0, e1, x) => { const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0))); return t * t * (3 - 2 * t); };
  for (let b = 0; b < size; b++) {
    for (let g = 0; g < size; g++) {
      for (let r = 0; r < size; r++) {
        const c = [toLin(r / (size - 1)), toLin(g / (size - 1)), toLin(b / (size - 1))];
        const l = c[0] * 0.2126 + c[1] * 0.7152 + c[2] * 0.0722;
        const t = smooth(0.18, 0.72, l);
        for (let i = 0; i < 3; i++) {
          c[i] *= GRADE.SHADOW[i] + (GRADE.HIGH[i] - GRADE.SHADOW[i]) * t;
          c[i] = l + (c[i] - l) * GRADE.SAT;
          c[i] = c[i] * (1 - GRADE.LIFT) + GRADE.LIFT;
        }
        const px = ((g * cv.width) + b * size + r) * 4;
        img.data[px] = Math.round(Math.min(1, Math.max(0, toS(c[0]))) * 255);
        img.data[px + 1] = Math.round(Math.min(1, Math.max(0, toS(c[1]))) * 255);
        img.data[px + 2] = Math.round(Math.min(1, Math.max(0, toS(c[2]))) * 255);
        img.data[px + 3] = 255;
      }
    }
  }
  ctx.putImageData(img, 0, 0);
  const tex = new THREE.CanvasTexture(cv);
  tex.needsUpdate = true;
  return tex;
}

export class Pipeline {
  /**
   * @param renderer three 的 WebGLRenderer(像素比由呼叫端管,見檔頭 RES_GOV 註解)
   * @param opts { ink, grade, fxaa, lowPower } —— 全部可關;lowPower 走 8bit RT
   */
  constructor(renderer, scene, camera, opts = {}) {
    this.renderer = renderer;
    this.scene = scene;
    this.camera = camera;
    this.enabled = {
      ink: opts.ink !== false, dof: opts.dof !== false,
      grade: opts.grade !== false, fxaa: opts.fxaa !== false,
      wipe: opts.wipe !== false,
    };
    // 半浮點 RT 在 tile GPU 上是**頻寬**成本(與 game.js 關 MSAA 同一個瓶頸)⇒ 低功耗走 8bit。
    // 8bit 線性緩衝在暗部會有輕微色帶,但那遠比掉幀好。
    this._rtType = opts.lowPower ? THREE.UnsignedByteType : THREE.HalfFloatType;
    this._drawBufSize = new THREE.Vector2();
    this._texelVec = new THREE.Vector2();
    const size = renderer.getDrawingBufferSize(this._drawBufSize);
    this._size = size.clone();
    // 勾線資訊緩衝的能力閘:three 0.160 的 MRT 是 `WebGLMultipleRenderTargets`
    //(`WebGLRenderTarget({ count })` 是 r162 之後才有的),而它只在 WebGL2 上成立。
    // **能力與開關分開記**:開關可以即時切,能力不會變。
    this._mrtCap = renderer.capabilities.isWebGL2 === true
      && typeof THREE.WebGLMultipleRenderTargets === 'function';
    // **配不配第二張**與**誰在用它**是兩件事(2026-08-13):3D LUT 的地貌分支也要讀類別碼,
    // 而它與折邊勾線是兩個獨立的設定。合成一個旗標的話,開了 LUT 就等於偷偷把折邊勾線也
    // 打開(墨線量 2.2 倍),而使用者只動了調色那一欄。
    this._mrt = this._wantInfo();
    this._inkMrt = this._mrt && visualPref('inkMrt') === 'on';
    this._inkGrp = this._mrt && visualPref('inkGroup') === 'on';
    this.rtScene = this._mkRT(true);
    this.rtA = this._mkRT(false);
    this.rtB = this._mkRT(false);

    this.inkQuad = new FullScreenQuad(this._inkMaterial());
    // 取樣數折半走與 8bit RT 同一條降級規則(tile GPU 的瓶頸是頻寬,而這一 pass 對焦外
    // 的每個像素都是 1 + n 次取樣)。展開在 shader 原始碼裡 ⇒ 兩者是不同的程式,不是分支。
    this.dofQuad = new FullScreenQuad(this._dofMaterial(opts.lowPower ? Math.max(2, DOF.TAPS >> 1) : DOF.TAPS));
    this.gradeQuad = new FullScreenQuad(this._gradeMaterial());
    this.fxaaQuad = new FullScreenQuad(this._fxaaMaterial());
    this.wipeQuad = new FullScreenQuad(this._wipeMaterial());
    this._quads = {
      ink: this.inkQuad, dof: this.dofQuad, grade: this.gradeQuad,
      wipe: this.wipeQuad, fxaa: this.fxaaQuad,
    };
    // 斜向轉場(序 8 ④-1)。同 `_dofRange` 的寧缺勿錯:沒有轉場在跑就**整個 pass 退出鏈**。
    this._wipeKnob = 0;    // = visualPref('wipe');0 ⇒ playWipe 同步走回呼、幕從不出現
    this._wipeA = 0;       // 這一幀有沒有東西要畫(閘門形狀逐字鏡射 dof 那一列)
    this._wipe = null;     // { mode, t, onCut } —— 由 render() 逐幀推進,**MUST NOT 用 setTimeout**
    this._wipeT0 = null;   // 自己的時鐘(render() 沒有 dt);背景分頁的長 dt MUST 夾住
    // 景深的兩個轉折點由呼叫端餵(`setDof`)。**沒餵過就不掛這一 pass** —— 猜一個距離的話
    // 就是「某個消費端的遠景莫名其妙糊掉」,而預設不生效才是寧缺勿錯(原則 6)。
    this._dofRange = null;
    // 進鏡程度(0~1)。**預設 1 = 不做狙擊閘**:那是戰場才有的概念,設定頁樣品與定場鏡頭組
    // 沒有「瞄準」這回事,預設 0 的話它們會靜靜地什麼都不糊 = 拉桿與定場照都看不到這一層。
    this._dofBlend = 1;
    // 空氣透視:同 `_dofRange` 的寧缺勿錯 —— 呼叫端沒餵過顏色與距離就恆不生效
    this._airOn = false;
    this._airA = 0;
    // 3D LUT:同樣的寧缺勿錯 —— 呼叫端沒餵過就恆不生效
    this._lutOn = false;
    this._lutA = 0;
    this._lutOwned = null;   // 由本管線生成的那一張(程序生成路徑),dispose() 要收

    // 勾線強度拉桿(visualPrefs.js):線的濃淡是**口味**,不同螢幕看起來差很多 ——
    // 給一個 uniform 讓玩家自己定案,而不是把某一台螢幕上調出來的數字寫死給所有人。
    // 拉到 0 = 沒有線(等同 `?ink=0`,但不必重開);預設 1 = 定場照調校出來的現值。
    // MUST 是 uniform 不是重建材質:重建會在拉桿拖動時每一格丟一次 shader 編譯。
    this._syncPrefs = () => {
      this.inkQuad.material.uniforms.uInk.value = visualPref('ink');
      // 景深強度同理走 uniform;但**拉到 0 時整個 pass 退出鏈**(見 render 組 chain 那一段)
      // —— 這一 pass 與勾線不同,它是後加的成本,0% MUST 是「不跑」而不是「跑一個乘 0 的」。
      this._dofA = DOF.MAX_R * visualPref('dof');
      this._pushDofA();
      // 空氣透視走一般 uniform(不退出鏈):它與勾線同層 —— grade pass 本來就每幀跑,
      // 0% 只是讓 shader 裡那一段分支跳過,沒有「省一個 pass」可言。
      this._airA = visualPref('air');
      this._pushAirA();
      this._lutA = visualPref('lut');
      this._pushLutA();
      this._syncLutSrc();
      // 轉場:拉桿 0 ⇒ `playWipe` 早退並**同步**走回呼 ⇒ 連時序都逐位元同舊制
      this._wipeKnob = visualPref('wipe');
      if (this._wipeKnob <= 0) { this._wipe = null; this.setWipe(0, 0); }
      this._syncMrt();
    };
    this._syncPrefs();
    this._offPrefs = onVisualChange(this._syncPrefs);
  }

  /**
   * RenderTarget 的**唯一建構點**(A25:三張 RT + depthTexture 都要能被 dispose 找到)。
   * `depth` 那一張在開關打開時是**兩張附件**(第 1 張 = 勾線資訊緩衝)。
   */
  _mkRT(depth) {
    const w = Math.max(1, this._size.x), h = Math.max(1, this._size.y);
    const opt = {
      type: this._rtType, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter,
      depthBuffer: true, stencilBuffer: false,
    };
    const rt = depth && this._mrt
      ? new THREE.WebGLMultipleRenderTargets(w, h, 2, opt)
      : new THREE.WebGLRenderTarget(w, h, opt);
    // 附件 1 帶的是**打包過的整數**(類別索引 × 16 + 貢獻階),線性內插會把相鄰的 q 混成
    // 一個不存在的類別。今天沒事只因 `INK.THICK = 1.0` 讓取樣偏移恰好落在 texel 中心 ——
    // 一旦有人動 THICK 就壞,而那表現成「某些表面的線莫名其妙全沒了」。
    // ⚠ 守衛 MUST 是 `Array.isArray`:退場路徑(WebGL1 / 旋鈕全關)上 `rt.texture` 是**單一
    //   Texture**,`rt.texture[1]` 是 undefined ⇒ 直接 TypeError 把**預設路徑**的整條管線
    //   在建構子炸掉。r160 的 `WebGLMultipleRenderTargets.setSize` 只改 image.width/height
    //   ⇒ 濾波設定在 resize 之後仍在;`_syncMrt` 重建也走同一支 ⇒ 不必第二處。
    if (Array.isArray(rt.texture)) {
      rt.texture[1].minFilter = THREE.NearestFilter;
      rt.texture[1].magFilter = THREE.NearestFilter;
    }
    if (depth) {
      rt.depthTexture = new THREE.DepthTexture(w, h);
      rt.depthTexture.type = THREE.UnsignedIntType;
    }
    return rt;
  }

  /**
   * 資訊緩衝要不要配(**唯一判據**)。兩個消費端各自獨立:折邊勾線的開關、以及 3D LUT
   * 的來源(來源 = none 時整條 LUT 不生效 ⇒ 也不必為它多配一張附件)。
   */
  _wantInfo() {
    return this._mrtCap && (visualPref('inkMrt') === 'on' || visualPref('lutSrc') !== 'none'
      || visualPref('inkGroup') === 'on');
  }

  /**
   * 資訊緩衝與兩個消費端的**即時切換**(設定頁 `inkMrt` / `lutSrc`)。
   * **場景材質恆寫第二張**(見 toon.js 的材質契約:宣告在單附件上也合法)⇒ 切開關只需要
   * 重建場景 RT 與兩支全螢幕材質,**不必重編譯任何場景材質** —— 那正是「無條件宣告」換來的。
   */
  _syncMrt() {
    const want = this._wantInfo();
    const wantInk = want && visualPref('inkMrt') === 'on';
    // 群組早退是**第三個消費端**,MUST NOT 與 `_inkMrt` 合成一個旗標(同 LUT 那一條:
    // 合成 = 開群組剪影順手把折邊勾線也打開,墨線量 2.2 倍而使用者只動了另一欄)。
    const wantGrp = want && visualPref('inkGroup') === 'on';
    if (want === this._mrt && wantInk === this._inkMrt && wantGrp === this._inkGrp) return;
    if (want !== this._mrt) {
      this._mrt = want;
      this.rtScene.depthTexture?.dispose();
      this.rtScene.dispose();
      this.rtScene = this._mkRT(true);
      this.gradeQuad.material.dispose();       // 地貌分支編進去了,MUST 重建
      this.gradeQuad.material = this._gradeMaterial();
      // 新材質的 uniform 是空的 ⇒ **三組值都要重掛**(漏掉哪一組就是「切了折邊勾線之後
      // 空氣透視/LUT 自己關掉了」,而那看起來完全像另一個 bug)。LUT 直接重掛既有那一張,
      // MUST NOT 走 _syncLutSrc —— 那支對 `file` 會再讀一次檔。
      if (this._air) this.setAirFog(...this._air);
      this.setLut(this._lutTex || null, this._lutN || LUT.SIZE);
    }
    this._inkMrt = wantInk;
    this._inkGrp = wantGrp;
    this.inkQuad.material.dispose();           // 著色器把 mrt 編進去了,MUST 重建
    this.inkQuad.material = this._inkMaterial();
    this.inkQuad.material.uniforms.uInk.value = visualPref('ink');
  }

  /**
   * 景深的兩個轉折點(公尺;`near` = 開始糊、`far` = 全糊)。**唯一寫入點** ——
   * 戰場與定場鏡頭組餵 `data.js dofNearM()/dofFarM()`(由全場最遠交戰距離推導,456 / 608m)、
   * 設定頁樣品餵它自己那個 24m 場景的尺度 —— **兩軌同 `toon.js _rampTint` 的 mech/env:
   * 同一套規則、兩組尺度**。沒有這一支的話樣品那 24m 全部落在 456m 的焦內帶裡 = 拉桿拉了
   * 看不出差異,而那正是陰影偏色與風化密度各踩過一次的同一個坑。
   */
  setDof(near, far) {
    if (!(near >= 0) || !(far > near)) { this._dofRange = null; return; }
    this._dofRange = [near, far];
    const u = this.dofQuad.material.uniforms;
    u.uDofNear.value = near;
    u.uDofFar.value = far;
  }

  /**
   * 進鏡程度 0~1(2026-08-09 使用者補充「遠景景深模糊只有在狙擊模式」)。**逐幀呼叫** ——
   * 值由 `data.js dofAimBlend` 自當下 fov 反解,本檔 MUST NOT 自己判 `aiming` 或自己跑淡入
   * (那就是第二條時間曲線,模糊會比鏡頭慢半拍)。0 ⇒ 整個 pass 退出鏈 ⇒ 一般視角的成本
   * 逐位元回到這批改動之前,而這也是這一層真正便宜的地方:它只在進鏡那幾秒跑。
   */
  setDofBlend(f) {
    const v = Math.max(0, Math.min(1, f || 0));
    if (v === this._dofBlend) return;      // 逐幀呼叫 ⇒ 沒變就不要碰 uniform
    this._dofBlend = v;
    this._pushDofA();
  }

  /** `uDofA` 的**唯一寫入點**:拉桿強度 × 進鏡程度。兩個來源各寫一次 = 後寫的把前一個蓋掉 */
  _pushDofA() {
    this.dofQuad.material.uniforms.uDofA.value = this._dofA * this._dofBlend;
  }

  /**
   * 空氣透視的兩個顏色與 `scene.fog` 的兩段距離(檔頭 AIR)。**唯一寫入點** ——
   * 戰場餵 `environment.js` 回傳的 `air`(顏色由 TIMES/SEASONS/WEATHERS 推導),
   * 樣品餵它自己那個場景的尺度。**沒餵過就不生效**(同 `setDof` 的寧缺勿錯):
   * 猜一組距離的結果是「某個消費端的遠景莫名其妙變色」。
   *
   * `fogNear`/`fogFar` MUST 與 `scene.fog` 逐位元相同 —— 那是恆等式成立的前提(檔頭)。
   */
  setAirFog(nearC, farC, fogNear, fogFar) {
    if (!nearC || !farC || !(fogFar > fogNear)) { this._airOn = false; this._air = null; this._pushAirA(); return; }
    this._air = [nearC, farC, fogNear, fogFar];   // grade 材質重建時要原樣重掛(_syncMrt)
    const u = this.gradeQuad.material.uniforms;
    u.uAirNear.value.copy(nearC);
    u.uAirFar.value.copy(farC);
    u.uFogN.value = fogNear;
    u.uFogF.value = fogFar;
    this._airOn = true;
    this._pushAirA();
  }

  /** `uAirA` 的**唯一寫入點**:拉桿強度 × 有沒有餵過距離 */
  _pushAirA() {
    this.gradeQuad.material.uniforms.uAirA.value = this._airOn ? this._airA : 0;
  }

  /**
   * 3D LUT(檔頭 LUT)。**唯一寫入點**;`tex = null` ⇒ 不套(拉桿再怎麼拉都不生效)。
   * `size` 是立方體邊長,**MUST 與圖寬相符**(寬 = size² × 高 = size)—— 對不上的話取樣會
   * 整片位移,而畫面上表現成「顏色怪怪的」而不是任何錯誤。
   * 貼圖狀態三條,每一條寫錯都不報錯:
   *   ① **`flipY = false`**。three 對貼圖預設 `flipY = true`(那是給照片的慣例),而 LUT 的
   *      第 g 列就是綠色索引 g —— 翻過來等於**綠色軸整條反過來查**,畫面會整片變色而
   *      看起來像「這張 LUT 做壞了」。2026-08-12 實測:漏掉它 mean Δ = 173/765。
   *   ② **LinearFilter**:R/G 兩軸的內插交給硬體(藍軸由 `lutApply` 手動做)。半個 texel 的
   *      內縮保證取樣點不會越過每一片最外側的 texel 中心 ⇒ 不會吃到鄰片。
   *   ③ **NoColorSpace**:這是查表資料不是照片,three MUST NOT 再幫它做一次 sRGB → linear
   *      (`lutApply` 自己在 sRGB 空間索引、出來才轉線性)。
   */
  setLut(tex, size = LUT.SIZE) {
    const u = this.gradeQuad.material.uniforms;
    if (this._lutOwned && this._lutOwned !== tex) { this._lutOwned.dispose(); this._lutOwned = null; }
    if (tex) {
      tex.flipY = false;
      tex.minFilter = THREE.LinearFilter;
      tex.magFilter = THREE.LinearFilter;
      tex.wrapS = THREE.ClampToEdgeWrapping;
      tex.wrapT = THREE.ClampToEdgeWrapping;
      tex.generateMipmaps = false;
      tex.colorSpace = THREE.NoColorSpace;
      tex.needsUpdate = true;
      u.uLutSize.value.set(size, 1 / size);
    }
    u.tLut.value = tex || null;
    this._lutTex = tex || null;                  // grade 材質重建時原樣重掛(_syncMrt)
    this._lutN = tex ? size : (this._lutN || LUT.SIZE);
    this._lutOn = !!tex;
    this._pushLutA();
  }

  /** `uLutA` 的**唯一寫入點**:拉桿強度 × 有沒有餵過 LUT */
  _pushLutA() {
    this.gradeQuad.material.uniforms.uLutA.value = this._lutOn ? this._lutA : 0;
  }

  /**
   * LUT 來源(設定頁的三選一;2026-08-12 使用者定案「可設定 2 或 3」)。
   * `none` = 不套(預設,逐位元同舊制)/ `baked` = 程序生成 / `file` = `assets/lut.png`。
   * 讀檔失敗一律**靜靜地退回不套**(原則 6):出貨版本來就沒有那張圖。
   */
  _syncLutSrc() {
    const src = visualPref('lutSrc');
    if (src === this._lutSrc) return;      // 拉桿廣播是整份送的,沒換來源就不要重建貼圖
    this._lutSrc = src;
    if (src === 'baked') {
      const tex = makeGradeLut(LUT.SIZE);
      this._lutOwned = tex;
      this.setLut(tex, LUT.SIZE);
    } else if (src === 'file') {
      new THREE.TextureLoader().load(
        `${document.baseURI.replace(/[^/]*$/, '')}assets/lut.png`,
        (tex) => {
          // 非同步:回來時來源可能已經被切走(或整支已 dispose)⇒ 回來再確認一次
          if (this._lutSrc !== 'file' || !this.gradeQuad) { tex.dispose(); return; }
          this._lutOwned = tex;
          this.setLut(tex, tex.image?.height || LUT.SIZE);
        },
        undefined,
        () => { if (this._lutSrc === 'file') this.setLut(null); },
      );
      this.setLut(null);                   // 載入完成前先不套
    } else {
      this.setLut(null);
    }
  }

  /**
   * 勾線遠處淡出的兩個端點(公尺;序 8 ④-3;2026-08-19 已放行)。**推導只有這一份。**
   *
   * 錨 = `scene.fog`(那正是 `setAirFog` 的 docstring 已經要求「與 `scene.fog` 逐位元相同」
   * 的同一個物件 ⇒ 不開第二個寫入點),而不是 `camera.far`(= 地圖邊長 × 2,隨隊制變)。
   *
   * **地板 `combatReachM() / FADE_F`**:與 `data.js DOF` 檔頭那條「打得到的東西恆為全清晰」
   * 逐條對稱 —— 它讓「打得到的東西恆有線」也變成結構保證。沒有地板的話迷你地圖 + 霧天
   * (span 480 × 0.35 = 168m)會讓 `fadeStart` 落在交戰距離 304m 裡面,甚至 `fade0 > fade1`
   * (smoothstep 端點反轉)。
   *
   * `scene.fog` 缺席(樣品 / `shot_veg` 那類無霧場景)MUST **退回舊式**(原則 6)——
   * 直接讀 `fog.far` 會拿到 undefined ⇒ `smoothstep(NaN, NaN, d)` ⇒ **整片沒有線**,
   * 而每一條離線斷言都會過(它們讀的是原文不是執行結果)。
   */
  _inkFadeM() {
    const f = this.scene?.fog;
    const end = (f && f.far > 0)
      ? Math.max(f.far, combatReachM() / INK.FADE_F)
      : this.camera.far * INK.FADE1;
    return [end * INK.FADE_F, end];
  }

  _inkMaterial() {
    const mrt = this._inkMrt;
    const grp = this._inkGrp;
    // **配不配資訊緩衝 vs 誰在用它是兩件事**(同 _wantInfo 那一條):折邊勾線與群組
    // 早退是兩個獨立的消費端,任一個開著就要取樣 tInfo,但只有折邊那一個會加墨線。
    const useInfo = mrt || grp;
    return new THREE.ShaderMaterial({
      uniforms: {
        tColor: { value: null }, tDepth: { value: null }, tInfo: { value: null },
        uTexel: { value: new THREE.Vector2() },
        uNear: { value: 0.5 }, uFar: { value: 1000 }, uInk: { value: 1 },
        // 遠處淡出的兩個端點(公尺)。由 `_inkFadeM()` 每幀餵入 —— **MUST NOT** 在著色器裡
        // 拿 `uFar × 比例` 算(那就是錨回相機 far 平面,見 INK.FADE0 旁邊那一段)。
        uFade0: { value: 1e9 }, uFade1: { value: 2e9 },
      },
      vertexShader: QUAD_VS,
      fragmentShader: `
        uniform sampler2D tColor; uniform sampler2D tDepth;
        uniform vec2 uTexel; uniform float uNear; uniform float uFar; uniform float uInk;
        uniform float uFade0; uniform float uFade1;
        varying vec2 vUv;
        ${useInfo ? `uniform sampler2D tInfo;\n${INK_UNPACK_GLSL}` : ''}
        float lin( vec2 uv ) {                     // 非線性深度 → 視線距離(公尺)
          float z = texture2D( tDepth, uv ).x * 2.0 - 1.0;
          return ( 2.0 * uNear * uFar ) / ( uFar + uNear - z * ( uFar - uNear ) );
        }
        void main() {
          vec4 base = texture2D( tColor, vUv );
          float d = lin( vUv );
          // ③ 天空早退:天空的深度就是 far,不擋掉會沿整條天際線畫出一條粗黑邊
          if ( d >= uFar * 0.995 ) { gl_FragColor = base; return; }
          vec2 t = uTexel * ${INK.THICK.toFixed(2)};
          float l = lin( vUv - vec2( t.x, 0.0 ) ), r = lin( vUv + vec2( t.x, 0.0 ) );
          float u = lin( vUv + vec2( 0.0, t.y ) ), b = lin( vUv - vec2( 0.0, t.y ) );
          // 二階差分(拉普拉斯):平面恆 0 —— 掠射的地面不會刷滿線(見檔頭)
          float lap = ( l + r + u + b ) - 4.0 * d;
          // 門檻 = **距離項 + 掠射項**,兩項缺一不可(2026-08-03 定場照四輪實測):
          //   ・只有距離項(lap/d):地形是高度場、由 193² 個平三角面拼成,每一條網格折邊
          //     都是**真的**折邊 ⇒ 整片山坡畫滿等高線一樣的細線;把門檻拉高到山坡乾淨時,
          //     300m 外的建物輪廓(深度跳變只有 20m)也一起不見了 —— 兩者在 lap/d 上重疊。
          //   ・只有掠射項(lap 除以一階差分,相對曲率):重疊在 0.3~0.7,同樣是「山坡乾淨了、
          //     建物的線也沒了」(第二版實測,整個世界回到沒有描邊)。
          //   ・兩項相加才分得開:掠射的地面**一階差分極大**(每像素跑好幾公尺)⇒ 門檻自動抬高;
          //     建物輪廓的一階差分只有那一格跳變 ⇒ 門檻仍低,線畫得出來。
          float slope = abs( l - r ) + abs( u - b );
          float e = lap / max( 0.001, d * ${INK.K_D.toFixed(3)} + slope * ${INK.K_S.toFixed(1)} );
          // 門檻 MUST 吃 **|e| 本身**,凸/凹的強度差要**乘在 smoothstep 之後**。
          // 反過來寫(先乘 CONCAVE_F 再進 smoothstep)= 把凹邊的門檻整個往上推 1/0.42 倍 ——
          // 而建物輪廓在這個 stencil 下大多算凹邊(近景像素旁邊是更遠的背景)⇒ 整批被吃掉:
          // 2026-08-03 定場照的除錯輸出裡,建物邊的 e 明明有 2 以上,ink 卻是 0。
          float ae = abs( e );
          ${useInfo ? `
          // ---- 法線折邊 + 面 id(勾線資訊緩衝;見檔頭 INK_MRT)----
          // 五次取樣**排在早退之前**:這一項存在的理由就是「深度看不見的那些邊」,
          // 拿深度來決定要不要看它等於把它關掉。這是開關打開時要付的錢。
          vec4 i0 = texture2D( tInfo, vUv );
          vec4 il = texture2D( tInfo, vUv - vec2( t.x, 0.0 ) ), ir = texture2D( tInfo, vUv + vec2( t.x, 0.0 ) );
          vec4 iu = texture2D( tInfo, vUv + vec2( 0.0, t.y ) ), ib = texture2D( tInfo, vUv - vec2( 0.0, t.y ) );
          float mrtEdge = 0.0;
          // .a 是打包過的 ⇒ **一律先解碼**(舊的 > 0.25 在新編碼下恆不成立,見檔頭第五條)
          float c0 = inkCls( i0.a ), cl = inkCls( il.a ), cr = inkCls( ir.a );
          float cu = inkCls( iu.a ), cb = inkCls( ib.a );
          // 中心貢獻:**cls == NONE ⇒ 1(沒有意見)不是 0**(檔頭第五條 ①)
          float ctr = ( c0 > 0.5 ) ? inkCtr( i0.a ) : 1.0;
          // 五格都要有資訊(哨兵)。缺一格就當這裡沒有第二訊號 —— 交界那一圈交給深度那一份,
          // 而天空/特效/招牌整片都沒有資訊 ⇒ 它們一條新線都不會多出來。
          if ( min( min( c0, min( cl, cr ) ), min( cu, cb ) ) > 0.5 ) {
            // 中央差分:與深度那一項用**同一組偏移**,兩種線才會落在同一排像素上
            float nrm = length( vec2( length( il.rg - ir.rg ), length( iu.rg - ib.rg ) ) );
            float idv = max( abs( il.b - ir.b ), abs( iu.b - ib.b ) );
            // ---- 內部折邊的抑制(S8)----
            // same = 五格同一個表面群組(**只在哨兵齊全的分支內成立** ⇒ 分支外恆 0,
            // 天空/特效那一圈的剪影一格不動);nz 由中央格的法線 xy 反解掠射程度。
            float same = 1.0 - step( 0.004, idv );
            vec2 n0 = i0.rg * 2.0 - 1.0;
            float nz = sqrt( max( 0.0, 1.0 - dot( n0, n0 ) ) );
            float gz = 1.0 + ${INK_MRT.GRAZE_K.toFixed(2)} * ( 1.0 - nz );${mrt ? `
            // 門檻 MUST 經 mix(…, same) 切換而不是常數;**深度那一項刻意不抬**(見 INK_MRT)。
            float t0 = mix( ${INK_MRT.NRM0.toFixed(3)}, ${INK_MRT.NRM0.toFixed(3)} * ${INK_MRT.SELF_F.toFixed(2)}, same ) * gz;
            float t1 = mix( ${INK_MRT.NRM1.toFixed(3)}, ${INK_MRT.NRM1.toFixed(3)} * ${INK_MRT.SELF_F.toFixed(2)}, same ) * gz;
            mrtEdge = max(
              smoothstep( t0, t1, nrm ),
              step( 0.004, idv ) * ${INK_MRT.ID.toFixed(2)} );` : ''}${grp ? `
            // ---- 群組早退(INK_GRP;②-1 與石堆項共用)----
            // 「五格同號**且至少一格是 GROUP**」⇒ 整格不畫:整株樹 / 整顆巨岩讀成一個剪影。
            // 「至少一格」而不是「最近那一格」是刻意的 —— 樹幹(HARD)與樹冠(GROUP)共用
            // 同一株的面號 ⇒ 幹內部的折邊留著、幹與冠的交界不出線,而且省掉 5 路 argmin。
            float grpMax = max( max( c0, max( cl, cr ) ), max( cu, cb ) );
            // **五格都不是 LAND** 這道閘是為了地貌分區子帶(序 4 ①-3)先放的:
            // 分區子帶與群組號共用整數格那把梳子,萬一撞號,早退會讓整株樹對著那一種地面
            // **整個剪影消失**(不是既有那條「撞號 = 少一條線」)。
            // ⚠ 今天它是**恆真**的:地貌恆 LAND_SURF_ID = 0,而群組號 k ≥ 2 ⇒ 兩者的 idv
            //   恆 ≥ 0.03 > 0.004 ⇒ same 本來就是 0,這一格永遠走不到 ⇒ **逐位元中性**。
            float grpMin = min( min( c0, min( cl, cr ) ), min( cu, cb ) );
            if ( same > 0.5 && grpMax > 2.5 && grpMin > 1.5 ) { gl_FragColor = base; return; }` : ``}
            // ---- 最近面覆寫(硬決定)----
            // 逐鄰居投票:**沒有資訊的鄰居不投票**(檔頭第五條 ②);ceil / floor
            // MUST NOT 換成 mix / smoothstep(檔頭第五條 ③)。深度就用既有的 l/r/u/b。
            float minD = d, minC = ctr;
            if ( cl > 0.5 && l < minD ) { minD = l; minC = inkCtr( il.a ); }
            if ( cr > 0.5 && r < minD ) { minD = r; minC = inkCtr( ir.a ); }
            if ( cu > 0.5 && u < minD ) { minD = u; minC = inkCtr( iu.a ); }
            if ( cb > 0.5 && b < minD ) { minD = b; minC = inkCtr( ib.a ); }
            if ( minD < d ) { ctr = ( minC > ctr ) ? max( ctr, ceil( minC ) ) : min( ctr, floor( minC ) ); }
          }
          // 兩個訊號都跨不過門檻才早退(貢獻歸零的那一格也一樣不必再算下去)
          if ( ( ae <= ${INK.EDGE0.toFixed(3)} && mrtEdge <= 0.0 ) || ctr <= 0.0 ) { gl_FragColor = base; return; }` : `
          // 早退:軟性倍率 ∈ (0,1] ⇒ ae × soft ≤ ae,硬性門檻都跨不過的一定也跨不過。
          // 絕大多數像素在這裡離開(邊緣偵測本來就只有少數像素有值)⇒ 下面那四個 alpha
          // 取樣只發生在「真的要畫線」的像素上,平均成本接近零。
          if ( ae <= ${INK.EDGE0.toFixed(3)} ) { gl_FragColor = base; return; }`}
          // 軟性倍率取**這一格與四鄰的最小值**:一條輪廓線同時落在物件側與背景側的像素上,
          // 只看中心的話背景側那半條仍是硬性粗細 ⇒ 葉叢邊緣會一半粗一半細。
          // 四鄰用的是與深度取樣**同一組偏移**(同一條線的兩側必定在其中)。
          float soft = min( min( base.a, texture2D( tColor, vUv - vec2( t.x, 0.0 ) ).a ),
                       min( min( texture2D( tColor, vUv + vec2( t.x, 0.0 ) ).a,
                                 texture2D( tColor, vUv + vec2( 0.0, t.y ) ).a ),
                                 texture2D( tColor, vUv - vec2( 0.0, t.y ) ).a ) );
          soft = clamp( soft, 0.0, 1.0 );   // 硬性恆 1 ⇒ 這一行以下逐位元同舊制
          float ink = smoothstep( ${INK.EDGE0.toFixed(3)}, ${INK.EDGE1.toFixed(3)}, ae * soft );
          if ( e > 0.0 ) ink *= ${INK.CONCAVE_F.toFixed(2)};   // 凹邊(牆角內側)比外輪廓輕
          ${mrt ? `
          // 折邊/id 那一份**取 max 不是相加**:同一條輪廓線兩個訊號常常同時有值,相加會把
          // 建物邊界推成兩倍濃的實線。它一樣吃軟性倍率(葉叢的折邊也該是細線)。
          // 凹凸權重刻意**不套**在它身上:法線差分沒有凹凸的方向資訊,乘上去只是把折邊
          // 整批打 ${INK.CONCAVE_F.toFixed(2)} 折。
          ink = max( ink, mrtEdge * soft );` : ''}${useInfo ? `
          // 貢獻(§0-c 的低半位元組):1 = 舊制(inkQuant(1) 嚴格 === 1)⇒ 這一行是恆等式。
          ink *= ctr;` : ''}
          // ② 遠處淡出:遠景線密到變雜訊,而且會蓋掉霧 ⇒ **淡出帶 ≡ 霧帶**(序 8 ④-3)
          ink *= 1.0 - smoothstep( uFade0, uFade1, d );
          // 強度拉桿:夾在 [0,1] —— 拉桿最大到 150% 是為了讓「線更濃」有得調,
          // 但覆蓋率本身是機率意義的權重,超過 1 只會把半透明的線推成實線,不會更黑。
          ink = clamp( ink * uInk, 0.0, 1.0 );
          // ① 墨色與底色相混,不是塗黑
          gl_FragColor = vec4( mix( base.rgb, base.rgb * ${INK.DARK.toFixed(2)}, ink ), base.a );
        }`,
    });
  }

  /**
   * 景深模糊(檔頭「景深模糊」那一段)。距離一律吃 `uDofNear`/`uDofFar`(公尺,由 `setDof`
   * 餵入)—— 本檔 MUST NOT 手寫任何公尺數:那兩個轉折點是 `data.js dofNearM/dofFarM` 由
   * 狙擊模式可視範圍推導的,寫死在著色器裡就與「這台機體看得多遠」分家了。
   * @param taps 圓盤取樣數(低功耗折半)
   */
  _dofMaterial(taps) {
    return new THREE.ShaderMaterial({
      uniforms: {
        tColor: { value: null }, tDepth: { value: null },
        uTexel: { value: new THREE.Vector2() },
        uNear: { value: 0.5 }, uFar: { value: 1000 },
        uDofNear: { value: 1e9 }, uDofFar: { value: 2e9 }, uDofA: { value: 0 },
      },
      vertexShader: QUAD_VS,
      fragmentShader: `
        uniform sampler2D tColor; uniform sampler2D tDepth;
        uniform vec2 uTexel; uniform float uNear; uniform float uFar;
        uniform float uDofNear; uniform float uDofFar; uniform float uDofA;
        varying vec2 vUv;
        float lin( vec2 uv ) {                     // 非線性深度 → 視線距離(公尺),與勾線同式
          float z = texture2D( tDepth, uv ).x * 2.0 - 1.0;
          return ( 2.0 * uNear * uFar ) / ( uFar + uNear - z * ( uFar - uNear ) );
        }
        void main() {
          vec4 base = texture2D( tColor, vUv );
          // 焦外程度 0~1。天空的深度就是 far ⇒ coc 恆為 1,**刻意不早退**:天空本來就在全糊帶
          // 裡,而它是平滑漸層 ⇒ 糊它看不出差別也幾乎沒有成本,特判反而會在天際線切出一條
          // 「糊的地面 / 清晰的天空」的硬邊(勾線那邊要早退是因為它畫的是**線**,不是同一件事)。
          float coc = smoothstep( uDofNear, uDofFar, lin( vUv ) );
          float rp = coc * uDofA / uTexel.y;       // 半徑(像素)= 焦外程度 × 螢幕高度比例
          // 焦內早退:半徑不到半個像素就沒有任何取樣意義。絕大多數交戰畫面落在這裡 ⇒
          // 這一 pass 的平均成本 = 一次深度 + 一次顏色取樣。
          if ( rp < 0.5 ) { gl_FragColor = base; return; }
          vec3 sum = base.rgb; float wsum = 1.0;
          // 焦外閘:只收「自己也在糊帶裡」的鄰居。不擋的話近處清晰物件會被抹進遠景 =
          // 前景剪影外一圈光暈(見檔頭 ③)。門檻取中心的一半 = 容許糊帶內的漸層互相混合。
          #define TAP(dx,dy) { vec2 o = vec2( dx, dy ) * rp * uTexel; \
            float w = step( coc * 0.5, smoothstep( uDofNear, uDofFar, lin( vUv + o ) ) ); \
            sum += texture2D( tColor, vUv + o ).rgb * w; wsum += w; }
          ${dofTaps(taps)}
          #undef TAP
          gl_FragColor = vec4( sum / wsum, base.a );
        }`,
    });
  }

  _gradeMaterial() {
    const g = GRADE;
    const info = this._mrt;
    return new THREE.ShaderMaterial({
      uniforms: {
        tColor: { value: null },
        // tDepth / uNear / uFar 由 render() 的共用接線自動餵(與勾線、景深同一段)
        tDepth: { value: null }, uNear: { value: 0.5 }, uFar: { value: 1000 },
        ...(info ? { tInfo: { value: null } } : {}),
        uAirNear: { value: new THREE.Color(0, 0, 0) }, uAirFar: { value: new THREE.Color(0, 0, 0) },
        uFogN: { value: 0 }, uFogF: { value: 1 }, uAirA: { value: 0 },
        tLut: { value: null }, uLutA: { value: 0 }, uLutSize: { value: new THREE.Vector2(LUT.SIZE, 1 / LUT.SIZE) },
      },
      vertexShader: QUAD_VS,
      fragmentShader: `
        uniform sampler2D tColor; uniform sampler2D tDepth;
        uniform float uNear; uniform float uFar;
        uniform vec3 uAirNear; uniform vec3 uAirFar;
        uniform float uFogN; uniform float uFogF; uniform float uAirA;
        uniform sampler2D tLut; uniform float uLutA; uniform vec2 uLutSize;   // x = 邊長, y = 1/邊長
        ${info ? `uniform sampler2D tInfo;\n${INK_UNPACK_GLSL}` : ''}
        varying vec2 vUv;
        ${SRGB_GLSL}
        vec3 toLinear( vec3 c ) {
          return mix( c / 12.92, pow( ( c + 0.055 ) / 1.055, vec3( 2.4 ) ), step( 0.04045, c ) );
        }
        /**
         * 條狀 LUT 取樣(寬 = size²、高 = size;第 i 片放在 [i·size, (i+1)·size) 那一段)。
         * 三條缺一不可:
         *   ① **索引在 sRGB 空間**。RT 是線性的,而 32³ 的格子攤在線性軸上 ⇒ 暗部只分到
         *      兩三格(人眼最敏感的那一段),漸層會出現色階;外部工具匯出的 LUT 也一律是
         *      顯示空間的表,直接拿線性值去查等於查錯地方。
         *   ② **兩片手動內插**:硬體只在片內做雙線性,片與片之間是不連續的 ⇒ 不內插的話
         *      漸層上會出現與片數等距的橫向色帶,而那看起來像「LUT 做壞了」。
         *   ③ **半個 texel 的內縮**不可省:少了它每一片的邊界會把鄰片的顏色吃進來。
         */
        vec3 lutApply( vec3 linC ) {
          vec3 c = toSRGB( clamp( linC, 0.0, 1.0 ) );
          float n = uLutSize.x, inv = uLutSize.y;
          float b = c.b * ( n - 1.0 );
          float b0 = floor( b ), b1 = min( b0 + 1.0, n - 1.0 );
          vec2 uv = vec2( ( c.r * ( n - 1.0 ) + 0.5 ) * inv * inv, ( c.g * ( n - 1.0 ) + 0.5 ) * inv );
          vec3 s0 = texture2D( tLut, vec2( uv.x + b0 * inv, uv.y ) ).rgb;
          vec3 s1 = texture2D( tLut, vec2( uv.x + b1 * inv, uv.y ) ).rgb;
          return toLinear( mix( s0, s1, b - b0 ) );
        }
        ${info ? `
        /**
         * 地貌專用(檔頭 LUT 的「地貌」那一段):**只把亮度餵給表,色度原樣通過**。
         * 亮度取 Rec.709(與 split-tone 的 \`l\` 同一把尺 —— 兩份亮度定義會在交叉淡入時
         * 互相拉扯,而症狀是「LUT 拉到一半的時候地面偏色」)。
         */
        vec3 lutApplyLand( vec3 linC ) {
          float y = dot( linC, vec3( 0.2126, 0.7152, 0.0722 ) );
          return max( lutApply( vec3( y ) ) + ( linC - vec3( y ) ), 0.0 );
        }` : ''}
        void main() {
          vec3 c = texture2D( tColor, vUv ).rgb;
          // 空氣透視:MUST 排在 split-tone **之前**(霧是場景裡的東西,調色是鏡頭上的東西;
          // 反過來排就變成「霧不吃調色」= 遠景的色偏與近景走兩套)。
          // uAirA = 0(拉桿預設)⇒ 整段跳過,連深度都不取樣 ⇒ 逐位元同舊制。
          if ( uAirA > 0.0 ) {
            float z = texture2D( tDepth, vUv ).x * 2.0 - 1.0;
            float d = ( 2.0 * uNear * uFar ) / ( uFar + uNear - z * ( uFar - uNear ) );
            // 遠平面(天空穹頂)早退:那裡 f = 1 ⇒ 補正本來就是 0,只是省一次算
            if ( d < uFar * 0.999 ) {
              float f = smoothstep( uFogN, uFogF, d );          // 與 three 的 linear fog 同式
              float s = smoothstep( 0.0, ${AIR.KNEE.toFixed(3)}, f );
              c += f * ( 1.0 - s ) * ( uAirNear - uAirFar ) * uAirA;
            }
          }
          // ---- 內建調色(split-tone + 抬升)----
          // **LUT 是取代它而不是疊在它上面**:兩者是同一件事的兩種寫法(一個用四個常數、
          // 一個用一張表),疊起來就是調兩次色 —— 而美術在外部工具裡調的時候看到的是原圖,
          // 不是已經被 split-tone 動過的圖,疊出來的結果與他在工具裡看到的不一樣。
          // 故 LUT 查的是 **調色前**的顏色,最後在兩者之間交叉淡入。
          vec3 pre = c;
          float l = dot( c, vec3( 0.2126, 0.7152, 0.0722 ) );
          // split-tone:暗部偏冷、亮部偏暖(賽璐璐的陰影是有顏色的,不是壓黑的)
          vec3 sh = vec3( ${g.SHADOW.map((v) => v.toFixed(3)).join(', ')} );
          vec3 hi = vec3( ${g.HIGH.map((v) => v.toFixed(3)).join(', ')} );
          c *= mix( sh, hi, smoothstep( 0.18, 0.72, l ) );
          c = mix( vec3( l ), c, ${g.SAT.toFixed(3)} );      // 微幅提彩度
          // 陰影抬升:最暗不落到 0。**數值是線性空間的**,而畫面是 sRGB ——
          // 線性 0.045 經 sRGB 轉換會變成 0.23(整片暗部一口氣被洗成灰),2026-08-03 定場照實測。
          // 現值 0.0055 ≈ sRGB 0.06,才是「抬離全黑」而不是「把陰影拿掉」。
          c = c * ( 1.0 - ${g.LIFT.toFixed(4)} ) + ${g.LIFT.toFixed(4)};
          // uLutA = 0(沒餵過 LUT / 來源是 none / 拉桿歸零)⇒ 整段跳過,連取樣都不做
          // ⇒ 逐位元同舊制。
          if ( uLutA > 0.0 ) {
            vec3 lc = lutApply( pre );
            ${info ? `
            // 地貌(類別索引 1;NONE 0 / HARD 2 / GROUP 3 都在帶外)⇒ 換成不吃色度的那一支。
            // **帶而不是等號**:解出來的是浮點,等號判定會整片失效。
            // ⚠ 舊帶 0.25~0.75 讀的是**打包前**的 .a —— 直接留著的話 LAND 落在
            //   16/255~31/255 = 0.063~0.122,分支恆不成立 ⇒ 2026-08-13 修掉的
            //   「拼圖接縫被 LUT 顯影」原樣回來,而且沒有任何錯誤訊息。
            float cls = inkCls( texture2D( tInfo, vUv ).a );
            if ( cls > 0.5 && cls < 1.5 ) lc = lutApplyLand( pre );` : ''}
            c = mix( c, lc, uLutA );
          }
          gl_FragColor = vec4( c, 1.0 );
        }`,
    });
  }

  /**
   * 斜向轉場(序 8 ④-1)。**兩支獨立的 0→1 uniform** 而不是一支:
   * 幕的覆蓋區間是 `[w2, w1]` —— 遮幕推前緣、揭幕推後緣,同一支著色器兩種用法,
   * 而「幕走到一半停住」(過場載入)在這個形狀上是免費的。
   *
   * flash 是 **vibrance / brightnessContrast**,不是白色淡入:白幕會把整格畫面洗掉,
   * 而動畫的切點是「顏色一下子跳出來」。對比樞軸 MUST 是 `WIPE.PIVOT`(線性中灰,
   * 與 GRADE 的 `smoothstep(0.18, 0.72, l)` 同一把尺)。
   */
  _wipeMaterial() {
    return new THREE.ShaderMaterial({
      uniforms: {
        tColor: { value: null },
        uW1: { value: 0 }, uW2: { value: 0 }, uFlash: { value: 0 }, uWipeA: { value: 0 },
        uWipeC: { value: new THREE.Color(0.06, 0.07, 0.09) },
      },
      vertexShader: QUAD_VS,
      fragmentShader: `
        uniform sampler2D tColor;
        uniform float uW1; uniform float uW2; uniform float uFlash; uniform float uWipeA;
        uniform vec3 uWipeC;
        varying vec2 vUv;
        void main() {
          vec3 c = texture2D( tColor, vUv ).rgb;
          // 閃光:先做(它是鏡頭上的事),幕再蓋上去
          if ( uFlash > 0.0 ) {
            float f = uFlash * uWipeA;
            float l = dot( c, vec3( 0.2126, 0.7152, 0.0722 ) );
            c = mix( vec3( l ), c, 1.0 + ${WIPE.FLASH_VIB.toFixed(3)} * f );
            c = ( c - ${WIPE.PIVOT.toFixed(3)} ) * ( 1.0 + ${WIPE.FLASH_CON.toFixed(3)} * f )
                + ${WIPE.PIVOT.toFixed(3)} + ${WIPE.FLASH_BRI.toFixed(3)} * f;
            c = max( c, 0.0 );
          }
          // 幕:沿 (x + y·INC) 斜向掃過去。**兩個端點各外推一個羽化寬** ⇒ w=0 真的是
          // 「一格都沒蓋」、w=1 真的是「整片蓋滿」(不外推的話遠角只蓋到一半,而
          // data.js wipeAt 那一端的 p ≥ 1 保證就白給了)。
          float s = ( vUv.x + vUv.y * ${WIPE.INC.toFixed(3)} ) / ( 1.0 + ${WIPE.INC.toFixed(3)} );
          float sf = ${WIPE.SOFT.toFixed(4)};
          float e1 = uW1 * ( 1.0 + 2.0 * sf ) - sf;
          float e2 = uW2 * ( 1.0 + 2.0 * sf ) - sf;
          float a = ( 1.0 - smoothstep( e1 - sf, e1, s ) ) * smoothstep( e2, e2 + sf, s ) * uWipeA;
          gl_FragColor = vec4( mix( c, uWipeC, clamp( a, 0.0, 1.0 ) ), 1.0 );
        }`,
    });
  }

  /**
   * 幕的**唯一寫入點**。`a`(前緣)/ `b`(後緣)∈ [0,1],覆蓋區間 = [b, a]。
   * @param opts { flash?, color? }
   */
  setWipe(a, b, opts = null) {
    const u = this.wipeQuad.material.uniforms;
    u.uW1.value = Math.min(1, Math.max(0, a));
    u.uW2.value = Math.min(1, Math.max(0, b));
    u.uFlash.value = Math.min(1, Math.max(0, opts?.flash ?? 0));
    if (opts?.color != null) u.uWipeC.value.set(opts.color);
    else u.uWipeC.value.setRGB(0.06, 0.07, 0.09);
    u.uWipeA.value = this._wipeKnob;
    // 「有東西要畫」= 幕有寬度 或 閃光還在。兩者皆無 ⇒ 整個 pass 退出鏈
    this._wipeA = (this._wipeKnob > 0 && (u.uW1.value > u.uW2.value || u.uFlash.value > 0))
      ? this._wipeKnob : 0;
  }

  /**
   * 播一段轉場。**回呼由幀迴圈觸發,MUST NOT 用 `setTimeout`** —— 離場 / 重賽會在幕播到
   * 一半發生,計時器留下來就是下一場冒出上一場的畫面(`dialogue.js` 檔頭紀律②的同一條)。
   * @param mode  'cover'(遮幕;回呼在**全覆蓋那一刻**觸發 = 切點)/ 'reveal'(揭幕)
   * @param onCut 切點回呼;**旋鈕關著時當場同步呼叫**並回 false ⇒ 時序逐位元同舊制
   * @returns 有沒有真的播(false = 旋鈕關著,呼叫端不必自己判)
   */
  playWipe(mode, onCut = null, opts = null) {
    if (!this.enabled.wipe || this._wipeKnob <= 0) { onCut?.(); return false; }
    this._wipe = { mode, t: 0, onCut, color: opts?.color ?? null };
    this._wipeT0 = null;
    const w = wipeAt(mode, 0);
    this.setWipe(w.w1, w.w2, { flash: w.flash, color: this._wipe.color });
    return true;
  }

  /** 逐幀推進(唯一呼叫點 = `render()`;`render()` 沒有 dt ⇒ 自己記時鐘) */
  _tickWipe() {
    if (!this._wipe) return;
    const now = (typeof performance !== 'undefined' ? performance.now() : Date.now()) / 1000;
    // 背景分頁回來的那一幀 dt 會是幾十秒 ⇒ MUST 夾住(同 game.js 主迴圈的 dt 夾制),
    // 否則切回分頁看到的是「幕已經播完了」而回呼在同一幀補放
    const dt = this._wipeT0 == null ? 0 : Math.min(0.1, now - this._wipeT0);
    this._wipeT0 = now;
    const w = this._wipe;
    w.t += dt;
    const s = wipeAt(w.mode, w.t);
    this.setWipe(s.w1, s.w2, { flash: s.flash, color: w.color });
    if (!s.done) return;
    this._wipe = null;
    w.onCut?.();
  }

  /**
   * FXAA。**MSAA 對 pass 畫出來的線一點用都沒有**(那些線不是幾何邊),所以勾線上線之後
   * 抗鋸齒的責任整個落在這裡;也因此觸控裝置第一次有了抗鋸齒(舊制 `antialias: !isTouchUI()`)。
   * 這一 pass 同時負責**線性 → sRGB**(RT 是 NoColorSpace,見 SRGB_GLSL)。
   */
  _fxaaMaterial() {
    return new THREE.ShaderMaterial({
      uniforms: { tColor: { value: null }, uTexel: { value: new THREE.Vector2() }, uAA: { value: 1 } },
      vertexShader: QUAD_VS,
      fragmentShader: `
        uniform sampler2D tColor; uniform vec2 uTexel; uniform float uAA;
        varying vec2 vUv;
        ${SRGB_GLSL}
        float lum( vec3 c ) { return dot( c, vec3( 0.299, 0.587, 0.114 ) ); }
        void main() {
          vec3 m  = texture2D( tColor, vUv ).rgb;
          if ( uAA < 0.5 ) { gl_FragColor = vec4( toSRGB( m ), 1.0 ); return; }
          vec3 nw = texture2D( tColor, vUv + vec2( -uTexel.x, -uTexel.y ) ).rgb;
          vec3 ne = texture2D( tColor, vUv + vec2(  uTexel.x, -uTexel.y ) ).rgb;
          vec3 sw = texture2D( tColor, vUv + vec2( -uTexel.x,  uTexel.y ) ).rgb;
          vec3 se = texture2D( tColor, vUv + vec2(  uTexel.x,  uTexel.y ) ).rgb;
          float lm = lum( m ), lnw = lum( nw ), lne = lum( ne ), lsw = lum( sw ), lse = lum( se );
          float lo = min( lm, min( min( lnw, lne ), min( lsw, lse ) ) );
          float hi = max( lm, max( max( lnw, lne ), max( lsw, lse ) ) );
          if ( hi - lo < max( 0.03, hi * 0.125 ) ) { gl_FragColor = vec4( toSRGB( m ), 1.0 ); return; }
          vec2 dir = normalize( vec2( -( ( lnw + lne ) - ( lsw + lse ) ), ( lnw + lsw ) - ( lne + lse ) ) + 1e-6 );
          dir = clamp( dir, -8.0, 8.0 ) * uTexel;
          vec3 a = 0.5 * ( texture2D( tColor, vUv + dir * ( 1.0 / 3.0 - 0.5 ) ).rgb
                         + texture2D( tColor, vUv + dir * ( 2.0 / 3.0 - 0.5 ) ).rgb );
          vec3 b = a * 0.5 + 0.25 * ( texture2D( tColor, vUv - dir * 0.5 ).rgb
                                    + texture2D( tColor, vUv + dir * 0.5 ).rgb );
          float lb = lum( b );
          gl_FragColor = vec4( toSRGB( ( lb < lo || lb > hi ) ? a : b ), 1.0 );
        }`,
    });
  }

  /** 畫布尺寸或 `_resScale` 改變時呼叫;尺寸一律由 drawing buffer 取得(見檔頭) */
  setSize() {
    const s = this.renderer.getDrawingBufferSize(this._drawBufSize);
    if (s.x === this._size.x && s.y === this._size.y) return;
    this._size.copy(s);
    for (const rt of [this.rtScene, this.rtA, this.rtB]) rt.setSize(Math.max(1, s.x), Math.max(1, s.y));
  }

  /** 取代 `renderer.render(scene, camera)`;結束時 render target 一律歸零(PiP 隨後直接畫在畫布上) */
  render() {
    const r = this.renderer;
    this.setSize();
    const texel = this._texelVec.set(1 / this._size.x, 1 / this._size.y);
    const chain = [];
    if (this.enabled.ink) chain.push('ink');
    // 景深 MUST 排在勾線**之後**(檔頭 ②:先糊後勾 = 糊掉的色塊配上銳利的黑線)。
    // 四個關法任一成立就整個 pass 退出鏈,而不是跑一個沒有作用的 pass:`?dof=0` /
    // 呼叫端沒餵距離 / 拉桿 0% / **不在狙擊模式**(`_dofBlend = 0`,逐幀由呼叫端餵)。
    // 退出時輸出**逐位元**同這一批改動之前 —— 一般視角因此完全不付這一 pass 的錢。
    if (this.enabled.dof && this._dofRange && this._dofA * this._dofBlend > 0) chain.push('dof');
    if (this.enabled.grade) chain.push('grade');
    // 轉場 MUST 排在 **grade 之後、fxaa 之前**(序 8 ④-1)。四條理由缺一不可:
    //   ①FXAA MUST 留在鏈尾(它兼任線性 → sRGB);
    //   ②幕的斜邊是硬邊,擺在 FXAA **之前**才有抗鋸齒 —— 擺之後就是一條裸鋸齒對角線,
    //     而那正是動畫轉場最刺眼的地方;
    //   ③幕 MUST 蓋在**調過色的**畫面上:擺在 grade 之前 = 幕色被 split-tone / LUT 再調一次,
    //     美術挑的顏色不是畫出來的顏色;
    //   ④flash 是鏡頭上的事,與 grade 同層而排在它之後。
    // 閘門形狀**逐字鏡射 dof 那一列**:0 ⇒ 整個 pass 退出鏈,不是跑一個乘 0 的 pass。
    this._tickWipe();
    if (this.enabled.wipe && this._wipeA > 0) chain.push('wipe');
    // 最後一 pass **一定要跑**:它同時負責線性 → sRGB。`?fxaa=0` 只是把邊緣混合關掉
    // (`uAA = 0`),MUST NOT 整個 pass 跳過 —— 跳過的話畫面會整片變暗變濁(少了色彩空間轉換),
    // 而那看起來像「調色把畫面弄壞了」,查半天查不到。
    chain.push('fxaa');
    this.fxaaQuad.material.uniforms.uAA.value = this.enabled.fxaa ? 1 : 0;

    r.setRenderTarget(this.rtScene);
    r.clear();
    if (this._mrt) {
      // 哨兵成立的**唯一**方法(檔頭 INK_MRT ②):`clear()` 拿 renderer 的 clearColor 清了
      // 每一張附件,而那個顏色不是 0 ⇒ 第二張要單獨清成 0,否則「沒有寫的一格」看起來像
      // 一組合法的法線,天際線與每一團特效外面都會多一圈粗黑邊。
      const gl = r.getContext();
      gl.clearBufferfv(gl.COLOR, 1, [0, 0, 0, 0]);
    }
    r.render(this.scene, this.camera);

    let src = this.rtScene;
    for (let i = 0; i < chain.length; i++) {
      const last = i === chain.length - 1;
      const dst = last ? null : (src === this.rtA ? this.rtB : this.rtA);
      const quad = this._quads[chain[i]];
      const u = quad.material.uniforms;
      // MRT 的 `.texture` 是**陣列**(第 0 張才是顏色)—— 直接餵整個陣列的話 three 會把它
      // 當成一張沒有 image 的貼圖丟給 sampler,畫面整片黑而沒有任何錯誤訊息。
      u.tColor.value = Array.isArray(src.texture) ? src.texture[0] : src.texture;
      if (u.uTexel) u.uTexel.value.copy(texel);
      if (u.tInfo) u.tInfo.value = this.rtScene.texture[1] || null;
      if (u.tDepth) {
        u.tDepth.value = this.rtScene.depthTexture;
        u.uNear.value = this.camera.near;
        u.uFar.value = this.camera.far;
      }
      // 勾線淡出帶(④-3):與 tDepth 同一段共用接線 —— 天氣 / 隊制一換,霧遠端跟著換
      if (u.uFade0) { const fade = this._inkFadeM(); u.uFade0.value = fade[0]; u.uFade1.value = fade[1]; }
      r.setRenderTarget(dst);
      quad.render(r);
      src = dst || src;
    }
    r.setRenderTarget(null);
  }

  /**
   * A25:3 個 RT + depthTexture + **`_quads` 那張表上的每一支**全螢幕材質,一個都不能漏
   * (拉桿訂閱也要退掉)。名冊由 `_quads` **推導** —— 手寫的那一份會在加 pass 時靜默過期,
   * 而漏掉一支的症狀是每開一場漏一支 shader program,`audit_gpu_lifecycle` 照樣全綠。
   */
  dispose() {
    this._offPrefs?.();   // 不解訂閱 = 已 dispose 的材質被拉桿的 closure 抓著不放
    this._offPrefs = null;
    this._wipe = null;    // 播到一半就離場:回呼跟著丟掉(它是幀迴圈驅動的,沒有計時器要清)
    for (const rt of [this.rtScene, this.rtA, this.rtB]) {
      rt.depthTexture?.dispose();
      rt.dispose();
    }
    // 程序生成/載入進來的 LUT 由本管線持有(A25:一顆 canvas 貼圖也是 GPU 資源)
    this._lutOwned?.dispose();
    this._lutOwned = null;
    for (const q of Object.values(this._quads)) {
      q.material.dispose();
      q.dispose();
    }
  }
}
