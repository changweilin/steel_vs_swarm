# lane-world 第三階段(⑨ 立體結構重新渲染 / 序 12b)文件差異 —— 交給整合者序列合併

> 2026-08-16 第三窗(本檔刻意**不叫** `lane-world-w3.md` —— 那個檔名已經被**窗 2** 的
> 「載具 SPEC + 鳥群」報告佔用,而那是已交付的內容,覆寫或混寫都會弄丟它)。
> 平行窗期間本道**沒有**動 `CLAUDE.md` / `.claude/rules/**` / `docs/anime_style_plan.md` /
> `public/js/.claude.md` / `tools/CLAUDE.md` 任何一個字(S13),也**沒有**動
> `.github/workflows/ci.yml`(它不在本道的 ownsFiles —— CI 註冊那一行寫在第 ② 段)。
>
> 涵蓋:**序 12b / ⑨ 立體結構重新渲染**(`docs/_pending/spec/seq12b-struct.md` 的
> ⑨-1 / ⑨-2 / ⑨-3 / ⑨-4 / ⑨-5)+ **⑨ × §0-a 的 keep-out 名冊核對**(交給序 13/14)。
>
> 寫入的檔案:`public/js/biomes.js`・`tools/audit_struct_ink.mjs`(新)。
> `public/js/terrain.js` 與 `public/js/environment.js` **一個字未動**(⑨ 的第一句是定案:
> 既有技術一行不動,而這兩支全部落在那張「MUST 原封不動」表裡)。

---

## ① `.claude/rules/seams-render.md` §2.1 F 要新增的一列(原文)

| 領域 | 唯一縫 | 鐵律 / 稽核 |
|---|---|---|
| 立體結構的線工授權 / 洞口反光帶 | 授權表 = `biomes.js` 的 `buildRoads` → `makeDeckIndex` 這一區的 **22 支材質**(逐支只准經 `envMat`/`toonMat`/`toonPlain`);量尺 `biomes.bandPitchM()`(緞帶/面狀件的**成對頂點**實測節距);推導縫 `toon.js inkRepeat()`(節距軸)與 `data.js inkCtrM()`(尺寸軸);表面群組 `toon.js SURF_ID.CONCRETE`;提亮只准 `emissive` | 2026-08-16 序 12b(計畫 §⑨)。**⑨ 的第一句是定案:既有技術一行不動** —— `tunFloorAt`/`underpassPlan`/`strucHw`/`tunRoofTop`/`tunnelWallProfile`/`galBores`/`carveGalleryBands`/notch + Coons patch/`decks`/`deckAt`/`carriageHw`/`gradeRoadBeds`/`markBaseAt`/`_slabHitT`/`ceilingAt`/`lev`/`slopeBlocked`/A29 四旗標全部原封不動,本項只動材質與著色層 ⇒ **判決面是既有七支幾何稽核逐項不動**(`audit_open_tunnel` 163 / `audit_underpass` 161 / `audit_layer_block` 61 / `audit_road_joint` 86 / `audit_road_bed` 16 / `audit_bridge_crossing` 16 / `audit_bridge_tower_pad` 23 / `audit_water_skirt` 8),**任何一支變紅就是視覺改動漏進了幾何**。六條:①**結構區塊 MUST 零原生材質** —— 繞過 cel 入口 = 沒有 `gInfo` 宣告 = 那一批物件**整批不畫而 console 一個字都沒有**(WebGL2:啟用中的 draw buffer 沒有對應 output = `INVALID_OPERATION`,不拋例外);這一條比 `audit_cel_pipeline` Ⅵ 的「自寫 ShaderMaterial 要宣告」**更硬一層**(繞不過就不必問宣告),兩者 MUST NOT 互相重寫。②**貢獻推導不手寫**(S4):呼叫端 MUST 傳自己排零件時已經算出來的間距或尺寸,唯一容許手寫的是具名否決值 `INK_CONTRIB_NONE`;**推導值剛好是 1 的那一批 MUST 維持預設**,MUST NOT 寫 `contrib: 1`(`inkQuant(1)` 嚴格 === 1 ⇒ 寫進去只是把推導偽裝成常數,而且它是「逐位元同舊制」的證明面)。③**節距實測取 max 不是 min**:邊梁底緣被地表夾住的那幾段對距會退化成 0,取 min 就是整條邊梁的墨線一起消失,而畫面上只表現成「橋腹沒有線」。④**坑門混凝土是一個「類別」不是一個「實例」** ⇒ 額牆/翼牆(`wallM`)、`collar`、外露頂板(`galRoof`)三處共用具名號 `SURF_ID.CONCRETE`,MUST NOT 改走 `surfGroup()` 的循環號;同色的**洞內橫樑**刻意留在 `nextSurfId`(拱頂/樑/柱之間的線是要的)。混凝土↔上方山坡那條線靠 `SURF_ID.LAND = 0` 照樣出得來(差 1/64 = 0.0156 > 勾線 pass 的 id 門檻 0.004,而那個門檻 MUST **從 `postfx.js` 原文解析**,MUST NOT 手寫)。⑤**提亮只准由 `emissive` 提供** —— 既有定案是「不亮的凹處要 emissive,**不是換淺一點的顏色**」(自動販賣機取出口那一課),九個結構底色逐位元凍結;School B 之下洞內整片落在暗帶是**預期**,處方是「亮的東西自己亮」(天花燈 + 洞口反光帶)加上輪廓在說話,MUST NOT 調高天花燈強度或把牆的底色調亮。⑥**逐格各建一支材質 = 沖爛 `nextSurfId` 的 64 個槽**:洞口警示條紋舊制每座洞口 8 支、全圖最多 384 支,MUST 提到迴圈外收成兩支。稽核 `audit_struct_ink` ±`--break-rawmat`/`--break-contrib`/`--break-surf`/`--break-emissive` |

### ①-b `seams-render.md` 「表面群組」那一列的 ① 條補一句

> `k = 1` 那一格自 2026-08-16 起**真的有消費端**了:`SURF_ID.CONCRETE` = 坑門混凝土家族
> (額牆/翼牆 + collar + 外露頂板,`biomes.js` 恰三處)。它與 `surfGroup()` 的循環號
> (k ∈ [2,63])**語意刻意不同** —— 那是「這一株樹/這一顆岩石」的實例號,而混凝土是一個
> **類別**(全圖每一座洞口共用同一號)⇒ 走具名常數不走配號器,零狀態、零亂數。

---

## ② `.claude/rules/verification.md` + CI 註冊

### §5.1(續)離線稽核清單要新增的一行

```bash
node tools/audit_struct_ink.mjs      # 立體結構的線工授權(⑨:零原生材質 / 貢獻推導不手寫 /
                                     #  坑門混凝土共用具名號 / 底色凍結 + 提亮只准 emissive / 零 rnd)
#   ±--break-rawmat(結構區塊多一支原生材質 ⇒ Ⅰ MUST 紅)
#   ±--break-contrib(貢獻改手寫常數 ⇒ Ⅱ MUST 紅 3 條)
#   ±--break-surf(三處具名號拿掉 ⇒ Ⅲ MUST 紅 2 條)
#   ±--break-emissive(換淺底色代替 emissive ⇒ Ⅳ MUST 紅 4 條)
```

### `.github/workflows/ci.yml`(**本道未動,請整合者加**)

離線稽核清單插在 `node tools/audit_cel_pipeline.mjs` 之後(與它同族):

```yaml
      - run: node tools/audit_struct_ink.mjs
```

### §5.5 對照表 —— 新增一列

| 改動 | 驗證 |
|---|---|
| **立體結構的材質 / 線工授權 / 坑門表面群組 / 洞口反光帶**(`biomes.js` 的 `bandPitchM` 與 `buildRoads` → `makeDeckIndex` 那一區的 22 支材質、`stripeLit`/`stripeDark`/`stripeCtr`;`toon.js` 的 `SURF_ID.CONCRETE`/`inkRepeat` 消費端) | `audit_struct_ink` ±**四支** `--break`(每一支 MUST 對應紅字)+ **既有七支幾何稽核逐項不動**(`audit_open_tunnel` / `audit_underpass` / `audit_layer_block` / `audit_road_joint` / `audit_road_bed` / `audit_bridge_crossing` / `audit_bridge_tower_pad` / `audit_water_skirt`)—— **這八支就是「視覺改動有沒有漏進幾何」的判決面,判準是逐項不動不是「仍全綠」** + `audit_siteplan` / `audit_beacons` / `audit_object_joints --seeds 8` / `audit_ground_tile` / `ground_seam` / `ground_enclave` / `ground_qc` / `ground_border` / `audit_world_edge` **逐字元相同**(結構區塊零共享 `rnd()` 消耗 ⇒ 散布序列不得推移)+ `audit_cel_pipeline` / `audit_soft_stroke` / `audit_visual_prefs` / `audit_gpu_lifecycle` / `audit_climb` / `audit_slope_move` / `audit_npc_collide` / `audit_world_height` / `audit_terrain_ray` 全綠 + `audit_client_syntax`(㋖)+ `npm run audit:net` / `audit_solo_boot` + **`npm run bal` / `npm test` MUST 逐項不動**(`data.js` / `sim.js` / `server/**` 一行未改)+ **㋓ `shot_tunnels --kind tunnel|underpass|gallery` 三輪與改制前基準並排**(洞內是這一族**唯一沒有任何離線稽核看得到**的地方)+ **㋓ `shot_scene --venue taroko --pref inkMrt=on`**(⑨-3 / ⑨-4 只住第二張附件 ⇒ 不帶這個旗標會得到「改了沒反應」的假結論)+ **㋕ 真機**:走進山體隧道與地下道各一次、走上高架橋一次(判準三條:洞內看得出拱頂/樑/柱的輪廓、洞口黃帶亮著而牆沒有整片被提亮、坑門混凝土與上方山坡之間有一條線而額牆與 collar 之間沒有)。⚠ 改 `TUN.COL_GAP` / 欄杆帶高 / `UND.COPE` MUST 回頭看 `audit_struct_ink` Ⅱ-e(那幾條斷言釘的是**推導的單調性**,不是現值) |

---

## ③ 根 `CLAUDE.md` §2.1 目錄要加的主題名

`seams-render.md`(§2.1 F)那一列的「涵蓋的縫」清單追加一個:

> …・幀率無關阻尼・**立體結構的線工授權**・共用視覺入口

---

## ④ `docs/anime_style_plan.md` 執行紀錄 + 對計畫的更正

### 執行紀錄

> **2026-08-16 第三窗 · lane-world(序 12b / ⑨ 立體結構重新渲染)**|⑨-1~⑨-5 五件全部落地,
> **幾何 / 碰撞 / slab / decks / cols / 走廊一格未動**。縫:`biomes.js` 新增 `bandPitchM()`
> (緞帶/面狀件的成對頂點實測節距,零亂數)+ 22 支結構材質的線工授權(6 支吃推導值、
> 15 支維持預設、1 支具名否決)+ 坑門混凝土三處共用 `SURF_ID.CONCRETE` + 洞口警示條紋
> 補 `emissive` 並把兩支材質提到迴圈外(384 → 96 支)。新稽核 `tools/audit_struct_ink.mjs`
> **35 項**,四支反向驗證逐支咬得住(1 / 3 / 2 / 4 條紅字)。**證明面**:既有七支幾何稽核
> (`open_tunnel` 163 / `underpass` 161 / `layer_block` 61 / `road_joint` 86 / `road_bed` 16 /
> `bridge_crossing` 16 / `bridge_tower_pad` 23 / `water_skirt` 8)**逐項不動**;
> `siteplan` 265 / `beacons` 68 / `object_joints --seeds 8`(22637 接合、異常 0)/ `ground_tile` /
> `ground_seam` / `ground_enclave` / `ground_qc` / `ground_border` / `world_edge` 156 與改動前
> **逐字元相同**(零共享 `rnd()` 消耗);`npm run bal` 🎉、`npm test` **624 ✅**(隔離埠 8657,
> 跑完 taskkill)。**未驗**:㋓ `shot_tunnels` 三輪 / `shot_scene --pref inkMrt=on`、㋕ 真機、
> `npm run audit:net`(本窗硬紀律禁止)。

### 對計畫 / 規格的更正(本道量到的)

1. **§⑨ 那張「MUST 原封不動」表裡有六個名字在本儲存庫查無**(全庫 grep 零命中):
   `buildCribs` / `cribColumn` / `quadTo` / `boreProfile` / `boreClearance` / `sweptSolid`
   —— 那是參考專案的詞彙。連帶 ⑨-3 授權清單點名的**法枠工格網 / 待避所 / 坑門冠石 /
   橋面伸縮縫 / 欄杆立柱**也沒有對應幾何。本輪**對號入座到既有幾何,不新增任何幾何**
   (新增幾何 = 新增世界內容,要回答 §2.3 的「這一段消耗了幾枚共享 `rnd()`」,而 ⑨ 的前提
   是零消耗)。逐列對照:

   | 計畫寫的 | 本儲存庫的實際落點 | 授權值 |
   |---|---|---|
   | 洞內拱圈 | 地下道擋土牆 `wall`(帶高 = `TUN.CLEAR` + 0.5)+ 天花板 `ceilSegs` + 橫樑 `beams` | 推導值 = 1 ⇒ **維持預設** |
   | 坑門冠石(keystone)| 額牆頂梁 `lintel` —— 它吃的是 `wallM` 這一支材質 ⇒ 冠石那一列自動成立 | 1(預設)+ `surf: SURF_ID.CONCRETE` |
   | 待避所(退避壁龕)| **沒有這種幾何**,不做 | — |
   | 法枠工格網 | 最接近的是**明隧道柱列** `galCols`(節距 `TUN.COL_GAP` = 4.5m) | `inkRepeat(TUN.COL_GAP)`(今天 = 1;柱距收到 3.6m 以下會自己讓步) |
   | 欄杆立柱 | 欄杆是**一條連續緞帶** `rail` 不是立柱 —— 「量太滿」的實際來源是緞帶上下兩條邊的二階差分(側視一座橋在 2.2m 內擠著五條近乎平行的線) | `inkRepeat(bandPitchM(rail))` = **0.3333**(5/15) |
   | 橋面伸縮縫 | **沒有這種幾何**;同一族的第二條緞帶是邊梁 `girder` | `inkRepeat(bandPitchM(girder))` = 0.3333 |
   | (計畫沒提但實際最刺眼的一處)| **道路標線** `mark` —— 它與路面貼在同一平面上,id 一差就是每一條虛線、每一塊斑馬線都被描一圈黑邊 | `inkRepeat(bandPitchM(mark))` ≈ 0.0667~0.1333(逐圖不同,見 ⑤-4) |

2. **⑨-1(材質改走新版 `cel()`)與 ⑨-2(MRT 宣告 `gInfo`)在程式碼上是零改動。**
   `buildRoads` → `makeDeckIndex` 這一區的材質**今天就全部走 `envMat`/`toonMat`**
   (實測 22 支,零原生材質)⇒ `gInfo` 由 `applyCelPatch` 無條件寫出,而「換學派」是
   `toon.js` 那一側的推論。本輪落地的是**守門**:新稽核 Ⅰ 段把「結構區塊零原生材質 +
   22 支逐支在授權表上」釘死(`--break-rawmat` 咬得住)。
   ⚠ 規格寫的是 19 支;本輪把洞口警示條紋的材質提到迴圈外 ⇒ 一支變兩支,再加
   `buildTowerBridgePads` 的墩座台/墩身兩支 = **22 支**。

3. **⑨-3 的授權值 MUST 推導,規格建議的「8/15」被 S4 的凍結契約否決。**
   `docs/_pending/lane-ink.md` 第 ⑥ 段 S4 明文:「呼叫端 MUST 傳**自己排零件時已經算出來的**
   間距或尺寸,**MUST NOT 手寫貢獻數字、MUST NOT 建『零件種類 → 貢獻』的名冊**」。
   ⇒ 本輪不寫 8/15,改由**實測節距**推導;實得值:欄杆/邊梁 **0.3333**、標線
   **0.0667~0.1333**、洞口條紋 **0.0667~0.4**(隨門洞寬)、柱列 **1**、洞口暗面 **0**。
   兩者都落在計畫要的「中等 / < 1」帶內,而推導版在改幾何時會自己跟著走。

4. **`SURF_ID.CONCRETE` 是 `1 / 64` 不是 `1`。** 規格建議 `CONCRETE = 1`(並要求註解釘住
   「> nextSurfId 值域上界」),但 lane-ink 的 S3 已經定案成**整數格 `k/64`** 那把梳子
   (`{ LAND: 0, CONCRETE: 1 / 64 }`,k = 0 / 1 保留)⇒ 本輪照凍結契約走。不等式一樣成立:
   `|1/64 − 0| = 0.0156 > 0.004`,且與 `nextSurfId` 的半整數格 `(k+0.5)/64` 恆差 ≥ 0.0078。

5. **`INK_MRT.ID = 0.55` 是「線的強度」不是「id 門檻」。** 規格說「門檻 MUST 從 postfx.js
   原文解析,MUST NOT 手寫 0.004」是對的,但落點不是 `INK_MRT.ID` —— 門檻是勾線 pass
   fragment 裡的 `step( 0.004, idv )` 那個字面。稽核解析的是後者。

6. **天花燈不寫 `contrib: 1`。** 規格步驟 5 要求「天花燈補 `contrib: 1`」,而那正是 S4 禁的
   「手寫貢獻數字」。它的節距是 12m ≫ `INK_REPEAT_M`(3.6m)⇒ 推導值本來就是 1,而
   `inkQuant(1)` 嚴格 === 1 ⇒ **維持預設**才是「逐位元同舊制」的證明面。稽核把這一條做成
   斷言:「推導值本來就是 1 的 15 件 MUST 維持預設」。

7. **洞口警示條紋的材質數 384 → 96。** 舊制在 stripe 迴圈**內**建材質(每座洞口 8 支 ×
   最多 48 座)⇒ 沖爛 `nextSurfId` 的 64 個槽(撞號 = 別處少一條該有的線,而且逐場地不同)。
   本輪提到 stripe 迴圈外(每座洞口 2 支)。**根本壓力仍在**:`biomes.js` 全檔 221 處材質
   建構 vs 64 個槽 —— 見 ⑤-6。

8. **⑨ × §0-a 的 keep-out 名冊:答案是「已經有一份,叫 `gradeCorridors`」,不需要新開;
   計畫寫的 `hillAt` 在本儲存庫查無。** 名冊與差異全文見下方第 ⑥ 段(交給序 13/14)。

9. **規格要求的兩處「別道檔案」本輪沒動**(它們不在本道的 ownsFiles,而本窗硬紀律是
   「只准寫自己那一道的 ownsFiles」):
   ㋐ `.github/workflows/ci.yml` 的新稽核註冊 —— 原文寫在第 ② 段,整合者一行貼上即可;
   ㋑ `tools/shot_tunnels.mjs` 追加第 ⑥ 項掃描(`mid_*` 六向與 `p{i}_in20_up` 的平均亮度與
      亮度分位數)。**這一項是 ⑨-5 唯一的量化驗收面**(洞內是新視覺唯一沒有任何離線稽核
      看得到的地方),而現況只能靠人眼並排 —— 判準 MUST 是「同一套 `--synth` 下的前後對照」
      (沙箱裡取不到衛星影像 ⇒ 絕對亮度與線上版不同,拿一個絕對門檻當閘會是假紅字)。

---

## ⑤ 待裁決(MUST 由使用者定案)

1. **⑨-3 的授權清單被縮短了(法枠工格網 / 待避所 / 橋面伸縮縫 / 欄杆立柱沒有幾何)。**
   本輪走「對號入座 + **不新增幾何**」(見 ④-1 的對照表)。另外兩條路:②為它們新增幾何
   (= 新增世界內容,要回答 §2.3 的 rnd 帳,而且 ⑨ 的前提是「只改材質/著色層」);
   ③留成後續獨立項目。**這是把使用者定案的清單縮短,MUST 由使用者確認。**

2. **洞內構件要不要也共用一個 surfaceId(側牆 / 天花 / 橫樑 / 柱列)。**
   本輪**刻意不收**(規格也是這樣建議的)。收了 = 洞內只剩法線折邊那一條訊號:拱頂與樑的
   分界靠 90° 折邊仍畫得出來,但**柱列與矮牆之間(近乎共面)會整段消失**;不收 = 現制,
   構件之間有線但也多。**只有 ㋕ 走進洞裡才知道哪一種對**,`audit_struct_ink` Ⅲ 現在把
   「橫樑維持逐材質號」釘成斷言 ⇒ 要改的話那一條要跟著改。

3. **洞口反光帶的 `emissive` 是本輪唯一「出貨預設就看得到」的畫面改動,而且沒有旋鈕。**
   ⑨-3 / ⑨-4 只住第二張附件(`inkMrt` 預設 `off`)⇒ 預設組態下逐像素不變;只有黃格的
   `emissive: 0x6a5210 @ 0.55` 是無條件的。要不要掛旋鈕(或翻成 0)是美術方向 ——
   本輪照計畫 ⑨-5 落地成「亮著」,因為那正是它要解的問題(School B 下洞內平成一塊黑)。

4. **標線的貢獻是逐圖不同的**(0.0667~0.1333)。量尺取的是**該圖實際畫出來的最寬標線對距**
   (縱向實線 0.18 / 雙黃線 0.56 / 斑馬線 0.36 / 導流線 0.5)⇒ 沒有虛線的圖會落在另一階。
   兩種都自洽:①現制(逐圖實測,改標線寬度它自己跟著走)②取全域最窄的那一種當常數
   (逐圖同值,但那個常數要手寫)。**本輪走 ①**(S4 的「傳自己算出來的尺寸」)。

5. **欄杆/邊梁的 0.3333 vs 規格建議的 0.5333。** 兩者都在「中等」帶內,差別是前者由帶高
   推導、後者是授權值。**校準面是 ㋓ 的 `shot_tunnels` / `shot_scene --pref inkMrt=on` 定裝照**
   (離線只驗得到「有沒有這個機制」與單調性,驗不到「淡得好不好看」)。要改的話改的是
   `INK_REPEAT_M`(全域授權值,lane-ink 的地盤、且它自己也還在待裁決清單上)而**不是**
   在這裡手寫一個數字。

6. **`nextSurfId` 只有 64 個槽,而 `biomes.js` 有 221 處材質建構。**
   本輪把最兇的那一處(條紋 384 → 96)壓下去,但撞號的根本壓力仍在。症狀是「某兩塊相接的
   東西之間少了一條線」,**沒有任何錯誤訊息,而且逐場地不同**(材質建構順序跟著圖資走)。
   要根治只有兩條路:①把 id 加寬(`gInfo.b` 現在是 8bit 的 64 階)②讓「一個東西」都走
   `surfGroup()` 的具名群組而不是逐材質配號。兩條都是 lane-ink 的地盤。

7. **⑨-5「洞內照明」夠不夠只有 ㋕ 知道。** 本輪照計畫的處方走(「亮的東西自己亮」+ 輪廓在
   說話),**沒有**調高天花燈強度、**沒有**動任何一個底色。若真機上洞內仍讀不出來,下一步
   MUST 是「再加一種會自己亮的東西」(洞口反光標記 / 路面反光釘)而不是把牆調亮 ——
   後者是既有定案明文禁止的那條路。

---

## ⑥ 交給序 13/14:結構足跡 keep-out 名冊的核對結果

**答案:名冊已經有一份,叫 `gradeCorridors`,不需要新開;計畫寫的 `hillAt` 在本儲存庫查無。**

- **產出**:`biomes.markGradeCorridors()`(`biomes.js`)一趟做兩件事 —— ①回傳逐段
  `{x1,z1,x2,z2,hw,kind:'tun'|'bridge',cy}`;②同時以
  `blockArea(blocked, x, z, hw + (kind === 'tun' ? STRUCT_CLEAR_PAD : 4))` 把足跡打進散布用的
  `blocked` 格,`STRUCT_CLEAR_PAD = Math.max(7, UND.COPE, TUN.GAL_CLEAR_W)`(現值 9)。
- **消費端**:`buildRoads` 兩處呼叫端(`audit_open_tunnel` Ⅲ-e 釘住兩處都要傳)、
  `group.userData.gradeCorridors`、`main.js` 上傳伺服器(⚠ 那一份 `.slice(0, 2400)` **會截斷**
  ⇒ 序 14 要吃完整名冊 MUST 走 `group.userData`,不要吃伺服器那一份)。
- **樁裡那一份對得上**:`tools/audit_zone_cut.mjs` 的 keep-out 用的是同一條推導
  (`STRUCT_CLEAR_PAD = Math.max(7, UND.COPE, TUN.GAL_CLEAR_W)`、橋 `hw + 4`),半徑一致;
  粒度上樁是**逐線段膠囊**、執行期是**逐節點圓盤**(節距 `ROAD_SEG` = 6m,而 pad ≥ 7m)
  ⇒ 沿線方向樁 ⊇ 執行期,**這一半沒有缺口**。

**五個對不上的地方(序 14 要嘛補、要嘛明講不管)**:

| # | 差異 | 後果 |
|---|---|---|
| 1 | **座標換算**:樁走 `venue_field.llToWorld`(pre-A42,**不帶主方位旋轉**),執行期走 `data.llToXZ`(旋轉是投影的一部分)| 有 `center.rot` 的場地上 keep-out 帶**整條轉開** —— 這是五條裡最嚴重的一條(樁自己已標未驗) |
| 2 | **名冊來源**:樁走 `venue_field.buildStructs`(`LANE_HW` 白名單 + 弧長 < 24m 的「橋」剔除),執行期走 `markGradeCorridors`(`PED_HW` 黑名單 + 沉錨/跨水規則)| 三類結構不在樁的 keep-out 裡:①**短橋**(< 24m)②**不在 `LANE_HW` 白名單、也不在 `PED_HW` 黑名單**的道路類(`track` / `road` / `busway` …)③**跨水段補橋**(`wet` 而 tags 沒有 `bridge` —— 執行期照樣登記成 `kind:'bridge'` 走廊)|
| 3 | **兵線補橋 `laneWetWays`** 完全不在樁的名冊裡(它由 `cfg` 推導,不是圖資)| 兵線跨水那幾段的橋在切面上不會被讓開 |
| 4 | **明隧道柱列的側別**:兩份都不帶 —— `gradeCorridors` 逐段有 `hw`/`kind`/`cy`,`gal` 位元遮罩只進 `tunnelSegs`(第 7 欄)| 現況靠 `STRUCT_CLEAR_PAD` 已含 `TUN.GAL_CLEAR_W = 9` **兩側對稱**蓋住 ⇒ 構造上不漏,但要「只避開柱列那一側」得從同批交出的 `tunnels` 第 7 欄取 |
| 5 | `hw` 的來源兩邊都是 `strucHw(tags)` ✅(這一項對得上,列出來是為了下一輪不必重查)| — |

**本道不改這一支**(`markGradeCorridors` 落在「MUST 原封不動」表裡,而 `venue_field.mjs` /
`audit_zone_cut.mjs` 是 lane-zonecut 的 ownsFiles)。

---

## ⑦ 本階段的量測與逐位元證據

| 量測 | 結果 |
|---|---|
| `audit_struct_ink`(新) | **35 項 / 0 失敗**;四支 `--break` 逐支咬得住(rawmat 1 紅 / contrib 3 紅 / surf 2 紅 / emissive 4 紅) |
| 既有七支幾何稽核(open_tunnel 163 / underpass 161 / layer_block 61 / road_joint 86 / road_bed 16 / bridge_crossing 16 / bridge_tower_pad 23 / water_skirt 8) | 與改動前**逐字元相同** = 視覺改動沒有漏進幾何 |
| `siteplan` 265 / `beacons` 68 / `object_joints --seeds 8`(22637 接合、異常 0)/ `ground_tile` / `ground_seam` / `ground_enclave` / `ground_qc` / `ground_border` / `world_edge` 156 | 與改動前**逐字元相同**(結構區塊零共享 `rnd()` 消耗) |
| `beacons` / `ground_*` / `world_edge` vs `docs/_pending/base-world/` | **逐字元相同**(`siteplan` / `object_joints` 與 base-world 的差是**窗 2 的載具**造成的,本輪前後相同) |
| `cel_pipeline` 162 / `soft_stroke` 190 / `visual_prefs` 213 / `gpu_lifecycle` 58 / `climb` 211 / `slope_move` 78 / `npc_collide` 44 / `world_height` 49 / `terrain_ray` / `solo_boot` | 全綠(`cel_pipeline` 的一行文字差是**同窗 lane-ink 加了 `toonPlain`**,不是本道) |
| `audit_client_syntax` | 226 ✅ |
| `npm run bal` | 🎉 全綠 |
| `npm test`(§5.2:隔離埠 8657 起新伺服器、跑完 `taskkill`、確認 0 個 LISTENING) | **624 ✅** |
| 結構材質實測 | 22 支全部走 cel 入口、**零原生材質**;6 支吃推導授權值、15 支維持預設、1 支具名否決;3 支吃 `SURF_ID.CONCRETE` |
| 推導值實測 | 欄杆 `inkRepeat(1.08)` = **0.3333**、標線 0.0667~0.1333、柱列 `inkRepeat(4.5)` = **1**、洞口暗面 **0** |
