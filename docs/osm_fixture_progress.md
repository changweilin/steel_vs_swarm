# 真實 OSM 固定場地驗收交接

> 更新日期：2026-09-01
>
> 本文件只保留尚未完成的工作與重跑所需證據。線上 Overpass 僅用於人工更新 fixture；正式回歸一律使用版本化 raw payload，不以合成資料或外部服務失敗代替驗收。

## 現況判定

固定 fixture 的抓取、共用 query/parser、離線 catalog/relay audit 與 fixture 模式 traversal 已建立，六份真實 payload 可離線重跑；但目前只能宣稱「真實資料的解析、分類、relay 與部分橋隧通行已有證據」，尚不能宣稱完整驗收完成。

仍缺四層證據：

- `audit_osm_fixtures` 尚未完整證明 source ID 唯一、輸入重排不變、sanitize/fit 冪等、raw 到輸出的逐項守恆，以及 capacity drop 可追溯。
- `audit_traverse` 現在只把固定 fixture 的道路交給地形、橋、隧道與地下道流程；沒有把真實 OSM 建築的 blocker／roof platform 放進同一張泛洪圖。
- 尚無固定真實建築 source ID 的 outer／holes／牆段／碰撞／屋頂契約驗證，也沒有固定場地的瀏覽器畫面驗收。
- relay 位元組上限已量到，但尚未取得 runtime blocker、roof、area object、draw call 與建圖時間的密集場景預算證據。

## 現存證據與紅字

| Fixture | 已證明 | 尚未完成／目前紅字 |
|---|---|---|
| `taipei_dense` | raw feature 974、road 444、relay 503KB；真實高度場航點 8/8 | 5v5 L3 仍是 synthetic fallback，不能算 OSM 兵線覆蓋通過 |
| `shibuya_dense` | raw feature 2359、road 1849、relay 1445KB；baked route 62/62；航點 41/41 | capacity 180；4 座橋跨中淨高不足 |
| `london_water` | raw feature 775、road 837、relay 814KB | 5v5 L3 仍是 synthetic fallback；橋面航點 11/12 |
| `roppongi_underpass` | raw feature 2259、road 1835、relay 1370KB；baked route 46/46 | capacity 191；航點 58/61；7 座橋淨高不足 |
| `berlin_bridge` | raw feature 663、road 576、relay 583KB；18 relations／24 holes | metadata 未綁 `berlin`，尚無 runtime 幾何或通行證據 |
| `ntu_campus_small` | raw feature 997、road 418、relay 515KB；分類缺件可列報 | 未綁正式場地，尚無通行與畫面驗收 |
| `taroko_structures` | 無 | mirror 504，未取得 fixture；不得讓單一外部場地永久阻塞整體驗收 |

`building=yes` 是目前主要 unmapped 候選。只有可信父用地時才允許 parent fallback，不得為提高覆蓋率而猜成住宅。`shibuya_dense` 與 `roppongi_underpass` 的 capacity drop 已被列報；完成條件不是「零裁切」，而是裁切順序固定、每筆可追溯且無靜默遺失。

## 未完成計畫

### P0：先硬化 fixture audit，避免假綠

1. 修正 `audit_osm_fixtures.mjs` 的例外路徑；目前 `catch` 將數字變數 `fail` 當函式呼叫，fixture 處理拋錯時會產生第二個例外。
2. 將指標拆成互斥語意：`geometryInvalid`、`exact`、`parentFallback`、`unmapped`、`capacityDropped`。目前輸出的 `invalid` 混入 unmapped，不能拿來判斷真實幾何品質。
3. 增加硬斷言：
   - raw element 與 AreaRecord `sourceId` 唯一。
   - raw elements 重排後，parser、catalog、gaps、relay fit 結果逐位元一致。
   - sanitize 重跑與 fit 後再 sanitize 結果一致，不只檢查「非 null」。
   - raw 候選必須能守恆到 accepted、invalid 或 capacity dropped；所有 drop 都帶 reason 與 source ID。
   - 跨 fixture 聚合 gaps，輸出 `key=value`、reason、fallback、count、areaM2、fixture 數與範例 source IDs，依次數、面積、遊戲辨識重要性排序。
4. 增加 fixture 層反向驗證：`--break-real-relation`、`--break-real-hole`、`--break-capacity-report`；壞版必須退出 1。

### P1：關閉目前已知紅字

1. 逐項列出澀谷 4 座、六本木 7 座低橋的 OSM way ID、`bridge/layer/covered/tunnel` tags、下方道路與最小淨高。先判定它是可通橋下、僅橋面可走，或誤建結構，再調整結構資格、橋面剖面或路線；不得放寬淨高門檻掩蓋問題。
2. 定位六本木 3 個、倫敦 1 個不可達航點的最近 blocker／結構與 source ID，修正後重跑固定高度場 traversal。
3. 台北與倫敦必須補出 5v5 L3 baked OSM 兵線；若當地路網無法支撐目前戰場配置，應調整場地 bbox／戰場配置或更換驗收 fixture，不把 synthetic fallback 接受為固定 OSM 驗收綠燈。
4. 將 `berlin_bridge` 正確綁到 `venue.id=berlin`，重跑 bbox／center 契約與 traversal。
5. 太魯閣只再做一次有紀錄的 bounded retry；仍失敗就改選可穩定取得、同樣涵蓋隧道／明隧道／水道語意的場地。結構覆蓋是目標，特定 mirror 或地名不是完成條件。

### P2：補齊「結構覆蓋」，不追求任意場地數量

目前樣本偏密集都市。新增最小集合以覆蓋缺少的標註習慣：

- 醫院園區。
- 工業／公用設施。
- 公園＋運動場＋大型停車場。
- 農地＋林地。
- 至少一份可綁場地的中庭／多 outer multipolygon 建築。

每份 fixture 必須保留 raw response、query/schema version、bbox、center、capturedAt、source URL、原始 IDs/tags/members，並通過 P0 的全部斷言。不要為湊數恢復「29 場都抓」的目標。

### P3：補真實建築幾何與通行契約

1. 從固定 fixture 鎖定 L 型、斜向、中庭、大型不規則、multipolygon、多 outer、超細長建築的 source IDs，形成可審查名冊。
2. 使用正式 `buildOsmPolygonBuildings` 路徑驗證：
   - OSM outer = 視覺外牆邊界 = authoritative blocker 邊界。
   - roof platform = outer − holes；中庭沒有屋頂或 blocker。
   - 碰撞不得退回外接 AABB／外接圓，附件不得超出 footprint；放不下即省略。
   - runtime invalid/skipped/capacity 均回到同一份 gaps 報告並帶 source ID。
3. 擴充 fixture traversal，使泛洪同時吃正式 OSM building blockers、roof platforms、橋隧結構、塔／主堡與出生點。失敗輸出至少帶航點、source ID、catalog kind、polygon index、最近 blocker 與距離。
4. 對上述真實建築加入 hole、blocker 或 roof 的反向驗證，確認契約真的能攔壞版。

### P4：瀏覽器畫面與 runtime 預算

1. 增加只供 audit/dev 的固定 fixture 注入路徑，讓瀏覽器完整走 relay → runtime generation；不得另寫一套只為截圖的建物生成器。
2. 對密集都市、中庭／multipolygon、校園／醫院、工業、公園／運動／停車、農林、水域／橋隧保存驗收截圖與 manifest。人工檢查輪廓、holes、樓高、道路淨空、物件在 polygon 內、不跨 hole／道路、附件不飛出 footprint、材質合批無錯桶。
3. `audit_solo_boot` 只驗單機模組與模擬開機，不能代替 OSM 畫面驗收。真實場地驗收命令在缺 Playwright／Chrome 時必須標為「未驗」並退出非零，或提供明確的 `--require-browser` 模式。
4. 對最密集 fixture 記錄 raw/sanitized/fit bytes、areas/rings/nodes、buildings、blockers、roof polygons、area objects、capacity drops、建圖時間與 draw calls。驗收 `relay <= OSM_RELAY.MAX_BYTES`，並確認 draw calls 不隨建物數量線性成長。

### P5：只修真實證據支持的分類缺口

依序處理錯誤 exact mapping、錯誤 parent fallback、真實 relation／geometry 錯誤、高頻 unmapped、低頻外觀缺件。維持「一個物件家族一個生成器、一個具體類型一列 catalog」，禁止新增散落的 tag `if/else`。聚合 gaps 報告就是後續資產 backlog；不因 OSM wiki 存在某 tag 就預先擴張 catalog。

### P6：最終回歸與完成條件

修正期間按 `.claude/rules/verification.md` 跑相鄰稽核；收尾至少執行：

```bash
npm run audit:osm-catalog
node tools/audit_osm_relay.mjs
node tools/audit_osm_fixtures.mjs
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

既有 OSM catalog 七個 `--break-*` 與 P0/P3 新增的真實 fixture mutations 必須全部成功變紅。若 npm launcher 仍損壞，先修復執行環境；直接跑單一 Node 腳本只能作診斷，不能把 `npm run bal` 標成已完成。

只有下列條件同時成立才可將本任務標為完成：

- fixture audit 全綠，且分類、幾何錯誤、capacity 與 drop 指標語意互斥、逐項可追溯。
- 高風險 fixture 使用 baked OSM 路線與固定高度場重跑；沒有 synthetic fallback、未綁場地、不可達航點或未處置淨高紅字。
- 真實 multipolygon、多 outer、inner holes 與精確建築 blocker／roof 契約皆有固定 source ID 的正向及反向證據。
- traversal 確實包含 OSM 建築量體，瀏覽器固定場地畫面驗收完成且不是 skip。
- relay、runtime 容量與效能在最密集 fixture 內有量測；允許有 deterministic capacity drop，但不允許靜默遺失。
- 真實缺件清單可跨 fixture 自動聚合，所有既有 regression、反向驗證與 `git diff --check` 全綠。
