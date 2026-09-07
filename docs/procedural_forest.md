# 程序森林

神木群落與邊界樹木共用 `public/js/forest.js`，樹種資料集中於 `public/js/forestSpecies.js`。21 類植物逐株由座標種子生成；照片參考 `tools/ai3d/photos/tree/` 中的闊葉樹、針葉樹與板根巨木。遊戲不載入照片，也不依賴外部生成服務。

## 植物形態

保留紅杉、巨杉、尤加利、花旗松、錫特卡雲杉、娑羅雙、台灣杉、巴西巨木、克林基南洋杉、甘巴豆與智利柏；新增下列植物。下表為生成器公稱尺寸，進入場景後仍依既有體格、冠間距與世界高度上限等比調整。

| 類型 / ID | 樹高 m | 主幹半徑 m（幹圍 = 2πr） | 主枝數範圍 | 可辨識特徵 |
| --- | --- | --- | --- | --- |
| 竹叢 `forestBamboo` | 9–20 | .025–.05 | 每稈 4–8 層 | 5–10 根竹稈、竹節、狹長葉簇、地下莖 |
| 杜鵑 `rhododendron` | 1.2–6 | .06–.12 | 8–15 | 3–6 基生幹、低矮密冠、淺根、春季粉花、秋季蒴果 |
| 榕樹 `banyan` | 13.5–30 | .8–1.6 | 8–15 | 寬傘冠、3–7 支落地氣生根、夏秋榕果 |
| 灌木櫟 `scrubOak` | 1–5 | .075–.15 | 7–14 | 3–6 幹、乾燥灌叢、秋季橡實 |
| 冬青櫟 `holmOak` | 10.8–24 | .425–.85 | 7–14 | 耐乾傘冠、側根、秋季橡實 |
| 柳樹 `willow` | 11.25–25 | .35–.7 | 9–17 | 下垂細枝、濕潤地表根、春季柔荑花序 |
| 杜松 `juniper` | 1.2–8 | .125–.25 | 6–13 | 冷涼多幹灌叢、藍色漿果狀球果 |
| 海茄苳 `mangroveGrey` | 6.75–15 | .225–.45 | 6–12 | 鹽濕地紅樹林、10–18 支向上呼吸根、夏花秋果 |
| 椰子 `coconut` | 12.6–28 | .125–.25 | 9–15 葉柄 | 羽狀葉、小葉數與長度變化、鬚根、椰果 |
| 猴麵包樹 `baobab` | 11.25–25 | 1.47–4.2 | 5–10 | 膨大幹、疏冠、側根、夏花秋果 |

`growth` 定義各類的樹高倍率、幹半徑倍率、枝數、冠簇尺度、密度、根數及幹數範圍。根系由樹種決定，尺寸與數量逐株抽樣。`grove.count/spread` 控制群落株數與散布半徑；竹林、灌叢使用較密集配置。

`flower/fruit` 各有出現機率、數量、尺寸、顏色與季節。竹類不產生常態花果；柳樹以長條花序呈現。針葉樹的 `fruit` 通道用於球果，名稱屬渲染分類。季節沿用遊戲的 `spring/summer/autumn/winter`，不是全球物候預測。花果使用獨立種子，換季不改變樹幹、根系或碰撞。

## 環境與比例

`lat`、`altitude` 與 `habitat` 的四值範圍皆為「外側下界、偏好下界、偏好上界、外側上界」：偏好區權重為 1，向外線性降至 0。各環境權重相乘，再乘 `share` 的群落權重，最後正規化成樹種機率。`share` 是相對權重範圍，不是最終百分比硬配額。

緯度使用絕對值；海拔優先讀原始海拔，坡度取自然地形差分。每株落點再次檢查適生條件，無合適樹種則略過。新增樹形與器官使用獨立亂數，不插入共享場景 RNG；環境或群落設定改變仍會依設計改變森林布局。

地圖作者可設定 `cfg.env.forest`（優先）或 `cfg.venue.forest`：

```js
forest: {
  climate: 'temperate',
  geology: 'granite',
  rainfall: 1800,
  regions: [
    { minX: -200, maxX: 0, minZ: -100, maxZ: 100, ph: 5, moisture: .75 },
    { minX: 0, maxX: 200, minZ: -100, maxZ: 100,
      temperature: 26, moisture: .95, salinity: .5 }
  ]
}
```

| 輸入 | 單位 / 行為 |
| --- | --- |
| `temperature` | 攝氏；省略時取氣候預設，再省略則以緯度和海拔估算 |
| `moisture` | 0–1 土壤濕度指標；濕地預設 .95，其餘取氣候預設或 .55 |
| `rainfall` | 年雨量 mm；未知則不套此項權重 |
| `ph` | 土壤酸鹼值；明示值優先於地質代理值，未知則不套此項權重 |
| `salinity` | 0–1 美術用鹽度指標，非 PSU；預設 0 |
| `slope` | 坡度（度）；省略則由地形計算 |
| `climate` | tropical / temperate / boreal / arid / mediterranean / alpine |
| `geology` | limestone / granite / sandstone / volcanic / alluvium / sand / peat |
| `regions` | 世界 x/z 公尺範圍，依序覆蓋；重疊時後者優先 |

沒有新增土壤或氣象下載服務。地質到 pH、緯度海拔到溫度均為可覆寫的遊戲代理值，不能視為當地實測。乾燥氣候允許從裸地選灌叢落點；紅樹林須明示鹽度，並通過實際地形水域判定、水面高度及最多 .8m 水深檢查，單獨填鹽度不會把乾地變成紅樹林。

可用 `treeDistribution(latitude, altitude, mix, environment)` 查比例，或 `treeHabitatWeight(type, latitude, altitude, environment)` 查單一植物適生權重。酸性花崗岩設定提高杜鵑適生度；石灰岩代理 pH 排除杜鵑；冷涼高地、乾燥灌叢與鹽濕地各有不同組成。

## 風擺與效能

幹枝每 5 個世界公尺增加一段。細長樹彎曲幅度較大、回擺較慢；高樹增加沿高度傳遞的相位延遲，根部位移為零。木質、葉冠、花、果共享同一局部座標與風參數，避免接點分離。

每株合併為 2–4 個繪製批次，逐頂點保存竹節、花果等顏色。幾何不進全域快取，離場走既有資源釋放流程。多竹稈、多幹灌木及榕樹落地支柱根由生成結果登記額外碰撞柱，地表占地包絡包含它們。

驗證：`node tools/audit_forest.mjs`（4,200 株、環境機率、花果與骨架穩定性）、`node tools/audit_tree_joints.mjs`，以及遊戲渲染器全 21 類建模、風擺與 GPU 回收檢查。

## 植物學參考

形態特徵參考以下來源；尺寸、季節、適生區與權重是經美術簡化的遊戲參數，並非精確自然分布或植物生長模擬。

- [RHS：杜鵑的酸性土壤與淺根](https://www.rhs.org.uk/plants/rhododendron/growing-guide)
- [NParks：榕樹與氣生支柱根](https://www.nparks.gov.sg/florafaunaweb/flora/2/8/2899)
- [NParks：Bambusa vulgaris 竹稈、叢生與地下莖](https://www.nparks.gov.sg/florafaunaweb/flora/3/6/3600)
- [NParks：紅樹林與呼吸根](https://www.nparks.gov.sg/publications-resources/articles/recognising-trees-of-the-mangroves)
- [RHS：冬青櫟的土壤條件](https://www.rhs.org.uk/plants/14264/quercus-ilex/details)
- [Kew：猴麵包樹的膨大樹幹](https://www.kew.org/sites/default/files/2019-04/Sustainable%20wild%20plants.pdf)
- [Wikipedia：椰子](https://en.wikipedia.org/wiki/Coconut)
