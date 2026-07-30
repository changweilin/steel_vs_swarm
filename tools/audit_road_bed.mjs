// ============ 道路路基整平稽核(gradeRoadBeds,2026-07-31)============
// 用途:一般道路(非橋/非結構隧道/非步道)的乾地走廊 MUST 橫向整成切填平台 ——
// 陡橫坡路段的路面緞帶「各自貼地 + 夾高」扛不住(一邊懸空、一邊連同格間鼓包埋進山壁),
// 單位站的又是裸地形 heightAt,沒有平的路可以踩。
// 本稽核以 terrain.js **執行原文**建合成高度場直測四條紀律 + biomes 呼叫端靜態規則:
//   Ⅰ 橫坡切填:全深帶內壓到中心線路面高(上坡切、下坡填),帶外不動
//   Ⅱ 填方上限:深谷(超過 fillMax×1.5)不填 —— 不築土壩;超限帶平滑漸退
//   Ⅲ 水域紀律:原高 ≤ 水面 + SWAMP_BAND 的節點不動(岸線不得位移)
//   Ⅳ 開挖足跡優先:carveTunnels 動過的節點 MUST NOT 被整平蓋回去
//   Ⅴ 確定性:同輸入兩次執行逐位元同結果(零 rnd)
//   Ⅵ 呼叫端(biomes):橋/步道/結構隧道 run 不整;排在 markGradeCorridors 之前
// 跑法:node tools/audit_road_bed.mjs;退出碼 0 = 全綠
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const tsrc = readFileSync(join(ROOT, 'public', 'js', 'terrain.js'), 'utf8');
const bsrc = readFileSync(join(ROOT, 'public', 'js', 'biomes.js'), 'utf8');

let pass = 0, fail = 0;
const ok = (c, msg) => { c ? pass++ : (fail++, console.error(`  ✗ ${msg}`)); };

// ---- 執行原文(CUT_W 起、punchPortalHoles 前 = carveTunnels + carveGalleryBands + gradeRoadBeds)----
const c0 = tsrc.indexOf('  const CUT_W = 2.5;');
const cEnd = tsrc.indexOf('function punchPortalHoles');
const c1 = tsrc.lastIndexOf('/**', cEnd);
if (c0 < 0 || c1 <= c0) throw new Error('找不到 terrain 開挖/整平區塊');
const BLOCK = tsrc.slice(c0, c1);
const N = 33, MINX = -80, MAXX = 80, MINZ = -80, MAXZ = 80;   // 格距 5m
const WATER = { LEVEL: 0, SWAMP_BAND: 1.2 };
function mkTerr(hf) {
  const heights = new Float32Array(N * N);
  for (let i = 0; i < N; i++) for (let j = 0; j < N; j++) {
    heights[i * N + j] = hf(MINX + (MAXX - MINX) * j / (N - 1), MINZ + (MAXZ - MINZ) * i / (N - 1));
  }
  const geo = { getAttribute: () => ({ array: new Float32Array(N * N * 3) }), computeVertexNormals() {} };
  const heightAt = (x, z) => heights[Math.round((z - MINZ) / 5) * N + Math.round((x - MINX) / 5)];
  const fns = new Function('N', 'minX', 'maxX', 'minZ', 'maxZ', 'heights', 'geo', 'imagery', 'mat', 'WATER', 'heightAt',
    `${BLOCK}\nreturn { carveTunnels, carveGalleryBands, gradeRoadBeds };`)(
    N, MINX, MAXX, MINZ, MAXZ, heights, geo, null, null, WATER, heightAt);
  return { heights, at: heightAt, ...fns };
}
const runPts = []; for (let x = -60; x <= 60; x += 6) runPts.push([x, 0]);

// Ⅰ 橫坡切填:45° 橫坡(z 每公尺 +1),中心線 30 ⇒ 全深帶(hw + 半格)內 MUST 壓平到 30
{
  const t = mkTerr((x, z) => 30 + z);
  t.gradeRoadBeds([{ pts: runPts, hw: 5 }]);
  ok(Math.abs(t.at(0, 5) - 30) < 1e-6 && Math.abs(t.at(0, -5) - 30) < 1e-6,
    'Ⅰ 路面帶 ±5m MUST 壓到中心線高(上坡切、下坡填 —— 這就是「平的道路可以踩」)');
  ok(Math.abs(t.at(0, 25) - 55) < 1e-6 && Math.abs(t.at(0, -25) - 5) < 1e-6,
    'Ⅰ 走廊外 MUST 不動(taper 帶外的山坡原樣)');
  const mid = t.at(0, 10);
  ok(mid > 30 && mid < 40, 'Ⅰ taper 帶 MUST 介於路面高與原地表之間(smoothstep 斜壁,不留直角)');
}
// Ⅱ 填方上限:路旁深谷(深 fillMax×1.5 以上)MUST 不填 —— 峽谷邊不築土壩
{
  const t = mkTerr((x, z) => (z < -4 ? 30 - 25 : 30));   // 谷深 25 > 12×1.5
  t.gradeRoadBeds([{ pts: runPts, hw: 5 }]);
  ok(Math.abs(t.at(0, -10) - 5) < 1e-6, 'Ⅱ 深谷節點 MUST 不填(寧可維持現狀,不築水壩/土壩)');
  const t2 = mkTerr((x, z) => (z < -4 ? 30 - 8 : 30));   // 谷深 8 < fillMax
  t2.gradeRoadBeds([{ pts: runPts, hw: 5 }]);
  ok(Math.abs(t2.at(0, -5) - 30) < 1e-6, 'Ⅱ 上限內的下坡側 MUST 填成路堤(帶內填到路面高)');
}
// Ⅲ 水域紀律:原高 ≤ 水面 + SWAMP_BAND MUST 不動。
//   測資填差 MUST < fillMax(否則被填方上限擋掉,水域紀律拔了也測不紅 = 驗了等於沒驗)
{
  const t = mkTerr((x, z) => (z < -4 ? WATER.LEVEL + 0.5 : WATER.LEVEL + 8));
  t.gradeRoadBeds([{ pts: runPts, hw: 5 }]);
  ok(Math.abs(t.at(0, -10) - (WATER.LEVEL + 0.5)) < 1e-6, 'Ⅲ 水域/沼澤節點 MUST 不動(岸線不得位移;跨水段本來就走橋)');
}
// Ⅳ 開挖足跡優先:carveTunnels 動過的節點 MUST NOT 被整平蓋回去
{
  const t = mkTerr(() => 30);
  t.carveTunnels([{ pts: [[-30, 0], [30, 0]], floors: [20, 20], hw: 8, covA: false, covB: false }], { clear: 8, hw: 9 });
  const dug = t.at(0, 0);
  ok(Math.abs(dug - 20) < 1e-6, 'Ⅳ 前置:開挖 MUST 已把走廊壓到隧道路面');
  t.gradeRoadBeds([{ pts: runPts, hw: 5 }]);   // 路基目標 30(比洞低點高)
  ok(Math.abs(t.at(0, 0) - dug) < 1e-6, 'Ⅳ 開挖足跡 MUST 優先(整平不得把洞口路塹重新填起來)');
}
// Ⅴ 確定性:同輸入兩次 MUST 逐位元同結果
{
  const hf = (x, z) => 30 + Math.sin(x * 0.11) * 6 + z * 0.7;
  const a = mkTerr(hf), b = mkTerr(hf);
  a.gradeRoadBeds([{ pts: runPts, hw: 5 }]);
  b.gradeRoadBeds([{ pts: runPts, hw: 5 }]);
  ok(a.heights.every((v, k) => v === b.heights[k]), 'Ⅴ 兩次執行 MUST 逐位元一致(零 rnd、floors 修改前整批取樣)');
}
// Ⅵ 呼叫端靜態規則(biomes.js)
{
  const g0 = bsrc.indexOf('if (terrain.gradeRoadBeds && roadInput?.length) {');
  ok(g0 > 0, 'Ⅵ 呼叫端 MUST 存在(roadInput 定案後整批收集)');
  const G = bsrc.slice(g0 - 800, g0 + 1600);
  ok(/way\.tags\?\.bridge\) continue/.test(G), 'Ⅵ 橋 MUST 不整地(橋面自己是平的)');
  ok(/PED_HW\.test\(way\.tags\?\.highway/.test(G), 'Ⅵ 步道 MUST 不整地(1.5m 小徑不值得 8m 網格整地)');
  ok(/way\._tun\?\.\[ri\]\?\.intervals\.length\) continue/.test(G), 'Ⅵ 結構隧道/地下道 run MUST 不整地(carveTunnels 已處理)');
  ok(/piece\.wet === true/.test(G), 'Ⅵ 泡水段 MUST 不整地(那裡走橋)');
  ok(g0 < bsrc.indexOf('markGradeCorridors(roadInput'), 'Ⅵ 整平 MUST 排在 markGradeCorridors / 地物散布之前(高度先定案)');
  ok((bsrc.match(/terrain\.gradeRoadBeds\(/g) || []).length === 1, 'Ⅵ gradeRoadBeds MUST 只有一個呼叫端');
}

console.log(`\n道路路基整平稽核:${pass} 綠 / ${fail} 紅`);
process.exit(fail ? 1 : 0);
