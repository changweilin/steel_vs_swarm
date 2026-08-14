// ============ 時間流逝(日夜循環)+ 太陽/月亮/影子 稽核 ============
// 用途:改 `data.js` 的 `DAYCLOCK`/`clockHour`/`phaseBlend`/`sunDirAt`/`bodyFade`/`SHADOW`、
// `environment.js` 的 `TIMES`/`mixTime`/`setHour`/`makeBodies`、`game.js` 的 `_simT`/座艙投影旗標、
// `models.js` 的投影旗標、`ground.js` 的收影面之後跑。
//
// 這一族**沒有任何既有防線**:天色與影子是純表現層 ⇒ `npm run bal` / `npm test` 一格都不會動,
// 而壞掉的樣子全部是「畫面看起來怪怪的」:
//   ㋐ **兩台客戶端的天色分家** —— 只要有人把時鐘改成本地累加(而不是伺服器經過秒數),
//      同一場戰鬥裡兩個人看到的太陽會慢慢錯開。它不報錯、不掉幀、也不影響任何判定,
//      唯一的症狀是有人說「你那邊天比較亮」。故本支釘死「時鐘是純函式 + 唯一來源是快照」。
//   ㋑ **主光換手跳一下** —— 太陽落海要換成月亮,方向從西邊 horizon 跳到東邊 horizon。
//      沒有 `bodyFade` 把兩端都收到 0 的話,整場的影子會在那一幀整個翻面。
//   ㋒ **色表與軌道各說各話** —— 舊制的 `TIMES[].elev` 是第二把尺;留著它就會出現
//      「黃昏的影子方向與看得見的太陽對不上」,而每一行讀數都正常。
//   ㋓ **座艙投影** —— FPV 座艙掛在相機底下、武裝是從第三人稱機體複製過來的子樹(連
//      `castShadow` 一起複製)⇒ 正前方地面會糊一大塊黑影,讀起來像「這一版地面變髒了」。
//
// 手法:純數學那半直接 import(data.js 是純模組);environment.js / game.js / models.js 走
// **執行原文**(它們 import three,Node 端載不動;抄一份公式進稽核就永遠會通過)。
// 跑法:`node tools/audit_daynight.mjs`
//   反向驗證:--break-clock(時鐘改成本地累加)/ --break-fade(拿掉地平線淡出)
//             --break-elev(色表復辟 elev 欄)/ --break-cockpit(座艙又會投影)
//             --break-range(陰影範圍改成手寫)
import { readSrc, grabMethod } from './audit_src.mjs';
import {
  ENV, DAYCLOCK, dayHourRate, clockHour, clockLabel, phaseBlend,
  sunDirAt, moonDirAt, bodyFade, SHADOW, shadowRangeM, TARGET_H,
} from '../public/js/data.js';

const BREAK = new Set(process.argv.filter((a) => a.startsWith('--break-')));
const brk = (k) => BREAK.has(`--break-${k}`);

/**
 * 反向驗證:**真的把原文改成壞版**再驗(§5.4 ㋑)。只把期望值翻面的話,`--break-*` 證明不了
 * 那條斷言真的咬得住東西。替換不生效 MUST **當場失敗** —— 靜默 no-op 的 break 恆綠。
 */
function mut(src, key, from, to) {
  if (!brk(key)) return src;
  if (!src.includes(from)) { console.error(`--break-${key}:找不到要替換的原文「${from.slice(0, 50)}…」`); process.exit(2); }
  return src.replace(from, to);
}

const envSrc = mut(readSrc('public', 'js', 'environment.js'), 'elev',
  '  day:   { sky: 0x8fa9bd,', '  day:   { elev: 0.55, sky: 0x8fa9bd,');
const gameSrc = mut(mut(readSrc('public', 'js', 'game.js'), 'clock',
  'this._simT + d * 0.25', 'this._simT'), 'cockpit',
  'g.traverse((o) => { if (o.isMesh) o.castShadow = false; });', '');
const modelSrc = readSrc('public', 'js', 'models.js');
const groundSrc = readSrc('public', 'js', 'ground.js');
const prefSrc = readSrc('public', 'js', 'visualPrefs.js');

/** 只數執行原文(註解裡提得到同一個名字,連著數會把「說明寫得詳細」誤判成「縫破了」) */
const code = (s) => s
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .split('\n').map((l) => l.replace(/(^|[^:'"`])\/\/.*$/, '$1')).join('\n');

let pass = 0, fail = 0;
const t = (n, ok, extra = '') => { ok ? (pass++, console.log(`  ✓ ${n}`)) : (fail++, console.log(`  ✗ ${n} ${extra}`)); };
const near = (a, b, e = 1e-9) => Math.abs(a - b) <= e;

// ---------------------------------------------------------------------------
console.log('■ Ⅰ 時鐘(10 分鐘 = 遊戲 8 小時;純函式)');
// ---------------------------------------------------------------------------
{
  t('速率 = GAME_H / REAL_S', near(dayHourRate(), DAYCLOCK.GAME_H / DAYCLOCK.REAL_S));
  t(`真實 ${DAYCLOCK.REAL_S}s 恰好走 ${DAYCLOCK.GAME_H} 遊戲小時`,
    near(DAYCLOCK.REAL_S * dayHourRate(), DAYCLOCK.GAME_H));
  // 使用者定案的兩個數字(10 分鐘 / 8 小時)—— 改它 MUST 是刻意的
  t('使用者定案:600 秒 ↔ 8 小時', DAYCLOCK.REAL_S === 600 && DAYCLOCK.GAME_H === 8,
    `(${DAYCLOCK.REAL_S}s / ${DAYCLOCK.GAME_H}h)`);

  // 純函式:同樣的輸入恆同樣的輸出,而且**只吃兩個參數**
  const a = clockHour('dusk', 123.4), b = clockHour('dusk', 123.4);
  t('clockHour 是純函式(同輸入同輸出)', a === b);
  t('鐘點恆落在 [0,24)', [0, 1, 599, 600, 5000, 86400].every((s) => {
    const h = clockHour('night', s); return h >= 0 && h < 24;
  }));
  t('繞一整天回到原點', near(clockHour('day', 24 / dayHourRate()), clockHour('day', 0), 1e-9));
  t(`clockLabel 格式(${clockLabel(clockHour('dawn', 0))})`, /^\d\d:\d\d$/.test(clockLabel(clockHour('dawn', 0))));

  // 四個開場時段 MUST 與 ENV.times 的鍵**逐位元相同**:漏一個 = 選單選得到而時鐘認不得
  // (`clockHour` 退回 day ⇒ 選了清晨卻從上午開打,而沒有任何錯誤訊息)
  const envKeys = Object.keys(ENV.times).sort().join(',');
  t(`START_H 名冊 = ENV.times(${envKeys})`, Object.keys(DAYCLOCK.START_H).sort().join(',') === envKeys);
  t('PHASE_H 名冊 = ENV.times', Object.keys(DAYCLOCK.PHASE_H).sort().join(',') === envKeys);
  t('清晨(dawn)在選單裡', !!ENV.times.dawn);
}

// ---------------------------------------------------------------------------
console.log('\n■ Ⅱ 基調內插(phaseBlend:環狀覆蓋 + 連續)');
// ---------------------------------------------------------------------------
{
  let covered = true, jump = 0, prev = null;
  const val = (h) => { const p = phaseBlend(h); return { p, k: `${p.a}>${p.b}` }; };
  for (let h = 0; h < 24; h += 0.005) {
    const { p } = val(h);
    if (!DAYCLOCK.PHASE_H[p.a] === undefined || !(p.t >= 0 && p.t <= 1)) covered = false;
    // 連續性:把 (a,b,t) 攤成「離 a 錨點多遠」的一維量,兩步之間不得跳
    const scalar = DAYCLOCK.PHASE_H[p.a] + p.t;
    if (prev !== null && p.a === prev.a) jump = Math.max(jump, Math.abs(scalar - prev.s));
    prev = { a: p.a, s: scalar };
  }
  t('整圈都落在某一對錨點之間,且 t ∈ [0,1]', covered);
  t(`同一段之內 t 連續(最大單步 ${jump.toFixed(5)})`, jump < 0.02);

  // 錨點上**混出來的就是那一格本身**。兩種等價寫法都合法:落在 (k, next) 的 t=0,
  // 或落在 (prev, k) 的 t=1(取決於區間端點怎麼歸屬)—— 判的是「混完等於 k」不是索引長怎樣。
  for (const [k, h] of Object.entries(DAYCLOCK.PHASE_H)) {
    const p = phaseBlend(h);
    const isK = (p.a === k && near(p.t, 0)) || (p.b === k && near(p.t, 1));
    t(`錨點 ${k}(${h}:00)混出來就是 ${k} 本身`, isK, `→ ${p.a}→${p.b} t=${p.t}`);
  }
  // smoothstep:兩端斜率為 0(線性內插在錨點上有折角,天色會「頓一下」)
  const d0 = phaseBlend(DAYCLOCK.PHASE_H.day + 0.001).t;
  t('過渡是 smoothstep 不是線性(錨點附近變化極慢)', d0 < 1e-5, `(${d0})`);
}

// ---------------------------------------------------------------------------
console.log('\n■ Ⅲ 太陽 / 月亮軌道(單位向量・日出日落是定義・月亮 = 太陽 +12h)');
// ---------------------------------------------------------------------------
{
  let unit = true, maxEl = -1;
  for (let h = 0; h < 24; h += 0.01) {
    const s = sunDirAt(h);
    if (Math.abs(Math.hypot(s.x, s.y, s.z) - 1) > 1e-9) unit = false;
    maxEl = Math.max(maxEl, Math.asin(s.y) * 180 / Math.PI);
  }
  t('方向恆為單位向量', unit);
  t(`正午仰角 = MAX_ELEV_DEG(${DAYCLOCK.MAX_ELEV_DEG}°,實測 ${maxEl.toFixed(2)}°)`,
    near(maxEl, DAYCLOCK.MAX_ELEV_DEG, 0.01));
  t(`日出 ${DAYCLOCK.RISE_H}:00 恰在地平線`, near(sunDirAt(DAYCLOCK.RISE_H).y, 0, 1e-12));
  t(`日落 ${DAYCLOCK.SET_H}:00 恰在地平線`, near(sunDirAt(DAYCLOCK.SET_H).y, 0, 1e-12));
  t('東升(日出時朝 +x)', sunDirAt(DAYCLOCK.RISE_H).x > 0.9);
  t('西落(日落時朝 −x)', sunDirAt(DAYCLOCK.SET_H).x < -0.9);
  t('白天在天上 / 夜裡在地下', sunDirAt(12).y > 0 && sunDirAt(0).y < 0);
  const p24 = sunDirAt(3), p48 = sunDirAt(27);
  t('週期恰 24 小時', near(p24.x, p48.x, 1e-9) && near(p24.y, p48.y, 1e-9) && near(p24.z, p48.z, 1e-9));
  const m = moonDirAt(9), s12 = sunDirAt(21);
  t('月亮 = 同一支 sunDirAt +12h(沒有第二份軌道)',
    near(m.x, s12.x) && near(m.y, s12.y) && near(m.z, s12.z));
  t('sunDirAt 全檔只有一份軌道公式(moonDirAt 是轉呼)',
    /moonDirAt\s*=\s*\(hour\)\s*=>\s*sunDirAt\(hour \+ 12\)/.test(code(readSrc('public', 'js', 'data.js'))));
}

// ---------------------------------------------------------------------------
console.log('\n■ Ⅳ 主光換手(㋑:太陽落海換月亮那一刻不可以跳)');
// ---------------------------------------------------------------------------
{
  // 消費端的規則:上方 = 太陽、否則月亮;強度乘 bodyFade(該天體的高度)
  const fade = brk('fade') ? () => 1 : bodyFade;       // 反向驗證:拿掉地平線淡出
  const lit = (h) => {
    const s = sunDirAt(h), mo = moonDirAt(h);
    const up = s.y > 0, d = up ? s : mo, f = fade(up ? s.y : mo.y);
    return [d.x * f, d.y * f, d.z * f];
  };
  let jump = 0, at = 0;
  let prev = lit(0);
  for (let h = 0.01; h <= 24; h += 0.01) {
    const v = lit(h);
    const j = Math.hypot(v[0] - prev[0], v[1] - prev[1], v[2] - prev[2]);
    if (j > jump) { jump = j; at = h; }
    prev = v;
  }
  t(`主光向量沒有突跳(最大單步 ${jump.toFixed(4)} @ ${clockLabel(at)})`, jump < 0.05,
    '← 換手處兩端都要被 bodyFade 收到 0');
  t('日出日落當下主光恆為 0(換手發生在沒有影子的時候)',
    near(bodyFade(sunDirAt(DAYCLOCK.RISE_H).y), 0) && near(bodyFade(sunDirAt(DAYCLOCK.SET_H).y), 0));
  t('正午 / 午夜主光滿格', near(bodyFade(sunDirAt(12).y), 1) && near(bodyFade(moonDirAt(0).y), 1));
  t('bodyFade 夾在 [0,1]', [-1, -0.01, 0, 0.05, 1].every((y) => { const f = bodyFade(y); return f >= 0 && f <= 1; }));
}

// ---------------------------------------------------------------------------
console.log('\n■ Ⅴ 陰影範圍(推導不手寫)');
// ---------------------------------------------------------------------------
{
  const dsrc = code(mut(readSrc('public', 'js', 'data.js'), 'range',
    'export const shadowRangeM = (size = SHADOW.SIZE) => size * SHADOW.TEXEL_M / 2;',
    'export const shadowRangeM = () => 123;'));
  t('shadowRangeM 由貼圖尺寸 × texel 推導(MUST NOT 手寫公尺數)',
    /shadowRangeM\s*=\s*\(size = SHADOW\.SIZE\) => size \* SHADOW\.TEXEL_M \/ 2/.test(dsrc));
  t(`低解析度貼圖的範圍自己跟著折半(${shadowRangeM()} → ${shadowRangeM(SHADOW.SIZE_LOW)}m)`,
    near(shadowRangeM(SHADOW.SIZE_LOW) * (SHADOW.SIZE / SHADOW.SIZE_LOW), shadowRangeM()));
  // 兩個可檢查的取捨數字(檔頭寫的就是這兩個)
  const mechTexels = 4.5 / SHADOW.TEXEL_M;
  t(`機體(4.5m)的影子橫跨 ${mechTexels.toFixed(0)} texel(≥ 24 才夠利)`, mechTexels >= 24);
  t(`涵蓋半徑 ${shadowRangeM()}m ≥ 砲塔高 ${TARGET_H.tower}m 的 4 倍(近戰範圍內看得到影子)`,
    shadowRangeM() >= TARGET_H.tower * 4);
  t('框心往視線前方推(AHEAD_F ∈ (0,1))', SHADOW.AHEAD_F > 0 && SHADOW.AHEAD_F < 1);
}

// ---------------------------------------------------------------------------
console.log('\n■ Ⅵ environment.js(㋒ 色表沒有第二把尺 + 每幀只寫既有實例)');
// ---------------------------------------------------------------------------
{
  const E = code(envSrc);
  const timesBlock = /const TIMES = \{[\s\S]*?\n\};/.exec(E)?.[0] || '';
  t('TIMES 名冊 = ENV.times(四格)',
    Object.keys(ENV.times).every((k) => new RegExp(`\\n  ${k}:`).test(timesBlock)),
    timesBlock.slice(0, 60));
  const elevBack = brk('elev') || /\belev:/.test(timesBlock);
  t('TIMES 沒有 elev 欄(太陽在哪只由 sunDirAt 決定,MUST NOT 有第二把尺)', !elevBack);
  t('全檔沒有第二份 az / 仰角公式', !/const az = env\?\.time/.test(E));

  const setHour = /function setHour\(h\) \{[\s\S]*?\n  \}/.exec(E)?.[0] || '';
  t('setHour 抽得到', !!setHour);
  // 每幀跑的那一段 MUST NOT 配新的 three 物件(重建材質/顏色 = 幻燈片 + GC 壓力)
  t('setHour 每幀不配新物件(沒有 new THREE.)', !/new THREE\./.test(setHour));
  t('setHour 不重建穹頂 / 雲 / 燈', !/makeSkyDome|makeClouds|new THREE\.(Directional|Hemisphere)Light/.test(setHour));
  t('setHour 走 phaseBlend + mixTime(不是查表)', /phaseBlend\(h\)/.test(setHour) && /mixTime\(/.test(setHour));
  t('setHour 更新穹頂三個停點', /uH\.value\.copy/.test(setHour) && /uZ\.value\.copy/.test(setHour));
  t('setHour 把當下光向餵給賽璐璐高光(setCelSun)', /setCelSun\(/.test(setHour));
  t('setCelSun 全檔只有這一處(舊制那一行在建構期,會停在開場那一格)',
    (E.match(/setCelSun\(/g) || []).length === 1);

  t('太陽 / 月亮圓盤 MUST 吃深度測試(否則山稜線後面的太陽浮在山坡上)',
    !/depthTest:\s*false/.test(E));
  t('圓盤方向取 data.js 那一份(sunDirAt / moonDirAt)',
    /sunDirAt\(h\)/.test(E) && /moonDirAt\(h\)/.test(E));
  t('圓盤是純表現層(不進 blockers)', !/blockers/.test(E));
  t('圓盤在 dispose 裡有回收(A25)', /bodies\.dispose\(\)/.test(E));

  // 影子那一段
  t('陰影開關由呼叫端給(environment.js 自己不讀 visualPref)', !/visualPref/.test(E));
  t('陰影正交框走 shadowRangeM(不手寫)', /shadowRangeM\(shSize\)/.test(E));
  t('框心量化到 texel(不量化 = 影子邊緣爬行)', /Math\.round\(px \/ q\) \* q/.test(E));
}

// ---------------------------------------------------------------------------
console.log('\n■ Ⅶ game.js(㋐ 時鐘唯一來源 = 伺服器快照;㋓ 座艙不投影)');
// ---------------------------------------------------------------------------
{
  const G = code(gameSrc);
  const snap = grabMethod(gameSrc, '_applySnap');
  t('_applySnap 以快照 time 對錶(權威時鐘)', /m\.time/.test(snap) && /this\._simT/.test(snap));
  t('對錶是**拉向**不是硬貼(硬貼 = 太陽隨 8Hz 量化抖動)',
    /this\._simT \+ d \* 0\.25/.test(snap));
  t('差太多才直接貼上(斷線重連 / 分頁背景化)', /Math\.abs\(d\) > 3/.test(snap));
  t('_simT 只有兩個寫入點(每幀 += dt、快照對錶)',
    (G.match(/this\._simT\s*(\+=|=)/g) || []).length === 3, // 建構期歸零 + 兩個
    `實際 ${(G.match(/this\._simT\s*(\+=|=)/g) || []).length} 處`);
  t('envFx.update 收到經過秒數', /envFx\?\.update\(dt, this\.camera, this\._simT\)/.test(G));
  t('空氣透視每幀重推(顏色跟著天色走)', /setAirFog\(airNow\.near, airNow\.far/.test(G));

  const cockpitCast = /g\.traverse\(\(o\) => \{ if \(o\.isMesh\) o\.castShadow = false; \}\);/.test(G);
  t('FPV 座艙 MUST NOT 投影(它掛在相機底下,武裝是機體子樹的複本)', cockpitCast);
  t('陰影圖開關讀 visualPref(\'shadow\') 且吃 ?shadow=0',
    /visualPref\('shadow'\) === 'on' && !off\('shadow'\)/.test(G));
  t('renderer.shadowMap 由 game.js 開(renderer 是它的)',
    /this\.renderer\.shadowMap\.enabled = shadowOn/.test(G));
}

// ---------------------------------------------------------------------------
console.log('\n■ Ⅷ 投影旗標的兩個唯一縫(makeUnit 投射 / buildGroundCover 承接)');
// ---------------------------------------------------------------------------
{
  const M = code(modelSrc);
  const tail = M.slice(M.lastIndexOf('if (ring) g.add(teamRing('));
  t('makeUnit 收尾統一掛投影旗標(所有單位都經過它)', /o\.castShadow = true/.test(tail));
  t('描邊外殼排除(反轉殼會投出脹大一圈的黑影)', /o\.userData\.isOutline/.test(tail));
  t('半透明件排除(陰影圖只寫深度 ⇒ 半透明會變實心黑塊)', /m\.transparent/.test(tail));
  t('game.js 沒有第二處逐生成點設旗標',
    (code(gameSrc).match(/castShadow = true/g) || []).length === 0);

  const GR = code(groundSrc);
  t('地貌層整組收影子(只有 terrain.mesh 收 = 有底毯的地方影子整片消失)',
    /group\.traverse\(\(o\) => \{ if \(o\.isMesh\) o\.receiveShadow = true; \}\);/.test(GR));
  t('地貌層不投射(貼地面自己投不出東西)', !/castShadow = true/.test(GR));

  t('設定頁有「日照投影」開關且預設開', /shadow: \{[\s\S]*?def: 'on'/.test(code(prefSrc)));
}

// ---------------------------------------------------------------------------
console.log(`\n${fail ? '❌' : '🎉'} 日夜循環稽核:${pass} 通過 / ${fail} 失敗`);
if (BREAK.size) console.log(`   (反向驗證模式:${[...BREAK].join(' ')} —— 上面 MUST 有紅字)`);
process.exit(fail ? 1 : 0);
