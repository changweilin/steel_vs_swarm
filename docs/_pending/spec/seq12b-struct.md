# 序 12b / ⑨ 立體結構重新渲染(材質 / MRT / 貢獻 / surfaceId / emissive 五件)  (key: seq12b-struct)

## 摘要

現況比計畫預期的好:`buildRoads()`(biomes.js 5411~6831)裡**19 支結構材質全部走 `envMat()`/`toonMat()`**,一支自寫 ShaderMaterial 都沒有 ⇒ 它們的 `gInfo` 由 `applyCelPatch` 的第 899 行無條件寫出,⑨-1(改走新版 `cel()`)與 ⑨-2(MRT 宣告)**在程式碼上都是零改動**,只需要一道「結構區塊內不得出現原生材質」的守門稽核把它釘住。真正要動手的是三件:⑨-3 把 `outlineContribution` 逐結構授權(需要在 `applyCelPatch` 開一個 `contrib` 選項 + 逐材質授權表)、⑨-4 讓坑門混凝土家族(額牆/翼牆/collar/明隧道頂板)共用一個具名 `surfaceId`(現制四支各自抽 `nextSurfId()` ⇒ 同一座構造物內部反而會出線,而混凝土↔山坡那條線靠 LAND=0 早就會出),⑨-5 把洞口警示條紋補 `emissive`(洞內燈具 `ceilLamps` 已有),並用稽核釘死「底色逐位元不動、只准加 emissive」。⚠ 計畫 ⑨ 的「MUST 原封不動」表與 ⑨-3 的授權清單裡有六個名字**在本儲存庫不存在**(`buildCribs`/`cribColumn`/`quadTo`/`boreProfile`/`boreClearance`/`sweptSolid`,以及對應的法枠工格網、待避所、橋面伸縮縫、欄杆立柱幾何)—— 那些是 sakura 的詞彙,本專案的欄杆是一條連續緞帶而不是立柱,必須改用實際幾何對號入座,不得為了湊清單新增幾何(那會變成新增世界內容 ⇒ §2.3 的 rnd() 問題)。整項依賴序 3(`outlineContribution` 編碼)與序 4(雜訊斷線)先落地,序 3 目前是「⏸ 已量測、未落地」。

## 縫

### 結構材質唯一縫(⑨-1 / ⑨-2 是零改動的證明)
`public/js/biomes.js:6431`

現行:
```js
    const m = new THREE.Mesh(geo, envMat(b.color, {
      map: roadTex(b.tex), vertexColors: true, wash: 0.55, cool: 0.5, rim: 0,
      polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2,
    }));
// …(6421~6805 共 19 支材質,全部是 envMat()/toonMat(),
//    無任何 new THREE.Mesh*Material / ShaderMaterial)
```

**改成**: **一行都不改。** 實測 `buildRoads()`(5411)到 `planTowerBridgePads()`(6872)之間只有 19 處材質建構,全部是 `envMat()`(18 支)與 `toonMat()`(1 支 = 天花燈)⇒ 兩者都經 `applyCelPatch`,`gInfo` 由 toon.js:899 無條件寫出。⑨-1「改走新版 cel()」因此是序 12 改 `toon.js` 的**推論**,結構端零改動;⑨-2「MUST 宣告 gInfo」在今天已成立。要新增的是**守門**:新稽核逐字切出這一段原文,斷言 `new THREE\.(Mesh[A-Za-z]*|Raw|)(Shader)?Material\(` 出現 0 次(反向驗證 `--break-rawmat`)。⚠ 若序 12b 的實作者為了洞內照明新寫任何 ShaderMaterial,`audit_cel_pipeline` Ⅵ 的既有掃描會接住它(該段對 public/js/*.js 逐檔比對 ShaderMaterial 數 vs INK_INFO_DECL 數),MUST NOT 在新稽核裡重寫第二份那個掃描。

### surfaceId 指派唯一縫(⑨-4 的落點)
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

**改成**: 把「具名共用 id」從一個常數升成**一張表**,`LAND` 那一格逐位元不動:`const SURF_ID = { LAND: 0, CONCRETE: 1 };`(`LAND_SURF_ID` 保留為 `SURF_ID.LAND` 的別名 export 以免動到 `audit_cel_pipeline` Ⅶ 的 `/const LAND_SURF_ID = 0;/` 樣式 —— 那條斷言現在是綠的,MUST 維持)。`CONCRETE = 1` 的安全性是**推導**不是挑的:`nextSurfId` 最大值 0.9921875 ⇒ 與 1.0 差 0.0078 > `INK_MRT` 的 0.004 門檻;8bit RT 上 (k+0.5)/64 的相鄰量階差 3.98 個量子,兩兩仍 > 0.004。**MUST NOT 手寫 1.0 當魔數**,要由 `Math.ceil(63.5/64 * 64) / 64` 這類推導或至少由註解釘住「> nextSurfId 值域上界 + 門檻」這條不等式。

### applyCelPatch 的選項表(⑨-3 / ⑨-4 的入口)
`public/js/toon.js:567`

現行:
```js
function applyCelPatch(mat, { metal = false, rim = 0.22, wash = 0, moss = null, cool = 0, paint = null, tint = 'mech', preview = false, soft = null, bands = 3, land = false, landNrm = false } = {}) {
```

**改成**: 追加兩個選項,**MUST 排在 `bands` 之後**(`audit_visual_prefs` 以 `/applyCelPatch\(m, \{ metal: !!celMetal, rim, soft, bands\s*[,}]/` 與 `/tint: 'env', preview, soft, bands\s*[,}]/` 兩條樣式釘住 toonMat/envMat 的呼叫形狀,插在 bands 之前會讓那兩條紅字而理由是假的):①`contrib = 1` —— `outlineContribution`,MUST 量化成 `k/15`(k ∈ 0..15,§0-c 的半位元組編碼只有 16 階,寫 0.533 會在編碼端被 round 成 8/15 而稽核比對值對不上);②`surf = null` —— 具名 surfaceId 覆寫(給 `SURF_ID.CONCRETE`)。`envMat`(1000)與 `toonMat`(985)兩支各自把它們**原樣轉下去**;`toonMat` MUST NOT 吃 `surf`(同 `audit_cel_pipeline` Ⅶ 對 `land` 的那一條:機體之間的線是要的),`contrib` 則兩支都要有(機體那半留給序 4 的雜訊斷線用)。

### surfaceId 定案處(⑨-4 的一行)
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

**改成**: 改成三分支:`if (land) … SURF_ID.LAND; else if (surf != null) mat.userData.celSurfId = surf; else if (celSurfId == null) … nextSurfId();`。順序 MUST 是 land → surf → nextSurfId(land 仍最優先,否則有人同時傳兩個時地貌會掉出共用號)。`uInkClass` 一行**不動** —— 結構仍是 `INK_CLASS.HARD`(它不是地貌,LUT 的地貌分支不該收它)。⚠ `contrib` 是**逐材質的 uniform**(`shader.uniforms.uInkContrib = { value: contrib }`),MUST NOT 變成 define。

### gInfo 寫入處(⑨-3 的落點;序 3 已定案編碼)
`public/js/toon.js:887`

現行:
```js
        // 勾線資訊緩衝(檔頭那一段):覆寫 opaque_fragment 寫下的「沒有資訊」。
        {
          vec3 gN = normalize( normal );
          #ifdef CEL_LAND_N
          if ( dot( vLandN, vLandN ) > 1e-8 ) gN = normalize( vLandN );
          #endif
          gInfo = vec4( gN.xy * 0.5 + 0.5, uSurfId, uInkClass );
        }
```

**改成**: `.a` 改成序 3 已定案的半位元組打包(anime_style_plan.md §0-c 編碼定案,真 GPU RGBA8 MRT 實測「類別錯 0 筆、貢獻誤差 0.000」):`gInfo.a = ( uInkClass16 * 16.0 + floor( ctr * 15.0 + 0.5 ) ) / 255.0;`,其中 `uInkClass16` ∈ {0,1,2} 對應 NONE/LAND/HARD、`ctr` = `uInkContrib`(結構端)或 `uInkContrib * step(noise, …)`(序 4 的雜訊斷線)。⚠ **這一行由序 3 改,序 12b 只是它的消費端** —— 若序 3 尚未落地,序 12b 的 ⑨-3 無處可寫;見 blockedOn。⚠ `audit_cel_pipeline` Ⅶ 目前以 `/gInfo = vec4\( gN\.xy \* 0\.5 \+ 0\.5, uSurfId, uInkClass \);/` 逐字釘住這一行,序 3 落地時 MUST 同步改那條斷言的期望值(不是隨 `--break-*` 改,是隨真品改)。

### customProgramCacheKey(最容易靜默壞掉的一條)
`public/js/toon.js:966`

現行:
```js
  mat.customProgramCacheKey = () =>
    `cel${metal ? 'M' : ''}${wash > 0 ? 'W' : ''}${moss ? 'S' : ''}${cool > 0 ? 'C' : ''}${paint ? 'P' : ''}${paint?.face ? 'G' : ''}${paint?.flat ? 'F' : ''}${soft ? `Q${soft.k}${inkable ? 'I' : ''}` : ''}${landNrm ? 'L' : ''}${rim}`;
```

**改成**: **只有 define 要進鑰匙,uniform 不要**:`contrib` 是 uniform ⇒ MUST NOT 進;序 4 的雜訊斷線若做成 `defines.CEL_INK_BREAK`,那個旗標 MUST 進(不進的話「有些結構的線會斷、有些不會」,而那是 three 只認這把鑰匙的直接後果 —— 與註解裡「有些樹會動、有些不會」同一個坑)。同理 `mat.userData.celOpts`(600)MUST 記下 `contrib` 與 `surf`,否則 `applyPaint()`(975)事後重注入時會把它們掉掉。

### 坑門混凝土家族(⑨-4 的四個呼叫端)
`public/js/biomes.js:6743`

現行:
```js
      // 材質沿用門洞混凝土(同一座洞口的額牆/翼牆/collar 是同一構造物)。DoubleSide:collar 恆在
      // 管身**之外**(外環在地形上、內環貼管壁),幾何上不可能橫跨斷面 ⇒ 不會重演「暗面 DoubleSide
      // = 出洞黑牆」那一坑;反過來單面若有一片繞行判錯就是一個看穿的破洞,取水密不取單面。
      const cm = new THREE.Mesh(cgeo, envMat(0x9a958c, { wash: 0.4, cool: 0.45, side: THREE.DoubleSide,
        polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 }));
```

**改成**: 四處各補 `surf: SURF_ID.CONCRETE`:collar(6746)、明隧道外露頂板 `galRoof`(6522)、門洞額牆/翼牆 `wallM`(6757)、以及與它們同色同構造的洞口 collar 那一支。**理由是程式碼註解自己寫的**:「同一座洞口的額牆/翼牆/collar 是同一構造物」,而現制四支各呼叫一次 `envMat` ⇒ 各抽一個 `nextSurfId()` ⇒ `INK_MRT.ID` 的 `step(0.004, idv)` 會在**同一座構造物內部**畫線。混凝土↔上方山坡那條線其實**今天就會出**(地形是 `land: true` ⇒ id = 0,差 ≥ 0.0078),所以 ⑨-4 的真正內容是「把線收窄到只落在構造物外緣」,不是「讓線出來」。⚠ 只收這四支;隧道側牆 `wall`(6507)、天花 `ceilSegs`(6576)、橫樑 `beams`(6582)、柱列 `galCols`(6544)、緣石帶 `cope`(6535)**維持 `nextSurfId`** —— 它們是洞內互相該出線的構件(⑨-3 說「洞內只有輪廓在說話」)。要不要把它們也收進同一族是設計取捨,列在 risks。

### 洞口警示條紋(⑨-5 唯一真正缺 emissive 的一處)
`public/js/biomes.js:6784`

現行:
```js
    // 洞口警示條紋(黃黑相間,貼在洞頂上緣):標示通行淨空邊界
    const stripeN = 8, stripeSpan = W - 1.6, stripeW = stripeSpan / stripeN;
    for (let si = 0; si < stripeN; si++) {
      const seg = new THREE.Mesh(new THREE.BoxGeometry(stripeW * 0.94, 0.5, 0.15),
        envMat(si % 2 === 0 ? 0xf2c230 : 0x1a1a1a, { wash: 0.2, cool: 0.2 }));
      seg.position.set(-stripeSpan / 2 + stripeW * (si + 0.5), H2 - 1.0, 0.76);
      g.add(seg);
    }
```

**改成**: 黃色那一格補 `emissive: new THREE.Color(0x6a5210), emissiveIntensity: 0.55`(黑格不補 —— 反光帶的語意就是「亮的那一半」)。**底色 0xf2c230 / 0x1a1a1a MUST 逐位元不動** —— 計畫 ⑨-5 引的既有定案是「不亮的凹處要 emissive,**不是換淺一點的顏色**」(自動販賣機取出口那一課),而換底色的症狀是白天也整條發白。⚠ 這兩個材質是**逐 stripe 各建一支**(迴圈內 `envMat`)= 每座洞口 8 支材質、48 座洞口最多 384 支 ⇒ 落地時順手把兩支材質提到迴圈外(`const stripeLit = envMat(0xf2c230, …)`、`const stripeDark = envMat(0x1a1a1a, …)`),這同時解掉 `nextSurfId` 64 槽被 384 支條紋沖爛的問題(見 risks)。

### 洞內照明(⑨-5 已存在的那一半)
`public/js/biomes.js:6596`

現行:
```js
  // ---- 地下道天花照明:每支橫樑下掛一具長條燈(常亮 emissive)----
  if (ceilLamps.length) {
    const lM = new THREE.InstancedMesh(new THREE.BoxGeometry(0.5, 0.14, 1.6),
      toonMat(0xece7d2, { emissive: new THREE.Color(0xffe9a0), emissiveIntensity: 0.9 }), ceilLamps.length);
```

**改成**: **燈具本身不改**(已經是 emissive、已經是 InstancedMesh、已經涵蓋山體隧道/地下道/明隧道 —— 產生點 6031~6036 在 `if (strc && total > 8)` 之內,`covS(s)` 只挑覆蓋段)。⑨-5 要在這裡加的只有 `contrib: 1`(燈具的剪影是洞內最需要的一條輪廓)。⚠ **MUST NOT 為了「洞內太暗」去調高 `emissiveIntensity` 或把牆的底色調亮** —— School B 下洞內整片落在暗帶是**預期**,計畫的處方是「亮的東西自己亮」(燈具 + 反光帶)加上 ⑨-3 的 contrib = 1(輪廓在說話),不是整體提亮。稽核 MUST 把九個底色(0x8f8b83 / 0x4a4d47 / 0x9a958c / 0x938e85 / 0x8b8880 / 0x0e1013 / 0xf2c230 / 0x1a1a1a / 0xece7d2)逐值釘死。

### 結構足跡 keep-out 名冊(⑨ × §0-a,交出去給序 13/14)
`public/js/biomes.js:5376`

現行:
```js
          corridors.push({ x1: run[i][0], z1: run[i][1], x2: run[j][0], z2: run[j][1], hw, kind, cy });
// …(5403)
          blockArea(blocked, x, z, hw + (kind === 'tun' ? STRUCT_CLEAR_PAD : 4));
// …(8321)
  const gradeCorridors = [
    ...markGradeCorridors(roadInput, terrain, center, blocked, laneMode),
    ...markGradeCorridors(laneWetWays, terrain, center, blocked, true),
  ];
// …(9904)
  group.userData.gradeCorridors = gradeCorridors;
```

**改成**: **答案:名冊已經有一份,叫 `gradeCorridors`,不需要新開。** 計畫寫的「與 `hillAt` 的 keep-out 同一份名冊」在本儲存庫**沒有 `hillAt`**;實際對應物是 `markGradeCorridors()`(5323~5409),它一趟做兩件事:①回傳逐段 `{x1,z1,x2,z2,hw,kind('tun'|'bridge'),cy}` 的走廊清單(隧道全段 + 橋樑走廊),②同時以 `blockArea(blocked, x, z, hw + STRUCT_CLEAR_PAD)`(`STRUCT_CLEAR_PAD = max(7, UND.COPE, TUN.GAL_CLEAR_W)`,4530)把足跡打進散布用的 `blocked` 格。下游三個消費端:`buildRoads` 兩處呼叫端(9819 / 9827,`audit_open_tunnel` Ⅲ-e 釘住兩處都要傳)、`group.userData.gradeCorridors`(9904)、`main.js:2171` 上傳伺服器(`slice(0, 2400)`)。⇒ 序 13/14 的切面 keep-out MUST 直接吃 `gradeCorridors`,**MUST NOT** 另寫第二份足跡推導;若切面需要「明隧道柱列帶」的額外寬度,那個數字也已經在 `STRUCT_CLEAR_PAD` 裡(`TUN.GAL_CLEAR_W = 9`)。缺口只有一個:`gradeCorridors` 逐段帶 `hw` 但**不帶柱列側別**(`gal` 遮罩只進 `tunnelSegs`),若切面要精確避開柱列那一側,要從 `tunnels`(9904 同批)的第 7 欄取。序 12b **不改這一支**,只把它查清楚交出去。

### 稽核原文錨點(改結構區塊前 MUST 先確認的邊界)
`tools/audit_open_tunnel.mjs:258`

現行:
```js
const B0 = src.indexOf('        const floorsV = cum.map((s) => tFloorAt(s));');
const B0e = src.indexOf('        for (let i = 0; i < nP - 1; i++) {', B0);
const C0 = src.indexOf('        // facade 落地基準', B0);
const B1 = src.indexOf('        // 橫樑 + 天花燈', C0);
// …(397)
const S0 = src.indexOf('      if (strc && total > 8) {');
const S1 = src.indexOf('      // ---- 高架橋外觀', S0);
```

**改成**: **不改，只確認。** `audit_open_tunnel` / `audit_underpass` 用字面錨點切 biomes.js 原文丟進沙箱執行,五個錨點的實際行號是:5846(`floorsV`)、5930(`facade 落地基準`)、6030(`橫樑 + 天花燈`)、5814(`if (strc && total > 8) {`)、6073(`高架橋外觀`);`audit_road_joint` 另切 5411(`function buildRoads(`)→6316(`路口:斑馬線`);`audit_road_bed` 切 8288(`if (terrain.gradeRoadBeds …`)。⇒ **⑨ 要動的材質/Mesh 發射區塊 6421~6805 完全落在所有沙箱切片之外**,只有 `audit_open_tunnel:406` 的 `src.slice(src.indexOf('if (galCols.length)'))`(6542 → EOF)會掃到,而它只斷言 `!/cols\.push\([^)]*gal/i` ⇒ 加材質選項不咬。**MUST NOT 移動或改寫上列七個錨點字串**(含縮排與全形標點)—— 改到的症狀是沙箱切出空字串、整支稽核以無關的 ReferenceError 爆掉。

### 讀取端(⑨-3 的另一半,住序 3)
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
```

**改成**: **序 12b 不改 postfx.js**,但要知道兩件事會在序 3 一起進來,否則 ⑨-3 的授權值讀不回來:①`rtScene.texture[1]` MUST 改 `NearestFilter`(§0-c 已定案 —— 打包後 `.a` 的線性內插會混出**不存在的類別**;今天沒事只因為 `INK.THICK = 1.0` 讓取樣點恰好落在 texel 中心);②勾線 pass 的哨兵門檻 `min(...) > 0.25`(542)與 LUT 的地貌分支 `cls > 0.25 && cls < 0.75`(724~725)MUST 一起換成解包後的 `cls == 1`,而 `audit_cel_pipeline` 的 `/min\( min\( i0\.a, …\) > 0\.25/` 那條斷言也要跟著改期望值。

## 寫入檔案
- `public/js/toon.js` (edit) — `SURF_ID` 具名表(`LAND` 逐位元不動 + 新增 `CONCRETE`);`applyCelPatch` 追加 `contrib` / `surf` 兩個選項(MUST 排在 `bands` 之後)、寫進 `celOpts`、`surf` 走 surfaceId 三分支、`contrib` 掛成 uniform `uInkContrib`;`envMat` 轉下去(`toonMat` 只轉 `contrib`,MUST NOT 收 `surf`)
- `public/js/biomes.js` (edit) — 19 支結構材質逐支補 `contrib`(授權表見 steps);坑門混凝土四支補 `surf: SURF_ID.CONCRETE`;洞口警示條紋補 `emissive` 並把兩支材質提到迴圈外;天花燈補 `contrib: 1`。**底色九個 hex 逐位元不動、幾何/碰撞/slab/decks/cols/走廊一格不動**
- `tools/audit_struct_ink.mjs` (create) — ⑨ 專屬離線稽核:①結構區塊零原生材質 ②contrib 授權表逐件比對且值 ∈ k/15 ③坑門混凝土共用 id 且 id 與 LAND 的差 > INK_MRT 門檻 ④九個底色逐位元不動 + emissive 只准加不准換色 ⑤零共享 rnd() 消耗。MUST NOT 重寫 `audit_cel_pipeline` Ⅵ 的 ShaderMaterial 掃描(那是同一條規則的第二份)
- `.github/workflows/ci.yml` (edit) — 新稽核註冊進 CI 的離線稽核清單(插在 `node tools/audit_cel_pipeline.mjs` 之後,與它同族)
- `.claude/rules/seams-render.md` (edit) — §2.1 F 新增一列「立體結構的線工授權與洞內照明」:唯一縫 = `toon.js SURF_ID`/`applyCelPatch` 的 `contrib`·`surf` + biomes.js 的授權表;鐵律 = 幾何/碰撞/slab 一格不動、底色不准換、稽核 `audit_struct_ink`
- `.claude/rules/verification.md` (edit) — §5.1(續)加一行指令;§5.5 加一列「改了立體結構的材質/線工授權/洞內照明 → 跑什麼」(含 audit_traverse ㋓ 與 shot_tunnels ㋓ 的未驗標註)
- `tools/shot_tunnels.mjs` (edit) — 洞內是新視覺唯一沒有離線稽核看得到的地方 ⇒ 在既有 meta.json 的四項掃描後追加第 ⑥ 項:`mid_*` 六向與 `p{i}_in20_up` 的**平均亮度與亮度分位數**,讓「洞內平成一塊黑」變成數字而不是印象。出圖流程與 24 張機位一格不動
- `docs/anime_style_plan.md` (edit) — 「執行紀錄」追加序 12b 那一列(做了什麼 / 用什麼守住 / 留下什麼);同時把 ⑨ 那一節裡**本儲存庫不存在的六個名字**與對應幾何的實際對照補進去(見 blockedOn 第 1 項),避免下一輪再照著不存在的清單找

## 步驟
1. 步驟 0(改任何一行之前)——**拍基準**。序 12 已經明知會改變畫面 ⇒ 先跑 `node tools/shot_tunnels.mjs --kind tunnel`、`--kind underpass`、`--kind gallery` 各一輪存檔(每座 24 張 + meta.json 的四項掃描),再跑一輪 `node tools/shot_scene.mjs --venue taroko --pref inkMrt=on` 當對照。沒有這一組,後面「洞內變黑了沒」只能靠印象。
2. 步驟 1 —— `toon.js` 的縫。①`const SURF_ID = { LAND: 0, CONCRETE: 1 };`,保留 `const LAND_SURF_ID = SURF_ID.LAND;`(`audit_cel_pipeline` Ⅶ 有 `/const LAND_SURF_ID = 0;/` 這條樣式,改寫法會讓它紅字而理由是假的 —— 若改寫,MUST 同步改那條斷言的期望值);`CONCRETE` 旁邊 MUST 用註解釘住不等式「> nextSurfId 值域上界 0.9921875,且差 0.0078 > INK_MRT.ID 門檻 0.004」。②`applyCelPatch` 解構參數尾端追加 `contrib = 1, surf = null`(**MUST 在 `bands` 之後、`land` 之前或之後皆可,但兩支呼叫端的 `soft, bands` 相鄰關係 MUST 保留**)。③`celOpts`(600)追加 `contrib, surf`。④surfaceId 三分支(land → surf → nextSurfId)。⑤`shader.uniforms.uInkContrib = { value: Math.round(contrib * 15) / 15 }`(**在這裡量化一次**,授權表寫 0.5 也會被收成 8/15 ⇒ 稽核比對的是量化後的值)。⑥片段程式頂端補 `uniform float uInkContrib;`(與 `uSurfId`/`uInkClass` 同一段,905 附近)。⑦`envMat` 轉 `contrib, surf`;`toonMat` 只轉 `contrib`。
3. 步驟 2 —— 確認 ⑨-1 / ⑨-2 是零改動。跑一次新稽核的第 ① 段(結構區塊零原生材質)確定今天就是綠的,再跑 `node tools/audit_cel_pipeline.mjs` 確認 Ⅵ 的 ShaderMaterial 掃描仍是 95/0。**⑨-1 與 ⑨-2 到此結束,不寫任何結構端程式碼** —— 材質換學派是序 12 改 `toon.js` 的推論,`gInfo` 宣告在今天已成立。
4. 步驟 3 —— `biomes.js` 的 contrib 授權表(⑨-3)。逐支補,值全部是 k/15:洞內拱圈一族 **contrib 1**(側牆 `wall` 6507、天花 `ceilSegs` 6576、橫樑 `beams` 6582、明隧道柱列 `galCols` 6544、天花燈 6599);坑門一族 **contrib 1**(額牆/翼牆 `wallM` 6757、collar 6746、外露頂板 `galRoof` 6522 —— 這一族就是「坑門冠石」的實際落點,本專案沒有 keystone 幾何,額牆頂梁 `lintel` 6760 是最接近的構件而它吃 `wallM`);橋樑一族 **contrib 8/15**(欄杆 `rail` 6474、邊梁 `girder` 6485、底板 `soffit` 6496 —— 計畫寫的「橋面伸縮縫 / 欄杆立柱」在本儲存庫**沒有對應幾何**,欄杆是一條連續直立緞帶而不是立柱,所以「量太滿」的實際來源是緞帶上下兩條邊的二階差分,壓到 8/15 就是計畫要的「中等」);地下道緣石帶 `cope` 6535 **8/15**;橋墩/墩帽 6617·6632 與墩座台 6949·6950 **contrib 1**;避車道 `walk` 6461 維持 **1**;降級用的洞口暗面 `envMat(0x0e1013)` 6780 **contrib 0**(它是一片黑布幕,被天空描出輪廓正是 `outlineContribution` 存在的理由 —— 這一格同時是「最近面覆寫」的活體測試)。**MUST NOT 為了湊計畫清單新增法枠工格網 / 待避所 / 伸縮縫幾何**:那是新增世界內容,要回答 §2.3 的「這一段消耗了幾枚共享 rnd()」而本項的前提是零消耗。
5. 步驟 4 —— 坑門混凝土共用 id(⑨-4)。6746 / 6522 / 6757 三處 `envMat(0x9a958c, …)` 各補 `surf: SURF_ID.CONCRETE`。**只收這三支**;洞內構件維持 `nextSurfId`。落地後在真瀏覽器上確認兩件事:混凝土↔山坡有線(那是 CONCRETE 1 vs LAND 0)、額牆↔collar↔頂板之間**沒有**線(id 差 0)。
6. 步驟 5 —— 洞內照明(⑨-5)。①條紋兩支材質提到 stripe 迴圈外(6785 之前),黃格補 `emissive: new THREE.Color(0x6a5210), emissiveIntensity: 0.55`,黑格不補;②天花燈 6599 補 `contrib: 1`;③**底色九個 hex 一個都不准動**。跑 `shot_tunnels` 三輪與步驟 0 的基準比 meta.json 新增的亮度分位數 —— 判準是「洞內中位亮度不得比基準低」而不是「要變亮」(嚴格改善,原則 6)。
7. 步驟 6 —— 新稽核 `tools/audit_struct_ink.mjs`。讀原文一律 `readSrc()`(CRLF 工作區;自己 readFileSync 會靜默失效)。五段:①結構區塊(`function buildRoads(` → `function planTowerBridgePads(`)零原生材質;②contrib 授權表逐件比對(以「材質建構那一行前面最近的一段註解標題」當件名,值 MUST ∈ {k/15});③`SURF_ID.CONCRETE` 與 `LAND` 的差 > `INK_MRT.ID` 的 0.004 門檻(**門檻 MUST 從 postfx.js 原文解析出來,MUST NOT 手寫 0.004** —— 手寫的話有人改 postfx 這條就靜默失效);④九個底色逐位元 + 「emissive 只准加」(比對本輪之前的底色常數表);⑤結構區塊零 `rnd()`/`Math.random()`。四支 `--break-*` 見 reverseChecks。
8. 步驟 7 —— 註冊與文件。CI 加一行;`.claude/rules/seams-render.md` 加一列縫;`.claude/rules/verification.md` 加指令與 §5.5 對照列;`docs/anime_style_plan.md` 執行紀錄追加序 12b 那一列,並把「本儲存庫不存在的六個名字 → 實際幾何」的對照表寫進 ⑨ 那一節。
9. 步驟 8 —— 回歸。跑 audits 清單全部;`npm run bal` / `npm test`(先照 §5.2 重啟伺服器)MUST 逐項不動;`node tools/audit_client_syntax.mjs`(㋖);㋓ `shot_tunnels` 三輪 + `audit_traverse`;㋕ 真機走進山體隧道與地下道各一次、走上高架橋一次。

## 稽核
- `node tools/audit_struct_ink.mjs`
- `node tools/audit_cel_pipeline.mjs`
- `node tools/audit_visual_prefs.mjs`
- `node tools/audit_soft_stroke.mjs`
- `node tools/audit_gpu_lifecycle.mjs`
- `node tools/audit_client_syntax.mjs`
- `node tools/audit_layer_block.mjs`
- `node tools/audit_open_tunnel.mjs`
- `node tools/audit_underpass.mjs`
- `node tools/audit_road_joint.mjs`
- `node tools/audit_road_bed.mjs`
- `node tools/audit_bridge_crossing.mjs`
- `node tools/audit_bridge_tower_pad.mjs`
- `node tools/audit_water_skirt.mjs`
- `node tools/audit_slope_move.mjs`
- `node tools/audit_siteplan.mjs`
- `node tools/audit_beacons.mjs`
- `node tools/audit_object_joints.mjs --seeds 8`
- `node tools/audit_ground_tile.mjs`
- `node tools/audit_world_edge.mjs`
- `node tools/audit_solo_boot.mjs`
- `npm run audit:net`
- `npm run bal`
- `npm test`
- `node tools/audit_traverse.mjs`
- `node tools/shot_tunnels.mjs --kind tunnel`
- `node tools/shot_tunnels.mjs --kind underpass`
- `node tools/shot_tunnels.mjs --kind gallery`
- `node tools/shot_scene.mjs --venue taroko --pref inkMrt=on`

## 反向驗證
- `--break-rawmat` — 壞版: 在 `buildRoads()` 的結構區塊裡塞一支 `new THREE.MeshBasicMaterial({ color: 0x9a958c })`(字面注入,樣式 MUST 用 `\r?\n` 容忍;替換無效時當場 `process.exit(1)`) ⇒ **MUST 紅**: `audit_struct_ink` ① 段的「結構區塊零原生材質(全部走 envMat/toonMat ⇒ gInfo 由 applyCelPatch 無條件寫出)」MUST 紅字。這是 ⑨-2 唯一一道結構級守門:漏宣告的代價是那一批物件整批不畫且 console 一個字都沒有
- `--break-contrib` — 壞版: 把授權表裡的 `contrib` 全部拿掉(字面把 `contrib: ` 抹成 `_contrib_: `),或把 `uInkContrib` 的量化 `Math.round(contrib * 15) / 15` 改回原值直接寫入 ⇒ **MUST 紅**: `audit_struct_ink` ② 段的兩條 MUST 紅:「19 件結構逐件有授權值」與「授權值 ∈ k/15(§0-c 只有 16 階,不量化就與編碼端的 round 對不上)」。⚠ 期望值 MUST NOT 隨 flag 改變(否則 break 永遠是綠的)
- `--break-surf` — 壞版: 把 `applyCelPatch` 的 `else if (surf != null) mat.userData.celSurfId = surf;` 這一分支刪掉(= 坑門混凝土四支各自退回 `nextSurfId()`) ⇒ **MUST 紅**: `audit_struct_ink` ③ 段 MUST 紅:「坑門混凝土家族共用同一號」與「共用號與 LAND 的差 > postfx 解析出來的 INK_MRT.ID 門檻」。⚠ 同時要有一條**對照組 MUST 仍綠**:`toonMat` 不吃 `surf`(機體之間的線是要的,同 `audit_cel_pipeline` Ⅶ 對 land 的那一條)
- `--break-emissive` — 壞版: 把洞口警示條紋的 `emissive` 拿掉、改成把底色從 `0xf2c230` 換成更亮的 `0xffe98a`(= 計畫 ⑨-5 明文禁止的那條路:「不亮的凹處要 emissive,不是換淺一點的顏色」) ⇒ **MUST 紅**: `audit_struct_ink` ④ 段 MUST 紅**兩條**:「九個結構底色逐位元不動」與「洞內/洞口的提亮只准由 emissive 提供」。兩條一起紅才代表這道閘同時擋住「換色」與「拿掉發光」,只紅一條表示閘只做了一半
- `(對照組,不是 break)node tools/audit_cel_pipeline.mjs --break-inkinfo` — 壞版: 沿用既有反向驗證:模擬有人新增一支進場景的 ShaderMaterial 卻忘了宣告 gInfo ⇒ **MUST 紅**: `audit_cel_pipeline` Ⅵ 的「每一支都宣告了 gInfo」MUST 紅字。⚠ 這一支**不是** ⑨ 新增的,列在這裡是要確認新稽核**沒有**把它重寫成第二份(同一條規則兩份實作 = 兩份會分家)

## 會靜默壞掉的地方
- **計畫 ⑨ 的清單有六個名字在本儲存庫不存在**:`buildCribs` / `cribColumn` / `quadTo` / `boreProfile` / `boreClearance` / `sweptSolid`(全檔全目錄 grep 為 0),連帶「法枠工格網」「待避所」「坑門冠石」「橋面伸縮縫」「欄杆立柱」也沒有對應幾何 —— 欄杆是一條連續直立緞帶(`rail`,5492)不是立柱。照清單找會找不到而誤以為是自己漏看;照清單新增幾何則是把純表現層項目變成新增世界內容(§2.3 的 rnd() 帳)。已在 steps 3 給出對號入座表,但這一條 MUST 寫回計畫文件,否則下一輪重踩。
- **`nextSurfId` 只有 64 個槽,而 biomes.js 有 221 處材質建構**(其中洞口警示條紋是**迴圈內**建構 ⇒ 48 座洞口 × 8 格 = 最多 384 支材質)。撞號的症狀是「某兩塊相接的東西之間少了一條線」,沒有任何錯誤訊息,而且**逐場地不同**(材質建構順序跟著圖資走)。⑨-4 只解決坑門那一族;把條紋材質提到迴圈外是順手的減壓,但 64 槽的根本壓力仍在,列為已知限制。
- **⑨-4 的線今天就會出,只是被開關關著**:`inkMrt` 預設 `off`(visualPrefs.js:80),所以整個 surfaceId 機制在出貨設定下**一格都沒有被行使**。落地後在預設設定下看不出任何差別 ⇒ 驗證 MUST 帶 `--pref inkMrt=on`,否則會得到「改了沒反應」的假結論。
- **洞內構件要不要也共用 id 是設計取捨,本規格刻意不收**。收了(側牆/天花/橫樑/柱列同號)= 洞內只剩法線折邊那一條訊號,拱頂與樑的分界靠 90° 折邊仍畫得出來,但柱列與矮牆之間(近乎共面)會整段消失;不收 = 現制,構件之間有線但也多。真瀏覽器看過才知道哪一種對,列為 ㋕ 之後的可調項。
- **`applyCelPatch` 的新選項若插錯位置會讓 `audit_visual_prefs` 紅字而理由是假的**:那支以 `/applyCelPatch\(m, \{ metal: !!celMetal, rim, soft, bands\s*[,}]/` 與 `/tint: 'env', preview, soft, bands\s*[,}]/` 兩條樣式釘住呼叫形狀。看到紅字時容易誤以為是 bands 傳丟了。
- **`contrib` 若做成 define 而不是 uniform,`customProgramCacheKey`(966)不補就是「有些結構的線會斷、有些不會」** —— three 只認那把鑰匙,而症狀完全不像編譯問題。反過來把 uniform 塞進鑰匙則是每個 contrib 值各編一支 program(19 支 → 建構期多十幾次 shader 編譯)。
- **`shot_tunnels` 的三種結構在沙箱裡走 `--synth` 合成 way**,衛星影像取不到就是素色地被 ⇒ 洞內亮度的絕對值與線上版不同。判準 MUST 是**同一套 synth 下的前後對照**(步驟 0 的基準),MUST NOT 拿一個絕對亮度門檻當閘。
- **序 12(School B)與序 12b 同時落地 ⇒ 兩者的畫面變化混在一起**。若洞內出了問題,分不出是換學派還是 ⑨-5 沒補夠。建議先讓序 12 單獨過一輪 `shot_tunnels`(那一輪一定會看到洞內變黑,那是預期),再疊 ⑨-5,才能歸因。

## 逐位元中性

"**旋鈕關著時不是逐位元同舊制,而且這是預期的** —— 序 12b 跟著序 12 走,計畫的執行順序表已標「否(跟著 12 變)」。要拆開講的話有三層:①**權威側逐位元不動**是可以證明也 MUST 證明的:`data.js` / `sim.js` / `server/**` 一行未改,`buildRoads()` 回傳的 `{ built, decks, tunnels, cols, portals, signSpots }` 六項與 `gradeCorridors` / `blockers` / `tunnelSegs` 的第 7 欄 `gal` 全部不動 ⇒ `npm run bal` 與 `npm test` MUST 逐項不動,`audit_layer_block`(基準 61/0)/ `audit_open_tunnel`(163/0)/ `audit_underpass`(161/0)/ `audit_road_joint`(86/0)/ `audit_road_bed`(16/0)/ `audit_bridge_crossing`(16/0)/ `audit_bridge_tower_pad`(23/0)/ `audit_water_skirt`(8/0)MUST 逐項不動 —— 這八支就是「視覺改動有沒有漏進幾何」的判決面。②**散布序列逐位元不動**:本項只改材質選項與材質常數,結構區塊零 `rnd()` 消耗(新稽核 ⑤ 段釘住)⇒ `audit_siteplan` / `audit_beacons` / `audit_object_joints --seeds 8` / `audit_ground_tile` MUST 逐項不動。③**畫面**:`inkMrt` 關著(出貨預設)時 ⑨-3 與 ⑨-4 完全不生效(contribution 與 surfaceId 都只住第二張附件),唯一看得見的差異是 ⑨-5 的洞口警示條紋 emissive —— 那是**刻意**的,證明方式是拍一組 `shot_tunnels`,除了洞口上緣那一條黃帶之外像素應與基準相同。`inkMrt` 開著時畫面必然改變,證明方式是與步驟 0 的基準組並排人眼核對 + meta.json 的亮度分位數。"

## 卡在
- **依賴序 3(①-1 `outlineContribution` 編碼)先落地。** 執行紀錄裡序 3 是「⏸ 已量測、未落地」,而 §0-c 的半位元組編碼(`gInfo.a = (clsIdx*16 + round(ctr*15))/255`)是 ⑨-3 唯一能寫進去的地方。序 3 同輪還要帶三件:`rtScene.texture[1]` 改 `NearestFilter`(postfx.js:310)、勾線哨兵 `> 0.25`(postfx.js:542)與 LUT 地貌分支 `cls > 0.25 && cls < 0.75`(postfx.js:724~725)改成解包後的 `cls == 1`、以及**最近面覆寫**(`ceil`/`floor` 硬決定)。⇒ 序 12b 若在序 3 之前動手,只能做到 ⑨-4 與 ⑨-5,⑨-3 無處可寫。
- **依賴序 4(①-2 雜訊斷線)才有「法枠工格網 → 貢獻 < 1 且吃雜訊斷線」的下半句。** 本規格已把 8/15 這個值填給橋樑欄杆/邊梁/底板/緣石帶(法枠工不存在),但「斷線」那一半要序 4 的 `step(noise)` 才生效。附帶好消息:結構材質 `wash > 0` 的那 18 支已經有 `CEL_WP`(世界座標 varying,toon.js:583)⇒ 雜訊不必新開 varying;而且結構是**靜態**的,世界座標雜訊是對的(計畫「MUST 吃局部座標」那條只綁機體,理由是走路時缺口會在身上游動)。唯一例外是 `envMat(0x0e1013, { wash: 0 })`(6780)沒有 `CEL_WP`,但它的 contrib 是 0 ⇒ 不需要雜訊。
- **需要使用者裁決:計畫 ⑨-3 列的「法枠工格網 / 待避所 / 坑門冠石 / 橋面伸縮縫 / 欄杆立柱」在本儲存庫沒有幾何。** 三條路:①照本規格對號入座到既有幾何(額牆頂梁當冠石、欄杆緞帶當立柱,法枠工與待避所與伸縮縫**不做**)②為它們新增幾何(= 新增世界內容,要回答 §2.3 的 rnd() 帳,而且 ⑨ 的前提是「只改材質/著色層」)③把那幾項留到後續獨立項目。本規格走 ①,但這是把使用者定案的清單縮短,MUST 由使用者確認。
- **需要真瀏覽器(㋓)才驗得完。** `audit_traverse` 與 `shot_tunnels` 三輪、`shot_scene --pref inkMrt=on` 都要 Playwright + 外網高程磚,沙箱跑不動 ⇒ 交付說明 MUST 標註未驗項(§5.4 ㋓),並在 GitHub Actions 或真機補跑。洞內是新視覺唯一沒有任何離線稽核看得到的地方,`shot_tunnels` 的 `mid_*` 六向與 `p{i}_in20_up` 就是那道閘。
- **需要 ㋕ 真機:走進山體隧道與地下道各一次、走上高架橋一次。** 判準三條:洞內看得出拱頂/樑/柱的輪廓(⑨-3 的 contrib 1)、洞口黃帶亮著而牆沒有整片被提亮(⑨-5)、坑門混凝土與上方山坡之間有一條線而額牆與 collar 之間沒有(⑨-4,MUST 開 `inkMrt`)。
- **交給序 13/14 的答案已查到,不需要新開名冊**:結構足跡 keep-out 就是 `markGradeCorridors()`(biomes.js:5323~5409)產出的 `gradeCorridors`(8321~8324 → 9904 → main.js:2171),它同時把足跡以 `blockArea(blocked, x, z, hw + STRUCT_CLEAR_PAD)` 打進散布用的 `blocked` 格(`STRUCT_CLEAR_PAD = max(7, UND.COPE, TUN.GAL_CLEAR_W)`,4530)。計畫寫的 `hillAt` 在本儲存庫不存在。**唯一缺口**:`gradeCorridors` 逐段帶 `hw`/`kind`/`cy` 但不帶明隧道柱列的側別,要精確避開柱列那一側得從同批交出的 `tunnels`(第 7 欄 `gal` 位元遮罩)取。序 12b 不動這一支。
