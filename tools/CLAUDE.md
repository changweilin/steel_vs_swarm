# tools/ — 離線工具層 (目錄層情境; 全域準則見根 `CLAUDE.md`)

> 本檔規範 `tools/` 目錄結構、離線工具家族地圖與編寫稽核腳本之核心紀律。完整指令清單與驗證矩陣住 `.claude/rules/verification.md`。

## 家族地圖
 
| 家族 | 用途與邊界 |
|---|---|
| `audit_*.mjs` | **離線稽核**: 本專案正確性主防線 (無 runtime logger)。以**執行原文**驗真品，一律不需伺服器/瀏覽器/網路 (少數例外於 verification.md 標記 ㋓) |
| `shot_*.mjs` | 瀏覽器實拍圖錄 (定場照 / 立面 / 招牌 / 隧道 / 變形 / 界線)；需 Playwright (㋓) |
| `bake_venue_*.mjs` | 烘焙表產出 (`venueLanes.js` / `venueGrid.js` / `venueText.js`)。重烤 MUST 分批指定 `ONLY=`，避免單一場地查詢超時導致全表覆蓋 |
| `balance.mjs` / `duel.mjs` / `lanesim.mjs` | `npm run bal` 三大平衡模型 (核心不變式 / 對進戰勝率 / 前線交戰)；分工明確不合併 |
| `ai3d/` | img→3D 資產管線；方法論住 `.claude/skills/photo-to-3d-pipeline/` 等系列技能，規範見 `.claude/rules/seams-world.md` |
| `*_review/`・`humanoid_forge/`・`story_book/` | Dev-only 獨立對照台 (埠 8621 生圖 / 8622 零件 / 8623 故事書 / 8631 機體台)；啟停一律經 `dev_supervisor.mjs` |
| `dev_supervisor.mjs` | **全專案唯一「HTTP 請求 → spawn 行程」路徑**，三道防護閘 (loopback / 參數零信任 / `x-dev-tools` 標頭) 僅住於此 |
| `venue_field.mjs` | Node 端取得「與執行期同形」地形 / 圖資 / 結構清單之**唯一縫**；消費端 MUST 透過它獲取資料，嚴禁各檔重複複製 |
| `audit_src.mjs` | 讀取原始碼與抽取方法區塊之**唯一縫** (`readSrc()` / `grabMethod()`) |
| `../public/js/zonecut.js` | 線工切面 (§0-a) 規則本體 (光柵化 / 4 鄰泛洪 / 小面併鄰 / 決定性分層取樣)；遊戲端與離線工具同吃一份定義，零 import、零亂數、純函式 |

## 寫 / 改稽核的六條紀律

1. **讀原文 MUST 走 `audit_src.mjs`**: 透過 `readSrc()`/`grabMethod()` 正規化換行符號為 `\n`，避免 Windows CRLF 造成逐行剝註解與 `split('\n')` 靜默失效。
2. **`--break-*` 反向驗證為交付必備**: 替換字串一律採用 CRLF 容忍樣式 (`\r?\n`)，**替換無效時 MUST 當場失敗**。
3. **斷言期望值 MUST NOT 隨 `--break-*` 改變**: 避免破壞性測試永遠回傳綠燈。
4. **例外 MUST NOT 吞沒成「跳過」**: 程式本身的 `ReferenceError` 被 catch 成跳過即為假綠燈；取不到外部資料時降級 MUST 標示未驗。
5. **沙箱抽代碼須支援 `await` 並注入具名依賴**: 抽 `biomes` / `terrain` 原文執行的沙箱 MUST 使用 `AsyncFunction`，且被抽程式段落調用的新依賴項 MUST 於沙箱逐一具名注入。
6. **反向驗證 MUST 檢查適用性**: `--break-*` 若挑選到不具備該特徵之測試輸入 (如無結構場地)，MUST 當場中斷並提示，嚴禁在未真正製造壞版時報綠。

## 症狀敘事存放規範

各稽核腳本之**檔頭註解**即為第四層細節層：收錄逐項斷言、幾何公式、邊界條件與壞掉時之症狀敘事。修改判定時請直接閱讀該稽核檔頭，MUST NOT 憑記憶重建，亦 MUST NOT 將細節敘事搬回 `CLAUDE.md` 或 `.claude/rules/`。
