# §0-a 線工切面可行性樁報告(序 13)—— 序 14 / 15 的 go/no-go 依據

> 2026-08-16。本檔是 `docs/anime_style_plan.md` §0-a 那一節點名的**可行性樁**的完整產出。
> 計畫檔只留判決一句與那道前提條件;**逐場地數字、交接清單、取消成本住這裡**。
> **下一輪要動序 14 / 15 之前 MUST 先讀這一支** —— 樁是條件式 GO,條件不成立時新制**比現制更差**。
>
> 落地檔案:`tools/zonecut.mjs`(規則本體,零 import / 零亂數 / 純函式)・`tools/audit_zone_cut.mjs`(樁)・
> `tools/venue_field.mjs`(新增 `cutLinesFor` + 收進四支結構清單函式)・`tools/audit_traverse.mjs`(那四支改 import;純搬家)・
> `tools/logo_lib.mjs`(`encodePNG` 拆出 `pngBytes`)。**`public/**` 與 `server/**` 一行未動。**
> 規則本身的鐵律住 `.claude/rules/seams-terrain.md` 的「線工切面」那一列。

---

## 1. 判決:三個驗收面全綠,但是**條件式 GO**

計畫 §0-a 訂的三個驗收面,逐面的結果:

### 驗收面 1 —— 界線離真值距離(新制 MUST ≤ 現制;p50 公尺)

| 場地 | 人數 | 新制 | 現制 | 判 |
|---|---|---|---|---|
| taroko(山區) | 1v1 | **71.13** | 111.71 | ✅ |
| shibuya(密市區) | 3v3 | **1.86** | 4.66 | ✅ |
| barcelona | 3v3 | **2.75** | 3.39 | ✅ |
| rio(海岸) | 1v1 | **2.65** | 6.28 | ✅ |
| paris @2048² | 3v3 | **0.54** | 2.82 | ✅ |

### 驗收面 2 —— 決定性

兩次跑分割 / 標籤雜湊**逐位元相同**;原文閘零亂數;順序無關(**分割與 id 編號兩件都驗** ——
前者對重排是不變量,只驗它的話 `--break-order` 永遠是綠的);標籤不吃 face id(重排編號後**重標**再比);
切面線**零次**切過結構足跡。全過。

### 驗收面 3 —— `surfaceId` 出線的量化算術

**naive 的「2/255 等距」行不通**:2/255 恰好就是 `nextSurfId` 的第一個材質碼((0.5)/64 量化後同碼)
⇒ 那一處「地貌 vs 建物」的線**整條消失**。間距 MUST 由**材質碼的格**解出來 ——
0..255 裡離所有材質碼 ≥ 2 碼的只有 64 個,解出的六個分區 id =
**`{0, 4, 8, 12, 16, 20}/255`**(草↔岩、乾↔濕的 delta 皆 0.01569 > `INK_MRT.ID` 門檻 0.004)。

---

## 2. ⚠ 前提條件(去循環對照量出來的)

把**地被多邊形外環**從參與線裡拿掉(標籤來源仍留著),新制界線離**真實地被界線**的中位距離:

| 場地 | 新制(沒有地被外環) | 現制 |
|---|---|---|
| shibuya | **108.5 m** | 4.7 m |
| rio | 17.1 m | 6.3 m |
| barcelona | 15.1 m | 3.4 m |
| paris | 11.0 m | 2.8 m |
| taroko | 186.2 m | 197.9 m ← **唯一例外**(山區的界線本來就由坡度主導) |

⇒ **路緣 / 河岸 / 海岸 / 坡度這幾條線自己不夠。**
也就是說:序 14 的「執行期要多抓 landuse / natural / waterway / boundary」**不是建議是前提**,
沒有那道門的話新制退化成「只有道路 + 坡度」,而那一版**比現制更差**。

---

## 3. 成本(Node v24;㋓ 綁定值 MUST 由瀏覽器量,未做)

切面四段 = 光柵化 + 泛洪 + 小面併鄰 + 牆併回:

| 規格 | 切面 | 含逐面標籤 |
|---|---|---|
| 1024²(taroko / shibuya / barcelona / rio) | **51~78 ms** | 58~87 ms |
| 2048²(paris 3v3,3.7 M texel) | **197 ms** | 228 ms |

大致隨 texel 數線性。另有兩段**不屬於切面本身**但序 14 一定會付的:
坡度等值線 **43~153 ms**、地被多邊形逐 texel 光柵化 **26~904 ms**
(後者是 point-in-polygon 的樸素實作,序 14 要換掃描線)。

`buildBiomes` taroko 現況 963~1252 ms ⇒ 1024² 落在 **5~8%**。
⚠ **綁定值 MUST 由瀏覽器量**,低功耗手機才是這一項真正的邊界;Node 的數只是量級參考。

---

## 4. 線分級與面積下限(掃參數之後的**建議**,不是定案)

shibuya 3v3 掃參數:

| 設定 | 面數 | 面積中位 | 判讀 |
|---|---|---|---|
| `rank ≤ 1/2` | 37~42 | — | 太粗 |
| **`rank ≤ 3`**(tertiary / unclassified / residential / living_street 以上)+ `areaMinF ≈ 0.0004` | **117** | **1770 texel(≈ 16,600 m²)** | ← 建議 |
| `rank ≤ 5`(每條步道都切)+ `areaMinF 0.0001` | 397 | 281 texel | **回到雜訊**(= 計畫自己的判準) |

「市區裡每條步道都切面 = 回到雜訊」是計畫自己的話,而**面數是唯一看得見這件事的數字**
⇒ 這一組請人眼看過 `tools/.shots/zonecut/*_ab.png` 再定。

---

## 5. 交給序 14 的第一道門:執行期要多抓的四類圖資

- `biomes.fetchOsmFeatures`(:3994)只抓 `building` / `railway` / `level_crossing` / `waterfall` /
  `place` / `peak` / `motorway_junction` / `station`;`fetchOsmRoads` 只抓 `highway`。
  ⇒ **`waterway` / `landuse` / `natural` / `boundary=administrative` 執行期一類都沒有**。
- 要加:`way["waterway"]` / `way["landuse"]` / `way["natural"]` /
  `rel["boundary"="administrative"];way(r)`。
  ⚠ **行政界在 OSM 是 relation 不是 way** —— 查 way 恆 0 條(barcelona 戰場 bbox 內
  way 回 **0**、rel 回 **41**),而每一個數字看起來都正常。
- **改查詢 MUST 同步 `geoKey('osmF', 3)`** —— 不改版的話舊快取照樣命中,新資料在所有
  「以前開過這張圖」的機器上**永遠不出現**。
- payload MUST 進 `osmrelay.js` 的中繼(A43);超限是 ws 1009 **斷掉房主的連線**,
  症狀看起來完全像伺服器壞掉 ⇒ MUST 先跑 `node tools/measure_osm_relay.mjs`(㋓;
  現況實測 1.05 MB、`maxPayload` 餘裕 1.9×,不厚 —— 而**地被多邊形是面不是線**,量級會再上去)。
- Overpass 額度與逾時要重新定(樁用的是 `quotaOf(km2, 120/40, …)`,那是離線工具的尺)。

### 5-b 結構足跡 keep-out:名冊已經有一份,叫 `gradeCorridors`

計畫 §⑨ 寫的 `hillAt` 在本儲存庫**查無**(全庫零命中)。實際的那一份:

- **產出**:`biomes.markGradeCorridors()` 一趟做兩件事 —— ①回傳逐段
  `{x1,z1,x2,z2,hw,kind:'tun'|'bridge',cy}`;②同時以
  `blockArea(blocked, x, z, hw + (kind === 'tun' ? STRUCT_CLEAR_PAD : 4))` 把足跡打進散布用的
  `blocked` 格,`STRUCT_CLEAR_PAD = max(7, UND.COPE, TUN.GAL_CLEAR_W)`(現值 9)。
- **消費端 MUST 走 `group.userData.gradeCorridors`** —— `main.js` 上傳伺服器的那一份
  `.slice(0, 2400)` **會截斷**。
- **樁裡那一份對得上**:半徑用同一條推導;粒度上樁是**逐線段膠囊**、執行期是**逐節點圓盤**
  (節距 `ROAD_SEG` = 6 m 而 pad ≥ 7 m)⇒ 沿線方向樁 ⊇ 執行期,**這一半沒有缺口**。

**五個對不上的地方(序 14 要嘛補、要嘛明講不管)**:

| # | 差異 | 後果 |
|---|---|---|
| 1 | **座標換算**:樁走 `venue_field.llToWorld`(**pre-A42,不帶主方位旋轉**),執行期走 `data.llToXZ`(旋轉是投影的一部分) | 有 `center.rot` 的場地上 keep-out 帶**整條轉開** —— 五條裡最嚴重的一條 |
| 2 | **名冊來源**:樁走 `venue_field.buildStructs`(`LANE_HW` 白名單 + 弧長 < 24 m 的「橋」剔除),執行期走 `markGradeCorridors`(`PED_HW` 黑名單 + 沉錨/跨水規則) | 三類結構不在樁的 keep-out 裡:①**短橋**(< 24 m)②不在 `LANE_HW` 白名單也不在 `PED_HW` 黑名單的道路類(`track` / `road` / `busway` …)③**跨水段補橋**(`wet` 而 tags 沒有 `bridge`) |
| 3 | **兵線補橋 `laneWetWays`** 完全不在樁的名冊裡(它由 `cfg` 推導,不是圖資) | 兵線跨水那幾段的橋在切面上不會被讓開 |
| 4 | **明隧道柱列的側別**:兩份都不帶(`gradeCorridors` 逐段有 `hw`/`kind`/`cy`,`gal` 位元遮罩只進 `tunnelSegs` 第 7 欄) | 現況靠 `STRUCT_CLEAR_PAD` 已含 `TUN.GAL_CLEAR_W = 9` **兩側對稱**蓋住 ⇒ 構造上不漏,但要「只避開柱列那一側」得從同批交出的 `tunnels` 第 7 欄取 |
| 5 | `hw` 的來源兩邊都是 `strucHw(tags)` ✅ | (列出來是為了下一輪不必重查) |

---

## 6. 交給序 15 的取消成本:失去對象的稽核條目

| 稽核 | 失去對象的條目 |
|---|---|
| `audit_ground_tile` | Ⅰ(`CARPET_LOT` 選款區塊)Ⅱ(`CARPET_VARIANTS` 逐格互異)Ⅳ(`emitCell` 認養)Ⅵ、`--break-lot`/`--break-var`/`--break-order`/`--break-adopt` |
| `audit_ground_seam` | **整支** —— `planSeamOverlays` / `SEAM_STYLES` / `seamAlpha` / 同款異變體不發外溢 |
| `audit_ground_enclave` | **整支** —— `planEnclaves` / `ENCLAVE_STYLES` |
| `audit_ground_border` | `BORDER_SAME_ZONE` + `CARPET_DE` 色距窄門(含 `--break-de`)、`bandDryAt` 那一族(它存在的理由是底毯換手與真實地形差半個帶寬,新制兩者同源 ⇒ 差值恆 0) |
| `audit_ground_qc` | ⑦(orient / gridA)與 `SUB_COL` 名冊雙向比對(名冊由 27 縮到 19) |
| `audit_cel_pipeline` | Ⅶ —— `LAND_SURF_ID` 由常數換成 `f(zone)` 會直接推翻它的「地貌共用一號」那幾條 |
| **不受影響** | A38 ②(街廓零共享 `rnd`);A46 ⑨ 的碎鱗規則被 `zonecut.mergeSmall` **沿用**(同一條規則) |

---

## 7. 反向驗證矩陣(八支,逐支實跑過)

| `--break-*` | 壞版 | 實得紅字 | 適用場地 |
|---|---|---|---|
| `--break-merge` | 小面併鄰改「比佔全體」(只看 `areaMin`) | **4 條**(含 36 面等寬長條被抹成 1 面 = 圓柱保護失效) | 離線 |
| `--break-order` | 泛洪播種改由輸入順序決定 | **1 條**(face **id 編號**與輸入順序相關) | 離線 |
| `--break-rnd` | 逐面取樣改 `Math.random()` | **3 條**(原文閘 + 兩次跑不同 + 不吃 id) | 離線 |
| `--break-id` | 分區 id 間距改 1/255 | **2 條** | 離線 |
| `--break-slope` | 等值線門檻改 0.28 / 0.75 | **1 條**(門檻 ≠ `SLOPE.EASE_DEG`/`BLOCK_DEG`) | 離線 |
| `--break-quantize` | 切面線吃量化前圖資 + 無 A42 投影 | **1 條**(barcelona 2.75 → **37.93 m**、shibuya 1.86 → **29.41 m**) | **市區 + θ≠0** |
| `--break-keepout` | 結構足跡 keep-out 整組拿掉 | **1 條**(taroko:576 個牆 texel 落進足跡) | **要有結構** |
| `--break-label` | 逐面標籤改讀 face id | **2 條**(重排編號後重標 816128 格不同) | 任一 |

⚠ **後兩支加了「適用性硬閘」**:`--break-keepout` 挑到**沒有結構**的場地(barcelona 結構 0)、
`--break-quantize` 挑到 **θ = 0** 的場地時,壞版與好版逐位元相同 ⇒ 反向驗證會**看起來全綠**。
兩者都改成**當場 `process.exit(1)` 並說明該挑哪些場地**(§5.4 ㋑ 在資料端的同一條:
壞版沒被造出來 = 假綠)。`--break-quantize` 另外在山區也咬不動(taroko 仍綠)——
那裡的界線多半來自坡度等值線、不經投影,稽核會印一行提醒。

---

## 8. ⚠ `audit_traverse` 不能拿 BASELINE 做「逐項不變」比對

本輪實測全場地 **91/18 → 121/21**,而這**不是任何一道的改動**。證據三條:

1. **`taroko` 逐位元相同**(可站立節點 86873、結構 5、開挖走廊 10、同一條紅字)——
   它是最早暖快取的場地,與基準完全對得上。
2. 差異全部落在**結構數變多**的場地:`venice` 11→**17**、`civicblvd` 3→**7**、`roppongi` 16→**18**
   ⇒ 多出來的橋各自帶一條「橋下淨空」斷言,一綠一紅都會讓計數往上跑。
3. 本工作樹的 `tools/.scen_cache` **開工時是空的** ⇒ 本輪是**現抓**的 Overpass 快照,
   與基準吃的是兩份不同的圖資。

⇒ **它的判定吃外部圖資。** 搬家那一件事的證明是下面這三層 A/B,不是全場地計數。

### 純搬家的三層佐證(`buildStructs`/`projectArc`/`ptAt`/`sampleAlong`)

1. **原文層**:`git show HEAD:tools/audit_traverse.mjs` 抽出的四支 vs 新 `venue_field.mjs` 的四支
   —— **逐字元相同**(505 / 342 / 272 / 2822 字元),且新 `audit_traverse` 自己那四份**已移除**。
2. **行為層**:同一份快取輸入下,舊實作(`new Function` 執行舊原文)vs 新 export 的輸出
   (含 `floorAt` 逐 run 21 點取樣)**逐位元相同**:taroko `sha256 71790afa…`(5 結構 / 17 航點 /
   10 走廊)、shibuya `8cd9b2b0…`(10 / 28 / 12)、barcelona `bca0bf82…`(0 / 0 / 0)。
3. **端對端**:`audit_traverse --only=taroko,shibuya,barcelona --json=` 搬家前後,
   **排除 `cells` 欄後逐位元相同**。

⚠ **`cells` 欄天生非決定性,與本輪無關**:`BattleSim` 建構期以 `Math.random()` 擺第三方野營碉堡
⇒ `sim.solidResolve` 每次看到的障礙不同。實測**同一份程式碼**跑三次:barcelona
**319591 / 319585 / 319579**。這是**既有缺陷**(或既有設計),本輪只是把它量出來 ——
任何拿 `audit_traverse --json` 做逐位元 A/B 的人都會踩到。

---

## 9. 待裁決(MUST NOT 由 commit 定案)

1. **`surfaceId` 從常數換成 `f(zone)`。** 驗收面 3 要的「草↔岩、乾↔濕出線」必須讓
   `toon.js LAND_SURF_ID` 不再是單一常數,而那是 2026-08-13 使用者定案
   「LUT 與勾線不針對地貌作用,不要看出地貌拼圖接縫」的直接產物(`audit_cel_pipeline` Ⅶ +
   `toon.js` 的檔頭把理由寫死了)。兩者不衝突(**拼圖接縫 vs 地貌換手是兩件事**),
   但這是**推翻一條既有定案的形狀** ⇒ MUST 由使用者放行。**樁只出算術報告,不動 shader。**
   可行的 id 集合已經解出來:`{0, 4, 8, 12, 16, 20}/255`。
2. **`'!'`(懸崖不鋪)與 `null`(留白露衛星底圖)在遮罩制下怎麼表達。** 計畫的次款預算表只有
   六個分區。實測面積佔比:taroko `'!'` **41.9%**(現制格)/ 新制 19 面;barcelona `'!'` 0.0%、
   `null` 0.1%;shibuya `null` 0.1%;rio `'!'` 0.0%。**taroko 那個 41.9% 是最大的一格** ——
   遮罩制若沒有這一格,「懸崖那一片會變成草皮」而沒有人知道什麼時候變的。
3. **線分級與面積下限的定案值**(見第 4 節,那是建議不是定案)。
4. **`venue_field.llToWorld` 要不要補上 A42 主方位。** 它現在是 **pre-A42 的手抄**(全檔 grep 不到
   `rot`/`mapRot`/`llToXZ`,而檔頭仍寫著「與 terrain.js 同一組換算 … 逐字照抄」——
   那句話在 2026-08-10 A42 上線後就過期了)。對 `audit_traverse` 無害(剛體變換,連通性是旋轉
   不變量),但**結構足跡 keep-out 的座標就是它算的**,而樁的線走 `llToXZ` ⇒ 兩份差 θ。
   本輪**刻意不修**(會動到 `audit_traverse`/`audit_lane_scenarios` 的座標輸出,是另一件事)。
   修它要另開一輪並附「rot=0 場地逐位元不變 / 旋轉場地的航點清單重驗」的證明。

---

## 10. 未驗項(㋓/㋕;MUST NOT 當綠燈)

1. **`--browser` 模式沒有做**:影像分類那一半(`classifyPure` 的衛星影像來源)在 Node 端不存在。
   樁的兩趟**共用同一份圖資分類器**(圖資多邊形覆蓋率 taroko 20.7% / rio 22.6% /
   barcelona 10.4% / **shibuya 只有 2.5%**),其餘一律退回 `green` ⇒
   **驗收面 1 只量得到圖資那一半**,shibuya 那一場尤其薄。
2. **建構期成本的綁定值**:`buildBiomes` 跑在瀏覽器,而低功耗手機才是這一項真正的邊界。
3. **明隧道柱列帶(`galStrips` / `carveGalleryBands`)在 Node 端拿不到** ⇒ keep-out 名冊不完整。
4. **結構足跡 keep-out 的座標框**在旋轉場地上**未驗**(見 §9-4;`--break-keepout` 仍然咬得住,
   它量的是「牆有沒有落進足跡」而兩邊同框)。
5. **只跑了 4 個場地**(taroko 1v1 山區 / shibuya 3v3 密市區 / barcelona 3v3 / rio 1v1 海岸);
   29 場地全掃沒做。
6. **`audit_lane_scenarios`** 沒跑(㋓,吃外網且基準本來就 EXIT=1)。
7. **`npm run audit:net`** 依交辦紀律沒跑(⑦ 段會真的 spawn 每一支 dev 工具,含永不結束、
   會連外網下載的 `harvest_loop.mjs`)。
