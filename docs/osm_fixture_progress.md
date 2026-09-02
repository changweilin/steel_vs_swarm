# 真實 OSM 固定場地驗收進度

> 更新日期：2026-09-02
>
> 正式回歸只使用版本化 raw payload 與高程 companion；線上 Overpass／Terrarium 僅供人工換點或重新捕獲，不作測試 fallback。

## 結論

本輪規劃中的剩餘 OSM 工作已完成。倫敦與柏林均已移除 5v5 L3 synthetic fallback，改用通過既有選線門檻的真實道路；兩場最終 bbox 的版本化 Terrarium 高程、production traversal、建築 blocker／roof／hole 契約與反向驗證均成立。沒有放寬 L3、坡度、淨空或可達性門檻。

正式場地現況：

| 場地 | 正式 fixture | 真實路線 | 高程 companion | traversal | 狀態 |
|---|---|---:|---:|---:|---|
| 台北 | `taipei_dense` | 24/24 | 已版本化 | 8/8 | 完成 |
| 澀谷 | `shibuya_dense` | 62/62 | 已版本化 | 42/42 | 完成 |
| 六本木 | `roppongi_underpass` | 46/46 | 已版本化 | 55/55 | 完成 |
| 倫敦・伊爾福德／七王站 | `london` | 26/26 | 4 tiles，193×193 | 9/9 | 完成 |
| 柏林・普倫茨勞山 | `berlin` | 23/23 | 2 tiles，193×193 | 8/8 | 完成 |

`london_water`、`berlin_bridge`、`taipei_lshape` 與 P2 fixtures 繼續作為幾何／分類覆蓋資料，不冒充正式場地通行證據。太魯閣 mirror 504 不再阻塞驗收；目標是固定結構覆蓋，不是特定地名或 fixture 數量。

## 本輪交付

### 倫敦

- 場地改綁 Ilford／Seven Kings：`ll=[51.560302, 0.084931]`、bearing 140°。
- raw fixture：feature 1211、road 393、bbox 1.4106 km²。
- 5v5 L1/L2/L3/m1 全部由真實 OSM road graph 烘焙，route coverage 26/26。
- L3 bearing 110°、overlap 0.118、sinuosity 1.52，沿用既有門檻。
- traversal：9/9 航點、823 building areas、4,204 blockers、793 roofs、3 holes（`cells` 受建構期隨機障礙影響，不列固定數字）。
- Griggs Approach `way/4950251` 淨空 7.3365m，門檻 4.70m。
- 高程：4 個原始 Terrarium PNG，37,249 samples，7.79–13.58m。

### 柏林

- 場地改綁 Prenzlauer Berg：`ll=[52.538038, 13.415268]`、bearing 70°。
- raw fixture：feature 1460、road 1310、bbox 1.0575 km²。
- 5v5 L1/L2/L3/m1 全部由真實 OSM road graph 烘焙，route coverage 23/23。
- L3 bearing 70°、overlap 0.200、sinuosity 1.66，沿用既有門檻。
- traversal：8/8 航點、1,051 building areas、11,459 blockers、1,043 roofs（`cells` 受建構期隨機障礙影響，不列固定數字）。
- 高程：2 個原始 Terrarium PNG，37,249 samples，49.62–62.11m。
- 斜向建築固定證據改鎖 `berlin/way/23093989`，不再依賴舊 Warschauer bbox。

### 共用修正

- `bake_venue_lanes.mjs` 的候選目標先按 source 所屬 graph component 排序，再套既有距離與 node index 排序及 32 筆上限。這只修正「可達候選被不相連候選截斷」的搜尋錯誤，不改路線品質門檻。
- `audit_traverse.mjs` 的 roof probe 改以完整 polygon（outer + holes）選點；hole probe 仍驗證 inner ring。這修正含中庭建築的假紅字，不改 runtime flood、碰撞或路線判定。
- `audit_mini_map.mjs` 的預建鍵斷言改為解析 `prebuildKey()` 的實際 `JSON.stringify` 欄位，不再假設 `cfg.bases`／`cfg.lanes` 的固定欄位順序；並讓 `--break-stage`／`--break-full` 在目前一階塔規格下仍能製造可觀察的壞版。
- `audit_lane_grade_sep.mjs` 在缺少本地 `.osm_cache` 時改為明確列出 29 個未驗場地後退出，不再以 `readdirSync` 的 ENOENT 崩潰。
- `venues.js`、`venueGrid.js`、`venueLanes.js`、`venueText.js` 已同步最終 bbox、朝向、路線與在地文字；舊 Thames／Westminster／Warschauer 場景宣稱已移除。
- `london_water` 已解除正式 `venue.id=london` 綁定，保留原始 Westminster 幾何 fixture。
- 兩場高程 JSON 均鎖定 bbox、center、team、tile SHA-256 與 193×193 runtime 同形網格；缺檔或 SHA 漂移會 fail-loud，不查網路、不退回平地。

## 驗收證據

正向：

| 驗證 | 結果 |
|---|---:|
| `audit_osm_fixtures.mjs` | 340 綠 / 0 紅 |
| `audit_osm_buildings.mjs` | 72 綠 / 0 紅 |
| `audit_traverse.mjs --fixture-dir=test/fixtures/osm --fixtures=london,berlin --only=london,berlin --team=5` | 22 綠 / 0 紅 |
| `audit_mini_map.mjs` | 50 綠 / 0 紅 |
| `audit_siteplan.mjs` | 265 綠 / 0 紅 |
| `audit_zone_cut.mjs` | 51 綠 / 0 紅 |
| `audit_object_joints.mjs --seeds 8` | 22,472 checks / 0 anomalies |
| `audit_road_grid.mjs` | 104 綠 / 0 紅 |
| `audit_lane_sep.mjs` | 36 綠 / 0 紅 |
| `audit_lane_navigation.mjs` | 35 綠 / 0 紅 |
| `audit_client_syntax.mjs` | 266 綠 / 0 紅 |
| `audit_osm_relay.mjs` | 83 綠 / 0 紅 |
| `audit_world_text.mjs` | 58 綠 / 0 紅 |
| `audit_vernacular.mjs` | 287 綠 / 0 紅 |
| `audit_world_height.mjs` | 49 綠 / 0 紅 |
| `audit_terrain_ray.mjs` | 11 綠 / 0 紅 |
| `npm run audit:net` | 通過 |
| `npm run bal` | 通過 |
| `npm test` | 通過 |
| `git diff --check` | 通過（僅 CRLF 提示） |

反向：

- `bake_venue_lanes.mjs --self-test-target-components`：legacy RED、component-aware GREEN。
- traversal `--break-slope`：倫敦只剩 7 航點且 bridge 不可達，正確退出 1。
- `--break-osm-roof`：命中 2 個真實 roof mutation，正確退出 1。
- `audit_mini_map.mjs --break-buffer/--break-stage/--break-team/--break-full`：各自命中對應紅字並退出 1。
- 淨空 source／tags、真實 relation／hole 與 P2 source mutations 均會變紅；不適用 mutation 會 fail-loud。

## 非本 OSM 仍待外部證據項

- runtime budget 在沒有 browser report 時維持 34 綠 / 1 紅並明確要求實機證據；既有澀谷／六本木 Playwright report 接入後為 35/35。不得把 static-only 結果標成瀏覽器驗收。
- `audit_lane_grade_sep` 在沒有 cache 時明確跳過 29 項；它沒有取代本輪 production traversal 與坡度反向驗證。

## 完成判定

- 五個正式高風險場地均使用真實 baked OSM 路線與版本化高程，無 synthetic fallback、未綁場地或不可達航點。
- production traversal 包含 OSM building blockers、roof polygons、holes、橋隧、塔／主堡與出生點。
- fixture、路線、高程、建築幾何、淨空與分類均有固定 source ID／SHA 的正向及反向證據。
- deterministic capacity drop 允許但必須可追溯；靜默遺失仍為紅字。
- 本文件所列 OSM 剩餘工作已關閉；後續若換場地，必須重新捕獲 raw fixture、高程 companion、路線與在地文字，並完整重跑相同 gates。
