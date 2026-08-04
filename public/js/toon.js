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
const RAMP_PATCHED = (() => {
  const chunk = THREE.ShaderChunk?.[RAMP_CHUNK];
  if (typeof chunk !== 'string' || !chunk.includes(RAMP_HOOK)) return null;
  return chunk.replace(RAMP_HOOK, `
    {
      // ramp 的階值 celG:暗階最小、亮階 = 1。偏色只給暗階(權重 = celRampDepth),
      // 亮階恆不偏 —— 賽璐璐的受光面本來就該是光源本色。
      // 乘數的 Rec.709 亮度恆 = 1(shadowTintRGB 已正規化)⇒ 暗階亮度逐位元不動,A14 不受影響。
      float celG = texture2D( gradientMap, coord ).r;
      return vec3( celG ) * mix( uCelRampTint, vec3( 1.0 ), celRampDepth( celG ) );
    }`);
})();

// 共享 uniform:一份物件餵給所有材質 ⇒ 拉桿改值即全場生效,MUST NOT 改成重建材質
// (材質早就發到 GPU 了,戰鬥中重建等於整場卡住)。
const _rampTint = {
  mech: { value: new THREE.Color(1, 1, 1) },
  env: { value: new THREE.Color(1, 1, 1) },
};

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

/** 中性場(還沒載入戰場、或展示台/角色預覽):恆 0.5 ⇒ 乘數恆 1 */
function neutralWField() {
  const t = new THREE.DataTexture(new Uint8Array([128]), 1, 1, THREE.RedFormat);
  t.needsUpdate = true;
  return t;
}
_wField.value = neutralWField();

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
function syncVisualPrefs() {
  _rampTint.mech.value.setRGB(...shadowTintRGB(visualPref('shadowMech')));
  _rampTint.env.value.setRGB(...shadowTintRGB(visualPref('shadowEnv')));
  _wSpread.value = WEATHER_SPREAD * visualPref('weather');
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

/**
 * 全場風(單一縫)。植被/旗幟(本檔的頂點位移)與雲朵(`environment.js` 的漂移)MUST
 * 同吃這一份 —— 兩邊各寫一個風向,畫面上就是「雲往東飄、草往西倒」。
 */
export const WIND = {
  DIR_DEG: 118,      // 風向(世界 XZ 方位角,度)
  WAVE_M: 26,        // 空間波長(m):風以**波**的形式掃過林子,不是全林同步點頭
  BEAT: 1.87,        // 第二諧波的頻率比;刻意取無理數附近 ⇒ 兩波的合成週期長到看不出重複
  CLOUD_MPS: 1.7,    // 雲的漂移速度(m/s)
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
  grass: { amp: 0.075, freq: 1.15, axis: 'y' },   // 芒草 / 蘆葦 / 箭竹 / 花圃
  cloth: { amp: 0.110, freq: 1.70, axis: 'x' },   // 旗幟
  turf:  { amp: 0,     freq: 0,    axis: 'y' },   // 草坪 / 內場草皮(只細線,不擺動)
};

// 共享 uniform(同 `_celLightDirView` / `_rampTint`:一份物件餵給所有材質)。
// **時鐘刻意不取模**:各 kind 的頻率彼此不可通約,取模會在週期邊界跳一下;
// float32 在一小時(t = 3600)上的相位解析度仍有 ~0.001 rad,一場對局綽綽有餘。
const _windT = { value: 0 };
const _windDir = { value: new THREE.Vector2(WIND_DIR[0], WIND_DIR[1]) };
const _windK = {
  value: new THREE.Vector2(WIND_DIR[0], WIND_DIR[1]).multiplyScalar(Math.PI * 2 / WIND.WAVE_M),
};

/**
 * 推進風的時鐘(每幀一次;呼叫端 = `game.js` 的主迴圈)。
 * dt 夾在 [0, 0.25]:分頁切回來的那一幀 dt 可能是好幾秒,不夾的話整片林子會抽一下。
 */
export function stepCelWind(dt) {
  _windT.value += Math.min(0.25, Math.max(0, dt || 0));
}

/** 目前的風時鐘(秒);雲朵那半(environment.js)與植被同吃一個時鐘 */
export function celWindTime() { return _windT.value; }

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
 */
function applyCelPatch(mat, { metal = false, rim = 0.22, wash = 0, moss = null, cool = 0, paint = null, tint = 'mech', preview = false, soft = null, bands = 3 } = {}) {
  if (preview) ensurePreviewField();
  const sk = soft ? (SOFT_KINDS[soft.k] || SOFT_KINDS.leaf) : null;
  const defines = { ...(mat.defines || {}) };
  if (metal) defines.CEL_METAL = '';
  if (wash > 0) defines.CEL_WASH = '';
  if (moss) defines.CEL_MOSS = '';
  if (cool > 0) defines.CEL_COOL = '';
  if (paint) defines.CEL_PAINT = '';
  // 單一主徽(totem/tattoo/flag)只貼一面朝外的顯眼裝甲:用 rig 空間法線與指定朝向(paint.face,
  // 直立機甲取 +Z 胸甲、橫置飛行器取 +Y 頂面)的夾角把貼花閘在該半球,避免三平面投影
  // 在機體背面/底面鏡像出第二枚徽記(使用者要求「一個完整的」)。
  if (paint?.face) defines.CEL_PAINT_GATE = '';
  // 平面閘(hinomaru):只在與 paint.flat 軸「平行」的面(頂+底兩面,|N·軸| 大)顯現 →
  // 抑制三平面投影在薄件側緣(垂直面)的溢色。與 GATE(單一半球)互斥。
  if (paint?.flat) defines.CEL_PAINT_FLAT = '';
  if (wash > 0 || moss) defines.CEL_WP = '';   // 需要世界座標 varying
  // 細勾線與擺動**分兩個 define**:草坪要前者不要後者(它是鋪面,擺起來只會跟步道錯開)。
  if (sk) defines.CEL_SOFT = '';
  if (sk && sk.amp > 0) {
    defines.CEL_SWAY = '';
    if (sk.axis === 'x') defines.CEL_SWAY_H = '';
  }
  mat.defines = defines;
  mat.userData.celOpts = { metal, rim, wash, moss, cool, paint, tint, preview, soft, bands };
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uCelLightDir = { value: _celLightDirView };
    // 軟性:勾線門檻倍率(寫進場景 RT 的 alpha)+ 擺動的四個形狀參數
    shader.uniforms.uSoftInk = { value: sk ? INK_SOFT_A : 1 };
    shader.uniforms.uSoftSpan = { value: Math.max(1e-3, soft?.span ?? 1) };
    shader.uniforms.uSoftBase = { value: soft?.base ?? 0 };
    shader.uniforms.uSoftSy = { value: soft?.sy ?? 1 };
    shader.uniforms.uSoftAmp = { value: (sk?.amp ?? 0) * Math.max(1e-3, soft?.span ?? 1) };
    shader.uniforms.uSoftFreq = { value: sk?.freq ?? 0 };
    shader.uniforms.uWindT = _windT;
    shader.uniforms.uWindDir = _windDir;
    shader.uniforms.uWindK = _windK;
    // 陰影偏色(P1-B):共享 uniform 物件 ⇒ 拉桿一動,全場材質同一幀跟著換
    shader.uniforms.uCelRampTint = _rampTint[tint] || _rampTint.mech;
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
        #ifdef CEL_SWAY
        uniform float uWindT;
        uniform vec2 uWindDir;
        uniform vec2 uWindK;
        uniform float uSoftSpan;
        uniform float uSoftBase;
        uniform float uSoftSy;
        uniform float uSoftAmp;
        uniform float uSoftFreq;
        #endif
        void main() {`)
      // 擺動 MUST 排在 project_vertex **之前**:那一段吃 transformed 算 mvPosition 與
      // gl_Position,擺完再算才會連 vViewPosition / 世界座標 varying 一起是同一個姿勢。
      .replace('#include <project_vertex>', `
        #ifdef CEL_SWAY
        {
          // ---- 擺動權重 sw:0 = 錨在根部 / 旗桿側(不動),1 = 梢端 ----
          // 單位是**整株局部座標**(uSoftBase = 這個零件的原點在整株上的位置、
          // uSoftSy = 零件自身的縱向縮放)⇒ 樹幹頂與樹冠底在同一個高度上拿到**同一個** sw,
          // 位移場是連續的 ⇒ 接合不會被風吹開(A26 / A27 的接合完成度與擺動無關)。
          // 逐零件各自從 0 起算的話,每一顆樹冠都會繞自己的中心剪切,疊接縫當場開開合合。
          #ifdef CEL_SWAY_H
            float sw = clamp( ( uSoftBase + transformed.x ) / uSoftSpan, 0.0, 1.0 );
          #else
            float sw = clamp( ( uSoftBase + transformed.y * uSoftSy ) / uSoftSpan, 0.0, 1.0 );
          #endif
          sw *= sw;   // 二次:根部更硬、梢端更軟(一次的話整株看起來像被平移)
          // ---- 相位:取**實例原點**,不是逐頂點 ----
          // 逐頂點取相位 = 同一片葉子的兩端各走各的 = 幾何被拉扯變形;取原點則整個零件同相,
          // 而相鄰植株的原點差幾公尺 ⇒ 風以波的形式掃過林子(uWindK 的波長 WIND.WAVE_M)。
          mat3 swM = mat3( modelMatrix );
          vec4 swO = vec4( 0.0, 0.0, 0.0, 1.0 );
          #ifdef USE_INSTANCING
            swM = swM * mat3( instanceMatrix );
            swO = instanceMatrix * swO;
          #endif
          swO = modelMatrix * swO;
          float swP = dot( swO.xz, uWindK );
          // 兩個不可通約的正弦相加 = 週期性(使用者要的「重複性變化」)但看不出重複點
          float swOsc = sin( uWindT * uSoftFreq + swP ) * 0.72
                      + sin( uWindT * uSoftFreq * ${WIND.BEAT.toFixed(3)} + swP * 1.6 + 1.7 ) * 0.28;
          // 世界風向 → 零件局部方向。GLSL 的 \`v * m\` = transpose(m) * v;實例矩陣是
          // 旋轉 × (XZ 等比、Y 另計) 的縮放 ⇒ 轉置與逆只差一個對角縮放,水平分量的比例不變,
          // 正規化後方向一致。MUST NOT 省掉這一步:實例的 ry 是亂數,直接拿世界向量當局部
          // 向量的話每一株會各吹各的方向,那就不是「風」了。
          vec3 swD = normalize( vec3( uWindDir.x, 0.0, uWindDir.y ) * swM + vec3( 1e-6 ) );
          float swA = sw * uSoftAmp * swOsc;
          transformed += swD * swA;
          // 擺出去時梢端略降(弧長守恆的一階近似)—— 少了這一項會看起來像整株在平移
          transformed.y -= sw * uSoftAmp * abs( swOsc ) * 0.3;
        }
        #endif
        #include <project_vertex>
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
        #endif`);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <normal_fragment_begin>', `
        #include <normal_fragment_begin>
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
        {
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
        #ifdef CEL_SOFT
        // 場景 RT 的 alpha ≡ 這一格的**勾線門檻倍率**(見檔頭「軟性物質」段的契約)。
        // MUST 排在 opaque_fragment **之後**:那一段的 \`#ifdef OPAQUE diffuseColor.a = 1.0\`
        // 會把先寫的值蓋掉。之後的 colorspace / fog / dithering 都只動 rgb,寫在這裡最穩。
        gl_FragColor.a = uSoftInk;
        #endif`)
      .replace('void main() {', `
        uniform vec3 uCelLightDir;
        uniform float uCelRim;
        #ifdef CEL_SOFT
        uniform float uSoftInk;
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
        // Cheap 2D value noise (hash-based); low frequency only, never photoreal grain.
        float celHash( vec2 p ) { return fract( sin( dot( p, vec2( 127.1, 311.7 ) ) ) * 43758.5453 ); }
        float celNoise( vec2 p ) {
          vec2 i = floor( p ), f = fract( p );
          f = f * f * ( 3.0 - 2.0 * f );
          return mix( mix( celHash( i ), celHash( i + vec2( 1.0, 0.0 ) ), f.x ),
                      mix( celHash( i + vec2( 0.0, 1.0 ) ), celHash( i + vec2( 1.0, 1.0 ) ), f.x ), f.y );
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
        void main() {`);
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
  mat.customProgramCacheKey = () =>
    `cel${metal ? 'M' : ''}${wash > 0 ? 'W' : ''}${moss ? 'S' : ''}${cool > 0 ? 'C' : ''}${paint ? 'P' : ''}${paint?.face ? 'G' : ''}${paint?.flat ? 'F' : ''}${soft ? `Q${soft.k}` : ''}${rim}`;
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
  const { celMetal, bands, rim = 0.22, soft = null, ...rest } = opts;
  const m = new THREE.MeshToonMaterial({ color, gradientMap: toonGradient(bands), ...rest });
  // `bands` MUST 一起傳下去:偏色權重要以**這張 ramp 自己的暗階**正規化,拿不到就會用
  // 預設 3 階的 0.4 去量 soft(0.745)那一組 = 白色大面積的陰影偏色少掉一半。
  return applyCelPatch(m, { metal: !!celMetal, rim, soft, bands });
}

/**
 * 環境賽璐璐材質(靜態環境物件專用:障礙物/建物/道路/地標)。
 * 預設帶低頻水彩 wash + 冷藍陰影;opts.moss = { color?, amount? } 開苔蘚投影。
 * 機體/英雄/武器一律仍走 toonMat,不吃這裡的環境偏色。
 */
export function envMat(color, opts = {}) {
  // rim 可覆寫:貼地平面(地被/道路)在遠處掠射角 rim 全開會整片洗白,傳 rim:0 關閉
  // preview:設定頁樣品專用(改吃樣品自己那張風化場,見 ensurePreviewField)
  const { celMetal, wash = 0.5, cool = 0.5, moss = null, rim = 0.22, bands, preview = false, soft = null, ...rest } = opts;
  const m = new THREE.MeshToonMaterial({ color, gradientMap: toonGradient(bands), ...rest });
  // tint: 'env' —— 陰影偏色分「機體」與「環境」兩軌(P1-B):機甲要保住陣營塗裝的色相,
  // 環境可以偏得重一點。兩軌各自一根拉桿,MUST NOT 併成一個值。
  return applyCelPatch(m, { metal: !!celMetal, rim, wash, cool, moss, tint: 'env', preview, soft, bands });
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
    const colors = new Float32Array(pos.count * 3);
    for (let i = 0; i < pos.count; i++) {
      v.fromBufferAttribute(pos, i).applyMatrix4(toRoot);
      const t = Math.min(1, Math.max(0, v.y / fade));   // 0 = 貼地全暗,1 = 無 AO
      colors[i * 3] = _aoTint.r + (1 - _aoTint.r) * t;
      colors[i * 3 + 1] = _aoTint.g + (1 - _aoTint.g) * t;
      colors[i * 3 + 2] = _aoTint.b + (1 - _aoTint.b) * t;
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

function outlineMaterial(w) {
  const m = new THREE.MeshBasicMaterial({ color: OUTLINE_COLOR, side: THREE.BackSide });
  m.onBeforeCompile = (shader) => {
    shader.uniforms.uOW = { value: w };
    shader.uniforms.uOMin = { value: OUTLINE_MIN_NDC };
    shader.vertexShader = ('uniform float uOW;\nuniform float uOMin;\n' + shader.vertexShader)
      .replace('#include <begin_vertex>', `
        // 視距:骨骼變形前的綁定姿勢即可(同一根骨頭上的頂點距離差異遠小於一個像素)
        float oDist = max( 0.05, -( modelViewMatrix * vec4( position, 1.0 ) ).z );
        // uOMin(NDC)換回這個距離上的世界寬度;projectionMatrix[1][1] = 1/tan(fov/2)
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
    const s = (Math.abs(ws.x) + Math.abs(ws.y) + Math.abs(ws.z)) / 3 || 1;
    jobs.push([o, width / s]);
  });
  for (const [o, w] of jobs) {
    let shell;
    if (o.isSkinnedMesh) {
      shell = new THREE.SkinnedMesh(o.geometry, outlineMaterial(w));
      shell.bindMode = o.bindMode;
      shell.bind(o.skeleton, o.bindMatrix);   // 共用骨骼:描邊跟著動畫走
    } else {
      // 鑿刻岩等 per-face 硬邊法線幾何:外殼沿面法線外推會裂縫,
      // 改用建構時附帶的平滑法線副本(userData.outlineGeo)
      shell = new THREE.Mesh(o.userData.outlineGeo || o.geometry, outlineMaterial(w));
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
    // Sprite.geometry 是 three 全域共用的一份,MUST NOT dispose(會打到全 app 的 sprite)
    if (!o.isSprite && o.geometry && !_sharedGeo.has(o.geometry)) o.geometry.dispose();
    const m = o.material;
    if (m) (Array.isArray(m) ? m : [m]).forEach((x) => x?.dispose());
  });
}
