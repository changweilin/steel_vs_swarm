# 序 13 / ④-A 線工切面可行性樁(§0-a)  (key: seq13-stub)

## 摘要

現制 `ground.js cellZoneAt`(3259)是 13m 逐格獨立判定,界線由「哪一格投票翻面」決定 ⇒ 落在田中間,才需要界線拼圖去藏。§0-a 要把它拆成「先由 OSM 線工切面、再對整個面下一次判定」,而判定順序一行不改、只換它吃什麼。本輪只做**可行性樁**:一支 `tools/` 離線工具,光柵化參與線 → flood fill → 逐面標籤,產出報告 + 與現制拼圖並排的 PNG,`public/js` 與 `server/` 一行不動。三個驗收面裡有一個必須換尺:「界線不得推移」拿**逐格一致率**當門檻是錯的(那會逼新制去複製舊制的雜訊),要量的是「新界線離真實地貌界線比現制更近或相等」。實測發現三件計畫沒算到的事:①`waterway`/`landuse`/`natural`/`boundary` 在**執行期根本沒抓**(`fetchOsmFeatures` 只抓建物/鐵路/瀑布/具名點),只有離線 `venue_field.landcoverFor` 有一半;②zoneGrid 實測是 175×146(paris 3v3 含裙跨距 3362m),不是計畫寫的 93×93 / 2111m;③`surfaceId` 出線那一面卡在 8bit 量化:`step(0.004, idv)` 而 1 個 8bit 位階 = 0.00392 < 0.004,分區 id 間距必須 ≥ 2/255。

## 縫

### cellZoneAt(判定順序 MUST 一行不改,只換取樣集)
`public/js/ground.js:3259`

現行:
```js
  const cellZoneAt = (i, j) => {
    const cx = terrain.minX + (i + 0.5) * cell, cz = terrain.minZ + (j + 0.5) * cell;
    const ec = envAt(cx, cz);
    if (ec === 1) return 'water';
    const hC = terrain.heightAt(cx, cz);
    const slope = Math.max(
      Math.abs(terrain.heightAt(cx + cell, cz) - hC),
      Math.abs(terrain.heightAt(cx, cz + cell) - hC)) / cell;
    if (slope > 0.75) return '!';
    ... votes / classifyPure 五點多數決 ...
    if (slope > 0.28 && zn !== 'wet') zn = 'bare';
    if (ec === 2) zn = 'wet';
```

**改成**: **本輪 MUST 不改這一行原文。** 樁以 `audit_src.readSrc` + 大括號配對抽出這一段,用 `new Function` 注入 `{ terrain, envAt, classifyPure, cell, alpineH }` 執行**真品**(抄一份公式進樁 = 只驗到自己抄對沒有)。樁跑兩趟:趟A 餵格心(= 現制 zoneGrid)、趟B 把 `cx/cz` 換成該面的取樣集(五點多數決自然升級成整面多數決,`slope`/`hC` 取面的中位數)。⚠ 這一段的坡度門檻是**手寫的 0.28 / 0.75**(= 15.64° / 36.87°),與 `SLOPE.EASE_DEG` 16° / `BLOCK_DEG` 32° 相近但不相等 —— **切面用的等值線門檻**(取 SLOPE)與**標籤用的坡度覆寫**(留 0.28/0.75)是兩件事,樁 MUST NOT 把它們合併。

### zoneGrid 建表(逐格比對基準)
`public/js/ground.js:3544`

現行:
```js
  const zoneGrid = new Array(gnx * gnz).fill(null);
  for (let j = 0; j < gnz; j++) for (let i = 0; i < gnx; i++) zoneGrid[j * gnx + i] = cellZoneAt(i, j);
  const encGrid = planEnclaves(zoneGrid, gnx, gnz, {});

// 上游(3169 / 3194):
  const cell = Math.max(13, Math.max(terrain.worldW, terrain.worldH) / 232);
  const gnx = Math.ceil(terrain.worldW / cell), gnz = Math.ceil(terrain.worldH / cell);
```

**改成**: 樁以同一份 `cell`/`gnx`/`gnz` 推導(MUST NOT 手寫 13),把趟A 的 `zoneGrid` 當基準。實測值 MUST 印出來:taroko 1v1 = 126×82、taroko 3v3 = 155×116、shibuya 3v3 = 171×134、barcelona 3v3 = 175×146(全部 cell = 13.00m,232 那條上限要到 3016m 邊長才咬得到)—— 計畫寫的「93×93」量的是可玩邊長 1200m,而 `buildGroundCover` 吃的是 `terrain.worldW/worldH` = `battleRect`(含 ROUTE_EDGE_MARGIN + MAP_EXPAND),差 1.6~1.9 倍。序 14 的貼圖解析度論據 MUST 用這一份重算。

### Node 端「與執行期同形」的地形/圖資唯一縫
`tools/venue_field.mjs:14`

現行:
```js
// 消費端 MUST 走這一支,MUST NOT 自己再抄一份高度管線或結構剖面(第三份必定漂)。
// 網路:第一次跑會抓 terrarium 高程磚與 OSM 圖資,結果寫進 `tools/.scen_cache/`

// 現有出口:
export async function osmFor(id, bbox)        // roads / rails / waters(waterway) / crossings
export async function landcoverFor(id, bbox)  // covers(landuse/natural/leisure)/ buildings
export function buildHeightField(cfg, bbox, sampleElev)   // heightAt / heights / N / minX…
export function tunnelRunOf(way, center, heightAt, hf)    // 隧道/地下道剖面(執行 biomes 原文)
```

**改成**: 樁 MUST 全部走這一支。**缺兩類線 ⇒ 新增一支 `cutLinesFor(id, bbox)`**(`boundary=administrative` + `natural=coastline`),自己的快取鍵 `${id}_cutlines_v1.json`、自己的額度、共用既有 `overpass()`(鏡像輪替 + 逐站計時)。**MUST NOT 併進 `osmFor`/`landcoverFor`** —— 那兩本快取是掃描稽核與 `audit_venue_biome` 的貴重資產,改查詢就得換鍵整批重抓(該檔 `landcoverFor` 檔頭已把這條理由寫死)。另**把 `buildStructs`/`projectArc`/`ptAt`/`sampleAlong` 從 `audit_traverse.mjs` 搬進本檔**(四支的自由變數全部已經住在本檔),`audit_traverse` 改 import —— 樁要的「結構足跡 keep-out」與泛洪要的是同一份結構清單,抄第二份就是這一支存在的理由被繞過。

### 坡度門檻唯一縫(等值線 MUST 取它,MUST NOT 另訂數字)
`public/js/data.js:2437`

現行:
```js
export const SLOPE = {
  EASE_DEG: MAPGEO.MAX_ROAD_GRADE_DEG,   // 平緩帶(此角度內恆全速)= 兵線坡度限制
  BLOCK_F: 2,                            // 阻擋角 = 平緩帶 × 此倍率
  STRUCT_M: 1.2,
  BLOCK_DEG: 0,                          // 推導回填(見下兩行),MUST NOT 手寫
};
SLOPE.BLOCK_DEG = SLOPE.EASE_DEG * SLOPE.BLOCK_F;
```

**改成**: 樁的「坡度變化等值線」只准有兩條:`slopeDeg(…) 跨過 SLOPE.EASE_DEG`(16°,修得起路的坡)與 `跨過 SLOPE.BLOCK_DEG`(32°,機體爬不上去)。`data.js` 沒有 three ⇒ 樁直接 `import { SLOPE, slopeDeg } from '../public/js/data.js'`(同 `venue_field.mjs` 現行做法),MUST NOT 手寫 16/32,也 MUST NOT 沿用 `cellZoneAt` 的 0.28/0.75(那是標籤的覆寫門檻,不是切面的線)。坡度一律量**裸地形**(`hf.heightAt`,非開挖後),取樣距 MUST = 地形格距(taroko 3v3 實測 10.46m;`worldW/(TERRAIN.GRID_N-1)`)—— 取更細會把三角化的網格折邊量成等值線。

### 道路量化接線(樁的路網 MUST 與執行期同一份)
`public/js/biomes.js:8104`

現行:
```js
  if (osmRoads?.length) {
    osmRoads = quantizeRoads(
      osmRoads,
      (p) => llToWorld(p.lat, p.lon, center),
      (x, z) => worldToLL(x, z, center),
    );
  }
// 上方註解:MUST 排在拿到圖資之後、任何消費端之前 —— 量化過的路網從此是唯一的一份
```

**改成**: `venue_field.osmFor()` 回的是**量化前**的圖資。樁 MUST 自己接上 `roadgrid.quantizeRoads`(該檔零 import ⇒ Node 端直接 import 真品),`toXZ`/`toLL` 走 `data.llToXZ`/`data.xzToLL`(含 A42 主方位),MUST NOT 用 `venue_field.llToWorld` —— 那一份是 A42 之前的手抄、**沒有旋轉**(全檔 grep 不到 `rot`/`mapRot`/`llToXZ`,而它的檔頭仍寫著「與 terrain.js 同一組換算」)。線不量化的代價是切面的線與真的畫出來的路面差到一個車道寬,而報告上完全看不出來。

### 結構足跡 keep-out(本專案沒有 `hillAt`,同一份名冊住這裡)
`public/js/biomes.js:5403`

現行:
```js
          blockArea(blocked, x, z, hw + (kind === 'tun' ? STRUCT_CLEAR_PAD : 4));
// 4530:
const STRUCT_CLEAR_PAD = Math.max(7, UND.COPE, TUN.GAL_CLEAR_W);
// markGradeCorridors(5323)回傳 corridors:
//   { x1, z1, x2, z2, hw, kind:'tun'|'bridge', cy }
```

**改成**: 計畫 §⑨ 說的「與 `hillAt` 的 keep-out 同一份名冊」在本專案的對應物就是這裡(`hillAt` 是 sakura 那邊的名字,本庫沒有)。樁的 keep-out 半寬 MUST 推導:隧道/地下道 `hw + STRUCT_CLEAR_PAD`、橋 `hw + 4`,而 `STRUCT_CLEAR_PAD` 由 `venue_field` 已解析的 `TUN`/`UND` 常數同式算出(`Math.max(7, UND.COPE, TUN.GAL_CLEAR_W)`),MUST NOT 手寫 7。⚠ **明隧道柱列帶(`galStrips`/`carveGalleryBands`)在 Node 端拿不到** ⇒ 樁 MUST 在報告裡標「明隧道柱列帶未納入 keep-out(未驗)」,MUST NOT 靜默當作已涵蓋。

### surfaceId 出線的算術閘(寫入端 + 讀取端門檻)
`public/js/toon.js:179`

現行:
```js
/** 逐材質的 surfaceId(量化到 [0,1] 的 64 階;相鄰材質撞號 = 少一條線,不是壞掉)*/
const nextSurfId = () => ((_surfSeq = (_surfSeq + 23) & 63) + 0.5) / 64;
/**
 * 地貌共用的 surfaceId。取 **0 是刻意的** … 地貌與任何一份非地貌材質的 id 差恆 ≥ 0.0078,
 * 穩穩跨過 `INK_MRT` 那一項的 0.004 門檻(地貌 vs 建物的線一條都不會少)。
 */
const LAND_SURF_ID = 0;
// 讀取端 postfx.js:70 / 548
//   ID: 0.55,
//   float idv = max( abs( il.b - ir.b ), abs( iu.b - ib.b ) );
//   step( 0.004, idv ) * 0.55
```

**改成**: 驗收面 3 在本輪是**純算術報告**(樁不改 shader、不改 `LAND_SURF_ID`)。門檻 0.004 與 `nextSurfId` 的 64 個值 MUST 從原文抽(`readSrc` + regex),MUST NOT 手寫。三個量:①提案的逐分區 id 兩兩差(8bit round 之後)MUST ≥ 0.004 ⇒ 實務下界是 **2/255 = 0.00784**(1/255 = 0.00392 **跨不過** `step(0.004, ·)`);②每個分區 id 與 64 個 `nextSurfId` 值的最小差 MUST ≥ 0.004,否則某一處「地貌 vs 建物」的線會整條消失(實例:分區 id 2/255 = 0.007843 與材質 id 0.5/64 = 0.0078125 在 8bit 上**同碼**);③面內差恆 0。逐對印「草↔岩」「乾↔濕」的實得 delta。

### 對照圖的 PNG 編碼(純 Node,零依賴)
`tools/logo_lib.mjs:139`

現行:
```js
// 通用 PNG 編碼(RGBA8)
export function encodePNG(file, cw, ch, rgbaRows) {
  …
  writeFileSync(`${OUT_DIR}/${file}`, Buffer.concat([   // ← 158 行,輸出目錄寫死
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', ih),
    chunk('IDAT', deflateSync(rgbaRows, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]));
}
```

**改成**: 全庫唯一的純 Node PNG 編碼器,但輸出目錄寫死成 `public/assets`(158 行)。改成 `encodePNG(file, cw, ch, rgbaRows, dir = OUT_DIR)` 並把 158 行換成 `join(dir, file)`;**既有兩個呼叫端不傳 dir ⇒ 逐位元不動**(`flatten_logo`/`split_logo`/`compose_logo` 重跑 md5 比對)。樁輸出到 `tools/.shots/zonecut/`(已在 `.gitignore` 的 `tools/.shots/` 底下)。MUST NOT 在樁裡另寫第二份 PNG 編碼器。

### 對照圖配色(推導不手寫)
`public/js/ground.js:236`

現行:
```js
export const SUB_COL = {
  // 綠地
  turf: 0x7db159, lawn: 0x6fae5a, meadow: 0xb3a468, …
  // 裸露地
  wild: 0x8d835f, gravel: 0x9a9384, sand: 0xdcc28f, …
  // 市區
  concrete: 0xa2a49e, pavement: 0x98948b, brick: meanHex(BRICK_C),
  // 濕地 / 水域
  marsh: 0x5d5647, lotus: 0x41616b, watertile: 0x2f6f96, deepwater: 0x1c4560,
  // 高地
  plateau: 0xa08c6a, icefield: 0xd8e8ee, scree: 0x8f8c84,
};
```

**改成**: 對照圖的分區配色 MUST 取 §0-a 次款預算那張表的**基底款**代表色(green→`turf`、bare→`wild`、urban→`pavement`、wet→`marsh`、water→`watertile`、alpine→`plateau`),值一律查 `SUB_COL`,MUST NOT 在樁裡另寫一組除錯色 —— 「新舊並排」要能一眼看出是同一種地貌,兩邊配色分家就白排了。`'!'`(懸崖不鋪)與 `null`(留白露衛星底圖)兩個狀態沒有代表色 ⇒ 用可辨識的斜線/透明表示,並在報告印它們的面積佔比(序 14 要決定遮罩制怎麼表達這兩個狀態)。

## 寫入檔案
- `tools/zonecut.mjs` (create) — 切面規則本體:光柵化 + flood fill + 小面併鄰 + 逐面取樣集。**零 import、零亂數、純函式**(同 `roadgrid.js`/`wallpanel.js`/`edgewall.js` 的紀律),線與取樣一律由呼叫端以回呼注入 ⇒ 序 14 可以原封改名成 `public/js/zonecut.js` 讓遊戲端與離線工具同吃,不會變成第二份實作。
- `tools/audit_zone_cut.mjs` (create) — 樁本體:三個驗收面 + 成本量測 + 報告 + 對照 PNG。預設純 Node;`--browser` 模式走 `pw.mjs` 補上影像分類那一半(㋓)。
- `tools/venue_field.mjs` (edit) — ①新增 `cutLinesFor(id, bbox)`(`boundary=administrative` + `natural=coastline`,自己的快取鍵 `_cutlines_v1`);②把 `buildStructs`/`projectArc`/`ptAt`/`sampleAlong` 由 `audit_traverse.mjs` 搬進來(結構足跡 keep-out 與泛洪同吃一份)。既有 export 全部不動。
- `tools/audit_traverse.mjs` (edit) — 上一列那四支函式改成 `import { … } from './venue_field.mjs'`;純搬家,行為逐位元不動(需 A/B 佐證)。
- `tools/logo_lib.mjs` (edit) — `encodePNG` 加選用 `dir` 參數(預設 `OUT_DIR`),158 行改吃它。既有三個呼叫端不傳 ⇒ 逐位元不動。
- `tools/CLAUDE.md` (edit) — 家族地圖加一列 `zonecut.mjs`(規則本體,零 import,序 14 搬去 public/js),並把 `venue_field.mjs` 那一列補上「結構清單也住這裡」。
- `.claude/rules/verification.md` (edit) — §5.1(續)離線稽核清單加 `audit_zone_cut.mjs` 與它的 `--break-*`;§5.5 加一列「改 `zonecut.mjs` / `cellZoneAt` / 切面線分級 → 跑什麼」。
- `docs/anime_style_plan.md` (edit) — §0-a 的三處量測更正(zoneGrid 實測 175×146、含裙跨距 3362m、執行期沒有 landuse/natural/waterway/boundary 查詢)+ 執行紀錄追加「2026-08-16 第二輪:序 13 落地」一節(含樁的判定結果與成本數字)。

## 步驟
1. **步 0(先量基準,不寫任何規則)**:寫一支一次性腳本(或直接在樁裡加 `--report-only`),對 29 個場地印出 `cell`/`gnx`×`gnz`/`worldW`×`worldH`/`edgeBufferM`/含裙跨距,並更正 `docs/anime_style_plan.md` §0-a「最大可行範圍」那張表。已實測:paris 3v3 最大,world 2450×2054、裙 455.6/側 ⇒ 含裙 3362m ⇒ 1024² = 3.28 m/texel(不是計畫寫的 2.06)。這一步先做是因為序 14 的貼圖規格論據整個掛在它上面。
2. **步 1**:`tools/venue_field.mjs` 新增 `cutLinesFor(id, bbox)` —— 一個 Overpass 查詢抓 `way["boundary"="administrative"]` 與 `way["natural"="coastline"]`,額度隨 `bboxKm2` 縮放(照該檔既有 `quotaOf` 紀律),快取 `${id}_cutlines_v1.json`,失敗回 `null`(呼叫端 MUST 標未驗,MUST NOT 當成「這張圖沒有行政界」)。驗:`node -e` 直呼一個場地,印回傳筆數 + 第二次跑命中快取零網路。
3. **步 2**:把 `buildStructs`/`projectArc`/`ptAt`/`sampleAlong` 從 `audit_traverse.mjs` 搬進 `venue_field.mjs` 並 export;`audit_traverse.mjs` 改 import。驗:搬家**前**先跑 `node tools/audit_traverse.mjs --only=<一個 .scen_cache 已有快取的場地> --json=before.json`,搬完再跑 `--json=after.json`,兩份 **MUST 逐位元相同**(這是純搬家的唯一證明)。
4. **步 3**:寫 `tools/zonecut.mjs`(零 import / 零亂數 / 純函式),四支:①`rasterLines(nx, nz, segs, halfWidthAt)` → `Uint8Array` 牆遮罩;②`floodFaces(wall, nx, nz)` → `{ face: Int32Array, n }`,**4 鄰**(8 鄰會讓對角相碰的兩個面漏成一個);③`mergeSmall(face, n, areaMin, adjacency)` → 小面併進**共邊**且面積最大的鄰面(A46 ⑨ 的同一條:比**那個鄰居**的面積、共邊才算相鄰、小的貼上大的);④`faceSamples(face, n, k)` → 逐面的取樣點集(面積加權、決定性的分層取樣,MUST NOT 用亂數)。⚠ 面 id 的編號來自掃描順序 ⇒ ④ 的輸出與下游 MUST NOT 拿 id 當種子。
5. **步 4**:樁的線工組裝(住 `audit_zone_cut.mjs`,因為它要碰 `venue_field` 與 `data.js`)。六類線逐一接上:①道路/步道 = `osmFor().roads` → `roadgrid.quantizeRoads(ways, llToXZ, xzToLL)` → 依 `highway` 值 + `venue_field.roadWidth(tags)` **分級**;②鐵路 = `osmFor().rails`,恆參與;③河川溝渠 = `osmFor().waters`(`waterway=river|stream|canal|drain|ditch`),恆參與;④天然界線 = `landcoverFor().covers` 的外環(同時是第二段的標籤來源)+ `cutLinesFor().coastline`;⑤行政界 = `cutLinesFor().boundary`,**低優先** —— 只有「半徑 N m 內沒有其他參與線」才採用(N MUST 掃參數並印出採用率;採用率接近 0 就是它幾乎全是重複線,那本身就是結論);⑥坡度等值線 = `hf.heightAt` 中央差分跨過 `SLOPE.EASE_DEG` / `SLOPE.BLOCK_DEG`(取樣距 = 地形格距)。keep-out 由步 2 的 `buildStructs` 給:落在 `hw + STRUCT_CLEAR_PAD`(隧道)/ `hw + 4`(橋)內的線 texel **不寫牆**。
6. **步 5(線分級 = 樁的主要輸出之一)**:分級門檻 MUST **掃參數不寫死**。逐級印:面數、面積中位數/p10、面積 < 下限被併掉的比例。合成量測顯示 1024² 上 2000 條隨機線就切出 6912 個面 —— 市區裡每條步道都參與就是回到雜訊,而「面數」是唯一看得見這件事的數字。同樣掃 `areaMin`(面積下限)。輸出一張 `級 × areaMin` 的表,由人眼挑一組,結論寫進 `docs/anime_style_plan.md`。
7. **步 6(第二段:逐面下標籤)**:`readSrc('public','js','ground.js')` 抽 `cellZoneAt` 那一段原文,`new Function` 注入 `{ terrain: { heightAt, minX, minZ }, envAt, classifyPure, cell, alpineH }` 執行**真品**。跑兩趟:趟A `(i,j)` = 現制格心(= `zoneGrid` 基準);趟B 改餵面的取樣集(`envAt` 取多數、`classifyPure` 五點多數決升級成整面多數決、`slope`/`hC` 取中位數)。**判定順序一行不改**由原文閘守:抽出來的字串 MUST 與 ground.js 的那一段 `===` 相等(樁自己不得改寫它)。優先序另加一層:面落在 `landcoverFor().covers` 的 landuse/natural 多邊形內 ⇒ 直接取該多邊形的類別(圖資 > 影像,信任階梯不變),此層 MUST 排在 `classifyPure` 多數決**之前**、`envCode` 水沼**之後**。
8. **步 7(驗收面 1,換尺)**:三個數一起印,**MUST NOT 只印逐格一致率**。①逐格一致率 + 逐分區混淆矩陣(參考值,不當門檻);②**界線位移**:對現制每一條「相鄰格分區不同」的邊,量它到最近新制面界線的距離,報 p50/p90/p99;③**離真值的距離**(這一條才是門檻):新制界線與現制界線各自到最近的 OSM landuse/natural 外環 ∪ 水道 ∪ 海岸線的距離中位數,**新制 MUST ≤ 現制**。理由:兩制的界線本來就不該逐格相同 —— 現制界線是「哪一格投票翻面」,新制是「路緣/河岸/田埂」;拿逐格一致率當門檻等於逼新制去複製舊制的雜訊,而那正是要修的東西。
9. **步 8(驗收面 2,決定性)**:四條缺一不可。①同一場地跑兩次,`face` 分割 + 標籤 + 面積表的 SHA-256 逐位元相同;②原文閘:`tools/zonecut.mjs` 全檔 `!/Math\.random/` 且 `!/\brnd\s*\(/`(照 `audit_siteplan.mjs:114/444` 的寫法);③**順序無關**:把 ways 陣列反轉、每條 way 的頂點序反轉,重跑 ⇒ 面的**分割**(等價類)MUST 相同(id 編號可以不同 ⇒ 比對「面內任兩點同號」的正規化雜湊)。這一條是 flood fill 最容易靜默壞掉的地方;④標籤 MUST NOT 讀面 id(原文閘 + 行為直測:人工重排 id 之後標籤逐項不變)。
10. **步 9(驗收面 3,純算術)**:從 `toon.js` 原文抽 `nextSurfId` 與 `LAND_SURF_ID`、從 `postfx.js` 原文抽 `step( 0.004, idv )` 的 0.004,對提案的逐分區 id 集合印:①分區兩兩 8bit 量化後的最小差(MUST ≥ 0.004,實務下界 2/255 = 0.00784);②分區 id 與 64 個 `nextSurfId` 值的最小差(MUST ≥ 0.004,否則某一處「地貌 vs 建物」的線整條消失);③草↔岩、乾↔濕兩對的實得 delta;④面內差恆 0。⚠ 這一面**只出報告**:真的把 `LAND_SURF_ID` 從常數換成 `f(zone)` 會推翻 2026-08-13「地貌共用一個 surfaceId」的定案(`audit_cel_pipeline` Ⅶ),那要使用者裁決,不在本輪。
11. **步 10(成本)**:Node 端量光柵化 / flood fill / 小面併鄰 / 逐面標籤四段各自的毫秒數(1024² 與 2048² 各一輪)。**綁定值是瀏覽器那一份**(建構期在瀏覽器跑)⇒ `--browser` 模式在 `page.evaluate` 裡跑同一支 `zonecut.mjs` 並用 `performance.now()` 量,對照同一頁的 `buildBiomes` 總時間。已先做合成量測當量級參考:1024²、2000 段線,Node v24 上 光柵化 8.3ms + flood fill 9.8ms;`buildBiomes` taroko 實測 963→1252ms ⇒ 預期落在 2% 以內,但 MUST 實測不得引用這一句。⚠ 這一段將來 MUST 掛在既有的 `buildYield` 階段回報上,MUST NOT 動共享 `rnd()` 消耗序列(§2.3)—— 樁在報告裡把這條寫成給序 14 的交接條件。
12. **步 11(對照圖)**:一場地兩張並排 PNG:左 = 現制 `zoneGrid` 逐格上色、右 = 新制逐面上色(配色一律查 `SUB_COL`,見縫表);第三張疊參與線 + 面界線 + keep-out 帶。走 `logo_lib.encodePNG(file, w, h, rows, 'tools/.shots/zonecut')`。至少跑一個山區(taroko)+ 一個密市區(shibuya / paris)+ 一個海岸(有 coastline 的),PNG 與報告一起交付。
13. **步 12**:接上 `--break-*`(見反向驗證欄)、把指令寫進 `.claude/rules/verification.md` §5.1(續)與 §5.5、`tools/CLAUDE.md` 家族地圖加列、`docs/anime_style_plan.md` 執行紀錄追加一節(含判定結果:樁過 / 不過,以及不過的話缺在哪一面)。

## 稽核
- `node tools/audit_zone_cut.mjs --venue taroko --team 1`
- `node tools/audit_zone_cut.mjs --venue shibuya --team 3`
- `node tools/audit_zone_cut.mjs --venue paris --team 3 --tex 2048`
- `node tools/audit_zone_cut.mjs --venue taroko --team 1 --sweep-rank --sweep-areamin`
- `node tools/audit_zone_cut.mjs --venue taroko --team 1 --browser   # ㋓:影像分類那一半 + 建構期成本綁定值`
- `node tools/audit_traverse.mjs --only=taroko --json=tools/.scen_cache/_traverse_after.json   # 步 2 搬家的 A/B(與搬家前的 before.json 逐位元比對)`
- `node tools/audit_ground_tile.mjs`
- `node tools/audit_ground_qc.mjs`
- `node tools/audit_ground_seam.mjs`
- `node tools/audit_ground_enclave.mjs`
- `node tools/audit_ground_border.mjs`
- `node tools/audit_siteplan.mjs`
- `node tools/audit_beacons.mjs`
- `node tools/audit_object_joints.mjs --seeds 8`
- `node tools/audit_cel_pipeline.mjs`
- `node tools/audit_client_syntax.mjs`
- `node tools/audit_road_grid.mjs`
- `node tools/audit_slope_move.mjs`
- `node tools/audit_solo_boot.mjs`
- `npm run audit:net`
- `npm run bal`
- `npm test   # MUST 先照 §5.2 重啟伺服器`
- `node tools/flatten_logo.mjs && node tools/split_logo.mjs && node tools/compose_logo.mjs   # encodePNG 加參數之後,產出 md5 MUST 與改前相同`
- `git diff --stat -- public/ server/   # MUST 為空:本項不動出貨行為`

## 反向驗證
- `--break-quantize` — 壞版: 切面的道路改吃**量化前**的 `osmFor().roads`(跳過 `quantizeRoads`),投影改用 `venue_field.llToWorld`(無 A42 旋轉) ⇒ **MUST 紅**: 驗收面 1 的「離真值距離」那一條 MUST 紅:新制界線到 OSM 多邊形外環的中位距離會**大於**現制(路挪了一個車道寬 + 整份世界差 θ)。同時報告 MUST 印出旋轉角不為 0 的場地清單。
- `--break-slope` — 壞版: 坡度等值線門檻改成手寫的 0.28 / 0.75(= `cellZoneAt` 的標籤覆寫門檻)而不是 `SLOPE.EASE_DEG`/`BLOCK_DEG` ⇒ **MUST 紅**: 「門檻取自 `SLOPE` 唯一縫」那一條原文/數值斷言 MUST 紅(實得 15.64°/36.87° ≠ 16°/32°)。⚠ 期望值 MUST 是 `SLOPE.EASE_DEG` 這個**表達式**,MUST NOT 隨 break 改成 15.64(那樣 break 永遠是綠的,§5.4 ㋑)。
- `--break-merge` — 壞版: 小面併鄰改成「比佔**全體**的面積比例」而不是比**那個鄰居**的面積 ⇒ **MUST 紅**: 面數/碎面率那一條 MUST 紅,而且 MUST 附一組**結構性對照**:合成一根 36 面圓柱狀的長條分區(每片面積相同 ⇒ 比值恆 1 ⇒ 併不掉),壞版會把整根抹平而好版併入 0 次(A46 ⑨ ㋐ 的同一條保護)。
- `--break-order` — 壞版: flood fill 的掃描順序改成由 ways 陣列順序播種(把面 id 綁到輸入順序上) ⇒ **MUST 紅**: 驗收面 2 的「順序無關」那一條 MUST 紅(反轉 ways 之後正規化雜湊不同)。這一支是三個 `--break` 裡最重要的:順序相依在單機單次跑上**完全看不出來**,壞掉的樣子是兩台客戶端建出不同的世界。
- `--break-rnd` — 壞版: `zonecut.mjs` 的逐面取樣點改用 `Math.random()` ⇒ **MUST 紅**: 驗收面 2 的原文閘(`!/Math\.random/`)與「兩次跑逐位元相同」兩條 MUST 同時紅。
- `--break-keepout` — 壞版: 結構足跡 keep-out 整組拿掉(隧道/橋的中心線照樣寫牆) ⇒ **MUST 紅**: 報告的「切過結構足跡的線段數」MUST > 0 且該項紅字,並在對照 PNG 上把違規段標紅 —— 症狀是「橋下的地面被切成兩個面、各配一種地表,而橋墩站在界線上」(計畫 §⑨ 的那一條交互作用)。
- `--break-id` — 壞版: 提案的分區 surfaceId 間距改成 1/255(= 1 個 8bit 位階) ⇒ **MUST 紅**: 驗收面 3 的①MUST 紅:0.00392 < 0.004 跨不過 `step(0.004, idv)`。門檻 0.004 MUST 從 `postfx.js` 原文抽,MUST NOT 隨 break 改。
- `--break-label` — 壞版: 逐面標籤改讀面 id(例:`zn = LIST[faceId % LIST.length]`) ⇒ **MUST 紅**: 驗收面 2 第④條 MUST 紅(人工重排 id 之後標籤變了),同時驗收面 1 的一致率會崩到隨機水準。

## 會靜默壞掉的地方
- **逐格一致率當門檻 = 這一項最可能的靜默失敗。** 現制界線是「哪一格投票翻面」的雜訊,新制界線是路緣/河岸 —— 兩者本來就不逐格相同。若實作者把一致率當成驗收面 1 的門檻,他會回頭把切面調成「盡量複製舊制」,樁報綠而整個 §0-a 的收益(「界線落在它在真實世界換手的地方」)一格都沒拿到,而且沒有任何斷言看得出來。步 7 的第③條(離真值距離)才是門檻。
- **執行期根本沒有 landuse/natural/waterway/boundary 這四類圖資。** `fetchOsmFeatures`(biomes.js:3994)只抓 building / railway / level_crossing / waterfall / place / peak / motorway_junction / station;`fetchOsmRoads` 只抓 highway。樁在 Node 端用 `venue_field.landcoverFor` + 新的 `cutLinesFor` 補得到,**但序 14 上線時遊戲端拿不到** ⇒ 若沒人注意到,新制會在真的遊戲裡退化成「只有道路 + 坡度」切面,而樁上量到的界線品質永遠重現不了。樁 MUST 把「哪幾類線來自離線專屬查詢」逐類印出來並在報告開頭紅字提醒。
- **`venue_field.llToWorld` 沒有 A42 的主方位旋轉**(全檔 grep 不到 `rot`/`mapRot`/`llToXZ`,而檔頭仍寫著「與 terrain.js 同一組換算 … 逐字照抄」—— 那句話在 2026-08-10 A42 上線後就過期了)。實測旋轉角:taroko −26.04°、shibuya 14.53°、barcelona 42.80°。對 `audit_traverse` 無害(剛體變換,連通性是旋轉不變量),但樁若把 Node 端的座標拿去和瀏覽器算的東西比對就整份對不上。緩解:樁的線與取樣一律走 `data.llToXZ`,並在報告印旋轉角。**修 `venue_field.llToWorld` 本身不併進本輪**(那會動到 `audit_traverse`/`audit_lane_scenarios` 的座標輸出,是另一件事)。
- **flood fill 的面 id 是掃描順序的函式。** 只要下游任何一處拿 id 當種子(選款、變體、雜湊),兩台客戶端只要 ways 陣列順序差一格就建出不同的世界,而單機跑一百次都是對的。步 8 第③條(順序無關)+ `--break-order` 是唯一守得住的東西。
- **4 鄰 vs 8 鄰**:flood fill 用 8 鄰會讓兩個只在對角相碰的面漏成同一個面(牆的對角線是「漏水」的),而報告上只表現成面數少了幾個。MUST 是 4 鄰,而牆 texel 的併回(併進最近的面)可以用 8 鄰 —— 兩者是不同的問題。
- **`'!'`(懸崖不鋪)與 `null`(envCode 判乾但影像仍水色 ⇒ 留白露衛星底圖)兩個狀態在遮罩制下沒有對應。** 計畫的次款預算表只列了六個分區。樁 MUST 印它們的面積佔比(否則序 14 落地時會發現「懸崖那一片變成草皮」而沒人知道什麼時候變的)。
- **建構期成本量在 Node 會低報。** `buildBiomes` 跑在瀏覽器、而低功耗手機是這一項真正的邊界(§⑧ 的裝置階梯 + `MINI.BUFFER_F` 換的就是手機幀率)。Node 的數字只是量級參考;綁定值 MUST 由 `--browser` 模式量,理想上再加一次真機(㋕)。
- **`landcoverFor` 的 `covers` 是 `out geom` 回的整條 way,可能大幅超出 bbox。** `audit_venue_biome` 為此有 `clipToBBox`(不裁的話一塊 3.4 倍於方框的鎮級 landuse 能量出 urban 99%)。樁拿 covers 當**標籤來源**時 MUST 同樣裁到 `battleRect` 的框內,否則一塊跨了半個城市的 `landuse=residential` 會把整張圖標成市區,而每一個數字看起來都正常。
- **明隧道柱列帶(`galStrips`/`carveGalleryBands`)在 Node 端拿不到** ⇒ keep-out 名冊不完整。MUST 在報告標「未驗」(`tools/CLAUDE.md` 紀律 4:例外/取不到資料 MUST NOT 洗成跳過)。
- **`--break-*` 的字面替換在這個 CRLF 工作區是無聲 no-op**(§5.4 ㋑)。八支反向驗證的替換一律用 `\r?\n` 樣式,而且**替換無效時 MUST 當場失敗**;2026-08-14 `--break-roof` 就是綁死現值而靜默失效、紅字由 2 條掉成 1 條而壞版根本沒被造出來。

## 逐位元中性

本項**結構性地**逐位元中性:`public/**` 與 `server/**` 一行不動(`git diff --stat -- public/ server/` MUST 為空),所有新東西都住 `tools/` 且沒有任何遊戲端 import 它們。三個佐證面:①`npm run bal` / `npm test` MUST 逐項不動(平衡與 sim 一行未改);②`audit_ground_tile`/`ground_qc`/`ground_seam`/`ground_enclave`/`ground_border`/`siteplan`/`beacons`/`object_joints --seeds 8`/`cel_pipeline`/`road_grid`/`slope_move` MUST 逐項不動(它們讀的是同一份 ground.js/biomes.js 原文,而原文沒改);③`audit_client_syntax`/`audit_solo_boot`/`npm run audit:net` 不會有新的客戶端模組進名冊(這也是「不進 `public/js`」的另一個好處 —— `build:solo` 只複製 `public/**`,出貨包一個位元組都沒有多)。兩處**編輯既有工具**的逐位元證明各自成立:`logo_lib.encodePNG` 新增的 `dir` 參數有預設值 `OUT_DIR`,三個既有呼叫端不傳 ⇒ 重跑 `flatten_logo`/`split_logo`/`compose_logo` 的 PNG **md5 MUST 與改前相同**;`venue_field` 只新增 export、`audit_traverse` 的四支函式是**純搬家** ⇒ 搬家前後各跑一次 `audit_traverse --only=<有快取的場地> --json=`,兩份 JSON **MUST 逐位元相同**(這是唯一能證明搬家沒改行為的東西,MUST 做,不可以只看「還是全綠」)。

## 卡在
- **樁過了之後,序 14 的第一步 = 把 `tools/zonecut.mjs` 原封改名成 `public/js/zonecut.js`**(零 import,同 `roadgrid.js`/`wallpanel.js`/`edgewall.js`/`osmrelay.js` 的家族),`tools/audit_zone_cut.mjs` 改 import 過去 ⇒ 遊戲端與離線工具同吃一份定義,不會長出第二份實作。這也是為什麼步 3 要求它零 import 零亂數 —— 那不是潔癖,是這一步能不能只是一次改名的前提。連帶:`audit_client_syntax`(名冊由目錄推導)/`audit_solo_boot`/`npm run audit:net` 會多一支客戶端模組,MUST 一起跑。
- **需使用者裁決 ①:`surfaceId` 從常數換成 `f(zone)`。** 驗收面 3 要的「草↔岩、乾↔濕出線」必須讓地貌的 `LAND_SURF_ID` 不再是單一常數,而那是 2026-08-13 使用者定案「不要看出地貌拼圖接縫」的直接產物(`audit_cel_pipeline` Ⅶ + `toon.js:182` 的檔頭把理由寫死了)。兩者不衝突(拼圖接縫 vs 地貌換手是兩件事),但這是**推翻一條既有定案的形狀**,MUST 由使用者放行。樁只出算術報告,不動 shader。
- **需使用者裁決 ②:`'!'`(懸崖不鋪)與 `null`(留白露衛星底圖)在遮罩制下怎麼表達。** 計畫的次款預算表只有六個分區,沒有這兩格。樁會印面積佔比,決定留給使用者。
- **序 14 的前置:執行期要多抓四類圖資。** `fetchOsmFeatures` 要加 `way["waterway"]` / `way["landuse"]` / `way["natural"]` / `way["boundary"="administrative"]`,而那條路上有三道既有閘:①改查詢 MUST 同步 `geoKey('osmF', 3)`(不改版舊快取照樣命中,新資料在所有「以前開過這張圖」的機器上永遠不出現);②payload 要進 `osmrelay.js` 的中繼(A43),而超限是 ws 1009 **斷掉房主的連線**、症狀看起來完全像伺服器壞掉 ⇒ MUST 先跑 `node tools/measure_osm_relay.mjs`(㋓,現況實測 1.05MB / maxPayload 餘裕 1.9×,不厚);③Overpass 額度與逾時。這一整包不在序 13 內,但樁的報告 MUST 把它列成序 14 的第一道門。
- **㋓ 依賴**:`--browser` 模式需要 playwright(走 `tools/pw.mjs` 的 `chromiumOrNull`,找不到就印一行跳過)+ 網路(terrarium 高程磚、Esri 影像、Overpass)。沙箱跑不動 ⇒ 影像分類那一半與建構期成本的綁定值 MUST 在真機/GitHub Actions 補,並在交付說明標未驗(§5.4 ㋓)。`SVS_URL`/`--port` MUST 指向**本工作區**的埠 —— 8620 上常跑著另一個 checkout。
- **`venue_field.llToWorld` 補上 A42 旋轉**是一件獨立的事(它現在是 pre-A42 的手抄,而 `data.js` 沒有 three、該檔已經在 import 它)。修它會動到 `audit_traverse`/`audit_lane_scenarios` 的座標輸出 ⇒ **MUST NOT 併進序 13 的 diff**,另開一輪並附「rot=0 場地逐位元不變 / 旋轉場地的航點清單重驗」的證明。
- **序 15 的退場清單目前只在計畫上,沒有任何稽核在守。** `CARPET_LOT`/`carpetOrder`/`CARPET_VARIANTS`/`planSeamOverlays`/`planEnclaves`/`BORDER_SAME_ZONE`/`bandDryAt`/`emitCell` 認養整批退場的那一輪會同時讓 `audit_ground_tile` Ⅰ Ⅱ Ⅳ Ⅵ、`audit_ground_seam`、`audit_ground_enclave`、`audit_ground_border` 的大半條目失去對象。樁 MUST 在報告末尾列出「若取代成立,哪幾支稽核的哪幾條會需要改寫」,那份清單是序 15 的規模估計,也是「樁沒過就不取代」時的取消成本。
