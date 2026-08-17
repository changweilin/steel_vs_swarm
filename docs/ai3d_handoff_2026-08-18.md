# img→3D 採集與舊件替代 — 下一對話執行計畫（2026-08-18）

## 0. 交接目標

把兩個照片資料家送進已完成的分類採集管線，建立可覆核的零件候選；正式語料的新件逐一替代
`2026-08-15` 前生成物，舊件經人眼確認後移入零件台封存區。restricted 語料只做到 contact
sheet，除非授權逐張清除，否則永不入庫。

本計畫的程式碼基線是 commit `0687270`（`Add parallel AI 3D intake routing and replacement workflow`）。
交接時預期只有本檔與 `docs/ai3d_runbook.md` 的交接連結尚未提交；若另有檔案變更，先視為使用者工作，
不得還原。

## 1. 下一對話先讀

依序完整讀取：

1. 根 `AGENTS.md`。
2. `docs/anime_style_plan.md`。
3. `docs/ai3d_runbook.md` 的 §0、§1、§4、§5aj、2026-08-18 小節。
4. `.agents/skills/photo-to-3d-pipeline/SKILL.md`。
5. `.agents/skills/photo-to-prop-forge/SKILL.md`。
6. `.agents/skills/ai-mesh-generation/SKILL.md`。
7. `.claude/rules/seams-world.md` 的 img→3D / 封存 / 採集列，以及
   `.claude/rules/verification.md` 對應矩陣。

不得憑記憶改模型路由或入庫閘門。

## 2. 已完成狀態

- 正式資料家：`C:\Users\user\Documents\app\steel_vs_swarm\tools\ai3d`。
- restricted 輸入可直接給使用者指定的
  `C:\Users\user\Documents\study\ai3d_restricted\photos`；程式會回推資料家根目錄。
- restricted 帳本共 334 張（原 14 + 已編目 320），`shipping:false`。
- 8/15 前舊件：61 件。
  - 自動換槽：11 件。
  - 固定槽／Route A 人工配方：50 件。
  - 目前兩個資料家可供應同類照片：53 件。
- 分類路由：
  - `building → trellis2_spz`
  - `rock → hunyuan_2gp`（shape-only，禁止 paint）
  - 雕塑性 `tree → sf3d`
  - `landmark / vehicle / ship → llm_parts` 純資料零件
- CPU 去背／分離／篩選跨 family 平行；每族內保持順序。GPU 單通道。
- 新件來源帳可帶 `replaces`；零件台判 `replace` 後才撤舊件，墓碑寫 `replaced_by`。
- 現有回歸：`audit_auto_intake` 155/155、siteplan 265、beacons 68、22,637 接合 0 異常、
  `npm run bal` 與 `npm test` 通過。

## 3. 第一阻塞：建立 runner

先搜尋既有 checkout／venv，找不到才安裝。模型與 venv 必須放在儲存庫外；不得新增 npm 依賴、
不得提交權重。

### 3.1 共通條件

- Python 3.11。
- NVIDIA RTX 3060 12GB 或同級 CUDA 卡。
- Blender 5.2 headless 可執行。
- Python 前處理環境至少有 Pillow、NumPy、SciPy、trimesh；先讓
  `tools/ai3d/audit_split_targets.py` 能執行。
- 權重與暫存建議預留 30–50GB。

### 3.2 SF3D

`--venv <home>` 指向的家必須存在：

```text
<home>/.venv/Scripts/python.exe
<home>/vendor/stable-fast-3d/run.py
```

依 upstream 文件接受授權並下載權重。先用一張雕塑樹照片跑 smoke test，不要直接跑全庫。

### 3.3 T2-spz

`--t2 <checkout>` 指向的家必須存在：

```text
<checkout>/.venv/Scripts/python.exe
<checkout>/run_t2_gate.py
<checkout>/binarize_feed.py
```

本機實測門檻是約 19GB 可用系統 RAM；RAM 不足時載入會無聲失敗。先以一張 building matte
驗證二值化、生成、GLB 寫出，再擴批。

### 3.4 Hunyuan3D-2GP adapter

不得猜 upstream entrypoint。依實際 checkout README 寫一支儲存庫外 adapter，固定介面：

```text
<adapter> <image1> <image2> ... --output-dir <directory>
```

輸出只能採其中一種：

```text
<output-dir>/<index>/mesh.glb
<output-dir>/<target-id>.glb
```

若模型在 WSL2，adapter 使用 Windows `.cmd`／可執行檔：把 Windows 路徑經 `wslpath` 轉換，
只呼叫 2GP shape generation，再把 GLB 寫回指定 Windows 目錄。禁止啟動 paint stage。

## 4. Runner smoke gate

每條 GPU 路由先各跑一張，且第一輪加 `--no-intake`：

```powershell
node tools/ai3d/harvest_loop.mjs `
  --home C:\Users\user\Documents\app\steel_vs_swarm\tools\ai3d `
  --venv <SF3D_HOME> --t2 <T2_CHECKOUT> --hunyuan <HUNYUAN_ADAPTER> `
  --family <building|rock|tree> --gen-limit 1 --t2-limit 1 `
  --rounds 1 --category-jobs 3 --no-intake
```

逐路必須確認：

- `.feed.json` 的母照片、target、family、part、tool 全部正確。
- GLB 能被 `mesh_sheet.mjs` 讀取並產生 contact sheet。
- Hunyuan 來源帳方法保持 `hunyuan_2gp`，不得落成 `sf3d`。
- T2 仍經二值化與 solidify；SF3D 不套 T2 的實心化流程。
- GPU 峰值沒有 OOM；不得以同卡多模型平行解決吞吐。

任一條失敗，只修該 adapter／環境；不得把 building 或 rock 靜默退回 SF3D 當成新版。

## 5. restricted 資料家

先跑 CPU 前處理與 GPU 候選，但保持硬閘：

```powershell
node tools/ai3d/harvest_loop.mjs `
  --home C:\Users\user\Documents\study\ai3d_restricted\photos `
  --venv <SF3D_HOME> --t2 <T2_CHECKOUT> --hunyuan <HUNYUAN_ADAPTER> `
  --rounds 1 --category-jobs 3
```

預期結果必須是：

- 顯示「非出貨語料家」。
- 不抓外部 CC0 型錄額度。
- building/tree 可生成 contact sheet；ship/vehicle 只留給 Route A。
- 三條自動入庫全部顯示因 `shipping:false` 跳過。
- 不得修改 `public/assets/models/parts/*.glb`、`public/js/biomes.js` 或正式來源帳。

## 6. 正式資料家批次生成

三條 smoke 全過後才啟動長跑：

```powershell
node tools/ai3d/harvest_loop.mjs `
  --home C:\Users\user\Documents\app\steel_vs_swarm\tools\ai3d `
  --venv <SF3D_HOME> --t2 <T2_CHECKOUT> --hunyuan <HUNYUAN_ADAPTER> `
  --category-jobs 3 --gen-limit 12 --t2-limit 4 --intake-limit 4 `
  --rounds 0 --every 15
```

每批最多入庫 4 件。不要一次把整個名冊改完；每批都必須先完成人眼判決和回歸，再進下一批。

## 7. 逐件替代流程

每批先印計畫：

```powershell
node tools/ai3d/replacement_plan.mjs `
  --home C:\Users\user\Documents\app\steel_vs_swarm\tools\ai3d `
  --home C:\Users\user\Documents\study\ai3d_restricted\photos
```

### 7.1 自動換槽 11 件

1. 採集迴圈把同 family／part 的舊 key 放進新件 `.feed.json.replaces`。
2. `auto_intake` 只在新舊同一輪替槽時把 `replaces` 寫進來源帳。
3. `npm run parts` 逐顆看照片、生成方法、剪影與接縫。
4. 確認新件較好後選「⇢ 通過並替代舊件」。
5. 執行：

```powershell
node tools/ai3d/apply_verdicts.mjs `
  --home C:\Users\user\Documents\app\steel_vs_swarm\tools\ai3d
```

6. 確認新件仍在 active manifest、舊件離開遊戲並出現在封存區，墓碑的 `replaced_by` 指向新 key。

### 7.2 人工配方 50 件

固定槽與 Route A 沒有機械式換槽語意，必須逐件：

1. 從 `replacement_plan --json` 取舊 key、family、part、指定新方法與候選照片。
2. 查消費端既有 builder／slot 契約；不得新增第二份幾何或碰撞推導。
3. 規則人造物寫純資料零件表；不得烤整車、整船、整地標 GLB。
4. 固定 GLB 槽需先補明確 replacement recipe、fallback、外廓與三角形預算，再讓稽核釘住。
5. 仍經零件台人眼確認後，才用同一封存鏈撤舊件。

不得為了把數字從 50 變成 0 而猜 slot、開新名冊格或修改權威碰撞。

## 8. 每批驗收

至少執行：

```powershell
node tools/ai3d/audit_auto_intake.mjs
node tools/ai3d/intake_parts.mjs
node tools/parts_review.mjs --report
node tools/audit_siteplan.mjs
node tools/audit_beacons.mjs
node tools/audit_object_joints.mjs --seeds 8
node tools/audit_client_syntax.mjs
npm run bal
```

`parts_review --report` 的缺件、孤兒節點、未記載來源必須全為 0。正式宣稱完成前依根規則重啟
8620 新伺服器再跑 `npm test`。

若修改了程式判定，另跑對應反向驗證：

```powershell
node tools/ai3d/audit_auto_intake.mjs --break-parallel
node tools/ai3d/audit_auto_intake.mjs --break-route
node tools/ai3d/audit_auto_intake.mjs --break-corpus-path
node tools/ai3d/audit_auto_intake.mjs --break-replace
node tools/ai3d/audit_auto_intake.mjs --break-archive
node tools/ai3d/audit_auto_intake.mjs --break-redo
```

每一支必須非零退出且只紅對應判定。純資產批次沒有改判定時，不需重造 break；仍需跑 pristine。

## 9. 完成定義

- 61 個舊 key 全部有明確結果：已替代封存，或附具體阻塞理由，沒有靜默略過。
- 每個被替代 key 都不在 active 名冊／GLB 節點／active provenance，且在 archive 有
  `replaced_by`。
- 每個新 key 都有方法、runner、參數、母照片、target、授權與輸出索引。
- restricted 的任何照片 id 都不出現在 active provenance。
- Route A 產物是零件資料庫，不是完成品 GLB。
- 零件台三個缺口為 0；相鄰稽核、平衡與 e2e 全綠。
- 只 commit 人眼通過的批次；採集迴圈本身不得 commit 或 push。

## 10. 交付時必須明說

- 實際使用的 runner checkout／commit、Python、CUDA、Blender 版本。
- 哪些批次走 T2、Hunyuan、SF3D、Route A。
- 61 件中完成／封存／仍阻塞的數量與 key 清單。
- restricted 只做候選的事實。
- 未跑的真機視覺檢查、缺少的依賴或模型授權。
