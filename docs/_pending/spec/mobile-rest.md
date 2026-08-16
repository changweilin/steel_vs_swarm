# 序 4 前置 — 計畫 ⑧-4(桌機 DPR 裁決)/ ⑧-5(viewport・safe-area・touch-action 核對)+ 本輪全域回歸面盤點與改動前基準  (key: mobile-rest)

## 摘要

A(⑧-4):量完了,而且結論是「1.15 這個數字在本專案不是同一個量」。參考專案把 `renderer.setPixelRatio(1)` 再用 RT scale 疊 1.15 ⇒ 它在**每一種螢幕**上都畫 1.15× CSS 像素;本專案 `game._dpr()` 回的是**裝置像素比的天花板** ⇒ 在一般 1× 桌機螢幕上只畫 1.0×(比參考專案**少**),只有 HiDPI 才撞到 2。所以「跟進」在 dpr=1 的機器上是**變慢變清楚**、在 dpr=2 的機器上是**變快變糊 3.02×**,方向相反 —— 這正是要裁決的東西,我沒有動手。另量到一條硬事實:`RES_GOV.MIN = 0.7` 乘在天花板 2 上 ⇒ 桌機有效像素比的**地板是 1.40**,1.15 在今天的自適應範圍**之外**,調節器再怎麼降也到不了。B(⑧-5):`viewport-fit=cover` 與 `env(safe-area-inset-*)` **都已經有了**(index.html:6、style.css:1626-1629 + 12 個消費點),`touch-action:none` 也有;真缺口只有兩條 —— ①全 repo 沒有 `-webkit-text-size-adjust`(iOS 橫式會自己放大 HUD 文字,而 HUD 1/6 是 `fitHudBand()` 量出來的);②整組頁面級觸控硬化(`touch-action`/`overscroll-behavior`/`user-select`/`tap-highlight`)綁在 `body.touch-ui`,而那個 class = `ctrlScheme() === 'pad'` = **房主可關的房間設定**,房主選「限定滑鼠鍵盤」時真手機上這四條全部消失。C:79 支離線稽核 + `npm run bal` + `npm test` 的改動前基準已全部量完並落盤(見 blockedOn 的路徑),bal 🎉 全綠、e2e 🎉 全綠(624 ✅)、離線稽核 72/79 綠;7 支非綠全部是**與本輪無關的既有紅或環境不足**,逐支已歸因。另外挖到一個會靜默漏掉本輪新模組的閘門缺口:`audit_cel_pipeline` 的「進場景 ShaderMaterial MUST 宣告 gInfo」那道閘 `readdirSync` **只掃 public/js 頂層、不遞迴**。

## 縫

### ⑧-4 裁決點:桌機像素比天花板
`public/js/game.js:2903`

現行:
```js
  _dpr() {
    if (lowPower()) return 1;
    const dpr = window.devicePixelRatio || 1;
    return Math.min(dpr, isTouchUI() ? TOUCH_DPR_MAX : 2);
  }
```

**改成**: **MUST NOT 自行決定。** 三個自洽選項,量出來的代價如下(1920×1080 CSS、資訊緩衝關、無 dof):(甲)維持 2 —— dpr=1 螢幕 2.07Mpx/55MB、dpr=1.25 3.24Mpx/87MB、dpr=1.5 4.67Mpx/125MB、dpr=2 8.29Mpx/221MB。(乙)照參考專案改成 `dpr<=2 ? min(dpr,1.15) : min(dpr,1.5)` —— dpr=1 完全不變(min(1,1.15)=1,**注意:參考專案在這裡是 1.15,比本專案多**)、dpr=1.25 −15.4% 像素、dpr=1.5 −41.2%、dpr=2 **−66.9%(3.02×)**、dpr=3 由 2.00 降到 1.50(−43.8%)。(丙)天花板不動、把 1.15 變成**地板**:`RES_GOV.MIN` 0.7→0.575 讓調節器在量到撐不住時自己走到 1.15(今天的地板是 2×0.7=1.40,**構造上到不了 1.15**)。若採 (乙)/(丙),常數 MUST 具名(如 `DESK_DPR_MAX`)且 `_dpr()` 仍是唯一天花板、`_applyRes()` 仍是唯一落地出口。

### 對照組:觸控像素比天花板(已與參考專案逐位元同值)
`public/js/game.js:467`

現行:
```js
// 觸控裝置的像素比上限:手機 DPR 常見 2.5~3.5,照單全收等於算 6~12 倍於邏輯解析度的像素,
// 行動 GPU 是**填充率**瓶頸 ⇒ 高功耗模式一樣掉幀。1.5 已看不出鋸齒差(還有 FXAA 級的 DPR 抗鋸齒)。
const TOUCH_DPR_MAX = 1.5;
```

**改成**: **不動。** 參考專案對 dpr > 2 的規則就是 `min(dpr, 1.5)`,而手機 dpr 恆 > 2 ⇒ 本專案的觸控路徑**已經與參考專案完全一致**。⑧-4 的爭點因此**只在 `dpr ≤ 2` 那一支**,也就是 HiDPI 桌機/筆電(MacBook、4K@200%、Windows 125%/150% 縮放),與手機無關。這一點 MUST 寫進裁決說明,否則使用者會以為是在談手機。

### 自適應解析度的地板(1.15 今天在範圍外)
`public/js/game.js:479`

現行:
```js
const RES_GOV = {
  MIN: 0.7,        // 縮放下限(乘在 _dpr() 天花板上):再糊就影響瞄準辨識,寧可掉幀
  STEP: 0.1,       // 每次調整一階(drawing buffer 重配有成本,小步走 + 冷卻防震盪)
  HI_MS: 20,       // 平均幀時 > 20ms(< 50fps)⇒ 降一階
  LO_MS: 17.2,     // 平均幀時 < 17.2ms(60Hz vsync 滿速)⇒ 有餘裕,升一階
```

**改成**: 提供給裁決的事實:`_applyRes()` = `_dpr() × _resScale`、`_resScale ∈ [MIN, 1]` ⇒ dpr=2 桌機的有效像素比只在 **[1.40, 2.00]**(跨幅 1.43×)浮動。參考專案的自適應範圍是 [0.6, 1.0] 乘在 1.15 上 = [0.69, 1.15],**整段都在本專案的地板之下**。要讓 1.15 變成「量到撐不住才去的地方」而不是「所有人的天花板」,動的是這一格(0.575)而不是 `_dpr()`;若採此路 MUST 注意 dpr=1 螢幕會被推到 0.575(明顯糊),故地板 SHOULD 寫成推導的「有效像素比 ≥ 1.15」而不是固定倍率 —— 但採不採、怎麼寫,MUST 由使用者定案。

### 像素比落地唯一出口(不論裁決結果都不得再開第二個)
`public/js/game.js:2911`

現行:
```js
  /** 像素比落地的唯一出口:天花板 `_dpr()` × 動態縮放 `_resScale`(桌機恆為 1)*/
  _applyRes() {
    this.renderer.setPixelRatio(this._dpr() * this._resScale);
    this._onResize();
  }
```

**改成**: 不動。裁決若落在 (乙)/(丙),改的都只是天花板或地板的**值**,這條路徑一行不改;`audit_gpu_lifecycle` 已釘住「game.js 全檔 setPixelRatio 恰 2 處」與這一行的字面,MUST 維持。⚠ `public/js/charPreview.js:33` 另有一處 `setPixelRatio(Math.min(2, devicePixelRatio))`(圖鑑展示台,不在戰場路徑、不在稽核的計數內)—— 裁決若是「全站跟進」要一併講,若是「戰場畫質取捨」就 MUST NOT 順手改它。

### DPR 天花板的稽核鎖(改值必連帶)
`tools/audit_gpu_lifecycle.mjs:124`

現行:
```js
  ok(/TOUCH_DPR_MAX/.test(G) && /isTouchUI\(\) \? TOUCH_DPR_MAX : 2/.test(G),
    '像素比上限:觸控 TOUCH_DPR_MAX / 桌機 2(桌機行為不變)');
```

**改成**: 這是本專案**唯一**釘住桌機 DPR 的地方,而且它比對的是**字面的 `: 2`**。裁決若是 (乙),這一條會當場紅字 ⇒ MUST 同步改成比對具名常數(`isTouchUI() ? TOUCH_DPR_MAX : DESK_DPR_MAX`)並新增一條「常數值 = 定案值」的斷言;裁決若是 (丙),這一條逐字不動,改的是 `MIN` 那一行(目前無斷言 ⇒ SHOULD 補一條「地板 × 天花板 = 定案的有效像素比下限」)。

### 「post 鏈超取樣」的真身 = RT 尺寸 ≡ drawing buffer
`public/js/postfx.js:771`

現行:
```js
  setSize() {
    const s = this.renderer.getDrawingBufferSize(new THREE.Vector2());
    if (s.x === this._size.x && s.y === this._size.y) return;
    this._size.copy(s);
    for (const rt of [this.rtScene, this.rtA, this.rtB]) rt.setSize(Math.max(1, s.x), Math.max(1, s.y));
  }
```

**改成**: 不動,但這是 ⑧-4「兩者會相乘」那句話的**證據**:全 repo 沒有任何獨立的超取樣係數(`grep -rn '超取樣|supersamp' public/js` 只有一行註解),DPR **就是**超取樣係數,而它乘的是「場景 pass + ink + grade + fxaa」四趟全螢幕工作(狙擊時再加 dof)。逐 pass 取樣數:ink 每個非天空像素 5 次深度 + 5 次顏色(開資訊緩衝再 +5)、grade 1(+LUT)、fxaa 1~9 ⇒ 後製本身每像素約 12~20 次 texture fetch。VRAM(HalfFloat RGBA 8B × 3 張 + 深度 4B = 28 B/px):1920×1080 CSS 下 dpr=2 是 221MB、1.15 是 73MB。桌機 MSAA 已關(`antialias: off('post') && !isTouchUI()`,game.js:671)⇒ **DPR 是桌機唯一的空間抗鋸齒來源**,FXAA 補不回 1px 墨線的資訊 —— 這是 (甲) 那一側最硬的論據,MUST 寫進裁決說明。

### ⑧-5:viewport meta(已符合,MUST NOT 加參考專案那兩個死參數)
`public/index.html:6`

現行:
```js
<!-- 手機:禁縮放/雙擊放大(戰場觸控要吃掉所有手勢)+ 挖孔螢幕安全區(CSS env(safe-area-inset-*)) -->
<meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no, viewport-fit=cover">
```

**改成**: **現值已含 `viewport-fit=cover`,無事可做。** 參考專案多的 `shrink-to-fit=no`(iOS 9.2~9.3)與 `minimal-ui`(iOS 7.1)在現行引擎上是 no-op,MUST NOT 為了「與參考一致」加上去(那只是雜訊)。**可選、需使用者定案**:`interactive-widget=resizes-content` —— 大廳有 5 個文字輸入(`#myName`/`#cloudUrl`/`#joinPin`/`#roomNameInput`),Android 軟鍵盤預設 `resizes-visual`,而 `.screen` 是 `position: fixed`(style.css:85)⇒ 鍵盤彈出時輸入框可能被蓋住。這是新增行為,不是缺陷修補,MUST NOT 自行加。

### ⑧-5 真缺口②:頁面級觸控硬化綁錯旗標
`public/css/style.css:1636`

現行:
```js
  --tl-alpha: 0.55;
  --tl-alpha-on: 1;
  overscroll-behavior: none;
  -webkit-user-select: none;
  user-select: none;
  -webkit-touch-callout: none;
  -webkit-tap-highlight-color: transparent;
}
body.touch-ui #game { touch-action: none; }
body.touch-ui #gameCanvas { cursor: default; }
```

**改成**: 這五條(含 `#game` 的 `touch-action: none`)全部掛在 `body.touch-ui` 之下,而 `body.touch-ui` 由 `mobile.installTouchUI()`(mobile.js:235-237)依 `isTouchUI()` 掛 ⇒ 見下一個縫。**改法**:另立一個依「這台機器有沒有觸控硬體」掛的 class(如 `body.touch-dev`,判定只准轉呼 `ctrlmode.touchCapable()`,MUST NOT 在 CSS/mobile.js 再寫一份 `maxTouchPoints`),把 `overscroll-behavior`/`user-select`/`touch-callout`/`tap-highlight`/`#game{touch-action:none}` 五條移過去;**控件尺寸與版型那一票 `--tl-*` MUST 留在 `body.touch-ui`**(那才是「這一房用不用搖桿」)。⚠ MUST NOT 把 `touch-action: none` 加到 `html`/`body`/`.screen`:`.screen { overflow: auto }`(style.css:85)與商店/設定/圖鑑十幾個 `overflow-y: auto` 面板靠捲動,參考專案是單一滿版 3D 頁才敢在根層寫死。

### ⑧-5 真缺口②的根因:`body.touch-ui` 是房間設定不是裝置
`public/js/ctrlmode.js:184`

現行:
```js
export function ctrlScheme() {
  const m = ctrlMode();
  if (m !== 'any') return m;
  if (!_pick) {
    const saved = ls((s) => s.getItem(PICK_KEY));
    _pick = CTRL_SCHEMES[saved] ? saved : deviceScheme();
  }
  return _pick;
}
export function usePad() { return ctrlScheme() === 'pad'; }
```

**改成**: `mobile.isTouchUI()`(mobile.js:33)= `usePad()` = `ctrlScheme() === 'pad'`,而 `ctrlScheme()` 在房主選「限定滑鼠鍵盤」時直接回 `'kbm'`(第 162 行早退)⇒ **真手機上 `body.touch-ui` 不會掛**,上一條那五條頁面級硬化整組消失:捏合縮放(iOS Safari 無視 `user-scalable=no`)、下拉刷新、長按選字、點擊藍色高亮全部回來,而遊戲照樣在跑、零錯誤訊息。裝置判定的唯一縫是同檔 `touchCapable()`(第 65 行,`maxTouchPoints > 0 || 'ontouchstart' in window`)—— 頁面級硬化 MUST 綁它,操控版型 MUST 綁 `usePad()`。這是**兩個不同的問題共用了一個旗標**,不是取捨。

### ⑧-5 真缺口①:根層缺 text-size-adjust
`public/css/style.css:52`

現行:
```js
* { box-sizing: border-box; margin: 0; padding: 0; }
html, body { height: 100%; }
```

**改成**: 補 `-webkit-text-size-adjust: 100%; text-size-adjust: 100%;`(掛在 `html` 或這個 `html, body` 規則上)。`grep -n 'text-size-adjust' public/css/style.css` 目前**零命中**。症狀:iOS 橫式會自動放大它認為「太小」的文字,而 HUD 下帶的 1/6 上限是 `game.fitHudBand()` 量**自然高**算出 `--hud-k` 的(A・座艙那一族的定案)⇒ 字被放大後量到的自然高變了,HUD 會在 iPhone 橫握時整條縮成另一個比例。既有的 `body.touch-ui input, select { font-size: 16px }`(style.css:2290)只擋住「聚焦時整頁放大」,擋不到這一條。

### C:會靜默漏掉本輪新模組的閘門(gInfo 消費端只掃頂層)
`tools/audit_cel_pipeline.mjs:313`

現行:
```js
  // `postfx.js` 是**具名例外**:它的全螢幕四邊形畫進單附件 RT 或畫布,從來不進場景。
  const EXEMPT = new Set(['postfx.js']);
  const dir = new URL('../public/js/', import.meta.url);
  const files = readdirSync(dir).filter((f) => f.endsWith('.js'));
```

**改成**: `readdirSync` **不遞迴** ⇒ 放在 `public/js/forge/**`(或本輪任何新子目錄)裡的 `new THREE.ShaderMaterial` **不會被掃到**,那道「忘了宣告 gInfo ⇒ 整批物件不畫、console 一個字都沒有」的閘就對它失效,而稽核照樣全綠。今天沒事只因為三支帶 ShaderMaterial 的檔(environment.js / postfx.js / vfx.js)剛好都在頂層。本輪 ⑨(隧道/橋樑改走新版 cel + MUST 宣告 gInfo)與「新模組」正是踩這一格的形狀 ⇒ 落地前 MUST 先把 `files` 改成遞迴(照 `audit_client_syntax.mjs:61-63` 那一份現成的 `listJs`)。這是**稽核端**的改動,不是遊戲行為改動。

### C:對照組 —— 名冊遞迴的正確寫法(㋖ 已經做對的那一支)
`tools/audit_client_syntax.mjs:61`

現行:
```js
const listJs = (rel) => readdirSync(join(ROOT, ...rel), { withFileTypes: true })
  .flatMap((d) => (d.isDirectory() ? listJs([...rel, d.name])
    : d.name.endsWith('.js') ? [[...rel.slice(2), d.name].join('/')] : []));
const FILES = listJs(['public', 'js']).sort();
```

**改成**: 不動 —— 引用它當上一條的實作範本。現況:掃到 216 項全綠(含 `forge/` 42 支)。㋖ 的觸發條件 = **動過任何 `public/js/**`**(含新增模組:名冊由目錄推導,新檔自動入閘),兩段守的是不同的東西:Ⅱ `node --check` 逐支解析(換 `.mjs` 副檔名才走 ES module),Ⅲ 抓「終止樣板字串的反引號落在 GLSL `//` 註解裡」—— 後者正是 `node --check` 全綠而管線在建構子丟 `.a is not a function` 的那一種。本輪動 toon.js/postfx.js/environment.js 的 GLSL ⇒ Ⅲ 是主要防線。

### C:audio.js 目前零離線防線
`public/js/audio.js:1`

現行:
```js
// ============ 戰場音效系統(唯一縫)============
// 純客戶端表現層 —— 伺服器/sim 不涉;bal/e2e 天然不受影響。
//
// 雙層架構(比照 models.js 的 MODEL_MANIFEST + 程序生成 fallback):
//   Layer 1 程序合成(Web Audio API 原生,零依賴/零下載/永遠可用)= 天然 fallback。
//   Layer 2 CC0 開源樣本(SFX_MANIFEST / BGM_MANIFEST):decode 成功則優先播,
```

**改成**: 不動,但要記帳:`grep -l audio.js tools/audit_*.mjs` **零命中**,`.claude/rules/*.md` 與根 CLAUDE.md 也**沒有任何一列**寫音效 ⇒ 動 audio.js 今天唯一會紅的只有 `audit_client_syntax`(語法),名冊/優先序/gain 推導全都沒有守門。計畫 ⑦ 的驗證欄已經指名要新增 `audit_audio_layers`(離線可驗)—— 本輪動 audio.js **MUST 與它同一輪落地**,否則 ⑦ 的四條全部只能靠耳朵驗。同時 SHOULD 在 `.claude/rules/seams-render.md`(或新開一節)補一列音效縫,把「⑦ 有實作但沒有規則列」這個洞補起來。

## 寫入檔案

## 步驟
1. 【C-0 先做,不需裁決】把 `audit_cel_pipeline.mjs:313` 的 `readdirSync` 改成遞迴(照抄 `audit_client_syntax.mjs:61-63` 的 `listJs`),並附反向驗證:往 `public/js/forge/forge.js` 注入一支不帶 `INK_INFO_DECL` 的 `new THREE.ShaderMaterial(` ⇒ Ⅵ 的「每一支都宣告了 gInfo」MUST 紅字(今天注入後仍是綠的,那就是這道閘對子目錄失效的證明)。本輪 ⑨ 與新模組落地**之前** MUST 先修這一格,否則後面每一次「全綠」都不算數。
2. 【B-1】`public/css/style.css:52-53` 的 `html, body { height: 100%; }` 補 `-webkit-text-size-adjust: 100%; text-size-adjust: 100%;`。純 CSS,零 JS。
3. 【B-2】新增「裝置有觸控硬體」的 body class(建議 `touch-dev`),判定唯一縫 = `ctrlmode.touchCapable()`,掛載點與 `installTouchUI()` 同一支(`public/js/mobile.js:235`),**MUST NOT** 在 mobile.js 或 CSS 再寫一份 `maxTouchPoints`/`pointer: coarse`(A21 家族的紀律)。
4. 【B-3】把 `public/css/style.css:1638-1642` 的 `overscroll-behavior`/`user-select`/`touch-callout`/`tap-highlight` 與第 1644 行 `body.touch-ui #game { touch-action: none; }` 五條的選擇器由 `body.touch-ui` 改成 `body.touch-dev`;`--tl-*` 控件變數、`.tl-*` 逐控件的 `touch-action: none`、安全區變數 `--tl-sl/sr/sb/st` **全部留在 `body.touch-ui`**(那是版型,不是裝置)。⚠ 這會改變行為:有觸控螢幕的桌機/筆電第一次吃到 `#game { touch-action: none }`(= 要的效果);純滑鼠桌機 `touchCapable()` 恆 false ⇒ 逐位元不變。
5. 【B-4】補離線稽核 —— 全 repo 目前**沒有任何一支**驗過 viewport meta / touch-action / safe-area(`grep -rn 'viewport-fit|touch-action|safe-area|overscroll' tools/*.mjs` 零命中)。落點選 `tools/audit_ctrl_mode.mjs`(它第 36 行已 `readSrc('public','index.html')`、第 200 行已 `readSrc('public','css','style.css')`),新增一節 Ⅹ:①viewport 含 `viewport-fit=cover`;②`-webkit-text-size-adjust` 存在;③五條頁面級硬化掛在裝置 class 之下、**且該 class 的判定只轉呼 `touchCapable()`**;④`.screen`/`.overlay-box` 那些捲動容器 MUST NOT 被 `touch-action: none` 蓋到(反向:根層寫死 = 大廳捲不動);⑤安全區變數仍在 `body.touch-ui`。樣式一律 CRLF 容忍(`\r?\n`),替換無效 MUST 當場 `process.exit(1)`(§5.4 ㋑)。
6. 【B-5】跑 B 的相鄰稽核:`audit_ctrl_mode` / `audit_touch_layout` / `audit_touch_gesture` / `audit_ui_layout` / `audit_client_syntax`,對照本輪基準 MUST **逐項不動**(`audit_touch_layout` 的 8/60 既有紅字 MUST 維持在 8,變多就是 B-3 動到版型)。
7. 【A 等裁決】把 seam 1~6 的數字整理成一頁交給使用者選 (甲)/(乙)/(丙)。裁決前 MUST NOT 動 `game.js:2903`、`game.js:480`、`tools/audit_gpu_lifecycle.mjs:124` 任何一格。裁決若是 (乙)/(丙),落地時把常數具名 + 同步改稽核斷言 + 補 `--break-dpr` 反向驗證。
8. 【C-1】本輪每一項落地之後,只跑該項的相鄰稽核(見 audits 欄的分組);**收尾 MUST 重跑全套**並與 `BASELINE.txt` 逐支比對 EXIT 與通過數 —— 那份基準是「是不是我弄壞的」的唯一依據。
9. 【C-2】序 3(①-1 `outlineContribution` 打包)落地時,計畫已載明的連帶:`public/js/postfx.js:310` 的 `minFilter/magFilter: THREE.LinearFilter` MUST 讓 `rtScene.texture[1]` 改成 `NearestFilter`。目前**沒有任何稽核**斷言 RT 的 filter(`grep -rn 'LinearFilter|NearestFilter' tools/audit_*.mjs` 只命中立面貼圖與 atlas 兩處無關的)⇒ 這一條 MUST 同輪在 `audit_cel_pipeline` Ⅵ 補一條原文斷言,否則它是「今天沒事只因為 `INK.THICK = 1.0` 剛好落在 texel 中心」的定時炸彈。
10. 【C-3】㋓ 未驗項的處理:`audit_cast_jump` / `audit_cockpit` / `audit_muzzle` 要 `SVS_URL` 指向**本工作區**新起的伺服器(8620 被 tailscaled 佔著、且常有別的 checkout);`audit_ground_drape` / `audit_traverse` / `audit_lane_scenarios` / `audit_lane_grade_sep` / 完整版 `audit_venue_biome` 要外網 Overpass。交付說明 MUST 逐項標註「已驗 / 未驗」,MUST NOT 把沙箱跳過當綠燈。

## 稽核
- `node tools/audit_ctrl_mode.mjs`
- `node tools/audit_touch_layout.mjs`
- `node tools/audit_touch_gesture.mjs`
- `node tools/audit_ui_layout.mjs`
- `node tools/audit_client_syntax.mjs`
- `node tools/audit_client_syntax.mjs --break-glsl`
- `node tools/audit_gpu_lifecycle.mjs`
- `node tools/audit_gpu_lifecycle.mjs --break-resgov-all`
- `node tools/audit_gpu_lifecycle.mjs --break-resgov-flip`
- `node tools/audit_gpu_lifecycle.mjs --break-resgov-hidden`
- `node tools/audit_cel_pipeline.mjs`
- `node tools/audit_cel_pipeline.mjs --break-inkinfo`
- `node tools/audit_cel_pipeline.mjs --break-land`
- `node tools/audit_cel_pipeline.mjs --break-lutland`
- `node tools/audit_cel_pipeline.mjs --break-scale`
- `node tools/audit_visual_prefs.mjs`
- `node tools/audit_soft_stroke.mjs`
- `node tools/audit_world_curve.mjs`
- `node tools/audit_daynight.mjs`
- `node tools/audit_damp_fps.mjs`
- `node tools/audit_damp_fps.mjs --break-damp`
- `node tools/audit_siteplan.mjs`
- `node tools/audit_beacons.mjs`
- `node tools/audit_object_joints.mjs --seeds 8`
- `node tools/audit_open_tunnel.mjs`
- `node tools/audit_underpass.mjs`
- `node tools/audit_layer_block.mjs`
- `node tools/audit_road_joint.mjs`
- `node tools/audit_road_bed.mjs`
- `node tools/audit_road_grid.mjs`
- `node tools/audit_bridge_crossing.mjs`
- `node tools/audit_bridge_tower_pad.mjs`
- `node tools/audit_water_skirt.mjs`
- `node tools/audit_world_text.mjs`
- `node tools/audit_vernacular.mjs`
- `node tools/audit_world_edge.mjs`
- `node tools/audit_world_height.mjs`
- `node tools/audit_terrain_ray.mjs`
- `node tools/audit_climb.mjs`
- `node tools/audit_mini_map.mjs`
- `node tools/audit_story_map.mjs`
- `node tools/audit_osm_relay.mjs`
- `node tools/audit_ground_tile.mjs`
- `node tools/audit_ground_seam.mjs`
- `node tools/audit_ground_enclave.mjs`
- `node tools/audit_ground_qc.mjs`
- `node tools/audit_ground_border.mjs`
- `node tools/audit_paper_doll.mjs`
- `node tools/audit_morph_rig.mjs`
- `node tools/audit_gait_anat.mjs`
- `node tools/audit_view_lock.mjs`
- `node tools/audit_spectator_cam.mjs`
- `node tools/audit_recoil_move.mjs`
- `node tools/audit_npc_collide.mjs`
- `node tools/audit_slope_move.mjs`
- `npm run audit:net`
- `node tools/audit_solo_boot.mjs`
- `npm run bal`
- `node server/server.js --port 8677  (§5.2:先確認 localhost:8620/8677 零 LISTENING)`
- `WS_URL=ws://localhost:8677 npm test`
- `SVS_URL=http://localhost:8677 node tools/audit_muzzle.mjs   (㋓)`
- `SVS_URL=http://localhost:8677 node tools/audit_cockpit.mjs  (㋓)`
- `SVS_URL=http://localhost:8677 node tools/audit_cast_jump.mjs (㋓)`
- `node tools/audit_ground_drape.mjs  (㋓ 需真瀏覽器)`
- `node tools/audit_traverse.mjs      (㋓ 需外網 Overpass)`
- `node tools/audit_venue_biome.mjs   (㋓ 需外網;--offline 版 CI 收得到)`
- `node tools/audit_lane_scenarios.mjs / node tools/audit_lane_grade_sep.mjs  (㋓ 需 tools/.osm_cache)`

## 反向驗證
- `(新)注入一支未宣告 gInfo 的 ShaderMaterial 到 public/js/forge/forge.js` — 壞版: 在子目錄裡放 `new THREE.ShaderMaterial({ fragmentShader: '...' })` 而不帶 `INK_INFO_DECL` ⇒ **MUST 紅**: `audit_cel_pipeline` Ⅵ 的「每一支都宣告了 gInfo」MUST 紅字。**今天它是綠的** —— 這就是 `readSrc` 名冊不遞迴的證明,C-0 修完之後這一條才會紅。修完 MUST 重跑一次確認真的紅。
- `--break-inkinfo(既有)` — 壞版: 把 vfx.js 的 `INK_INFO_DECL` 全部刪掉 ⇒ **MUST 紅**: `audit_cel_pipeline` Ⅵ 紅字(替換無效會當場 exit(1),不會假綠)
- `--break-glsl(既有)` — 壞版: 往 vfx.js `SHIELD_VERT` 的第一行 GLSL 註解注入一個反引號 ⇒ **MUST 紅**: `audit_client_syntax` Ⅱ 或 Ⅲ 對 vfx.js 紅字;錨點過期 MUST 當場丟例外
- `--break-damp(既有)` — 壞版: 把逼近權重寫回 `Math.min(1, k * dt)` ⇒ **MUST 紅**: `audit_damp_fps` 的互補性 / 可加性 / 幀率無關三條 MUST 紅
- `--break-resgov-all / --break-resgov-flip / --break-resgov-hidden(既有)` — 壞版: 調節器改回只在觸控啟用 / 拿掉震盪熄火 / 拿掉背景分頁不入帳 ⇒ **MUST 紅**: `audit_gpu_lifecycle` 對應三條各自紅字 —— ⑧-4 若落在 (丙)(動 `RES_GOV.MIN`),這三支 MUST 仍全部咬得住
- `--break-dpr(需新增;僅在 ⑧-4 裁決為 (乙)/(丙) 時才做)` — 壞版: 把 `_dpr()` 的回傳改成 `window.devicePixelRatio || 1`(拿掉天花板) ⇒ **MUST 紅**: `audit_gpu_lifecycle` ④ 的「像素比上限」與新增的「常數值 = 定案值」MUST 紅字。⚠ 斷言的期望值 MUST NOT 隨 `--break-*` 改變(§5.4 ㋑),否則 break 永遠是綠的
- `--break-viewport(需新增,B-4)` — 壞版: 從 index.html 原文字串中把 `, viewport-fit=cover` 移除 ⇒ **MUST 紅**: `audit_ctrl_mode` Ⅹ① MUST 紅;替換無效 MUST `process.exit(1)`
- `--break-touchact(需新增,B-4)` — 壞版: 把 `#game { touch-action: none; }` 那一行從 style.css 原文中移除 ⇒ **MUST 紅**: `audit_ctrl_mode` Ⅹ③ MUST 紅
- `--break-touchdev(需新增,B-4)` — 壞版: 把五條頁面級硬化的選擇器改回 `body.touch-ui`(即撤銷 B-3) ⇒ **MUST 紅**: `audit_ctrl_mode` Ⅹ③ 的「硬化 MUST 掛在裝置 class 之下」MUST 紅;同時 Ⅹ⑤(安全區仍在 `body.touch-ui`)MUST 維持綠 —— 兩欄同時對才代表這一輪真的把兩個旗標分開了
- `--break-textadj(需新增,B-4)` — 壞版: 移除 `text-size-adjust` 那一行 ⇒ **MUST 紅**: `audit_ctrl_mode` Ⅹ② MUST 紅

## 會靜默壞掉的地方
- 【⑧-4 的方向會被講反】參考專案的 1.15 是**在 `setPixelRatio(1)` 之上的 RT 縮放**,本專案的 2 是**裝置像素比的上限** —— 兩個不同的量。在 dpr=1 的一般桌機螢幕上,參考專案畫 1.15×、本專案畫 1.00×:「跟進」在那一類機器上是**加成本**。若把裁決簡化成「2 太高、改 1.15」,dpr=1 的多數桌機玩家什麼都感覺不到、而 HiDPI 玩家畫質掉 3.02×,兩邊都不是原意。
- 【⑧-4 的畫質代價沒有離線量尺】桌機 MSAA 在 post 開啟時是關的(game.js:671)⇒ DPR 是唯一的空間抗鋸齒來源,而勾線是 1px 螢幕空間的 pass(`INK.THICK = 1.0`)。降 DPR 會讓墨線相對變粗變抖,**沒有任何離線稽核量得到**,只有 `shot_scene` 前後對照 + 真機看得出來。FPV 遠距瞄準辨識同理(`RES_GOV.MIN = 0.7` 的註解就是為這件事訂的)。
- 【gInfo 閘門對子目錄失效】`audit_cel_pipeline.mjs:313` 的 `readdirSync` 不遞迴。本輪 ⑨ 要求隧道/橋樑的自寫材質宣告 gInfo、又要新增模組 —— 只要那支材質住在 `public/js/` 的任何子目錄,漏宣告的代價是 **WebGL2 `INVALID_OPERATION` ⇒ 整批物件不畫、console 一個字都沒有**,而稽核全綠。這是本輪最可能發生的靜默失敗。
- 【`_mkRT` 的 LinearFilter】兩張附件都是 `LinearFilter`(postfx.js:310)。序 3 把類別碼與貢獻打包進 `gInfo.a` 之後,只要有人動 `INK.THICK` 讓取樣偏移不再是整數 texel,線性內插就會把相鄰的 `q` 混成一個**不存在的類別** ⇒ 勾線與 LUT 兩個消費端同時讀錯,而畫面上只表現成「有些地方線怪怪的」。目前零稽核守這一格。
- 【動 biomes.js / terrain.js / ground.js 會推移共享 rnd 序列】只要新增的世界內容多抽或少抽一枚共享 `rnd()`,後面每一株植被、每一棟建物的佈局整條推移,畫面上只表現成「整張圖變了」,沒有任何錯誤訊息(§2.3 / A4)。`audit_siteplan` / `audit_beacons` / `audit_object_joints --seeds 8` 會全綠(它們驗的是規則不是位置)⇒ 判準只能是「這些稽核**逐項不變**」而不是「仍然全綠」。
- 【純表現層漏進權威側】本輪列的檔案裡 `data.js` 與 `sim.js` **一行都不該動**。一旦動了,`npm run bal` / `npm test`「逐項不動」這條驗收就失效,而 ⑨ 的 `audit_open_tunnel` / `audit_underpass` / `audit_layer_block` / `audit_road_joint` / `audit_road_bed` / `audit_bridge_*` / `audit_traverse` 任何一支變紅 = 視覺改動漏進了幾何(計畫 ⑨ 明文)。
- 【跑全套稽核有副作用】`audit_net_modes`(= `npm run audit:net`)⑦ 段會**真的 spawn 每一支 dev 工具**,包含 `tools/ai3d/harvest_loop.mjs --rounds 0`(永不結束的照片採集迴圈,會連外網下載)與它的子行程 `fetch_photos.mjs`,另外還會起一個 `--lan --https --port <random>` 伺服器。本輪實測跑完之後這些子行程一度仍在跑。跑完全套 MUST 回頭 `Get-Process node` 看有沒有孤兒,否則下一次 §5.2 的埠檢查會讀到誤導的結果。
- 【本機此刻有第三方 node 行程】量基準期間偵測到**不是我起的** `server/server.js --port 8647` + `npm test` + `node test/e2e.mjs`(另一個 session 或使用者自己在跑)。8620 上 LISTENING 的是 `tailscaled.exe`(只綁 tailnet IP,localhost:8620 是空的)。⇒ 下一輪跑 `npm test` MUST 自己指定埠並用 `WS_URL` 指過去,MUST NOT 假設 8620 上那一份是本 checkout。
- 【㋓ 的稽核在沙箱裡會用「跳過」偽裝成綠】`audit_lane_grade_sep` / `audit_lane_scenarios` 在無 `tools/.osm_cache` 時印「無快取,跳過」;`audit_traverse` 取不到路網會自動降級成地形層並標示未驗。這些**不是綠燈**,交付說明 MUST 逐項標註。
- 【audio.js 沒有任何防線】動 `audio.js` 今天唯一會紅的是語法閘。⑦ 的四條(區域環境音名冊/優先序、gain-ride 常駐 stem、多 take 抖動、低記憶體階梯)全部無守門 ⇒ MUST 與 `audit_audio_layers` 同輪落地,否則下一輪沒有人知道它有沒有被改壞。

## 逐位元中性

"本項(唯讀盤點)沒有任何檔案改動 ⇒ 逐位元中性是恆真的;證明 = `git status` 全程 clean、`files` 欄為空。接下來各子項的逐位元性質分別是:【⑧-4】旋鈕就是 `_dpr()` 的天花板本身,沒有「關著」的狀態 —— (甲) 不動 = 逐位元同現況;(乙) 在 `devicePixelRatio ≤ 1.15` 的螢幕上逐位元同現況(`min(1, 1.15) = 1`),在 1.25/1.5/2/3 上**明知會變**,MUST 先拍 `shot_scene` 基準(與序 12 同一條紀律);(丙) 只動 `RES_GOV.MIN`,而升階分支在 `_resScale < 1` 才進得去 ⇒ 撐得住的機器一次 `setPixelRatio` 都不會打 = **逐位元同現況**,只有本來就已經降階的機器才走得更低。【⑧-5】B-1(text-size-adjust)在桌機與 Android 上是 no-op、在 iOS 橫式上是「不再被瀏覽器改字級」= 回到 CSS 宣告值;B-2/B-3(改綁 `touchCapable()`)在**純滑鼠桌機**上逐位元不變(`touchCapable()` 恆 false),在觸控裝置上是**刻意的行為改變**(房主鎖鍵鼠時頁面級硬化不再消失)。三者都不碰 `data.js`/`sim.js`/伺服器 ⇒ `npm run bal` / `npm test` MUST 逐項不動,動了就是漏到權威側。【C-0 / C-2 的稽核端改動】只動 `tools/**`,遊戲一行不改 ⇒ `npm run bal` / `npm test` / 其餘稽核 MUST 逐項不變;唯一預期的變化是 `audit_cel_pipeline` 的掃描件數(scanned)會從只算頂層變成含子目錄。"

## 卡在
- 【⑧-4 需使用者裁決,MUST NOT 自行決定】(甲)維持桌機天花板 2 —— HiDPI 保持滿檔畫質,代價是 dpr=2 螢幕每幀 8.29Mpx(1080p CSS)、221MB RT;(乙)照參考專案改成 `dpr≤2 ? min(dpr,1.15) : min(dpr,1.5)` —— dpr=2 省 66.9% 像素與 148MB,代價是失去桌機唯一的空間抗鋸齒來源(MSAA 已關)、1px 墨線變粗變抖、FPV 遠距辨識變差,且 dpr=1 螢幕完全不受影響(所以省不到那一群人);(丙)天花板不動,把 `RES_GOV.MIN` 由 0.7 降到 0.575 讓 1.15 變成「量到撐不住才去的地板」而非所有人的天花板 —— 撐得住的機器逐位元同現況,但 dpr=1 螢幕的地板會掉到 0.575(明顯糊)⇒ 地板 SHOULD 改寫成推導的「有效像素比下限」而不是固定倍率,這一層要不要做也要一起裁。
- 【⑧-5 的一個可選項需使用者定案】viewport 是否加 `interactive-widget=resizes-content`(大廳 5 個文字輸入 + `.screen` 是 `position: fixed`,Android 軟鍵盤預設 `resizes-visual` 可能蓋住輸入框)。這是新增行為不是缺陷修補,未定案前不動。⚠ 另一半(B-1/B-2/B-3)我判定是**缺陷**不是取捨(硬化綁在房間設定上,房主一鎖鍵鼠真手機就整組失去保護),但既然它會改變觸控裝置上的行為,仍建議在交付說明裡明講一句讓使用者有機會否決。
- 【㋓ 未驗 / 需外部條件】(a)`audit_ground_drape` 需真瀏覽器;(b)`audit_traverse` / `audit_venue_biome`(完整版)/ `audit_lane_scenarios` / `audit_lane_grade_sep` 需外網 Overpass 或 `tools/.osm_cache`;(c)`audit_muzzle` / `audit_cockpit` / `audit_cast_jump` 需 `SVS_URL` 指向本工作區新起的伺服器 —— 本輪我已用 `--port 8677` 起了一台並把這三支跑成 **32/32、全數合規、32/32 全綠**;(d)`shot_scene` / `shot_facades` / `shot_borders` / `shot_morph` 這一批膠片需真 GPU。
- 【本輪改動前基準已落盤,請下一輪直接引用】彙總表 `C:\Users\user\AppData\Local\Temp\claude\C--Users-user-Documents-app-steel-vs-swarm\c1a94433-3e6a-489c-b725-7c742b5042a5\scratchpad\BASELINE.txt`;逐支原始輸出 `.../scratchpad/log_audit_<name>.txt`;`npm run bal` 全文 `.../scratchpad/bal.txt`;`npm test` 全文 `.../scratchpad/e2e.txt`。基準摘要:**離線稽核 79 支中 72 支 EXIT=0**(合計數千條斷言全綠,含 audit_client_syntax 216、audit_siteplan 265、audit_weapon_gate 436、audit_ui_layout 471);**`npm run bal` 🎉 平衡稽核通過**(①②④⑤⑥⑦ 全綠,③ 已退場不判定);**`npm test` 🎉 全部通過**(624 個 ✅,對本 checkout 新起的 `ws://localhost:8677`,符合 §5.2)。
- 【7 支非綠的歸因(全部與本輪無關,MUST 當作既有基準)】① `audit_touch_layout` EXIT=1 —— **8/60 組版型有問題,全部是 667×375 橫式的「重疊 A×stick」**(drone/mech/morph/spec × 左右手),與記憶中的既有紅字一致;② `audit_traverse` EXIT=1 —— 91 通過 / 18 失敗(橋下淨空 civicblvd 0.45m・roppongi 0.45m×2・shibuya 0.45m/0.84m×2・giza 1.85/2.64/3.51m・london 3.87m;可達性 chicago/civicblvd/london/paris/roppongi/shibuya/taroko/yosemite 的「橋面中段・地下道引道」),與記憶中的四類稽核端成因同族、且逐次會因 Overpass 命中率不同而變動(這次拿到 28 個場地的資料);③④ `audit_lane_grade_sep` / `audit_lane_scenarios` EXIT=1 —— 前者多數場地印「無快取,跳過」+ civicblvd 的既有側面進入,後者是 `venues.js` 的 scen/relief 標記與實測不符 3 筆(civicblvd/london/crimea),兩支都吃外網;⑤⑥⑦ `audit_cast_jump` / `audit_cockpit` / `audit_muzzle` EXIT=1 —— **只是 `ERR_CONNECTION_REFUSED at http://localhost:8620/`**(8620 上是 tailscaled),帶 `SVS_URL=http://localhost:8677` 重跑三支全綠。⇒ 本輪落地後這 7 支的「紅」內容 MUST 逐字相同,多一條就是新壞的。
- 【給總控的相鄰稽核表(改了 X ⇒ MUST 跑 Y;由 `readSrc` 消費端實測 + §5.4 ㋔ 推導)】**toon.js** ⇒ cel_pipeline(±break-scale/inkinfo/land/lutland)・visual_prefs・soft_stroke・world_curve・gpu_lifecycle・daynight・paper_doll・morph_rig・client_syntax(㋖)・audit:net + solo_boot(若 import 變動)+ 真 GPU A/B(㋓)。**postfx.js** ⇒ cel_pipeline・visual_prefs・soft_stroke・gpu_lifecycle ⑦・client_syntax(㋖)・daynight + 真 GPU A/B(㋓)。**biomes.js** ⇒ siteplan・beacons・open_tunnel・underpass・road_joint・road_bed・road_grid・world_text・vernacular・object_joints --seeds 8・climb・layer_block・mini_map・story_map・osm_relay・water_skirt・bridge_crossing・bridge_tower_pad・world_curve・world_edge・world_height・cel_pipeline・soft_stroke・visual_prefs・venue_biome + traverse/ground_drape/lane_scenarios(㋓)。**terrain.js** ⇒ 上列 + terrain_ray・ground_tile・cel_pipeline・world_curve・world_edge・gpu_lifecycle。**ground.js** ⇒ ground_tile・ground_seam・ground_enclave・ground_qc・ground_border・cel_pipeline・soft_stroke・daynight・mini_map・road_grid・vernacular・world_edge + ground_drape(㋓)+ siteplan/beacons/object_joints(rnd 序列 MUST 逐位元不動)。**audio.js** ⇒ 今天只有 client_syntax(㋖);MUST 同輪新增 `audit_audio_layers`。**任何新模組** ⇒ client_syntax(名冊遞迴,自動入閘)+ `npm run audit:net`(URL 佈局鏡射 / 瀏覽器可執行)+ audit_solo_boot(data.js 單一模組實例)+ 若帶 ShaderMaterial 則 cel_pipeline Ⅵ(**但要先做 C-0 讓它掃得到子目錄**)。
