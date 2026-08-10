// ============ 道路格網量化(2026-08-10 使用者定案)============
// 使用者原句:「處理圖資時先找出地圖上下左右對準哪一個方向時,可以對齊最多的大馬路組成
// 正交網格,接著將所有道路量化成 16 個方向,同時盡可能避免讓道路變成鋸齒,這樣道路拼圖
// 可以透過這 16 個方向簡化並無縫準確貼合對齊,建築也更容易對齊排列。」
//
// 分工(這一支只做第二件事):
//   ①「地圖上下左右對準哪個方向」= 整份投影旋轉,住 `data.js`(`mapRot`/`llToXZ`);
//      角度由本檔的 `gridAngle()` 量出來,離線烘焙進 `venueGrid.js`。
//   ②「所有道路量化成 16 個方向」+「避免鋸齒」+「無縫貼合」= 本檔 `quantizeRoads()`。
//   ③ 建築/地被的朝向本來就取自最近道路(`biomes.nearestRoadAngle` → `siteplan.roadFaceRy`、
//      `ground.orient`),道路一被量化,那兩者自動落在同一組 16 方向 —— 本檔 MUST NOT 另外
//      去碰建築(第二份對齊規則 = 兩套朝向打架)。
//
// **零 import**(同 `rng.js`/`vernacular.js`/`ctrlmode.js`):投影與經緯度一律由呼叫端以
// `toXZ`/`toLL` 回呼注入 —— 這是離線稽核 `tools/audit_road_grid.mjs` 能直接吃真品的唯一理由。
// **零亂數**(§2.3):本檔一枚共享 `rnd()` 都不消耗,也不自帶亂數 —— 量化必須是圖資的純函式,
// 否則同一份 geocache 定案的路網會在不同客戶端長出不同的路口。
//
// 三件事一起做才成立,少任何一件都是可見的破圖:
//   ⓐ **量化**:每段的方位吸附到 16 格之一(22.5°/格)。
//   ⓑ **去鋸齒**:格界附近的抖動會讓一條 10° 的路變成 0°/22.5° 交替的鋸齒 —— 靠「沿路走、
//      偏離真實路線超過預算才換格」的位置空間遲滯(`assignDirs`),直段長度因此有**推導出來的
//      下界**(`minStraightM()`),不是靠事後把短段併掉。
//   ⓒ **無縫**:路口是**共用節點**,量化 MUST 是「解出新的節點位置」而不是「逐 way 各轉各的」——
//      逐 way 各轉,兩條路在路口就會裂開一條縫,而畫面上只表現成「路口破了一塊」。
//
// 為什麼是「鬆弛 + 逐段長度重解」兩步:把每條邊釘在指定方向上是一組線性約束,有迴圈的
// 路網通常**無解**(三條邊的方向湊不出封閉三角形)⇒ 只能取最小平方。鬆弛給出全域最佳的
// 節點位置;之後再逐「錨點到錨點」的段落重解**長度**,把該段內部的每一條邊拉回**精確**的
// 16 方向並精確收在兩端錨點上 ⇒ 殘差只剩在「路口到路口只有一條邊」那種段落上。

export const ROAD_GRID = {
  DIRS: 16,             // 方向格數(360/16 = 22.5°)
  // **位移上限(遊戲公尺,硬約束)**:任一節點離它在圖資上的真實位置的最大距離。
  // 這是本檔唯一的硬邊界,理由是量化的代價會**沿著路累積** —— 一條方位剛好卡在格界
  // (11.25°)的長直路,硬轉到鄰格的話尾端會甩出數百公尺(實測合成 1.5km 路 = 518m),
  // 而那條路就此離開衛星底圖、離開已整平的路基、離開自己那排建物,畫面上看起來像
  // 「馬路長在草地上」而沒有任何錯誤訊息。寧可留下角度殘差,也 MUST NOT 讓路走掉(原則 6)。
  // 值 = 約一個車道寬(真實 7m):肉眼看不出路挪了,但足夠把幾度的殘差吸收掉。
  MAX_DRIFT_M: 14,
  // 細分後每一步的量化偏差只准吃掉預算的 1/DENSIFY_F(`densifyM()` 由此反推頂點間距)。
  // **量化之前 MUST 先細分**:一段的偏差 ≈ 段長 × 角度誤差,OSM 原始頂點在直路上可以隔到
  // 一兩百公尺,單單一段就吃掉 20m 預算 ⇒ DDA 每一步都超標、逐段換格,結果不是量化而是鋸齒
  // (實測 100m 頂點間距的斜街:量化前 10.1° → 量化後 10.3°,等於整條沒被量化)。
  DENSIFY_F: 4,
  DDA_F: 0.5,           // DDA 換格門檻佔硬上限的比例(見 assignDirs;留給細分步 + 長度重解的餘裕)
  RELAX_SWEEPS: 64,     // 節點鬆弛掃描數
  ANCHOR_W: 0.05,       // 拉回原位權重(起始值;沿掃描退火到 ANCHOR_END 倍)
  ANCHOR_END: 0.1,      // 退火終點倍率 —— 收尾幾乎是純方向投影,殘差才收得下去
  DEGEN_EPS: 1e-4,      // 方向集是否張得開 2D 的判準(2×2 法方程行列式 / 跡²)
};

/** 把 (qx,qz) 夾回「離原位 ≤ MAX_DRIFT_M」的圓盤內(位移硬上限的唯一實作) */
function clampDrift(qx, qz, px, pz, i) {
  const dx = qx[i] - px[i], dz = qz[i] - pz[i];
  const d = Math.hypot(dx, dz);
  if (d <= ROAD_GRID.MAX_DRIFT_M) return false;
  const f = ROAD_GRID.MAX_DRIFT_M / d;
  qx[i] = px[i] + dx * f;
  qz[i] = pz[i] + dz * f;
  return true;
}

/** 第 k 格的方位角(rad)。世界已被主方位旋轉過 ⇒ 格網錨在 0,不再有第二個偏移量。 */
export const dirAngle = (k) => k * (Math.PI * 2 / ROAD_GRID.DIRS);
/** 半格(rad):任一方位離最近格的最大距離 */
export const halfBin = () => Math.PI / ROAD_GRID.DIRS;
/** 量化前的細分間距(遊戲公尺)—— **推導,MUST NOT 手寫**:段長 × 半格 ≈ 該段的量化偏差 */
export const densifyM = () => ROAD_GRID.MAX_DRIFT_M / (ROAD_GRID.DENSIFY_F * halfBin());
/**
 * 量化後「同一個方向能連續走多遠」的**結構下界**(遊戲公尺)= 換格門檻 ÷ sin(半格)。
 * 這就是「不變成鋸齒」的保證本身,而且是**推導**出來的:DDA 只在偏離真實路線超過門檻時
 * 換格,而偏差最快也只能以 sin(半格) 的斜率累積 ⇒ 換格週期不可能比這更短。
 * MUST NOT 改用「事後把短段併掉」來達成同一件事(見 `assignDirs` ⓑ)。
 */
export const minStraightM = () => ROAD_GRID.MAX_DRIFT_M * ROAD_GRID.DDA_F / Math.sin(halfBin());

/**
 * 地圖主方位:一組線段的「mod 90° 長度加權圓平均」,回 (−45°, 45°] 的弧度,無樣本回 null。
 * ×4 倍角是關鍵 —— 地籍格網對 90° 旋轉對稱,不取 4 倍角的話南北向與東西向街道會互相抵銷成 0。
 * 取樣面由呼叫端決定(烘焙取**大馬路**、`ground.js` 的擺件格網取全部道路),本檔只有這一份實作。
 * @param {Array<[number,number,number,number]>} segs 世界座標線段 [x0,z0,x1,z1]
 */
export function gridAngle(segs) {
  let sx = 0, sz = 0;
  for (const s of segs) {
    const dx = s[2] - s[0], dz = s[3] - s[1];
    const len = Math.hypot(dx, dz);
    if (len < 1e-3) continue;
    const a4 = Math.atan2(dz, dx) * 4;
    sx += Math.cos(a4) * len;
    sz += Math.sin(a4) * len;
  }
  if (sx * sx + sz * sz <= 1e-12) return null;
  return Math.atan2(sz, sx) / 4;
}

/** ways(`{tags, geometry:[{lat,lon}]}`)攤成 gridAngle 吃的線段陣列;filter 缺席 = 全收 */
export function waySegs(ways, toXZ, filter = null) {
  const segs = [];
  for (const w of ways || []) {
    if (filter && !filter(w)) continue;
    const g = w.geometry || [];
    for (let i = 1; i < g.length; i++) {
      const a = toXZ(g[i - 1]), b = toXZ(g[i]);
      segs.push([a[0], a[1], b[0], b[1]]);
    }
  }
  return segs;
}

/**
 * 主方位的**取樣面**:大馬路。使用者定案的原句是「對齊最多的**大馬路**組成正交網格」,
 * 不是「對齊最多的路」—— 巷弄與 service 道路在市區的總長度遠大於幹道,收進來的話主方位
 * 會被停車場通道與後巷帶著走(它們本來就不成格網)。
 * `.source` 就是 Overpass 查詢要的字串 ⇒ **離線烘焙與執行期共用同一份定義**,
 * MUST NOT 在查詢字串裡再手寫一次(那是第二份會過期的取樣面)。
 */
export const GRID_HW = /^(motorway|trunk|primary|secondary|tertiary)$/;

/**
 * 地圖主方位(**度**):把地圖轉這麼多度,這一帶的大馬路就會對齊世界軸。量不到回 null。
 *
 * 這是「一組 way → 一個角度」的**唯一縫**,離線烘焙(`tools/bake_venue_grid.mjs`)與
 * 執行期(自訂地圖存入最愛時量一次)同吃。三件事綁在一起,拆開任何一件都會讓兩條路徑
 * 算出不同的角度(而畫面上只表現成「這張圖沒轉正」):
 *   ① 取樣面 = `GRID_HW`(大馬路);
 *   ② 量測 MUST 在**未旋轉**的框裡做(`toXZ` 的 center MUST NOT 帶 rot)—— 量到的是
 *      「格網相對正北偏多少」;
 *   ③ 旋轉量是它的**負值**(把格網轉回軸對齊)。
 * @param {Array<{tags:object, geometry:Array<{lat:number,lon:number}>}>} ways
 * @param {(p:{lat:number,lon:number}) => [number, number]} toXZ 未旋轉框的投影
 */
export function roadGridRotDeg(ways, toXZ) {
  const segs = waySegs(ways, toXZ, (w) => GRID_HW.test(w.tags?.highway || ''));
  if (!segs.length) return null;
  const a = gridAngle(segs);
  return a == null ? null : -a * 180 / Math.PI;
}

/** 方位角 → 最近的格(0..DIRS-1) */
function nearestDir(a) {
  const N = ROAD_GRID.DIRS;
  return ((Math.round(a / (Math.PI * 2 / N)) % N) + N) % N;
}
/** 帶號最小夾角(−π, π] */
function wrapPi(a) { return Math.atan2(Math.sin(a), Math.cos(a)); }

/**
 * 逐 way 指派方向格(去鋸齒的兩道手續都在這裡)。
 *
 * ⓐ 主手續是**位置空間**的遲滯,不是角度空間的:沿著 way 走一遍,一邊用「已選的格 + 原段長」
 *    推進一個虛擬位置 `cur`,一邊和真實頂點比 —— **只要 `cur` 還在真實路線的 MAX_DRIFT_M 之內
 *    就繼續沿用同一格**,離太遠才換格,而且換格時是「從 `cur` 指向下一個**真實**頂點」
 *    (自我修正 ⇒ 偏差不累積)。這一步同時買到三件事:
 *      ・沿用同一格 = 長直段 ⇒ 不是鋸齒(換格週期 ≈ MAX_DRIFT_M / sin(11.25°) ≈ 72m);
 *      ・偏差有界 ⇒ 路不會走離衛星底圖、不會離開自己那條兵線;
 *      ・剛好落在格上的路(全域旋轉之後的大馬路就是)一次都不會換格。
 *    角度空間的遲滯(「差幾度以內就沿用」)做不到這三件事:它管得住格界抖動,管不住
 *    「整條路系統性偏 11.25°」—— 那種路會被整條吸到鄰格上,尾端甩出去幾百公尺。
 * ⓑ **MUST NOT 再加一道事後的「短段併入鄰段」** —— 那是角度遲滯時代的清理手續,在 DDA 上是
 *    反效果:它會把 DDA 剛排好的階梯整個併回同一格,於是整段變成單一方向 ⇒ 長度重解退化
 *    ⇒「兩錨點之間拉直」= 那條路等於沒被量化。實測(同一份合成路網):拿掉併段後角度誤差
 *    p90 由 5.9° 掉到 0.5°、斜街/圓弧/格界長直路三條由 6~10° 掉到 0.00°,而直段均長只從
 *    122m 降到 86m —— 併段買到的「更長的直段」本來就不是問題,它賣掉的才是。
 *
 * @returns {number[]} 每一段(頂點數 − 1)的格號
 */
function assignDirs(ch, px, pz) {
  const m = ch.length - 1;
  if (m < 1) return [];
  // DDA 的換格門檻**刻意低於**硬上限:走完這一步還會再吃掉一個細分步的偏差,而後面的
  // 長度重解也要有餘裕落地 —— 門檻頂著硬上限的話,DDA 自己走出來的路徑就已經卡在邊界上,
  // 長度重解的候選解一律驗不過、整段退回「兩錨點之間拉直」= 那條路等於沒被量化。
  const CAP = ROAD_GRID.MAX_DRIFT_M * ROAD_GRID.DDA_F;
  const len = new Array(m), d = new Array(m).fill(0);
  for (let i = 0; i < m; i++) {
    len[i] = Math.hypot(px[ch[i + 1]] - px[ch[i]], pz[ch[i + 1]] - pz[ch[i]]);
  }
  // ---- ⓐ 沿路 DDA:偏差在預算內就不換格 ----
  let cx = px[ch[0]], cz = pz[ch[0]];
  let k = -1;
  for (let i = 0; i < m; i++) {
    if (len[i] < 1e-9) { d[i] = k < 0 ? 0 : k; continue; }
    const tx = px[ch[i + 1]], tz = pz[ch[i + 1]];
    if (k >= 0) {
      const a = dirAngle(k);
      const dev = Math.hypot(cx + Math.cos(a) * len[i] - tx, cz + Math.sin(a) * len[i] - tz);
      if (dev > CAP) k = -1;
    }
    if (k < 0) k = nearestDir(Math.atan2(tz - cz, tx - cx));
    const a = dirAngle(k);
    cx += Math.cos(a) * len[i];
    cz += Math.sin(a) * len[i];
    d[i] = k;
  }
  return d;
}

/**
 * 節點鬆弛:把每條邊的「垂直於指定方向」的分量逐次投影掉(Gauss-Seidel/PBD),
 * 同時以退火的權重把節點拉回原位(形狀保真;收尾權重降到 ANCHOR_END 倍 ⇒ 方向贏)。
 * 投影對兩端**對稱**施力 ⇒ 每條邊的中點不動 ⇒ 整體不會平移漂走。
 * 掃描方向逐輪交替(前向/後向),長鏈的修正才不會只從一頭慢慢擴散。
 */
function relax(edges, px, pz, qx, qz) {
  const m = edges.a.length;
  if (!m) return;
  const n = qx.length;
  const { RELAX_SWEEPS, ANCHOR_W, ANCHOR_END } = ROAD_GRID;
  for (let s = 0; s < RELAX_SWEEPS; s++) {
    const fwd = (s & 1) === 0;
    for (let t = 0; t < m; t++) {
      const e = fwd ? t : m - 1 - t;
      const a = edges.a[e], b = edges.b[e], ux = edges.ux[e], uz = edges.uz[e];
      const dx = qx[b] - qx[a], dz = qz[b] - qz[a];
      const pr = dx * ux + dz * uz;
      const ex = (dx - ux * pr) * 0.5, ez = (dz - uz * pr) * 0.5;
      qx[a] += ex; qz[a] += ez;
      qx[b] -= ex; qz[b] -= ez;
    }
    const w = ANCHOR_W * (1 + (ANCHOR_END - 1) * (RELAX_SWEEPS < 2 ? 1 : s / (RELAX_SWEEPS - 1)));
    for (let i = 0; i < n; i++) {
      qx[i] += (px[i] - qx[i]) * w;
      qz[i] += (pz[i] - qz[i]) * w;
      clampDrift(qx, qz, px, pz, i);   // 位移硬上限 MUST 每一輪都夾(只夾收尾 = 中途早就飛出去)
    }
  }
}

/**
 * 逐「錨點 → 錨點」段落重解**長度**:段內每一條邊都精確落在自己那一格上,而且精確收在
 * 兩端錨點(路口)之上 —— 這就是「無縫準確貼合」。
 * 解法 = 在 Σ Lᵢ·uᵢ = D 這兩條線性約束下,對原長做最小平方修正(2×2 法方程,解析解)。
 * 兩種退化都退回「兩錨點之間等比直線擺放」(仍然沒有鋸齒,只是那一段的方位不精確):
 *   ・方向集張不開 2D(整段被併成同一格 = 一條直路)⇒ 垂直分量本來就補不回來;
 *   ・修正後出現負長度(方向彼此幾乎反向的病態段)⇒ 硬解會讓路自己折回去。
 */
function closeRun(ch, d, s, e, px, pz, qx, qz) {
  const m = e - s;
  if (m < 2) return;                       // 單邊段落:方向由鬆弛決定,這裡無事可做
  const ax = ch[s], bx = ch[e];
  const Dx = qx[bx] - qx[ax], Dz = qz[bx] - qz[ax];
  let m00 = 0, m01 = 0, m11 = 0, sx = 0, sz = 0;
  const ux = new Array(m), uz = new Array(m), L = new Array(m);
  for (let i = 0; i < m; i++) {
    const a = dirAngle(d[s + i]);
    ux[i] = Math.cos(a); uz[i] = Math.sin(a);
    const p = ch[s + i], q = ch[s + i + 1];
    L[i] = Math.hypot(px[q] - px[p], pz[q] - pz[p]);
    m00 += ux[i] * ux[i]; m01 += ux[i] * uz[i]; m11 += uz[i] * uz[i];
    sx += ux[i] * L[i]; sz += uz[i] * L[i];
  }
  const det = m00 * m11 - m01 * m01;
  const tr = m00 + m11;
  let okSolve = det > ROAD_GRID.DEGEN_EPS * tr * tr;
  if (okSolve) {
    const rx = Dx - sx, rz = Dz - sz;
    const lx = (m11 * rx - m01 * rz) / det, lz = (m00 * rz - m01 * rx) / det;
    for (let i = 0; i < m; i++) {
      L[i] += ux[i] * lx + uz[i] * lz;
      if (L[i] < 0) { okSolve = false; break; }
    }
  }
  // 候選解 MUST 先整段驗過位移上限再落地 —— 精確落格是加分題,「路不准走掉」是硬約束。
  // 落地後才夾會把剛解出來的精確段落夾歪(等於白解),所以是 check-then-apply。
  const cand = new Array(m - 1);
  if (okSolve) {
    let cx = qx[ax], cz = qz[ax];
    for (let i = 0; i < m - 1; i++) {
      cx += ux[i] * L[i]; cz += uz[i] * L[i];
      cand[i] = [cx, cz];
      const id = ch[s + i + 1];
      if (Math.hypot(cx - px[id], cz - pz[id]) > ROAD_GRID.MAX_DRIFT_M) { okSolve = false; break; }
    }
  }
  if (okSolve) {
    for (let i = 0; i < m - 1; i++) { qx[ch[s + i + 1]] = cand[i][0]; qz[ch[s + i + 1]] = cand[i][1]; }
    return;
  }
  // 退化 / 超出位移上限:兩錨點之間依原長等比擺放(共線 ⇒ 仍無鋸齒);同樣先驗再落地
  let tot = 0;
  for (let i = 0; i < m; i++) tot += Math.hypot(px[ch[s + i + 1]] - px[ch[s + i]], pz[ch[s + i + 1]] - pz[ch[s + i]]);
  if (tot <= 0) return;
  let acc = 0;
  for (let i = 0; i < m - 1; i++) {
    acc += Math.hypot(px[ch[s + i + 1]] - px[ch[s + i]], pz[ch[s + i + 1]] - pz[ch[s + i]]);
    const f = acc / tot;
    const id = ch[s + i + 1];
    const cx = qx[ax] + Dx * f, cz = qz[ax] + Dz * f;
    if (Math.hypot(cx - px[id], cz - pz[id]) > ROAD_GRID.MAX_DRIFT_M) return;   // 這一段整段維持鬆弛解
    cand[i] = [cx, cz];
  }
  for (let i = 0; i < m - 1; i++) { qx[ch[s + i + 1]] = cand[i][0]; qz[ch[s + i + 1]] = cand[i][1]; }
}

/**
 * 把整份路網量化到 16 個方向。**way 的順序、tags、端點的節點身分一律不變**;頂點會因為
 * 量化前的細分而變多(見 `DENSIFY_F`)—— 下游本來就會再 densify 到 `ROAD_SEG`,多出來的
 * 頂點只是提早出現,`mergeGradeChains` 靠端點配對、`way._tun[ri]` 在此之後才建,皆不受影響。
 *
 * @param {Array} ways   `{tags, geometry:[{lat,lon}]}`;原陣列不被修改(回新的 way 物件)
 * @param {(p)=>[number,number]} toXZ   `{lat,lon}` → 世界公尺
 * @param {(x,z)=>{lat,lon}} toLL       世界公尺 → `{lat,lon}`
 * @param {object} [stats]              選填;填入 `{nodes, edges, anchors, offDeg, movedM}` 供稽核/烘焙報表
 * @returns {Array} 量化後的 ways
 */
export function quantizeRoads(ways, toXZ, toLL, stats = null) {
  if (!ways?.length) return ways;
  // ---- ① 節點索引 + 細分 ----
  // 共用節點 = 同一把鑰匙 ⇒ 路口的連通性由「同一個 id」保證。OSM `out geom` 在共用節點上
  // 給的是**逐位元相同**的 lat/lon,字串鍵直接對得上;MUST NOT 先 round(兩條路的路口被
  // round 到不同格 = 路口裂開)。細分點是 way 自己的內部點、**永不共用** ⇒ 不進鑰匙表,
  // 也因此不會把兩條剛好交錯而過的路誤黏成一個路口。
  const idx = new Map();
  const px = [], pz = [];
  const newNode = (x, z) => { px.push(x); pz.push(z); return px.length - 1; };
  const nodeOf = (p) => {
    const k = `${p.lat},${p.lon}`;
    let id = idx.get(k);
    if (id === undefined) {
      const xz = toXZ(p);
      id = newNode(xz[0], xz[1]);
      idx.set(k, id);
    }
    return id;
  };
  const SEG = densifyM();
  const chains = ways.map((w) => {
    const g = w.geometry || [];
    if (g.length < 2) return g.map(nodeOf);
    const ch = [nodeOf(g[0])];
    for (let i = 1; i < g.length; i++) {
      const a = ch[ch.length - 1], b = nodeOf(g[i]);
      const ax = px[a], az = pz[a], bx = px[b], bz = pz[b];
      const k = Math.max(1, Math.ceil(Math.hypot(bx - ax, bz - az) / SEG));
      for (let t = 1; t < k; t++) ch.push(newNode(ax + (bx - ax) * t / k, az + (bz - az) * t / k));
      ch.push(b);   // 原始頂點 MUST 是**同一個 id**(內插到端點會差最後一個 ulp = 路口裂開)
    }
    return ch;
  });
  const n = px.length;
  const qx = Float64Array.from(px), qz = Float64Array.from(pz);
  // 錨點 = 路口與端點:way 端點 / 被兩條以上 way 用到 / 同一條 way 自交
  const hits = new Int32Array(n);
  const anchor = new Uint8Array(n);
  for (const ch of chains) {
    if (!ch.length) continue;
    anchor[ch[0]] = 1;
    anchor[ch[ch.length - 1]] = 1;
    const seen = new Set();
    for (const id of ch) {
      if (seen.has(id)) anchor[id] = 1;
      else { seen.add(id); hits[id]++; }
    }
  }
  for (let i = 0; i < n; i++) if (hits[i] > 1) anchor[i] = 1;

  // ---- ② 逐 way 指派方向格(遲滯 + 短段併入)----
  const dirs = chains.map((ch) => assignDirs(ch, px, pz));

  // ---- ③ 全域節點鬆弛 ----
  const edges = { a: [], b: [], ux: [], uz: [] };
  for (let w = 0; w < chains.length; w++) {
    const ch = chains[w], d = dirs[w];
    for (let i = 0; i < d.length; i++) {
      if (ch[i] === ch[i + 1]) continue;
      const a = dirAngle(d[i]);
      edges.a.push(ch[i]); edges.b.push(ch[i + 1]);
      edges.ux.push(Math.cos(a)); edges.uz.push(Math.sin(a));
    }
  }
  relax(edges, px, pz, qx, qz);

  // ---- ④ 逐段長度重解(段內精確落格 + 精確收在錨點上)----
  for (let w = 0; w < chains.length; w++) {
    const ch = chains[w], d = dirs[w];
    if (d.length < 2) continue;
    let s = 0;
    for (let e = 1; e < ch.length; e++) {
      if (e < ch.length - 1 && !anchor[ch[e]]) continue;
      closeRun(ch, d, s, e, px, pz, qx, qz);
      s = e;
    }
  }

  // ---- ⑤ 寫回經緯度(同一個節點 id ⇒ 兩條 way 拿到逐位元相同的 lat/lon)----
  const out = ways.map((w, wi) => {
    const ch = chains[wi];
    if (!ch.length) return w;
    return { ...w, geometry: ch.map((id) => toLL(qx[id], qz[id])) };
  });

  if (stats) {
    let anchors = 0;
    for (let i = 0; i < n; i++) if (anchor[i]) anchors++;
    const off = [], mv = [];
    for (let e = 0; e < edges.a.length; e++) {
      const a = edges.a[e], b = edges.b[e];
      const dx = qx[b] - qx[a], dz = qz[b] - qz[a];
      if (Math.hypot(dx, dz) < 1e-9) continue;
      off.push(Math.abs(wrapPi(Math.atan2(dz, dx) - Math.atan2(edges.uz[e], edges.ux[e]))) * 180 / Math.PI);
    }
    for (let i = 0; i < n; i++) mv.push(Math.hypot(qx[i] - px[i], qz[i] - pz[i]));
    const pct = (arr, p) => (arr.length ? arr.slice().sort((x, y) => x - y)[Math.min(arr.length - 1, Math.floor(arr.length * p))] : 0);
    stats.nodes = n;
    stats.edges = edges.a.length;
    stats.anchors = anchors;
    stats.offDeg = { p50: pct(off, 0.5), p90: pct(off, 0.9), p99: pct(off, 0.99), max: off.length ? Math.max(...off) : 0 };
    stats.movedM = { p50: pct(mv, 0.5), p90: pct(mv, 0.9), max: mv.length ? Math.max(...mv) : 0 };
  }
  return out;
}

/**
 * 量測「一份路網離 16 方向有多遠」(度):稽核與烘焙報表用,對量化前後同一把尺。
 * 回 `{n, p50, p90, max}`。
 */
export function dirErrorDeg(ways, toXZ) {
  const STEP = Math.PI * 2 / ROAD_GRID.DIRS;
  const es = [];
  for (const s of waySegs(ways, toXZ)) {
    const dx = s[2] - s[0], dz = s[3] - s[1];
    if (Math.hypot(dx, dz) < 1e-9) continue;
    const a = Math.atan2(dz, dx);
    es.push(Math.abs(wrapPi(a - Math.round(a / STEP) * STEP)) * 180 / Math.PI);
  }
  es.sort((x, y) => x - y);
  const at = (p) => (es.length ? es[Math.min(es.length - 1, Math.floor(es.length * p))] : 0);
  return { n: es.length, p50: at(0.5), p90: at(0.9), max: es.length ? es[es.length - 1] : 0 };
}
