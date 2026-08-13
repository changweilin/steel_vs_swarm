// ============ 畫面表現旋鈕 / 陰影偏色 / 風化場 / 零件抖動 / 景深模糊 稽核(離線)============
// 涵蓋 docs/visual_upgrade_plan.md 的 P1-B(陰影偏色搬進 ramp)、P2-A(風化屬性場)、
// P2-B(零件級細節抖動延伸到障礙與地標),以及把三者接上使用者的那一層(visualPrefs.js
// + 設定頁拉桿 + 樣品畫面)。
//
// 這一批的共同風險是**靜默**:
//   ・偏色寫成亮度不中性的乘數 ⇒ 悄悄繞過 A14/#INC-106 的「暗階 ≥ 102」,深色件在暗面塌黑;
//   ・預設值不等於舊制 ⇒ 「加了個設定」變成「偷偷改了所有人的畫面」;
//   ・風化場的乘數在拉桿 0 時不等於 1 ⇒ 關掉也回不去;
//   ・抖動把演出半徑頂出權威碰撞柱 ⇒ 看得見卻打不到(原則 4 / A30 家族);
//   ・樣品自己畫一套「看起來差不多」的色 ⇒ 調好了進戰場不是那樣。
// 以上全部沒有錯誤訊息,只有「怪怪的」。故逐條在此釘死。
//
// 讀原文一律走 `audit_src.mjs`(㋑ CRLF 陷阱);純函式一律**執行真品原文**再驗行為,
// MUST NOT 在本檔重寫一份公式。
// 用法:node tools/audit_visual_prefs.mjs
import { readSrc } from './audit_src.mjs';
import { VISUAL_KNOBS, visualPref, setVisualPref, resetVisualPrefs, visualPrefsDefault, onVisualChange }
  from '../public/js/visualPrefs.js';
import { partId, partJitter, vegPartXform } from '../public/js/xform.js';
import { makeField, bakeFieldTexture } from '../public/js/field.js';
import {
  DOF, combatReachM, dofNearM, dofFarM, dofAimBlend, UNITS, HERO_SIZE, CHARACTERS, GAME, MAPGEO,
  heroWeapon, heroAbility, altRangeMax, RANGE_TOL, hyperMaxArcM,
} from '../public/js/data.js';

let pass = 0, fail = 0;
const ok = (c, msg) => { c ? (pass++, console.log(`  ✓ ${msg}`)) : (fail++, console.error(`  ✗ ${msg}`)); };
const near = (a, b, e = 1e-9) => Math.abs(a - b) <= e;

const toonSrc = readSrc('public', 'js', 'toon.js');
const postSrc = readSrc('public', 'js', 'postfx.js');
const fieldSrc = readSrc('public', 'js', 'field.js');
const terrSrc = readSrc('public', 'js', 'terrain.js');
const xformSrc = readSrc('public', 'js', 'xform.js');
const hazSrc = readSrc('public', 'js', 'hazards.js');
const bioSrc = readSrc('public', 'js', 'biomes.js');
const mainSrc = readSrc('public', 'js', 'main.js');
const sampSrc = readSrc('public', 'js', 'matsample.js');
const prefSrc = readSrc('public', 'js', 'visualPrefs.js');
const dataSrc = readSrc('public', 'js', 'data.js');
const htmlSrc = readSrc('public', 'index.html');
const cssSrc = readSrc('public', 'css', 'style.css');
const helpSrc = readSrc('public', 'js', 'help.js');
/** 逐行剝掉行註解(單一縫計數 MUST NOT 把註解裡提到的名字算進去) */
const bare = (s) => s.split('\n').map((l) => l.replace(/\/\/.*$/, '')).join('\n');
const count = (s, re) => (bare(s).match(re) || []).length;

// ============ Ⅰ 旋鈕表:預設值 = 舊制,夾制不可繞過 ============
console.log('\nⅠ 旋鈕表(visualPrefs.js)');
{
  ok(Object.keys(VISUAL_KNOBS).length >= 4, `旋鈕 ${Object.keys(VISUAL_KNOBS).length} 項`);
  // 兩種控件型別:拉桿(min/max/step)與互斥選項(choices)。型別由**欄位本身**推導,
  // 消費端不得另寫一份「哪幾項是選單」的名單。
  for (const [k, d] of Object.entries(VISUAL_KNOBS)) {
    const good = d.choices
      ? Array.isArray(d.choices) && d.choices.length >= 2 && d.choices.includes(d.def)
      : Number.isFinite(d.def) && d.def >= d.min && d.def <= d.max && d.step > 0;
    ok(good && !!d.label && !!d.hint, `${k}:欄位齊全且預設值合法`);
  }
  // **卡在「需要美術方向確認」的兩項預設 MUST 是 0** —— 沒動過拉桿的玩家 MUST 看到舊畫面。
  ok(VISUAL_KNOBS.shadowMech.def === 0, '機體陰影偏色預設 0(= 逐位元同舊制,計畫書要求先確認方向)');
  ok(VISUAL_KNOBS.shadowEnv.def === 0, '環境陰影偏色預設 0(同上)');
  ok(VISUAL_KNOBS.ink.def === 1 && VISUAL_KNOBS.weather.def === 1, '已定案的兩項預設 1(= 交付調校值)');
  ok(Object.values(VISUAL_KNOBS).every((d) => d.choices || d.min === 0),
    '每一根拉桿都拉得到 0(= 這一項完全不生效)');
  // 互斥選項:名單外的值一律退回預設(手改 localStorage 不得穿過去)
  ok(setVisualPref('worldTextLang', 'zh') === 'zh', '選項:合法值收下');
  ok(setVisualPref('worldTextLang', 'klingon') === VISUAL_KNOBS.worldTextLang.def, '選項:名單外的值退回預設');
  ok(setVisualPref('worldTextLang', 3) === VISUAL_KNOBS.worldTextLang.def, '選項:數字不是合法選項');

  // 夾制:超界 / NaN / 非數字一律不得穿過去
  ok(setVisualPref('ink', 999) === VISUAL_KNOBS.ink.max, '超上界夾到 max');
  ok(setVisualPref('ink', -5) === VISUAL_KNOBS.ink.min, '超下界夾到 min');
  ok(setVisualPref('ink', NaN) === VISUAL_KNOBS.ink.def, 'NaN 退回預設');
  ok(setVisualPref('ink', '0.5') === 0.5, '字串數字照收(range input 給的是字串)');
  ok(setVisualPref('沒有這個鍵', 1) === 0 && visualPref('沒有這個鍵') === 0, '未知鍵一律拒收');

  // 廣播:一次寫入恰一次通知;寫入相同值不重複通知(拉桿拖動每格都會 input)
  let n = 0;
  const off = onVisualChange(() => n++);
  setVisualPref('ink', 0.3);
  const after1 = n;
  setVisualPref('ink', 0.3);
  ok(after1 === 1 && n === 1, '值真的改變才廣播(同值重寫不重複通知)');
  // 一個訂閱者拋出不得阻斷其餘訂閱者(拉桿只會表現成「有些東西沒跟著變」)
  const off2 = onVisualChange(() => { throw new Error('boom'); });
  let m = 0;
  const off3 = onVisualChange(() => m++);
  setVisualPref('ink', 0.4);
  ok(m === 1, '一個消費端拋出不阻斷其餘廣播');
  off(); off2(); off3();
  let n2 = 0;
  const off4 = onVisualChange(() => n2++);
  off4();
  setVisualPref('ink', 0.6);
  ok(n2 === 0, '解訂閱後不再收到(消費端 dispose 的前提)');

  resetVisualPrefs();
  ok(visualPrefsDefault() && Object.keys(VISUAL_KNOBS).every((k) => visualPref(k) === VISUAL_KNOBS[k].def),
    '還原預設把每一項都放回 def');

  ok(!/^import /m.test(bare(prefSrc)), 'visualPrefs.js 零 import(離線稽核要直接執行它驗預設與夾制)');
  ok(count(prefSrc, /localStorage/g) >= 2 && count(prefSrc, /try \{/g) >= 3,
    'localStorage 存取一律包 try(私密模式不得整支炸掉)');
}

// ============ Ⅱ 陰影偏色(P1-B):亮度中性 + 0 = 逐位元舊制 ============
console.log('\nⅡ 陰影偏色(P1-B)');
{
  // 執行 toon.js 的**原文**(該檔 import three,Node 載不進來 ⇒ 抽這一段純數學區塊執行)
  const P0 = toonSrc.indexOf('const SHADOW_HUE = [');
  const P1 = toonSrc.indexOf('\n}', toonSrc.indexOf('export function shadowTintRGB(')) + 2;
  ok(P0 > 0 && P1 > P0, '抽得到 shadowTintRGB 區塊');
  const shadowTintRGB = new Function(`${toonSrc.slice(P0, P1).replace('export function', 'function')}
    return shadowTintRGB;`)();
  const LUMA = [0.2126, 0.7152, 0.0722];
  const luma = (c) => c[0] * LUMA[0] + c[1] * LUMA[1] + c[2] * LUMA[2];

  // 上限:`toon.js TINT_MAX_A` 與兩根拉桿的 max MUST 是同一個數 —— 分家的症狀是
  // 「拉桿拉得到 300%,但超過 100% 之後畫面就不動了」,沒有任何錯誤訊息。
  const maxA = Number(/const TINT_MAX_A = ([\d.]+)/.exec(toonSrc)?.[1]);
  ok(Number.isFinite(maxA) && count(toonSrc, /const TINT_MAX_A = /g) === 1, `偏色上限是具名常數(${maxA})`);
  ok(VISUAL_KNOBS.shadowMech.max === maxA && VISUAL_KNOBS.shadowEnv.max === maxA,
    '兩根拉桿的 max 與 TINT_MAX_A 一致(拉得到的範圍 = 真的算得出來的範圍)');
  // **上限 MUST > 1**:1.0 只是 SHADOW_HUE 自己那個長度,而偏色只乘得到暗階的直接光那一項
  // ⇒ 真瀏覽器實測峰值只有 +5/255(2026-08-03 使用者回報「調整時看不出差異」的一半原因)。
  ok(maxA > 1, `上限 ${maxA} > 1(100% 的實測峰值只有 +5/255,把它當天花板 = 這根拉桿等於沒有)`);

  const z = shadowTintRGB(0);
  ok(z[0] === 1 && z[1] === 1 && z[2] === 1, '強度 0 = 純白乘數 ⇒ **逐位元**同舊制(不是「差不多」)');
  // 亮度中性是 A14 的保命條:暗階 ≥ 102 的規定不可以被「乘一個暗色」繞過去。
  // luma(1 + (c−1)a) = 1 + (luma(c) − 1)·a,而 luma 正規化過 ⇒ **與上限無關**恆為 1。
  let worst = 0, minC = 1;
  for (let a = 0; a <= maxA + 1e-4; a += maxA / 100) {
    const t = shadowTintRGB(a);
    worst = Math.max(worst, Math.abs(luma(t) - 1));
    minC = Math.min(minC, Math.min(...t));
  }
  ok(worst < 1e-9, `全值域亮度恆為 1(最大偏差 ${worst.toExponential(1)})—— A14 的暗階亮度逐位元不動`);
  ok(minC > 0.5, `最暗通道 ${minC.toFixed(3)} 仍遠離 0(色相在走,亮度沒掉)`);
  const mid = shadowTintRGB(0.5), full = shadowTintRGB(1), top = shadowTintRGB(maxA);
  ok(mid[2] > mid[0] && full[2] > mid[2] && full[0] < mid[0], '偏色方向恆為藍綠,且強度單調');
  ok(top[2] > full[2] && top[0] < full[0], '超過 100% 仍沿同一個色相繼續走(不是停在 SHADOW_HUE 上)');
  ok(shadowTintRGB(maxA + 9)[0] === top[0] && shadowTintRGB(-3)[0] === 1, `強度自身夾在 [0, ${maxA}]`);

  // 單一縫:GLSL 的乘數與樣品畫面同吃這一支,MUST NOT 有第二份色表
  ok(count(toonSrc, /SHADOW_HUE\s*=/g) === 1, '偏色色相表只有一份');
  ok(count(toonSrc, /export function shadowTintRGB/g) === 1, 'shadowTintRGB 只有一份實作');
  // 接在 ramp 查表上,不是接在最終顏色上(接在最終顏色 = 只認得到那一條手寫的 dot)
  ok(count(toonSrc, /const RAMP_HOOK = /g) === 1 && toonSrc.includes('texture2D( gradientMap, coord ).r'),
    'ramp 查表的替換錨點是具名常數(升級 three MUST 重新核對這一行)');
  // 最容易靜默失效的一條:`onBeforeCompile` 收到的是**還沒展開 include** 的原始碼
  ok(/THREE\.ShaderChunk\?\.\[RAMP_CHUNK\]/.test(toonSrc)
    && /replace\(RAMP_INC, RAMP_PATCHED\)/.test(bare(toonSrc)),
    '從 ShaderChunk 取原文後換掉 **#include 指令**(在展開後的字串上找 = 永遠找不到、永遠走落地路徑)');
  ok(count(bare(toonSrc), /shader\.fragmentShader\.includes\(RAMP_HOOK\)/g) === 0,
    '沒有殘留「在 fragmentShader 上直接找 RAMP_HOOK」的舊寫法');
  // **2026-08-03 的真凶**:`getGradientIrradiance()` 住在 `gradientmap_pars_fragment`,而舊制
  // 錨在 `lights_toon_pars_fragment`(那裡只是**呼叫**它的地方)⇒ RAMP_PATCHED 恆為 null、
  // 每一份材質都走落地保險,畫面上只表現成「兩根偏色拉桿看不出差異」。
  // chunk 名 MUST 只有一份、`#include` 指令 MUST 由它推導(兩個名字各寫一次就會再分家一次)。
  const chunkName = /const RAMP_CHUNK = '([a-z_]+)'/.exec(toonSrc)?.[1];
  ok(count(toonSrc, /const RAMP_CHUNK = /g) === 1 && chunkName === 'gradientmap_pars_fragment',
    `ramp 錨在 getGradientIrradiance 真正的家(${chunkName})—— 升級 three MUST 重新核對`);
  ok(/const RAMP_INC = `#include <\$\{RAMP_CHUNK\}>`/.test(toonSrc)
    && count(bare(toonSrc), /#include <lights_toon_pars_fragment>/g) === 0,
    '#include 指令由 RAMP_CHUNK 推導,沒有第二個手寫的 chunk 名');
  // ---- 權重 = 「這一階在 ramp 上有多深」,不是「這一階有多亮」(2026-08-04)----
  // 舊制拿 `celG`(階的**亮度**)當權重,而暗階亮度是 A14/#INC-106 為了「深色件不塌黑」
  // 訂的下限(102/255)⇒ 那條保命規則順便把偏色也夾掉:三階 ramp 的最暗階只吃得到 60%
  // 的偏色,而拉桿的說明寫的是「100% = 天光藍本身的濃度」。兩件事被同一個數字綁著,不報錯。
  ok(/uCelRampTint/.test(toonSrc) && /mix\( uCelRampTint, vec3\( 1\.0 \), celRampDepth\( celG \) \)/.test(toonSrc),
    '偏色權重 = ramp **深度**(celRampDepth),不是階的亮度 celG');
  ok(count(toonSrc, /float celRampDepth\( float g \)/g) === 1
    && count(bare(toonSrc), /const RAMP_DEPTH_FN = /g) === 1,
    '深度公式只有一份 GLSL 實作(補丁路徑與落地路徑同吃)');
  ok(/mix\( uCelRampTint, vec3\( 1\.0 \), celG \)/.test(toonSrc) === false,
    '沒有殘留「權重 = celG」的舊寫法');
  ok(/uCelRampFb/.test(toonSrc) && /canPatch \? 0 : 1/.test(bare(toonSrc))
    && /if \( uCelRampFb > 0\.5 \)/.test(toonSrc),
    '替換失敗有等效落地路徑(原則 6;否則 three 一升級就是「拉桿沒反應」)');
  // 落地路徑 MUST 取**同一張 ramp 的階值**當權重:手寫的線性斜坡把偏色攤平在整顆球上,
  // 實測差異只剩補丁版的一個零頭(最大 11/765)⇒ 保險壞掉時剛好也看不出來 = 等於沒有保險。
  ok(/float celFbG = texture2D\( gradientMap, vec2\( dot\( normal, uCelLightDir \) \* 0\.5 \+ 0\.5, 0\.0 \) \)\.r;/.test(toonSrc)
    && /#ifdef USE_GRADIENTMAP/.test(toonSrc),
    '落地路徑的權重取同一張 ramp 的階值(壞掉時 MUST 仍看得出來還在動)');
  ok(/float celFbW = celRampDepth\( celFbG \);/.test(toonSrc)
    && /mix\( uCelRampTint, vec3\( 1\.0 \), celFbW \)/.test(toonSrc),
    '落地路徑也走同一支 celRampDepth(兩條路徑的偏色濃度 MUST 一致)');

  // ---- 正規化基準 `rampFloor`:推導不手寫、逐 ramp 各自一份 ----
  {
    const R0 = toonSrc.indexOf('const RAMPS = {');
    const R1 = toonSrc.indexOf('\n}', toonSrc.indexOf('export function rampFloor(')) + 2;
    ok(R0 > 0 && R1 > R0, '抽得到 RAMPS + rampFloor 區塊');
    // 這一段夾著 `toonGradient`(它碰 THREE) —— 只把 export 剝掉即可,反正不呼叫它。
    const { RAMPS, rampFloor } = new Function(`${toonSrc.slice(R0, R1).replace(/export function/g, 'function')}
      return { RAMPS, rampFloor };`)();
    ok(count(toonSrc, /export function rampFloor/g) === 1, 'rampFloor 只有一份實作');
    // 推導:每一組的基準 MUST 等於**那一組自己**的暗階(改 RAMPS 自己跟著走)
    let derived = true;
    for (const k of Object.keys(RAMPS)) derived = derived && near(rampFloor(k), RAMPS[k][0] / 255);
    ok(derived, `rampFloor 逐組由 RAMPS 推導(${Object.keys(RAMPS).map((k) => `${k}:${rampFloor(k).toFixed(3)}`).join(' ')})`);
    ok(near(rampFloor(), rampFloor(3)) && near(rampFloor('無此組'), rampFloor(3)),
      '未知 / 省略的階數退回 3 階(與 toonGradient 同一條回退規則)');
    ok(rampFloor('soft') > rampFloor(3),
      'soft(淺色大面積)的基準高於 3 階 —— 拿 3 階的 0.4 去量它,白色件的陰影偏色會少掉一半');

    // 行為:深度權重把「最暗階」與「最亮階」兩個端點釘死。GLSL 只有一行,故在此**照它的
    // 定義**驗語意(文字面已由上面的單一縫斷言釘住),重點是兩個端點與單調性。
    const depth = (g, b) => Math.min(1, Math.max(0, (g - rampFloor(b)) / Math.max(1e-3, 1 - rampFloor(b))));
    ok(near(depth(RAMPS[3][0] / 255, 3), 0), '最暗階的深度 = 0 ⇒ 吃**整份**偏色(拉桿說明的「100%」這才兌現)');
    ok(near(depth(1, 3), 1), '最亮階的深度 = 1 ⇒ 逐位元不偏(受光面仍是光源本色)');
    ok(depth(RAMPS[3][1] / 255, 3) > 0 && depth(RAMPS[3][1] / 255, 3) < 1, '中間階落在兩端之間');
    // 舊制(權重 = celG)在最暗階只給 40% 的白 + 60% 的色 ⇒ 新制 MUST 嚴格更濃
    const oldW = RAMPS[3][0] / 255;
    ok(depth(RAMPS[3][0] / 255, 3) < oldW && (1 - depth(RAMPS[3][0] / 255, 3)) / (1 - oldW) > 1.6,
      `最暗階的偏色濃度較舊制提升 ${((1 - depth(RAMPS[3][0] / 255, 3)) / (1 - oldW)).toFixed(2)} 倍`);
    // 每一階的深度 MUST 單調遞增(否則「越暗偏越多」不成立)
    let mono = true;
    for (const k of Object.keys(RAMPS)) {
      const st = RAMPS[k];
      for (let i = 1; i < st.length; i++) mono = mono && depth(st[i] / 255, k) > depth(st[i - 1] / 255, k);
    }
    ok(mono, '每一組 ramp 逐階深度嚴格遞增(越暗偏越多)');
  }
  // uniform MUST 由 rampFloor 推導、且 `bands` MUST 一路傳到 applyCelPatch ——
  // 漏傳的症狀是「soft / 2 階 / 4 階材質的陰影偏色跟 3 階的不一樣濃」,沒有錯誤訊息。
  ok(/uCelRampLo = \{ value: rampFloor\(bands\) \}/.test(bare(toonSrc))
    && count(bare(toonSrc), /uCelRampLo = \{ value:/g) === 1,
    'uCelRampLo 由 rampFloor(bands) 推導且只有一個寫入點');
  ok(/uniform float uCelRampLo;/.test(toonSrc), 'uCelRampLo 的宣告頂在片段程式最前(展開後的 chunk 比 main 早)');
  // 樣式只釘「bands 有沒有一路傳下去」;後面還接不接別的參數(land / landNrm …)不管
  ok(/applyCelPatch\(m, \{ metal: !!celMetal, rim, soft, bands\s*[,}]/.test(bare(toonSrc))
    && /tint: 'env', preview, soft, bands\s*[,}]/.test(bare(toonSrc)),
    'toonMat / envMat 都把 bands 傳給 applyCelPatch(同一份 ramp 餵貼圖也餵權重基準)');
  ok(/celOpts = \{[^}]*\bbands\b[^}]*\}/.test(bare(toonSrc)),
    'celOpts 記著 bands(applyPaint 事後重注入時不得掉基準)');
  // 兩軌:機體與環境各一根拉桿,MUST NOT 併成一個值
  ok(/_rampTint = \{[\s\S]{0,200}mech:[\s\S]{0,200}env:/.test(toonSrc), '偏色分機體 / 環境兩軌');
  ok(/tint: 'env'/.test(bare(toonSrc)), 'envMat 走 env 軌');
  ok(count(toonSrc, /tint = 'mech'/g) === 1, 'toonMat / toonify 走預設的 mech 軌(單一預設值)');
  // 共享 uniform:拉桿改值 MUST NOT 重建材質
  ok(/onVisualChange\(syncVisualPrefs\)/.test(toonSrc), 'toon.js 訂閱拉桿');
  ok(!/needsUpdate = true;?\s*\}\s*\nonVisualChange/.test(toonSrc), '拉桿回呼不重建材質(共享 uniform 即可)');
}

// ============ Ⅲ 風化場(P2-A) ============
console.log('\nⅢ 風化場(P2-A)');
{
  // 烤場:純資料、確定性、值域
  const f = makeField(12345, 900);
  const b = { minX: -450, maxX: 450, minZ: -450, maxZ: 450 };
  const t1 = bakeFieldTexture(f, b, 32), t2 = bakeFieldTexture(f, b, 32);
  ok(t1 instanceof Uint8Array && t1.length === 32 * 32, `烤出 ${t1.length} 格 Uint8Array`);
  ok(t1.every((v, i) => v === t2[i]), '同場同邊界逐位元可重現(§2.3 確定性)');
  ok(t1.every((v) => v >= 0 && v <= 255), '值域夾在 0~255');
  // 取樣點 MUST 是格心(邊界對齊寫錯的話,場會整體偏半格 —— 完全看不出來)
  const mid = bakeFieldTexture(f, b, 1)[0];
  ok(near(mid, Math.round(f(0, 0) * 255), 1), '單格 = 場在框中心的值(格心取樣,不是格角)');
  // 只看**程式碼**:區塊註解裡本來就會提到 three(那是在解釋為什麼不用它)
  const fieldCode = fieldSrc.replace(/\/\*[\s\S]*?\*\//g, '');
  ok(!/from 'three'/.test(fieldCode) && !/DataTexture/.test(bare(fieldCode)),
    'field.js 仍零 three、不建 DataTexture(貼圖只准在 toon.js 建,與 ramp 同一條規矩)');
  ok(!/Math\.random/.test(bare(fieldSrc)), 'field.js 無 Math.random(§2.3)');

  // 安裝:兩條路徑(有無衛星影像)都要有場,且種子與地表色階梯**錯開**
  ok(count(terrSrc, /installWeatherField\(/g) === 2, '安裝點恰一處實作 + 一處呼叫(在 if/else 之前 ⇒ 兩條路徑都吃得到)');
  ok(/WEATHER_SEED_MIX/.test(terrSrc) && /\^ WEATHER_SEED_MIX/.test(terrSrc),
    '風化場種子與色階梯錯開(兩者鎖在一起 = 兩個訊號看起來只有一個)');
  ok(count(toonSrc, /export function setWeatherField/g) === 1, 'setWeatherField 只有一份(唯一寫入點)');
  ok(/old\?\.dispose\(\)/.test(toonSrc), '換場時放掉上一張場貼圖(A25)');
  // 中性 = 1:拉桿歸零 MUST 逐位元回到舊制
  ok(/\( texture2D\( uCelWField, wuv \)\.r - 0\.5 \) \* 2\.0 \* uCelWSpread/.test(toonSrc),
    '乘數 = 1 + (場 − 0.5)×2×強度 ⇒ 強度 0 恆為 1(拉桿歸零 = 舊制)');
  ok(count(toonSrc, /celWeatherF\(\)/g) === 3, 'celWeatherF 一份定義、兩個消費端(苔蘚 + 水彩暈染)');
  ok(/#else\s*\n\s*return 1\.0;/.test(toonSrc), '取不到世界座標的材質回中性(機體不該因為停在哪而換一種鏽)');
  // 苔蘚權重 MUST 夾在 [0,1]:celWeatherF 最高到 1 + WEATHER_SPREAD × 拉桿上限,mix 在 t > 1
  // 是**外插** ⇒ 場最高的那幾塊過飽和,而且拉桿上半段只是外插得更遠 = 看不出差異。
  ok(/mix\( diffuseColor\.rgb, uCelMossC, saturate\( mossW \) \)/.test(toonSrc),
    '苔蘚權重夾在 [0,1](mix 在 t > 1 是外插,不是「更多苔」)');

  // ---- 設定頁樣品的專屬場(2026-08-03 使用者回報「風化密度調整時看不出差異」)----
  // 兩層原因都不報錯:大廳的場是 1×1 中性貼圖(恆 0.5 ⇒ 乘數逐位元恆 1),戰鬥中的場又是
  // 整張圖的尺度(樣品那 24m 只取到單一個值)。
  ok(count(toonSrc, /function ensurePreviewField\(/g) === 1
    && /_wFieldPrev/.test(toonSrc) && /_wRectPrev/.test(toonSrc),
    '樣品有自己的場(貼圖 + 取樣框各一條軌)');
  ok(/preview \? _wFieldPrev : _wField/.test(toonSrc) && /preview \? _wRectPrev : _wRect/.test(toonSrc),
    '只有「哪一張 + 取樣框」換軌,取樣規則與強度仍是同一份(同 _rampTint 的 mech / env)');
  ok(count(bare(sampSrc), /preview: true/g) === 2 && !/setWeatherField/.test(sampSrc),
    '樣品走 preview 軌,MUST NOT 去寫世界那一張(戰鬥中一開設定就會把整場的場換掉)');
  // 苔蘚是世界 Y 軸投影 ⇒ 沒有一片正朝上的面,拉桿就只剩 wash 那 ±7% 在動 = 等同看不出差異
  ok(/moss: \{ amount: 0\.8 \}/.test(sampSrc) && /PlaneGeometry\(24, 24\)/.test(sampSrc),
    '樣品地面帶 moss(畫面裡唯一一片正朝上又佔滿下半幅的面)');
  const span = Number(/const PREVIEW_SPAN = (\d+)/.exec(toonSrc)?.[1]);
  ok(span === 24, `樣品場的取樣框 ${span}m 與樣品地面同邊長(場的起伏才鋪滿樣品畫面)`);
}

// ============ Ⅳ 零件級細節抖動(P2-B) ============
console.log('\nⅣ 零件級細節抖動(P2-B)');
{
  // 規則的單一縫:植被 / 障礙 / 地標同吃 xform.js
  ok(count(xformSrc, /export function partJitter/g) === 1, 'partJitter 只有一份實作');
  ok(count(xformSrc, /export function partId/g) === 1, 'partId 只有一份實作');
  ok(/partJitter/.test(bare(hazSrc)) && /partJitter/.test(bare(bioSrc)),
    '障礙(hazards)與地標(biomes)都走這一支,沒有各寫一份');
  ok(!/hash01/.test(bare(hazSrc)) && !/0x5bd1e99/.test(bare(bioSrc)),
    '消費端沒有把雜湊 / 自轉式抄過去');

  // 行為:只增不減、只有軸心件自轉、dj = 0 恆中性、確定性
  let minJr = Infinity, maxJr = 0, offAxisSpin = 0;
  for (let i = 0; i < 400; i++) {
    const dj = (i + 0.5) / 400;
    const a = partJitter(partId(i * 0.37, 0, 0), dj, 0.06, true);
    const b = partJitter(partId(i * 0.37, 1.2, 0.4), dj, 0.06, false);
    minJr = Math.min(minJr, a.jr, b.jr);
    maxJr = Math.max(maxJr, a.jr, b.jr);
    if (b.spin !== 0) offAxisSpin++;
  }
  ok(minJr >= 1, `半徑只增不減(最小 ${minJr.toFixed(4)};縮小會拉開「剛好貼合」的接合)`);
  ok(maxJr <= 1.06 + 1e-9, `半徑增幅收在振幅上界內(最大 ${maxJr.toFixed(4)})`);
  ok(offAxisSpin === 0, '偏移件一律不自轉(貼合靠特定朝向的頂點,轉了就開縫)');
  const n0 = partJitter(partId(1, 0, 0), 0, 0.06, true);
  ok(n0.jr === 1 && n0.spin === 0, 'dj = 0 恆中性 ⇒ 沒有種子的舊呼叫端逐位元不變');
  const r1 = partJitter(partId(2, 0, 0), 0.42, 0.06, true);
  const r2 = partJitter(partId(2, 0, 0), 0.42, 0.06, true);
  ok(r1.jr === r2.jr && r1.spin === r2.spin, '同輸入逐位元同輸出(全房看到同一顆物件)');
  ok(partJitter(partId(2, 0, 0), 0.42, 0.06, true).jr !== partJitter(partId(9, 0, 0), 0.42, 0.06, true).jr,
    '同一株的不同零件抖不同的量(否則整株等比放大 = 看不出差別)');

  // 回歸:vegPartXform 抽出 partJitter 之後 MUST 與舊公式逐位元相同
  const hash01 = new Function(`${xformSrc.slice(xformSrc.indexOf('function hash01('),
    xformSrc.indexOf('\n}', xformSrc.indexOf('function hash01(')) + 2)}\nreturn hash01;`)();
  let diff = 0;
  for (let i = 0; i < 200; i++) {
    const part = { y: i * 0.13, px: i % 3 === 0 ? 0 : 0.7, pz: 0, key: i % 2 ? 'leaf' : undefined, j: i % 5 === 0 ? 2 : undefined };
    const dj = (i + 0.5) / 200;
    const pid = Math.round((part.y || 0) * 8) * 131 + Math.round((part.px || 0) * 8) * 373
      + Math.round((part.pz || 0) * 8) * 769;
    const di = (dj * 8191) | 0;
    const amp = (part.key ? 0.18 : 0.08) * (part.j || 1);
    const oldJr = 1 + hash01(pid, di) * amp;
    const oldSpin = !(part.px || part.pz) ? (hash01(pid ^ 0x5bd1e99, di) - 0.5) * Math.PI * 2 : 0;
    const now = vegPartXform(part, { x: 0, y: 0, z: 0, s: 1, ry: 0, dj });
    if (!near(now.scl[0], oldJr, 0) || !near(now.scl[2], oldJr, 0)) diff++;
    // 自轉只影響四元數;這裡以「有沒有轉」對帳即可(值本身由上面兩支雜湊決定)
    const spun = Math.abs(now.quat[1]) > 1e-12 || Math.abs(now.quat[3] - 1) > 1e-12;
    if (spun !== (oldSpin !== 0)) diff++;
  }
  ok(diff === 0, '植被抖動抽縫後**逐位元同舊制**(200 組零件 × 種子全數相符)');

  // 演出半徑夾在權威碰撞柱內(原則 4 / A30 家族):兩個消費端都要**量**過才套用
  for (const [name, src, r] of [['hazards.js', hazSrc, /ext > r/], ['biomes.js', bioSrc, /ext > colR/]]) {
    ok(r.test(bare(src)) && /setFromObject/.test(bare(src)),
      `${name}:抖完實測水平外廓,頂出碰撞柱就退回原樣(不是憑感覺給振幅)`);
  }
  ok(/djAt\(x, z\)/.test(bare(bioSrc)) && !/jitterMegalith\(g, rnd\(\)/.test(bare(bioSrc)),
    '地標的細節種子由落點推,MUST NOT 再抽一枚 rnd()(會把後面所有佈局的亂數序列推移,§2.3)');
}

// ============ Ⅴ 設定頁:一份實作、兩個掛載點、樣品走真品 ============
console.log('\nⅤ 設定頁與樣品');
{
  ok(count(mainSrc, /function renderVisualSettings\(/g) === 1, 'renderVisualSettings 只有一份實作');
  ok(count(mainSrc, /renderVisualSettings\(/g) === 3, '兩個掛載點(戰場暫停頁 + 大廳設定頁)');
  ok(/pauseVisualMount/.test(htmlSrc) && /lobbyVisualMount/.test(htmlSrc), 'index.html 兩處掛載點都在');
  // 拉桿清單 MUST 由 VISUAL_KNOBS 推導 —— 在 main.js 再寫一次清單,兩份遲早分家
  ok(/Object\.entries\(VISUAL_KNOBS\)/.test(mainSrc), '拉桿逐項由 VISUAL_KNOBS 推導');
  ok(!Object.values(VISUAL_KNOBS).some((d) => mainSrc.includes(`'${d.label}'`)),
    'main.js 沒有把標籤文字抄第二份');
  // 樣品是一顆真的 WebGL context:每一條關閉路徑都要收
  ok(count(mainSrc, /disposeVisualSettings\(\)/g) >= 6, `樣品的回收點齊全(${count(mainSrc, /disposeVisualSettings\(\)/g)} 處)`);
  ok(count(mainSrc, /_matSample = null/g) >= 2 && /_matSample\?\.dispose\(\)/.test(mainSrc),
    'dispose 之後把參照清掉(否則第二次開啟會 dispose 一個已死的 context)');
  // 樣品 MUST 走真品材質與真品管線,MUST NOT 自己畫一套「看起來差不多」的色
  ok(/from '\.\/toon\.js'/.test(sampSrc) && /toonMat/.test(sampSrc) && /envMat/.test(sampSrc),
    '樣品用真品材質(toonMat / envMat)');
  ok(/from '\.\/postfx\.js'/.test(sampSrc) && /new Pipeline\(/.test(sampSrc),
    '樣品跑真品後製管線(否則勾線那根拉桿什麼都看不到)');
  ok(!/getContext\('2d'\)/.test(sampSrc), '樣品不是 2D 畫的(第二套明暗規則 = 調好了進戰場不是那樣)');
  // ---- 鍵光:暗面 MUST 真的在畫面上(2026-08-04 使用者回報的另一半原因)----
  // 偏色只作用在 ramp 的暗階;舊制 (0.4, 0.8, 0.4) 幾乎與視線同向 ⇒ 逐像素量測的暗階佔比
  // 是 地面 0% / 岩塊 0% / 機甲臂 0% / 機甲球 1%,拉桿控制的那一階在畫面上等於不存在。
  {
    const m = /const SUN_DIR = new THREE\.Vector3\(([-\d., ]+)\)\.normalize\(\)/.exec(bare(sampSrc));
    ok(!!m, '樣品的鍵光方向是具名常數 SUN_DIR');
    const v = (m?.[1] || '').split(',').map(Number);
    const L = v.length === 3 ? Math.hypot(...v) : 0;
    // 相機在 +Z 看向原點 ⇒ 光的 z 分量為負 = 從物件後方側打過來,明暗交界才進得了畫面。
    ok(L > 0 && v[2] < 0, `鍵光來自側後方(z = ${v[2]})—— 從相機肩膀上打過去就沒有暗面`);
    // y MUST < 0.5:再高的話地面法線 (0,1,0) 會跳進四階 ramp 的頂階,而頂階的偏色權重恆為 0
    // ⇒ 畫面裡最大的那一片(地面約佔 47%)當場退出這根拉桿的作用範圍。
    ok(L > 0 && v[1] / L < 0.5,
      `鍵光仰角夠低(正規化 y = ${(v[1] / L).toFixed(3)} < 0.5)—— 再高地面就整片壓進不偏色的頂階`);
    ok(!/\.set\(0\.4, 0\.8, 0\.4\)/.test(bare(sampSrc)), '舊的過肩光向沒有殘留');
    // 同一個常數 MUST 同時餵「場景那盞燈」與「uCelLightDir」:分家 = ramp 的明暗界在一邊、
    // 硬邊高光與 CEL_COOL 的暗面在另一邊。
    ok(/sun\.position\.copy\(SUN_DIR\)/.test(bare(sampSrc)) && /updateCelLight\(this\.camera, SUN_DIR\)/.test(bare(sampSrc)),
      '燈與 uCelLightDir 同吃 SUN_DIR(MUST NOT 一邊自己的燈、一邊借戰場的光向)');
    ok(count(bare(sampSrc), /SUN_DIR/g) === 3, 'SUN_DIR 恰一處定義兩處消費');
  }
  // 覆寫是樣品專屬:戰場與角色預覽 MUST 仍吃本場太陽(`setCelSun`),MUST NOT 跟著傳方向
  ok(/export function updateCelLight\(camera, dirWorld = null\)/.test(toonSrc)
    && /copy\(dirWorld \|\| _sunDirWorld\)/.test(bare(toonSrc)),
    'updateCelLight 的光向覆寫是選用參數(省略 = 本場太陽)');
  ok(/updateCelLight\(this\.camera\);/.test(bare(readSrc('public', 'js', 'game.js')))
    && /updateCelLight\(this\.camera\);/.test(bare(readSrc('public', 'js', 'charPreview.js'))),
    '戰場 / 角色預覽不傳覆寫(樣品 MUST NOT 把 _sunDirWorld 寫掉)');
  ok(count(bare(sampSrc), /setCelSun/g) === 0, '樣品不呼叫 setCelSun(那是本場太陽的唯一寫入點)');
  ok(/renderer\?\.dispose\(\)/.test(sampSrc) && /pipeline\?\.dispose\(\)/.test(sampSrc)
    && /m\.dispose\(\)/.test(sampSrc) && /g\.dispose\(\)/.test(sampSrc),
    '樣品 dispose 收 renderer / 管線 / 材質 / 幾何(A25)');
  ok(/this\._off\?\.\(\)/.test(sampSrc), '樣品解訂閱拉桿(否則已 dispose 的 context 被回呼抓著)');
  // 勾線強度:夾制在著色器裡,且管線退場要解訂閱
  ok(/uInk/.test(postSrc) && /clamp\( ink \* uInk, 0\.0, 1\.0 \)/.test(postSrc), '勾線強度夾在 [0,1]');
  ok(/this\._offPrefs\?\.\(\)/.test(postSrc), '管線 dispose 解訂閱拉桿');
  // 說明與版型
  ok(/visual: \{/.test(helpSrc) && /data-tipkey="visual"/.test(htmlSrc), '設定區塊有 ⓘ 懸浮說明(常駐說明已下架的規矩)');
  ok(/\.vset-sample \{/.test(cssSrc) && /max-width: 100%/.test(cssSrc.slice(cssSrc.indexOf('.vset-sample'))),
    '樣品畫布夾 max-width(直式手機不得把設定頁撐出橫向捲軸,A20 家族)');
}

// ============ Ⅵ 景深模糊:距離推導、交戰距離恆清晰、0% 真的不跑 ============
// 這一項與本檔其餘三項的差別:它是**唯一會增加繪圖成本**的效果(多一個全螢幕 pass),
// 而且它動到的是「玩家看不看得清楚敵人」—— 起糊點一旦滑進交戰距離,就不再是表現層改動
// 而是玩法改動(原則 4),而畫面上只表現成「這場好像比較難瞄」,沒有任何錯誤訊息。
console.log('\nⅥ 景深模糊(data.js DOF + postfx 的 pass)');
{
  const gameSrc = readSrc('public', 'js', 'game.js');
  const bp = bare(postSrc), bd = bare(dataSrc), bs = bare(sampSrc), bg = bare(gameSrc);

  // ---- Ⅵ-a 兩個轉折點是推導的,不是寫死的 ----
  // 定義式裡不得出現任何公尺數字面值:那兩個點 = 交戰距離上界 × 係數。手寫 456 的話,
  // 之後任何一次射程 / 砲塔 / 招式的調整都不會跟著走,而且不會有任何錯誤訊息。
  const defs = /export const dofNearM = ([^\n]*)\n[\s\S]*?export const dofFarM = ([^\n]*)/.exec(bd);
  ok(!!defs, 'dofNearM / dofFarM 都是具名匯出');
  ok(!!defs && !/\d{2,}/.test(defs[1] + defs[2]), '兩個轉折點的定義式內沒有公尺數字面值(推導不手寫)');
  ok(near(dofNearM() / combatReachM(), DOF.NEAR_F) && near(dofFarM() / combatReachM(), DOF.FAR_F),
    `兩個轉折點 = 交戰距離上界 ${combatReachM().toFixed(0)}m × 各自係數`);
  ok(dofFarM() > dofNearM(), '全糊距離嚴格大於起糊距離');
  // 全糊那一圈 = 使用者原本要「不顯示」的那一圈:日後真做距離剔除時,消失的邊界才會落在
  // 全糊帶裡(憑空消失的那一下被模糊蓋住)。兩者 MUST 是同一組係數。
  ok(near(DOF.NEAR_F, 1.5) && near(DOF.FAR_F, 2.0), '兩圈係數 = 使用者 2026-08-09 提的 1.5× / 2×');

  // ---- Ⅵ-b **核心不變式**:打得到的東西恆為全清晰 ----
  // 這一條就是「這是表現層改動而不是玩法改動」的全部依據(原則 4)。
  // 上界在此**獨立重算**,MUST NOT 呼叫 `combatReachM` 去驗它自己。
  {
    const wF = altRangeMax() * RANGE_TOL;
    let towerR = UNITS.tower?.range || 0, wMax = 0, aMax = 0;
    for (const ch of Object.keys(CHARACTERS)) {
      for (let lv = 1; lv <= 4; lv++) {
        for (const s of ['light', 'heavy']) wMax = Math.max(wMax, heroWeapon(ch, s, lv, true)?.range || 0);
        for (const s of ['skill', 'ult']) aMax = Math.max(aMax, heroAbility(ch, s, lv, true)?.range || 0);
      }
    }
    const reach = Math.max(towerR, wMax * wF, aMax, hyperMaxArcM());
    ok(near(reach, combatReachM(), 1e-6),
      `交戰上界獨立重算對得上(塔 ${towerR} / 武器 ${(wMax * wF).toFixed(0)} / 招式 ${aMax.toFixed(0)}`
      + ` / 載具航程 ${hyperMaxArcM().toFixed(0)} → ${reach.toFixed(0)}m)`);
    ok(dofNearM() > reach,
      `起糊距離 ${dofNearM().toFixed(0)}m > 全場最遠交戰距離 ${reach.toFixed(0)}m(交戰距離內恆為全清晰)`);
    ok(dofNearM() / reach >= 1.4,
      `而且留有餘裕(${(dofNearM() / reach).toFixed(2)}× ≥ 1.4)—— 貼著界跑的話射程一調就侵入交戰距離`);
    // 錨 MUST NOT 退回「狙擊模式可視範圍」:COMBAT_SCALE 把 sight 砍半而地圖沒砍 ⇒ 現役的
    // 狙擊可視(192~216m)比交戰上界還近,照那個錨取 1.5× 會讓起糊點落進交戰距離裡面。
    const aimSight = Math.max(...Object.keys(HERO_SIZE).filter((k) => UNITS[k]?.sight)
      .map((k) => UNITS[k].sight * GAME.AIM_SIGHT_MULT));
    ok(aimSight < reach,
      `反例存證:最遠狙擊可視 ${aimSight.toFixed(0)}m < 交戰上界 ${reach.toFixed(0)}m`
      + ' ⇒ 錨在可視範圍會侵入交戰距離(這就是換錨的理由)');
    ok(!/aimSightM/.test(bd), '舊的 aimSightM 錨沒有殘留');
    // 起糊點 MUST 仍在最小地圖的視線範圍內,否則這個效果在 L1 等於不存在
    const sideMin = (MAPGEO.REAL_SIDE_BASE_KM + MAPGEO.REAL_SIDE_PER_LANE_KM) * 1000 / MAPGEO.REAL_SCALE;
    ok(dofFarM() < sideMin * Math.SQRT2,
      `全糊距離 ${dofFarM().toFixed(0)}m < 最小地圖對角 ${(sideMin * Math.SQRT2).toFixed(0)}m(L1 也看得到這個效果)`);
  }

  // ---- Ⅵ-c 單一縫:公尺數只有 data.js 一份 ----
  ok(!/\d+\.?\d*\s*\/\*\s*m\s*\*\//.test(bp) && !/uDofNear\.value = \d/.test(bp),
    'postfx.js 不手寫任何公尺數(距離一律由 setDof 餵入)');
  ok(count(bp, /setDof\s*\(/g) === 1, 'setDof 在 postfx.js 恰一份實作');
  ok(count(bg, /setDof\(/g) === 1 && /setDof\(dofNearM\(\), dofFarM\(\)\)/.test(bg),
    'game.js 恰一處餵距離,而且是直接轉呼 data.js(不自己算)');
  ok(!/DOF\./.test(bg) && !/combatReachM/.test(bg),
    'game.js 沒有第二份景深算式(射程一調,起糊距離 MUST 自己跟著走)');
  ok(count(bs, /setDof\(/g) === 1 && /DOF_NEAR, DOF_FAR/.test(bs),
    '樣品餵自己那一組尺度(規則同一份、尺度兩軌)');
  // 定場鏡頭組是「改動前後各拍一次」的工具:沒餵距離 ⇒ `_dofRange` 恆為 null ⇒ 這一 pass
  // 永遠不掛,而每一張圖與每一行讀數都照樣正常 = 它從此拍不到交付版本真正的樣子。
  {
    const shotSrc = bare(readSrc('tools', 'shot_scene.mjs'));
    ok(/pipe\?\.setDof\(dofNearM\(\), dofFarM\(\)\)/.test(shotSrc), '定場鏡頭組也餵距離(否則永遠拍不到景深)');
    ok(/dof: flag\('dof'\)/.test(shotSrc), '定場鏡頭組有 --dof=0 圖層隔離(與 ink/grade/fxaa 同一組)');
  }

  // ---- Ⅵ-c2 只在狙擊模式(2026-08-09 使用者補充)----
  // 強度 MUST 由**當下的 fov** 反解而不是判 `aiming` 布林:右鍵拉近本來就有一條緩動,
  // 布林是硬切、自己再跑一條淡入是第二條時間曲線(模糊比鏡頭慢半拍,而且不會報錯)。
  {
    const b = UNITS.robot.fov, z = UNITS.robot.zoomFov;
    ok(dofAimBlend(b, b, z) === 0 && dofAimBlend(z, b, z) === 1, '一般視角 0 / 完全進鏡 1(兩端是定義)');
    ok(near(dofAimBlend((b + z) / 2, b, z), 0.5), '中途線性 —— 與 fov 緩動同一條曲線');
    let mono = true;
    for (let i = 1; i <= 40; i++) {
      const f0 = b - (b - z) * (i - 1) / 40, f1 = b - (b - z) * i / 40;
      if (dofAimBlend(f1, b, z) < dofAimBlend(f0, b, z)) mono = false;
    }
    ok(mono, '拉近過程單調不回頭');
    ok(dofAimBlend(b + 20, b, z) === 0 && dofAimBlend(z - 20, b, z) === 1, '帶外夾制(觀戰滾輪縮放不會溢出)');
    ok(dofAimBlend(50, 68, 68) === 0 && dofAimBlend(50, 68, undefined) === 0,
      'zoomFov 未設 / 與 baseFov 相同 ⇒ 恆 0(原則 6:偏差朝「看得清楚」)');
    // 現役三機種都真的有進鏡帶(A8:全機種 fov 68 / zoomFov 35)
    ok(Object.keys(HERO_SIZE).every((k) => dofAimBlend(UNITS[k].zoomFov, UNITS[k].fov, UNITS[k].zoomFov) === 1),
      '現役每一種機體都進得了鏡(zoomFov < fov)');
    // 單一呼叫點,而且 MUST 涵蓋陣亡 / 觀戰(留著上一幀的值 = 死了畫面還糊著)
    ok(count(bg, /setDofBlend\(/g) === 1, 'game.js:setDofBlend 恰一個呼叫點');
    ok(/this\.side && !this\.dead[\s\S]{0,140}: 0\)/.test(bg), '陣亡 / 觀戰恆 0(觀戰的滾輪縮放不得被誤讀成進鏡)');
    ok(!/aiming \? .{0,40}dof/i.test(bg) && !/setDofBlend\(this\.aiming/.test(bg),
      'MUST NOT 判 aiming 布林(硬切)—— 由 fov 反解才與拉近動畫同一條曲線');
    // pass 端:0 ⇒ 整個退出鏈;uDofA 只有一個寫入點(拉桿與進鏡各寫一次 = 後寫的蓋掉前一個)
    ok(/this\._dofA \* this\._dofBlend > 0/.test(bp), '不在狙擊模式時整個 pass 退出鏈(一般視角不付這一 pass 的錢)');
    ok(count(bp, /uniforms\.uDofA\.value =/g) === 1 && /_pushDofA\(\)/.test(bp), 'uDofA 恰一個寫入點');
    ok(/this\._dofBlend = 1;/.test(bp) && !/setDofBlend/.test(bs),
      '預設 1 ⇒ 樣品與定場鏡頭組不必知道有「瞄準」這回事(預設 0 的話它們會靜靜地什麼都不糊)');
  }

  // ---- Ⅵ-d 順序:MUST 排在勾線之後 ----
  // 先糊後勾 = 勾線讀的深度仍然銳利 ⇒ 在糊掉的色塊上畫出清楚的黑線。
  {
    const chain = /const chain = \[\][\s\S]*?chain\.push\('fxaa'\)/.exec(bp)?.[0] || '';
    const iInk = chain.indexOf(`push('ink')`), iDof = chain.indexOf(`push('dof')`);
    const iGrade = chain.indexOf(`push('grade')`);
    ok(iInk >= 0 && iDof > iInk, '景深排在勾線之後(否則糊掉的物件有銳利輪廓)');
    ok(iGrade > iDof, '景深排在調色之前');
  }

  // ---- Ⅵ-e 0% MUST 是「不跑」而不是「跑一個乘 0 的 pass」----
  ok(/this\.enabled\.dof && this\._dofRange && this\._dofA \* this\._dofBlend > 0/.test(bp),
    '四個關法任一成立即整個 pass 退出鏈(?dof=0 / 沒餵距離 / 拉桿 0% / 不在狙擊模式)');
  ok(/dof: !off\('dof'\)/.test(bg), 'game.js 有 ?dof=0 的圖層隔離旗標(與 ink/grade/fxaa 同一組)');
  ok(/this\._dofRange = null/.test(bp) && /if \(!\(near >= 0\) \|\| !\(far > near\)\)/.test(bp),
    '非法距離退回「不掛這一 pass」(原則 6:預設不生效,MUST NOT 猜一個距離)');
  ok(VISUAL_KNOBS.dof.min === 0 && VISUAL_KNOBS.dof.def === 1,
    '拉桿可以拉到 0(= 這一層完全不跑),預設 1 = 交付定案值');

  // ---- Ⅵ-f 前景不得被抹進遠景 / 取樣點填滿圓盤 ----
  ok(/step\( coc \* 0\.5, smoothstep\( uDofNear, uDofFar, lin\( vUv \+ o \) \) \)/.test(bp),
    '鄰居取樣過焦外閘(近處清晰物件 MUST NOT 被抹進遠景 = 剪影外一圈光暈)');
  ok(/if \( rp < 0\.5 \) \{ gl_FragColor = base; return; \}/.test(bp),
    '焦內像素早退(這一 pass 的平均成本 = 一次深度 + 一次顏色取樣)');
  ok(/Math\.sqrt\(\(i \+ 0\.5\) \/ n\)/.test(bp) && /2\.39996/.test(bp),
    '取樣點是黃金角螺旋且半徑開根號(面積均勻;單一圓環會糊成甜甜圈邊)');
  ok(/_dofA = DOF\.MAX_R \* visualPref\('dof'\)/.test(bp) && /uDofA \/ uTexel\.y/.test(bp),
    '最大半徑是螢幕高度的比例(與解析度和 RES_GOV 降階無關),不是寫死的像素');
  ok(count(bp, /new FullScreenQuad\(/g) === 4
    && /\[this\.inkQuad, this\.dofQuad, this\.gradeQuad, this\.fxaaQuad\]/.test(bp),
    'A25:四個全螢幕材質都在 dispose 的名冊裡');

  // ---- Ⅵ-g 樣品的景深帶 MUST 夾住樣品場景 ----
  // 沿用戰場那一組(576~864m)的話,24m 深的樣品每一個像素都在焦內 = 拉桿拉了看不出差異
  // ——陰影偏色與風化密度各踩過一次的同一個坑。
  {
    const nm = /const DOF_NEAR = ([\d.]+), DOF_FAR = ([\d.]+)/.exec(bs);
    const bz = /const BG_Z = (-?[\d.]+)/.exec(bs);
    ok(!!nm && !!bz, '樣品的景深帶與背景排位置都是具名常數');
    const [dn, df] = [Number(nm?.[1]), Number(nm?.[2])];
    const camZ = 9.2, camY = 2.1;
    ok(df > dn && dn > 0, `樣品景深帶合法(${dn} → ${df}m)`);
    // 前景三件(z ≈ 0~1.4)MUST 全部在 NEAR 之內;背景排 MUST 在 FAR 之外
    const dist = (x, y, z) => Math.hypot(x, y - camY, z - camZ);
    ok(dist(2.2, 1.1, 1.3) < dn && dist(-2.3, 1.0, 1.4) < dn,
      `前景全部落在焦內(最近 ${dist(-2.3, 1.0, 1.4).toFixed(1)}m < ${dn}m ⇒ 恆為全清晰`);
    const bgD = dist(0, 1.3, Number(bz?.[1]));
    ok(bgD >= df * 0.94, `背景排吃滿模糊(${bgD.toFixed(1)}m ≈ ${df}m 的全糊帶)`);
    ok(dist(0, 0, -12) > df, '地面遠端也在全糊帶裡(24m 那片地的後緣)');
    ok(/const bgGeo = new THREE\.BoxGeometry/.test(bs) && /this\._geos = \[[^\]]*bgGeo\]/.test(bs),
      '背景排共用一份幾何且進了 _geos(A25)');
  }
}

console.log(`\n${fail === 0 ? '✅' : '❌'} 通過 ${pass} 項,失敗 ${fail} 項`);
process.exit(fail === 0 ? 0 : 1);
