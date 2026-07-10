# CLAUDE.md — 無人戰略:鋼鐵與蜂群 (Steel vs. Swarm)

## 1. 專案本質與架構

瀏覽器 DOTA+FPS:無人機 (SWARM) vs 機甲 (STEEL)。真實世界地圖選址 → OSRM 兵線 → 即時 3D 地形開戰。
技術棧:Node.js + `ws`(唯一 npm 依賴)、vanilla ES-module JS、Three.js 0.160(CDN importmap)。
**本專案無 build step、無 bundler、無框架、無 TypeScript — MUST NOT 引入以上任何一項。**
註解與 UI 字串一律繁體中文。

**心智模型(MUST 內化):伺服器是唯一真相 (server-authoritative)。**
HP/傷害/彈藥/經濟/勝負全部在 `server/sim.js` 結算;客戶端只送輸入與命中回報、渲染快照插值。
任何「客戶端先改狀態再同步」的實作都是架構違規,**MUST NOT** 出現。

| 路徑 | 職責 |
|---|---|
| `server/server.js` | HTTP 靜態檔 + WS 房間/配對 + 8Hz 快照廣播 + bot 管理 |
| `server/sim.js` | `BattleSim` — 權威模擬核心 (single source of truth) |
| `server/bots.js` | `BotBrain` 電腦玩家(推線/交戰/撤退狀態機) |
| `public/js/data.js` | 共用常數 UNITS/WEAPONS/ECON/GAME/HAZARDS/**CHARACTERS(24 陣營角色 + 8 傭兵 `side:'MERC'` 雙陣營可選、`kind` 綁機體;×專屬輕重武器/小招/大招×3 階)**/HEROIC/SQUAD/VITALS/PROG — **伺服器直接 import 這支客戶端檔**;所有平衡數值只准住這裡,英雄武器/招式一律經 `heroWeapon()`/`heroAbility()` 解析 |
| `public/js/lore.js` | 角色敘事文本(國籍/年齡/職務/外貌/生平/台詞 + 立繪外觀提示 `art`)— **客戶端專用,伺服器不 import**;`data.js` 只住平衡數值,文字一律住這裡 |
| `public/js/portraits.js` | 程序生成 SVG 頭像/立繪(`avatarURL`/`portraitURL`);`PORTRAIT_MANIFEST` 登記手繪檔即覆蓋,呼叫端不變(同 `MODEL_MANIFEST` 模式) |
| `public/js/cutin.js` | 招式立繪演出(自己大招=全屏、小招=角落小卡、敵方大招=警示條);純 DOM overlay(`#cutinLayer`,z-index 15),**MUST NOT** 拉進 3D 場景 |
| `public/js/` | game.js(FPV/物理/插值)· toon.js(賽璐璐核心)· vfx.js · biomes.js · ground.js(開闊地地被覆蓋層)· terrain.js · mapSelect.js · venues.js · models.js · net.js · main.js · environment.js |
| `reference/` | 上游唯讀副本(mapping_elf、ai_tycoon)— **MUST NOT** 修改,只准參考 |

## 2. 通用開發規則 (RFC-2119)

### 程式碼品質與型別安全
- **MUST NOT** 新增 npm 依賴;新函式庫一律經 CDN importmap,且需先有離線 fallback 才准接。
- 英雄一律以 **pid(連線 id)為鍵** 存於 `heroes` Map;bot 用字串 pid(如 `'b1'`)。**MUST NOT** 改用陣列索引或 socket 物件當鍵。
- 外部 API(OSRM/Overpass/AWS 地形磚/Esri 影像)皆會限流或掛掉:每條 fetch 路徑 **MUST** 保留既有的程序生成 fallback(合成貝茲兵線、程序建物),改 fetch 邏輯時 **MUST NOT** 移除。
- 3D 資產 **SHOULD** 優先用 Quaternius 等 CC0 開源模型(`MODEL_MANIFEST` + 程序生成 fallback 模式);法線貼圖(toon 渲染用不到,動輒 20MB)**MUST** 刪除並重寫 gltf 移除引用。

### 狀態管理與資料流
- 平衡數值(射程/傷害/經濟/波次/角色/招式)**MUST** 只改 `data.js`;**MUST NOT** 在 sim.js/game.js 硬編碼。
- **角色戰鬥系統(2026-07-08 起)**:每玩家 = 1 名角色(房間階段 `pickChar` 選角,不選 = 開戰隨機)= 專屬機體 + 輕武器(左鍵)+ 重武器(右鍵瞄準+左鍵,CD 型,**用 mag:1 + reload=cd 實作**,別再發明第二套 CD)+ 小招 Q + 大招 E。招式升級 = 擊殺數(`h.kn`)+ 金錢(`buy 'ab:light|heavy|skill|ult'`),施放吃電力 MP + CD,全部 `sim.heroCast` 結算。
- **三機小隊(2026-07-09 起)**:蜂群玩家 = `SQUAD.N`(3)架無人機;機甲仍是單機。`sim.squads: pid -> {bodies[], act, lock, ps}`,`sim.heroes: pid -> 目前主視野那架`(**pid 為鍵的規則不變**)。
  - 每架是獨立 ent(自己的 hp/護盾/座標/死亡與重生 CD);經濟/電力/彈藥/招式/增益住在 `sq.ps`,靠 `_bindShared()` 的 getter/setter 掛回每架 ent — 所以 `h.money`/`h.abil`/`h.ammo` 在任何一架上讀寫都是同一份。
  - 迴圈粒度 **MUST** 分清楚:`heroes.values()` = 一隊一次(金錢/電力/招式增益);`_allBodies()` = 每架一次(重生/護盾/伏擊/中繼站/火場/物資)。搞錯 = 收入三倍或增益疊三層。
  - 單機 HP/傷害 = 機甲 ÷ `SQUAD.N` × `SQUAD.BUFF`(1.5,2026-07-10 單機強化 +50%)= `UNITS.drone.hp` / `SQUAD.DMG`。**傷害折算只准住在 `heroWeapon()`**(與 HEROIC 同一個縫),`sim.js`/`game.js` **MUST NOT** 二次乘算。
  - 非主視野的僚機 = 客戶端左上角 PiP 小螢幕(`game.js _renderPips`,scissor + 共用 `pipCam` 重繪同一個 scene);機甲的餌機共用同一套。PiP **MUST** 避開 minimap / kill-feed 這兩塊 DOM。
  - 火力靠 `_echo()`:主視野機命中什麼,射程內存活僚機就打同一個目標(彈藥/射速只在主機扣一次)。三機齊射 ≈ 一台機甲。
  - 自爆(F,2026-07-10 起需鎖定):**必須有準星鎖定的敵方目標**(`heroLock`,`LOCK.TTL` 秒內有效)才會動作 — 主視野機引爆、僚機衝向鎖定目標直到引爆;**沒鎖定 = 完全不動作**(不會原地白白自爆)。高速撞擊引爆走 `detonate` 訊息的 `crash:1` 旗標,不吃鎖定閘門。`_blast` 一律跳過同陣營 → 不會炸到友軍。主視野機陣亡 → `_promote()` 立刻讓位給存活僚機,且**接手那架取消衝刺**(玩家重新掌控)。
  - 僚機移動全在伺服器 `_tickSquads()`:dash > regroup(離主機 > `SQUAD.REGROUP_M`:先切回標準兵線走廊 → 沿線飛到離主機最近的線上點 → 再直接歸隊)> follow(編隊)。客戶端只回報主視野那架的 `pos`。
  - 飛彈追蹤 **MUST** 用 `m.tid`(ent id)而非 `tpid`(pid 只給客戶端判斷「是不是在打我」)—— 一個 pid 底下有三架。
- **傭兵變形機甲(2026-07-09 起)**:傭兵(`side:'MERC'`)一律 `kind:'morph'` 單機,HP/火力與機甲完全相同(`UNITS.morph` 由 `UNITS.robot` spread 而來,**MUST NOT** 拆開手抄數值;傷害不吃 SQUAD 折算)。飛行↔地面變形是客戶端物理(蓄力跳彈射 / 觸地變形,常數住 `MORPH`);伺服器**不需要型態訊息**,一律以回報 `y` 判定:`y ≤ MORPH.GROUND_Y` = 地面型(踩地雷)、`y ≥ GAME.AA_MIN_ALT` = 空中目標(塔 SAM / 防空伏擊)。獸型機甲(`visual.form:'beast'` 四足 / `'biped'` 雙足)與擬態翼/定翼無人機(`'avian'`/`'fixed'`)只是外觀/骨架(models.js + locomotion.js;兩陣營各三型等比例 4/4/4),**不影響 sim 數值**。
- **機甲餌機(2026-07-10 起)**:非無人機英雄(`robot`/`morph`)肩上掛一架 `kind:'decoy'` 子機,F 鍵分離發射(對應無人機的 F 自爆)。狀態住 `sq.decoy`(空中那架)/ `sq.decoyCd`;航向鎖定發射瞬間的 `h.ry`,**玩家不能操舵**。有準星鎖定(`_lockedTarget`)才限轉率追蹤,近炸 `DECOY.BOOM_M` 引爆;否則直飛到 `TTL_S` 自爆。離主機甲 > `LINK_M` = 失聯(`d.lost`):`_visionSources` 不再算它、客戶端收掉 PiP,但機體照飛照炸。HP = 主機甲 `maxHp × DECOY.HP_F`,可被擊落(= 誘餌本體);被擊落 **不** 引爆,只有自爆/近炸才引爆。
  - decoy 是普通 ent(有 side、非 neutral)→ 敵方 `_acquireTarget` 會鎖它(這就是「餌」)。但它 **MUST** 在 sim 主迴圈 `if (e.hero || e.neutral || e.decoy …) continue` 被跳過(沒有 lane / 不開火,位置歸 `_tickDecoys` 管)。
  - 自爆爆風走 `_blast(owner, decoyBlast(), …)` —— 算在主機甲頭上(吃它的火力升級/增益,擊殺記給它)。
- **準星鎖定(2026-07-10 起全機種通用)**:客戶端 `_tickLock` 每 0.25s 回報「射程內 + 準星對準」的敵人;伺服器 `heroLock` 複驗**距離 ×1.25 與迷霧視野**(與 `heroHit` 同一條規則)後廣播 `lock` 事件 → 施放者畫光暈(`vfx.lockGlow`)、目標本人跳 HUD 警告。無人機沿用它當自爆衝刺目標、機甲當餌機追蹤目標。時效住 `LOCK.TTL`。
- **射程恆小於視野(2026-07-10 起)**:玩家武器射程 = `min(基準 × HEROIC.range, rangeCap(kind, slot))`,`rangeCap = sight × (重武器再 × GAME.AIM_SIGHT_MULT) × GAME.RANGE_SIGHT_F`(< 1)。夾住的縫**只在 `heroWeapon()`**,`heroic=false` 的 NPC 基準值不夾。改 `sight` / 角色 `range` **MUST** 重跑 e2e(#INC-104 的 y=250 高空射擊仍要求輕武器英雄射程 ×1.25 > 250)。
- **世界尺度:步兵 = 真人 1.8m(2026-07-10 起)**:`models.js` 的 `SOLDIER_H` 是全遊戲唯一的身高單位,人員/載具/建物一律用**真實世界公稱尺寸**(住宅 7~16m、紅杉 110m),`biomes.js` 的 `OVER.bldH/bldXZ/giant/mega` 因此全歸 1 —— **MUST NOT** 為了「看起來大一點」把它們調回超尺度。`VEG_SCALE` 作用在很小的公稱幾何上,絕對高度本就近真實,**不在此列**。
  - 英雄體型 = `heroTargetH(kind, ch)`:機甲 3~5×、無人機 1~2× 步兵,倍率隨 `mods.armor` 在該機種護甲區間內插(高防禦 = 巨大 = 剪影大 = 好命中,因為命中是客戶端對 mesh raycast)。獸型 `visual.form:'beast'` 再 ×`BEAST_H_F`。**體型只准住這個縫**,`game.js`/`biomes.js` **MUST NOT** 硬編碼機體尺寸。
  - 由它推導的東西:`game.js` 的 `heroCollider()`(英雄碰撞圓柱,走 `ent.heroCol` 而非 `COLLIDER` 表)、自機 `SELF_F`(碰撞半徑/上下緣/**座艙視點高度**)、`models.js` 的 `walkRef`(步幅正比身高,忘了改就原地滑步)。改 `SOLDIER_H` 或倍率,以上全部自動連動。
  - **尺度不動 `sight`/`range`**:座艙的「人類駕駛感」只靠視點高度 + `fov`(機甲 = 人眼視角;無人機是遙控攝影機,保留廣角)。平衡數值與 #INC-104 因此完全不受尺度改制影響。
- **地圖尺寸與兵線來源(2026-07-10 起)**:真實邊長 = `0.3 + 0.1×L` km(L1/L2/L3 = 0.4/0.5/0.6 km),兩堡真實距離 = 邊長 × 0.85 × √2 = 481/601/721m。`GEO_SCALE_VER` = 5。
  - **預設場地的兵線是真實道路**:`public/js/venueLanes.js`(由 `node tools/bake_venue_lanes.mjs` 離線預算)存 Overpass 路網上的最短路徑,**每個頂點都是 OSM 道路節點**,主堡 = 路線兩端節點 ⇒ NPC 引導路線與現實導航路線完全相符。`venueConfig()` 逐 `(venueId, L)` 查表;查無資料的 `(場地, L)` 才退回 `synthLane()` 合成弧(離線最後防線,**MUST NOT** 移除)。現況 21 場地 × L1/L2/L3 = 63 組,59 組真實道路、4 組(yosemite/uluru/atacama/tamsui 的 L3)現實中就只有一兩條路 → synth。
  - 改 `VENUES[].ll` 或 `MAPGEO` 的尺寸/重合率常數 **MUST** 重跑 `tools/bake_venue_lanes.mjs` 重新產生 `venueLanes.js`(Overpass 回應快取在 `tools/.osm_cache/`,已 gitignore)。
  - **重合率的網格是解析度,不是規則**:規則恆為「任兩線重合率 < `MAX_OVERLAP`(0.20)」;判定網格 `overlapCellM(L)` 隨兩堡真實距離等比縮放。下限公式:三條線必然共用「含 A 的格」與「含 B 的格」,每條線約佔 `N = 1.2/OVERLAP_CELL_FRAC` 格 ⇒ **重合率下限 = 2×FRAC/1.2,與地圖大小無關**。FRAC 0.111(照舊制 120m/1082m 等比)→ 下限 0.185,六大城市只有 3 個湊得出三條真實道路兵線;FRAC 0.06 → 下限 0.10,6/6 通過(現值)。**MUST NOT** 改回固定 120m,調大 FRAC 前先看這條下限。
  - 側翼選路 **MUST NOT** 用 OSRM via-point:最快幹道會把側翼吸回中線(重合率爆掉的根因,實測 0.23~1.00)。bake 工具改用「已用邊重罰 + 側移弧線導引」的 Dijkstra。互動式選址流程(`mapSelect`)仍用 OSRM,其側翼失敗時會補合成弧 —— 那條路徑**不保證**全線貼合現實道路。
- **市區密集化**:OSM 座標經 `llToWorld` 放大 `1/REAL_SCALE`(8×)→ 現實相隔 20m 的鄰棟在遊戲世界相隔 160m,街廓被撐成荒野。`biomes.js densifyUrban()` 以每棟 OSM 建物為種子、沿其朝向鋪 `cols×rows` 街廓網格補回連續街區;`areaFree(blocked)` 保證兵線走廊(半寬 17m)/塔位/主堡恆淨空 → **淨空帶就是戰略通道,街廓就是掩體**。補間全走 `mulberry32`(每格消耗固定枚亂數,檢查一律放在抽樣之後)→ 全房間一致,**MUST NOT** 改成「淘汰就跳過抽樣」。
- **擊殺分數**:`by.kn += killScore(kind)`,但**被擊殺者是電腦玩家(`isBotId(t.pid)`)一律 `BOT_KILL_SCORE`(3)** —— 刷 bot 不能速成招式。
- **雙層 HP**:護盾(先扣、不吃護甲、脫戰 `VITALS.OOC_S` 秒後自然回復)→ 裝甲 hp(吃護甲值曲線 `armorMul(armor, pen)` 減免,只能回主堡 / heal 招式回復)。爆擊只在直擊武器(`_rollCrit`),AoE 不爆。
- **英雄 vs NPC 同型武器 = HEROIC 倍率(射程 ×1.2、威力 ×1.5)**,只准在 `heroWeapon()` 套用,**MUST NOT** 在別處二次乘算。
- 彈道學在客戶端(`game.js` bullets:初速 mv + 重力 G,線段 raycast 補內插),伺服器仍以 `heroHit` 射程 ×1.25 驗證 — 防作弊邏輯**不**搬客戶端(不變)。
- `createRoom` **MUST** 附帶合法的預建 `battleConfig`(伺服器驗證兵線數/距離);房間內沒有選圖階段。環境(季節×日夜×天氣)在開房時 `resolveEnv` 定案進 `cfg.env`,全房一致,**MUST NOT** 在客戶端各自重算。
- 客戶端 `wstate` 彈藥只供 HUD,與伺服器小幅漂移是 **by design**(miss 不回報)— **MUST NOT** 「修正」它。
- 迷霧是伺服器端過濾:`snapshotFor(side)` 只濾「單位」,塔/主堡/中立物永遠可見;`snapshot()` 無霧供觀戰者/測試。同一 tick 三份快照共用一份 frame 快取(`_tickN`/`_frameTickN`,events 只能清一次)— 動快照邏輯 **MUST** 維持此共用。

### 效能與安全邊界
- 射擊 raycast **MUST** 只打單位 + `terrain.mesh`;植被純視覺,**MUST NOT** 加進 raycast 目標。
- 跨客戶端場景一致性靠 `mulberry32` 以戰場中心為種子的確定性散布 — 隨機散布 **MUST NOT** 用 `Math.random()`。
- 命中判定在伺服器(`heroHit` 檢 `d3 > range*1.25`),**且會檢視野**:`2026-07-09` 起,射手陣營看不見(迷霧內)的目標,回報命中一律無效(`_visibleTo` + 偵察脈衝旁路;塔/主堡/中立恆可見)。同理 bot 目標鎖定(`_acquire`)也吃迷霧,不再全知作弊。防作弊邏輯仍全部留在伺服器 — **MUST NOT** 把它搬到客戶端。

## 3. 危險模式與歷史陷阱(依事故日期標記)

- `[2026-07-03 #INC-101]` **`npm test` 不會啟動伺服器**,只是連 `ws://localhost:8620` 的 client。改完 `server/*.js` 或 `data.js` 沒重啟伺服器 → 測到舊程式碼還「全綠燈」。曾因此白跑兩輪測試。
- `[2026-07-08 #INC-102]` Windows 上 Node 預設 SO_REUSEADDR,**兩個 server 可同時 LISTEN 8620(不會 EADDRINUSE)**,連線被拆散到不同 process → 事件遺失、`timeout: host`。查 `netstat` 時 **MUST NOT** 用 head 截斷輸出;殺進程要連 npm 父進程一起殺,確認 0 個 LISTENING 後才重啟。
- `[2026-07-03 #INC-103]` **無人機原地復活 bug**:死亡發生在 tick 外的 handler、`respawn.base=0` 時,`dead:true` 從未進過任何快照,客戶端 `_onSelfDeath` 邊緣觸發失效。修法是 `deadTick` 守衛強制跨一個完整 tick — **MUST NOT** 以「優化延遲」為由移除(2026-07-09 起無人機也吃重生 CD,但只要有人把 `respawn.base` 調回 0,這個 bug 就會復活)。
- `[2026-07-03 #INC-104]`(2026-07-08 改制後仍有效)**武器射程與 e2e 耦合**:e2e 多處從 y=250 高空垂直射擊 → **所有角色輕武器 NPC 基準 `range` MUST ≥ 170**(英雄 ×1.2 ×1.25 寬容 > 250;e2e 有自動檢查斷言);塔 SAM `range: 240` 刻意 < 250(高空探測機不被鎖);e2e `fakeBattleConfig` 用 1600m×L(留防空安全邊界)。e2e 傷害斷言全部由 `heroWeapon()`/`armorMul()` 動態推導,測試用角色刻意選 **t01/s02(輕武器 crit:0,傷害確定性)** — 幫這兩角加爆擊會把測試變隨機。改射程/傷害 **MUST** 同步重驗 e2e。
- `[2026-07-03 #INC-105]` 障礙/防空陣地是**中立 ents**(`side:null, neutral:true`):`_acquireTarget`(sim)、`_acquire`(bots)、tick 主迴圈三處都 **MUST** skip neutral,否則 `UNITS[kind]` undefined 直接炸;`inv:true` 表不可摧毀(`_damage` 早退)。
- `[2026-07-08 #INC-106]` toon 三階 ramp `[102,182,255]` 的暗部曾設 88 → 深色機體塌成純黑,**MUST NOT** 調低。`MeshToonMaterial` 沒有 roughness/metalness/flatShading — 一律走 `toon.js` 的 `mat()` 包裝(metalness≥0.5 映射成 celMetal 硬邊高光)。賽璐璐核心只住 `toon.js`(`hazards.js` 僅 re-export 相容)。
- `[2026-07-03 #INC-107]` **openroom 流程坑**:最愛的 `battleConfig` 烤死 teamSize,切人數按鈕而無現選 venue 時 **MUST** 清空 `favCfg` 鎖住開房鈕(否則伺服器 `validateBattleConfig` 拒絕)。地圖流程 **MUST** 先 `mapSel.showConfig` 再設 `favCfg`(showConfig 內部 reset 會觸發 `confirmReady(null)` 清掉它)。
- `[2026-07-02 #INC-108]` Leaflet 地圖銷毀前 **MUST** 先 `map.stop()`,否則 `fitBounds` 動畫中 remove 會炸 `_leaflet_pos`。
- `[2026-07-03 #INC-109]` 直升機 creep **刻意未接入** 塔 SAM/防空伏擊飛彈系統(該系統以 heroes pid 查找,heli 是無 pid 的一般 creep,硬接會動到飛彈追蹤核心)— **MUST NOT** 「補完」這條接線。
- SkinnedMesh 量尺寸 **MUST** 用 `computeBoundingBox()`(骨骼感知)並關閉 `frustumCulled`,否則模型消失/錯位;`outlinify()` 描邊 **MUST** 跳過透明材質與 `userData.noOutline`,植被/建物 InstancedMesh 刻意不描邊。
- FPV 座艙掛在 camera 底下 — camera 本身 **MUST** `scene.add`,忘了會整個座艙不見。

## 4. 核心指令與工作流

```bash
npm start            # server on http://localhost:8620 (--port <n> 可覆寫)
npm test             # node test/e2e.mjs,約 60 項斷言
```
- PowerShell 下 `PORT=x node ...` 這種 env 前綴**無效**,用 `--port` 參數。

**測試標準流程(MUST 逐步執行,見 #INC-101/102):**
1. `netstat -ano | grep :8620` — 檢視**全部** LISTENING 行。
2. `taskkill` 所有監聽者(含 npm 父進程),再確認 0 個 LISTENING。
3. `node server/server.js` 起新伺服器 → `npm test`。

**e2e 結構**:前段直接 import `BattleSim` 做確定性單元測試(`_add` 加的測試假人沒有 `lane`,tick 前 **MUST** 刪掉);後段 WebSocket 端對端。迷霧下 e2e 要「看到」敵方單位 **MUST** 另開 `mode:'spectator'` client 做偵察,動作仍由當事 client 送出。防空伏擊測試把無人機 `hp` 設 99999 停在 `aasite` 正上方防塔擊落。

**瀏覽器冒煙測試**:借用 mapping_elf 的 Playwright
(`file:///C:/Users/user/Documents/app/mapping_elf/node_modules/playwright/index.mjs`);
`window.__SVS` 可存取 app 狀態;`__SVS.net.send({t:'createRoom', battleConfig: <synthetic cfg>})` 可跳過緩慢的 OSRM 掃描。
