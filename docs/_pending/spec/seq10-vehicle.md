# 序 10 / ③ 建築・電器・交通工具(③-1 SPEC 列 + ③-2 真凹處 + ③-3 可視角 + ③-4 draw call)  (key: seq10-vehicle)

## 摘要

現況查證結果:建築那一半確實已經是「一個生成器 + 一張表 + 三道閘」(`BLD_LIB` / `wallpanel.js` / `intake_parts`),而**載具/擺件那一半沒有任何型錄** —— 同一台「車」有**四份**互不相同的手寫副本(`hazards.js:112` 的殘骸車、`biomes.js:7832` 的車禍車、`siteplan.js:275` 的停放車、`ground.js:1497` 的廢車),尺寸從 1.71m 到 4.8m 相差 2.8×,其中三份**連輪子都沒有**;同一個「貨櫃」也有四份(`beacons.js:251` 6.1m、`edgewall.js:742` ~5.8m、`edgewall.js:518` 貨車廂、`ground.js:1496` 2.7m);「列車」有兩份(`biomes.js:7284` vs `edgewall.js:488`)。本專案其實**已經有**這個模式的最佳範本 —— `edgewall.js`(零 import 型錄 + `wallParts` 生成器 + `partBox`/`wallFit`/`wallFaceCover` 三支離線量尺),③-1 的正確落地是把載具收斂成同一形狀的第二支型錄 `public/js/vehicles.js`(零 import,五個消費端同吃),而不是另發明一套。③-4 量到了硬數字:停車場**實測 25 個 draw call**(`siteplan.js:496` 的註解還寫著「3~6 個」,`vc` 色相變異通道 2026-08-05 上線後就過期了),`hazards.js` 逐款 12~55 個(`outlinify` 讓不透明件各再多一顆外殼),全圖上限 9 座公設 + 每兵線 24 個障礙 ⇒ 光這兩族就是四位數的 draw call,而 `mergeGeos(geos, colors)` 這條頂點色合併縫早就在了、只有邊界牆在用。③-2 的缺口是真的:店面目前只有 `facadeTex` 畫上去的遮陽棚(`biomes.js:1451`),一塊幾何都沒有;③-3 最自然的錨 `curveEyeM()` 帶著一個引數順序缺陷(見 blockedOn),這一輪 MUST 另立 `standEyeM()`。

## 縫

### 車:第 1 份手寫副本(唯一有輪子的那一份)
`public/js/hazards.js:112`

現行:
```js
  wreck(g, r, rnd) {
    const n = 2 + (rnd() < 0.4 ? 1 : 0);
    const paints = [0xb8412f, 0x3f6fa8, 0xcac4b8, 0x4a5a48, 0xd8b04a];
    for (let i = 0; i < n; i++) {
      const car = new THREE.Group();
      const paint = jitterColor(paints[Math.floor(rnd() * paints.length)], rnd);
      const bw = 1.7 + rnd() * 0.3, bh = 0.8 + rnd() * 0.15, bl = 3.5 + rnd() * 0.8;
      mesh(car, box(bw, bh, bl), paint, 0, 0.85, 0);
      const crush = 0.55 + rnd() * 0.4;
      const cab = mesh(car, box(bw * 0.9, 0.62, bl * 0.48), ...);
      for (const [sx, sz] of [[-1, -1.3], [-1, 1.3], [1, -1.3], [1, 1.3]]) {
        const w = mesh(car, cyl(0.34, 0.34, 0.25, 8), 0x1c1f22, sx * 0.95, 0.34, sz);
```

**改成**: 改為呼叫 `vehicles.makeVehicle('sedan', { crush })` 取得零件描述子,再以既有的 `mesh()` 速記發射。這一份是四份裡唯一有輪子、唯一有「軸心 = 輪半徑 → 觸地」正確軸高的,SPEC 的 `R`/`axle` MUST 以它為基準值。rnd 是**逐障礙的區域序列**(`mulberry32(seed*…)`,非共享)⇒ 枚數可以改,但 `tools/audit_object_joints.mjs:577` 的 `new Function` 樁件參數列 MUST 同步注入 `makeVehicle`,否則整支稽核 ReferenceError。

### 車:第 2 份手寫副本(封路車禍;吃共享 rnd)
`public/js/biomes.js:7832`

現行:
```js
  const car = (c, len = 4.4) => {   // 低多邊形轎車(車禍用)
    const cg = new THREE.Group();
    const body = new THREE.Mesh(new THREE.BoxGeometry(len, 1.2, 1.9), toonMat(c));
    body.position.y = 0.9; cg.add(body);
    const cab = new THREE.Mesh(new THREE.BoxGeometry(len * 0.45, 0.85, 1.7), toonMat(0x2c343c));
    cab.position.set(-len * 0.08, 1.9, 0); cg.add(cab);
    return cg;
  };
```

**改成**: 改吃 `makeVehicle('sedan')`。⚠ **這一支的宿主 `buildRoadBlocks(…, rnd)`(7824,呼叫點 9844)吃的是世界共享 `rnd`**:`car()` 本身零 rnd 消耗 ⇒ 換掉它是序列中性的,但 `KINDS.crash/work/pit` 的 `rnd()` **枚數 MUST 逐枚不變**,且 `crash` MUST 繼續回傳 5(那個回傳值直接進 `blockers.push({ r: or2 })` = 權威碰撞半徑)。車身軸向由 +x(len 在 x)換成 SPEC 約定的 +x 鼻頭 ⇒ 這一份剛好不用轉。

### 車:第 3 份手寫副本(唯一帶碰撞柱的那一份)
`public/js/siteplan.js:275`

現行:
```js
    ..._row(5, (i) => ({ g: ['box', 2.2, 1.35, 4.8], c: [0xb4553c, 0x3f6f7a, 0xa8a08c, 0x7d8a4a, 0x51585f][i], p: [-20 + i * 5, 0.68, -7.4], col: 1, vc: 1 + i })),
    ..._row(5, (i) => ({ g: ['box', 2.0, 0.9, 2.4], c: [0x93412c, 0x335b64, 0x8b8474, 0x67723c, 0x41474d][i], p: [-20 + i * 5, 1.75, -7.8], vc: 1 + i })),
    ..._row(4, (i) => ({ g: ['box', 2.2, 1.35, 4.8], c: [0x3f6f7a, 0xa8a08c, 0xb4553c, 0x7d8a4a][i], p: [2.5 + i * 5, 0.68, 7.4], col: 1, vc: 6 + i })),
    ..._row(4, (i) => ({ g: ['box', 2.0, 0.9, 2.4], c: [0x335b64, 0x8b8474, 0x93412c, 0x67723c][i], p: [2.5 + i * 5, 1.75, 7.0], vc: 6 + i })),
```

**改成**: 九台車 = 四行手寫、車身/車頂顏色兩張手寫色表。改為 `..._row(5, (i) => makeVehicle('sedan', { at: [-20 + i*5, 0, -7.4], ry: Math.PI/2, tint: LOT_PAINT[i], vc: 1 + i })).flat()`。**這是四份裡唯一登記 `blockers` 的**(`col: 1`,經 `civicColliders`→`biomes.js:8746-8755` 的有向盒路徑)⇒ 車身盒的**世界 OBB MUST 幾何相同**:現行 `2.2 × 4.8, ry=0` 換成 SPEC 約定的 `4.8 × 2.2, ry=π/2` 是**同一個有向盒的另一種表示**(`partCollider` 的 `hw2/hd2/ry` 與 `blockers` 的 `ry: c.ry + col.ry` 兩端都吃得下),稽核 MUST 比**四個角點**而不是比欄位。實測 `civicExtent('lot') = 30.232 ≤ foot 32`,最遠的車只到 23.265m ⇒ 加輪子/後照鏡有 1.77m 餘裕。

### 車:第 4 份手寫副本(尺度是另外三份的 1/3)
`public/js/ground.js:1497`

現行:
```js
  container:[{ geo: box(3.0, 1.3, 1.25), c: 'palette', tex: 'corrugated' }],
  carwreck: [{ geo: box(1.9, 0.6, 1.05), c: 'palette' }],
```

**改成**: 兩列都是單顆方盒,而且**尺度與其他三份分家**:`carwreck` 實得世界長 1.9 × s0 0.9 = **1.71m**(其他三份 3.5~4.8m),`container` 實得 3.0 × 0.9 = **2.70m**(20ft ISO 貨櫃 6.06m,`beacons.depot` 與 `edgewall.ship` 都用 6.1/5.8m)。改為 `makeVehicle` 產出的**逐材質合併**幾何(車身 'palette' / 車艙深色 / 四輪併成一顆黑色幾何 = 3 個 part),沿用 `DETAIL_DEFS` 既有的多 part 契約。⚠ 改尺寸就會改 `detailR`(1593,由幾何實算)⇒ 見 risks 第 1 條。

### 貨櫃:四份手寫副本
`public/js/beacons.js:251`

現行:
```js
  depot: [
    { g: ['box', 6.1, 2.6, 2.5], c: 0xb4553c, p: [0, 1.3, -1.5] },
    { g: ['box', 6.1, 2.6, 2.5], c: 0x3f6f7a, p: [0.5, 1.3, 1.5] },
    { g: ['box', 6.1, 2.6, 2.5], c: 0x7d8a4a, p: [-0.6, 3.9, -0.4] },
    { g: ['box', 6.1, 2.6, 2.5], c: 0xa8a08c, p: [0.3, 6.5, 0.2] },
```

**改成**: 與 `edgewall.js:742`(`['box', s*0.9, 2.6, 2.4]` × 三列兩層)、`edgewall.js:518-520`(貨車廂 `s*0.6, 2.7, 2.45` / 頂櫃 `s*0.55, 2.4, 2.3`)、`ground.js:1496`(`box(3.0,1.3,1.25)`)是同一個組件的四份。`vehicles.js` MUST 另出一列 `container20`(L 6.06 / W 2.44 / H 2.59,真實公稱)+ `container40`,四個消費端同吃;`beacons.depot` 的四顆改成 `container20` 的四次擺放。⚠ `beacons` 的 `foot` 契約由 `partExtent`(beacons.js:507 上方)雙向釘住 ⇒ 換尺寸要回頭看 `BEACON_KINDS.depot.foot = 6.0`。

### 列車:兩份手寫副本
`public/js/biomes.js:7284`

現行:
```js
function makeTrain(metro) {
  const g = new THREE.Group();
  const body = metro ? 0xdfe5ea : 0xe8873c;
  for (let c = 0; c < 3; c++) {
    const car = new THREE.Group();
    const m = new THREE.Mesh(new THREE.BoxGeometry(3.0, 3.4, 13.4), toonMat(body));
    ...
    car.position.z = c * 14.4;
```

**改成**: 行駛中的列車(車廂 3.0 × 3.4 × 13.4,節距 14.4)vs `edgewall.js:488-497` 的停駛列車(車廂 `s*0.9 × 3.3 × 3.0`,節距 13.5,**有轉向架、有車頂空調、有集電弓**)。收斂成 SPEC 列 `railcar`(L 20.0 / W 2.95 / R 0.43 / axle 依真實轉向架中心距),兩個消費端同吃;`makeTrain` 只保留「三節 + 車頭斜鼻 + 顏色」那一層。⚠ `edgewall` 那一份 MUST 繼續過 `wallFit`(`edgewall.js:246`,演出 ⊆ `depth 3.4 × h 7.2` 的盒)與 `wallFaceCover`(267,內面覆蓋 ≥ 0.72)—— 加轉向架/集電弓最容易頂出盒頂。

### 已存在的型錄範本(③-1 MUST 照抄形狀,不另發明)
`public/js/edgewall.js:80`

現行:
```js
export const WALL_KINDS = {
  citywall:  { dom: 'land',  bio: ['urban', 'bare'], slope: 'mid',  depth: 5,   h: 14,   label: '城牆' },
  train:     { dom: 'land',  bio: ['urban'],        slope: 'flat', depth: 3.4, h: 7.2,  label: '停駛的列車' },
  trucks:    { dom: 'land',  bio: ['urban'],        slope: 'flat', depth: 3.2, h: 7.4,  label: '連排大貨車' },
// …
export function wallParts(kind, { len, depth, h, seed = 1 }) {
  const fn = PARTS[kind] || PARTS.barricade;
  return fn(len, depth, h, mulberry32((seed * 2654435761) >>> 0));
}
```

**改成**: 不改。這是 `vehicles.js` MUST 逐條照抄的形狀:①**零 import(除 `rng.js`)、零 THREE** —— 零件是 `['box', w,h,d]` 描述子,這才是離線可驗的原因;②宣告尺寸同時是碰撞契約的上下界;③`partBox`(223)/`wallFit`(246)/`wallFaceCover`(267)三支純幾何量尺。`vehicles.js` 對應三支 = `vehicleBox(kind)`(逐列外廓實算)/ `vehicleFit(kind)`(零件 ⊆ 宣告 L×W×H,三軸雙向夾 `FILL_TOL`)/ `vehicleSight(kind, opening)`(③-3)。

### ③-4 合併縫(已存在,只有一個消費端在用)
`public/js/beacons.js:507`

現行:
```js
export function mergeGeos(geos, colors = null) {
  // `colors`(選用)= 逐幾何的顏色(0xRRGGBB)。給了就多烤一份 `color` 頂點屬性,呼叫端便能把
  // **上千個不同顏色的零件併成一個 mesh**(邊界牆整圈 = 1 個 draw call;逐色一個 mesh 的話
  // 光是型錄的色票就上百個 draw call,而本渲染器是 draw call 瓶頸)。不給 = 逐位元同舊制。
```

**改成**: 不改介面。現況只有 `biomes.js flushPartBatch`(7647)在用第二個參數;`buildBeacon`(460)與 `buildCivic`(500)都走「逐顏色分桶」⇒ 顏色一多就是 draw call 一多。③-4 = 讓 `buildCivic` 改吃 `mergeGeos(geos, cols)`,分桶鍵由 `${pc}|${e}|${sf}` 收成 `${e}|${sf}`(顏色進頂點色)。

### ③-4 現值(註解已過期,實測 25)
`public/js/siteplan.js:496`

現行:
```js
 * 建一處公設。零件依顏色分桶合併(同 `beacons.js buildBeacon`:一處公設 3~6 個 draw call,
 * 逐塊一個 mesh 的話光是停車場的車格白線就 20 個)。
```

**改成**: 實測(以 `readSrc` 抽 `CIVIC_PARTS` 逐列算分桶鍵):park 26 件 → **12 桶**、pitch 25 件 → **7 桶**、lot 47 件 → **25 桶**。註解寫的「3~6」在 2026-08-05 加入 `vc` 色相變異通道之後就過期了(每台車的車身與車頂各自 `offsetHSL` ⇒ 各自一桶)。`CIVIC.MAX = 9`(siteplan.js:79)⇒ 最壞情形(3+3+3)= **132 個 draw call**。改吃頂點色後 lot → 2、park → 4、pitch → 3,合計 **27**。註解 MUST 同步改成實測值並註明量法。

### ③-4 的地雷:頂點色通道被兩個東西搶
`public/js/toon.js:1020`

現行:
```js
export function bakeContactAO(root, fade = 2.4) {
  ...
    o.geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    m.vertexColors = true;
```

**改成**: `bakeContactAO` **直接覆寫** `color` 屬性。現況兩個 merge 消費端剛好互斥(`buildBeacon`/`buildCivic` 不給 `mergeGeos` 顏色、然後 AO 寫 color;`flushPartBatch` 給顏色、然後不呼叫 AO)⇒ 從來沒撞過。③-4 把 `buildCivic` 改成頂點色之後**兩者就會撞**,而症狀是「公設整組沒有接地陰影」或「公設整組變成灰白色」,沒有任何錯誤訊息。MUST 改成:既有 `color` 屬性存在時**逐分量相乘**而不是覆寫(`colors[i] *= existing[i]`),並在 `audit_gpu_lifecycle` / 新稽核裡釘住這一條。

### ③-4 的第二個乘數:描邊外殼
`public/js/toon.js:1122`

現行:
```js
export function outlinify(root, width = 0.08) {
  root.traverse((o) => {
    if (!o.isMesh || o.userData.isOutline || o.userData.noOutline) return;
    const m = Array.isArray(o.material) ? o.material[0] : o.material;
    if (!m || m.transparent) return;
    ...
    o.add(shell);   // 掛在原 mesh 下
```

**改成**: 不改實作。這是 `hazards.js buildHazard`(523)draw call ×2 的來源。實測逐款 mesh 數(seed 1..8 中位數,`--input-type=module` 樁件跑真原文):construction 23 / **wreck 19** / landslide 14 / fire 12 / boulder 11 / sinkhole 9 / fallentree 8 / pothole 8 / relay 7 / rockfall 6 / **aasite 28**;不透明件各再多一顆外殼 ⇒ 逐個障礙 12~55 個 draw call。`FIELD.HAZ_PER_LANE = 24`(data.js:5396)× 最多 3 兵線 ⇒ 上限 72 個障礙。③-4 的第二個落點就是 `buildHazard` 收尾改走 `mergeGeos(geos, cols)`(**MUST 排在 `jitterParts` 之後、`bakeContactAO`/`outlinify` 之前**);`fire`/`flood` 的逐幀閃爍件與半透明件 MUST 具名排除。

### ③-2 現況:店面只有貼圖,一塊幾何都沒有
`public/js/biomes.js:1451`

現行:
```js
  if (style === 'shop') {                                                // 底層店面:遮陽棚 + 櫥窗
    const awn = ['#c25c4a', '#3f7a8c', '#c7a13d', '#5c8a52'];
    for (let c = 0; c < cols; c++) {
      const [ax, , aw] = snap(c * cw + cw * 0.12, 0, cw * 0.76, 1);
      cx.fillStyle = awn[Math.floor(rnd() * awn.length)];
      cx.fillRect(ax, WW - 34, aw, 8);
```

**改成**: 遮陽棚與櫥窗全部畫在 `facadeTex` 的 canvas 上 ⇒ SKILL 的症狀表第 3 列(「店面讀起來像一張貼紙」)。③-2 的落地 **MUST 是往外堆**(`vehicles.js` 的同一條紀律,SKILL L2):在方盒建物底層前面加一圈「楣樑 + 兩側側返 + 檻」的**加法**幾何,量體本身一格不動。⚠ 一般建物走的是**單位 BoxGeometry 的 InstancedMesh**(9313:`new THREE.BoxGeometry(1,1,1)` 逐 (commercial, 立面款, 列數) 一顆),實例縮放就是 `(w, h, d)` ⇒ **凹處的世界深度不可能烤進共用幾何**(會隨每棟樓的進深伸縮)。唯一可行:另開一顆 `InstancedMesh`(單位框 × scale `(w, storeyH, recessD)`)貼在臨街面 —— 每個立面桶多 1 個 draw call。

### ③-3 的錨:現有的「站立視線高」單一縫帶著缺陷
`public/js/data.js:1002`

現行:
```js
export const curveEyeM = () => {
  if (_curveEye) return _curveEye;
  let h = Infinity;
  for (const ch of Object.keys(CHARACTERS)) {
    for (let lv = 1; lv <= 4; lv++) h = Math.min(h, heroTargetH(ch, lv));
  }
  _curveEye = h * SELF_F.eye;
  return _curveEye;
};
```

**改成**: **MUST NOT 拿它當 ③-3 的錨。** 簽章是 `heroTargetH(kind, ch)`(data.js:2626),這裡傳的是 `(ch, lv)` ⇒ `HERO_SIZE['s01']` 是 undefined ⇒ 每一輪都走 `return SOLDIER_H * 4` = 7.2。實測 `curveEyeM() = 4.0824`,而真正的最矮機體是 1.35m ⇒ 正解 0.76545(差 5.33×)。`tools/audit_world_curve.mjs:89` **抄了同一份錯誤呼叫**,所以它是綠的(刀與尺寫成同一份 = 這道閘量不到任何東西)。③-3 MUST 另立 `standEyeM()`(`heroTargetH(charKind(ch), ch)` × `SELF_F.eye`,`SELF_F.eye` 是 `game.js VIEW_SHAPE`(93)的地板,已由 `audit_world_curve` 以原文釘住),並在檔頭寫明它與 `curveEyeM` 的關係。修 `curveEyeM` 本身另案(見 blockedOn)。

### 共享 rnd 的真正邊界(③-1 最容易靜默壞掉的一處)
`public/js/ground.js:3076`

現行:
```js
  const addDetail = (type, px, pz, s, tintHex = null, sy = 1, ry = null) => {
    if (detCount >= detCap || isBlocked(px, pz) || bdCross(px, pz, 0)) return;
    const dr = detailR(type) * s;
    if (!detFree(px, pz, dr)) return;
    ...
    det[type].push({ ..., ry: ry ?? -orient(px, pz, REG[type] || 0, false),
                     tx: (rnd() - 0.5) * 2 * tl, tz: (rnd() - 0.5) * 2 * tl, tint: tintHex });
```

**改成**: 不改。這裡要記住的是**判定的方向**:所有早退都排在 `orient()` 與 `tx/tz` 兩枚 `rnd()` **之前** ⇒ 一件被 `detFree` 淘汰就少抽 3~4 枚共享亂數。`detailR`(1593)是由 `DETAIL_DEFS[type]` 的**幾何實算**的 ⇒ **一旦改 `carwreck`/`container` 的方盒尺寸,淘汰結果就變,後面每一株植被、每一棟補間建物的落點整條推移**(§2.3;畫面上只表現成「整張圖變了」)。同一條也套在 `rows()`(4042,`containeryard` 用 `rows('container', 4.0, 2.6, …)`:節距 4.0m 是配 2.7m 貨櫃訂的,換成 6.06m 會讓整排互相淘汰)。

## 寫入檔案
- `public/js/vehicles.js` (create) — ③-1 的唯一縫:`VEHICLE_SPEC` 型錄 + `makeVehicle()` 生成器 + `vehicleBox()`/`vehicleFit()`/`vehicleSight()` 三支量尺。**零 import(除 `rng.js`)、零 THREE**,零件是 `['box'|'cyl'|'cone'|'ico', …]` 描述子 —— 與 `edgewall.js`/`wallpanel.js`/`roadgrid.js` 同一條紀律,離線稽核與遊戲端才吃得到同一份。
- `tools/audit_vehicle_spec.mjs` (create) — ③-1/③-2/③-3 的新稽核:逐列 SPEC 推導值 vs `makeVehicle` 實測外廓、正面朝向約定、凹處往外堆、可視角 `atan(H/D)`、四個消費端零第二份實作、draw call 上界。
- `public/js/hazards.js` (edit) — `BUILDERS.wreck`(112)改吃 `makeVehicle('sedan')`;`buildHazard`(523)收尾改走 `mergeGeos(geos, cols)` 逐材質合併(③-4)。
- `public/js/biomes.js` (edit) — `car()`(7832)改吃 `makeVehicle('sedan')`;`makeTrain()`(7284)改吃 `makeVehicle('railcar')`;`buildRoadBlocks` 的封路事件改走 `flushPartBatch` 合併(③-4);③-2 的店面凹處環(9311-9315 那一段旁邊另開一顆 InstancedMesh)。
- `public/js/siteplan.js` (edit) — `CIVIC_PARTS.lot`(268-285)的九台車改吃 `makeVehicle`;`buildCivic`(500)分桶鍵由 `${pc}|${e}|${sf}` 收成 `${e}|${sf}` 並改吃 `mergeGeos(geos, cols)`;496 的「3~6 個 draw call」註解改成實測值。
- `public/js/ground.js` (edit) — `DETAIL_DEFS.carwreck`/`container`(1496-1497)改由 `makeVehicle` 的逐材質合併結果產出;`REG`/`TILT` 兩張表(1547/1560)照樣要有那兩個鍵。
- `public/js/edgewall.js` (edit) — `PARTS.train`(481)/`PARTS.trucks`(507)/`PARTS.ship`(733)的車廂與貨櫃改吃 `makeVehicle`。本檔仍 MUST 維持零 THREE、只 import `rng.js` + `vehicles.js`(後者也零 import ⇒ 契約不破)。
- `public/js/beacons.js` (edit) — `KIND_PARTS.depot`(251)的四顆貨櫃改吃 `makeVehicle('container20')`;`mergeGeos`(507)不動介面。
- `public/js/toon.js` (edit) — `bakeContactAO`(1020)MUST 改成「既有 `color` 屬性存在時逐分量相乘」而不是覆寫 —— ③-4 讓 merge 的頂點色與 AO 的頂點色第一次同時出現。
- `tools/audit_object_joints.mjs` (edit) — 577-579 的 hazards `new Function` 樁件參數列 MUST 注入 `makeVehicle`(真 import,vehicles.js 零 import ⇒ Node 端載得動),否則整支稽核 ReferenceError 而理由與接合無關。
- `tools/audit_siteplan.mjs` (edit) — 96 的 `new Function('partExtent', pureSrc)` 沙箱 MUST 多注入 `makeVehicle`(同 `partExtent` 的處理);Ⅱ 段的停車場斷言改比**車身 OBB 四角點**而非欄位。
- `tools/audit_soft_stroke.mjs` (edit) — 260 抽 `CIVIC_PARTS` 的 `new Function('_row', …)` 與 436 執行 `DETAIL_DEFS` 的 `new Function('THREE', …)` 兩處都 MUST 注入 `makeVehicle`。
- `.claude/rules/seams-world.md` (edit) — §2.1 G 新增一列「載具 / 擺件型錄」:唯一縫 `vehicles.js`、六條鐵律、稽核 `audit_vehicle_spec`。
- `.claude/rules/verification.md` (edit) — §5.1(續)新增 `audit_vehicle_spec.mjs` 一行;§5.5 新增「動 `vehicles.js` / 任一消費端 → 跑什麼」那一列。
- `CLAUDE.md` (edit) — §2.1 的 `seams-world.md` 主題列加上「載具/擺件型錄」四個字(第一層只放目錄)。
- `docs/anime_style_plan.md` (edit) — 「執行紀錄」追加序 10 這一列:做了什麼 / 用什麼守住 / 留下什麼給下一輪(含 `curveEyeM` 缺陷與 ③-2 是否上一般建物兩項待裁決)。

## 步驟
1. 步 0(改任何東西之前)拍基準:`node tools/shot_scene.mjs --venue shibuya --dof=0 --curve=0` + 一張 taroko,存 md5;`node tools/audit_object_joints.mjs --seeds 8 > base_joints.txt`;`node tools/audit_siteplan.mjs > base_siteplan.txt`;`npm run bal` / `npm test` 各存一份。序 10 分成 10a(收斂,可證逐位元)與 10b(改真實尺寸,明知會變),**沒有基準就不要動 10b**。
2. 步 1 建 `public/js/vehicles.js`:先只寫型錄 + `makeVehicle` + `vehicleBox`/`vehicleFit`,**一個消費端都不接**。約定(SKILL L3,MUST 寫進檔頭):沿 **+x authored、鼻頭在 +x**、原點在足跡中心的地面 ⇒ `ry` 就是車頭朝向;列的欄位 `{ L, W, R, axle:[後,前], sill, waist, roof, cab:[後,前], rakeF, rakeR, side:[後,前], extra:[] }`。輪拱/保險桿/燈/車牌/接縫/後照鏡**一律由這 11 個數推導**,MUST NOT 逐款手寫。首批四列:`sedan` / `truck` / `railcar` / `container20`(貨櫃沒有 `axle`/`cab`,走 `extra:['boxbody']` 的退化列)。
3. 步 2 寫 `tools/audit_vehicle_spec.mjs`(真 import `vehicles.js`,不需沙箱):Ⅰ 逐列 `vehicleBox(kind)` 三軸 ⊆ 宣告 `L×W×H` 且 ≥ `1 − FILL_TOL`(雙向,同 `wallFit`);Ⅱ 每一列的輪心 y === `R`(觸地);Ⅲ `waist` 是一條線(車頭蓋/行李廂/窗檻同高)、`roof > waist > sill > R`;Ⅳ 正面朝向:`makeVehicle` 的零件在 +x 那半的體積 > −x 那半(鼻頭約定);Ⅴ 零共享 rnd(`makeVehicle` 的原文裡不得出現 `rnd`/`Math.random`)。此時稽核已可獨立跑綠。
4. 步 3(10a-1)接第一個消費端 `hazards.js BUILDERS.wreck`,同步改 `tools/audit_object_joints.mjs:577` 的樁件注入。跑 `node tools/audit_object_joints.mjs --seeds 8`,與 base 逐行比 —— 車輪那一族本來就有 `HZ_EXEMPT.wreck` 的三重豁免(scatter/loose/joints),所以這一步的判準是**沒有新的 FLOAT/PARTIAL 冒出來**。
5. 步 4(10a-2)接 `biomes.js car()`。**MUST 逐枚核對 `KINDS.crash/work/pit` 的 `rnd()` 消耗**(共享序列):作法是在改前改後各印一次 `buildBiomes` 回傳的 `blockers.length` / `decks.length` / `tunnels.length` 與同場地兩次 warm 跑的產出比對(verification.md「建構期讓步」那一列的 A/B 手法)。`crash` MUST 繼續 `return 5`。
6. 步 5(10a-3)接 `siteplan.js CIVIC_PARTS.lot`,同步改 `tools/audit_siteplan.mjs:96` 與 `tools/audit_soft_stroke.mjs:260` 的注入。新稽核加 Ⅵ:停車場九台車的**車身 OBB 四角點**與改制前逐點相同(容差 1e-9)—— 這是「碰撞盒 MUST NOT 位移」的唯一正確驗法(欄位表示會從 `2.2×4.8, ry=0` 換成 `4.8×2.2, ry=π/2`)。跑 `audit_siteplan` 全套 + 四支 `--break-*`。
7. 步 6(10a-4)接 `edgewall.js` 三款與 `beacons.js depot`。跑 `audit_world_edge` 全套(Ⅲ `wallFit` / Ⅶ `wallFaceCover` 是這一步唯一會咬人的兩條)+ `audit_beacons` ±`--break-extent`/`--break-pad`。**`BEACON_KINDS.depot.foot` 與 `WALL_KINDS.train/trucks/ship` 的 `depth`/`h` 一格都不准動**(10a 的定義)。
8. 步 7(10a-5)接 `ground.js DETAIL_DEFS`,但**只換形狀不換外廓** —— `carwreck` 仍收在 `1.9 × 0.6 × 1.05` 的包絡內、`container` 仍收在 `3.0 × 1.3 × 1.25` 內。新稽核加 Ⅶ:`detailR('carwreck')` 與 `detailR('container')` **逐位元等於改制前的常數**(把兩個數字硬寫進稽核當見證人)。這一條綠 = 共享 rnd 序列不動 = 全圖佈局逐位元不變。
9. 步 8(10a-6,③-4 第一半)`siteplan.buildCivic` 改吃 `mergeGeos(geos, cols)` + 分桶鍵收成 `${e}|${sf}`;同輪改 `toon.bakeContactAO` 為「乘」而不是「覆寫」。新稽核加 Ⅷ:逐款公設的分桶數 ≤ `1 + 軟性種類數 + (有無自發光)`(park 4 / pitch 3 / lot 2),並把 25→2 的實測值印出來。跑 `audit_gpu_lifecycle` + `audit_soft_stroke`(公設的 `sf` 契約一格不能動)+ `audit_visual_prefs`。
10. 步 9(10a-7,③-4 第二半)`hazards.buildHazard` 收尾合併:`jitterParts` → `mergeGeos(geos, cols)` → `bakeContactAO` → `outlinify`。`fire`/`flood` 的逐幀動畫件與所有 `transparent` 件 MUST 具名排除、`chiselRock` 的 `userData.outlineGeo` 平滑法線副本 MUST 跟著併(否則鑿刻岩的描邊會沿面裂開)。新稽核加 Ⅸ:逐款 draw call ≤ 上界表,並印出改制前後兩欄。
11. 步 10(③-2)在 `vehicles.js` 旁邊加 `RECESS` 規則(同一支檔案,因為它是同一條「深度往外堆」的紀律):`makeRecess({ W, H, D, jamb, lintel, sill })` 回傳**加法**零件(楣樑在 +z 前 D、兩側側返、檻),量體本身零改動。三個消費端:①`vehicles.js` 的 `extra:['port']`(補給箱/出貨口)②`siteplan.js` 的收費亭 ③`biomes.js` 一般建物底層的店面環(單獨一顆 InstancedMesh,scale `(w, storeyH, D)`)。新稽核加 Ⅹ:凹處零件的最小 z **恆 ≥ 量體前緣**(= 沒有任何一片寫在實心面後面)。
12. 步 11(③-3)`data.js` 加 `standEyeM()`(`min over CHARACTERS of heroTargetH(charKind(ch), ch) × SELF_F.eye`;檔頭 MUST 寫明它與 `curveEyeM` 的差別與後者的缺陷)。`vehicles.js` 加 `vehicleSight(H, D)` = `Math.atan2(H, D)`,新稽核 Ⅺ:每一個「玩家要看得到裡面」的凹處,`atan(H/D)` MUST ≥ 站在自己碰撞半徑外緣往下看的俯角 `atan(standEyeM() / (selfR + D))`,逐款印出角度。SKILL 的實例(0.135/0.17 = 38° vs 站立 70° = 看不見)當對照組寫進檔頭。
13. 步 12 收尾:`node tools/audit_client_syntax.mjs`(㋖,新模組自動進名冊)、`npm run audit:net`、`node tools/audit_solo_boot.mjs`、`npm run bal`、`npm test`(先照 §5.2 重啟伺服器)。10a 的驗收 = **定場照 md5 與步 0 逐張相同**。
14. 步 13(10b,獨立一次 commit,明知會變)把 `sedan`/`container20` 的 SPEC 值改成真實公稱尺寸(§2.5),`ground.js` 的 `detailR` 因此改變 ⇒ 全圖散佈序列推移。這一步 MUST 先拿到使用者對 blockedOn 第 1 條的裁決,並重拍全部定場照當新基準;`rows('container', 4.0, 2.6, …)` 的節距 MUST 改成由 `detailR` 推導。

## 稽核
- `node tools/audit_vehicle_spec.mjs`
- `node tools/audit_vehicle_spec.mjs --break-spec`
- `node tools/audit_vehicle_spec.mjs --break-dup`
- `node tools/audit_vehicle_spec.mjs --break-face`
- `node tools/audit_vehicle_spec.mjs --break-recess`
- `node tools/audit_vehicle_spec.mjs --break-sight`
- `node tools/audit_vehicle_spec.mjs --break-batch`
- `node tools/audit_vehicle_spec.mjs --break-detr`
- `node tools/audit_object_joints.mjs --seeds 8`
- `node tools/audit_siteplan.mjs`
- `node tools/audit_siteplan.mjs --break-line`
- `node tools/audit_siteplan.mjs --break-shy`
- `node tools/audit_siteplan.mjs --break-strike`
- `node tools/audit_siteplan.mjs --break-gate`
- `node tools/audit_world_edge.mjs`
- `node tools/audit_world_edge.mjs --break-fit`
- `node tools/audit_world_edge.mjs --break-face`
- `node tools/audit_world_edge.mjs --break-boxh`
- `node tools/audit_beacons.mjs`
- `node tools/audit_beacons.mjs --break-extent`
- `node tools/audit_beacons.mjs --break-pad`
- `node tools/audit_ground_tile.mjs`
- `node tools/audit_ground_qc.mjs`
- `node tools/audit_ground_seam.mjs`
- `node tools/audit_ground_enclave.mjs`
- `node tools/audit_ground_border.mjs`
- `node tools/audit_soft_stroke.mjs`
- `node tools/audit_gpu_lifecycle.mjs`
- `node tools/audit_cel_pipeline.mjs`
- `node tools/audit_visual_prefs.mjs`
- `node tools/audit_world_curve.mjs`
- `node tools/audit_client_syntax.mjs`
- `node tools/audit_solo_boot.mjs`
- `npm run audit:net`
- `npm run bal`
- `npm test`
- `node tools/ai3d/intake_parts.mjs`
- `node tools/shot_scene.mjs --venue shibuya --dof=0 --curve=0   # ㋓ 真瀏覽器:10a 的 md5 MUST 與步 0 逐張相同`
- `node tools/shot_scene.mjs --venue taroko --dof=0 --curve=0    # ㋓ 同上`
- `node tools/audit_traverse.mjs                                  # ㋓ 車體加大/凹處環是否封死既有通道`
- `node tools/audit_ground_drape.mjs                              # ㋓ ground.js 動過 ⇒ 貼合層 MUST 逐項不動`

## 反向驗證
- `--break-spec` — 壞版: 把 `sedan` 的輪拱/保險桿位置從「由 `axle`/`R` 推導」改回手寫常數(型錄值不動) ⇒ **MUST 紅**: audit_vehicle_spec Ⅰ「逐列宣告 L×W×H ⊇ 實測外廓且 ≥ 1−FILL_TOL」與 Ⅱ「輪心 y === R」MUST 紅字 —— 手寫值與型錄脫鉤之後外廓對不上
- `--break-dup` — 壞版: 把 `siteplan.js CIVIC_PARTS.lot` 的車體改回手寫 `{ g: ['box', 2.2, 1.35, 4.8] }`(繞過 `makeVehicle`) ⇒ **MUST 紅**: audit_vehicle_spec Ⅴ-b「五個消費端零第二份實作」MUST 紅字(以 `readSrc` 掃四支消費端的原文,出現任何未經 `makeVehicle` 的車身尺寸字面量就紅)
- `--break-face` — 壞版: 把 `makeVehicle` 的鼻頭改成 −x(整份零件 x 取負) ⇒ **MUST 紅**: audit_vehicle_spec Ⅳ「+x 那半的零件體積 > −x 那半」MUST 紅字 —— 這條紅 = 一整排停車場的車全部倒著停,而每一條既有斷言照樣全綠
- `--break-recess` — 壞版: 把凹處改成「往內挖」(楣樑/側返的 z 由 `+D` 改成 `−D`,寫在量體前緣後面) ⇒ **MUST 紅**: audit_vehicle_spec Ⅹ「凹處零件的最小 z ≥ 量體前緣」MUST 紅字 —— SKILL 的症狀表第 4 列(面板整片消失、不報錯)就是這一條
- `--break-sight` — 壞版: 把 `vehicleSight` 的門檻拿掉(任何 H/D 都放行) ⇒ **MUST 紅**: audit_vehicle_spec Ⅺ「`atan(H/D)` ≥ 站立俯角」MUST 紅字,且逐款印出的角度表 MUST 出現 < 門檻的那幾款
- `--break-batch` — 壞版: 把 `siteplan.buildCivic` 的分桶鍵改回 `${pc}|${e}|${sf}`(顏色回到材質) ⇒ **MUST 紅**: audit_vehicle_spec Ⅷ「逐款公設分桶數 ≤ 1 + 軟性種類 + 自發光」MUST 紅字(lot 25 > 2);同輪 `audit_gpu_lifecycle` 仍 MUST 綠 —— 那證明這是 draw call 而不是資源回收的問題
- `--break-detr` — 壞版: 把 `DETAIL_DEFS.carwreck` 的方盒放大到真實車長(10a 階段) ⇒ **MUST 紅**: audit_vehicle_spec Ⅶ「`detailR('carwreck')` 逐位元等於凍結常數」MUST 紅字 —— 這一條就是 §2.3 的哨兵(改了它,全圖每一株植被的落點整條推移而畫面上只表現成『整張圖變了』)
- `(既有)--break-fit / --break-face` — 壞版: `audit_world_edge` 既有的兩支:把 `wallFit` / `wallFaceCover` 的夾制拿掉 ⇒ **MUST 紅**: Ⅲ / Ⅶ MUST 照樣紅字 —— 這兩支證明列車/貨車/貨輪換成 `makeVehicle` 之後,『演出 ⊆ 碰撞盒』與『內面蓋滿』兩條契約仍然真的在守
- `(既有)--seeds 8` — 壞版: 不是 break:`audit_object_joints` 本來就是四硬失敗(FLOAT/PARTIAL/DETACHED/ISOLATED) ⇒ **MUST 紅**: 把 `makeVehicle` 的輪心 y 由 `R` 改成 0(輪子半埋)⇒ 該支 MUST 出現新的 PARTIAL;改回來 MUST 與 base 逐行相同

## 會靜默壞掉的地方
- **共享 rnd 序列推移(最會靜默壞掉的一條)**:`ground.js addDetail`(3076)的所有早退都排在 `orient()` 與 `tx/tz` 兩枚 `rnd()` 之前 ⇒ 一件被 `detFree` 淘汰就少抽 3~4 枚。`detailR`(1593)由 `DETAIL_DEFS` 幾何實算 ⇒ 只要 `carwreck`/`container` 的包絡改一點點,全圖每一株植被、每一棟補間建物、每一顆巨岩的落點整條推移,而**沒有任何錯誤訊息、沒有任何既有斷言會紅**,畫面上只表現成「這張圖跟上次不一樣」。10a MUST 以 `detailR` 逐位元不變當哨兵。
- **`buildRoadBlocks` 吃的是世界共享 `rnd`**(biomes.js:7824,呼叫點 9844):`car()` 本身零消耗,但只要順手在 `KINDS.crash` 裡多抽一枚(例如給車體加一個隨機色),同樣的整條推移就發生了。而且 `crash` 的**回傳值直接進 `blockers.push({ r: or2 })`** = 權威碰撞半徑 ⇒ 改它就是改伺服器看到的世界。
- **頂點色通道被兩個東西搶**:`mergeGeos(geos, cols)` 與 `bakeContactAO` 都寫 `geometry.color`。現況兩個 merge 消費端剛好互斥所以從沒撞過;③-4 讓它們第一次同時出現。撞到的症狀是「公設/障礙整組沒有接地陰影」或「整組變灰白」—— 兩種都不報錯,而 `audit_gpu_lifecycle` 照樣全綠(它量的是 dispose 不是顏色)。
- **合併會殺掉描邊的平滑法線副本**:`chiselRock` 建構時掛在 `mesh.userData.outlineGeo` 的平滑法線幾何是 `outlinify`(toon.js:1149)專用的;`mergeGeos` 只保 position/normal/color ⇒ 合併之後鑿刻岩的描邊外殼會沿硬邊面裂開。`buildHazard` 的合併 MUST 把 rock 件排除在合併之外,或同步併一份 outlineGeo。
- **`hazards.js` 的稽核樁件會當場 ReferenceError**:`tools/audit_object_joints.mjs:577` 是 `new Function('mesh','box','cyl','cone','ico','rockMesh','jitterColor','THREE','Math', BUILDERS 原文)`。`wreck` 一旦呼叫 `makeVehicle`,整支稽核在第一款就炸,而錯誤訊息與「接合」完全無關 —— 很容易被讀成「稽核壞了」而不是「忘了注入」。`audit_siteplan.mjs:96` 與 `audit_soft_stroke.mjs:260/436` 同一個坑。
- **`edgewall.js` 的零 import 契約**:該檔檔頭紀律①明文「零 import(除 `rng.js`)、零 THREE」,而 `audit_world_edge` 以原文釘住。加 `import { makeVehicle } from './vehicles.js'` 只有在 `vehicles.js` **本身也零 import** 時才不破壞這條;稽核那一條斷言的正規式可能寫死了 `rng.js` ⇒ 落地時 MUST 一併檢查並把 `vehicles.js` 明列為第二個合法 import。
- **`siteplan.js CIVIC_PARTS` 的 `col`/`vc`/`opt`/`sf` 四個通道都有語意**:`col` 決定進不進 `blockers`(缺了 = 隱形牆或走得進去的實心車)、`vc` 決定色相變異通道(車體與車頂 MUST 同通道才會一起轉色)、`opt` 是非碰撞小件的存缺通道(**`col` 件恆保留**)、`sf` 進分桶鍵。`makeVehicle` 產出的零件 MUST 把這四格原樣帶出來,漏 `col` 的症狀是「停車場的車可以走過去」而每一條斷言全綠。
- **③-2 的凹處不能烤進共用單位方盒**:一般建物是 `new THREE.BoxGeometry(1,1,1)` 的 InstancedMesh(biomes.js:9313),實例縮放就是 `(w,h,d)` ⇒ 任何寫進共用幾何的凹處深度都會隨每棟樓的進深伸縮(50m 進深的樓會長出 5m 深的騎樓)。硬做的話還會撞上 `wallpanel.js` 的窗格對齊(底層那一帶要改吃素牆帶),而症狀是「窗戶印在遮陽棚上」。
- **`beacons.depot` 的 `foot` 是雙向釘死的**:`audit_beacons` 同時驗「實算 ≤ 宣告」與「宣告沒有虛胖」⇒ 貨櫃換成 6.06m 真實尺寸時 `BEACON_KINDS.depot.foot = 6.0` 兩個方向都會紅,而落點規劃(`areaFree(blocked, …, foot + PAD)`)也要跟著讓開。
- **draw call 合併之後就不再逐件 frustum culling**:SKILL L6 的最後一條 —— 合併成 root-space 幾何之後包圍球會脹大。公設/障礙都是**局部**物件(< 100m)⇒ 這一條在本輪不咬人,但 `buildRoadBlocks` 的封路事件散在整個圖界上,合併時 MUST 逐處合併而不是整批合成一個 mesh。

## 逐位元中性

"這一項**沒有旋鈕**,它是收斂重構,所以答案要分兩層講。\n\n**(一)權威側:逐位元中性,可證。** `data.js` / `sim.js` / `server/**` 一行不改(`standEyeM()` 是新增的純函式、不進 `balanceFingerprint`、沒有任何權威消費端)⇒ `npm run bal` 與 `npm test` MUST **逐項不動**;動了就是純表現層漏到判定上。唯一要盯的權威接觸面是三處:①`siteplan` 停車場的九根碰撞柱(證法 = 新稽核比**車身 OBB 的四個世界角點**,容差 1e-9 —— 欄位表示會從 `2.2×4.8, ry=0` 變成 `4.8×2.2, ry=π/2`,那是同一個有向盒的另一種寫法,比欄位會假紅);②`buildRoadBlocks` 的 `blockers.push({ r: or2 })`(證法 = `crash` 仍回傳 5);③`beacons.depot` 的 `beaconCollider` 實測半徑(證法 = `audit_beacons` 兩向斷言仍綠)。\n\n**(二)世界佈局:10a 逐位元、10b 明知會變。** 佈局是否逐位元,唯一的判準是**共享 `rnd()` 的消耗枚數有沒有變**。四個消費端裡三個結構上不吃共享序列(`siteplan.CIVIC_PARTS` 零 rnd、走 `frac` 雜湊;`edgewall`/`beacons` 各自跑座標雜湊餵的 `mulberry32`;`hazards` 跑逐障礙的區域序列),**只有兩個吃**:`biomes.buildRoadBlocks`(共享 rnd 直接傳進來)與 `ground.DETAIL_DEFS`(間接 —— `detailR` 改變 ⇒ `detFree` 的淘汰結果改變 ⇒ 少抽/多抽 `orient` 與 `tx/tz` 那 3~4 枚)。\n\n⇒ **10a 的定義就是「這兩處逐位元不動」**:`crash/work/pit` 的 `rnd()` 逐枚不變、`carwreck`/`container` 的幾何仍收在原包絡內(只換形狀不換外廓)。證法有三道,缺一不可:①新稽核把 `detailR('carwreck')`/`detailR('container')` 的改制前數值硬寫成凍結常數當見證人(`--break-detr` 反向驗證);②同場地 warm 跑兩次比對 `buildBiomes` 的 `blockers`/`decks`/`tunnels` 逐項相同(verification.md「建構期讓步」那一列的 A/B 手法);③**`shot_scene` 的定場照 md5 與步 0 逐張相同** —— 這一條是唯一連「畫面真的沒變」都涵蓋的。\n\n**10b(把 SPEC 改成真實公稱尺寸)結構上不可能逐位元**,那是 §2.5(真實世界尺度)與 §2.3(確定性)的正面衝突,MUST 先拿到使用者裁決、先重拍定場照當新基準,再單獨 commit。"

## 卡在
- **需使用者裁決(§2.5 vs §2.3)**:`ground.js DETAIL_DEFS` 的 `carwreck`(實得世界長 1.71m)與 `container`(2.70m)與其他三份副本差 2.6~2.3×,而 §2.5 明文「人員/載具/建物一律用真實公稱尺寸」。但改尺寸 ⇒ `detailR` 變 ⇒ `detFree` 淘汰結果變 ⇒ **全圖散佈序列整條推移**(§2.3)。兩條路:(甲)10a 只收斂形狀、包絡凍結,那兩款維持錯誤尺度,佈局逐位元不變;(乙)10b 改成真實尺寸,接受全圖佈局改變 + 重拍全部定場照 + `rows('container', 4.0, …)` 節距改由 `detailR` 推導。**本輪按 (甲) 落地,(乙) 留給使用者。**
- **`curveEyeM()` 的引數順序缺陷(獨立一輪,需裁決)**:`data.js:1002` 寫 `heroTargetH(ch, lv)` 而簽章是 `heroTargetH(kind, ch)` ⇒ `HERO_SIZE['s01']` 是 undefined ⇒ 每一輪都走 `return SOLDIER_H * 4`。實測 `curveEyeM() = 4.0824`,正解 0.76545(差 5.33×),連帶 `curveR()` 應為 ~75,300 而現值 14,125 ⇒ 世界曲面的沉降量是設計值的 5.33 倍。`tools/audit_world_curve.mjs:89` **抄了同一份錯誤呼叫**,所以這道閘從來沒量到任何東西(刀與尺寫成同一份)。修它 = 13 張定場照全變 ⇒ 屬序 12 那一級的改動。**本輪 MUST NOT 碰它**,③-3 改用新的 `standEyeM()`;是否修、什麼時候修留給使用者。
- **③-2 要不要上一般方盒建物,需使用者定案**:載具/公設/邊界牆那三處的凹處是逐實例合併幾何 ⇒ 真實公尺深度免費。一般建物是單位 `BoxGeometry` 的 InstancedMesh(`biomes.js:9313`),凹處深度會隨每棟樓的進深伸縮 ⇒ 唯一可行是另開一顆貼在臨街面的 InstancedMesh(每個立面桶 +1 draw call),而且 `wallpanel.js` 的窗格對齊要把底層那一帶改吃素牆帶。代價明確、收益是「店面不再讀成一張貼紙」。**本輪只落地前三處,建物那一處出一份可行性說明留給使用者。**
- **需真瀏覽器(㋓,沙箱跑不動)**:`shot_scene`(10a 的逐位元證明就靠它)、`audit_traverse`(車體加大與凹處環會不會封死既有通道 —— SKILL L8 最後一條:0.4m 的柱子加上玩家半徑就能封死**另一個街區**的連通)、`audit_ground_drape`。交付說明 MUST 標註未驗項。
- **需真機冒煙(㋕)**:「這一台的車看起來不像車」在離線這端一條斷言都量不到。至少要:貼著停車場走一圈(九台車的碰撞盒仍貼合、車輪真的觸地)、站在店面凹處前 1m 與 5m 各看一次(③-3 的可視角是不是真的成立)、開一場看封路車禍(合併之後描邊有沒有沿內部接縫出線)。
