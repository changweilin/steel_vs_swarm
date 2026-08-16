# lane-world 第二階段 · 之一(剪影)文件差異 —— 交給整合者序列合併

> 2026-08-16 第二窗。平行窗期間本道**沒有**動 `CLAUDE.md` / `.claude/rules/**` /
> `docs/anime_style_plan.md` / `public/js/.claude.md` / `tools/CLAUDE.md` 任何一個字(S13)。
>
> 涵蓋:**W1 山頭 / 巨石 / 石堆**(`docs/_pending/spec/rock-silhouette.md`)+
> **W5 葉冠 → 整棵樹**(`docs/_pending/spec/seq7-tree.md`)。
> 兩者共用 lane-ink 凍結契約的 **S3(表面群組)· S4(貢獻推導)· S7(葉片卡 + 群組早退)· S8(內部折邊門檻)**。
>
> 寫入的檔案:`public/js/leafcard.js`(新)`public/js/biomes.js`・`public/js/ground.js`・
> `tools/audit_leaf_card.mjs`(新)`tools/audit_rock_ink.mjs`(新)。
> `siteplan.js` / `edgewall.js` / `beacons.js` / `hazards.js` **一個字未動**(樹冠羞避 `CROWN`、
> 邊界牆型錄、地標零件表、材質再匯出全部不在本項的路徑上 —— 見第 ④ 段的更正 7)。

---

## ① `.claude/rules/seams-render.md` §2.1 F 要新增的兩列(原文)

| 領域 | 唯一縫 | 鐵律 / 稽核 |
|---|---|---|
| 葉片卡冠層 / 整棵樹的剪影 | 排列規則 `leafcard.js`(`CARD`/`cardEnvelope()`/`envArea()`/`cardHalf()`/`cardCount()`/`planCards()`/`cardRnd()`/`leafSurfId()`)+ 接線 `biomes.js` 的 `CARD_MRT_CAP`/`groupInkOn()`/`leafCardOn()`/`leafCardTex()`/`leafRowGeo()`/`surfIdGeo()` 與 `buildVegMeshes` 內那三行;旋鈕 `inkGroup`(群組剪影)+ `leafCard`(off/auto/all) | 2026-08-16 使用者「葉冠處理**延伸到整棵樹**」。落地是**兩層、各自成立**:①**逐株面號**(`surfAttr` + `aSurfId`)—— 同一株的幹 / 枝 / 冠共用一號、**葉列**類別碼標 `GROUP` 而**木質列維持 `HARD`** ⇒ 群組早退(S7)收掉「幹與冠的交界」那條線,而幹自己的多邊形折邊留著(110m 神木近距離要讀得出轉折;這是取捨不是 bug);相鄰兩株是**不同**號 ⇒ 兩株之間仍有線 —— 這正是逐株而不是逐型的理由。②**葉片卡**(掛在 ① 與 MRT 能力之下)。十條:❶`leafcard.js` **零 THREE、只 import `rng.js`**(規則層可離線真的執行,這是 `audit_leaf_card` 前三段驗真品的唯一理由);❷**張數由包絡面積推導**,MUST NOT 逐型手寫 —— 而卡片半邊長 MUST NOT 是純比例(`R_F × rc`):球的面積與卡面面積都 ∝ r² ⇒ 張數與半徑無關,那一條就恆假而畫面上只表現成「小葉團上的卡跟大葉團一樣多」;❸**水平外廓 ≤ 佈局用的冠幅是結構保證**(卡心內縮 `1 − hr/rc` ⇒ 卡心距 + 卡半邊長恆 ≤ `rc`,代數上是等號上界),`giantCrownR` 量的正是同一個 `rc` ⇒ 樹冠羞避 / 淨空 / 碰撞一格不用改;❹**抖動抖參數座標不抖位置**(推位置會把卡心推離包絡表面,❸ 的等號當場破掉);❺**佈局數學只讀保險絲 `p.g`**(`giantCrownR` 冠幅 / `vegSpan` 擺幅分母)—— 卡片幾何的包圍盒比保險絲大,誤改成讀它就是整片林子擺幅變小而沒有錯誤訊息;❻**零共享 `rnd()` 消耗**(逐張固定 `CARD.DRAWS` 枚的專屬 `cardRnd`;逐株面號走**落點雜湊**);❼材質 MUST `transparent: false` + `alphaTest`(true 會掉出 `inkable` ⇒ 細勾線關掉、不透明度變 0.3)、`castShadow` MUST 維持 false(陰影走 `MeshDepthMaterial`,沒有 `CEL_LEAFCARD` 補丁 ⇒ 卡片在陰影圖裡是退化四邊形);❽**走 `applyCelPatch` 的 define 而不是自寫 `ShaderMaterial`**(`gInfo` 宣告 / 軟性 alpha / 世界曲面三條**結構性繼承**);❾「這一列要不要換成卡片」MUST 由 `vegSoftKind(part)` 的**同一次**呼叫結果推導,MUST NOT 另開名單(A39;`audit_soft_stroke` Ⅳ⑤ 釘住 `vegSoftKind(` 全檔恰一次);❿**沒有群組早退的卡片叢比舊制更糟**(一張卡的 alpha-test 邊界對深度二階差分就是一條真輪廓 ⇒ 12~24 張卡 = 12~24 個黑多邊形)⇒ `_mrtCap` 為假或 `inkGroup !== 'on'` 時 MUST 自動視為 `off`(原則 6)。⚠ `N_MAX` 是**填充率預算**不是美術值:draw call 一個都沒有多(換的是列的幾何不是列數),真成本是 alpha-test 的重疊繪製,而 `RES_GOV` 會把它表現成「解析度自己降了」不是掉幀。稽核 `audit_leaf_card` ±`--break-count`/`--break-fuse`/`--break-rnd`/`--break-mrtgate` |
| 剪影優先:巨岩 / 石堆 / 遠景背景 | 巨岩 `biomes.js` 的 `MEGA_BODY_F`/`_msbox` + `placeMegaliths` 既有調色 traverse 內的 `surfGroup()`×2 與 `joinSurfGroup()`;石堆 `ground.js` 細節發射迴圈的 `surfGroup()` + `inkCtrM(detailR(type) * 2)`;遠景 `biomes.buildBackdrop({ ctr })` ← 呼叫端注入 `INK_CTR.BACKDROP` | 2026-08-16 使用者「補充加入**山頭 / 巨石 / 石堆**的處置」。與上一列共用同一條規則:**一個在畫面上讀作「一個東西」的物體,不該被勾線畫成一堆多邊形稜線**,而**有意義的結構線**(節理面 / 層理 / 崖階 / 棧道)要留。三個各司一職的機制:**M1 表面群組**(共用 `surfaceId`)消掉物體內部的 id 線、**M2 outlineContribution** 把「畫面上只有幾個像素的東西」的線調淡、**M3 `INK_MRT.SELF_F`/`GRAZE_K`**(住 lane-ink)抬高**同一群組內部**的法線折邊門檻。九條:①**巨岩分兩群**,判據 **MUST 是量出來的外廓比而不是逐型名冊**(這一件的水平外廓 ÷ `meta.col.r`;主量體實測 0.8~1.0、貼壁結構件 0.03~0.35 ⇒ 門檻 0.5 兩側各一個數量級餘裕)—— 結構件與主量體**跨群組** ⇒ 那幾條線自動留著;②**三條順序**:MUST 排在 `jitterMegalith` 之前(抖動只增不減水平半徑,量在之後會讓靠近門檻的件逐顆跳邊)、MUST 排在 `group.add(g)` 之前(`uSurfId` 在首次編譯凍結,晚一步就是**一行都不生效**:線照畫、console 一個字都沒有、每一條原文斷言照樣綠)、量測與 `jitterMegalith` 的 `_mjbox` **同一把尺同一個局部座標系**;③**零亂數消耗**(群組號吃 `surfGroup()` 的模組級序;在這裡抽一枚當種子 = 後面每一顆巨岩、每一株植被的佈局整條推移);④**石堆的取號 MUST 在零件迴圈之外**(逐 `type` 一次)—— 取在裡面就是逐零件各一號 = 完全沒做,而「有沒有呼叫 `surfGroup`」看起來一模一樣;⑤**石堆粒度是「一顆」不是「一堆」,而且刻意不標 `GROUP`**:一款 = 一個 `InstancedMesh` = 一份材質 ⇒ 全世界同款的石頭同號,標了的話群組早退會把岩屑坡上那十幾顆糊成一坨(兩顆之間的輪廓本來就由**深度**那一項給,而深度那一項刻意不抬);⑥**貢獻由既有的實測縫推導**(`detailR(type)` 量零件真幾何,直徑 = ×2),零新名冊 —— 手寫值會靜默過期;⑦**遠景背景的貢獻由呼叫端注入**(`buildBackdrop` 被 `audit_world_edge` 以真品原文抽進沙箱跑、自由變數逐一具名注入 ⇒ 就地引用新的模組常數 = 那支當場 `ReferenceError`,同 `edgewall.js` 的坡度門檻由呼叫端注入那一條);⑧**邊界牆環一格未動**:它已經是一個 merged mesh 一份材質 ⇒ M1 天生成立、id 線一條都沒有,剩下的全是法線折邊 ⇒ 由 `SELF_F` 整段接手;⑨**`rockMat` / `blockers` / `rockProbe` / `climb` / `partJitter` 的夾制一行未改** —— 三個機制全部只動材質與勾線 pass。⚠ **遠景那一圈真正的病灶不在貢獻**:`INK.FADE0/FADE1` 錨在 `camera.far`(= `span × 2`)⇒ 對現役地圖等於「永不淡出」,而背景環落在圖界外約 410m、`scene.fog` 的 near 是 `span × 0.5`;正解是計畫 **④-3「霧範圍 ≡ 勾線淡出範圍」**(本輪未做),貢獻只是止血,而**真山(地形)在同樣距離上仍是全強度** ⇒ MUST NOT 因此把 FADE 常數就地改小(會把近景的線一起吃掉)。⚠ **雪線 / 草↔岩界線 MUST NOT 在本輪做**(見第 ④ 段更正 8)。稽核 `audit_rock_ink` ±`--break-rocksurf`/`--break-detsurf`/`--break-ctr` |

**同段順手修訂**:`seams-render.md`「表面群組」那一列(lane-ink 新增)的 ② 補一句 ——
> `celSurfId` 可以事後改寫(`joinSurfGroup` 就是靠這一點),但**類別碼 `ink` 不行**:它在
> `applyCelPatch` 呼叫當下由閉包凍結。凡是「分類要等整棵 / 整顆建完才量得出來」的消費端
> (巨岩的主量體 vs 貼壁結構件就是),**只拿得到 M1 + M3,拿不到群組早退** —— 要拿到就得
> 有一支「事後改類別」的入口(同 `applyPaint` 以 `celOpts` 重跑的 idiom)。見待裁決 ③。

---

## ② `.claude/rules/verification.md`

### §5.1(續)離線稽核清單要新增的兩行

```bash
node tools/audit_leaf_card.mjs        # 葉片卡冠層 / 整棵樹的剪影(張數推導 / 外廓 ≤ 保險絲冠幅 / 零共享 rnd / 佈局只讀 p.g / 無 MRT 必退回)
#   ±--break-count(張數改逐型手寫)/--break-fuse(包絡改讀庫幾何)
#   ±--break-rnd(抖動改吃共享 rnd)/--break-mrtgate(能力與群組閘拿掉)
node tools/audit_rock_ink.mjs         # 剪影優先:巨岩兩群組 / 石堆逐款一號 + 貢獻由 detailR 推導 / 遠景背景的注入
#   ±--break-rocksurf(巨岩群組指派整段拿掉)/--break-detsurf(取號移進內層零件迴圈)
#   ±--break-ctr(貢獻改手寫常數)
```

### §5.5 對照表 —— 新增一列

| 改動 | 驗證 |
|---|---|
| **葉片卡冠層 / 整棵樹的剪影 / 巨岩・石堆・遠景的表面群組與貢獻**(`public/js/leafcard.js` 全檔 / `biomes.js` 的 `MEGA_BODY_F`·`_msbox`·`placeMegaliths` 的群組指派·`CARD_MRT_CAP`·`groupInkOn`·`leafCardOn`·`leafCardTex`·`leafRowGeo`·`surfIdGeo`·`buildVegMeshes` 的三行·`buildBackdrop({ ctr })` 與其呼叫點 / `ground.js` 細節發射迴圈的 `surf`·`contrib`) | `audit_leaf_card` ±**四支** `--break`(每一支 MUST 對應紅字)+ `audit_rock_ink` ±**三支** + **`audit_siteplan` / `audit_beacons` / `audit_object_joints --seeds 8` / `audit_ground_tile` / `ground_seam` / `ground_enclave` / `ground_qc` / `ground_border` / `audit_world_edge` / `audit_world_height` / `audit_gpu_lifecycle` / `audit_world_curve` 逐項不變** —— 這十二支是「**零共享 `rnd()` 消耗**」的唯一證明面,而**判準是「逐項不變」不是「仍全綠」**(它們驗規則不驗位置,序列被推移時全部照樣綠)+ `audit_cel_pipeline` / `audit_soft_stroke` / `audit_visual_prefs` / `audit_ambient_motion` 全綠(勾線契約與軟性名冊一格未動;⚠ `audit_soft_stroke` Ⅳ⑤ 的 `vegSoftKind(` 恰一次與 `const mat = toonMat(seasonColor` 恰一次是這一族最容易被順手打破的兩條)+ `audit_client_syntax` ±`--break-glsl`(㋖;名冊多一支 `leafcard.js` ⇒ 項數 +2)+ `npm run audit:net` / `audit_solo_boot`(新增客戶端模組:URL 佈局鏡射 + `data.js` 單一模組實例)+ **`npm run bal` / `npm test` MUST 逐項不動**(`data.js` / `sim.js` / `server/**` 一行未改)+ **`intake_parts` MUST 全綠;⚠ `leafCard` 的預設一旦翻成 `auto`/`all`,MUST 先重跑 `measure_veg_tris --kinds`/`--giants` 更新 `tri_budget.json` 的 `measured_kind_tris`/`measured_veg_total_max` 再跑 `intake_parts`** —— 它是整層總量閘的**分母**(被取代的現值),葉片卡把逐型現值改大 ⇒ 那道閘**變鬆**,而紅字與真正的三角形成本無關(staleness ⑤)+ **㋓ 真 GPU 直測**(新的 `attribute`(`aCard`/`aSurfId`)與 `varying`(`vSurfId`)會不會讓整批物件不畫 —— `gl.getError()` MUST 為 0、開→關→再開 MUST **逐位元還原**)+ **㋓ `shot_scene --venue taroko --pref inkMrt=on` / `shot_veg`**(「這顆岩看起來像不像一顆岩」「這叢冠讀不讀得出鋸齒」在每一條斷言上都是綠的)+ **㋕ 真機**(走到一片露頭旁繞一圈、站上全圖最高點看遠山、走到圖界看那一圈假山;林子裡貼著樹走)。⚠ 改 `MEGA_BODY_F` 或 `meta.col.r` 的定義 MUST 回頭看 `audit_rock_ink` Ⅰ 印出來的比值分佈(`col.r` 一動整批比值平移,而**每一條斷言仍會過**);改 `CARD.SIZE_M`/`COVER`/`N_MAX` MUST 回頭量真機填充率(`RES_GOV` 只調解析度,調不掉 alpha-test 的重疊繪製) |

---

## ③ 根 `CLAUDE.md` §2.1 目錄要加的主題名

`seams-render.md`(§2.1 F)那一列的主題清單追加兩個:

> …・**葉片卡冠層與整棵樹的剪影**・**剪影優先(巨岩 / 石堆 / 遠景背景)**・共用視覺入口

(§2.1 的鐵律:「查不到主題時 `grep -rn` …**MUST NOT 因為目錄裡沒看到就認定沒有規則**」。)

---

## ④ `docs/anime_style_plan.md` 執行紀錄 + 對計畫 / 規格的更正

### 執行紀錄

> **2026-08-16 第二輪 · lane-world 第二階段(剪影)**|②-1 葉片卡冠層 → **整棵樹**、以及使用者追加的**山頭 / 巨石 / 石堆**兩項落地。縫:新增 `public/js/leafcard.js`(零 THREE 排列規則層)+ `biomes.js` 的 `MEGA_BODY_F`/`leafCardOn`/`leafCardTex`/`leafRowGeo`/`surfIdGeo` + `ground.js` 細節迴圈的 `surf`/`contrib` + `buildBackdrop` 的注入欄。新稽核兩支(`audit_leaf_card` 43 項 / `audit_rock_ink` 30 項,七支反向驗證逐支咬得住)。**逐位元證明面**:`npm run bal` 🎉 全綠、`npm test` **624 ✅**(隔離埠 8697,與基準逐項相同);`audit_siteplan`(265)/`beacons`(68)/`object_joints --seeds 8`(21611 個接合、異常 0)/`ground_tile`/`ground_seam`/`ground_enclave`/`ground_qc`/`ground_border`/`world_edge`(156)/`world_height`(49)/`gpu_lifecycle`(58)/`world_curve`(62)共 **12 支輸出逐位元相同** = 零共享 `rnd()` 消耗成立;`intake_parts` 363 ✅(`leafCard` def = off ⇒ 出貨組態的三角形數一格未動)。**真 GPU 直測(㋓,已跑)**:`inkGroup=on` + `leafCard=all` + `inkMrt=on` 下 `gl.getError() === 0`、無 console 錯誤、逐株面號在三株上分別是 0.4609 / 0.0234 / 0.7891 而**同一株的每一列同號**、葉列 `ink=group`+`card`+`alphaTest=0.5`+`transparent=false`+`castShadow=false` 而木質列 `ink=hard`,**關 → 開 → 關之後畫面 hash 逐位元還原**。未驗:定裝照與真機人眼判讀(見交付說明)。

### 對計畫 / 規格的更正(本道量到的)

1. **`INK_CTR.EDGE` 在凍結契約裡不存在。** `rock-silhouette.md` 要 `buildEdgeWall` 加
   `ctr: INK_CTR.EDGE`,而 lane-ink 落地的 S4 只開了 `NONE_M` / `FULL_M` / `BACKDROP` 三格
   (`INK_CTR` 住 `data.js` = lane-ink 的地盤)。⇒ **邊界牆環本輪不加 contribution**,而且
   那是**對的**:它的零件是真實公稱尺寸(城牆 9~14m、貨櫃、船樓,一律 ≥ `FULL_M` 3.6m)
   ⇒ 尺寸軸的推導值恆為 1,自己寫一個新常數才是第三份實作。它需要的 M1 已經天生成立
   (一個 merged mesh 一份材質)、M3 的 `SELF_F` 對它整段生效。要「整圈調淡」是美術方向,見 ⑤-④。
2. **巨岩要不要標 `ink: 'group'`,兩份規格互相矛盾,而現實只允許一種。**
   `seq7-tree.md` 的 blockedOn ④ 說石堆那一項「只需要把材質標成 `ink:'group'` + 給逐堆面號」;
   `rock-silhouette.md` 的落地設計則是 **M1 + M2 + M3,完全沒有 GROUP**。落地取後者,
   而且**不是取捨是約束**:`celSurfId` 可以事後改寫(`joinSurfGroup` 靠的就是這一點),
   但**類別碼在 `applyCelPatch` 呼叫當下由閉包凍結**,而巨岩的「主量體 vs 貼壁結構件」
   只有在**整顆建完之後**才量得出來(判據是外廓比)⇒ 要標 GROUP 就得改 `rockMat` 簽章
   **並且在建構期就知道分類**(做不到),或請 `toon.js` 開一支「事後改類別」的入口。
   ⇒ 巨岩現況 = **M1(兩個群組)+ M3(`SELF_F`/`GRAZE_K`)**;要不要補上早退見 ⑤-③。
   ⚠ **石堆那一半則是「刻意不標」而不是「做不到」**:一款 = 一份材質 ⇒ 標了會把全世界
   同款的石頭當成同一個東西,岩屑坡上十幾顆當場糊成一坨(`rock-silhouette.md` 自己點名的坑)。
3. **`buildBackdrop` 的 contribution 由呼叫端注入,不是就地讀 `INK_CTR`。**
   規格寫 `flushPartBatch(group, batch, { …, ctr: INK_CTR.BACKDROP })`,但那一支被
   `audit_world_edge` **以真品原文抽進 `new Function` 沙箱**跑(自由變數逐一具名注入),
   就地引用一個新的模組常數 = 那支當場 `ReferenceError`,而它驗的「演出 ⊆ 碰撞盒 / 逐零件
   落地」與墨線完全無關(那支不在本道的 `ownsFiles` 裡)。⇒ 簽章改成
   `buildBackdrop({ group, terrain, ctr })`,值由 `buildBiomes` 餵。同 `edgewall.js` 的
   坡度門檻由呼叫端注入那一條紀律。**省略 ⇒ 逐位元同舊制**。
4. **`_mrtCap` 只問得到一半。** `postfx` 的 `_mrtCap` =「renderer 是 WebGL2」∧「three 有
   `WebGLMultipleRenderTargets`」,而 `biomes.js` 沒有 renderer ⇒ 只問得到後半(本檔的
   `CARD_MRT_CAP`,逐字同 `postfx.js`)。前半要一支從 `postfx.js` 匯出的能力查詢才問得到。
   殘留的縫是「瀏覽器有 WebGL2 但 renderer 建立失敗退回 WebGL1」那一格,見 ⑤-⑦。
5. **`visualPrefs.js` 本道零改動。** `seq7-tree.md` 的寫入清單列了它,但 S10 已由 lane-ink
   一次加完(`inkGroup` / `leafCard` 兩格都在,def 皆 `off`)。本道只是**消費端**。
   ⇒ **落地後畫面預設逐位元同舊制**;要看到本項的效果要開兩根旋鈕。
6. **`tri_budget.json` 本輪不必重量。** `leafCard` def = `off` ⇒ 出貨組態的植被幾何一格未動,
   `intake_parts` 363 ✅。**開關的預設一旦翻成 `auto`/`all`,seq7 的步 8 就 MUST 先做**
   (`measure_veg_tris --kinds`/`--giants` → 更新 `measured_kind_tris`/`measured_veg_total_max`
   → 重跑 `intake_parts`),否則那道整層總量閘的**分母**被靜默放寬。
7. **其餘葉子消費端刻意沒有一起改**(規格已預告):`ground.js` 的 `DETAIL_DEFS.bush`/`roadtree`
   (`sf: 'leaf'`)、`biomes.js` 的 `roofBushes`/`roofTreeList`、`siteplan.js` 的 `CIVIC_TREES`。
   本項只動 `buildVegMeshes`;症狀是「同一張圖上林子裡的樹是卡片、路邊行道樹是團塊」。
   要不要一起收是下一輪的事。同理 `hazards.js` 的障礙岩(`chiselRock`,`IcosahedronGeometry(r,1)`
   非索引 ⇒ 逐面硬邊法線 80 面 + 反轉外殼描邊)**本輪未動**,它不在使用者點名的三個對象裡,
   而動它會連帶動到 `audit_object_joints` 的 42 枚亂數樁 —— 見 ⑤-⑧。
8. **雪線 / 草↔岩界線本輪 MUST NOT 做(照規格)。** 現制 `icefield`/`scree`/`plateau` 的換手
   發生在 `ground.js` 的逐格投票邊界與 `CARPET_LOT` 量化格上、不在真實雪線上;而全部地貌
   共用 `LAND_SURF_ID` 正是 2026-08-13 為了藏那條接縫定的案(A46 / `audit_cel_pipeline` Ⅶ)。
   現在給它一個 id 邊 = 把剛藏起來的拼圖接縫用黑線重新描一次。它是 §0-a 遮罩面(序 14/15)
   的推論;中間態的廉價替代(計畫 ①-3 的 `surfaceId += mask * 0.1`)在拼圖制下同樣會沿
   拼圖邊出線,一併 MUST NOT。
9. **`leafcard.js` 走 `applyCelPatch` 的 `CEL_LEAFCARD` define,不是計畫字面的「一支新的葉片
   `ShaderMaterial`」。** 理由與 `seq7-tree.md` blockedOn ② 逐字相同(三條契約結構性繼承),
   而且該 define 與 `aCard` 屬性契約**已經是 lane-ink 落地的 S7 凍結契約** ⇒ 本輪只是接上去。
   使用者已定案「衝突時以計畫為主」,故仍請明確放行,見 ⑤-⑨。

---

## ⑤ 待裁決(MUST 由使用者定案;本輪一律做成旋鈕 + 預設不生效)

1. **`leafCard` / `inkGroup` 的預設值。** S10 的契約是兩者都 `off`(= 逐位元同舊制),
   `seq7-tree.md` 建議 `inkGroup: 'on'` / `leafCard: 'auto'`。翻成建議值是一行的事,
   但那是**明知不中性**的畫面改動 ⇒ 本輪維持 `off`/`off`。**本項的效果現在要手動開兩根旋鈕才看得到。**
2. **`INK_CTR.BACKDROP`(現值 0.5)。** 遠景背景那一圈要「線調淡的遠山」還是「一張畫上去的
   背景板(0)」。lane-ink ⑤-2 已開票,本道是它的**第一個消費端**。兩種都自洽,是美術方向。
3. **巨岩要不要吃群組早退。** 見更正 2:需要 `toon.js` 開一支「事後改 `ink` 類別」的入口
   (`applyPaint(mat, paint)` 那個 idiom 的兄弟:`applyCelPatch(mat, { ...celOpts, ink })`)。
   代價與收益:開了之後主量體塊與塊之間的**深度線**也會被收掉 ⇒ 整顆真的讀成一個剪影,
   但那一顆之內的懸垂 / 崩落塊的前後關係也一起沒了。**兩種都自洽。**
4. **邊界牆環要不要 contribution。** 需要 `INK_CTR` 多開一格(`data.js` = lane-ink)。
   推導值恆為 1(零件是真實公稱尺寸)⇒ 要調淡只能是**授權值**,而那是美術方向。
5. **`MEGA_BODY_F = 0.5`** 是**授權值**。實測兩群分得很開(主量體 0.8~1.0 / 結構件 0.03~0.35),
   兩側各有一個數量級餘裕;但「哪幾條線該留」的定案面是定裝照(㋓),不是這個比值本身。
6. **`CARD.SIZE_M`(1.1m 邊長)/ `COVER`(0.85)/ `N_MIN,N_MAX`(5,24)/ `JIT` / `R_JIT`**
   全是**授權值不是量測值**(同 `PETAL.SIZE`、`MINI.BUFFER_F`)。校準面是定裝照(㋓)與
   真機填充率(㋕),兩者沙箱都跑不動。現值下實得張數:`ico(0.9)` 6 張 → `ico(2.7)` 24 張(頂到上限)。
7. **`_mrtCap` 的 renderer 那一半要不要一支能力查詢。** 若要,`postfx.js` 匯出
   `export const inkInfoCapable = (renderer) => …` 或一個模組級旗標(由 `Pipeline` 建構時寫入),
   `biomes.js` 轉呼 ⇒ 那一格殘留的縫就關掉了。`postfx.js` 是 lane-ink 的地盤。
8. **`hazards.js` 的障礙岩(`chiselRock`)要不要一起收進表面群組。** 它不在使用者點名的三個
   對象裡,而且它有**反轉外殼描邊**(`outlinify(g, 0.07)`)而巨岩 / 石堆 / 邊界牆一律沒有 ——
   兩套描邊路徑混在一起要先決定留哪一條;動它會連帶動到 `audit_object_joints` 的 42 枚亂數樁。
   ⚠ 它是 `IcosahedronGeometry(r, 1)` **非索引 ⇒ 逐面硬邊法線**(80 面),`inkMrt` 開啟時是
   全場最容易變成黑色鐵絲球的東西。**本輪未動。**
9. **葉片卡走 define 而不是自寫 `ShaderMaterial`**(對計畫字面的偏離,理由見更正 9)。
   使用者已定案「衝突時以計畫為主」⇒ 請明確放行或否決。
10. **`leafCard: 'all'` 是否取代已入庫的 AI 冠簇節點**(`tree/canopy_*`、`tree/*_crown_*`、
    `tree/bush_a09`、`tree/vleaf_a*`;2026-08-05 / 08-08 使用者定案「走零件庫」的產物,
    吃掉整層成長額度的 92.4%)。`auto` 不碰它們(⇒ `intake_parts` 的分母與 `node_cap` 完全不動),
    `all` 會讓那些庫節點變成孤兒。**選哪一個 MUST 由使用者定案。**
11. **樹幹的多邊形折邊要不要一起收。** 使用者的追加語是「一棵樹在畫面上是一個東西」,字面
    推論是連樹幹的 7 邊形折邊也收掉。本輪取「木質列 `hard` / 葉列 `group`」⇒ 幹的內部折邊
    留著、幹與冠的交界不出線。要連幹也收是**一行**(木質列也標 `group`),但 110m 神木近距離
    會讀成一根沒有轉折的實心柱 —— **這是取捨不是 bug,請裁決。**

---
---

# lane-world 第二階段 · 之二(水)文件差異 —— 交給整合者序列合併

> 2026-08-16 第二窗。本段涵蓋 **W3 序 9**(`docs/_pending/spec/seq9-water.md`):
> **⑤-2 岸邊泡沫** + **⑤-3 水面倒影塊**。消費 lane-ink 凍結契約的 **S6**
> (`FOAM`/`REFL`/`seaFieldN`/`foamBandM`/`setSeaDepthField`/`celFoam`/`CEL_REFL`)。
>
> 寫入的檔案:`public/js/terrain.js`・`public/js/main.js`・`public/js/biomes.js`・
> `tools/audit_water_edge.mjs`(新)。
> `toon.js` / `postfx.js` / `visualPrefs.js` / `data.js` / `audit_soft_stroke.mjs` /
> `shot_scene.mjs` **一個字未動**(S6 與 S10 的兩根拉桿 `foam`/`reflect` 都已由 lane-ink
> 落地,本道只是消費端;`shot_scene` 不必加旗標的理由見第 ④ 段更正 2)。

---

## ① `.claude/rules/seams-render.md` §2.1 F —— 修訂 lane-ink 新增的「岸邊泡沫 / 水面倒影塊」那一列

> 該列的**唯一縫**欄與**鐵律**欄補上消費端(lane-ink 落地時那一欄只寫到 toon.js 這一半):

| 領域 | 唯一縫 | 鐵律 / 稽核 |
|---|---|---|
| 岸邊泡沫 / 水面倒影塊 | `toon.js FOAM`/`REFL` + `seaFieldN()`/`foamBandM()` + `setSeaDepthField()`(唯一寫入點)+ 共享 uniform `_seaField`/`_seaRect`/`_foamA`/`_foamC` + GLSL `celFoam()` 與 `CEL_REFL` 頂點分支;旋鈕 `foam` / `reflect`;**消費端** `terrain.js` 的 `bakeSeaDepth()`(烤)/ `stampSeaBlockers()`(蓋章;對外 API 恰此一欄)/ `seaFadeAt()`・`seaFadeAtWorld()`、`main.js` 緊接 `terrain.inBorderBand` 那一行的**一行**接線、`biomes.js` 的 `planReflectors()`(名冊)/ `buildWaterReflections()` / `REFL_WAVE_WRITERS` | 前九條(lane-ink 那一列)不變。**2026-08-16 消費端追加八條**:⑩**深度場的取樣 MUST 走 `sampleField`**(= `heightAt` 的同一份三角化雙線性)—— 自己再寫一份的症狀是「泡沫的岸線與腳踩得到的岸線差半格」;列 = z、欄 = x(`DataTexture` 的 `flipY` 恆 false),轉置的話泡沫會出現在**垂直於岸線**的那一邊。⑪**蓋章的橫斷面 MUST 是 A30 的那一份**(有向盒吃 `hw2/hd2/ry`,local 軸 `sn = −sin(ry)`;圓只當 broad-phase 且是**外接**半對角)—— 只用外接圓 = 40m 長條建物旁邊一圈方形泡沫,而「看得見的泡沫」與「擋得住彈的牆」對不上正是 A30 那一族。⑫**蓋章 MUST 先重烤**:`heights` 在水盤建好之後還會被 `carveTunnels` / `carveGalleryBands` / `gradeRoadBeds` 改(路塹與整平),用建構當下那一份就是「整平過的岸邊泡沫沒跟著走」;實測單次 6.0ms(worldW 1200m ⇒ 800²)/ 9.6ms(2400m,頂到 1024²)/ 1.8ms(低功耗 400²)⇒ **兩次都在一格 `SLICE_MS`(16ms)之內**,MUST NOT 為它新增 `await`(§2.1 F「建構期讓步」④)。⑬**`bakeSeaDepth` 的狀態是 `let`,MUST 宣告在呼叫點之前**:函式宣告 hoist 得到而 `let` 不會 ⇒ 擺在後面就是 TDZ `ReferenceError`,而訊息指向完全無關的地方(同 toon.js `_foamA` 那一段的坑;本輪踩過一次,`audit_water_edge` Ⅰ 有一條在守)。⑭**`seaFadeAt` MUST 是轉呼 `seaFadeOf` 的薄殼,方向不可反過來**:`audit_soft_stroke` Ⅵ 把 `seaFadeOf` 的原文丟進**只注入 `smooth01` / `edgeWallInsetM`** 的 `new Function` 沙箱直測,`seaFadeOf` 一旦呼叫任何模組級的東西,那支會在**呼叫時**丟 `ReferenceError` ⇒ 整支中斷,而訊息與海浪無關。⑮**倒影體名冊 MUST 排除邊界牆環**(A44:它是 `blockers` 的**第一批**,`slice(0, N)` 剛好只選到它 ⇒ 四條邊各長出一道連續倒影牆而圖心的建物一個都沒有);判據取既有的唯一縫 `edgeWallInsetM()`(環的盒心恆在夾制線**外側** —— 內面貼線、厚度往圖界方向長),**MUST NOT** 另立一個「這是不是邊界牆」的旗標。排序 MUST 是**全序**(同分再比座標),否則兩台客戶端選到不同的前 N 個。**近岸帶刻意沿用 `REFL.MIN_H`**(一個授權值,不是兩個:水面上要多高才反射 = 腳要多靠近水面才算站在岸邊)。⑯**`REFL_WAVE_WRITERS` 是補償不是設計**:`refl` 的材質 MUST 同時帶 `soft: seaSoft()` 才拿得到 `uSoftAmp`/`uSoftFreq`(S6 契約原文),而 `soft.axis === 'w'` 會連帶開 `CEL_WAVE` ⇒ toon.js 的頂點端 `#ifdef CEL_REFL` 與 `#ifdef CEL_WAVE` **各把 `celSeaH × seaFade` 加進 `transformed` 一次** = 2× 波幅(倒影塊浮在水面上方最多 0.9m)。落地在 biomes 端把**逐頂點的 `seaFade` 除以寫入處數**;`audit_water_edge` Ⅲ **數 toon.js 的寫入處**並與常數比對 ⇒ 上游補上 `#ifndef CEL_REFL` 之後這一條會紅,**那是提醒不是壞掉**(正解見待裁決 ④)。⑰**吃 `seaSoft()` 的材質 MUST 全部是 `transparent`**:`celFoam` 那一段把 `gl_FragColor.a` 推向 1(泡沫蓋住水底),而 alpha 對**不透明**的 cel 材質是勾線門檻倍率(`CEL_SOFT` / `CEL_INKA` 契約)⇒ 掛到不透明件上就是那批物件的細勾線**靜默消失**;那一段只包在 `#ifdef CEL_WAVE` 裡、沒有再問一次 `transparent`,消費端這一側守得住的就是這一條。稽核 `audit_soft_stroke` Ⅵ(toon 側)+ **`audit_water_edge`**(消費端)±`--break-foam` / `--break-stamp` / `--break-refl` / `--break-fade` |

## ①-b `.claude/rules/retired.md` —— 新增一列

| 退場 | 日期 | 取而代之 |
|---|---|---|
| **格點驅動的岸邊泡沫片**(`biomes.js` 的 `shoreFoamTex()` 與 `buildWaterEdges` 的 `fp`/`fnrm`/`fuv`/`fidx` 分支、它的 `dynamics.push`(潮汐呼吸 + 微浮沉 + 貼圖漂移),連同 `buildWaterEdges` 的 `dynamics` 參數) | 2026-08-16 | **`toon.js celFoam()`**(深度場驅動 + `step()` 硬邊 + 相位減 `celSeaH` ⇒ 跟著浪沖上岸),消費端只有 `terrain.bakeSeaDepth` / `stampSeaBlockers`。舊制三件事都是這一輪要否定的:驅動量是**岸線幾何**(`terrainEnvCode` 的 8m 格點,量化成方塊)而不是水深、外觀是 Canvas 徑向漸層的**柔霧**而不是賽璐璐的白色硬邊、而且它是一片固定在 `waterY + 0.1` 的**平板** —— 浪高 ±0.9m 的波峰直接從泡沫片裡穿出去。**兩份 shore band 並存 = 新的硬邊被舊的軟 alpha 糊掉,而每一條既有斷言照樣全綠**(症狀只是「岸邊看起來髒髒的」)。潮間帶(`tp`/`tidx`)**保留**(那是 envCode 2↔0 的另一件事)。連帶移除 `shoreFoamTex()` 的三個 `Math.random()`(只染像素、不進散布路徑 ⇒ 刪掉是嚴格改善,共享 rnd 序列一格未動)。MUST NOT 復辟 |

---

## ② `.claude/rules/verification.md`

### §5.1(續)離線稽核清單要新增的一行

```bash
node tools/audit_water_edge.mjs   # 岸邊泡沫的深度場(烤 + 蓋章)/ 水面倒影塊的名冊與幾何 / 舊泡沫退場 / 純表現層
#   ±--break-foam(烤場不再讀地形高度 ⇒ Ⅰ 紅 3:陸地 / 深水 / 列欄序;四條控制組仍綠)
#   ±--break-stamp(蓋章退回外接圓 ⇒ Ⅱ 紅 1:盒外那一點被誤蓋;兩條「盒內」對照組仍綠)
#   ±--break-refl(倒影名冊不排除邊界牆環 ⇒ Ⅲ 紅 2;上限 / 全序 / MIN_H 三條仍綠)
#   ±--break-fade(倒影的 seaFade 不再除以寫入處數 ⇒ Ⅲ 紅 1)
```

### §5.5 對照表 —— 新增一列

| 改動 | 驗證 |
|---|---|
| **岸邊泡沫 / 水面倒影塊的消費端**(`terrain.js` 的 `seaFadeAt`・`seaFadeAtWorld`・`bakeSeaDepth`・`stampSeaBlockers` 與對外 API 那兩欄 / `main.js` 的 `terrain.stampSeaBlockers?.()` 那一行 / `biomes.js` 的 `REFL_WAVE_WRITERS`・`REFL_C`・`planReflectors`・`buildWaterReflections`・`buildWaterEdges` 的泡沫分支退場) | `audit_water_edge` ±**四支** `--break`(每一支 MUST 對應紅字,條數見 §5.1 那一段)+ **`audit_soft_stroke` MUST 逐項不變**(toon 側一行未改;⚠ 它的 Ⅵ 用 `^function seaFadeOf…^}` 抽原文丟進**只注入 `smooth01`/`edgeWallInsetM`** 的沙箱 ⇒ `seaFadeOf` MUST 保持自給自足,抽函式的方向不可反過來)+ **`audit_siteplan` / `audit_beacons` / `audit_object_joints --seeds 8` / `audit_ground_tile` / `ground_seam` / `ground_enclave` / `ground_qc` / `ground_border` / `audit_world_edge` / `audit_world_height` / `audit_world_curve` / `audit_gpu_lifecycle` / `audit_cel_pipeline` / `audit_visual_prefs` / `audit_climb` / `audit_layer_block` / `audit_npc_collide` / `audit_slope_move` / `audit_leaf_card` / `audit_rock_ink` / `audit_ambient_motion` 逐項不變** —— **判準是「逐項不變」不是「仍全綠」**(它們驗規則不驗位置,共享 `rnd()` 序列被推移時全部照樣綠;`audit_terrain_ray` 只有那一行 ms 讀數會跳,那是計時不是語意)+ `audit_open_tunnel` / `audit_underpass` / `audit_road_joint` / `audit_road_bed` / `audit_road_grid` / `audit_world_text` / `audit_vernacular` / `audit_ground_drape` / `audit_mini_map` / `audit_bridge_crossing` / `audit_water_skirt` / `audit_bridge_tower_pad` / `audit_lane_navigation` 全綠(㋔:`terrain.js` 與 `biomes.js` 各動了一處)+ `audit_client_syntax` ±`--break-glsl`(㋖)+ `npm run audit:net` / `audit_solo_boot`(**`terrain.js` 多一條 `import { lowPower } from './mobile.js'`** ⇒ A28 家族的模組邊不該憑推理放行)+ **`npm run bal` / `npm test` MUST 逐項不動**(`data.js` / `sim.js` / `server/**` 一行未改;e2e 唯一會動的是幾個由 per-run 亂數印出來的數字,✅ 的**條數** MUST 相同)+ **㋓ `shot_scene --venue <有水域的場地> --dof=0 --curve=0` 的 `waterline` 機位三輪**(預設 / `--pref foam=0` / `--pref reflect=1`;「泡沫像不像浪」「倒影是亮的還是暗的」離線一條都驗不到)+ **㋓ 真 GPU**(新的 `attribute aReflO` 與 `varying vSeaFade` 會不會讓整批物件不畫 —— `gl.getError()` MUST 為 0;`reflect` 0 → 1 → 0 MUST **逐位元還原**)+ **㋕ 真機走到岸邊**(泡沫有沒有跟著浪上下、有沒有繞過柱子、53m 外環那一圈 MUST 一點泡沫都沒有)。⚠ 改 `FOAM.TEXEL_M` / `FOAM.RANGE_M` MUST 回頭量建構耗時(**MUST 收在一格 `SLICE_MS` = 16ms 之內**,超過就要挪到既有的階段回報點之後,MUST NOT 自己新增 `await`)|

---

## ③ 根 `CLAUDE.md` §2.1 目錄

lane-ink 已把「**岸邊泡沫與水面倒影塊**」加進 `seams-render.md`(§2.1 F)那一列的主題清單
⇒ **本段無新增**。

---

## ④ `docs/anime_style_plan.md` 執行紀錄 + 對計畫 / 規格的更正

### 執行紀錄

> **2026-08-16 第二輪 · lane-world 第二階段(水)**|⑤-2 岸邊泡沫(**替換**舊的格點泡沫片)+ ⑤-3 水面倒影塊落地。縫:`terrain.js` 的 `seaFadeAt` / `seaFadeAtWorld` / `bakeSeaDepth` / `stampSeaBlockers`(對外 API **只加不改**兩欄)+ `main.js` 的一行接線 + `biomes.js` 的 `planReflectors` / `buildWaterReflections` / `REFL_WAVE_WRITERS` 與舊泡沫分支退場。新稽核一支(`audit_water_edge` **64 項**,四支反向驗證逐支咬得住:3 / 1 / 2 / 1 條紅字)。**逐位元證明面**:`npm run bal` 🎉 全綠(與基準**逐位元相同**)、`npm test` **624 ✅**(隔離埠 8697;差異只有 5 個由 per-run 亂數印出來的數字,條數相同);`audit_siteplan` / `beacons` / `object_joints --seeds 8` / `ground_tile` / `ground_seam` / `ground_enclave` / `ground_qc` / `ground_border` / `world_edge` / `world_height` / `world_curve` / `gpu_lifecycle` / `cel_pipeline` / `soft_stroke` / `visual_prefs` / `climb` / `layer_block` / `npc_collide` / `slope_move` / `leaf_card` / `rock_ink` / `ambient_motion` 共 **22 支輸出逐位元相同** = 零共享 `rnd()` 消耗成立。**行為直測(離線)**:烤場的陸地 = 0 / 深過 `RANGE_M` = 255 / 中間帶有梯度 / 列 = z 欄 = x / 無水域不烤;蓋章的圓柱與**繞 45° 的有向盒**逐點驗(沿長軸 10√2m 蓋得到、垂直方向同樣落在**外接圓內**的那一點 MUST NOT 蓋);倒影塊在 THREE 樁上真的跑一遍 —— 9 個反射體 ⇒ **一個 mesh / 108 頂點 / 54 三角形 / 1 個 draw call**,`seaFade = 0.5`(= 1 ÷ 寫入處數)、`position.y ⊂ [0,1]`、兩次建構逐位元相同、`reflect = 0` ⇒ `visible = false`。建構耗時實測 6.0ms(1200m)/ 9.6ms(2400m,頂到 1024²)/ 1.8ms(低功耗),兩次烤都在一格 `SLICE_MS` 之內。**未驗**:㋓ 定場照與真 GPU、㋕ 真機、`npm run audit:net`(見交付說明)。

### 對計畫 / 規格的更正(本道量到的)

1. **計畫書「本專案的水面現在只有波形,沒有 shore band」是過期的,而執行順序表把 ⑤-2 標成
   「是(純新增)」是錯的。** `biomes.js` 早有一條岸邊泡沫帶(8m 格點 + Canvas 徑向漸層軟
   alpha + 固定在 `waterY + 0.1` 的平板 + opacity 呼吸 + 貼圖漂移),而且它**正是計畫要否定
   的那一種**。⇒ ⑤-2 是**替換不是純新增**,而且 **`foam = 0` 也不是「回到今天」**(它是
   「岸邊連浪都沒有」)。退場那一列見上方 ①-b。
2. **規格要求 `tools/shot_scene.mjs` 補 `--foam=0` / `--refl=0` 旗標 —— 不需要,而且不該加。**
   lane-ink 的 S10 已經把兩者做成 `VISUAL_KNOBS` 的兩根拉桿,而 `shot_scene` 早有
   `--pref k=v`(把旋鈕種進 `localStorage`)⇒ `--pref foam=0` / `--pref reflect=1` 就是規格
   要的東西。加專屬旗標 = **同一個開關的第二份實作**(而且它會與拉桿分家)。
   ⇒ 本輪 `shot_scene.mjs` **一個字未動**。
3. **規格要求擴充 `audit_soft_stroke`(celSeaH 呼叫點 6 → 7、新增泡沫與倒影斷言)—— 已由
   lane-ink 在 S6 落地時做完**(現值是 **8**:定義 1 + 中央差分 4 + 水面位移 1 + 倒影塊 1 +
   泡沫相位 1),而且該支已帶 `--break-foam`。依 S11「lane-world 的新斷言一律進自己的新稽核
   檔」,本道的斷言全部進 `tools/audit_water_edge.mjs`,`audit_soft_stroke.mjs` **一個字未動**。
4. **規格的「`seaFadeOf` 內圈抽成 `seaFadeAt`、`seaFadeOf` 轉呼它」方向必須反過來。**
   `audit_soft_stroke` Ⅵ 以 `^function seaFadeOf\(geo, w, h\) \{[\s\S]*?^\}` 抽原文丟進
   **只注入 `smooth01` / `edgeWallInsetM`** 的 `new Function` 沙箱做行為直測 ⇒ `seaFadeOf`
   一旦呼叫任何模組級的東西,那支會在**呼叫時**丟 `ReferenceError`(整支中斷,而訊息與海浪
   完全無關)。落地成 **`seaFadeAt` 是轉呼 `seaFadeOf` 的一行薄殼** ⇒ 仍然只有一份實作、
   那支沙箱逐項不動,而規格擔心的「第二份實作」也沒有發生。
5. **`stampSeaBlockers` 另外先重烤一次**(規格只寫「蓋章」)。`heights` 在水盤建好之後還會被
   `carveTunnels` / `carveGalleryBands` / `gradeRoadBeds` 改 ⇒ 用建構當下那一份就是「路基整平
   過的岸邊泡沫沒跟著走」。成本實測見執行紀錄,兩次都在一格 `SLICE_MS` 之內。
6. **`buildWaterEdges` 的 `dynamics` 參數退場**(泡沫是它唯一的動態消費端)。
   ⚠ `tools/audit_ground_seam.mjs:384` 的訊息字串仍寫「泡沫/潮間帶仍住 buildWaterEdges」——
   **語意過期但只是一句訊息**(不是斷言,該支全綠),而那支不在本道的 `ownsFiles` 裡
   ⇒ 留給整合者順手改成「潮間帶仍住 buildWaterEdges」。
7. **`terrain.js` 多一條 `import { lowPower } from './mobile.js'`**(深度場的 texel 邊長跟著
   低功耗折半,同 `SHADOW.TEXEL_M` 那一條)。`mobile.js` 不 import `terrain.js` ⇒ 無循環;
   `audit_solo_boot` 全綠。**`npm run audit:net` 本輪未跑**(它的 ⑦ 段會 spawn 連外網、永不
   結束的 dev 工具 —— 本窗的硬紀律)⇒ **列為未驗項**。
8. **`REFL_WAVE_WRITERS = 2` 是補償不是設計。** 見上方 ① ⑯ 與待裁決 ④。
9. **`buildBiomes` 的 `userData` 多一格 `reflectors`**(反射體數;0 = 無水域或岸邊沒有夠高的
   東西)。與 `petals` / `rails` / `falls` 同一條慣例,消費端目前只有交付說明與稽核。

---

## ⑤ 待裁決(MUST 由使用者定案;本輪一律做成旋鈕 + 預設不生效)

> ①②③ 是 `seq9-water.md` blockedOn 原文的三項,原封不動抄過來;④~⑦ 是本道量到的。

1. **岸邊泡沫要不要「繞過每一顆石頭與每一根柱子」的完整版,還是接受烤好的深度場?**
   三條路的代價已量清:**(a) 烤好的深度場**(規格的推薦,**本輪落地的就是它**)—— 零額外
   render pass,texel 1~1.5m,能繞過地形與所有登記過的 `blockers`(建物 / 神木 / 巨岩 /
   橋墩 / 門洞柱),**繞不過**沒有碰撞柱的純表現層擺件與移動中的機體;成本 = 1MB VRAM
   (低功耗 256KB)+ 建構期 20~40ms(**本輪實測 6.0 / 9.6 / 1.8ms 單次,烤兩次共 ≤ 20ms**)。
   **(b) 深度 prepass**(逐幀真深度,連移動中的機體都繞)—— 多一趟全場 render,即使半解析度
   也是 `postfx` 檔頭當初拒絕第二張陰影圖的同一筆錢。**(c) 水面 `depthWrite: false` + 後製
   泡沫** —— 零額外 pass,但**水岸那條勾線會整條消失**(勾線的二階差分再也量不到水面)且
   狙擊景深改對焦到水底,兩者都是可見的回歸。
2. **倒影塊是亮的還是暗的?** 「物件→視點」的方向與 3~4 段斷口是計畫定死的,但顏色不是:
   亮版(天光 / 陽光反射的高光帶)與暗版(物件擋住天光,用 `shadowTintRGB()` 的同一個色相)
   在畫面上是兩種完全不同的東西,而這正是紀律①「卡在需美術方向確認的項目 MUST NOT 由
   commit 定案」。⇒ `reflect` def = **0**(不畫);本輪的 `REFL_C = 0xdfeeff` / `REFL_A = 0.34`
   是**亮版的樣品值**,請看過 `shot_scene waterline --pref reflect=1` 之後定案。
3. **倒影塊要不要帶物件自己的顏色?** 逐反射體顏色沒有現成來源(`blockers` 只有幾何、沒有
   材質色),要就得在 `buildBiomes` 收一份逐棟代表色 = 新的一份帳。本輪的預設是**全場共用
   一個色**(刻意的降級,同 `surfaceId` 逐材質那條註記的寫法「是刻意的降級,不是假裝有」)。
4. **`toon.js` 的 `CEL_REFL` 與 `CEL_WAVE` 各把浪高加一次(2× 波幅)。**
   `refl` 的材質 MUST 同時帶 `soft: seaSoft()` 才拿得到 `uSoftAmp` / `uSoftFreq`(S6 契約
   原文),而 `soft.axis === 'w'` 會連帶開 `CEL_WAVE` ⇒ 倒影塊會浮在水面上方最多一個波幅
   (0.9m)。**正解是在 `toon.js` 的 `#ifdef CEL_WAVE` 位移那一段加 `#ifndef CEL_REFL`**
   (一行),但 `toon.js` 是 lane-ink 的地盤 ⇒ 本輪在 biomes 端把**逐頂點的 `seaFade` 除以
   寫入處數**補回來,並讓 `audit_water_edge` Ⅲ **數 toon.js 的寫入處**與常數比對:上游修好
   之後那一條會紅,**那是提醒不是壞掉**,把 `REFL_WAVE_WRITERS` 改成 1 即可。請裁決由誰收。
5. **`foam` def = 1 ⇒ ⑤-2 不是逐位元中性,而且 `foam = 0` 也不是舊制。**
   舊的格點泡沫片已退場(①-b),拉到 0 是「岸邊沒有浪」不是「回到今天」。⑤-3 那一半則**是**
   逐位元中性(`reflect` def = 0 ⇒ mesh `visible = false` ⇒ 一個 draw call 都不進)。
   要不要保留舊泡沫當 `foam = 0` 的退路,是使用者的決定(本輪照「衝突時以
   `anime_style_plan.md` 為主」把它退場了)。
6. **`REFL` 的五個數(`SEG_N 3` / `GAP_F 0.22` / `MIN_H 4` / `MAX_N 24` / `HALF_F 0.9`)與
   `FOAM` 的五個數是 lane-ink 交付的授權值不是量測值**(同 `PETAL.SIZE`、`MINI.BUFFER_F`)。
   校準面是定裝照(㋓)與真機(㋕),兩者沙箱都跑不動。現值下實測:9 個反射體 ⇒ 54 三角形。
7. **倒影塊上也會畫泡沫(半強度)。** `soft: seaSoft()` 連帶開 `CEL_WAVE` ⇒ 片段端的
   `celFoam` 對倒影塊也生效,而 `vSeaFade` 已被 ④ 的補償折半 ⇒ 近岸的倒影塊會被泡沫打散。
   **設計上可接受**(浪把倒影打碎正是想要的),但沒有實拍證據 ⇒ 併進 ② 一起看。
