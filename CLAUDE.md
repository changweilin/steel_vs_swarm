# 無人戰略:鋼鐵與蜂群 (Steel vs. Swarm) — 全域儲存庫準則

> **本檔定位**:雙層情境系統的**全域層**(長期不變標準)。活躍模組層見 [`public/js/.claude.md`](public/js/.claude.md);逐日事故檔案庫與完整細節見 `CLAUDE.md`(本檔自其蒸餾,基準日 2026-07-18)。
> 關鍵詞 **MUST / MUST NOT / SHOULD** 依 RFC-2119 解讀。違反 MUST NOT 條目 = 架構違規,直接退回。

---

## 1. 系統架構與技術棧

**產品**:瀏覽器 DOTA+FPS — 無人機陣營 (SWARM) vs 機甲陣營 (STEEL)。真實世界地圖選址 → OSRM/Overpass 取真實道路兵線 → 即時 3D 地形開戰。

**架構型態:Server-Authoritative Monolith(權威伺服器單體)**

- **心智模型(MUST 內化)**:伺服器是唯一真相。HP/傷害/彈藥/經濟/勝負全部在 `server/sim.js` 結算;客戶端只做三件事 — 送輸入與命中回報、渲染 8Hz 快照插值、跑表現層彈道/物理。
- **三種遊戲機制**(雲端伺服器 / 區網 Tailscale / 單機)只換**傳輸層**,不換架構:房間邏輯共用 `server/rooms.js`(`RoomHub`),權威模擬共用 `server/sim.js`。單機 = **把伺服器整支搬進瀏覽器分頁**(RoomHub 在分頁裡跑),客戶端一樣只送輸入、收 8Hz 快照 —— **MUST NOT** 為了單機另寫一套「客戶端自己算」的路徑。
- **MUST NOT**:任何「客戶端先改狀態再同步」的實作。
- 防作弊驗證(射程 ×1.25 複驗、迷霧 `_visibleTo`、LOS `_losBlocked`、高度夾制)只住伺服器,**MUST NOT** 搬到客戶端。

**技術棧絕對規則**

| 項目 | 規則 |
|---|---|
| Runtime | Node.js;唯一 npm 依賴 = `ws`。**MUST NOT** 新增任何 npm 依賴 |
| 前端 | vanilla ES-module JS + Three.js 0.160(CDN importmap)。新函式庫一律 CDN importmap,且**先有離線 fallback 才准接** |
| 建置 | **無 build step、無 bundler、無框架、無 TypeScript — MUST NOT 引入以上任何一項** |
| 語言 | 註解與 UI 字串一律**繁體中文** |
| 3D 資產 | CC0 開源模型優先(`MODEL_MANIFEST` + 程序生成 fallback 模式);法線貼圖 **MUST** 刪除並重寫 gltf 移除引用 |

**分層職責**

| 路徑 | 職責 |
|---|---|
| `server/server.js` | **傳輸層**:HTTP 靜態檔 + WebSocket + `/healthz`(雲端與區網共用;單機完全用不到) |
| `server/rooms.js` | `RoomHub` 房間/配對/8Hz 戰鬥生命週期 — **三種機制共用同一份**,故 MUST 保持瀏覽器可執行 |
| `server/sim.js` | `BattleSim` 權威模擬核心(single source of truth) |
| `server/bots.js` | `BotBrain` 電腦玩家狀態機(推線/交戰/撤退) |
| `public/js/data.js` | 全遊戲平衡數值唯一真相;**伺服器直接 import 這支客戶端檔** |
| `public/js/*.js` | 渲染/FPV/輸入/HUD(檔案地圖見 `public/js/.claude.md`) |
| `tools/` | 離線工具:平衡驗證、兵線烘烤、稽核腳本、單機版打包(`build_solo.mjs`)、LOGO 管線 |
| `.github/workflows/` | 回歸驗證 CI + 單機特化版自動部署到 GitHub Pages |
| `test/e2e.mjs` | 前段 `BattleSim` 確定性單元測試 + 後段 WebSocket 端對端,約 60 項斷言 |
| `reference/` | 上游唯讀副本 — **MUST NOT** 修改,只准參考 |

---

## 2. 通用程式標準與慣例

### 2.1 單一真相縫(Single Seam)原則
所有跨檔共用邏輯只准有**一個**結算點;發現第二份實作即是 bug:

- 平衡數值(射程/傷害/經濟/波次/角色/招式)**MUST** 只住 `data.js`;sim.js/game.js **MUST NOT** 硬編碼。
- **推導值 MUST NOT 手寫**:賞金表(戰力公式推導)、`UNITS.drone.hp` 與 `SQUAD.DMG`(由 `SQUAD.BUFF` derive)、`UNITS.bunker.hp`(= 塔一半)、塔位(`solveTowerSites()`,sim 與 biomes 共用)、`MINES.PER_LANE` 與 `AA_SITE.range`(等面積公式)、`TOWER_SEP_F`(= 2 − TOWER_OVERLAP)。
- 砲塔佈局規則的判定只准住 `data.js`:#4 射程重疊 `towerLayoutAudit()`、#5 隧道洞口 `towerTunnelAudit()`(洞內塔 MUST 有 ≥`TOWER_TUNNEL_OUT_F` 射程涵蓋洞口外)。烘焙/mapSelect/伺服器驗證/稽核工具**共用同一支**;#5 因隧道覆蓋區間只在客戶端地形期算得出,**MUST NOT** 下放成執行期挪塔(伺服器/客戶端塔位會分家)。
- 隧道「側向土牆藏不藏得住結構」的判定(= **明隧道**改制)只住 `biomes.js tunnelWallProfile()`:落地 facade / 外露頂板 / 女兒牆 / 扶壁四個構件共用同一份 `open`(該側改明隧道)、`gy`(側坡地表最低點)、`nx/nz`(側向法線)。
  **MUST NOT** 在擺位端各自再算一次中央差分法線(取樣方向與擺位方向一分家就是 A26 那類「差 90°/差正負號」);facade 落地基準只准有 `galBase` 一份。
  明隧道是**純表現層**:通行寬 `hw` / `tunnelSegs` / `ceilSegs` / 走廊 / `cols` 一律不動 ⇒ 伺服器 slab(側牆全擋 LOS)、砲塔規則 #5、平衡與 e2e 天然不受影響 —— 現實中的明隧道側面本來就是實心擋土 facade(不是柱列),遮蔽語意與埋在山裡的側牆一致,**MUST NOT** 為了「看起來通透」改成開放柱列(那就是看得到卻打不到)。
- 英雄武器/招式解析一律經 `heroWeapon()`/`heroAbility()`(HEROIC ×1.2/×1.5、SQUAD 傷害折算、rangeCap 全在這一個縫),**MUST NOT** 在別處二次乘算。
- 傷害衰減公式(`dmgFalloff`/`blastFalloff`/`fanFalloff`)只住 `data.js`,sim 結算與客戶端 HUD 共用。
  扇形曲線的槍口係數 `FAN_MUZZLE` **MUST NOT 手寫** —— 由 `FALLOFF.PLATEAU` 推導(= 在別人的近距平台邊界上恰好滿額)。
- **陣營對抗係數的對稱化只住 `data.js` 的 `CLASS_SYM` 推導區塊**:英雄對英雄時蜂群恆吃自家武器的 `vs.armor`、
  鋼鐵/傭兵恆吃自家的 `vs.air`,兩張手訂風味表合計起來並不對稱。校正係數由持續 DPS 推導後**整組等比**套回,
  **MUST NOT** 逐武器手改 `vs` 去湊平衡(32 角一改就漂移);逐角色的戰力調整請改該角色的 `dmg` 階梯。
- **對進戰(接近 → 進場 → 互轟 → 高度差掃描)的模型只住 `tools/duel.mjs`**,`tools/balance.mjs` ⑤ 匯入使用;
  MUST NOT 在別處另寫第二份對局模型。模型**只算武器**(與 ①/④ 同基準,不含招式)—— 這是刻意的:
  只模擬一半的招式家族(自身增益/打擊)會系統性偏袒那一半,故一律不算,尾端的招式導向角色改走具名豁免。
- 三個**機種絕招**(自爆攻擊 / 轟炸餌機 / 重砲模式)的傷害只住 `data.js` 的 `SPECIAL` 區塊:一次絕招的**總傷害預算**
  = `specialBudget(abil)`(隨**輕/重武器綜合等級** = 兩軌平均成長,可為分數階 ⇒ **MUST NOT** 丟進 `tierVal`),
  三招各自把同一份預算切給自己的投射數(`kamiBlast`/`selfBoomBlast`/`decoyBlast`/`decoyBombBlast`/`barrageDmgF`)。
  **MUST NOT** 在 sim/game/HUD 手寫任一招的傷害常數,也 MUST NOT 讓某一招退回吃單一武器軌(那就是三招失衡的舊病)。
- 電腦玩家的**操作節奏**只住 `data.js`(`BOT_DIFF[].gap`/`react` + `BOT_OPS` + `botOpGap()`),節流判定只住 `bots.js _op()`;
  **MUST NOT** 在 bots.js 各處另寫 tick 計數式節流。持續開火**刻意不吃手速閘**(扳機是按住的),只吃反應時間。
- 重武器範圍攻擊三分類(`aoeClass()` → blast 爆炸 / fan 扇形 / line 直線貫穿)與彈道五分類
  (`trajClass()` → lob / flat / line / guide / fnf)只住 `data.js`,由 `def.type`/`fan`/`guide` **推導**;
  sim(`heroBurst`/`heroPlasma`/`heroLance`)、game.js 演出、HUD 說明**共用同一支**,
  **MUST NOT** 手寫逐武器分類表,也 MUST NOT 在結算/演出端各自比對 `def.type`。
- 直線貫穿的演出唯一入口 `_lanceVisual()`(自機/他人/bot 共用);圓柱粗細 **MUST** 取 `lanceR(def, barrage)`
  = 伺服器實際判定半徑(看到多粗就是打到多粗,MUST NOT 為了好看放大)。**重砲傾洩窗的加粗
  MUST 也走這一支**(`LANCE.BARRAGE_F`)—— 前科:演出端自己寫 `barrage ? 1.5 : 1`,伺服器沒跟上,
  巨炮開下去有一半的粗度是空頭支票(2026-07-28「打不到單位」病灶之一)。
- 拋物線武器(`trajClass==='lob'`)的火控解只住 `game.js _lobAim()`(每幀在擊發前定案 `this._lobFc`):
  出膛向量、瞄準虛線、鎖定光暈、FPV 砲管仰角**共用同一份**,MUST NOT 在擊發/繪製端各解一次。
  光暈亮不亮 = `_arcTrace` 的 `minD ≤ BALLISTIC.LOB_TOL`(彈道真的通過瞄準點),MUST NOT 退回準星直射線判定。
- 機體高度只住 `data.js`(`SOLDIER_H`/`HERO_SIZE`/`heroTargetH()`/`TARGET_H`,`models.js` 只 re-export):
  同一把尺同時餵渲染縮放(`fitToHeight`)與**伺服器命中量體** `hitH()`(`sim._bodySpan/_bodyDy` 的機體垂直帶)。
  爆風/貫穿 **MUST** 量到垂直帶最近點,MUST NOT 只取單位底部或單一取樣點(打中塔頂/頭部會判成十幾公尺外)。
- 機體**水平半徑**同理只住 `data.js` 的 `hitR()`(`HERO_HIT_R` × `heroTargetH` 推導 + `TARGET_R` 查表)——
  這是 `hitH()` 的水平版。**貫穿圓柱判定 MUST 是 `lanceR(def) + hitR(t)`**,MUST NOT 只比對單位中心座標
  (2026-07-28:砲塔半徑 7m / 主堡 20m,純點判定 ⇒ 打在建築牆面上整發落空 = 使用者回報的「打不到建築」)。
  客戶端 `game.js` 的 `COLLIDER` / `heroCollider()` **MUST** 由 `hitR`/`hitH` 推導 —— 碰撞量體與命中量體
  分家就是「撞得到卻打不到」;但該表**鍵集** MUST NOT 隨 `TARGET_R` 增列而擴張(會讓直升機/碉堡突然擋路)。
- **連線機制**(雲端 / 區網 / 單機)的判定只住 `data.js` 之外的 `netmode.js`:模式解析、雲端節點網址正規化、
  `wsUrl()` 全在那一支;傳輸層一律經 `net.js makeNet()` 取得(WebSocket 或瀏覽器內主機)。
  `main.js` **MUST NOT** 自己 `new Net()`、自己看 `location.host`、或另寫 `if (單機)` 的文案分支。
  鈕面文字的真相在 `LINK_MODES`,`index.html` 那份靜態副本只為版型量測而存在(一致性由稽核把關)。
- 共用視覺入口唯一:`spawnCastFx()`(招式 3D 演出)、`stepCombatFx()`(開火動畫)、`terrain.surfaceAt()`(站立表面)— 戰場與展示台/各呼叫端 **MUST NOT** 各寫一套。

### 2.2 狀態鍵與迴圈粒度
- 英雄以 **pid(連線 id)為鍵**存於 `heroes` Map;bot 用字串 pid(如 `'b1'`)。**MUST NOT** 改用陣列索引或 socket 物件當鍵。
- 三機小隊共享狀態(金錢/電力/彈藥/招式)住 `sq.ps`,經 `_bindShared()` getter 掛回每架 ent。迴圈粒度 **MUST** 分清:`heroes.values()` = 一隊一次;`_allBodies()` = 每架一次。搞錯 = 收入三倍或增益疊三層。

### 2.3 確定性(Determinism)
- 跨客戶端場景一致靠 `mulberry32`(戰場中心為種子);隨機散布 **MUST NOT** 用 `Math.random()`。
- 抽樣紀律:每格消耗**固定枚數**亂數、淘汰檢查一律放在抽樣**之後**;**MUST NOT** 改成「淘汰就跳過抽樣」(佈局序列會跨客戶端分歧)。

### 2.4 外部服務防禦
- OSRM / Overpass / AWS 地形磚 / Esri 影像皆會限流或掛掉:每條 fetch 路徑 **MUST** 保留程序生成 fallback(合成貝茲兵線、程序建物),改 fetch 邏輯時 **MUST NOT** 移除。

### 2.5 世界尺度
- `SOLDIER_H`(真人 1.8m)是全遊戲唯一身高單位;人員/載具/建物一律用真實世界公稱尺寸。英雄體型只准住 `heroTargetH()` 這一個縫。**MUST NOT** 為了「看起來大一點」調回超尺度。
- 改 `REAL_SCALE` **MUST** 同步 +1 `GEO_SCALE_VER` 並重跑 `node tools/bake_venue_lanes.mjs`。

---

## 3. 絕對反模式(DO NOT 清單,含事故編號)

| # | 禁令 |
|---|---|
| A1 | **MUST NOT** 客戶端先改權威狀態;防作弊邏輯 MUST NOT 下放客戶端 |
| A2 | **MUST NOT** 新增 npm 依賴 / build 工具 / TypeScript / 框架 |
| A3 | **MUST NOT** 修改 `reference/` 內任何檔案 |
| A4 | **MUST NOT** 在確定性散布路徑用 `Math.random()` |
| A5 | **MUST NOT** 為重武器另發明第二套 CD 系統 — 唯一實作 = `mag:1 + reload=cd` |
| A6 | 射擊 raycast **MUST** 只打單位;**地形走解析射線 `terrain.rayTerrain()`**,建物/神木/巨岩/橋墩走解析圓柱(`_blockerHitT`)。**MUST NOT** 把 `terrain.mesh` 加回 raycast 目標(2026-07-27:193² 高度場 = 73,728 面,three 的 `Mesh.raycast` 逐面線性掃且 `far` 不參與剪枝 ⇒ 每顆子彈每幀 1ms/桌機、手機 3~6 倍 = 開火掉幀主因),也 **MUST NOT** 把植被或建物 InstancedMesh 加進 raycast 目標(效能)、MUST NOT 讓砲火穿越有碰撞障礙 |
| A25 | 一次性 3D 物件(彈體/特效)自場景移除時 **MUST** 釋放 GPU 資源 —— three 靠 `dispose()` 事件回收,只 `scene.remove()` 就是洩漏(打越久越卡,手機顯存吃緊後尤甚)。彈體走物件池 `_takeProjectile`/`_dropBullet`(自機與他人視覺彈體同池),特效走 `_freeEffect` → `toon.js disposeTree`。**共用幾何 MUST 經 `toon.js markShared()` 註冊**(否則整場共用的那份被放掉 ⇒ 所有借用者變空白);`disposeTree` 只准有一份實作(castfx/vfx/game 共用),**MUST NOT** 各寫一套。高頻特效(光束/環/能量珠/彈體)**MUST NOT** 每次 `new …Geometry()`,一律「單位幾何 + scale」 |
| A7 | 飛彈失鎖規則(離開發射源射程 → 直線飛行)伺服器與客戶端共用;**MUST NOT** 無限追蹤 |
| A8 | FOV 全機種一律 68(zoom 35);**MUST NOT** 用 FOV 做陣營/機種差異化 |
| A9 | 客戶端 `wstate` 彈藥與伺服器小幅漂移是 **by design**(miss 不回報);**MUST NOT**「修正」 |
| A10 | 迷霧是伺服器端快照過濾;客戶端 **MUST NOT** 對單位標記二次遮蔽 |
| A11 | 爆風 `_blast` 刻意不吃 LOS 遮蔽(繞射近似);**MUST NOT**「補完」 |
| A18 | 直線貫穿 `heroLance` 的圓柱判定是「水平垂距 + 垂直帶」而非純 3D 垂距(伺服器無地形高程、y = 離站立表面高);**MUST NOT**「修正」成 3D —— 高低差地形會讓整條射線落空。line 類重武器一發只過一次 `_gateFire`,客戶端 **MUST NOT** 另送 `hitMissile`(飛彈擊落已併進圓柱掃描)。**判定量體(2026-07-28)**:半徑 **MUST** 是 `lanceR(def) + hitR(t)`(目標不是點 —— 見 §2.1),軸距 **MUST** 量到**線段上最近點**(`s` 夾制到 `[0, maxS]`)而非要求目標中心落在線段內 —— 客戶端回報的 `len` 止於彈道終點,而彈道終點就是目標的**近側表面**,要求中心落在線段內等於「打中了才判成沒打中」。**排序仍 MUST 用原始 `s`**(夾制值會把所有外溢目標並列在端點,貫穿衰減序就亂了)。連帶:貫穿光束的準星射線 `_resolveAim(far, pierce=true)` **MUST NOT** 停在第一個單位上(停了就只剩「打到誰都沒傷害」) |
| A12 | `[#INC-103]` 無人機重生的 `deadTick` 跨 tick 守衛 **MUST NOT** 以「優化延遲」為由移除 |
| A13 | `[#INC-105]` 中立 ents(`side:null, neutral:true`):`_acquireTarget`/`_acquire`/tick 主迴圈三處 **MUST** skip neutral,否則 `UNITS[kind]` undefined 直接炸 |
| A14 | `[#INC-106]` toon 三階 ramp 暗部 **MUST NOT** 調低於 102;材質一律走 `toon.js mat()` 包裝(MeshToonMaterial 無 roughness/metalness) |
| A15 | `[#INC-109]` 直升機 creep **刻意未接** 塔 SAM/防空飛彈系統(以 pid 查找,heli 無 pid);**MUST NOT**「補完」這條接線 |
| A16 | SkinnedMesh 量尺寸 **MUST** 用 `computeBoundingBox()` 並關 `frustumCulled`;`outlinify()` MUST 跳過透明材質與 `userData.noOutline` |
| A17 | FPV 座艙掛在 camera 底下 — camera 本身 **MUST** `scene.add`,忘了整個座艙不見 |
| A19 | 觸控版疊層(戰場選單/商店/結束畫面)開著時 **MUST** 整層收起 `#touchLayer`(`mobile.js syncBlocked()`)。`#game` 是 `position: fixed` ⇒ **本身就是堆疊脈絡**,疊層寫的 z 20 只在它內部有效;住在 body 的搖桿層(z 9)實際壓在整個 `#game` 之上,滿版 `#tlLook` 又吃事件 ⇒ 疊層任何按鍵都按不到、也關不掉。**MUST NOT** 改用調 z-index「修」(脈絡外找不到介於畫布與疊層之間的層級)|
| A20 | 手機直式版型 **MUST NOT** 用「一律 `flex-direction: column`」把桌機的左右並排改成上下堆疊(前科:大廳三入口直排後,第三顆「劇情戰役」被推到摺線以下,玩家回報「沒看到劇情模式的按鍵」;同一顆鈕在桌機/手機位置不同也破壞操作直覺)。窄屏只准**收窄欄寬 + 降一階字級**,塞不下才交給 `flex-wrap` 換行。兩個相關陷阱:①改直排時 `flex: 1 1 0` 的 basis 會落在**高度**上(`.slot-btn` 被壓進 `min-height` 裡把字切一半);②`.center-screen` 是 `align-items: center|flex-start` ⇒ 直接子代的列**寬度不會被拉滿**,子項用 `flex: 1 1 0` 會讓整列縮成窄條、鈕面文字溢出 clip-path 方框 —— 該列 MUST 給定 `width: 100%`。稽核 `tools/audit_ui_layout.mjs` |
| A21 | 操作說明的**裝置分支只准住 `help.js`**:條目多帶一份 `pTouch`(虛擬搖桿)、類別多帶 `labelTouch`,取字串一律經 `helpItemP()` / `helpCatLabel()`。**MUST NOT** 在 `main.js` 另寫 `if (TOUCH_UI) '...'` 的字串分支 —— 那就變成第二份操作說明,改鍵位時一定有一邊沒跟上。判定旗標與 `pauseHelp` 共用同一個(`mobile.js isTouchUI()`)|
| A22 | 機種絕招(自殺機/重砲/餌機)的派發只准住 `game.js _fireHoldAbility()`:長按右鍵(`_tickHoldAbility`,**一般與狙擊模式皆可**)與觸控 ZR(`_cmd('special')`)共用同一支,**MUST NOT** 在任一輸入端各自比對 `isDrone`/`isMorph`。陀螺儀開關**只准有一顆鈕**(十字鍵下);同功能兩顆 = 兩處要同步的狀態 |
| A23 | `#tlLook` 空處開火手勢:出口只有 `_setLookFire()` → `_cmd('fire')`,**MUST NOT** 直接改 `client.firing`。判定 **MUST 先要求一次完整輕點**(不然單指拖曳轉視角會誤擊發),**長按路徑 MUST 在幀迴圈判定**(手指不動收不到 `pointermove`),且 A 鈕與本手勢共用 `firing` ⇒ 兩邊放手都要先確認對方沒按著 |
| A24 | 小地圖「已探索」累積罩 `_mmSeen` 與底圖 `_mmBase` 的座標框 **MUST 恆為全圖**(`_world2mmFull`),**MUST NOT** 跟著顯示窗(周遭/全部)跑 —— 那是整場累積的持久資料,框一變先前探索過的區域就整片錯位;周遭模式改用九參數 `drawImage` 裁切。連帶 `_mmShadows()` **MUST 回傳世界座標**(同一組陰影要畫進兩個座標框)|
| A26 | 程序生成零件的**擺位方向與旋轉方向 MUST 同調**,且錨點半徑 **MUST 取「該高度的錨體半徑」**。三種反覆出現的病灶(2026-07-27「神木樹幹與樹根沒接好」整批):①**差 90°** —— 環形佈件的 `rotation.y = -a` 是**徑向**(板根鰭/斜撐/枝),`-a + π/2` 是**切向**(沙包圈/紙垂);寫錯那一圈零件會變成「圍著主體的柵欄」,與主體之間整圈開縫。②**差一個正負號** —— 沿某個軸擺件時 **MUST 由該軸的實際世界向量推**(`rotation.set(π/2, 0, dirA)` 的局部 +y = `(−sin dirA, 0, cos dirA)`,Euler 'XYZ' = Rx·Ry·Rz),**MUST NOT** 手寫 `cos(a+π/2)` / `sin(a−π/2)` 這種鏡射式;傾角符號同理(斜撐上端該收向軸心)。③**拿基部半徑當通用半徑** —— 幹身/塔身有收分,掛件一律經 `trunkR(y)` 類的單一縫。連帶:堆疊件 **MUST NOT** 用 y 交錯偽裝第二層(半數會整件浮空),躺地件軸心高度 **MUST** = 自身半徑。**改任何程序生成零件的擺位/旋轉/尺寸,MUST 跑 `node tools/audit_object_joints.mjs`** |
| A28 | **三種遊戲機制的兩條線 MUST NOT 斷**。①**瀏覽器可執行**:`server/rooms.js` / `sim.js` / `bots.js` 會被單機版直接載進瀏覽器分頁,**MUST NOT** import 任何 Node 內建模組,也 MUST NOT 用 `process.*` / `Buffer` / `require()` —— 加一行就只有單機版炸、伺服器版照跑。②**URL 佈局鏡射**:瀏覽器看到的路徑 **MUST** 鏡射儲存庫佈局(`/public/**` + `/server/*.js`,`/` 302 到 `/public/`),dev 伺服器與 `tools/build_solo.mjs` 出的是同一套。理由是 import 鏈 `public/js/localhost.js → ../../server/rooms.js → ../public/js/data.js` 只有在鏡射佈局下才會讓 `data.js` 是**同一個模組實例** —— 佈局一改就變成兩份平衡數值(而且不會報錯)。單機版離場 **MUST** `hub.shutdown()` 停掉 8Hz tick(否則背景空轉吃電)。稽核 `node tools/audit_net_modes.mjs` + `node tools/audit_solo_boot.mjs` |
| A27 | 實例的朝向 `ry` 與站姿微傾斜 `tx/tz` **MUST** 當剛體整株套用(`xform.js vegPartXform` 單一縫),**MUST NOT** 併進逐零件的歐拉角 —— Euler 'XYZ' 把 ry 夾在中間,任何 `rx ≠ 0` 的零件(枝梢雙叉/垂掛松蘿/蜂窩)方向會隨朝向被攪亂而位移只吃水平旋轉;微傾斜若逐零件繞自身中心轉,樹幹分段會互相剪切錯位。接合完成度 **MUST** 與 `ry`/`tx`/`tz` 無關 |

---

## 4. 錯誤處理與狀態管理

**失敗策略 = 降級,不例外(no exception-driven flow)**
- 外部 fetch 失敗 → 落到程序生成 fallback,遊戲照開。
- 佈點取樣不到合法位置(野營/空投/地雷)→ **寧缺勿錯**:回傳 null 略過,MUST NOT 放寬約束硬塞。
- 伺服器對客戶端回報一律「驗證後靜默丟棄」:`heroHit` 檢射程 ×1.25 + 迷霧視野 + LOS + 高度;驗不過就無效,不 throw、不回錯誤訊息。

**權威狀態流**
- 快照 8Hz;`snapshotFor(side)` 只過濾「單位」,塔/主堡/中立物恆可見;同 tick 三份快照(雙陣營 + 觀戰)共用一份 frame 快取(`_tickN`),events 只能清一次 — 動快照邏輯 **MUST** 維持此共用。
- 雙層 HP:護盾(先扣、不吃護甲、脫戰後自然回復)→ 裝甲 hp(吃 `armorMul` 減免曲線)。爆擊只在直擊武器,AoE 不爆。
- 擊殺分數:被擊殺者是 bot 一律 `BOT_KILL_SCORE`(3)— 刷 bot 不能速成招式,**MUST NOT** 移除此判定。
- 房間流程:`createRoom` **MUST** 附合法預建 `battleConfig`(伺服器驗證);環境(季節×日夜×天氣)開房時 `resolveEnv` 定案進 `cfg.env` 全房一致,**MUST NOT** 客戶端各自重算。

**可觀測性**
- 本專案無集中 Logger 服務;正確性防線 = 離線稽核工具(`tools/audit_*.mjs`)+ e2e 斷言 + `npm run bal` 平衡不變式(見 §5)。新增系統 **SHOULD** 同步補對應稽核腳本,而非加 runtime log。

---

## 5. 核心指令與回歸驗證矩陣

```bash
npm start            # server on http://localhost:8620(--port <n> 覆寫;PowerShell 的 PORT=x 前綴無效)
npm run lan          # 區網 / Tailscale 對戰(--https;印出區網 + Tailscale + MagicDNS 網址)
npm run cloud        # 雲端節點($PORT 監聽、/healthz、--max-rooms 戰區上限)
npm run build:solo   # 打包單機特化版到 dist/(純檔案複製,無 bundler;GitHub Actions 同一支)
npm run audit:net    # 三種連線機制稽核(瀏覽器安全 / 單一真相縫 / URL 佈局鏡射)
npm test             # node test/e2e.mjs,約 60 項斷言(不會自動啟動伺服器!)
npm run bal          # 平衡六不變式:①一波 NPC = 玩家 60% EHP ②前線敵我塔重疊 80% 且不對射
                     #              ③單線 30% 擊殺/40% 助攻 10 分鐘 ≈ 八軌升滿 ④滿級單推同塔位雙塔剩 0~20%
                     #              ⑤對進戰勝率(自射程外接近 → 進場 → 互轟,±3 砲塔高對稱掃描取平均):
                     #                陣營/機種/較高方皆 ≈50%、角色不離群、接近期單方面損失 ≤40% EHP
                     #              ⑥招式配置 ← 武器射程剖面:扇形武器優先配置貼身套件
                     #                (突進/匿蹤/走位增益/控場打擊),雙扇形 2/2、單扇形 ≥1、密度 ≥ 非扇形 ×2
npm run sim          # headless 加速模擬完整 bot 對局(平衡/難度壓測)
```

**測試標準流程(MUST 逐步,#INC-101/102)**:
1. `netstat -ano | grep :8620` — 檢視**全部** LISTENING 行(Windows SO_REUSEADDR 允許兩個 server 同時 LISTEN,連線被拆散)。
2. `taskkill` 所有監聽者(**含 npm 父進程**),確認 0 個 LISTENING。
3. `node server/server.js` 起新伺服器 → `npm test`。`npm test` 只是 WS client,**沒重啟伺服器 = 測到舊程式碼還全綠**。

**改了什麼 → MUST 跑什麼**

| 改動 | 驗證 |
|---|---|
| 任何平衡數值(小兵/角色武器/SQUAD.BUFF/HEROIC/塔/賞金/八軌價格) | `npm run bal`(五條全綠;動角色武器 MUST 一併看 ⑤ 的角色離群列) |
| **角色大小招的 `fx` / `add`**(招式家族配置) | `npm run bal` ⑥ —— 扇形武器沒有近距平台、實用交戰帶最短,拿到站樁型套件(承傷減免/治療/召喚/攔截)等於貼不上就一項都兌現不了。**雙扇形 MUST 兩招都是貼身套件**(突進 dash / 匿蹤 stealth / 走位增益 buff+haste\|leap\|dodge / 控場打擊 strike+pull\|stun\|slow\|confuse),**單扇形 MUST 至少一招**,另驗密度(扇形人均 ≥ 非扇形 ×2)。**MUST NOT** 為了湊達標去換掉 lore 人設核心的招式(s07 攔截領域 / m07 拒止穹頂刻意保留在 1/2)|
| **對進戰模型**(`tools/duel.mjs`)/ `ALTITUDE.*` / `FAN_FLOOR`・`FAN_MUZZLE`・`fanFalloff` / `CLASS_SYM.K`(陣營對抗係數對稱化) | `npm run bal` ⑤ —— ⓐ陣營 SWARM vs STEEL 50±5pp ⓑ三機種各 50±5pp ⓒ**較高方 50±3pp**(高地換視野與機動、不換勝負;舊 ALTITUDE 值只有 48.3% = 搶高地淨虧損)ⓓ非豁免角色 ∈ 20~80%(豁免 MUST 具名附理由 —— 模型**只算武器**,招式導向角色會沉在尾端)ⓔ接近期單方面損失 ≤40% EHP。**改 `CLASS_SYM.K` MUST 同時看 ① 三機種**(校正落在跨陣營那一欄,但波次含坦克 ⇒ ① 會微動;K=1 完全對稱會讓陣營勝率衝到 59%,校準值 0.5)|
| `SPECIAL`/`BARRAGE.DMG_MIN\|MAX`/`SQUAD.KAMI.N`/`DECOY.BOMB_MAX`(機種絕招傷害預算與切分) | e2e「機種絕招三招同預算」段(三招在綜合 Lv1/2.5/4 的總傷害互差 ≤2%、32 角重砲倍率全在夾制區間、整夾追加 = 一份預算)+ `npm run bal`(bal **刻意不含**三招 burst ⇒ 四不變式應不動,動了就是把加成套進了持續 DPS 路徑) |
| `BOT_DIFF[].gap\|react`/`BOT_OPS`/`bots.js _op()`(電腦難度操作節奏) | e2e「電腦難度操作節奏」段(難度單調、最高難度對齊頂尖 FPS 電競 0.15s、全類操作合計 ≤ 手速上限、反應時間內不開火)+ `npm run sim`(headless 對局跑得完、無例外)+ 沙包輸出探針(90s 輸出 MUST 隨難度單調遞增) |
| `ECON.UPG_BASE\|UPG_INC\|UPG_L3`(八軌階梯單價) | `npm run bal` ③(收入 ≈ 八軌全滿 ±10%;第三階改 200 後餘裕僅 1.7 個百分點)+ e2e「八軌升級第三階單價」段 |
| `aoeClass`/`trajClass`/`LANCE`/`ARMING`(範圍三分類 / 彈道五分類 / 貫穿半徑 / 最短距離) | 32 角分類覆蓋率(重武器全數歸類、輕武器不歸類)+ `heroLance` 貫穿衰減直測(首個全額、之後 `DECAY^i`)+ `npm run bal`(首發全額 ⇒ 四不變式應不動,動了就是衰減套錯位置) |
| **直線貫穿命中判定**(`_lanceHits` 幾何 / `LANCE.R\|BARRAGE_F\|VBAND_F` / `lanceR` / `hitR`・`TARGET_R`・`HERO_HIT_R` / `_resolveAim` 的 `pierce` / `_lancePierced`) | `node tools/audit_lance_hit.mjs`(27 項離線直測):**打在塔身側面(離塔心 5m)MUST 命中、完全打偏 MUST 落空**、**射線止於目標近側表面 MUST 命中**(len < 到中心距離)、長度不足/背後 MUST 落空、貫穿序與 `DECAY^i` 逐項對上公式、垂直帶塔頂命中·帶外落空、**傾洩窗加粗 MUST 生效於伺服器結算**(演出的 1.5 倍粗不得是空頭支票)、友軍/駐守不列入。**改完 MUST 做反向驗證**:把 `_lanceHits` 寫回舊制(點判定 + 中心須落在線段內),稽核 MUST 在對應兩條紅字 |
| `BALLISTIC.LOB_*`/`AA_MV`/`_lobAim`(榴彈火控解) | 瀏覽器真開房冒煙:同一目標三個高度各射一發,`bullet.vel` MUST 等於 `_lobFc.vel`、爆點高度 MUST 對上瞄準高度;弧高 MUST 隨距離變(40m ≈ 0.2m / 172m ≈ 3.7m);合成稜線擋道 MUST `ok:false` 且不送 `lock` |
| `hitH`/`TARGET_H`/`HERO_SIZE`(命中量體 = 顯示高度) | headless 直測 `_blast`:機體垂直帶內任一高度同額、1.8r 外歸零、塔頂 = 塔底;`_lanceHits` 掃頭部高 MUST 命中。**動 `hitR`/`TARGET_R`/`HERO_HIT_R`(水平量體)MUST 一併跑 `node tools/audit_lance_hit.mjs`** —— 那組值同時是 `game.js COLLIDER` 的碰撞半徑 |
| `AIR`(GRAV/OFF_GROUND/KINDS)/`envTrigger`/`TERRAIN_FX.*_EYE_F`(騰空豁免 / 空中狀態 / 地形異常門檻) | headless 直測:`airUnitY('robot')` MUST = `jumpApex(UNITS.robot.jump)`(**普通小跳實測頂點 MUST < 此值** ⇒ 小跳仍踩雷、蓄力跳不踩)+ 火場 y=0 灼傷 / y>ε 免疫、**無人機 y=10 MUST 仍灼傷**(飛行機種吃 `fire.maxY`,平衡不動)+ `heroPos` wet=2 扣血 / 騰空 wet=0 立即停。瀏覽器真開房(有水域場地,如倫敦泰晤士)同步泵幀迴圈:深水 code=1、淺灘/沼澤帶上緣 code=0、跳躍中 air 幀 code 全 0 |
| 射程/傷害/`sight`/`RANGE_SIGHT_F` | e2e 重驗(`[#INC-104]` 輕武器 NPC 基準 range MUST ≥170;t01/s02 是確定性指定角 MUST 保持 crit:0;s02 heavy MUST 保持 launcher)+ 重驗「塔 310 > 所有輕武器/NPC」壓制不等式與「所有重武器 > 塔 310」不等式 |
| 骨架/關節/步態 | 全角色 rig 稽核 + `node tools/audit_cast_jump.mjs` |
| 武裝掛點/槍口 | `audit_muzzle.mjs` 範式(32 英雄 + NPC 四陣營) |
| `MAP_EXPAND`/`CLEAR_F`/`LANE_MIN`/塔位 | headless 冒煙:建 `BattleSim` 數 `sim.camps.length`(基準 L1 2/2、L2 4/4、L3 6/6) |
| `VENUES[].ll` / `MAPGEO` 尺寸常數 | `node tools/bake_venue_lanes.mjs` 重烤 `venueLanes.js` |
| `venueLanes.js`(重烤)/ `TOWER_*` / `tower.range` | `node tools/audit_map_rules.mjs`(規則 #4 重疊)+ `node tools/audit_lane_sep.mjs`(兵線不接觸)+ `node tools/audit_lane_grade_sep.mjs`(結構側面進出 + **規則 #5 隧道內塔 ≥20% 射程涵蓋洞口外**) |
| **明隧道**(`biomes.js tunnelWallProfile`/`TUN.WALL_MIN\|EAVE\|PARAPET\|BUT_GAP\|BUT_MAX`/牆緞帶 `yF`・`yT`/`galBase`/外露頂板・女兒牆・扶壁) | `node tools/audit_open_tunnel.mjs`(51 項:Ⅰ 判定直測 + Ⅱ **執行 biomes.js 真正的發射器原文**逐頂點量幾何 + Ⅲ 純表現層靜態規則)—— **深埋隧道 MUST 逐點與舊制相同**(牆 = 路面−0.3 ~ 天花+0.2、不長頂板扶壁 = 舊行為不得回歸)、單邊薄只改**那一側**、挖穿時 facade 底緣 MUST 沉到側坡地表之下、頂板半寬 MUST = `hw + EAVE` 且 `EAVE > 0.6`(蓋過天花板小段)、扶壁的 local +X MUST = 擺位用的側向法線(A26)、`tunnelSegs`/`ceilSegs`/`hw`/`cols` MUST 不動。**改完 MUST 反向驗證**:把判定寫回「一律判成明隧道」/扶壁朝向差 90°/擺位差正負號/簷口窄於 0.6,稽核 MUST 在對應條目紅字 |
| `SOLDIER_H`/`HERO_SIZE.mul`/`BRIDGE_RISE`/`TUN.CLEAR` | 重驗「淨空 > 最大機體 4.5m + 0.2 頭頂餘裕」 |
| 塔或機甲任一數值 | 重算 `towerHp = 1.8 × heroEHP × heroDPS / towerDPS` |
| **地形射線**(`terrain.rayTerrain`/`markTriDead`/`punchPortalHoles`/`TERRAIN.GRID_N`)| `node tools/audit_terrain_ray.mjs`(11 項離線直測):與「暴力掃完全部三角形」逐條比對 —— 命中/未命中一致、命中距離 Δt < 1e-3、命中點 y 與 `heightAt` 同源、**打洞後穿洞射線不再被擋且仍與基準一致**、射點在圖外/平行軸/far 太短等邊界。**加速比應在兩位數以上**(退回個位數 = 網格行進退化成整圖掃描) |
| **表現層資源生命週期**(`_takeProjectile`/`_dropBullet`/`_freeEffect`/`FX_MAX`/`markShared`/`disposeTree`/`unitGeo`/`_dpr`/`antialias`)| ①`node tools/audit_gpu_lifecycle.mjs`(34 項靜態規則):地形不回 raycast 目標、彈體/特效不得只 `scene.remove`、共用幾何全數 `markShared`、高頻特效不重配幾何、觸控填充率設定(桌機行為不得回歸)②瀏覽器真開房冒煙:持續開火 60s 後 DevTools **Memory → GPU/JS heap 不得單調上升**,`renderer.info.memory.{geometries,textures}` 應在上限內震盪而非持續增加 ③改 fade 回呼的 scale 時 MUST 目視光束粗細(單位幾何的 scale **就是半徑**,舊版是純比例 —— 漏乘 `r` 會讓光束變成 1m 細線)|
| **三種遊戲機制**(`server/rooms.js`・`server/server.js` 路由・`public/js/netmode.js`・`net.js makeNet`・`localhost.js`・`tools/build_solo.mjs`・`.github/workflows/*`)| ①`node tools/audit_net_modes.mjs`(約 60 項靜態規則 + netmode 直測):三支瀏覽器端伺服器模組無 Node 內建 import、`server.js` 不自己 new BattleSim/BotBrain、`main.js` 不自己 `new Net()`、dev 白名單 = build 複製清單、`index.html` 靜態鈕面 = `LINK_MODES`、節點網址正規化(含 `ftp:` 一律拒絕)②`node tools/audit_solo_boot.mjs`(真瀏覽器,不載 three):鏡射佈局下 import 鏈成立、**`data.js` 只有一個模組實例**、瀏覽器內跑完一局收得到快照、`kill()` 後 tick 停止 ③`npm test` 的「單機機制:瀏覽器內 RoomHub 迴路」段(驗證與伺服器同標準、自動補電腦玩家、`shutdown()` 收乾淨)④WS 端對端全段 MUST 全綠(rooms.js 抽離後行為 MUST 不變)⑤`node tools/audit_ui_layout.mjs`(連線機制三選一同列、鈕面不溢出)|
| **程序生成物件零件擺位**(`hazards.js BUILDERS` / `biomes.js` 的 `VEG_DEFS`・`GIANT_DEFS`・`GIANT_DECO` / `xform.js vegPartXform`)| `node tools/audit_object_joints.mjs`(解析式接合稽核,約 5300 個接合:20 種障礙物 × 8 seed × sc 0.75/1/1.35 + 8 種神木 + 16 種植被 + 9 種巨木特徵,各驗正株與「轉向+微傾」)—— 每個接合在**接合方向的法平面上取兩個互相正交的觀察角**量縫,四條硬失敗 FLOAT / PARTIAL / DETACHED / ISOLATED(見 A26/A27 與該檔檔頭)。合法的接合型態(主人/貼面/中心貫穿/橫躺觸地)有 rescue,豁免一律附理由。**改完 MUST 順手做反向驗證**:把改動故意寫回錯的那一版,稽核 MUST 失敗(否則等於沒驗到) |
| 小地圖顯示範圍(`mmMode`/`_mmWindow`/`_world2mm`/`_world2mmFull`/`_mmShadows`/`MM_NEAR`) | ①`node tools/audit_minimap_view.mjs`(16 項離線直測):full 模式 `_world2mm` MUST 與 `_world2mmFull` 完全一致(舊行為不得回歸)、near 模式半徑 = `sight × AIM_SIGHT_MULT × PAD` 且自機置中、貼邊夾制不出圖、地圖小於顯示窗時該軸退回全圖、`_world2mmFull` MUST NOT 隨模式改變(見 A24) ②瀏覽器真開房冒煙:M / 十字鍵右切換後底圖與標記同框(單位不飄)、切回全部時**先前探索過的迷霧位置不變** |
| 機種絕招觸發條件(`GAME.ABILITY_HOLD_S`/`_tickHoldAbility`/`_fireHoldAbility`/`_rmbUp`) | 瀏覽器真開房冒煙:①**一般模式**長按右鍵 MUST 出招且**放開後不切進狙擊模式** ②狙擊模式長按同樣出招 ③短按右鍵仍是切換模式(彈夾空時仍走換彈)④觸控 ZR 出同一招且鈕面顯示 CD ⑤三機種各驗一次(自殺機/重砲/餌機) |
| `mobile.js`(虛擬搖桿/陀螺儀)/ `_applyLook` / `_moveAxis` / `_cmd` / 觸控版 CSS | ①**桌機不得回歸**:鍵鼠開一局確認移動(含對角線速度)、滑鼠視角、右鍵短按切瞄準/長按絕招、ESC 選單全同舊版 ②`node tools/audit_touch_layout.mjs`(54 組:6 尺寸 × 4 機種 × 左右手 + 疊層可點性)—— **四分區 A 機體資訊 / M 小地圖 / L 左手控件 / R 右手控件零重疊**、控件不出界、**十字鍵 MUST 有 `map`(小地圖範圍)與 `gyro`(陀螺開關)且全層 `gyro` 恰好 1 顆**(見 A22)、**肩鍵/扳機直條逐列左右對應**(第 1 列 L ⇄ R、第 2 列 ZL ⇄ ZR 絕招,ZL/⇄換機 隱藏時列位 MUST NOT 遞補 ⇒ `.tl-sys` MUST 是固定 4 列的 grid + 逐鈕 `grid-row`,**MUST NOT 退回 flex**)、ABXY 圓心距 ≥ 兩半徑和(d ≤ 41.4% 外框 ⇒ **外框 MUST ≥ 116px** 才有 44px 觸控目標)、**十字鍵外框 MUST 由臂長推導**(3 格 × 臂;用百分比切外框的話臂一定 < 44×40)、觸控目標 ≥ 44×40 ③**疊層可點性**(同一支腳本):`#touchLayer` 未收起時疊層鈕 MUST 被 `#tlLook` 擋住、掛上 `body.tl-off` 後三顆鈕 MUST 都點得到(見 A19)④`node tools/audit_touch_gesture.mjs`(17 項合成指標事件,**空處手勢**):單指拖曳 MUST NOT 開火、純雙擊 MUST NOT 開火、輕點→按住 與 輕點→拖曳 兩條路徑都 MUST 開火且放開即停、間隔/時長邊界、A 鈕並用時兩邊都放開才停火、疊層開著不吃手勢 ⑤真機冒煙:類比十字鍵推進量、拖曳視角、左手模式鏡像、轉向後畫布不拉伸 |
| `#touchLayer` 的**節點位置**或 `--tl-stick`/`--tl-dpadw|h`/`--tl-gp`/`--tl-rstick`/`.ori-*` 版型段 | 搖桿節點 **MUST 留在 body 層**(`position: fixed`)—— 放進 `#game` 就只有戰鬥看得到(前科:玩家回報「沒看到虛擬搖桿」)。尺寸/定位全靠那幾個 CSS 變數,**MUST 保留 `body.touch-ui` 的保險預設值**,否則少掛 ori class 就塌成 0×0。改完 MUST 跑大廳端對端量測(真手機 profile + **不設覆寫**):入口鈕→診斷→設定列→試玩搖桿有實際尺寸 |
| **選單版型**:`style.css` 的 `body.touch-ui.ori-*` 選單段 / `@media (max-width: 760px)` / `.char-pick`/`.cd-lower`/`.cd-art` / 任何**鈕面文字** | `node tools/audit_ui_layout.mjs`(309 項:4 直式 + 2 橫式尺寸)—— ①**鈕面 MUST NOT 含括號補述**(掃 `index.html` 靜態鈕 + `main.js` 動態 `textContent` 與內嵌 `<button>`)②**桌機左右並排的區塊/按鍵,直式 MUST 維持左右並排**:大廳三入口同列且「劇情戰役」落在首屏、陣營卡 STEEL 左 / SWARM 右、房間動作列同列、疊層按鈕列同列 ③選角**頭像 ▏展示台 左右並排**,且 `.cd-art` **MUST 解除 sticky**(單欄時不透明的頭像會蓋掉詳細說明)④鈕面文字不溢出方框(`scrollWidth ≤ clientWidth`;clip-path 會直接把字裁掉)、畫面無橫向溢出 ⑤**每個可關閉疊層 MUST 有右上角 ✕ 且底下沒壓住內容** —— ✕ 是 `position: absolute` 不佔流內空間,框 MUST 掛 `.has-close` 讓出上緣(`.story-brief-box` 是唯一例外:第一件是全幅立繪)|
| 陀螺儀相關(`Gyro`/`gyroBlockedReason`/`TOUCH.gyroSrc`/`LOOK.GYRO_*`/`--https`) | ①`node tools/audit_gyro.mjs`(18 項合成事件):兩條感測路徑(`deviceorientation` 融合姿態 / `devicemotion` 角速度)軸向分離且增益 1:1、**俯仰 MUST 同號**(相機朝機背 ⇒ beta 由 90 降到 0 = 俯視,對應 `rotationRate.beta` 為負)、橫式軸向自動補正、三種自動切換(收不到 → 換路徑 / alpha 恆 null → 換路徑 / 鎖死來源不偷換)、兩條都不通才關閉並講原因 ②預設開啟 + **十字鍵下「陀螺」鈕**一鍵收放(2026-07-27 起 ZR 改給機種絕招):按一下關/再按一下開且鈕面 `.on` 跟著走、**iOS 靜默啟用 MUST NOT 在非使用者手勢中要權限**(要了會被拒,連帶把「預設開啟」的偏好一起關掉 ⇒ 保留偏好並提示按那顆鈕 —— 提示文字 MUST 指到真的存在的鈕)③**MUST 用 `https`(或 localhost)真機實測** —— `http://<區網 IP>` 不是 secure context,瀏覽器靜默不派送感測事件,在那裡測永遠是「沒反應」。跑 `npm run mobile` 後手機連 `https://`:轉手機 → 準星同向轉動;無磁力計的機器 MUST 驗自動切到「角速度」後水平轉得動 |

**e2e 結構備忘**:前段 import `BattleSim` 直測(`_add` 的測試假人無 `lane`,tick 前 MUST 刪掉);迷霧下要「看到」敵方 MUST 另開 `mode:'spectator'` client 偵察。瀏覽器冒煙借 mapping_elf 的 Playwright,`window.__SVS` 存取 app 狀態。
