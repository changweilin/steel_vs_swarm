// ============ 地表屬性場(確定性散布橢圓場;唯一縫)============
// 用途:回答「這一點比周圍**多**還是**少**」這種低頻、無方向性的問題 ——
// 地表色階梯要走哪一階(terrain.js 的無影像路徑)、將來的風化/苔蘚/鏽蝕密度(P2-A)。
//
// **為什麼不是雜訊函式**:值雜訊(value noise)每一點都獨立,大面積看起來是均勻的沙,
// 沒有「這一片比較老、那一片比較新」的區塊感;而純用「離某某距離」推(離水多遠、
// 離爆點多遠、離地面多高)在**均勻區域內是常數** —— 那正是要修的毛病本身,不是解法。
// 散布橢圓場兩者都不是:少量大橢圓隨機灑在圖上,每個帶自己的權重,任一點取**加權平均**。
//
// 三條紀律(全部踩過,寫在這裡免得再踩):
//   ① MUST 是**加權平均** `s / max(W_MIN, w)`,MUST NOT 是加總 —— 橢圓一多,加總會飽和成
//      一個常數,比沒有場更糟(整片同一階,看起來就是「又忘了做」)。
//   ② 分母的下限 `W_MIN` 不可省:沒有任何橢圓覆蓋的空白處 w→0,除下去會爆成 ±∞ ⇒
//      畫面上是一塊塊雜訊斑。夾住之後空白處自然回到中性值 0.5。
//   ③ 散布 MUST NOT 用 `Math.random()`(§2.3 確定性):種子由呼叫端給(戰場中心),
//      每個橢圓固定消耗 6 枚亂數 ⇒ 跨客戶端逐位元同一張場。
import { mulberry32 } from './rng.js';

const W_MIN = 0.55;      // 加權平均分母下限(見紀律②)
const N_BLOB = 26;       // 橢圓枚數:少了看不出區塊、多了互相抵消成常數

/**
 * 建一張屬性場。
 * @param seed   整數種子(呼叫端一律用戰場中心推,與 biomes.js 的散布同源)
 * @param span   場地跨距(公尺);橢圓半徑由它推導,MUST NOT 手寫公尺數
 * @returns (x, z) => 0~1(0.5 = 中性;無橢圓覆蓋處恆為中性)
 */
export function makeField(seed, span) {
  const rnd = mulberry32(seed >>> 0);
  const R0 = span * 0.10, R1 = span * 0.34;    // 橢圓半徑帶:小於 1/10 跨距就碎成雜訊
  const blobs = [];
  for (let i = 0; i < N_BLOB; i++) {
    // 固定 6 枚:中心 x/z、兩軸半徑、旋轉、值。淘汰檢查 MUST 排在抽樣**之後**(§2.3),
    // 這裡沒有淘汰 ⇒ 序列天生一致。
    const cx = (rnd() - 0.5) * span * 1.2;
    const cz = (rnd() - 0.5) * span * 1.2;
    const ra = R0 + rnd() * (R1 - R0);
    const rb = R0 + rnd() * (R1 - R0);
    const th = rnd() * Math.PI;
    const val = rnd();
    blobs.push({ cx, cz, ia: 1 / ra, ib: 1 / rb, ca: Math.cos(th), sa: Math.sin(th), val });
  }
  return (x, z) => {
    let s = 0, w = 0;
    for (const b of blobs) {
      const dx = x - b.cx, dz = z - b.cz;
      const u = (dx * b.ca + dz * b.sa) * b.ia, v = (-dx * b.sa + dz * b.ca) * b.ib;
      const d2 = u * u + v * v;
      if (d2 >= 1) continue;
      const k = 1 - d2;                        // 橢圓內平滑落到邊界為 0(邊界不留硬圈)
      s += b.val * k; w += k;
    }
    return w > 0 ? s / Math.max(W_MIN, w) : 0.5;   // 紀律①②:加權平均 + 分母下限
  };
}

/**
 * 色階梯:把屬性場切成 n 階,回傳 `(x, z) => 0..n-1`。
 *
 * **門檻取該場地自己的分位數,MUST NOT 手寫固定門檻**(2026-08-03 實測):
 * 場的值是「少量橢圓的加權平均」⇒ 分布隨種子漂,固定門檻在 27 個場地 × 三種隊制上
 * 最壞會讓單一色階佔到 **51.3%**(iguazu L3)—— 那就退回「88% 的坡面同一個顏色」那個
 * 病灶本身。改吃分位數 ⇒ 每一階天生約 1/n,與種子無關。
 * 抖動則是另一件事:門檻逐點加一個**比場粗、比取樣細**的雜湊偏移,否則等值線會長成
 * 一圈一圈的等高線(見 `coarseHash`)。
 *
 * @param field  makeField 的輸出
 * @param b      取樣範圍 { minX, maxX, minZ, maxZ }(用地形網格的世界邊界)
 * @param n      階數
 * @param jitM   抖動格寬(公尺);抖幅固定為一階的 ±25%
 */
export function makeToneLadder(field, b, n, jitM) {
  const S = 96;                                   // 分位取樣網格(確定性:固定格數,與地形無關)
  const vals = new Float32Array(S * S);
  for (let i = 0; i < S; i++) {
    const z = b.minZ + (b.maxZ - b.minZ) * (i + 0.5) / S;
    for (let j = 0; j < S; j++) vals[i * S + j] = field(b.minX + (b.maxX - b.minX) * (j + 0.5) / S, z);
  }
  const sorted = Float32Array.from(vals).sort();
  const th = [];
  for (let k = 1; k < n; k++) th.push(sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * k / n))]);
  // 抖幅 = 一階寬度的 ±25%:再大就把階梯攪成雜訊,再小就看得出等值線
  const amp = ((sorted[sorted.length - 1] - sorted[0]) / n) * 0.5;
  return (x, z) => {
    const v = field(x, z), h = (coarseHash(x, z, jitM) - 0.5) * amp;
    let k = 0;
    while (k < th.length && v > th[k] + h) k++;
    return k;
  };
}

/**
 * 閾值抖動用的粗粒雜湊(0~1)。
 * **為什麼要抖**:色階梯若逐點拿同一個閾值比,等值線會在畫面上長成一圈一圈的**等高線**
 * (地圖等高線那種),一眼就看得出是程式畫的。用比場本身**更粗**的格子抖動閾值 ⇒
 * 交界變成鋸齒狀的碎塊,像手繪的色塊邊。格子 MUST 比橢圓小很多、又 MUST 比取樣點粗
 * (與取樣同粒度 = 逐點白雜訊 = 交界變成沙)。
 */
export function coarseHash(x, z, cellM) {
  const i = Math.floor(x / cellM), j = Math.floor(z / cellM);
  let h = Math.imul(i, 374761393) ^ Math.imul(j, 668265263);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}
