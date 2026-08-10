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
// 跑法:node tools/audit_cel_pipeline.mjs [--break-scale]
import { readSrc } from './audit_src.mjs';
import { VENUES, venueConfig } from '../public/js/venues.js';
import { makeField, makeToneLadder } from '../public/js/field.js';

const toon = readSrc('public', 'js', 'toon.js');
const env = readSrc('public', 'js', 'environment.js');
const terr = readSrc('public', 'js', 'terrain.js');
const field = readSrc('public', 'js', 'field.js');
const game = readSrc('public', 'js', 'game.js');

/** 反向驗證:把螢幕下限退回「不除世界縮放」的舊制 ⇒ Ⅳ MUST 紅字 */
const BREAK_SCALE = process.argv.includes('--break-scale');
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

console.log(`\n${fail === 0 ? '✅' : '❌'} 通過 ${pass} 項,失敗 ${fail} 項`);
process.exit(fail === 0 ? 0 : 1);
