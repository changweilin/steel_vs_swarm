// ============ Road bed leveling audit (gradeRoadBeds, 2026-07-31) ============
// Purpose: dry corridors of ordinary roads (not bridges, not structural tunnels, not footpaths)
// MUST be leveled laterally into cut-fill platforms --
// ribbons on steep cross-slopes cannot survive by draping plus height clamping (one side floats,
// the other side plus inter-cell bulges bury into the hillside),
// and units stand on raw terrain heightAt with no flat road to stand on.
// This audit drives four disciplines plus biomes caller rules directly from terrain.js executed source:
//   1 Cross-slope cut-fill: press the full depth band to centerline road height (cut uphill, fill downhill), outside stays
//   2 Fill cap: deep valleys (beyond fillMax x 1.5) are not filled -- no earth dams; over-limit bands feather out
//   3 Water discipline: nodes at or below water level plus SWAMP_BAND stay put (shorelines MUST NOT move)
//   4 Dig-footprint priority: nodes touched by carveTunnels MUST NOT be leveled back
//   5 Determinism: same input twice gives bit-identical results (zero rnd)
//   6 Caller (biomes): bridge, footpath, and structural tunnel runs are not leveled; runs before markGradeCorridors
// Usage: node tools/audit_road_bed.mjs; exit code 0 means all green
import { readSrc } from './audit_src.mjs';

const tsrc = readSrc('public', 'js', 'terrain.js');
const bsrc = readSrc('public', 'js', 'biomes.js');

let pass = 0, fail = 0;
const ok = (c, msg) => { c ? pass++ : (fail++, console.error(`  ✗ ${msg}`)); };

// ---- Executed source (from CUT_W up to before punchPortalHoles = carveTunnels + carveGalleryBands + gradeRoadBeds) ----
const c0 = tsrc.indexOf('  const CUT_W = 2.5;');
const cEnd = tsrc.indexOf('function punchPortalHoles');
const c1 = tsrc.lastIndexOf('/**', cEnd);
if (c0 < 0 || c1 <= c0) throw new Error('找不到 terrain 開挖/整平區塊');
const BLOCK = tsrc.slice(c0, c1);
const N = 33, MINX = -80, MAXX = 80, MINZ = -80, MAXZ = 80;   // 5m grid spacing
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

// 1 Cross-slope cut-fill: 45-degree cross-slope (z gains 1 per meter), centerline 30 means the full depth band MUST level to 30
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
// 2 Fill cap: roadside deep valley (deeper than fillMax x 1.5) MUST NOT be filled -- no dam at the canyon edge
{
  const t = mkTerr((x, z) => (z < -4 ? 30 - 25 : 30));   // Valley depth 25 exceeds the cap
  t.gradeRoadBeds([{ pts: runPts, hw: 5 }]);
  ok(Math.abs(t.at(0, -10) - 5) < 1e-6, 'Ⅱ 深谷節點 MUST 不填(寧可維持現狀,不築水壩/土壩)');
  const t2 = mkTerr((x, z) => (z < -4 ? 30 - 8 : 30));   // Valley depth 8 is under fillMax
  t2.gradeRoadBeds([{ pts: runPts, hw: 5 }]);
  ok(Math.abs(t2.at(0, -5) - 30) < 1e-6, 'Ⅱ 上限內的下坡側 MUST 填成路堤(帶內填到路面高)');
}
// 3 Water discipline: original height at or below water level plus SWAMP_BAND MUST stay put.
//   Fixture fill gap MUST stay below fillMax (otherwise the fill cap hides it and removing water discipline still stays green, testing nothing)
{
  const t = mkTerr((x, z) => (z < -4 ? WATER.LEVEL + 0.5 : WATER.LEVEL + 8));
  t.gradeRoadBeds([{ pts: runPts, hw: 5 }]);
  ok(Math.abs(t.at(0, -10) - (WATER.LEVEL + 0.5)) < 1e-6, 'Ⅲ 水域/沼澤節點 MUST 不動(岸線不得位移;跨水段本來就走橋)');
}
// 4 Dig-footprint priority: nodes touched by carveTunnels MUST NOT be leveled back
{
  const t = mkTerr(() => 30);
  t.carveTunnels([{ pts: [[-30, 0], [30, 0]], floors: [20, 20], hw: 8, covA: false, covB: false }], { clear: 8, hw: 9 });
  const dug = t.at(0, 0);
  ok(Math.abs(dug - 20) < 1e-6, 'Ⅳ 前置:開挖 MUST 已把走廊壓到隧道路面');
  t.gradeRoadBeds([{ pts: runPts, hw: 5 }]);   // Bed target 30 (above the low point of the bore)
  ok(Math.abs(t.at(0, 0) - dug) < 1e-6, 'Ⅳ 開挖足跡 MUST 優先(整平不得把洞口路塹重新填起來)');
}
// 5 Determinism: same input twice MUST give bit-identical results
{
  const hf = (x, z) => 30 + Math.sin(x * 0.11) * 6 + z * 0.7;
  const a = mkTerr(hf), b = mkTerr(hf);
  a.gradeRoadBeds([{ pts: runPts, hw: 5 }]);
  b.gradeRoadBeds([{ pts: runPts, hw: 5 }]);
  ok(a.heights.every((v, k) => v === b.heights[k]), 'Ⅴ 兩次執行 MUST 逐位元一致(零 rnd、floors 修改前整批取樣)');
}
// 6 Caller static rules (biomes.js)
{
  const g0 = bsrc.indexOf('if (terrain.gradeRoadBeds && roadInput?.length) {');
  ok(g0 > 0, 'Ⅵ 呼叫端 MUST 存在(roadInput 定案後整批收集)');
  const G = bsrc.slice(g0 - 800, g0 + 1600);
  ok(/way\.tags\?\.bridge\) continue/.test(G), 'Ⅵ 橋 MUST 不整地(橋面自己是平的)');
  ok(/isPedestrianWay\(way\.tags \|\| \{\}\)/.test(G), 'Ⅵ 步道 MUST 不整地(小徑不值得 8m 網格整地)');
  ok(/way\._tun\?\.\[ri\]\?\.intervals\.length\) continue/.test(G), 'Ⅵ 結構隧道/地下道 run MUST 不整地(carveTunnels 已處理)');
  ok(/piece\.wet === true/.test(G), 'Ⅵ 泡水段 MUST 不整地(那裡走橋)');
  ok(g0 < bsrc.indexOf('markGradeCorridors(roadInput'), 'Ⅵ 整平 MUST 排在 markGradeCorridors / 地物散布之前(高度先定案)');
  ok((bsrc.match(/terrain\.gradeRoadBeds\(/g) || []).length === 1, 'Ⅵ gradeRoadBeds MUST 只有一個呼叫端');
}

console.log(`\n道路路基整平稽核:${pass} 綠 / ${fail} 紅`);
process.exit(fail ? 1 : 0);
