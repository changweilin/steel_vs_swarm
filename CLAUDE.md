# 無人戰略:鋼鐵與蜂群 (Steel vs. Swarm) — 全域儲存庫準則

> **本檔定位**:雙層情境系統的**全域層**(長期不變標準)。活躍模組層見 [`public/js/.claude.md`](public/js/.claude.md);逐日事故檔案庫與完整細節見 `CLAUDE.md`(本檔自其蒸餾,基準日 2026-07-18)。
> 關鍵詞 **MUST / MUST NOT / SHOULD** 依 RFC-2119 解讀。違反 MUST NOT 條目 = 架構違規,直接退回。

---

## 1. 系統架構與技術棧

**產品**:瀏覽器 DOTA+FPS — 無人機陣營 (SWARM) vs 機甲陣營 (STEEL)。真實世界地圖選址 → OSRM/Overpass 取真實道路兵線 → 即時 3D 地形開戰。

**架構型態:Server-Authoritative Monolith(權威伺服器單體)**

- **心智模型(MUST 內化)**:伺服器是唯一真相。HP/傷害/彈藥/經濟/勝負全部在 `server/sim.js` 結算;客戶端只做三件事 — 送輸入與命中回報、渲染 8Hz 快照插值、跑表現層彈道/物理。
- **MUST NOT**:任何「客戶端先改狀態再同步」的實作。
- 防作弊驗證(射程 ×1.25 複驗、迷霧 `_visibleTo`、LOS `_losBlocked`、高度夾制)只住伺服器,**MUST NOT** 搬到客戶端。

**技術棧絕對規則**

| 項目 | 規則 |
|---|---|
| Runtime | Node.js;唯一 npm 依賴 = `ws`。**MUST NOT** 新增任何 npm 依賴 |
| 前端 | vanilla ES-module JS + Three.js 0.160(CDN importmap)。新函式庫一律 CDN importmap,且**先有離線 fallback 才准接** |
| 建置 | **無 build step、無 bundler、無框架、無 TypeScript — MUST NOT 引入以上任何一項** |
| 語言 | 註解與 UI 字串一律**繁體中文** |
| 3D 資產 | CC0 開源模型優先(`MODEL_MANIFEST` + 程序生成 fallback 模式);法線貼圖 **MUST** 刪除並重寫 gltf 移除引用 |

**分層職責**

| 路徑 | 職責 |
|---|---|
| `server/server.js` | HTTP 靜態檔 + WS 房間/配對 + 8Hz 快照廣播 + bot 管理 |
| `server/sim.js` | `BattleSim` 權威模擬核心(single source of truth) |
| `server/bots.js` | `BotBrain` 電腦玩家狀態機(推線/交戰/撤退) |
| `public/js/data.js` | 全遊戲平衡數值唯一真相;**伺服器直接 import 這支客戶端檔** |
| `public/js/*.js` | 渲染/FPV/輸入/HUD(檔案地圖見 `public/js/.claude.md`) |
| `tools/` | 離線工具:平衡驗證、兵線烘烤、稽核腳本、LOGO 管線 |
| `test/e2e.mjs` | 前段 `BattleSim` 確定性單元測試 + 後段 WebSocket 端對端,約 60 項斷言 |
| `reference/` | 上游唯讀副本 — **MUST NOT** 修改,只准參考 |

---

## 2. 通用程式標準與慣例

### 2.1 單一真相縫(Single Seam)原則
所有跨檔共用邏輯只准有**一個**結算點;發現第二份實作即是 bug:

- 平衡數值(射程/傷害/經濟/波次/角色/招式)**MUST** 只住 `data.js`;sim.js/game.js **MUST NOT** 硬編碼。
- **推導值 MUST NOT 手寫**:賞金表(戰力公式推導)、`UNITS.drone.hp` 與 `SQUAD.DMG`(由 `SQUAD.BUFF` derive)、`UNITS.bunker.hp`(= 塔一半)、塔位(`solveTowerSites()`,sim 與 biomes 共用)、`MINES.PER_LANE` 與 `AA_SITE.range`(等面積公式)、`TOWER_SEP_F`(= 2 − TOWER_OVERLAP)。
- 英雄武器/招式解析一律經 `heroWeapon()`/`heroAbility()`(HEROIC ×1.2/×1.5、SQUAD 傷害折算、rangeCap 全在這一個縫),**MUST NOT** 在別處二次乘算。
- 傷害衰減公式(`dmgFalloff`/`blastFalloff`/`fanFalloff`)只住 `data.js`,sim 結算與客戶端 HUD 共用。
- 共用視覺入口唯一:`spawnCastFx()`(招式 3D 演出)、`stepCombatFx()`(開火動畫)、`terrain.surfaceAt()`(站立表面)— 戰場與展示台/各呼叫端 **MUST NOT** 各寫一套。

### 2.2 狀態鍵與迴圈粒度
- 英雄以 **pid(連線 id)為鍵**存於 `heroes` Map;bot 用字串 pid(如 `'b1'`)。**MUST NOT** 改用陣列索引或 socket 物件當鍵。
- 三機小隊共享狀態(金錢/電力/彈藥/招式)住 `sq.ps`,經 `_bindShared()` getter 掛回每架 ent。迴圈粒度 **MUST** 分清:`heroes.values()` = 一隊一次;`_allBodies()` = 每架一次。搞錯 = 收入三倍或增益疊三層。

### 2.3 確定性(Determinism)
- 跨客戶端場景一致靠 `mulberry32`(戰場中心為種子);隨機散布 **MUST NOT** 用 `Math.random()`。
- 抽樣紀律:每格消耗**固定枚數**亂數、淘汰檢查一律放在抽樣**之後**;**MUST NOT** 改成「淘汰就跳過抽樣」(佈局序列會跨客戶端分歧)。

### 2.4 外部服務防禦
- OSRM / Overpass / AWS 地形磚 / Esri 影像皆會限流或掛掉:每條 fetch 路徑 **MUST** 保留程序生成 fallback(合成貝茲兵線、程序建物),改 fetch 邏輯時 **MUST NOT** 移除。

### 2.5 世界尺度
- `SOLDIER_H`(真人 1.8m)是全遊戲唯一身高單位;人員/載具/建物一律用真實世界公稱尺寸。英雄體型只准住 `heroTargetH()` 這一個縫。**MUST NOT** 為了「看起來大一點」調回超尺度。
- 改 `REAL_SCALE` **MUST** 同步 +1 `GEO_SCALE_VER` 並重跑 `node tools/bake_venue_lanes.mjs`。

---

## 3. 絕對反模式(DO NOT 清單,含事故編號)

| # | 禁令 |
|---|---|
| A1 | **MUST NOT** 客戶端先改權威狀態;防作弊邏輯 MUST NOT 下放客戶端 |
| A2 | **MUST NOT** 新增 npm 依賴 / build 工具 / TypeScript / 框架 |
| A3 | **MUST NOT** 修改 `reference/` 內任何檔案 |
| A4 | **MUST NOT** 在確定性散布路徑用 `Math.random()` |
| A5 | **MUST NOT** 為重武器另發明第二套 CD 系統 — 唯一實作 = `mag:1 + reload=cd` |
| A6 | 射擊 raycast **MUST** 只打單位 + `terrain.mesh`;建物/神木/巨岩/橋墩走解析圓柱(`_blockerHitT`)。**MUST NOT** 把植被或建物 InstancedMesh 加進 raycast 目標(效能)也 MUST NOT 讓砲火穿越有碰撞障礙 |
| A7 | 飛彈失鎖規則(離開發射源射程 → 直線飛行)伺服器與客戶端共用;**MUST NOT** 無限追蹤 |
| A8 | FOV 全機種一律 68(zoom 35);**MUST NOT** 用 FOV 做陣營/機種差異化 |
| A9 | 客戶端 `wstate` 彈藥與伺服器小幅漂移是 **by design**(miss 不回報);**MUST NOT**「修正」 |
| A10 | 迷霧是伺服器端快照過濾;客戶端 **MUST NOT** 對單位標記二次遮蔽 |
| A11 | 爆風 `_blast` 刻意不吃 LOS 遮蔽(繞射近似);**MUST NOT**「補完」 |
| A12 | `[#INC-103]` 無人機重生的 `deadTick` 跨 tick 守衛 **MUST NOT** 以「優化延遲」為由移除 |
| A13 | `[#INC-105]` 中立 ents(`side:null, neutral:true`):`_acquireTarget`/`_acquire`/tick 主迴圈三處 **MUST** skip neutral,否則 `UNITS[kind]` undefined 直接炸 |
| A14 | `[#INC-106]` toon 三階 ramp 暗部 **MUST NOT** 調低於 102;材質一律走 `toon.js mat()` 包裝(MeshToonMaterial 無 roughness/metalness) |
| A15 | `[#INC-109]` 直升機 creep **刻意未接** 塔 SAM/防空飛彈系統(以 pid 查找,heli 無 pid);**MUST NOT**「補完」這條接線 |
| A16 | SkinnedMesh 量尺寸 **MUST** 用 `computeBoundingBox()` 並關 `frustumCulled`;`outlinify()` MUST 跳過透明材質與 `userData.noOutline` |
| A17 | FPV 座艙掛在 camera 底下 — camera 本身 **MUST** `scene.add`,忘了整個座艙不見 |

---

## 4. 錯誤處理與狀態管理

**失敗策略 = 降級,不例外(no exception-driven flow)**
- 外部 fetch 失敗 → 落到程序生成 fallback,遊戲照開。
- 佈點取樣不到合法位置(野營/空投/地雷)→ **寧缺勿錯**:回傳 null 略過,MUST NOT 放寬約束硬塞。
- 伺服器對客戶端回報一律「驗證後靜默丟棄」:`heroHit` 檢射程 ×1.25 + 迷霧視野 + LOS + 高度;驗不過就無效,不 throw、不回錯誤訊息。

**權威狀態流**
- 快照 8Hz;`snapshotFor(side)` 只過濾「單位」,塔/主堡/中立物恆可見;同 tick 三份快照(雙陣營 + 觀戰)共用一份 frame 快取(`_tickN`),events 只能清一次 — 動快照邏輯 **MUST** 維持此共用。
- 雙層 HP:護盾(先扣、不吃護甲、脫戰後自然回復)→ 裝甲 hp(吃 `armorMul` 減免曲線)。爆擊只在直擊武器,AoE 不爆。
- 擊殺分數:被擊殺者是 bot 一律 `BOT_KILL_SCORE`(3)— 刷 bot 不能速成招式,**MUST NOT** 移除此判定。
- 房間流程:`createRoom` **MUST** 附合法預建 `battleConfig`(伺服器驗證);環境(季節×日夜×天氣)開房時 `resolveEnv` 定案進 `cfg.env` 全房一致,**MUST NOT** 客戶端各自重算。

**可觀測性**
- 本專案無集中 Logger 服務;正確性防線 = 離線稽核工具(`tools/audit_*.mjs`)+ e2e 斷言 + `npm run bal` 平衡不變式(見 §5)。新增系統 **SHOULD** 同步補對應稽核腳本,而非加 runtime log。

---

## 5. 核心指令與回歸驗證矩陣

```bash
npm start            # server on http://localhost:8620(--port <n> 覆寫;PowerShell 的 PORT=x 前綴無效)
npm test             # node test/e2e.mjs,約 60 項斷言(不會自動啟動伺服器!)
npm run bal          # 平衡四不變式:①一波 NPC = 玩家 60% EHP ②前線敵我塔重疊 80% 且不對射
                     #              ③單線 30% 擊殺/40% 助攻 10 分鐘 ≈ 八軌升滿 ④滿級單推同塔位雙塔剩 0~20%
npm run sim          # headless 加速模擬完整 bot 對局(平衡/難度壓測)
```

**測試標準流程(MUST 逐步,#INC-101/102)**:
1. `netstat -ano | grep :8620` — 檢視**全部** LISTENING 行(Windows SO_REUSEADDR 允許兩個 server 同時 LISTEN,連線被拆散)。
2. `taskkill` 所有監聽者(**含 npm 父進程**),確認 0 個 LISTENING。
3. `node server/server.js` 起新伺服器 → `npm test`。`npm test` 只是 WS client,**沒重啟伺服器 = 測到舊程式碼還全綠**。

**改了什麼 → MUST 跑什麼**

| 改動 | 驗證 |
|---|---|
| 任何平衡數值(小兵/角色武器/SQUAD.BUFF/HEROIC/塔/賞金/八軌價格) | `npm run bal` |
| 射程/傷害/`sight`/`RANGE_SIGHT_F` | e2e 重驗(`[#INC-104]` 輕武器 NPC 基準 range MUST ≥170;t01/s02 是確定性指定角 MUST 保持 crit:0;s02 heavy MUST 保持 launcher)+ 重驗「塔 310 > 所有輕武器/NPC」壓制不等式與「所有重武器 > 塔 310」不等式 |
| 骨架/關節/步態 | 全角色 rig 稽核 + `node tools/audit_cast_jump.mjs` |
| 武裝掛點/槍口 | `audit_muzzle.mjs` 範式(32 英雄 + NPC 四陣營) |
| `MAP_EXPAND`/`CLEAR_F`/`LANE_MIN`/塔位 | headless 冒煙:建 `BattleSim` 數 `sim.camps.length`(基準 L1 2/2、L2 4/4、L3 6/6) |
| `VENUES[].ll` / `MAPGEO` 尺寸常數 | `node tools/bake_venue_lanes.mjs` 重烤 `venueLanes.js` |
| `SOLDIER_H`/`HERO_SIZE.mul`/`BRIDGE_RISE`/`TUN.CLEAR` | 重驗「淨空 > 最大機體 4.5m + 0.2 頭頂餘裕」 |
| 塔或機甲任一數值 | 重算 `towerHp = 1.8 × heroEHP × heroDPS / towerDPS` |

**e2e 結構備忘**:前段 import `BattleSim` 直測(`_add` 的測試假人無 `lane`,tick 前 MUST 刪掉);迷霧下要「看到」敵方 MUST 另開 `mode:'spectator'` client 偵察。瀏覽器冒煙借 mapping_elf 的 Playwright,`window.__SVS` 存取 app 狀態。
