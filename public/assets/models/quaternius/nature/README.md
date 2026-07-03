# Quaternius「Ultimate Stylized Nature」植被模型 — nature/

來源:[quaternius.com](https://quaternius.com/packs/ultimatestylizednature.html)(Google Drive 官方載點,glTF 資料夾)。
授權 **CC0 1.0**(公眾領域,可商用、免署名)。感謝 Quaternius 🙏。

## 內容與對應(biomes.js 的 `NATURE_MANIFEST`)

| 檔案 | 對應植被類型 |
|---|---|
| `MapleTree_1~3` | broadleaf(闊葉林) |
| `BirchTree_1~2` | birch(樺樹,綠地混生 30%) |
| `Bush` / `Bush_Large` / `Bush_Small_Flowers` | shrub(灌木) |
| `Grass_Large` / `Grass_Small` | silvergrass(芒草) |
| `DeadTree_1~2` | deadtree(枯樹,裸露地) |

## 加工說明(重下載時要重做)

- **法線貼圖已刪除**(每張 19~22MB,toon 渲染用不到):`*_Normal.png` 刪檔,
  並改寫各 `.gltf`(移除 `material.normalTexture` + 孤兒 images/textures 索引重整)。
  整包從 67MB 瘦到 ~5MB。
- 載入端(`biomes.js extractNatureParts`)會把材質換成 **MeshToonMaterial**(日漫賽璐璐),
  保留 baseColor 貼圖、葉片 `alphaTest 0.5` 鏤空、按季節乘色偏(`SEASON_LEAF_TINT`)。
- 幾何被正規化(高 1、底貼地)後進 **InstancedMesh**;變體以 `實例序 % 變體數` 決定性分配,
  全房間玩家看到同一片森林。

## 想加新模型?

丟 `.gltf + .bin + 貼圖` 進本資料夾,在 `biomes.js` 的 `NATURE_MANIFEST` 加一行
(`type: { files: [...], h: 目標高度 }`)。載入失敗自動退回程序生成,不開天窗。
松樹(conifer)、竹林(bamboo)、紅樹林(mangrove)目前仍是程序生成 —— 官方 glTF 資料夾沒有對應網格。
