# 無人戰略:鋼鐵與蜂群 (Steel vs. Swarm) — 全域儲存庫準則

> **本檔定位**:四層情境系統的**第一層(全域層)**,只放「每一次改動都適用」的東西 —— 原則、技術棧、縫的**目錄**、禁令的**索引**、指令與驗證通則。**MUST 保持精簡**(目標 ≤ 32KB);任何一段長到需要逐項展開,就是它該搬去第二層的信號。
>
> | 層 | 住哪裡 | 什麼時候讀 |
> |---|---|---|
> | ① 全域層 | **本檔** | 每次都讀(自動載入) |
> | ② 規則層 | [`.claude/rules/*.md`](.claude/rules/) | 由本檔的觸發列指名時讀 |
> | ③ 模組層 | [`public/js/.claude.md`](public/js/.claude.md)・[`server/CLAUDE.md`](server/CLAUDE.md)・[`tools/CLAUDE.md`](tools/CLAUDE.md) | 動到該目錄的檔案時讀 |
> | ④ 細節層 | 各 `tools/audit_*.mjs` **檔頭註解**與斷言本身 | 要改某條判定時讀 |
>
> 關鍵詞 **MUST / MUST NOT / SHOULD** 依 RFC-2119 解讀。違反 MUST NOT 條目 = 架構違規,直接退回。
> **細節住哪裡**:逐項斷言、幾何公式、邊界案例、**壞掉時的症狀敘事**一律住第 ④ 層;使用者定案的原句與當時的實測數字住 git 歷史。查細節先開稽核腳本,MUST NOT 憑記憶重建、也 MUST NOT 把那些敘事搬回第 ①② 層(2026-08-10 精煉與 2026-08-16 分層的唯一理由就是它們被搬回來過)。
> **精煉基準日 2026-08-10;分層基準日 2026-08-16**(§2.1 縫全文、§3 A 表全文、§5.5 驗證矩陣、§6 退場清單自該日起住第 ② 層,**編號一格未動**)。

---

## 0. 核心原則(全部 MUST 內化;後文一切規則都是這十條的具體化)

1. **伺服器唯一真相**:HP/傷害/彈藥/經濟/勝負全在 `server/sim.js` 結算。客戶端只做三件事 —— 送輸入與命中回報、渲染 8Hz 快照插值、跑表現層彈道/物理。MUST NOT 有任何「客戶端先改狀態再同步」;防作弊驗證(射程 ×1.25、迷霧、LOS、高度)只住伺服器。
2. **單一真相縫(Single Seam)**:跨檔共用的邏輯與數值只准有**一個**結算點,發現第二份實作即是 bug;推導得出的值 MUST NOT 手寫。縫的索引見 §2.1。
3. **兩端同量體**:碰撞、彈道、命中、LOS 在客戶端與伺服器 MUST 吃同一份幾何(同一個盒/圓柱/垂直帶/半徑)。兩端分家的代價不是「差一點」而是**靜默丟包** —— 客戶端算命中、伺服器算被擋,傷害無聲蒸發(A18/A30 一族)。
4. **表現層歸表現層**:純視覺改動(材質/擺件/擋土牆/緣石/座艙)MUST NOT 動到權威幾何(通行寬/碰撞/LOS/平衡);反過來,演出取用的尺寸 MUST 來自權威值(看到多粗 = 打到多粗),MUST NOT 為了好看自己放大。
5. **確定性**:場景佈局跨客戶端逐位元一致,散布路徑 MUST NOT 用 `Math.random()`(細則 §2.3)。
6. **降級,不例外;寧缺勿錯**:外部服務掛掉走 fallback、取樣不到合法位置回 null 略過、伺服器對回報「驗證後靜默丟棄」(細則 §2.4、§4)。
7. **真實世界尺度**:`SOLDIER_H`(1.8m)是唯一身高單位,MUST NOT 調回超尺度(細則 §2.5)。
8. **三機制一架構**:雲端/區網/單機只換**傳輸層**不換架構;`rooms.js`/`sim.js`/`bots.js` MUST 保持瀏覽器可執行,URL 佈局 MUST 鏡射儲存庫佈局(A28)。
9. **稽核為正 + 反向驗證**:本專案無 runtime logger;正確性防線 = 離線稽核(`tools/audit_*.mjs`,以 **執行原文** 驗真品)+ e2e + `npm run bal`。新增系統 SHOULD 同步補稽核而非加 log。**改任何有稽核的判定,改完 MUST 做反向驗證**:把判定故意寫回壞版/舊制,稽核 MUST 在對應條目紅字,否則等於沒驗到。
10. **刻意設計 MUST NOT「補完」**:一批看似 bug 的行為是刻意取捨,修它就是引入 bug —— 彈藥漂移(A9)、爆風不吃 LOS(A11)、直升機不接塔 SAM(A15)、貫穿判定是 2D 而非 3D(A18)、對進戰模型只算武器(§2.1)、AoE 不爆擊(§4)。動手前先查 A 表與 §6。

---

## 1. 系統架構與技術棧

**產品**:瀏覽器 DOTA+FPS — 蜂群同盟 (SWARM) vs 鋼鐵協約 (STEEL);兩陣營主力機種不同但**皆為三機種混編**。真實世界地圖選址 → OSRM/Overpass 取真實道路兵線 → 即時 3D 地形開戰。

**架構型態:Server-Authoritative Monolith**。三種遊戲機制(雲端伺服器 / 區網 Tailscale / 單機)共用 `server/rooms.js`(`RoomHub`)與 `server/sim.js`;單機 = 把伺服器整支搬進瀏覽器分頁跑,客戶端一樣只送輸入、收 8Hz 快照 —— MUST NOT 為單機另寫「客戶端自己算」的路徑。

**技術棧絕對規則**

| 項目 | 規則 |
|---|---|
| Runtime | Node.js;唯一 npm 依賴 = `ws`。**MUST NOT** 新增任何 npm 依賴 |
| 前端 | vanilla ES-module JS + Three.js 0.160(CDN importmap)。新函式庫一律 CDN importmap,且**先有離線 fallback 才准接** |
| 建置 | **無 build step、無 bundler、無框架、無 TypeScript — MUST NOT 引入以上任何一項** |
| 語言 | 註解與 UI 字串一律**繁體中文** |
| 3D 資產 | CC0 開源模型優先(`MODEL_MANIFEST` + 程序生成 fallback);法線貼圖 **MUST** 刪除並重寫 gltf 移除引用 |

**分層職責**

| 路徑 | 職責 |
|---|---|
| `server/server.js` | 傳輸層:HTTP 靜態檔 + WebSocket + `/healthz`;另有 `/dev/tools` **開發期路由**(只把 loopback 請求轉給 `tools/dev_supervisor.mjs`;雲端模式不掛、出貨版沒有 `tools/`) |
| `server/rooms.js` | `RoomHub` 房間/配對/8Hz 戰鬥生命週期 — 三機制共用,MUST 保持瀏覽器可執行 |
| `server/sim.js` | `BattleSim` 權威模擬核心(single source of truth) |
| `server/bots.js` | `BotBrain` 電腦玩家狀態機(推線/交戰/撤退) |
| `public/js/data.js` | 全遊戲平衡數值唯一真相;**伺服器直接 import 這支客戶端檔** |
| `public/js/geo3d.js` | 程序生成幾何積木唯一縫(`models.js` / `forge/geo.js` / 機體台舊版對照三邊同吃) |
| `public/js/forge/**` | **英雄機體建模**:鷹架 + 多面體零件語彙 + 逐機檔 40 格 + 名冊(2026-08-14 起遊戲與機體台同吃一份) |
| `public/js/*.js` | 渲染/FPV/輸入/HUD(檔案地圖見 `public/js/.claude.md`) |
| `tools/` | 離線工具:平衡驗證、兵線烘烤、稽核腳本、單機版打包、LOGO/資產管線 |
| `.github/workflows/` | 回歸驗證 CI + 單機特化版部署 GitHub Pages |
| `test/e2e.mjs` | 前段 `BattleSim` 確定性單元測試 + 後段 WebSocket 端對端 |
| `reference/` | 上游唯讀副本 — **MUST NOT** 修改,只准參考 |

---

## 2. 通用標準與慣例

### 2.1 單一真相縫索引(**目錄在此,全文住 `.claude/rules/seams-*.md`**)

每列 = 一個縫。**共通鐵律(不逐列重述)**:消費端 MUST 全部走這個縫、MUST NOT 另寫第二份實作或在別處二次運算、**推導值 MUST NOT 手寫**、純表現層 MUST NOT 動權威幾何。「稽核」欄 = 該縫的細節與症狀敘事所在(檔頭),改它先開那支。

**動到下列任一主題,MUST 先讀對應那一支的全文**;現役 159 列縫,下表只列主題名。查不到主題時 `grep -rn "<關鍵詞>" .claude/rules/` —— **MUST NOT 因為目錄裡沒看到就認定沒有規則**。

| 規則檔(= 原 §2.1 分節) | 涵蓋的縫 |
|---|---|
| [`seams-balance.md`](.claude/rules/seams-balance.md)<br>**§2.1 A 平衡與角色** | 平衡數值・角色機種・推導值・英雄武器與招式解析・傷害衰減・陣營對抗對稱化・目標類別剋制與建築加乘・護盾裝甲分軌剋制・護盾軸配置紀律・對建築 DPS 收斂・三軸預算(範圍/機動/射程)・攻擊範圍收斂・射速壓縮與連發演出・機體移速壓縮・開火中位移懲罰・圖鑑六角能力圖・波次編制與節奏・陣營小兵強化・八軌階梯(價格 + 戰鬥分數門檻)・戰鬥分數・攻堅順序(劇情戰役鎖血)・劇情階段對話・劇情畫面標記・環境標籤・對進戰模型・前線交戰模型 |
| [`seams-abilities.md`](.claude/rules/seams-abilities.md)<br>**§2.1 B 招式 / 大招 / 載具** | 招式啟動手勢・招式載具的發射點與槽位 CD 帶・大招載具遞送・自身強化型輔助機隊・純自身型大招補償・機種絕招預算・三種載具形式(無人機/變形者/機甲)・絕招載具 HP 校準與爆風面積計價・飛行動力學(受擊掉高 / 爬升動力) |
| [`seams-weapons.md`](.claude/rules/seams-weapons.md)<br>**§2.1 C 武器判定 / 彈道** | AoE 與彈道分類・「打得到嗎」判定・範圍光暈名冊・扇形錐緣・閃避範圍與維持 DPS 補償・高地壓制・爆風超壓帶・射程界・引爆 = 碰撞・射程球心 = 擊發位置・出膛初速與飛行時間・榴彈火控・導引頭機動・射程閘門容差・高度制空射程・地形稜線遮蔽・貫穿演出・彈匣惰性補彈・機體高度與半徑 |
| [`seams-bots.md`](.claude/rules/seams-bots.md)<br>**§2.1 D 電腦玩家(bot)** | 操作節奏・視野・戰術(選敵/撤退/打帶跑)・定位分類與策略・學習策略・碰撞量體與實體碰撞 |
| [`seams-terrain.md`](.claude/rules/seams-terrain.md)<br>**§2.1 E 地形 / 結構 / 通行** | 迷你地圖・劇情戰役地圖與 NPC BOSS・砲塔佈局規則・兵線導航規則・離線工具的地形圖資剖面・隧道與地下道剖面・隧道頂板・道路塗裝寬與結構接合・明隧道判定・道路路基整平・地形坡度移動・經緯度→世界公尺(含地圖主方位)・戰場世界方框與抓取範圍・道路 16 方向量化・立體結構建置範圍・飛行體貼地渲染基準・世界高度上限・世界邊界(環 + 緩衝空間)・邊界牆型錄與緩衝布景・巨岩表面落點・圓形腳印落底・攀爬路線・可通行性 |
| [`seams-render.md`](.claude/rules/seams-render.md)<br>**§2.1 F 表現層 / 畫面** | 時間流逝與太陽月亮影子・賽璐璐明暗階梯・後製管線・描邊寬度・世界曲面・景深模糊・空氣透視・勾線資訊緩衝・3D LUT 調色・地貌不出接縫・建構期讓步・畫面表現旋鈕・陰影偏色・地表屬性場・風化屬性場・軟性物質・陣風包絡・海浪・國旗・零件級細節抖動・表現層資源生命週期・英雄機體建模・FPV 座艙・變形者的變形過程・步態關節曲線・交戰姿態・跳躍分級・**幀率無關阻尼**・共用視覺入口 |
| [`seams-world.md`](.claude/rules/seams-world.md)<br>**§2.1 G 世界內容** | 都市計畫・樹冠羞避・地貌拼圖的顏色與花紋・地被貼合抬升・陸域地貌認養地形三角形・農田田埂與田塊對齊・農牧地表四季・地質排列・聚落場與建物來源信任階梯・場地地貌宣告 vs 圖資實測・語意化地標・世界文字・在地文字語料・AI 零件庫消費・建物零件庫・整棟量體輪廓剖面・平整垂直牆面板・平面整平與去噪封底・img→3D 自動入庫與撤下・採集迴圈啟停與圖檔三態・人眼判決字彙與封存區・來源帳的鍵・重跑順位・鏡像貼補・角色機體檔案格式 |
| [`seams-ui-net.md`](.claude/rules/seams-ui-net.md)<br>**§2.1 H HUD / 輸入 / UI / 連線** | 連線機制・路網中繼・區網同時多路徑・操作方式・戰場選單開關・視野鎖定・觀戰相機・商店掃貨與預約・受擊濺血提示・異常狀態致盲白幕・蓄力跳水平移速・GUI 說明與懸浮提示・分段按鈕樣式・NPC 建築機種圖示・**觸控「一次點擊」的判定**・**視窗尺寸定案(旋轉 debounce)**・決定性亂數 |
### 2.2 狀態鍵與迴圈粒度
- 英雄以 **pid(連線 id)為鍵**存於 `heroes` Map(bot 用字串 pid 如 `'b1'`);MUST NOT 改用陣列索引或 socket 物件當鍵。
- 小隊共享狀態(金錢/電力/彈藥/招式)住 `sq.ps`,經 `_bindShared()` getter 掛回每架 ent。迴圈粒度 MUST 分清:`heroes.values()` = 一隊一次;`_allBodies()` = 每架一次 —— 搞錯 = 收入三倍或增益疊三層。

### 2.3 確定性(Determinism)
- 跨客戶端場景一致靠 `mulberry32`(戰場中心為種子);隨機散布 MUST NOT 用 `Math.random()`。
- 抽樣紀律:每候選消耗**固定枚數**亂數、淘汰檢查一律排在抽樣**之後**;MUST NOT 改成「淘汰就跳過抽樣」。
- **新增的世界內容一律要問「這一段消耗了幾枚共享 `rnd()`」** —— 多抽一枚就把後面每一株植被、每一棟建物的佈局整條推移,而畫面上只表現成「整張圖變了」,沒有任何錯誤訊息。街廓/公設/地標/世界文字/邊界環一律**零共享消耗**(外觀差異由落點雜湊自帶種子)。

### 2.4 外部服務防禦
- OSRM / Overpass / AWS 地形磚 / Esri 影像皆會限流或掛掉:每條 fetch 路徑 MUST 保留程序生成 fallback,改 fetch 邏輯時 MUST NOT 移除。
- **鏡像輪替 MUST 逐站計時**(唯一縫 = `biomes.overpassQuery()`;Node 端 `venue_field.overpass()` 一向如此):一組鏡像共用**一個** `AbortController` 的話,任何一站「掛住不回應也不斷線」就吃光整份預算 ⇒ 路網拿不到 = **一張圖上的立體結構整批消失**且無錯誤訊息。總預算只准決定「什麼時候收手」,MUST NOT 用來中止單一次嘗試。

### 2.5 世界尺度
- `SOLDIER_H`(真人 1.8m)是全遊戲唯一身高單位;人員/載具/建物一律用真實公稱尺寸,英雄體型只住 `heroTargetH()`。
- 兩個比例尺都在戰鬥層**之外**一次套完,MUST NOT 滲進任何射程/彈道判定:`REAL_SCALE`(遊戲世界 = 真實 ×2)只住經緯度→遊戲公尺的邊界(`llToMeters`/`SC_GAME`)、`COMBAT_SCALE`(reach 減半)只住 `data.js` 統一縮放塊(`game.js`/`sim.js` 全檔不得出現它)。
- 改 `REAL_SCALE` MUST 同步 +1 `GEO_SCALE_VER` 並重跑 `node tools/bake_venue_lanes.mjs`。

---

## 3. 絕對反模式 A 表(**索引在此,全文住 [`.claude/rules/antipatterns.md`](.claude/rules/antipatterns.md)**)

> 編號被 `siteplan.js`/`prompt.mjs`/`sim.js`/各稽核的註解交叉引用 ⇒ **MUST NOT 重新編號**(A38 曾被兩個條目共用,2026-08-10 把未被引用的那一條移到 A41 解決衝突;檔內順序因此是 …A40, A42, A43, A41, A44…)。
> 下表每列**只是主旨**。要動到、要引用、或不確定某條涵蓋範圍時,**MUST 開全文讀那一列** —— 憑主旨行動 = 憑記憶重建規則。

| # | 主旨(全文見 `antipatterns.md`) |
|---|---|
| A1 | 客戶端 MUST NOT 先改權威狀態;防作弊 MUST NOT 下放 |
| A2 | MUST NOT 新增 npm 依賴 / build 工具 / TypeScript / 框架 |
| A3 | MUST NOT 修改 `reference/` |
| A4 | 確定性散布路徑 MUST NOT 用 `Math.random()` |
| A5 | 重武器 CD 唯一實作 = `mag:1 + reload=cd` |
| A6 | raycast 只打單位;地形走解析射線、建物巨物走解析圓柱/盒 |
| A6b | 塗層雙面阻擋:擋得住砲火的面同時 MUST 是站立面 |
| A7 | 失鎖直飛只給雷射導引與塔 SAM;射後不理刻意不吃 |
| A8 | FOV 全機種 68(zoom 35),MUST NOT 拿它做差異化 |
| A9 | 客戶端彈藥與伺服器小幅漂移 by design,MUST NOT「修正」 |
| A10 | 迷霧只在伺服器過濾,客戶端 MUST NOT 二次遮蔽 |
| A11 | 爆風刻意不吃 LOS **也不吃射程** |
| A12 | `[#INC-103]` 無人機重生跨 tick 守衛 MUST NOT 移除 |
| A13 | `[#INC-105]` 中立 ents 三處 MUST skip |
| A14 | `[#INC-106]` toon 三階 ramp 暗部 MUST ≥ 102 |
| A15 | `[#INC-109]` 直升機刻意未接塔 SAM,MUST NOT「補完」 |
| A16 | SkinnedMesh 量尺寸 MUST `computeBoundingBox()` + 關 frustumCulled |
| A17 | FPV 座艙掛 camera 底下 ⇒ camera 本身 MUST `scene.add` |
| A18 | 貫穿判定是 2D + 垂直帶,MUST NOT 改 3D;垂直帶 MUST 換框 |
| A19 | 觸控疊層開著 MUST 整層收起 `#touchLayer` |
| A20 | 手機直式 MUST NOT 一律 `flex-direction:column` |
| A21 | 操作說明的裝置分支只住 `help.js` |
| A22 | 招式手勢派發只住 `_fireHoldAbility()`;同功能只准一顆鈕 |
| A23 | `#tlLook` 空處開火出口只有 `_setLookFire()` |
| A24 | 小地圖座標框 MUST 恆為全圖 |
| A25 | 一次性 3D 物件移除 MUST 釋放 GPU 資源 |
| A26 | 程序生成零件的擺位方向與旋轉方向 MUST 同調 |
| A27 | 實例 `ry`/`tx`/`tz` MUST 當剛體整株套用 |
| A28 | 三機制兩條線:瀏覽器可執行 + URL 佈局鏡射儲存庫 |
| A29 | 地下道沿用山體隧道整套,差異只有四個具名旗標 |
| A30 | 碰撞 / 彈道 / 伺服器 LOS MUST 同一橫斷面(有向盒;`ry` 反號) |
| A31 | 攀爬路線只住 `climb.js`;設施正面 MUST 面對結構 |
| A32 | 電腦玩家 MUST NOT 比真人多看 / 多走 |
| A33 | 電腦玩家戰術的帳只有一份、分層只認旗標 |
| A34 | 建築無加乘;護盾分軌只有一份拆分 |
| A35 | 攻擊範圍收斂與三軸預算 |
| A36 | 射速壓縮三欄一起動;連發演出不碰權威狀態 |
| A37 | 文字圖層只有一個、語料一份、比例推導、純表現層 |
| A38 | 三個地貌排列規則各一份,全住 `siteplan.js` 的純區塊 |
| A39 | 軟性物質:一個旗標管兩件事、細勾線只走 alpha 契約 |
| A40 | 角色 / 機體檔案格式只有一份,原型層由 `visual` 推導 |
| A41 | 導引彈的追蹤目標只認**擊發當下**的準星解 |
| A42 | 地圖主方位與道路量化(θ MUST 在 battleConfig 之前凍結) |
| A43 | 路網中繼:一份淨化、逐格單調、θ 不搭便車 |
| A44 | 邊界牆型錄:演出 ⊆ 碰撞盒、內面填滿、切分只有一條 |
| A45 | 爆炸傷害的閃避是**逐目標**的事 |
| A46 | 整棟量體節點:碰撞吃剖面、剖面是純資料、附著物只上平整垂直牆 |
| A47 | 迷你地圖:一個布林四個推論,而縮小比是推導 |
| A48 | 劇情戰役:旗標是一個 side 字串,而地圖是非對稱的 |

---

## 4. 錯誤處理與狀態管理

**失敗策略**:見原則 6(降級不例外、寧缺勿錯、驗證後靜默丟棄)。

**權威狀態流**
- 快照 8Hz;`snapshotFor(side)` 只過濾「單位」,塔/主堡/中立物恆可見;同 tick 三份快照共用一份 frame 快取(`_tickN`),events 只能清一次 — 動快照邏輯 MUST 維持此共用。
- 雙層 HP:護盾(先扣、不吃護甲、脫戰回復)→ 裝甲 hp(吃 `armorMul`)。爆擊只在直擊武器,**AoE 不爆**(刻意)。**閃避則相反**:2026-08-11 起爆炸傷害也吃閃避,而且是**逐目標各自擲**(見 §2.1「閃避範圍」與 A45)。
- 戰鬥分數:擊殺 +4 / 助攻 +1,玩家(**含電腦玩家**)與砲塔 ×5,夾 100 只增不減(2026-08-11 使用者定案取代舊的 `KILL_SCORE`/`BOT_KILL_SCORE`)。
- `createRoom` MUST 附合法預建 `battleConfig`;環境由 `resolveEnv` 開房定案進 `cfg.env` 全房一致,MUST NOT 客戶端各自重算。

---

## 5. 核心指令與回歸驗證矩陣

### 5.1 常用指令

```bash
npm start            # server on http://localhost:8620(--port <n> 覆寫;PowerShell 的 PORT=x 前綴無效)
npm run lan          # 區網 / Tailscale 對戰(--https;印出區網 + Tailscale + MagicDNS 網址)
npm run cloud        # 雲端節點($PORT 監聽、/healthz、--max-rooms 戰區上限)
npm run build:solo   # 打包單機特化版到 dist/(純檔案複製,無 bundler)
npm test             # node test/e2e.mjs(不會自動啟動伺服器!見 5.2)
npm run bal          # 平衡不變式(見 5.3;③ 已退場,編號不重排)
npm run sim          # headless 加速模擬完整 bot 對局(平衡/難度壓測)
npm run audit:net    # 三種連線機制稽核(瀏覽器安全 / 單一真相縫 / URL 佈局鏡射 / dev 路由)
npm run codex        # 2D 生圖對照台(dev-only,埠 8621)  --report = 直接印配對表
npm run parts        # 3D 零件對照台(dev-only,埠 8622)  --report = 直接印對照表
npm run story        # 本地故事書(dev-only,埠 8623)  --report = 直接印頁面索引(缺頁)
```

**離線稽核(~60 支)與資產管線指令的完整清單住 [`.claude/rules/verification.md`](.claude/rules/verification.md) 的「5.1(續)」段**;`--break-*` = 反向驗證(見 §0 原則 9)。一律不需伺服器/瀏覽器/網路,例外(㋓ 需外網或真瀏覽器)在該檔內標明。

### 5.2 測試標準流程(MUST 逐步,#INC-101/102)
1. `netstat -ano | grep :8620` — 檢視**全部** LISTENING(Windows SO_REUSEADDR 允許兩個 server 同時 LISTEN)。
2. `taskkill` 所有監聽者(**含 npm 父進程**),確認 0 個 LISTENING。
3. `node server/server.js` 起新伺服器 → `npm test`。**沒重啟伺服器 = 測到舊程式碼還全綠**。

**e2e 結構備忘**:前段 import `BattleSim` 直測(測試假人無 `lane`,tick 前 MUST 刪掉);迷霧下偵察 MUST 另開 `mode:'spectator'` client。瀏覽器冒煙借 mapping_elf 的 Playwright,`window.__SVS` 存取 app 狀態。

### 5.3 `npm run bal` 不變式(③ 已退場;**編號不重排** —— 各處引用序號)
1. 一波 NPC = 玩家 60% EHP
2. 前線敵我塔重疊 80% 且不對射
3. ~~單線 30% 擊殺 / 40% 助攻 10 分鐘 ≈ 八軌升滿~~ **已退場**(2026-08-11 使用者定案「移除此標準」):八軌自 `UPG_STEPS` 起是「金錢 + 戰鬥分數」雙閘,升滿時間不再只由錢決定,拿收入預算除總價量不到原本要量的東西。數字仍印出來當參考,不判定
4. 滿級單推同塔位雙塔剩 0~20%
5. 對進戰勝率(陣營/機種/較高方皆 ≈50%、角色不離群、接近期損失 ≤40% EHP)
   - a 陣營 b 機種(**角色**含武器與 mods)c 高度差中性 d 角色離群 e 射程壓制
   - c 是**高地這一軸的收費處**,2026-08-12 使用者定案「**先調整同機體在不同高度勝率相近**,後續再回來調整三種機體之間」⇒ 判定面 = **c1 同機體鏡像對局**(逐高度差量勝率 + 剩餘 EHP 差;唯一變因就是高度),舊的跨機體平均降為 c2 參考欄杆。**換儀器的證據**:壓制上線前 c2 讀 48.9%「中性」,而同一份數值下 c1 是 100/94/84/77% —— 高地其實壓倒性有利,c2 被對局本身的強弱差主導、看不見它。同輪 `ALTITUDE` 四個爆擊代價整組 ×0.286 讓出預算(同一件事 MUST NOT 收兩次錢)。改 `HIGH_SUP` 任一值 MUST 回頭重跑 c1
   - f **機種底盤對稱**(2026-08-12 使用者定案「同輕重武器組合時,三種機體平均不同高度差之間的交叉戰鬥,勝率要接近」):同一份輕重武器組合裝上三個底盤、其餘中性 ⇒ 勝率差只剩底盤(耐久/機動/飛行閃避/射程上限)。**與 b 刻意不合併** —— b 量「這個機種的角色們強不強」(弱底盤可以靠強武器補回來,現況正是如此),f 才量底盤本身。**現況達不到 50±5pp,以防退化欄杆守門**(同 ⑦c;根因與已排除的兩條路寫在 balance.mjs 該段)
6. 招式配置 ← 武器射程剖面(扇形武器優先貼身套件)
7. 前線交戰(`lanesim.mjs`:射程/速度/火力/**攻擊範圍**/兵波/砲塔/經濟)
   - a 一發打不到兩座塔 b 單軸擾動方向性自驗 c 機種交叉 d 武器類型交叉 e 模擬長度
   - f **長按 = 大招**:載具組量份額交付率(三種形式同量級)+ 自身型組量 EHP 當量/次(9 台全數 > 0)+ 輔助機損失率;**兩組刻意不合併**

### 5.4 矩陣通則(適用下表全部,不逐列重述)
- ㋐ 改任何有離線稽核的判定 → 該稽核 MUST 全綠 **且 MUST 做反向驗證**(原則 9)。
- ㋑ 稽核以「執行原文」驗真品;**讀原文與抽方法區塊 MUST 走 `tools/audit_src.mjs`**(`readSrc()`/`grabMethod()`),MUST NOT 自己 `readFileSync` —— 那支把換行正規化成 `\n`:逐行剝註解與 `split('\n')` 在 CRLF 工作區會**靜默失效**,同一份程式碼 LF 全綠、Windows 紅字。**寫 `--break-*` 腳本同理**:含 `\n` 的字面替換在此工作區是無聲 no-op ⇒ 一律用 CRLF 容忍樣式(`\r?\n`)並在替換無效時**當場失敗**;且斷言的期望值 MUST NOT 隨 `--break-*` 改變(那樣 break 永遠是綠的)。
- ㋒ 純表現層改動 ⇒ `npm run bal`/e2e 天然不受影響,但相鄰稽核仍 MUST 全綠。
- ㋓ 需外網/真瀏覽器的項目沙箱跑不動 → GitHub Actions / 真機,MUST 在交付說明中**標註未驗項**。
- ㋔ **同一支檔案的相鄰稽核一律連帶跑**:改 `data.js` → 幾乎全部;改 `sim.js` 的 `_damage`/`_gateFire`/`tick` → weapon_gate / lance_hit / shield_counter / fire_rate / bot_tactics / bot_vision / blood_splat / self_ult / ult_carrier;改 `game.js` → npc_collide / climb Ⅲ / layer_block / slope_move / view_lock / spectator_cam;改 `biomes.js` → siteplan / beacons / open_tunnel / underpass / road_joint / world_text / object_joints;改 `terrain.js` → 上列 + cel_pipeline / world_curve / world_edge;改 `toon.js`/`postfx.js` → cel_pipeline / visual_prefs / soft_stroke / world_curve / gpu_lifecycle。
- ㋕ 真機冒煙清單見 [`docs/smoke_tests.md`](docs/smoke_tests.md)。
- ㋖ **動過任何 `public/js/*.js` → `node tools/audit_client_syntax.mjs`**。半數客戶端模組(game.js / models.js / vfx.js / postfx.js / mobile.js …)要 CDN 的 three ⇒ 沒有任何離線稽核 import 得了它們:語法錯誤會讓**整套回歸驗證照樣全綠**,而真人一開頁面就是白畫面。


### 5.5 改了什麼 → MUST 跑什麼(**全文住 [`.claude/rules/verification.md`](.claude/rules/verification.md)**)

131 列對照表(改動 → 驗證)。**動手改完、宣稱完成之前 MUST 打開那一支對號入座**;查不到你動的東西時回 §5.4 ㋔ 的相鄰稽核通則,MUST NOT 當成「這一項不用驗」。

### 5.6 AI 退化量測(bot 改動專屬)

判準、樣本數與取 base 的手法住同一支 [`verification.md`](.claude/rules/verification.md)。一句話:**MUST NOT 拿 `npm run sim` 的勝負旗標**當訊號(它天生飽和),改看 `繞行%`/`engage%` 這類結構性指標。

---

## 6. 退場清單(**全文住 [`.claude/rules/retired.md`](.claude/rules/retired.md);MUST NOT 復辟**)

> 31 條**已經移除**的機制。看到「這裡好像少了一塊」而想補回去之前,**MUST 先開那一支** —— 移除本身就是定案(§0 原則 10)。

現役退場條目涵蓋:爆炸戰鬥部飛到射程界原地引爆・座艙手繪 builder 十支・舊版英雄建模七支・單樹變形者・NPC BOSS 防禦面永不升級・對白掛在整階推平上・劇情預置兵線取較小者・「爆炸傷害納入閃避 = 整組變弱」・有爆風就不可閃・bal ③ 十分鐘升滿・逐機種擊殺分數表・八軌階梯舊常數・小兵強化的 hp/賞金 ×cu・機種絕招三個入口・常駐護衛機外觀・重砲模式與巨砲・建築加成・榴彈錐形瞄準輔助・爆炸型豁免名冊內容・逐武器手寫 move/slowF・逐階手寫 BAR_MAX・舊 `signage.js`・自由字串 `lore.proto`・飛行取景 `standing`・舊載具 HP 係數・極音速終端追擊(死碼但定案留著)・「物件最高高度 = 2 倍砲塔高」・光暈分幀預算與 TTL 快取・航跡長 `b.dist`・bots 直寫座標與本地 BUY_ORDER・機種分派表・巨岩隨機 `rotation.y`。

---

## 附:其餘情境層與文件

**第 ② 層 — `.claude/rules/`(由本檔觸發列指名時讀)**

| 規則檔 | 內容(= 原根檔哪一節) |
|---|---|
| `seams-balance.md` / `seams-abilities.md` / `seams-weapons.md` / `seams-bots.md` | §2.1 A~D:平衡與角色 / 招式與載具 / 武器與彈道 / 電腦玩家 |
| `seams-terrain.md` / `seams-render.md` / `seams-world.md` / `seams-ui-net.md` | §2.1 E~H:地形結構 / 表現層 / 世界內容 / 介面與連線 |
| `antipatterns.md` | §3 絕對反模式 A 表全文 |
| `verification.md` | §5.1 稽核指令清單 + §5.5 驗證矩陣 + §5.6 |
| `retired.md` | §6 退場清單全文 |

**第 ③ 層 — 目錄級**

| 文件 | 內容 |
|---|---|
| [`public/js/.claude.md`](public/js/.claude.md) | 客戶端 60 支模組:逐檔職責地圖 + 模組級地雷。**刻意不叫 `CLAUDE.md`**(134KB,不該自動載入);動 `public/js/**` 時 MUST 手動開 |
| [`server/CLAUDE.md`](server/CLAUDE.md) | 權威層四支:傳輸 / 房間 / 模擬 / bot 的邊界與三機制約束 |
| [`tools/CLAUDE.md`](tools/CLAUDE.md) | 122 支離線工具的家族地圖與寫稽核的紀律 |

**第 ④ 層 — 專題文件**

| 文件 | 內容 |
|---|---|
| `docs/smoke_tests.md` | 真機冒煙清單(§5.4 的 ㋕) |
| `docs/ai3d_runbook.md` | img→3D 資產管線:§0 定案、§1~§4 現況與佇列、§5 逐節結論索引(錨點 `§5aj-C` 等被 25 支工具引用,**MUST NOT 改號**)。方法論住 `.claude/skills/photo-to-3d-pipeline` 等三支 |
| `docs/map_grid_alignment.md` | 地圖主方位旋轉 / 道路量化 / 路網中繼 —— 只留未完事項與已排除的選項;設計與禁令住 A42/A43 |
| `docs/bot_design.md` | 電腦玩家定位分類 / 學習迴圈設計全文 |
| `docs/codex_format.md` | 角色 / 機體檔案格式規格書 |
| `docs/anime_style_plan.md` | **日系動漫畫面整合計畫(下一輪畫面工作看這一份)**;技術本體拆在 `.claude/skills/` 九支 |
| `docs/visual_upgrade_plan.md` | 2026-08-03 那一輪畫面升級 —— 已結案,只留 P/V 編號字典與未量的幀時間 |
| `docs/lane_scenarios.md` / `docs/tunnel_review.md` | 兵線場景 / 隧道覆核紀錄 |
| `docs/characters.md` / `docs/story.md` | 角色與敘事 |
| `docs/deploy.md` | 部署 |

> 2026-07-18 前的逐日檔案庫 `CLAUDE-orig0718.md` 已於 commit `3629979` 刪除,內容住 git 歷史(`git show 3629979^:CLAUDE-orig0718.md`)。
