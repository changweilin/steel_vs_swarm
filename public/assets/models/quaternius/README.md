# Quaternius CC0 建模庫開發包 — public/assets/models/quaternius/

[Quaternius](https://quaternius.com) 是長期維護的一套**低面數、風格統一**的 3D 資產庫,
全部以 **CC0(公眾領域)** 釋出。這個資料夾是本專案的「Quaternius 升級槽」:
把對應的 `.glb` 丟進來、登記一下,就能就地覆蓋城市地標 / 角色棋子的程式生成版本;
載入失敗會自動退回程式生成,**不會把棋盤弄壞**。

> 上層通用說明見 `../README.md`;3D 準則見 `.claude/skills/3d-web-game/SKILL.md`。

---

## ✅ 已預載 + 預設使用(2026-06)

本資料夾**已預載 23 個 Quaternius 模型(全部 CC0 1.0,免署名)**,`board3d.js` 預設就用,
搭配「純扁平 matte」美術(`matteify` + `fitToSize`)。載入失敗會自動退回程式生成,不開天窗。

- **城市天際線**(`SKYLINE_BUILDINGS`,**不在 MODEL_MANIFEST**)→ 10 棟建築/結構:
  `bldg-big / bldg-business / bldg-generic / bldg-l / bldg-small / structure / cyber-platform /
  dome / silo / spaceship`。在 `_buildCity` 裡繞**地標外圈**當天際線,棟數/高度**隨城市等級成長**。
  > 城市**正中央地標**改回程式生成的 `LANDMARK_BUILDERS`(每城不同、對應現實、隨等級長高),
  > 因此 `MODEL_MANIFEST` **不再放 `city:*`**;要用 GLTF 蓋掉某城地標可自行用 `window.MODEL_MANIFEST_EXTRA`。
- **角色棋子(`pawn:*`,在 MODEL_MANIFEST)** → 惡搞對位:`astronaut`=馬斯克(太空)、
  `alien`=祖克(蜥蜴/Meta)、`anglerfish`=梁文鋒(深海 DeepSeek)、`panda`=李彥宏(百度熊掌)、
  `sportscar`=豐田(車廠)、`mech/mech2`=華為/台積、`robot`=三星、`cubeguy/cubewoman`=Google/騰訊、
  `hoodie`=賈伯斯、`casual`=馬雲、`exec`=黃仁勳。

### 致謝 & 授權
全部來自 **[Quaternius](https://quaternius.com)**(經 [Poly Pizza](https://poly.pizza/u/Quaternius) 取得),
授權 **CC0 1.0**(公眾領域,可商用、免署名)。仍感謝 Quaternius (Tom) 的長期 CC0 貢獻 🙏。

### 想換掉 / 還原成程式生成?
- **棋子**:改 `MODEL_MANIFEST` 的 `pawn:*`(換成自己的 `.glb` 或刪行 → 退回程式生成惡搞剪影)。
- **天際線**:改 `board3d.js` 的 `SKYLINE_BUILDINGS` 清單;清空則城市只剩中央地標。
- **地標**:預設就是程式生成(`LANDMARK_BUILDERS`),要蓋掉用 `window.MODEL_MANIFEST_EXTRA={'city:sv':'…'}`。

---

## 授權重點(動手前讀一次)

- **CC0 / 公眾領域**:可個人、教育、**商用**,**免署名**。仍建議在致謝頁感謝 Quaternius(Tom / quaternius)。
- **NoAI 標註**:部分包標有 `NoAI`,意思是**不可拿去訓練生成式 AI 模型**。
  我們只是把模型放進遊戲呈現,**不受影響**;但**不要**把這些檔案餵進 AI 訓練 / 微調資料集。
- **格式**:官網每個包提供 **glTF / GLB / FBX / OBJ / Blend**。本專案一律用 **`.glb`**(單檔含貼圖)。

---

## 三種取得 `.glb` 的方式

1. **Poly Pizza(最快,單體直下)** — <https://poly.pizza>(搜尋作者 `Quaternius`)。
   每個模型頁有 **Download → glTF/GLB**,下載即用,適合「我只要一棟樓 / 一台車」。
2. **官網整包** — <https://quaternius.com> 下載 ZIP(常見 `Downtown City MegaKit`、
   `Ultimate Vehicles`、`Animated Characters`、`Nature Kit` 等)。整包通常是**一個大檔含很多 mesh**,
   要抽單體:用 **Blender** 開 → 選取目標物件 → `File ▸ Export ▸ glTF 2.0 (.glb)` 勾「Selected Objects」。
3. **itch.io / Sketchfab(quaternius)** — 同樣 CC0,介面不同而已。

> 拿到 `.gltf + .bin + 貼圖` 也行(放同一資料夾即可),但 **`.glb` 單檔最省事**,
> 可用 `npx gltf-pipeline -i in.gltf -o out.glb` 合併。

---

## 放檔 + 命名 + 啟用

### 1) 放檔
把 `.glb` 放進**這個資料夾**,檔名隨意(建議用對應的 key,例:`city-sv.glb`、`pawn-musk.glb`)。

### 2) 啟用(擇一)
- **A. 改原始碼**:打開 `public/js/board3d.js` 的 `MODEL_MANIFEST`,加一行:
  ```js
  const MODEL_MANIFEST = Object.assign({
    'city:sv':   'assets/models/quaternius/city-sv.glb',
    'pawn:musk': 'assets/models/quaternius/pawn-musk.glb',
  }, (typeof window !== 'undefined' && window.MODEL_MANIFEST_EXTRA) || {});
  ```
- **B. 不動原始碼(推薦做開發包整批掛載)**:在 `public/index.html` 載入 `js/ui.js` 的
  `<script type="module">` **之前**插入一段一般 `<script>`:
  ```html
  <script>
    window.MODEL_MANIFEST_EXTRA = {
      'city:sv':       'assets/models/quaternius/city-sv.glb',
      'city:shenzhen': 'assets/models/quaternius/city-shenzhen.glb',
      // 'pawn:lee':   'assets/models/quaternius/pawn-lee.glb',
    };
  </script>
  ```
  `board3d.js` 會把 `MODEL_MANIFEST_EXTRA` 自動併進 `MODEL_MANIFEST`(同 key 覆蓋)。

### 3) 重新整理頁面
模型會被 `fitToHeight` 自動縮放到棋盤尺度(**地標高 ≈1.7、棋子高 ≈1.2**)、底部坐在地面,
不必自己調 scale / 位置。

> **key 慣例**:`city:<regionId>` / `pawn:<charId>`。完整 id 清單見 `../README.md`。

---

## 建議對應表(Quaternius 包 → 本遊戲）

低面數風格化最適合「**城市天際線**」與「**載具**」;角色維持惡搞剪影、不做寫實肖像。

| Quaternius 包 | CC0 | 對應到 | key 範例 | 備註 |
|---|---|---|---|---|
| **Downtown City MegaKit** / Sci-Fi Buildings | ✅ | 科技城天際線、摩天樓地標 | `city:sv` `city:shenzhen` `city:nyc` `city:beijing` `city:dubai` | 抽單棟高樓即可;成群可拼天際線 |
| **Cyberpunk / Modular Sci-Fi** | ✅ | 賽博風城市、特殊地標 | `city:tokyo` `city:seoul` `city:singapore` | 與本專案霓虹基調最搭 |
| **Ultimate Vehicles / Cars / Trains / Ships / Spaceships** | ✅ | 航線載具(飛機/船/火車) | — | ⚠️ 載具目前是**程式生成、尚未開槽**,要用得先在 board3d 加 key(見下「限制」) |
| **Nature Kit(樹/地形)** | ✅ | 森林 / 山丘升級 | — | 目前森林用 InstancedMesh 程式生成;換 GLTF 要改 `_buildTerrain`(成本高,先評估) |
| **Animated Universal / Base Characters, Robots** | ✅ | 棋子底身(再疊梗道具) | `pawn:*` | 維持「特徵剪影 > 臉部細節」,**不要寫實肖像**(美術基調 + 肖像權) |

> 找不到完美對位很正常 —— Quaternius 是**通用素材**。原則:**先拿來鋪量 / 當底,梗特徵仍用 primitive 疊**,
> 識別度(俯視一眼認出哪座城 / 哪個人)永遠優先於寫實。

---

## 規範 & 限制(讓載入順利、別踩雷)

- **面數**:地標 < 30k、棋子 < 10k(LAN 多人,愈輕愈好)。Quaternius 本就低面數,通常沒問題。
- **朝向**:+Y 朝上、大致置中;高度不限(`fitToHeight` 會處理)。
- **外部模型沒有零件級待機動畫**:`buildModel` 載入 GLTF 後會清空 `userData.anim`,
  原本程式生成的 spin/bob 等待機動作就沒了。要保留「會動一點點」的霓虹感,
  可只把 GLTF 用在**地標**、棋子仍用程式生成;或之後再為 GLTF 加整體 group 動畫。
- **載具尚未開槽**:`buildModel` 目前只在 `city:`(地標)與 `pawn:`(棋子)呼叫。
  plane/ship/train 是程式生成且未走 manifest,要換 Quaternius 載具需先在 `board3d.js`
  替載具建構處加 key + `buildModel`(屬於功能變更,動手前先確認需求)。
- **預設已使用 23 個 CC0 模型**(棋子走 `MODEL_MANIFEST` 的 `pawn:*`、天際線走 `SKYLINE_BUILDINGS`)。
  要回到「零外部請求」就清空 `pawn:*` 與 `SKYLINE_BUILDINGS`。別把**不存在**的檔案寫進去,否則 404
  (雖然會 fallback,但有 console warning)。

---

## 改完自我檢查

- [ ] `.glb` 放在本資料夾、key 用對(`city:<regionId>` / `pawn:<charId>`)?
- [ ] 用 A(改原始碼)或 B(`MODEL_MANIFEST_EXTRA`)其中一種登記,沒有指向不存在的檔?
- [ ] 俯視一眼還認得出是哪座城 / 哪個人(識別度沒掉)?維持霓虹基調、沒做寫實肖像?
- [ ] `node --check public/js/board3d.js` 過;瀏覽器實看外觀(node 無法驗 3D)。
