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
| `public/js/data.js` | 共用常數 UNITS/WEAPONS/ECON/GAME/HAZARDS/**CHARACTERS(24 陣營角色 + 4 傭兵 `side:'MERC'` 雙陣營可選、`kind` 綁機體;×專屬輕重武器/小招/大招×3 階)**/HEROIC/VITALS/PROG — **伺服器直接 import 這支客戶端檔**;所有平衡數值只准住這裡,英雄武器/招式一律經 `heroWeapon()`/`heroAbility()` 解析 |
| `public/js/` | game.js(FPV/物理/插值)· toon.js(賽璐璐核心)· vfx.js · biomes.js · terrain.js · mapSelect.js · venues.js · models.js · net.js · main.js · environment.js |
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
- **雙層 HP**:護盾(先扣、不吃護甲、脫戰 `VITALS.OOC_S` 秒後自然回復)→ 裝甲 hp(吃護甲值曲線 `armorMul(armor, pen)` 減免,只能回主堡 / heal 招式回復)。爆擊只在直擊武器(`_rollCrit`),AoE 不爆。
- **英雄 vs NPC 同型武器 = HEROIC 倍率(射程 ×1.2、威力 ×1.5)**,只准在 `heroWeapon()` 套用,**MUST NOT** 在別處二次乘算。
- 彈道學在客戶端(`game.js` bullets:初速 mv + 重力 G,線段 raycast 補內插),伺服器仍以 `heroHit` 射程 ×1.25 驗證 — 防作弊邏輯**不**搬客戶端(不變)。
- `createRoom` **MUST** 附帶合法的預建 `battleConfig`(伺服器驗證兵線數/距離);房間內沒有選圖階段。環境(季節×日夜×天氣)在開房時 `resolveEnv` 定案進 `cfg.env`,全房一致,**MUST NOT** 在客戶端各自重算。
- 客戶端 `wstate` 彈藥只供 HUD,與伺服器小幅漂移是 **by design**(miss 不回報)— **MUST NOT** 「修正」它。
- 迷霧是伺服器端過濾:`snapshotFor(side)` 只濾「單位」,塔/主堡/中立物永遠可見;`snapshot()` 無霧供觀戰者/測試。同一 tick 三份快照共用一份 frame 快取(`_tickN`/`_frameTickN`,events 只能清一次)— 動快照邏輯 **MUST** 維持此共用。

### 效能與安全邊界
- 射擊 raycast **MUST** 只打單位 + `terrain.mesh`;植被純視覺,**MUST NOT** 加進 raycast 目標。
- 跨客戶端場景一致性靠 `mulberry32` 以戰場中心為種子的確定性散布 — 隨機散布 **MUST NOT** 用 `Math.random()`。
- 命中判定在伺服器(`heroHit` 檢 `d3 > range*1.25`),迷霧不影響判定,只影響快照 — **MUST NOT** 把防作弊邏輯搬到客戶端。

## 3. 危險模式與歷史陷阱(依事故日期標記)

- `[2026-07-03 #INC-101]` **`npm test` 不會啟動伺服器**,只是連 `ws://localhost:8620` 的 client。改完 `server/*.js` 或 `data.js` 沒重啟伺服器 → 測到舊程式碼還「全綠燈」。曾因此白跑兩輪測試。
- `[2026-07-08 #INC-102]` Windows 上 Node 預設 SO_REUSEADDR,**兩個 server 可同時 LISTEN 8620(不會 EADDRINUSE)**,連線被拆散到不同 process → 事件遺失、`timeout: host`。查 `netstat` 時 **MUST NOT** 用 head 截斷輸出;殺進程要連 npm 父進程一起殺,確認 0 個 LISTENING 後才重啟。
- `[2026-07-03 #INC-103]` **無人機原地復活 bug**:死亡發生在 tick 外的 handler、`respawn.base=0` 時,`dead:true` 從未進過任何快照,客戶端 `_onSelfDeath` 邊緣觸發失效。修法是 `deadTick` 守衛強制跨一個完整 tick — **MUST NOT** 以「優化延遲」為由移除。
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
