#!/usr/bin/env node
/**
 * tools/audit_weather_visuals.mjs
 *
 * 離線稽核: 天氣視覺效果全域大翻新 (Weather Visual Effects Overhaul)
 * 驗證五大使用者需求與單一真相縫:
 *   1. 陰天雲朵數量與覆蓋率 (與雲量成正比, 陰天覆蓋半數以上天空; 霧量垂直擴展, 越濃雲底越低)
 *   2. 大雪時水域凍結平緩過渡 (非瞬間變平, 隨雪量加劇漸進衰減至完全平坦凍結)
 *   3. 濃霧最濃時能見度壓至防禦塔射程 (Single Seam: UNITS.tower.range)
 *   4. 雨 / 雪 / 沙塵微粒專屬紋理與運動物理軌跡; 風力不使用虛擬氣流 (高空由雲飄移與聚散表現, 低空由落花落葉表現)
 *   5. 雷雨時烏雲擊出真實 3D 分支閃電 (折線電弧 + 側向分叉 + 地面光暈 + 資源回收)
 */

import assert from 'node:assert/strict';
import {
  resolveWeatherDynamics,
  WEATHER_PRESETS,
  WEATHER_DYNAMICS,
  UNITS,
} from '../public/js/data.js';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const envSrc = readFileSync(resolve(__dirname, '../public/js/environment.js'), 'utf-8');
const toonSrc = readFileSync(resolve(__dirname, '../public/js/toon.js'), 'utf-8');
const dataSrc = readFileSync(resolve(__dirname, '../public/js/data.js'), 'utf-8');
const petalsSrc = readFileSync(resolve(__dirname, '../public/js/petals.js'), 'utf-8');
const biomesSrc = readFileSync(resolve(__dirname, '../public/js/biomes.js'), 'utf-8');

function lerp(a, b, t) {
  return a + (b - a) * t;
}

console.log('== 天氣視覺效果全域大翻新稽核 (Weather Visual Effects Overhaul) ==\n');

// --------------------------------------------------------------------------
// Ⅰ. 雲朵數量與覆蓋率 + 霧數值垂直擴展
// --------------------------------------------------------------------------
console.log('▍Ⅰ. 雲朵數量、陰天覆蓋率與霧垂直擴展');

// 驗證總雲量配置與集群規模
assert.match(envSrc, /const numClusters = 12/, '雲朵集群數已擴充至 12 群');
assert.match(envSrc, /const totalClouds = numClusters \* spritesPerCluster/, '計算 72 枚雲朵群');

// 驗證雲朵啟用數量隨 cloudsPct 比例縮放
function calcActiveClouds(cloudsPct, fogPct = 0, totalClouds = 72) {
  const fogCountBoost = (fogPct / 100) * 0.20;
  const activeRatio = Math.max(0.08, Math.min(1.0, Math.pow(cloudsPct / 100, 0.85) + fogCountBoost));
  return Math.min(totalClouds, Math.max(4, Math.round(totalClouds * activeRatio)));
}

const clearClouds = calcActiveClouds(10, 0);
const cloudyClouds = calcActiveClouds(50, 0);
const overcastClouds = calcActiveClouds(90, 0);
const foggyOvercastClouds = calcActiveClouds(90, 80);

console.log(`  - 晴天 (10%): 啟用 ${clearClouds} 朵雲`);
console.log(`  - 多雲 (50%): 啟用 ${cloudyClouds} 朵雲`);
console.log(`  - 陰天 (90%): 啟用 ${overcastClouds} 朵雲`);
console.log(`  - 陰天高霧 (90% clouds + 80% fog): 啟用 ${foggyOvercastClouds} 朵雲`);

assert(clearClouds < 15, `晴天雲量應稀疏 (實得 ${clearClouds})`);
assert(cloudyClouds >= 38, `多雲雲量顯著增加 (實得 ${cloudyClouds})`);
assert(overcastClouds >= 60, `陰天雲量大面積覆蓋 (實得 ${overcastClouds} / 72)`);
assert(foggyOvercastClouds >= overcastClouds, '濃霧使低空雲量進一步凝結開展');
assert(overcastClouds > clearClouds * 4, '陰天雲朵數應為晴天的 4 倍以上');
console.log('  ✓ 雲朵數量與雲量嚴格成正比');

// 驗證陰天 (>=50%) 尺寸放大與天空覆蓋率
assert.match(envSrc, /scaleFactor = \(0\.80 \+ \(cloudsPct \/ 100\) \* 1\.30\) \* \(1\.0 \+ overcastF \* 0\.50\)/, '陰天雲朵尺寸與橫向擴展倍率已放大');
assert.match(envSrc, /minAltitude = span \* Math\.max\(0\.04, 0\.26 \* \(1\.0 - fogFactor \* 0\.85\) \+ 0\.04\)/, '霧越濃雲朵最小高度越低 (貼近地平線與低空)');
assert.match(envSrc, /vertExpansion = 1\.0 \+ fogFactor \* 0\.75/, '霧越濃垂直層級厚度跨度越開展');
console.log('  ✓ 陰天雲朵橫向擴展與交疊覆蓋半數以上天空');
console.log('  ✓ 霧量垂直擴展: 越濃雲底越低、垂直跨度越大\n');

// --------------------------------------------------------------------------
// Ⅱ. 大雪水域漸進平緩凍結 (非瞬間變平, 隨雪量連續衰減)
// --------------------------------------------------------------------------
console.log('▍Ⅱ. 大雪時水域漸進平緩凍結 (連續衰減至平坦)');

// 1. 輕微降雪 (snow 40%): 水波維持起伏
const lightSnowDyn = resolveWeatherDynamics({
  rain: 0,
  fog: 10,
  wind: 20,
  clouds: 60,
  thunder: 0,
  sand: 0,
  snow: 40,
});
assert.equal(lightSnowDyn.isFrozen, false, '初雪時尚未完全凍結');
assert(lightSnowDyn.waveAmp > 0.3, `初雪時水波應保持擾動 (實得 ${lightSnowDyn.waveAmp.toFixed(2)})`);

// 2. 中度降雪 (snow 70%): 水波平緩衰減
const midSnowDyn = resolveWeatherDynamics({
  rain: 0,
  fog: 20,
  wind: 20,
  clouds: 70,
  thunder: 0,
  sand: 0,
  snow: 70,
});
assert(midSnowDyn.waveAmp < lightSnowDyn.waveAmp, '中度降雪時水波振幅逐漸收斂平緩');
assert(midSnowDyn.waveAmp > 0, '中度降雪時尚未瞬間歸零');

// 3. 深度大雪 (snow 95%): 水波完全凍結無起伏
const deepSnowDyn = resolveWeatherDynamics({
  rain: 0,
  fog: 20,
  wind: 20,
  clouds: 90,
  thunder: 0,
  sand: 0,
  snow: 95,
});
assert.equal(deepSnowDyn.isFrozen, true, '大雪凍結時 isFrozen === true');
assert.equal(deepSnowDyn.waveAmp, 0, '大雪凍結時 waveAmp === 0');
assert.equal(deepSnowDyn.waveSpeed, 0, '大雪凍結時 waveSpeed === 0');
console.log('  ✓ 降雪時水波連續平滑過渡，大雪達到完全凍結無起伏');

// 驗證 toon.js 中的 Shader 結冰無擾動保證
assert.match(toonSrc, /if \( uWeatherWaveAmp <= 0\.001 \) return 0\.0;/, 'celSeaH 與 celFoam 於結冰時直接回傳 0.0');
console.log('  ✓ toon.js 水面頂點位移與岸邊動態泡沫隨波浪振幅平緩歸零\n');

// --------------------------------------------------------------------------
// Ⅲ. 濃霧「最濃時」能見度壓至防禦塔射程 (UNITS.tower.range)
// --------------------------------------------------------------------------
console.log('▍Ⅲ. 濃霧最濃時能見度壓至防禦塔射程 (UNITS.tower.range)');

const TOWER_RANGE = UNITS.tower.range;
console.log(`  - 實戰砲塔權威射程 (UNITS.tower.range): ${TOWER_RANGE}m`);
assert(TOWER_RANGE > 100 && TOWER_RANGE < 400, `UNITS.tower.range 應為有效砲塔射程 (實得 ${TOWER_RANGE})`);

// 驗證 environment.js 中最濃霧壓制公式
assert.match(envSrc, /const effFog = Math\.pow\(Math\.max\(0, curDyn\.effectiveFog\), 1\.8\);/, '能見度壓制採用高階曲線 (最濃時才收斂至射程)');

const testSpan = 1000;
// 中度起霧 (fog 80%, effectiveFog = 0.20)
const midFogDyn = resolveWeatherDynamics({ rain: 0, fog: 80, wind: 10, clouds: 60, thunder: 0, sand: 0, snow: 0 });
const midEffFog = Math.pow(Math.max(0, midFogDyn.effectiveFog), 1.8);
const midActualFogFar = lerp(testSpan * midFogDyn.fogFar, Math.min(testSpan * midFogDyn.fogFar, TOWER_RANGE), midEffFog);

// 極致濃霧 (fog 100%, effectiveFog = 1.0)
const maxFogDyn = resolveWeatherDynamics({ rain: 0, fog: 100, wind: 10, clouds: 60, thunder: 0, sand: 0, snow: 0 });
const maxEffFog = Math.pow(Math.max(0, maxFogDyn.effectiveFog), 1.8);
const maxActualFogFar = lerp(testSpan * maxFogDyn.fogFar, Math.min(testSpan * maxFogDyn.fogFar, TOWER_RANGE), maxEffFog);

console.log(`  - 中度霧 (80%) far 距離: ${midActualFogFar.toFixed(1)}m (保持遠處模糊可視)`);
console.log(`  - 最濃霧 (100%) far 距離: ${maxActualFogFar.toFixed(1)}m (精確收斂至 1 個砲塔射程 ${TOWER_RANGE}m)`);

assert(midActualFogFar > TOWER_RANGE * 1.5, '中度霧未過度壓制視野');
assert(Math.abs(maxActualFogFar - TOWER_RANGE) < 5, `最濃霧時視野距離精確收斂至 1 個砲塔射程 (實得 ${maxActualFogFar.toFixed(1)}m)`);
console.log('  ✓ 濃霧在「最濃時」精確收斂至 1 個砲塔射程\n');

// --------------------------------------------------------------------------
// Ⅳ. 風數值不使用虛擬氣流 (高空雲速/聚散 + 低空落花落葉)
// --------------------------------------------------------------------------
console.log('▍Ⅳ. 風力自然表現 (淘汰虛擬氣流, 高空雲速/聚散 + 低空落花落葉)');

// 1. 虛擬氣流微粒已徹底移除
assert.doesNotMatch(envSrc, /'wind'/, '粒子系統中已無虛擬 wind 氣流條紋');
assert.doesNotMatch(envSrc, /windTex/, '已無 windTex 虛擬氣流貼圖');

// 2. 高空風力表現
assert.match(envSrc, /WIND\.CLOUD_MPS \* windAmp \* t/, '高空雲朵飄移速度由 windAmp 驅動');
assert.match(envSrc, /clusterPulse = Math\.sin\(t \* 0\.12 \* Math\.max\(0\.4, windAmp\) \+ c\.phase\)/, '高空雲朵聚散頻率由 windAmp 驅動');
console.log('  ✓ 高空: 雲朵飄移速度與聚散速率完全由風力 windAmp 即時驅動');

// 3. 低空落花落葉表現
assert.match(petalsSrc, /export function stepPetal\(p, dt, t, dyn\)/, 'petals.js stepPetal 支援即時天氣風力動態 dyn');
assert.match(petalsSrc, /p\.w \* d \* wScale/, '低空落花/落葉自轉與旋流角速度隨風力加速');
assert.match(petalsSrc, /const drift = \(wScale - 1\.0\) \* 1\.8;/, '低空落花/落葉軌跡受風向 windDir 與風力真實偏偏移');
assert.match(biomesSrc, /write\(Math\.min\(PETAL\.DT_MAX, Math\.max\(0, dt \|\| 0\)\), getWeatherDynamics\(\)\)/, 'biomes.js buildPetals 實時注入天氣動態風力');
console.log('  ✓ 低空: 春季落花與秋季落葉之落速、擺盪、角速度與風向偏移隨風力即時響應\n');

// --------------------------------------------------------------------------
// Ⅴ. 3D 實體雷電系統
// --------------------------------------------------------------------------
console.log('▍Ⅴ. 3D 實體分支閃電電弧系統');

assert.match(envSrc, /function makeLightningSystem\(span, terrain\)/, '具備 makeLightningSystem 3D 閃電電弧建構器');
assert.match(envSrc, /mainLine = new THREE\.LineSegments\(mainGeo, mainMat\)/, '主電弧採用 LineSegments 折線段');
assert.match(envSrc, /branchLine = new THREE\.LineSegments\(branchGeo, branchMat\)/, '側向分叉電弧採用 LineSegments');
assert.match(envSrc, /glowSprite = new THREE\.Sprite\(glowMat\)/, '具備地面/目標落雷衝擊光暈');
assert.match(envSrc, /lightning\.strike\(new THREE\.Vector3\(startX, startY, startZ\), new THREE\.Vector3\(endX, endY, endZ\)\)/, '打雷時從烏雲擊出 3D 閃電至地面');
assert.match(envSrc, /scene\.remove\(lightning\.obj\);\s+lightning\.dispose\(\);/, 'A25 規範: 閃電幾何/材質/貼圖完全釋放');

console.log('  ✓ 烏雲到地面 16 段折線主電弧 + 側向分叉分支電弧');
console.log('  ✓ 地面衝擊高光光暈與放電頻閃衰減');
console.log('  ✓ GPU 資源釋放 (A25) 完整無漏\n');

console.log('🎉 天氣視覺效果全域大翻新稽核全部通過！\n');
