// ============ 地形解析射線稽核(rayTerrain)============
// 用途:`terrain.js` 的 `rayTerrain` 取代了「把 terrain.mesh 丟進 three raycaster」的做法
// (73,728 個三角形逐面線性掃描 ⇒ 每顆子彈每幀 ~1ms,手機 3~6 倍,正是開火掉幀的主因)。
// 取代品 MUST 是**等價**而非近似 —— 本稽核以「暴力掃完全部三角形」當基準,逐條比對:
//   ① 命中/未命中一致  ② 命中距離 t 誤差 < 1e-3 m  ③ 命中點 y 與 heightAt 一致(同一組三角形)
//   ④ 打洞(punchPortalHoles 刪掉的洞口三角形)後,穿洞射線 MUST 不再被擋
//   ⑤ 射點在圖外 / 射線平行軸 / far 太短 等邊界情形
// 另附成本量測(格行進 vs 逐面掃描)。
//
// 為什麼用「抽原文」而不是 import:`terrain.js` 的 three 走 CDN importmap,Node 端解析不了;
// 本稽核抽出的是 rayTerrain 那一整段**真正的程式碼文字**(另抄一份公式就永遠會通過)。
// 跑法:`node tools/audit_terrain_ray.mjs`
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
// LF 正規化:git 存 LF,但 autocrlf 下 Windows 工作區是 CRLF。下方跨行切片標記(B1 的 `\n   * …`、
// H1 的 `\n  }`)一律以 `\n` 書寫,不正規化就只在 Linux 綠、Windows 紅。
const src = readFileSync(join(ROOT, 'public', 'js', 'terrain.js'), 'utf8').replace(/\r\n/g, '\n');

// ---- 抽出 rayTerrain 區塊(含 triDead / markTriDead / triHit)----
const B0 = src.indexOf('  // ---- 地形射線(解析版');
const B1 = src.indexOf('  /**\n   * 地下道洞口開挖');
if (B0 < 0 || B1 < 0 || B1 <= B0) throw new Error('找不到 rayTerrain 區塊(terrain.js 結構已變?)');
const BLOCK = src.slice(B0, B1);
for (const need of ['function rayTerrain(', 'function markTriDead(', 'function triHit(']) {
  if (!BLOCK.includes(need)) throw new Error(`抽出的區塊缺少 ${need}`);
}
// heightAt 也一併抽(驗命中點高度同源)
const H0 = src.indexOf('  function heightAt(x, z) {');
const H1 = src.indexOf('\n  }', H0) + 4;
const HBLOCK = src.slice(H0, H1);

let pass = 0, fail = 0;
const ok = (c, msg) => { c ? pass++ : (fail++, console.error(`  ✗ ${msg}`)); };

// ---- 測試用地形(與真實網格同構:N=193 高度場)----
const N = 193;
const SPAN = 2400;
const minX = -SPAN / 2, maxX = SPAN / 2, minZ = -SPAN / 2, maxZ = SPAN / 2;
const heights = new Float32Array(N * N);
for (let i = 0; i < N; i++) {
  for (let j = 0; j < N; j++) {
    // 起伏 + 高頻細節:確保有山脊/鞍點(近似會在這裡露餡)
    heights[i * N + j] = 40 * Math.sin(i * 0.09) * Math.cos(j * 0.077)
      + 11 * Math.sin(i * 0.41 + j * 0.29) + 3 * Math.cos(j * 1.3);
  }
}

const mk = new Function('N', 'heights', 'minX', 'maxX', 'minZ', 'maxZ',
  `${HBLOCK}\n${BLOCK}\nreturn { rayTerrain, markTriDead, heightAt };`);
const T = mk(N, heights, minX, maxX, minZ, maxZ);

// ---- 基準:暴力掃完全部三角形(即 three Mesh.raycast 的語意)----
const DX = (maxX - minX) / (N - 1), DZ = (maxZ - minZ) / (N - 1);
const VX = (k) => minX + (k % N) * DX;
const VZ = (k) => minZ + (((k / N) | 0)) * DZ;
const dead = new Set();   // 'i,j,u' 被打洞刪除的三角形
function bruteTri(o, d, far, k0, k1, k2) {
  const ax = VX(k0), ay = heights[k0], az = VZ(k0);
  const e1 = [VX(k1) - ax, heights[k1] - ay, VZ(k1) - az];
  const e2 = [VX(k2) - ax, heights[k2] - ay, VZ(k2) - az];
  const p = [d[1] * e2[2] - d[2] * e2[1], d[2] * e2[0] - d[0] * e2[2], d[0] * e2[1] - d[1] * e2[0]];
  const det = e1[0] * p[0] + e1[1] * p[1] + e1[2] * p[2];
  if (Math.abs(det) < 1e-10) return -1;
  const inv = 1 / det;
  const tv = [o[0] - ax, o[1] - ay, o[2] - az];
  const u = (tv[0] * p[0] + tv[1] * p[1] + tv[2] * p[2]) * inv;
  if (u < 0 || u > 1) return -1;
  const q = [tv[1] * e1[2] - tv[2] * e1[1], tv[2] * e1[0] - tv[0] * e1[2], tv[0] * e1[1] - tv[1] * e1[0]];
  const v = (d[0] * q[0] + d[1] * q[1] + d[2] * q[2]) * inv;
  if (v < 0 || u + v > 1) return -1;
  const t = (e2[0] * q[0] + e2[1] * q[1] + e2[2] * q[2]) * inv;
  return (t > 1e-4 && t <= far) ? t : -1;
}
function brute(o, d, far) {
  let best = -1;
  for (let i = 0; i < N - 1; i++) {
    for (let j = 0; j < N - 1; j++) {
      const a = i * N + j, b = a + 1, c = a + N, e = c + 1;
      if (!dead.has(`${i},${j},0`)) { const t = bruteTri(o, d, far, a, c, b); if (t >= 0 && (best < 0 || t < best)) best = t; }
      if (!dead.has(`${i},${j},1`)) { const t = bruteTri(o, d, far, b, c, e); if (t >= 0 && (best < 0 || t < best)) best = t; }
    }
  }
  return best;
}

// ---- 亂數射線集(確定性種子)----
let seed = 20260727;
const rnd = () => (seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296;
function norm(v) { const l = Math.hypot(v[0], v[1], v[2]); return [v[0] / l, v[1] / l, v[2] / l]; }

console.log('== 地形解析射線稽核(rayTerrain vs 暴力逐面掃描)==');
console.log(`網格 ${N}×${N} = ${(N - 1) * (N - 1) * 2} 三角形\n`);

// ① / ② / ③ 一般射線:命中一致 + 距離一致 + 高度同源
{
  let miss = 0, worst = 0, worstY = 0;
  const CASES = 220;
  for (let n = 0; n < CASES; n++) {
    const o = [(rnd() - 0.5) * SPAN * 0.8, 30 + rnd() * 160, (rnd() - 0.5) * SPAN * 0.8];
    const a = rnd() * Math.PI * 2;
    const d = norm([Math.cos(a), -0.05 - rnd() * 1.2, Math.sin(a)]);
    const far = 60 + rnd() * 900;
    const bt = brute(o, d, far);
    const r = T.rayTerrain(o[0], o[1], o[2], d[0], d[1], d[2], far);
    if ((bt >= 0) !== !!r) { miss++; continue; }
    if (r) {
      worst = Math.max(worst, Math.abs(r.t - bt));
      worstY = Math.max(worstY, Math.abs(r.y - T.heightAt(r.x, r.z)));
    }
  }
  ok(miss === 0, `① 命中/未命中一致:${CASES} 條中 ${miss} 條分歧`);
  ok(worst < 1e-3, `② 命中距離最大誤差 ${worst.toExponential(2)} m(門檻 1e-3)`);
  ok(worstY < 1e-2, `③ 命中點 y 與 heightAt 最大差 ${worstY.toExponential(2)} m(門檻 1e-2)`);
  console.log(`  ① 命中一致 ${CASES - miss}/${CASES}  ② Δt ≤ ${worst.toExponential(2)}m  ③ Δy ≤ ${worstY.toExponential(2)}m`);
}

// ④ 打洞:被刪的三角形不再擋彈
{
  // 找一條會命中的射線,把命中格的兩個三角形都刪掉 → MUST 穿過去(或命中更遠處)
  const o = [-300, 90, -220];
  const d = norm([0.82, -0.34, 0.46]);
  const before = T.rayTerrain(o[0], o[1], o[2], d[0], d[1], d[2], 1200);
  ok(!!before, '④a 前置:基準射線本來會命中地形');
  const j = Math.max(0, Math.min(N - 2, Math.floor((before.x - minX) / DX)));
  const i = Math.max(0, Math.min(N - 2, Math.floor((before.z - minZ) / DZ)));
  const a = i * N + j, b = a + 1, c = a + N, e = c + 1;
  T.markTriDead(a, c, b); T.markTriDead(b, c, e);
  dead.add(`${i},${j},0`); dead.add(`${i},${j},1`);
  const after = T.rayTerrain(o[0], o[1], o[2], d[0], d[1], d[2], 1200);
  const bAfter = brute(o, d, 1200);
  ok(!after || after.t > before.t + 1e-6, '④b 打洞後不再停在原格(彈道能打進洞內)');
  ok((bAfter >= 0) === !!after && (!after || Math.abs(after.t - bAfter) < 1e-3),
    '④c 打洞後仍與暴力基準一致');
  console.log(`  ④ 打洞前 t=${before.t.toFixed(2)}m → 打洞後 ${after ? `t=${after.t.toFixed(2)}m` : '穿出'}(基準 ${bAfter >= 0 ? bAfter.toFixed(2) : '穿出'})`);
}

// ⑤ 邊界情形
{
  const d = norm([1, -0.3, 0]);
  ok(T.rayTerrain(minX - 5000, 400, 0, 1, 0, 0, 100) === null, '⑤a 圖外且 far 不足 → null');
  ok(T.rayTerrain(0, 5000, 0, 0, 1, 0, 9000) === null, '⑤b 正上方射向天空 → null');
  const down = T.rayTerrain(0, 4000, 0, 0, -1, 0, 9000);
  ok(down != null && Math.abs(down.y - T.heightAt(0, 0)) < 1e-2, '⑤c 正下方垂直射線命中地面且高度對得上');
  ok(T.rayTerrain(-SPAN, 200, 0, d[0], d[1], d[2], 40) === null, '⑤d far 太短(還沒進圖)→ null');
  const inbound = T.rayTerrain(minX - 200, 120, 0, 1, -0.06, 0, 3000);
  const bi = brute([minX - 200, 120, 0], [1, -0.06, 0].map((v, k, arr) => v / Math.hypot(...arr)), 3000);
  ok((bi >= 0) === !!inbound, '⑤e 射點在圖外、射線進圖 → 與基準一致');
}

// ---- 成本量測 ----
{
  const rays = [];
  for (let n = 0; n < 120; n++) {
    const a = n * 0.7919;
    rays.push([[0, 70, 0], norm([Math.cos(a), -0.14, Math.sin(a)]), 800]);
  }
  const t0 = process.hrtime.bigint();
  for (const [o, d, f] of rays) T.rayTerrain(o[0], o[1], o[2], d[0], d[1], d[2], f);
  const ms1 = Number(process.hrtime.bigint() - t0) / 1e6;
  const t1 = process.hrtime.bigint();
  for (const [o, d, f] of rays.slice(0, 30)) brute(o, d, f);
  const ms2 = Number(process.hrtime.bigint() - t1) / 1e6 * (rays.length / 30);
  // 註:此處的暴力基準是可讀性優先的參考實作(陣列配置多),比 three 的 Mesh.raycast 慢一截;
  // three 實測約 1.1 ms/條(桌機 x86 Node,73,728 三角形)。加速倍率以該數字看仍是兩位數以上。
  console.log(`\n  成本:解析行進 ${(ms1 / rays.length).toFixed(4)} ms/條 vs 暴力基準 ${(ms2 / rays.length).toFixed(4)} ms/條`
    + `(three Mesh.raycast 實測約 1.1 ms/條)`);
}

console.log(`\n${fail === 0 ? '✅' : '❌'} 通過 ${pass} 項,失敗 ${fail} 項`);
process.exit(fail === 0 ? 0 : 1);
