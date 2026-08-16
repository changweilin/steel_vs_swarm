# lane-ink(渲染核心道)第一階段 —— 文件差異與凍結契約

> 2026-08-16。本檔是 **S13** 的產物:平行窗期間沒有任何一道寫 `CLAUDE.md` / `.claude/rules/**` /
> `docs/anime_style_plan.md` / `public/js/.claude.md` / `tools/CLAUDE.md`,各道把文件差異寫在這裡,
> 由整合者最後序列合併。
>
> **下游兩道(lane-world / lane-motion)靠第 ⑥ 段接線**;那一段是凍結契約,寫得不精確它們就接不上。

擁有並改動的檔案:`public/js/toon.js`・`public/js/postfx.js`・`public/js/visualPrefs.js`・
`public/js/data.js`・`tools/audit_cel_pipeline.mjs`・`tools/audit_soft_stroke.mjs`
(`tools/audit_visual_prefs.mjs`・`tools/audit_gpu_lifecycle.mjs` 本輪未改 —— 它們自動吃到新旋鈕與新斷言)

---

## ① `.claude/rules/seams-*.md` 要新增 / 修訂的那一列(原文)

### 修訂:`seams-render.md` §2.1 F 的「勾線資訊緩衝(折邊勾線)」那一列

> 把該列 `.a` 的語意整段換掉,並補上 ⑧⑨⑩⑪:

| 勾線資訊緩衝(折邊勾線)| 材質契約 `toon.js INK_INFO_DECL`/`INK_INFO_NONE`/`installInkInfo()` + **編解碼 `INK_CLASS`/`INK_LEVELS`/`inkQuant()`/`INK_PACK_GLSL`/`INK_UNPACK_GLSL`** + cel 補丁的 `gInfo` 覆寫;管線 `postfx.js INK_MRT`/`_mrtCap`/`_mkRT()`/`_syncMrt()`;開關 `visualPrefs` 的 `inkMrt`(預設關) | 2026-08-12 使用者定案「A 在設定加上開關」。深度的二階差分**分不出同深度相接的同色面**(牆腳與地面、退縮平台轉折、機體零件接縫)。第二張附件 = `vec4(視空間法線.xy × 0.5 + 0.5, surfaceId, 打包)`。前七條不變(①宣告一律無條件 ②涵蓋範圍由 `opaque_fragment` 推導 ③進場景的自寫 ShaderMaterial MUST 宣告 ④哨兵靠 `clearBufferfv` ⑤五格哨兵齊全才採用 ⑥法線是視空間 ⑦`surfaceId` 逐材質、地貌共用一號)。**2026-08-16 追加四條**:⑧**`.a` 是打包不是類別碼**(高半位元組 = 類別**索引** NONE 0 / LAND 1 / HARD 2 / GROUP 3、低半位元組 = `outlineContribution` 16 階),編解碼**只住** `INK_PACK_GLSL` / `INK_UNPACK_GLSL`,`postfx.js` 三個讀取點一律 import 前置 —— 魔數 16 / 15 / 255 在 `postfx.js` **一個都不准出現**(散成三份的話日後調階數只改到其中一處 ⇒ 類別解錯,而那表現成「某些表面的線莫名其妙全沒了」)。⚠ 舊哨兵門檻 `> 0.25` 在新編碼下**恆不成立**(`.a` 上限 = (3×16+15)/255 = 0.247)⇒ 折邊勾線整個變 no-op、LUT 地貌帶 `0.25~0.75` 同理恆不成立 ⇒ 2026-08-13 修掉的「拼圖接縫被 LUT 顯影」原樣回來,兩者都**沒有任何錯誤訊息**。⑨**NONE = 「沒有意見」不是「不畫線」**:天空穹頂 / 護盾殼 / 粒子 / 招牌今天都寫哨兵 0,讀成貢獻 0 會把它們**今天有的**深度線整批滅掉(那些線來自深度二階差分,與資訊緩衝無關)⇒ 中心 cls == NONE ⇒ 貢獻 1;**沒有資訊的鄰居 MUST 不投票**(一顆飄過去的粒子會以 floor(0) 把它後面所有的線關掉 = 「特效經過的地方線會閃掉」)。⑩**最近面覆寫是 `ceil`/`floor` 硬決定**,MUST NOT 換成 `mix`/`smoothstep`(那會在每一個與否決面相鄰的物件外圈長出半強度光暈,而那正是這個通道要消掉的東西)。⑪**附件 1 MUST 是 `NearestFilter`**,而且 MUST 包在 `Array.isArray(rt.texture)` 守衛裡 —— 退場路徑(WebGL1 / 旋鈕全關)上 `rt.texture` 是**單一 Texture**,`rt.texture[1]` 是 undefined ⇒ 沒守衛就是**預設路徑**的整條管線在建構子 TypeError。今天線性內插剛好無害只因 `INK.THICK = 1.0` 讓偏移落在 texel 中心,動 THICK 就壞。⑫**貢獻 `contrib` 是 uniform 不是 define** ⇒ MUST NOT 進 `customProgramCacheKey`(進去就是每一個貢獻值切一支新程式);`celOpts` MUST 記著它(`applyPaint` 以 celOpts 重跑 ⇒ 漏了就是上塗裝的機體貢獻靜默重置回 1)。稽核 `audit_cel_pipeline` Ⅵ・Ⅷ ±`--break-inkinfo`/`--break-contrib`/`--break-occl`/`--break-nearest` |

### 新增:`seams-render.md` §2.1 F「outlineContribution(這條線值不值得畫)」

| outlineContribution(這條線值不值得畫)| 量化 `toon.js inkQuant()`/`INK_LEVELS`/`INK_CONTRIB_NONE`;**兩支推導縫** `toon.js INK_REPEAT_M`+`inkRepeat(pitchM)`(節距軸)與 `data.js INK_CTR`+`inkCtrM(sizeM)`(尺寸軸);寫入 `applyCelPatch` 的 `contrib` → uniform `uInkCtr` → `gInfo.a` 的低半位元組;讀取 `postfx.js` 勾線 pass 的 `ctr` | 呼叫端 MUST 傳**自己排零件時已經算出來的**間距或尺寸,**MUST NOT 手寫貢獻數字、MUST NOT 建「零件種類 → 貢獻」的名冊**(名冊會在加零件時靜默過期);唯一容許手寫的是 `INK_CONTRIB_NONE`(否決)。①**兩支推導縫分工是規則**:`inkRepeat` 量「重複得多密」(欄杆立柱、格網)、`inkCtrM` 量「這個東西多大」(碎石、落葉、小擺件)—— 兩份並存已經是「拉桿改了一半」的風險上限,**MUST NOT 出現第三份**。②授權值一律先經 `inkQuant` 收成 k/15(不量化的話呼叫端傳 0.4 而緩衝裡是 0.4000/0.4667,稽核與定裝照量到的是另一個數)。③`inkQuant(1)` **嚴格 === 1**(level 15 ⇒ `fract(q/16)×16/15` 在 float32 上精確)⇒ `ink *= ctr` 與 `ceil/floor` 覆寫都是恆等 = **逐位元中性的證明面**。④`INK_REPEAT_M = SOLDIER_H × 2` 是**授權值不是量測值**(同 `MINI.BUFFER_F = 1/3`、`SELF_ULT.REALIZED_F = 0.35`;試過 `SOLDIER_H` 與 `heroTallestH()` 兩個現成錨都配不起來),校準面 = 序 12b 的定裝照。⑤`inkCtrM` MUST **嚴格單調遞增**且 `sizeM ≥ INK_CTR.FULL_M` 恆等於 1。稽核 `audit_cel_pipeline` Ⅷ ±`--break-contrib` |

### 新增:`seams-render.md` §2.1 F「表面群組(同一個東西共用一個 surfaceId)」

| 表面群組 | `toon.js SURF_ID`/`surfGroup()`/`joinSurfGroup()` + `applyCelPatch` 的 `surf`(逐材質)與 `surfAttr`(逐實例 `aSurfId` → `vSurfId` → `gInfo.b`);內部折邊抑制 `postfx.js INK_MRT.SELF_F`/`GRAZE_K`;群組早退 `INK_GRP` + 旋鈕 `inkGroup` | 粒度 = **玩家會把它指成一個東西**(整株樹 / 整顆巨岩 / 一堆石頭 / 邊界牆環),不是「一堆」(收成一堆的話岩屑坡上十幾顆會糊成一坨,而兩顆之間的輪廓本來就由深度那一項給)。①**號碼是整數格 `k/64`**,而 `nextSurfId` 是半整數格 `(k+0.5)/64` ⇒ 兩者恆差 ≥ 0.0078 > `INK_MRT.ID` 的 0.004 門檻,群組號與逐材質號**永不撞號**;`k = 0` 保留給地貌、`k = 1` 保留給坑門混凝土家族。②**`joinSurfGroup` MUST 在 `scene.add` / `new InstancedMesh` 之前呼叫** —— `uSurfId` 在首次編譯當下凍結,晚一步就是**一行都不生效**:線照畫、console 一個字都沒有、每一條原文斷言照樣綠。③地貌材質(`celOpts.land`)MUST skip(它恆 `LAND_SURF_ID`,A46 / 稽核 Ⅶ)。④**零亂數消耗**(吃模組級序 `_grpSeq`;在呼叫端抽一枚共享 `rnd()` 當群組種子 = 整張圖的佈局往後推移,§2.3)。⑤內部折邊抑制**只換法線折邊那一項的門檻**(`mix(NRM, NRM×SELF_F, same)`),**深度那一項刻意不抬** —— 深度跳變 = 前面有東西擋住後面 = 剪影的定義,順手抬了就是兩顆重疊的石頭糊成一坨。`SELF_F` MUST > 1(= 1 的話整段是恆等式)、`GRAZE_K` MUST > 0。⑥群組早退 = 「五格同號**且至少一格是 GROUP**」⇒ 整格不畫(取「最近那一格」會讓樹幹與樹冠的交界出線,而且要付 5 路 argmin)。⑦群組早退是 `_wantInfo` 的**第三個**消費端,**MUST NOT 與 `_inkMrt` 合成一個旗標**(合成 = 開群組剪影順手把折邊勾線也打開,墨線量 2.2 倍而使用者只動了另一欄 —— 同 2026-08-13 為 LUT 立過的那一條)。稽核 `audit_cel_pipeline` Ⅷ ±`--break-selff`/`--break-grp` |

### 新增:`seams-render.md` §2.1 F「玩家位移擾動(走過去把草撥開)」

| 玩家位移擾動 | `toon.js CHAR`(`N`/`R0`/`R_PER_MPS`/`SPD_REF`/`PUSH_F`/`SPD_K`)+ 共享 uniform `_charPos`/`_charSpd` + 唯一寫入點 `setCelChar(list)` + `CEL_SWAY` 頂點區塊的位移加項;消費端 `game.js` 主迴圈 | ①**擾動半徑是速度的函式**(`R0 + R_PER_MPS × 速率`)—— 常數半徑就是「走路撥開」與「跑步甩開」變成同一件事,而畫面上仍然「有在動」。②`CHAR.N` 是**成本預算常數不是美術參數**:每一槽是逐頂點一次 `length()` + 一次 `smoothstep()`,落在草 / 稻那幾列(全場頂點數最高的 InstancedMesh)。被擠出槽位的機體下一幀 spd 歸 0 ⇒ 它腳邊的草會彈回去,那是 N 有限的**必然代價**,MUST NOT 靠加大 N 掩蓋。③**沒填到的槽位由 `setCelChar` 顯式寫 `spd = 0`**(呼叫端不必補;留上一幀的值 = 那台機體離開之後草永遠倒著)。④三條 GLSL 硬規則:**MUST NOT 出現第三個 `sin(`**(`audit_soft_stroke` Ⅲ 的 `count(/sin\(/g) === 2` 是全域計數,多一個就紅而理由與擺動無關)、**MUST NOT 對零向量 `normalize()` 之後乘 0**(NaN × 0 仍是 NaN ⇒ 那批 InstancedMesh **整批消失**、console 一個字都沒有)、位移 MUST 是**早退不加**(`x + 0.0` 對 `-0.0` 不是恆等)。⑤距離是 **2.5D**:水平取實例原點(逐頂點取 XZ 會把整株拉歪)、垂直取這個頂點自己的株上高度 ⇒ 地面上的機體構造上碰不到 6m 高的樹冠。⑥速率 MUST 由**位置差分**求並經序 2 的 `lerpFPS` 平滑,MUST NOT 寫 `Math.min(1, dt * k)`。⑦MUST NOT 併進 `stepCelWind(dt)` 的簽章。⑧純表現層:伺服器與碰撞一格未動。稽核 `audit_soft_stroke` Ⅹ ±`--break-char`/`--break-charR`/`--break-charslot` |

### 新增:`seams-render.md` §2.1 F「岸邊泡沫 / 水面倒影塊」

| 岸邊泡沫 / 水面倒影塊 | `toon.js FOAM`/`REFL` + `seaFieldN()`/`foamBandM()` + `setSeaDepthField()`(唯一寫入點)+ 共享 uniform `_seaField`/`_seaRect`/`_foamA`/`_foamC` + GLSL `celFoam()` 與 `CEL_REFL` 頂點分支;旋鈕 `foam` / `reflect`;消費端 `terrain.bakeSeaDepth` / `biomes.buildWaterReflections` | ①**泡沫的驅動量是水深不是岸線幾何**:水面 fragment 拿不到場景深度(它與 `rtScene.depthTexture` 是同一個 FBO 的附件 = 回饋迴圈),第二趟深度 prepass 是 postfx 檔頭拒絕過的同一筆成本 ⇒ 深度做成**烤好的場**(terrain 高度場 + `blockers` 蓋章),逐 fragment 取樣;「繞過每一根柱子」由蓋章那一步給。②**相位 MUST 減去 `celSeaH`**(浪一來泡沫沖上岸)且 MUST 吃**同一支** —— 自己再寫一次相位 = 泡沫的沖刷與浪峰差半個波長。③套用 MUST 排在 `#include <opaque_fragment>` **之後**(寫進 `diffuseColor` 會讓泡沫再過一次 toon ramp:硬邊被階梯切開、陰影裡的泡沫變灰),且 MUST 乘 `vSeaFade`(否則 53m 外環水面會被 ClampToEdge 拉出一圈全白)。④場的邊長 MUST 由 `seaFieldN()` 推導並跟著 lowPower 折半(**MUST NOT 手寫 1024**:低階裝置多背 1MB VRAM 而畫面一模一樣)。⑤預設是 1×1 的「很深」中性貼圖 ⇒ 沒有水域 / 還沒烤 / 舊存檔一律**沒有泡沫**而不是滿場泡沫(原則 6);深度 ≥ `FOAM.RANGE_M` 恆 0 是**結構保證**。⑥`setSeaDepthField` MUST `old?.dispose()`(A25)。⑦倒影塊**不做 planar reflection**(那是第二趟全場 render):一份幾何、一個 draw call、朝向在頂點著色器算,長度由鏡像幾何**反解** `len = D·h/(e+h)` 推導不手寫,高度吃同一支 `celSeaH × seaFade` ⇒ 跟著浪起伏,類別碼恆 `NONE`(它是貼在水上的一片色塊,不該被畫輪廓)。⑧倒影塊材質 MUST 掛在**世界原點**(identity modelMatrix)—— 頂點分支直接把世界座標寫回 `transformed`。⑨`waterY` / `WATER.*` / `terrainEnvCode` / `bakeWetGrid` / 涉水物理一行不碰。稽核 `audit_soft_stroke` Ⅹ ±`--break-foam` |

### 修訂:`seams-render.md` §2.1 F「表現層資源生命週期」那一列(補一句)

> 在該列末尾補:**接地 AO(`bakeContactAO`)MUST 乘進既有 `geometry.color` 而不是覆寫** —— 它與
> `beacons.mergeGeos(geos, colors)` 寫同一個通道,兩個消費端現況剛好互斥所以從沒撞過,而載具 /
> 公設合併那一輪讓它們第一次同時出現;撞到的症狀是「整組沒有接地陰影」或「整組變灰白」,
> 兩種都不報錯而 `audit_gpu_lifecycle` 照樣全綠(它量的是 dispose 不是顏色)。

### 修訂:`seams-render.md` §2.1 F「畫面表現旋鈕」那一列(補一句)

> **`VISUAL_KNOBS` 由單一擁有者維護**:別的功能要旋鈕一律先開票、由那一支一次加完,MUST NOT 自己
> 往那張表塞一列(兩份清單遲早分家,而症狀是「設定頁有這一項但它誰都沒接上」)。

---

## ② `verification.md` 要加的指令與對照列

### §5.1(續)離線稽核清單 —— 補 `--break-*`

```bash
node tools/audit_cel_pipeline.mjs    # 賽璐璐管線(ramp / 天空 / 地形色階 / 描邊寬度 / 地貌不出接縫
                                     #  / **gInfo.a 半位元組打包 / 表面群組 / 內部折邊抑制**)
#   ±--break-scale/--break-inkinfo/--break-land/--break-lutland
#   ±--break-contrib(貢獻從編碼與寫入端一起拿掉 ⇒ Ⅷ①② + 寫入端條 MUST 紅 4 條)
#   ±--break-occl(最近面覆寫改成 mix ⇒ 「結果只會是 0 或 1」MUST 紅)
#   ±--break-nearest(附件 1 改回線性內插 ⇒ NearestFilter 那一條 MUST 紅)
#   ±--break-selff(SELF_F / GRAZE_K 寫回 1.0 / 0.0 ⇒ 兩條 MUST 紅)
#   ±--break-grp(群組早退整段刪掉 ⇒ 「五格同號且至少一格是 GROUP」MUST 紅)
node tools/audit_soft_stroke.mjs     # 軟性物質 + **玩家位移擾動 + 岸邊泡沫 / 倒影**
#   ±--break-ink/--break-anchor/--break-wave/--break-gust
#   ±--break-char(位移加項拿掉)/--break-charR(擾動半徑換成常數)
#   ±--break-charslot(空槽不再顯式歸零 ⇒ 行為直測 MUST 紅 2 條)/--break-foam(泡沫不由水深驅動)
```

### §5.5 對照表 —— 新增一列

| 改動 | 驗證 |
|---|---|
| **`gInfo.a` 半位元組打包 / 表面群組 / outlineContribution / 內部折邊抑制 / 群組早退**(`toon.js` 的 `INK_CLASS`·`INK_LEVELS`·`inkQuant`·`INK_PACK_GLSL`·`INK_UNPACK_GLSL`·`SURF_ID`·`surfGroup`·`joinSurfGroup`·`INK_REPEAT_M`·`inkRepeat`·`applyCelPatch` 的六個新選項 / `postfx.js` 的 `INK_MRT.SELF_F`·`GRAZE_K`·`_mkRT` 的 NearestFilter·勾線三個讀取點·`_wantInfo` 第三消費端 / `data.js` 的 `INK_CTR`·`inkCtrM` / `visualPrefs.js` 的九格新旋鈕)| `audit_cel_pipeline` ±**九支** `--break`(每一支 MUST 對應紅字)+ `audit_soft_stroke` ±**八支** + `audit_visual_prefs` / `audit_gpu_lifecycle`(既有斷言 MUST 逐項不動)+ `audit_client_syntax`(㋖;**GLSL 註解裡的反引號**是這一族踩過兩次的坑 —— toon.js 與 postfx.js 各一次)+ `npm run audit:net` / `audit_solo_boot`(**`postfx.js` 多一條 `import … from './toon.js'` 的模組邊**,A28 家族不該憑推理放行)+ `audit_world_curve` / `audit_daynight` / `audit_ground_*` / `audit_siteplan` / `audit_beacons` / `audit_object_joints --seeds 8`(幾何與 rnd 序列一格未動 ⇒ MUST **逐項不變**)+ **`npm run bal` / `npm test` MUST 逐項不動**(`data.js` 只多了不進 `balanceFingerprint` 的表現層常數,`sim.js` / `server/**` 一行未改;動了就是純表現層漏到判定上)+ **㋓ `shot_scene` 三輪 md5 對照**(旋鈕全關 / `--pref inkMrt=on` / `--pref lutSrc=baked`,MUST 與改制前**逐張相同**;手法與 2026-08-13 那一輪逐字相同)+ **㋓ 真 GPU MRT `readPixels` 重跑 64 組往返**(離線的 Ⅷ① 只證明**數學**對,證明不了驅動上的 8bit / half 位階)+ **㋓ 真 GPU:新的 `attribute`(`aSurfId`/`aCard`/`aReflO`)與 `varying`(`vSurfId`/`vSeaFade`)會不會讓整批物件不畫 —— `gl.getError()` MUST 為 0** |

### §5.4 ㋖ 之後補一句(GLSL 反引號)

> 本輪兩次踩到同一個坑:`public/js/toon.js` 與 `public/js/postfx.js` 的 GLSL **註解**裡出現
> `` ` ``(用來標記識別字)就把整支 .js 的樣板字串收掉,而 node 報的位置指向註解那一行的中文字。
> `audit_client_syntax` Ⅲ 抓得到,但**要記得先跑它**。

---

## ③ 根 `CLAUDE.md` §2.1 目錄要加的主題名

`seams-render.md`(§2.1 F)那一列的「涵蓋的縫」清單補四個主題名(§2.1 的鐵律:目錄裡查不到就會被當成沒有規則):

- **outlineContribution**
- **表面群組**
- **玩家位移擾動**
- **岸邊泡沫與水面倒影塊**

---

## ④ `docs/anime_style_plan.md` 執行紀錄那一列

| 序 3 / ①-1 `outlineContribution` 打包(§0-c 半位元組切)+ I1 gInfo 閘遞迴 + seam foundry(S2~S11)| ✅ 2026-08-16 落地 | 縫:`toon.js` 的 `INK_CLASS`(換索引 + 新增 `GROUP`)/`INK_LEVELS`/`inkQuant`/`INK_PACK_GLSL`/`INK_UNPACK_GLSL`/`SURF_ID`/`surfGroup`/`joinSurfGroup`/`INK_REPEAT_M`/`inkRepeat`/`CHAR`/`setCelChar`/`FOAM`/`REFL`/`seaFieldN`/`foamBandM`/`setSeaDepthField`/`celFoam`/`CEL_REFL`/`CEL_LEAFCARD`/`CEL_SURF_A`;`postfx.js` 的三個讀取點解碼 + 最近面覆寫 + `INK_MRT.SELF_F`/`GRAZE_K` + `INK_GRP` 早退 + `_mkRT` 的 NearestFilter;`data.js` 的 `INK_CTR`/`inkCtrM`;`visualPrefs.js` 九格新旋鈕(全部 def = 不生效,`foam` 例外 def 1 但中性場恆無泡沫)。稽核:`audit_cel_pipeline` 96 → 133 項(新增 Ⅷ + 五支 `--break`)、`audit_soft_stroke` 139 → 166 項(新增 Ⅹ + 四支 `--break`)。量測:64 組 8bit 往返類別 64/64 正確、貢獻誤差 **0**、level 15 解出**嚴格 1.0**;`npm run bal` 🎉 全綠、`npm test` 624 ✅(與基準逐項相同)。**呼叫端一個都沒接**(78 處 `envMat`/`toonMat` 全部吃預設)⇒ 旋鈕全關時逐位元同舊制。|

### 同輪 MUST 寫回計畫檔的更正(本道量到的)

1. **§⑨「MUST 原封不動」表列的 `buildCribs` / `cribColumn` / `quadTo` / `boreProfile` /
   `boreClearance` / `sweptSolid` 在本儲存庫查無**(全庫 grep 零命中;那是參考專案的詞彙)。
   連帶「法枠工格網 / 待避所 / 坑門冠石 / 橋面伸縮縫 / 欄杆立柱」也沒有對應幾何
   (本專案的欄杆是一條連續緞帶不是立柱)⇒ **⑨-3 目前沒有東西可以掛**。本輪只落地推導縫
   (`inkRepeat` / `inkCtrM`),逐結構的授權值留給序 12b 由定裝照校準。
2. **①-1 的 `outlineContribution` 通道已經完成,但「哪一款東西給多少」一格都還沒賦值** ——
   計畫的執行順序表把這兩件事寫成同一格,實際上是「縫」與「消費端」兩半(本輪只交前者)。
3. **§0-c 的編碼實測值更正**:計畫寫「類別索引 0/1/2」,本輪因為 ②-1 的群組剪影需要
   **第四個類別 `GROUP = 3`** ⇒ `.a` 的上限由 47/255 = 0.184 變成 **63/255 = 0.247**。
   仍然 < 0.25 ⇒ 「舊哨兵門檻恆不成立」那條結論不變,但**數字要改**。

---

## ⑤ 待裁決(MUST 由使用者定案;本輪一律做成旋鈕 + 預設不生效)

1. **`INK_REPEAT_M` 的授權值**(現取 `SOLDIER_H × 2 = 3.6 m`)。它**不是從既有量推導出來的**
   (試過 `SOLDIER_H`(把三組全推到 1)與 `heroTallestH() ≈ 26 m`(全推到近 0)兩個現成錨),
   與 `MINI.BUFFER_F = 1/3`、`SELF_ULT.REALIZED_F = 0.35` 同級。校準面 = 序 12b 的定裝照。
2. **`INK_CTR.BACKDROP`**(遠景背景那一圈要「線調淡」還是「整圈不出線」)。現取 0.5 =
   「淡一點的遠山」;0 = 一張背景板。兩種都自洽,是美術方向。
3. **`INK_MRT.SELF_F` / `GRAZE_K` 的定案值**(現取 2.2 / 2.0,**起手值不是實測值**)。
   兩者都是「哪一條線該留」的門檻,離線只驗得到「有沒有這個機制」,驗不到「留對了沒有」⇒
   MUST 走 `shot_scene --pref inkMrt=on` 的 4 × 4 掃描 + 定場照人眼判讀,**取平均、MUST NOT
   逐場地挑參數**(同 A46 ⑩ `dn_iter` 那條紀律)。判準三條:①巨岩主量體上的 ico / 圓柱小面線
   消失 ②岩上的 rib / 鑿面 / 棧道的線仍在 ③`hilltop` 的山脊線仍在而坡面上的高度場格線消失。
4. **`CHAR.N = 4`(主視野機體 + 最近 3 台)vs 計畫原文的單一角色**。計畫只寫 `charPos`/`charSpeed`
   兩個 uniform;本輪取 4 槽(第三人稱與觀戰下兩台常同框,只撥開自機腳邊的草很明顯不對),
   代價是逐頂點 4 次 `length()` 與槽位換手的瞬跳。**兩種都自洽。**
5. **`leafCard` / `inkGroup` 的預設值**。`_lane_plan.json` S10 的契約是兩者都 `off`(紀律①),
   而 seq7 規格建議 `inkGroup: 'on'` / `leafCard: 'auto'`。本輪照契約落地成 `off`/`off`
   (= 逐位元同舊制);要翻成建議值是一行的事,但那是**明知不中性**的畫面改動。
6. **`reflect` 的倒影塊是亮的還是暗的**(亮 = 天光高光帶 / 暗 = 用 `shadowTintRGB` 的同一個色相)。
   畫面上是兩種完全不同的東西 ⇒ 本輪 `reflect` def = 0(不畫)。
7. **`celSchool` / `wipe` / `landInk` / `birds` / `inkBreak` 五格旋鈕本輪只開票、沒有消費端**
   (它們分別屬於序 12 / 序 8 / 序 4 ①-3 / 序 11 ⑥-2 / 序 4)。旋鈕先加是為了讓
   `VISUAL_KNOBS` 只有一個寫入者(S10);**若使用者希望「沒有消費端的旋鈕不要出現在設定頁」**,
   那要在 `main.js` 加一個「這一項有沒有接上」的欄位 —— 而 `main.js` 是 lane-world 的地盤,
   本輪沒有動。

---

## ⑥ 凍結契約(S1~S11)—— **下游兩道照這一段接線**

### S1 `gInfo.a` 半位元組打包(`public/js/toon.js` 匯出)

```js
export const INK_CLASS = { NONE: 0, LAND: 1, HARD: 2, GROUP: 3 };  // **索引**,不是 alpha 值
export const INK_LEVELS = 16;                    // 貢獻階數(低半位元組)
export const INK_CONTRIB_NONE = 0;               // 唯一容許手寫的貢獻(否決)
export const inkQuant = (c) => number;           // → Math.round(clamp01(c) * 15) / 15;inkQuant(1) 嚴格 === 1
export const INK_PACK_GLSL: string;              // 提供 `float inkPack( float cls, float ctr )`
export const INK_UNPACK_GLSL: string;            // 提供 `float inkQ/inkCls/inkCtr( float a )`
```
`postfx.js` 已 `import { INK_UNPACK_GLSL } from './toon.js'` 並前置到勾線與 grade 兩支 fragmentShader。
魔數 16 / 15 / 255 只住那兩段字串。哨兵 `inkPack(NONE, 0) === 0`;`.a` 上限 63/255 = 0.247。

### S2 `applyCelPatch` / `toonMat` / `envMat` 的選項(**新參數全部在尾端**)

```js
applyCelPatch(mat, {
  /* 既有 */ metal, rim, wash, moss, cool, paint, tint, preview, soft, bands, land, landNrm,
  /* 新增 */ ink = 'hard',      // 'none' | 'land' | 'hard' | 'group'(land: true 會把預設的 'hard' 升成 'land';顯式的 ink 勝出;refl 恆 'none')
             contrib = 1,       // [0,1];**MUST 由 inkRepeat() / inkCtrM() 推導**,經 inkQuant 收成 k/15
             surf = null,       // 顯式表面群組號(surfGroup() 給的);land 勝出
             surfAttr = false,  // 面號改吃逐實例屬性 aSurfId
             card = false,      // 葉片卡(四角在視域空間展開)
             refl = false,      // 水面倒影塊;傳 { y: waterY } 可指定水面高
});
```
`toonMat(color, opts)` 與 `envMat(color, opts)` **兩支都逐項透傳**這六個欄位(已解構,不會落進 `...rest`)。
`celOpts` 已記錄六個新欄位;`customProgramCacheKey` 已併入 `surfAttr → 'A'`、`card → 'K'`、`refl → 'R'`
(**`contrib` 是 uniform,MUST NOT 進鑰匙**)。

### S3 表面群組

```js
export const SURF_ID = { LAND: 0, CONCRETE: 1 / 64 };   // k = 0 / 1 保留
export function surfGroup(): number;                    // 整數格 k/64,k ∈ [2, 63] 循環;**零亂數消耗**
export function joinSurfGroup(target, id = surfGroup()): number;
//   target = 材質(`.isMaterial`)或 Object3D 子樹(會 traverse 每一顆 mesh 的材質)
//   地貌材質(celOpts.land)自動 skip;回傳實際使用的群組號
```
⚠ **MUST 在 `scene.add` / `new InstancedMesh` 之前呼叫**。
逐實例版:`surfAttr: true` + 幾何掛 `InstancedBufferAttribute('aSurfId', Float32Array, 1)`
(值域建議 `(k % 63 + 1 + 0.5) / 64`,避開 `LAND_SURF_ID = 0`;由**落點雜湊**產生 ⇒ 零共享 `rnd()`)。

### S4 貢獻推導(兩支,分工是規則)

```js
// public/js/toon.js —— 節距軸
export const INK_REPEAT_M;                   // = SOLDIER_H * 2 = 3.6(**授權值**,見 ⑤-1)
export const inkRepeat = (pitchM) => number; // inkQuant(clamp01(pitchM / INK_REPEAT_M))
// public/js/data.js —— 尺寸軸
export const INK_CTR = { NONE_M: 0.35, FULL_M: SOLDIER_H * 2 /* 3.6 */, BACKDROP: 0.5 };
export const inkCtrM = (sizeM) => number;    // 嚴格單調遞增;sizeM ≥ FULL_M 恆等於 1
```
消費端一律轉呼其中一支,**MUST NOT 寫第三份**。

### S5 玩家位移擾動

```js
export const CHAR = { N: 4, R0: 1.1, R_PER_MPS: 0.26, SPD_REF: 6, PUSH_F: 1.8, SPD_K: 6 };
export function setCelChar(list): void;   // list = [{ x, y, z, spd }, …],長度 ≤ CHAR.N
//   沒填到的槽位由本函式**顯式**寫 spd = 0(呼叫端不必補)
```
`game.js` 主迴圈:`stepCelWind(dt);` 之後呼叫 `setCelChar(this._charSlots(dt))`,
**MUST 排在 `_updateEnts` 之後**(`ent.mesh.position` 那時才是本幀插值完的值);
速率由**位置差分**求、經 `lerpFPS(CHAR.SPD_K, dt)` 平滑,槽位換手時該槽平滑值歸零。
**MUST NOT 動 `stepCelWind(dt)` 的簽章**。

### S6 海面深度場 / 泡沫 / 倒影塊

```js
export const FOAM = { BAND_M: 0.55, STEP: 0.42, NOISE_M: 3.4, RANGE_M: 6, TEXEL_M: 1.5 };
export const REFL = { SEG_N: 3, GAP_F: 0.22, MIN_H: 4, MAX_N: 24, HALF_F: 0.9 };
export const seaFieldN = (worldW, worldH, low = false) => number;   // 邊長格數;low ⇒ texel ×2
export const foamBandM = () => number;                              // = FOAM.BAND_M
export function setSeaDepthField(data: Uint8Array, size: number,
                                 bounds: { minX, minZ, w, h }): void;
//   data[i] = clamp(水深 / FOAM.RANGE_M, 0, 1) × 255;預設是 1×1 的 255(很深 ⇒ 恆無泡沫)
```
泡沫 GLSL(`celFoam`)已在 `#ifdef CEL_WAVE` 的片段端就位,套用排在 `opaque_fragment` 之後、
乘 `vSeaFade` 與 `uFoamA`(= `foam` 拉桿)。**消費端只要烤場 + 呼叫 `setSeaDepthField`。**

倒影塊材質:`envMat(色, { refl: { y: waterY }, soft: seaSoft(), … })`,幾何契約:
- `position.x` = 橫向偏移(**世界公尺**)、`position.y` = 沿倒影方向的比例 `[0, 1]`、`position.z` 未用
- `attribute vec3 aReflO` = **(反射體世界 X, 反射體世界 Z, 反射體高 h)**
- `attribute float seaFade` = 逐頂點浪幅淡出(同水面那一份)
- ⚠ **mesh MUST 掛在世界原點(identity matrix)** —— 頂點分支直接把世界座標寫回 `transformed`
- 類別碼恆 `INK_CLASS.NONE`(不出輪廓);`uWaterY` 由 `refl.y` 餵入

### S7 葉片卡 + 群組早退

```js
toonMat(色, { soft, map: leafCardTex(), alphaTest: 0.5, transparent: false,
              card: true, surfAttr: true, ink: 'group' })
```
- `attribute vec3 aCard` = **(角落 x, 角落 y, 旋轉弧度)**;四角在**視域空間**展開,
  尺寸乘水平世界縮放 `length(mat3(modelMatrix) * mat3(instanceMatrix)[0])`(**不吃 `sy`**)
- 材質 MUST `transparent: false` + `alphaTest`(`inkable` 那道閘要 `!mat.transparent`)
- `m.castShadow` MUST 維持 `false`(陰影走 `MeshDepthMaterial`,沒有 `CEL_LEAFCARD` 補丁)
- postfx 側:`INK_GRP` 群組早退已就位(「五格同號**且至少一格是 GROUP**」⇒ 整格不畫),
  由 `visualPref('inkGroup') === 'on'` 開啟,並已是 `_wantInfo()` 的第三個消費端
- **`_mrtCap` 為假或 `inkGroup !== 'on'` 時 `leafCard` MUST 由消費端自動視為 `off`**
  (沒有群組早退的卡片叢比舊制更糟:12~24 張卡 = 12~24 個黑色多邊形)

### S8 內部折邊門檻

`postfx.js INK_MRT.SELF_F = 2.2`(> 1)、`GRAZE_K = 2.0`(> 0)。**只換法線折邊那一項的門檻**
(`mix(NRM0, NRM0 × SELF_F, same) × (1 + GRAZE_K × (1 − n.z))`),深度那一項一行未動。
消費端只需要把自己的材質標成正確的表面群組(S3)。

### S9 接地 AO

`bakeContactAO(root, fade)` 已改成**乘進** `geometry.color`(沒有既有頂點色 ⇒ 基底 1 ⇒ 逐位元同舊制)。
下游可以放心在 `mergeGeos(geos, colors)` 之後再呼叫它。

### S10 `VISUAL_KNOBS` 新增九格(**別道 MUST NOT 再塞**)

| 鍵 | 型別 | def | 說明 |
|---|---|---|---|
| `inkBreak` | 拉桿 0~1 | **0** | 墨線斷筆(序 4) |
| `inkGroup` | `off` / `on` | **off** | 群組剪影(S3/S7 共用,葉冠與石堆同吃) |
| `leafCard` | `off` / `auto` / `all` | **off** | 葉片卡冠層(序 7) |
| `foam` | 拉桿 0~1.5 | **1** | 岸邊泡沫強度(沒烤過深度場的場地恆無泡沫 ⇒ def 1 仍是中性) |
| `reflect` | 拉桿 0~1.5 | **0** | 水面倒影塊(亮/暗未定案) |
| `celSchool` | `a` / `b` | **a** | 賽璐璐學派(序 12;a = 舊制) |
| `wipe` | 拉桿 0~1 | **0** | 轉場刷屏(序 8) |
| `landInk` | 拉桿 0~1 | **0** | 地貌分界墨線(序 4 ①-3) |
| `birds` | 拉桿 0~1.5 | **0** | 鳥群密度(序 11 ⑥-2) |

### S11 稽核歸屬

S1~S10 的原文不變式與 `--break-*` 全部住 `tools/audit_cel_pipeline.mjs`(Ⅷ)與
`tools/audit_soft_stroke.mjs`(Ⅹ)。**lane-world / lane-motion 的新斷言一律進自己的新稽核檔**
(`audit_ambient_motion` / `audit_water_edge` / `audit_vehicle_spec` / `audit_leaf_card` /
`audit_anim_weights` / `audit_audio_layers`)。改到這四支墨線 / 賽璐璐稽核 = 撞車。

---

## ⑥-2 第二階段的凍結契約(S12~S17;2026-08-16 窗 2 追加)—— **窗 3 照這一段接線**

> 文件差異全文住 `docs/_pending/lane-ink-w2.md`。以下只列**別的道要用的簽章**。
> 共通:六項的預設值一律「不生效」⇒ 呼叫端一個都不接時逐位元同舊制。

### S12 墨線斷筆(序 4 ①-2)—— **消費端零改動**

```js
// public/js/toon.js
export const INK_BREAK = { SPAN_ENV: 3.0, SPAN_MECH: 0.45, CUT: 0.42, LO: 0.12 };
```
騎的是既有的「場景 RT 的 alpha ≡ 勾線門檻倍率」那條通道 ⇒ **`postfx.js` 一行不改、呼叫端一行不改**。
軌由既有的 `tint` 參數決定(`toonMat` 恆 'mech' / `envMat` 恆 'env'),旋鈕 `inkBreak`(def 0)。
⚠ 對別的道唯一的影響:**`celHash` / `celNoise` 已提出 `#ifdef CEL_WP` 之外**(全專案恰一份)——
要新增 GLSL 雜訊的人 MUST 用這一支,`audit_soft_stroke` Ⅺ 逐項釘住「各恰一份」。

### S13 地貌分區墨線(序 4 ①-3)—— **lane-world 的 `ground.js` 要接**

```js
// public/js/toon.js
export const LAND_ZONE_N = 6;
export const landZoneId = (i) => number;   // 整數格 (64 − N + i)/64;超界/非整數 → LAND_SURF_ID(0)
// 材質面
envMat(色, { land: true, landNrm: true, landId: true, … })   // ⇒ define CEL_LAND_ID
```
幾何契約:`BufferAttribute('aLandId', Float32Array, 1)`,**逐頂點**,值 = `landZoneId(分區索引)`。
分區索引由 `ground.js` 自己的 `zoneGrid`(green/bare/urban/wet/water/alpine)定,那張對照表
**住 `ground.js`**(toon.js 只擁有號碼的算術)。
- 落點:`emitCell` 的 `pushLandN` 旁邊多推一格、`setLandN` 旁邊多一個 setter ⇒ **零額外 draw call**
  (把分區併進 `sub#variant` 分桶鍵會讓 scree / steppe / concrete 分裂成多桶)
- **兩道閘**:`visualPref('landInk') > 0` **且** `aLandId > 0` 才換號 ⇒ 屬性缺席 = 今天的行為
- `landId` **只給 `envMat`**(`toonMat` 一路都不該吃它,同 `land` / `landNrm`)
- ⚠ 打開它的代價見 `lane-ink-w2.md` ⑤-3(現制 zone 換手在拼圖格界上,不在真實地貌界線上)

### S14 溶入(序 8 ④-2)—— **game.js 的 `_spawnUnit` / `_updateEnts` 要接**

```js
// public/js/toon.js
toonMat(色, { dissolve: true, … })        // ⇒ define CEL_DIS;預設 uDis = 1(完全實體)
export function setDissolve(target, k, origin = null): number;   // **唯一寫入點**,回傳寫到幾份材質
// public/js/data.js
export const DISSOLVE = { IN_S: 0.55, CELL_M: 0.42, FAR_M: 0, FAR_BAND_M: 60 };
export const dissolveAt = (t) => number;  // 0 = 全部 discard、1 = 完全實體
```
接線(三行):`_spawnUnit` 對 `ent.kami || ent.decoy || ent.hyper` 記 `ent.disT0 = now`;
`_updateEnts` 每幀 `setDissolve(ent.mesh, dissolveAt(now - ent.disT0), ent.mesh.position)`;
`k >= 1` ⇒ 清 `disT0` 並**一格都不再碰材質**(結束了還在寫 = 後續任何人改那顆 uniform 都被蓋掉)。
- 外殼描邊由 `setDissolve` 自己收放(`userData.isOutline` ⇒ `visible = k >= 1`)——
  呼叫端 MUST NOT 自己去動外殼,更 MUST NOT 給外殼加 define(全專案共用 `'celOutline'` 一把鍵)
- **只掛那三種載具**:`_spawnUnit` 是**所有**單位的入口,無差別掛上去 = 每一隻小兵進迷霧都溶入一次
- 「消失」那一半與遠距剔除**不在範圍內**(`this.ents` 有 20+ 個消費端;`FAR_M = 0` ⇒ 那一段不編進著色器)

### S15 斜向轉場(序 8 ④-1)

```js
// public/js/data.js
export const WIPE = { INC, SOFT, COVER_S, REVEAL_S, FLASH_S, FLASH_VIB, FLASH_CON, FLASH_BRI, PIVOT };
export const wipeAt = (mode, t) => ({ w1, w2, flash, done });   // mode ∈ 'cover' | 'reveal'
// public/js/postfx.js(Pipeline 的方法)
setWipe(a, b, opts)                       // **唯一寫入點**;覆蓋區間 = [b, a]
playWipe(mode, onCut = null, opts = null) // 旋鈕關著 ⇒ **同步**走回呼並回 false
```
- **驅動住管線自己**(`_tickWipe()` 由 `render()` 逐幀推進、自己記時鐘並夾 dt)⇒ 呼叫端不必給 dt、
  不必每幀呼叫、**MUST NOT 用 `setTimeout`**
- 幕色由呼叫端餵(`opts.color`,吃 `SIDES[side].color`)——`WIPE` 裡沒有顏色
- pass 排在 **grade 之後、fxaa 之前**;旋鈕 `wipe`(def 0)⇒ 整個 pass 退出鏈
- 現役消費端 = `cutin.js`(自己的大招那一格)。`game.js` 要接的話是**一行**:
  `this.cutin.setPipeline(this.pipeline)`;開戰揭幕 / 結算遮幕則是
  `this.pipeline?.playWipe('cover', () => this.hud.over?.(…))`(旋鈕關著時它會同步走回呼 ⇒ 時序不變)

### S16 勾線遠處淡出的錨(序 8 ④-3)—— **消費端零改動**

`postfx.js` 的 `_inkFadeM()` 每幀由 `render()` 的共用接線餵 `uFade0`/`uFade1`,錨 = `this.scene.fog`。
別的道要注意的只有一條:**動 `scene.fog` 就等於動了墨線的淡出帶**(它們自此是同一個數字);
`scene.fog` 缺席的場景(樣品 / `shot_veg`)自動退回舊式(`camera.far × FADE0/FADE1`)。

### S17 `postfx` 的 pass 名冊自此是推導的

`this._quads` 是**唯一**的 pass 名冊:`dispose()` 走 `Object.values(this._quads)`。
加 pass = 加一格 + 加一個 `_xxxMaterial()`,**dispose 一行都不用改**。
反過來:任何新 pass MUST 進 `_quads`,不進去就是每開一場漏一支 shader program 而
`audit_gpu_lifecycle` ⑦ 照樣全綠(`audit_visual_prefs` Ⅵ 自 2026-08-16 起比對「材質數 === `_quads` 格數」)。
