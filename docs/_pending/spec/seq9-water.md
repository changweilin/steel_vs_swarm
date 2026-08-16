# 序 9 / ⑤-2 岸邊泡沫 + ⑤-3 水面倒影塊(docs/anime_style_plan.md ⑤ 第 2、3 條)  (key: seq9-water)

## 摘要

計畫書「本專案的水面現在只有波形,沒有 shore band」**是過期的**:`biomes.js:5093 buildWaterEdges()` 早已有一條岸邊泡沫帶,只是它正是計畫要否定的那一種 —— 驅動量是 `terrainEnvCode` 的 8m 格點(岸線幾何、量化成方塊),外觀是 Canvas 徑向漸層的軟 alpha(與 `step(0.42)` 硬邊相反),而且它是一片固定在 `waterY+0.1` 的平板 ⇒ 浪高 ±0.9m 的波峰**穿過**泡沫片。⑤-2 因此是**替換**不是純新增(兩份 shore band 並存 = 第二實作)。訊號來源已查清:水面是在 `Pipeline.render()` 那一次 `r.render(scene, camera)` 裡畫進 `rtScene` 的(postfx.js:806),而 `rtScene.depthTexture` 是同一個 FBO 的附件 ⇒ 水面 fragment **拿不到**場景深度(回饋迴圈),要拿只有「第二趟全場深度 prepass」或「水面關掉 depthWrite 改做後製」兩條,前者正是 postfx 檔頭拒絕第二張陰影圖的同一筆成本,後者會刪掉水岸那條勾線並改變狙擊景深的對焦 ⇒ 兩條都不逐位元中性。落地方案:把水深做成**烤好的深度場貼圖**(terrain 高度場 + `buildBiomes` 之後對 `blockers` 蓋章),逐 fragment 取樣,泡沫帶的相位再減去 `celSeaH` ⇒ 浪一來泡沫沖上岸,而「繞過每一顆石頭與每一根柱子」由蓋章那一步給。⑤-3 不做 planar reflection(第二趟全場 render),改成**一份幾何、一個 draw call、朝向在頂點著色器算**的 3~4 段斷口倒影塊:走 `applyCelPatch` 新增的 `CEL_REFL` 分支(不新增任何進場景的 ShaderMaterial ⇒ gInfo 契約天然成立),長度用鏡像幾何反解 `len = D·h/(e+h)` 推導不手寫,高度吃同一支 `celSeaH × seaFade` ⇒ 倒影塊跟著浪起伏。兩者一行都不碰 `waterY` / `WATER.*` / `terrainEnvCode` / `bakeWetGrid` / 涉水物理。

## 縫

### 海浪參數(波長 = 尺,不是外觀旋鈕)
`public/js/toon.js:470`

現行:
```js
export const WIND = {
  DIR_DEG: 118,      // 風向(世界 XZ 方位角,度)
  WAVE_M: 26,        // 空間波長(m)
  BEAT: 1.87,
  CLOUD_MPS: 1.7,
  GUST_M: 210,
  GUST_S: 0.21,
  GUST_F: 0.55,
  SEA_M: 64,         // 海浪波長(遊戲公尺)
  SEA_SEG: 8,        // 一個波長至少切幾段(= 取樣率)
};
```

**改成**: 同一個常數表下方追加 `FOAM`(`BAND_M` 泡沫帶的深度節距、`STEP` 硬邊門檻 0.42、`NOISE_M` 噪聲空間尺度、`RANGE_M` 深度場的量化上界、`TEXEL_M` 場的texel 邊長)與 `REFL`(`SEG_N` 3~4、`GAP_F` 斷口比、`MIN_H` 最小反射體高、`MAX_N` 上限、`HALF_F` 半寬 ÷ 反射體半徑)。**MUST NOT** 在 terrain.js/biomes.js 手寫這些值 —— 與 `SEA_M`/`SEA_SEG` 同一條紀律(消費端手寫 = 改了這裡只動到一半)。

### 表面波分類(泡沫掛在同一個 kind 上)
`public/js/toon.js:512`

現行:
```js
  sea:   { amp: 0.014, freq: 0.55, axis: 'w' },   // 海面 / 湖面 / 潟湖
```

**改成**: 不動這一列。泡沫**不是**第五種 kind —— 它是 `axis === 'w'` 這一族的附加片段(`CEL_WAVE` 已經是它的 define),另開 kind 會讓 `SOFT_KINDS` 的 amp/freq 語意分岔(Ⅰ 段那批斷言逐項比對 amp/freq/axis)。

### 水面軟性參數與分段數推導(消費端唯一入口)
`public/js/toon.js:519`

現行:
```js
export const seaSoft = () => ({ k: 'sea', span: WIND.SEA_M });
/** 水面網格的最大邊長(m):由波長與取樣率推導,MUST NOT 手寫段數 */
export const seaSegM = () => WIND.SEA_M / WIND.SEA_SEG;
```

**改成**: 追加 `export const seaFieldN = (worldW, worldH, low) => …`(深度場邊長格數,由 `FOAM.TEXEL_M` 與世界跨距推導、低功耗折半,與 `SHADOW.TEXEL_M` 同一條規矩:**MUST NOT 手寫 1024**)與 `export const foamBandM = () => FOAM.BAND_M`。terrain.js 只准經這兩支取值。

### 浪高(位移與法線同源;泡沫的相位要吃同一支)
`public/js/toon.js:677`

現行:
```js
        float celSeaH( vec2 celSxz ) {
          float celSp = dot( celSxz, uWindK );
          return uSoftAmp * celGust( celSxz )
               * ( sin( uWindT * uSoftFreq + celSp ) * 0.72
                 + sin( uWindT * uSoftFreq * ${WIND.BEAT.toFixed(3)} + celSp * 1.6 + 1.7 ) * 0.28 );
        }
```

**改成**: 在同一個 `#ifdef CEL_WAVE` 宣告區塊追加 `float celFoam( vec2 celFxz, float celFd )`:`bands = ( celFd - celSeaH( celFxz ) ) / FOAM.BAND_M` → `parabola(fract(bands))` → 疊 `celNoise( celFxz / FOAM.NOISE_M )` → `step( FOAM.STEP, … )`,回傳 [0,1]。**MUST 用 `celSeaH` 而不是自己再寫一次相位**(兩份公式 = 泡沫的沖刷與浪峰差半個波長);⚠ 這會讓 `celSeaH(` 的呼叫點由 6 變 7,而 audit_soft_stroke Ⅵ 有一條逐字釘 6 的斷言(見下)。

### 表面波位移(泡沫要用同一個逐頂點世界 XZ)
`public/js/toon.js:756`

現行:
```js
        #ifdef CEL_WAVE
        {
          // ---- 表面波(海浪)----
          vec2 seaXZ = ( modelMatrix * vec4( transformed, 1.0 ) ).xz;
          vec3 seaUp = normalize( vec3( 0.0, 1.0, 0.0 ) * mat3( modelMatrix ) + vec3( 1e-6 ) );
          transformed += seaUp * ( celSeaH( seaXZ ) * seaFade );
        }
        #endif
```

**改成**: 這一段**一行不改**。泡沫是 fragment 的事,世界 XZ 由既有的 `vCelWP`(`CEL_WP` varying)提供;`seaFade` 需要傳到 fragment ⇒ 在 `#ifdef CEL_WAVE` 下新增 `varying float vSeaFade; vSeaFade = seaFade;`(位移那一段之後),泡沫最後乘上它 —— 這正是「玩家看得到的海恆是滿幅」那條結構保證延伸到泡沫上。

### defines / inkable / 快取鍵(泡沫與倒影都要進鑰匙)
`public/js/toon.js:588`

現行:
```js
  const inkable = !!sk && !mat.transparent;
  if (inkable) defines.CEL_SOFT = '';
  if (sk && sk.amp > 0) {
    if (sk.axis === 'w') defines.CEL_WAVE = '';   // 表面波(海浪):垂直位移 + 逐頂點相位
    else {
      defines.CEL_SWAY = '';
      if (sk.axis === 'x') defines.CEL_SWAY_H = '';
    }
  }
```

**改成**: ①`if (wash > 0 || moss) defines.CEL_WP` 改成 `if (wash > 0 || moss || sk?.axis === 'w') defines.CEL_WP`(泡沫要世界 XZ;水面現況 `wash: 0.5` 剛好有,但那是巧合,靠巧合的東西沒有斷言守得住);②新增 `refl` 選項 ⇒ `defines.CEL_REFL`;③`customProgramCacheKey`(第 966 行)MUST 各補一碼(`soft` 那一格已含 `Q${soft.k}`,泡沫沒有新 define ⇒ 不必動;`CEL_REFL` MUST 加 `R`)—— 漏了就是「有些倒影塊不朝向鏡頭」。

### 片段收尾寫入點(泡沫 MUST 排在 ramp 之後)
`public/js/toon.js:880`

現行:
```js
        #include <opaque_fragment>
        #ifdef CEL_SOFT
        gl_FragColor.a = uSoftInk;
        #endif
        {
          vec3 gN = normalize( normal );
          gInfo = vec4( gN.xy * 0.5 + 0.5, uSurfId, uInkClass );
        }
```

**改成**: 在 `#include <opaque_fragment>` **之後**、gInfo 之前插入 `#ifdef CEL_WAVE { float f = celFoam( vCelWP.xz, foamD ) * vSeaFade * uFoamA; gl_FragColor.rgb = mix( gl_FragColor.rgb, uFoamC, f ); gl_FragColor.a = mix( gl_FragColor.a, 1.0, f ); } #endif`。**排在這裡是規則不是方便**:寫進 `diffuseColor` 會讓泡沫再過一次 toon ramp(硬邊被階梯切成兩段、陰影裡的泡沫變灰),而使用者要的是「白色硬邊」;alpha 推向 1 也正是「泡沫是不透明的、蓋住水底」。

### 場貼圖唯一寫入點的 idiom(深度場照抄這一支)
`public/js/toon.js:358`

現行:
```js
export function setWeatherField(data, size, bounds) {
  const old = _wTex;
  const t = new THREE.DataTexture(data, size, size, THREE.RedFormat);
  t.minFilter = THREE.LinearFilter;
  t.magFilter = THREE.LinearFilter;
  t.wrapS = THREE.ClampToEdgeWrapping;
  t.wrapT = THREE.ClampToEdgeWrapping;
  t.needsUpdate = true;
  _wTex = t; _wField.value = t;
  _wRect.value.set(bounds.minX, bounds.minZ, 1 / …, 1 / …);
  old?.dispose();   // A25:上一場的場貼圖不放掉就是每開一場漏一張
}
```

**改成**: 新增 `export function setSeaDepthField(data, size, bounds)` 逐條照抄(共享 uniform `_seaField`/`_seaRect`、`old?.dispose()`、`RedFormat`+`LinearFilter`)。預設值 MUST 是 1×1 的「很深」中性貼圖(同 `neutralWField()` 的做法)⇒ 沒有水域 / 還沒烤 / 舊存檔一律**沒有泡沫**而不是滿場泡沫(原則 6)。貼圖只准在 toon.js 建(field.js 那條規矩,audit_visual_prefs:264 釘著)。

### 逐頂點浪幅淡出(泡沫與倒影塊要共用同一條規則)
`public/js/terrain.js:49`

現行:
```js
function seaFadeOf(geo, w, h) {
  const p = geo.attributes.position;
  const band = Math.max(1e-3, edgeWallInsetM());
  const a = new Float32Array(p.count);
  for (let i = 0; i < p.count; i++) {
    const dEdge = Math.min(w / 2 - Math.abs(p.getX(i)), h / 2 - Math.abs(p.getY(i)));
    a[i] = smooth01(dEdge / band);
  }
  return a;
}
```

**改成**: 把內圈那一行抽成 `export function seaFadeAt(lx, ly, w, h)`,`seaFadeOf` 轉呼它。倒影塊的頂點在 biomes.js 建,需要同一個權重 —— 抄一份就是第二實作(而它壞掉的樣子只是「圖界附近的倒影塊浮在平的水面上晃」)。audit_soft_stroke Ⅵ 現有的 `seaFadeOf` 行為直測(以 `^function seaFadeOf\(geo, w, h\) \{[\s\S]*?^\}` 抽原文)MUST 跟著改成注入 `seaFadeAt`。

### 水盤建構(深度場烤在這裡)
`public/js/terrain.js:552`

現行:
```js
    const wEdge = Math.min(curveMaxEdgeM(), seaSegM());
    const wSeg = (n) => Math.max(1, Math.ceil(n / wEdge));
    const wgeoIn = new THREE.PlaneGeometry(worldW, worldH, wSeg(worldW), wSeg(worldH));
    wgeoIn.setAttribute('seaFade', new THREE.BufferAttribute(seaFadeOf(wgeoIn, worldW, worldH), 1));
    const water = new THREE.Mesh(
      wgeoIn,
      envMat(0x1a4a6a, {
        bands: 'soft', rim: 0, transparent: true, opacity: 0.82, side: THREE.DoubleSide,
        soft: seaSoft(),
      }),
    );
```

**改成**: 在 `waterY = WATER.LEVEL;` 之後、建 mesh 之前呼叫新的 `bakeSeaDepth()`:邊長 `seaFieldN(worldW, worldH, lowPower)`,逐 texel 由 **`heights` 陣列直接雙線性**(不是逐點呼叫 `heightAt`,那是同一份數學但多一層函式呼叫)算 `d = WATER.LEVEL − h`,存 `clamp(d / FOAM.RANGE_M, 0, 1) × 255`,交給 `setSeaDepthField`。`wEdge` 這一行**不改**(泡沫是 fragment 的事,不需要更細的網格)。無水域(`minH >= WATER.LEVEL + 0.2`)⇒ 不烤,場留在中性 1×1。

### 緩衝空間外環水面(泡沫必須被 seaFade 關掉)
`public/js/terrain.js:724`

現行:
```js
      const wgeo = new THREE.BufferGeometry();
      wgeo.setAttribute('position', new THREE.BufferAttribute(wp, 3));
      // 浪幅 0:這一圈的格邊長是曲面那把尺(53m),取樣不了 64m 的波。
      wgeo.setAttribute('seaFade', new THREE.BufferAttribute(new Float32Array(wp.length / 3), 1));
      wgeo.setIndex(Iw);
      wgeo.computeVertexNormals();
      const wRing = new THREE.Mesh(wgeo, waterMat);
```

**改成**: **一行不改**。外環 `seaFade ≡ 0` ⇒ `foam × vSeaFade ≡ 0` ⇒ 外環自動沒有泡沫,而深度場的取樣框只涵蓋圖內、ClampToEdge 會沿圖界外拉的問題也一併不存在。這是本項「訊號從哪來」之外最省的一條:**用既有的結構保證取代一個新的邊界判斷**。稽核要把這一條寫成斷言(泡沫 MUST 乘 `vSeaFade`)。

### terrain 對外 API(深度場的蓋章入口掛在這裡)
`public/js/terrain.js:1259`

現行:
```js
  return { group, mesh, heightAt, natureAt, bufferHeightAt, bufferM, gridM: worldW / (N - 1), rayTerrain, carveTunnels, carveGalleryBands, gradeRoadBeds, punchPortalHoles, sampleColor, waterY, center, bbox, worldW, worldH, minX, minZ, maxX, maxZ, minH, maxH, avgH, usedFallback, inDryBand: dryBand };
```

**改成**: 追加 `stampSeaBlockers`(把 `blockers` 蓋進深度場並重新上傳;無水域 = no-op)與 `seaFadeAt` 的綁定版 `seaFadeAtWorld(x, z)`(倒影塊用)。**只加不改既有欄位**。

### 既有岸邊泡沫(這一項要退場的那一份)
`public/js/biomes.js:5127`

現行:
```js
      if (c === 1 && (nbr(i, j, 0) || nbr(i, j, 2))) {
        const ex = cw * EXP, ez = ch * EXP;
        const a0 = x0 - ex, a1 = x1 + ex, b0 = z0 - ez, b1 = z1 + ez;
        fp.push(a0, wy, b0, a1, wy, b0, a1, wy, b1, a0, wy, b1);
        …
      }
…
    dynamics.push((dt) => {
      t += dt;
      mat.opacity = 0.36 + 0.2 * Math.sin(t * 1.6);          // 潮汐呼吸
      mesh.position.y = 0.1 + Math.sin(t * 1.2) * 0.05;      // 波浪微浮沉
      foamTex.offset.x = (foamTex.offset.x + dt * 0.05) % 1; // 泡沫漂移微光
    });
```

**改成**: **整個泡沫分支退場**:`shoreFoamTex()`(5075-5091,含 3 個 `Math.random()`)、`fp/fnrm/fuv/fidx` 累加、`if (fidx.length)` 那一整塊與它的 `dynamics.push`。潮間帶(`tp/tidx` 與 `if (tidx.length)`)**保留**(那是 envCode 2↔0 的另一件事)。函式檔頭重寫、`biomes.js:9849` 的行末註解由「水岸波浪(動態)+ 沼澤潮間帶(靜態)」改成只剩潮間帶。同時把這一列寫進 `.claude/rules/retired.md`。

### blockers 定案點(深度場蓋章 MUST 排在它之後)
`public/js/main.js:1989`

現行:
```js
    terrain.blockers = biomes.userData.blockers || [];       // 建物碰撞(限制行動不封鎖)
    terrain.clearBuildingsAround = biomes.userData.clearAround || null;
    // 地貌分界線帶 = 強制乾地(…)
    // **安裝點恰此一處,且 MUST 在 buildBiomes 之後**
    terrain.inBorderBand = biomes.userData.bandDryAt || null;
```

**改成**: 緊接 1997 行之後加**一行**:`terrain.stampSeaBlockers?.(terrain.blockers);`。這是 `inBorderBand` 已經立好的先例(建圖期拿不到、拿了就是循環)。⚠ 與 `inBorderBand` 不同的是:泡沫**MUST NOT** 反過來被 `terrainEnvCode` 讀到 —— 那條「表現層規劃反過來決定權威水沼分類」的口子是使用者 2026-08-13 逐案裁決的,MUST NOT 擴大適用。

### 為什麼水面 fragment 拿不到場景深度
`public/js/postfx.js:797`

現行:
```js
    r.setRenderTarget(this.rtScene);
    r.clear();
    if (this._mrt) {
      const gl = r.getContext();
      gl.clearBufferfv(gl.COLOR, 1, [0, 0, 0, 0]);
    }
    r.render(this.scene, this.camera);

    let src = this.rtScene;
```

**改成**: **不改**。這一段就是證據:水面與地形在**同一次** `r.render` 裡畫進 `rtScene`,而 `rtScene.depthTexture`(_mkRT，行 307-321)是同一個 FBO 的附件 ⇒ 水面 fragment 取樣它就是 feedback loop。要拿到「水底的深度」只有三條路,三條都不是零成本:①第二趟全場深度 prepass(= 本檔頭拒絕第二張陰影圖的同一筆錢);②水面 `depthWrite: false` + 後製 —— 會讓勾線的二階差分再也量不到水面,**水岸那條線整條消失**,而且狙擊景深會改對焦到水底;③水面另開 RT 再合成(多一張全螢幕 RT + 一次 blend)。故本項走烤好的深度場,並把 ①②③ 列進 blockedOn 供裁決。

### gInfo 契約(倒影塊 MUST NOT 新開 ShaderMaterial)
`public/js/toon.js:155`

現行:
```js
export const INK_CLASS = {
  NONE: 0,     // 沒有寫過(天空穹頂 / 護盾殼 / 粒子 / 招牌)—— 哨兵
  LAND: 0.5,   // 地貌:地形 + 一切貼在它上面的地被層
  HARD: 1,     // 其餘(機體 / 建物 / 道路 / 水面 / 擺件)= 舊制
};
export const INK_INFO_DECL = 'layout(location = 1) out highp vec4 gInfo;';
export const INK_INFO_NONE = 'gInfo = vec4( 0.0 );';   // 哨兵 0
```

**改成**: 倒影塊走 `applyCelPatch` 的新 define(`CEL_REFL`)掛在 `MeshToonMaterial` 上,**不新增 `new THREE.ShaderMaterial`** ⇒ `installInkInfo()` 對 `ShaderLib` 的無條件宣告自動覆蓋它,`audit_cel_pipeline` Ⅵ 的逐檔掃描(tools/audit_cel_pipeline.mjs:328,數 `new THREE.(Raw)?ShaderMaterial\(` vs `INK_INFO_DECL`)一條都不會紅。倒影塊的類別碼取 **`INK_CLASS.NONE`**(它是貼在水上的一片色塊,不該被畫輪廓)⇒ `applyCelPatch` 需要多一個 `inkClass` 覆寫參數,或直接讓 `refl` 隱含 NONE。

### 既有斷言:celSeaH 呼叫點恰 6(加泡沫必紅)
`tools/audit_soft_stroke.mjs:361`

現行:
```js
  ok(count(T, /float celSeaH\( vec2/g) === 1 && count(T, /celSeaH\(/g) === 6,
    '浪高恰一份實作(位移 1 次 + 中央差分 4 次 = 5 個呼叫點);兩份公式 = 光影的浪與幾何的浪差半個波長');
```

**改成**: 改成 `count(…) === 7` 並把訊息補成「位移 1 + 中央差分 4 + **泡沫相位 1** = 6 個呼叫點」。⚠ 這是本項最容易被誤讀的一條:不改它,加完泡沫後 audit_soft_stroke Ⅵ 會紅字,而紅字的理由(「兩份公式」)與真正的原因完全無關。

### 畫面旋鈕表(泡沫與倒影各一根)
`public/js/visualPrefs.js:32`

現行:
```js
export const VISUAL_KNOBS = {
  shadowMech: { label: '機體陰影偏色', def: 0, min: 0, max: 3, step: 0.05, unit: '%', … },
  …
  air: { label: '空氣透視', def: 0, min: 0, max: 1.5, step: 0.05, unit: '%', … },
```

**改成**: 新增 `foam`(拉桿,**def 1** —— 它取代的是**已經出貨**的東西,def 0 不是「舊制」而是「連岸邊都沒有浪」)與 `reflect`(拉桿,**def 0** —— 倒影塊的亮/暗與濃度是紀律①講的「需美術方向確認」,同 `shadowMech`/`air`,而且 def 0 讓 ⑤-3 真的逐位元中性)。兩者都只動共享 uniform(紀律③),`reflect === 0` 時倒影 mesh `visible = false` ⇒ 不進 draw call。

## 寫入檔案
- `public/js/toon.js` (edit) — 新增 FOAM/REFL 常數、seaFieldN()/foamBandM() 推導、setSeaDepthField() + 共享 uniform、celFoam() GLSL 與 opaque_fragment 之後的套用點、vSeaFade varying、CEL_REFL 頂點分支與 refl 選項、快取鍵補碼、CEL_WP 條件補上 axis==='w'
- `public/js/terrain.js` (edit) — 抽出並匯出 seaFadeAt();新增 bakeSeaDepth()(水盤建構處呼叫)與 stampSeaBlockers();對外 API(行 1259)追加兩個欄位。水面材質與網格分段一行不改
- `public/js/biomes.js` (edit) — 退場 shoreFoamTex() 與 buildWaterEdges() 的泡沫分支(保留潮間帶);新增 buildWaterReflections()(倒影塊幾何 + 逐反射體座標雜湊分段)並在所有 blockers.push 之後接線
- `public/js/main.js` (edit) — buildBiomes 之後(緊接 terrain.inBorderBand 那一行)加一行 terrain.stampSeaBlockers?.(terrain.blockers)
- `public/js/visualPrefs.js` (edit) — 新增 foam(def 1)與 reflect(def 0)兩根拉桿
- `tools/audit_soft_stroke.mjs` (edit) — Ⅵ 段擴充泡沫斷言 + 新增 Ⅹ 倒影塊段;把既有的 celSeaH 呼叫點 6 改 7;seaFadeOf 行為直測改注入 seaFadeAt;新增 --break-foam / --break-stamp / --break-refl
- `tools/shot_scene.mjs` (edit) — 圖層隔離補 --foam=0 / --refl=0(既有 --ink=0/--dof=0/--grade=0 的同一條慣例);waterline 機位是這一項唯一看得到成果的地方
- `.claude/rules/seams-render.md` (edit) — 「海浪(表面波)」那一列擴充成海浪 + 岸邊泡沫;另加一列「水面倒影塊」
- `.claude/rules/retired.md` (edit) — 新增一列:格點驅動的岸邊泡沫片(buildWaterEdges 的 fp/fidx 分支 + shoreFoamTex)已退場,MUST NOT 復辟
- `.claude/rules/verification.md` (edit) — §5.5 新增一列「岸邊泡沫 / 水面倒影塊 → 跑什麼」
- `public/js/.claude.md` (edit) — §1 檔案地圖的 toon.js / terrain.js·biomes.js 兩列補上深度場與倒影塊的縫名;§2 C 段補地雷條(泡沫 MUST 排在 ramp 之後、倒影塊的反射體名冊 MUST 排除邊界牆環)
- `docs/anime_style_plan.md` (edit) — 執行紀錄追加一列(序 9 落地 + 修正「現制沒有 shore band」這句過期敘述)

## 步驟
1. 步驟 0(必做,先於一切):留基準。`node tools/shot_scene.mjs --venue <有水域的場地> --dof=0 --curve=0` 拍一組 waterline/lane_mid/aerial,並記下 md5 —— 舊泡沫要退場,這是唯一能回答「換掉之後是變好還是變壞」的證據。另跑一次 `npm run bal` / `npm test` 存基準輸出。
2. 步驟 1(toon.js,常數與推導):加 `FOAM`/`REFL` 到 `WIND` 下方;加 `seaFieldN(worldW, worldH, low)` 與 `foamBandM()`。此步結束跑 `node tools/audit_client_syntax.mjs`(㋖)確認沒有把 GLSL 樣板字串收掉。
3. 步驟 2(toon.js,深度場的寫入點):照 `setWeatherField`(行 358-371)逐條寫 `setSeaDepthField(data, size, bounds)`,共享 uniform `_seaField`/`_seaRect`,預設 1×1 中性「很深」貼圖,`old?.dispose()` 不可少(A25)。
4. 步驟 3(terrain.js,烤場):`seaFadeOf` 內圈抽成 `export function seaFadeAt(lx, ly, w, h)`;在 `waterY = WATER.LEVEL;` 之後加 `bakeSeaDepth()`(直接吃 `heights` 陣列雙線性,**零 `rnd()`**,無水域不烤);對外 API 追加 `stampSeaBlockers` 與 `seaFadeAtWorld`。此步先不接 shader ⇒ 畫面應**逐位元不動**,是一個乾淨的中繼點。
5. 步骤 4(main.js,蓋章):`terrain.inBorderBand = …` 之後加一行 `terrain.stampSeaBlockers?.(terrain.blockers)`;`stampSeaBlockers` 只掃每個 blocker 的 AABB texel,把 `d` 壓到 0(有向盒吃 `hw2/hd2/ry`,圓吃 `r` —— **MUST 與 A30 同一個橫斷面**,不要只用外接圓,那會讓長條建物旁邊多一圈方形泡沫)。
6. 步驟 5(toon.js,GLSL 泡沫):`#ifdef CEL_WAVE` 宣告區加 `celFoam()`;位移區加 `varying float vSeaFade` 的寫入;`#include <opaque_fragment>` 之後加套用段(mix 到 `gl_FragColor.rgb` 與 `.a`);`CEL_WP` 的條件補 `|| sk?.axis === 'w'`。此步結束在真瀏覽器開一場有水的圖看泡沫。
7. 步驟 6(biomes.js,退場):刪 `shoreFoamTex()` 與 `buildWaterEdges` 的泡沫分支(含 `dynamics.push`),重寫函式檔頭與 9849 行註解,保留潮間帶。跑 `node tools/audit_ground_seam.mjs`(它的第 384 行文字提到 buildWaterEdges,只要語意仍成立即可)與 `audit_soft_stroke`。
8. 步驟 7(稽核 ⑤-2):audit_soft_stroke Ⅵ 把 `celSeaH(` 計數 6→7、`seaFadeOf` 直測改注入 `seaFadeAt`,新增泡沫斷言(見 audits 欄),接上 `--break-foam` / `--break-stamp` 並確認各自紅字。
9. 步驟 8(toon.js,倒影塊材質):`applyCelPatch` 加 `refl` 選項 → `CEL_REFL` define + 快取鍵補 `R` + 類別碼 `INK_CLASS.NONE`;頂點分支用 three 內建的 `cameraPosition` 算 `dir = normalize(cameraPosition.xz − aReflO.xz)`、長度 `len = D·h/(e+h)`(D = 水平距、e = `cameraPosition.y − uWaterY`、h = `aReflO.z` 帶的反射體高)、y 吃 `uWaterY + celSeaH(pos) * aSeaFade`。**沒有任何逐幀 CPU 更新**。
10. 步驟 9(biomes.js,倒影塊幾何):`buildWaterReflections(group, terrain, blockers)` —— 反射體名冊由 `blockers` **推導**(頂高 `b.y+b.h > waterY + REFL.MIN_H` 且腳下 `heightAt < waterY + 近岸帶),⚠ **MUST 排除邊界牆環**(它是 `blockers` 的第一批,naive slice 會剛好只選到它),排序取「離圖心近 + h 大」的前 `REFL.MAX_N`;每個反射體切 `REFL.SEG_N` 段、段長與斷口由**落點雜湊 `mulberry32`** 決定 ⇒ **零共享 `rnd()` 消耗**;掛 `userData.noOutline`、`depthWrite:false`、`renderOrder` 在水盤之上、`frustumCulled = false`。接線點排在所有 `blockers.push` 之後(與 `planClimbRoutes` 同一個理由)。
11. 步驟 10(旋鈕):visualPrefs 加 `foam`(def 1)與 `reflect`(def 0);toon.js 的 `uFoamA` / `uReflA` 走 `onVisualChange` 的共享 uniform,`reflect === 0` 時倒影 mesh `visible = false`。
12. 步驟 11(稽核 ⑤-3 + 收尾):audit_soft_stroke 新增 Ⅹ 段 + `--break-refl`;`.claude/rules` 三支與 `public/js/.claude.md`、`docs/anime_style_plan.md` 執行紀錄一起更新;跑完整 audits 欄。

## 稽核
- `node tools/audit_soft_stroke.mjs`
- `node tools/audit_soft_stroke.mjs --break-foam`
- `node tools/audit_soft_stroke.mjs --break-stamp`
- `node tools/audit_soft_stroke.mjs --break-refl`
- `node tools/audit_soft_stroke.mjs --break-wave`
- `node tools/audit_soft_stroke.mjs --break-gust`
- `node tools/audit_soft_stroke.mjs --break-ink`
- `node tools/audit_soft_stroke.mjs --break-anchor`
- `node tools/audit_client_syntax.mjs`
- `node tools/audit_client_syntax.mjs --break-glsl`
- `node tools/audit_cel_pipeline.mjs`
- `node tools/audit_cel_pipeline.mjs --break-inkinfo`
- `node tools/audit_visual_prefs.mjs`
- `node tools/audit_gpu_lifecycle.mjs`
- `node tools/audit_world_curve.mjs`
- `node tools/audit_ground_tile.mjs`
- `node tools/audit_ground_seam.mjs`
- `node tools/audit_ground_enclave.mjs`
- `node tools/audit_ground_qc.mjs`
- `node tools/audit_ground_border.mjs`
- `node tools/audit_siteplan.mjs`
- `node tools/audit_beacons.mjs`
- `node tools/audit_object_joints.mjs --seeds 8`
- `node tools/audit_world_edge.mjs`
- `node tools/audit_slope_move.mjs`
- `node tools/audit_terrain_ray.mjs`
- `node tools/audit_climb.mjs`
- `node tools/audit_layer_block.mjs`
- `node tools/audit_npc_collide.mjs`
- `node tools/audit_ui_layout.mjs`
- `node tools/audit_ctrl_mode.mjs`
- `npm run audit:net`
- `node tools/audit_solo_boot.mjs`
- `npm run bal`
- `npm test`
- `node tools/shot_scene.mjs --venue <有水域的場地> --dof=0 --curve=0`
- `node tools/shot_scene.mjs --venue <有水域的場地> --foam=0 --refl=0 --dof=0 --curve=0`
- `node tools/shot_scene.mjs --venue <有水域的場地> --pref reflect=1 --dof=0 --curve=0`
- `node tools/audit_ground_drape.mjs`

## 反向驗證
- `--break-foam` — 壞版: 把 `celFoam` 裡的深度取樣換成常數(`float celFd = 1.0;` 取代 `celFd` 由 `texture2D(uSeaField, …)` 而來的那一行),即「泡沫不再由深度差驅動」;字面替換 MUST 用 CRLF 容忍樣式(`\r?\n`)且替換無效時當場 fail(§5.4 ㋑) ⇒ **MUST 紅**: audit_soft_stroke Ⅵ-b:「泡沫的驅動量是水深(唯一來源 = 深度場取樣)」「泡沫帶隨深度單調消失(深度 > FOAM.RANGE_M 恆 0)」兩條 MUST 紅;而同段的「泡沫乘 vSeaFade」「泡沫排在 opaque_fragment 之後」MUST **仍綠**(對照組 —— 只有驅動量那一條被打壞)
- `--break-stamp` — 壞版: 把 `terrain.stampSeaBlockers` 的迴圈本體換成空(或 main.js 那一行拿掉),即「石頭與柱子不進深度場」。行為直測:抽 `bakeSeaDepth` + `stampSeaBlockers` 原文以 `new Function` 執行(同 Ⅵ 對 `seaFadeOf` 的做法),餵一個合成高度場 + 一根 r=2m 的柱子 ⇒ **MUST 紅**: audit_soft_stroke Ⅵ-c:「柱子腳印內的深度場 = 0(乾)」「柱子外一個 texel 仍是原深度(只蓋腳印,不暈開)」MUST 紅;而「深水 texel = RANGE_M 上界」「岸線 texel 單調」MUST 仍綠
- `--break-refl` — 壞版: 把倒影塊頂點分支的 `dir = normalize( cameraPosition.xz − aReflO.xz )` 換成固定向量 `vec2( 1.0, 0.0 )`,即「方向不再沿物件→視點」;另一半把 `len` 的推導式換成手寫常數 ⇒ **MUST 紅**: audit_soft_stroke Ⅹ:「倒影方向由 cameraPosition 推導(恰一處,MUST NOT 手寫方向)」「長度 = D·h/(e+h) 的鏡像反解(MUST NOT 手寫倍率)」兩條 MUST 紅;同段的「零共享 rnd」「反射體名冊排除邊界牆環」「y 吃 celSeaH × seaFade」MUST 仍綠
- `--break-inkinfo(既有)` — 壞版: audit_cel_pipeline 既有的反向驗證:把 vfx.js 的 INK_INFO_DECL 拿掉 ⇒ **MUST 紅**: Ⅵ「每一支都宣告了 gInfo」MUST 紅 —— 用來證明**新增的倒影塊沒有繞過這道閘**(倒影塊走 applyCelPatch,不新增 ShaderMaterial ⇒ 掃描計數不變;若有人改成自寫 ShaderMaterial 而忘了宣告,這道閘會在正常執行時就紅)
- `--break-damp / --break-wave / --break-gust(既有,對照組)` — 壞版: 不改,只是照跑 ⇒ **MUST 紅**: MUST 各自紅在**原本那幾條**、且不多不少 —— 泡沫與倒影加了 celSeaH 的第 6 個呼叫點與新的 varying,若 --break-wave 的字面替換因此失效,那支會印「字面替換沒有生效」自曝(§5.4 ㋑ 的既有防線)

## 會靜默壞掉的地方
- **計畫書那句話是過期的,照抄就會做出第二份 shore band**:`biomes.js:5093 buildWaterEdges()` 已經有一條泡沫帶(8m 格點 + 徑向漸層貼圖 + opacity 呼吸 + 貼圖漂移)。不退場的話兩層泡沫疊在一起,新的硬邊被舊的軟 alpha 糊掉,而每一條既有斷言照樣全綠 —— 症狀只是「岸邊看起來髒髒的」。
- **`celSeaH(` 呼叫點的既有計數斷言(audit_soft_stroke.mjs:361 `=== 6`)會在加泡沫時紅字**,而紅字文案講的是「兩份公式 = 光影的浪與幾何的浪差半個波長」,與真正的原因完全無關;不知道這一條的人很容易改回去、把泡沫的相位從 celSeaH 拆出來自己寫一份 —— 那才是真的壞。
- **泡沫寫在 `diffuseColor` 上 = 再過一次 toon ramp**:硬邊被階梯切成兩段、陰影裡的泡沫變灰。這不會報錯,只表現成「浪花看起來髒」。MUST 排在 `#include <opaque_fragment>` 之後(toon.js:880)。
- **alpha 是共用通道**:`gl_FragColor.a` 對不透明件是勾線門檻倍率(CEL_SOFT 契約)、對水面是不透明度。泡沫把 a 推向 1 在水面上是對的(泡沫蓋住水底),但同一段程式若哪天被搬到不透明件上就是把 `uSoftInk` 蓋掉 = 那批物件的細勾線靜默消失。套用段 MUST 收在 `#ifdef CEL_WAVE` 內。
- **深度場的 texel 邊長手寫 = 低功耗那一半靜默失效**:必須走 `seaFieldN()` 推導並跟著 lowPower 折半(`SHADOW.TEXEL_M` 的同一條)。手寫 1024 的話低階裝置多背 1MB VRAM 而畫面一模一樣。
- **蓋章只用外接圓 = 長條建物旁邊一圈方形泡沫**:`stampSeaBlockers` MUST 吃 A30 的同一個橫斷面(`hw2/hd2/ry` 有向盒;圓只准當 broad-phase)。這是「看得見的泡沫與擋得住彈的牆對不上」的同一族。
- **倒影塊的反射體名冊若直接 `blockers.slice(0, N)`,選到的剛好全是邊界牆環**(A44:`buildEdgeWall` 的碰撞盒是 blockers 的**第一批**)⇒ 四條邊各長出一道連續倒影牆,而圖心的建物一個都沒有。名冊 MUST 排除邊界帶並以「離圖心 + 高度」排序。
- **倒影塊若逐幀在 CPU 轉朝向**,N 個 instance 每幀寫 matrix = 又一條每幀 CPU 迴圈;朝向 MUST 在頂點著色器算(three 內建 `cameraPosition` 已經有,不必新增 uniform)。
- **倒影塊的 y 若不吃 `celSeaH × seaFade`**,它會是一片死平的色塊貼在起伏的水面上(舊泡沫片正是這個病:平板在 waterY+0.1,而浪高 ±0.9m 的波峰直接穿過去)。
- **外環水面共用同一份材質**:泡沫若不乘 `vSeaFade`,53m 格的外環會拿到深度場 ClampToEdge 拉出來的值 ⇒ 地平線那一圈整片白。乘 seaFade 是結構解,不是保險。
- **A25**:新增一張 DataTexture(深度場)與一份倒影幾何/材質。`setSeaDepthField` MUST `old?.dispose()`(照抄 setWeatherField:370);倒影 mesh 掛在 biomes group 下走 `disposeTree`。漏掉的症狀是「每開一場漏一張」,只有長時間連打才看得到。
- **確定性**:`bakeSeaDepth`/`stampSeaBlockers`/倒影分段 MUST **零共享 `rnd()` 消耗**(§2.3)。倒影的每反射體變化一律走落點雜湊自帶種子(flags.js/edgewall.js 的同一條)。多抽一枚就把後面每一株植被整條推移,而畫面上只表現成「整張圖變了」。
- **退場那一半反而移除了三個 `Math.random()`**(shoreFoamTex 的像素著色)—— 那是 A4 邊緣的既有豁免,刪掉是嚴格改善,但要在退場紀錄裡寫明,免得日後有人「補回來」。
- **建構時間**:1024² 的深度場是 ~100 萬次雙線性,實測量級 20~40ms。它落在 `buildTerrain` 內、不在 `buildYield` 的階段邊界上 ⇒ 若量到超過一格(`SLICE_MS`)要把它挪到既有的階段回報點之後,MUST NOT 自己新增 await(§2.1 F「建構期讓步」④)。

## 逐位元中性

"分兩半,**不能一句話帶過**。⑤-3 倒影塊:`reflect` 拉桿 def = 0 ⇒ mesh `visible = false` ⇒ 一個 draw call 都不進、一個像素都不寫 ⇒ **逐位元同舊制**;證明 = `shot_scene` 全機位 md5 與步驟 0 的基準逐張相同(同 2026-08-13 折邊勾線那一輪 13 張定場照的做法)。⑤-2 岸邊泡沫:**不是逐位元中性,而且 `foam = 0` 也不是舊制** —— 舊的格點泡沫片退場了,拉到 0 是「岸邊沒有浪」不是「回到今天」。計畫書序 9 那一列標的「是(純新增)」對 ⑤-2 是錯的,MUST 在執行紀錄裡改掉。真正能證明的三件事:①**權威側逐位元不動** —— `data.js`/`sim.js`/`server/**` 一行未改 ⇒ `npm run bal` 與 `npm test` MUST 與步驟 0 的基準逐項相同(動了就是純表現層漏進判定);②**佈局逐位元不動** —— 泡沫烤場/蓋章/倒影分段全部零共享 `rnd()` 消耗,退場那一半也只刪掉三個與共享序列無關的 `Math.random()` ⇒ `audit_siteplan` / `audit_beacons` / `audit_object_joints --seeds 8` / `audit_ground_*` 全批 MUST 逐項不變;③**水面幾何逐位元不動** —— `wEdge = min(curveMaxEdgeM(), seaSegM())` 與兩張水面的 `seaFade` 一行未改 ⇒ `audit_world_curve` 的水面分段那一條與 audit_soft_stroke Ⅵ 的 `seaFadeOf` 行為直測 MUST 逐項不變(那支直測改成注入 `seaFadeAt` 之後,**回傳值 MUST 逐位元相同**,這正是抽函式沒抽錯的證據)。"

## 卡在
- **使用者裁決①(這一項的核心):岸邊泡沫要不要「繞過每一顆石頭與每一根柱子」的完整版,還是接受烤好的深度場?** 三條路的代價已量清:(a) **烤好的深度場**(本規格的推薦)—— 零額外 render pass,texel 1~1.5m,能繞過地形與所有登記過的 `blockers`(建物/神木/巨岩/橋墩/門洞柱),**繞不過**沒有碰撞柱的純表現層擺件與移動中的機體;成本 = 1MB VRAM(低功耗 256KB)+ 建構期 20~40ms。(b) **深度 prepass**(逐幀真深度,連移動中的機體都繞)—— 多一趟全場 render,即使半解析度也是 postfx 檔頭當初拒絕第二張陰影圖的同一筆錢。(c) **水面 depthWrite:false + 後製泡沫** —— 零額外 pass,但**水岸那條勾線會整條消失**(勾線的二階差分再也量不到水面)且狙擊景深改對焦到水底,兩者都是可見的回歸。
- **使用者裁決②:倒影塊是亮的還是暗的?** 「物件→視點」的方向與 3~4 段斷口是計畫定死的,但顏色不是:亮版(天光/陽光反射的高光帶)與暗版(物件擋住天光,用 `shadowTintRGB()` 的同一個色相)在畫面上是兩種完全不同的東西,而這正是紀律①「卡在需美術方向確認的項目 MUST NOT 由 commit 定案」。本規格因此把 `reflect` 定成 def 0 的拉桿 + 設定頁樣品,顏色方向留給使用者看過 `shot_scene waterline --pref reflect=1` 之後定案。
- **使用者裁決③:倒影塊要不要帶物件自己的顏色?** 逐反射體顏色沒有現成來源(`blockers` 只有幾何,沒有材質色),要就得在 `buildBiomes` 收一份逐棟代表色 = 新的一份帳。本規格的預設是**全場共用一個色**(刻意的降級,同 `surfaceId` 逐材質那條註記的寫法「是刻意的降級,不是假裝有」)。
- **需真瀏覽器(㋓,沙箱跑不動)**:①`shot_scene` 的 `waterline` 機位 —— 泡沫的硬邊、沖刷節奏、繞過柱子的樣子,離線只驗得到「規則接對了」,驗不到「像不像浪」;②GLSL 在 Node 端執行不了 ⇒ `celFoam`/`CEL_REFL` 兩段的正確性只能靠**執行原文的文字不變式** + 真 GPU 直測(時鐘不動 MUST 逐位元相同、推進之後 MUST 有像素改變、`gl.getError()` MUST 為 0 —— 新的 `attribute` 與 `varying` 會不會讓整批物件不畫,只有這裡看得到);③㋕ 真機走到岸邊看一次(泡沫有沒有跟著浪上下、有沒有在 53m 外環那一圈冒出來)。
- **依賴序 12(賽璐璐學派切換)**:泡沫刻意寫在 ramp **之後**,所以 School B 換上去時它不受影響;但倒影塊若採暗版,它與 School B 的陰影色會落在同一個色域上 ⇒ 顏色定案最好排在序 12 之後,或至少在序 12 落地時回頭重看一次 `waterline`。
