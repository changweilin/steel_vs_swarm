# lane-zonecut 交付(序 13 / §0-a 線工切面可行性樁)

> 本輪落地檔案:`tools/zonecut.mjs`(新)・`tools/audit_zone_cut.mjs`(新)・
> `tools/venue_field.mjs`(新增 `cutLinesFor` + 收進四支結構清單函式)・
> `tools/audit_traverse.mjs`(那四支改 import;純搬家)・`tools/logo_lib.mjs`(`encodePNG` 拆出 `pngBytes`)。
> **`public/**` 與 `server/**` 一行未動。**

---

## ① `seams-*.md` 要新增/修訂的那一列原文

### `.claude/rules/seams-terrain.md` —— 新增一列(接在「離線工具的地形圖資剖面」之後)

| 領域 | 唯一縫 | 鐵律 / 稽核 |
|---|---|---|
| 線工切面(§0-a 的第一段;**目前只有可行性樁**) | 規則本體 `tools/zonecut.mjs`(`NO_FACE`/`rasterLines`/`floodFaces`/`assignWallTexels`/`faceAreas`/`faceAdjacency`/`mergeSmall`/`faceSamples`/`canonicalFaces`)+ 線工組裝與逐面標籤 `tools/audit_zone_cut.mjs`;線的來源 `venue_field.osmFor`/`landcoverFor`/**`cutLinesFor`**;投影 `data.llToXZ`(含 A42)+ `roadgrid.quantizeRoads` | 2026-08-16。**零 import / 零亂數 / 純函式**(同 `roadgrid.js`/`wallpanel.js`/`edgewall.js`)—— 序 14 若成立,第一步是把它**原封改名**成 `public/js/zonecut.js`,零 import 是那一步只是一次改名的前提。①**泛洪 MUST 是 4 鄰**(8 鄰會讓兩個只在對角相碰的面漏成一面,而報告上只表現成「面數少了幾個」);**牆 texel 的併回反過來用 8 鄰** —— 那是「離哪個面近」不是「是不是同一個面」。②**face id 是掃描順序的函式,MUST NOT 是輸入順序的函式**:下游任何一處拿 id 當種子,兩台客戶端只要 ways 陣列順序差一格就建出不同的世界,而單機跑一百次都是對的;稽核 MUST **同時**驗「分割」(`canonicalFaces` 正規化指紋)與「**id 編號**」兩件事 —— 前者對重排是不變量,只驗它的話 `--break-order` 永遠是綠的。③**小面併鄰 MUST 比「那個鄰居」的面積**,MUST NOT 比佔全體的比例(A46 ⑨ ㋐ 的同一條:曲面體側面每片等面積 ⇒ 比值恆 1 ⇒ 結構上併不掉;比佔全體會把一根 36 面圓柱整根抹平);**共邊**才算相鄰、**小的貼上大的**。④**牆併回 MUST 排在小面併鄰之前** —— 面與面之間隔著牆 ⇒ 鄰接表**整份是空的**、一次都併不掉,而回報上只表現成「這張圖剛好沒有碎面」(2026-08-16 實測 taroko 1024²:238 面、面積下限 326 texel、併 0 次)。⑤**逐面取樣是決定性的分層取樣**,零亂數且 MUST NOT 拿 face id 當種子。⑥切面的**坡度等值線門檻 MUST 取 `SLOPE.EASE_DEG`/`BLOCK_DEG`**,MUST NOT 沿用 `cellZoneAt` 手寫的 0.28/0.75(= 15.64°/36.87°;那是**標籤覆寫**門檻,與**切面的線**是兩件事);坡度量**裸地形**、取樣距 MUST = 地形格距。⑦線的投影 MUST 走 `data.llToXZ` 並先過 `roadgrid.quantizeRoads`,**MUST NOT** 用 `venue_field.llToWorld`(那是 **pre-A42 的手抄**,全檔 grep 不到 `rot`/`mapRot`)—— 實測 barcelona(θ 42.8°)界線離真值中位距離由 2.75m 變成 37.93m。⑧**結構足跡是 keep-out**(隧道/地下道 `hw + STRUCT_CLEAR_PAD`、橋 `hw + 4`,推導不手寫);明隧道柱列帶在 Node 端拿不到 ⇒ MUST 標未驗。稽核 `audit_zone_cut` ±`--break-quantize`/`--break-slope`/`--break-merge`/`--break-order`/`--break-rnd`/`--break-keepout`/`--break-id`/`--break-label` |

### `.claude/rules/seams-terrain.md` —— 修訂「離線工具的地形/圖資/結構剖面」那一列

在該列「鐵律」欄尾端追加:

> **結構清單也住這裡**(2026-08-16 由 `audit_traverse.mjs` 搬進來):`buildStructs`/`projectArc`/`ptAt`/`sampleAlong` —— §0-a 線工切面樁要的「結構足跡 keep-out」與泛洪要的是**同一份**結構清單,抄第二份就是這一支存在的理由被繞過。另新增 `cutLinesFor(id, bbox)`(行政界 + 海岸線,自己的快取鍵 `_cutlines_v2`)—— **MUST NOT 併進 `osmFor`/`landcoverFor`**(那兩本快取是掃描稽核與 `audit_venue_biome` 的貴重資產,改查詢就得換鍵整批重抓)。⚠ **行政界在 OSM 裡是 relation 不是 way**:實測 barcelona 戰場 bbox 內 `way["boundary"="administrative"]` 回 **0 條**而 `rel[…]` 回 **41 個**(成員 way 通常不帶 `boundary` 標籤)⇒ 查 way 就是「這張圖沒有行政界」而每一個數字看起來都正常;本支查 relation 再以 `way(r)` 展開。

### `tools/CLAUDE.md` —— 家族地圖(122 → 124)要改的兩列 + 新增一列

`venue_field.mjs` 那一列的「用途」欄改成:

> Node 端取得「與執行期同形」地形 / 圖資 / **結構清單**的**唯一縫**;消費端 MUST 走它,MUST NOT 各自再抄一份。2026-08-16 收進 `buildStructs`/`projectArc`/`ptAt`/`sampleAlong`(原住 `audit_traverse.mjs`)與 `cutLinesFor`(行政界 + 海岸線;**行政界在 OSM 是 relation 不是 way**)

新增一列(接在 `audit_src.mjs` 之後):

| 家族 | 數量 | 用途 |
|---|---|---|
| `zonecut.mjs` | 1 | §0-a 線工切面的**規則本體**(光柵化 / 4 鄰泛洪 / 小面併鄰 / 決定性分層取樣)。**零 import、零亂數、純函式** —— 序 14 若成立,第一步是把它**原封改名**成 `public/js/zonecut.js` 讓遊戲端與離線工具同吃一份定義(同 `roadgrid.js`/`wallpanel.js`/`edgewall.js`/`osmrelay.js` 的家族),零 import 是那一步只是一次改名的前提 |

「寫 / 改稽核的五條紀律」建議追加第 6 條:

> 6. **反向驗證 MUST 檢查自己的「適用性」**:一支 `--break-*` 如果在某些輸入上壞版與好版逐位元相同(例:`--break-keepout` 挑到沒有結構的場地、`--break-quantize` 挑到 θ = 0 的場地),它會**看起來全綠**而壞版根本沒被造出來。挑錯輸入 MUST **當場停並說明該挑什麼**,MUST NOT 讓它報綠 —— 這是紀律 2「替換無效 MUST 當場失敗」在**資料端**的同一條。

---

## ② `verification.md` 要加的指令與對照列

### §5.1(續)離線稽核清單 —— 加在 `audit_slope_move` 之後

```bash
node tools/audit_zone_cut.mjs           # §0-a 線工切面可行性樁(Ⅰ~Ⅴ 離線;CI 收得到)
#   --census                            # 只印 29 場地普查(序 14 貼圖規格的論據)
#   --venue <id> --team <n> [--tex 2048] [--png] [--sweep-rank] [--sweep-areamin]
#   ±--break-quantize(MUST 挑**市區**場地驗)/--break-slope/--break-merge/--break-order
#   ±--break-rnd/--break-keepout/--break-id/--break-label
```

`--venue` 那一段需外網或 `tools/.scen_cache`(㋓);沒有 `--venue` 時只跑離線的 Ⅰ~Ⅴ。

### §5.5 對照表 —— 新增一列

| 改動 | 驗證 |
|---|---|
| 線工切面(`tools/zonecut.mjs` 全檔 / `audit_zone_cut.mjs` / `venue_field.cutLinesFor` / `venue_field` 的 `buildStructs`·`projectArc`·`ptAt`·`sampleAlong` / `ground.js cellZoneAt` 的**判定順序**) | `audit_zone_cut` ±**八支** `--break`(每一支 MUST 對應紅字;`--break-quantize` MUST 挑市區場地 —— 山區的界線多半來自坡度等值線、不經投影 ⇒ 壞版在那裡咬不動)+ `audit_traverse`(四支函式搬家 ⇒ **MUST 做 A/B**:`--only=<有快取的場地> --json=` 前後比對。⚠ **`cells` 欄天生非決定性** —— `BattleSim` 建構期以 `Math.random()` 擺第三方野營碉堡 ⇒ `sim.solidResolve` 每次看到的障礙不同,實測 barcelona 同一份程式碼三次跑出 319591/319585/319579;比對 MUST 排除該欄,或改用 `buildStructs` 輸出的雜湊)+ `audit_underpass`/`audit_venue_biome --offline`/`audit_lane_scenarios`(㋓;venue_field 的既有 export 一格未動 ⇒ MUST 逐項不變)+ ground 那一批(`ground_tile`/`ground_qc`/`ground_seam`/`ground_enclave`/`ground_border`)+ `siteplan`/`beacons`/`object_joints --seeds 8`/`road_grid`/`slope_move`/`cel_pipeline`/`client_syntax`/`solo_boot`(讀的是同一份 ground.js/biomes.js 原文,而原文沒改 ⇒ MUST 逐項不變)+ **`npm run bal` / `npm test` MUST 逐項不動**(`public/**` 與 `server/**` 一行未改;`git diff --stat -- public/ server/` MUST 為空)+ 改 `logo_lib.encodePNG` MUST 重跑 `flatten_logo`/`split_logo`/`compose_logo` 比對 md5(⚠ 那三支的 `OUT_DIR` 是**寫死的絕對路徑**,指向出貨儲存庫的 `public/assets` —— 在 worktree 裡跑會寫到別的儲存庫去;2026-08-16 改採**原文層 A/B**:抽 `git show HEAD:tools/logo_lib.mjs` 的舊 `encodePNG` 原文、以樁掉的 `writeFileSync` 捕捉位元組,與新的 `pngBytes` 逐位元比對) |

---

## ③ 根 `CLAUDE.md` §2.1 目錄要加的主題名

`seams-terrain.md`(§2.1 E)那一列的「涵蓋的縫」尾端加:

> ・**線工切面(§0-a 可行性樁)**

---

## ④ `anime_style_plan.md` 執行紀錄 / 計畫更正

### §0-a「最大可行範圍」那張表 —— **三處量錯,MUST 更正**

| 量 | 計畫寫的 | **實測** |
|---|---|---|
| 現制 zoneGrid 尺寸 | 37×37(迷你)~ **93×93**(L3) | **最大 189×158**(paris 3v3)—— 93×93 量的是**可玩邊長 1200m**,而 `buildGroundCover` 吃的是 `terrain.worldW/worldH` = **`battleRect`**(含 `ROUTE_EDGE_MARGIN` + `MAP_EXPAND`),差 1.6~1.9 倍 |
| L3 實際畫出來的地面 | 2111 m 見方 | **3361.7 m**(paris 3v3:world 2450×2054 + 裙 455.6/側) |
| 1024² 的解析度 | 2.06 m/texel | **3.28 m/texel**(2048² = **1.64**) |
| 現制 `cell` | `max(13, maxSide/232)` ⇒ 恆 13 m | ✅ 正確(實測 29 場地 × 三種人數全部恰 13.00;232 那條上限要到 3016 m 邊長才咬得到,實測最大 2450 m) |

⇒ **建議值仍是 1024² RGBA8**,但論據要換成「3.28 m/texel 仍比現制的 13 m 格細 4.0 倍」而不是 6.3 倍;
要拿到計畫原本宣稱的 2.06 m/texel 需要 **1638²** ⇒ 實務上是 2048²(1.64 m/texel、16 MB)。
「2048² 是 WebGL2 保證可用的下限」那一句不變。

### §0-a 第一段(線工)—— 三處補充

1. **行政界那一列**:`boundary=administrative` 在 OSM 是 **relation**,查 way 恆 0 條(見 ① 的縫表)。
2. **行政界「低優先」是對的,而且比計畫想的更極端**:實測採用率(附近 40 m 內沒有其他參與線才採用)
   rio **0.0%**(0/10512)、barcelona **1.7%**(17/1028)、shibuya **7.3%**(159/2175)
   ⇒ 它幾乎全部是重複線,**那本身就是結論**。
3. **「牆 texel 併進最近的 face」MUST 排在「小面併鄰」之前**(計畫的四步表把它列在第 4 步,
   而小面併鄰隱含在第 2~3 步之間)—— 順序反過來的話鄰接表整份是空的,一次都併不掉。

### 執行紀錄 —— 追加一節

> **2026-08-16 第二輪:序 13(§0-a 線工切面可行性樁)落地。**
> `tools/zonecut.mjs`(規則本體,零 import / 零亂數 / 純函式)+ `tools/audit_zone_cut.mjs`(樁)+
> `venue_field.cutLinesFor` + 四支結構清單函式搬家。`public/**` / `server/**` 一行未動。
> **判決:樁在三個驗收面上全綠,但有一個前提條件(見下)。**
> ・驗收面 1(界線離真值距離,新制 MUST ≤ 現制,p50 公尺):
>   taroko 1v1 **71.13 ≤ 111.71**、shibuya 3v3 **1.86 ≤ 4.66**、barcelona 3v3 **2.75 ≤ 3.39**、
>   rio 1v1 **2.65 ≤ 6.28**、paris 3v3 @2048² **0.54 ≤ 2.82** —— **五場全過**。
> ・驗收面 2(決定性):兩次跑分割/標籤雜湊逐位元相同、原文閘零亂數、順序無關(分割**與 id 編號**
>   兩件都驗)、標籤不吃 face id(重排編號後**重標**再比)、切面線零次切過結構足跡 —— 全過。
> ・驗收面 3(`surfaceId` 量化算術):**naive 的「2/255 等距」行不通** —— 2/255 恰好就是
>   `nextSurfId` 的第一個材質碼((0.5)/64 量化後同碼)⇒ 那一處「地貌 vs 建物」的線整條消失。
>   間距 MUST 由**材質碼的格**解出來:0..255 裡離所有材質碼 ≥ 2 碼的只有 64 個,
>   解出的六個分區 id = `{0, 4, 8, 12, 16, 20}/255`(草↔岩、乾↔濕 delta 皆 0.01569 > 門檻 0.004)。
> **⚠ 前提條件(去循環對照量出來的)**:把**地被多邊形外環**從參與線裡拿掉(標籤來源仍留著),
> 新制界線離**真實地被界線**的中位距離變成 shibuya 108.5m / rio 17.1m / barcelona 15.1m /
> paris 11.0m,而現制是 4.7 / 6.3 / 3.4 / 2.8m ⇒ **路緣 / 河岸 / 海岸 / 坡度這幾條線自己不夠**
> (唯一例外是 taroko:186.2m vs 197.9m,山區的界線本來就由坡度主導)。
> 也就是說:序 14 的「執行期要多抓 landuse / natural / waterway / boundary」不是建議是**前提**,
> 沒有那道門的話新制退化成「只有道路 + 坡度」,而那一版**比現制更差**。
> **成本**(Node v24;切面四段 = 光柵化 + 泛洪 + 小面併鄰 + 牆併回):
> 1024²(taroko / shibuya / barcelona / rio)**51~78 ms**,含逐面標籤 58~87 ms;
> **2048²(paris 3v3,3.7 M texel)197 ms**,含標籤 228 ms —— 大致隨 texel 數線性。
> 另有兩段**不屬於切面本身**但序 14 一定會付的:坡度等值線 43~153 ms、
> 地被多邊形逐 texel 光柵化 26~904 ms(後者是 point-in-polygon 的樸素實作,序 14 要換掃描線)。
> `buildBiomes` taroko 現況 963~1252 ms ⇒ 1024² 落在 5~8%,**但綁定值 MUST 由瀏覽器量**(㋓ 未做)。
> **線分級建議**(shibuya 3v3 掃參數):`rank ≤ 3`(tertiary / unclassified / residential / living_street 以上)
> 配 `areaMinF ≈ 0.0004` ⇒ 117 面、面積中位 1770 texel(≈ 16,600 m²)。
> `rank ≤ 5`(每條步道都切)在 `areaMinF 0.0001` 是 **397 面、中位 281 texel** = 回到雜訊;
> `rank ≤ 1/2` 只剩 37~42 面 = 太粗。

---

## ⑤ 待裁決(MUST NOT 由 commit 定案)

1. **`surfaceId` 從常數換成 `f(zone)`**。驗收面 3 要的「草↔岩、乾↔濕出線」必須讓
   `toon.js LAND_SURF_ID` 不再是單一常數,而那是 2026-08-13 使用者定案
   「LUT 與勾線不針對地貌作用,不要看出地貌拼圖接縫」的直接產物
   (`audit_cel_pipeline` Ⅶ + `toon.js` 的檔頭把理由寫死了)。兩者不衝突(拼圖接縫 vs 地貌換手是
   兩件事),但這是**推翻一條既有定案的形狀** ⇒ MUST 由使用者放行。**樁只出算術報告,不動 shader。**
   可行的 id 集合已經解出來:`{0, 4, 8, 12, 16, 20}/255`。
2. **`'!'`(懸崖不鋪)與 `null`(留白露衛星底圖)在遮罩制下怎麼表達**。計畫的次款預算表只有六個分區。
   實測面積佔比:taroko `'!'` **41.9%**(現制格)/ 新制 19 面;barcelona `'!'` 0.0%、`null` 0.1%;
   shibuya `null` 0.1%;rio `'!'` 0.0%。**taroko 那個 41.9% 是最大的一格** ——
   遮罩制若沒有這一格,「懸崖那一片會變成草皮」而沒有人知道什麼時候變的。
3. **線分級與面積下限的定案值**(上面 ④ 給的是掃參數之後的建議,不是定案)。
   「市區裡每條步道都切面 = 回到雜訊」是計畫自己的判準,而**面數是唯一看得見這件事的數字** ⇒
   `rank ≤ 3` / `areaMinF 0.0004` 這一組請人眼看過 `tools/.shots/zonecut/*_ab.png` 再定。
4. **`venue_field.llToWorld` 要不要補上 A42 主方位**。它現在是 **pre-A42 的手抄**(全檔 grep 不到
   `rot`/`mapRot`/`llToXZ`,而檔頭仍寫著「與 terrain.js 同一組換算 … 逐字照抄」——
   那句話在 2026-08-10 A42 上線後就過期了)。對 `audit_traverse` 無害(剛體變換,連通性是旋轉不變量),
   但**結構足跡 keep-out 的座標就是它算的**,而樁的線走 `llToXZ` ⇒ 兩份差 θ。
   本輪**刻意不修**(會動到 `audit_traverse`/`audit_lane_scenarios` 的座標輸出,是另一件事),
   已列為未驗項。修它要另開一輪並附「rot=0 場地逐位元不變 / 旋轉場地的航點清單重驗」的證明。

---

## ⑥ 交給序 14 / 序 15 的兩份清單

### ① 序 14 的第一道門:執行期要多抓的四類圖資

- `biomes.fetchOsmFeatures`(:3994)只抓 `building` / `railway` / `level_crossing` / `waterfall` /
  `place` / `peak` / `motorway_junction` / `station`;`fetchOsmRoads` 只抓 `highway`。
  ⇒ **`waterway` / `landuse` / `natural` / `boundary=administrative` 執行期一類都沒有**。
- 要加:`way["waterway"]` / `way["landuse"]` / `way["natural"]` / `rel["boundary"="administrative"];way(r)`。
- **改查詢 MUST 同步 `geoKey('osmF', 3)`** —— 不改版的話舊快取照樣命中,新資料在所有
  「以前開過這張圖」的機器上**永遠不出現**。
- payload MUST 進 `osmrelay.js` 的中繼(A43);超限是 ws 1009 **斷掉房主的連線**,
  症狀看起來完全像伺服器壞掉 ⇒ MUST 先跑 `node tools/measure_osm_relay.mjs`(㋓;
  現況實測 1.05 MB、`maxPayload` 餘裕 1.9×,不厚 —— 而地被多邊形是**面**不是線,量級會再上去)。
- Overpass 額度與逾時要重新定(樁用的是 `quotaOf(km2, 120/40, …)`,那是離線工具的尺)。

### ② 序 15 若成立,失去對象的稽核條目(= 取消成本)

| 稽核 | 失去對象的條目 |
|---|---|
| `audit_ground_tile` | Ⅰ(`CARPET_LOT` 選款區塊)Ⅱ(`CARPET_VARIANTS` 逐格互異)Ⅳ(`emitCell` 認養)Ⅵ、`--break-lot`/`--break-var`/`--break-order`/`--break-adopt` |
| `audit_ground_seam` | **整支** —— `planSeamOverlays` / `SEAM_STYLES` / `seamAlpha` / 同款異變體不發外溢 |
| `audit_ground_enclave` | **整支** —— `planEnclaves` / `ENCLAVE_STYLES` |
| `audit_ground_border` | `BORDER_SAME_ZONE` + `CARPET_DE` 色距窄門(含 `--break-de`)、`bandDryAt` 那一族(它存在的理由是底毯換手與真實地形差半個帶寬,新制兩者同源 ⇒ 差值恆 0) |
| `audit_ground_qc` | ⑦(orient / gridA)與 `SUB_COL` 名冊雙向比對(名冊由 27 縮到 19) |
| `audit_cel_pipeline` | Ⅶ —— `LAND_SURF_ID` 由常數換成 `f(zone)` 會直接推翻它的 `/const LAND_SURF_ID = 0;/` 與「地貌共用一號」那幾條 |
| **不受影響** | A38 ②(街廓零共享 `rnd`);A46 ⑨ 的碎鱗規則被 `zonecut.mergeSmall` **沿用**(同一條規則) |

---

## ⑦ 反向驗證矩陣(八支,逐支實跑過)

| `--break-*` | 壞版 | 實得紅字 | 適用場地 |
|---|---|---|---|
| `--break-merge` | 小面併鄰改「比佔全體」(只看 `areaMin`) | **4 條**(含 36 面等寬長條被抹成 1 面 = 圓柱保護失效) | 離線 |
| `--break-order` | 泛洪播種改由輸入順序決定 | **1 條**(face **id 編號**與輸入順序相關) | 離線 |
| `--break-rnd` | 逐面取樣改 `Math.random()` | **3 條**(原文閘 + 兩次跑不同 + 不吃 id) | 離線 |
| `--break-id` | 分區 id 間距改 1/255 | **2 條**(①②) | 離線 |
| `--break-slope` | 等值線門檻改 0.28 / 0.75 | **1 條**(門檻 ≠ `SLOPE.EASE_DEG`/`BLOCK_DEG`) | 離線 |
| `--break-quantize` | 切面線吃量化前圖資 + 無 A42 投影 | **1 條**(barcelona 2.75→**37.93m**、shibuya 1.86→**29.41m**) | **市區 + θ≠0** |
| `--break-keepout` | 結構足跡 keep-out 整組拿掉 | **1 條**(taroko:576 個牆 texel 落進足跡) | **要有結構** |
| `--break-label` | 逐面標籤改讀 face id | **2 條**(重排編號後重標 816128 格不同) | 任一 |

⚠ **後兩支加了「適用性硬閘」**:`--break-keepout` 挑到**沒有結構**的場地(barcelona 結構 0)、
`--break-quantize` 挑到 **θ = 0** 的場地時,壞版與好版逐位元相同 ⇒ 反向驗證會**看起來全綠**。
兩者都改成**當場 `process.exit(1)` 並說明該挑哪些場地**(§5.4 ㋑ 的同一條:壞版沒被造出來 = 假綠)。
`--break-quantize` 另外在山區也咬不動(taroko 仍綠)—— 那裡的界線多半來自坡度等值線、不經投影,
稽核會印一行提醒。

---

## ⑧ 回歸(本輪落地後實跑)

| 稽核 | 基準 | 本輪 | 判讀 |
|---|---|---|---|
| `audit_underpass` | 161 綠 / 0 紅 | **161 綠 / 0 紅** | 逐項相同 |
| `audit_road_grid` | 62 綠 / 0 紅 | **62 綠 / 0 紅** | 逐項相同 |
| `audit_slope_move` | 78/78 | **78/78** | 逐項相同 |
| `audit_siteplan` | 通過 265 項 | **265 項** | 逐項相同 |
| `audit_beacons` | 68 項 / 0 失敗 | **68 項 / 0 失敗** | 逐項相同 |
| `audit_object_joints --seeds 8` | 異常 0 項 | **21611 接合、異常 0 項** | 逐項相同 |
| `audit_ground_tile`/`qc`/`seam`/`enclave`/`border` | ALL PASS | **ALL PASS ×5** | 逐項相同 |
| `audit_solo_boot` | 全數通過 | **全數通過** | 逐項相同 |
| `audit_venue_biome --offline` | (基準跑的是完整版 14 項) | **13 項 / EXIT 0** | `--offline` 少一段,venue_field 既有 export 一格未動 |
| `audit_client_syntax` | 通過 216 項 | **220 項** | +4 = **別道**新增的客戶端模組(本道零 `public/js` 檔案) |
| `audit_cel_pipeline` | 通過 95 項 | **133 項** | +38 = **lane-ink** 新增的斷言 |
| `npm run bal` | 🎉 全綠 | **🎉 平衡稽核通過** | 逐項相同 |
| `npm test`(自訂埠 8691) | 🎉 624 ✅ | **🎉 全部通過** | 逐項相同 |

### ⚠ `audit_traverse` 全場地:基準 91/18 → 本輪 **121/21**,而這 **不是我的改動**

證據三條:
1. **`taroko` 逐位元相同**(可站立節點 86873、結構 5、開挖走廊 10、同一條紅字)——
   它是我最早暖快取的場地,而它與基準完全對得上。
2. 差異全部落在**結構數變多**的場地:`venice` 11→**17**、`civicblvd` 3→**7**、`roppongi` 16→**18**
   ⇒ 多出來的橋各自帶一條「橋下淨空」斷言,一綠一紅都會讓計數往上跑。
3. 本工作樹的 `tools/.scen_cache` **開工時是空的**(另一個工作樹有 100 個檔),
   本輪是**現抓**的 Overpass 快照 ⇒ 與基準吃的是兩份不同的圖資。

⇒ **`audit_traverse` 不能拿 BASELINE.txt 做「逐項不變」比對**(它的判定吃外部圖資)。
搬家那一件事的證明是下面這三層 A/B,不是全場地計數。

### 純搬家的三層佐證(`buildStructs`/`projectArc`/`ptAt`/`sampleAlong`)

1. **原文層**:`git show HEAD:tools/audit_traverse.mjs` 抽出的四支 vs 新 `venue_field.mjs` 的四支
   —— **逐字元相同**(505 / 342 / 272 / 2822 字元),且新 `audit_traverse` 自己那四份**已移除**。
2. **行為層**:同一份快取輸入下,舊實作(`new Function` 執行舊原文)vs 新 export 的 `buildStructs`
   輸出(含 `floorAt` 逐 run 21 點取樣)**逐位元相同**:
   taroko `sha256 71790afa…`(5 結構 / 17 航點 / 10 走廊)、shibuya `8cd9b2b0…`(10 / 28 / 12)、
   barcelona `bca0bf82…`(0 / 0 / 0)。
3. **端對端**:`audit_traverse --only=taroko,shibuya,barcelona --json=` 搬家前後,
   **排除 `cells` 欄後逐位元相同**。
   ⚠ **`cells` 欄天生非決定性,與本輪無關**:`BattleSim` 建構期以 `Math.random()` 擺第三方野營碉堡
   ⇒ `sim.solidResolve` 每次看到的障礙不同。實測**同一份程式碼**跑三次:barcelona
   319591 / 319585 / 319579。這是**既有缺陷**(或既有設計),本輪只是把它量出來 ——
   任何拿 `audit_traverse --json` 做逐位元 A/B 的人都會踩到。

---

## ⑨ 未驗項(㋓/㋕;MUST NOT 當綠燈)

1. **`--browser` 模式沒有做**:影像分類那一半(`classifyPure` 的衛星影像來源)在 Node 端不存在。
   樁的兩趟**共用同一份圖資分類器**(圖資多邊形覆蓋率 taroko 20.7% / rio 22.6% /
   barcelona 10.4% / **shibuya 只有 2.5%**),其餘一律退回 `green` ⇒
   **驗收面 1 只量得到圖資那一半**,shibuya 那一場尤其薄。
2. **建構期成本的綁定值**:`buildBiomes` 跑在瀏覽器,而低功耗手機才是這一項真正的邊界。
   Node 的 51~87 ms 只是量級參考。
3. **明隧道柱列帶(`galStrips` / `carveGalleryBands`)在 Node 端拿不到** ⇒ keep-out 名冊不完整。
4. **結構足跡 keep-out 的座標框**:`buildStructs` 的折線是 `venue_field.llToWorld`(pre-A42)算的,
   而樁的線走 `data.llToXZ` ⇒ 旋轉不為 0 的場地上兩者差 θ(見 ⑤-4)。
   `--break-keepout` 仍然咬得住(它量的是「牆有沒有落進足跡」,兩邊同框),
   但「足跡有沒有蓋對地方」在旋轉場地上**未驗**。
5. **只跑了 4 個場地**(taroko 1v1 山區 / shibuya 3v3 密市區 / barcelona 3v3 / rio 1v1 海岸)。
   29 場地全掃沒做。
6. **`audit_lane_scenarios`** 沒跑(㋓,吃外網且基準本來就 EXIT=1)。
7. **`npm run audit:net`** 依交辦紀律**沒跑**(⑦ 段會真的 spawn 每一支 dev 工具,含永不結束、
   會連外網下載的 `harvest_loop.mjs`)—— 由整合者統一跑一次。
8. **`bal` / `e2e` / `cel_pipeline` / `client_syntax` 的讀數受別道並行改動影響**:本輪五道共用同一個
   工作樹,`toon.js`/`biomes.js`/`game.js`/`data.js`/`postfx.js`/`visualPrefs.js`/`audio.js`/
   `locomotion.js`/`mobile.js`/`style.css` 在我跑的當下都是**別道的在途狀態**。
   本道的 diff 只有 `tools/` 五支 ⇒ 那幾支的差異一律歸別道。
