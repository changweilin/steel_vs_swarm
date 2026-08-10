# 地圖主方位旋轉 + 道路 16 方向量化 —— 交接

> **定位**:這份文件只裝「沒有別的家」的東西 —— 使用者定案的原句、當輪的實測數字、被排除的
> 選項與排除理由、未驗項、下一階段還沒釘死的問題。
> **設計與禁令不在這裡**:單一真相縫索引三列 + A42 + 驗證矩陣兩列住 [`/CLAUDE.md`](../CLAUDE.md);
> 逐項斷言、幾何推導、壞掉時的症狀敘事住 [`tools/audit_road_grid.mjs`](../tools/audit_road_grid.mjs)
> 與 [`public/js/roadgrid.js`](../public/js/roadgrid.js) 的檔頭。**改東西前先開那兩支,不要從本檔重建。**

**分支** `claude/map-road-grid-alignment-85b69e`,**尚未 commit**。基準日 2026-08-10。

---

## 1. 使用者定案(原句)

**第一輪**
> 「處理圖資時先找出地圖上下左右對準哪一個方向時,可以對齊最多的大馬路組成正交網格,接著將
> 所有道路量化成 16 個方向,同時盡可能避免讓道路變成鋸齒,這樣道路拼圖可以透過這 16 個方向
> 簡化並無縫準確貼合對齊,建築也更容易對齊排列。」

追問「是真的把世界轉過來,還是只用那個角度當 16 方向的錨?」→ 定案 **真的旋轉整張地圖**;
量化對象定案 **只有 `osmRoads`**(鐵路/兵線/建物輪廓皆不動)。

**第二輪**(下一階段的方向,尚未實作)
> 「圖資儲存在開房者,再由開房者透過 server 傳給入房者?」

---

## 2. 已落地

| 檔案 | 內容 |
|---|---|
| `public/js/data.js` | 投影單一縫 `mapRot`/`rotXZ`/`llToXZ`/`xzToLL`;`battleRect`(世界方框)/`battleBBox`(資料抓取範圍)分家 |
| `public/js/terrain.js` | `llToWorld` 轉呼;世界方框吃 `battleRect`;高程網格改**世界格**取樣;影像取樣/UV/開挖重繪三處逆投影 |
| `server/sim.js` | `llToMeters` 收成 **z 反號薄殼**;`bounds` 吃 `battleRect` |
| `public/js/roadgrid.js` | **新**,零 import、零亂數。16 方向量化(細分 → 位置空間 DDA → 節點鬆弛 → 逐段長度重解) |
| `public/js/biomes.js` | `worldToLL` 轉呼;量化接線**恰一處**(取得 `osmRoads` 之後、所有消費端之前) |
| `public/js/ground.js` | `gridA` 的第二份 ×4 圓平均收掉,改吃 `roadgrid.gridAngle` |
| `public/js/venueGrid.js` | **新**,離線烘焙的 28 個場地主方位(度) |
| `public/js/venues.js` | `venueConfig` 把 `VENUE_GRID` 寫進 `cfg.center.rot` |
| `tools/bake_venue_grid.mjs` | **新**,烘焙工具(`--only <ids>` / `--dry`) |
| `tools/audit_road_grid.mjs` | **新**,51 項 + 三支反向驗證 |
| `tools/audit_ground_qc.mjs` / `audit_world_edge.mjs` / `audit_weapon_gate.mjs` | 被本次改動打到,已跟著修(見 §6) |

**沒有動到的東西**(下一輪要避免誤判成漏做):平衡數值一行未改;兵線、鐵路、建物輪廓不量化;
`GEO_SCALE_VER` 不需要 +1(旋轉是等距同構,烘焙好的兵線仍然有效);`venueLanes.js` 不需重烤。

---

## 3. 實測數字(證據;調參與回歸的基準)

**真實 OSM 圖資,量化前後的段方位離 16 格的長度加權平均誤差**

| 場地 | 主方位 | 角度誤差 | 逐條路最差 | 位移 p90 / max | 直段均長 | 規模 / 耗時 |
|---|---|---|---|---|---|---|
| manhattan | −29.0° | 0.82° → **0.12°** | 2.92° | 2.6 / 10.5m | 72 → **262m** | 445 way / 6000 節點 / 29ms |
| shibuya | 14.5° | 5.61° → **0.13°** | 6.63° | 5.5 / 14.0m | 57 → 43m | 631 way / 8301 節點 / 30ms |
| barcelona | 42.8° | 3.40° → **0.31°** | 10.65° | 5.1 / 12.0m | 55 → 93m | 665 way / 6477 節點 / 27ms |
| taroko | −26.0° | 5.54° → **0.01°** | 0.63° | 6.0 / 9.1m | 38 → 65m | 15 way / 324 節點 / 3ms |

合成密路網壓測:1500 way / 20872 節點 / 25232 邊 → **87ms**,兩次逐位元相同。

**烘焙結果可用現實驗證**:manhattan −29.0°、chicago −0.003°、barcelona 42.8°、kyoto −2.5° ——
與這幾座城市真實的街廓方位對得上。**回歸時這四個值不該漂。**

**未烘焙的場地只有 `uluru`**,理由是「此範圍沒有大馬路」(澳洲內陸巨岩)—— 這是**正確結果**
不是烘焙失敗,`rot=0` 就是它該有的樣子。MUST NOT 為了湊滿 29 個而放寬取樣面。

**旋轉對世界方框的影響**(全 29 場地 × 3 人數 × 6 角度):面積比 1.000~1.70×,只增不減。
高程磚數上限 4(守衛 16,不必動)。

---

## 4. 已排除的選項(附排除理由;**不要重新提案**)

| 選項 | 排除理由 |
|---|---|
| 只把 θ 當「16 方向的錨」,世界不轉 | 使用者第一輪明確選了「真的旋轉整張地圖」 |
| θ 在**執行期**由各客戶端自己算 | `startPrebuild` 是每個客戶端各跑一次的([main.js:2823](../public/js/main.js:2823));而 `scheduleOsmRetry` 的存在就證明「這一輪 Overpass 被限流」是常態 ⇒ A 抓到 θ=−29°、B 沒抓到 θ=0,兩台整個世界差 29°。今天的 miss 只讓那台少幾座橋(局部);θ 的 miss 會讓所有座標對不上(全域)|
| 用**已在手上的兵線**估 θ(零網路) | 實測 58 組(28 場地 × 人數,只取真實道路兵線)對比大馬路烘焙值:p50 3.9° / p75 8.8° / **p90 16.1° / max 44.0°**,落在半格內只有 79%。最差是整個轉錯(barcelona L1 估 −15° vs 真值 42.8°、iguazu L3 差 44°)。而且**同一張圖會隨人數轉不同角度**(shibuya L1/L3/L5 = −6.3°/27.8°/29.7°)⇒ 直接出局 |
| 事後把「短方向段併進鄰段」來去鋸齒 | 它把 DDA 排好的階梯併回單一方向 ⇒ 長度重解退化成「兩錨點之間拉直」= 那條路等於沒被量化。實測拿掉併段後誤差 p90 由 5.9° 掉到 0.5°,而直段均長只從 122m 降到 86m。**已寫成 A42 ⑥ 禁令** |
| 讓量化不受位移上限、把路整條吸到鄰格 | 卡在格界(11.25°)的 1.5km 直路尾端會甩出 **518m**(實測),那條路就此離開衛星底圖、離開已整平的路基、離開自己那條兵線 |

---

## 5. 未驗項

**需外網 / 真瀏覽器(㋓ / ㋕)**
- `audit_traverse` —— 路網幾何動了,兵線與結構要仍走得通。**沙箱降級的「未驗」結果 MUST NOT 當綠燈。**
- `audit_lane_scenarios`、完整版 `audit_venue_biome`
- 真機看一張旋轉過的市區圖(建議 manhattan 或 barcelona:主方位大、效果最明顯)

**與本次無關的既有紅字**(已在 main 上覆核,不要誤修)
- `audit_touch_layout`:667×375 橫式,main 上就是紅的
- `audit_lane_grade_sep`:此 worktree 缺 `tools/.osm_cache` 目錄而拋 ENOENT

**本輪已跑過且全綠**:`npm test`(先重啟過伺服器)、`npm run bal`、`audit_road_grid`(±三支
`--break-*`)、`audit_client_syntax`、`audit_solo_boot`、`audit_net_modes`、`audit_weapon_gate`、
`audit_ground_qc`、`audit_world_edge`、`audit_siteplan`、`audit_beacons`、`audit_object_joints --seeds 8`、
`audit_venue_biome --offline`,以及戰鬥/bot/世界/UI 各批(清單見 CLAUDE.md §5.5 的兩列)。

---

## 6. 這一輪踩過、下一輪會再踩的坑

1. **量化之前 MUST 先細分**。一段的偏差 ≈ 段長 × 角度誤差;OSM 直路頂點可以隔一兩百公尺,
   單單一段就吃光位移預算 ⇒ DDA 每一步都超標、逐段換格,結果不是量化而是鋸齒
   (實測 100m 頂點間距的斜街:量化前 10.1° → 量化後 10.3°,**等於整條沒被量化**)。
2. **`battleRect` 的面積會被旋轉吃掉**。方框是「旋轉後兵線包絡」的外接框,兵線一被轉到與某軸
   平行那一軸就塌(barcelona 5v5 轉 45° ⇒ 面積剩 66%),而 `MAP_EXPAND` 是等比放大救不了 ——
   它存在的理由正是第三方野營的側翼合法區。現在逐軸取「旋轉後」與 rot=0 的較寬者。
3. **原文沙箱的自由變數清單要跟著改**。`audit_world_edge` Ⅴ-b 用 `new Function` 執行 terrain.js
   的裙區塊;裙的 `uvOf` 改吃 `xzToLL` 之後漏了注入 ⇒ `ReferenceError`,而其餘每一條原文斷言
   照樣全綠。同一族:`audit_ground_qc` ⑦ 的 4 倍角**對照組** —— 公式搬進 `roadgrid.js` 之後,
   在 ground.js 原文上做字串替換變成無聲 no-op(對照組永遠通過 = 沒驗到),改成對
   `roadgrid.gridAngle` 的原文動刀並加一條「替換沒生效就紅字」的自檢。
4. **反向驗證的門檻不能跟著 `--break-*` 動**(CLAUDE.md §5.4 ㋑)。第一版把「去鋸齒下界」寫成
   `minStraightM()`,而它是 `MAX_DRIFT_M` 的函式 ⇒ `--break-drift` 把期望值一起放大。現在
   全部門檻在套旗標**之前**由 `BASE = { ...ROAD_GRID }` 快照定案。
5. **統計要選對**。全網 p50/p90 是**段數**加權,會被密路網的細碎段淹掉 —— 一整條沒被量化的長路
   在上面看不出來(`--break-dense` 下 p90 仍是 0.09°,而斜街整條 10.25° 沒被量化)。稽核因此改成
   **逐條 way 的中位數** + 長度加權平均雙軌。
6. `bake_venue_grid.mjs --only <不會成功的場地> --dry` 收尾會印一行 libuv assertion(Windows
   teardown 與待決 timer 的競態)。**純粹是離場噪音**,工具已經做完事、退出碼正確,不要去追。

---

## 7. 下一階段:路網中繼(使用者第二輪的提案)

### 7.1 它解的是什麼

今天每個客戶端各自抓 Overpass,A 抓到、B 被限流 ⇒ 兩台在建**不同的世界**(橋隧、建物、碰撞柱
全不一樣)。這是**既有問題**,不是旋轉帶進來的;`scheduleOsmRetry` 那 90 秒重試就是在跟它搏鬥。
中繼之後全房逐位元同一份路網,而且 Overpass 從「每人一次」變成「每房一次」。

### 7.2 這是兩件可以分開做的事

- **㈠ 路網中繼** —— 修跨客戶端分家(價值大於旋轉本身)。
- **㈡ 自訂地圖的主方位** —— 在 **mapSelect 掃描階段**多發一次 Overpass,寫進 `cfg.center.rot`。
  掃描本來就在連網(OSRM 直達 + 12 個側翼候選)、一次性、使用者主動觸發、輸出就是 battleConfig。

**㈠ 不含 ㈡**:開房當下房主自己也可能正被限流,那一房就 θ=0。**㈡ 不需要 ㈠**。
建議順序 **先 ㈠ 再 ㈡** —— ㈠ 落地後,㈡ 只剩「掃描末尾多發一個查詢並寫進 cfg」這一小塊。

### 7.3 payload 實測(決定了「不必壓縮」)

| 場地 (5v5) | km² | 道路 way | 原始 JSON | 只留下游會讀的欄位 + 6 位小數 | deflate |
|---|---|---|---|---|---|
| barcelona | 3.19 | 1954 | 783KB | 399KB | 71KB |
| paris | 3.88 | 1944 | 779KB | 392KB | 79KB |
| manhattan | 2.79 | 1919 | 639KB | 334KB | 54KB |
| shibuya | 2.54 | 1849 | 583KB | 340KB | 64KB |

`server.js` 現行 `maxPayload` = **2MiB**。**連原始 JSON 都塞得下** ⇒ 第一版不必壓縮、不必碰
`perMessageDeflate`、不必新增依賴(A2)。⚠ 上表**只量了道路**;`fetchOsmFeatures`(建物/鐵路/
POI)那一半沒量,要一起中繼的話 MUST 先補量。

### 7.4 動手前 MUST 先釘死的三條

1. **不能塞進 `sync`**。[main.js:2822](../public/js/main.js:2822) 註記 sync 會重播多次,
   400KB 乘上去不可接受。要走一次性訊息,而且 joiner 的 `startPrebuild` MUST **等它**;
   等不到才退回自己抓(= 退回今天的行為,仍是嚴格改善)。
2. **θ 一旦廣播就凍結**。房主 90 秒後重試成功、路網變好 ⇒ `startPrebuild` 會重建,但 θ
   **MUST NOT** 跟著改,否則整房的世界在選角途中轉一次。路網可以變,座標框不行
   (同 `rollSideSwap` 只准住房間階段的紀律)。
3. **房主是不可信輸入**。它今天已經在上傳權威的 `t:'world'`,所以信任模型沒變差;但中繼的
   東西要驗形狀與筆數上限,否則惡意房主可以讓每個 joiner 吃下任意大的陣列。雲端模式關房
   MUST 釋放(`--max-rooms` × 400KB)。

### 7.5 會動到的地方(範圍評估)

`server/rooms.js`(新訊息 + 房間狀態,**MUST 維持瀏覽器可執行**、MUST NOT import Node 內建 —— A28)、
`server/server.js`(驗證與上限)、`public/js/main.js`(預建時序改成等中繼)、
`public/js/biomes.js`(改吃注入的路網而非自己 fetch;geocache 仍要能命中)、
單機路徑(LocalNet 房主 = 自己,**物件參照不得共用** —— §2-A 的 `_serializeEnt` 前科)。
另需一支新稽核(或併進 `audit_net_modes`)釘住「θ 凍結」與「payload 上限」兩條。

### 7.6 還沒決定的

- 要不要連 `fetchOsmFeatures`(建物/鐵路/POI)一起中繼?**建議要**(分家問題一模一樣),
  但 payload 沒量過。
- joiner 等中繼的**逾時**要多久?太短等於沒接、太長會卡住進房。
- 中繼下來的路網要不要寫進 joiner 自己的 geocache?(寫了下一場免等,但要確認 bbox 鍵一致)
