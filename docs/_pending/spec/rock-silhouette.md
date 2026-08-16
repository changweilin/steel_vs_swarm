# 使用者本輪追加 ——「山頭 / 巨石 / 石堆的處置」(與序 3 ①-1 `outlineContribution` 同批;與 ②-1「整棵樹」共用同一條表面群組縫)  (key: rock-silhouette)

## 摘要

現況查明(不是憑記憶):`envMat()` 每呼叫一次就建一份新材質、`applyCelPatch` 隨即抽一個 `nextSurfId()`(toon.js:607),而 `rockMat()` 就是 `envMat` 的薄殼(biomes.js:1880)⇒ **一顆巨岩的 20~40 塊零件各自是一個 surfaceId**,`INK_MRT.ID` 那一項因此沿著同一顆岩的每一條塊界畫線;`ground.js` 的 `boulder`/`slab` 兩零件也各一號 ⇒ 每一顆石頭中間被切一刀,而**兩顆不同的石頭反而同號**(同一個 InstancedMesh 材質)。反過來,邊界牆環 / 緩衝布景 / 遠景背景走 `flushPartBatch` 合併成**一份材質**(biomes.js:7651)⇒ 天生只有一號,問題全在法線折邊那一項;地形是 `land: true` ⇒ 恆 `LAND_SURF_ID = 0`(terrain.js:531/534),id 項恆 0、只剩真地形法線的折邊在說話。落地設計是**三個各司一職的機制**:M1「表面群組」(共用 `surfaceId`,粒度 = 玩家會把它指成一個東西)消掉物體內部的 id 線;M2 `outlineContribution`(序 3 的通道)由**世界尺寸推導**決定「這一款東西值不值得一條線」,把逐顆描邊的碎石雜訊壓掉;M3 `INK_MRT.SELF_F` 把「五格同一個表面群組」的**法線折邊**門檻抬高(深度那一項**刻意不抬** —— 深度跳變的語意就是剪影),讓 ico 碎面與高度場格線退場而節理/崖階/棧道/鑿面(它們是**另一個**群組)照樣出線。三者全部只動材質與勾線 pass,`rockProbe` 實測、碰撞柱、`blockers`、攀爬幾何一行不改。雪線刻意**本輪不做**:現制的地貌類別換手發生在拼圖格界上(逐格投票),拿它當 `surfaceId` 邊就是把 2026-08-13 剛藏起來的接縫重新畫出來 —— 它是 §0-a 遮罩面(序 14/15)的推論。

## 縫

### 表面群組配號器(共用縫;與 ②-1「整棵樹」同一支,MUST NOT 各自發明)
`public/js/toon.js:178`

現行:
```js
let _surfSeq = 0;
/** 逐材質的 surfaceId(量化到 [0,1] 的 64 階;相鄰材質撞號 = 少一條線,不是壞掉)*/
const nextSurfId = () => ((_surfSeq = (_surfSeq + 23) & 63) + 0.5) / 64;
/**
 * 地貌共用的 surfaceId。取 **0 是刻意的**:`nextSurfId` 的值域是 `(k + 0.5) / 64`,
 * 最小 0.0078 ⇒ 0 永遠不會被抽到 ⇒ 地貌與任何一份非地貌材質的 id 差恆 ≥ 0.0078,
 * 穩穩跨過 `INK_MRT` 那一項的 0.004 門檻(地貌 vs 建物的線一條都不會少)。
 */
const LAND_SURF_ID = 0;
```

**改成**: 在 `LAND_SURF_ID` 之後新增兩支 export(**全專案唯一的表面群組入口**,岩體與樹冠同吃):`export const surfGroup = () => nextSurfId();`(配一個新號,與逐材質號同一條 64 階環 ⇒ 不會撞號)與 `export function joinSurfGroup(root, id = surfGroup())`(遞迴把子樹上帶 `userData.celOpts` 的材質改寫 `userData.celSurfId = id`;`celOpts.land` 為真者 MUST skip —— 地貌恆 `LAND_SURF_ID`,A46/Ⅶ)。⚠ 兩支都 **MUST 在物件 `scene.add` 之前呼叫**:`uSurfId` 的值在 `onBeforeCompile` 當下就凍結,之後再改 `userData` 是靜默無效(線照畫、無錯誤訊息)—— 這一條由稽核以呼叫點順序釘住。**零亂數消耗**(`_surfSeq` 是模組級序,不是共享 `rnd()`)。

### surfaceId 指派的優先序(⚠ 606 那一行 MUST 逐位元不動)
`public/js/toon.js:606`

現行:
```js
  // 地貌一律共用同一號(檔頭 ①):它是**類別**不是實例,MUST NOT 走 nextSurfId
  if (land) mat.userData.celSurfId = LAND_SURF_ID;
  else if (mat.userData.celSurfId == null) mat.userData.celSurfId = nextSurfId();
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uSurfId = { value: mat.userData.celSurfId };
    shader.uniforms.uInkClass = { value: land ? INK_CLASS.LAND : INK_CLASS.HARD };
```

**改成**: `applyCelPatch` 簽章加 `surf = null`,並在 606 與 607 之間插入**新的一行** `else if (surf != null) mat.userData.celSurfId = surf;`。⚠ **606 那一行的文字 MUST 一個字元都不動**:`audit_cel_pipeline.mjs:378` 以逐字正規式釘它、`:362` 的 `--break-land` 以逐字 `replace` 造壞版,改寫它會讓那支反向驗證變成靜默 no-op(§5.4 ㋑)。同理 609 那一行也是逐字斷言(`:307`)。`envMat()`(toon.js:1000)與 `toonMat()`(toon.js:986)MUST 各加一個 `surf` 透傳欄(解構 + 往下傳),**MUST NOT 進 `customProgramCacheKey`** —— `uSurfId` 是逐材質 uniform、程式可共用(現制 `LAND_SURF_ID` 與 `nextSurfId` 已經在共用同一支程式,是既成事實)。

### gInfo 寫入端(序 3 的 contribution 掛在這裡,本項只當消費者)
`public/js/toon.js:896`

現行:
```js
          #ifdef CEL_LAND_N
          // 貼地拼圖:自己的法線恆 (0,1,0)(它只是一張皮)⇒ 換成呼叫端餵的真地形法線。
          if ( dot( vLandN, vLandN ) > 1e-8 ) gN = normalize( vLandN );
          #endif
          gInfo = vec4( gN.xy * 0.5 + 0.5, uSurfId, uInkClass );
        }`)
```

**改成**: 本項**不自己改這一行的編碼**。序 3(①-1)會把 `.a` 換成 §0-c 定案的半位元組打包 `( clsIdx*16 + round(ctr*15) ) / 255`;本項只負責**餵 `ctr` 的值**(新 uniform `uInkCtr`,由 `applyCelPatch` 的新欄 `ctr` 定案,預設 1 ⇒ 序 3 落地前後都逐位元同舊制)。若序 3 尚未落地,本項 MUST 只做 M1 + M3(表面群組 + 內部折邊門檻),把 M2 留在 `blockedOn`;**MUST NOT 自己另開一個 contribution 通道**。

### INK_MRT 常數(內部折邊門檻 + 掠射抑制)
`public/js/postfx.js:70`

現行:
```js
const INK_MRT = {
  NRM0: 0.05,        // 法線折邊起畫(相鄰兩格視空間法線 xy 的中央差分長度)
  NRM1: 0.42,        // 全強度。實測:同一塊平板 < 0.02、90° 折邊 ≈ 1.0
  ID: 0.55,          // id 不同(不同材質相接)給的強度 —— 比折邊輕,它只是「不同東西」
};
```

**改成**: 加兩格,**兩格都 MUST 由 `shot_scene --pref inkMrt=on` 逐輪實測定案(同 `INK.K_D`/`K_S` 那一輪的手法),MUST NOT 猜**:`SELF_F`(五格**同一個表面群組**時把 `NRM0`/`NRM1` 一起乘上的倍率,> 1;起手值 2.2,判準 = ico(0) 小面折角 41.8°、ico(1) 更小、圓柱 9~11 邊 32~40° 要退場,而節理 rib / 崖階 / 鑿面對主量體的近 90° 折角要留)與 `GRAZE_K`(掠射抑制係數:`n.z` 由中央格的 `gInfo.rg` 反解 `sqrt(max(0, 1 - x² - y²))`,門檻再乘 `1 + GRAZE_K * (1 - n.z)`;它是高度場網格折邊的解藥,語意與深度那一項的 `INK.K_S` 相同但**單位不同、值不可共用**)。⚠ 這一條與計畫 ①-4「深度門檻吃中心法線 z」**是兩個不同的項**:①-4 動的是**深度**那一項且與 `K_S` 二擇一,本項動的是**法線折邊**那一項 —— 兩者可以並存,但 MUST 在同一輪交代清楚,MUST NOT 讓 `n.z` 同時進兩處而重複計價。

### 勾線 pass 的 MRT 區塊(唯一讀取端)
`public/js/postfx.js:533`

現行:
```js
          vec4 i0 = texture2D( tInfo, vUv );
          vec4 il = texture2D( tInfo, vUv - vec2( t.x, 0.0 ) ), ir = texture2D( tInfo, vUv + vec2( t.x, 0.0 ) );
          vec4 iu = texture2D( tInfo, vUv + vec2( 0.0, t.y ) ), ib = texture2D( tInfo, vUv - vec2( 0.0, t.y ) );
          float mrtEdge = 0.0;
          if ( min( min( i0.a, min( il.a, ir.a ) ), min( iu.a, ib.a ) ) > 0.25 ) {
            float nrm = length( vec2( length( il.rg - ir.rg ), length( iu.rg - ib.rg ) ) );
            float idv = max( abs( il.b - ir.b ), abs( iu.b - ib.b ) );
            mrtEdge = max(
              smoothstep( 0.050, 0.420, nrm ),
              step( 0.004, idv ) * 0.55 );
          }
```

**改成**: 在 `idv` 之後推導 `float same = 1.0 - step( 0.004, idv );`(**只在哨兵齊全的分支內成立** —— 分支外 `same` 恆 0,天空/特效那一圈的剪影一格不動),再把兩個門檻換成 `mix( NRM0, NRM0 * SELF_F, same ) * (1.0 + GRAZE_K * (1.0 - nz))` 與 `NRM1` 同式(`nz` 自 `i0.rg` 反解)。**`step( 0.004, idv ) * ID` 那一項與底下的深度那一項 `ae` / `EDGE0` 一行不動** —— 深度跳變 = 前面有東西擋住後面 = 剪影的定義,不管兩邊是不是同一個表面;抬它就會讓兩顆重疊的 boulder(同一份 InstancedMesh 材質 ⇒ 同號)糊成一坨。⚠ 早退那一行 `if ( ae <= EDGE0 && mrtEdge <= 0.0 )` 的 `mrtEdge` 語意不變 ⇒ 不必改。

### 岩面材質(巨岩的 80 個建構呼叫全部經過這裡)
`public/js/biomes.js:1880`

現行:
```js
function rockMat(color, moss = 0) {
  const m = envMat(color, { wash: 0.6, cool: 0.5, moss: moss ? { amount: moss } : null });
  m.userData.rock = true;   // 岩面材質標記:placeMegaliths 逐顆調色只認這面旗(不動綠冠/木門等)
  return m;
}
```

**改成**: **不改簽章、不改本體**(它被 `audit_object_joints.mjs:675` 以 `mat = () => ({})` 樁件注入,改簽章雖不致命但沒有必要)。`userData.rock = true` 這面既有旗標正是本項要用的判據:群組指派**全部落在 `placeMegaliths` 的既有 traverse 上**(見下一列)。

### 巨岩逐顆調色 traverse(表面群組指派的落點;零額外 traverse、零 rnd)
`public/js/biomes.js:3707`

現行:
```js
      const dH = fH + (rnd() - 0.5) * 0.015, dS = fS + (rnd() - 0.5) * 0.04, dL = fL + (rnd() - 0.5) * 0.04;
      g.traverse((o) => {
        if (o.isMesh && o.material?.userData?.rock) {
          o.material.color.offsetHSL(dH, dS, dL + (rnd() - 0.5) * 0.05);
        }
      });
      // 零件級細節抖動(P2-B;2026-08-03)…
      jitterMegalith(g, djAt(x, z), meta.col.r);
      bakeContactAO(g, 6);   // 接地 AO:巨岩「長」在地上(botw_plan Task 2.2)
      g.scale.setScalar(s);
```

**改成**: 在同一趟 traverse 內把每一件分進**兩個**表面群組(呼叫端先 `const gBody = surfGroup(), gFeat = surfGroup();`,零 `rnd()`):判據 **MUST 是推導不是名冊** —— 以 `new THREE.Box3().setFromObject(o)` 量這一件的水平外廓 `ext`(與 `jitterMegalith` 的 `_mjbox` 同一把尺、同一個局部座標系),`ext / meta.col.r >= MEGA_BODY_F` ⇒ 主量體群組,否則 ⇒ 結構件群組。實測分佈把兩者分得很開:主量體(dome / slab / tower / 碎石坡 cone `0.8×max(RX,RZ)`)落在 0.8~1.0,貼壁結構件(`chisel` 鑿面 8~20m、侵蝕 rib 1.3~1.6m、之字棧道踏板、鏡牆帶、獅爪、石屋)落在 0.03~0.35 ⇒ `MEGA_BODY_F` 取 0.5 兩側各有一個數量級的餘裕。**效果**:主量體塊與塊之間、ico/圓柱小面之間的線消失(剪影留下),而結構件與主量體之間跨群組 ⇒ 節理 / 層理 / 崖階 / 棧道那幾條線**自動留著**,結構件彼此之間同群組 ⇒ 不互相畫線。MUST 排在 `g.scale.setScalar(s)` 之後、`group.add(g)` **之前**(uniform 在首次編譯凍結)。

### 石堆散件的 InstancedMesh 發射(逐款一個表面群組 + contribution 推導入口)
`public/js/ground.js:4944`

現行:
```js
  for (const type in det) {
    const items = det[type];
    if (!items.length) continue;
    for (const part of DETAIL_DEFS[type]) {
      const mat = envMat(partColor(part.c), {
        map: part.tex ? detailTex(part.tex) : null, wash: 0.35, cool: 0.4,
        ...(part.sf ? { soft: { k: part.sf, span: detailSpan(type), base: 0, sy: part.sy ?? 1 } } : {}),
      });
      const m = new THREE.InstancedMesh(part.geo, mat, items.length);
```

**改成**: 在 `for (const part of …)` **之上**取一次 `const sg = surfGroup();`,並把 `surf: sg` 與 `ctr: inkCtrM(detailR(type) * 2)` 一起傳進 `envMat`。①**粒度定案 = 「一顆」不是「一堆」**:`type` 就是「一顆」的單位 ⇒ `boulder` 的大小兩瓣、`slab` 的板 + 墩、`snag` 的幹 + 兩枝從此不互相畫線;而**兩顆之間**的輪廓由深度那一項給(它們是分開的實體,深度真的有落差),所以不必也 MUST NOT 再往上收成「一堆」——收了岩屑坡上的十幾顆就糊成一坨。②contribution 由**已經是實測縫**的 `detailR(type)`(ground.js:1596,量零件真幾何、手寫值會靜默過期)推導,零新名冊:`pebble` r≈0.42 → 低、`rockflat`/`iceshard`/`slab` → 中、`boulder` r≈1.25 → 中高,對映到「畫面上只有幾個像素的東西不值得一條線」。

### 遠景背景環(假山:已經只有一份材質,只差 contribution)
`public/js/biomes.js:7723`

現行:
```js
  // 遠景:洗白拉高、冷色重一點(大氣透視)⇒ 與近處的世界分得開,不會誤讀成可以走過去的地形
  flushPartBatch(group, batch, { wash: 0.78, cool: 0.72, rim: 0 });
  return plan.length;
}
```

**改成**: 加 `ctr: INK_CTR.BACKDROP`(遠景是**畫上去的背景不是物件**,這是它與 `wash: 0.78` 同一句話的另一半)。⚠ **這一批目前是全場最刺眼的一處**:`buildBackdrop` 落在圖界外 `edgeBufferM() × BACK_INSET_F = 455.6 × 0.9 = 410m`,而 `INK.FADE0/FADE1` 錨的是 `camera.far`(= `span × 2`;以 `CURVE` 檔頭記載的地形格 8.3m 反推 span ≈ 1594m ⇒ 起淡 1753m、全滅 3029m)、`scene.fog` 的 near 是 `span × 0.5 ≈ 797m` ⇒ **玩家站在圖界附近時,那一圈 5 邊形錐體在 410m 外零霧、勾線 100% 強度**,每一條稜線都畫得清清楚楚。這正是「遠山被畫成一堆多邊形」的實體。真正的通用解是計畫 **④-3「霧範圍 ≡ 勾線淡出範圍」**(把 `INK.FADE0/FADE1` 從 `camera.far` 改錨到 `curveHorizonM()` / `scene.fog`),本項先用 contribution 止血,**MUST 在交付說明裡把 ④-3 點名**,MUST NOT 把 FADE 常數就地改小(那會把近景的線一起吃掉)。

### 邊界牆環(懸崖峭壁 / 土石流 / 山崩地 / 消波塊 —— 同一批,同樣只差 contribution)
`public/js/biomes.js:7593`

現行:
```js
  flushPartBatch(group, batch, { wash: 0.42, cool: 0.42 });
  return segs;
}
```

**改成**: 加 `ctr: INK_CTR.EDGE`。它已經是**一個 merged mesh 一份材質**(`flushPartBatch`,biomes.js:7651)⇒ M1 天生成立、id 線一條都沒有,剩下的全是法線折邊 ⇒ M3 的 `SELF_F` 對它整段生效(那一整圈都在同一個群組裡)。**MUST NOT 動 `blockers.push` 那一行與 `partBox`/`wallFit`/`wallFaceCover`**(A44 ③④:演出 ⊆ 碰撞盒、內面填滿是逐段實測出來的)。

### 地形材質(山頭:MUST NOT 動 land,稜線靠 GRAZE_K)
`public/js/terrain.js:526`

現行:
```js
  let mat;
  if (imagery) {
    const tex = new THREE.CanvasTexture(imagery.canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = 4;
    mat = envMat(0xffffff, { map: tex, rim: 0, bands: 4, land: true });
  } else {
    paintTerrainTones(geo, pos, { minX, maxX, minZ, maxZ }, center);
    mat = envMat(0xffffff, { vertexColors: true, rim: 0, bands: 4, land: true });
  }
```

**改成**: **兩行都 MUST 一個字不改**(`land: true` ⇒ 恆 `LAND_SURF_ID`、類別 LAND;A46/Ⅶ 與 `audit_cel_pipeline` Ⅶ 釘死)。山頭的答案不在這裡,在 M3 的 `GRAZE_K`:地形是 `computeVertexNormals()` 的**平滑**法線(terrain.js:505),`INK_MRT.NRM` 因此量的是曲率 —— **稜線(法線在一格內轉很多)出線、緩坡與高度場的取樣雜訊不出線**,而唯一會把後者誤畫成線的情形是**掠射**(一個 texel 橫跨好幾公尺,193² 網格 8.3m 一格的變化被壓進一格像素)。深度那一項早就有 `INK.K_S = 3.0` 專門治這件事(postfx.js:78 的註解就是那四輪實測紀錄),法線那一項現在**完全沒有** ⇒ `inkMrt` 一開,整片山坡回到「畫滿等高線」。⇒ 「哪一條稜線該出線」的判準 = **法線折角大 ∧ 不是掠射造成的**,而不是任何逐地形名冊。`land` 類別的 contribution 一律 1(山的形狀是主角)。

### contribution 推導的家(離線可驗,零 three)
`public/js/data.js:981`

現行:
```js
export const CURVE = {
  // 拐點 = 交戰距離上界 × 此值。**1.0 以下即侵入交戰距離**(稽核 Ⅱ 守門);0 = 純球面
  KNEE_F: 1.0,
  // 允許的**弦高**(m):一條直邊橫跨 L 公尺時,線性內插與真曲面差 L²/(4R)。
  SAG_M: 0.05,
};
```

**改成**: 在 `CURVE` 附近新增 `INK_CTR`(`MIN_M` / `FULL_M` / `BACKDROP` / `EDGE`)與 `export const inkCtrM = (sizeM) => …`(單調遞增、`sizeM ≥ FULL_M` 恆回 1、`≤ MIN_M` 恆回下限)。**住 `data.js` 的理由與 `CURVE`/`DOF` 逐字相同**:離線稽核 MUST 能 import 真品直測那條曲線,而 `toon.js` 依賴 three(沙箱無 CDN)。⚠ **若序 3(①-1)已經為 contribution 建了家,本項 MUST 併過去、MUST NOT 開第二份**(單一真相縫)。⚠ 動 `data.js` ⇒ **不是** §5.4 ㋒,MUST 證明 `npm run bal` / `npm test` 逐項不動(`INK_CTR` 純表現層、不進 `balanceFingerprint`,前例 = `CURVE`/`DOF`)。

## 寫入檔案
- `public/js/toon.js` (edit) — 新增 `surfGroup()`/`joinSurfGroup()` 表面群組配號器(與 ②-1 共用);`applyCelPatch`/`envMat`/`toonMat` 加 `surf`、`ctr` 兩個透傳欄;`ctr` 的 uniform `uInkCtr` 交給序 3 的 gInfo 打包使用。⚠ 606/609 兩行逐位元不動。
- `public/js/postfx.js` (edit) — `INK_MRT` 加 `SELF_F` / `GRAZE_K` 兩格;勾線 pass 的 MRT 區塊推導 `same` 與 `nz`,只切換**法線折邊**那一項的門檻(id 項與深度項一行不動)。
- `public/js/data.js` (edit) — `INK_CTR` + `inkCtrM(sizeM)` 推導式(離線稽核 import 真品;若序 3 已有家則改成併入而不新增)。
- `public/js/biomes.js` (edit) — `placeMegaliths` 的既有調色 traverse 內加兩個表面群組的指派(判據 = 外廓 / `meta.col.r`,推導不手寫);`buildBackdrop` 與 `buildEdgeWall` 的 `flushPartBatch` 各加一個 `ctr`。
- `public/js/ground.js` (edit) — 3D 細節 InstancedMesh 發射迴圈:逐 `type` 取一次 `surfGroup()`、contribution 由既有的 `detailR(type)` 推導傳入。
- `tools/audit_cel_pipeline.mjs` (edit) — 新增 Ⅷ 段「剪影優先(表面群組 / 內部折邊門檻 / contribution 推導)」:原文斷言 + `inkCtrM` 真品直測 + 三支 `--break-*`。放這一支而不另開新檔,因為勾線的兩個消費端(toon/postfx)已經住在它裡面,拆開就是第二份規則。

## 步驟
1. 【0】拍基準:`node tools/shot_scene.mjs --venue taroko` 與 `--venue shibuya` 各跑兩輪 —— 一輪預設(`inkMrt=off`)、一輪 `--pref inkMrt=on`。⚠ 這一組是本項**唯一**的驗收面(離線稽核量不到「線畫得對不對」),而 `--pref inkMrt=on` 那一半在預設值下一張都拍不到(verification.md §5.1 續 的具名提醒)。留下 `hilltop` / `edge_far` / 岩體繞行四面 / `aerial` 的 md5 與圖檔。
2. 【1】toon.js:在 `LAND_SURF_ID`(:186)之後加 `surfGroup()` / `joinSurfGroup()`;`applyCelPatch` 簽章加 `surf = null, ctr = 1`,在 606 與 607 **之間**插 `else if (surf != null) …`(606/609 逐位元不動),`onBeforeCompile` 加 `uInkCtr`;`envMat`/`toonMat` 透傳。此步結束跑 `node tools/audit_client_syntax.mjs` 與 `node tools/audit_cel_pipeline.mjs`(Ⅵ/Ⅶ MUST 仍全綠 —— 沒有任何呼叫端傳 `surf`/`ctr` ⇒ 逐位元同舊制)。
3. 【2】data.js:加 `INK_CTR` + `inkCtrM`(或併進序 3 的家)。跑 `npm run bal` 與 `npm test`(先照 §5.2 重啟伺服器)MUST 逐項不動。
4. 【3】ground.js:細節發射迴圈逐 `type` 取 `surfGroup()` + `ctr: inkCtrM(detailR(type) * 2)`。跑 `audit_ground_tile` / `audit_ground_seam` / `audit_ground_enclave` / `audit_ground_qc` / `audit_soft_stroke` / `audit_siteplan` / `audit_beacons` / `audit_object_joints --seeds 8` —— 這一步**零 `rnd()` 消耗**,佈局 MUST 逐位元不動。
5. 【4】biomes.js:`placeMegaliths` 的調色 traverse 內分兩個群組(`MEGA_BODY_F` 起手 0.5);`buildBackdrop` / `buildEdgeWall` 的 `flushPartBatch` 各加 `ctr`。跑 `audit_object_joints --seeds 8`(接合幾何一格未動)、`audit_world_edge`(演出 ⊆ 碰撞盒、內面填滿 MUST 逐項不動)、`audit_climb`、`audit_siteplan`。
6. 【5】postfx.js:`INK_MRT` 加 `SELF_F`(起手 2.2)/ `GRAZE_K`(起手 2.0),勾線 pass 推導 `same` 與 `nz`,只換法線折邊那一項的門檻。跑 `audit_cel_pipeline`(Ⅵ/Ⅶ 全綠)+ `audit_gpu_lifecycle` + `audit_visual_prefs` + `audit_soft_stroke`(RT0 的 alpha 軟性契約 MUST 逐位元不動)。
7. 【6】㋓ **實測定案兩個係數**:重跑步驟 0 的四組定場照(`--pref inkMrt=on`),以 `SELF_F ∈ {1.0, 1.6, 2.2, 3.0}` × `GRAZE_K ∈ {0, 1, 2, 3}` 掃,判準三條 —— ①巨岩主量體上的 ico / 圓柱小面線消失 ②岩上的 rib / 鑿面 / 棧道 / 鏡牆帶的線仍在 ③`hilltop` 的山脊線仍在而坡面上的高度場格線消失。**MUST 取平均、MUST NOT 逐場地挑參數**(同 A46 ⑩ `dn_iter` 的那條紀律)。
8. 【7】tools/audit_cel_pipeline.mjs 加 Ⅷ 段 + 三支 `--break-*`,逐支確認紅字(見 reverseChecks)。
9. 【8】收尾:`node tools/audit_client_syntax.mjs`、`npm run audit:net`、`node tools/audit_solo_boot.mjs`、`npm run bal`、`npm test`(重啟伺服器);交付說明 MUST 標註未驗項(㋓ 的定場照與真機)與「④-3 霧範圍 ≡ 勾線淡出範圍」這一條尚未做。

## 稽核
- `node tools/audit_cel_pipeline.mjs`
- `node tools/audit_cel_pipeline.mjs --break-inkinfo`
- `node tools/audit_cel_pipeline.mjs --break-land`
- `node tools/audit_cel_pipeline.mjs --break-lutland`
- `node tools/audit_cel_pipeline.mjs --break-rocksurf`
- `node tools/audit_cel_pipeline.mjs --break-detsurf`
- `node tools/audit_cel_pipeline.mjs --break-selff`
- `node tools/audit_client_syntax.mjs`
- `node tools/audit_visual_prefs.mjs`
- `node tools/audit_gpu_lifecycle.mjs`
- `node tools/audit_soft_stroke.mjs`
- `node tools/audit_world_curve.mjs`
- `node tools/audit_object_joints.mjs --seeds 8`
- `node tools/audit_siteplan.mjs`
- `node tools/audit_beacons.mjs`
- `node tools/audit_world_edge.mjs`
- `node tools/audit_climb.mjs`
- `node tools/audit_ground_tile.mjs`
- `node tools/audit_ground_seam.mjs`
- `node tools/audit_ground_enclave.mjs`
- `node tools/audit_ground_qc.mjs`
- `node tools/audit_world_height.mjs`
- `node tools/audit_solo_boot.mjs`
- `npm run audit:net`
- `npm run bal`
- `npm test`
- `node tools/shot_scene.mjs --venue taroko --pref inkMrt=on`
- `node tools/shot_scene.mjs --venue taroko`
- `node tools/shot_scene.mjs --venue shibuya --pref inkMrt=on`
- `node tools/audit_traverse.mjs`

## 反向驗證
- `--break-rocksurf` — 壞版: 把 `placeMegaliths` 的表面群組指派整段拿掉(字面替換那一段 `joinSurfGroup`/`o.material.userData.celSurfId = …` 的行;替換無效 MUST 當場 `process.exit(1)`,且樣式 MUST 用 CRLF 容忍的 `\r?\n`)⇒ 巨岩退回逐材質 `nextSurfId`(= 一顆岩 20~40 個 id) ⇒ **MUST 紅**: audit_cel_pipeline Ⅷ 的「巨岩的每一件都被指派到兩個表面群組之一」與「群組判據是量出來的外廓比,不是逐型名冊」兩條 MUST 紅
- `--break-detsurf` — 壞版: 把 ground.js 細節發射迴圈的 `const sg = surfGroup();` 移進**內層** `for (const part of …)`(= 逐零件各一號,退回現況) ⇒ **MUST 紅**: audit_cel_pipeline Ⅷ 的「`surfGroup()` MUST 取在零件迴圈之外(逐 type 一次)」與「`boulder`/`slab`/`snag` 這類多零件款的所有 part 共用一號」兩條 MUST 紅。⚠ 這一支的價值在於它咬的是**取號的位置**而不是有沒有取號 —— 取號在裡面也照樣「有 surfGroup」,而畫面上就是每顆石頭中間仍被切一刀
- `--break-selff` — 壞版: `INK_MRT.SELF_F` 與 `GRAZE_K` 一起寫回 1.0 / 0.0(= 內部折邊與跨表面折邊同門檻、掠射不抑制) ⇒ **MUST 紅**: audit_cel_pipeline Ⅷ 的「`SELF_F > 1`(否則 `same` 那一整段是恆等式,等於沒做)」「`GRAZE_K > 0`」「門檻 MUST 經 `mix(…, same)` 切換而不是常數」三條 MUST 紅。⚠ 斷言的期望值 MUST NOT 隨 `--break-*` 改變(§5.4 ㋑),即 Ⅷ MUST 直接讀 `INK_MRT` 的解析值比大小,MUST NOT 只比對字面
- `--break-ctr(序 3 落地後才有意義)` — 壞版: `inkCtrM` 改成恆回 1(= contribution 通道存在但永遠不生效) ⇒ **MUST 紅**: audit_cel_pipeline Ⅷ 的 `inkCtrM` 真品直測三條 MUST 紅:嚴格單調遞增、`inkCtrM(pebble 直徑) < inkCtrM(boulder 直徑) < inkCtrM(巨岩直徑) == 1`、`sizeM ≥ FULL_M` 恆等於 1

## 會靜默壞掉的地方
- **表面群組指派晚了一步 = 靜默無效**:`uSurfId` 的值在 `onBeforeCompile`(首次編譯)當下凍結,`joinSurfGroup` 若排在 `scene.add` 之後就一行都不生效 —— 線照畫、console 一個字都沒有、每一條原文斷言照樣綠。稽核 MUST 釘住呼叫點的**順序**(`placeMegaliths` 內 MUST 在 `group.add(g)` 之前、ground.js 內 MUST 在 `new THREE.InstancedMesh` 之前)。
- **兩顆不同的石頭同號**:`ground.js` 的一款 = 一個 InstancedMesh = 一份材質 ⇒ 全世界的 boulder 共用一號。若有人「順手」把 `SELF_F` 也套到**深度**那一項,兩顆重疊的石頭之間的輪廓就會一起被抬掉 = 一坨。這正是本規格把深度那一項排除在外的理由,MUST 寫進 postfx 的那一段註解。
- **`GRAZE_K` 抬過頭 = 山脊線一起不見**:`nz` 在山脊的迎向面上也不是 1(斜面本來就有掠射成分),係數一大就把該畫的那條也吃掉,而畫面上只表現成「山變得很平」,離線一條斷言都不會紅。⇒ 定案 MUST 走步驟 6 的掃描 + 定場照人眼判讀。
- **`MEGA_BODY_F` 的判據是外廓比,而 `jitterMegalith` 會改外廓**:抖動只增不減水平半徑(`xform.partJitter`),量測若排在抖動**之後**,靠近門檻的件會逐顆跳邊。⇒ 群組指派 MUST 排在既有調色 traverse 那一格(`jitterMegalith` 之前),與現有程式碼的順序一致。
- **合成岩的 `col.r = max(RX,RZ) + 4` 帶了 +4 的常數餘裕**,主量體的比值因此恆 < 1(實測落在 0.8~0.95)—— 門檻取 0.5 有一個數量級的餘裕,但若日後有人改 `SYNTH_COL_R` 或 `col.r` 的定義,這個比值會整批平移而**不會有任何斷言紅字**。⇒ Ⅷ MUST 印出逐型的比值分佈(同 `audit_bot_role` 末段印名冊的作法),讓「兩群擠在一起了」看得見。
- **`hazards.js` 的障礙岩走的是另一條線**:它有反轉外殼描邊(`outlinify(g, 0.07)`,hazards.js:534/580/676)而巨岩 / 石堆 / 邊界牆一律沒有(siteplan/beacons 檔頭明講「世界的線由螢幕空間勾線 pass 蓋全場」)。`chiselRock` 是 `IcosahedronGeometry(r, 1)` **非索引 ⇒ 逐面硬邊法線**(80 面)⇒ 它在 `inkMrt` 開啟時是全場最容易變成黑色鐵絲球的東西,而本規格**沒有動它**(它不在使用者點名的三個對象裡)。MUST 在交付說明中列為已知未處理項,MUST NOT 順手改 —— 動它會連帶動到 `audit_object_joints` 的 `chiselRock` 42 枚亂數樁。
- **contribution 若沒有跟序 3 併家就是第二份實作**:`INK_CTR` 住 data.js 的理由(離線可驗)成立,但序 3 也可能把它放進 `toon.js`。落地前 MUST 先確認序 3 的落點,兩份 contribution 常數表並存的症狀是「拉桿改了一半的東西」。
- **遠景那一圈的真正病灶不在 contribution**:`INK.FADE0/FADE1` 錨在 `camera.far`(= `span × 2`),對現役地圖等於「永遠不淡出」,而 `scene.fog` 的 near 是 `span × 0.5`。contribution 只是把假山的線調淡,**真山(地形)在同樣距離上仍是全強度**。計畫 ④-3 是那一條的正解,本輪不做 ⇒ 交付說明 MUST 點名,否則下一輪會有人在 contribution 上加距離項而長出第二把尺。

## 逐位元中性

["**旋鈕關著(`inkMrt = 'off'`,出貨預設)⇒ 整項逐位元同舊制,而且是結構保證不是校準**:`SELF_F`/`GRAZE_K`/`same`/`nz` 全部住在 `_inkMaterial()` 的 `${mrt ? … : ''}` 樣板分支裡(postfx.js:536-548),`_inkMrt` 為假時那一段**根本不會被組進 shader 原始碼**。證明手法:`node tools/shot_scene.mjs --venue taroko`(不帶 `--pref`)前後兩輪的 13 張定場照 **md5 逐張相同** —— 這正是 2026-08-13 地貌類別碼那一輪用過的同一道閘。","**`surfaceId` 那一半連旋鈕都不用**:`uSurfId` 只被 `gInfo.b` 讀,而 `gInfo` 只在 MRT 附件存在時才有消費端;旋鈕關著時第二張附件根本沒配。⇒ 巨岩 / 石堆 / 背景的群組指派在預設設定下**一個像素都不會變**。","**佈局逐位元不動(這一條比畫面更重要)**:`surfGroup()` 吃的是模組級的 `_surfSeq`(toon.js:178),**不是共享 `rnd()`**;`joinSurfGroup` 與 Box3 量測都不抽亂數;`inkCtrM` 是純函式。⇒ §2.3 的取樣序列一枚未動,`audit_siteplan` / `audit_beacons` / `audit_object_joints --seeds 8` / `audit_ground_*` MUST 逐項不變(不是「仍全綠」而是**逐項相同**)。⚠ 唯一會動到序列的寫法是「在 `placeMegaliths` 裡多抽一枚 `rnd()` 當群組種子」—— MUST NOT,群組號由 `surfGroup()` 給。","**權威側零改動**:`sim.js` / `server/**` 一行未改;`data.js` 只多了 `INK_CTR`/`inkCtrM`(純表現層、不進 `balanceFingerprint`,前例 = `CURVE`/`DOF`)⇒ `npm run bal` 與 `npm test` MUST **逐項不動**,動了就是純表現層漏到判定上。`rockProbe` 的射線、`meta.col.r`、`blockers`、`jitterMegalith` 的夾制、`climb.js` 的攀爬幾何、`audit_traverse` 的通行泛洪全部一行未改。","**旋鈕開著時刻意不是逐位元中性的**(那是本項的目的):`--pref inkMrt=on` 的定場照 MUST 變 —— 巨岩主量體上的小面線與山坡上的格線減少、rib/鑿面/山脊線保留。這一半只能人眼判讀,MUST 在交付說明標為 ㋓ 未驗項並附前後對照圖。"]

## 卡在
- **依賴序 3(①-1 `outlineContribution` + §0-c 半位元組打包 + 最近面覆寫)**:M2 那一半(contribution)沒有通道可以寫。⇒ 兩種落地順序都可行,MUST 二選一並在交付說明講清楚:①與序 3 同一批落地(建議);②本項只做 M1 + M3(表面群組 + 內部折邊門檻),`surf` 欄先上、`ctr` 欄留白 —— 那樣巨岩與石堆的「內部不出線」已經成立,只有「碎石不值得一條線」與「遠景背景調淡」要等。
- **依賴序 3 連帶的 `postfx._mkRT` 濾波修正**:`rtScene.texture[1]` 目前是 `LinearFilter`(計畫 §0-c 編碼定案段已點名 MUST 改 `NearestFilter`)。本項讓 `gInfo.b`(surfaceId)承擔更多語意 ⇒ 一旦有人動 `INK.THICK`,線性內插會把兩個群組號混成一個不存在的號。MUST 與序 3 同一輪改,MUST NOT 各改一次。
- **需要真瀏覽器(㋓)才能定案 `INK_MRT.SELF_F` 與 `GRAZE_K`**:兩者都是「哪一條線該留」的門檻,離線只驗得到「有沒有這個機制」,驗不到「留對了沒有」。沙箱跑不動 `shot_scene` ⇒ GitHub Actions 或真機;交付說明 MUST 標未驗項。
- **需要真機冒煙(㋕)**:走到一片露頭旁邊繞一圈、站上全圖最高點看遠山、走到圖界看那一圈假山 —— 「這顆岩看起來像不像一顆岩」在每一條斷言上都是綠的。
- **雪線 / 草↔岩界線 MUST NOT 在本輪做,依賴 §0-a(序 14/15)**:使用者問的「雪線要不要當 `surfaceId` 邊」,答案是**要,但不是現在**。現制 `icefield`/`scree`/`plateau` 的換手發生在 `ground.js` 的逐格投票邊界(`cellZoneAt` 逐格獨立 + `CARPET_LOT` 量化格)上,不在真實雪線上;而全部地貌共用 `LAND_SURF_ID` 正是 2026-08-13 為了藏那條接縫定的案(A46/Ⅶ、`audit_cel_pipeline` Ⅶ)。現在給它一個 id 邊 = 把剛藏起來的拼圖接縫用黑線重新描一次。⇒ 它是 §0-a 遮罩面的推論(計畫自己也寫著「新制覆寫自帶 `surfaceId` ⇒ 線免費」),MUST 等序 14/15。**中間態的廉價替代**(計畫 ①-3 的 `surfaceId += mask * 0.1`)在拼圖制下同樣會沿拼圖邊出線,一併 MUST NOT。
- **需要使用者裁決(兩項,都不影響本輪落地)**:①`hazards.js` 的障礙岩(`chiselRock`,80 面硬邊 + 反轉外殼)要不要一起收進表面群組 —— 它不在使用者點名的三個對象裡,而動它會連帶動到 `audit_object_joints` 的 42 枚亂數樁;②遠景背景那一圈到底要「線調淡」還是「整圈不出線」(`INK_CTR.BACKDROP = 0`)—— 前者是遠山,後者是一張畫上去的背景板,兩種都自洽,是美術方向不是推導。
