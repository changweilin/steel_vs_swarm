# 真實 OSM 固定場地驗收交接

> 更新日期：2026-09-01
>
> 本文件只保留尚未完成的工作與重跑所需證據。線上 Overpass 僅用於人工更新 fixture；正式回歸一律使用版本化 raw payload，不以合成資料或外部服務失敗代替驗收。

## 現況判定

進度文件已依當前 worktree 與本輪 Luna Max 並行作業重新對帳。現在可宣稱：

- P0 fixture audit 硬化已完成：`sourceId` 唯一、raw 重排不變、sanitize/fit 冪等、候選守恆、drop ledger 與跨 fixture gaps 聚合均已有硬斷言；三個真實 fixture mutation 均會變紅。
- P3 建築靜態契約已完成：`audit_osm_buildings` 用固定 source ID 驗證 L 型、斜向、中庭、大型不規則、multipolygon、多 outer 與超細長建築，正向 66/66 綠，`--break-real-hole/blocker/roof` 均會變紅。
- `audit_traverse` 已有 production OSM building blocker／roof／hole 接線與對應 mutation；台北、澀谷、六本木的版本化真實高程 companion 已納入 fixture，乾淨環境可完全離線重跑，航點分別 8/8、42/42、55/55 可達。
- `terrain-elevation-fixture-v1` 的原始 Terrarium PNG、SHA-256、bbox/center/team 與 193×193 runtime 同形網格均已落盤；缺 companion 時仍必定列未驗並退出 1，不查網路或回退平地。
- 澀谷／六本木 31 座橋隧的 source ID、完整 raw tags、kind、淨空模式與量測值已寫入 `test/fixtures/osm/manifests/osm_clearance_manifest_v1.json`，可由 production traversal deterministic 重建；source/tags mutation 均會變紅。
- runtime 靜態預算與 dev-only browser fixture 注入／固定鏡位／顯式單幀截圖路徑已完成。實機缺 Playwright／Chromium，因此 WebGL draw calls 與畫面仍明確列未驗，沒有用 Node batch 數冒充。

因此仍不能宣稱完成。主要 blocker 已收斂為：倫敦／柏林兩個 5v5 L3 synthetic fallback 與其高程 companion、新結構樣本缺失、瀏覽器畫面／draw-call 實機驗收缺失。

## 現存證據與紅字

| Fixture | 已證明 | 尚未完成／目前紅字 |
|---|---|---|
| `taipei_dense` | raw feature 1193、road 544、relay 576KB；baked route 24/24；5v5 L3 三線為真實道路；版本化高程成立；traversal 8/8 | 無 fixture 紅字 |
| `taipei_lshape` | raw feature 974、road 444、relay 498KB；固定 `way/1071343896` L 型建築契約 | 保留為不綁正式場地的建築幾何 fixture，不冒充場地通行證據 |
| `shibuya_dense` | raw feature 2359、road 1849、relay 1468KB；baked route 62/62；版本化高程成立；traversal 42/42；淨高名冊 12 列 | parser capacity 180（已可追溯） |
| `london_water` | raw feature 775、road 837、relay 820KB | 5v5 L3 仍是 synthetic fallback；有界正式選線門搜尋無解；舊證據尚有 1 航點未達 |
| `roppongi_underpass` | raw feature 2259、road 1835、relay 1402KB；baked route 46/46；版本化高程成立；traversal 55/55；淨高名冊 19 列 | parser capacity 191（已可追溯） |
| `berlin` | raw feature 1195、road 860、relay 949KB；已正式綁 `venue.id=berlin` | 5v5 L3 仍是 synthetic fallback；有界正式選線門搜尋無解；缺版本化高程 companion |
| `berlin_bridge` | raw feature 663、road 576、relay 590KB；18 relations／24 holes | 保留為小 bbox 建築幾何 fixture，不冒充正式場地通行證據 |
| `ntu_campus_small` | raw feature 997、road 418、relay 525KB；分類缺件可列報 | 未綁正式場地，尚無通行與畫面驗收 |
| `taroko_structures` | 無 | mirror 504，未取得 fixture；不得讓單一外部場地永久阻塞整體驗收 |

`building=yes` 是目前主要 unmapped 候選。只有可信父用地時才允許 parent fallback，不得為提高覆蓋率而猜成住宅。`shibuya_dense` 與 `roppongi_underpass` 的 capacity drop 已被列報；完成條件不是「零裁切」，而是裁切順序固定、每筆可追溯且無靜默遺失。

## 未完成計畫

### P0：fixture audit 硬化（已完成）

- 例外路徑、互斥指標、source ID 唯一、重排不變、sanitize/fit 冪等、候選守恆、drop ledger 與跨 fixture gaps 聚合已落地。
- `--break-real-relation`、`--break-real-hole`、`--break-capacity-report` 均命中真實 fixture 並退出 1。
- 目前 `audit_osm_fixtures` 為 229 綠 / 2 紅；兩個紅字均是真實未完成的 L3 synthetic fallback，不是 P0 程式錯誤。

### P1：關閉目前已知紅字

1. 澀谷／六本木低淨高段已按 runtime `surfaceAt/ceilingAt` 分成 underpass 與 `deck-only`，不放寬淨高門檻；逐座 source ID/tags 名冊已完成，正向 deterministic 比對與 `--break-clearance-source/tags` 均成立。
2. 台北／澀谷／六本木的版本化高程 companion 與 traversal 已完成；倫敦／柏林仍須先解決正式 L3 場地，才能捕獲與最終 bbox 相同的 companion。
3. 5v5 L3 紅字現只剩倫敦、柏林。台北已用有界 raw fixture 搜尋取得三條真實道路兵線，按新 `venueConfig` 重抓同名 raw fixture，center/bbox/query 與 24 個烘焙節點全數一致。烘焙器會固定既有 L3 兩堡中點、寫入前硬驗 center/bbox；漂移時除非明示 `FIXTURE_RECAPTURE=1`，否則拒絕覆寫。連續兩次重烤 SHA-256 相同。
4. 本輪再做 bounded feasibility review：倫敦目前 837 raw roads／277 usable，兩個擴大候選（1.93／10.76km²）仍只有 L1；柏林目前 860 raw／393 usable，另測 2200 raw／1262 usable／4533 nodes 的多橋候選，完整 gates 下仍因 noPath／detour／overlap／backtrack／turnAccum 無法形成 L3。未放寬門檻、未手寫路線、未覆寫正式 fixture。
5. 正式 `berlin.json` 已綁 `venue.id=berlin` 並通過 OSM bbox/center/query 契約；通行尚被 L3 與高程 companion 缺失擋住。`berlin_bridge` 繼續作為小 bbox 建築幾何 fixture。
6. 太魯閣只再做一次有紀錄的 bounded retry；仍失敗就改選可穩定取得、同樣涵蓋隧道／明隧道／水道語意的場地。結構覆蓋是目標，特定 mirror 或地名不是完成條件。

### P2：補齊「結構覆蓋」，不追求任意場地數量

目前樣本偏密集都市。新增最小集合以覆蓋缺少的標註習慣：

- 醫院園區。
- 工業／公用設施。
- 公園＋運動場＋大型停車場。
- 農地＋林地。
- 至少一份可綁場地的中庭／多 outer multipolygon 建築。

每份 fixture 必須保留 raw response、query/schema version、bbox、center、capturedAt、source URL、原始 IDs/tags/members，並通過 P0 的全部斷言。不要為湊數恢復「29 場都抓」的目標。

### P3：真實建築幾何與通行契約（高風險三場已完成，倫敦／柏林待選線）

1. 已從固定 fixture 鎖定 L 型、斜向、中庭、大型不規則、multipolygon、多 outer、超細長建築的 source IDs。
2. 正式 `buildOsmPolygonBuildings` 受控執行已驗證：
   - OSM outer = 視覺外牆邊界 = authoritative blocker 邊界。
   - roof platform = outer − holes；中庭沒有屋頂或 blocker。
   - 碰撞不得退回外接 AABB／外接圓，附件不得超出 footprint；放不下即省略。
   - runtime invalid/skipped/capacity 均回到同一份 gaps 報告並帶 source ID。
3. fixture traversal 已同時接 OSM building blockers、roof platforms、橋隧、塔／主堡與出生點，並輸出 source ID、catalog kind、polygon index、最近 blocker 與距離。
4. 台北正式場地移動後，原本的 L 型固定 ID 沒有改綁弱樣本；舊 bbox 重新捕獲為 `taipei_lshape` 幾何 fixture，`way/1071343896` 的 27 段 blocker/wall、roof 與附件契約仍完整保留。
5. `audit_osm_buildings --break-real-hole/blocker/roof` 已全部攔下壞版；台北／澀谷／六本木的 `audit_traverse` 已使用同名高程 fixture 驗證 blocker／roof／hole。倫敦／柏林仍須 fail-loud，不准在缺最終 L3 companion 時報綠。

### P4：瀏覽器畫面與 runtime 預算（靜態預算部分完成）

1. dev-only 固定 fixture 注入已完成：loopback＋header gate 從版本化 raw fixture 進入既有 sanitize/fit/commit/buildBiomes；沒有另寫截圖專用建物生成器。cloud、production、非 loopback、缺 header 與路徑越界均被拒絕。
2. `audit_osm_browser.mjs` 與固定鏡位 manifest 已完成，顯式只畫一幀並用 `renderer.info.autoReset=false` 累加整條多 pass 管線的 draw calls；缺 Playwright／Chromium 時每個 shot 都標未驗並退出 1。本機因此尚無可接受的 PNG／sidecar 證據。
3. 待有瀏覽器環境後，先實拍澀谷／六本木，再擴至中庭／multipolygon、校園／醫院、工業、公園／運動／停車、農林、水域／橋隧；人工檢查輪廓、holes、樓高、道路淨空、物件在 polygon 內、不跨 hole／道路、附件不飛出 footprint、材質合批無錯桶。
4. `audit_solo_boot` 只驗單機模組與模擬開機，不能代替 OSM 畫面驗收。
5. `audit_osm_runtime_budget.mjs` 已對澀谷／六本木記錄 raw/sanitized/fit bytes、areas/rings/nodes、buildings、blockers、roof polygons、area objects、capacity drops、建圖時間與 production static batches。fit 分別 1,479,509B／1,402,093B，均低於 1,800,000B；建物 batch kinds 10／7，area-object batch kinds 7／6。`--break-relay/blocker/roof/object-batch` 均會變紅。Node 不得把 batch 數當 WebGL draw call，因此正向指令目前固定以 `browser drawCall 未驗` 退出 1。

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

- `node tools/audit_osm_fixtures.mjs`：229 綠 / 2 紅；只剩柏林、倫敦 5v5 L3 synthetic fallback。台北專項 30/30 綠、routeCoverage 24/24。
- P0 三個 `--break-*`：均命中真實 fixture 並退出 1。
- `node tools/audit_osm_buildings.mjs`：66 綠 / 0 紅；L 型固定證據改由 `taipei_lshape/way/1071343896` 保留，三個 `--break-real-*` 均命中固定 source ID 並退出 1。
- `node tools/audit_osm_runtime_budget.mjs`：34 綠 / 1 紅，唯一紅字為 browser drawCall 未驗；四個 runtime budget mutation 均會變紅。
- `node tools/audit_traverse.mjs --only=shibuya,roppongi ... --check-clearance-manifest`：38 綠 / 0 紅；42/42 與 55/55 航點可達，31 列 source ID/tags deterministic 比對成立；`--break-clearance-source/tags` 均精確變紅。
- `node tools/audit_traverse.mjs --only=taipei101 ...`：12 綠 / 0 紅，8/8 航點可達；OSM blocker／roof／hole 契約成立。
- `node tools/audit_traverse.mjs --only=berlin --team=5 --fixture-dir=test/fixtures/osm --fixtures=berlin`：OSM 契約相容，因缺最終 L3 與 `elevation/berlin.json` 明確退出 1，未查網路、未用平地 fallback。
- `node tools/audit_osm_browser.mjs --only shibuya_dense,roppongi_underpass --require-browser`：因本機缺 Playwright／Chromium 明確退出 1；report 與每個 shot 均為 `unverified`，沒有 PNG 被追蹤。
- `node tools/audit_osm_relay.mjs`：83 綠 / 0 紅；`npm run bal` 通過。
- `node tools/audit_client_syntax.mjs`：266 項通過；新增／修改的 Node 檔均通過 `node --check`；`audit_net_modes` 全綠。
- `audit_map_rules`、`audit_lane_sep`、`audit_lane_navigation`、`audit_mini_map`、`audit_story_map` 全綠；台北 fixture 重烤連續兩次輸出 SHA-256 相同。

既有 OSM catalog 七個 `--break-*` 與 P0/P3 新增的真實 fixture mutations 必須全部成功變紅。若 npm launcher 仍損壞，先修復執行環境；直接跑單一 Node 腳本只能作診斷，不能把 `npm run bal` 標成已完成。

只有下列條件同時成立才可將本任務標為完成：

- fixture audit 全綠，且分類、幾何錯誤、capacity 與 drop 指標語意互斥、逐項可追溯。
- 高風險 fixture 使用 baked OSM 路線與固定高度場重跑；沒有 synthetic fallback、未綁場地、不可達航點或未處置淨高紅字。
- 真實 multipolygon、多 outer、inner holes 與精確建築 blocker／roof 契約皆有固定 source ID 的正向及反向證據。
- traversal 確實包含 OSM 建築量體，瀏覽器固定場地畫面驗收完成且不是 skip。
- relay、runtime 容量與效能在最密集 fixture 內有量測；允許有 deterministic capacity drop，但不允許靜默遺失。
- 真實缺件清單可跨 fixture 自動聚合，所有既有 regression、反向驗證與 `git diff --check` 全綠。
