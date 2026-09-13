# 程序森林

一般植被、神木群落與邊界樹木共用 `public/js/forest.js`，樹種資料集中於 `public/js/forestSpecies.js`。38 類植物逐株由座標種子生成；照片參考 `tools/ai3d/photos/tree/` 中的闊葉樹、針葉樹與板根巨木。遊戲不載入照片，也不依賴外部生成服務。

## 舊規則解析與取捨

| 舊來源 | 判定與整合 |
| --- | --- |
| `VEG_DEFS` 闊葉、白樺 | 保留側枝接幹、錯落葉簇與淺色樹皮；一般散布改用氣候選種，新增 `forestBirch`。 |
| 針葉四款、竹林 | 保留尖冠／層冠、竹節／多稈，交由現有 spire、tiers、bamboo 骨架抽樣；移除一般散布只依相對高度選針葉樹的最終決定權。 |
| 枯木三根同軸柱、整樹替代節點 | 不再作一般散布的模型來源。枯木改為相接側枝與破損頂梢，雷擊木另有焦黑色與裂梢；倒木用橫向幹與沿幹碰撞柱。舊資料仍供既有零件台查看。 |
| 固定多肉／灌木 | 一般散布移交氣候選種；多肉使用基生蓮座葉，不沿用樹幹頂著葉球的規則。 |
| 岩壁松的等徑長彎管、獨立疊錐冠 | 保留實測壁面、入岩彎根與冠部向上，縮短並收細彎幹；冠與上幹直接使用 `cliffPine` 生成器。 |
| 缺失坡度範圍 | 不再等同無限耐坡。45° 起必須有 `steep: true`，85° 起全部略過；仍須通過個別適生權重。 |
| 未審核舊模型 | 不轉成正式資產、不更動審核狀態。整合的是可解釋的形態規則。 |
| 蘑菇、鳥巢、岩石 | 不列為植物種類，保留原本用途。 |

一般植被保留原本姿態亂數抽取次數；選種和建模使用座標亂數。一般散布的高樹以公稱 9m 上限等比縮小，群落沿用世界高度限制。氣候、占位與新增種類會改變植被結果，但新增器官不額外消耗共享序列。

陡坡候選為岩坡松、杜鵑、杜松、灌木櫟與地生蕨，各自仍受氣候及坡度上限限制；沒有合格候選就留白。自然地形用 2m 以內差分探測，地圖作者指定的坡度只能提高實際坡度，不能把陡崖覆寫成平地。一般草、蘆葦等舊散布也接受 45° 排除。岩石側壁附生物則沿用 `rockProbe` 的實際表面判定。

## 新增氣候形態

| ID | 形態／氣候 |
| --- | --- |
| `deadwood` / `lightningSnag` / `fallenLog` | 跨氣候枯立木、焦黑雷擊裂梢、橫向倒木；倒木在 28° 起排除。 |
| `cliffPine` / `forestBirch` | 冷涼岩坡矮松、溫帶淺皮白樺。 |
| `agave` / `aloe` | 乾燥地區放射蓮座肉質葉。 |
| `forestFern` / `treeFern` | 濕潤地區地生蕨與有幹樹蕨，葉軸兩側分出小葉。 |
| `giantFlower` | 暖濕大型花草，美術概括型，葉尖花柄與五瓣花。 |
| `pitcherPlant` | 暖濕酸性環境的豬籠草型，捕蟲囊、深色囊口與蓋片。 |
| `dragonBlood` | 乾燥地區龍血樹，分枝向外展開，枝梢叢生劍葉。 |
| `welwitschia` | 乾燥地區百歲蘭，兩片對生長葉分裂成連續帶狀葉段。 |
| `silversword` | 高海拔乾燥地區銀劍草，銀白蓮座葉。 |
| `desertRose` / `cucumberTree` | 乾燥地區沙漠玫瑰與黃瓜樹，膨大基幹；沙漠玫瑰有粉花。黃瓜樹指 *Dendrosicyos socotranus*。 |
| `saguaro` | 乾燥地區柱狀仙人掌，側臂向上。 |

上述氣候帶、尺寸與頻率是遊戲美術範圍，並非原生地分布資料；不模擬捕蟲、雷擊事件或生命週期。

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

驗證：`node tools/audit_forest.mjs`（7,600 株、坡度邊界、乾濕氣候排除、環境機率、花果與骨架穩定性）、`node tools/audit_tree_joints.mjs`、`node tools/audit_gpu_lifecycle.mjs`。

## 植物學參考

形態特徵參考以下來源；尺寸、季節、適生區與權重是經美術簡化的遊戲參數，並非精確自然分布或植物生長模擬。

- [RHS：杜鵑的酸性土壤與淺根](https://www.rhs.org.uk/plants/rhododendron/growing-guide)
- [NParks：榕樹與氣生支柱根](https://www.nparks.gov.sg/florafaunaweb/flora/2/8/2899)
- [NParks：Bambusa vulgaris 竹稈、叢生與地下莖](https://www.nparks.gov.sg/florafaunaweb/flora/3/6/3600)
- [NParks：紅樹林與呼吸根](https://www.nparks.gov.sg/publications-resources/articles/recognising-trees-of-the-mangroves)
- [RHS：冬青櫟的土壤條件](https://www.rhs.org.uk/plants/14264/quercus-ilex/details)
- [Kew：猴麵包樹的膨大樹幹](https://www.kew.org/sites/default/files/2019-04/Sustainable%20wild%20plants.pdf)
- [Wikipedia：椰子](https://en.wikipedia.org/wiki/Coconut)
- [Kew：百歲蘭的兩片葉、莖基及主根](https://www.kew.org/plants/welwitschia-mirabilis)
- [NPS：銀劍草的銀色肉質蓮座葉與乾燥火山坡地](https://www.nps.gov/locations/hawaii/silverswords.htm)
- [RHS：龍血樹的分枝與傘形劍葉冠](https://www.rhs.org.uk/plants/20885/dracaena-cinnabari/details)
- [Friends of Soqotra：黃瓜樹的瓶狀多肉樹幹](https://www.friendsofsoqotra.org/Activities/pdfs/Tayf%2018%20English.pdf)
