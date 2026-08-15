# server/ — 權威層(目錄層情境;全域準則見根 `CLAUDE.md`)

> 本檔只寫「動這四支之前一定要知道的事」。縫的全文住 `.claude/rules/seams-*.md`,禁令全文住 `.claude/rules/antipatterns.md`,改完要跑什麼住 `.claude/rules/verification.md`。

## 四支的邊界(MUST NOT 互相滲透)

| 檔案 | 職責 | 動它之前 MUST 讀 |
|---|---|---|
| `server.js` | **傳輸層**:HTTP 靜態檔 + WebSocket + `/healthz` + 區網單埠雙協定 + `/dev/tools` 開發期路由 | §2.1 H 連線機制 / 區網同時多路徑;A28 |
| `rooms.js` | `RoomHub`:房間、配對、`battleConfig` 驗證與正規化、8Hz 戰鬥生命週期、路網中繼 | §2.1 H 路網中繼;A43;A47/A48 的旗標正規化 |
| `sim.js` | `BattleSim`:**權威模擬核心**(single source of truth) | §2.1 A~C 全部;A1/A11/A13/A18/A45 |
| `bots.js` | `BotBrain`:電腦玩家狀態機(推線 / 交戰 / 撤退) | §2.1 D 全部;A32/A33;`docs/bot_design.md` |

## 四條硬約束

1. **三機制共用同一份程式碼**(雲端 / 區網 / 單機)⇒ `rooms.js`/`sim.js`/`bots.js` **MUST 保持瀏覽器可執行**:MUST NOT import Node 內建、MUST NOT用 `process.*`/`Buffer`/`require()`(A28)。`server.js` 是唯一可以用 Node API 的一支。
2. **平衡數值一格都不准住這裡** —— 伺服器直接 `import` 客戶端的 `public/js/data.js`,那是唯一真相(§1 分層職責)。sim/bots 出現任何硬編碼的射程/傷害/價格 = 架構違規。
3. **客戶端是不可信輸入**:回報只准「驗證後靜默丟棄」,MUST NOT 相信座標、擊發點、命中對象(§0 原則 1、原則 6;射程球心走 `_trailPush`/`_shotOrigin` 自己回推)。
4. **狀態鍵**:英雄以 **pid 為鍵**存於 `heroes` Map(bot 用 `'b1'` 這類字串 pid),MUST NOT 改用陣列索引或 socket 物件;`heroes.values()` = 一隊一次、`_allBodies()` = 每架一次,搞錯 = 收入三倍或增益疊三層(§2.2)。

## 改完的最低驗證線

`npm test` **MUST 先照根 §5.2 重啟伺服器**(沒重啟 = 測到舊程式碼還全綠)+ `npm run bal` + 根 §5.4 ㋔ 的相鄰稽核(改 `_damage`/`_gateFire`/`tick` → weapon_gate / lance_hit / shield_counter / fire_rate / bot_tactics / bot_vision / blood_splat / self_ult / ult_carrier)。
