// ============ 賽璐璐管線稽核(ramp 家族 / 天空穹頂 / 地形色階梯 / 描邊寬度)============
// 用途:這一批全是**純表現層**改動 —— `npm run bal` 與 e2e 天然不會動(㋒),所以完全沒有
// 既有防線。畫面回歸的特性是「沒有錯誤訊息,只是變醜」,而「變醜」在文字測試裡是隱形的,
// 故一律以**原始碼文字 + 純函式直測**釘住那些一改就整片走樣的不變量。
//
// 四段:
//   Ⅰ ramp 家族(toon.js RAMPS / toonGradient(bands))
//     ・3 階 MUST **逐位元** [102,182,255] —— 改了整個場景重新上色;
//     ・每一組的暗階 MUST ≥ 102(A14 / #INC-106:低於此深色件疊 cool 會塌成全黑);
//     ・ramp 的 DataTexture MUST 只在 toon.js 建構(散出去 = 同一個場景兩套明暗規則)。
//   Ⅱ 天空穹頂(environment.js skyStops / makeSkyDome / makeClouds)
//     ・**MUST NOT 開第四張色表**:停點只由 TIMES/SEASONS/WEATHERS 推導 ⇒ skyStops 內
//       出現任何十六進位色值就是違規(否則某些季節 × 天氣組合裡天空與霧色會對不上);
//     ・兩道封頂(不得亮過今天的天色 / 雨霧天不得亮過霧遠端色)以**真品原文**直測;
//     ・雲量與 light 反比、霧天零雲、散布走 mulberry32(§2.3,MUST NOT Math.random)。
//   Ⅲ 地形(terrain.js / field.js)
//     ・兩條路徑都走 envMat + rim:0(貼地平面掠射角 rim 全開會整片洗白);
//     ・色階由**相對亮度**設計:亮度嚴格遞增、**階差嚴格遞減**(暗端分得開、亮端不過曝);
//     ・**單一色階佔比 ≤ 35%**:直接跑 field.js 真品掃 27 場地 × 三種隊制 —— 這是「88% 的
//       坡面同一個顏色」那個病灶唯一量得到的地方,固定門檻實測最壞 51.3%,故門檻取分位數;
//     ・field.js MUST 是加權平均(不是加總,加總會飽和成常數)且分母有下限。
//   Ⅳ 描邊寬度(toon.js outlineMaterial)
//     ・螢幕下限 MUST 由 `projectionMatrix[1][1]` 反推(手寫換算 = 狙擊一開鏡描邊全變粗);
//     ・MUST 是 `max(世界寬, 螢幕下限)` ⇒ 近距離逐位元同舊制(15 處呼叫端不必重調);
//     ・**兩個外推量都 MUST 換成局部單位**(2026-08-10「主堡黑球」):它們一起加在
//       `position` 上,而螢幕下限是由**視距**(世界公尺)換算來的 ⇒ 少除一次世界縮放,
//       實得線寬就是「下限 × 世界縮放」,又因為它 ∝ 視距 ⇒ 離越遠脹越大、沒有上界。
//       主堡的 dome.glb 世界縮放 795× ⇒ 450m 外的黑殼被推出 530m。**執行原文的兩條
//       運算式**(uOMin 的值 + outlinify 的 jobs.push)還原整條 GLSL,量的是**螢幕半寬**
//       —— 這是唯一與世界縮放無關的量,而它也正是這個常數宣稱要鎖住的東西。
//       反向驗證 `--break-scale`(退回不除世界縮放)。
//     ・SkinnedMesh 的 bind 分支與 `userData.outlineGeo` 平滑法線分支 MUST 留著。
//   Ⅶ 地貌不出接縫(2026-08-13 使用者定案「LUT 與勾線不針對地貌作用,不要看出地貌拼圖
//     接縫,但地形變化受 LUT 與勾線作用」)
//     ・**地貌共用一個 surfaceId**(`toon.js LAND_SURF_ID = 0`,永遠不會被 nextSurfId 抽到)
//       ⇒ 拼圖之間 id 差恆 0(不出線)、與建物/道路仍差得開(牆腳那條線不會少);
//     ・貼地拼圖的 gInfo 法線改吃 `aLandN`(真地形法線):**它是 (x,z) 的純函式** ⇒ 相鄰
//       拼圖在共用邊上逐位元同值(接縫不是被壓下去,是根本不存在),而稜線/路塹照樣出線
//       —— 「地形變化受勾線作用」就是這一條;取樣距 MUST 是地形網格的格距;
//     ・LUT 的地貌分支 MUST 是 `lutApply(vec3(y)) + (c − vec3(y))` 這個**仿射分解**:
//       色度差的增益因此恆為 1(LUT 再激進也顯不出接縫),亮度仍整條走表(受光 = 地形);
//     ・資訊緩衝配不配 vs 誰在用它是**兩件事**:開 LUT MUST NOT 順手把折邊勾線打開。
//     反向驗證 `--break-land`(地貌不共用 id)/ `--break-lutland`(LUT 地貌分支退回直接查表)。
// 跑法:node tools/audit_cel_pipeline.mjs [--break-scale] [--break-inkinfo] [--break-land] [--break-lutland]
import { readdirSync } from 'node:fs';
import { readSrc } from './audit_src.mjs';
import { VENUES, venueConfig } from '../public/js/venues.js';
import { makeField, makeToneLadder } from '../public/js/field.js';

const toon = readSrc('public', 'js', 'toon.js');
const env = readSrc('public', 'js', 'environment.js');
const terr = readSrc('public', 'js', 'terrain.js');
const field = readSrc('public', 'js', 'field.js');
const game = readSrc('public', 'js', 'game.js');
const postfx = readSrc('public', 'js', 'postfx.js');

/** 反向驗證:把螢幕下限退回「不除世界縮放」的舊制 ⇒ Ⅳ MUST 紅字 */
const BREAK_SCALE = process.argv.includes('--break-scale');
/** 反向驗證:模擬新增了一支進場景的 ShaderMaterial 卻忘了宣告 gInfo ⇒ Ⅵ MUST 紅字 */
const BREAK_INK = process.argv.includes('--break-inkinfo');
/** 反向驗證:地貌退回逐材質 surfaceId(= 每一格拼圖的邊都畫線)⇒ Ⅶ MUST 紅字 */
const BREAK_LAND = process.argv.includes('--break-land');
/** 反向驗證:LUT 的地貌分支退回直接查表(= 色差被表放大)⇒ Ⅶ MUST 紅字 */
const BREAK_LUTLAND = process.argv.includes('--break-lutland');
let pass = 0, fail = 0;
const ok = (c, msg) => { c ? (pass++, console.log(`  ✓ ${msg}`)) : (fail++, console.error(`  ✗ ${msg}`)); };
/** 只留「真的會執行的程式碼」—— 註解裡提到某個名字不算違規 */
const code = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1');
/** 抽出頂層具名函式原文(大括號配對) */
function grabFn(src, name) {
  const i = src.indexOf(`\nfunction ${name}(`);
  if (i < 0) throw new Error(`找不到 function ${name}`);
  let d = 0, started = false, j = i;
  for (; j < src.length; j++) {
    if (src[j] === '{') { d++; started = true; }
    else if (src[j] === '}') { d--; if (started && d === 0) { j++; break; } }
  }
  return src.slice(i, j);
}

console.log('== 賽璐璐管線稽核 ==\n');

console.log('Ⅰ ramp 家族');
const RAMPS = new Function(`${/const RAMPS = \{[\s\S]*?\};/.exec(toon)[0]}\nreturn RAMPS;`)();
{
  ok(JSON.stringify(RAMPS[3]) === JSON.stringify([102, 182, 255]),
    `3 階 ramp 逐位元不變 [102,182,255](實測 ${JSON.stringify(RAMPS[3])})`);
  const bad = Object.entries(RAMPS).filter(([, v]) => v[0] < 102).map(([k]) => k);
  ok(bad.length === 0, `每一組的暗階 ≥ 102(A14 / #INC-106)${bad.length ? `;違規:${bad.join(',')}` : ''}`);
  for (const [k, v] of Object.entries(RAMPS)) {
    ok(v.every((x, i) => i === 0 || x > v[i - 1]), `ramp ${k} 嚴格遞增(階梯不得反向)`);
  }
  ok(/toonGradient\(bands = 3\)/.test(toon), 'toonGradient 預設 3 階(呼叫端不傳 ⇒ 逐位元同舊制)');
  ok(/const key = RAMPS\[bands\] \? bands : 3;/.test(code(toon)), '未知 bands 回退 3(缺鍵不炸,原則 6)');
  ok(/gradientMap: toonGradient\(bands\)/.test(code(toon)) &&
     [...code(toon).matchAll(/toonGradient\(bands\)/g)].length === 2,
    'toonMat / envMat 兩支各把 opts.bands 轉給 toonGradient');
  // ramp 的 DataTexture 只准在 toon.js 建構
  const others = ['environment.js', 'terrain.js', 'biomes.js', 'models.js', 'vfx.js', 'castfx.js', 'hazards.js', 'game.js']
    .filter((f) => /new THREE\.DataTexture\(/.test(code(readSrc('public', 'js', f))));
  ok(others.length === 0, `ramp 的 DataTexture 只在 toon.js 建構${others.length ? `;越界:${others.join(',')}` : ''}`);
}

console.log('\nⅡ 天空穹頂');
{
  const stopsSrc = grabFn(env, 'skyStops');
  ok(!/0x[0-9a-fA-F]{3,}/.test(code(stopsSrc)),
    'skyStops 內沒有任何十六進位色值(顏色一律由 TIMES/SEASONS/WEATHERS 推導,MUST NOT 開第四張色表)');
  // 真品直測:用最小 Color 替身跑 skyStops 的原文
  class C {
    constructor(r, g, b) { this.r = r; this.g = g; this.b = b; }
    clone() { return new C(this.r, this.g, this.b); }
    multiplyScalar(s) { this.r *= s; this.g *= s; this.b *= s; return this; }
    lerp(o, t) { this.r += (o.r - this.r) * t; this.g += (o.g - this.g) * t; this.b += (o.b - this.b) * t; return this; }
  }
  const L = (c) => c.r * 0.2126 + c.g * 0.7152 + c.b * 0.0722;
  const lumSrc = /const lum = \(c\) =>[^\n]*\n/.exec(env)[0];
  const capSrc = grabFn(env, 'capLum');
  const skyStops = new Function(`${lumSrc}${capSrc}\n${stopsSrc}\nreturn skyStops;`)();
  const WS = {
    clear: { light: 1.0, fogNear: 0.50, fogFar: 1.9 },
    rain: { light: 0.45, fogNear: 0.20, fogFar: 1.0 },
    fog: { light: 0.50, fogNear: 0.04, fogFar: 0.35 },
  };
  // 夜戰:天空那半(中段/天頂)不得亮過今天的天色 —— 地平線階刻意豁免(它就是霧色本身,
  // 而霧色今天已經畫在同一排像素上;夾它只會生出一條橫貫畫面的接縫)
  const nightSky = new C(0.04, 0.07, 0.12), nightFog = new C(0.05, 0.08, 0.13);
  for (const [wn, W] of Object.entries(WS)) {
    const s = skyStops(nightSky, nightFog, W);
    const mx = Math.max(L(s.mid), L(s.zen));
    ok(mx <= L(nightSky) + 1e-9, `夜戰 ${wn}:天空階不超過天色(${mx.toFixed(4)} ≤ ${L(nightSky).toFixed(4)})`);
  }
  // 雨/霧天:不得亮過霧的遠端色(霧茫茫的地面上不可以頂著一片亮天)
  const daySky = new C(0.56, 0.66, 0.74), dayFog = new C(0.60, 0.67, 0.73);
  for (const wn of ['rain', 'fog']) {
    const s = skyStops(daySky, dayFog, WS[wn]);
    const mx = Math.max(L(s.mid), L(s.zen));
    ok(mx <= L(dayFog) + 1e-9, `${wn} 天:天空階不超過霧遠端色(${mx.toFixed(4)} ≤ ${L(dayFog).toFixed(4)})`);
  }
  // 晴天仍要有層次(封頂不得把三階壓成同一個值)
  const clear = skyStops(daySky, dayFog, WS.clear);
  ok(Math.abs(L(clear.zen) - L(clear.horiz)) > 0.02,
    `晴天天頂與地平線有可見亮度差(${(L(clear.horiz) - L(clear.zen)).toFixed(3)})`);
  ok(Math.abs(L(clear.horiz) - L(dayFog)) < 1e-9, '地平線階 = 霧色本身(遠景融進天空是恆等式,不是調出來的)');

  const E = code(env);
  ok(/dome\.frustumCulled = false/.test(E), '穹頂 frustumCulled = false(中心恆在相機上)');
  ok(/dome\.renderOrder = -10/.test(E), '穹頂 renderOrder = -10(最先畫)');
  ok(/side: THREE\.BackSide, depthWrite: false, fog: false/.test(E), '穹頂 BackSide + 不寫深度 + 不吃霧');
  ok(/dome\.position\.copy\(camera\.position\)/.test(E), '穹頂逐幀跟相機(天空沒有視差,否則走到圖邊會看到天空的邊)');
  ok(/dome\.geometry\.dispose\(\); dome\.material\.dispose\(\)/.test(E), 'A25:dispose 釋放穹頂幾何與材質');
  ok(/clouds\.mats\.forEach\(\(m\) => m\.dispose\(\)\)/.test(E), 'A25:dispose 釋放雲的材質');
  const cl = grabFn(env, 'makeClouds');
  ok(/CLOUD_N \* \(1\.05 - W\.light\)/.test(code(cl)), '雲量與 WEATHERS[w].light 反比(推導,不是逐天氣手寫)');
  ok(/W\.fogNear <= 0\.05/.test(code(cl)), '霧天零雲(判據取既有表的 fogNear,不是新旗標)');
  ok(/mulberry32\(/.test(code(cl)) && !/Math\.random/.test(code(cl)), '雲的散布走 mulberry32(§2.3,MUST NOT Math.random)');
  ok(/depthWrite: false, fog: false/.test(code(cl)), '雲不寫深度、不吃霧');
}

console.log('\nⅢ 地形 cel 補丁 + 色階梯');
{
  const T = code(terr);
  ok(!/new THREE\.MeshToonMaterial\(\{ (map: tex|color: 0x39424c)/.test(T),
    '地形不再是裸 MeshToonMaterial(舊制拿不到 wash / cool)');
  ok([...T.matchAll(/envMat\(/g)].length === 3, '地形兩條路徑 + 水面共三處走 envMat');
  ok([...T.matchAll(/rim: 0/g)].length === 3, '三處都傳 rim: 0(貼地平面掠射角 rim 全開會整片洗白)');
  ok(/bands: 4/.test(T), '地形取 4 階 ramp(3 階在整片山坡上只有一刀明暗界)');
  ok(/bands: 'soft'/.test(T), '水面取 soft ramp(淺色大面積)');
  ok(/vertexColors: true/.test(T) && /paintTerrainTones\(/.test(T), '無影像路徑走屬性場色階梯');
  ok(/0x7E44A1/.test(T) && /center\.lat/.test(T), '種子由戰場中心推(§2.3 跨客戶端同一張場)');

  const TONES = new Function(`${/const GROUND_TONES = \[[^\]]*\];/.exec(terr)[0]}\nreturn GROUND_TONES;`)();
  const lumOf = (c) => 0.2126 * ((c >> 16) & 255) + 0.7152 * ((c >> 8) & 255) + 0.0722 * (c & 255);
  const ls = TONES.map(lumOf);
  ok(ls.every((v, i) => i === 0 || v > ls[i - 1]), `色階亮度嚴格遞增(${ls.map((v) => v.toFixed(0)).join(' < ')})`);
  const steps = ls.slice(1).map((v, i) => v - ls[i]);
  ok(steps.every((v, i) => i === 0 || v < steps[i - 1]),
    `階差嚴格遞減 —— 暗端分得開、亮端不過曝(${steps.map((v) => v.toFixed(1)).join(' > ')})`);

  const F = code(field);
  ok(/s \/ Math\.max\(W_MIN, w\)/.test(F), 'field 是加權平均(加總會飽和成常數,比沒有場更糟)');
  ok(/const W_MIN = /.test(F), '加權平均分母有下限(空白處不會爆成 ±∞)');
  ok(!/Math\.random/.test(F), 'field MUST NOT 用 Math.random(§2.3)');
  ok(/sorted\[Math\.min\(sorted\.length - 1, Math\.floor\(sorted\.length \* k \/ n\)\)\]/.test(F),
    '色階門檻取該場地自己的**分位數**(固定門檻實測最壞 51.3%,見檔頭)');

  // 真品直測:27 場地 × 三種隊制,單一色階佔比 MUST ≤ 35%
  let worst = 0, worstId = '';
  for (const v of VENUES) {
    for (const ts of [1, 3, 5]) {
      const cfg = venueConfig(v, ts), c = cfg.center, span = cfg.sizeM;
      const seed = ((Math.round(c.lat * 1e4) * 31 + Math.round(c.lng * 1e4)) ^ 0x7E44A1) >>> 0;
      const b = { minX: -span / 2, maxX: span / 2, minZ: -span / 2, maxZ: span / 2 };
      const tone = makeToneLadder(makeField(seed, span), b, TONES.length, span * 0.018);
      const cnt = new Array(TONES.length).fill(0);
      const S = 96;
      for (let i = 0; i < S; i++) {
        for (let j = 0; j < S; j++) cnt[tone(b.minX + span * i / (S - 1), b.minZ + span * j / (S - 1))]++;
      }
      const mx = Math.max(...cnt) / (S * S) * 100;
      if (mx > worst) { worst = mx; worstId = `${v.id} L${ts}`; }
    }
  }
  ok(worst <= 35, `單一色階佔比 ≤ 35%(實測最壞 ${worst.toFixed(1)}% @ ${worstId})`);
}

console.log('\nⅣ 描邊寬度');
{
  const O = code(toon);
  ok(/projectionMatrix\[1\]\[1\]/.test(O),
    '螢幕下限由 projectionMatrix[1][1] 反推(手寫換算 = 狙擊一開鏡描邊全變粗)');
  ok(/max\( uOW, oMinW \)/.test(O),
    '取 max(世界寬, 螢幕下限)⇒ 近距離逐位元同舊制(15 處呼叫端不必重調)');
  ok(/const OUTLINE_MIN_NDC = /.test(O), '螢幕最小半寬是具名常數');
  // ---- 螢幕半寬與世界縮放無關(2026-08-10「主堡黑球」)----
  // 執行**原文**的兩條運算式:`uOMin` 的值 與 `outlinify` 餵給材質的 (w, invS)。
  // 世界縮放只准量一次 ⇒ 兩者 MUST 由同一個 s 推出來,否則其中一個會隨 fitToHeight 無聲脹大。
  const MIN_NDC = +/const OUTLINE_MIN_NDC = ([\d.]+);/.exec(O)[1];
  const uOMinSrc = /shader\.uniforms\.uOMin = \{ value: ([^}]+?) \};/.exec(O)[1].trim();
  const jobsSrc = /jobs\.push\(\[o, ([^,\]]+), ([^,\]]+)\]\);/.exec(O);
  ok(!!jobsSrc, 'outlinify 把 (寬度, 1/世界縮放) 一起餵給材質');
  ok(/const s = \(Math\.abs\(ws\.x\) \+ Math\.abs\(ws\.y\) \+ Math\.abs\(ws\.z\)\) \/ 3 \|\| 1;/.test(O)
    && [...O.matchAll(/getWorldScale\(_ws\)/g)].length === 1,
    '世界縮放只量一次(兩個外推量吃同一個 s)');
  const uOMinOf = new Function('OUTLINE_MIN_NDC', 'invS', `return ${BREAK_SCALE ? 'OUTLINE_MIN_NDC' : uOMinSrc};`);
  const wOf = new Function('width', 's', `return ${jobsSrc[1]};`);
  const invSOf = new Function('width', 's', `return ${jobsSrc[2]};`);
  // GLSL 那三行的等價實作(oMinW / transformed 的外推量;proj = 1/tan(fov/2))
  const screenNdc = (width, s, oDist, proj) => {
    const uOW = wOf(width, s), uOMin = uOMinOf(MIN_NDC, invSOf(width, s));
    const oMinW = uOMin * oDist / Math.max(0.001, proj);
    return Math.max(uOW, oMinW) * s * proj / oDist;   // 局部外推量 → 世界 → NDC 半寬
  };
  const PROJ = { '一般 fov 68°': 1 / Math.tan(68 / 2 * Math.PI / 180), '狙擊 fov 35°': 1 / Math.tan(35 / 2 * Math.PI / 180) };
  // 現役世界縮放取樣面:步兵 0.66 / 塔 1.39 / 直升機 2.38 / **主堡 dome.glb 795**(實測)
  let worst = 0, worstAt = '';
  for (const s of [0.66, 1, 1.39, 2.38, 795]) {
    for (const [pn, proj] of Object.entries(PROJ)) {
      for (let d = 5; d <= 900; d += 5) {
        const want = Math.max(MIN_NDC, 0.1 * proj / d);   // 呼叫端最大固定寬 0.45m,取 0.1 當代表
        const got = screenNdc(0.1, s, d, proj);
        const ratio = got / want;
        if (ratio > worst) { worst = ratio; worstAt = `s=${s} d=${d}m ${pn}`; }
      }
    }
  }
  ok(worst <= 1.001, `螢幕半寬與世界縮放無關:實得 ÷ 應得 ≤ 1(實測最壞 ${worst.toFixed(1)}× @ ${worstAt})`);
  // 下限那一半仍要成立:遠處線不得消失
  ok(screenNdc(0.1, 795, 450, PROJ['一般 fov 68°']) >= MIN_NDC * 0.999
    && screenNdc(0.1, 0.66, 450, PROJ['一般 fov 68°']) >= MIN_NDC * 0.999,
    '遠距離仍守得住螢幕下限(線不會消失)');
  // 近距離逐位元同舊制:世界寬勝出時外推量恰 = 呼叫端給的公尺數
  ok(Math.abs(screenNdc(0.1, 795, 5, PROJ['一般 fov 68°']) - 0.1 * PROJ['一般 fov 68°'] / 5) < 1e-12,
    '近距離世界寬勝出 ⇒ 逐位元同舊制');
  ok(/shell\.bind\(o\.skeleton, o\.bindMatrix\)/.test(O), 'SkinnedMesh 的 bind 分支仍在(描邊跟著動畫走)');
  ok(/o\.userData\.outlineGeo \|\| o\.geometry/.test(O), '硬邊幾何的平滑法線副本分支仍在(否則外殼會裂縫)');
  // 呼叫端寬度不得被順手改掉(單位沒變,改了就是憑感覺調)
  const ws = [...code(readSrc('public', 'js', 'models.js')).matchAll(/outlinify\([^,)]+, ([\d.]+)\)/g)].map((m) => m[1]);
  ok(ws.every((w) => w === '0.1'), `models.js 的固定寬呼叫端維持 0.1(實測 ${ws.join(',')})`);
  ok(/const outlineW = \(target\) => Math\.min\(0\.45, Math\.max\(0\.05, target \* 0\.016\)\);/
    .test(code(readSrc('public', 'js', 'models.js'))), 'outlineW 推導式不變');
}

console.log('\nⅤ 後製管線的接線(細節在 audit_gpu_lifecycle ⑦)');
{
  const G = code(game);
  ok(/import \{ Pipeline \} from '\.\/postfx\.js'/.test(G), 'game.js 引用 postfx 管線');
  ok([...G.matchAll(/this\.renderer\.render\(this\.scene, this\.camera\)/g)].length === 1,
    '主畫面的 renderer.render 只剩一處(?post=0 的退路)');
  ok(/this\.pipeline\.render\(\); else this\.renderer\.render/.test(G), '主畫面改走管線,保留退路');
}

// ============ Ⅵ 勾線資訊緩衝的材質契約(2026-08-12)============
// WebGL2 的規則:**啟用中的 draw buffer 沒有對應的 fragment output ⇒ INVALID_OPERATION**,
// 而症狀是那一批物件整批不畫、console 一個字都沒有。反過來(宣告了但沒有那個 draw buffer)
// 合法 —— 所以契約是「進場景的材質**一律**宣告」,開關只控制管線配不配第二張附件。
//
// 這一段就是那道閘:**新增任何進場景的 ShaderMaterial 而忘了宣告,就在這裡紅字**,
// 而不是等到有人把開關打開才發現半個世界不見了。
console.log('\nⅥ 勾線資訊緩衝的材質契約(A 方案)');
{
  const T = code(toon), P = code(postfx);
  // ---- 安裝端:涵蓋範圍 MUST 由 opaque_fragment 推導,MUST NOT 手寫名冊 ----
  ok(/function installInkInfo\(\)/.test(T) && /installInkInfo\(\);/.test(T),
    '安裝函式存在且在模組載入時執行(program 要到第一次 render 才建 ⇒ 必然夠早)');
  ok(/for \(const lib of Object\.values\(THREE\.ShaderLib\)\)/.test(T)
    && /lib\.fragmentShader\.includes\(OPAQUE\)/.test(T),
    '涵蓋範圍由 `opaque_fragment` 推導(內建材質名冊 MUST NOT 手寫)');
  ok(/THREE\.ShaderChunk\.opaque_fragment \+= /.test(T) && /INK_INFO_NONE/.test(T),
    'opaque_fragment 補上預設「沒有資訊」的寫入(cel 材質之後覆寫成真的法線)');
  ok(/export const INK_INFO_DECL = 'layout\(location = 1\) out highp vec4 gInfo;'/.test(T),
    '宣告字串只有一份(消費端一律 import,MUST NOT 各自手抄一行 layout)');
  // cel 補丁的覆寫 MUST 排在 opaque_fragment 之後(不然被預設值蓋掉)
  const celI = T.indexOf('#include <opaque_fragment>');
  const celW = T.indexOf('gInfo = vec4( gN.xy');
  ok(celI > 0 && celW > celI, 'cel 補丁的法線寫入排在 `#include <opaque_fragment>` 之後');
  ok(/uniform float uSurfId;/.test(T) && /shader\.uniforms\.uSurfId = \{ value: mat\.userData\.celSurfId \}/.test(T),
    'surfaceId 逐材質定案一次(在 onBeforeCompile 裡抽 = 重編譯就換號)');

  // ---- 消費端閘門:進場景的自寫 ShaderMaterial MUST 宣告 ----
  // `postfx.js` 是**具名例外**:它的全螢幕四邊形畫進單附件 RT 或畫布,從來不進場景。
  const EXEMPT = new Set(['postfx.js']);
  const dir = new URL('../public/js/', import.meta.url);
  const files = readdirSync(dir).filter((f) => f.endsWith('.js'));
  const offenders = [];
  let scanned = 0;
  for (const f of files) {
    if (EXEMPT.has(f)) continue;
    // **import 那一行不算數**:一支檔案裡有兩支材質、只有一支宣告時,連 import 一起數就會
    // 剛好湊到門檻而放行 —— 那正是這道閘要擋的情況。
    let src = code(readSrc('public', 'js', f)).replace(/^import[^\n]*\n/gm, '');
    // 反向驗證:模擬「有人新增了一支進場景的 ShaderMaterial 卻忘了宣告」
    if (BREAK_INK && f === 'vfx.js') {
      const bent = src.replaceAll('INK_INFO_DECL', '');
      if (bent === src) { console.error('✗ --break-inkinfo:樣式沒咬到 vfx.js,反向驗證等於沒跑'); process.exit(1); }
      src = bent;
    }
    const n = (src.match(/new THREE\.(Raw)?ShaderMaterial\(/g) || []).length;
    if (!n) continue;
    scanned += n;
    const decl = (src.match(/INK_INFO_DECL/g) || []).length;
    if (decl < n) offenders.push(`${f}(${n} 支材質 / ${decl} 處宣告)`);
  }
  ok(scanned > 0, `掃到 ${scanned} 支進場景的自寫 ShaderMaterial(掃不到 = 這道閘失效了)`);
  ok(offenders.length === 0,
    `每一支都宣告了 gInfo${offenders.length ? ` —— 缺:${offenders.join('、')}` : ''}`);

  // ---- 管線端 ----
  ok(/this\._mrtCap = renderer\.capabilities\.isWebGL2 === true/.test(P),
    '能力閘只問 WebGL2 + WebGLMultipleRenderTargets(0.160 沒有 `{ count }`)');
  ok(/_syncMrt\(\)/.test(P) && /this\.inkQuad\.material = this\._inkMaterial\(\)/.test(P),
    '開關即時切換:重建場景 RT 與勾線材質(材質恆寫 ⇒ 不必重編譯場景材質)');
  ok(/gl\.clearBufferfv\(gl\.COLOR, 1, \[0, 0, 0, 0\]\)/.test(P),
    '第二張單獨清成 0 —— 哨兵靠它成立(clear() 用的是 renderer 的 clearColor)');
  ok(/Array\.isArray\(src\.texture\) \? src\.texture\[0\] : src\.texture/.test(P),
    'MRT 的 `.texture` 是陣列:餵整個陣列給 sampler 會整片黑而不報錯');
  // 門檻 0.25:`.a` 自 2026-08-13 起是類別碼(NONE 0 / LAND 0.5 / HARD 1),見 Ⅶ
  ok(/min\( min\( i0\.a, min\( il\.a, ir\.a \) \), min\( iu\.a, ib\.a \) \) > 0\.25/.test(P),
    '五格哨兵齊全才採用第二訊號(天空/特效/招牌一條線都不會多)');
}

// ============ Ⅶ 地貌不出接縫(2026-08-13)============
// 「地貌拼圖接縫」的成因不是門檻調不好:逐材質的 surfaceId 量的是**這是哪一塊拼圖**(地貌),
// 而貼地拼圖的法線是 (0,1,0) 這個謊 —— 兩者都與**形狀**無關,卻都被畫成線。
// 這一段把三件事釘死:共用 id、真地形法線(純函式 ⇒ 共用邊逐位元同值)、LUT 的仿射分解。
console.log('\nⅦ 地貌不出接縫(LUT / 勾線只吃地形,不吃地貌)');
{
  const ground = readSrc('public', 'js', 'ground.js');
  let T = code(toon), P = code(postfx);
  const G = code(ground), TR = code(terr);
  if (BREAK_LAND) {
    const bent = T.replace('if (land) mat.userData.celSurfId = LAND_SURF_ID;', '');
    if (bent === T) { console.error('✗ --break-land:樣式沒咬到 toon.js,反向驗證等於沒跑'); process.exit(1); }
    T = bent;
  }
  if (BREAK_LUTLAND) {
    const bent = P.replace('if ( cls > 0.25 && cls < 0.75 ) lc = lutApplyLand( pre );', '');
    if (bent === P) { console.error('✗ --break-lutland:樣式沒咬到 postfx.js,反向驗證等於沒跑'); process.exit(1); }
    P = bent;
  }

  // ---- ① 類別碼與共用 id(寫入端)----
  const CLS = new Function(`${/export const INK_CLASS = \{[\s\S]*?\};/.exec(toon)[0].replace('export ', '')}\nreturn INK_CLASS;`)();
  ok(CLS.NONE === 0 && CLS.LAND === 0.5 && CLS.HARD === 1,
    `INK_CLASS 三碼 = 0 / 0.5 / 1(實測 ${JSON.stringify(CLS)})`);
  ok(/const LAND_SURF_ID = 0;/.test(T),
    '地貌共用 id = 0 —— nextSurfId 的值域是 (k+0.5)/64,最小 0.0078 ⇒ 0 永遠不會撞號');
  ok(/if \(land\) mat\.userData\.celSurfId = LAND_SURF_ID;/.test(T),
    '`land` 直接指定共用 id(走 nextSurfId = 每一格拼圖各一號 = 每一條拼圖邊都出線)');
  ok(/gInfo = vec4\( gN\.xy \* 0\.5 \+ 0\.5, uSurfId, uInkClass \);/.test(T),
    'gInfo 的 `.a` 寫類別碼(寫死 1.0 ⇒ LUT 那一端永遠分不出地貌)');
  ok(/if \( dot\( vLandN, vLandN \) > 1e-8 \) gN = normalize\( vLandN \);/.test(T),
    'aLandN 缺席時退回自己的法線(normalize(0) 是 NaN = 滿地黑點,原則 6)');
  ok(/\$\{landNrm \? 'L' : ''\}/.test(T),
    'landNrm 進 customProgramCacheKey(defines 不同卻共用程式 = 整批沒換到法線)');
  // 機體不是地貌:`toonMat` 一路都不該吃這兩個旗標
  const toonFn = /export function toonMat\([\s\S]*?\n\}/.exec(T)[0];
  ok(!/land/.test(toonFn), '`toonMat`(機體/英雄/武器)MUST NOT 吃 land —— 機體之間的線是要的');

  // ---- ② 真地形法線:直接執行 ground.js 的真品 ----
  const landNrmAt = new Function(`${grabFn(ground, 'landNrmAt')}\nreturn landNrmAt;`)();
  const flat = () => 12.5;
  const n0 = landNrmAt(flat, 3, 7, 10);
  ok(n0[0] === 0 && n0[1] === 1 && n0[2] === 0, `平地 ⇒ (0,1,0)(實測 ${n0.map((v) => v.toFixed(3))})`);
  // 定坡:h = k·x ⇒ 法線 ∝ (−k, 1, 0)
  const k = 0.4, slope = (x) => 0.4 * x;
  const n1 = landNrmAt((x) => slope(x), 11, 5, 8);
  const l1 = Math.hypot(k, 1);
  ok(Math.abs(n1[0] + k / l1) < 1e-9 && Math.abs(n1[1] - 1 / l1) < 1e-9,
    `定坡 ⇒ 解析法線(誤差 ${Math.abs(n1[0] + k / l1).toExponential(1)})`);
  // **共用邊逐位元同值**:相鄰兩格從各自的迴圈算同一個點,MUST 得到同一組浮點數
  const bumpy = (x, z) => Math.sin(x * 0.07) * 9 + Math.cos(z * 0.05) * 6 + x * 0.02;
  let same = true;
  for (let t = 0; t < 64; t++) {
    const x = -300 + t * 9.37, z = 120 - t * 4.11;
    const a = landNrmAt(bumpy, x, z, 10.4), b = landNrmAt(bumpy, x, z, 10.4);
    if (a[0] !== b[0] || a[1] !== b[1] || a[2] !== b[2]) same = false;
  }
  ok(same, '純函式:同一個 (x,z) 逐位元同值 ⇒ 相鄰拼圖的共用邊上沒有折邊可畫');
  // 「地形變化受勾線作用」:稜線兩側的法線 MUST 真的差得過 INK_MRT.NRM0(0.05)
  const ridge = (x) => 40 - Math.abs(x) * 0.5;
  const rl = landNrmAt(ridge, -6, 0, 10), rr = landNrmAt(ridge, 6, 0, 10);
  const dn = Math.hypot(rl[0] - rr[0], rl[1] - rr[1]);
  ok(dn > 0.05, `稜線兩側法線差 ${dn.toFixed(3)} > NRM0 0.05(地形變化仍出線)`);

  // ---- ③ 接線:誰是地貌 ----
  ok(/pushLandN\(b, hAt, px, pz, terrain\.gridM\)/.test(G), '底毯/緩衝空間底毯走呼叫端給的 hAt');
  const flatN = (G.match(/nrm\.push\(0, 1, 0\)/g) || []).length;
  // **縮排過的那幾行才是呼叫端** —— 連定義那一行一起數就會多一份而剛好湊到門檻
  const landN = (G.match(/\n\s+pushLandN\(/g) || []).length;
  ok(flatN > 0 && flatN === landN,
    `每一處貼地 (0,1,0) 都配一份地形法線(${flatN} 處 / ${landN} 份)`);
  ok((G.match(/landNrm: true/g) || []).length === 3,
    '三層貼地拼圖(底毯+外溢+脊帶 / 界線 flat / 特徵)都掛 landNrm');
  ok(/side: THREE\.DoubleSide, land: true/.test(G),
    '立體脊只共用 id、**不換法線**(它是真的有形狀的東西)');
  ok((TR.match(/land: true/g) || []).length === 2 && /gridM: worldW \/ \(N - 1\)/.test(TR),
    '地形自己也是地貌(兩條路徑都掛)+ 對外給出格距 gridM');
  ok(/取樣距[\s\S]{0,80}格距/.test(readSrc('public', 'js', 'ground.js')),
    '取樣距 = 地形網格格距的理由寫在原地(取更小 = 折邊線長回格線)');

  // ---- ④ LUT 的地貌分支 ----
  ok(/vec3 lutApplyLand\( vec3 linC \)/.test(P) && /return max\( lutApply\( vec3\( y \) \) \+ \( linC - vec3\( y \) \), 0\.0 \);/.test(P),
    'LUT 地貌分支 = 仿射分解(色度差增益恆 1、亮度整條走表)');
  ok(/if \( cls > 0\.25 && cls < 0\.75 \) lc = lutApplyLand\( pre \);/.test(P),
    '地貌以**帶**判定(8bit RT 上 LAND 存成 0.50196,等號判定會整片失效)');
  ok(/float y = dot\( linC, vec3\( 0\.2126, 0\.7152, 0\.0722 \) \);/.test(P),
    '亮度與 split-tone 的 `l` 同一把尺(兩份定義會在交叉淡入時互相拉扯)');

  // ---- ⑤ 資訊緩衝:配不配 vs 誰在用 ----
  ok(/_wantInfo\(\) \{[\s\S]{0,220}visualPref\('inkMrt'\) === 'on' \|\| visualPref\('lutSrc'\) !== 'none'/.test(P),
    '配不配只有一個判據 `_wantInfo`(兩個消費端各自獨立)');
  ok(/_inkMaterial\(\) \{\s*const mrt = this\._inkMrt;/.test(P),
    '勾線讀的是 `_inkMrt` 不是 `_mrt` —— 開 LUT MUST NOT 順手把折邊勾線打開');
  ok(/min\( min\( i0\.a, min\( il\.a, ir\.a \) \), min\( iu\.a, ib\.a \) \) > 0\.25/.test(P),
    '哨兵門檻 0.25(LAND 是 0.5:舊的 > 0.5 會把整片地面判成「沒有資訊」)');
  ok(/if \(this\._air\) this\.setAirFog\(\.\.\.this\._air\);/.test(P) && /this\.setLut\(this\._lutTex \|\| null/.test(P),
    'grade 材質重建後三組 uniform 全部重掛(漏掉 = 切開關之後空氣透視/LUT 自己關掉)');
}

console.log(`\n${fail === 0 ? '✅' : '❌'} 通過 ${pass} 項,失敗 ${fail} 項`);
process.exit(fail === 0 ? 0 : 1);
