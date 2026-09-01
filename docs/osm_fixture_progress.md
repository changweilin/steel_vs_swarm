# 真實 OSM 固定場地驗收交接

> 更新日期：2026-09-01
>
> 本文件只保留尚未完成的工作與重跑所需證據。線上 Overpass 僅用於人工更新 fixture；正式回歸一律使用版本化 raw payload，不以合成資料或外部服務失敗代替驗收。

## 現況判定

進度文件已依當前 worktree 與本輪 Luna Max 並行作業重新對帳。現在可宣稱：

- P0 fixture audit 硬化已完成：`sourceId` 唯一、raw 重排不變、sanitize/fit 冪等、候選守恆、drop ledger 與跨 fixture gaps 聚合均已有硬斷言；三個真實 fixture mutation 均會變紅。
- P3 建築靜態契約已完成：`audit_osm_buildings` 用固定 source ID 驗證 L 型、斜向、中庭、大型不規則、multipolygon、多 outer 與超細長建築，正向 64/64 綠，`--break-real-hole/blocker/roof` 均會變紅。
- `audit_traverse` 已有 production OSM building blocker／roof／hole 接線與對應 mutation，且舊的真實高程快取輸出顯示澀谷 41/41、六本木 61/61 航點可達。但高程 cache 未納入版控，乾淨環境不能重跑這項結論。
- 本輪新增 `terrain-elevation-fixture-v1` 捕獲、SHA-256、bbox/center/team 與 193×193 runtime 同形網格契約；fixture traversal 現在完全離線，缺真實高程 companion 時必定列未驗並退出 1，不再偷查網路或回退平地。
- 本輪新增 runtime 靜態預算證據：澀谷／六本木已量 raw/sanitized/fit bytes、areas/rings/nodes、buildings/blockers/roofs/area objects、capacity drops、建圖時間與 production batch 成長。瀏覽器 WebGL draw calls 仍明確列未驗。

因此仍不能宣稱完成。主要 blocker 已收斂為：三個 5v5 L3 synthetic fallback、版本化真實高程資料缺失、新結構樣本缺失、瀏覽器畫面／draw-call 驗收缺失。

## 現存證據與紅字

| Fixture | 已證明 | 尚未完成／目前紅字 |
|---|---|---|
| `taipei_dense` | raw feature 974、road 444、relay 510KB；舊快取證據航點 8/8 | 5v5 L3 仍是 synthetic fallback；有界 fixture 搜尋找到候選，但會破壞既有 center/bbox 契約，review 已拒絕寫入 |
| `shibuya_dense` | raw feature 2359、road 1849、relay 1468KB；baked route 62/62；舊快取證據航點 41/41 | parser capacity 180；缺版本化高程 companion，當前 traversal 依規列未驗 |
| `london_water` | raw feature 775、road 837、relay 820KB | 5v5 L3 仍是 synthetic fallback；有界正式選線門搜尋無解；舊證據尚有 1 航點未達 |
| `roppongi_underpass` | raw feature 2259、road 1835、relay 1402KB；baked route 46/46；舊快取證據航點 61/61 | parser capacity 191；缺版本化高程 companion，當前 traversal 依規列未驗 |
| `berlin` | raw feature 1195、road 860、relay 949KB；已正式綁 `venue.id=berlin` | 5v5 L3 仍是 synthetic fallback；有界正式選線門搜尋無解；缺版本化高程 companion |
| `berlin_bridge` | raw feature 663、road 576、relay 590KB；18 relations／24 holes | 保留為小 bbox 建築幾何 fixture，不冒充正式場地通行證據 |
| `ntu_campus_small` | raw feature 997、road 418、relay 525KB；分類缺件可列報 | 未綁正式場地，尚無通行與畫面驗收 |
| `taroko_structures` | 無 | mirror 504，未取得 fixture；不得讓單一外部場地永久阻塞整體驗收 |

`building=yes` 是目前主要 unmapped 候選。只有可信父用地時才允許 parent fallback，不得為提高覆蓋率而猜成住宅。`shibuya_dense` 與 `roppongi_underpass` 的 capacity drop 已被列報；完成條件不是「零裁切」，而是裁切順序固定、每筆可追溯且無靜默遺失。

## 未完成計畫

### P0：fixture audit 硬化（已完成）

- 例外路徑、互斥指標、source ID 唯一、重排不變、sanitize/fit 冪等、候選守恆、drop ledger 與跨 fixture gaps 聚合已落地。
- `--break-real-relation`、`--break-real-hole`、`--break-capacity-report` 均命中真實 fixture 並退出 1。
- 目前 `audit_osm_fixtures` 為 201 綠 / 3 紅；三個紅字均是真實未完成的 L3 synthetic fallback，不是 P0 程式錯誤。

### P1：關閉目前已知紅字

1. 澀谷／六本木低淨高段已按 runtime `surfaceAt/ceilingAt` 分成 underpass 與 `deck-only`，不再用放寬淨高門檻消紅；尚需把逐座 source ID/tags 清單從保存輸出整理成可審查名冊。
2. 六本木已有 61/61 舊快取證據；倫敦仍有 1 航點未關閉。兩者均必須待版本化高程 companion 完成後再正式重跑。
3. 5v5 L3 紅字現為台北、倫敦、柏林三處。本輪已新增 raw fixture 離線讀取與有界錨點／終點搜尋；倫敦與柏林無解，台北候選破壞 center/bbox 契約，review 已回退。fixture 模式預設只列診斷，未設 `FIXTURE_WRITE=1` 不會覆寫正式兵線表。
4. 正式 `berlin.json` 已綁 `venue.id=berlin` 並通過 OSM bbox/center/query 契約；通行尚被高程 companion 缺失擋住。`berlin_bridge` 繼續作為小 bbox 建築幾何 fixture。
5. 太魯閣只再做一次有紀錄的 bounded retry；仍失敗就改選可穩定取得、同樣涵蓋隧道／明隧道／水道語意的場地。結構覆蓋是目標，特定 mirror 或地名不是完成條件。

### P2：補齊「結構覆蓋」，不追求任意場地數量

目前樣本偏密集都市。新增最小集合以覆蓋缺少的標註習慣：

- 醫院園區。
- 工業／公用設施。
- 公園＋運動場＋大型停車場。
- 農地＋林地。
- 至少一份可綁場地的中庭／多 outer multipolygon 建築。

每份 fixture 必須保留 raw response、query/schema version、bbox、center、capturedAt、source URL、原始 IDs/tags/members，並通過 P0 的全部斷言。不要為湊數恢復「29 場都抓」的目標。

### P3：真實建築幾何與通行契約（靜態完成，離線 traversal 待高程資料）

1. 已從固定 fixture 鎖定 L 型、斜向、中庭、大型不規則、multipolygon、多 outer、超細長建築的 source IDs。
2. 正式 `buildOsmPolygonBuildings` 受控執行已驗證：
   - OSM outer = 視覺外牆邊界 = authoritative blocker 邊界。
   - roof platform = outer − holes；中庭沒有屋頂或 blocker。
   - 碰撞不得退回外接 AABB／外接圓，附件不得超出 footprint；放不下即省略。
   - runtime invalid/skipped/capacity 均回到同一份 gaps 報告並帶 source ID。
3. fixture traversal 已同時接 OSM building blockers、roof platforms、橋隧、塔／主堡與出生點，並輸出 source ID、catalog kind、polygon index、最近 blocker 與距離。
4. `audit_osm_buildings --break-real-hole/blocker/roof` 已全部攔下壞版。`audit_traverse --break-osm-hole/blocker/roof` 要等同名高程 fixture 存在後才有適用樣本；目前必須 fail-loud，不准報綠。

### P4：瀏覽器畫面與 runtime 預算（靜態預算部分完成）

1. 增加只供 audit/dev 的固定 fixture 注入路徑，讓瀏覽器完整走 relay → runtime generation；不得另寫一套只為截圖的建物生成器。
2. 對密集都市、中庭／multipolygon、校園／醫院、工業、公園／運動／停車、農林、水域／橋隧保存驗收截圖與 manifest。人工檢查輪廓、holes、樓高、道路淨空、物件在 polygon 內、不跨 hole／道路、附件不飛出 footprint、材質合批無錯桶。
3. `audit_solo_boot` 只驗單機模組與模擬開機，不能代替 OSM 畫面驗收。真實場地驗收命令在缺 Playwright／Chrome 時必須標為「未驗」並退出非零，或提供明確的 `--require-browser` 模式。
4. `audit_osm_runtime_budget.mjs` 已對澀谷／六本木記錄 raw/sanitized/fit bytes、areas/rings/nodes、buildings、blockers、roof polygons、area objects、capacity drops、建圖時間與 production static batches。fit 分別 1,479,509B／1,402,093B，均低於 1,800,000B；建物 batch kinds 10／7，area-object batch kinds 7／6。`--break-relay/blocker/roof/object-batch` 均會變紅。Node 不得把 batch 數當 WebGL draw call，因此正向指令目前固定以 `browser drawCall 未驗` 退出 1。

### P5：只修真實證據支持的分類缺口

依序處理錯誤 exact mapping、錯誤 parent fallback、真實 relation／geometry 錯誤、高頻 unmapped、低頻外觀缺件。維持「一個物件家族一個生成器、一個具體類型一列 catalog」，禁止新增散落的 tag `if/else`。聚合 gaps 報告就是後續資產 backlog；不因 OSM wiki 存在某 tag 就預先擴張 catalog。

### P6：最終回歸與完成條件

修正期間按 `.claude/rules/verification.md` 跑相鄰稽核；收尾至少執行：

```bash
npm run audit:osm-catalog
node tools/audit_osm_relay.mjs
node tools/audit_osm_fixtures.mjs
node tools/audit_osm_buildings.mjs
node tools/audit_osm_runtime_budget.mjs
node tools/audit_traverse.mjs --fixture-dir=test/fixtures/osm ...
node tools/audit_client_syntax.mjs
node tools/audit_siteplan.mjs
node tools/audit_zone_cut.mjs
node tools/audit_object_joints.mjs --seeds 8
node tools/audit_venue_biome.mjs
node tools/audit_solo_boot.mjs
npm run audit:net
npm test
npm run bal
git diff --check
```

本輪審查記錄：

- `node tools/audit_osm_fixtures.mjs`：201 綠 / 3 紅；只剩柏林、倫敦、台北 5v5 L3 synthetic fallback。
- P0 三個 `--break-*`：均命中真實 fixture 並退出 1。
- `node tools/audit_osm_buildings.mjs`：64 綠 / 0 紅；三個 `--break-real-*` 均命中固定 source ID 並退出 1。
- `node tools/audit_osm_runtime_budget.mjs`：34 綠 / 1 紅，唯一紅字為 browser drawCall 未驗；四個 runtime budget mutation 均會變紅。
- `node tools/audit_traverse.mjs --only=berlin --team=5 --fixture-dir=test/fixtures/osm --fixtures=berlin`：OSM 契約相容，因缺 `elevation/berlin.json` 明確退出 1，未查網路、未用平地 fallback。
- `node tools/audit_osm_relay.mjs`：83 綠 / 0 紅；`npm run bal` 通過。
- `node tools/audit_client_syntax.mjs`：266 項通過；新增／修改的 Node 檔均通過 `node --check`。

既有 OSM catalog 七個 `--break-*` 與 P0/P3 新增的真實 fixture mutations 必須全部成功變紅。若 npm launcher 仍損壞，先修復執行環境；直接跑單一 Node 腳本只能作診斷，不能把 `npm run bal` 標成已完成。

只有下列條件同時成立才可將本任務標為完成：

- fixture audit 全綠，且分類、幾何錯誤、capacity 與 drop 指標語意互斥、逐項可追溯。
- 高風險 fixture 使用 baked OSM 路線與固定高度場重跑；沒有 synthetic fallback、未綁場地、不可達航點或未處置淨高紅字。
- 真實 multipolygon、多 outer、inner holes 與精確建築 blocker／roof 契約皆有固定 source ID 的正向及反向證據。
- traversal 確實包含 OSM 建築量體，瀏覽器固定場地畫面驗收完成且不是 skip。
- relay、runtime 容量與效能在最密集 fixture 內有量測；允許有 deterministic capacity drop，但不允許靜默遺失。
- 真實缺件清單可跨 fixture 自動聚合，所有既有 regression、反向驗證與 `git diff --check` 全綠。
