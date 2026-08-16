# 序 7 / ②-1 葉片卡冠層 → 整棵樹(使用者本輪追加範圍)  (key: seq7-tree)

## 摘要

現況:植被(`VEG_DEFS`/`GIANT_DEFS`/`GIANT_DECO`)一律走 `biomes.buildVegMeshes`,逐「零件列」一個 `InstancedMesh`,冠層是 `ico(r)`/`cone(r,h)` 實心團塊;勾線由 `postfx` 螢幕空間 pass 一次蓋全場,而 `gInfo.b` 的 `surfaceId` 是**逐材質**的 uniform ⇒ 一叢灌木的三團、一株樹的幹與冠、兩株相鄰的樹,彼此的深度落差全部被二階差分畫成黑邊(使用者說的「一堆黑多邊形」)。要改成兩件事:①葉冠改成**面向相機的葉片卡叢**(視域空間展開,任何角度都給鋸齒冠緣);②「同一棵樹是一個東西」改成**群組剪影** —— surfaceId 由逐材質擴充成**逐株**(同一株的幹/枝/冠共用一號)、材質帶一個 `INK_CLASS.GROUP` 類別碼,勾線 pass 在「五格同號且其中有 GROUP」時**整格早退**。關鍵取捨:深度統一 MUST 是**線的訊號**(`gInfo`)而不是真的 depth buffer —— 寫 `gl_FragDepth = 樹心` 會同時打壞 z-test(樹幹/穿過樹冠的機體)、關掉 early-Z(葉片卡正是最壞的高重疊 alpha-test 負載)、並讓景深/遠處淡出/空氣透視把整叢樹當成同一個距離。佈局數學(`giantCrownR` 冠幅 / `vegSpan` 擺幅 / 淨空 / 碰撞 / 羞避)**一格不動**:它們只讀保險絲 `p.g`,卡片是第三個「畫什麼」的解析結果,與 `p.g` 無關。

## 縫

### 畫什麼:列的解析(保險絲 g / 庫節點 lib / 葉片卡)
`public/js/biomes.js:1039`

現行:
```js
  const whole = def.whole;
  const rows = (whole && whole.every((w) => partGeo(w) !== w.g)) ? whole : def.parts;
  const meshes = [];
  ...
  rows.forEach((part, pi) => {
    const sk = vegSoftKind(part);
    const mat = toonMat(seasonColor(part.key, part.c, season),
      sk ? { soft: { k: sk, span, base: part.y || 0, sy: part.sy || 1 } } : {});
    // 畫的是 partGeo 解析結果(AI 零件庫 ?? 保險絲);佈局(span/冠幅)仍吃 p.g,見 partGeo 檔頭
    const m = new THREE.InstancedMesh(partGeo(part), mat, items.length);
```

**改成**: 在 `partGeo(part)` 之外加**第三個解析結果**:`leafRowGeo(type, part, pi)` —— 條件 = `vegSoftKind(part) === 'leaf'` 且 `partGeo(part) === part.g`(這一列沒有解析到庫節點)且旋鈕 `leafCard !== 'off'` 且 `pipeline._mrtCap`。回傳卡片叢 `BufferGeometry`,材質改 `toonMat(色, { soft, map: leafCardTex(), card: true, ink: 'group' })`。`rows`/`whole` 的「全有全無」規則一行不動。

### 佈局只讀保險絲(冠幅)
`public/js/biomes.js:687`

現行:
```js
function giantCrownR(def) {
  if (def._cr != null) return def._cr;
  let m = 0;
  for (const p of def.parts) {
    if ((p.y ?? 0) < def.h * 0.35) continue;
    const q = p.g.parameters || {};
    const r = q.radius != null ? q.radius : Math.max(q.radiusTop ?? 0, q.radiusBottom ?? 0);
    m = Math.max(m, Math.hypot(p.px ?? 0, p.pz ?? 0) + r * (p.sx ?? 1));
  }
  def._cr = m;
  return m;
}
```

**改成**: **一個字都不改**。卡片叢的包絡 MUST 由**同一份 `p.g.parameters`** 推導(卡片中心撒在該包絡的表面上、卡半徑 = `CARD.R_F × r_env`)⇒ 畫出來的冠幅恆 ≤ 佈局用的冠幅,兩者結構上不可能分家。`audit_siteplan` 519-523 的「冠幅由 giantCrownR 推導 / GIANT_DEFS 沒有手寫 cr 欄」照樣綠。

### 佈局只讀保險絲(擺幅分母)
`public/js/biomes.js:1009`

現行:
```js
function vegSpan(def) {
  let top = 0;
  for (const p of def.parts) {
    if (!p.g.boundingBox) p.g.computeBoundingBox();
    top = Math.max(top, (p.y || 0) + p.g.boundingBox.max.y * (p.sy || 1));
  }
  return Math.max(0.5, top);
}
```

**改成**: **一個字都不改**(讀 `p.g` 的 boundingBox)。卡片幾何的 boundingBox 比保險絲大(卡片中心落在包絡上、卡片還往外伸半張)⇒ 若誤改成讀卡片幾何,擺動權重的分母會變大 = 整片林子擺幅變小,而沒有任何錯誤訊息。反向驗證 `--break-fuse` 就是把這兩支改讀卡片幾何。

### 庫節點解析縫(卡片 MUST 排在它之後)
`public/js/biomes.js:1001`

現行:
```js
const partGeo = (p) => (p.lib && libGeo(p.lib)) || p.g;
```

**改成**: 不改。新增 `leafRowGeo()` 時**優先序 MUST 是 `lib > 卡片 > 保險絲`**(旋鈕 `auto`)—— 已入庫的 `tree/canopy_*`、`tree/*_crown_*`、`tree/bush_a09`、`tree/vleaf_a*` 是 2026-08-05/08 使用者定案的投資,`auto` 不動它們;`all` 才連庫冠簇一起換(見 blockedOn ①)。

### 軟性物質的逐列判定(葉片卡列仍是軟的)
`public/js/biomes.js:988`

現行:
```js
const SOFT_BY_VEG_KEY = { foliage: 'leaf', gleaf: 'leaf', conifer: 'leaf', grass: 'grass' };
const vegSoftKind = (part) => part.sf ?? SOFT_BY_VEG_KEY[part.key] ?? null;
```

**改成**: **不新增第二張名單**(A39):「這一列要不要改成卡片」MUST 由 `vegSoftKind(part) === 'leaf'` 推導。`audit_soft_stroke` Ⅳ 已釘住 `SOFT_BY_VEG_KEY` 出現 2 次 / `vegSoftKind(` 呼叫恰 1 次 ⇒ 卡片判定 MUST 沿用同一次呼叫的結果,MUST NOT 再呼叫一次。

### 賽璐璐補丁的 defines / uniform(卡片與群組都掛在這裡)
`public/js/toon.js:588`

現行:
```js
  const inkable = !!sk && !mat.transparent;
  if (inkable) defines.CEL_SOFT = '';
  if (sk && sk.amp > 0) {
    if (sk.axis === 'w') defines.CEL_WAVE = '';
    else {
      defines.CEL_SWAY = '';
      if (sk.axis === 'x') defines.CEL_SWAY_H = '';
    }
  }
  if (landNrm) defines.CEL_LAND_N = '';
  mat.defines = defines;
```

**改成**: 加兩個 define:`CEL_LEAFCARD`(`opts.card`)與 `CEL_SURF_A`(`opts.surfAttr`,逐實例面號)。**MUST NOT 另寫一支 `ShaderMaterial`** —— 走 `applyCelPatch` 的話 `gInfo` 宣告(`installInkInfo` 已無條件前綴到每一支含 `opaque_fragment` 的 ShaderLib)、軟性 alpha 契約(`CEL_SOFT` → `gl_FragColor.a = uSoftInk`)、世界曲面(`project_vertex` 的那一刀)**三條全部結構性繼承**;自寫材質則三條都要手接,而漏掉 `gInfo` 的代價是整批不畫且 console 一個字都沒有。⚠ 材質 MUST `transparent: false` + `alphaTest: 0.5`(`inkable` 那道閘要 `!mat.transparent`)。

### 表面類別碼(與石堆/山頭項**共用**的縫)
`public/js/toon.js:155`

現行:
```js
export const INK_CLASS = {
  NONE: 0,     // 沒有寫過(天空穹頂 / 護盾殼 / 粒子 / 招牌)—— 哨兵
  LAND: 0.5,   // 地貌:地形 + 一切貼在它上面的地被層
  HARD: 1,     // 其餘(機體 / 建物 / 道路 / 水面 / 擺件)= 舊制
};
```

**改成**: 新增 `GROUP`(群組剪影:內部不畫線、只留外輪廓)。**編碼吃序 3 §0-c 的高半位元組**(`clsIdx` 0..15,現用 0/1/2,還有 13 格空著)⇒ `GROUP = 3`,`gInfo.a = (clsIdx*16 + round(ctr*15))/255`。這一格是葉冠與「山頭/巨石/石堆」**同一個縫**:兩項都只是把自己的材質標成 `ink:'group'` + 給逐實例面號,MUST NOT 各自發明一套抑制規則。

### surfaceId 的產生(逐材質 → 可選逐實例)
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

**改成**: 檔頭那句「逐材質不是逐頂點……是刻意的降級」要改寫成「**預設逐材質;帶 `CEL_SURF_A` 時改吃逐實例屬性 `aSurfId`**」。片段端 `gInfo` 的第三分量由 `uSurfId` 改成 `#ifdef CEL_SURF_A vSurfId #else uSurfId #endif`。逐實例號 MUST 由**落點雜湊**產生(`k = hash(it.x, it.z) % 63 + 1`,`(k+0.5)/64`,避開 `LAND_SURF_ID = 0`)⇒ 同一株的幹/枝/冠(不同列、同一個 `it`)拿到逐位元相同的號,而**零共享 `rnd()` 消耗**(§2.3)。

### gInfo 寫入點
`public/js/toon.js:891`

現行:
```js
        {
          vec3 gN = normalize( normal );
          #ifdef CEL_LAND_N
          if ( dot( vLandN, vLandN ) > 1e-8 ) gN = normalize( vLandN );
          #endif
          gInfo = vec4( gN.xy * 0.5 + 0.5, uSurfId, uInkClass );
        }
```

**改成**: 第三分量改吃 `CEL_SURF_A`;第四分量改吃序 3 的半位元組打包(`uInkClass` 換成 `uInkA = (clsIdx*16 + round(ctr*15))/255`,計畫 §0-c 已量測定案:類別錯 0 筆、貢獻誤差 0.000)。**葉片卡的 `normal` MUST 是烤在幾何上的球面法線**(卡片中心 − 冠心),MUST NOT 用面向相機的面法線 —— 後者會讓整叢冠在轉頭時同時換一階明暗(賽璐璐階梯尤其明顯),而且折邊項會沿每一張卡的邊出線。

### 卡片展開的插入點(視域空間,排在 project_vertex 之後)
`public/js/toon.js:707`

現行:
```js
      .replace('#include <project_vertex>', `
        #ifdef CEL_SWAY
        {
          ...
          transformed += swD * swA;
          transformed.y -= sw * uSoftAmp * abs( swOsc ) * 0.3;
        }
        #endif
        ...
        #include <project_vertex>
```

**改成**: 在 `#include <project_vertex>` **之後**追加 `#ifdef CEL_LEAFCARD` 區塊:`mvPosition.xy += rot2(aCard.xy, aCard.z) * length(mat3(modelMatrix)*mat3(instanceMatrix))[0];` 再 `gl_Position = projectionMatrix * mvPosition;`。三條理由缺一不可:①`mvPosition` 在 three r160 的 `project_vertex` 展開後仍在 main() 的 scope 內,而 `vViewPosition = -mvPosition.xyz;` 與 `vFogDepth` 排在它之後 ⇒ 邊緣光/霧跟著走;②中心點已經在 `project_vertex` 裡過了 `worldCurve` ⇒ 卡片自動吃到世界曲面,**MUST NOT** 自己再呼叫一次(那會沉兩次);③擺動(`CEL_SWAY`)作用在**中心點**上(它排在 project_vertex 之前)⇒ 一張卡整片同相位移,不會被剪成菱形。尺寸乘 `length(mm[0])`(= `s × jr` 的水平世界縮放)而**不吃 `sy`** ⇒ 壓扁的冠(`sy` 0.34~0.8)上的卡片仍是方的。

### 程式快取鍵
`public/js/toon.js:966`

現行:
```js
  mat.customProgramCacheKey = () =>
    `cel${metal ? 'M' : ''}${wash > 0 ? 'W' : ''}${moss ? 'S' : ''}${cool > 0 ? 'C' : ''}${paint ? 'P' : ''}${paint?.face ? 'G' : ''}${paint?.flat ? 'F' : ''}${soft ? `Q${soft.k}${inkable ? 'I' : ''}` : ''}${landNrm ? 'L' : ''}${rim}`;
```

**改成**: MUST 併入 `card`(`CEL_LEAFCARD`)與 `surfAttr`(`CEL_SURF_A`)兩個旗標。漏掉的症狀:defines 不同卻共用同一支已編譯 program ⇒ 有些冠層整叢的卡片塌成一個點(四個角都是中心),而 three 不會報錯。

### 勾線 pass 的五格資訊取樣(群組剪影早退掛在這裡)
`public/js/postfx.js:534`

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
              smoothstep( NRM0, NRM1, nrm ),
              step( 0.004, idv ) * ID );
          }
```

**改成**: 追加**群組早退**(`#ifdef INK_GRP`,由新旗標 `this._inkGrp` 編進來,與 `_inkMrt` 分開):`五格皆有資訊 && idv 與 |i0.b−鄰.b| 全 < 0.004 && 五格之中至少一格 cls==GROUP` ⇒ `gl_FragColor = base; return;`。**「至少一格」而不是「最近那一格」**是刻意的:樹幹(HARD)與樹冠(GROUP)共用同一株的面號,取「至少一格」就同時得到「幹內部的多邊形折邊留著、幹與冠的交界不出線」,而且省掉 5 路 argmin。哨兵門檻 `> 0.25` 隨序 3 的半位元組編碼改成 `floor(a*255+0.5) >= 16`。

### 資訊緩衝要不要配(第三個消費端)
`public/js/postfx.js:327`

現行:
```js
  _wantInfo() {
    return this._mrtCap && (visualPref('inkMrt') === 'on' || visualPref('lutSrc') !== 'none');
  }
```

**改成**: 加第三個消費端 `visualPref('inkGroup') === 'on'`。**MUST NOT 與 `_inkMrt` 合成一個旗標**(§2.1 F「地貌不出接縫」⑤ 已經為 LUT 立過同一條規矩:合成 = 開群組剪影順手把折邊勾線也打開,墨線量 2.2 倍而使用者只動了另一欄)。`_syncMrt` 的比較要跟著多一個 `wantGrp`,重建 `_inkMaterial`。

### 資訊緩衝的取樣過濾(序 3 已點名要改)
`public/js/postfx.js:307`

現行:
```js
  _mkRT(depth) {
    const w = Math.max(1, this._size.x), h = Math.max(1, this._size.y);
    const opt = {
      type: this._rtType, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter,
      depthBuffer: true, stencilBuffer: false,
    };
    const rt = depth && this._mrt
      ? new THREE.WebGLMultipleRenderTargets(w, h, 2, opt)
      : new THREE.WebGLRenderTarget(w, h, opt);
```

**改成**: `rtScene.texture[1]` MUST 設 `NearestFilter`(計畫 §0-c 的最後一條 ⚠)。今天沒事只因為 `INK.THICK = 1.0` 讓取樣落在 texel 中心;群組早退把**面號相等**當判據之後,線性內插會把相鄰兩株的 `b` 混成第三個號 ⇒ 兩株之間那條線時有時無。若序 3 已落地就不重複改。

### 旋鈕表(與石堆項共用 `inkGroup`)
`public/js/visualPrefs.js:79`

現行:
```js
  inkMrt: {
    label: '折邊勾線', def: 'off', choices: ['off', 'on'],
    choiceLabels: { off: '關', on: '開' },
    hint: '深度只看得見「前後有落差」的邊…',
  },
```

**改成**: 新增兩格:`inkGroup`(群組剪影,`off/on`,**預設 on**;葉冠與石堆同吃,MUST 只有一份)與 `leafCard`(葉片卡冠層,`off/auto/all`,**建議預設 auto**)。兩者皆 `off` ⇒ 逐位元同舊制。`leafCard` 在 `_mrtCap` 為假(WebGL1)或 `inkGroup` 關著時 MUST 自動退回 `off` —— 沒有群組早退的卡片叢是「一堆黑多邊形」的**加強版**,比舊制更糟(原則 6)。

### 樹冠羞避(確認一格不動)
`public/js/siteplan.js:340`

現行:
```js
export const CROWN = {
  GAP_M: 3.0,       // 冠緣最小間隙(m)
  GAP_F: 0.06,      // 間隙 ∝ 較矮那株的樹高
  FIT_MIN: 0.62,    // 縮冠下限(佔原體格)
  LEAN: 0.075,      // 遠離鄰冠的傾斜上限(吃既有 tx/tz 欄位)
  LEAN_R: 2.2,      // 傾斜的感應半徑倍率(× 自身冠幅)
};
```

**改成**: **一個字都不改。** `planShyGrove` 吃的 `cr` 來自 `giantCrownR(def)`(讀 `p.g.parameters`),`h` 來自 `def.h`,兩者與「畫出來的是團塊還是卡片」無關。`siteplan.js` 是零 THREE 的純幾何規則層,葉片卡連 import 都碰不到它。驗收面 = `audit_siteplan` Ⅲ 與 `audit_object_joints --seeds 8` 逐項不動。

### 實例變換(確認一格不動)
`public/js/xform.js:106`

現行:
```js
export function vegPartXform(part, it) {
  const s = it.s ?? 1;
  const qi = quatMul(quatFromEuler(0, it.ry || 0, 0), quatFromEuler(it.tx || 0, 0, it.tz || 0));
  const off = quatApply(qi, [(part.px || 0) * s, (part.y || 0) * s, (part.pz || 0) * s]);
  const { jr, spin } = partJitter(
    partId(part.y, part.px, part.pz), it.dj,
    (part.key ? 0.18 : 0.08) * (part.j || 1),
    !(part.px || part.pz),
  );
```

**改成**: **一個字都不改**(A27)。卡片叢是「這一列的幾何」,實例矩陣照樣由 `vegPartXform` 給 ⇒ `ry`/`tx`/`tz`/`jr`/`spin` 逐位元同舊制,`audit_object_joints` 驗的是同一份數學。⚠ `partJitter.jr`(水平半徑只增不減)會等比放大卡片叢的世界尺寸,那是既有通道,合法。

### 卡片排列規則(新縫,零 import;`wallpanel.js` / `edgewall.js` 同型)
`public/js/leafcard.js:1`

現行:
```js
(新檔)export const CARD = { R_F, COVER, N_MIN, N_MAX, JIT };
export function cardEnvelope(parameters) { … }   // 由 p.g.parameters 推導(球/錐/柱)
export function cardCount(env) { … }             // COVER × 包絡面積 ÷ 卡面面積,夾在 [N_MIN, N_MAX]
export function planCards(env, rnd) { … }        // Fibonacci 格點 + 局部抖動 → [{cx,cy,cz,nx,ny,nz,hr,rot}]
```

**改成**: 新建。**零 THREE、只 import `rng.js`**(同 `edgewall.js`/`flags.js`/`wallpanel.js` 的紀律)⇒ 卡片外廓與張數在 Node 端算得出來,這是 `audit_leaf_card` 能離線驗真品的唯一理由。`rnd` 由呼叫端注入(`mulberry32(hash(type, rowIndex))`)⇒ **零共享 `rnd()` 消耗**。張數 MUST 由 `p.g.parameters` 推導(與 `giantCrownR` 同一份參數),MUST NOT 逐型手寫張數。幾何組裝(`BufferGeometry` + `aCard` 屬性)住 `biomes.js`。

## 寫入檔案
- `public/js/leafcard.js` (create) — 卡片叢的排列規則唯一縫(零 THREE、只 import rng.js);遊戲端與 audit_leaf_card 同吃一份定義
- `public/js/biomes.js` (edit) — buildVegMeshes 加第三個解析結果(卡片幾何)+ 逐株 aSurfId 屬性 + 卡片貼圖;VEG_DEFS/GIANT_DEFS 零件表**不動**
- `public/js/toon.js` (edit) — INK_CLASS.GROUP、CEL_LEAFCARD/CEL_SURF_A 兩個 define、gInfo 第三/第四分量、customProgramCacheKey。⚠ 與序 3(§0-c 打包)及石堆項同檔
- `public/js/postfx.js` (edit) — 勾線 pass 的群組早退 + _wantInfo 第三消費端 + rtScene.texture[1] 改 NearestFilter。⚠ 與序 3 及石堆項同檔
- `public/js/visualPrefs.js` (edit) — 新增 inkGroup(與石堆項共用)與 leafCard 兩格旋鈕
- `tools/audit_leaf_card.mjs` (create) — 葉片卡專屬稽核:張數推導、卡片外廓 ≤ 保險絲冠幅、零共享 rnd、佈局只讀 p.g、無 MRT 必退回
- `tools/audit_cel_pipeline.mjs` (edit) — 新增 Ⅷ 段:GROUP 類別碼 + 逐實例面號 + 群組早退的原文不變式。⚠ 與序 3 及石堆項同檔(石堆項也加到 Ⅷ)
- `tools/audit_soft_stroke.mjs` (edit) — Ⅳ 段補「葉片卡列仍是軟性且 alpha 契約仍成立」(transparent:false + CEL_SOFT)
- `tools/ai3d/tri_budget.json` (edit) — 重量後更新 families.veg 的 measured_kind_tris / measured_veg_total_max(staleness ⑤ 明令);它是 intake_parts 整層總量閘的分母
- `.claude/rules/seams-render.md` (edit) — §2.1 F 新增「葉片卡冠層 / 群組剪影」一列(與『共用視覺入口』同區)
- `.claude/rules/verification.md` (edit) — 5.1(續)加 audit_leaf_card 指令;5.5 加一列『葉片卡 / 群組剪影 → 跑什麼』
- `CLAUDE.md` (edit) — §2.1 F 的主題名單加「葉片卡冠層・群組剪影」(只加主題名,全文住 seams-render.md)
- `public/js/.claude.md` (edit) — §1 檔案職責地圖新增 leafcard.js 一列
- `docs/anime_style_plan.md` (edit) — 執行紀錄追加序 7 一列(做了什麼 / 用什麼守住 / 留下什麼)

## 步驟
1. 步 0(前置,可能與序 3 撞車):確認 `gInfo.a` 是否已是序 3 的半位元組打包(`grep -n 'clsIdx' public/js/toon.js`)。**沒有** ⇒ 本項先落地計畫 §0-c 那六行(寫入 `toon.js:899`、讀取 `postfx.js:542` 的哨兵門檻、`postfx.js:725` 的 LUT 地貌分支),並把 `rtScene.texture[1]` 設成 `NearestFilter`。**已有** ⇒ 只加 `INK_CLASS.GROUP = 3`。這一步做完 `audit_cel_pipeline` / `audit_visual_prefs` MUST 全綠,`shot_scene` 13 張定場照 md5 逐張不變。
2. 步 1:`toon.js` 加 `INK_CLASS.GROUP` + `applyCelPatch` 的 `ink`(類別)與 `surfAttr` 兩個選項;`CEL_SURF_A` 走 `attribute float aSurfId; varying float vSurfId;`,片段端 `gInfo.b` 改吃 `#ifdef CEL_SURF_A vSurfId #else uSurfId #endif`;`customProgramCacheKey` 併入兩個旗標。**此時尚無消費端 ⇒ 畫面逐位元同舊制**,`audit_cel_pipeline`/`audit_gpu_lifecycle`/`audit_soft_stroke`/`audit_world_curve` MUST 全綠。
3. 步 2:`postfx.js` 加 `_inkGrp` 旗標(`_wantInfo` 第三消費端 + `_syncMrt` 的 `wantGrp` 比較 + `_inkMaterial` 的 `#ifdef INK_GRP` 早退)。`visualPrefs.js` 加 `inkGroup`(預設先設 `off` 落地、步 6 才翻 `on`)。旋鈕關著 ⇒ 逐位元同舊制。
4. 步 3:`biomes.js` 的 `buildVegMeshes` 逐株面號:`const sid = leafSurfId(it.x, it.z)`(落點雜湊 → `(k%63+1+0.5)/64`,零共享 rnd),對**該型全部列**(幹/枝/冠/裝飾)寫同一份 `InstancedBufferAttribute('aSurfId')`,材質選項 `surfAttr: true` + 葉列 `ink: 'group'`、木質列維持 `ink: 'hard'`。打開 `inkGroup` 目視:一叢灌木、一株樹的幹與冠應變成單一剪影;兩株相鄰的樹之間 MUST 仍有線。
5. 步 4:新建 `public/js/leafcard.js`(`CARD` 常數 + `cardEnvelope(parameters)` + `cardCount(env)` + `planCards(env, rnd)`)。**零 THREE、只 import rng.js**;張數 = `clamp(round(COVER × 包絡面積 ÷ (π·(R_F·r)²)), N_MIN, N_MAX)`,MUST NOT 逐型手寫。
6. 步 5:`biomes.js` 加 `leafCardTex()`(程序生成 Canvas 葉叢遮罩,`_texCache` 快取、`NearestFilter` 不必)與 `leafRowGeo(type, part, pi)`(把 `planCards` 的純資料組成 `BufferGeometry`:`position` = 卡片中心重複 4 次、`normal` = 球面法線、`aCard = vec3(角落 x, 角落 y, 旋轉)`、`uv` 四角;module-level `Map` 快取 + `markShared()`)。接進 `rows.forEach` 的 `new THREE.InstancedMesh(...)` 那一行;材質 `toonMat(色, { soft, map: leafCardTex(), alphaTest: 0.5, side: THREE.FrontSide, card: true, surfAttr: true, ink: 'group' })`。`m.castShadow` MUST 維持 `false`(陰影用的 depth 材質沒有 `CEL_LEAFCARD` ⇒ 會畫出退化四邊形)。
7. 步 6:`leafCard` 預設設 `auto`、`inkGroup` 預設設 `on`;`_mrtCap` 為假或 `inkGroup !== 'on'` 時 `leafCard` MUST 自動視為 `off`。
8. 步 7:寫 `tools/audit_leaf_card.mjs`(五段:張數推導 / 外廓 ≤ 保險絲 / 零共享 rnd / 佈局只讀 p.g / 無 MRT 必退回)+ 五支 `--break-*`;`audit_cel_pipeline` 補 Ⅷ 段;`audit_soft_stroke` Ⅳ 補兩條。
9. 步 8:量。`node tools/ai3d/measure_veg_tris.mjs --kinds` 與 `--giants`(㋓,需 playwright)重量 `measured_kind_tris` / `measured_veg_total_max`,更新 `tri_budget.json`,**再跑一次 `node tools/ai3d/intake_parts.mjs`** —— `measured_kind_tris` 是它整層總量閘的分母,不重跑就是拿舊基準放行(staleness ⑤)。同輪量幀時間(alpha-test 重疊才是真成本,不是 draw call)。
10. 步 9:文件三處(`seams-render.md` 一列、`verification.md` 兩處、根 `CLAUDE.md` §2.1 F 主題名、`public/js/.claude.md` 檔案地圖、`docs/anime_style_plan.md` 執行紀錄)。

## 稽核
- `node tools/audit_leaf_card.mjs`
- `node tools/audit_leaf_card.mjs --break-count`
- `node tools/audit_leaf_card.mjs --break-fuse`
- `node tools/audit_leaf_card.mjs --break-rnd`
- `node tools/audit_leaf_card.mjs --break-mrtgate`
- `node tools/audit_cel_pipeline.mjs`
- `node tools/audit_cel_pipeline.mjs --break-inkinfo`
- `node tools/audit_cel_pipeline.mjs --break-land`
- `node tools/audit_cel_pipeline.mjs --break-lutland`
- `node tools/audit_cel_pipeline.mjs --break-grp`
- `node tools/audit_cel_pipeline.mjs --break-surfa`
- `node tools/audit_soft_stroke.mjs`
- `node tools/audit_soft_stroke.mjs --break-ink`
- `node tools/audit_soft_stroke.mjs --break-anchor`
- `node tools/audit_soft_stroke.mjs --break-wave`
- `node tools/audit_soft_stroke.mjs --break-gust`
- `node tools/audit_visual_prefs.mjs`
- `node tools/audit_gpu_lifecycle.mjs`
- `node tools/audit_world_curve.mjs`
- `node tools/audit_object_joints.mjs --seeds 8`
- `node tools/audit_siteplan.mjs`
- `node tools/audit_beacons.mjs`
- `node tools/audit_ground_tile.mjs`
- `node tools/audit_ground_seam.mjs`
- `node tools/audit_ground_enclave.mjs`
- `node tools/audit_ground_qc.mjs`
- `node tools/audit_ground_border.mjs`
- `node tools/audit_open_tunnel.mjs`
- `node tools/audit_underpass.mjs`
- `node tools/audit_road_joint.mjs`
- `node tools/audit_world_text.mjs`
- `node tools/audit_world_edge.mjs`
- `node tools/audit_world_height.mjs`
- `node tools/audit_client_syntax.mjs`
- `node tools/audit_client_syntax.mjs --break-glsl`
- `node tools/audit_solo_boot.mjs`
- `npm run audit:net`
- `node tools/audit_ui_layout.mjs`
- `node tools/ai3d/intake_parts.mjs`
- `npm run bal`
- `node test/e2e.mjs`
- `node tools/ai3d/measure_veg_tris.mjs --kinds`
- `node tools/ai3d/measure_veg_tris.mjs --giants`
- `node tools/shot_scene.mjs --venue taroko`
- `node tools/shot_scene.mjs --venue blackforest --pref inkGroup=on --pref leafCard=auto`
- `node tools/audit_ground_drape.mjs`

## 反向驗證
- `--break-count` — 壞版: `leafcard.cardCount()` 改成逐型手寫的固定張數(繞過 `p.g.parameters` 推導) ⇒ **MUST 紅**: audit_leaf_card Ⅰ 的「張數由保險絲幾何的 parameters 推導(與 giantCrownR 同一份)」與「換一個包絡半徑張數 MUST 跟著變」兩條 MUST 紅
- `--break-fuse` — 壞版: `giantCrownR` / `vegSpan` 改讀卡片幾何(`leafRowGeo(...)` 的包圍盒)而不是 `p.g` ⇒ **MUST 紅**: audit_leaf_card Ⅳ 的「佈局數學只讀保險絲 p.g」MUST 紅;`audit_siteplan` 519-523 的「冠幅由 giantCrownR 推導」與 `audit_object_joints --seeds 8` 亦 MUST 出現位移
- `--break-rnd` — 壞版: `planCards` 的抖動改吃呼叫端傳進來的**共享** `rnd`(而不是自己那支 `mulberry32`) ⇒ **MUST 紅**: audit_leaf_card Ⅲ 的「卡片排列零共享 rnd 消耗(同一份序列跑兩次逐位元相同、且後續散布序列不推移)」MUST 紅
- `--break-mrtgate` — 壞版: `leafCard` 的 `_mrtCap` / `inkGroup` 閘拿掉(WebGL1 或群組剪影關著時照樣畫卡片) ⇒ **MUST 紅**: audit_leaf_card Ⅴ 的「沒有第二張附件時 MUST 退回保險絲團塊」MUST 紅
- `--break-grp` — 壞版: `postfx._inkMaterial` 的群組早退整段刪掉(`INK_GRP` 區塊) ⇒ **MUST 紅**: audit_cel_pipeline Ⅷ 的「五格同號且含 GROUP ⇒ 早退」原文條 + 行為直測(合成五格 info 餵進抽出來的判定式)MUST 紅
- `--break-surfa` — 壞版: `toon.js` 的 `CEL_SURF_A` 拿掉(`gInfo.b` 恆吃逐材質 `uSurfId`) ⇒ **MUST 紅**: audit_cel_pipeline Ⅷ 的「逐實例面號:同一株的各列拿到同號、相鄰兩株拿到不同號」MUST 紅(退化成整片林子同一號 ⇒ 兩株相鄰的樹之間永遠沒有線)
- `--break-ink(既有)` — 壞版: 軟性倍率當成 1 ⇒ **MUST 紅**: audit_soft_stroke Ⅰ MUST 紅(確認葉片卡列仍在軟性契約裡,不是被新材質繞過去了)
- `--break-inkinfo(既有)` — 壞版: 模擬新增進場景的 ShaderMaterial 卻忘了宣告 gInfo ⇒ **MUST 紅**: audit_cel_pipeline Ⅵ MUST 紅 —— 同時證明本項**沒有**新增自寫 ShaderMaterial(掃到的支數應與改制前相同)

## 會靜默壞掉的地方
- **深度統一寫成真的 `gl_FragDepth`**:z-test 當場錯亂(樹心之前的機體被樹冠蓋住、之後的反而蓋住樹冠),early-Z 關掉讓高重疊 alpha-test 變成填充率災難,而同一張深度貼圖還餵 `_dofMaterial` 的 `lin()`、勾線的 `FADE0/FADE1` 遠處淡出、空氣透視 ⇒ 整叢樹被當成同一個距離對焦與淡出。這些**全部沒有錯誤訊息**,只表現成「遠處的樹糊得很奇怪」。本規格明令不走這條路。
- **卡片叢沒有群組早退時比舊制更糟**:一張卡的 alpha-test 邊界對深度二階差分而言就是一條真的輪廓 ⇒ 12~24 張卡 = 12~24 個黑色多邊形。所以 `leafCard` MUST 掛在 `inkGroup` 與 `_mrtCap` 之下,WebGL1 逐位元退回團塊(原則 6)。
- **`gInfo.b` 的 `LinearFilter`**:群組早退把「面號相等」當判據,而 `rtScene.texture[1]` 現在是 `LinearFilter`。今天沒事只因為 `INK.THICK = 1.0` 恰好落在 texel 中心;任何人動 `THICK`(或裝置的取樣捨入不同)就會在兩株之間插出一個不存在的號 ⇒ 那條線時有時無,而每一條斷言照樣全綠。
- **`customProgramCacheKey` 漏掉新旗標**:three 只認那把鑰匙 ⇒ 有些冠層拿到沒有 `CEL_LEAFCARD` 的那一支 program,四個角都落在中心 = 整叢卡片塌成一個點(零面積,畫面上只是「那幾棵樹沒有葉子」)。
- **`castShadow` 被人打開**:陰影那一路走的是 `MeshDepthMaterial`,沒有 `CEL_LEAFCARD` 補丁 ⇒ 卡片在陰影圖裡是退化四邊形,樹影整片消失而主畫面完全正常。
- **`transparent: true` 被誤設**:`applyCelPatch` 的 `inkable = !!sk && !mat.transparent` 會把細勾線那一半關掉,而且 `gl_FragColor.a = uSoftInk` 寫下去就變成把冠層的不透明度改成 0.3。必須 `transparent: false` + `alphaTest`。
- **`tri_budget.json` 的分母被靜默放寬**:`measured_kind_tris` 是 `intake_parts` 整層總量閘的分母(被取代的現值)。葉片卡把逐型現值改大 ⇒ 「消耗」變小 ⇒ 那道閘**變鬆**,而紅字與真正的三角形成本無關。步 8 的重量與重跑 `intake_parts` 不是可選的。
- **逐株面號的量化撞號**:64 階 ⇒ 相鄰兩株約 1.6% 的機率同號 = 那一對之間少一條線。既有檔頭已認可「撞號 = 少一條線,不是壞掉」,但灌木 1892 叢的密度下會零星可見。
- **填充率而不是 draw call**:draw call 完全不變(換的是列的幾何不是列數),三角形也只有 ±數萬。真成本是 alpha-test 的重疊繪製,而 `RES_GOV` 會把它表現成「解析度自己降了」而不是掉幀 ⇒ 必須直接量幀時間,不能只看 FPS。
- **其餘葉子消費端沒有一起改**:`ground.js` DETAIL_DEFS 的 `bush`/`roadtree`(`sf: 'leaf'`,line 1451/1455)、`biomes.js` 的 `roofBushes`/`roofTreeList`(line 8879-8880)、`siteplan.js` 的 `CIVIC_TREES`。本項刻意只動 `buildVegMeshes`;症狀是「同一張圖上林子裡的樹是卡片、路邊行道樹是團塊」。要不要一起收是下一輪的事,MUST 寫進執行紀錄。
- **`auto` 之下同一株混著卡片與庫冠簇**(birch / shrub / mangrove 各有一列帶 `lib:`、其餘沒有;GIANT_DEFS 的 cone 冠層一律沒有 `lib:` 而 ico 冠簇有)。群組早退把它們之間的線全部收掉 ⇒ 線上看不出混用,只有剪影的鋸齒程度不同。仍 MUST 由 ㋓ 定裝照人眼判。

## 逐位元中性

"**旋鈕 `leafCard: 'off'` + `inkGroup: 'off'` ⇒ 逐位元同舊制**,而且是結構性的:①`leafRowGeo` 在 `off` 時根本不被呼叫,`new THREE.InstancedMesh(partGeo(part), …)` 那一行走原路;②`aSurfId` 屬性不掛、`CEL_SURF_A` 不定義 ⇒ `gInfo.b` 仍是 `uSurfId`;③`_wantInfo()` 多出來的那一項為假 ⇒ MRT 配置與 `_inkMaterial` 的著色器原文與改制前逐字相同。怎麼證明(四條,全部要):(a) `node tools/shot_scene.mjs --venue taroko` 與 `--venue blackforest` 兩組定場照 **md5 逐張與改制前相同**(與 2026-08-13 那一輪「13 張定場照逐位元相同」同一個手法);(b) `npm run bal` 與 `node test/e2e.mjs` **逐項不動** —— `data.js`/`sim.js`/`server/**` 一行未改,動了就是純表現層漏到判定上;(c) `audit_object_joints --seeds 8`、`audit_siteplan`、`audit_beacons`、`audit_ground_*` 逐項不動(佈局只讀 `p.g`、卡片零共享 `rnd()` ⇒ 散布序列不得推移);(d) 真 GPU 直測 `gl.getError() === 0`,且 `inkGroup` 開→關→再開之後畫面**逐位元還原**(同 `audit_cel_pipeline` Ⅵ 對 MRT 的 A/B 手法)。⚠ 序 0 若順帶落地 §0-c 的半位元組編碼,那一步本身也 MUST 是逐位元中性的(計畫已量測:類別錯 0 筆、貢獻誤差 0.000);把它與本項的旋鈕分開驗,否則兩件事的差異混在一起。旋鈕打開之後**明知不中性**(序 7 在計畫的表上就是「否」)⇒ 步 0 之前 MUST 先拍一組基準定場照。"

## 卡在
- **① 葉片卡要不要取代已入庫的 AI 冠簇節點(使用者裁決)。** `tree/canopy_a5/b5/c6/…`、`tree/bl_crown_a`、`tree/cf1~4_crown_a`、`tree/bush_a09`、`tree/vleaf_a12/a20` 是 2026-08-05 / 08-08 使用者定案「走零件庫」的產物,吃掉了整層成長額度的 92.4%。計畫 ②-1 說葉冠改卡片,兩者正面衝突,而退場 = 對既有定案的『補完』(§0 原則 10)。本規格給三態旋鈕:`off` / **`auto`(建議預設:只換解析不到庫節點的葉列,`intake_parts` 的分母與 `node_cap` 的 `+20` 完全不動)** / `all`(連庫冠簇一起換,庫節點就此變成孤兒)。**選哪一個 MUST 由使用者定案。**
- **② 計畫寫『一支新的葉片 ShaderMaterial』,本規格改走 `applyCelPatch` 的 define(`CEL_LEAFCARD`)。** 這是對計畫字面的偏離,理由是走 ShaderLib 材質可以**結構性繼承**三條契約(`gInfo` 宣告由 `installInkInfo` 無條件前綴、軟性 alpha 由 `CEL_SOFT`、世界曲面由 `project_vertex` 的那一刀),而自寫 `ShaderMaterial` 三條都要手接 —— 計畫自己就在括號裡標了「MUST 宣告 gInfo,否則整批不畫」。使用者已定案『衝突時以計畫為主』⇒ 這一條請明確放行或否決。
- **③ 序 3(①-1 `outlineContribution` / §0-c 打包)由誰落地。** 本項的 `INK_CLASS.GROUP` 要吃 `.a` 高半位元組那 13 個空的類別碼。序 3 在計畫的執行紀錄裡是「⏸ 已量測、未落地」。若序 3 由另一個 agent 同輪落地 ⇒ 本項只加 `GROUP = 3` 與 `INK_GRP` 早退;若沒有 ⇒ 本項的步 0 要順手落地那六行,**`public/js/toon.js` / `public/js/postfx.js` / `tools/audit_cel_pipeline.mjs` 三個檔案會與序 3 的 agent 撞車**,需要調度定序。
- **④ 與『山頭/巨石/石堆』那一項共用的縫,兩邊 MUST 同一份。** 共用的是:`toon.js` 的 `INK_CLASS.GROUP` + `applyCelPatch` 的 `ink`/`surfAttr` 兩個選項、`postfx.js` 的群組早退、`visualPrefs.js` 的 `inkGroup` 旋鈕、`audit_cel_pipeline` 的 Ⅷ 段。石堆那一項只需要「把自己的材質標成 `ink:'group'` + 給逐堆面號」,**MUST NOT 另外發明一套抑制規則或第二根旋鈕**(兩份名單遲早分家,而症狀是『樹的內部線收掉了、石堆的沒有』)。誰先落地誰建這五處,後者只加自己的消費端。
- **⑤ 樹幹的多邊形折邊線要不要一起收掉。** 使用者追加語是「一棵樹在畫面上是一個東西」,字面推論是連樹幹的 7 邊形折邊也收掉。本規格的取捨是:**木質列標 `ink:'hard'`、葉列標 `ink:'group'`**,而早退的判據是「五格同號**且至少一格是 GROUP**」⇒ 幹的內部折邊留著(低多邊形樹幹靠它讀成圓柱)、幹與冠的交界不出線(那才是『一個東西』的那條)。若使用者要的是連樹幹折邊也收,把木質列也標 `group` 即可(一行),但 110m 神木近距離會讀成一根沒有轉折的實心柱 —— **這是取捨不是 bug,請裁決。**
- **⑥ `?leaf=0` 這一類 killswitch 的形式。** 既有慣例有兩套(`?curve=0`/`?morph=0`/`?gait=0` 的 URL 參數,與 `visualPrefs` 的旋鈕)。本規格走旋鈕(因為 `inkGroup` 要與石堆項共用、而且要進設定頁);若使用者希望同時有 URL killswitch(方便 `shot_scene` 對照),再加一格。
