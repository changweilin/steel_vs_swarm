# 啟動時生成與部署 3D 場景實體

流程：資產與地形並行準備 → 確定性選址／組裝 → 原型幾何編譯 → 配色分批 → 場景部署。

啟動不呼叫 AI 生成服務。正式零件資料在本機組裝成真正的頂點、法線與色彩緩衝，再建立 Mesh／InstancedMesh；外部模型缺席沿用現有程序生成備援。雲端、區網與單機共用此流程。

| 階段 | 入口 | 契約 |
| --- | --- | --- |
| 準備 | `main.js startPrebuild` | 模型與地形並行；零件庫與路網準備完成才建場景 |
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
