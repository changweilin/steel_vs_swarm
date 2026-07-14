# CLAUDE.md — 無人戰略:鋼鐵與蜂群 (Steel vs. Swarm)

## 1. 專案本質與架構

瀏覽器 DOTA+FPS:無人機 (SWARM) vs 機甲 (STEEL)。真實世界地圖選址 → OSRM 兵線 → 即時 3D 地形開戰。
技術棧:Node.js + `ws`(唯一 npm 依賴)、vanilla ES-module JS、Three.js 0.160(CDN importmap)。
**本專案無 build step、無 bundler、無框架、無 TypeScript — MUST NOT 引入以上任何一項。**
註解與 UI 字串一律繁體中文。

**心智模型(MUST 內化):伺服器是唯一真相 (server-authoritative)。**
HP/傷害/彈藥/經濟/勝負全部在 `server/sim.js` 結算;客戶端只送輸入與命中回報、渲染快照插值。
任何「客戶端先改狀態再同步」的實作都是架構違規,**MUST NOT** 出現。

| 路徑 | 職責 |
|---|---|
| `server/server.js` | HTTP 靜態檔 + WS 房間/配對 + 8Hz 快照廣播 + bot 管理 |
| `server/sim.js` | `BattleSim` — 權威模擬核心 (single source of truth) |
| `server/bots.js` | `BotBrain` 電腦玩家(推線/交戰/撤退狀態機) |
| `public/js/data.js` | 共用常數 UNITS/WEAPONS/ECON/GAME/HAZARDS/**CHARACTERS(24 陣營角色 + 8 傭兵 `side:'MERC'` 雙陣營可選、`kind` 綁機體;×專屬輕重武器/小招/大招×3 階)**/HEROIC/SQUAD/VITALS/PROG — **伺服器直接 import 這支客戶端檔**;所有平衡數值只准住這裡,英雄武器/招式一律經 `heroWeapon()`/`heroAbility()` 解析 |
| `public/js/lore.js` | 角色敘事文本(國籍/年齡/職務/外貌/生平/台詞 + 機體設計原型 `proto` + 立繪外觀提示 `art`)— **客戶端專用,伺服器不 import**;`data.js` 只住平衡數值,文字一律住這裡 |
| `public/js/paint.js` | 機體塗裝:`heroPalette()` 由角色 `visual.hue` 推導整套裝甲色版(lite/main/mid/dark/deep + 花紋用的 ink/ink2/paper/hot);`paintUnit()` 依 `visual.paint` 性格花紋(minimal/camo/graffiti/tattoo/totem/flag)生成程序 canvas 貼圖,以**靜止姿勢的機體局部座標**三平面投影上裝甲 |
| `public/js/portraits.js` | 程序生成 SVG 頭像/立繪(`avatarURL`/`portraitURL`);`PORTRAIT_MANIFEST` 登記手繪檔即覆蓋,呼叫端不變(同 `MODEL_MANIFEST` 模式) |
| `public/js/charPreview.js` | 選角畫面的 3D 機體展示台(拖曳旋轉 + 點武器/招式播放演出 + 變形機甲切換型態 + **雙擊機體切換移動/靜止演示**)。**預設縮小開啟,無關閉狀態**(見 §2);與戰場共用 `makeUnit()`,取景走包圍球(無人機寬 >> 高;變形機甲取兩型態聯集);施展招式時鏡頭動態拉遠框住特效(`_auto`,手動滾輪後讓位)。變形直接驅動 `rig.pose(m)` 略過高度判定。**全 app 只建一個 WebGLRenderer**,canvas 節點跨 `charDetail` 重繪搬移(大圖為 sticky 全寬固定,捲動不消失);離開房間畫面即 `stop()` rAF |
| `public/js/cutin.js` | 招式立繪演出(自己大招=全屏、小招=角落小卡、敵方大招=警示條);純 DOM overlay(`#cutinLayer`,z-index 15),**MUST NOT** 拉進 3D 場景 |
| `public/js/` | game.js(FPV/物理/插值)· toon.js(賽璐璐核心)· vfx.js · biomes.js · ground.js(開闊地地被覆蓋層)· terrain.js · mapSelect.js · venues.js · models.js · net.js · main.js · environment.js |
| `reference/` | 上游唯讀副本(mapping_elf、ai_tycoon)— **MUST NOT** 修改,只准參考 |

## 2. 通用開發規則 (RFC-2119)

### 程式碼品質與型別安全
- **MUST NOT** 新增 npm 依賴;新函式庫一律經 CDN importmap,且需先有離線 fallback 才准接。
- 英雄一律以 **pid(連線 id)為鍵** 存於 `heroes` Map;bot 用字串 pid(如 `'b1'`)。**MUST NOT** 改用陣列索引或 socket 物件當鍵。
- 外部 API(OSRM/Overpass/AWS 地形磚/Esri 影像)皆會限流或掛掉:每條 fetch 路徑 **MUST** 保留既有的程序生成 fallback(合成貝茲兵線、程序建物),改 fetch 邏輯時 **MUST NOT** 移除。
- 3D 資產 **SHOULD** 優先用 Quaternius 等 CC0 開源模型(`MODEL_MANIFEST` + 程序生成 fallback 模式);法線貼圖(toon 渲染用不到,動輒 20MB)**MUST** 刪除並重寫 gltf 移除引用。

### 狀態管理與資料流
- 平衡數值(射程/傷害/經濟/波次/角色/招式)**MUST** 只改 `data.js`;**MUST NOT** 在 sim.js/game.js 硬編碼。
- **機體原型與分節骨架(2026-07-11 起;2026-07-12 改版)**:人形機甲四台各有 `visual.proto`(`bastion` 過裝甲斧砲(2026-07-14:152mm 榴彈砲管 + 轉輪彈倉 + 前段側掛大斧刃 = 斧頭×榴彈砲;背部砲管已移除) / `seraph` EVA 式倒三角上胸 —— 底邊即肩線、**兩個上端點就是雙肩**(肩上立 binder 莢)+ 同步狙擊砲(2026-07-14:比機體略高的反器材長狙 + 前端刺槍,手臂加長) / `aegis` 塔盾攔截 / `colossus` **「巨兵」**:身軀/頭全是圓角矩形(壓扁膠囊 `rslab`)、四肢由圓角板沿長邊節節疊拼成蜈蚣體節、雙圓眼 + 眉心脈衝砲,致敬天空之城園丁機器人;蠍弩已移除,machine 名同步改「巨兵」),人形變形機甲四台各有 `visual.ground` 體態(`wolf` 趾行 / `vampire` 挺立高領·無翼(渡鴉 2026-07-11 起 = 三旋翼:機首桅 + 雙腿末端,飛行雙腿與機身呈 Y 字、地面全數摺收)/ `monkey` **齊天大聖悟空**:掌行四足(palmigrade)、手掌平貼地面、金箍 + 背插如意棒;**飛行不變形成飛機** —— 展開「不揮動」的光之翼焰刃(`rig.lightWings`,∝ 型態 × 速度)、體軸壓平雙腿併攏、多節圓柱尾蠍式前捲讓尾端巨砲朝前備射(1.5 軀 −0.84 根 + 4×0.62 節 = π) / `atlas` 負重前傾)—— **MUST NOT** 退回「同一具機體換色換掛件」。**手持長兵器雙手/單手姿(2026-07-14,`rig.aimPose`)**:bastion 斧砲 / seraph 長狙由 `locomotion.js stepBiped` 依「靜止度 idle」混成 —— 靜止(交戰)= 雙手托槍標準射擊姿勢(右肩抬起端平、左臂前伸內收扶護木/砲身)、移動 = 交還步態擺臂(右手單手持);aimPose 只掛在這兩台手持長兵器的 proto,aegis/colossus 與其他機種不受影響。**噴射尾焰(2026-07-12)**:定翼噴射機種(定翼無人機 canard/delta、morph jet 雙發機艙)`rig.jets` 掛雙層焰錐,移動時亮/長 ∝ 速度、靜止熄火;旋翼/螺旋槳機種 MUST NOT 加尾焰。**犀金龜(2026-07-12)**:圓角膠囊腹部/鞘翅、體軸平行地面(θg 1.45)、三對圓柱足全觸地 —— 中足對 `rig.midLegs` 與前後足構成 tripod 步態(qphase `TRI`,恆三足著地);仿生獸的主量體用 `rbz()` 圓角矩形、獸尾一律多節圓柱串接(節身收分 + 節間關節環);**身體圓角化的機種四肢一律圓柱化**(會變成翼/旋翼/機翼的肢除外 —— tilt 臂、鴕鳥翼照舊是板);**胸腹接合處不圓角 —— 平面接合**:兩段圓角量體之間 MUST 加「平端關節環」(獵犬/人馬/劍龍/猩猩/暴龍/袋鼠),否則脊椎波/跳躍前傾會讓圓角端對圓角端張口(軀體看起來裂開)。**定翼機不前傾(`rig.level`)**:定翼無人機巡航機身保持水平(推力來自引擎,不是傾轉),只保留壓坡入彎;旋翼/撲翼才隨速度前傾。**悟空懸停直立(`rig.hoverUp`)**:飛行靜止時機體立回直立、光翼上揚全幅展開(`rig.lightWingRoots` 開屏,基礎焰長 ×3),開始移動才前傾壓平近水平(焰長再 ×2、翼束滑回後掠)—— 頭的 cruise 補償要一併回正。**鳥類羽翼(2026-07-12 羽化)**:鷹/始祖鳥/夜梟的翼一律用 `feather()` 羽毛形圓角羽片,佈羽 = 悟空光翼式放射扇(羽根聚翼根/腕點、羽尖向外後方張開、掠角逐片遞增),MUST NOT 退回層疊長方形板。
  - 四肢一律分節(**全機種**:人形機甲 / 變形機甲 / 雙足獸 / 四足獸):`models.js segLimb()` 建「髖→膝→踝(→趾)」「肩→肘→腕(→指)」樞軸群組並登記 chain,`locomotion.js flexChain()` 以**遞增相位延遲**驅動(動力鏈 follow-through);**只有擺動相會屈曲**(`max(0, −cos(ph−d))`),支撐相回靜姿角打直 = 腳不滑地、膝不反折。旋轉符號慣例:**膝後折為正、肘前折為負、踝取反號**(肢體幾何朝 −y,+x 旋轉 = 末端後移);四足獸的前肢/後肢方向相反(`S = front ? 1 : −1`)= 真獸的 Z 形腿。多節軟肢(克蘇魯觸手腿/持武觸手)走 `undulate()`(正負皆折的行進波,靜止也蠕動)。**靜止 ≠ 定格**:`idleOf(a)` 隨速度連續淡入待機動態(分節鏈的液壓微顫、換腳站的重心交換、呼吸沉浮、警戒掃頭),持械手的微顫再收斂到 30%(槍口要穩)。
  - **關節鏈 MUST 節節俱全(2026-07-11 補齊)**:腿 = 髖 → 膝 → 踝 → 趾/蹄;臂 = 肩 → 肘 → **腕** → 指/掌。手掌/腳掌 **MUST NOT** 焊死在前臂/小腿上(那是木棍,不是肢)。現況:人形機甲 4 台、雙足獸 4 台走 `segLimb` chain;四足獸走 `chFL/FR/HL/HR`(犬蹠骨 / 馬球節 / 象蹠墊 = 第三節);變形機甲 8 台走 `rig.kneeL/ankleL/elbowL/wristL`(獸型的踝與前掌 2026-07-11 才補上,**MUST NOT** 退回 null)。改骨架後跑 `heroes 全角色 rig 稽核`(見 §4)確認沒有機種掉節。
  - **脊椎 / 頸 / 頭 / 尾(2026-07-11 補齊)**:`hips`(骨盆:浮沉·側移·前傾)→ `chest`(胸腔:與骨盆**對轉** counter-rotation + 呼吸)→ `neck` → `head`。頭 **MUST** 每幀反轉抵銷上游累計旋轉(`locomotion.js stabilizeHead`,抵銷率 0.85~0.9,留殘留晃動)—— **頭跟著軀幹一起甩 = 壞掉的布娃娃**,真獸/真人跑步時頭幾乎不動(前庭反射)。四足獸的 `neck` 留著脊椎波(它是鞭的一段),只有 `head` 做補償。
  - **頭部穩定 MUST 補兩段,不是只轉角度**:①旋轉補償(`stabilizeHead`)②**長頸力臂的畫弧補償**(`headArc`)—— 脊椎波只有 ±0.05 rad,但乘上長頸力臂就把頭甩出 0.57m 的上下大弧(軀幹自身起伏的 4 倍)。補償後 ≤0.08m。只做①會看到「頭角度是平的,但整顆頭在上下畫大圈」。
  - **人馬(`rider:true`)的「頸」是人形上半身,不是脖子**:它 **MUST NOT** 跑脊椎波,而是像**騎士**一樣反向吸收馬軀的俯仰/滾轉/彈跳(腰以下跟著馬、胸以上維持水平)⇒ 槍口穩定(頭部位移 0.013m)。這正是 t07 的設定:「四條腿只為了讓槍口在扣扳機那一刻絕對靜止」。
  - **尾 = 活的配重,不是裝飾**:多節 `tailSegs` 走 `whipTail()`(急轉甩向轉向反側 + 逐節延遲 + 尾梢甩幅遞增)。體軸**水平**的機種(暴龍/鴕鳥/袋鼠)`leanF` **MUST** 壓到 0.3~0.5 並給 `tailUp` —— 套人形的前傾量會變成頭朝地俯衝;牠們是**抬尾**配平,不是壓頭。
  - **步態依生物原型分化(2026-07-11 起;2026-07-12 擴充)**:`stepQuad` 吃 `rig.gait` —— `'trot'` 高速依 `rig.gallopType` 換**襲步落腳序**:`'transverse'` 橫向襲步(馬/人馬 LH→RH→LF→RF,擺程平緩扛得住騎乘平台)/ `'rotary'` 迴旋襲步(犬/豹 LH→RH→RF→LF,拱背-伸展脈動最劇);相位自對角小跑**連續內插**到落腳表,不瞬跳 —— **MUST NOT** 退回單一 π/2 offset 的假 gallop。`'walk'` = Speedwalk(象/劍龍:側步序列四拍,加速**不換步態**、永遠三腳著地,`rollSway` 體側搖擺才是重型獸的速度感)/ `'crawl'`(章魚:四觸手輪替行進波 + 外套膜蛇擺;**擺動相的離地觸手走 `softLeg` 收成搜索/蓄勢 S 形**,持武觸手走 `tentGuard` 眼鏡蛇預備式 —— 未觸地的觸手 MUST 是蓄勢待發,不是均勻正弦)。`stepBiped` 吃 `rig.bound`(猩猩跳奔)+ `rig.knuckle`(**指節行走:前肢是真的承重前腳** —— 臂長建模到指節觸地、擺幅與腿同級、支撐相吃載荷彈簧,gunArm 必須關)+ `rig.grounded`/`rig.tuckArms`(鴕鳥/迅猛龍 **grounded running**:沒有騰空相,越快浮沉越收斂;前肢收起蓄勢不擺大臂)+ `rig.hop`(袋鼠:`stride` = 單跳世界長度 5.6 —— 一跳跨大步,刷跳頻 = 高頻晃動);`stepMorph` 吃 `rig.qphase` 相位表(巨象側步)、`rig.gallopType`(夜豹 rotary)、`rig.tuck`(迅猛龍前爪收起)、`rig.palmi`(悟空掌行:前肢雙側全幅擺動、手掌平貼地)與 `flexF` 屈曲剛性。**全機種 stride 一律拉大靠跨步/騰空衝刺,MUST NOT 刷步頻補速度**(步頻一高整機就像在顫抖)。**分節屈曲是雙相的(2026-07-11 二修)**:擺動相收腿(×1.15、遠端節逐節放大 = 鞭式)+ **支撐相 cos² 載荷彈簧壓縮** —— 「擺動折、支撐鎖直」的舊設計看起來上下肢像焊死,MUST NOT 退回;奔跑手肘 = 恆屈泵動(hold ∝ 奔跑度),不甩直;章魚觸手腿 `rig.soft` 走 undulate 全波(正負皆折),不是關節腿。`rig.top` 壓在實戰速度附近(≈7)= 以奔跑姿態為主。**人馬騎士只准旋轉穩定**:骨盆黏死馬背、`neck.position` 不做位移反抵銷(馬沉人不沉 = 腰際裂開;`headArc` 是水平長頸的力臂補償,套在直立人身上會前後亂晃)。
  - **機械飛行型態不呼吸**:變形機甲的 `rig.airBob` 對定翼(jet/uav)與旋翼(heli/tilt)**MUST 為 0** —— 飛機/直升機巡航時機體是被氣動面與旋翼盤配平住的,不會上下起伏;會浮沉的只有「活的」擬態獸型(levi/archo/beetle/owl,拍翼產生升力脈動)。壓坡入彎/機鼻俯仰是**操縱**,保留。
  - `segLimb` 的樞軸預設在 `[0, −前一節 len, 0]`;**深屈而幾何沿 +z 長出去的肢節**(袋鼠平舉的拳砲前臂)**MUST** 用 `piv:[x,y,z]` 覆寫,否則手掌會接到前臂側面。
  - `MORPH_HUMANOID`(models.js)是「人形 ground」的唯一真相 —— `heroTargetH` 的獸型矮化與 `buildMorphMech` 的 `beast` 判定都查它;新增地面體態 **MUST** 同步加進去。
  - 配件會撐大包圍盒:`fitToHeight` 以整體 bbox 高度定尺 ⇒ **高聳的天線/直立長兵器會把機體本身縮小**。武器一律斜置/前傾收在機體頂高以內。
- **機體塗裝與性格花紋(2026-07-11 起)**:機體裝甲色 = 角色主色系,**MUST NOT** 再硬編碼灰色裝甲。
  - 色版唯一的縫是 `paint.js heroPalette(vis, side, tone)`:由 `visual.hue` 推 HSL 階梯(`tone:'light'` 人形機甲/雙足獸;`'dark'` 無人機/獸型/變形機甲 —— 機種既有明暗基調不動)。builder 只取用 `PAL.main/mid/lite/dark/deep`,識別燈條(emissive accent)照舊。
  - 花紋走 `visual.paint`(minimal/camo/graffiti/tattoo/totem/flag,依角色性格;文本依據見 `lore.js`),`paintUnit()` 在 **fitToHeight/outlinify 之前**呼叫,程序 canvas 貼圖(256²,`mulberry32` 以 hue 為種子,**MUST NOT** 用 `Math.random`)。
  - 投影用**靜止姿勢下「mesh 局部 → 機體根」的固定矩陣**(toon.js `CEL_PAINT` triplanar):花紋因此烤死在裝甲板上,關節怎麼轉都不游移。**MUST NOT** 改成世界座標投影(機體一走花紋就整片流動),也 **MUST NOT** 每幀更新該矩陣(限肢會把花紋甩出去)。
  - 描邊外殼 / 透明件(旋翼·膜翼)/ 發光件(識別燈·推進器·砲口)一律跳過塗裝 —— 花紋不吃掉辨識訊號。
- **角色戰鬥系統(2026-07-08 起)**:每玩家 = 1 名角色(房間階段 `pickChar` 選角,不選 = 開戰隨機)= 專屬機體 + 輕武器(左鍵)+ 重武器(右鍵瞄準+左鍵,CD 型,**用 mag:1 + reload=cd 實作**,別再發明第二套 CD)+ 小招 Q + 大招 E。招式升級 = 擊殺數(`h.kn`)+ 金錢(`buy 'ab:light|heavy|skill|ult'`),施放吃電力 MP + CD,全部 `sim.heroCast` 結算。
- **三機小隊(2026-07-09 起)**:蜂群玩家 = `SQUAD.N`(3)架無人機;機甲仍是單機。`sim.squads: pid -> {bodies[], act, lock, ps}`,`sim.heroes: pid -> 目前主視野那架`(**pid 為鍵的規則不變**)。
  - 每架是獨立 ent(自己的 hp/護盾/座標/死亡與重生 CD);經濟/電力/彈藥/招式/增益住在 `sq.ps`,靠 `_bindShared()` 的 getter/setter 掛回每架 ent — 所以 `h.money`/`h.abil`/`h.ammo` 在任何一架上讀寫都是同一份。
  - 迴圈粒度 **MUST** 分清楚:`heroes.values()` = 一隊一次(金錢/電力/招式增益);`_allBodies()` = 每架一次(重生/護盾/伏擊/中繼站/火場/物資)。搞錯 = 收入三倍或增益疊三層。
  - 單機 HP/傷害 = 機甲 ÷ `SQUAD.N` × `SQUAD.BUFF`(**1.05,2026-07-13 校準**;`UNITS.drone.hp/shield` 與 `SQUAD.DMG` 一律由它 derive,**MUST NOT** 手寫)。**傷害折算只准住在 `heroWeapon()`**(與 HEROIC 同一個縫),`sim.js`/`game.js` **MUST NOT** 二次乘算。三機隊承傷比例 ∝ 1/BUFF²(EHP 與 DPS 同時 ×BUFF ⇒ 清怪時間 ÷BUFF、承傷 ÷BUFF²)—— 舊值 1.5 讓三機隊遠比機甲耐打(單挑一波 NPC 只掉 30%,機甲掉 60%)。
  - 非主視野的僚機 = 客戶端左上角 PiP 小螢幕(`game.js _renderPips`,scissor + 共用 `pipCam` 重繪同一個 scene);機甲的餌機共用同一套。PiP **MUST** 避開 minimap / kill-feed 這兩塊 DOM。
  - 火力靠 `_echo()`:主視野機命中什麼,射程內存活僚機就打同一個目標(彈藥/射速只在主機扣一次)。三機齊射 ≈ 一台機甲。
  - 自爆(F,2026-07-10 起需鎖定):**必須有準星鎖定的敵方目標**(`heroLock`,`LOCK.TTL` 秒內有效)才會動作 — 主視野機引爆、僚機衝向鎖定目標直到引爆;**沒鎖定 = 完全不動作**(不會原地白白自爆)。高速撞擊引爆走 `detonate` 訊息的 `crash:1` 旗標,不吃鎖定閘門。`_blast` 一律跳過同陣營 → 不會炸到友軍。主視野機陣亡 → `_promote()` 立刻讓位給存活僚機,且**接手那架取消衝刺**(玩家重新掌控)。
  - 僚機移動全在伺服器 `_tickSquads()`:dash > regroup(離主機 > `SQUAD.REGROUP_M`:先切回標準兵線走廊 → 沿線飛到離主機最近的線上點 → 再直接歸隊)> follow(編隊)。客戶端只回報主視野那架的 `pos`。
  - 飛彈追蹤 **MUST** 用 `m.tid`(ent id)而非 `tpid`(pid 只給客戶端判斷「是不是在打我」)—— 一個 pid 底下有三架。
- **傭兵變形機甲(2026-07-09 起)**:傭兵(`side:'MERC'`)一律 `kind:'morph'` 單機,HP/火力與機甲完全相同(`UNITS.morph` 由 `UNITS.robot` spread 而來,**MUST NOT** 拆開手抄數值;傷害不吃 SQUAD 折算)。飛行↔地面變形是客戶端物理(蓄力跳彈射 / 觸地變形,常數住 `MORPH`);伺服器**不需要型態訊息**,一律以回報 `y` 判定:`y ≤ MORPH.GROUND_Y` = 地面型(踩地雷)、`y ≥ GAME.AA_MIN_ALT` = 空中目標(塔 SAM / 防空伏擊)。獸型機甲(`visual.form:'beast'` 四足 / `'biped'` 雙足)與擬態翼/定翼無人機(`'avian'`/`'fixed'`)只是外觀/骨架(models.js + locomotion.js;兩陣營各三型等比例 4/4/4),**不影響 sim 數值**。
- **機甲餌機(2026-07-10 起)**:非無人機英雄(`robot`/`morph`)肩上掛一架 `kind:'decoy'` 子機,F 鍵分離發射(對應無人機的 F 自爆)。狀態住 `sq.decoy`(空中那架)/ `sq.decoyCd`;航向鎖定發射瞬間的 `h.ry`,**玩家不能操舵**。有準星鎖定(`_lockedTarget`)才限轉率追蹤,近炸 `DECOY.BOOM_M` 引爆;否則直飛到 `TTL_S` 自爆。離主機甲 > `LINK_M` = 失聯(`d.lost`):`_visionSources` 不再算它、客戶端收掉 PiP,但機體照飛照炸。HP = 主機甲 `maxHp × DECOY.HP_F`,可被擊落(= 誘餌本體);被擊落 **不** 引爆,只有自爆/近炸才引爆。
  - decoy 是普通 ent(有 side、非 neutral)→ 敵方 `_acquireTarget` 會鎖它(這就是「餌」)。但它 **MUST** 在 sim 主迴圈 `if (e.hero || e.neutral || e.decoy …) continue` 被跳過(沒有 lane / 不開火,位置歸 `_tickDecoys` 管)。
  - 自爆爆風走 `_blast(owner, decoyBlast(), …)` —— 算在主機甲頭上(吃它的火力升級/增益,擊殺記給它)。
- **準星鎖定(2026-07-10 起全機種通用)**:客戶端 `_tickLock` 每 0.25s 回報「射程內 + 準星對準」的敵人;伺服器 `heroLock` 複驗**距離 ×1.25 與迷霧視野**(與 `heroHit` 同一條規則)後廣播 `lock` 事件 → 施放者畫光暈(`vfx.lockGlow`)、目標本人跳 HUD 警告。無人機沿用它當自爆衝刺目標、機甲當餌機追蹤目標。時效住 `LOCK.TTL`。
- **武器機制多元化 + 物理傷害衰減(2026-07-11 起)**:武器 `type` 六類 — gun(動能)/ rail(蓄力 `charge` 秒極速直擊)/ launcher(AoE 戰鬥部,`guide:1` = 狙擊視角雷射導引)/ missile(準星鎖定自動追蹤近炸)/ beam(定向能瞬擊)/ plasma(`arc` 半角扇形,伺服器錐形結算走 `heroPlasma`,**不是** heroBurst)。傷害隨距離按物理衰減:動能 KE ∝ e^(−2Δd/L)、能量束 Beer–Lambert 消光、爆風 `blastFalloff` 連續超壓(取代舊二段式 1/0.4)— 衰減公式**只住 `data.js`(`dmgFalloff`/`blastFalloff`)**,sim 結算與客戶端 HUD 估算共用,**MUST NOT** 在別處重算。`FALLOFF.PLATEAU`(0.35×射程)內不衰減 = e2e 近距離傷害斷言不受影響,調低前先重驗 e2e。rail 蓄力 / missile 追蹤 / guide 導引全是客戶端輸入·彈道層,伺服器防作弊驗證(heroHit/heroBurst)不變。**e2e 拆堡測試綁 s02 溫壓火箭 → s02 heavy MUST 保持 `type:'launcher'`**(t01/s02/t04 為 e2e 指定角,改型別前先查 test/e2e.mjs)。
- **後座力機制(2026-07-14;`data.js RECOIL` 表 + `recoilTier()`)**:輕/重武器各三階,依 `type`/命名/射速推導(顯式 `recoil:'low'|'med'|'high'` 可覆寫)。**純客戶端手感 —— 全部住 `game.js`,伺服器完全不涉入(位移本就客戶端回報)⇒ bal/e2e 不受影響,MUST NOT 搬進 sim。** 每階給 `move`(free/slow/stop/back 位移懲罰,`_recoilMoveF` 於 `_updatePlayer` 夾住)/`climb`(準星上踢 = `recoil.p`)/`back`(每發擊退)/`burst`(N 連射後 `settle` 秒強制回穩,與換彈匣分離;扇形武器不吃)/`steady`(高後座重武器須「停下 + 穩定」秒數才擊發:狙擊/超電磁炮/導引飛彈 —— rail 用既有 `charge`、其餘用計時器)。`RECOIL.AIR_F`(0.5)= 飛行機體位移懲罰折半(使用者指示「空中減半」,蜂群靠飛行機動)。平衡數值只准動 `RECOIL` 表。
- **扇形武器 fan(2026-07-14;電漿重武器 + 散彈輕武器)**:`fan:true`(plasma 自動帶)→ ①`dmgFalloff` 走 `fanFalloff`(無平台、槍口最高、線性遞減到 `FAN_FLOOR` = 越近越高)②`sim.heroPlasma(pid,dx,dz,slot)` 錐狀判定,一發只扣一次彈藥/射速、`arc` 半角內敵人全數命中。**散彈輕武器是「輕武器只准 gun/rail/beam」的唯一破例** —— 走 `{t:'plasma', slot:'light'}` 同一條錐判定;launcher/missile 仍只准重武器。客戶端 `_fanBlast()` 畫圓形彈著(散彈=動能彈丸、電漿=焰舌)。散彈 arc 12~18°(升階收窄),刻意 ≥ 主攻電漿(10~17°)以符「重武器版擴散更小」。
- **榴彈對建築強化(2026-07-14)**:`GRENADE.BUILDING_MUL`(1.4)只在 launcher 型命中建築時套,唯一縫 `sim._heroDmg()`(`grenadeBuildingMul`)。對兵員/裝甲/空中不變 ⇒ bal ①(波次目標非建築)與 e2e 光武器對塔 ×0.6 斷言皆不受影響。
- **重武器射程 > 砲塔(2026-07-14 二修)**:**所有**重武器(含扇形電漿)解析後射程 > `tower.range`(310)⇒ 每把重武器都能在塔射程外拆塔(使用者指示)。**最短者 = 電漿扇形重武器**(base 264 → 解析 316.8m,剛好在塔 310 外約 ~7m,即「剛剛好不會被砲塔打到」);其餘非扇形重武器 ≥ 330m(s02 溫壓火箭 = 330)。扇形武器仍靠 `fanFalloff` 越遠越弱 ⇒ 遠距拆塔傷害趨近 FAN_FLOOR(能碰到、拆得慢)。改任一重武器 base range **MUST** 重驗此不等式(`heroWeapon` 解析 + rangeCap:robot/morph sight 240 → 上限 345.6)。
- **FPV 座艙與視野(2026-07-12 起)**:第一人稱看出去的東西 = **自己這台機體的結構**,依 `visual` 分派(`game.js`:`_cockAvian`/`_cockFixed`/`_cockRotor`/`_cockProto`/`_cockSkull`/`_cockNeck`/`_buildMorphCockpit`)。**MUST NOT** 退回「無人機一套、機甲一套」的通用座艙。
  - **座艙裡坐的是人(`_cockCanopy`,全機種共通)**:不論外面是人形機甲、獸型還是無人機,看出去**一律先隔著人類駕駛艙罩**(儀表台/頂樑/A 柱/HUD 燈條/左肩掛件),機體自身結構(頭顱/吻部/翼/旋翼/武器)全在艙框之外。**MUST NOT** 退回「從獸的眼窩看出去」。
  - **先決定艙位,再決定看得到什麼(`SEAT`)**:仿生體的艙位由**行進體態**決定 —— 體軸偏直立(人形機甲/猩猩/袋鼠/章魚/狼/吸血鬼/悟空/亞特拉斯)= **頭部艙** `_cockSkull`(艙罩外看到自己的吻部/獠牙/觸手);體軸偏水平(獵犬/暴龍/鴕鳥/劍龍/人馬/迅猛龍/黑豹/巨象/犀金龜)= **頸部艙** `_cockNeck`(艙罩外先看到自己的**頸背與頭顱**,嘴砲從那顆頭的口中前伸)。無人機:擬態獸看得到自己拍動的翼與口器、定翼機是機鼻(零式隔著旋轉螺旋槳)、旋翼機是機架與旋翼。
  - **輕武器掛點依機體構造(`GUN_MOUNT` + `gunMount()`)**:hand 手持(人形/有手仿生體/人馬騎士,含上臂→前臂→手掌)· tentacle 觸手持械(章魚)· mouth 嘴砲(暴龍/飛龍/迅猛龍/巨象鼻端/犀金龜大顎/擬態飛行獸;**電漿武器一律改嘴砲**,`wtype==='plasma'` 會把 back 覆寫成 mouth)· back 背載砲塔(無手仿生體:獵犬/鴕鳥/劍龍/黑豹,架在右肩、支柱 MUST 連回頸背,否則砲塔浮空)· body 機身固定(旋翼無人機吊艙)· wing 機翼固定(戰機左右硬點對稱,槍口取右側)· claw 爪掛槍莢(翼龍)。**掛點錨由座艙 builder 回傳**(只有它知道自己的頭顱/機翼/手臂在哪),缺錨才退回 `DEF_ANCHOR`。
  - **變形機甲 = 兩組座艙 + 兩套武裝**:`cockGround`/`cockAir` 與 `_gunG`/`_gunA` 同時建好,`_syncMorphCockpit()` 依 `this.flight` 整組切換,**`_muzzle` 跟著換** —— 彈道與槍口焰從新掛點射出(地面手持/嘴砲 ↔ 飛行機翼硬點/機身吊艙)。
  - **座艙塗裝 = 機體塗裝**:色版走 `paint.js heroPalette(vis, side, tone)`(tone 與 models.js 同規則:無人機/變形機甲/四足獸 = dark),builder 內的結構灰階常數經 `ARMOR` 表映射成色版階梯;花紋走 `paintUnit(cockpit, …)`(MUST 在 `outlinify` 之前)。牙/喙/眼等辨識件掛 `noPaint`。**MUST NOT** 再硬編碼灰色座艙。
  - **視點位置 = `heroView()`(唯一的縫)**:`VIEW_SHAPE` 以 `visual.proto|creature|ground` 為鍵給 `e`(佔機體實高比例)與 `f`(沿正面 −z 前移比例);頸部艙的 `f` 小(頭在前方視野裡),頭部艙的 `f` 大。飛行型態 `e=0`(機體中心),只沿正面前移到機鼻。
  - **FOV 全機種相同(68 / zoom 35)**:同距離目標的**視覺大小感受度雙陣營 MUST 一致** —— 舊制無人機 fov 100 會把 NPC 畫小一號。機體差異只准表現在座艙造型與視點位置,**MUST NOT** 再用 FOV 做差異化(變形機甲 `fovAir` 亦已對齊)。
  - **近場與取景**:z=−0.9 處畫面半高 ≈0.61、半寬 ≈1.05(fov 68 / 16:9)。**任何座艙件 MUST NOT 越過 z ≈ −0.45**(離鏡頭不到半公尺 = 整片糊住畫面;掛載機構走 `zb()` 夾住)。反過來,翼根 z 太淺(如 −0.3)會整片落在視錐外 = 看不見翼。頸部艙的頸/頭要縮尺(`K`)—— 等比的頸會變成擋住準星的柱子。
  - 稽核:以 `Object.create(BattleClient.prototype)` 假實例對 32 名角色跑 `_buildCockpit()`(不必進戰鬥),檢查 mount/muzzle/`_syncMorphCockpit()` 切換與近場違規,並逐一截圖。
- **站立表面 = 地形 ∪ 高架橋面(2026-07-12 起)**:橋樑/地下道是**可通行的結構物**,不是佈景。
  - `biomes.js buildRoads` 把每個橋面小段登記進 `decks`(`group.userData.decks`),`makeDeckIndex()` 建網格索引 → `main.js` 掛成 `terrain.deckY(x,z)` 與 **`terrain.surfaceAt(x, z, curY)`(唯一的縫)**;`game.js._surf()` 是它的包裝。玩家物理、`pos` 回報的 `y`、NPC/敵機的貼地渲染、兵線箭頭高度**一律走這一個縫**,**MUST NOT** 各自呼叫 `terrain.heightAt` 當地面高度。
  - `curY` 是判準:高過橋面 `DECK_STEP`(2.2m)以內 = 站在橋上;更低 = **從橋下走過**(照舊踩地形)。渲染端傳「上一幀的表面高度」(要先扣掉 `heroY`)→ 走上引道自然接上橋面,橋下通行不會被吸上去。**MUST NOT** 改成無條件取 max(地形, 橋面)(橋下就穿不過去了)。
  - 回報給伺服器的 `y` = 離**站立表面**的高度(站在橋上 = 0)⇒ `MORPH.GROUND_Y` / `GAME.AA_MIN_ALT` 的地面型/空中目標判定不因站上橋面而誤判。
  - 地下道走**真・下沉(2026-07-15 改版;**不開挖山體地表**)**:隧道路面 = 兩端洞口地表高的**平直內插道路**(`tFloorAt`),上方原地形山體自然高過路面即成隧道;`buildRoads` 在覆蓋段(`terrain.heightAt ≥ 路面 + TUN.CLEAR + ROOF_T`)補**兩側牆 + 不透明天花板(擋住山體底面 = 不破圖)+ 橫樑/燈**,敞開段(洞口)牆收零高。`terrain.carveTunnels(runs,{clear,hw})`(鋪地被前呼叫)**只開挖敞開/洞口段**(原地表 < 路面+CLEAR+1),覆蓋段的山體地表**完全不動 → 照常鋪地被拼圖、可站立、不會掉進洞**(使用者要求)。`buildRoads` 回傳 `tunnels` 小段(路面 `fy`/天花 `cy`)→ `main.js makeTunnelIndex` 建 **`terrain.tunnelAt(x,z)→{floor,ceil}`**;`surfaceAt` 以 **`curY < ceil`** 判定「人在洞內」→ 站路面(否則站山體地表);**`terrain.ceilingAt(x,z,curY)`**(洞內天花 ∪ 橋面底緣)供 `game.js._updatePlayer` 把頭頂(`pos.y + selfH`)夾在天花下 = **不可穿越天花板**。`TUN.CLEAR`(8)> 最大機甲 ~4.5m ⇒ 天花夠高不卡。無 OSM 隧道時完全零影響。伺服器不涉入(純客戶端地形/物理)⇒ bal/e2e 不受影響。**MUST NOT** 退回「開挖整條走廊 + 屋頂 deck」(會蓋掉山體地表的地被)或「開挖式路面貼地」。
  - **高架橋淨空(2026-07-15)**:橋面抬升 `BRIDGE_RISE`(7.5m,舊 4.2)> 最大機甲高 ⇒ 機甲從橋下通過不卡;橋面底緣(`deckY − 1.2`)登記進 `terrain.ceilingAt` → 橋下同樣**不可穿越橋面天花**(頭頂夾住)。
  - 橋面/地下道路寬夾在 `PASS_W`(16 遊戲公尺)以上 —— NPC 與玩家並肩通過不互相卡住。
- **兵線指引 = ㄑ 字形推進箭頭,不是線(2026-07-12 起;同日二修為 chevron)**:`game.js _initLanes()` 沿兵線佈「馬力歐賽車加速板」式 chevron(每支 = 兩根桿在頂點交會,兩個 InstancedMesh):
  - 直線段:兩桿共用頂點、左右各張開 `SPREAD` ⇒ 頂點朝前的 ㄑ;每 `ARROW_GAP`(110m)一支(**密度是首版的一半**)。
  - **轉角必有一支且自己就會轉彎**:桿 A 頂點壓在轉角、桿身沿進彎方向後躺;桿 B 頂點在轉角前方一個桿長(出彎方向)、桿身後躺回轉角 ⇒ **折點落在轉角上**。**MUST NOT** 退回「轉角只是換個朝向的直箭頭」。
  - **姿態貼地形坡度**:每根桿的俯仰角由「自己頂點 → 桿尾」兩點的地表高差算出(`asin(Δh / 桿長)`),**MUST NOT** 用統一抬頭角(上下坡會插進地裡或翹起來)。
  - 動畫 = 沿前進方向連續前送 + 脹縮(流動感),**MUST NOT** 退回連續折線。
- **敵方標示(2026-07-12 起)**:敵方單位一進我方視野(= 出現在快照裡,迷霧是伺服器過濾的)即在頭上掛**對方陣營主視覺**的下指箭頭(`factionMarkTex`:陣營色 + 徽記幾何,STEEL 正三角 / SWARM 倒三角),`depthTest:false` 穿透掩體(已被偵知的目標)。標記是 ent mesh 的子節點 → 離開視野 ent 被移除,標記自動消失。
- **射程恆小於視野(2026-07-10 起)**:玩家武器射程 = `min(基準 × HEROIC.range, rangeCap(kind, slot))`,`rangeCap = sight × (重武器再 × GAME.AIM_SIGHT_MULT) × GAME.RANGE_SIGHT_F`(< 1)。夾住的縫**只在 `heroWeapon()`**,`heroic=false` 的 NPC 基準值不夾。改 `sight` / 角色 `range` **MUST** 重跑 e2e(#INC-104 的 y=250 高空射擊仍要求輕武器英雄射程 ×1.25 > 250)。
- **世界尺度:步兵 = 真人 1.8m(2026-07-10 起)**:`models.js` 的 `SOLDIER_H` 是全遊戲唯一的身高單位,人員/載具/建物一律用**真實世界公稱尺寸**(建物高 7~16m、紅杉 110m),`biomes.js` 的 `OVER.bldH/bldXZ` 因此全歸 1 —— **MUST NOT** 為了「看起來大一點」把它們調回超尺度。**建物佔地(2026-07-12 加大)**:公稱佔地對齊真實市街量體(住宅 10~22m、商辦 16~32m,`INFILL.pitch` 36 同步放大),建物佔地:士兵比例即現實比例;`OVER.giant/mega = 1.35` 跟隨佔地等比放大(神木/巨岩與建物維持視覺等比,使用者指示)。`VEG_SCALE` 作用在很小的公稱幾何上,絕對高度本就近真實,**不在此列**。
  - 英雄體型 = `heroTargetH(kind, ch)`:**機甲 / 變形機甲(不分型態)= 真人 150%~250%、無人機 = 75%~150%**(2026-07-12 改制,舊制 3~5× / 1~2× 已作廢),倍率隨 `mods.armor` 在該機種護甲區間**線性**內插(高防禦 = 巨大 = 剪影大 = 好命中,因為命中是客戶端對 mesh raycast)。獸型(`visual.form:'beast'` / 非人形 `visual.ground`)再 ×`BEAST_H_F`,但 **MUST 夾回機種下限**(機甲不論獸型都 ≥150%)。**體型只准住這個縫**,`game.js`/`biomes.js` **MUST NOT** 硬編碼機體尺寸。
  - 由它推導的東西:`game.js` 的 `heroCollider()`(英雄碰撞圓柱,走 `ent.heroCol` 而非 `COLLIDER` 表)、自機 `SELF_F`(碰撞半徑/上下緣/**座艙視點高度**)、`models.js` 的 `walkRef`(步幅正比身高,忘了改就原地滑步)。改 `SOLDIER_H` 或倍率,以上全部自動連動。
  - **尺度不動 `sight`/`range`**:座艙的「人類駕駛感」只靠視點位置(`heroView`);`fov` 全機種一律 68(2026-07-12 起無人機不再是廣角,見 FPV 座艙條目)。平衡數值與 #INC-104 因此完全不受尺度改制影響。
- **地圖尺寸與兵線來源(2026-07-10 起)**:真實邊長 = `0.3 + 0.1×L` km(L1/L2/L3 = 0.4/0.5/0.6 km),兩堡真實距離 = 邊長 × 0.85 × √2 = 481/601/721m。`GEO_SCALE_VER` = 7。
- **世界比例尺(2026-07-11 起 REAL_SCALE = 0.5,遊戲 = 2×真實)**:沿革 `0.125`(放大 8×,街廓成荒野)→ `1`(1:1,戰場太緊湊、武器相對射程過長)→ `0.5`(遊戲空間放大 2×,兵線走廊拉開一倍;武器射程/視野的**遊戲公尺**值不動 ⇒ 相對射程減半)。改 `REAL_SCALE` **MUST** 同步 +1 `GEO_SCALE_VER`(觸發 `migrateFavCfg` 重算過期最愛)並重跑 `tools/bake_venue_lanes.mjs`(`laneTacticsXZ` 的 `SEG_M` 是遊戲公尺,尺度一動轉角評分就變)。
  - **關鍵:`realDistFor` 與 `REAL_SCALE` 無關(公式裡相消)** ⇒ OSM 查詢半徑 `overlapCellM` 都不變、`venueLanes.js` 真實道路兵線原封有效,重烤純離線。**放大真實邊長(改 `REAL_SIDE_*`)才會**改變查詢半徑、需 2× 半徑重抓 Overpass 並改選不同真實道路 —— 想「放大地圖」優先動 `REAL_SCALE`,別動邊長常數。
  - **空氣牆離兵線的淨空**:`terrain.js battleBBox` 以 `ROUTE_EDGE_MARGIN_M`(160 遊戲公尺)外擴「主堡 + 全兵線頂點」包絡,再與對稱方框取聯集 ⇒ 真實道路蜿蜒到方框外時,最外側兵線點離地形邊緣仍 ≥160m(空氣牆再內縮 40m 後 ≥ ~120m)。**MUST NOT** 改回「只給百分比 pad」(真實道路頂點會貼著空氣牆,沿線飛就撞牆)。
  - **預設場地的兵線是真實道路**:`public/js/venueLanes.js`(由 `node tools/bake_venue_lanes.mjs` 離線預算)存 Overpass 路網上的最短路徑,**每個頂點都是 OSM 道路節點**,主堡 = 路線兩端節點 ⇒ NPC 引導路線與現實導航路線完全相符。`venueConfig()` 逐 `(venueId, L)` 查表;查無資料的 `(場地, L)` 才退回 `synthLane()` 合成弧(離線最後防線,**MUST NOT** 移除)。現況 21 場地 × L1/L2/L3 = 63 組,59 組真實道路、4 組(yosemite/uluru/atacama/tamsui 的 L3)現實中就只有一兩條路 → synth。
  - 改 `VENUES[].ll` 或 `MAPGEO` 的尺寸/重合率常數 **MUST** 重跑 `tools/bake_venue_lanes.mjs` 重新產生 `venueLanes.js`(Overpass 回應快取在 `tools/.osm_cache/`,已 gitignore)。
  - **重合率的網格是解析度,不是規則**:規則恆為「任兩線重合率 < `MAX_OVERLAP`(0.20)」;判定網格 `overlapCellM(L)` 隨兩堡真實距離等比縮放。下限公式:三條線必然共用「含 A 的格」與「含 B 的格」,每條線約佔 `N = 1.2/OVERLAP_CELL_FRAC` 格 ⇒ **重合率下限 = 2×FRAC/1.2,與地圖大小無關**。FRAC 0.111(照舊制 120m/1082m 等比)→ 下限 0.185,六大城市只有 3 個湊得出三條真實道路兵線;FRAC 0.06 → 下限 0.10,6/6 通過(現值)。**MUST NOT** 改回固定 120m,調大 FRAC 前先看這條下限。
  - 側翼選路 **MUST NOT** 用 OSRM via-point:最快幹道會把側翼吸回中線(重合率爆掉的根因,實測 0.23~1.00)。bake 工具改用「已用邊重罰 + 側移弧線導引」的 Dijkstra。互動式選址流程(`mapSelect`)仍用 OSRM,其側翼失敗時會補合成弧 —— 那條路徑**不保證**全線貼合現實道路。
- **地貌拼圖反重複三律(2026-07-12,`ground.js`)**:①特徵拼圖不疊置 —— 圓近似間距 `SEP_F`(0.85),僅容邊緣小比例交疊(家族 blob 淡接 0.86 刻意 > SEP_F,調低前先對齊);②英雄視野 `VIS_R`(300 = drone sight)內同款「地表#變體」只准一塊,同款用罄輪替變體/其他地表(`freeVariant`),`VARIANTS = 6`;③拼圖類型 MUST 與圖資相符 —— 特徵層與底毯一律走 `classifyPure`(場地 mix 的 55% 隨機改寫不再作用於地被),`tryPatch` 以 `subZones`(ZONES+CARPET 聯集)把關,家族延伸(鹽田→魚塭/農田拼布)跨分區直接擋下 —— **MUST NOT** 退回「特徵層吃 mix 改寫」或移除疊置/同款檢查。特徵 patch mesh 帶 `userData.gsub/gvar/gshape` 供冒煙稽核。
- **市區密集化**:1:1 後 OSM 建物已落在真實間距上,補間量由 `occ.free()` 自然收斂;OSM 覆蓋稀疏的郊區/未測繪街廓仍靠 `biomes.js densifyUrban()` 以每棟 OSM 建物為種子、沿其朝向鋪 `cols×rows` 街廓網格長出街景;`areaFree(blocked)` 保證兵線走廊(半寬 17m)/塔位/主堡恆淨空 → **淨空帶就是戰略通道,街廓就是掩體**。補間全走 `mulberry32`(每格消耗固定枚亂數,檢查一律放在抽樣之後)→ 全房間一致,**MUST NOT** 改成「淘汰就跳過抽樣」。
- **選角互動(2026-07-11 統一)**:`app.charTarget` = 目前高亮的**任一 client id**(自己 / 電腦 / 他人),不是 null=自己的舊語意。點任一填滿槽位 = 設 `charTarget` + 檢視該玩家角色;`renderCharPick` 依 `isSelf || (isBot && isHost)` 決定可選(送 `pickChar`/`setBotChar`)或唯讀(藏 `charGrid`)。bot 的 `ch` 一直存在(`startBattle` 就吃 `b.ch`),`setBotChar` 伺服器驗證陣營同 `pickChar`。**整卡不再綁 `pickSide`**:入座 = 空位的「＋ 入座」按鈕、離座 = 自己槽位的 ✕(點格子只選取不換陣營)。**MUST NOT** 為 bot/他人另寫一套選角 UI。
- **機體展示台預設縮小、無關閉狀態(2026-07-11 起)**(`app.stageSmall=true`):進選角即建 renderer 跑 rAF。背景 **MUST 完全不透明**(radial 兩端都 opaque hex `#10222c→#070b10`),否則 sticky 疊在簡歷上會透出底下文字。縮放鈕(小/頭像下方 ↔ 大/頂端 sticky)在 `#charStage` 右上,變形鈕左上。
  - **頭像與展示台捲動時恆固定**:`.cd-art`(頭像 + 小展示台)`position:sticky`;大展示台是 sticky 全寬,`.cd-art` 的 `top` 因此要讓開它的高度(`.char-detail.stage-large` 那條規則),且捲動框 `max-height` **MUST** 容得下「大展示台 + 頭像」(620px),否則頭像會被展示台蓋掉。
  - **移動演示(雙擊機體)**:機體恆在原點,靠地面網格反向捲動 = 跑步機;速度以不同的加/減速斜率(`MOVE`)逼近戰場實速(`UNITS[kind].speed × mods.speed`),再把「這一幀走了多遠」餵給 `stepLocomotion`(假的前一幀座標)—— 步頻/輪速/壓坡/前傾/煞車點頭**一律沿用戰場那一套**,**MUST NOT** 另寫一份預覽專用動畫。變形型態一樣走 `ent.heroY` 高度判定,與伺服器同一條規則。
- **擊殺分數**:`by.kn += killScore(kind)`,但**被擊殺者是電腦玩家(`isBotId(t.pid)`)一律 `BOT_KILL_SCORE`(3)** —— 刷 bot 不能速成招式。
- **砲塔壓制不等式(2026-07-12 起,MUST 成立)**:`tower.range`(310)> **所有玩家輕武器**(最大 270 = `drone.sight` 300 × `RANGE_SIGHT_F`)且 > **所有 NPC**(最大 220 = 榴彈兵);並且 `tower.range ≥ maxLight + 2×TOWER_SIDE_OFF` ⇒ **打其中一座塔必定同時吃到同塔位另一座的覆蓋火力**。改 `sight` / `RANGE_SIGHT_F` / 任一角色 `light.range` / `TOWER_SIDE_OFF` **MUST** 重驗這條。NPC 不再有「射程外安全圍攻位」(榴彈兵 220 曾 > 舊塔射程 190)。
  - **塔 HP/護甲的推導**:`towerHp = 1.8 × heroEHP × heroDPS / towerDPS` —— 兩位機甲玩家(lvl1、無人干擾)集火單塔約 13.5s 拆掉,期間兩座塔的回擊 ≈ 1.79 × 機甲 EHP(981)⇒ **擊殺一位、把另一位壓到 ~21%**。現值 hp 1800 / armor 30 / dmg 65。動塔或機甲任一數值 **MUST** 重算這條。
  - **塔位求解 = `data.js solveTowerSites(lanes)`(2026-07-13 起唯一的縫)**:`sim._spawnStructures` 與 `biomes` 建物淨空**共用**它,**MUST NOT** 各自用 `TOWER_FRACS` 重算(清錯位置 = 建物長在塔上)。
    - **最前線敵我塔:射程重疊 `TOWER_OVERLAP`(0.8)且不對射**。兩塔攻擊圓沿連心線的重疊長度 = 2R − d ⇒ 要 0.8R 就得 **d = 1.2R = `tower.range × TOWER_SEP_F`**(`TOWER_SEP_F = 2 − TOWER_OVERLAP`,**MUST** derive)。d = 1.2R > R ⇒ 塔打不到對方的塔,但戰場中線必被雙方火力交疊。**MUST 用直線距離判定** —— 兵線 90° 急彎時沿線距離會騙過去。
    - 前線那一組的 frac 是**解出來的**(沿 `[TOWER_MIN_FRAC, TOWER_MAX_FRAC]` 掃描,取「最近敵我塔距 ≥ 1.2R 且最貼近」者;`TOWER_FRACS` 的 0.30 只是提示值);後方那組維持「從 0.16 往己方主堡收」的舊守衛。實測 21 場地 ×1/2/3 線:塔距 372~382m、重疊 76.6~80.0%,無一組對射。
  - **直射鎖定天花板 `GAME.GUN_CEIL_M`(170)MUST 與射程脫鉤**:舊制 `range × 0.9` 在塔射程拉高後會把 #INC-104 的 y=250 高空機從 SAM 手上搶走。
- **第三方打擊的淨空(2026-07-12 起)**:地雷/匿蹤防空伏擊的判定半徑是 `GAME.AMBUSH_M`(110,**不是** `LANE_SAFE_M` 45)—— **稍微偏離兵線不該被打到**。佈設另外避開主堡(含外推重生點)與砲塔:`MINES.LANE_CLEAR/BASE_CLEAR/TOWER_CLEAR`(115/260/90)、`AA_SITE.laneMin/baseClear/towerClear`(130/260/90),共用 `sim._farFromStructures()`。收緊淨空 **MUST** 同步放大 `_seedMines` 的取樣框與嘗試次數(否則佈雷數湊不滿,e2e 的顆數斷言會紅)。
- **第三方打擊「等面積」約束(2026-07-12 二修)**:地雷與匿蹤防空的**打擊面積相等**,且總量大幅下修(舊制防空 637k m²/線 vs 地雷 7.9k m²/線)。唯一的縫是 `GAME.THREAT_AREA_PER_LANE`(20000 m²):
  - 地雷顆數 `MINES.PER_LANE = 面積 / (π R²)`(→ 64/線)、防空陣地射程 `AA_SITE.range = √(面積 / (π × 陣地數))`(→ 56m,2 座/線)—— **兩者 MUST 由公式 derive,MUST NOT 手寫**(手寫就破壞等面積)。
  - `THREAT_CD_S`(180)= 同一機體踩雷/被伏擊後的**共用**冷卻(`b.thirdCd`);`THREAT_MISSILES_MAX`(1)= 全場同時只准 1 發伏擊飛彈在空中。
  - 主堡重生安全:陣地/雷區離主堡 ≥260m,防空射程 56m ⇒ 威脅圈最近也在離堡 204m 外,**三架無人機在重生點絕不會被打到**。改 `baseClear` 或面積 **MUST** 重驗這條。
- **飛彈失鎖規則(2026-07-12,全飛彈通用)**:目標一旦離開**發射源的攻擊範圍**(飛彈帶 `ox/oy/oz` 發射點 + `range`),飛彈立刻失鎖 → 只沿當下航向**直線飛行**,不再追擊(近炸引信仍在,撞上算它走運),ttl 到期自毀。伺服器 `sim._tickMissiles`(塔 SAM / 匿蹤伏擊 / NPC)與客戶端 `game.js _updateBullets`(玩家 `type:'missile'` 追蹤彈、`guide` 雷射導引 —— 導引點超出射程即失效)**共用同一條規則**。**MUST NOT** 讓飛彈無限追蹤。
- **NPC 戰力 = 「一波打掉玩家 60% EHP」(2026-07-13 校準,MUST 成立)**:一波 = 同線同側 `WAVE_SOLDIERS`(3)步槍兵 + 1 火箭兵 + 1 榴彈兵 + 1 攻擊直升機。基準情境:玩家單挑整波、雙方全在射程內持續開火、玩家只有 Lv1 輕武器 + 重武器照 CD、無升級/招式/掩體 ⇒ **清完波後平均剩 ~40% EHP(護盾 + 裝甲)**。
  - 現值:步槍兵 180/8/8、火箭兵 230/12/48、榴彈兵 280/18/55、直升機 420/14/28(hp/armor/dmg)。
  - **三種機體同一標準**:機甲 40.6% / 變形機甲 42.6% / 無人機三機隊 40.9%(平均;三機隊靠 `SQUAD.BUFF` 1.05 對齊 —— 見 §2 三機小隊)。
  - 改任一小兵數值、`SQUAD.BUFF`、`HEROIC`、角色武器或 `WAVE_SOLDIERS` **MUST** 重跑 `npm run bal`(承傷 ≈ 波次 DPS × 清波時間,兩邊都會動)。
- **雙層 HP**:護盾(先扣、不吃護甲、脫戰 `VITALS.OOC_S` 秒後自然回復)→ 裝甲 hp(吃護甲值曲線 `armorMul(armor, pen)` 減免,只能回主堡 / heal 招式回復)。爆擊只在直擊武器(`_rollCrit`),AoE 不爆。
- **英雄 vs NPC 同型武器 = HEROIC 倍率(射程 ×1.2、威力 ×1.5)**,只准在 `heroWeapon()` 套用,**MUST NOT** 在別處二次乘算。
- 彈道學在客戶端(`game.js` bullets:初速 mv + 重力 G,線段 raycast 補內插),伺服器仍以 `heroHit` 射程 ×1.25 驗證 — 防作弊邏輯**不**搬客戶端(不變)。
- `createRoom` **MUST** 附帶合法的預建 `battleConfig`(伺服器驗證兵線數/距離);房間內沒有選圖階段。環境(季節×日夜×天氣)在開房時 `resolveEnv` 定案進 `cfg.env`,全房一致,**MUST NOT** 在客戶端各自重算。
- 客戶端 `wstate` 彈藥只供 HUD,與伺服器小幅漂移是 **by design**(miss 不回報)— **MUST NOT** 「修正」它。
- 迷霧是伺服器端過濾:`snapshotFor(side)` 只濾「單位」,塔/主堡/中立物永遠可見;`snapshot()` 無霧供觀戰者/測試。同一 tick 三份快照共用一份 frame 快取(`_tickN`/`_frameTickN`,events 只能清一次)— 動快照邏輯 **MUST** 維持此共用。

### 效能與安全邊界
- 射擊 raycast **MUST** 只打單位 + `terrain.mesh`;植被純視覺,**MUST NOT** 加進 raycast 目標。
- 跨客戶端場景一致性靠 `mulberry32` 以戰場中心為種子的確定性散布 — 隨機散布 **MUST NOT** 用 `Math.random()`。
- 命中判定在伺服器(`heroHit` 檢 `d3 > range*1.25`),**且會檢視野**:`2026-07-09` 起,射手陣營看不見(迷霧內)的目標,回報命中一律無效(`_visibleTo` + 偵察脈衝旁路;塔/主堡/中立恆可見)。同理 bot 目標鎖定(`_acquire`)也吃迷霧,不再全知作弊。防作弊邏輯仍全部留在伺服器 — **MUST NOT** 把它搬到客戶端。

## 3. 危險模式與歷史陷阱(依事故日期標記)

- `[2026-07-03 #INC-101]` **`npm test` 不會啟動伺服器**,只是連 `ws://localhost:8620` 的 client。改完 `server/*.js` 或 `data.js` 沒重啟伺服器 → 測到舊程式碼還「全綠燈」。曾因此白跑兩輪測試。
- `[2026-07-08 #INC-102]` Windows 上 Node 預設 SO_REUSEADDR,**兩個 server 可同時 LISTEN 8620(不會 EADDRINUSE)**,連線被拆散到不同 process → 事件遺失、`timeout: host`。查 `netstat` 時 **MUST NOT** 用 head 截斷輸出;殺進程要連 npm 父進程一起殺,確認 0 個 LISTENING 後才重啟。
- `[2026-07-03 #INC-103]` **無人機原地復活 bug**:死亡發生在 tick 外的 handler、`respawn.base=0` 時,`dead:true` 從未進過任何快照,客戶端 `_onSelfDeath` 邊緣觸發失效。修法是 `deadTick` 守衛強制跨一個完整 tick — **MUST NOT** 以「優化延遲」為由移除(2026-07-09 起無人機也吃重生 CD,但只要有人把 `respawn.base` 調回 0,這個 bug 就會復活)。
- `[2026-07-03 #INC-104]`(2026-07-08 改制後仍有效)**武器射程與 e2e 耦合**:e2e 多處從 y=250 高空垂直射擊 → **所有角色輕武器 NPC 基準 `range` MUST ≥ 170**(英雄 ×1.2 ×1.25 寬容 > 250;e2e 有自動檢查斷言);塔 SAM `range: 240` 刻意 < 250(高空探測機不被鎖);e2e `fakeBattleConfig` 用 1600m×L(留防空安全邊界)。e2e 傷害斷言全部由 `heroWeapon()`/`armorMul()` 動態推導,測試用角色刻意選 **t01/s02(輕武器 crit:0,傷害確定性)** — 幫這兩角加爆擊會把測試變隨機。改射程/傷害 **MUST** 同步重驗 e2e。
- `[2026-07-03 #INC-105]` 障礙/防空陣地是**中立 ents**(`side:null, neutral:true`):`_acquireTarget`(sim)、`_acquire`(bots)、tick 主迴圈三處都 **MUST** skip neutral,否則 `UNITS[kind]` undefined 直接炸;`inv:true` 表不可摧毀(`_damage` 早退)。
- `[2026-07-08 #INC-106]` toon 三階 ramp `[102,182,255]` 的暗部曾設 88 → 深色機體塌成純黑,**MUST NOT** 調低。`MeshToonMaterial` 沒有 roughness/metalness/flatShading — 一律走 `toon.js` 的 `mat()` 包裝(metalness≥0.5 映射成 celMetal 硬邊高光)。賽璐璐核心只住 `toon.js`(`hazards.js` 僅 re-export 相容)。
- `[2026-07-03 #INC-107]` **openroom 流程坑**:最愛的 `battleConfig` 烤死 teamSize,切人數按鈕而無現選 venue 時 **MUST** 清空 `favCfg` 鎖住開房鈕(否則伺服器 `validateBattleConfig` 拒絕)。地圖流程 **MUST** 先 `mapSel.showConfig` 再設 `favCfg`(showConfig 內部 reset 會觸發 `confirmReady(null)` 清掉它)。
- `[2026-07-02 #INC-108]` Leaflet 地圖銷毀前 **MUST** 先 `map.stop()`,否則 `fitBounds` 動畫中 remove 會炸 `_leaflet_pos`。
- `[2026-07-03 #INC-109]` 直升機 creep **刻意未接入** 塔 SAM/防空伏擊飛彈系統(該系統以 heroes pid 查找,heli 是無 pid 的一般 creep,硬接會動到飛彈追蹤核心)— **MUST NOT** 「補完」這條接線。
- SkinnedMesh 量尺寸 **MUST** 用 `computeBoundingBox()`(骨骼感知)並關閉 `frustumCulled`,否則模型消失/錯位;`outlinify()` 描邊 **MUST** 跳過透明材質與 `userData.noOutline`,植被/建物 InstancedMesh 刻意不描邊。
- FPV 座艙掛在 camera 底下 — camera 本身 **MUST** `scene.add`,忘了會整個座艙不見。

## 4. 核心指令與工作流

```bash
npm start            # server on http://localhost:8620 (--port <n> 可覆寫)
npm test             # node test/e2e.mjs,約 60 項斷言
npm run bal          # tools/balance.mjs:①一波 NPC = 玩家 60% EHP ②最前線敵我塔重疊 80% 且不對射
```
- 動任何平衡數值(小兵/角色武器/`SQUAD.BUFF`/`HEROIC`/塔射程/`TOWER_OVERLAP`)**MUST** 跑 `npm run bal`(離線、不需伺服器)。
- PowerShell 下 `PORT=x node ...` 這種 env 前綴**無效**,用 `--port` 參數。

**LOGO 影像管線(離線,純 Node + 內建 `zlib`,無 npm 依賴;共用核心 `tools/logo_lib.mjs`):**
```bash
node tools/flatten_logo.mjs   # logo.png → logo_flat.png(整枚徽記;頁面 .game-logo 用這張)
node tools/split_logo.mjs     # logo.png → 四區塊 PNG + logo_parts.json(拼合座標);--probe 印元件清單
node tools/compose_logo.mjs   # 四區塊 PNG + logo_parts.json → logo_flat.png(改完單塊後還原)
```
- 四區塊 = `logo_gear`(齒輪弧)/ `logo_steel_tri`(鋼鐵三角)/ `logo_swarm_tri`(蜂群倒三角)/ `logo_swarm_trail`(蜂群軌跡)。**鋼鐵兩塊保留原圖金屬漸層,蜂群兩塊純化為單一色平塗**(`SWARM_FLAT`)。
- **拼回去的唯一依據是 `public/assets/logo_parts.json` 的 x/y(原圖 512² 座標系)+ 每塊的畫布尺寸。** 單獨修改某塊時 **MUST** 維持該塊畫布 `w×h` 不變、透明邊不裁;要移動位置改 manifest 的 x/y,**MUST NOT** 平移圖內容。改完跑 `compose_logo.mjs` 即還原(不回頭讀 `logo.png`,四塊 PNG 就是真相)。
- 去背 **MUST** 用「與底色 `(28,32,35)` 的色差」判定,不是亮度 —— 機甲面片是暗藍(46,71,91),亮度門檻會把整片裝甲當背景挖空。覆蓋率用**硬遮罩**(`CUT`)切掉原圖那圈柔光暈(斜坡會留下霧邊),再靠 **4× 超取樣降取樣**換回無鋸齒的銳利邊;取色 **MUST** 解除底色混合(un-premultiply),否則每個圖形會鑲一圈暗灰邊。
- 材質分類 **MUST** 只在高彩度處下判斷,低信心像素(圖形內部的暗描邊)以 BFS 從鄰居取材質 —— 硬判色相會把黃色形狀的描邊判成鋼鐵,連通元件碎成上百塊、四區塊分家全亂。

**測試標準流程(MUST 逐步執行,見 #INC-101/102):**
1. `netstat -ano | grep :8620` — 檢視**全部** LISTENING 行。
2. `taskkill` 所有監聽者(含 npm 父進程),再確認 0 個 LISTENING。
3. `node server/server.js` 起新伺服器 → `npm test`。

**e2e 結構**:前段直接 import `BattleSim` 做確定性單元測試(`_add` 加的測試假人沒有 `lane`,tick 前 **MUST** 刪掉);後段 WebSocket 端對端。迷霧下 e2e 要「看到」敵方單位 **MUST** 另開 `mode:'spectator'` client 做偵察,動作仍由當事 client 送出。防空伏擊測試把無人機 `hp` 設 99999 停在 `aasite` 正上方防塔擊落。

**瀏覽器冒煙測試**:借用 mapping_elf 的 Playwright
(`file:///C:/Users/user/Documents/app/mapping_elf/node_modules/playwright/index.mjs`);
`window.__SVS` 可存取 app 狀態;`__SVS.net.send({t:'createRoom', battleConfig: <synthetic cfg>})` 可跳過緩慢的 OSRM 掃描。

**全角色 rig 稽核**(動骨架/關節後 MUST 跑):頁面內 `import('/js/models.js')` 對 32 名角色各跑一次 `makeUnit`,印出每具的 `rig.legChainL/armChainL/chFL…` 長度與 morph 的 `kneeL/ankleL/elbowL/wristL` 是否存在 → 一眼看出哪個機種掉了關節(手掌/腳掌被焊死的老 bug 就是這樣抓到的)。再以 `stepLocomotion` 餵假位移跑 40 幀後量包圍盒 `min.y ≈ 0`,確認腳沒有離地或插進地面。
