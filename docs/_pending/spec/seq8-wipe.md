# 序 8 / ④-1 斜向 wipe + ④-2 dissolve discard + ④-3 霧≡勾線淡出 + ④-4 接縫紀律進稽核  (key: seq8-wipe)

## 摘要

現況:`postfx.js` 的 pass 鏈是 `ink → dof → grade → fxaa`,FXAA 兼任線性→sRGB 必須留在鏈尾;沒有任何轉場 pass(`cutin.js`/`dialogue.js`/`storyui.js` 全是 DOM overlay)。物件出現一律是硬跳(`_spawnUnit` 建完就畫),淡入淡出只出現在標記 sprite 與 `morphrig` 的變形淡出(後者是定案不動)。勾線的遠處淡出錨在 **`camera.far`**(`INK.FADE0/1` = 0.55/0.95 × `span×2`),而霧錨在 `span × WEATHERS[].fogNear/fogFar` —— 兩者只有 `clear` 天氣恰好對齊(0.95×2 ≡ 1.9),其餘四種天氣的線會畫到霧已經飽和之後(rain/snow/fog 是**整段**畫在純霧色上),正是 SKILL 說的「背景在中距離變成線框」;而 `data.js DOF` 檔頭早就寫著「錨 MUST NOT 取相機 far 平面」,勾線淡出是唯一還沒照做的那一條。要改成:①`postfx.js` 新增一支 wipe pass(兩支 0→1 uniform + overlay 色 + vibrance/對比 flash),插在 **grade 與 fxaa 之間**,由 `visualPrefs` 的 `wipe`(預設關)與「有沒有轉場在跑」雙重閘控制,時間軸是 `data.js` 的純函式;②`toon.js applyCelPatch` 加一個 `dissolve` 選項(`discard` 抖動,非 alpha),只掛在三種招式載具上;③勾線淡出改由 `scene.fog` 推導(`fadeEnd = max(fog.far, combatReachM()/F)`、`fadeStart = fadeEnd × F`,`F = FADE0/FADE1`),`clear` 天氣在實數上恆等舊制;④把 SKILL 的接縫 symptom 表逐列併進**已經在守同一件事**的六支稽核檔頭(純註解)。

## 縫

### pass 鏈組裝(wipe 要插在哪)
`public/js/postfx.js:783`

現行:
```js
    const chain = [];
    if (this.enabled.ink) chain.push('ink');
    // 景深 MUST 排在勾線**之後**(檔頭 ②:先糊後勾 = 糊掉的色塊配上銳利的黑線)。
    if (this.enabled.dof && this._dofRange && this._dofA * this._dofBlend > 0) chain.push('dof');
    if (this.enabled.grade) chain.push('grade');
    // 最後一 pass **一定要跑**:它同時負責線性 → sRGB。`?fxaa=0` 只是把邊緣混合關掉
    chain.push('fxaa');
```

**改成**: 在 `grade` 與 `fxaa` 之間插一列 `if (this.enabled.wipe && this._wipeA > 0) chain.push('wipe');`。**四條理由缺一不可**:①FXAA MUST 留鏈尾(它兼任線性→sRGB,`audit_gpu_lifecycle` ⑦ 已釘住 `chain.push('fxaa')` 無條件);②幕的斜邊是硬 `step`,擺在 FXAA 之前才有抗鋸齒(擺之後就是一條鋸齒對角線,而那正是動漫轉場最刺眼的地方);③幕 MUST 蓋在**調過色的**畫面上(擺在 grade 之前 = 幕色被 split-tone / LUT 再調一次,美術挑的顏色不是畫出來的顏色);④flash 是鏡頭上的事,與 grade 同層而排在它之後。閘門形狀 MUST 逐字鏡射 dof 那一列(0 ⇒ **整個 pass 退出鏈**,不是跑一個乘 0 的 pass)。**不新增 RenderTarget**:鏈變成 5 步仍在 rtA/rtB 之間乒乓 ⇒ `audit_gpu_lifecycle` ⑦ 的 `rtN === 1` 不受影響。

### 全螢幕材質名冊與釋放(A25)
`public/js/postfx.js:842`

現行:
```js
    for (const q of [this.inkQuad, this.dofQuad, this.gradeQuad, this.fxaaQuad]) {
      q.material.dispose();
      q.dispose();
    }
```

**改成**: 加入 `this.wipeQuad`;同步 `this._quads`(:265)與建構(:259~264)。`audit_gpu_lifecycle` ⑦ 的註解「3 個 RT + 3 個 FullScreenQuad」本來就已經與現況(4 個)脫節,這一輪一併改成推導式敘述。wipe 材質**不讀 `tInfo`** ⇒ MUST NOT 進 `_syncMrt`(:337)的重建清單;若日後讓它讀類別碼,MUST 同時進 `_syncMrt`,否則切折邊勾線開關之後轉場會靜靜地失效。

### 勾線遠處淡出(錨:相機 far → 霧)
`public/js/postfx.js:573`

現行:
```js
          // ② 遠處淡出:遠景線密到變雜訊,而且會蓋掉霧
          ink *= 1.0 - smoothstep( uFar * ${INK.FADE0.toFixed(2)}, uFar * ${INK.FADE1.toFixed(2)}, d );
```

**改成**: 改成 `ink *= 1.0 - smoothstep( uFade0, uFade1, d );`,兩個新 uniform 由 `render()` 的共用接線(:819 的 `if (u.tDepth)` 同一段)每幀寫入。`INK.FADE0/FADE1` 兩個常數留著但語意變成**形狀比**:新增 `INK.FADE_F = INK.FADE0 / INK.FADE1`(= 0.578947…)。推導只有一份:`_inkFadeM()` 讀 `this.scene.fog`(那是 `setAirFog` 的 docstring 已經要求「與 `scene.fog` 逐位元相同」的同一個物件 ⇒ 不開第二個寫入點)。

### 霧帶的來源(推導式的另一端)
`public/js/environment.js:383`

現行:
```js
  scene.fog = new THREE.Fog(0x000000, span * W.fogNear, span * W.fogFar);
```

**改成**: 一行不改。`postfx._inkFadeM()` 讀它:`const f = this.scene.fog; const end = (f && f.far > 0) ? Math.max(f.far, combatReachM() / INK.FADE_F) : this.camera.far * INK.FADE1; return [end * INK.FADE_F, end];`。`scene.fog` 缺席(未來的樣品 / `shot_veg` 那類無霧場景)MUST 退回舊式 ⇒ 逐位元同舊制(原則 6);漏掉這一條就是 fade 讀到 NaN、整片沒有線而沒有任何錯誤訊息。

### 五種天氣的霧帶(換錨的證據)
`public/js/environment.js:55`

現行:
```js
const WEATHERS = {
  clear:  { light: 1.0,  fogNear: 0.50, fogFar: 1.9 },
  cloudy: { light: 0.55, fogNear: 0.40, fogFar: 1.6 },
  rain:   { light: 0.45, fogNear: 0.20, fogFar: 1.0, particle: 'rain' },
  snow:   { light: 0.60, fogNear: 0.22, fogFar: 1.1, particle: 'snow', fogTint: 0xcfd8dd },
  fog:    { light: 0.50, fogNear: 0.04, fogFar: 0.35 },
};
```

**改成**: 不改。落地時把這張表當成 ④-3 的**現值對照**寫進 `audit_cel_pipeline` 新 Ⅸ 段的檔頭:`camera.far = span × 2` ⇒ 現制淡出帶恆為 [1.10, 1.90]×span;而霧的遠端是 [1.9 / 1.6 / 1.0 / 1.1 / 0.35]×span ⇒ 只有 `clear` 對齊(1.90 ≡ 0.95×2,這就是這兩個常數當初是在晴天定場照上調出來的證據),`rain`/`snow`/`fog` 三種天氣**連淡出的起點都排在霧飽和之後**(rain:霧 1.0×span 就全白了,線畫到 1.90×span)。

### 景深的錨(這一項的先例與地板的來源)
`public/js/data.js:895`

現行:
```js
export const DOF = {
  NEAR_F: 1.5,     // 起糊 = 交戰距離上界 × 此值。**1.0 以下即侵入交戰距離**(稽核 Ⅵ-b 守門)
  FAR_F: 2.0,      // 全糊
```

**改成**: 不改,但這是 ④-3 的兩個依據:①它的檔頭(:889)明寫「錨也 MUST NOT 取相機 far 平面(= 地圖邊長 × 2):那隨隊制變」—— 勾線淡出正是唯一還錨在那裡的;②`combatReachM()`(:914,現值 304m)提供地板 `end ≥ combatReachM() / INK.FADE_F`(= 525m),讓「打得到的東西恆有線」變成**結構保證**,與 DOF Ⅵ-b「打得到的東西恆為全清晰」逐條對稱。沒有地板的話迷你地圖 + 霧天(`span 480 × 0.35 = 168m`)會讓 `fadeStart` 落在交戰距離裡面、甚至 `fade0 > fade1`(smoothstep 端點反轉)。

### 資訊緩衝的取樣過濾(dissolve 的前置)
`public/js/postfx.js:307`

現行:
```js
  _mkRT(depth) {
    const w = Math.max(1, this._size.x), h = Math.max(1, this._size.y);
    const opt = {
      type: this._rtType, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter,
      depthBuffer: true, stencilBuffer: false,
    };
    const rt = depth && this._mrt
      ? new THREE.WebGLMultipleRenderTargets(w, h, 2, opt)
      : new THREE.WebGLRenderTarget(w, h, opt);
```

**改成**: `rtScene.texture[1]`(資訊緩衝)MUST 改成 `NearestFilter`。今天沒事只因為取樣偏移恰好是整數個 texel(`INK.THICK = 1.0` ⇒ 落在 texel 中心)⇒ **這一改是逐位元中性的**;但 dissolve 會在 1 texel 尺度上交替「有寫 / 沒寫」gInfo,線性內插會把 `.a` 混成一個**不存在的類別**(HARD 1 與 NONE 0 之間 = LAND 0.5)⇒ 一台正在 dissolve 的機體會被 LUT 的地貌分支接手。這一條與 `docs/anime_style_plan.md` §0-c 編碼定案的最後一段是同一件事:序 3 與序 8 誰先落地誰帶進來,**MUST 只有一份**。

### cel 材質的 dissolve 入口
`public/js/toon.js:567`

現行:
```js
function applyCelPatch(mat, { metal = false, rim = 0.22, wash = 0, moss = null, cool = 0, paint = null, tint = 'mech', preview = false, soft = null, bands = 3, land = false, landNrm = false } = {}) {
```

**改成**: 加 `dissolve = false`。為 true 時:①`defines.CEL_DIS = ''`;②`mat.userData.celDisU = { value: 1 }`(**穩定的 uniform 物件**,同 `_windT`/`_rampTint` 的做法 —— 在 `onBeforeCompile` 裡 `{ value: 1 }` 新建的話重編譯就換一顆,驅動端抓著的是舊的,症狀是「有時候不會 dissolve」);③`shader.uniforms.uDis = mat.userData.celDisU`;④片段錨點 `#include <clipping_planes_fragment>`(緊接在 `void main() {` 之後)插入 `#ifdef CEL_DIS if ( celDissolve( vDisP ) ) discard; #endif`;⑤頂點端加 varying `vDisP = (modelMatrix * vec4(transformed,1.0)).xyz - uDisO`(`uDisO` = 該單位的世界原點,由驅動端每幀餵)—— **MUST 錨在單位自己身上**,拿純世界座標的話機體會從固定的網格裡「游」過去(與計畫 ①-2「機體那條雜訊斷線 MUST 吃局部座標」同一條理由)。

### gInfo 寫入(discard 與哨兵的交互)
`public/js/toon.js:887`

現行:
```js
        // 勾線資訊緩衝(檔頭那一段):覆寫 opaque_fragment 寫下的「沒有資訊」。
        {
          vec3 gN = normalize( normal );
          ...
          gInfo = vec4( gN.xy * 0.5 + 0.5, uSurfId, uInkClass );
        }
```

**改成**: 一行不改,但**要把交互寫進檔頭**:`discard` 掉的片元既不寫顏色也不寫 gInfo 也不寫深度 ⇒ 那一格留下的是**它背後那個東西**的 gInfo,不是哨兵 0。所以常見的誤解(「discard ⇒ 哨兵成立 ⇒ 洞邊不會多出線」)**只在背景是天空時成立**(穹頂寫 `INK_INFO_NONE`,`environment.js:138`);背景是地形/建物時,洞邊會出現 `LAND↔機體` 的 id 差(> 0.004 ⇒ `INK_MRT.ID` 0.55 的線)。這是**好事**:它讓正在 dissolve 的機體邊緣自己出線,正是「賽璐璐件不失去自己的輪廓」那句話要的;深度那一支同樣會在洞邊給出 `e > 0`(凹邊 ×0.42)。要記錄的是**它不是免費的**:洞的螢幕尺寸太小時整台機體會被墨點蓋掉 ⇒ 抖動格距 MUST 以世界公尺給,並在定裝照上目視。

### 軟性快取鍵(dissolve 也 MUST 進)
`public/js/toon.js:966`

現行:
```js
  mat.customProgramCacheKey = () =>
    `cel${metal ? 'M' : ''}${wash > 0 ? 'W' : ''}${moss ? 'S' : ''}${cool > 0 ? 'C' : ''}${paint ? 'P' : ''}${paint?.face ? 'G' : ''}${paint?.flat ? 'F' : ''}${soft ? `Q${soft.k}${inkable ? 'I' : ''}` : ''}${landNrm ? 'L' : ''}${rim}`;
```

**改成**: 尾端加 `${dissolve ? 'D' : ''}`。理由與 `landNrm ? 'L'` 逐字相同:defines 不同卻共用同一支已編譯的程式 ⇒ 那一批材質整批**沒有** dissolve 或整批**都有**,而畫面上只表現成「有些載具會溶入、有些不會」。`audit_soft_stroke`(:196)與 `audit_cel_pipeline`(:384)那兩條斷言都是子字串比對 ⇒ 追加不會弄紅它們。

### 反轉外殼描邊(dissolve 期間必須處理,但不准動它的快取鍵)
`public/js/toon.js:1110`

現行:
```js
  m.customProgramCacheKey = () => 'celOutline';
```

**改成**: **MUST NOT 為 dissolve 給外殼加 define** —— 全專案每一片外殼共用這一把鍵、共用一支程式,加了 define 而鍵不變 = three 給部分外殼發錯程式(不報錯);把鍵改成逐單位變體則要讓 `outlinify(root, width)` 一路吃到 forge 的收尾鉤。本輪落地:驅動端在 dissolve 期間把該單位的外殼 `shell.visible = false`(`userData.isOutline` 已經是現成的判據,`toon.js:1154`),結束那一幀復原。**代價要寫在原地**:輪廓在最後一幀由「只有勾線 pass」變成「勾線 + 外殼」,線寬會跳一下;若定裝照看得出來,升級路徑是逐單位快取鍵變體(`'celOutlineD'`),那時外殼與本體同吃一顆 `celDisU`。

### 招式載具的三格旗標(dissolve 的唯一觸發點)
`public/js/game.js:3230`

現行:
```js
      flies: e.k === 'heli' || e.k === 'decoy' || e.k === 'kami' || e.k === 'hyper',
      decoy: e.k === 'decoy', kami: e.k === 'kami', hyper: e.k === 'hyper', si: e.si || 0,
```

**改成**: 在這裡(`_spawnUnit`)判 `ent.kami || ent.decoy || ent.hyper` ⇒ 記 `ent.disT0 = now`,並 traverse 收 `celDisU` 與外殼清單(與 `morphrig.fadeTargets` 同一個做法)。**只掛這三種**:①它們就是計畫點名的「載具投放 / 輔助機隊到場」(輔助機隊渲染沿用 `kind:'kami'`,見 seams-abilities「自身強化型」⑧「恰兩個具名生成點」)②`_spawnUnit` 是**所有**單位的入口,無差別掛上去 = 每一隻小兵進迷霧都溶入一次,而且會與 `_enemyMark` 的淡入(:3510)疊在一起。材質是逐單位新建的(`geo3d.mat()` → `toonMat` 每個零件各一份,forge 每次 `makeUnit` 重鍛)⇒ 逐單位 dissolve 不會漏到同型的其他單位身上。

### 逐幀推進點
`public/js/game.js:8138`

現行:
```js
  _updateEnts(dt, now) {
```

**改成**: 在既有迴圈裡推進 dissolve:`if (ent.disT0 != null) { const k = dissolveAt(now - ent.disT0); … 寫 celDisU.value 與 uDisO;k >= 1 ⇒ ent.disT0 = null 並復原外殼 visible }`。**MUST 在 `disT0` 清掉之後一格都不再碰材質**(同 `locomotion.js:502` 的 `if (e.a === a) continue` —— 每幀寫 uniform 不貴,但「結束了還在寫」會讓後續任何人改那顆 uniform 都被蓋掉)。

### 轉場的兩個呼叫點之一(結算遮幕)
`public/js/game.js:3131`

現行:
```js
    if (m.over) { this._gameOver = true; this._deathSeq = null; this.hud.deathCine?.(false); this.hud.over?.(m.winner, m.stats); }
```

**改成**: 改成:`_gameOver` / `_deathSeq` / `deathCine` 三件事**照舊立刻做**(它們是狀態閘,延後會讓暫停選單在結算時彈出來);只有 `hud.over` 改成 `this.playWipe('cover', () => this.hud.over?.(m.winner, m.stats))`,而 `playWipe` 在旋鈕關著時 MUST **當場同步呼叫 callback 並回 false** ⇒ 旋鈕關 = 逐位元同舊制(含時序)。回呼 MUST 由幀迴圈的 `_tickWipe` 觸發、MUST NOT 用 `setTimeout`(離場/重賽會在幕播到一半發生,計時器留下來就是下一場冒出上一場的結算頁 —— `dialogue.js` 檔頭紀律②的同一條)。

### 轉場的每幀推進與繪製順序
`public/js/game.js:8866`

現行:
```js
    this.pipeline?.setDofBlend(this.side && !this.dead
      ? dofAimBlend(this.camera.fov, this.baseFov, UNITS[this.heroKind]?.zoomFov ?? this.baseFov) : 0);
    // 後製管線結束時 render target 一律歸零 ⇒ 後面的 PiP / 陣亡鏡頭照樣直接畫在畫布上(行為不變)
    if (this.pipeline) this.pipeline.render(); else this.renderer.render(this.scene, this.camera);
    this._renderPips();
```

**改成**: 在 `pipeline.render()` **之前**插一行 `this._tickWipe(dt)`(唯一寫入點,轉呼 `pipeline.setWipe(w1, w2, flash)`),與上面 `setDofBlend` 同一段。**要在原地記下的限制**:`_renderPips()` / `_renderDeathCam()` / 小地圖 / 所有 DOM HUD 都畫在管線**之後** ⇒ 幕只蓋 3D 主畫面。這是可接受的(結算頁本來就蓋住全部),但 MUST NOT 靠再寫一份 DOM 幕去「補完」—— 那就是同一個轉場的第二份實作,兩份的傾角與時間曲線遲早分家。

### 轉場的形狀與時間軸(唯一縫,離線可驗)
`public/js/data.js:902`

現行:
```js
  TAPS: 8,         // 圓盤取樣數(低功耗折半;分布與展開全在 postfx.js)
};
```

**改成**: 其後新增 `WIPE`(`INC` 傾斜 / `SOFT` 幕緣 / `COVER_S` / `REVEAL_S` / `FLASH_S` / `FLASH_VIB` / `FLASH_CON` / `FLASH_BRI`)+ 純函式 `wipeAt(mode, t) → { w1, w2, flash, done }`(`mode ∈ 'cover' | 'reveal'`,進度先過 smoothstep;`t ≤ 0 ⇒ w=0`、`t ≥ dur ⇒ w=1`,兩端是**定義**不是校準),以及 dissolve 那一半的 `DISSOLVE`(`IN_S` / `CELL_M` / `KIND`)+ `dissolveAt(t)`。放 `data.js` 的三個理由:①它是 Node 端載得動的純資料 ⇒ 稽核吃得到真品而不是 regex 猜;②與 `DOF`/`CURVE`/`SHADOW`/`DAYCLOCK` 同層(純表現層常數住這裡是既有慣例);③**不進 `balanceFingerprint`**(:5874 只雜湊 `UNITS/CHARACTERS/WEAPONS/ECON/SQUAD/GAME`)⇒ `botPolicy.js` 不會被判過期 —— 這一條落地時 MUST 實跑 `audit_bot_policy` 確認。幕色**不進 `WIPE`**:由呼叫端餵(`SIDES[side].color`,`data.js:10`),避免與 `toon.js OUTLINE_COLOR` 開出第二份墨色。

### 轉場旋鈕
`public/js/visualPrefs.js:32`

現行:
```js
export const VISUAL_KNOBS = {
```

**改成**: 新增 `wipe: { label: '轉場動畫', def: 'off', choices: ['off','on'], choiceLabels: { off: '關', on: '開' }, hint: … }`。`def: 'off'` 是**計畫書指定**(序 8「旋鈕預設關 = 逐位元同舊制」),而它與紀律①(`def` = 交付定案值)有張力 —— 見 blockedOn 第 1 條。`main.js renderVisualSettings`(:2770)由這張表推導 ⇒ 設定頁**一行都不用改**;`audit_visual_prefs` Ⅰ 的 `length >= 4` 與型別推導斷言自動涵蓋新列。

### 新稽核落點(轉場)
`tools/audit_visual_prefs.mjs:429`

現行:
```js
console.log('\nⅥ 景深模糊(data.js DOF + postfx 的 pass)');
```

**改成**: 其後新增 **Ⅶ 斜向轉場**,結構逐條鏡射 Ⅵ(它是同一種東西:旋鈕 + 一支加成本的 pass):Ⅶ-a 時間軸兩端是定義(直接執行 `wipeAt`)、Ⅶ-b 順序 MUST 在 grade 之後 fxaa 之前(切 `chain` 原文比索引)、Ⅶ-c 0 ⇒ 整個 pass 退出鏈、Ⅶ-d 旋鈕預設 `off` 且 `playWipe` 在關著時同步走回呼、Ⅶ-e 幕在 p ≥ 1 時 MUST 全螢幕覆蓋(原文釘 `if ( p >= 1.0 ) return 1.0;` 那一行,而不是靠數值近似)、Ⅶ-f flash 的對比樞軸 MUST 是 0.18(線性中灰,與 `GRADE` 的 `smoothstep(0.18, 0.72, l)` 同一把尺)、Ⅶ-g `setWipe` 恰一份實作、`game.js` 恰兩個呼叫點。

### 新稽核落點(dissolve 與霧≡勾線)
`tools/audit_cel_pipeline.mjs:290`

現行:
```js
console.log('\nⅥ 勾線資訊緩衝的材質契約(A 方案)');
```

**改成**: Ⅶ 之後新增 **Ⅷ dissolve 的材質契約**(`discard` 錨點排在 `opaque_fragment` **之前**、`CEL_DIS` 進快取鍵、`uDis` 的 uniform 物件住 `mat.userData` 而不是在 `onBeforeCompile` 裡新建、外殼 MUST NOT 動 `'celOutline'` 這把鍵、資訊緩衝附件 1 MUST 是 `NearestFilter` 且前提 `INK.THICK === 1.0` 一併斷言)與 **Ⅸ 霧範圍 ≡ 勾線淡出**(`postfx.js` 原文不得再出現 `uFar * ${INK.FADE`、`_inkFadeM` 恰一份、`scene.fog` 缺席退回舊式、地板 `combatReachM() / INK.FADE_F` 讓 `fadeStart ≥ combatReachM()` 恆成立 —— 逐隊制 × 逐天氣掃一遍印表)。Ⅵ 那一段的 `EXEMPT = new Set(['postfx.js'])`(:312)已經涵蓋新的 wipe 材質,**不必改**。

## 寫入檔案
- `public/js/postfx.js` (edit) — 新增 wipe pass(材質 / uniform / setWipe 唯一寫入點 / chain 插點 / dispose);勾線淡出改吃 `_inkFadeM()`;`INK.FADE_F`;`_mkRT` 的資訊緩衝附件改 NearestFilter
- `public/js/data.js` (edit) — 新增 `WIPE` + `wipeAt()`、`DISSOLVE` + `dissolveAt()`(純函式,離線可驗;不進 balanceFingerprint)
- `public/js/visualPrefs.js` (edit) — 新增 `wipe` 互斥旋鈕(def 'off')
- `public/js/toon.js` (edit) — `applyCelPatch` 加 `dissolve` 選項(define / uniform 物件 / discard 錨點 / vDisP varying / 快取鍵);檔頭補「discard 與 gInfo 哨兵的真實交互」
- `public/js/game.js` (edit) — `playWipe`/`_tickWipe` 驅動(唯一寫入點)+ 兩個呼叫點(開戰揭幕 / 結算遮幕);`_spawnUnit` 掛三種載具的 dissolve 起點;`_updateEnts` 推進與外殼收放
- `tools/audit_visual_prefs.mjs` (edit) — 新增 Ⅶ 斜向轉場 + `--break-wipe`
- `tools/audit_cel_pipeline.mjs` (edit) — 新增 Ⅷ dissolve 材質契約 + Ⅸ 霧≡勾線淡出,以及 `--break-dissolve` / `--break-fade`
- `tools/audit_gpu_lifecycle.mjs` (edit) — ⑦ 段的全螢幕材質數(4 → 5)與那兩行已經過期的「三個」註解;wipe 材質也要進 dispose 斷言
- `tools/audit_ground_tile.mjs` (edit) — ④-4 純註解:共面硬幣拋(圖內三層與地形**刻意共面**、lift 階梯、polygonOffset)的 symptom 敘事
- `tools/audit_ground_drape.mjs` (edit) — ④-4 純註解:「兩片共用同一塊地的地表,任何位移 MUST 兩邊同量」(SAG 的每一層同吃一份場)
- `tools/audit_road_joint.mjs` (edit) — ④-4 純註解:路口三條線(車道走到對向路緣線 / 人行道停在近側 / 次要臂抵住主要臂)與緣石帶 polygonOffset
- `tools/audit_traverse.mjs` (edit) — ④-4 純註解:平台盒 MUST 重疊不得相接(取 max 的高度查詢四邊皆排他;玩家幾乎不會踩到接縫,泛洪格每次都踩到)+ 純視覺帶不進碰撞 ⇒ 連通性檢查永遠看不到它
- `tools/audit_layer_block.mjs` (edit) — ④-4 純註解:站立面/板體是同一條規則的兩端(既有 Ⅴ 的延伸),補「無主的門檻」那一列
- `tools/audit_underpass.mjs` (edit) — ④-4 純註解:`UND.COPE` 緣石帶是本專案唯一的緣石,而它**純視覺不進碰撞**——「車道經過處要斷緣石」在這裡的對應症狀
- `tools/shot_scene.mjs` (edit) — ④-4 純註解:把「材質改動 → 像素完全相同 = 那面沒被畫」這個判讀法寫進定場照 A/B 的檔頭(這支就是本專案的像素比對器);另加 `--wipe` 圖層隔離旗標與五種天氣的 ④-3 對照拍法
- `.claude/rules/seams-render.md` (edit) — §2.1 F 新增三列縫:畫面轉場(斜向 wipe)/ 物件出現(dissolve discard)/ 霧範圍 ≡ 勾線淡出
- `CLAUDE.md` (edit) — §2.1 的 seams-render.md 主題列追加上述三個主題名(目錄查不到 = 有人會以為沒有規則)
- `.claude/rules/verification.md` (edit) — §5.1(續)補 `--break-wipe`/`--break-dissolve`/`--break-fade`;§5.5 新增一列「畫面轉場 / dissolve / 勾線淡出錨」→ 要跑什麼
- `docs/anime_style_plan.md` (edit) — 執行紀錄追加序 8 一列(做了什麼 / 用什麼守住 / 留下什麼),含 ④-3 的天氣對照表與未落地的 ④-2 消失那一半

## 步驟
1. 步 0(基準,MUST 先做):跑一次現況全綠並留檔 —— `node tools/audit_cel_pipeline.mjs`、`node tools/audit_visual_prefs.mjs`、`node tools/audit_gpu_lifecycle.mjs`、`node tools/audit_soft_stroke.mjs`、`node tools/audit_client_syntax.mjs`、`npm run bal`、`npm test`(先照 §5.2 重啟伺服器)。另在真瀏覽器拍一組 `shot_scene` 定場照當基準(㋓),**五種天氣各一輪**(`--weather clear|cloudy|rain|snow|fog`,沒有這個旗標就先加),因為 ④-3 要拿它們做 A/B。
2. 步 1(④-3,獨立可驗,不動任何新機制):`postfx.js` 加 `INK.FADE_F` 與 `_inkFadeM()`,勾線 shader 的 `uFar * FADE0/FADE1` 換成 `uFade0/uFade1` 兩個 uniform,由 `render()` 的共用接線每幀寫。驗:`node tools/audit_cel_pipeline.mjs`(新 Ⅸ)+ `--break-fade`;`npm run bal` / `npm test` MUST 逐項不動(`data.js`/`sim.js` 一行未改)。㋓:`shot_scene` 五種天氣 A/B —— `clear` MUST **像素相同**,其餘四種 MUST 看得出遠景的線收在霧裡。
3. 步 2(④-3 的地板):把 `combatReachM() / INK.FADE_F` 這個下界加進 `_inkFadeM()`,並在稽核裡逐隊制(mini/L1/L2/L3)× 逐天氣印出 `[fadeStart, fadeEnd]` 與 `fadeStart ≥ combatReachM()` 的判定。驗:同步 1;另確認迷你 + 霧天不再出現 `fade0 > fade1`。
4. 步 3(④-2 前置,逐位元中性):`_mkRT` 把資訊緩衝附件 1 改 `NearestFilter`,並在 `audit_cel_pipeline` Ⅷ 加上「前提 `INK.THICK === 1.0`」那一條。驗:`audit_cel_pipeline` 全綠;㋓ `shot_scene --pref inkMrt=on --pref lutSrc=baked` 前後 md5 **逐位元相同**(取樣點落在 texel 中心 ⇒ 這一改本來就沒有數值差)。
5. 步 4(④-2 機制):`data.js` 加 `DISSOLVE` + `dissolveAt()`;`toon.js applyCelPatch` 加 `dissolve` 選項(define / `mat.userData.celDisU` / `vDisP` / discard 錨在 `#include <clipping_planes_fragment>` / 快取鍵加 `D`)。此步**不接任何呼叫端** ⇒ 全專案逐位元不動。驗:`node tools/audit_client_syntax.mjs`(㋖)+ `audit_cel_pipeline` 新 Ⅷ + `audit_soft_stroke`(快取鍵那一條 MUST 仍綠)。
6. 步 5(④-2 接線):`game.js` 在 `_spawnUnit` 對 `kami/decoy/hyper` 記 `disT0` 並收集 `celDisU` 與外殼清單;`_updateEnts` 推進、結束時清旗標並復原外殼 `visible`。驗:`audit_client_syntax`;`npm run bal` / `npm test` MUST 逐項不動;㋓ 真瀏覽器單機開一場放大招看三種載具溶入 + 拍 dissolve 定裝照(k = 0 / 0.25 / 0.5 / 0.75 / 1 五格,背景各拍一次天空與地形 —— 洞邊的墨線在兩種背景下是**不同**的行為,見 seams 第 9 列)。
7. 步 6(④-1 機制):`data.js` 加 `WIPE` + `wipeAt()`;`visualPrefs.js` 加 `wipe` 旋鈕(def 'off');`postfx.js` 加 `_wipeMaterial()`、`setWipe()`(唯一寫入點)、`setWipeColor()`、chain 插點與 dispose。此步**不接呼叫端**、旋鈕預設關 ⇒ 逐位元不動。驗:`audit_visual_prefs` 新 Ⅶ + `audit_gpu_lifecycle` ⑦(材質數 4→5)+ `audit_client_syntax`。
8. 步 7(④-1 接線):`game.js` 加 `playWipe(mode, onCut)` / `_tickWipe(dt)`(排在 `pipeline.render()` 之前),兩個呼叫點 = 開戰第一幀 `reveal`、`m.over` 的 `cover`(回呼裡才叫 `hud.over`);旋鈕關著時 `playWipe` MUST 同步走回呼並回 false。驗:`audit_visual_prefs` Ⅶ + `--break-wipe`;`npm test`(結算流程)+ `npm run bal` 逐項不動;㋓ 把旋鈕打開錄一段開戰與結算。
9. 步 8(④-4,純文件,不動 .js):把 SKILL 的 symptom 列逐條併進六支稽核檔頭(見 files 那六列的 why)。驗:六支稽核**逐項不動**(只有註解變)+ `node tools/audit_src.mjs` 沒有這一支,改用「跑一遍那六支,pass/fail 數與改前逐字相同」當閘。
10. 步 9(文件收尾):`.claude/rules/seams-render.md` 加三列縫、根 `CLAUDE.md` §2.1 F 主題列同步、`verification.md` §5.1 補三個 `--break-*` 與 §5.5 新增一列、`docs/anime_style_plan.md` 執行紀錄追加序 8。驗:`grep -rn` 確認三個新主題名在根檔查得到(§2.1 的鐵律:目錄裡查不到會被當成沒有規則)。

## 稽核
- `node tools/audit_cel_pipeline.mjs`
- `node tools/audit_cel_pipeline.mjs --break-dissolve`
- `node tools/audit_cel_pipeline.mjs --break-fade`
- `node tools/audit_cel_pipeline.mjs --break-inkinfo`
- `node tools/audit_cel_pipeline.mjs --break-land`
- `node tools/audit_cel_pipeline.mjs --break-lutland`
- `node tools/audit_cel_pipeline.mjs --break-scale`
- `node tools/audit_visual_prefs.mjs`
- `node tools/audit_visual_prefs.mjs --break-wipe`
- `node tools/audit_gpu_lifecycle.mjs`
- `node tools/audit_soft_stroke.mjs`
- `node tools/audit_client_syntax.mjs`
- `node tools/audit_client_syntax.mjs --break-glsl`
- `node tools/audit_daynight.mjs`
- `node tools/audit_world_curve.mjs`
- `node tools/audit_ground_tile.mjs`
- `node tools/audit_ground_qc.mjs`
- `node tools/audit_ground_seam.mjs`
- `node tools/audit_ground_enclave.mjs`
- `node tools/audit_ground_border.mjs`
- `node tools/audit_road_joint.mjs`
- `node tools/audit_layer_block.mjs`
- `node tools/audit_open_tunnel.mjs`
- `node tools/audit_underpass.mjs`
- `node tools/audit_siteplan.mjs`
- `node tools/audit_beacons.mjs`
- `node tools/audit_object_joints.mjs --seeds 8`
- `node tools/audit_world_edge.mjs`
- `node tools/audit_bot_policy.mjs`
- `node tools/audit_solo_boot.mjs`
- `npm run audit:net`
- `npm run bal`
- `node server/server.js  # §5.2:先 netstat/taskkill 清乾淨再起,否則 npm test 測到舊程式碼還全綠`
- `npm test`
- `node tools/shot_scene.mjs --venue taroko   # ㋓ 基準組(改前先拍)`
- `node tools/shot_scene.mjs --venue taroko --weather clear   # ㋓ ④-3:clear MUST 像素相同`
- `node tools/shot_scene.mjs --venue taroko --weather fog     # ㋓ ④-3:霧天的線 MUST 收在霧裡`
- `node tools/shot_scene.mjs --venue taroko --pref inkMrt=on --pref lutSrc=baked   # ㋓ 步 3 的 NearestFilter MUST md5 逐位元相同`
- `node tools/audit_ground_drape.mjs --venue taroko   # ㋓ ④-4 改的是它的檔頭,順帶確認讀數不動`
- `node tools/audit_cockpit.mjs   # ㋓ game.js 動過(㋔ 相鄰),SVS_URL MUST 指向本工作區的埠`
- `node tools/audit_muzzle.mjs    # ㋓ 同上`

## 反向驗證
- `--break-wipe` — 壞版: 把 `chain` 那一列的閘門從 `this.enabled.wipe && this._wipeA > 0` 退成無條件 `chain.push('wipe')`(= 「跑一個乘 0 的 pass」),同時把 `wipeAt` 的 `t >= dur` 端點從 1 改成 0.98(幕不再全覆蓋) ⇒ **MUST 紅**: `audit_visual_prefs` Ⅶ-c「0 ⇒ 整個 pass 退出鏈(旋鈕關 = 逐位元同舊制)」與 Ⅶ-e「p ≥ 1 MUST 全螢幕覆蓋」各一條紅字;Ⅶ-b(順序)MUST 仍綠 —— 只紅該紅的那兩條才代表閘門認的是這兩件事
- `--break-dissolve` — 壞版: 把 `applyCelPatch` 的 `discard` 錨點從 `#include <clipping_planes_fragment>` 移到 `#include <opaque_fragment>` **之後**(= 顏色與 gInfo 都已經寫完才 discard),並把 `${dissolve ? 'D' : ''}` 從 `customProgramCacheKey` 拿掉 ⇒ **MUST 紅**: `audit_cel_pipeline` Ⅷ 的「discard 排在 opaque_fragment 之前」與「CEL_DIS 進快取鍵」兩條紅字;Ⅵ 的既有五條 MUST 仍綠
- `--break-fade` — 壞版: 把勾線淡出退回 `ink *= 1.0 - smoothstep( uFar * 0.55, uFar * 0.95, d )`(錨回相機 far) ⇒ **MUST 紅**: `audit_cel_pipeline` Ⅸ 的「淡出錨 MUST 是 scene.fog 不是 camera.far」「`_inkFadeM` 恰一份」「逐天氣 fadeEnd ≤ fog.far + 地板」三條紅字
- `--break-nearest` — 壞版: 把 `_mkRT` 的資訊緩衝附件從 `NearestFilter` 改回 `LinearFilter`(併進 --break-dissolve 亦可,但分開比較讀得出來) ⇒ **MUST 紅**: `audit_cel_pipeline` Ⅷ 的「附件 1 MUST 是 NearestFilter(類別碼是**類別**,線性內插會插出一個不存在的類別)」紅字
- `--break-inkinfo(既有,MUST 仍咬得住)` — 壞版: 模擬新增了一支進場景的 ShaderMaterial 卻忘了宣告 gInfo(現行實作打在 vfx.js 上) ⇒ **MUST 紅**: `audit_cel_pipeline` Ⅵ「每一支都宣告了 gInfo」紅字 —— 這一輪新增的 wipe 材質住在 `postfx.js`(EXEMPT 名單內、從不進場景),所以這條 break 的紅字內容 MUST 與改前逐字相同;內容變了就是有人把 wipe 材質誤放進場景了
- `--break-damp / --break-tap / --break-debounce(既有,回歸對照)` — 壞版: 不改本輪任何東西,只確認前兩輪的反向驗證仍咬得住 ⇒ **MUST 紅**: `audit_damp_fps`/`audit_touch_gesture` 的既有紅字數與改前逐字相同(本輪動過 game.js,這是最便宜的回歸哨兵)

## 會靜默壞掉的地方
- **FXAA 不在鏈尾 = 畫面整片變暗變濁**。它兼任線性→sRGB(`postfx.js:791-794` 的註解已經寫過這個坑)。把 wipe 插在它之後不會有任何錯誤訊息,只會讓幕色被當成 sRGB 再轉一次、而且幕的斜邊變成裸鋸齒。
- **flash 的對比樞軸寫成 0.5 而不是 0.18**:RT 是線性的,線性 0.5 已經是很亮的灰;以 0.5 為樞軸拉對比會把整個畫面壓黑,而畫面上只表現成「閃光怎麼是暗的」。MUST 沿用 `GRADE` 那一段的 `smoothstep(0.18, 0.72, l)` 同一個中灰。
- **`scene.fog` 是 null 時的退路**:`_inkFadeM()` 若直接讀 `fog.far` 會拿到 `undefined` ⇒ `smoothstep(NaN, NaN, d)` ⇒ **整片沒有線**,而每一條離線斷言都會過(它們讀的是原文不是執行結果)。
- **資訊緩衝留 `LinearFilter`**:dissolve 在 1 texel 尺度上交替「有寫 / 沒寫」gInfo,線性內插把 `.a` 混成 HARD 與 NONE 之間 = 0.5 = LAND ⇒ 一台正在溶入的機體被 3D LUT 的地貌分支接手(色度不再過表)。序 3 的打包編碼落地之後同一個坑會變成「類別碼直接解錯」。
- **`INK.THICK` 一旦不是 1.0**,步 3 那句「NearestFilter 是逐位元中性的」就不成立(取樣點不再落在 texel 中心)。稽核 MUST 把 `INK.THICK === 1.0` 當成 Ⅷ 的前提斷言寫出來,而不是當常識。
- **外殼描邊共用 `'celOutline'` 一把快取鍵**:給部分外殼加 define 而鍵不變,three 會發錯程式 —— 症狀是「有些機體的描邊行為跟別人不一樣」,沒有錯誤訊息。本輪走 `shell.visible` 切換就是為了完全避開這件事。
- **`uDis` 的 uniform 物件若在 `onBeforeCompile` 裡新建**(`{ value: 1 }`),材質一重編譯(改 defines / `needsUpdate`)就換一顆,驅動端抓著的是舊的 ⇒ 「有時候不會 dissolve」。MUST 住 `mat.userData`,同 `_windT`/`_rampTint` 的做法。
- **`this.ents` 有 20 個以上的消費端(含準星解算與鎖定)**:任何「延後 `_removeEnt` 讓它溶出」的做法都會讓客戶端把準星解到一個伺服器已經沒有的目標上 ⇒ 開火路徑吃到幽靈解。本輪只做出現那一半正是為了這個。
- **`hud.over` 延後 `WIPE.COVER_S`**:若用 `setTimeout` 而不是幀迴圈,離場 / 重賽 / dispose 在幕播到一半發生時會留下計時器,下一場冒出上一場的結算頁(`dialogue.js` 檔頭紀律②踩過同一個坑)。
- **`data.js` 新增常數不進 `balanceFingerprint`(:5874 只雜湊六張表)** —— 這是好消息,但 MUST 實跑 `audit_bot_policy` 確認,漏了就是整份學習策略被判過期而重跑一輪 `bot_learn`。
- **幕只蓋 3D 主畫面**:PiP / 小地圖 / 陣亡鏡頭 / 所有 DOM HUD 都畫在 `pipeline.render()` 之後。這是可接受的取捨,但 MUST NOT 用「再寫一份 DOM 幕」補完 —— 那是同一個轉場的第二份實作,傾角與時間曲線遲早分家。
- **dissolve 的洞在螢幕上太小**:深度那一支的二階差分在每一個洞邊都會給值(凹邊 ×0.42),洞越小、機體越遠,整台會被墨點蓋掉。抖動格距 MUST 以世界公尺給(不是 texel),而且只有定裝照看得出來 —— 每一條離線斷言都會過。
- **`--break-*` 的字面替換在這個 CRLF 工作區是無聲 no-op**(§5.4 ㋑):三個新 break 的樣式一律用 `\r?\n`,替換無效 MUST 當場 `process.exit(1)`;而且斷言的期望值 MUST NOT 隨 break 改變(2026-08-14 `--break-roof` 綁死現值變成靜默 no-op 的前例)。
- **④-4 是純註解,但它會動到六支稽核的檔案**:改完 MUST 逐支跑一遍確認 pass/fail 數與改前**逐字相同** —— 註解裡不小心貼進一個反引號就會…那是 .js 的坑不是 .mjs 的,但 `readSrc` 的切片標記(`audit_road_joint.mjs:37` 的 `slice()` 會在標記找不到時 throw)確實會被檔頭改動咬到。

## 逐位元中性

"**④-1 是**(旋鈕關著)。三道結構保證,不是分支:①`visualPrefs.wipe.def = 'off'` ⇒ `playWipe` 早退並**同步**走回呼 ⇒ `hud.over` 的時序也逐位元同舊制;②`_wipeA` 恆 0 ⇒ `chain` 逐字等於改前的 `['ink','dof','grade','fxaa']`(稽核切 `chain` 原文比,不是比索引);③wipe 材質從未 `render()` ⇒ 連 shader 都不會編譯。驗收面 = `shot_scene` 13 張定場照 md5 全同。\n\n**④-2 對「沒有掛 dissolve 的材質」是**:`dissolve` 預設 false ⇒ 沒有 `CEL_DIS` define、沒有 `vDisP`、沒有 discard,片段原文逐字不變,且快取鍵尾端多的是空字串。掛上去的只有 `kami/decoy/hyper` 三種載具(它們的變化就是這一項要交的東西)。步 3 的 `NearestFilter` **也是逐位元的**,而且是可證的:`uTexel = 1/size`、`t = uTexel × INK.THICK` 且 `INK.THICK === 1.0` ⇒ 五個取樣點恰落在 texel 中心 ⇒ 線性過濾回傳的就是那一顆 texel;稽核把 `INK.THICK === 1.0` 當前提釘住,驗收面 = `--pref inkMrt=on --pref lutSrc=baked` 的定場照 md5 全同。\n\n**④-3 不是,而且刻意不是**。`clear` 天氣兩端點在**實數上恆等**(`fogFar = 1.9·span` 而舊制 `FADE1 × camera.far = 0.95 × 2·span = 1.9·span`,`fadeStart` 同理由 `FADE_F = FADE0/FADE1` 保住)—— 浮點上可能差最後 1 ulp,而 1 ulp 移動一個 2280 m 的 smoothstep 端點改不動任何一個 8bit 像素 ⇒ 驗收面是 **`clear` 定場照像素相同(不是 md5 逐位元)**。其餘四種天氣是**設計上的行為改變**:線從此跟著霧收,`rain/snow/fog` 三種天氣現制是**整段**把線畫在已經飽和的霧色上。地板 `combatReachM() / INK.FADE_F` 讓「打得到的東西恆有線」變成結構保證(鏡射 DOF Ⅵ-b),迷你 + 霧天那一格因此不會出現端點反轉。\n\n**④-4 是**:六支稽核只動檔頭註解,一行執行碼都不改;`.js` 一個字都沒動 ⇒ `npm run bal` / `npm test` / 每一支稽核的 pass/fail 數逐字相同,那就是它的驗收面。"

## 卡在
- **`wipe` 旋鈕的 `def` 要不要在同一輪翻成 'on'** —— 計畫書序 8 明寫「旋鈕預設關 = 逐位元同舊制」,但那等於這一輪交付的轉場沒有任何人看得到,而 `visualPrefs.js` 紀律①又寫著「`def` 那一欄是**交付定案值**」。兩者在這一項上打架。建議:落地時 def = 'off'(照計畫),同時在交付說明裡問使用者要不要翻成 'on'。**需要裁決**。
- **④-3 要不要加「打得到的東西恆有線」地板** —— 計畫寫的是「霧範圍 ≡ 勾線淡出範圍」這個**嚴格等式**,而地板是對它的一個讓步(在迷你地圖 + 霧天那一格,霧的遠端 168 m 比交戰上界 304 m 還近 ⇒ 嚴格等式會讓打得到的目標沒有輪廓線)。不加地板則 `fade0 > fade1`(smoothstep 端點反轉)必須另外用夾制處理。建議加(它與 DOF Ⅵ-b 是同一條規則的兩端),但那是對計畫原文的偏離。**需要裁決**。
- **序 3(①-1 `outlineContribution` 打包)尚未落地,而它與 ④-2 共用 `_mkRT` 的 `NearestFilter` 修正** —— 計畫的執行紀錄把那一條列在 §0-c 的「連帶必須一起改」。兩項若並行開發,MUST 由先落地的那一項帶進來、另一項不得再寫第二份。**依賴其他項目 / 需要協調誰先做**。
- **④-2 的「消失」那一半本輪不做** —— 計畫點名的三個用途裡,「載具投放 / 輔助機隊到場」是出現,「遠距剔除」與載具離場是消失。消失需要把 mesh 從 `this.ents` 摘出來丟進一份 ghost 清單(`this.ents` 有 20 個以上的消費端,含準星解算與鎖定光暈 ⇒ 延後移除會讓客戶端解到幽靈目標),而「遠距剔除」這個功能本身**還不存在**(`data.js DOF` 檔頭:「日後真做距離剔除時,物件消失的邊界已經在全糊帶裡」)。**需要使用者確認範圍**:本輪只做出現,還是把 ghost 清單與距離剔除一起做進來。
- **外殼描邊在 dissolve 期間的處理方式** —— 本輪走「隱藏外殼、輪廓交給勾線 pass」,代價是結束那一幀線寬會跳一下。升級路徑是逐單位的 `'celOutlineD'` 快取鍵變體(要讓 `outlinify` 的旗標一路穿過 forge 的收尾鉤)。**要不要現在就走升級路徑,取決於定裝照看不看得出來 ⇒ 需要真瀏覽器(㋓)**。
- **`hud.over` 延後 `WIPE.COVER_S`(≈0.34 s)是行為/時序改動**,雖然旋鈕關著時逐位元同舊制。**需要確認可接受**,否則 `cover` 這個模式在本輪就沒有呼叫點(而未接線的 pass 是死碼)。
- **需要真瀏覽器 / 沙箱跑不動(㋓)**:`shot_scene` 五種天氣 A/B(④-3 唯一的驗收面)、`shot_scene --pref inkMrt=on` 的 md5 比對(步 3)、dissolve 的五格定裝照(天空背景與地形背景各一組 —— 洞邊的墨線在兩種背景下是不同的行為)、轉場錄影、`audit_cockpit`/`audit_muzzle`(㋔ game.js 相鄰)。這些 MUST 在交付說明中標為未驗項。
