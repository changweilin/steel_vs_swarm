// ============ 3D 賽璐璐(celluloid)渲染核心 ============
// 依 doc/drone_vs_robot_fps_dota_plan.html Task 3.1 的方法:
//   1. MeshToonMaterial + 3 階高對比色階 ramp(硬邊明暗交界,漫畫式打光)
//   2. 反轉外殼(Inverted Hull)黑色描邊:BackSide 外殼沿法線外推,
//      螢幕上呈現 2~3px 的漫畫勾線;支援 SkinnedMesh(外殼共用同一副骨骼)
//   3. 硬邊金屬高光(sharp specular band)+ 邊緣光(rim):
//      onBeforeCompile 注入,非模糊的白色反光帶 → 機甲/槍械像動漫插畫的金屬
// 全專案共用:hazards.js re-export 舊入口(toonMat/toonify/toonGradient)保持相容。
import * as THREE from 'three';
import { visualPref, onVisualChange } from './visualPrefs.js';
import { makeField, bakeFieldTexture } from './field.js';
import { curveKneeM, curveR, SOLDIER_H, DISSOLVE } from './data.js';

// ============ 世界曲面(2026-08-09;規則與推導全文見 data.js 的 CURVE 區塊)============
// 使用者要的東西只有一句:**平面算完、擺完,最後一步才轉成曲面**。這裡就是那「最後一步」,
// 而它落在**頂點著色器**是刻意的 —— JS 那一側(座標/朝向/碰撞/彈道/準星/小地圖/伺服器回報)
// 一行都不必改,於是「平面算完再彎」不是靠約定維持的,是**結構上沒有第二份實作可以分家**
// (原則 2 / A30 家族最常見的死法就是同一件事有兩份幾何)。
//
// 沉降發生在**世界空間**、量的是**離相機的水平距離** ⇒ ①等高水平面整片跟著彎(y = 常數
// 變成繞著相機的旋轉拋物面,在本專案 5° 以內的張角上與真球面差 2cm);②「近處是平的」
// 由拐點保證(見 data.js);③ 每一顆相機各彎各的 —— 主視窗 / 副視窗(僚機) / 陣亡運鏡 /
// 定場鏡頭組共用同一份程式,`cameraPosition` 是 three 逐 pass 給的,不必各寫一份。
//
// **只彎頂點,不彎法線**:法線的正確傾角是 `(d − D0)/R`,在本專案的距離上限只有 3.2°,
// 而畫面上那是 cel ramp 的同一階(A14 的階梯本來就是 60~90° 一階)⇒ 收它只會多付每頂點
// 一次 normalMatrix 重算而看不出差別。
//
// **絕對直線類攻擊自動就是直的**:光束/曳光/貫穿管道全部是 `heightSegments = 1` 的單位圓柱
// (`vfx.js unitCylinder`),兩端各自沉降、中間線性內插 = 曲面空間裡的**弦** —— 正是使用者
// 說的「絕對直線類攻擊在彎曲後計算軌跡」。反過來,拋物線彈道(榴彈/導引)是逐幀移動的
// 小物件,每一幀各自沉降 ⇒ 整條航跡跟著曲面走。兩者都不需要任何特判。
// MUST NOT 為了「平滑」去細分光束幾何 —— 細分回來的中間點會各自往下沉,那條光束就彎了。
//
// **裝法 = 改 three 的共用 chunk,不是逐材質包裝**:`project_vertex` 是每一種 mesh 材質
// (basic/toon/lambert/standard/points/line/depth,含本檔自己的 cel 補丁與反轉外殼)在
// 頂點著色器**唯一**算 `gl_Position` 的地方,`ShaderLib.sprite` 是唯一的例外。改這兩處
// = 全場一次到位,而且**日後任何人新建的材質自動吃到**(逐材質包裝的下場是「某一種特效
// 沒有跟著彎」,而那要等到有人截圖才看得出來)。
// 例外(自寫 vertexShader ⇒ 天生不吃這個 chunk):`environment.js` 的漸層天空穹頂 —— 它
// **本來就該留在無限遠**,不彎是對的;`vfx.js` 的護盾泡泡另外呼叫 `worldCurve()`(它包著
// 一台機體,不跟著沉就會在遠處與機體脫開)。
const CURVE_SENTINEL = 'mvPosition = modelViewMatrix * mvPosition;';
const SPRITE_SENTINEL = 'vec4 mvPosition = modelViewMatrix * vec4( 0.0, 0.0, 0.0, 1.0 );';
/** GLSL 浮點字面值(MUST 帶小數點或指數,否則是 int 型別 ⇒ 編譯失敗) */
const glslF = (v) => {
  const s = Number(v).toPrecision(9);
  return /[.e]/.test(s) ? s : `${s}.0`;
};
/**
 * 全域曲面函式,注入 `ShaderChunk.common`(頂點/片段兩邊都會展開,而 `common` 是
 * **每一種**材質都 `#include` 的那一塊 ⇒ 函式一定在作用域內)。
 * 相機位置**當參數傳**,函式本身不依賴任何 uniform ⇒ 自寫 shader 也直接呼叫得到。
 *
 * 停用時(`?curve=0` 或錨點對不上)兩個常數一起變成恆等式 —— 函式**永遠存在**,呼叫端
 * 才不會因為補丁沒裝上而編譯失敗(降級,不例外)。
 */
const curveFn = (knee, inv2r) => `
vec3 worldCurve( vec3 wp, vec3 cam ) {
	float _cu = length( vec2( wp.x - cam.x, wp.z - cam.z ) ) - ${glslF(knee)};
	if ( _cu > 0.0 ) wp.y -= _cu * _cu * ${glslF(inv2r)};
	return wp;
}
`;
let _curveOn = false;
/** 曲面是否真的裝上了(稽核與 `?curve=0` 的回報用) */
export function worldCurveOn() { return _curveOn; }
/**
 * 一次性安裝。**MUST 在任何材質編譯之前**跑 —— 但那是免費的:three 是在建 program 時才
 * 展開 `#include`,而 program 要到第一次 render 才建,所以在本檔 import 時裝上必然夠早。
 * 重複呼叫是 no-op(chunk 只准被改一次,改兩次就疊出兩層沉降)。
 */
function installWorldCurve() {
  if (THREE.ShaderChunk.__worldCurve) return;
  // `typeof` 守衛:本檔理論上只在瀏覽器跑(它 import three),但這一行是在**模組載入時**
  // 執行的 —— 沒有守衛的話,任何一支想 import toon.js 的離線工具會死在這裡而不是死在
  // three 上,錯誤訊息指向完全無關的地方。
  const qs = typeof location !== 'undefined' ? location.search : '';
  const off = new URLSearchParams(qs).get('curve') === '0';
  const chunkOk = THREE.ShaderChunk.project_vertex.includes(CURVE_SENTINEL);
  const spriteOk = THREE.ShaderLib.sprite.vertexShader.includes(SPRITE_SENTINEL);
  // 錨點是 three r160 的**原文**;升級 three MUST 重新核對。對不上就整套退成平面
  // (原則 6:寧缺勿錯 —— 半套曲面 = 有些東西沉有些不沉,比完全不彎難看也難查)
  _curveOn = !off && chunkOk && spriteOk;
  if (!off && !(chunkOk && spriteOk)) {
    console.warn('[curve] three 的頂點錨點對不上,世界曲面退回平面', { chunkOk, spriteOk });
  }
  const knee = _curveOn ? curveKneeM() : 0;
  const inv2r = _curveOn ? 1 / (2 * curveR()) : 0;
  THREE.ShaderChunk.common += curveFn(knee, inv2r);
  THREE.ShaderChunk.__worldCurve = true;
  if (!_curveOn) return;
  // `modelViewMatrix` = viewMatrix × modelMatrix,拆開只為了在世界空間插一刀;
  // 不彎的材質(`NO_WORLD_CURVE`)逐位元走回原本那一行。
  THREE.ShaderChunk.project_vertex = THREE.ShaderChunk.project_vertex.replace(
    CURVE_SENTINEL,
    `#ifdef NO_WORLD_CURVE
	mvPosition = modelViewMatrix * mvPosition;
#else
	vec4 _cwp = modelMatrix * mvPosition;
	_cwp.xyz = worldCurve( _cwp.xyz, cameraPosition );
	mvPosition = viewMatrix * _cwp;
#endif`,
  );
  // sprite 的中心點在自己的 shader 裡算(它不吃 project_vertex);四邊形展開仍在視域空間,
  // 所以只要把**中心**沉下去,billboard 的朝向與大小逐位元不變。
  THREE.ShaderLib.sprite.vertexShader = THREE.ShaderLib.sprite.vertexShader.replace(
    SPRITE_SENTINEL,
    `vec4 mvPosition;
	#ifdef NO_WORLD_CURVE
		mvPosition = modelViewMatrix * vec4( 0.0, 0.0, 0.0, 1.0 );
	#else
		vec4 _cwc = modelMatrix * vec4( 0.0, 0.0, 0.0, 1.0 );
		_cwc.xyz = worldCurve( _cwc.xyz, cameraPosition );
		mvPosition = viewMatrix * _cwc;
	#endif`,
  );
}
installWorldCurve();

// ---- 勾線資訊緩衝的材質契約(2026-08-12;消費端住 `postfx.js` 的同名段)----
// 深度的二階差分**分不出同深度相接的同色面**:牆腳與地面、退縮平台的轉折、機體零件的接縫。
// 那不是門檻調不好 —— 資訊本身不在深度緩衝裡(`INK.K_S` 的掠射項為了壓掉高度場的網格折邊,
// 會連同這些邊一起壓掉,而內插後的頂點法線在網格上是平滑的、在牆角是 90°)。
// 補的訊號寫進**第二張附件**:`gInfo = vec4( 視空間法線.xy × 0.5 + 0.5, surfaceId, 1.0 )`,
// `.a` 是「這一格有寫」的哨兵。
//
// ---- 為什麼是「全體無條件宣告」而不是跟著開關走 ----
// WebGL2 的規則(2026-08-12 三方實測):
//   ・啟用中的 draw buffer **沒有**對應的 fragment output ⇒ `INVALID_OPERATION`,
//     而畫面上表現成**那一批物件整批不畫**、console 一個字都沒有;
//   ・反過來(宣告了但沒有那個 draw buffer)⇒ **合法**,單附件 RT 與預設 framebuffer 都 OK。
// 兩個方向的代價差這麼多 ⇒ 宣告一律無條件掛上,開關只准控制「管線要不要配第二張附件」。
// 這也讓開關可以即時切換:場景材質恆寫,切開關只需要重建 RT 與勾線材質,不必重編譯任何材質。
//
// **涵蓋範圍由 `opaque_fragment` 推導,MUST NOT 手寫名冊**:會進場景的內建材質(basic /
// lambert / phong / standard / physical / toon / matcap / points / sprite / dashed)全部包含它,
// 而陰影與背景那幾支(depth / distanceRGBA / shadow / background / cube)**都不包含** ——
// 那正是我們不想碰的:它們畫進單附件的陰影圖,補上去只是白付一個輸出。
//
// ---- `.a` 是**表面類別**不只是哨兵(2026-08-13;使用者定案「LUT 與勾線不針對地貌作用,
//      不要看出地貌拼圖接縫,但地形變化受 LUT 與勾線作用」)----
// 「地貌」(地形 + 地被拼圖 + 交界外溢 + 界線拼圖 + 特徵拼圖)在畫面上是**一個連續的表面**,
// 但在資料上是幾十份材質拼出來的 ⇒ 逐材質的 surfaceId 在每一格拼圖的邊上都不一樣,
// `INK_MRT.ID` 那一項就沿著每一條拼圖邊畫線 = 使用者看到的「地貌拼圖接縫」。
// 這不是門檻調不好:id 量的是**這是哪一塊拼圖**(地貌),而勾線要的是**這裡的形狀**(地形)。
// 兩件事分開的方法有三條,缺一不可:
//   ① 地貌材質**共用一個 surfaceId**(`LAND_SURF_ID`)⇒ 拼圖之間 id 差恆為 0,而與建物/
//      機體/道路之間仍然差得開(牆腳那條線一條都沒少);
//   ② 貼地拼圖的**法線是假的**((0,1,0),它只是一張鋪在地形上的皮)⇒ 由呼叫端餵
//      `aLandN` = 真地形法線(`landNrm: true`),折邊那一項因此量到**地形**:稜線與路塹
//      照樣出線、拼圖邊界(同一個連續法線場)不出線。餵不到就退回自己的法線(原則 6);
//   ③ `.a` 帶類別碼 —— 3D LUT 那一端要知道「這一格是地貌」才做得到「不針對地貌作用」
//      (postfx.js 的 `lutApply` 分支)。哨兵語意不變:0 仍是「沒有資訊」。
//
// ---- `.a` 自 2026-08-16 起是**打包**(半位元組切;計畫 §0-c / 序 3)----
// 高半位元組 = 表面類別**索引**(0~3),低半位元組 = `outlineContribution` 的 16 階。
// 類別碼從此**不是 alpha 值** —— MUST NOT 再拿 `INK_CLASS.*` 跟 `.a` 直接比大小,
// 一律經 `INK_UNPACK_GLSL` 的 `inkCls()` / `inkCtr()` 解碼(消費端住 `postfx.js` 三處)。
// 魔數 16 / 15 / 255 **只准出現在下面那兩段 GLSL 字串裡**:三個讀取點各抄一次的話,
// 日後調階數只會改到其中一處 ⇒ 類別解錯,而那表現成「某些表面的線莫名其妙全沒了」。
export const INK_CLASS = {
  NONE: 0,     // 沒有寫過(天空穹頂 / 護盾殼 / 粒子 / 招牌)—— 哨兵
  LAND: 1,     // 地貌:地形 + 一切貼在它上面的地被層
  HARD: 2,     // 其餘(機體 / 建物 / 道路 / 水面 / 擺件)= 舊制
  GROUP: 3,    // 表面群組(整株樹 / 整顆巨岩 / 一堆石頭):群組內部不出線,剪影留著
};
/** 打包的基底(8bit UNORM 的分母)。`.a` 的最大值是 (3×16+15)/255 = 0.247 ⇒ 舊的 `> 0.25` 哨兵在新編碼下**恆不成立** */
const INK_BASE = 255;
/** 貢獻的階數(低半位元組 4 bit)。MUST NOT 手寫 16 —— 下面每一個 16 都由它推導 */
export const INK_LEVELS = 16;
const INK_TOP = INK_LEVELS - 1;
/**
 * 授權值 → 實際存得下的那一階(k / 15)。呼叫端傳 0.4 而緩衝裡是 0.4000 或 0.4667,
 * 稽核與定裝照量到的就是另一個數 ⇒ 一律先經這一支收成 16 階之一。
 * **`inkQuant(1)` 嚴格 === 1**(level 15;逐位元中性靠它)。
 */
export const inkQuant = (c) => Math.round(Math.min(1, Math.max(0, c || 0)) * INK_TOP) / INK_TOP;
/** 「這一款東西不值得一條線」的具名否決值 —— 唯一容許手寫的貢獻(見 `inkRepeat`) */
export const INK_CONTRIB_NONE = 0;
/** 編碼(寫入端 = 本檔的 gInfo 那一行)。⚠ `inkPack(NONE, 0) === 0` ⇒ 哨兵語意逐位元保留 */
export const INK_PACK_GLSL = `
float inkPack( float cls, float ctr ) {
  return ( cls * ${INK_LEVELS}.0 + floor( clamp( ctr, 0.0, 1.0 ) * ${INK_TOP}.0 + 0.5 ) ) / ${INK_BASE}.0;
}`;
/**
 * 解碼(讀取端 = `postfx.js` 的勾線與 grade 兩支 fragmentShader,一律 import 前置)。
 * `q = floor(a*255+0.5)` 在 HalfFloatType RT 上仍精確(0.247 處 ulp × 255 = 0.03 ≪ ±0.5);
 * 日後把 `INK_BASE` 改大會**先在 half 上**壞掉,而畫面只表現成「某些表面的線沒了」。
 */
export const INK_UNPACK_GLSL = `
float inkQ( float a ) { return floor( a * ${INK_BASE}.0 + 0.5 ); }
float inkCls( float a ) { return floor( inkQ( a ) / ${INK_LEVELS}.0 ); }
float inkCtr( float a ) { return fract( inkQ( a ) / ${INK_LEVELS}.0 ) * ${INK_LEVELS}.0 / ${INK_TOP}.0; }`;
export const INK_INFO_DECL = 'layout(location = 1) out highp vec4 gInfo;';
export const INK_INFO_NONE = 'gInfo = vec4( 0.0 );';   // 哨兵 0 = 這一格沒有法線資訊(= inkPack(NONE, 0))
function installInkInfo() {
  if (THREE.ShaderChunk.__inkInfo) return;
  const OPAQUE = '#include <opaque_fragment>';
  let n = 0;
  for (const lib of Object.values(THREE.ShaderLib)) {
    if (!lib.fragmentShader.includes(OPAQUE)) continue;
    lib.fragmentShader = `${INK_INFO_DECL}\n${lib.fragmentShader}`;
    n++;
  }
  // 預設寫「沒有資訊」;掛了 cel 補丁的材質會在這一行**之後**覆寫成真的法線與 id。
  THREE.ShaderChunk.opaque_fragment += `\n${INK_INFO_NONE}`;
  THREE.ShaderChunk.__inkInfo = true;
  // 一支都沒補到 = three 換了 chunk 名字 ⇒ 開關一開就是滿場物件消失。寧可現在就吵。
  if (n === 0) console.warn('[ink] 找不到任何含 opaque_fragment 的 ShaderLib,勾線資訊緩衝不可用');
}
installInkInfo();
let _surfSeq = 0;
const SURF_SLOT_N = 64;
const _surfKeyIds = new Map();
/**
 * 逐材質 surfaceId 的穩定配號。
 * 前 64 個**不同語意鍵**各拿一個半整數格；耗盡後回保留的共用碼，絕不回繞撞到舊材質。
 * 沒有語意鍵的呼叫端由顏色 / 軌道推導鍵，避免建構順序差異把整張圖的線重新洗牌。
 */
const nextSurfId = (surfaceKey = null) => {
  const key = surfaceKey == null ? `anon:${_surfSeq}` : String(surfaceKey);
  const old = _surfKeyIds.get(key);
  if (old != null) return old;
  const id = _surfSeq >= SURF_SLOT_N
    ? SURF_ID.OVERFLOW
    : (((_surfSeq * 23 + 23) % SURF_SLOT_N) + 0.5) / SURF_SLOT_N;
  _surfSeq++;
  _surfKeyIds.set(key, id);
  return id;
};
/**
 * 地貌共用的 surfaceId。取 **0 是刻意的**:`nextSurfId` 的值域是 `(k + 0.5) / 64`,
 * 最小 0.0078 ⇒ 0 永遠不會被抽到 ⇒ 地貌與任何一份非地貌材質的 id 差恆 ≥ 0.0078,
 * 穩穩跨過 `INK_MRT` 那一項的 0.004 門檻(地貌 vs 建物的線一條都不會少)。
 */
const LAND_SURF_ID = 0;
/**
 * 具名表面群組(2026-08-16;S3)。**整數格 `k / 64`**,而 `nextSurfId` 是半整數格
 * `(k + 0.5) / 64` ⇒ 兩者恆差 ≥ 0.5/64 = 0.0078 > `INK_MRT.ID` 的 0.004 門檻,
 * 群組號永遠不會與逐材質號撞在一起(撞號 = 少一條該有的線)。
 * `k = 0` 保留給地貌、`k = 1` 保留給坑門混凝土家族；`k = 42` 是材質槽耗盡的
 * 明確共用碼，`k = 43..56` 留給地貌遮罩，`k = 57..63` 留給地貌分區。
 */
export const SURF_ID = { LAND: LAND_SURF_ID, CONCRETE: 1 / 64, OVERFLOW: 42 / 64 };
let _grpSeq = 1;
/**
 * 配一個新的表面群組號(整數格,k ∈ [2, 41] 循環；42 保留給材質耗盡保底碼)。**零亂數消耗** —— 它吃的是模組級序
 * 不是共享 `rnd()`(§2.3;在呼叫端抽一枚 `rnd()` 當群組種子 = 整張圖的佈局往後推移)。
 */
export function surfGroup() {
  _grpSeq = _grpSeq >= 41 ? 2 : _grpSeq + 1;
  return _grpSeq / 64;
}
/**
 * 把一份材質(或整棵子樹上每一份 cel 材質)併進同一個表面群組。
 *
 * ⚠ **MUST 在 `scene.add` / `new InstancedMesh` 之前呼叫**:`uSurfId` 的值在
 * `onBeforeCompile`(首次編譯)當下就凍結,晚一步就是**一行都不生效** —— 線照畫、
 * console 一個字都沒有、每一條原文斷言照樣綠。
 * 地貌材質(`celOpts.land`)MUST skip:它恆 `LAND_SURF_ID`(A46 / 稽核 Ⅶ)。
 * @param target 材質 或 Object3D 子樹
 * @param id     群組號;省略 = 配一個新的
 * @returns 實際使用的群組號(呼叫端要把同一株的別的列併進來時傳回去)
 */
export function joinSurfGroup(target, id = surfGroup()) {
  const put = (m) => {
    if (!m || !m.userData?.celOpts || m.userData.celOpts.land) return;
    m.userData.celSurfId = id;
  };
  if (target?.isMaterial) put(target);
  else if (target?.traverse) {
    target.traverse((o) => {
      if (!o.isMesh || o.userData.isOutline) return;
      (Array.isArray(o.material) ? o.material : [o.material]).forEach(put);
    });
  }
  return id;
}

// ---- cel ramp 家族(NearestFilter = 硬邊界)----
// **單一縫**:全專案的明暗階梯只有這一張表,ramp 的 DataTexture MUST 只在本檔建構 ——
// 散在各處 new DataTexture 就是「同一個場景裡有兩套明暗規則」,而畫面上只表現成
// 「某些物件的陰影邊界跟別人對不上」,不會有任何錯誤訊息。
//
// 為什麼要分階數(2026-08-03):單一 3 階 ramp 對**淺色大面積**沒有階可以走 ——
// 雪地/白色塗裝/水面的三階全擠在亮端,看起來就是一片平的;而小件深色零件(輪胎/線纜)
// 三階又切得太碎。故依「這塊面積在畫面上要表現多少層次」選階數,不是依物件種類。
//
//   2     小塊深色件(輪胎/線纜/深色裝甲):只要一刀明暗界
//   3     現役預設 —— **MUST 逐位元不變**,改了整個場景會重新上色
//   4     大型結構(地形/建物量體):中間多一階,坡面才有轉折
//   soft  淺色大面積(雪/煙/水/白色塗裝):把整條 ramp 抬到亮端,兩階之間才看得出交界
//
// A14 / #INC-106:每一組的**暗階 MUST ≥ 102** —— 低於此深色物件疊上 cool 會塌成全黑。
const RAMPS = {
  2: [102, 255],
  3: [102, 182, 255],
  4: [102, 158, 206, 255],
  soft: [190, 255],
};
const _grads = new Map();
/**
 * cel 明暗階梯貼圖(依階數快取;同一組 bands 整場共用一張)。
 * @param bands 2 / 3 / 4 / 'soft';省略 = 3(呼叫端不傳就**逐位元同舊制**)
 */
export function toonGradient(bands = 3) {
  const key = RAMPS[bands] ? bands : 3;
  let g = _grads.get(key);
  if (g) return g;
  const stops = RAMPS[key];
  g = new THREE.DataTexture(new Uint8Array(stops), stops.length, 1, THREE.RedFormat);
  g.minFilter = THREE.NearestFilter;
  g.magFilter = THREE.NearestFilter;
  g.needsUpdate = true;
  _grads.set(key, g);
  return g;
}

/**
 * 這一組 ramp 的**暗階值**(0~1)。陰影偏色的權重基準(見下一段 P1-B)。
 * **推導不手寫**:RAMPS 任一組的暗階一改,偏色的「最深處」自己跟著走 —— 手寫一份 0.4
 * 的話,改了 ramp 就是「偏色的最深處」與「看得到的最暗階」分家,而畫面上只表現成
 * 「某些材質的陰影偏色比別人淡」,沒有任何錯誤訊息。
 * @param bands 2 / 3 / 4 / 'soft';省略 = 3(同 `toonGradient`)
 */
export function rampFloor(bands = 3) {
  const key = RAMPS[bands] ? bands : 3;
  return RAMPS[key][0] / 255;
}

// ---------------- 賽璐璐學派(§0-b;2026-08-16)----------------
// 兩派畫的是同一件事的兩種畫法,**縫仍只有本檔一份**、消費端一行不改:
//   School A(`celSchool = 'a'`)= 上面那張 `RAMPS` 查表(保留作明確 fallback)。
//   School B(`'b'`,交付預設)= 累積直接光 → **一刀 smoothstep 硬切** → 暗側往色相位移。
//
// **`bands` 這個參數不消失,語意變成「這一刀有多硬」**(2 最硬 → soft 最軟)——
// 這是把 School A 的「階數越多層次越多」翻譯成 School B「唯一那一刀越寬」的**唯一**
// 合法映射,故帶寬與中點 MUST 嚴格遞增(2 < 3 < 4 < soft)。四個既有 `bands:` 呼叫端
// (terrain ×2 / worldtext / matsample)因此一個都不必改;序一破,它們的語意就全反了。
//
// ⚠ **`bands = 4` 的「中間那一階」在硬切下是真的消失了**(一刀只有一個終端)——
// 本表把它翻譯成**更寬的帶**,那是「軟化」不是「多一階」。整片山坡因此回到兩塊色,
// 靠地貌/材質自己的色階梯撐。2026-08-19 使用者定案:維持這個單一硬切,不補第二刀。
//
// **`SHADOW_V` 是 A14 在硬切路徑上的地板,MUST 推導不手寫** —— 102 這個數只准有一份家
// (`RAMPS`)。旋鈕是「相對地板的餘裕」`SHADOW_V_F`(MUST ≥ 1),不是那個地板本身:
// 手寫 0.5 的話,有人調 `RAMPS[3][0]` 之後暗側就悄悄跌到地板以下,而每一條斷言全綠。
const SHADOW_V_F = 1.25;
export const CEL_CUT = {
  2: [0.10, 0.15],
  3: [0.20, 0.40],
  4: [0.26, 0.54],
  soft: [0.30, 0.70],
  // 暗側的**值**乘數(A14 ②:MUST ≥ rampFloor(3) = 102/255)
  SHADOW_V: rampFloor(3) * SHADOW_V_F,
  // School B 下兩根陰影偏色拉桿的**下限**(A14 ③ 的色相那一半)。
  // 兩根拉桿的 def 是 0(visualPrefs 紀律①:預設 = 這一項不生效),照搬到 School B
  // 就是**灰色陰影** —— 而色相位移正是這一換學派的全部收益。故硬切路徑上夾一個下限,
  // 拉桿仍可往上到 TINT_MAX_A。2026-08-19 使用者定案 = 1.5:保留 School B 的色相收益,
  // 但不讓暗側被拉成濾鏡色。
  HUE_MIN_A: 1.5,
};
/**
 * 這一組 `bands` 的硬切帶 `[lo, hi]`(School B)。
 * fallback 規則與 `toonGradient` / `rampFloor` **同一條**:未知鍵一律回 3。
 * ⚠ 用 `Array.isArray` 而不是 truthy:`CEL_CUT` 同時裝著兩個純量旋鈕
 * (`SHADOW_V` / `HUE_MIN_A`),truthy 判定會讓 `bands: 'SHADOW_V'` 這種鍵穿過去。
 * @param bands 2 / 3 / 4 / 'soft';省略 = 3
 */
export function cutOf(bands = 3) {
  const key = Array.isArray(CEL_CUT[bands]) ? bands : 3;
  return CEL_CUT[key];
}

// ---------------- 陰影偏色搬進 ramp(P1-B;2026-08-03)----------------
// 舊制的 `CEL_COOL` 是**事後**把 `outgoingLight` 往冷色拌一下,而且**只有 `envMat` 開**;
// 機甲/英雄/武器走 `toonMat` ⇒ 它們的陰影只是「比較暗」,不是「有顏色」。
// 賽璐璐的暗面本來就該讀成天光反射,這是這批改動裡唯一會動到每一台機甲外觀的一項,
// 故 docs/visual_upgrade_plan.md 把它單獨列成一個批次並要求先確認方向 ——
// 落地方式因此是**設定頁的拉桿**(visualPrefs.js),預設 0 = 逐位元同舊制。
//
// 做法:把偏色接在 **ramp 查表**上(`getGradientIrradiance` 的回傳值),不是接在最終顏色上。
// 差別在於它從此吃到**每一盞燈**、也自動跟著 ramp 的階走(暗階偏得多、亮階不偏),
// 而事後拌色只認得到那一條手寫的 `dot(normal, sun)`。
//
// **偏色 MUST 是亮度中性的**:A14 / #INC-106 規定 ramp 暗階不得低於 102,而「把暗階乘上一個
// 亮度 < 1 的顏色」正是繞過那條規則的後門(畫面上只表現成深色件在暗面塌成黑塊)。
// 故色相向量先除以自身的 Rec.709 亮度 ⇒ 任何強度下 `luma(tint) === 1`,暗階的**亮度**
// 逐位元不動,只有色相在走。
const SHADOW_HUE = [0.86, 0.93, 1.10];      // 天光藍綠(與 postfx GRADE.SHADOW 同方向)
const LUMA_709 = [0.2126, 0.7152, 0.0722];
const SHADOW_HUE_N = (() => {
  const l = SHADOW_HUE[0] * LUMA_709[0] + SHADOW_HUE[1] * LUMA_709[1] + SHADOW_HUE[2] * LUMA_709[2];
  return SHADOW_HUE.map((c) => c / l);
})();
// 拉桿上限(= `VISUAL_KNOBS.shadowMech/shadowEnv.max`;稽核 Ⅱ 逐值比對兩者,分家會紅字)。
//
// **為什麼上限不是 1**:`SHADOW_HUE` 是**方向**,1.0 只是它自己那個長度。偏色乘的是 ramp
// 查表的回傳值 = 只有**直接光**那一項,而暗階的直接光本身就只有滿亮的 0.4 倍,旁邊還有一份
// 完全不偏色的環境光在稀釋 ⇒ 1.0 在真瀏覽器上量到的峰值只有 **+5/255 藍、−2/255 紅**
// (2026-08-03 逐像素量測),肉眼等同沒動 —— 這正是計畫書 P1-B 說的「cel 的陰影要有顏色,
// 不是只是被壓暗」沒有兌現。上限拉到 3 之後同一顆球的峰值 ≈ ±16/255,拖拉桿看得出來。
// **亮度中性與上限無關**:`luma(1 + (c−1)a) = 1 + (luma(c) − 1)·a`,而 `luma(SHADOW_HUE_N) ≡ 1`
// ⇒ **任何** a 的亮度都恰好是 1(A14 的暗階亮度逐位元不動)。上限存在只為了不讓通道被拉到
// 負數(最紅的通道要到 a ≈ 13.7 才碰到 0),MUST NOT 拿它當「安全亮度」的保險。
const TINT_MAX_A = 3;
/**
 * 陰影偏色乘數(單一縫:GLSL 的 uniform 與樣品畫面同吃這一支)。
 * @param amount 0~TINT_MAX_A(0 = 白 = 不偏色,逐位元同舊制;1 = SHADOW_HUE 本身的長度)
 */
export function shadowTintRGB(amount) {
  const a = Math.min(TINT_MAX_A, Math.max(0, amount || 0));
  return SHADOW_HUE_N.map((c) => 1 + (c - 1) * a);
}

// three 的 ramp 查表**那一行原文**(住在 `getGradientIrradiance()` 裡)。
// 升級 three MUST 重新核對這一行(chunk 改寫 ⇒ 替換靜默失效)。
// 替換不成功時走 `uCelRampFb` 的等效落地路徑(原則 6 降級不例外),不會變成「拉桿沒反應」。
const RAMP_HOOK = 'return vec3( texture2D( gradientMap, coord ).r );';
// **`getGradientIrradiance()` 住在 `gradientmap_pars_fragment`,不是 `lights_toon_pars_fragment`**
// —— 後者只是「呼叫它」的地方(`RE_Direct_Toon` 那一行)。錨錯 chunk 的症狀是
// `RAMP_PATCHED` 恆為 null ⇒ 每一份材質都走落地保險,而畫面上只表現成「兩根陰影偏色拉桿
// 拉了看不出差異」,沒有任何錯誤訊息(2026-08-03 使用者回報;真瀏覽器實測 uCelRampFb 恆 = 1)。
// chunk 名因此只准有**這一份**,`#include` 指令 MUST 由它推導 —— 兩個名字各寫一次的話,
// 「取哪個 chunk 的原文」與「換掉哪個 include」遲早指向不同的 chunk,而那正是上面那個 bug。
const RAMP_CHUNK = 'gradientmap_pars_fragment';
const RAMP_INC = `#include <${RAMP_CHUNK}>`;
// **MUST 從 `THREE.ShaderChunk` 取 chunk 原文再換掉 include 指令**,MUST NOT 直接在
// `shader.fragmentShader` 上找那一行 —— `onBeforeCompile` 收到的是**還沒展開 include** 的原始碼
// (本檔其餘每一處補丁都錨在 `#include <…>` 上,正是這個理由)。在展開後的字串上找,
// 永遠找不到、永遠走落地路徑,而畫面上只表現成「偏色比預期柔一點」,不會有任何錯誤。
// chunk 從 three 自己身上讀 ⇒ 不必把它的原始碼抄一份進來。
// 偏色權重的單一縫(GLSL 端;JS 端的基準值是 `rampFloor`)。
// **權重是「這一階在 ramp 上有多深」,不是「這一階有多亮」**(2026-08-04 使用者回報
// 「機體陰影、環境陰影調整時,展示樣品看不出差異」的一半原因):舊制直接拿 `celG` 當權重,
// 而 `celG` 是那一階的**亮度** —— A14/#INC-106 規定暗階 ≥ 102 是為了「深色件不塌黑」,
// 拿它當偏色權重等於讓那條保命規則順便把偏色也一起夾掉:三階 ramp 的暗階 celG = 0.4
// ⇒ 就算拉桿拉到底,最暗的那一階也只吃得到 **60%** 的偏色,而拉桿的說明寫的是
// 「100% = 天光藍本身的濃度」。兩件不同的事被同一個數字綁在一起,而且不會報錯。
// 正規化之後:最暗階 = 這張 ramp 的暗階值 ⇒ 權重 0 ⇒ **整份**偏色;最亮階恆為 1 ⇒
// 逐位元不偏(「賽璐璐的受光面就該是光源本色」這條不變)。強度 0 仍是純白乘數 ⇒ 舊制。
const RAMP_DEPTH_FN = `
  // 0 = 這張 ramp 的最暗階(吃滿偏色)、1 = 最亮階(不偏)。分母的下限只為了防 ramp
  // 退化成單一階時除以 0(RAMPS 每一組的頂階都是 255 ⇒ 正常情況恆 > 0)。
  float celRampDepth( float g ) {
    return clamp( ( g - uCelRampLo ) / max( 1e-3, 1.0 - uCelRampLo ), 0.0, 1.0 );
  }`;
// School A 的替換文字裝進**具名常數**(2026-08-16):本項的逐位元中性靠「School A 吐出的
// GLSL 字串逐字不變」拿保證,而那句話要有東西可以比對 —— 稽核 Ⅺ 直接釘住這一段原文。
const RAMP_PATCH_A = `
    {
      // ramp 的階值 celG:暗階最小、亮階 = 1。偏色只給暗階(權重 = celRampDepth),
      // 亮階恆不偏 —— 賽璐璐的受光面本來就該是光源本色。
      // 乘數的 Rec.709 亮度恆 = 1(shadowTintRGB 已正規化)⇒ 暗階亮度逐位元不動,A14 不受影響。
      float celG = texture2D( gradientMap, coord ).r;
      return vec3( celG ) * mix( uCelRampTint, vec3( 1.0 ), celRampDepth( celG ) );
    }`;
// School B 的替換文字:**回傳線性 N·L**,一階量化都不做。
// 這一行是整個學派切換的唯一分岔點 —— 換掉之後 `reflectedLight.directDiffuse` 就是
// 「已經乘過**陰影遮罩**與燈色的累積直接光」(three r160 `lights_fragment_begin` 把
// `getShadow()` 乘進 `directLight.color`,而 `RE_Direct_Toon` 在那之後才呼叫
// `getGradientIrradiance()`)⇒「投影遮蔽與 N·L 被同一刀量化」這件 School B 唯一買得到的
// 東西,是這一行的直接推論,不需要任何新的 three 錨點。
// `dotNL` 是 r160 `getGradientIrradiance()` 內的既有區域變數(2026-08-16 對過 r160 原文)。
const RAMP_PATCH_B = `
    {
      // School B:不查表。量化整個往後挪到 opaque_fragment 前置的那一刀。
      return vec3( saturate( dotNL ) );
    }`;
const RAMP_CHUNK_SRC = THREE.ShaderChunk?.[RAMP_CHUNK];
const RAMP_CAN = typeof RAMP_CHUNK_SRC === 'string' && RAMP_CHUNK_SRC.includes(RAMP_HOOK);
// 學派是**模組載入時定案一次**的常數(與 `installWorldCurve` 讀 `?curve=0` 同一個 idiom),
// **MUST NOT** 做成每幀可切的共享 uniform:所有 School B 的東西都包在
// `_school === 'b'` 的**字串拼接**裡 ⇒ School A 走的是同一份 GLSL 原始碼,不是「同一支
// 程式裡的另一條分支」,連 mix/select 造成的浮點重排都不存在。
// 代價寫在旋鈕的 hint 裡:**切換後要重新開一場才生效**。
//
// 替換錨點對不上(升級 three)⇒ School B **退回 School A**(原則 6:寧缺勿錯)。
// MUST NOT 讓它硬切一個**已經量化過**的 ramp 值 —— 那一刀會切在階梯上,終端線變鋸齒。
const _school = (() => {
  const qs = typeof location !== 'undefined' ? location.search : '';
  const q = new URLSearchParams(qs).get('cel');
  const want = (q === 'a' || q === 'b') ? q : (visualPref('celSchool') === 'b' ? 'b' : 'a');
  if (want === 'b' && !RAMP_CAN) {
    console.warn('[cel] three 的 ramp 錨點對不上,賽璐璐學派 B 退回 A');
    return 'a';
  }
  return want;
})();
/** 現役學派('a' = ramp 查表 / 'b' = 硬切;稽核與 `?cel=` 的回報用) */
export function celSchool() { return _school; }
const RAMP_PATCHED = RAMP_CAN
  ? RAMP_CHUNK_SRC.replace(RAMP_HOOK, _school === 'b' ? RAMP_PATCH_B : RAMP_PATCH_A)
  : null;

// 共享 uniform:一份物件餵給所有材質 ⇒ 拉桿改值即全場生效,MUST NOT 改成重建材質
// (材質早就發到 GPU 了,戰鬥中重建等於整場卡住)。
const _rampTint = {
  mech: { value: new THREE.Color(1, 1, 1) },
  env: { value: new THREE.Color(1, 1, 1) },
};

// ---------------- School B 的 GLSL(硬切重組)----------------
// **只在 `_school === 'b'` 時拼進字串**;School A 這兩段一個字元都不會出現。
//
// 亮度的定義只有一份:`LUMA_709`。**MUST NOT 手抄那三個數** —— 手抄的那一份會跟
// `shadowTintRGB` 的正規化分家,而 A14 ③ 的亮度恆等式正是靠這兩者是同一把尺。
const CEL_LUM_GLSL = `        float celLum( vec3 c ) { return dot( c, vec3( ${LUMA_709.join(', ')} ) ); }`;
// 主光色 × 強度。**MUST 讀 three 自己那份燈光 uniform,MUST NOT 在 JS 端再存一份**:
// ①`directionalLights[i].color` 就是 `light.color × light.intensity`(WebGLLights 寫進去的),
//   而 `environment.js` 的日夜循環每幀都在改那兩個值 ⇒ 天色自動跟著走;
// ②JS 副本要有一個呼叫端每幀餵它,而那個呼叫端住在別的檔 —— 兩份數字遲早分家,
//   症狀是「夜戰的暗側是一個與太陽無關的常數」,`DAYCLOCK` 整套在畫面上靜默失效,
//   而 `audit_daynight` 每一條斷言照樣全綠(它量的是 `clockHour`/`sunDirAt` 的數,不是像素)。
// ③這裡取的是**沒有乘過陰影遮罩**的燈色(遮罩只乘進 `lights_fragment_begin` 的區域變數
//   `directLight.color`)⇒ 它就是「這一格如果完全受光會是什麼顏色」的定義。
const CEL_KEY_GLSL = `
        vec3 celKeyColor() {
          vec3 celK = vec3( 0.0 );
          #if NUM_DIR_LIGHTS > 0
          for ( int i = 0; i < NUM_DIR_LIGHTS; i ++ ) celK += directionalLights[ i ].color;
          #endif
          return celK;
        }`;
const CEL_CUT_DECL_GLSL = `
        uniform float uCelCutLo;
        uniform float uCelCutHi;
        uniform float uCelShadowV;
${CEL_LUM_GLSL}
${CEL_KEY_GLSL}`;
// 重組本體。四條鐵律(每一條壞掉都不報錯):
//   ①**MUST 排在 rim / metal 之前**:重組是**覆寫** `outgoingLight`,寫在它們之後就把
//     那兩個加成式演出吃掉,而畫面上只表現成「金屬高光不見了」。
//   ②`totalEmissiveRadiance` MUST 重新加回來 —— 覆寫會把它吃掉,症狀是所有自發光件
//     在夜裡熄滅(隧道 / 窗光 / 曳光的底色)。
//   ③**切的輸入 MUST 把 albedo 除掉**:`directDiffuse` 含 albedo,而本專案的機體塗裝
//     從 0x0a 到 0xff 都有 ⇒ 直接拿它當 0~1 的遮蔽量,深色裝甲永遠跨不過那道門檻,
//     看起來像「這台機體永遠背光」。除法的分母取**同一格的全受光值** `celOnL` ⇒
//     單一主光時 `celLit ≡ dotNL × shadow`,**對任何基色、任何燈色都是恆等式**
//     (albedo 與燈色在分子分母上同時出現,逐通道約掉之後 luma 也約掉)。
//   ④**暗側的亮度 MUST 重正規化**(A14 ③ 在硬切路徑上的等價式):
//     `luma(celOn × tint) ≠ luma(celOn) × luma(tint)` —— luma 是內積,對逐通道乘法
//     不是乘性的(純紅基色上比值就是 tint.r)。少了那一行就是「把亮度藏進色相」的後門,
//     而畫面上只表現成深色件在暗面塌成黑塊,正是 A14 / #INC-106 當初要擋的那件事。
//     加了之後 `luma(celOff) ≡ uCelShadowV × luma(celOn)` 對**任何**基色與**任何**拉桿值
//     恆成立,而 `uCelShadowV ≥ rampFloor(3)` 是 A14 ② 的那條地板。
const CEL_CUT_MIX_GLSL = `
          {
            // ---- School B:硬切重組(§0-b)----
            vec3 celKey = celKeyColor();
            vec3 celOn = diffuseColor.rgb * celKey * RECIPROCAL_PI;
            float celOnL = celLum( celOn );
            float celLit = celOnL > 1e-6 ? saturate( celLum( reflectedLight.directDiffuse ) / celOnL ) : 0.0;
            float celCut = smoothstep( uCelCutLo, uCelCutHi, celLit );
            vec3 celOff = celOn * uCelRampTint;
            celOff *= uCelShadowV * celOnL / max( 1e-6, celLum( celOff ) );
            outgoingLight = mix( celOff, celOn, celCut ) + reflectedLight.indirectDiffuse + totalEmissiveRadiance;
          }`;
/** School B 的三個逐材質 uniform(硬度來自這份材質自己的 `bands`)。 */
function celCutUniforms(shader, bands) {
  const [lo, hi] = cutOf(bands);
  shader.uniforms.uCelCutLo = { value: lo };
  shader.uniforms.uCelCutHi = { value: hi };
  shader.uniforms.uCelShadowV = { value: CEL_CUT.SHADOW_V };
}

// ---------------- 風化屬性場(P2-A;2026-08-03)----------------
// 舊制的 moss / wash 對**全場每一個環境物件**一視同仁 —— 沒有任何「這一區比那一區老」的
// 概念,而那正是大面積場景看起來像貼圖重複的原因。改吃 `field.js` 的散布橢圓場
// (與地表色階梯同一支縫,但**種子錯開**:兩者鎖在一起的話「顏色深的地方剛好也長最多苔」,
// 反而更假)。場烤成一張小貼圖由世界 XZ 取樣 ⇒ 逐像素成本 = 一次 texture2D,
// MUST NOT 在片段著色器裡跑 26 個橢圓的迴圈。
const WEATHER_SPREAD = 0.8;      // 場 0/1 兩端相對中性值的擺幅(× 拉桿值)
let _wTex = null;
const _wField = { value: null };
const _wRect = { value: new THREE.Vector4(0, 0, 1, 1) };   // (minX, minZ, 1/寬, 1/高)
const _wSpread = { value: 0 };
// 岸邊泡沫的強度與顏色(共享 uniform;深度場本體住下方的 `_seaField`)。
// **宣告 MUST 排在 `syncVisualPrefs` 之前** —— 那一支在模組載入時就跑一次,`const` 的 TDZ
// 會讓整支 toon.js 在 import 當下丟 ReferenceError,而錯誤訊息指向完全無關的地方。
const _foamA = { value: 0 };
const _foamC = { value: new THREE.Color(0.94, 0.97, 1) };
// 墨線斷筆(序 4 ①-2)/ 地貌分界墨線(序 4 ①-3)的共享 uniform。
// **宣告位置與 `_foamA` 同一個理由**(上面那段註解):`syncVisualPrefs()` 在模組載入時就跑,
// 寫在它後面就是 TDZ ReferenceError,而錯誤訊息指向完全無關的地方。
// 形狀常數住 `INK_BREAK`(見「軟性物質」段下方)—— 那一份不進 syncVisualPrefs,可以晚一點宣告。
const _inkBreakA = { value: 0 };
const _landInkA = { value: 0 };
let _landTex = null;
const _landField = { value: null };
const _landRect = { value: new THREE.Vector4(0, 0, 1, 1) };

/** 中性場(還沒載入戰場、或展示台/角色預覽):恆 0.5 ⇒ 乘數恆 1 */
function neutralWField() {
  const t = new THREE.DataTexture(new Uint8Array([128]), 1, 1, THREE.RedFormat);
  t.needsUpdate = true;
  return t;
}
_wField.value = neutralWField();
{
  const t = new THREE.DataTexture(new Uint8Array([2, 0, 128, 0]), 1, 1, THREE.RGBAFormat);
  t.needsUpdate = true;
  _landField.value = t;
}

/** 安裝線工切面地貌場；上一場貼圖立即釋放(A25)。 */
export function setLandField(data, nx, nz, bounds) {
  const old = _landTex;
  const t = new THREE.DataTexture(data, nx, nz, THREE.RGBAFormat);
  t.minFilter = t.magFilter = THREE.NearestFilter; // R/G 是類別，線性過濾會插出不存在的分區。
  t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
  t.needsUpdate = true;
  _landTex = t;
  _landField.value = t;
  _landRect.value.set(bounds.minX, bounds.minZ,
    1 / Math.max(1e-6, bounds.maxX - bounds.minX), 1 / Math.max(1e-6, bounds.maxZ - bounds.minZ));
  old?.dispose();
}

/**
 * 安裝風化場(唯一寫入點;呼叫端 = `terrain.js buildTerrain`,每場一次)。
 * @param data   `field.js bakeFieldTexture` 的 Uint8Array(size × size,0~255)
 * @param size   邊長格數
 * @param bounds { minX, maxX, minZ, maxZ } 世界邊界(取樣用)
 */
export function setWeatherField(data, size, bounds) {
  const old = _wTex;
  const t = new THREE.DataTexture(data, size, size, THREE.RedFormat);
  t.minFilter = THREE.LinearFilter;      // 線性內插:場本來就是低頻的,取樣格點不該看得出來
  t.magFilter = THREE.LinearFilter;
  t.wrapS = THREE.ClampToEdgeWrapping;
  t.wrapT = THREE.ClampToEdgeWrapping;
  t.needsUpdate = true;
  _wTex = t;
  _wField.value = t;
  _wRect.value.set(bounds.minX, bounds.minZ,
    1 / Math.max(1e-6, bounds.maxX - bounds.minX), 1 / Math.max(1e-6, bounds.maxZ - bounds.minZ));
  old?.dispose();   // A25:上一場的場貼圖不放掉就是每開一場漏一張
}

// ---- 設定頁樣品的專屬場(2026-08-03)----
// 「風化密度」那根拉桿在樣品上**證明性地**什麼都不會發生,原因有兩層,而且兩層都不報錯:
//   ① 大廳還沒有戰場 ⇒ 場是 `neutralWField()` 的 1×1 中性貼圖(恆 0.5)⇒ `celWeatherF()`
//      逐位元恆為 1,不管拉桿拉到哪(2026-08-03 逐像素量測:全畫面差 0)。
//   ② 就算在戰鬥中開設定,世界那張場的取樣框是**整張圖**(數百公尺),而樣品在世界座標系裡
//      只佔 24m ⇒ 整個樣品落在場的同一個值上,那個值是多少純看樣品的座標剛好落在哪。
// 故樣品走**自己的一張場**:同一支 `field.js`、同一段 `celWeatherF()` 取樣碼、同一個
// `uCelWSpread` —— 只有「取樣框」與「哪一張貼圖」兩個 uniform 換軌,與 `_rampTint` 的
// mech / env 兩軌同一個道理(規則一份,軌兩條)。
// **MUST NOT 改成讓樣品去呼叫 `setWeatherField`**:那是世界場的唯一寫入點,戰鬥中一開設定
// 就會把整場的風化場換成樣品那一張(而且關掉設定也換不回來)。
const PREVIEW_SEED = 0x5A17C3;
const PREVIEW_SPAN = 24;      // = matsample 地面的邊長:場的起伏剛好鋪滿樣品畫面
const PREVIEW_TEX_N = 64;
const _wFieldPrev = { value: null };
const _wRectPrev = {
  value: new THREE.Vector4(-PREVIEW_SPAN / 2, -PREVIEW_SPAN / 2, 1 / PREVIEW_SPAN, 1 / PREVIEW_SPAN),
};
function ensurePreviewField() {
  if (_wFieldPrev.value) return;
  const h = PREVIEW_SPAN / 2;
  const data = bakeFieldTexture(makeField(PREVIEW_SEED, PREVIEW_SPAN),
    { minX: -h, maxX: h, minZ: -h, maxZ: h }, PREVIEW_TEX_N);
  const t = new THREE.DataTexture(data, PREVIEW_TEX_N, PREVIEW_TEX_N, THREE.RedFormat);
  t.minFilter = THREE.LinearFilter;
  t.magFilter = THREE.LinearFilter;
  t.wrapS = THREE.ClampToEdgeWrapping;
  t.wrapT = THREE.ClampToEdgeWrapping;
  t.needsUpdate = true;
  _wFieldPrev.value = t;
}

// 拉桿 → 共享 uniform(訂閱一次;本檔是全專案唯一持有這些 uniform 的地方)
// School B 下把兩根偏色拉桿夾上 `CEL_CUT.HUE_MIN_A` 的**下限**(A14 ③ 的色相那一半):
// 拉桿的 def 是 0,照搬過去就是灰色陰影 = 整個換學派的收益歸零。
// School A 下 `_school !== 'b'` ⇒ 這一支**逐位元同舊制**(`shadowTintRGB(0)` 仍是純白)。
const tintA = (k) => (_school === 'b' ? Math.max(visualPref(k), CEL_CUT.HUE_MIN_A) : visualPref(k));
function syncVisualPrefs() {
  _rampTint.mech.value.setRGB(...shadowTintRGB(tintA('shadowMech')));
  _rampTint.env.value.setRGB(...shadowTintRGB(tintA('shadowEnv')));
  _wSpread.value = WEATHER_SPREAD * visualPref('weather');
  _foamA.value = visualPref('foam');
  _inkBreakA.value = visualPref('inkBreak');
  _landInkA.value = visualPref('landInk');
}
syncVisualPrefs();
onVisualChange(syncVisualPrefs);

// ---- 共用光向 uniform(view space;每幀由 updateCelLight 更新)----
// 所有 cel 材質共享同一個 Vector3 實例,主迴圈更新一次即全場生效。
const _celLightDirView = new THREE.Vector3(0.4, 0.8, 0.4);
let _sunDirWorld = new THREE.Vector3(0.4, 0.8, 0.4);

/** environment.js 建立太陽光後呼叫:記錄世界空間光向 */
export function setCelSun(pos) {
  _sunDirWorld = pos.clone().normalize();
}

/**
 * 每幀呼叫(render 前):把太陽光向轉到 view space 餵給硬邊高光 / CEL_COOL。
 * @param dirWorld 覆寫用的世界光向(設定頁樣品:它有**自己**的一盞燈,見 matsample.js)。
 *   省略 = 本場太陽(`setCelSun`)。覆寫是**每幀重寫**的共享 uniform ⇒ 誰要 render 誰先呼叫,
 *   不留殘影;MUST NOT 改成「樣品去寫 `_sunDirWorld`」(那會把整場的光向換掉且換不回來)。
 */
export function updateCelLight(camera, dirWorld = null) {
  _celLightDirView.copy(dirWorld || _sunDirWorld).transformDirection(camera.matrixWorldInverse);
}

// ---------------- 軟性物質:細勾線 + 隨風飄揚(2026-08-04)----------------
// 使用者定案:「不同類型物件有不同線條輪廓的粗細,例如雲朵、芒草、草原、花園、樹葉、旗幟
// 這些軟性的物質的線條會細得多,其他堅硬的物體則依據設定的數值」+「這些軟性物質加入
// 隨風飄揚之類的重複性變化」。
//
// **兩件事共用同一個旗標**,這是本段唯一的設計決定:一個零件是不是「軟的」,決定它
// ①勾線要多細 ②會不會被風吹動。拆成兩份名單(「哪些東西線細」與「哪些東西會飄」)遲早分家,
// 而分家的症狀是「這叢草會飄但線是硬的」——沒有任何錯誤訊息,只是看起來不對。
//
// ---- ① 細勾線怎麼傳到勾線 pass ----
// 世界的線由 `postfx.js` 的**螢幕空間** pass 一次蓋全場(見那支的檔頭:外殼包住整個世界
// 是幾百個 draw call,不可行)。螢幕空間 pass 天生不認識「這個像素是什麼東西」⇒ 必須有
// 一條逐像素的通道。**通道 = 場景 RT 的 alpha**:
//
//     場景 RT 的 alpha ≡ 這一格的**勾線門檻倍率**(1 = 硬性,< 1 = 軟性 ⇒ 線更細)
//
// ---- 2026-08-16(序 4 ①-2):同一條通道自此帶**兩個因子的乘積** ----
//     alpha ≡ 軟性(這是什麼材質,逐材質常數)× 雜訊斷筆(這一格的筆抬起來了沒有,逐 fragment)
// **寫入點仍然恰一處**(下面那一段 CEL_INKA 區塊裡的那一行)——
// 兩個因子分兩處寫就是兩份契約,而分家的症狀是「斷筆只作用在軟性件上」。
// ⚠ 這一段刻意**不逐字複述**那一行程式碼:`--break-inkbreak` 的字面替換會先咬到註解,
// 而註解被 `code()` 剝掉之後斷言照樣全綠 = 反向驗證等於沒跑(2026-08-16 當場踩過)。
// 讀取端(`postfx.js` 的 `soft = min(這一格 + 四鄰)` 與 `smoothstep(EDGE0, EDGE1, ae*soft)`
// 以及 `ink = max(ink, mrtEdge * soft)`)**一行都不用改**:它天生就把新因子吃進去,
// 而且深度那一份訊號與折邊那一份同時變細 = 真的像筆抬起來,不是只有其中一種線斷掉。
//
// 這是 toon.js 與 postfx.js 之間的**契約**,兩邊的註解都指向這一行。可行的理由有三:
//   ・three 對 `transparent === false && blending === NormalBlending` 的材質一律 `NoBlending`
//     ⇒ 不透明件的 alpha 是**直寫**的,不會被混合攪掉;
//   ・鏈上最後一 pass(FXAA)輸出 `vec4(rgb, 1.0)`、畫布 context 又是 `alpha: false`
//     ⇒ alpha 從來沒有被當成不透明度用過,這個通道是空的;
//   ・半透明件(水面/特效)混合後 alpha 只會被推向 1 = **硬性**,也就是**舊行為**
//     (原則 6:偏差方向一律朝「不改變既有畫面」)。
// 未標軟性的材質一律不碰 alpha ⇒ `INK_SOFT_A` 以外的每一個像素**逐位元同舊制**。
//
// ---- ② 為什麼「細」是門檻倍率而不是取樣半徑 ----
// 勾線的取樣半徑 `INK.THICK` 已經是 1 個像素(那支的註解:「> 1 會讓細線斷開」),沒有
// 更細的半徑可用。真正決定「畫出來幾格寬」的是**門檻**:二階差分 `|e|` 從邊緣往外遞減,
// 門檻抬高 ⇒ 越過門檻的像素帶變窄。故軟性 = 把 `|e|` 乘上 `INK_SOFT_A` 再進 smoothstep
// —— 線帶真的變窄(不是只變淡),而且 `INK_SOFT_A = 1` 逐位元回到舊制。
const INK_SOFT_A = 0.3;

// ---- 墨線斷筆(2026-08-16;序 4 ①-2)----
// 「像筆抬起來」= 沿著線隨機把門檻倍率壓低一段。四個常數的語意逐條寫在這裡:
//   ・`SPAN_*` 是**世界公尺的抬筆週期**,兩軌分開的理由是尺度差兩個量級:機體全高 4.5~9m
//     (一筆畫要有十來個週期才讀得出「斷」),而地形的一筆畫跨數十公尺。軌的選擇沿用既有的
//     `tint` 參數(`toonMat` 恆 'mech'、`envMat` 恆 'env',= `_rampTint` 那條已存在的軸),
//     **MUST NOT 另建「哪些材質算機體」的名冊**(名冊會在加零件時靜默過期)。
//   ・`CUT` 是 `celNoise` 值域 [0,1] 上的斷點門檻(越大斷得越多)。
//   ・`LO` 是斷處的門檻倍率。**0 = 真的斷開**;取 0.12 = 筆壓變輕 —— 輪廓線對著天空整段消失
//     讀起來是破洞,而 `INK_SOFT_A` 那條先例本來就是「變細不是不見」。
// ⚠ 三件離線稽核看不到的事(定裝照才驗得到,見 audit_soft_stroke Ⅺ 的檔頭):
//   ① 勾線 pass 取 `min(這一格 + 四鄰)` ⇒ 缺口被**侵蝕一圈**,實際比寫進去的寬約 2px;
//   ② 斷筆錨在世界/局部空間 ⇒ 一個週期投影到螢幕的像素數 ∝ 1/距離,`SPAN_MECH` 太小會在
//      遠處退化成亞像素雜訊(`LO ≠ 0` 讓它變成「濃淡在抖」而不是「洞在閃」,那是取捨不是解);
//   ③ 8bit RT 上 `INK_SOFT_A × LO = 0.036` ≈ 9/255 ⇒ 軟性件的斷處實質等於沒有線。
export const INK_BREAK = {
  SPAN_ENV: 3.0,      // 環境軌的抬筆週期(遊戲公尺)
  SPAN_MECH: 0.45,    // 機體軌;MUST < SPAN_ENV(尺度差兩個量級)
  CUT: 0.42,          // celNoise ∈ [0,1] 上的斷點門檻
  LO: 0.12,           // 斷處的門檻倍率(0 = 真的斷開)
};

// ---- 地貌分界墨線(2026-08-16;序 4 ①-3)----
// `LAND_SURF_ID` 是「讓地貌**不要**出線」;反過來「同一塊地形上草↔岩要**出線**」需要
// 把地貌分區折進 surfaceId。三條算術寫在這裡,因為撞號是這一族唯一會靜默壞掉的地方:
//   ① 子帶 MUST 落在**整數格 `k/64`**(與 `surfGroup` 同一把梳子)—— 半整數格是 `nextSurfId`
//      的值域,落上去就是「某些地貌對某些材質的線靜默消失」。計畫原文的 `+= grassMask * 0.1`
//      **會撞**:0.1 / 0.15 落在現役槽 0.1015625 / 0.1484375 的 0.004 門檻之內。
//   ② 從**頂端**往下配(63, 62, …),而 `surfGroup` 由 2 往上配 ⇒ 一場戰鬥配不到 56 個群組
//      就不會碰面;真的碰面也只是既有那條「撞號 = 少一條線,不是壞掉」。
//   ③ **群組早退那一條例外**:它會讓整株樹的剪影消失而不是少一條線 ⇒ `postfx.js` 的早退
//      另外加了「五格都不是 LAND」這道閘(今天恆真 ⇒ 逐位元中性,見那一段註解)。
export const LAND_ZONE_N = 7;
// 每分區三態:基底 / 苔草 / 濕痕。基底仍佔頂端 7 格；兩種遮罩佔它下方 14 格。
export const LAND_MASK_N = 3;
/**
 * 地貌分區 → surfaceId 子帶(整數格,由頂端往下配)。
 * @param i 分區索引 ∈ [0, LAND_ZONE_N);超界或非整數一律回 `LAND_SURF_ID`(原則 6:
 *          寧缺勿錯 —— 回一個亂數格會在地面上畫出一條沒有意義的線)
 */
export const landZoneId = (i) => (Number.isInteger(i) && i >= 0 && i < LAND_ZONE_N
  ? (64 - LAND_ZONE_N + i) / 64 : LAND_SURF_ID);
/**
 * 地貌分區內的材質遮罩 → surfaceId 子帶。mask=1 苔草、2 濕痕；0 仍走 landZoneId。
 * 遮罩格緊接在基底格下方，且全是整數格，與逐材質的半整數格永不撞號。
 */
export const landMaskId = (zone, mask) => (Number.isInteger(zone) && zone >= 0 && zone < LAND_ZONE_N
  && Number.isInteger(mask) && mask > 0 && mask < LAND_MASK_N
  ? (64 - LAND_ZONE_N * LAND_MASK_N + zone * (LAND_MASK_N - 1) + mask - 1) / 64
  : LAND_SURF_ID);

// ---- `outlineContribution` 的推導縫(2026-08-16;S4 的 toon.js 那一半)----
// 與上面那個常數是同一族的兩半:軟性管**這條線多細**、貢獻管**這條線畫不畫**。
// 規則:呼叫端 MUST 傳「自己排零件時**已經算出來的**間距」,MUST NOT 手寫貢獻數字、
// MUST NOT 另建「零件種類 → 貢獻」的名冊(名冊會在加零件時靜默過期)。
// 唯一容許手寫的是 `INK_CONTRIB_NONE`(否決)。
//
// ⚠ **倍率 2 是授權值不是量測值**(同 `MINI.BUFFER_F = 1/3`、`SELF_ULT.REALIZED_F = 0.35`
// 的處理方式):試過 `SOLDIER_H`(把三組全推到 1)與 `heroTallestH() ≈ 26m`(全推到近 0)
// 兩個現成錨都配不起來。校準面 = 序 12b 的定裝照,MUST NOT 宣稱它是量出來的。
export const INK_REPEAT_M = SOLDIER_H * 2;
/**
 * 構件間距 → 貢獻。間距越密 ⇒ 那一排線越像雜訊 ⇒ 貢獻越低。
 * @param pitchM 構件重複的節距(遊戲公尺);≥ `INK_REPEAT_M` ⇒ 1(不重複 = 值得一條線)
 */
export const inkRepeat = (pitchM) => inkQuant(Math.min(1, Math.max(0, pitchM / INK_REPEAT_M)));

// ---- 玩家位移擾動(2026-08-16;S5 的 toon.js 那一半)----
// 機體走過去把腳邊的草撥開。三件事全部住頂點著色器 ⇒ 伺服器一格未改、碰撞一格未改。
// **N 是成本預算常數不是美術參數**:每一個槽位是逐頂點一次 `length()` + 一次 `smoothstep()`,
// 而草 / 稻那幾列是全場頂點數最高的 InstancedMesh。取 4 = 主視野機體 + 離相機最近的 3 台
// (第三人稱與觀戰下兩台常同框,只撥開自機腳邊的草很明顯不對)。
// ⚠ 代價寫在這裡而不是靠加大 N 掩蓋:被擠出槽位的那一台在下一幀 spd 歸 0 ⇒ 它腳邊的草
// 會彈回去。那是 N 有限的必然結果。
export const CHAR = {
  N: 4,
  R0: 1.1,          // 站著不動時的擾動半徑(m):貼著身體那一圈
  R_PER_MPS: 0.26,  // **半徑是速度的函式**(走路撥開、跑步甩開)—— 這一行就是這一項的本體
  SPD_REF: 6,       // 強度飽和速率(m/s):到這個速度就是滿幅
  PUSH_F: 1.8,      // 位移相對於該株擺幅(`uSoftAmp`)的倍率
  SPD_K: 6,         // 速率平滑的阻尼係數(消費端走序 2 的 `lerpFPS`,MUST NOT 自己寫 min(1, k·dt))
};

/**
 * 全場風(單一縫)。植被/旗幟(本檔的頂點位移)與雲朵(`environment.js` 的漂移)MUST
 * 同吃這一份 —— 兩邊各寫一個風向,畫面上就是「雲往東飄、草往西倒」。
 */
export const WIND = {
  DIR_DEG: 118,      // 風向(世界 XZ 方位角,度)
  WAVE_M: 26,        // 空間波長(m):風以**波**的形式掃過林子,不是全林同步點頭
  BEAT: 1.87,        // 第二諧波的頻率比;刻意取無理數附近 ⇒ 兩波的合成週期長到看不出重複
  CLOUD_MPS: 1.7,    // 雲的漂移速度(m/s)
  // ---- 陣風包絡(2026-08-13 使用者「稻浪 / 草波 / 芒草波」)----
  // WAVE_M 那一層給的是**相位**梯度:全場等幅擺動、只是彼此差半拍。整片稻田同時以同一個
  // 幅度晃,眼睛讀成「這片草在抖」而不是「有一道風掃過去」——「浪」的本錢在**振幅**也要
  // 跟著跑。故再疊一層波長長一個量級、速度慢一半的包絡:掃到的那一帶倒得深、其餘幾乎靜止。
  GUST_M: 210,       // 陣風包絡的空間波長(m):MUST ≫ WAVE_M,同量級的話兩層會互相拍頻成雜訊
  GUST_S: 0.21,      // 包絡的頻率(rad/s);與各 kind 的 freq 不可通約 ⇒ 合成週期看不出重複
  GUST_F: 0.55,      // 包絡深度。**0 = 逐位元回到 2026-08-04 的等幅擺動**(改制前後的對照組)
  // ---- 海浪(表面波)----
  // 波長是**尺**不是外觀旋鈕:水面的分段數由它推導(`seaSegM()`),手寫分段數的話改波長
  // 之後取樣率會掉到 Nyquist 以下,而畫面上只表現成「遠處的海在亂跳」。
  SEA_M: 64,         // 海浪波長(遊戲公尺;REAL_SCALE 2× ⇒ 真實 32m 的長浪)
  SEA_SEG: 8,        // 一個波長至少切幾段(= 取樣率;8 段對兩諧波合成後的最短波 1.6× 仍有 5 段)
  // ---- 水波空間變異化(2026-08-26 使用者「不同位置的水波都很像…加入更多隨機差異」)----
  // 三個機制打破 celSeaH 的空間均勻性:①噪聲擾動 ②深度調變 ③沼澤漣漪。
  // 全部只動 GLSL 的 celSeaH,**純表現層**(§0-4);waterY / 涉水 / 碰撞一行不動。
  SEA_NOISE_M: 120,    // 空間噪聲特徵尺度(m):振幅與相位的局部偏移。MUST ≫ SEA_M、< GUST_M
  SEA_NOISE_F: 0.35,   // 噪聲調變深度:0 = 舊制等幅;0.35 = ±35% 振幅 + ±1.2 rad 相位抖動
  // 淺水調變:復用 uSeaField 深度場(已有障礙物蓋章)。淺水波變短、變陡 = 碎浪前兆。
  // 障礙物附近(深度場 0)自動衰減,不需另寫一份遮罩。
  SEA_DEPTH_LO: 0.6,   // 淺水波長壓縮倍率:depth→0 時波數 ×(1/0.6) ≈ 1.67
  SEA_DEPTH_AMP: 1.3,  // 淺水振幅增益:波陡增加 = 白浪碎波
  // 沼澤局部漣漪(氣泡上浮 / 泥魚擾動):圓形衰減波,由確定性時鐘 + 世界座標雜湊驅動。
  SWAMP_RIPPLE_N: 5,     // 活躍漣漪源數(uniform vec4 陣列長度)
  SWAMP_RIPPLE_R: 8,     // 單一漣漪最大半徑(m)
  SWAMP_RIPPLE_AMP: 0.08, // 漣漪振幅(m;只夠產生視覺紋理,不影響 seaFade 帶的接縫)
  SWAMP_RIPPLE_SPD: 2.5,  // 漣漪擴散速率(m/s;黏滯液面慢波)
  SWAMP_RIPPLE_LIFE: 4.0, // 漣漪壽命(s)
};
const WIND_DIR = [Math.cos(WIND.DIR_DEG * Math.PI / 180), Math.sin(WIND.DIR_DEG * Math.PI / 180)];

/**
 * 軟性物質分類(單一縫)。`amp` 是**擺幅佔整株尺寸的比例**(不是公尺)——
 * 手寫公尺的話同一款植被放大兩倍就只擺一半,而「大樹擺得比小草多」正是風看起來對的原因。
 *   amp   擺幅 ÷ span
 *   freq  基頻(rad/s)
 *   axis  擺動權重沿哪個**零件局部軸**遞增('y' = 由根到梢;'x' = 由旗桿到旗尾)
 * `turf`(草坪/草皮/跑道內場)刻意 `amp: 0`:它是一塊 0.5m 厚的鋪面,擺動只會讓它與
 * 旁邊的步道錯開;它要的只有「不要被畫上硬黑邊」那一半。
 */
export const SOFT_KINDS = {
  // 頻率隨「這團東西有多重」遞減:樹冠是一大團葉子,慢;草穗輕,快;旗面最輕最快。
  // 反過來排(草比樹慢)看起來會像水草,不像風。
  leaf:  { amp: 0.035, freq: 0.62, axis: 'y' },   // 樹冠 / 葉簇 / 針葉
  // 樹幹/枝隨風搖曳(2026-09-02;2026-09-06 接縫連續修正):amp 與 leaf 一致、freq/axis 同 leaf ⇒ 幹梢與葉冠底部\r
  // 在**相同高度**上取到同一份位移,接縫不會被風吹開。amp 差一半的話冠底位移是幹梢兩倍、陣風峰值巨木接縫拉開約 1m。\r
  wood:  { amp: 0.035, freq: 0.62, axis: 'y' },   // 樹幹 / 樹枝(amp = leaf,與冠同位移接縫不開)
  grass: { amp: 0.075, freq: 1.15, axis: 'y' },   // 芒草 / 蘆葦 / 箭竹 / 花圃 / 稻
  cloth: { amp: 0.110, freq: 1.70, axis: 'x' },   // 旗幟
  turf:  { amp: 0,     freq: 0,    axis: 'y' },   // 草坪 / 內場草皮(只細線,不擺動)
  // 海浪(2026-08-13)。`axis: 'w'` = **表面波**,與上面四種是兩種不同的東西:
  //   ・上面四種:位移**沿風向水平**推、權重由根到梢遞增、相位取**實例原點**(一株 = 一相位)
  //   ・表面波  :位移**垂直**、無根梢之分、相位**逐頂點**取(整片海是一個 mesh,取原點的話
  //               全場只有一個相位 = 整片海一起上下,那是潮汐不是浪)
  // `amp` 在這一族的語意是**波陡**(波高 ÷ 波長)而不是「擺幅 ÷ 株高」,但算式同一條
  // (`uSoftAmp = amp × span`)⇒ span 傳波長就得到波高。0.014 × 64m = 0.9m(真實 0.45m 長浪)。
  sea:   { amp: 0.014, freq: 0.55, axis: 'w' },   // 海面 / 湖面 / 潟湖
  swamp: { amp: 0.004, freq: 0.32, axis: 'w', ripple: true },   // 沼澤水面:低頻慢速黏滯波 + 局部漣漪
};

/**
 * 水面的軟性參數(單一縫)。消費端 = `terrain.js` 的水盤與緩衝空間外環水面。
 * **MUST NOT 在消費端手寫波長**:那樣改 `WIND.SEA_M` 只會動到分段數而波形留在原地。
 */
export const seaSoft = () => ({ k: 'sea', span: WIND.SEA_M });
/** 沼澤水面的軟性參數(單一縫):消費端 = `biomes.js` 的沼澤水盤 */
export const swampSoft = () => ({ k: 'swamp', span: WIND.SEA_M });
/** 水面網格的最大邊長(m):由波長與取樣率推導,MUST NOT 手寫段數 */
export const seaSegM = () => WIND.SEA_M / WIND.SEA_SEG;


// 共享 uniform(同 `_celLightDirView` / `_rampTint`:一份物件餵給所有材質)。
// **時鐘刻意不取模**:各 kind 的頻率彼此不可通約,取模會在週期邊界跳一下;
// float32 在一小時(t = 3600)上的相位解析度仍有 ~0.001 rad,一場對局綽綽有餘。
const _windT = { value: 0 };
const _windDir = { value: new THREE.Vector2(WIND_DIR[0], WIND_DIR[1]) };
const _windK = {
  value: new THREE.Vector2(WIND_DIR[0], WIND_DIR[1]).multiplyScalar(Math.PI * 2 / WIND.WAVE_M),
};
// 陣風包絡的波數向量:同一個風向、長一個量級的波長(推導,MUST NOT 另寫一份方向)
const _gustK = (_windDir.gustK = {
  value: new THREE.Vector2(WIND_DIR[0], WIND_DIR[1]).multiplyScalar(Math.PI * 2 / WIND.GUST_M),
});
// 天氣動態風浪影響共享 uniform(強風/沙暴/雷雨時動態放大樹木搖晃、旗幟飄動、水波高度與擴散速度)
const _weatherWind = {
  amp: { value: 1.0 },
  freq: { value: 1.0 },
  waveAmp: { value: 1.0 },
  waveSpeed: { value: 1.0 },
};

/**
 * 安裝當前天氣的風浪動態係數與即時風向 (唯一寫入點;呼叫端 = environment.js / game.js)
 * @param {{ windAmp?:number, windFreq?:number, waveAmp?:number, waveSpeed?:number, windDir?:number[], windDirDeg?:number }} dyn
 */
export function setWeatherDynamics(dyn) {
  if (!dyn) return;
  _weatherWind.amp.value = dyn.windAmp ?? 1.0;
  _weatherWind.freq.value = dyn.windFreq ?? 1.0;
  _weatherWind.waveAmp.value = dyn.waveAmp ?? 1.0;
  _weatherWind.waveSpeed.value = dyn.waveSpeed ?? 1.0;

  if (dyn.windDir && Array.isArray(dyn.windDir) && dyn.windDir.length >= 2) {
    _windDir.value.set(dyn.windDir[0], dyn.windDir[1]);
    _windK.value.copy(_windDir.value).multiplyScalar(Math.PI * 2 / WIND.WAVE_M);
    _windDir.gustK.value.copy(_windDir.value).multiplyScalar(Math.PI * 2 / WIND.GUST_M);
  } else if (typeof dyn.windDirDeg === 'number') {
    const rad = dyn.windDirDeg * Math.PI / 180;
    _windDir.value.set(Math.cos(rad), Math.sin(rad));
    _windK.value.copy(_windDir.value).multiplyScalar(Math.PI * 2 / WIND.WAVE_M);
    _windDir.gustK.value.copy(_windDir.value).multiplyScalar(Math.PI * 2 / WIND.GUST_M);
  }
}

/** 查詢水面是否處於凍結/結冰狀態 (唯一判定來源) */
export function isWeatherFrozen() {
  return _weatherWind.waveAmp.value <= 0.001;
}

/** 取得當前全域天氣風浪動態資訊 (供環境落花/落葉/微粒參考) */
export function getWeatherDynamics() {
  return {
    windAmp: _weatherWind.amp.value,
    windFreq: _weatherWind.freq.value,
    waveAmp: _weatherWind.waveAmp.value,
    waveSpeed: _weatherWind.waveSpeed.value,
    windDir: [_windDir.value.x, _windDir.value.y],
  };
}
// 玩家位移擾動的兩支共享 uniform(同 `_windT` 的 idiom:一份物件餵給所有軟性材質)。
// 全槽 `spd = 0` ⇒ 位移項在著色器裡早退 ⇒ **逐位元同舊制**。
const _charPos = { value: Array.from({ length: CHAR.N }, () => new THREE.Vector3()) };
const _charSpd = { value: new Float32Array(CHAR.N) };
// 海面深度場(泡沫的驅動量)。預設 1×1 的「很深」中性貼圖 ⇒ 沒有水域 / 還沒烤 /
// 舊存檔一律**沒有泡沫**而不是滿場泡沫(原則 6 寧缺勿錯)。
let _seaTex = null;
const _seaField = { value: null };
const _seaRect = { value: new THREE.Vector4(0, 0, 1, 1) };   // (minX, minZ, 1/寬, 1/高)
function neutralSeaField() {
  const t = new THREE.DataTexture(new Uint8Array([255]), 1, 1, THREE.RedFormat);
  t.needsUpdate = true;
  return t;
}
_seaField.value = neutralSeaField();

/**
 * 安裝海面深度場(唯一寫入點;呼叫端 = `terrain.js` 的 `bakeSeaDepth`,每場一次)。
 * 逐條照抄 `setWeatherField` —— 包括 `old?.dispose()`(A25:不放掉就是每開一場漏一張)。
 * @param data   Uint8Array(size × size);值 = `clamp(水深 / FOAM.RANGE_M, 0, 1) × 255`
 * @param size   邊長格數(MUST 由 `seaFieldN()` 推導)
 * @param bounds { minX, minZ, w, h } 世界取樣框
 */
export function setSeaDepthField(data, size, bounds) {
  const old = _seaTex;
  const t = new THREE.DataTexture(data, size, size, THREE.RedFormat);
  t.minFilter = THREE.LinearFilter;
  t.magFilter = THREE.LinearFilter;
  t.wrapS = THREE.ClampToEdgeWrapping;
  t.wrapT = THREE.ClampToEdgeWrapping;
  t.needsUpdate = true;
  _seaTex = t;
  _seaField.value = t;
  _seaRect.value.set(bounds.minX, bounds.minZ,
    1 / Math.max(1e-6, bounds.w), 1 / Math.max(1e-6, bounds.h));
  old?.dispose();
}

// ---- 岸邊泡沫 / 水面倒影(2026-08-16;S6 的 toon.js 那一半)----
// 泡沫的驅動量是**水深**不是岸線幾何:水面 fragment 拿不到場景深度(它與 `rtScene.depthTexture`
// 是同一個 FBO 的附件 = 回饋迴圈),第二趟深度 prepass 又是 postfx 檔頭拒絕過的同一筆成本
// ⇒ 深度做成**烤好的場**(terrain 高度場 + `blockers` 蓋章),逐 fragment 取樣。
// 相位再減去 `celSeaH` ⇒ 浪一來泡沫沖上岸;繞過每一根柱子由蓋章那一步給。
// **MUST NOT 在 terrain.js / biomes.js 手寫這些值**(同 `SEA_M`/`SEA_SEG` 的紀律)。
export const FOAM = {
  BAND_M: 0.55,     // 泡沫帶的深度節距(m):一條帶 = 深度差這麼多
  STEP: 0.42,       // 硬邊門檻(賽璐璐的泡沫是白色硬邊,不是柔霧)
  SHAPE_K: 5,       // 帶心尖銳度:三角波直接 step 會讓每一道白條佔掉過半週期
  NOISE_M: 3.4,     // 噪聲的空間尺度(m):讓帶緣碎掉,不是一圈同心圓
  RANGE_M: 2.4,     // 只留潮緣近岸帶;6m 會在緩灘上鋪出十餘道道路標線般的白條
  TEXEL_M: 1.5,     // 場的 texel 邊長(m);低功耗折半由 `seaFieldN` 推導
};
export const REFL = {
  SEG_N: 3,         // 一個反射體切幾段(斷口讓它讀起來像被浪打散的倒影)
  GAP_F: 0.22,      // 斷口佔段長的比例
  MIN_H: 4,         // 進名冊的最小反射體高(m)
  MAX_N: 24,        // 反射體上限(一份幾何一個 draw call ⇒ 上限是頂點預算不是 draw call)
  HALF_F: 0.9,      // 倒影塊半寬 ÷ 反射體半徑
  MAX_HALF_M: 1.5,  // 巨船/長樓的 broad-phase 半徑不得把倒影撐成數十公尺寬的懸浮平板
  MAX_LEN_M: 18,    // 低視點的鏡像解會趨近水平距離;美術倒影只保留物件腳邊的碎段
};
/**
 * 深度場的邊長格數(**推導,MUST NOT 手寫 1024**)。低功耗折半 —— 手寫的話低階裝置
 * 多背 1MB VRAM 而畫面一模一樣(同 `SHADOW.TEXEL_M` 那一條)。
 */
export const seaFieldN = (worldW, worldH, low = false) => {
  const m = FOAM.TEXEL_M * (low ? 2 : 1);
  return Math.max(2, Math.min(1024, Math.ceil(Math.max(worldW, worldH) / m)));
};
/** 泡沫帶的深度節距(消費端只准經這一支取值) */
export const foamBandM = () => FOAM.BAND_M;

// ---- 風 / 浪 / 泡沫的 GLSL(**恰一份實作**,頂點與片段兩端注入同一份字串)----
// 泡沫住片段、浪高住頂點,而泡沫的相位要減去浪高 ⇒ 兩端都要 `celSeaH`。
// 抄第二份的代價是「泡沫的沖刷與浪峰差半個波長」,而畫面上只表現成「泡沫怪怪的」。
const CEL_WIND_GLSL = `
        uniform float uWindT;
        uniform vec2 uWindDir;
        uniform vec2 uWindK;
        uniform vec2 uGustK;
        uniform float uSoftSpan;
        uniform float uSoftBase;
        uniform float uSoftSy;
        uniform float uSoftAmp;
        uniform float uSoftFreq;
        uniform float uWeatherWindAmp;
        uniform float uWeatherWindFreq;
        uniform float uWeatherWaveAmp;
        uniform float uWeatherWaveSpeed;
        // 陣風包絡(單一實作,擺動與海浪同吃)。振幅乘上一層「波長長一個量級、走得慢一半」
        // 的行波 ⇒ 掃到的那一帶倒得深、其餘幾乎靜止 = 眼睛讀得出「一道浪推過去」。
        // 平均值恆為 1 ⇒ 這一層**不改變平均擺幅**,只重新分配;GUST_F = 0 恆回 1.0(舊制)。
        float celGust( vec2 celGxz ) {
          return 1.0 + ${WIND.GUST_F.toFixed(3)} * sin( uWindT * ${WIND.GUST_S.toFixed(3)} + dot( celGxz, uGustK ) );
        }`;

// ---- 沼澤漣漪(2026-08-26):圓形衰減波,模擬沼氣泡上浮/泥魚/生物擾動 ----
// 由 JS 端 stepSwampRipples() 每 2~5 秒更新一組漣漪源位置與啟動時間。
// **零 Math.random()**:位置由 windT + 座標雜湊推導(同 aquaticSeed idiom)。
const CEL_SWAMP_RIPPLE_GLSL = `
        #ifdef CEL_SWAMP_RIPPLE
        uniform vec4 uRipple[ ${WIND.SWAMP_RIPPLE_N} ];   // ( worldX, worldZ, startTime, amplitude )
        float celSwampRipple( vec2 celRxz ) {
          float celRsum = 0.0;
          for ( int i = 0; i < ${WIND.SWAMP_RIPPLE_N}; i++ ) {
            vec2 celRc = uRipple[ i ].xy;
            float celRt0 = uRipple[ i ].z;
            float celRa = uRipple[ i ].w;
            float celRage = uWindT - celRt0;
            if ( celRage < 0.0 || celRage > ${WIND.SWAMP_RIPPLE_LIFE.toFixed(1)} ) continue;
            float celRr = length( celRxz - celRc );
            float celRfront = celRage * ${WIND.SWAMP_RIPPLE_SPD.toFixed(1)};
            float celRrd = abs( celRr - celRfront );
            // 窄環波(寬 ≈ 0.8m)+ 空間衰減 + 時間衰減
            float celRring = exp( -celRrd * celRrd * 6.0 )
                           * exp( -celRr * celRr / ${(WIND.SWAMP_RIPPLE_R * WIND.SWAMP_RIPPLE_R).toFixed(1)} )
                           * ( 1.0 - celRage / ${WIND.SWAMP_RIPPLE_LIFE.toFixed(1)} );
            celRsum += celRa * celRring * sin( celRr * 5.0 - celRage * 8.0 );
          }
          return celRsum;
        }
        #endif`;

const CEL_SEA_GLSL = `
        // 水底密集隨機塊狀起伏誤差 (Water & Swamp Bed Blocky Undulation Error)
        // 沼澤水域 (高密度、小塊、強起伏):
        float celSwampBedError( vec2 p ) {
          vec2 c1 = floor( p * 0.85 );
          vec2 c2 = floor( p * 1.65 + vec2( 0.43, 0.67 ) );
          vec2 c3 = floor( p * 2.80 - vec2( 0.28, 0.81 ) );
          float h1 = fract( sin( dot( c1, vec2( 127.1, 311.7 ) ) ) * 43758.5453 ) * 2.0 - 1.0;
          float h2 = fract( sin( dot( c2, vec2( 269.5, 183.3 ) ) ) * 43758.5453 ) * 2.0 - 1.0;
          float h3 = fract( sin( dot( c3, vec2( 419.2, 371.9 ) ) ) * 43758.5453 ) * 2.0 - 1.0;
          return h1 * 0.48 + h2 * 0.36 + h3 * 0.16;
        }

        // 一般水域水底起伏誤差 (低密度、寬塊、平緩起伏):
        float celSeaBedError( vec2 p ) {
          vec2 c1 = floor( p * 0.22 );
          vec2 c2 = floor( p * 0.45 + vec2( 0.55, 0.35 ) );
          float h1 = fract( sin( dot( c1, vec2( 127.1, 311.7 ) ) ) * 43758.5453 ) * 2.0 - 1.0;
          float h2 = fract( sin( dot( c2, vec2( 269.5, 183.3 ) ) ) * 43758.5453 ) * 2.0 - 1.0;
          return h1 * 0.65 + h2 * 0.35;
        }

        // 浪高(世界 XZ 的純函式)。**位移與法線 MUST 吃同一支** —— 兩邊各寫一份的話,
        // 光影的浪與幾何的浪會差半個波長,而畫面上只表現成「水面的亮帶跟浪對不上」。
        //
        // 程序化水波特效升級 (純表現層,§0-4):
        //   ① 非筆直直線波前：領域扭曲 (Domain Warping) 與空間非線性有機彎曲擾動
        //   ② 深度調變與破碎化微波：淺水與沼澤水面注入破碎化短波微紋理
        //   ③ 遺跡/沈船切面同心波前：依 uSeaField 物件剖面等值線生成同心波，有機擾動且向外淡出
        //   ④ 障礙物近場衰減與基礎行波合成
        //   ⑤ 沼澤漣漪(CEL_SWAMP_RIPPLE):疊加局部圓形衰減波
        float celSeaH( vec2 celSxz ) {
          if ( uWeatherWaveAmp <= 0.001 ) return 0.0;
          // ① 非直線波前：領域扭曲 (Domain Warping)，消除筆直條紋感
          vec2 celWarp = vec2(
            sin( celSxz.y * 0.038 + celSxz.x * 0.015 + uWindT * 0.16 ) * 5.2
              + sin( celSxz.y * 0.082 - celSxz.x * 0.041 + 2.37 ) * 2.6,
            cos( celSxz.x * 0.034 - celSxz.y * 0.019 + uWindT * 0.13 ) * 5.2
              + cos( celSxz.x * 0.076 + celSxz.y * 0.043 + 1.19 ) * 2.6
          );
          vec2 celWxz = celSxz + celWarp;
          float celSp = dot( celWxz, uWindK );

          // 空間多頻干涉與相位偏移 (特徵尺度 ~${WIND.SEA_NOISE_M.toFixed(0)}m,打破單一行波空間均勻性)
          float celSn = sin( dot( celWxz, vec2( 0.0523, 0.0321 ) ) ) * 0.62
                      + sin( dot( celWxz, vec2( -0.0233, 0.0711 ) ) + 2.13 ) * 0.38;
          float celSn2 = sin( dot( celWxz, vec2( 0.0951, -0.0583 ) ) + 4.31 ) * 0.58
                       + sin( dot( celWxz, vec2( -0.0773, -0.1071 ) ) + 1.25 ) * 0.42;
          float celAmpMod = 1.0 + celSn * ${WIND.SEA_NOISE_F.toFixed(3)};
          float celPhJit = celSn2 * 1.2;

          // ② 深度調變:取樣同一張 uSeaField(含障礙物蓋章)
          vec2 celDuv = clamp( ( celSxz - uSeaRect.xy ) * uSeaRect.zw, vec2( 0.0 ), vec2( 1.0 ) );
          float celRawD = texture2D( uSeaField, celDuv ).r;
          float celDepF = smoothstep( 0.0, 0.5, celRawD );

          // 淺水與沼澤:波數增大(波長壓縮)、振幅增加(碎浪微紋理)
          float celWaveK = mix( ${(1 / WIND.SEA_DEPTH_LO).toFixed(3)}, 1.0, celDepF );
          float celAmpD = mix( ${WIND.SEA_DEPTH_AMP.toFixed(3)}, 1.0, celDepF );

          // ③ 障礙物近場衰減:深度場 0 的位置附近主波幅壓低 (留給同心切面波)
          float celObD = smoothstep( 0.0, 0.15, celRawD );

          // 一般水域底部起伏誤差 (低密度、平緩起伏，隨水深在淺水處稍強、深水處淡化)
          float celSeaBed = celSeaBedError( celSxz );
          float seaBedWarp = celSeaBed * 0.25;
          float celMsp = ( celSp + seaBedWarp ) * celWaveK + celPhJit;
          float celHSea = ( uSoftAmp * uWeatherWaveAmp ) * (
            celAmpD * celAmpMod * celObD * celGust( celSxz )
            * ( sin( uWindT * uSoftFreq + celMsp ) * 0.72
              + sin( uWindT * uSoftFreq * ${WIND.BEAT.toFixed(3)} + celMsp * 1.6 + 1.7 ) * 0.28 )
            + celSeaBed * 0.15 * mix( 0.85, 0.25, celDepF )
          );

          // 沼澤專屬公式 (黏滯微波 + 底部高密度強塊狀起伏誤差 + 多頻領域扭曲 + 碎浪微紋理)
          float celBedErr = celSwampBedError( celSxz );
          float celSwampWarp = sin( dot( celSxz, vec2( 0.35, 0.24 ) ) + uWindT * 0.55 ) * 1.2
                             + cos( dot( celSxz, vec2( -0.28, 0.36 ) ) + uWindT * 0.42 ) * 0.8
                             + vec2( cos( celBedErr * 3.14159 ), sin( celBedErr * 3.14159 ) ).x * 0.65;
          float celHSwamp = ( uSoftAmp * uWeatherWaveAmp ) * (
            sin( uWindT * 0.95 + dot( celSxz, vec2( 0.45, 0.32 ) ) + celSwampWarp + celBedErr * 1.15 ) * 0.45
            + cos( uWindT * 0.72 + dot( celSxz, vec2( -0.36, 0.48 ) ) + celSwampWarp * 0.4 ) * 0.30
            + sin( uWindT * 1.25 + dot( celSxz, vec2( 0.65, -0.55 ) ) ) * 0.15
            + celBedErr * 0.55
          );

          #ifdef CEL_SWAMP_RIPPLE
          // 沼澤水面網格：在水域交界處依水深平滑過渡至開闊水波，保證水面交界水波高度完全連續
          float celH = mix( celHSwamp, celHSea, celDepF * 0.65 );
          #else
          // 開闊水域在極淺水/沼澤邊界處依深度平滑過渡，確保水波高度嚴格連續無撕裂
          float celSwampBlend = 1.0 - celDepF; // 淺水邊界 [0, 1]
          float celH = mix( celHSea, celHSwamp, celSwampBlend * 0.65 );
          #endif

          // ④ 沼澤與淺水小水域：破碎化微波擾動 (碎浪微波)
          float celFragW = ( 1.0 - celDepF ) * 0.65;
          #ifdef CEL_SWAMP_RIPPLE
          celFragW = max( celFragW, 0.95 );
          #endif
          if ( celFragW > 0.01 ) {
            float celChop = sin( dot( celSxz, vec2( 0.95, 0.68 ) ) + uWindT * 1.5 + celSwampWarp * 0.6 )
                          * cos( dot( celSxz, vec2( -0.72, 0.85 ) ) + uWindT * 1.2 )
                          + sin( dot( celSxz, vec2( 1.45, -1.12 ) ) - uWindT * 1.8 ) * 0.4;
            celH += uSoftAmp * 0.45 * celFragW * celChop;
          }

          // ⑤ 遺跡/沉船/橋墩周邊：環繞物件切面的同心波前與干涉條紋 (水波範圍與波長放大 2 倍，重疊時計算干涉條紋)
          if ( celRawD > 0.001 && celRawD < 0.98 ) {
            // 物件位置決定水流向內(-1)或向外(+1)
            float celFlowSign = sign( sin( dot( floor( celSxz * 0.08 ), vec2( 12.9898, 78.233 ) ) * 43758.5453 ) );
            if ( celFlowSign == 0.0 ) celFlowSign = 1.0;

            // 判斷障礙物大小/類型: 大範圍遺跡/沉船 vs 橋墩 (水波範圍放大 2 倍)
            float isRelic = smoothstep( 0.04, 0.20, celRawD );
            float waveExtent = mix( ${FOAM.RANGE_M.toFixed(2)} * 2.3, ${FOAM.RANGE_M.toFixed(2)} * 4.6, isRelic );
            float relicDist = celRawD * waveExtent;

            // 波長放大 2 倍 (波數 k 由 3.8 減半為 1.9，波長倍增)
            float relicJit = sin( dot( celSxz, vec2( 0.12, -0.16 ) ) + celRawD * 7.0 ) * 0.55
                           + cos( dot( celSxz, vec2( -0.09, 0.18 ) ) + uWindT * 0.5 ) * 0.45;
            float relicPhase = relicDist * 1.9 - uWindT * 1.6 * celFlowSign + relicJit;

            // 越外圈自然消失 (衰減距離放大 2 倍: 0.95 -> 0.48)
            float relicFade = exp( -relicDist * 0.48 ) * ( 1.0 - smoothstep( 0.15, 0.95, celRawD ) );
            float relicWave = sin( relicPhase ) * relicFade * ( uSoftAmp * 1.25 );

            // ⑥ 水波重疊干涉條紋計算 (Interference Fringes: 相長/相消干涉)
            float seaPhase = celMsp + uWindT * uSoftFreq;
            float celInterference = cos( relicPhase - seaPhase )
                                  + cos( relicPhase * 1.25 + dot( celSxz, vec2( 0.18, -0.14 ) ) - uWindT * 1.1 ) * 0.5;
            float fringeWeight = relicFade * smoothstep( 0.04, 0.35, celRawD );
            float interferenceFringes = celInterference * fringeWeight * ( uSoftAmp * 0.75 );

            #ifdef CEL_SWAMP_RIPPLE
            // 沼澤/封閉水域：浪花變化改為正號到微小負號 (負號數值遠小於正號，負號時不顯示)
            float swampWavePulse = sin( uWindT * 1.4 + relicDist * 1.0 ) * 0.54 + 0.46; // [-0.08, +1.00]
            relicWave *= clamp( swampWavePulse, 0.0, 1.0 );
            interferenceFringes *= clamp( swampWavePulse, 0.0, 1.0 );
            #endif

            celH += relicWave + interferenceFringes;
          }

          #ifdef CEL_SWAMP_RIPPLE
          celH += celSwampRipple( celSxz );
          #endif
          return celH;
        }`;

/**
 * 推進風的時鐘(每幀一次;呼叫端 = `game.js` 的主迴圈)。
 * dt 夾在 [0, 0.25]:分頁切回來的那一幀 dt 可能是好幾秒,不夾的話整片林子會抽一下。
 */
export function stepCelWind(dt) {
  _windT.value += Math.min(0.25, Math.max(0, dt || 0));
}

/** 目前的風時鐘(秒);雲朵那半(environment.js)與植被同吃一個時鐘 */
export function celWindTime() { return _windT.value; }
/** 邊界風機的即時風量；轉速必須與這一格成正比。 */
export function celWindAmount() { return Math.max(0, _weatherWind.amp.value); }
/** 浮動設施的即時浪量；結冰時為 0，與海面著色器使用同一來源。 */
export function celWaveAmount() { return Math.max(0, _weatherWind.waveAmp.value); }
const _headingOut = [WIND_DIR[0], WIND_DIR[1]];
/** 邊界風機等設施的即時風向向量 [wx, wz]；唯一出口，與著色器同一來源。 */
export function celWindHeading() {
  _headingOut[0] = _windDir.value.x;
  _headingOut[1] = _windDir.value.y;
  return _headingOut;
}

/**
 * 餵入這一幀的擾動源(唯一寫入點;呼叫端 = `game.js` 主迴圈,MUST 排在 `_updateEnts` 之後)。
 * **沒填到的槽位由本函式顯式寫 `spd = 0`** —— 留上一幀的值的話,那台機體離開之後
 * 它腳邊的草就永遠倒著(呼叫端不必補,補了也是第二份規則)。
 * ⚠ MUST NOT 併進 `stepCelWind(dt)` 的簽章:`audit_soft_stroke` Ⅴ 釘死那一支的呼叫形狀。
 * @param list [{ x, y, z, spd }, …],長度 ≤ CHAR.N
 */
export function setCelChar(list) {
  const n = list ? list.length : 0;
  for (let i = 0; i < CHAR.N; i++) {
    const c = i < n ? list[i] : null;
    if (c) _charPos.value[i].set(c.x || 0, c.y || 0, c.z || 0);
    _charSpd.value[i] = c ? Math.max(0, c.spd || 0) : 0;
  }
}

// ---- 沼澤漣漪源(2026-08-26;§E)----
// 共享 uniform 物件(同 _windT / _charPos idiom):一份物件餵給所有沼澤材質。
// 初始 startTime = -999 ⇒ `uWindT - t0 < 0` ⇒ 著色器裡 continue 早退 ⇒ 零影響。
const _ripple = {
  value: Array.from({ length: WIND.SWAMP_RIPPLE_N },
    () => new THREE.Vector4(0, 0, -999, 0)),
};
let _rippleIdx = 0;          // 循環寫入的位置
let _rippleCD = 0;            // 到下一個漣漪的倒數(秒)

/**
 * 確定性雜湊:同 `aquatics.js aquaticSeed` idiom,零 `Math.random()` 消耗。
 * 輸入是**時鐘的量化值**(每 2~5 秒一次)⇒ 同一次生成跑兩遍拿到同一個結果。
 */
function rippleHash(a) {
  a = ((a >>> 0) ^ 0x5bd1e995) >>> 0;
  a = (Math.imul(a, 0x5bd1e995) ^ (a >>> 15)) >>> 0;
  return (a >>> 0) / 0x100000000;   // [0, 1)
}

/**
 * 推進沼澤漣漪(唯一呼叫端 = `game.js` 主迴圈,MUST 排在 `stepCelWind` 之後)。
 * 有沼澤水域才需要呼叫;無水 / 無沼澤 ⇒ game.js 那邊不呼叫。
 * @param swampCells [{ x, z }, …] 沼澤格點(biomes 建完後拿得到)
 */
export function stepSwampRipples(swampCells, dt) {
  if (!swampCells?.length) return;
  _rippleCD -= Math.min(0.25, Math.max(0, dt || 0));
  if (_rippleCD > 0) return;
  // 下一個漣漪的冷卻:2~5 秒(確定性,吃時鐘的量化值)
  const tSeed = Math.floor(_windT.value * 7.31) >>> 0;
  _rippleCD = 2 + rippleHash(tSeed ^ 0xA7C3) * 3;
  // 從沼澤格點裡挑一個位置(確定性選取)
  const ci = Math.floor(rippleHash(tSeed ^ 0x3E91) * swampCells.length);
  const cell = swampCells[ci % swampCells.length];
  // 格內隨機偏移(±5m)
  const ox = (rippleHash(tSeed ^ 0x17B5) - 0.5) * 10;
  const oz = (rippleHash(tSeed ^ 0x92D4) - 0.5) * 10;
  const slot = _ripple.value[_rippleIdx % WIND.SWAMP_RIPPLE_N];
  slot.set(cell.x + ox, cell.z + oz, _windT.value, WIND.SWAMP_RIPPLE_AMP);
  _rippleIdx++;
}

/**
 * 注入賽璐璐補丁:邊緣光(rim)+ 金屬硬邊高光帶(CEL_METAL 定義時)。
 * 沿用 MeshToonMaterial 既有光照結果,只疊加漫畫式高光。
 * BotW 環境擴充(doc/botw_plan.html;僅靜態環境物件開啟,機體/英雄不受影響):
 *   wash — 低頻世界空間水彩暈染,打破大面積單色的貼圖重複感(Task 2.1)
 *   moss — 世界 Y 軸朝上投影的手繪苔蘚(Task 2.2 / cliff-rocks 參考圖)
 *   cool — 陰影面偏冷藍 tint(Task 3.1;只偏色相、亮度≈0.93,不違反 #INC-106)
 * 機體塗裝(paint.js;英雄機體專用):
 *   paint — { tex, matrix, scale } 以「靜止姿勢的機體局部座標」三平面投影花紋。
 *           matrix = mesh 局部 → 機體根(建模當下固定,不隨動畫更新)⇒ 花紋鎖在裝甲板上。
 * 軟性物質(2026-08-04;見上方「軟性物質」段):
 *   soft  — { k, span, base?, sy? } k = SOFT_KINDS 的鍵;span = 整株/整面的尺寸(局部單位);
 *           base = 這個零件的原點在整株座標裡的位置(樹冠 = part.y、旗面 = 半寬);
 *           sy = 零件自身的縱向縮放(part.sy)。三者一起決定「這個頂點在整株上有多接近梢端」。
 * 地貌(2026-08-13;見檔頭「`.a` 是表面類別」段):
 *   land    — 這份材質屬於地貌(地形 / 地被拼圖 / 界線拼圖 / 特徵拼圖)⇒ 共用 surfaceId
 *             + 類別碼 LAND。**MUST NOT 掛在道路、建物、擺件上**(那些的邊界線是要的)。
 *   landNrm — 再加一條:gInfo 的法線改吃幾何的 `aLandN` 屬性(呼叫端餵真地形法線)。
 *             只給**貼地拼圖**(它自己的法線是 (0,1,0) 這個謊);地形自己與立體脊不傳。
 * 勾線資訊緩衝的擴充(2026-08-16;S2 —— 新參數 MUST 一律加在**尾端**):
 *   ink      — 表面類別 'hard'(預設)/ 'land' / 'group' / 'none'。`land: true` 會把預設的
 *              'hard' 升成 'land',而顯式的 `ink` 一律勝出。
 *   contrib  — `outlineContribution` ∈ [0,1](**MUST 由 `inkRepeat()` / `inkCtrM()` 推導**,
 *              唯一容許手寫的是 `INK_CONTRIB_NONE`)。1 = 舊制;0 = 這一款東西不出線。
 *              **是 uniform 不是 define** ⇒ MUST NOT 進 `customProgramCacheKey`(進去就是
 *              每一個貢獻值切一支新程式,而畫面上完全看不出來)。
 *   surf     — 顯式指定表面群組號(`surfGroup()` 給的);`land` 勝出。
 *   surfKey  — 穩定的材質語意鍵；省略時由環境/機體軌道與底色推導。
 *   surfAttr — 面號改吃逐實例屬性 `aSurfId`(同一株樹的幹 / 枝 / 冠共用一號)。
 *   treeO    — 逐株相位錨點改吃逐實例屬性 `aTreeO`(同一株樹的樹基世界 XZ)。
 *              同一株的幹 / 枝 / 冠實例原點各含自己的 px/pz 偏移(巨木達 ±10m),
 *              相位取實例原點 = 同一株各擺各的(冠與幹差 2rad 以上 = 風裡分解);
 *              取樹基 ⇒ 整株同相位,風仍以波的形式掃過林子(相鄰株的樹基差幾公尺)。
 *              只給多零件植被列(biomes.js);散草/旗面是單實例單株,沿用實例原點。
 *   card     — 葉片卡:四角在視域空間展開(屬性 `aCard`)。
 *   refl     — 水面倒影塊:朝向在頂點著色器算(屬性 `aReflO` + uniform `uWaterY`),類別恆 NONE。
 * 序 4 / 序 8 的擴充(2026-08-16;同樣 MUST 一律加在**尾端**):
 *   dissolve — 溶入(`discard` 抖動,不是 alpha 淡入):賽璐璐件用 alpha 淡入會失去自己的
 *              輪廓,而 `discard` 掉的片元連 gInfo 都不寫 ⇒ 洞邊由既有的兩支訊號自己出線。
 *              進度住 `mat.userData.celDisU`(**穩定的 uniform 物件**),唯一寫入點 =
 *              `setDissolve()`。1 = 完全實體(預設)⇒ 沒接驅動端的材質逐位元同舊制。
 *   landId   — 地貌分區子帶:`gInfo.b` 改吃逐頂點屬性 `aLandId`(值由 `landZoneId()` 給)。
 *              **由 `landInk` 拉桿閘住**(uniform,不是 define ⇒ 拉桿一動不必重建材質):
 *              拉桿 0 或屬性缺席 ⇒ 恆等於 `LAND_SURF_ID` = 逐位元同舊制。
 */
const INK_KIND = { none: 'NONE', land: 'LAND', hard: 'HARD', group: 'GROUP' };
function applyCelPatch(mat, { metal = false, rim = 0.22, wash = 0, moss = null, cool = 0, paint = null, tint = 'mech', preview = false, soft = null, bands = 3, land = false, landNrm = false, ink = 'hard', contrib = 1, surf = null, surfKey = null, surfAttr = false, card = false, refl = false, dissolve = false, landId = false, landField = false, treeO = false } = {}) {
  if (preview) ensurePreviewField();
  const sk = soft ? (SOFT_KINDS[soft.k] || SOFT_KINDS.leaf) : null;
  const defines = { ...(mat.defines || {}) };
  if (metal) defines.CEL_METAL = '';
  if (wash > 0) defines.CEL_WASH = '';
  if (moss) defines.CEL_MOSS = '';
  // **CEL_COOL 在 School B 下 MUST 關掉**:它是舊制那條「事後把 outgoingLight 往冷色拌一下」
  // 的終端(自己一條 `smoothstep(0.05, 0.45, dot(normal, uCelLightDir))`),與硬切並存的話
  // 同一顆物件上會有**兩條位置不同的明暗界**,而它讀起來就是「渲染壞了」。
  // 兩派 MUST NOT 混在同一顆物件上;暗側的顏色在 School B 由 `uCelRampTint` 一份給。
  // School A 下 `coolOn === (cool > 0)` ⇒ defines 與快取鍵**逐位元同舊制**。
  const coolOn = cool > 0 && _school !== 'b';
  if (coolOn) defines.CEL_COOL = '';
  if (paint) defines.CEL_PAINT = '';
  // 單一主徽(totem/tattoo/flag)只貼一面朝外的顯眼裝甲:用 rig 空間法線與指定朝向(paint.face,
  // 直立機甲取 +Z 胸甲、橫置飛行器取 +Y 頂面)的夾角把貼花閘在該半球,避免三平面投影
  // 在機體背面/底面鏡像出第二枚徽記(使用者要求「一個完整的」)。
  if (paint?.face) defines.CEL_PAINT_GATE = '';
  // 平面閘(hinomaru):只在與 paint.flat 軸「平行」的面(頂+底兩面,|N·軸| 大)顯現 →
  // 抑制三平面投影在薄件側緣(垂直面)的溢色。與 GATE(單一半球)互斥。
  if (paint?.flat) defines.CEL_PAINT_FLAT = '';
  // 需要世界座標 varying。海浪那一族**顯式**列進來:泡沫要世界 XZ,而水面現況剛好有
  // `wash: 0.5` —— 靠巧合成立的東西沒有斷言守得住。
  if (wash > 0 || moss || sk?.axis === 'w' || landField) defines.CEL_WP = '';
  // 細勾線與擺動**分兩個 define**:草坪要前者不要後者(它是鋪面,擺起來只會跟步道錯開)。
  // 細勾線那半**只給不透明件**:通道是「場景 RT 的 alpha」,而半透明件的 alpha 是**不透明度**
  // ——`gl_FragColor.a = uSoftInk` 寫下去就是把水面從 0.82 直接改成 0.30。檔頭那條契約本來就
  // 只對不透明件成立(「半透明件混合後 alpha 只會被推向 1 = 硬性 = 舊行為」),這裡把它寫成閘。
  const inkable = !!sk && !mat.transparent;
  if (inkable) defines.CEL_SOFT = '';
  // 墨線斷筆(序 4 ①-2)。閘與 `inkable` **同一條理由**(半透明件的 alpha 是不透明度,
  // 寫勾線倍率就是把水面從 0.82 改成 0.30)⇒ 兩者共用 `!mat.transparent` 這一句。
  // 差別只在少了 `!!sk`:斷筆對硬性件一樣要作用,而 `uSoftInk` 對它們恆 1 ⇒ 舊行為是新式的特例。
  // ⚠ 落地前逐一核對過呼叫端:`transparent:false` 但 `opacity < 1` 的 cel 材質**零命中**
  //   (四處 `opacity` 全帶 `transparent: true`),而 three 對 `!transparent && NormalBlending`
  //   一律定義 `OPAQUE` ⇒ `diffuseColor.a = 1.0` ⇒ 這裡寫 1.0 是 no-op。
  const inkAlpha = !mat.transparent;
  if (inkAlpha) { defines.CEL_INKA = ''; defines.CEL_INKB = ''; }
  if (sk && sk.amp > 0) {
    if (sk.axis === 'w') {
      defines.CEL_WAVE = '';   // 表面波(海浪):垂直位移 + 逐頂點相位
      if (sk.ripple) defines.CEL_SWAMP_RIPPLE = '';   // 沼澤漣漪:圓形衰減波疊加
    } else {
      defines.CEL_SWAY = '';
      if (sk.axis === 'x') defines.CEL_SWAY_H = '';
    }
  }
  // 地貌法線:只有它需要 define(共用 id 與類別碼都只是 uniform ⇒ 不必分程式)
  if (landNrm) defines.CEL_LAND_N = '';
  // S2 的四個新 define。**類別碼與貢獻刻意不在這裡** —— 它們是 uniform(見簽章註解)。
  if (surfAttr) defines.CEL_SURF_A = '';
  if (treeO) defines.CEL_TREEO = '';
  if (card) defines.CEL_LEAFCARD = '';
  if (refl) defines.CEL_REFL = '';
  if (dissolve) defines.CEL_DIS = '';
  if (landId) defines.CEL_LAND_ID = '';
  if (landField) defines.CEL_LAND_FIELD = '';
  mat.defines = defines;
  mat.userData.celOpts = { metal, rim, wash, moss, cool, paint, tint, preview, soft, bands, land, landNrm, ink, contrib, surf, surfKey, surfAttr, card, refl, dissolve, landId, landField, treeO };
  // 溶入進度是**穩定的 uniform 物件**(同 `_windT` / `_rampTint` 的做法):在 onBeforeCompile
  // 裡 `{ value: 1 }` 新建的話,材質一重編譯(改 defines / needsUpdate)就換一顆,而驅動端
  // 抓著的是舊的 ⇒ 症狀是「有時候不會溶入」。1 = 完全實體。
  if (dissolve && !mat.userData.celDisU) {
    mat.userData.celDisU = { value: 1 };
    mat.userData.celDisO = { value: new THREE.Vector3() };
  }
  // surfaceId 逐材質定案一次(MUST NOT 在 onBeforeCompile 裡抽 —— 那支會因為 defines 改變或
  // needsUpdate 重跑,同一塊裝甲會在重編譯之後換號,而畫面上只表現成「線閃了一下」)。
  // **逐材質不是逐頂點**:逐頂點 id 要動到每一支幾何產生器,而這裡九成的價值在法線那一項;
  // 逐材質 id 免費拿到「建物 vs 地面」「機體 vs 岩石」這一類分界。是刻意的降級,不是假裝有。
  // 地貌一律共用同一號(檔頭 ①):它是**類別**不是實例,MUST NOT 走 nextSurfId
  if (land) mat.userData.celSurfId = LAND_SURF_ID;
  else if (surf != null) mat.userData.celSurfId = surf;
  else if (mat.userData.celSurfId == null) {
    const colorKey = mat.color?.getHexString?.() || 'none';
    const key = surfKey == null ? `auto:${tint}:${metal ? 1 : 0}:${colorKey}` : `named:${surfKey}`;
    mat.userData.celSurfKey = key;
    mat.userData.celSurfId = nextSurfId(key);
  }
  // 類別碼:`land: true` 把預設的 'hard' 升成 'land',顯式的 `ink` 一律勝出;
  // 倒影塊恆 NONE(它是貼在水上的一片色塊,不該被畫輪廓)。
  const inkKey = refl ? 'none' : (land && ink === 'hard' ? 'land' : ink);
  const inkCls = INK_CLASS[INK_KIND[inkKey] || 'HARD'];
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uSurfId = { value: mat.userData.celSurfId };
    shader.uniforms.uInkClass = { value: inkCls };
    // **MUST 經 inkQuant 量化**:呼叫端傳 0.4 而緩衝裡是 0.4000 / 0.4667,稽核與定裝照
    // 量到的就是另一個數。MUST NOT 在 CPU 端先把 cls 與 ctr 併成一個數 —— 序 4(雜訊斷線)
    // 要逐 fragment 調變 ctr,併掉就沒有調變點了。
    shader.uniforms.uInkCtr = { value: inkQuant(contrib) };
    shader.uniforms.uCharPos = _charPos;
    shader.uniforms.uCharSpd = _charSpd;
    shader.uniforms.uSeaField = _seaField;
    shader.uniforms.uSeaRect = _seaRect;
    shader.uniforms.uFoamA = _foamA;
    shader.uniforms.uFoamC = _foamC;
    shader.uniforms.uRipple = _ripple;   // 沼澤漣漪源(CEL_SWAMP_RIPPLE;無沼澤 ⇒ 初始值全早退)
    shader.uniforms.uWaterY = { value: (refl && refl.y) || 0 };
    shader.uniforms.uCelLightDir = { value: _celLightDirView };
    // 地貌分區子帶的閘(序 4 ①-3):**共享 uniform** ⇒ 拉桿一動全場同一幀跟著換,
    // 而且不必為它多切一支程式(紀律③:改值 MUST NOT 重建材質)。
    shader.uniforms.uLandInk = _landInkA;
    shader.uniforms.uLandField = _landField;
    shader.uniforms.uLandRect = _landRect;
    // 溶入:進度 + 該單位的世界原點(錨在單位自己身上 —— 拿純世界座標的話機體會從一張
    // 固定的網格裡「游」過去,與 ①-2 的斷筆錨點是同一條理由)
    shader.uniforms.uDis = mat.userData.celDisU || { value: 1 };
    shader.uniforms.uDisO = mat.userData.celDisO || { value: new THREE.Vector3() };
    // 軟性:勾線門檻倍率(寫進場景 RT 的 alpha)+ 擺動的四個形狀參數
    // 斷筆的兩個 uniform 與它**寫在一起**:同一條通道的兩個因子(檔頭「軟性物質」段)。
    // 軌 = 既有的 `tint` 軸,MUST NOT 另建名冊。
    shader.uniforms.uInkBreakA = _inkBreakA;
    shader.uniforms.uInkBreakSpan = { value: tint === 'env' ? INK_BREAK.SPAN_ENV : INK_BREAK.SPAN_MECH };
    shader.uniforms.uSoftInk = { value: inkable ? INK_SOFT_A : 1 };
    shader.uniforms.uSoftSpan = { value: Math.max(1e-3, soft?.span ?? 1) };
    shader.uniforms.uSoftBase = { value: soft?.base ?? 0 };
    shader.uniforms.uSoftSy = { value: soft?.sy ?? 1 };
    shader.uniforms.uSoftAmp = { value: (sk?.amp ?? 0) * Math.max(1e-3, soft?.span ?? 1) };
    shader.uniforms.uSoftFreq = { value: sk?.freq ?? 0 };
    shader.uniforms.uWindT = _windT;
    shader.uniforms.uWindDir = _windDir;
    shader.uniforms.uWindK = _windK;
    shader.uniforms.uGustK = _gustK;
    shader.uniforms.uWeatherWindAmp = _weatherWind.amp;
    shader.uniforms.uWeatherWindFreq = _weatherWind.freq;
    shader.uniforms.uWeatherWaveAmp = _weatherWind.waveAmp;
    shader.uniforms.uWeatherWaveSpeed = _weatherWind.waveSpeed;
    // 陰影偏色(P1-B):共享 uniform 物件 ⇒ 拉桿一動,全場材質同一幀跟著換
    // **兩派共用同一份色相**(同一張 `SHADOW_HUE`、同一根拉桿、同一條 mech/env 兩軌),
    // MUST NOT 為 School B 另建第二份 —— 那就是「兩派的陰影是兩種顏色」。
    shader.uniforms.uCelRampTint = _rampTint[tint] || _rampTint.mech;
    // School B:硬度由**這份材質自己的 bands** 給(與 uCelRampLo 同一個道理)。
    // School A 下一格都不加 ⇒ uniform 集合逐位元同舊制。
    if (_school === 'b') celCutUniforms(shader, bands);
    // 場只換「哪一張 + 取樣框」兩個 uniform;取樣規則(celWeatherF)與強度仍是同一份
    shader.uniforms.uCelWField = preview ? _wFieldPrev : _wField;
    shader.uniforms.uCelWRect = preview ? _wRectPrev : _wRect;
    shader.uniforms.uCelWSpread = _wSpread;
    shader.uniforms.uCelRim = { value: rim };
    shader.uniforms.uCelWash = { value: wash };
    shader.uniforms.uCelCool = { value: cool };
    shader.uniforms.uCelMossC = { value: new THREE.Color(moss?.color ?? 0x6d8f4a) };
    shader.uniforms.uCelMossAmt = { value: moss?.amount ?? 0.85 };
    shader.uniforms.uPaintTex = { value: paint?.tex ?? null };
    shader.uniforms.uPaintM = { value: paint?.matrix ?? new THREE.Matrix4() };
    shader.uniforms.uPaintS = { value: paint?.scale ?? 1 };
    shader.uniforms.uPaintFace = { value: paint?.face ?? paint?.flat ?? new THREE.Vector3(0, 0, 1) };
    shader.vertexShader = shader.vertexShader
      .replace('void main() {', `
        #ifdef CEL_WP
        varying vec3 vCelWP;
        #endif
        #ifdef CEL_PAINT
        uniform mat4 uPaintM;
        uniform float uPaintS;
        varying vec3 vPaintP;
        varying vec3 vPaintN;
        #endif
        #ifdef CEL_LAND_N
        attribute vec3 aLandN;
        varying vec3 vLandN;
        #endif
        #ifdef CEL_SURF_A
        // 逐**實例**的面號(S3):同一株樹的幹 / 枝 / 冠共用一號 ⇒ 群組早退看得出「這是一棵樹」。
        // 缺席時 gInfo.b 仍走 uSurfId(逐材質),見片段端的 #ifdef。
        attribute float aSurfId;
        varying float vSurfId;
        #endif
        #ifdef CEL_LAND_ID
        // 逐**頂點**的地貌分區子帶(序 4 ①-3)。逐頂點而不是逐材質:底毯是逐 sub#variant
        // 分桶的獨立材質,把分區併進分桶鍵會讓 scree / steppe / concrete 這些跨分區的款分裂成
        // 多桶(= 多 draw call);逐頂點屬性**零額外 draw call**。缺席 ⇒ 0 ⇒ 恆等於 LAND_SURF_ID。
        attribute float aLandId;
        varying float vLandId;
        #endif
        #ifdef CEL_DIS
        // 溶入:錨在**單位自己的世界原點**上(uDisO)。抖動網格因此跟著機體走,
        // 而不是機體從一張固定的網格裡游過去。
        uniform vec3 uDisO;
        varying vec3 vDisP;
        #endif
        #ifdef CEL_INKB
        // 墨線斷筆的錨點(序 4 ①-2)。宣告在頂點端,值在 project_vertex 之後算。
        varying vec3 vCelInkP;
        #endif
        #ifdef CEL_LEAFCARD
        // 葉片卡:vec3( 角落 x, 角落 y, 旋轉 )。四個角在**視域空間**展開 ⇒ 中心點已經過了
        // project_vertex 的 worldCurve,MUST NOT 自己再彎一次(那會沉兩次)。
        attribute vec3 aCard;
        #endif
        #ifdef CEL_REFL
        // 倒影塊(S6):position.x = 橫向偏移(世界公尺)、position.y = 沿倒影方向的比例 [0,1]。
        attribute vec3 aReflO;   // ( 反射體世界 X, 反射體世界 Z, 反射體高 h )
        uniform float uWaterY;
        #endif
        #if defined( CEL_SWAY ) || defined( CEL_WAVE ) || defined( CEL_REFL )
${CEL_WIND_GLSL}
        #endif
        #if defined( CEL_WAVE ) || defined( CEL_REFL )
        // 逐頂點的淡出權重(1 = 滿幅、0 = 平的)。**由呼叫端烤在幾何上**,不是 uniform:
        // 水盤與緩衝空間外環水面共用同一份材質,而外環的網格粗到取樣不了波(邊長 53m >
        // 波長 64m 的 Nyquist)⇒ 讓它整片為 0,接縫兩側同為平面,沒有折痕也沒有遠處亂跳。
        attribute float seaFade;
        uniform sampler2D uSeaField;
        uniform vec4 uSeaRect;
${CEL_SWAMP_RIPPLE_GLSL}
${CEL_SEA_GLSL}
        #endif
        #ifdef CEL_WAVE
        varying float vSeaFade;   // 泡沫那一半在片段端吃它(53m 外環水面 MUST 無泡沫)
        #endif
        #ifdef CEL_SWAY
        // 玩家位移擾動(S5):機體走過去把腳邊的草撥開。全槽 spd = 0 ⇒ 位移項早退 ⇒ 逐位元同舊制。
        uniform vec3 uCharPos[ ${CHAR.N} ];
        uniform float uCharSpd[ ${CHAR.N} ];
        #endif
        #ifdef CEL_TREEO
        // 逐株相位錨點:同一株樹的樹基世界 XZ(幹/枝/冠共用 ⇒ 整株同相位;見 applyCelPatch 的 treeO)。
        attribute vec2 aTreeO;
        #endif
        void main() {`)
      // 法線 MUST 在 `beginnormal_vertex` 這一段改:three 的 normal_vertex(算 vNormal)排在
      // begin_vertex **之前**,等到 project_vertex 才動就來不及了 —— 頂點真的起伏了,而賽璐璐
      // 的階梯完全不知道,水面看起來仍是一整片死平的藍(只有邊緣剪影會動)。
      .replace('#include <beginnormal_vertex>', `
        #include <beginnormal_vertex>
        #ifdef CEL_WAVE
        {
          // 中央差分取斜率(解析微分要把兩個諧波各微一次 + 包絡的乘法律,寫兩份公式就是
          // 兩份會分家的實作;差分只吃 celSeaH 這一支,改波形不必回頭改法線)。
          vec2 seaN0 = ( modelMatrix * vec4( position, 1.0 ) ).xz;
          #ifdef CEL_SWAMP_RIPPLE
          float seaE = 0.50; // 沼澤破碎波紋細緻差分步長，捕捉碎波斜率以正確表現賽璐璐光影階梯
          #else
          float seaE = ${(WIND.SEA_M / 16).toFixed(3)};
          #endif
          vec3 seaNw = vec3(
            celSeaH( seaN0 - vec2( seaE, 0.0 ) ) - celSeaH( seaN0 + vec2( seaE, 0.0 ) ),
            2.0 * seaE,
            celSeaH( seaN0 - vec2( 0.0, seaE ) ) - celSeaH( seaN0 + vec2( 0.0, seaE ) ) );
          seaNw.xz *= seaFade;
          // 世界 → 零件局部(同 swD / seaUp 的轉置 idiom;水盤自己繞 X 轉了 −90°)
          objectNormal = normalize( normalize( seaNw ) * mat3( modelMatrix ) + vec3( 1e-6 ) );
        }
        #endif`)
      // 擺動 MUST 排在 project_vertex **之前**:那一段吃 transformed 算 mvPosition 與
      // gl_Position,擺完再算才會連 vViewPosition / 世界座標 varying 一起是同一個姿勢。
      .replace('#include <project_vertex>', `
        #ifdef CEL_REFL
        {
          // ---- 水面倒影塊(S6;⑤-3)----
          // 朝向在**頂點著色器**算 ⇒ 一份幾何、一個 draw call、零逐幀 CPU 更新。
          // 長度由鏡像幾何反解:眼高 e、反射體高 h、水平距 D ⇒ len = D·h/(e+h)(推導不手寫)。
          // ⚠ 契約:這份材質 MUST 掛在**世界原點**(identity modelMatrix)—— 下面直接把
          //   世界座標寫回 transformed,mesh 自己再帶一個位移就會整批偏掉。
          float rE = max( 0.1, cameraPosition.y - uWaterY );
          vec2 rD2 = cameraPosition.xz - aReflO.xy;
          float rD = length( rD2 );
          vec2 rDir = rD2 / max( rD, 1e-4 );
          float rLen = min( rD * aReflO.z / ( rE + aReflO.z ), ${REFL.MAX_LEN_M.toFixed(1)} );
          vec2 rNrm = vec2( -rDir.y, rDir.x );
          vec2 rP = aReflO.xy + rDir * ( rLen * transformed.y ) + rNrm * transformed.x;
          transformed = vec3( rP.x, uWaterY + celSeaH( rP ) * seaFade, rP.y );
        }
        #endif
        #ifdef CEL_SWAY
        {
          // ---- 擺動權重 sw:0 = 錨在根部 / 旗桿側(不動),1 = 梢端 ----
          // 單位是**整株局部座標**(uSoftBase = 這個零件的原點在整株上的位置、
          // uSoftSy = 零件自身的縱向縮放)⇒ 樹幹頂與樹冠底在同一個高度上拿到**同一個** sw,
          // 位移場是連續的 ⇒ 接合不會被風吹開(A26 / A27 的接合完成度與擺動無關)。
          // 逐零件各自從 0 起算的話,每一顆樹冠都會繞自己的中心剪切,疊接縫當場開開合合。
          // swH(這個頂點在整株座標上的位置)**恰一處**:玩家位移擾動那一段也要它,
          // 抄第二份的話 --break-anchor 只會咬到其中一份而反向驗證變成永遠綠(§5.4 ㋑)。
          #ifdef CEL_SWAY_H
            float swH = uSoftBase + transformed.x;
          #else
            float swH = uSoftBase + transformed.y * uSoftSy;
          #endif
          float sw = clamp( swH / uSoftSpan, 0.0, 1.0 );
          sw *= sw;   // 二次:根部更硬、梢端更軟(一次的話整株看起來像被平移)
          // ---- 相位:取**同一株的樹基**,不是逐頂點也不是逐零件原點 ----
          // 逐頂點取相位 = 同一片葉子的兩端各走各的 = 幾何被拉扯變形;取原點則整個零件同相,
          // 而相鄰植株的原點差幾公尺 ⇒ 風以波的形式掃過林子(uWindK 的波長 WIND.WAVE_M)。
          // 但各零件的實例原點含自己的 px/pz 偏移(巨木冠偏移達 ±10m = 相位差 2.5rad)⇒
          // 同一株的幹/枝/冠會各擺各的、接合處在風裡分解。故多零件植被列(CEL_TREEO)改吃
          // 逐實例屬性 aTreeO(樹基世界 XZ);單實例單株(散草/旗面)沿用實例原點。
          mat3 swM = mat3( modelMatrix );
          vec4 swO = vec4( 0.0, 0.0, 0.0, 1.0 );
          #ifdef USE_INSTANCING
            swM = swM * mat3( instanceMatrix );
            swO = instanceMatrix * swO;
          #endif
          swO = modelMatrix * swO;
          #ifdef CEL_TREEO
          vec2 swTXZ = aTreeO;
          #else
          vec2 swTXZ = swO.xz;
          #endif
          float swP = dot( swTXZ, uWindK );
          #ifdef CEL_SWAY_H
            // 旗面**沿自己**再推遲一段相位 ⇒ 波由旗桿往旗尾跑 = 飄揚。
            // 少了這一項,整面旗只是被同一個相位「剪」過去 —— 那是一塊被推歪的板子,
            // 不是布(旗桿側與旗尾同時到達最大位移,布不會這樣動)。
            // 值 = 沿旗面走過的波數 × 2π;取 0.8 個波:整數波會讓兩端同相 = 又變回剪切。
            swP -= sw * ${(0.8 * Math.PI * 2).toFixed(3)};
          #endif
          // 一個共用的雙頻波形；旗面另以實例原點雜湊取速率 / 相位，避免整圈旗陣像機械連桿。
          float swRate = uSoftFreq * uWeatherWindFreq;
          float swPhase = swP;
          float swBeat = ${WIND.BEAT.toFixed(3)};
          float swSlowW = 0.72;
          float swFastW = 0.28;
          float swFastPhase = swP * 1.6 + 1.7;
          #ifdef CEL_SWAY_H
            // 布料 = 慢抬起 + 3.3× 小幅快顫。雜湊只吃已定案的世界落點，零共享 rnd。
            float swPiece = fract( dot( swO.xyz, vec3( 0.1031, 0.11369, 0.13787 ) ) );
            swPiece = fract( ( swPiece + 0.33 ) * ( swPiece + 19.19 ) );
            swRate *= mix( 0.88, 1.12, swPiece );
            swPhase += swPiece * 6.2831853;
            swBeat = 3.3;
            swSlowW = 0.75;
            swFastW = 0.25;
            swFastPhase = swPhase;
          #endif
          // 兩個不可通約的正弦相加 = 週期性(使用者要的「重複性變化」)但看不出重複點。
          float swOsc = sin( uWindT * swRate + swPhase ) * swSlowW
                      + sin( uWindT * swRate * swBeat + swFastPhase ) * swFastW;
          // 世界風向 → 零件局部方向。**精確逆映射,不是轉置**:M = R·S 而轉置 = S·R^T,
          // 兩者差一個 S² —— 等比縮放下只是常數倍(正規化消掉),但冠盤 sy = 0.34 這種
          // 非等比縮放會把站姿微傾的污染放大:下沉能偏離世界垂直 30°,
          // 冠底與枝梢在強風下錯開 0.3m。R^T·v = S^-1·(v·M),而 Lx = |M·X| = s·jr、
          // Ly = |M·Y| = s·sy(旋轉保長度 ⇒ 與零件傾角無關)⇒ 逐分量除以 Lx²/Ly²
          // 正是 S^-2·(v·M) ∥ M^-1·v。MUST NOT 省掉這一步:實例的 ry 是亂數,
          // 直接拿世界向量當局部向量的話每一株會各吹各的方向,那就不是「風」了。
          float swLx = max( length( swM[ 0 ] ), 1e-4 );
          float swLy = max( length( swM[ 1 ] ), 1e-4 );
          vec3 swDrow = vec3( uWindDir.x, 0.0, uWindDir.y ) * swM;
          vec3 swD = normalize( vec3( swDrow.x / ( swLx * swLx ), swDrow.y / ( swLy * swLy ), swDrow.z / ( swLx * swLx ) ) + vec3( 1e-6 ) );
          // 陣風包絡吃**同一株的樹基**(與相位同一個點):逐頂點取的話同一株的根與梢
          // 會落在包絡的不同位置,強弱沿著株身變化 = 那株自己被拉長,不是被風吹。
          swOsc *= celGust( swTXZ );
          float swA = sw * ( uSoftAmp * uWeatherWindAmp ) * swOsc;
          transformed += swD * swA;
          // 擺出去時梢端略降(弧長守恆的一階近似)—— 少了這一項會看起來像整株在平移
          // 世界 +Y 走上面同一個精確逆映射(斜枝的局部 Y 是沿枝軸,直接寫 transformed.y
          // 會把下沉打到水平方向去),下沉量再除以 Ly(局部 Y 一單位的世界長):
          // 同一個 sw 壓扁冠拿到的世界下沉才會與幹一致,不除就只剩 1/3。
          vec3 swUrow = vec3( 0.0, 1.0, 0.0 ) * swM;
          vec3 swU = normalize( vec3( swUrow.x / ( swLx * swLx ), swUrow.y / ( swLy * swLy ), swUrow.z / ( swLx * swLx ) ) + vec3( 1e-6 ) );
          transformed -= swU * ( sw * ( uSoftAmp * uWeatherWindAmp ) * abs( swOsc ) * 0.3 / swLy );
          // ---- 玩家位移擾動(S5;⑤-1)----
          // 距離是 **2.5D**:水平取**同一株的樹基**(swTXZ,與擺動相位同一個點)、垂直取這個頂點
          // 自己的世界高度 ⇒ 同株的幹/枝/冠拿到同一份推重,接合處在機體經過時不錯開;
          // 地面走的機體構造上碰不到 6m 高的樹冠。逐零件原點水平差可達 ±10m(巨木冠偏移)、
          // 株上高度名義值又把零件基高重複計入 ⇒ 兩者都會讓同株各段各被推各的。
          // 單零件散草/旗面樹基恆等於實例原點 ⇒ 無感。
          // 半徑 **是速度的函式**(走路撥開、跑步甩開)—— 這一行就是這一項的本體。
          // ⚠ 兩條硬規則:①MUST NOT 引入第三個 sin(;②MUST NOT 對零向量 normalize() 之後
          //   乘 0(NaN × 0 仍是 NaN ⇒ 那批 InstancedMesh 整批消失而 console 一個字都沒有)
          //   —— 故一律 spd > 0 早退 + 除以 max(len, 1e-4)。
          float swWy = swO.y + ( swM * transformed ).y;
          for ( int ci = 0; ci < ${CHAR.N}; ci++ ) {
            float cSpd = uCharSpd[ ci ];
            if ( cSpd <= 0.0 ) continue;
            vec3 cRel = vec3( swTXZ.x, swWy, swTXZ.y ) - uCharPos[ ci ];
            float cR = ${CHAR.R0.toFixed(3)} + ${CHAR.R_PER_MPS.toFixed(3)} * cSpd;
            float cD = length( cRel );
            if ( cD >= cR ) continue;
            float cW = smoothstep( cR, 0.0, cD ) * min( 1.0, cSpd / ${CHAR.SPD_REF.toFixed(2)} );
            vec2 cOut = cRel.xz / max( length( cRel.xz ), 1e-4 );
            vec3 cDir = normalize( vec3( cOut.x, 0.0, cOut.y ) * swM + vec3( 1e-6 ) );
            transformed += cDir * ( cW * sw * uSoftAmp * ${CHAR.PUSH_F.toFixed(2)} );
          }
        }
        #endif
        #ifdef CEL_WAVE
        {
          // ---- 表面波(海浪)----
          // 相位**逐頂點**取世界 XZ(與植被擺動刻意相反,見 SOFT_KINDS.sea 的註解)。
          vec2 seaXZ = ( modelMatrix * vec4( transformed, 1.0 ) ).xz;
          // 位移方向 = 世界的 +Y 轉進零件局部座標(水盤自己繞 X 轉了 −90°,直接加在
          // transformed.y 上會把浪打到水平方向去)。與 swD 同一個轉置 idiom。
          vec3 seaUp = normalize( vec3( 0.0, 1.0, 0.0 ) * mat3( modelMatrix ) + vec3( 1e-6 ) );
          transformed += seaUp * ( celSeaH( seaXZ ) * seaFade );
          vSeaFade = seaFade;
        }
        #endif
        #include <project_vertex>
        #ifdef CEL_LEAFCARD
        {
          // 葉片卡的四角在**視域空間**展開。三條理由缺一不可:
          //   ①\`mvPosition\` 在 r160 的 project_vertex 展開後仍在 scope 內,而 vViewPosition
          //     與 vFogDepth 排在它之後 ⇒ 邊緣光 / 霧跟著走;
          //   ②中心點已經過了 worldCurve ⇒ 卡片自動吃到世界曲面,MUST NOT 自己再彎一次;
          //   ③擺動(CEL_SWAY)作用在中心點上 ⇒ 一張卡整片同相位移,不會被剪成菱形。
          // 尺寸乘水平世界縮放而**不吃 sy** ⇒ 壓扁的冠上面的卡片仍是方的。
          mat3 cdM = mat3( modelMatrix );
          #ifdef USE_INSTANCING
            cdM = cdM * mat3( instanceMatrix );
          #endif
          float cdS = length( cdM[ 0 ] );
          float cdC = cos( aCard.z ), cdSn = sin( aCard.z );
          mvPosition.xy += vec2( aCard.x * cdC - aCard.y * cdSn,
                                 aCard.x * cdSn + aCard.y * cdC ) * cdS;
          gl_Position = projectionMatrix * mvPosition;
        }
        #endif
        #ifdef CEL_SURF_A
        vSurfId = aSurfId;
        #endif
        #ifdef CEL_LAND_ID
        vLandId = aLandId;
        #endif
        #ifdef CEL_INKB
        {
          // ---- 墨線斷筆的錨點(序 4 ①-2)----
          // **MUST 是 mat3( modelMatrix ) 不是 modelMatrix** —— 丟掉平移那一欄就是
          // 「走一步缺口不在身上游動」的全部理由(等價於 CEL_PAINT 那句 never makes the
          // pattern swim across the body);轉動仍跟著跑 ⇒ 缺口黏在裝甲板上。
          // instanceMatrix 收進來 ⇒ 同款植被逐株不同花紋,而對靜態實例它退化成世界座標。
          // 地形的 modelMatrix ≈ 單位陣、position 就是世界 XZ ⇒ 同一條式子對地形自動是
          // 世界空間,**不需要第二份**(兩份雜訊 = 地形的斷點與機體的斷點是兩種花紋)。
          vec4 ibP = vec4( transformed, 1.0 );
          #ifdef USE_INSTANCING
            ibP = instanceMatrix * ibP;
          #endif
          vCelInkP = mat3( modelMatrix ) * ibP.xyz;
        }
        #endif
        #ifdef CEL_DIS
        {
          vec4 dsP = vec4( transformed, 1.0 );
          #ifdef USE_INSTANCING
            dsP = instanceMatrix * dsP;
          #endif
          vDisP = ( modelMatrix * dsP ).xyz - uDisO;
        }
        #endif
        #ifdef CEL_WP
        {
          // World-space position varying (instancing-aware) for wash / moss projection.
          vec4 celWP = vec4( transformed, 1.0 );
          #ifdef USE_INSTANCING
            celWP = instanceMatrix * celWP;
          #endif
          vCelWP = ( modelMatrix * celWP ).xyz;
        }
        #endif
        #ifdef CEL_PAINT
        {
          // Rest-pose rig-space position/normal: paint sticks to the armor plate,
          // so joint rotation never makes the pattern swim across the body.
          vPaintP = ( uPaintM * vec4( transformed, 1.0 ) ).xyz * uPaintS;
          vPaintN = mat3( uPaintM ) * objectNormal;
        }
        #endif
        #ifdef CEL_LAND_N
        // 地貌法線 → **視空間**(與 normal 同一個框;勾線是螢幕空間的,見片段那一段)。
        // 這條只餵勾線資訊緩衝,一行都不碰 normal ⇒ 地被的受光逐位元同舊制。
        vLandN = normalMatrix * aLandN;
        #endif`);
    shader.fragmentShader = shader.fragmentShader
      // 溶入的 discard MUST 排在 `#include <opaque_fragment>` **之前**(那一段才寫顏色與
      // gInfo);排在它之後就是「顏色與 gInfo 都寫完了才 discard」= 洞邊的資訊仍然是機體的,
      // 而那正是這一項要拿掉的東西。`clipping_planes_fragment` 是 three 給的第一個錨點,
      // 緊接在 `void main() {` 之後 ⇒ 連被裁掉的片元都不必算光照。
      .replace('#include <clipping_planes_fragment>', `
        #include <clipping_planes_fragment>
        #ifdef CEL_DIS
        if ( celDissolve( vDisP ) ) discard;
        #endif`)
      .replace('#include <normal_fragment_begin>', `
        #include <normal_fragment_begin>
        #ifdef CEL_LAND_FIELD
        {
          vec2 lfUv = clamp( ( vCelWP.xz - uLandRect.xy ) * uLandRect.zw, 0.0, 1.0 );
          vec4 lf = texture2D( uLandField, lfUv );
          float z = floor( lf.r * 255.0 + 0.5 );
          float v = floor( lf.g * 255.0 + 0.5 );
          vec3 c = vec3( 0.44, 0.52, 0.36 );
          if ( z < 0.5 ) c = v > 0.5 ? vec3( 0.16, 0.30, 0.39 ) : vec3( 0.25, 0.43, 0.48 );
          else if ( z < 1.5 ) c = v > 0.5 ? vec3( 0.30, 0.43, 0.34 ) : vec3( 0.36, 0.46, 0.35 );
          else if ( z < 2.5 ) {
            c = v < 0.5 ? vec3( 0.42, 0.54, 0.31 ) : v < 1.5 ? vec3( 0.50, 0.59, 0.36 )
              : v < 2.5 ? vec3( 0.35, 0.47, 0.28 ) : vec3( 0.53, 0.58, 0.29 );
          } else if ( z < 3.5 ) {
            c = v < 0.5 ? vec3( 0.48, 0.39, 0.29 ) : v < 1.5 ? vec3( 0.47, 0.45, 0.40 )
              : v < 2.5 ? vec3( 0.64, 0.52, 0.34 ) : vec3( 0.45, 0.29, 0.20 );
          } else if ( z < 4.5 ) {
            c = v < 0.5 ? vec3( 0.42, 0.43, 0.42 ) : v < 1.5 ? vec3( 0.37, 0.49, 0.34 )
              : v < 2.5 ? vec3( 0.34, 0.45, 0.31 ) : vec3( 0.55, 0.55, 0.52 );
          } else if ( z < 5.5 ) c = v < 0.5 ? vec3( 0.47, 0.49, 0.48 ) : v < 1.5 ? vec3( 0.42, 0.43, 0.42 ) : vec3( 0.74, 0.78, 0.81 );
          else c = v > 0.5 ? vec3( 0.29, 0.27, 0.26 ) : vec3( 0.39, 0.36, 0.34 );
          float grain = ( lf.b - 0.5 ) * 0.10;
          diffuseColor.rgb = c * ( 1.0 + grain );

          // 苔草 / 濕痕(計畫 ②-2):低頻分區回答「這裡是什麼」，三平面噪聲只負責
          // 分區內的碎邊。兩種遮罩都同時吃語意、法線與兩個尺度的噪聲，且用硬 step；
          // lf.a 是道路 / 建成遮罩，避免把苔草重新畫回正式道路與建成足跡。
          vec3 lmN = normalize( inverseTransformDirection( normal, viewMatrix ) );
          float lmA = celTriNoise( vCelWP * 0.24, lmN );
          float lmB = celTriNoise( vCelWP * 0.075 + vec3( 7.1, 3.7, 11.9 ), lmN );
          float lmOpen = 1.0 - step( 0.5, lf.a );
          float lmGrassZone = step( 1.5, z ) * ( 1.0 - step( 3.5, z ) ) + step( 4.5, z );
          float lmGrass = lmOpen * lmGrassZone
            * step( 0.64, max( 0.0, lmN.y ) * 0.62 + lmA * 0.48 - lmB * 0.16 );
          float lmWetZone = 1.0 - step( 0.5, abs( z - 1.0 ) );
          float lmWet = lmOpen * lmWetZone
            * step( 0.66, ( 1.0 - max( 0.0, lmN.y ) ) * 0.22 + lmA * 0.46 + lmB * 0.34 );
          celLandMask = max( lmGrass, lmWet * 2.0 );
          diffuseColor.rgb = mix( diffuseColor.rgb, vec3( 0.30, 0.43, 0.22 ), lmGrass * 0.62 );
          diffuseColor.rgb = mix( diffuseColor.rgb, diffuseColor.rgb * vec3( 0.68, 0.74, 0.78 ), lmWet );
        }
        #endif
        #if defined( CEL_WASH ) || defined( CEL_MOSS )
        {
          #ifdef CEL_WASH
          {
            // Low-frequency watercolor wash: shift tint across world XZ to break
            // up flat color blocks / tiling (painterly, no photoreal noise).
            float celN = celNoise( vCelWP.xz * 0.011 );
            vec3 celTint = mix( vec3( 0.93, 0.965, 1.06 ), vec3( 1.07, 1.025, 0.94 ), celN );
            diffuseColor.rgb *= mix( vec3( 1.0 ), celTint, uCelWash * celWeatherF() );
          }
          #endif
          #ifdef CEL_MOSS
          {
            // Top-down world-Y moss projection: upward-facing surfaces receive a
            // painterly moss coat; a second noise breaks the edge into patches.
            // celWeatherF(): 「這一區有多老」——場高的地方苔長得厚,場低的地方幾乎沒有。
            vec3 celWN = inverseTransformDirection( normal, viewMatrix );
            float mossW = smoothstep( 0.45, 0.8, celWN.y ) * uCelMossAmt * celWeatherF();
            mossW *= smoothstep( 0.28, 0.72, celNoise( vCelWP.xz * 0.3 + vCelWP.yy * 0.17 ) );
            // saturate MUST 留著:celWeatherF() 最高到 1 + WEATHER_SPREAD × 拉桿上限 = 2.2 ⇒
            // mossW 會衝過 1,而 mix 在 t > 1 是**外插**(往苔色的反方向再推出去)——
            // 場最高的那幾塊會過飽和,而拉桿再往上拉也只是外插得更遠 = 上半段看不出差異。
            diffuseColor.rgb = mix( diffuseColor.rgb, uCelMossC, saturate( mossW ) );
          }
          #endif
        }
        #endif
        #ifdef CEL_PAINT
        {
          // Triplanar decal in rig-rest space; hard alpha cut keeps the cel look.
          // Canvas textures are premultiplied, so un-premultiply after the blend.
          vec3 pw = abs( normalize( vPaintN ) );
          pw = pow( pw, vec3( 4.0 ) );
          pw /= ( pw.x + pw.y + pw.z );
          vec4 pc = texture2D( uPaintTex, vPaintP.zy ) * pw.x
                  + texture2D( uPaintTex, vPaintP.xz ) * pw.y
                  + texture2D( uPaintTex, vPaintP.xy ) * pw.z;
          float pa = smoothstep( 0.4, 0.62, pc.a );
          #ifdef CEL_PAINT_GATE
          // 只在朝 uPaintFace 的半球顯現;背面/底面淡出 → 全機唯一一枚徽記。
          pa *= smoothstep( 0.02, 0.4, dot( normalize( vPaintN ), uPaintFace ) );
          #endif
          #ifdef CEL_PAINT_FLAT
          // 只在與 uPaintFace 軸平行的面(頂+底,|N·軸| 大)顯現 → 薄件側緣不溢色。
          pa *= smoothstep( 0.5, 0.82, abs( dot( normalize( vPaintN ), uPaintFace ) ) );
          #endif
          diffuseColor.rgb = mix( diffuseColor.rgb, pc.rgb / max( pc.a, 0.001 ), pa );
        }
        #endif`)
      .replace('#include <opaque_fragment>', `
        {${_school === 'b' ? CEL_CUT_MIX_GLSL : ''}
          vec3 celV = normalize( vViewPosition );
          // 邊緣光:背光輪廓亮一圈(硬邊 smoothstep,不是柔霧)
          float celRim = 1.0 - saturate( dot( normal, celV ) );
          outgoingLight += diffuse.rgb * uCelRim * smoothstep( 0.62, 0.78, celRim );
          #ifdef CEL_METAL
            // 漫畫金屬:非模糊白色反光帶(step 硬切,Gundam / Borderlands 手感)
            vec3 celH = normalize( uCelLightDir + celV );
            float celS = pow( saturate( dot( normal, celH ) ), 42.0 );
            outgoingLight += vec3( 0.9 ) * step( 0.5, celS );
          #endif
          #ifdef CEL_COOL
            // Cool-tinted shadow side: hue shift toward blue-teal, near-constant
            // luminance, so shaded regions read as bounced sky light, not grey.
            float celShade = smoothstep( 0.05, 0.45, dot( normal, uCelLightDir ) );
            outgoingLight = mix( outgoingLight * mix( vec3( 1.0 ), vec3( 0.86, 0.93, 1.1 ), uCelCool ), outgoingLight, celShade );
          #endif
          // 落地保險(原則 6):three 若改寫那個 chunk,上面那道 ramp 替換會**靜默**失效 ——
          // 畫面只表現成「拉桿拉了沒反應」,不會有任何錯誤。uCelRampFb 在 onBeforeCompile
          // 當下就知道替換成不成功:成功恆 0(以下完全不執行),失敗才走這條路徑。
          // **權重 MUST 取同一張 ramp 的階值**,MUST NOT 退回手寫的 dot·0.5+0.5 線性斜坡:
          // 線性斜坡把偏色攤平在整顆球上 ⇒ 最暗的地方只吃到一部分,實測整體差異掉到
          // 補丁版的一個零頭(2026-08-03 逐像素量測:最大差 11/765,肉眼等同沒有)。
          // 保險的意義是「壞掉時看得出來還在動」,而不是「壞掉時剛好也看不出來」——
          // 兩者一樣不會報錯,差別只在使用者會不會回報。
          if ( uCelRampFb > 0.5 ) {
            #ifdef USE_GRADIENTMAP
              float celFbG = texture2D( gradientMap, vec2( dot( normal, uCelLightDir ) * 0.5 + 0.5, 0.0 ) ).r;
              float celFbW = celRampDepth( celFbG );
            #else
              float celFbG = saturate( dot( normal, uCelLightDir ) * 0.5 + 0.5 );
              float celFbW = celFbG;   // 沒有 ramp 可正規化(退化到底的那一層)
            #endif
            outgoingLight *= mix( uCelRampTint, vec3( 1.0 ), celFbW );
          }
        }
        #include <opaque_fragment>
        #ifdef CEL_INKA
        // 場景 RT 的 alpha ≡ 這一格的**勾線門檻倍率**(見檔頭「軟性物質」段的契約)。
        // 自 2026-08-16 起帶**兩個因子**:軟性(逐材質常數)× 斷筆(逐 fragment)。
        // **寫入仍然恰一處** —— 兩個因子分兩處寫就是兩份契約。
        // MUST 排在 opaque_fragment **之後**:那一段的 \`#ifdef OPAQUE diffuseColor.a = 1.0\`
        // 會把先寫的值蓋掉。之後的 colorspace / fog / dithering 都只動 rgb,寫在這裡最穩。
        // 閘由 CEL_SOFT 放寬成 CEL_INKA(= 不透明的 cel 材質,CEL_SOFT 的超集):
        // 硬性件的 uSoftInk 恆 1、拉桿 0 時 celInkBreak() 恆回字面 1.0 ⇒ 寫下去的是 1.0,
        // 而 OPAQUE 本來就已經讓那些像素的 alpha 是 1.0 ⇒ **新寫入是 no-op**。
        gl_FragColor.a = uSoftInk * celInkBreak();
        #endif
        #ifdef CEL_WAVE
        {
          // ---- 岸邊泡沫(S6;⑤-2)----
          // **MUST 排在 opaque_fragment 之後**:寫進 diffuseColor 會讓泡沫再過一次 toon ramp
          // (硬邊被階梯切成兩段、陰影裡的泡沫變灰),而使用者要的是白色硬邊。
          // alpha 推向 1 也正是「泡沫是不透明的、蓋住水底」。
          // 中性深度場(1×1 = 很深)⇒ celFoam 恆 0 ⇒ 這一段早退 ⇒ **逐位元同舊制**。
          float celF = celFoam( vCelWP.xz ) * vSeaFade * uFoamA;
          if ( celF > 0.0 ) {
            gl_FragColor.rgb = mix( gl_FragColor.rgb, uFoamC, celF );
            gl_FragColor.a = mix( gl_FragColor.a, 1.0, celF );
          }

          // ---- 沼澤與一般水域水波破碎波紋與水底起伏 (Cel Broken Wave Ripples & Bed Undulation) ----
          #ifdef CEL_SWAMP_RIPPLE
          // 沼澤專屬破碎波紋光帶 (細緻破碎化賽璐璐水波紋，有機領域扭曲 + 底部密集塊狀起伏誤差撕裂)
          float celFragBedErr = celSwampBedError( vCelWP.xz );
          vec2 celWarpUV = vCelWP.xz + vec2(
            sin( vCelWP.z * 0.28 + uWindT * 0.42 ) * 1.8 + cos( vCelWP.x * 0.45 + 1.7 ) * 1.0 + celFragBedErr * 0.45,
            cos( vCelWP.x * 0.24 - uWindT * 0.38 ) * 1.8 + sin( vCelWP.z * 0.41 + 2.3 ) * 1.0 - celFragBedErr * 0.45
          );
          vec2 celSwRipUV = celWarpUV * 0.65;
          float celRipN1 = celNoise( celSwRipUV * 2.0 + vec2( uWindT * 0.22, -uWindT * 0.18 ) );
          float celRipN2 = celNoise( celSwRipUV * 3.8 - vec2( uWindT * 0.28, uWindT * 0.22 ) + 5.17 );
          float celRipN3 = celNoise( celSwRipUV * 7.2 + vec2( -uWindT * 0.35, uWindT * 0.30 ) + 3.41 );
          
          // 破碎化多向波紋 (非線性彎曲、多向干涉、底部塊狀起伏造成波痕折射撕裂)
          float celWave1 = sin( dot( celWarpUV, vec2( 0.52, 0.36 ) ) * 2.2 + uWindT * 1.15 + celRipN1 * 3.6 + celFragBedErr * 0.95 ) * 0.5 + 0.5;
          float celWave2 = cos( dot( celWarpUV, vec2( -0.42, 0.62 ) ) * 2.5 - uWindT * 0.95 + celRipN2 * 3.2 - celFragBedErr * 0.85 ) * 0.5 + 0.5;
          float celWave3 = sin( dot( celWarpUV, vec2( 0.78, -0.65 ) ) * 3.1 + uWindT * 1.35 + celRipN3 * 2.4 ) * 0.5 + 0.5;
          
          // 破碎條紋：高階干涉 + 碎裂斷筆遮罩 (使波痕呈現自然破碎散佈的弧光)
          float celBrokenBand = pow( celWave1 * celWave2 * 1.35, 2.4 ) + pow( celWave2 * celWave3 * 1.35, 2.6 ) * 0.8;
          float celBreakMask = smoothstep( 0.25, 0.65, celRipN2 * 0.55 + celRipN3 * 0.45 );
          float celSwampRippleLine = step( 0.60, celBrokenBand * celBreakMask ) * vSeaFade * min( 1.0, uWeatherWaveAmp * 2.0 );
          
          if ( celSwampRippleLine > 0.0 ) {
            vec3 swampRippleColor = vec3( 0.72, 0.86, 0.62 ); // 沼澤青翠碎波紋色相
            gl_FragColor.rgb = mix( gl_FragColor.rgb, swampRippleColor, celSwampRippleLine * 0.45 );
          }

          // 底部密集塊狀起伏的透光陰影/淺灘微調 (泥塊凸起微亮/凹陷深沉)
          vec3 bedShading = vec3( 0.04, 0.06, 0.03 ) * celFragBedErr * 0.45 * vSeaFade;
          gl_FragColor.rgb = clamp( gl_FragColor.rgb + bedShading, 0.0, 1.0 );
          #else
          // 一般水域水底平緩塊狀起伏的透光微調 (低密度寬塊起伏，淺水處稍顯、深水處淡化)
          float celFragSeaBed = celSeaBedError( vCelWP.xz );
          vec2 celDuvPre = clamp( ( vCelWP.xz - uSeaRect.xy ) * uSeaRect.zw, vec2( 0.0 ), vec2( 1.0 ) );
          float celRawDPre = texture2D( uSeaField, celDuvPre ).r;
          vec3 seaBedShading = vec3( 0.02, 0.035, 0.04 ) * celFragSeaBed * 0.18 * ( 1.0 - celRawDPre * 0.75 ) * vSeaFade;
          gl_FragColor.rgb = clamp( gl_FragColor.rgb + seaBedShading, 0.0, 1.0 );
          #endif

          // 碎波光與波光粼粼取樣 (所有水域均受水底起伏微擾動)
          #ifdef CEL_SWAMP_RIPPLE
          vec2 celBedShimmerOffset = vec2( celFragBedErr * 0.35, -celFragBedErr * 0.35 );
          #else
          vec2 celBedShimmerOffset = vec2( celFragSeaBed * 0.15, -celFragSeaBed * 0.15 );
          #endif
          vec2 celShimmerUV = vCelWP.xz * 2.4 + vec2( sin( uWindT * 1.8 + vCelWP.z * 0.4 ), cos( uWindT * 1.5 + vCelWP.x * 0.4 ) ) * 0.35 + celBedShimmerOffset;
          float celShN1 = celNoise( celShimmerUV );
          float celShN2 = celNoise( celShimmerUV * 2.5 + vec2( 5.31, 11.17 ) + uWindT * 0.9 );
          float celSparkle = pow( celShN1 * celShN2, 3.2 );
          vec3 celWaterV = normalize( vViewPosition );
          vec3 celWaterH = normalize( uCelLightDir + celWaterV );
          float celWaterSpec = pow( max( 0.0, dot( normal, celWaterH ) ), 32.0 );

          // 判斷深度(淺水/沼澤更強烈破碎波光)
          vec2 celDuvFrag = clamp( ( vCelWP.xz - uSeaRect.xy ) * uSeaRect.zw, vec2( 0.0 ), vec2( 1.0 ) );
          float celRawDFrag = texture2D( uSeaField, celDuvFrag ).r;
          float celShallowF = smoothstep( 0.65, 0.05, celRawDFrag );
          #ifdef CEL_SWAMP_RIPPLE
          celShallowF = max( celShallowF, 0.85 );
          #endif

          if ( celShallowF > 0.05 ) {
            float celGlint = step( 0.68, ( celWaterSpec * 0.65 + 0.35 ) * celSparkle * 4.5 ) * celShallowF * vSeaFade * min( 1.0, uWeatherWaveAmp * 2.0 );
            if ( celGlint > 0.0 ) {
              #ifdef CEL_SWAMP_RIPPLE
              vec3 glintColor = mix( vec3( 0.82, 0.94, 0.72 ), vec3( 0.94, 0.98, 1.0 ), celRawDFrag ); // 沼澤青金碎波光向水域晶亮波光平滑過渡
              #else
              vec3 glintColor = mix( vec3( 0.94, 0.98, 1.0 ), vec3( 0.82, 0.94, 0.72 ), celShallowF * 0.5 );  // 清澈水域銀白晶亮波光向沼澤波光平滑過渡
              #endif
              gl_FragColor.rgb = mix( gl_FragColor.rgb, glintColor, celGlint * 0.75 );
            }
          }
        }
        #endif
        // 勾線資訊緩衝(檔頭那一段):覆寫 opaque_fragment 寫下的「沒有資訊」。
        // **MUST 是視空間法線** —— 勾線是螢幕空間的,世界法線在鏡頭轉動時不會變而畫面上的
        // 折邊會,兩者在轉身時會整批對不上。\`normal\` 是 three 在 normal_fragment_begin
        // 之後留在 scope 裡的視空間法線。
        {
          vec3 gN = normalize( normal );
          #ifdef CEL_LAND_N
          // 貼地拼圖:自己的法線恆 (0,1,0)(它只是一張皮)⇒ 換成呼叫端餵的真地形法線。
          // 屬性缺席時 \`vLandN\` 是 (0,0,0) ⇒ **退回自己的法線**(原則 6:降級不例外;
          // normalize(0) 是 NaN,那會沿著整片地面畫出隨機黑點)。
          if ( dot( vLandN, vLandN ) > 1e-8 ) gN = normalize( vLandN );
          #endif
          // .b = 面號:預設**逐材質**;帶 CEL_SURF_A 時改吃**逐實例**屬性(同一株樹的
          // 幹 / 枝 / 冠共用一號 ⇒ 群組早退看得出「這是一棵樹」)。
          #ifdef CEL_SURF_A
            float gSurf = vSurfId;
          #else
            float gSurf = uSurfId;
          #endif
          #ifdef CEL_LAND_ID
          // 地貌分區子帶(序 4 ①-3):**兩道閘都要成立**才換號 ——
          //   ・拉桿 0 ⇒ 恆等於 LAND_SURF_ID(逐位元同舊制,而且是 uniform 分支不必重建材質);
          //   ・屬性缺席 ⇒ vLandId 是 0 ⇒ 同樣恆等(原則 6:呼叫端還沒接上就當作沒有這回事)。
          if ( uLandInk > 0.0 && vLandId > 0.0 ) gSurf = vLandId;
          #endif
          #ifdef CEL_LAND_FIELD
          if ( uLandInk > 0.0 ) {
            vec2 lfUv = clamp( ( vCelWP.xz - uLandRect.xy ) * uLandRect.zw, 0.0, 1.0 );
            float lfZone = floor( texture2D( uLandField, lfUv ).r * 255.0 + 0.5 );
            lfZone = clamp( lfZone, 0.0, ${LAND_ZONE_N - 1}.0 );
            gSurf = ( ${64 - LAND_ZONE_N}.0 + lfZone ) / 64.0;
            if ( celLandMask > 0.5 ) {
              gSurf = ( ${64 - LAND_ZONE_N * LAND_MASK_N}.0
                + lfZone * ${LAND_MASK_N - 1}.0 + celLandMask - 1.0 ) / 64.0;
            }
          }
          #endif
          // .a = 打包(高半位元組 = 類別索引、低半位元組 = 貢獻 16 階)。
          // inkC 是**序 4(雜訊斷線)的調變點** —— 本輪就是這一行原樣。
          float inkC = uInkCtr;
          gInfo = vec4( gN.xy * 0.5 + 0.5, gSurf, inkPack( uInkClass, inkC ) );
        }`)
      .replace('void main() {', `
        uniform vec3 uCelLightDir;
        uniform float uCelRim;
        uniform float uSurfId;
        uniform float uInkClass;
        uniform float uInkCtr;${_school === 'b' ? CEL_CUT_DECL_GLSL : ''}
${INK_PACK_GLSL}
        #ifdef CEL_SURF_A
        varying float vSurfId;
        #endif
        #ifdef CEL_LAND_N
        varying vec3 vLandN;
        #endif
        uniform float uCelWash;
        uniform float uCelCool;
        uniform vec3 uCelMossC;
        uniform float uCelMossAmt;
        uniform sampler2D uCelWField;
        uniform vec4 uCelWRect;
        uniform float uCelWSpread;
        #ifdef CEL_PAINT
        uniform sampler2D uPaintTex;
        uniform vec3 uPaintFace;
        varying vec3 vPaintP;
        varying vec3 vPaintN;
        #endif
        #ifdef CEL_WP
        varying vec3 vCelWP;
        #endif
        // Cheap 2D value noise (hash-based); low frequency only, never photoreal grain.
        // **全專案唯一一支**(2026-08-16 由 #ifdef CEL_WP 之下提出來):wash / moss / 泡沫 /
        // 墨線斷筆同吃。兩份 hash 在同一個場景裡就是「地形的斷點與機體的斷點是兩種花紋」,
        // 而那沒有任何錯誤訊息。代價是沒有 CEL_WP 的材質多編一支(會被編譯器剝掉的)死函式 ——
        // 「沒標軟性的程式碼一行都不多」那條精神條款在這裡刻意讓步,理由就是上面那一句。
        float celHash( vec2 p ) { return fract( sin( dot( p, vec2( 127.1, 311.7 ) ) ) * 43758.5453 ); }
        float celNoise( vec2 p ) {
          vec2 i = floor( p ), f = fract( p );
          f = f * f * ( 3.0 - 2.0 * f );
          return mix( mix( celHash( i ), celHash( i + vec2( 1.0, 0.0 ) ), f.x ),
                      mix( celHash( i + vec2( 0.0, 1.0 ) ), celHash( i + vec2( 1.0, 1.0 ) ), f.x ), f.y );
        }
        #ifdef CEL_LAND_FIELD
        // 三平面取樣:垂直崖面不會把 XZ 花紋沿 Y 整條拉直，投影換手也沒有可見接縫。
        float celTriNoise( vec3 p, vec3 wn ) {
          vec3 w = pow( abs( wn ), vec3( 4.0 ) );
          w /= max( 1e-5, w.x + w.y + w.z );
          return celNoise( p.yz ) * w.x + celNoise( p.xz ) * w.y + celNoise( p.xy ) * w.z;
        }
        #endif
        #ifdef CEL_INKA
        uniform float uSoftInk;
        uniform float uInkBreakA;
        uniform float uInkBreakSpan;
        varying vec3 vCelInkP;
        // ---- 墨線斷筆(序 4 ①-2)----
        // 回傳「這一格的門檻倍率」(1 = 沒抬筆)。第一行是 **uniform 分支**(與 postfx 的
        // \`if ( uAirA > 0.0 )\` / \`if ( uLutA > 0.0 )\` 同一個 idiom)⇒ 拉桿 0 時連雜訊都不算,
        // 而且回傳的是**字面 1.0** 不是 mix 出來的 1.0(浮點上兩者可以不同)。
        // **兩個平面各取一次**是必要的:只取 p.xz 的話垂直裝甲板上整條線同相 = 沒有斷點。
        float celInkBreak() {
          if ( uInkBreakA <= 0.0 ) return 1.0;
          vec3 p = vCelInkP / uInkBreakSpan;
          float n = celNoise( p.xz ) * 0.62 + celNoise( p.yz * 1.73 + 11.3 ) * 0.38;
          float brk = mix( 1.0, ${INK_BREAK.LO.toFixed(3)}, step( n, ${INK_BREAK.CUT.toFixed(3)} ) );
          return mix( 1.0, brk, uInkBreakA );
        }
        #endif
        #if defined(CEL_LAND_ID) && !defined(CEL_LAND_FIELD)
        uniform float uLandInk;
        varying float vLandId;
        #endif
        #ifdef CEL_LAND_FIELD
        uniform float uLandInk;
        uniform sampler2D uLandField;
        uniform vec4 uLandRect;
        #endif
        #ifdef CEL_DIS
        uniform float uDis;
        uniform vec3 uDisO;
        varying vec3 vDisP;
        // ---- 溶入(序 8 ④-2)----
        // \`discard\` 不是 alpha 淡入:賽璐璐件淡入會連自己的輪廓一起淡掉,而 discard 掉的
        // 片元**連 gInfo 都不寫** ⇒ 洞邊留下的是它背後那個東西的資訊,兩支勾線訊號自己
        // 在洞邊出線 = 「溶入中的機體不失去輪廓」。抖動格距以**世界公尺**給(不是 texel):
        // 以 texel 給的話遠處整台會被墨點蓋掉。
        // 遠距剔除那一半:DISSOLVE.FAR_M ≤ 0 ⇒ 下面那一行**根本不編進來**(結構保證,
        // 不是 runtime 分支);曲線只有這一份 —— JS 端再寫一支同樣的 smoothstep 就是兩份
        // 會分家的實作,而分家的症狀是「剔除的邊界跟看到的不一樣」。
        bool celDissolve( vec3 dp ) {
          float k = uDis;${DISSOLVE.FAR_M > 0 ? `
          k = min( k, 1.0 - smoothstep( ${DISSOLVE.FAR_M.toFixed(1)}, ${(DISSOLVE.FAR_M + Math.max(1e-3, DISSOLVE.FAR_BAND_M)).toFixed(1)}, distance( cameraPosition, uDisO ) ) );` : ''}
          if ( k >= 1.0 ) return false;
          float n = celNoise( dp.xz / ${DISSOLVE.CELL_M.toFixed(3)} ) * 0.6
                  + celNoise( dp.yz / ${DISSOLVE.CELL_M.toFixed(3)} * 1.61 + 7.3 ) * 0.4;
          return n > k;
        }
        #endif
        #ifdef CEL_WAVE
        varying float vSeaFade;
        uniform sampler2D uSeaField;
        uniform vec4 uSeaRect;      // (minX, minZ, 1/寬, 1/高)
        uniform float uFoamA;
        uniform vec3 uFoamC;
${CEL_WIND_GLSL}
${CEL_SWAMP_RIPPLE_GLSL}
${CEL_SEA_GLSL}
        // ---- 岸邊泡沫(S6)----
        // 驅動量是**水深**(烤好的深度場)不是岸線幾何:水面 fragment 拿不到場景深度
        // (它與 rtScene.depthTexture 是同一個 FBO 的附件 = 回饋迴圈)。
        // 相位減去 celSeaH ⇒ 浪一來泡沫沖上岸(**MUST 吃同一支** —— 自己再寫一次相位的話
        // 泡沫的沖刷與浪峰會差半個波長)。深度 ≥ RANGE_M ⇒ 恆 0 ⇒ 中性場沒有泡沫。
        float celFoam( vec2 celFxz ) {
          if ( uWeatherWaveAmp <= 0.001 ) return 0.0;
          vec2 celFuv = clamp( ( celFxz - uSeaRect.xy ) * uSeaRect.zw, 0.0, 1.0 );
          float celFd = texture2D( uSeaField, celFuv ).r * ${FOAM.RANGE_M.toFixed(2)};
          float celFade = clamp( 1.0 - celFd / ${FOAM.RANGE_M.toFixed(2)}, 0.0, 1.0 );
          if ( celFade <= 0.0 ) return 0.0;
          if ( celFd <= 0.001 ) return 0.0;
          float celFb = fract( ( celFd - celSeaH( celFxz ) ) / ${FOAM.BAND_M.toFixed(3)} );
          float celBand = max( 0.0, 4.0 * celFb * ( 1.0 - celFb ) );
          float celFp = pow( celBand, ${FOAM.SHAPE_K.toFixed(1)} ) * celFade
                      * mix( 0.45, 1.0, celNoise( celFxz / ${FOAM.NOISE_M.toFixed(2)} ) );
          #ifdef CEL_SWAMP_RIPPLE
          // 沼澤/池塘/封閉水域：浪花變化改為正號到微小負號 (負號數值遠小於正號，負號時不顯示)
          float celSwampPulse = sin( uWindT * 1.5 + dot( celFxz, vec2( 0.45, 0.35 ) ) ) * 0.54 + 0.46; // [-0.08, +1.00]
          celFp *= clamp( celSwampPulse, 0.0, 1.0 );
          #endif
          return step( ${FOAM.STEP.toFixed(2)}, celFp );   // 硬邊(賽璐璐的泡沫不是柔霧)
        }
        #endif
        // 風化場(P2-A):「這一區有多老」。中性 0.5 ⇒ 乘數恆 1;**uCelWSpread = 0 時逐位元同舊制**
        // (拉桿歸零 = 全場均勻,回到這批改動之前)。取不到世界座標的材質一律回中性 ——
        // 場只服務環境物件,機體不該因為停在哪裡而換一種鏽。
        float celWeatherF() {
          #ifdef CEL_WP
            vec2 wuv = clamp( ( vCelWP.xz - uCelWRect.xy ) * uCelWRect.zw, 0.0, 1.0 );
            return 1.0 + ( texture2D( uCelWField, wuv ).r - 0.5 ) * 2.0 * uCelWSpread;
          #else
            return 1.0;
          #endif
        }
        void main() {
          #ifdef CEL_LAND_FIELD
          float celLandMask = 0.0;
          #endif`);
    // ---- 陰影偏色接進 ramp 查表(P1-B)----
    // MUST 在最後做:上面那一串 replace 都靠 three 的 `#include` 錨點,先動這裡不影響它們,
    // 但把宣告塞到最前面會讓 `void main() {` 的錨點落在我們自己的字串上。
    // 宣告一律**頂在整份片段程式最前**:`getGradientIrradiance` 展開後的位置比 `void main()`
    // 早得多,uniform 若跟著其他人塞在 main 前面就是「宣告在使用之後」。
    const canPatch = RAMP_PATCHED && shader.fragmentShader.includes(RAMP_INC);
    shader.uniforms.uCelRampFb = { value: canPatch ? 0 : 1 };
    // 偏色權重的基準 = **這份材質自己那張 ramp** 的暗階(2/3/4/soft 各不同)。
    // 補丁路徑與落地路徑同吃 `celRampDepth`(一份公式),故宣告一律頂在最前面。
    shader.uniforms.uCelRampLo = { value: rampFloor(bands) };
    shader.fragmentShader = 'uniform vec3 uCelRampTint;\nuniform float uCelRampFb;\nuniform float uCelRampLo;\n'
      + `${RAMP_DEPTH_FN}\n`
      + (canPatch ? shader.fragmentShader.replace(RAMP_INC, RAMP_PATCHED) : shader.fragmentShader);
  };
  // 軟性 MUST 進快取鍵:defines 不同卻共用同一支已編譯的程式 = 該材質整批沒有擺動也沒有
  // 細勾線(three 只認這把鑰匙),而畫面上只表現成「有些樹會動、有些不會」。
  // `I` = 細勾線那一半有沒有開:同一個 soft.k 在不透明件開、在半透明件關(見上面 inkable
  // 那道閘)⇒ 不進鑰匙的話兩者共用同一支程式,水面會拿到寫死 alpha 的那一版。
  // ⚠ **每一個新的 define 都 MUST 進這把鑰匙,而 uniform 一個都不准進**:
  // 漏掉 `card`/`surfAttr` 的症狀是「四個角都落在中心 ⇒ 整叢卡片塌成一個點」,
  // 而 `contrib`(uniform)進去的話就是每一個貢獻值編一支新程式(編譯尖峰 + 記憶體)。
  mat.customProgramCacheKey = () =>
    `cel${metal ? 'M' : ''}${wash > 0 ? 'W' : ''}${moss ? 'S' : ''}${coolOn ? 'C' : ''}${paint ? 'P' : ''}${paint?.face ? 'G' : ''}${paint?.flat ? 'F' : ''}${soft ? `Q${soft.k}${inkable ? 'I' : ''}` : ''}${landNrm ? 'L' : ''}${surfAttr ? 'A' : ''}${card ? 'K' : ''}${refl ? 'R' : ''}${inkAlpha ? 'B' : ''}${dissolve ? 'D' : ''}${sk?.ripple ? 'V' : ''}${landId ? 'Z' : ''}${landField ? 'X' : ''}${rim}${treeO ? 'T' : ''}`;
  return mat;
}

/**
 * 事後掛塗裝(paint.js paintUnit):材質在建模時就已 applyCelPatch 過,
 * 這裡沿用它當初的 cel 選項(metal/rim…)重新注入,只多一層花紋。
 */
export function applyPaint(mat, paint) {
  applyCelPatch(mat, { ...(mat.userData.celOpts || {}), paint });
  mat.needsUpdate = true;
  return mat;
}

/**
 * 賽璐璐材質(全專案共用入口)。
 * opts.celMetal = true → 硬邊金屬高光帶(槍管/砲塔/機甲裝甲)。
 */
export function toonMat(color, opts = {}) {
  // rim 可覆寫(同 envMat;預設 0.22 ⇒ 既有呼叫端逐位元不變):GLB 植被的葉片要掛軟性旗標
  // 又不能因此比同一棵樹的樹幹多一圈邊緣光,那條路徑傳 rim: 0。
  // S2 的六個新欄位 MUST **解構出來**再往下傳:落進 `...rest` 就是丟給 MeshToonMaterial
  // 的建構子 = three 靜默忽略一個不存在的屬性,而貢獻永遠是 1、卡片永遠不展開。
  // `landId` **刻意不在這裡**:它與 `land` / `landNrm` 同一族(地貌),而機體之間的線是要的
  // —— 稽核 Ⅶ 那一條 `!/land/.test(toonMat)` 就是為這件事訂的,MUST NOT 為了方便鬆掉它。
  const { celMetal, bands, rim = 0.22, soft = null,
    ink, contrib, surf, surfKey, surfAttr, card, refl, dissolve, treeO, ...rest } = opts;
  const m = new THREE.MeshToonMaterial({ color, gradientMap: toonGradient(bands), ...rest });
  // `bands` MUST 一起傳下去:偏色權重要以**這張 ramp 自己的暗階**正規化,拿不到就會用
  // 預設 3 階的 0.4 去量 soft(0.745)那一組 = 白色大面積的陰影偏色少掉一半。
  return applyCelPatch(m, { metal: !!celMetal, rim, soft, bands, ink, contrib, surf, surfKey, surfAttr, card, refl, dissolve, treeO });
}

/**
 * 環境賽璐璐材質(靜態環境物件專用:障礙物/建物/道路/地標)。
 * 預設帶低頻水彩 wash + 冷藍陰影;opts.moss = { color?, amount? } 開苔蘚投影。
 * 機體/英雄/武器一律仍走 toonMat,不吃這裡的環境偏色。
 */
export function envMat(color, opts = {}) {
  // rim 可覆寫:貼地平面(地被/道路)在遠處掠射角 rim 全開會整片洗白,傳 rim:0 關閉
  // preview:設定頁樣品專用(改吃樣品自己那張風化場,見 ensurePreviewField)
  // land / landNrm:地貌(見 applyCelPatch 的同名參數)。**只有 terrain.js 與 ground.js
  // 傳它** —— 道路、建物、擺件的邊界線是要的,掛上去就是把那些線一起關掉。
  const { celMetal, wash = 0.5, cool = 0.5, moss = null, rim = 0.22, bands, preview = false, soft = null, land = false, landNrm = false,
    ink, contrib, surf, surfKey, surfAttr, card, refl, dissolve, landId, landField, ...rest } = opts;
  const m = new THREE.MeshToonMaterial({ color, gradientMap: toonGradient(bands), ...rest });
  // tint: 'env' —— 陰影偏色分「機體」與「環境」兩軌(P1-B):機甲要保住陣營塗裝的色相,
  // 環境可以偏得重一點。兩軌各自一根拉桿,MUST NOT 併成一個值。
  return applyCelPatch(m, { metal: !!celMetal, rim, wash, cool, moss, tint: 'env', preview, soft, bands, land: land || landNrm, landNrm, ink, contrib, surf, surfKey, surfAttr, card, refl, dissolve, landId, landField });
}

/**
 * **只掛學派、不掛演出**的賽璐璐材質(2026-08-16;§0-b A14 ④)。
 *
 * 用途:那幾處**刻意**不吃 cel 補丁的 `MeshToonMaterial`(GLB 植被的不透明樹幹、洞頂 /
 * 岸邊泡沫 / 潮間帶 / 水簾這幾層透明覆蓋)。它們在 School A 下無害;School B 下留在
 * ramp 而全世界改硬切 = **同一棵樹的葉子硬切、樹幹漸層**,而那沒有任何錯誤訊息。
 *
 * 三條:
 *   ①**School A 下完全不掛 `onBeforeCompile`** ⇒ 逐位元等於今天那一行裸的
 *     `new THREE.MeshToonMaterial({ …, gradientMap: toonGradient() })`。這是「最小侵入」
 *     唯一的證據面(定場照 md5 全同)。
 *   ②MUST NOT 順手改成 `toonMat` / `envMat` —— 那會加上 rim 與 gInfo 覆寫:
 *     樹幹那一行的 `rim: 0` 是刻意的,而 gInfo 覆寫會讓折邊勾線多出線。
 *   ③軌固定走 `env`(這幾處全是環境物件),與 `envMat` 同軌。
 *
 * @param params MeshToonMaterial 的建構參數(額外收 `bands`,語意同 `toonMat`)
 */
export function toonPlain(params = {}) {
  const { bands, ...rest } = params;
  const m = new THREE.MeshToonMaterial({ gradientMap: toonGradient(bands), ...rest });
  if (_school !== 'b') return m;
  m.onBeforeCompile = (shader) => {
    shader.uniforms.uCelRampTint = _rampTint.env;
    celCutUniforms(shader, bands);
    const canPatch = RAMP_PATCHED && shader.fragmentShader.includes(RAMP_INC);
    shader.fragmentShader = `uniform vec3 uCelRampTint;\n${
      (canPatch ? shader.fragmentShader.replace(RAMP_INC, RAMP_PATCHED) : shader.fragmentShader)
        .replace('void main() {', `${CEL_CUT_DECL_GLSL}\n        void main() {`)
        .replace('#include <opaque_fragment>', `${CEL_CUT_MIX_GLSL}\n        #include <opaque_fragment>`)}`;
  };
  // 這幾份材質彼此的差異只有顏色/貼圖(uniform),沒有任何 define ⇒ 一把鍵就夠;
  // 但 MUST 與 `applyCelPatch` 那一族**分開**(它們的 GLSL 不同)。
  m.customProgramCacheKey = () => 'celPlain';
  return m;
}

/**
 * 溶入的**唯一寫入點**(序 8 ④-2)。呼叫端 MUST NOT 自己去戳 `mat.userData.celDisU`
 * —— 那顆 uniform 物件的穩定性(重編譯不換顆)是這一項唯一會靜默壞掉的地方。
 *
 * 反轉外殼描邊在溶入期間 MUST **整片收起來**:全專案每一片外殼共用 `'celOutline'` 這一把
 * 快取鍵,給部分外殼加 define 而鍵不變 = three 發錯程式(不報錯)。代價寫在這裡:
 * 結束那一幀輪廓由「只有勾線 pass」變回「勾線 + 外殼」,線寬會跳一下;升級路徑是逐單位
 * 的 `'celOutlineD'` 鍵變體(要讓 `outlinify` 的旗標一路穿過 forge 的收尾鉤)。
 *
 * @param target Object3D 子樹 或 單一材質
 * @param k      進度 ∈ [0,1];1 = 完全實體(結束時 MUST 寫回 1 並停止逐幀寫入)
 * @param origin 該單位的世界原點(抖動網格錨在它上面);省略 = 沿用上一次
 * @returns 實際被寫到的材質數(0 = 這棵樹上沒有任何 dissolve 材質 ⇒ 呼叫端接錯了)
 */
export function setDissolve(target, k, origin = null) {
  const v = Math.min(1, Math.max(0, k));
  let n = 0;
  const put = (m) => {
    const u = m?.userData?.celDisU;
    if (!u) return;
    u.value = v;
    if (origin) m.userData.celDisO.value.set(origin.x, origin.y, origin.z);
    n++;
  };
  if (target?.isMaterial) put(target);
  else if (target?.traverse) {
    target.traverse((o) => {
      if (!o.isMesh) return;
      // 外殼描邊:溶入期間整片收起(見上面的理由),結束(k ≥ 1)復原
      if (o.userData.isOutline) { o.visible = v >= 1; return; }
      (Array.isArray(o.material) ? o.material : [o.material]).forEach(put);
    });
  }
  return n;
}

/**
 * 事後為單位材質開啟 dissolve define。只接已走 `applyCelPatch` 的不透明材質;
 * 光環 / 血條 / 透明特效維持即時收起,不把 alpha 淡出復辟成第二份實作。
 */
export function enableDissolve(target) {
  const seen = new Set();
  let n = 0;
  target?.traverse?.((o) => {
    if (!o.isMesh || o.userData.isOutline) return;
    for (const m of (Array.isArray(o.material) ? o.material : [o.material])) {
      if (!m || m.transparent || seen.has(m) || !m.userData?.celOpts || m.userData.celOpts.dissolve) continue;
      seen.add(m);
      applyCelPatch(m, { ...m.userData.celOpts, dissolve: true });
      m.needsUpdate = true;
      n++;
    }
  });
  return n;
}

/**
 * 接地環境光遮蔽(botw_plan Task 2.2):對群組內每個 mesh 烤頂點色,
 * 越貼近群組地面(局部 y=0)越暗偏冷 → 物件「長」在地上而不是浮貼。
 * 跳過透明/發光/wireframe 件(火舌/水面/信標/電塔),只動不透明結構件。
 * @param root 障礙物 / 地標的 Group(尚未進場景,局部座標即可)
 * @param fade AO 衰減高度(局部公尺;群組整體縮放前)
 */
const _aoTint = { r: 0.72, g: 0.7, b: 0.78 };   // 冷紫灰接地陰影(偏淺:深色件疊 toon 暗部也不塌黑,#INC-106 精神)
export function bakeContactAO(root, fade = 2.4) {
  root.updateMatrixWorld(true);
  const inv = new THREE.Matrix4().copy(root.matrixWorld).invert();
  const toRoot = new THREE.Matrix4();
  const v = new THREE.Vector3();
  root.traverse((o) => {
    if (!o.isMesh || o.userData.isOutline) return;
    const m = Array.isArray(o.material) ? o.material[0] : o.material;
    if (!m || m.transparent || m.wireframe) return;
    if (m.emissive && (m.emissive.r + m.emissive.g + m.emissive.b) > 0.05 && (m.emissiveIntensity ?? 1) >= 0.5) return;
    toRoot.multiplyMatrices(inv, o.matrixWorld);
    const pos = o.geometry.attributes.position;
    // **乘進既有的頂點色而不是覆寫**(2026-08-16;S9):`mergeGeos(geos, colors)`(beacons.js
    // 的頂點色合併縫)與本支寫的是**同一個通道**。現況兩個消費端剛好互斥所以從沒撞過,
    // 而載具/公設合併那一輪讓它們第一次同時出現 —— 撞到的症狀是「整組沒有接地陰影」
    // 或「整組變灰白」,兩種都不報錯而 `audit_gpu_lifecycle` 照樣全綠(它量的是 dispose)。
    // 沒有既有頂點色 ⇒ 基底 1 ⇒ 逐位元同舊制。
    const prev = o.geometry.attributes.color;
    const colors = new Float32Array(pos.count * 3);
    for (let i = 0; i < pos.count; i++) {
      v.fromBufferAttribute(pos, i).applyMatrix4(toRoot);
      const t = Math.min(1, Math.max(0, v.y / fade));   // 0 = 貼地全暗,1 = 無 AO
      const p0 = prev ? prev.getX(i) : 1, p1 = prev ? prev.getY(i) : 1, p2 = prev ? prev.getZ(i) : 1;
      colors[i * 3] = (_aoTint.r + (1 - _aoTint.r) * t) * p0;
      colors[i * 3 + 1] = (_aoTint.g + (1 - _aoTint.g) * t) * p1;
      colors[i * 3 + 2] = (_aoTint.b + (1 - _aoTint.b) * t) * p2;
    }
    o.geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    m.vertexColors = true;
    m.needsUpdate = true;
  });
  return root;
}

/** 把載入的 GLB(或任何子樹)整棵換成 cel 材質,保留貼圖/顏色/透明度 */
export function toonify(root) {
  root.traverse((o) => {
    if (!o.isMesh || !o.material || o.userData.isOutline) return;
    const swap = (m) => {
      if (m.isMeshToonMaterial) return m;
      const t = new THREE.MeshToonMaterial({
        color: m.color ? m.color.clone() : new THREE.Color(0xffffff),
        map: m.map || null,
        gradientMap: toonGradient(),
        transparent: m.transparent || false,
        opacity: m.opacity ?? 1,
        side: m.side ?? THREE.FrontSide,
      });
      if (m.emissive) { t.emissive = m.emissive.clone(); t.emissiveIntensity = m.emissiveIntensity ?? 1; }
      return applyCelPatch(t, { metal: (m.metalness ?? 0) >= 0.5 });
    };
    o.material = Array.isArray(o.material) ? o.material.map(swap) : swap(o.material);
  });
  return root;
}

// ---- 反轉外殼描邊(Inverted Hull)----
// BackSide 黑殼沿頂點法線外推固定世界寬度;寬度在建立時除以該 mesh 的
// 世界縮放,讓 fitToHeight 縮放過的模型描邊粗細一致(≈ 螢幕 2~3px)。
const OUTLINE_COLOR = new THREE.Color(0x0a0b12);
// 描邊的**螢幕最小半寬**(NDC;垂直方向 2 單位 = 整個畫面高)。
// 舊制只沿法線外推固定的**世界**寬度 ⇒ 線粗與距離成反比:近的胖、遠的直接消失 ——
// 一台機甲跑遠一點就從「漫畫角色」變回「沒有描邊的多邊形」。
// 2026-08-03 改成「世界寬度」與「螢幕下限」取大者:
//   ・近距離 uOW 勝出 ⇒ **逐位元同舊制**(所有 15 處呼叫端的寬度不必重調);
//   ・遠距離下限勝出 ⇒ 線粗鎖在約 1.2px,不再消失。
// 下限 MUST 由 `projectionMatrix[1][1]` 反推(= 1/tan(fov/2)):狙擊縮 FOV 時投影矩陣本來就變,
// 手寫一個常數換算 = 一開鏡描邊全部變粗(而那正是最需要看清輪廓的時候)。
const OUTLINE_MIN_NDC = 0.0022;

/**
 * @param w    描邊寬度,**已除以該 mesh 的世界縮放**(= 局部單位;呼叫端 `outlinify` 算)
 * @param invS `1 / 世界縮放` —— 與 `w` 吃**同一個** s。
 *
 * 兩個外推量都住在 `position` 那一側 ⇒ **兩個都 MUST 換成局部單位**(2026-08-10 使用者回報
 * 「主堡黑球」)。`uOW` 一開始就除過了,而螢幕下限 `oMinW` 是由**視距**(世界公尺)換算來的
 * 卻直接加在局部座標上 ⇒ 實得線寬 = 下限 × 世界縮放,而且 `oMinW ∝ 視距` ⇒ **離越遠脹越大、
 * 沒有上界**。這件事在低縮放的機體上只是「遠處的線略粗」(塔 1.39×、直升機 2.38× — 看不出來),
 * 但主堡的 `dome.glb` 建模單位極小,`fitToHeight(42m)` 之後世界縮放是 **795×**:200m 外那顆
 * 黑殼被推出 236m、450m 外推出 530m —— 就是使用者看到的「主堡上空異常過大的球面輪廓」,
 * 而它**擋不住任何射線也量不到**(位移只發生在頂點著色器,`Raycaster` 走的是 CPU 幾何 ⇒
 * 稽核與冒煙的數值全是對的,只有畫面不對)。
 * 折進 `uOMin` 而不另開 uniform:兩者恆一起出現,分成兩個遲早有人只傳其中一個。
 */
function outlineMaterial(w, invS) {
  const m = new THREE.MeshBasicMaterial({ color: OUTLINE_COLOR, side: THREE.BackSide });
  m.onBeforeCompile = (shader) => {
    shader.uniforms.uOW = { value: w };
    shader.uniforms.uOMin = { value: OUTLINE_MIN_NDC * invS };
    shader.vertexShader = ('uniform float uOW;\nuniform float uOMin;\n' + shader.vertexShader)
      .replace('#include <begin_vertex>', `
        // 視距:骨骼變形前的綁定姿勢即可(同一根骨頭上的頂點距離差異遠小於一個像素)
        float oDist = max( 0.05, -( modelViewMatrix * vec4( position, 1.0 ) ).z );
        // uOMin(NDC ÷ 世界縮放)換回這個距離上的**局部**寬度;projectionMatrix[1][1] = 1/tan(fov/2)
        float oMinW = uOMin * oDist / max( 0.001, projectionMatrix[1][1] );
        vec3 transformed = position + normal * max( uOW, oMinW );`);
  };
  m.customProgramCacheKey = () => 'celOutline';
  return m;
}

const _ws = new THREE.Vector3();

/**
 * 對子樹所有不透明 mesh 加描邊外殼。
 * @param root  目標(單位/障礙/座艙…)
 * @param width 描邊世界寬度(公尺);依單位尺寸給,例:高 6m 機甲 ≈ 0.09
 * 透明件(旋翼/水面/偽裝網/火舌)與 userData.noOutline 跳過。
 */
export function outlinify(root, width = 0.08) {
  root.updateMatrixWorld(true);
  const jobs = [];
  root.traverse((o) => {
    if (!o.isMesh || o.userData.isOutline || o.userData.noOutline) return;
    const m = Array.isArray(o.material) ? o.material[0] : o.material;
    if (!m || m.transparent) return;
    const ws = o.getWorldScale(_ws);
    // 世界縮放只量**一次**:固定寬度與螢幕下限 MUST 吃同一個 s(見 outlineMaterial 檔頭 ——
    // 只換其中一個,另一個就會隨 fitToHeight 的縮放倍率無聲脹大)
    const s = (Math.abs(ws.x) + Math.abs(ws.y) + Math.abs(ws.z)) / 3 || 1;
    jobs.push([o, width / s, 1 / s]);
  });
  for (const [o, w, invS] of jobs) {
    let shell;
    if (o.isSkinnedMesh) {
      shell = new THREE.SkinnedMesh(o.geometry, outlineMaterial(w, invS));
      shell.bindMode = o.bindMode;
      shell.bind(o.skeleton, o.bindMatrix);   // 共用骨骼:描邊跟著動畫走
    } else {
      // 鑿刻岩等 per-face 硬邊法線幾何:外殼沿面法線外推會裂縫,
      // 改用建構時附帶的平滑法線副本(userData.outlineGeo)。
      // ⚠ 2026-08-14:副本要**檢查是不是真的幾何**,而且拿不到就退到 `geometry.userData` ——
      //   `Object3D.copy` 是拿 `JSON.parse(JSON.stringify(userData))` 複製的,
      //   `mesh.clone()` 之後那一格會變成一個**長得像幾何的普通物件**(FPV 座艙複製第三人稱
      //   武裝子樹就會踩到):`new THREE.Mesh(它)` 在 three 的建構子裡當場 TypeError,
      //   而整個座艙因此建不出來。幾何本身是共用的 ⇒ `geometry.userData` 那一份仍然是真品。
      const ug = o.userData.outlineGeo, gg = o.geometry.userData?.outlineGeo;
      shell = new THREE.Mesh(
        (ug?.isBufferGeometry && ug) || (gg?.isBufferGeometry && gg) || o.geometry,
        outlineMaterial(w, invS));
    }
    shell.userData.isOutline = true;
    shell.frustumCulled = false;
    o.add(shell);   // 掛在原 mesh 下(identity 局部變換 = 同位置同縮放)
  }
  return root;
}

// ---------------- 一次性物件的 GPU 資源回收(唯一縫)----------------
// three 的 WebGLRenderer 以 `geometry.dispose()` / `material.dispose()` 事件釋放顯示卡上的緩衝:
// 只 `scene.remove()` 不 dispose,緩衝會一直留著。特效/彈體是**每發數十顆**的一次性物件,
// 漏掉就是「打越久越卡」(手機顯存吃緊後更明顯)。
//
// 共用幾何(單位圓柱/單位球/碎塊池…)整場只有一份,MUST NOT dispose —— 一旦誤放,
// 之後所有借用同一份幾何的物件都會變空白。故共用幾何一律先 `markShared()` 註冊,
// 回收時依此跳過。**castfx.js / vfx.js / game.js 共用這一支**,MUST NOT 各寫一份。
const _sharedGeo = new Set();
/** 註冊「整場共用、永不釋放」的幾何;回傳原幾何(方便 `markShared(new …Geometry())` 串接) */
export function markShared(geo) { _sharedGeo.add(geo); return geo; }
/** 一次性物件樹的資源回收:幾何(非共用)+ 材質;貼圖一律不動(皆為快取共用) */
export function disposeTree(root) {
  root.traverse((o) => {
    // InstancedMesh 的 instanceMatrix / instanceColor 是物件自己的 GPU buffer，
    // 不屬於 geometry；只釋放幾何與材質仍會留下這兩份配置。
    if (o.isInstancedMesh) o.dispose();
    // Sprite.geometry 是 three 全域共用的一份,MUST NOT dispose(會打到全 app 的 sprite)
    if (!o.isSprite && o.geometry && !_sharedGeo.has(o.geometry)) o.geometry.dispose();
    const m = o.material;
    if (m) (Array.isArray(m) ? m : [m]).forEach((x) => x?.dispose());
  });
}
