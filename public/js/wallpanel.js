// ============ 平整垂直牆面板 + 窗格對齊(2026-08-13 使用者「平面區域太小的話不渲染窗戶,
//              窗戶會被裁切掉的時候也不渲染」)============
//
// ---- 這一支修的是什麼 ----
// 立面貼圖是**盒投影**上去的:窗格的網格住在貼圖座標裡,而牆面板的邊界落在任意的 u/v 上
// ⇒ 每一面牆的兩側都會切到半扇窗,小面板上更只剩一片窗的碎屑。使用者這一輪的兩句話就是
// 「不要畫切一半的窗」與「小到放不下一扇窗的面就別畫」。
//
// ---- 為什麼不必改成幾何窗(使用者括號裡那句的條件沒有成立)----
// 「逐格決定要不要畫」的前提是知道**這一棟**的格子多大,而 `cols`(立面款)與 `rows`
// (由樓高推導)都是逐棟的、UV 卻烤在共用節點上 —— 這是「貼圖做不到」的真正理由。
// 但**格數與實例縮放無關**:
//     k = 面板寬(世界)÷ 格寬(世界) = (面板寬_local × sx) ÷ (b.w ÷ cols)
//       = 面板寬_local × cols ÷ 節點局部寬        ← sx 約掉了
// 同理 m = 面板高_local × rows ÷ 節點局部高。⇒ k / m 只跟 (節點, cols, rows) 有關,
// 而 `cols`/`rows` 正是**立面材質桶的鍵**(`wallOf(rows)` / FACADES 款)。
// ⇒ 逐「節點 × 材質桶」烤一份對齊過的 UV 就夠,**InstancedMesh 的分組一格不動、
//   draw call 不變、三角形不變、名冊不變、預算不變**。改成幾何窗要多 ~21,000 個三角形
//   與一條新的渲染路(量過:16 棟約 10,700 片),而它換不到任何額外的正確性。
//
// ---- 三條紀律 ----
// ① **零 import**(同 `roadgrid.js`/`edgewall.js`):離線工具(`tools/ai3d/parts_src.mjs`)與
//    遊戲端 `biomes.js` 吃**同一支**,面板的定義因此只有一份。`normalize_parts.py` 那一份是
//    刻意的第二份(匯出端的刀 vs 量測端的尺,見 A46 ⑥ 與 parts_src 檔頭)。
// ② **格數用 `Math.round` 不是 `Math.floor`**:floor 會在面板邊緣留下一條寬度不足一格的
//    餘料,而那條餘料的 UV 只能是「半扇窗」或「一條要另外切三角形才畫得出來的素牆」——
//    前者正是要修的東西,後者要動拓樸。round ⇒ 格子稍微伸縮去**貼滿**面板,
//    窗恆為整扇、面板邊緣恆是格線。伸縮量 ≤ 1/(2k),k ≥ 4 時 ≤ 12%。
// ③ **k 或 m 會 round 成 0 的面板整片改吃素牆帶**(= 使用者的第一句)。判定是逐面板的
//    ⇒ 不會有「同一片面板一半有窗一半沒有」這種要切三角形才畫得出來的邊界。
//
// ⚠ **跨面板的共用頂點 MUST 先拆開**:同一個頂點屬於兩片面板時只寫得下一組 UV,後寫的
//    那一份會把另一片的三角形整個拉歪 —— 而那個歪掉的三角形恰好就長在面板邊界上,
//    看起來正是「被裁一半的窗」。實測 GLB 的整棟量體節點雖然是平面著色匯出(拆分比 2.93),
//    仍有約 2% 的頂點是共用的(`profGeo` 保險絲則是全拆、零成本)。⇒ `splitByPanel` 先拆,
//    只複製**真的衝突**的那幾顆(位置/法線/索引跟著長,三角形數與 draw call 不變)。

/** 面板判定的預設門檻;真值住 `tools/ai3d/tri_budget.json` 的 `families.building.planar_spec`,
 *  呼叫端 MUST 從那裡注入(這裡的預設只是讓這支檔案自己可讀) */
export const PANEL = { DEG: 12, OFF_F: 0.03, WALL_NY: 0.15, FLAT_DEG: 6, MIN_F: 0.005 };

const dot3 = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

/**
 * 平面分群(`wallPanels` 與收斂量測 `parts_src.solidConverge` 的**共用底層**)。
 * 規則與 `normalize_parts.py _plane_groups` 逐條相同:法線夾角 ≤ `DEG` **且** 平面偏移
 * ≤ `OFF_F` × 跨距;每收一片就重擬(面積加權)。零亂數、依三角形序定序 ⇒ 決定性。
 * ⚠ 這裡**不做**匯出端那條軸向吸附(`PLANAR_AXIS`)—— 吸附是「刀」的一部分,
 *   量測端跟著吸就量不到「它到底有沒有被吸到軸上」(A46 ⑥ 的刀 vs 尺)。
 * @param {ArrayLike<number>} pos  逐頂點 xyz
 * @param {ArrayLike<number>} idx  逐三角形頂點索引
 */
export function planeGroups(pos, idx, o = PANEL) {
  const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < pos.length; i += 3) for (let a = 0; a < 3; a++) { lo[a] = Math.min(lo[a], pos[i + a]); hi[a] = Math.max(hi[a], pos[i + a]); }
  const span = Math.max(hi[0] - lo[0], hi[1] - lo[1], hi[2] - lo[2]) || 1;
  const off = span * o.OFF_F, cosT = Math.cos(o.DEG * Math.PI / 180);
  const nT = idx.length / 3;
  const fn = new Float64Array(nT * 3), fc = new Float64Array(nT * 3), fa = new Float64Array(nT);
  let totA = 0;
  for (let t = 0; t < nT; t++) {
    const a = idx[t * 3] * 3, b = idx[t * 3 + 1] * 3, c = idx[t * 3 + 2] * 3;
    const ux = pos[b] - pos[a], uy = pos[b + 1] - pos[a + 1], uz = pos[b + 2] - pos[a + 2];
    const vx = pos[c] - pos[a], vy = pos[c + 1] - pos[a + 1], vz = pos[c + 2] - pos[a + 2];
    const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    const L = Math.hypot(nx, ny, nz);
    if (!L) continue;
    fn[t * 3] = nx / L; fn[t * 3 + 1] = ny / L; fn[t * 3 + 2] = nz / L;
    fc[t * 3] = (pos[a] + pos[b] + pos[c]) / 3;
    fc[t * 3 + 1] = (pos[a + 1] + pos[b + 1] + pos[c + 1]) / 3;
    fc[t * 3 + 2] = (pos[a + 2] + pos[b + 2] + pos[c + 2]) / 3;
    fa[t] = L / 2; totA += L / 2;
  }
  const G = [];
  const refit = (g) => {
    let nx = 0, ny = 0, nz = 0, cx = 0, cy = 0, cz = 0, A = 0;
    for (const t of g.f) {
      nx += fn[t * 3] * fa[t]; ny += fn[t * 3 + 1] * fa[t]; nz += fn[t * 3 + 2] * fa[t];
      cx += fc[t * 3] * fa[t]; cy += fc[t * 3 + 1] * fa[t]; cz += fc[t * 3 + 2] * fa[t]; A += fa[t];
    }
    const L = Math.hypot(nx, ny, nz) || 1;
    g.n = [nx / L, ny / L, nz / L]; g.c = [cx / A, cy / A, cz / A]; g.area = A;
  };
  for (let t = 0; t < nT; t++) {
    if (!fa[t]) continue;
    const n = [fn[t * 3], fn[t * 3 + 1], fn[t * 3 + 2]], c = [fc[t * 3], fc[t * 3 + 1], fc[t * 3 + 2]];
    let hit = null;
    for (const g of G) {
      if (dot3(n, g.n) < cosT) continue;
      if (Math.abs((c[0] - g.c[0]) * g.n[0] + (c[1] - g.c[1]) * g.n[1] + (c[2] - g.c[2]) * g.n[2]) > off) continue;
      hit = g; break;
    }
    if (hit) { hit.f.push(t); refit(hit); } else G.push({ n, c, f: [t], area: fa[t] });
  }
  for (const g of G) refit(g);
  return { G, fn, fc, fa, totA, span, lo, hi, nT };
}

/**
 * 把幾何切成**平整垂直牆面板**。回傳的 `faceOf[三角形序] = 面板索引`(−1 = 不是平整垂直牆)。
 * 分群走 `planeGroups`(同一份規則,收斂量測也吃它)。
 * @param {ArrayLike<number>} pos  逐頂點 xyz
 * @param {ArrayLike<number>} idx  逐三角形頂點索引
 */
export function wallPanels(pos, idx, o = PANEL) {
  const { G, fn, fa, totA, span, lo, hi, nT } = planeGroups(pos, idx, o);
  const cosF = Math.cos(o.FLAT_DEG * Math.PI / 180);
  // 只留「近垂直 + 夠大」的群,並量它自己平面上的 2D 外框(u 沿水平切向、v 取世界 Y)
  const panels = [], faceOf = new Int32Array(nT).fill(-1);
  const T = Math.max(totA, 1e-9);
  for (const g of G) {
    if (Math.abs(g.n[1]) > o.WALL_NY || g.area / T < o.MIN_F) continue;
    const tl = Math.hypot(g.n[2], g.n[0]) || 1;
    const tu = [-g.n[2] / tl, 0, g.n[0] / tl];
    let u0 = Infinity, u1 = -Infinity, v0 = Infinity, v1 = -Infinity;
    const own = [];
    for (const t of g.f) {
      // **逐面再驗一次平整**(`FLAT_DEG` ≪ `DEG`):分群是「這幾塊算不算同一面牆」,
      // 平整是「它真的貼在那個平面上了沒」。兩個用同一個數字這道閘就恆真。
      if (dot3([fn[t * 3], fn[t * 3 + 1], fn[t * 3 + 2]], g.n) < cosF) continue;
      own.push(t);
      for (let j = 0; j < 3; j++) {
        const p = idx[t * 3 + j] * 3;
        const u = pos[p] * tu[0] + pos[p + 2] * tu[2];
        u0 = Math.min(u0, u); u1 = Math.max(u1, u);
        v0 = Math.min(v0, pos[p + 1]); v1 = Math.max(v1, pos[p + 1]);
      }
    }
    if (!own.length) continue;
    const pi = panels.length;
    for (const t of own) faceOf[t] = pi;
    panels.push({ n: g.n, tu, u0, u1, v0, v1, area: g.area / T });
  }
  return { panels, faceOf, span, lo, hi };
}

/**
 * 把**跨面板共用**的頂點拆開(見檔頭 ⚠)。沒有衝突就原樣回傳(`split: 0`,零複製)。
 * @returns {{pos, nor, idx, uv, faceOf, split:number}}
 */
export function splitByPanel(attrs, idx, faceOf) {
  const { pos, nor, uv } = attrs;
  const owner = new Int32Array(pos.length / 3).fill(-2);
  const dup = new Map();                       // `${vi}|${panel}` → 新索引
  let extra = 0;
  for (let t = 0; t < faceOf.length; t++) {
    const p = faceOf[t];
    for (let j = 0; j < 3; j++) {
      const vi = idx[t * 3 + j];
      if (owner[vi] === -2) { owner[vi] = p; continue; }
      if (owner[vi] === p) continue;
      const k = `${vi}|${p}`;
      if (!dup.has(k)) { dup.set(k, pos.length / 3 + extra); extra++; }
    }
  }
  if (!extra) return { pos, nor, uv, idx, faceOf, split: 0 };
  const n0 = pos.length / 3;
  const p2 = new Float32Array((n0 + extra) * 3);
  p2.set(pos);
  const n2 = nor ? new Float32Array((n0 + extra) * 3) : null;
  if (n2) n2.set(nor);
  const u2 = new Float32Array((n0 + extra) * 2);
  u2.set(uv);
  const i2 = (idx instanceof Uint16Array && n0 + extra > 65535) ? new Uint32Array(idx.length) : new (idx.constructor)(idx.length);
  i2.set(idx);
  for (const [k, ni] of dup) {
    const vi = +k.split('|')[0];
    p2[ni * 3] = pos[vi * 3]; p2[ni * 3 + 1] = pos[vi * 3 + 1]; p2[ni * 3 + 2] = pos[vi * 3 + 2];
    if (n2) { n2[ni * 3] = nor[vi * 3]; n2[ni * 3 + 1] = nor[vi * 3 + 1]; n2[ni * 3 + 2] = nor[vi * 3 + 2]; }
    u2[ni * 2] = uv[vi * 2]; u2[ni * 2 + 1] = uv[vi * 2 + 1];
  }
  owner.fill(-2);
  for (let t = 0; t < faceOf.length; t++) {
    const p = faceOf[t];
    for (let j = 0; j < 3; j++) {
      const vi = idx[t * 3 + j];
      if (owner[vi] === -2) { owner[vi] = p; continue; }
      if (owner[vi] === p) continue;
      i2[t * 3 + j] = dup.get(`${vi}|${p}`);
    }
  }
  return { pos: p2, nor: n2, uv: u2, idx: i2, faceOf, split: extra };
}

/**
 * 逐三角形改寫 UV,讓窗格**貼齊面板**(見檔頭 ②③)。回傳新的 uv 陣列(不改輸入)。
 * ⚠ `pos`/`idx` MUST 是 `splitByPanel` 之後的那一份(跨面板共用頂點會讓其中一片被拉歪)。
 *
 * `cols` / `rows` = 那一張立面貼圖的窗格欄數 / 列數(材質桶的鍵);`roof` / `plain` = UV 三帶。
 * 節點的局部尺度以 `hx`(水平半跨)與 `hy`(縱向半跨)注入 —— 盒投影的慣例是
 * 「整顆節點的寬 ↔ u 的 0..1、整顆的高 ↔ 窗牆帶的全高」,格寬因此是 `2·hx / cols`。
 *
 * ⚠ u 可能超過 1(面板比節點的一個投影軸還寬,例如斜牆)⇒ 呼叫端的貼圖 MUST 是
 *   `wrapS = RepeatWrapping`;v **恆夾在窗牆帶內**(wrapT 維持 clamp,否則三帶會捲起來)。
 */
export function panelGridUV(pos, idx, uv, panels, faceOf, { cols, rows, roof, plain, hx = 0.5, hy = 0.5 }) {
  const out = Float32Array.from(uv);
  const bandLo = roof + plain, bandH = 1 - roof - plain;
  const cw = 2 * hx / cols, ch = 2 * hy / rows;      // 一格在**節點局部**單位下的寬與高
  const cl = (v) => Math.min(1, Math.max(0, v));
  const grid = panels.map((p) => {
    const k = Math.round((p.u1 - p.u0) / cw), m = Math.round((p.v1 - p.v0) / ch);
    // ③ 放不下一整格 ⇒ 這一片面板整片改吃素牆帶(逐面板的判定 ⇒ 不會切到三角形)
    if (k < 1 || m < 1) return null;
    // 面板底緣落在第幾列 —— 讓地面層的基座暗帶留在地面、女兒牆留在頂,而不是每一片
    // 面板都自己來一套(退縮段的面板會落在中間幾列上)
    const i0 = Math.min(Math.max(Math.round((p.v0 + hy) / ch), 0), Math.max(0, rows - m));
    return { k, m, i0 };
  });
  for (let t = 0; t < faceOf.length; t++) {
    const pi = faceOf[t];
    if (pi < 0) continue;
    const p = panels[pi], g = grid[pi];
    for (let j = 0; j < 3; j++) {
      const vi = idx[t * 3 + j], q = vi * 3;
      const y = pos[q + 1];
      if (!g) {                                       // 素牆帶:與烤進去的規則逐條相同
        out[vi * 2 + 1] = roof + cl((y + hy) / (2 * hy)) * plain;
        continue;
      }
      const u = pos[q] * p.tu[0] + pos[q + 2] * p.tu[2];
      const pu = (u - p.u0) / Math.max(p.u1 - p.u0, 1e-9);
      const pv = (y - p.v0) / Math.max(p.v1 - p.v0, 1e-9);
      out[vi * 2] = pu * g.k / cols;                  // 恆為整數格 ⇒ 兩側邊界都落在格線上
      out[vi * 2 + 1] = bandLo + ((g.i0 + pv * g.m) / rows) * bandH;
    }
  }
  return out;
}

/** 逐面板的整格窗數(稽核與診斷用;`null` = 放不下 ⇒ 那一片不畫窗) */
export function panelCells(panels, { cols, rows, hx = 0.5, hy = 0.5 }) {
  const cw = 2 * hx / cols, ch = 2 * hy / rows;
  return panels.map((p) => {
    const k = Math.round((p.u1 - p.u0) / cw), m = Math.round((p.v1 - p.v0) / ch);
    return k < 1 || m < 1 ? null : { k, m, cells: k * m };
  });
}
