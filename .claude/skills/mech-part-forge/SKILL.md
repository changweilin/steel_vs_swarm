---
name: mech-part-forge
description: 用開源 AI 3D 模型替本專案的機體/建築單位 NPC 產出「零件」,對號掛回 models.js 既有的具名 rig 槽位 —— 不是產一台整機。涵蓋 Gemini CLI 逐槽位拆件、單圖→3D 的 12GB 選型與降級鏈、零件庫 GLB 的載入單一縫、以及 muzzle/cockpit/cast_jump 三支稽核組成的驗收條件。Use when adding or upgrading mech/NPC geometry, converting concept art into game meshes, generating parts for an existing rig, or when a unit "needs more detail" but the gait and hardpoints must not move.
license: MIT
compatibility: 離線管線(Python 3.11 venv + Blender headless,住 tools/ai3d/,不進 package.json);執行期只多一支 partlib.js,仍是 vanilla ES module + CDN three
---

# 機體零件鍛造(AI 幾何 → 既有 rig 槽位)

> 先讀 `docs/ai3d_asset_plan.md`(執行計畫與階段閘門),通用外部管線知識在
> `ai-mesh-generation` / `ai-rigging-motion`。本支只寫**本 repo 的契約與會靜默壞掉的地方**。

## 0. 這支 skill 的唯一命題

`models.js` 的 rig **不是蒙皮骨架**,是一棵**具名零件階層**:`rig.hips` / `rig.legChainL` /
`rig.tailSegs` / `rig.muzzles.light.n` / `rig.wpn.heavy` … `locomotion.js` 每幀直接寫這些節點的
position/rotation。

由此推出兩件事,兩件都是硬規則:

1. **AI 產出的單位是「零件」,不是「一台機體」。** 一台單一 mesh 的 GLB 沒有這些節點 ⇒
   接進來的當下,步態、`MOVE_SIG`、`CAST_SIG`、槍口對齊、FPV 武裝來源會同時失效,
   而畫面上只表現成「機體站著不動」。
2. **不要自動骨架。** UniRig/SkinTokens 那一族解決的是「這個 mesh 沒有骨架」——
   本專案的問題從來不是這個。掛上蒙皮骨架 = 把上面那棵樹整個換掉。

---

## 1. 槽位契約(規格書;以 `models.js` 原文為準,本表只是索引)

| 機種 | `rig.kind` | 必須存在且**位置/朝向一格不能動**的節點 |
|---|---|---|
| 無人機 | `aerial` | `tilt`、機身、`wpn.light.g`/`wpn.heavy.g`、`muzzles.light.n`/`muzzles.heavy.n`、`lightGlow` |
| 機甲(雙足) | `biped` | `hips` `chest` `neck` `head` `legL/R` `armL/R` `legChainL/R` `armChainL/R` `tailSegs` `gunR` `gunL` `aimPose` |
| 機甲(獸型) | `quad` | `spine` `chest` `neck` `head` `tail` `tail2` `legFL/FR/HL/HR` `chFL/FR/HL/HR` `tents` `armSh/armEl` |
| 變形者 | `morph` | `torso` `head` `legL/R` `armL/R` `kneeL/R` `ankleL/R` `elbowL/R` `wristL/R` `vents` `thrusters` `rotors` `flapWings` `midLegs/midKnees/midTarsi` |

**四條 MUST**

- **槍口零接觸**:`muzzles.*.n` 與 `rig.wpn` 的局部座標與朝向不得改。槍口恆朝前靠的是 build-time
  的世界對齊反解(`getWorldQuaternion().invert()`),不是手調角度 —— 換零件動到父節點的朝向,
  反解會把偏差吃進去,而症狀是曳光從機身側面射出。改掛點一律重跑 `audit_muzzle.mjs`。
- **bbox 漂移 ≤ ±5%**:超過就會被 `fitToHeight` 縮放,連帶 `ent.dimTop/dimH/dimR`(血條/敵標/光暈)
  全歪,而且這些值是 spawn 時量一次的,事後看不出來。
- **液壓缸類單端錨斜置件**不得改成雙端跨關節 —— 步態會把它拉伸爆掉。
- **`heavy.pivot` 對 morph 手持武器 MUST 留空**(與 `gunPitch` 每幀賦值打架)。

---

## 2. 執行期單一縫:`public/js/partlib.js`

```js
export function loadPartLib(url)   // 一次載入 → markShared() 註冊(A25)→ 之後純查表
export function libGeo(name)       // 查不到回 null
```

消費端只改「解析零件幾何」那一行:

```js
// models.js 內任何一個零件
const geo = libGeo('m05/thigh_L') ?? new THREE.BoxGeometry(0.34, 1.2, 0.4);
//                                 ↑ 這個 ?? 是保險絲,MUST 留著
```

**保險絲的語意** = `MODEL_MANIFEST` 那條既有的降級(原則 6):零件庫載不到,畫面**逐位元**回到今天。
沒有這一條,一次 CDN 抖動就是整台機體不見。

**A25**:零件庫幾何一律 `markShared()`,`disposeTree` 依註冊表跳過。零件庫本身不隨單位銷毀。

---

## 3. 產製流程

```
既有概念圖 public/assets/cyberpunk_art/mechs/{id}_static.png     ← 造型母本,已存在
    │
    │  Gemini CLI /edit(逐槽位拆件,§4)
    ▼
tools/ai3d/drafts/{id}/{slot}.png   →〔rembg 去背 → alpha〕
    │
    │  單圖→3D(降級鏈:TRELLIS.2@512 → @256 → Hunyuan3D 2.1 shape-only → SF3D)
    ▼
raw mesh  →  Blender headless:減面 → 原點對齊槽位樞軸 → 朝向對齊 → 合併同色 → 匯出
    ▼
public/assets/models/parts/{id}.glb   →  partlib 查表  →  既有 makeUnit 組裝(零改動)
```

**為什麼逐槽位生成,而不是「整台生成 + P3-SAM 切開」**:切出來的第 7 塊到底是不是左小腿沒人保證,
而對錯的唯一症狀是步態怪怪的。逐槽位 prompt 直接把對應寫死。
整台路線仍有用 —— 拿來**交叉驗證造型一致性**(逐零件各自生成容易長成「零件是同一個風格、
拼起來不是同一台機器」)。

**每個零件的原點與朝向**是最容易漏的一步:AI 產出的 mesh 原點在包圍盒中心,而 rig 節點的樞軸
在**關節處**。Blender 階段 MUST 把原點移到樞軸、把局部 +Z 轉成該零件的「前方」,否則掛上去
每一節都會繞錯軸旋轉,看起來像關節脫臼。

---

## 4. Gemini CLI 逐槽位拆件

### 4.0 用哪一支工具:量產走本機,訂閱配額留給難拆的

**2026-06-18 起 Gemini CLI 停止服務消費級層級**(免費 / AI Pro / AI Ultra),由 Antigravity CLI (`agy`) 接手;
`gemini` 只剩企業版與**付費** API key 能驅動。三條路線依量產可行性排序:

| # | 路線 | 認證 / 成本 | 適用(2026-08-04 使用者定案) |
|---|---|---|---|
| **A** | **`agy` 內建 Nano Banana Pro** | **Antigravity OAuth = 訂閱配額,免 API key** | **機體 2D 圖**(母本 + 逐槽位拆件)。`agy --print "…"` 非互動、可腳本化 |
| **B** | 本機 **FLUX.1 Kontext [dev] GGUF**(ComfyUI) | 開源權重、離線、**零配額零成本** | **其他一切 2D**:建築單位 NPC、靜態物件的照片正規化。GGUF 量化版就是給 ≤12GB 的 |
| **C** | Gemini CLI + `nanobanana` 擴充 | **必須 API key**,OAuth/訂閱配額不通用 | 只在手上本來就有付費 key 時 |

⚠ **配額是 A 的唯一風險**(2026-02 收緊,尖峰時段回報 2~5 張/次)⇒ §4.0.2 兩條省量規則**是可行性前提,不是最佳化**。

### 4.0.1 機體繪製優先序

**機甲(12)→ 無人機(12)→ 變形者(8,雙型態)**

| 順位 | 機種 | 角色 id | 母本缺口 | 為什麼 |
|---|---|---|---|---|
| 1 | `robot` | s06 s07 s09 t01 t02 t03 t04 t05 t10 t12 m02 m06 | 缺 4(t10 t12 m02 m06) | 槽位最典型,拆件規則在這裡定案後沿用到後兩種 |
| 2 | `drone` | s01 s02 s03 s04 s05 s08 s11 t07 t08 t09 m03 m04 | **0** | 槽位最少 + 母本齊全 = 單位成本最低 |
| 3 | `morph` | s10 s12 t06 t11 m01 m05 m07 m08 | 缺 7 台 × 2 型態 | 見下 |

**變形者的三條 MUST**(`makePoser` 在 `p.a`/`p.b` 之間插值**同一個 `p.g`** ⇒ 兩型態共用同一套零件,差別只有姿勢):

1. **MUST NOT 為兩型態各生成一套零件** —— 那把「變形」變成「換模型」,`makePoser` 的錯開時窗序列(Macross 式多段變形)當場失效。
2. 拆件圖**以地面型態為準**(關節樞軸在地面姿勢最好辨識)。
3. 飛行型態母本的用途是**驗收**:同一個零件在兩型態下都要讀得通。只有地面型態好看的小腿,收進機腹當發動機艙時會露餡 —— 前兩種機種沒有這一關。
   母本補畫 MUST **ground + flight 成對、同一次對話產出**(否則造型不一致)。

### 4.0.2 兩條省量規則

1. **左右對稱件只生成一次,鏡射在 Blender 階段做**(`legL/R`、`armL/R`、`chFL/FR`、對稱莢艙)⇒ 唯一槽位數砍近四成。
2. **重試只針對拆不乾淨的槽位**,不要一律 3×。判準寫死:主體單一 / 背景純色 / 無透明發光殘留 —— 三條都過就收工。

⇒ 全量約 **260 張拆件 + 18 張母本**,分三批各自是可交付里程碑。

路線 C 的環境變數優先序(留檔):
`NANOBANANA_GEMINI_API_KEY` → `NANOBANANA_GOOGLE_API_KEY` → `GEMINI_API_KEY` → `GOOGLE_API_KEY`;
都沒設報 `ERROR: No valid API key found…`(README 寫的 `NANOBANANA_API_KEY` 與原始碼對不上,以這組為準)。
模型:`gemini-2.5-flash-image` 有免費層 $0.039;`gemini-3-pro-image-preview` **無免費層** $0.134
⇒ 走 C 一律 flash(960 張:flash 免費層 $0 / pro 約 $129)。

**九條 prompt 規格(§4.1)三條路線通用** —— 換工具不換規格。

### 4.1 prompt 九條(缺一條就會在 3D 那端付代價)

| # | 條目 | 為什麼 |
|---|---|---|
| 1 | 單一物件、完整不裁切、置中佔畫面 85% | 裁到邊的部分模型會自己編 |
| 2 | 三分之四視角,偏航 ~35°、仰角 ~20° | 露出最多表面 |
| 3 | 長焦(~100mm)壓平透視 | 真正交圖不在訓練分布內,長焦是折衷 |
| 4 | 平光、無投影、無邊緣光、無過曝高光 | 烘進去的高光 delight 救不回來 |
| 5 | 純 `#808080` 平背景、無漸層、無地面 | 去背乾淨是品質最大的單一因子 |
| 6 | **完全不透明**:無玻璃、無透明、無發光 | 單圖→3D 的頭號死因 |
| 7 | 保留面板線/螺栓,表面消光 | 面板線幫模型判斷體積 |
| 8 | 無文字/標註/箭頭/浮水印/多視角拼版 | 文字扭曲成幾何雜訊 |
| 9 | ≥1024×1024,正方 | 短邊 1024 是底線 |

### 4.2 樣板

```
以 {REF} 為造型基準,只重繪其中的「{SLOT 中文描述}」。
輸出:單一物件、完整不裁切、置中佔畫面 85%;
三分之四視角(偏航約 35°、仰角約 20°),長焦壓平透視;
平光、無投影、無邊緣光、無過曝高光;
純 #808080 平背景、無漸層、無地面;
材質完全不透明——無玻璃、無透明、無發光;
保留原設計的面板線與螺栓細節,表面消光;
不要文字、標註、箭頭、浮水印、多視角拼版;
1024×1024。
```

### 4.3 母本的兩個已知坑

- **半透明發光翅膀**(如 `s01_static.png` 的蜂翼):第 6 條就是為它寫的,重繪時必須指定不透明。
- **粗黑輪廓線**:去背後如果黑框留在 alpha 邊緣,會被讀成零件表面一圈溝槽。去背完**看一眼 alpha**,
  必要時在 prompt 加 `no outline stroke`。

---

## 5. 12GB 這條線的工具選型

| 工具 | VRAM | 角色 |
|---|---|---|
| TRELLIS.2-4B | 官方標 24GB;社群回報 8GB@256 / 12GB@512 | **主力,但 MUST 先實測**。MIT 授權 |
| Hunyuan3D 2.1(**shape only**) | shape 10GB(paint 21GB **永遠不跑**) | 主力備援;本專案本來就不要 PBR |
| Hunyuan3D-2GP | 更低(CPU offload) | 保險絲 |
| Stable Fast 3D | 6GB、<1s | 小零件掃貨 |
| P3-SAM | 未公布,待實測 | 只當交叉驗證 |
| UniRig 一族 | — | **刻意不用**(見 §0) |

Python 3.13 跑不動這批(生態卡在 3.10–3.11)⇒ `tools/ai3d/.venv` 另開,**不進 `package.json`、
不進任何 build step**(A2)。

---

## 6. 只有幾何 + 一個基色

法線 / 金屬 / 粗糙貼圖**一律不進 repo**(`CLAUDE.md` §1 要求刪法線貼圖並重寫 gltf 移除引用;
`ai-pbr-texturing` 的邊界註記同此)。本專案用量化 toon ramp 上色,一張加陰影細節的貼圖是在跟
色階邊界打架,不是在幫忙。零件的顏色仍由 `paint.js` / `visual.hue` 決定 ⇒ 匯出的 GLB
**MUST 讓基色可被覆寫**(單一材質、不要每零件烤死顏色)。

---

## 7. 驗收(缺一不可,順序即優先序)

```bash
node tools/audit_muzzle.mjs        # 掛點:32 英雄 + 四陣營 NPC
node tools/audit_cockpit.mjs       # FPV 座艙取景
node tools/audit_cast_jump.mjs     # 施法/跳躍 post-pass 通道洩漏的唯一防線
node tools/audit_gpu_lifecycle.mjs # 零件庫幾何 markShared
node tools/shot_units.mjs          # 生成→渲染→審視閉環,前後對照
npm test && npm run bal            # 純表現層 ⇒ MUST 逐位元不動
```

**反向驗證(原則 9)**:故意把某個零件的原點偏移 0.5m,`audit_muzzle.mjs` 或 `shot_units` 的
對照圖 MUST 看得出來;看不出來就是這一輪根本沒驗到掛點。

**面數預算 MUST 由量測定案**:先量今天這台機體的三角形數,新零件上限 = 現值 × 一個講得出理由的倍率。
手寫一個好聽的數字 = 手機端幀時掉了才發現。

---

## 8. 會靜默壞掉的六件事

1. **父節點朝向被動到** → 槍口世界對齊反解把偏差吃進去 → 曳光從機身側面射出。
2. **零件原點沒移到關節樞軸** → 每一節繞錯軸轉 → 看起來像關節脫臼,而不像 bug。
3. **bbox 漲過 5%** → `fitToHeight` 縮小整台 → 血條/光暈/敵標一起歪,且是 spawn 時量死的。
4. **保險絲 `??` 被拿掉** → 零件庫載入失敗 = 整台機體消失,沒有錯誤訊息。
5. **零件庫幾何沒 `markShared()`** → `disposeTree` 回收共用幾何 → 下一台生成時破圖(A25)。
6. **把 AI 產的法線貼圖一起帶進來** → 與 toon ramp 打架 → 「某些物件的陰影邊界跟別人對不上」。
