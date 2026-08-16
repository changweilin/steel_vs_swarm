# lane-ink 第二階段(窗 2)—— 文件差異與凍結契約

> 2026-08-16。平行窗期間沒有任何一道寫 `CLAUDE.md` / `.claude/rules/**` /
> `docs/anime_style_plan.md` / `public/js/.claude.md` / `tools/CLAUDE.md`,
> 本道把文件差異寫在這裡,由整合者最後序列合併。
>
> 本階段交付:**I4 = 序 4(①-2 / ①-3 / ①-4 / ①-5)** + **seq8 = 序 8(④-1 / ④-2 / ④-3)**。
> 新增/修改的契約已同步補進 `docs/_pending/lane-ink.md` 第 ⑥ 段(S12~S17),窗 3 照那一段接線。

擁有並改動的檔案:`public/js/toon.js`・`public/js/postfx.js`・`public/js/data.js`・
`public/js/cutin.js`・`tools/audit_cel_pipeline.mjs`・`tools/audit_visual_prefs.mjs`・
`tools/audit_soft_stroke.mjs`
(`public/js/visualPrefs.js` 本輪**一個字都沒改** —— 九格旋鈕窗 1 已經加完,本輪只是把
`inkBreak` / `landInk` / `wipe` 三格接上消費端;`tools/audit_gpu_lifecycle.mjs` 未改,
它自動吃到推導式的 dispose 名冊)

---

## ① `.claude/rules/seams-*.md` 要新增 / 修訂的那一列(原文)

### 修訂:`seams-render.md` §2.1 F 的「軟性物質(細勾線 + 隨風飄揚)」那一列的 ② 條

> 把該列的 ② 條整段換掉(其餘八條一格不動):

②細勾線的通道 = **場景 RT 的 alpha**,而它自 2026-08-16(序 4 ①-2)起帶的是
**兩個因子的乘積**:`alpha ≡ 軟性(這是什麼材質,逐材質常數)× 雜訊斷筆(這一格的筆抬起來了沒有,
逐 fragment)`。**寫入點仍然恰一處**(`#ifdef CEL_INKA` 那一行)—— 兩個因子分兩處寫就是兩份契約,
而分家的症狀是「斷筆只作用在軟性件上」。契約(倍率乘進 `smoothstep` 的**輸入**、取「這一格 + 四鄰」
**最小值**、排在早退之後)一字未改,`postfx.js` **一行都不用改**:讀取端天生就把新因子吃進去,
而且深度那一支訊號(`ae * soft`)與折邊那一支(`mrtEdge * soft`)**同時**變細 = 真的像筆抬起來,
不是只有其中一種線斷掉。閘由 `CEL_SOFT` 放寬成 `CEL_INKA`(= 不透明的 cel 材質,前者的**超集**),
兩者 MUST 吃**同一句** `!mat.transparent`。

### 新增:`seams-render.md` §2.1 F「勾線的雜訊斷筆」

| 勾線的雜訊斷筆 | `toon.js INK_BREAK`(`SPAN_ENV`/`SPAN_MECH`/`CUT`/`LO`)+ 共享 uniform `_inkBreakA` + GLSL `celInkBreak()` + varying `vCelInkP`(`CEL_INKB`)+ 寫入端 `CEL_INKA`;軌 = 既有的 `tint` 參數;旋鈕 `visualPrefs` 的 `inkBreak`(**def 0**) | 「像筆抬起來」= 沿著線隨機把**門檻倍率**壓低一段,騎的正是軟性物質那條 alpha 契約(見上一列)⇒ `postfx.js` 一行不改。八條:①**軌沿用既有的 `tint` 軸**(`toonMat` 恆 'mech' / `envMat` 恆 'env',= `_rampTint` 那條已存在的軸),**MUST NOT 另建「哪些材質算機體」的名冊**(名冊會在加零件時靜默過期);兩軌分開的理由是尺度差兩個量級(機體全高 4.5~9m 的一筆畫要有十來個週期,而地形的一筆畫跨數十公尺)。②**錨點 MUST 是 `mat3( modelMatrix )` 不是 `modelMatrix`** —— 丟掉平移那一欄就是「走一步缺口不在身上游動」的全部理由(等價於 `CEL_PAINT` 那句 never makes the pattern swim);轉動仍跟著跑 ⇒ 缺口黏在裝甲板上。寫成 `mat4` 之後畫面上只是「線在閃」,而**每一條離線斷言照樣全綠**。③`instanceMatrix` 收進來(同款植被逐株不同花紋;對靜態實例它退化成世界座標),地形的 `modelMatrix ≈ 單位陣` ⇒ 同一條式子對地形自動是世界空間,**不需要第二份**。④雜訊 MUST 用**同一支** `celNoise`(2026-08-16 由 `#ifdef CEL_WP` 之下提出來,全專案恰一份)—— 兩份 hash 就是「地形的斷點與機體的斷點是兩種花紋」而沒有錯誤訊息;代價是沒有 `CEL_WP` 的材質多編一支會被編譯器剝掉的死函式,「沒標軟性的程式碼一行都不多」那條精神條款在這裡刻意讓步。⑤**兩個平面各取一次**雜訊(只取 `p.xz` 的話垂直裝甲板上整條線同相 = 沒有斷點)。⑥拉桿 0 ⇒ **uniform 分支早退**且回傳**字面 1.0**(不是 `mix` 出來的 1.0 —— 浮點上兩者可以不同);`LO` 取非 0(現值 0.12)= 「筆壓變輕」不是「線不見」,同 `INK_SOFT_A` 那條先例。⑦`CEL_INKA`/`CEL_INKB` MUST 進 `customProgramCacheKey`(`B`)—— 漏掉的話半透明件拿到寫死 alpha 的那一版 = 水面從 0.82 變 0.30。⑧`_inkBreakA` 的宣告 MUST 排在 `syncVisualPrefs` **之前**(它在模組載入時就跑一次 ⇒ 晚一步就是整支 toon.js 在 import 當下 TDZ ReferenceError,而錯誤訊息指向完全無關的地方)。⚠ **三件離線量不到的事**(定裝照才驗得到,已寫在 `INK_BREAK` 旁邊):勾線 pass 取 `min(五格)` ⇒ 缺口被侵蝕一圈約 2px;世界空間錨定 ⇒ 一個週期的螢幕像素數 ∝ 1/距離,遠處退化成亞像素雜訊;8bit RT 上軟性件的斷處(`0.3 × 0.12` ≈ 9/255)實質等於沒有線。稽核 `audit_soft_stroke` Ⅺ ±`--break-inkbreak`/`--break-inkanchor` |

### 新增:`seams-render.md` §2.1 F「掠射抑制項恰一項(深度門檻)」

| 掠射抑制項恰一項 | `postfx.js INK.K_S`(勾線 pass 的 `e = lap / max(0.001, d·K_D + slope·K_S)`) | 2026-08-16 定案(計畫 ①-4「深度門檻吃中心法線 z…**兩者擇一,MUST NOT 疊**」):**維持 `K_S`,不換成 `1 − n.z`**。掠射抑制項在那條分母裡 MUST **恰出現一項**,而且原文 MUST NOT 出現 `n.z` / `nz` / `depthLimit` / `uDepthRange`。量測(解析平面模型,fovY 68°、1080p、門檻倍率相對正對鏡頭的牆):K_S 版 正對 1.00 / 45° 1.37 / 20° 2.03 / 10° 3.13 / 5° 5.28 / 2° **11.73**;而 `1 + K_N·(1 − n.z)` 的上界**恆為** `1 + K_N` ⇒ 配到 2° 相等要 `K_N = 11.1`,那時 45° 斜面被推到 3.09 倍過度抑制(屋頂 / 山坡 / 斜坡道的線整批消失);配到 10° 相等則仰角 2° 只剩 0.30 倍(近地平線的地面回到「畫滿等高線」)⇒ **兩條曲線在任何單一係數下都配不起來**。另外三條:(a) `1 − n.z` **只有 `inkMrt` 開著才拿得到法線**,而它預設關、WebGL1 上根本沒有 ⇒ 換過去等於預設組態失去全部掠射抑制;(b) 哨兵像素(天空穹頂 / 護盾殼 / 粒子 / 招牌)沒有法線 ⇒ 要第二份門檻 = 第二份實作(原則 2);(c) 低解析度時 K_S 版的 `e` 會**飽和**(lap 與 slope 同階,比值有上界),`1 − n.z` 版對像素尺寸是線性沒有上界 ⇒ 手機降階時地形折邊會變強。稽核 `audit_soft_stroke` Ⅺ ±`--break-graze`(壞版 = 把 `+ ( 1.0 - nz )` 疊進那條分母) |

### 新增:`seams-render.md` §2.1 F「地貌分區墨線(surfaceId 子帶)」

| 地貌分區墨線 | `toon.js LAND_ZONE_N`/`landZoneId(i)` + `applyCelPatch` 的 `landId`(define `CEL_LAND_ID`)+ 逐頂點屬性 `aLandId` → varying `vLandId` → `gInfo.b` + 共享 uniform `_landInkA`;旋鈕 `visualPrefs` 的 `landInk`(**def 0**);群組早退的 LAND 例外住 `postfx.js` | 計畫 ①-3「同一塊地形上草↔岩要**出線**」= 把地貌分區折進 surfaceId(`LAND_SURF_ID` 是它的反面)。⚠ **這一條與兩條有日期的使用者定案正面相反**(2026-08-13「不要看出地貌拼圖接縫」、2026-08-11「兩側若是相同地貌則不需要分界線」),而且現制的 zone 換手發生在**逐格投票邊界與 `CARPET_LOT` 量化格**上、**不在真實地貌界線上** ⇒ 打開它今天就是把剛藏起來的拼圖接縫用黑線重新描一次;故落地成**完整實作 + 旋鈕 def 0**,要不要打開是使用者的決定(見 ⑤-3)。六條:①子帶 MUST 落在**整數格 `k/64`**(與 `surfGroup` 同一把梳子),**MUST NOT** 用計畫字面的 `+= grassMask * 0.1` —— 0.1 / 0.15 落在現役槽 0.1015625 / 0.1484375 的 `INK_MRT.ID` 0.004 門檻之內 ⇒ 那兩種地貌對建物的線**靜默消失**;半整數格是 `nextSurfId` 的值域,同樣不准。②由**頂端往下配**(63, 62, …)而 `surfGroup` 由 2 往上配 ⇒ 一場戰鬥配不到 56 個群組就不會碰面;真的碰面也只是既有那條「撞號 = 少一條線,不是壞掉」。③**群組早退是那條的唯一例外**(它會讓整株樹的剪影整個消失而不是少一條線)⇒ `postfx.js` 的早退追加「五格都不是 LAND」這道閘,今天**恆真**(地貌恆 0、群組號 k ≥ 2 ⇒ `same` 本來就是 0)⇒ 逐位元中性。④**兩道閘**(拉桿 > 0 **且** 屬性存在)才換號 ⇒ 拉桿 0 或呼叫端還沒接上 ⇒ 恆等於 `LAND_SURF_ID`。⑤閘是**共享 uniform** 不是 define(紀律③:改值 MUST NOT 重建材質),而 `CEL_LAND_ID` 本身是 define ⇒ MUST 進 `customProgramCacheKey`(`Z`)。⑥載體 MUST 是**逐頂點屬性**:底毯是逐 `sub#variant` 分桶的獨立材質,把分區併進分桶鍵會讓 scree / steppe / concrete 這些跨分區的款分裂成多桶(= 多 draw call),逐頂點**零額外 draw call**;`landId` **只給 `envMat`**(與 `land` / `landNrm` 同一族,`toonMat` 一路都不該吃)。稽核 `audit_cel_pipeline` Ⅸ ±`--break-landink` |

### 新增:`seams-render.md` §2.1 F「畫面轉場(斜向 wipe)」

| 畫面轉場(斜向 wipe)| 形狀與時間軸 `data.js WIPE` + `wipeAt(mode, t)`(純函式,離線可驗)/ pass `postfx.js _wipeMaterial()` + **唯一寫入點** `setWipe(a, b, opts)` + 驅動 `playWipe(mode, onCut, opts)`/`_tickWipe()` / 消費端 `cutin.js` 的 `setPipeline()`·`wipe()`;旋鈕 `visualPrefs` 的 `wipe`(**def 0**)| 十條:①**pass MUST 排在 grade 之後、fxaa 之前**(四條理由缺一不可:FXAA 兼任線性→sRGB MUST 留鏈尾;幕的斜邊是硬邊,擺在 FXAA 之前才有抗鋸齒;幕 MUST 蓋在**調過色的**畫面上,否則美術挑的顏色不是畫出來的顏色;flash 與 grade 同層而排在它之後)。②閘門形狀 MUST **逐字鏡射 dof 那一列** —— 0 ⇒ **整個 pass 退出鏈**,不是跑一個乘 0 的 pass。③**不新增 RenderTarget**(鏈變成 5 步仍在 rtA/rtB 之間乒乓)。④幕是**兩支獨立的 0→1 uniform**(覆蓋區間 = `[w2, w1]`;遮幕推前緣、揭幕推後緣)—— 一支的話「幕走到一半停住」做不到。⑤兩個端點各**外推一個羽化寬** ⇒ `w=1` 真的整片蓋滿、`w=0` 真的一格都沒蓋(不外推的話遠角只蓋到一半,而 `wipeAt` 那一端的 `p ≥ 1` 保證就白給了)。⑥flash 是 **vibrance / brightnessContrast** 不是白色淡入(白幕會把整格畫面洗掉),對比樞軸 MUST 是 `WIPE.PIVOT` = **0.18 線性中灰**,與 `GRADE` 的 `smoothstep(0.18, 0.72, l)` 同一把尺 —— 寫 0.5 會把整個畫面壓黑,而畫面上只表現成「閃光怎麼是暗的」。⑦**回呼由幀迴圈觸發,MUST NOT 用 `setTimeout`**(離場 / 重賽會在幕播到一半發生,計時器留下來就是下一場冒出上一場的畫面;`dialogue.js` 檔頭紀律②的同一條);`render()` 沒有 dt ⇒ 管線自己記時鐘,而那個 dt MUST **夾住**(背景分頁回來的那一幀是幾十秒)。⑧旋鈕關著時 `playWipe` MUST **當場同步**走回呼並回 false ⇒ 連時序都逐位元同舊制,呼叫端不必自己判。⑨**幕色由呼叫端餵**(`SIDES[side].color`),MUST NOT 住 `WIPE` —— 那會變成與 `toon.js OUTLINE_COLOR` 並存的第二份墨色。⑩幕只蓋 **3D 主畫面**(PiP / 小地圖 / 陣亡鏡頭 / 所有 DOM HUD 都畫在 `pipeline.render()` 之後);這是可接受的取捨,但 MUST NOT 用「再寫一份 DOM 幕」補完 —— 那是同一個轉場的第二份實作,傾角與時間曲線遲早分家。⚠ wipe 材質**不讀 `tInfo`** ⇒ MUST NOT 進 `_syncMrt` 的重建清單;日後若讓它讀類別碼,MUST 同時進去,否則切折邊勾線開關之後轉場會靜靜地失效。稽核 `audit_visual_prefs` Ⅷ ±`--break-wipe` |

### 新增:`seams-render.md` §2.1 F「物件出現(dissolve discard)」

| 物件出現(dissolve)| `data.js DISSOLVE`(`IN_S`/`CELL_M`/`FAR_M`/`FAR_BAND_M`)+ `dissolveAt(t)` / 材質面 `toon.js applyCelPatch` 的 `dissolve`(define `CEL_DIS` + `mat.userData.celDisU` + varying `vDisP` + `celDissolve()` 的 `discard`)+ **唯一寫入點** `setDissolve(target, k, origin)` | 賽璐璐件用 **alpha 淡入會失去自己的輪廓**(而輪廓是這個畫風的全部)⇒ 走 `discard` 抖動。八條:①`discard` 錨 MUST 排在 `#include <opaque_fragment>` **之前**(現取 `clipping_planes_fragment` = `void main()` 之後的第一個錨點)—— 排它之後就是顏色與 `gInfo` 都寫完了才丟,而洞邊的資訊仍然是機體的。②**`discard` 掉的片元連 `gInfo` 都不寫** ⇒ 洞邊留下的是它**背後那個東西**的資訊:背景是天空時哨兵成立(不多線),背景是地形/建物時洞邊出現 `LAND↔機體` 的 id 差 ⇒ **那正是「溶入中的機體不失去輪廓」**。它**不是免費的**:洞的螢幕尺寸太小時整台會被墨點蓋掉 ⇒ 抖動格距 MUST 以**世界公尺**給(不是 texel),而這一條只有定裝照看得出來。③`uDis` 的 uniform 物件 MUST 住 `mat.userData`(同 `_windT`/`_rampTint`)—— 在 `onBeforeCompile` 裡 `{ value: 1 }` 新建的話,材質一重編譯就換一顆而驅動端抓著舊的 ⇒ 「有時候不會溶入」。④`CEL_DIS` MUST 進 `customProgramCacheKey`(`D`);⑤抖動網格錨在**單位自己的世界原點**(`uDisO`)—— 拿純世界座標的話機體會從一張固定的網格裡「游」過去(與 ①-2 的斷筆錨點同一條理由)。⑥**反轉外殼 MUST NOT 加 define**:全專案每一片外殼共用 `'celOutline'` 一把快取鍵,加了鍵不變 = three 發錯程式(不報錯)⇒ 溶入期間**整片收起**(`userData.isOutline`),結束復原;代價是結束那一幀線寬會跳一下,升級路徑是逐單位的 `'celOutlineD'` 鍵變體。⑦這條規則住 `setDissolve` 這唯一寫入點,呼叫端 MUST NOT 自己去戳 `userData`。⑧**範圍只有「出現」那一半**:「消失」要把 mesh 從 `this.ents` 摘出來丟進 ghost 清單,而它有 20 個以上的消費端(含準星解算與鎖定)⇒ 延後移除 = 客戶端把準星解到一個伺服器已經沒有的目標上。遠距剔除那一半留了縫但 `FAR_M = 0` ⇒ **那一段根本不編進著色器**(結構保證不是 runtime 分支),而曲線只有 GLSL 那一份(JS 端再寫一支同樣的 smoothstep = 兩份會分家的實作)。稽核 `audit_cel_pipeline` Ⅸ ±`--break-dissolve` |

### 新增:`seams-render.md` §2.1 F「霧範圍 ≡ 勾線淡出」

| 霧範圍 ≡ 勾線淡出 | `postfx.js INK.FADE_F`(= `FADE0 / FADE1`,**推導**)+ `_inkFadeM()`(**恰一份**)+ 勾線 pass 的 `uFade0`/`uFade1`;錨 = `scene.fog`,地板 = `combatReachM() / FADE_F` | 舊制錨在 **`camera.far`**(= 地圖邊長 × 2),而 `data.js DOF` 檔頭那句「錨也 MUST NOT 取相機 far 平面:那隨隊制變」是同一條規則 —— 勾線淡出是**唯一還沒照做的**那一個。實測(`camera.far = span × 2` ⇒ 舊制淡出帶恆為 `[1.10, 1.90] × span`;霧的遠端 clear 1.9 / cloudy 1.6 / rain 1.0 / snow 1.1 / fog 0.35 × span):**只有 `clear` 對得上**(1.90 ≡ 0.95 × 2 —— 這就是這兩個常數當初是在晴天定場照上調出來的證據),而 `rain`/`snow`/`fog` **連淡出的起點都排在霧飽和之後** ⇒ 線整段畫在已經全白的霧色上,那正是「背景在中距離變成線框」。五條:①推導**恰一份**(`_inkFadeM`),著色器裡 MUST NOT 再出現 `uFar × FADE*`;②錨 = `scene.fog`(那是 `setAirFog` 已經要求「與 `scene.fog` 逐位元相同」的同一個物件 ⇒ 不開第二個寫入點);③**地板 `combatReachM() / FADE_F`** 讓「打得到的東西恆有線」變成結構保證,與 DOF Ⅵ-b「打得到的東西恆為全清晰」逐條對稱 —— 沒有它,迷你地圖 + 霧天(span 480 × 0.35 = 168m)會讓 `fadeStart` 落在交戰上界 304m 裡面,甚至 `fade0 > fade1`(smoothstep 端點反轉);④`scene.fog` 缺席(樣品 / `shot_veg` 那類無霧場景)MUST **退回舊式**(原則 6)—— 直接讀 `fog.far` 會拿到 `undefined` ⇒ `smoothstep(NaN, NaN, d)` ⇒ **整片沒有線**,而每一條離線斷言都會過(它們讀的是原文不是執行結果);⑤`FADE_F` 是**推導**,MUST NOT 手寫 0.578…。**`clear` 天氣在實數上恆等舊制**,其餘四種是**設計上的行為改變**(線從此跟著霧收)。稽核 `audit_cel_pipeline` Ⅹ ±`--break-fade` |

### 修訂:`seams-render.md` §2.1 F「後製管線」那一列

> 把該列的括號內鏈序與 ② 條各補一句:

鏈序改成「勾線 → 景深 → 調色 → **轉場** → FXAA」(轉場那一 pass 的四條理由見上方「畫面轉場」那一列)。
② A25 的名冊改成:3 RT + depthTexture + **`_quads` 那張表上的每一支** `FullScreenQuad` 材質
(現役 5 支)MUST 全部 dispose,而**名冊 MUST 由 `_quads` 推導不手寫** —— 手寫的那一份會在加 pass 時
靜默過期,而漏掉一支的症狀是每開一場漏一支 shader program,`audit_gpu_lifecycle` ⑦ 照樣全綠
(它量的是「有沒有這一行」不是「數量對不對」)。

### 修訂:`seams-render.md` §2.1 F「3D LUT 調色」那一列(補一句)

> 在該列末尾補:①「LUT **取代** split-tone 而不是疊上去」自 2026-08-16 起有斷言守著
> (`audit_visual_prefs` Ⅶ ±`--break-lutstack`):`vec3 pre = c;` MUST 排在 split-tone **之前**、
> LUT MUST 查 `lutApply( pre )`(`void main()` 內 MUST NOT 出現 `lutApply( c )`)、合成 MUST 是
> `mix(c, lc, uLutA)`、`uLutA` 在 main 內恰兩處、整段收在 `if ( uLutA > 0.0 )` 之下。
> ②`makeGradeLut` 與 shader 的 `smoothstep` **兩對邊界逐位元相同**這件事(檔頭早就宣稱、
> 卻一條斷言都沒有)同輪釘住 —— 分家的症狀是「切到內建(程序生成)之後畫面微妙地不一樣」,
> 而那正是它「與現況等價的起點」這個用途被否定。

---

## ② `verification.md` 要加的指令與對照列

### §5.1(續)離線稽核清單 —— 補 `--break-*`

```bash
node tools/audit_cel_pipeline.mjs    # 賽璐璐管線(… / **溶入的材質契約 / 地貌分區子帶 / 霧 ≡ 勾線淡出**)
#   ±--break-dissolve(discard 錨點挪到 opaque_fragment 之後 + 快取鍵拿掉 D ⇒ Ⅸ MUST 紅 2 條)
#   ±--break-landink(子帶改用計畫字面的 `* 0.1` + 拿掉拉桿閘 ⇒ Ⅸ MUST 紅 3 條)
#   ±--break-fade(淡出錨回相機 far 平面 ⇒ Ⅹ MUST 紅 3 條)
node tools/audit_soft_stroke.mjs     # 軟性物質 + … + **墨線斷筆 + 掠射抑制項恰一項**
#   ±--break-inkbreak(alpha 寫入點退回 `= uSoftInk;` ⇒ Ⅱ + Ⅺ MUST 紅 2 條)
#   ±--break-inkanchor(斷筆錨點帶回平移欄 mat3 → mat4 ⇒ Ⅺ MUST 紅)
#   ±--break-graze(深度門檻再疊一項 `+ ( 1.0 - nz )` ⇒ Ⅺ「兩者擇一」MUST 紅)
node tools/audit_visual_prefs.mjs    # 畫面旋鈕 / … / **3D LUT 取代不疊加 / 斜向轉場**
#   ±--break-lutstack(LUT 改查已經被 split-tone 動過的顏色 ⇒ Ⅶ MUST 紅)
#   ±--break-wipe(閘門退成無條件 + 幕的端點不再外推 ⇒ Ⅷ MUST 紅 2 條,而 Ⅷ-b 順序 MUST 仍綠)
```

### §5.5 對照表 —— 新增一列

| 改動 | 驗證 |
|---|---|
| **墨線斷筆 / 掠射抑制項 / 地貌分區子帶 / LUT 取代不疊加 / 斜向轉場 / 溶入 / 勾線淡出錨**(`toon.js` 的 `INK_BREAK`·`_inkBreakA`·`celInkBreak`·`vCelInkP`·`CEL_INKA`/`CEL_INKB`·`LAND_ZONE_N`·`landZoneId`·`CEL_LAND_ID`·`_landInkA`·`CEL_DIS`·`celDissolve`·`setDissolve`·`celHash`/`celNoise` 的提出 / `postfx.js` 的 `INK.FADE_F`·`_inkFadeM`·`uFade0`/`uFade1`·`_wipeMaterial`·`setWipe`·`playWipe`·`_tickWipe`·chain 插點·`_quads` 推導式 dispose·群組早退的 LAND 例外 / `data.js` 的 `WIPE`·`wipeAt`·`DISSOLVE`·`dissolveAt` / `cutin.js` 的 `setPipeline`·`wipe`)| `audit_soft_stroke` ±**三支**新 `--break`(每一支 MUST 對應紅字)且**八支既有 `--break` MUST 仍各自咬得住** —— 本輪動過 Ⅱ 的三條既有斷言,而那一段正是「軟性契約斷掉」的唯一防線,三條的**語意**(恰一處寫入 / 非軟性件恆寫 1 / 只給不透明件)MUST 逐條保住 + `audit_cel_pipeline` ±**三支**新 `--break` 且**九支既有 MUST 仍咬得住** + `audit_visual_prefs` ±**兩支**新 `--break` + `audit_gpu_lifecycle`(dispose 名冊改推導,既有斷言 MUST 逐項不動)+ `audit_client_syntax` ±`--break-glsl`(㋖;**GLSL 註解裡的反引號**本輪又踩了兩次 —— toon.js 的頂點區塊與 postfx.js 的 wipe 材質各一次)+ `npm run audit:net` / `audit_solo_boot`(`postfx.js` 多一條 `data.js` import、`cutin.js` 多一支選用消費端)+ `audit_damp_fps` / `audit_touch_gesture` / `audit_view_lock` / `audit_spectator_cam` / `audit_recoil_move` / `audit_world_curve` / `audit_daynight`(既有斷言 MUST 逐項不動)+ ground / siteplan / beacons / `audit_object_joints --seeds 8`(**零共享 `rnd()` 消耗** ⇒ MUST **逐位元不變**,判準是輸出逐字元相同不是「仍全綠」)+ **`npm run bal` / `npm test` MUST 逐項不動**(`data.js` 只多了不進 `balanceFingerprint` 的表現層常數,`sim.js` / `server/**` 一行未改;動了就是純表現層漏到判定上)+ **㋓ `shot_scene` 三輪 md5 對照**(`--pref inkBreak=0` / `--pref landInk=0` / `--pref wipe=0` MUST 與改制前**逐張相同**)+ **㋓ `shot_scene --pref inkBreak=0.6` 與 `--pref inkBreak=0.6 --pref inkMrt=on`**(斷筆唯一的驗收面)+ **㋓ 平移不變性直測**(同一台機體放在 (0,0) 與 (137, −91),同一組相對機位截圖,機體佔的那一塊 MUST 逐像素相同 —— `mat3` 那一條唯一驗得到的地方;寫成 `mat4` 之後每一條離線斷言照樣全綠)+ **㋓ `shot_scene` 五種天氣 A/B**(④-3 唯一的驗收面:`clear` MUST **像素相同**,其餘四種 MUST 看得出遠景的線收在霧裡)+ **㋓ 溶入五格定裝照**(k = 0/0.25/0.5/0.75/1,背景各拍一次**天空與地形** —— 洞邊的墨線在兩種背景下是**不同**的行為)+ **㋓ `audit_cockpit` / `audit_muzzle`**(`SVS_URL` MUST 指向本工作區的埠)+ **㋕ 真機**:①開一場把 `wipe` 拉起來放一次自己的大招(幕的傾角與時間曲線)②`landInk` 拉起來看拼圖接縫有沒有被描出來(那是這一項的**已知代價**,不是 bug)+ **㋓ 真 GPU `gl.getError()` MUST 為 0**:`vCelInkP` 是本輪唯一**對每一份不透明 cel 材質都成立**的新 varying(`vDisP` / `vLandId` 只在各自的 define 之下),而 WebGL1 的 varying 下限只有 8 個 vec4 ⇒ 「整批物件不畫、console 一個字都沒有」是這一族的典型死法,離線這端**量不到**|

---

## ③ 根 `CLAUDE.md` §2.1 目錄要加的主題名

`seams-render.md`(§2.1 F)那一列的「涵蓋的縫」清單補六個主題名
(§2.1 的鐵律:目錄裡查不到就會被當成沒有規則):

- **勾線的雜訊斷筆**
- **掠射抑制項恰一項**
- **地貌分區墨線**
- **畫面轉場(斜向 wipe)**
- **物件出現(dissolve)**
- **霧範圍 ≡ 勾線淡出**

---

## ④ `docs/anime_style_plan.md` 執行紀錄那一列

| 序 4 / ①-2 雜訊斷線 + ①-3 地貌遮罩折進 surfaceId + ①-4 深度門檻定案 + ①-5 LUT 斷言 | ✅ 2026-08-16 落地 | 縫:`toon.js` 的 `INK_BREAK`/`_inkBreakA`/`celInkBreak()`/`vCelInkP`/`CEL_INKA`+`CEL_INKB`(斷筆騎既有的 alpha 契約 ⇒ **`postfx.js` 一行不改**)、`celHash`/`celNoise` 提出 `#ifdef CEL_WP`(全專案恰一份)、`LAND_ZONE_N`/`landZoneId()`/`CEL_LAND_ID`/`_landInkA`(①-3 完整實作,旋鈕 def 0);`postfx.js` 群組早退追加「五格都不是 LAND」的閘(今天恆真 ⇒ 逐位元中性)。①-4 **定案維持 `INK.K_S`,不換 `1 − n.z`**(量測表見 seams 那一列),落地的是「掠射抑制項恰一項」斷言 + `--break-graze`。①-5 補九條 LUT 斷言 + `--break-lutstack`。稽核:`audit_soft_stroke` 166 → 190 項(新增 Ⅺ + 三支 `--break`)、`audit_visual_prefs` 186 → 213 項(新增 Ⅶ・Ⅷ + 兩支 `--break`)、`audit_cel_pipeline` 133 → 162 項。`npm run bal` 與基準**逐位元相同**、`npm test` 624 ✅、ground/siteplan/beacons/object_joints 九支輸出**逐字元相同**。|
| 序 8 / ④-1 wipe 轉場 + ④-2 dissolve + ④-3 霧 ≡ 勾線淡出 | ✅ 2026-08-16 落地(④-2 只做「出現」那一半)| 縫:`data.js` 的 `WIPE`/`wipeAt()`/`DISSOLVE`/`dissolveAt()`(純函式,不進 `balanceFingerprint` —— 已實跑 `audit_bot_policy` 確認);`postfx.js` 的 `_wipeMaterial()`/`setWipe()`/`playWipe()`/`_tickWipe()` + chain 插在 **grade 與 fxaa 之間** + dispose 名冊改由 `_quads` 推導 + `INK.FADE_F`/`_inkFadeM()`/`uFade0`·`uFade1`;`toon.js` 的 `dissolve` 選項(`CEL_DIS` / `mat.userData.celDisU` / `vDisP` / `discard` 錨在 `clipping_planes_fragment`)+ **唯一寫入點** `setDissolve()`;消費端 `cutin.js` 的 `setPipeline()`/`wipe()`(自己的大招那一格刷屏)。稽核:`audit_visual_prefs` 新 Ⅷ ±`--break-wipe`、`audit_cel_pipeline` 新 Ⅸ・Ⅹ ±`--break-dissolve`/`--break-fade`。|

### 同輪 MUST 寫回計畫檔的更正(本道量到的)

1. **①-2 的落點是「場景 RT 的 alpha」不是 `gInfo` 的 `inkC`。** 窗 2 的分道說明寫「斷線做在寫入端
   (調變 `inkC`)」,而那**做不得**:`inkC` 只有 MRT 配起來時才存在(`inkMrt` / `lutSrc` / `inkGroup`
   三者皆關 = **出貨預設**時根本沒有第二張附件)⇒ 斷筆在預設組態下會是徹底的 no-op;更硬的一條是
   序 3 的**最近面覆寫**(`minC > ctr ? max(ctr, ceil(minC)) : min(ctr, floor(minC))`)是為**逐材質常數**
   設計的硬決定,餵逐 fragment 雜訊進去的話,任何一格「斷掉」的近鄰會以 `floor(0.12) = 0` 把它**後面**
   所有的線關掉 ⇒ 輪廓被大面積侵蝕。alpha 那條通道沒有這個問題,而且它同時餵給深度訊號與折邊訊號
   (`ae * soft` 與 `mrtEdge * soft`)⇒ 兩種線一起變細 = 真的像筆抬起來。計畫 §① 第 2 點原文只寫
   「地形與機體各一條 `step(noise)`」沒有指定通道 ⇒ **這不是與計畫衝突,是把「寫入端」講得更精確**。
2. **①-3 的 `surfaceId += grassMask * 0.1` 會撞號。** 0.1 / 0.15 落在現役槽 0.1015625 / 0.1484375 的
   `INK_MRT.ID` 0.004 門檻之內 ⇒ 那兩種地貌對建物的線**靜默消失**。唯一不撞號的編碼是**整數格 `k/64`**
   (`nextSurfId` 是半整數格),而窗 1 的 `surfGroup()` 也用整數格 ⇒ 子帶由**頂端往下配**、群組由 2 往上配,
   並在 `postfx.js` 的群組早退追加「五格都不是 LAND」這道閘(唯一會從「少一條線」升級成「整株樹的
   剪影消失」的路徑)。
3. **①-3 的載體是逐頂點 `aLandId`,不是逐材質。** 本專案**沒有** `coverAt`(那是參考專案的 API,全庫零命中),
   也沒有任何 fragment 空間的 grass/rock 遮罩:`field.js` 只產出風化場(與地貌無關),真正的地貌分類是
   CPU 端逐 13m 格的 `zoneGrid`/`subGrid`,而底毯是逐 `sub#variant` 分桶的獨立材質。把分區併進分桶鍵
   會讓 scree / steppe / concrete 這些跨分區的款分裂成多桶。
4. **①-4 的兩條曲線配不起來(量測表見 ① 的那一列),定案維持 `K_S`。** 這是一個**定案**不是「暫不處理」,
   MUST 讓使用者知道理由(見 ⑤-1)。
5. **④-2 的「消失」那一半與「遠距剔除」不在本輪。** 前者要 ghost 清單(`this.ents` 有 20+ 個消費端,
   含準星解算與鎖定);後者這個功能**本身還不存在**(`data.js DOF` 檔頭:「日後真做距離剔除時…」)。
   本輪把剔除的縫留好但 `DISSOLVE.FAR_M = 0` ⇒ **那一段根本不編進著色器**。
6. **④-1 的兩個呼叫點在 `game.js`(不是本道的檔案)。** 計畫與 seq8 規格點名的是「開戰揭幕 / 結算遮幕」,
   而 `game.js` 是 lane-world 的地盤 ⇒ 本輪把**驅動 API 完整落在管線自己身上**(`playWipe`/`_tickWipe`
   由 `render()` 逐幀推進,呼叫端不必給 dt)並接上**本道擁有的** `cutin.js`(自己的大招那一格刷屏)。
   `game.js` 那兩個呼叫點的接線只有一行,規格住 ⑥ 的 S15。
7. **`audit_visual_prefs` 之前對 3D LUT 一條斷言都沒有**(全檔零 LUT 斷言),計畫 ①-5 講的「補上斷言」
   因此是從零開始的九條,不是補強。
8. **seq8 規格的 ④-4(把接縫 symptom 表併進六支稽核的檔頭,純註解)本輪沒做** —— 那六支
   (`audit_ground_tile` / `audit_ground_drape` / `audit_road_joint` / `audit_traverse` /
   `audit_layer_block` / `audit_underpass`)與 `shot_scene.mjs` **都不是本道的檔案**(lane-world /
   lane-zonecut 的地盤,而且本輪它們之中有幾支正被那兩道改著)。它是**純註解**、零行為 ⇒ 可以獨立
   排在任何一輪,規格原文仍在 `docs/_pending/spec/seq8-wipe.md` 的 files 那六列。
9. **`_lane_plan.json` 的 I5(`INK_MRT.SELF_F` / `GRAZE_K` 定案掃描)仍未做**,而且**做不了** ——
   它的判準三條全部要「巨岩 / 山脊 / 棧道」這些**lane-world 的消費端上線之後**在定場照上人眼判讀
   (`shot_scene --pref inkMrt=on` 的 4 × 4 掃描)。現值 2.2 / 2.0 仍是**起手值不是實測值**
   (窗 1 的 ⑤-3 已經開過票,本輪一格未動)。

---

## ⑤ 待裁決(MUST 由使用者定案;本輪一律做成旋鈕 + 預設不生效)

1. **①-4 定案「維持 `INK.K_S`,不換成 `1 − n.z`」需要使用者確認。** 計畫原文寫「兩者擇一」,本輪選了
   前者並把它寫成可驗的斷言。理由三層:①**兩條曲線在任何單一係數下都配不起來**(K_S 版 2° 給 11.73×、
   45° 給 1.37×;`1 + K_N·(1 − n.z)` 上界恆為 `1 + K_N` ⇒ 配 2° 就把 45° 斜面推到 3.09 倍過度抑制,
   配 10° 就讓 2° 只剩 0.30 倍);②`1 − n.z` **只有 `inkMrt` 開著才拿得到法線**,而它預設關、WebGL1 上
   沒有 ⇒ 換過去等於**出貨預設組態完全失去掠射抑制**(= 「整片山坡畫滿等高線」那個病灶原樣回來);
   ③哨兵像素(天空 / 護盾 / 粒子 / 招牌)沒有法線 ⇒ 要第二份門檻 = 第二份實作。若使用者仍要換,
   那不是序 4 的體量(要同時讓 `inkMrt` 從 opt-in 變必要、重調 `EDGE0`/`EDGE1`/`K_D`、為哨兵準備第二份
   門檻、並先拍 13 張基準定場照)⇒ 屬於序 12 的等級。
2. **`INK_BREAK` 的四個值是起手值不是量測值**(`SPAN_ENV 3.0` / `SPAN_MECH 0.45` / `CUT 0.42` / `LO 0.12`)。
   離線只驗得到「有沒有這個機制」與參數的合法帶,驗不到「斷得好不好看」⇒ MUST 走
   `shot_scene --pref inkBreak=…` 的掃描 + 定裝照人眼判讀,**取平均、MUST NOT 逐場地挑參數**
   (同 A46 ⑩ `dn_iter` 的紀律)。已知的兩個取捨:`LO = 0`(真的斷開)vs `0.12`(筆壓變輕)——
   前者對著天空的輪廓會出現破洞;`SPAN_MECH` 調到 0.2m 以下會在 150m 外退化成「整條線都很淡」。
   另外一條**只有真機看得到**:8bit RT 上軟性件的斷處(`0.3 × 0.12` ≈ 9/255)實質等於沒有線 ⇒
   「要不要對軟性件關掉斷筆」是一個取捨,MUST 由定裝照決定,本輪刻意沒有在稽核裡先寫死。
3. **`landInk` 打開的代價要使用者知道並確認。** 這一項與兩條有日期的定案正面相反(2026-08-13
   「不要看出地貌拼圖接縫」、2026-08-11「相同地貌不需要分界線」),而**現制的 zone 換手發生在
   逐格投票邊界與 `CARPET_LOT` 量化格上、不在真實地貌界線上** ⇒ 今天把它拉起來就是把 2026-08-13
   剛藏起來的拼圖接縫**用黑線重新描一次**。使用者說「衝突時以計畫為主」⇒ 本輪**完整實作、旋鈕 def 0**。
   要它真的成立有兩條路:①等序 14/15 的線工切面把地貌系統換掉(計畫 §0-a);②先讓 `ground.js` 的
   分區邊界對齊真實地貌界線(那是 lane-world 的地盤,而且量級遠大於這一項)。
   **另外:消費端還沒接** —— `ground.js` 要在 `emitCell` 的 `pushLandN` 旁邊多推一個 `aLandId`
   (規格住 ⑥ 的 S13),那是 lane-world 的檔案。
4. **`landInk` 這根拉桿在 id 通道上實質是開關**(任何 > 0 都是完整分離;id 差是離散的,而線的有無由
   0.004 門檻決定)。要不要把它從拉桿改成 `off`/`on` 分段鈕是**旋鈕表的改動**,而那張表由本道單一擁有
   ⇒ 需要使用者一句話,本輪維持拉桿(def 0,行為與 def 相同)。
5. **`wipe` 的 def 要不要翻成 > 0。** 計畫書序 8 明寫「旋鈕預設關 = 逐位元同舊制」,但那等於這一輪交付的
   轉場沒有任何人看得到;而 `visualPrefs.js` 紀律①又寫著「`def` 那一欄是**交付定案值**」。兩者在這一項上
   打架。本輪照計畫落地成 0,翻成 1 是一行的事。
6. **`cutin.js` 的刷屏掛在「自己的大招」那一格是本道的選擇。** seq8 規格點名的兩個呼叫點(開戰揭幕 /
   結算遮幕)住 `game.js`(lane-world 的地盤)⇒ 本輪接的是本道擁有的那一個消費端。三件要裁的事:
   ①大招刷屏會**遮住 3D 主畫面約 0.34s**(DOM 立繪照樣在上面播)—— 戰鬥中可不可以接受;
   ②要不要改成只掛在「開戰 / 結算」而不掛戰鬥中;③`game.js` 那一行接線(`this.cutin.setPipeline(this.pipeline)`)
   由誰落。**沒接上 `setPipeline` ⇒ 一格都不會發生**,所以今天它是安全的。
7. **`DISSOLVE` 的驅動端還沒接**(`_spawnUnit` 對 `kami`/`decoy`/`hyper` 記 `disT0`、`_updateEnts` 逐幀
   推進),那兩處都在 `game.js`。規格住 ⑥ 的 S16,`setDissolve()` 是唯一寫入點。**沒接 ⇒ `uDis` 恆 1
   ⇒ 逐位元同舊制。**
8. **④-3 的「地板」是對計畫原文的一個讓步。** 計畫寫的是「霧範圍 ≡ 勾線淡出範圍」這個**嚴格等式**,
   而地板(`fadeEnd ≥ combatReachM() / FADE_F`)在「迷你地圖 + 霧天」那一格會讓淡出帶比霧遠
   (霧的遠端 168m < 交戰上界 304m)。不加地板則 `fade0 > fade1`(smoothstep 端點反轉)必須另外用夾制
   處理,而且**打得到的目標會沒有輪廓線**。建議加(它與 DOF Ⅵ-b 是同一條規則的兩端),但那是對計畫
   原文的偏離 ⇒ **需要裁決**。
9. **④-3 對 `clear` 以外四種天氣是設計上的行為改變**(線從此跟著霧收,而現制是把線整段畫在已經飽和的
   霧色上)。`clear` 在實數上恆等舊制。這一條**不是**旋鈕:它是把一個錨換掉,而兩個錨不可能並存。

---

## ⑥ 本階段的量測與逐位元證據

| 量測 | 結果 |
|---|---|
| `npm run bal` | 與窗 1 基準 `bal.txt` **逐位元相同**(diff 空) |
| `npm test`(§5.2,埠 8637,跑完 taskkill) | 624 ✅ / 0 ❌;斷言**逐項相同**。四處數值差全部是隨機值(PIN / 現金物資 / 開局資金)或**基準檔本身的年份差**:`buildDps` 離散度 2.78 vs 2.79 已用 `git show HEAD:public/js/data.js` 對照確認 **HEAD 與現況逐位相同**(1.70480 / 2.36858 / 2.79024 / 4.08558),與本輪改動無關 |
| ground / siteplan / beacons / world_edge / object_joints --seeds 8 等九支 | 與 `docs/_pending/base-world/` **逐字元相同**(零共享 `rnd()` 消耗) |
| `audit_cel_pipeline` | 133 → **162** 項,0 失敗;12 支 `--break` 逐一咬得住 |
| `audit_soft_stroke` | 166 → **190** 項,0 失敗;11 支 `--break` 逐一咬得住 |
| `audit_visual_prefs` | 186 → **213** 項,0 失敗;2 支新 `--break` 咬得住 |
| `audit_gpu_lifecycle` / `audit_client_syntax`(±`--break-glsl`)/ `audit_solo_boot` | 全綠且既有斷言逐項不動 |
| ①-4 的行為量測(解析平面模型,fovY 68°、1080p) | 掠射 2° 的門檻倍率 **11.73×**、45° **1.37×**(與規格書的量測表逐位吻合) |
| ④-3 逐隊制 × 逐天氣的淡出帶 | 480/clear [528, 912] / 480/cloudy [445, 768] / 480/rain [304, 525] / 480/snow [306, 528] / 480/fog [304, 525];**全部 `fadeStart ≥ combatReachM() = 304m`**,端點恆不反轉 |
