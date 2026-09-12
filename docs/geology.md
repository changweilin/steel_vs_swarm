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
| 人造 | 地區古蹟／廢棄遺跡 | 固定比例建築模板、殘構與落石 |

自然地質各有寬度、高度、年代及粗糙度區間，種子抽樣；深寬比、走向、傾角、層數亦獨立抽樣。
人造石材改用下述固定模板，僅允許整體等比例縮放。
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

### 舊版規則移植與陡坡

舊 `biomes.js` 的 `synthMegalith` 共 11 種主體規則；移植對照由 `LEGACY_GEOLOGY_RULES` 記錄。
新生成器沿用可由高度場表達的形狀規則，不搬入 Three.js 建構器或其場景亂數。

| 舊規則 | 新生成器 | 調整 |
| --- | --- | --- |
| dome | granite | 沿用圓頂露頭 |
| slab | cliff | 沿用岩壁，新增逐頂點貼地 |
| tower、mesa | rocktower、sandstone | 分別對應窄塔峰與寬台地 |
| basalt | basalt | 沿用節理柱群，新增逐頂點貼地 |
| granite | tor | 新增節理岩堆；以連續岩體與錯位節理取代整齊砌磚 |
| fin | fin | 新增中央較高、沿走向起伏的薄岩脊，可貼陡坡 |
| spire | spire | 新增向上收尖的侵蝕峰 |
| marble | marble | 新增圓蝕露頭；取消垂直串珠堆疊與「岩性必然決定堆法」的推定 |
| arch、hoodoo | 排除移植 | 高度場無法表達拱洞及帽岩懸挑，不生成實心假拱或浮空帽岩 |

舊戰場巨岩建構器已移除；`synthMegalith` 只保留呼叫共用生成器的相容入口。
這些是美術形狀對應，不代表各岩性只會產生這些地貌。

戰場透過 `geologyBattle.js` 的 `BATTLE_GEOLOGY` 與 `battleGeology` 使用同一份幾何：
uluru／augustus → 砂岩孤立岩丘；dabajian／舊 karst → 層狀砂岩塔峰；
torres → 花崗岩塔群；meteora → 礫岩圓頂峰；sigiriya → 花崗岩塊。
舊 karst 鍵保留相容性，型別改為原模板所描述的砂岩塔峰。
moai、machupicchu、stonehenge 分別走 rapa_nui、andes、britain 固定比例古蹟；
自然峰上的舊屋舍、外貼侵蝕溝線不再隨岩體生成。

戰場先將完整網格等比縮入名岩的既有尺寸上限，再量出實際半徑與高度交給放置／碰撞流程。
岩面裝飾由生成器三角形取樣，免除舊裝飾器與零件抖動的二次變形；岩色污漬改為連續斑帶與透底色。
戰場也傳入場地氣候、緯度與海拔；舊外貼地衣面片已移除，地衣、苔蘚與積雪只由生成器表層呈現。
巨岩散布使用獨立座標種子流，同一露頭群共用選型種子、逐顆保留形狀差異。
此次遷移會改變舊版佈局；新版固定輸入仍可重現，後續地質擴充不消耗共享場景亂數。
研究台新增「戰場巨岩」選項，可直接檢視十種名岩對應及戰場合成物件。

`GEOLOGY_STEEP_DEG = 45` 是美術配置門檻。`slope > 45` 時，自動抽樣先排除所有未宣告
`terrainFit` 的項目，再正規化權重；目前只有 `cliff`、`basalt`、`fin` 合格。
降雨、火山、人造活動或水域權重不能繞過此限制；45° 本身仍使用一般候選。
指定類別仍可作研究台覆寫，並不表示可放上該坡面。

貼地生成可傳 `heightAt(worldX, worldZ)` 與中心 `x`、`z`；每個網格頂點取樣地形，
保留其露頭高度，輸出 y 相對中心地表高度，呼叫端把物件放在中心地表上。
使用取樣器的自動模式只抽 `terrainFit` 類型；指定不相容類型會拋錯。
任何非有限高度使整個物件回傳 `null`，呼叫端應略過。未傳取樣器時維持水平基準的獨立模型。
呼叫端的 `slope` 應代表完整足跡最大坡度。戰場已接入候選包絡的網格坡度取樣與選型門檻；
落底仍走既有足跡最低點與平坦半徑門檻，逐頂點變形 API 供獨立貼地物件使用。

裸岩為剩餘機率；總覆蓋機率上限 90%。淤泥、沙塵、青苔、地衣、積雪與積水以頂點色斑塊呈現；
碎石、木屑、落葉、毬果與長草另加低面數細節，每物件上限 180 個。
沉積物與有機碎屑只接受朝上程度大於 .82 的面；青苔與地衣可在陡面生長。
積水僅接受朝上程度不低於 .995 且位於低處的面，採不透明水色表示濕潤積水。
所有附著點取自已生成三角形的重心，法向量也由同一三角形求得。

自然地質使用 28 × 28 網格的高度場；人造石材使用固定的多面體構造，支援柱廊、門洞及拱券。
兩者使用共用 vertex-color renderer，適合背景與美術原型。
沒有洞穴、懸挑、流體模擬、透明反射水面或實測地層資料。
自然巨岩與上述古蹟已接入既有戰場散布、限高與 blocker 流程；其餘地質仍供獨立生成。
不可把這些視覺網格直接用作戰鬥射線目標。

## 地區古蹟與廢墟

人造石材分為 `geology/monument`（地區古蹟）及 `geology/ruins`（隨機廢棄遺跡）。
`ancientStone.js` 統一選型與權重；`ancientRuins.js` 提供活動型遺跡幾何。
在人造物件抽樣中，有地區匹配時兩類各占 50%，沒有匹配時遺跡占 100%；
`human` 仍控制人造物在全體地質中的總權重，不因模板數量增加而改變。
舊 `geology/masonry` 入口保留，按上述人造物機率抽樣。
這套模板遵守固定比例契約；`biomes.js` 的三種人造巨岩地標也使用此共用出口。
造型為可辨識的簡化原型，並非考古測繪重建；尺寸與年代用作美術參考值。

| region | 人造石材 | 主要辨識特徵／參考 |
| --- | --- | --- |
| egypt | 埃及金字塔 | 方形基底、固定斜率四面錐體；[孟菲斯金字塔群](https://whc.unesco.org/en/list/86/) |
| maya | 瑪雅金字塔 | 九層階台、四面中央石階與頂部神殿；[奇琴伊察](https://whc.unesco.org/en/list/483/) |
| greece | 帕德嫩神殿 | 長方形柱廊、端部山牆、殘缺屋頂；[雅典衛城](https://whc.unesco.org/en/list/404/) |
| rome | 羅馬競技場 | 橢圓拱廊、階梯看台與缺失外牆；[羅馬歷史中心](https://whc.unesco.org/en/list/91/) |
| britain | 巨石陣 | 環狀立石、楣石與內圈三石組；[巨石陣](https://whc.unesco.org/en/list/373/) |
| andes | 馬丘比丘 | 階梯台地與山脊石屋遺址；[馬丘比丘](https://whc.unesco.org/en/list/274/) |
| rapa_nui | 摩艾像 | 石台、長臉、眉脊、長鼻與耳部；[拉帕努伊](https://whc.unesco.org/en/list/715/) |
| khmer | 吳哥窟 | 五塔、層台與周圍廊院；[吳哥](https://whc.unesco.org/en/list/668/) |
| qin | 秦皇陵 | 封土、陵園牆基與坑區輪廓；不虛構已揭露的地宮；[秦始皇陵](https://whc.unesco.org/en/list/441/) |

明確的 `region` 優先於座標；`region: 'auto'` 或未指定時，只有同時提供有效 `latitude` 與 `longitude`
才進行地區配對。每個地區採模板所定義的中心與公里半徑，這是美術適用圈，並非國界或古文明疆域。
單獨緯度不觸發配對。拉帕努伊與智利本土分開；關中也不代表全中國。
未知地區、座標未匹配或未提供完整座標時，從城牆、城門、碉堡、城堡、寺廟、神像、村落、陵寢、採石場
九類廢墟中按種子抽樣。它表示「目前型錄未匹配」，不代表當地真實歷史上沒有古蹟。

古蹟主體的零件比例與位置固定；種子只改變整體倍率、朝向及表層。
廢墟可按種子決定殘牆、屋舍與散落石塊，但生成後的整個物件仍只做等比例縮放。
`uniformScale` 是單一數值，預設抽樣 0.5–1.5，明確指定允許 0.01–10；三軸使用同一倍率，
連同表層細節一起縮放。`scale` 參數會拋錯，不接受三軸縮放；描述子標記 `scalePolicy: 'uniform'`。
後續場地配置若需要限高或限寬，也必須使用三軸限制比值中的最小值當作同一整體倍率。

```js
const entry = generateSharedBackgroundObject('geology/monument', 42, {
  region: 'greece', uniformScale: .75,
  moisture: .5, vegetation: .2,
});
// 或省略 region，傳入完整經緯度；未匹配時自动抽樣廢墟。
```

研究台分列兩種類別，可選「依生成機率抽樣」預覽人造物選型；指定遺跡時可按活動挑選形式。
`ruinType` 僅供指定 `ruins` 類別覆寫，預設 `auto`。無匹配時指定古蹟也會降為隨機遺跡。

| 活動 | 廢棄遺跡形式 |
| --- | --- |
| 防禦 | 城牆、城門、碉堡、城堡、烽火瞭望台 |
| 居住／生活 | 村落、浴場 |
| 農牧／儲藏 | 農莊與梯田、打穀場、畜圈與牧人屋、石造糧倉 |
| 水利 | 石井、蓄水池、引水渠 |
| 交通／交易 | 石拱橋、石碼頭、驛站與商旅院、市集 |
| 生產 | 採石場、陶窯、冶煉作坊、磨坊與石磨、礦坑入口 |
| 祭祀／喪葬 | 寺廟、神像、祭壇與立石、陵寢、墓園與石棺 |

這些活動形式是通用美術原型，不宣稱每一形式都存在於任一地區或年代。

新增 17 個地區模板，現有名冊共 26 個古蹟、28 類廢棄遺跡。以下造型由 `ancientStoneSites.js`
使用共用石材幾何工具生成；全部遵守相同的固定比例、獨立種子及表層縮放契約。
中心座標與適用半徑是遊戲美術配對值，不是文化疆界。

| region | 新增代表模板 | 參考 |
| --- | --- | --- |
| zimbabwe | 大辛巴威橢圓圍牆、錐塔 | [UNESCO](https://whc.unesco.org/en/list/364/) |
| ethiopia_highlands | 拉利貝拉十字岩鑿教堂與岩坑 | [UNESCO](https://whc.unesco.org/en/list/18/) |
| jordan | 佩特拉砂岩壁、墓殿柱廊 | [UNESCO](https://whc.unesco.org/en/list/326/) |
| hejaz | 黑格拉岩丘與階梯冠飾墓面 | [UNESCO](https://www.unesco.org/en/alula/multimedia/hegra) |
| persia | 波斯波利斯高台與宮殿柱林 | [UNESCO](https://whc.unesco.org/en/list/114/) |
| upper_mesopotamia | 哥貝克力環牆與 T 形石柱 | [UNESCO](https://whc.unesco.org/en/list/1572/) |
| armenia | 格加爾德山谷教堂與岩壁 | [UNESCO](https://whc.unesco.org/en/list/960/) |
| central_india | 桑奇覆缽塔、石欄與四面牌坊 | [UNESCO](https://whc.unesco.org/en/list/524/) |
| tamil | 朱羅層疊高塔與前殿 | [UNESCO](https://whc.unesco.org/en/list/250/) |
| java | 婆羅浮屠方台、圓台與鐘形塔群 | [UNESCO](https://whc.unesco.org/en/list/592/) |
| silla | 石窟庵剖開展示的石室與佛像 | [UNESCO](https://whc.unesco.org/en/list/736/) |
| ryukyu | 琉球層台城牆與門道 | [UNESCO](https://whc.unesco.org/en/list/972/) |
| malta | 馬爾他半圓室與巨石門框 | [UNESCO](https://whc.unesco.org/en/list/132/) |
| sardinia | 努拉吉主塔、副塔與圓屋 | [UNESCO](https://whc.unesco.org/en/list/833/) |
| altiplano | 蒂瓦納庫太陽門與石造庭院 | [UNESCO](https://whc.unesco.org/en/list/567/) |
| four_corners | 查科多層大屋與圓形儀式空間 | [UNESCO](https://whc.unesco.org/en/list/353/) |
| pohnpei | 南馬都爾人工島基、交錯石牆與水道留空 | [UNESCO](https://whc.unesco.org/en/list/1503/) |

這些模板保留代表性輪廓，不聲稱完整重建原址。婆羅浮屠塔數簡化；石窟庵有展示剖口；
岩墓立面未挖通墓室；南馬都爾水道只留出空間，海水仍由場景水體提供。

## 不穩定與特殊地質

特殊地質 12 類，加上移植地貌後型錄共 35 類。下表由型錄範圍產生；單位為公尺，均為遊戲美術尺度。

| target 後綴 | 類別 | 寬度 m | 地貌高度 m |
| --- | --- | --- | --- |
| debris_flow | 土石流 | 20–80 | 4–20 |
| landslide | 崩塌地 | 20–90 | 10–45 |
| landslide_lake | 偃塞湖 | 30–100 | 8–30 |
| slope_creep | 走山／滑動山體 | 25–90 | 12–40 |
| eruption | 火山噴發 | 25–80 | 12–40 |
| badlands | 惡地 | 15–70 | 6–28 |
| geothermal | 地熱／噴氣孔 | 8–30 | 1–5 |
| mud_volcano | 泥火山 | 8–35 | 2–10 |
| hot_spring | 溫泉／礦物沉積池 | 8–30 | 1–5 |
| fountain | 天然噴泉／承壓湧泉 | 6–20 | 0.6–3 |
| geyser | 間歇泉 | 6–22 | 1–4 |
| impact_crater | 隕石坑 | 25–100 | 5–22 |

土石流採狹長流路與扇形堆積，崩塌地包含崩壁與坡腳堆積，走山採階狀滑動塊體及張裂溝。
偃塞湖包含谷側、橫向壩體與上游平坦水面；與一般岩面積水分開處理。
惡地採密集侵蝕溝；隕石坑採低坑底與環狀隆起坑緣，不使用火山噴發模板。
走山是地表變形的通俗分類，這裡不推定其速度或特定地質機制。

| 新輸入 | 範圍 | 自動抽樣用途 |
| --- | --- | --- |
| slope | 0–90°，預設 0 | 陡坡與降雨、斷層或不穩定程度共同增加坡地活動權重 |
| rainfall | 0–1，預設 0 | 降雨／融雪觸發的美術指標；土石流另需沉積物 |
| instability | 0–1，預設 0 | 山體滑移與崩塌 |
| geothermal | 0–1，預設 0 | 地熱、溫泉、間歇泉；獨立於火山權重 |
| gasPressure | 0–1，預設 0 | 氣體驅動泥火山，另受 sediment 影響 |
| springPressure | 0–1，預設 0 | 承壓湧泉；和地熱共同決定間歇泉资格 |
| impact | 0–1，預設 0 | 撞擊地貌，獨立於緯度及火山作用 |
| activity | 0–1，預設 .7 | 噴流／煙柱強度；0 關閉特效並使噴發模板熔岩轉為灰色 |

偃塞湖自動候選要求溪／河與坡地觸發；本組陸地模板在 depth > 0 時退出自動候選。
這些權重是美術抽樣規則，並非災害機率、風險預測或真實壓力／溫度。
指定類別可覆寫自動資格，便於研究台查看；地熱池在寒冷氣候仍可顯示液態水。

專屬種子流抽樣 ventRadius（正規化半徑 .12–.24）、channelWidth（正規化流路寬 .12–.26）
及 jetHeight（相對噴流係數 .3–.9），只有使用該參數的模板受影響。表層變動不改動其抽樣。
火山灰、熔岩、礦物沉積與池水採空間分區覆色，核心區不附著一般植被；水面禁用高度噪聲。
蒸汽、灰柱、泥漿與水柱為不透明低面數靜態快照；高度和完整 bounds 包含噴流。
特效錨點插值實際網格三角形，不另推算近似落點。沒有流體、熱傷害、潰壩或山體移動演算。
正式戰場自動散布、權威碰撞及災害結算仍未接入。

分類參考：[USGS 山崩類型](https://pubs.usgs.gov/fs/2004/3072/fs-2004-3072.html)、
[USGS 天然壩](https://pubs.usgs.gov/publication/ofr87392)、
[NPS 地熱特徵](https://www.nps.gov/yell/learn/nature/hydrothermal-features.htm)、
[USGS 泥火山與泥漿池區別](https://www.usgs.gov/observatories/calvo/news/mud-pot-mud-seep-or-mud-volcano)、
[NPS 惡地侵蝕](https://www.nps.gov/articles/000/badl-geologic-formations.htm)。

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

`node tools/audit_geology.mjs` 檢查 35 類 × 4 種子、有限頂點、色彩、面索引、bounds、
坡面附著、植被來源限制、棲地資格、參數區間與型錄出口。
另檢查 26 個固定古蹟、28 種活動遺跡、等比例縮放與 2,048 個種子的兩類抽樣／無匹配降級。
另檢查特殊地質資格、噴流停用、水面水平、核心區植被抑制、特效包絡與幾何預算。
已加入核心 audit suite。
另檢查舊規則對照、45° 邊界與 90° 極限的候選排除、平面／曲面貼地、無效取樣略過。
`node tools/audit_battle_geology.mjs` 驗證 396 組戰場網格、正式 renderer adapter、包絡坡度、尺寸與決定性；亦由物件接合稽核呼叫。
