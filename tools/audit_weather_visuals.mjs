#!/usr/bin/env node
// Execute visual profiles across intensity boundaries and preserve freeze, fog and season seams.
import assert from 'node:assert/strict';
import {
  resolveWeatherDynamics,
  ENV,
} from '../public/js/data.js';
import { petalSeason, petalTones } from '../public/js/petals.js';
import { resolveWeatherVisuals } from '../public/js/weatherVisuals.js';
import { readSrc } from './audit_src.mjs';
const envSrc = readSrc('public', 'js', 'environment.js');
const fxSrc = readSrc('public', 'js', 'weatherFx.js');
const petalsSrc = readSrc('public', 'js', 'petals.js');
const biomesSrc = readSrc('public', 'js', 'biomes.js');

console.log('== 天氣視覺效果全域大翻新稽核 (Weather Visual Effects Overhaul) ==\n');

// Profiles execute the shipped derivation rather than reproducing its formulas.
console.log('Intensity profiles, cloud families and transition boundaries');
const calm = resolveWeatherVisuals();
for (const kind of ['rain', 'snow', 'sand']) {
  assert.equal(calm[kind].density, 0);
  assert.equal(calm[kind].opacity, 0);
  assert.equal(calm[kind].veil, 0);
  let previous = calm[kind];
  for (let i = 1; i <= 100; i++) {
    const current = resolveWeatherVisuals({ [`effective${kind[0].toUpperCase()}${kind.slice(1)}`]: i / 100, wind: 100 })[kind];
    assert(current.density >= previous.density);
    assert(current.opacity >= previous.opacity);
    assert(current.veil >= previous.veil);
    assert(current.speed >= previous.speed);
    previous = current;
  }
}
const mixed = resolveWeatherVisuals({ effectiveRain: .4, effectiveSnow: .6, effectiveSand: .8 });
assert.equal(mixed.rain.strength, .4); assert.equal(mixed.snow.strength, .6); assert.equal(mixed.sand.strength, .8);
const cloudy = resolveWeatherVisuals({ clouds: 90 });
const stormy = resolveWeatherVisuals({ clouds: 100, effectiveThunder: 1, effectiveRain: 1 });
const clear = resolveWeatherVisuals({ clouds: 10 });
assert(cloudy.clouds.stratus > clear.clouds.stratus);
assert(stormy.clouds.cumulonimbus > cloudy.clouds.cumulonimbus);
assert(clear.clouds.cirrus > cloudy.clouds.cirrus);
assert(resolveWeatherVisuals({ fog: 100 }).clouds.altitude < calm.clouds.altitude);
assert(stormy.lightning.branches > calm.lightning.branches);
assert(stormy.lightning.width > calm.lightning.width);
assert(stormy.lightning.duration > calm.lightning.duration);
const reusable = resolveWeatherVisuals({ effectiveRain: 1 });
const rainProfile = reusable.rain;
assert.equal(resolveWeatherVisuals({}, reusable), reusable);
assert.equal(reusable.rain, rainProfile); assert.equal(reusable.rain.opacity, 0);
const invalid = resolveWeatherVisuals({ effectiveRain: NaN, effectiveSnow: Infinity, effectiveSand: -10 });
for (const kind of ['rain', 'snow', 'sand']) assert.equal(invalid[kind].strength, 0);
// Fog follows the resolved threshold; shape changes remain continuous and bounded.
assert.equal(calm.fog.opacity, 0);
assert.equal(calm.fog.density, 0);
let previousShape = calm;
for (let i = 1; i <= 100; i++) {
  const profile = resolveWeatherVisuals({ wind: i, effectiveFog: i / 100 });
  for (const key of ['density', 'opacity', 'height', 'size']) assert(profile.fog[key] >= previousShape.fog[key]);
  for (const key of ['lean', 'flutter', 'gust', 'gustSpeed']) assert(profile.wind[key] >= previousShape.wind[key]);
  for (const key of ['crest', 'cross', 'chop']) assert(profile.water[key] >= previousShape.water[key]);
  previousShape = profile;
}
assert(previousShape.wind.lean < 1 && previousShape.wind.flutter < .2);
for (const fog of [0, 74.99, 75, 75.01, 80, 90, 100]) {
  const dyn = resolveWeatherDynamics({ fog });
  assert.equal(resolveWeatherVisuals(dyn).fog.strength, dyn.effectiveFog);
}
const invalidShape = resolveWeatherVisuals({ effectiveFog: NaN, wind: Infinity });
assert.equal(invalidShape.fog.opacity, 0); assert.equal(invalidShape.wind.lean, 0);
const shapes = [reusable.fog, reusable.wind, reusable.water];
resolveWeatherVisuals({ wind: 100, effectiveFog: 1 }, reusable);
resolveWeatherVisuals({}, reusable);
assert.equal(reusable.fog, shapes[0]); assert.equal(reusable.wind, shapes[1]); assert.equal(reusable.water, shapes[2]);
assert.equal(reusable.wind.lean, 0); assert.equal(reusable.water.chop, 0);
for (const clouds of [0, 50, 100]) for (const value of [74.99, 75, 75.01, 100]) {
  const dyn = resolveWeatherDynamics({ clouds, rain: value, snow: value, sand: value, thunder: value });
  const p = resolveWeatherVisuals(dyn);
  assert.equal(p.rain.strength, dyn.effectiveRain);
  assert.equal(p.snow.strength, dyn.effectiveSnow);
  assert.equal(p.sand.strength, dyn.effectiveSand);
  assert.equal(p.lightning.strength, dyn.effectiveThunder);
}
console.log('  ✓ Independent strengths, monotonic density/speed/veil, authority thresholds and allocation reuse');

// --------------------------------------------------------------------------
// Ⅱ. 大雪水域漸進凍結、停雪後持續凍結保溫與平緩融化解凍動態過程
// --------------------------------------------------------------------------
console.log('▍Ⅱ. 大雪水域漸進凍結、停雪後持續凍結保溫與平緩動態融化');

// 1. 深度大雪 (snow 95%): 水波完全凍結無起伏
let simDyn = resolveWeatherDynamics({
  rain: 0, fog: 20, wind: 20, clouds: 90, thunder: 0, sand: 0, snow: 95,
}, null, 0);

assert.equal(simDyn.isFrozen, true, '大雪凍結時 isFrozen === true');
assert.equal(simDyn.waveAmp, 0, '大雪凍結時 waveAmp === 0');
assert.equal(simDyn.waveSpeed, 0, '大雪凍結時 waveSpeed === 0');
console.log('  ✓ 降雪時水波漸進凍結，大雪達到完全平坦無起伏 (isFrozen = true)');

// 2. 模擬大雪驟停 (snow 瞬間降為 0): 水面不會立刻融化，而是持續保溫凍結一段時間
const clearVec = { rain: 0, fog: 0, wind: 30, clouds: 20, thunder: 0, sand: 0, snow: 0 };

// 經過 5 秒晴天
simDyn = resolveWeatherDynamics(clearVec, simDyn, 5.0);
console.log(`  - 停雪 5 秒後: freezeFactor = ${simDyn.freezeFactor.toFixed(2)}, thawHoldS = ${simDyn.thawHoldS.toFixed(1)}s, waveAmp = ${simDyn.waveAmp.toFixed(2)}`);
assert.equal(simDyn.isFrozen, true, '停雪 5 秒內仍處於保溫凍結期 (isFrozen 保持 true)');
assert.equal(simDyn.waveAmp, 0, '保溫凍結期水面保持完全平坦');

// 經過 15 秒 (累積 20 秒，已過保溫期進入融化過程)
simDyn = resolveWeatherDynamics(clearVec, simDyn, 15.0);
console.log(`  - 停雪 20 秒後 (進入融化): freezeFactor = ${simDyn.freezeFactor.toFixed(2)}, waveAmp = ${simDyn.waveAmp.toFixed(2)}`);
assert(simDyn.freezeFactor < 0.98, '保溫期結束後 freezeFactor 開始衰減融化');
assert(simDyn.waveAmp > 0.05, '融化開始後水波逐漸復甦');
assert(simDyn.waveAmp < 1.0, '融化初期水波振幅仍平緩抑制，處於動態過渡中');

// 再經過 8 秒 (累積 28 秒，完全融化)
simDyn = resolveWeatherDynamics(clearVec, simDyn, 8.0);
console.log(`  - 停雪 28 秒後 (完全解凍): freezeFactor = ${simDyn.freezeFactor.toFixed(2)}, waveAmp = ${simDyn.waveAmp.toFixed(2)}`);
assert.equal(simDyn.freezeFactor, 0, '完全解凍後 freezeFactor 歸零');
assert.equal(simDyn.isFrozen, false, '完全解凍後 isFrozen === false');
assert(simDyn.waveAmp > 0.8, '完全解凍後水波完全恢復正常');
console.log('  ✓ 大雪結束後持續凍結保溫 (thawHoldS) → 連續平緩融化解凍 → 恢復正常起伏\n');

// --------------------------------------------------------------------------
// Ⅲ. 濃霧雸定權威視野(2026-09-06 改制):渲染霧 far 收斂至 65m 錨,
// 效機在視野邊界消失時 3D 已經一片白
console.log('▍Ⅲ. 濃霧雸定權威視野(65m 錨)');

// 驗證 environment.js 霧錨定公式:w=(1-eff)^5,eff=0 恆等舊制,eff越大壓得越狠
assert.match(envSrc, /const fogW = Math\.pow\(1 - \(curDyn\.effectiveFog \?\? 0\), 5\);/, '能見度壓制採用高階曲線 (eff=0 恆等舊制,最濃才全壓)');
assert.match(envSrc, /const FOG_SIGHT_FAR_M = 65;/, '濃霧錨 = 65m 步行視野 far');

const testSpan = 1000;
const FOG_ANCHOR_FAR = 65;
// 清晴 (fog 0%, eff = 0 => fogW = 1 => 恆等舊制)
const clrDyn = resolveWeatherDynamics({ rain: 0, fog: 0, wind: 10, clouds: 60, thunder: 0, sand: 0, snow: 0 });
const clrFogW = Math.pow(1 - (clrDyn.effectiveFog ?? 0), 5);
const clrFar = testSpan * clrDyn.fogFar * clrFogW + FOG_ANCHOR_FAR * (1 - clrFogW);
// 中度起霧 (fog 80%)
const midFogDyn = resolveWeatherDynamics({ rain: 0, fog: 80, wind: 10, clouds: 60, thunder: 0, sand: 0, snow: 0 });
const midFogW = Math.pow(1 - (midFogDyn.effectiveFog ?? 0), 5);
const midActualFogFar = testSpan * midFogDyn.fogFar * midFogW + FOG_ANCHOR_FAR * (1 - midFogW);

// 極致濃霧 (fog 100%, eff = 1 => fogW = 0 => 錨定 65m)
const maxFogDyn = resolveWeatherDynamics({ rain: 0, fog: 100, wind: 10, clouds: 60, thunder: 0, sand: 0, snow: 0 });
const maxFogW = Math.pow(1 - (maxFogDyn.effectiveFog ?? 0), 5);
const maxActualFogFar = testSpan * maxFogDyn.fogFar * maxFogW + FOG_ANCHOR_FAR * (1 - maxFogW);

console.log(`  - 晴天 far 距離: ${clrFar.toFixed(1)}m (恆等舊制)`);
console.log(`  - 中度霧 (80%) far 距離: ${midActualFogFar.toFixed(1)}m (保持遠處模糊可視)`);
console.log(`  - 最濃霧 (100%) far 距離: ${maxActualFogFar.toFixed(1)}m (收斂至 65m 錨)`);

assert(Math.abs(clrFar - testSpan * clrDyn.fogFar) < 1e-9, '晴天霧效果恆等舊制(eff=0 時曲線恆等)');
assert(midActualFogFar > 300, '中度霧未過度壓制視野');
assert(maxActualFogFar < midActualFogFar, '濃度越深視野越近(單調)');
assert(Math.abs(maxActualFogFar - FOG_ANCHOR_FAR) < 1, `最濃霧時視野距離收斂至 65m 錨 (實得 ${maxActualFogFar.toFixed(1)}m)`);
console.log('  ✓ 濃霧在「最濃時」收斂至 65m 步行視野錨\n');

// --------------------------------------------------------------------------
// Ⅳ. 風力自然表現與四季落花落葉 (春櫻花 / 夏綠葉 / 秋楓紅 / 冬枯葉)
// --------------------------------------------------------------------------
console.log('▍Ⅳ. 自然風力與四季落花落葉 (春櫻花 / 夏綠葉 / 秋楓紅 / 冬枯葉)');

// 1. 驗證四季色調與模式完整映射
assert.equal(petalSeason('spring'), 'bloom', '春季 = 櫻花粉瓣 (bloom)');
assert.equal(petalSeason('summer'), 'leaf', '夏季 = 翠綠夏葉 (leaf)');
assert.equal(petalSeason('autumn'), 'leaf', '秋季 = 楓紅秋葉 (leaf)');
assert.equal(petalSeason('winter'), 'leaf', '冬季 = 枯褐枯葉 (leaf)');

const springTones = petalTones(ENV.seasons.spring, 'bloom');
const summerTones = petalTones(ENV.seasons.summer, 'leaf');
const autumnTones = petalTones(ENV.seasons.autumn, 'leaf');
const winterTones = petalTones(ENV.seasons.winter, 'leaf');

assert.equal(springTones[0], ENV.seasons.spring.accent, '春季主色調對齊櫻花粉');
assert.equal(summerTones[0], ENV.seasons.summer.accent, '夏季主色調對齊綠葉');
assert.equal(autumnTones[0], ENV.seasons.autumn.accent, '秋季主色調對齊楓紅');
assert.equal(winterTones[0], ENV.seasons.winter.accent, '冬季主色調對齊枯葉');

console.log(`  - 春季 (櫻花): 0x${springTones[0].toString(16)} (櫻花粉瓣)`);
console.log(`  - 夏季 (綠葉): 0x${summerTones[0].toString(16)} (盛夏綠葉)`);
console.log(`  - 秋季 (楓紅): 0x${autumnTones[0].toString(16)} (秋楓紅葉)`);
console.log(`  - 冬季 (枯葉): 0x${winterTones[0].toString(16)} (凋零枯葉)`);
console.log('  ✓ 四季落花落葉色調完全由 ENV.seasons 推導');

// 2. 虛擬氣流微粒已徹底移除
assert.doesNotMatch(envSrc, /'wind'/, '粒子系統中已無虛擬 wind 氣流條紋');
assert.doesNotMatch(envSrc, /windTex/, '已無 windTex 虛擬氣流貼圖');

// Cloud advection integrates wind instead of jumping when wind strength changes.
assert.match(fxSrc, /travelX \+= dir\[0\] \* WIND\.CLOUD_MPS \* amp \* dt/);
assert.match(fxSrc, /travelZ \+= dir\[1\] \* WIND\.CLOUD_MPS \* amp \* dt/);

// 4. 低空落花落葉風力動態響應
assert.match(petalsSrc, /export function stepPetal\(p, dt, t, dyn\)/, 'petals.js stepPetal 支援即時天氣風力動態 dyn');
assert.match(petalsSrc, /p\.w \* d \* wScale/, '大風時落花/落葉自轉與旋流角速度隨風力加速');
assert.match(petalsSrc, /const drift = \(wScale - 1\.0\) \* 1\.8;/, '大風時落花/落葉軌跡受風向 windDir 與風力真實偏移');
assert.match(biomesSrc, /write\(Math\.min\(PETAL\.DT_MAX, Math\.max\(0, dt \|\| 0\)\), getWeatherDynamics\(\)\)/, 'biomes.js buildPetals 實時注入天氣動態風力');
console.log('  ✓ 低空: 大風時四季落花落葉之落速、擺盪、角速度與風向偏移隨風力即時響應\n');

// --------------------------------------------------------------------------
// Ⅴ. 3D 實體雷電系統
// --------------------------------------------------------------------------
console.log('▍Ⅴ. 3D 實體分支閃電電弧系統');

assert.match(fxSrc, /WEATHER_DEBUFFS\.LIGHTNING\.MAX_TARGETS/, 'Pool holds all authoritative simultaneous targets');
assert.match(fxSrc, /new THREE\.InstancedMesh/, 'Bolt core and halo use fixed draw calls');
assert.doesNotMatch(fxSrc, /Math\.random\(/, 'Weather scatter uses isolated seeded RNG');
assert.doesNotMatch(envSrc, /Math\.random\(/);
assert.match(fxSrc, /slot\.core\.dispose\(\); slot\.halo\.dispose\(\)/, 'Instance buffers release on teardown');
assert.match(envSrc, /clouds\.dispose\(\)/, 'Clouds own their textures');
assert.match(envSrc, /lightning\.dispose\(\)/);
assert.match(envSrc, /particles\.dispose\(\)/);
assert.match(envSrc, /fog\.dispose\(\)/);
console.log('  ✓ Seeded scatter, pooled lightning and independent GPU ownership');
console.log('Weather visual profiles and existing freeze/fog/season seams passed.');
