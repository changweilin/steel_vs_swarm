// ============ 線工切面(planar subdivision by raster flood fill)—— 規則本體 ============
// 用途:`docs/anime_style_plan.md` §0-a 第一段。現制 `ground.js cellZoneAt(i, j)` 是
// **逐格獨立**判定,界線由「哪一格投票翻面」決定 ⇒ 它落在田中間,才需要界線拼圖去藏。
// 新制先由 OSM 線工把整張圖切成**面**,再對整個面下一次判定(判定順序一行不改,
// 只換它吃什麼)。本檔只做「切面」那一半:光柵化 → 泛洪 → 小面併鄰 → 逐面取樣集。
//
// **零 import / 零亂數 / 純函式**(同 `roadgrid.js` / `wallpanel.js` / `edgewall.js` /
// `osmrelay.js` 的家族紀律)。線與取樣一律由呼叫端以**參數**注入(座標、半寬、keep-out 遮罩
// 全部在 texel 空間交進來)⇒ 本檔認不得 OSM、認不得地形、認不得 three。
// 序 14 起由遊戲端與離線工具共用本檔；零 import / 零亂數讓兩端執行同一份規則。
// 讓遊戲端與離線工具同吃一份定義,不會長出第二份實作 —— 零 import 是那一步只是一次改名的前提。
//
// 四條會靜默壞掉的線(每一條都有對應的反向驗證,見 `tools/audit_zone_cut.mjs`):
//   ① **泛洪 MUST 是 4 鄰**。8 鄰會讓兩個只在**對角相碰**的面漏成同一個面(牆的對角線是
//      「漏水」的),而報告上只表現成「面數少了幾個」。牆 texel 的**併回**反過來用 8 鄰 ——
//      那是「這一格離哪個面最近」,與「這兩格是不是同一個面」是兩個不同的問題。
//   ② **面 id 是掃描順序的函式,MUST NOT 是輸入順序的函式**。只要下游任何一處拿 id 當種子
//      (選款、變體、雜湊),兩台客戶端只要 ways 陣列順序差一格就建出不同的世界,而單機
//      跑一百次都是對的。故播種一律走 row-major 掃描(`floodFaces` 自己走格網,**不吃 segs**),
//      而 `canonicalFaces()` 給的是**與編號無關**的正規化指紋,順序無關那條斷言就量它。
//   ③ **小面併鄰 MUST 比「那個鄰居」的面積,MUST NOT 比佔全體的比例**(A46 ⑨ ㋐ 的同一條)。
//      曲面體側面每一片都一樣大 ⇒ 比值恆 1 ⇒ 結構上併不掉;比佔全體的話一根 36 面圓柱
//      每片只佔 2.8%,整根會被抹平而每一條既有斷言照樣全綠。
//   ④ **逐面取樣 MUST 是決定性的分層取樣**,MUST NOT 用 `Math.random()`,也 MUST NOT 拿
//      face id 當種子(id 是掃描順序的函式 ⇒ 拿它當種子等於把 ② 那條規則從後門放回來)。
//
// 座標約定:整份介面都在 **texel 空間**(x 向右 0..nx-1、z 向下 0..nz-1,索引 `j * nx + i`)。
// 世界公尺 ↔ texel 的換算住呼叫端(它才知道 `battleRect` 與含裙跨距)。

/** 牆遮罩的哨兵:還沒指派到任何面 */
export const NO_FACE = -1;

/**
 * 把線段光柵化成「牆」。
 * @param nx,nz    格網尺寸(texel)
 * @param segs     [[x0, z0, x1, z1, hw], …](texel 座標;hw = 半寬,texel)
 * @param opts.keepOut  選用 `Uint8Array(nx*nz)`,1 = 這一格**不得**寫牆(結構足跡)
 * @returns { wall: Uint8Array, drawn, blocked, cutSegs }
 *          `blocked` = 被 keep-out 擋下的 texel 數;`cutSegs` = 有 texel 被擋下的線段數
 *
 * 半寬一律**逐段**給(呼叫端依 `roadRank` 分級);hw < 0.5 的段仍會畫出一條連續的線
 * (取「到線段的距離 ≤ max(hw, 0.5)」)—— 半寬小於半個 texel 的線在格網上本來就只能是
 * 一格寬,寫成 0 會讓那條線**整條消失**而面數看起來完全正常。
 */
export function rasterLines(nx, nz, segs, opts = {}) {
  const wall = new Uint8Array(nx * nz);
  const keepOut = opts.keepOut || null;
  let drawn = 0, blocked = 0, cutSegs = 0;
  for (let s = 0; s < segs.length; s++) {
    const [x0, z0, x1, z1] = segs[s];
    const hw = Math.max(segs[s][4] ?? 0.5, 0.5);
    const i0 = Math.max(0, Math.floor(Math.min(x0, x1) - hw - 1));
    const i1 = Math.min(nx - 1, Math.ceil(Math.max(x0, x1) + hw + 1));
    const j0 = Math.max(0, Math.floor(Math.min(z0, z1) - hw - 1));
    const j1 = Math.min(nz - 1, Math.ceil(Math.max(z0, z1) + hw + 1));
    if (i1 < i0 || j1 < j0) continue;
    const ex = x1 - x0, ez = z1 - z0, L2 = ex * ex + ez * ez;
    const hw2 = hw * hw;
    let cut = false;
    for (let j = j0; j <= j1; j++) {
      for (let i = i0; i <= i1; i++) {
        const px = i + 0.5, pz = j + 0.5;
        let t = L2 ? ((px - x0) * ex + (pz - z0) * ez) / L2 : 0;
        t = t < 0 ? 0 : t > 1 ? 1 : t;
        const dx = px - (x0 + t * ex), dz = pz - (z0 + t * ez);
        if (dx * dx + dz * dz > hw2) continue;
        const k = j * nx + i;
        if (keepOut && keepOut[k]) { blocked++; cut = true; continue; }
        if (!wall[k]) { wall[k] = 1; drawn++; }
      }
    }
    if (cut) cutSegs++;
  }
  return { wall, drawn, blocked, cutSegs };
}

/**
 * 對牆的補集做泛洪,每個連通區得到一個 face id。
 * **4 鄰**(見檔頭 ①)。播種走 row-major 掃描 ⇒ face id 恆為「第 k 個被掃到的面」,
 * 與 `segs` 的順序、每條 way 的頂點序**無關**。
 * @returns { face: Int32Array(nx*nz)(牆為 NO_FACE), n, area: Int32Array(n) }
 */
export function floodFaces(wall, nx, nz) {
  const face = new Int32Array(nx * nz).fill(NO_FACE);
  const area = [];
  const stack = new Int32Array(nx * nz);
  let n = 0;
  for (let k0 = 0; k0 < face.length; k0++) {
    if (wall[k0] || face[k0] !== NO_FACE) continue;
    const id = n++;
    let top = 0, cnt = 0;
    stack[top++] = k0; face[k0] = id;
    while (top) {
      const k = stack[--top];
      cnt++;
      const i = k % nx, j = (k / nx) | 0;
      // 4 鄰,固定順序(右 / 左 / 下 / 上)—— 順序不影響結果(連通分量是集合),
      // 但固定下來讓「兩次跑逐位元相同」是構造保證而不是巧合。
      if (i + 1 < nx) { const t = k + 1; if (!wall[t] && face[t] === NO_FACE) { face[t] = id; stack[top++] = t; } }
      if (i > 0) { const t = k - 1; if (!wall[t] && face[t] === NO_FACE) { face[t] = id; stack[top++] = t; } }
      if (j + 1 < nz) { const t = k + nx; if (!wall[t] && face[t] === NO_FACE) { face[t] = id; stack[top++] = t; } }
      if (j > 0) { const t = k - nx; if (!wall[t] && face[t] === NO_FACE) { face[t] = id; stack[top++] = t; } }
    }
    area.push(cnt);
  }
  return { face, n, area: Int32Array.from(area) };
}

/**
 * 牆 texel 併回最近的面(道路本身另有幾何,不需要自己的分區)。
 * 多源 BFS,**8 鄰**(見檔頭 ①:這問的是「離哪個面近」不是「是不是同一個面」)。
 * 種子依 row-major 掃描入列 ⇒ 平手時的歸屬是決定性的。
 * 就地改寫 `face`,回傳被指派的 texel 數。
 */
export function assignWallTexels(face, wall, nx, nz) {
  const q = new Int32Array(face.length);
  let head = 0, tail = 0;
  for (let k = 0; k < face.length; k++) if (face[k] !== NO_FACE) q[tail++] = k;
  let filled = 0;
  const NB = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [-1, 1], [1, -1], [-1, -1]];
  while (head < tail) {
    const k = q[head++];
    const i = k % nx, j = (k / nx) | 0;
    for (let d = 0; d < 8; d++) {
      const ni = i + NB[d][0], nj = j + NB[d][1];
      if (ni < 0 || nj < 0 || ni >= nx || nj >= nz) continue;
      const t = nj * nx + ni;
      if (face[t] !== NO_FACE) continue;
      face[t] = face[k]; q[tail++] = t; filled++;
    }
  }
  return filled;
}

/** 逐面面積(texel 數)。牆(NO_FACE)不計。 */
export function faceAreas(face, n) {
  const area = new Int32Array(n);
  for (let k = 0; k < face.length; k++) { const f = face[k]; if (f !== NO_FACE) area[f]++; }
  return area;
}

/**
 * 共邊鄰接表(4 鄰;共用邊長 = 相鄰 texel 對數)。
 * **共邊才算相鄰**(A46 ⑨ ㋑):分群不看連通性對「是不是同一面牆」是對的,
 * 但「碎屑該併給誰」只能由拓樸回答。
 *
 * ⚠ **呼叫端 MUST 先跑 `assignWallTexels`**。牆 texel 是 `NO_FACE`,而兩個面之間**隔著牆**
 *   ⇒ 沒有任何一對 4 鄰 texel 屬於兩個不同的面 ⇒ 鄰接表**整份是空的**,`mergeSmall`
 *   一次都併不掉,而回報上只表現成「這張圖剛好沒有碎面」(實測 taroko 1024²:
 *   238 面、面積下限 326 texel,併 0 次)。這是本檔最容易靜默壞掉的一條。
 * @returns Array(n) of Map<faceId, sharedEdgeLen>
 */
export function faceAdjacency(face, n, nx, nz) {
  const adj = Array.from({ length: n }, () => new Map());
  const bump = (a, b) => { adj[a].set(b, (adj[a].get(b) || 0) + 1); adj[b].set(a, (adj[b].get(a) || 0) + 1); };
  for (let j = 0; j < nz; j++) {
    for (let i = 0; i < nx; i++) {
      const k = j * nx + i, f = face[k];
      if (f === NO_FACE) continue;
      if (i + 1 < nx) { const g = face[k + 1]; if (g !== NO_FACE && g !== f) bump(f, g); }
      if (j + 1 < nz) { const g = face[k + nx]; if (g !== NO_FACE && g !== f) bump(f, g); }
    }
  }
  return adj;
}

/**
 * 小面併進**共邊**且面積最大的鄰面。三條 MUST(A46 ⑨,理由見檔頭 ③):
 *   ㋐「相對周邊面積過小」比的是**那個鄰居**的面積(`area < rel × 鄰居面積`),
 *      **MUST NOT** 比佔全體的比例 —— 那會把一根每片等面積的圓柱整根抹平;
 *   ㋑ **共邊**才算相鄰(拓樸,不是距離);
 *   ㋒ **小的貼上大的**(被併的那一塊不反過來把好面拉歪)。
 * `areaMin` 只是**候選閘**(先擋掉明顯夠大的面,省一趟掃描),決定權在 ㋐ 的相對式。
 * 迭代到不動為止;每一輪的處理序 = 面積小的先、同面積時 id 小的先(決定性)。
 *
 * @param opts.areaMin  候選面積門檻(texel);預設 0 = 全部都當候選
 * @param opts.rel      相對門檻(0<rel<1);`area < rel × 最大鄰居面積` 才併
 * @returns { face, n, remap: Int32Array(舊 id → 新 id), merged, area }
 */
export function mergeSmall(face, n, nx, nz, opts = {}) {
  const areaMin = opts.areaMin ?? 0;
  const rel = opts.rel ?? 0.5;
  const area = faceAreas(face, n);
  const parent = new Int32Array(n);
  for (let i = 0; i < n; i++) parent[i] = i;
  const find = (a) => { while (parent[a] !== a) { parent[a] = parent[parent[a]]; a = parent[a]; } return a; };
  const adj = faceAdjacency(face, n, nx, nz);
  const live = Int32Array.from(area);
  let merged = 0;
  for (let pass = 0; pass < 64; pass++) {
    const cand = [];
    for (let f = 0; f < n; f++) {
      if (find(f) !== f) continue;                       // 已經被併掉
      if (live[f] > areaMin) continue;                   // 候選閘
      cand.push(f);
    }
    cand.sort((a, b) => (live[a] - live[b]) || (a - b));  // 決定性:小的先、同大小 id 小的先
    let did = 0;
    for (const f of cand) {
      if (find(f) !== f) continue;
      // 共邊鄰居(經 union-find 正規化;自己不算)。鍵依 id 遞增走 ⇒ 平手時的結果決定性。
      const nb = new Map();
      for (const [g0, len] of adj[f]) {
        const g = find(g0);
        if (g === f) continue;
        nb.set(g, (nb.get(g) || 0) + len);
      }
      if (!nb.size) continue;                            // 四面無鄰(整張圖只有它)⇒ 不併
      let best = -1, bestA = -1, bestLen = -1;
      for (const g of [...nb.keys()].sort((a, b) => a - b)) {
        const len = nb.get(g);
        // 面積最大者優先;同面積時取共用邊最長者;再同則 id 小者(上面已排序 ⇒ 先到先得)
        if (live[g] > bestA || (live[g] === bestA && len > bestLen)) { best = g; bestA = live[g]; bestLen = len; }
      }
      // ㋐ 相對門檻:MUST 比**那個鄰居**的面積。
      // ⚠ 這一行就是曲面體的保護:圓柱 / 圓台 / 圓錐的側面每一片都一樣大 ⇒ 比值恆 1 ⇒
      //   結構上併不掉。換成「比佔全體的比例」(= 只看 areaMin)會把整根抹平,
      //   而面數以外的每一條斷言照樣全綠(`audit_zone_cut --break-merge` 就是那一版)。
      if (!(live[f] < rel * bestA)) continue;
      parent[f] = best;                                  // ㋒ 小的貼上大的
      live[best] += live[f];
      for (const [g, len] of adj[f]) if (find(g) !== best) adj[best].set(g, (adj[best].get(g) || 0) + len);
      merged++; did++;
    }
    if (!did) break;
  }
  // 重新編號:保留 row-major 的相對序(代表元 id 遞增),face id 仍不吃輸入順序
  const remap = new Int32Array(n).fill(NO_FACE);
  let m = 0;
  for (let f = 0; f < n; f++) if (find(f) === f) remap[f] = m++;
  for (let f = 0; f < n; f++) if (remap[f] === NO_FACE) remap[f] = remap[find(f)];
  const out = new Int32Array(face.length);
  for (let k = 0; k < face.length; k++) out[k] = face[k] === NO_FACE ? NO_FACE : remap[face[k]];
  return { face: out, n: m, remap, merged, area: faceAreas(out, m) };
}

/**
 * 逐面的取樣點集(決定性的分層取樣;**零亂數、不吃 face id**,見檔頭 ④)。
 * 手法:面的 texel 在 row-major 掃描下本來就是遞增序 ⇒ 取第 `floor((t+0.5) * len / k)` 個,
 * 等距抽 k 個。面積大的面抽滿 k 個、面積小的抽自己那麼多個(不重複)。
 * @returns Array(n) of Int32Array(texel 索引)
 */
export function faceSamples(face, n, k) {
  const area = faceAreas(face, n);
  const out = new Array(n);
  const cur = new Int32Array(n);
  for (let f = 0; f < n; f++) out[f] = new Int32Array(Math.min(k, area[f]));
  const seen = new Int32Array(n);
  for (let idx = 0; idx < face.length; idx++) {
    const f = face[idx];
    if (f === NO_FACE) continue;
    const want = out[f].length;
    const rank = seen[f]++;
    // 目標序位:第 t 個樣本落在面內第 floor((t + 0.5) * area / want) 個 texel
    while (cur[f] < want && rank === Math.floor((cur[f] + 0.5) * area[f] / want)) out[f][cur[f]++] = idx;
  }
  // 收尾防呆(浮點取整理論上不該落空,但落空是靜默的):沒抽滿的面改由 row-major 前綴補齊。
  const need = new Set();
  for (let f = 0; f < n; f++) if (cur[f] < out[f].length) { need.add(f); cur[f] = 0; }
  if (need.size) {
    for (let idx = 0; idx < face.length && need.size; idx++) {
      const f = face[idx];
      if (f === NO_FACE || !need.has(f)) continue;
      out[f][cur[f]++] = idx;
      if (cur[f] >= out[f].length) need.delete(f);
    }
  }
  return out;
}

/**
 * **與編號無關**的分割指紋:逐 texel 輸出「它那個面的最小 texel 索引」。
 * 兩次跑只要**分割**(等價類)相同,這個陣列就逐位元相同 —— 就算 face id 被重排也一樣。
 * 「順序無關」那條斷言量的就是它(把 ways 陣列反轉、每條 way 頂點序反轉,重跑比對)。
 * @returns Int32Array(nx*nz)(牆為 NO_FACE)
 */
export function canonicalFaces(face, n) {
  const rep = new Int32Array(n).fill(-1);
  for (let k = 0; k < face.length; k++) { const f = face[k]; if (f !== NO_FACE && rep[f] < 0) rep[f] = k; }
  const out = new Int32Array(face.length);
  for (let k = 0; k < face.length; k++) out[k] = face[k] === NO_FACE ? NO_FACE : rep[face[k]];
  return out;
}
