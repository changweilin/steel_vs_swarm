// ============ City-wall barbican and levee gate junction/endpoint extension tests ============
import assert from 'node:assert/strict';
import { wallParts, buildBoundaryRunParts, wallFit, WALL_KINDS } from '../public/js/edgewall.js';
import { buildSlopeBoundary } from '../public/js/edgeSlope.js';
import { NATURAL_CLIFF_KINDS } from '../public/js/environmentParts.js';

console.log('--- 測試城牆甕城與河堤閘門連接／端點延伸規則 ---');

// 1. Natural rockmass membership list
assert(NATURAL_CLIFF_KINDS.has('cliff'));
assert(NATURAL_CLIFF_KINDS.has('landslide'));
assert(NATURAL_CLIFF_KINDS.has('debris'));
assert(!NATURAL_CLIFF_KINDS.has('citywall'));
assert(!NATURAL_CLIFF_KINDS.has('levee'));
assert(!NATURAL_CLIFF_KINDS.has('barricade'));
console.log('✓ 自然岩體集合宣告正確 (cliff, landslide, debris)');

// 2. City-wall self extension: joined through the barbican
{
  const def = WALL_KINDS.citywall;
  const joinsSelf = [{ kind: 'citywall' }, { kind: 'citywall' }];
  const parts = wallParts('citywall', { len: 24, depth: def.depth, h: def.h, seed: 101, joins: joinsSelf });
  const roles = new Set(parts.map(p => p.role));
  assert(roles.has('barbican-wall'), '城牆自身延伸應包含 barbican-wall');
  assert(roles.has('barbican-tower'), '城牆自身延伸應包含 barbican-tower');
  assert(roles.has('barbican-gate'), '城牆自身延伸應包含 barbican-gate');
  assert(roles.has('gate-arch'), '城牆自身延伸應包含 gate-arch');
  assert(roles.has('battlement'), '城牆自身延伸應包含 battlement');
  assert(roles.has('course-joint'), '城牆自身延伸應包含 course-joint');
  assert(wallFit(parts, 24, def.depth, def.h).fit, '城牆自身延伸零件嚴格收在幾何包絡內');
  console.log('✓ 城牆自身持續延伸時透過甕城連接，構件完整且收納於邊界包絡內');
}

// 3. Levee self extension: joined through the gate
{
  const def = WALL_KINDS.levee;
  const joinsSelf = [{ kind: 'levee' }, { kind: 'levee' }];
  const parts = wallParts('levee', { len: 24, depth: def.depth, h: def.h, seed: 202, joins: joinsSelf });
  const roles = new Set(parts.map(p => p.role));
  assert(roles.has('gate-pier'), '河堤自身延伸應包含 gate-pier');
  assert(roles.has('gate-leaf'), '河堤自身延伸應包含 gate-leaf');
  assert(roles.has('gate-frame'), '河堤自身延伸應包含 gate-frame');
  assert(roles.has('gate-hoist'), '河堤自身延伸應包含 gate-hoist');
  assert(roles.has('gate-bridge'), '河堤自身延伸應包含 gate-bridge');
  assert(roles.has('wing-wall'), '河堤自身延伸應包含 wing-wall');
  assert(wallFit(parts, 24, def.depth, def.h).fit, '河堤自身延伸零件嚴格收在幾何包絡內');
  console.log('✓ 河堤自身持續延伸時透過閘門連接，構件完整且收納於邊界包絡內');
}

// 4. Abutting cliff/debris-flow/landslide ground: embed directly into rock, no barbican/gate
for (const cliffKind of ['cliff', 'landslide', 'debris']) {
  const defWall = WALL_KINDS.citywall;
  const joinsCliffWall = [{ kind: cliffKind }, { kind: cliffKind }];
  const wallPartsCliff = wallParts('citywall', { len: 24, depth: defWall.depth, h: defWall.h, seed: 303, joins: joinsCliffWall });
  assert(!wallPartsCliff.some(p => p.role && p.role.startsWith('barbican-')), `城牆與 ${cliffKind} 相接時不得生成甕城`);

  const defLevee = WALL_KINDS.levee;
  const joinsCliffLevee = [{ kind: cliffKind }, { kind: cliffKind }];
  const leveePartsCliff = wallParts('levee', { len: 24, depth: defLevee.depth, h: defLevee.h, seed: 404, joins: joinsCliffLevee });
  assert(!leveePartsCliff.some(p => p.role && (p.role.startsWith('gate-') || p.role === 'wing-wall')), `河堤與 ${cliffKind} 相接時不得生成水閘門`);
}
console.log('✓ 城牆／河堤與自然岩體（cliff, landslide, debris）相接時直接嵌合岩體，不產生甕城或閘門');

// 5. Abutting non-rock ground (endpoint): build a barbican/gate as the endpoint and keep paving both ends into the buffer
{
  const def = WALL_KINDS.citywall;
  // Endpoint abuts barricade (non-rock ground)
  const joinsBarricade = [{ kind: 'barricade' }, { kind: 'barricade' }];
  const runBatch = buildBoundaryRunParts('citywall', {
    len: 24, depth: def.depth, bufferDepth: 18, h: def.h,
    seed: 505, variant: 0, joins: joinsBarricade,
  });
  const partsRoles = new Set(runBatch.parts.map(p => p.role));
  assert(partsRoles.has('barbican-wall'), '端點應建立甕城');
  assert(partsRoles.has('barbican-tower'), '端點應建立甕城樓');

  // Buffer paving
  const bufRoles = new Set(runBatch.bufferParts.map(p => p.role));
  assert(bufRoles.has('buffer-wall'), '城牆端點向緩衝區繼續鋪設 buffer-wall');
  assert(bufRoles.has('course-joint'), '城牆緩衝區鋪設包含 course-joint');
  assert(bufRoles.has('battlement'), '城牆緩衝區鋪設包含 battlement');
  assert(runBatch.bufferParts.every(p => p.boundaryBuffer === true), '緩衝區零件均標記 boundaryBuffer: true');
  console.log('✓ 城牆與非自然岩體相接時建立甕城作為端點，並向緩衝區繼續鋪設 buffer-wall');
}

{
  const def = WALL_KINDS.levee;
  // Endpoint abuts warehousebelt (non-rock ground)
  const joinsWarehouse = [{ kind: 'warehousebelt' }, { kind: 'warehousebelt' }];
  const runBatch = buildBoundaryRunParts('levee', {
    len: 24, depth: def.depth, bufferDepth: 18, h: def.h,
    seed: 606, variant: 0, joins: joinsWarehouse,
  });
  const partsRoles = new Set(runBatch.parts.map(p => p.role));
  assert(partsRoles.has('gate-pier'), '端點應建立閘墩');
  assert(partsRoles.has('gate-leaf'), '端點應建立防汛鋼閘板');

  // Buffer paving
  const bufRoles = new Set(runBatch.bufferParts.map(p => p.role));
  assert(bufRoles.has('buffer-levee'), '河堤端點向緩衝區繼續鋪設 buffer-levee');
  assert(bufRoles.has('wing-wall'), '河堤緩衝區鋪設包含 wing-wall');
  assert(runBatch.bufferParts.every(p => p.boundaryBuffer === true), '緩衝區零件均標記 boundaryBuffer: true');
  console.log('✓ 河堤與非自然岩體相接時建立閘門作為端點，並向緩衝區繼續鋪設 buffer-levee');
}

// 6. Slope-boundary terrain conformance (buildSlopeBoundary) elevation alignment and envelope check
{
  const def = WALL_KINDS.citywall;
  const slopeWall = buildSlopeBoundary('citywall', {
    len: 24, depth: def.depth, h: def.h, x: 100, z: 200, ry: 0,
    seed: 707, season: 'summer',
    heightAt: (x, z) => 35 + Math.sin(x * 0.1) * 4,
    joins: [{ kind: 'citywall' }, { kind: 'barricade' }],
  });
  assert(slopeWall != null);
  assert(slopeWall.parts.length > 0);
  for (const p of slopeWall.parts) {
    assert(Number.isFinite(p.p[0]));
    assert(Number.isFinite(p.p[1]));
    assert(Number.isFinite(p.p[2]));
    // Keep y elevation within the plausible terrain band (35 +/- 4) plus wall height (14)
    assert(p.p[1] >= 30 && p.p[1] <= 60, `城牆零件 y=${p.p[1]} 應在地形高度附近`);
  }
  console.log('✓ buildSlopeBoundary 城牆甕城零件高程正確貼合地形高程');
}

{
  const def = WALL_KINDS.levee;
  const slopeLevee = buildSlopeBoundary('levee', {
    len: 24, depth: def.depth, h: def.h, x: -100, z: -200, ry: Math.PI / 2,
    seed: 808, season: 'summer',
    heightAt: (x, z) => 18 + Math.cos(z * 0.1) * 3,
    joins: [{ kind: 'levee' }, { kind: 'canalbank' }],
  });
  assert(slopeLevee != null);
  assert(slopeLevee.parts.length > 0);
  for (const p of slopeLevee.parts) {
    assert(Number.isFinite(p.p[0]));
    assert(Number.isFinite(p.p[1]));
    assert(Number.isFinite(p.p[2]));
    // Keep y elevation within the plausible terrain band (18 +/- 3) plus levee height (8)
    assert(p.p[1] >= 14 && p.p[1] <= 35, `河堤零件 y=${p.p[1]} 應在地形高度附近`);
  }
  console.log('✓ buildSlopeBoundary 河堤閘門零件高程正確貼合地形高程');
}

console.log('\n🎉 所有城牆甕城與河堤閘門連接與端點延伸測試全數通過！');
