---
name: photo-to-prop-forge
description: 從網路 CC0 照片快速取材,用開源 AI 3D 模型產出建築/神木/巨石/地標的「零件詞彙」,交給既有的程序組裝碼(VEG_DEFS / MEGALITHS / KIND_PARTS / BUILDERS)去挑選、擺放與抖動 —— 不是烤一棵成品樹。涵蓋 Openverse/Wikimedia 授權硬閘、12GB 選型、外廓實測與碰撞一致性,以及 audit_object_joints / audit_beacons / audit_traverse 的驗收條件。Use when static world objects look too uniform or too coarse, when adding rock/tree/building/landmark detail, when sourcing reference photos for 3D generation, or when asked to make scenery "more detailed".
license: MIT
compatibility: 離線管線(Python 3.11 venv + Blender headless,住 tools/ai3d/,不進 package.json);執行期只多一支 partlib.js
---

# 照片 → 靜態物件零件鍛造

> 先讀 `docs/ai3d_asset_plan.md`(執行計畫與階段閘門)。通用外部管線知識在 `ai-mesh-generation`;
> 變異與種子紀律在 `procedural-object-detail`。本支只寫**本 repo 的契約與會靜默壞掉的地方**。

## 0. 這支 skill 的唯一命題:產詞彙,不產成品

現有的靜態物件是**純資料零件表** + 程序組裝:

```js
// beacons.js KIND_PARTS —— 純資料,零 THREE(這是它離線可驗的唯一原因)
pylon: [ { g: ['cyl', 0.42, 0.52, 13, 4], c: 0x8d949c, p: [-2.9, 6.5, -2.9] }, … ]

// biomes.js VEG_DEFS
conifer2: { parts: [ { g: cyl(0.18, 0.3, 2.4), y: 1.2, c: 0x54402a },
                     { g: ico(2.0), y: 3.4, key: 'conifer', sy: 0.8 }, … ] }
```

組裝碼負責的是**每實例變異**:seed 決定挑哪一款、`stretch` 決定高瘦比、`partJitter` 決定零件抖動、
`vegPartXform` 決定整株的朝向與微傾。**烤一棵完整的樹進來,就是把這一整層丟掉** ——
一片林子會長得一模一樣,而且沒有任何錯誤訊息。

所以 AI 只產「零件」:

| 家族 | 現況零件 | AI 該產什麼 |
|---|---|---|
| 植被/神木 `VEG_DEFS` `GIANT_DEFS` | `cyl` 幹 + `ico`/`cone` 冠 | 3~5 款樹冠模組、2~3 款分枝、板根 |
| 巨石 `MEGALITHS` | `Box`/`Sphere` + 手寫岩溝 | 岩面片、崩落塊、山腳碎石錐 |
| 地標 `KIND_PARTS` | `['cyl'|'box'|'cone'|'ico']` | 格構節點、微波碟、水塔桶身、貨櫃 |
| 建物 `hazards.js BUILDERS` | 拉伸盒 | 窗組模組、屋頂帽、陽台/雨遮、外掛管線 |

---

## 1. 取材:授權是硬閘,不是建議

- **Openverse API**(`api.openverse.org`):**免金鑰**、8 億+ 件,來源涵蓋 Flickr / Wikimedia / 博物館,
  支援 `license` 過濾。
- **Wikimedia Commons API**:補地標類;每筆帶授權、作者、尺寸、分類。

**規則**

1. 查詢**寫死 `license=cc0`**(含 public domain)。**CC-BY 也不收** —— 一顆烤進 repo 的岩石沒有地方
   掛署名,而授權出事不會有任何錯誤訊息。
2. 每筆下載連同 `{source_url, license, creator, retrieved_at}` 寫進 `tools/ai3d/photo_manifest.json` 留檔。
3. **照片只是離線輸入,不進 repo**;進 repo 的只有零件庫 GLB。

**選片準則**(與 `mech-part-forge` §4.1 同一套,但這裡是挑不是生成):
單一主體、背景乾淨、平光無強投影、不透明、無人/車遮擋、短邊 ≥1024、避開廣角近攝的透視變形。
一張好照片勝過三張補圖。

---

## 2. 產製流程

```
Openverse / Commons(license=cc0)
    │  下載 + photo_manifest.json 留檔
    ▼
挑片 →〔rembg 去背 → alpha〕
    │  單圖→3D:Stable Fast 3D(6GB,主力)/ Hunyuan3D 2.1 shape-only(10GB)/ TRELLIS.2(細節件)
    ▼
raw mesh → Blender headless:減面 → **原點落在接合面** → 朝向正規化(+Y 上、+Z 前)→ 匯出
    ▼
public/assets/models/parts/{family}.glb  →  partlib 查表  →  既有零件表挑用
```

**靜態這一半的主力是 SF3D 不是 TRELLIS**:一株樹要十幾個零件、一座地標要二十幾個,6GB/<1s 的
吞吐才撐得住批量;真正需要細節的少數件(神木樹冠、指標性巨岩)才升級到 TRELLIS.2 / Hunyuan。

**原點落在接合面**是這條線最容易漏的一步:樹冠零件的原點要在**冠底**、屋頂帽在**簷口**、
碎石錐在**地面**。原點在包圍盒中心的話,既有零件表裡那些 `y:` 值全部要重算 ——
而症狀是樹冠浮在半空,`audit_object_joints` 會報 FLOAT。

---

## 3. 執行期單一縫:`public/js/partlib.js`

```js
// beacons.js —— 只在 _geo() 多認一種描述,其餘一行不動
function _geo(g) {
  if (g[0] === 'lib') return libGeo(g[1]) ?? _geo(g[2]);   // g[2] = 原本的基本體描述 = 保險絲
  …
}

// biomes.js VEG_DEFS
{ g: libGeo('tree/canopy_c') ?? ico(2.7), y: 5.0, key: 'foliage', sy: 0.75 }
//                            ↑ 這個 ?? MUST 留著
```

**`beacons.js` 前半段 MUST 維持零 THREE** —— 那是它離線可驗的唯一原因(`audit_beacons.mjs` Ⅰ 釘住這條)。
零件描述仍是純資料 `['lib', name, 原本的基本體]`,查表發生在 `_geo` 那一層。

---

## 4. 四條不變式(這是驗收條件,不是建議)

1. **外廓實測**:碰撞柱 / `foot` / `col.r` 一律 `Box3.setFromObject` 量**換上新零件之後**的結果。
   標稱值沿用 = 演出頂出碰撞柱(A30)或地標被無謂推遠。`audit_beacons.mjs` Ⅰ 雙向釘住這一欄。
2. **零額外亂數**:換幾何 MUST NOT 多抽一枚 `rnd()`。多抽一枚 = 整張圖的植被/建物/障礙佈局序列
   整條推移(§2.3),而畫面上只表現成「這張圖跟上次不一樣」。
3. **共用幾何 `markShared()`**:零件庫幾何被大量 InstancedMesh 共用,`disposeTree` 必須依註冊表跳過(A25)。
4. **只有幾何 + 基色**:法線/金屬/粗糙貼圖一律不進 repo;顏色仍由零件表的 `c:` 決定 ⇒ 匯出的 GLB
   **MUST 讓基色可被覆寫**。

---

## 5. 驗收

```bash
node tools/audit_object_joints.mjs --seeds 8   # FLOAT/PARTIAL/DETACHED/ISOLATED 四硬失敗
node tools/audit_beacons.mjs                   # 外廓/碰撞/落點
node tools/audit_beacons.mjs --break-extent    # 反向驗證:撐爆一件零件 MUST 紅字
node tools/audit_traverse.mjs                  # 新零件沒把路擋住
node tools/audit_cel_pipeline.mjs              # ramp 家族/描邊不變
node tools/audit_visual_prefs.mjs              # 零件抖動不變式
node tools/audit_gpu_lifecycle.mjs             # 共用幾何
npm test && npm run bal                        # 純表現層 ⇒ MUST 逐位元不動
```

**反向驗證(原則 9)**:`--break-extent` / `--break-pad` 兩支跑不出紅字,就是這一輪沒驗到外廓。

**視覺閉環**:`node tools/shot_scene.mjs --venue taroko` 前後對照;
`--ink=0` / `--grade=0` / `--post=0` 逐層隔離 —— 「這張圖變醜是哪一層造成的」要能回答。

---

## 6. 會靜默壞掉的六件事

1. **烤成整棵樹/整棟樓** → 每實例變異消失 → 一片林子一模一樣,沒有錯誤訊息。
2. **原點不在接合面** → 樹冠浮空/屋頂帽陷進牆 → `audit_object_joints` 報 FLOAT/PARTIAL。
3. **碰撞柱沿用標稱值** → 看得見的外廓頂出碰撞柱(A30)→ 打得到的地方和看得到的地方分家。
4. **多抽一枚 `rnd()`** → 整張圖佈局位移 → 跨客戶端場景不一致(§2.3 / A4)。
5. **收了 CC-BY 卻沒署名** → 授權污染,無任何錯誤訊息 ⇒ 查詢寫死 `license=cc0`。
6. **面數沒有預算** → 一座地標二十幾個高模零件 → 勾線 pass 變重、手機端幀時掉。
   預算 MUST 由**量測現值**推導,不是手寫。

---

## 7. 12GB 選型速查

| 工具 | VRAM | 角色 |
|---|---|---|
| Stable Fast 3D | 6GB、<1s,自帶 delight + UV | **靜態主力**,批量掃貨 |
| Hunyuan3D 2.1(shape only) | 10GB(paint 21GB **不跑**) | 中階細節件 |
| TRELLIS.2-4B | 官方標 24GB;社群 8GB@256 / 12GB@512 | 指標性件,**MUST 先實測** |
| P3-SAM | 待實測 | 需要把一顆掃描件切成多個零件時 |

降級鏈:`TRELLIS.2 → Hunyuan3D shape-only → SF3D → 維持現有程序零件`。
跑不動就往下退,**不准為了跑得動而改判定或改契約**。
