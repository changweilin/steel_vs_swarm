# 啟動時生成與部署 3D 場景實體

流程：資產與地形並行準備 → 確定性選址／組裝 → 原型幾何編譯 → 配色分批 → 場景部署。

啟動不呼叫 AI 生成服務。正式零件資料在本機組裝成真正的頂點、法線與色彩緩衝，再建立 Mesh／InstancedMesh；環境物件直接使用程序生成，不再預載舊零件庫。雲端、區網與單機共用此流程。

| 階段 | 入口 | 契約 |
| --- | --- | --- |
| 準備 | `main.js startPrebuild` | 模型與地形並行；戰鬥模型與路網準備完成才建場景 |
| 組裝 | `backgroundObjects.js` | 座標種子決定主結構、葉零件與配色，不消耗共享亂數 |
| 編譯 | `runtimePartModel.js` | 不可變成品保留最多 32 份最近使用原型；每個實體取得獨立幾何，編輯中的資料不快取 |
| 批次 | `sceneObjects.js deploySceneObjects` | 同外觀共用一次幾何取得與一顆 InstancedMesh；矩陣由呼叫端提供並檢查有限值與正尺度 |
| 部署 | `sceneObjects.js deploySceneBatches` | 每款完成後透過既有啟動讓步器更新進度；配色容器攤平，建築淨空能找到所有實例 |
| 風格 | `toon.js sceneObjectMat` | 三階賽璐璐、平塗、冷色暗面、低邊緣光；描邊使用既有單次後製 |

建築已接集中批次部署；場景載具與列車使用快取的成品幾何，保留各自可移動的物件樹。植被、原生地標、NPC 與戰鬥單位仍由其專用建構器處理。

加入新的靜態物件消費端時，先產出已定案的 placements，再向 `deploySceneObjects` 提供 `variantOf`、`geometryOf`、`material`、`matrixOf`、`name` 與 `metadata`。權威尺度與碰撞資料由原消費端管理，禁止由渲染結果反推。使用世界曲面時維持 CPU 視錐剔除關閉。

`pre.prepareMs` 記錄啟動並行準備耗時；`biomes.userData.sceneDeployment` 記錄建築部署數量、原型數與耗時。這些是 CPU 建構量測，不代表整場首次繪製時間或 GPU draw calls。

驗證使用遊戲相同的 Three.js 0.160 模組，無需加入 npm 依賴：

```powershell
$env:THREE_MODULE = 'C:\path\to\three.module.mjs'
node test/sceneObjects.mjs
node tools/audit_client_syntax.mjs
node tools/audit_runtime_scene_models.mjs
node tools/audit_background_objects.mjs
node tools/audit_gpu_lifecycle.mjs
```

實體測試涵蓋 2,000 個 placement 合為 4 個批次、全部 29 款建物、多配色淨空可見性、無效矩陣拒絕、快取副本隔離與編輯刷新。輸出的冷／暖編譯時間只供本機診斷，不設定跨硬體效能斷言。

## 每局建築多樣性

房間建立時由伺服器產生 `architectureSeed`，隨設定同步全房；回房再戰更新種子，重連沿用本局值。此種子列入預建快取鍵，完全不消耗植被與道路的共享亂數序列。

`architectureStyles.js` 是文化語彙與地形比例的設定入口。以下是無特殊輪廓時的目標百分比；有限地圖是加權抽樣，不強制湊整數配額。

| 建築語彙 | 市區 | 鄉村 | 平原 | 山坡 |
| --- | ---: | ---: | ---: | ---: |
| 日式町屋 | 10 | 22 | 12 | 12 |
| 東亞院落 | 8 | 20 | 14 | 9 |
| 地中海拱廊 | 9 | 15 | 14 | 18 |
| 山地木石屋 | 3 | 16 | 7 | 34 |
| 土築聚落 | 3 | 12 | 19 | 14 |
| 近代裝飾藝術 | 22 | 5 | 8 | 5 |
| 當代玻璃街廓 | 35 | 5 | 10 | 5 |
| 近代廠房 | 10 | 5 | 16 | 3 |

坡度達 10° 優先套用山坡比例；其餘依圖資最小包含用地、周邊建築密度與現有聚落判定分類。農地與低密住宅使用鄉村比例；無圖資時才使用場地的都市成分作備援。中庭提高院落權重，長寬比超過 2.5 的區塊提高町屋與廠房權重。

圖資建築保留真實 outer／holes，窗格與結構飾件沿各段牆生成。屋頂追加構件只放在能完整容納的凸輪廓上；凹形與中庭不跨洞覆蓋。宗教與公共設施保留原用途識別件。樣式顏色寫入頂點，不因每棟文化不同而新增材質批次。一般建物則在原尺度防線內對所有合格模型加權選款，避免只反覆出現前六款。

`biomes.userData.stats.architecture` 提供本局種子與圖資建物的實際地形／文化計數。

```powershell
$env:THREE_MODULE = 'C:\path\to\three.module.mjs'
$env:THREE_BUFFER_UTILS = 'C:\path\to\BufferGeometryUtils.mjs'
node test/buildingDiversity.mjs
# 視覺驗收額外需要同版本的 three/addons/postprocessing/Pass.js
$env:THREE_PASS = 'C:\path\to\Pass.mjs'
node test/architecturePreview.mjs
# 瀏覽 http://127.0.0.1:8644
```

## 共用程序環境物件（2026-09-10）

`environmentParts.js` 是 15 類獨立物件的共同生成入口：住家、摩天樓、倒塌高樓、工廠、電廠、焚化廠、礦場、油田、溫室、牧場、巨石、神木、倒木、汽車與擱淺船。`backgroundObjects.js` 的 `environment/` 目標與 `edgewall.js` 的獨立邊界類型雙向共用。樹、岩石、車與船體沿用各自既有程序生成器。

邊界用途尺寸由型錄與段長固定，種子只改造型、配置和配色。外觀可見空隙仍由連續權威碰撞環封閉，禁止穿越；碰撞高度不隨隨機模型降低。消波塊、風機、堤防、城牆及其他陣列／長構造由模組種子重新生成，僅列入邊界型錄。

場內共用物件使用座標獨立種子選址，避開兵線、出生區、道路、圖資建築、水域與陡坡；碰撞由生成零件推導。新增物件不消耗植被共享亂數。一般 OSM 建物由既有多邊形程序建築生成器產生。

驗證：`node test/environmentObjects.mjs`；實際 Three.js 幾何檢查為 `THREE_MODULE=<本機 three.module.js 路徑> node test/environmentRender.mjs`。`node test/environmentObjects.mjs --serve` 在 http://127.0.0.1:8646 提供場景／邊界與種子對照（需 `out/forest_review/three.module.js`）。

### 邊界陡坡接縫

`edgeSlope.js` 以世界座標對齊的取樣站與固定斷面生成連續表面，城牆、路障、河堤、海堤、懸崖、山崩地、土石流的相鄰段共用端面座標。視覺段長取實際間距，避免重疊高低階差；碰撞盒保留原有重疊環，並包含整個貼坡表面的高低範圍，空隙仍不可穿越。

陡坡必須同時通過坡度上限與 `terrainFit` 能力檢查；剛性建築、車輛、風機、消波塊等不具連續貼坡能力者不加入陡坡候選。坡度量測涵蓋最深障礙物的完整外側底部。

驗證：`node test/edgeSlope.mjs`，以及模型對照頁的「陡坡：三段連續接縫」。

### 密集群落與地形型錄擴充（2026-09-11）

型錄新增 14 款，總計 54 款。依最高適用坡度分為陡坡 12、緩坡 7、平地 24，另有水域 11 款；高坡度能力亦可在較平緩的同類地貌出現。

- 陡坡新增：密集連綿神木林、山壁階地聚落、密集山城高樓、連綿草丘、林木連綿山丘、玄武岩連峰。
- 緩坡新增：梯田農舍帶、坡地溫室帶。
- 平地新增：密集倉儲工業帶、油槽儲運區、運河護岸。
- 水域新增：密集連綿礁岩、浮冰冰脊帶、港灣高腳倉庫群。

`EXPANDED_BOUNDARIES` 同時宣告地貌、坡度上限、固定尺寸與組裝配方。群落重用 `environmentParts` 的單體；樹冠可交疊，樹幹與建築保持直立，每件依腳下取樣建立根部／支撐基礎。連續底部表面維持共用端面，完整零件均收在權威碰撞包絡內。新增群落僅屬邊界型錄，不作一般場景單體。

預覽新增陡坡、緩坡、平地、水域分類；`test/edgeSlope.mjs` 同時驗證新增款式可被規劃器選中、剛性群落的坡度上限與全群碰撞包絡。
