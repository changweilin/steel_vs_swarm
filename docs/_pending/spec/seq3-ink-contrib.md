# 序 3 / ①-1 `outlineContribution` 打包上線(§0-c 半位元組切)  (key: seq3-ink-contrib)

## 摘要

現制 `gInfo.a` 只帶表面類別(`toon.js INK_CLASS` = NONE 0 / LAND 0.5 / HARD 1),兩個消費端都以浮點帶判定(勾線哨兵 `> 0.25`、LUT 地貌 `0.25 < a < 0.75`)。本項把 `.a` 換成計畫 §0-c 已定案的半位元組切編碼(`(clsIdx*16 + round(ctr*15))/255`,clsIdx 0/1/2),同一輪帶進最近面覆寫(`ceil`/`floor` 硬決定)與 `rtScene.texture[1]` 的 `NearestFilter`。編碼與解碼 MUST 收成 toon.js 匯出的兩段 GLSL 字串(postfx.js 三個讀取點同吃),否則 16/15/255 三個魔數會散成三份。貢獻的來源是 `applyCelPatch` 的新參數 `ink`(預設 1),值一律經推導縫 `inkRepeat(pitchM)` 由呼叫端自己的構件間距算出,`ink: 0` 是唯一容許手寫的宣告(否決)。逐位元中性有兩層:旋鈕預設關 ⇒ `_mrt` false ⇒ 三個讀取點編譯期不存在;旋鈕開著但沒有人授權過 ≠ 1 的貢獻 ⇒ 解碼恰為 float32 的 1.0 ⇒ 乘算與覆寫都是恆等。計畫 ⑨-3 的逐結構貢獻值(拱圈 1 / 法枠工 < 1 / 橋面伸縮縫中等)**不在本項** —— 法枠工那一族在儲存庫裡根本還不存在,而「中等」用間距推不出來,兩者都屬 序 12b。

## 縫

### 表面類別碼 INK_CLASS(浮點 → 索引)
`public/js/toon.js:155`

現行:
```js
export const INK_CLASS = {
  NONE: 0,     // 沒有寫過(天空穹頂 / 護盾殼 / 粒子 / 招牌)—— 哨兵
  LAND: 0.5,   // 地貌:地形 + 一切貼在它上面的地被層
  HARD: 1,     // 其餘(機體 / 建物 / 道路 / 水面 / 擺件)= 舊制
};
```

**改成**: 三個值改成 **索引** NONE 0 / LAND 1 / HARD 2(高半位元組)。註解要寫明「這是 nibble 索引不是 alpha 值,MUST NOT 再拿它跟 .a 直接比大小」。全專案只有 toon.js:610 一處消費(已 grep 確認沒有任何 import),故換值是封閉的。

### 哨兵 INK_INFO_NONE(不動,但語意要釘住)
`public/js/toon.js:161`

現行:
```js
export const INK_INFO_NONE = 'gInfo = vec4( 0.0 );';   // 哨兵 0 = 這一格沒有法線資訊
```

**改成**: **一個字都不改**。新編碼下 a = 0 ⇒ q = 0 ⇒ cls = 0 = NONE ⇒ 哨兵語意逐位元保留(天空穹頂 environment.js:138、護盾殼 vfx.js:656、opaque_fragment 預設 toon.js:172 三處全部自動成立)。稽核要新增一條「q(0) === 0 且 cls(0) === NONE」把這件事釘死,否則日後有人把 base 從 255 改掉就靜默失去哨兵。

### 打包/解包 GLSL 唯一縫(新增)
`public/js/toon.js:162`

現行:
```js
export const INK_INFO_DECL = 'layout(location = 1) out highp vec4 gInfo;';
export const INK_INFO_NONE = 'gInfo = vec4( 0.0 );';   // 哨兵 0 = 這一格沒有法線資訊
function installInkInfo() {
```

**改成**: 在 INK_INFO_NONE 之後插入三個匯出:①`INK_PACK_GLSL`(`float inkPack(float cls, float ctr){ return ( cls * 16.0 + floor( clamp(ctr,0.0,1.0) * 15.0 + 0.5 ) ) / 255.0; }`)②`INK_UNPACK_GLSL`(`float inkQ(float a){return floor(a*255.0+0.5);} float inkCls(float a){return floor(inkQ(a)/16.0);} float inkCtr(float a){return fract(inkQ(a)/16.0)*16.0/15.0;}`)③ JS 對應的 `INK_LEVELS = 15` + `inkQuant(c)`。`postfx.js` MUST `import { INK_UNPACK_GLSL } from './toon.js'` 並把它前置到勾線與 grade 兩支 fragmentShader —— 16/15/255 三個數字全專案只准出現在這一段裡。模組邊:toon.js 不 import postfx.js,無循環。

### 貢獻參數進 applyCelPatch 簽章
`public/js/toon.js:567`

現行:
```js
function applyCelPatch(mat, { metal = false, rim = 0.22, wash = 0, moss = null, cool = 0, paint = null, tint = 'mech', preview = false, soft = null, bands = 3, land = false, landNrm = false } = {}) {
```

**改成**: 加一個 `ink = 1`。**預設 1 是逐位元中性的全部本錢** —— 既有 78 處 envMat/toonMat 呼叫端一行都不用改。`ink` 是**純 uniform**(不是 define)⇒ MUST NOT 進 customProgramCacheKey(toon.js:966),進去就是把每一個貢獻值切出一支新程式。

### celOpts 必須帶 ink(applyPaint 重入)
`public/js/toon.js:600`

現行:
```js
  mat.userData.celOpts = { metal, rim, wash, moss, cool, paint, tint, preview, soft, bands, land, landNrm };
```

**改成**: 補 `ink`。`applyPaint()`(toon.js:976)以 `{ ...(mat.userData.celOpts || {}), paint }` 重跑 applyCelPatch ⇒ 漏了這一欄的話,任何一台機體上塗裝之後貢獻會靜默重置回 1,而畫面上只表現成「這台機體的線比別台多」。

### uInkClass uniform + 新 uInkCtr
`public/js/toon.js:610`

現行:
```js
    shader.uniforms.uInkClass = { value: land ? INK_CLASS.LAND : INK_CLASS.HARD };
```

**改成**: 值改成索引(同一行不變,因為 INK_CLASS 的值換了);緊接著加 `shader.uniforms.uInkCtr = { value: inkQuant(ink) };` —— **MUST 經 inkQuant 量化**,否則呼叫端傳 0.4、緩衝裡是 0.4000/0.4667,而稽核與定裝照量到的是另一個數。**MUST NOT 在 CPU 端先把 cls 與 ctr 併成一個數**:序 4(雜訊斷線)要逐 fragment 調變 ctr,併掉就沒有調變點了。

### gInfo 寫入處(編碼本體)
`public/js/toon.js:899`

現行:
```js
          if ( dot( vLandN, vLandN ) > 1e-8 ) gN = normalize( vLandN );
          #endif
          gInfo = vec4( gN.xy * 0.5 + 0.5, uSurfId, uInkClass );
        }`)
```

**改成**: 改成兩行:`float inkC = uInkCtr;`(序 4 的調變點,本輪就是這一行原樣)+ `gInfo = vec4( gN.xy * 0.5 + 0.5, uSurfId, inkPack( uInkClass, inkC ) );`。`.rg`(法線)與 `.b`(surfaceId)一個字都不動。`INK_PACK_GLSL` 前置到同一支 fragmentShader 的宣告區(toon.js:904 那一段)。

### uniform 宣告區
`public/js/toon.js:904`

現行:
```js
        uniform float uSurfId;
        uniform float uInkClass;
```

**改成**: 補 `uniform float uInkCtr;`,並在同一段前面插 `${INK_PACK_GLSL}`。

### 貢獻的推導縫 inkRepeat(新增)
`public/js/toon.js:464`

現行:
```js
// 門檻抬高 ⇒ 越過門檻的像素帶變窄。故軟性 = 把 `|e|` 乘上 `INK_SOFT_A` 再進 smoothstep
// —— 線帶真的變窄(不是只變淡),而且 `INK_SOFT_A = 1` 逐位元回到舊制。
const INK_SOFT_A = 0.3;
```

**改成**: 在 INK_SOFT_A 旁邊(它是同一族的另一半:軟性管**多細**,貢獻管**畫不畫**)新增 `export const INK_REPEAT_M = SOLDIER_H * 2;`(需 `import { SOLDIER_H } from './data.js'`,toon.js:12 已經 import data.js ⇒ 只加一個名字、**data.js 一行不動**)與 `export const inkRepeat = (pitchM) => inkQuant(Math.min(1, Math.max(0, pitchM / INK_REPEAT_M)));`。規則:呼叫端 MUST 傳**自己排零件時已經算出來的間距**,MUST NOT 手寫貢獻數字、MUST NOT 建「零件種類 → 貢獻」的名冊;唯一容許手寫的是 `ink: 0`(否決,具名常數 `INK_CONTRIB_NONE`)。⚠ `INK_REPEAT_M` 的倍率 2 是**本項唯一推不出來的數**(同 `MINI.BUFFER_F`、`REALIZED_F` 的處理方式:註解就地寫明「這是授權值不是量測值,校準面在 序 12b 的定裝照」)。

### toonMat / envMat 透傳
`public/js/toon.js:988`

現行:
```js
  const { celMetal, bands, rim = 0.22, soft = null, ...rest } = opts;
  const m = new THREE.MeshToonMaterial({ color, gradientMap: toonGradient(bands), ...rest });
```

**改成**: 兩支都要把 `ink` 從 opts 解構出來(否則它會落進 `...rest` 被丟給 MeshToonMaterial 建構子 = three 靜默忽略一個不存在的屬性,而貢獻永遠是 1)並轉給 applyCelPatch。envMat 同理(toon.js:1005)。

### RT 附件 1 改 NearestFilter
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

**改成**: 在三元式之後、`if (depth)` 之前插入 **`if (Array.isArray(rt.texture)) { rt.texture[1].minFilter = THREE.NearestFilter; rt.texture[1].magFilter = THREE.NearestFilter; }`**。⚠ 守衛 MUST 是 `Array.isArray` 而不是 `this._mrt` 以外的任何寫法:退場路徑上 `rt.texture` 是**單一 Texture**,`rt.texture[1]` 是 undefined ⇒ 直接丟 TypeError 把整條管線在建構子炸掉(而那正是 WebGL1 / 旋鈕全關的預設路徑)。r160 的 `WebGLMultipleRenderTargets.setSize` 只改 `image.width/height` ⇒ 濾波設定在 resize 之後仍在;`_syncMrt` 重建也走同一支 `_mkRT` ⇒ 不必第二處。

### 勾線 pass:哨兵門檻 + 貢獻解碼
`public/js/postfx.js:534`

現行:
```js
          vec4 i0 = texture2D( tInfo, vUv );
          vec4 il = texture2D( tInfo, vUv - vec2( t.x, 0.0 ) ), ir = texture2D( tInfo, vUv + vec2( t.x, 0.0 ) );
          vec4 iu = texture2D( tInfo, vUv + vec2( 0.0, t.y ) ), ib = texture2D( tInfo, vUv - vec2( 0.0, t.y ) );
          float mrtEdge = 0.0;
          if ( min( min( i0.a, min( il.a, ir.a ) ), min( iu.a, ib.a ) ) > 0.25 ) {
```

**改成**: 哨兵改成解碼後的類別:`float c0 = inkCls(i0.a), cl = inkCls(il.a), cr = inkCls(ir.a), cu = inkCls(iu.a), cb = inkCls(ib.a);` 然後 `if ( min( min( c0, min( cl, cr ) ), min( cu, cb ) ) > 0.5 ) { …折邊/id… }`。⚠ **舊門檻 0.25 直接留著就是這一項最惡的靜默壞法**:新編碼的 `.a` 最大只有 47/255 = 0.184,`> 0.25` 永遠不成立 ⇒ 折邊勾線整個變成 no-op,而使用者看到的是「開了那顆開關沒反應」。同時把 `INK_UNPACK_GLSL` 前置到這支 shader(postfx.js:499 那一段宣告區)。

### 勾線 pass:最近面覆寫 + 貢獻乘算
`public/js/postfx.js:550`

現行:
```js
          // 兩個訊號都跨不過門檻才早退
          if ( ae <= ${INK.EDGE0.toFixed(3)} && mrtEdge <= 0.0 ) { gl_FragColor = base; return; }` : `
```

**改成**: 在早退之前插入覆寫。①中心貢獻:`float ctr = ( c0 > 0.5 ) ? inkCtr( i0.a ) : 1.0;` —— **cls == NONE ⇒ 貢獻 1(沒有意見)不是 0**,寫成 0 會把粒子/護盾/招牌那些今天有線的像素整批滅掉。②投票:逐鄰居 `if ( cX > 0.5 && dX < minD ) { minD = dX; minC = inkCtr( iX.a ); }`(dX 就是既有的 l/r/u/b 線性深度,不必多取樣;**沒有資訊的鄰居 MUST 不投票**,否則一顆飄過去的粒子會把它後面所有的線關掉)。③硬決定:`if ( minD < d ) { ctr = ( minC > ctr ) ? max( ctr, ceil( minC ) ) : min( ctr, floor( minC ) ); }` —— `ceil`/`floor` MUST NOT 換成 `mix`/`smoothstep`(那會在每一個與否決面相鄰的物件外圈長出半強度光暈,而那正是這個通道要消掉的東西)。④早退補一條 `|| ctr <= 0.0`。⑤乘算:postfx.js:571 的 `ink = max( ink, mrtEdge * soft );` 之後補 `ink *= ctr;`(仍在 `${mrt ? … : ''}` 之內 ⇒ mrt 關掉時編譯出來的是今天逐字相同的程式)。

### grade pass:LUT 地貌分支的類別判定
`public/js/postfx.js:724`

現行:
```js
            float cls = texture2D( tInfo, vUv ).a;
            if ( cls > 0.25 && cls < 0.75 ) lc = lutApplyLand( pre );` : ''}
```

**改成**: 改成 `float cls = inkCls( texture2D( tInfo, vUv ).a );` + `if ( cls > 0.5 && cls < 1.5 ) lc = lutApplyLand( pre );`,並把 `INK_UNPACK_GLSL` 前置到 grade 的 shader(postfx.js:648 宣告區)。⚠ 舊帶 `0.25~0.75` 在新編碼下**恆不成立**(LAND 的 `.a` 落在 16/255~31/255 = 0.063~0.122)⇒ 地貌整片改走一般 `lutApply` ⇒ 2026-08-13 那一輪修掉的「拼圖接縫被 LUT 顯影」當場回來,而沒有任何錯誤訊息。`lutApplyLand` 的仿射分解本體(postfx.js:682)一個字不動。

### 檔頭第四條(.a 語意)
`public/js/postfx.js:63`

現行:
```js
// 類別碼與寫入端全住 `toon.js INK_CLASS`(NONE 0 / LAND 0.5 / HARD 1)。本檔兩個消費端:
```

**改成**: 改寫成第五條:`.a` 自本輪起是 **打包**(高半位元組 = 類別索引 0/1/2、低半位元組 = 貢獻 16 階),編解碼只住 `toon.js INK_PACK_GLSL`/`INK_UNPACK_GLSL`,本檔三個讀取點一律轉呼;並把「NONE = 沒有意見不是不畫線」「沒有資訊的鄰居不投票」「ceil/floor 不得換 mix」三條症狀敘事寫在原地(第 ④ 層)。

### 稽核 Ⅶ:類別碼與寫入原文的斷言
`tools/audit_cel_pipeline.mjs:373`

現行:
```js
  const CLS = new Function(`${/export const INK_CLASS = \{[\s\S]*?\};/.exec(toon)[0].replace('export ', '')}\nreturn INK_CLASS;`)();
  ok(CLS.NONE === 0 && CLS.LAND === 0.5 && CLS.HARD === 1,
    `INK_CLASS 三碼 = 0 / 0.5 / 1(實測 ${JSON.stringify(CLS)})`);
```

**改成**: 期望值改成索引 `0 / 1 / 2`;line 380 的 `gInfo = vec4( gN.xy * 0.5 + 0.5, uSurfId, uInkClass );` 樣式改成 `inkPack( uInkClass, inkC )`;line 439 的 LUT 帶樣式與 line 449 的哨兵樣式同步換成解碼版。**這三條 MUST 與程式同一個 commit 改** —— 只改稽核不改 postfx 的話,稽核綠而畫面壞。

### 稽核 Ⅵ/Ⅶ:新增打包編碼與覆寫的行為直測
`tools/audit_cel_pipeline.mjs:453`

現行:
```js
  ok(/if \(this\._air\) this\.setAirFog\(\.\.\.this\._air\);/.test(P) && /this\.setLut\(this\._lutTex \|\| null/.test(P),
    'grade 材質重建後三組 uniform 全部重掛(漏掉 = 切開關之後空氣透視/LUT 自己關掉)');
}
```

**改成**: 追加 Ⅷ 段:①**編碼往返直測**(離線、無 GPU):從 toon.js 原文抽 `INK_PACK_GLSL`/`INK_UNPACK_GLSL`,以 floor/fract/clamp 的 JS 樁執行,對 3 類別 × 16 階 = 48 組跑 pack → `Math.round(v*255)/255`(8bit UNORM) → unpack,MUST 類別 48/48 正確、貢獻誤差恆 0,且 **level 15 解出來 === 1.0 是嚴格相等**(逐位元中性靠它);②`inkPack(NONE, 0) === 0`(哨兵);③**覆寫行為直測**:抽勾線 shader 的覆寫區塊原文,以同一套樁跑一張案例表(遮蔽者更近 / 更遠 × 遮蔽者貢獻 0/0.5/1 × 中心 0/0.5/1 × 遮蔽者 cls=NONE),斷言結果**只會是 0 或 1**(換成 mix 就有 0.25/0.5 出現)、cls=NONE 的鄰居不改變結果、中心 cls=NONE ⇒ 貢獻 1;④原文閘:`postfx.js` 出現 `\b(255|16|15)\.0\b` 的次數為 0(魔數只准住 toon.js)、`rt.texture[1].minFilter = THREE.NearestFilter` 在 `Array.isArray` 守衛之內、貢獻乘算與覆寫都落在 `${mrt ? … }` 樣板之內。

## 寫入檔案
- `public/js/toon.js` (edit) — 編碼本體:INK_CLASS 換索引、新增 INK_PACK_GLSL/INK_UNPACK_GLSL/INK_LEVELS/inkQuant/INK_REPEAT_M/inkRepeat、applyCelPatch 加 ink 參數與 uInkCtr uniform、gInfo 寫入改打包、celOpts 補 ink、toonMat/envMat 透傳
- `public/js/postfx.js` (edit) — 讀取端三處(勾線哨兵、LUT 地貌類別)換解碼 + 新增最近面覆寫與貢獻乘算 + `_mkRT` 給 texture[1] 設 NearestFilter + 檔頭第四條改寫
- `tools/audit_cel_pipeline.mjs` (edit) — Ⅵ/Ⅶ 既有三條斷言的期望值換新編碼;新增 Ⅷ(編碼往返 / 覆寫行為 / 魔數單一縫 / NearestFilter 守衛)與 --break-contrib / --break-occl / --break-nearest 三支反向驗證
- `.claude/rules/seams-render.md` (edit) — §2.1 F「勾線資訊緩衝」那一列:`.a` 語意由「類別碼」改成「打包(類別索引 + 貢獻 16 階)」,補上第 ⑧⑨⑩ 條(NONE = 沒有意見 / 最近面覆寫是硬決定 / texture[1] 必須 NearestFilter)與新的推導縫 inkRepeat
- `.claude/rules/verification.md` (edit) — §5.5「勾線資訊緩衝 / 任何新增進場景的 ShaderMaterial」那一列補三支 --break-*、postfx→toon 的新 import 邊(audit:net / audit_solo_boot)、以及「旋鈕開著也 MUST 逐位元同舊制」的 ㋓ md5 對照
- `docs/anime_style_plan.md` (edit) — 執行紀錄追加 序 3 的落地列(縫 / 稽核 / 量測結果),並把 ⑨-3 逐結構貢獻值明確標為 序 12b、把「法枠工在儲存庫裡不存在」記進計畫
- `public/js/.claude.md` (edit) — toon.js 與 postfx.js 兩列的模組級地雷:貢獻通道的三條(NONE 語意 / 魔數單一縫 / ink 是 uniform 不進 cacheKey)

## 步驟
1. ① 只動 toon.js 的常數與匯出:INK_CLASS 換索引 0/1/2;新增 INK_PACK_GLSL / INK_UNPACK_GLSL / INK_LEVELS / inkQuant。此步跑 `node tools/audit_client_syntax.mjs`(語法)與 `node -e "import('./public/js/...')"` 不可行(需 three)⇒ 以 audit_cel_pipeline 的原文段驗。
2. ② toon.js 寫入端:applyCelPatch 加 `ink = 1`、celOpts 補 ink、uniform 加 uInkCtr、gInfo 改 `inkPack(uInkClass, inkC)`、宣告區前置 INK_PACK_GLSL、toonMat/envMat 解構透傳。此時**讀取端還是舊的**,`inkMrt=on` 會壞 —— 故 ①~④ MUST 在同一個 commit,MUST NOT 分段交付。
3. ③ postfx.js 讀取端:import INK_UNPACK_GLSL,勾線與 grade 兩支 shader 前置解包函式,哨兵改 `min(cls) > 0.5`、LUT 帶改 `cls > 0.5 && cls < 1.5`。到這裡 `inkMrt=on` / `lutSrc=baked` 應與改制前逐位元相同(貢獻恆 1)。
4. ④ postfx.js 最近面覆寫:中心貢獻(NONE ⇒ 1)、四鄰投票(NONE 不投票)、`ceil`/`floor` 硬決定、`ctr <= 0` 早退、`ink *= ctr`。全部落在 `${mrt ? … : ''}` 之內。
5. ⑤ postfx.js `_mkRT`:`Array.isArray(rt.texture)` 守衛下把 texture[1] 設 NearestFilter。單獨驗:旋鈕全關時管線 MUST 仍建得起來(這一步最容易把預設路徑炸掉)。
6. ⑥ toon.js 推導縫:INK_REPEAT_M(= SOLDIER_H × 2,註解寫明是授權值)+ inkRepeat(pitchM) + INK_CONTRIB_NONE = 0。**本輪不改任何呼叫端**(78 處 envMat/toonMat 全部維持預設 1)。
7. ⑦ tools/audit_cel_pipeline.mjs:改三條既有期望值 + 新增 Ⅷ 段(往返 / 覆寫 / 魔數 / 守衛)+ 三支 --break-*。每一支 --break 立刻跑一次確認**真的紅**且替換有咬到(替換無效 MUST 當場 process.exit(1),同既有 --break-land 的寫法)。
8. ⑧ 三份文件同步(seams-render.md / verification.md / anime_style_plan.md / public/js/.claude.md)。
9. ⑨ 回歸:離線稽核全批 + `npm run bal` / `npm test`(MUST 先照 §5.2 重啟伺服器)逐項不動。
10. ⑩ ㋓(沙箱跑不動,交付說明 MUST 標未驗):`shot_scene` 三輪 md5 對照(旋鈕全關 / `--pref inkMrt=on` / `--pref lutSrc=baked`)MUST 與改制前**逐位元相同**;真 GPU MRT readPixels 重跑一次 §0-c 的 48 組往返。

## 稽核
- `node tools/audit_cel_pipeline.mjs`
- `node tools/audit_cel_pipeline.mjs --break-contrib`
- `node tools/audit_cel_pipeline.mjs --break-occl`
- `node tools/audit_cel_pipeline.mjs --break-nearest`
- `node tools/audit_cel_pipeline.mjs --break-inkinfo`
- `node tools/audit_cel_pipeline.mjs --break-land`
- `node tools/audit_cel_pipeline.mjs --break-lutland`
- `node tools/audit_cel_pipeline.mjs --break-scale`
- `node tools/audit_client_syntax.mjs`
- `node tools/audit_soft_stroke.mjs`
- `node tools/audit_visual_prefs.mjs`
- `node tools/audit_gpu_lifecycle.mjs`
- `node tools/audit_world_curve.mjs`
- `node tools/audit_daynight.mjs`
- `node tools/audit_solo_boot.mjs`
- `npm run audit:net`
- `node tools/audit_ground_tile.mjs`
- `node tools/audit_siteplan.mjs`
- `node tools/audit_beacons.mjs`
- `node tools/audit_object_joints.mjs --seeds 8`
- `npm run bal`
- `node server/server.js  # 依 §5.2:先 netstat/taskkill 清乾淨再起,然後 npm test`
- `npm test`
- `SVS_PREF=inkMrt=on node tools/shot_scene.mjs --venue taroko --pref inkMrt=on   # ㋓ md5 對照,沙箱跑不動`
- `node tools/shot_scene.mjs --venue taroko --pref lutSrc=baked   # ㋓ md5 對照,沙箱跑不動`

## 反向驗證
- `--break-contrib` — 壞版: 把 toon.js 的 `gInfo = vec4( …, inkPack( uInkClass, inkC ) );` 換回 `gInfo = vec4( …, uInkClass );`(以 `\r?\n` 容忍樣式做字面替換,替換無效 MUST 當場 process.exit(1)) ⇒ **MUST 紅**: audit_cel_pipeline Ⅷ①「48 組往返:類別 48/48 正確、貢獻誤差 0」+ Ⅷ②「inkPack(NONE,0) === 0 且 level 15 嚴格 === 1.0」+ Ⅶ「gInfo 的 .a 走 inkPack 打包」三條 MUST 紅
- `--break-occl` — 壞版: 把勾線 pass 覆寫的 `( minC > ctr ) ? max( ctr, ceil( minC ) ) : min( ctr, floor( minC ) )` 換成 `mix( ctr, minC, 0.5 )` ⇒ **MUST 紅**: audit_cel_pipeline Ⅷ③「覆寫結果只會是 0 或 1」MUST 紅(遮蔽者 0.5 / 中心 1 的案例解出 0.75)+ 原文條「覆寫是 ceil/floor 硬決定,MUST NOT 是 mix」MUST 紅。這一支就是計畫 ①-1 點名的那一條反向驗證
- `--break-nearest` — 壞版: 把 `rt.texture[1].minFilter = THREE.NearestFilter` 換成 `THREE.LinearFilter`(magFilter 同) ⇒ **MUST 紅**: audit_cel_pipeline Ⅷ④「附件 1 MUST 是 NearestFilter」MUST 紅。理由寫在斷言旁:今天沒事只因 `INK.THICK = 1.0` 讓取樣偏移恰好落在 texel 中心,一旦有人動 THICK,線性內插會把相鄰的 q 混成一個不存在的類別
- `--break-inkinfo(既有,MUST 仍咬得住)` — 壞版: vfx.js 拿掉 INK_INFO_DECL ⇒ **MUST 紅**: Ⅵ「每一支都宣告了 gInfo」MUST 紅 —— 本輪動了 gInfo 的內容,這道閘不得被連帶弄鈍
- `--break-land / --break-lutland(既有,MUST 仍咬得住)` — 壞版: 地貌不共用 surfaceId / LUT 地貌分支退回直接查表 ⇒ **MUST 紅**: Ⅶ 對應條目 MUST 紅。⚠ `--break-lutland` 的字面替換樣式綁著 `if ( cls > 0.25 && cls < 0.75 ) lc = lutApplyLand( pre );` —— 本輪把那一行換成解碼版之後,**替換會靜默 no-op 而反向驗證變成永遠綠**(§5.4 ㋑ 那個坑)⇒ MUST 同步更新樣式並確認它仍紅

## 會靜默壞掉的地方
- **`rt.texture[1]` 在退場路徑上是 undefined**:`_mrtCap` 為假 / 旋鈕全關時 `_mkRT(true)` 回的是單附件 `WebGLRenderTarget`,`rt.texture` 是一個 Texture 物件不是陣列 ⇒ 沒有 `Array.isArray` 守衛就是建構子丟 TypeError,把**預設路徑**(絕大多數使用者)整條管線炸掉。這是本項唯一一個會炸得很大聲、卻剛好落在最沒人測的分支上的地方
- **勾線哨兵留著舊的 `> 0.25`**:新編碼的 `.a` 上限只有 47/255 = 0.184 ⇒ 條件永遠不成立 ⇒ 折邊勾線整個變 no-op。畫面上表現成「開了『折邊勾線』沒反應」,console 一個字都沒有,而每一條既有斷言照樣全綠(它們驗的是原文樣式,樣式沒動)
- **LUT 地貌帶留著舊的 `0.25 < a < 0.75`**:LAND 的 `.a` 落在 0.063~0.122 ⇒ 分支恆不成立 ⇒ 地貌整片改走一般 lutApply ⇒ 2026-08-13 修掉的「拼圖接縫被 LUT 顯影」原樣回來,只有開 LUT 的人看得到
- **中心 cls == NONE 被當成貢獻 0**:天空穹頂 / 護盾殼 / 粒子 / 招牌今天都寫哨兵 0,把它們讀成「不畫線」會把它們**今天有的**深度線整批滅掉(那些線來自深度二階差分,與資訊緩衝無關)⇒ 不是逐位元中性。規則 MUST 是「NONE = 沒有意見 ⇒ 貢獻 1」
- **沒有資訊的鄰居參與投票**:一顆飄過去的粒子(cls NONE、深度比背景近)會以 floor(0) 把它後面所有的線關掉,症狀是「特效經過的地方線會閃掉」
- **`ink` 進了 customProgramCacheKey**:它是 uniform 不是 define,進鑰匙就是每個貢獻值切一支新程式(編譯尖峰 + 記憶體),而畫面上完全看不出來
- **celOpts 漏了 `ink`**:`applyPaint()` 以 celOpts 重跑 applyCelPatch ⇒ 上塗裝的機體貢獻靜默重置成 1
- **postfx.js 裡出現 `0.3` 這個字面值**:`audit_soft_stroke.mjs:91` 有一條「postfx.js 沒有手抄 INK_SOFT_A」的斷言,會以一個與軟性完全無關的理由紅字,查起來很久
- **魔數 16 / 15 / 255 散成三份**:三個讀取點各抄一次的話,日後調階數只改到其中一處 ⇒ 類別解錯,而那表現成「某些表面的線莫名其妙全沒了」
- **`--break-lutland` 的替換樣式綁死現行那一行**:本輪改掉那一行之後,舊樣式會靜默 no-op ⇒ 反向驗證永遠綠(§5.4 ㋑ / `--break-roof` 2026-08-14 踩過的同一個坑)
- **HalfFloatType RT**(非低功耗路徑)的 `.a` 不是 8bit UNORM:`q = floor(a*255+0.5)` 在 half 上仍精確(0.184 處 ulp ×255 = 0.031,遠小於 ±0.5),但這件事 MUST 寫進註解 —— 日後有人把 base 從 255 改大就會先在 half 上壞
- 計畫 §⑨「MUST 原封不動」表列的 `buildCribs` / `cribColumn` / `quadTo` / `boreProfile` / `sweptSolid` **在本儲存庫裡查無**(全庫 grep 零命中)⇒ ⑨-3 的『法枠工格網 → 貢獻 < 1』沒有可以掛的呼叫端

## 逐位元中性

["**兩層都成立,而且第二層比計畫承諾的更強。**","① 旋鈕預設(`inkMrt = off`、`lutSrc = none`)⇒ `_wantInfo()` 為假 ⇒ `_mrt` 為假 ⇒ `_mkRT(true)` 回單附件 RT、`_inkMaterial()` 的 `${mrt ? …}` 與 `_gradeMaterial()` 的 `${info ? …}` 兩個樣板分支**編譯期不存在**、`render()` 不呼叫 `clearBufferfv`、`u.tInfo` 這個 uniform 根本沒有 ⇒ 三個新的讀取點一行都不會被執行。寫入端仍寫 `gInfo`,但沒有 draw buffer 可落(這正是既有的「宣告一律無條件」不對稱契約),值換了也沒有人取樣。`_mrtCap` 為假(WebGL1)是同一條路徑,故新制的退場保證與現制**是同一個結構**,不是另外加的判斷。","② 旋鈕開著也仍逐位元:本輪**沒有任何呼叫端授權 ≠ 1 的貢獻**(78 處 envMat/toonMat 全部吃預設 `ink = 1`)。`inkQuant(1) = 1` ⇒ level 15 ⇒ q = cls×16+15 ⇒ 解碼 `fract(q/16)*16/15`:31/16 與 47/16 在 float32 上是精確的二進位值(1.9375 / 2.9375),fract = 0.9375 精確,×16 = 15 精確,÷15 = **嚴格 1.0**。於是 `ink *= ctr` 是恆等、覆寫的 `ceil(1)`/`floor(1)` 也是恆等 ⇒ 勾線輸出逐位元不變。哨兵的分割面也完全一致(舊:NONE 0 不過、LAND 0.5 與 HARD 1 過;新:cls 0 不過、cls 1/2 過),LUT 地貌分支選中的像素集合同上。","③ `NearestFilter` 這一步在今天是恆等:勾線與 grade 兩支的取樣點都是 `vUv`(fragment 中心 = (i+0.5)/w)加上 `uTexel × INK.THICK`,而 `INK.THICK = 1.0` ⇒ 偏移恰好是整數個 texel ⇒ 線性內插取到的就是那一個 texel 的值。改成 Nearest 拿到同一個數。","④ `data.js` / `sim.js` / `server/**` **一行未改**(`SOLDIER_H` 只是多一個 import 名字)⇒ `npm run bal` 與 `npm test` MUST 逐項不動;動了就是純表現層漏進了判定。","**怎麼證明**:(a) 離線 —— audit_cel_pipeline 新增的 Ⅷ① 往返直測以**嚴格相等**斷言 level 15 解出 1.0(不是「誤差 < 1e-6」,浮點恆等式要用嚴格相等才咬得住);(b) ㋓ —— `shot_scene` 三輪(旋鈕全關 / `--pref inkMrt=on` / `--pref lutSrc=baked`)13 張定場照的 md5 與改制前**逐張相同**,手法與 2026-08-13 那一輪逐字相同;(c) `npm run bal` / `npm test` 逐項對照。"]

## 卡在
- **`INK_REPEAT_M` 的值需要使用者裁決(或延到 序 12b)**。本項唯一推不出來的數。提案 `SOLDIER_H × 2 = 3.6 m`,理由:`inkRepeat(pitch) = pitch / INK_REPEAT_M` 在計畫 ⑨-3 的三組上給出 拱圈/待避所/冠石(無重複)= 1、欄杆立柱(間距 ~2 m)≈ 0.56「中等」、法枠工格網(格距 ~1.5 m)≈ 0.42「< 1」—— 順序與量級都對得上使用者列的那三組。但 3.6 m 這個數字**不是從既有量推導出來的**(試過 `SOLDIER_H`、`heroTallestH()` ≈ 26 m 兩個現成錨:前者把三組全推到 1、後者把三組全推到近 0),故它與 `MINI.BUFFER_F = 1/3`、`SELF_ULT.REALIZED_F = 0.35` 同級 —— 授權值,MUST 在原地註明「不是量測值,校準面是 序 12b 的定裝照」。
- **⑨-3 的第三組「橋面伸縮縫 → 中等」用間距推不出來**:伸縮縫每 20~30 m 一道 ⇒ `inkRepeat` 給 1。它的病灶不是重複密度而是「一道 5 cm 高差被二階差分畫成滿線」,那需要第二個推導軸(構件自身斷面 vs 筆寬)。建議:序 3 只落地縫,這一組連同法枠工與拱圈的實際賦值一起留給 序 12b,由定裝照校準。**若使用者要求序 3 就把三組賦上去,MUST 先裁決上一條的錨。**
- **計畫 §⑨ 表列的 `buildCribs` / `cribColumn` / `quadTo` / `boreProfile` / `boreClearance` / `sweptSolid` 在本儲存庫查無**(`grep -rniE 'crib|法枠|boreProfile|sweptSolid|quadTo' --include=*.js --include=*.mjs` 零命中)。計畫把它們列在「MUST 原封不動」表裡,實際上是**還沒做**。這影響 ⑨-3 有沒有東西可掛,建議在本輪同時更正計畫檔的那一格。
- **㋓ 沙箱跑不動、MUST 在交付說明標未驗**:①`shot_scene` 三輪 md5 對照(需真瀏覽器 + playwright);②真 GPU MRT `readPixels` 重跑 §0-c 的 48 組往返(離線的 Ⅷ① 只證明**數學**對,證明不了驅動上的 8bit/half 位階);③㋕ 真機走進一個洞看折邊勾線開著時的線量。
- **`postfx.js` 新增 `import … from './toon.js'` 這條模組邊**需要一併跑 `npm run audit:net` 與 `audit_solo_boot`(URL 佈局鏡射 / data.js 單一模組實例)。已確認無循環(toon.js 只 import three / visualPrefs / field / data),但這一條是 A28 家族,不該憑推理放行。
