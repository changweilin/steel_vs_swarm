# §6 退場清單(MUST NOT 復辟)

> 本檔 = 根 `CLAUDE.md` §6 全文,2026-08-16 由根檔拆出。
> **看到「這裡好像少了一塊」而想補回去之前,MUST 先開這一支。** 移除本身就是定案(根 §0 原則 10)。


> 這些是**已經移除**的機制。看到「這裡好像少了一塊」而想補回去之前,先讀這一列 —— 移除本身就是定案(原則 10)。

| 退場 | 日期 | 取而代之 |
|---|---|---|
| **舊水域/沼澤異質異常狀態**(`WATER_FREEZE_S` 凍結換彈與冷卻、`SWAMP_DRAIN_S`/`SWAMP_DRAIN_PS` 沼澤扣血、`SWAMP_SLOW_MIN` 移動探底至 1/8、沼澤完全禁止回復) | 2026-08-22 | **同種流體沉浸異常狀態(`fluidFactor`)**:機體完全沉浸在水面下時觸發,五大維度(受到傷害/水下移動/飛行動力回速/電力回充/護盾回復)統一依環境倍率折減(水域 1/2、沼澤 1/4)。 |
| **格點驅動的岸邊泡沫片**(`biomes.js` 的 `shoreFoamTex()` 與 `buildWaterEdges` 的 `fp`/`fnrm`/`fuv`/`fidx` 分支、它的 `dynamics.push`(潮汐呼吸 + 微浮沉 + 貼圖漂移),連同 `buildWaterEdges` 的 `dynamics` 參數) | 2026-08-16 | **`toon.js celFoam()`**(深度場驅動 + `step()` 硬邊 + 相位減 `celSeaH` ⇒ 跟著浪沖上岸),消費端只有 `terrain.bakeSeaDepth` / `stampSeaBlockers`。舊制三件事都是這一輪要否定的:驅動量是**岸線幾何**(`terrainEnvCode` 的 8m 格點,量化成方塊)而不是水深、外觀是 Canvas 徑向漸層的**柔霧**而不是賽璐璐的白色硬邊、而且它是一片固定在 `waterY + 0.1` 的**平板** —— 浪高 ±0.9m 的波峰直接從泡沫片裡穿出去。**兩份 shore band 並存 = 新的硬邊被舊的軟 alpha 糊掉,而每一條既有斷言照樣全綠**(症狀只是「岸邊看起來髒髒的」)。潮間帶(`tp`/`tidx`)**保留**(那是 envCode 2↔0 的另一件事)。連帶移除 `shoreFoamTex()` 的三個 `Math.random()`(只染像素、不進散布路徑 ⇒ 刪掉是嚴格改善,共享 rnd 序列一格未動)。⚠ 因此 **`foam = 0` 不是「回到今天」**(它是「岸邊連浪都沒有」)。MUST NOT 復辟 |
| **四份手寫車 / 四份貨櫃 / 兩份列車**(`hazards.BUILDERS.wreck` 舊的逐零件車、`biomes.car()` 舊實作、`siteplan.CIVIC_PARTS.lot` 舊的停車格車身、`edgewall`/`beacons` 各自那一份貨櫃描述子的**尺寸與零件表**) | 2026-08-16 | **`vehicles.js` 型錄 + `makeVehicle()` 純函式生成器**(建構出口 `biomes.vehGroup()` 恰一份)。舊制同一台車有四份互不相同的副本,**尺寸 1.71~4.8m 差 2.8×,其中三份連輪子都沒有**,而「哪一份是對的」沒有任何斷言看得見。收斂的形狀逐條照抄 `edgewall.js`(零 import 型錄 + 生成器 + 純幾何量尺)。⚠ **三處收斂尚未完成**且各被一條別支的斷言釘住(`audit_world_edge:572` 的 import 數量閘 / `audit_beacons:39` 的純區塊沙箱 / `ground.DETAIL_DEFS` 的 `geo` 是 `BufferGeometry` 不是描述子)—— 那是**知情的暫時狀態**,防線 = `audit_vehicle_spec` Ⅴ-b 的債務清單 + Ⅻ 的兩份 AABB 逐案例數值交叉比對(實測最大偏差 0.00e+0)。MUST NOT 在收斂完成前另寫第五份 |
| **`ent._moveSpd`(第二份速度推導)** | 2026-08-16 | `animweights.animWeights()` 的權重向量(唯一產生點 `locomotion.stepLocomotion` 收尾;自機走 `game._stepSelfWeights`)。舊制那一份是**未阻尼**的、吃 8Hz 插值鋸齒,而且 `* 0.6` 是**逐幀常數 = 幀率相依**(序 2「幀率無關阻尼」那一輪漏掉的一處);它與 `locomotion.L.speed`、`_updateMoveAudio` 自己的 `moveGate` 曲線三份並存,**每一份單看都是對的、沒有任何既有斷言會紅**。同輪一併收掉的還有**第三個離地門檻**(環境音寫死的 3m ⇒ 改吃 `w.air > 0.5`,與換樹的 `MORPH.GROUND_Y` 是同一條線)—— 舊制 2~3m 之間機體已經是飛行型而音床還在踏地。MUST NOT 在餵入端(`game._charSlots` 之類)重新差分位置把它換個名字請回來 |
| **爆炸戰鬥部「飛到射程界原地引爆」**(2026-08-02 定案的下半句「沒碰撞就續飛,超出射程原地爆」)| 2026-08-15 | **引爆 = 碰撞**:出球面只解除武裝(`b.dud`),彈體續飛到碰撞為止;啞彈碰撞不畫爆炸也不回報。原地引爆的球面幾乎總在半空中 ⇒ 那朵爆炸的傷害**結構上恆為零**(實測離地 8.7~130m,爆風 7.1m 外歸零),而畫面上看起來就是「炸在敵人身上卻沒傷害」。MUST NOT 復辟 —— 要讓它有傷害只有兩條路,一是把爆點拉回地面(現制:瞄準點夾進包絡),二是放寬伺服器落點閘門(= 25% 隱形射程,禁令) |
| **座艙手繪 builder 十支** `_buildDroneCockpit`/`_cockAvian`/`_cockFixed`/`_cockRotor`/`_buildMechCockpit`/`_cockProto`/`_cockBeast`/`_cockSkull`/`_cockNeck`/`_buildMorphCockpit`(連同 `SEAT`/`seatOf`、`cockpitSpinZ`、`_cockCanopy` 的 `visual.pod` 六分支與左肩掛件座、逐機掛點錨) | 2026-08-15 | `_cockBody()`:從**這台 forge 真品機體**複製零件(2026-08-15 使用者「駕駛艙畫面基於新版機體更新設計」)。那十支畫的是**舊版建模**的識別剪影,而英雄機體 2026-08-14 起一律由 `forge/` 鍛造 ⇒ 留著就是座艙與機體長得不一樣,而且**沒有任何錯誤訊息**。掛點錨併回 `DEF_ANCHOR` 一張表 |
| **舊版英雄建模七支** `buildRobotMech`/`buildBeastMech`/`buildBipedBeast`/`buildDrone`/`buildFixedWing`/`buildAvianDrone`/`buildMorphMech`(連同 `charPod`/`makePoser`/`clamp01`/`AVIAN`/`BEAST`/`BIPED`/`FIXED`)、`MODEL_MANIFEST` 的三列 hero、`FALLBACK` 的三列 hero | 2026-08-14 | `public/js/forge/` 的逐機零件檔 + 三支鷹架(`makeUnit` 的 `forgeHero()`)。七支整組搬到 `tools/humanoid_forge/legacy/legacy_models.js` **凍結**,只在機體台的「舊版」分頁上台 ⇒ 出貨包不再帶舊建模(`build:solo` 只複製 `public/**`)。MUST NOT 從 `public/js` 底下 import 它 |
| **單樹變形者**(`rig.kind === 'morph'` + `rig.pose(m)` + `rig.tailPose`/`tailAimComp`)在**遊戲本體**的用途 | 2026-08-14 | 兩棵樹 + `locomotion.morphSwap`;`stepMorph` 本身**留著**(機體台的舊版對照仍走它),但 MUST NOT 拿它當新功能的落點。尾砲瞄準改走 `rig.tailAim` + `whipTail` 的 aim 分支 |
| **NPC BOSS「防禦面永不升級」** / **對白掛在「整階被推平」上** / **劇情戰役預置兵線取兩側較小者** | 2026-08-14 | 使用者三句新定案:①防禦面**也**隨 HP 階段升級(狂暴推 `ECON.UPGRADES` 全表;小兵強化那一半仍成立)②對白改由 `siegeTalk`(區域 BOSS 被擊敗)觸發,`siege` 事件只剩戰況播報 ③守方預置補到自己那座前線砲塔(舊制在非對稱地圖上是**兩側都掛零**)。三者 MUST NOT 各自「修」回去 —— 它們是同一輪定案的三面。 |
| 「爆炸傷害納入閃避 = 它整組變弱」| 2026-08-12 | 使用者定案「**維持 DPS 提高傷害,閃避率不動**」:`evadeCompF(p)` 把被閃掉的期望輸出還給沒被閃掉的那幾發 ⇒ `npm run bal` 逐項回到改制前。MUST NOT 改回「調低爆風的閃避率」那條路(使用者明說閃避率不動)|
| 「有爆風 `r` ⇒ 不可閃」(NPC 分支)與「招式不吃閃避」(`ALTITUDE` 註)| 2026-08-11 | `evadable()` 單一縫:輕武器直射 + 一切爆炸傷害全吃閃避,逐目標各自擲。使用者定案「所有攻擊招式也加入閃避機制」 —— 高度差與爆擊仍不吃(**AoE 不爆**是另一條定案,MUST NOT 一起改掉)|
| **bal ③「10 分鐘升滿」不變式**(八軌總價 ≈ 賞金收入 ±10%) | 2026-08-11 | 使用者定案「移除此標準」。八軌改雙閘後升滿時間不再只由錢決定,這個比值量不到原本要量的東西;數字仍印出來當參考,**不判定、不計入 fail**。**編號不重排**(④~⑦ 保留原號) |
| **逐機種擊殺分數表** `KILL_SCORE`/`killScore()` 與**刷 bot 折價** `BOT_KILL_SCORE`(3) | 2026-08-11 | 戰鬥分數 `BATTLE_SCORE`/`battleScoreGain()`(擊殺 4 / 助攻 1,玩家**含電腦玩家**與砲塔 ×5)—— 使用者這一輪明講「玩家(含電腦)」同一個係數,兩份分數表並存就是兩套規則 |
| 八軌階梯常數 `ECON.UPG_BASE`/`UPG_INC`/`UPG_L3`/`UPG_L3_LVL` | 2026-08-11 | `ECON.UPG_STEPS` 逐階表(價格 + 戰鬥分數門檻同一列) |
| 陣營小兵強化的 `hp ×cu` 與**賞金 ×cu** | 2026-08-11 | 強化收斂成「只對非玩家生效」:傷害看目標、耐久看攻擊者(`creepDmgTakenF`)。hp 是全域的 ⇒ 留著它等於對玩家也變硬;賞金加成在小兵不再更難打之後就是白送 |
| **機種絕招**(飽和攻擊 / 集束炸彈 / 極音速飛彈)三個入口 `heroKamikaze`/`heroDecoy`/`heroHyper`、`rooms.js` 三條訊息、客戶端三支 `_launch*`、bots 三個區塊 | 2026-08-06 | 長按右鍵 = 招式手勢(`abilHoldSlot`);三種載具只服務大招遞送(`_launchUltCarrier`/`_launchUltSupport` 恰兩個生成點) |
| **常駐護衛機外觀** `ESCORT`/`escortSlot()`/`escortLagBase()`/`escortLagK()`/`escortDrift()`、`game._buildDroneEscorts`/`_updateEscorts`、`audit_escort_form.mjs`;HUD 的 `kcd` | 2026-08-06 | 「攻擊時再出現」= 把常駐那一段刪掉即可(衝出後的 kami 本來就是伺服器實體、走一般渲染路徑)。那批模型看得見、跟著飛、卻不在 sim = 原則 4 的反面 |
| **重砲模式 / 巨砲** `BARRAGE`/`barrageShots`/`barrageDur`/`LANCE.BARRAGE_F`/`_barragingDmg`;`lanceR` 的第二參數 | 2026-08-01 | 重武器射擊路徑上 MUST NOT 再有任何「免彈夾/免電力/免射速閘」的旁路 |
| **建築加成** `GRENADE.BUILDING_MUL`/`grenadeBuildingMul` | 2026-08-02 | `vs.building ≤ BUILDING_VS_CAP`(=1)的推導夾制迴圈(A34) |
| **榴彈的錐形瞄準輔助** `game._aaTarget()` + `BALLISTIC.AA_CONE` | 2026-08-10 | 準星那一條射線就是全部(`_lobCrosshair`)。使用者定案「拋物線準星沒有瞄敵人時就是打地面」—— 錐形輔助是唯一能把落點從準星底下拉走的路徑,降級成「準星什麼都沒解到才接手」仍不夠(`ent` 為空同時涵蓋「打在地形上」與「指著天空」,而瞄地面正是榴彈的主要用法)。MUST NOT 以任何條件復辟 |
| **爆炸型豁免名冊**的內容(`AREA_WEAPONS` 保留為**空的具名縫**) | 2026-08-04 | 家族帶 `BLAST_BAND`/`blastFamily()`/`blastCapR()`;沒有任何爆炸型武器再享有豁免(A35 ⑧) |
| 逐武器手寫的 `move`/`slowF` 兩欄(開火中位移) | 2026-08-03 | `recoilMoveF()` 曲線(舊表**不單調**,「越大降越多」在它上面根本不成立) |
| 逐階手寫的 `BAR_MAX` / `heroStatCells`(圖鑑五條長條) | 2026-08-04 | 六角圖 `HEX_AXES` + `hexBand()` 推導 |
| **舊 `signage.js`**(第二份圖集 + 第二套逐實例 UV 規則) | 2026-08-03 | `worldtext.js SignSheet` 一張圖集一個 mesh(A37) |
| **自由字串 `lore.proto`** 與 `main.js` 的標籤正規式切割 | 2026-08-04 | 結構化原型層 `protoLayers()`(A40;`protoOf` 是出圖管線的第二個消費端 —— 讀舊欄位會拿到 `undefined` 而**提示詞裡最權威的一段整段消失**) |
| 飛行姿態取景的 `standing` | 2026-08-05 | `FORM_POSE` 的飛行那一組 MUST 明講機體離地在飛 |
| 舊 `KAMI.HP_F`/`DECOY.HP_F`/`DECOY.R`/`DECOY.BOMB_BLAST_R`/`HYPER.BLAST_R`/`hyperBlastR`/`HYPER.BLAST_R_F`/`APEX_F` | 2026-08-02~06 | 一律由砲塔火力反解(`kamiHp`/`hyperHp`/`decoyHp`)+ `specialBlastR()` 切分計價 |
| 極音速飛彈的**終端追擊** `m.chase`(規則與稽核**留著**) | 2026-08-06 起是**死碼** | `_launchUltCarrier` 恆給 `tid: 0`(點遞送不索敵)⇒ `m.chase` 永遠 false。要讓載具追蹤只需給 `tid`;**MUST NOT 自行刪除該定案**,收不收掉是使用者的決定 |
| 「物件最高高度 = **2 倍**砲塔高」 | 2026-08-08 定,2026-08-09 **作廢** | `OBJ_F 4 / CEIL_PEAK_F 4.5 / CEIL_AVG_F 6`(2 倍會讓 `MASS.MIN_H` 55 / `b.h > 55`/`>60`/`>100` 四條門檻**結構性地永遠不成立**,而所有離線閘門照樣全綠) |
| `RANGE_GLOW.TTL_S`/`ARC_PER_FRAME`/`RAY_PER_FRAME`(光暈分幀預算與 TTL 快取) | 2026-08-03 | 逐敵人各跑一次彈道積分的 `_shotVictims` 足跡名冊 |
| 航跡長 `b.dist`(逐彈道分支 `b.seek`/`b.lob`) | 2026-08-02 | 一顆球面管全部(`spent = 彈頭到發射點的距離`) |
| `bots.js` 直接寫 `h.x`/`h.z`;`BOT_TACTIC.` 直讀;本地 `BUY_ORDER` | 2026-08-02~08 | `_move` 唯一寫入點 / `this.tac` 唯一讀取縫 / `botBuyOrder()` |
| 機種分派表(比對 `isDrone`/`isMorph`)| 2026-08-06 | 隨機種絕招一併退場(A22) |
| 巨岩 `g.rotation.y = rnd() * Math.PI * 2` | 2026-08-03 | `cell.ry`(長軸對齊地質走向,A38 ⑦) |

---

