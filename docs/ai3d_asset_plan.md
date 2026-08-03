# AI 3D 資產管線執行計畫(2026-08-04 定案)

> 目標:用開源 AI 3D 模型把**機體/建築單位 NPC 的動態模組**與**建築/神木/巨石等靜態物件**的細節密度拉高一階,
> 且**不動 rig 契約、不動確定性、不動 A2(零 npm 依賴)**。
> 硬體錨:**RTX 3060 12GB**(`nvidia-smi` 實測 12288 MiB)——本檔所有工具選型以這條線為準。

---

## 0. 結論摘要

| 決策 | 定案 | 理由 |
|---|---|---|
| 產出形式 | **零件庫 GLB + 既有組裝碼** | 組裝/塗裝/步態/jitter 全留在現有程式碼 ⇒ 每實例變異、決定性、`partJitter` 一格不動,rig 契約零接觸 |
| SKILL 落點 | 新增 `mech-part-forge`(動態)、`photo-to-prop-forge`(靜態) | 既有 `ai-mesh-generation`/`ai-pbr-texturing`/`ai-rigging-motion` 是**通用外部管線知識**,保持不動;新支只寫本 repo 的槽位契約與驗收 |
| 幾何主力(單圖→3D) | **TRELLIS.2-4B**(主)/ **Hunyuan3D 2.1 shape-only**(備) | 見 §1 VRAM 表;Hunyuan 的 paint 階段 21GB **一律不跑**,本專案本來就不要 PBR |
| 大量靜態小件 | **Stable Fast 3D (SF3D)** | 6GB、<1s、自帶 delight + UV 展開 ⇒ 一株樹的十幾個零件用它掃過去最划算 |
| 零件切分 | **P3-SAM**(必要時 + X-Part) | 整台生成後切成 rig 槽位;比逐零件各自生成更能保住「同一台機器」的造型一致性 |
| 減面/清理/匯出 | **Blender headless (bpy)** + AutoRemesher(MIT) | 離線、無 npm、可腳本化;`blender-mcp-agent` skill 已涵蓋 MCP 硬化 |
| 自動骨架(UniRig 等) | **刻意不用** | 本專案的 rig 不是蒙皮骨架,是**具名零件階層**(`rig.legL`/`rig.chest`/`rig.muzzles`…),由 `locomotion.js` 逐幀驅動。塞蒙皮骨架 = 同時報廢 `MOVE_SIG`/`CAST_SIG` 與三支稽核 |
| 2D 初稿 | **Gemini CLI + nanobanana 擴充** | 見 §5;既有 `public/assets/cyberpunk_art/mechs/*.png` 已是可用的造型母本,Gemini 只負責「拆成零件圖」 |
| 圖片來源(靜態) | **Openverse API**(免金鑰)+ Wikimedia Commons API,**只收 CC0/PD** | 見 §4.1;授權過濾是硬閘,不是建議 |

---

## 1. 環境現況與 VRAM 預算(12GB 這條線)

實測:`NVIDIA GeForce RTX 3060, 12288 MiB` / `Python 3.13.1` / `gemini` 已在 PATH。

**Python 3.13 跑不動這批模型**(TRELLIS/Hunyuan3D 生態普遍卡在 3.10–3.11)⇒ 一律另開獨立環境,
且**不進 `package.json`、不進任何 build step**(A2):管線住 `tools/ai3d/`,自帶 `.venv`,只在離線手動執行。

| 工具 | 用途 | VRAM(官方/實測) | 12GB 可行性 |
|---|---|---|---|
| TRELLIS.2-4B | 單圖→高保真幾何(MIT 授權) | 官方 README 標 **24GB**(A100/H100 驗證);社群/ComfyUI 版本回報 **8GB@256 / 12GB@512** | ⚠ **必須先實測**:先跑 256,確認能跑再往 512 推。跑不動就退 Hunyuan |
| Hunyuan3D 2.1(shape only) | 單圖→幾何 | shape **10GB** / paint 21GB / 全套 29GB | ✅ shape-only 進得去;**paint 階段永遠不跑** |
| Hunyuan3D-2GP | 低配版(CPU offload) | 低於上表 | ✅ 保險絲 |
| Stable Fast 3D | 快速小件、自帶 delight + UV | **6GB** | ✅ 最寬鬆,靜態零件主力 |
| P3-SAM / X-Part | 3D 零件分割 / 零件生成 | 未公布,**待實測** | ⚠ 先只用 P3-SAM(分割),X-Part 視實測再說 |
| Blender headless | 減面/合併/匯出 GLB | CPU | ✅ |

**降級鏈(原則 6)**:`TRELLIS.2@512 → TRELLIS.2@256 → Hunyuan3D 2.1 shape-only → SF3D → 維持現有程序零件`。
任一級跑不動就往下退,**不准為了跑得動而改判定或改契約**。

---

## 2. 架構邊界:為什麼是「零件庫」而不是整台 GLB

`MODEL_MANIFEST` 本來就支援整台 GLB(`base:SWARM` 就是),但機體那一欄全是 `null` 不是偷懶:

- `locomotion.js` 每幀寫的是 `rig.hips` / `rig.legChainL` / `rig.tailSegs` / `rig.gunR` …**具名節點**,一台單一 mesh 的 GLB 沒有這些節點,等於同時要重寫整個動畫層。
- `paint.js` 的塗裝、`toon.js` 的 ramp、`uPaintFace` 朝向閘都掛在**逐零件材質**上。
- 靜態物件那一半更明確:`VEG_DEFS`/`MEGALITHS`/`KIND_PARTS` 的價值就是**每實例變異**(`partJitter`、seed、`stretch`),烤成整棵樹 = 一片林子長得一模一樣。

所以 AI 只負責**零件的形狀**,其餘全部原封不動:

```
AI 產出           →  零件庫 GLB(每個零件一個具名節點,只有幾何 + 一個基色)
既有程式碼        →  挑哪一個零件、擺在哪、轉幾度、抖多少、塗什麼色、怎麼動
```

### 2.1 新的單一縫:`public/js/partlib.js`

```js
// libGeo(name) → BufferGeometry | null   (載不到回 null,呼叫端退回原本的程序基本體)
// loadPartLib(url) → 一次載入、markShared() 註冊(A25)、之後純查表
```

三個消費端改「解析零件描述」那一行,**其餘一行不動**:

| 消費端 | 現況 | 改法 |
|---|---|---|
| `beacons.js _geo(p.g)` | `['cyl', 0.42, 0.52, 13, 4]` | 多認一種 `['lib', 'pylon/foot_a']`,查不到回退原式 |
| `biomes.js` `VEG_DEFS`/`MEGALITHS` | `g:` 直接是 THREE geometry | `g: libGeo('tree/canopy_c') ?? ico(2.7)` —— **`??` 那一半是保險絲,MUST 留著** |
| `models.js` 零件建構 | 逐零件 `new THREE.BoxGeometry(...)` | 同上,只換幾何來源,`position`/`rotation`/掛點/`rig.*` 登記全不動 |

**硬性不變式(這幾條是驗收條件,不是建議):**

1. **回退保險絲**:零件庫載入失敗 = 逐位元回到今天的畫面(同 `MODEL_MANIFEST` 的降級語意)。
2. **外廓實測**:碰撞柱/`foot`/`col.r` 一律 `Box3.setFromObject` 量**換上新零件之後**的結果,MUST NOT 沿用標稱值(A30 / `audit_beacons.mjs` Ⅰ)。
3. **零額外亂數**:換幾何 MUST NOT 多抽一枚 `rnd()`,否則整張圖的植被/建物佈局序列整條推移(§2.3)。
4. **共用幾何**:零件庫幾何一律 `markShared()`,`disposeTree` 不得回收(A25)。
5. **只有幾何 + 基色**:法線/金屬/粗糙貼圖一律不進 repo(CLAUDE.md §1;`ai-pbr-texturing` 的邊界註記)。
6. **面數預算由量測定案**:先量今天每台機體/每株樹的三角形數,新零件的預算 = 現值 × 上限倍率,**MUST NOT 手寫一個好聽的數字**。

---

## 3. 軌道 A:動態(機體 / 建築單位 NPC)

### 3.1 槽位契約(這是整條管線的規格書)

三種機種的 rig 已經定義好槽位,AI 零件必須**照名字對號入座**:

| 機種 | rig 槽位(節錄,以原文為準) |
|---|---|
| `aerial`(無人機) | `tilt` / 機身 / `wpn.light.g` · `wpn.heavy.g` / `muzzles.light.n` · `muzzles.heavy.n` |
| `biped` / `quad`(機甲) | `hips` `chest` `neck` `head` `legL/R` `armL/R` `legChainL/R` `armChainL/R` `tailSegs` `gunR/gunL` |
| `morph`(變形者) | `torso` `head` `legL/R` `armL/R` `kneeL/R` `ankleL/R` `elbowL/R` `wristL/R` `vents` `thrusters` `rotors` `flapWings` |

**三條 MUST**:
- 槍口節點(`muzzles.*.n`)與 `rig.wpn` 的**局部座標與朝向一格不能動** —— 槍口恆朝前靠的是 build-time 世界對齊反解,零件換皮後 `audit_muzzle.mjs` 必須全綠。
- 換零件後整體 bbox 漂移 **≤ ±5%**(模組層守則),否則 `fitToHeight` 會把機體縮小、血條/敵標/光暈的 `dimTop/dimH/dimR` 全歪。
- 液壓缸類**單端錨斜置**件不得改成雙端跨關節(步態會把它拉伸爆掉)。

### 3.2 流程

```
既有概念圖 cyberpunk_art/mechs/{id}_static.png    ← 造型母本(已存在,3/4 視角、單物件、平底色)
   │
   ├─(A)整台路線: 母本 →〔去背〕→ TRELLIS.2 → 整台 mesh → P3-SAM 切零件 → 人工/agent 對應到槽位
   └─(B)零件路線: 母本 → Gemini nanobanana /edit「只保留左腿、重繪、置中、不透明」→ 逐槽位 2D 圖 → 單圖→3D
                                                                                    ↓
                                             Blender headless:減面 → 對齊槽位原點/朝向 → 合併同色 → 匯出零件庫 GLB
                                                                                    ↓
                                                            partlib.js 查表 → 既有 makeUnit 組裝(零改動)
```

**(B) 是主線**:槽位對應由 prompt 保證,不必事後猜 P3-SAM 切出來的第 7 塊是不是左小腿。
**(A) 當交叉驗證**:整台一次生成的造型一致性比逐零件好,拿來檢查 (B) 的零件擺在一起像不像同一台機器。

⚠ **母本的已知問題**:`s01_static.png` 那類圖的翅膀是**半透明發光**的 —— 單圖→3D 對透明/玻璃/發光一律處理不好。
逐槽位重繪時 MUST 明確指定「完全不透明、無發光、無運動模糊」(見 §5.2 負向詞)。

### 3.3 驗收閘門(缺一不可)

| 閘門 | 指令 | 判準 |
|---|---|---|
| 掛點 | `node tools/audit_muzzle.mjs` | 全綠(32 英雄 + 四陣營 NPC) |
| 座艙取景 | `node tools/audit_cockpit.mjs` | 全綠 |
| 施法/跳躍姿勢 | `node tools/audit_cast_jump.mjs` | 全綠(post-pass 通道洩漏的唯一防線) |
| GPU 生命週期 | `node tools/audit_gpu_lifecycle.mjs` | 全綠(零件庫幾何 `markShared`) |
| 視覺閉環 | `node tools/shot_units.mjs` | 前後對照出圖,人工審視 |
| 不回歸 | `npm test` / `npm run bal` | 純表現層 ⇒ **MUST 逐位元不動** |

---

## 4. 軌道 B:靜態(建築 / 神木 / 巨石 / 地標)

### 4.1 「快速搜索網路照片」= Openverse API,而且是授權硬閘

- **Openverse API**(`api.openverse.org`):免金鑰、8 億+ 件、支援 `license=cc0` 過濾,來源涵蓋 Flickr / Wikimedia / 各大博物館。
- **Wikimedia Commons API**:補地標類(每筆帶授權、作者、尺寸)。
- **硬閘:只收 `cc0` 與 public domain**。CC-BY 也不收 —— 一顆烤進 repo 的岩石沒有地方掛署名,而且沒有任何錯誤訊息會告訴你授權出事了。
- 每筆下載的照片 MUST 連同 `{source_url, license, creator, retrieved_at}` 寫進 `tools/ai3d/photo_manifest.json` 留檔。

### 4.2 產出的是「零件詞彙」不是成品

| 家族 | 現況零件 | AI 該產什麼 |
|---|---|---|
| 神木/植被 `VEG_DEFS` | `cyl` 樹幹 + `ico`/`cone` 樹冠 | 3~5 款樹冠模組、2~3 款分枝、板根 |
| 巨石 `MEGALITHS` | `Box`/`Sphere` + 手寫岩溝 | 岩面片(facet)、崩落塊、山腳碎石錐 |
| 地標 `KIND_PARTS` | `['cyl'|'box'|'cone'|'ico']` 純資料 | 格構節點、微波碟、水塔桶身、貨櫃 |
| 建物 `hazards.js BUILDERS` | 拉伸盒 | 窗組模組、屋頂帽、陽台/雨遮、外掛管線 |

**為什麼是模組而不是整棟**:整棟烤死 = 一條街每棟一樣;模組 + 既有的 seed 挑選 + `partJitter` = 細節上去了、變異還在。
`beacons.js` 前半段 **MUST 維持零 THREE**(那是它離線可驗的唯一原因)⇒ 零件描述仍是 `['lib', name]` 這種純資料。

### 4.3 驗收閘門

| 閘門 | 指令 | 判準 |
|---|---|---|
| 接合完整性 | `node tools/audit_object_joints.mjs --seeds 8` | FLOAT/PARTIAL/DETACHED/ISOLATED 四硬失敗全清 |
| 地標外廓/碰撞 | `node tools/audit_beacons.mjs`(+ `--break-extent` 反向驗證) | 標稱 `foot` 雙向貼合實算外廓 |
| 可通行性 | `node tools/audit_traverse.mjs` | 新零件沒有把路擋住 |
| 賽璐璐管線 | `node tools/audit_cel_pipeline.mjs` | ramp 家族/描邊不變 |
| 視覺旋鈕 | `node tools/audit_visual_prefs.mjs` | 零件抖動不變式 |
| GPU | `node tools/audit_gpu_lifecycle.mjs` | 共用幾何註冊 |
| 不回歸 | `npm test` / `npm run bal` | **MUST 逐位元不動** |

---

## 5. Gemini CLI 2D 初稿 + prompt 規格

### 5.0 工具分工(2026-08-04 使用者定案)

| 對象 | 工具 | 理由 |
|---|---|---|
| **機體 2D 圖**(32 台英雄機體的母本 + 逐槽位拆件) | **`agy` 內建 Nano Banana Pro**(Antigravity OAuth = 訂閱配額,免 API key) | 拆件是「指令服從度」的活,品質差一階就要重試好幾輪 |
| **其他一切 2D**(建築單位 NPC、靜態物件的 Openverse 照片正規化) | **FLUX.1 Kontext [dev] GGUF**(ComfyUI,本機 3060) | 零配額零成本;照片正規化(去遮擋/去投影/轉正)是量大且不挑品質的活 |

⚠ **配額是這條分工唯一的風險**:Antigravity 影像額度 2026-02 收緊過,尖峰時段有 Pro 訂閱者回報 2~5 張/次。
下面 §5.0.2 的兩條省量規則**不是最佳化,是可行性前提**。

#### 5.0.1 機體繪製優先序(使用者定案)

**機甲(12 台)→ 無人機(12 台)→ 變形者(8 台,含地面/飛行雙型態)**

| 順位 | 機種 | 台數 | 角色 id | 母本缺口 | 為什麼排這裡 |
|---|---|---|---|---|---|
| 1 | 機甲 `robot` | 12 | s06 s07 s09 t01 t02 t03 t04 t05 t10 t12 m02 m06 | **缺 4**(t10 t12 m02 m06) | 槽位最典型(`biped`/`quad` 都有完整四肢鏈),拆件規則在這裡定案後可以直接沿用 |
| 2 | 無人機 `drone` | 12 | s01 s02 s03 s04 s05 s08 s11 t07 t08 t09 m03 m04 | **0(母本齊全)** | 槽位最少(機身/機首/翼/雙武器莢),母本現成 ⇒ 單位成本最低 |
| 3 | 變形者 `morph` | 8 | s10 s12 t06 t11 m01 m05 m07 m08 | **缺 7 台 × 2 型態 = 14 張** | 最難,見下 |

**變形者為什麼最後,以及唯一正確的做法**:
`models.js makePoser(parts)` 在 `p.a`(地面姿勢)與 `p.b`(飛行姿勢)之間插值 **同一個 `p.g`** ——
**兩個型態共用同一套零件,差別只有姿勢**。由此推出三條 MUST:

1. **MUST NOT 為兩型態各生成一套零件** —— 那會把「變形」變成「換模型」,而且 `makePoser` 的時窗錯開序列(Macross 式多段變形)整個失效。
2. 拆件圖**以地面型態為準**生成(關節樞軸在地面姿勢下最好辨識)。
3. 飛行型態母本的用途是**驗收**:同一個零件在兩個型態下都要讀得通。一個只有在地面型態好看的小腿,
   收進機腹當發動機艙時會露餡 —— 這正是它排最後的原因,前兩種機種沒有這一關。

⇒ 變形者的母本補畫是 **ground + flight 兩張成對**,MUST 同一次對話產出以保住造型一致性。

#### 5.0.2 兩條省量規則(配額前提)

1. **左右對稱件只生成一次,鏡射在 Blender 階段做**。`legL/legR`、`armL/armR`、`chFL/chFR`、
   `wpn.light`/`wpn.heavy` 之外的對稱莢艙全部適用 ⇒ 唯一槽位數砍掉近四成。
2. **重試只針對「拆不乾淨」的槽位**,不要一律 3×。判準寫死:主體是否單一、背景是否純色、
   是否仍有透明/發光殘留 —— 三條都過就收工。

估算(唯一槽位、含選擇性重試):

| 機種 | 唯一槽位/台 | 台數 | 拆件圖 | 母本補畫 |
|---|---|---|---|---|
| 機甲 | ~9 | 12 | ~108 | 4 |
| 無人機 | ~6 | 12 | ~72 | 0 |
| 變形者 | ~10 | 8 | ~80 | 14 |
| **合計** | | **32** | **~260** | **18** |

≈ **280 張**(不是先前一律 3× 重試估的 960)。按上面的優先序分三批,每批做完就是一個可交付里程碑。

### 5.1 三條路線的規格留檔(**Gemini CLI 已不是預設**)

**2026-06-18 Gemini CLI 停止服務消費級層級**(免費 / Google AI Pro / Google AI Ultra),由 **Antigravity CLI (`agy`)** 接手;
只剩企業版與**付費** API key 還能驅動 `gemini`。本機實測:`gemini 0.33.2` 與 `agy 1.0.2` 都在,
`~/.gemini/` 下已有 `antigravity*` 目錄 ⇒ 遷移已經發生過。

因此拆件圖改成三條路線,**依「量產可行性」排序**:

| # | 路線 | 認證 / 成本 | 適用 |
|---|---|---|---|
| **A** | **`agy` 內建 Nano Banana Pro** | **Antigravity OAuth = 訂閱配額,免 API key** | **機體 2D 圖**(§5.0 定案)。`agy --print "…"` 非互動 ⇒ 可腳本化 |
| **B** | **本機 FLUX.1 Kontext [dev] GGUF**(ComfyUI) | 開源權重、離線、**零配額零成本** | **其他一切 2D**:建築單位 NPC、Openverse 照片正規化。GGUF 量化版就是給 ≤12GB 用的 |
| **C(僅在有付費 key 時)** | Gemini CLI + `nanobanana` 擴充 | **必須 API key**;OAuth 與訂閱配額**不通用** | 手上本來就有付費 Gemini API key 才考慮 |

### 5.1.1 路線 C 的認證細節(留檔)

`nanobanana` 擴充自己起一個 MCP server 直接打 Gemini API ⇒ Gemini CLI 的登入狀態對它沒有作用。
環境變數優先序(取第一個有值的):

```
NANOBANANA_GEMINI_API_KEY → NANOBANANA_GOOGLE_API_KEY → GEMINI_API_KEY → GOOGLE_API_KEY
```

都沒設就報 `ERROR: No valid API key found…`。
(README 正文寫的是 `NANOBANANA_API_KEY`,與原始碼優先序對不上 —— **以上表為準**。)

模型選型是成本決策:`gemini-2.5-flash-image` 有免費層(回報約 500 張/日,以 AI Studio 當下頁面為準)、$0.039/張;
`gemini-3.1-flash-image-preview`(擴充預設)無免費層、$0.067;
`gemini-3-pro-image-preview` **0 RPM / 0 RPD 完全沒有免費層**、$0.134。
960 張:flash 免費層分兩三天跑完 $0,pro 約 $129 ⇒ **若走 C,預設一律 flash**。

### 5.2 「給 3D 開源模型使用的 2D 圖」prompt 規格(九條)

單圖→3D 模型吃的不是「好看的插畫」,是**一張把形狀講清楚、把干擾拿掉的圖**。九條全都要寫進 prompt:

| # | 條目 | 寫法 | 為什麼 |
|---|---|---|---|
| 1 | 單一物件 | `exactly one object, isolated, complete, nothing else in frame` | 多物件 = 幾何糊成一團 |
| 2 | 完整不裁切 | `full object visible, ~85% of frame, even margin on all sides` | 裁到邊 = 缺的那塊被模型自己編 |
| 3 | 近正交視角 | `three-quarter view, ~35° yaw / ~20° elevation, long-lens (100mm) flattened perspective` | 真正交圖不在訓練分布內;長焦是「像正交又還在分布內」的折衷 |
| 4 | 平光無影 | `flat even ambient lighting, no cast shadow, no rim light, no blown highlights` | 烘進去的高光/陰影 delight 也救不回來 |
| 5 | 純色背景 | `flat single-colour neutral background (#808080), no gradient, no vignette, no ground plane` | 去背乾淨 = 品質最大的單一因子 |
| 6 | 全不透明 | `fully opaque materials, no glass, no transparency, no glow, no emissive` | 透明件是單圖→3D 的頭號死因(既有概念圖的翅膀正是這個坑) |
| 7 | 表面資訊 | `crisp panel lines, bolts, greebles; matte surface` | 面板線幫模型判斷體積,但要 matte |
| 8 | 無文字無標註 | `no text, no logos, no arrows, no dimensions, no watermark, no turntable sheet` | 文字會扭曲成幾何雜訊 |
| 9 | 尺寸 | `1024×1024 or larger, square` | 短邊 ≥1024;refine 模式建議 2048 |

**逐槽位拆件的 `/edit` 樣板**(`{REF}` = 既有概念圖):

```
以 {REF} 為造型基準,只重繪其中的「左腿總成(大腿+小腿+腳掌)」。
輸出:單一物件、完整不裁切、置中佔畫面 85%;
三分之四視角(偏航約 35°、仰角約 20°),長焦壓平透視;
平光、無投影、無邊緣光、無過曝高光;
純 #808080 平背景、無漸層、無地面;
材質完全不透明——無玻璃、無透明、無發光;
保留原設計的面板線與螺栓細節,表面消光;
不要文字、標註、箭頭、浮水印、多視角拼版;
1024×1024。
```

### 5.3 送進 3D 模型之前的必要前處理

1. **去背成 alpha**(`rembg` / BiRefNet)—— 平背景就是為了這一步好做。
2. 檢查 alpha 邊緣沒有殘留描邊黑框(概念圖有粗黑輪廓線,會被讀成一圈溝槽)。
3. 短邊 <1024 就不要送。

---

## 6. 執行階段與閘門

| 階段 | 內容 | 出場條件 |
|---|---|---|
| **P0 環境**(半天) | `tools/ai3d/` + Python 3.11 venv;裝 SF3D → Hunyuan3D 2.1 → TRELLIS.2;**逐個實測 12GB 跑不跑得動並記錄** | 三支各產出一顆測試 GLB;寫下實測 VRAM 與秒數 |
| **P1 單一縫**(半天) | `public/js/partlib.js` + 三個消費端各改一行解析;**先不放任何 AI 零件** | 全部稽核逐位元不動(這一步的價值就是證明保險絲有效) |
| **P2 靜態試點**(1~2 天) | 選 **1 款地標**(`pylon` 或 `watertower`)走完 Openverse → SF3D → Blender → 零件庫 | `audit_beacons.mjs` + `audit_object_joints.mjs` + `--break-extent` 反向驗證 |
| **P3 動態試點**(2~3 天) | 選 **1 台機甲**(`biped`,槽位最典型)走完 `agy` 拆件 → TRELLIS/Hunyuan → 槽位對齊 | 三支 rig 稽核全綠 + bbox 漂移 ≤±5% + `shot_units.mjs` 前後對照 |
| **P4a 機甲 12 台** | 先補 t10 t12 m02 m06 四張母本,再逐台拆件;左右對稱件只畫一次 | 每台過三支 rig 稽核;12 台做完 = 第一個可交付里程碑 |
| **P4b 無人機 12 台** | 母本齊全 ⇒ 直接拆件;槽位最少、單位成本最低 | 同上 |
| **P4c 變形者 8 台** | 先補 7 台 × ground/flight 成對母本;**零件只生一套**,以地面型態拆件、飛行型態驗收 | 同上 **+ 兩型態各出一次 `shot_units.mjs` 對照**(`makePoser` 時窗序列不得走樣) |

**每批 ≤5 個資產,每批跑完整閘門**;每個里程碑另加幀時 30 秒穩態(桌機 + 觸控模擬)前後對照。

**P2/P3 誰先?** 先 P2:靜態沒有 rig 契約,失敗的成本只有「這顆石頭不好看」;動態失敗會同時打到步態、掛點與命中量體。

---

## 7. 風險與已知未驗

| 風險 | 徵狀 | 對策 |
|---|---|---|
| TRELLIS.2 在 12GB 跑不動 | OOM,或只跑得動 256 而細節不如現在的程序零件 | P0 就要驗;跑不動直接退 Hunyuan3D 2.1 shape-only(10GB 有把握) |
| P3-SAM 切出來的零件對不上槽位 | 左小腿被切成兩塊、腳掌併進小腿 | 主線走 §3.2 (B) 逐槽位生成,P3-SAM 只當交叉驗證 |
| 面數失控 | 手機端幀時掉、勾線 pass 變重 | 面數預算由**量測現值**定案;每批做幀時前後對照 |
| 二進位負載膨脹 | repo 變大、單機版打包變慢 | 零件庫按家族分檔、只在需要時載;`npm run build:solo` 要確認有複製到 |
| 授權污染 | CC-BY 圖進了 repo 而沒有署名 | Openverse 查詢**寫死 `license=cc0`**;`photo_manifest.json` 留檔 |
| 描邊黑框被讀成幾何 | 零件表面多一圈莫名溝槽 | 去背後檢查 alpha 邊緣;必要時 prompt 明確要求 `no outline stroke` |
| 透明翅膀 | 生成出一團霧狀幾何 | prompt 第 6 條;既有概念圖不能直接送 |

**尚未驗證(交付時必須標註)**:TRELLIS.2 在本機 12GB 的實際上限、P3-SAM/X-Part 的 VRAM、
Gemini `/edit` 對「只保留某個零件」這種指令的服從率、零件庫載入對首屏時間的影響。

---

## 8. 相關 SKILL

- `.claude/skills/mech-part-forge/` —— 軌道 A(動態機體/NPC 零件)
- `.claude/skills/photo-to-prop-forge/` —— 軌道 B(照片→靜態物件零件)
- 通用外部管線知識(保持不動):`ai-mesh-generation` / `ai-pbr-texturing` / `ai-rigging-motion` / `blender-mcp-agent`
- 相鄰約束:`procedural-object-detail`(變異與種子)、`cel-shading-pipeline`(只吃基色)、`headless-3d-inspection`(看得到自己的成果)
