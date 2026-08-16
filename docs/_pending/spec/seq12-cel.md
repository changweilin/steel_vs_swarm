# 序 12 / §0-b 賽璐璐量化學派切換(School B)  (key: seq12-cel)

## 摘要

現制是 School A:`toon.js` 的 `RAMPS`(2/3/4/soft)→ `toonGradient(bands)` 烤 `DataTexture` →`MeshToonMaterial.gradientMap`,而陰影偏色是把 `RAMP_PATCHED` 塞進 three 的 `gradientmap_pars_fragment`、以 `celRampDepth(celG)` 當權重、乘上亮度中性的 `shadowTintRGB()`。School B 要的是「累積直接光 → `smoothstep` 硬切 → 暗側換色相」,而**這件事恰好落在同一個錨點上**:把 `RAMP_HOOK` 那一行從「查 ramp 貼圖」換成「回傳線性 `saturate(dotNL)`」,`reflectedLight.directDiffuse` 就自動變成「已乘過陰影遮罩與燈色的累積直接光」,再在既有的 `#include <opaque_fragment>` 前置區塊裡重組 `outgoingLight`。⇒ **不需要新增任何 three chunk 錨點**,兩個既有錨點就夠。落地方式建議做成 `visualPrefs` 的 `celSchool` 旋鈕(預設 `ramp` = 舊制),而且它與 `shadow` 同類 —— **模組載入時定案一次**(同 `installWorldCurve` 的 `?curve=0`),不是每幀可切的共享 uniform:這樣 School A 這條路徑吐出的 GLSL 字串**逐字不變**,`RAMPS` / `audit_cel_pipeline` Ⅰ / `audit_visual_prefs` Ⅱ 全部原封不動,風險從「高」降到「opt-in」。四件本輪查出來、與計畫書不同的事實另見 risks/blockedOn:①`PCFSoftShadowMap` **已經在用**(game.js:697),這一條沒有工作、只有檔頭與稽核要補;②`biomes.js` 有 **5 處裸 `MeshToonMaterial`** 繞過補丁,School B 一開就是「同一棵樹的葉子硬切、樹幹漸層」——而 A14 第二句其實早就禁止它們;③messenger 的 School B 片段沒有日夜循環,直接照抄會讓暗側變成與太陽強度無關的常數,`DAYCLOCK` 那一整套在畫面上**靜默失效**而每一條斷言全綠 ⇒ MUST 補一個主光色/強度的共享 uniform;④A14 的等價保證要寫成「`SHADOW_V ≥ rampFloor(3)`(推導)+ 暗側亮度恆 = `SHADOW_V × 亮側亮度`(恆等式)」。

## 縫

### RAMPS 明暗階梯表(A14 的 102 唯一的家)
`public/js/toon.js:203`

現行:
```js
// A14 / #INC-106:每一組的**暗階 MUST ≥ 102** —— 低於此深色物件疊上 cool 會塌成全黑。
const RAMPS = {
  2: [102, 255],
  3: [102, 182, 255],
  4: [102, 158, 206, 255],
  soft: [190, 255],
};
```

**改成**: **一格不動**(旋鈕預設仍是 School A,`toonGradient`/`rampFloor`/audit Ⅰ 全部照舊)。它在新制裡的新角色是 `CEL_CUT.SHADOW_V` 的**推導來源** —— 102 這個數只准有一份家。

### 新增:硬切硬度表 CEL_CUT(bands 的第二個語意)
`public/js/toon.js:225`

現行:
```js
export function toonGradient(bands = 3) {
  const key = RAMPS[bands] ? bands : 3;
  …
}
// ← 緊接在這一支之後新增 CEL_CUT / cutOf(bands),與 rampFloor 的 fallback 規則逐字相同
```

**改成**: 新增 `export const CEL_CUT = { 2:[0.10,0.15], 3:[0.20,0.40], 4:[0.26,0.54], soft:[0.30,0.70], SHADOW_V: 0.5, HUE_MIN_A: 1 }` + `export function cutOf(bands = 3)`(未知鍵回 3,與 `toonGradient`/`rampFloor` 同一條 fallback)。`bands` 的語意從「幾階」變成「硬度」:2 最硬 → soft 最軟,**帶寬 MUST 嚴格遞增**(2<3<4<soft),這是把 School A「階數越多層次越多」翻譯成 School B「唯一那一刀越寬」的唯一合法映射。`SHADOW_V` MUST ≥ `rampFloor(3)`(= 102/255),由稽核守門。

### 陰影偏色的色相方向(School B 沿用,不另開一份)
`public/js/toon.js:254`

現行:
```js
const SHADOW_HUE = [0.86, 0.93, 1.10];      // 天光藍綠(與 postfx GRADE.SHADOW 同方向)
const LUMA_709 = [0.2126, 0.7152, 0.0722];
const SHADOW_HUE_N = (() => { … return SHADOW_HUE.map((c) => c / l); })();
const TINT_MAX_A = 3;
export function shadowTintRGB(amount) {
  const a = Math.min(TINT_MAX_A, Math.max(0, amount || 0));
  return SHADOW_HUE_N.map((c) => 1 + (c - 1) * a);
}
```

**改成**: **一行不改**。計畫說「逐材質 tint 色值轉成色相偏移量,MUST 保留逐材質可調」——這一支就是那個轉換點:School B 的暗側色 = `亮側 × shadowTintRGB(a)` 再把亮度重正規化回 `SHADOW_V × 亮側亮度`。⇒ 色相仍由 `SHADOW_HUE` 一份表決定、仍分 mech/env 兩軌、仍由兩根既有拉桿驅動,而 `rgb2hsv/hsv2rgb` **不必寫**(見 risks:字面 HSV 旋轉不保 Rec.709 亮度,那正是 A14 存在的理由)。School B 下 `a` MUST 取 `max(拉桿, CEL_CUT.HUE_MIN_A)` —— 兩根拉桿預設 0,不設下限的話 School B 出貨就是灰陰影(SKILL 說的『關鍵的那 20%』整個沒開)。

### 學派切換的唯一分岔點:ramp 查表那一行
`public/js/toon.js:283`

現行:
```js
const RAMP_HOOK = 'return vec3( texture2D( gradientMap, coord ).r );';
const RAMP_CHUNK = 'gradientmap_pars_fragment';
const RAMP_INC = `#include <${RAMP_CHUNK}>`;
```

**改成**: 錨點與守衛**一格不動**。`RAMP_PATCHED` 改成由 `_school` 選兩份替換文字之一:School A = 現有那一段(逐字不變);School B = `{ float celG = saturate( dotNL ); return vec3( celG ); }`。⚠ `dotNL` 是 three r160 `getGradientIrradiance()` 內的既有區域變數 —— **實作前 MUST 把 r160 的 `gradientmap_pars_fragment` 原文抓出來核對**(`chunk.includes(RAMP_HOOK)` 這道守衛已經在,對不上就走 `uCelRampFb` 落地路徑,原則 6 不變)。這一步之後 `reflectedLight.directDiffuse` = Σ dotNL·燈色·**陰影遮罩**·albedo/π ——「投影遮蔽與 N·L 被同一刀量化」這件 School B 唯一買得到的東西,是這一行的直接推論。

### 偏色權重函式(School B 的權重改由硬切自己給)
`public/js/toon.js:306`

現行:
```js
const RAMP_DEPTH_FN = `
  float celRampDepth( float g ) {
    return clamp( ( g - uCelRampLo ) / max( 1e-3, 1.0 - uCelRampLo ), 0.0, 1.0 );
  }`;
const RAMP_PATCHED = (() => {
  const chunk = THREE.ShaderChunk?.[RAMP_CHUNK];
  if (typeof chunk !== 'string' || !chunk.includes(RAMP_HOOK)) return null;
  return chunk.replace(RAMP_HOOK, `…mix( uCelRampTint, vec3( 1.0 ), celRampDepth( celG ) );`);
})();
```

**改成**: `celRampDepth` / `uCelRampLo` / 落地保險 **全部留著**(School A 仍是預設路徑,`audit_visual_prefs` Ⅱ 的 20 條斷言一條都不能動)。School B 的等價權重是 `1 − celCut`(0 = 全亮不偏、1 = 全暗吃滿偏色)—— 語意與 `celRampDepth` 逐字相同(「這一格在陰影裡有多深」),但它是連續的、而且與那一刀同源,不會再出現「偏色的最深處」與「看得到的最暗階」分家的老坑。

### 共享 uniform 兩軌 + 拉桿同步(要加主光色與學派)
`public/js/toon.js:327`

現行:
```js
const _rampTint = {
  mech: { value: new THREE.Color(1, 1, 1) },
  env: { value: new THREE.Color(1, 1, 1) },
};
…
function syncVisualPrefs() {
  _rampTint.mech.value.setRGB(...shadowTintRGB(visualPref('shadowMech')));
  _rampTint.env.value.setRGB(...shadowTintRGB(visualPref('shadowEnv')));
  _wSpread.value = WEATHER_SPREAD * visualPref('weather');
}
```

**改成**: ①`syncVisualPrefs` 在 School B 下改吃 `shadowTintRGB(Math.max(visualPref(k), CEL_CUT.HUE_MIN_A))`,School A 逐字不變。②新增共享 uniform `_celKey = { value: new THREE.Color(1,1,1) }` = 當下主光色 × 強度(見下一列)。③**MUST NOT** 把學派做成共享 uniform:它與 `shadow` 同類(game.js:695 讀一次),做成模組載入時定案的 `_school` 常數,才拿得到「School A 吐出的 GLSL 逐字不變」這個逐位元保證。

### 主光向的唯一縫(School B 要連色與強度一起拿)
`public/js/toon.js:419`

現行:
```js
/** environment.js 建立太陽光後呼叫:記錄世界空間光向 */
export function setCelSun(pos) {
  _sunDirWorld = pos.clone().normalize();
}
…
export function updateCelLight(camera, dirWorld = null) {
  _celLightDirView.copy(dirWorld || _sunDirWorld).transformDirection(camera.matrixWorldInverse);
}
```

**改成**: `setCelSun(pos, keyColor = null, intensity = 1)` 追加兩個**選用**參數,寫進 `_celKey`;`updateCelLight(camera, dirWorld, keyRGB)` 比照 `_wField`/`_wFieldPrev` 的兩軌 idiom 加第三個選用參數給 `matsample`。理由:messenger 的 School B 片段裡亮側就是 albedo 本身,而本專案有 `DAYCLOCK` —— 照抄的話夜戰/黃昏/雨天的暗側是一個**與太陽無關的常數**,`audit_daynight` 的每一條斷言照樣全綠(它量的是資料不是像素),而畫面上只表現成「天色好像不會走了」。省略參數 ⇒ `_celKey` 恆為白 ⇒ School A 一格未動。

### cel 補丁的 opaque_fragment 前置區塊(硬切重組的落點)
`public/js/toon.js:843`

現行:
```js
      .replace('#include <opaque_fragment>', `
        {
          vec3 celV = normalize( vViewPosition );
          float celRim = 1.0 - saturate( dot( normal, celV ) );
          outgoingLight += diffuse.rgb * uCelRim * smoothstep( 0.62, 0.78, celRim );
          #ifdef CEL_METAL … #endif
          #ifdef CEL_COOL
            float celShade = smoothstep( 0.05, 0.45, dot( normal, uCelLightDir ) );
            outgoingLight = mix( outgoingLight * mix( vec3( 1.0 ), vec3( 0.86, 0.93, 1.1 ), uCelCool ), outgoingLight, celShade );
          #endif
          if ( uCelRampFb > 0.5 ) { … }
        }
        #include <opaque_fragment>
```

**改成**: 在這個區塊**最前面**(rim / metal / cool 之前)插入 School B 重組,只在 `_school === 'cut'` 時由 JS 拼進字串:
```
float celBase = celLum( diffuseColor.rgb );
float celLit  = celLum( reflectedLight.directDiffuse ) * PI / max( 1e-4, celBase );
float celCut  = smoothstep( uCelCutLo, uCelCutHi, celLit );
vec3  celOn   = diffuseColor.rgb * uCelKey;
vec3  celOff  = celOn * uCelRampTint;
celOff *= uCelShadowV * celLum( celOn ) / max( 1e-4, celLum( celOff ) );
outgoingLight = mix( celOff, celOn, celCut ) + reflectedLight.indirectDiffuse + totalEmissiveRadiance;
```
三條鐵律:①`CEL_COOL` 在 School B 下 MUST 關掉(它是舊制那條事後拌冷色,留著就是同一顆物件上兩把不同形狀的量化尺 —— SKILL 明講兩派 MUST NOT 混);②rim / metal MUST **排在重組之後**(它們是加成式演出不是打光);③`totalEmissiveRadiance` MUST 重新加回來(覆寫 `outgoingLight` 會把它吃掉,症狀是所有自發光件在夜裡熄滅)。

### 片段程式宣告區(新 uniform 與 celLum 的家)
`public/js/toon.js:901`

現行:
```js
      .replace('void main() {', `
        uniform vec3 uCelLightDir;
        uniform float uCelRim;
        uniform float uSurfId;
        uniform float uInkClass;
        …
        float celWeatherF() { … }
        void main() {`);
```

**改成**: 新增 `uniform float uCelCutLo, uCelCutHi, uCelShadowV; uniform vec3 uCelKey;` 與 `float celLum( vec3 c ) { return dot( c, vec3( … ) ); }`。**Rec.709 三個數 MUST 由 `LUMA_709`(toon.js:255)推導出字串,MUST NOT 手抄** —— 手抄的那一份會跟 `shadowTintRGB` 的正規化分家,而 A14 的亮度恆等式就是靠這兩者是同一把尺。宣告一律只在 School B 下插入(School A 的字串逐字不變)。

### onBeforeCompile 的逐材質 uniform
`public/js/toon.js:608`

現行:
```js
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uSurfId = { value: mat.userData.celSurfId };
    shader.uniforms.uInkClass = { value: land ? INK_CLASS.LAND : INK_CLASS.HARD };
    shader.uniforms.uCelLightDir = { value: _celLightDirView };
    …
    shader.uniforms.uCelRampTint = _rampTint[tint] || _rampTint.mech;
```

**改成**: School B 下追加 `uCelCutLo/uCelCutHi = cutOf(bands)`、`uCelShadowV = CEL_CUT.SHADOW_V`、`uCelKey = _celKey`(共享物件,與 `_rampTint` 同 idiom)。`uCelRampTint` **沿用同一個共享物件**(兩派共用同一份色相,不是兩份)。`customProgramCacheKey`(toon.js:966)**不必加學派**(它是模組載入時定案的全域值,一場之內不會有兩種);若日後改成可即時切換,它 MUST 進鑰匙。

### 繞過補丁的裸 MeshToonMaterial(A14 第二句早就禁止,School B 讓它變成看得見的 bug)
`public/js/biomes.js:901`

現行:
```js
    const mat = leafy
      ? toonMat(src.color…, { map: src.map || null, rim: 0, soft: { k: 'leaf', span: 1 } })
      : new THREE.MeshToonMaterial({
        color: src.color ? src.color.clone() : new THREE.Color(0xffffff),
        map: src.map || null,
        gradientMap: toonGradient(),
      });
```

**改成**: 這一支(GLB 植被的**不透明**樹幹)與另外四處透明覆蓋層(biomes.js:5067 洞頂、5158 岸邊泡沫、5183 潮間帶、7436 水簾)是全專案僅有的五處**沒吃 cel 補丁**的 MeshToonMaterial。School A 下無害;School B 下它們留在 ramp 而全世界改硬切 = 同一棵樹葉硬幹柔。改法 MUST 是**最小侵入**:新增 `toon.js export function toonPlain(params)`(= 建 MeshToonMaterial + 只掛學派重組,不掛 rim/metal/wash/moss/soft/gInfo 覆寫),School A 下它**完全不掛 `onBeforeCompile`** ⇒ 這五處逐位元同舊制。MUST NOT 順手改成 `toonMat`/`envMat`(那會加上 rim 與 gInfo 覆寫 ⇒ 折邊勾線多出線,而樹幹那一行的註解正說明 rim:0 是刻意的)。

### 旋鈕表(UI 零改動,型別由 choices 推導)
`public/js/visualPrefs.js:91`

現行:
```js
  shadow: {
    label: '日照投影', def: 'on', choices: ['off', 'on'],
    choiceLabels: { off: '關', on: '開' },
    hint: '…低功耗與觸控裝置自動走半解析度的陰影圖。',
  },
```

**改成**: 照這一列的形狀新增 `celSchool: { label: '賽璐璐明暗', def: 'ramp', choices: ['ramp','cut'], choiceLabels: { ramp: '色階(舊制)', cut: '硬切' }, hint: '…**切換後要重新開一場才生效**(與日照投影同類:它決定材質怎麼編譯,不是每幀可換的顏色)' }`。`main.renderVisualSettings`(main.js:2757-2781)整段由 `VISUAL_KNOBS` 推導 ⇒ **UI 一行都不必寫**。`def: 'ramp'` 是紀律①(預設 = 這一項不生效)。

### 陰影貼圖檔頭的取捨(PCFSoft 已在,只欠理由)
`public/js/data.js:6004`

現行:
```js
// ---- 陰影貼圖(2026-08-14 使用者「加入太陽/月亮與影子」)----
// **範圍是推導的**:先定「一個 texel 要多細」,範圍 = 貼圖邊長 × texel。…
// 沒有 cascade:框外就是沒有影子,而那是刻意的(第二張陰影圖 = 第二趟全場 render)。
export const SHADOW = {
  SIZE: 2048, SIZE_LOW: 1024,
  TEXEL_M: 0.12,
  AHEAD_F: 0.5,
  BIAS: -0.0006, NORMAL_BIAS: 0.6,
};
```

**改成**: **只改註解**(常數一格不動):補一段「投影軟硬是學派的一部分」——`PCFShadowMap` 配 School A(ramp 已經量化過,再柔化只是互相打架)、`PCFSoftShadowMap` 配 School B(那一刀會把柔化後的值重新量化 ⇒ 終端線更短更乾淨、不階梯)。⚠ 本輪實測 **game.js:697 已經是 `THREE.PCFSoftShadowMap`** ⇒ 計畫書那一條**沒有程式要改**,缺的只有「為什麼」與一條守門斷言(見 audits)。

### 陰影貼圖型別的開關處(要補一條稽核錨)
`public/js/game.js:694`

現行:
```js
    const lowGpu = lowPower() || isTouchUI();
    const shadowOn = visualPref('shadow') === 'on' && !off('shadow');
    this.renderer.shadowMap.enabled = shadowOn;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.shadowMap.autoUpdate = shadowOn;
```

**改成**: 程式**不改**。這一行現在是「沒有任何斷言在守」的狀態:有人把它換成 `PCFShadowMap` 之後 School B 的終端線會開始階梯,而每一支稽核照樣全綠。`audit_daynight` 的 Ⅴ 段(第 248 行附近已經在驗 `shadowMap.enabled`)MUST 追加一條 `shadowMap.type = PCFSoftShadowMap` 的原文斷言,並在旁邊寫下「它是 §0-b 學派的一部分」。

### A14 全文(規則與定案的正面衝突,唯一要改的架構文件)
`.claude/rules/antipatterns.md:22`

現行:
```js
| A14 | `[#INC-106]` toon 三階 ramp 暗部 MUST NOT 低於 102;材質一律走 `toon.js mat()` |
```

**改成**: 改寫成四句(編號不動、`[#INC-106]` 不動):**A14 = 賽璐璐的暗面有一條亮度地板,而且色相偏移 MUST 是亮度中性的**。①(色階路徑)`RAMPS` 每一組的暗階 MUST ≥ 102;三階 MUST 逐位元 `[102,182,255]`。②(硬切路徑,2026-08-16 §0-b)暗側的值乘數 `CEL_CUT.SHADOW_V` MUST ≥ `rampFloor(3)` —— **推導不手寫**,102 只准有一份家。③兩條路徑的色相偏移 MUST 亮度中性:色階路徑的等價式是 `luma(shadowTintRGB(a)) ≡ 1`,硬切路徑是 `luma(暗側) ≡ SHADOW_V × luma(亮側)`,對**任何**基色與**任何**拉桿值恆成立 —— 把亮度藏進色相是繞過 ①② 的後門,而畫面上只表現成深色件在暗面塌成黑塊。④材質一律走 `toon.js` 的 `toonMat`/`envMat`/`toonPlain`,MUST NOT 在別處 `new MeshToonMaterial` 繞過補丁(**兩派混在同一個場景裡 = 相鄰物件兩種終端線形狀,讀起來就是 bug**)。根 `CLAUDE.md` §3 那一列的一行索引同步改成主旨。

## 寫入檔案
- `public/js/toon.js` (edit) — 學派的唯一縫:CEL_CUT/cutOf 新表、_school 定案、RAMP_PATCHED 兩份替換文字、opaque_fragment 前置的硬切重組、celLum、新 uniform、setCelSun/updateCelLight 的主光色參數、toonPlain 新入口
- `public/js/visualPrefs.js` (edit) — 新增 celSchool 選項旋鈕(def 'ramp' = 逐位元同舊制);UI 由這張表推導 ⇒ main.js 不必改
- `public/js/environment.js` (edit) — setCelSun(_lit) 那一行(environment.js:467)改成把當下主光色與強度一起交出去 —— 就在 sun.color/sun.intensity 定案的下一行,零重算
- `public/js/biomes.js` (edit) — 五處裸 MeshToonMaterial(901 / 5067 / 5158 / 5183 / 7436)改走 toonPlain,否則 School B 一開就是兩派混場(A14 ④)
- `public/js/data.js` (edit) — **只改註解**:SHADOW 檔頭補「投影軟硬是學派的一部分」的取捨(PCFSoft 配硬切)。常數一格不動 ⇒ balanceFingerprint 不變,但仍 MUST 跑 bal/e2e 證明逐項不動
- `tools/audit_cel_pipeline.mjs` (edit) — 新增 Ⅷ 段「賽璐璐學派」:兩派各自成立、A14 等價保證、硬度階梯單調、一個場景只有一套量化、School A 逐字不變;新增 --break-school/--break-cutfloor/--break-neutral/--break-cutorder/--break-schoolmix
- `tools/audit_visual_prefs.mjs` (edit) — Ⅰ 追加 celSchool 的 def = 'ramp';Ⅱ 追加「School B 的色相下限 > 0」與「兩派共用同一份 SHADOW_HUE / 同一根拉桿」;既有 20 條 ramp 斷言 MUST 逐項不動
- `tools/audit_daynight.mjs` (edit) — Ⅴ 段追加 shadowMap.type === PCFSoftShadowMap 的原文斷言(現在完全沒有東西在守這一行)+ --break-shadowtype
- `.claude/rules/antipatterns.md` (edit) — A14 改寫成四句(編號不動);這是本項與既有規則的正面衝突,MUST 由使用者過目
- `CLAUDE.md` (edit) — §3 A 表 A14 那一列的一行索引跟著改主旨(索引與全文分家 = 憑主旨行動)
- `.claude/rules/seams-render.md` (edit) — 「賽璐璐明暗階梯」那一列改寫成兩派:縫仍是 toon.js 一份,bands 的第二個語意(硬度)、SHADOW_V 的推導、CEL_COOL 在硬切下 MUST 關、稽核指到新的 Ⅷ 段
- `.claude/rules/verification.md` (edit) — §5.5 新增一列「賽璐璐學派切換」→ 要跑什麼(含 ㋓ 基準照與 A/B 的手法);§5.1(續)的 audit_cel_pipeline 那一行補上五支新 --break-*
- `docs/anime_style_plan.md` (edit) — 執行紀錄追加序 12;並更正計畫本文兩處:PCFSoftShadowMap 已在用(只剩檔頭與斷言)、以及 School B 在有日夜循環的專案裡 MUST 額外帶主光色(messenger 的片段沒有這一維)

## 步驟
1. **步驟 0(MUST 第一件事,不動任何程式碼):拍改制前基準照。** `node tools/shot_scene.mjs --venue taroko --team 1` 與 `--venue shibuya --team 1` 各一組(山區 + 市區),再各加一組 `--pref inkMrt=on --pref lutSrc=baked --pref shadowMech=1 --pref shadowEnv=1`(預設值全是「不生效」⇒ 折邊勾線 / LUT / 空氣透視 / **陰影偏色** 在定場照裡本來一張都拍不到,而陰影偏色正是本項要換掉的東西);另加 `--time dusk --elapsed 300` 與 `--time night` 各一輪(暗側在日夜循環上的行為是本項最容易靜默壞掉的一維)。`--pref` 的值會進檔名後綴 ⇒ 幾輪不會互相覆寫。**把每一輪的 `meta*.json` 一起留著** —— 下一步的對照 MUST 用 `--stations <meta.json>` 回放同一組機位。md5 全表存進 scratchpad。
2. 確認 three r160 的 `gradientmap_pars_fragment` 原文:把 `RAMP_HOOK` 那一行前後抓出來,核對 `dotNL` 這個區域變數名與 `#ifdef USE_GRADIENTMAP` 的分支結構。對不上就**停下來報告**(`RAMP_PATCHED` 的守衛會讓補丁靜默失效,而症狀是「硬切拉了沒反應」)。
3. toon.js:新增 `CEL_CUT` + `cutOf(bands)`(緊接 `toonGradient` 之後),並在同一段寫下 `SHADOW_V ≥ rampFloor(3)` 的理由(A14 ②)。此步可單獨驗:`audit_cel_pipeline` 新 Ⅷ 的「硬度階梯嚴格遞增 + SHADOW_V 推導守門」兩條先綠。
4. visualPrefs.js:新增 `celSchool`(def `'ramp'`)。單獨驗:`audit_visual_prefs` Ⅰ 全綠、`visualPrefsDefault()` 仍為 true、設定頁自動長出一組分段鈕(㋕ 開一次大廳看)。
5. toon.js:加入 `_school` 的定案(模組載入時讀 `visualPref('celSchool')` 與 `?cel=` query,與 `installWorldCurve` 讀 `?curve=0` 同一個 idiom),並把 `RAMP_PATCHED` 改成依 `_school` 選兩份替換文字之一。**此時 School A 那一份 MUST 與現有字串逐字相同**(用一個具名常數 `RAMP_PATCH_A` 裝著,稽核直接比對)。單獨驗:`--pref celSchool=ramp` 的定場照與步驟 0 的 md5 全同。
6. toon.js:`setCelSun` / `updateCelLight` 追加主光色參數 + `_celKey` 共享 uniform;environment.js:467 那一行改成 `setCelSun(_lit, sunC, sun.intensity)`。**省略參數 ⇒ 白 ⇒ School A 一格未動**。單獨驗:`audit_daynight` 逐項不動。
7. toon.js:在 `#include <opaque_fragment>` 前置區塊**最前面**插入 School B 重組(只在 `_school === 'cut'` 時拼進字串),同時把 `CEL_COOL` 那一段包進 `_school === 'ramp'` 的 JS 條件裡,並確認 rim / metal 排在重組之後、`totalEmissiveRadiance` 有重新加回來。宣告區加 `celLum` 與四個新 uniform(Rec.709 三個數由 `LUMA_709` 推導成字串)。
8. toon.js:`syncVisualPrefs` 在 School B 下把兩根偏色拉桿夾上 `CEL_CUT.HUE_MIN_A` 下限;`onBeforeCompile` 追加三個逐材質 uniform + `uCelKey`。
9. toon.js 新增 `toonPlain(params)`(School A 下不掛 `onBeforeCompile` ⇒ 完全等於今天的裸 MeshToonMaterial);biomes.js 五處改走它。單獨驗:`--pref celSchool=ramp` 的定場照 md5 仍與步驟 0 全同(這是「最小侵入」有沒有做到的唯一證據)。
10. ㋓ 第一次 A/B:同一組 `--stations meta.json` 回放,拍 `--pref celSchool=cut` 的全套(含 dusk / night 兩輪)。**先看三件事**:①夜戰的暗側有沒有跟著天色走(沒有 = `uCelKey` 沒接上);②同一棵樹的葉與幹是不是同一種終端線(不是 = 還有裸材質);③地形(bands 4)的坡面剩幾條線(這是 blockedOn ③ 要使用者裁決的那一項)。
11. 補稽核:`audit_cel_pipeline` 新 Ⅷ 段 + 五支 `--break-*`;`audit_visual_prefs` Ⅰ/Ⅱ 追加三條;`audit_daynight` 追加 `shadowMap.type` 一條 + `--break-shadowtype`。**每一支 break MUST 真的改原文再驗,替換無效 MUST 當場 exit(§5.4 ㋑;含 `\r?\n` 容忍)**。
12. 文件:A14 改寫(`.claude/rules/antipatterns.md` + 根 `CLAUDE.md` §3 索引)、`seams-render.md` 的「賽璐璐明暗階梯」那一列、`verification.md` 兩處、`docs/anime_style_plan.md` 執行紀錄與兩處更正。
13. 全批回歸(見 audits),最後把 School A / School B 兩組定場照與 md5 表交出去給使用者做美術方向裁決 —— 這一項的驗收面是**圖**,不是斷言。

## 稽核
- `node tools/shot_scene.mjs --venue taroko --team 1                                   # ㋓ 步驟 0 基準(改任何一行程式之前)`
- `node tools/shot_scene.mjs --venue taroko --team 1 --pref inkMrt=on --pref lutSrc=baked --pref shadowMech=1 --pref shadowEnv=1`
- `node tools/shot_scene.mjs --venue taroko --team 1 --time dusk --elapsed 300`
- `node tools/shot_scene.mjs --venue taroko --team 1 --time night`
- `node tools/shot_scene.mjs --venue shibuya --team 1`
- `node tools/shot_scene.mjs --venue taroko --team 1 --stations tools/.shots_scene/taroko/meta.json --pref celSchool=cut   # ㋓ A/B(同一組機位回放)`
- `node tools/audit_cel_pipeline.mjs`
- `node tools/audit_cel_pipeline.mjs --break-school`
- `node tools/audit_cel_pipeline.mjs --break-cutfloor`
- `node tools/audit_cel_pipeline.mjs --break-neutral`
- `node tools/audit_cel_pipeline.mjs --break-cutorder`
- `node tools/audit_cel_pipeline.mjs --break-schoolmix`
- `node tools/audit_cel_pipeline.mjs --break-scale`
- `node tools/audit_cel_pipeline.mjs --break-inkinfo`
- `node tools/audit_cel_pipeline.mjs --break-land`
- `node tools/audit_cel_pipeline.mjs --break-lutland`
- `node tools/audit_visual_prefs.mjs`
- `node tools/audit_daynight.mjs`
- `node tools/audit_daynight.mjs --break-shadowtype`
- `node tools/audit_daynight.mjs --break-clock`
- `node tools/audit_daynight.mjs --break-fade`
- `node tools/audit_daynight.mjs --break-elev`
- `node tools/audit_daynight.mjs --break-cockpit`
- `node tools/audit_daynight.mjs --break-range`
- `node tools/audit_soft_stroke.mjs`
- `node tools/audit_gpu_lifecycle.mjs`
- `node tools/audit_world_curve.mjs`
- `node tools/audit_client_syntax.mjs`
- `node tools/audit_client_syntax.mjs --break-glsl`
- `node tools/audit_ground_tile.mjs`
- `node tools/audit_ground_seam.mjs`
- `node tools/audit_ground_enclave.mjs`
- `node tools/audit_ground_qc.mjs`
- `node tools/audit_ground_border.mjs`
- `node tools/audit_siteplan.mjs`
- `node tools/audit_beacons.mjs`
- `node tools/audit_object_joints.mjs --seeds 8`
- `node tools/audit_open_tunnel.mjs`
- `node tools/audit_underpass.mjs`
- `node tools/audit_road_joint.mjs`
- `node tools/audit_world_text.mjs`
- `node tools/audit_layer_block.mjs`
- `node tools/audit_ui_layout.mjs`
- `node tools/audit_ctrl_mode.mjs`
- `npm run audit:net`
- `node tools/audit_solo_boot.mjs`
- `npm run bal`
- `npm test   # MUST 先照 §5.2 重啟伺服器`

## 反向驗證
- `--break-school` — 壞版: 把 School B 的 `RAMP_PATCH_B`(回傳線性 `saturate(dotNL)`)換回 School A 的 ramp 查表原文,並把 opaque_fragment 前置的硬切重組整段刪掉 ⇒ **MUST 紅**: audit_cel_pipeline Ⅷ:①『School B 的 ramp hook 回傳線性 N·L(不是查表)』②『硬切吃 reflectedLight.directDiffuse 且與 uCelCutLo/Hi 同源』③『outgoingLight 在硬切路徑被重組』—— 三條 MUST 全紅,而 Ⅰ 的 ramp 斷言與 audit_visual_prefs Ⅱ MUST 仍全綠(它們守的是仍在服役的 School A 路徑)
- `--break-cutfloor` — 壞版: 把 `CEL_CUT.SHADOW_V` 從 `0.5` 改成手寫 `0.25`(< 102/255) ⇒ **MUST 紅**: audit_cel_pipeline Ⅷ『A14 等價地板:SHADOW_V ≥ rampFloor(3)』MUST 紅(這就是 A14 在硬切路徑上的那一句)
- `--break-neutral` — 壞版: 拿掉暗側色的亮度重正規化那一行(`celOff *= uCelShadowV * celLum(celOn) / max(1e-4, celLum(celOff))`),改成 `celOff = celOn * uCelRampTint * uCelShadowV` ⇒ **MUST 紅**: audit_cel_pipeline Ⅷ『暗側亮度恆 = SHADOW_V × 亮側亮度(4096 組基色 × 全拉桿值域,誤差 < 1e-9)』MUST 紅 —— 這是 A14 ③『色相偏移 MUST 亮度中性』在硬切路徑的等價式,少了它就是把亮度藏進色相的後門
- `--break-cutorder` — 壞版: 把 `CEL_CUT` 的 `4` 改成比 `3` 更窄的帶(例如 `[0.30, 0.36]`) ⇒ **MUST 紅**: audit_cel_pipeline Ⅷ『硬度階梯嚴格遞增(2 < 3 < 4 < soft 的帶寬與中點)』MUST 紅 —— `bands` 從「幾階」翻譯成「多硬」之後,唯一還撐得住的不變式就是這個序;它一破,既有四個 `bands:` 呼叫端(terrain ×2 / worldtext / matsample)的語意就全反了
- `--break-schoolmix` — 壞版: 把 biomes.js 其中一處(建議 901 那個不透明樹幹)改回裸 `new THREE.MeshToonMaterial({ gradientMap: toonGradient() })` ⇒ **MUST 紅**: audit_cel_pipeline Ⅷ『一個場景只有一套量化:public/js 下沒有任何繞過 toon.js 的 MeshToonMaterial』MUST 紅(A14 ④)。這一支同時是「同一棵樹葉硬幹柔」那個病灶唯一量得到的地方
- `--break-shadowtype` — 壞版: 把 game.js 的 `this.renderer.shadowMap.type = THREE.PCFSoftShadowMap` 換成 `THREE.PCFShadowMap` ⇒ **MUST 紅**: audit_daynight Ⅴ『投影型別是 PCFSoftShadowMap(§0-b 學派的一部分:硬切會把柔化後的值重新量化 ⇒ 終端線更短更乾淨)』MUST 紅。現況這一行**沒有任何斷言在守**,換掉之後全套稽核照樣全綠而終端線開始階梯
- `(無旗標,GPU 層)` — 壞版: 把 `--pref celSchool=ramp`(或預設)那一輪的定場照與**改制前**的基準照比 md5 ⇒ **MUST 紅**: MUST **全同**。任何一張不同 = School A 的 GLSL 字串不是逐字不變(最可能的犯人:toonPlain 多掛了 onBeforeCompile、或宣告區在 School A 下也插了新 uniform)

## 會靜默壞掉的地方
- **照抄 messenger 的片段 = 日夜循環靜默失效。** 它的 `outgoingLight = mix(colorShadow, baseColor, shadowCut)` 兩端都是**albedo**,與太陽強度無關 ⇒ 夜戰、黃昏、雨天的暗側變成一個常數,`DAYCLOCK`/`TIMES`/`WEATHERS` 那一整套在畫面上不再作用,而 `audit_daynight` 每一條斷言照樣全綠(它量的是 `clockHour`/`sunDirAt` 的數,不是像素)。故 `uCelKey`(主光色 × 強度)是 MUST,不是加分項。
- **cut 的輸入若吃 albedo,深色件會整台泡在陰影裡。** messenger 用 `reflectedLight.directDiffuse.r` 當 `totalShadow`,那是含 albedo 的量;本專案的機體塗裝從 0x0a 到 0xff 都有 ⇒ 深色裝甲永遠跨不過 0.20 那道門檻,看起來像「這台機體永遠背光」。本規格把 albedo 除掉(`celLum(directDiffuse) * PI / celLum(diffuseColor.rgb)`),代價是**彩度很高的基色**上這個比值是近似而非恆等(誤差二階、單調)—— 要精確就得再補一個 three 錨點(改 `lights_toon_pars_fragment` 的 `RE_Direct_Toon` 累加一個純光量的全域),多一個要逐版核對的錨點,不建議。
- **bands = 4 的『中間那一階』在硬切下消失。** `RAMPS` 的註解寫著 4 階存在的理由是「大型結構(地形/建物量體):中間多一階,坡面才有轉折」;一刀只有一個終端 ⇒ 整片山坡回到兩塊色。本規格把它翻譯成「更寬的帶」,但那是**軟化**不是**多一階**。要保住只有兩條路:①再加一刀(= 把量化階數偷渡回硬切,兩派又混了)②靠地貌/材質的色階梯撐(SKILL L2 的立場:「direct light cannot shape a gentle slope, only material value can」)。這是 blockedOn ③。
- **CEL_COOL 沒關掉 = 同一顆物件上兩把量化尺。** `envMat` 預設帶 `cool: 0.5`(toon.js:1005),它自己有一條 `smoothstep(0.05, 0.45, dot(normal, uCelLightDir))` 的終端。與硬切並存的話,地形/建物上會出現兩條位置不同的明暗界,而它讀起來就是「渲染壞了」。稽核 MUST 直接釘住「硬切路徑下 CEL_COOL 不進字串」。
- **rim / metal / totalEmissiveRadiance 的順序。** 重組是**覆寫** `outgoingLight`,寫在 rim/metal 之後就把它們吃掉(演出消失)、忘了加回 `totalEmissiveRadiance` 就是全場自發光件在夜裡熄滅 —— 兩者都不報錯。
- **`uCelRampFb` 落地保險在 School B 下語意變了。** 它現在的意思是「ramp 替換失敗 ⇒ 走手寫斜坡補偏色」。School B 下替換失敗 = 拿到的是**量化過**的 ramp 值餵給硬切 ⇒ 一刀切在階梯上,終端線變成鋸齒。MUST 在 School B 下把替換失敗當成**退回 School A**(原則 6:寧缺勿錯),而不是硬切一個量化過的量。
- **逐位元中性只在『同一支程式』的前提下成立。** 本規格靠「School A 的 GLSL 字串逐字不變」拿保證,所以任何一個在 School A 下也插進去的字元(多一行 uniform 宣告、多一個空白)都會讓 `customProgramCacheKey` 之外的東西改變。稽核 MUST 用具名常數 `RAMP_PATCH_A` 直接比對,GPU 層 MUST 用 md5 收尾 —— 只驗原文不夠。
- **`_school` 讀 localStorage 的時機。** `toon.js` 在模組載入時就跑 `installWorldCurve()`;`_school` 也要在那個時點定案。但 `visualPrefs.js` 是零 import 且在自己載入時就讀完 localStorage,順序上安全。⚠ 定場鏡頭組是**先種 localStorage 再載頁面**(shot_scene 的 `--pref`),所以 `--pref celSchool=cut` 拍得到;但**設定頁當場切換不會生效**,hint 必須寫明「重新開一場」,否則就是「拉了沒反應」的老坑。
- **兩派混場的第六個來源:GLB 走 `toonify()`。** toon.js:1048 的 `toonify` 對 `m.isMeshToonMaterial` 直接 `return m`(不補丁)。目前的英雄機體已全部走 forge、不吃 GLB(A 表/退場清單),但世界物件仍可能經過它 ⇒ 稽核那一條「沒有裸 MeshToonMaterial」要連 `toonify` 的早退分支一起看。
- **`shot_scene` 的『13 張』不是常數。** 機位是推導的(兵線數 / 有沒有隧道 / 有沒有橋 / 有沒有水 / 有沒有庫節點量體),13 是 2026-08-13 那一輪 taroko 的張數。基準與對照 MUST 用**同一個 `--venue`/`--team`**,而且優先用 `--stations meta.json` 回放 —— 否則兩輪站在不同的地方拍不同的樹,而檔名一模一樣。

## 逐位元中性

"**旋鈕關著(`celSchool = 'ramp'`,預設)時逐位元同舊制,而且證據分三層。** ①**結構層**:學派是**模組載入時**定案的 JS 常數 `_school`(同 `installWorldCurve` 讀 `?curve=0`),所有 School B 的東西都包在 `if (_school === 'cut')` 的字串拼接裡 ⇒ School A 走的是**同一份 GLSL 原始碼**,不是「同一支程式裡的另一條分支」——連 `mix`/`select` 造成的浮點重排都不存在。`RAMPS` / `toonGradient` / `rampFloor` / `celRampDepth` / `RAMP_PATCHED` / `_rampTint` / `shadowTintRGB` / `TINT_MAX_A` 一格未動,`customProgramCacheKey` 不變。②**原文層**:School A 那一份替換文字裝進具名常數 `RAMP_PATCH_A`,稽核直接比對它與交付前的字串逐字相同;`audit_cel_pipeline` Ⅰ 的 7 條 ramp 斷言與 `audit_visual_prefs` Ⅱ 的 20 條偏色斷言**一條都不修改、MUST 全綠** —— 它們就是「舊制還在原地」的證人。③**GPU 層**(這一層才是決定性的,同 LUT / 空氣透視那兩輪的手法):步驟 0 的基準照與改完之後 `--pref celSchool=ramp` 的同一組回放照,**md5 逐張全同**;至少要涵蓋 taroko(山)+ shibuya(市)× {預設、`inkMrt=on lutSrc=baked shadowMech=1 shadowEnv=1`、dusk+elapsed、night} 四種組合,因為陰影偏色與折邊勾線在預設值下**一張都拍不到**。④**權威層**:`data.js` 只改註解、`sim.js` / `server/**` 一行未動 ⇒ `npm run bal` 與 `npm test` MUST **逐項不動**(動了就是純表現層漏進判定)。⑤旋鈕打開(`'cut'`)**明知不是中性**:13 張定場照全變,那正是這一項要交給使用者看的東西 —— 所以步驟 0 的基準照是這份規格的第一步,不是最後一步。"

## 卡在
- **使用者裁決①:旋鈕 vs 硬切。** 本規格建議做成 `celSchool` 旋鈕(預設舊制)—— 這樣 `RAMPS` 與 `audit_cel_pipeline` Ⅰ / `audit_visual_prefs` Ⅱ 全部原封不動,風險從『高』降到 opt-in,而且兩派可以並排比對再由使用者定案。**代價是計畫書 §0-b 那句『反向驗證:把 shadowCut 換回 ramp 查表,ramp 斷言 MUST 紅字』在旋鈕制下講不通**(舊斷言守的是仍在服役的 School A,本來就該綠)—— 反向驗證改成新 Ⅷ 段的 `--break-school`。若使用者要的是**真的換掉**(刪 RAMPS / 刪 toonGradient / 刪 celRampDepth),那 Ⅰ 與 Ⅱ 兩段共 27 條斷言要整批重寫、A14 ① 要刪掉而不是並存,工作量與風險都是另一個量級。
- **使用者裁決②:School B 的預設色相量 `CEL_CUT.HUE_MIN_A`。** 兩根偏色拉桿的 def 是 **0**(visualPrefs 紀律①:預設 = 這一項不生效),照搬到 School B 就是**灰色陰影** —— 而 SKILL 明講色相位移是『關鍵的那 20%』,少了它整個換學派的收益歸零。本規格提議在硬切路徑上夾一個下限 `HUE_MIN_A = 1`(拉桿仍可往上到 3),但『下限多少』是美術方向,MUST 由使用者看過兩組定場照再定。
- **使用者裁決③:`bands = 4` 的中間那一階要不要補回來。** 見 risks 第 3 條:硬切只有一個終端,整片山坡回到兩塊色。三條路(維持兩塊色 / 再加一刀 / 靠地貌色階梯撐)各有代價,MUST 由使用者看 `hilltop` 與 `aerial` 兩張定場照裁決。
- **使用者裁決④:A14 的改寫措辭。** A 表是架構文件、編號被 `siteplan.js`/`prompt.mjs`/`sim.js`/各稽核交叉引用。本規格提的四句版本保留 `[#INC-106]` 與編號、只把『三階 ramp 暗部 ≥ 102』升格成『暗面亮度地板 + 色相偏移亮度中性』的兩條路徑版本。改 A 表 MUST 使用者過目。
- **需真瀏覽器(㋓):** 步驟 0 的基準照與所有 A/B 都要 Playwright(`tools/pw.mjs`;沒裝就印一行說明並以 0 結束)。本項的**驗收面是圖不是斷言** —— 離線稽核只驗得到『規則寫對了』,驗不到『它好不好看』。另需 ㋕ 真機開一場:洞內(隧道/地下道)在硬切下會平成一塊黑,那是序 12b(⑨ 立體結構的 emissive)要解的,但**它依賴本項先落地**。
- **與序 12b 的順序:** ⑨ 立體結構重新渲染(材質 / MRT / 貢獻 / emissive 五件)MUST 跟在本項之後、同一輪交付 —— 洞內照明的問題是 School B 造成的,分兩輪交付會有一輪的『隧道裡全黑』出貨。
- **與序 3(①-1 `outlineContribution` / §0-c 打包)正交、可並行**,但兩者都改 `toon.js` 的**同一個** `opaque_fragment` 前置區塊與同一段宣告區 ⇒ **檔案級衝突**。建議序 3 先落(它已經量測完、編碼已定案),本項在它之上做。
