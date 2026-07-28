// ============ 橋交會去重稽核(離線直測,執行 biomes.js 原文)============
// 使用者需求(2026-07-28):「十字路口都有橋交會時只留一座橋,優先度:兵線>大馬路>小馬路。」
// 判定 = 幾何相交/交會(含立體交叉);低優先者**整條剔除**。此稽核抽 biomes.js 的
//   dedupeParallelBridges 的姊妹刀 dedupeCrossingBridges + polylinesMeet + roadWidth **原文**執行。
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
const line = (x0, z0, x1, z1, n = 12) => Array.from({ length: n + 1 }, (_, i) => [x0 + (x1 - x0) * i / n, z0 + (z1 - z0) * i / n]);
const idsLeft = (roads, out) => out.map((w) => roads.indexOf(w)).filter((i) => i >= 0);

const { dedupeCrossingBridges, roadWidth } = loadCore();
ok(roadWidth({ highway: 'primary' }) > roadWidth({ highway: 'residential' }), 'roadWidth:大馬路 > 小馬路');

console.log('Ⅰ 交叉必剔除低優先');
{
  const major = way('primary', line(0, -50, 0, 50));       // 南北向大馬路橋
  const minor = way('residential', line(-50, 0, 50, 0));   // 東西向小馬路橋(交叉於原點)
  const out = dedupeCrossingBridges([major, minor], null, []);
  ok(out.length === 1 && out[0] === major, '大×小 交叉 → 只留大馬路');
  const out2 = dedupeCrossingBridges([minor, major], null, []);   // 換順序:仍看優先度,非插入序
  ok(out2.length === 1 && out2[0] === major, '換順序仍只留大馬路(依 rank 非序)');
}

console.log('Ⅱ 平行不交會 → 都保留');
{
  const a = way('primary', line(0, -50, 0, 50));
  const b = way('primary', line(30, -50, 30, 50));   // 平行、相距 30m > CROSS_GAP
  const out = dedupeCrossingBridges([a, b], null, []);
  ok(out.length === 2, '平行雙橋(不交會)兩條都留(平行堆疊由 dedupeParallelBridges 另管)');
}

console.log('Ⅲ 兵線補橋恆勝');
{
  const lane = line(-50, 0, 50, 0);            // 東西向兵線泡水段
  const major = way('primary', line(0, -50, 0, 50));   // 南北向大馬路橋,與兵線交叉
  const out = dedupeCrossingBridges([major], null, [lane]);
  ok(out.length === 0, '大馬路橋與兵線交會 → 大馬路橋整條剔除(兵線恆勝)');
  const par = way('primary', line(0, -50, 0, 50));
  const laneParallel = line(40, -50, 40, 50);  // 兵線與該橋平行不交會
  ok(dedupeCrossingBridges([par], null, [laneParallel]).length === 1, '兵線與橋平行不交會 → 橋保留');
}

console.log('Ⅳ 等寬交會 → 長者保留');
{
  const longB = way('primary', line(0, -80, 0, 80, 20));    // 長(160m)
  const shortB = way('primary', line(-20, 0, 20, 0, 6));     // 短(40m),與長者交叉
  const out = dedupeCrossingBridges([shortB, longB], null, []);
  ok(out.length === 1 && out[0] === longB, '等寬交叉 → 留長者(短者剔除)');
}

console.log('Ⅴ 反向驗證:polylinesMeet 恆回 false ⇒ 交會不被偵測');
{
  const bad = loadCore((s) => s.replace('function polylinesMeet(A, B, gap) {', 'function polylinesMeet(A, B, gap) {\n  return false;'));
  const major = way('primary', line(0, -50, 0, 50));
  const minor = way('residential', line(-50, 0, 50, 0));
  const out = bad.dedupeCrossingBridges([major, minor], null, []);
  ok(out.length === 2, '對照組:交會偵測失效 ⇒ 兩條都留(稽核有牙齒)');
}

console.log(`\n${fail === 0 ? '✅ 全綠' : '❌ 有紅字'}  pass=${pass} fail=${fail}`);
process.exit(fail === 0 ? 0 : 1);
