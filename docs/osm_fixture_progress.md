# 真實 OSM 固定場地驗收進度

> 更新日期：2026-08-31
>
> 這份紀錄只記錄實際執行結果；Overpass 取不到時標為「未取得」，不以合成資料代替。

## 已完成

- 新增 `public/js/osmQuery.js`：正式 feature／road query、面積額度、raw element 分流共用縫；feature query v6 改用 `out body geom` 保留 multipolygon member ref／role。
- `biomes.js` 與 `measure_osm_relay.mjs` 改吃同一份 query builder/parser。
- 新增 `tools/fetch_osm_fixture.mjs`：支援 `--name`、`--venue`、`--bbox`、`--center`、`--update`，原子寫檔，失敗不留半份。
- 新增 `tools/audit_osm_fixtures.mjs`：離線重跑 raw → AreaRecord → 投影／分類／surface rows → relay sanitize／fit，並輸出缺件候選與路線來源覆蓋。
- 新增 `tools/osm_fixture.mjs`：fixture 讀取與結構消費接線。
- `audit_traverse.mjs` 已可用 `--fixture-dir`／`--fixtures` 讀固定 OSM 道路，避免該層重新查 Overpass。
- `audit_traverse.mjs` 的外部資料降級現在會計入失敗；缺高程、缺 fixture 或只有地形層時不得報綠。
- 新增 npm scripts：`osm:fixture`、`audit:osm-fixtures`。

## Fixture 實測狀態

| Fixture | 來源／場景 | 狀態 | 最近結果 |
|---|---|---|---|
| `taipei_dense` | 台北 101 密集市區 | 已取得 | raw feature 974、road 444、relay 503KB；5v5 為 synthetic fallback |
| `shibuya_dense` | 東京澀谷密集市區 | 已取得 | raw feature 2359、road 1849、relay 1445KB、baked route 62/62；面域 capacity 180 |
| `london_water` | 倫敦泰晤士水域／橋 | 已取得 | raw feature 775、road 837、relay 814KB；5v5 為 synthetic fallback |
| `roppongi_underpass` | 東京六本木地下道候選 | 已取得 | raw feature 2259、road 1835、relay 1370KB、baked route 46/46；面域 capacity 191 |
| `berlin_bridge` | 柏林陸上高架橋（小 bbox） | 已取得 | raw feature 663、road 576、relay 583KB、18 relations／24 holes |
| `ntu_campus_small` | 台北校園（小 bbox） | 已取得 | raw feature 997、road 418、relay 515KB；分類缺件已列報 |
| `taroko_structures` | 太魯閣隧道／明隧道／水道 | 未取得 | 小 bbox feature query 仍收 mirror 504，未寫檔 |

## 已確認的真實資料缺口

- 密集都市的 `building=yes` 佔主要 unmapped 候選；目前只有可信父用地時才做 parent fallback，不把未知用途誤標成住宅。
- `shibuya_dense`、`roppongi_underpass` 超過 `OSM_AREA_LIMITS.MAX_AREAS`，capacity drop 已記入 gap 與 relay drop 欄位；尚未宣稱「無容量裁切」。
- 路線覆蓋稽核目前總計 2 紅：台北／倫敦在 5v5 沒有 L3 baked OSM 兵線，`venueConfig` 依法退回 synthetic fallback，因此不能宣稱已完成道路覆蓋驗證。報告仍保存 synthetic probe 的 miss 座標、最近 OSM way／`highway`／距離（台北 probe 29/30、倫敦 probe 20/30），供決定是否重烤 L3；澀谷 62/62、六本木 46/46 才是有效的 baked OSM route coverage。
- 六份已取得 fixture 的 relay message 都在 `OSM_RELAY.MAX_BYTES` 內；這只證明 payload 可送，不等於建物碰撞／屋頂／橋隧通行已完成驗收。

## 下一步

1. 為台北／倫敦補烘焙 L3 OSM 兵線，或明確接受 synthetic fallback；完成前不得把兩者列為道路覆蓋綠燈。
2. 以固定 fixture 接跑 `audit_traverse`；本次台北／澀谷以 5v5 執行，因沒有 `tools/.scen_cache` 高程磚而各列未驗，退出碼 1，沒有誤報綠燈。
3. 柏林已重試成功；太魯閣小 bbox feature query 仍收到 mirror 504，沒有留下半份 fixture。
4. 校園樣本已補入；若擴張覆蓋，再補醫院／工業／公園等標註習慣。
5. 只有路線、relay、分類與通行結果都能重跑後，才更新本紀錄為完成並提交。

## 驗證紀錄

- `node tools/audit_osm_catalog.mjs`：24 綠 / 0 紅。
- `node tools/audit_osm_relay.mjs`：83 綠 / 0 紅。
- `node tools/audit_client_syntax.mjs`：266 綠 / 0 紅。
- `node tools/audit_world_text.mjs`：58 綠 / 0 紅；`--break-cache` 反向驗證正確攔截 1 紅。
- `node tools/audit_pedestrian_plan.mjs`：36 綠 / 0 紅；`--break-collision` 反向驗證正確攔截。
- `node tools/balance.mjs`：通過（robot／morph／drone、塔距、經濟、對進戰與招式配置均通過）。
- `node test/e2e.mjs`（本地 `node server/server.js`）：🎉 全部通過；測後已停止本次 Node 伺服器行程，8620 上僅保留環境既有 Tailscale daemon listener。
- `node tools/audit_osm_fixtures.mjs --json=out/osm_fixture_audit.json`：106 綠 / 2 紅；柏林 18 relations／24 raw inner members／24 projected holes 與其餘五份 fixture 的 schema／relay／分類流程通過，紅字為台北／倫敦 synthetic fallback 未完成 baked OSM route coverage。
- `node tools/audit_traverse.mjs --only=taipei101,shibuya --team=5 --fixture-dir=test/fixtures/osm --fixtures=taipei_dense,shibuya_dense --cell=4 --json=out/osm_fixture_traverse.json`：高程磚不存在，2 個場地明確列未驗並退出 1。
- `npm run bal`：目前工作環境的 npm launcher 缺少 `C:\Users\user\AppData\Roaming\npm\node_modules\npm\bin\npm-cli.js`，尚未取得有效結果；待修復 launcher 或直接執行對應 Node 腳本後重跑。
