import assert from 'node:assert/strict';
import { register } from 'node:module';
import { pathToFileURL } from 'node:url';
import {
  chooseArchitecture, createArchitecturePlanner, detectCulturalRegion,
  inferBuildingFunction, sampleBuildingHeight,
} from '../public/js/buildingDiversity.js';
import {
  ARCHITECTURE_STYLES, ARCHITECTURE_PROFILES, CULTURAL_REGIONS,
  ROOF_FORMS, FACADE_TYPES, BUILDING_FUNCTION_RANGES, CULTURAL_AFFINITY_RATIO,
  APPURTENANCE_RULES, calculateFootprintMetrics, ROOF_APPURTENANCE_COMPATIBILITY,
  resolveAdaptiveRoofForm, distanceToPolyBoundary, isSiteValid, computeOrientedRoofFrame,
} from '../public/js/architectureStyles.js';

// 1. 基礎地形情境比例驗證（無文化區域指定時維持原分佈）
const contexts = { urban: { urban: true }, rural: { rural: true }, plain: {}, hillside: { slope: 24, urban: true } };
for (const [profile, context] of Object.entries(contexts)) {
  const counts = {};
  const count = 12000;
  for (let i = 0; i < count; i++) {
    const result = chooseArchitecture(9182, i, context);
    assert.equal(result.profile, profile);
    counts[result.id] = (counts[result.id] || 0) + 1;
    if (i < 10) assert.deepEqual(result, chooseArchitecture(9182, i, context));
  }
  const total = Object.values(ARCHITECTURE_PROFILES[profile]).reduce((a, b) => a + b, 0);
  for (const [id, weight] of Object.entries(ARCHITECTURE_PROFILES[profile])) {
    assert.ok(Math.abs(counts[id] / count - weight / total) < 0.02, `${profile}:${id} 比例偏離`);
  }
  console.log(profile, counts);
}
assert.ok(Array.from({ length: 100 }, (_, i) => chooseArchitecture(1, i).id !== chooseArchitecture(2, i).id).filter(Boolean).length > 60);

// 2. 世界文化區域判定與 60% 文化風格比例驗證
assert.equal(detectCulturalRegion({ country: 'TW' }), 'east_asia');
assert.equal(detectCulturalRegion({ country: 'JP' }), 'japan');
assert.equal(detectCulturalRegion({ country: 'FR' }), 'europe_west');
assert.equal(detectCulturalRegion({ country: 'US' }), 'americas');
assert.equal(detectCulturalRegion({ country: 'EG' }), 'middle_east');
assert.equal(detectCulturalRegion({ lat: 25.03, lon: 121.56 }), 'east_asia'); // 台北
assert.equal(detectCulturalRegion({ lat: 48.85, lon: 2.29 }), 'europe_west'); // 巴黎
assert.equal(detectCulturalRegion({ lat: 30.04, lon: 31.23 }), 'middle_east'); // 開羅

const culturalTestCases = [
  { region: 'east_asia', country: 'TW' },
  { region: 'europe_west', country: 'FR' },
  { region: 'middle_east', country: 'EG' },
  { region: 'americas', country: 'US' },
];
for (const tc of culturalTestCases) {
  const counts = {};
  const count = 10000;
  for (let i = 0; i < count; i++) {
    const res = chooseArchitecture(7788, i, { ...tc, urban: true });
    counts[res.id] = (counts[res.id] || 0) + 1;
  }
  const matchingStyles = new Set(CULTURAL_REGIONS[tc.region].styles);
  let matchedCount = 0;
  for (const [id, c] of Object.entries(counts)) {
    if (matchingStyles.has(id)) matchedCount += c;
  }
  const ratio = matchedCount / count;
  assert.ok(Math.abs(ratio - CULTURAL_AFFINITY_RATIO) < 0.02, `${tc.region} 文化匹配比例偏離 60%（實際 ${ratio}）`);
  console.log(`文化圈 ${tc.region} 匹配比例: ${(ratio * 100).toFixed(1)}%`);
}

// 3. 地點與功能分類推導驗證
const skyscraper = inferBuildingFunction({ tags: { building: 'commercial', 'building:levels': '20' } });
assert.equal(skyscraper.key, 'commercial_skyscraper');

const office = inferBuildingFunction({ tags: { building: 'office' } });
assert.equal(office.key, 'commercial_office');

const retail = inferBuildingFunction({ tags: { building: 'retail', shop: 'supermarket' }, w: 30, d: 25 });
assert.equal(retail.key, 'commercial_retail');

const factory = inferBuildingFunction({ tags: { building: 'industrial' } });
assert.equal(factory.key, 'industrial_factory');

const warehouse = inferBuildingFunction({ tags: { building: 'warehouse' } });
assert.equal(warehouse.key, 'industrial_warehouse');

const power = inferBuildingFunction({ tags: { power: 'substation' } });
assert.equal(power.key, 'industrial_power');

const apt = inferBuildingFunction({ tags: { building: 'apartments' } });
assert.equal(apt.key, 'residential_apartment');

const townhouse = inferBuildingFunction({ tags: { building: 'house' } }, null, { urban: false });
assert.equal(townhouse.key, 'residential_townhouse');

const alley = inferBuildingFunction({ tags: { building: 'house' } }, null, { elongated: true, density: 25 });
assert.equal(alley.key, 'residential_alley');

const farm = inferBuildingFunction({ tags: { building: 'farm' } }, null, { rural: true });
assert.equal(farm.key, 'rural_farmhouse');

const greenhouse = inferBuildingFunction({ tags: { building: 'greenhouse' } });
assert.equal(greenhouse.key, 'rural_greenhouse');

const visitor = inferBuildingFunction({ tags: { tourism: 'visitor_center' } });
assert.equal(visitor.key, 'tourism_visitor');

const cultural = inferBuildingFunction({ tags: { building: 'museum', tourism: 'museum' } });
assert.equal(cultural.key, 'tourism_cultural');

// 4. 樓層高度與層數隨機範圍驗證（先拉伸後渲染）
for (const [key, range] of Object.entries(BUILDING_FUNCTION_RANGES)) {
  for (let i = 0; i < 50; i++) {
    const h = sampleBuildingHeight(key, 999, `test_${key}_${i}`);
    assert.ok(h.height >= range.minH && h.height <= range.maxH, `${key} 高度超出範圍: ${h.height}`);
    assert.ok(h.levels >= range.levels[0] && h.levels <= range.levels[1], `${key} 層數超出範圍: ${h.levels}`);
  }
}

// 5. 屋頂造型與外牆材質枚舉完整性
assert.ok(Object.keys(ROOF_FORMS).length >= 19);
for (const style of Object.values(ARCHITECTURE_STYLES)) assert.ok(ROOF_FORMS[style.roofForm], style.roofForm);
assert.ok(Object.keys(FACADE_TYPES).length >= 10);
for (const style of Object.values(ARCHITECTURE_STYLES)) {
  assert.ok(style.label && style.wall && style.roof, `${style.label} 基本屬性缺項`);
}

// 6. 外部零件規則與槽位完整性驗證 (24 款外部構件，含鐘樓、尖塔、直升機棚與空間容量保護)
const expectedSlots = new Set(['rooftop', 'ground_front', 'side_ground', 'facade']);
for (const [key, rule] of Object.entries(APPURTENANCE_RULES)) {
  assert.ok(expectedSlots.has(rule.slot), `${key} 槽位無效: ${rule.slot}`);
  assert.ok(rule.categories && rule.categories.length > 0, `${key} 未設定適用類別`);
  assert.ok(rule.maxCount >= 1 && rule.prob > 0 && rule.prob <= 1.0, `${key} 數量或機率非法`);
}
assert.equal(Object.keys(APPURTENANCE_RULES).length, 24, '外部零件種類需為 24 款');
assert.ok(APPURTENANCE_RULES.clock_tower.minArea >= 150 && APPURTENANCE_RULES.clock_tower.minSpan >= 10, '鐘樓需有屋頂面積與跨度限制');
assert.ok(APPURTENANCE_RULES.rooftop_spire.minArea >= 100 && APPURTENANCE_RULES.rooftop_spire.minSpan >= 10, '尖塔需有屋頂面積與跨度限制');
assert.ok(APPURTENANCE_RULES.heli_hangar.minArea >= 500 && APPURTENANCE_RULES.heli_hangar.minSpan >= 20, '停機坪直升機棚需有高面積與大跨度限制');

// 7. OSM 圖資幾何量測指標、自適應屋頂決議 (防止失真扭曲) 與屋頂零件相容矩陣
const testPoly = { outer: [[0, 0], [20, 0], [20, 10], [0, 10]], holes: [] };
const polyMetrics = calculateFootprintMetrics(testPoly);
assert.equal(polyMetrics.width, 20);
assert.equal(polyMetrics.depth, 10);
assert.equal(polyMetrics.span, 10);
assert.equal(polyMetrics.aspect, 2.0);
assert.equal(polyMetrics.area, 200);
assert.equal(polyMetrics.cx, 10);
assert.equal(polyMetrics.cz, 5);

// 驗證屋頂主軸方向性與旋轉包圍框 (computeOrientedRoofFrame)
const frameHoriz = computeOrientedRoofFrame(testPoly);
assert.equal(frameHoriz.len, 20, '水平長方形長度');
assert.equal(frameHoriz.span, 10, '水平長方形跨度');
assert.equal(frameHoriz.angle, 0, '水平長方形主軸角度應為 0');

const vertPoly = { outer: [[0, 0], [10, 0], [10, 25], [0, 25]], holes: [] };
const frameVert = computeOrientedRoofFrame(vertPoly);
assert.equal(frameVert.len, 25, '垂直長方形長度');
assert.equal(frameVert.span, 10, '垂直長方形跨度');
assert.ok(Math.abs(frameVert.angle - Math.PI / 2) < 1e-4, '垂直長方形主軸角度應為 PI/2');

// 旋轉 30 度長方形驗證
const cos30 = Math.cos(Math.PI / 6), sin30 = Math.sin(Math.PI / 6);
const rotPoly = { outer: testPoly.outer.map(([x, z]) => [x * cos30 - z * sin30, x * sin30 + z * cos30]), holes: [] };
const frameRot = computeOrientedRoofFrame(rotPoly);
assert.ok(Math.abs(frameRot.len - 20) < 1e-3, '旋轉長方形長度不變');
assert.ok(Math.abs(frameRot.span - 10) < 1e-3, '旋轉長方形跨度不變');
assert.ok(Math.abs(frameRot.angle - Math.PI / 6) < 1e-3, '旋轉長方形主軸角度應與建物邊界同調 (30度)');

// 凹多邊形（如 L 型）應回傳 null 保持平頂降級安全
const lPoly = { outer: [[0, 0], [20, 0], [20, 5], [5, 5], [5, 20], [0, 20]], holes: [] };
assert.equal(computeOrientedRoofFrame(lPoly), null, '凹多邊形安全降級為平頂 (null)');

// 驗證邊界留白與壓線保護演算法 (distanceToPolyBoundary & isSiteValid)
assert.equal(distanceToPolyBoundary(10, 5, testPoly), 5.0, '矩形幾何中心淨距');
assert.equal(distanceToPolyBoundary(2, 5, testPoly), 2.0, '靠邊緣點淨距');
assert.equal(distanceToPolyBoundary(25, 5, testPoly), 0, '多邊形外點淨距為 0');
// 構件半徑 1.5m + 留白 0.8m = 2.3m，於淨距 2.0m 處應被拒絕以防壓線
assert.equal(isSiteValid(testPoly, 2, 5, 1.5, 0.8), false, '壓線危險區位應判定無效');
// 於淨距 5.0m 處則有效
assert.equal(isSiteValid(testPoly, 10, 5, 1.5, 0.8), true, '內部安全留白區位應判定有效');

// 所有登錄屋頂均需明確定義零件相容性。
for (const id of Object.keys(ROOF_FORMS)) assert.ok(Object.hasOwn(ROOF_APPURTENANCE_COMPATIBILITY, id), `${id} 缺少屋頂零件相容性`);
const allRooftopParts = [
  'water_tank', 'antenna', 'cellular_mast', 'solar_array',
  'pigeon_coop', 'chimney', 'roof_billboard', 'clock_tower',
  'rooftop_spire', 'heli_hangar',
];
for (const part of allRooftopParts) {
  assert.ok(ROOF_APPURTENANCE_COMPATIBILITY.flat.includes(part), `平頂應相容 ${part}`);
  assert.ok(ROOF_APPURTENANCE_COMPATIBILITY.stepped.includes(part), `階梯頂應相容 ${part}`);
}
// 驗證水平屋頂專屬零件（只能放在屋頂水平／平整處）：在所有非水平屋面上嚴禁放置
const horizontalOnlyParts = ['water_tank', 'heli_hangar', 'roof_billboard', 'cellular_mast', 'pigeon_coop'];
for (const form of Object.keys(ROOF_APPURTENANCE_COMPATIBILITY)) {
  if (form === 'flat' || form === 'stepped') {
    for (const part of horizontalOnlyParts) {
      assert.ok(ROOF_APPURTENANCE_COMPATIBILITY[form].includes(part), `${form} 應相容水平零件 ${part}`);
    }
  } else {
    for (const part of horizontalOnlyParts) {
      assert.ok(!ROOF_APPURTENANCE_COMPATIBILITY[form].includes(part), `非水平屋頂 ${form} 嚴禁放置 ${part}`);
    }
  }
}

// 驗證自適應屋頂防扭曲決議 (resolveAdaptiveRoofForm)
// (a) 高層摩天大樓 (height >= 35m) 降級至 stepped 或 flat
assert.equal(resolveAdaptiveRoofForm('xieshan', polyMetrics, 42, 'commercial'), 'stepped');
assert.equal(resolveAdaptiveRoofForm('wudian', polyMetrics, 50, 'commercial'), 'stepped');
assert.equal(resolveAdaptiveRoofForm('dome', polyMetrics, 38, 'civic'), 'stepped');

// (b) 巨型面積/跨度建築 (area >= 750 或 span >= 28) 避免單體大斜頂扭曲
const giantMetrics = { area: 850, span: 30, aspect: 1.2 };
assert.equal(resolveAdaptiveRoofForm('wudian', giantMetrics, 12, 'commercial'), 'stepped');
assert.equal(resolveAdaptiveRoofForm('wudian', { area: 850, span: 30, aspect: 2.5 }, 12, 'commercial'), 'flat');
assert.equal(resolveAdaptiveRoofForm('shed', giantMetrics, 12, 'industrial'), 'sawtooth');

// (c) 狹長型建物 (aspect > 2.6) 避免圓頂/廡殿/歇山/尖塔扭曲，改為沿長軸的雙坡/硬山
const elongatedMetrics = { area: 120, span: 4.0, aspect: 3.2 };
assert.equal(resolveAdaptiveRoofForm('dome', elongatedMetrics, 8, 'residential'), 'gable');
assert.equal(resolveAdaptiveRoofForm('wudian', elongatedMetrics, 8, 'residential'), 'yingshan');
assert.equal(resolveAdaptiveRoofForm('xieshan', elongatedMetrics, 8, 'residential'), 'yingshan');
assert.equal(resolveAdaptiveRoofForm('spire', elongatedMetrics, 8, 'industrial'), 'sawtooth');

// (d) 超微型建築 (span < 2.5 或 area < 15) 避免複雜歇山/重簷
const tinyMetrics = { area: 12, span: 2.0, aspect: 1.1 };
assert.equal(resolveAdaptiveRoofForm('xieshan', tinyMetrics, 6, 'residential'), 'shed');
assert.equal(resolveAdaptiveRoofForm('tiered', tinyMetrics, 6, 'residential'), 'shed');

// (e) 比例正常適中之建築保留原請求屋頂造型
const normalMetrics = { area: 240, span: 12, aspect: 1.3 };
assert.equal(resolveAdaptiveRoofForm('wudian', normalMetrics, 14, 'tourism'), 'wudian');
assert.equal(resolveAdaptiveRoofForm('xieshan', normalMetrics, 14, 'tourism'), 'xieshan');
assert.equal(resolveAdaptiveRoofForm('dome', normalMetrics, 14, 'tourism'), 'dome');

// 8. 3D 幾何整合測試（若環境有 THREE_MODULE 與 THREE_BUFFER_UTILS 則執行）
if (process.env.THREE_MODULE && process.env.THREE_BUFFER_UTILS) {
  const modules = {
    three: pathToFileURL(process.env.THREE_MODULE).href,
    'three/addons/utils/BufferGeometryUtils.js': pathToFileURL(process.env.THREE_BUFFER_UTILS).href,
  };
  register('data:text/javascript,' + encodeURIComponent(`
    const modules = ${JSON.stringify(modules)};
    export async function resolve(specifier, context, next) {
      return modules[specifier] ? { url: modules[specifier], shortCircuit: true } : next(specifier, context);
    }
  `), import.meta.url);

  const THREE = await import('three');
  const { buildOsmPolygonBuildings } = await import('../public/js/osmBuilding.js');
  const { sceneObjectMat } = await import('../public/js/toon.js');
  const polygons = [
    { outer: [[0, 0], [24, 0], [24, 18], [0, 18]], holes: [] },
    { outer: [[0, 0], [24, 0], [24, 6], [6, 6], [6, 18], [0, 18]], holes: [] },
    { outer: [[0, 0], [24, 0], [24, 24], [0, 24]], holes: [[[8, 8], [16, 8], [16, 16], [8, 16]]] },
  ];
  const areas = polygons.map((poly, i) => ({
    sourceId: `test/${i}`, centroid: { x: 4, z: 4 },
    tags: { building: 'house', height: '10' },
    classification: { kind: 'house', generator: 'polygonBuilding' },
    worldPolygons: [poly],
  }));
  const terrain = { heightAt: () => 0 };
  const base = buildOsmPolygonBuildings(new THREE.Group(), areas, { terrain });
  const signatures = new Set();
  for (const [id, row] of Object.entries(ARCHITECTURE_STYLES)) {
    const group = new THREE.Group();
    const result = buildOsmPolygonBuildings(group, areas, {
      terrain, architectureOf: () => ({ ...row, id, profile: 'plain', variant: 1 }),
      materialOf: () => ({ wall: sceneObjectMat(0xffffff, { vertexColors: true }), roof: sceneObjectMat(0xffffff, { vertexColors: true }) }),
    });
    assert.deepEqual(result.blockers, base.blockers);
    assert.deepEqual(result.platforms, base.platforms);
    assert.equal(result.architectureCounts[`plain:${id}`], 3);
    let vertices = 0;
    for (const mesh of group.children) {
      assert.ok(mesh.geometry);
      assert.ok(mesh.geometry.attributes.position.array.every(Number.isFinite));
      assert.equal(mesh.geometry.attributes.color.count, mesh.geometry.attributes.position.count);
      vertices += mesh.geometry.attributes.position.count;
    }
    signatures.add(vertices);
    assert.equal(group.children.length, 3, '文化混搭不增加每用途批次數');
  }
  assert.ok(signatures.size >= 6, '文化差異包含幾何，不能只有換色');
  const farmland = { sourceId: 'land/1', tags: { landuse: 'farmland' }, worldPolygons: [polygons[0]] };
  const planner = createArchitecturePlanner({ areas: [...areas, farmland], terrain, seed: 9 });
  assert.equal(planner(areas[0], polygons[0]).profile, 'rural');
  const reversed = createArchitecturePlanner({ areas: [farmland, ...areas].reverse(), terrain, seed: 9 });
  assert.deepEqual(planner(areas[0], polygons[0]), reversed(areas[0], polygons[0]));
  const slopePlanner = createArchitecturePlanner({ areas, terrain: { heightAt: x => x * 0.4 }, seed: 9 });
  assert.equal(slopePlanner(areas[0], polygons[0]).profile, 'hillside');
}

console.log('通過：地點功能分類、隨機樓高範圍、60%在地文化加權、屋頂與牆面登錄完整性、地形比例、凹輪廓／中庭與碰撞不變');
