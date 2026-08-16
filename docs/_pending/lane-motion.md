# lane-motion 文件差異(整合者序列合併用)

> 本輪落地:**⑥-3 動畫權重向量**(`docs/anime_style_plan.md` ⑥ 第 3 點)+ **序 6 / ⑦ 音效與 BGM**。
> 平行窗期間本道**一個字都沒有動** `CLAUDE.md` / `.claude/rules/**` / `docs/anime_style_plan.md` /
> `public/js/.claude.md` / `tools/CLAUDE.md`。以下四段是要合併進那幾支的原文。
> M3(⑤-1 的 `game._charSlots` 餵入)**不在本階段** —— 它要吃 lane-ink 的 `setCelChar` 契約。
> ⑥-2 鳥群整項延後(見 `_lane_plan.json` 的 notes)。

---

## ① `.claude/rules/seams-*.md` 要新增的那一列(原文)

### 1-a → `seams-render.md`(§2.1 F),**緊接「幀率無關阻尼」那一列之後**

| 領域 | 唯一縫 | 鐵律 / 稽核 |
|---|---|---|
| 動畫權重向量(「這台現在在做什麼」) | `animweights.js`(`WEIGHT_KEYS`/`animWeights(L, rig, opts)`/`RUN_LO`·`RUN_HI`/`AIR_BAND_F`);唯一產生點 = `locomotion.stepLocomotion` 收尾的 `L.w =`;第二個呼叫端 = `game._stepSelfWeights`(自機在 `_updateEnts` 早退、沒有 `loco`);唯一讀取縫 = `game._entWeights(ent)` | 2026-08-16(`docs/anime_style_plan.md` ⑥-3)。落地前同一件事有**三份互相矛盾**的實作:①速度 `locomotion` 的 `L.speed`(位移差分 + 阻尼)vs `game.js` 的 `ent._moveSpd`(未阻尼、吃 8Hz 插值鋸齒,`* 0.6` 還是逐幀常數 = 幀率相依,序 2 漏掉的一處)②離地 換樹 `MORPH.GROUND_Y` 2 / 觀戰取景 `SPEC_CAM.FLY_M` 2.5 / 環境音寫死的 3 ⇒ **2~3m 之間機體已經是飛行型而音床還在踏地** ③`_updateMoveAudio` 自己又寫了一條 `moveGate` 速度曲線。三者**都沒有錯誤訊息、也沒有任何既有斷言會紅**(每一份單看都是對的)。①**地面三軌 idle/walk/run 的和恆為 1**(誤差 < 1e-9)—— 和不為 1 時 ⑦-2 的 gain-ride 交叉淡入會在中間速度掉一塊音量;寫法 MUST 是 `walk = amp − run`、`idle = 1 − amp`(獨立算 idle 就破)。②**每一格恆為有限數**,`L` 缺欄回 0 **MUST NOT 回 NaN** —— `ent.loco` 在重生瞬移那一幀是 `null`(`_updateEnts` 的 `_snapPos` 分支),NaN 進 `AudioParam.setTargetAtTime` 會丟例外**把整條 requestAnimationFrame 迴圈打斷**(畫面凍結,而錯誤看起來像音效壞了)。③**鍵集由 `WEIGHT_KEYS` 推導**,消費端 MUST NOT 手寫鍵表,本檔 MUST NOT 出現逐機種 / 逐角色名冊(同 A33 ⑤)。④**零 import、度量一律由呼叫端注入**(離地門檻 `opts.groundY` ← `MORPH.GROUND_Y`、速度正規化基準 `opts.top` ← `rig.top`);檔內常數一律是**無單位的比例**(沿用 `edgewall.js`「坡度門檻由呼叫端注入」的紀律)。`AIR_BAND_F = 0.5` 讓 `air` 恰在 `y === groundY` 跨過 0.5 ⇒ 消費端的 `w.air > 0.5` 與換樹是**同一條線**,不是第四個門檻。⑤`stepLocomotion` 收尾**只寫不讀** ⇒ 既有步態逐位元不動(`audit_gait_anat` 八段 MUST 逐字不變)。⑥`stepAerial`/`stepVehicle` 不寫 `L.amp` ⇒ 缺席時 MUST 退回 `L.speed ÷ rig.top`(**同一份**速度、**同一個**正規化基準,只是少了阻尼),MUST NOT 在權重端重新差分位置;不補這一條的話直升機/坦克那兩床**從此不出聲而每一條斷言都綠**。⑦`braceF`(`locomotion.js` 的 `clamp(rig._aim …)`)**MUST NOT** 改讀本向量 —— `audit_gait_anat` Ⅷ①b 釘的就是「站著不動不是射擊姿勢的來源」。稽核 `audit_anim_weights` ±`--break-second`/`--break-thresh`/`--break-sum`/`--break-gate`/`--break-hand` |

### 1-b → `seams-ui-net.md`(§2.1 H),音效至今**沒有任何 §2.1 列**,本輪補上

| 領域 | 唯一縫 | 鐵律 / 稽核 |
|---|---|---|
| 音效層級(地點床 / 移動床 / 事件音 / BGM 階梯) | 名冊 `audio.js` 的 `AMB_BASE`/`AMBIENCE`/`SFX_MANIFEST`/`BGM_MANIFEST` + 解析器 `ambienceMix(q)`(純函式,全專案唯一一行 gain 公式)+ `bgmUrl(name, low)`(BGM 取檔唯一縫)+ 播放端 `setAmbience`/`_ambRide`/`_ambVoice`/`setMove(cat, gain, pan, rate, wet)`/`_moveVoice`/`_play`;量測端 `game._updatePlaceAudio`/`_ambDensityAt`/`_updateMoveAudio`;授權帳 `public/audio/README.md` | 2026-08-16(`docs/anime_style_plan.md` ⑦;§0-d「補名冊,架構不動」)。**四層**:①地點床(你**在哪裡**,常駐)②移動床(戰場上**有什麼在動**,常駐)③事件音(一次性,經 `_play` 的去重窗 `_DEDUP_S` + 聲部上限 `_MAX_VOICES`)④BGM(`HTMLAudioElement` 串流 + 程序旋律備援)。九條:①**地點床的優先序 = `AMBIENCE` 的宣告順序**,`ambienceMix` 是 **first-match-wins**,同時只有一床有增益 —— 累加所有在範圍內的床 = 交界處兩床一起響而且總音量爆掉,而每一個 gain 單看都還在 [0,1];②**恆亮床 `AMB_BASE` 刻意不在 `AMBIENCE` 裡**(它無條件、無球,放進名冊就要為它發明一組永遠成立的 r/m),沒有它的話所有床都不在範圍內時分區邊界會被聽成一個洞;③淡入寬度 `m` **逐床 MUST 不同** —— 那個差別就是「邊界的性格」(城市是慢慢浮起來的一片,洞口是一步之內就換掉的一道門);④**常駐床 MUST NOT 走 `_play`**(去重窗與 `_MAX_VOICES` 會在齊射時把它丟掉,症狀是「打得最兇的時候環境音整片消失」),而且**永不 `pause()`**,只 ride 音量(`dispose()` 才收);⑤常駐床 MUST 走 `HTMLAudioElement` **串流** + `createMediaElementSource` 接進匯流排,**MUST NOT `decodeAudioData`**(七床各 30s 立體聲 ≈ 7 × 11MB 常駐 PCM —— decoded buffer 才是音效系統的真實成本);⑥**`stomp` 的乾/濕兩條鏈由同一顆 chop LFO 開合**(`chopped()` 回傳那一顆、濕床 `chopOn(lfo, …)` 掛上去)⇒「同相」是**構造保證**不是一段同步程式;MUST NOT 為濕床另建第二顆振盪器或第二個 `_moveVoice`,那正是「走進水裡會踏空一拍」,而兩顆 LFO 在任何靜態斷言上都看不出問題;乾/濕交叉淡入權重**恆和為 1**;⑦**多 take**(`SFX_MANIFEST` 的值 = `string | string[]`)逐次挑一個不重複上一次 + `playbackRate` ±`_RATE_JIT`,`_count` 的時長 **MUST 除以 rate**(不除的話聲部計數釋放錯位、`_MAX_VOICES` 緩慢漂掉);**MUST NOT 為了「聽得出有多個 take」放寬 `_DEDUP_S`**(那會把齊射的收斂拿掉,直接回到一牆噪音);⑧**低記憶體階梯**:`_loadSamples` 開頭 `if (this.lowPower) { this._loadBgm(); return; }` 早退 MUST 排在 fetch 迴圈**之前**,而且 **`setLowPower(false)` MUST 補 `_loadSamples()`** —— 漏了就是關掉低功耗之後音效永久停在 Layer 1 合成,**有聲音、沒有錯誤訊息、每一條既有斷言全綠**,使用者只會說「設定好像沒作用」;BGM 取檔一律經 `bgmUrl(name, low)` 一個縫,行動版編碼缺檔自動退回桌機版;⑨**授權底線 CC0 only**,`public/audio/README.md` 的表是**來源帳**不是說明文字(實體存在卻沒登記 = 紅、任一列出現 `CC BY`/`-NC`/`BY-SA` = 紅、登記了但檔案還沒到位 = **待補清單不判紅**)。量測端三條:water/swamp 讀當幀已算好的 `this._env.ground`(`_envAt` 每幀跑過)、tunnel 讀既有的 `terrain.tunnelAt`、urban/forest **複用既有的 A6 碰撞網格 `_blockGrid`** 逐格計數並快取在 `_ambDens`(**MUST 與 `_blockGrid` 同一處失效**,否則碉堡把街廓拆平之後市區床還在響 —— 與「幽靈站立面」同一族),而且 MUST 四鄰格心**雙線性內插**(64m 硬階梯是聽得出來的,而每一條離線斷言都會過)。`Math.random()` 在 `audio.js` 恰三處(白噪 / take 挑選 / rate 抖動)—— 逐事件、純客戶端、**不進任何共享 `rnd()` 序列**,故不違反 A4;`audio.js` MUST NOT import `rng.js`。killswitch `?amb=0`。稽核 `audit_audio_layers` ±`--break-prio`/`--break-base`/`--break-margin`/`--break-sync`/`--break-take`/`--break-tier`/`--break-licence` |

---

## ② `.claude/rules/verification.md` 要加的兩處

### 2-a §5.1(續)「離線稽核」區塊,加兩行

```bash
node tools/audit_anim_weights.mjs    # 動畫權重向量(⑥-3;縫恰一份 / 離地門檻注入 / 三軌和 = 1 / 缺欄不回 NaN)
#   ±--break-second/--break-thresh/--break-sum/--break-gate/--break-hand
node tools/audit_audio_layers.mjs    # 音效層級(地點床名冊與優先序 / 乾濕同相 / 多 take / 低記憶體階梯 / CC0 來源帳)
#   ±--break-prio/--break-base/--break-margin/--break-sync/--break-take/--break-tier/--break-licence
```

### 2-b §5.5 對照表,加兩列

| 改動 | 驗證 |
|---|---|
| **動畫權重向量**(`public/js/animweights.js` 全檔 / `locomotion.stepLocomotion` 收尾的 `L.w` / `game.js` 的 `_entWeights`·`_stepSelfWeights`·`_moveCat` 的 air 判定·`_updateMoveAudio` 的 `moveGate`/`rate`) | `audit_anim_weights` ±**五支** `--break`(每一支 MUST 對應紅字)+ **`audit_gait_anat` 逐字不變**(`stepLocomotion` 只多寫一格 `L.w`、不讀任何新東西 ⇒ 步態逐位元不動;這就是計畫 ⑥ 驗證欄那句「既有斷言 MUST 逐項不動」)+ `audit_morph_rig`/`audit_paper_doll`/`audit_damp_fps`(**`animweights.js` MUST 進 `audit_damp_fps` 的掃描名冊** —— 名冊漏掉的檔案裡寫 `Math.min(1, dt·k)` 一樣掃不到而那支照樣全綠)+ `audit_client_syntax`(㋖)+ `npm run audit:net`/`audit_solo_boot`(新增客戶端模組 `animweights.js`)+ ㋔ game.js 那一批(`npc_collide`/`climb`/`layer_block`/`slope_move`/`view_lock`/`spectator_cam`/`blood_splat`)+ **`npm run bal` / `npm test` MUST 逐項不動**(`data.js`/`sim.js`/`server/**` 一行未改)。⚠ **音效端刻意不是逐位元中性**:離地門檻由 3m 收斂到 `MORPH.GROUND_Y`(2m)、`moveGate`/`rate` 的輸入由未阻尼的 `_moveSpd` 換成阻尼過的權重 ⇒ ①2~3m 高度帶內的英雄從此**立刻**切到飛行型音床(舊制慢一拍)②靜止/起步的音量過渡不再有 8Hz 插值鋸齒。這兩項**沒有任何離線模型守得住**(`npm run bal` 不模型化音效)⇒ MUST 列進交付說明的未驗項並**真機聽一次**(㋕) |
| **音效層級**(`public/js/audio.js` 全檔 / `game.js` 的 `_updateMoveAudio`·`_updatePlaceAudio`·`_ambDensityAt`·`_clearAroundBunker` 的快取失效 / `public/audio/README.md` 的來源帳 / `public/audio/**` 新增任何檔案) | `audit_audio_layers` ±**七支** `--break`(每一支 MUST 對應紅字;`--break-take` 的兩條「去重窗現值」與 `--break-tier` 的三條「`bgmUrl` / 補載入」是**對照組 MUST 仍綠**)+ `audit_anim_weights`(移動床的 gate 吃的是權重向量)+ `audit_client_syntax`(㋖)+ `npm run audit:net`(⚠ 稽核檔內 **MUST NOT 出現帶前導斜線的 `audio` 路徑字面** —— `audit_net_modes.mjs` 的 `strayPaths` 掃 `tools/*.mjs`,踩到會紅在一個完全不相干的訊息上)+ `audit_solo_boot` + ㋔ game.js 那一批 + **`npm run bal` / `npm test` MUST 逐項不動**(純表現層,伺服器不 import `audio.js`)。**放進 `public/audio/**` 的任何檔案 MUST 同時在 README 的來源帳補一列**(Ⅷ 段雙向比對:實體存在卻沒登記 = 紅)。⚠ ㋕ 真機三件離線驗不到:①**低功耗開→關**之後樣本 MUST 回來(這是本項最容易靜默壞掉的一格)②走進水裡的腳步 MUST 是**交叉淡入不是換聲道**(踏空一拍只有耳朵聽得到)③地點床的優先序聽起來對不對 |

---

## ③ 根 `CLAUDE.md` §2.1 目錄要加的主題名

- `seams-render.md` 那一列(§2.1 F)的主題名尾端補:**`・動畫權重向量`**
- `seams-ui-net.md` 那一列(§2.1 H)的主題名尾端補:**`・音效層級`**

> §2.1 的鐵律是「目錄裡查不到就會被當成沒有規則」;音效至今**完全不在** §2.1 的目錄裡
> (規則只散在 `audio.js` 檔頭與 `public/audio/README.md`),本輪正好補上。

## ③-b `public/js/.claude.md` §1 檔案職責地圖要加的一列

| 檔案 | 職責 |
|---|---|
| `animweights.js` | **動畫權重向量唯一縫**(⑥-3)。**零 import**(同 `gaitcurve.js` / `morphrig.js` / `visualPrefs.js` / `rng.js`)—— 度量一律由呼叫端注入(離地門檻 `opts.groundY`、速度正規化基準 `opts.top`),檔內常數一律是無單位的比例。離線稽核因此直接執行真品,不必 mock three 或 `data.js`。產生點只有 `locomotion.stepLocomotion` 收尾一處,自機那一份走 `game._stepSelfWeights`(自機在 `_updateEnts` 早退、沒有 `loco`),讀取一律經 `game._entWeights`。 |

---

## ④ `docs/anime_style_plan.md` 執行紀錄那一列

| 序 | 項目 | 做了什麼 | 用什麼守住 | 留下什麼 |
|---|---|---|---|---|
| ⑥-3 | 動畫權重向量 | 新建 `public/js/animweights.js`(零 import、`WEIGHT_KEYS` 有序 10 軌、地面三軌和恆為 1、缺欄回 0 不回 NaN、離地門檻由呼叫端注入);`locomotion.stepLocomotion` 收尾**只寫不讀** `L.w`;`game.js` 三處收斂 ——(a) 刪掉 `ent._moveSpd` 這第二份速度推導(未阻尼 + `* 0.6` 逐幀常數 = 序 2 漏掉的幀率相依處)(b) `_moveCat` 的第三個離地門檻 `> 3` 改吃 `w.air > 0.5`(c) `_updateMoveAudio` 的 `moveGate`/`rate` 改吃 `w.walk + w.run` 與 `w.run`;自機那一份走新的 `_stepSelfWeights`(同一支 `animWeights`,MUST NOT 另寫玩家版判斷) | `audit_anim_weights` 36 條 + 5 支 `--break`(含**行為直測**:離地門檻換一個 `groundY` 跨越點要跟著搬;`loco === null` 那一幀真的跑一次 `_updateMoveAudio` 量它交出去的每一個數);`audit_gait_anat` **逐字不變**;`audit_damp_fps` 名冊納入新模組 | ⚠ **音效端刻意不是逐位元中性**(離地門檻 3m→2m、gate 曲線換來源),沒有任何離線模型守得住 ⇒ 真機聽一次(㋕)。⑥-2 鳥群整項延後 |
| ⑦ | 音效與 BGM | ⑦-3 多 take(`SFX_MANIFEST` 值放寬成 `string \| string[]` + 不重複上一次 + `playbackRate` ±7% + `_count` 除以 rate)/ ⑦-4 低記憶體階梯(`_loadSamples` 低階早退整份 SFX 名冊不註冊、`bgmUrl(name, low)` 取檔唯一縫、`setLowPower(false)` 補載入)/ ⑦-1 地點環境音(`AMB_BASE` 恆亮床 + `AMBIENCE` 六床名冊 + 純函式 `ambienceMix` first-match-wins + 常駐 `HTMLAudioElement` 串流床;量測端複用 `_env.ground` / `terrain.tunnelAt` / A6 碰撞網格密度 + 雙線性內插 + 快取與 `_blockGrid` 同處失效)/ ⑦-2 gain-ride(`stomp` 乾濕兩條鏈**共用同一顆 chop LFO**、`setMove` 補第五格 `wet`、兩床權重恆和為 1、移動床 gate 改吃 ⑥-3 的權重向量) | `audit_audio_layers` 58 條 + 7 支 `--break`(含 64m 格界連續性、多 take 挑選、`bgmUrl` 行為、來源帳雙向比對);`npm run bal` / `npm test` 逐項不動 | **七床 + 兩份行動版 BGM 的 CC0 音檔本輪未下載**(規格與取得清單已寫進 `public/audio/README.md` 的待補表)⇒ 機制完成、內容待補;缺檔時該床靜默、`base` 頂著。**自機是否納入移動床**做成旋鈕 `?selfbed=1`、**預設不生效**(待使用者裁決)。`audio.js` 全檔仍無 `visibilitychange` 處理 —— 計畫 ⑦ 的四條沒列它,依「刻意設計 MUST NOT 補完」本輪不動,只回報 |

---

## ⑤ 待裁決(本道 MUST NOT 自行定案;已照慣例做成旋鈕、預設不生效)

1. **七床的名冊內容與優先序**。現值 `tunnel > water > swamp > camp > urban > forest`,`base` 恆亮。
   **宣告順序就是規則本身**,重排一次就是換一套聽感 ⇒ 值得先確認而不是事後調。
   逐床的 `vol` / `r` / `m` 也是同一題(`m` 是「邊界的性格」:洞口 0.5 的二元查詢 = 一步換掉,
   城市 0.30 的密度查詢 = 慢慢浮起來)。
2. **自機是否納入移動床**。現制 `game.js` 明確 `continue` 掉 `ent.isSelf` ⇒ 玩家聽不到自己的機體,
   而 ⑦-2 講的「走進水裡會踏空一拍」在語意上就是**自己的**腳步。納入是玩家第一次聽到自己的機體
   = **可聽的行為改變** ⇒ 本輪做成 `?selfbed=1`、**預設 0 = 逐位元同舊制**;`_stepSelfWeights`
   與 `_entWeights` 的口子已經留好,裁決下來只要翻預設值。
   (若裁決「納入」,建議只收 `stomp`/`engine` 兩類、`pan = 0`,如現行實作。)
3. **`audio.js` 全檔沒有 `visibilitychange` 處理** —— 切到背景分頁時 BGM 與常駐床照樣播
   (`game.js` 與 `main.js` 已有 `document.hidden` 的先例)。計畫 ⑦ 的四條沒有列它,
   依「刻意設計 MUST NOT 補完」本輪**不動**,只回報。
4. **CC0 音檔的取得**(七床 + 兩份行動版 BGM)。本輪依指示**未下載任何東西**;
   規格(mono / OGG Vorbis ≤ 96kbps / 8~12s 無縫 loop / 每床 ≤ 150KB)與四個來源建議
   已寫進 `public/audio/README.md` 的待補表。行動版 BGM 需要主機上有 ffmpeg,
   而且 ⑦-4 的定案是「**另一份編碼**,不是只調低音量」。
5. **⑥-3 的音效行為改變是否接受**(離地門檻 3m→2m、gate 曲線換來源)。兩條路都自洽:
   (a) 這一輪就切(**現行落地**),交付說明標未驗項 + 真機聽一次;
   (b) 只發布權重、消費端一格不動,把切換整批推給下一輪 —— 代價是兩份速度推導再共存一輪,
   而那正是這一項要修的東西。

## ⑥ 對計畫現況描述的更正(整合者一併寫回 `anime_style_plan.md`)

- 計畫的順序表把 ⑦(音效,序 6)排在 ⑥-2(序 11)之前,而 ⑦-2 的 gain-ride **吃的正是 ⑥-3**;
  ⑥-3 在計畫裡**沒有獨立序號**、被綁在序 11 裡。本輪已把 ⑥-3 提前到 ⑦ 之前落地。
- 計畫 ⑦ 的現況欄說移動床「沒有接動畫權重」屬實;但它同時說移動床的 gain ride 要補
  `setTargetAtTime` —— **那一段 2026-07 就已經是 `setTargetAtTime`**(天生 click-free 且幀率無關,
  序 2 的 `lerpFPS` 不必碰它)。⑦-2 真正缺的只有「地面變體」與「吃權重」兩件,兩件都已落地。
