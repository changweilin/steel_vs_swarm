# 地圖主方位旋轉 + 道路 16 方向量化 —— 交接

> **定位**:這份文件只裝「沒有別的家」的東西 —— 使用者定案的原句、當輪的實測數字、被排除的
> 選項與排除理由、未驗項、下一階段還沒釘死的問題。
> **設計與禁令不在這裡**:單一真相縫索引三列 + A42 + 驗證矩陣兩列住 [`/CLAUDE.md`](../CLAUDE.md);
> 逐項斷言、幾何推導、壞掉時的症狀敘事住 [`tools/audit_road_grid.mjs`](../tools/audit_road_grid.mjs)
> 與 [`public/js/roadgrid.js`](../public/js/roadgrid.js) 的檔頭。**改東西前先開那兩支,不要從本檔重建。**

**第一階段**(旋轉 + 量化)分支 `claude/map-road-grid-alignment-85b69e`,已併入 main(PR #186)。
**第二階段**(路網中繼)與**第三階段**(自訂地圖主方位)分支 `claude/map-grid-alignment-03c4a1`。
基準日 2026-08-10。

---

## 1. 使用者定案(原句)

**第一輪**
> 「處理圖資時先找出地圖上下左右對準哪一個方向時,可以對齊最多的大馬路組成正交網格,接著將
> 所有道路量化成 16 個方向,同時盡可能避免讓道路變成鋸齒,這樣道路拼圖可以透過這 16 個方向
> 簡化並無縫準確貼合對齊,建築也更容易對齊排列。」

追問「是真的把世界轉過來,還是只用那個角度當 16 方向的錨?」→ 定案 **真的旋轉整張地圖**;
量化對象定案 **只有 `osmRoads`**(鐵路/兵線/建物輪廓皆不動)。

**第二輪**(已落地,見 §2.2 / §7)
> 「圖資儲存在開房者,再由開房者透過 server 傳給入房者?」

---

## 2. 已落地

### 2.1 第一階段:旋轉 + 量化

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

### 2.2 第二階段:路網中繼(§7 的 ㈠)

| 檔案 | 內容 |
|---|---|
| `public/js/osmrelay.js` | **新**,零 import、**零模組級可變狀態**。payload 的形狀/上限唯一定義:`OSM_RELAY`、`osmRelayKey()`、`sanitizeOsmRelay()`(冪等)、`osmRelayFit()`(位元組封頂) |
| `public/js/biomes.js` | 本輪 OSM 輸入的**定案表**(`commitOsmIn`/`osmInOf`/`osmInReady`/`resetOsmMisses`)+ 兩支 fetcher 的中繼早退(排在 `geoGet` 之前) |
| `public/js/main.js` | `osmGate()`(房主抓+送 / 入房者等,與地形建構並行)、`onOsmRelay()`、`NET_HANDLERS.osm`;`scheduleOsmRetry` 成功後 `resetOsmMisses()` |
| `server/rooms.js` | `t:'osm'` 分支(只受理房主・淨化・**逐格單調**・轉播)+ `osmPayload()`(joinRoom / reattach 補送)+ `room.osm` |
| `server/server.js` | `maxPayload` 註解補上中繼那一則的實測與「兩邊上限要一起看」 |
| `tools/audit_osm_relay.mjs` | **新**,70 項 + 四支反向驗證;含起真 `RoomHub` 的行為直測 |
| `tools/measure_osm_relay.mjs` | **新**(㋓):payload 實測,查詢字串取自 `biomes.js` 執行原文(不是抄的)|
| `tools/audit_src.mjs` | 新增 `grabBlock()`(抽訊息分派分支的原文;原本只有方法/頂層函式/const 三支定位得到) |
| `test/e2e.mjs` | WS 段加一輪真傳輸層來回(轉播 / 單調 / 晚到者補送) |

**沒有動到的東西**:θ 的來源與凍結方式(仍是 `venueGrid.js` 離線烘焙 → `battleConfig`,中繼一個位元都不碰座標框);
`geocache.js` 的入庫條件;平衡數值與 `sim.js` 一行未改。

### 2.3 第三階段:自訂地圖的主方位(§7 的 ㈡)

| 檔案 | 內容 |
|---|---|
| `public/js/roadgrid.js` | **`GRID_HW`**(取樣面 = 大馬路;`.source` 就是 Overpass 查詢字串)+ **`roadGridRotDeg(ways, toXZ)`**(「一組 way → 旋轉度數」的唯一縫:取樣面 + 未旋轉量測框 + 取負號三件事綁在一起) |
| `tools/bake_venue_grid.mjs` | 改吃上面那一支;**抓取範圍改在 rot=0 的框裡算**(修掉「重烤不冪等」,見 §6.7) |
| `public/js/biomes.js` | **新** `fetchGridRoads(bbox)`:大馬路查詢(`out geom 900`,同烘焙)+ geocache |
| `public/js/main.js` | **新** `resolveMapRot(cfg)`,呼叫點**恰一處** = 「存入最愛」按鈕;鈕面顯示量到的角度 |
| `tools/audit_road_grid.mjs` | 新增 Ⅸ 段(兩條產線 / 冪等 / 執行期量測只准在存最愛那一次)+ `--break-rotbox`/`--break-rotover` |

**為什麼是「存入最愛」那一刻**:手動點選的地圖**一定**要存成最愛才開得了房
(`createRoomBtn` 只吃 `app.favCfg`)⇒ 那一刻涵蓋 100% 的自訂地圖路徑,而且是使用者主動觸發、
一次性、由房主自己做、輸出直接寫進 battleConfig 廣播全房。**舊的「我的最愛」刻意不追溯量測**
(在開戰時刻畫面再加一次網路依賴,換來的只是舊存檔轉個角度)—— 它們維持 rot=0。

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

**烘焙結果可用現實驗證**:manhattan −28.995°、chicago −0.003°、barcelona 42.803°、kyoto −2.542°、
shibuya 14.527° —— 與這幾座城市真實的街廓方位對得上。**烘焙是冪等的(§6.7 修好之後),
重烤 MUST 逐一吻合這五個值**;跑出別的數字就是有人動到抓取範圍、量測框或取樣面。

**未烘焙的場地只有 `uluru`**,理由是「此範圍沒有大馬路」(澳洲內陸巨岩)—— 這是**正確結果**
不是烘焙失敗,`rot=0` 就是它該有的樣子。MUST NOT 為了湊滿 29 個而放寬取樣面。

**旋轉對世界方框的影響**(全 29 場地 × 3 人數 × 6 角度):面積比 1.000~1.70×,只增不減。
高程磚數上限 4(守衛 16,不必動)。

**地被拼圖的全圖主方位 `ground.js gridA`**(取樣面 = **全部**道路,與烘焙的「只收大馬路」不同):

| 場地 | 地圖 rot | gridA 未旋轉 | 旋轉後 | 旋轉 + 量化後 |
|---|---|---|---|---|
| manhattan | −29.00° | 28.62° | −0.37° | **−0.33°** |
| barcelona | 42.80° | −38.93° | 3.88° | **3.79°** |
| shibuya | 14.53° | −22.59° | −8.07° | **−6.19°** |

拼圖的朝向沒有獨立的來源:`orient()` 三段退避(最近路向 → 同街區幹道 → `gridA`)全都由**世界座標的
道路折線**推出來,而那份折線在 `buildBiomes` 早就旋轉並量化過 ⇒ 拼圖自動跟著新角度。
**殘量是預期的**:世界軸對齊的是**大馬路**,而 `gridA` 收的是全部道路(巷弄/步道/產業道路);
shibuya 的 −6.19° 就是東京街廓本來就沒那麼正交 + 小路把平均拉走,不是漏轉。

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

**已補驗(㋓,2026-08-10)**
- `audit_traverse` **全 29 場地跑過了**(非降級,真的抓到圖資):**117 綠 / 21 紅**,而拿
  `git archive main` 的乾淨樹(共用同一份 `tools/.scen_cache` ⇒ 圖資輸入相同)跑同一批,
  **逐條斷言完全相同** ⇒ 那 21 條是既有紅字,不是這幾輪改出來的。可站立節點數差 ≤12 格
  (150k~414k 中的 0.005%),結構數與開挖走廊數逐場地相同 —— 本來就不是斷言的對象
  (稽核檔頭:「斷言的是航點清單不是格數」)。
- 21 條紅字的形狀:**「橋面中段不可達」+「橋下淨空 < 4.70m」**(shibuya / paris / yosemite /
  giza / venice / civicblvd / roppongi / london / chicago)加上 taroko 的「隧道洞中/洞口B」。
  全部落在**橋與洞**這兩族 —— 是稽核端的泛洪/夾制議題,不是遊戲破圖。
  **要修是另一個題目,MUST NOT 混進本輪。**
- **順手把第一階段的那一題也結掉了**:再拿 `git archive 0afe260`(旋轉合併**之前**)的樹跑同一批
  (同一份 `.scen_cache` ⇒ 圖資輸入相同),得 **112 綠 / 26 紅**。也就是旋轉 + 量化讓紅字
  **26 → 21**:tamsui / taipei101 / rio / manhattan / hehuanshan / berlin **六張圖整場轉綠**,
  paris 2→1、civicblvd 4→3;shibuya 2→4、giza 3→4 變多。
  **失敗的「種類」一條都沒有變**(仍然只有橋面中段 / 橋下淨空 / 隧道那三族)—— 變的是**被檢查的
  航點集合本身**(量化會併/改橋 way ⇒ shibuya 航點 30→34、giza 15→25、paris 26→16)。
  結論:旋轉沒有引入新的不可通行模式,總量還變好了。

**⚠ 旋轉的遺留:`VENUES[].relief` 沒有跟著重產生(2026-08-10 補驗才發現)**

`audit_lane_scenarios` 全 29 場地:**9/9 種場景都有預設場地**(退出碼的判準),但**標記不符 14**。
三棵樹對照(同一份 `.scen_cache`):

| 樹 | 標記不符 |
|---|---|
| `0afe260`(旋轉前)| **2**(civicblvd 漏標 bridge、roppongi 多標 underpass)|
| `main` | 14 |
| 本輪(第二・三階段)| 14 —— **與 main 逐條相同** |

旋轉後多出來的 **12 條全部是 `relief` 數值**(場景標記一條都沒多):seoul 23→22、yangmingshan 28→27、
aokigahara 22→23、blackforest 21→26、yosemite 17→16、giza 35→36、iguazu 23→26、tamsui 25→21、
okavango 8→9、rio 73→72、crimea 31→32、**taroko 416→371**。

**成因**:`relief` 是**實測**的起伏值,而旋轉讓 `battleBBox` 長大 ⇒ 取樣範圍變了。CLAUDE.md 明訂
`scen`/`relief` MUST 由實測產生、且改 `battleBBox` 一族要**重烤**(§5.5)—— PR #186 漏了這一步。
消費端是場地選單的地形說明(`reliefTier`/`RELIEF_TIERS`/`venueBrief`),症狀是「選單上的起伏描述
與實際差一階」。**刻意不併進本輪**:它是 main 的既有偏差(本輪逐條相同),而且 12 條裡有 8 條只差 1
—— 直接寫進去等於把一次量測的雜訊固化;taroko 差 11% 才是該先看一眼的那一個。

**完整版 `audit_venue_biome`**:4 過 / 1 敗 —— Ⅲ「12 個場地的手寫 `mix` 與圖資實測不符」。
本輪**不可能**造成它:那支只 import `venues.js` / `data.js` / `venue_field.mjs`(三支都沒動)+
`audit_src.mjs`(純追加),Ⅱ/Ⅲ 的資料是它自己去抓的。CI 也只收 `--offline` 那一半(Ⅰ 段全綠),
而該支檔頭自陳 `TOL` 是「挑出該看的圖,不是判死」。

**需外網 / 真瀏覽器(㋓ / ㋕)**
- 真機看一張旋轉過的市區圖(建議 manhattan 或 barcelona:主方位大、效果最明顯)
- **路網中繼的兩台同房實測**:一台開房、一台入房,比對橋隧與建物是否逐項一致。中繼壞掉的
  症狀是「你說的那座橋我這邊沒有」—— 單機與單一客戶端的測試永遠看不到它。同場再看
  「房主被限流、90 秒後補抓成功」那條路徑(入房者要在房間階段自動重建成同一份)。

**與本次無關的既有紅字**(已在 main 上覆核,不要誤修)
- `audit_touch_layout`:667×375 橫式,main 上就是紅的
- `audit_lane_grade_sep`:此 worktree 缺 `tools/.osm_cache` 目錄而拋 ENOENT

**第二・三階段已跑過且全綠**:`audit_road_grid`(62 項,±五支 `--break-*`)、
`bake_venue_grid --dry` 重烤 5 個場地與現值逐一吻合(冪等)、`audit_osm_relay`(70 項,±四支 `--break-*` 皆咬得住)、
`npm test`(先重啟過伺服器;含新增的 WS 中繼來回)、`npm run bal`、`npm run audit:net`、
`audit_solo_boot`、`audit_client_syntax`、`audit_road_grid`、`audit_siteplan`、`audit_beacons`、
`audit_world_text`、`audit_ui_layout`、`audit_open_tunnel`、`audit_underpass`、`audit_road_joint`、
`audit_road_bed`、`audit_object_joints`。

**第一階段已跑過且全綠**:`npm test`(先重啟過伺服器)、`npm run bal`、`audit_road_grid`(±三支
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
7. **烘焙曾經不是冪等的**(2026-08-10 第三階段才發現、已修)。`bakeOne` 拿 `venueConfig(v, 1)`
   的 cfg 去算 `battleBBox` —— 而那份 cfg 的 `center.rot` 是**上一輪烤出來的值**,旋轉只會讓
   方框長大(實測 shibuya ×1.77、barcelona ×2.27)⇒ 第二輪在大得多的區域上取樣,角度自己漂
   (實測 shibuya **14.53° → 19.49°**)。三個檔案都沒改、所有稽核照樣全綠,而重烤一次整張圖
   就轉了 5 度。**抓取範圍與量測框 MUST 是同一條規則:兩者都在 rot=0 的框裡**。
   修好之後重烤 5 個場地與 `venueGrid.js` 現值逐一吻合(manhattan −28.995 / barcelona 42.803 /
   shibuya 14.527 / kyoto −2.542 / chicago −0.003)—— 這也順帶證明了把推導收進
   `roadGridRotDeg()` 是逐位元的 no-op(同一份資料上新舊兩式相同,已直測)。

---

## 7. 路網中繼(使用者第二輪的提案)—— ㈠㈡ **皆已落地**

### 7.1 它解的是什麼

今天每個客戶端各自抓 Overpass,A 抓到、B 被限流 ⇒ 兩台在建**不同的世界**(橋隧、建物、碰撞柱
全不一樣)。這是**既有問題**,不是旋轉帶進來的;`scheduleOsmRetry` 那 90 秒重試就是在跟它搏鬥。
中繼之後全房逐位元同一份路網,而且 Overpass 從「每人一次」變成「每房一次」。

### 7.2 這是兩件可以分開做的事

- **㈠ 路網中繼** —— 修跨客戶端分家(價值大於旋轉本身)。**已落地**,見 §2.2 / §7.7。
- **㈡ 自訂地圖的主方位** —— **已落地**,見 §2.3。落點從「掃描階段」挪到**存入最愛那一刻**:
  掃描時 `center` 還沒定案(它是 A 與所選候選點 B 的中點),而手動地圖一定要存成最愛才開得了房
  ⇒ 那一刻同樣是一次性、使用者主動觸發、輸出就是 battleConfig,而且涵蓋 100% 的自訂地圖路徑。

**㈠ 不含 ㈡**:開房當下房主自己也可能正被限流,那一房就 θ=0。**㈡ 不需要 ㈠**。

### 7.3 payload 實測(決定了「不必壓縮」)

| 場地 (5v5) | km² | 道路 way | 原始 JSON | 只留下游會讀的欄位 + 6 位小數 | deflate |
|---|---|---|---|---|---|
| barcelona | 3.19 | 1954 | 783KB | 399KB | 71KB |
| paris | 3.88 | 1944 | 779KB | 392KB | 79KB |
| manhattan | 2.79 | 1919 | 639KB | 334KB | 54KB |
| shibuya | 2.54 | 1849 | 583KB | 340KB | 64KB |

**整則中繼訊息(道路 + 建物/鐵路/POI)的實測**(`node tools/measure_osm_relay.mjs`,5v5;
查詢字串取自 `biomes.js` 執行原文,不是抄的):

| 場地 (5v5) | km² | 道路 way | 建物 | 原始 JSON | 中繼訊息 | vs maxPayload |
|---|---|---|---|---|---|---|
| paris | 3.88 | 1946 | 1200 | 1070KB | **1068KB** | 1.9× |
| barcelona | 3.19 | 1954 | 1200 | 1053KB | **1051KB** | 1.9× |
| manhattan | 2.79 | 1919 | 1200 | 972KB | 972KB | 2.1× |

`server.js` 現行 `maxPayload` = **2MiB** ⇒ **連原始 JSON 都塞得下**(淨化在 `DP = 7` 下對真圖資是
恆等,所以「原始」與「中繼訊息」幾乎一樣大)⇒ 不必壓縮、不必碰 `perMessageDeflate`、不必新增
依賴(A2)。客戶端另有 `OSM_RELAY.MAX_BYTES`(1758KB,**餘裕 1.6×**)自我封頂:超過先丟 `feats`
保住路網,再超過就整份放棄。**MUST NOT 直接硬送**:`ws` 對超過 maxPayload 的訊框是以 1009
直接斷線,斷的是**房主**的連線,而症狀看起來完全像「伺服器壞了」。
⚠ **餘裕不厚**(1.9× / 1.6×,而 OSM 資料只會長大):掉到 1.5× 以下就要回頭看兩個上限。
超限退化(丟 feats)因此**會 toast 給房主看** —— 那一刻建物/招牌又回到「每台各自抓」。

### 7.4 動手前 MUST 先釘死的三條(**全部已落實**,現為驗收條件)

1. **不能塞進 `sync`**。[main.js:2822](../public/js/main.js:2822) 註記 sync 會重播多次,
   400KB 乘上去不可接受。要走一次性訊息,而且 joiner 的 `startPrebuild` MUST **等它**;
   等不到才退回自己抓(= 退回今天的行為,仍是嚴格改善)。
   → 落地為 `t:'osm'` 一次性訊息 + `main.osmGate` 的等待閘(`OSM_RELAY.WAIT_MS` 20s)。
2. **θ 一旦廣播就凍結**。房主 90 秒後重試成功、路網變好 ⇒ `startPrebuild` 會重建,但 θ
   **MUST NOT** 跟著改,否則整房的世界在選角途中轉一次。路網可以變,座標框不行
   (同 `rollSideSwap` 只准住房間階段的紀律)。
   → 落地為**結構性保證**:中繼 payload 只有 `{bbox, feats, roads}`,`osmrelay.js` 全檔沒有
   `rot`/`center`,伺服器的 `t:'osm'` 分支碰不到 `battleConfig`(三條都由稽核釘住)。
3. **房主是不可信輸入**。它今天已經在上傳權威的 `t:'world'`,所以信任模型沒變差;但中繼的
   東西要驗形狀與筆數上限,否則惡意房主可以讓每個 joiner 吃下任意大的陣列。雲端模式關房
   MUST 釋放(`--max-rooms` × 400KB)。
   → 落地為 `sanitizeOsmRelay`(兩端同吃)+ `room.osm` 只掛在 room 物件上(清房即回收)。

### 7.5 會動到的地方(範圍評估)—— 實際動到的見 §2.2

`server/rooms.js`(新訊息 + 房間狀態,**MUST 維持瀏覽器可執行**、MUST NOT import Node 內建 —— A28)、
`server/server.js`(驗證與上限)、`public/js/main.js`(預建時序改成等中繼)、
`public/js/biomes.js`(改吃注入的路網而非自己 fetch;geocache 仍要能命中)、
單機路徑(LocalNet 房主 = 自己,**物件參照不得共用** —— §2-A 的 `_serializeEnt` 前科)。
另需一支新稽核(或併進 `audit_net_modes`)釘住「θ 凍結」與「payload 上限」兩條。
→ 新稽核**獨立成一支** `audit_osm_relay`(併進 `audit_net_modes` 會把那支的主題稀釋掉:
它管的是「三種機制共用同一套架構」,而中繼是一條訊息的正確性)。

### 7.6 §7.6 三個待決問題的定案(2026-08-10)

| 問題 | 定案 | 理由 |
|---|---|---|
| 要不要連 `fetchOsmFeatures`(建物/鐵路/POI)一起中繼? | **要**,同一則訊息兩格 | 分家問題一模一樣(建物碰撞柱、街廓朝向、招牌都在那一半);逐格獨立定案 ⇒ 房主只抓到一半時另一半仍可各自降級 |
| joiner 等中繼的逾時多久? | **20s**(`OSM_RELAY.WAIT_MS`) | 健康鏡像實測 1.5~10s(`biomes.js OVERPASS_TRY` 檔頭),20s 蓋得住「先踩到壞鏡像再輪到好的」;再等下去房主多半是整組失敗,而 joiner 退回自己抓很可能是 geocache 直接命中(零網路)。等待與地形建構並行 ⇒ 這段時間絕大多數是免費的 |
| 中繼下來的路網要不要寫進 joiner 的 geocache? | **不寫** | 來源是房主 = 不可信輸入。持久化它會污染這台機器**之後每一場**(含它自己當房主的那一場),而 geocache 的紀律正是「只准存自己完整抓到的東西」。代價只是「下一場還要等一次中繼」,而中繼很快 |

另外兩個當輪才浮現、也一併定案的:

- **精度**:`DP = 7` = OSM 節點原生精度 ⇒ 淨化對真實圖資是**恆等變換**。降到 6 位可以把 payload
  砍半,但那會讓「開了中繼」與「中繼逾時退回自己抓」建出兩張略微不同的地圖 —— 小到剛好測不
  出來,而破圖照樣發生。payload 用不著省(§7.3)。
- **重送**:伺服器**逐格單調**(已定案的格 MUST NOT 被覆蓋)。房主 90 秒後重試成功會再送一次;
  讓新的蓋掉舊的 = 早進房的人用 v1、晚進房的人用 v2,那正是中繼要修的病換了個發生地點。
  「從無到有」則允許 —— 補上來的那一格會讓收件端在**房間階段**重建一次(與 `scheduleOsmRetry`
  同一個既有慣用法),`loading` 之後不重建(會把全房卡在載入畫面)。

### 7.7 這一輪踩到的坑(路網中繼)

1. **房主自己吃哪一份**。最自然的寫法是「房主照舊自己抓、順手送一份出去」—— 那樣房主吃原始
   圖資、入房者吃淨化後的,中繼等於白做。所以閘門是先 `warmOsm` → 淨化 → **把淨化後的那一份
   寫回自己的定案表** → 才送出。
2. **「查過且沒有」必須是一種狀態**。定案表只有兩態(有 / 沒有)的話,房主抓不到的那一格會在
   `buildBiomes` 裡**再吃一整份逾時預算**(24~30s)。三態(`undefined` 未定案 / `null` 查過沒有 /
   資料)解掉;代價是房間階段補抓成功後 MUST `resetOsmMisses()` 把 null 退回未定案,否則第一輪
   的失敗會把自己永久鎖死 —— **重試看起來還在跑,但永遠不生效**。
3. **入房者不能等第二次**。中繼晚到會觸發重建,而重建又會經過閘門;閘門若仍要求「兩格都到齊」
   才放行,那一次重建會抱著已到手的資料乾等 20 秒。入房者的閘門因此問的是「**有沒有收到任何
   一格**」。
4. **模組級狀態會被單機模式共用**。`osmrelay.js` 同時被 `main.js` 與 `server/rooms.js` import,
   而單機的 `RoomHub` 就跑在同一個分頁裡 ⇒ 那是**同一個模組實例**。store 因此 MUST 住 `biomes.js`
   (rooms.js 永遠不會 import 那一支),`osmrelay.js` 維持純函式 + 常數。
5. **稽核測資自己要夠真**。「淨化對真實圖資是恆等」這條斷言第一版是紅的 —— 因為測資用
   `25.0334567 + i * 1e-5` 累加,生出第 8 位以後的浮點尾巴。座標 MUST 由**整數奈度**組出來
   (`250334567 / 1e7`),那才是 OSM 真的存的刻度。
6. **1v1 房的第三個 client 進不去**。行為直測裡的「晚到者」要用 `mode: 'spectator'`,
   否則被席位上限擋掉,而症狀看起來像「補送壞了」。

### 7.8 還沒做 / 還沒量的

- **舊的「我的最愛」維持 rot = 0**(刻意,見 §2.3)。要追溯的話得在開戰時刻畫面加一次網路依賴。
- payload 已補量(§7.3),**餘裕只有 1.9× / 1.6×**。這不是待辦而是待觀察:OSM 只會長大,
  下次動這一族時 MUST 重跑 `tools/measure_osm_relay.mjs`。
- 中繼**沒有進度回饋**:入房者等中繼的那段時間,預載狀態列顯示的仍是模型/地形的進度。
  等待與地形建構並行 ⇒ 一般看不出來;房主整組失敗時入房者會多停最多 20 秒而畫面沒說明。
- 自訂地圖的主方位**沒有真機走過一次**(㋕):存最愛時多一次 Overpass(大馬路,`out geom 900`),
  要看的是「有量到角度時 toast 會印出來、之後開房建圖真的轉了」。離線稽核只驗得到接線與紀律。
