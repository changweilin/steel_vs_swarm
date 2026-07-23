# 隧道/地下道洞口透明化改制計畫

> 目標:洞外望向出入口,直接看見**真實隧道內部**(路面/牆/天花/照明往深處延伸),而非現行一片黑板;且**不引入任何破圖**。
> 基準日:2026-07-23。範圍:`biomes.js` / `terrain.js` 洞口相關;`data.js` 常數。
>
> **狀態:2026-07-23 已實作完成並驗收**(jinlong 8 座門洞 + 里約 Túnel Novo 4 座)。實作與計畫的四處差異見 §9。

---

## 1. 問題背景

### 1.1 現況:洞外一片黑
出入口從外面看是一片漆黑,進去後才看見隧道。那片黑是**洞口暗面**([biomes.js:2846](public/js/biomes.js:2846))—— 一片只朝外(FrontSide)的不透明黑平面,貼在門洞開口內側 `z=-1.3`,專職遮住門洞後方約 8m(APRON)處的**土牆**。

### 1.2 土牆是什麼
是**地形本身**在洞口的垂直斷面 —— 不是額外圖層。

根因:地圖是**高度場**(heightfield,[terrain.js:521](public/js/terrain.js:521),每個 `(x,z)` 只存一個高度),先天無法表達「上面是山、下面是洞」的上下交疊。所以隧道採「真・下沉」設計([terrain.js:478](public/js/terrain.js:478)):
- 覆蓋段:山體地表**原樣保留**(= 隧道的頂),路面 + 不透明天花墊在山體**底下**。
- 敞開段(引道):才把地表挖到路面高,才看得到洞口。

代價:洞口地表必須從**山高**降到**路面高**,那道降下來的陡面 = 土牆(崖面布幕)。它橫在隧道斷面上、位置在天花以下,側牆遮不到、天花也遮不到,只能靠正面遮擋(= 暗面)。

### 1.3 為什麼不能只把暗面拿掉 / 只把地形挖平
- 只拿掉暗面 → 洞口望進去先撞土牆 = 破圖(回退 `b1e0c87`/`33b3c54`)。
- 把覆蓋段一起挖到路面高 → 山消失(高度場不能懸空)→ 變穿山明塹壕溝,不再是隧道。

---

## 2. 前置事實(已驗證)

隧道內部是**完全密封的不透明箱體**,所以「挖穿土牆」看到的是內壁,不是穿到天空/圖外:

| 面 | 來源 | 涵蓋範圍 |
|---|---|---|
| 地板 | 路面緞帶 [biomes.js:2363](public/js/biomes.js:2363) `strc ? tFloorAt+ROAD_LIFT` | 全 run(含覆蓋段) |
| 兩側牆 | [biomes.js:2726](public/js/biomes.js:2726)(DoubleSide) | 覆蓋段全段立起(covS) |
| 不透明天花 | [biomes.js:2737](public/js/biomes.js:2737)(DoubleSide) | ivx(覆蓋+圍裙) |
| 照明 | 天花燈 InstancedMesh [biomes.js:2774](public/js/biomes.js:2774) | covS,常亮 emissive |

內部件皆 `frustumCulled=false`,從洞外看不會被剔除。

---

## 3. 方案:規則方格洞 + 洞口專屬 collar

### 3.1 三塊工
1. **規則方格洞** — 每座門洞取 bore 覆蓋到的地形格,從**繪製** index 刪三角形打洞。格線對齊 → 洞緣是規則方格、純幾何確定性(無 `rnd`)。
2. **洞口專屬 collar(貼補)** — 從方格洞緣 loft 到 bore 矩形(地板→天花、±hw)的**不透明**漏斗裙,沿用門洞混凝土材質 `envMat(0x9a958c)`(無新依賴)。補死「方格緣 vs 斜向 bore」的鋸齒縫。corner 最多補約一格(~8m)—— collar 是有份量的額牆/翼牆,長得像真隧道口。
3. **退役暗面** — collar 封死後,[biomes.js:2846](public/js/biomes.js:2846) 那片黑平面多餘,拿掉。

### 3.2 尺度參考(D=1600 / L1)
| 量 | 值 | 來源 |
|---|---|---|
| 地形格解析度 | `GRID_N=193` | [data.js:1844](public/js/data.js:1844) |
| 地形格寬 | `worldW/192` ≈ 8.3m | [terrain.js:293](public/js/terrain.js:293) |
| 隧道半寬 hw | `TUN.HW=9`(或 `PASS_W/2=8`) | [biomes.js:1708](public/js/biomes.js:1708) |
| bore 寬 | ≈ `hw×2` ≈ 18m → 洞約 2~3 格 | |
| 淨空 | `TUN.CLEAR=8`(= `LOS.TUN_CLEAR_M`) | [biomes.js:1708](public/js/biomes.js:1708) |
| 圍裙 | `APRON=8` | [biomes.js:2412](public/js/biomes.js:2412) |
| 路面抬升 | `ROAD_LIFT=0.45` | [biomes.js:2181](public/js/biomes.js:2181) |

> 注意:地形格 ~8.3m 偏粗,collar 的橋接寬度可達約一格 → collar 是實體結構,非細條 trim。

---

## 4. 不可破的不變式(MUST)

1. **只刪繪製三角形,`heights[]` 陣列原封不動** —— `heightAt`/碰撞/迷霧 LOS 全讀陣列不讀三角形。純視覺開洞,單位照樣打不穿、走不過山(`33b3c54` 命脈不動)。
2. **collar 不可 DoubleSide** —— 裙面朝內/外定向要對,否則出洞視野變黑牆(暗面老坑,記憶 `tunnel-cover-interval-portals`)。
3. **確定性** —— 洞格選取純幾何、依 geocache 同一份圖資 → 同一個洞,跨客戶端一致(§CLAUDE.md 2.3)。
4. **無新依賴 / 無 build step** —— collar 用既有 `envMat` + 程序幾何。
5. **不動 `heights[]` = 不觸發重烤** —— 不改 `REAL_SCALE`/`GEO_SCALE_VER`,venueLanes 不受影響。

---

## 5. 實作步驟

### Phase 0 — 單座原型(jinlong 一座洞打通全管線)
- [x] portal 物件補 `hw` / `slope`(每公尺進洞的路面高變化)/ `depth`(夾到區間長,上限 40m)—— bore 定義住 portal 自己身上,不另建 footprint 表。
- [x] terrain 新增 `punchPortalHoles(bores, covers)`:繪製 index 就地壓實 + `setDrawRange`,**不動** `heights[]`/`posAttr`。
- [x] 建 collar 幾何:洞緣邊 → 斷面矩形夾制點的 loft(不透明)。掛在 biomes group(非 portal group:洞緣是世界座標)。
- [x] 拿掉暗面 → 退居備援(`touched[pi]` 為 false 才掛回)。
- [x] jinlong 洞外/洞內/高空截圖:見內部、無漏縫、無穿天、俯瞰只露天花板頂面。
- [x] `heightAt` 逐點與改前位元相同(碰撞/LOS 讀陣列不讀三角形);`npm test` + `npm run bal` 全綠。

### Phase 1 — 全 12 座 + 其他場地
- [x] 里約 `Túnel Novo` `[-22.96091, -43.17589]`:自訂 L1 錨點(場地中心壓在隧道上)→ 4 座門洞全驗通過。
      (原計畫寫 6 門洞 = 舊錨點的覆蓋鏈數;本次錨點不同,鏈數本就不同,非回歸。)
- [x] 曲線/斜向洞口(jinlong 兩端 ry 差 π 且非軸向)、**平行雙孔**(jinlong 兩對門洞相距 3~6m)collar 水密複驗。
- [x] `userData.portals` 數量/位置與改前一致(jinlong 恆 8 座、座標逐位元相同)。

### Phase 2 — 收尾
- [x] 更新 [public/js/.claude.md](public/js/.claude.md) §3 與記憶 `tunnel-cover-interval-portals`(暗面退役 → collar 接手)。
- [x] 暗面註解改寫為「備援」語意(非死碼,降級路徑仍在用)。

---

## 6. 難點與風險

| 風險 | 說明 | 緩解 |
|---|---|---|
| **collar 水密** | ragged 方格緣 → 斜 bore 的 loft,要在所有視角(含高空 dollhouse)都不露縫、不穿頂 | 主要工時所在;先單座原型把 loft 契約定死再推全場 |
| z-fighting | collar / 洞緣 / 隧道牆三者重疊面 | 小量 overlap + polygonOffset |
| index 移除破壞其他消費端 | 地被散布/`heightAt` 讀陣列不讀 mesh → 不受影響;但 `computeVertexNormals` 後法線漣漪需確認 | 開洞後只在洞區重算,或保留原法線 |
| 出洞黑牆回歸 | collar 定向錯 = 暗面老坑重演 | MUST 單面 + 洞內側測試 |

---

## 7. 驗證矩陣(DoD)

- [x] **視覺**:里約 / 金龍洞外截圖 —— 見內部(路面/牆/天花燈列往深處延伸、遠端出口見天光)、無漏縫、無穿天;高空俯瞰只露天花板頂面(山體地表完整)。洞內往外看見天空與市景(出洞視野未被遮)。
- [x] **物理**:`heightAt` 洞區逐點抽樣與改前**位元相同**(punch 只動繪製 index);`tunnelAt`/`ceilingAt`/`surfaceAt` 洞內取樣正常;`npm test` 全綠(60 項)。
- [x] **確定性**:jinlong 重開兩次 → terrCut 46、coverTri 232 逐次一致(純幾何、無 `rnd`,不影響共享亂數序列)。
- [x] **不變式**:`heights[]` 未變;無新 npm 依賴;無 build step;未動 `REAL_SCALE`/`GEO_SCALE_VER` ⇒ 無重烤。
- [x] **回歸**:`userData.portals` 數量/位置與改前一致(jinlong 恆 8 座、座標相同);`npm run bal` 四不變式全綠。

---

## 9. 實作與計畫的差異(四處,皆為實作時實測倒逼)

1. **地被層必須一起讓開**(計畫漏列):地表拼圖底毯 + 細節實例是**獨立圖層**,只挖地形的話洞口望進去仍是一坡貼在崖面上的草皮。故 `punchPortalHoles(bores, covers)` 加收 `buildGroundCover` 產出的 children 切片,吃**同一把尺**(Mesh 打洞 / InstancedMesh 縮零)。
2. **collar 用 DoubleSide**(計畫 §4-2 寫 MUST NOT):該禁令是針對「橫跨隧道斷面的暗面」——那種面單面朝錯就是出洞黑牆。collar 的外環在地形上、內環貼管壁,**幾何上恆在管身之外、不可能橫跨斷面**,故不適用;反過來單面若有一片繞行判錯就是一個看穿的破洞。取水密不取單面,法線仍以「洞口上方」為參考點定向,打光正確。
3. **「打洞是否成功」判定用 `touched` 不用 `rims`**(計畫未預見):平行雙孔隧道兩座門洞相距 3~6m、bore 大幅重疊,重疊區三角形只會被第一座認領 → 第二座 `rims` 為空會誤判失敗掛回黑板,而那片黑板正好擋在第一座洞口後面(jinlong 8 座實測有 2 座中招)。改回報 `touched[]`(含被鄰座認領的)。
4. **洞內路面兩個老問題**(洞口透明化之後才看得見,同批一起修):**①結構隧道恆柏油** —— 路面 biome 取「中點衛星像素」分類,隧道中點落在**覆蓋段上方的山體**(森林/裸岩)⇒ 判成綠地、鋪成泥土路(金龍隧道實測);`if (strc) biome='urban'`(與既有「橋段取到水色 → urban」同一道理)。**②隧道畫標線** —— 舊版 `!strc` 整段跳過(`putMark` 貼地取樣會把標線畫到覆蓋段上方山頂);修法是給 `putMark`/`emitLine` 開 `yB`/`yBAt` 基準高參數(隧道傳 `tFloorAt(cum[i])`,與路面緞帶同源),**不是放寬 guard**。路燈仍 MUST `!strc`(燈桿會戳穿天花板與山體,洞內照明走天花燈)。

---

## 8. 涉及檔案

| 檔 | 動作 |
|---|---|
| [public/js/biomes.js](public/js/biomes.js) | portal 迴圈算 grid footprint、建 collar、拿掉暗面 |
| [public/js/terrain.js](public/js/terrain.js) | 新增 `punchPortalHoles()`(只動繪製 index) |
| [public/js/data.js](public/js/data.js) | 若需 collar 參數常數 |
| scratchpad `tunnel_slab_test.mjs` | 碰撞/LOS 回歸 |
| [public/js/.claude.md](public/js/.claude.md) | 收尾更新不變式 |
