# 無人戰略:鋼鐵與蜂群 (Steel vs. Swarm) — 全域儲存庫準則

> **本檔定位**: 四層情境系統的**第一層 (全域層)**，僅收錄每次改動皆適用之原則、技術棧、單一真相縫目錄、禁令索引、指令與驗證通則。**MUST 保持精簡** (≤ 150~200 行)。
>
> | 層級 | 存放位置 | 觸發閱讀時機 |
> |---|---|---|
> | ① 全域層 | **本檔 (`CLAUDE.md` / `AGENTS.md`)** | 每次對話自動載入 |
> | ② 規則層 | [`.claude/rules/*.md`](.claude/rules/) | 依本檔觸發主題指名開啟 |
> | ③ 模組層 | [`public/js/.claude.md`](public/js/.claude.md)・[`server/CLAUDE.md`](server/CLAUDE.md)・[`tools/CLAUDE.md`](tools/CLAUDE.md) | 修改該目錄檔案時手動開啟 |
> | ④ 細節層 | 各 `tools/audit_*.mjs` **檔頭註解**與斷言 | 修改特定邏輯或驗證判定時開啟 |
>
> 關鍵詞 **MUST / MUST NOT / SHOULD** 依 RFC-2119 解讀。違反 MUST NOT 條目視為架構違規。

---

## 0. 核心原則 (MUST 內化)

1. **伺服器唯一真相**: HP/傷害/彈藥/經濟/勝負全在 `server/sim.js` 結算。客戶端僅負責輸入/命中回報、8Hz 快照插值渲染與表現層彈道。MUST NOT 在客戶端先行修改權威狀態；防作弊（射程 ×1.25、迷霧、LOS、高程）僅住伺服器。
2. **單一真相縫 (Single Seam)**: 跨檔共用邏輯與數值僅准有**一個**結算點，嚴禁重複實作；推導得出的值 MUST NOT 手寫。縫目錄見 §2.1。
3. **兩端同量體**: 碰撞、彈道、命中、LOS 在客戶端與伺服器 MUST 採用同份幾何（同盒/圓柱/垂直帶/半徑），杜絕因量體分家導致之靜默丟包（A18/A30）。
4. **表現層歸表現層**: 純視覺改動（材質/擺件/座艙）MUST NOT 影響權威幾何；演出尺寸 MUST 來自權威值，MUST NOT 為了視覺任意放大。
5. **確定性**: 場景佈局跨端逐位元一致，散布路徑 MUST NOT 使用 `Math.random()`（細則 §2.3）。
6. **降級不例外，寧缺勿錯**: 外部服務異常走 fallback，取樣失敗回 null 略過，伺服器對異常回報驗證後靜默丟棄。
7. **真實世界尺度**: `SOLDIER_H` (1.8m) 為全遊戲唯一身高基準單位，MUST NOT 調整為超尺度。
8. **三機制一架構**: 雲端 / 區網 / 單機共用 `server/rooms.js` 與 `sim.js`，僅切換傳輸層；檔案與 URL 佈局維持鏡射對應（A28）。
9. **稽核為正 + 反向驗證**: 正確性防線依賴離線稽核（`tools/audit_*.mjs`）+ e2e + `npm run bal`。修改判定改完 MUST 執行反向驗證（`--break-*`）確認紅字攔截。
10. **刻意設計 MUST NOT 補完**: 彈藥漂移 (A9)、爆風不吃 LOS (A11)、直升機不接塔 SAM (A15)、貫穿判定為 2D (A18)、AoE 不爆擊等皆為刻意取捨，MUST NOT「修復」。

---

## 1. 系統架構與技術棧

**產品定位**: 瀏覽器 DOTA+FPS — 蜂群同盟 (SWARM) vs 鋼鐵協約 (STEEL)，三機種混編。真本地圖選址 → OSRM/Overpass 取真實道路兵線 → 即時 3D 地形開戰。
**架構模式**: Server-Authoritative Monolith（雲端/區網/單機分頁共用 `RoomHub` 與 `BattleSim`）。

| 項目 | 規則與約束 |
|---|---|
| Runtime | Node.js；唯一允許之 npm 依賴為 `ws`。**MUST NOT** 新增任何 npm 依賴 |
| 前端技術 | Vanilla ES-module JS + Three.js 0.160 (CDN importmap)。新函式庫須具離線 fallback |
| 建置工具 | **無 build step、無 bundler、無框架、無 TypeScript — 嚴禁引入** |
| 語言規範 | 註解與 UI 字串一律使用**繁體中文** |
| 3D 資產 | CC0 開源模型優先 (`MODEL_MANIFEST` + 程序生成 fallback)；法線貼圖刪除並重寫 gltf 移除引用 |

**目錄職責劃分**
- `server/`: `server.js` (傳輸層/靜態/Dev路由)、`rooms.js` (`RoomHub` 生命週期)、`sim.js` (`BattleSim` 權威核心)、`bots.js` (`BotBrain` 狀態機)。
- `public/js/`: `data.js` (平衡數值唯一真相，伺服器直接 import)、`geo3d.js` (幾何積木縫)、`forge/` (機體建模)、渲染/HUD/輸入模組。
- `tools/`: 離線平衡測試 (`balance.mjs`)、路網兵線烘烤、60+ 離線稽核腳本 (`audit_*.mjs`)、開發對照台。
- `test/`: `e2e.mjs` 確定性單元測試與 WebSocket 端對端測試。
- `reference/`: 上游唯讀參考副本，**MUST NOT** 修改。

---

## 2. 單一真相縫目錄索引 (全文見 `.claude/rules/seams-*.md`)

修改對應主題前，**MUST 先閱讀所屬規則檔全文**：

| 規則檔 | 涵蓋主題與單一真相縫 |
|---|---|
| [`seams-balance.md`](.claude/rules/seams-balance.md)<br>**§2.1 A 平衡與角色** | 平衡數值、角色機種、推導值、傷害衰減、陣營對抗對稱化、目標類別剋制、護盾裝甲分軌、三軸預算、攻擊範圍收斂、移速壓縮、波次編制、八軌階梯、戰鬥分數、對進戰模型、前線交戰模型 |
| [`seams-abilities.md`](.claude/rules/seams-abilities.md)<br>**§2.1 B 招式 / 大招 / 載具** | 招式手勢、發射點與槽位 CD 帶、大招載具遞送、自身強化型輔助機隊、純自身型大招補償、三種載具形式 (無人機/變形者/機甲)、飛行動力學 |
| [`seams-weapons.md`](.claude/rules/seams-weapons.md)<br>**§2.1 C 武器判定 / 彈道** | AoE 與彈道分類、「打得到嗎」判定、範圍光暈名冊、閃避範圍、高地壓制、爆風超壓帶、出膛初速與飛行時間、榴彈火控、導引頭機動、射程閘門容差、稜線遮蔽、貫穿演出、機體體積 |
| [`seams-bots.md`](.claude/rules/seams-bots.md)<br>**§2.1 D 電腦玩家 (Bot)** | 操作節奏、視野判定、戰術策略 (選敵/撤退/打帶跑)、定位分類與學習策略、碰撞量體 |
| [`seams-terrain.md`](.claude/rules/seams-terrain.md)<br>**§2.1 E 地形 / 結構 / 通行** | 迷你地圖、砲塔與兵線導航、線工切面 (§0-a)、隧道/地下道剖面、道路塗裝與路基整平、坡度移動、經緯度轉世界公尺 (主方位 θ)、立體結構建置、世界邊界牆與緩衝景觀、可通行性 |
| [`seams-render.md`](.claude/rules/seams-render.md)<br>**§2.1 F 表現層 / 畫面** | 日夜光影、賽璐璐明暗階梯/學派 (toon.js)、後製管線 (postfx.js)、描邊寬度、世界曲面、資訊緩衝與表面群組、雜訊斷筆、斜向轉場 (wipe)、溶入 (dissolve)、軟性物質、波浪倒影、粒子系統、動畫權重向量 |
| [`seams-world.md`](.claude/rules/seams-world.md)<br>**§2.1 G 世界內容** | 都市計畫、載具/擺件型錄、真凹處與可視角、鳥群生態、地貌拼圖與田埂對齊、農牧四季、聚落場、世界文字語料 (vernacular.js)、建物量體剖面、角色機體檔案格式 (codex.js) |
| [`seams-ui-net.md`](.claude/rules/seams-ui-net.md)<br>**§2.1 H HUD / 輸入 / UI / 連線** | 連線機制 (netmode.js)、路網中繼 (osmrelay.js)、區網多路徑、操作方式 (ctrlmode.js)、受擊/異常提示、觸控硬化 (touch-dev)、音效層級 (audio.js)、決定性亂數 (rng.js) |

---

## 3. 絕對反模式 A 表索引 (全文見 `.claude/rules/antipatterns.md`)

| # | 主旨摘要 | # | 主旨摘要 |
|---|---|---|---|
| A1 | 客戶端 MUST NOT 先改權威狀態；防作弊不下放 | A25 | 一次性 3D 物件移除 MUST 釋放 GPU 資源 |
| A2 | MUST NOT 新增 npm 依賴 / build 工具 / TS / 框架 | A28 | 三機制兩條線：瀏覽器可執行 + URL 佈局鏡射 |
| A3 | MUST NOT 修改 `reference/` | A30 | 碰撞 / 彈道 / 伺服器 LOS MUST 同一橫斷面有向盒 |
| A4 | 確定性散布路徑 MUST NOT 用 `Math.random()` | A32 | 電腦玩家 MUST NOT 比真人多看 / 多走 |
| A5 | 重武器 CD 唯一實作 = `mag:1 + reload=cd` | A34 | 建築無加乘；護盾分軌僅單一拆分 |
| A6 | raycast 僅打單位；地形走解析射線，建物走盒/圓柱 | A35 | 攻擊範圍收斂與三軸預算 |
| A7 | 失鎖直飛僅給雷射導引與塔 SAM；射後不理不吃 | A36 | 射速壓縮三欄齊動；連發演出不碰權威狀態 |
| A9 | 客戶端彈藥與伺服器微幅漂移係刻意設計，不修復 | A37 | 文字圖層單一、語料一份、比例推導、純表現層 |
| A11 | 爆風刻意不吃 LOS 與射程 | A39 | 軟性物質：單一旗標管細勾線與飄動，走 alpha 契約 |
| A14 | 賽璐璐暗面具亮度地板，色相偏移亮度中性 (`toon.js`) | A40 | 角色/機體檔案格式單一，原型層由 `visual` 推導 |
| A18 | 貫穿判定為 2D + 垂直帶，MUST NOT 改 3D | A42 | 地圖主方位與道路量化 (θ 於 battleConfig 前凍結) |
| A22 | 招式手勢派發僅住 `_fireHoldAbility()` | A44 | 邊界牆型錄：演出 ⊆ 碰撞盒、內面填滿、單一切分 |

---

## 4. 核心指令與回歸驗證矩陣

### 4.1 常用指令
```bash
npm start            # 啟動伺服器 http://localhost:8620 (--port <n> 覆寫)
npm test             # 執行 node test/e2e.mjs (測前務必重啟伺服器，見 4.2)
npm run bal          # 核心平衡不變式驗證 (7大不變式守門)
npm run lan          # 區網 / Tailscale 對戰模式 (--https)
npm run cloud        # 雲端伺服器節點模式
npm run build:solo   # 打包單機特化版至 dist/ (純檔案複製，無 bundler)
npm run audit:net    # 連線機制與安全路由稽核
npm run codex        # 2D 生圖對照台 (埠 8621, --report 列印配對表)
npm run parts        # 3D 零件對照台 (埠 8622, --report 列印對照表)
npm run story        # 故事書對照台 (埠 8623, --report 列印索引)
```

### 4.2 測試驗證標準流程
1. 檢視埠監聽: `netstat -ano | findstr :8620`。
2. 清理舊行程: `taskkill` 所有佔用行程，確認 0 個 LISTENING。
3. 重啟伺服器並測試: `node server/server.js` → 另開終端跑 `npm test` 與 `npm run bal`。
4. **前端修改必驗**: 修改 `public/js/*.js` 後 **MUST 執行 `node tools/audit_client_syntax.mjs`**。
5. **相鄰稽核連帶執行**: 依 [`.claude/rules/verification.md`](.claude/rules/verification.md) 執行對應子系統稽核與反向驗證。

---

## 附：分層情境地圖

| 層級 | 檔案 | 內容概要 |
|---|---|---|
| **② 規則層** | [`.claude/rules/seams-*.md`](.claude/rules/) | 8 大單一真相縫詳細規範與常數定義 |
| | [`.claude/rules/antipatterns.md`](.claude/rules/antipatterns.md) | A1~A48 絕對反模式全文 |
| | [`.claude/rules/verification.md`](.claude/rules/verification.md) | 離線稽核清單、改動對應驗證矩陣與 AI 退化量測 |
| | [`.claude/rules/retired.md`](.claude/rules/retired.md) | 33 條已退場機制清單 (嚴禁復辟) |
| **③ 模組層** | [`public/js/.claude.md`](public/js/.claude.md) / [`.AGENTS.md`](public/js/.AGENTS.md) | 客戶端 60 支模組職責地圖與模組級地雷 |
| | [`server/CLAUDE.md`](server/CLAUDE.md) / [`server/AGENTS.md`](server/AGENTS.md) | 伺服器傳輸/房間/模擬/AI 邊界與硬約束 |
| | [`tools/CLAUDE.md`](tools/CLAUDE.md) / [`tools/AGENTS.md`](tools/AGENTS.md) | 離線工具家族地圖與寫稽核 6 條紀律 |
| **④ 專題層** | [`docs/characters.md`](docs/characters.md)・[`docs/story.md`](docs/story.md) | 角色檔案、關係網與戰役敘事 |
