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

  // 1. 驗證自然場地的候選清單不得包含任何建築、工廠、市區設施
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

  // 2. 模擬自然場地邊界四緣 planWallRuns，驗證定案款式中建築與工廠總數為 0
  const len = 30;
  const simulatedEdges = [
    // 裸岩段
    Array.from({ length: 10 }, (_, i) => ({ x: -300 + i * len, z: -300, len, biome: 'bare', water: false, tier: 'steep' })),
    // 綠地段
    Array.from({ length: 10 }, (_, i) => ({ x: -300 + i * len, z: 300, len, biome: 'green', water: false, tier: 'flat' })),
    // 水域段
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

// 3. 驗證市區場地 (taipei101) 邊界可正常配置市區建築
const taipei = VENUES.find((v) => v.id === 'taipei101');
const taipeiEnv = { venue: taipei, mix: taipei.mix };
const urbanCandidates = wallCandidates('urban', false, 'flat', taipeiEnv);
assert(urbanCandidates.some((k) => ['residential', 'highrise', 'industry'].includes(BOUNDARY_OBJECT_CATEGORIES[k])),
  '市區場地應具備市區建築或設施');
console.log('  ✓ 市區場地 (taipei101): 市區邊界正確配發市區建築');

// 4. 驗證工業區專屬環境
const industrialEnv = { zone: 'industrial', industrial: true, mix: { urban: 0.8 } };
const indCandidates = wallCandidates('urban', false, 'flat', industrialEnv);
assert(indCandidates.some((k) => BOUNDARY_OBJECT_CATEGORIES[k] === 'industry'), '工業區應具備工業設施');
assert(!indCandidates.some((k) => BOUNDARY_OBJECT_CATEGORIES[k] === 'residential'), '工業區應排除一般民宅建築');
console.log('  ✓ 工業區專屬環境: 優先配發工廠與工業構造，排除民宅聚落');

console.log('🎉 邊界障礙物地貌與區域類型適配性驗證全數通過！');
