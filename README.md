# 無人戰略:鋼鐵與蜂群 (Drone Tactics: Steel vs. Swarm)

DOTA × 第一人稱射擊:一方操作**武裝無人機(蜂群兵團)**,一方駕駛**雙足機甲(鋼鐵軍團)**,
在**真實世界地圖**上生成的 3D 戰場對決。小兵皆為人類部隊(步兵/裝甲車/坦克),
沿三條真實道路兵線推進,摧毀敵方主堡獲勝。

## 快速開始

```bash
npm install
npm start            # http://localhost:8620(支援 --port 參數)
```

兩台裝置(或兩個瀏覽器分頁)連上同一伺服器:
1. **建立戰區** → 各自選陣營(🐝 蜂群 = 無人機 / 🤖 鋼鐵 = 機甲)→ 準備完成
2. 房主**戰場選址**:在真實地圖點一個點(蜂群主堡),演算法推薦多個對點:
   - 兩主堡距離 ≥ **地圖對角線 80%**(戰場規模 ≈ DOTA)
   - 兩點間有 **3 條真實道路路徑**,任兩條**重合 < 20%**(= 80% 不重合)→ 三路兵線
3. 選定後所有玩家**即時抓取真實地形高程 + 衛星影像**建構 3D 戰場,自動開戰
4. 也支援單人練習(只有一位玩家時)與觀戰模式

### 操作
| | 蜂群(無人機) | 鋼鐵(機甲) |
|---|---|---|
| 移動 | WASD + Space/C 升降 | WASD + Space 跳躍 |
| 視角 | 滑鼠(點畫面鎖定) | 滑鼠 |
| 左鍵 | 機砲 | 重機槍 |
| 右鍵 | 空投炸彈(範圍) | 肩射火箭(範圍) |
| 其他 | Shift 加速 ・ M 大地圖 | Shift 衝刺 ・ M 大地圖 |

## 程式碼來源(整合)

| 模組 | 來源 | 說明 |
|---|---|---|
| 2D 地圖 / 路線計算 | **mapping_elf**(`reference/mapping_elf/`)| Leaflet 圖層設定(mapManager)、OSRM 路線 + 端點錨定(routeEngine) |
| 3D 地形即時繪製 | **mapping_elf** terrainViewer | 高程網格 + 平滑 + 貼圖;高程備援 open-meteo 批次查詢是原專案手法 |
| 房間系統 / 配對 | **ai_tycoon**(`reference/ai_tycoon/`)| HTTP 靜態檔 + WS 房間、PIN、公開/私人房、斷線重連 token、房主轉移 |
| 3D 單位模型 | **Quaternius**(CC0 1.0)| `public/assets/models/quaternius/`;MODEL_MANIFEST 機制承襲 ai_tycoon board3d |

新寫的整合層:`server/sim.js`(兵線模擬)、`public/js/{mapSelect,terrain,models,game,main}.js`。

### 3D 模型(Quaternius CC0,可自行替換)
`public/js/models.js` 的 `MODEL_MANIFEST` 指定每種單位的 GLB;
載入失敗自動退回程式生成的低多邊形版本(坦克/裝甲車/無人機目前即為程式生成,
想升級就丟 `.glb` 進 `public/assets/models/quaternius/` 並改 manifest 一行)。

## 外部資料來源(即時抓取)
- 路線:OSRM demo(`router.project-osrm.org`,driving)
- 高程:AWS Terrain Tiles(terrarium)→ 備援 open-meteo elevation
- 圖磚:OpenStreetMap / OpenTopoMap / Esri World Imagery(衛星,亦為 3D 地形貼圖)
- 地名:Nominatim reverse geocoding
- 無網路時:兵線改用貝茲模擬路徑,仍可遊玩(標示「離線模擬路徑」)

## 架構
```
server/server.js   房間配對 + 靜態檔 + 戰鬥廣播(8Hz)
server/sim.js      伺服器權威模擬:波次、小兵 AI、塔/主堡、英雄 HP、勝負
public/js/
  data.js          雙端共用數值(陣營/單位/節奏)
  net.js           WS 客戶端(斷線重連,改自 ai_tycoon)
  mapSelect.js     真實地圖選點 + 主堡推薦演算法(距離/三線重合檢定)
  terrain.js       即時 3D 地形(高程 + 衛星貼圖 + heightAt 取樣)
  models.js        Quaternius GLB + 程式生成備援
  game.js          FPS 操控、快照插值、命中回報、特效、2D 戰術地圖
  main.js          畫面流程(大廳→配對→選址→載入→戰鬥)
```
