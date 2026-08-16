# 序 4 / ①-2 雜訊斷線 + ①-4 深度門檻擇一 + ①-3 遮罩折進 surfaceId + ①-5 LUT 斷言  (key: seq4-ink-noise)

## 摘要

四條裡只有兩條該在這一輪落地。①-2(雜訊斷線)MUST 做在**寫入端**:局部座標不必travel到螢幕空間 pass —— 本專案早就有一條逐像素通道「場景 RT 的 alpha ≡ 勾線門檻倍率」(`toon.js` 檔頭 443~464 的軟性物質契約),斷線只是在同一個寫入點多乘一個因子,`postfx.js` **一行都不用改**(讀取端的 `soft = min(5 taps)` 與 `smoothstep(EDGE0, EDGE1, ae*soft)` 天生就吃它);錨點沿用 `CEL_WP`/`CEL_PAINT` 已有的 idiom,取 `mat3(modelMatrix) * transformed`(丟掉平移 ⇒ 走路時缺口不動、轉身時黏在裝甲板上),機體/環境兩軌沿用既有的 `tint: 'mech'|'env'` 分類(= `_rampTint` 那條已存在的軸,不新增名冊)。①-4(深度門檻吃中心法線 z)**建議不換,維持 `INK.K_S`**:量出來兩條曲線在任何單一係數下都配不起來(K_S 版在掠射 2° 給 11.7× 門檻、45° 只給 1.37×;`1−n.z` 上界恆為 `1+K_N`,配 2° 就把 45° 斜面推到 3.1 倍過度抑制,配 45° 就在近地平線只剩 0.30 倍),而且 `1−n.z` 只有 MRT 開著時拿得到 —— 而 `inkMrt` **預設關**、WebGL1 沒有 ⇒ 換過去等於預設組態完全失去掠射抑制(= postfx.js:517 記載的「整片山坡畫滿等高線」病灶)。這一輪只落地「掠射抑制項恰一項、MUST NOT 疊」的斷言 + `--break-graze`。①-3(遮罩折進 surfaceId)**不落地,提請裁決**:它與 2026-08-13 使用者定案「勾線不針對地貌作用、不要看出地貌拼圖接縫」和 2026-08-11「兩側若是相同地貌則不需要分界線」正面相反,而且「這條地面界線該不該有線」在本專案**已經有唯一縫** `ground.js borderKindOf`(A 表 §2.1 G),再開一條 ink 判定就是第二份實作(原則 2);規格與撞號算術已備妥(唯一不撞號的編碼是 `k/64` 整數格,見 seams),使用者說 yes 就能一輪做完。①-5 純補斷言(現況:全專案對 LUT 只有「地貌分支」那三條,「取代不疊加」一條斷言都沒有)。

## 縫

### 軟性物質的 alpha 契約(= 斷線要騎的那條通道)
`public/js/toon.js:443`

現行:
```js
// ---- ① 細勾線怎麼傳到勾線 pass ----
// 世界的線由 `postfx.js` 的**螢幕空間** pass 一次蓋全場…螢幕空間 pass 天生不認識
// 「這個像素是什麼東西」⇒ 必須有一條逐像素的通道。**通道 = 場景 RT 的 alpha**:
//
//     場景 RT 的 alpha ≡ 這一格的**勾線門檻倍率**(1 = 硬性,< 1 = 軟性 ⇒ 線更細)
//
// 未標軟性的材質一律不碰 alpha ⇒ `INK_SOFT_A` 以外的每一個像素**逐位元同舊制**。
const INK_SOFT_A = 0.3;
```

**改成**: 在 `INK_SOFT_A` 正下方新增 `export const INK_BREAK = { SPAN_ENV: 3.0, SPAN_MECH: 0.45, CUT: 0.42, LO: 0.12 }` 與共享 uniform `const _inkBreakA = { value: 0 };`,並把檔頭這一段的契約改寫成「alpha ≡ 兩個因子的乘積:軟性(這是什麼材質)× 雜訊斷線(這一格的筆抬起來了沒有)」,寫入點仍**恰一處**。

### alpha 的唯一寫入點(斷線因子要乘在這裡)
`public/js/toon.js:881`

現行:
```js
        #ifdef CEL_SOFT
        // 場景 RT 的 alpha ≡ 這一格的**勾線門檻倍率**(見檔頭「軟性物質」段的契約)。
        // MUST 排在 opaque_fragment **之後**:那一段的 `#ifdef OPAQUE diffuseColor.a = 1.0`
        // 會把先寫的值蓋掉。之後的 colorspace / fog / dithering 都只動 rgb,寫在這裡最穩。
        gl_FragColor.a = uSoftInk;
        #endif
```

**改成**: 改成 `#ifdef CEL_INKA` / `gl_FragColor.a = uSoftInk * celInkBreak();` / `#endif`。`CEL_INKA` = 「這份材質是不透明的 cel 材質」(涵蓋原本 CEL_SOFT 的全部集合 + 硬性件),`uSoftInk` 對非軟性件恆 1 ⇒ 舊行為是新式的特例。仍然**恰一處寫入**。

### 斷線的錨點:既有的兩個 idiom(世界座標 / 靜止姿勢局部座標)
`public/js/toon.js:768`

現行:
```js
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
```

**改成**: 在 `#ifdef CEL_LAND_N` 那一段(789 行)之前插入 `#ifdef CEL_INKB` 區塊:`vec4 ibP = vec4( transformed, 1.0 ); #ifdef USE_INSTANCING ibP = instanceMatrix * ibP; #endif vCelInkP = mat3( modelMatrix ) * ibP.xyz;`。**MUST 是 `mat3(modelMatrix)` 不是 `modelMatrix`** —— 丟掉平移那一欄就是「走一步缺口不在身上游動」的全部理由(等價於 CEL_PAINT 註解那句 never makes the pattern swim);轉動仍跟著跑 ⇒ 缺口黏在裝甲板上;instanceMatrix 收進來 ⇒ 同款植被逐株不同(而且對靜態實例它退化成世界座標)。地形的 modelMatrix ≈ 單位陣、position 就是世界 XZ ⇒ 同一條式子對地形自動是世界空間,不需要第二份。

### 斷線要用的雜訊:唯一縫,但目前被關在 CEL_WP 之下
`public/js/toon.js:925`

現行:
```js
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
```

**改成**: 把 `celHash` / `celNoise` **原文一字不動**提到 `#ifdef CEL_WP` 之外(`varying vec3 vCelWP;` 留在 ifdef 內),讓 `celInkBreak()` 用同一支雜訊。MUST NOT 為斷線另寫第二支 hash —— 兩份雜訊在同一個場景裡就是「地形的斷點與機體的斷點是兩種花紋」而沒有錯誤訊息。新增 `float celInkBreak()`(見 steps)寫在它下面。

### 軟性/不透明閘(斷線的 define 要掛在同一道閘上)
`public/js/toon.js:588`

現行:
```js
  const inkable = !!sk && !mat.transparent;
  if (inkable) defines.CEL_SOFT = '';
```

**改成**: 下面補 `const inkAlpha = !mat.transparent; if (inkAlpha) { defines.CEL_INKA = ''; defines.CEL_INKB = ''; }`。閘與 `inkable` **同一條理由**(半透明件的 alpha 是不透明度,寫勾線倍率就是把水面從 0.82 改成 0.30);`CEL_SOFT` 自此只剩「這份材質軟不軟」一個語意。

### 逐材質 uniform(軌選擇沿用既有的 mech/env 軸,不新增名冊)
`public/js/toon.js:613`

現行:
```js
    shader.uniforms.uSoftInk = { value: inkable ? INK_SOFT_A : 1 };
```

**改成**: 這一行的宣告從 `#ifdef CEL_SOFT` 之下移到無條件(值不變:inkable ? INK_SOFT_A : 1),再加兩行:`shader.uniforms.uInkBreakA = _inkBreakA;`(共享物件,拉桿一動全場跟著換)與 `shader.uniforms.uInkBreakSpan = { value: tint === 'env' ? INK_BREAK.SPAN_ENV : INK_BREAK.SPAN_MECH };`。**軌 = 既有的 `tint` 參數**(624 行 `_rampTint[tint]` 用的同一個軸,`toonMat` 恆 'mech'、`envMat` 恆 'env'),MUST NOT 另寫「哪些材質算機體」的名冊。

### 拉桿 → 共享 uniform 的唯一訂閱點
`public/js/toon.js:405`

現行:
```js
// 拉桿 → 共享 uniform(訂閱一次;本檔是全專案唯一持有這些 uniform 的地方)
function syncVisualPrefs() {
  _rampTint.mech.value.setRGB(...shadowTintRGB(visualPref('shadowMech')));
  _rampTint.env.value.setRGB(...shadowTintRGB(visualPref('shadowEnv')));
  _wSpread.value = WEATHER_SPREAD * visualPref('weather');
}
syncVisualPrefs();
onVisualChange(syncVisualPrefs);
```

**改成**: 函式體加一行 `_inkBreakA.value = visualPref('inkBreak');`。MUST 是共享 uniform 物件(紀律 ③:改值 MUST NOT 重建材質)。

### 程式快取鑰匙(defines 不同卻共用程式 = 整批沒換到)
`public/js/toon.js:966`

現行:
```js
  mat.customProgramCacheKey = () =>
    `cel${metal ? 'M' : ''}${wash > 0 ? 'W' : ''}${moss ? 'S' : ''}${cool > 0 ? 'C' : ''}${paint ? 'P' : ''}${paint?.face ? 'G' : ''}${paint?.flat ? 'F' : ''}${soft ? `Q${soft.k}${inkable ? 'I' : ''}` : ''}${landNrm ? 'L' : ''}${rim}`;
```

**改成**: 尾端補 `${inkAlpha ? 'B' : ''}`。漏掉的症狀與 landNrm 那一條同型:半透明與不透明件共用同一支已編譯的程式,水面拿到寫死 alpha 的那一版(把水面從 0.82 改成 0.30),而每一條離線斷言照樣全綠。

### 新旋鈕(表是唯一真相,UI 逐項推導)
`public/js/visualPrefs.js:79`

現行:
```js
  inkMrt: {
    label: '折邊勾線', def: 'off', choices: ['off', 'on'],
    choiceLabels: { off: '關', on: '開' },
    hint: '深度只看得見「前後有落差」的邊…',
  },
```

**改成**: 在 `lut` 與 `inkMrt` 之間插入 `inkBreak: { label: '勾線斷筆', def: 0, min: 0, max: 1, step: 0.05, unit: '%', hint: '…' }`。**def MUST 是 0**(紀律①:這一項是「需要美術方向確認」的等級,沒動過拉桿的玩家 MUST 看到舊畫面);`min: 0` 是 `audit_visual_prefs` Ⅰ 的硬條件。`main.js renderVisualSettings` 逐項由 `Object.entries(VISUAL_KNOBS)` 推導 ⇒ **UI 端一行都不用改**。

### ①-4 讀取端:掠射抑制項(現制,**不改**)
`public/js/postfx.js:523`

現行:
```js
          float slope = abs( l - r ) + abs( u - b );
          float e = lap / max( 0.001, d * ${INK.K_D.toFixed(3)} + slope * ${INK.K_S.toFixed(1)} );
```

**改成**: **一格不動**。這一輪對 ①-4 的落地只有斷言:掠射抑制項恰一項(`INK.K_S` 在勾線材質模板裡恰出現一次),且勾線材質原文 MUST NOT 出現任何法線式深度上限(`1.0 - n.z` / `nz` / `depthLimit` / `uDepthRange`)—— 那就是計畫講的「兩者擇一,MUST NOT 疊」寫成可驗的形式。

### ①-5:LUT 取代 split-tone 而不是疊加(現制正確,缺的只是斷言)
`public/js/postfx.js:706`

現行:
```js
          vec3 pre = c;
          float l = dot( c, vec3( 0.2126, 0.7152, 0.0722 ) );
          vec3 sh = vec3( ${g.SHADOW.map((v) => v.toFixed(3)).join(', ')} );
          vec3 hi = vec3( ${g.HIGH.map((v) => v.toFixed(3)).join(', ')} );
          c *= mix( sh, hi, smoothstep( 0.18, 0.72, l ) );
          c = mix( vec3( l ), c, ${g.SAT.toFixed(3)} );      // 微幅提彩度
          c = c * ( 1.0 - ${g.LIFT.toFixed(4)} ) + ${g.LIFT.toFixed(4)};
          if ( uLutA > 0.0 ) {
            vec3 lc = lutApply( pre );
            c = mix( c, lc, uLutA );
          }
```

**改成**: **檔案不動**;在 `tools/audit_visual_prefs.mjs` 新增 Ⅶ 段釘死四件事:①`vec3 pre = c;` 的位置 MUST 在 `c *= mix( sh, hi,` **之前**;②LUT MUST 查 `lutApply( pre )`,`void main()` 內 MUST NOT 出現 `lutApply( c )`;③合成 MUST 是 `c = mix( c, lc, uLutA );`(交叉淡入),`uLutA` MUST NOT 在別處被拿去乘/加;④整段 MUST 收在 `if ( uLutA > 0.0 )` 之下(0 ⇒ 連取樣都不做 ⇒ 逐位元同舊制)。

### ①-3(**待裁決**):地貌共用 id 的定案與 64 階環
`public/js/toon.js:178`

現行:
```js
let _surfSeq = 0;
/** 逐材質的 surfaceId(量化到 [0,1] 的 64 階;相鄰材質撞號 = 少一條線,不是壞掉)*/
const nextSurfId = () => ((_surfSeq = (_surfSeq + 23) & 63) + 0.5) / 64;
/**
 * 地貌共用的 surfaceId。取 **0 是刻意的**:`nextSurfId` 的值域是 `(k + 0.5) / 64`,
 * 最小 0.0078 ⇒ 0 永遠不會被抽到 ⇒ 地貌與任何一份非地貌材質的 id 差恆 ≥ 0.0078,
 * 穩穩跨過 `INK_MRT` 那一項的 0.004 門檻(地貌 vs 建物的線一條都不會少)。
 */
const LAND_SURF_ID = 0;
```

**改成**: **這一輪不動**。撞號算術已經量完:`nextSurfId` 的值域是**半整數格** `(k+0.5)/64`,所以地貌子帶 MUST 落在**整數格 `j/64`** —— 那樣它恰好落在兩個現役槽的正中間,與任一現役 id 的距離恆 = 0.5/64 = 0.0078125(8bit RT 量化後 0.007843)> ID 門檻 0.004 ✓,地貌碼彼此差 1/64 = 0.015625(8bit 0.015686)> 0.004 ✓,而且 `nextSurfId` **一個值都不用改** ⇒ 現有每一份材質的 id 逐位元不動。計畫寫的 `+= grassMask * 0.1` **會撞**:0.1 與 0.15 落在現役槽 0.1015625 / 0.1484375 的 0.004 以內 ⇒ 那兩種地貌對建物的線會靜默消失。

### ①-3(**待裁決**):「這條地面界線該不該有線」已經有唯一縫
`public/js/ground.js:2361`

現行:
```js
// 分界線種類解析唯一縫(對稱:交換兩側回傳相同;查無 → null = 不擺)。
export function borderKindOf(subA, subB, za, zb) {
  if (!za || !zb) return null;
  if (za === zb) {
    if (subA === subB) return null;
    const ca = SUB_COL[subA], cb = SUB_COL[subB];
    if (ca == null || cb == null) return null;   // 沒有代表色 = 不是底毯款 ⇒ 不畫
    return colDist(ca, cb) >= CARPET_DE.LINE ? (BORDER_SAME_ZONE[za] || null) : null;
  }
  …
  return BORDER_STYLES[za < zb ? `${za}|${zb}` : `${zb}|${za}`] || null;
}
```

**改成**: **不動,但它是 ①-3 的裁決依據**:2026-08-11 使用者定案「兩側若是相同地貌,則不需要分界線 —— 逐款畫線會把大片綠地切成密集網狀」。⇒ ①-3 若要落地,唯一不推翻既有定案的形狀是**只認 zone**(`za !== zb`,= 計畫舉的「草(green)↔ 岩(bare)」那一對),同 zone 內恆同碼、逐位元維持 2026-08-13 的「地貌不出接縫」。同 zone 的大色跳那一半 MUST 繼續走 `borderKindOf` 的窄門(`colDist ≥ CARPET_DE.LINE`),MUST NOT 在 ink 端再判一次(那是第二份實作,而且 `colDist ≥ 門檻` **不是等價關係** ⇒ 純量 id 表達不出來)。

### ①-3(**待裁決**):現制唯一的逐格地貌判定(不是逐 fragment)
`public/js/ground.js:3259`

現行:
```js
  const cellZoneAt = (i, j) => {
    const cx = terrain.minX + (i + 0.5) * cell, cz = terrain.minZ + (j + 0.5) * cell;
    const ec = envAt(cx, cz);
    if (ec === 1) return 'water';
    …
    if (slope > 0.28 && zn !== 'wet') zn = 'bare';
    if (ec === 2) zn = 'wet';
    if ((zn === 'green' || zn === 'bare') && hC > alpineH) zn = 'alpine';
    return zn;
  };
```

**改成**: **不動**。查證結果:本專案**沒有** `coverAt`(那是 sakura 的 API,`grep -rn coverAt public/ tools/ server/` 零命中),也**沒有任何 fragment 空間的 grass/rock 遮罩** —— `field.js` 只產出「這一區有多老」的風化場(`bakeFieldTexture` → `uCelWField` → `celWeatherF()`,與地貌無關)與地形色階梯(烤進頂點色);真正的地貌分類是 CPU 端逐 13m 格的 `zoneGrid`/`subGrid`,而底毯是逐 `sub#variant` 分桶的**獨立材質**(4326 行 `envMat(..., landNrm: true)`),全部共用 `LAND_SURF_ID`。⇒ ①-3 的落地載體 MUST 是**逐頂點屬性**(在 `emitCell` 的 `pushLandN` 旁邊多推一個 `aLandId`,3503 行;`setLandN` 旁邊多一個 setter,1710 行),那樣**零額外 draw call**;把 zone 併進分桶鍵會讓 scree/steppe/concrete 這些跨 zone 的款分裂成多桶。

### 要一起改的既有斷言(Ⅱ alpha 契約)
`tools/audit_soft_stroke.mjs:135`

現行:
```js
  ok(count(T, /gl_FragColor\.a = uSoftInk;/g) === 1, '材質端恰一處寫入(gl_FragColor.a = uSoftInk)');
  …
  ok(/uSoftInk = \{ value: inkable \? INK_SOFT_A : 1 \}/.test(T),
    '未標軟性(或半透明)的材質恆寫 1 ⇒ 其餘每一個像素逐位元同舊制');
  ok(/const inkable = !!sk && !mat\.transparent;/.test(T)
    && /if \(inkable\) defines\.CEL_SOFT = '';/.test(T),
    '細勾線那一半只給不透明件(半透明件的 alpha 是不透明度,不是勾線通道)');
  ok(/#ifdef CEL_SOFT[\s\S]{0,200}uniform float uSoftInk;/.test(T),
    'uSoftInk 的宣告收在 CEL_SOFT 之下(沒標軟性的程式碼一行都不多)');
```

**改成**: 三條要改、語意 MUST 保住:①寫入樣式改成 `/gl_FragColor\.a = uSoftInk \* celInkBreak\(\);/` 且仍 `=== 1`(**恰一處寫入**這條規則本身一格不動);②`uSoftInk` 的宣告不再收在 CEL_SOFT 之下 ⇒ 那一條改成「宣告無條件、值仍是 `inkable ? INK_SOFT_A : 1`」並在原地寫下理由(斷線因子要乘在同一個寫入點,兩個因子分兩處寫就是兩份契約);③新增「`CEL_INKA`/`CEL_INKB` 的閘 MUST 與 `inkable` 同一條 `!mat.transparent`」。⚠ 改斷言是最容易把真回歸洗成綠燈的動作 ⇒ 每一條改動 MUST 同輪補上對應的 `--break-*`。

### ①-5 斷言要進的檔(現況:全檔零 LUT 斷言)
`tools/audit_visual_prefs.mjs:584`

現行:
```js
console.log(`\n${fail === 0 ? '✅' : '❌'} 通過 ${pass} 項,失敗 ${fail} 項`);
process.exit(fail === 0 ? 0 : 1);
```

**改成**: 在這兩行之前插入 `Ⅶ 3D LUT:取代不疊加` 整段。放這一支而不是 `audit_cel_pipeline` 的三個理由:①`verification.md` 的「3D LUT 調色」那一列本來就把它排第一;②`lut`/`lutSrc` 兩個旋鈕的預設值斷言本來就住這一支的 Ⅰ;③`audit_cel_pipeline.mjs` 是序 3 的寫入檔,分開就不必搶同一份 diff。

## 寫入檔案
- `public/js/toon.js` (edit) — ①-2 全部的實作:`INK_BREAK` 常數 + 共享 uniform `_inkBreakA` + `celInkBreak()` + varying `vCelInkP` + `CEL_INKA`/`CEL_INKB` 兩個 define + alpha 寫入點多乘一個因子 + `celHash`/`celNoise` 提出 `#ifdef CEL_WP` + cache key + `syncVisualPrefs` 一行 + 檔頭契約改寫。
- `public/js/visualPrefs.js` (edit) — ①-2 的旋鈕 `inkBreak`(def 0 = 逐位元同舊制)。旋鈕表是單一真相,UI 由它推導 ⇒ main.js / index.html / style.css 一行都不用改。
- `tools/audit_soft_stroke.mjs` (edit) — ①-2 的新段 Ⅹ(雜訊斷線)+ 修改 Ⅱ 的三條既有斷言 + ①-4 的「掠射抑制項恰一項、MUST NOT 疊」斷言;新增 `--break-inkbreak` / `--break-inkanchor` / `--break-graze` 三支反向驗證。放這一支是因為斷線騎的正是它已經擁有的 alpha 契約,而且避開序 3 的 `audit_cel_pipeline.mjs`。
- `tools/audit_visual_prefs.mjs` (edit) — ①-5 的新段 Ⅶ(3D LUT:取代不疊加)+ `--break-lutstack`。
- `docs/anime_style_plan.md` (edit) — 執行紀錄追加序 4 那一列;①-4 寫下「維持 K_S」的定案與量測表(那張表就是這一項的全部產出);①-3 改標成「待使用者裁決」並附上撞號算術與唯一不推翻既有定案的形狀。
- `.claude/rules/seams-render.md` (edit) — §2.1 F 新增一列「勾線的雜訊斷線」(唯一縫 = `toon.js` 的 `INK_BREAK`/`celInkBreak`/`vCelInkP`,軌沿用 `tint`),並修訂「軟性物質」那一列的 ② 條:alpha 通道自此帶兩個因子、寫入仍恰一處。
- `.claude/rules/verification.md` (edit) — §5.5 新增「勾線的雜訊斷線 / LUT 取代不疊加 / 掠射抑制項」一列(要跑哪幾支 + 三支 `--break-*` + ㋓ 定裝照 + 逐位元不動的 bal/test)。

## 步驟
1. 步 0(前置,不寫檔):確認序 3(①-1 `outlineContribution` 打包)**已經落地並全綠**。序 3 與序 4 都會改 `toon.js` 的 `#include <opaque_fragment>` 那一段 replace 與 `customProgramCacheKey`,兩者同時改同一份 diff = 手動合併。序 4 MUST 在序 3 之後,而且動手前 MUST 重新 `readSrc` 一次 toon.js(行號會位移)。
2. 步 1(①-2 資料層,可獨立驗):`public/js/visualPrefs.js` 在 `lut` 與 `inkMrt` 之間插入 `inkBreak` 旋鈕(def 0 / min 0 / max 1 / step 0.05 / unit '%' / label '勾線斷筆' / hint 寫明「0% = 等寬的線(舊制),往上拉讓線像筆抬起來一樣斷開;斷處不是消失而是筆壓變輕」)。跑 `node tools/audit_visual_prefs.mjs` —— Ⅰ 段會自動把新旋鈕納入逐項檢查(欄位齊全 / def 合法 / min === 0 / 預設值 = 全部旋鈕都回 def)。
3. 步 2(①-2 常數與 uniform):`toon.js` 在 `const INK_SOFT_A = 0.3;`(464 行)下方新增 `INK_BREAK` 常數表與 `const _inkBreakA = { value: 0 };`,並在 `syncVisualPrefs()`(406 行)加 `_inkBreakA.value = visualPref('inkBreak');`。四個常數的語意逐條寫在原地:`SPAN_ENV`/`SPAN_MECH` 是**世界公尺的抬筆週期**(兩軌分開的理由 = 機體全高 4.5~9m、一筆畫要有十來個週期,而地形一筆畫跨數十公尺)、`CUT` 是 `celNoise` 值域 [0,1] 上的斷點門檻、`LO` 是斷處的門檻倍率(**0 = 真的斷開**,現值 0.12 = 筆壓變輕 —— 取非 0 是因為輪廓線對著天空整段消失讀起來是破洞,而 `INK_SOFT_A` 那條先例也是「變細不是不見」)。
4. 步 3(①-2 雜訊):把 `celHash` / `celNoise`(925~935 行)**原文一字不動**移到 `#ifdef CEL_WP` 之外(`varying vec3 vCelWP;` 留在 ifdef 內),在其下新增 `float celInkBreak() { if ( uInkBreakA <= 0.0 ) return 1.0; vec3 p = vCelInkP / uInkBreakSpan; float n = celNoise( p.xz ) * 0.62 + celNoise( p.yz * 1.73 + 11.3 ) * 0.38; float brk = mix( 1.0, LO, step( n, CUT ) ); return mix( 1.0, brk, uInkBreakA ); }`(LO/CUT 由 JS 模板插值,MUST NOT 在 GLSL 裡手寫數字)。**兩個平面各取一次雜訊**是必要的:單取 `p.xz` 的話垂直裝甲板上整條線同相 = 沒有斷點;`if ( uInkBreakA <= 0.0 ) return 1.0;` 是 uniform 分支(與 `postfx.js` 的 `if ( uAirA > 0.0 )` / `if ( uLutA > 0.0 )` 同一個 idiom)⇒ 旋鈕 0 時連雜訊都不算。
5. 步 4(①-2 頂點):在 `#ifdef CEL_LAND_N`(786 行)之前插入 `#ifdef CEL_INKB` 區塊,`vCelInkP = mat3( modelMatrix ) * ( USE_INSTANCING ? instanceMatrix * vec4(transformed,1.0) : vec4(transformed,1.0) ).xyz`(照 `CEL_WP` 那一段的寫法展開);在 901 行那一支 `.replace('void main() {', …)` 的宣告串裡補 `varying vec3 vCelInkP;`(片段端)與 638 行那一支的頂點端宣告。理由 MUST 寫在原地:**`mat3` 不是 `mat4`** —— 丟掉平移欄是「走一步缺口不在身上游動」的全部;轉身時跟著轉 ⇒ 缺口黏在裝甲板上(同 `CEL_PAINT` 那句 never makes the pattern swim);地形的 modelMatrix ≈ 單位陣 ⇒ 同一條式子對地形自動退化成世界空間。
6. 步 5(①-2 閘與寫入):588 行下方補 `const inkAlpha = !mat.transparent; if (inkAlpha) { defines.CEL_INKA = ''; defines.CEL_INKB = ''; }`;613 行的 `uSoftInk` 宣告改為無條件(值不變)並在其後補 `uInkBreakA`(共享物件)與 `uInkBreakSpan`(`tint === 'env' ? SPAN_ENV : SPAN_MECH`);881~886 的區塊改成 `#ifdef CEL_INKA` + `gl_FragColor.a = uSoftInk * celInkBreak();`;966 行 cache key 尾端補 `${inkAlpha ? 'B' : ''}`。**`postfx.js` 一行不改** —— 讀取端的 `soft = min(這一格 + 四鄰)` 與 `smoothstep( EDGE0, EDGE1, ae * soft )` 以及 `ink = max( ink, mrtEdge * soft )` 天生就把這個因子吃進去(斷處 soft = 0.12 ⇒ 兩個訊號一起變細)。
7. 步 6(①-2 逐位元對照):`node tools/audit_client_syntax.mjs`(㋖,先跑這一支 —— toon.js 的 GLSL 住樣板字串,一個反引號就把整支收掉而 `node --check` 可能還是綠的);再跑 `node tools/audit_soft_stroke.mjs`(Ⅱ 會紅,那是預期的,步 8 才改斷言)確認**只有**該紅的紅。
8. 步 7(①-2 行為驗收 ㋓):`node tools/shot_scene.mjs --pref inkBreak=0`(MUST 與改制前 13 張**逐位元相同**,md5 比對)、`--pref inkBreak=0.6` 與 `--pref inkBreak=0.6 --pref inkMrt=on` 各一組;另做**平移不變性直測**:真瀏覽器裡把同一台機體放在 (0,0) 與 (137, −91),同一組相對機位截圖,機體佔的那一塊 MUST 逐像素相同(這是 `mat3` 那一條唯一驗得到的地方 —— 寫成 `mat4` 之後每一條離線斷言照樣全綠)。
9. 步 8(①-2 + ①-4 斷言):`tools/audit_soft_stroke.mjs`:(a) 修 Ⅱ 的三條(見 seams 第 14 列),(b) 新增 Ⅹ 段 —— 斷線因子真的乘進 alpha 的唯一寫入點 / `INK_BREAK` 四欄齊全且 `CUT ∈ (0,1)`、`LO ∈ [0,1)`、`SPAN_MECH < SPAN_ENV` / 錨點 MUST 是 `mat3( modelMatrix )` 且該運算式 MUST NOT 出現 `modelMatrix *`(帶平移)/ 兩軌由 `tint` 推導、原文 MUST NOT 出現逐材質名冊 / `uInkBreakA` 是共享物件(`= _inkBreakA`,不是 `{ value: … }`)/ `celNoise` 全專案恰一份 / define 的閘 === `!mat.transparent`,(c) 新增 ①-4 那一條:勾線材質模板裡 `INK.K_S` 恰出現一次、且原文 MUST NOT 出現 `n.z` / `nz` / `depthLimit` / `uDepthRange`(兩者擇一,MUST NOT 疊),再加一條**行為**斷言 —— 從原文取出 `K_D`/`K_S`,以解析平面模型算門檻倍率,掠射 2° MUST ≥ 正對牆的 8 倍(K_S 被人「簡化」成 0 就在這裡紅)。
10. 步 9(①-5):`tools/audit_visual_prefs.mjs` 在結尾前新增 Ⅶ 段,九條:`pre` 的位置在 split-tone 之前 / `lutApply( pre )` 存在且 `void main()` 內無 `lutApply( c )` / 合成是 `c = mix( c, lc, uLutA )` / `uLutA` 在 main 內只被這兩處用到 / 整段收在 `if ( uLutA > 0.0 )` 之下 / `_pushLutA` 是 `uLutA` 的**唯一寫入點**(count === 1) / `lut.def === 1 && lutSrc.def === 'none'`(出貨逐位元同舊制) / shader 的四個 split-tone 常數 MUST 由 `${g.…}` 插值(原文 MUST NOT 手打 `0.86, 0.94, 1.10`) / `makeGradeLut` 的 `smooth(0.18, 0.72, l)` 與 shader 的 `smoothstep( 0.18, 0.72, l )` **兩對邊界逐位元相同**(兩份數學分家的症狀是「切到內建之後畫面微妙地不一樣」,而檔頭 190 行早就宣稱它們相同、卻一條斷言都沒有)。
11. 步 10(反向驗證,原則 9):三支 break 逐一跑,每一支 MUST 有對應紅字且**其餘全綠**;`--break-*` 的字面替換一律用 CRLF 容忍樣式(`\r?\n`)並在替換無效時**當場 `process.exit(1)`**(§5.4 ㋑ —— 含 `\n` 的字面替換在這個工作區是無聲 no-op,而那時 break 永遠是綠的)。
12. 步 11(回歸批):跑 audits 欄的全部;`npm run bal` 與 `npm test` MUST **逐項不動**(`data.js` / `sim.js` / `server/**` 一行未改 ⇒ 動了就是純表現層漏到判定上;`npm test` 前 MUST 照 §5.2 重啟伺服器)。
13. 步 12(文件):`docs/anime_style_plan.md` 執行紀錄追加序 4 那一列 + ①-4 的量測表與定案 + ①-3 的裁決請求;`.claude/rules/seams-render.md` 新增縫列並修訂軟性物質那一列;`.claude/rules/verification.md` 新增對照列。
14. 步 13(**不做,列給使用者裁決**):①-3。若使用者放行,規格如下(一輪可完成):`ground.js` 的 `bucketOf`(1609)/`emitCell`(3503)/`setLandN`(1710)各多一個 `lid` 陣列與 `aLandId` 屬性,值 = `ZONE_ID[zoneGrid[cell]] / 64`(整數格,見 seams 的撞號算術);`toon.js` 新增 `CEL_LAND_ID` define,`gInfo` 的 `.b` 改成 `#ifdef CEL_LAND_ID vLandId #else uSurfId #endif`;`ZONE_ID` 是 `ground.js` 的一張 6 格表且 `terrain.js` 的地形本體維持 0;新 break `--break-landid`(把 `/64` 改成 `*0.1` ⇒ 撞號斷言紅)。

## 稽核
- `node tools/audit_client_syntax.mjs`
- `node tools/audit_client_syntax.mjs --break-glsl`
- `node tools/audit_soft_stroke.mjs`
- `node tools/audit_soft_stroke.mjs --break-inkbreak`
- `node tools/audit_soft_stroke.mjs --break-inkanchor`
- `node tools/audit_soft_stroke.mjs --break-graze`
- `node tools/audit_soft_stroke.mjs --break-ink`
- `node tools/audit_soft_stroke.mjs --break-anchor`
- `node tools/audit_soft_stroke.mjs --break-wave`
- `node tools/audit_soft_stroke.mjs --break-gust`
- `node tools/audit_visual_prefs.mjs`
- `node tools/audit_visual_prefs.mjs --break-lutstack`
- `node tools/audit_cel_pipeline.mjs`
- `node tools/audit_cel_pipeline.mjs --break-inkinfo`
- `node tools/audit_cel_pipeline.mjs --break-land`
- `node tools/audit_cel_pipeline.mjs --break-lutland`
- `node tools/audit_cel_pipeline.mjs --break-scale`
- `node tools/audit_world_curve.mjs`
- `node tools/audit_gpu_lifecycle.mjs`
- `node tools/audit_daynight.mjs`
- `node tools/audit_ui_layout.mjs`
- `node tools/audit_solo_boot.mjs`
- `npm run audit:net`
- `npm run bal`
- `npm test`
- `node tools/shot_scene.mjs --venue taroko --pref inkBreak=0`
- `node tools/shot_scene.mjs --venue taroko --pref inkBreak=0.6`
- `node tools/shot_scene.mjs --venue shibuya --pref inkBreak=0.6 --pref inkMrt=on`

## 反向驗證
- `--break-inkbreak` — 壞版: toon.js 的 alpha 寫入點退回 `gl_FragColor.a = uSoftInk;`(斷線因子沒有乘進去) ⇒ **MUST 紅**: audit_soft_stroke Ⅹ「斷線因子 MUST 乘進 alpha 的唯一寫入點」+ Ⅱ「材質端恰一處寫入 `uSoftInk * celInkBreak()`」兩條 MUST 紅;Ⅱ 其餘條目與 Ⅰ・Ⅲ~Ⅸ MUST 仍綠(= 對照組)
- `--break-inkanchor` — 壞版: `vCelInkP = mat3( modelMatrix ) * ibP.xyz;` 換成 `vCelInkP = ( modelMatrix * ibP ).xyz;`(帶回平移欄) ⇒ **MUST 紅**: audit_soft_stroke Ⅹ「錨點 MUST 丟掉平移(`mat3( modelMatrix )`,MUST NOT 出現 `modelMatrix *` 帶平移的形式)」MUST 紅。這一支釘的正是計畫那句「機體那條 MUST 吃局部座標(否則走路時缺口在身上游動)」—— 寫成 mat4 之後畫面上只是「線在閃」,離線每一條斷言照樣全綠
- `--break-graze` — 壞版: postfx.js 的門檻分母 `d * ${INK.K_D…} + slope * ${INK.K_S…}` 追加一個法線式上限項(注入字面 `+ ( 1.0 - nz )`),模擬「兩者疊上去」 ⇒ **MUST 紅**: audit_soft_stroke Ⅹ「掠射抑制項恰一項:`INK.K_S` 恰一次,且勾線材質原文 MUST NOT 出現 `n.z`/`nz`/`depthLimit`/`uDepthRange`」MUST 紅(計畫 ①-4「兩者擇一,MUST NOT 疊」寫成可驗的形式)
- `--break-lutstack` — 壞版: postfx.js 的 `vec3 lc = lutApply( pre );` 換成 `lutApply( c );`(LUT 查的變成已經被 split-tone 動過的顏色 = 疊加而非取代) ⇒ **MUST 紅**: audit_visual_prefs Ⅶ「LUT MUST 查調色前的顏色(`lutApply( pre )`;`void main()` 內 MUST NOT 出現 `lutApply( c )`)」MUST 紅。另一半(`vec3 pre = c;` 被挪到 split-tone 之後)由同一支的位置斷言接住
- `--break-landid(①-3 放行才寫)` — 壞版: `aLandId` 的量化從整數格 `j / 64` 改成計畫字面的 `j * 0.1` ⇒ **MUST 紅**: 新 audit 段「地貌子帶 MUST 落在整數格 k/64 ⇒ 與 nextSurfId 的半整數格恆差 ≥ 0.5/64」MUST 紅(實測 0.1 與 0.15 分別落在現役槽 0.1015625 / 0.1484375 的 0.004 門檻內 ⇒ 那兩種地貌對建物的線靜默消失)

## 會靜默壞掉的地方
- **不透明但 opacity < 1 的 cel 材質**:`CEL_INKA` 的閘只問 `!mat.transparent`,而 three 只在 `!transparent && blending === NormalBlending` 時定義 `OPAQUE`(⇒ `diffuseColor.a = 1.0`)。若有材質 `transparent: false` 卻自訂 blending 或 opacity,舊制寫的是 `material.opacity`、新制寫 `uSoftInk * celInkBreak()` ⇒ **旋鈕 0 也不是逐位元中性**。落地前 MUST `grep -n "opacity" public/js/*.js` 逐一核對 `envMat`/`toonMat` 的呼叫端;有命中就把閘收成 `!mat.transparent && (mat.blending ?? THREE.NormalBlending) === THREE.NormalBlending`。
- **min 濾波把缺口撐大**:勾線 pass 取 `soft = min(這一格 + 四鄰)`,斷線因子因此被**侵蝕一圈** ⇒ 實際缺口比寫進去的寬 2 像素。在 `SPAN_ENV = 3m`(百米外約 24px 週期)無妨,但把 `SPAN_MECH` 調到 0.2m 以下就會變成「整條線都很淡」而不是「有斷有續」。這一條沒有任何離線稽核看得見,只有 ㋓ 定裝照。
- **遠處的 Nyquist 閃爍**:斷線是世界空間錨定的,一個週期投影到螢幕上的像素數 ∝ 1/距離。`SPAN_MECH = 0.45m` 在 150m 外只剩約 2.4 px ⇒ 亞像素雜訊,而 FXAA 修不了時間上的閃爍。`LO = 0.12`(不是 0)讓它退化成「線的濃淡在抖」而不是「洞在閃」,但這是取捨不是解。真的閃就要加距離淡出,而距離淡出**MUST NOT 用 `fwidth`** —— 內建材質沒有入口開 `GL_OES_standard_derivatives`,WebGL1 上是編譯失敗 = 那一批物件整批不畫。
- **改斷言把真回歸洗成綠燈**:這一輪要動 `audit_soft_stroke` Ⅱ 的三條既有斷言,而那一段正是「軟性契約斷掉」的唯一防線。三條的**語意**(恰一處寫入 / 非軟性件恆寫 1 / 只給不透明件)MUST 逐條保住;`--break-ink` 與 `--break-anchor` 兩支既有反向驗證 MUST 仍然各自紅字(它們是這次改斷言有沒有改壞的對照組)。
- **序 3 的合併面**:序 3 也改 `toon.js` 的 `#include <opaque_fragment>` replace 區塊(gInfo 寫入)與 `customProgramCacheKey`,以及 `postfx.js` 的勾線材質。兩項同時進行 = 手動合併,而合併錯的症狀是某一個 define 沒進鑰匙 ⇒ 半透明件拿到寫死 alpha 的那一版(水面從 0.82 變 0.30),離線全綠。
- **`celNoise` 的提出**:把它移出 `#ifdef CEL_WP` 之後,沒有 `CEL_WP` 的材質(`toonMat` 預設 wash 未傳 ⇒ 機體是 `toonMat`,無 CEL_WP)會多編一支死函式。編譯器會剝掉,但 `audit_soft_stroke` 有一條「沒標軟性的程式碼一行都不多」的精神條款,MUST 在原地寫下理由(斷線要用同一支雜訊,兩份 hash 就是兩種花紋)。
- **①-3 若被放行的隱性代價**:逐頂點 `aLandId` 會讓底毯/外溢/脊帶三層每個頂點多 4 bytes,而 `emitCell` 是逐地形三角形認養的 ⇒ 頂點數是全場最大的一批。落地時 MUST 量一次 `buildBiomes` 記憶體與時間(2026-08-13 的 `SAG` 那一輪同樣的地方量到 +30%)。
- **①-4 若使用者仍要換**:那不是序 4 的體量。換過去要同時(a) 讓 `inkMrt` 從 opt-in 變成必要(否則預設組態沒有掠射抑制)、(b) 重新調 `EDGE0`/`EDGE1`/`K_D`(現值是 2026-08-03 四輪定場照量出來的,錨在 K_S 上)、(c) 為哨兵像素(天空/護盾/粒子/招牌,gInfo.a = 0)準備第二份門檻 = 第二份實作、(d) 先拍 13 張基準定場照。⇒ 它屬於序 12 的等級。

## 逐位元中性

"**①-2**:三重保證。①旋鈕 `inkBreak` 的 `def = 0`(`audit_visual_prefs` Ⅰ 逐項驗預設值);②`celInkBreak()` 第一行是 `if ( uInkBreakA <= 0.0 ) return 1.0;` —— uniform 分支,0 時連雜訊都不算,回傳的是**字面 1.0** 不是 `mix` 出來的 1.0(浮點上兩者可以不同);③寫入值 `uSoftInk * 1.0`:軟性件 = `INK_SOFT_A`(同舊制)、非軟性不透明件 = `1.0`,而 `opaque_fragment` 的 `#ifdef OPAQUE diffuseColor.a = 1.0` 本來就已經讓那些像素的 alpha 是 1.0 ⇒ 新寫入是 no-op。`postfx.js` 一行未改 ⇒ 讀取端逐位元不動。證明手法:(a) `shot_scene --pref inkBreak=0` 的 13 張定場照與改制前 **md5 全同**;(b) 真 GPU `readPixels` A/B(旋鈕 0 ⇄ 拉高再拉回 0,MUST 逐位元還原);(c) `data.js`/`sim.js`/`server/**` 一行未改 ⇒ `npm run bal` 與 `npm test` MUST **逐項不動**(㋒ 的字面意義)。⚠ 唯一的破口是 risks 第 1 條(`transparent:false` 但 opacity < 1 的材質),落地前 MUST 逐一核對呼叫端。\n**①-4**:`postfx.js` 一行不改 ⇒ 構造性地逐位元同舊制(這一項的產出只有斷言與量測)。\n**①-5**:只加斷言,`postfx.js` 不改 ⇒ 逐位元同舊制;而 `lut.def = 1` / `lutSrc.def = 'none'` 的斷言正是把「出貨版逐位元同舊制」這件事第一次釘住。\n**①-3**:不落地 ⇒ 零改動。若放行,中性保證是「`aLandId` 屬性缺席 ⇒ `CEL_LAND_ID` 未定義 ⇒ `gInfo.b` 仍寫 `uSurfId` = `LAND_SURF_ID` = 0」,且 `nextSurfId` 一個值都不動(整數格 vs 半整數格,見 seams)。"

## 卡在
- **①-3 需要使用者裁決,MUST NOT 自行落地。** 它與兩條有日期的使用者定案正面相反:2026-08-13「LUT 與勾線不針對地貌作用,不要看出地貌拼圖接縫,但地形變化受 LUT 與勾線作用」(`.claude/rules/seams-render.md`「地貌不出接縫」那一列 + `toon.js` 檔頭 141~154)、以及 2026-08-11「兩側若是相同地貌,則不需要分界線 —— 逐款畫線會把大片綠地切成密集網狀」(`ground.js:2320` 附近 `BORDER_STYLES` 檔頭)。要問的三句話:①「同一塊地形上草↔岩要出線」是不是**只**指跨地貌(green↔bare)那一種?若是,可以落地且與兩條舊定案都不衝突(同 zone 內的 id 差恆 0,2026-08-13 那條逐位元保住)。②同 zone 內的大色跳(現制走 `borderKindOf` 的 `colDist ≥ CARPET_DE.LINE` 窄門,畫的是**實體的界線拼圖**如步道/碎石徑)要不要**再**多一條墨線?(現制那一條線已經存在,只是畫的不是墨線。)③既然 §0-a 的線工切面(序 13~15)會把整個地貌系統換掉,①-3 這個「廉價替代」值不值得先付一輪 —— 它的載體(逐頂點 `aLandId`)在 0-a 之後會整組退場。
- **①-4 的建議是「維持 K_S,不換」,但那也是一個定案,MUST 讓使用者知道理由並確認。** 量測(解析平面模型,fovY 68°、1080p、THICK 1px、門檻倍率相對正對鏡頭的牆):K_S 版 正對牆 1.00 / 45° 斜面 1.37 / 仰角 20° 2.03 / 10° 3.13 / 5° 5.28 / 2° 11.73;`1−n.z` 版的 `1+K_N·(1−n.z)` 上界恆為 `1+K_N` ⇒ 配到 2° 相等要 K_N = 11.1,那時 45° 斜面被推到 3.09 倍過度抑制(屋頂/山坡/斜坡道的線整批消失);配到 10° 相等要 K_N = 2.57,那時仰角 2° 只剩 0.30 倍(近地平線的地面回到「畫滿等高線」)。⇒ **兩條曲線在任何單一係數下都配不起來**。另外三條:(a) `1−n.z` 只有 `inkMrt` 開著才拿得到法線,而它**預設關**、WebGL1 上根本沒有 ⇒ 換過去等於預設組態失去全部掠射抑制;(b) 哨兵像素(gInfo.a = 0:天空穹頂/護盾殼/粒子/招牌)沒有法線 ⇒ 要第二份門檻 = 第二份實作(原則 2);(c) 低解析度時 K_S 版的 e 會**飽和**(lap 與 slope 同階,比值有上界),`1−n.z` 版 e 對像素尺寸是線性沒有上界 ⇒ 手機降階時地形折邊會變強。
- **序 3(①-1 `outlineContribution` 打包)MUST 先落地。** 兩者改 `toon.js` 的同一段 replace 與同一支 `customProgramCacheKey`;`postfx._mkRT` 把 `rtScene.texture[1]` 設成 `NearestFilter` 那一條也是序 3 的(`docs/anime_style_plan.md` §0-c 編碼定案的 ⚠ 那一段)。序 4 MUST 排在其後,並在動手前重新 `readSrc` 一次(行號會位移)。
- **㋓ 需要真瀏覽器**:`shot_scene` 的三組定裝照與「平移不變性直測」是 ①-2 唯一驗得到「缺口有沒有在身上游動」的地方 —— 寫成 `mat4` 之後每一條離線斷言照樣全綠。沙箱跑不動 ⇒ MUST 在交付說明中標註未驗項(§5.4 ㋓)。
- **㋕ 真機一次**:低功耗裝置走 8bit RT,而 alpha 通道在 8bit 上只有 256 階 —— `LO = 0.12` 存成 31/255 = 0.1216(誤差 0.0016,對 `ae * soft` 無感),但 `INK_SOFT_A = 0.3` 與 `0.3 × 0.12 = 0.036` 疊起來只剩 9/255 ⇒ 軟性件的斷處實質等於沒有線。要不要對軟性件關掉斷線(它的線本來就細)是一個取捨,MUST 由定裝照決定,MUST NOT 在稽核裡先寫死。
