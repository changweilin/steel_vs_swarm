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
//   Ⅺ 賽璐璐學派(§0-b;2026-08-16)—— **兩派並存,而預設那一派 MUST 逐位元同舊制**
//     ・學派是**模組載入時定案**的 JS 常數 `_school`(同 `installWorldCurve` 讀 `?curve=0`),
//       所有 School B 的東西都包在 `_school === 'b'` 的**字串拼接**裡 ⇒ School A 走的是
//       同一份 GLSL 原始碼,不是「同一支程式裡的另一條分支」;School A 那一份替換文字
//       裝進具名常數 `RAMP_PATCH_A`,本段直接釘住它的原文;
//     ・**A14 在硬切路徑上的等價保證**(這是本項最重要的產出,兩條缺一不可):
//       ②值的地板 `CEL_CUT.SHADOW_V ≥ rampFloor(3)` 且**推導不手寫**(102 只准有一份家);
//       ③色相偏移**亮度中性** —— 硬切路徑的等價式是 `luma(暗側) ≡ SHADOW_V × luma(亮側)`,
//       對**任何**基色與**任何**拉桿值恆成立。`luma` 是內積,對逐通道乘法**不是乘性的**
//       (純紅基色上 `luma(on × tint)/luma(on)` 就是 `tint.r`)⇒ 少了那一行重正規化就是
//       「把亮度藏進色相」的後門,而畫面上只表現成深色件在暗面塌成黑塊;
//     ・`bands` 的第二個語意(硬度)MUST 嚴格遞增 2 < 3 < 4 < soft —— 那是把 School A 的
//       「階數越多層次越多」翻成 School B「唯一那一刀越寬」的唯一合法映射,序一破,四個
//       既有 `bands:` 呼叫端的語意就全反了;
//     ・**一個場景只有一套量化**(A14 ④):繞過 `toon.js` 的裸 `MeshToonMaterial` 是凍結
//       名冊,而**名冊非空 ⇒ `celSchool` 的 def MUST NOT 是 'b'**(那就是「同一棵樹的葉子
//       硬切、樹幹漸層」出貨,沒有任何錯誤訊息);
//     ・主光色 MUST 讀 three 自己那份 `directionalLights[i].color`(= color × intensity)——
//       在 JS 端再存一份的話夜戰/黃昏的暗側會變成與太陽無關的常數,`DAYCLOCK` 整套在畫面上
//       靜默失效而 `audit_daynight` 每一條斷言照樣全綠(它量的是資料不是像素);
//     ・投影型別 MUST 是 `PCFSoftShadowMap`(那一刀會把柔化後的值重新量化 ⇒ 終端線更短更乾淨)
//       —— 這一行在 2026-08-16 之前**沒有任何斷言在守**。
//     反向驗證 `--break-school` / `--break-cutfloor` / `--break-neutral` / `--break-cutorder`
//              / `--break-schoolmix` / `--break-shadowtype`。
// 跑法:node tools/audit_cel_pipeline.mjs [--break-scale] [--break-inkinfo] [--break-land] [--break-lutland]
//                                        [--break-school] [--break-cutfloor] [--break-neutral]
//                                        [--break-cutorder] [--break-schoolmix] [--break-shadowtype]
//                                        [--break-landmask] [--break-surf]
import { readdirSync } from 'node:fs';
import { readSrc } from './audit_src.mjs';
import { VENUES, venueConfig } from '../public/js/venues.js';
import { makeField, makeToneLadder } from '../public/js/field.js';
import { INK_CTR, inkCtrM, combatReachM, DISSOLVE, dissolveOutAt } from '../public/js/data.js';
import { VISUAL_KNOBS } from '../public/js/visualPrefs.js';

const toon = readSrc('public', 'js', 'toon.js');
const env = readSrc('public', 'js', 'environment.js');
const terr = readSrc('public', 'js', 'terrain.js');
const field = readSrc('public', 'js', 'field.js');
const game = readSrc('public', 'js', 'game.js');
const models = readSrc('public', 'js', 'models.js');
const postfx = readSrc('public', 'js', 'postfx.js');

/** 反向驗證:把螢幕下限退回「不除世界縮放」的舊制 ⇒ Ⅳ MUST 紅字 */
const BREAK_SCALE = process.argv.includes('--break-scale');
/** 反向驗證:模擬新增了一支進場景的 ShaderMaterial 卻忘了宣告 gInfo ⇒ Ⅵ MUST 紅字 */
const BREAK_INK = process.argv.includes('--break-inkinfo');
/** 反向驗證:地貌退回逐材質 surfaceId(= 每一格拼圖的邊都畫線)⇒ Ⅶ MUST 紅字 */
const BREAK_LAND = process.argv.includes('--break-land');
/** 反向驗證:LUT 的地貌分支退回直接查表(= 色差被表放大)⇒ Ⅶ MUST 紅字 */
const BREAK_LUTLAND = process.argv.includes('--break-lutland');
/** 反向驗證:貢獻那一項從編碼與寫入端一起拿掉 ⇒ Ⅷ①② + Ⅶ MUST 紅字 */
const BREAK_CONTRIB = process.argv.includes('--break-contrib');
/** 反向驗證:最近面覆寫改成 mix(= 每一個否決面外圈長出半強度光暈)⇒ Ⅷ③ MUST 紅字 */
const BREAK_OCCL = process.argv.includes('--break-occl');
/** 反向驗證:附件 1 改回線性內插(相鄰的 q 被混成不存在的類別)⇒ Ⅷ④ MUST 紅字 */
const BREAK_NEAREST = process.argv.includes('--break-nearest');
/** 反向驗證:SELF_F / GRAZE_K 寫回 1.0 / 0.0(= 內部折邊抑制整段是恆等式)⇒ Ⅷ⑥ MUST 紅字 */
const BREAK_SELFF = process.argv.includes('--break-selff');
/** 反向驗證:群組早退整段刪掉 ⇒ Ⅷ⑥ MUST 紅字 */
const BREAK_GRP = process.argv.includes('--break-grp');
/** 反向驗證:discard 錨點挪錯 + 快取鍵拿掉 D + 迷霧也留殘影 ⇒ Ⅸ MUST 紅字 */
const BREAK_DISSOLVE = process.argv.includes('--break-dissolve');
/** 反向驗證:地貌分區子帶改用計畫字面的 `* 0.1`(撞號)+ 拿掉拉桿閘 ⇒ Ⅸ MUST 紅字 */
const BREAK_LANDINK = process.argv.includes('--break-landink');
/** 反向驗證:勾線淡出錨回相機 far 平面 ⇒ Ⅹ MUST 紅字 */
const BREAK_FADE = process.argv.includes('--break-fade');
/** 反向驗證:School B 的 ramp hook 換回查表 + 硬切重組整段刪掉 ⇒ Ⅺ MUST 紅字(而 Ⅰ MUST 仍全綠) */
const BREAK_SCHOOL = process.argv.includes('--break-school');
/** 反向驗證:暗側地板改成手寫的 0.25(< 102/255)⇒ Ⅺ 的 A14 ② MUST 紅字 */
const BREAK_CUTFLOOR = process.argv.includes('--break-cutfloor');
/** 反向驗證:拿掉暗側亮度重正規化(= 把亮度藏進色相)⇒ Ⅺ 的 A14 ③ MUST 紅字 */
const BREAK_NEUTRAL = process.argv.includes('--break-neutral');
/** 反向驗證:bands 4 的帶改得比 3 還窄 ⇒ Ⅺ 的硬度階梯 MUST 紅字 */
const BREAK_CUTORDER = process.argv.includes('--break-cutorder');
/** 反向驗證:多一處繞過 toon.js 的裸 MeshToonMaterial ⇒ Ⅺ 的「一個場景一套量化」MUST 紅字 */
const BREAK_SCHOOLMIX = process.argv.includes('--break-schoolmix');
/** 反向驗證:投影型別換回 PCFShadowMap ⇒ Ⅺ MUST 紅字(2026-08-16 之前沒有東西在守這一行) */
const BREAK_SHADOWTYPE = process.argv.includes('--break-shadowtype');
/** 反向驗證:三平面遮罩退回單一 XZ 投影(= 垂直崖面沿 Y 拉成一整條)⇒ Ⅸ MUST 紅字 */
const BREAK_LANDMASK = process.argv.includes('--break-landmask');
/** 反向驗證:材質槽耗盡後退回循環配號(= 第 65 個語意材質撞回既有 id)⇒ Ⅷ MUST 紅字 */
const BREAK_SURF = process.argv.includes('--break-surf');
let surfToonBase = toon;
let pass = 0, fail = 0;
const ok = (c, msg) => { c ? (pass++, console.log(`  ✓ ${msg}`)) : (fail++, console.error(`  ✗ ${msg}`)); };
/** 只留「真的會執行的程式碼」—— 註解裡提到某個名字不算違規 */
const code = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1');
const count = (s, re) => [...s.matchAll(re)].length;
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
     [...code(toon).matchAll(/toonGradient\(bands\)/g)].length === 3,
    'toonMat / envMat / toonPlain 三支各把 opts.bands 轉給 toonGradient(2026-08-16 §0-b 多了第三個入口)');
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
  ok(/totalClouds = numClusters \* spritesPerCluster/.test(code(cl)), '雲朵集群與總量配置(推導,不是逐天氣手寫)');
  ok(/W\??\.fogNear <= 0\.05/.test(code(cl)), '霧天零雲(判據取既有表的 fogNear,不是新旗標)');
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
  // 2026-08-14:副本的取法多了兩道 —— ①MUST 檢查是不是真的 BufferGeometry、②拿不到就退到
  //   `geometry.userData`(`Object3D.copy` 用 JSON 複製 userData ⇒ `mesh.clone()` 之後那一格
  //   會變成長得像幾何的普通物件,`new THREE.Mesh(它)` 在 three 的建構子裡當場 TypeError)。
  ok(/o\.userData\.outlineGeo/.test(O) && /o\.geometry\.userData\?\.outlineGeo/.test(O)
    && /isBufferGeometry/.test(O), '硬邊幾何的平滑法線副本分支仍在(否則外殼會裂縫)');
  // 呼叫端寬度不得被順手改掉(單位沒變,改了就是憑感覺調)
  const ws = [...code(readSrc('public', 'js', 'models.js')).matchAll(/outlinify\([^,)]+, ([\d.]+)\)/g)].map((m) => m[1]);
  ok(ws.every((w) => w === '0.1'), `models.js 的固定寬呼叫端維持 0.1(實測 ${ws.join(',')})`);
  // 2026-08-14 新版建模整合:`outlineW` 與其它幾何積木一起收進 `geo3d.js`(全專案唯一縫;
  // 機體鍛造台原本抄了一份 `outlineWF`)。推導式本身一格未動 —— 只是換了家。
  const G3 = code(readSrc('public', 'js', 'geo3d.js'));
  ok(/export const outlineW = \(target\) => Math\.min\(0\.45, Math\.max\(0\.05, target \* 0\.016\)\);/.test(G3),
    'outlineW 推導式不變');
  ok(!/const outlineW\s*=/.test(code(readSrc('public', 'js', 'models.js')))
    && !/const outlineWF\s*=\s*\(target\)/.test(code(readSrc('public', 'js', 'forge', 'geo.js'))),
    'outlineW 只有一份實作(models.js / forge/geo.js 都不得再自己寫一個)');
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
  // **名冊 MUST 遞迴子目錄**(2026-08-16;照抄 `audit_client_syntax.mjs` 的 `listJs`)——
  // `public/js/forge/` 底下有 42 支模組,只掃頂層的話它們全部落在這道閘之外,
  // 而漏宣告 `gInfo` 的代價是 WebGL2 `INVALID_OPERATION` ⇒ **整批物件不畫、console 一個字
  // 都沒有**,同時這裡照樣全綠。本輪還要再新增 5 支客戶端模組,所以這是全域第一項改動。
  const listJs = (rel) => readdirSync(new URL(`../${rel.join('/')}/`, import.meta.url), { withFileTypes: true })
    .flatMap((d) => (d.isDirectory() ? listJs([...rel, d.name])
      : d.name.endsWith('.js') ? [[...rel.slice(2), d.name].join('/')] : []));
  const files = listJs(['public', 'js']).sort();
  const offenders = [];
  let scanned = 0;
  for (const f of files) {
    if (EXEMPT.has(f)) continue;
    // **import 那一行不算數**:一支檔案裡有兩支材質、只有一支宣告時,連 import 一起數就會
    // 剛好湊到門檻而放行 —— 那正是這道閘要擋的情況。
    let src = code(readSrc('public', 'js', ...f.split('/'))).replace(/^import[^\n]*\n/gm, '');
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
  // 遞迴寫壞 = 那 42 支靜默消失,而 `scanned` 看起來仍然「有掃到東西」
  ok(files.includes('forge/forge.js') && files.includes('forge/mechs/t01.js'),
    `名冊遞迴子目錄(${files.length} 支;forge/ 與 forge/mechs/ 都在內)`);
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
  // 哨兵門檻:`.a` 自 2026-08-16 起是**打包**(見 Ⅷ)⇒ 一律先解碼再比。
  // ⚠ 舊的 `> 0.25` 在新編碼下**恆不成立**(.a 上限 = (3×16+15)/255 = 0.247)⇒ 折邊勾線
  //   整個變 no-op,而使用者看到的是「開了那顆開關沒反應」、console 一個字都沒有。
  ok(/min\( min\( c0, min\( cl, cr \) \), min\( cu, cb \) \) > 0\.5/.test(P)
    && /float c0 = inkCls\( i0\.a \)/.test(P) && !/i0\.a, min\( il\.a/.test(P),
    '五格哨兵齊全才採用第二訊號,且判據是**解碼後的類別**(天空/特效/招牌一條線都不會多)');
}

// ============ Ⅶ 地貌不出接縫(2026-08-13)============
// 「地貌拼圖接縫」的成因不是門檻調不好:逐材質的 surfaceId 量的是**這是哪一塊拼圖**(地貌),
// 而貼地拼圖的法線是 (0,1,0) 這個謊 —— 兩者都與**形狀**無關,卻都被畫成線。
// 這一段把三件事釘死:共用 id、真地形法線(純函式 ⇒ 共用邊逐位元同值)、LUT 的仿射分解。
console.log('\nⅦ 地貌不出接縫(LUT / 勾線只吃地形,不吃地貌)');
{
  const ground = readSrc('public', 'js', 'ground.js');
  if (BREAK_SURF) {
    const bent = surfToonBase.replace(/const id = _surfSeq >= SURF_SLOT_N\r?\n\s+\? SURF_ID\.OVERFLOW/,
      'const id = false && _surfSeq >= SURF_SLOT_N\n    ? SURF_ID.OVERFLOW');
    if (bent === surfToonBase) { console.error('✗ --break-surf:樣式沒咬到 toon.js,反向驗證等於沒跑'); process.exit(1); }
    surfToonBase = bent;
  }
  let T = code(surfToonBase), P = code(postfx);
  const G = code(ground), TR = code(terr);
  if (BREAK_LAND) {
    const bent = T.replace('if (land) mat.userData.celSurfId = LAND_SURF_ID;', '');
    if (bent === T) { console.error('✗ --break-land:樣式沒咬到 toon.js,反向驗證等於沒跑'); process.exit(1); }
    T = bent;
  }
  if (BREAK_LUTLAND) {
    // ⚠ 樣式隨 2026-08-16 的打包編碼一起換過(舊樣式會靜默 no-op ⇒ 反向驗證永遠綠,§5.4 ㋑)
    const bent = P.replace(/if \( cls > 0\.5 && cls < 1\.5 \) lc = lutApplyLand\( pre \);/, '');
    if (bent === P) { console.error('✗ --break-lutland:樣式沒咬到 postfx.js,反向驗證等於沒跑'); process.exit(1); }
    P = bent;
  }

  // ---- ① 類別碼與共用 id(寫入端)----
  const CLS = new Function(`${/export const INK_CLASS = \{[\s\S]*?\};/.exec(toon)[0].replace('export ', '')}\nreturn INK_CLASS;`)();
  ok(CLS.NONE === 0 && CLS.LAND === 1 && CLS.HARD === 2 && CLS.GROUP === 3,
    `INK_CLASS 是**索引** 0/1/2/3(不是 alpha 值,MUST NOT 再拿它跟 .a 比大小;實測 ${JSON.stringify(CLS)})`);
  ok(/const LAND_SURF_ID = 0;/.test(T),
    '地貌共用 id = 0 —— nextSurfId 的值域是 (k+0.5)/64,最小 0.0078 ⇒ 0 永遠不會撞號');
  ok(/if \(land\) mat\.userData\.celSurfId = LAND_SURF_ID;/.test(T),
    '`land` 直接指定共用 id(走 nextSurfId = 每一格拼圖各一號 = 每一條拼圖邊都出線)');
  ok(/gInfo = vec4\( gN\.xy \* 0\.5 \+ 0\.5, gSurf, inkPack\( uInkClass, inkC \) \);/.test(T),
    'gInfo 的 `.a` 走 inkPack 打包(類別索引 + 貢獻);寫死 uInkClass ⇒ 貢獻通道整條消失');
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
  // 四層:底毯+外溢+脊帶 / 界線 flat / 特徵 / **農田田埂**(2026-08-13)。田埂的埂頂是貼地的
  // (受光走 (0,1,0)、勾線吃真地形法線),而它的外側垂直面在 emitBund 裡另外餵**自己的面法線**
  // ⇒ 埂頂那道 90° 折邊照樣出線 —— 「貼地那一半掛 landNrm」與「有形狀那一半不掛」在同一個
  // mesh 上並存,靠的是逐頂點的 aLandN 而不是逐材質的旗標
  ok((G.match(/landNrm: true/g) || []).length === 4,
    '四層貼地拼圖(底毯+外溢+脊帶 / 界線 flat / 特徵 / 田埂埂頂)都掛 landNrm');
  ok(/side: THREE\.DoubleSide, land: true/.test(G),
    '立體脊只共用 id、**不換法線**(它是真的有形狀的東西)');
  ok((TR.match(/land: true/g) || []).length === 2 && /gridM: worldW \/ \(N - 1\)/.test(TR),
    '地形自己也是地貌(兩條路徑都掛)+ 對外給出格距 gridM');
  ok(/取樣距[\s\S]{0,80}格距/.test(readSrc('public', 'js', 'ground.js')),
    '取樣距 = 地形網格格距的理由寫在原地(取更小 = 折邊線長回格線)');

  // ---- ④ LUT 的地貌分支 ----
  ok(/vec3 lutApplyLand\( vec3 linC \)/.test(P) && /return max\( lutApply\( vec3\( y \) \) \+ \( linC - vec3\( y \) \), 0\.0 \);/.test(P),
    'LUT 地貌分支 = 仿射分解(色度差增益恆 1、亮度整條走表)');
  ok(/float cls = inkCls\( texture2D\( tInfo, vUv \)\.a \);/.test(P)
    && /if \( cls > 0\.5 && cls < 1\.5 \) lc = lutApplyLand\( pre \);/.test(P),
    '地貌以**解碼後的類別帶**判定(舊帶 0.25~0.75 在打包編碼下恆不成立 ⇒ 接縫被 LUT 顯影而無錯誤訊息)');
  ok(/float y = dot\( linC, vec3\( 0\.2126, 0\.7152, 0\.0722 \) \);/.test(P),
    '亮度與 split-tone 的 `l` 同一把尺(兩份定義會在交叉淡入時互相拉扯)');

  // ---- ⑤ 資訊緩衝:配不配 vs 誰在用 ----
  ok(/_wantInfo\(\) \{[\s\S]{0,220}visualPref\('inkMrt'\) === 'on' \|\| visualPref\('lutSrc'\) !== 'none'/.test(P),
    '配不配只有一個判據 `_wantInfo`(兩個消費端各自獨立)');
  ok(/_inkMaterial\(\) \{\s*const mrt = this\._inkMrt;/.test(P),
    '勾線讀的是 `_inkMrt` 不是 `_mrt` —— 開 LUT MUST NOT 順手把折邊勾線打開');
  ok(/float ctr = \( c0 > 0\.5 \) \? inkCtr\( i0\.a \) : 1\.0;/.test(P),
    '中心 cls == NONE ⇒ 貢獻 **1(沒有意見)**不是 0 —— 讀成 0 會把粒子/護盾/招牌今天有的線整批滅掉');
  ok(/if \(this\._air\) this\.setAirFog\(\.\.\.this\._air\);/.test(P) && /this\.setLut\(this\._lutTex \|\| null/.test(P),
    'grade 材質重建後三組 uniform 全部重掛(漏掉 = 切開關之後空氣透視/LUT 自己關掉)');
}


// ============ Ⅷ gInfo.a 的半位元組打包 + 表面群組 + 內部折邊抑制(2026-08-16)============
// `.a` 從此帶兩件事:高半位元組 = 表面類別**索引**、低半位元組 = `outlineContribution` 16 階。
// 這一段的五個病灶全部**沒有錯誤訊息**:
//   ① 讀取端留著舊門檻 ⇒ 折邊勾線 / LUT 地貌分支整個變 no-op(使用者:「開了沒反應」);
//   ② 中心 NONE 被讀成貢獻 0 ⇒ 粒子 / 護盾 / 招牌今天有的線整批滅掉;
//   ③ 覆寫改成 mix ⇒ 每一個與否決面相鄰的物件外圈長出半強度光暈;
//   ④ 附件 1 走線性內插 ⇒ 相鄰的 q 被混成一個不存在的類別;
//   ⑤ `SELF_F` 寫回 1 ⇒ 群組內部折邊抑制整段變成恆等式(而每一條原文斷言照樣綠)。
// 手法:**把 GLSL 原文轉成 JS 樁真的跑一次**(離線、無 GPU)——「數學對不對」驗得到,
// 「驅動上的位階」驗不到(那是 ㋓,見交付說明)。
console.log('\nⅧ gInfo.a 打包 / 表面群組 / 內部折邊抑制');
{
  let T = code(toon), P = code(postfx);
  const raw = readSrc('public', 'js', 'toon.js');
  const rawP = readSrc('public', 'js', 'postfx.js');
  const bend = (src, re, to, flag) => {
    const out = src.replace(re, to);
    if (out === src) { console.error(`✗ ${flag}:樣式沒咬到,反向驗證等於沒跑`); process.exit(1); }
    return out;
  };
  let PACK = /export const INK_PACK_GLSL = `([\s\S]*?)`;/.exec(raw)[1];
  const UNPACK = /export const INK_UNPACK_GLSL = `([\s\S]*?)`;/.exec(raw)[1];
  if (BREAK_CONTRIB) {
    // 壞版:貢獻那一項整個從編碼裡拿掉(= 只剩類別碼,退回 2026-08-13 的語意)
    PACK = bend(PACK, /cls \* \$\{INK_LEVELS\}\.0 \+ floor\([\s\S]*?\+ 0\.5 \)/,
      'cls * ${INK_LEVELS}.0', '--break-contrib(編碼)');
    T = bend(T, /gInfo = vec4\( gN\.xy \* 0\.5 \+ 0\.5, gSurf, inkPack\( uInkClass, inkC \) \);/,
      'gInfo = vec4( gN.xy * 0.5 + 0.5, gSurf, uInkClass );', '--break-contrib(寫入端)');
  }
  // ---- GLSL → JS 樁(只認這兩段字串裡用到的內建函式)----
  const glsl2js = (g) => g
    .replace(/float\s+(\w+)\s*\(([^)]*)\)\s*\{/g, (m, n, a) => `function ${n}(${a.replace(/float\s+/g, '')}) {`)
    .replace(/\bfloat\s+/g, 'let ');
  const consts = { INK_LEVELS: 16, INK_TOP: 15, INK_BASE: 255 };
  const fill = (g) => g.replace(/\$\{(\w+)\}/g, (m, k) => {
    if (!(k in consts)) { console.error(`✗ Ⅷ:GLSL 字串裡出現未知的插值 ${k}`); process.exit(1); }
    return String(consts[k]);
  });
  const F = new Function('floor', 'clamp', 'fract',
    `${glsl2js(fill(PACK))}\n${glsl2js(fill(UNPACK))}\nreturn { inkPack, inkQ, inkCls, inkCtr };`)(
    Math.floor, (x, a, b) => Math.min(b, Math.max(a, x)), (x) => x - Math.floor(x));
  // ⚠ 常數 MUST 由 toon.js 原文取,不是抄在這裡:抄的那一份會在有人調階數之後靜默分家
  const LV = +/export const INK_LEVELS = (\d+);/.exec(raw)[1];
  ok(LV === consts.INK_LEVELS, `INK_LEVELS 由原文取(${LV});本檔的樁常數與它一致`);

  // ---- ① 8bit UNORM 往返:4 類別 × 16 階 = 64 組 ----
  let clsOk = 0, ctrErr = 0, n = 0;
  for (const cls of [0, 1, 2, 3]) {
    for (let k = 0; k <= 15; k++) {
      const want = k / 15;
      const a8 = Math.round(F.inkPack(cls, want) * 255) / 255;   // 8bit UNORM 落地再讀回
      if (F.inkCls(a8) === cls) clsOk++;
      ctrErr = Math.max(ctrErr, Math.abs(F.inkCtr(a8) - want));
      n++;
    }
  }
  ok(clsOk === n && ctrErr === 0, `往返 ${n} 組:類別 ${clsOk}/${n} 正確、貢獻誤差 ${ctrErr}`);
  // ---- ② 兩個恆等式(逐位元中性的證明面)----
  ok(F.inkPack(0, 0) === 0, '哨兵:inkPack(NONE, 0) === 0 ⇒ `gInfo = vec4(0)` 的語意逐位元保留');
  const top = Math.round(F.inkPack(2, 1) * 255) / 255;
  ok(F.inkCtr(top) === 1, 'level 15 解出來**嚴格 === 1.0**(不是 1e-6 之內)—— `ink *= ctr` 與 ceil/floor 覆寫因此都是恆等');
  ok(F.inkPack(3, 1) * 255 === 63 && F.inkPack(3, 1) < 0.25,
    `.a 的上限 = 63/255 = ${F.inkPack(3, 1).toFixed(3)} < 0.25 ⇒ 舊哨兵門檻在新編碼下**恆不成立**`);
  // 量化縫:授權值先收成 k/15,否則緩衝裡的值與稽核/定裝照量到的不是同一個數
  const quant = new Function(`${/export const inkQuant = [^\n]*/.exec(raw)[0].replace('export ', '')}\nconst INK_TOP = 15;\nreturn inkQuant;`)();
  ok(quant(1) === 1 && quant(0) === 0 && quant(0.4) === Math.round(0.4 * 15) / 15,
    `inkQuant 收成 k/15(1 → ${quant(1)}、0.4 → ${quant(0.4).toFixed(4)})`);
  ok(/gInfo = vec4\( gN\.xy \* 0\.5 \+ 0\.5, gSurf, inkPack\( uInkClass, inkC \) \);/.test(T),
    '寫入端真的走 inkPack —— 直寫 uInkClass 的話貢獻通道整條消失,而讀取端照樣在解碼(每一格的貢獻都會被讀成類別的低位)');

  // ---- ③ 最近面覆寫:硬決定 ⇒ 結果只會是 0 或 1 ----
  let OV = /float minD = d, minC = ctr;[\s\S]*?if \( minD < d \) \{[^\n]*\n/.exec(P);
  ok(!!OV, '勾線 pass 有最近面覆寫區塊');
  let ovSrc = OV ? OV[0] : '';
  if (BREAK_OCCL) {
    ovSrc = bend(ovSrc, /\( minC > ctr \) \? max\( ctr, ceil\( minC \) \) : min\( ctr, floor\( minC \) \)/,
      'mix( ctr, minC, 0.5 )', '--break-occl');
  }
  const ovFn = new Function('max', 'min', 'ceil', 'floor', 'mix', 'inkCtr',
    `return function ov( d, ctr, cl, cr, cu, cb, l, r, u, b, il, ir, iu, ib ) {
${ovSrc.replace(/\bfloat\s+/g, 'let ')}
return ctr; };`)(
    Math.max, Math.min, Math.ceil, Math.floor, (x, y, t) => x + (y - x) * t, (x) => x);
  const cases = [];
  for (const near of [true, false]) {
    for (const oc of [0, 0.5, 1]) {
      for (const cc of [0, 0.5, 1]) {
        // 遮蔽者在左格:cls = HARD(2)、深度 near ? 更近 : 更遠
        cases.push({ near, oc, cc, out: ovFn(10, cc, 2, 2, 2, 2, near ? 5 : 15, 20, 20, 20, { a: oc }, { a: 1 }, { a: 1 }, { a: 1 }) });
      }
    }
  }
  const hard = cases.filter((c) => c.near).every((c) => c.out === 0 || c.out === 1);
  ok(hard, `覆寫是硬決定:結果只會是 0 或 1(實測 ${[...new Set(cases.filter((c) => c.near).map((c) => c.out))].join('/')});換成 mix 就會出現 0.25/0.5/0.75`);
  ok(cases.filter((c) => !c.near).every((c) => c.out === c.cc),
    '遮蔽者比較遠 ⇒ 不覆寫(中心貢獻原樣通過)');
  // cls == NONE 的鄰居 MUST 不投票(一顆飄過去的粒子不得把它後面所有的線關掉)
  const noneVote = ovFn(10, 1, 0, 2, 2, 2, 5, 20, 20, 20, { a: 0 }, { a: 1 }, { a: 1 }, { a: 1 });
  ok(noneVote === 1, `沒有資訊的鄰居不投票(cls=NONE 的近格貢獻 0 ⇒ 結果仍是 ${noneVote})`);

  // ---- ④ 原文閘:魔數單一縫 / NearestFilter 守衛 / 落在 mrt 樣板之內 ----
  let PN = P;
  if (BREAK_NEAREST) {
    PN = bend(PN, /rt\.texture\[1\]\.minFilter = THREE\.NearestFilter;\r?\n\s*rt\.texture\[1\]\.magFilter = THREE\.NearestFilter;/,
      'rt.texture[1].minFilter = THREE.LinearFilter;\n      rt.texture[1].magFilter = THREE.LinearFilter;', '--break-nearest');
  }
  ok((PN.match(/\b(255|16|15)\.0\b/g) || []).length === 0,
    '魔數 16 / 15 / 255 在 postfx.js **一個都沒有**(編解碼只住 toon.js 的兩段 GLSL 字串)');
  ok(/import \{ INK_UNPACK_GLSL \} from '\.\/toon\.js';/.test(PN),
    '解碼由 toon.js import 前置(三個讀取點同吃一份)');
  ok(/if \(Array\.isArray\(rt\.texture\)\) \{[\s\S]{0,220}rt\.texture\[1\]\.minFilter = THREE\.NearestFilter;/.test(PN)
    && /rt\.texture\[1\]\.magFilter = THREE\.NearestFilter;/.test(PN),
    '附件 1 是 NearestFilter,而且**包在 `Array.isArray` 守衛裡**(退場路徑上 `rt.texture` 是單一 Texture ⇒ 沒守衛就是預設路徑在建構子 TypeError)');
  const inkM = /_inkMaterial\(\) \{[\s\S]*?\n  \}/.exec(P)[0];
  ok(/\$\{useInfo \? `/.test(inkM) && /ink \*= ctr;` : ''\}/.test(inkM),
    '貢獻乘算落在 `${useInfo ? … : \'\'}` 樣板之內(旋鈕全關時編譯出來的是逐字同舊制的程式)');
  ok(inkM.indexOf('float ctr = ( c0 > 0.5 )') < inkM.indexOf('float minD = d, minC = ctr;'),
    '中心貢獻先定案、再由四鄰投票覆寫(順序反了就是覆寫拿不到中心值)');

  // ---- ⑤ 表面群組(S3)/ 貢獻推導(S4)----
  ok(/export function surfGroup\(\)/.test(T) && /export function joinSurfGroup\(/.test(T),
    '表面群組的配號器與併入器都在 toon.js(全專案唯一入口)');
  const grpFn = new Function(`${/let _grpSeq = 1;[\s\S]*?\n\}/.exec(T)[0].replace('export ', '')}\nreturn surfGroup;`)();
  const ids = Array.from({ length: 70 }, () => grpFn());
  const bad = ids.filter((v) => Math.abs(v * 64 - Math.round(v * 64)) > 1e-12 || v <= 0 || v > 1);
  ok(bad.length === 0, `surfGroup 回**整數格 k/64**(70 次取樣;違規 ${bad.length})`);
  // 與 nextSurfId 的半整數格恆差 ≥ 0.5/64 = 0.0078 > INK_MRT.ID 的 0.004 門檻 ⇒ 永不撞號
  const worst = Math.min(...ids.map((v) => Math.min(...Array.from({ length: 64 }, (_, k) => Math.abs(v - (k + 0.5) / 64)))));
  ok(worst >= 0.5 / 64 - 1e-12, `群組號與逐材質號的最小距離 ${worst.toFixed(5)} ≥ 0.0078(> id 門檻 0.004 ⇒ 不會撞號)`);
  ok(!/Math\.random|rnd\(/.test(/let _grpSeq = 1;[\s\S]*?\n\}/.exec(T)[0]),
    'surfGroup **零亂數消耗**(§2.3:抽一枚共享 rnd() 當群組種子就會把整張圖的佈局往後推移)');
  const surfBlock = /let _surfSeq = 0;[\s\S]*?let _grpSeq = 1;/.exec(surfToonBase)?.[0] || '';
  ok(!BREAK_SURF || surfBlock.includes('false && _surfSeq >= SURF_SLOT_N'),
    '--break-surf 確實把耗盡分支改成回繞版(反向驗證不得靜默 no-op)');
  const surfFns = new Function(`${surfBlock.replace('export const SURF_ID', 'const SURF_ID')}
return { nextSurfId, SURF_ID, SURF_SLOT_N };`)();
  const surfKeys = Array.from({ length: surfFns.SURF_SLOT_N + 4 }, (_, i) => `audit:${i}`);
  const surfVals = surfKeys.map((k) => surfFns.nextSurfId(k));
  ok(new Set(surfVals.slice(0, surfFns.SURF_SLOT_N)).size === surfFns.SURF_SLOT_N
    && surfVals.slice(0, surfFns.SURF_SLOT_N).every((v) => Math.abs((v * 64) % 1 - 0.5) < 1e-12),
  `逐材質前 ${surfFns.SURF_SLOT_N} 個語意鍵 MUST 各得唯一半格(實得 ${new Set(surfVals.slice(0, surfFns.SURF_SLOT_N)).size} 個)`);
  ok(surfVals.slice(surfFns.SURF_SLOT_N).every((v) => v === surfFns.SURF_ID.OVERFLOW),
    `材質槽耗盡 MUST 固定回 OVERFLOW=${surfFns.SURF_ID.OVERFLOW}(不得循環撞號)`);
  ok(surfFns.nextSurfId('audit:stable') === surfFns.nextSurfId('audit:stable'),
    '相同語意鍵 MUST 重用同一個 surfaceId(建構順序不應改寫整張圖的線)');
  ok(surfFns.SURF_ID.OVERFLOW * 64 === 42 && !ids.includes(surfFns.SURF_ID.OVERFLOW),
    'OVERFLOW 保留整數格 42，且不與 surfGroup() 的 2..41 或地貌 43..63 子帶重疊');
  ok(/celOpts\.land\) return;/.test(T),
    'joinSurfGroup 對地貌材質 MUST skip(它恆 LAND_SURF_ID,A46 / Ⅶ)');
  // S4:兩支推導縫各住一邊,而且都嚴格單調
  ok(/export const INK_REPEAT_M = SOLDIER_H \* 2;/.test(T) && /export const inkRepeat = /.test(T),
    'inkRepeat(節距軸)住 toon.js;INK_REPEAT_M 是**授權值**(原文旁邊寫著校準面在定裝照)');
  ok(/授權值不是量測值/.test(readSrc('public', 'js', 'toon.js')),
    'INK_REPEAT_M 旁邊明講它不是量測值(同 MINI.BUFFER_F / REALIZED_F 的處理方式)');
  let mono = true, prevV = -1;
  for (let m = 0; m <= 6; m += 0.05) { const v = inkCtrM(m); if (v < prevV - 1e-12) mono = false; prevV = v; }
  ok(mono && inkCtrM(INK_CTR.FULL_M) === 1 && inkCtrM(INK_CTR.FULL_M + 10) === 1 && inkCtrM(0) === 0,
    `inkCtrM(尺寸軸)單調遞增且 sizeM ≥ FULL_M(${INK_CTR.FULL_M}m)恆等於 1`);
  ok(!/INK_CTR|inkCtrM/.test(T) && !/INK_REPEAT_M|inkRepeat/.test(code(readSrc('public', 'js', 'data.js'))),
    '兩份 contribution 表各住一邊、互不抄襲(並存已是上限,第三份必然分家)');

  // ---- ⑥ 內部折邊抑制(S8)與群組早退(S7)----
  let MRTSRC = /const INK_MRT = \{[\s\S]*?\n\};/.exec(P)[0];
  if (BREAK_SELFF) {
    MRTSRC = bend(MRTSRC, /SELF_F: [\d.]+,/, 'SELF_F: 1.0,', '--break-selff(SELF_F)');
    MRTSRC = bend(MRTSRC, /GRAZE_K: [\d.]+,/, 'GRAZE_K: 0.0,', '--break-selff(GRAZE_K)');
  }
  const MRT = new Function(`${MRTSRC}\nreturn INK_MRT;`)();
  // ⚠ 斷言 MUST 讀**解析值**比大小,MUST NOT 只比對字面(否則期望值會跟著 --break 跑,§5.4 ㋑)
  ok(MRT.SELF_F > 1, `INK_MRT.SELF_F = ${MRT.SELF_F} > 1(= 1 的話 mix(…, same) 整段是恆等式 = 等於沒做)`);
  ok(MRT.GRAZE_K > 0, `INK_MRT.GRAZE_K = ${MRT.GRAZE_K} > 0(掠射抑制是高度場網格線的解藥)`);
  ok(/float same = 1\.0 - step\( 0\.004, idv \);/.test(P),
    '`same`(五格同群組)只在哨兵齊全的分支內成立 ⇒ 分支外恆 0,天空/特效那一圈的剪影一格不動');
  ok(/float t0 = mix\( \$\{INK_MRT\.NRM0[^}]*\}, \$\{INK_MRT\.NRM0[^}]*\} \* \$\{INK_MRT\.SELF_F[^}]*\}, same \)/.test(rawP),
    '門檻經 `mix(…, same)` 切換而不是常數(常數 = 沒有「同群組才抬」這回事)');
  ok(!/ae <= \$\{INK\.EDGE0[^}]*\} \* [^\n]*same/.test(rawP) && /if \( \( ae <= \$\{INK\.EDGE0/.test(rawP),
    '**深度那一項刻意不抬**:深度跳變 = 剪影的定義,抬它就是兩顆重疊的石頭糊成一坨');
  let GRP = /float grpMax = max\([\s\S]*?gl_FragColor = base; return; \}/.exec(P);
  if (BREAK_GRP) {
    P = bend(P, /float grpMax = max\([\s\S]*?gl_FragColor = base; return; \}/, '', '--break-grp');
    GRP = /float grpMax = max\([\s\S]*?gl_FragColor = base; return; \}/.exec(P);
  }
  ok(!!GRP && /same > 0\.5 && grpMax > 2\.5/.test(GRP ? GRP[0] : ''),
    '群組早退 = 「五格同號**且至少一格是 GROUP**」(取「最近那一格」會讓幹與冠的交界出線)');
  ok(/visualPref\('inkGroup'\) === 'on'/.test(P) && /_wantInfo\(\) \{[\s\S]{0,320}inkGroup/.test(P),
    '群組早退是 `_wantInfo` 的**第三個**消費端(與 _inkMrt 合成一個旗標 = 開群組順手把折邊勾線也打開)');

  // ---- ⑦ S2 的簽章紀律:新 define 進鑰匙、uniform 不准進 ----
  ok(/\$\{surfAttr \? 'A' : ''\}\$\{card \? 'K' : ''\}\$\{refl \? 'R' : ''\}/.test(T),
    '三個新 define 全部進 customProgramCacheKey(漏掉 = 整叢卡片塌成一個點,而 three 不報錯)');
  const keyFn = /mat\.customProgramCacheKey = \(\) =>[\s\S]*?;\n/.exec(T)[0];
  ok(!/contrib|inkCtr|uInkCtr/.test(keyFn),
    '`contrib` 是 uniform ⇒ MUST NOT 進鑰匙(進去就是每一個貢獻值切一支新程式,而畫面上看不出來)');
  ok(/celOpts = \{[^}]*\bcontrib\b[^}]*\bsurfAttr\b[^}]*\}/.test(T),
    'celOpts 記著新欄位(applyPaint 以它重跑 ⇒ 漏了就是上塗裝的機體貢獻靜默重置回 1)');
  // 新欄位 MUST **逐個**被 toonMat / envMat 解構出來:落進 `...rest` 就是丟給
  // MeshToonMaterial 的建構子 = three 靜默忽略一個不存在的屬性(貢獻永遠是 1、卡片永遠不展開)。
  // 逐名比對而不是釘整行:整行釘死的話每加一個欄位都要改斷言,而改斷言正是最容易假綠的動作。
  {
    const destr = (fn) => /const \{([\s\S]*?)\.\.\.rest \} = opts;/.exec(
      new RegExp(`export function ${fn}\\([\\s\\S]*?\\n\\}`).exec(T)[0])?.[1] || '';
    const tDes = destr('toonMat'), eDes = destr('envMat');
    // `landId` 與 `land` / `landNrm` 同一族(地貌)⇒ **只給 envMat**,見上面 Ⅶ 那一條
    const shared = ['ink', 'contrib', 'surf', 'surfAttr', 'card', 'refl', 'dissolve'];
    const miss = [...shared.filter((k) => !new RegExp(`\\b${k}\\b`).test(tDes)),
      ...[...shared, 'landId'].filter((k) => !new RegExp(`\\b${k}\\b`).test(eDes))];
    ok(miss.length === 0,
      `toonMat / envMat 把新欄位**逐個解構出來**(缺 ${miss.length ? miss.join('/') : '無'};落進 ...rest = three 靜默忽略 ⇒ 貢獻永遠是 1)`);
  }
  // S9:接地 AO 改「乘」不是「覆寫」
  ok(/const prev = o\.geometry\.attributes\.color;/.test(T) && /\* p0;/.test(T),
    '接地 AO **乘進**既有頂點色(它與 mergeGeos 寫同一個通道;覆寫的症狀是整組沒有接地陰影或整組變灰白,而 gpu_lifecycle 照樣全綠)');
}

// ---------------------------------------------------------------- Ⅸ
// 溶入(序 8 ④-2)與地貌分區子帶(序 4 ①-3)住同一段:兩者都是「往 gInfo 那條路上加一維」,
// 而且兩者的錯法一模一樣 —— **沒有錯誤訊息,只有畫面上說不出哪裡怪**。
console.log('\nⅨ 溶入的材質契約(④-2)+ 地貌分區子帶(①-3)');
{
  let T = code(toon), P = code(postfx), G = code(game);
  const bend2 = (src, re, to, flag) => {
    const out = src.replace(re, to);
    if (out === src) { console.error(`✗ ${flag}:樣式沒咬到,反向驗證等於沒跑`); process.exit(1); }
    return out;
  };
  if (BREAK_DISSOLVE) {
    // 壞版兩處:①discard 挪到 opaque_fragment **之後**(顏色與 gInfo 都已經寫完才丟)
    //           ②`D` 從快取鍵拿掉(defines 不同卻共用程式 ⇒ 整批有或整批沒有)
    T = bend2(T, /\.replace\('#include <clipping_planes_fragment>', `\r?\n\s*#include <clipping_planes_fragment>\r?\n\s*#ifdef CEL_DIS\r?\n\s*if \( celDissolve\( vDisP \) \) discard;\r?\n\s*#endif`\)/,
      ".replace('#include <opaque_fragment>', `\n        #include <opaque_fragment>\n        #ifdef CEL_DIS\n        if ( celDissolve( vDisP ) ) discard;\n        #endif`)", '--break-dissolve(錨點)');
    T = bend2(T, /\$\{dissolve \? 'D' : ''\}/g, '', '--break-dissolve(快取鍵)');
    G = bend2(G, /deadIds\.has\(id\)/, 'true', '--break-dissolve(迷霧洩漏)');
  }
  if (BREAK_LANDINK) {
    // 壞版:子帶改用計畫字面的 `* 0.1`(0.1 / 0.15 落在現役槽 0.1015625 / 0.1484375 的
    // 0.004 門檻之內 ⇒ 那兩種地貌對建物的線靜默消失),同時拿掉拉桿閘(拉桿 0 也不再中性)
    T = bend2(T, /\(64 - LAND_ZONE_N \+ i\) \/ 64 : LAND_SURF_ID\)/g, 'i * 0.1 : LAND_SURF_ID)', '--break-landink(量化)');
    T = bend2(T, /if \( uLandInk > 0\.0 && vLandId > 0\.0 \) gSurf = vLandId;/g,
      'gSurf = vLandId;', '--break-landink(拉桿閘)');
  }
  if (BREAK_LANDMASK) {
    T = bend2(T,
      /return celNoise\( p\.yz \) \* w\.x \+ celNoise\( p\.xz \) \* w\.y \+ celNoise\( p\.xy \) \* w\.z;/g,
      'return celNoise( p.xz );', '--break-landmask(三平面)');
  }
  // ---- ① 溶入:錨點、uniform 物件、快取鍵、外殼 ----
  const iClip = T.indexOf("'#include <clipping_planes_fragment>'");
  const iOpq = T.indexOf(".replace('#include <opaque_fragment>'");
  ok(iClip >= 0 && iOpq >= 0 && iClip < iOpq,
    'discard 錨在 `clipping_planes_fragment`(= `void main()` 之後的第一個錨點),排在 opaque_fragment **之前** —— 排它之後就是顏色與 gInfo 都寫完了才丟,而洞邊的資訊仍然是機體的');
  ok(/#ifdef CEL_DIS\s*\r?\n\s*if \( celDissolve\( vDisP \) \) discard;/.test(T),
    'discard 收在 `#ifdef CEL_DIS` 之下(沒掛 dissolve 的材質片段原文逐字不變)');
  ok(/\$\{dissolve \? 'D' : ''\}/.test(T),
    '`CEL_DIS` 進 customProgramCacheKey(defines 不同卻共用程式 ⇒ 「有些載具會溶入、有些不會」)');
  ok(/mat\.userData\.celDisU = \{ value: 1 \};/.test(T)
    && /shader\.uniforms\.uDis = mat\.userData\.celDisU \|\| \{ value: 1 \};/.test(T),
    'uniform 物件住 `mat.userData` 而**不是**在 onBeforeCompile 裡新建(重編譯就換一顆 ⇒ 驅動端抓著舊的 = 「有時候不會溶入」)');
  ok(/celDissolve\( vec3 dp \)/.test(T) && /float k = uDis;/.test(T) && /if \( k >= 1\.0 \) return false;/.test(T),
    '`uDis = 1`(預設)⇒ **早退**,沒接驅動端的材質逐位元同舊制');
  ok(/\$\{DISSOLVE\.FAR_M > 0 \? `/.test(T) && DISSOLVE.FAR_M === 0,
    `遠距剔除那一段由 \`DISSOLVE.FAR_M > 0\` **編譯期**決定要不要編進去(現值 ${DISSOLVE.FAR_M} ⇒ 著色器裡連那一行都沒有 = 結構保證,不是 runtime 分支)`);
  ok(!/dissolveFarK/.test(code(readSrc('public', 'js', 'data.js'))),
    '剔除曲線只有 GLSL 那一份(JS 端再寫一支同樣的 smoothstep = 兩份會分家的實作,而症狀是「剔除的邊界跟看到的不一樣」)');
  ok(/vDisP = \( modelMatrix \* dsP \)\.xyz - uDisO;/.test(T),
    '抖動網格錨在**單位自己的世界原點**(拿純世界座標的話機體會從一張固定的網格裡游過去)');
  ok(/\$\{DISSOLVE\.CELL_M\.toFixed\(3\)\}/.test(T) && !/celNoise\( dp\.xz \/ [\d.]+ \)/.test(T),
    '抖動格距由 `DISSOLVE.CELL_M` 插值(**世界公尺**不是 texel:以 texel 給的話遠處整台被墨點蓋掉)');
  ok(count(code(toon), /=> 'celOutline'/g) === 1 && !/celOutlineD/.test(T),
    '反轉外殼仍共用 `celOutline` **一把**快取鍵(給部分外殼加 define 而鍵不變 = three 發錯程式,不報錯)');
  ok(/export function setDissolve\(/.test(T) && /o\.userData\.isOutline\) \{ o\.visible = v >= 1; return; \}/.test(T),
    '溶入期間外殼**整片收起**,結束復原 —— 而且那條規則住 `setDissolve` 這唯一寫入點(呼叫端自己去戳 userData = 第二份實作)');
  ok(/export function enableDissolve\(/.test(T)
    && /m\.transparent \|\| seen\.has\(m\) \|\| !m\.userData\?\.celOpts/.test(T)
    && /applyCelPatch\(m, \{ \.\.\.m\.userData\.celOpts, dissolve: true \}\)/.test(T),
    '溶解 define 事後只掛已走 cel 的不透明材質(alpha 特效不復辟第二份淡出)');
  ok(/makeUnit\(kind, side, \{ ring = true, ch = null, dissolve = false \}/.test(code(models))
    && /if \(dissolve\) enableDissolve\(g\);/.test(code(models))
    && /dissolve: true/.test(G),
    '只有戰場 makeUnit 開溶解材質;圖鑑 / 機體台不多編一組 shader');
  ok(/const deadIds = new Set\(\(m\.ev \|\| \[\]\)\.filter\(\(ev\) => ev\.e === 'die'\)\.map\(\(ev\) => ev\.id\)\);/.test(G)
    && /_removeEnt\(id, ent, deadIds\.has\(id\)\)/.test(G),
    '溶出只認同幀權威 die 事件;快照缺席(迷霧)必須即時收起');
  const iEntDrop = G.indexOf('this.ents.delete(id);');
  const iGhostAdd = G.indexOf('this._dissolveGhosts.push({ mesh: ent.mesh, origin, t: 0 });');
  ok(iEntDrop >= 0 && iGhostAdd > iEntDrop
    && /_updateDissolveGhosts\(dt\)[\s\S]*?dissolveOutAt\(g\.t\)[\s\S]*?this\.scene\.remove\(g\.mesh\);[\s\S]*?_dissolveGhosts\.splice\(i, 1\);/.test(G),
    '先摘掉 ents 再留純渲染殘影;時間到由同一迴圈收 scene 與清單');
  const outSamples = [0, DISSOLVE.OUT_S * 0.25, DISSOLVE.OUT_S * 0.5, DISSOLVE.OUT_S, DISSOLVE.OUT_S * 2]
    .map(dissolveOutAt);
  ok(DISSOLVE.OUT_S > 0 && outSamples[0] === 1 && outSamples.at(-1) === 0
    && outSamples.every((v, i) => i === 0 || v <= outSamples[i - 1]),
    `溶出曲線由 1 單調降到 0(${outSamples.map((v) => v.toFixed(3)).join('/')})`);
  // ---- ② 地貌分區子帶:撞號算術 ----
  const LZ = new Function(`${/export const LAND_ZONE_N = \d+;/.exec(T)[0].replace('export ', '')}
${/const LAND_SURF_ID = 0;/.exec(T)[0]}
${/export const landZoneId = [\s\S]*?;\n/.exec(T)[0].replace('export ', '')}
return { LAND_ZONE_N, landZoneId };`)();
  const zoneIds = Array.from({ length: LZ.LAND_ZONE_N }, (_, i) => LZ.landZoneId(i));
  ok(zoneIds.every((v) => Math.abs(v * 64 - Math.round(v * 64)) < 1e-12 && v > 0 && v <= 1),
    `分區子帶落在**整數格 k/64**(${zoneIds.map((v) => (v * 64).toFixed(0)).join('/')});半整數格是 nextSurfId 的值域,落上去 = 某些地貌對某些材質的線靜默消失`);
  const worstZ = Math.min(...zoneIds.map((v) => Math.min(
    ...Array.from({ length: 64 }, (_, k) => Math.abs(v - (k + 0.5) / 64)))));
  ok(worstZ >= 0.5 / 64 - 1e-12,
    `子帶與逐材質號(半整數格)的最小距離 ${worstZ.toFixed(5)} ≥ 0.0078 > id 門檻 0.004 —— 計畫字面的 \`* 0.1\` 在這裡紅(0.1 / 0.15 落在現役槽的 0.004 之內)`);
  const minSep = Math.min(...zoneIds.slice(1).map((v, i) => Math.abs(v - zoneIds[i])));
  ok(minSep > 0.004, `分區彼此的最小間距 ${minSep.toFixed(5)} > 0.004(跨地貌那條線才畫得出來)`);
  ok(LZ.landZoneId(-1) === 0 && LZ.landZoneId(LZ.LAND_ZONE_N) === 0 && LZ.landZoneId(1.5) === 0,
    '超界 / 非整數一律回 LAND_SURF_ID(原則 6:回一個亂數格 = 在地面上畫出一條沒有意義的線)');
  // ---- ③ 兩道閘 + 群組早退的 LAND 例外 ----
  ok(/if \( uLandInk > 0\.0 && vLandId > 0\.0 \) gSurf = vLandId;/.test(T),
    '**兩道閘**(拉桿 > 0 且屬性存在)才換號 ⇒ 拉桿 0 或呼叫端還沒接上 ⇒ 恆等於 LAND_SURF_ID = 逐位元同舊制');
  ok(/shader\.uniforms\.uLandInk = _landInkA;/.test(T) && /_landInkA\.value = visualPref\('landInk'\);/.test(T),
    '閘是**共享 uniform**(拉桿一動全場同一幀跟著換,而且不必為它多切一支程式)');
  ok(/\$\{landId \? 'Z' : ''\}/.test(T),
    '`CEL_LAND_ID` 進 customProgramCacheKey(它是 define:attribute 有沒有讀是編進程式裡的)');
  ok(/same > 0\.5 && grpMax > 2\.5 && grpMin > 1\.5/.test(P),
    '群組早退多一道「五格都不是 LAND」的閘 —— 子帶與群組號共用整數格那把梳子,萬一撞號,早退會讓整株樹**整個剪影消失**而不是少一條線(今天恆真 ⇒ 逐位元中性)');

  // ---- ④ 分區內苔草 / 濕痕:三平面硬遮罩 + 整數 surfaceId ----
  const LM = new Function(`const LAND_ZONE_N = ${LZ.LAND_ZONE_N};
const LAND_SURF_ID = 0;
${/export const LAND_MASK_N = \d+;/.exec(T)[0].replace('export ', '')}
${/export const landMaskId = [\s\S]*?;\n/.exec(T)[0].replace('export ', '')}
return { LAND_MASK_N, landMaskId };`)();
  const maskIds = [];
  for (let z = 0; z < LZ.LAND_ZONE_N; z++) for (let m = 1; m < LM.LAND_MASK_N; m++) maskIds.push(LM.landMaskId(z, m));
  ok(LM.LAND_MASK_N === 3 && maskIds.length === LZ.LAND_ZONE_N * 2,
    `每分區恰三態(基底 / 苔草 / 濕痕),遮罩格 ${maskIds.length} 個`);
  ok(maskIds.every((v) => Math.abs(v * 64 - Math.round(v * 64)) < 1e-12 && v > 0 && v < zoneIds[0])
    && new Set([...zoneIds, ...maskIds]).size === zoneIds.length + maskIds.length,
  `遮罩 surfaceId 全為整數格且與基底分區不撞號(${maskIds.map((v) => (v * 64).toFixed(0)).join('/')})`);
  ok(LM.landMaskId(-1, 1) === 0 && LM.landMaskId(0, 0) === 0
    && LM.landMaskId(0, LM.LAND_MASK_N) === 0 && LM.landMaskId(1.5, 1) === 0,
  '遮罩索引超界 / 基底態 / 非整數一律回 LAND_SURF_ID(寧缺勿錯)');
  const tri = /float celTriNoise\( vec3 p, vec3 wn \) \{[\s\S]*?\n        \}/.exec(T)?.[0] || '';
  ok(/celNoise\( p\.yz \) \* w\.x/.test(tri) && /celNoise\( p\.xz \) \* w\.y/.test(tri)
    && /celNoise\( p\.xy \) \* w\.z/.test(tri),
  '遮罩噪聲同時取 YZ / XZ / XY 三平面並按世界法線混合(單一 XZ 投影會把崖面沿 Y 拉直)');
  const landMask = /float lmA = celTriNoise[\s\S]*?diffuseColor\.rgb = mix\( diffuseColor\.rgb, diffuseColor\.rgb \* vec3\( 0\.68, 0\.74, 0\.78 \), lmWet \);/.exec(T)?.[0] || '';
  ok(/lmGrassZone/.test(landMask) && /lmWetZone/.test(landMask)
    && /lmN\.y/.test(landMask) && /lmA/.test(landMask) && /lmB/.test(landMask),
  '苔草 / 濕痕各自同時吃分區語意、表面方向與兩個噪聲尺度(只有幾何 = 等高線;只有噪聲 = 隨機斑點)');
  ok(/lmGrass = [\s\S]*?\* step\(/.test(landMask) && /lmWet = [\s\S]*?\* step\(/.test(landMask)
    && !/smoothstep/.test(landMask),
  '兩種材質邊界都是硬 step,MUST NOT 混成賽璐璐畫面裡唯一一條軟邊');
  ok(/lmOpen = 1\.0 - step\( 0\.5, lf\.a \)/.test(landMask),
    '道路 / 建成遮罩排除苔草與濕痕(正式道路上不得被地形 shader 重新長回覆蓋)');
  ok(/if \( celLandMask > 0\.5 \)/.test(T)
    && /LAND_ZONE_N \* LAND_MASK_N/.test(T) && /lfZone \* \$\{LAND_MASK_N - 1\}/.test(T),
  '可見遮罩折進既有 gInfo.b 整數槽；沒有另開第二份勾線通道');
  ok(/\$\{landField \? 'X' : ''\}/.test(T),
    '`CEL_LAND_FIELD` 進 customProgramCacheKey(defines 不同卻共用程式 = 地形整批有色無遮罩或反過來)');
}

// ---------------------------------------------------------------- Ⅹ
console.log('\nⅩ 霧範圍 ≡ 勾線淡出(序 8 ④-3)');
{
  let P = code(postfx);
  const bend3 = (src, re, to, flag) => {
    const out = src.replace(re, to);
    if (out === src) { console.error(`✗ ${flag}:樣式沒咬到,反向驗證等於沒跑`); process.exit(1); }
    return out;
  };
  if (BREAK_FADE) {
    // 壞版:淡出退回錨在相機 far 平面(= 地圖邊長 × 2,隨隊制變)
    P = bend3(P, /ink \*= 1\.0 - smoothstep\( uFade0, uFade1, d \);/g,
      'ink *= 1.0 - smoothstep( uFar * 0.55, uFar * 0.95, d );', '--break-fade(著色器)');
    P = bend3(P, /_inkFadeM\(\) \{/g, '_inkFadeMUnused() {', '--break-fade(推導縫)');
  }
  ok(/ink \*= 1\.0 - smoothstep\( uFade0, uFade1, d \);/.test(P),
    '淡出吃 `uFade0`/`uFade1` 兩個 uniform(公尺),**MUST NOT** 在著色器裡拿 `uFar × 比例` 算 —— 那就是錨回相機 far 平面');
  ok(!/uFar \* \$\{INK\.FADE|uFar \* 0\.55|uFar \* 0\.95/.test(P),
    'postfx.js 原文不再出現 `uFar × FADE*`(舊錨一格都不准留)');
  ok(count(P, /_inkFadeM\(\) \{/g) === 1 && count(P, /this\._inkFadeM\(\)/g) === 1,
    '推導**恰一份**(`_inkFadeM`),而且只有 render() 的共用接線在呼叫');
  ok(/const f = this\.scene\?\.fog;/.test(P) && /f\.far > 0/.test(P),
    '錨 = `scene.fog`(那是 setAirFog 已經要求「與 scene.fog 逐位元相同」的同一個物件 ⇒ 不開第二個寫入點)');
  ok(/: this\.camera\.far \* INK\.FADE1;/.test(P),
    '`scene.fog` 缺席 MUST **退回舊式**(直接讀 fog.far 會拿到 undefined ⇒ smoothstep(NaN, NaN, d) ⇒ **整片沒有線**,而每一條離線斷言都會過)');
  ok(/INK\.FADE_F = INK\.FADE0 \/ INK\.FADE1;/.test(P) && !/0\.578/.test(P),
    '形狀比 `FADE_F` 是**推導**(MUST NOT 手寫 0.578…)');
  // 行為:逐天氣 × 逐隊制執行真品 `_inkFadeM`,釘「打得到的東西恆有線」。
  // ⚠ 常數 MUST 由**原文**取(抄一份在這裡的話,有人調 FADE0/FADE1 之後這一段會靜默分家)
  const reachM = combatReachM();
  const F0 = Number(/FADE0: ([\d.]+),/.exec(P)[1]), F1 = Number(/FADE1: ([\d.]+),/.exec(P)[1]);
  const fadeFn = new Function('INK', 'combatReachM', `
${/  _inkFadeM\(\) \{[\s\S]*?\n  \}/.exec(P)[0].replace(/^\s*_inkFadeM\(\) \{/, 'function f(self) {').replace(/this\./g, 'self.')}
return f;`)({ FADE0: F0, FADE1: F1, FADE_F: F0 / F1 }, () => reachM);
  // WEATHERS 的 fogFar 現值(environment.js;此處只當**對照表**,錨仍是執行期的 scene.fog)
  const WF = { clear: 1.9, cloudy: 1.6, rain: 1.0, snow: 1.1, fog: 0.35 };
  const rows = [];
  let floorOk = true, orderOk = true, clearOk = true;
  for (const span of [480, 800, 1000, 1200]) {           // 迷你 + L1/L2/L3 的地圖邊長
    for (const [w, f] of Object.entries(WF)) {
      const [f0, f1] = fadeFn({ scene: { fog: { far: span * f } }, camera: { far: span * 2 } });
      if (!(f1 > f0)) orderOk = false;
      if (!(f0 >= reachM - 1e-6)) floorOk = false;
      if (w === 'clear' && span >= 800 && Math.abs(f1 - span * 2 * 0.95) > 1e-6) clearOk = false;
      rows.push(`${span}/${w} [${f0.toFixed(0)}, ${f1.toFixed(0)}]`);
    }
  }
  ok(orderOk, 'smoothstep 的兩個端點恆不反轉(沒有地板的話迷你 + 霧天會出現 fade0 > fade1)');
  ok(floorOk,
    `**打得到的東西恆有線**:逐隊制 × 逐天氣的 fadeStart 全部 ≥ combatReachM() = ${reachM.toFixed(0)}m(與 DOF「打得到的東西恆為全清晰」逐條對稱)`);
  ok(clearOk,
    `\`clear\` 天氣在實數上**恆等舊制**(fogFar 1.9·span ≡ FADE1 × camera.far = 0.95 × 2·span);其餘四種是設計上的行為改變 —— 現制把線整段畫在已經飽和的霧色上`);
  const noFog = fadeFn({ scene: {}, camera: { far: 2000 } });
  ok(noFog[1] === 2000 * 0.95 && Math.abs(noFog[0] - 2000 * 0.55) < 1e-9,
    `無霧場景退回舊式(camera.far 2000 ⇒ [${noFog[0].toFixed(0)}, ${noFog[1].toFixed(0)}] = 舊制的 0.55/0.95 × far)`);
  console.log(`  · 逐隊制 × 逐天氣的淡出帶:${rows.slice(0, 5).join(' / ')} …`);
}

// ---------------------------------------------------------------- Ⅺ
console.log('\nⅪ 賽璐璐學派(§0-b:ramp 查表 ⇄ 硬切 + 色相位移)');
{
  // 本段用**自己的一份**原文副本 `S`:`--break-school` 之類的壞版 MUST NOT 影響 Ⅰ 的 ramp
  // 斷言(它們守的是仍在服役的 School A 路徑,本來就該綠)。
  let S = toon, G = game;
  /** 字面替換 + §5.4 ㋑ 的當場失敗守衛(替換無效 = 反向驗證等於沒跑) */
  const bend = (src, re, to, tag) => {
    const out = src.replace(re, to);
    if (out === src) { console.error(`✗ --break-${tag}:樣式沒咬到原文,反向驗證等於沒跑`); process.exit(1); }
    return out;
  };
  if (BREAK_SCHOOL) {
    // 壞版 = 「把 School B 換回 School A」的三個面:替換文字本身、二選一的分岔點、硬切重組。
    S = bend(S, /return vec3\( saturate\( dotNL \) \);/, 'return vec3( texture2D( gradientMap, coord ).r );', 'school');
    S = bend(S, /_school === 'b' \? RAMP_PATCH_B : RAMP_PATCH_A/, 'RAMP_PATCH_A', 'school');
    S = bend(S, /\$\{_school === 'b' \? CEL_CUT_MIX_GLSL : ''\}/, '', 'school');
  }
  if (BREAK_CUTFLOOR) S = bend(S, /SHADOW_V: rampFloor\(3\) \* SHADOW_V_F,/, 'SHADOW_V: 0.25,', 'cutfloor');
  if (BREAK_NEUTRAL) {
    S = bend(S, /celOff \*= uCelShadowV \* celOnL \/ max\( 1e-6, celLum\( celOff \) \);/,
      'celOff = celOn * uCelRampTint * uCelShadowV;', 'neutral');
  }
  if (BREAK_CUTORDER) S = bend(S, /\n  4: \[0\.26, 0\.54\],/, '\n  4: [0.30, 0.36],', 'cutorder');
  if (BREAK_SHADOWTYPE) G = bend(G, /THREE\.PCFSoftShadowMap/, 'THREE.PCFShadowMap', 'shadowtype');
  const C = code(S);
  const grab = (re, what) => {
    const m = re.exec(S);
    if (!m) { console.error(`✗ 抽不到 ${what}(原文結構變了 —— 本段每一條斷言都會失去意義)`); process.exit(1); }
    return m[1] ?? m[0];
  };

  // ---- ① 學派是模組載入時定案的常數,School A 走的是同一份 GLSL 原始碼 ----
  const schoolSrc = grab(/const _school = \(\(\) => \{[\s\S]*?\n\}\)\(\);/, '_school');
  ok(/^const _school =/.test(schoolSrc) && count(C, /_school = /g) === 1,
    '`_school` 是**模組載入時**定案的 const(唯一賦值處;做成每幀可切的共享 uniform 就拿不到「School A 的 GLSL 逐字不變」這個逐位元保證)');
  ok(/visualPref\('celSchool'\)/.test(schoolSrc) && /get\('cel'\)/.test(schoolSrc),
    '兩個入口:設定頁旋鈕 `celSchool` 與 `?cel=`(同 installWorldCurve 讀 `?curve=0` 的 idiom)');
  ok(/if \(want === 'b' && !RAMP_CAN\)/.test(schoolSrc) && /return 'a';/.test(schoolSrc),
    'ramp 錨點對不上 ⇒ School B **退回 School A**(原則 6)—— MUST NOT 讓它硬切一個已經量化過的 ramp 值(那一刀切在階梯上 = 終端線變鋸齒)');
  const patchA = grab(/const RAMP_PATCH_A = `([\s\S]*?)`;/, 'RAMP_PATCH_A');
  ok(/float celG = texture2D\( gradientMap, coord \)\.r;/.test(patchA)
    && /return vec3\( celG \) \* mix\( uCelRampTint, vec3\( 1\.0 \), celRampDepth\( celG \) \);/.test(patchA),
    'School A 的替換文字**逐字凍結**在 `RAMP_PATCH_A`(這是「舊制還在原地」的原文證人;GPU 層的證人是定場照 md5)');
  const patchB = grab(/const RAMP_PATCH_B = `([\s\S]*?)`;/, 'RAMP_PATCH_B');
  ok(/return vec3\( saturate\( dotNL \) \);/.test(patchB) && !/gradientMap/.test(patchB),
    'School B 的 ramp hook **回傳線性 N·L**(不是查表)—— 量化整個往後挪到那一刀,`directDiffuse` 因此是「已乘過陰影遮罩」的累積直接光');
  ok(/_school === 'b' \? RAMP_PATCH_B : RAMP_PATCH_A/.test(C),
    '兩份替換文字由 `_school` 二選一(唯一分岔點;不需要任何新的 three 錨點)');

  // ---- ② 硬切重組:輸入、順序、加回來的兩項 ----
  const mix = grab(/const CEL_CUT_MIX_GLSL = `([\s\S]*?)`;/, 'CEL_CUT_MIX_GLSL');
  const mixOn = /\$\{_school === 'b' \? CEL_CUT_MIX_GLSL : ''\}/.test(C);
  ok(mixOn, '硬切重組只在 `_school === b` 時拼進 opaque_fragment 前置字串(School A 一個字元都不多)');
  ok(/celLum\( reflectedLight\.directDiffuse \)/.test(mix) && /smoothstep\( uCelCutLo, uCelCutHi, celLit \)/.test(mix),
    '那一刀吃 `reflectedLight.directDiffuse`,門檻與 `cutOf(bands)` 同源(uCelCutLo / uCelCutHi)');
  ok(/float celLit = celOnL > 1e-6 \? saturate\( celLum\( reflectedLight\.directDiffuse \) \/ celOnL \) : 0\.0;/.test(mix),
    '切的輸入**把 albedo 除掉**(分母 = 同一格的全受光值)—— 直接拿含 albedo 的量當門檻,0x0a 的深色裝甲永遠跨不過去 = 「這台機體永遠背光」');
  ok(/outgoingLight = mix\( celOff, celOn, celCut \) \+ reflectedLight\.indirectDiffuse \+ totalEmissiveRadiance;/.test(mix),
    '`outgoingLight` 被**重組**,而且 `indirectDiffuse` 與 `totalEmissiveRadiance` MUST 重新加回來(覆寫會把它們吃掉:症狀是所有自發光件在夜裡熄滅,而不報錯)');
  const iMix = C.indexOf("${_school === 'b' ? CEL_CUT_MIX_GLSL : ''}");
  const iRim = C.indexOf('float celRim = 1.0 - saturate( dot( normal, celV ) );');
  const iMetal = C.indexOf('#ifdef CEL_METAL');
  ok(mixOn && iMix > 0 && iMix < iRim && iMix < iMetal,
    '重組排在 rim / metal **之前**(它們是加成式演出;寫在重組之前就被覆寫吃掉,而畫面上只表現成「金屬高光不見了」)');

  // ---- ③ A14 ②:暗側的亮度地板,推導不手寫 ----
  const cutSrc = grab(/const SHADOW_V_F = [\s\S]*?\nexport function cutOf\(bands = 3\) \{[\s\S]*?\n\}/, 'CEL_CUT / cutOf');
  const rampFloorSrc = grab(/export function rampFloor\(bands = 3\) \{[\s\S]*?\n\}/, 'rampFloor');
  const CUT = new Function(`${/const RAMPS = \{[\s\S]*?\};/.exec(S)[0]}
${rampFloorSrc.replace('export ', '')}
${cutSrc.replace(/export /g, '')}
return { CEL_CUT, cutOf, rampFloor, SHADOW_V_F };`)();
  const floor3 = CUT.rampFloor(3);
  ok(CUT.CEL_CUT.SHADOW_V >= floor3 - 1e-12,
    `**A14 等價地板**:SHADOW_V(${CUT.CEL_CUT.SHADOW_V.toFixed(4)}) ≥ rampFloor(3)(${floor3.toFixed(4)} = 102/255)`);
  ok(/SHADOW_V: rampFloor\(3\) \* SHADOW_V_F,/.test(cutSrc) && CUT.SHADOW_V_F >= 1,
    '地板**推導不手寫**(102 只准有一份家 = `RAMPS`);旋鈕是「相對地板的餘裕」`SHADOW_V_F ≥ 1`,不是地板本身');
  ok(CUT.CEL_CUT.HUE_MIN_A > 0,
    `School B 的色相下限 > 0(現值 ${CUT.CEL_CUT.HUE_MIN_A})—— 兩根拉桿的 def 是 0,照搬過去就是**灰色陰影**,而色相位移正是這一換學派的全部收益`);

  // ---- ④ A14 ③:暗側亮度恆 = SHADOW_V × 亮側亮度(原文 + 數值,兩條一起才是等價保證)----
  // 原文那一條保證「畫面走的就是這條式子」;數值那一條驗的是這條式子的數學。
  const renorm = /celOff \*= uCelShadowV \* celOnL \/ max\( 1e-6, celLum\( celOff \) \);/.test(mix);
  const flat = /celOff = celOn \* uCelRampTint \* uCelShadowV;/.test(mix);
  ok(/vec3 celOff = celOn \* uCelRampTint;/.test(mix),
    '暗側色 = 亮側 × **同一份** `uCelRampTint`(兩派共用同一張 SHADOW_HUE、同一根拉桿、同一條 mech/env 兩軌)');
  if (!renorm && !flat) { console.error('✗ 抽不到暗側亮度那一行的任一種形狀(數值斷言會失去意義)'); process.exit(1); }
  ok(renorm, '暗側亮度**重正規化**那一行在(`celOff *= uCelShadowV * celOnL / max(1e-6, celLum(celOff))`)—— luma 是內積,對逐通道乘法不是乘性的;少了它就是把亮度藏進色相的後門');
  {
    const HUE = new Function(`${/const SHADOW_HUE = \[[^\]]*\];/.exec(S)[0]}
${/const LUMA_709 = \[[^\]]*\];/.exec(S)[0]}
${/const SHADOW_HUE_N = \(\(\) => \{[\s\S]*?\n\}\)\(\);/.exec(S)[0]}
${/const TINT_MAX_A = \d+;/.exec(S)[0]}
${/export function shadowTintRGB\(amount\) \{[\s\S]*?\n\}/.exec(S)[0].replace('export ', '')}
return { LUMA_709, shadowTintRGB, TINT_MAX_A };`)();
    const lum = (c) => c[0] * HUE.LUMA_709[0] + c[1] * HUE.LUMA_709[1] + c[2] * HUE.LUMA_709[2];
    const V = CUT.CEL_CUT.SHADOW_V;
    const key = [1.13, 1.02, 0.88];          // 任意主光色 × 強度(黃昏偏暖);結論與它無關
    let worst = 0, n = 0;
    for (let r = 0; r < 16; r++) for (let g = 0; g < 16; g++) for (let b = 0; b < 16; b++) {
      const base = [r / 15, g / 15, b / 15];
      if (base[0] + base[1] + base[2] === 0) continue;     // 純黑:兩側都是 0,恆等式退化
      const on = base.map((c, i) => c * key[i] / Math.PI);
      const onL = lum(on);
      for (const a of [0, 0.5, 1, 1.5, 2, 2.5, 3]) {
        const tint = HUE.shadowTintRGB(a);
        let off = on.map((c, i) => c * tint[i]);
        if (renorm) { const f = V * onL / Math.max(1e-6, lum(off)); off = off.map((c) => c * f); }
        else off = on.map((c, i) => c * tint[i] * V);
        worst = Math.max(worst, Math.abs(lum(off) - V * onL) / Math.max(1e-9, onL));
        n++;
      }
    }
    ok(worst < 1e-9,
      `**A14 ③ 亮度中性**:${n} 組(4096 基色 × 7 個拉桿值)的 luma(暗側) ≡ SHADOW_V × luma(亮側),最大相對誤差 ${worst.toExponential(1)}`);
  }

  // ---- ⑤ bands 的第二個語意:硬度階梯嚴格遞增 ----
  {
    const keys = [2, 3, 4, 'soft'];
    const w = keys.map((k) => CUT.cutOf(k)[1] - CUT.cutOf(k)[0]);
    const m = keys.map((k) => (CUT.cutOf(k)[0] + CUT.cutOf(k)[1]) / 2);
    ok(w.every((x, i) => i === 0 || x > w[i - 1]),
      `硬度階梯**帶寬**嚴格遞增 2 < 3 < 4 < soft(${w.map((x) => x.toFixed(2)).join(' < ')})—— 這是把「階數越多層次越多」翻成「唯一那一刀越寬」的唯一合法映射`);
    ok(m.every((x, i) => i === 0 || x > m[i - 1]),
      `硬度階梯**中點**同序(${m.map((x) => x.toFixed(2)).join(' < ')})—— 序一破,四個既有 bands: 呼叫端的語意就全反了`);
    ok(keys.every((k) => CUT.cutOf(k)[0] > 0 && CUT.cutOf(k)[1] < 1),
      '每一組的兩個端點都落在開區間 (0,1)(貼到 0 / 1 = 那一刀在畫面上永遠切不到)');
    ok(JSON.stringify(CUT.cutOf('沒有這個鍵')) === JSON.stringify(CUT.cutOf(3))
      && /Array\.isArray\(CEL_CUT\[bands\]\)/.test(cutSrc),
      '未知 bands 回退 3(與 `toonGradient` / `rampFloor` 同一條 fallback);判定用 `Array.isArray` 不是 truthy —— CEL_CUT 同時裝著兩個純量旋鈕');
  }

  // ---- ⑥ CEL_COOL 在硬切下 MUST 關掉(兩派 MUST NOT 混在同一顆物件上)----
  ok(/const coolOn = cool > 0 && _school !== 'b';/.test(C) && /if \(coolOn\) defines\.CEL_COOL = '';/.test(C),
    '`CEL_COOL` 在 School B 下不進 defines —— 它自己有一條 smoothstep 終端,與硬切並存 = 同一顆物件上兩條位置不同的明暗界');
  ok(/\$\{coolOn \? 'C' : ''\}/.test(C) && !/\$\{cool > 0 \? 'C' : ''\}/.test(C),
    'defines 與 `customProgramCacheKey` 吃**同一個** `coolOn`(鑰匙沒跟著換 = three 發錯程式,而且不報錯)');

  // ---- ⑦ 主光色:讀 three 自己那份燈光 uniform,不在 JS 端存第二份 ----
  const keySrc = grab(/const CEL_KEY_GLSL = `([\s\S]*?)`;/, 'CEL_KEY_GLSL');
  ok(/directionalLights\[ i \]\.color/.test(keySrc) && /#if NUM_DIR_LIGHTS > 0/.test(keySrc),
    '主光色取 three 自己的 `directionalLights[i].color`(= color × intensity)並帶 `NUM_DIR_LIGHTS > 0` 守衛 —— 日夜循環因此自動跟著走');
  ok(!/uCelKey/.test(C),
    'JS 端**沒有**第二份主光色 uniform:照抄一份就要有一個每幀餵它的呼叫端,兩份數字遲早分家,而症狀是「夜戰的暗側是一個與太陽無關的常數」且 audit_daynight 全綠');
  const lumSrc = grab(/const CEL_LUM_GLSL = `([\s\S]*?)`;/, 'CEL_LUM_GLSL');
  ok(/\$\{LUMA_709\.join\(', '\)\}/.test(lumSrc) && !/0\.2126/.test(lumSrc),
    'GLSL 的 Rec.709 三個數由 `LUMA_709` **推導成字串**(手抄的那一份會跟 shadowTintRGB 的正規化分家,而 A14 ③ 的恆等式正是靠兩者是同一把尺)');

  // ---- ⑧ A14 ④:一個場景只有一套量化 ----
  {
    // 凍結名冊:繞過 toon.js 的裸 MeshToonMaterial。**2026-08-16 已清空** ——
    // 原本那四處(GLB 植被的不透明樹幹 / 洞頂 / 潮間帶 / 水簾)在 School A 下無害,
    // 但 School B 下它們會留在 ramp 而全世界改硬切 =「同一棵樹的葉子硬切、樹幹漸層」,
    // 而每一條既有斷言照樣全綠。四處已改呼叫 `toon.js toonPlain()`(最小侵入:
    // School A 下完全不掛 onBeforeCompile ⇒ 逐位元等於原本那一行裸的建構子)。
    // 名冊清空**正是** `celSchool` 的 def 得以翻成 'b' 的前提(見下一條)。
    const ROSTER = {};
    const found = {};
    for (const f of readdirSync('public/js').filter((x) => x.endsWith('.js') && x !== 'toon.js')) {
      let src = code(readSrc('public', 'js', f));
      if (BREAK_SCHOOLMIX && f === 'biomes.js') src += '\nconst _mix = new THREE.MeshToonMaterial({ gradientMap: toonGradient() });\n';
      const n = count(src, /new THREE\.MeshToonMaterial\(/g);
      if (n) found[f] = n;
    }
    ok(JSON.stringify(found) === JSON.stringify(ROSTER),
      `繞過 toon.js 的裸 MeshToonMaterial = **凍結名冊**(宣告 ${JSON.stringify(ROSTER)};實測 ${JSON.stringify(found)})`);
    const rosterN = Object.values(ROSTER).reduce((a, b) => a + b, 0);
    ok(rosterN === 0 || VISUAL_KNOBS.celSchool.def !== 'b',
      `名冊非空(${rosterN} 處)⇒ \`celSchool\` 的 def MUST NOT 是 'b'(現值 '${VISUAL_KNOBS.celSchool.def}')—— 兩派混場出貨 = 相鄰物件兩種終端線形狀,而每一條斷言照樣全綠`);
    ok(/if \(m\.isMeshToonMaterial\) return m;/.test(code(toon)),
      '`toonify` 對已是 MeshToonMaterial 的直接早退(它是第六個混場來源;名冊那一條連它一起看)');
  }
  {
    const tp = grab(/export function toonPlain\(params = \{\} \) \{[\s\S]*?\n\}|export function toonPlain\(params = \{\}\) \{[\s\S]*?\n\}/, 'toonPlain');
    ok(/if \(_school !== 'b'\) return m;/.test(tp) && tp.indexOf("if (_school !== 'b') return m;") < tp.indexOf('onBeforeCompile'),
      '`toonPlain` 在 School A 下**完全不掛 onBeforeCompile**(= 逐位元等於今天那一行裸的 MeshToonMaterial;這是「最小侵入」唯一的證據面)');
    ok(!/uCelRim|gInfo/.test(tp),
      '`toonPlain` MUST NOT 順手加上 rim 與 gInfo 覆寫(樹幹那一行的 rim:0 是刻意的,而 gInfo 覆寫會讓折邊勾線多出線)');
  }

  // ---- ⑨ 投影軟硬是學派的一部分 ----
  ok(/this\.renderer\.shadowMap\.type = THREE\.PCFSoftShadowMap;/.test(code(G)),
    '投影型別 = `PCFSoftShadowMap`(§0-b 學派的一部分:那一刀會把柔化後的值重新量化 ⇒ 終端線更短更乾淨、不階梯)—— 這一行在 2026-08-16 之前沒有任何斷言在守');
}

console.log(`\n${fail === 0 ? '✅' : '❌'} 通過 ${pass} 項,失敗 ${fail} 項`);
process.exit(fail === 0 ? 0 : 1);
