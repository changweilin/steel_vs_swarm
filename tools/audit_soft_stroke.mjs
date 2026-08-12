// ============ 軟性物質稽核(細勾線 + 隨風飄揚)============
// 2026-08-04 使用者定案兩條:
//   ①「不同類型物件有不同線條輪廓的粗細,例如雲朵、芒草、草原、花園、樹葉、旗幟這些
//      軟性的物質的線條會細得多,其他堅硬的物體則依據設定的數值」
//   ②「這些軟性物質加入隨風飄揚之類的重複性變化」
//
// 這一整批是**純表現層**(㋒):`npm run bal` 與 e2e 天然不會動,而回歸的特性一律是
// 「沒有錯誤訊息,只是看起來不對」—— 五種靜默失效各對應本檔的一段:
//   Ⅰ 參數表塌掉(軟性倍率被調回 1 = 這個功能整個消失,而畫面只是「線好像有點粗」)
//   Ⅱ alpha 契約斷掉(材質端寫了、勾線 pass 沒讀 / 讀了卻乘錯位置 = 只變淡不變細)
//   Ⅲ 擺動的錨點錯掉(逐零件各自從 0 起算 ⇒ 樹冠繞自己的中心剪切,疊接縫開開合合)
//   Ⅳ 消費端漏標(那一叢草不會飄,而旁邊同款的會)
//   Ⅴ 風的時鐘/雲的環繞算術(JS 的 % 對負數回負值 ⇒ 半邊的雲每一圈跳到另一側)
//
// GLSL 在 Node 端執行不了 ⇒ 擺動那半只能以**執行原文的文字不變式**釘住(同 audit_visual_prefs
// 對 `RAMP_HOOK` 的做法);能執行的部分(參數表、分類、span 推導、時鐘夾制、雲的環繞算術)
// 一律**跑真品原文**,MUST NOT 在本檔抄第二份公式。
//
// 跑法:node tools/audit_soft_stroke.mjs
// 反向驗證:--break-ink(軟性倍率當成 1)/ --break-anchor(擺動錨點拿掉)
//           兩者 MUST 分別讓 Ⅰ / Ⅲ 紅字,否則等於沒驗到(原則 9)。
import { readSrc } from './audit_src.mjs';

const BREAK_INK = process.argv.includes('--break-ink');
const BREAK_ANCHOR = process.argv.includes('--break-anchor');

const toon = readSrc('public', 'js', 'toon.js');
const post = readSrc('public', 'js', 'postfx.js');
const biomes = readSrc('public', 'js', 'biomes.js');
const site = readSrc('public', 'js', 'siteplan.js');
const envSrc = readSrc('public', 'js', 'environment.js');
const game = readSrc('public', 'js', 'game.js');

let pass = 0, fail = 0;
const ok = (c, msg) => { c ? (pass++, console.log(`  ✓ ${msg}`)) : (fail++, console.error(`  ✗ ${msg}`)); };
/** 只留「真的會執行的程式碼」—— 註解裡提到某個名字不算違規 */
const code = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1');
const count = (s, re) => [...s.matchAll(re)].length;
/** 抽一段原文(以 ^anchor 起、大括號配對止) */
function block(src, anchor) {
  const i = src.indexOf(anchor);
  if (i < 0) throw new Error(`找不到 ${anchor}`);
  let d = 0, started = false, j = i;
  for (; j < src.length; j++) {
    if (src[j] === '{') { d++; started = true; }
    else if (src[j] === '}') { d--; if (started && d === 0) { j++; break; } }
  }
  return src.slice(i, j);
}

console.log('== 軟性物質稽核(細勾線 + 隨風飄揚)==\n');

// ---------------------------------------------------------------- Ⅰ
console.log('Ⅰ 分類與參數(toon.js 單一縫)');
const SOFT_KINDS = new Function(`${block(toon, 'export const SOFT_KINDS = ').replace('export ', '')}\nreturn SOFT_KINDS;`)();
const WIND = new Function(`${block(toon, 'export const WIND = ').replace('export ', '')}\nreturn WIND;`)();
let INK_SOFT_A = Number(/const INK_SOFT_A = ([\d.]+);/.exec(toon)[1]);
if (BREAK_INK) INK_SOFT_A = 1;
{
  ok(INK_SOFT_A > 0 && INK_SOFT_A <= 0.6,
    `軟性勾線倍率「細得多」:0 < ${INK_SOFT_A} ≤ 0.6(= 至少要 1.7 倍的曲率才畫得出線)`);
  ok(INK_SOFT_A < 1, `軟性倍率 < 1 —— 等於 1 就是這個功能整個沒有作用(實測 ${INK_SOFT_A})`);
  // 倍率**只准有一份**:postfx 手抄一次的話,改 toon.js 這裡不會反映到畫面上
  ok(count(code(toon), /INK_SOFT_A/g) === 2, '倍率恰一處定義 + 一處消費(uSoftInk)');
  ok(!new RegExp(`\\b${INK_SOFT_A}\\b`).test(code(post).replace(/EDGE0|EDGE1/g, '')),
    'postfx.js 沒有手抄那個倍率(它只讀 alpha,MUST NOT 認得「軟性有多軟」)');
  const kinds = Object.entries(SOFT_KINDS);
  ok(kinds.length >= 4, `軟性分類齊全(${kinds.map(([k]) => k).join('/')})`);
  for (const [k, v] of kinds) {
    ok(v.amp >= 0 && v.amp < 0.5 && v.freq >= 0 && ['x', 'y'].includes(v.axis),
      `${k}:amp ${v.amp}(擺幅 ÷ span,有界)、freq ${v.freq}、axis ${v.axis}`);
  }
  ok(SOFT_KINDS.turf.amp === 0,
    'turf(草坪/內場草皮)擺幅 = 0 —— 0.5m 厚的鋪面擺起來只會跟步道錯開一條縫');
  ok(SOFT_KINDS.grass.amp > SOFT_KINDS.leaf.amp,
    `草比樹葉擺得開(相對擺幅 ${SOFT_KINDS.grass.amp} > ${SOFT_KINDS.leaf.amp})`);
  ok(SOFT_KINDS.cloth.freq > SOFT_KINDS.grass.freq && SOFT_KINDS.grass.freq > SOFT_KINDS.leaf.freq,
    `頻率隨質量遞減:旗 ${SOFT_KINDS.cloth.freq} > 草 ${SOFT_KINDS.grass.freq} > 樹冠 ${SOFT_KINDS.leaf.freq}(反過來像水草不像風)`);
  ok(SOFT_KINDS.cloth.axis === 'x' && SOFT_KINDS.leaf.axis === 'y',
    '旗幟沿旗面橫軸(由桿到旗尾)、植被沿縱軸(由根到梢)');
  // 風只有一份:另寫一個風向 = 雲往東飄、草往西倒
  ok(count(code(toon), /DIR_DEG:/g) === 1, '風向恰一處定義(WIND.DIR_DEG)');
  for (const [name, src] of [['biomes.js', biomes], ['siteplan.js', site]]) {
    ok(!/DIR_DEG|windDir|WIND_DEG/.test(code(src)), `${name} 沒有自己的風向(全場一份)`);
  }
  // 比對的是**具名匯入**不是整行原文:同一支 import 之後還會加別的東西(2026-08-12 加了
  // 勾線資訊緩衝的 INK_INFO_*),寫死整行等於「以後有人多 import 一個名字就紅字」,
  // 而這一條要釘的是「風向與時鐘來自 toon.js 那一份」。
  const envToonImp = /import \{([^}]*)\} from '\.\/toon\.js'/.exec(envSrc)?.[1] || '';
  ok(['setCelSun', 'WIND', 'celWindTime'].every((n) => new RegExp(`\\b${n}\\b`).test(envToonImp)),
    'environment.js 的雲吃 toon.js 那一份 WIND 與同一支時鐘');
  ok(WIND.WAVE_M > 5 && WIND.BEAT > 1 && WIND.CLOUD_MPS > 0,
    `風的形狀參數合理(波長 ${WIND.WAVE_M}m、諧波比 ${WIND.BEAT}、雲速 ${WIND.CLOUD_MPS}m/s)`);
  ok(Math.abs(WIND.BEAT - Math.round(WIND.BEAT)) > 0.05,
    `第二諧波與基頻不可通約(${WIND.BEAT};整數倍 = 兩波鎖相 = 看得出重複點)`);
}

// ---------------------------------------------------------------- Ⅱ
console.log('\nⅡ alpha 契約(場景 RT 的 alpha ≡ 這一格的勾線門檻倍率)');
{
  const T = code(toon), P = code(post);
  ok(count(T, /gl_FragColor\.a = uSoftInk;/g) === 1, '材質端恰一處寫入(gl_FragColor.a = uSoftInk)');
  // 排在 opaque_fragment **之後**:那一段的 `#ifdef OPAQUE diffuseColor.a = 1.0` 會蓋掉先寫的值
  const iOpaque = T.lastIndexOf('#include <opaque_fragment>');
  ok(iOpaque >= 0 && T.indexOf('gl_FragColor.a = uSoftInk;') > iOpaque,
    '寫入排在 #include <opaque_fragment> 之後(排前面會被 OPAQUE 的 a = 1.0 蓋掉)');
  ok(/uSoftInk = \{ value: sk \? INK_SOFT_A : 1 \}/.test(T),
    '未標軟性的材質恆寫 1 ⇒ 其餘每一個像素逐位元同舊制');
  ok(/#ifdef CEL_SOFT[\s\S]{0,200}uniform float uSoftInk;/.test(T),
    'uSoftInk 的宣告收在 CEL_SOFT 之下(沒標軟性的程式碼一行都不多)');
  // 勾線 pass:讀 alpha、且 MUST 乘進 smoothstep 的**輸入**。
  // 範圍限在 `_inkMaterial()`(FXAA 也在同一支檔裡對 tColor 做四鄰取樣,混在一起會假綠)
  const INKM = code(block(post, '  _inkMaterial() {'));
  ok(/texture2D\( tColor, vUv [-+] vec2\([^)]*\) \)\.a/.test(INKM), '勾線 pass 讀鄰格的 alpha');
  ok(/float soft = min\(/.test(INKM) && count(INKM, /texture2D\( tColor, vUv [-+] vec2/g) === 4,
    '軟性倍率取「這一格 + 四鄰」的最小值(只看中心 ⇒ 落在背景側的那半條線仍是硬性粗細)');
  // 門檻是模板插值(`${INK.EDGE0.toFixed(3)}`)⇒ 釘的是**那個常數的名字**,不是它今天的值:
  // 比對字面數字的話,調校 EDGE0 就會讓這條假紅字。
  ok(/smoothstep\( \$\{INK\.EDGE0[^}]*\}, \$\{INK\.EDGE1[^}]*\}, ae \* soft \)/.test(INKM),
    '倍率乘在 smoothstep 的**輸入**上 = 線帶真的變窄;乘在 ink 之後只會變淡不變細');
  ok(!/ink \*= soft|ink = ink \* soft/.test(INKM), '倍率 MUST NOT 另外再乘一次(會變成平方計價)');
  ok(/if \( ae <= \$\{INK\.EDGE0[^}]*\} \) \{ gl_FragColor = base; return; \}/.test(INKM),
    '早退門檻 = **EDGE0 本身**:soft ≤ 1 ⇒ 硬性跨不過的一定也跨不過 ⇒ 四個 alpha 取樣只花在要畫線的像素上');
  ok(INKM.indexOf('if ( ae <= ') < INKM.indexOf('float soft = min('),
    '早退排在 alpha 取樣之前(反過來 = 全畫面每一格都多四次取樣)');
  ok(/soft = clamp\( soft, 0\.0, 1\.0 \)/.test(P),
    'alpha 夾在 [0,1](半透明件混合後只會被推向 1 = 硬性 = 舊行為,原則 6)');
  // 後面兩 pass 一律不吃 alpha(它們輸出 1.0)—— 契約只活在場景 RT 那一段
  ok(/gl_FragColor = vec4\( c, 1\.0 \);/.test(P) && /toSRGB\( m \), 1\.0/.test(P),
    '調色 / FXAA 輸出 alpha = 1(契約只存在於場景 RT → 勾線 pass 這一段)');
}

// ---------------------------------------------------------------- Ⅲ
console.log('\nⅢ 擺動的不變式(toon.js 頂點原文)');
{
  let V = code(toon);
  if (BREAK_ANCHOR) V = V.replace(/uSoftBase \+ transformed\.y \* uSoftSy/, 'transformed.y');
  const sway = /#ifdef CEL_SWAY\n([\s\S]*?)#endif\n\s*#include <project_vertex>/.exec(V);
  ok(!!sway, '擺動區塊排在 #include <project_vertex> **之前**(那一段吃 transformed 算 gl_Position)');
  const S = sway ? sway[1] : '';
  ok(/uSoftBase \+ transformed\.y \* uSoftSy/.test(S),
    '縱向權重錨在「整株座標」(uSoftBase + 頂點高 × uSoftSy)—— 逐零件從 0 起算 = 樹冠繞自己的中心剪切,疊接縫開開合合');
  ok(/uSoftBase \+ transformed\.x/.test(S), '橫向(旗幟)權重錨在旗桿側');
  ok(/clamp\(([\s\S]*?), 0\.0, 1\.0 \)/.test(S) && /sw \*= sw;/.test(S),
    '權重夾在 [0,1] 且取二次(一次的話整株看起來像被平移)');
  ok(/swO = instanceMatrix \* swO/.test(S) && /dot\( swO\.xz, uWindK \)/.test(S),
    '空間相位取**實例原點**(逐頂點取 = 同一片葉子的兩端各走各的 = 幾何被拉扯變形)');
  ok(!/dot\( transformed\.xz, uWindK \)/.test(S), '相位 MUST NOT 逐頂點取');
  ok(/vec3\( uWindDir\.x, 0\.0, uWindDir\.y \) \* swM/.test(S),
    '世界風向轉進零件局部座標(實例的 ry 是亂數 ⇒ 直接拿世界向量會變成每株各吹各的)');
  ok(/sin\( uWindT \* uSoftFreq \+ swP \)/.test(S) && count(S, /sin\(/g) === 2,
    '兩個不可通約的正弦相加 = 週期性(使用者要的「重複性變化」)但看不出重複點');
  ok(/transformed\.y -= /.test(S), '擺出去時梢端略降(少了這一項會看起來像整株在平移)');
  ok(count(code(toon), /defines\.CEL_SWAY = ''/g) === 1 && /sk\.amp > 0/.test(code(toon)),
    '擺動與細勾線分兩個 define(草坪要前者不要後者)');
  ok(/\$\{soft \? `Q\$\{soft\.k\}` : ''\}/.test(toon),
    '軟性進 customProgramCacheKey —— 不進的話 three 會共用舊程式 = 那批材質整批沒有擺動也沒有細線');
}

// ---------------------------------------------------------------- Ⅳ
console.log('\nⅣ 消費端覆蓋(使用者點名的六種軟性物質)');
{
  // 真品 VEG_DEFS + 真品 vegSoftKind / vegSpan(幾何以「與 three 同值」的樁餵入)
  const stub = {
    cyl: (r1, r2, h) => ({ boundingBox: { max: { y: h / 2 } } }),
    cone: (r, h) => ({ boundingBox: { max: { y: h / 2 } } }),
    ico: (r) => ({ boundingBox: { max: { y: r } } }),
  };
  const VEG_DEFS = new Function('cyl', 'cone', 'ico',
    `${/^const VEG_DEFS = \{[\s\S]*?^\};/m.exec(biomes)[0]}\nreturn VEG_DEFS;`)(stub.cyl, stub.cone, stub.ico);
  const kindFn = new Function(
    `${/^const SOFT_BY_VEG_KEY = .*\n^const vegSoftKind = .*/m.exec(biomes)[0]}\nreturn vegSoftKind;`)();
  const spanFn = new Function(`${/^function vegSpan\(def\) \{[\s\S]*?^\}/m.exec(biomes)[0]}\nreturn vegSpan;`)();

  // ① 樹葉:每一款喬木都要有軟性樹冠
  const trees = ['bamboo', 'broadleaf', 'birch', 'conifer', 'conifer2', 'conifer3', 'conifer4', 'shrub', 'mangrove', 'sapling'];
  const noLeaf = trees.filter((t) => !VEG_DEFS[t].parts.some((p) => kindFn(p) === 'leaf'));
  ok(noLeaf.length === 0, `每一款喬木/灌木都有軟性樹冠${noLeaf.length ? `;漏標:${noLeaf.join(',')}` : ''}`);
  // ② 芒草:使用者點名 —— 芒花穗有固定色沒有 key,漏了它就是「草會飄、穗不會」
  for (const t of ['silvergrass', 'reed', 'arrowbamboo']) {
    const all = VEG_DEFS[t].parts.every((p) => kindFn(p) === 'grass');
    ok(all, `${t}(芒草族)**每一個**零件都是軟性 grass`);
  }
  // ③ 硬的東西 MUST NOT 被掃進來
  const hardOk = VEG_DEFS.deadtree.parts.every((p) => !kindFn(p))
    && VEG_DEFS.borderrock.parts.every((p) => !kindFn(p))
    && VEG_DEFS.redcap.parts.every((p) => !kindFn(p))
    && VEG_DEFS.broadleaf.parts.filter((p) => p.c && !p.key).every((p) => !kindFn(p));
  ok(hardOk, '枯木 / 邊界巨岩 / 香菇 / 樹幹枝條一律**不是**軟性(它們照吃勾線強度那根拉桿)');
  // ④ span 推導:改零件表擺幅自己跟著走
  for (const t of ['broadleaf', 'silvergrass']) {
    const s0 = spanFn(VEG_DEFS[t]);
    const taller = { parts: VEG_DEFS[t].parts.map((p) => ({ ...p, y: (p.y || 0) + 3 })) };
    ok(s0 > 0 && Math.abs(spanFn(taller) - (s0 + 3)) < 1e-9,
      `${t} 的 span 由零件表推導(${s0.toFixed(2)}m;整株加高 3m ⇒ span 跟著 +3)`);
  }
  ok(spanFn({ parts: [] }) >= 0.5, '空零件表不回 0(擺幅的分母 MUST NOT 為零)');
  // ⑤ 分類的單一縫:季節換色與軟性讀同一欄
  ok(count(code(biomes), /SOFT_BY_VEG_KEY/g) === 2
    && count(code(biomes), /const vegSoftKind = /g) === 1
    && count(code(biomes), /vegSoftKind\(/g) === 1,
    '分類恰一處定義一處消費;`sf` 是逐零件覆寫,MUST NOT 另開一張名單');
  ok(count(code(biomes), /const mat = toonMat\(seasonColor/g) === 1,
    '程序生成植被的材質恰一處建立(軟性旗標跟著它走)');

  // ⑥ GLB 植被:葉片判定只有一條(季節色偏與軟性同吃)
  const glb = block(biomes, 'function extractNatureParts(');
  ok(count(code(glb), /leaves\|grass\|flower\|bush/g) === 1,
    'GLB 植被的葉片 regex 只有一條(兩條 = 「會變色卻不會飄」)');
  ok(/soft: \{ k: 'leaf', span: 1 \}/.test(code(glb)) && /rim: 0/.test(code(glb)),
    'GLB 葉片掛軟性且 rim: 0(幾何已正規化成高度 1 ⇒ span 恆 1;不加邊緣光 = 這條路徑外觀不變)');

  // ⑦ 旗幟
  ok(count(code(biomes), /^function flag\(/gm) === 1, '旗面建構恰一份實作');
  ok(count(code(biomes), /g\.add\(flag\(/g) === 2, '場上兩處旗幟都改走 flag()(校旗 + 主樓旗)');
  ok(/soft: \{ k: 'cloth', span: w, base: w \/ 2 \}/.test(code(biomes)),
    '旗面權重錨在 −x 半寬處 = 旗桿側(桿邊不動、旗尾飄最開)');

  // ⑧ 花園 / 草原(公設鋪面)
  const CIVIC_PARTS = new Function('_row',
    `${block(site, 'export const CIVIC_PARTS = ').replace('export ', '')}\nreturn CIVIC_PARTS;`)(
    (n, f) => Array.from({ length: n }, (_, i) => f(i)));
  const soft = Object.entries(CIVIC_PARTS).flatMap(([k, ps]) => ps.filter((p) => p.sf).map((p) => `${k}:${p.sf}`));
  ok(soft.some((s) => s === 'park:turf') && soft.some((s) => s === 'park:grass'),
    '公園:草坪(turf,只細線)+ 花圃(grass,會擺動)都標到了');
  ok(soft.filter((s) => s.startsWith('pitch:')).length >= 2, '運動場的內場草皮標到了(含中圈內那一片)');
  const allSf = Object.values(CIVIC_PARTS).flat().filter((p) => p.sf);
  ok(allSf.every((p) => SOFT_KINDS[p.sf]), `公設的 sf 全部認得(${[...new Set(allSf.map((p) => p.sf))].join('/')})`);
  ok(allSf.every((p) => !p.col), '軟性鋪面一律沒有碰撞柱(siteplan 紀律④:公設是開放空間)');
  // 2026-08-05:色欄改吃 seed 變異後的 `pc`(vc 通道),sf 那一段不變
  ok(/const key = `\$\{pc\}\|\$\{p\.e \? 1 : 0\}\|\$\{p\.sf \|\| ''\}`/.test(code(site)),
    '軟性旗標進分桶鍵(混桶 = 同色的鋪面與草坪共用一份材質)');
  ok(/geo\.computeBoundingBox\(\);/.test(code(site)) && /bk\.top = Math\.max/.test(code(site)),
    '公設的擺動 span 由幾何**實算**(手寫高度 = 改尺寸就擺不到滿幅)');
}

// ---------------------------------------------------------------- Ⅴ
console.log('\nⅤ 風的時鐘與雲(執行原文)');
{
  const wt = { value: 0 };
  const step = new Function('_windT',
    `${block(toon, 'export function stepCelWind(').replace('export ', '')}\nreturn stepCelWind;`)(wt);
  step(0.016); step(0.016);
  ok(Math.abs(wt.value - 0.032) < 1e-9, '時鐘逐幀累加');
  step(9);
  ok(Math.abs(wt.value - 0.282) < 1e-9,
    '單幀 dt 夾在 0.25(分頁切回來那一幀 dt 是好幾秒,不夾的話整片林子會抽一下)');
  step(-5); step(NaN); step(undefined);
  ok(Math.abs(wt.value - 0.282) < 1e-9, '負值 / NaN / undefined 一律不推進(時鐘不得倒退)');
  ok(!/%/.test(code(block(toon, 'export function stepCelWind('))),
    '時鐘刻意不取模:各 kind 的頻率不可通約,取模會在週期邊界跳一下');
  ok(count(code(game), /stepCelWind\(dt\)/g) === 1
    && code(game).indexOf('stepCelWind(dt)') < code(game).indexOf('this.envFx?.update(dt'),
    'game.js 每幀推一次,且排在 envFx.update 之前(雲讀的是同一支時鐘,晚一步就跟草差一幀)');
  ok(count(code(envSrc), /celWindTime\(\)/g) === 1,
    '雲不自己數 dt(自己數的話暫停一次就與地面錯開)');

  // 雲的環繞算術:JS 的 % 對負數回負值 —— 直接取模會讓半邊的雲每一圈跳到另一側
  const line = /const a = \(\(d\.along \+ WIND\.CLOUD_MPS \* t \+ WRAP \* 0\.5\) % WRAP \+ WRAP\) % WRAP - WRAP \* 0\.5;/.exec(code(envSrc));
  ok(!!line, '雲的環繞取模先加半個 WRAP 再減(且對負數補一次 + WRAP)');
  const wrapAt = new Function('d', 't', 'WIND', 'WRAP', `${line[0]}\nreturn a;`);
  const WRAP = 1000, V = { CLOUD_MPS: 2 };
  let inRange = true, maxJump = 0, prev = null;
  for (let t = 0; t <= WRAP / V.CLOUD_MPS; t += 1) {
    const a = wrapAt({ along: -480 }, t, V, WRAP);
    if (a < -WRAP / 2 - 1e-9 || a > WRAP / 2 + 1e-9) inRange = false;
    if (prev !== null) maxJump = Math.max(maxJump, Math.min(Math.abs(a - prev), WRAP - Math.abs(a - prev)));
    prev = a;
  }
  ok(inRange, '起點在負半邊的雲,整個週期都留在 [−WRAP/2, WRAP/2] 內(負數取模的坑)');
  ok(Math.abs(maxJump - V.CLOUD_MPS) < 1e-9, `逐步位移恆 = 雲速 × dt(無跳點;實測 ${maxJump}）`);
  const period = WRAP / V.CLOUD_MPS;
  ok(Math.abs(wrapAt({ along: 120 }, 0, V, WRAP) - wrapAt({ along: 120 }, period, V, WRAP)) < 1e-9,
    `一個週期後逐位元回到起點(= 使用者要的「重複性變化」;實測週期 ${period}s)`);
}

console.log(`\n${fail === 0 ? '✅' : '❌'} 通過 ${pass} 項,失敗 ${fail} 項`);
if (BREAK_INK || BREAK_ANCHOR) {
  console.log(`（反向驗證模式:${BREAK_INK ? '--break-ink ' : ''}${BREAK_ANCHOR ? '--break-anchor' : ''} —— 上面 MUST 有紅字）`);
  process.exit(fail === 0 ? 1 : 0);
}
process.exit(fail === 0 ? 0 : 1);
