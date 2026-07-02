# 無人戰略:鋼鐵與蜂群 (Drone Tactics: Steel vs. Swarm)

DOTA × 第一人稱射擊:一方操作**武裝無人機(蜂群兵團)**,一方駕駛**雙足機甲(鋼鐵軍團)**,
在**真實世界地圖**上生成的 3D 戰場對決。小兵皆為人類部隊(步兵/裝甲車/坦克),
沿三條真實道路兵線推進,摧毀敵方主堡獲勝。

## 快速開始

```bash
npm install
npm start            # http://localhost:8620(支援 --port 參數)
```

多台裝置(或多個瀏覽器分頁)連上同一伺服器:
1. 房主**先建地圖再開房**(開房前設定畫面):
   - **隊伍規模** N=1~5(總人數 2N)→ 兵線 L=⌈N/2⌉ 條,地圖邊長正比 L(5v5 為基準 ≈ 4km)
   - **場地**:21 個世界地標/風景區預設場地(市區/綠地/裸露地/水體/濕地 單一 80% 或混合)
     — **路線/圖資預先算好(確定性幾何),即選即用免掃描**;
     或直接點真實地圖自訂(OSRM 真實道路掃描);可 ⭐ 存入「我的最愛」下次直接用
   - **環境**:季節(春夏秋冬)× 日夜(白天/黃昏/夜晚)× 天氣(晴/陰/雨/雪/霧),預設隨機,開房時定案
   - 選址演算法:兩主堡距離 ≥ **地圖對角線 80%**;兩點間 **L 條真實道路路徑**任兩條**重合 < 20%**
2. 玩家加入 → 各陣營 **N 個席位**(🐝 蜂群 = 無人機 / 🤖 鋼鐵 = 機甲)→ 準備完成 → 房主開戰
3. 所有玩家**即時抓取真實地形高程 + 衛星影像 + OSM 建物圖資**建構 3D 戰場:
   - 依衛星影像分類五類地貌鋪設植被:竹林(大小群落)/闊葉/針葉、芒草/箭竹/灌木/多肉、紅樹林/蘆葦
   - 市區依 OSM 圖資放置住宅/商辦/醫院/學校/車站/寺廟/教堂/清真寺/博物館/電塔/工廠(離線退回程序生成)
   - 兵線走廊保持淨空(> 4 台機甲並行寬度)
4. **電腦玩家**:房主可在任何空位補「🤖 電腦玩家」(伺服器端 AI:沿兵線推進、
   交戰保距離、低血撤退回堡、叢集丟範圍技)→ 單人也能開戰;亦支援觀戰模式;回房再戰沿用同一張地圖

### 操作(第一人稱駕駛視角:看得到自己的武器與部分機身)
| | 蜂群(無人機) | 鋼鐵(機甲) |
|---|---|---|
| 移動 | **W/S 沿視線飛(抬頭爬升/低頭俯衝)**+ A/D 橫移 + Space/C 升降 | WASD + Space 跳躍 |
| 視角 | 滑鼠(點畫面鎖定;2D 操作映射 3D FPV 飛行) | 滑鼠 |
| 左鍵 | 機砲 | 重機槍 |
| 右鍵 | 空投炸彈(範圍) | 肩射火箭(範圍,大後座) |
| 其他 | Shift 加速 ・ M 大地圖 | Shift 衝刺 ・ M 大地圖 |

### 物理
- **碰撞**:座機不能穿過小兵/坦克/防禦塔/主堡(圓柱推擠,含高度判定 — 飛過塔頂不碰撞);射擊 raycast 打單位+地形
- **後座力**:開火視角上踢+隨機偏擺、槍身後坐+槍口焰;無人機吃反作用力後推、機甲火箭整台被推退
- **爆炸衝擊**:任何爆炸(炸彈/火箭/飛彈/單位殉爆)近距離會把座機掀飛 + 鏡頭震動(隨距離衰減)
- **防空飛彈**:防禦塔對離地 ≥ 40m 的無人機發射 3D 追蹤飛彈(伺服器權威、近炸引信),
  被鎖定會收到警告 — 低飛可脫鎖,但會進塔砲射程;FPV 側傾、無人機急轉有機身壓坡

## 程式碼來源(整合)

| 模組 | 來源 | 說明 |
|---|---|---|
| 2D 地圖 / 路線計算 | **mapping_elf**(`reference/mapping_elf/`)| Leaflet 圖層設定(mapManager)、OSRM 路線 + 端點錨定(routeEngine) |
| 3D 地形即時繪製 | **mapping_elf** terrainViewer | 高程網格 + 平滑 + 貼圖;高程備援 open-meteo 批次查詢是原專案手法 |
| 房間系統 / 配對 | **ai_tycoon**(`reference/ai_tycoon/`)| HTTP 靜態檔 + WS 房間、PIN、公開/私人房、斷線重連 token、房主轉移 |
| 3D 單位模型 | **Quaternius**(CC0 1.0)| `public/assets/models/quaternius/`;MODEL_MANIFEST 機制承襲 ai_tycoon board3d |

新寫的整合層:`server/sim.js`(兵線模擬,多英雄以 pid 為鍵)、
`public/js/{mapSelect,terrain,models,game,main}.js`,以及
`public/js/venues.js`(預設場地/我的最愛)、`public/js/biomes.js`(五類地貌 + OSM 建物 + 兵線淨空)、
`public/js/environment.js`(季節/日夜/天氣,粒子手法參考 mapping_elf weatherFx3D)。

### 3D 模型(Quaternius CC0,可自行替換)
`public/js/models.js` 的 `MODEL_MANIFEST` 指定每種單位的 GLB;
載入失敗自動退回程式生成的低多邊形版本(坦克/裝甲車/無人機目前即為程式生成,
想升級就丟 `.glb` 進 `public/assets/models/quaternius/` 並改 manifest 一行)。

## 外部資料來源(即時抓取)
- 路線:OSRM demo(`router.project-osrm.org`,driving)
- 高程:AWS Terrain Tiles(terrarium)→ 備援 open-meteo elevation
- 圖磚:OpenStreetMap / OpenTopoMap / Esri World Imagery(衛星,亦為 3D 地形貼圖與地被分類依據)
- 建物:Overpass API(`overpass-api.de`,建物 footprint + 用途標籤;10 秒無回應退回程序生成街區)
- 地名:Nominatim reverse geocoding
- 無網路時:兵線改用貝茲模擬路徑,仍可遊玩(標示「離線模擬路徑」)

## 架構
```
server/server.js   房間配對 + 靜態檔 + 戰鬥廣播(8Hz)+ 電腦玩家管理
server/sim.js      伺服器權威模擬:波次、小兵 AI、塔/主堡、英雄 HP、防空飛彈、勝負
server/bots.js     電腦玩家 AI(狀態機:推線/交戰/撤退;NPC 路線 = 房間兵線)
public/js/
  data.js          雙端共用數值(陣營/單位/節奏/防空)
  net.js           WS 客戶端(斷線重連,改自 ai_tycoon)
  mapSelect.js     真實地圖選點 + 主堡推薦演算法(距離/三線重合檢定)
  venues.js        預設場地(預先計算 battleConfig)+ 我的最愛
  terrain.js       即時 3D 地形(高程 + 衛星貼圖 + heightAt 取樣)
  models.js        Quaternius GLB + 程式生成備援
  game.js          FPV 座艙、物理(碰撞/後座力/爆炸衝擊)、快照插值、命中回報、特效、2D 戰術地圖
  main.js          畫面流程(大廳→配對→選址→載入→戰鬥)
```
