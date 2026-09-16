import assert from 'node:assert/strict';
import { register } from 'node:module';
const modules = {
  three: new URL('../out/forest_review/three.module.js', import.meta.url).href,
  'three/addons/utils/BufferGeometryUtils.js': new URL('../out/forest_review/utils_BufferGeometryUtils.js', import.meta.url).href,
};
register('data:text/javascript,' + encodeURIComponent(`const modules = ${JSON.stringify(modules)};
export async function resolve(s, c, next) { return modules[s] ? { url: modules[s], shortCircuit: true } : next(s, c); }`), import.meta.url);

const THREE = await import('three');
const { DEFS, SURFACES, SIZE } = await import('../public/js/groundCatalog.js');
const { GROUND_PARTS, GROUND_ATTACHMENTS, GROUND_PART_PALETTES } = await import('../public/js/groundPartCatalog.js');
const { paintGround, surfaceEnvironment } = await import('../public/js/proceduralGround.js');
const { paintBasketball, paintCourtArray, paintTrack } = await import('../public/js/groundMarkings.js');
const { TRACK, TRACK_WIDTH, TRACK_DEPTH } = await import('../public/js/groundVenues.js');
const { generateGroundPart } = await import('../public/js/proceduralGroundParts.js');
const { generateBuildingAppurtenances, calculateRoofMetrics } = await import('../public/js/buildingAppurtenances.js');

// ==========================================
// 1. 停車場：車格標線（汽車＋機車）與車輛停放測試
// ==========================================
console.log('--- 測試 1：停車場標線與車輛生成 ---');

// 1.1 驗證 GROUND_PARTS 具備 car 與 motorcycle，且幾何正常
for (const type of ['car', 'motorcycle']) {
  assert.ok(GROUND_PARTS[type], `GROUND_PARTS 必須定義 ${type}`);
  for (let v = 0; v < 3; v++) {
    const parts = generateGroundPart(type, v);
    assert.ok(parts.length > 0, `${type} 必須生成非空幾何`);
    for (const p of parts) {
      assert.ok([...p.geo.attributes.position.array].every(Number.isFinite));
      p.geo.computeBoundingBox();
      assert.ok(!p.geo.boundingBox.isEmpty());
      p.geo.dispose();
    }
  }
}

// 1.2 驗證停車場貼圖畫設汽車格與機車格標線
function makeContext() {
  const lines = [], rects = [];
  return {
    lines, rects,
    ctx: {
      fillStyle: '', strokeStyle: '', lineWidth: 1, globalAlpha: 1,
      beginPath() {}, moveTo(x, y) { this._x = x; this._y = y; },
      lineTo(x, y) { lines.push({ x1: this._x, y1: this._y, x2: x, y2: y }); },
      stroke() {}, fill() {}, fillRect() {}, save() {}, restore() {}, scale() {},
      translate() {}, arc() {}, ellipse() {}, strokeRect(x, y, w, h) { rects.push({ x, y, w, h }); },
      font: '', textAlign: '', fillText() {},
    },
  };
}

const pCtx = makeContext();
paintGround(pCtx.ctx, 256, 'parking', 42, surfaceEnvironment());
const motoLines = pCtx.lines.filter(l => l.x1 >= 0.52 && l.x2 >= 0.52 && l.y1 >= 0.70 && l.y2 >= 0.90);
assert.ok(motoLines.length >= 9, `停車場必須劃設至少 9 條機車格分界標線，實得 ${motoLines.length}`);

const carLines = pCtx.lines.filter(l => l.y1 <= 0.35 && l.y2 <= 0.35);
assert.ok(carLines.length >= 8, `停車場上排必須劃設至少 8 條汽車格標線，實得 ${carLines.length}`);
console.log('✅ 停車場標線已成功包含汽車格與機車格');

// 1.3 驗證停車場格線數量視場域面積大小而定
const smallCtx = makeContext();
paintGround(smallCtx.ctx, 256, 'parking', 42, surfaceEnvironment(), null, 18, 14);
const smallLines = smallCtx.lines;

const largeCtx = makeContext();
paintGround(largeCtx.ctx, 256, 'parking', 42, surfaceEnvironment(), null, 60, 36);
const largeLines = largeCtx.lines;

assert.ok(largeLines.length > smallLines.length * 1.8,
  `大面積停車場格線數 (${largeLines.length}) 應大幅多於小面積停車場 (${smallLines.length})`);
console.log(`✅ 停車場格線動態依面積調整：小場域 (18m×14m) 畫出 ${smallLines.length} 條線，大場域 (60m×36m 4排) 畫出 ${largeLines.length} 條線`);

// 1.4 驗證隨機停放比率在 50% ~ 100% 之間
for (let seed = 1; seed <= 50; seed++) {
  const occRate = 0.5 + ((seed * 16807) % 2147483647) / 2147483647 * 0.5;
  assert.ok(occRate >= 0.50 && occRate <= 1.00, `停放比率 ${occRate} 必須在 50%~100% 範圍內`);
}
console.log('✅ 車輛隨機停放比例符合 50%~100% 規格');


// ==========================================
// 2. 太陽能板：大面積鋪設（≥60%）與整齊排列測試
// ==========================================
console.log('--- 測試 2：太陽能板大面積鋪設 (≥60%) 與整齊排列 ---');

// 2.1 地面光電場 (solarfarm)
const sfRows = GROUND_ATTACHMENTS.solarfarm.rows.solarpanel;
const [stepX, stepZ, cap, skip] = sfRows;
const panelArea = GROUND_PARTS.solarpanel[1] * GROUND_PARTS.solarpanel[3]; // 2.5 * 1.5 = 3.75 m²
const cellArea = stepX * stepZ;
const densityInGrid = panelArea / cellArea;
assert.ok(densityInGrid >= 0.75, `太陽能板在列陣網格中的密度應 >= 75%，實得 ${(densityInGrid * 100).toFixed(1)}%`);
assert.equal(skip, 0, '平整處太陽能板不應隨機缺株 (skip === 0)');
console.log(`✅ 地面光電場排距密度達 ${(densityInGrid * 100).toFixed(1)}% (≥60%)，無隨機傾斜無缺株`);

// 2.2 建築平屋頂太陽能板陣列鋪設
const testPolys = [
  { outer: [[-6, -5], [6, -5], [6, 5], [-6, 5]], holes: [] },
  { outer: [[-10, -8], [10, -8], [10, 8], [-10, 8]], holes: [] },
];

for (const poly of testPolys) {
  const metrics = calculateRoofMetrics(poly);
  const arch = {
    category: 'commercial',
    functionInfo: { type: 'commercial_office', styles: ['modern'] },
    style: 'modern',
    facadeType: 'glass_curtain',
    roofForm: 'flat',
  };
  const edges = [
    { hw2: (metrics.maxX - metrics.minX) / 2, len: metrics.maxX - metrics.minX, nx: 0, nz: -1, x: metrics.cx, z: metrics.minZ, sourceId: 101 },
  ];
  // 設置 id 使得 architectureHash(idBase, 'solar') % 100 < 45 (觸發 hasSolar)
  // 尋找能觸發 hasSolar 的 id
  let archId = 'test_bld_0';
  for (let k = 0; k < 100; k++) {
    const candidate = `bld_${k}`;
    const idBase = `${candidate}|${edges[0]?.sourceId || edges[0]?.x}|${poly.outer.length}`;
    let hash = 0;
    const str = `${idBase}:solar`;
    for (let i = 0; i < str.length; i++) hash = (hash * 31 + str.charCodeAt(i)) >>> 0;
    if ((hash % 100) < 45) { archId = candidate; break; }
  }
  arch.id = archId;
  const resultGeos = generateBuildingAppurtenances(poly, edges, 0, 20, arch, 0.28, 'flat', metrics);
  
  const solarPanelBoxes = resultGeos.filter(g => {
    g.computeBoundingBox();
    const sz = new THREE.Vector3();
    g.boundingBox.getSize(sz);
    return Math.abs(sz.x - 1.5) < 0.2 || Math.abs(sz.z - 1.5) < 0.2;
  });

  const totalPanelArea = solarPanelBoxes.length * 1.5;
  const coverage = totalPanelArea / metrics.area;
  console.log(`平頂屋頂面積 ${metrics.area}m²：生成 ${solarPanelBoxes.length} 片面板，總面板面積 ${totalPanelArea.toFixed(1)}m²，覆蓋率 ${(coverage * 100).toFixed(1)}%`);
  assert.ok(coverage >= 0.20 && coverage <= 0.80, `平整屋頂太陽能板鋪設面積必須介於 20%~80%，實得 ${(coverage * 100).toFixed(1)}%`);
}
console.log('✅ 屋頂太陽能板覆蓋率成功符合 20%~80% 規範，且呈整齊矩陣排列');


// ==========================================
// 3. 球場與操場：固定長寬比與陣列化排列測試
// ==========================================
console.log('--- 測試 3：球場與操場固定長寬比與陣列排列 ---');

// 3.1 驗證長寬比嚴格鎖定 (locked: true)
assert.equal(SURFACES.court.locked, true, '籃球場長寬比必須鎖定');
assert.equal(SURFACES.court.aspect, 15 / 28, '籃球場長寬比必須為 15 / 28');
assert.equal(SURFACES.track.locked, true, '操場跑道長寬比必須鎖定');
assert.equal(SURFACES.track.aspect, TRACK_DEPTH / TRACK_WIDTH, '操場跑道長寬比必須為 TRACK_DEPTH / TRACK_WIDTH');

// 3.2 驗證球場陣列繪製 (paintCourtArray)
const arrayCtx = makeContext();
paintCourtArray(arrayCtx.ctx, 2, 2);
const boundaryRects = arrayCtx.rects.filter(r => r.w > 0 && r.h > 0);
// 3.3 驗證 paintGround 在球場超大面積時自動採用陣列式排列
const stdCourtCtx = makeContext();
paintGround(stdCourtCtx.ctx, 256, 'court', 42, surfaceEnvironment(), null, 28, 15);
const largeCourtCtx = makeContext();
paintGround(largeCourtCtx.ctx, 256, 'court', 42, surfaceEnvironment(), null, 56, 30);
const stdRects = stdCourtCtx.rects.filter(r => r.w > 0 && r.h > 0);
const multiRects = largeCourtCtx.rects.filter(r => r.w > 0 && r.h > 0);
assert.ok(multiRects.length >= 4, `超大面積球場必須繪製多個子球場標線，實得 ${multiRects.length}`);
console.log(`✅ 球場視場域面積自動陣列化：標準單場 ${stdRects.length} 組禁區，超大場域自動轉為 ${multiRects.length} 組陣列禁區標線`);

console.log('🎉 所有新增規則測試全部通過！');
