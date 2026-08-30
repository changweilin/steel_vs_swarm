# tools/ai3d — AI 3D 資產管線的離線工具

> 計畫與階段閘門:[`docs/ai3d_runbook.md`](../../docs/ai3d_runbook.md);
> **後續執行狀態與工作佇列:[`docs/ai3d_runbook.md`](../../docs/ai3d_runbook.md)**(agent 可讀,英文)。
> 本目錄**不進 `package.json`、不進任何 build step**(CLAUDE.md A2)。全部只吃 Node 內建模組。

已落地:**§5「2D 圖片生成」**、**P1(`public/js/partlib.js` 縫 + beacons 接線,2026-08-05)**、
**§4.1 照片庫抓取器(`fetch_photos.mjs`)**。P0(Python 模型環境)、P2/P3(image→3D 本體)
尚未開始;方法分工定案見計畫書 **§8 附錄 A**(規則幾何走 LLM 寫純資料零件、有機幾何走
image→3D GLB、小植被維持程序生成)。

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
| `direct_ingest_all.mjs` | **v5 多面體幾何引擎**:獨立多面體純資料零件合成 (無關照片、零二進位負擔) |
| `direct_ingest_v6.mjs` | **v6 照片重建引擎**:YOLO26 實例分割與深度證據 + LLM 多模態多面體重建 |
| `object_classification_policy.mjs` | **功能分類唯一縫**：物件用途、現實零件角色、拆件與配色/零件替換資格；外觀相似度不得授權替換 |
| `object_classifications/*.json` | GPT-5.6 Luna max 對直屬未分類照片逐張產出的功能分類與缺失拆件帳 |
| `object_classification_inventory.mjs` | 把 corpus + 母照片 + YOLO26 schema-v2 證據綁成同一穩定列；`npm run classify:objects` 產生清單 |
| `audit_object_classification.mjs` | 母照片覆蓋、YOLO26 同列配對與功能替換正反例；`npm run audit:classification` |
| `audit_object_interchangeability.mjs` | Luna 跨物件功能、零件介面與語意配色群稽核；`npm run audit:interchange` |
| `fetch_photos.mjs` | **照片庫抓取器**(Track B §4.1):逐族查詢型錄、可續跑補缺、CC0 雙重硬閘、記帳。沙箱代理連不到 Openverse/Commons(㋓)⇒ 在 3060 真機或 Actions 上跑 |
| `photo_manifest.json` | 照片帳本(產出後自動生成):`{source_url, license, creator, retrieved_at, …}` 一項不少 |
| `photos/{family}/{part}/` | 照片本體(**勿入版控** —— 照片只是離線輸入,入庫的只有零件 GLB) |
| `inbox/{family}/{part}/` | **自己放圖的地方**(2026-08-10 使用者定案):丟圖進去 + 同一層一個 `sources.json` 記授權,`fetch_photos.mjs --adopt` 收編成正式語料。授權硬閘不因為是手動放的就鬆(只收 CC0/PD),短邊 <1024 或非影像位元組一律不收、原檔留著。`--inbox` 印格式與路徑 |
| `harvest_loop.mjs` | **週期採集迴圈**:不同分類的去背 / 分離 / 篩選以 `--category-jobs` 平行；同一張 GPU 維持單通道。模型由 `pipeline_policy.mjs` 分流(T2-spz 建築 / Hunyuan 2GP 巨岩 / SF3D 雕塑樹 / Route A 規則物)，再自動入庫與收尾稽核。`--no-intake` 停在 contact sheet |
| `pipeline_policy.mjs` | 最新 SKILL 的分類路由唯一表；規則人造物只產純資料零件，MUST NOT 烤成整件 GLB |
| `replacement_plan.mjs` | 列出 2026-08-15 前生成物的逐件替代佇列；輪替名冊標成「自動換槽」，固定槽標成「人工配方」 |
| `index_restricted_photos.mjs` | 把外部 `shipping:false` 語料家的未建檔照片補入帳本；只准非出貨家，授權保持 `unverified(restricted corpus)` |
| `manifest_store.py` | 分類 worker 的跨行程鎖 + 原子合併；避免平行回寫 `photo_manifest.json` 互相覆蓋 |
| `harvest_log.jsonl` / `harvest_state.json` | 迴圈的帳(每輪收編/下載/生成/入庫/回滾幾筆)與「哪些 matte 送過 img→3D」|
| `<產出目錄>/.feed.json` | **投料帳**(生成當下寫):`index → 母照片 id / 目標 id / 族 / 工具 / 參數`。第 ⑦ 站的入場券 —— 沒有它就不入庫(規則 9)。它同時補掉 `tri_budget.json resample_2026_08_08` 記著的那個洞:只記照片與 fit 的話,同一張圖配同一組參數**復現不出**已出貨的那一顆 |
| `intake_recipes.mjs` | **自動入庫配方的唯一縫**:可自動追加的名冊格由「值是陣列」**推導**(MEGA_LIB.block / BLD_LIB.mass / .masslow),**只有兩欄是手寫的**(縮放目標 `fit` 與 T2 的實體化預設);包絡、三角形上限、UV 契約、下一個節點名一律推導 |
| `auto_intake.mjs` | **第 ⑦⑧ 站**:normalize(T2 先實體化)→ intake 閘 → 破口閘 → 名冊錨定追加 + 重新執行真品原文驗證 → 來源帳 → 逐顆快閘;`--gate-full` 收尾跑相鄰稽核 + `npm run bal`。**任一步紅字整批回滾,逐位元**(GLB / biomes.js / 來源帳三份一起)。**從不 commit** |
| `apply_verdicts.mjs` | **第 ⑨ 站**:執行人眼判決；`⇢ replace` 只讀新件來源帳的 `replaces`，通過後撤下舊件並以 `replaced_by` 墓碑移入封存區。其餘為 regen / reimg / archive / purge；撤到名冊剩 1 顆會停下來要 `--force` |
| `intake_overrides.json` | 判 `⟳ 重生` 之後要換的參數(鍵 = 母照片 id;`cells` / `offset` / `target` / `fit` / `tool`)。第 ⑦ 站與第 ⑨ 站同吃這一份 |
| `photo_state.mjs` | **圖檔三態的唯一推導縫**(未處理 / 已處理 / 需修正 + 已淘汰)。**零新狀態檔** —— 全部由既有四本帳推導(照片帳本 / `harvest_state` / 來源帳 / 對照台判決);分支順序 `需修正 > 已淘汰 > 已處理 > 未處理` 本身就是語意 |
| `audit_auto_intake.mjs` | 上面整條的稽核；包含分類平行、帳本合併鎖、替代封存與順位。新增反向驗證 `--break-parallel` / `--break-replace`，其餘旗標看檔頭 |

Hunyuan 不猜官方 checkout 的 entrypoint。`--hunyuan <adapter>` 接受一支依該版本 README 寫的外部
adapter，固定契約為 `<adapter> <images...> --output-dir <dir>`；輸出可用 `<index>/mesh.glb` 或
`<target-id>.glb`。未提供時巨岩保留在候選池，不會暗中用 SF3D 冒充新版替代物。

**在零件台上開關採集迴圈**(2026-08-10):`npm run parts` 頂上那一條窄帶有「▶ 啟動採集迴圈 / ⏹ 停止」
與四個狀態鈕(按下去展開那一態是哪幾張圖、下一步是什麼)。啟停走 `tools/dev_supervisor.mjs` 那一支
`handle`(全專案唯一「HTTP → spawn」的閘門;零件台**自己不 spawn**),資料家由
`provenance.corpusHome()` 推導 —— 要指定別的一律回終端機帶 `--home` 跑。
迴圈是 `kind: 'job'`:它不聽任何埠,所以「有沒有在跑」問的是**這個台子自己開的那支子行程**
(終端機起的那一支這裡看不到,也不會被停掉)。

**還沒轉 3D 的語料圖也在台上**(2026-08-10 §5ay):狀態鈕切換的是**左側清單的內容** ——
按「未處理 24」整欄換成那 24 張圖,點一張看母照片與**切出來的每一個目標**(目標才是真的
餵進生成器的那張),下面三顆鈕做手動篩選(`✔ 保留` / `✕ 淘汰` / `🗑 刪除來源圖`),
一律轉呼 `screen_mattes.py` —— 判決紀律(人眼恆勝、roll_up、黑名單)住那一支,台上只是按鈕。

**「原版 vs 生成」只並排同源的新舊版本**:`baseline-vs-now`(同一份零件表改寫前/後)保留兩側;
img→3D 的節點**單獨陳列**並標注繪製方法 —— 保險絲 primitive 是載入失敗時的降級幾何,
不是它的前一版。保險絲群組仍然會建,但只當「換掉的是哪幾顆 mesh」的取景索引。

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
