// ============ 季節常理天氣、降雨降雪細分與天文日照時程稽核 ============
// 用途: 驗證四季天氣常理機率分配、細雨/大雨/雷雨/暴雪獨立性、50% 維持率、動態風浪與天文日照公式
import {
  ENV, SEASON_WEATHER_WEIGHTS, WEATHER_DYNAMICS, pickSeasonalWeather,
  weatherAtTime, resolveEnv, computeSolarSchedule, clockHour, phaseBlend, sunDirAt,
} from '../public/js/data.js';

let pass = 0, fail = 0;
const ok = (c, msg) => { c ? (pass++, console.log(`  ✓ ${msg}`)) : (fail++, console.error(`  ✗ ${msg}`)); };

console.log('== 季節常理天氣、降雨降雪細分與天文日照時程稽核 ==');

// Ⅰ 天氣型錄與常理權重
console.log('\n▍Ⅰ 天氣型錄與四季常理機率分配 (含細雨/大雨/雷雨/暴雪)');
{
  const expectedWeathers = [
    'clear', 'cloudy', 'drizzle', 'rain', 'heavy_rain', 'storm',
    'snow', 'blizzard', 'windy', 'sandstorm', 'fog',
  ];
  ok(expectedWeathers.every((w) => !!ENV.weathers[w]),
    `ENV.weathers 包含所有指定天氣類型 (${expectedWeathers.join(', ')})`);

  for (const [season, weights] of Object.entries(SEASON_WEATHER_WEIGHTS)) {
    const sum = Number(Object.values(weights).reduce((a, b) => a + b, 0).toFixed(6));
    ok(sum === 100, `季節 ${season} 機率總和為 100% (實得 ${sum}%)`);
  }

  const summerSnowTotal = SEASON_WEATHER_WEIGHTS.summer.snow + SEASON_WEATHER_WEIGHTS.summer.blizzard;
  ok(Math.abs(summerSnowTotal - 1.0) < 1e-6, `夏季降雪+暴雪率嚴格為 1.0% (小雪 ${SEASON_WEATHER_WEIGHTS.summer.snow}% + 暴雪 ${SEASON_WEATHER_WEIGHTS.summer.blizzard}%)`);
  ok(SEASON_WEATHER_WEIGHTS.summer.drizzle > 0 && SEASON_WEATHER_WEIGHTS.summer.rain > 0 &&
     SEASON_WEATHER_WEIGHTS.summer.heavy_rain > 0 && SEASON_WEATHER_WEIGHTS.summer.storm > 0,
    `夏季包含細雨 (${SEASON_WEATHER_WEIGHTS.summer.drizzle}%)、中雨 (${SEASON_WEATHER_WEIGHTS.summer.rain}%)、大雨 (${SEASON_WEATHER_WEIGHTS.summer.heavy_rain}%) 與雷雨/颱風 (${SEASON_WEATHER_WEIGHTS.summer.storm}%)`);
  ok(SEASON_WEATHER_WEIGHTS.winter.snow === 28 && SEASON_WEATHER_WEIGHTS.winter.blizzard === 16,
    `冬季包含降雪 (${SEASON_WEATHER_WEIGHTS.winter.snow}%) 與暴雪 (${SEASON_WEATHER_WEIGHTS.winter.blizzard}%) 合計 44%`);
}

// Ⅱ 抽樣分佈驗證
console.log('\n▍Ⅱ 大量隨機抽樣分佈驗證 (100,000 次)');
{
  const N = 100000;
  const counts = {};
  for (let i = 0; i < N; i++) {
    const w = pickSeasonalWeather('summer', (i + 0.5) / N);
    counts[w] = (counts[w] || 0) + 1;
  }
  for (const [w, expectedPct] of Object.entries(SEASON_WEATHER_WEIGHTS.summer)) {
    const actualPct = (counts[w] || 0) / N * 100;
    ok(Math.abs(actualPct - expectedPct) < 0.15,
      `夏季 ${w.padEnd(10)} 實測 ${actualPct.toFixed(2)}% ≈ 期望 ${expectedPct}%`);
  }
}

// Ⅲ 天文日照時程公式化 (隨緯度與季節計算日出、日落、晝夜長度)
console.log('\n▍Ⅲ 天文日照時程公式化驗證 (computeSolarSchedule)');
{
  // 1. 夏至 (summer) 隨緯度增長日長
  const s0 = computeSolarSchedule('summer', 0);    // 赤道
  const s25 = computeSolarSchedule('summer', 25);  // 台灣 / 亞熱帶
  const s50 = computeSolarSchedule('summer', 50);  // 倫敦 / 溫帶
  const s60 = computeSolarSchedule('summer', 60);  // 北歐 / 寒帶

  ok(s0.halfDayH === 6.0, `赤道夏至半日長剛好 6.0 小時 (全日照 12h)`);
  ok(s60.halfDayH > s50.halfDayH && s50.halfDayH > s25.halfDayH && s25.halfDayH > s0.halfDayH,
    `夏至白晝長度隨緯度遞增 (0°: ${(s0.halfDayH*2).toFixed(1)}h < 25°: ${(s25.halfDayH*2).toFixed(1)}h < 50°: ${(s50.halfDayH*2).toFixed(1)}h < 60°: ${(s60.halfDayH*2).toFixed(1)}h)`);

  // 2. 冬至 (winter) 隨緯度縮短日長 (長夜)
  const w0 = computeSolarSchedule('winter', 0);
  const w25 = computeSolarSchedule('winter', 25);
  const w50 = computeSolarSchedule('winter', 50);
  const w60 = computeSolarSchedule('winter', 60);

  ok(w60.halfDayH < w50.halfDayH && w50.halfDayH < w25.halfDayH && w25.halfDayH < w0.halfDayH,
    `冬至白晝長度隨緯度遞減 (0°: ${(w0.halfDayH*2).toFixed(1)}h > 25°: ${(w25.halfDayH*2).toFixed(1)}h > 50°: ${(w50.halfDayH*2).toFixed(1)}h > 60°: ${(w60.halfDayH*2).toFixed(1)}h)`);

  // 3. 春分與秋分 (春/秋日夜平分)
  const spring50 = computeSolarSchedule('spring', 50);
  const autumn50 = computeSolarSchedule('autumn', 50);
  ok(Math.abs(spring50.halfDayH - 6.0) < 1e-3 && Math.abs(autumn50.halfDayH - 6.0) < 1e-3,
    `春分與秋分全球日夜等長 (半日長 ${spring50.halfDayH.toFixed(2)}h = 6.0h)`);

  // 4. 日出日落對稱性 (以正午 12:00 為中心)
  ok(Math.abs((s25.riseH + s25.setH) - 24.0) < 1e-3,
    `日出 (${s25.riseH}:00) 與日落 (${s25.setH}:00) 以正午 12:00 嚴格對稱`);

  // 5. 曙暮光隨緯度增長
  ok(s60.twilightH > s25.twilightH,
    `高緯度曙暮光長度增長 (60°: ${s60.twilightH.toFixed(2)}h > 25°: ${s25.twilightH.toFixed(2)}h)`);
}

// Ⅳ 動態風浪係數與環境物理影響
console.log('\n▍Ⅳ 動態風浪係數與環境物理影響 (細雨/大雨/雷雨/小雪/暴雪/強風/沙暴)');
{
  const requiredFields = ['windAmp', 'windFreq', 'waveAmp', 'waveSpeed'];
  for (const [w, dyn] of Object.entries(WEATHER_DYNAMICS)) {
    ok(requiredFields.every((f) => typeof dyn[f] === 'number' && dyn[f] > 0),
      `天氣 ${w.padEnd(10)} 包含完整的風浪動態係數 (windAmp=${dyn.windAmp}, waveAmp=${dyn.waveAmp})`);
  }

  // 降雨階梯風浪遞增: 細雨 < 降雨 < 大雨 < 雷雨
  ok(WEATHER_DYNAMICS.drizzle.windAmp < WEATHER_DYNAMICS.rain.windAmp &&
     WEATHER_DYNAMICS.rain.windAmp < WEATHER_DYNAMICS.heavy_rain.windAmp &&
     WEATHER_DYNAMICS.heavy_rain.windAmp < WEATHER_DYNAMICS.storm.windAmp,
    '降雨階梯風浪強度遞增 (細雨 1.15x < 降雨 1.35x < 大雨 1.8x < 雷雨 2.4x)');

  // 降雪階梯風浪遞增: 降雪 < 暴雪
  ok(WEATHER_DYNAMICS.snow.windAmp < WEATHER_DYNAMICS.blizzard.windAmp &&
     WEATHER_DYNAMICS.snow.waveAmp < WEATHER_DYNAMICS.blizzard.waveAmp,
    '降雪階梯風浪強度遞增 (降雪 1.15x < 暴雪 2.5x, 波高 0.9x < 1.8x)');

  ok(WEATHER_DYNAMICS.windy.windAmp >= 2.5 && WEATHER_DYNAMICS.windy.waveAmp >= 2.2,
    '強風 (windy) 顯著放大樹木/旗幟擺幅與海浪高度 (windAmp 2.5x, waveAmp 2.2x)');
  ok(WEATHER_DYNAMICS.sandstorm.windAmp >= 2.3,
    '沙暴 (sandstorm) 具備強風級別的植被與旗幟擺幅 (windAmp 2.3x)');
}

console.log(`\n🎉 天氣與天文日照系統稽核通過: ${pass} 通過 / ${fail} 失敗`);
if (fail > 0) process.exit(1);
