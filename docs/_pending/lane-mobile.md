# lane-mobile 交付(⑧-5 觸控硬化)— 文件差異與待裁決

> 平行窗紀律:本道**沒有**改 `CLAUDE.md` / `.claude/rules/**` / `docs/anime_style_plan.md` /
> `public/js/.claude.md` / `tools/CLAUDE.md` 任何一個字。以下四段請整合者序列合併。
>
> 改動檔案(僅此三支,全部在 `ownsFiles` 之內):
> `public/css/style.css` / `public/js/mobile.js` / `tools/audit_ctrl_mode.mjs`。
> `data.js` / `sim.js` / `server/**` / `index.html` **一行未動**。

---

## ① `.claude/rules/seams-ui-net.md` —— 新增一列(接在「視窗尺寸定案(旋轉 debounce)」之後)

| 頁面級觸控硬化(裝置 vs 版型) | 裝置旗標 `body.touch-dev`(判定唯一縫 `ctrlmode.touchCapable()`、掛載點 `mobile.installTouchUI()`)+ `style.css` 的 `body.touch-dev { … }` 與 `body.touch-dev #game { touch-action: none }`;版型旗標仍是 `body.touch-ui`(`--tl-*` 控件變數 / `.tl-*` 逐控件 `touch-action` / 安全區 `--tl-sl·sr·sb·st`);根層 `html, body { text-size-adjust: 100% }`;`index.html` 的 `viewport-fit=cover` + `user-scalable=no` | 2026-08-16(`docs/anime_style_plan.md` ⑧-5)。**「這台機器有沒有觸控硬體」與「這一房用不用搖桿」是兩個不同的問題,改制前共用了一個旗標。** 五條頁面級硬化(`overscroll-behavior` / `user-select` / `touch-callout` / `tap-highlight` / `#game{touch-action:none}`)原本掛在 `body.touch-ui` 之下,而 `touch-ui` = `mobile.isTouchUI()` = `ctrlmode.usePad()` = **房主可關的房間設定** ⇒ 房主選「限定滑鼠鍵盤」時 `ctrlScheme()` 早退回 `'kbm'`,**真手機上那一整組保護當場消失**:捏合縮放(iOS Safari 無視 `user-scalable=no`)、下拉刷新、長按選字、點擊藍色高亮全部回來,而遊戲照樣在跑、零錯誤訊息。四條:①硬化 MUST 綁 `body.touch-dev`、版型 MUST 綁 `body.touch-ui`,**兩者 MUST NOT 再合流**;判定只准轉呼 `touchCapable()`,`mobile.js` 與 CSS MUST NOT 再寫一份 `maxTouchPoints` / `pointer: coarse`(A21 家族),掛載點 MUST 恰一處且與 `installTouchUI()` 同一支。②`touch-action: none` MUST NOT 上 `html` / `body` / `.screen` / `.overlay-box` —— 大廳 `.screen` 與商店/設定/圖鑑十幾個 `overflow-y: auto` 面板靠捲動,寫在根層的症狀是「大廳滑不動」而不是報錯;判準是選擇器的**主體**(最後一個 compound),`body.touch-dev #game` 是具名例外(戰場那一格本來就不該捲)。③`text-size-adjust: 100%` MUST 掛**根層**(`html`/`body`)且 MUST 帶 `-webkit-` 前綴 —— iOS 橫式會自動放大它認為太小的文字,而 HUD 下帶的 1/6 上限是 `game.fitHudBand()` 量**自然高**反解 `--hud-k` 的(COCKPIT ⑦)⇒ 字被瀏覽器改大 = HUD 整條換一個比例;既有的 `body.touch-ui input, select { font-size: 16px }` 只擋「聚焦時整頁放大」,擋不到這一條。掛進 `body.touch-*` 就又綁回房間設定了。④`viewport-fit=cover` MUST 留著 —— 沒有它,`env(safe-area-inset-*)` 在挖孔機上恆回 0,`--tl-s*` 四個變數全變 0px 而 CSS 照樣算得出來,只有搖桿被瀏海吃掉。**純滑鼠桌機 `touchCapable()` 恆 false ⇒ 逐位元同改制前。** 稽核 `audit_ctrl_mode` Ⅹ ±`--break-viewport`/`--break-textadj`/`--break-touchdev`/`--break-touchact`(⑤ 是 ③ 的對照組:`--break-touchdev` 下 Ⅹ③ MUST 紅而 Ⅹ⑤ MUST 仍綠,兩欄同時對才代表兩個旗標真的拆開了) |

> 連帶:同檔「操作方式(輸入裝置)」那一列的鐵律欄,建議在「裝置判定只有 `deviceScheme()`」之後補一句
> ——「**頁面級觸控硬化綁 `touchCapable()`、操控版型綁 `usePad()`,MUST NOT 互相代用**」。

---

## ② `.claude/rules/verification.md`

### §5.1(續)離線稽核清單 —— 把既有那一行擴成兩行

```bash
node tools/audit_ctrl_mode.mjs       # 操作方式 + 戰場選單 + 按鍵風格 + 頁面級觸控硬化(Ⅹ)
#   ±--break-viewport/--break-textadj/--break-touchdev/--break-touchact
```

### §5.5 —— 新增一列(排在「視窗尺寸定案 / 旋轉 debounce」那一列之後)

| 改動 | 驗證 |
|---|---|
| 頁面級觸控硬化 / 裝置 vs 版型旗標(`style.css` 的 `body.touch-dev` 區塊與 `body.touch-dev #game`、根層 `text-size-adjust`、`body.touch-ui` 的 `--tl-*` 與安全區、`mobile.installTouchUI()` 的 `touch-dev` 掛載、`index.html` 的 viewport meta) | `audit_ctrl_mode` **Ⅹ** ±**四支** `--break-viewport`/`--break-textadj`/`--break-touchdev`/`--break-touchact`(每一支 MUST 對應紅字;`--break-touchdev` 下 Ⅹ⑤ **MUST 仍綠** —— 兩欄同時對才代表旗標拆開了)+ `audit_touch_layout` / `audit_touch_gesture` / `audit_ui_layout` / `audit_gyro` MUST **逐項不動**(`audit_touch_layout` 的 **8/60 既有紅 MUST 維持在 8**,變多就是硬化那一刀動到版型;⚠ 這三支的**框線數字**有 ±1~4px 的 run-to-run 抖動,pristine 自己也會抖 ⇒ 判準是「通過數 + 失敗案例集合」不變,不是逐字元 diff)+ `audit_client_syntax`(㋖)+ `npm run audit:net` / `audit_solo_boot` + ㋒(`data.js`/`sim.js`/伺服器一行未改 ⇒ `npm run bal` / `npm test` MUST 逐項不動)+ **㋕ 真機**:①房主鎖「限定滑鼠鍵盤」時在手機上仍**捏合不動、下拉不刷新、長按不選字**(這正是改制前壞掉的那一格,而它在離線這端只表現成選擇器字串不同)②iPhone 橫握 HUD 下帶比例與直握一致(text-size-adjust 的唯一驗收面)③有觸控螢幕的 Windows 筆電第一次吃到 `#game{touch-action:none}` —— 是**刻意**的行為改變 |

---

## ③ 根 `CLAUDE.md` §2.1 目錄 —— `seams-ui-net.md` 那一列的「涵蓋的縫」加一個主題名

在「…・**視窗尺寸定案(旋轉 debounce)**・決定性亂數」之間插入:

> **頁面級觸控硬化(裝置 vs 版型)**

(§2.1 的鐵律:目錄裡查不到就會被當成沒有規則。)

---

## ④ `docs/anime_style_plan.md` 執行紀錄 —— ⑧-5 那一列

| ⑧-5 viewport・safe-area・touch-action 核對 | **2026-08-16 落地(lane-mobile)** | `viewport-fit=cover` 與 `env(safe-area-inset-*)` **改制前就已經有了**(`index.html:6` + `style.css` 12 個消費點),參考專案多的 `shrink-to-fit=no` / `minimal-ui` 在現行引擎上是 no-op,**刻意不加**。真缺口兩條、都已修:①全 repo 零 `text-size-adjust` ⇒ 補在根層;②五條頁面級觸控硬化綁在 `body.touch-ui`(= 房主可關的**房間設定**)⇒ 改綁新的裝置 class `body.touch-dev`(判定唯一縫 `ctrlmode.touchCapable()`)。另補上全 repo **第一支**驗 viewport meta / touch-action / safe-area 的離線斷言(`audit_ctrl_mode` Ⅹ,32 條 + 四支 `--break`)。`interactive-widget=resizes-content` 判定為**新增行為不是缺陷修補**,未做(見待裁決)。 |

### 計畫更正(本道量到、與計畫/規格描述不符的兩處)

1. **「⑧-5 只是核對」不成立** —— 它含一個**真缺陷**:頁面級硬化掛在房主可關的房間設定上。
   建議把 ⑧-5 那一格由「核對」改寫成「核對 + 一項缺陷修補」。
2. **`text-size-adjust` 的驗收面不是「iOS 橫式字變小」而是 HUD 帶比例** —— 它與 COCKPIT 的
   `HUD_BOTTOM_F` / `fitHudBand()` 是同一條規則的兩端(字級被瀏覽器改 ⇒ 量到的自然高變 ⇒
   `--hud-k` 變)。計畫 ⑧-5 沒有寫這條連動,建議補進去。

---

## ⑤ 待裁決(MUST NOT 由本道定案)

### 決 1 —— ⑧-4 桌機 DPR 三選一(**原封不動抄自規格 `mobile-rest.md` 的 blockedOn**)

> ⚠ 關鍵事實:參考專案的 1.15 是 `setPixelRatio(1)` **之上的 RT 縮放**,本專案的 2 是**裝置像素比的天花板**
> —— 兩個不同的量,把裁決簡化成「2 太高改 1.15」會讓方向講反。另 `RES_GOV.MIN`(0.7)× 天花板 2
> ⇒ 桌機有效像素比的**地板是 1.40**,1.15 在今天的自適應範圍**之外**。
> 爭點**只在 `dpr ≤ 2` 那一支**(HiDPI 桌機/筆電),與手機無關 —— 觸控路徑 `TOUCH_DPR_MAX = 1.5`
> 已與參考專案逐位元同值。

- **(甲)維持天花板 2** —— HiDPI 滿檔畫質;代價 dpr=2 每幀 8.29Mpx(1080p CSS)+ 221MB RT。
- **(乙)照參考專案 `dpr≤2 ? min(dpr,1.15) : min(dpr,1.5)`** —— dpr=2 省 66.9% 像素與 148MB;
  代價是**失去桌機唯一的空間抗鋸齒來源**(post 開啟時 MSAA 是關的,`game.js:671`)⇒ 1px 墨線變粗變抖、
  FPV 遠距辨識變差,而 **dpr=1 的一般桌機完全不受影響**(`min(1, 1.15) = 1`)⇒ 省不到那一群人。
- **(丙)天花板不動,把 `RES_GOV.MIN` 由 0.7 降到 0.575** —— 撐得住的機器**逐位元同現況**,只有已降階的
  才走更低;但 dpr=1 的地板會掉到 0.575(明顯糊)⇒ 地板 SHOULD 改寫成推導的「有效像素比 ≥ 1.15」
  而不是固定倍率,這一層要不要做也要一起裁。

裁決若落在 (乙)/(丙):常數 MUST 具名(`DESK_DPR_MAX`)、`_dpr()` 仍是唯一天花板、`_applyRes()` 仍是唯一
落地出口;`tools/audit_gpu_lifecycle.mjs:124` 那條比對**字面 `: 2`** 的斷言會當場紅 ⇒ MUST 同步改成比對
具名常數並新增「常數值 = 定案值」+ `--break-dpr`。⚠ 這一項要動 `game.js`(lane-motion 的地盤)與
`audit_gpu_lifecycle`(lane-ink 的地盤),**本輪一格未碰**。

### 決 2 —— viewport 是否加 `interactive-widget=resizes-content`

大廳有 5 個文字輸入(`#myName`/`#cloudUrl`/`#joinPin`/`#roomNameInput`)而 `.screen` 是 `position: fixed`,
Android 軟鍵盤預設 `resizes-visual` 可能蓋住輸入框。這是**新增行為不是缺陷修補** ⇒ 本輪未做。

### 決 3 —— 觸控筆電/鎖鍵鼠手機失去「選取複製」(本道實測到、規格未討論)

改制後 `user-select: none` 由「pad 版型」擴到「有觸控硬體」⇒ **有觸控螢幕的 Windows 筆電 / 2-in-1**
(`touchCapable()` 為真但用鍵鼠)第一次吃到它。實測(computed style,1280×800):

| 元素 | 改制前(kbm) | 改制後(touch-dev) |
|---|---|---|
| `#roomPin`(房間 PIN,`<b>`) | `auto` | `none` |
| `#roomUrls`(區網網址,`<span>`) | `auto` | `none` |
| `#cloudUrl` / `#joinPin`(`<input>`) | `auto` | `none`(表單控件仍可輸入/選字 —— 手機上今天就是這樣在打字) |

也就是說:**房主想把區網網址或 PIN 複製給隊友時選不起來**,而那台機器多半正是筆電。
三條路,請擇一:
- **(a)照規格原樣**(現況已落地):五條全綁裝置,接受此代價。
- **(b)加一條窄豁免** `body.touch-dev .room-meta, body.touch-dev .room-meta b { user-select: text; }`
  —— 一行、只放行房間中繼資料;副作用是 pad 版手機也跟著可選(那是**改善**不是回歸)。
- **(c)`user-select` 那一條留在 `body.touch-ui`,其餘四條搬到 `touch-dev`** —— 最保守,
  但等於承認「五條裡有一條是版型」,與 ① 那一列的規則敘述不一致。

**本道採 (a)** —— 規格明列五條一起搬,而「衝突時一律以計畫為主」。若使用者選 (b)/(c),改動落在
`style.css` 一處 + `audit_ctrl_mode` Ⅹ③ 的 `HARDEN` 名冊一列,十分鐘的事。

### 決 4 —— 行為改變的否決權(規格自己要求列出來讓使用者有機會否決)

本輪在**觸控裝置**上有兩處刻意的行為改變(純滑鼠桌機逐位元不變):
1. 房主鎖「限定滑鼠鍵盤」時,手機上的頁面級硬化**不再消失**(= 修的那個缺陷本身)。
2. 桌機用 `?ctrl=pad` / 大廳選「限定搖桿」強制驗版型時,**不再**吃到頁面級硬化
   (那台機器沒有觸控硬體 ⇒ 依新規則它本來就不該吃)。第 2 點只影響開發期驗版型。
