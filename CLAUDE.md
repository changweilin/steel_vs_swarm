# 無人戰略:鋼鐵與蜂群 (Steel vs. Swarm) — 全域儲存庫準則

> **本檔定位**:雙層情境系統的**全域層**(長期不變標準)。活躍模組層見 [`public/js/.claude.md`](public/js/.claude.md);歷史細節見 `CLAUDE-orig0718.md`(2026-07-18 前逐日檔案庫)與 git 歷史。精煉基準日 2026-07-29。
> 關鍵詞 **MUST / MUST NOT / SHOULD** 依 RFC-2119 解讀。違反 MUST NOT 條目 = 架構違規,直接退回。
> **細節住哪裡**:本檔只記「原則、禁令、改什麼 → 驗什麼」。逐項斷言、幾何公式、邊界案例住各 `tools/audit_*.mjs` 的檔頭註解與斷言本身 —— 查細節先開稽核腳本,MUST NOT 憑記憶重建。

---

## 0. 核心原則(全部 MUST 內化;後文一切規則都是這十條的具體化)

1. **伺服器唯一真相**:HP/傷害/彈藥/經濟/勝負全在 `server/sim.js` 結算。客戶端只做三件事 —— 送輸入與命中回報、渲染 8Hz 快照插值、跑表現層彈道/物理。MUST NOT 有任何「客戶端先改狀態再同步」;防作弊驗證(射程 ×1.25、迷霧、LOS、高度)只住伺服器。
2. **單一真相縫(Single Seam)**:跨檔共用的邏輯與數值只准有**一個**結算點,發現第二份實作即是 bug;推導得出的值 MUST NOT 手寫。縫的索引見 §2。
3. **兩端同量體**:碰撞、彈道、命中、LOS 在客戶端與伺服器 MUST 吃同一份幾何(同一個盒/圓柱/垂直帶/半徑)。兩端分家的代價不是「差一點」而是**靜默丟包** —— 客戶端算命中、伺服器算被擋,傷害無聲蒸發(A18/A30 一族)。
4. **表現層歸表現層**:純視覺改動(材質/擺件/擋土牆/緣石/座艙)MUST NOT 動到權威幾何(通行寬/碰撞/LOS/平衡);反過來,演出取用的尺寸 MUST 來自權威值(看到多粗 = 打到多粗),MUST NOT 為了好看自己放大。
5. **確定性**:場景佈局跨客戶端逐位元一致,散布路徑 MUST NOT 用 `Math.random()`(細則 §2.3)。
6. **降級,不例外;寧缺勿錯**:外部服務掛掉走 fallback、取樣不到合法位置回 null 略過、伺服器對回報「驗證後靜默丟棄」(細則 §2.4、§4)。
7. **真實世界尺度**:`SOLDIER_H`(1.8m)是唯一身高單位,MUST NOT 調回超尺度(細則 §2.5)。
8. **三機制一架構**:雲端/區網/單機只換**傳輸層**不換架構;`rooms.js`/`sim.js`/`bots.js` MUST 保持瀏覽器可執行,URL 佈局 MUST 鏡射儲存庫佈局(細節見 A28)。
9. **稽核為正 + 反向驗證**:本專案無 runtime logger;正確性防線 = 離線稽核(`tools/audit_*.mjs`,以 **執行原文** 驗真品)+ e2e + `npm run bal`。新增系統 SHOULD 同步補稽核而非加 log。**改任何有稽核的判定,改完 MUST 做反向驗證**:把判定故意寫回壞版/舊制,稽核 MUST 在對應條目紅字,否則等於沒驗到。
10. **刻意設計 MUST NOT「補完」**:一批看似 bug 的行為是刻意取捨,修它就是引入 bug —— 彈藥漂移(A9)、爆風不吃 LOS(A11)、直升機不接塔 SAM(A15)、貫穿判定是 2D 而非 3D(A18)、對進戰模型只算武器(§2)、AoE 不爆擊(§4)。動手前先查 A 表。

---

## 1. 系統架構與技術棧

**產品**:瀏覽器 DOTA+FPS — 蜂群同盟 (SWARM) vs 鋼鐵協約 (STEEL);兩陣營主力機種不同但**皆為三機種混編**(2026-08-02)。真實世界地圖選址 → OSRM/Overpass 取真實道路兵線 → 即時 3D 地形開戰。

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
| `server/server.js` | 傳輸層:HTTP 靜態檔 + WebSocket + `/healthz`(單機完全用不到) |
| `server/rooms.js` | `RoomHub` 房間/配對/8Hz 戰鬥生命週期 — 三機制共用,MUST 保持瀏覽器可執行 |
| `server/sim.js` | `BattleSim` 權威模擬核心(single source of truth) |
| `server/bots.js` | `BotBrain` 電腦玩家狀態機(推線/交戰/撤退) |
| `public/js/data.js` | 全遊戲平衡數值唯一真相;**伺服器直接 import 這支客戶端檔** |
| `public/js/*.js` | 渲染/FPV/輸入/HUD(檔案地圖見 `public/js/.claude.md`) |
| `tools/` | 離線工具:平衡驗證、兵線烘烤、稽核腳本、單機版打包、LOGO 管線 |
| `.github/workflows/` | 回歸驗證 CI + 單機特化版部署 GitHub Pages |
| `test/e2e.mjs` | 前段 `BattleSim` 確定性單元測試 + 後段 WebSocket 端對端,約 60 項斷言 |
| `reference/` | 上游唯讀副本 — **MUST NOT** 修改,只准參考 |

---

## 2. 通用標準與慣例

### 2.1 單一真相縫索引

每列 = 一個縫。共通鐵律:消費端 MUST 全部走這個縫,MUST NOT 另寫第二份實作或在別處二次運算;**推導值 MUST NOT 手寫**。

| 領域 | 唯一縫 | 要點 / 禁令 |
|---|---|---|
| 平衡數值 | `data.js` | 射程/傷害/經濟/波次/角色/招式全在此;sim/game MUST NOT 硬編碼;敘事文字去 `lore.js` |
| 角色機種 | `data.js CHARACTERS[ch].kind` + `charKind()`/`heroKindOf()` | 2026-08-02 機體混編:**陣營 ≠ 機種**,32 名角色一律顯式標註 `kind`;MUST NOT 由 `side` 推機種。編制固定 蜂群 7/3/2・鋼鐵 3/7/2・傭兵 2/2/4(無人機/機甲/變形機甲),機體設計 12+12+8 款**每款恰好一名角色使用**。機體換陣營時,綁機體的 `models.js MOVE_SIG`/`CAST_SIG` 與 lore `proto`/`bond` MUST 整組跟著搬;武器/招式/塗裝綁角色不動 |
| 推導值 | 各推導式 | 賞金表、`UNITS.drone.hp`/`SQUAD.DMG`(← `SQUAD.BUFF`)、`UNITS.bunker.hp`(= 塔一半)、塔位 `solveTowerSites()`、`MINES.PER_LANE`/`AA_SITE.range`(等面積)、`TOWER_SEP_F`(= 2 − TOWER_OVERLAP)、`FAN_MUZZLE`(← `FALLOFF.PLATEAU`)—— 一律 MUST NOT 手寫 |
| 砲塔佈局規則 | `data.js towerLayoutAudit()`(#4 射程重疊)/`towerTunnelAudit()`(#5 洞口涵蓋) | 烘焙/mapSelect/伺服器/稽核共用;#5 MUST NOT 下放成執行期挪塔(兩端塔位會分家) |
| 兵線導航規則 | `data.js laneUTurnAudit()`(U-turn)/`laneTurnAccumAudit()`(主軸偏航累積 ±`TURN_ACCUM_MAX_DEG`,順逆抵消)/`laneStructEntryAudit()`(橋隧只走出入口) | 生成期硬門檻淘汰;規則①只在離線 bake(唯一有逐邊結構旗標);②③互相獨立,MUST NOT 以一代二 |
| 隧道/地下道剖面 | `biomes.js tunFloorAt()` + `underpassPlan()` + `strucHw()` | 山體隧道 = 平直內插;地下道 = 同基準減 smoothstep 下沉。消費端 MUST 吃 `way._tun[ri].pts`(含引道延伸段) |
| 道路塗裝寬/結構接合 | `biomes.js carriageHw()`(塗裝車道半寬)+ `flareHw()`/`ROAD_FLARE_M`(結構端漸縮帶)+ `markBaseAt`(標線基準高) | **通行寬 `strucHw`(≥`PASS_W`/2,吃 decks/tunnelSegs/走廊/伺服器碰撞)與塗裝寬 `carriageHw`(= `roadWidth`/2 = 結構外那條路的通行寬)是兩件事**:標線/避車道邊帶/漸縮帶三消費端 MUST 全吃 `carriageHw` ⇒ 洞口/橋頭車道數與路緣線逐條對齊;MUST NOT 在結構側改吃 `hw`、MUST NOT 依差額三元切換。差額 = 避車道邊帶,階差交給往結構外 `ROAD_FLARE_M` 的漸縮帶(**純視覺**,MUST NOT 進 decks/tunnelSegs/cols/走廊)。**邊帶 MUST 跟著漸縮帶同步收到零**(2026-07-31 使用者回報「洞體內外的道路沒接好、寬度不同」):結構內是「車道 + 兩側邊帶」,漸縮帶只鋪柏油 = 出洞那 12m 變全寬柏油、邊帶憑空消失 = 斷面在洞口跳一階;邊帶吃**同一個 `fhw`**(MUST NOT 自己再算一次半寬),車道緣全程不動。橋與隧道同為工程結構物 ⇒ 恆柏油(`strc \|\| brg`)且橋面照畫標線,基準高 MUST 走 `markBaseAt`(結構 `tFloorAt` / 橋 `deckAt − ROAD_LIFT`),回退貼地取樣會把標線畫到山頂/河床。稽核 `audit_road_joint.mjs`(74 項)|
| 明隧道判定 | `biomes.js tunnelWallProfile()` | **明隧道 = 一側在地形內部(整面牆)+ 一側在地形外部(柱列);貫穿整個地形(兩側都在地形內)一律以隧道處理,兩側都是牆**(2026-08-01 使用者定案)。開放側 MUST 三條件同時成立:①`WALL_MIN` 內藏不住頂板 ②牆背 `NEAR_W` 內無高過頂板的實體支撐 ③**牆外 `OUT_W` 內地表落到路面以下**(= 這一側真的在地形之外)。少了③ 就是舊制:金龍隧道那種只差 0.2~1.5m 蓋滿頂板的真山體隧道會被整段判成明隧道,柱列開向山肚子、`carveGalleryBands` 還把山壁挖成一條溝(2026-08-01 使用者回報)。判定跑三次(carveGalleryBands 呼叫端在開挖**前**、buildRoads / markGradeCorridors 在開挖**後**)MUST 同解:①② 吃 heightAt 但開挖只降不升,③ 吃 `terrain.natureAt`(**天然**地形快照)⇒ 自家路塹不算證據(金龍隔壁孔的洞口路塹曾讓同一段路開挖前判牆、開挖後判柱 = 柱外淨空帶沒挖卻長出柱列)。地下道恆非明隧道(三消費端各自以 `sink` 擋掉;改制後路面沉在地表下 ⇒ 條件③ 天生不成立,是第二道防線)。構件共用同一份 `open/gy/nx,nz`;落地基準只有 `galBase` 一份;開放側 = 矮牆 + 連續柱列,柱間**透明可見可穿透**(2026-07-30 使用者定案):覆蓋段 tunnelSegs 附 `gal` 遮罩 → slab 第 7 欄 → 伺服器 `tunnelSideExit`/`_slabSep` 開放側放行,兩端 MUST 同判;幾何(`hw`/fy/cy/ceilSegs)MUST 與 gal 無關;柱列純視覺 MUST NOT 進 `cols`(伺服器無逐柱語意)。**近帶岩背**(2026-07-31):`NEAR_W` 內任一取樣點高過頂板 = 牆背是實體山壁/岩脊 ⇒ 該側維持整面牆(只看「7m 內有低點」會把柱列開向岩壁);**洞內三淨空** = 地形楔 `galBores`(併入 punchPortalHoles **同一次**呼叫,壓實不可重入)+ `markGradeCorridors` 明隧道段照樣 blockArea(同縫判定)+ `game.js _slopeDegAlong` 洞內(tunnelAt 捕捉)豁免坡度閘。**落石棚強制覆蓋**(2026-07-31):OSM `tunnel=avalanche_protector` 的頂是**建的**不是山,整段強制視為覆蓋(MUST NOT 依「地表藏得住天花板」判 —— 峽谷落石棚常整段裸露 = 結構整段消失);隧道鏈 MUST 同 tunnel 值才併(chainWays 只保種子 tags,混併會吃掉旗標);**柱外淨空帶** `terrain.carveGalleryBands`(strip 於開挖前經 tunnelWallProfile 單一縫收集):開放側 [hw−0.5, hw+`GAL_CLEAR_W`] 的土脊真開挖到路面(只降不升、只動頂板以下 ⇒ openness 對這刀穩定;斷面**內**的楔形仍走 punch —— 高度場挖不掉拉伸陡面) |
| 英雄武器/招式解析 | `heroWeapon()`/`heroAbility()` | HEROIC ×1.2/×1.5、SQUAD 折算、rangeCap 全在這;MUST NOT 二次乘算 |
| 傷害衰減 | `data.js dmgFalloff/blastFalloff/fanFalloff` | sim 結算與客戶端 HUD 共用 |
| 波次編制/節奏 | `data.js waveComp()`(固定編制)/`waveMarchSpeed()`(= 編制最慢者)/`waveSpacingM()`(= `GAME.WAVE_S` × 行軍速度)+ `sim.js waveInterval()` | 出兵間隔**固定**(2026-07-30;`GAME.WAVE_S`,不再逐波加速);開場預置兵線 `sim._prefillLanes()` 的間距 MUST 吃 `waveSpacingM()`,擺位與常規出兵共用 `_spawnLaneWave()`,MUST NOT 各寫一套。預置上限 = 該兵線**第一座砲塔**(`solveTowerSites` 回傳序末項的 frac);塔位 MUST 吃 `sim.towerSites` 那一份解,MUST NOT 再解一次 |
| 陣營小兵強化 | `data.js CREEP_UPG`/`creepUpgMul()` + `sim.js _creepMul()`/`_bounty()` | 等級住 `sim.creepUpg[side][lane]`(**同陣營共用、兵線分開**);倍率於 `_spawnLaneWave` 生成當下寫進 `e.cu`(不追溯既有小兵),hp/dmg/armor/賞金四個消費端 MUST 吃同一份 `e.cu`。賞金(擊殺全額 + 助攻 ×`ASSIST.F`)只准經 `_bounty()`,MUST NOT 直接讀 `ECON.BOUNTY[kind]`。解鎖門檻 = 八軌全滿(`_upgAllMax()`,商店 UI 同判);解鎖後該區塊 MUST 排在商店**最前面** —— `.shop-box` 是 `max-height:86vh` 的捲動容器,八軌本身就已溢出一般筆電視窗且無捲動提示,掛在最後 = 使用者根本看不到(2026-07-30 回報);解鎖當下八軌保證全滿,上面 8 列全是死列 |
| 陣營對抗對稱化 | `data.js CLASS_SYM` 推導區塊 | 校正係數整組等比套回;MUST NOT 逐武器手改 `vs` 湊平衡;個別角色改 `dmg` 階梯 |
| 對進戰模型 | `tools/duel.mjs`(bal ⑤ 匯入) | **只算武器**是刻意的(只模擬一半招式家族會系統性偏袒);招式導向角色走具名豁免 |
| 機種絕招預算 | `data.js SPECIAL` + `specialBudget()` | 總預算隨輕/重綜合等級(可分數階,MUST NOT 進 `tierVal`),三招各自切分;MUST NOT 手寫傷害常數或退回單一武器軌 |
| 三招機種絕招(2026-08-01 使用者定案) | 無人機**飽和攻擊** `SQUAD.KAMI`(N=4)/ 變形者**集束炸彈** `DECOY`(BOMB_MAX=6)/ 機甲**極音速飛彈** `HYPER` + `hyperApex()`/`hyperRange()`/`hyperDiveSpd()`/`hyperFlightS()`;三招共用 `SPECIAL` 預算與 `game._fireHoldAbility()` 單一派發縫 | 舊「重砲模式/巨砲」(`BARRAGE`/`barrageShots`/`barrageDur`/`LANCE.BARRAGE_F`/`_barragingDmg`)**整組移除**:重武器射擊路徑上 MUST NOT 再有任何「這一發免彈夾/免電力/免射速閘」的旁路。飽和攻擊的「攻擊力減半、數量加倍」= 同一件事(每架 = 預算 ÷ `KAMI.N`),MUST NOT 另寫折半係數(那會把總預算也砍半);橫向站位走 `kamiSide(i)` 單一縫(伺服器散開角 + 客戶端貼身站位同吃),MUST NOT 復辟 `i === 0 ? -1 : 1`。極音速飛彈是**伺服器實體**(kind `hyper`,可被鎖定/擊落):爬升 → 螺旋俯衝兩相位全在 `sim._tickHypers`,客戶端只渲染與播報,MUST NOT 在客戶端算爆風(A1);被擊落**刻意不引爆**(攔截成功 = 完全否定)。集束炸彈逐顆走 `sim._decoyBombTarget()` 個別瞄準(名冊 `d.bombed` 輪替),事件帶投擲點 `fx/fz` ⇒ 客戶端畫**榴彈拋物線**;拋擲解與逐幀積分 MUST 吃同一個 `DECOY_BOMB_GRAV_F`(不同 = 畫出來的落點偏掉),傷害仍在伺服器事件當下結算 |
| 絕招載具 HP 校準 | `data.js towerDps()`/`towerSurviveHp()`/`towerKillHp()` → `kamiHp()`/`hyperHp()`/`decoyHp()`(各自 `kamiExposureS()`/`hyperFlightS()`/`decoyExposureS()`) | 使用者把三招的生存性一律以「**一座砲塔**持續射擊」表述(飽和攻擊剛好衝進去 2 架 / 極音速飛彈剛好打不爆 / 集束轟炸機剛好投得完 5+1 顆)⇒ 三個 HP 全是**推導值**,MUST NOT 手寫。三種載具一律 **armor 0 / 護盾 0**:校準要精確,EHP 就 MUST NOT 隨主機角色或升級漂移(舊 `KAMI.HP_F`/`DECOY.HP_F` 已退場,MUST NOT 復辟)|
| 飛行動力學(受擊掉高 / 爬升動力) | `data.js FLIGHT` + `airSinkM()`/`liftMax()`/`liftRegen()`/`liftDrainPS()`;消費端 `game._airSinkHit()`/`_stepLift()` | 2026-07-30 使用者需求。①掉高 = **位移** ∝ 傷害,校準錨「打完平均護盾+裝甲 = `SINK_TOWERS` 個砲塔高」⇒ 係數由 `SQUAD.DRONE_AVG_HP` × `TARGET_H.tower` 推導(MUST NOT 手寫、MUST NOT 改成速度制或逐機體血量制);②動力只有**往上飛**消耗,耗速 = 上限 ÷ `DRAIN_S`(推導不手寫),上限/回速正比於電力(`maxMp` / `mpRegen`×`chargeF`),見底 = **爬不上去**(MUST NOT 改成減速,與 `slopeBlocked` 同語意)。位置本就客戶端權威 ⇒ 真人那半住客戶端物理;**bot 沒有客戶端**,掉高由 `sim._botAirSink()` 補上同一支 `airSinkM`(兩條扣血路徑都要掛,含護盾全擋的早退),真人 MUST NOT 在伺服器再套一次;NPC 直升機/集束轟炸機/護衛機/極音速飛彈(伺服器腳本航線)MUST NOT 套 |
| bot 操作節奏 | `data.js BOT_DIFF/BOT_OPS/botOpGap()` + `bots.js _op()` | MUST NOT 另寫 tick 計數節流;持續開火刻意只吃反應時間、不吃手速閘 |
| AoE / 彈道分類 | `data.js aoeClass()`(blast/fan/line)/`trajClass()`(lob/flat/line/guide/fnf) | 由 `def.type`/`fan`/`guide` 推導;sim/演出/HUD 共用;MUST NOT 手寫逐武器分類表 |
| 貫穿演出 | `game.js _lanceVisual()` + `lanceR(def)` | 自機/他人/bot 共用;粗細 = 伺服器判定半徑。2026-08-01 起**無任何情境倍率**(舊 `LANCE.BARRAGE_F` 隨巨砲移除);`lanceR` 的第二參數 MUST NOT 復辟 |
| 榴彈火控 | `game.js _lobAim()`(每幀定案 `_lobFc`)+ 逐級降裝藥階梯 `_lobLadder()` + 積分 `_arcTrace(…, draw)` | 出膛向量/瞄準虛線/鎖定光暈/砲管仰角共用;光暈 = `_arcTrace minD ≤ LOB_TOL`,MUST NOT 退回直射線判定。**階梯與積分只准一份**:`_lobAim`(draw=true 寫繪製緩衝)與射程光暈判定 `_reachable`(draw=false)MUST 同吃 `_lobLadder` —— 判定端另寫簡化積分 = 光暈與實際彈道分家 |
| 出膛初速 / 彈頭飛行時間 | `data.js shotV0()` + `flightCapS()` | 拋射武器吃吊射初速而非砲口初速(差六倍);`game._shotV0` MUST 只是轉呼。AoE 彈頭**著彈**才回報 ⇒ 凡是拿著彈時刻驗「擊發資格」的閘門(`heroBurst` 需瞄準、`_gateFire` 裝填計時器)MUST 用 `flightCapS` 換算回擊發時刻,MUST NOT 手寫秒數;**射速閘刻意仍量真實時鐘**(著彈順序可能與擊發順序相反) |
| 導引頭機動 | `data.js SEEK` + `seekTurn()` | 角速度與「轉彎半徑 ≤ `SEEK.R_M`」兩個上限取寬者;`game._updateBullets` 兩處轉向 MUST 經此,MUST NOT 手寫 rad/s。**只放寬不收緊**(單純 `初速 ÷ R_M` 會讓慢速巡飛彈變鈍) |
| 射程閘門容差 | `data.js RANGE_TOL` + `altRangeMax()` | 伺服器複驗客戶端回報(命中/落點/射線)的網路寬容**只有一個值**;sim.js 每道射程閘門 MUST 吃它,MUST NOT 逐處手寫倍率。落點/爆點類閘門(`heroBurst`)拿不到目標實體 ⇒ 高度制空取 `altRangeMax()` 上限當誠實界(比客戶端 `_altRangeMul` 緊 = 高地合法彈著被靜默丟棄) |
| 「打得到嗎」判定 | `data.js REACH_RULE`/`reachRule()` → `game.js _reachable()` | 射程光暈的唯一判據(**亮 = 打得到**)。逐彈道五類全覆蓋:`path` arc(火控階梯)/ray(直線段);`hit` blast(落點落在 `blastCoreR` 核心帶,**刻意不吃 LOS** ← A11)/clear(線段整段淨空,對齊伺服器 `_losBlocked`);`arm` = 導引/射後不理的軌跡修正期轉警示色。消費端 MUST NOT 自己比對 `trajClass`/`def.type` |
| 爆風超壓帶 | `data.js BLAST`(`CORE`/`EDGE`/`EXP`)+ `blastCoreR()` | `blastFalloff` 與「打得到」判定共用同一組轉折點;曲線形狀不變,MUST NOT 在任一端手寫 0.5/1.8/1.3 |
| 異常狀態致盲白幕 | `data.js CC_FLASH` + `ccFlashAlpha()`/`ccFlashDur()`;觸發 `game.js _blindFlash()` | 純表現層(狀態效果仍伺服器結算):光學/電子系狀態(emp/conf/stun)**上升沿**觸發,白幕長度固定 = `ccFlashDur()`,MUST NOT 隨狀態剩餘秒數延長;強度表 MUST NOT 收物理系(slow/bleed/mark);逐幀曲線唯一驅動 ⇒ `.cc-flash` MUST NOT 掛 CSS transition/animation |
| 道路路基整平 | `terrain.js gradeRoadBeds()`(呼叫端 = `buildBiomes` roadInput 定案後唯一一處) | 一般道路(非橋/非結構隧道/非步道)乾地走廊橫向整成**切填平台**(陡橫坡一邊懸空一邊陷地形的解;2026-07-31)。四紀律:填方超過 `fillMax` 漸退、水域/沼澤節點不動、隧道開挖足跡(`carvedNodes`)優先、每節點認**最近的那條路**(髮夾彎成台階,MUST NOT 混平均);全深帶 = 塗裝寬 + 半格(雙線性內插吃得到帶外節點);零 rnd、floors 修改前整批取樣。稽核 `audit_road_bed.mjs` |
| 地形坡度移動 | `data.js SLOPE` + `slopeDeg()`/`slopeMoveF()`/`slopeBlocked()`;量測 `game.js _slopeDegAlong()` | 平緩帶 `EASE_DEG` = 兵線坡度限制 `MAPGEO.MAX_ROAD_GRADE_DEG`、阻擋角 = ×`BLOCK_F` 推導,兩者 MUST NOT 手寫(設計語意:**兵線走廊恆全速**,離開大路爬野山才減速)。坡度一律量**裸地形 `heightAt`**,MUST NOT 改量站立面 `_surf`(上橋引道會被 deckAt 捕捉成假峭壁);速度倍率吃固定前瞻 `PROBE_M`,MUST NOT 拿當幀位移(手感隨幀率浮動);三條豁免 = 飛行/騰空、人造鋪面(`STRUCT_M`)、零位移;**下坡一律不擋**、「爬不上去」MUST 由 `slopeBlocked` 表達而非倍率 0 |
| 視野鎖定 | `data.js VIEW_LOCK`/`viewLockStep()` + `game.js _tickViewLock()`(目標解析 `_coneAcquire()`、瞄準點 `_entAimPoint()`) | 觸控 ZR 按住 = 視野收斂到準星最近的敵方單位。**純客戶端視角輔助**(伺服器不參與,不涉 A1);每幀轉角只准經 `viewLockStep`(逼近係數與角速度上限取小者,MUST NOT 手寫 W/EASE)、套用只准經 `_applyLook`。**後座力刻意不抵銷**(使用者指定):相機角 = 基準角 + `recoil` + 震動,鎖定只拉基準角 —— 在 `_tickViewLock` 動 `camera.rotation`/`lookAt`/扣 `recoil` 都會把上踢無聲吃掉。目標解析與瞄準點各只有一份(`_coneAcquire` 只放寬參數、`_entAimPoint` 兩端同吃),MUST NOT 另寫掃描 |
| 蓄力跳水平移速 | `data.js CJUMP.AIR_SPD_F` | 兩個消費端 MUST 同吃 —— 起跳彈射初速(`_chargeJump`)+ 騰空(`_lowG`)操縱移速;垂直項(`CJUMP.V`/`GRAV_F`)MUST NOT 吃(否則跳高/滯空一起變,滿蓄頂點會撞 `AA_MIN_ALT` 前提) |
| 機體高度/半徑 | `data.js SOLDIER_H/HERO_SIZE/heroTargetH()/TARGET_H/hitH()` + `hitR()`(`HERO_HIT_R`/`TARGET_R`) | 同一把尺餵渲染縮放與伺服器命中量體;**爆風/貫穿/射程閘門一律量到命中量體最近點**(水平 `hitR(t)` + 垂直帶 `_bodyDy`,兩軸同一把尺 —— `_blast` 只做垂直、水平仍量中心 = 榴彈直擊 20m 主堡牆面只吃約五成超壓);貫穿半徑 = `lanceR(def) + hitR(t)`;`game.js COLLIDER` MUST 由 hitR/hitH 推導,但鍵集 MUST NOT 隨 `TARGET_R` 擴張 |
| 攀爬路線 | `climb.js`(規劃/抓握索引/設施幾何/`attachFaces()` 正面候選) | 詳見 A31 |
| 巨岩表面落點 | `biomes.js rockProbe(g)`(`wallR`/`slope`/`topAt` 射線實測) | 貼壁(峭壁樹/岩菇/侵蝕溝/棧道)與頂面(石屋/疊石/鳥巢台/電塔)落點一律**實測真幾何**;多面體小面內縮 4~5%、疊層收分、崩落塊撐大外廓 ⇒ 手寫剖面公式(側壁橢圓 × dome/taper)一律算不準,MUST NOT 復辟 |
| 圓形腳印落底 | `biomes.js sinkBaseY()` | 神木/邊界巨岩/巨岩/地標一律「中心 + 腳印周圈取最低」,寧可陷入山坡不懸空;MUST NOT 只取中心高度(下坡側整片浮空) |
| 連線機制 | `netmode.js`(模式/網址/`wsUrl()`)+ `net.js makeNet()` | `main.js` MUST NOT 自己 `new Net()`/看 `location.host`/寫單機文案分支;鈕面真相 = `LINK_MODES` |
| 操作方式(輸入裝置) | `ctrlmode.js`(`CTRL_MODES`/`ctrlMode()`/`ctrlPref()`/`setRoomCtrlMode()`/`ctrlScheme()`/`deviceScheme()`)+ 房主 UI `mobile.js renderCtrlModeRow()` + 設定 UI `renderCtrlSettings()` | 三選一(不限定/限定滑鼠鍵盤/限定搖桿)是**房間設定,由房主選擇**(2026-07-31 使用者定案):值住 `room.config.ctrl`(伺服器 `setRoomConfig` 只認 hostId、合法值取自 `CTRL_MODES` 同一份),客戶端 `_room` 的**唯一寫入路徑 = `sync` 廣播** ⇒ 房主按下只准上行、MUST NOT 先斬後奏。生效值合流只有 `ctrlMode()` = `房主定案 ?? 我的預設` 一處,MUST NOT 在別處自己寫 `room \|\| pref`;`ctrlPref()`(我的預設)只在開房時上行。**「目前操控」的選擇併入設定頁**:`setCtrlScheme` 只受理「不限定」—— 這就是「遊戲中不可變更,除非戰區選不限定」的唯一落點,消費端 MUST NOT 另判一次。裝置判定(`maxTouchPoints`/`pointer:coarse`/短邊)只有 `deviceScheme()` 一份,`mobile.js isTouchUI()` MUST 只是轉呼;搖桿層建/毀只住 `game.js _applyCtrlScheme`;`main.js` 的 `TOUCH_UI` MUST 是函式(常數 = 切換後文字停在舊版)|
| GUI 說明 / 懸浮提示 | `tip.js`(`installTips()`/`tipHTML()`/`attachTip()` + 單一氣泡)+ 文字表 `help.js UI_TIPS` + 取字 `uiTip()` | 2026-07-31 使用者定案:**遊戲內常駐說明一律改成 ⓘ 懸浮提示,並彙整到說明分頁**。說明分頁的「介面」類由 `UI_TIPS` **推導**(`Object.values`)⇒ 文字 MUST NOT 抄第二份;`index.html` 靜態標記只准寫 `data-tipkey`,文字由 `main.js syncTips()` 灌。MUST NOT 退回 `title=`(觸控無 hover)、MUST NOT 另寫第二套氣泡、MUST NOT 逐節點綁事件(重繪即失效 ⇒ 一律 document 委派);觸控一律**長按**才出提示(短按 MUST 原樣放行,否則掛了提示的選項鈕整顆失效)|
| 分段按鈕樣式 | `style.css` `.seg` > `.segb`(+ `.seg-lg`/`.seg-sm` 尺寸變體) | 2026-07-31 使用者定案「按鍵風格統一」:凡「一組互斥選項」的控件一律掛這一套(戰場選單分頁 / 說明類別 / 操作方式 / 目前操控 / 陀螺來源 / **電腦難度** / 圖鑑陣營切換)。消費端 MUST 只掛 class,MUST NOT 自寫 padding 與選取態配色;電腦難度 MUST NOT 退回 `<select>`。`.btn` 家族(準備/開戰/離開)刻意不併入 —— 那是動作不是選項 |
| NPC / 建築圖示 | `npcicon.js` `NPC_ICONS` + `npcIconHTML()` | 平塗 24×24 SVG 吃 `currentColor`(選取態/陣營色自動跟著翻);名冊真相仍是 `UNITS`/`THIRD.COMP`,缺鍵回退問號圖。MUST NOT 改成 3D 截圖資產(96px 格子只剩色塊,且吃不到 currentColor)|
| 共用視覺入口 | `spawnCastFx()`/`stepCombatFx()`/`terrain.surfaceAt()` | 戰場與展示台共用,MUST NOT 各寫一套 |

### 2.2 狀態鍵與迴圈粒度
- 英雄以 **pid(連線 id)為鍵**存於 `heroes` Map(bot 用字串 pid 如 `'b1'`);MUST NOT 改用陣列索引或 socket 物件當鍵。
- 小隊共享狀態(金錢/電力/彈藥/招式)住 `sq.ps`,經 `_bindShared()` getter 掛回每架 ent。迴圈粒度 MUST 分清:`heroes.values()` = 一隊一次;`_allBodies()` = 每架一次 —— 搞錯 = 收入三倍或增益疊三層。

### 2.3 確定性(Determinism)
- 跨客戶端場景一致靠 `mulberry32`(戰場中心為種子);隨機散布 MUST NOT 用 `Math.random()`。
- 抽樣紀律:每候選消耗**固定枚數**亂數、淘汰檢查一律排在抽樣**之後**;MUST NOT 改成「淘汰就跳過抽樣」(佈局序列跨客戶端分歧)。

### 2.4 外部服務防禦
- OSRM / Overpass / AWS 地形磚 / Esri 影像皆會限流或掛掉:每條 fetch 路徑 MUST 保留程序生成 fallback(合成貝茲兵線、程序建物),改 fetch 邏輯時 MUST NOT 移除。

### 2.5 世界尺度
- `SOLDIER_H`(真人 1.8m)是全遊戲唯一身高單位;人員/載具/建物一律用真實公稱尺寸,英雄體型只住 `heroTargetH()` 這一個縫。
- 改 `REAL_SCALE` MUST 同步 +1 `GEO_SCALE_VER` 並重跑 `node tools/bake_venue_lanes.mjs`。

---

## 3. 絕對反模式(A 編號恆定,供跨檔引用)

| # | 禁令 |
|---|---|
| A1 | 客戶端 MUST NOT 先改權威狀態;防作弊邏輯 MUST NOT 下放(= 原則 1) |
| A2 | MUST NOT 新增 npm 依賴 / build 工具 / TypeScript / 框架 |
| A3 | MUST NOT 修改 `reference/` |
| A4 | 確定性散布路徑 MUST NOT 用 `Math.random()` |
| A5 | 重武器 CD 唯一實作 = `mag:1 + reload=cd`,MUST NOT 另發明第二套 |
| A6 | 射擊 raycast 只打單位;地形走解析射線 `terrain.rayTerrain()`、建物/巨物走解析圓柱/盒(`_blockerHitT`)。MUST NOT 把 `terrain.mesh`/植被/建物 InstancedMesh 加進 raycast 目標(three 逐面線性掃 = 開火掉幀主因);MUST NOT 讓砲火穿越碰撞障礙 |
| A6b | **塗層雙面阻擋**:把上下空間隔開的實體面(地形高度場/橋面/隧道天花與**路面**/障礙頂面底面)MUST 不分方向截斷砲火 —— 往上往下同判,**透明可穿透處例外**(`punchPortalHoles` 打掉的三角形、地下道引道 `open` 段)。禁令兩條:①MUST NOT 用 `y <= heightAt(x,z)` 當彈道閘(那問「在地表以下」不是「穿過地表」:由下往上漏放、且不吃打洞 ⇒ 洞口變隱形山體),一律走 `_terrainSegT`→`_terrainHitT`;②障礙的垂直判定 MUST 是「穿越區間 ∩ 垂直帶」,MUST NOT 只驗入點高度或加掛 `dy < 0`(伺服器 `_losBlocked` 一向是區間語意 ⇒ 單向版 = 兩端分家靜默丟包)。爆點回報的離地基準 MUST 在洞內改取隧道路面(`heightAt` = 未開挖的山頂),但 `lev` **刻意只報 0/2** —— 橋面報 1 會被 `_slabSep` 判成「與橋上砲塔分屬板體兩側」= 塔對 AoE 免傷(前提:`sim._unitLev` 讓塔/主堡恆 0)。稽核 `audit_layer_block.mjs` |
| A7 | 飛彈失鎖(離開發射源射程 → 直線飛行)兩端共用;MUST NOT 無限追蹤 |
| A8 | FOV 全機種一律 68(zoom 35);MUST NOT 用 FOV 做差異化 |
| A9 | 客戶端 `wstate` 彈藥與伺服器小幅漂移 by design(miss 不回報);MUST NOT「修正」 |
| A10 | 迷霧 = 伺服器快照過濾;客戶端 MUST NOT 二次遮蔽 |
| A11 | 爆風 `_blast` 刻意不吃 LOS(繞射近似);MUST NOT「補完」 |
| A12 | `[#INC-103]` 無人機重生 `deadTick` 跨 tick 守衛 MUST NOT 移除 |
| A13 | `[#INC-105]` 中立 ents(`side:null`):`_acquireTarget`/`_acquire`/tick 主迴圈三處 MUST skip neutral,否則 `UNITS[kind]` undefined 直接炸 |
| A14 | `[#INC-106]` toon 三階 ramp 暗部 MUST NOT 低於 102;材質一律走 `toon.js mat()` |
| A15 | `[#INC-109]` 直升機 creep 刻意未接塔 SAM(以 pid 查找,heli 無 pid);MUST NOT「補完」 |
| A16 | SkinnedMesh 量尺寸 MUST `computeBoundingBox()` + 關 `frustumCulled`;`outlinify()` 跳過透明材質與 `userData.noOutline` |
| A17 | FPV 座艙掛在 camera 底下 — camera 本身 MUST `scene.add`,忘了整個座艙不見 |
| A18 | 貫穿 `heroLance` 判定 = 水平垂距 + 垂直帶,MUST NOT「修正」成 3D(伺服器無地形高程,高低差會整條落空)。半徑 MUST = `lanceR(def) + hitR(t)`、軸距量**線段上最近點**(`s` 夾制)、排序用**原始 `s`**;準星 `_resolveAim(pierce=true)` MUST NOT 停在第一個單位;line 類一發只過一次 `_gateFire`,MUST NOT 另送 `hitMissile`。稽核 `audit_lance_hit.mjs` |
| A19 | 觸控疊層開著 MUST 整層收起 `#touchLayer`(`syncBlocked()`)。`#game` 是 `position:fixed` 堆疊脈絡,body 層搖桿壓在其上 ⇒ MUST NOT 用調 z-index「修」 |
| A20 | 手機直式 MUST NOT 一律 `flex-direction:column`(桌機並排 → 直排 = 按鍵被推出摺線、操作直覺破壞);只准收窄欄寬 + 降字級,塞不下才 `flex-wrap`。直排兩陷阱:`flex:1 1 0` 的 basis 落在高度、`.center-screen` 子列寬度不拉滿(MUST 給 `width:100%`)。稽核 `audit_ui_layout.mjs` |
| A21 | 操作說明的裝置分支只住 `help.js`(`pTouch`/`labelTouch`,取字經 `helpItemP()`/`helpCatLabel()`);MUST NOT 在 `main.js` 另寫 `if (TOUCH_UI)` 字串分支;判定旗標 = `mobile.js isTouchUI()` |
| A22 | 機種絕招派發只住 `game.js _fireHoldAbility()`(長按右鍵與觸控 ZR 共用);MUST NOT 在輸入端各自比對機種。同功能只准一顆鈕(前科:陀螺儀開關) |
| A23 | `#tlLook` 空處開火出口只有 `_setLookFire()` → `_cmd('fire')`,MUST NOT 直接改 `client.firing`。MUST 先要求一次完整輕點、長按在幀迴圈判定、與 A 鈕互查 `firing` 才停火 |
| A24 | 小地圖 `_mmSeen`/`_mmBase` 座標框 MUST 恆為全圖(`_world2mmFull`),MUST NOT 跟顯示窗跑(持久資料會整片錯位);`_mmShadows()` MUST 回世界座標 |
| A25 | 一次性 3D 物件移除 MUST 釋放 GPU 資源(只 `scene.remove()` = 洩漏):彈體走物件池 `_takeProjectile`/`_dropBullet`、特效走 `_freeEffect` → `toon.js disposeTree`(唯一實作);共用幾何 MUST `markShared()` 註冊;高頻特效 MUST「單位幾何 + scale」不重配。稽核 `audit_gpu_lifecycle.mjs` |
| A26 | 程序生成零件擺位方向與旋轉方向 MUST 同調、錨點半徑 MUST 取該高度的錨體半徑(`trunkR(y)` 類單一縫)。三大病灶:差 90°(徑向 vs 切向)、差正負號(MUST 由軸的實際世界向量推,不手寫鏡射式)、拿基部半徑當通用半徑。堆疊件 MUST NOT 用 y 交錯偽裝、躺地件軸心高 = 自身半徑。改擺位 MUST 跑 `audit_object_joints.mjs` |
| A27 | 實例朝向 `ry` 與微傾斜 `tx/tz` MUST 當剛體整株套用(`xform.js vegPartXform` 單一縫),MUST NOT 併進逐零件歐拉角(Euler 'XYZ' 把 ry 夾在中間會攪亂方向);接合完成度 MUST 與 ry/tx/tz 無關 |
| A28 | 三機制兩條線 MUST NOT 斷:①`rooms.js`/`sim.js`/`bots.js` MUST NOT import Node 內建、用 `process.*`/`Buffer`/`require()`(加一行只有單機炸);②URL 佈局 MUST 鏡射儲存庫佈局(`/public/**` + `/server/*.js`)—— 否則 `data.js` 變兩份模組實例且不報錯。單機離場 MUST `hub.shutdown()`。稽核 `audit_net_modes.mjs` + `audit_solo_boot.mjs` |
| A29 | 地下道 MUST NOT 另開第二套結構 —— 沿用山體隧道整套,差異只有三個具名旗標:①剖面 = `tunFloorAt` 的 `sink`(旗標 `under`);②引道開挖 = 垂直路塹(run `cut` → `carveTunnels` 過渡帶 `hw+CUT_W`,山體隧道 MUST 維持 `hw+7`)—— 出入口只在道路頭尾兩端,側面 MUST NOT 留可通行開挖斜坡;③引道露天物理段(tunnelSegs `open:true`)只服務 surfaceAt 站立捕捉與移動側壁閘,slab 上傳/`_slabHitT` 彈道/`ceilingAt` 天花/lev 回報 MUST 濾 `!open`(漏濾 = 伺服器把露天溝當洞內 = 兩端分家靜默丟包)。側壁閘 = 單步高差 + **幾何牆線**(tunnelSegs `by` 牆頂 ← `wallTopAt` 單一縫、`makeTunnelIndex.wallCross`「由內跨出 ±hw 且牆頂高出腳下 >2.6m」即擋)—— 高度場網格會把垂直路塹攤成緩坡,單步高差在洞口內側永不觸發,MUST NOT 退回純高差判定;`by` 只住客戶端移動物理,slab 上傳 MUST NOT 帶出、山體隧道 MUST 無 `by`(恆放行)。地下道恆非明隧道(gallery `open` 歸零);引道擋土牆/緣石帶純表現層;門洞 `slope` MUST 取走廊平均而非洞口瞬時斜率。稽核 `audit_underpass.mjs` |
| A30 | 障礙的碰撞/彈道/伺服器 LOS MUST 同一橫斷面:建物**與地標**= 有向盒(`hw2/hd2/ry`),圓只准當 broad-phase 且 MUST 是外接半對角;occ 上傳時 `ry` MUST 反號(sim 座標 z 鏡射),`setWorld` 預算 cos/**−**sin(8Hz 熱路徑)。**盒面朝向 MUST 與實例矩陣同調**:`ry` 與 three `Euler(0,ry,0)` 吃同一個值 ⇒ local 軸反解一律 `sn = −sin(ry)`(寫 `+sin` = 盒子鏡射差 2·ry:看得見的牆在這裡、擋彈與掛梯的牆在另一邊)。`_mmShadows` 是具名例外(純顯示)。稽核 `audit_climb.mjs` Ⅲ/Ⅶ |
| A31 | 攀爬路線只住 `climb.js`。**設施正面 MUST 面對結構**(`attachFaces()` 單一縫):有向盒只准四個面法線 + 面中心、巨岩只准生成期實測驗過的方位(`attA`;一個都沒有就不掛)、圓柱(神木)維持 16 方位;頂端錨件 MUST 以跨接臂接回結構(`arm`;圓柱走 `r − tr`,`tr` ← `trunkR` 推導)。**攀爬柱 vs 設施幾何是兩件事**:`y0/y1` = 攀爬柱,頂端 `y1` MUST = `b.y + b.h`(= `blockerTopAt` 站立面;MUST NOT 為視覺往下修 —— `_collide` 垂直閘 `myBot >= b.y+b.h−0.1` 一低就把人從屋頂推下去);`vy0/vy1` = 設施兩端,MUST 經 `facilityEndY()` 貼齊生成期實測的實體面 `b.ty`(碰撞柱刻意高過實體:建物 +0.5、巨岩 +1.5、地標取涵蓋尖頂的 `LANDMARK_COL.h`),落差夾在 `GRAB_UP` 內;設施幾何 MUST NOT 再直接引用 `r.y0/r.y1`,提示箭頭則刻意仍吃(標的是人站在哪)。抽中機率 MUST 經 `climbShare(siteSlopeDeg())` 隨地形陡度放寬(平緩帶 = 基準、阻擋角 = 100%;「不可陡上 = 100%」由曲線推導,MUST NOT 另寫 `slopeBlocked` 分支);**相鄰相接同吃這支曲線**(基準換成 `CLIMB.LINK`)且與地面路線共用**同一份** `siteSlopeDeg` 量測,MUST NOT 為它另寫第二條 ramp。攀爬軸 MUST 在碰撞體外 `CLIMB.OFF`(推導值,> 最大機體碰撞半徑)⇒ `_collide` MUST NOT 開任何豁免;上下移動吃 `_moveAxis` 前後推杆,MUST NOT 新增按鍵(A21/A22);每候選固定 3 枚亂數、四面皆堵不掛(原則 5/6);相鄰相接沿用同一種路線型別(設施架較高者、`y0` = 低頂高),下端落地 MUST 用 `r.bx/r.bz`;箭頭動畫 MUST 併進 `biomes.js dynamics` 桶。稽核 `audit_climb.mjs` |

---

## 4. 錯誤處理與狀態管理

**失敗策略**:見原則 6(降級不例外、寧缺勿錯、驗證後靜默丟棄)。

**權威狀態流**
- 快照 8Hz;`snapshotFor(side)` 只過濾「單位」,塔/主堡/中立物恆可見;同 tick 三份快照共用一份 frame 快取(`_tickN`),events 只能清一次 — 動快照邏輯 MUST 維持此共用。
- 雙層 HP:護盾(先扣、不吃護甲、脫戰回復)→ 裝甲 hp(吃 `armorMul`)。爆擊只在直擊武器,AoE 不爆。
- 擊殺 bot 一律 `BOT_KILL_SCORE`(3)— 刷 bot 不能速成招式,MUST NOT 移除。
- `createRoom` MUST 附合法預建 `battleConfig`;環境由 `resolveEnv` 開房定案進 `cfg.env` 全房一致,MUST NOT 客戶端各自重算。

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
                     #              ⑤對進戰勝率(陣營/機種/較高方皆 ≈50%、角色不離群、接近期損失 ≤40% EHP)
                     #              ⑥招式配置 ← 武器射程剖面(扇形武器優先貼身套件)
npm run sim          # headless 加速模擬完整 bot 對局(平衡/難度壓測)
```

**測試標準流程(MUST 逐步,#INC-101/102)**:
1. `netstat -ano | grep :8620` — 檢視**全部** LISTENING(Windows SO_REUSEADDR 允許兩個 server 同時 LISTEN)。
2. `taskkill` 所有監聽者(**含 npm 父進程**),確認 0 個 LISTENING。
3. `node server/server.js` 起新伺服器 → `npm test`。**沒重啟伺服器 = 測到舊程式碼還全綠**。

**矩陣通則**(適用下表全部,不逐列重述):
- ㋐ 改任何有離線稽核的判定 → 該稽核 MUST 全綠 **且 MUST 做反向驗證**(原則 9)。
- ㋑ 稽核腳本以「執行原文」驗真品;詳細斷言看各腳本檔頭,本表只記入口與關鍵不變量。
- ㋒ 純表現層改動 ⇒ `npm run bal`/e2e 天然不受影響,但相鄰稽核仍 MUST 全綠。
- ㋓ 需外網(Overpass/OSRM)的項目沙箱跑不動 → 走 GitHub Actions / 真機;需真瀏覽器(CDN three)的冒煙待真機,MUST 在交付說明中標註未驗項。

**改了什麼 → MUST 跑什麼**

| 改動 | 驗證 |
|---|---|
| 任何平衡數值(小兵/角色武器/SQUAD.BUFF/HEROIC/塔/賞金/八軌價格) | `npm run bal` 全綠;動角色武器一併看 ⑤ 角色離群列 |
| 角色機種編制(`CHARACTERS[].kind`/`visual` 機體欄/`mods.armor` 換機種) | e2e「機體混編陣營分佈」(三陣營 7/3/2・3/7/2・2/2/4 + 32 名皆有 kind + 12/12/8 款設計 1:1)+ `npm run bal` ①(換機種 = 換 EHP 池與 `UNITS.drone.hp`/`SQUAD.ARMOR_F` 推導)+ ⑤(換機種 = 換 `CLASS_SYM` 分組;⑤a 量真正的陣營成員)+ `audit_muzzle.mjs`/`audit_cockpit.mjs`/`audit_cast_jump.mjs`(㋓ 需真瀏覽器:掛點、座艙、施法/跳躍動作全依 `visual` 重生成)|
| 出兵節奏 `GAME.WAVE_S` / 波次編制 `waveComp` / 開場預置 `_prefillLanes`・`_spawnLaneWave` | `npm run bal` ③(波數 × 波賞金 = 收入預算,±10%)+ e2e「出兵間隔固定 + 開場預置兵線」(6 項;間距 = 間隔 × 行軍速度、最前一波 ≤ 第一座砲塔、各波等距、波序為負)+ e2e「開局兵線」隻數(期望值 MUST 由同一份規則推出,不可手寫) |
| 陣營小兵強化(`CREEP_UPG`/`creepUpgMul`/`_creepMul`/`_bounty`/`buy(…,'creep',lane)`) | e2e「陣營小兵強化」(11 項;曲線 1+log10(1+LV)、八軌未滿不解鎖、非法兵線被拒、共用/分兵線、hp・armor・賞金同吃 `e.cu`、快照帶等級)+ `npm run bal` 四不變式 MUST 不動(bal 模型是**未強化**的基準波次)+ 真機冒煙(八軌買滿商店才出現該區塊、隊友出資同陣營都看得到播報) |
| 角色大小招 `fx`/`add`(招式家族配置) | bal ⑥:雙扇形 MUST 兩招貼身、單扇形 ≥1、密度 ≥ 非扇形 ×2;s07/m07 具名豁免 MUST NOT 為湊標換掉 |
| 對進戰模型(`duel.mjs`)/`ALTITUDE.*`/`FAN_*`/`CLASS_SYM.K` | bal ⑤:陣營與機種 50±5pp、**較高方 50±3pp**、非豁免角色 ∈ 20~80%、接近期損失 ≤40%。改 `K` 一併看 ①(校準值 0.5) |
| `SPECIAL`/`SPECIAL.DECOY_IMPACT`/`KAMI.N`/`DECOY.BOMB_MAX`/`hyperBlast`(絕招預算) | e2e「機種絕招三招同預算」(飽和攻擊/集束炸彈/主機自毀/極音速飛彈四者 ≤2%)+ bal 四不變式 MUST 不動(bal 刻意不含三招 burst) |
| 三招機種絕招改制(`SQUAD.KAMI.N`・`kamiSide`・`HYPER`/`hyper*()`・`DECOY.BOMB_*`/`DROP_N`・`sim.heroHyper`/`_tickHypers`/`_hyperBoom`/`_hyperShotDown`/`_decoyBombTarget`/`_decoyBomb`・`game._launchHyper`/`_spawnDecoyBomb`/`_tryFire`) | `audit_flight_power.mjs` Ⅰ・Ⅱ(HP 三式推導不手寫、`kamiSide` 兩端同吃、巨砲旁路整組退場、`_tryFire` 三道閘門無條件生效)+ e2e「極音速飛彈」段(機種閘門、射後不理不需狙擊/不吃彈夾、爬升→俯衝兩相位、落點爆風、被擊落不引爆)+ e2e「集束炸彈」段(HP/彈數推導、逐顆個別瞄準、事件帶投擲點、墜毀補投)+ e2e「飽和攻擊」段(4 架、`kamiHp` 推導、左右對半散開、每架殺不死步槍兵兩架才行)+ e2e「載具 HP 一律由一座砲塔反解」段 + 真機冒煙(飛彈爬升後螺旋落下且看得見/打得下來、集束炸彈拋物線分別落在不同敵人頭上、4 架護衛機左右各兩架散開) |
| 絕招載具 HP 校準(`towerDps`/`towerSurviveHp`/`towerKillHp`/`kamiHp`/`hyperHp`/`decoyHp` 或 `UNITS.tower.dmg・rate・range`) | `audit_flight_power.mjs` Ⅰ(改砲塔數值三個 HP MUST 自動跟著漂;任一個手寫即紅字)+ e2e「載具 HP」段 —— **改砲塔任一數值 MUST 重跑兩者**(三招的「剛好」全掛在塔的 DPS/射程上) |
| 飛行動力學(`FLIGHT`/`airSinkM`/`liftMax`/`liftRegen`/`liftDrainPS`・`game._stepLift`/`_airSinkHit`/飛行段消化/`#liftBox`・`sim._botAirSink`) | `audit_flight_power.mjs` Ⅲ~Ⅵ(65 項;校準錨 = 打完平均護盾+裝甲掉 2 個砲塔高、掉幅是位移不隨幀率/分幾發變、5 秒耗盡且耗速 ∝ 爬升率、見底只鎖垂直、回充 ∝ 電力回速 × 充能軌、清帳點齊全)+ e2e「bot 飛行機體受擊掉高」(4 項)+ `npm run bal` 不動(bal 不模型化飛行高度)+ 真機冒煙(被集火時高度一路被壓下來、動力條見底爬不上去但仍可平飛/下降、地面機甲看不到動力條) |
| `BOT_DIFF`/`BOT_OPS`/`bots.js _op()` | e2e「電腦難度操作節奏」+ `npm run sim` + 沙包輸出 MUST 隨難度單調遞增 |
| `ECON.UPG_*`(八軌階梯單價) | bal ③(±10%)+ e2e「八軌升級第三階單價」 |
| `aoeClass`/`trajClass`/`LANCE`/`ARMING` | 32 角分類覆蓋(重武器全歸類、輕武器不歸類)+ `heroLance` 衰減直測(首發全額、之後 `DECAY^i`)+ bal 不動 |
| 直線貫穿命中判定(`_lanceHits`/`lanceR`/`hitR` 系) | `audit_lance_hit.mjs`(27 項;塔身側面命中、近側表面命中、傾洩加粗生效於伺服器) |
| `BALLISTIC.LOB_*`/`AA_MV`/`_lobAim`/`_lobLadder`/`_arcTrace` | `audit_weapon_gate.mjs` Ⅳ・Ⅴ(階梯與積分只有一份、`_lobAim` 與 `_reachable` 同吃)+ 真機冒煙:`bullet.vel` = `_lobFc.vel`、爆點 = 瞄準高、弧高隨距離變、稜線擋道 `ok:false` 不送 lock |
| 射程閘門容差 / 爆風量體 / 射程光暈可命中判定(`RANGE_TOL`・`altRangeMax`・`BLAST`/`blastCoreR`・`REACH_RULE`/`reachRule`・`sim._blast` 水平量體・`heroBurst` 落點閘門・`game._reachable`/`_updateRangeGlows`) | `audit_weapon_gate.mjs`(六段;Ⅰ 容差/超壓帶單一縫且推導不手寫、Ⅱ 兩端閘門同界 + 真 `BattleSim` 直測「range×1.20 落點不再被丟棄 / 超界仍丟棄」、Ⅲ `_blast` 量到近側表面(主堡牆面全額、EDGE 外歸零、人員級位移 <15%)、Ⅳ 五類彈道全覆蓋 + 消費端單一縫 + 積分唯一、Ⅴ `_reachable` 逐彈道行為直測、Ⅵ 見下列)+ `npm run bal` 不動(四不變式不模型化爆風幾何)+ 真機冒煙(榴彈對著稜線後方的敵人不亮光暈、繞到側面亮、貼臉導引彈轉琥珀、直擊武器隔牆不亮) |
| 導引 / 射後不理(`shotV0`・`flightCapS`・`SEEK`/`seekTurn`・`sim.heroAim` 的 `aimOffAt`/`heroBurst` 需瞄準閘門/`_gateFire(…, back)`・`game._aimTarget`/`_tickLock`/`_tryFire` 的 homing・`_updateBullets` 近炸引信與 `b.seek` 射程包絡) | `audit_weapon_gate.mjs` Ⅵ(①初速單一縫 ②`flightCapS` 推導 + 真 `BattleSim` 直測「飛行途中收鏡仍結算 / 超過最長飛行時間仍丟棄 / 裝填後打更近的目標不再被丟棄」 ③追蹤目標 MUST NOT 只認 `_lockId` ④引信量線段最近點且半徑 = 核心帶 + 命中量體 ⑤`seekTurn` 只放寬不收緊 ⑥鏡射彈道積分:8 把武器 × 5 段距離導引狀態全數落在核心帶內、無導引一律落空)+ `npm run bal` 不動(伺服器不模擬彈道)+ 真機冒煙(準星壓著敵人立刻開火,飛彈會追過去;開完砲右鍵收鏡照樣算傷害;連打整個彈夾後裝填完打近距目標仍生效) |
| `hitH`/`TARGET_H`/`HERO_SIZE`(命中量體) | headless `_blast` 直測(垂直帶內同額、EDGE·r 外歸零、塔頂 = 塔底);動 `hitR`/`TARGET_R` 一併跑 `audit_lance_hit.mjs` + `audit_weapon_gate.mjs` Ⅲ(同組值 = COLLIDER 碰撞半徑 + 爆風水平量體) |
| `AIR`/`envTrigger`/`TERRAIN_FX`(騰空/地形異常) | headless 直測(小跳仍踩雷、蓄力跳不踩;無人機 y=10 仍灼傷;騰空 wet 立停)+ 真機水域冒煙 |
| 地形坡度移動(`SLOPE`/`slopeDeg`/`slopeMoveF`/`slopeBlocked`・`_slopeDegAlong`/`_slopeMoveF`/`_updatePlayer` 移動段與 passable 閘)/ `MAPGEO.MAX_ROAD_GRADE_DEG` | `audit_slope_move.mjs`(66 項;Ⅰ 常數推導不手寫、Ⅱ 曲線平緩帶恆 1 → 上坡遞減/下坡遞增且夾制、**下坡一律不擋**、Ⅲ 合格兵線在遊戲空間 ≈8.2° < 平緩帶 ⇒ 推線走廊恆全速、Ⅳ 消費端單一縫、Ⅴ 合成高度場行為直測含橋面/隧道/騰空豁免 + 洞內 tunnelAt 捕捉豁免)+ 真機冒煙(爬陡坡明顯變慢、峭壁上不去但可沿等高線橫走、下坡加速、上橋引道與洞口不被誤擋) |
| 異常狀態致盲白幕(`CC_FLASH`/`ccFlashAlpha`/`_ccFeed`・`_blindFlash`・`_updateCcFlash`/`.cc-flash`)/ 蓄力跳水平移速(`CJUMP.AIR_SPD_F`/`_chargeJump`/騰空移動段) | `audit_cc_flash.mjs`(44 項;Ⅰ 曲線全白→漸淡→歸零、Ⅱ 強度表只收光學系、Ⅲ 觸發/衰減/清除各一處且都接上、Ⅳ 行為直測「當下更亮者勝」、Ⅴ 水平倍率兩端同吃且垂直不吃)+ 真機冒煙(被雷爆彈/EMP 招式命中畫面全白後漸淡、HUD 仍讀得到;蓄力跳同蓄力比例跳得更遠但高度不變) |
| 射程/傷害/`sight`/`RANGE_SIGHT_F` | e2e 重驗:輕武器 NPC range ≥170(#INC-104)、t01/s02 crit:0、s02 heavy = launcher、「塔 310 > 所有輕武器」與「所有重武器 > 塔 310」雙不等式 |
| 骨架/關節/步態 | 全角色 rig 稽核 + `audit_cast_jump.mjs` |
| FPV 座艙取景(`COCKPIT`/`ndcH()`/`_buildCockpit` 系) | `audit_cockpit.mjs`(視野帶淨空、裝置 < 武器、消失點對準星;頂緣逐頂點投影量測) |
| 武裝掛點/槍口 | `audit_muzzle.mjs`(32 英雄 + NPC 四陣營) |
| `MAP_EXPAND`/`CLEAR_F`/`LANE_MIN`/塔位 | headless 建 `BattleSim` 數 `sim.camps.length`(L1 2/2、L2 4/4、L3 6/6) |
| `VENUES[].ll` / `MAPGEO` 尺寸常數 | `node tools/bake_venue_lanes.mjs` 重烤 `venueLanes.js`(外網,㋓) |
| 場地場景標記(`VENUES[].scen` 系) | `audit_lane_scenarios.mjs`:標記 MUST 由實測產生(多標/漏標皆紅);㋓ 走 Actions「兵線場景掃描」,`ci.yml` 刻意不含 |
| `venueLanes.js` 重烤 / `TOWER_*` / `tower.range` | `audit_map_rules.mjs`(#4)+ `audit_lane_sep.mjs` + `audit_lane_grade_sep.mjs`(#5 洞內塔 ≥20% 射程涵蓋洞口外) |
| 兵線導航規則(`UTURN_MAX_DEG`・`TURN_ACCUM_MAX_DEG`/三 audit/bake 閘門) | `audit_lane_navigation.mjs`(35 項);規則①③生效於既有場地需重烤(㋓) |
| 地下道(`underpassPlan`/`tunFloorAt`/`UND.*`/引道 `cut`・`open` 系)/ 結構資格閘(`strucTunnel`) | `audit_underpass.mjs`(138 項;**山體隧道 MUST 逐位元不變**、引道回地表、縱坡 ≤ GRADE_MAX、四放棄條件、引道垂直路塹 + open 段消費端閘門、Ⅵ 資格閘:人行/室內 tunnel 不成洞且去重候選同閘、Ⅶ 幾何側壁:覆蓋段/圍裙/深路塹跨出必擋・道路兩端與淺端放行・山體無 by 不變、Ⅱ-d 明隧道誤判雙防線:碗緣高於路面/碗緣是自家開挖 ⇒ 連 under=false 都不判,天然峽谷才是對照組) |
| 明隧道(`tunnelWallProfile`/`TUN.*`(含 `OUT_W` 落差掃描)/`terrain.natureAt` 天然地形快照/`gal` 遮罩上傳/`galBores` 洞內打洞/明隧道淨空/sim `tunnelSideExit`・`_slabSep` 隧道分支/落石棚強制覆蓋・同 tag 併鏈/`carveGalleryBands` 柱外淨空帶/`carveTunnels` 敞開段殘峰) | `audit_open_tunnel.mjs`(159 項;**深埋隧道 MUST 逐點同舊制且 gal=0 伺服器逐位元不變**、幾何 `hw`/segs 不動、柱列不進 `cols`、⑪ 近帶岩背不判開放、④-b/⑫ 覆蓋薄但兩側都在地形內 ⇒ 貫穿隧道不判明隧道(金龍實案)、⑬ 對開挖單調穩定、⑭ 落差掃描只認天然地形、Ⅴ 三個呼叫端全餵 `natureAt`、Ⅱ 明隧道段發 bore 蓋滿/深埋不發、Ⅲ-b 淨空三消費端 + punch 單次呼叫、Ⅲ-c 走廊地物淨空 ≥ 最寬開挖足跡且推導不手寫、Ⅲ-d 神木腳印整盤驗淨空(只問中心格 = 巨幹橫插洞內)、Ⅲ-e 貼地道路緞帶/標線不得畫進別條路的洞內斷面(走廊清單帶頂板高 cy,三消費端全掛 + inTunBore 行為直測)、Ⅳ 以真 BattleSim 直測兩端可穿透與 z 鏡射側別、Ⅴ 執行 terrain 原文直測:敞開段殘峰無條件開挖/覆蓋端斜壁帶保護/柱外淨空帶只降不升・端帽不外溢 + avalanche_protector 強制覆蓋/同 tag 併鏈靜態規則、Ⅵ 執行 `punchPortalHoles` 原文:斷面裡的三角形全刪**含跨越走廊但無頂點在內**那一片、走廊外/路面下/天花上三條界不得放寬、洞緣進 rims)+ `audit_underpass.mjs`(山體/地下道不變式)+ `audit_slope_move.mjs`(洞內豁免坡度閘)+ `tools/shot_tunnels.mjs`(㋓ 需 playwright:三結構 × 兩端出入口/洞體中間多視角出圖 + 斷面殘留・洞口見天・由上而下看穿三項掃描) |
| 道路路基整平(`gradeRoadBeds`/`carvedNodes` 足跡/biomes 呼叫端收集) | `audit_road_bed.mjs`(16 項;Ⅰ 橫坡切填帶內壓平帶外不動、Ⅱ 填方上限漸退不築壩、Ⅲ 水域紀律、Ⅳ 開挖足跡優先、Ⅴ 確定性逐位元、Ⅵ 呼叫端橋/步道/結構/泡水段不整 + 排在 markGradeCorridors 前)+ `audit_slope_move.mjs` + `audit_underpass.mjs`/`audit_open_tunnel.mjs` 不變式 + 真機冒煙(陡橫坡路段路面貼地可踩、峽谷邊不長土壩) |
| `SOLDIER_H`/`HERO_SIZE.mul`/`BRIDGE_RISE`/`TUN.CLEAR` | 重驗「淨空 > 最大機體 4.5m + 0.2 頭頂餘裕」 |
| 塔或機甲任一數值 | 重算 `towerHp = 1.8 × heroEHP × heroDPS / towerDPS` |
| 攀爬路線(`climb.js` 系;含 `attachFaces`/`attA`/錨件跨接臂/`facilityEndY`/`climbShare`/`siteSlopeDeg`、生成端 `b.ty`/`b.tr`) | `audit_climb.mjs` Ⅰ・Ⅱ・Ⅳ・Ⅴ・Ⅵ・**Ⅶ**・**Ⅷ**・**Ⅸ**(194 項;Ⅶ = 正面規則 + 視覺/碰撞盒朝向同調 + 跨接臂;Ⅷ = 設施端點貼齊實體面 —— 攀爬柱 `y1` 逐位元不動、`vy1` 收到實測屋頂、落差夾在 `GRAB_UP`、四種結構生成端都餵實測值;Ⅸ = 抽中機率 ← 陡度,曲線轉折點與 `slopeMoveF` 同源、`slopeBlocked` 逐度反查恆 100%、地面路線與相鄰相接同曲線同量測、量測不消耗亂數)+ 真機冒煙(掛梯/推杆/登頂開火/跳離/箭頭辨識/相鄰相接;**長梯/抓點頂端貼著屋頂不再突出、陡坡山城的建築幾乎棟棟有梯、平地街廓仍約三成**) |
| 障礙橫斷面(`_blockerHitT`/occ 上傳/`_losBlocked`) | `audit_climb.mjs` Ⅲ:兩端對同一盒同線段 MUST 同判(含 ry 反號、細長樓側面、圓柱不變、上下方向對稱) |
| 塗層阻擋(`_slabHitT`/`_terrainSegT`/`_layerHitT`/`_blockerHitT` 垂直帶/爆點基準) | `audit_layer_block.mjs`(36 項;Ⅰ 天花與**路面**雙面 + open 放行 + 橋面同側不誤擋、Ⅱ 盒頂/盒底不分方向、Ⅲ MUST NOT 退回單面 `heightAt`、Ⅳ 洞內爆點基準取路面且 lev 只報 0/2) |
| 橋交會去重(`dedupeCrossingBridges` 系) | `audit_bridge_crossing.mjs`(16 項;優先度 兵線 > 鐵路 > 大馬路 > 小馬路;鐵路容差 `gap=0` 只認真交叉) |
| 馬路橫切繞行(`skirtWaterClips` 系) | `audit_water_skirt.mjs`(8 項;斜交對稱穿越 MUST 建橋不繞;步道一律不進橋樑管線 `PED_HW`) |
| 道路塗裝寬/標線/結構接合(`carriageHw`・`flareHw`/`ROAD_FLARE_M`・`markBaseAt`・`mHw`/避車道 `avoidHw`・橋隧柏油定調) | `audit_road_joint.mjs`(74 項;Ⅰ 塗裝寬 === 一般路通行寬且推導不手寫、Ⅱ 漸縮曲線兩端貼合 + 切線歸零 + 單調、Ⅲ 標線消費端單一縫 + 橋隧同款柏油與標線 + 路燈/行道樹仍排除、Ⅳ 漸縮帶行為直測:半寬 hw→車道寬、起點高逐位元貼結構路面、三角形全朝 +Y、四條跳過條件、Ⅴ 通行寬仍只有 `strucHw`,塗裝縫不得滲進走廊/開挖/物理段;Ⅳ 另含**邊帶同步漸縮**:邊帶外緣與楔形同一條 `fhw`、外端收到零、車道緣不漂、差額 < `AVOID_MIN` 時與楔形同進退)+ `audit_underpass.mjs`/`audit_open_tunnel.mjs` 不變式 MUST 不動 + 真機冒煙(進出洞口/上下橋標線與路緣線連續、橋面不再是泥土/水色、接合處無橫向階) |
| 橋上砲塔墩座(`planTowerBridgePads` 系) | `audit_bridge_tower_pad.mjs`(23 項;沿橋軸與水側走位帶 ≥ 基座 + 8m;`TOWER_BASE_R` 不變) |
| 地形射線(`rayTerrain`/`punchPortalHoles` 系) | `audit_terrain_ray.mjs`(11 項;與暴力掃逐條一致;加速比 MUST 兩位數) |
| 都市規劃朝向(`ground.js` orient/`gridA`) | `audit_ground_qc.mjs` ⑦(垂直街道網 mod 90° 摺疊不抵銷;orient 固定抽 2 枚 rnd) |
| 地貌交界(`planSeamOverlays`/`SEAM_STYLES`/`seamAlpha`) | `audit_ground_seam.mjs`(49 項)+ `audit_ground_qc.mjs` 全綠 |
| 小區域組合風格(`planEnclaves`/`ENCLAVE_STYLES`) | `audit_ground_enclave.mjs`(33 項;消費端 MUST NOT 硬編第二份組合表) |
| 表現層資源生命週期(池/`markShared`/`disposeTree` 系)/ 自適應解析度(`RES_GOV` 系) | `audit_gpu_lifecycle.mjs`(42 項)+ 真機 60s 開火 heap 不單調上升 + 目視光束粗細(scale 就是半徑) |
| 三種遊戲機制(`rooms.js`/`netmode.js`/`build_solo` 系) | `audit_net_modes.mjs` + `audit_solo_boot.mjs`(`data.js` 單一模組實例)+ `npm test` 單機段與 WS 全段 + `audit_ui_layout.mjs` |
| 程序生成物件擺位(`BUILDERS`/`VEG_DEFS`/`vegPartXform`/`MEGALITHS`/`synthMegalith`/`decorateMegalith`/`rockProbe`) | `audit_object_joints.mjs`(`--seeds 8` 約 23000 接合;FLOAT/PARTIAL/DETACHED/ISOLATED 四硬失敗;豁免附理由;巨岩段含「兩端支承」具名救援) |
| 小地圖顯示範圍(`mmMode`/`_world2mm*` 系) | `audit_minimap_view.mjs`(16 項)+ 真機切換冒煙(已探索迷霧不得錯位) |
| 視野鎖定(`VIEW_LOCK`/`viewLockStep`・`game._tickViewLock`/`_coneAcquire`/`_entAimPoint`・觸控 ZR `data-act="lock"`・絕招改掛十字鍵左) | `audit_view_lock.mjs`(44 項;Ⅰ 常數推導不手寫 + DROP > CONE 遲滯、Ⅱ **後座力不得被抵銷** + `_tickViewLock` 排在相機合成前、Ⅲ `viewLockStep` 直測不瞬移/不過衝/幀率無關、Ⅳ 鍵位與單一縫 + `_cmd` 的 lock 排在 dead 閘之前)+ `audit_touch_layout.mjs`(ZR 列位改認 lock、絕招與鎖定各恰好一顆、絕招鈕面仍帶 .gb-cd)+ `audit_ui_layout.mjs` + 真機冒煙(按住 ZR 視野貼上最近敵人且鈕面亮起、開火照樣上踢且回穩後自己貼回、放開立刻恢復自由視角、十字鍵左絕招顯 CD) |
| 機種絕招觸發(`ABILITY_HOLD_S`/`_tickHoldAbility` 系) | 真機冒煙:一般/狙擊長按皆出招且不誤切模式、短按仍切換、十字鍵左同招顯 CD、三機種各一次 |
| 操作方式(`ctrlmode.js` 系 / `renderCtrlModeRow`・`renderCtrlSettings`・`syncCtrlSettings` / `main.renderRoomCtrl`・`onSync` 的 `setRoomCtrlMode` / `rooms.js` 的 `config.ctrl` / `game._applyCtrlScheme` / `main.TOUCH_UI`)或 觀戰戰場選單(`game._setPaused` 的 side 閘、觀戰指標鎖定、`mobile.setKind` 的 HOME) | `audit_ctrl_mode.mjs`(77 項;Ⅰ 裝置判定單一縫 + ctrlmode 無 import、Ⅱ 真品直測「預設不限定 / 不限定吃裝置判定 / **戰區定案蓋過我的預設** / **離開戰區退回預設** / 限定時目前操控不可變更 / 非法定案視同沒有 / 裝置衝突警告 / 舊鍵與 `?ctrl=` 遷移」、Ⅲ 選項 DOM 只有一份 + 大廳區塊已移除 + 上行/套用各只有一處 + `TOUCH_UI` 是函式、Ⅳ 搖桿層建毀單一縫 + dispose 解訂閱、Ⅴ 觀戰 ESC/HOME 兩條路、Ⅵ 伺服器端原文:合法值取自 ctrlmode、房主閘門、列表帶出)+ `npm test`「操作方式由房主選擇」段(5 項行為直測:開房預設 / 房主改廣播全房 / **非房主改不動** / 非法值靜默忽略 / 戰區列表帶出;**MUST 先重啟伺服器**,見 §5)+ `audit_touch_layout.mjs`(觀戰版型:HOME 留著、其餘戰鬥鈕收起)+ `audit_ui_layout.mjs` + 真機冒煙(房主在戰區畫面選限定搖桿 → 全房桌機也長出搖桿、隊友那格是唯讀灰;不限定 → 戰鬥中設定頁即時切換鍵鼠 ⇄ 搖桿、說明文字跟著換;觀戰按 ESC 叫得出選單並離開)|
| GUI 懸浮提示(`tip.js`・`help.js UI_TIPS`/`uiTip`・`main.syncTips`・`data-tipkey` 標記)/ 按鍵風格(`.seg`/`.segb`・`renderBotDiff`・`renderCtrlModeRow` 的 `bare`)/ 房間設定分頁(`#roomCfg`/`roomCfgTabs`)/ NPC 圖示(`npcicon.js`) | `audit_ui_layout.mjs` 0.5 段(44 項;常駐說明已下架 + 靜態標記只寫 key + 「介面」類由 UI_TIPS 推導 + 分段按鈕只有一套 + 圖示覆蓋現役名冊;**不需 playwright,沙箱也跑得到**)+ `audit_ctrl_mode.mjs`(Ⅲ 新增 6 項:`.tset-seg*` 已改名、`.pause-tab`/`.help-cat`/`.unit-side-btn`/`.diff-select` MUST NOT 各寫一份鈕面樣式、三處都掛上 `.segb`)+ `audit_touch_layout.mjs` + `npm test`(㋒ 純表現層,MUST 仍全綠)+ 真機冒煙(ⓘ 滑鼠移上即顯示、觸控長按才顯示且短按仍選得動、切鍵鼠 ⇄ 搖桿提示文字跟著換、說明分頁「介面」類與 ⓘ 內容一字不差、戰區兩顆分頁鈕互切且非房主整排變灰、NPC 圖鑑每格都有圖示且選取態圖示翻深色)|
| `mobile.js`/`_applyLook`/`_moveAxis`/`_cmd`/觸控 CSS | ①桌機 MUST 不回歸 ②`audit_touch_layout.mjs`(54 組;四分區零重疊、觸控目標 ≥44×40、`.tl-sys` 固定 grid)③疊層可點性 ④`audit_touch_gesture.mjs`(17 項)⑤真機冒煙 |
| `#touchLayer` 節點位置 / `--tl-*` CSS 變數 | 搖桿 MUST 留 body 層 + 保留 `body.touch-ui` 保險預設值;真機大廳端對端量測(不設覆寫) |
| 選單版型 / 任何鈕面文字 | `audit_ui_layout.mjs`(309 項;鈕面無括號補述、桌機並排直式維持並排、`.cd-art` 解除 sticky、疊層 ✕ 規則) |
| 陀螺儀(`Gyro`/`gyroSrc`/`LOOK.GYRO_*`) | `audit_gyro.mjs`(18 項;兩感測路徑、俯仰同號、自動切換)+ **MUST 用 https/localhost 真機測**(非 secure context 靜默無感測事件) |

**e2e 結構備忘**:前段 import `BattleSim` 直測(測試假人無 `lane`,tick 前 MUST 刪掉);迷霧下偵察 MUST 另開 `mode:'spectator'` client。瀏覽器冒煙借 mapping_elf 的 Playwright,`window.__SVS` 存取 app 狀態。
