# server/ — 權威層 (目錄層情境; 全域準則見根 `CLAUDE.md`)

> 本檔規範 `server/` 目錄四支核心模組之邊界與不可侵犯之硬約束。單一真相縫住 `.claude/rules/seams-*.md`，禁令全文住 `.claude/rules/antipatterns.md`，改動驗證矩陣住 `.claude/rules/verification.md`。

## 四支核心模組邊界 (MUST NOT 互相滲透)

| 檔案 | 職責 | 修改前 MUST 閱讀 |
|---|---|---|
| `server.js` | **傳輸層**: HTTP 靜態檔案服務 + WebSocket + `/healthz` 健康檢查 + 區網單埠雙協定 + `/dev/tools` 開發期路由 (loopback 轉發) | §2.1 H 連線機制 / 區網多路徑；A28 |
| `rooms.js` | `RoomHub`: 房間管理、配對、`battleConfig` 驗證與正規化、8Hz 戰鬥生命週期、路網中繼 | §2.1 H 路網中繼；A43；A47/A48 旗標正規化 |
| `sim.js` | `BattleSim`: **權威模擬核心** (Single Source of Truth，結算 HP/傷害/彈藥/經濟/勝負) | §2.1 A~C 全文；A1/A11/A13/A18/A45 |
| `bots.js` | `BotBrain`: 電腦玩家狀態機 (推線 / 交戰 / 撤退) | §2.1 D 全文；A32/A33；`.claude/rules/seams-bots.md` |

## 四條硬約束

1. **三機制共用同一份程式碼** (雲端 / 區網 / 單機) ⇒ `rooms.js`、`sim.js`、`bots.js` **MUST 保持瀏覽器可執行**: MUST NOT import Node 內建模組，MUST NOT 使用 `process.*`、`Buffer`、`require()` (A28)。`server.js` 是全專案唯一允許使用 Node API 的檔案。
2. **平衡數值一格都不准住伺服器**: 伺服器直接 `import` 客戶端 `public/js/data.js` 作為唯一數值真相 (§1 分層職責)。`sim.js` / `bots.js` 出現任何硬編碼射程/傷害/價格皆屬架構違規。
3. **客戶端為不可信輸入**: 客戶端回報僅准「驗證後靜默丟棄」，MUST NOT 盲信座標、擊發點與命中對象 (§0 原則 1、原則 6；射程球心由伺服器自帶記錄回推)。
4. **狀態鍵規範**: 英雄以連線 ID `pid` 為鍵存於 `heroes` Map (Bot 為 `'b1'` 等字串 pid)，MUST NOT 改用陣列索引或 Socket 物件當鍵；小隊共享狀態經 `_bindShared()` 掛載，區分 `heroes.values()` (一隊一次) 與 `_allBodies()` (每架一次) 迴圈粒度 (§2.2)。

## 驗證標準流程

修改權威層後，**MUST 先依根 §4.2 終止舊伺服器並重啟 `node server/server.js`**，再執行 `npm test` 與 `npm run bal`，並連帶執行相鄰離線稽核（如 `audit_weapon_gate.mjs`、`audit_self_ult.mjs` 等）。
