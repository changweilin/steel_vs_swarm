# 序 11 / ⑥-2 GPGPU 鳥群 + ⑥-3 動畫權重向量(docs/anime_style_plan.md ⑥ 第 2、3 點)  (key: seq11-birds)

## 摘要

計畫 ⑥ 的現況欄正確:`locomotion.js`/`gaitcurve.js`/`morphrig.js` 的步態與變形確實比兩專案深,③ 幀率無關阻尼已於 2026-08-16(序 2)落地成 `data.js frictionFPS`/`lerpFPS`,只剩 ①鳥群 ②動畫權重向量。⑥-2 的技術路線與本專案傳統**有實質衝突**:全專案沒有任何 ping-pong render-to-texture 迴圈,`postfx.js` 是唯一的 RT 持有者與唯一消費端,而世界內容的運動傳統一律是「單一共享時鐘的零狀態純函式」(頂點著色器 `uWindT`/`celGust`/`celSeaH`,或 CPU 的 `clouds.step(celWindTime())`);GPGPU 在鳥群這個量級(數十到兩百隻)買不到任何東西,卻要付兩張浮點 RT、第二條 render 迴圈、以及「每一條斷言都變成 ㋓ 真瀏覽器」的代價 —— 反向驗證(原則 9)在 GLSL 積分器上離線做不出來。因此本規格把計畫列的四項(曲線 + 逐軸噪聲 + 弱彈簧 0.0003 + 摩擦 + 分群 + `uSnap`)**逐項保留**,只把積分器從 GPGPU 換成零 THREE 模組 `wildlife.js` 裡的純 JS(`edgewall.js`/`flags.js`/`beacons.js` 的既有紀律),曲線錨在真實圖資(水域岸線 > 神木林 > 地標,錨不到就不放)。⑥-3 的病灶已實際找出來:`game.js:8250` 的 `ent._moveSpd` 是**第二份速度推導**(未阻尼、`* 0.6` 逐幀衰減),`game.js:8281` 的 `> 3` 是**第三個離地門檻**(locomotion 用 `MORPH.GROUND_Y`=2、觀戰相機用 `SPEC_CAM.FLY_M`=2.5),`_updateMoveAudio` 又自己寫了一條 `moveGate` 速度曲線 —— 收成 `animweights.js` 一份權重向量之後,⑦-2 的 gain-ride 才有東西可吃。**⑥-3 MUST 排在序 6(⑦ 音效)之前,⑥-2 留在序 11**。

## 縫

### ⑥-2 世界動態物件的唯一每幀迴圈(dynamics → biomesUpdate)
`public/js/biomes.js:9848`

現行:
```js
  // ---- 鐵路/捷運(含行駛列車)+ 瀑布(動態物件)----
  await onProgress?.(0.92, '鋪設鐵路與瀑布…');
  const dynamics = [];
  buildWaterEdges(group, terrain, dynamics);   // 水岸波浪(動態)+ 沼澤潮間帶(靜態)
  const railLines = osmData?.rails?.length ? buildRails(group, osmData.rails, terrain, center, dynamics, osmData.crossings) : 0;
  const fallsBuilt = osmData?.falls?.length ? buildWaterfalls(group, osmData.falls, terrain, center, dynamics) : 0;
…
  if (dynamics.length) {
    group.userData.update = (dt) => { for (const fn of dynamics) fn(dt); };
  }
```

**改成**: 在 `buildWaterEdges` 之後、`buildRails` 之前插一行 `buildFlocks(group, terrain, dynamics, { anchors, lowPower: lowPower() });`,更新函式 push 進**既有的** `dynamics`。MUST NOT 在 game.js 另開第二條更新迴圈(climb.js:598 與 biomes.js:9864 已把這條寫死);MUST NOT 自己數一份 dt —— 時鐘吃 `celWindTime()`(見下一列)。

### ⑥-2 全場共用的風時鐘(零狀態運動的唯一時間來源)
`public/js/toon.js:540`

現行:
```js
export function stepCelWind(dt) {
  _windT.value += Math.min(0.25, Math.max(0, dt || 0));
}

/** 目前的風時鐘(秒);雲朵那半(environment.js)與植被同吃一個時鐘 */
export function celWindTime() { return _windT.value; }
```

**改成**: 鳥群的解 MUST 吃 `celWindTime()`,MUST NOT 自己累加 dt(暫停一次就與地面上的草、天上的雲錯開;`stepCelWind` 已內建背景分頁的 dt 夾制 0.25s,自己數一份就要再寫一次那道保險)。摩擦項 MUST 走 `data.js frictionFPS(k, dt)`,MUST NOT 寫 `v *= 0.99`。

### ⑥-2 零狀態純函式運動的既有範本(雲)
`public/js/environment.js:502`

現行:
```js
      if (clouds) {
        clouds.obj.position.copy(camera.position);
        // 時鐘吃 `celWindTime()`(植被/旗幟同一支):自己數一份 dt 的話,暫停一次就與地面錯開
        clouds.step(celWindTime());
      }
…
    step(t) {
      for (const d of drift) {
        // 取模 MUST 先加半個 WRAP 再減:JS 的 % 對負數回負值,直接取模會讓半邊的雲跳到另一側
        const a = ((d.along + WIND.CLOUD_MPS * t + WRAP * 0.5) % WRAP + WRAP) % WRAP - WRAP * 0.5;
```

**改成**: 不改這一支。它是「CPU 端逐幀重算、零累積狀態、純 t 的函式」在本專案的既有落點 —— 鳥群的 `flockStep(t, dt)` 照這個形狀寫,差別只在鳥群有**速度狀態**(彈簧 + 摩擦要積分),所以另加一條 `uSnap` 等價的 `flockSnap()` 供出生/重生/瞬移時把速度歸零並貼到曲線上。

### ⑥-2 曲線錨點 ①:水域岸線(整格掃描 + 零共享 rnd 的既有範本)
`public/js/biomes.js:5105`

現行:
```js
function buildWaterEdges(group, terrain, dynamics) {
  const wy = terrain.waterY;
  if (wy == null) return;
  const { minX, maxX, minZ, maxZ } = terrain;
  const cols = Math.min(256, Math.max(1, Math.ceil((maxX - minX) / 8)));
  const rows = Math.min(256, Math.max(1, Math.ceil((maxZ - minZ) / 8)));
…
  for (let i = 0; i < rows; i++) for (let j = 0; j < cols; j++)
    code[i * cols + j] = terrainEnvCode(terrain, ccx[j], ccz[i]);
```

**改成**: 不改這一支;`buildFlocks` 照抄它的取樣手法(`terrainEnvCode` 整格掃 + 純幾何 + **一枚共享 rnd 都不抽**),把「水域緊鄰非水」的格子串成岸線 run,取最長那一條當第一順位曲線。`terrain.waterY == null` ⇒ 這一類鳥群直接不放(原則 6),MUST NOT 退回「擺在地圖中央」。

### ⑥-2 曲線錨點 ②③:神木林 / 地標
`public/js/biomes.js:8371`

現行:
```js
  const giantTrees = placeGiantGroves({ terrain, blocked, blockers, items, rnd, sites: greenSites });
…
  const landmarkG = [];                               // 地標群組 + 佔地半徑(clearAround 一併隱藏整棟)
…
    landmarkG.push({ g, x: lm.x, z: lm.z, r: (LANDMARK_COL[lm.type]?.r || 10) * sc });
```

**改成**: `buildFlocks` 的錨點清單由**既有已定案的幾何**推導,一次 fetch 都不加:`giantTrees`(棲地環線,兩片林子之間)與 `landmarkG`(高塔上的熱氣柱盤旋)。MUST NOT 拿兵線 / 塔位 / 主堡當錨(那是戰鬥家具,鳥繞著前線飛讀起來就是腳本);三類錨全部拿不到 ⇒ 這張圖沒有鳥群。呼叫點 MUST 排在這兩者**之後**。

### ⑥-2 座標雜湊種子(零共享 rnd 的既有縫)
`public/js/beacons.js:319`

現行:
```js
export function beaconSeed(x, z) {
  const h = (Math.imul(Math.round(x * 8) | 0, 0x9E3779B1) ^ Math.imul(Math.round(z * 8) | 0, 0x85EBCA77)) | 0;
  return Math.imul(h ^ (h >>> 15), 0xC2B2AE3D) >>> 0;
}
```

**改成**: `wildlife.js` 照這個形狀寫 `flockSeed(x, z)`,逐鳥的相位 / 速度抖動 / 群組偏移一律由它餵自己的 `mulberry32`(`rng.js`)。**零共享 `rnd()` 消耗**(§2.3 / A4):多抽一枚就把後面每一株植被、每一棟建物的佈局整條推移,而畫面上只表現成「整張圖變了」。

### ⑥-2 GPGPU 可行性的實際閘門(WebGL2 是條件不是前提)
`public/js/postfx.js:245`

現行:
```js
    // 勾線資訊緩衝的能力閘:three 0.160 的 MRT 是 `WebGLMultipleRenderTargets`
    //(`WebGLRenderTarget({ count })` 是 r162 之後才有的),而它只在 WebGL2 上成立。
    // **能力與開關分開記**:開關可以即時切,能力不會變。
    this._mrtCap = renderer.capabilities.isWebGL2 === true
      && typeof THREE.WebGLMultipleRenderTargets === 'function';
```

**改成**: 不改。這一行是「WebGL2 在本專案是**能力探測**不是保證」的證據:GPGPU 路線一樣要寫一份 fallback(否則 WebGL1 機器上鳥群整批消失),而 fallback 就是 CPU 解算 —— 於是變成兩份實作(縫的反面)。落地採 CPU 單一實作;若使用者裁決要 GPGPU,同一條能力閘 MUST 抽成共用的一支,MUST NOT 在 wildlife.js 抄第二份。

### ⑥-2 進場景的自寫 ShaderMaterial 契約(決定鳥群材質怎麼寫)
`public/js/toon.js:160`

現行:
```js
export const INK_INFO_DECL = 'layout(location = 1) out highp vec4 gInfo;';
export const INK_INFO_NONE = 'gInfo = vec4( 0.0 );';   // 哨兵 0 = 這一格沒有法線資訊
```

**改成**: 鳥群材質 MUST 走既有的 `toonMat()`(經 `hazards.js` re-export,biomes.js 已 import)⇒ gInfo 由 cel 補丁自動寫入、勾線與 A25 全部沿用既有路徑,**一支新的 ShaderMaterial 都不加**。這同時讓 `audit_cel_pipeline` Ⅵ 的計數(`tools/audit_cel_pipeline.mjs:328` 的 `decl < n`)不必動:目前只有 environment.js / vfx.js 各一支自寫材質。若日後改走 GPGPU,compute 材質會讓那個計數要求同檔宣告 ≥ 支數,而把 wildlife.js 加進 `EXPT` 名單就等於對鳥群的 render 材質關掉這道閘 —— MUST NOT。

### ⑥-3 動畫狀態的唯一產生點(ent.loco)
`public/js/locomotion.js:56`

現行:
```js
  let L = ent.loco;
  if (!L) {
    L = ent.loco = {
      vx: 0, vz: 0, speed: 0, accel: 0,
      roll: 0, pitch: 0, amp: 0, lean: 0, ts: 0,
      ph: phaseOf(ent.id),
    };
  }
  // 世界速度(位移差分再阻尼平滑:8Hz 快照插值的鋸齒不進骨架)
  L.vx = damp(L.vx, (mesh.position.x - px) / dt, 6, dt);
  L.vz = damp(L.vz, (mesh.position.z - pz) / dt, 6, dt);
  const speed = Math.hypot(L.vx, L.vz);
```

**改成**: `stepLocomotion` 收尾(在 `stepJumpPose`/`morphPose` 之後、`return` 之前)加一行 `L.w = animWeights(L, rig, { groundY: MORPH.GROUND_Y, aim: rig._aim || 0, flies: !!ent.flies, y: ent.heroY || 0 });`。**只寫一格、不讀任何新東西** ⇒ 既有步態逐位元不動。`L.w` 是全專案「他現在在做什麼」的唯一真相。

### ⑥-3 病灶 A:第二份速度推導
`public/js/game.js:8249`

現行:
```js
      // 水平移動速率(m/s):餵移動環境音的音量/音高(_updateMoveAudio);瞬移幀不計
      ent._moveSpd = (!snapped && dt > 0) ? Math.hypot(nx - px, nz - pz) / dt : (ent._moveSpd || 0) * 0.6;
```

**改成**: 整行刪除。它與 `locomotion.js:67` 的 `L.speed` 量同一件事而不同結果(這一份未阻尼、吃 8Hz 插值鋸齒;`* 0.6` 還是逐幀常數 = 幀率相依,序 2 漏掉的一處)。消費端改讀 `ent.loco?.w`。

### ⑥-3 病灶 B:第三個「離地」門檻
`public/js/game.js:8281`

現行:
```js
    if (ent.hero && ent.ch) {
      const v = CHARACTERS[ent.ch]?.visual || {};
      if (ent.flies || (ent.heroY || 0) > 3) {       // 升空:依飛行型
        const fl = v.flight;
        if (fl === 'heli' || fl === 'tilt') return 'rotor';
```

**改成**: `> 3` 改吃 `ent.loco?.w.air > 0.5`,而 `air` 在 `animweights.js` 裡由呼叫端注入的 `groundY` 決定(= `MORPH.GROUND_Y`,`locomotion.js:1139` 的同一條)。現況三個門檻各說各話:locomotion 換樹在 2m、`SPEC_CAM.FLY_M` 取景在 2.5m(`data.js:1119`)、這裡的環境音在 3m ⇒ 2~3m 之間機體已經是飛行型而音床還在踏地。門檻**注入不寫死**沿用 `edgewall.js` 的紀律(坡度門檻由呼叫端注入)。

### ⑥-3 病灶 C:音效自己重推「他在不在動」
`public/js/game.js:8319`

現行:
```js
      // 地面型(引擎/踏地)靜止仍有怠速底噪但小;飛行型(旋翼/翅膀)本就常動
      const moveGate = (cat === 'stomp' || cat === 'engine')
        ? cl(0.35 + b.spd * 0.09, 0.35, 1)
        : cl(0.5 + b.spd * 0.05, 0.5, 1);
      const presence = cl(dist * dens * moveGate, 0, 1);               // 0..1;類別基準響度在 audio 端乘
      const hl = Math.hypot(b.dx, b.dz) || 1;
      const pan = cl((e[0] * b.dx + e[2] * b.dz) / hl, -1, 1);
      const rate = cl(0.8 + b.spd * 0.05, 0.7, 1.5);                   // 速度→音高/斬波速
```

**改成**: `moveGate` 與 `rate` 改吃權重:`moveGate = idleFloor + (1 - idleFloor) * (w.walk + w.run)`、`rate = 0.8 + w.run * K`。`best[cat]` 收的 `spd: ent._moveSpd || 0` 改成 `w: ent.loco?.w || null`。⑦-2 的 gain-ride 常駐 stem 直接吃同一份 `w` ⇒ 「走進水裡踏空一拍」那條的地面變體交叉淡入才可能同相。

### ⑥-3 交戰姿態權重的既有來源(不搬家,只收進向量)
`public/js/locomotion.js:214`

現行:
```js
  rig._aim = C.aim; rig._aimH = C.hA; rig._kickL = C.kL; rig._kickR = C.kR; rig._kickB = C.kB; rig._chg = C.chg;
…
  const braceF = clamp(rig._aim || 0, 0, 1);
  hips.position.x = sw * (rig.sway || 0.05) * a * (1 - bnd) * (1 - 0.6 * braceF);
```

**改成**: `rig._aim`/`_aimH`/`_chg` 仍由 `stepCombatFx` 產出(唯一縫不動),`animWeights` 只是**讀**它們填進 `w.aim`/`w.charge`。`braceF`(locomotion.js:644)是 `rig._aim` 的推論、`audit_gait_anat` Ⅷ①b 釘著它「只吃開火窗不吃 idle」⇒ **MUST NOT** 改成讀 `w.aim` 以外的任何東西,那八條斷言要逐項不動。

### ⑥-3 玩家自機沒有 loco(權重向量的缺口)
`public/js/game.js:8139`

現行:
```js
  _updateEnts(dt, now) {
    for (const ent of this.ents.values()) {
      if (ent.isSelf) {
        ent.mesh.position.copy(this.pos);
        continue;
      }
```

**改成**: 自機在這裡早退 ⇒ **玩家自己沒有 `loco`、也沒有權重**。⑦-2 若要給玩家自己的腳步/引擎 stem,MUST 在 `_updatePlayer` 收尾用同一支 `animWeights` 從 `this.vel` / `this._flying()` / `this.charge` 組一份 `this._selfW`,MUST NOT 在音效端另寫一條「玩家版」判斷(那就是第二份實作)。本輪只需把這個口子留好並在稽核裡釘住「權重函式恰一份、兩個呼叫端」。

## 寫入檔案
- `public/js/animweights.js` (create) — ⑥-3 動畫權重向量唯一縫。零 import(同 gaitcurve.js / morphrig.js / visualPrefs.js):門檻由呼叫端注入 ⇒ 離線稽核直接執行真品,不必 mock three/data.js。匯出 `WEIGHT_KEYS`(有序鍵集)+ `animWeights(L, rig, opts)`。
- `public/js/locomotion.js` (edit) — ⑥-3:`stepLocomotion` 收尾寫入 `L.w = animWeights(...)`(唯一產生點);import 一行。既有步態一行不動。
- `public/js/game.js` (edit) — ⑥-3:刪 `ent._moveSpd`(8249)、`_moveCat` 的 `> 3` 改吃 `w.air`(8281)、`_updateMoveAudio` 的 `moveGate`/`rate`/`best[].spd` 改吃 `ent.loco?.w`(8300~8328)。⑥-2 完全不動 game.js(走 biomesUpdate)。
- `public/js/wildlife.js` (create) — ⑥-2 鳥群唯一縫。**零 THREE、只 import `rng.js`**(同 edgewall.js / flags.js):FLOCK 參數、`flockSeed`、曲線規劃 `planFlockRoutes({probe, bounds, anchors})`、四項積分器 `flockStep(state, t, dt)`、`flockSnap(state)`、以及**純資料的鳥零件表** `birdParts()`(外廓 ⇒ 剪影下限離線量得到)。
- `public/js/biomes.js` (edit) — ⑥-2:新增 `buildFlocks(group, terrain, dynamics, opts)`(建 InstancedMesh + 每幀更新推進既有 `dynamics`),呼叫點插在 9849 附近(MUST 排在 `placeGiantGroves`/`landmarkG` 之後)。import wildlife.js。
- `tools/audit_wildlife.mjs` (create) — ⑥-2 的離線稽核(直接 import 零 THREE 的 wildlife.js 執行真品):四項各自的行為證明 + 零共享 rnd + 錨不到就不放 + 剪影下限 + 幀率無關。含七支 `--break-*`。
- `tools/audit_anim_weights.mjs` (create) — ⑥-3 的離線稽核:權重向量恰一份、離地門檻恰一份、速度推導恰一份、消費端不得自己重推、鍵集推導不手寫、`loco = null` 的一幀不得產出 NaN。含五支 `--break-*`。
- `tools/audit_damp_fps.mjs` (edit) — ⑥-1 的掃描名冊目前只有 `game.js` / `locomotion.js`(第 62~67 行的迴圈)。新增的 `wildlife.js`/`animweights.js` MUST 進那個名冊,否則新模組裡的 `Math.min(1, dt*k)` / 第二份 `Math.exp` 掃不到。
- `docs/anime_style_plan.md` (edit) — 執行紀錄追加一列(序 11 與 ⑥-3);⑥ 那一節註記「GPGPU → CPU 零狀態積分器」的裁決與理由,以及 ⑥-3 提前到序 6 之前的排序更動。
- `.claude/rules/seams-world.md` (edit) — ⑥-2 的縫全文(鳥群曲線 = 美術方向的落點、四項缺一不可、零共享 rnd、錨不到就不放、剪影下限)住 §2.1 G。
- `.claude/rules/seams-render.md` (edit) — ⑥-3 的縫全文(動畫權重向量:唯一產生點、注入門檻、消費端名冊、與 `braceF`/`rig._aim` 的分工)住 §2.1 F,緊接「幀率無關阻尼」那一列。
- `.claude/rules/verification.md` (edit) — §5.1(續)加兩支稽核指令;§5.5 加兩列「改了什麼 → 跑什麼」。
- `CLAUDE.md` (edit) — §2.1 目錄:`seams-world.md` 那一列的主題名加「鳥群與野生動物」、`seams-render.md` 那一列加「動畫權重向量」。編號一格不動。
- `public/js/.claude.md` (edit) — §1 檔案職責地圖各加一列(`wildlife.js`、`animweights.js`),寫明零 import / 零 THREE 的邊界理由。

## 步驟
1. 步 0(先做,量基準):`node tools/audit_gait_anat.mjs > /tmp/gait.before.txt`、`npm run bal > /tmp/bal.before.txt`、`node tools/audit_siteplan.mjs`/`audit_beacons`/`audit_object_joints --seeds 8`/`audit_ground_tile` 各存一份輸出 —— 後面兩項都要「逐項不動」,沒有基準就證不出來。
2. 步 1(⑥-3,MUST 先於序 6):建 `public/js/animweights.js`。零 import。`WEIGHT_KEYS = ['idle','walk','run','air','land','aim','charge','morph','surge','brake']`(有序;逐鍵註明來源欄位)。`animWeights(L, rig, opts)` 純函式:`amp = L.amp` 分成 walk/run(以 `rig.top` 正規化後的既有 `L.amp` 為輸入,MUST NOT 重新算速度)、`idle = 1 - (walk+run)`、`air` 由注入的 `opts.groundY` 與 `opts.y`/`opts.flies` 決定、`land = L.landK`、`aim = opts.aim`、`charge = |L.act|` 或 `rig._chg`、`morph = L.morph`、`surge/brake = L.srg/L.brk`。三條硬規則寫進檔頭:①**地面三軌(idle/walk/run)和恆為 1**(讓 gain-ride 的交叉淡入不會忽大忽小)②**每一格恆為有限數**(`L` 缺欄一律回 0,不得回 NaN)③**鍵集由 `WEIGHT_KEYS` 推導,MUST NOT 在消費端手寫字串**。
3. 步 2(⑥-3):`locomotion.js` import `animWeights` 並在 `stepLocomotion` 收尾(`morphPose` 那一行之後)寫 `L.w = animWeights(L, rig, { groundY: MORPH.GROUND_Y, aim: rig._aim || 0, flies: !!ent.flies, y: ent.heroY || 0 })`。**只寫不讀** ⇒ 步態逐位元不動,`audit_gait_anat` 八段輸出 MUST 與步 0 的基準逐字相同。
4. 步 3(⑥-3):`game.js` 三處改寫 —— 刪 8249 的 `ent._moveSpd`;`_moveCat`(8281)的 `> 3` 改成 `(ent.loco?.w?.air || 0) > 0.5`;`_updateMoveAudio`(8300~8328)的 `best[cat]` 改收 `w`、`moveGate`/`rate` 改吃 `w.walk + w.run` 與 `w.run`。**MUST 先過 null 守衛**:`ent.loco` 在重生瞬移那一幀被設成 null(game.js:8160),沒有守衛就是 NaN 進 `setTargetAtTime`,那會丟例外把整條幀迴圈打斷。
5. 步 4(⑥-3):寫 `tools/audit_anim_weights.mjs`。直接 `import * as W from '../public/js/animweights.js'` 執行真品(它零 import),原文那半走 `readSrc`。六段:Ⅰ 縫只有一份(`animWeights` 恰一份宣告;`game.js`/`audio.js` 各自 0 處速度推導);Ⅱ 離地門檻只有一份(`game.js` 全檔不得再出現 `heroY || 0) > 3`,`animweights.js` 不得寫死度量,門檻由 opts 注入);Ⅲ 數學(地面三軌和 = 1;缺欄回 0 不回 NaN;鍵集 = `WEIGHT_KEYS`);Ⅳ 消費端(`_updateMoveAudio` 讀 `loco?.w`、有 null 守衛、不得再出現 `b.spd`);Ⅴ 鍵集推導(消費端不得出現字面字串 `'walk'`/`'run'` 以外的手寫鍵表);Ⅵ 幀率無關(`animweights.js` 零 `Math.min(1, dt*k)`、零第二份 `Math.exp`)。
6. 步 5(⑥-3 收尾):跑下方 audits 的 ⑥-3 那一組 + §5.2 的重啟伺服器流程;把 `audit_gait_anat` 輸出與步 0 基準 diff,MUST 零差異。更新三份文件(seams-render.md / verification.md / public/js/.claude.md)。**到此 ⑦-2 才有東西可吃 —— 序 6 從這裡才開得動。**
7. 步 6(⑥-2,可與序 6 平行,但要等使用者對 GPGPU 的裁決):建 `public/js/wildlife.js`。零 THREE、只 import `rng.js`。內容五塊:①`FLOCK` 參數(`SPRING = 0.0003`、`FRICTION_K`、`GROUPS`、逐軸 `NOISE_AMP`/`NOISE_TS = [0.05, 0.10, 0.025]`、`SPEED_JITTER`、`CURVE_N` 曲線取樣點數、`ALT_BAND` 離地高帶、`COUNTS` 逐錨點類型的隻數 —— 隻數 MUST 按 SKILL 的語意選:2 = 一對 / 3 = 幾隻 / ≥4 = 一群)②`flockSeed(x, z)` 座標雜湊(照 beacons.js:319)③`planFlockRoutes({ probe, bounds, anchors })`:純幾何、**零共享 rnd**、回傳 `[{ kind, pts: Float32Array(CURVE_N*3), n, seed }]`,錨點順位 水域岸線 > 神木林 > 地標,一個都錨不到就回空陣列 ④`flockStep(st, t, dt)` 四項積分器(曲線目標 + 逐軸不同時標的噪聲 + 弱彈簧 0.0003 + `frictionFPS` 摩擦;分群偏移 = `hash(i) % GROUPS` 沿曲線推進度;逐鳥速度抖動)⑤`flockSnap(st)`(= `uSnap`:貼到目標並把速度歸零)⑥`birdParts()` 純資料零件表(身/翼/尾,含長寬 ⇒ 外廓與剪影下限離線量得到)。**噪聲 MUST 是座標雜湊型的確定性 sin-hash,MUST NOT 用 `Math.random()`**。
8. 步 7(⑥-2):`biomes.js` 新增 `buildFlocks(group, terrain, dynamics, { anchors, lowPower })`。逐路線一個 `THREE.InstancedMesh`(身/翼各一 = 每群 2~3 個 draw call),材質走既有 `toonMat()`(⇒ gInfo 自動、勾線由 postfx 螢幕空間 pass 給,**不掛反轉外殼描邊**,同 beacons.js 的紀律)。每幀更新函式:呼叫 `flockStep(st, celWindTime(), dt)`,用**模組層的 scratch `Matrix4`/`Vector3`/`Quaternion`** 逐鳥 `setMatrixAt` 並 `instanceMatrix.needsUpdate = true`;翅膀拍動 = 同一支 scratch 迴圈裡多算一顆四元數(相位 = `flockSeed` 的逐鳥常數 + `celWindTime()`),零額外 CPU 分配。`mesh.frustumCulled = false`(整群橫跨全圖,包圍球會過期);**MUST NOT 設 `castShadow`**(投影旗標只有 `makeUnit` 與 `buildGroundCover` 兩個縫,§2.1 F 時間流逝 ⑧)。高度 MUST 夾在 `objHeightMax()` 之下、水平夾在 `edgeWallInsetM()` 之內(飛出圖界會被世界曲面的頂點著色器往下沉,看起來像鳥往地平線俯衝)。`lowPower` ⇒ 隻數減半或整組不建(同移動環境音的降級)。killswitch `?birds=0`(同 `?gait=0`/`?morph=0`/`?sag=0` 的慣例)。
9. 步 8(⑥-2):把 `buildFlocks(...)` 的呼叫插進 `biomes.js:9849` 那一段(`buildWaterEdges` 之後),更新函式 push 進**既有的** `dynamics`。**不動 game.js 一行。**
10. 步 9(⑥-2):寫 `tools/audit_wildlife.mjs`。直接 import 零 THREE 的 wildlife.js 執行真品:Ⅰ 檔案邊界(零 THREE、只 import rng.js、零 `Math.random`);Ⅱ 四項各自的**行為證明**(見下方 reverseChecks 的期望紅字);Ⅲ 分群(同一時刻沿曲線的弧長分佈跨度 ≥ 曲線長 × 一個門檻);Ⅳ 零共享 rnd(用計數型假 rnd 餵 `planFlockRoutes`,消耗 MUST 恰為 0);Ⅴ 錨不到就不放(空錨點 ⇒ 回空陣列);Ⅵ 剪影下限(`birdParts()` 的最大水平跨距 ≥ 0.3m、且要同時有「翹起的尾」與「離開頭部輪廓的喙」那兩個特徵件 —— SKILL 的 prop-scale 規則);Ⅶ 幀率無關(同一段時間切成 30/60/144fps 三種步長跑,終點位置差 < 容差 —— 摩擦走 `frictionFPS` 的直接推論)。
11. 步 10(⑥-2 收尾):跑下方 audits 的 ⑥-2 那一組。**零共享 rnd 的證明是這一輪最重要的一條**:`audit_siteplan` / `audit_beacons` / `audit_object_joints --seeds 8` / `audit_ground_tile` 的輸出 MUST 與步 0 的基準逐字相同(抽一枚就整張圖的植被與建物佈局推移,而畫面上只表現成「整張圖變了」)。更新四份文件。

## 稽核
- `node tools/audit_anim_weights.mjs`
- `node tools/audit_anim_weights.mjs --break-second`
- `node tools/audit_anim_weights.mjs --break-thresh`
- `node tools/audit_anim_weights.mjs --break-sum`
- `node tools/audit_anim_weights.mjs --break-gate`
- `node tools/audit_anim_weights.mjs --break-hand`
- `node tools/audit_gait_anat.mjs`
- `node tools/audit_gait_anat.mjs --break-lock`
- `node tools/audit_gait_anat.mjs --break-duty`
- `node tools/audit_gait_anat.mjs --break-hip`
- `node tools/audit_gait_anat.mjs --break-rest`
- `node tools/audit_gait_anat.mjs --break-posture`
- `node tools/audit_morph_rig.mjs`
- `node tools/audit_paper_doll.mjs`
- `node tools/audit_damp_fps.mjs`
- `node tools/audit_damp_fps.mjs --break-damp`
- `node tools/audit_wildlife.mjs`
- `node tools/audit_wildlife.mjs --break-spring`
- `node tools/audit_wildlife.mjs --break-noise`
- `node tools/audit_wildlife.mjs --break-friction`
- `node tools/audit_wildlife.mjs --break-group`
- `node tools/audit_wildlife.mjs --break-rnd`
- `node tools/audit_wildlife.mjs --break-anchor`
- `node tools/audit_wildlife.mjs --break-snap`
- `node tools/audit_client_syntax.mjs`
- `node tools/audit_client_syntax.mjs --break-glsl`
- `node tools/audit_cel_pipeline.mjs`
- `node tools/audit_cel_pipeline.mjs --break-inkinfo`
- `node tools/audit_gpu_lifecycle.mjs`
- `node tools/audit_soft_stroke.mjs`
- `node tools/audit_visual_prefs.mjs`
- `node tools/audit_daynight.mjs`
- `node tools/audit_world_curve.mjs`
- `node tools/audit_world_height.mjs`
- `node tools/audit_world_edge.mjs`
- `node tools/audit_siteplan.mjs`
- `node tools/audit_beacons.mjs`
- `node tools/audit_object_joints.mjs --seeds 8`
- `node tools/audit_ground_tile.mjs`
- `node tools/audit_ground_seam.mjs`
- `node tools/audit_ground_qc.mjs`
- `node tools/audit_ground_border.mjs`
- `node tools/audit_ground_enclave.mjs`
- `node tools/audit_open_tunnel.mjs`
- `node tools/audit_underpass.mjs`
- `node tools/audit_road_joint.mjs`
- `node tools/audit_world_text.mjs`
- `node tools/audit_spectator_cam.mjs`
- `node tools/audit_view_lock.mjs`
- `node tools/audit_npc_collide.mjs`
- `node tools/audit_blood_splat.mjs`
- `node tools/audit_solo_boot.mjs`
- `npm run audit:net`
- `npm run bal`
- `netstat -ano | grep :8620`
- `node server/server.js`
- `npm test`
- `SVS_URL=http://localhost:8620 node tools/audit_muzzle.mjs`
- `SVS_URL=http://localhost:8620 node tools/audit_cockpit.mjs`
- `SVS_URL=http://localhost:8620 node tools/audit_cast_jump.mjs`
- `node tools/shot_scene.mjs --venue taroko`
- `node tools/shot_scene.mjs --venue taroko --dof=0 --curve=0`
- `node tools/audit_ground_drape.mjs`

## 反向驗證
- `--break-spring` — 壞版: `FLOCK.SPRING` 0.0003 → 0.05(把弱彈簧寫回強彈簧) ⇒ **MUST 紅**: audit_wildlife Ⅱ①「彈簧夠弱:跑 60s 後逐鳥位置離曲線最近點的 RMS 距離 ≥ FLOCK.SPREAD_MIN」MUST 紅 —— 強彈簧 = 鳥群可見地飛曲線(SKILL 的 symptom 表第 2 列)
- `--break-noise` — 壞版: 三軸噪聲改吃同一個時標(`NOISE_TS` 三格都設成 0.05) ⇒ **MUST 紅**: audit_wildlife Ⅱ②「三軸的位移序列兩兩相關係數 < 0.5」MUST 紅 —— 同時標 = 球形抖動,讀起來是蟲不是鳥
- `--break-friction` — 壞版: 拿掉 `vel *= frictionFPS(...)` 那一行 ⇒ **MUST 紅**: audit_wildlife Ⅱ③「速度有界:跑 120s 的 |v| 峰值 ≤ FLOCK.V_MAX」MUST 紅 —— 沒有摩擦時彈簧積分成振盪,鳥群繞著曲線公轉
- `--break-group` — 壞版: `FLOCK.GROUPS` → 1(取消分群偏移) ⇒ **MUST 紅**: audit_wildlife Ⅲ「同一時刻整群沿曲線的弧長跨度 ≥ 曲線長 × SPREAD_F」MUST 紅 —— 全部擠在曲線上同一點
- `--break-rnd` — 壞版: 在 `planFlockRoutes` 裡插一次 `rnd()` 呼叫(模擬「順手抽一枚」) ⇒ **MUST 紅**: audit_wildlife Ⅳ「零共享 rnd 消耗」MUST 紅(計數型假 rnd 量到 1 次)。⚠ 這一條是本輪最重要的反向驗證:真的抽了一枚,整張圖的植被/建物佈局全部推移而**沒有任何錯誤訊息**
- `--break-anchor` — 壞版: 錨點清單為空時改成退回「戰場中心一條圓環」 ⇒ **MUST 紅**: audit_wildlife Ⅴ「錨不到就不放(空錨點 ⇒ 回空陣列)」MUST 紅 —— 原則 6 寧缺勿錯;繞著戰場中心飛的鳥就是「沒有真實理由」的那種鳥
- `--break-snap` — 壞版: `flockSnap` 只貼位置不歸零速度 ⇒ **MUST 紅**: audit_wildlife Ⅱ④「snap 之後第一步的位移 ≤ 曲線切向步長 × 容差」MUST 紅 —— 殘留速度會讓出生那一瞬間整群甩出去
- `--break-second` — 壞版: 把 `ent._moveSpd = …` 那一行寫回 game.js ⇒ **MUST 紅**: audit_anim_weights Ⅰ「速度推導恰一份(game.js 全檔 0 處 `/ dt` 的水平速度差分)」MUST 紅
- `--break-thresh` — 壞版: `_moveCat` 的離地判定寫回 `(ent.heroY || 0) > 3` ⇒ **MUST 紅**: audit_anim_weights Ⅱ「離地門檻只有一份、且由呼叫端注入」MUST 紅(game.js 出現第二個寫死的高度門檻)
- `--break-sum` — 壞版: `animWeights` 的 `idle` 改成獨立算(不再是 `1 - walk - run`) ⇒ **MUST 紅**: audit_anim_weights Ⅲ①「地面三軌和恆為 1(掃 0~2×top 的速度掃描,誤差 < 1e-9)」MUST 紅 —— 和不為 1 時 gain-ride 的交叉淡入會在中間速度掉一塊音量
- `--break-gate` — 壞版: `_updateMoveAudio` 的 `moveGate` 寫回吃 `b.spd` ⇒ **MUST 紅**: audit_anim_weights Ⅳ「消費端只讀 `loco?.w`,不得再出現 `b.spd` / 自己的速度曲線」MUST 紅
- `--break-hand` — 壞版: 在 `animweights.js` 加一張逐機種名冊(`if (kind === 'drone') …`) ⇒ **MUST 紅**: audit_anim_weights Ⅴ「鍵集與分軌一律推導,MUST NOT 出現逐機種/逐角色名冊」MUST 紅(同 A33 ⑤ 的紀律)
- `--break-damp` — 壞版: (既有)`lerpFPS` 換回 `Math.min(1, k*dt)` ⇒ **MUST 紅**: audit_damp_fps Ⅱ 的互補/可加性/幀率無關三條 MUST 紅;**且 audit_wildlife Ⅶ「幀率無關」也 MUST 跟著紅**(鳥群的摩擦項吃同一支)
- `--break-inkinfo` — 壞版: (既有)拿掉 vfx.js 的 `INK_INFO_DECL` ⇒ **MUST 紅**: audit_cel_pipeline Ⅵ「每一支都宣告了 gInfo」MUST 紅。⑥-2 落地後這一段的 `scanned` 計數 MUST **不變**(鳥群走 `toonMat`,一支新的 ShaderMaterial 都沒加);計數變了就是有人自己寫了材質

## 會靜默壞掉的地方
- ⑥-2 的曲線規劃只要抽一枚共享 `rnd()`,後面每一株植被、每一棟建物、每一個地標的落點整條推移(§2.3 / A4)—— 畫面上只表現成「整張圖變了」,**沒有任何錯誤訊息**,而且 `audit_siteplan`/`audit_beacons` 會照常全綠(它們驗規則不驗序列)。唯一的防線是步 0 存的基準輸出逐字比對。
- ⑥-2 的 InstancedMesh 若留著 `frustumCulled = true` 而不更新包圍球:整群鳥在某些鏡頭角度整批消失、轉回來又出現,間歇性、零錯誤訊息(`makeClouds` 就是靠 `grp.frustumCulled = false` 躲掉這一條)。
- ⑥-2 忘記 `instanceMatrix.needsUpdate = true`:鳥群凍結在出生位置,而每一支稽核(包含新寫的 audit_wildlife,它驗的是 wildlife.js 的解算不是 GPU 上傳)都全綠。這一條只有 ㋓ 真的看一眼才抓得到。
- ⑥-2 逐幀在鳥迴圈裡 `new THREE.Matrix4()` / `new THREE.Vector3()`:N × fps 次配置,只表現成幀時間慢慢漂,而 `audit_gpu_lifecycle` ④ 只掃 `beamLine`/`axisCylinder`/`shockRing` 那幾支具名的高頻特效,新模組不在它的名冊裡。
- ⑥-2 若把鳥群材質寫成自寫的 ShaderMaterial 而漏了 `INK_INFO_DECL`:**開啟折邊勾線的那一刻整群鳥消失**(WebGL2 的 INVALID_OPERATION,console 一個字都沒有)。走 `toonMat()` 是結構性地避開這條。
- ⑥-2 鳥群高度超過 `objHeightMax()` 或水平飛出 `edgeWallInsetM()`:世界曲面的頂點著色器會把遠處往下沉(`curveDropM`),看起來像鳥主動往地平線俯衝;沒有任何斷言看得見,因為位移只發生在頂點著色器裡(A 表對曲面那一列已寫明「raycast / 包圍盒 / 所有稽核讀數全部正常」)。
- ⑥-2 若給鳥群 `castShadow = true`:等於開第三個投影旗標的縫(§2.1 F 時間流逝 ⑧ 只准 `makeUnit` 與 `buildGroundCover` 兩處),而 `audit_daynight` 只掃 `game.js`/`ground.js` ⇒ 寫在 `biomes.js` 裡**不會紅**,症狀是地上憑空多一片飄動的黑影。
- ⑥-3 消費端漏 null 守衛:`ent.loco` 在重生瞬移那一幀被設成 null(game.js:8160),`w` 就是 undefined ⇒ `moveGate` 變 NaN ⇒ `AudioParam.setTargetAtTime(NaN, …)` 丟例外,**把整條 requestAnimationFrame 迴圈打斷**(畫面凍結,而錯誤看起來像音效壞了)。
- ⑥-3 若 `animWeights` 讀了只有部分 rig 才有的欄位(例如 `rig.top` 在載具 rig 上缺席),某一類機體的權重會靜默恆為 0 ⇒ 那一整類的環境音床從此不出聲,而每一條斷言都綠。稽核 Ⅲ 的「缺欄回 0 不回 NaN」要配一條「現役五種 rig.kind 各解得出非零權重」。
- ⑥-3 動到 `_updateMoveAudio` 的數值 = **刻意的行為改變**(離地門檻 3m → 2m、gate 曲線換來源)。它沒有任何離線模型在守(`npm run bal` 不模型化音效),只有真機聽得出來;若使用者要逐位元中性,就只能保留舊的 `_moveSpd` 一輪、把切換推遲到 ⑦-2 —— 但那等於同時存在兩份速度推導,是本項要修的東西。
- ⑥-3 若把 `braceF`(locomotion.js:644)順手改成讀 `w.aim`:`audit_gait_anat` Ⅷ①b 釘的是原文樣式 `braceF = clamp(rig._aim`,會當場紅,而且那一條的語意(「站著不動不是射擊姿勢的來源」)本來就要求它吃 `rig._aim` 而不是任何含 idle 的合成量。
- 如果使用者裁決走 GPGPU:compute 用的 `ShaderMaterial` 會讓 `audit_cel_pipeline` Ⅵ 的 `decl < n` 計數要求 wildlife.js 宣告 ≥ 材質支數;把 wildlife.js 加進 `EXEMPT`(tools/audit_cel_pipeline.mjs:311)就是對鳥群的 render 材質關掉那道閘 —— 那正是它存在要擋的情況。另外 compute pass 需要在 `postfx.Pipeline` 之外呼叫 `renderer.setRenderTarget`,而 postfx 是「唯一消費端 game.pipeline」+「MUST NOT 在 game.js 另開第二條更新迴圈」兩條紀律的交集點。

## 逐位元中性

"**⑥-2 是純新增,逐位元中性可以證明。** `data.js`/`sim.js`/`server/**` 一行不動 ⇒ `npm run bal` 與 `npm test` MUST 逐項不動(㋒)。`?birds=0` 與「錨不到就不放」兩條讓它在任何既有場地上都退得回什麼都沒有。真正要證的是**確定性**那一半:鳥群 MUST 零共享 `rnd()` 消耗,證法 = 步 0 存下 `audit_siteplan` / `audit_beacons` / `audit_object_joints --seeds 8` / `audit_ground_tile` / `audit_ground_qc` 五支的完整輸出,落地後逐字 diff MUST 零差異(它們的數字直接反映共享 rnd 序列;抽一枚就會整批位移)。反向驗證 `--break-rnd` 證明這道閘真的量得到。畫面那一半用 `shot_scene --venue taroko` 開關 `?birds=0` 兩輪 A/B:關著時 13 張定場照 MUST 與落地前 md5 全同。\n\n**⑥-3 分成兩半。** 骨架/演出那一半**是**逐位元中性:`stepLocomotion` 只多寫一格 `L.w`、不讀任何新東西 ⇒ `audit_gait_anat` 八段輸出 MUST 與步 0 基準逐字相同(這就是計畫 ⑥ 驗證欄寫的「既有斷言 MUST 逐項不動」),`audit_morph_rig`/`audit_paper_doll`/`audit_cast_jump`/`audit_muzzle`/`audit_cockpit` 同理;`data.js`/`sim.js` 一行不動 ⇒ bal/test 逐項不動。**音效那一半刻意不是逐位元中性**:離地門檻由 3m 收斂到 `MORPH.GROUND_Y`(2m)、`moveGate` 的輸入由未阻尼的 `_moveSpd` 換成阻尼過的權重。可量的兩件事:①2~3m 高度帶內的英雄從此立刻切到飛行型音床(舊制慢一拍)②靜止/起步的音量過渡不再有 8Hz 插值鋸齒。這兩項沒有任何離線模型守得住(bal 不模型化音效)⇒ MUST 列進交付說明的未驗項並在真機聽一次(㋕)。若使用者要求音效端也逐位元中性,唯一自洽的做法是本輪只**發布**權重、消費端一格不動,把切換整批推給 ⑦-2 —— 那也是可以的,但要接受「兩份速度推導再共存一輪」。"

## 卡在
- **① GPGPU vs CPU 零狀態積分器 —— 需要使用者裁決(本項最大的一條)。** 計畫 ⑥-2 明寫「GPGPU 鳥群」,而使用者本輪也明講「衝突時一律以此計畫為主」。但實地查完,本專案沒有任何 ping-pong render-to-texture:`postfx.js` 是唯一的 RT 持有者(檔頭「3 個 RenderTarget + 1 張 depthTexture + 4 個 FullScreenQuad 材質」)且是「唯一消費端 game.pipeline」;世界內容的運動傳統一律零狀態純函式(頂點著色器的 `uWindT`/`celGust`/`celSeaH`,或 CPU 的 `clouds.step(celWindTime())`);戰鬥特效走 TTL 回呼。GPGPU 的四筆成本:①WebGL2 只是**能力**不是保證(postfx.js:248 的 `_mrtCap`)⇒ 必須配一份 CPU fallback = 兩份實作 ②compute pass 要在 pipeline 之外呼叫 `setRenderTarget`,撞上「MUST NOT 在 game.js 另開第二條更新迴圈」③積分器在 GLSL 裡 ⇒ **反向驗證(原則 9)離線做不出來**,`--break-spring`/`--break-friction` 這幾支全部退化成 ㋓ 真瀏覽器 ④A25 多兩張浮點 RT 要 dispose。買到的是零:GPGPU 在 1e4 以上才回本,而鳥群的隻數由「2 = 一對 / 3 = 幾隻 / ≥4 = 一群」的美術語意決定(SKILL L1),量級是數十。實測參照:`makeClouds.step` 已經每幀重算數十顆 sprite 的位置與縮放,成本量不出來。**建議:計畫列的六項(曲線 + 逐軸噪聲 + 弱彈簧 0.0003 + 摩擦 + 分群 + uSnap)一項不刪,只把積分器落在零 THREE 的 JS 模組。** 若使用者仍要 GPGPU,上面 risks 最後一條列出了三個落地衝突點,要一併裁決(尤其是 `audit_cel_pipeline` Ⅵ 的 EXEMPT 名單要不要放寬)。
- **② 排序:⑥-3 MUST 提前到序 6 之前。** 計畫的順序表把 ⑦(音效,序 6)排在 ⑥-2(序 11)之前,而 ⑦-2「移動音改成 gain-ride 常駐 stem,由動畫權重(⑥ 第 3 點)驅動」**吃的正是 ⑥-3**。目前 ⑥-3 沒有獨立序號、被綁在序 11 裡。建議把序 11 拆成兩項:`⑥-3 動畫權重向量` 插在序 5 與序 6 之間(風險低、逐位元中性可證),`⑥-2 鳥群` 留在序 11。這是對計畫順序表的修改,需要使用者確認。
- **③ 鳥群的「真實理由」順位需要美術方向定案。** 計畫只寫「曲線是美術方向」。本規格提出的順位是 水域岸線 > 神木林 > 地標,並明確**排除**兵線/塔位/主堡(戰鬥家具),三類全部錨不到就不放(原則 6)。這是把「鳥群為什麼在那裡」從烘焙像素換成圖資推導,語意上仍是計畫要的東西,但選哪幾類、順位怎麼排、每類幾隻(2/3/≥4 的語意)是美術決定。
- **④ ⑥-3 的音效行為改變要不要接受。** 見 bitExact 第二段:離地門檻 3m → 2m、gate 曲線換來源,兩項都聽得出來、都沒有離線模型守得住。兩條路都自洽:(a) 這一輪就切,交付說明標未驗項 + 真機聽一次;(b) 這一輪只發布權重、消費端不動,切換併進 ⑦-2 —— 代價是兩份速度推導再共存一輪。
- **⑤ 鳥群要不要進 `visualPrefs` 旋鈕表。** 本規格只給 `?birds=0` killswitch(同 `?gait=0`/`?morph=0`/`?sag=0` 的 A/B 慣例)與 `lowPower` 降級。若使用者希望玩家自己能關(手機幀率),就要加一格 `VISUAL_KNOBS`(`choices: ['off','on']`,預設值 MUST = 「這一項不生效」= off,見 visualPrefs.js 紀律 ①),並連帶跑 `audit_visual_prefs` 與 `audit_ui_layout`。
- **⑥ 玩家自機的權重(⑦-2 才會用到)。** 自機在 `game.js:8139` 早退、沒有 `loco` ⇒ 玩家自己的腳步/引擎 stem 目前無權重可吃。本輪只把口子留好(`animWeights` 設計成吃一個 `L` 形狀的狀態包,自機在 `_updatePlayer` 收尾組一份 `this._selfW`)。要不要在這一輪就把自機那半接上,是範圍決定。
- **⑦ 需真瀏覽器(㋓)的三件事,沙箱跑不動。** ①鳥群在畫面上像不像鳥(`shot_scene` 定場照 + `?birds=0` 對照)②`instanceMatrix.needsUpdate` 忘了會凍結而每支稽核全綠 ③⑥-3 的音效改變只有真機聽得出來。落地時 MUST 在交付說明標未驗項(㋓/㋕)。
