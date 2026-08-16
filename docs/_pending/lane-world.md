# lane-world 文件差異(交給整合者序列合併)

> 平行窗期間本道**沒有**動 `CLAUDE.md` / `.claude/rules/**` / `docs/anime_style_plan.md` /
> `public/js/.claude.md` / `tools/CLAUDE.md` 任何一個字(S13)。以下四段是整合者要寫回去的原文。
>
> **本檔目前只涵蓋第一階段:W0(基準落盤)+ W2(⑤-4 落花 / 落葉粒子)。**
> W1(山頭/巨石/石堆)、W3(水)、W4(載具)、W5(葉片卡)要吃 lane-ink 的 S3/S4/S6/S7/S9 契約,留在窗 2。

---

## ① `.claude/rules/seams-render.md` §2.1 F 要新增的那一列

| 領域 | 唯一縫 | 鐵律 / 稽核 |
|---|---|---|
| 落花 / 落葉粒子 | 規則 `petals.js`(`PETAL`/`petalSeason()`/`petalTones()`/`groupCrowns()`/`planPetalFields()`/`prewarmField()`/`stepPetal()`/`petalRnd()`)+ 接線 `biomes.js` 的 `foliageCrown()`/`petalGeo()`/`buildPetals()`;逐幀路徑 = 既有的 `dynamics` 桶;killswitch `?petal=0` | 2026-08-16(`docs/anime_style_plan.md` ⑤-4)。①**規則與幾何分家**:`petals.js` **零 THREE、零 DOM、只 import `rng.js`**(同 `edgewall.js`/`flags.js`/`wallpanel.js`)—— 粒子的狀態是一疊純量、運動是純函式 ⇒「兩個頻率不可通約嗎」「自轉軸真的逐粒不同嗎」「一小時之後這叢花還蓋在那叢樹上嗎」在 Node 端就量得到,這是本項唯一能離線驗的一半。②**落點只由最終的植被實例名冊 `items` 推導**,判據是既有欄位(`VEG_DEFS[type].parts` 有沒有 `key: 'foliage'`)—— 另開一張「哪幾種樹會落葉」的名單遲早與季節換色那一份分家(同 `SOFT_BY_VEG_KEY`);冠頂與冠幅只讀**保險絲** `p.g`(庫幾何載不載得到逐客戶端不同)。③**零共享 `rnd()` 消耗**:專屬 `petalRnd(gseed)` = `mulberry32(gseed ^ 0x5E7A1)`,逐粒**固定 11 枚**;場的分群與地貌閘零消耗且完全決定性(⇒「淘汰排在抽樣之後」恆真)。多抽一枚就把後面每一株植被與每一棟建物的佈局整條推移,而畫面上只表現成「整張圖變了」。④**色調 MUST 由 `ENV.seasons[季]` 的 `accent` 與 `foliage` 推導**(春 = 落花 / 秋 = 落葉 / 夏冬不下;第三色調的混色比逐模式不同 —— 粉混綠會變灰,那不是花);`accent` 在此之前沒有任何消費端。⑤**運動兩頻率**(慢波 = 這陣風、快顫 = 葉片自己在翻),比值 MUST 離每一個小分母有理數夠遠,而且 `SWAY_FAST × F_FAST > SWAY_SLOW × F_SLOW`(快顫要在**速度**上壓得過慢波,否則「兩頻率」只剩註解);自轉軸**逐粒球面均勻**(全部繞 +Y = 一地的硬幣);位置一律表達成「**場中心線 + 偏移**」⇒ 環繞是**構造保證**不是參數調得剛好。⑥**預跑步數推導不手寫**(最慢的那一片要走完整條高度帶;手寫 40 步在 20m 的帶上只走得了 9m ⇒ 首幀下半場是空的,而每一條斷言都會過)。⑦**A25**:單位四邊形整場**只有一份**且 `markShared` 註冊,逐色調各一顆 `InstancedMesh`(3 個 draw call、幾何不重配);`noOutline` + `depthWrite: false` + `castShadow = false` + `frustumCulled = false`;材質走 `envMat` 而非自寫 `ShaderMaterial`(後者要手動宣告 `INK_INFO_DECL`,而 `envMat` 連世界曲面與 `gInfo` 都免費繼承)。⑧**逐幀 dt 兩端都夾 `PETAL.DT_MAX`**,與 `toon.stepCelWind` 同值同理由(背景分頁切回來那一幀的 dt 是好幾秒 ⇒ 不夾就是整場落花瞬移到地面)。⑨**`?petal=0` = 整段不建立**(零 mesh、零 `dynamics` 條目);「建了但每幀不更新」不算 —— 那留著 draw call 與記憶體,對照組從此不是舊制。⑩逐幀步進 MUST 掛在既有 `dynamics` 桶(`group.userData.update` → `terrain.biomesUpdate` → game.js),**MUST NOT** 在 game.js 另開第二條迴圈(`climb.js` 檔頭已把規則寫死);`game.js` 全檔不得認得落花。⚠ 半透明落花會把場景 RT 的 alpha 推離 1(A39 的勾線門檻契約)⇒ 它蓋住的像素上背後建物邊的線會**變細**;量級極小且與「落花是軟性物質」自洽,但看到幾根線變細時 MUST NOT 回頭去改勾線參數。稽核 `audit_ambient_motion` ±`--break-tone`/`--break-petal`/`--break-spin`/`--break-wrap`/`--break-prewarm`/`--break-rnd`/`--break-shared`/`--break-off` |

**同一段要順手修訂的既有敘述**:`seams-render.md`「軟性物質」那一列 ⑦ 講的「雲的漂移吃同一支 `celWindTime()`」不必動 —— ⑤-5 本輪零工作(見第 ④ 段的計畫更正)。

---

## ② `.claude/rules/verification.md`

### §5.1(續)離線稽核清單要新增的一行

```bash
node tools/audit_ambient_motion.mjs   # 環境動態(落花 / 落葉粒子:季節閘 / 色調推導 / 分群 / 兩頻率 / 自轉軸 / 沿中心線環繞 / 預跑 / 亂數帳 / 接線契約)
#   ±--break-tone/--break-petal/--break-spin/--break-wrap/--break-prewarm/--break-rnd/--break-shared/--break-off
```

### §5.5 要新增的對照列

| 改動 | 驗證 |
|---|---|
| **落花 / 落葉粒子**(`public/js/petals.js` 全檔 / `biomes.js` 的 `foliageCrown`·`petalGeo`·`PETAL_OFF`·`buildPetals` 與 `dynamics` 之後那一段接線 / `ENV.seasons[].accent` 的消費) | `audit_ambient_motion` ±**八支** `--break-*`(每一支 MUST 對應紅字)+ **`audit_siteplan` / `audit_beacons` / `audit_object_joints --seeds 8` / `audit_ground_tile` / `ground_qc` / `ground_seam` / `ground_enclave` / `ground_border` / `audit_world_edge` 逐項不變** —— 這九支是「**零共享 `rnd()` 消耗**」的唯一證明面,而**判準是「逐項不變」不是「仍全綠」**(它們驗規則不驗位置;序列被推移時全部照樣綠)+ `audit_soft_stroke` / `audit_cel_pipeline` / `audit_gpu_lifecycle` / `audit_visual_prefs` / `audit_world_curve` 逐項不變(材質走 `envMat` ⇒ 勾線 alpha 契約與 `gInfo` 宣告都是繼承來的,一格都不該動)+ `audit_client_syntax`(㋖;名冊多一支 `petals.js` ⇒ 項數 +2)+ `npm run audit:net` / `audit_solo_boot`(新增客戶端模組:URL 佈局鏡射 + `data.js` 單一模組實例)+ **`npm run bal` / `npm test` MUST 逐項不動**(`data.js`/`sim.js`/`server/**` 一行未改;`ENV.seasons[].accent` 只被讀取)+ **㋓ `shot_scene --venue taroko` 的春 / 秋 / 夏各一張**(「像不像在飄」與三色調的實際觀感只有實拍看得到;離線只量得到軌跡的統計量)+ **㋓ 幀成本**(逐幀 `setMatrixAt` + `instanceMatrix` 上傳量;`RES_GOV` 只調解析度、調不掉它 —— 現有雨雪粒子 1600/1100 顆逐幀寫 position 是可比較的基準)+ **㋕ 真機**(低功耗階梯 `MAX_TOTAL_LOW` / `MAX_FIELDS_LOW` 的實際數字 MUST 在真機量過再定值)。⚠ 改 `PETAL.CELL_M` / `MIN_CROWNS` / `DENSITY` MUST 回頭看 `audit_ambient_motion` Ⅲ・Ⅳ 的測試場還咬不咬得到上限(叢數不足時「場數夾在 MAX_FIELDS」與低功耗階梯兩條是恆真的)|

---

## ③ 根 `CLAUDE.md` §2.1 目錄要加的主題名

`seams-render.md`(§2.1 F)那一列的主題清單尾端追加:

> …・**幀率無關阻尼**・**落花 / 落葉粒子**・共用視覺入口

(§2.1 的鐵律:「查不到主題時 `grep -rn` …**MUST NOT 因為目錄裡沒看到就認定沒有規則**」——
所以目錄裡一定要有這四個字,不然下一個人會以為落花沒有規則。)

---

## ④ `docs/anime_style_plan.md` 執行紀錄那一列 + 對計畫的更正

### 執行紀錄

> **2026-08-16 第二輪 · lane-world 第一階段**|⑤-4 落花 / 落葉粒子落地(新增 `public/js/petals.js` 零 THREE 規則層 + `biomes.js` 接線 + 新稽核 `tools/audit_ambient_motion.mjs` 63 項 / 8 支反向驗證全部咬得住)。⑤-5 雲層飄移**本輪零工作**(見下方更正)。逐位元證明面:`npm run bal` 與改制前**逐位元相同**、`npm test` 624 ✅ 逐項相同;`audit_object_joints --seeds 8`(21611 個接合、異常 0)/ `siteplan` / `beacons` / `ground_*` / `world_edge` / `soft_stroke` / `cel_pipeline` / `gpu_lifecycle` / `visual_prefs` / `world_curve` 共 13 支在**隔離對照**(HEAD vs HEAD + 本道兩支檔案)下輸出**逐位元相同** = 零共享 `rnd()` 消耗成立。未驗:全部 ㋓/㋕ 項(見交付說明)。

### 對計畫的更正(計畫對現況的描述已過期 / 查無)

1. **⑤-5 雲層飄移已經完成,本輪零工作。** 證據兩行:`environment.js:222` 的環繞取模**已經**先加半個 `WRAP` 再減(`((d.along + WIND.CLOUD_MPS * t + WRAP * 0.5) % WRAP + WRAP) % WRAP - WRAP * 0.5`)、`environment.js:505` 的 `clouds.step(celWindTime())` **已經**吃全場同一支風時鐘。SKILL L4 的其餘四條也都在:`depthWrite:false, fog:false`(:194)、`renderOrder = -9`(:214)、雙層 billboard(`mats[i & 1]`,opacity 0.9 / 0.55)、`frustumCulled = false`(:213)。而且 `audit_soft_stroke` Ⅴ 已有四條行為直測在守(不自己數 dt / 值域 / 無跳點 / 一個週期後逐位元回起點)。⇒ 執行順序表那一格改成「已完成(2026-08-13 隨海浪那一輪落地)」,本輪**一行都沒有動 `environment.js`**。
2. **落花的預跑「40 步 × 0.1s」改成「步長 0.1s、步數推導」。** 計畫寫的是固定 40 步 = 4 秒;本專案的落葉樹冠帶高 10~20m、落速 0.45~0.95 m/s ⇒ 4 秒只走得了 1.8~3.8m,首幀下半場是空的(開場會看到一批花同時從樹冠開始掉),而每一條既有斷言都會過。落地版把步長留在 0.1s(計畫的粒度),步數改由「最慢的那一片走完 `PREWARM_TURNS` 趟自己的高度帶」推導 —— 這是「推導值 MUST NOT 手寫」的直接套用,不是對計畫的否定。
3. **落花走 CPU 步進而不是 GLSL,是被既有稽核的形狀逼出來的**(不是效能取捨)。`audit_soft_stroke` Ⅲ 的 sway 正規式 `#ifdef CEL_SWAY\n([\s\S]*?)#endif\n\s*#include <project_vertex>` 是非貪婪但會一路吃過 `CEL_WAVE` 區塊 ⇒ 捕獲段的 `count(S, /sin\(/g) === 2` 是**全域計數**:在頂點著色器裡為落花加第三個 `sin(` 會讓那一條紅,而紅字的理由(「兩個不可通約的正弦」)與落花完全無關。CPU 這條路同時換到了「規則層可以離線真的執行」,本項絕大多數斷言因此是行為直測而不是原文比對。
4. **本專案的 `VEG_DEFS` 沒有櫻花樹種**(闊葉 / 白樺 / 五種針葉 / 灌木 / 紅樹林 / 幼樹 / 竹 …)⇒「落花」在這個世界裡沒有對應的來源幾何,色調只能由既有的 `ENV.seasons[].accent` 推導。實得的落葉名冊(由 `key: 'foliage'` **推導**,零手寫):`bamboo / broadleaf / birch / shrub / mangrove / sapling`;五種針葉、枯立木、芒草 / 箭竹 / 蘆葦 / 多肉、四種菇、邊界岩自動排除。要不要真的加一款開花樹種是**內容決定**,見第 ⑤ 段。

---

## ⑤ 待裁決(MUST NOT 由 commit 定案)

1. **要不要真的加一款開花樹種。** 現況:春天的「落花」是用 `ENV.seasons.spring.accent`(粉)染色的粒子,而場上沒有任何一棵開花的樹 —— 讀起來會是「粉色的東西從綠樹上飄下來」。三條路:①維持現況(最省,而且日系背景本來就常只有花瓣沒有花樹在鏡頭裡)②在 `VEG_DEFS` 加一款開花闊葉(= 新增世界內容 ⇒ 要回答 §2.3 的 `rnd()` 帳,而且會動到植被的散佈序列 ⇒ 全批 `ground_*`/`siteplan`/`object_joints` 基準要重取)③春天也改下「落葉」語意(只換色調權重)。**本輪按 ① 落地。**
2. **`?petal=0` 要不要升級成設定頁旋鈕。** 落花是本輪唯一會增加**逐幀 CPU 成本**的一項(逐粒 `Math.sin` ×2 + 一顆四元數 + 一個 Matrix4 compose,現值上限 1200 顆),與 `dof`/`shadow` 同類 ⇒ 做成 `visualPrefs` 旋鈕有理由。但 `VISUAL_KNOBS` 由 lane-ink 單一擁有(S10),本輪**沒有**往那張表塞任何一列;現況走 URL killswitch(同 `?sag=0`/`?morph=0`/`?gait=0`/`?cockanim=0`)。若使用者要旋鈕,依 `visualPrefs` 紀律① 它的 `def` 應該是**交付定案值 = 開**(不是 0),而那會連帶動到 `audit_visual_prefs` Ⅰ 與設定頁版型。
3. **粒子密度與尺寸的美術值。** `PETAL.SIZE`(花 0.22m / 葉 0.34m)與 `DENSITY`(1/60 m⁻²)、`MAX_TOTAL`(1200 / 低功耗 480)都是**授權值不是量測值** —— 真實花瓣 2~4cm 在這個尺度上是看不見的一個像素,日系背景一律誇張。校準面是定裝照(㋓)與真機幀成本(㋕),兩者本輪沙箱都跑不動。總量對齊既有雨雪粒子(1600/1100 顆逐幀寫 position)那一個量級當起點。
4. **低功耗階梯的實際數字。** `MAX_FIELDS_LOW = 3` / `MAX_TOTAL_LOW = 480` 是照「約全量的四成」訂的起手值,**MUST 在真機量過再定案**(㋕)。`RES_GOV` 只調解析度、調不掉逐幀的 `instanceMatrix` 上傳。
