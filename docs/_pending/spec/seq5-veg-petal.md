# 序 5 / ⑤-1 玩家位移植被 + ⑤-4 落花粒子 + ⑤-5 雲層飄移  (key: seq5-veg-petal)

## 摘要

⑤-5 **已完成,本輪零工作**:雲的漂移早已吃 `celWindTime()` 同一支時鐘、環繞取模也已「先加半個 WRAP」(`environment.js:222`/`:505`),而且 `audit_soft_stroke` Ⅴ 已有四條行為直測(值域 / 無跳點 / 週期回原點 / 只有一支時鐘)在守。⑤-1 是 `toon.js` 既有 `CEL_SWAY` 頂點區塊的**加項**:新增兩支共享 uniform(`uCharPos[N]` / `uCharSpd[N]`,與 `_windT`/`_gustK` 同一組共享物件)+ 一支新的推進縫 `setCelChar()`,由 `game.js` 主迴圈每幀餵「主視野機體 + 最近 3 台」的世界座標與**平滑後的水平速率**(平滑一律走序 2 落地的 `lerpFPS`),擾動半徑 = 速度的函式;純頂點、零權威、全槽速度 0 時逐位元同舊制。⑤-4 走 CPU 步進而非 GLSL:規則住新的**零 THREE** 模組 `public/js/petals.js`(同 `edgewall.js`/`flags.js`/`wallpanel.js` 的邊界),幾何與逐幀寫入住 `biomes.js` 並掛進**既有的 `dynamics` 桶**(`group.userData.update` → `terrain.biomesUpdate` → game.js,`climb.js:598` 明文禁止在 game.js 另開第二條迴圈);落點由**最終的植被實例名冊 `items` 推導**(`part.key === 'foliage'` = 落葉樹,與 `SOFT_BY_VEG_KEY` 同一條「由既有欄位推導不另開名單」),色調取 `ENV.seasons[].accent`(現在還沒有任何消費端的既有欄位),季節閘只在春/秋開。三項合計不動 `data.js`/`sim.js`/伺服器一行。

## 縫

### 全場風的共享 uniform 物件(⑤-1 掛在這裡)
`public/js/toon.js:526`

現行:
```js
const _windT = { value: 0 };
const _windDir = { value: new THREE.Vector2(WIND_DIR[0], WIND_DIR[1]) };
const _windK = {
  value: new THREE.Vector2(WIND_DIR[0], WIND_DIR[1]).multiplyScalar(Math.PI * 2 / WIND.WAVE_M),
};
// 陣風包絡的波數向量:同一個風向、長一個量級的波長(推導,MUST NOT 另寫一份方向)
const _gustK = {
  value: new THREE.Vector2(WIND_DIR[0], WIND_DIR[1]).multiplyScalar(Math.PI * 2 / WIND.GUST_M),
};
```

**改成**: 在 `_gustK` 之後追加兩支同型共享 uniform:`const _charPos = { value: Array.from({length: CHAR.N}, () => new THREE.Vector3()) }` 與 `const _charSpd = { value: new Float32Array(CHAR.N) }`。共享物件 = 一份餵給所有軟性材質(與 `_windT` 完全同一個 idiom),MUST NOT 逐材質各存一份。同時在 `WIND` 之後新增 `export const CHAR = { N: 4, R0, R_PER_MPS, SPD_REF, PUSH_F, SPD_K }`,其中 `N` 是**成本預算常數**(理由寫在旁邊:每一個槽位是逐頂點一次 `length()`,而草/稻那幾列是全場頂點數最高的 InstancedMesh),`R_PER_MPS` 是「擾動半徑是速度的函式」那條規則的本體。

### 風時鐘的推進縫(新增姊妹縫,MUST NOT 改簽章)
`public/js/toon.js:540`

現行:
```js
export function stepCelWind(dt) {
  _windT.value += Math.min(0.25, Math.max(0, dt || 0));
}

/** 目前的風時鐘(秒);雲朵那半(environment.js)與植被同吃一個時鐘 */
export function celWindTime() { return _windT.value; }
```

**改成**: 緊接著新增 `export function setCelChar(list)`:吃 `[{x,y,z,spd}, …]`,逐槽寫入 `_charPos.value[i]` 與 `_charSpd.value[i]`,**沒填到的槽位 MUST 顯式寫 `spd = 0`**(留上一幀的值 = 那台機體離開之後草永遠倒著)。MUST NOT 把它併進 `stepCelWind(dt)` 的簽章 —— `audit_soft_stroke` Ⅴ 釘死 `count(code(game), /stepCelWind\(dt\)/g) === 1`,改簽章會讓那一條假紅。

### applyCelPatch 的 uniform 注入點
`public/js/toon.js:619`

現行:
```js
    shader.uniforms.uWindT = _windT;
    shader.uniforms.uWindDir = _windDir;
    shader.uniforms.uWindK = _windK;
    shader.uniforms.uGustK = _gustK;
```

**改成**: 追加 `shader.uniforms.uCharPos = _charPos; shader.uniforms.uCharSpd = _charSpd;`(共享物件直接指派,與上面四行同形)。**不需要新 define、不需要動 `customProgramCacheKey`**:所有 `CEL_SWAY` 材質都吃同一份陣列,而速度為 0 時位移項恆 0。

### CEL_SWAY 頂點區塊(⑤-1 的落地點)
`public/js/toon.js:746`

現行:
```js
          vec3 swD = normalize( vec3( uWindDir.x, 0.0, uWindDir.y ) * swM + vec3( 1e-6 ) );
          // 陣風包絡吃**實例原點**的世界 XZ(與相位同一個點)…
          swOsc *= celGust( swO.xz );
          float swA = sw * uSoftAmp * swOsc;
          transformed += swD * swA;
          // 擺出去時梢端略降(弧長守恆的一階近似)
          transformed.y -= sw * uSoftAmp * abs( swOsc ) * 0.3;
        }
        #endif
```

**改成**: 在 `transformed.y -= …` 之後、`}` 之前插入 char 位移。四條:①**距離是 2.5D** —— 水平取**實例原點** `swO.xz`(與相位/包絡同一個點,逐頂點取 XZ 會把整株拉歪),垂直取**這個頂點自己的株上高度**(把 `sw` 平方**之前**那個 `(uSoftBase + transformed.y * uSoftSy)` 另存成 `swH`,世界高 = `swO.y + swH * length(swM[1])`)⇒ 一台在地面走的機體構造上碰不到 6m 高的樹冠;②方向 = 水平離心方向轉進零件局部,沿用 `swD` 那一行的 `* swM` 轉置 idiom;③半徑 `R = CHAR.R0 + CHAR.R_PER_MPS * spd`、強度 `smoothstep(R, 0.0, d) * min(1.0, spd / CHAR.SPD_REF) * sw * uSoftAmp * CHAR.PUSH_F`,逐槽相加;④**MUST NOT 引入第三個 `sin(`**(見 risks)、**MUST NOT 對零向量 `normalize()` 後乘 0**(`normalize(vec3(0))` 是 NaN,`NaN * 0 = NaN` ⇒ 整株消失而且沒有錯誤訊息)—— 一律 `if (spd > 0.0)` 早退或 `dir / max(len, 1e-4)`。

### 主迴圈的風時鐘推進點(⑤-1 的餵入點)
`public/js/game.js:8800`

現行:
```js
    // 全場風的時鐘(植被/旗幟的頂點擺動 + 雲的漂移同吃)。MUST 排在 `envFx.update` 之前:
    // 雲那半讀的是 `celWindTime()`,晚一步就跟地面上的草差一幀。
    stepCelWind(dt);
```

**改成**: 在 `stepCelWind(dt);` 之後追加一行 `setCelChar(this._charSlots(dt));`。名冊本身收成一支私有方法 `_charSlots(dt)`:槽 0 = **主視野機體**(有 `this.side && !this.dead` 時是自機 `this.pos`,觀戰時是 `_specFollow` 跟隨的那台 ent),其餘槽 = 依「離相機距離」升冪取最近的 `ent.hero` 機體(位置取 `ent.mesh.position` —— 那是 `_updateEnts` 已插值完的值,MUST 排在 `_updateEnts` 之後)。**MUST NOT** 新增第二個 `stepCelWind(dt)`。

### 玩家位置 / 速度(速率的來源與平滑)
`public/js/game.js:511`

現行:
```js
    this.vel = new THREE.Vector3();
    this.pos = new THREE.Vector3();
```

**改成**: 速率 MUST 由**位置差分**求(`this.pos` 是攀爬 / 飛行 / 蓄力跳 / 碰撞解算共同的落點,`this.vel` 在攀爬與被推擠時不代表真實位移),再以序 2 的唯一縫平滑:`this._charSpd += (raw - this._charSpd) * lerpFPS(CHAR.SPD_K, dt)`。**MUST NOT** 寫 `Math.min(1, dt * k)` —— `audit_damp_fps` Ⅰ 對 game.js 掃這個樣式且已全數清乾淨。其他機體的速率同法(差分 `ent.mesh.position`);槽位換手時該槽的平滑值 MUST 歸零(淡入而不是瞬跳)。

### A27 剛體通道(⑤-1 的禁區)
`public/js/xform.js:1`

現行:
```js
(vegPartXform / partJitter:實例朝向 ry 與微傾斜 tx/tz MUST 當剛體整株套用)
```

**改成**: **一行都不改**。玩家位移是純頂點位移(A39 ③),MUST NOT 併進逐零件歐拉角或逐實例矩陣(A27);`audit_object_joints --seeds 8` 的接合數與判定因此 MUST 逐項不動 —— 那就是「沒有滲進剛體通道」的證明面。

### 植被實例名冊(⑤-4 落點的唯一來源)
`public/js/biomes.js:8858`

現行:
```js
  for (const type in items) {
    const meshes = nature[type]
      ? buildVegMeshesGlb(nature[type], items[type])
      : buildVegMeshes(type, items[type], season);
    for (const m of meshes) group.add(m);
  }
```

**改成**: `items`(型別 → `[{x,y,z,s,ry}]`,`biomes.js:8329` 宣告)在這一行之後就是**最終落點**(建物過濾在 8845–8853 已完成),而它到 `dynamics` 那一段仍在同一個函式作用域內。落花的來源名冊 MUST 由它推導:`VEG_DEFS[type].parts.some(p => p.key === 'foliage')` = 落葉闊葉/灌木(`conifer` 常綠、`grass` 一律排除),**MUST NOT 手寫樹種名單**(與 `SOFT_BY_VEG_KEY` 同一條:另開一張名單遲早與季節換色那份分家)。

### 季節強調色(⑤-4 的色調唯一縫)
`public/js/data.js:5882`

現行:
```js
    spring: { name: '春', foliage: 0x6fbf58, grass: 0x7cb85a, accent: 0xe8a0c8 },
    summer: { name: '夏', foliage: 0x3e8f3a, grass: 0x5a9e46, accent: 0xffe08a },
    autumn: { name: '秋', foliage: 0xc9762b, grass: 0xa9924f, accent: 0xd94f2b },
    winter: { name: '冬', foliage: 0x9fb3ad, grass: 0x9aa08d, accent: 0xe8f0f4 },
```

**改成**: **唯讀,`data.js` 一行不改。** `accent` 目前**沒有任何消費端**(全庫只有這四行提到它),正好當落花/落葉的基調:春 = 粉(落花)、秋 = 橘紅(落葉)。SKILL 的「三個色調 55/28/17」MUST 由 `accent` 與同季 `foliage` **推導**(例:accent / accent×1.18 提亮 / accent 與 foliage 的中點),MUST NOT 手寫三個色碼。夏/冬不下(季節閘)。

### 逐幀更新的唯一路徑(⑤-4 的驅動)
`public/js/biomes.js:9897`

現行:
```js
  if (dynamics.length) {
    group.userData.update = (dt) => { for (const fn of dynamics) fn(dt); };
  }
```

**改成**: 落花的逐幀步進 MUST `dynamics.push(fn)`(與水岸波浪 5169 / 火車 7278 / 瀑布 7460 / 攀爬箭頭 9876 同一條路)。`climb.js:598` 已把規則寫死:「`main.js → terrain.biomesUpdate → game.js` 每幀驅動,**MUST NOT** 在 game.js 另開第二條更新迴圈」。建構點放在 `dynamics` 宣告(9848)之後 —— `items`/`season`/`terrain` 都還在作用域,而 `gseed`(9795)也已宣告。

### 決定性種子(⑤-4 的 §2.3 帳)
`public/js/biomes.js:9871`

現行:
```js
    rnd: mulberry32(gseed ^ 0x0C11B),
```

**改成**: 落花規劃 MUST 用**專屬 seed**(例 `mulberry32(gseed ^ 0x5E7A1)`),**共享 `rnd()`/`grnd()` 消耗恆為 0**(§2.3 / A4)—— 多抽一枚就把後面每一株植被與每一棟建物的佈局整條推移,而畫面上只表現成「整張圖變了」。逐粒固定枚數(位置 3 + 相位 2 + 自轉軸 2 + 色調 1 = 8 枚),淘汰檢查一律排在抽樣**之後**。

### 共用幾何註冊(A25)
`public/js/toon.js:1171`

現行:
```js
export function markShared(geo) { _sharedGeo.add(geo); return geo; }
```

**改成**: 落花只准有**一份**單位四邊形幾何(`markShared(new THREE.PlaneGeometry(1, 1))`),逐色調各一個 `InstancedMesh` 共用它(3 個 draw call);材質走 `envMat(color, { transparent: true, opacity, depthWrite: false, side: THREE.DoubleSide, rim: 0, wash: 0, cool: 0 })` —— **MUST NOT 用 `new THREE.ShaderMaterial`**:那會被 `audit_cel_pipeline` Ⅵ 的閘要求手動宣告 `INK_INFO_DECL`,而走 `envMat` 連世界曲面(`installWorldCurve` 改的是 three 的 `project_vertex` chunk)與 `gInfo` 都是免費的。每一片 mesh MUST 標 `userData.noOutline = true`(precedent `biomes.js:5071`)。

### ⑤-5 雲層飄移(已完成 —— 證據)
`public/js/environment.js:222`

現行:
```js
        // 取模 MUST 先加半個 WRAP 再減:JS 的 % 對負數回負值,直接取模會讓半邊的雲跳到另一側
        const a = ((d.along + WIND.CLOUD_MPS * t + WRAP * 0.5) % WRAP + WRAP) % WRAP - WRAP * 0.5;
```

**改成**: **不動。** 這一行 + `environment.js:505` 的 `clouds.step(celWindTime())` 就是計畫 ⑤-5 的兩條要求(同一支風時鐘、mod 前先加半個 wrap),兩者都已落地。SKILL L4 的其餘四條也都在:`depthWrite:false, fog:false`(194)、`renderOrder = -9`(214)、雙層 billboard(`mats[i & 1]`,兩個 opacity 0.9/0.55)、`frustumCulled = false`(213)。稽核 `audit_soft_stroke` Ⅴ 第 295–314 行已有四條行為直測在守(不自己數 dt / 值域 / 無跳點 / 一個週期後逐位元回起點)。

### ⑤-1 會踩到的稽核正規式(必讀)
`tools/audit_soft_stroke.mjs:176`

現行:
```js
  const sway = /#ifdef CEL_SWAY\n([\s\S]*?)#endif\n\s*#include <project_vertex>/.exec(V);
  …
  ok(/sin\( uWindT \* uSoftFreq \+ swP \)/.test(S) && count(S, /sin\(/g) === 2,
    '兩個不可通約的正弦相加 = 週期性…但看不出重複點');
```

**改成**: 非貪婪的 `#endif\n\s*#include <project_vertex>` 會一路吃過 `CEL_WAVE` 區塊 ⇒ 捕獲段 `S` **同時涵蓋 CEL_SWAY 與 CEL_WAVE**。兩條後果:①⑤-1 的位移項 **MUST NOT 出現第三個 `sin(`**(要靠 `smoothstep`/`length`,不要用 sin 做衰減);②若日後為落花加 `#ifdef CEL_PETAL` 區塊,它 **MUST 排在 `#ifdef CEL_SWAY` 之前**,否則這一條會紅而紅字理由與真正的問題無關。本輪選 CPU 落花正是為了不碰這條線。

## 寫入檔案
- `public/js/toon.js` (edit) — ⑤-1:新增 `CHAR` 參數表 + `_charPos`/`_charSpd` 共享 uniform + `setCelChar()` 推進縫 + `applyCelPatch` 的 uniform 注入 + `CEL_SWAY` 頂點區塊的位移加項。著色器補丁 MUST 全住這一支(public/js/.claude.md §1 toon.js 那一列)。
- `public/js/game.js` (edit) — ⑤-1:主迴圈在 `stepCelWind(dt)` 之後餵 `setCelChar(this._charSlots(dt))`;新增私有 `_charSlots(dt)`(主視野機 + 最近 3 台、速率由位置差分經 `lerpFPS` 平滑)。⑤-4 若加 `?petal=0` killswitch 也可掛在既有的 `off()` 慣例旁。
- `public/js/petals.js` (create) — ⑤-4 規則本體(零 THREE、只 import `rng.js`):`PETAL` 參數表、`petalTones(season, ENV)`、`planPetalFields(items, defsHasFoliage, terrain 取樣回呼, rnd)`、`stepPetal(p, dt, t, wind)`、`prewarm(field)`。零 THREE 是這一項離線可驗的唯一理由(同 `edgewall.js` / `flags.js` / `wallpanel.js` 的邊界)。
- `public/js/biomes.js` (edit) — ⑤-4 接線:在 `dynamics` 宣告(9848)之後由最終的 `items` 推導落花場、建 `InstancedMesh`(共用單位四邊形 + 逐色調材質)、`dynamics.push(step)`。落點/幾何住 biomes、規則住 petals.js —— 與 `edgewall.js → buildEdgeWall`、`flags.js → placeBaseFlags` 同一條分工。
- `tools/audit_soft_stroke.mjs` (edit) — 新增 Ⅹ(玩家位移植被:原文不變式 + `CHAR` 參數合理性 + 空槽中性)與 Ⅺ(落花:真的執行 petals.js 的純函式 —— 兩頻率、逐粒自轉軸、中心線環繞、預跑後首幀已在半空、季節閘、零共享 rnd),以及六支新的 `--break-*`。檔頭的症狀敘事一併補(第 ④ 層)。
- `docs/anime_style_plan.md` (edit) — 「執行紀錄」追加 2026-08-16 第二輪一列:序 5 三項的狀態(⑤-5 = 本來就已完成,附證據行號)、量到的幀成本、以及留給使用者裁決的兩件事。
- `.claude/rules/seams-render.md` (edit) — §2.1 F 追加兩列縫:「玩家位移植被」(`CHAR`/`setCelChar`/`_charPos`/`_charSpd` + `CEL_SWAY` 加項)與「落花 / 落葉粒子」(`petals.js` + biomes 接線 + `dynamics` 唯一逐幀路徑)。
- `CLAUDE.md` (edit) — §2.1 的 `seams-render.md` 那一列的主題清單追加「玩家位移植被・落花粒子」——目錄查不到主題時的那條「MUST NOT 因為目錄裡沒看到就認定沒有規則」正是為此。
- `.claude/rules/verification.md` (edit) — §5.1(續)清單加上兩支新的 `--break-*` 群;§5.5 新增一列「玩家位移植被 / 落花粒子 → 要跑什麼」(含「`data.js`/`sim.js` 一行未改 ⇒ bal/e2e MUST 逐項不動」與 ㋓ 的實拍項)。
- `public/js/.claude.md` (edit) — §1 檔案職責地圖新增 `petals.js` 一列(零 THREE、只 import rng.js、規則 vs 幾何的分工、零共享 rnd),並在 `toon.js` 那一列補上 `CHAR`/`setCelChar` 屬於軟性物質唯一縫的延伸。

## 步驟
1. 步驟 0(⑤-5,先做完就不再碰):執行 `node tools/audit_soft_stroke.mjs`,確認 Ⅴ 段五條雲的斷言全綠;把 `environment.js:222`(mod 前加半個 WRAP)與 `:505`(`clouds.step(celWindTime())`)寫進交付說明當「已完成」的證據。**本項不改任何一行程式碼**;下面的步驟都不得動到 `environment.js`。
2. 步驟 1(⑤-1 基準):在改任何一行之前,先跑 `node tools/audit_soft_stroke.mjs`、`node tools/audit_damp_fps.mjs`、`node tools/audit_object_joints.mjs --seeds 8`、`npm run bal` 留全綠基準;㋓ 另拍一組 `node tools/shot_scene.mjs --venue taroko`(至少 lane_mid / hilltop 兩張)當改制前對照。
3. 步驟 2(⑤-1 縫):`toon.js` 在 `WIND` 之後加 `export const CHAR = { N: 4, R0, R_PER_MPS, SPD_REF, PUSH_F, SPD_K }`(逐欄寫理由:N 是成本預算、R_PER_MPS 是「半徑是速度的函式」那條規則本體);在 `_gustK`(526–538)之後加 `_charPos`/`_charSpd` 兩支共享 uniform;在 `celWindTime()`(545)之後加 `setCelChar(list)`,**沒填到的槽位顯式寫 spd = 0**。`stepCelWind(dt)` 的簽章一格不動。
4. 步驟 3(⑤-1 著色器):`applyCelPatch` 的 619–622 追加兩行 uniform 指派;`CEL_SWAY` 區塊(746–753)在 `transformed.y -= …` 之後插入位移加項。四條硬規則:2.5D 距離(水平取 `swO.xz`、垂直取這個頂點的株上高度 `swH * length(swM[1])`)、方向沿用 `* swM` 轉置 idiom、**不得出現第三個 `sin(`**、**不得對零向量 `normalize()` 之後乘 0**(NaN × 0 = NaN ⇒ 整株消失)。
5. 步驟 4(⑤-1 餵入):`game.js` 新增私有 `_charSlots(dt)`(槽 0 = 主視野機體:交戰時 `this.pos`、觀戰時跟隨的那台 ent;其餘槽依離相機距離升冪取最近的 `ent.hero`;速率由位置差分經 `lerpFPS(CHAR.SPD_K, dt)` 平滑,槽位換手時該槽平滑值歸零),並在 8802 的 `stepCelWind(dt);` 之後呼叫 `setCelChar(...)`。MUST 排在 `_updateEnts`(8774)之後 —— `ent.mesh.position` 那時才是本幀插值完的值。
6. 步驟 5(⑤-1 killswitch):加 `?tread=0`(與 `?sag=0`/`?morph=0`/`?gait=0`/`?cockanim=0` 同慣例),關掉時 `_charSlots` 回空陣列 ⇒ 全槽 spd = 0 ⇒ 位移項恆 0。這同時是 `--break-char` 的對照組入口。
7. 步驟 6(⑤-1 稽核):`audit_soft_stroke` 新增 Ⅹ 段(原文不變式:位移排在 `#include <project_vertex>` 之前、距離取實例原點的 XZ、半徑吃 `uCharSpd`、空槽中性、`CHAR` 參數執行原文驗行為),並加 `--break-char` / `--break-charR` / `--break-charslot` 三支反向驗證(替換無效 MUST 當場失敗,樣式一律 `\r?\n` 容忍)。
8. 步驟 7(⑤-4 規則層):新增 `public/js/petals.js`(零 THREE、只 import `rng.js`)。內容:`PETAL` 參數表(密度 / 體積 / 落速 / 兩個擺動頻率 / 自轉角速度 / 預跑步數與步長 / lowPower 階梯)、`petalSeason(season)`(春 = 落花 / 秋 = 落葉 / 其餘不下)、`petalTones(seasonRow)`(三色調由 `accent` 與 `foliage` **推導**,權重 55/28/17)、`planPetalFields(crowns, opts, rnd)`(把落葉樹冠格點分群 → 取前 K 個最大群 → 每群一個場,群心/半徑/高度帶由該群的實例外廓推導;逐候選固定枚數亂數)、`stepPetal(p, dt, t)`(慢波 + 快顫兩頻率、逐粒隨機自轉軸、沿**場自己的中心線**環繞取模)、`prewarm(field, n = 40, h = 0.1)`。
9. 步驟 8(⑤-4 接線):`biomes.js` 在 `dynamics`(9848)之後、世界文字之前加一段:由 `items` 推導落葉樹冠清單(`VEG_DEFS[type].parts.some(p => p.key === 'foliage')`)→ `planPetalFields(..., mulberry32(gseed ^ 0x5E7A1))` → 逐色調建 `InstancedMesh(markShared(unitPlane), envMat(tone, { transparent: true, depthWrite: false, side: DoubleSide, rim: 0 }), n)`,`userData.noOutline = true`、`renderOrder` 高於世界、`frustumCulled = false`;預跑後寫一次矩陣,再 `dynamics.push((dt) => …)`。**共享 `rnd()`/`grnd()` 消耗恆為 0**。
10. 步驟 9(⑤-4 地貌閘):落點 MUST 過既有的兩道閘 —— ①`terrainEnvCode(terrain, x, z)` 不是水/沼(海面上不下花)②群心的高度帶取 `terrain.heightAt` + 樹冠高,並且**不得掛在隧道洞內**(這一輪最省的做法是只認地面樹冠、不做隧道判定 —— 樹本來就不長在洞裡);另加 `?petal=0` killswitch(關 = 整段不建立,零 mesh 零 dynamics 條目)。
11. 步驟 10(⑤-4 稽核):`audit_soft_stroke` 新增 Ⅺ 段,**真的執行 `petals.js` 的純函式**(零 THREE 的回報):兩頻率不可通約、逐粒自轉軸不是恆定 +Y、環繞取模在場的局部框內且無跳點(同 Ⅴ 對雲的那三條寫法)、預跑之後首幀的 y 分布 MUST 已跨越整個高度帶、季節閘只在春/秋開、色調由 `ENV.seasons` 推導、planner 的亂數消耗逐候選固定。加 `--break-petal` / `--break-spin` / `--break-wrap` 三支。
12. 步驟 11(回歸):跑下方 `audits` 全批;特別確認 `audit_siteplan` / `audit_beacons` / `audit_object_joints --seeds 8` / `audit_ground_*` **逐項不動**(那就是「零共享 rnd 消耗」的證明面),以及 `npm run bal` / `npm test` 逐項不動(`data.js`/`sim.js`/伺服器一行未改)。
13. 步驟 12(㋓/㋕ 與收尾):真瀏覽器量一次幀成本(4 槽 × 草列頂點數的 ALU 成本、落花的逐幀 `setMatrixAt` 上傳量),`shot_scene` 前後對照(⑤-1 關/開、⑤-4 春/秋/夏各一張);把量到的數字與「留給使用者裁決的兩件事」寫進 `docs/anime_style_plan.md` 的執行紀錄,並補 `.claude/rules/seams-render.md`、`CLAUDE.md` §2.1、`verification.md` §5.5、`public/js/.claude.md` 四處索引。

## 稽核
- `node tools/audit_soft_stroke.mjs`
- `node tools/audit_soft_stroke.mjs --break-ink`
- `node tools/audit_soft_stroke.mjs --break-anchor`
- `node tools/audit_soft_stroke.mjs --break-wave`
- `node tools/audit_soft_stroke.mjs --break-gust`
- `node tools/audit_soft_stroke.mjs --break-char`
- `node tools/audit_soft_stroke.mjs --break-charR`
- `node tools/audit_soft_stroke.mjs --break-charslot`
- `node tools/audit_soft_stroke.mjs --break-petal`
- `node tools/audit_soft_stroke.mjs --break-spin`
- `node tools/audit_soft_stroke.mjs --break-wrap`
- `node tools/audit_damp_fps.mjs`
- `node tools/audit_damp_fps.mjs --break-damp`
- `node tools/audit_client_syntax.mjs`
- `node tools/audit_cel_pipeline.mjs`
- `node tools/audit_cel_pipeline.mjs --break-inkinfo`
- `node tools/audit_gpu_lifecycle.mjs`
- `node tools/audit_visual_prefs.mjs`
- `node tools/audit_world_curve.mjs`
- `node tools/audit_object_joints.mjs --seeds 8`
- `node tools/audit_siteplan.mjs`
- `node tools/audit_beacons.mjs`
- `node tools/audit_ground_tile.mjs`
- `node tools/audit_ground_qc.mjs`
- `node tools/audit_ground_seam.mjs`
- `node tools/audit_ground_enclave.mjs`
- `node tools/audit_ground_border.mjs`
- `node tools/audit_world_edge.mjs`
- `npm run audit:net`
- `node tools/audit_solo_boot.mjs`
- `npm run bal`
- `npm test`
- `node tools/shot_scene.mjs --venue taroko --dof=0 --curve=0`

## 反向驗證
- `--break-char` — 壞版: 把 `CEL_SWAY` 區塊裡整段玩家位移(`transformed += chD * chA;` 那一行)以 `\r?\n` 容忍樣式刪掉 ⇒ **MUST 紅**: audit_soft_stroke Ⅹ 的「玩家位移排在 project_vertex 之前且真的加在 transformed 上」MUST 紅(替換無效 MUST 當場 exit 1)
- `--break-charR` — 壞版: 把擾動半徑 `CHAR.R0 + CHAR.R_PER_MPS * spd` 換成常數 `CHAR.R0` ⇒ **MUST 紅**: audit_soft_stroke Ⅹ 的「擾動半徑是速度的函式(SKILL L1 第 3 層的整個重點:走路撥開、跑步甩開)」MUST 紅
- `--break-charslot` — 壞版: 把 `setCelChar` 裡「沒填到的槽位顯式寫 spd = 0」那一行刪掉(留上一幀的值) ⇒ **MUST 紅**: audit_soft_stroke Ⅹ 的「空槽中性」行為直測 MUST 紅 —— 真的跑一次原文:餵兩台再餵一台,第二槽的速度 MUST 回 0
- `--break-petal` — 壞版: 把 `stepPetal` 的第二個頻率項(快顫)整項拿掉,只留慢波 ⇒ **MUST 紅**: audit_soft_stroke Ⅺ 的「兩頻率(一個正弦讀起來是雜訊,慢波 + 快顫才讀得出是空氣)」MUST 紅 —— 判據是逐粒軌跡的二階差分頻譜,不是文字比對
- `--break-spin` — 壞版: 把逐粒自轉軸換成固定的世界 +Y ⇒ **MUST 紅**: audit_soft_stroke Ⅺ 的「逐粒隨機自轉軸(全部繞 Y = 一地的硬幣)」MUST 紅 —— 直測 N 顆粒子的軸向量分布不得塌成一個方向
- `--break-wrap` — 壞版: 把環繞取模改回世界軸(`fract(x / WORLD)`)而不是場自己的中心線框 ⇒ **MUST 紅**: audit_soft_stroke Ⅺ 的「沿特徵中心線環繞(否則整片場慢慢飄離它該蓋住的那叢樹)」MUST 紅 —— 直測跑滿一個週期後粒子群質心相對場心的位移 MUST 恆為 0

## 會靜默壞掉的地方
- **`audit_soft_stroke` Ⅲ 的 sway 正規式跨到 `#include <project_vertex>`**(tools/audit_soft_stroke.mjs:176):非貪婪的 `#endif\n\s*#include <project_vertex>` 會一路吃過 `CEL_WAVE` 區塊 ⇒ 捕獲段同時涵蓋兩塊,而 `count(S, /sin\(/g) === 2` 因此是全域計數。⑤-1 的位移項只要用到一次 `sin(` 就會讓這一條紅,而紅字的理由(「兩個不可通約的正弦」)與真正的改動完全無關 —— 最容易被誤判成「改壞了擺動」而回頭亂改。
- **對零向量 `normalize()` 之後乘 0 = NaN**:玩家正好站在實例原點上(或全槽 spd = 0 而寫成 `normalize(d) * 0.0`)時,`normalize(vec3(0))` 產生 NaN,`NaN * 0.0` 仍是 NaN ⇒ `transformed` 變 NaN ⇒ **那一批 InstancedMesh 整批消失**,console 一個字都沒有(同 `gInfo` 漏宣告那一族的症狀)。既有的 `swD` 是用 `+ vec3(1e-6)` 迴避,新加的那一項 MUST 用早退或 `dir / max(len, 1e-4)`。
- **共享 `rnd()` 的帳**:落花規劃若誤用 `buildBiomes` 的 `rnd`/`grnd`,後面每一株植被、每一棟建物的佈局整條推移(§2.3),而畫面上只表現成「整張圖變了」,沒有任何錯誤訊息 —— `audit_siteplan`/`audit_beacons`/`audit_object_joints --seeds 8` 逐項不動就是唯一的證明面。
- **半透明落花會把場景 RT 的 alpha 推離 1**:那個通道是 A39 的勾線門檻契約(`toon.js` 檔頭「alpha ≡ 勾線門檻倍率」)。落花蓋住的像素上,背後建物邊的線會**變細**。這與「落花是軟性物質」自洽、量級也小(逐粒覆蓋率極低),但要知道它存在 —— 別在看到「有幾根線變細」時去改勾線參數。
- **槽位換手的瞬跳**:兩台機體離相機距離接近時,被擠出去的那一台在下一幀 spd 歸 0 ⇒ 它腳邊 2m 的草瞬間彈回。緩解是「換手時該槽平滑值歸零(淡入)」,但被擠出去那一側仍是硬切。這是 N 有限的必然代價,MUST 寫在 `CHAR.N` 旁邊而不是靠加大 N 掩蓋。
- **背景分頁回來的第一幀**:`stepCelWind` 已把 dt 夾在 0.25,但落花的 CPU 步進是**另一支**;不自己夾的話切回分頁那一瞬間整場落花會瞬移到地面(或飛出體積外)。MUST 用同一個夾值,並在 `petals.js` 裡註明它與 `stepCelWind` 是同一個理由。
- **速率取 `this.vel` 而不是位置差分**:攀爬(`_stepClimb` 直接定案位移)、被推擠(`solidResolve` push-out)、蓄力跳的水平移速三條路徑都不會讓 `this.vel` 反映真實位移 ⇒ 「爬梯子時腳邊的草在被撥開」或「衝刺撞牆時草還在倒」。位置差分是唯一同時涵蓋五條路徑的量。
- **世界曲面只彎頂點**:`uCharPos` 是未彎曲的世界座標,而植被頂點在著色器裡被 `worldCurve` 下沉。距離量在未彎曲空間裡 ⇒ 遠處會有偏差;但 `CURVE` 的拐點 = `combatReachM()`(打得到的東西恆為零沉降),而擾動半徑只有幾公尺 ⇒ 結構上不受影響。MUST NOT 為了「精確」去在著色器裡先 `worldCurve(uCharPos)`,那是第二份曲面實作。
- **低功耗 / 觸控裝置**:落花是新增的逐幀 `setMatrixAt` + `instanceMatrix` 上傳,而 `RES_GOV` 只調解析度、調不掉它。MUST 有 lowPower 階梯(粒子數與場數各一個上限),並在真機量過再定值 —— 現有的雨雪粒子(1600/1100 顆逐幀寫 position)是可比較的基準。
- **落花與 `?petal=0` 的關法**:MUST 是「整段不建立」(零 mesh、零 dynamics 條目),不是「建了但每幀不更新」—— 後者留著 draw call 與記憶體,對照組就不再是舊制。

## 逐位元中性

"三項合計**不動 `data.js` / `sim.js` / `server/**` 任何一行**(`ENV.seasons[].accent` 只被讀取)⇒ `npm run bal` 與 `npm test` MUST **逐項不動**,那是「純表現層沒有漏進判定」的主要證明面;`audit_siteplan` / `audit_beacons` / `audit_object_joints --seeds 8` / `audit_ground_*` 逐項不動則是「零共享 `rnd()` 消耗」的證明面。逐項細看:⑤-5 一行未改,構造上恆等。⑤-4 `?petal=0` ⇒ 整段不建立、`dynamics` 不多一條、`items` 只被讀 ⇒ 場景圖與 draw call 逐位元同舊制;開著時因為走專屬 `mulberry32(gseed ^ …)` 且逐候選固定枚數,既有佈局序列仍逐位元不動。⑤-1 `?tread=0`(或全槽 `spd = 0`)⇒ 位移項恆 0。**但這裡有一個浮點陷阱要證明,不能只說「乘 0 就好」**:①`transformed += dir * 0.0` 在 `dir` 為零向量且用 `normalize()` 時是 `NaN`,不是 0 —— 故 MUST 用 `if (spd > 0.0)` 早退(shader 分支在全槽 0 時是同一條路徑,無 divergence 成本);②即使早退,`x + 0.0` 對 `x = -0.0` 會變成 `+0.0` —— 所以位移 MUST 是**早退不加**,而不是「加一個 0」。做到這兩條,`shot_scene` 的定場照在 `?tread=0` 下與改制前 md5 相同(2026-08-13 那一輪 13 張逐位元相同的同一種驗法),那就是逐位元中性的驗收面。⚠ 反過來說:**旋鈕開著時 ⑤-1 不是逐位元中性的**(那正是這一項要交的東西),所以 MUST 先留改制前的 `shot_scene` 基準照。"

## 卡在
- **需要使用者裁決:⑤-1 的「玩家」是誰。** 計畫原文只寫「`charPos`/`charSpeed` 兩個 uniform」(= 單一角色)。我建議 **4 槽**(主視野機體 + 離相機最近的 3 台機體),理由:第三人稱與觀戰視角下兩台機體常同框,只撥開自機腳邊的草會很明顯地不對;成本是逐頂點 4 次 `length()` + `smoothstep`,落在草/稻那幾列(全場頂點數最高的 InstancedMesh)上。若使用者要維持計畫原文的單一角色(更省、且完全沒有槽位換手的瞬跳),那是一行的事 —— 但兩種都自洽,MUST 由使用者定案。
- **需要使用者裁決:落花的季節與內容語意。** 本專案的 `VEG_DEFS` **沒有櫻花樹種**(闊葉/白樺/五種針葉/灌木/紅樹林…),所以「落花」在這個世界裡沒有對應的來源幾何。我建議由既有的 `ENV.seasons[].accent` 推導:春 = 粉色落花、秋 = 橘紅落葉、夏冬不下。若使用者要「四季都有」「只在特定場地」或「真的加一款開花樹種」,那是內容決定不是實作決定。
- **需要使用者裁決(低優先):`?tread=0` / `?petal=0` 要不要升級成設定頁旋鈕。** 現行慣例是 URL killswitch(`?sag=0`/`?morph=0`/`?gait=0`/`?cockanim=0`),而 `visualPrefs` 的紀律①要求 `def` = 交付定案值 ⇒ 若做成旋鈕,兩者都該 `def = 'on'`。落花是唯一會增加逐幀 CPU 成本的一項,與 `dof`/`shadow` 同類,做成旋鈕有理由;但那會連帶動到 `audit_visual_prefs` Ⅰ 與設定頁版型。
- **需要真瀏覽器(㋓)**:GLSL 在 Node 端執行不了 ⇒ ⑤-1 的位移只能以原文不變式釘住,「看起來像不像被撥開」與「全槽 0 時真的逐位元同舊制」都只有真 GPU 量得到(`readPixels` A/B,同 audit_soft_stroke 檔頭對海浪的做法)。落花的幀成本、lowPower 階梯的實際數字、以及 `shot_scene` 的春/秋定場照同理。
- **依賴序 3(①-1 `outlineContribution`)嗎?否 —— 但有一個交會點**:落花目前靠 `depthWrite: false` 構造性地不出線(勾線 pass 是深度二階差分,深度沒被寫就看不到它)。序 3 若把 `gInfo.a` 改成打包編碼並讓最近面覆寫上線,MUST 回頭確認落花仍落在 `INK_CLASS.NONE` 那一格,否則會變成滿天黑點。這一條 MUST 寫進序 3 的檢查表,不是本輪的阻塞。
