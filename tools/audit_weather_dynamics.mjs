// ============ 季節常理天氣、7維多元天氣系統、布朗運動演化與天文日照時程稽核 ============
// 用途: 驗證四季天氣常理機率分配、7維天氣屬性定義、8大初始預設、布朗運動連續演化、烏雲/沙/雪/雷條件觸發、水波凍結與天文日照公式
import {
  ENV, SEASON_WEATHER_WEIGHTS, WEATHER_DYNAMICS, pickSeasonalWeather,
  weatherAtTime, resolveEnv, computeSolarSchedule, clockHour, phaseBlend, sunDirAt,
  WEATHER_ATTRS, WEATHER_PRESETS, SEASON_TIME_BIAS, weatherVectorAt, resolveWeatherDynamics,
} from '../public/js/data.js';

let pass = 0, fail = 0;
const ok = (c, msg) => { c ? (pass++, console.log(`  ✓ ${msg}`)) : (fail++, console.error(`  ✗ ${msg}`)); };

console.log('== 季節常理天氣、7維多元天氣系統、布朗運動演化與天文日照時程稽核 ==');

// Ⅰ 天氣型錄與 8 大開局預設
console.log('\n▍Ⅰ 天氣型錄與 8 大開局初始值預設 (7維屬性: 雲/霧/風/雨/沙/雪/雷)');
{
  const expectedPresets = [
    'clear', 'cloudy', 'heavy_rain', 'storm', 'fog', 'windy', 'snow', 'sandstorm',
  ];
  ok(expectedPresets.every((w) => !!ENV.weathers[w]),
    `ENV.weathers 包含 8 大開局天氣預設 (${expectedPresets.join(', ')})`);
  ok(Object.keys(ENV.weathers).length === 8,
    `ENV.weathers 嚴格維持 8 種天氣 (實得 ${Object.keys(ENV.weathers).length} 種)`);
  ok(Object.keys(WEATHER_PRESETS).length === 8,
    `WEATHER_PRESETS 嚴格維持 8 大開局預設 (實得 ${Object.keys(WEATHER_PRESETS).length} 種)`);

  ok(WEATHER_ATTRS.length === 7 &&
     ['clouds', 'fog', 'wind', 'rain', 'sand', 'snow', 'thunder'].every((a) => WEATHER_ATTRS.includes(a)),
    'WEATHER_ATTRS 定義完整 7 維天氣屬性 (clouds, fog, wind, rain, sand, snow, thunder)');

  for (const preset of expectedPresets) {
    const vec = WEATHER_PRESETS[preset];
    ok(vec && WEATHER_ATTRS.every((a) => typeof vec[a] === 'number' && vec[a] >= 0 && vec[a] <= 100),
      `預設 ${preset.padEnd(10)} 包含合法 7 維數值 (0~100)`);
  }

  for (const [season, weights] of Object.entries(SEASON_WEATHER_WEIGHTS)) {
    const sum = Number(Object.values(weights).reduce((a, b) => a + b, 0).toFixed(6));
    ok(sum === 100, `季節 ${season} 機率總和為 100% (實得 ${sum}%)`);
    ok(Object.keys(weights).every((w) => expectedPresets.includes(w)),
      `季節 ${season} 之天氣鍵值全數收斂於 8 大天氣內`);
  }

  const summerSnowTotal = SEASON_WEATHER_WEIGHTS.summer.snow;
  ok(Math.abs(summerSnowTotal - 1.0) < 1e-6, `夏季降雪率嚴格為 1.0% (大雪 ${SEASON_WEATHER_WEIGHTS.summer.snow}%)`);
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
console.log('\n▍Ⅳ 動態風浪係數與環境物理影響 (大雨/雷雨/大雪凍結/強風/沙暴)');
{
  const requiredFields = ['windAmp', 'windFreq', 'waveAmp', 'waveSpeed'];
  ok(Object.keys(WEATHER_DYNAMICS).length === 8,
    `WEATHER_DYNAMICS 嚴格維持 8 種天氣動態 (實得 ${Object.keys(WEATHER_DYNAMICS).length} 種)`);

  for (const [w, dyn] of Object.entries(WEATHER_DYNAMICS)) {
    ok(requiredFields.every((f) => typeof dyn[f] === 'number' && (dyn[f] > 0 || (w === 'snow' && dyn[f] === 0))),
      `天氣 ${w.padEnd(10)} 包含完整的風浪動態係數 (windAmp=${dyn.windAmp}, waveAmp=${dyn.waveAmp})`);
  }

  ok(WEATHER_DYNAMICS.heavy_rain.windAmp < WEATHER_DYNAMICS.storm.windAmp &&
     WEATHER_DYNAMICS.heavy_rain.waveAmp < WEATHER_DYNAMICS.storm.waveAmp,
    '降雨階梯風浪強度遞增 (大雨 1.8x/1.65x < 雷雨 2.4x/2.1x)');

  ok(WEATHER_DYNAMICS.snow.waveAmp === 0 && WEATHER_DYNAMICS.snow.waveSpeed === 0 && WEATHER_DYNAMICS.snow.isFrozen === true,
    '大雪 (snow) 參數設置水面凍結 (waveAmp=0, waveSpeed=0, isFrozen=true)');

  ok(WEATHER_DYNAMICS.windy.windAmp >= 2.5 && WEATHER_DYNAMICS.windy.waveAmp >= 2.2,
    '強風 (windy) 顯著放大樹木/旗幟擺幅與海浪高度 (windAmp 2.5x, waveAmp 2.2x)');
  ok(WEATHER_DYNAMICS.sandstorm.windAmp >= 2.3,
    '沙暴 (sandstorm) 具備強風級別的植被與旗幟擺幅 (windAmp 2.3x)');
}

// Ⅴ 7 維多元天氣屬性與連續布朗運動演化
console.log('\n▍Ⅴ 7 維多元天氣屬性與連續布朗運動演化 (weatherVectorAt)');
{
  const seasons = ['spring', 'summer', 'autumn', 'winter'];
  const times = ['dawn', 'day', 'dusk', 'night'];

  for (const s of seasons) {
    for (const tm of times) {
      const bias = SEASON_TIME_BIAS[s]?.[tm];
      ok(bias && WEATHER_ATTRS.every((a) => typeof bias[a] === 'number' && bias[a] >= 0 && bias[a] <= 100),
        `氣候傾向 ${s}・${tm} 7 維目標值全部合法於 [0, 100]`);
    }
  }

  // 驗證夏季午後高溫高對流 (雷雨/烏雲/大雨傾向顯著高於清晨)
  const sumDay = SEASON_TIME_BIAS.summer.day;
  const sumDawn = SEASON_TIME_BIAS.summer.dawn;
  ok(sumDay.clouds > sumDawn.clouds && sumDay.rain > sumDawn.rain && sumDay.thunder > sumDawn.thunder,
    '夏季白天午後熱對流具備高烏雲、大雨與雷鳴傾向');

  // 驗證冬季酷寒 (雪量傾向全天候 > 75%)
  ok(times.every((tm) => SEASON_TIME_BIAS.winter[tm].snow >= 75),
    '冬季 4 個時段之雪量傾向全部 ≥ 75%');

  // 驗證經過秒數演化的連續平滑度 (任意相鄰 1 秒變化量 < 2.0%)
  let lastVec = weatherVectorAt('summer', 'day', 'clear', 0, 42);
  let maxDelta = 0;
  for (let t = 1; t <= 300; t++) {
    const curVec = weatherVectorAt('summer', 'day', 'clear', t, 42);
    for (const a of WEATHER_ATTRS) {
      const delta = Math.abs(curVec[a] - lastVec[a]);
      if (delta > maxDelta) maxDelta = delta;
    }
    lastVec = curVec;
  }
  ok(maxDelta < 2.0, `布朗運動演化平滑連續 (單秒最大跳變量 ${maxDelta.toFixed(3)}% < 2.0%)`);
  ok(typeof lastVec.windDirDeg === 'number' && lastVec.windDirDeg >= 0 && lastVec.windDirDeg <= 360,
    `動態風向角合法於 [0, 360]° (實得 ${lastVec.windDirDeg}°)`);
}

// Ⅵ 各維度條件觸發與物理連動判定 (resolveWeatherDynamics)
console.log('\n▍Ⅵ 各維度條件觸發與物理連動判定 (resolveWeatherDynamics)');
{
  // 1. 烏雲門檻 (>50% 轉烏雲, 越高越黑)
  const dClear = resolveWeatherDynamics({ clouds: 30, rain: 90, sand: 0, snow: 0, thunder: 0, wind: 20 });
  const dDark = resolveWeatherDynamics({ clouds: 80, rain: 90, sand: 0, snow: 0, thunder: 0, wind: 20 });
  ok(!dClear.isDarkCloud && dClear.cloudDarkness === 0, '雲量 30% 保持白雲 (isDarkCloud=false, darkness=0)');
  ok(dDark.isDarkCloud && dDark.cloudDarkness === 0.6, '雲量 80% 轉為烏雲 (isDarkCloud=true, darkness=0.60)');

  // 2. 雨量條件: 烏雲時 (>50%) 才會真的下雨
  ok(dClear.effectiveRain === 0, '少雲時 (30% 雲量) 即使 rain=90 也不下雨 (effectiveRain=0)');
  ok(dDark.effectiveRain > 0.5, '烏雲時 (80% 雲量) rain=90 正常降雨 (effectiveRain=0.54)');

  // 3. 沙量條件: 75% 以上才會開始顯現
  const dSandLow = resolveWeatherDynamics({ clouds: 20, rain: 0, sand: 70, snow: 0, thunder: 0, wind: 40 });
  const dSandHigh = resolveWeatherDynamics({ clouds: 20, rain: 0, sand: 90, snow: 0, thunder: 0, wind: 40 });
  ok(dSandLow.effectiveSand === 0, '沙量 70% (<75%) 不顯現沙塵 (effectiveSand=0)');
  ok(dSandHigh.effectiveSand === 0.6, '沙量 90% (≥75%) 正常顯現沙塵暴 (effectiveSand=0.60)');

  // 4. 雪量條件: 75% 且烏雲時 (>50%) 才會真的下雪
  const dSnowNoCloud = resolveWeatherDynamics({ clouds: 40, rain: 0, sand: 0, snow: 85, thunder: 0, wind: 30 });
  const dSnowLow = resolveWeatherDynamics({ clouds: 80, rain: 0, sand: 0, snow: 70, thunder: 0, wind: 30 });
  const dSnowValid = resolveWeatherDynamics({ clouds: 80, rain: 0, sand: 0, snow: 85, thunder: 0, wind: 30 });
  ok(dSnowNoCloud.effectiveSnow === 0, '雪量 85% 但無烏雲 (40% 雲) 不下雪 (effectiveSnow=0)');
  ok(dSnowLow.effectiveSnow === 0, '烏雲 (80% 雲) 但雪量不足 70% 不下雪 (effectiveSnow=0)');
  ok(dSnowValid.effectiveSnow > 0.2, '烏雲 (80% 雲) 且雪量 85% 正常下雪 (effectiveSnow=0.24)');

  // 5. 凍結條件: 雪量 90% 時水波凍結 (waveAmp=0, waveSpeed=0) 與船隻停止
  const dFreeze = resolveWeatherDynamics({ clouds: 85, rain: 0, sand: 0, snow: 95, thunder: 0, wind: 70 });
  ok(dFreeze.isFrozen && dFreeze.waveAmp === 0 && dFreeze.waveSpeed === 0,
    '雪量 ≥ 90% 觸發水波凍結 (isFrozen=true, waveAmp=0, waveSpeed=0)');

  // 6. 打雷條件: 75% 以上才會開始打雷
  const dThunderLow = resolveWeatherDynamics({ clouds: 90, rain: 80, sand: 0, snow: 0, thunder: 70, wind: 60 });
  const dThunderHigh = resolveWeatherDynamics({ clouds: 90, rain: 80, sand: 0, snow: 0, thunder: 90, wind: 60 });
  ok(dThunderLow.effectiveThunder === 0, '雷量 70% (<75%) 不打雷 (effectiveThunder=0)');
  ok(dThunderHigh.effectiveThunder === 0.6, '雷量 90% (≥75%) 正常觸發打雷閃電 (effectiveThunder=0.60)');

  // 7. 風量與風向連動
  const dWind = resolveWeatherDynamics({ clouds: 30, fog: 10, wind: 80, rain: 0, sand: 0, snow: 0, thunder: 0, windDirDeg: 90 });
  ok(dWind.windAmp > 2.0 && dWind.waveAmp > 1.8, '風量 80% 正確放大風浪係數 (windAmp > 2.0, waveAmp > 1.8)');
  ok(Math.abs(dWind.windDir[0] - 0) < 1e-3 && Math.abs(dWind.windDir[1] - 1) < 1e-3,
    '風向 90° 正確導出向量 [cos 90°, sin 90°] = [0, 1]');
}

console.log(`\n🎉 天氣與天文日照系統稽核通過: ${pass} 通過 / ${fail} 失敗`);
if (fail > 0) process.exit(1);
