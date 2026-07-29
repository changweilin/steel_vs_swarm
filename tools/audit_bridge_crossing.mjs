// ============ 橋交會去重稽核(離線直測,執行 biomes.js 原文)============
// 使用者需求(2026-07-28):「十字路口都有橋交會時只留一座橋,優先度:兵線>大馬路>小馬路。」
//   2026-07-29 定案含**鐵路高架**:優先度 兵線>鐵路>大馬路>小馬路;鐵路×道路保留鐵路。
// 判定 = 幾何相交/交會;低優先者**整條剔除**。此稽核抽 biomes.js 的
//   dedupeCrossingBridges + polylinesMeet + roadWidth **原文**執行,回傳 { roads, rails }。
// 交會容差不對稱:兩方皆道路 → CROSS_GAP(含端點/T 字貼近);任一方鐵路 → gap=0(只認真正交叉,
//   鐵路未 merge 鏈,端點貼近的同線段不得誤剔)。
// 跑法:node tools/audit_bridge_crossing.mjs   退出碼:0 = 全綠;1 = 紅字
// **改完 MUST 反向驗證**:把 polylinesMeet 的「真正交叉」return 寫回 false ⇒「交叉必剔除」段 MUST 紅字(內建對照組)。
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const src = readFileSync(join(ROOT, 'public', 'js', 'biomes.js'), 'utf8');

function loadCore(mutate = (s) => s) {
  const roadW = src.slice(src.indexOf('const ROAD_W = {'), src.indexOf('};', src.indexOf('const ROAD_W = {')) + 2);
  const rwStart = src.indexOf('function roadWidth(tags) {');
  const roadWidthSrc = src.slice(rwStart, src.indexOf('\n}', rwStart) + 2);
  const crossSrc = src.slice(src.indexOf('function polylinesMeet('), src.indexOf('/** 世界公尺 → 經緯度'));
  if (crossSrc.length < 100) throw new Error('切片標記找不到(改過就要同步改稽核)');
  const body = mutate(roadW + '\n' + roadWidthSrc + '\n' + crossSrc).replace(/^export /gm, '');
  return new Function('densify', 'llToWorld', 'ROAD_SEG',
    `${body}\nreturn { dedupeCrossingBridges, polylinesMeet, roadWidth };`,
  )((pts) => pts, (lat, lon) => [lat, lon], 6);   // llToWorld 替身:geometry {lat:x, lon:z} 直當世界座標
}

let pass = 0, fail = 0;
const ok = (c, msg) => { c ? pass++ : (fail++, console.error(`  ✗ ${msg}`)); };

// way 建構:coords = [x,z] 世界點;geometry 存 {lat:x, lon:z}(loadCore 的 llToWorld 替身直取)
const way = (cls, coords) => ({ tags: { highway: cls, bridge: 'yes' }, geometry: coords.map(([x, z]) => ({ lat: x, lon: z })) });
const rail = (coords, mono = false) => ({ tags: mono ? { railway: 'monorail' } : { railway: 'rail', bridge: 'yes' }, geometry: coords.map(([x, z]) => ({ lat: x, lon: z })) });
const line = (x0, z0, x1, z1, n = 12) => Array.from({ length: n + 1 }, (_, i) => [x0 + (x1 - x0) * i / n, z0 + (z1 - z0) * i / n]);

const { dedupeCrossingBridges, roadWidth } = loadCore();
ok(roadWidth({ highway: 'primary' }) > roadWidth({ highway: 'residential' }), 'roadWidth:大馬路 > 小馬路');

console.log('Ⅰ 道路交叉必剔除低優先');
{
  const major = way('primary', line(0, -50, 0, 50));
  const minor = way('residential', line(-50, 0, 50, 0));
  const out = dedupeCrossingBridges([major, minor], null, []);
  ok(out.roads.length === 1 && out.roads[0] === major, '大×小 交叉 → 只留大馬路');
  const out2 = dedupeCrossingBridges([minor, major], null, []);
  ok(out2.roads.length === 1 && out2.roads[0] === major, '換順序仍只留大馬路(依 rank 非序)');
}

console.log('Ⅱ 平行不交會 → 都保留');
{
  const a = way('primary', line(0, -50, 0, 50));
  const b = way('primary', line(30, -50, 30, 50));
  ok(dedupeCrossingBridges([a, b], null, []).roads.length === 2, '平行雙橋(不交會)兩條都留');
}

console.log('Ⅲ 兵線補橋恆勝');
{
  const lane = line(-50, 0, 50, 0);
  const major = way('primary', line(0, -50, 0, 50));
  ok(dedupeCrossingBridges([major], null, [lane]).roads.length === 0, '大馬路橋與兵線交會 → 剔除(兵線恆勝)');
  const par = way('primary', line(0, -50, 0, 50));
  ok(dedupeCrossingBridges([par], null, [line(40, -50, 40, 50)]).roads.length === 1, '兵線與橋平行不交會 → 橋保留');
}

console.log('Ⅳ 等寬交會 → 長者保留');
{
  const longB = way('primary', line(0, -80, 0, 80, 20));
  const shortB = way('primary', line(-20, 0, 20, 0, 6));
  const out = dedupeCrossingBridges([shortB, longB], null, []);
  ok(out.roads.length === 1 && out.roads[0] === longB, '等寬交叉 → 留長者');
}

console.log('Ⅴ 鐵路納入去重(2026-07-29)');
{
  // 鐵路×道路交叉 → 保留鐵路、剔除道路(高架優先)
  const road = way('primary', line(-50, 0, 50, 0));
  const rl = rail(line(0, -50, 0, 50));
  const out = dedupeCrossingBridges([road], null, [], [rl]);
  ok(out.roads.length === 0, '鐵路×大馬路交叉 → 大馬路剔除');
  ok(out.rails.length === 1 && out.rails[0] === rl, '鐵路×大馬路交叉 → 鐵路保留(高架優先)');
  // monorail 也算高架
  const out2 = dedupeCrossingBridges([way('primary', line(-50, 0, 50, 0))], null, [], [rail(line(0, -50, 0, 50), true)]);
  ok(out2.roads.length === 0 && out2.rails.length === 1, 'monorail×大馬路 → 保留 monorail');
  // 鐵路×鐵路交叉 → 長者保留
  const longR = rail(line(0, -80, 0, 80, 20)), shortR = rail(line(-20, 0, 20, 0, 6));
  const out3 = dedupeCrossingBridges([], null, [], [shortR, longR]);
  ok(out3.rails.length === 1 && out3.rails[0] === longR, '鐵路×鐵路交叉 → 留長者');
  // 兵線 > 鐵路:鐵路與兵線泡水段交會 → 鐵路剔除
  const out4 = dedupeCrossingBridges([], null, [line(-50, 0, 50, 0)], [rail(line(0, -50, 0, 50))]);
  ok(out4.rails.length === 0, '鐵路與兵線交會 → 鐵路剔除(兵線恆最高)');
}

console.log('Ⅵ 交會容差不對稱:鐵路只認真正交叉(不砍同線段/貼近)');
{
  // 兩段鐵路共用端點(相鄰同線段,不真正交叉)→ 兩條都留(gap=0 不誤剔)
  const r1 = rail(line(0, 0, 0, 40)), r2 = rail(line(0, 40, 40, 40));   // 在 (0,40) 相接、L 形不交叉
  ok(dedupeCrossingBridges([], null, [], [r1, r2]).rails.length === 2, '鐵路相鄰同線段(共端點)→ 都留(gap=0 不砍鐵路)');
  // 對照:兩段道路端點貼近 1.5m(< CROSS_GAP)→ 低優先剔除(道路走 CROSS_GAP,端點貼近算交會)
  const ra = way('primary', line(0, 0, 0, 40)), rb = way('residential', [[1.5, 40], [40, 40]]);
  ok(dedupeCrossingBridges([ra, rb], null, []).roads.length === 1, '道路端點貼近 1.5m → 小馬路剔除(CROSS_GAP)');
}

console.log('Ⅶ 反向驗證:polylinesMeet 恆回 false ⇒ 交會不被偵測');
{
  const bad = loadCore((s) => s.replace('function polylinesMeet(A, B, gap) {', 'function polylinesMeet(A, B, gap) {\n  return false;'));
  const major = way('primary', line(0, -50, 0, 50));
  const minor = way('residential', line(-50, 0, 50, 0));
  ok(bad.dedupeCrossingBridges([major, minor], null, []).roads.length === 2, '對照組:道路交會失效 ⇒ 兩條都留');
  const out = bad.dedupeCrossingBridges([way('primary', line(-50, 0, 50, 0))], null, [], [rail(line(0, -50, 0, 50))]);
  ok(out.roads.length === 1 && out.rails.length === 1, '對照組:鐵路×道路交會失效 ⇒ 都留(稽核有牙齒)');
}

console.log(`\n${fail === 0 ? '✅ 全綠' : '❌ 有紅字'}  pass=${pass} fail=${fail}`);
process.exit(fail === 0 ? 0 : 1);
