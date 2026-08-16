# lane-motion 第二階段 文件差異(整合者序列合併用)

> 本輪落地:**M3 = ⑤-1 玩家位移擾動的餵入端**(`game._charSlots()` → `toon.setCelChar`)
> + **序 8 ④-1 的驅動端**(`game._wipeCut()` 與三個轉場時機)。
> 平行窗期間本道**一個字都沒有動** `CLAUDE.md` / `.claude/rules/**` / `docs/anime_style_plan.md` /
> `public/js/.claude.md` / `tools/CLAUDE.md`。以下五段是要合併進那幾支的原文。
> 第一階段的四段(⑥-3 動畫權重向量 + ⑦ 音效)住 `docs/_pending/lane-motion.md`,**兩份都要合**。
>
> 寫過的檔案(全部在本道 `ownsFiles` 之內):`public/js/game.js`・`tools/audit_anim_weights.mjs`。
> `locomotion.js` / `audio.js` / `animweights.js` / `audit_audio_layers.mjs` / `audit_damp_fps.mjs` /
> `audit_gait_anat.mjs` 本輪**一行未改**。

---

## ① `.claude/rules/seams-*.md` 要新增 / 修訂的那一列(原文)

### 1-a → `seams-render.md`(§2.1 F),**緊接 lane-ink 的「玩家位移擾動」那一列之後**

> lane-ink 那一列寫的是 `toon.js` 那一半(`CHAR` / `setCelChar` / `CEL_SWAY` 的位移加項)。
> 這一列是**餵入端**;兩列 MUST 相鄰,合併時 MUST NOT 把它折進 lane-ink 那一列的「消費端」欄
> —— 這一半的規則(速率取自哪裡、排在哪一步之後)在那一列裡一條都寫不下。

| 領域 | 唯一縫 | 鐵律 / 稽核 |
|---|---|---|
| 植被擾動源的餵入(誰在哪裡、走多快) | `game._charSlots()`(唯一產生點)+ 主迴圈 `stepCelWind(dt)` 之後的 `setCelChar(this._charSlots())`(唯一呼叫點);速率來源 = **既有的兩條阻尼縫** —— 他機 `ent.loco.speed`(`locomotion.stepLocomotion` 的位移差分 + `damp` k = 6)、自機 `game._selfSpd`(`_stepSelfWeights` 那一份**同一個** `L`);killswitch `?tread=0` | 2026-08-16(`docs/anime_style_plan.md` ⑤-1 的下半)。①**速率 MUST NOT 在這裡推導**:這個儲存庫的「他在不在動 / 動多快」已經被推導過三次(`locomotion.L.speed` / 已刪除的 `ent._moveSpd` / `_updateMoveAudio` 自己的 `moveGate`),⑥-3 才剛把它們收成一條 —— 在餵入端再差分一次就是 `_moveSpd` 換個名字回來,而兩份速度的差別只表現成「草被撥開的時機跟腳步聲對不上」,**沒有任何錯誤訊息**。②**MUST NOT 拿 `this.vel`**:攀爬(`_stepClimb` 直接定案位移)、被推擠(`solidResolve` 的 push-out)、蓄力跳的水平移速三條路徑都不經過它 ⇒ 症狀是「爬梯子時腳邊的草在被撥開」「衝刺撞牆時草還在倒」。位置差分是唯一同時涵蓋五條路徑的量。③**自機沒有 `loco`**(它在 `_updateEnts` 第一行就 `continue`,位置由 `this.pos` 直接指派)⇒ 它的替身是 `_stepSelfWeights` 交出來的 `_selfSpd`,而那一支的閘門因此吃**兩個**消費端(`?selfbed=1` 的移動床 / `?tread` 的植被擾動),`_selfSpd` **恰一個寫入點**。④**MUST 排在 `_updateEnts` 之後**:`ent.mesh.position` 那時才是本幀 `lerpFPS(9, dt)` 插值完的值,早一步拿到的是上一幀的位置(而畫面上只表現成「草比機體慢半拍」)。⑤槽 0 = **主視野機體**(交戰 = 自機 `this.pos`、觀戰 / 陣亡過場 = `_specPid` 跟隨的那一台),其餘依「離相機距離」升冪補到 `CHAR.N`;主視野機體不存在(剛進場 / 沒人可跟)時 MUST 讓最近的那一台**遞補**,MUST NOT 留一個空的槽 0。跟隨中的那一台 MUST NOT 同時佔兩格。⑥陣亡 / 不可見的機體不進槽 —— 它們的位置停在原地,進了槽就是「草被一具屍體永遠壓著」。⑦交出去的長度 MUST ≤ `CHAR.N`,**沒填到的槽由 `setCelChar` 顯式歸零**(呼叫端不必補,補了就是第二份規則)。⑧`?tread=0` MUST 回**空陣列**(而不是「填了但速度是 0」——後者仍逐槽付一次 `length()`)。⑨純表現層:伺服器、碰撞、`this.vel`、`stepCelWind(dt)` 的簽章一格未動。稽核 `audit_anim_weights` Ⅶ ±`--break-tread`/`--break-charspd`/`--break-charorder` |

### 1-b → `seams-render.md`(§2.1 F),**接在 lane-ink 的「畫面轉場(斜向 wipe)」那一列之後**

> lane-ink 那一列寫的是 pass / 時間軸 / 旋鈕。這一列只寫**呼叫端**的三條規則。

| 領域 | 唯一縫 | 鐵律 / 稽核 |
|---|---|---|
| 轉場的呼叫端(什麼時候切、切點上做什麼) | `game._wipeCut(onCut, color)`(「遮幕 → 切 → 揭幕」的唯一實作)+ 三個時機:開戰揭幕(建構子尾的 `playWipe('reveal')`,**不走 `_wipeCut`**)/ 陣亡過場收尾(`_updateDeathSeq` 的 `done` 分支)/ 結算(`_applySnap` 的 `m.over`) | 2026-08-16(序 8 ④-1 的下半)。①**`cover` 播完之後幕停在全覆蓋**(`wipeAt` 的 `t ≥ dur ⇒ w1 = 1, w2 = 0` 是**定義**不是校準)⇒ 呼叫端 MUST 自己接一段 `reveal`,否則畫面停在一整片幕色上**而且沒有任何錯誤訊息**(實測:`_wipeA` 恆 1、`_wipe` 已是 null、沒有任何東西會把它收回去)。那一對 MUST 寫在**同一個地方** —— 分散到三個呼叫點各寫一次,遲早有一個只寫了前半。②**狀態閘 MUST NOT 跟著延後**:`_gameOver` / `_deathSeq = null` / `hud.deathCine(false)` 照舊**立刻**做,只有「畫面」(`hud.over`、熄紅框)排在切點上 —— 延後狀態閘會讓暫停選單在結算時彈出來。③**重入 MUST 各自有守衛**:`m.over` 之後**每一份**快照都帶 `over`、陣亡過場結束之後**每一幀**的 `done` 都是 true ⇒ 不擋就是幕每 0.34 秒重刷一次(`first` / `s.cut` 兩個旗標)。④回呼 MUST 由幀迴圈觸發(`postfx._tickWipe` 已如此),**MUST NOT 用 `setTimeout`**:離場 / 重賽會在幕播到一半發生,計時器留下來就是下一場冒出上一場的結算頁。⑤旋鈕 `wipe` = 0(預設)⇒ `playWipe` **當場同步走回呼並回 false** ⇒ `_wipeCut` 等價於 `onCut()` 一行,連 `hud.over` 的呼叫時序都逐位元同舊制;`pipeline` 不存在(`?post=0`)或那支 API 還沒上線時同理降級(原則 6,`typeof p?.playWipe !== 'function'`)。⑥幕色由呼叫端餵(`sideInfo(side).color`),MUST NOT 進 `WIPE` —— 那會與 `toon.js OUTLINE_COLOR` 並存成第二份墨色。稽核:見 ② 的「要補進 `audit_visual_prefs` Ⅶ 的三條」 |

---

## ② `.claude/rules/verification.md` 要加的兩處

### 2-a §5.1(續)「離線稽核」區塊 —— `audit_anim_weights` 那一行補三支 `--break`

```bash
node tools/audit_anim_weights.mjs    # 動畫權重向量(⑥-3)+ **⑤-1 植被擾動的餵入端**
#   ±--break-second/--break-thresh/--break-sum/--break-gate/--break-hand
#   ±--break-tread(killswitch 的早退拿掉 ⇒ 「?tread=0 回空陣列」行為直測 MUST 紅)
#   ±--break-charspd(速率改由 _charSlots 自己再推導一次 ⇒ 「沒有第二份速度推導」等三條 MUST 紅)
#   ±--break-charorder(餵入點移到 _updateEnts 之前 ⇒ 順序那一條 MUST 紅)
```

### 2-b §5.5 對照表 —— 新增一列,並在「動畫權重向量」那一列補一句

| 改動 | 驗證 |
|---|---|
| **⑤-1 植被擾動的餵入端**(`game.js` 的 `TREAD`·`_charSlots`·`_selfSpd`·`_stepSelfWeights` 的閘門·主迴圈的 `setCelChar(this._charSlots())`) | `audit_anim_weights` Ⅶ ±**三支** `--break`(每一支 MUST 對應紅字;既有五支 MUST 仍各自紅字)+ **`audit_gait_anat` 逐字不變**(`locomotion.js` 一行未改)+ `audit_soft_stroke`(`toon.js` 那一半是 lane-ink 的,MUST 逐項不動)+ `audit_damp_fps` ±`--break-damp`(`_charSlots` 不自己阻尼,但它是 game.js 掃描名冊的一部分)+ `audit_client_syntax`(㋖)+ ㋔ game.js 那一批(`npc_collide`/`climb`/`layer_block`/`slope_move`/`view_lock`/`spectator_cam`/`blood_splat`)+ **`npm run bal` / `npm test` MUST 逐項不動**(`data.js`/`sim.js`/`server/**` 一行未改)+ **㋓ `audit_muzzle`/`audit_cockpit`/`audit_cast_jump`**(game.js 動過;`SVS_URL` MUST 指向本工作區的埠)。⚠ **「草真的被撥開了嗎」離線一條都驗不到** —— GLSL 在 Node 端執行不了,原文不變式只證明「有這個機制」。⇒ ㋓ 真瀏覽器 `shot_scene` 的 `lane_mid`/`hilltop` 在 `?tread=0` 與預設下各拍一張:**`?tread=0` MUST 與改制前 md5 逐位元相同**(那是「早退不加」的驗收面),預設下 MUST 看得出機體腳邊的草倒向外側 |
| **轉場的呼叫端**(`game._wipeCut` + 建構子的 `playWipe('reveal')` + `_updateDeathSeq` 的 `done` 分支 + `_applySnap` 的 `m.over`) | `audit_visual_prefs` Ⅶ(**要補三條,見下**)+ ㋔ game.js 那一批 + **`npm run bal` / `npm test` MUST 逐項不動** + **㋓ 真瀏覽器把旋鈕開起來各走一次**:開戰 / 陣亡 / 結算三個時機,判準是「幕拉開之後畫面回得來」(`_wipeA` MUST 回 0)。⚠ **旋鈕開著時 `hud.over` 與陣亡過場收尾各延後 `WIPE.COVER_S`(0.34 s)** —— 那是設計上的時序改動,不是 bug(見 ⑤-2) |

> 「動畫權重向量」那一列補一句:**`_stepSelfWeights` 的閘門自 2026-08-16 第二輪起吃兩個消費端**
> (`SELF_BED` / `TREAD`),`?selfbed=0 且 ?tread=0` 時仍整支早退;只有 `?tread` 開著時 `_selfW`
> 算了但沒有人讀(`_updateMoveAudio` 仍 `continue` 掉自機)⇒ **音效端逐位元同舊制**。

### 2-c 要補進 `audit_visual_prefs` Ⅶ 的三條(呼叫端;lane-ink 擁有那一支 ⇒ 由整合者貼)

```js
// Ⅶ-h 「遮幕 → 切 → 揭幕」的唯一實作:cover 播完幕停在全覆蓋,沒有 reveal 就是黑到底
{
  const g = code(readSrc('public', 'js', 'game.js'));
  const cut = grabMethod(readSrc('public', 'js', 'game.js'), '_wipeCut');
  ok(/playWipe\('cover'/.test(cut) && /playWipe\('reveal'/.test(cut),
    '`_wipeCut` 內 cover 與 reveal **成對**(cover 的終態是全覆蓋 —— 少了 reveal 就是畫面停在一片幕色上)');
  // ⚠ 樣式要吃得下選用鏈:建構子那一處是 `playWipe?.(`(API 沒上線時的降級,原則 6),
  //    `_wipeCut` 那一對是 `playWipe(`(它自己在上面用 typeof 擋過了)⇒ 2 + 1 = 3
  ok(count(g, /playWipe\??\.?\(/g) === 3,
    'game.js 的 `playWipe` 恰三處:開戰揭幕 1 + `_wipeCut` 的一對 2(第四處 = 有人在別的地方又寫了一次成對邏輯)');
  ok(count(g, /this\._wipeCut\(/g) === 2,
    '`_wipeCut` 恰兩個呼叫點(陣亡過場收尾 / 結算)');
}
// Ⅶ-i 重入守衛:m.over 每一份快照都帶、陣亡的 done 每一幀都真 ⇒ 不擋就是幕一直重刷
ok(/const first = !this\._gameOver;/.test(g) && /if \(first\) this\._wipeCut\(/.test(g),
  '結算只有**第一份**帶 over 的快照起幕(`m.over` 之後每一份快照都是 true)');
ok(/if \(done && !s\.cut\)/.test(g) && /s\.cut = true;/.test(g),
  '陣亡過場收尾恰起一次幕(`done` 之後每一幀都是 true)');
// Ⅶ-j 狀態閘 MUST NOT 跟著延後(延後 = 暫停選單在結算時彈出來)
ok(/this\._gameOver = true; this\._deathSeq = null; this\.hud\.deathCine\?\.\(false\);[\s\S]{0,400}?_wipeCut/.test(g),
  '`_gameOver` / `_deathSeq` / `deathCine` 三個狀態閘照舊立刻做,只有結算頁排在切點上');
```

`--break-wipepair` 的壞版:把 `_wipeCut` 裡 `p.playWipe('reveal', null, opts);` 那一行刪掉
⇒ Ⅶ-h 第一條 MUST 紅(**替換無效 MUST 當場 `process.exit(1)`**,樣式用 `\r?\n`)。

---

## ③ 根 `CLAUDE.md` §2.1 目錄要加的主題名

`seams-render.md` 那一列(§2.1 F)的主題名尾端補:

- **`・植被擾動源的餵入`**
- **`・轉場的呼叫端`**

> §2.1 的鐵律是「目錄裡查不到就會被當成沒有規則」。這兩個主題與 lane-ink 的
> 「玩家位移擾動」「畫面轉場」是**同一件事的兩半**,兩邊都要在目錄裡查得到 ——
> 只列縫那一半的話,下一個人會在 `game.js` 裡再寫一次餵入端。

---

## ④ `docs/anime_style_plan.md` 執行紀錄那一列

| 序 | 項目 | 做了什麼 | 用什麼守住 | 留下什麼 |
|---|---|---|---|---|
| ⑤-1(下半) | 玩家位移擾動的餵入端 | `game.js`:新增 `TREAD`(`?tread=0`)與 `_charSlots()`(槽 0 = 主視野機體、其餘依離相機距離升冪、固定長度插入排序**零配置**);主迴圈在 `stepCelWind(dt)` 之後(= `_updateEnts` 之後)呼叫 `setCelChar(this._charSlots())`;`_stepSelfWeights` 的閘門改吃兩個消費端並多交出一份 `_selfSpd`(自機版的 `ent.loco.speed`,**同一個 `L`**)。**速率一格都沒有重新推導** —— 他機取 `ent.loco.speed`、自機取 `_selfSpd`,兩者都是既有的「位移差分 + 阻尼」縫 | `audit_anim_weights` Ⅶ 18 條(含**行為直測**:真的把 `_charSlots` 原文丟進 `new Function` 跑 —— 槽 0 是誰 / 升冪 / `?tread=0` 回空陣列 / `loco === null` 那一幀 / 觀戰跟隨不佔兩格 / 沒人可跟時遞補 / 場上少於 N 時只交幾格 / 陣亡不進槽)+ 3 支 `--break`;`audit_gait_anat` **逐字不變**;`npm run bal` / `npm test` 逐項不動 | ⚠ **速率沒有上界**:`cR = R0 + R_PER_MPS × spd` 而 `spd` 來自 `L.speed`,實測掉幀時(dt 夾到 0.1 而快照目標跑掉)`L.speed` 讀到 **150.8 m/s** ⇒ 擾動半徑 40 m。這是既有 `L.speed` 就有的性質(既有消費端都自己夾過),而半徑的夾制屬於 `CHAR` 那一列 ⇒ **本道不自己加上界**,寫進待裁決(⑤-1) |
| ④-1(下半) | 轉場的呼叫端 | `game.js`:新增 `_wipeCut(onCut, color)`(「遮幕 → 切 → 揭幕」唯一實作)+ 三個時機 —— 開戰揭幕(建構子尾,只有 `reveal`)、陣亡過場收尾(`s.cut` 守衛)、結算(`first` 守衛,回呼裡才叫 `hud.over`)。幕色取 `sideInfo(side).color` / 結算取勝方色 | ㋓ 直推 `_tickWipe` 逐 tick 實測(見 ⑤ 的量測表):旋鈕 0 ⇒ `playWipe` 回 false、`cut` 同步 +1、`_wipeA` 恆 0(**pass 從不進鏈**);旋鈕 1 ⇒ cover w1 0→1 且 flash 在切點到 1、回呼恰一次、reveal 之後 `_wipeA` 回 0 | **`postfx.js` / `cutin.js` / `data.js` / `visualPrefs.js` 一行未動**(那是 lane-ink 的)。三條呼叫端不變式**沒有稽核在守** —— 要補的斷言原文寫在 `lane-motion-w2.md` ②-c,由整合者貼進 `audit_visual_prefs` Ⅶ |

### 同輪 MUST 寫回計畫檔的更正(本道量到的)

1. **⑤-1 的「速率由位置差分經 `lerpFPS` 平滑」不需要在 `game.js` 新寫一份**。規格與 S5 契約都
   寫成「`_charSlots(dt)` … 速率由位置差分求、經 `lerpFPS(CHAR.SPD_K, dt)` 平滑」,而這個
   儲存庫**已經有兩份現成的**同式量(`locomotion.L.speed`、`_stepSelfWeights` 的 `L.speed`,
   兩者都是 k = 6 的 `damp`/`lerpFPS`,與 `CHAR.SPD_K = 6` 同值)。照字面再寫一份就是
   **⑥-3 花一整輪刪掉的 `ent._moveSpd` 換個名字回來**。⇒ 實作取既有兩縫,`_charSlots`
   因此**連 `dt` 都不吃**(簽章是 `_charSlots()` 不是 `_charSlots(dt)`)。
2. **序 8 的「`game.js` 恰兩個呼叫點」要改成「`playWipe` 恰三處 + `_wipeCut` 恰兩個呼叫點」**。
   規格(seq8「新稽核落點」Ⅶ-g)寫的是開戰 + 結算兩個時機,而本輪依指示做三個時機
   (開戰 / 陣亡 / 結算);更重要的是規格**沒有寫出「cover 播完幕停在全覆蓋」** ⇒
   每一個 cover 呼叫點都必須自己接 reveal,那一對收進 `_wipeCut` 之後 `playWipe` 的處數
   是 1(開戰揭幕)+ 2(那一對)= 3。
3. **序 8 的「`_tickWipe` 排在 `pipeline.render()` 之前由 `game.js` 推」已經不是現況**:
   lane-ink 落地時把 `_tickWipe()` 放進 `postfx.render()` 自己組 chain 那一段(`postfx.js`
   組 `chain` 的 wipe 那一列上方)⇒ **`game.js` 不需要也 MUST NOT 再推一次**(推兩次 =
   幕以兩倍速播完)。規格「寫入檔案」那一列的 `game.js — playWipe/_tickWipe 驅動` 只剩前半。

---

## ⑤ 待裁決(本道 MUST NOT 自行定案;已照慣例做成旋鈕 / killswitch、預設不生效)

1. **`CHAR.N = 4`(主視野機體 + 最近 3 台)vs 計畫原文的單一角色 —— 原封抄自規格,仍未裁決。**
   計畫原文只寫 `charPos` / `charSpeed` 兩個 uniform(= **單一角色**);4 槽是本輪的建議
   (第三人稱與觀戰下兩台常同框,只撥開自機腳邊的草很明顯不對)。代價是逐頂點 4 次
   `length()` + `smoothstep`,落在草 / 稻那幾列(全場頂點數最高的 InstancedMesh)上,
   而且會有**槽位換手的瞬跳**(被擠出去的那一台下一幀 `spd` 歸 0 ⇒ 它腳邊的草彈回去)。
   **兩種都自洽。** 裁決成「單一角色」的話,`toon.CHAR.N` 改 1 即可 —— 餵入端一行都不用動
   (`_charSlots` 的槽數整個由 `CHAR.N` 推導,稽核也從 `toon.js` 抽真品比對)。
2. **`_charSlots` 的速率沒有上界(實測掉幀時 150.8 m/s ⇒ 擾動半徑 40 m)。**
   `L.speed` 是「位移差分 + 阻尼」,在掉幀那一幀(`dt` 夾到 0.1、而 8Hz 快照的目標已經跑遠)
   會讀到遠高於機體真實移速的值;既有消費端都自己夾過(步態 `L.amp` 夾 1.2、音效 `moveGate`
   夾 [0,1]),而 ⑤-1 是**第一個把它當成尺度用**的消費端 —— 強度那一半已經由
   `min(1, spd / SPD_REF)` 飽和,但**半徑 `R0 + R_PER_MPS × spd` 沒有上界**。
   症狀:掉一格幀 ⇒ 那一台腳邊 40 m 的草被壓成一圈(0.2 秒內自己收回去)。
   本道**刻意不加上界** —— 半徑的規則住 `toon.CHAR` 那一列(lane-ink),在餵入端夾就是
   「半徑」這條規則有兩份;而上界該取多少是設計決定(`SPD_REF` 的倍數?最快機體的 `top`?)。
   ⇒ 請裁決:(甲)不夾,當它是「掉幀時的一陣風」;(乙)在 `CHAR` 加一個 `SPD_MAX`
   由 lane-ink 落在 GLSL 側;(丙)在餵入端夾 —— 不建議,理由如上。
3. **`?tread=0` 要不要升級成設定頁旋鈕。** 現行慣例是 URL killswitch(`?sag=0` / `?morph=0` /
   `?gait=0` / `?cockanim=0`),而 `visualPrefs` 紀律① 要求 `def` = 交付定案值 ⇒ 做成旋鈕的話
   `def` 應該是 'on'。⑤-1 是逐頂點成本(不是逐幀 CPU),與 `dof` / `shadow` 不同類 ——
   本道維持 killswitch。**旋鈕表由 lane-ink 單一擁有(S10),本道一格都沒有塞。**
4. **轉場旋鈕開著時的兩處時序改動是否接受。** 兩者都是**設計上的延後**、旋鈕 `wipe` = 0(預設)
   時逐位元同舊制:①結算頁 `hud.over` 延後 `WIPE.COVER_S`(0.34 s)——
   seq8 規格自己就把這一條列成「需要確認可接受」;②陣亡過場的收尾(`_deathSeq = null` +
   熄紅框)同樣延後 0.34 s,鏡頭多停在殘骸上 0.34 秒。
   ⚠ 若裁決「不接受」,那 `cover` 這個模式在本輪就沒有呼叫點(而未接線的 pass 是死碼)。
5. **開戰揭幕刻意不走 `_wipeCut`。** 開戰只有「拉開」沒有「蓋上」(前一幕是大廳的 DOM,
   幕只蓋 3D 主畫面 ⇒ 蓋上去也蓋不到它)。若使用者要的是「大廳 → 戰場」整段都被幕蓋住,
   那是 `main.js` 的事(lane-world 的地盤),本輪沒有動。
6. **幕只蓋 3D 主畫面**(PiP / 小地圖 / 陣亡鏡頭 / 全部 DOM HUD 都畫在 `pipeline.render()`
   之後)。結算頁本來就蓋住全部所以看不出來,陣亡那一次會看到幕底下露出 HUD。
   **MUST NOT 靠再寫一份 DOM 幕補完**(那是同一個轉場的第二份實作,傾角與時間曲線遲早分家)
   —— 要補的話正解是把 `_renderPips` / 陣亡鏡頭移到管線之內,那是另一輪的事。
7. **⑥-3 第一階段的五條待裁決仍然開著**(七床名冊與優先序 / 自機是否納入移動床 /
   `visibilitychange` / CC0 音檔取得 / 離地門檻 3m→2m 的音效行為改變)——
   見 `docs/_pending/lane-motion.md` 的 ⑤。本輪一條都沒有動到它們。

---

## ⑥ 量測(本輪實際跑出來的數,MUST NOT 憑記憶重建)

| 量 | 值 | 怎麼量的 |
|---|---|---|
| `audit_anim_weights` 項數 | 36 → **54**(新增 Ⅶ 18 條) | `node tools/audit_anim_weights.mjs` |
| `--break-*` 支數 | 5 → **8**(+`tread`/`charspd`/`charorder`) | 逐支跑,exit code 全為 1 |
| `audit_gait_anat` | **逐字不變**(43 項) | `diff <(node tools/audit_gait_anat.mjs) docs/_pending/base-gait.txt` |
| `npm run bal` | **逐位元同基準** | `diff` 對 `scratchpad/bal.txt` |
| `npm test` | 624 ✅ / 0 ❌,**與基準同項**(差異只有 PIN / 掉落 / 稀有度那幾個 `Math.random()` 的數) | `WS_URL=ws://localhost:8677 npm test`,先照 §5.2 起乾淨的伺服器 |
| ㋓ 真的開一場單機戰 | `ents 276 / heroes 5` ⇒ `_charSlots()` 交出 **4 格**、`allFinite` true、`CHAR.N = 4`、`_selfSpd` 有定義(= `_stepSelfWeights` 的閘門真的因為 `TREAD` 而跑了) | playwright 走大廳 UI 開單機戰,手推 30 幀後讀 `__SVS.battle._charSlots()` |
| ㋓ 速率真的來自 `loco.speed` | `max(slot.spd)` **恆等於** `max(ent.loco.speed)`(兩者同為 150.84) | 同上,推 20 幀逐輪比對 |
| ㋓ 幕(旋鈕 0) | `playWipe` 回 **false**、回呼**同步** +1、`_wipeA` 恆 **0** ⇒ pass 從不進鏈 | 直接建一顆 `Pipeline` 手推 `_tickWipe`,逐 tick 印 `w1/w2/flash/_wipeA` |
| ㋓ 幕(旋鈕 1) | cover:`w1` 0 → 0.185 → 0.543 → 0.869 → **1.000**,`flash` 同步 0 → **1.000**,回呼**恰一次**;reveal:`w2` 0 → 0.101 → … → **1.000**,結束 `_wipeA` 回 **0** | 同上 |
| ㋓ `audit_muzzle` / `audit_cockpit` / `audit_cast_jump` | 32/32・全數合規・32/32(㋔ game.js 相鄰) | `SVS_URL=http://localhost:8677` |

**未驗項(㋓/㋕,沙箱做不到)**

- **「草真的被撥開了嗎」** —— GLSL 在 Node 端執行不了,`?tread=0` 與預設的 `shot_scene` 前後
  對照(md5 逐位元 / 目視)沒有拍。`?tread=0` 的**逐位元中性**是結構論證(空陣列 ⇒ 全槽 0
  ⇒ 頂點端 `if (cSpd <= 0.0) continue;` 早退),不是量出來的。
- **幕在真的畫面上長什麼樣**(傾角 / 幕緣羽化 / flash 的強度)—— 只量到 uniform 的數值軌跡,
  沒有拍圖。三個時機的實際觀感(尤其陣亡那一次幕底下露出 HUD)MUST 真機看一次。
- **4 槽的實際幀成本**(逐頂點 4 次 `length()` + `smoothstep` 落在草 / 稻那幾列)沒有量。
- **㋕ 真機**:①掉幀時的 40 m 擾動泡泡(⑤-2)②旋鈕開著時陣亡 / 結算的 0.34 s 延後聽起來 /
  看起來可不可以接受。
