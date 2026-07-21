<div align="center">

# 無人戰略:鋼鐵與蜂群 · Drone Tactics: Steel vs. Swarm

**在真實世界地圖上開戰的 DOTA × 第一人稱射擊對戰遊戲**
*A DOTA × FPS hybrid fought on 3D battlefields generated from real-world maps.*

一方操控**武裝無人機(蜂群兵團 🐝)**、一方駕駛**雙足機甲(鋼鐵軍團 🤖)**,沿真實道路兵線推進,摧毀敵方主堡獲勝。
*One side pilots armed **drones (the Swarm)**, the other drives bipedal **mechs (Steel)** — push down real-road lanes and destroy the enemy core to win.*

![status](https://img.shields.io/badge/status-alpha%20v0.1-orange) ![node](https://img.shields.io/badge/node-%E2%89%A518-brightgreen) ![deps](https://img.shields.io/badge/npm%20deps-1%20(ws)-blue) ![license](https://img.shields.io/badge/license-Apache%202.0-lightgrey)

</div>

---

## 目錄 · Table of Contents

1. [專案簡介 · Introduction](#專案簡介--introduction)
2. [核心功能 · Features](#核心功能--features)
3. [系統需求與安裝 · Prerequisites & Installation](#系統需求與安裝--prerequisites--installation)
4. [快速上手 · Quick Start](#快速上手--quick-start)
5. [操作說明 · Controls](#操作說明--controls)
6. [專案架構 · Project Structure](#專案架構--project-structure)
7. [開發與測試 · Development & Testing](#開發與測試--development--testing)
8. [外部資料來源 · External Data Sources](#外部資料來源--external-data-sources)
9. [授權條款 · License](#授權條款--license)

---

## 專案簡介 · Introduction

**繁體中文**
《無人戰略:鋼鐵與蜂群》是一款純瀏覽器、免安裝的即時多人對戰遊戲。玩家先在**真實世界地圖**上選定戰場,系統即時抓取地形高程、衛星影像與 OpenStreetMap 建物圖資,生成一張獨一無二的 3D 戰場。小兵皆為人類部隊(步兵、裝甲車、坦克),沿三條真實道路兵線推進;玩家則以第一人稱駕駛無人機或機甲參戰,摧毀敵方主堡即獲勝。

架構採**權威伺服器單體(Server-Authoritative Monolith)**:HP、傷害、彈藥、經濟與勝負全部由伺服器 (`server/sim.js`) 結算,客戶端僅負責輸入回報、8Hz 快照插值與表現層彈道物理。此設計是防作弊與跨裝置一致性的基礎。

**English**
*Steel vs. Swarm* is a browser-native, install-free real-time multiplayer game. Players pick a battlefield on a **real-world map**; the engine streams terrain elevation, satellite imagery, and OpenStreetMap building footprints to generate a unique 3D arena on the fly. Creeps are human units (infantry, APCs, tanks) marching along three real-road lanes, while players pilot drones or mechs in first person. Destroy the enemy core to win.

The game is a **server-authoritative monolith**: HP, damage, ammo, economy, and win/loss are all resolved on the server (`server/sim.js`). Clients only report input, interpolate 8 Hz snapshots, and run cosmetic ballistics — the foundation for anti-cheat and cross-device consistency.

---

## 核心功能 · Features

| | 功能 · Feature | 說明 · Description |
|---|---|---|
| 🗺️ | **真實地圖戰場** · Real-world battlefields | 21 個世界地標預設場地 + 自訂選點;OSRM 真實道路兵線、AWS 高程磚、Esri 衛星影像、Overpass 建物圖資即時生成 3D 地形。 |
| ⚔️ | **雙陣營非對稱對戰** · Asymmetric factions | 蜂群(無人機:高機動、垂直飛行、神風自爆)vs 鋼鐵(機甲:高耐久、重火力、蓄力跳躍/變形)。 |
| 🛡️ | **權威伺服器模擬** · Server-authoritative sim | 8Hz 快照廣播、伺服器端戰爭迷霧與 LOS 遮蔽、射程/高度複驗防作弊。 |
| 🤖 | **電腦玩家 (Bots)** · AI opponents | 狀態機 AI(推線 / 交戰保距 / 低血撤退 / 叢集放技),補空位即可單人開戰。 |
| 🌦️ | **動態環境** · Dynamic environment | 季節(春夏秋冬)× 日夜(白天/黃昏/夜晚)× 天氣(晴/陰/雨/雪/霧),開房時定案、全房一致。 |
| 💰 | **經濟與八軌升級** · Economy & upgrades | 擊殺賞金 + 被動收入;火力/裝甲/武器/招式八軌成長,主堡軍械庫補給。 |
| 🌋 | **戰場危險區** · Battlefield hazards | 水域凍結、沼澤扣血、火場霧化、隱蔽雷區、匿蹤防空伏擊、塔防空追蹤飛彈。 |
| 🎭 | **32 位英雄與招式** · Heroes & abilities | 各具武裝建模、開火/施法動畫、控場走位招式與 3D 演出。 |
| 🎬 | **劇情戰役與觀戰** · Campaign & spectator | 支援劇情戰役、觀戰模式、回房沿用同一張地圖再戰。 |
| 📦 | **零建置技術棧** · Zero-build stack | Vanilla ES-module + Three.js 0.160(CDN importmap),伺服器唯一 npm 依賴為 `ws`;無 bundler、無框架、無 TypeScript。 |

---

## 系統需求與安裝 · Prerequisites & Installation

### 系統需求 · Prerequisites

| 項目 · Item | 需求 · Requirement |
|---|---|
| **Node.js** | ≥ 18(建議 20 LTS 以上 / recommend 20 LTS+) |
| **npm** | 隨 Node.js 附帶 / bundled with Node.js |
| **瀏覽器 · Browser** | 支援 WebGL2 的現代瀏覽器(Chrome / Edge / Firefox)/ any modern WebGL2 browser |
| **網路 · Network** | 建議連網以抓取真實地圖資料;離線時自動退回程序生成戰場 / online recommended, offline falls back to procedural generation |

### 安裝步驟 · Installation

```bash
# 1. 取得原始碼 · Clone the repository
git clone <repository-url>
cd steel_vs_swarm

# 2. 安裝依賴(僅 ws 一個套件)· Install dependencies (single package: ws)
npm install

# 3. 啟動伺服器 · Start the server
npm start
```

伺服器預設監聽 `http://localhost:8620`。開啟瀏覽器連上即可遊玩。
*The server listens on `http://localhost:8620` by default — open it in your browser to play.*

> **自訂連接埠 · Custom port**:`node server/server.js --port 9000`
> ⚠️ PowerShell 的 `PORT=x` 前綴語法無效,請一律使用 `--port` 參數。
> *Use the `--port` flag; the `PORT=x` prefix does not work in PowerShell.*

---

## 快速上手 · Quick Start

多台裝置或多個瀏覽器分頁連上**同一台伺服器**即可對戰。
*Have multiple devices or browser tabs connect to the **same server** to play together.*

1. **建立地圖 · Build a map**(房主先建圖再開房 / host builds the map first)
   - **隊伍規模** N=1~5(總人數 2N)→ 兵線數 L=⌈N/2⌉,地圖大小綁定人數。
   - **場地**:21 個預設世界地標(路線預先計算,即選即用)或直接點真實地圖自訂(OSRM 掃描)。
   - **環境**:季節 × 日夜 × 天氣,開房時定案。

2. **加入房間 · Join a room**:各陣營 N 個席位(🐝 蜂群 / 🤖 鋼鐵),準備完成後由房主開戰;可用房間列表或 4 位數 PIN 加入,支援觀戰。

3. **補電腦玩家 · Add bots**:房主可在任何空位補「🤖 電腦玩家」,單人也能開戰。

4. **開戰 · Fight**:所有玩家即時建構 3D 戰場,沿三路兵線推進,摧毀敵方主堡獲勝。

> 對局節奏 · Match pace:1 / 2 / 3 線設計場均約 **5 / 8 / 10 分鐘**(主堡 3000 HP、塔 1000 HP)。

---

## 操作說明 · Controls

第一人稱駕駛視角(看得見自己的武器與部分機身)。
*First-person cockpit view — you can see your own weapon and part of the chassis.*

| | 🐝 蜂群(無人機)· Swarm (Drone) | 🤖 鋼鐵(機甲)· Steel (Mech) |
|---|---|---|
| **移動 · Move** | W/S 沿視線飛(抬頭爬升/低頭俯衝)+ A/D 橫移 + Space/C 升降 | WASD + Space 跳躍 |
| **視角 · Look** | 滑鼠(FOV 廣) | 滑鼠 |
| **左鍵 · LMB** | 蜂刺機槍 | 重型機槍 |
| **右鍵 · RMB** | 重型炸彈(自爆/撞擊引爆,重生無冷卻) | 肩射火箭(×3,大後座) |
| **切換武器 · Switch** | 1 / 2(自帶 + 加購 1 件) | 1 / 2 / 3(自帶 + 加購 2 件) |
| **通用 · Common** | R 填彈 ・ B 軍械庫 ・ Shift 加速 ・ M 大地圖 | R 填彈 ・ B 軍械庫 ・ Shift 衝刺 ・ M 大地圖 |

**兵種對比 · Unit comparison**(彼此約為 2 倍關係 / roughly 2× relationship)
- **機甲 · Mech**:HP 高、彈夾大、可加購 2 件熱兵器;**重生有冷卻**。
- **無人機 · Drone**:速度快、視野廣、垂直機動;彈夾小、可加購 1 件;**重生無冷卻**(神風玩法)。

---

## 專案架構 · Project Structure

```
steel_vs_swarm/
├── server/
│   ├── server.js      # HTTP 靜態檔 + WS 房間/配對 + 8Hz 快照廣播 + bot 管理
│   ├── sim.js         # BattleSim:權威模擬核心(唯一真相 / single source of truth)
│   └── bots.js        # BotBrain:電腦玩家狀態機(推線/交戰/撤退)
├── public/
│   ├── index.html     # 進入點(大廳 → 配對 → 選址 → 戰鬥)
│   ├── css/style.css  # 介面樣式
│   └── js/
│       ├── data.js        # 全遊戲平衡數值唯一真相(伺服器直接 import)
│       ├── main.js        # 畫面流程(大廳/配對/選址/載入/戰鬥)
│       ├── game.js        # BattleClient:FPV 座艙、物理、快照插值、彈道、命中回報
│       ├── net.js         # WebSocket 客戶端(斷線重連)
│       ├── mapSelect.js   # 真實地圖選點 + 主堡推薦演算法
│       ├── venues.js      # 預設場地 + 我的最愛
│       ├── venueLanes.js  # 離線烘烤的真實道路兵線
│       ├── terrain.js     # 即時 3D 地形(高程 + 衛星貼圖)
│       ├── biomes.js      # 地貌/植被/OSM 建物/橋隧/水域
│       ├── models.js      # 單位建模(Quaternius GLB + 程序生成備援)
│       ├── locomotion.js  # 步態/開火/施法/跳躍動畫
│       ├── environment.js # 季節/日夜/天氣
│       └── ...            # castfx / hazards / vfx / toon / paint / hud 等
├── tools/             # 離線工具:平衡驗證、兵線烘烤、稽核腳本、LOGO 管線
├── test/
│   ├── e2e.mjs        # BattleSim 單元測試 + WebSocket 端對端(約 60+ 斷言)
│   └── simrun.mjs     # headless 加速模擬(平衡/難度壓測)
├── reference/         # 上游唯讀副本(mapping_elf / ai_tycoon)— 僅供參考
├── docs/              # 角色與劇情文件
├── package.json
└── LICENSE            # Apache License 2.0
```

**分層心智模型 · Layering mental model**
- `server/sim.js` 是唯一真相;客戶端只做輸入回報、快照插值與表現層物理。
- 所有平衡數值只住 `public/js/data.js`,伺服器直接 import — 單一結算縫,不重複實作。

---

## 開發與測試 · Development & Testing

```bash
npm start   # 啟動伺服器 http://localhost:8620(--port <n> 覆寫)
npm run dev # 同 start,固定 --port 8620
npm test    # node test/e2e.mjs,約 60+ 項斷言(不會自動啟動伺服器)
npm run sim # headless 加速模擬完整 bot 對局(平衡/難度壓測)
npm run bal # 平衡不變式驗證(兵種戰力、塔位重疊、經濟曲線、拆塔剩血)
```

> **測試注意 · Testing note**:`npm test` 僅是 WebSocket client,**不會自動重啟伺服器**。
> 修改伺服器程式碼後,務必先重啟 `node server/server.js` 再跑測試,否則會測到舊程式碼。
> *`npm test` is only a WS client and does not restart the server — restart it manually after editing server code.*

---

## 外部資料來源 · External Data Sources

即時抓取,並在限流/離線時自動退回程序生成 fallback。
*Fetched live, with automatic procedural fallback on rate-limit or offline.*

| 資料 · Data | 來源 · Source |
|---|---|
| 道路兵線 · Road lanes | OSRM (`router.project-osrm.org`) → 貝茲合成路徑 |
| 地形高程 · Elevation | AWS Terrain Tiles (terrarium) → open-meteo elevation |
| 圖磚/衛星 · Tiles/Satellite | OpenStreetMap / OpenTopoMap / Esri World Imagery |
| 建物 · Buildings | Overpass API → 程序生成街區 |
| 地名 · Geocoding | Nominatim reverse geocoding |
| 3D 模型 · 3D models | Quaternius(CC0 1.0)+ 程序生成備援 |

---

## 授權條款 · License

本專案採用 **Apache License 2.0** 授權。詳見 [LICENSE](LICENSE) 檔案。
*This project is licensed under the **Apache License 2.0**. See the [LICENSE](LICENSE) file for details.*

```
Copyright 2026 Chang Wei Lin

Licensed under the Apache License, Version 2.0 (the "License");
you may not use this file except in compliance with the License.
You may obtain a copy of the License at

    http://www.apache.org/licenses/LICENSE-2.0

Unless required by applicable law or agreed to in writing, software
distributed under the License is distributed on an "AS IS" BASIS,
WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
See the License for the specific language governing permissions and
limitations under the License.
```

> **第三方資產 · Third-party assets**:3D 模型來自 [Quaternius](https://quaternius.com)(CC0 1.0);地圖資料來自 OpenStreetMap 貢獻者(ODbL)。這些資產保有各自的授權條款。
> *3D models by Quaternius (CC0 1.0); map data © OpenStreetMap contributors (ODbL). These assets retain their respective licenses.*
