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

> **2026-08-16 實測更正(序 13 樁)**,三條:
> ① **行政界在 OSM 裡是 relation 不是 way** —— `way["boundary"="administrative"]` 在 barcelona
>    戰場 bbox 內回 **0 條**而 `rel[…]` 回 **41 個**(成員 way 通常不帶 `boundary` 標籤)。
>    查 way 的話結論會是「這張圖沒有行政界」,而**每一個數字看起來都正常**。本段的正解是查
>    relation 再以 `way(r)` 展開(已落在 `venue_field.cutLinesFor`)。
> ② **「低優先」是對的,而且比計畫想的更極端**:實測採用率(附近 40 m 內沒有其他參與線才採用)
>    rio **0.0%**(0/10512)、barcelona **1.7%**(17/1028)、shibuya **7.3%**(159/2175)——
>    它幾乎全部是重複線,**那本身就是結論**。
> ③ **下面那張四步表的第 4 步順序是錯的**:「牆 texel 併進最近的 face」MUST 排在**小面併鄰之前**。
>    反過來的話面與面之間隔著牆 ⇒ 鄰接表**整份是空的**、一次都併不掉,而報告上只表現成
>    「這張圖剛好沒有碎面」(實測 taroko 1024²:238 面、面積下限 326 texel、併 **0** 次)。
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

> **2026-08-16 實測更正(序 13 樁,29 場地 × 三種人數普查)—— 上表四列有三列量錯**:
>
> | 量 | 計畫寫的 | **實測** |
> |---|---|---|
> | zoneGrid 尺寸 | 93×93(L3) | **最大 189×158**(paris 3v3)—— 93×93 量的是**可玩邊長 1200 m**,而 `buildGroundCover` 吃的是 `terrain.worldW/worldH` = **`battleRect`**(含 `ROUTE_EDGE_MARGIN` + `MAP_EXPAND`),差 1.6~1.9 倍 |
> | 實際畫出來的地面 | 2111 m 見方 | **3361.7 m**(paris 3v3:world 2450×2054 + 裙 455.6/側) |
> | 1024² 的解析度 | 2.06 m/texel | **3.28 m/texel**(2048² = **1.64**) |
> | 現制 `cell` | 恆 13 m | ✅ **正確**(29 場地 × 三種人數全部恰 13.00;232 那條上限要到 3016 m 邊長才咬得到,實測最大 2450 m) |
>
> ⇒ **建議值仍是 1024² RGBA8**,但論據要換成「3.28 m/texel 仍比現制的 13 m 格細 **4.0 倍**」
> 而不是 6.3 倍;要拿到計畫原本宣稱的 2.06 m/texel 需要 **1638²** ⇒ 實務上是 2048²
> (1.64 m/texel、16 MB)。「2048² 是 WebGL2 保證可用的下限」那一句不變。

⇒ 貼圖規格由「公尺/texel × 邊長」決定,而**不是**由地圖大小卡住:

| 貼圖 | 覆蓋 2111 m 時 | 記憶體(RGBA8) | 相對現制 |
|---|---|---|---|
| 512² | 4.1 m/texel | 1 MB | 3.2× 細 |
| **1024²** | **2.06 m/texel** | **4 MB** | **6.3× 細** ← 建議值 |
| 2048² | 1.03 m/texel | 16 MB | 12.6× 細 |

> ⚠ **本表整張是以 2111 m 算的 ⇒ 每一格都要乘 1.593**(見上方更正:實際跨距 3361.7 m)。
> 校正後:512² = 6.57 / **1024² = 3.28** / 2048² = 1.64 m/texel;記憶體那一欄不變。

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

> **2026-08-16 樁判決:三個驗收面全綠,但是「條件式 GO」不是無條件 GO。**
> 全文與逐場地數字住 [`docs/zonecut_stub.md`](zonecut_stub.md)(序 14/15 的 go/no-go 依據,下一輪必讀)。
> 一句話:**「執行期要多抓 landuse / natural / waterway / boundary 四類圖資」不是建議是前提** ——
> 去循環對照量出來,把**地被多邊形外環**從參與線裡拿掉之後,新制界線離真實地被界線的中位距離是
> shibuya **108.5 m** / rio 17.1 / barcelona 15.1 / paris 11.0 m,而現制是 4.7 / 6.3 / 3.4 / 2.8 m
> ⇒ 沒有那道門的話新制退化成「只有道路 + 坡度」,而那一版**比現制更差**。

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

> **2026-08-16 實測更正**(序 12 落地;基準照全表住 [`docs/shots_baseline.md`](shots_baseline.md)):
> ① **`PCFSoftShadowMap` 已經在用**(`game.js`)⇒ 那一條**沒有程式要改**,只有檔頭的「為什麼」
>    與一條守門斷言(落在 `audit_cel_pipeline` Ⅺ⑨,不是 `audit_daynight`)。
> ② **反向驗證那一句在旋鈕制下講不通,MUST 改寫。** 兩派並存之後 ramp 斷言守的是**仍在服役的
>    School A**,本來就該綠。正解 = 新的 `--break-school`(4 條紅),而 Ⅰ 與 `audit_visual_prefs` Ⅱ
>    的 27 條 MUST **仍全綠**。
> ③ **`uShadowTint` 不是「HSV 位移」** —— 字面的 `h -= 0.02; v *= 0.5` **不保 Rec.709 亮度**,
>    與 A14 ③(色相偏移 MUST 亮度中性)正面衝突。落地改成「亮側 × 既有 `shadowTintRGB(a)`
>    再把**亮度**重正規化回 `SHADOW_V × 亮側亮度`」—— 色相仍由同一份 `SHADOW_HUE` 一張表決定、
>    仍分 mech/env 兩軌、仍由兩根既有拉桿驅動,而 `rgb2hsv`/`hsv2rgb` **一行都不必寫**。
>    「逐材質 tint 色值轉成色相偏移量」那句話的落點就是這裡。
> ④ **落地是「兩派並存 + def 翻成 `'b'`」而不是刪掉 School A**:`RAMPS` / `toonGradient` /
>    `celRampDepth` 與那 27 條斷言**整套原封不動留著**,切回舊制 = `celSchool` 改回 `'a'` 一行。
>    翻 def 的前提有兩個,兩個都已成立:㋐ 裸 `MeshToonMaterial` 的凍結名冊清空(`biomes.js`
>    那 4 處改呼叫新的 `toonPlain`;硬閘 = **名冊非空 ⇒ def MUST NOT 是 `'b'`**)、㋑ 改制前後的
>    定場照都拍過。⚠ 名冊沒清空就翻 def = **明知故犯地出貨一個 A14 ④ 違規**(同一棵樹的葉子
>    硬切、樹幹漸層),而每一條既有斷言照樣全綠。
> ⑤ **`bands` 的語意換成硬度之後,`bands = 4` 的中間那一階是真的消失了**(硬切只有一個終端)——
>    taroko `hilltop` 實測 **56.97%** 的像素改變,幾乎全在那面坡上,整片山坡回到兩塊色。
>    **這是待裁決不是 bug**(SKILL 的立場是「direct light 撐不起緩坡,那是材質色階的事」)。
> ⑥ **`uCelKey`(JS 端的主光色 uniform)刻意沒有做**:現制在 GLSL 端直接加總 three 自己的
>    `directionalLights[i].color` ⇒ ①日夜循環自動跟著走 ②**沒有第二份數字可以分家** ③零跨檔相依。
>    第二份的症狀會是「夜戰的暗側是一個與太陽無關的常數」、`DAYCLOCK` 整套在畫面上靜默失效,
>    而 `audit_daynight` 每一條斷言照樣全綠(它量的是資料不是像素)。

### §0-c 打包編碼

`gInfo.a` 現在是 `INK_CLASS`(`> 0.25` 當哨兵,LAND = 0.5)。打包後:

```
gInfo.a = class * 0.5 + contribution * 0.5     // class ∈ {0, 0.5, 1.0} 取低半、貢獻取高半
```
或分離式(較穩):**類別碼移進 `gInfo.b` 的低位**,`.a` 全部讓給 contribution。
**選哪一種 MUST 先量 8bit RT 的量化誤差** —— 現制 `LAND = 0.5` 在 8bit 上存成 0.50196,
門檻 `> 0.25` 是為了這件事訂的(A46 那一族的同型問題)。
沒有第二個 draw buffer 的裝置(`_mrtCap` 為假)MUST 逐位元退回舊制。

> **2026-08-16 實測更正**(第一輪量測 + 序 3 落地各補一條):
> ① **上面那條加法式在數學上不可解**,不是「精度不夠」而是**值域重疊**:
>    `class·0.5 + contribution·0.5` 在 class = 0.5 時給出 [0.25, 0.75]、class = 1 給出 [0.5, 1.0]
>    ⇒ 解不回來。定案改成**同一個通道、半位元組切**(仍是「打包」,只是換一個解得回來的編碼),
>    寫入 `(clsIdx·16 + round(ctr·15)) / 255`、讀取 `cls = floor(q/16)`、`ctr = fract(q/16)·16/15`。
>    真 GPU RGBA8 MRT `readPixels` 實測(64 texel × 類別 × 16 階):**類別錯 0 筆、貢獻誤差 0.000**;
>    每一個值都是 `k/255` 的精確 8bit 位階 ⇒ 8bit UNORM 與浮點 RT 上都是恆等。
>    貢獻只要 16 階就夠 —— 它的用法是 `step(noise)` 與最近面覆寫的 `ceil`/`floor`,**本來就近乎二元**。
> ② **類別是四個不是三個**:②-1 的群組剪影需要第四個 `GROUP = 3`(NONE 0 / LAND 1 / HARD 2 / GROUP 3)
>    ⇒ `.a` 的上限由 47/255 = 0.184 變成 **63/255 = 0.247**。仍然 < 0.25 ⇒
>    「舊哨兵門檻恆不成立」那條結論**不變**,但數字要改。
> ③ **連帶必須一起改的一條**:`postfx._mkRT` 原本給兩張附件都是 `LinearFilter`。今天沒事只是因為
>    取樣偏移恰好是**整數個 texel**(`INK.THICK = 1.0`)⇒ 落在 texel 中心;一旦有人動 `THICK`,
>    線性內插會把相鄰的 `q` 混成一個**不存在的類別**。附件 1 MUST 是 `NearestFilter`(已落地)。

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

> **2026-08-16 實測更正**(序 3 / 序 4 落地時量到的四條):
> ① **第 1 點的「通道」與「哪一款東西給多少」是兩半,計畫把它們寫成同一格。** 序 3 交的是**縫**
>    (編碼 / 寫入 / 讀取 / 最近面覆寫全部落地),**呼叫端一個都沒接**(78 處 `envMat`/`toonMat` 全吃預設)
>    ⇒ 賦值是序 7 / 序 12b 那幾道的事。
> ② **第 2 點的落點是「場景 RT 的 alpha」不是 `gInfo` 的 `inkC`。** 兩個理由:`inkC` 只有 MRT 配起來
>    時才存在(`inkMrt`/`lutSrc`/`inkGroup` 三者皆關 = **出貨預設**時根本沒有第二張附件)⇒ 斷筆在
>    預設組態下會是徹底的 no-op;更硬的一條是序 3 的**最近面覆寫**是為**逐材質常數**設計的硬決定,
>    餵逐 fragment 雜訊進去的話,任何一格「斷掉」的近鄰會以 `floor(0.12) = 0` 把它**後面**所有的線
>    關掉 ⇒ 輪廓被大面積侵蝕。alpha 那條通道沒有這個問題,而且它同時餵給深度訊號與折邊訊號
>    ⇒ 兩種線一起變細 = 真的像筆抬起來。計畫原文只寫「各一條 `step(noise)`」沒有指定通道
>    ⇒ 這**不是與計畫衝突,是把「寫入端」講得更精確**。
> ③ **第 3 點的 `surfaceId += grassMask * 0.1` 會撞號,而且 `coverAt` 在本儲存庫查無**(全庫零命中,
>    那是參考專案的 API)。0.1 / 0.15 落在現役槽 0.1015625 / 0.1484375 的 `INK_MRT.ID` 0.004 門檻**之內**
>    ⇒ 那兩種地貌對建物的線**靜默消失**;唯一不撞號的編碼是**整數格 `k/64`**(`nextSurfId` 是半整數格)。
>    載體也不是 fragment 遮罩而是**逐頂點 `aLandId`** —— 本專案沒有任何 fragment 空間的 grass/rock 遮罩
>    (`field.js` 只產出**風化**場,與地貌無關),真正的地貌分類是 CPU 端逐 13 m 格的 `zoneGrid`/`subGrid`。
> ④ **第 4 點定案:維持 `INK.K_S`,不換 `1 − n.z`。** 這是**定案**不是「暫不處理」,理由三層:
>    ㋐ 兩條曲線**在任何單一係數下都配不起來**(K_S 版 2° 給 11.73×、45° 給 1.37×;`1 + K_N·(1 − n.z)`
>    的上界恆為 `1 + K_N` ⇒ 配 2° 就把 45° 斜面推到 3.09 倍過度抑制,配 10° 就讓 2° 只剩 0.30 倍);
>    ㋑ `1 − n.z` **只有 `inkMrt` 開著才拿得到法線**,而它預設關、WebGL1 上沒有 ⇒ 換過去等於
>    **出貨預設組態完全失去掠射抑制**(=「整片山坡畫滿等高線」那個病灶原樣回來);
>    ㋒ 哨兵像素(天空 / 護盾 / 粒子 / 招牌)沒有法線 ⇒ 要第二份門檻 = 第二份實作。
>    落地的是「掠射抑制項恰一項」這條斷言 + `--break-graze`。**若使用者仍要換,那不是序 4 的體量**
>    (要同時讓 `inkMrt` 從 opt-in 變必要、重調 `EDGE0`/`EDGE1`/`K_D`、為哨兵準備第二份門檻、
>    並先拍 13 張基準定場照)⇒ 屬序 12 的等級。
> ⑤ **第 5 點是從零開始的九條不是補強**:`audit_visual_prefs` 改制前對 3D LUT **一條斷言都沒有**。

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
2. ✅ **苔草/濕痕改成 triplanar 遮罩**,不是散布幾何。與 ① 第 3 點同一條 `surfaceId` 縫。
3. ✅ **布料**:本專案沒有人物,但**旗幟(`flags.js`)、機體垂布、繩索**適用同一條 ——
   樞軸在掛點、`sin + 0.33·sin(3.3ω)`、逐件 rate/phase。`flags.js` 已有分段旗面,
   補「樞軸不在中心」與「rate/phase 逐面不同」。

> **2026-08-16 實測更正 / 範圍變動**(序 7 落地 + 使用者本輪追加):
> ① **使用者追加了兩塊**:除了葉冠,**山頭 / 巨石 / 石堆**也要「一個東西就是一個剪影」。
>    落地成 巨岩 = 兩個表面群組(主量體 vs 貼壁結構件,判據是外廓比 `MEGA_BODY_F`)+ 內部折邊門檻;
>    石堆 = 逐堆一個號 + 由 `detailR` 推導的 contribution;遠景背景 = 呼叫端注入 `INK_CTR.BACKDROP`。
> ② **第 1 點的落地是「整棵樹」不是只有葉冠**:葉列 `ink:'group'`、木質列 `ink:'hard'`
>    ⇒ 幹的內部折邊留著、幹與冠的交界不出線。要連幹也收是一行,但 110 m 神木近距離會讀成
>    一根沒有轉折的實心柱 —— **這是取捨不是 bug**,已開票。
> ③ **葉片卡走 `applyCelPatch` 的 `CEL_LEAFCARD` define,不是計畫字面的「一支新的葉片
>    `ShaderMaterial`」。** 自寫材質要重新繼承三條契約(`gInfo` 宣告 / 軟性 alpha / 世界曲面),
>    走 define 是結構性繼承。**這是對計畫字面的偏離,已開票請使用者放行。**
> ④ **第 2 點(苔草 / 濕痕 triplanar 遮罩)在第二輪 MUST NOT 做,而且理由與 ①-3 是同一條**:
>    現制的 `icefield`/`scree`/`plateau` 換手發生在 `ground.js` 的逐格投票邊界與 `CARPET_LOT`
>    量化格上、**不在真實雪線上**,而全部地貌共用 `LAND_SURF_ID` 正是 2026-08-13 為了藏那條接縫
>    定的案(A46 / `audit_cel_pipeline` Ⅶ)。現在給它一個 id 邊 = 把剛藏起來的拼圖接縫用黑線
>    重新描一次。它是 §0-a 遮罩面(序 14/15)的**推論**,不是可以先做的廉價替代。
>    **2026-08-17 阻塞解除**:序 14/15 已把正式地形換成 OSM 線工切面的 `landField`；本項只在
>    `CEL_LAND_FIELD` 內以分區語意 × 世界法線 × 兩尺度三平面噪聲產生硬遮罩，道路 / 建成遮罩
>    排除。顏色恆生效；遮罩邊的 `surfaceId` 仍由既有 `landInk` 開關閘住，沒有復辟舊拼圖邊。
> ⑤ **`leafCard` 的預設一旦翻成 `auto`/`all`,`tri_budget.json` MUST 先重量**
>    (`measure_veg_tris --kinds`/`--giants` → `measured_kind_tris`/`measured_veg_total_max` → 重跑
>    `intake_parts`),否則那道整層總量閘的**分母**被靜默放寬。現值 def = `off` ⇒ 出貨組態的
>    三角形數一格未動(`intake_parts` 363 ✅)。

### 驗證
`audit_object_joints --seeds 8`(接合不得因換冠而變)、`audit_soft_stroke`(軟性契約)、
`audit_cel_pipeline`(新材質必須宣告 MRT 輸出)、㋓ `shot_scene` 樹冠定場照。

---

## ③ 建築 / 電器 / 交通工具

### 現況
- 建築:`biomes.js` 的 `BLD_LIB` 整棟量體 + `wallpanel.js` 面板 + `facadeTex`;
  已經是「一個生成器 + 一張表」的形狀,而且有剖面/平整度/窗格對齊三道閘。
- 載具/電器:`props.js` 等的擺件,**沒有**像 sakura `vehicles.js` 那樣的 `SPEC` 列表。

> **2026-08-16 實測更正**:**本儲存庫沒有 `props.js`**(全庫零命中,那是參考專案的檔名)。
> 載具的四份手寫副本實際住在 `hazards.js BUILDERS.wreck`(唯一有輪子的那一份)、`biomes.js car()`
> (封路車禍)、`siteplan.js CIVIC_PARTS.lot`(唯一登記碰撞柱的那一份)、`ground.js DETAIL_DEFS.carwreck`;
> 貨櫃有四份(`beacons.depot` 6.1 m / `edgewall.ship` ~5.8 / `edgewall.trucks` / `ground.container` 2.7)、
> 列車有兩份(`biomes.makeTrain` / `edgewall.train`)。尺寸從 **1.71 m 到 6.1 m**,其中三份車連輪子
> 都沒有 —— 那不是風格差異,是四個人各畫了一次(原則 2 的反面)。

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

> **2026-08-16 實測更正**(序 10 落地):
> ① **第 4 點落地成「分桶鍵不動、合併時併桶」而不是收窄分桶鍵。** `audit_soft_stroke` ⑧ 有一條
>    **逐字釘住 `${pc}|${e}|${sf}` 字面**的斷言,而那個鍵同時決定材質旗標與擺動 span 的分母。
>    改成只在**合併那一步**把同一組(自發光 × 軟性)的桶併成一顆 mesh、顏色走 `mergeGeos(geos, cols)`
>    的頂點色 ⇒ **結果與規格要的數字逐項相同**(lot 25 → 2 / park 12 → 4 / pitch 7 → 3),
>    而且不必動別道的斷言。
> ② **障礙那一半(`hazards.buildHazard` 收尾合併)沒做,而且有一個沒有錯誤訊息的坑**:
>    `chiselRock` 建構時掛在 `mesh.userData.outlineGeo` 的平滑法線副本是 `outlinify` 專用的,
>    而 `mergeGeos` 只保 position/normal/color ⇒ 合併之後鑿刻岩的**描邊外殼會沿硬邊面裂開**。
>    要做就得同時決定「rock 件排除在合併之外」或「同步併一份 outlineGeo」,而那牽動 `hazards`
>    的描邊路徑(全專案唯一還在用**反轉外殼描邊**的一族)。
> ③ **`ground.js DETAIL_DEFS` 的 `carwreck`/`container` 刻意維持凍結**:它們的 `geo` 是
>    `THREE.BufferGeometry` **不是描述子**,接上型錄要在 `ground.js` 另寫一支轉接器(而
>    `biomes.vehGroup` 已經是那一份的唯一出口 ⇒ 第二份實作)。⚠ 那兩款的**真實尺度**問題
>    (1.71 m / 2.70 m vs 其他副本的 3.5~6.1 m)是 §2.5 與 §2.3 的**正面衝突**:改尺寸 ⇒ `detailR` 變
>    ⇒ `detFree` 的淘汰結果變 ⇒ **全圖散佈序列整條推移**,而畫面上只表現成「這張圖跟上次不一樣」。
>    已開票。
> ④ **`edgewall.js` / `beacons.js` 兩處尚未收斂,而且各被一條稽核釘住**:`audit_world_edge:572`
>    斷言「`edgewall.js` 只 import rng.js」是**數量**判定(加第二條 import 就當場紅);
>    `audit_beacons:39` 把 beacons 的整段純區塊丟進 `new Function` 執行(呼叫 `makeVehicle` 就
>    `ReferenceError`)。兩處各需要**一行**改到別道擁有的稽核,清單已印在 `audit_vehicle_spec` Ⅴ-b。

> **2026-08-17 使用者裁決（只記錄，下輪執行）**:
> ① `hazards.buildHazard` 採「**rock 件排除在合併之外**」；一般零件逐材質合併，
> `chiselRock` 與其 `outlineGeo` 維持現役獨立描邊路徑，MUST NOT 順手改成合併 `outlineGeo`。
> ② `ground.js DETAIL_DEFS.carwreck` / `container` **改採真實尺度**；接受 `detailR`、
> `detFree` 淘汰結果與後續決定性散布佈局遷移。下輪 MUST 重新建立場景基準，不能拿舊佈局
> 做逐位元相同比對；仍須證明同一份新程式碼、同一種子可重現。

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

> **2026-08-16 實測更正 / 落地說明**:
> ① **④-1 的兩個呼叫點在 `game.js`,而落地是三個時機不是兩個**(開戰揭幕 / 陣亡過場收尾 / 結算),
>    收成唯一實作 `game._wipeCut(onCut, color)` ⇒ `playWipe` 恰三處(1 個純 reveal + 那一對)。
>    規格漏寫的一條:**cover 播完幕停在全覆蓋** ⇒ 每一個 cover 呼叫點都必須自己接 reveal。
> ② **`_tickWipe` 不由 `game.js` 推**:落地時把它放進 `postfx.render()` 自己組 chain 那一段
>    ⇒ 呼叫端不必給 dt,而且**再推一次 = 幕以兩倍速播完**。
> ③ **④-2 只做了「出現」那一半。** 「消失」要 ghost 清單(`this.ents` 有 20+ 個消費端,含準星
>    解算與鎖定);「遠距剔除」這個功能**本身還不存在**(`data.js DOF` 檔頭:「日後真做距離剔除時…」)
>    ⇒ 縫留好但 `DISSOLVE.FAR_M = 0` ⇒ **那一段根本不編進著色器**。
> ④ **④-3 的「嚴格等式」加了一條地板** `fadeEnd ≥ combatReachM() / FADE_F`:不加的話「迷你地圖 +
>    霧天」那一格會讓 `fade0 > fade1`(smoothstep 端點反轉),而且**打得到的目標會沒有輪廓線**。
>    這是對計畫原文的偏離(它與 DOF Ⅵ-b 是同一條規則的兩端),已開票。另:④-3 對 `clear` 以外
>    四種天氣是**設計上的行為改變**(線從此跟著霧收),**不是旋鈕** —— 兩個錨不可能並存。
> ⑤ **④-4 落地為六支稽核的純註解**(`audit_traverse` / `audit_ground_drape` / `audit_road_joint` /
>    `audit_layer_block` / `audit_underpass` / `audit_open_tunnel`),一行執行碼未改、六支通過數逐項不變。
>    ⚠ 規格另外點名的 `audit_ground_tile.mjs` 與 `shot_scene.mjs` **不在本輪的擁有清單裡** ⇒ 未做,
>    它們是純註解、零行為,可以獨立排在任何一輪。

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

> **2026-08-16 實測更正**(序 5 / 序 9 落地時量到的五條):
> ① **第 2 點那句「本專案的水面現在只有波形,沒有 shore band」是過期的,而執行順序表把 ⑤-2 標成
>    「是(純新增)」是錯的。** `biomes.js` 早有一條岸邊泡沫帶(8 m 格點 + Canvas 徑向漸層**軟** alpha
>    + 固定在 `waterY + 0.1` 的平板 + opacity 呼吸 + 貼圖漂移),而且它**正是這一項要否定的那一種**
>    (浪高 ±0.9 m 會直接穿過那片固定高度的平板)。⇒ ⑤-2 是**替換不是純新增**,而且
>    **`foam = 0` 也不是「回到今天」**(它是「岸邊連浪都沒有」)。
> ② **第 3 點「現制沒有倒影」正確。** 落地取「烤好的深度場」那條路(零額外 render pass、texel 1~1.5 m,
>    繞得過地形與所有登記過的 `blockers`,繞不過純表現層擺件與移動中的機體);另兩條路的代價
>    (深度 prepass = 多一趟全場 render;水面 `depthWrite:false` = **水岸那條勾線會整條消失**且狙擊
>    景深改對焦到水底)已量清,見交付說明。
> ③ **第 4 點的預跑「40 步 × 0.1 s」改成「步長 0.1 s、步數推導」。** 固定 40 步 = 4 秒,而本專案的
>    落葉樹冠帶高 10~20 m、落速 0.45~0.95 m/s ⇒ 4 秒只走得了 1.8~3.8 m,**首幀下半場是空的**
>    (開場會看到一批花同時從樹冠開始掉),而每一條既有斷言都會過。步數改由「最慢的那一片走完
>    `PREWARM_TURNS` 趟自己的高度帶」推導 —— 這是「推導值 MUST NOT 手寫」的直接套用,不是對計畫的否定。
> ④ **第 4 點走 CPU 步進而不是 GLSL,是被既有稽核的形狀逼出來的**(不是效能取捨):
>    `audit_soft_stroke` Ⅲ 的 sway 正規式捕獲段做**全域** `sin(` 計數 ⇒ 在頂點著色器裡為落花加
>    第三個 `sin(` 會讓那一條紅,而紅字的理由(「兩個不可通約的正弦」)與落花完全無關。
>    ⚠ 另:**本專案的 `VEG_DEFS` 沒有櫻花樹種** ⇒「落花」在這個世界裡沒有對應的來源幾何,
>    色調只能由既有的 `ENV.seasons[].accent` 推導,而落葉名冊由 `key:'foliage'` **推導**
>    (實得 bamboo / broadleaf / birch / shrub / mangrove / sapling)。要不要真的加一款開花樹種
>    是**內容決定**,已開票。
> ⑤ **第 5 點(雲層飄移)已經完成,本輪零工作。** 證據兩行:`environment.js` 的環繞取模**已經**先加
>    半個 `WRAP` 再減、`clouds.step(celWindTime())` **已經**吃全場同一支風時鐘;SKILL 的其餘四條
>    (`depthWrite:false, fog:false` / `renderOrder = -9` / 雙層 billboard / `frustumCulled = false`)也都在,
>    而且 `audit_soft_stroke` Ⅴ 已有**四條行為直測**在守。⇒ 執行順序表那一格應改成
>    「已完成(2026-08-13 隨海浪那一輪落地)」,本輪一行都沒有動 `environment.js`。

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

> **2026-08-16 實測更正**(序 2 / 序 11 / ⑥-3 落地):
> ① **⑥-3 在計畫裡沒有獨立序號**(被綁在序 11 裡),而 ⑦-2 的 gain-ride **吃的正是它**
>    ⇒ 本輪把 ⑥-3 提前到 ⑦(序 6)之前落地。順序表應把它獨立成一格。
> ② **⑥-3 收掉的是三份互相矛盾的實作**,值得記下來:速度(`locomotion.L.speed` vs `game._moveSpd`
>    —— 後者未阻尼、吃 8Hz 插值鋸齒,而且 `* 0.6` 是逐幀常數 = **序 2 漏掉的幀率相依處**)、
>    離地(`MORPH.GROUND_Y` 2 / `SPEC_CAM.FLY_M` 2.5 / 環境音的 `> 3` ⇒ 2~3 m 之間機體已經是飛行型
>    而音床還在踏地)、「他在不在動」(`_updateMoveAudio` 又自己寫了一條速度曲線)。
>    ⚠ **音效端因此刻意不是逐位元中性**(離地門檻 3 m → 2 m、gate 曲線換來源),沒有任何離線模型
>    守得住 ⇒ 真機聽一次(㋕)。已開票讓使用者有機會否決。
> ③ **第 2 點的積分器落在 JS 而不是 GPGPU**(對計畫字面的偏離,**已開票請使用者放行或否決**)。
>    計畫列的六項(曲線 / 逐軸噪聲 / 弱彈簧 0.0003 / 摩擦 / 分群 / `uSnap`)**一項都沒有刪**。
>    量到的四筆成本:㋐ WebGL2 在本專案只是**能力探測**(`postfx._mrtCap`)⇒ GPGPU 必須配一份
>    CPU fallback = **兩份實作**;㋑ compute pass 要在 `Pipeline` 之外呼叫 `setRenderTarget`,撞上
>    「MUST NOT 在 game.js 另開第二條更新迴圈」;㋒ 積分器在 GLSL 裡 ⇒ **反向驗證(原則 9)離線
>    做不出來**,七支 `--break-*` 全部退化成 ㋓;㋓ A25 多兩張浮點 RT 要 dispose。買到的是零 ——
>    GPGPU 要 1e4 以上才回本,而鳥群的隻數由「2 = 一對 / 3 = 幾隻 / ≥4 = 一群」的美術語意決定,
>    量級是**數十**。
> ④ **第 1 點(幀率無關阻尼)已於第一輪落地**,連帶把 ⑧-3(背景分頁的 `dt`)一起收掉。

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

> **2026-08-16 實測更正**(序 6 落地):
> ① **第 2 點說移動床的 gain ride 要補 `setTargetAtTime` —— 那一段 2026-07 就已經是它了**
>    (天生 click-free 且幀率無關,序 2 的 `lerpFPS` 不必碰它)。⑦-2 真正缺的只有「地面變體」與
>    「吃權重」兩件,兩件都已落地。「移動床沒有接動畫權重」那半屬實。
> ② **2026-08-17 已補齊七床 + 兩份行動版 BGM。** 七床為 10 秒 mono OGG、每床 24~75 KB；
>    行動版 BGM 為獨立 32/48 kbps 編碼，各低於 800 KB。逐檔 CC0 來源帳與轉製關係住
>    `public/audio/README.md`；缺檔降級契約仍保留。
> ③ **`audio.js` 全檔沒有 `visibilitychange` 處理**(切到背景分頁時 BGM 與常駐床照樣播,而
>    `game.js` / `main.js` 已有 `document.hidden` 的先例)。計畫 ⑦ 的四條沒有列它,依「刻意設計
>    MUST NOT 補完」本輪**不動,只回報**。

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

> **2026-08-16 實測更正**(⑧-5 落地):
> ① **「⑧-5 只是核對」不成立 —— 它含一個真缺陷。** `viewport-fit=cover` 與 `env(safe-area-inset-*)`
>    改制前就已經有了(`index.html:6` + `style.css` 12 個消費點),參考專案多的 `shrink-to-fit=no` /
>    `minimal-ui` 在現行引擎上是 no-op(刻意不加)。真缺口兩條:㋐ 全 repo **零** `text-size-adjust`;
>    ㋑ **五條頁面級觸控硬化綁在 `body.touch-ui`,而那是房主可關的房間設定** ⇒ 房主一鎖「限定滑鼠鍵盤」,
>    真手機上捏合縮放 / 下拉刷新 / 長按選字 / 點擊高亮的保護**整組消失**,而遊戲照樣在跑、零錯誤訊息。
>    修法 = 改綁新的**裝置** class `body.touch-dev`(判定唯一縫 `ctrlmode.touchCapable()`)。
>    建議把這一格由「核對」改寫成「核對 + 一項缺陷修補」。
> ② **`text-size-adjust` 的驗收面不是「iOS 橫式字變小」而是 HUD 帶比例** —— 它與 `COCKPIT` 的
>    `HUD_BOTTOM_F` / `fitHudBand()` 是同一條規則的兩端(字級被瀏覽器改 ⇒ 量到的自然高變 ⇒ `--hud-k` 變)。
>    計畫沒有寫這條連動,建議補進去。
> ③ **第 3 點(背景分頁的 `dt`)已隨序 2 的幀率無關阻尼一起收掉**,不再是缺口。
> ④ **第 4 點(桌機 DPR)仍未裁決,而且爭點被計畫講反了**:參考專案的 1.15 是 `setPixelRatio(1)`
>    **之上的 RT 縮放**,本專案的 2 是**裝置像素比的天花板** —— 兩個不同的量。另 `RES_GOV.MIN`(0.7)
>    × 天花板 2 ⇒ 桌機有效像素比的**地板是 1.40**,1.15 在今天的自適應範圍**之外**。爭點只在
>    `dpr ≤ 2` 那一支(HiDPI 桌機/筆電),與手機無關(觸控路徑 `TOUCH_DPR_MAX = 1.5` 已與參考專案
>    逐位元同值)。三選一見交付說明。
> ⑤ **新增的代價一條**:`user-select: none` 由「pad 版型」擴到「有觸控硬體」⇒ **有觸控螢幕的 Windows
>    筆電 / 2-in-1** 第一次吃到它,實測房間 PIN(`#roomPin`)與區網網址(`#roomUrls`)由 `auto` 變 `none`
>    ⇒ **房主想把網址或 PIN 複製給隊友時選不起來**,而那台機器多半正是筆電。已開票(三條路,
>    最小的一條是加一行窄豁免放行房間中繼資料)。

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

> **2026-08-16 實測更正:上表有六個名字在本儲存庫查無**(全庫 grep **零命中**)——
> `buildCribs` / `cribColumn` / `quadTo` / `boreProfile` / `boreClearance` / `sweptSolid`,
> 那是參考專案的詞彙。連帶 ⑨-3 授權清單點名的**法枠工格網 / 待避所 / 坑門冠石 / 橋面伸縮縫 /
> 欄杆立柱**也沒有對應幾何。序 12b 的落地是**對號入座到既有幾何,不新增任何幾何**
> (新增幾何 = 新增世界內容,要回答 §2.3 的「這一段消耗了幾枚共享 `rnd()`」,而 ⑨ 的前提是零消耗):
>
> | 計畫寫的 | 本儲存庫的實際落點 | 落地的授權值 |
> |---|---|---|
> | 洞內拱圈 | 地下道擋土牆 `wall`(帶高 = `TUN.CLEAR` + 0.5)+ 天花板 `ceilSegs` + 橫樑 `beams` | 推導值 = 1 ⇒ **維持預設** |
> | 坑門冠石(keystone)| 額牆頂梁 `lintel` —— 它吃的是 `wallM` 那一支材質 ⇒ 冠石那一列自動成立 | 1(預設)+ `surf: SURF_ID.CONCRETE` |
> | 待避所(退避壁龕)| **沒有這種幾何**,不做 | — |
> | 法枠工格網 | 最接近的是**明隧道柱列** `galCols`(節距 `TUN.COL_GAP` = 4.5 m) | `inkRepeat(TUN.COL_GAP)`(今天 = 1;柱距收到 3.6 m 以下會自己讓步) |
> | 欄杆立柱 | 欄杆是**一條連續緞帶** `rail` 不是立柱 —— 「量太滿」的實際來源是緞帶上下兩條邊的二階差分(側視一座橋在 2.2 m 內擠著五條近乎平行的線) | `inkRepeat(bandPitchM(rail))` = **0.3333** |
> | 橋面伸縮縫 | **沒有這種幾何**;同一族的第二條緞帶是邊梁 `girder` | `inkRepeat(bandPitchM(girder))` = 0.3333 |
> | (計畫沒提,但實際最刺眼的一處)| **道路標線** `mark` —— 它與路面貼在同一平面上,id 一差就是每一條虛線、每一塊斑馬線都被描一圈黑邊 | `inkRepeat(bandPitchM(mark))` ≈ 0.0667~0.1333(逐圖不同)|

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

> **2026-08-16 實測更正**(序 12b 落地):
> ① **⑨-1 與 ⑨-2 在程式碼上是零改動。** `buildRoads` → `makeDeckIndex` 這一區的材質**今天就全部走**
>    `envMat`/`toonMat`(實測 **22 支,零原生材質**)⇒ `gInfo` 由 `applyCelPatch` 無條件寫出,
>    而「換學派」是 `toon.js` 那一側的推論。落地的是**守門**:新稽核 Ⅰ 段把「結構區塊零原生材質 +
>    22 支逐支在授權表上」釘死。
> ② **⑨-3 的授權值 MUST 推導,規格建議的「8/15」被凍結契約否決** ——「呼叫端 MUST 傳自己排零件時
>    已經算出來的間距或尺寸,**MUST NOT 手寫貢獻數字、MUST NOT 建『零件種類 → 貢獻』的名冊**」。
>    推導版在改幾何時會自己跟著走;實得值見上表。
> ③ **天花燈不寫 `contrib: 1`**:它的節距 12 m ≫ `INK_REPEAT_M`(3.6 m)⇒ 推導值本來就是 1,
>    而 `inkQuant(1)` 嚴格 === 1 ⇒ **維持預設**才是「逐位元同舊制」的證明面。
> ④ **一個順手量到的舊病灶**:洞口警示條紋的材質數 **384 → 96**(舊制在 stripe 迴圈**內**建材質,
>    每座洞口 8 支 × 最多 48 座)—— 它在沖爛 `nextSurfId` 的 **64 個槽**。⚠ **根本壓力仍在**:
>    `biomes.js` 全檔 **221 處**材質建構 vs 64 個槽,撞號的症狀是「某兩塊相接的東西之間少了一條線」,
>    **沒有任何錯誤訊息,而且逐場地不同**(材質建構順序跟著圖資走)。已開票。
> ⑤ **⑨-5 的 `emissive` 是本輪唯一「出貨預設就看得到」的畫面改動,而且沒有旋鈕**
>    (⑨-3 / ⑨-4 只住第二張附件,而 `inkMrt` 預設 `off` ⇒ 預設組態下逐像素不變)。
> ⑥ **⑨-5 夠不夠只有 ㋕ 知道。** 若真機上洞內仍讀不出來,下一步 MUST 是「再加一種會自己亮的東西」
>    (洞口反光標記 / 路面反光釘)而**不是把牆調亮** —— 後者是既有定案明文禁止的那條路。

### 一條新的交互作用(⑨ × §0-a)

**分區切面的線工不得切過結構足跡。** 隧道 notch、橋樑足跡、明隧道柱列帶要進切面的
keep-out 名冊 —— 與 `hillAt` 的 keep-out 同一份。不做的話,一條道路中心線會把橋面下
的地面切成兩個面、各自配一種地表,而橋墩就站在界線上。

> **2026-08-16 實測更正:名冊已經有一份,叫 `gradeCorridors`,不需要新開;計畫寫的 `hillAt`
> 在本儲存庫查無**(全庫零命中)。`biomes.markGradeCorridors()` 一趟做兩件事 —— 回傳逐段
> `{x1,z1,x2,z2,hw,kind:'tun'|'bridge',cy}`,同時以 `blockArea(..., hw + (kind === 'tun' ?
> STRUCT_CLEAR_PAD : 4))` 把足跡打進散布用的 `blocked` 格(`STRUCT_CLEAR_PAD =
> max(7, UND.COPE, TUN.GAL_CLEAR_W)`,現值 9)。序 13 的樁用的是**同一條推導** ⇒ 半徑一致,
> 粒度上樁是逐線段膠囊、執行期是逐節點圓盤(節距 `ROAD_SEG` = 6 m 而 pad ≥ 7 m)⇒ 沿線方向
> 樁 ⊇ 執行期,**這一半沒有缺口**。
> ⚠ **五個對不上的地方**(座標框 / 名冊來源 / 兵線補橋 / 柱列側別 / `hw`)逐條列在
> [`docs/zonecut_stub.md`](zonecut_stub.md),序 14 要嘛補、要嘛明講不管。
> ⚠ 消費端 MUST 走 `group.userData.gradeCorridors` —— `main.js` 上傳伺服器的那一份
> `.slice(0, 2400)` **會截斷**。

驗證:`audit_traverse`(㋓)MUST 逐項不動 + ㋕ 真機走進兩個洞、走上橋面各一次
—— 洞內是新視覺唯一沒有任何離線稽核看得到的地方。

---

## 執行順序建議(價值 ÷ 風險)

> **狀態欄基準日 2026-08-17**。序 1~15 全部落地；序 10b 與 ③-4 障礙合併
> 已裁決並排入下一輪，詳見本檔收尾狀態第 4 點。

| 序 | 項目 | 風險 | 逐位元中性? | 狀態 |
|---|---|---|---|---|
| 1 | ⑧-1 點擊判定、⑧-2 旋轉 debounce | 低 | 是 | ✅ 第一輪 |
| 2 | ⑥-1 幀率無關阻尼單一縫(含 ⑧-3) | 低,影響廣 | 否(手感會變,MUST 量) | ✅ 第一輪(60fps 最大落差 7.9% ⇒ 不必重調係數)|
| 3 | ①-1 `outlineContribution` 打包(§0-c) | 中 | 旋鈕關 = 是 | ✅ 第二輪(交的是**縫**;賦值是序 7/12b 的事)|
| 4 | ①-2 雜訊斷線 + ①-4 深度門檻擇一 | 低 | 旋鈕關 = 是 | ✅ 第二輪(①-4 **定案維持 `K_S`**)|
| 5 | ⑤-1 玩家位移植被、⑤-4 落花粒子 | 低 | 是(純新增) | ✅ 第二輪(⑤-1 分規則層 + 餵入端兩窗)|
| 6 | ⑦-1 區域環境音、⑦-2 gain-ride、⑦-3 多 take(§0-d) | 低 | 是 | ✅ 第二輪機制；**2026-08-17 補齊七床與兩份行動版 BGM** |
| 6b | **⑥-3 動畫權重向量**(計畫裡沒有獨立序號,而 ⑦-2 吃的正是它) | 低 | 否(音效行為改變) | ✅ 第二輪,提前到序 6 之前 |
| 7 | ②-1 葉片卡冠層(含同深度)+ **使用者追加:山頭 / 巨石 / 石堆** | 中(新材質 + MRT 宣告) | 否 → **實得:旋鈕 def off = 是** | ✅ 第二輪(走 `CEL_LEAFCARD` define 不是自寫材質)|
| 8 | ④-1 wipe 轉場、④-2 dissolve | 中 | 旋鈕關 = 是 | ✅ 第二輪(④-2 只做「出現」那一半;④-3 一併)|
| 9 | ⑤-2 岸邊泡沫、⑤-3 倒影塊 | 中 | ~~是(純新增)~~ → **⑤-2 是替換不是新增** | ✅ 第二輪(舊的格點泡沫片退場)|
| 10 | ③-1 載具 `SPEC` 收斂 + ③-2 真凹處 + ③-3 可視角 + ③-4 公設 draw call | 中 | 否 | ✅ 第二輪(10a;edgewall / beacons / DETAIL_DEFS 三筆債見 10b)|
| 11 | ⑥-2 GPGPU 鳥群 | 中 | 是(純新增) | ✅ 第二輪 —— **積分器落在 JS 不是 GPGPU**(對計畫字面的偏離,待放行)|
| 12 | **①/② 賽璐璐學派切換(§0-b,已定案「改」)** | 高 | **否** —— 13 張定場照全變,MUST 先拍基準 | ✅ 第二輪,**def 已翻成 `'b'`**(兩派並存,切回舊制 = 一行);基準照全表住 [`docs/shots_baseline.md`](shots_baseline.md) |
| 12b | **⑨ 立體結構重新渲染**(隨序 12 一起,材質/MRT/貢獻/emissive 五件) | 中 | 否(跟著 12 變) | ✅ 第二輪(幾何 / 碰撞 / slab / decks / cols / 走廊**一格未動**,八支幾何稽核逐項不動)|
| 13 | **④-A 線工切面可行性樁**(光柵化 + flood fill + 逐面標籤,只出報告與對照圖) | 低(不動出貨) | 是 | ✅ 第二輪 —— **判決 = 條件式 GO**,前提見下 |
| 14 | ④-B 樁過了才把分區烤成貼圖並接上 fragment 遮罩 | 高 | 否 | ✅ 2026-08-17：OSM 四類圖資、1024² RGBA field、fragment palette、分區 surface ID 已接 runtime |
| 15 | ④-C 拆拼圖層；**`ZONES` 特徵層一格不動** | 很高 | 否 | ✅ 2026-08-17：正式路徑停用底毯/飛地/界線發射；舊函式只留未接線相容 fallback |
| — | ⑤-5 雲層飄移 | — | — | ✅ **早在 2026-08-13 隨海浪那一輪就完成**(本輪零工作,見 §⑤ 更正 ⑤)|
| — | ⑧-5 viewport / safe-area / touch-action | 低 | 觸控裝置上**否** | ✅ 第二輪 —— 不只是核對,含**一項缺陷修補**(頁面級硬化綁錯旗標)|

**每一項落地都 MUST 附反向驗證**(原則 9):把判定寫回壞版,對應稽核 MUST 紅字。
純表現層項目 MUST 同時證明 `npm run bal` / `npm test` **逐項不動**;
序 2 與序 12 是**明知會變**的兩項,MUST 改前先留基準(前者量手感數據,後者拍定場照)。

### 本計畫的伴隨文件(第 ④ 層)

| 文件 | 內容 |
|---|---|
| [`docs/zonecut_stub.md`](zonecut_stub.md) | **序 13 的樁報告**:三個驗收面的逐場地數字、條件式 GO 的那道門、序 14 要多抓的四類圖資與五個對不上的 keep-out、序 15 的取消成本。**序 14/15 的 go/no-go 依據,下一輪必讀** |
| [`docs/shots_baseline.md`](shots_baseline.md) | **序 12 的定場照基準與 A/B**:四組 md5 全表 + School B 的量測 + **兩個拍照陷阱**(`-prefs` 那一組跨進程不穩定、`--stations` 回放不等於同參數的新鮮推導)|

---

## 執行紀錄

> 逐輪追加。每一列 = 「做了什麼 / 用什麼守住 / 留下什麼給下一輪」。

### 2026-08-16 第一輪:序 1 ~ 序 2 落地 + 序 3 的前置量測

| 序 | 項目 | 狀態 | 縫 / 稽核 |
|---|---|---|---|
| 1 | ⑧-1 觸控點擊 = 距離 + 時間 | ✅ | 門檻**沿用既有的 `LOOK.TAP_MS`/`TAP_SLOP_PX`**(空處輕點與點擊型鈕同一組定義,不另訂第二組);`audit_touch_gesture` ⑧ ±`--break-tap`(6 紅、按住型對照組仍綠) |
| 1 | ⑧-2 旋轉 debounce 依裝置 | ✅ | 新縫 `mobile.js VIEWPORT`/`isIOS`/`viewportSettleMs`/`bumpViewport`/`onViewportSettled`;`audit_ctrl_mode` Ⅸ(原文 7 條)+ `audit_touch_gesture` ⑨ ±`--break-debounce`(3 紅) |
| 2 | ⑥-1 幀率無關阻尼 + ⑧-3 | ✅ | 新縫 `data.js frictionFPS`/`lerpFPS`(舊 `camSmoothF` 改名收編);game.js 20 處 `Math.min(1, dt*k)` + 4 處手寫 `Math.exp` + `locomotion.js damp()`/`FX_K` 全數轉呼;新稽核 `audit_damp_fps` ±`--break-damp` |
| 3 | ①-1 `outlineContribution`(§0-c) | ⏸ 已量測、未落地 | 見下方「§0-c 編碼定案」 |

**⑥-1 的量測結果**(`audit_damp_fps` Ⅱ 每次跑都會印):

- 幀率無關性:k = 10、1 秒積分,30/60/144/240fps 的殘量比 **1.000000000000**(舊制 **7.0×**)。
- 60fps 上與舊制的相對落差:現役 k = 3~10 的最大值 **7.9%** ⇒ **不必回頭重調任何係數**;
  稽核以 10% 守門(超過就是有人加了大 k,那時才要重調)。
- `frictionFPS(k, dt)` 與舊制的 `Math.exp(-k · dt)` **逐位元相同**(真 GPU 頁面直測 `=== true`)
  ⇒ 後座回穩與空氣阻力那四處是純改寫。
- `npm run bal` 🎉 全綠、`npm test` 🎉 全綠、`audit_gait_anat`/`audit_morph_rig`/`audit_paper_doll`/
  `audit_spectator_cam`/`audit_view_lock`/`audit_recoil_move` 逐項不動。

> ⚠ **`viewLockStep` 是具名例外,留給使用者裁決。** 它不只是真人的視野鎖定 ——
> `server/bots.js _turn` 是**電腦玩家朝向的唯一寫入點**,而伺服器固定 8Hz:
> `min(1, 9 × 0.125) = 1` ⇒ 小角度誤差**一個 tick 就轉到位**。換成指數逼近的話同一個 tick
> 只走 67.5%、要三個 tick 才收進 3%,那是**權威側的行為改變**(原則 1),而且要照 §5.6
> 補一輪 AI 退化量測才知道代價。客戶端那一半確實有幀率相依(144Hz 比 30Hz 收斂慢),
> 但兩者共用同一個縫、拆兩份就是兩套規則 ⇒ **這一輪整支不動**。
> 三條路:①維持現狀(bot 手感不動,真人的鎖定在高刷新率上略慢)②改成 exp 並補 AI 退化量測
> ③`bots._turn` 改吃自己的一支(= 第二份實作,需要使用者明確放行)。

**⑧-1 的行為改變(刻意,不是 bug)**:點擊型鈕**按住超過 260ms 再放開不會觸發**。
這是「一次點擊 = 距離 + 時間」的直接推論,與 `tip.js` 的長按提示(380ms)同調。
若使用者認為招式/商店這類鈕應該「按多久都算」,要拿掉的是**時間**那一半(距離那一半是
⑧-1 點名的病灶),那是一行的事,但 MUST 由使用者定案 —— 兩種都自洽。

### §0-c 編碼定案(2026-08-16 量測,真 GPU RGBA8 MRT 直測)

計畫列的兩個選項裡,**第一個(加法打包)在數學上就不可解**:
`class * 0.5 + contribution * 0.5` 的值域會重疊(class 0.5 給出 [0.25, 0.75]、
class 1 給出 [0.5, 1.0])⇒ 解不回來。

**定案:同一個通道、但用半位元組切**(仍是 §0-c 的「打包」,只是換一個解得回來的編碼):

```glsl
// 寫入(toon.js)
gInfo.a = ( float(clsIdx) * 16.0 + floor(contribution * 15.0 + 0.5) ) / 255.0;   // clsIdx: NONE 0 / LAND 1 / HARD 2
// 讀取(postfx.js)
float q   = floor( a * 255.0 + 0.5 );
float cls = floor( q / 16.0 );              // 0 / 1 / 2
float ctr = fract( q / 16.0 ) * 16.0 / 15.0;
```

實測(64 texel × 3 類別 × 16 階,`readPixels` 回讀):**類別錯 0 筆、貢獻誤差 0.000**。
每一個值都是 `k / 255` 的精確 8bit 位階 ⇒ 8bit UNORM 與浮點 RT 上都是恆等。
貢獻只要 16 階就夠 —— 它的用法是 `step(noise)` 與最近面覆寫的 `ceil`/`floor`,**本來就近乎二元**。

⚠ **連帶必須一起改的一條**:`postfx._mkRT` 目前給兩張附件都是 `LinearFilter`。
今天沒事只是因為取樣偏移恰好是**整數個 texel**(`INK.THICK = 1.0`)⇒ 落在 texel 中心;
一旦有人動 `THICK`,線性內插會把相鄰的 `q` 混成一個不存在的類別。
落地時 MUST 把 **`rtScene.texture[1]` 設成 `NearestFilter`**(SKILL `anime-line-control`
的 buffer discipline 也列著這一條)。

⚠ **最近面覆寫 MUST 與編碼同一輪進來**(計畫 ①-1 已寫):否則 `contribution = 0` 的物件
仍會被背後的天空描出輪廓,而那正是這個通道存在的理由。

---

### 2026-08-16 第二輪:序 3 ~ 序 13 全部落地 + 使用者本輪追加的兩塊

> 五道平行窗(lane-ink / lane-world / lane-motion / lane-mobile / lane-zonecut)在同一個
> worktree 上分檔案落地,文件差異寫進 `docs/_pending/*.md` 由整合者序列合併(本節)。
> **新增 5 支客戶端模組 + 10 支離線稽核 + 1 支規則工具**,`server/**` 與 `sim.js` 一行未動。

| 序 / 項目 | 狀態 | 縫(新增或擴充) | 稽核 |
|---|---|---|---|
| 3 / ①-1 `outlineContribution` 打包(§0-c) | ✅ **只交縫,呼叫端一個都沒接** | `toon.js` 的 `INK_CLASS`(四類)/`INK_LEVELS`/`inkQuant`/`INK_PACK_GLSL`/`INK_UNPACK_GLSL`/`SURF_ID`/`surfGroup`/`joinSurfGroup`/`INK_REPEAT_M`/`inkRepeat`/`CHAR`/`setCelChar`/`FOAM`/`REFL`/`seaFieldN`/`foamBandM`/`setSeaDepthField`/`celFoam`;`postfx.js` 三個讀取點解碼 + 最近面覆寫 + `INK_MRT.SELF_F`/`GRAZE_K` + `INK_GRP` 早退 + `_mkRT` 的 `NearestFilter`;`data.js` 的 `INK_CTR`/`inkCtrM`;`visualPrefs.js` 九格新旋鈕 | `audit_cel_pipeline` 96 → 133 項(新 Ⅷ + 五支 `--break`)、`audit_soft_stroke` 139 → 166 項(新 Ⅹ + 四支) |
| 4 / ①-2 斷筆 + ①-3 地貌子帶 + ①-4 定案 + ①-5 LUT 斷言 | ✅(①-3 旋鈕 def 0、消費端未接) | `toon.js` 的 `INK_BREAK`/`_inkBreakA`/`celInkBreak()`/`vCelInkP`/`CEL_INKA`+`CEL_INKB`(**騎既有的 alpha 契約 ⇒ `postfx.js` 一行不改**)、`celHash`/`celNoise` 提出 `#ifdef CEL_WP`(全專案恰一份)、`LAND_ZONE_N`/`landZoneId()`/`CEL_LAND_ID`/`_landInkA` | `audit_soft_stroke` 166 → 190(新 Ⅺ + 三支)、`audit_visual_prefs` 186 → 213(新 Ⅶ・Ⅷ + 兩支)、`audit_cel_pipeline` 133 → 162 |
| 5 / ⑤-4 落花 · 落葉粒子 | ✅ | **新模組 `public/js/petals.js`**(零 THREE、只 import `rng.js`、零共享 `rnd()`)+ `biomes.js` 的 `foliageCrown`/`petalGeo`/`buildPetals`;killswitch `?petal=0` | **新 `audit_ambient_motion` 63 項**,八支反向驗證逐支咬得住 |
| 5 / ⑤-1 玩家位移擾動 | ✅(規則層在序 3、餵入端在本窗) | `toon.js CHAR`/`setCelChar`(GLSL 側)+ `game.js` 的 `TREAD`/`_charSlots()`(槽 0 = 主視野機體、其餘依離相機距離升冪、固定長度插入排序**零配置**);killswitch `?tread=0` | `audit_anim_weights` Ⅶ 18 條(**行為直測**:真的把 `_charSlots` 原文丟進 `new Function` 跑)+ 3 支 `--break` |
| 6b / ⑥-3 動畫權重向量 | ✅ | **新模組 `public/js/animweights.js`**(零 import、有序 10 軌、地面三軌和恆為 1、缺欄回 0 不回 NaN);`locomotion.stepLocomotion` 收尾**只寫不讀** `L.w`;`game.js` 刪掉 `ent._moveSpd` 這第二份速度推導 | **新 `audit_anim_weights` 54 項** + 8 支 `--break` |
| 6 / ⑦-1~⑦-4 音效 | ✅ **機制與音檔完成** | `audio.js` 的分層機制 + `public/audio/amb` 七床 + `bgm/*-mobile.*` 兩份獨立編碼 | `audit_audio_layers` 58 項 + 7 支 `--break` |
| 7 / ②-1 葉片卡冠層 → **整棵樹**,+ 使用者追加的**山頭 / 巨石 / 石堆** | ✅(`leafCard`/`inkGroup` def 皆 `off`) | **新模組 `public/js/leafcard.js`**(零 THREE 排列規則層)+ `biomes.js` 的 `MEGA_BODY_F`/`leafCardOn`/`leafCardTex`/`leafRowGeo`/`surfIdGeo` + `ground.js` 細節迴圈的 `surf`/`contrib` + `buildBackdrop` 的注入欄 | **新 `audit_leaf_card` 43 項 / `audit_rock_ink` 30 項**,七支反向驗證 |
| 8 / ④-1 wipe + ④-2 dissolve(只做「出現」)+ ④-3 霧 ≡ 勾線淡出 | ✅(`wipe` def 0) | `data.js` 的 `WIPE`/`wipeAt()`/`DISSOLVE`/`dissolveAt()`(純函式,**不進 `balanceFingerprint`**);`postfx.js` 的 `_wipeMaterial()`/`setWipe()`/`playWipe()`/`_tickWipe()` + chain 插在 **grade 與 fxaa 之間** + dispose 名冊改由 `_quads` **推導** + `INK.FADE_F`/`_inkFadeM()`;`toon.js` 的 `dissolve`(`discard` 不是 alpha)+ 唯一寫入點 `setDissolve()`;呼叫端 `cutin.js setPipeline/wipe` 與 `game.js _wipeCut`(三個時機) | `audit_visual_prefs` 新 Ⅷ ±`--break-wipe`、`audit_cel_pipeline` 新 Ⅸ・Ⅹ ±`--break-dissolve`/`--break-fade` |
| 9 / ⑤-2 岸邊泡沫(**替換**)+ ⑤-3 倒影塊 | ✅(`foam` def 1、`reflect` def 0) | `terrain.js` 的 `seaFadeAt`/`seaFadeAtWorld`/`bakeSeaDepth`/`stampSeaBlockers`(對外 API **只加不改**)+ `main.js` 一行接線 + `biomes.js` 的 `planReflectors`/`buildWaterReflections`/`REFL_WAVE_WRITERS`;舊的格點泡沫片**退場** | **新 `audit_water_edge` 64 項**,四支反向驗證(3/1/2/1 條紅字) |
| 10 / ③-1 SPEC + ③-2 真凹處 + ③-3 可視角 + ③-4 公設 draw call | ✅(10a;10b 見待裁決) | **新模組 `public/js/vehicles.js`**(零 import 零 THREE 零亂數:五款型錄 + 生成器 + 三支量尺 + `RECESS` + 可視角);消費端 `siteplan.CIVIC_PARTS.lot`(配新的 `LOT_STALL`)/ `hazards.BUILDERS.wreck` / `biomes.car()` / `biomes.makeTrain()`;`biomes.vehGroup` = THREE 那一側的**唯一建構出口** | **新 `audit_vehicle_spec` 79 項** + 7 支 `--break` |
| 11 / ⑥-2 鳥群 | ✅(`birds` def 0) | **新模組 `public/js/wildlife.js`**(零 THREE 的積分器:曲線 + 逐軸噪聲 + 弱彈簧 + 摩擦 + 分群 + `uSnap`,計畫列的六項一項不刪)+ `biomes.shoreRing`/`buildFlocks` | **新 `audit_wildlife` 44 項** + 7 支 `--break` |
| 12 / §0-b 賽璐璐學派切換 | ✅ **def 已翻成 `'b'`** | `toon.js` 的 `CEL_CUT`/`cutOf`/`_school`/`celSchool()`/`RAMP_PATCH_A`/`RAMP_PATCH_B` + `toonPlain()`(**學派的第三個入口**:掛學派不掛演出);`biomes.js` 那 4 處裸 `MeshToonMaterial` 改呼叫 `toonPlain` ⇒ 凍結名冊清空、硬閘放行 | `audit_cel_pipeline` 新 Ⅺ + 六支 `--break`;**A14 改寫成四句**(編號與 `[#INC-106]` 一格不動) |
| 12b / ⑨ 立體結構重新渲染 | ✅ **幾何 / 碰撞 / slab / decks / cols / 走廊一格未動** | `biomes.js` 新增 `bandPitchM()`(緞帶件的成對頂點實測節距,零亂數)+ 22 支結構材質的線工授權(6 支吃推導值、15 支維持預設、1 支具名否決)+ 坑門混凝土三處共用 `SURF_ID.CONCRETE` + 洞口警示條紋補 `emissive` 並把材質提到迴圈外(**384 → 96 支**) | **新 `audit_struct_ink` 35 項**,四支反向驗證(1/3/2/4 條紅字) |
| 13 / ④-A 線工切面可行性樁 | ✅ **判決 = 條件式 GO** | **新工具 `tools/zonecut.mjs`**(零 import / 零亂數 / 純函式)+ `venue_field.cutLinesFor` + 四支結構清單函式由 `audit_traverse` 搬進 `venue_field`;`public/**` 與 `server/**` 一行未動 | **新 `audit_zone_cut` 38 項** + 8 支 `--break`(其中兩支加了**適用性硬閘**) |
| ⑧-5 / viewport · safe-area · touch-action | ✅ 含**一項缺陷修補** | `mobile.js` 新增 body class `touch-dev`(裝置級,判定唯一縫 `ctrlmode.touchCapable()`)+ 根層 `text-size-adjust`;五條頁面級硬化由 `touch-ui`(房間設定)改綁 `touch-dev`(裝置能力) | `audit_ctrl_mode` 新 Ⅹ(32 條 + 四支 `--break`)—— 全 repo **第一支**驗 viewport meta / touch-action / safe-area 的離線斷言 |
| ④-4 / 接縫紀律進稽核檔頭 | ✅(**純註解,零行為**) | 六支稽核檔頭:`audit_traverse` / `audit_ground_drape` / `audit_road_joint` / `audit_layer_block` / `audit_underpass` / `audit_open_tunnel` | 六支通過數**逐項不變**(86 / drape ALL PASS / 61 / 161 / 163 / traverse taroko 6+1)—— 那就是它的驗收面 |

**權威層的逐位元證明面**(五道各自量過,判準是「輸出逐字元相同」不是「仍全綠」):
`npm run bal` 🎉 全綠且與改制前基準 **diff 0 行**;`npm test` **624 ✅**(隔離埠,差異只有
per-run `Math.random()` 印出來的數字);`audit_siteplan` / `beacons` / `object_joints --seeds 8` /
`ground_tile` / `ground_seam` / `ground_enclave` / `ground_qc` / `ground_border` / `world_edge` /
`world_height` / `world_curve` / `gpu_lifecycle` / `climb` / `layer_block` / `npc_collide` /
`slope_move` 等在隔離對照下**逐字元相同** = **零共享 `rnd()` 消耗**成立。

**新增檔案一覽**

| 類 | 檔案 |
|---|---|
| 客戶端模組(5) | `public/js/petals.js`・`leafcard.js`・`vehicles.js`・`wildlife.js`・`animweights.js`(**五支全部零 THREE**;前四支只 import `rng.js` 或完全零 import) |
| 離線稽核(10) | `tools/audit_ambient_motion`・`audit_leaf_card`・`audit_rock_ink`・`audit_water_edge`・`audit_vehicle_spec`・`audit_wildlife`・`audit_struct_ink`・`audit_anim_weights`・`audit_audio_layers`・`audit_zone_cut` |
| 規則工具(1) | `tools/zonecut.mjs` |
| 文件(2) | `docs/zonecut_stub.md`・`docs/shots_baseline.md` |

**本輪最有價值的四個「沒有錯誤訊息」的坑**(逐條寫進了對應的第 ③④ 層)

1. **GLSL 行註解裡的反引號** —— 一輪內踩三次(`toon.js` 兩次、`postfx.js` 一次)。
   它甚至不一定讓檔案解析不過:反引號可以恰好收在一個「後面接得起來」的位置,
   `node --check` 全綠而管線在建構子丟 `.a is not a function`。守門 = `audit_client_syntax` Ⅲ。
2. **新的模組級 `let` 與模組載入時初始化的 TDZ** —— 踩兩次(`toon.js` 的 `_inkBreakA`/`_foamA`、
   `terrain.js` 的 `bakeSeaDepth` 狀態)。`syncVisualPrefs()` 在 import 當下就跑一次 ⇒ 宣告擺在
   它下面就是**整支模組在 import 那一刻** `ReferenceError`,而堆疊指向的是呼叫處。
3. **稽核 `strip()` 先剝區塊註解,而且那一刀是無條件的** —— 在 `public/js/**` 的行註解裡寫出一個
   區塊註解起始符,那一刀會一路吃到檔案後面任何一個結束符為止,把中間的**真程式碼**整段吞掉;
   症狀是某條原文斷言忽然找不到錨,而錯誤訊息講的是另一件事。
4. **抽原文執行的 `new Function` 沙箱少注入一格** —— 本輪四支踩到(`siteplan` / `object_joints` /
   `soft_stroke` 的三個沙箱各多一個 `makeVehicle`,`beacons` 的純區塊多一個)。整支稽核會在
   零件表那一行 `ReferenceError`,而訊息與「接合 / 場址 / 軟性物質」完全無關 —— 最容易被讀成
   「稽核壞了」。

**未驗項(㋓/㋕;MUST NOT 當綠燈)**

- **絕大多數定裝照與真 GPU A/B**:除了序 12 的 78 + 65 + 26 + 65 張定場照
  (`docs/shots_baseline.md`)與幾處真 GPU 直測之外,`shot_scene` / `shot_tunnels` / `shot_facades`
  的對照本輪沒拍。
- **真機(㋕)**:①旋鈕拉起來看斷筆 / 葉片卡 / 泡沫 / 倒影 / 鳥群 / 幕的實際觀感;
  ②走進兩個洞與走上橋面各一次(**洞內是 ⑨ 唯一沒有任何離線稽核看得到的地方**);
  ③音效端刻意不中性的那兩處(離地門檻 3 m → 2 m、gate 曲線換來源)聽一次;
  ④觸控筆電上「房間 PIN / 區網網址選不起來」那一條。
- **`npm run audit:net`**:五道一致依「本窗硬紀律」未跑(它的 ⑦ 段會真的 spawn 每一支 dev 工具,
  含永不結束、會連外網下載的 `harvest_loop.mjs`)⇒ **由整合流程統一跑一次**。
- **`audit_traverse` 全場地**:它的判定吃**外部圖資** ⇒ **不能拿 BASELINE 做「逐項不變」比對**
  (本輪實測基準 91/18 → 121/21,而那不是任何一道的改動:本工作樹的 `tools/.scen_cache` 開工時
  是空的,是現抓的 Overpass 快照)。⚠ 另:`--json` 的 `cells` 欄**天生非決定性**(`BattleSim`
  建構期以 `Math.random()` 擺第三方野營碉堡),同一份程式碼三次跑出 319591 / 319585 / 319579 ——
  任何拿它做逐位元 A/B 的人都會踩到。

**2026-08-17 收尾狀態**

1. **序 14 / 15 已完成**：執行期取得 landuse / natural / waterway / boundary，分區場接上
   fragment；陡坡為正式 `cliff`，不再以留白露出衛星影像。舊底毯系統保留為未接線 fallback，
   不再產生正式路徑的 draw call。
2. **`INK_MRT.SELF_F` / `GRAZE_K` 已做 4 × 4 定場掃描**，定案為 **2.4 / 1.5**。
3. **④-4 另兩支已補入接縫判讀註解**；`shot_scene` 另增 `--only`、`--ink-self`、
   `--ink-graze`，讓掃描不必改正式來源。
4. **③-4 / 10b 已於第三輪完成**：`hazards.buildHazard` 靜態件逐材質合併並排除 rock / 動態 /
   透明件；`DETAIL_DEFS.carwreck` / `container` 改成真實尺度並建立新 `detailR` 基準；
   edgewall / beacons 已收斂到 `vehicles.js`。
5. **CC0 音檔已補齊**：七床 + 兩份行動版 BGM 均已進來源帳並通過雙向檔案稽核。

### 2026-08-17 第三輪：③-4 / 10b 收尾

| 項目 | 結果 | 稽核 |
|---|---|---|
| `hazards.buildHazard` draw call | jitter 後逐材質合併；rock 的 `outlineGeo`、火舌/水面等動態件、透明件維持獨立 | `audit_vehicle_spec` ⅩⅢ ±`--break-hazard` |
| ground 真實尺度 | carwreck 4.8 × 1.45 × 1.9m；20ft container 6.058 × 2.591 × 2.438m | 新 `detailR` 2.581181899828 / 3.265088360213，±`--break-detr` |
| edgewall / beacons 收斂 | railcar / truck / container / depot 全數轉呼 `makeVehicle`；AABB 轉呼 `partAABB` | `audit_vehicle_spec` Ⅴ-b・Ⅻ ±`--break-converge`; `audit_world_edge`; `audit_beacons` |

本輪依使用者裁決接受舊場景佈局失效；驗收改為同一份新程式碼與同一種子可重現，MUST NOT
拿第二輪的逐位元場景輸出作比較基準。

新版本重現驗證：`audit_siteplan` / `audit_ground_qc` / `audit_object_joints --seeds 8` 各連跑兩次，
三組輸出皆逐字元相同。`shot_scene` 新定場照因本機找不到 Playwright 而跳過，仍列為 ㋓ 未驗項。

### 2026-08-17 第四輪：②-2 苔草／濕痕 triplanar 遮罩

| 項目 | 結果 | 稽核 |
|---|---|---|
| 遮罩來源 | 正式 `landField` 分區決定可長苔／可積濕；世界法線 + 兩尺度三平面噪聲只切分區內碎邊 | `audit_cel_pipeline` Ⅸ④ |
| 賽璐璐邊界 | 苔草與濕痕皆為硬 `step()`；道路／建成遮罩排除，不新增散布幾何或共享 `rnd()` | 同上 ±`--break-landmask` |
| 墨線縫 | 基底 57~63、遮罩 43~56，全部為 `k/64` 整數槽；遮罩邊沿用 `landInk` | 同上；反向驗證如期 1 條紅字 |

本輪只改地形材質與原文稽核；權威幾何、碰撞、地貌場資料與場景散布均未改。真 GPU 的崖面
三平面換手與實際色彩仍需 ㋓ 定裝照確認。

### 2026-08-17 第五輪：②-3 旗面布料波形

| 項目 | 結果 | 稽核 |
|---|---|---|
| 掛點樞軸 | 旗桿在旗面 −x 緣，權重由 0 到旗尾；沿用既有橫向分段與局部座標 | `audit_soft_stroke` Ⅲ |
| 布料節奏 | 75% 慢抬起 + 25% 的 3.3× 快顫；rate / phase 由每面旗的已定案落點雜湊 | 同上 ±`--break-cloth` |
| 範圍 | 只擴充既有 `SOFT_KINDS.cloth` 頂點縫；零幾何、零權威狀態、零共享 `rnd()` | `audit_object_joints --seeds 8` / `audit_siteplan` |

機體垂布與繩索目前沒有可消費的完整名冊，本輪不創造新內容；日後加入時直接沿用同一布料縫。
