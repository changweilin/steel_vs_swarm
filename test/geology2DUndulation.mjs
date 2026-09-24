import assert from 'node:assert/strict';
import {
  GEOLOGY_2D_PATTERNS,
  GEOLOGY_TYPE_2D_PATTERN,
  eval2DUndulation,
  elongatedGeologyMesh,
} from '../public/js/geology.js';
import { narrowGeologyBoundary, NARROW_GEOLOGY_BOUNDARY } from '../public/js/environmentParts.js';
import {
  BOUNDARY_BUFFER_LAYOUTS,
  buildBoundaryRunParts,
} from '../public/js/edgewall.js';

console.log('=== 驗證地質 2D 隨機起伏與邊界緩衝區擴大延伸 ===\n');

// -----------------------------------------------------------------------------
// 1. 2D 起伏模式清單與 eval2DUndulation 基礎特性 (決定性、有界性)
// -----------------------------------------------------------------------------
console.log('1. 驗證 2D 起伏模式清單與 eval2DUndulation 基礎特性...');
assert(Array.isArray(GEOLOGY_2D_PATTERNS), 'GEOLOGY_2D_PATTERNS 必須為陣列');
assert.deepEqual(
  GEOLOGY_2D_PATTERNS.slice().sort(),
  ['fluid', 'lattice', 'quasicrystal', 'random'].sort(),
  '必須包含 lattice, quasicrystal, fluid, random 四種模式'
);

const testPoints = [
  [0, 0],
  [12.5, -8.3],
  [-33.7, 45.1],
  [100.0, -100.0],
];

for (const pattern of GEOLOGY_2D_PATTERNS) {
  for (const [x, z] of testPoints) {
    const v1 = eval2DUndulation(pattern, x, z, 42, 20);
    const v2 = eval2DUndulation(pattern, x, z, 42, 20);
    assert.equal(v1, v2, `模式 ${pattern} 在 (${x}, ${z}) 必須具備嚴格位元決定性`);
    assert(Number.isFinite(v1), `模式 ${pattern} 計算值必須為有限數`);
    assert(v1 >= -2.0 && v1 <= 2.0, `模式 ${pattern} 起伏振幅應在合理邊界內 [-2, 2]，實得 ${v1}`);
  }
}
console.log('   ✓ 4 種 2D 起伏模式均具備嚴格位元決定性與數值有界性');

// -----------------------------------------------------------------------------
// 2. 驗證全方向視角皆有波峰與波谷 (Any direction exhibits peaks and valleys)
// -----------------------------------------------------------------------------
console.log('2. 驗證各 2D 模式在全方位角（0° ~ 180°）皆具備波峰與波谷...');
const angles = [
  0,
  Math.PI / 6,   // 30°
  Math.PI / 4,   // 45°
  Math.PI / 3,   // 60°
  Math.PI / 2,   // 90°
  (2 * Math.PI) / 3, // 120°
  (3 * Math.PI) / 4, // 135°
  (5 * Math.PI) / 6, // 150°
];

for (const pattern of GEOLOGY_2D_PATTERNS) {
  for (const theta of angles) {
    const deg = Math.round((theta * 180) / Math.PI);
    const cos = Math.cos(theta);
    const sin = Math.sin(theta);
    const samples = [];
    const step = 0.5;
    const maxDist = 120;

    for (let t = 0; t <= maxDist; t += step) {
      const x = t * cos;
      const z = t * sin;
      const val = eval2DUndulation(pattern, x, z, 777, 24);
      samples.push(val);
    }

    let peakCount = 0;
    let valleyCount = 0;
    for (let i = 1; i < samples.length - 1; i++) {
      const prev = samples[i - 1];
      const curr = samples[i];
      const next = samples[i + 1];
      if (curr > prev && curr > next && curr > 0.05) {
        peakCount++;
      } else if (curr < prev && curr < next && curr < -0.05) {
        valleyCount++;
      }
    }

    assert(
      peakCount >= 2,
      `模式 ${pattern} 在角度 ${deg}° 方向應至少有 2 個波峰 (實得 ${peakCount})`
    );
    assert(
      valleyCount >= 2,
      `模式 ${pattern} 在角度 ${deg}° 方向應至少有 2 個波谷 (實得 ${valleyCount})`
    );
  }
}
console.log('   ✓ 全部模式在各方位角切片均有充分波峰與波谷（無起伏死角）');

// -----------------------------------------------------------------------------
// 3. 2D 尺度門檻判定與邊緣高度 landing envelope (h_edge === 0)
// -----------------------------------------------------------------------------
console.log('3. 驗證大尺度 2D 起伏觸發與外圍四邊邊緣高度嚴格為 0...');
const largeMeshRes = elongatedGeologyMesh('cliff', 101, {
  len: 80,
  depth: 30, // depth >= 20 觸發 2D 起伏
  height: 15,
});

assert(largeMeshRes && largeMeshRes.meshData, '應成功產生 elongatedGeologyMesh');
const { vertices } = largeMeshRes.meshData;
assert(vertices && vertices.length > 0, '應包含頂點座標');

// 檢查四邊最外緣頂點 (x = ±len/2 或 z = ±depth/2) 的高度 y 必須為 0
const halfL = 40;
const halfD = 15;
const eps = 1e-4;

let perimeterVertexCount = 0;
let interiorVertexCount = 0;
let maxInteriorY = 0;

for (let i = 0; i < vertices.length; i += 3) {
  const x = vertices[i];
  const y = vertices[i + 1];
  const z = vertices[i + 2];

  const onEdgeX = Math.abs(Math.abs(x) - halfL) < eps;
  const onEdgeZ = Math.abs(Math.abs(z) - halfD) < eps;

  if (onEdgeX || onEdgeZ) {
    perimeterVertexCount++;
    assert(
      Math.abs(y) < 1e-5,
      `外圍邊緣頂點 (${x.toFixed(2)}, ${z.toFixed(2)}) 高度必須為 0 (實得 y=${y})`
    );
  } else {
    interiorVertexCount++;
    if (y > maxInteriorY) {
      maxInteriorY = y;
    }
  }
}

assert(perimeterVertexCount > 0, '應存在外圍邊緣頂點');
assert(interiorVertexCount > 0, '應存在內部頂點');
assert(
  maxInteriorY > 5,
  `內部起伏頂點最高點應大於 5m (名義高 15m, 實得 ${maxInteriorY.toFixed(2)}m)`
);
console.log(
  `   ✓ 外圍頂點 ${perimeterVertexCount} 處高度嚴格歸零；內部頂點 ${interiorVertexCount} 處最高起伏 ${maxInteriorY.toFixed(2)}m`
);

// -----------------------------------------------------------------------------
// 4. 連續地質往緩衝區 2 維擴大延伸 (Continuous Geology Buffer Expansion)
// -----------------------------------------------------------------------------
console.log('4. 驗證連續邊界地質區域朝緩衝區 2D 延伸填滿...');
const continuousTypes = [
  'cliff', 'rockery', 'landslide', 'debris', 'isletbarrier',
  'basaltspine', 'rollinghills', 'reefchain',
];

for (const kind of continuousTypes) {
  const len = 60;
  const depth = 16;
  const height = 12;
  const bufferDepth = 40;
  const geoType = NARROW_GEOLOGY_BOUNDARY[kind];

  const res = elongatedGeologyMesh(geoType, 2024, {
    len,
    depth,
    height,
    bufferDepth,
  });

  assert(res.meshData, `${kind}: 必須產生障礙主體 meshData`);
  assert(res.bufferMeshData, `${kind}: bufferDepth > 0 必須產生 bufferMeshData`);

  const pObstacle = res.meshData.vertices;
  const cObstacle = res.meshData.colors;
  const pBuffer = res.bufferMeshData.vertices;
  const cBuffer = res.bufferMeshData.colors;

  // 障礙區與緩衝區接縫處為 z = -depth / 2 = -8
  const seamZ = -depth / 2;
  const pzCenter = -depth / 2 - bufferDepth / 2;
  const seamObstacleMap = new Map();
  const seamBufferMap = new Map();

  for (let i = 0; i < pObstacle.length; i += 3) {
    const x = pObstacle[i];
    const y = pObstacle[i + 1];
    const z = pObstacle[i + 2];
    if (Math.abs(z - seamZ) < 1e-4) {
      const key = x.toFixed(3);
      if (!seamObstacleMap.has(key)) {
        seamObstacleMap.set(key, { y, r: cObstacle[i], g: cObstacle[i + 1], b: cObstacle[i + 2] });
      }
    }
  }

  for (let i = 0; i < pBuffer.length; i += 3) {
    const x = pBuffer[i];
    const y = pBuffer[i + 1];
    const zLocal = pBuffer[i + 2];
    const zWorld = zLocal + pzCenter;
    if (Math.abs(zWorld - seamZ) < 1e-4) {
      const key = x.toFixed(3);
      if (!seamBufferMap.has(key)) {
        seamBufferMap.set(key, { y, r: cBuffer[i], g: cBuffer[i + 1], b: cBuffer[i + 2] });
      }
    }
  }

  assert(seamObstacleMap.size > 0, `${kind}: 障礙網格接縫處應有頂點`);
  assert.equal(
    seamObstacleMap.size,
    seamBufferMap.size,
    `${kind}: 接縫處頂點數量必須一致 (障礙=${seamObstacleMap.size}, 緩衝=${seamBufferMap.size})`
  );

  // 驗證接縫處高度與顏色嚴格無縫銜接
  for (const [key, obsVal] of seamObstacleMap.entries()) {
    const bufVal = seamBufferMap.get(key);
    assert(bufVal, `${kind}: 緩衝區接縫處缺少 x=${key} 之對應頂點`);
    assert(
      Math.abs(obsVal.y - bufVal.y) < 1e-4,
      `${kind}: 接縫 x=${key} 處高度必須完全一致 (障礙y=${obsVal.y}, 緩衝y=${bufVal.y})`
    );
    assert(
      Math.abs(obsVal.r - bufVal.r) < 1e-3 &&
      Math.abs(obsVal.g - bufVal.g) < 1e-3 &&
      Math.abs(obsVal.b - bufVal.b) < 1e-3,
      `${kind}: 接縫 x=${key} 處頂點顏色必須完全一致`
    );
  }

  // 驗證緩衝延伸網格的最外側外緣落地 (z = -(depth/2 + bufferDepth) 與 x = ±len/2)
  const outerBufferZ = -(depth / 2 + bufferDepth);
  let outerLandingCount = 0;
  let seamNonZeroCount = 0;

  for (let i = 0; i < pBuffer.length; i += 3) {
    const x = pBuffer[i];
    const y = pBuffer[i + 1];
    const zLocal = pBuffer[i + 2];
    const zWorld = zLocal + pzCenter;

    const onOuterZ = Math.abs(zWorld - outerBufferZ) < 1e-4;
    const onOuterX = Math.abs(Math.abs(x) - len / 2) < 1e-4;

    if (onOuterZ || onOuterX) {
      outerLandingCount++;
      assert(
        Math.abs(y) < 1e-4,
        `${kind}: 緩衝區外圍頂點 (${x.toFixed(2)}, ${zWorld.toFixed(2)}) 必須落地為 0 (y=${y})`
      );
    }

    if (Math.abs(zWorld - seamZ) < 1e-4 && y > 0.1) {
      seamNonZeroCount++;
    }
  }

  assert(outerLandingCount > 0, `${kind}: 緩衝區外緣必須有落地頂點`);
  assert(
    seamNonZeroCount > 0,
    `${kind}: 接縫處應保持地形連續起伏高度 (不可出現內部落地裙擺阻斷)`
  );

  // 驗證頭尾兩端波谷數值契約：valleys[0] === 0 與 valleys[bumps] === 0
  assert.equal(res.undulation.valleys[0], 0, `${kind}: 頭端波谷 (valleys[0]) 必須嚴格為 0m`);
  assert.equal(
    res.undulation.valleys[res.params.bumps],
    0,
    `${kind}: 尾端波谷 (valleys[bumps]) 必須嚴格為 0m`
  );

  // 驗證 2D 空間起伏啟用狀態：延伸至緩衝區時 2 個維度都必須加入隨機起伏
  assert.equal(res.undulation.is2D, true, `${kind}: 往緩衝區延伸時 is2D 必須啟用`);

  // 驗證脊頂取樣器在頭尾兩端 (u = ±1) 嚴格為 0m
  for (const v of [-1, -0.5, 0, 0.5, 1]) {
    assert.equal(
      res.heightAt(-1, v),
      0,
      `${kind}: heightAt(-1, ${v}) 頭端高度必須嚴格為 0m`
    );
    assert.equal(
      res.heightAt(1, v),
      0,
      `${kind}: heightAt(1, ${v}) 尾端高度必須嚴格為 0m`
    );
  }
}
console.log(`   ✓ 全部 ${continuousTypes.length} 款連續地質皆能向緩衝區無縫 2D 延伸，且頭尾兩端波谷嚴格為 0m、外圍落地、接縫平滑`);

// -----------------------------------------------------------------------------
// 4.1 驗證 2D 起伏不同排波峰隨機交錯（破除直角棋盤排布）
// -----------------------------------------------------------------------------
console.log('4.1 驗證 2D 起伏不同排波峰隨機交錯（非整齊棋盤排布）...');
for (const kind of continuousTypes) {
  const mesh = elongatedGeologyMesh(kind === 'rockery' ? 'mountain' : (NARROW_GEOLOGY_BOUNDARY[kind] || 'cliff'), 2026, {
    len: 80,
    depth: 16,
    height: 14,
    bufferDepth: 35,
  });

  // 收集緩衝區網格中各 z 排的頂點
  const verts = mesh.bufferMeshData.vertices;
  const rows = new Map();
  for (let i = 0; i < verts.length; i += 3) {
    const x = verts[i], y = verts[i + 1], z = verts[i + 2];
    const zKey = z.toFixed(2);
    if (!rows.has(zKey)) rows.set(zKey, []);
    rows.get(zKey).push({ x, y });
  }

  // 找出有顯著起伏的高峰排
  const reliefRows = Array.from(rows.entries())
    .map(([z, pts]) => ({
      z: Number(z),
      peak: pts.reduce((max, p) => (p.y > max.y ? p : max), pts[0]),
    }))
    .filter(r => r.peak.y > 2.0);

  assert(reliefRows.length >= 3, `${kind}: 應有足夠深度排數進行起伏交錯檢驗 (實得 ${reliefRows.length})`);

  // 驗證相鄰排波峰位置存在橫向位移（交錯），絕非所有排波峰鎖定在同一 x 座標（棋盤格）
  let staggeredShifts = 0;
  for (let r = 0; r < reliefRows.length - 1; r++) {
    const dx = Math.abs(reliefRows[r].peak.x - reliefRows[r + 1].peak.x);
    if (dx > 0.5) staggeredShifts++;
  }

  assert(
    staggeredShifts > 0,
    `${kind}: 2D 地質深度方向各排波峰必須隨機交錯，不可呈整齊棋盤對齊 (staggeredShifts: ${staggeredShifts})`
  );
}
console.log('   ✓ 全部連續地質在 2D 緩衝延伸中各排波峰皆自然隨機交錯');


// -----------------------------------------------------------------------------
// 5. 邊界管線整合 (narrowGeologyBoundary 與 buildBoundaryRunParts)
// -----------------------------------------------------------------------------
console.log('5. 驗證邊界管線整合產出 bufferParts...');

// 5.1 narrowGeologyBoundary 產出驗證
const narrowRows = narrowGeologyBoundary('cliff', {
  len: 60,
  depth: 16,
  h: 12,
  seed: 99,
  bufferDepth: 35,
});

assert(narrowRows.parts && narrowRows.parts.length > 0, 'narrowGeologyBoundary 應包含主要障礙物 parts');
assert(narrowRows.bufferParts && narrowRows.bufferParts.length > 0, 'narrowGeologyBoundary 在 bufferDepth > 0 時應包含 bufferParts');
const bufPart0 = narrowRows.bufferParts[0];
assert.equal(bufPart0.role, 'boundary-buffer-fill');
assert.equal(bufPart0.boundaryBuffer, true);

// 5.2 buildBoundaryRunParts 收集驗證
for (const kind of continuousTypes) {
  const layout = BOUNDARY_BUFFER_LAYOUTS[kind];
  assert(layout, `BOUNDARY_BUFFER_LAYOUTS 必須包含 ${kind}`);
  assert.equal(layout.continuousGeology, true, `${kind} 必須標記 continuousGeology: true`);

  const runParts = buildBoundaryRunParts(kind, {
    len: 100,
    depth: 16,
    h: 14,
    seed: 555,
    bufferDepth: 30,
  });

  assert(runParts.parts.length > 0, `${kind}: 應產生主要 parts`);
  assert(
    runParts.bufferParts.length > 0,
    `${kind}: 應產生填滿緩衝區之 bufferParts (實得 ${runParts.bufferParts.length})`
  );

  const fillPart = runParts.bufferParts.find(p => p.role === 'boundary-buffer-fill');
  assert(fillPart, `${kind}: bufferParts 內應包含 boundary-buffer-fill 部件`);
}

console.log('   ✓ 邊界管線正確將連續地質的 2D 緩衝延伸劃入 bufferParts 並填滿緩衝區');
console.log('\n=== 全部地質 2D 隨機起伏與邊界緩衝區擴大延伸驗證通過 ===');
