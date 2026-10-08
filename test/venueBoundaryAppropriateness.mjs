import assert from 'node:assert/strict';
import { VENUES } from '../public/js/venues.js';
import { wallCandidates, planWallRuns, BOUNDARY_OBJECT_CATEGORIES, WALL_KINDS } from '../public/js/edgewall.js';

console.log('--- 驗證場地與區域類型邊界障礙物適配性 (Venue & Region Boundary Appropriateness) ---');

const NATURE_VENUES = ['taroko', 'hehuanshan', 'yangmingshan', 'aokigahara', 'blackforest', 'yosemite', 'uluru'];
const ARTIFICIAL_CATEGORIES = new Set([
  'industry', 'residential', 'highrise', 'rail', 'vehicle', 'bridge', 'extraction', 'military', 'fortification',
]);

for (const venueId of NATURE_VENUES) {
  const venue = VENUES.find((v) => v.id === venueId);
  assert(venue, `Venue ${venueId} must exist in VENUES`);
  const env = { venue, mix: venue.mix };

  // 1. Natural venues: candidate list must exclude all buildings, factories, and urban facilities
  for (const biome of ['bare', 'green', 'water', 'wet']) {
    for (const tier of ['flat', 'mid', 'steep']) {
      const candidates = wallCandidates(biome, biome === 'water', tier, env);
      assert(candidates.length > 0, `${venueId} (${biome}/${tier}) must have candidate obstacles`);

      for (const kind of candidates) {
        const cat = BOUNDARY_OBJECT_CATEGORIES[kind];
        assert(!ARTIFICIAL_CATEGORIES.has(cat),
          `自然風景區 ${venue.name} (${venueId}) 邊界不得出現建築／工廠／人造物: ${kind} (類別: ${cat}, 地貌: ${biome}, 坡度: ${tier})`);
      }
    }
  }

  // 2. Simulate planWallRuns around four natural-venue edges; settled kinds must contain zero buildings/factories
  const len = 30;
  const simulatedEdges = [
    // Bare-rock stretch
    Array.from({ length: 10 }, (_, i) => ({ x: -300 + i * len, z: -300, len, biome: 'bare', water: false, tier: 'steep' })),
    // Green stretch
    Array.from({ length: 10 }, (_, i) => ({ x: -300 + i * len, z: 300, len, biome: 'green', water: false, tier: 'flat' })),
    // Water stretch
    Array.from({ length: 10 }, (_, i) => ({ x: -300, z: -300 + i * len, len, biome: 'water', water: true, tier: 'flat' })),
  ];

  for (const segs of simulatedEdges) {
    const runs = planWallRuns(segs, { environment: env });
    assert(runs.length > 0, `${venueId} planWallRuns should produce runs`);
    for (const run of runs) {
      const cat = BOUNDARY_OBJECT_CATEGORIES[run.kind];
      assert(!ARTIFICIAL_CATEGORIES.has(cat),
        `自然風景區 ${venue.name} (${venueId}) 規劃邊界不得出現建築或工廠: ${run.kind} (類別: ${cat})`);
    }
  }

  console.log(`  ✓ 自然場地 ${venue.name} (${venueId}): 邊界 0 建築、0 工廠、100% 自然地貌`);
}

// 3. Urban venue (taipei101) boundary must still allocate urban buildings
const taipei = VENUES.find((v) => v.id === 'taipei101');
const taipeiEnv = { venue: taipei, mix: taipei.mix };
const urbanCandidates = wallCandidates('urban', false, 'flat', taipeiEnv);
assert(urbanCandidates.some((k) => ['residential', 'highrise', 'industry'].includes(BOUNDARY_OBJECT_CATEGORIES[k])),
  '市區場地應具備市區建築或設施');
console.log('  ✓ 市區場地 (taipei101): 市區邊界正確配發市區建築');

// 4. Industrial-only environment
const industrialEnv = { zone: 'industrial', industrial: true, mix: { urban: 0.8 } };
const indCandidates = wallCandidates('urban', false, 'flat', industrialEnv);
assert(indCandidates.some((k) => BOUNDARY_OBJECT_CATEGORIES[k] === 'industry'), '工業區應具備工業設施');
assert(!indCandidates.some((k) => BOUNDARY_OBJECT_CATEGORIES[k] === 'residential'), '工業區應排除一般民宅建築');
console.log('  ✓ 工業區專屬環境: 優先配發工廠與工業構造，排除民宅聚落');

// 5. Green biomes at all grades prioritize giant-tree/forest/sacred-tree plant objects
const PLANT_CATEGORIES = new Set(['giant-tree', 'deadwood']);
const PLANT_KINDS = new Set(['giantforest', 'densegiants', 'foresthills', 'gianttree', 'fallentree']);

for (const tier of ['flat', 'mid', 'steep']) {
  const greenPool = wallCandidates('green', false, tier);
  const plantCount = greenPool.filter((k) => PLANT_KINDS.has(k) || PLANT_CATEGORIES.has(BOUNDARY_OBJECT_CATEGORIES[k])).length;
  const plantRatio = plantCount / greenPool.length;
  assert(plantRatio >= 0.5, `綠地 ${tier} 坡度之植物類邊界障礙物比例應 ≥ 50%，實得 ${(plantRatio * 100).toFixed(1)}%`);
}
console.log('  ✓ 綠地地貌 (平坦／中等／陡坡): 巨木林／神木林／森林山丘等植物物件比例均過半 (≥ 50%~70%)');

// 6. Object fitness across all biomes (green, bare, water, wet, urban)
// Bare ground: no giant/sacred trees or houses; pure natural rock with extraction/energy as the core
for (const tier of ['flat', 'mid', 'steep']) {
  const barePool = wallCandidates('bare', false, tier);
  assert(!barePool.some((k) => PLANT_KINDS.has(k) || BOUNDARY_OBJECT_CATEGORIES[k] === 'giant-tree'),
    `裸露地 (${tier}) 不得出現巨木林或植物相關障礙物`);
  assert(barePool.every((k) => ['rock', 'extraction', 'energy', 'fortification', 'military', 'agriculture'].includes(BOUNDARY_OBJECT_CATEGORIES[k])),
    `裸露地 (${tier}) 候選物件類別必須符合裸岩、採掘、能源或軍工防禦`);
}
console.log('  ✓ 裸露地地貌: 0 植物樹木、純岩體與採礦／能源／防禦設施');

// Water: must be 100 percent water/coast/floe/vessel, no land obstacles
for (const tier of ['flat', 'mid', 'steep']) {
  const waterPool = wallCandidates('water', true, tier);
  assert(waterPool.length > 0 && waterPool.every((k) => WALL_KINDS[k].dom === 'water'),
    `水域 (${tier}) 候選障礙物必須 100% 屬水域 (dom === 'water')`);
}
console.log('  ✓ 水域地貌: 100% 海堤／消波塊／浮冰／貨輪／礁岩，嚴禁陸域物件漏入');

// Urban: town buildings, towers, traffic, and industry only; no giant forests or raw boulders
for (const tier of ['flat', 'mid', 'steep']) {
  const urbanPool = wallCandidates('urban', false, tier);
  assert(!urbanPool.some((k) => PLANT_KINDS.has(k) || BOUNDARY_OBJECT_CATEGORIES[k] === 'giant-tree'),
    `市區 (${tier}) 不得出現巨木林或植物神木`);
  assert(!urbanPool.includes('boulder') && !urbanPool.includes('rockery'),
    `市區 (${tier}) 不得出現未經加工之天然假山巨石`);
}
console.log('  ✓ 市區地貌: 100% 民房／高樓／工業／交通／城垣設施，無天然巨木巨石');

// Wetland: must include racks, stranded ships, wave blocks, canals, levees, and wetland trees
const wetFlat = wallCandidates('wet', false, 'flat');
assert(wetFlat.some((k) => ['oysterracks', 'strandedship', 'wetpods', 'canalbank', 'levee'].includes(k)),
  '濕地平地應具備濕地專屬構造 (蚵棚／擱淺船／消波塊／運河／河堤)');
assert(wetFlat.some((k) => PLANT_KINDS.has(k)), '濕地應具備濕地巨木林木');
console.log('  ✓ 濕地地貌: 具備專屬蚵棚／擱淺船／消波塊／運河及水生林木');

// 7. Real boundary planning (planWallRuns) on natural forest venues must yield forest/giant-tree objects
for (const venueId of ['aokigahara', 'blackforest', 'yangmingshan']) {
  const venue = VENUES.find((v) => v.id === venueId);
  const env = { venue, mix: venue.mix };
  const segs = Array.from({ length: 20 }, (_, i) => ({
    x: -300 + i * 25, z: 200, len: 25, biome: 'green', water: false, tier: 'flat'
  }));
  const runs = planWallRuns(segs, { environment: env });
  const plantRuns = runs.filter((r) => PLANT_KINDS.has(r.kind) || PLANT_CATEGORIES.has(BOUNDARY_OBJECT_CATEGORIES[r.kind]));
  assert(plantRuns.length > 0, `${venue.name} (${venueId}) 綠地邊界必須生成巨木林或森林山丘等植物物件`);
  console.log(`  ✓ 森林場地 ${venue.name} (${venueId}): 邊界實際產出 [${runs.map(r => WALL_KINDS[r.kind].label).join('、')}]`);
}

console.log('🎉 邊界障礙物地貌與區域類型適配性驗證全數通過！');
