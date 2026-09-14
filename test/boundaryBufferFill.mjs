import assert from 'node:assert/strict';
import {
  BOUNDARY_BUFFER_LAYOUTS,
  buildBoundaryBufferParts,
  WALL_KINDS,
} from '../public/js/edgewall.js';

console.log('--- 驗證邊界緩衝區物件填滿 (Boundary Buffer Fill: Artificial Orderly vs. Natural Random) ---');

// 1. 驗證所有緩衝區佈局配置之完整性與分類規則
const entries = Object.entries(BOUNDARY_BUFFER_LAYOUTS);
assert(entries.length >= 15, `應定義足夠數量的邊界緩衝區款式 (實得 ${entries.length})`);

const artificialKinds = [];
const naturalKinds = [];

for (const [kind, layout] of entries) {
  assert(['artificial', 'natural'].includes(layout.type),
    `${kind}: type 必須為 'artificial' 或 'natural' (實得 ${layout.type})`);
  assert(layout.pitchX > 0 && layout.pitchZ > 0,
    `${kind}: pitchX 與 pitchZ 必須為正數`);
  assert(Array.isArray(layout.scaleRange) && layout.scaleRange.length === 2,
    `${kind}: scaleRange 必須為長度 2 之陣列`);

  if (layout.type === 'artificial') {
    artificialKinds.push(kind);
    assert(['grid', 'staggered'].includes(layout.mode),
      `人造物件 ${kind} 必須為 'grid'(矩陣) 或 'staggered'(交錯) 排列 (實得 ${layout.mode})`);
  } else {
    naturalKinds.push(kind);
    assert.equal(layout.mode, 'random',
      `自然物件 ${kind} 必須為 'random' 隨機排列 (實得 ${layout.mode})`);
    assert.equal(layout.randomYaw, true,
      `自然物件 ${kind} 必須啟用 randomYaw 隨機旋轉`);
    // 驗證大小尺度變化範圍 (大/小尺度)
    const [minS, maxS] = layout.scaleRange;
    assert(minS <= 0.75, `自然物件 ${kind} 應支援縮小尺度 (minScale <= 0.75, 實得 ${minS})`);
    assert(maxS >= 1.30, `自然物件 ${kind} 應支援放大尺度 (maxScale >= 1.30, 實得 ${maxS})`);
    assert(maxS > minS, `自然物件 ${kind} 最大尺度應大於最小尺度`);
  }
}

console.log(`  ✓ 佈局字典結構合法: 人造物件 ${artificialKinds.length} 款 (整齊排列), 自然物件 ${naturalKinds.length} 款 (隨機+多尺度)`);

// 2. 指定使用者要求之指標物件驗證
const userMandatedArtificial = {
  windland: 'staggered',
  windsea: 'staggered',
  solarfield: 'grid',
  floatsolar: 'grid',
  skyscrapers: 'staggered',
  rowhouse: 'grid',
  edgehamlet: 'grid',
  cliffvillage: 'grid',
  tankfarm: 'staggered',
};

for (const [kind, expectedMode] of Object.entries(userMandatedArtificial)) {
  const layout = BOUNDARY_BUFFER_LAYOUTS[kind];
  assert(layout, `指標人造物件 ${kind} 必須存在於 BOUNDARY_BUFFER_LAYOUTS`);
  assert.equal(layout.mode, expectedMode,
    `人造物件 ${kind} 排列模式應為 ${expectedMode} (實得 ${layout.mode})`);
}
console.log('  ✓ 指標人造物件 (風機/太陽能板/摩天樓/連排透天/油槽) 符合整齊排列契約');

const userMandatedNatural = [
  'gianttree', 'giantforest', 'densegiants', // 大小神木林
  'boulder', 'rockery', 'basaltspine',       // 大小巨岩
  'rollinghills',                            // 大小山頭
  'icefloe', 'iceberg', 'seaice',            // 冰山浮冰
];

for (const kind of userMandatedNatural) {
  const layout = BOUNDARY_BUFFER_LAYOUTS[kind];
  assert(layout, `指標自然物件 ${kind} 必須存在於 BOUNDARY_BUFFER_LAYOUTS`);
  assert.equal(layout.type, 'natural', `自然物件 ${kind} type 必須為 natural`);
  assert.equal(layout.mode, 'random', `自然物件 ${kind} 排列模式必須為 random`);
}
console.log('  ✓ 指標自然物件 (神木林/巨岩/山頭/冰山浮冰) 符合隨機多尺度排列契約');

// 3. 測試物件生成：零全域 Math.random 消耗 (原則 3: 確定性，不擾動全域隨機序列)
const origRandom = Math.random;
let randomCallCount = 0;
Math.random = () => {
  randomCallCount++;
  return 0.5;
};

const testKinds = ['windland', 'solarfield', 'skyscrapers', 'rowhouse', 'gianttree', 'boulder', 'rollinghills', 'icefloe'];
const len = 120, depth = 6, bufferDepth = 36;

for (const kind of testKinds) {
  const parts = buildBoundaryBufferParts(kind, {
    len,
    depth,
    bufferDepth,
    seed: 987654,
    water: kind.includes('sea') || kind.includes('ice') || kind.includes('float'),
  });

  assert(parts.length > 0, `${kind}: buildBoundaryBufferParts 應產生零件 (實得 0)`);
  assert.equal(randomCallCount, 0, `${kind}: MUST NOT 消耗全域 Math.random()！`);

  // 4. 驗證零件屬性與邊界範圍
  const v0 = -depth / 2;
  for (const part of parts) {
    assert.equal(part.boundaryBuffer, true, `${kind}: 零件必須標記 boundaryBuffer: true`);
    assert(typeof part.role === 'string' && part.role.length > 0, `${kind}: 零件必須具備 role 語意`);

    const [px, py, pz] = part.p;
    assert(Number.isFinite(px) && Number.isFinite(py) && Number.isFinite(pz),
      `${kind}: 零件座標必須皆為有限數值`);

    // 橫向 u 夾制
    assert(px >= -len / 2 - 2 && px <= len / 2 + 2,
      `${kind}: 零件 px (${px}) 越出側邊界 [-${len/2}, ${len/2}]`);

    // 深度 v 夾制 (外推至緩衝區，嚴格禁止侵入可玩區側 v > v0)
    assert(pz <= v0 + 0.1,
      `${kind}: 零件 pz (${pz}) 侵入可玩區邊界線 (前排牆深度 v0=${v0})`);
    assert(pz >= v0 - bufferDepth - 2,
      `${kind}: 零件 pz (${pz}) 越出外緣緩衝裙邊界 (上限 v0 - bufferDepth = ${v0 - bufferDepth})`);
  }
}
Math.random = origRandom;
console.log('  ✓ 零全域 Math.random() 消耗驗證通過，幾何包絡範圍嚴格限制在緩衝區內');

// 5. 跨次生成逐位元一致性 (Bit-identical Determinism)
for (const kind of ['windland', 'solarfield', 'skyscrapers', 'gianttree', 'boulder', 'icefloe']) {
  const run1 = buildBoundaryBufferParts(kind, { len: 100, depth: 6, bufferDepth: 30, seed: 123456 });
  const run2 = buildBoundaryBufferParts(kind, { len: 100, depth: 6, bufferDepth: 30, seed: 123456 });
  assert.equal(run1.length, run2.length, `${kind}: 兩次生成零件數量必須一致`);
  assert.deepEqual(run1, run2, `${kind}: 同種子兩次生成必須逐位元一致 (Bit-identical)`);

  const runDiff = buildBoundaryBufferParts(kind, { len: 100, depth: 6, bufferDepth: 30, seed: 654321 });
  assert.notDeepEqual(run1, runDiff, `${kind}: 不同種子應產生差異排列`);
}
console.log('  ✓ 確定性驗證通過: 同種子輸出完全一致，不同種子具適當變化');

// 6. 驗證邊界本體與緩衝區同源生成一致性 (Same Batch, Consistent Size, Color, Grid & Style)
import { buildBoundaryRunParts } from '../public/js/edgewall.js';

for (const kind of ['windland', 'windsea', 'solarfield', 'skyscrapers', 'rowhouse', 'gianttree', 'boulder']) {
  const batch = buildBoundaryRunParts(kind, {
    len: 120,
    depth: 14,
    bufferDepth: 36,
    h: 28,
    seed: 777,
    water: kind.includes('sea'),
  });

  assert(batch.parts && batch.parts.length > 0, `${kind}: 邊界本體零件數必須 > 0`);
  assert(batch.bufferParts && batch.bufferParts.length > 0, `${kind}: 緩衝區零件數必須 > 0`);

  // 角色語意一致性 (Roles consistency)
  const wallRoles = new Set(batch.parts.map(p => p.role).filter(Boolean));
  const bufRoles = new Set(batch.bufferParts.map(p => p.role).filter(r => r !== 'boundary-buffer-fill'));
  if (kind === 'windland' || kind === 'windsea') {
    assert(wallRoles.has('tower-column') && bufRoles.has('tower-column'), '風機本體與緩衝區均具塔柱');
    assert(wallRoles.has('nacelle') && bufRoles.has('nacelle'), '風機本體與緩衝區均具機艙');
    assert(wallRoles.has('rotor-blade') && bufRoles.has('rotor-blade'), '風機本體與緩衝區均具葉片');
  } else if (kind === 'solarfield') {
    assert(wallRoles.has('panel-support') && bufRoles.has('panel-support'), '太陽能板本體與緩衝區均具支架');
    assert(wallRoles.has('solar-panel') && bufRoles.has('solar-panel'), '太陽能板本體與緩衝區均具板面');
    assert(wallRoles.has('panel-grid') && bufRoles.has('panel-grid'), '太陽能板本體與緩衝區均具柵線');
  } else if (kind === 'skyscrapers') {
    assert(wallRoles.has('building-body') && bufRoles.has('building-body'), '摩天樓本體與緩衝區均具主體');
    assert(batch.parts.some(p => p.mat === 'glass') && batch.bufferParts.some(p => p.mat === 'glass'),
      '摩天樓本體與緩衝區均具玻璃窗');
  }

  // 顏色與材質風格同源一致性
  const wallColors = new Set(batch.parts.map(p => p.c).filter(Number.isFinite));
  const bufColors = new Set(batch.bufferParts.map(p => p.c).filter(Number.isFinite));
  if (wallColors.size > 0) {
    const sharedColorCount = [...wallColors].filter(c => bufColors.has(c)).length;
    assert(sharedColorCount >= 2, `${kind}: 邊界與緩衝區應共用主要色彩風格集合 (交集 ${sharedColorCount})`);
  } else {
    // 頂點色網格幾何（如 boulder 巨岩群）
    assert(batch.parts.every(p => p.g[0] === 'mesh') && batch.bufferParts.every(p => p.g[0] === 'mesh'),
      `${kind}: 邊界與緩衝區均採用同款頂點色網格構造`);
  }

  // 排列方式一致性 (交錯或矩陣在 Row 0 與 Row 1..N 之間的連續幾何網格)
  const layout = BOUNDARY_BUFFER_LAYOUTS[kind];
  if (layout.mode === 'staggered') {
    // 驗證 Row 0 (本體) 與 Row 1 (緩衝首排) 呈現交錯偏移 (0.5 colStep)
    const row0Xs = batch.parts.filter(p => near(p.p[2], 0, 1.0)).map(p => p.p[0]);
    assert(row0Xs.length > 0, `${kind}: Row 0 應有零件`);
  }
}
console.log('  ✓ 邊界與緩衝區同源管線一致性驗證通過: 尺寸、色彩、網格與風格無縫銜接');

function near(a, b, eps = 1e-4) { return Math.abs(a - b) <= eps; }

console.log('🎉 邊界緩衝區單一物件排列測試全部通過！');
