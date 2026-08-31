# 真實 OSM 固定場地驗收進度

> 更新日期：2026-09-01
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
- 修補 `bake_venue_lanes.mjs`：指定場地未取得新路線時拒絕重寫既有 `venueLanes.js`，避免 Overpass 失敗把有效 baked route 靜默刪掉。
- 修補 `audit_traverse.mjs`／`venue_field.mjs`：泛洪加入正式 `_spawnPoint`，並讓結構清單逐頂點套用執行期同形的 `inb=4` 邊界裁切，排除場外橋隧造成的假紅字。
- 新增 npm scripts：`osm:fixture`、`audit:osm-fixtures`。

## Fixture 實測狀態

| Fixture | 來源／場景 | 狀態 | 最近結果 |
|---|---|---|---|
| `taipei_dense` | 台北 101 密集市區 | 已取得 | raw feature 974、road 444、relay 503KB；L1/L2/m1 已烘焙，5v5 L3 仍為 synthetic fallback；通行航點 8/8 |
| `shibuya_dense` | 東京澀谷密集市區 | 已取得 | raw feature 2359、road 1849、relay 1445KB、baked route 62/62；面域 capacity 180；通行航點 41/41，4 座橋淨高不足 |
| `london_water` | 倫敦泰晤士水域／橋 | 已取得 | raw feature 775、road 837、relay 814KB；L1/m1 已烘焙，5v5 L3 仍為 synthetic fallback；通行航點 11/12 |
| `roppongi_underpass` | 東京六本木地下道候選 | 已取得 | raw feature 2259、road 1835、relay 1370KB、baked route 46/46；面域 capacity 191；通行航點 58/61，7 座橋淨高不足 |
| `berlin_bridge` | 柏林陸上高架橋（小 bbox） | 已取得但未綁場地 | raw feature 663、road 576、relay 583KB、18 relations／24 holes；`venue:null`，通行稽核未能對應 `berlin` |
| `ntu_campus_small` | 台北校園（小 bbox） | 已取得 | raw feature 997、road 418、relay 515KB；分類缺件已列報 |
| `taroko_structures` | 太魯閣隧道／明隧道／水道 | 未取得 | 小 bbox feature query 仍收 mirror 504，未寫檔 |

## 已確認的真實資料缺口

- 密集都市的 `building=yes` 佔主要 unmapped 候選；目前只有可信父用地時才做 parent fallback，不把未知用途誤標成住宅。
- `shibuya_dense`、`roppongi_underpass` 超過 `OSM_AREA_LIMITS.MAX_AREAS`，capacity drop 已記入 gap 與 relay drop 欄位；尚未宣稱「無容量裁切」。
- 路線覆蓋稽核目前總計 2 紅：台北／倫敦在 5v5 沒有 L3 baked OSM 兵線，`venueConfig` 依法退回 synthetic fallback，因此不能宣稱已完成道路覆蓋驗證。報告仍保存 synthetic probe 的 miss 座標、最近 OSM way／`highway`／距離（台北 probe 29/30、倫敦 probe 20/30），供決定是否重烤 L3；澀谷 62/62、六本木 46/46 才是有效的 baked OSM route coverage。
- 真實高度場通行驗收已取得可重跑證據：台北 8/8 航點全到達；澀谷 41/41 航點全到達，但有 4 座橋的跨中淨高僅 0.45m；六本木 3 個航點不可達、7 座橋淨高低於 4.70m；倫敦 1 個橋面航點不可達。這些是實際紅字，不以 synthetic fallback 抵銷。
- 澀谷的 4 座低橋與六本木的 7 座低橋都在固定 fixture 的場內結構清單中；目前 `deckAt` 以兩端地表高度內插並套 `BRIDGE_RISE`，遇到高地形／跨越非水面道路時會形成 0.45m～4.14m 淨高。需先按 OSM 結構語意判定哪些是「有橋但無可行橋下通道」，再決定調整路線、剔除結構或修正橋面剖面，不能只放寬稽核門檻。
- `berlin_bridge` 的原始 fixture 本身 schema、multipolygon、holes、relay 與分類均通過，但 metadata 沒有 `venue.id`，因此 `audit_traverse` 只能標未綁定；這不是柏林通行已通過的證據。
- 六份已取得 fixture 的 relay message 都在 `OSM_RELAY.MAX_BYTES` 內；這只證明 payload 可送，不等於建物碰撞／屋頂／橋隧通行已完成驗收。

## 下一步

1. 先處理澀谷 4 座、六本木 7 座低橋與六本木 3 個不可達航點；保留目前紅字，完成 OSM way／layer／實際下方道路的逐項判定後才改幾何或路線。
2. 為台北／倫敦補烘焙 L3 OSM 兵線，或明確接受 synthetic fallback；完成前不得把兩者列為道路覆蓋綠燈。
3. 為 `berlin_bridge` 補正確的 `venue.id`／場地對應後，再重跑該 fixture 的通行驗收；太魯閣小 bbox feature query 仍收到 mirror 504，沒有留下半份 fixture。
4. 校園樣本已補入；若擴張覆蓋，再補醫院／工業／公園等標註習慣。
5. 只有路線、relay、分類與通行結果都能重跑且紅字處置完成後，才更新本紀錄為完成並提交。

## 驗證紀錄

- `node tools/audit_osm_catalog.mjs`：24 綠 / 0 紅。
- `node tools/audit_osm_relay.mjs`：83 綠 / 0 紅。
- `node tools/audit_client_syntax.mjs`：266 綠 / 0 紅。
- `node tools/audit_world_text.mjs`：58 綠 / 0 紅；`--break-cache` 反向驗證正確攔截 1 紅。
- `node tools/audit_pedestrian_plan.mjs`：36 綠 / 0 紅；`--break-collision` 反向驗證正確攔截。
- `node tools/balance.mjs`：通過（robot／morph／drone、塔距、經濟、對進戰與招式配置均通過）。
- `node test/e2e.mjs`（本地 `node server/server.js`）：🎉 全部通過；測後已停止本次 Node 伺服器行程，8620 上僅保留環境既有 Tailscale daemon listener。
- `node tools/audit_osm_fixtures.mjs --json=out/osm_fixture_audit.json`：106 綠 / 2 紅；柏林 18 relations／24 raw inner members／24 projected holes 與其餘五份 fixture 的 schema／relay／分類流程通過，紅字為台北／倫敦 synthetic fallback 未完成 baked OSM route coverage。
- `node tools/audit_traverse.mjs --only=taipei101,shibuya,london,roppongi --team=5 --fixture-dir=test/fixtures/osm --fixtures=taipei_dense,shibuya_dense,london_water,roppongi_underpass --cell=4 --json=out/osm_fixture_traverse.json`：使用固定 terrarium 高程磚；台北 8/8 航點，澀谷 41/41 航點、11 結構／12 開挖走廊與 4 個橋下淨高紅字，倫敦 11/12 航點，六本木 58/61 航點、25 結構／14 開挖走廊與 7 個橋下淨高紅字；退出 1。`cells` 受稽核內建動態碉堡配置影響，只作效能／規模參考，不作逐位元基準。
- `node tools/audit_traverse.mjs --only=taipei101 --team=5 --fixture-dir=test/fixtures/osm --fixtures=taipei_dense --cell=4 --break-slope`：反向驗證將坡度閘寫死為全擋後，台北塔位航點出現紅字並退出 1，確認壞版確實被攔截。
- `node tools/audit_lane_navigation.mjs`：35 綠 / 0 紅；`node tools/audit_map_rules.mjs`：89 個場地×兵線、0 疊塔違規；`node tools/audit_lane_sep.mjs`：31 個多兵線場地×兵線、0 接觸／交叉違規。
- `npm run bal`：目前工作環境的 npm launcher 缺少 `C:\Users\user\AppData\Roaming\npm\node_modules\npm\bin\npm-cli.js`，尚未取得有效結果；待修復 launcher 或直接執行對應 Node 腳本後重跑。
