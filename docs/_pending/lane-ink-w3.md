# lane-ink 第三階段(窗 3)—— §0-b 賽璐璐學派切換(序 12)

> 2026-08-16。本檔是 **文件凍結** 的產物:平行窗期間沒有任何一道寫 `CLAUDE.md` /
> `.claude/rules/**` / `docs/anime_style_plan.md` / `public/js/.claude.md` / `tools/CLAUDE.md`,
> 差異寫在這裡由整合者最後序列合併。
>
> 本輪擁有並改動的檔案:`public/js/toon.js`・`public/js/data.js`(**只改註解**)・
> `tools/audit_cel_pipeline.mjs`・`tools/audit_visual_prefs.mjs`・`tools/audit_soft_stroke.mjs`
> (`visualPrefs.js` 的 `celSchool` 旋鈕窗 1 已加,本輪一格未動;`postfx.js` / `matsample.js` /
> `audit_gpu_lifecycle.mjs` / `shot_scene.mjs` 本輪未改)。

> **封存註記（2026-08-19）**：本檔保留當時的待裁決上下文，不再是現況來源。
> 正式定案已記在 `docs/anime_style_plan.md` 第十七輪：School B 預設、`HUE_MIN_A = 1.5`、
> `bands=4` 維持單一硬切兩色；`visualPrefs.js` 與 `toon.js` 為執行真品。

---

## ① `.claude/rules/seams-render.md` §2.1 F 要改寫 / 新增的那一列(原文)

### 改寫:「賽璐璐明暗階梯」那一列

| 賽璐璐明暗階梯(**兩派,縫仍是一份**) | 學派定案 `toon.js` 的 `_school`(模組載入時一次)+ 旋鈕 `visualPrefs.celSchool`(`a`/`b`,def `a`)+ `?cel=a|b`;**School A** = `RAMPS` + `toonGradient(bands)` + `rampFloor(bands)` + `RAMP_PATCH_A`;**School B** = `CEL_CUT` + `cutOf(bands)` + `RAMP_PATCH_B` + `CEL_LUM_GLSL`/`CEL_KEY_GLSL`/`CEL_CUT_DECL_GLSL`/`CEL_CUT_MIX_GLSL` + `celCutUniforms()`;色相兩派共用 `SHADOW_HUE`/`shadowTintRGB()`/`_rampTint` 兩軌 | 2026-08-16 使用者定案「§0-b 換賽璐璐學派」。**縫只有 `toon.js` 一份、消費端一行不改**。①**學派是模組載入時定案的 JS 常數**(同 `installWorldCurve` 讀 `?curve=0`),MUST NOT 做成每幀可切的共享 uniform —— 所有 School B 的東西都包在 `_school === 'b'` 的**字串拼接**裡 ⇒ School A 走的是同一份 GLSL 原始碼,不是「同一支程式裡的另一條分支」,連 mix/select 造成的浮點重排都不存在(代價:切換後要重開一場,寫在 hint 裡)。②**`bands` 這個參數不消失,語意變成「這一刀有多硬」**(2 最硬 → soft 最軟),帶寬與中點 MUST 嚴格遞增 —— 那是把「階數越多層次越多」翻成「唯一那一刀越寬」的唯一合法映射,序一破,四個既有 `bands:` 呼叫端(terrain ×2 / worldtext / matsample)的語意就全反了;⚠ `bands = 4` 的**中間那一階在硬切下是真的消失了**(一刀只有一個終端),整片山坡回到兩塊色 —— 這是**待裁決③**。③**A14 的等價保證**(見 ④):值的地板 `CEL_CUT.SHADOW_V ≥ rampFloor(3)` 且**推導不手寫**(`rampFloor(3) × SHADOW_V_F`,102 只准有一份家);色相偏移的亮度中性在硬切路徑上的等價式是 `luma(暗側) ≡ SHADOW_V × luma(亮側)`,靠重組裡那一行**重正規化**成立 —— `luma` 是內積,對逐通道乘法**不是乘性的**(純紅基色上比值就是 `tint.r`),少了它就是「把亮度藏進色相」的後門。④**唯一分岔點是 ramp 查表那一行**:School B 換成回傳線性 `saturate(dotNL)` ⇒ `reflectedLight.directDiffuse` 自動變成「已乘過**陰影遮罩**與燈色的累積直接光」(three r160 把 `getShadow()` 乘進 `directLight.color`,而 `RE_Direct_Toon` 在那之後才呼叫 `getGradientIrradiance()`)——「投影遮蔽與 N·L 被同一刀量化」是這一行的直接推論,**不需要任何新的 three 錨點**。⑤**切的輸入 MUST 把 albedo 除掉**(分母 = 同一格的全受光值)—— 直接拿含 albedo 的 `directDiffuse` 當門檻,0x0a 的深色裝甲永遠跨不過去 = 「這台機體永遠背光」;除完之後單一主光時 `celLit ≡ dotNL × shadow` 是**恆等式**(albedo 與燈色逐通道約掉)。⑥**主光色 MUST 讀 three 自己的 `directionalLights[i].color`**(= color × intensity),MUST NOT 在 JS 端存第二份 —— 副本要有一個每幀餵它的呼叫端,兩份數字遲早分家,而症狀是「夜戰的暗側是一個與太陽無關的常數」、`DAYCLOCK` 整套在畫面上靜默失效,`audit_daynight` 每一條斷言照樣全綠(它量的是資料不是像素)。⑦**`CEL_COOL` 在硬切下 MUST 關掉**(它自己有一條 smoothstep 終端,並存 = 同一顆物件上兩條位置不同的明暗界),defines 與 `customProgramCacheKey` 吃**同一個** `coolOn`。⑧重組 MUST 排在 rim / metal **之前**(它們是加成式演出),`indirectDiffuse` 與 `totalEmissiveRadiance` MUST 重新加回來(忘了就是全場自發光件在夜裡熄滅,而不報錯)。⑨**替換錨點對不上 ⇒ School B 退回 School A**(原則 6),MUST NOT 硬切一個已經量化過的 ramp 值(那一刀切在階梯上 = 終端線變鋸齒)。⑩**投影軟硬是學派的一部分**:`PCFSoftShadowMap` 配硬切(先柔化再量化 ⇒ 終端線更短更乾淨),現況已經是它 ⇒ 沒有程式要改,缺的只有守它的那一條斷言。稽核 `audit_cel_pipeline` Ⅺ ±`--break-school`/`--break-cutfloor`/`--break-neutral`/`--break-cutorder`/`--break-schoolmix`/`--break-shadowtype` + `audit_visual_prefs` Ⅰ・Ⅱ |

### 新增:「只掛學派、不掛演出的賽璐璐材質」

| 只掛學派、不掛演出 | `toon.js toonPlain(params)` | 那幾處**刻意**不吃 cel 補丁的 `MeshToonMaterial`(`biomes.js` 的 GLB 植被不透明樹幹、洞頂 / 潮間帶 / 水簾三層透明覆蓋)在 School A 下無害,School B 下留在 ramp 而全世界改硬切 = **同一棵樹的葉子硬切、樹幹漸層**,沒有任何錯誤訊息。三條:①**School A 下完全不掛 `onBeforeCompile`** ⇒ 逐位元等於今天那一行裸的 `new THREE.MeshToonMaterial({ …, gradientMap: toonGradient() })`(這是「最小侵入」唯一的證據面:定場照 md5 全同);②MUST NOT 順手改成 `toonMat` / `envMat` —— 那會加上 rim 與 gInfo 覆寫,而樹幹那一行的 `rim: 0` 是刻意的、gInfo 覆寫會讓折邊勾線多出線;③軌固定走 `env`。⚠ **呼叫端的改寫本輪沒做**(`biomes.js` 是 lane-world 的檔),故 `audit_cel_pipeline` Ⅺ⑧ 把它訂成一條**硬規則**:繞過 `toon.js` 的裸 `MeshToonMaterial` 是**凍結名冊**,而**名冊非空 ⇒ `celSchool` 的 def MUST NOT 是 `'b'`**。稽核 `audit_cel_pipeline` Ⅺ⑧ ±`--break-schoolmix` |

### 修訂:「陰影偏色」那一列(補一句)

> 在該列末尾補:**兩派共用同一份 `SHADOW_HUE` 與同一組 `_rampTint` 兩軌**(硬切路徑的暗側色 =
> 亮側 × 同一顆 `uCelRampTint` 再把亮度重正規化回 `SHADOW_V × 亮側亮度`)。
> School B 下兩根拉桿夾一個**下限** `CEL_CUT.HUE_MIN_A`(唯一夾制點 `toon.js tintA()`)——
> 兩根拉桿的 def 是 0,照搬到硬切路徑就是**灰色陰影**,而色相位移正是那一換學派的全部收益;
> School A 下 `tintA(k) ≡ visualPref(k)` = 逐位元同舊制。下限取多少是**待裁決②**。

### 修訂:「時間流逝 / 太陽・月亮・影子」那一列(補一句)

> 在 ⑨ 之後補:**投影型別 `renderer.shadowMap.type` 是 §0-b 學派的一部分**(見「賽璐璐明暗階梯」⑩),
> 守它的斷言住 `audit_cel_pipeline` Ⅺ⑨ 而不是 `audit_daynight`(那一支不是本道的檔)。

---

## ② `.claude/rules/verification.md`

### §5.1(續)離線稽核清單 —— 補 `--break-*`

```bash
node tools/audit_cel_pipeline.mjs    # 賽璐璐管線(ramp / 天空 / 地形色階 / 描邊寬度 / 地貌不出接縫
                                     #  / gInfo.a 打包 / 表面群組 / 溶入 / 勾線淡出 / **賽璐璐學派**)
#   ±--break-scale/--break-inkinfo/--break-land/--break-lutland/--break-contrib/--break-occl
#   ±--break-nearest/--break-selff/--break-grp/--break-dissolve/--break-landink/--break-fade
#   ±--break-school(School B 的 ramp hook 換回查表 + 硬切重組整段刪掉 ⇒ Ⅺ MUST 紅 4 條,
#                   而 Ⅰ 的 ramp 斷言與 audit_visual_prefs Ⅱ MUST 仍全綠 —— 它們守的是仍在服役的 School A)
#   ±--break-cutfloor(暗側地板改成手寫 0.25 < 102/255 ⇒ Ⅺ 的 A14 ② MUST 紅 2 條)
#   ±--break-neutral(拿掉暗側亮度重正規化 ⇒ Ⅺ 的 A14 ③ MUST 紅 2 條,含 28665 組的數值恆等式)
#   ±--break-cutorder(bands 4 的帶改得比 3 還窄 ⇒ Ⅺ 的硬度階梯 MUST 紅)
#   ±--break-schoolmix(多一處繞過 toon.js 的裸 MeshToonMaterial ⇒ Ⅺ⑧ 凍結名冊 MUST 紅)
#   ±--break-shadowtype(投影型別換回 PCFShadowMap ⇒ Ⅺ⑨ MUST 紅)
```

⚠ 既知粗糙處(**本輪未修,與 §0-b 無關**):`--break-fade` 會在印完 3 條紅字之後
以 `TypeError` 收場(壞版把 `_inkFadeM` 整支刪掉,而後面那段行為直測還要 `.exec(P)[0]`)。
仍以 exit 1 收尾 ⇒「MUST 紅」成立,但訊息會蓋在例外堆疊底下。

### §5.5 對照表 —— 新增一列

| 改動 | 驗證 |
|---|---|
| **賽璐璐學派切換**(`toon.js` 的 `CEL_CUT`·`cutOf`·`SHADOW_V_F`·`_school`·`celSchool()`·`RAMP_PATCH_A`·`RAMP_PATCH_B`·`RAMP_CAN`·`CEL_LUM_GLSL`·`CEL_KEY_GLSL`·`CEL_CUT_DECL_GLSL`·`CEL_CUT_MIX_GLSL`·`celCutUniforms`·`tintA`·`coolOn`·`toonPlain` / `visualPrefs.js` 的 `celSchool` / `data.js` 的 `SHADOW` 檔頭 / `game.js` 的 `shadowMap.type`)| `audit_cel_pipeline` ±**六支**新 `--break`(每一支 MUST 對應紅字)+ `audit_visual_prefs`(Ⅰ 多一條 def、Ⅱ 多三條;**既有 20 條偏色斷言 MUST 逐項不動**)+ `audit_soft_stroke` / `audit_gpu_lifecycle` / `audit_world_curve` / `audit_daynight`(MUST 逐項不動)+ `audit_client_syntax`(㋖;GLSL 住樣板字串)+ `npm run audit:net` / `audit_solo_boot` + **`npm run bal` / `npm test` MUST 逐項不動**(`data.js` **只改註解**、`sim.js` / `server/**` 一行未改;動了就是純表現層漏進判定)+ **㋓ `shot_scene` 三層 md5 對照**(手法與 2026-08-13 的 LUT 那一輪逐字相同,但**兩個新陷阱**見 `docs/_pending/shots-baseline.md` 第 2・3 節:`-prefs` 那一組跨進程不穩定、`--stations` 回放不等於新鮮推導)+ **㋕ 真機開一場 School B**(洞內 / 隧道在硬切下會平成一塊黑 —— 那是序 12b 的 emissive 要解的,而它依賴本項先落地)。⚠ 改 `RAMPS[3][0]` MUST 回頭看 `CEL_CUT.SHADOW_V`(它是推導值,會自己跟著走 —— 要檢查的是**跟著走之後還好不好看**);改 `CEL_CUT` 任一帶 MUST 重跑 Ⅺ⑤ 的階梯序 |

### §5.4 ㋔ 補一句

> 改 `toon.js` 的 `opaque_fragment` 前置區塊或 `void main()` 宣告區 ⇒ **`audit_soft_stroke` 那兩條
> 「排在 `#include <opaque_fragment>` 之後」的錨 MUST 收在 `applyCelPatch` 之內**
> (`opaqueAnchor()`)—— 2026-08-16 起 `toonPlain` 在檔案更後面也有一次同樣的 `.replace(…)`,
> 全檔 `lastIndexOf` 會指到那一次,兩條斷言從此紅在完全錯的理由上。

---

## ③ 根 `CLAUDE.md` 要加 / 要改的索引

- §2.1 F 的主題名補三個:**賽璐璐學派(兩派)**、**只掛學派不掛演出的材質**、
  (「賽璐璐明暗階梯」那一項改名為「賽璐璐明暗階梯 / 學派」)。
- §3 A 表 A14 那一列的**一行索引**跟著全文改主旨(見 ④),編號與 `[#INC-106]` **一格不動**。

---

## ④ `docs/anime_style_plan.md` 執行紀錄 + A14 改寫 + 對計畫 / 規格的更正

### 執行紀錄(追加一列)

> **序 12 / §0-b 賽璐璐學派切換 —— 2026-08-16 落地為 opt-in 旋鈕。**
> 兩派並存(`visualPrefs.celSchool`,def `a` = 舊制),縫仍只有 `toon.js` 一份、消費端一行不改。
> School A 逐位元中性(78 張定場照 65 張 md5 全同,其餘 13 張已證明與本輪無關);
> School B 65/65 張全部生效且跟著日夜循環走。`npm run bal` 與窗 2 基準 diff 0 行、`npm test` 全綠。
> **預設沒有翻成 B** —— 理由與解法見下方「未完的一件事」。

### A14 改寫(**MUST 由使用者過目**;編號與 `[#INC-106]` 一格不動)

`.claude/rules/antipatterns.md` 的 A14 那一列改寫成四句;根 `CLAUDE.md` §3 的一行索引同步改主旨。

**一行索引(根 `CLAUDE.md` §3)**:

| A14 | `[#INC-106]` 賽璐璐的暗面有一條**亮度地板**,而色相偏移 MUST 是**亮度中性**的;材質一律走 `toon.js` |

**全文(`antipatterns.md`)**:

| A14 | **`[#INC-106]` 賽璐璐的暗面有一條亮度地板,而且色相偏移 MUST 是亮度中性的。** ①(色階路徑 / School A)`RAMPS` 每一組的暗階 MUST ≥ 102;三階 MUST 逐位元 `[102,182,255]`。②(硬切路徑 / School B,2026-08-16 §0-b)暗側的值乘數 `CEL_CUT.SHADOW_V` MUST ≥ `rampFloor(3)`,而且 **MUST 推導不手寫**(現制 = `rampFloor(3) × SHADOW_V_F`,`SHADOW_V_F ≥ 1`)—— 102 這個數只准有一份家(`RAMPS`),手寫的話有人調 `RAMPS[3][0]` 之後暗側就悄悄跌到地板以下,而每一條斷言全綠。③**兩條路徑的色相偏移 MUST 亮度中性**:色階路徑的等價式是 `luma(shadowTintRGB(a)) ≡ 1`,硬切路徑是 `luma(暗側) ≡ SHADOW_V × luma(亮側)`,對**任何**基色與**任何**拉桿值恆成立。⚠ 硬切那一條 MUST 靠一行**重正規化**達成,MUST NOT 以為「`shadowTintRGB` 已經正規化過」就夠 —— `luma` 是內積,對逐通道乘法**不是乘性的**(純紅基色上 `luma(on × tint) / luma(on)` 就是 `tint.r`)。把亮度藏進色相是繞過 ①② 的後門,而畫面上只表現成深色件在暗面塌成黑塊。④材質一律走 `toon.js` 的 `toonMat` / `envMat` / `toonPlain`,MUST NOT 在別處 `new MeshToonMaterial` 繞過補丁 —— **兩派混在同一個場景裡 = 相鄰物件兩種終端線形狀,讀起來就是 bug**(現役名冊與「名冊非空 ⇒ def MUST NOT 是 `'b'`」那道閘住 `audit_cel_pipeline` Ⅺ⑧)。稽核 `audit_cel_pipeline` Ⅰ・Ⅺ + `audit_visual_prefs` Ⅱ |

### 對計畫書 §0-b 的更正(本輪量到的)

1. **`PCFSoftShadowMap` 已經在用**(`game.js`)⇒ 這一條沒有程式要改,只有檔頭的「為什麼」與一條守門斷言。
2. **反向驗證那一句在旋鈕制下講不通**:計畫寫「把 `shadowCut` 換回 ramp 查表 ⇒ ramp 斷言 MUST 紅字」——
   兩派並存之後,ramp 斷言守的是**仍在服役的 School A**,本來就該綠。反向驗證改成新 Ⅺ 段的
   `--break-school`(4 條紅),而 Ⅰ 與 `audit_visual_prefs` Ⅱ 的 27 條 MUST **仍全綠**。
3. **`uShadowTint` 不是「HSV 位移」**:字面的 `h -= 0.02; v *= 0.5` 不保 Rec.709 亮度 ⇒ 與 A14 ③ 正面衝突。
   現制改成「亮側 × 既有 `shadowTintRGB(a)` 再把**亮度**重正規化回 `SHADOW_V × 亮側亮度`」——
   色相仍由同一份 `SHADOW_HUE` 一張表決定、仍分 mech/env 兩軌、仍由兩根既有拉桿驅動,
   而 `rgb2hsv`/`hsv2rgb` **一行都不必寫**。「逐材質 tint 色值轉成色相偏移量」那句話的落點就是這裡。

### 對規格 `docs/_pending/spec/seq12-cel.md` 的更正

1. **`uCelKey`(JS 端的主光色 uniform)沒有做,而且刻意不做。** 規格要 `setCelSun(pos, keyColor, intensity)`
   + `environment.js` 一行改寫;但 `environment.js` 不是本道的檔,而且**更重要的是**:那是第二份
   主光色。現制在 GLSL 端直接加總 three 自己的 `directionalLights[i].color`(= `light.color × intensity`,
   `WebGLLights` 寫進去的那一份)⇒ ①日夜循環自動跟著走、②**沒有第二份數字可以分家**、
   ③零跨檔相依。稽核 Ⅺ⑦ 正面釘住這一條(並禁止 `uCelKey` 復辟)。
2. **裸 `MeshToonMaterial` 是 4 處不是 5 處**(`biomes.js`:GLB 植被不透明樹幹 / 洞頂 / 潮間帶 / 水簾)。
   規格列的「岸邊泡沫」那一處已隨窗 1 的泡沫系統改寫消失。
3. **`celLit` 不是「二階近似」。** 規格說把 albedo 除掉之後「彩度很高的基色上這個比值是近似而非恆等」;
   現制的分母取的是**同一格的全受光值** `celLum(celOn)`(不是 `celLum(diffuseColor.rgb) / PI`),
   單一主光下 albedo 與燈色在分子分母上逐通道同時出現 ⇒ `celLit ≡ dotNL × shadow` 是**恆等式**,
   對任何基色、任何燈色都成立。多盞平行光時退化成亮度加權平均,仍恆在 [0,1]。
4. **新的 Ⅷ 段變成 Ⅺ**(窗 1/2 已經用掉 Ⅷ・Ⅸ・Ⅹ)。
5. **`audit_daynight` 的 `shadowMap.type` 斷言改住 `audit_cel_pipeline` Ⅺ⑨**(那一支不是本道的檔;
   而且它本來就是「學派的一部分」,住這裡比較不會分家)。
6. **`--break-fade` 既有粗糙處**見 ② 段末。

### 未完的一件事(**這是本輪唯一沒照計畫做完的**)

計畫 §0-b 的定案是「**改**」學派,而本輪交付的是「兩派並存、預設仍是 A」。**卡點不是設計分歧,是檔案擁有權**:

`biomes.js` 還有 **4 處**繞過 `toon.js` 的裸 `MeshToonMaterial`,它們在 School B 下留在 ramp 而全世界改硬切
= 「同一棵樹的葉子硬切、樹幹漸層」,而 `biomes.js` 是 lane-world 的檔,本道一個字都不能寫。
把 def 翻成 `'b'` 就是**明知故犯地出貨一個 A14 ④ 違規**,所以本輪把它訂成一條硬規則
(`audit_cel_pipeline` Ⅺ⑧:名冊非空 ⇒ def MUST NOT 是 `'b'`)。

**解鎖是三行**,兩條路二選一:

- **路 A(最小侵入,本輪已備好)**:`biomes.js` 那 4 處改呼叫 `toon.js` 新增的 `toonPlain({...})`
  (簽章與原本的 `new THREE.MeshToonMaterial({...})` 逐項相同,多收一個選用的 `bands`),
  然後把 `Ⅺ⑧` 的 `ROSTER` 改成 `{}`、`VISUAL_KNOBS.celSchool.def` 改成 `'b'`。
  School A 下 `toonPlain` **完全不掛 `onBeforeCompile`** ⇒ 那四份材質逐位元同舊制(有定場照 md5 為證)。
- **路 B(結構性,但風險較大,本輪刻意沒做)**:School B 下把重組與宣告裝進
  `THREE.ShaderLib.toon.fragmentShader`(全域,同 `installWorldCurve` 改 `ShaderChunk` 的 idiom)——
  這樣**每一份** `MeshToonMaterial` 都吃得到,A14 ④ 從「名冊」升格成「結構保證」。
  ⚠ 代價:三個新 uniform MUST 同時塞進 `THREE.ShaderLib.toon.uniforms`,否則宣告了卻沒有值
  ⇒ GLSL 讀到 0 ⇒ `celOn = 0` ⇒ **全場全黑**;而且 `cloneUniforms` 會把 `uCelRampTint` 那顆共享
  Color **複製一份** ⇒ 裸材質的偏色從此不跟著拉桿走(4 份材質,可接受但要寫進註解)。

---

## ⑤ 待裁決(MUST 由使用者定案;本輪一律做成旋鈕 + 預設不生效)

### ⑤-1 旋鈕 vs 硬換(規格裁決①)

本輪做成 `celSchool` 旋鈕(def `a`)⇒ `RAMPS` / `audit_cel_pipeline` Ⅰ / `audit_visual_prefs` Ⅱ
**27 條斷言一條都沒動**,風險從計畫書標的「高」降到 opt-in,而且兩派可以並排比對再定案。
**建議維持旋鈕制** —— 真的要「換掉」(刪 `RAMPS` / `toonGradient` / `celRampDepth`)的話,
那 27 條要整批重寫、A14 ① 要刪掉而不是並存,工作量與風險都是另一個量級,
而且失去「切回舊制 = 一個旋鈕」這個退路。

### ⑤-2 School B 的預設色相量 `CEL_CUT.HUE_MIN_A`(規格裁決②)

現值 **1**(= `SHADOW_HUE` 自己那個長度;拉桿仍可到 3)。實測畫面上**偏保守**:
平均彩度幾乎不動(0.224 → 0.203,而且是被整體變暗帶走的,不是色相帶來的)。
**建議 1.5~2**(峰值 ≈ ±8~11/255,拖得出「天光藍的陰影」而不至於變成藍色濾鏡),
但這是美術方向 —— MUST 由使用者看過 `docs/_pending/shots-baseline.md` 第 4 節那組定場照再定。

### ⑤-3 `bands = 4` 的中間那一階要不要補回來(規格裁決③)

硬切只有一個終端 ⇒ 整片山坡回到兩塊色(taroko `hilltop` 實測 56.97% 的像素改變,幾乎全在那面坡上)。
三條路:①**維持兩塊色**(本輪現況;SKILL L2 的立場是「direct light 撐不起緩坡,那是材質色階的事」)
②**再加一刀**(= 把量化階數偷渡回硬切,兩派又混了 —— 不建議)
③**靠地貌 / 材質自己的色階梯撐**(要動 `ground.js` 的底毯色表,那是 lane-world 的檔)。
**建議 ①,並在下一輪把 ③ 排進 lane-world 的工作**。

### ⑤-4 A14 的改寫措辭(規格裁決④)

見 ④ 段的四句版本。編號與 `[#INC-106]` 一格不動;`siteplan.js` / `prompt.mjs` / `sim.js` / 各稽核
的交叉引用全部不受影響(它們引的是編號不是措辭)。**改 A 表 MUST 使用者過目。**

### ⑤-5 何時把 def 翻成 `'b'`

見 ④ 段「未完的一件事」。**這一格不是美術方向而是一道工程閘** ——
名冊清空之前翻它就是出貨一個看得見的 bug,而每一條既有斷言照樣全綠。
