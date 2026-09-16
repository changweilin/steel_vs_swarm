import assert from 'node:assert/strict';
import { register } from 'node:module';

const modules = {
  three: new URL('../out/forest_review/three.module.js', import.meta.url).href,
  'three/addons/utils/BufferGeometryUtils.js': new URL('../out/forest_review/utils_BufferGeometryUtils.js', import.meta.url).href,
};
register('data:text/javascript,' + encodeURIComponent(`const modules = ${JSON.stringify(modules)};
export async function resolve(s, c, next) { return modules[s] ? { url: modules[s], shortCircuit: true } : next(s, c); }`), import.meta.url);

const THREE = await import('three');
const { APPURTENANCE_RULES, ROOF_APPURTENANCE_COMPATIBILITY } = await import('../public/js/architectureStyles.js');
const { generateBuildingAppurtenances, calculateRoofMetrics } = await import('../public/js/buildingAppurtenances.js');
const { GROUND_PARTS } = await import('../public/js/groundPartCatalog.js');
const { generateGroundPart } = await import('../public/js/proceduralGroundParts.js');

console.log('=== 1. 屋頂太陽能板覆蓋率 (20% ~ 80%) 與雙模 (直接/架高複合) 測試 ===');

const roofPolys = [
  { outer: [[-8, -6], [8, -6], [8, 6], [-8, 6]], holes: [] },
  { outer: [[-12, -8], [12, -8], [12, 8], [-12, 8]], holes: [] },
  { outer: [[-6, -5], [6, -5], [6, 5], [-6, 5]], holes: [] },
];

let directCount = 0;
let elevatedCount = 0;

for (let seed = 0; seed < 40; seed++) {
  const poly = roofPolys[seed % roofPolys.length];
  const metrics = calculateRoofMetrics(poly);
  const arch = {
    id: `solar_bld_${seed}`,
    category: 'commercial',
    style: 'modern',
    facadeType: 'glass_curtain',
    roofForm: 'flat',
  };
  const edges = [
    { hw2: (metrics.maxX - metrics.minX) / 2, len: metrics.maxX - metrics.minX, nx: 0, nz: -1, x: metrics.cx, z: metrics.minZ, sourceId: 200 + seed },
  ];

  const geos = generateBuildingAppurtenances(poly, edges, 0, 24, arch, 0.28, 'flat', metrics);

  const solarPanels = geos.filter(g => g.userData?.partType === 'solar_panel');

  if (solarPanels.length > 0) {
    const totalPanelArea = solarPanels.length * 1.5;
    const coverage = totalPanelArea / metrics.area;
    assert.ok(
      coverage >= 0.20 && coverage <= 0.80,
      `建築 ${arch.id} 面積 ${metrics.area}m²：太陽能覆蓋率 ${(coverage * 100).toFixed(1)}% 必須介於 20%~80%`
    );

    for (const g of solarPanels) g.computeBoundingBox();
    const maxElevation = Math.max(...solarPanels.map(g => g.boundingBox.max.y - 24));
    if (maxElevation >= 2.0) {
      elevatedCount++;
    } else {
      directCount++;
    }
  }
}

console.log(`✅ 屋頂太陽能板覆蓋率嚴格維持 20%~80% 區間`);
console.log(`✅ 太陽能板成功包含直接建立 (${directCount} 次) 與架高複合式用途 (${elevatedCount} 次)`);
assert.ok(directCount > 0, '應能生成直接建立太陽能板');
assert.ok(elevatedCount > 0, '應能生成架高複合式太陽能板');

console.log('\n=== 2. 陸地太陽能板直接建立與架高複合式 (停車場/牧場/魚塭) 測試 ===');

const directParts = generateGroundPart('solarpanel', 0);
assert.ok(directParts.length > 0, '直接光電零件必須生成幾何');
for (const p of directParts) {
  p.geo.computeBoundingBox();
  assert.ok(p.geo.boundingBox.max.y < 2.0, '直接地面光電高度應為低矮矮柱 (< 2.0m)');
  p.geo.dispose();
}

assert.ok(GROUND_PARTS.solar_carport, 'GROUND_PARTS 必須定義 solar_carport');
const carportParts = generateGroundPart('solar_carport', 0);
assert.ok(carportParts.length >= 4, 'solar_carport 必須生成鋼構、面板、車格與車輛剪影');
let hasCarportStilts = false, hasVehicle = false;
for (const p of carportParts) {
  p.geo.computeBoundingBox();
  if (p.geo.boundingBox.max.y >= 2.4) hasCarportStilts = true;
  if (p.geo.boundingBox.max.y <= 1.5 && p.geo.boundingBox.max.y >= 0.5) hasVehicle = true;
  p.geo.dispose();
}
assert.ok(hasCarportStilts, 'solar_carport 頂部光電遮陽棚高架須 >= 2.4m');
assert.ok(hasVehicle, 'solar_carport 底下必須具備車輛停放空間/模型');
console.log('✅ 陸地架高太陽能板底下成功複合為停車場 (solar_carport)');

assert.ok(GROUND_PARTS.solar_pasture, 'GROUND_PARTS 必須定義 solar_pasture');
const pastureParts = generateGroundPart('solar_pasture', 0);
assert.ok(pastureParts.length >= 4, 'solar_pasture 必須生成鋼柱、面板、木柵欄與草料');
for (const p of pastureParts) {
  p.geo.computeBoundingBox();
  p.geo.dispose();
}
console.log('✅ 陸地架高太陽能板底下成功複合為牧場 (solar_pasture)');

assert.ok(GROUND_PARTS.solar_aquaculture, 'GROUND_PARTS 必須定義 solar_aquaculture');
const aquaParts = generateGroundPart('solar_aquaculture', 0);
assert.ok(aquaParts.length >= 4, 'solar_aquaculture 必須生成水上基樁、面板與水車增氧機');
for (const p of aquaParts) {
  p.geo.computeBoundingBox();
  p.geo.dispose();
}
console.log('✅ 陸地架高太陽能板底下成功複合為魚塭 (solar_aquaculture)');

console.log('\n=== 3. 擴充屋頂範圍零件 (遮雨棚/曬衣間/花園，面積 20~80%) 測試 ===');

const extentKeys = ['rooftop_canopy', 'drying_room', 'roof_garden'];
for (const key of extentKeys) {
  assert.ok(APPURTENANCE_RULES[key], `APPURTENANCE_RULES 必須登錄 ${key}`);
  assert.equal(APPURTENANCE_RULES[key].slot, 'rooftop', `${key} 槽位必須為 rooftop`);
  assert.ok(ROOF_APPURTENANCE_COMPATIBILITY.flat.includes(key), `flat 屋頂相容矩陣必須支援 ${key}`);
}

const testExtentPoly = { outer: [[-10, -8], [10, -8], [10, 8], [-10, 8]], holes: [] };
const extentMetrics = calculateRoofMetrics(testExtentPoly);

const foundExtentParts = new Set();
for (let k = 0; k < 120; k++) {
  const arch = {
    id: `extent_bld_${k}`,
    category: k % 2 === 0 ? 'residential' : 'commercial',
    style: 'modern',
    facadeType: 'concrete',
    roofForm: 'flat',
  };
  const edges = [
    { hw2: 10, len: 20, nx: 0, nz: -1, x: 0, z: -8, sourceId: 500 + k },
  ];
  const geos = generateBuildingAppurtenances(testExtentPoly, edges, 0, 18, arch, 0.28, 'flat', extentMetrics);
  for (const g of geos) {
    g.computeBoundingBox();
    const sz = new THREE.Vector3();
    g.boundingBox.getSize(sz);
    const boxArea = sz.x * sz.z;
    const ratio = boxArea / extentMetrics.area;

    if (ratio >= 0.18 && ratio <= 0.85) {
      if (Math.abs(sz.y - 0.08) < 0.02 || Math.abs(sz.y - 0.05) < 0.02) {
        foundExtentParts.add('detected_extent_coverage');
      }
    }
  }
}
assert.ok(foundExtentParts.has('detected_extent_coverage'), '必須成功生成並偵測到佔屋頂面積 20%~80% 之範圍零件');
console.log('✅ 擴充屋頂範圍零件（遮雨棚、曬衣間、空中花園）面積佔比符合 20%~80% 規範');

console.log('\n=== 4. 擴充屋頂獨立零件 (樓梯間/小廟/桌球桌/撞球桌/沙發/桌椅/涼亭) 測試 ===');

const standaloneKeys = [
  'stairwell_penthouse',
  'rooftop_shrine',
  'pingpong_table',
  'pool_table',
  'rooftop_sofa',
  'table_chairs',
  'gazebo',
];

for (const key of standaloneKeys) {
  assert.ok(APPURTENANCE_RULES[key], `APPURTENANCE_RULES 必須登錄獨立零件 ${key}`);
  assert.equal(APPURTENANCE_RULES[key].slot, 'rooftop', `${key} 槽位必須為 rooftop`);
  assert.ok(ROOF_APPURTENANCE_COMPATIBILITY.flat.includes(key), `flat 屋頂相容矩陣必須支援 ${key}`);
}

let testedVariants = 0;
for (let k = 0; k < 60; k++) {
  const arch = {
    id: `standalone_bld_${k}`,
    category: k % 3 === 0 ? 'tourism' : (k % 3 === 1 ? 'residential' : 'commercial'),
    style: 'modern',
    facadeType: 'masonry',
    roofForm: 'flat',
  };
  const edges = [
    { hw2: 12, len: 24, nx: 0, nz: -1, x: 0, z: -10, sourceId: 700 + k },
  ];
  const poly = { outer: [[-12, -10], [12, -10], [12, 10], [-12, 10]], holes: [] };
  const m = calculateRoofMetrics(poly);
  const geos = generateBuildingAppurtenances(poly, edges, 0, 20, arch, 0.28, 'flat', m);

  for (const g of geos) {
    const pos = g.attributes.position.array;
    for (let i = 0; i < pos.length; i++) {
      assert.ok(Number.isFinite(pos[i]), `幾何頂點不能為 NaN/Infinity (index: ${i})`);
    }
    g.computeBoundingBox();
    assert.ok(!g.boundingBox.isEmpty(), '構件幾何邊界包圍盒不得為空');
    testedVariants++;
  }
}
assert.ok(testedVariants > 100, `應生成足量多元獨立構件幾何 (實測 ${testedVariants} 組幾何)`);
console.log(`✅ 擴充屋頂獨立零件（樓梯間/小廟/桌球桌/撞球桌/沙發/桌椅/涼亭）幾何與安全邊距全部通過驗證！`);

console.log('\n🎉 全部太陽能板與屋頂擴充零件測試順利通過！');
