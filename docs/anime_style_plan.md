# 日系動漫畫面整合計畫(下一輪執行)

> 本檔是 **2026-08-15 這一輪的產出之一**:把 `sakura-crossing` 與 `messenger.abeto.co`
> 兩專案的技術拆成八支 SKILL 之後,**逐題對應回本專案的單一真相縫**,列出「改哪一條縫、
> 為什麼、怎麼驗」。本輪**不動任何遊戲程式碼**;下一輪照本檔逐項執行。
>
> 使用者定案:**衝突時以兩專案為主**。但下列 §0 的四條是「換掉本專案既有大型投資」的
> 等級,MUST 先取得使用者裁決再動手(原則:刻意設計 MUST NOT 自行『補完』)。

## 來源:怎麼取得、怎麼翻閱

> **兩份來源都不在儲存庫裡,也不該在。** sakura 是 MIT 但 14 MB 且隨時可重新 clone;
> messenger 沒有原始碼,手上的是**它出貨的 bundle**(專有著作,**MUST NOT** commit 進本
> 儲存庫,連節錄都不行 —— `reference/` 的既有慣例是本人其他專案的小份節錄)。
> 所以這裡放的是**取得方式 + 精確索引**,任何時候都能在一兩分鐘內重建。

### 取得

```bash
# ① sakura-crossing —— 完整原始碼(MIT)
git clone --depth 1 https://github.com/Kenton-GMI/sakura-crossing.git /c/tmp/sk
#                                                                    ↑ 短路徑!深層 temp 目錄會
#   以 "cannot write keep file … Filename too long" 失敗(Windows,本輪實際踩過)

# ② messenger.abeto.co —— 出貨 bundle
curl -sSL --ssl-no-revoke https://messenger.abeto.co/ -o msg.html          # 讀出 App3D-<hash>.js
curl -sSL --ssl-no-revoke https://messenger.abeto.co/assets/App3D-<hash>.js  -o App3D.js
curl -sSL --ssl-no-revoke https://messenger.abeto.co/assets/webgl-<hash>.js -o entry.js   # viewport/CSS 注入
curl -sSL --ssl-no-revoke https://messenger.abeto.co/assets/style-<hash>.css -o style.css # loading spinner
```

⚠ **`WebFetch` 對兩邊都回 403**(messenger 首頁與 gitingest 皆是),一律走 `curl` / `gh`。

### 從 bundle 抽 GLSL(messenger 的技術幾乎全在這裡)

```bash
node -e "
const fs=require('fs'), s=fs.readFileSync('App3D.js','utf8');
const seen=new Set(), out=[];
for (const m of s.matchAll(/void\s+main\s*\(/g)) {
  const a=s.lastIndexOf('\`', m.index), b=s.indexOf('\`', m.index);
  if (a<0||b<0||seen.has(a)) continue; seen.add(a);
  out.push('/*=== BLOCK len '+(b-a)+' ===*/\n'+s.slice(a+1,b));
}
fs.writeFileSync('shaders.txt', out.join('\n\n'));
console.log('blocks:', out.length);   // 本輪實測 220,其中約 80 段宣告 u* uniform = 它自己的
"
```

**認 block 的方法是 uniform 清單**(minify 不改字串),獨立 GLSL 函式則直接對原始 bundle
`grep`(例如 `grep -n 'float outline(' App3D.js`)。JS 那一側同理:
`grep -n 'ambianceSpheres\|adaptiveDPR\|animationProps\|getBatchingMatrix' App3D.js`。

一行看完它整套音效設計:

```bash
grep -oE '"[a-zA-Z0-9_/.-]+\.(ogg|mp3)"' App3D.js | sort -u
```

### 索引:本檔哪一節 → 去翻哪裡

| 本檔章節 | sakura | messenger(以 uniform 清單認 block) |
|---|---|---|
| §0-a 分區 / 遮罩面 | — | `IS_TERRAIN` 分支:`uSkinColor, uShowChars, uWetHeight, uMouthColor, uIsTalking, uNPCSeed` |
| §0-b 賽璐璐學派 | `src/core/toon.js`(School A 全套) | 同上 block 的 `shadowCut` / `colorShadow` / 量化高光 |
| §0-c `gInfo` 打包 | — | 同上 block 結尾的 `gInfo = vec4(...)`;讀取端 `grep 'float outline('` |
| ① 線條 | `src/core/post.js` `INK_SHADER`、`src/core/outline.js` | `uOutlineThickness, uInfoRange, uDepthRange, uNormalRange, uSmoothMargin, uInfoMinScale`(兩段,第二段多 `tWater`) |
| ② 葉冠 | `src/world/trees.js`(含 trunk-tip 那段長註解) | `uLeavesShake, uShakeSpeed, uScale` + 屬性 `centr, centr_tree, rand, detail` |
| ② 苔草/濕痕 | `src/world/hills.js`(cover 場、門檻抖動) | `IS_TERRAIN` 分支的 `grassMask` / `wetMask` / `striations` |
| ③ 生成器 + 表 | `src/world/vehicles.js` **檔頭**(全專案最清楚的一份)、`shops.js` / `housing.js` / `props.js` | `grep 'getBatchingMatrix'`、`_buffersToUpload` |
| ④ 接縫紀律 | **`CLAUDE.md` 的 trap table**(最高密度來源)、`src/world/{index,ground,street}.js` | wipe:`uWipe1, uWipe2, uWipeColor, uOverlay, uOverlayColor, uFlash` |
| ⑤ 落花/水/雲 | `src/world/petals.js`、`src/world/lake.js`(檔頭先讀)、`src/core/sky.js` | 水:`uColor1, uColor2, uColorWaves1, uColorWaves2, uDepthRange, uProjMat, uWorldMat` |
| ⑥ 鳥群/角色 | `NEXT.md`「Rules that must not be broken」(無人規則) | flock:`uNoise, uGroups, uSnap, uSpeed, uSeed, uDirection, tCurve`;骨骼:`getBoneMatrix(i, id)`;臉:`eyeTime` / `interval1/2/3` |
| ⑦ 音效 | `src/core/audio.js`(193 行,檔頭寫著理由) | `grep -n 'ambiances/'`(名冊)、`grep -n 'ambianceSpheres'`(交叉淡入)、`grep -n 'bgmusic-mobile'`(低階分支) |
| ⑧ 手機 | `src/core/post.js` `Pipeline.setSize` | `grep -n 'maxTouchPoints'`(能力探測 + 裝置階梯)、`grep -n 'adaptiveDPR'`;`entry.js` 頂部(viewport/CSS);`style.css`(spinner) |
| ⑨ 立體結構 | 本專案自有,兩專案無對應 —— 只有材質層照 §0-b/§0-c 走 | — |

**九支 SKILL 每一支結尾也各有一份「Reference implementations」**,含同樣的取得指令與
逐技能的對照表。翻 SKILL 時不需要回頭找本檔;翻本檔時這一節就夠。

### 本輪的工作副本(**會消失,不要依賴**)

`/c/tmp/sk`(sakura 完整 repo,14 MB)與本輪 scratchpad 的 `msg/`
(`App3D-DwM1eiaC.js` / `shaders.txt` / `webgl-*.js` / `style-*.css`)。
scratchpad 是逐 session 的,`/c/tmp` 隨時可能被清 —— 上面的取得指令才是真相。

### 問題 → SKILL 對照

| 問題 | SKILL |
|---|---|
| ① 畫面更像日系動漫 | `cel-shading-pipeline`(改寫) |
| ① 哪裡有線、哪裡沒有 | `anime-line-control`(新) |
| ② 服裝/葉冠/苔草的輪廓與細節 | `procedural-object-detail`(改寫,新增 L1b) |
| ③ 建築/電器/交通工具 | `generator-table-catalog`(新) |
| ④ 轉場/地板拼接/空間感/光線 | `scene-seams-and-light`(新,含 L1b 線工切面) |
| ⑤ 搖曳/落花/流水/浪花/雲 | `ambient-motion-layers`(新) |
| ⑥ 鳥獸飛行與人物動作 | `character-and-creature-motion`(新) |
| ⑦ 音效與 BGM 過場 | `game-audio-layering`(新) |
| ⑧ 手機瀏覽器操作 | `mobile-webgl-interaction`(新) |

---

## §0 四條裁決(2026-08-15 使用者定案)

| # | 議題 | **定案** |
|---|---|---|
| 0-a | 地貌拼圖 vs 單一遮罩面 | **條件式取代** —— 「單一遮罩面**若能由真實圖資 + 隨機性算出整張地圖的場景**,就取代拼圖」。見 §0-a 設計 |
| 0-b | 賽璐璐量化學派 | **改** —— 走 School B(累積光 + `smoothstep` 硬切 + HSV 色相位移,角色可獨立換硬度) |
| 0-c | `gInfo.a` 語意 | **打包** —— 一個通道同時帶表面類別碼與 `outlineContribution` |
| 0-d | 音效資產策略 | **補名冊** —— 架構不動,把 Layer 2 樣本與環境音名冊補齊 |

### §0-a 取代設計(先做可行性樁,再決定是否拆拼圖)

使用者的條件很精確:**遮罩的輸入必須能從真實圖資導出**,不能只是噪聲。兩專案的地形遮罩
是 `noise + dot(n, up) + height`,對真實世界地圖是不夠的 —— 缺的那一維是「這裡是什麼」。
橋接方式是把「分區」與「分區內的紋理」拆開:

```
分區(低頻,真實圖資) →  一張烘焙的 zone 索引貼圖,覆蓋整個戰場方框
分區內(高頻,決定性噪聲) →  fragment 內的 step() 遮罩
顏色 →  一條色票 strip 的 UV,不是逐款材質
```

分區輸入本專案**全部已經有**,不需要新資料源:

| 輸入 | 現有縫 |
|---|---|
| landuse / natural / water 多邊形 | `biomes.js` 的 Overpass 取得(經 `osmrelay.js` 全房共用) |
| 純影像地貌判定 | `biomes.classifyImg()`(零亂數) |
| 坡度 / 高程 / 離水距離 | `terrain.heightAt` / `hgtEnc` |
| 決定性噪聲場 | `field.js` `makeField` / `bakeFieldTexture`(**已經在烤貼圖了**) |
| 地圖主方位 | `mapRot`(A42) |

#### 分區怎麼定義(2026-08-15 使用者定案:**由 OSM 線工切面**)

現制 `ground.js cellZoneAt(i, j)` 是**逐格獨立**判定(envCode → 坡度閘 → `classifyPure`
五點多數決 → 坡度覆寫 → alpine),七個值:`water / wet / green / bare / urban / alpine`
+ `'!'` + `null`。逐格獨立正是接縫問題的**根因** —— 界線由「哪一格投票翻面」決定,
所以它落在田中間,才需要界線拼圖去藏。

新制把它拆成**兩段**:先切面,再對整個面下一次判定。

##### 第一段:線工 → 面(planar subdivision,但用 flood fill 做)

參與切面的線,以及本專案**已經有的**取得縫:

| 線 | 來源 | 備註 |
|---|---|---|
| 道路 / 步道 | `biomes.js` 的 `osmRoads`(已量化,`roadgrid.js`) | 帶 `roadRank`;**分級參與**,見下 |
| 鐵路 | 同上的 railway ways | 恆參與 |
| 河川 / 溝渠 | `waterway=*` | 恆參與;水域面本身走 `envCode` |
| 天然界線 | `natural=*`、`landuse=*` 多邊形外環、`natural=coastline` | 這一類同時是**面的標籤來源**(見第二段) |
| 行政界 | `boundary=administrative` | **低優先**:多數與河/路重合,只有「附近 N m 內沒有其他線」時才採用,否則是重複線 |
| 坡度變化 | `terrain.heightAt` 梯度跨過門檻的等值線 | 門檻 MUST 取 `SLOPE.EASE_DEG` / `BLOCK_DEG`(既有唯一縫),**MUST NOT 另訂數字** |

**MUST NOT 用半邊資料結構做真正的平面剖分**(程式量大、數值脆弱、且 A2 禁新依賴)。
做法是**在烤貼圖的那張格網上光柵化 + flood fill**,與 `audit_traverse` 同一個結構:

```
1. 把所有參與線光柵化成「牆」   (逐 texel 取「到最近線段的距離 < 半寬」)
2. 對補集做 flood fill          → 每個連通區得到一個 face id
3. 逐 face 聚合證據下標籤       (第二段)
4. 牆 texel 併進最近的 face     (道路本身另有幾何,不需要自己的分區)
```

三條紀律:

- **線要分級,不是全都參與**。市區裡每一條步道都切面 ⇒ 幾平方公尺的碎面,等於回到雜訊。
  取 `roadRank` 至某級以上參與切面;級以下只畫不切。
- **面積低於下限的面 MUST 併進**最大的鄰面 —— 與 A46 ⑨「小區塊併入角度最接近的鄰居」
  同一條規則,理由也一樣(碎鱗不是特徵)。
- **結構足跡是切面的 keep-out**:隧道 notch、橋樑足跡、明隧道柱列帶不得被分區線切過,
  與 `hillAt` 的 keep-out 同一份名冊(見 §⑨)。

##### 第二段:逐面下標籤(**判定規則沿用,聚合層級改變**)

`cellZoneAt` 的**判定順序一行不改**,改的是它吃什麼:從「這一格的五點」變成
「這一個面的取樣集」。優先序:

```
envCode 水/沼(權威遮罩)          → water / wet        ← 逐 texel 仍可覆寫,水面是平的
面落在 landuse / natural 多邊形內   → 該多邊形的類別      ← 最高可信度(圖資 > 影像,信任階梯不變)
否則 classifyPure 在整個面上多數決  → green|bare|urban   ← 影像退居 fallback
面的中位坡度 > 門檻                → bare;更陡 → '!'
面的中位高程 > alpineH             → alpine
```

**這一改的收益是「理由」而不是「精度」**:一整片田是一個面 ⇒ 一個色調;
色調換手發生在路緣、河岸、田埂上 —— 那是它在真實世界換手的地方,所以不需要藏。
連帶三件事可以退場:`planEnclaves`(飛地)、界線拼圖的同地貌分支、
以及 `bandDryAt`(界線拼圖反過來決定水沼分類的那個唯一例外 —— 它存在的理由就是
底毯換手與真實地形差半個帶寬,新制兩者同源,差值恆 0)。

**信任階梯與現制一致**:圖資 > 純影像 > 手寫 `mix`(§2.1「聚落場」那一列),
而且影像從「主判據」降級為「圖資沒說的時候才問」⇒ **跨客戶端分家的曝險變小**
(影像逐客戶端各抓、OSM 走 `osmrelay.js` 全房共用)。

**建構期成本 MUST 量**:1024² = 1 M texel 的光柵化 + flood fill 是一次性建構期工作,
但 `buildBiomes` 已經有讓步紀律(`buildYield`,§2.1「建構期讓步」),
新工作 MUST 掛在既有階段回報上,**MUST NOT 動到共享 `rnd()` 的消耗序列**(§2.3)。

#### 最大可行範圍(量出來的)

| 量 | 現值 |
|---|---|
| 可玩邊長 `sideMFor` | 迷你 **480 m** / L1 800 / L2 1000 / **L3 5v5 1200 m**(最大) |
| 緩衝裙 `edgeBufferM()` | 每側 **455.6 m**(= `curveHorizonM`)⇒ L3 實際畫出來的地面 **2111 m** 見方 |
| 現制分區格 `cell` | `max(13, maxSide / 232)` ⇒ **恆為 13 m**(232 上限要到 3016 m 邊長才會咬到) |
| 現制 zoneGrid 尺寸 | 37×37(迷你)~ **93×93**(L3) |

⇒ 貼圖規格由「公尺/texel × 邊長」決定,而**不是**由地圖大小卡住:

| 貼圖 | 覆蓋 2111 m 時 | 記憶體(RGBA8) | 相對現制 |
|---|---|---|---|
| 512² | 4.1 m/texel | 1 MB | 3.2× 細 |
| **1024²** | **2.06 m/texel** | **4 MB** | **6.3× 細** ← 建議值 |
| 2048² | 1.03 m/texel | 16 MB | 12.6× 細 |

**建議 1024² RGBA8**:R = 分區索引(類別,`NearestFilter`)、G = 次款/變體索引、
B = 連續場(給門檻抖動用)、A = 保留(道路/建成遮罩)。
2048² 是 WebGL2 **保證**可用的上限(規格下限 `MAX_TEXTURE_SIZE = 2048`),所以 1024²
在任何裝置上都安全,而且比本專案自己訂的 232 格上限還細 4.4 倍。

反過來算:2048² 配 4 m/texel 可覆蓋 **8192 m** —— 是現行最大地圖的 6.8 倍。
**地圖大小不是限制**,能不能取代只取決於分區判定本身。

#### 可以不規則(三種意義都可以,但有一條硬限)

1. **邊界形狀**:本來就不規則 —— 它跟著 OSM 多邊形、影像分類、坡度與 envCode 走。
   texel 的階梯用**定義域扭曲**抹掉即可(`zone(uv + noise(worldXZ) * r)`,r ≈ 1~2 texel),
   零成本、而且這正是「不要看起來像等高線圖」的同一招。
2. **拓樸**:凹形、環形、飛地、有洞、多連通全部免費 —— 它是查表不是網格化多邊形。
   現制的 `planEnclaves` 飛地邏輯可以整個退場。
3. **硬限:兩個分區交錯的最細尺度 = 一個 texel**(建議值 2.06 m)。
   `NearestFilter` 下一個 texel 只能屬於一個分區,所以**寬度低於約 2 texel(≈4 m)的
   分區會消失**。今天 13 m 格的同一個問題更嚴重(低於 26 m 就消失),所以這是**改善**不是新限制。
   真的要保住的細長物(河、路、樹籬)**本來就不是分區** —— 它們是自己的幾何/貼花,
   跟現在一樣。

⚠ `NearestFilter` 是必要的:分區索引是**類別**,線性過濾會在兩個分區之間插出
**第三個不存在的分區**(同 `anime-line-control` 對深度貼圖的那一條)。

#### 次款預算(2026-08-15 使用者定案:**乙 —— 每分區收斂到 3~5 種**)

##### ⚠ 收斂的對象只有**底毯層**,特徵層一格不動

這一條是本節最容易被誤讀的地方,先釘死:

| 層 | 名冊 | 現值 | (乙) 之後 |
|---|---|---|---|
| **底毯**(`CARPET`)—— 註解自己寫著「全為 tile 型(世界投影 UV)地面,**大片連續鋪滿全部陸地**」 | `CARPET` | 27 個相異款 | **收斂到 19,改成遮罩** |
| **特徵**(`ZONES`)—— 功能性區塊:水田/果園/停車場/太陽能田/球場… 有真實邊界的**離散地塊** | `ZONES` / `FAMS` / `SIZE` | 40+ 款 | **一格不動** |

底毯才是拼接問題;特徵層是「一塊一塊有邊界的東西」,它的邊界本來就是真的。
⇒ **2026-08-13 的四季農牧地表(10 種)、田埂 `BUND_SUBS`、`DETAIL_DEFS` 點綴、
`FAMS` 延伸家族、`SIZE`、功能性區塊互不重疊那一整套,全部保留**。
把它們一起收掉是對定案的誤讀,MUST NOT。

##### 收斂後的底毯:每分區「一個基底 + 2~4 個有理由的遮罩覆寫」

現制底毯是**加權清單隨機挑**(`CARPET` 的格數 = 權重),而挑中哪一款**沒有理由** ——
那正是它需要 `CARPET_LOT`(讓它別跳太頻繁)、`carpetOrder`(讓跳的幅度小)、
`planSeamOverlays`(把跳的地方糊掉)三層補丁的原因。

(乙) 把它換成 messenger 的形狀:**基底色 + 依序疊加的 `step()` 覆寫,每個覆寫都有一個
幾何理由**。理由項全部取既有的量:坡度、高程、`coverAt` 屬性場、離水距離、建成足跡距離。

| 分區 | 基底 | 覆寫(幾何理由) | 數 |
|---|---|---|---|
| green | `turf` | `meadow`(cover 場高)· `bushfield`(坡度 0.12~0.28)· `flowerfield`(低頻噪聲口袋,~5%) | 4 |
| bare | `wild` | `gravel`(坡度 > 0.2)· `sand`(近水/低高程)· `crackedearth`(平坦 + 乾燥噪聲) | 4 |
| urban | `pavement` | `lawn`(開闊噪聲口袋)· `park`(較大口袋)· `concrete`(近建成足跡) | 4 |
| wet | `marsh` | `lotus`(水深/噪聲口袋) | 2 |
| water | `watertile` | `deepwater`(水深 —— **本來就是幾何規則**,不動) | 2 |
| alpine | `plateau` | `scree`(坡度 > 0.28)· `icefield`(高程 > 上帶) | 3 |

共 **19 段外觀 shader**(去重後約 17)。退出底毯的款(`arrowbamboo`/`deadwood`/
`fallenlogs`/`steppe`/`redsoil`/`deadforest`/`mud`/`brick`…)**不是刪掉** ——
它們多數本來就同時在 `ZONES`/`FAMS` 裡,從此只當特徵地塊出現。
`brick` 退出底毯剛好把 2026-08-13「紅磚地大幅調降」那一輪做完。

**每個覆寫的遮罩 MUST 同時吃一個幾何項與一個噪聲項**(`procedural-object-detail` L1b-C),
只有幾何 ⇒ 完美等高線,只有噪聲 ⇒ 隨機斑點。

##### 連帶退場(全部是為了補「隨機挑款」而存在的)

| 退場 | 它原本在補什麼 |
|---|---|
| `CARPET` 加權清單 | 隨機挑款本身 |
| `CARPET_LOT` / `carpetLotAt` | 「別跳太頻繁」 |
| `carpetOrder()` | 「跳的幅度小」—— 新制的順序就是遮罩疊加順序 |
| `CARPET_VARIANTS` / `planCarpetVariants` | 「同款相鄰要不同花紋」—— 花紋改由噪聲在同一段外觀內連續變化 |
| `planSeamOverlays`(交界外溢) | 拼圖之間的 cross-fade —— 沒有拼圖了 |
| `planEnclaves`(飛地) | §0-a 的面本來就做得到 |
| `BORDER_SAME_ZONE` + `CARPET_DE` 色距窄門 | 同分區內的大色跳 —— 新制覆寫自帶 `surfaceId` ⇒ 線免費 |
| `bandDryAt` | 底毯換手與真實地形差半個帶寬 —— 新制兩者同源,差值恆 0 |
| `SEAM_QC_W` / `seamAlpha` | 同上 |

`SUB_COL` **保留為唯一縫**(代表色仍要被排序與界線判定用),名冊縮到 19 並跟著改稽核。
`BORDER_KINDS` **保留**,但服務對象從「底毯 vs 底毯」變成「**特徵地塊 vs 底毯**」——
一塊水田對草皮的邊界本來就該有田埂,那是真的邊。

##### 量化收益(這是 (乙) 的主論據)

底毯現在的幾何桶鍵是 `` `${sub}#${variant}` `` ⇒ 27 款 × 3 變體,一張圖實際會出現數十桶。
遮罩制下底毯是**地形那一張網格自己**、一個材質、一段 shader ⇒ **底毯 draw call 收斂到 ~1**,
而且 `emitCell` / `inQuad` / `invBil` 認養三角形那一整套可以退場(它存在的理由是
「底毯是另一層皮」,新制底毯**就是**地形)。`SAG` 地被貼合抬升同理:底毯/外溢/脊帶三層
是共面的,`drapeSag` 只剩界線/特徵層要用。

⇒ 這一項的效益不只是無縫,是**少一層皮 + 少數十個 draw call + 少五套補丁**。

⇒ 可行性樁(下一輪第一件事,不動出貨行為):把現有 `zoneGrid` / `subGrid` 的判定結果
**烤成一張 zone 索引貼圖**,在地形 fragment 內取樣 + `step()` 遮罩畫一張圖,與現制拼圖
並排比對。三個驗收面:

1. **分區界線 MUST 仍落在真實地貌界線上**(與現制 `zoneGrid` 逐格比對,不得推移);
2. **決定性**:同一場地兩次建構逐位元相同,且不消耗共享 `rnd()`(§2.3);
3. **`surfaceId` 出線**:草↔岩、乾↔濕的界線要畫得出線(否則只是把接縫換成色塊硬邊)。

樁過了才拆 `ground.js` 的拼圖層,而且 MUST 分兩步:先讓遮罩面與拼圖**同時存在**(旋鈕切換,
預設舊制 = 逐位元同舊制),`audit_ground_*` 全綠之後才移除拼圖與其稽核。
**樁沒過就不取代** —— 使用者的定案是條件式的,條件不成立時維持現制不是打折。

### §0-b 換學派的落地紀律

- 縫仍只有 `toon.js` 一份(`cel()`),消費端一行不改。
- **`bands` 參數不消失,語意改成硬度**:3 → 一般硬切(0.20→0.40),2 → 更硬,
  `soft` → 更軟。既有逐材質的 `bands:` 呼叫因此**不用全改**。
- `uShadowTint` 由「乘進暗帶」改成 **HSV 位移**(`h -= 0.02; v *= 0.5`);
  現有的逐材質 tint 色值轉成該材質的色相偏移量,MUST 保留逐材質可調。
- **投影軟硬**:改用 `PCFSoftShadowMap`(硬切會把柔化後的值重新量化,終端線更短更乾淨),
  這一條與 `SHADOW` 檔頭的取捨要一起重寫。
- 反向驗證:把 `shadowCut` 換回 ramp 查表,`audit_cel_pipeline`/`audit_visual_prefs` 的
  ramp 斷言 MUST 紅字。⚠ 這一改**不是逐位元中性的**,`shot_scene` 13 張定場照全會變 ——
  MUST 先拍一組改制前的基準照。

### §0-c 打包編碼

`gInfo.a` 現在是 `INK_CLASS`(`> 0.25` 當哨兵,LAND = 0.5)。打包後:

```
gInfo.a = class * 0.5 + contribution * 0.5     // class ∈ {0, 0.5, 1.0} 取低半、貢獻取高半
```
或分離式(較穩):**類別碼移進 `gInfo.b` 的低位**,`.a` 全部讓給 contribution。
**選哪一種 MUST 先量 8bit RT 的量化誤差** —— 現制 `LAND = 0.5` 在 8bit 上存成 0.50196,
門檻 `> 0.25` 是為了這件事訂的(A46 那一族的同型問題)。
沒有第二個 draw buffer 的裝置(`_mrtCap` 為假)MUST 逐位元退回舊制。

---

## ① 畫面更像動漫 / 線條由誰決定

### 現況
- `toon.js`:三階 ramp、`uShadowTint`、`INK_SOFT_A`、`celSurfId`(`nextSurfId` 64 槽環)、
  `LAND_SURF_ID`、`INK_INFO_DECL`(MRT 第二附件)。
- `postfx.js`:`INK`(二階差分 + 掠射項 `K_S`)、`INK_MRT`(法線折邊 + 面 id)、LUT、
  空氣透視、DOF、`RES_GOV`。
- 也就是說 **本專案已經有 messenger 的資訊緩衝骨架**,缺的是「這一格要不要上線」那一維。

### 下一輪要做的(0-b 換學派見 §0-b;以下與它正交,可先做)
1. **`outlineContribution` 上線**(編碼依 §0-c:打包)。
   - 縫:`toon.js` 的 `gInfo` 寫入處一份、`postfx.js` 勾線 pass 讀取處一份。
   - **最近面覆寫**(`ceil`/`floor` 硬決定)MUST 一起進,否則 contribution=0 的物件仍會被天空描出輪廓。
   - 反向驗證:把覆寫改成 `mix`,`audit_cel_pipeline` MUST 紅字。
2. **雜訊斷線**:地形與機體各一條 `step(noise)`,讓線「像筆抬起來」而不是等寬。
   機體那條 MUST 吃**局部座標**(否則走路時缺口在身上游動)。
3. **材質遮罩折進 `surfaceId`**:目前 `LAND_SURF_ID` 是「讓地貌**不要**出線」;反過來
   「同一塊地形上草↔岩要**出線**」需要把遮罩加進 id(`surfaceId += grassMask * 0.1`)。
   這一條與 0-a 相關:不換地貌系統的話,它是 0-a 的**廉價替代**。
4. **深度門檻吃中心法線 z**(`depthLimit = base + 1.0 - n.z`)。本專案現在用 `K_S` 掠射項
   達成同一件事,**兩者擇一,MUST NOT 疊**。
5. LUT 已存在(`lutSrc`);補上「LUT 取代 split-tone 而不是疊加」的斷言。

### 驗證
`audit_cel_pipeline` Ⅵ・Ⅶ + `--break-inkinfo`/`--break-land`;新增 `--break-contrib`。
㋓ `shot_scene --pref inkMrt=on` 前後對照(旋鈕關著 MUST 逐位元同舊制)。

---

## ② 服裝 / 葉冠 / 苔草的輪廓與細節

### 現況
- 機體 = `forge/` 多面體零件,無布料;植被 = `biomes.js` + `SOFT_KINDS` 擺動;
  岩石苔蘚 = `siteplan.js` 的散布 + `procedural-object-detail` 既有規則。

### 下一輪
1. **葉冠改用「面向相機的葉片卡 + 螢幕空間放射」**(SKILL L1b-B1)。
   - 這是本輪最有畫面收益的一條:任何角度都給出鋸齒狀冠緣。
   - **同一棵樹的所有卡片寫同一個深度**(取樹心),勾線只畫整叢輪廓 —— 這條同時解掉
     「灌木叢被畫成一堆黑多邊形」。
   - 縫:`biomes.js` 植被建構 + 一支新的葉片 `ShaderMaterial`(MUST 宣告 `gInfo`,
     否則整批不畫,A46 那一族)。
2. **苔草/濕痕改成 triplanar 遮罩**,不是散布幾何。與 ① 第 3 點同一條 `surfaceId` 縫。
3. **布料**:本專案沒有人物,但**旗幟(`flags.js`)、機體垂布、繩索**適用同一條 ——
   樞軸在掛點、`sin + 0.33·sin(3.3ω)`、逐件 rate/phase。`flags.js` 已有分段旗面,
   補「樞軸不在中心」與「rate/phase 逐面不同」。

### 驗證
`audit_object_joints --seeds 8`(接合不得因換冠而變)、`audit_soft_stroke`(軟性契約)、
`audit_cel_pipeline`(新材質必須宣告 MRT 輸出)、㋓ `shot_scene` 樹冠定場照。

---

## ③ 建築 / 電器 / 交通工具

### 現況
- 建築:`biomes.js` 的 `BLD_LIB` 整棟量體 + `wallpanel.js` 面板 + `facadeTex`;
  已經是「一個生成器 + 一張表」的形狀,而且有剖面/平整度/窗格對齊三道閘。
- 載具/電器:`props.js` 等的擺件,**沒有**像 sakura `vehicles.js` 那樣的 `SPEC` 列表。

### 下一輪
1. **把 NPC 載具/擺件收斂成 `SPEC` 列**(`L, W, R, axle, sill, waist, roof, cab,
   rakeF, rakeR, side, extra`),一個 `makeVehicle` 生成器。
   - 現況最像 sakura 記錄的那個 bug:同一組件兩份手寫副本。
2. **凹處必須是真的凹**:`wallpanel.js` 已經處理「窗貼在哪」,但**店面/機具開口**還沒有
   「量體退縮 + 側返 + 楣樑」的規則。深度一律**往外堆**。
3. **`atan(height/depth)` 可視角**:任何「玩家要看得到裡面」的凹處(補給箱、出貨口)
   MUST 對站立視線角驗算。
4. Draw call 算術:`makePlanter` 類「一件十幾個 mesh × 擺很多次」的東西 →
   **逐材質 bake 成 N 個幾何再 instance**。本專案已有 `beacons.mergeGeos` 縫可轉呼。

### 驗證
`audit_siteplan` Ⅴ、`intake_parts`、`audit_object_joints`;新增一支載具 `SPEC` 稽核
(逐列推導值 vs 實測外廓)。

---

## ④ 轉場 / 地板拼接 / 空間感 / 光線

### 現況
- 地板:見 0-a。
- 空間:`WORLD_EDGE`(障礙環 + 緩衝裙 + 背景)、`CURVE` 世界曲面、`AIR` 空氣透視、
  `DAYCLOCK`/`SHADOW` 日夜與影子 —— 這一塊本專案**比兩專案完整**。
- 轉場:`dialogue.js` / `cutin.js` / `storyui.js`,但**沒有全螢幕斜向 wipe**。

### 下一輪(不含 0-a)
1. **斜向 wipe 轉場**:兩支獨立 0→1 uniform(遮 + 揭)+ overlay 色 + flash
   (vibrance/brightnessContrast,不是白色淡入)。縫:`postfx.js` 新一個 pass,
   由 `cutin.js`/`storytalk` 驅動。**旋鈕預設關 = 逐位元同舊制**。
2. **物件出現/消失一律 dissolve `discard`,不用 alpha**(`lineFade`/`sphereFade`)。
   現制的淡入淡出會讓賽璐璐件失去自己的輪廓。可直接用在:載具投放、輔助機隊到場、
   遠距剔除。
3. **霧範圍 ≡ 勾線淡出範圍**:兩者現在各有常數(`AIR`/`INK.FADE0/1`),補一條推導。
4. **接縫紀律補進稽核**:共面硬幣拋(材質改動 → 像素完全相同 = 那面沒被畫)、
   平台盒必須重疊 40mm、路口三條線、車道經過處要斷緣石 —— 本專案 §2.1 已有多條同族
   規則,把 SKILL 的 symptom 表併進對應稽核檔頭。

### 驗證
`audit_ground_*` 全批 MUST 逐項不動、`audit_world_edge`、`audit_cel_pipeline`;
新 pass 加 `--break-wipe`。

---

## ⑤ 搖曳 / 落花 / 流水 / 浪花 / 雲

### 現況
- `WIND`(`GUST_M/GUST_S/GUST_F`、`SEA_M`、`celGust`、`celSeaH`)、`SOFT_KINDS`、
  海浪法線在 `beginnormal_vertex` —— **這一塊本專案已經很接近兩專案**。
- 缺:落花類粒子、岸邊泡沫、水面倒影塊、雲層飄移、**角色經過造成的植被位移**。

### 下一輪
1. **玩家速度驅動的植被位移**(SKILL L1 第 3 層):`charPos`/`charSpeed` 兩個 uniform,
   擾動半徑是速度的函式。純頂點、零權威影響。
2. **岸邊泡沫**:`parabola(fract(bands))` + 噪聲 + `step(0.42)` 硬邊,驅動量是
   **深度差**不是岸線幾何 —— 自動繞過每一顆石頭與每一根柱子。
   本專案的水面現在只有波形,沒有 shore band。
3. **水面倒影塊**:方向沿「物件→視點」、切成 3~4 段有斷口。現制沒有倒影。
4. **落花/落葉粒子**:兩頻率(慢波 + 快顫)、逐粒隨機軸自轉、沿**特徵中心線**環繞、
   建構期預跑 40 × 0.1s、`depthWrite:false` + `noOutline`。
5. **雲層飄移**:同一支風時鐘,`mod` **前先加半個 wrap**。

### 驗證
`audit_soft_stroke` ±`--break-wave`/`--break-gust` + 新 `--break-foam`;
真 GPU 直測(時鐘不動 MUST 逐位元相同);㋓ `shot_scene waterline`。

---

## ⑥ 鳥獸飛行 / 人物動作

### 現況
- `locomotion.js` / `gaitcurve.js` / `morphrig.js` —— 步態與變形已經很完整,
  **且比兩專案深**(逐關節解剖學拓樸)。
- 缺:①鳥/小動物 ②動畫**權重向量**(現制是狀態驅動)③幀率無關阻尼的統一縫。

### 下一輪
1. **幀率無關阻尼收成單一縫**(`frictionFPS`/`lerpFPS`)。這是最便宜、影響最廣的一條:
   目前多處 `v *= k` 逐幀寫法在 144Hz 與 30Hz 上是**不同的行為**。
2. **GPGPU 鳥群**:曲線貼圖 + 逐軸噪聲 + 弱彈簧(0.0003)+ 摩擦 + 分群 + `uSnap`。
   純表現層,不進 sim。放在 `vfx.js` 或新 `wildlife.js`。
   - **曲線是美術方向**:鳥群為什麼在那裡、飛去哪,由烘焙的那一列像素決定。
3. **動畫權重向量**:讓音效(⑦)、塵土、鏡頭抖動都讀同一份 `weights[]`,
   而不是各自從速度重推「他在不在走路」。

### 驗證
`audit_gait_anat`(既有斷言 MUST 逐項不動)、`audit_client_syntax`、
`npm run bal` / `npm test` MUST 逐位元不動(純表現層)。

---

## ⑦ 音效 / BGM 過場

### 現況
本專案的 `audio.js`(690 行)已是兩專案的**超集**:雙層、去重窗、聲部上限、距離剔除、
StereoPanner、BGM 串流 + 淡入淡出、程序旋律備援。

### 下一輪(全部是「補缺」,不動架構)
1. **區域環境音**:多床常駐 loop(`volume:0, autoPlay, loop`),以**球 + margin** 交叉淡入,
   宣告順序即優先序,並保留一床恆亮的 base。本專案現在只有「移動環境音」四類別,
   沒有**地點**環境音。
2. **移動音改成 gain-ride 常駐 stem**,由動畫權重(⑥ 第 3 點)驅動,兩種地面變體
   `sync` 同相 —— 解掉「走進水裡會踏空一拍」。
3. **每個事件 2~4 個 take + `playbackRate` ±5~10% 抖動**。現制單檔重複播是最強的人工感訊號。
4. **低記憶體階梯**:目前只有 `lowPower` 關環境音;補「低階不註冊整個 SFX 名冊」與
   **另一份 mobile BGM 編碼**(不是只調低音量)。
5. 授權底線不變:**CC0 only**(`public/audio/README.md` 已載明)。

### 驗證
新增 `audit_audio_layers`(名冊/優先序/gain 推導,離線可驗);
`npm run bal`/`npm test` 天然不受影響。

---

## ⑧ 手機瀏覽器操作

### 現況(逐項查過原文,不是憑記憶)
本專案這一塊**已經接近或優於 messenger**,下列都已經有:

- `mobile.js` 全程 Pointer Events,`pointerdown/move/up/**cancel**` 四件成套(搖桿、
  按鈕、看向板各一份);
- DPR **初始夾制已存在**:`game._dpr()` = `lowPower ? 1 : min(dpr, isTouchUI() ? 1.5 : 2)`,
  落地唯一出口 `_applyRes()` = `_dpr() × _resScale`;
- `RES_GOV` 自適應(含 `FLIP_MAX` 震盪熄火、背景分頁 `document.hidden` 不入帳)
  —— 與 messenger 的 adaptiveDPR 是同一個設計;
- **MSAA 在觸控上已關**(`antialias: off('post') && !isTouchUI()`,理由寫在 game.js 檔頭);
- `orientationchange` 已在 `mobile.js` 兩處綁定;
- 桌機走 pointer lock 的 `mouse*` 路徑是 `ctrlmode.js` 的**刻意兩制**,不是漏統一;
- 觸控提示走**長按**(`tip.js`,CLAUDE.md 明列),這是本專案對「hover 在觸控上是死的」
  已經做過的定案 —— **MUST NOT 改成合成 hover 覆蓋它**。

### 下一輪(只剩四條真的缺口)
1. **點擊 = 距離 + 時間判定**。現制觸控鈕以 `pointerdown/up` 收,沒有「移動超過 N px 就
   不算點擊」這一道;症狀是搖桿邊緣的滑動會誤觸鄰近鈕。
2. **旋轉 debounce 依裝置**:iOS 在一次旋轉中會連發數個中間尺寸,只有最後一個是對的;
   現制沒有 debounce,等於在旋轉過程中重配 render target 數次(hitch + 錯尺寸)。
   iOS 500ms / 其他 50ms。
3. **背景分頁回來的 `dt`**:`RES_GOV` 已排除隱藏分頁,但**模擬那一側**要確認回來的第一幀
   不會積分一個數十秒的步進(現制多處是 `Math.min(1, dt*k)` 夾制,能擋住大部分,
   但那是逐處的權宜)。與 ⑥-1 同一條縫一起做。
4. **桌機 DPR 上限 2 → 1.15 是否跟進**:messenger 對 `dpr ≤ 2` 的螢幕只給 1.15。
   本專案在桌機另有 post 鏈的超取樣,兩者會相乘 —— **這是取捨不是 bug**,列在此供裁決。
5. `viewport-fit=cover` + safe-area padding、root `touch-action:none` —— 需核對
   `public/index.html` 與 `style.css` 現值(本輪未查)。

### 驗證
`audit_ctrl_mode` / `audit_touch_layout` / `audit_touch_gesture` MUST 逐項不動;
㋕ 真機:旋轉一次、切到背景再回來、5px 位移的點擊、300ms 長按。

---

## ⑨ 立體結構:技術全部保留,只換渲染(2026-08-15 使用者定案)

**明隧道 / 山體隧道 / 地下道 / 高架橋的既有技術一行不動。** 這一輪對它們只做視覺,
理由是那些系統的正確性不是畫出來的,是**幾何 + 通行 + 彈道三端同判**驗出來的,
而新視覺完全不碰那三端。

### MUST 原封不動(改到就是回歸)

| 系統 | 縫 |
|---|---|
| 隧道/地下道剖面 | `tunFloorAt` / `underpassPlan` / `strucHw` |
| 頂板板體(站得上去 + 兩面擋砲火) | `tunRoofTop` + `makeTunnelIndex.roof`;A6b |
| 明隧道判定與構件 | `tunnelWallProfile`(三條件)、`galBores`、`carveGalleryBands`、`gal` 遮罩 → slab 第 7 欄 |
| 隧道帽 | notch + Coons patch、`boreProfile` / `boreClearance()` |
| 法枠工 | `buildCribs` / `cribColumn` / `quadTo` 繞向 |
| 高架橋 | decks、`deckAt`、橋上墩座、`sweptSolid` 連續澆置 |
| 道路 | `carriageHw` vs `strucHw` 兩件事、`gradeRoadBeds`、`markBaseAt` |
| 通行/彈道 | `_slabHitT` / `ceilingAt` / `lev` 回報 / `slopeBlocked` / A29 四旗標 |

⇒ `audit_open_tunnel` / `audit_underpass` / `audit_layer_block` / `audit_road_joint` /
`audit_road_bed` / `audit_bridge_*` / `audit_traverse` **MUST 逐項不動**。
任何一支變紅就是視覺改動漏進了幾何。

### 只改這五件(全在材質/著色層)

1. **材質改走新版 `cel()`**(§0-b School B)。幾何、碰撞、slab 一格未動。
2. **MUST 宣告 MRT 輸出 `gInfo`**。隧道/橋樑用的是自寫或客製材質 ⇒ 漏宣告的代價是
   **整批不畫、console 無訊息**(A46 那一族)。這是本項最容易靜默壞掉的一條。
3. **逐結構的 `outlineContribution`**(§0-c):
   - **洞內拱圈、待避所、坑門冠石 → 貢獻 1**(這是全場最需要線的地方,洞內只有輪廓在說話);
   - **法枠工格網 → 貢獻 < 1**,而且要吃雜訊斷線 —— 逐格出線就是一張技術圖;
   - **橋面伸縮縫/欄杆立柱 → 中等**,現制靠二階差分逐柱出線,量太滿。
4. **坑門混凝土 ↔ 上方山坡的界線改成 `surfaceId` 邊**,不是靠幾何縫。
   現制那條線是兩個量體剛好接在一起;新制它是材質換手,線會自己出來且不吃 z-fight。
5. **洞內照明**:School B 下洞內全部落在陰影色,會平成一塊黑。
   套 CLAUDE.md 既有的定案 ——「**不亮的凹處要 `emissive`,不是換淺一點的顏色**」
   (自動販賣機取出口那一課)。隧道燈具/洞口反光帶用同一招。

### 一條新的交互作用(⑨ × §0-a)

**分區切面的線工不得切過結構足跡。** 隧道 notch、橋樑足跡、明隧道柱列帶要進切面的
keep-out 名冊 —— 與 `hillAt` 的 keep-out 同一份。不做的話,一條道路中心線會把橋面下
的地面切成兩個面、各自配一種地表,而橋墩就站在界線上。

驗證:`audit_traverse`(㋓)MUST 逐項不動 + ㋕ 真機走進兩個洞、走上橋面各一次
—— 洞內是新視覺唯一沒有任何離線稽核看得到的地方。

---

## 執行順序建議(價值 ÷ 風險)

| 序 | 項目 | 風險 | 逐位元中性? |
|---|---|---|---|
| 1 | ⑧-1 點擊判定、⑧-2 旋轉 debounce | 低 | 是 |
| 2 | ⑥-1 幀率無關阻尼單一縫(含 ⑧-3) | 低,影響廣 | 否(手感會變,MUST 量) |
| 3 | ①-1 `outlineContribution` 打包(§0-c) | 中 | 旋鈕關 = 是 |
| 4 | ①-2 雜訊斷線 + ①-4 深度門檻擇一 | 低 | 旋鈕關 = 是 |
| 5 | ⑤-1 玩家位移植被、⑤-4 落花粒子 | 低 | 是(純新增) |
| 6 | ⑦-1 區域環境音、⑦-2 gain-ride、⑦-3 多 take(§0-d) | 低 | 是 |
| 7 | ②-1 葉片卡冠層(含同深度) | 中(新材質 + MRT 宣告) | 否 |
| 8 | ④-1 wipe 轉場、④-2 dissolve | 中 | 旋鈕關 = 是 |
| 9 | ⑤-2 岸邊泡沫、⑤-3 倒影塊 | 中 | 是(純新增) |
| 10 | ③-1 載具 `SPEC` 收斂 | 中 | 否 |
| 11 | ⑥-2 GPGPU 鳥群 | 中 | 是(純新增) |
| 12 | **①/② 賽璐璐學派切換(§0-b,已定案「改」)** | 高 | **否** —— 13 張定場照全變,MUST 先拍基準 |
| 12b | **⑨ 立體結構重新渲染**(隨序 12 一起,材質/MRT/貢獻/emissive 五件) | 中 | 否(跟著 12 變) |
| 13 | **④-A 線工切面可行性樁**(光柵化 + flood fill + 逐面標籤,只出報告與對照圖) | 低(不動出貨) | 是 |
| 14 | ④-B 樁過了才把分區烤成貼圖並接上 fragment 遮罩 | 高 | 旋鈕過渡,預設舊制 = 是 |
| 15 | ④-C 拆拼圖層:`CARPET` 清單 → 19 段遮罩階梯,`CARPET_LOT` / `carpetOrder` / `CARPET_VARIANTS` / `planSeamOverlays` / `planEnclaves` / `BORDER_SAME_ZONE` / `bandDryAt` / `emitCell` 認養整批退場。**`ZONES` 特徵層一格不動** | 很高 | 否 |

**每一項落地都 MUST 附反向驗證**(原則 9):把判定寫回壞版,對應稽核 MUST 紅字。
純表現層項目 MUST 同時證明 `npm run bal` / `npm test` **逐項不動**;
序 2 與序 12 是**明知會變**的兩項,MUST 改前先留基準(前者量手感數據,後者拍定場照)。
