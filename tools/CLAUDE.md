# tools/ — 離線工具層(目錄層情境;全域準則見根 `CLAUDE.md`)

> 本檔只寫「這個目錄長什麼樣 + 寫工具的紀律」。指令清單住 `.claude/rules/verification.md`,改什麼要跑什麼也住那一支。

## 家族地圖(122 項)

| 家族 | 數量 | 用途 |
|---|---|---|
| `audit_*.mjs` | ~80 | **離線稽核**:本專案的正確性主防線(無 runtime logger)。以**執行原文**驗真品,一律不需伺服器/瀏覽器/網路 —— 少數需要的在 verification.md 標 ㋓ |
| `shot_*.mjs` | 12 | 真瀏覽器實拍圖錄(定場照 / 立面 / 招牌 / 隧道 / 變形 / 界線);需 playwright,㋓ |
| `bake_venue_*.mjs` | 3 | 烘焙表產出(`venueLanes.js` / `venueGrid.js` / `venueText.js`)。**重烤 MUST 分批 `ONLY=`**,不帶 ONLY 時任一場地 Overpass 失敗會被整個從表裡刪掉 |
| `balance.mjs` / `duel.mjs` / `lanesim.mjs` | 3 | `npm run bal` 的三個模型(不變式 / 對進戰 / 前線交戰);**分工不合併** |
| `ai3d/` | 一整支管線 | img→3D 資產管線;全文 `docs/ai3d_runbook.md`,方法論住 `.claude/skills/photo-to-3d-pipeline` 等三支 |
| `*_review/`・`humanoid_forge/`・`story_book/` | 4 座 | dev-only 對照台(埠 8621 生圖 / 8622 零件 / 8623 故事書 / 8631 機體台);啟停一律經 `dev_supervisor.mjs` |
| `dev_supervisor.mjs` | 1 | **全專案唯一「HTTP 進來 → spawn 行程」的路徑**,三道閘(loopback / 參數零信任 / `x-dev-tools`)只准住這裡;兩個掛載點 MUST 轉呼它 |
| `venue_field.mjs` | 1 | Node 端取得「與執行期同形」地形的**唯一縫**;消費端 MUST 走它,MUST NOT 各自再抄一份 |
| `audit_src.mjs` | 1 | 讀原文與抽方法區塊的**唯一縫**(見下) |

## 寫 / 改稽核的五條紀律

1. **讀原文 MUST 走 `audit_src.mjs`** 的 `readSrc()`/`grabMethod()`,MUST NOT 自己 `readFileSync` —— 那支把換行正規化成 `\n`;逐行剝註解與 `split('\n')` 在**這個 CRLF 工作區**會靜默失效(LF 全綠、Windows 紅字)。
2. **`--break-*` 反向驗證是交付的一部分**(根 §0 原則 9):含 `\n` 的字面替換在此工作區是無聲 no-op ⇒ 一律用 `\r?\n` 樣式,**替換無效時 MUST 當場失敗**。
3. **斷言的期望值 MUST NOT 隨 `--break-*` 改變** —— 那樣 break 永遠是綠的。
4. **例外 MUST NOT 洗成「跳過」**:程式自己的 `ReferenceError` 被 catch 成跳過 = 假綠(`audit_traverse` 踩過)。取不到外部資料時降級 MUST **標示未驗**。
5. **抽 biomes/terrain 原文執行的沙箱**要吃得下 `await`(建構期讓步已把 `await onProgress?.()` 放進那些區塊):MUST 用 **AsyncFunction**,尾錨 MUST 容忍並切掉 `await`。

## 症狀敘事住這裡,不住 CLAUDE.md

每一支稽核的**檔頭註解**就是根 `CLAUDE.md` 說的第 ④ 層:逐項斷言、幾何公式、邊界案例、**壞掉時長什麼樣**。改判定先開那支讀檔頭,MUST NOT 憑記憶重建,也 MUST NOT 把敘事搬回 `CLAUDE.md` 或 `.claude/rules/`。
