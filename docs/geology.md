# 地質物件生成

此模組產生可渲染的風格化地質物件，透過 `backgroundObjects.js` 的共同型錄出口使用。
預覽執行 `node tools/geology_preview.mjs`，開啟 http://127.0.0.1:8634。
預覽只綁定 loopback，沒有掛進正式戰鬥伺服器。

## 分類與參數

唯一資料來源為 `public/js/geology.js` 的 `GEOLOGY_TYPES` 與 `GEOLOGY_SURFACES`；研究台直接讀取其範圍。
分類分為岩性、形成作用、地貌與表層四個維度：

| 岩性 | 地貌原型 | 主要形成作用 |
| --- | --- | --- |
| 火成岩 | 花崗岩塊、玄武岩節理、火山口 | 節理風化、冷卻、噴發與塌陷 |
| 沉積岩 | 砂岩台地、石灰岩峰、海蝕島礁 | 沉積、差異侵蝕、溶蝕、海浪沖刷 |
| 變質岩 | 山巒、斷層崖 | 抬升、褶皺、斷裂與侵蝕 |
| 未固結沉積物 | 土堆、沙丘、河灘、冰磧丘 | 重力搬運、風成、流水、冰川堆積 |
| 生物成因 | 淺海珊瑚礁 | 碳酸鹽骨架累積 |
| 人造 | 石砌基座 | 切割與堆砌 |

每類各有寬度、高度、年代及粗糙度區間，種子抽樣；深寬比、走向、傾角、層數亦獨立抽樣。
寬高以公尺計，年代以 Ma（百萬年）計。寬高是造型包絡參數；實際 bounds 從輸出頂點量測。
年代描述岩層／堆積物的形成時間，不代表曝露時間。風化強度由 exposure 控制，不從岩齡推定。
這些區間是遊戲美術設定，不是地質調查、氣候預報或全球分布資料。

| 環境輸入 | 單位／範圍 | 用途 |
| --- | --- | --- |
| latitude、altitude | 度、公尺 | 估算溫度、調整山地權重 |
| climate | tropical / temperate / boreal / arid / mediterranean / alpine | 沿用森林氣候基準，另作緯度與高度修正 |
| temperature | °C，可選 | 覆寫估算溫度 |
| moisture | 0–1 | 青苔、泥、積水、草與沙丘權重 |
| water | none / stream / river / lake / sea | 區分流水沖積與海岸地貌 |
| depth | 0–11000 m | 水下抑制陸生覆蓋；淺海礁資格 |
| vegetation、conifers | 0–1 | 草、落葉、木屑及毬果來源 |
| wind、sediment | 0–1 | 風成、堆積與沙塵覆蓋 |
| fault、volcanic、human | 0–1 | 斷層、火山與人造物件抽樣權重 |
| exposure、dissolution | 0–1 | 侵蝕平滑程度、石灰岩溶蝕形狀 |

`auto` 按環境分布抽樣；指定類別是作者覆寫，允許比較同一形狀在不同環境下的表層。
淺海珊瑚礁在自動抽樣中要求海水、20–30°C、水深不超過 30 m。此限制僅是本原型的美術棲地窗；
[NOAA 的淺海珊瑚說明](https://oceanservice.noaa.gov/education/tutorial_corals/coral05_distribution.html)支持溫暖、充足光線的選擇，
[深海珊瑚也存在](https://oceanexplorer.noaa.gov/ocean-fact/coral-water/)，並不套用此限制。
岩性與形成作用參考 [USGS 岩石循環](https://pubs.usgs.gov/bul/2195/b2195.pdf)。

## 表層與渲染

裸岩為剩餘機率；總覆蓋機率上限 90%。淤泥、沙塵、青苔、地衣、積雪與積水以頂點色斑塊呈現；
碎石、木屑、落葉、毬果與長草另加低面數細節，每物件上限 180 個。
沉積物與有機碎屑只接受朝上程度大於 .82 的面；青苔與地衣可在陡面生長。
積水僅接受朝上程度不低於 .995 且位於低處的面，採不透明水色表示濕潤積水。
所有附著點取自已生成三角形的重心，法向量也由同一三角形求得。

目前使用 28 × 28 網格的高度場造型與共用 vertex-color renderer，適合背景與美術原型。
沒有洞穴、懸挑、流體模擬、透明反射水面或實測地層資料。
尚未加入戰場自動散布或新的權威碰撞體；地貌大型化需由既有場地配置、限高與 blocker 流程接納。
不可把這些視覺網格直接用作戰鬥射線目標。

## API

```js
import { generateSharedBackgroundObject } from './backgroundObjects.js';
import { makeRuntimePartModel } from './runtimePartModel.js';

const entry = generateSharedBackgroundObject('geology/karst', 42, {
  latitude: 25, altitude: 500, climate: 'tropical',
  moisture: .8, dissolution: .9, vegetation: .5,
});
const mesh = makeRuntimePartModel(entry);
```

`geologyDistribution(environment)` 回傳正規化候選權重；`generateGeology(type, seed, environment)`
回傳造型參數與表層機率；`geologyBackgroundObject` 生成 meshData、量測 bounds 與表層統計。
`sharedBackgroundObjectTargets('geology')` 列出可用 target。
固定種子與輸入可重現結果；造型、覆蓋各用獨立 mulberry32，新增表層不推進場景亂數。

## 驗證

`node tools/audit_geology.mjs` 檢查 14 類 × 4 種子、有限頂點、色彩、面索引、bounds、
坡面附著、植被來源限制、棲地資格、參數區間與型錄出口。
已加入核心 audit suite。
