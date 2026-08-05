# tools/ai3d — AI 3D 資產管線的離線工具

> 計畫與階段閘門:[`docs/ai3d_asset_plan.md`](../../docs/ai3d_asset_plan.md)。
> 本目錄**不進 `package.json`、不進任何 build step**(CLAUDE.md A2)。全部只吃 Node 內建模組。

目前只落地了 **§5「2D 圖片生成」** 那一段。P0(Python 模型環境)、P1(`partlib.js` 縫)、
P2/P3(image→3D)尚未開始。

---

## 檔案

| 檔 | 職責 |
|---|---|
| `slots.mjs` | **工作清單的唯一縫**:缺哪些設定稿(掃圖檔)+ 每隻要切幾張圖(掃 `models.js` 的 rig 登記區塊) |
| `prompt.mjs` | **提示詞唯一縫**:九條規則(§5.2)+ 設定稿樣板 + 逐槽位 `/edit` 樣板 |
| `gen2d.mjs` | 驅動:呼叫 `agy --print`、收圖、記帳、可續跑 |
| `gen_manifest.json` | 帳本(產出後自動生成):每一張的 prompt / 來源 / 位元組數 / 時間 |
| `masters/` | 新畫的設定稿(驗收通過後才搬進 `public/assets/cyberpunk_art/mechs/`) |
| `drafts/{ch}/{slot}.jpg` | 逐槽位切圖 = image→3D 的輸入 |

---

## 畫完之後在哪裡驗收

`masters/` 那一層**刻意不進版控**(見 `.gitignore`)—— 它是「畫好了但還沒人看過」的暫存層。
驗收在 **2D 生圖對照台**上做:

```bash
npm run codex          # = node tools/codex_review.mjs,起 dev server(:8621)
npm run codex -- --report   # 不開瀏覽器,直接印配對表
```

(遊戲的設定頁最下方有一列「▎開發工具(本機)」可以直接按「▶ 啟動 / ⏹ 停止」,不必回終端機;
後端是 `tools/dev_supervisor.mjs`,只回應本機來的請求,遊戲伺服器一關它開的那支也跟著收掉。)

那座台子把 `masters/` 與已入庫的 `public/assets/cyberpunk_art/mechs/` **收在同一個配對表裡**
(配對規則同一條:檔名去副檔名 = slot),AI 稿標成藍色虛線框的「AI 稿」、計數也分開列 ——
合併就等於把「這一格還沒有正式圖」藏起來。逐張確認勾選 / 框出要局部重繪的地方 / 重下 prompt,
通過的再**搬**進 `public/assets/cyberpunk_art/mechs/`(那一層才進版控;是搬不是複製 ——
留一份在 `masters/` 就是同一張圖同時掛在兩個來源上)。

**機體換過手的稿會變成孤兒**:2026-08-04 那批的 `s12_ground_static` / `s12_flight_static`
畫的是 s12 還是變形者時的那台機體,而那台後來整組搬去 s03 ⇒ 檔名對不上任何一格。
覆核台會把這種檔列在孤兒區,可以直接**指派**到正確的一格而不必改檔名;那兩張入庫時
則直接改名成 `s03_ground_static` / `s03_flight_static`(入庫層的檔名 MUST 對應**現在**的角色)。

**入庫層兩種副檔名都收**(`.png` + `.jpg`):早期那 61 張是 `.png`,agy 產的一律 `.jpg`
(見下方「已知限制 1」—— 轉成 `.png` 只是把 JPEG 壓縮雜訊包進無損容器)。
`slots.mjs MASTER_EXT` 與覆核台的 `SOURCES[].ext` 同吃這條規則;只認 `.png` 的話,
已經入庫的那批會被 `missingMasters()` 判成「還沒畫」而重畫一次,額度就這樣燒掉。

---

## 兩支稽核

| 稽核 | 問什麼 | 紅字代表 |
|---|---|---|
| `slots.auditCoverage()` | `models.js` 的每個 rig 幾何節點都有繪圖槽位涵蓋嗎 | 有零件沒人畫,或畫了掛不上去的零件 |
| `prompt.auditLexicon()` | 32 名角色的每個 visual 描述子代碼都有設計定義嗎 | 原始代碼(如 `levi`)會直接漏進提示詞,模型自己編一個 |

第二支是 2026-08-04 使用者回報「巨象應該變巨鯨,不應該混昆蟲特徵」之後補的。
根因不是模型笨,是提示詞把 `flight: "levi"` 這四個字母原樣送出去 —— 而 `levi` 的定義
(利維坦**飛鯨**)明明就寫在 `models.js buildMorphMech` 的檔頭註解裡。詞表把那份註解
翻成設計語義,並對容易被拉偏的項目加**負面約束**(飛鯨那條明寫「MUST NOT 有任何昆蟲特徵」)。

同一次還修掉一個助攻項:陣營語彙原本把 SWARM 寫成 "insectile",而 SWARM 底下有機械巨象、
人馬、克蘇魯 —— 體型的真相住 `creature`/`flight`/`ground`/`proto`,陣營那一行再插形態
暗示,兩個訊號就會打架。陣營現在只講戰術教條與工藝質感。

## 為什麼槽位表是推導的

槽位的真相住 `public/js/models.js` 的 rig 登記區塊(skill `mech-part-forge` §1:
「models.js source is authoritative」)。`slots.mjs` 因此**掃原文**取出每個 builder 的
rig 節點,再由 `DRAW_SLOTS` 把節點分組成「一張圖畫什麼」,並以 `auditCoverage()`
反查**每個幾何節點都恰好被一個繪圖槽位涵蓋**。

抄一份槽位表的話,`models.js` 新增一個 rig 節點時這裡不會報錯 —— 只會少畫一張圖,
而症狀要到組裝完才看得出來「這隻少一個零件」。

```bash
node -e "import('./tools/ai3d/slots.mjs').then(m=>console.log(m.auditCoverage()))"
# → []  即全部涵蓋;非空 = models.js 動過,MUST 先分類新節點再繼續畫
```

推導結果(2026-08-04):**32 隻機體 / 238 張切圖 / 18 張缺漏設定稿 = 256 張**
(計畫 §5.0.2 的估計是 ~280;差額來自鏡射收斂逐隻實算而非取平均)。

> 設定稿那 18 張在 2026-08-03~04 分三批畫完(中間被 429 額度打斷兩次),
> 2026-08-04 全數收進 `masters/`,同日入庫到 `public/assets/cyberpunk_art/mechs/`
> (`s12_*` 那兩張改名為 `s03_*`,見上)⇒ 現在缺的設定稿只剩 **s12 一張**(那一格 2026-08-04
> 從變形者換成鴨翼長航偵察機,是一台全新的機體,還沒畫過)。**帳本當時漏了兩筆**
> (`t11_flight_static` / `m05_flight_static`
> —— 額度中斷那兩張畫出來了但沒記進去),另有一筆(`m05_ground_static`)記到**別段對話**的
> 產出上(`newestNew()` 在多段對話交錯時會抓錯),已一併更正並在該筆的 `note` 欄註明。
> 帳本的 `out` 欄從此記**相對於儲存庫根**的路徑:絕對路徑會綁死在產出當下那個 worktree 上,
> worktree 一收掉,帳本裡每一筆就全部指向不存在的地方。

---

## 用法

```bash
node tools/ai3d/gen2d.mjs --audit             # 只跑兩支稽核
node tools/ai3d/gen2d.mjs --plan              # 只印清單,不呼叫 agy、不花額度
node tools/ai3d/gen2d.mjs --plan --masters    # 缺哪些設定稿
node tools/ai3d/gen2d.mjs --masters --limit 4 # 畫 4 張設定稿
node tools/ai3d/gen2d.mjs --kind robot --limit 5   # 機甲切圖(§5.0.1 順序:robot → drone → morph)
node tools/ai3d/gen2d.mjs --only t01          # 單一角色
node tools/ai3d/gen2d.mjs --redo t01/leg      # 重畫某一張(§5.0.2 規則 2:只重試切壞的)
node tools/ai3d/gen2d.mjs --masters --redo s10     # 重畫整隻;變形者兩型態會在同一段對話裡一起重畫
```

**兩支稽核每次執行都會先跑**,紅字就中止 —— 它們紅字代表提示詞本身是錯的,
而那種錯要到看圖(或更晚,組裝時)才發現,那時額度已經花掉了。

**可續跑**:產出存在就跳過。額度用盡是常態(§5.0 ⚠ Antigravity 影像額度 2026-02 收緊),
中斷後直接重跑即可,已完成的不會重畫。

---

## 前置:agy 需要讀檔權限

逐槽位切圖要把設定稿當參考圖(§5.2 的 `{REF}`),`agy` 因此需要 `read_file` 權限。
headless 模式無法互動詢問 ⇒ MUST 事先在 `~/.gemini/antigravity-cli/settings.json` 加**唯讀**規則:

```json
{
  "permissions": {
    "allow": ["read_file(C:\\Users\\user\\Documents\\app\\steel_vs_swarm\\**)"]
  }
}
```

沒有這條規則時,`gen2d.mjs` 會跳過所有需要參考圖的工作項。`--no-ref` 可強制改走
純文字提示(`slotPromptNoRef`),但剪影與設定稿的一致性會明顯變差 ——
**這是降級路徑,MUST 在交付說明中標註哪幾張是這樣畫的。**

### ⚠ 2026-08-05 實測:agy 1.1.10 已不吃這條規則

上面那段是 agy 1.0.2 的作法。**1.1.10 headless 模式下它完全沒有作用** —— 逐一試過
反斜線 glob、正斜線 glob、完整絕對檔名、`read_file(*…*)` 四種寫法,以及 `--add-dir`,
一律仍回 `auto-denied`。唯一有效的是 `--dangerously-skip-permissions`,但它會**連
`edit_file` 與 `command` 一起放行** —— 為了一張參考圖,把儲存庫的寫入與執行權交給一個
headless agent,不划算。

⇒ **設定稿一律當作「讀不到任何檔案」來設計**(`--masters` 預設不帶參考圖;要試新版
agy 時加 `--ref` 開回來)。同一台機體的多張圖靠這兩件事保持一致:

1. **提示詞裡的設計敘述**(`codex.js` 從 `mecha.js` 組出來的原型層 + 剪影/量體/材質/分件/
   生成注意)—— 這才是真正的錨。實測 `s07_heavy` 是在讀檔被拒的情況下生出來的,
   仍與 `s07_static` 是同一台機器。
2. **`agy -c` 同一段對話**(`gen2d.mjs` 在沒有錨時自動走這條)。

設定稿本身(`--masters`)是新設計,本來就不需要參考圖 ⇒ 不受此限。

---

## 已知限制(交付時 MUST 標註)

1. **輸出是 JPEG,不是 PNG。** `agy` 的 `generate_image` 只出 `.jpg`,明確要求 PNG 也一樣
   (已實測兩次)。這裡刻意**保留 `.jpg` 副檔名** —— 轉成 `.png` 只是把 JPEG 壓縮雜訊包進
   無損容器,反而讓 §5.3 的 matte 步驟誤以為邊緣是乾淨的。
   ⇒ **§5.3 步驟 2(檢查 alpha 邊緣)在本管線是必做,不是選做。**
2. **解析度剛好 1024×1024**,是 §5.2 規則 9 的**下限**而非餘裕;refine 模式想要的 2048 拿不到。
3. **變形者的「同一組零件」約束(§5.0.1 MUST 1)靠 prompt 表達,不是靠工具保證。**
   切圖一律取地面型態當參考(`gen2d.mjs` 選 ref 時優先 `_ground_`),飛行型態設定稿
   只用於驗收;工具無法檢查「這個零件在飛行型態也讀得通」—— 那是 P4c 的人工驗收項。
   **首批實測的具體限制**:飛行稿會把飛行面展開(翼/鰭/尾桁/鞘翅),但**不會把肢體收折** ——
   s10 的飛鯨仍站在四條象腿上、t06 的無人機仍四肢著地,而 `uav` 的定義是「腿外張成雙尾桁」。
   對驗收用途仍可用(兩張圖裡每個零件都看得見、對得起來),但「這條腿收進去像不像引擎艙」
   這一項這批圖答不了。真正的變形是 `makePoser` 拿**同一組 `p.g`** 在 `p.a`/`p.b` 之間插值,
   那是程式在做的事。
4. **設定稿畫風與切圖畫風刻意不同**:設定稿對齊現有 46 張(綠幕 + 粗黑描邊 + 賽璐璐),
   切圖吃九條規則(灰底 + 全不透明 + 平光 + 無描邊)。混用會在 3D 階段付代價。
