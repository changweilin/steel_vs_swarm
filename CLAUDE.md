# 無人戰略:鋼鐵與蜂群 (Steel vs. Swarm) — 全域儲存庫準則

> **本檔定位**:雙層情境系統的**全域層**(長期不變標準)。活躍模組層見 [`public/js/.claude.md`](public/js/.claude.md);真機冒煙清單見 [`docs/smoke_tests.md`](docs/smoke_tests.md);歷史細節見 `CLAUDE-orig0718.md`(2026-07-18 前逐日檔案庫)與 git 歷史。精煉基準日 **2026-08-10**。
> 關鍵詞 **MUST / MUST NOT / SHOULD** 依 RFC-2119 解讀。違反 MUST NOT 條目 = 架構違規,直接退回。
> **細節住哪裡**:本檔只記「原則、禁令、單一縫在哪、改什麼 → 驗什麼」。逐項斷言、幾何公式、邊界案例、**壞掉時的症狀敘事**一律住各 `tools/audit_*.mjs` 的**檔頭註解**與斷言本身;使用者定案的原句與當時的實測數字住 git 歷史。查細節先開稽核腳本,MUST NOT 憑記憶重建、也 MUST NOT 把那些敘事搬回本檔(2026-08-10 精煉的唯一理由就是它們被搬回來過)。

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
| `public/js/*.js` | 渲染/FPV/輸入/HUD(檔案地圖見 `public/js/.claude.md`) |
| `tools/` | 離線工具:平衡驗證、兵線烘烤、稽核腳本、單機版打包、LOGO/資產管線 |
| `.github/workflows/` | 回歸驗證 CI + 單機特化版部署 GitHub Pages |
| `test/e2e.mjs` | 前段 `BattleSim` 確定性單元測試 + 後段 WebSocket 端對端 |
| `reference/` | 上游唯讀副本 — **MUST NOT** 修改,只准參考 |

---

## 2. 通用標準與慣例

### 2.1 單一真相縫索引

每列 = 一個縫。**共通鐵律(不逐列重述)**:消費端 MUST 全部走這個縫、MUST NOT 另寫第二份實作或在別處二次運算、**推導值 MUST NOT 手寫**、純表現層 MUST NOT 動權威幾何。「稽核」欄 = 該縫的細節與症狀敘事所在(檔頭),改它先開那支。

#### A. 平衡與角色

| 領域 | 唯一縫 | 鐵律 / 稽核 |
|---|---|---|
| 平衡數值 | `data.js` | 射程/傷害/經濟/波次/角色/招式全在此;sim/game MUST NOT 硬編碼;敘事文字去 `lore.js` |
| 角色機種 | `CHARACTERS[ch].kind` + `charKind()`/`heroKindOf()` | **陣營 ≠ 機種**,32 名角色顯式標註 `kind`,MUST NOT 由 `side` 推。編制 蜂群 7/3/2・鋼鐵 3/7/2・傭兵 2/2/4;機體設計 12+12+8 款**每款恰一名角色**。換陣營時 `models.js MOVE_SIG`/`CAST_SIG`、`mecha.js` 那一整格、lore `bond` MUST 整組跟著搬;武器/招式/塗裝綁角色不動 |
| 推導值 | 各推導式 | 賞金表、`UNITS.drone.hp`/`SQUAD.DMG`、`UNITS.bunker.hp`、`solveTowerSites()`、`MINES.PER_LANE`/`AA_SITE.range`、`TOWER_SEP_F`、`FAN_MUZZLE` —— 一律 MUST NOT 手寫 |
| 英雄武器/招式解析 | `heroWeapon()`/`heroAbility()` | HEROIC ×1.2/×1.5、SQUAD 折算、rangeCap 全在這;MUST NOT 二次乘算 |
| 傷害衰減 | `dmgFalloff`/`blastFalloff`/`fanFalloff` | sim 結算與客戶端 HUD 共用 |
| 陣營對抗對稱化 | `CLASS_SYM` 推導區塊 | 校正係數整組等比套回;MUST NOT 逐武器手改 `vs` 湊平衡(個別角色改 `dmg` 階梯) |
| 目標類別剋制 / 建築加乘 | `TARGET_CLASS` + `vsMult()` + `BUILDING_VS_CAP` 夾制段 | 建築加乘**一律移除**(`vs.building ≤ 1`);夾制是 CHARACTERS 之後的一段推導迴圈,名冊 MUST 涵蓋所有帶 `vs` 的 def。`_heroDmg()` 恆無情境倍率。稽核 `audit_shield_counter` Ⅰ |
| 護盾/裝甲分軌剋制 | `shieldSplit()`(結算)+ `shieldRoleName()` + 武器欄 `vsSp`/`vsHp`/`spPierce` | 四個消費端(sim `_damage`、客戶端 `_hitFeedback`/`_lanceFeedback`、`duel.apply`、`balance.slotDps`)MUST 全吃。溢出按**預算**折回;`vsSp = 0` 退化成「護盾全擋」;`vsHp` 對無護盾目標一樣生效;旋鈕刻意不過 `tierVal`。中性參數逐位元還原舊制。稽核 `audit_shield_counter` |
| 護盾軸配置紀律 | `EX_SIEGE_WEAPONS` + `VS_DEFS` 夾制段 + `COUNTER_BUDGET`/`counterLoad()`/`counterDmgF()` | ①穿盾/反裝甲只准掛在名冊內(原吃建築加成的攻城重武器);②反護盾武器 `vs` 全欄夾 ≤1,夾制 MUST 排在 `CLASS_SYM` **之後**且共用同一份 `VS_DEFS`;③加成越廣泛 ⇒ 基礎傷害越低(`BROAD ≫ NARROW`)。稽核 `audit_shield_counter` Ⅴ |
| 對建築 DPS 收斂 | `BUILD_DPS` + `buildDps()` + 收斂迴圈;唯一寫入點 = `vs.building` | 旋鈕是 `vs.building` 不是 dmg 階梯;**逐槽位**幾何中點為軸;收斂 MUST 是重分配(水位量在 bal ④ 的**算術**平均上),MUST 排在 `COMBAT_SCALE` 之後;不改 `counterDmgF`。K=0 逐位元回舊制。稽核 `audit_shield_counter` Ⅵ |
| 三軸預算(範圍/機動/射程) | `AOE_BUDGET`+`aoeTrimF()` / `MOB_BUDGET`+`mobMid()`+`mobDmgF()` / `RANGE_BUDGET`+`rangeMid()`+`rngDmgF()`;套用點只有 `heroWeapon` 的 `dmg` 一欄 | 每一軸都要有價格,一律以同儕**幾何中點**為軸(重分配不通膨);射程中點 MUST 逐槽位取;解析後射程只有 `heroRange()`。**招式刻意不吃**。K 有實測上界(`MOB_BUDGET.K` 0.10 / `RANGE_BUDGET.K` 0.15 是「bal ①④⑤⑦ 同時全綠」的最大值)。稽核 `audit_aoe_trim` Ⅳ |
| 攻擊範圍收斂 | `AREA_WEAPONS`(**現為空的具名縫**)+ `towerPairSepM()`/`soloBlastRmax()`/`blastFootprintR()` + `BLAST_BAND`/`blastFamily()`/`blastCapR()` + 夾制迴圈 + `areaValue()`/`aoeTrimRaw()`/`aoeTrimF()` | 爆炸型一發 MUST NOT 傷到同塔位兩座塔(上界 ← `GAME.TOWER_SIDE_OFF`/`TARGET_R.tower`/`BLAST.EDGE` 推導,量到**命中量體表面**;量到中心會少算一個塔半徑 = 夾不夠緊);只有 blast 進夾制(fan/line 依機制豁免)。三族(榴彈 / guide+fnf 同族)全擠進 `soloBlastRmax()` 之下,導引取 `GUIDED_F` 倍且**每一階**恆小於榴彈;夾制 = 把授權階梯**仿射映射**進家族帶 `[cap×LO, cap]`(定義域取整族授權跨距,不逐把伸展)。榴彈類射程 = 全體重武器最短那一帶。收掉的範圍還回火力,但 MUST 除以 `AOE_BUDGET.NORM`(重分配)。**改 r / 名冊 / 上界 MUST 重掃 `SEEK.R_M`**。稽核 `audit_aoe_trim` |
| 射速壓縮 / 連發演出 | `RATE_DEF`+`FIRE_RATE`+`rateComp()`+`compressWeapon()`+`fireBurstN()`/`fireBurstGap()`;客戶端 `_queueBurst()`/`_tickBurstFx()`/`_burstEchoSelf()`/`_burstEchoOther()` | 是**推導迴圈**不是改數值;原始射速只留 `rate0`(連發演出與 `recoilTier` 分級的唯一依據)。曲線嚴格遞增 = 排名不變的保證;錨點 = `RATE_DEF`(MUST NOT 下修)。**「DPS 不變」靠 rate ×f、dmg ÷f、mag ×f 三欄一起動**。連發是純表現層(A36)。稽核 `audit_fire_rate` |
| 機體移速壓縮 | `SPEED_COMP`+`speedMid()`+`spdComp()`+`heroMobility()`+`evasionMinSpeed()` | 形狀同 `FIRE_RATE` 但**軸取幾何中點**(沒有補償欄 ⇒ 錨帶底 = 全體變慢);取樣面含變形者飛行型態。**唯一取速處 = `heroMobility`**(消費端 MUST NOT 讀 `UNITS[kind].speed × mods.speed`);閃避門檻(`EVASION.MOBILITY_MIN`)MUST 走同一張映射(sim/duel/lanesim 三個消費端同吃 —— 壓縮把慢的往上抬,門檻不跟著抬則「重甲慢速機體站著吃彈」當場失效)。K=0.5 是實測下界。稽核 `audit_speed_comp` |
| 開火中位移懲罰 | `RECOIL`(`MOVE_K`/`DECAY`/`END_RAD`)+ `RECOIL_CLIMB_MAX` + `recoilMoveF()`;客戶端 `_recoiling()`/`_recoilMoveF()`/`_tryFire` 定案點 | 尺只有一把 = 準星上踢 `climb`(`kick`/`back` MUST NOT 當第二把尺);兩個端點都是定義而非校準。時間窗 = `recoil.p` 這個狀態本身(MUST NOT 退回計時器);係數 MUST 在 `recoil.p +=` **之前**定案(否則退化成單向棘輪);只夾**移動輸入**(`back` 擊退不吃);飛行另套 `AIR_F`。伺服器不涉入。稽核 `audit_recoil_move` |
| 圖鑑六角能力圖 | `HEX_AXES` + `heroHexStats()`/`hexBand()`/`HEX.FLOOR` + `strikeAreaM2()`/`zoneAreaM2()`;持續 DPS 縫 `weaponCycleS()`/`weaponDps()`;繪製 `main.heroHexHTML()` | 生存 3(耐久/護甲/電力)+ 輸出 3(火力/制域/機動)。六軸值全走既有唯一縫,UI 只負責畫;滿格基準 `hexBand` 推導;半徑取**對數**內插 + 內圈留 `HEX.FLOOR`;制域 = 射程 × 打擊足跡等效直徑(分類走 `aoeClass`,單體直擊取 `hitR` 不是 0);持續 DPS 只有 `weaponDps` 一份;軸說明只寫在 `help.js UI_TIPS.charHex`。稽核 `audit_hex_stats` |
| 波次編制/節奏 | `waveComp()`/`waveMarchSpeed()`/`waveSpacingM()` + `sim.waveInterval()` | 出兵間隔**固定**(`GAME.WAVE_S`);`_prefillLanes()` 間距吃 `waveSpacingM()`,擺位與常規出兵共用 `_spawnLaneWave()`;預置上限 = 該兵線第一座砲塔(吃 `sim.towerSites` 那一份解) |
| 陣營小兵強化 | `CREEP_UPG`/`creepUpgMul()`/`creepDmgTakenF()` + `sim._creepMul()` | 等級住 `sim.creepUpg[side][lane]`(同陣營共用、兵線分開);倍率於生成當下寫進 `e.cu`(不追溯)。**2026-08-11 使用者改制:只強化「對玩家(含電腦玩家)以外」的護甲與傷害** —— 傷害只在目標**不是英雄**時 ×cu;`hp` 不再 ×cu(那對玩家也生效),整份耐久折進 `_damage` 的 `creepDmgTakenF`(只在**攻擊者不是英雄**時套用,逐 pen 還原舊制 EHP ⇒ DPS 與總耐久的強化幅度不變);賞金不再 ×cu(對玩家已不更難打,加成 = 白送)。解鎖門檻 = `_upgAllMax()`;解鎖後該區塊 MUST 排商店**最前面** |
| 八軌階梯(價格 + 戰鬥分數門檻) | `ECON.UPG_STEPS` + `upgradePrice()`/`upgradeScore()`/`canUpgrade()` | 2026-08-11 使用者定案 $75/$150/$300 配戰鬥分數 0/20/100(第一階無門檻)。**一張表兩欄**(價格與門檻是同一階梯的兩個維度,MUST NOT 拆兩份表);列數 MUST = 各軌 `max`。「買不買得起」只有 `canUpgrade` 一份 —— 四個消費端(`sim.buy` 複驗、`game._sweepPick`/`_tickReserve`/`_optimisticBuy`、`main.renderShop` 鈕面、`bots` 採購前置篩選)MUST 全吃,任一端自己比 `money >= price` = 鈕面亮著按不動 |
| 戰鬥分數 | `BATTLE_SCORE` + `battleScoreGain()`/`addBattleScore()`/`scoreHardF()`;狀態 `h.kn`(SQUAD_SHARED) | 擊殺 +4 / 助攻 +1,對**玩家(含電腦玩家)與砲塔** ×5;夾 `MAX`、**只增不減**(陣亡不扣、購買不消耗 —— 它是資格不是貨幣)。兩條記帳路徑(`_kill` 的擊殺 + 助攻迴圈)MUST 同吃 `battleScoreGain`;助攻計分 MUST **與賞金脫鉤**(賞金 0 的目標一樣算戰績) |
| 攻堅順序(劇情戰役鎖血) | `SIEGE`/`siegeSiteStages()`/`siegeOpenStage()` + `sim.siegeLocked()`/`_siegeFell()` | **前線砲塔 → 中段砲塔 → 主堡**,前一階沒清完後一階**完全免傷**;旗標只有 `battleConfig.siege`(rooms.js 正規化成布林),一般對戰恆 false = 逐位元同舊制。①**前線 = frac 最大**(`solveTowerSites` 回傳序是 `[後塔, 前塔]`、短兵線只有一個元素 ⇒ 拿陣列索引當判據會在半數兵線上剛好相反);②階段是**全戰場**的不是逐兵線的(「每階段」對白一階只演一場);③鎖血 MUST 同時擋**傷害與索敵**(三個消費端 `_damage`/`_tgBlockedD`/`bots._acquire`)—— 只擋傷害的話小兵會停在打不動的塔前面把兵線卡死;④事件 `{e:'siege', stage}` 送的是**剛被推平**的那一階;⑤HUD 的目標階段吃快照 `sg`,客戶端 MUST NOT 自己數塔。稽核 `audit_story_talk` |
| 劇情階段對話 | 內容 `storytalk.js`(`STORY_TALK`/`talkOf()`/`stageKey()`)+ 演出 `dialogue.js` | 分工三層:**內容**(誰說什麼)/ **演出**(怎麼畫)/ **觸發**(伺服器 `siege` 事件),MUST NOT 互相滲透。選角四條:發言者 ⊆ 該章 story.js 雙方名冊、每場雙方都要有人、每人 4~5 句、三場加起來蓋滿名冊。`base` 那一場在**結算畫面**播(主堡一倒就 gameOver,戰鬥中沒有暫停);`front`/`mid` 是不擋畫面的下緣無線電條。`radio(sc, { manual })` 的逐句模式**只給故事書**,遊戲本體 MUST NOT 傳(戰鬥中沒有人能按「下一句」)。稽核 `audit_story_talk` |
| 劇情畫面標記(章節卡 / 開戰簡報 / 結算文案 / 頭像小卡) | `storyui.js`(`charAvatarHTML()`/`heroChip()`/`chapterCardHTML()`/`briefHTML()`/`overText()`/`progressText()`) | **兩個消費端**:遊戲本體 `main.js` 與本地故事書 `tools/story_book/`。使用者要的是「完全仿照正式遊戲的呈現」⇒ 兩邊 MUST 是**同一份標記 + 同一份 CSS + 同一支演出**;對照台各寫一份「長得很像」的版面 = 它從此獨立演化,你在那裡看到的東西從來沒在遊戲裡出現過。三條邊界:①**零 DOM、零 three**(故 `envLabel` 取自 `data.js` 而非 `environment.js`)⇒ 離線稽核吃得到真品;②解鎖/通關/選中主駕一律由呼叫端**傳參數**(故事書全開 = `unlocked: true`,MUST NOT 改去寫 localStorage 進度);③不綁事件(只帶 `data-i`/`data-ch`)。稽核 `audit_story_talk` Ⅷ + `audit_ui_layout` |
| 環境標籤 | `data.js envLabel()`(`environment.js` re-export 舊入口) | 只是 `ENV` 的取名查表;住 data.js 是因為 environment.js import three ⇒ Node 端載不動(同 `hazards.js` → `rng.js`)|
| 對進戰模型 | `tools/duel.mjs`(bal ⑤) | **只算武器是刻意的**;招式導向角色走具名豁免。機種控制變因(bal ⑤f)只有 `chassisFighter()` 一份 —— 換底盤會連動射程上限 / 機動 / 經 mobDmgF·rngDmgF 折算後的火力,MUST 走既有解析縫(暫時註冊合成角色 → 解析 → 當場移除),MUST NOT 手抄一份「換了底盤的武器數值」;護甲比**有效值**不比宣告值(無人機宣告值是另一把尺,MUST 反解 `SQUAD.ARMOR_F`) |
| 前線交戰模型 | `tools/lanesim.mjs`(bal ⑦);擊發排程唯一縫 = `reFire()` | 場景距離/秒數全部由 `data.js` 推導,MUST NOT 手寫。與 `duel.mjs` **分工不合併**(本支是攻擊範圍唯一被計價的模型)。三個曾量錯的地方:升級 MUST NOT 重建槽位、站位要同時有下限與上限、閃避不吃「這一步有沒有位移」。長按 = 大招兩組都在模型內(載具當**真的實體**跑 / 自身型走 `castSelfUlt` 且效果值經 `selfUltBoost`);施放有兩道閘(交戰中才放、補血型等真的掉血);記帳 MUST 分桶(hero/tower/creep)。本模型看不到的價值 MUST 逐項列在檔頭並在 ⑦f 印出來 |

#### B. 招式 / 大招 / 載具

| 領域 | 唯一縫 | 鐵律 / 稽核 |
|---|---|---|
| 招式啟動手勢 | `abilHoldSlot()`(模式分流唯一縫) | 長按右鍵 = 招式手勢:一般 → 小招 / 狙擊 → 大招。長按右鍵 / 長按 R / 觸控招式鈕**同吃一份**,MUST NOT 在任一輸入端另寫 `aiming ? …`(A22)。短按仍是切換模式 |
| 招式載具的發射點與槽位 CD 帶 | `abilOrigin()` + `abilDelivered()` + `abilCdMapped()`/`abilCdBand()`/`abilCdRange()`/`abilCarrierCd()` + `ULT_CARRIER.SK_CD_LO·SK_CD_HI` + `ultLaunchLegM()`/`abilLaunchLegM()`/`hyperMaxArcM()`;伺服器 `_launchOrigin()`/`_launchUltCarrier()`/`_launchUltSupport()` | 載具制涵蓋 **32 台 × 兩槽位 = 64 招** ⇒ `heroCast` **完全沒有瞬發結算**(`_castEffect` 只剩 `_ultArrive`/`_supSync` 兩個消費端)。兩槽位只差發射點('self' / 'fort' 最近我方砲塔或主堡)與 CD 帶(小招 [15,30] / 大招 [30,60],仿射**嚴格保序**)。六條紀律:①小招 MUST NOT 一律做成跟隨編隊(有 `range` 的小招標的是幾百公尺外);②小招 MUST NOT 憑空取得遞送距離(`hyperRange()` 只給大招);③發射點只有 `abilOrigin` 一份;④最短飛行腿自發射點量;⑤輔助機隊效果窗自**就位那一刻**起算(`_supArm` 才寫 `g.until`);⑥`h.hypers`/`sq.decoys` MUST 是陣列。稽核 `audit_ult_carrier` Ⅳ |
| 大招載具遞送(點遞送 23 台) | `ULT_CARRIER`+`ultDelivered()`/`ultCdBand()`/`ultCarrierCd()`/`ultParts()`/`ultPartN()` + `heroAbility.carrier`;伺服器 `_castEffect()`/`_launchUltCarrier()`/`_ultArrive()` | 轉換判定 MUST 是推導不是名冊;**合併為一招**(長按與 E 同縫);**效果取代傷害** —— 四條 uA 引爆/擊落路徑一律 MUST NOT `_blast`,擊落 = 該份**完全否定**。可分預算分批、不可分狀態單載(`ultParts`);整數份額走 `ultPartN`。載具 HP/armor 同一把尺,對自身施放也 MUST 推到 `ULT_CARRIER.MIN_LEG` 之外。稽核 `audit_ult_carrier` |
| 自身強化型 = 跟隨玩家的輔助機隊(9 台) | `ULT_SUPPORT`+`kindParts()`+`supportStackable()`/`supportN()`/`supportF()`/`selfUltTempo()`/`supportTempoF()`/`supportSpeed()`/`supportLegS()`/`supportServiceS()`/`supportHp()`/`supportFleetHp()` + `heroAbility.support`;伺服器 `_launchUltSupport()`/`_tickSupport()`/`_supArm()`/`_supSync()`(疊加唯一縫)/`_supRevoke()`/`_supLost()` | ①**疊加是加法不是相乘**(k 架在線 ⇒ 倍率 = 1 + (m − 1) × k/N,實作走 `_supSync` 的「撤下再放」;逐架各推一筆 mods 會被 `_buffMul` **相乘**);核心不變式 = N 架全在線 ⇒ 效果值逐位元同舊制。②**可疊加才分機**(推導,MUST NOT 手寫名冊);機數走 `kindParts`(與 `ultParts` 同一張機種表)。③節奏三分推導(瞬發/間斷/持續);係數兩端是定義,只有 `PULSE_F` 是旋鈕。④耐久推導 = `frontKillHp(投放腿 + 節奏係數 × dur ÷ 機數)`;**投放腿平行 MUST NOT 除以機數**。⑤投放腿推進 MUST 排在到期判定**之前**。⑥一次性效果只做一次(`once`);不住 mods 的二元狀態(匿蹤/免裝填)MUST 由 `_supRevoke` 顯式撤掉(`visionUntil` 是具名例外)。⑦CD 刻意不壓進 [30,60]。⑧渲染沿用 kami 載具 ⇒ `kind:'kami'` 恰**兩個**具名生成點。⑨模型端 MUST 當真的實體跑。⑩兩個槽位共用(吃 `slot`,預設 'ult')。稽核 `audit_self_ult` Ⅴ・Ⅵ |
| 純自身型大招補償 | `SPECIAL_CD_S`/`SELF_ULT`(`ALPHA_S`/`MUL_MAX`/`ALPHA_MAX`/`REALIZED_F`/`REVIVE_INV_S`)/`selfUltEq()`/`selfUltBoost()`/`selfUltDps()` + `heroAbility` 的 `regen`·`cleanse`·`revive`·`brk`;伺服器 `_castEffect` 的 rally/recon/overdrive/alpha 分支 + `_reviveBody()`/`_breakOnHit()` + `_gateFire()` 的免裝填與破隱窗 + `SQUAD_SHARED` 的 `noReloadUntil`·`alphaArm`·`alphaX` | 當量 MUST 推導(`specialBudget × REALIZED_F × ult.cd ÷ SPECIAL_CD_S`)。兌現是**增額**不是再乘一層。破隱爆發窗只在「開火現形」那一刻開(窗開在 `_gateFire` 的 `stealthUntil = 0` **之前**)。`brk` 只准住 `_damage` 的英雄分支;免裝填補滿 MUST 排在推進填彈計時器**之前**;三欄 MUST 進 `SQUAD_SHARED`。復活只救仍在倒數者、MUST NOT 走 `_respawn` 且 MUST 清 `_trail`。⚠ **`REALIZED_F = 0.35` 是凍結的歷史量測**(它量的機種絕招已不存在)—— 要調係數 MUST 改看 bal ⑦f 逐台 EHP/次,MUST NOT 再宣稱它是當輪量出來的。夾制頂到上限的逐台 MUST 印出來。稽核 `audit_self_ult` |
| 機種絕招預算(退場後 = 補償的尺) | `SPECIAL` + `specialBudget()` + `SPECIAL_CD_S` | 機種絕招 2026-08-06 退場後**沒有任何玩家可觸發的出口**,只剩兩個消費端:`selfUltEq` 的補償當量、載具 HP 與爆風面積計價的基準。`SPECIAL_CD_S` 是當量換算的分母,MUST NOT 手寫 30 |
| 三種載具形式 | 無人機 `SQUAD.KAMI`(N=4)+`kamiSide()` / 變形者 `DECOY`(BOMB_MAX=6) / 機甲 `HYPER`+`hyperLaunchRad()`/`hyperApex()`/`hyperArcY()`/`hyperClimbVx()`/`hyperClimbS()`/`hyperRange()`/`hyperDiveSpd()`/`hyperFlightS()`/`hyperTrackR()`/`hyperClimbLen()`/`hyperTerminalF()`/`hyperShare()`;**唯一生成點 = `_launchUltCarrier()`**(輔助機另一個 = `_launchUltSupport()`) | 三者自 2026-08-06 起**只是大招的載具**。飽和攻擊「攻擊力減半、數量加倍」= 每架 = 預算 ÷ `KAMI.N`(MUST NOT 另寫折半係數);橫向站位走 `kamiSide(i)`。三者的推進全在 `sim._tickKamis`/`_tickDecoys`/`_tickHypers`,客戶端只渲染與播報(MUST NOT 在客戶端算爆風,A1)。極音速飛彈是**伺服器實體**(可鎖定/擊落,被擊落**刻意不引爆** —— 攔截成功 = 完全否定);戰鬥部領 `hyperShare()`(= 2.5 架自爆無人機,推導不手寫),**只動火力不動範圍**(爆風仍取 `specialBlastR(1)`,MUST NOT 順手乘 `√hyperShare()`)。彈道:爬升段水平**等速**、高度只由 `hyperArcY()` 給(初始角 45° 是推導出來的)、頂點在**目標正上方**、水平航線發射當下定案、螺旋基底取**固定水平法向**。⚠ 終端追擊(`m.chase`/`hyperTrackR`)自 2026-08-06 起是**死碼**(`_launchUltCarrier` 恆給 `tid: 0`)—— 規則與稽核都留著,**MUST NOT 自行刪除該定案**。集束炸彈逐顆走 `_decoyBombTarget()`;拋擲解與逐幀積分 MUST 吃同一個 `DECOY_BOMB_GRAV_F`。稽核 `audit_flight_power` Ⅰ・Ⅱ |
| 絕招載具 HP 校準 / 爆風面積計價 | `towerDps()`/`towerSurviveHp()`/`towerKillHp()` → `TOWER_SITE_N`/`frontDps()`/`frontSurviveHp()`/`frontKillHp()`/`waveDps()`/`overflyDps()`/`overflySurviveHp()` → `kamiHp()`/`hyperHp()`/`decoyHp()`(各自 `kamiExposureS()`/`hyperFlightS()`/`decoyExposureS()`);半徑 `specialBlastR()` | 三個 HP 全是推導值,MUST NOT 手寫;三種載具一律 **armor 0 / 護盾 0**(校準要精確)。**尺 = 前線一組塔位(兩座),不是一座孤塔**;極音速飛彈另計一波兵(`overflyDps`)。**爆風半徑也是預算**:半徑 ∝ √(該彈頭分到的預算比例)⇒ 三招**總覆蓋面積相同**;演出半徑 MUST 取結算用的同一份 `def.r`。`kami`/`decoy` 的曝險窗刻意逐位元不動。改砲塔任一數值或波次編制 MUST 重跑全部 |

| 飛行動力學(受擊掉高 / 爬升動力) | `FLIGHT` + `airSinkM()`/`liftMax()`/`liftRegen()`/`liftDrainPS()`;消費端 `game._airSinkHit()`/`_stepLift()`;bot 那半 `sim._botAirSink()` | ①掉高 = **位移** ∝ 傷害,係數由 `SQUAD.DRONE_AVG_HP × TARGET_H.tower` 推導(MUST NOT 手寫、MUST NOT 改成速度制或逐機體血量制);②動力只有**往上飛**消耗,耗速 = 上限 ÷ `DRAIN_S`(推導),上限/回速正比於電力,見底 = **爬不上去**(MUST NOT 改成減速,與 `slopeBlocked` 同語意)。位置本就客戶端權威 ⇒ 真人那半住客戶端物理;**bot 沒有客戶端** ⇒ 掉高由 `_botAirSink` 補上**同一支** `airSinkM`(兩條扣血路徑都要掛,含護盾全擋的早退),真人 MUST NOT 在伺服器再套一次;NPC 直升機/集束轟炸機/極音速飛彈(伺服器腳本航線)MUST NOT 套。稽核 `audit_flight_power` Ⅲ~Ⅵ |

#### C. 武器判定 / 彈道

| 領域 | 唯一縫 | 鐵律 / 稽核 |
|---|---|---|
| AoE / 彈道分類 | `aoeClass()`(blast/fan/line)/`trajClass()`(lob/flat/line/guide/fnf) | 由 `def.type`/`fan`/`guide` 推導;MUST NOT 手寫逐武器分類表 |
| 「打得到嗎」判定 | `REACH_RULE`/`reachRule()` → `game._reachable()` | **準星那一發**的唯一判據,逐彈道五類全覆蓋。消費端 MUST NOT 自己比對 `trajClass`/`def.type` |
| 範圍光暈名冊 | `game._shotVictims()`(+`_inShotRange()`/`_bodyDy()`/`_shotWarn()`);唯一消費端 `_updateRangeGlows()` | 語意 = **這一發的傷害足跡**:準星目標打不到 ⇒ 全場熄燈(入口閘仍走 `_reachable`)。分類只走 `aoeClass`;幾何逐類鏡射伺服器(blast ← `_blast`,**刻意不吃 LOS 也不吃射程**;fan ← `heroPlasma`;line ← `_lancePierced`)。扇形與貫穿**刻意沒有整發性的入口閘**,射程與視線由逐目標 `_inShotRange` 夾回。舊分幀預算/TTL 快取已退場。稽核 `audit_weapon_gate` Ⅴ-b |
| 扇形錐緣 | `fanArcHalf()`(標稱)+ `fanConeHalf(def, d, hitR)`(有效) | 錐內判定 MUST 量到目標**命中量體近側表面**(與 `_surfD3`、`_lanceHits`、`_blast` 同一條規則);三個消費端(sim `heroPlasma` / 客戶端 `_shotVictims` / lanesim)MUST 全吃,MUST NOT 任一端另寫 `Math.cos(arc)`。量體只放寬「打不打得到」,**MUST NOT 放大傷害**(`offAxisFalloff` 分母仍是 `fanArcHalf` ⇒ 靠量體才進錐的目標一律吃錐緣保底 `AOE_EDGE`,小兵級量體的錐內傷害逐位元不變) |
| 閃避範圍 + 維持 DPS 補償 | `EVASION`(含 `P_MAX`)+ `evadable()`/`evadeComped()`/`evadeCompF()`/`evadeExpF()`;率 `sim._dodgeP()`、擲骰 `sim._dodges()`、爆風那一半住 `sim._blast`(逐目標擲 + 逐目標補償) | 2026-08-11 使用者定案「爆炸傷害就算沒擊中原先的目標,也會造成範圍傷害(閃避率各自計算)」⇒ **輕武器直射 + 一切爆炸傷害**(爆炸型重武器 / 攻擊招式 / 三種載具戰鬥部 / NPC 肩射火箭)全吃閃避;扇形與貫穿**依機制豁免**(錐/圓柱一次掃整排,沒有「這一發瞄的是誰」)。判據 MUST 寫成排除法(`aoeClass` 不是 fan/line) —— 列舉「`id === 'light'` 或有 `r`」會在 NPC 那半靜默失效(小兵武器 def 沒有 `id`)。爆風 MUST 逐目標 `continue`,**MUST NOT 整發 `return`**(一台閃 = 全隊免傷,而傷害數字一個都不會跳);自損(`friendly`)刻意不擲。四個消費端(sim / duel / lanesim / balance)MUST 全吃。**2026-08-12 使用者定案「維持 DPS 提高傷害,閃避率不動」**:被閃掉的期望輸出還給沒被閃掉的那幾發(`base × (1−p) × 1/(1−p) ≡ base`)⇒ 期望 DPS 逐位元同改制前,閃避對爆炸傷害變成**純方差**。三條:①只補**這一輪新納入閃避的那一批**(`evadeComped` = 一切爆炸傷害;輕武器直射自 2026-07-14 就吃閃避,基準已含那份損失,補它 = 憑空加傷);②分母 MUST 是**該目標自己的** p(拿全體平均當單一係數 ⇒ 閃不掉的小兵/建築/重甲平白吃補償 = 通膨),p = 0 ⇒ 係數 1 ⇒ 逐位元同舊制;③p MUST 夾 `EVASION.P_MAX`(分母是 1−p)。**副作用**:閃避對爆炸傷害的**期望減傷 = 0**,帶閃避增額的招式對爆風只剩全有全無 —— 這是「維持 DPS」的直接推論。模型側 `evadeExpF` 對有補償的那一批 MUST 回**恆等式 1** 而不是兩個浮點數相乘(乘出來 0.9999999999999999,在步進模擬裡放大成 ±1pp 勝率漂移)。稽核 `audit_weapon_gate` ⅩⅢ |
| 高地壓制(被擊中後的命中/閃避/速度懲罰) | `HIGH_SUP` + `highSupF()`/`highSupDodgeF()`/`highSupSpeedF()`/`highSupMissP()`;伺服器 `sim._stampSup()`(唯一戳記)/`_supF()`(唯一讀取)/`_missP()`(唯一擲骰率);折速 `bots._speed()` 與 `game._mobility()`;模型端 `duel.mjs` 的對局狀態 | 2026-08-12 使用者定案「高度優勢越高時,被擊中後的 1 秒內命中率/閃避率與速度下降越多」。①強度只有 `altScale` 一把尺(與 +射程/+閃避/爆擊代價共用那條斜坡);②**沒有高度優勢 = 逐位元同舊制**(bal ①②④⑥⑦ 全是同高度模型 ⇒ 一格未動);③高度優勢相對**打你的那個人**取(`_altDh`),沒有攻擊者(地雷/火場)不留壓制;④命中率與閃避是**獨立事件**(MUST NOT 相加),伺服器只擲一顆骰,但 `evadeCompF` 的分母 MUST 只吃閃避那一半(壓制不在 A45 ⑦「維持 DPS」的帳裡);⑤速度只在**位置權威**那一端折(真人客戶端 / bot `bots._speed`),伺服器 MUST NOT 對真人再折一次;⑥**只壓制機體**(砲塔/主堡/小兵不吃 —— 那會直接動到 bal ①④ 的校準錨);⑦三個值 + `FLOOR` 由 **bal ⑤c1**(同機體鏡像)校準,MUST NOT 調到把它撞紅(逐軸實測代價見 `HIGH_SUP` 檔頭);⑧**強度形狀 = 一階 + 斜坡**(`FLOOR` + `(1−FLOOR)·altScale`)—— 高地的報酬量出來就是「跨過門檻先跳 8.6pp、再以 16.7pp/s 線性加碼」,代價寫成純斜坡的話那個截距**永遠配不掉**(實測:不管站多高,較高方恆多留 8.7% EHP,而逐項斷言全綠)。稽核 `audit_weapon_gate` ③b |
| 爆風超壓帶 | `BLAST`(`CORE`/`EDGE`/`EXP`)+ `blastCoreR()` | `blastFalloff` 與「打得到」判定共用同一組轉折點;MUST NOT 在任一端手寫 0.5/1.8/1.3 |
| 射程界 | `_updateBullets`/`_arcTrace`/`_updateVisShells` 的 `spent = 距發射點` | 射程 = **以射擊點為中心的球面,與軌跡無關**(弧長/導引修正/散布繞路一律不計)。是**遊戲空間**球面:三軸等權直接 hypot,MUST NOT 為 `REAL_SCALE` 在 y 軸補正(會讓伺服器變橢球、兩端分家)。航跡長 `b.dist` 整組退場。**球心 = 槍口**:誠實界路徑(`heroLance`/`heroPlasma`)MUST 量回報的槍口 `o` + `dist2d ≤ 12` 防作弊閘。具名例外(水平圓柱)= `heroBurst` 落點閘、`_acquireTarget`、`heroCast` 落點、`_decoyBombTarget`。稽核 `audit_weapon_gate` Ⅵ・Ⅻ |
| 射程球心 = 擊發位置 | `sim._trailPush()`(位置軌跡唯一取樣點)+ `_shotOrigin()`(球心與回推量 `back` 的同一個解)+ `shotTrailS()` | 球心 MUST 由伺服器自己的位置軌跡**回推**,MUST NOT 收客戶端回報的擊發座標(A1)。回推 = 由新到舊取第一筆滿足「已過時間 ≥ 從那裡飛到落點的時間」的樣本(MUST NOT 迭代逼近);`back` 取同一個解的飛行時間;**僚機吃同一條規則**;保留窗推導;重生 MUST 清軌跡;軌跡不足 ⇒ 退回當下位置。`heroLance`/`heroPlasma` 不在此列。稽核 `audit_weapon_gate` Ⅻ⑸ |
| 出膛初速 / 飛行時間 | `shotV0()` / `shotFlightS()` + `flightCapS()`(高差取 `altDhMax()`) | **兩者 MUST NOT 互相代用**(差六倍)。對地拋投的實際初速是 45° 反解(`_lob45Vel`),`shotV0` 只剩「解的上限」語意 ⇒ 飛行時間 MUST 走 `shotFlightS`,MUST NOT 自己 `d / shotV0`。凡拿著彈時刻驗擊發資格的閘門 MUST 經此換算回擊發時刻。`back` 吃**同高**誠實估計、`cap` 才吃俯射餘裕;射速閘刻意仍量真實時鐘 |
| 榴彈火控 | `BALLISTIC.LOB_*`/`AA_MV`/`ARC_MAXP`;`_lobAim()`(每幀定案 `_lobFc`)+ `_lobCrosshair()` + `_lobLadder()`(`_lob45Vel` / 對空裝藥階梯)+ `_arcTrace(…, draw)` + `_updateAaMode()` | 火控解與積分只准一份(`_lobAim` 與 `_reachable` 同吃,含 `aa` 旗標);鎖定光暈 = `_arcTrace minD ≤ LOB_TOL`,MUST NOT 退回直射線判定。**準星是唯一目標來源** —— 準星沒解到單位就是打地面,MUST NOT 有第二個目標來源(錐形輔助 `_aaTarget`/`AA_CONE` 已退場);瞄地面 ⇒ 固定 **45°** 投擲、初速反解(MUST NOT 手寫初速表);仰角 ≥45° 無解才退回階梯;瞄空中 ⇒ 維持彈射模式;中途碰撞即引爆、沒碰撞續飛到射程界原地爆 |
| 導引頭機動 | `SEEK` + `seekTurn()` | 角速度與「轉彎半徑 ≤ `SEEK.R_M`」取寬者;兩處轉向 MUST 經此。**只放寬不收緊** |
| 射程閘門容差 | `RANGE_TOL` + `altRangeMax()` | 網路寬容**只有一個值**,MUST NOT 逐處手寫倍率。落點類閘門拿不到目標實體 ⇒ 取 `altRangeMax()` 當誠實界。**寬容只放給「客戶端已自行夾過射程的回報」**:`heroPlasma`/`heroLance` MUST 吃誠實界(不乘 `RANGE_TOL`),且球心 MUST NOT 退回機體中心 |
| 高度制空射程 | `altRangeF()` + 伺服器 `_altDh()`/`_altRange()` + 客戶端 `_altRangeTo()`/`_effRange()`/`_maxRange()` | 曲線只有一份、兩端同吃;客戶端 MUST 逐目標算。**高度差 MUST 同參考框相減**(`_altDh` 單一縫,射程/`_altCrit`/`_dodges` 三個消費端同吃);兩邊都拿得到絕對高程才用絕對框。搜尋半徑走 `_maxRange`(機制上限,只准寬),找到後 MUST 以 `_effRange(def, ent)` 誠實夾回;客戶端 `_effRange`/`_altRangeTo` MUST 逐條照抄 `sim._sightY` |
| 地形稜線遮蔽 | `LOS.HGT_*`/`RIDGE_*` + `hgtEnc()` + `main.bakeHeightGrid()` + `sim._ingestHgt()`/`_hgtAt()`/`_absSightY()`/`_ridgeBlocked()` | 粗高程網格隨 `t:'world'` 上傳(編碼縫 = `hgtEnc`)。**只給「伺服器自己選目標」的路徑用**(`heroPlasma` 錐內選人 / `_lanceHits`);MUST NOT 併進 `_losBlocked`(回報型攻擊已被本端地形截斷,再驗一次只會多擋 → A30)。判定全程在**絕對**高程框,偏差一律朝「不擋」。三條放行:未上傳網格 / 任一端在隧道內 / 距離短於兩倍豁免帶。**改 `LOS.HGT_MAX` 或任何 world 上傳上限 MUST 重算 `server.js maxPayload` 餘裕**。稽核 `audit_weapon_gate` Ⅷ |
| 貫穿演出 | `game._lanceVisual()` + `lanceR(def)` | 自機/他人/bot 共用;粗細 = 伺服器判定半徑。**無任何情境倍率**(`lanceR` 第二參數 MUST NOT 復辟) |
| 彈匣惰性補彈 | `sim._refillIfDone()`;消費端只有 `_gateFire()` 與 `heroReload()` | 伺服器**沒有逐 tick 掃彈匣** ⇒ 凡要讀 `h.ammo` 下決定的路徑 MUST 先過這一支,MUST NOT 直接讀(漏掉 = AoE 從第二個彈匣起整場零傷害)。射速閘 / `back` 回推擊發時刻的紀律見 `_gateFire` 檔頭 |
| 機體高度/半徑 | `SOLDIER_H`/`HERO_SIZE`/`heroTargetH()`/`TARGET_H`/`hitH()` + `hitR()`(`HERO_HIT_R`/`TARGET_R`) | 同一把尺餵渲染縮放與伺服器命中量體;**爆風/貫穿/射程閘門一律量到命中量體最近點**(水平 `hitR(t)` + 垂直帶 `_bodyDy`);貫穿半徑 = `lanceR(def) + hitR(t)`;`game.COLLIDER` MUST 由 hitR/hitH 推導但鍵集 MUST NOT 隨 `TARGET_R` 擴張 |

#### D. 電腦玩家(bot)

| 領域 | 唯一縫 | 鐵律 / 稽核 |
|---|---|---|
| 操作節奏 | `BOT_DIFF`/`BOT_OPS`/`botOpGap()` + `bots._op()` | MUST NOT 另寫 tick 計數節流;持續開火刻意只吃反應時間、不吃手速閘 |
| 視野 | `BOT_VIEW`/`botFovHalf()` + `bots._fovHalf()`/`_bearing()`/`_face()`/`_turn()`/`_alertLook()`;方位來源 `sim._hurtLog()` | 半視角推導(相機吃**垂直** fov ⇒ 以 `ASPECT` 換算),**只限水平**。選敵閘門只住 `_acquire`。`h.ry` **唯一寫入點 = `_turn`**、步進只准經 `viewLockStep`(`_face` 只寫意圖)。受擊警戒方位只准來自 `_hurtLog`,記在主視野機、MUST 排在狀態機**之後**。推線朝向 MUST 取**前進方向**。稽核 `audit_bot_vision` |
| 戰術(選敵/撤退/打帶跑) | `BOT_DIFF.tactic·elite` + `BOT_TACTIC` + `botTargetPrio()`/`botThreatDecay()`/`botSalvo()`/`botExecW()`/`botKiteF()`;記帳 `sim._hurtLog()`/`_dmgOut()` | **分層只認旗標**,MUST NOT 比對難度字串(新手/低難度逐位元維持舊制)。選敵三項 MUST 正規化成候選集內佔比;帳只有一份(輸出**兩條結算路徑都要記**);威脅累加 MUST **先淡出舊帳再加**。撤退三道閘缺一不可(遲滯帶 / RETREAT 不被 RALLY 搶走 / 「扛半條護盾」量近期傷害且**排除塔與主堡刮傷**);RALLY = 還在挨打邊退邊打、脫離接觸就停火停步;`prog` MUST 走 `_progAt`。稽核 `audit_bot_tactics` |
| 定位分類與策略 | `BOT_ROLE_FEATS`/`BOT_ROLES`/`BOT_ROLE`/`BOT_BUY_ORDER` + `botRoleFeats()`/`botRoleScores()`/`botRoleOf()`(唯一分類處)/`botRoleRoster()`/`botRoleNorm()`/`botRoleMul()`/`botRoleTactic()`(唯一覆寫處)/`botBuyOrder()` + `botTacticCross()`;消費端 `bots._resolveRole()` → `this.tac` | ①分類推導,**MUST NOT 出現任何逐角色名冊**(五條特徵吃 `HEX_AXES[].val` 同一份取值函式)。②特徵是相對全場的**對數分位**(`aid` 是具名例外,`power` 刻意不收)。③定位 = 剖面內積 argmax,特徵**置中**、`Σ\|w\| = 1`。④策略是既有旋鈕的覆寫,**MUST NOT 出現 `if (role === …)` 行為分支**;五個新旋鈕基準逐一等於改制前硬編碼。⑤覆寫 MUST 以角色數加權**幾何平均 = 1** 正規化;夾到邊界的逐項印出來;`PRIO_STRUCT` 下界刻意是 1。⑥只在 `BOT_DIFF.tactic` 之下解析(A33)。⑦與學習迴圈疊加(五個新旋鈕不進學習白名單);解析點 MUST 在 `update()` 而非建構函式,基準 MUST 只記一次(`_tacBase`)。設計全文 `docs/bot_design.md`;稽核 `audit_bot_role` |
| 學習策略 | 策略檔 `botPolicy.js`(工具產出、零 import、**人手 MUST NOT 編輯**)+ `BOT_TACTIC_BASE`(凍結基準)/`BOT_LEARN`(白名單+邊界)/`botPolicySanitize()`(夾制唯一縫)/覆寫迴圈/`balanceFingerprint()`;讀取縫 `bots.this.tac`;迴圈 `tools/bot_learn.mjs` | ①**只學取捨不學能力**(視野/手速/準度 MUST NOT 進白名單,A32);②使用者定案值與帳的時鐘(`THREAT_S`)不可學;③白名單鍵 MUST 只被 tactic/elite 分支消費;④夾制只有一份(執行期與工具同吃)。`BOT_TACTIC.` 在 bots.js 零殘留;空 policy = 中性 = 逐位元同基準。學習輪收尾閘門:乾淨種子上沒贏過就不寫檔。設計全文 `docs/bot_design.md`;稽核 `audit_bot_policy` |
| 碰撞量體 / 實體碰撞 | `SELF_F`/`selfCollider()`/`COLLIDE_KINDS` + 客戶端 `_collide()`/`_sweepBlockers()`/`_unitSolids()`/`_circleEnter()`/`_pushOutCircle()`/`COLLIDER` + 伺服器 `solidResolve()`/`_solidsNear()`/`solidPush()`/`solidEnter()`;呼叫端 `bots._move()` | 電腦玩家碰撞法則一律跟真人一樣。量體只有 `selfCollider` 一份;障礙集兩個來源鏡射客戶端兩個迴圈(上傳碰撞柱走 `_losGrid`)。**掃掠與 push-out 缺一不可**(對建物與對單位皆然);`fwd === 0` MUST 歸「遠半」交給掃掠;圓柱幾何收成 `_circleEnter`/`_pushOutCircle` 各一份且與伺服器逐案例同值;單位與世界障礙在**同一趟** pass 交錯收斂、順序 MUST 先單位後世界(**世界幾何贏**);垂直帶 ε 兩端同式。`bots` 的 `h.x`/`h.z` **唯一寫入點 = `_move`**,且 MUST 配撞牆繞行(`_skirt`/`_stuck`)。稽核 `audit_bot_vision` + `audit_npc_collide` |

#### E. 地形 / 結構 / 通行

| 領域 | 唯一縫 | 鐵律 / 稽核 |
|---|---|---|
| 砲塔佈局規則 | `towerLayoutAudit()`(#4 射程重疊)/`towerTunnelAudit()`(#5 洞口涵蓋) | 烘焙/mapSelect/伺服器/稽核共用;#5 MUST NOT 下放成執行期挪塔 |
| 兵線導航規則 | `laneUTurnAudit()` / `laneTurnAccumAudit()`(±`TURN_ACCUM_MAX_DEG`,順逆抵消)/ `laneStructEntryAudit()` | 生成期硬門檻淘汰;規則①只在離線 bake;②③互相獨立,MUST NOT 以一代二 |
| 離線工具的地形/圖資/結構剖面 | `tools/venue_field.mjs`(+`makeCarvedField()` 開挖後地形) | Node 端取得「與執行期同形」地形的**唯一縫**:高度管線是 `buildTerrain` 逐字鏡射,結構判定與剖面一律 `new Function` **執行 biomes.js 原文**、常數也從原文解析。消費端 MUST 走這一支,MUST NOT 各自再抄一份;快取共用 `tools/.scen_cache/`。開挖走廊是**敞開補集**,分段規則 MUST 逐字鏡射 biomes;**淨空(V-D)刻意仍吃天然地形**。`shot_tunnels` 的射線掃描 MUST 留在 Playwright(Node 端沒有 three) |
| 隧道/地下道剖面 | `tunFloorAt()` + `underpassPlan()` + `strucHw()` | 山體隧道 = 平直內插;地下道 = 同基準減 smoothstep 下沉。消費端 MUST 吃 `way._tun[ri].pts` |
| 隧道/明隧道/地下道**頂板** | `tunRoofTop()` + `makeTunnelIndex` 的 `roof`;消費端 `main.surfaceAt`(站立面)+ `game._slabHitT`(彈道板體) | 頂板 = **有厚度的板體** [`ceil`,`roof`],與橋面板體逐條對稱:上表面站得上去、板體上下都擋砲火(只做一半 = 打不穿卻踩得穿)。①頂面高只有 `tunRoofTop(cy)` 一份(三個消費端同吃),MUST NOT 手寫第二份 `+ TUN.ROOF_T`;②站立面 MUST 取 `max(地形, roof)` 而非直接指派;③mount 台階測試 MUST NOT 另寫;④彈道 MUST 是**板體重疊**而非「跨過底面」;⑤`open` 段三處一律濾掉(A29)。伺服器不需改(兩端由 `_slabBlocked` 同判)。稽核 `audit_layer_block` Ⅰ・Ⅴ |
| 道路塗裝寬 / 結構接合 | `carriageHw()` + `flareHw()`/`ROAD_FLARE_M` + `markBaseAt` | **通行寬 `strucHw` 與塗裝寬 `carriageHw` 是兩件事**:標線/避車道邊帶/漸縮帶三消費端 MUST 全吃 `carriageHw`,MUST NOT 依差額三元切換。漸縮帶**純視覺**(MUST NOT 進 decks/tunnelSegs/cols/走廊);**邊帶 MUST 跟著漸縮帶同步收到零**且吃同一個 `fhw`,車道緣全程不動。橋與隧道恆柏油且橋面照畫標線,基準高 MUST 走 `markBaseAt`。稽核 `audit_road_joint` |
| 明隧道判定 | `tunnelWallProfile()` | **明隧道 = 一側在地形內部(整面牆)+ 一側在地形外部(柱列);貫穿整個地形一律以隧道處理,兩側都是牆**。開放側 MUST 三條件同時成立:①`WALL_MIN` 內藏不住頂板 ②牆背 `NEAR_W` 內無高過頂板的實體支撐 ③**牆外 `OUT_W` 內地表落到路面以下**。判定跑三次 MUST 同解:①② 吃 heightAt(開挖只降不升),③ 吃 `terrain.natureAt`(**天然**地形快照,自家路塹不算證據)。地下道恆非明隧道。構件共用同一份 `open/gy/nx,nz`;落地基準只有 `galBase`;開放側 = 矮牆 + 連續柱列,柱間**透明可穿透**(tunnelSegs 附 `gal` 遮罩 → slab 第 7 欄 → 伺服器 `tunnelSideExit`/`_slabSep` 放行,兩端同判);幾何 MUST 與 gal 無關;柱列純視覺 MUST NOT 進 `cols`。**近帶岩背**維持整面牆;**洞內三淨空** = `galBores`(併入 `punchPortalHoles` 同一次呼叫)+ `markGradeCorridors` 照樣 blockArea + `_slopeDegAlong` 洞內豁免;**落石棚**(`tunnel=avalanche_protector`)整段強制視為覆蓋;隧道鏈 MUST 同 tunnel 值才併;**柱外淨空帶** `carveGalleryBands`(只降不升、只動頂板以下)。稽核 `audit_open_tunnel` |
| 道路路基整平 | `terrain.gradeRoadBeds()`(呼叫端唯一一處) | 一般道路乾地走廊橫向整成切填平台。四紀律:填方超過 `fillMax` 漸退、水域/沼澤節點不動、隧道開挖足跡優先、每節點認**最近的那條路**(MUST NOT 混平均)。全深帶 = 塗裝寬 + 半格;零 rnd;floors 修改前整批取樣。稽核 `audit_road_bed` |
| 地形坡度移動 | `SLOPE` + `slopeDeg()`/`slopeMoveF()`/`slopeBlocked()`;量測 `game._slopeDegAlong()` | 平緩帶 `EASE_DEG` = `MAPGEO.MAX_ROAD_GRADE_DEG`、阻擋角 = ×`BLOCK_F` 推導(設計語意:**兵線走廊恆全速**)。坡度一律量**裸地形 `heightAt`**;倍率吃固定前瞻 `PROBE_M`。三條豁免 = 飛行/騰空、人造鋪面、零位移;**下坡一律不擋**;「爬不上去」MUST 由 `slopeBlocked` 表達而非倍率 0。稽核 `audit_slope_move` |
| 經緯度 → 世界公尺(**含地圖主方位**) | `data.js` 的 `mapRot()`/`rotXZ()`/`llToXZ()`/`xzToLL()`;消費端 `terrain.llToWorld`(轉呼)、`sim.llToMeters`(轉呼 + **z 反號**)、`biomes.worldToLL`(轉呼) | 旋轉是**投影的一部分**,地形/兵線/主堡/圖資/建物一起轉 ⇒ 等距同構(距離/夾角/塔位/兵線分離/重合率一律不變)。角度的推導只有 `roadgrid.roadGridRotDeg()` 一份(取樣面 `GRID_HW` = 大馬路、**未旋轉**量測框、取負號),**兩條產線同吃**:預設場地 = `venueGrid.js` 離線烘焙(`tools/bake_venue_grid.mjs`),自訂地圖 = `main.resolveMapRot()` 在**存入最愛那一次**量一次寫死(取圖走 `biomes.fetchGridRoads`)。兩者的抓取範圍都 MUST 在 **rot=0** 的框裡算(帶 rot 只會長大 ⇒ 重烤不冪等)。拿不到 = 0 = 逐位元同舊制。⚠ **兩端旋轉方向相反**:z 鏡射(A30)把 R(θ) 共軛成 R(−θ) ⇒ `sim.llToMeters` MUST 只是 z 反號薄殼,MUST NOT 自己再轉一次(兩端差 2θ,畫面上只表現成「塔的位置對不上/打得到卻沒傷害」)。`center.rot` 只准經 `mapRot` 讀。稽核 `audit_road_grid` |
| 戰場世界方框 / 資料抓取範圍 | `battleRect()`(遊戲公尺,客戶端框)/ `battleBBox()`(經緯度 AABB) | 方框恆軸對齊,客戶端地形 minX/maxX 與伺服器 `bounds`(z 反號)同吃 `battleRect`;抓取範圍 = 方框四角的經緯外接框 ⇒ 旋轉後自動擴到蓋得住。**旋轉只准讓方框長大**(逐軸取「旋轉後」與 rot=0 的較寬者)—— 兵線被轉到與某軸平行時那一軸會塌(實測 45° 面積剩 66%),而 MAP_EXPAND 是等比放大救不了,側翼野營合法區會無聲消失。稽核 `audit_road_grid` Ⅲ |
| 道路 16 方向量化 | `roadgrid.js`(`ROAD_GRID`/`dirAngle`/`halfBin`/`densifyM`/`minStraightM`/`gridAngle`/`waySegs`/`quantizeRoads`/`dirErrorDeg`);接線**恰一處** = `biomes.js` 取得 `osmRoads` 之後、任何消費端之前 | **零 import、零亂數**。三個不變式缺一不可:①真的落格(逐條路的角度誤差中位數,不是全網統計 —— 一整條沒被量化的路在 p90 上看不出來)②路不走掉(硬上限 `MAX_DRIFT_M`;卡在格界的長直路硬吸到鄰格會甩出數百公尺,那條路就此離開衛星底圖與自己的兵線)③路口不裂(路口是共用節點,量化 MUST 是「解出新的節點位置」而非逐 way 各轉各的)。去鋸齒靠**位置空間**的遲滯(沿路走、偏離真實路線超過預算才換格),直段長度因此有推導下界 `minStraightM()` —— **MUST NOT 改用「事後把短方向段併進鄰段」**(會把階梯併回單一方向 ⇒ 長度重解退化成「兩錨點之間拉直」= 那條路等於沒被量化)。量化前 MUST 先細分(`densifyM()`;OSM 直路頂點可以隔一兩百公尺,單段就吃光位移預算)。**MUST NOT 作用在兵線**(伺服器也在吃)。稽核 `audit_road_grid` |
| 立體結構的建置範圍 | `buildRoads()`(簽章**無兵線參數**)+ 剔除記帳 `strucDrop` | 高架橋/地下道/隧道/明隧道**就算在兵線之外也建立**;防線是**簽章**(結構性地看不見兵線/主堡/塔位)。會讓結構消失的刀**恰三把**且 MUST 記帳:`laneWet` / `crossing` / `parallel`。**新增第四把刀 MUST 同步記帳**。結構鏈排在一般道路之前;`strucTunnel` 資格閘。稽核 `audit_road_joint` Ⅵ |
| 飛行體的貼地渲染基準 | `game._flySurf()`;消費端只有 `_updateEnts` 的 `ent.flies` 分支 | **MUST 是 (x,z) 的純函式**,MUST NOT 沿用地面單位那條逐幀棘輪(`surfaceAt(x,z,curY)`)。基準面 = 地表 ∪ 橋面(`deckAt`)∪ 隧道頂板取最高者 ⇒ 核心不變式 = **路徑無關**(同一座標不管從哪飛來都逐位元相同)。**點狀地物刻意不收**(`blockerTopAt` 的建物/神木/巨岩/地標:那不是連續結構面,收了直升機經過路邊電塔會整台彈上去)。地面單位那半 MUST 逐位元維持舊制。稽核 `audit_npc_collide` |
| 世界高度上限 | `WORLD_H` + `objHeightMax()`/`objScaleCap()`/`objScaleFit()`/`worldCeilY()`;`terrain.avgH`;客戶端唯一取值處 `game._ceilY()`(三個消費端);物件端 `OVER.bldCap` + 四個縮放夾制點 | 現值 `OBJ_F 4 / CEIL_PEAK_F 4.5 / CEIL_AVG_F 6`(物件 104m、峰頂餘裕 117m、平原 156m)。①尺只有一把 = `TARGET_H.tower`,三個係數全是它的倍數。②`CEIL_PEAK_F > OBJ_F` ⇒ **物件恆構不到天花板**(結構保證);`CEIL_AVG_F > CEIL_PEAK_F` 是「取 max 兩端各自勝出」的前提。③取 max 不是 min(天花板 MUST 是全圖一個值)。④上限一律**夾縮放**,MUST NOT 事後截幾何;夾制不消耗亂數且 MUST 夾在第一個消費端之前。⑤分布版 `objScaleFit` 不是第二條規則(硬夾會把整片森林壓成同一高度)。⑥地標標稱高 MUST **實測**(`Box3`)而不是讀 `LANDMARK_COL[].h`。⑦位置本就客戶端權威 ⇒ 伺服器 MUST NOT 再驗;bot/直升機/飛彈靠「高度本來就低於最小餘裕」(稽核守門)。⑧飛行夾制兩道取嚴者。⑨取不到地形統計 ⇒ 回 `Infinity` 不設限。**吃建物高度的門檻 MUST 全部 < `objHeightMax()`**(`MASS.MIN_H` 55 / `b.h > 55` / `> 100` / `> 60`)。稽核 `audit_world_height` |
| 世界邊界(環 + 緩衝空間) | `WORLD_EDGE` + `edgeWallInsetM()`/`heroTallestH()`/`edgeWallHM()`/`edgeWallDeepM()`/`edgeBufferM()`;環體 `buildEdgeWall()`(blockers **第一批**)+ `placeBoundary` 帶寬 + `buildRoadBlocks` 內縮 + 散布內縮 `inb`;緩衝 `terrain` 外緣裙 + 對外查詢 `bufferHeightAt`;夾制 `_updatePlayer` 的 x/z | 兩半共用同一條線 `edgeWallInsetM()`:①**障礙環**沿四緣連續實體,內緣恰貼夾制線;②**緩衝空間**把地形往外鋪 `edgeBufferM()`。九條:①「不可越過」是結構保證(`SEG_LAP_F > 1` 互咬 + 四角互相跨過);②環是**權威幾何**(兩端同一有向盒;`ry` 只取 0 / π/2);③MUST 排 `blockers` **最前面**(occ 上傳是 `slice(0, LOS.MAX_OCC)`);④環高**下界**由最高機體全高推導(不追飛行天花板,飛行那半權威一律是 x/z 夾制);⑤緩衝深度 = `curveHorizonM()` 推導;⑥裙與地形**逐點水密**(內緣取地形格距 N−1、外帶取 `curveMaxEdgeM()`);⑦裙共用地形材質(不新增第四份 `envMat`),**地形材質的地貌拼圖 = UV 鏡射平鋪**(夾制會把圖界那一排像素往外拉成掃把痕);⑧零共享 `rnd()`;⑨裙的外推高度對外只有 `bufferHeightAt` 一份(緩衝布景/背景/**緩衝空間底毯**靠它落地,拿 `heightAt` 會被夾回圖界);⑩**布景與背景逐零件落地**(2026-08-12 使用者「在斜坡不要懸空」:`emitWallParts` 的選用 `groundY`,水平位置走同一個矩陣求得,MUST NOT 自己寫一份 sin/cos —— A30 那一族的正負號坑;**障礙環刻意不傳**,它的碰撞盒是以段的落地基準量出來的)。裙**純表現層**;「緩衝空間也要貼地貌拼圖」的**底毯**那一半住 `ground.js`(見上方「地貌拼圖的顏色與花紋」)。稽核 `audit_world_edge` |
| 邊界牆型錄 / 緩衝布景 / 視線邊界背景 | `edgewall.js`(`EDGE_WALL`/`WALL_KINDS`/`SLOPE_TIERS`/`wallSlopeTier()`/`wallCandidates()`/`edgeSeed()`/`planWallRuns()`/`wallParts()`/`partBox()`/`wallFit()`/`wallFaceCover()`/`PROP_KINDS`/`propKindFor()`/`propParts()`/`planBufferProps()`/`BACKDROP_KINDS`/`backdropKindFor()`/`backdropParts()`/`planBackdrop()`);建構端 `biomes.js` 的 `buildEdgeWall`/`buildBufferProps`/`buildBackdrop` + 共用發射 `emitWallParts`/`flushPartBatch`(合併走 `beacons.mergeGeos` 唯一縫) | 2026-08-11 使用者定案的 15 款(城牆/連排民房/河堤/海堤/軍工級路障/土石流/懸崖峭壁/山崩地/消波塊/倒塌神木/倒塌摩天樓/倒塌高架橋/停駛的列車/連排大貨車/連排貨輪)。**環的權威幾何一格未動**,改的只有「這一段長什麼樣」。六條:①`edgewall.js` **零 THREE、只 import `rng.js`**(零件是純資料描述子 ⇒ 外廓在 Node 端算得出來,這才是本項離線可驗的原因);②**零共享 `rnd()`**,「隨機更換」一律由座標雜湊餵自己的 `mulberry32`;③**演出 ⊆ 碰撞盒**(`wallFit` 三軸,**縱向尤其** —— 視覺高過盒子的話從上方斜射的彈道會穿過看得見的船樓)+ **內面蓋滿到機體視線高**(`wallFaceCover`);④厚度是**真實公稱尺寸**,內面恆貼夾制線、厚度往圖界方向長,最深的一款 MUST === `edgeWallDeepM()`(`placeBoundary` 的 IN1 吃它);⑤**坡度是硬門檻**(2026-08-11 追加):陡(> `SLOPE.BLOCK_DEG`)只准懸崖峭壁/土石流/山崩地,中(> `EASE_DEG`)再加倒塌神木與城牆,緩才給人造線形物;門檻錨在 `SLOPE` 那兩條線、由呼叫端注入,坡度量**裸地形**;⑥切分只有一條 ——「地貌 / 水陸域 / **坡度級**改變 或 已鋪滿 `RUN_MAX_M`」,短 run MUST 併回去(衛星色逐段抖動 ⇒ 不併就碎成雜訊),併的時候**坡度級取較陡者**,水陸域不同的 run MUST NOT 互相併;⑦**碰撞盒高逐段實測**(不是逐款一個值):城牆逐節抽構造(素牆 9m / 箭樓 12.5m / 砲台 13.8m / **城門 + 城樓** 14m),拿宣告的最高值當每一節的盒高,素牆那幾節的頂上就多出一截撞得到卻看不見的空氣;`def.h` 從此只是**授權上界**。⑧城門 MUST 是**關著的**(邊界上開一個真的洞 = 看得穿卻走不過),城樓 / 砲台 / 箭樓一律只是幾何 —— `buildEdgeWall` 只碰 `group` 與 `blockers`,「不會攻擊」是構造保證不是設定值。⑨緩衝布景與背景是**純表現層**(不進 blockers/occ/LOS),背景高度吃 `objHeightMax()` 同一個天花板。稽核 `audit_world_edge` Ⅲ・Ⅶ・Ⅷ |
| 巨岩表面落點 | `rockProbe(g)`(`wallR`/`slope`/`topAt` 射線實測) | 貼壁與頂面落點一律**實測真幾何**;手寫剖面公式 MUST NOT 復辟 |
| 圓形腳印落底 | `sinkBaseY()` | 「中心 + 腳印周圈取最低」,寧可陷入山坡不懸空;MUST NOT 只取中心高度 |
| 攀爬路線 | `climb.js`(規劃/抓握索引/設施幾何/`attachFaces()`) | 詳見 A31 |
| 可通行性 | `tools/audit_traverse.mjs`(`flood`/`makeSurfaces`/`buildStructs`/`carveRuns`) | 三條會靜默失效的線:①visited 的鍵 MUST 是 **(格, 高度桶)**;②高度桶 MUST 是**固定量化**(MUST NOT ±tol 模糊比對);③換層 MUST 兩端都通天。④**例外 MUST NOT 洗成「跳過」**(程式自己的 ReferenceError 洗成跳過 = 假綠)。取不到路網自動降級成地形層並標示未驗 |

#### F. 表現層 / 畫面

| 領域 | 唯一縫 | 鐵律 / 稽核 |
|---|---|---|
| 賽璐璐明暗階梯 | `toon.js RAMPS` + `toonGradient(bands)` | 2/3/4/soft 四組。**3 階 MUST 逐位元 [102,182,255]**;每組暗階 MUST ≥ 102(A14);`DataTexture` MUST **只在 toon.js** 建構,呼叫端經 `opts.bands` |
| 後製管線 | `postfx.js Pipeline`(勾線 → 景深 → 調色 → FXAA);唯一消費端 `game.pipeline` | 世界描邊只能靠**一個 pass 蓋全場**。①RT 尺寸 MUST 由 `renderer.getDrawingBufferSize()` 取得(否則 `RES_GOV` 變 no-op);②A25:3 RT + depthTexture + `FullScreenQuad` 材質 MUST 全部 dispose;③**FXAA pass 恆執行**(兼任線性→sRGB);④勾線門檻 = 距離項 + 掠射項(缺一則地形折邊與建物輪廓值域重疊) |
| 描邊寬度 | `outlineMaterial` 的螢幕下限與 `invS` / `outlinify` 的 `jobs.push` | **兩個外推量 MUST 同為局部單位**:一邊除過世界縮放而另一邊沒有 ⇒ 實得線寬 ∝ 世界縮放 × 視距、**沒有上界**(主堡 `dome.glb` 795× ⇒ 450m 外推出 530m 黑殼)。位移只在頂點著色器 ⇒ raycast / 包圍盒 / 所有稽核讀數**全部正常**。稽核 `audit_cel_pipeline` Ⅳ + `--break-scale` |
| 世界曲面 | `CURVE`+`curveKneeM()`/`curveHorizonM()`/`curveEyeM()`/`curveR()`/`curveDropM()`/`curveMaxEdgeM()`;GLSL 面 `toon.installWorldCurve()`(改 three 的 `ShaderChunk.common`/`project_vertex`/`ShaderLib.sprite`) | ①曲面**只發生在頂點著色器** ⇒ 座標/朝向/碰撞/彈道/準星/小地圖/伺服器回報一行都沒改(`game.js`/`sim.js`/`biomes.js` MUST NOT 出現 `curveDropM`)。②拐點 = `combatReachM()` ⇒ **打得到的東西恆為零沉降**(「鄰近是平的」是推論不是校準);`KNEE_F = 0` 退回純球面。③地平線 = 起糊那一圈,半徑由它**反解**。④絕對直線類攻擊自動是弦(`heightSegments = 1`),**MUST NOT 為了平滑細分光束幾何**。⑤裝法是改 three 共用 chunk 不是逐材質包裝;錨點是 r160 **原文**,升級 MUST 重新核對、對不上就**整套退平面**;重入守衛戳記掛在 `THREE` 上。⑥自寫 vertexShader 兩個例外:漸層穹頂**刻意不彎**、護盾泡泡 MUST 呼叫同一支 `worldCurve`。⑦弦高容差 = `WATER.SHORE` ⇒ `curveMaxEdgeM()`(現役唯一要補刀的是水面)。稽核 `audit_world_curve` |
| 景深模糊(狙擊模式) | `DOF`+`combatReachM()`+`dofNearM()`/`dofFarM()`/`dofAimBlend()`;`postfx` 的 `_dofMaterial`/`dofTaps`/`setDof`/`setDofBlend`/`_pushDofA` | 三個關法任一成立即**整個 pass 退出鏈**。①轉折點推導,錨在 `combatReachM()` **不是狙擊可視範圍**(可視 216m < 交戰上界 304m);取樣面 MUST 涵蓋塔射程 / 32 角 × 兩槽位 × 四階(× `altRangeMax × RANGE_TOL`)/ 招式施放距離 / 載具最長航程。②錨 MUST NOT 取相機 far。③全糊圈刻意 = 未來距離剔除的邊界。④順序 MUST 排在勾線**之後**。⑤鄰居取樣 MUST 過焦外閘。⑥黃金角螺旋(半徑開根號);取樣數低功耗折半、**展開在 shader 原始碼裡**。⑦最大半徑是螢幕高度的**比例**不是像素。⑧天空刻意不早退。⑨距離只有 `data.js` 一份,**每個 `Pipeline` 消費端都 MUST 呼叫 `setDof`**;強度由 `camera.fov` **反解**(MUST NOT 判 `aiming` 布林、MUST NOT 自己跑淡入),呼叫點恰一處且觀戰滾輪縮放 MUST 排除;`_dofBlend` 預設 1;`uDofA` 唯一寫入點 `_pushDofA`。⑩樣品 MUST 餵自己那一組尺度。稽核 `audit_visual_prefs` Ⅵ |
| 畫面表現旋鈕 | `visualPrefs.js VISUAL_KNOBS`/`visualPref()`/`setVisualPref()`/`onVisualChange()`;消費端 `toon.js`/`postfx.js`/`main.renderVisualSettings`/`matsample.js` | 卡在「需美術方向確認」的項目 MUST NOT 由 commit 定案 ⇒ 做成拉桿 + 即時樣品。①旋鈕表只有一份(拉桿清單由它推導);②**預設值 = 交付定案值**,需美術確認的兩項預設 = 0(逐位元同舊制);③改值 MUST 只動**共享 uniform**(MUST NOT 重建材質);④**樣品 MUST 走真品材質與真品後製管線**。本檔零 import。稽核 `audit_visual_prefs` |
| 陰影偏色 | `SHADOW_HUE`/`shadowTintRGB()` + `RAMP_HOOK` 對 `getGradientIrradiance` 的替換 + `_rampTint.mech`/`.env` 兩軌;權重 `rampFloor()`/`celRampDepth()` | 接在 **ramp 查表**上(吃得到每一盞燈、自動跟著階走)。①偏色 MUST **亮度中性**(色相向量先除自身 Rec.709 亮度)—— 不做正規化就是繞過 A14 的後門;②機體與環境**分兩軌**;③`RAMP_HOOK` 錨點 = `gradientmap_pars_fragment`(**不是** `lights_toon_pars_fragment`),chunk 名只准一份、`#include` 由它推導;落地保險的權重 MUST 取**同一張 ramp 的階值**;④拉桿上限 MUST > 1(`SHADOW_HUE` 是**方向**,亮度中性與上限無關);⑤偏色權重是**「這一階在 ramp 上有多深」不是它有多亮**(以那一組 ramp 自己的暗階為 0 正規化),`bands` MUST 一路傳到 `applyCelPatch`;⑥樣品鍵光 `matsample.SUN_DIR` MUST 讓暗面真的出現(y < 0.5、z < 0),覆寫走 `updateCelLight` 的選用參數、MUST NOT 寫 `_sunDirWorld`。稽核 `audit_visual_prefs` Ⅱ・Ⅴ |
| 地表屬性場 | `field.js makeField()`/`makeToneLadder()`/`bakeFieldTexture()`/`coarseHash()` | ①MUST 是**加權平均**(加總會飽和成常數);②分母下限不可省;③種子由呼叫端給、每橢圓固定 6 枚亂數。**色階門檻 MUST 取該場地自己的分位數**,MUST NOT 手寫固定門檻。`field.js` MUST 維持零 three |
| 風化屬性場 | `bakeFieldTexture()`(純資料)+ `toon.setWeatherField()`/`celWeatherF()` + 安裝端 `terrain.installWeatherField()` | ①MUST NOT 由地形推(高度/離水距離在均勻區域內是常數);②種子 MUST 與地表色階梯錯開;③烤成小貼圖再取樣(貼圖只准在 toon.js 建);④乘數 = `1 + (場−0.5)×2×強度` ⇒ 拉桿歸零逐位元回舊制;⑤苔蘚權重 MUST 夾在 [0,1](`mix` 在 t>1 是外插);⑥設定頁樣品走自己那張場、MUST NOT 呼叫 `setWeatherField`。稽核 `audit_visual_prefs` Ⅲ |
| 軟性物質(細勾線 + 隨風飄揚) | `INK_SOFT_A` + `SOFT_KINDS` + `WIND` + `stepCelWind()`/`celWindTime()`;入口 `toonMat`/`envMat` 的 `soft`;讀取 `postfx` 勾線 pass;消費端 `SOFT_BY_VEG_KEY`/`vegSoftKind()`/`vegSpan()`/`flag()`、`CIVIC_PARTS[].sf`、`makeClouds().step()` | ①**一個旗標管兩件事**(勾線粗細 + 會不會被風吹),MUST NOT 拆成兩份名單;分類由既有 `part.key`/`sf` 推導。②細勾線的通道 = **場景 RT 的 alpha**(契約:`alpha ≡ 勾線門檻倍率`,1 = 硬性);倍率乘進 `smoothstep` 的**輸入**、取「這一格 + 四鄰」**最小值**、排在早退之後。③擺動 MUST 是**純頂點位移**。④權重 MUST 錨在**整株局部座標**;相位取實例原點;世界風向 MUST 轉進局部座標。⑤`span` 推導不手寫。⑥`turf` 刻意 `amp: 0`。⑦雲的勾線是恆等式(深度 = far ⇒ 早退),漂移 MUST 吃同一支 `celWindTime()`、環繞取模 MUST 先加半個 `WRAP`。⑧軟性 MUST 進 `customProgramCacheKey`。稽核 `audit_soft_stroke` |
| 零件級細節抖動 | `xform.js partId()`/`partJitter()`;消費端 `vegPartXform`/`hazards.jitterParts`/`biomes.jitterMegalith` | `jr` 水平半徑**只增不減**;`spin` **只給軸心件**(`px = pz = 0`);MUST NOT 抖 `y`/`px`/`pz`/縱向尺寸;`dj = 0` 恆中性。**演出半徑 MUST 收在權威碰撞柱內** ⇒ 兩個新消費端一律**抖完實測**水平外廓,頂出就把那一件退回原樣。**建物刻意不吃**(碰撞盒就是它自己的足跡)。地標的 `dj` MUST 由**落點**推,MUST NOT 再抽 `rnd()`。稽核 `audit_visual_prefs` Ⅳ + `audit_object_joints` |
| 表現層資源生命週期 | 物件池 `_takeProjectile`/`_dropBullet`、`_freeEffect` → `toon.disposeTree`、`markShared()` | 見 A25。稽核 `audit_gpu_lifecycle` |
| 共用視覺入口 | `spawnCastFx()`/`stepCombatFx()`/`terrain.surfaceAt()` | 戰場與展示台共用,MUST NOT 各寫一套 |

#### G. 世界內容(地物 / 文字 / 地貌)

| 領域 | 唯一縫 | 鐵律 / 稽核 |
|---|---|---|
| 都市計畫(沿街排列 + 公設) | `siteplan.js` §A(`URBAN`/`CIVIC`/`CIVIC_KINDS`/`CIVIC_PARTS`/`CIVIC_TREES`/`plotSeed`/`frac`/`roadFaceRy()`/`planBlocks()`/`civicExtent()`/`partCollider()`/`civicColliders()`/`buildCivic()`) | ①對齊的是**建築線**不是中心線;②排距推導(`urbanRowPitch()`);③**先劃公設用地、再劃建築基地**;④公設是開放空間(草坪/跑道/柏油面 MUST NOT 登記碰撞柱;**長條件 MUST 登記有向盒** → A30);⑤朝向公式只有 `roadFaceRy()`(`nearestRoadAngle` 轉呼);⑥**零共享 `rnd()` 消耗**;⑦市區閘不可省;⑧`URBAN.MAX` 的天花板是 `LOS.MAX_OCC`。稽核 `audit_siteplan` |
| 樹冠羞避(神木森林) | `siteplan.js` §B(`CROWN`/`crownGap()`/`planShyGrove()`)+ 冠幅 `giantCrownR()` | ①冠幅 MUST 推導(掃零件表 35% 樹高以上最遠水平點);②塞不下走**縮冠**不走淘汰(縮到 `FIT_MIN` 以下才放棄);③間隙隨樹高遞增;④抽樣與規則分開(規則本身零亂數);⑤傾斜併進既有 `tx/tz` 剛體通道(A27);⑥改 `CROWN` MUST 回頭看 `placeGiantGroves` 的 `cr`。稽核 `audit_siteplan` Ⅲ |
| 地貌拼圖的顏色與花紋 | 顏色 `CARPET_LOT`+`carpetLotAt()`(選款區塊)/ 花紋 `planCarpetVariants()`+`CARPET_VARIANTS` / 底色 `baseFill()` / 緩衝空間底毯(`buildGroundCover` 內的 `terrain.bufferHeightAt` 區塊)+ 發射核心 `emitFace()`/`face9()` | 2026-08-12 使用者三項:①**同一種地貌裡顏色不准短距離快速變化** —— 選款的**取值點**量化成抖動格點的最近點分割(lot),同一個 lot 內恆同款 ⇒ 至少走過一個 lot 才換色;場的公式一格未動、分區(green/bare/urban/wet/water/alpine)仍逐格由影像/坡度/envCode 定 ⇒ 真實地貌界線沒有被推移;抖動 MUST < 半格(否則最近點落在 3×3 候選之外 = 分割破洞)。②**同顏色的相鄰拼圖畫不同的圖案** —— 變體改逐格挑,硬條件「共邊的同款鄰格恆不同變體」、軟條件連對角也盡量不同(3 變體 × 8 鄰在數學上做不到全異);**底色 MUST 全變體共用**(`baseFill` 不再抖 ±10/255 —— 逐格換變體 = 逐格換顏色就是 ① 的病因,而「**同顏色的**相鄰拼圖」這句話本身就要求同色),故**同款異變體不發交界外溢**(沒有顏色要 cross-fade,發了等於整張圖多鋪兩層半透明底毯)。③**緩衝空間也要貼地貌拼圖** —— 圖界之外那一圈裙照鋪:分區與選款**鏡射回圖內**取(鏡射在圖界上恆等 ⇒ 接縫兩側同款;界外沒有影像也沒有圖資)、格距 `BUF_CELL_F` 倍、高度走 `terrain.bufferHeightAt`(拿 `heightAt` 會被夾回圖界)、**角點抖動 + 交界外溢照走**(粗格 + 硬邊 = 一床方塊拼被),圖界那兩條線上的角點 MUST NOT 抖(與真地形的接縫),外溢走圖內同一支 `planSeamOverlays`;只鋪底毯(界線拼圖/特徵拼圖/3D 細節不進去)、進圖內同一批 buckets ⇒ 一個 draw call 都沒有多、**零共享 `rnd()`**。稽核 `audit_ground_tile` |
| 地質排列(巨石露頭) | `siteplan.js` §C(`ROCKFIELD`/`strikeRad()`/`planRockField()`)+ 接線 `placeMegaliths()` | ①**走向 = 等高線方向**(由地形梯度推導,取樣距 MUST 跨得過地形格;平地回 null);②節理成排 + 相鄰排錯縫,錯縫相位 MUST 以**中央排**為基準(`r % 2` 會讓核心空掉);③同源同相(同一份色相偏移、長軸對齊走向、體格自核心往外遞減)。緊密的界線 = 碰撞柱不互穿(`GAP_M`)。稽核 `audit_siteplan` Ⅳ |
| 聚落場 / 建物來源信任階梯 | `settlement()` + `UC`/`URBAN_DENS_P·Q`/`URBAN_MIN_PEAK` + `infillSeeds` + `classifyImg()`(純影像判,零亂數);消費端恰三個 —— `planBlocks` 的 probe(經 `nearUrban`)、`densifyUrban({ seeds })`、`placeBoundary` 邊界樓型 | 建物有兩個放大器,MUST 同吃 `settlement()`;補間種子 MUST 在 `planBlocks` **之前**定案(否則滾雪球,而圖資越稀疏滾得越兇)。門檻是**局部標準化的比例**(±1 格建物數 ÷ 這張圖自己的 P90),MUST NOT 手寫棵數;退化保險 `URBAN_MIN_PEAK` 推導;`DENS_Q = 0` 逐位元回舊制。**MUST NOT 改吃 `venue.mix`**(那是手寫宣告不是圖資)。信任階梯 = 圖資密度 > 純影像 `classifyImg` > 手寫 `mix`(只當全離線備援):㋐邊界樓市區判定 MUST 過 `settlement`,不背書就**降格不留缺口**;㋑備援程序街區只在圖資**查詢失敗**且宣告有市區成分時觸發(查詢成功但零建物 = 荒野 MUST 維持荒野);㋒市區種子影像在手只收純影像判。稽核 `audit_siteplan` Ⅴ・Ⅵ・Ⅶ |
| 場地地貌宣告 vs 圖資實測 | 宣告 `VENUES[].mix`/`.type`(**手寫**)/ 實測 `tools/audit_venue_biome.mjs` + `landcoverFor()` | `mix` 是手寫宣告(與 `scen`/`relief`「MUST 由實測產生」相反),消費端只有 `classify()` 與 `placeBoundary()`,**建物一格都不吃它**。稽核把①地被組成 ②建蔽率兩件**互相獨立**的事並列,刻意不合併;`TOL` 是判斷值(挑出該看的圖,不是判死)。取不到圖資 MUST 標**未驗**。**2026-08-11 使用者裁決「保持 `mix`,承認它是美術宣告」**,連帶三條:①面積 MUST 裁到 L1 方框內(`clipToBBox`)—— `out geom` 回整條 way,不裁的話一塊 3.4 倍於方框的鎮級 landuse 就能量出 urban 99%,而**數字看起來完全正常**;②可信軸只有 `water` 與 green+bare 合併的「未開發地」(`JUDGED_AXES`),`urban` 的 landcover 佔比**兩個方向都不可信** ⇒ 退出比對、「是不是市區」只由建蔽率雙向判,`wet` 不判;③已裁決落差住 `ACCEPTED` 名冊,赦免的是**種類**不是場地(整場地放行 = 橡皮圖章,同一張圖冒出新種類 MUST 照樣紅),每筆 MUST 有理由 |
| 語意化地標 | `beacons.js`(`BEACON`/`BEACON_KINDS`/`KIND_PARTS`/`partExtent`/`kindExtent`/`beaconAnchors`/`beaconKindFor`/`planBeaconSites`/`beaconSeed`/`buildBeacon`/`beaconCollider`)+ 接線 `placeBeacons()` | 擺在兵線/重生點/建築單位**旁邊**,「會不會擋兵線」由構造保證(落點過 `areaFree(blocked, …, foot + PAD)` 同一道閘)。①錨點推導只有一份(塔位 MUST 吃 `solveTowerSites()` 那一份解、**MUST NOT 用 `TOWER_FRACS` 自己重算**(同 `buildClearance`),序末項 = 前線 ⇒ 整條反序);②**零共享 `rnd()` 消耗**(外觀差異由落點雜湊自帶種子);③碰撞柱是**量出來的**;`foot` MUST 貼零件實算 `kindExtent`(**雙向**釘住);④零件表是純資料且前半段 MUST 維持**零 THREE**;⑤高度隨錨點淨空圈分級,`BEACON.FAR` MUST 大於主堡那一圈;⑥不掛反轉外殼描邊、依材質色合併。呼叫 MUST 排在一般植被之前、巨岩/神木之後。稽核 `audit_beacons` |
| 世界文字(**唯一**的文字圖層) | `worldtext.js`(`resolveName()`/`resolveRef()`/`canRenderText()`/`SignSheet`/`SIGN_STYLES`/`signAspect()`/`packCells()`)+ 接線 `buildWorldSigns()` | ①**沒有名字就不掛牌**(MUST NOT 拿場地名/假名填充);②缺字偵測缺超過兩成整串放棄;③全場文字合併成一個 mesh + 一張 atlas(`SIGN_MAX` 就是額度);④牌面與格子**同一個長寬比**(`signAspect(style)` 推導,長名字一律縮字級);⑤雙面牌 = 兩片背對背單面四邊形,MUST NOT `DoubleSide`;⑥牌面不透明、`rim: 0`;⑦位置與朝向 MUST 取自各構件**已定案的幾何**;⑧構件名牌**零 `rnd()`**,語料庫招牌只准用注入的專屬 seed;⑨裝不下 MUST 記 `signDropped` 明講;⑩語域(前四種 = 構件自己的名字 / 後五種 = 語料庫挑字帶三層文字)。**改 Overpass 查詢 MUST 同步跳 `geoKey('osmF', N)`**。稽核 `audit_world_text` |
| 在地文字語料(招牌上**寫什麼**) | `vernacular.js`(`TEXT_KINDS`/`classifyOsm()`/`harvestOsm()`/`pickName()`/`pickRef()`/`spineOf()`/`SIGN_CLASSES`/`signCopy()`/`textW()`/`LOCALE_LEX`)+ 離線底本 `venueText.js` | 分工:本檔管「寫什麼」、`worldtext.js` 管「怎麼畫」、`biomes.js` 管「掛在哪」。①**零 import**;②取名只有 `pickName` 一份,主名 MUST 保留**在地文字**(`name:en` 只當拉丁副名);③日常副行 MUST 只收**自由文字**欄位(列舉值是 OSM 識別字),取不到留白;④`spineOf` 滑窗 MUST 只在連續 CJK 段內滑、2 與 3 字窗都要、含地物通名的窗丟掉;⑤**一鎮一家**(去重帳全世界一本,合成名與詞表保底一併入帳;連鎖 MUST 只認 `brand`);⑥每次挑字固定 3 枚亂數 + 專屬 seed。**改分類/取名規則 MUST 重跑 `bake_venue_text.mjs`**。稽核 `audit_vernacular` |
| AI 零件庫消費(佈局數學 vs 庫幾何) | `partlib.js PART_LIBS`/`libGeo()`/`libNames()`;解析縫 = `biomes.partGeo`(**只在 build 時**);名冊 `MEGA_LIB`/`BLD_LIB`;入庫閘 `tools/ai3d/intake_parts.mjs`(讀取縫 `parts_src.mjs`) | **佈局數學 MUST 只讀保險絲 `p.g`,MUST NOT 讀庫幾何** —— 庫幾何隨載入成敗而異,佈局讀它 = 跨客戶端分家(§2.3);冠幅、擺動分母、外廓一律吃 `p.g`。零件表每一列 `lib:` MUST 留著保險絲 `g`、`lib:` 的家族 MUST 在 `PART_LIBS` 裡(不在 = 整批永久走保險絲,畫面與今天一樣而**沒有錯誤訊息**);離線工具的節點清單 MUST 由 `libNames()` 推導(手寫的會在名冊擴充時靜默過期),遊戲路徑一律走 `libGeo(具名節點)`。入庫閘兩道:單件 ≤ 該族量測上限、**逐款 Σ 庫零件 ≤ `kind_factor` × 該款現值**(單件合格 ≠ 整株合格)。稽核 `audit_siteplan` Ⅴ + `intake_parts` |
| 建物零件庫(兩個整棟量體桶) | `BLD_LIB`(名冊 / fallback / **剖面**三格)/`bldGeo`/`bldLibN`/**`bldProfile`**/**`profGeo`**/`MASS`/`buildBldBucket` + `massPick`·`fitNode`·`fitScale`·`slabBox`·`bldFace`·`emitMass`·`t.ord`;`tri_budget.json families.building`;`parts_src.mjs bldLibDescs`/`nodeCap`/**`nodeProfile`** | 兩桶(高層 `mass` / 低矮 `masslow`)吃同一個 `facade_wall` 桶 ⇒ **`PICK_N + PICK_N_LOW` 加起來才是 tri_budget 的 `pick_n`**(額外 draw call 上界 16)。資格取自兩個既有判準的**對角線兩格**(另兩格刻意維持方盒)。①`pick_n`/`min_h` 是 biomes 與 tri_budget **同一份**值;②挑選是純函式(零 rnd、等高以座標定序)且**與「庫載到了沒」解耦**(A46 ②);③名冊剖面缺席或拉伸過頭 ⇒ 該棟不換 ⇒ 逐位元同舊制(保險絲**逐桶各自成立**);④碰撞/LOS **改吃剖面**(A46;仍是 A30 的有向盒,只是一顆變一疊);⑤色抖吃拆桶前的原始序 `t.ord`;⑦挑中的那幾棟屋頂上的純視覺附件推丟棄桶,但**帶碰撞柱的兩件 MUST NOT 進**(牆面招牌自 2026-08-12 起改吃剖面側面,不再丟棄);⑧**層高 = 件高 ÷ 列數**,列數由 `facadeRows(h, commercial)` 推導(唯一縫,三桶同吃)——規則是「先落在 `[STOREY.MIN, MAX]` 帶內、再取**對數距離**最近目標者」,**逐件不是逐棟**(庫節點那一列的 `t.h` 是縮放係數 ⇒ 列數 MUST 吃另存的真樓高 `t.bh`),級距是 draw call 旋鈕(級距比 MUST < 帶寬比、款綁在級距帶上),`facadeTexH(rows)` 每層固定 24 texel;`FACADE_PX` 的欄位刻意叫 `H_MIN`/`H_MAX`(避免與 `MASS.MIN_H` 撞名);⑨**窗佔比 `win: [寬, 高]` 逐款不同**、`glass` 是一種立面不是一組參數(A46 ⑤)。**UV 契約三條**:㋐有 UV(盒投影)㋑**方向** —— 牆面 v 隨高度遞增(glTF 原點左上 + `CanvasTexture.flipY` ⇒ 匯出端 MUST 在 `normalize_parts` 補償,否則立面上下顛倒)㋒**三條帶**(2026-08-12 由兩帶擴充) —— 庫節點只有一個材質群組 ⇒ 區分 MUST 移進 UV(`--uvbands`);`MASS.UVB` 的六個數字只有一份且 = tri_budget,`MINZ` = 牆與屋頂尖峰之間空檔的中點(**MUST NOT 沿用盒投影主導軸**),屋頂圖樣 MUST NOT 假設坡向。**每桶名冊 MUST ≥2 顆**;離線工具的節點清單 MUST 由 `partlib.libNames()` 推導、節點前綴 MUST 是 `building/mass`(**無底線**)。稽核 `audit_siteplan` Ⅴ + `intake_parts` |
| 整棟量體節點的輪廓剖面 | 量測 `parts_src.nodeProfile()`;宣告 `BLD_LIB` 第三格(**純資料**);解析 `bldProfile()`;消費 碰撞柱 `cols` / 保險絲幾何 `profGeo()` / 尺寸 `fitNode()`·`fitScale()` / 招牌 `slabBox()`·`bldFace()`·`buildWorldSigns ④` | 2026-08-12 使用者「物理碰撞應該要與建模的 3D 外表一致」「招牌會懸空」「調整目標物件到適合的大小」三條的共同縫。一疊有向盒(A30 只認有向盒與圓柱 ⇒ 三端一行都不用改),逐段取**最大**半跨(盒恆包住網格)。詳見 A46;稽核 `audit_siteplan` Ⅴ ±`--break-prof`/`--break-fill`/`--break-glass` + `intake_parts` |
| img→3D 自動入庫與撤下 | 配方 `intake_recipes.mjs`(`rosterSlots()`/`nextNodeName()`/`normalizeArgs()`/`fitWithinEnvelope()`)+ 第 ⑦⑧ 站 `auto_intake.mjs`(`appendRoster`/`verifyRoster`/`snapshot`/`restore`/`gapsClean`/`dropNode`)+ 第 ⑨ 站 `apply_verdicts.mjs`(`removeRoster`)+ 黑名單 `screen_mattes.py --purge`;判決字彙 `parts_review/review.js STATUS` | 2026-08-10 使用者定案「先全部自動化,人眼再審查,決定要刪除原始照片或調整參數重新處理」+「刪照片連節點一起撤下」。①**只准追加到既有輪替名冊**(可追加的格 = 值是陣列的那些,**推導不手寫**;開新格要寫 fallback 描述子 = 降級幾何 + 離線外廓上界 + 縮放目標三合一,那是設計);②**紅字回滾 MUST 逐位元**(GLB / `biomes.js` / 來源帳三份一起,且快照 MUST 記「本來不存在」的檔,否則回滾留下一支孤兒 GLB 而稽核全綠);③名冊讀寫走 **raw 位元組**(`readSrc` 正規化成 LF,拿它寫回去 = 整支 `biomes.js` 換行全改);④節點序號**填洞**不用 `names.length`(撞名在 `--base` 那側是取代語意 = 服役中的節點被無聲換掉);⑤**黑名單一份兩端同吃**:`purge` 的條目 MUST 留著且 `ok` 維持 true(改 false 會掉出 `fetch_photos` 的 `seen` ⇒ 下一輪重新下載),淘汰以 `screen={v:'reject',why:'human'}` 表達;⑥**兩站都不 commit** —— 「沒 commit 就是還沒出貨」是人眼那道閘的本錢;⑦沒有投料帳 `.feed.json` 就不入庫(規則 9);⑧撤到名冊剩 1 顆 MUST 停下來要 `--force`。稽核 `audit_auto_intake` |
| 採集迴圈的啟停 + 圖檔三態 | 啟停 `dev_supervisor.mjs`(`TOOLS[].kind` server/job + `argvOf()` + `alive()`)、掛載點 `server.js` 的 `/dev/tools` 與 `parts_review.mjs` 的同一支 `handle`;資料家 `provenance.corpusHomes()`/`corpusHome()`;三態 `photo_state.mjs`(`STATES`/`photoStates()`);面板 `parts_review/review.js` 的 `loadHarvest`/`renderHarvest` | 2026-08-10 使用者需求「設定腳本可以在零件台執行/關閉,會自動判斷圖檔未處理/已處理/需修正」。①**閘門只有一份**:全專案唯一「HTTP → spawn」的三道閘(loopback / 參數零信任 / `x-dev-tools` 標頭)住 `dev_supervisor.handle`,兩個掛載點 MUST 都轉呼它,MUST NOT 自己 `spawn`;②**存活判準依 kind 分流** —— `job` 不聽任何埠,拿 `listening()` 問它會**永遠回沒開**(鈕面停在「▶ 啟動」而每按一次多開一支,兩支同時寫 `harvest_state.json`);job MUST NOT 宣告 `port`/回 `url`;③**資料家推導不寫死**(語料家會搬),候選按帳本筆數排序取最多者(實測 415 vs 81,取第一個有一半機率挑到小的那份),挑中的那一個 MUST 顯示出來;④三態全部由**既有四本帳**推導,MUST NOT 開第五本;分支順序 = `需修正 > 已淘汰 > 已處理 > 未處理`(順序即語意);⑤**「已淘汰」MUST 獨立成一態**(併進已處理 = 面板看起來都做完了,而那是一堆垃圾);⑥「送過生成但沒出貨」是**已處理**不是需修正(可用率 ~1/15 是本質,亮紅燈只是雜訊);⑦頁面只負責畫。**⑧「原版 vs 生成」只准並排同源的新舊版本**(2026-08-10):`baseline-vs-now`(同一份零件表改寫前/後)才是新舊版本;img→3D 的 `glb` 那一路 MUST 單獨陳列 + **標注繪製方法** —— 保險絲 primitive 是載入失敗時的降級幾何,**不是它的前一版**(並排會讀成「AI 版 vs 原版」,而那個原版從來沒出貨過)。保險絲群組仍建但只當「換掉的是哪幾顆 mesh」的取景索引(定位 ≠ 比對),且「零件」取景的條件 MUST 是 `!!view.node` 而非 mode(綁 mode 會讓那顆鈕整批變灰而理由是假的)。⑨語料圖進清單是**內容切換**不是併進節點清單(415 張會把 52 件生成物淹掉);細節頁 MUST 同時顯示母照片與**每一個目標**(目標才是餵進生成器的那張),`entry.matte` 是 bbox 物件**不是路徑**(當路徑用會安靜退回原圖)。⑩手動篩選三個出口只准轉呼 `screen_mattes.py`(`--human pass/reject` / `--purge`),id 與 family MUST 從帳本取、MUST 帶 `x-dev-tools`。⑪`--photos`/`--home` **明指**的資料家排在筆數排序之前。**⑫「跑起來了嗎」MUST 是伺服器推導的一欄 `on`**(2026-08-11 修):存活判準依 kind 分流已經住 `statusOf`,而**客戶端自己挑欄位**就是同一條規則的第二份 —— `main.js` 設定頁對 job 讀了 `listening`(job 刻意不回)⇒ 恆 undefined:鈕面永遠停在「▶ 啟動」、網址欄永遠寫「未啟動」、按下去每次都送 start 而背景其實跑著,使用者看到的就是**「點啟動沒反應」**。兩個客戶端(設定頁 / 零件台窄帶)MUST 都只讀 `on`。**⑬執行進度看得見**:job 是一支跑十幾分鐘、十幾站的背景工作 ⇒ 全量日誌走唯讀端點 `GET /dev/tools/<key>/log`,面板攤開「完整命令列 + 逐站進度 + 上一次啟動的結果」;`lastRun` 與日誌 MUST **停掉之後仍留著**(`stop` MUST NOT `running.delete` —— 停下來才是最想回頭看的時候),而「還是不是我們的」判準改走 `alive()`(伺服器收埠比行程退出快,只看 `exitCode` 會讓第二次停止再 kill 一次);`spawn` MUST 掛 `error` 監聽(沒接 = 未捕捉例外把整支伺服器帶走);日誌 MUST 脫掉 ANSI 色碼(轉呼的 python 會印,HTML 看不懂)。**⑭儲存庫外的資料家由註冊縫帶進候選**(2026-08-11 使用者:「版權問題不在專案的管線也要顯示在零件台」)—— `extraHomes()` 讀 `corpus_homes.json`(gitignore)與 `SVS_PHOTO_HOMES`;**出貨那道閘一格未動**(`corpus.json` 的 `shipping` 仍決定進不進第 ⑦⑧ 站),而「不會被誤拿去出貨」的構造保證從「推導不到」搬到 **`corpusHome()` 的預設挑選只挑出貨家**:要跑非出貨那一份 MUST 明講。指名的方式 MUST 是**索引**(`POST /dev/tools/<key>/start/<i>` 與 `/api/photos?home=<i>`,路由只收數字)—— 收路徑字串等於把「請求只能挑一個 key」鬆成「請求可以指定任意目錄」;面板記的是**路徑**、逐清單各查一次索引(零件台帶 `--photos` 時兩份候選清單不等長,共用一個數字 = 挑了 A 卻跑 B),而挑錯 MUST 回錯誤,MUST NOT 退回預設。稽核 `audit_auto_intake` Ⅸ + `audit_net_modes` ⑦ |
| 人眼判決字彙 / 封存區 | `parts_review/review.js STATUS`(唯一真相)+ `apply_verdicts.mjs` 五個分支 + 墓碑帳 `provenance.ARCHIVE_PATH`/`loadArchive()`/`archivedPhotoIds()` | 2026-08-11 使用者需求「加入移除鍵,移除遊戲與零件台,放到封存區」。①判決字彙只有 `STATUS` 一份,「有意見」MUST 由它推導(手寫清單會在加第六個出口時靜默過期);②`⊘ archive` 與 `⟳ regen`/`⇄ reimg` 的差別是**下一步在誰身上** —— 那兩個是「再試一次」⇒ 照片回待跑池,移除是「結案」⇒ 撤出遊戲、**來源帳整列搬進墓碑帳**、照片一格不動;③**撤完之後來源帳那一列就沒了** ⇒ 不搬進墓碑帳的話「它存在過、吃過哪張圖、為什麼被移除」整組消失,而台上看起來像它從來沒出現過(封存**不是**缺口,MUST 與缺件/孤兒/未記載分開列);④網格不留(GLB 節點真的 `--drop` 掉了),留得住的是配方 + 來源圖 —— 存一份 GLB 拷貝會變成第二個載得到的節點;⑤「不再自動重跑」MUST 由 `photo_state` 把封存帳算成「人眼已處置」達成,**MUST NOT** 在 `apply_verdicts` 順手改語料帳本(判決紀律只有 `screen_mattes.py` 一份);⑥`/api/img` MUST 同時問來源帳與墓碑帳(只問前者的話封存頁的來源圖整批變成「原圖不在本機」)。稽核 `audit_auto_intake` Ⅷ・Ⅺ |
| 來源帳的鍵 | `provenance.partKeys()` | 一列帳 `key:`(單顆)與 `keys: []`(一組同源節點)**兩種寫法都合法** ⇒ 正規化只准這一份。2026-08-11 實測:`apply_verdicts` 只讀 `keys` ⇒ 以 `key:` 寫的那些列(現役 `mass_a`/`mass_b`/`mass_c`/`chimney_a`…)在撤節點時**整列查不到** —— GLB 與名冊撤了、來源帳留著,而且「這顆吃哪張圖」是空集合 ⇒ 判 ⇄/✕ 只印「(0 張)」、下一輪照樣把同一張圖抓回來重跑;`photo_state` 同一個坑會讓出貨過的圖顯示成「送過生成、沒有出貨」並被算成未覆核。稽核 `audit_auto_intake` Ⅺ |
| 採集迴圈的重跑順位 | `harvest_loop.pendingMattes()`(`--no-redo` 退回舊行為)+ `photo_state` 的 `reviewed` | 2026-08-11 使用者定案「採集迴圈預設未覆核的全重跑(**順位在後面**)」。①**新圖排前面、重跑接在後面**(額度先給沒試過的);②「覆核過了沒有」MUST 走 `photo_state` 那一份推導(節點覆核意見 / 封存帳 / 已淘汰;**選片閘的 `--human pass` 刻意不算** —— 那是對照片的判決不是對產出的),迴圈自己判 = 面板與迴圈說出兩套話;③已出貨的仍由 `shipped` 那道閘擋著(等人覆核,不是等重跑);④重跑取**最早餵過的優先**(不排序 ⇒ 每一輪都重跑同樣那十幾張,因為它們每輪都變成「最新餵過的」);⑤**同一張圖 + 同一組參數 = 同一顆網格**(工具是決定性的)⇒ 重跑的價值在**下游整條管線一直在動**,要換一顆網格仍得走 `⟳ 重生` 寫 `intake_overrides.json`。稽核 `audit_auto_intake` Ⅺ |
| 鏡像貼補(img→3D 的「另一面是空的」) | `normalize_parts.py` 的 `--rework`/`--mirror`/`_weld`/`_shade`/`_topo`/`_warp`/`_ext`/`_restore_ext`/`MIRROR_MIN_F`・`mesh_sym.mjs`(含 `EMPTY_ASYM`)・`node_sheet.mjs` | ⚠ **改制待執行**:2026-08-09 使用者再定案「只補有洞的,洞很小的話直接貼平,不需要用對稱法補」——觸發條件從「半空間不對稱」改成「真的有洞」、小洞改平面貼補;規格與回退清單見 `docs/ai3d_runbook.md` §5aj-C。**動這一族之前 MUST 先看 §5aj-C**。現行出貨行為:①尺 = 半空間表面積不對稱;②門檻錨在使用者判定過的那一顆,MUST NOT 退回逐顆手挑名冊;③刀落在**已出貨的節點**(`--rework`),外廓與面數逐位元不動;④**先焊頂點再動刀**,焊完 MUST 依原拆分比還原著色;⑤兩把刀依主體是不是人造的選(`half` / `union`);⑥**三道閘 MUST 排在減面之前**;⑦`warp` 位移 MUST 只是**位置**的函數(MUST NOT 沿頂點法線),有破口的節點 MUST warp 0;⑧`solidify_parts.py` 端 MUST NOT 復辟鏡射 |
| 角色 / 機體檔案格式 | **格式** `codex.js`(`SECTIONS`/`PROTO_LAYERS`/`GEN_FIELDS`/`CODEX_FIELDS`/`VIS_WORDS`/`HAIR_WORD`/`FORM_POSE`/`formPose()`/`SHOT_POSES`/`shotFraming()`/`visualUses()`/`protoLayers()`/`charCodex()`/`mechaCodex()`/`textSeed()`/`imagePrompt()`/`modelSheet()`/`codexIssues()`)・**內容** `lore.js`/`mecha.js`;唯一顯示端 `main.protoHTML()` | ①格式與內容分家;②對齊是**結構性**的(同一張 `SECTIONS` + 同一張 `GEN_FIELDS`,`codexIssues()` 逐欄比對鍵集**逐位元相同**);③機體原型是結構化的**層**且層集由 `visual` **推導**(變形者恆兩層,每層 `{src, note}`);④值一律到原處取(`heroTargetH()`/`data.js`/`charKind()`);⑤三份對外生成文字(`textSeed`/`imagePrompt`/`modelSheet`)只由 `codex.js` 組裝;⑥`mecha.js` **零 import**、`codex.js` 只 import 三支純資料檔;⑦`tag` 是**名詞短語**;⑧`FORM_POSE`/`SHOT_POSES`/`visualUses` 三個新縫(`SHOT_POSES` 與型態**正交**,由 `shotFraming` 合成;`static` MUST NOT 宣告 framing 覆寫;`moving`/`heavy` framing MUST 逐 medium 分開;飛行取景 MUST NOT 留 `standing`;關鍵詞串只帶該型那一層原型、長敘述兩層都送;設計錨 `refShotOf` 分兩級且**被判退的那張永遠不當錨**);⑨離線 2D 生圖管線走 `protoOf`,**已退場的 `lore.proto` MUST NOT 復辟**。規格書 `docs/codex_format.md`;稽核 `audit_codex` |

#### H. HUD / 輸入 / UI / 連線

| 領域 | 唯一縫 | 鐵律 / 稽核 |
|---|---|---|
| 連線機制 | `netmode.js`(模式/網址/`wsUrl()`)+ `net.js makeNet()` | `main.js` MUST NOT 自己 `new Net()`/看 `location.host`/寫單機文案分支;鈕面真相 = `LINK_MODES` |
| 路網中繼(全房共用同一份圖資) | payload `osmrelay.js`(`OSM_RELAY`/`osmRelayKey()`/`sanitizeOsmRelay()`/`osmRelayFit()`)+ 客戶端定案表 `biomes.commitOsmIn()`/`osmInOf()`/`osmInReady()`/`resetOsmMisses()`(兩支 fetcher 的早退)+ 時序 `main.osmGate()`/`onOsmRelay()` + 伺服器 `rooms.js` 的 `t:'osm'` 分支與 `osmPayload()` | 房主抓一次 Overpass → 伺服器轉給全房。**這修的是既有的跨客戶端分家**(`startPrebuild` 每台各跑一次,A 抓到而 B 被限流 ⇒ 兩人的橋隧/建物/碰撞柱/街廓朝向全不一樣,而且沒有錯誤訊息)。八條:①淨化只有一份、兩端同吃且 MUST **冪等**,房主 MUST 吃**送出去的那一份**(`DP = 7` = OSM 原生精度 ⇒ 對真圖資是恆等,中繼與備援建同一張圖);②`osmrelay.js` MUST 零 import、**零模組級可變狀態**;③伺服器只受理房主、存的 MUST 是淨化產生的**新物件**、逐格**單調**;④中繼 MUST NOT 帶座標框、MUST NOT 塞進 `sync`;⑤客戶端早退 MUST 排在 `geoGet` **之前**,且中繼資料 MUST NOT 寫回 geocache;⑥入房者等不到 MUST 退回自己抓,等待 MUST 與地形建構**並行**;⑦定案表逐格三態(`undefined` 未定案 / `null` 查過沒有 / 資料),補抓成功 MUST `resetOsmMisses()`;⑧送出前 MUST 經 `osmRelayFit`。稽核 `audit_osm_relay` |
| 區網同時多路徑 | `server.js` 的 `demux`/單埠雙協定・`ensureCert`/`sanNames`/`certSan`・`ADDR_WATCH_MS`・`noServer` + `handleUpgrade` | 三條會靜默壞掉的線:①`demux` MUST 全程停在 paused(`read(1)` + `unshift`),**MUST NOT** `once('data')` + `resume()`;②`WebSocketServer` MUST 只有**一個**實例;③憑證 SAN MUST **取聯集**。沒開 TLS MUST 維持 http 伺服器自己 listen。稽核 `audit_net_modes` ⑥ |
| 操作方式(輸入裝置) | `ctrlmode.js`(`CTRL_MODES`/`ctrlMode()`/`ctrlPref()`/`setRoomCtrlMode()`/`ctrlScheme()`/`deviceScheme()`)+ `mobile.renderCtrlModeRow()`/`renderCtrlSettings()` | 三選一是**房間設定,由房主選擇**:值住 `room.config.ctrl`,客戶端 `_room` **唯一寫入路徑 = `sync` 廣播**(房主按下只准上行)。生效值合流只有 `ctrlMode()` 一處。`setCtrlScheme` 只受理「不限定」。裝置判定只有 `deviceScheme()`(`isTouchUI()` 轉呼);搖桿層建/毀只住 `_applyCtrlScheme`;`main.TOUCH_UI` MUST 是**函式**。稽核 `audit_ctrl_mode` |
| 戰場選單開關(ESC / ☰) | `game._escMenu()` | **遊戲中隨時都可以 ESC**:三個來源(keydown / `_onPlc` / 觸控 ☰)MUST 全走這一支,MUST NOT 在任一端另判狀態。只有兩條規則:商店開著先收商店、其餘一律切換;唯一不受理的是 `_gameOver`。`_onPlc` **MUST NOT 用 `dead` 當門檻**(陣亡過場那次 `exitPointerLock` 改以 `_plcSelf` 戳記略過,且只在真的鎖著時打);ESC 的 keydown MUST 排在 `paused` 早退**之前**;兩條路的重入由 `ESC_GAP_S` 擋 |
| 視野鎖定 | `VIEW_LOCK`/`viewLockStep()` + `game._tickViewLock()`/`_coneAcquire()`/`_entAimPoint()` | 觸控 ZR 按一次 = 輪流切換下一個敵人、按住 = 收斂。取景 = **玩家真的看得見的那一塊**(一般 = 畫面矩形 / 狙擊 = `SCOPE`/`scopeRvmin()` 鏡圈正圓,半徑與 CSS `--scope-r` 同一份)。名冊排序 MUST 是**畫面由左至右**;錨點 `_vlockPrev` MUST **跨放開保留**。純客戶端視角輔助;每幀轉角只准經 `viewLockStep`、套用只准經 `_applyLook`。**後座力刻意不抵銷**。稽核 `audit_view_lock` |
| 觀戰相機 | `SPEC_CAM`(`VIEWS`/`NAMES`/係數)+ `specViewNext()`/`camSmoothF()`/`camAngleStep()`/`wrapPi()`/`specViewLocked()`;消費端 `_updateSpectator()`/`_specSetView()`/`_specCycleView()`/`_specFollow()`/`_specHud()` | 四態循環,序只有 `SPEC_CAM.VIEWS` 一份。「運鏡不晃」的本錢在 `camSmoothF` 的**幀率無關性** + `camAngleStep` 最短路徑 + 超過 `SNAP_M` 直接貼上。**只有第一人稱藏機體**;第三人稱距離/注視點以 `heroTargetH` 為尺。**第一人稱與第三人稱跟隨 MUST 剛體貼合機體**(`LOCK_VIEWS`;機體位置已由 `_updateEnts` 插值,再套 `POS_K` = 雙重平滑),第三人稱**自由**刻意維持平滑。玩家資訊面板與交戰共用同一塊 `.hud-self`,欄位一律照抄快照(伺服器 `_serializeEnt` 的 `o.act` 本來就發;算不出來的一律回 null 顯示「—」,MUST NOT 拿本地值假裝),八軌軌名吃 `ECON.UPGRADES` 同一份表。觀戰操作說明常駐(文字唯一真相 `help.SPEC_CONTROLS`,CSS MUST 給 `max-height`)。稽核 `audit_spectator_cam` |
| 商店掃貨 / 預約 | `_sweepPick()`/`_sweepBuy()`/`_toggleReserve()`/`_tickReserve()` + `_shopState()` 的 `sweep`·`toggleReserve`·`sweepable`;UI `renderShop` + `#shopSweepBtn` | **純客戶端排程 = 替玩家按下那顆按鈕**,每筆仍走 `_optimisticBuy`(伺服器逐筆複驗)。①「買不買得起」只有 `_sweepPick` 一份,鈕面吃 `sweepable`;②掃貨**貪心便宜優先**;③掃貨**只作用於八軌**(兵線升級走預約),鍵格式只有 `RES_CREEP`/`_creepResKey`/`_resCreepLane` 一份(UI 拿 `creepKey(lane)` 當不透明字串),解鎖門檻只有 `_upgAllMax()` 一份,**同一輪餘額 MUST 自己記帳**(`pend`);④預約**同一階只送一次**(`_resSent`),`RESERVE_RESEND_S` 是救濟閥;⑤`_tickReserve` MUST 排在商店重繪簽章之前且 MUST NOT 關在 `if (shopOpen)` 裡。稽核 `audit_shop_auto` |
| 受擊濺血提示 | `BLOOD` + `bloodDur()`/`bloodAlpha()`/`bloodFrac()`/`bloodDropR()`/`bloodDropN()`/`bloodScreenUv()`;方位來源 `sim._hurtLog()`/`_flushHurt()`;消費端 `_bloodSplat()`/`_updateBlood()`/`_clearBlood()` | 純表現層但**方位 MUST 來自伺服器**(客戶端只有血量落差,自己猜必定與伺服器分家)。伺服器於 `_damage` **兩條路徑**記帳、同 tick 同攻擊者併一筆;flush 點**只有 `_frame()`** 且 MUST 排在取走 `events` 之前;只記主視野機。高程只在攻擊者也是英雄且有 `ay` 時附上(否則退回水平方位)。血滴大小吃**傷害佔自機總量的比例**;螢幕座標夾在 `[EDGE, 1−EDGE]`;半視角吃**當下鏡頭**。位置與圖樣**建立時烤死**;`.blood-splat` MUST NOT 掛 CSS transition;陣亡/換座機 MUST `_clearBlood()`。稽核 `audit_blood_splat` |
| 異常狀態致盲白幕 | `CC_FLASH` + `ccFlashAlpha()`/`ccFlashDur()`;觸發 `_blindFlash()` | 光學/電子系狀態(emp/conf/stun)**上升沿**觸發,白幕長度固定(MUST NOT 隨剩餘秒數延長);強度表 MUST NOT 收物理系;`.cc-flash` MUST NOT 掛 CSS transition/animation |
| 蓄力跳水平移速 | `CJUMP.AIR_SPD_F` | 兩個消費端 MUST 同吃(起跳彈射初速 + 騰空操縱移速);垂直項 MUST NOT 吃 |
| GUI 說明 / 懸浮提示 | `tip.js`(`installTips()`/`tipHTML()`/`attachTip()` + 單一氣泡)+ `help.js UI_TIPS` + `uiTip()` | 常駐說明一律改 ⓘ 懸浮提示並彙整到說明分頁;說明分頁「介面」類由 `UI_TIPS` **推導**;`index.html` 只准寫 `data-tipkey`。MUST NOT 退回 `title=`(觸控無 hover)、MUST NOT 另寫第二套氣泡、MUST NOT 逐節點綁事件(一律 document 委派);觸控一律**長按**才出提示(短按 MUST 原樣放行) |
| 分段按鈕樣式 | `style.css` `.seg` > `.segb`(+`.seg-lg`/`.seg-sm`) | 凡「一組互斥選項」一律掛這一套;消費端 MUST 只掛 class(MUST NOT 自寫 padding 與選取態配色);電腦難度 MUST NOT 退回 `<select>`。`.btn` 家族刻意不併入(那是動作不是選項) |
| NPC / 建築 / 機種圖示 | `npcicon.js NPC_ICONS`/`npcIconHTML()`/`KIND_ICONS`/`kindIconHTML()`;頭像角標 `main.charAvatarHTML()` | 平塗 24×24 SVG 吃 `currentColor`;名冊真相仍是 `UNITS`/`THIRD.COMP`/`CHARACTERS[].kind`(取值走 `charKind()`),缺鍵回退問號圖。MUST NOT 改成 3D 截圖資產。四處頭像 MUST 全走 `charAvatarHTML()` |
| 決定性亂數 | `rng.js mulberry32()` | 全專案唯一縫(`hazards.js` re-export 舊入口)。該檔**零 import** |

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

## 3. 絕對反模式(A 編號恆定,供跨檔引用)

> 編號被 `siteplan.js`/`prompt.mjs`/`sim.js`/各稽核的註解交叉引用 ⇒ **MUST NOT 重新編號**。A38 曾被兩個條目共用(場址配置 + 導引彈追蹤),2026-08-10 把**未被任何檔案引用**的那一條移到 A41 解決衝突。

| # | 禁令 |
|---|---|
| A1 | 客戶端 MUST NOT 先改權威狀態;防作弊邏輯 MUST NOT 下放(= 原則 1) |
| A2 | MUST NOT 新增 npm 依賴 / build 工具 / TypeScript / 框架 |
| A3 | MUST NOT 修改 `reference/` |
| A4 | 確定性散布路徑 MUST NOT 用 `Math.random()` |
| A5 | 重武器 CD 唯一實作 = `mag:1 + reload=cd`,MUST NOT 另發明第二套 |
| A6 | 射擊 raycast 只打單位;地形走解析射線 `terrain.rayTerrain()`、建物/巨物走解析圓柱/盒(`_blockerHitT`)。MUST NOT 把 `terrain.mesh`/植被/建物 InstancedMesh 加進 raycast 目標(three 逐面線性掃 = 開火掉幀主因);MUST NOT 讓砲火穿越碰撞障礙 |
| A6b | **塗層雙面阻擋**:把上下空間隔開的實體面(地形高度場/橋面/隧道**頂板**與**路面**/障礙頂面底面)MUST 不分方向截斷砲火,**透明可穿透處例外**;能擋砲火的那一面同時 MUST 是站立面(只做一半 = 打不穿卻踩得穿)。兩條:①MUST NOT 用 `y <= heightAt(x,z)` 當彈道閘(那問「在地表以下」不是「穿過地表」),一律走 `_terrainSegT`→`_terrainHitT`;②障礙垂直判定 MUST 是「穿越區間 ∩ 垂直帶」,MUST NOT 只驗入點高度或加掛 `dy < 0`。爆點回報的離地基準在洞內改取隧道路面,但 `lev` **刻意只報 0/2**(橋面報 1 會讓塔對 AoE 免傷)。稽核 `audit_layer_block` |
| A7 | 飛彈失鎖(離開發射源射程 → 直線飛行)只適用**雷射導引**(`guide`)與塔 SAM,兩端共用。**射後不理(`fnf`)刻意不吃**:射程只管**能不能鎖定**,鎖上之後彈道包絡整條讓位給追擊燃料 `chaseCapS`(推導,MUST NOT 拿它當射程替身)。伺服器落點閘門因此**追加**一條綁鎖定目標的放行(`chased`),MUST NOT 放寬成「有鎖定就隨便一個遠點都收」。**這是加分題不是替代題**:沒炸在鎖定目標身上 MUST 退回一般 `impCap` 閘門照常結算(中途撞小兵/建物就地引爆也要有傷害),MUST NOT 退回舊制的 `if (lockT) … else`。射手與僚機吃同一個 `chased`。稽核 `audit_weapon_gate` Ⅸ |
| A8 | FOV 全機種一律 68(zoom 35);MUST NOT 用 FOV 做差異化 |
| A9 | 客戶端 `wstate` 彈藥與伺服器小幅漂移 by design(miss 不回報);MUST NOT「修正」 |
| A10 | 迷霧 = 伺服器快照過濾;客戶端 MUST NOT 二次遮蔽 |
| A11 | 爆風 `_blast` 刻意不吃 LOS(繞射近似)**也不吃射程**(射程只限制擴散中心點)—— `_blast` 內 MUST NOT 出現任何 `def.range`/`RANGE_TOL`/`_altRange` 閘門。與「沒有光暈就不該掉血」不衝突:光暈的語意是「我能不能**瞄準**」,而濺射從來不是瞄準出來的。兩者皆 MUST NOT「補完」 |
| A12 | `[#INC-103]` 無人機重生 `deadTick` 跨 tick 守衛 MUST NOT 移除 |
| A13 | `[#INC-105]` 中立 ents(`side:null`):`_acquireTarget`/`_acquire`/tick 主迴圈三處 MUST skip neutral,否則 `UNITS[kind]` undefined 直接炸 |
| A14 | `[#INC-106]` toon 三階 ramp 暗部 MUST NOT 低於 102;材質一律走 `toon.js mat()` |
| A15 | `[#INC-109]` 直升機 creep 刻意未接塔 SAM(以 pid 查找,heli 無 pid);MUST NOT「補完」 |
| A16 | SkinnedMesh 量尺寸 MUST `computeBoundingBox()` + 關 `frustumCulled`;`outlinify()` 跳過透明材質與 `userData.noOutline` |
| A17 | FPV 座艙掛在 camera 底下 — camera 本身 MUST `scene.add`,忘了整個座艙不見 |
| A18 | 貫穿 `heroLance` 判定 = 水平垂距 + 垂直帶,MUST NOT「修正」成 3D(伺服器無地形高程)。**垂直帶的射線高 MUST 先經 `_lanceBandY` 換算到目標自己的垂直框**(`oy` 是射手離自己站立面的高度、`_bodySpan(t)` 是目標離自己腳下的量體帶 ⇒ 跨框 = 高低差超過 ±25m 整發被靜默丟棄,而客戶端鏡射沒有這一道、照樣跳傷害數字);換框吃 `_absSightY`/`_hgtAt` 並遵守「兩端都拿得到絕對高程才用絕對框」。半徑 MUST = `lanceR(def) + hitR(t)`、軸距量**線段上最近點**、排序用**原始 `s`**;準星 `_resolveAim(pierce=true)` MUST NOT 停在第一個單位;line 類一發只過一次 `_gateFire`。稽核 `audit_lance_hit` |
| A19 | 觸控疊層開著 MUST 整層收起 `#touchLayer`(`syncBlocked()`)。`#game` 是 `position:fixed` 堆疊脈絡,body 層搖桿壓在其上 ⇒ MUST NOT 用調 z-index「修」 |
| A20 | 手機直式 MUST NOT 一律 `flex-direction:column`(桌機並排 → 直排 = 按鍵被推出摺線);只准收窄欄寬 + 降字級,塞不下才 `flex-wrap`。直排兩陷阱:`flex:1 1 0` 的 basis 落在高度、`.center-screen` 子列 MUST 給 `width:100%`。稽核 `audit_ui_layout` |
| A21 | 操作說明的裝置分支只住 `help.js`(`pTouch`/`labelTouch`,取字經 `helpItemP()`/`helpCatLabel()`);MUST NOT 在 `main.js` 另寫 `if (TOUCH_UI)` 字串分支;判定旗標 = `mobile.isTouchUI()` |
| A22 | 招式手勢派發只住 `game._fireHoldAbility()`(長按右鍵 / 長按 R / 觸控招式鈕共用),模式分流只准經 `abilHoldSlot()`;MUST NOT 在輸入端各自寫 `aiming ? …`。**機種分派表(比對 `isDrone`/`isMorph`)隨機種絕招退場,MUST NOT 復辟**。同功能只准一顆鈕 |
| A23 | `#tlLook` 空處開火出口只有 `_setLookFire()` → `_cmd('fire')`,MUST NOT 直接改 `client.firing`。MUST 先要求一次完整輕點、長按在幀迴圈判定、與 A 鈕互查 `firing` 才停火 |
| A24 | 小地圖 `_mmSeen`/`_mmBase` 座標框 MUST 恆為全圖(`_world2mmFull`),MUST NOT 跟顯示窗跑;`_mmShadows()` MUST 回世界座標 |
| A25 | 一次性 3D 物件移除 MUST 釋放 GPU 資源(只 `scene.remove()` = 洩漏):彈體走物件池 `_takeProjectile`/`_dropBullet`、特效走 `_freeEffect` → `toon.disposeTree`(唯一實作);共用幾何 MUST `markShared()` 註冊;高頻特效 MUST「單位幾何 + scale」不重配。稽核 `audit_gpu_lifecycle` |
| A26 | 程序生成零件擺位方向與旋轉方向 MUST 同調、錨點半徑 MUST 取該高度的錨體半徑(`trunkR(y)` 類單一縫)。三大病灶:差 90°(徑向 vs 切向)、差正負號(MUST 由軸的實際世界向量推)、拿基部半徑當通用半徑。堆疊件 MUST NOT 用 y 交錯偽裝;躺地件軸心高 = 自身半徑。改擺位 MUST 跑 `audit_object_joints` |
| A27 | 實例朝向 `ry` 與微傾斜 `tx/tz` MUST 當剛體整株套用(`xform.vegPartXform` 單一縫),MUST NOT 併進逐零件歐拉角;接合完成度 MUST 與 ry/tx/tz 無關 |
| A28 | 三機制兩條線 MUST NOT 斷:①`rooms.js`/`sim.js`/`bots.js` MUST NOT import Node 內建、用 `process.*`/`Buffer`/`require()`;②URL 佈局 MUST 鏡射儲存庫佈局(`/public/**` + `/server/*.js`)—— 否則 `data.js` 變兩份模組實例且不報錯。單機離場 MUST `hub.shutdown()`。稽核 `audit_net_modes` + `audit_solo_boot` |
| A29 | 地下道 MUST NOT 另開第二套結構 —— 沿用山體隧道整套,差異只有四個具名旗標:①剖面 = `tunFloorAt` 的 `sink`;②引道開挖 = 垂直路塹(側面 MUST NOT 留可通行斜坡);③引道露天物理段(`open:true`)只服務 `surfaceAt` 站立捕捉與移動側壁閘,slab 上傳/`_slabHitT`/`ceilingAt`/lev 回報 MUST 濾 `!open`;側壁閘 = 單步高差 + **幾何牆線**(`by` ← `wallTopAt` 單一縫;高度場會把垂直路塹攤成緩坡 ⇒ MUST NOT 退回純高差判定),`by` 只住客戶端移動物理且山體隧道 MUST 無 `by`。④**覆蓋 = 全斷面藏進地下**:下沉量 MUST 以中心線 + 兩側牆線取樣、MUST 在**延伸後**的基準線上收斂、覆蓋區間 MUST 逐點全寬重驗拆縫;蓋不住一律退回露天路塹,MUST NOT 靠改地形蓋起來。⑤**洞口打洞的路面參考 = `fp` 下沉剖面取樣**(三個消費端同吃;下沉是曲線,線性外推會誤刪本該被路面蓋住的地形 ⇒ 洞口混凝土殘片),且 punch 高差判定 MUST **逐頂點**、collar MUST 跳過兩端貼路面的 rim 邊。山體隧道/明隧道刻意不帶 `fp`。稽核 `audit_underpass` + `audit_open_tunnel` Ⅵ-b |
| A30 | 障礙的碰撞/彈道/伺服器 LOS MUST 同一橫斷面:建物**與地標**= 有向盒(`hw2/hd2/ry`),圓只准當 broad-phase 且 MUST 是外接半對角;occ 上傳時 `ry` MUST 反號(sim 座標 z 鏡射),`setWorld` 預算 cos/**−**sin。**盒面朝向 MUST 與實例矩陣同調**:local 軸反解一律 `sn = −sin(ry)`(寫 `+sin` = 看得見的牆在這裡、擋彈與掛梯的牆在另一邊)。`_mmShadows` 是具名例外(純顯示)。稽核 `audit_climb` Ⅲ/Ⅶ |
| A31 | 攀爬路線只住 `climb.js`。**設施正面 MUST 面對結構**(`attachFaces()` 單一縫):有向盒只准四個面法線 + 面中心、巨岩只准生成期實測驗過的方位(`attA`)、圓柱維持 16 方位;頂端錨件 MUST 以跨接臂接回結構(`arm`)。**攀爬柱 vs 設施幾何是兩件事**:`y0/y1` = 攀爬柱且頂端 `y1` MUST = `b.y + b.h`(MUST NOT 為視覺往下修);`vy0/vy1` = 設施兩端,MUST 經 `facilityEndY()` 貼齊生成期實測的實體面 `b.ty`,落差夾在 `GRAB_UP` 內;設施幾何 MUST NOT 再直接引用 `r.y0/r.y1`。抽中機率 MUST 經 `climbShare(siteSlopeDeg())`;**相鄰相接同吃這支曲線**且共用同一份 `siteSlopeDeg`。**掛在「等高線相對最高那一面」的機率**反向隨陡度收到 0%(`highFaceShare()`)—— 三條曲線 MUST 共用 `slopeRamp`;高側 = 全部候選面裡地表最高的那一面,**四面等高時沒有高側**(`hi > lo` 守衛 MUST 留著)。攀爬軸 MUST 在碰撞體外 `CLIMB.OFF` ⇒ `_collide` MUST NOT 開豁免;上下移動吃 `_moveAxis` 前後推杆(MUST NOT 新增按鍵);每候選固定 4 枚亂數;四面皆堵不掛。稽核 `audit_climb` |
| A32 | **電腦玩家 MUST NOT 比真人多看/多走**。①選敵 MUST 過前方視野錐(`bots._acquire`,半角走 `botFovHalf`);②`h.ry` MUST NOT 直接指派目標角,唯一寫入點 `_turn` + `viewLockStep`;③受擊警戒方位 MUST 只來自 `sim._hurtLog`;④位置 MUST 只經 `bots._move` → `sim.solidResolve`;⑤`solidResolve` 量體 MUST 走 `selfCollider`,掃掠與 push-out 缺一不可。稽核 `audit_bot_vision` |
| A33 | **電腦玩家戰術的帳只有一份、分層只認旗標**。①威脅只准住 `sim._hurtLog`、輸出只准住 `sim._dmgOut`,bots.js **只讀不寫**;②難度分層 MUST 走 `BOT_DIFF.tactic`/`elite`,MUST NOT 比對難度字串(新手/低難度逐位元維持舊制);③三項選敵指標 MUST 正規化成候選集內佔比;④撤退遲滯帶(`PULL_SP` < `RALLY_SP`)MUST NOT 收成同一個門檻;⑤**機體定位分類 MUST 推導不手寫**(逐角色名冊一律禁止)、策略只准是既有旋鈕的覆寫(MUST NOT 出現 `if (role === …)`)、乘數 MUST 以角色數加權幾何平均 = 1 正規化、且只在 `tactic` 旗標之下解析。稽核 `audit_bot_tactics` + `audit_bot_role` |
| A34 | **建築無加乘、護盾分軌只有一份拆分**。①任何武器/招式 `vs.building` MUST ≤ `BUILDING_VS_CAP`(=1),`GRENADE.BUILDING_MUL` MUST NOT 復辟;夾制 MUST 是推導迴圈;②護盾/裝甲拆分只准住 `shieldSplit()`,四個消費端 MUST 全走(MUST NOT 自己讀 `vsSp`/`vsHp`/`spPierce` 去乘);③溢出 MUST 按**預算**折回;④`vsSp = 0` MUST 退化成「護盾全擋」;⑤`vsHp` MUST 對無護盾目標一樣生效;⑥三條配置紀律見 §2.1。稽核 `audit_shield_counter` |
| A35 | **攻擊範圍收斂與三軸預算**。①非「範圍見長」的爆炸型 MUST NOT 一發傷到同塔位兩座塔,上界只准由 `soloBlastRmax()` 推導;②豁免只走 `AREA_WEAPONS` 凍結名冊(**現為空**),fan/line 依機制豁免;③夾制與火力回補 MUST 由**同一次**推導迴圈定案;④回補 MUST 是重分配(整批係數幾何平均 = 1);⑤`aoeTrimF`/`mobDmgF`/`rngDmgF` 的套用點各只准有 `heroWeapon` 的 `dmg` 一欄;⑥招式 MUST NOT 吃這三軸;⑦改任一 `r`/名冊/上界 MUST 重掃 `SEEK.R_M`;⑧家族上限只准由 `blastCapR()` 推導、分組只准由 `blastFamily()` 判(guide 與 fnf **同族**),導引在**每一階**恆小於榴彈,榴彈類射程 MUST = 全體重武器最短那一帶;⑨家族內排序 MUST 保留。稽核 `audit_aoe_trim` |
| A36 | **射速壓縮三欄一起動、連發演出不碰權威狀態**。①`rate`/`dmg`/`mag` MUST 由 `compressWeapon()` **同一次**推導定案(少了 `mag ×f` = 持續 DPS 虛胖而爆發 DPS 正常 ⇒ 只驗一項驗不出來);②壓縮曲線 MUST 嚴格遞增(排名不變的**保證**);③`recoilTier` 與 `fireBurstN` MUST 吃 `rate0`;④連發補畫是純表現層:MUST NOT 送任何網路訊息、MUST NOT 進 `this.bullets`、MUST NOT 扣彈藥/電力/動 `lastFireAt`;⑤陣亡/換座機 MUST 清 `_burstQ`。稽核 `audit_fire_rate` |
| A37 | **文字圖層只有一個、語料一份、比例推導、純表現層**。①全世界的字 MUST 只經 `worldtext.SignSheet` 一張圖集一個 mesh(舊 `signage.js` 已退場);②取名只有 `pickName` 一份,主名 MUST 是在地文字;③日常副行 MUST NOT 是 OSM 列舉值;④去重帳全世界一本且合成名/詞表保底一併入帳,連鎖旗標 MUST 只認 `brand`;⑤牌面尺寸 MUST 由 `signAspect(style)` 推導;⑥雙面牌 MUST 是兩片背對背,MUST NOT `DoubleSide`;⑦招牌 MUST NOT 進 `blockers`/碰撞/LOS;⑧構件名牌零亂數,語料庫招牌只准用注入的專屬 seed;⑨裝不下 MUST 記 `signDropped`。稽核 `audit_world_text` + `audit_vernacular` |
| A38 | **三個地貌的排列規則各只有一份、全住 `siteplan.js` 的純區塊**。①規則 MUST 是純幾何,落點只准問呼叫端給的 `probe` 回呼(規劃器 MUST NOT 認得地形/`blocked`/`occ`,也 MUST NOT 出現 `THREE`);②街廓配置與公設 MUST **零共享 `rnd()` 消耗**;③建築線、排距、冠幅、走向一律**推導不手寫**;④公設的開放鋪面 MUST NOT 登記碰撞柱,有量體零件的碰撞體 MUST 由零件表實算且**長條件登記有向盒**(A30);⑤朝街朝向只有 `roadFaceRy` 一份;⑥樹冠羞避 MUST 走**縮冠**而非淘汰、傾斜 MUST 併進既有 `tx/tz`(A27);⑦巨岩長軸 MUST 吃 `cell.ry`,`g.rotation.y = rnd() * Math.PI * 2` MUST NOT 復辟。稽核 `audit_siteplan` |
| A39 | **軟性物質:一個旗標管兩件事、細勾線只走 alpha 契約、擺動只動頂點**。①「這個零件是不是軟的」MUST 是**同一個旗標**同時決定勾線粗細與擺動;分類 MUST 由既有 `part.key`/`sf` 推導;②細勾線 MUST 只經「場景 RT 的 alpha ≡ 勾線門檻倍率」這條契約傳到 `postfx.js`,倍率 MUST 乘進 `smoothstep` 的**輸入**且取四鄰最小值(`postfx.js` MUST NOT 手抄那個倍率);③擺動 MUST 是**純頂點位移**(伺服器一格都不能改);④權重 MUST 錨在整株局部座標,相位取實例原點、風向 MUST 轉進局部座標;⑤`span` MUST 推導;⑥風向與時鐘全場**各一份**(雲/植被/旗幟同吃);⑦軟性 MUST 進 `customProgramCacheKey`。稽核 `audit_soft_stroke` |
| A40 | **角色與機體的檔案格式只有一份、原型層由 `visual` 推導、生成文字只由 `codex.js` 組裝**。①段/欄/必填只准住 `codex.js`;②兩種檔案的**生成段鍵集 MUST 逐位元相同且順序相同**;③機體原型 MUST 是結構化的層且**層集由 `visual` 推導**,變形者 MUST 有飛行型 + 地面型**兩層**、每層分 `{src, note}`;④自由字串的 `lore.proto` 與 `main.js` 的標籤正規式切割 MUST NOT 復辟;⑤全高/機體名/主色/機種/陣營 MUST 到原處取;⑥三份對外生成文字 MUST 只由 `codex.js` 組裝;⑦`mecha.js` MUST 維持零 import、`codex.js` 只 import 三支純資料檔;⑧型態姿態語只准住 `FORM_POSE`、取得只准經 `formPose()`(型態存不存在 MUST 由原型層推導),飛行那一組取景 MUST NOT 是 `standing`、地面那一組 MUST 逐字維持舊制;⑨用不到的 `visual` 欄位 MUST NOT 進生圖與切圖清單(只准經 `visualUses()`);⑩出圖管線的設計敘述 MUST 取 `codex.js`。稽核 `audit_codex` |
| A42 | **地圖主方位與道路量化**(2026-08-10 使用者定案)。①經緯度投影只有 `data.js llToXZ` 一份,旋轉是它的一部分 —— `terrain.llToWorld`/`sim.llToMeters`/`biomes.worldToLL` 一律轉呼,MUST NOT 復辟第二份等距圓柱公式;②`sim.llToMeters` MUST 只是 **z 反號薄殼**(z 鏡射已把 R(θ) 共軛成 R(−θ),再轉一次 = 兩端差 2θ);③`center.rot` 只准經 `mapRot()` 讀;角度 MUST 在 **battleConfig 定案之前**就凍結成常數 —— 預設場地取離線烘焙表 `venueGrid.js`,自訂地圖只准在**存入最愛那一次**由房主量一次寫死(`main.resolveMapRot`,呼叫點恰一處)。MUST NOT 在建圖期(`startPrebuild`/`buildBiomes`)量:那是每台客戶端各跑一次的,而 Overpass 逐局成敗不同 ⇒ 不同客戶端量到不同角度 = 整個世界的座標對不上。兩條產線 MUST 共用 `roadGridRotDeg()`(取樣面 `GRID_HW` + **未旋轉**量測框 + 取負號,三件事綁在一起),**抓取範圍也 MUST 在 rot=0 的框裡算** —— 帶 rot 的框只會長大(實測 ×1.77~2.27)⇒ 重烤不冪等、角度自己漂走(實測 shibuya 14.53° → 19.49°,而三個檔案都沒改、其餘稽核照樣全綠);④旋轉 MUST 只讓 `battleRect` 長大、`battleBBox` 跟著蓋住;⑤量化接線**恰一處**且排在所有消費端之前,MUST NOT 作用在兵線;⑥去鋸齒 MUST 是位置空間遲滯,**MUST NOT 用「事後併短段」**;⑦量化前 MUST 先細分;⑧位移硬上限 MUST 逐節點夾。稽核 `audit_road_grid` |
| A43 | **路網中繼:一份淨化、逐格單調、θ 不搭便車**(2026-08-10 使用者定案「圖資儲存在開房者,再由開房者透過 server 傳給入房者」)。①payload 的形狀與上限只准住 `osmrelay.js`,兩端同吃且 MUST 冪等;房主 MUST 吃**送出去的那一份**(兩邊資料不同 = 中繼白做);②該檔 MUST 零 import、**零模組級可變狀態** —— 單機的 `RoomHub` 與客戶端 import 到同一個實例,放 store 就等於兩端共用(store 住 `biomes.js`);③伺服器只受理房主、存淨化產生的**新物件**(共用參照會被下游就地變異)、逐格**單調**(已定案 MUST NOT 被覆蓋 —— 換掉已發出去的那一份 = 早進房與晚進房的人建不同的世界)、MUST NOT 碰 `battleConfig`(θ 凍結,A42 ③);④MUST NOT 塞進 `sync`(它會重播多次);⑤客戶端的中繼早退 MUST 排在 `geoGet` **之前**,且中繼資料 MUST NOT 寫進 geocache(房主是不可信輸入,持久化會污染這台機器之後每一場);⑥入房者等不到 MUST 退回自己抓(嚴格改善),等待 MUST 與地形建構並行;⑦定案表逐格三態,房間階段補抓成功 MUST `resetOsmMisses()`;⑧送出前 MUST 經 `osmRelayFit`(超限硬送 = ws 以 1009 斷掉房主的連線,症狀看起來完全像伺服器壞掉)。稽核 `audit_osm_relay` |
| A41 | **導引彈的追蹤目標只認擊發當下的準星解**(2026-08-10 自重複的 A38 移來)。`game._tryFire` 決定 `homing` 時 MUST NOT 讀 `this._lockId` —— 那是**上一個**伺服器複驗過的鎖定,準星移開後要等 `_tickLock` 下一次 4Hz 心跳才清得掉,那段空窗裡開火彈體會繞過準星飛向玩家已經不再瞄的人。準星解不到 ⇒ **不追蹤**(直飛),MUST NOT 退回任何舊目標;鎖定該有的黏著住在 `_coneAcquire` 的遲滯錨 `keepId`,不在擊發端。仍 MUST 用**擊發當下**的準星解而非等鎖定成立。稽核 `audit_weapon_gate` Ⅵ③ |
| A44 | **邊界牆型錄:演出 ⊆ 碰撞盒、內面填滿、切分只有一條**(2026-08-11 使用者定案 15 款)。①型錄、切分規則、緩衝布景與背景的落點規劃只准住 `edgewall.js`,而且該檔 MUST **零 THREE、只 import `rng.js`** —— 零件寫成 `new THREE.Mesh(...)` 的話「這款牆有沒有頂出碰撞盒」就只能靠真瀏覽器看,而那正是會靜默壞掉的一半;②「隨機更換」MUST 由**座標雜湊**餵自己的 `mulberry32`,**零共享 `rnd()` 消耗**(§2.3);③零件表 MUST 整份收在「段長 × depth × 高」的盒子裡(三軸都要)—— **縱向漏掉的代價**是從上方斜射進緩衝空間的彈道穿過看得見的船樓/塔頂而伺服器毫無所悉(A30 家族);反過來盒子的**內面** MUST 被實體零件蓋滿到機體視線高,否則是「撞到空氣」。兩個方向由 `wallFit()` / `wallFaceCover()` 各量一支;④**碰撞盒高 MUST 逐段實測**(`max(edgeWallHM(), 該段零件的最高點)`),MUST NOT 拿型錄宣告的 `h` 當每一節的盒高 —— 同一款的節有高有矮(城牆:素牆 9m / 箭樓 12.5m / 砲台 13.8m / 城門+城樓 14m),用宣告值就是矮的那幾節頂上一截撞得到卻看不見的空氣;`def.h` 從此只是**授權上界**(零件表 MUST 收在它之內);⑤厚度是**真實公稱尺寸**:內面恆貼夾制線、厚度往圖界方向長(⇒「沿邊沒有縫」不受影響),型錄裡最深的一款 MUST === `edgeWallDeepM()`,而 `placeBoundary` 的 IN1 MUST 吃它(沿用 `WALL_T` = 邊界樓群長進船身);⑥**坡度是硬門檻、地貌是偏好**(2026-08-11 使用者追加「太陡的時候只使用懸崖峭壁/土石流/山崩這類自然景觀,中等坡度可以再加上倒木/長城」):三級門檻 MUST 錨在 `SLOPE.EASE_DEG`(修得起路的坡)與 `SLOPE.BLOCK_DEG`(機體爬不上去)、由呼叫端注入(`edgewall.js` MUST NOT 自己寫死度數),坡度 MUST 量**裸地形**;配不到符合地貌的自然景觀時 MUST 退回「這一級全部合法的款」,**MUST NOT 退回平地款**(那就是貨櫃車掛在崖面上,而畫面之外每一條斷言都還是綠的);⑦切分只有一條 ——「地貌 / 水陸域 / **坡度級**改變 **或** 已連續鋪滿 `RUN_MAX_M`」;短於 `RUN_MIN_SEG` 的 run MUST 併回去(衛星色逐段抖動,不併就碎成城牆/民房/城牆的雜訊),併的時候**坡度級 MUST 取較陡的那一個**(取較緩 = 一列貨櫃車橫跨那道崖),而**水陸域不同的 run MUST NOT 互相併**(海堤併進城牆 = 牆站在水裡);併回去 MUST 排在配款**之前**;⑧緩衝布景與視線邊界背景是**純表現層**:MUST NOT 進 `blockers`/`occ`/LOS,落地 MUST 走 `terrain.bufferHeightAt`(拿 `heightAt` 會被夾回圖界 ⇒ 整排物件高度錯位),背景高度 MUST 吃 `objHeightMax()` 同一個天花板;⑨**城門 MUST 是關著的**(邊界上開一個真的洞 = 看得穿卻走不過,而 `wallFaceCover` 正是為這件事訂的門檻),城樓 / 砲台 / 箭樓一律**只是幾何** —— `buildEdgeWall` MUST 只碰 `group` 與 `blockers`,MUST NOT 碰任何單位 / 擺件 / 逐幀清單,「不會攻擊」因此是構造保證而不是某個設定值。稽核 `audit_world_edge` Ⅲ・Ⅶ・Ⅷ |
| A45 | **爆炸傷害的閃避是逐目標的事**(2026-08-11 使用者定案「爆炸傷害爆炸時,就算沒擊中原先的目標,也會造成範圍傷害(閃避率各自計算)」)。①判定範圍只准住 `data.js evadable()` 一份,四個消費端(`sim._blast`/`heroHit`/`_echo`/`botFire`、`duel.mjs`、`lanesim.mjs`、`balance.mjs`)MUST 全吃,MUST NOT 任一端自己比對 `def.id === 'light'` 或 `!def.r`;②判據 MUST 是**排除法**(`aoeClass` 不是 fan/line) —— 列舉法在 NPC 那半靜默失效,因為 `WEAPONS` 的 rgun/rocket/siege **沒有 `id`**,而 `aoeClass` 認 blast 的前提正是 `def.id === 'heavy'`(招式與 NPC 火箭都不帶 `id` ⇒ 會被判成「非爆炸」);③爆風的擲骰 MUST 逐目標 `continue`,**MUST NOT 整發 `return`** —— 整發早退的症狀是「小隊裡最快的那一台一閃,旁邊的重甲與砲塔一起免傷」,畫面上只是「這發榴彈好像沒傷害」,傷害數字一個都不會跳而所有既有斷言照樣全綠;④自損(`friendly` 無差別模式)刻意不擲 —— 最小安全射程的自傷是**代價**,能閃開就變成擲骰躲懲罰;⑤塔/主堡的制式火砲仍不可閃(無 `wid` ⇒ def 為空,且 NPC 分支另有 `struct` 排除);⑥NPC 爆炸型武器走 `_blast` 時傷害基準 MUST 是`UNITS[kind].dmg`(NPC 傷害刻意不吃 `vs` 剋制)且 MUST 補發 `boom` 事件(20m 超壓帶要看得見才讀得出危險區);⑦**閃避補償**(2026-08-12 使用者定案「維持 DPS 提高傷害,閃避率不動」):沒被閃掉的那一發 MUST ×`evadeCompF(p)`,分母是**同一顆骰的 p** —— 只補 `evadeComped()`(一切爆炸傷害)、MUST NOT 補輕武器直射(它的基準 DPS 早就含著那份損失)、MUST NOT 拿全體平均當單一係數(閃不掉的目標會平白吃到補償 = 通膨)。代價是閃避對爆炸傷害的**期望減傷歸零**,那是這四個字的直接推論不是實作漏了什麼。稽核 `audit_weapon_gate` ⅩⅢ |
| A46 | **整棟量體節點:碰撞吃剖面、剖面是純資料、附著物只上垂直平整牆**(2026-08-12 使用者四條)。①**碰撞剖面**:挑中庫節點的那幾棟,碰撞柱 MUST 由 `bldProfile` 逐段登記(仍是 A30 的有向盒,只是一顆變一疊)—— 舊制那顆整足跡方盒有 **62%~84% 是空氣**(實測剖面體積佔比 mass_b 0.157 / masslow_b 0.256),而那些空氣擋彈、擋 LOS、爬得上去;逐段一律取該段的**最大**半跨(盒恆包住網格,A44 ③ 的同一條:少算一格 = 看得見的牆打得穿)。②**剖面 MUST 是純資料**(住 `BLD_LIB` 第三格、離線量、`intake_parts` 逐顆比對宣告 vs 實測):佈局數學 MUST NOT 讀庫幾何 —— 庫載不載得到逐客戶端不同,讀它就是碰撞柱跨客戶端分家。同一條也決定了**挑選 MUST 與庫載入解耦**(舊制的 `if (ok.length)` 在碰撞柱還是單一方盒的年代無害,現在會讓兩台客戶端登記不同的柱),而保險絲幾何 MUST 由**同一份剖面**疊出來(`profGeo`)⇒ 不論載不載得到,看到的與撞到的都是同一個形狀。③**尺寸**:逐實例縮放 MUST 由剖面實測外廓推導(把網格撐滿基地;舊制節點只佔單位盒的 0.13~0.42 ⇒ 塔樓縮在空地中央、外面一圈看不見的碰撞盒),拉伸倍率 MUST 夾在 `MASS.ASPECT_MAX` 內、**超過就不換這一棟**(退回方盒,原則 6);名冊層級 MUST 蓋得住方正基地(`intake_parts` 涵蓋率閘)。④**附著物**:招牌落點 MUST 取「那個高度真的存在的那一段」的側面(`bldFace`),MUST NOT 推到 `b.w/2`、`b.d/2`;窗格與招牌 MUST NOT 上斜面 —— UV 三帶(`MASS.UVB`:朝上 / 傾斜與朝下 / 近垂直)由 `normalize_parts.py --uvbands` 烤進節點,六個數字與 tri_budget **同一份**。「平整」那半 MUST NOT 改用逐平面分群判(實測 AI 網格的垂直面本來就有起伏,那樣會把九成立面判成素牆);它由**招牌掛在剖面側面**這件事構造性地保證。⑤**窗佔比逐款不同**(`win: [寬, 高]`,間距 = 1 − 高),`glass` 是一種**立面**不是 `curtain` 的參數;**層高仍夾在 `STOREY` 帶內**(2026-08-09 定案不動 —— 層高是現實約束,窗佔比是建築風格,兩件事正交)。稽核 `audit_siteplan` Ⅴ ±`--break-prof`/`--break-fill`/`--break-glass` + `intake_parts` |

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

**離線稽核**(一律不需伺服器/瀏覽器/網路;`--break-*` = 反向驗證,見原則 9):

```bash
node tools/audit_aoe_trim.mjs        # 攻擊範圍收斂 + 三軸預算 + 爆風家族帶
node tools/audit_fire_rate.mjs       # 射速壓縮 + 連發演出
node tools/audit_recoil_move.mjs     # 後座力 → 開火中移速
node tools/audit_speed_comp.mjs      # 移速壓縮(拉近差距 / 排序不變)
node tools/audit_shield_counter.mjs  # 建築加乘移除 / 護盾分軌 / 對建築 DPS 收斂
node tools/audit_hex_stats.mjs       # 圖鑑六角能力圖
node tools/audit_weapon_gate.mjs     # 射程界 / 光暈 / 容差 / 高度制空 / 稜線 / 導引
node tools/audit_lance_hit.mjs       # 直線貫穿命中(含垂直帶換框)
node tools/audit_self_ult.mjs        # 純自身型補償 + 跟隨玩家的輔助機隊
node tools/audit_ult_carrier.mjs     # 招式載具遞送(含發射點與槽位 CD 帶)
node tools/audit_flight_power.mjs    # 三種載具彈道 / HP 校準 / 飛行動力學
node tools/audit_bot_vision.mjs      # 電腦玩家視野 + 碰撞
node tools/audit_bot_tactics.mjs     # 電腦玩家戰術(選敵 / 撤退 / 打帶跑)
node tools/audit_bot_role.mjs        # 定位分類與策略(末段印現役定位名冊)
node tools/audit_bot_policy.mjs      # 學習策略(夾制 / 中性 / 白名單)
node tools/audit_npc_collide.mjs     # NPC 飛行高度基準 + NPC ⇄ 機體碰撞
node tools/audit_shop_auto.mjs       # 商店掃貨 / 預約
node tools/audit_story_talk.mjs      # 劇情戰役攻堅順序鎖血 + 階段對話 + 本地故事書(含 BattleSim 行為直測)
node tools/story_book.mjs --report   # 本地故事書的頁面索引(章 × 陣營 × 頁;缺頁一律列出來)
node tools/audit_blood_splat.mjs     # 受擊濺血提示
node tools/audit_cc_flash.mjs        # 異常狀態致盲白幕 + 蓄力跳水平移速
node tools/audit_world_height.mjs    # 世界高度上限(遊戲天花板 / 物件上限)
node tools/audit_world_edge.mjs      # 世界邊界(障礙環型錄 / 緩衝空間布景 / 視線邊界背景)
node tools/audit_world_curve.mjs     # 世界曲面(拐點 / 地平線反解 / 幾何細度)
node tools/audit_visual_prefs.mjs    # 畫面旋鈕 / 陰影偏色 / 風化場 / 抖動 / 景深
node tools/audit_soft_stroke.mjs     # 軟性物質(細勾線 + 隨風飄揚)
node tools/audit_cel_pipeline.mjs    # 賽璐璐管線(ramp / 天空 / 地形色階 / 描邊寬度)
node tools/audit_gpu_lifecycle.mjs   # 表現層資源生命週期(A25)+ RES_GOV
node tools/audit_object_joints.mjs   # 程序生成零件接合(--seeds 8)
node tools/audit_siteplan.mjs        # 都市計畫 / 樹冠羞避 / 地質排列 / 聚落場 / 整棟量體
node tools/audit_beacons.mjs         # 語意化地標
node tools/audit_world_text.mjs      # 世界文字(圖集 / 版面 / 裝箱 / 接線)
node tools/audit_vernacular.mjs      # 在地文字語料
node tools/audit_codex.mjs           # 角色 / 機體檔案格式
node tools/audit_paper_doll.mjs      # 機體台紙娃娃系統(骨架/零件/彩繪覆寫層 + 存檔語意)
node tools/audit_layer_block.mjs     # 塗層雙面阻擋 + 隧道頂板(A6b)
node tools/audit_open_tunnel.mjs     # 明隧道
node tools/audit_underpass.mjs       # 地下道 + 結構資格閘
node tools/audit_road_grid.mjs       # 地圖主方位(旋轉)+ 道路 16 方向量化
node tools/audit_road_joint.mjs      # 道路塗裝寬 / 結構接合 / 立體結構建置範圍
node tools/audit_road_bed.mjs        # 道路路基整平
node tools/audit_slope_move.mjs      # 地形坡度移動
node tools/audit_terrain_ray.mjs     # 地形解析射線
node tools/audit_climb.mjs           # 攀爬路線 + 障礙橫斷面(A30/A31)
node tools/audit_bridge_crossing.mjs # 橋交會去重
node tools/audit_water_skirt.mjs     # 馬路橫切繞行
node tools/audit_bridge_tower_pad.mjs# 橋上砲塔墩座
node tools/audit_map_rules.mjs       # 砲塔佈局 #4
node tools/audit_lane_sep.mjs / audit_lane_grade_sep.mjs   # 兵線分離 / #5 洞口涵蓋
node tools/audit_lane_navigation.mjs # 兵線導航規則
node tools/audit_ground_tile.mjs      # 地貌拼圖的顏色(選款區塊)與花紋(逐格互異)+ 緩衝空間底毯
node tools/audit_ground_qc.mjs / audit_ground_seam.mjs / audit_ground_enclave.mjs
node tools/audit_minimap_view.mjs    # 小地圖顯示範圍
node tools/audit_view_lock.mjs       # 視野鎖定
node tools/audit_spectator_cam.mjs   # 觀戰相機
node tools/audit_ctrl_mode.mjs       # 操作方式 + 戰場選單 + 按鍵風格
node tools/audit_ui_layout.mjs       # 選單版型 / 鈕面文字 / 懸浮提示 / 圖示
node tools/audit_touch_layout.mjs / audit_touch_gesture.mjs
node tools/audit_osm_relay.mjs       # 路網中繼(payload 淨化 / 逐格單調 / 接線順序)
node tools/audit_solo_boot.mjs       # 單機開機(data.js 單一模組實例)
node tools/audit_client_syntax.mjs   # 客戶端模組語法閘(全部 public/js/*.js 逐支 node --check)
node tools/audit_venue_biome.mjs --offline   # 場地地貌宣告自洽(CI 收這一半)
```

**需外網 / 真瀏覽器(㋓,沙箱跑不動 → GitHub Actions 或真機)**:

```bash
node tools/audit_traverse.mjs        # 兵線與結構可通行泛洪(27 場地;--break-slope 反向驗證)
node tools/audit_lane_scenarios.mjs  # 場地場景標記 MUST 由實測產生
node tools/audit_venue_biome.mjs     # 完整版:宣告 vs 圖資實測的地被組成與建蔽率
node tools/bake_venue_lanes.mjs      # 重烤 venueLanes.js
node tools/bake_venue_grid.mjs       # 重烤 venueGrid.js(場地主方位;--only <ids> / --dry)
node tools/measure_osm_relay.mjs     # 路網中繼 payload 實測(核對 maxPayload / MAX_BYTES 餘裕)
node tools/bake_venue_text.mjs       # 重烤 venueText.js(在地文字語料)
node tools/shot_scene.mjs --venue taroko     # 定場鏡頭組(--ink=0/--grade=0/--post=0/--dof=0/?curve=0)
node tools/shot_facades.mjs / shot_signs.mjs / shot_tunnels.mjs / shot_units.mjs
node tools/shot_borders.mjs --port 8641    # 地貌界線拼圖全組合實拍圖錄(--seeds N / --only zoneA|zoneB)
node tools/audit_gyro.mjs            # 陀螺儀(MUST 用 https/localhost 真機)
node tools/audit_cockpit.mjs / audit_muzzle.mjs / audit_cast_jump.mjs
```

**資產管線(img→3D;全文 `docs/ai3d_runbook.md`)**:

```bash
node tools/ai3d/harvest_loop.mjs --home <資料家> --rounds 0 --every 15   # 週期採集(刻意不入庫)
node tools/ai3d/fetch_photos.mjs --inbox | --adopt | --plan              # 自己放圖 / 收編 / 配比
python tools/ai3d/matte_photos.py --rebbox --home <資料家>               # 回填截斷閘的邊框帳
python tools/ai3d/split_targets.py --home <資料家> --sheet               # 圈選 + 分離
python tools/ai3d/screen_mattes.py --sheet                              # 三道篩選(模糊/太小/截斷)
python tools/ai3d/audit_split_targets.py --home <資料家>                 # 圈選/分離/篩選稽核
node tools/ai3d/intake_parts.mjs     # 零件庫入庫閘(外廓契約 + 三角形預算)
node tools/ai3d/auto_intake.mjs --src <產出目錄> --home <資料家>   # 第 ⑦⑧ 站:自動入庫 + 收尾稽核(紅字整批回滾)
node tools/ai3d/apply_verdicts.mjs --home <資料家>                # 第 ⑨ 站:執行對照台的人眼判決(regen/reimg/purge)
node tools/ai3d/audit_auto_intake.mjs   # 自動入庫與撤下 + 圖檔三態與啟停閘門 + 封存區/重跑順位(離線)
                                        #   ±--break-append/--break-rollback/--break-blacklist/--break-spawn/--break-panel/--break-pane
                                        #   ±--break-home/--break-corpus/--break-home-arg/--break-on/--break-keys/--break-redo/--break-archive
node tools/ai3d/mesh_sym.mjs --gate  # 「另一面空不空」量測 + 該補的名冊
node tools/ai3d/node_sheet.mjs --glb <glb> [--ref <舊 glb>]   # 節點四面黏土對照(需 playwright)
node tools/ai3d/gen2d.mjs --audit    # rig 節點涵蓋 / 描述子詞表 / 補圖優先序 / ★ 外觀權威
node tools/ai3d/measure_*_tris.mjs   # 三角形預算量測(需 playwright)
node tools/bot_learn.mjs             # 電腦玩家策略學習迴圈(--eval / --reset)
```

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

### 5.5 改了什麼 → MUST 跑什麼

| 改動 | 驗證 |
|---|---|
| 任何 `public/js/*.js`;**GLSL 住在 JS 樣板字串**的那幾支尤其(`vfx.js` `SHIELD_VERT`/`SHIELD_FRAG`、`toon.js` 曲面與賽璐璐補丁、`environment.js` 天空穹頂 —— 這些檔案的 GLSL `//` 註解裡 **MUST NOT 出現反引號**,一個就把整支 .js 的字串收掉,而 node 報的位置指向註解那一行的中文字) | `audit_client_syntax` ±`--break-glsl`;名冊由目錄推導、副檔名 MUST 換 `.mjs`(`.js` 走 CommonJS 解析 ⇒ 頂層 `import` 整批誤報)。㋖ |
| 任何平衡數值(小兵/角色武器/`SQUAD.BUFF`/HEROIC/塔/賞金/八軌價格) | `npm run bal` 全綠;動角色武器一併看 ⑤ 離群列 |
| 射程/傷害/`sight`/`RANGE_SIGHT_F` | e2e:輕武器 NPC range ≥170(#INC-104)、t01/s02 `crit:0`、s02 heavy = launcher、「塔 310 > 所有輕武器」與「所有重武器 > 塔 310」雙不等式 |
| 角色機種編制(`CHARACTERS[].kind`/`visual`/換機種的 `mods.armor`) | e2e「機體混編陣營分佈」(7/3/2・3/7/2・2/2/4 + 32 名皆有 kind + 12/12/8 款 1:1)+ bal ①(EHP 池與推導值)+ ⑤(`CLASS_SYM` 分組)+ `audit_muzzle`/`audit_cockpit`/`audit_cast_jump`(㋓) |
| 射速壓縮 / 連發演出 | `audit_fire_rate` + **`npm run bal` 全綠(⑦c 最敏感)** + `npm test`(**射速一改,任何寫死秒數的測項會靜默失效** ⇒ 期望值 MUST 由解析後的 `wl.rate`/`wl.reload` 推導)+ ㋔ |
| 移速壓縮 | `audit_speed_comp` ±`--break` + **bal ①④⑤⑦ 四條一起看**(④ 的變形者剩餘 EHP 是 K 的下界守門值)+ `audit_aoe_trim`(`mobDmgF` 中點跟著漂)+ ㋔ |
| 開火中位移懲罰 | `audit_recoil_move` + `audit_fire_rate`(`recoilTier` 仍吃 `rate0`)+ `audit_view_lock`(**後座力仍不得被鎖定抵銷**)+ ㋒ |
| 攻擊範圍收斂 / 三軸預算 / 爆風家族帶 | `audit_aoe_trim` ±`--break` + **bal ⑦a 與 ①④⑤ 一起看**(範圍換火力的補償會位移單體模型)+ `npm test` 該段 + **`audit_weapon_gate`(核心帶縮小 ⇒ MUST 重掃 `SEEK.R_M`)** + `audit_shield_counter`(傷害鏈比對 MUST 走全鏈) |
| 對建築 DPS 收斂 / 任一 `vs.building` | `audit_shield_counter` Ⅵ + `npm test` 該段 + **bal ④ 是主要校準錨**、⑤ 逐角色離群一併看 |
| 建築加乘 / 護盾分軌 / 護盾軸配置 | `audit_shield_counter` + **bal 四不變式會位移** + `npm test` 該段 + ㋔ |
| 圖鑑六角能力圖 | `audit_hex_stats` + `audit_shield_counter` Ⅵ(`buildDps` 改吃 `weaponDps`)+ `audit_ui_layout`/`audit_ctrl_mode` + ㋒ |
| 波次節奏 `GAME.WAVE_S` / `waveComp` / `_prefillLanes` | e2e「出兵間隔固定 + 開場預置兵線」(期望值 MUST 由同一份規則推出)+ bal ①(波次 EHP/DPS)|
| 陣營小兵強化 | e2e 該段 + **bal 四不變式 MUST 不動**(bal 模型是未強化的基準波次) |
| 八軌階梯 / 戰鬥分數 | `npm test`(**MUST 先重啟伺服器**)+ `audit_shop_auto` + **`npm run bal`**(③ 已退場不判定,但 ⑦ 的升級節奏會位移 —— 交付率與對局長度都要看)+ `audit_bot_role`(bot 採購前置篩選)+ `audit_client_syntax`(㋖)|
| `ECON.UPG_STEPS` | e2e「八軌升級階梯 + 戰鬥分數門檻」+ `audit_shop_auto` + bal ⑦(升級節奏)|
| 商店掃貨 / 預約 | `audit_shop_auto` + `audit_ui_layout` + ㋒(bal 不模型化購買順序) |
| 攻堅順序鎖血 / 劇情階段對話 | `audit_story_talk` ±`--break-stage`/`--break-gate`/`--break-cast`/`--break-quota` + **`npm test`(MUST 先重啟伺服器;旗標關掉時 sim 逐項不變)** + `npm run bal` MUST 逐項不動(鎖血只在劇情房生效,bal/duel/lanesim 都沒有 `siege`)+ `audit_weapon_gate`/`audit_bot_vision`/`audit_bot_tactics`(`_damage`/`_tgBlockedD`/`bots._acquire` 各多一道閘)+ `audit_client_syntax`(㋖)+ `audit_ui_layout` + 改對白內容 ⇒ 只需本支 |
| 劇情畫面標記 `storyui.js` / 本地故事書 `tools/story_book` | `audit_story_talk` Ⅷ ±`--break-book` + **`audit_ui_layout`**(頭像唯一縫換了家,規則沒變)+ `npm run audit:net`(新增一支可啟停的 dev 工具 ⇒ ⑦ 段的埠號 import 與 kind 分流會多一列)+ `audit_solo_boot` + `audit_client_syntax`(㋖)+ `story_book --report`(缺頁 0)+ **真瀏覽器開一次遊戲的劇情分頁**(㋕:標記從 main.js 搬走了,章節卡/簡報/選主駕要仍然一模一樣)。改 `storyui.js` 的任何一行 = **兩個消費端一起動**,MUST 兩邊都看 |
| 對進戰模型 / `ALTITUDE.*` / `FAN_*` / `CLASS_SYM.K` | bal ⑤(陣營與機種 50±5pp、**較高方 50±3pp**、非豁免角色 ∈ 20~80%、接近期損失 ≤40%);改 `K` 一併看 ① |
| 機種底盤(`UNITS[kind]` 的 hp/shield/speed/fly/**sight**、`SQUAD.HP_F`/`ARMOR_F`、`EVASION.AIR_BONUS`) | **bal ⑤f**(三個底盤兩兩 ≈50%;robot/morph 那一格是結構保證 —— `UNITS.morph` 一動就紅字)+ ⑤b + ⑦c + ①(HP_F 是清波剩餘率的校準錨)+ 改 `sight` 另 MUST 看迷霧/索敵與 #INC-104 高空射擊。反向驗證:把 `SQUAD.HP_F` 調到 1.0(⑤f 34.6% 紅)或讓 `UNITS.morph.sight` 偏離 robot(robot/morph 25.1% 紅) |
| 前線交戰模型(`lanesim.mjs`) | `npm run bal` ⑦ 全段(**b 的三條單軸自驗是模型有沒有壞掉的哨兵**)+ `audit_aoe_trim` Ⅴ + ㋒ |
| 招式配置 `fx`/`add` | bal ⑥:雙扇形 MUST 兩招貼身、單扇形 ≥1、密度 ≥ 非扇形 ×2;s07/m07 具名豁免 MUST NOT 為湊標換掉 |
| 招式手勢 / 純自身型補償 | `audit_self_ult` ±`--break-eq`/`--break-alpha`/`--break-brk` + `audit_ult_carrier` + `audit_flight_power` + **bal ⑦f**(自身型組 9 台 MUST 全數 > 0)+ `npm test` + ㋔ |
| 輔助機隊(自身強化型) | `audit_self_ult` Ⅴ・Ⅵ ±`--break-stack`/`--break-tempo` + `audit_ult_carrier`(kami 恰**兩個**具名生成點;三支 `--break` 仍 MUST 咬得住)+ `npm test` 該段 + **bal ⑦f**(「輔助機損失」那一行 MUST > 0 —— 恆 0 = 模型裡根本沒被打過)+ ㋔ |
| 招式載具發射點 / 槽位 CD 帶 | `audit_ult_carrier` Ⅳ ±`--break-origin` + `audit_self_ult` Ⅵ + `npm test` 該段 + **bal 全綠**(⑦f 載具交付率會位移)+ ㋔ |
| 大招載具遞送 | `audit_ult_carrier` ±`--break-cd`/`--break-guard`/`--break-boom` + `npm test` 兩段 + **bal 全綠** + `npm run sim` + ㋔ |
| 三種載具形式 / 彈道 | `audit_flight_power` Ⅰ・Ⅱ ±`--break` + e2e 三段 + **bal ⑦f**(三招實得比 MUST ≤1.8× 且全數 > 0;改 `KAMI_EQ`/半徑 MUST 回頭看這一項) |
| 載具 HP 校準 / 爆風面積 / `SPECIAL` 預算 | `audit_flight_power` Ⅰ + e2e「載具 HP 一律由砲塔反解」+ **bal ⑦f 與 ⑦c** —— **改砲塔任一數值或波次編制 MUST 重跑全部** |
| 飛行動力學 | `audit_flight_power` Ⅲ~Ⅵ + e2e「bot 飛行機體受擊掉高」+ ㋒(bal 不模型化飛行高度) |
| 射程球心 / 出膛初速 / 飛行時間 / 榴彈火控 / 射程界 | `audit_weapon_gate` Ⅳ・Ⅴ・Ⅵ・Ⅺ・Ⅻ ±`--break` + `npm test` 該段 + ㋒(bal 不模型化彈道)+ ㋔ |
| 射程閘門容差 / 爆風量體 / 光暈 / 高度制空 | `audit_weapon_gate`(八段)+ ㋒ + ㋔ |
| 高地壓制(`HIGH_SUP` / `sim._stampSup`·`_supF`·`_missP` / `bots._speed` / `game._mobility`)| `audit_weapon_gate` ③b + **反向驗證四支**(拿掉 `_damage` 的戳記 / 補償改吃 `pm` / bots 不折速 / **三個值歸零 + `ALTITUDE` 爆擊代價還原 ⇒ `npm run bal` MUST 逐位元回到上線前**,最後這支是這一族最有力的一道)+ **`npm run bal` 全綠且 ①②③④⑥⑦ MUST 逐項不動**(那些全是同高度模型 ⇒ 動了就是壓制漏到 dh = 0 的路徑上)+ `audit_speed_comp` Ⅳ(唯一取速處多一個乘數,形狀仍釘死)+ `npm test`(**MUST 先重啟伺服器**;高空拆堡那一場會變慢)+ `audit_client_syntax`(㋖)+ ㋔ + **真機冒煙**(㋕:移速那一軸沒有任何離線模型在守 —— ⑤ 幾乎不計價、⑦ 是同高度模型) |
| 閃避範圍(`evadable`)/ 爆風逐目標擲骰 / 維持 DPS 補償 / NPC 爆炸型武器 | `audit_weapon_gate` ⅩⅢ + **反向驗證六支**(拿掉爆風擲骰 / `continue` 改 `return` / NPC 改回單體直擊 / 拿掉補償 / 補償改吃全體平均 / 補償也套到輕武器,六支 MUST 各自紅字)+ **`npm run bal` 全綠,且 MUST 與改制前(`git checkout <main> -- data.js sim.js tools/`)逐項對照** —— 補償後期望值不變 ⇒ 差異只該剩「散彈輕武器不再被誤判成可閃」那一項(s04/s09/t03) + `npm test`(**MUST 先重啟伺服器**)+ `audit_speed_comp`(閃避門檻同一條速度軸)+ ㋔ |
| 射後不理追擊 / 爆風擴散 | `audit_weapon_gate` Ⅸ・Ⅹ + ㋒ |
| 地形稜線遮蔽 | `audit_weapon_gate` Ⅷ + ㋒(e2e 不上傳 `hgt` ⇒ 確定性斷言 MUST 全數不動)+ **重算 `server.js maxPayload` 餘裕** |
| 直線貫穿命中 / 垂直帶換框 | `audit_lance_hit` ±反向驗證 + ㋒ |
| 導引 / 射後不理鎖定(A41) | `audit_weapon_gate` Ⅵ + ㋒ |
| 填彈(`_refillIfDone`/`_gateFire`/`heroReload`)/ 扇形錐緣 | `audit_weapon_gate`(Ⅴ-b)+ `npm test` 兩段(AoE 各跨**三個彈匣** —— 只驗一匣一定全綠)+ **bal 全綠**(⑦ 的 fan 幾何本來就已算到量體 ⇒ 模型不動)+ ㋔ |
| `hitH`/`TARGET_H`/`HERO_SIZE`/`hitR`/`TARGET_R` | headless `_blast` 直測(垂直帶內同額、`EDGE·r` 外歸零、塔頂 = 塔底)+ `audit_lance_hit` + `audit_weapon_gate` Ⅲ |
| `AIR`/`envTrigger`/`TERRAIN_FX` | headless 直測(小跳仍踩雷、蓄力跳不踩;無人機 y=10 仍灼傷;騰空 wet 立停)+ 真機水域冒煙 |
| `aoeClass`/`trajClass`/`LANCE`/`ARMING` | 32 角分類覆蓋 + `heroLance` 衰減直測(首發全額、之後 `DECAY^i`)+ bal 不動 |
| bot 操作節奏 `BOT_DIFF`/`BOT_OPS` | e2e「電腦難度操作節奏」+ `npm run sim` + 沙包輸出 MUST 隨難度單調遞增 |
| bot 視野 / 碰撞 | `audit_bot_vision` + `npm test`(bot 沿兵線推進)+ **AI 退化量測**(見 5.6)+ ㋒ |
| bot 戰術 | `audit_bot_tactics` + `audit_bot_vision` + `audit_blood_splat`(`_hurtLog` 共用縫)+ `npm test` + `npm run sim`(**MUST 仍分得出勝負**)+ **AI 退化量測** |
| bot 定位分類與策略 | `audit_bot_role` ±`--break-role`/`--break-norm`/`--break-tier` + `audit_bot_tactics`/`audit_bot_policy`/`audit_bot_vision` + `npm test` + **bal 不動**(平衡指紋未變 ⇒ botPolicy.js 不過期)+ `npm run sim` + **AI 退化量測** |
| bot 學習策略 | `audit_bot_policy` ±`--break-clamp`/`--break-neutral` + `audit_bot_tactics`/`audit_bot_vision` + `npm test` + `npm run sim` + `npm run audit:net`/`audit_solo_boot`(data.js 多一支 import)+ **bal**(中性逐位元同舊制;學習輪落地後四不變式仍 MUST 全綠) |
| NPC 飛行高度基準 / 客戶端單位碰撞 | `audit_npc_collide` ±`--break-ratchet`/`--break-deck`/`--break-sweep` + `audit_bot_vision`(伺服器那半 MUST 逐位元不動)+ ㋔ + ㋒ |
| 世界高度上限 | `audit_world_height` ±`--break-ceil`/`--break-obj`/`--break-cap` + `audit_siteplan`(`placeBoundary` 多吃 `objScaleFit`)+ ㋔ + ㋒ |
| 世界邊界 / 邊界牆型錄 / 緩衝布景 / 視線背景 | `audit_world_edge` ±`--break-lap`/`--break-buffer`/`--break-fit`/`--break-face`/`--break-run`/`--break-slope`/`--break-boxh`/`--break-land` + `audit_slope_move`(坡度門檻是共用的那兩條線) + `audit_siteplan`(`placeBoundary` 的沙箱要多注入 `edgeWallDeepM`)+ **裙 MUST 擺在 terrain.js 開挖/射線/打洞三支稽核抽原文的標題之外**(落在裡面那些沙箱會一起執行而 `ReferenceError`)+ `audit_cel_pipeline`/`audit_world_curve`(envMat 計數與水面分段 MUST 逐位元不動)+ `audit_client_syntax`(㋖)+ `audit_net_modes`/`audit_solo_boot`(新增客戶端模組)+ `audit_beacons`(`mergeGeos` 多一個選用參數,不給 = 逐位元同舊制)+ **`shot_scene` 的 `edge_wall`/`edge_far` 兩張(㋓:這一整套只有站在邊界往外看才看得到)** + ㋔ + ㋒ |
| 世界曲面 | `audit_world_curve` ±`--break-knee`/`--break-edge` + ㋔ + **`audit_client_syntax`**(㋖;曲面的 GLSL 都住樣板字串裡,舊 Ⅷ 段的窄版語法閘已整併進那一支)+ `npm run audit:net`/`audit_solo_boot`(toon.js 多一條 data.js import)+ **`npm test`/`bal` MUST 逐項不動** + `shot_scene ?curve=0`(㋓) |
| 景深模糊 | `audit_visual_prefs` Ⅵ ±八支 `--break` + `audit_gpu_lifecycle` ⑦ + `audit_cel_pipeline`/`audit_soft_stroke`(**勾線的 alpha 契約 MUST 逐位元不動**)+ **`npm test`(data.js 動了 ⇒ 不是 ㋒,但 MUST 逐項不動)** + `npm run audit:net`/`audit_solo_boot` + `audit_ui_layout` + `shot_scene --dof=0`(㋓) |
| 畫面旋鈕 / 陰影偏色 / 風化場 / 零件抖動 | `audit_visual_prefs` ±反向驗證 + `audit_cel_pipeline`/`audit_gpu_lifecycle` + `audit_object_joints` + `audit_ui_layout`/`audit_ctrl_mode` + ㋒ |
| 軟性物質 | `audit_soft_stroke` ±`--break-ink`/`--break-anchor` + `audit_cel_pipeline`/`audit_gpu_lifecycle`/`audit_visual_prefs` + `audit_object_joints`(擺動是頂點位移 ⇒ 零件表接合 MUST 逐位元不動)+ `audit_siteplan`/`audit_beacons` + ㋒ |
| 賽璐璐管線 / 描邊寬度 | `audit_cel_pipeline` ±`--break-scale` + `audit_gpu_lifecycle` ⑦ + **`shot_scene` 前後對照 + 幀時量測(㋓;這是唯一決定勾線可不可行的數據)** + ㋒ |
| 表現層資源生命週期 / `RES_GOV` | `audit_gpu_lifecycle` + 真機 60s heap 不單調上升 |
| 程序生成物件擺位(`BUILDERS`/`VEG_DEFS`/`vegPartXform`/`MEGALITHS`/`synthMegalith`/`decorateMegalith`/`rockProbe`) | `audit_object_joints --seeds 8`(約 23000 接合;FLOAT/PARTIAL/DETACHED/ISOLATED 四硬失敗;豁免附理由;巨岩段含「兩端支承」具名救援) |
| 場址配置(都市計畫 / 羞避 / 地質排列) | `audit_siteplan` ±`--break-line`/`--break-shy`/`--break-strike` + **`intake_parts`**(外廓契約 + 三角形**兩道閘**:單件 ≤ 族上限、**逐款 Σ 庫零件 ≤ `kind_factor` × 該款現值**;**改 `GIANT_DEFS` 任一零件表 MUST 重量 `tri_budget.json` 的 `kind_tris`**)+ `audit_beacons` + ㋔ + **`audit_traverse`(㋓:沿街多出數百棟 ⇒ 街廓夾出來的通道要仍走得通;沙箱降級的未驗結果 MUST NOT 當綠燈)** + ㋒ |
| 聚落場 / 建物來源信任階梯 / 場地 `mix` | `audit_siteplan` Ⅴ・Ⅵ・Ⅶ ±`--break-gate` + `audit_venue_biome --offline` ±`--break-clip`/`--break-roster`(兩支都落在離線那一段 ⇒ CI 收得到)+ **完整版 `audit_venue_biome`(㋓)** + ㋔ + ㋒ |
| 建物零件庫(整棟量體 / 三帶 UV / 層高) | `audit_siteplan` Ⅴ ±`--break-mass`/`--break-mass2`/`--break-roof`/`--break-storey` + `intake_parts`(含 **UV 契約**,反向驗證兩支)+ **逐位元不變 MUST 用量的**:`measure_building_tris --live --osm-cache` 錄播 Overpass 後做 A/B(同一張圖兩次 `--live` 差到 ±70%)+ `shot_facades` 排面與 `shot_scene` 的 `mass_near`/`masslow_near`(㋓)+ 3D 零件對照台 0 缺件/0 孤兒/0 未記載 + ㋔ |
| 整棟量體的**碰撞剖面 / 尺寸貼合 / 招牌落點 / 窗間距**(`bldProfile`/`profGeo`/`fitNode`/`fitScale`/`slabBox`/`bldFace`/`MASS.UVB`/`FACADES[].win`/`nodeProfile`/`--uvbands`) | `audit_siteplan` Ⅴ ±`--break-prof`/`--break-fill`/`--break-glass`(各紅 4 / 1 / 2 條)+ **`intake_parts`**(剖面宣告 = 實測、三帶 v 界、名冊涵蓋率)+ `audit_auto_intake` ±`--break-append`(名冊追加要連剖面一起補、撤下要逐位元可逆)+ `audit_object_joints --seeds 8` + `audit_beacons` + `audit_client_syntax`(㋖)+ **`npm run bal` / `npm test` MUST 逐項不動**(平衡與 sim 一行未改)+ **改剖面段數/名冊 MUST 回頭看 `LOS.MAX_OCC` 餘裕**(16 棟 ×(段數−1)根柱)+ **㋓:`shot_scene` 的 `mass_near`/`masslow_near` 與 `shot_facades`**(三帶接縫落在哪、無縫玻璃牆讀不讀得出來、撐滿基地後的比例,只有截圖看得到)+ **㋕:貼著塔走一圈**(退縮平台站得上去、上半段不再撞到空氣)+ `audit_traverse`(㋓;地面層通行寬理應逐位元不動) |
| 鏡像貼補 | ⚠ **先看 `docs/ai3d_runbook.md` §5aj-C**(改制待執行)+ `mesh_sym --gate` + **`node_sheet --ref`(四面黏土對照 —— 這一族的錯只有截圖看得到)** + `intake_parts`(外廓與預算 MUST 逐位元不動)+ `audit_object_joints --seeds 8` + `audit_beacons`/`audit_siteplan` + 3D 對照台 0-0-0 + ㋒ |
| 語意化地標 | `audit_beacons` ±`--break-extent`/`--break-pad` + `audit_object_joints`/`audit_gpu_lifecycle` + ㋒ |
| 世界文字 | `audit_world_text` ±反向驗證 + `audit_vernacular` + **`shot_signs`(㋓:版面與缺字偵測只有這裡看得到)** + `audit_visual_prefs`(旋鈕表多一個 `choices`)+ ㋔ + ㋒ |
| 在地文字語料 | `audit_vernacular` ±反向驗證 + `audit_world_text` + **重跑 `bake_venue_text.mjs`**(不重烤 = 底本走舊規則、執行期補收走新規則,兩份語料在同一張圖上打架)+ ㋒ |
| 角色 / 機體檔案格式 | `audit_codex` ±`--break-layer`/`--break-align`/`--break-pose` + `gen2d --audit` + `audit_hex_stats`/`audit_ui_layout`/`audit_ctrl_mode` + `audit_net_modes`/`audit_solo_boot`(新增客戶端模組)+ ㋒ |
| 機體台紙娃娃系統(`tools/humanoid_forge/` 的 `doll.js`/`shapes.js`/`mark.js`/`dollapply.js`/`dolledit.js`/`specstore.mjs` 與 forge.js 的 `finishUnit`) | `audit_paper_doll` ±`--break-clamp`/`--break-key`/`--break-seam`/`--break-order`/`--break-roster`/`--break-patch`/`--break-socket` + **兩座看板各開一次**(㋕:覆寫層是共用的,覆核台調比例之後機體台的紙娃娃 MUST 還在)+ ㋒(全在 `tools/`,遊戲一行未動 ⇒ `npm test`/`npm run bal` MUST 逐項不變)。改 `mechs/<key>.js` 的**零件順序** ⇒ 舊覆寫會落到別的零件上(鍵 = 建構序路徑),MUST 在該機體台上目視覆核一次 |
| 塗層阻擋 / 隧道頂板 | `audit_layer_block` ±反向對照 + `audit_underpass`/`audit_open_tunnel`(幾何 MUST 逐位元不變)+ ㋒ |
| 明隧道 | `audit_open_tunnel` + `audit_underpass` + `audit_slope_move` + `shot_tunnels`(㋓) |
| 地下道 / 結構資格閘 | `audit_underpass` ±反向驗證(`gMinOf` 只量中心線 / 拿掉基準線收斂 / 拿掉全寬拆縫) |
| 地圖主方位(`mapRot`/`rotXZ`/`llToXZ`/`xzToLL`/`battleRect`/`battleBBox`/`venueGrid.js`/`roadGridRotDeg`/`GRID_HW`/`main.resolveMapRot`/`biomes.fetchGridRoads`) | `audit_road_grid` ±`--break-drift`/`--break-dense`/`--break-relax`/`--break-rotbox`/`--break-rotover` + `audit_client_syntax`(㋖)+ 改角度推導或取樣面 MUST 跑 `bake_venue_grid --only manhattan,barcelona,chicago,kyoto,shibuya --dry`(㋓)並與 `venueGrid.js` 現值比對 —— **烘焙 MUST 冪等**,重烤跑出不同的值就是有人動到抓取範圍或量測框 + **`audit_world_edge`**(裙的原文沙箱自由變數清單要跟著走,漏一個就是 `ReferenceError` 而其餘原文斷言照樣全綠)+ `audit_ground_qc` ⑦ + `audit_weapon_gate` Ⅻ⑷(sim.js 的比例尺原文閘)+ `npm test`(**MUST 先重啟伺服器**)+ **`npm run bal` MUST 逐項不動**(旋轉是等距同構)+ 改 `gridAngle`/大馬路取樣面 MUST **重烤 `venueGrid.js`**(㋓)|
| 道路 16 方向量化(`roadgrid.js` / `biomes.js` 的接線) | `audit_road_grid` ±三支 `--break` + `audit_road_joint`/`audit_road_bed`/`audit_underpass`/`audit_open_tunnel`/`audit_bridge_crossing`/`audit_water_skirt`(走廊/橋隧全部吃量化後的同一份路網)+ `audit_siteplan`/`audit_ground_qc`(建物與擺件朝向取自道路)+ **`audit_traverse`(㋓:路網幾何動了,兵線與結構要仍走得通;沙箱降級的未驗結果 MUST NOT 當綠燈)** + 真機看一張市區圖(㋕)|
| 道路塗裝寬 / 結構接合 / 立體結構建置範圍 | `audit_road_joint` + `audit_underpass`/`audit_open_tunnel` 不變式 MUST 不動 |
| 道路路基整平 | `audit_road_bed` + `audit_slope_move` + 隧道兩支不變式 |
| 地形坡度移動 / `MAX_ROAD_GRADE_DEG` | `audit_slope_move` |
| 地形射線 / 打洞 | `audit_terrain_ray`(與暴力掃逐條一致;加速比 MUST 兩位數) |
| 可通行性 | `audit_traverse` ±`--break-slope`(㋓;另有四項**不需網路**的開挖鏡射行為直測) |
| `SOLDIER_H`/`HERO_SIZE.mul`/`BRIDGE_RISE`/`TUN.CLEAR` | `audit_traverse` 的「淨空」段(剖面寫錯基準是**完全無聲**的);機體高度 MUST 由 `heroTargetH` 推導,MUST NOT 手寫 4.5 |
| 攀爬路線 / 障礙橫斷面 | `audit_climb`(Ⅲ 兩端對同一盒同線段 MUST 同判) |
| 橋交會去重(`dedupeCrossingBridges`)/ 馬路橫切繞行(`skirtWaterClips`/`PED_HW`)/ 橋上砲塔墩座(`planTowerBridgePads`/`TOWER_PAD_AXIS`/`TOWER_BASE_R`) | `audit_bridge_crossing`(優先度 兵線 > 鐵路 > 大馬路 > 小馬路;鐵路容差 `gap=0` 只認真交叉)/ `audit_water_skirt`(斜交對稱穿越 MUST 建橋不繞;步道一律不進橋樑管線)/ `audit_bridge_tower_pad`(沿橋軸與水側走位帶 ≥ 基座 + 8m;`TOWER_BASE_R` 不變) |
| `venueLanes.js` 重烤 / `TOWER_*` / `tower.range` | `audit_map_rules`(#4)+ `audit_lane_sep` + `audit_lane_grade_sep`(#5) |
| 兵線導航規則(`UTURN_MAX_DEG`/`TURN_ACCUM_MAX_DEG` + 三支 audit/bake 閘門) | `audit_lane_navigation`;規則①③生效於既有場地需重烤(㋓)+ **`audit_traverse`**(前者驗幾何契約、後者驗「機體真的走得過去」,不可互相取代) |
| 場地場景標記 / `VENUES[].ll` / `MAPGEO` | `audit_lane_scenarios`(標記 MUST 由實測產生;③⑨ 分流只有 `spansWater()` 一支)+ 重烤(㋓) |
| 場地選單的路線/地形說明(`venueRoute`/`reliefTier`/`RELIEF_TIERS`/`venueTip`/`venueBrief`/`renderVenues`/`.venue-desc`) | `audit_ui_layout`;摘要 MUST 全由 `venueConfig()` + `laneTacticsXZ()` 推導(手寫長度/彎曲度 = 重烤兵線後靜默分家)、起伏門檻 MUST 是 `altTier()` 的倍數(與 ⑧ 判定同一把尺)、說明 MUST 走 `tip.attachTip`(MUST NOT 退回 `title=`)、換人數 MUST 重掛 |
| 塔或機甲任一數值 | 重算 `towerHp = 1.8 × heroEHP × heroDPS / towerDPS` |
| `MAP_EXPAND`/`CLEAR_F`/`LANE_MIN`/塔位 | headless 建 `BattleSim` 數 `sim.camps.length`(L1 2/2、L2 4/4、L3 6/6) |
| 地貌交界(`planSeamOverlays`/`SEAM_STYLES`/`seamAlpha`)/ 小區域組合風格(`planEnclaves`/`ENCLAVE_STYLES`)/ 都市規劃朝向(`ground.js` orient/`gridA`) | `audit_ground_seam` / `audit_ground_enclave`(**消費端 MUST NOT 硬編第二份組合表**)/ `audit_ground_qc` ⑦(垂直街道網 mod 90° 摺疊不抵銷;orient 固定抽 2 枚 rnd)—— 三支皆需 `audit_ground_qc` 全綠 |
| 功能性區塊 / 3D 物件互不重疊(`PATCH_GAP`/`DET_GAP`/`obbDist`/`obbNear`/`footNear`/`detailR`/`overlapPs`/`detFree`;2026-08-11 使用者定案「田/停車場/球場這類功能性區塊與 3D 物件等等也不可互相重疊」) | `audit_ground_qc` ⑤(執行原文 + 內建對照組:退回等面積圓的壞版本必須又放行互切案例)+ `audit_siteplan` + `audit_object_joints --seeds 8` + **`tools/shot_borders.mjs`(㋓:印「互相重疊 區塊/擺件」硬指標 MUST 全 0 —— 足跡自真品幾何反推,離線稽核看不到實際落點)** + ㋒。**判定 MUST 吃真實足跡**(rect 有向盒 / blob 手繪輪廓外接圓),等面積圓近似 MUST NOT 復辟;`PATCH_GAP` MUST < 陣列間隙 1.6 與家族延伸間隙 1.2(否則沿街格陣與農田拼布被自己的規則拆散);自然類↔自然類刻意維持 `SEP_F` 邊緣互融 |
| 地貌拼圖的顏色與花紋(`CARPET_LOT`/`carpetLotAt`/`planCarpetVariants`/`CARPET_VARIANTS`/`baseFill`/`emitFace`/`face9`)、緩衝空間底毯(`BUF_CELL_F`)(2026-08-12 使用者三項回報) | `audit_ground_tile` ±`--break-lot`/`--break-var`(對照組 = 舊制,內建)+ `audit_ground_seam`(**同款異變體不發外溢**;鏡射實作要跟著有這一條)+ `audit_ground_enclave`/`audit_ground_border`/`audit_ground_qc` + `audit_siteplan`/`audit_object_joints --seeds 8`(底毯選款一換,`scatterDetails` 撒的細節種類跟著換)+ `audit_world_edge`(緩衝空間多了一層底毯,裙本身一格未動)+ `audit_client_syntax`(㋖)+ **`shot_scene --dof=0 --curve=0` 的 `edge_far`/`hilltop`/`lane_mid`(㋓:「緩衝空間看起來是不是一床方塊拼被」「顏色是不是還在跳」只有實拍看得到 —— 離線稽核只量得到換色間距的中位數)** + `shot_borders`(㋓)+ ㋒ |
| 地貌界線拼圖(`planBorderPuzzle`/`BORDER_KINDS`/`BORDER_STYLES`/`borderKindOf`/**`borderCornerArc`**;16 方向直線/轉彎/岔路,接力連結;**轉彎與岔路是整片畫出來的接頭拼圖** —— 直段退縮讓位、圓弧與兩臂相切、逐臂楔形在中心交會,MUST NOT 退回對接+墊片)/ **繞向 `sweepUpY`** / **兩側切線 `BORDER_CUT`+`borderCutAlpha`+`planSeamOverlays` 的 `hardOf`** / **帶量測 `BORDER_BAND`+`bdCross`**(2026-08-11 使用者三項回報) | `audit_ground_border`(對照組 ⓐ~ⓗ 內建)+ `audit_ground_seam`(subCoarse 仍一份 / 切線判準轉呼 `borderKindOf`)+ `audit_ground_qc` + `audit_siteplan`(拼圖迴避改了 `tryPatch` 的前置閘)+ `audit_object_joints --seeds 8` + `audit_client_syntax`(㋖)+ **`tools/shot_borders.mjs`(㋓:26 種底毯地表兩兩 325 組的實拍圖錄;走真品 `buildGroundCover`,取景瞄真的畫出來的分界線頂點並與 `borderKindOf` 雙向核對,並印出**「橫跨分界線」硬指標 MUST 全 0**(拼圖與擺件的迴避住 `tryPatch`/`addDetail`,那兩支要 THREE ⇒ 離線稽核碰不到)—— 「哪一組交界看起來不對」只有這裡看得到)** + ㋒ |
| 小地圖顯示範圍 | `audit_minimap_view` |
| 視野鎖定 | `audit_view_lock` + `audit_touch_layout` + `audit_ui_layout` |
| 觀戰相機 | `audit_spectator_cam` + `audit_ctrl_mode` Ⅶ + `audit_touch_layout` + `audit_ui_layout` + ㋒ |
| 受擊濺血 | `audit_blood_splat` + ㋒ |
| 致盲白幕 / 蓄力跳 | `audit_cc_flash` |
| 操作方式 / 戰場選單 | `audit_ctrl_mode` + `npm test`「操作方式由房主選擇」段(**MUST 先重啟伺服器**,見 5.2)+ `audit_touch_layout` + `audit_ui_layout` |
| 懸浮提示 / 按鍵風格 / 房間設定分頁 / 圖示 | `audit_ui_layout` 0.5 段 + `audit_ctrl_mode` Ⅲ + `audit_touch_layout` + ㋒ |
| `mobile.js`/`_applyLook`/`_moveAxis`/`_cmd`/觸控 CSS | ①桌機 MUST 不回歸 ②`audit_touch_layout`(四分區零重疊、觸控目標 ≥44×40、`.tl-sys` 固定 grid)③疊層可點性 ④`audit_touch_gesture` |
| 橫式商店兩欄 / 全螢幕方向 | `audit_touch_layout` 升級工坊段(六種持握)/ `audit_ctrl_mode` Ⅶ(原文無 `orientation.lock`、`unlock()` 恰兩處) |
| `#touchLayer` 節點位置 / `--tl-*` | 搖桿 MUST 留 body 層 + 保留 `body.touch-ui` 保險預設值;真機大廳端對端量測 |
| 選單版型 / 任何鈕面文字 | `audit_ui_layout`(鈕面無括號補述、桌機並排直式維持並排、`.cd-art` 解除 sticky、疊層 ✕ 規則) |
| 陀螺儀(`Gyro`/`gyroSrc`/`LOOK.GYRO_*`/`TOUCH.gyro` 預設值) | `audit_gyro`(兩感測路徑、俯仰同號、自動切換、**宣告的預設值為關**)+ `audit_ctrl_mode` Ⅶ(預設值的 CI 版斷言 —— audit_gyro 要 playwright,沒裝就整支跳過)+ **MUST 用 https/localhost 真機測**(非 secure context 靜默無感測事件) |
| FPV 座艙取景(`COCKPIT`/`ndcH()`/`_buildCockpit`) | `audit_cockpit`(視野帶淨空、裝置 < 武器、消失點對準星;頂緣逐頂點投影量測) |
| 骨架 / 關節 / 步態 / 武裝掛點 | 全角色 rig 稽核 + `audit_cast_jump` + `audit_muzzle`(32 英雄 + NPC 四陣營) |
| 三種遊戲機制 / 單機打包 | `audit_net_modes` + `audit_solo_boot` + `npm test` 單機段與 WS 全段 + `audit_ui_layout` |
| 路網中繼(`osmrelay.js` / `biomes.js` 的定案表與兩支 fetcher / `main.js` 的 `osmGate`·`onOsmRelay` / `rooms.js` 的 `t:'osm'`) | `audit_osm_relay` ±`--break-monotone`/`--break-clone`/`--break-wait`/`--break-cache`/`--break-label` + `npm run audit:net`/`audit_solo_boot`(新增客戶端模組 + rooms.js 多一條 import)+ `npm test`(**MUST 先重啟伺服器**;WS 段有中繼來回的行為直測)+ `audit_client_syntax`(㋖)+ biomes 那一批(siteplan/beacons/open_tunnel/underpass/road_joint/world_text/object_joints;圖資輸入的來源變了,幾何 MUST 逐項不動)+ **`npm run bal` 與 `npm test` 的模擬段 MUST 逐項不動**(平衡與 sim 一行未改)+ 改任一上限或動到 Overpass 查詢額度 MUST 重跑 **`tools/measure_osm_relay.mjs`**(㋓;實測 5v5 密市區 1.05MB = maxPayload 餘裕 1.9× / MAX_BYTES 餘裕 1.6×,不厚)+ **兩台同房實測(㋕:一台開房、一台入房,比對橋隧與建物;中繼壞掉的症狀是「你說的那座橋我這邊沒有」)** |
| 區網同時多路徑 | `audit_net_modes` ⑥(含起真 server 打四路的行為直測)+ `npm test` WS 全段 |
| 主堡陣營歸屬對調(`rooms.rollSideSwap`;開房 + 再戰回房各擲一次) | `audit_net_modes`(實作一份、恰兩處呼叫、**MUST NOT 移進 `startBattle`** —— 那會讓客戶端房間階段的地形預建整份作廢)+ `npm test` 該段(**MUST 先重啟伺服器**) |
| 開發工具啟停 / dev 對照台 | **`npm run audit:net` ⑦ 段**(全專案唯一「HTTP 進來 → spawn 行程」的路徑 ⇒ 閘門本身就是要驗的東西)+ `audit_ui_layout` (8) 段(`main.js` **一個埠號都不准寫死**)+ `npm test`(伺服器有動,不是 ㋒) |
| 採集端 / 圈選分離篩選(`tools/ai3d/*`) | `audit_split_targets.py` ±`--break-contain`/`--break-erode`/`--break-touch` + `fetch_photos --plan`/`--adopt` 行為直測 + `harvest_loop --dry` + `intake_parts`(讀取縫未動 ⇒ MUST 逐項不變)+ ㋒(全在 `tools/`,遊戲一行未動) |
| 採集迴圈啟停 / 圖檔三態 / dev 工具型錄 | **`npm run audit:net` ⑦ 段**(逐工具依 `kind` 分流:job MUST 無埠、存活判準是子行程;含起真 server 打 `/dev/tools` 的行為直測 —— **逐支真的啟停一次**那一段是這一族唯一驗得到「按下去到底有沒有反應」的地方)+ `audit_auto_intake` Ⅸ ±`--break-spawn`/`--break-panel`/`--break-home-arg`/`--break-on` + `audit_solo_boot`(dev_supervisor 多一條 import)+ `audit_ui_layout`(`main.js` 一個埠號都不准寫死;鈕面 MUST 讀推導欄 `on`)+ **`npm test`**(server.js 那條路由的後端動了)+ 起零件台**用非預設埠**實測(㋕;8622 跨 session 存活 ⇒ 在預設埠上驗到的是舊程式碼)+ **真的按一次那顆鈕**(㋕:兩個入口都要 —— 遊戲設定頁與零件台窄帶;「鈕面沒反應」在離線稽核上只表現成原文對不上,而原文是可以改對而行為仍錯的) |
| 封存區 / 判決字彙 / 來源帳鍵 / 重跑順位 | `audit_auto_intake` Ⅷ・Ⅺ ±`--break-keys`/`--break-redo`/`--break-archive` + `parts_review --report`(**封存那幾列 MUST 印得出來**;缺件/孤兒/未記載仍三個 0)+ `apply_verdicts --dry`(行為直測:archive 分支要印「撤節點並封存」且來源圖張數 **> 0** —— 印 0 就是鍵的正規化又壞了)+ `harvest_loop --dry` 開關 `--no-redo` 各一次(重跑張數 MUST 只差在那一項)+ ㋒(工具動了,遊戲沒動) |
| 自動入庫 / 撤下 / 判決迴路 | `audit_auto_intake` ±`--break-append`/`--break-rollback`/`--break-blacklist` + `intake_parts` + `parts_review --report`(缺件/孤兒/未記載 **三個 0**)+ `apply_verdicts --dry`(**行為直測**:輪替名冊 ≥2 的煞車與單一字串格的擋下都要看得到)+ `harvest_loop --dry`(新的 ⑦⑧ 兩站要印得出來)+ `audit_siteplan`/`audit_beacons`/`audit_object_joints --seeds 8`。**工具動了但遊戲沒動 ⇒ `npm test`/`npm run bal` MUST 逐項不變**;真正跑一次入庫要 Blender + GLB ⇒ ㋓(3060 那台) |

### 5.6 AI 退化量測(bot 改動專屬)
- **MUST NOT 拿 `npm run sim` 的勝負旗標** —— 5v5 塔+主堡總 HP 數十萬,改前改後在 1800s 上限內一律「未分勝負」,二元訊號天生飽和。
- 判準以**變異小的結構性指標**為準:`繞行%`(`_skirtUntil` 生效的 tick 比,高難度 5v5×600s ≈ **4.0%**,SD≈0.2 —— 全套指標裡唯一精確的一個;卡死就會飆高)≫ `engage%`(≈ **9%**;視野錐有沒有誤殺交戰機會看它)≫ 開火數。工事損血只用來看有沒有塌到量級外。
- **樣本數 MUST 跟著場景規模走**:5v5×600s 的單場工事損血在 433~10298 之間跳 ⇒ n≤3 能同時「證明」變好與變壞(2026-08-02 兩個方向各踩一次,補到 n=6 才看出值域幾乎完全重疊)。2v2×240s 的基準是 **24 場**平均(高難度:工事損血 ≈3600、擊殺 ≈76、RALLY 佔比 ≈0.10 —— RALLY 佔比衝到 0.3 以上就是「bot 一直在撤退」)。
- **取 base 對照時 `git stash` 不可靠**(變更已 commit 就是 no-op,會安靜地拿新程式碼當基準;切分支也會污染仍在跑的背景樣本)—— 一律 `git show <rev>:path` 把 `sim.js`/`bots.js`/`data.js` 三支倒進暫存目錄各跑各的。
- 定位分類專屬:定位版 vs 關掉 `_resolveRole` 的同一批 bot 做 **CRN 配對鏡射**自對戰,量工事損血差。

---

## 6. 退場清單(MUST NOT 復辟)

> 這些是**已經移除**的機制。看到「這裡好像少了一塊」而想補回去之前,先讀這一列 —— 移除本身就是定案(原則 10)。

| 退場 | 日期 | 取而代之 |
|---|---|---|
| 「爆炸傷害納入閃避 = 它整組變弱」| 2026-08-12 | 使用者定案「**維持 DPS 提高傷害,閃避率不動**」:`evadeCompF(p)` 把被閃掉的期望輸出還給沒被閃掉的那幾發 ⇒ `npm run bal` 逐項回到改制前。MUST NOT 改回「調低爆風的閃避率」那條路(使用者明說閃避率不動)|
| 「有爆風 `r` ⇒ 不可閃」(NPC 分支)與「招式不吃閃避」(`ALTITUDE` 註)| 2026-08-11 | `evadable()` 單一縫:輕武器直射 + 一切爆炸傷害全吃閃避,逐目標各自擲。使用者定案「所有攻擊招式也加入閃避機制」 —— 高度差與爆擊仍不吃(**AoE 不爆**是另一條定案,MUST NOT 一起改掉)|
| **bal ③「10 分鐘升滿」不變式**(八軌總價 ≈ 賞金收入 ±10%) | 2026-08-11 | 使用者定案「移除此標準」。八軌改雙閘後升滿時間不再只由錢決定,這個比值量不到原本要量的東西;數字仍印出來當參考,**不判定、不計入 fail**。**編號不重排**(④~⑦ 保留原號) |
| **逐機種擊殺分數表** `KILL_SCORE`/`killScore()` 與**刷 bot 折價** `BOT_KILL_SCORE`(3) | 2026-08-11 | 戰鬥分數 `BATTLE_SCORE`/`battleScoreGain()`(擊殺 4 / 助攻 1,玩家**含電腦玩家**與砲塔 ×5)—— 使用者這一輪明講「玩家(含電腦)」同一個係數,兩份分數表並存就是兩套規則 |
| 八軌階梯常數 `ECON.UPG_BASE`/`UPG_INC`/`UPG_L3`/`UPG_L3_LVL` | 2026-08-11 | `ECON.UPG_STEPS` 逐階表(價格 + 戰鬥分數門檻同一列) |
| 陣營小兵強化的 `hp ×cu` 與**賞金 ×cu** | 2026-08-11 | 強化收斂成「只對非玩家生效」:傷害看目標、耐久看攻擊者(`creepDmgTakenF`)。hp 是全域的 ⇒ 留著它等於對玩家也變硬;賞金加成在小兵不再更難打之後就是白送 |
| **機種絕招**(飽和攻擊 / 集束炸彈 / 極音速飛彈)三個入口 `heroKamikaze`/`heroDecoy`/`heroHyper`、`rooms.js` 三條訊息、客戶端三支 `_launch*`、bots 三個區塊 | 2026-08-06 | 長按右鍵 = 招式手勢(`abilHoldSlot`);三種載具只服務大招遞送(`_launchUltCarrier`/`_launchUltSupport` 恰兩個生成點) |
| **常駐護衛機外觀** `ESCORT`/`escortSlot()`/`escortLagBase()`/`escortLagK()`/`escortDrift()`、`game._buildDroneEscorts`/`_updateEscorts`、`audit_escort_form.mjs`;HUD 的 `kcd` | 2026-08-06 | 「攻擊時再出現」= 把常駐那一段刪掉即可(衝出後的 kami 本來就是伺服器實體、走一般渲染路徑)。那批模型看得見、跟著飛、卻不在 sim = 原則 4 的反面 |
| **重砲模式 / 巨砲** `BARRAGE`/`barrageShots`/`barrageDur`/`LANCE.BARRAGE_F`/`_barragingDmg`;`lanceR` 的第二參數 | 2026-08-01 | 重武器射擊路徑上 MUST NOT 再有任何「免彈夾/免電力/免射速閘」的旁路 |
| **建築加成** `GRENADE.BUILDING_MUL`/`grenadeBuildingMul` | 2026-08-02 | `vs.building ≤ BUILDING_VS_CAP`(=1)的推導夾制迴圈(A34) |
| **榴彈的錐形瞄準輔助** `game._aaTarget()` + `BALLISTIC.AA_CONE` | 2026-08-10 | 準星那一條射線就是全部(`_lobCrosshair`)。使用者定案「拋物線準星沒有瞄敵人時就是打地面」—— 錐形輔助是唯一能把落點從準星底下拉走的路徑,降級成「準星什麼都沒解到才接手」仍不夠(`ent` 為空同時涵蓋「打在地形上」與「指著天空」,而瞄地面正是榴彈的主要用法)。MUST NOT 以任何條件復辟 |
| **爆炸型豁免名冊**的內容(`AREA_WEAPONS` 保留為**空的具名縫**) | 2026-08-04 | 家族帶 `BLAST_BAND`/`blastFamily()`/`blastCapR()`;沒有任何爆炸型武器再享有豁免(A35 ⑧) |
| 逐武器手寫的 `move`/`slowF` 兩欄(開火中位移) | 2026-08-03 | `recoilMoveF()` 曲線(舊表**不單調**,「越大降越多」在它上面根本不成立) |
| 逐階手寫的 `BAR_MAX` / `heroStatCells`(圖鑑五條長條) | 2026-08-04 | 六角圖 `HEX_AXES` + `hexBand()` 推導 |
| **舊 `signage.js`**(第二份圖集 + 第二套逐實例 UV 規則) | 2026-08-03 | `worldtext.js SignSheet` 一張圖集一個 mesh(A37) |
| **自由字串 `lore.proto`** 與 `main.js` 的標籤正規式切割 | 2026-08-04 | 結構化原型層 `protoLayers()`(A40;`protoOf` 是出圖管線的第二個消費端 —— 讀舊欄位會拿到 `undefined` 而**提示詞裡最權威的一段整段消失**) |
| 飛行姿態取景的 `standing` | 2026-08-05 | `FORM_POSE` 的飛行那一組 MUST 明講機體離地在飛 |
| 舊 `KAMI.HP_F`/`DECOY.HP_F`/`DECOY.R`/`DECOY.BOMB_BLAST_R`/`HYPER.BLAST_R`/`hyperBlastR`/`HYPER.BLAST_R_F`/`APEX_F` | 2026-08-02~06 | 一律由砲塔火力反解(`kamiHp`/`hyperHp`/`decoyHp`)+ `specialBlastR()` 切分計價 |
| 極音速飛彈的**終端追擊** `m.chase`(規則與稽核**留著**) | 2026-08-06 起是**死碼** | `_launchUltCarrier` 恆給 `tid: 0`(點遞送不索敵)⇒ `m.chase` 永遠 false。要讓載具追蹤只需給 `tid`;**MUST NOT 自行刪除該定案**,收不收掉是使用者的決定 |
| 「物件最高高度 = **2 倍**砲塔高」 | 2026-08-08 定,2026-08-09 **作廢** | `OBJ_F 4 / CEIL_PEAK_F 4.5 / CEIL_AVG_F 6`(2 倍會讓 `MASS.MIN_H` 55 / `b.h > 55`/`>60`/`>100` 四條門檻**結構性地永遠不成立**,而所有離線閘門照樣全綠) |
| `RANGE_GLOW.TTL_S`/`ARC_PER_FRAME`/`RAY_PER_FRAME`(光暈分幀預算與 TTL 快取) | 2026-08-03 | 逐敵人各跑一次彈道積分的 `_shotVictims` 足跡名冊 |
| 航跡長 `b.dist`(逐彈道分支 `b.seek`/`b.lob`) | 2026-08-02 | 一顆球面管全部(`spent = 彈頭到發射點的距離`) |
| `bots.js` 直接寫 `h.x`/`h.z`;`BOT_TACTIC.` 直讀;本地 `BUY_ORDER` | 2026-08-02~08 | `_move` 唯一寫入點 / `this.tac` 唯一讀取縫 / `botBuyOrder()` |
| 機種分派表(比對 `isDrone`/`isMorph`)| 2026-08-06 | 隨機種絕招一併退場(A22) |
| 巨岩 `g.rotation.y = rnd() * Math.PI * 2` | 2026-08-03 | `cell.ry`(長軸對齊地質走向,A38 ⑦) |

---

## 附:另外幾份要看的文件

| 文件 | 內容 |
|---|---|
| `public/js/.claude.md` | 模組層:逐檔職責與活躍工作的細節 |
| `docs/smoke_tests.md` | 真機冒煙清單(§5 矩陣的 ㋕) |
| `docs/ai3d_runbook.md` | img→3D 資產管線:§0 定案(方法分流 / 零件庫邊界 / 提示詞規格)、§1~§4 現況與佇列、§5* 逐輪紀錄(§5aj-C 等待執行的改制在此)|
| `docs/map_grid_alignment.md` | 地圖主方位旋轉 / 道路量化 / 路網中繼 —— **只留未完事項**:使用者定案原句、**已排除的選項與理由**、㋕ 未驗項、還沒決定的。三階段的設計與禁令住 A42/A43 與各 `audit_*` 檔頭,逐檔改了什麼住 git 歷史與 PR #186/#188 |
| `docs/bot_design.md` | 電腦玩家定位分類 / 學習迴圈設計全文 |
| `docs/codex_format.md` | 角色 / 機體檔案格式規格書 |
| `docs/visual_upgrade_plan.md` | 畫面升級計畫(P1/P2 項目編號的家) |
| `docs/lane_scenarios.md` / `docs/tunnel_review.md` | 兵線場景 / 隧道覆核紀錄 |
| `docs/characters.md` / `docs/story.md` | 角色與敘事 |
| `docs/deploy.md` | 部署 |
| `CLAUDE-orig0718.md` | 2026-07-18 前的逐日檔案庫 |
