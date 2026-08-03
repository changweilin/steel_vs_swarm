// ============ 畫面表現旋鈕 / 陰影偏色 / 風化場 / 零件抖動 稽核(離線)============
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

  const z = shadowTintRGB(0);
  ok(z[0] === 1 && z[1] === 1 && z[2] === 1, '強度 0 = 純白乘數 ⇒ **逐位元**同舊制(不是「差不多」)');
  // 亮度中性是 A14 的保命條:暗階 ≥ 102 的規定不可以被「乘一個暗色」繞過去
  let worst = 0, minC = 1;
  for (let a = 0; a <= 1.0001; a += 0.02) {
    const t = shadowTintRGB(a);
    worst = Math.max(worst, Math.abs(luma(t) - 1));
    minC = Math.min(minC, Math.min(...t));
  }
  ok(worst < 1e-9, `全值域亮度恆為 1(最大偏差 ${worst.toExponential(1)})—— A14 的暗階亮度逐位元不動`);
  ok(minC > 0.85, `最暗通道 ${minC.toFixed(3)} 仍遠離 0(色相在走,亮度沒掉)`);
  const mid = shadowTintRGB(0.5), full = shadowTintRGB(1);
  ok(mid[2] > mid[0] && full[2] > mid[2] && full[0] < mid[0], '偏色方向恆為藍綠,且強度單調');
  ok(shadowTintRGB(5)[0] === full[0] && shadowTintRGB(-3)[0] === 1, '強度自身夾在 [0,1]');

  // 單一縫:GLSL 的乘數與樣品畫面同吃這一支,MUST NOT 有第二份色表
  ok(count(toonSrc, /SHADOW_HUE\s*=/g) === 1, '偏色色相表只有一份');
  ok(count(toonSrc, /export function shadowTintRGB/g) === 1, 'shadowTintRGB 只有一份實作');
  // 接在 ramp 查表上,不是接在最終顏色上(接在最終顏色 = 只認得到那一條手寫的 dot)
  ok(count(toonSrc, /const RAMP_HOOK = /g) === 1 && toonSrc.includes('texture2D( gradientMap, coord ).r'),
    'ramp 查表的替換錨點是具名常數(升級 three MUST 重新核對這一行)');
  // 最容易靜默失效的一條:`onBeforeCompile` 收到的是**還沒展開 include** 的原始碼
  ok(/THREE\.ShaderChunk\?\.lights_toon_pars_fragment/.test(toonSrc)
    && /replace\(RAMP_INC, RAMP_PATCHED\)/.test(bare(toonSrc)),
    '從 ShaderChunk 取原文後換掉 **#include 指令**(在展開後的字串上找 = 永遠找不到、永遠走落地路徑)');
  ok(count(toonSrc, /#include <lights_toon_pars_fragment>/g) === 1
    && count(bare(toonSrc), /shader\.fragmentShader\.includes\(RAMP_HOOK\)/g) === 0,
    '沒有殘留「在 fragmentShader 上直接找 RAMP_HOOK」的舊寫法');
  ok(/uCelRampTint/.test(toonSrc) && /mix\( uCelRampTint, vec3\( 1\.0 \), celG \)/.test(toonSrc),
    '偏色權重 = ramp 階值(暗階偏得多、亮階不偏)');
  ok(/uCelRampFb/.test(toonSrc) && /canPatch \? 0 : 1/.test(bare(toonSrc))
    && /if \( uCelRampFb > 0\.5 \)/.test(toonSrc),
    '替換失敗有等效落地路徑(原則 6;否則 three 一升級就是「拉桿沒反應」)');
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

console.log(`\n${fail === 0 ? '✅' : '❌'} 通過 ${pass} 項,失敗 ${fail} 項`);
process.exit(fail === 0 ? 0 : 1);
