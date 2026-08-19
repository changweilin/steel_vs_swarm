# lane-world 第二階段 · 之三(載具 SPEC + 鳥群)文件差異 —— 交給整合者序列合併

> 2026-08-16 第三窗。平行窗期間本道**沒有**動 `CLAUDE.md` / `.claude/rules/**` /
> `docs/anime_style_plan.md` / `public/js/.claude.md` / `tools/CLAUDE.md` 任何一個字(S13)。
>
> 涵蓋:**序 10 載具 / 擺件 SPEC(10a)**(`docs/_pending/spec/seq10-vehicle.md` 的
> ③-1 / ③-2 / ③-3 / ③-4)+ **序 11 ⑥-2 鳥群**(`docs/_pending/spec/seq11-birds.md` 的
> ⑥-2 那一半;⑥-3 窗 1 已落地,`public/js/animweights.js` 一個字未動)。
>
> 寫入的檔案:`public/js/vehicles.js`(新)`public/js/wildlife.js`(新)・
> `public/js/biomes.js`・`public/js/siteplan.js`・`public/js/hazards.js`・
> `tools/audit_vehicle_spec.mjs`(新)`tools/audit_wildlife.mjs`(新)・
> `tools/audit_object_joints.mjs`・`tools/audit_siteplan.mjs`・`tools/audit_soft_stroke.mjs`
> (後三支**只有 `new Function` 樁件注入**,一條斷言都沒動 —— 見第 ④ 段更正 1)。
> `public/js/ground.js`・`public/js/edgewall.js`・`public/js/beacons.js` **一個字未動**
> (理由見更正 2 / 3 / 4)。

> **封存註記（2026-08-19）**：本檔的「待裁決」段落保留歷史上下文，不再代表現況。
> 鳥群已接受 JS 積分器方案；正式紀錄見 `docs/anime_style_plan.md` 第十七輪，執行真品為
> `public/js/wildlife.js`。

---

## ① `.claude/rules/seams-world.md` §2.1 G 要新增的一列(原文)

| 領域 | 唯一縫 | 鐵律 / 稽核 |
|---|---|---|
| 載具 / 擺件型錄 | `vehicles.js`(`VEHICLE`/`VEHICLE_SPEC`/`vehicleKinds()`/`makeVehicle()`/`placeParts()`/`partAABB()`/`partsAABB()`/`vehicleBox()`/`vehicleFit()`/`RECESS`/`makeRecess()`/`recessMinZ()`/`standEyeM()`/`vehicleSight()`/`sightDepth()`/`sightOk()`)+ 建構出口 `biomes.vehGroup()`(THREE 那一側恰一份);消費端 `siteplan.CIVIC_PARTS.lot`(配 `LOT_STALL`)・`hazards.BUILDERS.wreck`・`biomes.car()`・`biomes.makeTrain()` | 2026-08-16 序 10。病灶是**同一台車有四份互不相同的手寫副本**(`hazards.wreck` 唯一有輪子那一份 / `biomes.car` / `siteplan.CIVIC_PARTS.lot` 唯一登記碰撞柱那一份 / `ground.DETAIL_DEFS.carwreck`,尺寸 1.71~4.8m 差 2.8×,其中三份**連輪子都沒有**);「貨櫃」四份、「列車」兩份。收斂的形狀**逐條照抄 `edgewall.js`**(零 import 型錄 + 生成器 + 純幾何量尺),不另發明。六條:①**零 import、零 THREE**(連 `rng.js` 都不 import —— `makeVehicle` 是**純函式**,同款不同台的差異一律由呼叫端傳進來)⇒ 「這一台車收不收得進宿主宣告的盒子」離線量得到,而那正是會靜默壞掉的一半(車輪半埋 / 車體頂出停車格 / 鏡子穿出碰撞盒);②**宿主宣告盒子,型錄宣告形狀**(`makeVehicle(kind, { fit })` 與 `wallParts(kind, { len, depth, h })` 同一條紀律)—— 停車格 `LOT_STALL` 是**一個數兩個消費端**(白線節距 + 車的 fit),兩邊各寫一份的症狀是「車比格子大一圈 / 車尾露在通道上」而碰撞柱由車身實算 ⇒ 白線與碰撞盒安靜地對不上;③**輪拱 / 保險桿 / 燈 / 車牌 / 腰線 / 後照鏡一律由 SPEC 的十一個數推導**,MUST NOT 逐款手寫(手寫值脫鉤之後改一次 `R` 就是「輪子浮在輪拱外面」而每一條既有斷言全綠);④**鼻頭在 +x**(原點在足跡中心的**地面**)⇒ `ry` 就是車頭朝向,反過來寫 = 一整排停車場的車全部倒著停;判據 MUST 是**推導出來的硬體**(前照燈 / 傾角較大的斜切),**MUST NOT 拿體積比猜** —— 轎車車艙偏後、貨車車艙在最前,體積那一半兩款剛好相反;⑤**剛體擺放的 Euler 合成 MUST 走矩陣**(`_rotMul`),MUST NOT 寫 `ry0 + ry`:那只在 `rx0 === 0` 時等價,而輪子躺平帶著 `rx = π/2` ⇒ 相加會讓輪軸**不隨車頭轉**(45° 時車身斜著、輪子還朝正前方),零斷言看得見(A26/A27 的「差正負號 / 差 90°」);⑥**碰撞柱是一疊不是一顆**(車身 + 車艙各登記;同 A46 ①)—— 只登記車身就是車頂那一截撞不到的空氣。**輪心 y === R 是構造保證**(`audit_object_joints` 的容許縫 0.05m 埋 3cm 照樣綠)。稽核 `audit_vehicle_spec` ±`--break-spec`/`--break-dup`/`--break-face`/`--break-recess`/`--break-sight`/`--break-batch`/`--break-detr` |
| 真凹處 / 可視角(③-2 / ③-3) | 同檔 `RECESS`/`makeRecess()`/`recessMinZ()`;可視角 `standEyeM(heights, eyeF)`(**注入不寫死**)/`vehicleSight(H,D)`/`sightDepth()`/`sightOk()` | **深度往外堆,不往內挖**:`makeRecess` 回傳的是**加法**零件(背板 + 楣樑 + 檻 + 兩側側返),量體本身一格不動 ⇒ 任何一片零件的最小 z 恆 ≥ 量體前緣。往內挖的症狀是「面板整片消失」(寫在實心面後面),**不報錯**。凹深有下限 `RECESS.MIN_D`(再淺就只是一條陰影線,而它照樣要付一顆 draw call)。可視角是幾何不是感覺:站在自己碰撞半徑外緣、眼高 `eye` 時看得進去的深度 = `H·standR/(eye − H)`(眼高 ≤ 開口高 ⇒ 整條看得穿)。⚠ **`standEyeM` 刻意 MUST NOT 轉呼 `data.js curveEyeM()`**:那一支寫 `heroTargetH(ch, lv)` 而簽章是 `heroTargetH(kind, ch)` ⇒ 每一輪都走 `SOLDIER_H × 4`(實測 4.0824m,正解 0.76545m,差 5.33×),而 `audit_world_curve.mjs:89` **抄了同一份錯誤呼叫**所以那道閘從來沒量到任何東西(刀與尺寫成同一份)。修它 = 13 張定場照全變 ⇒ 另一輪的事(見 ⑤-2)|

### ①-b `seams-world.md` §2.1 G 要新增的第二列(鳥群)

| 領域 | 唯一縫 | 鐵律 / 稽核 |
|---|---|---|
| 鳥群(野生動物) | 規則 `wildlife.js`(`FLOCK`/`FPS_REF`/`springPS()`/`flockSeed()`/`curveAt()`/`planFlockRoutes()`/`flockInit()`/`flockStep()`/`flockSnap()`/`flockHeading()`/`wingAngle()`/`birdParts()`)+ 接線 `biomes.js` 的 `shoreRing()`/`buildFlocks()`/`BIRDS_OFF`;旋鈕 `birds`(拉桿 0~1.5,**def 0**)+ killswitch `?birds=0` | 2026-08-16 序 11 ⑥-2。計畫列的**六項一項不刪**(曲線 + 逐軸不同時標的噪聲 + 弱彈簧 0.0003 + 摩擦 + 分群 + `uSnap`),只把積分器從 GPGPU 換成零 THREE 的 JS 模組(**對計畫字面的偏離,見 ⑤-1**)。八條:①**零 THREE**(本檔只算「第 i 隻鳥這一幀在哪裡」)⇒ 六項離線**行為直測**得到 —— 寫在 GLSL 裡的話 `--break-spring`/`--break-friction` 全部退化成 ㋓ 真瀏覽器,而原則 9 要的正是那幾支;②**零共享 `rnd()` 消耗**(座標雜湊 `flockSeed` 餵自己的 `mulberry32`;錨點是**讀**既有結果不是重算)—— 抽一枚就把後面每一株植被、每一棟建物的佈局整條推移,而畫面上只表現成「整張圖變了」;③**摩擦走 `data.js frictionFPS`**(§2.1 F 幀率無關阻尼的唯一縫),彈簧的每秒係數由「每 60fps **幀**」那個數**推導**(`springPS = SPRING × FPS_REF²`)—— ⚠ 換算是 **×fps² 不是 ×fps**:GPGPU 那一份寫的是 `v += (T−p)·S` 配 `p += v`,兩處都是「每幀」;寫成 ×60 的話 ω 掉到 0.13 rad/s、對 12 m/s 的目標穩態落後 **667m** = 「鳥群跟曲線完全沒有關係」,而每一條離散度斷言照樣綠;④**弱彈簧的判據是「追不追得緊」不是「離曲線多遠」**(強彈簧讓鳥貼著 `曲線 + 噪聲` 走,離**曲線**的距離反而變**大** = 噪聲振幅 ⇒ 拿那個當判據兩邊都綠;實測 弱 9.7m / 強 ×167 1.8m);⑤**逐軸噪聲的判據是過零率不是相關係數**(同時標但不同相位的兩條 sin 相關係數是 cos(Δφ),什麼值都可能);⑥**錨不到就不放**(原則 6):順位 水域岸線 > 神木林 > 地標,**MUST NOT 拿兵線 / 塔位 / 主堡當錨**(那是戰術資訊,鳥繞著前線飛就是把它畫出來),三類都錨不到就回空陣列,**MUST NOT 退回「戰場中央一條圓環」**;⑦**時鐘吃 `celWindTime()`**(雲 / 植被同一支;自己累加 dt 的話暫停一次就與地面錯開,而 `stepCelWind` 已內建背景分頁的 dt 夾制);⑧**接線只准推既有的 `dynamics` 桶**(`group.userData.update` → `terrain.biomesUpdate` → game.js),MUST NOT 在 game.js 另開第二條更新迴圈。三個沒有錯誤訊息的壞法:`frustumCulled` 留 true ⇒ 某些鏡頭角度整批消失又出現;忘了 `instanceMatrix.needsUpdate` ⇒ 凍結在出生位置而**每一支稽核全綠**;給 `castShadow` ⇒ 開第三個投影旗標的縫(§2.1 F 時間流逝 ⑧;`audit_daynight` 只掃 game.js / ground.js ⇒ 寫在 biomes.js **不會紅**,症狀是地上憑空多一片飄動的黑影)。**剪影下限**:鳥在動漫背景裡是剪影 ⇒ `birdParts()` MUST 有「翹起的尾」與「離開頭部輪廓的喙」,水平跨距 ≥ 0.3m。稽核 `audit_wildlife` ±`--break-spring`/`--break-noise`/`--break-friction`/`--break-group`/`--break-rnd`/`--break-anchor`/`--break-snap` |

### ①-c `seams-world.md` 「都市計畫」那一列的紀律④ 補一句

> `CIVIC_PARTS` 的四個語意通道(`col`/`vc`/`opt`/`sf`)在載具改吃型錄之後 MUST 由
> `makeVehicle(kind, { col, vc, opt, sf })` **原樣帶出來**:`col` 決定進不進 `blockers`
> (缺了 = 走得進去的實心車)、`vc` 決定色相變異通道(車體與車頂 MUST 同通道才一起轉色)、
> `opt` 是非碰撞小件的存缺通道(**`col` 件恆保留**)、`sf` 進分桶鍵。

### ①-d `seams-render.md` 「表現層資源生命週期」那一列補一句(③-4)

> **公設的顏色自 2026-08-16 起走頂點色**:`buildCivic` 的**分桶鍵一格未動**(它決定材質旗標
> 與擺動 span 的分母),換掉的只有「一個顏色 = 一顆 mesh」那一半 —— 同一組(自發光 × 軟性)
> 的桶併成一顆,顏色改走 `mergeGeos(geos, cols)`。實測 lot 25 → 2、park 12 → 4、pitch 7 → 3
> (`CIVIC.MAX = 9` 座 ⇒ 上界 132 → 27)。**自發光刻意不併**(emissive 是逐材質的 uniform,
> 併起來就是全場的燈同一個顏色)。⚠ 頂點色通道與 `bakeContactAO` 自此**第一次同時出現**
> ⇒ 那一支 MUST 是**乘**不是覆寫(窗 1 的 S9 已落地);覆寫的症狀是「整組沒有接地陰影」
> 或「整組變灰白」,兩種都不報錯而 `audit_gpu_lifecycle` 照樣全綠(它量的是 dispose 不是顏色)。

---

## ② `.claude/rules/verification.md`

### §5.1(續)離線稽核清單要新增的兩行

```bash
node tools/audit_vehicle_spec.mjs     # 載具/擺件型錄(宣告盒 ⊇ 實測外廓且不虛胖 / 輪心 = R / 鼻頭在 +x
                                      #  / 零 import 零亂數 / 消費端零第二份實作 / 停車場碰撞盒四角凍結
                                      #  / detailR 哨兵 / 公設分桶數 / 凹處往外堆 / 可視角 / 兩份 AABB 交叉比對)
#   ±--break-spec(輪拱保險桿改回手寫)/--break-dup(停車場繞過型錄)/--break-face(鼻頭改 −x)
#   ±--break-recess(凹處往內挖)/--break-sight(可視角門檻拿掉)
#   ±--break-batch(公設顏色回到材質)/--break-detr(DETAIL_DEFS.carwreck 放大)
node tools/audit_wildlife.mjs         # 鳥群(四項積分器行為直測 / 分群 / 零共享 rnd / 錨不到就不放
                                      #  / 剪影下限 / 幀率無關 / biomes 接線)
#   ±--break-spring / --break-noise / --break-friction / --break-group
#   ±--break-rnd / --break-anchor / --break-snap
```

### §5.5 對照表 —— 新增兩列

| 改動 | 驗證 |
|---|---|
| **載具 / 擺件型錄**(`public/js/vehicles.js` 全檔 / `siteplan.js` 的 `LOT_STALL`·`LOT_PAINT`·`CIVIC_PARTS.lot`·`buildCivic` 的分組合併 / `hazards.js BUILDERS.wreck` / `biomes.js` 的 `vehGroup`·`car()`·`makeTrain()`) | `audit_vehicle_spec` ±**七支** `--break`(每一支 MUST 對應紅字)+ **`audit_siteplan` / `audit_object_joints --seeds 8` 的差異 MUST 只有「碰撞柱根數」與「接合數」兩處**(車有輪子了 ⇒ 零件變多是**預期**;`異常 0 項` 與 `265 項` MUST 不動)+ **`audit_beacons` / `audit_ground_tile` / `ground_seam` / `ground_enclave` / `ground_qc` / `ground_border` / `audit_world_edge` **逐位元不變**** —— 這七支是「零共享 `rnd()` 消耗」的證明面,而**判準是「逐項不變」不是「仍全綠」**(它們驗規則不驗位置)+ `audit_soft_stroke` / `audit_cel_pipeline` / `audit_visual_prefs` / `audit_gpu_lifecycle` / `audit_leaf_card` / `audit_rock_ink` / `audit_water_edge` / `audit_ambient_motion` / `audit_world_height` / `audit_world_curve` / `audit_climb` / `audit_layer_block` / `audit_npc_collide` / `audit_slope_move` / `audit_daynight` 全綠 + `audit_client_syntax`(㋖;名冊多一支 `vehicles.js`)+ `npm run audit:net` / `audit_solo_boot`(新增客戶端模組:URL 佈局鏡射 + `data.js` 單一模組實例)+ **`npm run bal` / `npm test` MUST 逐項不動**(`data.js` / `sim.js` / `server/**` 一行未改)+ **㋓ `shot_scene --venue shibuya --dof=0 --curve=0`**(「這一台車看起來像不像車」離線一條斷言都量不到)+ **㋕ 真機**:貼著停車場走一圈(九台車的碰撞盒仍貼合、車輪真的觸地)、開一場看封路車禍、看一次行駛列車。⚠ 改 `LOT_STALL` MUST 回頭看 `audit_vehicle_spec` Ⅵ(碰撞盒四角是**凍結常數**);改 `VEHICLE_SPEC.sedan` 的 `waist` MUST 回頭看 `audit_siteplan` 的「掛碰撞的一律有量體」(車身頂 < 1.0m 會被判成隱形絆腳石) |
| **鳥群(⑥-2)**(`public/js/wildlife.js` 全檔 / `biomes.js` 的 `BIRDS_OFF`·`shoreRing`·`buildFlocks` 與其呼叫點) | `audit_wildlife` ±**七支** `--break`(每一支 MUST 對應紅字)+ **`audit_siteplan` / `audit_beacons` / `audit_object_joints --seeds 8` / `audit_ground_tile` / `ground_qc` 逐項不動**(⑥-2 是**純新增**且零共享 rnd ⇒ 這五支是唯一的證明面)+ `audit_damp_fps`(摩擦吃 `frictionFPS`;⚠ 那一支的掃描名冊目前只有 `data.js`/`game.js`/`locomotion.js`/`animweights.js`,**`wildlife.js` 要不要進名冊由 lane-motion 決定** —— 見 ④ 更正 5)+ `audit_cel_pipeline`(鳥群走既有 `envMat` ⇒ Ⅵ 的自寫 ShaderMaterial 計數 MUST **不變**;變了就是有人自己寫了材質)+ `audit_daynight`(**不投影**;那一支掃不到 biomes.js ⇒ 這一條只有 `audit_wildlife` Ⅷ 在守)+ `audit_gpu_lifecycle` / `audit_world_height`(高度夾在 `objHeightMax()`)/ `audit_world_edge`(水平夾在 `edgeWallInsetM()`)+ `audit_client_syntax`(㋖)+ `npm run audit:net` / `audit_solo_boot`(新增客戶端模組)+ **`npm run bal` / `npm test` MUST 逐項不動** + **㋓ `shot_scene --venue <有水域的場地> --pref birds=1`**(「像不像鳥」「有沒有真的在飛」離線一條都驗不到;`instanceMatrix.needsUpdate` 忘了會凍結而**每一支稽核全綠**)+ **㋕ 真機看一次**(牠們有沒有繞著水岸飛、拍翼有沒有整群同步)。⚠ 改 `FLOCK.SPRING` / `FRICTION_K` / `SPEED` MUST 回頭看 `TRACK_MIN` / `V_MAX` 兩個門檻(它們是**實測**出來的判準,不是旋鈕)|

---

## ③ 根 `CLAUDE.md` §2.1 目錄要加的主題名

`seams-world.md`(§2.1 G)那一列的主題清單追加三個:

> …・**載具 / 擺件型錄**・**真凹處與可視角**・**鳥群(野生動物)**・角色機體檔案格式

---

## ④ `docs/anime_style_plan.md` 執行紀錄 + 對計畫 / 規格的更正

### 執行紀錄

> **2026-08-16 第二輪 · lane-world 第三階段(載具 SPEC + 鳥群)**|序 10 的 10a(收斂形狀、包絡凍結)+ ③-2 真凹處 + ③-3 可視角 + ③-4 公設 draw call,以及序 11 的 ⑥-2 鳥群落地。縫:新增 `public/js/vehicles.js`(零 import 零 THREE 的載具型錄 + 生成器 + 三支量尺 + `RECESS` + 可視角)與 `public/js/wildlife.js`(零 THREE 的鳥群積分器),消費端接上 `siteplan.CIVIC_PARTS.lot`(配新的 `LOT_STALL` 單一縫)/ `hazards.BUILDERS.wreck` / `biomes.car()` / `biomes.makeTrain()`,`biomes` 新增 `vehGroup`(THREE 那一側的唯一建構出口)、`shoreRing`、`buildFlocks`。新稽核兩支(`audit_vehicle_spec` **79 項** / `audit_wildlife` **44 項**,十四支反向驗證逐支咬得住)。**證明面**:`npm run bal` 🎉 全綠、`npm test` **624 ✅ 全部通過**(隔離埠 8697,與窗 1 基準同數);`audit_beacons`(68)/`ground_tile`/`ground_seam`/`ground_enclave`/`ground_qc`/`ground_border`/`world_edge`(156)共 **7 支輸出逐位元相同** = 零共享 `rnd()` 消耗成立;`audit_siteplan` 265 ✅(差異只有碰撞柱根數 12 → 21 = 車艙那一疊)、`audit_object_joints --seeds 8` **異常 0 項**(接合數 21611 → 22637 = 車有輪子了);`cel_pipeline`(162)/`soft_stroke`(190)/`visual_prefs`(213)/`gpu_lifecycle`(58)/`leaf_card`(43)/`rock_ink`(30)/`water_edge`(64)/`ambient_motion`(63)/`world_height`(49)/`world_curve`(62)/`daynight`(69)/`climb`(211)/`layer_block`(61)/`npc_collide`(44)/`slope_move`(78)/`damp_fps`(25)/`client_syntax`(226)/`solo_boot` 全綠。**實測數字**:五款型錄逐款三軸填充率 96.4~100%(宣告不虛胖也不頂出);停車場九顆碰撞盒的世界四角點與改制前**逐點相同**(最大偏差 2.22e−16 m);公設 draw call lot 25 → 2 / park 12 → 4 / pitch 7 → 3;`detailR('carwreck')` 1.085414667305 與 `detailR('container')` 1.625 逐位元凍結;鳥群 弱彈簧追蹤 RMS 9.68m / 強彈簧 1.78m、三軸噪聲過零率 40 / 79 / 20、|v| 峰值 18.0(無摩擦 33.3)、分群弧長跨度 44.8%(GROUPS = 1 掉到 10.8%)、30 / 60 / 144fps 跑 60s 終點差 0.138m。**未驗**:㋓ 定場照與真 GPU、㋕ 真機、`npm run audit:net`(本窗硬紀律禁止)。

### 對計畫 / 規格的更正(本道量到的)

1. **三支稽核的 `new Function` 樁件注入是必要的,而且**只有**注入。**
   `tools/audit_object_joints.mjs:577`(hazards `BUILDERS` 沙箱)、`tools/audit_siteplan.mjs:95`
   (siteplan 純區塊沙箱)、`tools/audit_soft_stroke.mjs:311`(`CIVIC_PARTS` 沙箱)各多注入
   `makeVehicle`(soft_stroke 與 siteplan 另加 `makeRecess`)。soft_stroke 那一支還要**一併抽**
   `LOT_STALL` 與 `LOT_PAINT` 的原文(它只抽 `export const CIVIC_PARTS = {…}` 那一塊,
   而停車格與色票是 siteplan 自己的模組級常數)。**一條斷言都沒有改**;漏掉任何一格的症狀是
   整支稽核在 `const CIVIC_PARTS = {…}` 那一行 `ReferenceError`,而錯誤訊息與「接合 / 場址 /
   軟性物質」完全無關 —— 很容易被讀成「稽核壞了」。
   ⚠ `tools/audit_soft_stroke.mjs` 在 `_lane_plan.json` 裡屬 **lane-ink**;本道只做了那一處
   注入(lane-ink 第一階段已結束)。整合時如與 lane-ink 撞車,以「保留注入」為準。

2. **`edgewall.js` 本輪不接,而且不是偷懶 —— 它被一條稽核釘死。**
   `tools/audit_world_edge.mjs:572` 斷言「`edgewall.js` 只 import rng.js」(`match(/^import .*$/gm).length === 1`)。
   `vehicles.js` 本身零 import ⇒ 契約在**語意上**接得起來(規格也是這樣寫的),但那一條斷言
   是**數量**判定,加第二條 import 就當場紅,而 `audit_world_edge.mjs` **不在本道的 ownsFiles**。
   ⇒ 接 edgewall 的那一輪要做的恰好三件事(全部已量好):
   ㋐ `audit_world_edge.mjs:572` 放寬成「只 import `rng.js` + `vehicles.js`(後者零 import)」;
   ㋑ `edgewall.js` 的 `PARTS.train` 車廂改吃 `makeVehicle('railcar', { fit: { L: s*0.9, W: D*0.86, H: 3.3 } })`、
      `PARTS.trucks` 改吃 `truck`、`PARTS.ship` 的貨櫃堆改吃 `container20`;
   ㋒ `edgewall.partBox` 改成 `import { partAABB as partBox } from './vehicles.js'; export { partBox };`
      (同 `hazards.js` 對 `mulberry32` 的 idiom:純轉出不建立本地繫結 ⇒ MUST 是 import + export
      **兩行**)。在那之前兩份 AABB 實作是**知情的暫時狀態**,防線 = `audit_vehicle_spec` Ⅻ
      的逐案例數值交叉比對(實測六個案例最大偏差 0.00e+0)。
   ㋐ 之後 `audit_world_edge` 的 Ⅲ `wallFit` / Ⅶ `wallFaceCover` 是唯一會咬人的兩條
      (加轉向架 / 集電弓最容易頂出盒頂),而 `WALL_KINDS.train/trucks/ship` 的 `depth`/`h`
      **一格都不准動**(10a 的定義)。

3. **`beacons.js KIND_PARTS.depot` 同理不接。**
   `tools/audit_beacons.mjs:39` 把 beacons 的**整段純區塊**丟進 `new Function` 執行
   (`BEACON` → `// ---- 建構(以下才需要 THREE)----`),`KIND_PARTS.depot` 一旦呼叫
   `makeVehicle` 就在那裡 `ReferenceError`,而 `audit_beacons.mjs` 不在本道的 ownsFiles。
   ⇒ 接的時候是**一行注入**(`new Function('makeVehicle', pureSrc)`)+ 把四顆貨櫃改成
   `container20`。已量好的餘裕:`BEACON_KINDS.depot.foot = 6.0` 由**油桶與棧板**決定
   (實測 5.9m),不是由貨櫃決定 ⇒ 6.1 → 6.058(真實 20ft ISO)兩個方向都不會頂到,
   `audit_beacons` 的雙向斷言仍成立。

4. **`ground.js DETAIL_DEFS.carwreck`/`container` 本輪刻意不接,而且那是 10a 的定義本身。**
   規格寫「只換形狀不換外廓」,但那兩列的 `geo` 是 **`THREE.BufferGeometry` 不是描述子**,
   接上型錄要在 `ground.js` 另寫一支「描述子 → THREE」的轉接器(而 `biomes.vehGroup` 已經是
   那一份的唯一出口 ⇒ 第二份實作),再加 `audit_soft_stroke` 的 `DETAIL_DEFS` 沙箱注入。
   換到的是「兩款細節擺件有輪子」,付出的是第二份轉接器 + 一個必須逐位元凍結的哨兵。
   ⇒ **本輪維持凍結**,而 `audit_vehicle_spec` Ⅶ 把 `detailR('carwreck')` 1.085414667305 與
   `detailR('container')` 1.625 硬寫成見證人(`--break-detr` 反向驗證咬得住)。
   ⚠ 這兩款的**真實尺度**問題(1.71m / 2.70m vs 其他副本的 3.5~6.1m)是 **10b**,見 ⑤-3。

5. **`audit_damp_fps.mjs` 的掃描名冊沒有加 `wildlife.js`。**
   規格(seq11 步驟)要求把新模組加進那一支的名冊。`tools/audit_damp_fps.mjs` 屬 **lane-motion**
   ⇒ 本道沒有動它。`audit_wildlife` Ⅰ 已就地釘住同樣的三條(`frictionFPS` 有在用 / 零第二份
   `Math.exp` / 零 `Math.min(1, dt*k)`)⇒ 現況**沒有缺口**,但兩份名冊遲早分家。
   建議整合時由 lane-motion 把 `wildlife.js` 加進第 40 行那一組 `readSrc`。

6. **`makeTrain` 的節距與車長是同一件事的兩個手寫數。**
   舊制車廂 13.4m、節距 14.4m 各寫一次。收斂後型錄給車長、**間隙**(1.0m)留在 `makeTrain`
   ——它是「這一列怎麼編組」不是「一節車廂長什麼樣」。車頭斜鼻同理留在編組那一層。
   ⚠ `railcar` 的鼻頭在 +x 而這一支的列車沿 **+z** 行駛(`trainDriver` 走 `lookAt`)⇒
   整節車廂繞 y 轉 −90°,由 `makeVehicle` 的 `ry` **剛體**處理(A27:MUST NOT 逐零件轉)。

7. **`hazards.wreck` 的 `rnd()` 消耗枚數逐枚不變。**
   舊制掛在車艙上的兩枚(車艙 z 抖動 / 車艙 `rotation.z`)在型錄制下沒有落點(車艙塌陷改由
   `crush` 統一給)⇒ 改記在**整台車的姿態**上(`dive` 俯仰 / `roll` 側傾)。這一支跑的是
   **逐障礙的區域序列**(非共享),但枚數一變就是同一顆種子長出另一批散落物,而
   `audit_object_joints` 的樁件正是照著這個枚數在對。

8. **③-4 的公設那一半改成「分桶鍵不動、合併時併桶」。**
   規格要把分桶鍵由 `${pc}|${e}|${sf}` 收成 `${e}|${sf}`,但 `audit_soft_stroke` ⑧ 有一條
   **逐字釘住那個鍵的字面**的斷言(而那一支屬 lane-ink)。落地改成:分桶鍵**一格未動**
   (它決定材質旗標與擺動 span 的分母),只在**合併那一步**把同一組(自發光 × 軟性)的桶
   併成一顆 mesh、顏色走 `mergeGeos(geos, cols)` 的頂點色。**結果與規格要的數字逐項相同**
   (lot 2 / park 4 / pitch 3),而且不必動別道的斷言。

9. **③-4 的障礙那一半(`hazards.buildHazard` 收尾合併)本輪未做。**
   規格要 `jitterParts → mergeGeos(geos, cols) → bakeContactAO → outlinify`。落地風險已量到
   一條**沒有錯誤訊息**的:`chiselRock` 建構時掛在 `mesh.userData.outlineGeo` 的平滑法線副本
   是 `outlinify`(toon.js:1149)專用的,而 `mergeGeos` 只保 position/normal/color ⇒ 合併之後
   鑿刻岩的描邊外殼會**沿硬邊面裂開**。要做就得同時決定「rock 件排除在合併之外」或「同步併
   一份 outlineGeo」,而那牽動 `hazards` 的描邊路徑(全專案唯一還在用反轉外殼的一族)。
   ⇒ 本輪只落地公設那一半並把實測 draw call 印進稽核;障礙那一半見 ⑤-6。

10. **`SPEED` / `NOISE_AMP` / `ALT_BAND` / `COUNTS` / `WING_*` 是授權值不是量測值**
    (同 `PETAL.SIZE`、`MINI.BUFFER_F`、`INK_REPEAT_M`)。校準面是定裝照(㋓)與真機(㋕),
    兩者沙箱都跑不動。**`TRACK_MIN` / `V_MAX` / `SPREAD_F` / `TS_RATIO` 四個不是旋鈕** ——
    它們是「這四項真的在做事」的判準,實測值寫在 `FLOCK` 的註解裡。

11. **`VEHICLE.FILL_TOL = 0.18`、`RECESS.*`、`VEHICLE` 的十九個推導係數同樣是授權值。**
    現值下五款的三軸填充率 96.4~100%;`railcar` 的 y 軸 96.4% 是「車頂設備留的餘裕」
    (`roof` 3.35 < `H` 3.85),刻意的。

---

## ⑤ 待裁決(MUST 由使用者定案;本輪一律做成旋鈕 + 預設不生效)

1. **⑥-2 的積分器落在 JS 而不是 GPGPU(對計畫字面的偏離)。**
   計畫寫「GPGPU 鳥群」,使用者本輪也明講「衝突時一律以計畫為主」⇒ **請明確放行或否決**。
   本道的理由與量到的成本全文寫在 `public/js/wildlife.js` 檔頭:①WebGL2 在本專案只是**能力
   探測**(`postfx._mrtCap`)⇒ GPGPU 必須配一份 CPU fallback = **兩份實作**;②compute pass
   要在 `postfx.Pipeline` 之外呼叫 `setRenderTarget`,撞上「MUST NOT 在 game.js 另開第二條更新
   迴圈」;③積分器在 GLSL 裡 ⇒ **反向驗證(原則 9)離線做不出來**,本輪那七支 `--break-*`
   全部退化成 ㋓ 真瀏覽器;④A25 多兩張浮點 RT 要 dispose。買到的是零(GPGPU 要 1e4 以上
   才回本,而鳥群量級是數十)。**計畫列的六項一項都沒有刪。**
   若裁決要 GPGPU,還要一併決定:`audit_cel_pipeline` Ⅵ 的 `EXEMPT` 名單要不要為 compute
   材質放寬(那正是它存在要擋的情況)。

2. **`data.js curveEyeM()` 的引數順序缺陷要不要修、什麼時候修。**
   `data.js:1002` 寫 `heroTargetH(ch, lv)` 而簽章是 `heroTargetH(kind, ch)` ⇒ `HERO_SIZE['s01']`
   是 undefined ⇒ 每一輪都走 `return SOLDIER_H * 4`。實測 `curveEyeM() = 4.0824`,正解
   **0.76545**(差 5.33×),連帶 `curveR()` 應為 ~75,300 而現值 14,125 ⇒ 世界曲面的沉降量是
   設計值的 5.33 倍。`tools/audit_world_curve.mjs:89` **抄了同一份錯誤呼叫**,所以那道閘
   從來沒量到任何東西(刀與尺寫成同一份)。修它 = **13 張定場照全變** ⇒ 屬序 12 那一級。
   **本輪 MUST NOT 碰**(③-3 已另立 `standEyeM`);`data.js` 也不在本道的 ownsFiles。

3. **10b:`ground.js DETAIL_DEFS` 的 `carwreck` / `container` 要不要改成真實公稱尺寸。**
   §2.5(真實世界尺度)與 §2.3(確定性)的**正面衝突**:實得世界長 1.71m / 2.70m,與其他
   三份副本差 2.6~2.3×;但改尺寸 ⇒ `detailR` 變 ⇒ `detFree` 的淘汰結果變 ⇒ **全圖散佈序列
   整條推移**(`addDetail` 的所有早退都排在 `orient()` 與 `tx/tz` 兩枚共享 `rnd()` 之前,
   一件被淘汰就少抽 3~4 枚),而畫面上只表現成「這張圖跟上次不一樣」。
   走 (乙) 的話 MUST:先重拍全部定場照當新基準、`rows('container', 4.0, 2.6, …)` 的節距改由
   `detailR` 推導、`audit_vehicle_spec` Ⅶ 的凍結常數換成新值。**本輪按 (甲) 落地。**

4. **③-2 要不要上一般方盒建物(店面凹處)。**
   本輪只落地載具(`extra: ['port']`)與公設(收費亭窗口)兩處。一般建物是**單位
   `BoxGeometry` 的 InstancedMesh**(`biomes.js:9313`),實例縮放就是 `(w,h,d)` ⇒ 任何寫進
   共用幾何的凹處深度都會隨每棟樓的進深伸縮(50m 進深的樓會長出 5m 深的騎樓)。唯一可行是
   **另開一顆貼在臨街面的 InstancedMesh**(scale `(w, storeyH, D)`,每個立面桶 +1 draw call),
   而且 `wallpanel.js` 的窗格對齊要把底層那一帶改吃**素牆帶**(否則窗戶會印在遮陽棚上)。
   代價明確、收益是「店面不再讀成一張貼紙」(現況遮陽棚與櫥窗全部畫在 `facadeTex` 上)。
   ⇒ **本輪不做,可行性說明留在這裡。**

5. **邊界牆 / 地標 / 細節擺件三處的收斂(見更正 2 / 3 / 4)要不要在下一輪一次收完。**
   三處各需要**一行**改到別道擁有的稽核(`audit_world_edge:572` / `audit_beacons:39` /
   `audit_soft_stroke` 的 DETAIL_DEFS 沙箱)。`audit_vehicle_spec` Ⅴ-b 已經把這三筆債
   **印出來當清單**(不判定)⇒ 收完之前它一直看得見。

6. **③-4 的障礙那一半(`hazards.buildHazard` 合併)要不要做、以及描邊路徑留哪一條。**
   見更正 9。`hazards` 是全專案唯一還在用**反轉外殼描邊**的一族(`outlinify`),而世界的線
   自 2026-08-03 起由 postfx 的螢幕空間 pass 蓋全場 ⇒ 兩套並存本身就是待裁決的東西
   (`docs/_pending/lane-world-w2.md` ⑤-8 已為 `chiselRock` 開過同一張票)。
   實測逐款 mesh 數(seed 1..8 中位數):aasite 28 / construction 23 / wreck 19(**收斂後更多**
   —— 車有輪子了)/ landslide 14 / fire 12 …,不透明件各再多一顆外殼 ⇒ 逐個障礙 12~55 個
   draw call,`FIELD.HAZ_PER_LANE = 24` × 最多 3 兵線 ⇒ 上限 72 個障礙。

7. **`birds` 拉桿的預設值。** S10 的契約是 def **0**(= 一條曲線都不建 = 逐位元同舊制)。
   **本項的效果現在要手動把 `birds` 拉起來才看得到**(或 `?birds=1` 那一類的 localStorage
   種值,見 `shot_scene --pref birds=1`)。要不要翻成 0.6~1.0 是美術方向。

8. **鳥群的錨點順位與隻數語意。** 本規格提的是 水域岸線 > 神木林 > 地標,並**排除**兵線 /
   塔位 / 主堡;隻數 shore 9 / grove 5 / landmark 3(對應「2 = 一對 / 3 = 幾隻 / ≥4 = 一群」)。
   選哪幾類、順位怎麼排、每類幾隻是**美術決定**,`FLOCK.COUNTS` 一格就改得完。

9. **岸線錨點取的是「岸線環」不是「岸線 run」。**
   `shoreRing` 的手法是「水域格重心 + 24 方位射線取最後一格水」⇒ 對湖泊 / 海灣是對的,
   對**多個分離水體**只會抓到一個環。串真正的岸線 run 要處理分岔與多水體,而鳥群只需要
   一條可飛的環 —— 多解的複雜度買不到畫面上的差別(原則 6 的降級)。要不要升級是範圍決定。

10. **`makeVehicle` 的 LOD 分級(0 = 車身 + 車艙 / 1 = + 輪子與保險桿 / 2 = 全部)。**
    現況:停車場走 lod 1(九台 × 8 件)、封路車禍 lod 2、車禍殘骸 lod 2、列車 lod 2。
    分級點是**成本**不是美術(公設整組併成 2 個 draw call,但頂點數逐台 ×4)⇒
    要不要全部升到 lod 2 由真機幀時間決定(㋕)。
