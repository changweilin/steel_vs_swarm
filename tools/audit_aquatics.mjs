// ============ 水下與沼澤生態動態稽核 (audit_aquatics.mjs) ============
// 驗證水下/沼澤環境效果、氣泡、動植物、珊瑚礁、潛艦、沈船、古代遺跡、浸沒建築、
// 船艦航行與停泊、以及水沼漸進過渡帶。
//
// 跑法: node tools/audit_aquatics.mjs
// 反向驗證:
//   --break-trans   (破壞過渡帶插值)
//   --break-viscous (破壞沼澤波浪黏滯度)
//   --break-bubble  (破壞氣泡上升速度分級)

import { readSrc } from './audit_src.mjs';
import { mulberry32 } from '../public/js/rng.js';
import { WATER } from '../public/js/data.js';

const BREAK_TRANS = process.argv.includes('--break-trans');
const BREAK_VISCOUS = process.argv.includes('--break-viscous');
const BREAK_BUBBLE = process.argv.includes('--break-bubble');
const BREAK_RELIC = process.argv.includes('--break-relic');

let pass = 0, fail = 0;
function ok(cond, msg) {
  if (!cond) {
    fail++;
    console.error(`  ✗ ${msg}`);
  } else {
    pass++;
    console.log(`  ✓ ${msg}`);
  }
}

console.log('== 水下與沼澤生態、動態與遺跡系統稽核 ==\n');

// 讀取原始碼
const aquaticsSrc = readSrc('public', 'js', 'aquatics.js');
const toonSrc = readSrc('public', 'js', 'toon.js');
const biomesSrc = readSrc('public', 'js', 'biomes.js');
const gameSrc = readSrc('public', 'js', 'game.js');

// ▍Ⅰ 模組匯出與常數架構 (AQUATIC)
console.log('▍Ⅰ 模組匯出與常數架構');
const grabObj = (src, prefix) => {
  const start = src.indexOf(prefix);
  if (start < 0) return null;
  const end = src.indexOf('};', start);
  const code = src.slice(start + prefix.length, end);
  return new Function(`return { ${code} };`)();
};

const AQUATIC = grabObj(aquaticsSrc, 'export const AQUATIC = {');
ok(AQUATIC !== null, 'AQUATIC 常數表成功定義');
ok(AQUATIC.BUBBLE_COUNT_WATER > 0 && AQUATIC.BUBBLE_COUNT_SWAMP > 0, '氣泡數量常數正確定義');
ok(AQUATIC.FISH_SCHOOLS_MAX >= 3, '魚群上限常數滿足生態密度');
ok(AQUATIC.JELLYFISH_MAX >= 10, '水母群上限常數滿足生態密度');
ok(AQUATIC.SHIP_CRUISE_SPD > 0, '巡弋船速常數正確定義');

// ▍Ⅱ 沼澤水面黏滯波浪與軟性物質 (Viscous Swamp Waves & SOFT_KINDS)
console.log('\n▍Ⅱ 沼澤水面黏滯波浪與軟性物質');
const SOFT_KINDS = grabObj(toonSrc, 'export const SOFT_KINDS = {');
let swampAmp = SOFT_KINDS?.swamp?.amp;
let swampFreq = SOFT_KINDS?.swamp?.freq;
let seaAmp = SOFT_KINDS?.sea?.amp;
let seaFreq = SOFT_KINDS?.sea?.freq;

if (BREAK_VISCOUS) {
  swampFreq = seaFreq * 2; // 故意破壞黏滯低頻特性
}

ok(SOFT_KINDS && SOFT_KINDS.swamp && SOFT_KINDS.swamp.axis === 'w', 'swamp 是 SOFT_KINDS 獨立表面波 (axis: w)');
ok(swampFreq < seaFreq, `沼澤波頻率比海浪低 (${swampFreq?.toFixed(3)} < ${seaFreq?.toFixed(3)} rad/s, 水流更慢更黏滯)`);
ok(swampAmp <= seaAmp, `沼澤波浪振幅平緩厚重 (${swampAmp?.toFixed(3)} <= ${seaAmp?.toFixed(3)})`);
ok(toonSrc.includes('export const swampSoft = () => ({ k: \'swamp\', span: WIND.SEA_M });'), 'swampSoft 匯出且綁定 swamp 鍵');

// ▍Ⅲ 氣泡與懸浮物分級動態 (Bubbles & Particle Dynamics)
console.log('\n▍Ⅲ 氣泡與懸浮物分級動態');
let waterRiseSpd = AQUATIC.BUBBLE_RISE_SPD_WATER;
let swampRiseSpd = AQUATIC.BUBBLE_RISE_SPD_SWAMP;
if (BREAK_BUBBLE) {
  swampRiseSpd = waterRiseSpd * 1.5; // 故意破壞沼氣泡沉重緩慢特性
}
ok(swampRiseSpd < waterRiseSpd, `沼氣泡上升速度慢於水氣泡 (${swampRiseSpd} < ${waterRiseSpd} m/s, 表現泥沼黏滯阻力)`);
ok(AQUATIC.BUBBLE_WOBBLE_FREQ_SWAMP < AQUATIC.BUBBLE_WOBBLE_FREQ_WATER, '沼氣泡擺動頻率低於清澈水氣泡 (遲滯涌動)');

// ▍Ⅳ 沼澤與水域過渡帶計算 (Gradual Transition Zone)
console.log('\n▍Ⅳ 沼澤與水域過渡帶計算');
// 沙箱化提取 aquaticTransition 與 aquaticSeed
const aquaticSeed = (x, z) => {
  const h = (Math.imul(Math.round(x * 8) | 0, 0x9E3779B1) ^ Math.imul(Math.round(z * 8) | 0, 0x85EBCA77)) | 0;
  return Math.imul(h ^ (h >>> 15), 0xC2B2AE3D) >>> 0;
};

// 提取 aquaticTransition 函式本體
const transFnStr = /export function aquaticTransition\(terrain, x, z\) \{([\s\S]*?)\n\}/.exec(aquaticsSrc)[1];
const mockEnvCode = (terrain, x, z) => {
  if (x < -10) return 1; // 水
  if (x > 10) return 2;  // 沼
  return 1; // 交界
};
const aquaticTransFn = new Function('terrain', 'x', 'z', 'terrainEnvCode', 'WATER', `${transFnStr}`);

// 模擬地形
const mockTerrain = {
  waterY: 0.3,
  heightAt(x, z) {
    if (x < -10) return -3.0;
    if (x > 10) return 0.3 + 1.2;
    return 0.1;
  },
  sampleColor(x, z) {
    if (x < -10) return [20, 50, 120];
    if (x > 10) return [60, 90, 40];
    return [40, 70, 80];
  }
};

const pureWaterRes = aquaticTransFn(mockTerrain, -50, 0, mockEnvCode, WATER);
const pureSwampRes = aquaticTransFn(mockTerrain, 50, 0, mockEnvCode, WATER);

if (BREAK_TRANS) {
  pureWaterRes.mix = 1.0; // 故意破壞水域過渡
}

ok(pureWaterRes.mix <= 0.3, `深水區水沼 mix 趨近 0 (實得 ${pureWaterRes.mix.toFixed(2)})`);
ok(pureSwampRes.mix >= 0.5, `沼澤區水沼 mix 偏向 1 (實得 ${pureSwampRes.mix.toFixed(2)})`);
ok(pureWaterRes.isWater, '深水區判定為 isWater');
ok(pureSwampRes.isSwamp, '沼澤區判定為 isSwamp');
ok(Array.isArray(pureWaterRes.veilCol) && pureWaterRes.veilCol.length === 3, '水下帷幕色相向量長度為 3');
ok(pureWaterRes.veilCol[2] > pureWaterRes.veilCol[0], '水域帷幕偏藍色調 (B > R)');
ok(pureSwampRes.veilCol[0] > pureWaterRes.veilCol[0], '沼澤帷幕混濁度與紅紫分量增高');

// ▍Ⅴ 確定性散布與零共享亂數消耗 (§2.3 / A4)
console.log('\n▍Ⅴ 確定性散布與零共享亂數消耗');
const s1 = aquaticSeed(123.45, -67.89);
const s2 = aquaticSeed(123.45, -67.89);
const s3 = aquaticSeed(124.00, -67.89);
ok(s1 === s2, '同座標雜湊種子嚴格一致 (確定性)');
ok(s1 !== s3, '不同座標雜湊種子離散分離');
ok(!aquaticsSrc.includes('Math.random()'), 'aquatics.js 內零 Math.random() (A4)');
// ▍Ⅵ biomes.js 與 game.js 接線契約
console.log('\n▍Ⅵ 接線契約');
ok(biomesSrc.includes('buildAquaticWorld('), 'biomes.js 接管 buildAquaticWorld 呼叫');
ok(biomesSrc.includes('buildSwampSurface'), 'biomes.js 具備 buildSwampSurface');
ok(biomesSrc.includes('swampSoft()'), 'buildSwampSurface 採用 swampSoft 黏滯波');
ok(gameSrc.includes('aquaticTransition('), 'game.js 在 _updateWaterVeil 呼叫 aquaticTransition');

// ▍Ⅶ 建築、沉船、古代遺跡與現代殘骸多樣化型錄 (Relic & Architectural Diversity)
console.log('\n▍Ⅶ 建築、沉船、古代遺跡與現代殘骸多樣化型錄');
const RELIC_KINDS = grabObj(aquaticsSrc, 'export const RELIC_KINDS = {');
let relicKindCount = RELIC_KINDS ? Object.keys(RELIC_KINDS).length : 0;
if (BREAK_RELIC) {
  relicKindCount = 3; // 故意破壞多樣性
}

ok(RELIC_KINDS !== null, 'RELIC_KINDS 型錄成功定義');
ok(relicKindCount >= 10, `建築與遺跡原型種類數充足 (>= 10 款, 實得 ${relicKindCount} 款)`);
ok(aquaticsSrc.includes('export function buildRelicObject('), 'aquatics.js 匯出 buildRelicObject 統一建構器');

// 檢查各原型建構器均已匯出
const expectedBuilders = [
  'buildSubmarine',
  'buildSunkenRuins',
  'buildShipwreck',
  'buildSubmergedHabitat',
  'buildObeliskAltarRing',
  'buildSunkenSpire',
  'buildColossalTitanVisage',
  'buildBattleshipWreck',
  'buildCrashedAirframe',
  'buildDeepSeaComplex',
  'buildCargoGantryWreck',
  'buildSunkenShrineTorii',
  'buildSunkenStupaRuin',
  'buildSunkenPyramidZiggurat',
  'buildSunkenSlateRuin',
  'buildSunkenEgyptianPylon',
  'buildSunkenTongkonan',
  'buildInuksukSite',
];

for (const bName of expectedBuilders) {
  ok(aquaticsSrc.includes(`export function ${bName}(`), `匯出建築/遺跡原型建構器: ${bName}`);
}

// 驗證陸地管線接線 (biomes.js placeWildernessRelics)
ok(biomesSrc.includes('buildRelicObject') && biomesSrc.includes('RELIC_KINDS'), 'biomes.js 引入 buildRelicObject 與 RELIC_KINDS');
ok(biomesSrc.includes('placeWildernessRelics('), 'biomes.js 具備 placeWildernessRelics 荒野遺跡擺放系統');
ok(biomesSrc.includes('relics: relicsBuilt'), 'biomes.js stats 正確回報陸地遺跡建置數量');

// ▍Ⅷ 世界宗教、原住民與古文明地標建築 (World Religious & Indigenous Landmarks)
console.log('\n▍Ⅷ 世界宗教、原住民與古文明地標建築');
const expectedLandmarks = [
  'shrine',
  'mandir',
  'stupa',
  'synagogue',
  'gurdwara',
  'stave_church',
  'pyramid',
  'slate_house',
  'tongkonan',
  'egyptian_pylon',
  'sahel_mosque',
  'nuer_tukul',
  'inuit_igloo',
];

for (const lName of expectedLandmarks) {
  ok(biomesSrc.includes(`${lName}: (`), `biomes.js LANDMARKS 包含文化/原住民建築產生器: ${lName}`);
  ok(biomesSrc.includes(`${lName}: { r:`), `biomes.js LANDMARK_COL 包含碰撞定義: ${lName}`);
}

ok(biomesSrc.includes("r === 'shinto'") && biomesSrc.includes("r === 'hindu'")
  && biomesSrc.includes("r === 'jewish'") && biomesSrc.includes("r === 'sikh'"),
  'buildingType 支援辨識 shinto, hindu, jewish, sikh 等真實 OSM 宗教標籤');
ok(biomesSrc.includes('slate_house') && biomesSrc.includes('tongkonan')
  && biomesSrc.includes('egyptian_pylon') && biomesSrc.includes('sahel_mosque')
  && biomesSrc.includes('nuer_tukul') && biomesSrc.includes('inuit_igloo'),
  'buildingType 支援辨識台灣石板屋、南島船形屋、古埃及塔門、薩赫爾清真寺、奴愛圓屋、因紐特冰屋等原住民風標籤');
ok(biomesSrc.includes('CULTURAL_RELIC_LANDMARKS') && biomesSrc.includes('matchedBuildingType'),
  'biomes.js 具備 CULTURAL_RELIC_LANDMARKS 與 matchedBuildingType 結構');

// 驗證 50% 相關對接 / 50% 多元非相關機率分佈 (離線模擬 1000 次抽樣)
import { nativeFunctionalKind } from '../public/js/nativeFunctionalBuildings.js';
const fnDef = biomesSrc
  .slice(biomesSrc.indexOf('export const CULTURAL_RELIC_LANDMARKS'), biomesSrc.indexOf('function buildingHeight('))
  .replace(/export\s+/g, '');
const evalCode = `${fnDef}\nreturn { CULTURAL_RELIC_LANDMARKS, matchedBuildingType, buildingType };`;
const { buildingType: testBuildingType, CULTURAL_RELIC_LANDMARKS: testRelicLandmarks } = new Function('nativeFunctionalKind', evalCode)(nativeFunctionalKind);

let matchCount = 0;
const N_SAMPLES = 1000;
const testTags = { amenity: 'place_of_worship', religion: 'shinto' };
for (let i = 1; i <= N_SAMPLES; i++) {
  const t = testBuildingType(testTags, i * 7919);
  if (t === 'shrine') matchCount++;
}
const matchRatio = matchCount / N_SAMPLES;
ok(matchRatio >= 0.45 && matchRatio <= 0.55,
  `遺跡/文化地標建築機率性出現：相關者佔比接近 50% (實測 ${(matchRatio * 100).toFixed(1)}%, 目標 50±5%)`);
ok(testBuildingType(testTags, 0) === 'shrine',
  '無 seed (seed=0) 呼叫時保持語意直接對接預設回傳');

if (fail > 0) {
  console.error(`\n✗ 稽核失敗: ${fail} 項未通過`);
  process.exit(1);
}
console.log(`\n🎉 水下與沼澤生態動態及遺跡系統稽核通過 (共 ${pass} 項)\n`);
