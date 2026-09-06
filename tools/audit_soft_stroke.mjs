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
// 2026-08-13 使用者又定案兩條(同一個縫的延伸):
//   ③「建立海浪 / 稻浪 / 草波 / 芒草波的動畫」
//   ④「遊戲中加入國旗物件(國家比例為 地圖:駐軍國:敵對國 = 30:60:10),建立國旗飄揚的動畫」
// 對應本檔新增的四段靜默失效:
//   Ⅵ 海浪抄錯規則(相位取實例原點 ⇒ 整片海一起上下 = 潮汐;法線沒跟著改 ⇒ 頂點真的起伏了
//     而賽璐璐的階梯完全不知道,水面仍是一整片死平的藍)
//   Ⅶ 陣風包絡塌掉(GUST_F 回 0 = 整片等幅擺動 = 「波」這件事整個消失,而畫面只是「有在動」)
//   Ⅷ ground.js 的細節漏標(稻/草/芒草在 2026-08-04 那一輪整批沒標到:同一張圖上
//     biomes.js 那半的芒草會飄、散在稻田河灘的這一半是硬的)
//   Ⅸ 國旗的比例/名冊/決定性(名冊手寫 ⇒ 換陣營之後靜默過期;旗面合併成一個 mesh ⇒
//     擺動權重吃合併後的 x = 整批繞旗陣中心擺)
//
// GLSL 在 Node 端執行不了 ⇒ 擺動那半只能以**執行原文的文字不變式**釘住(同 audit_visual_prefs
// 對 `RAMP_HOOK` 的做法);能執行的部分(參數表、分類、span 推導、時鐘夾制、雲的環繞算術、
// 淡出權重、挑國比例、旗面型錄)一律**跑真品原文**,MUST NOT 在本檔抄第二份公式。
// 旗面型錄畫得出來這件事驗得到,正是因為 `flags.js` 零 THREE 零 DOM:把一個錄音樁當
// 2D context 交進去就行(這是那條邊界唯一的、也是全部的回報)。
//
// 跑法:node tools/audit_soft_stroke.mjs
// 反向驗證:--break-ink(軟性倍率當成 1)/ --break-anchor(擺動錨點拿掉)
//           --break-wave(海浪相位改取實例原點)/ --break-gust(陣風包絡拿掉)
//           --break-cloth(旗面速率退回全員同步)/ --break-treephase(逐株相位退回逐零件原點)。
//           六者 MUST 各自讓對應欄紅字,否則等於沒驗到(原則 9)。
import { readSrc } from './audit_src.mjs';
// 載具型錄唯一縫(零 import ⇒ Node 端直接載得動真品;⑧ 段的 CIVIC_PARTS 沙箱要注入)
import { makeVehicle, makeRecess } from '../public/js/vehicles.js';
import { CHARACTERS } from '../public/js/data.js';
import { LORE } from '../public/js/lore.js';
import { VENUES } from '../public/js/venues.js';
import * as flagsMod from '../public/js/flags.js';

const BREAK_INK = process.argv.includes('--break-ink');
const BREAK_ANCHOR = process.argv.includes('--break-anchor');
const BREAK_WAVE = process.argv.includes('--break-wave');
const BREAK_GUST = process.argv.includes('--break-gust');
/** 反向驗證:玩家位移擾動的位移加項整段拿掉 ⇒ Ⅹ MUST 紅字 */
const BREAK_CHAR = process.argv.includes('--break-char');
/** 反向驗證:擾動半徑換成常數(= 走路與跑步撥開的範圍一樣大)⇒ Ⅹ MUST 紅字 */
const BREAK_CHARR = process.argv.includes('--break-charR');
/** 反向驗證:空槽不再顯式歸零(留上一幀的值)⇒ Ⅹ 的行為直測 MUST 紅字 */
const BREAK_CHARSLOT = process.argv.includes('--break-charslot');
/** 反向驗證:泡沫的深度取樣換成常數(= 不再由水深驅動)⇒ Ⅹ MUST 紅字 */
const BREAK_FOAM = process.argv.includes('--break-foam');
/** 反向驗證:泡沫帶退回寬三角波 ⇒ Ⅹ MUST 紅字 */
const BREAK_FOAM_SHAPE = process.argv.includes('--break-foam-shape');
/** 反向驗證:alpha 寫入點退回 `= uSoftInk;`(斷筆因子沒有乘進去)⇒ Ⅱ + Ⅺ MUST 紅字 */
const BREAK_INKBREAK = process.argv.includes('--break-inkbreak');
/** 反向驗證:斷筆錨點帶回平移欄(mat3 → mat4)⇒ Ⅺ MUST 紅字 */
const BREAK_INKANCHOR = process.argv.includes('--break-inkanchor');
/** 反向驗證:深度門檻再疊一項法線式上限(= ①-4 的「兩者擇一」被違反)⇒ Ⅺ MUST 紅字 */
const BREAK_GRAZE = process.argv.includes('--break-graze');
/** 反向驗證:旗面速率不再逐件變化 ⇒ Ⅲ 布料波形 MUST 紅字 */
const BREAK_CLOTH = process.argv.includes('--break-cloth');
/** 反向驗證:逐株樹基相位退回逐零件原點(= 同一株各擺各的舊制)⇒ Ⅲ + Ⅶ MUST 紅字 */
const BREAK_TREEPHASE = process.argv.includes('--break-treephase');

let toon = readSrc('public', 'js', 'toon.js');
let post = readSrc('public', 'js', 'postfx.js');
/**
 * 反向驗證的字面替換(§5.4 ㋑):CRLF 容忍樣式 + **替換無效當場失敗**。
 * 含 `\n` 的字面替換在這個工作區是無聲 no-op,而那時 break 永遠是綠的。
 */
function bend(src, re, to, flag) {
  const out = src.replace(re, to);
  if (out === src) { console.error(`✗ ${flag}:樣式沒咬到,反向驗證等於沒跑`); process.exit(1); }
  return out;
}
// 這兩支 MUST 在**讀原文之後、任何一段用它之前**套用:Ⅱ(契約)與 Ⅺ(斷筆)讀的是同一份。
// ⚠ 樣式一律 `/g`:字面替換若先咬到**註解**裡的同一串字,`code()` 剝掉註解之後斷言照樣
//   全綠 = 反向驗證等於沒跑(2026-08-16 當場踩過;toon.js 那一段註解也已改成不逐字複述)。
if (BREAK_INKBREAK) {
  toon = bend(toon, /gl_FragColor\.a = uSoftInk \* celInkBreak\(\);/g,
    'gl_FragColor.a = uSoftInk;', '--break-inkbreak');
}
if (BREAK_INKANCHOR) {
  toon = bend(toon, /vCelInkP = mat3\( modelMatrix \) \* ibP\.xyz;/g,
    'vCelInkP = ( modelMatrix * ibP ).xyz;', '--break-inkanchor');
}
if (BREAK_GRAZE) {
  // 壞版 = 「兩者疊上去」:深度門檻的分母追加一項法線式上限(計畫 ①-4 明寫 MUST NOT 疊)
  post = bend(post, /float e = lap \/ max\( 0\.001, d \* \$\{INK\.K_D\.toFixed\(3\)\} \+ slope \* \$\{INK\.K_S\.toFixed\(1\)\} \);/,
    'float e = lap / max( 0.001, d * ${INK.K_D.toFixed(3)} + slope * ${INK.K_S.toFixed(1)} + ( 1.0 - nz ) );',
    '--break-graze');
}
if (BREAK_CLOTH) {
  toon = bend(toon, /swRate \*= mix\( 0\.88, 1\.12, swPiece \);/g,
    'swRate *= 1.0;', '--break-cloth');
}
if (BREAK_TREEPHASE) {
  // 壞版 = 逐株相位退回逐零件原點:巨木枝冠 ±10m 偏移 = 2.5rad 相位差 = 風裡分解。
  // `swTXZ` 只活在擺動區塊(註解不逐字複述它 ⇒ /g 不會先咬到註解)。
  toon = bend(toon, /swTXZ/g, 'swO.xz', '--break-treephase');
}
const biomes = readSrc('public', 'js', 'biomes.js');
const site = readSrc('public', 'js', 'siteplan.js');
const envSrc = readSrc('public', 'js', 'environment.js');
const game = readSrc('public', 'js', 'game.js');
const terr = readSrc('public', 'js', 'terrain.js');
const ground = readSrc('public', 'js', 'ground.js');
const flagsSrc = readSrc('public', 'js', 'flags.js');
const venuesSrc = readSrc('public', 'js', 'venues.js');
const MIX = flagsMod.FLAG_MIX;

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
/**
 * `applyCelPatch` 那一段原文的**起點**。
 * ⚠ 兩條「排在 `#include <opaque_fragment>` 之後」的斷言原本用**全檔** `lastIndexOf` 取錨,
 * 而 2026-08-16(§0-b 學派)起 `toonPlain` 在檔案更後面也有一次
 * `.replace('#include <opaque_fragment>', …)` ⇒ 全檔 lastIndexOf 會指到那一次,
 * 兩條的比較從此恆為假(紅在完全錯的理由上)。錨因此 MUST 收在 applyCelPatch 之內。
 */
const celPatchAt = (T) => {
  const i = T.indexOf('function applyCelPatch(');
  const j = T.indexOf('export function applyPaint(');
  if (i < 0 || j <= i) throw new Error('找不到 applyCelPatch 區塊');
  return { i, src: T.slice(i, j) };
};
/** applyCelPatch 之內最後一次 `#include <opaque_fragment>` 在**全檔**的位置 */
function opaqueAnchor(T) {
  const { i, src } = celPatchAt(T);
  const k = src.lastIndexOf('#include <opaque_fragment>');
  return k < 0 ? -1 : i + k;
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
    // axis 'w'(表面波,2026-08-13 海浪)是第三種:位移垂直、相位逐頂點。
    // amp 在那一族的語意是**波陡**而不是「擺幅 ÷ 株高」,但界一樣(> 0.5 的波陡是碎浪不是海面)。
    ok(v.amp >= 0 && v.amp < 0.5 && v.freq >= 0 && ['x', 'y', 'w'].includes(v.axis),
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
  // 釘的是「有沒有第二份**定義**」而不是「有沒有出現過這個名字」:2026-08-13 起 biomes.js
  // 的主堡旗陣要把旗面轉向下風,那是**讀** toon.js 那一份(`WIND.DIR_DEG`)—— 正是這條
  // 規則要的結果。寫成「不准出現」的話,唯一正確的用法反而紅字。
  for (const [name, src] of [['biomes.js', biomes], ['siteplan.js', site]]) {
    const C = code(src);
    ok(!/DIR_DEG:|windDir|WIND_DEG/.test(C) && !/(?<!WIND\.)\bDIR_DEG\b/.test(C),
      `${name} 沒有自己的風向,要用只准讀 WIND.DIR_DEG(全場一份)`);
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
  // 2026-08-16(序 4 ①-2):同一條通道自此帶**兩個因子的乘積**(軟性 × 斷筆)。
  // **這三條的語意一格未動** —— ①恰一處寫入 ②非軟性件恆寫 1 ③只給不透明件;
  // 改的只是「寫入長什麼樣」與「宣告收在哪一道閘之下」。改斷言是最容易把真回歸洗成綠燈
  // 的動作 ⇒ `--break-ink` / `--break-anchor` 兩支既有反向驗證 MUST 仍各自紅字(對照組),
  // 而新的 `--break-inkbreak` 咬的正是「斷筆因子有沒有真的乘進同一個寫入點」。
  ok(count(T, /gl_FragColor\.a = uSoftInk \* celInkBreak\(\);/g) === 1,
    '材質端**恰一處**寫入(gl_FragColor.a = uSoftInk * celInkBreak())—— 兩個因子分兩處寫就是兩份契約');
  // 排在 opaque_fragment **之後**:那一段的 `#ifdef OPAQUE diffuseColor.a = 1.0` 會蓋掉先寫的值
  const iOpaque = opaqueAnchor(T);
  ok(iOpaque >= 0 && T.indexOf('gl_FragColor.a = uSoftInk * celInkBreak();') > iOpaque,
    '寫入排在 #include <opaque_fragment> 之後(排前面會被 OPAQUE 的 a = 1.0 蓋掉)');
  // 2026-08-13:`sk` → `inkable`(= 有 sk **且不透明**)。半透明件的 alpha 是**不透明度**,
  // 寫進勾線倍率就是把水面從 0.82 直接改成 0.30 —— 契約本來就只對不透明件成立。
  ok(/uSoftInk = \{ value: inkable \? INK_SOFT_A : 1 \}/.test(T),
    '未標軟性(或半透明)的材質恆寫 1 ⇒ 其餘每一個像素逐位元同舊制');
  ok(/const inkable = !!sk && !mat\.transparent;/.test(T)
    && /if \(inkable\) defines\.CEL_SOFT = '';/.test(T),
    '細勾線那一半只給不透明件(半透明件的 alpha 是不透明度,不是勾線通道)');
  // CEL_INKA(寫入那一道閘)是 CEL_SOFT 的**超集**,而且 MUST 吃同一句 `!mat.transparent`:
  // 兩道閘的條件一旦分家,就會出現「這份材質寫得了斷筆卻寫不了軟性」這種半套狀態。
  ok(/const inkAlpha = !mat\.transparent;/.test(T)
    && /if \(inkAlpha\) \{ defines\.CEL_INKA = ''; defines\.CEL_INKB = ''; \}/.test(T),
    '斷筆的閘 === `!mat.transparent`(與 inkable 同一條理由,只少了 `!!sk` ⇒ 硬性件也吃得到)');
  ok(/#ifdef CEL_INKA[\s\S]{0,200}uniform float uSoftInk;/.test(T),
    'uSoftInk 的宣告收在 CEL_INKA 之下(= 寫入的同一道閘;沒開的程式碼一行都不多)');
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
  ok(/swO = instanceMatrix \* swO/.test(S),
    '實例原點仍算出來餵玩家位移擾動的距離(擺動相位已改吃同一株的樹基,不再吃它)');
  // 逐株相位(2026-09-06 樹枝分解案):各零件的實例原點含自己的 px/pz 偏移,
  // 巨木冠偏移 ±10m × 波長 26m = 相位差 2.5rad ⇒ 同一株的幹/枝/冠各擺各的。
  // 相位 MUST 取同株樹基(aTreeO);逐零件原點就是分解本身。
  ok(/attribute vec2 aTreeO;/.test(V),
    '逐株相位屬性 aTreeO(同一株樹的樹基世界 XZ,幹/枝/冠共用)');
  ok(/vec2 swTXZ = aTreeO;/.test(S) && /dot\( swTXZ, uWindK \)/.test(S),
    '擺動相位取同一株的樹基(逐零件原點 = 巨木枝冠差 2rad 以上、接合處在風裡分解)');
  ok(!/dot\( transformed\.xz, uWindK \)/.test(S), '相位 MUST NOT 逐頂點取');
  ok(/vec3 swDrow = vec3\( uWindDir\.x, 0\.0, uWindDir\.y \) \* swM/.test(S),
    '世界風向轉進零件局部座標(實例的 ry 是亂數 ⇒ 直接拿世界向量會變成每株各吹各的)');
  ok(/swLx \* swLx/.test(S) && /swLy \* swLy/.test(S)
    && /vec3 swUrow = vec3\( 0\.0, 1\.0, 0\.0 \) \* swM/.test(S),
    '精確逆映射(逐分量除 Lx²/Ly²):轉置在冠盤這類非等比縮放下把傾角污染放大,下沉偏離世界垂直 30°');
  ok(/sin\( uWindT \* swRate \+ swPhase \)/.test(S) && count(S, /sin\(/g) === 2,
    '兩個不可通約的正弦相加 = 週期性(使用者要的「重複性變化」)但看不出重複點');
  ok(/#ifdef CEL_SWAY_H[\s\S]*?swPiece = fract[\s\S]*?swRate \*= mix\( 0\.88, 1\.12, swPiece \);[\s\S]*?swPhase \+= swPiece \* 6\.2831853;[\s\S]*?#endif/.test(S),
    '旗面 rate / phase 逐件由已定案落點雜湊,零共享 rnd(全員同速 = 機械連桿)');
  ok(/swBeat = 3\.3;[\s\S]*?swSlowW = 0\.75;[\s\S]*?swFastW = 0\.25;[\s\S]*?swFastPhase = swPhase;/.test(S),
    '布料波形 = 75% 慢抬起 + 25% 的 3.3× 快顫,兩層共用逐件相位');
  ok(/transformed -= swU \* \([\s\S]*?\/ swLy \)/.test(S),
    '擺出去時梢端略降(世界 +Y 走精確逆映射,下沉量再除以 Ly;直接寫 transformed.y 會把斜枝的下沉打到水平方向、不除會讓壓扁冠的下沉只剩 1/3,枝與幹/冠的接合點錯開)');
  ok(count(code(toon), /defines\.CEL_SWAY = ''/g) === 1 && /sk\.amp > 0/.test(code(toon)),
    '擺動與細勾線分兩個 define(草坪要前者不要後者)');
  // 鑰匙 MUST 同時帶 kind 與**細勾線開關**:同一個 soft.k 在不透明件開、在半透明件關,
  // 只帶 kind 的話兩者共用同一支已編譯的程式(水面會拿到寫死 alpha 的那一版)。
  ok(/\$\{soft \? `Q\$\{soft\.k\}\$\{inkable \? 'I' : ''\}` : ''\}/.test(toon),
    '軟性(kind + 細勾線開關)進 customProgramCacheKey —— 不進的話 three 會共用舊程式');
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
  // ⑥-2 逐株相位(2026-09-06 樹枝分解案):有擺動的列一律改吃樹基,判定沿用 soft 結果不另開名單
  ok(/if \(mo\.soft\) mo\.treeO = true;/.test(code(biomes)),
    '有擺動的植被列一律掛 treeO(判定沿用 soft,不另開「哪些列要同相」名單)');
  ok(/treeArr\[i \* 2\] = it\.x;/.test(code(biomes)) && /q\.setAttribute\('aTreeO', treeAttr\)/.test(code(biomes)),
    'aTreeO 由實例落點(it.x/it.z)推導 = 樹基本體(讀零件原點就是分解本身)');

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
  // 停車場的九台車與收費亭的窗口凹處走 `vehicles.js` 的載具型錄唯一縫(該檔零 import ⇒
  // Node 端直接載得動真品),而停車格 `LOT_STALL` 與色票 `LOT_PAINT` 是 siteplan 自己的
  // 模組級常數 ⇒ **一併抽原文**。漏了任何一格,整支稽核會在 `const CIVIC_PARTS = {…}`
  // 那一行 ReferenceError,而錯誤訊息與軟性物質完全無關。
  const CIVIC_PARTS = new Function('_row', 'makeVehicle', 'makeRecess',
    `${block(site, 'export const LOT_STALL = ').replace('export ', '')}
     ${/^const LOT_PAINT = .*$/m.exec(site)[0]}
     ${block(site, 'export const CIVIC_PARTS = ').replace('export ', '')}\nreturn CIVIC_PARTS;`)(
    (n, f) => Array.from({ length: n }, (_, i) => f(i)), makeVehicle, makeRecess);
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
  const line = /const a = \(\(d\.along \+ WIND\.CLOUD_MPS \* (?:windAmp \* )?t \+ WRAP \* 0\.5\) % WRAP \+ WRAP\) % WRAP - WRAP \* 0\.5;/.exec(code(envSrc));
  ok(!!line, '雲的環繞取模先加半個 WRAP 再減(且對負數補一次 + WRAP)');
  const wrapAt = new Function('d', 't', 'WIND', 'WRAP', 'windAmp = 1', `${line[0]}\nreturn a;`);
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

// ---------------------------------------------------------------- Ⅵ
// 2026-08-13 使用者「建立海浪 / 稻浪 / 草波 / 芒草波的動畫」。
// 海浪與上面四種軟性是**兩種不同的東西**,而它們共用同一組 uniform ⇒ 最容易的壞法是
// 把其中一條規則抄到另一邊(相位取實例原點 = 整片海一起上下 = 潮汐不是浪)。
console.log('\nⅥ 海浪(表面波;toon.js + terrain.js 原文)');
{
  let T = code(toon);
  if (BREAK_WAVE) T = T.replace(/vec2 seaXZ = \( modelMatrix \* vec4\( transformed, 1\.0 \) \)\.xz;/,
    'vec2 seaXZ = ( modelMatrix * vec4( 0.0, 0.0, 0.0, 1.0 ) ).xz;');
  if (BREAK_WAVE && !/vec4\( 0\.0, 0\.0, 0\.0, 1\.0 \) \)\.xz/.test(T)) {
    console.error('  ✗ --break-wave 的字面替換沒有生效(原文改過了?)'); fail++;
  }
  ok(SOFT_KINDS.sea && SOFT_KINDS.sea.axis === 'w', '海面是獨立的 kind 且 axis = w(表面波)');
  ok(WIND.SEA_M > 0 && WIND.SEA_SEG >= 2,
    `海浪波長 ${WIND.SEA_M}m、取樣率 ${WIND.SEA_SEG} 段/波長(< 2 就低於 Nyquist)`);
  // 第二諧波的空間頻率是 1.6× ⇒ 真正要取樣的是那一支
  ok(WIND.SEA_SEG / 1.6 >= 2,
    `合成後最短波(${(WIND.SEA_M / 1.6).toFixed(1)}m)仍有 ${(WIND.SEA_SEG / 1.6).toFixed(1)} 段 ≥ 2`);
  // 分段數與波長 MUST 是同一個推導,消費端不得手寫
  const seg = new Function(`${block(toon, 'export const seaSegM = ').replace('export ', '')}\nconst WIND=${JSON.stringify(WIND)};\nreturn seaSegM;`)();
  ok(Math.abs(seg() - WIND.SEA_M / WIND.SEA_SEG) < 1e-9, `seaSegM() 由波長推導(${seg()}m)`);
  ok(count(code(terr), /seaSegM\(\)/g) === 1 && !/SEA_M/.test(code(terr)),
    'terrain.js 只經 seaSegM() 取邊長,MUST NOT 自己讀波長再算一次');
  // ---- 相位:逐頂點 ----
  // 錨在位移那一段的**第一行程式碼**(而不是 `#ifdef CEL_WAVE` 或註解):
  //   ・`#ifdef CEL_WAVE` 在本檔出現三次(前置宣告 / 法線 / 位移),非貪婪從第一個抓
  //     會一路跨過擺動區塊,把那邊的 instanceMatrix 也算進來 = 假紅字;
  //   ・註解當錨在這裡行不通 —— `code()` 就是專門把註解剝掉的那一支。
  const iSea = T.search(/vec2 seaXZ = /);
  const W = iSea >= 0 && /^([\s\S]*?)#endif\n\s*#include <project_vertex>/.exec(T.slice(iSea));
  ok(!!W, '海浪位移排在 #include <project_vertex> 之前');
  const S = W ? W[1] : '';
  ok(/modelMatrix \* vec4\( transformed, 1\.0 \)/.test(S),
    '相位取**逐頂點**的世界 XZ —— 取實例原點的話整片海一起上下,那是潮汐不是浪');
  ok(!/instanceMatrix/.test(S), '海浪不吃 instanceMatrix(整片海是一個 mesh,不是散佈的實例)');
  ok(/seaUp/.test(S) && /vec3\( 0\.0, 1\.0, 0\.0 \) \* mat3\( modelMatrix \)/.test(S),
    '位移方向是「世界 +Y 轉進局部」而不是 transformed.y(水盤自己繞 X 轉了 −90°)');
  ok(/celSeaH\( seaXZ \) \* seaFade/.test(S), '浪高乘上逐頂點淡出權重 seaFade');
  // ---- 法線 MUST 與位移同源、且排在 three 算 vNormal 之前 ----
  ok(/#include <beginnormal_vertex>[\s\S]{0,900}?objectNormal = normalize\(/.test(T),
    '法線在 beginnormal_vertex 改(three 的 normal_vertex 排在 begin_vertex 之前,晚一步就整片死平)');
  ok(T.indexOf('objectNormal = normalize( normalize( seaNw )') >= 0
    && T.indexOf('objectNormal = normalize( normalize( seaNw )') < iSea,
    '法線那一段排在位移那一段之前(= three 的原生順序,不是我們自己排的)');
  // 2026-08-16:呼叫點由 6 變 8 —— 水面倒影塊(CEL_REFL)與岸邊泡沫(celFoam)各多一處,
  // 而它們**正是 MUST 吃同一支**的兩個新消費端(自己再寫一次相位 = 泡沫的沖刷與浪峰差
  // 半個波長、倒影塊與水面各起各的伏)。**「恰一份實作」那一條才是不變式**;呼叫點數只是
  // 「有沒有人偷偷抄第二份」的哨兵,新增消費端時 MUST 連同理由一起改。
  ok(count(T, /float celSeaH\( vec2/g) === 1 && count(T, /celSeaH\(/g) === 8,
    '浪高恰一份實作(定義 1 + 中央差分 4 + 水面位移 1 + 倒影塊 1 + 泡沫相位 1);兩份公式 = 光影的浪與幾何的浪差半個波長');
  // ---- 淡出:兩張水面共用材質,粗網格那一張 MUST 顯式歸零 ----
  ok(/wgeo\.setAttribute\('seaFade', new THREE\.BufferAttribute\(new Float32Array\(wp\.length \/ 3\), 1\)\)/.test(code(terr)),
    '外環水面顯式補 seaFade = 0(靠「缺屬性讀成 0」是未宣告的預設值,沒有斷言守得住)');
  const fadeFn = new Function('smooth01', 'edgeWallInsetM',
    `${/^function seaFadeOf\(geo, w, h\) \{[\s\S]*?^\}/m.exec(code(terr))[0]}\nreturn seaFadeOf;`)(
    (t) => { t = t < 0 ? 0 : t > 1 ? 1 : t; return t * t * (3 - 2 * t); }, () => 40);
  const stub = (pts) => ({ attributes: { position: { count: pts.length, getX: (i) => pts[i][0], getY: (i) => pts[i][1] } } });
  const W2 = 1200, H2 = 1200;
  const f = fadeFn(stub([[0, 0], [W2 / 2, 0], [0, H2 / 2], [W2 / 2 - 40, 0], [W2 / 2 - 200, 0]]), W2, H2);
  ok(f[0] === 1, '圖心滿幅');
  ok(f[1] === 0 && f[2] === 0, '圖界(x 與 z 兩軸各驗一次)歸零');
  ok(f[3] === 1, '障礙環內緣(edgeWallInsetM)恰好回到滿幅 ⇒ 玩家走得到的範圍恆是滿幅');
  ok(f[4] === 1, '再往內仍是滿幅(單調不回頭)');
}

// ---------------------------------------------------------------- Ⅶ
console.log('\nⅦ 陣風包絡(「波」的本錢在振幅也要跟著跑)');
{
  let T = code(toon);
  if (BREAK_GUST) T = T.replace(/swOsc \*= celGust\( swTXZ \);\n/, '');
  if (BREAK_GUST && /swOsc \*= celGust\( swTXZ \);/.test(T)) {
    console.error('  ✗ --break-gust 的字面替換沒有生效(原文改過了?)'); fail++;
  }
  ok(WIND.GUST_M > WIND.WAVE_M * 3,
    `陣風波長 ${WIND.GUST_M}m ≫ 擺動波長 ${WIND.WAVE_M}m(同量級 = 兩層互相拍頻成雜訊)`);
  ok(WIND.GUST_F > 0 && WIND.GUST_F < 1,
    `包絡深度 ${WIND.GUST_F} ∈ (0,1):= 0 是改制前的等幅擺動,≥ 1 會讓振幅翻負(相位跳半圈)`);
  ok(WIND.GUST_S > 0 && Math.abs(WIND.GUST_S / SOFT_KINDS.grass.freq - Math.round(WIND.GUST_S / SOFT_KINDS.grass.freq)) > 0.05,
    `包絡頻率 ${WIND.GUST_S} 與草的基頻不可通約(整數比 = 鎖相 = 看得出重複點)`);
  ok(count(T, /float celGust\( vec2/g) === 1, '包絡恰一份實作(擺動與海浪同吃)');
  // 深度是模板插值(`${WIND.GUST_F.toFixed(3)}`)⇒ 釘的是**那個常數的名字**不是它今天的值
  ok(/return 1\.0 \+ \$\{WIND\.GUST_F[^}]*\} \* sin\(/.test(T),
    '包絡形如 1 + F·sin ⇒ **平均值恆為 1**:這一層只重新分配擺幅,不改變平均值(也就不是偷偷調大)');
  ok(/swOsc \*= celGust\( swTXZ \);/.test(T),
    '植被的包絡吃**同一株的樹基**(逐零件原點 ⇒ 同一株各段強弱不一 = 那株被拉長)');
  ok(/celGust\( celSxz \)/.test(T), '海浪的包絡吃逐頂點世界 XZ(它本來就是逐頂點的)');
  ok(/uniform vec2 uGustK;/.test(T) && count(T, /_gustK/g) === 2,
    '包絡的波數向量恰一處定義一處餵入,且與風向同源(另寫一份方向 = 陣風與擺動走不同方向)');
}

// ---------------------------------------------------------------- Ⅷ
console.log('\nⅧ 稻浪 / 草波 / 芒草波(ground.js 消費端;2026-08-04 那一輪整批漏標)');
{
  const G = code(ground);
  // 真品零件表 + 真品的 cone/box/cyl 速記(**一併抽原文**,不在本檔另抄一份 —— 抄的那一份
  // 會在有人改速記的落地平移之後靜默分家,而 span 的斷言照樣全綠)。
  // 幾何以「與 three 同值」的樁餵入:只追蹤包圍盒頂端(`detailSpan` 只讀 max.y)。
  const SHORTHAND = /^const cone = [\s\S]*?^const cyl = [^\n]*\n/m.exec(G)[0];
  const DEFS = /^const DETAIL_DEFS = \{[\s\S]*?^\};/m.exec(G)[0];
  class Geo {
    constructor(top) { this.top = top; }
    get boundingBox() { return { max: { y: this.top } }; }
    computeBoundingBox() {}
    translate(x, y) { this.top += y; return this; }
    rotateX() { return this; }
    rotateZ() { return this; }
    // 與 three 的 BufferGeometry 同一組就地變換 API:縮放只動 y 那一軸的頂端
    // (漏了這一支的症狀是整支稽核在「有人用了 .scale()」時爆掉,而紅字的理由與軟性無關)
    scale(sx, sy) { this.top *= sy; return this; }
  }
  // 置中幾何的頂端 = 半高;球狀是半徑。與 three 同值(速記的 .translate 再往上疊)。
  // **未列名的幾何一律回半徑 0 的樁而不是丟例外**:這一段驗的是「哪些零件是軟性」與
  // 「span 由幾何推導」,不是零件表用了哪幾種幾何 —— 有人加一款 TorusGeometry 就整支
  // 稽核爆掉的話,紅字的理由與真正要守的東西無關(而且那是**例外洗成跳過**的反面)。
  const T3 = new Proxy({
    ConeGeometry: function (r, h) { return new Geo(h / 2); },
    BoxGeometry: function (w, h) { return new Geo(h / 2); },
    CylinderGeometry: function (r0, r1, h) { return new Geo(h / 2); },
    IcosahedronGeometry: function (r) { return new Geo(r); },
    SphereGeometry: function (r) { return new Geo(r); },
  }, {
    get: (t, k) => t[k] || function () { return new Geo(0); },
  });
  const defs = new Function('THREE', `${SHORTHAND}${DEFS}\nreturn DETAIL_DEFS;`)(T3);
  // ① 使用者點名的三種波各有實體,而且**整款每一件**都標到
  for (const [k, why] of [['rice', '稻浪'], ['tuft', '草波'], ['miscanthus', '芒草波'],
    ['reed', '蘆葦'], ['weed', '雜草'], ['flower', '花']]) {
    const parts = defs[k] || [];
    ok(parts.length > 0 && parts.every((p) => p.sf === 'grass'),
      `${k}(${why})**每一件**都是軟性 grass(漏一支 = 草在飄、穗釘在空中)`);
  }
  ok((defs.bush || []).every((p) => p.sf === 'leaf'), '灌木是軟性 leaf');
  ok(defs.sapling.some((p) => p.sf === 'leaf') && defs.sapling.some((p) => !p.sf),
    '幼樹:葉冠軟性、樹幹不是(與 VEG_DEFS 的喬木同一條規則)');
  // ② 硬的東西 MUST NOT 被掃進來
  const hard = ['pebble', 'snag', 'charsnag', 'log', 'stump', 'plank', 'cabin', 'container',
    'solarpanel', 'headstone', 'boulder', 'crate', 'lotuspad'];
  const wrong = hard.filter((k) => (defs[k] || []).some((p) => p.sf));
  ok(wrong.length === 0, `石/枯木/人造物/浮葉一律不是軟性${wrong.length ? `;誤標:${wrong.join(',')}` : ''}`);
  // ③ span 推導:改零件表擺幅自己跟著走
  const spanFn = new Function('DETAIL_DEFS',
    `const _detSpan = new Map();\n${/^function detailSpan\(type\) \{[\s\S]*?^\}/m.exec(G)[0]}\nreturn detailSpan;`)(defs);
  ok(Math.abs(spanFn('rice') - 0.95) < 1e-9, `稻的 span 由零件幾何實算(${spanFn('rice')}m)`);
  ok(spanFn('miscanthus') > spanFn('rice'), '芒草比稻高 ⇒ 擺幅也大(相對擺幅 × span)');
  ok(spanFn('__none__' in defs ? '__none__' : 'pebble') >= 0.3, '分母有下限,MUST NOT 為零');
  // ④ 材質端真的把旗標交給 toon.js,且錨點 base = 0(這張表的落地平移烤在幾何裡)
  ok(/soft: \{ k: part\.sf, span: detailSpan\(type\), base: 0, sy: part\.sy \?\? 1 \}/.test(G),
    '細節材質帶 soft(base = 0 —— 這張表的落地平移烤在幾何裡,傳 part.y 那一套會把權重推高一截)');
  ok(count(G, /detailSpan\(/g) === 2, 'span 恰一處定義一處消費');
}

// ---------------------------------------------------------------- Ⅸ
console.log('\nⅨ 國旗(地圖 30 : 駐軍 60 : 敵對 10)');
{
  const F = code(flagsSrc), B = code(biomes);
  ok(!/^import .*(three|\.\/data\.js|\.\/lore\.js)/m.test(F)
    && (F.match(/^import /gm) || []).length === 1 && /from '\.\/rng\.js'/.test(F),
    'flags.js 零 THREE、零 DOM、只 import rng.js(旗面是純資料 ⇒ 離線驗得到)');
  ok(!/document\.|canvas/i.test(F.replace(/ctx|context/gi, '')),
    'flags.js 不建立畫布(畫的動作由呼叫端交 2D context 進來)');
  ok(Math.abs(MIX.MAP + MIX.GARRISON + MIX.ENEMY - 1) < 1e-9
    && MIX.MAP === 0.30 && MIX.GARRISON === 0.60 && MIX.ENEMY === 0.10,
    `比例 = 使用者定案的 30 : 60 : 10(實測 ${MIX.MAP} / ${MIX.GARRISON} / ${MIX.ENEMY})`);
  // 名冊 MUST 推導:手寫一份會在換陣營之後靜默過期
  ok(!/SWARM:\s*\[/.test(F) && !/STEEL:\s*\[/.test(F),
    '陣營國家名冊 MUST NOT 手寫(由 CHARACTERS[].side × LORE[].nat 推導)');
  const roster = flagsMod.sideIsoRoster(CHARACTERS, LORE);
  ok(roster.SWARM?.length >= 3 && roster.STEEL?.length >= 3,
    `名冊推導得出來(蜂群 ${roster.SWARM?.length} 國 / 鋼鐵 ${roster.STEEL?.length} 國 / 傭兵 ${roster.MERC?.length} 國)`);
  const bad = Object.keys(CHARACTERS).filter((id) => {
    const iso = flagsMod.natIso(LORE[id]?.nat);
    return !iso || !flagsMod.FLAG_DESIGNS[iso];
  });
  ok(bad.length === 0, `32 名角色的國籍全部查得到旗面${bad.length ? `;缺:${bad.join(',')}` : ''}`);
  ok(flagsMod.natIso('中國(重慶)') === 'CN' && flagsMod.natIso('烏克蘭(克里米亞韃靼)') === 'UA',
    '帶括號補述的國籍(全形/半形)切得掉 —— 直接查表那兩位會從名冊裡無聲消失');
  // 場地國:venues 的 country MUST 進 battleConfig,否則「地圖國」那 30% 恆缺席
  ok(/venue: \{ id: venue\.id, name: venue\.name, mix: venue\.mix, country: venue\.country \}/.test(code(venuesSrc)),
    'venueConfig 把 country 帶進 battleConfig(不帶 = 地圖國那一份恆缺席,而旗子照掛)');
  const noDesign = [...new Set(VENUES.map((v) => flagsMod.isoOfFlagEmoji(v.country)))]
    .filter((i) => !i || !flagsMod.FLAG_DESIGNS[i]);
  ok(noDesign.length === 0, `29 個預設場地的國旗全部畫得出來${noDesign.length ? `;缺:${noDesign}` : ''}`);
  // 比例:真的跑 pickFlagIso(不是讀常數)
  const cnt = { map: 0, garrison: 0, enemy: 0 };
  const N = 40000;
  for (let i = 0; i < N; i++) {
    const p = flagsMod.pickFlagIso(flagsMod.flagSeed((i % 500) * 7, Math.floor(i / 500) * 11),
      { map: 'TW', garrison: roster.SWARM, enemy: roster.STEEL });
    if (p) cnt[p.role]++;
  }
  for (const [k, want] of [['map', MIX.MAP], ['garrison', MIX.GARRISON], ['enemy', MIX.ENEMY]]) {
    ok(Math.abs(cnt[k] / N - want) < 0.02,
      `實測比例 ${k} ${(cnt[k] / N * 100).toFixed(1)}%(目標 ${want * 100}%,座標雜湊 ${N} 點)`);
  }
  // 地圖國缺席 ⇒ 併進駐軍(併進敵對的話一張圖上會有四成敵旗)
  let foe = 0;
  for (let i = 0; i < N; i++) {
    const p = flagsMod.pickFlagIso(flagsMod.flagSeed(i * 3, i * 5),
      { map: null, garrison: roster.SWARM, enemy: roster.STEEL });
    if (p?.role === 'enemy') foe++;
  }
  ok(Math.abs(foe / N - MIX.ENEMY) < 0.02,
    `自訂地圖(沒有 country)⇒ 那 30% 併進駐軍,敵旗仍是 ${(foe / N * 100).toFixed(1)}%`);
  // 決定性 + 零共享 rnd
  ok(flagsMod.pickFlagIso(flagsMod.flagSeed(120, -40), { map: 'JP', garrison: roster.SWARM, enemy: roster.STEEL })?.iso
    === flagsMod.pickFlagIso(flagsMod.flagSeed(120, -40), { map: 'JP', garrison: roster.SWARM, enemy: roster.STEEL })?.iso,
    '同一個落點恆同一國(跨客戶端逐位元一致的前提)');
  // **MUST NOT 用 `block()` 抽這一支**:那支從錨點起做大括號配對,而本函式的第一個 `{`
  // 是解構參數 `{ group, terrain, ... }` ⇒ 當場配平,抽到的「函式本體」只有那一行參數。
  // 症狀是所有「本體裡沒有 X」的斷言一律變成假綠(2026-08-13 實作當下踩過一次)。
  const PB = /^function placeBaseFlags\([\s\S]*?^\}/m.exec(biomes)?.[0] || '';
  ok(PB.length > 800, `placeBaseFlags 抽得到本體(${PB.length} 字元;解構參數會讓大括號配對當場配平)`);
  ok(!/rnd\(\)/.test(code(PB)),
    '主堡旗陣零共享 rnd 消耗(多抽一枚就把後面每一株植被的佈局整條推移;§2.3)');
  ok(/const heraldic = \[[^\]]*\]\[\(rnd\(\) \* 4\) \| 0\];/.test(B),
    '城堡的徽色 rnd **照抽**(掛國旗就少抽一枚 = 同一條序列位移)');
  // 每一款旗面都畫得出東西(以錄音樁當 ctx —— 這正是零 THREE 的回報)
  const calls = [];
  const ctx = new Proxy({}, { get: (t, k) => (typeof k === 'string' && ['fillStyle', 'strokeStyle', 'lineWidth'].includes(k) ? '' : (...a) => calls.push(k)), set: () => true });
  const undrawable = Object.keys(flagsMod.FLAG_DESIGNS).filter((iso) => {
    calls.length = 0;
    return !flagsMod.drawFlag(ctx, 80, 48, iso) || calls.length < 1;
  });
  ok(undrawable.length === 0, `型錄 ${Object.keys(flagsMod.FLAG_DESIGNS).length} 款全部畫得出來${undrawable.length ? `;啞的:${undrawable}` : ''}`);
  ok(flagsMod.drawFlag(ctx, 80, 48, 'ZZ') === false,
    '認不得的 ISO 回 false 而不是畫一面白旗(戰場上的白旗讀起來是投降旗)');
  // 飄揚:旗面 MUST 有橫向分段,否則只是被剪過去的一塊板子
  ok(/new THREE\.BoxGeometry\(w, h, d, FLAG_SEG, 2, 1\)/.test(B) && /const FLAG_SEG = (\d+);/.test(B)
    && Number(/const FLAG_SEG = (\d+);/.exec(B)[1]) >= 6,
    '旗面橫向分段 ≥ 6(一段的盒子只有兩排頂點 ⇒ 只能被整片剪過去,那不是飄揚)');
  // 推遲量是模板插值 ⇒ 釘的是「有沒有沿旗面推遲」而不是今天那個數字;
  // 且 MUST 收在 CEL_SWAY_H 之下(植被跟著推遲的話整片林子會沿樹高扭成螺旋)
  ok(/#ifdef CEL_SWAY_H\n\s*swP -= sw \* \$\{\(0\.8 \* Math\.PI \* 2\)[^}]*\};\n\s*#endif/.test(code(toon)),
    '旗面沿自己推遲相位 ⇒ 波由旗桿往旗尾跑(少了它旗桿側與旗尾同時到達最大位移)');
  // 主堡旗陣:逐國一個 InstancedMesh(合併會讓整批繞旗陣中心擺)
  ok(/new THREE\.InstancedMesh\(proto\.geometry, proto\.material, list\.length\)/.test(PB)
    && /for \(const \[iso, list\] of byIso\)/.test(PB),
    '旗面逐國一個 InstancedMesh(合併成一個 mesh ⇒ 擺動權重吃合併後的 x = 整批繞旗陣中心擺)');
  ok(!/blockers\.push|blockArea\(/.test(PB),
    '主堡旗陣是純表現層:0.12m 的細桿不登記碰撞(掛了就是旗桿之間看不見的牆)');
  ok(/const ry = -WIND\.DIR_DEG \* Math\.PI \/ 180;/.test(PB),
    '旗面朝下風(旗尾 = 局部 +x;不轉的話旗子側著吹,看起來像旗桿裝反了)');
}

// ---------------------------------------------------------------- Ⅹ
// 玩家位移擾動(S5)與岸邊泡沫 / 水面倒影(S6)—— **本輪只落地縫,呼叫端一個都沒接**。
// 兩者的病灶都不報錯:
//   ・空槽沒有顯式歸零 ⇒ 那台機體離開之後它腳邊的草**永遠倒著**;
//   ・對零向量 `normalize()` 之後乘 0 ⇒ NaN × 0 仍是 NaN ⇒ 那批 InstancedMesh **整批消失**;
//   ・擾動半徑寫成常數 ⇒ 「走路撥開、跑步甩開」那一層整個不見,而畫面上仍然「有在動」;
//   ・泡沫的驅動量不是水深 ⇒ 它就不再繞過石頭與柱子(而看起來仍然像一圈泡沫)。
console.log('\nⅩ 玩家位移擾動(S5)+ 岸邊泡沫 / 倒影(S6)');
{
  let T = code(toon);
  const CHAR = new Function(`${block(toon, 'export const CHAR = ').replace('export ', '')}\nreturn CHAR;`)();
  const FOAM = new Function(`${block(toon, 'export const FOAM = ').replace('export ', '')}\nreturn FOAM;`)();
  const REFL = new Function(`${block(toon, 'export const REFL = ').replace('export ', '')}\nreturn REFL;`)();
  // ---- S5 參數表 ----
  ok(CHAR.N >= 1 && Number.isInteger(CHAR.N), `擾動源槽數 N = ${CHAR.N}(成本預算常數:每一槽是逐頂點一次 length())`);
  ok(CHAR.R0 > 0 && CHAR.R_PER_MPS > 0,
    `擾動半徑 = ${CHAR.R0} + ${CHAR.R_PER_MPS} × 速率 —— **半徑是速度的函式**(常數半徑 = 走路與跑步撥開的範圍一樣大)`);
  ok(CHAR.SPD_REF > 0 && CHAR.PUSH_F > 0 && CHAR.SPD_K > 0,
    `飽和速率 ${CHAR.SPD_REF} m/s、位移倍率 ${CHAR.PUSH_F}、平滑係數 ${CHAR.SPD_K}`);
  // ---- S5 行為直測:空槽 MUST 顯式歸零 ----
  let setSrc = block(toon, 'export function setCelChar(').replace('export ', '');
  if (BREAK_CHARSLOT) {
    const bentS = setSrc.replace(/_charSpd\.value\[i\] = c \? Math\.max\(0, c\.spd \|\| 0\) : 0;/,
      'if (c) _charSpd.value[i] = Math.max(0, c.spd || 0);');
    if (bentS === setSrc) { console.error('✗ --break-charslot:樣式沒咬到 toon.js,反向驗證等於沒跑'); process.exit(1); }
    setSrc = bentS;
  }
  const pos = Array.from({ length: CHAR.N }, () => ({ x: 0, y: 0, z: 0, set(a, b2, c) { this.x = a; this.y = b2; this.z = c; } }));
  const spd = new Float64Array(CHAR.N);
  const setFn = new Function('CHAR', '_charPos', '_charSpd', `${setSrc}\nreturn setCelChar;`)(
    CHAR, { value: pos }, { value: spd });
  setFn([{ x: 1, y: 0, z: 2, spd: 5 }, { x: 3, y: 0, z: 4, spd: 7 }]);
  const two = [spd[0], spd[1]];
  setFn([{ x: 1, y: 0, z: 2, spd: 5 }]);
  ok(two[0] === 5 && two[1] === 7, `兩台在線時逐槽都寫進去(${two.join(' / ')})`);
  ok(spd[0] === 5 && spd[1] === 0,
    `只剩一台時第二槽**顯式歸零**(實測 ${spd[1]});留上一幀的值 = 那台離開之後草永遠倒著`);
  setFn([]);
  ok([...spd].every((v) => v === 0), '全空 ⇒ 全槽 0 ⇒ 位移項早退 ⇒ 逐位元同舊制');
  // ---- S5 原文:位移落在 CEL_SWAY 區塊,而且是「早退不加」----
  const sway = /#ifdef CEL_SWAY\n([\s\S]*?)#endif\n\s*#include <project_vertex>/.exec(T);
  let S5 = sway ? sway[1] : '';
  if (BREAK_CHAR) {
    const bent = S5.replace(/transformed \+= cDir \* \( cW \* sw \* uSoftAmp \* \$\{CHAR\.PUSH_F[^}]*\} \);/, '');
    if (bent === S5) { console.error('✗ --break-char:樣式沒咬到 toon.js,反向驗證等於沒跑'); process.exit(1); }
    S5 = bent;
  }
  if (BREAK_CHARR) {
    const bent = S5.replace(/float cR = \$\{CHAR\.R0[^}]*\} \+ \$\{CHAR\.R_PER_MPS[^}]*\} \* cSpd;/,
      'float cR = ${CHAR.R0.toFixed(3)};');
    if (bent === S5) { console.error('✗ --break-charR:樣式沒咬到 toon.js,反向驗證等於沒跑'); process.exit(1); }
    S5 = bent;
  }
  ok(/transformed \+= cDir \* \( cW \* sw \* uSoftAmp \* \$\{CHAR\.PUSH_F[^}]*\} \);/.test(S5),
    '位移加項排在 #include <project_vertex> **之前**(那一段吃 transformed 算 gl_Position)');
  ok(/float cR = \$\{CHAR\.R0[^}]*\} \+ \$\{CHAR\.R_PER_MPS[^}]*\} \* cSpd;/.test(S5),
    '擾動半徑吃 uCharSpd(常數半徑 = SKILL L1 第 3 層的整個重點消失:走路撥開、跑步甩開)');
  ok(/if \( cSpd <= 0\.0 \) continue;/.test(S5),
    '空槽**早退**而不是「加一個 0」(x + 0.0 對 −0.0 不是恆等;而且省掉每頂點 N 次 length())');
  ok(/max\( length\( cRel\.xz \), 1e-4 \)/.test(S5) && !/normalize\( cRel/.test(S5),
    '離心方向除以 max(len, 1e-4) —— **MUST NOT 對零向量 normalize() 之後乘 0**(NaN × 0 仍是 NaN ⇒ 那批 InstancedMesh 整批消失,console 一個字都沒有)');
  ok(/vec3\( cOut\.x, 0\.0, cOut\.y \) \* swM/.test(S5),
    '方向轉進零件局部座標(沿用 swD 那一行的轉置 idiom;實例的 ry 是亂數)');
  ok(/float swWy = swO\.y \+ \( swM \* transformed \)\.y;/.test(S5)
    && /vec3\( swTXZ\.x, swWy, swTXZ\.y \) - uCharPos\[ ci \]/.test(S5),
    '距離是 2.5D:水平取同一株的樹基、垂直取這個頂點自己的世界高度 ⇒ 同株幹/枝/冠同推不同剪,地面機體構造上碰不到 6m 高的樹冠');
  ok(count(S5, /sin\(/g) === 2,
    '**沒有第三個 sin(**(擴充這一區塊時最容易踩的一條:Ⅲ 的正規式是全域計數)');

  // ---- S6 泡沫:常數與推導 ----
  ok(FOAM.BAND_M > 0 && FOAM.STEP > 0 && FOAM.STEP < 1 && FOAM.SHAPE_K > 1
    && FOAM.NOISE_M > 0 && FOAM.RANGE_M > 0 && FOAM.TEXEL_M > 0,
    `FOAM 參數齊全(帶寬 ${FOAM.BAND_M}m、硬邊門檻 ${FOAM.STEP}、深度上界 ${FOAM.RANGE_M}m、texel ${FOAM.TEXEL_M}m)`);
  ok(REFL.SEG_N >= 2 && REFL.GAP_F > 0 && REFL.GAP_F < 1 && REFL.MIN_H > 0 && REFL.MAX_N > 0,
    `REFL 參數齊全(${REFL.SEG_N} 段、斷口 ${REFL.GAP_F}、最小高 ${REFL.MIN_H}m、上限 ${REFL.MAX_N} 個)`);
  const fieldN = new Function('FOAM', `${block(toon, 'export const seaFieldN = ').replace('export ', '')}\nreturn seaFieldN;`)(FOAM);
  const hi = fieldN(1200, 1200, false), lo = fieldN(1200, 1200, true);
  ok(hi > lo && lo >= 2, `深度場邊長由 TEXEL_M 推導、低功耗折半(${hi} → ${lo});MUST NOT 手寫 1024`);
  ok(!/1024/.test(block(toon, 'export const seaFieldN = ').replace(/Math\.min\(1024/, '')),
    'seaFieldN 內除了上限夾制之外沒有手寫解析度');
  ok(/old\?\.dispose\(\);/.test(block(toon, 'export function setSeaDepthField(')),
    'setSeaDepthField 釋放上一場的場貼圖(A25:不放掉就是每開一場漏一張)');
  ok(/new Uint8Array\(\[255\]\)/.test(T) && /function neutralSeaField/.test(T),
    '預設是 1×1 的「很深」中性貼圖 ⇒ 沒有水域 / 還沒烤 ⇒ **沒有泡沫**而不是滿場泡沫(原則 6)');
  // ---- S6 泡沫:GLSL 原文 ----
  let FSRC = /float celFoam\( vec2 celFxz \) \{[\s\S]*?\n        \}/.exec(T);
  ok(!!FSRC, 'celFoam 住 toon.js(GLSL 補丁一律不外流)');
  let fsrc = FSRC ? FSRC[0] : '';
  if (BREAK_FOAM) {
    const bent = fsrc.replace(/float celFd = texture2D\( uSeaField, celFuv \)\.r \* \$\{FOAM\.RANGE_M[^}]*\};/,
      'float celFd = 1.0;');
    if (bent === fsrc) { console.error('✗ --break-foam:樣式沒咬到 toon.js,反向驗證等於沒跑'); process.exit(1); }
    fsrc = bent;
  }
  if (BREAK_FOAM_SHAPE) {
    const bent = fsrc.replace(/pow\( celBand, \$\{FOAM\.SHAPE_K[^}]*\} \)/, 'celBand');
    if (bent === fsrc) { console.error('✗ --break-foam-shape:樣式沒咬到 toon.js,反向驗證等於沒跑'); process.exit(1); }
    fsrc = bent;
  }
  ok(/texture2D\( uSeaField, celFuv \)/.test(fsrc),
    '泡沫的驅動量是**水深**(唯一來源 = 深度場取樣);換成常數 = 它不再繞過石頭與柱子,而看起來仍然像一圈泡沫');
  ok(/celFade = clamp\( 1\.0 - celFd \/ \$\{FOAM\.RANGE_M[^}]*\}, 0\.0, 1\.0 \)/.test(fsrc)
    && /if \( celFade <= 0\.0 \) return 0\.0;/.test(fsrc),
    '深度 ≥ RANGE_M ⇒ **恆 0**(中性場恰好落在這裡 ⇒ 逐位元同舊制)');
  ok(/celSeaH\( celFxz \)/.test(fsrc),
    '相位減去 celSeaH(浪一來泡沫沖上岸)—— 自己再寫一次相位 = 泡沫的沖刷與浪峰差半個波長');
  ok(/step\( \$\{FOAM\.STEP[^}]*\}, celFp \)/.test(fsrc),
    '硬邊(step)不是柔霧 —— 賽璐璐的泡沫是白色硬邊');
  ok(/4\.0 \* celFb \* \( 1\.0 - celFb \)/.test(fsrc)
    && /pow\( celBand, \$\{FOAM\.SHAPE_K[^}]*\} \)/.test(fsrc)
    && /\* mix\( 0\.45, 1\.0, celNoise/.test(fsrc),
    '泡沫帶是高次 parabola × 淡出 × 噪聲;三角波直接 step 會讓白條佔過半週期');
  const iOpaque = opaqueAnchor(T);
  ok(iOpaque > 0 && T.indexOf('float celF = celFoam( vCelWP.xz ) * vSeaFade * uFoamA;') > iOpaque,
    '套用排在 #include <opaque_fragment> **之後**(寫進 diffuseColor 會讓泡沫再過一次 toon ramp:硬邊被階梯切開、陰影裡的泡沫變灰)');
  ok(/celFoam\( vCelWP\.xz \) \* vSeaFade/.test(T),
    '泡沫乘 vSeaFade(否則 53m 外環水面會被 ClampToEdge 拉出一圈全白)');
  ok(/wash > 0 \|\| moss \|\| sk\?\.axis === 'w'/.test(T),
    'CEL_WP 的條件**顯式**收海浪那一族(水面現況剛好有 wash: 0.5,靠巧合成立的東西沒有斷言守得住)');
}

// ---------------------------------------------------------------- Ⅺ
// 墨線斷筆(序 4 ①-2)騎的正是 Ⅱ 那條 alpha 契約 ⇒ 兩段住同一支稽核。
// ⚠ **三件離線量不到的事**(定裝照才驗得到,已寫進 toon.js INK_BREAK 旁邊):
//   ① 勾線 pass 取 min(這一格 + 四鄰)⇒ 缺口被侵蝕一圈,實際比寫進去的寬約 2px;
//   ② 世界空間錨定 ⇒ 一個週期投影到螢幕的像素數 ∝ 1/距離,遠處會退化成亞像素雜訊;
//   ③ 8bit RT 上軟性件的斷處(0.3 × 0.12 ≈ 9/255)實質等於沒有線。
console.log('\nⅪ 墨線斷筆(序 4 ①-2)+ 掠射抑制項恰一項(①-4)');
{
  const T = code(toon), P = code(post);
  const BRK = new Function(`${block(toon, 'export const INK_BREAK = ').replace('export ', '')}\nreturn INK_BREAK;`)();
  // ---- 參數表 ----
  ok(BRK.CUT > 0 && BRK.CUT < 1, `斷點門檻 CUT = ${BRK.CUT} ∈ (0,1)(celNoise 的值域;0 或 1 = 恆不斷 / 恆斷)`);
  ok(BRK.LO >= 0 && BRK.LO < 1, `斷處倍率 LO = ${BRK.LO} ∈ [0,1)(= 1 就是整段恆等式 = 等於沒做)`);
  ok(BRK.SPAN_MECH > 0 && BRK.SPAN_ENV > 0 && BRK.SPAN_MECH < BRK.SPAN_ENV,
    `兩軌的抬筆週期 機體 ${BRK.SPAN_MECH}m < 環境 ${BRK.SPAN_ENV}m(機體全高 4.5~9m、地形的一筆畫跨數十公尺 ⇒ 同一個週期只能對其中一邊)`);
  // ---- 軌的選擇:沿用既有的 tint 軸,MUST NOT 另建名冊 ----
  ok(/uInkBreakSpan = \{ value: tint === 'env' \? INK_BREAK\.SPAN_ENV : INK_BREAK\.SPAN_MECH \}/.test(T),
    '軌 = 既有的 `tint` 參數(= _rampTint 那條已存在的軸);另建「哪些材質算機體」的名冊會在加零件時靜默過期');
  ok(!/SPAN_MECH/.test(T.replace(/uInkBreakSpan[^\n]*\n/, '').replace(/SPAN_MECH: [\d.]+,/, '')),
    'SPAN_MECH 的消費端**恰一處**(第二處 = 兩份軌選擇,而分家的症狀只是「有些零件不會斷筆」)');
  // ---- 拉桿 → 共享 uniform ----
  ok(/_inkBreakA\.value = visualPref\('inkBreak'\);/.test(T)
    && /shader\.uniforms\.uInkBreakA = _inkBreakA;/.test(T),
    '拉桿走**共享 uniform 物件**(`= _inkBreakA`,不是 `{ value: … }`)⇒ 改值不必重建材質(紀律③)');
  ok(/const _inkBreakA = \{ value: 0 \};/.test(T)
    && T.indexOf('const _inkBreakA') < T.indexOf('function syncVisualPrefs'),
    '宣告排在 syncVisualPrefs **之前**(它在模組載入時就跑一次 ⇒ 晚一步就是整支 toon.js 在 import 當下 TDZ ReferenceError)');
  // ---- GLSL:錨點、雜訊、早退 ----
  const IB = /#ifdef CEL_INKB\n([\s\S]*?)#endif\n\s*#ifdef CEL_DIS/.exec(T);
  ok(!!IB, '斷筆錨點住頂點端的 CEL_INKB 區塊');
  const ib = IB ? IB[1] : '';
  ok(/vCelInkP = mat3\( modelMatrix \) \* ibP\.xyz;/.test(ib) && !/modelMatrix \* ibP/.test(ib),
    '錨點 MUST 丟掉平移欄(`mat3( modelMatrix )`)—— 寫成 mat4 之後畫面上只是「走一步缺口在身上游動」,而每一條離線斷言照樣全綠');
  ok(/ibP = instanceMatrix \* ibP;/.test(ib),
    'instanceMatrix 收進來(同款植被逐株不同花紋;對靜態實例它退化成世界座標)');
  const CB = /float celInkBreak\(\) \{[\s\S]*?\n        \}/.exec(T);
  ok(!!CB, 'celInkBreak() 住 toon.js(GLSL 補丁一律不外流)');
  const cb = CB ? CB[0] : '';
  ok(/if \( uInkBreakA <= 0\.0 \) return 1\.0;/.test(cb),
    '拉桿 0 ⇒ **uniform 分支早退**,回傳的是字面 1.0 不是 mix 出來的 1.0(浮點上兩者可以不同)');
  ok(count(cb, /celNoise\(/g) === 2,
    '兩個平面各取一次雜訊(只取 p.xz 的話垂直裝甲板上整條線同相 = 沒有斷點)');
  ok(/step\( n, \$\{INK_BREAK\.CUT[^}]*\} \)/.test(cb) && /mix\( 1\.0, \$\{INK_BREAK\.LO[^}]*\}/.test(cb),
    '門檻與斷處倍率由 JS 模板插值(GLSL 裡手寫數字 = 第二份參數表)');
  ok(/return mix\( 1\.0, brk, uInkBreakA \);/.test(cb),
    '拉桿是**線性混入**(0 ⇒ 恆等 1;沒有第二條時間/強度曲線)');
  // 雜訊全專案恰一份:兩份 hash = 地形的斷點與機體的斷點是兩種花紋,而沒有錯誤訊息
  ok(count(T, /float celHash\( vec2 p \)/g) === 1 && count(T, /float celNoise\( vec2 p \)/g) === 1,
    'celHash / celNoise 全專案**各恰一份**(斷筆與 wash / moss / 泡沫同吃)');
  // `#ifdef CEL_WP` 在 celHash **之前就已經 #endif** ⇒ 雜訊在 ifdef 之外(關在裡面的話
  // 沒有 CEL_WP 的材質拿不到它,而 GLSL 的錯誤是**整批物件不畫**、console 一個字都沒有)
  ok(/#ifdef CEL_WP\s+varying vec3 vCelWP;\s+#endif\s+float celHash\( vec2 p \)/.test(T),
    'celNoise 已提出 `#ifdef CEL_WP`(那一格 ifdef 只剩 varying 宣告,雜訊在它之外)');
  // ---- 快取鍵 ----
  ok(/\$\{inkAlpha \? 'B' : ''\}/.test(T),
    'CEL_INKA/CEL_INKB 進 customProgramCacheKey(defines 不同卻共用程式 ⇒ 半透明件拿到寫死 alpha 的那一版 = 水面從 0.82 變 0.30)');

  // ---- ①-4 掠射抑制項:恰一項,MUST NOT 疊 ----
  // 2026-08-16 定案:**維持 `INK.K_S`,不換成 `1 − n.z`**。量測(解析平面模型,fovY 68°、
  // 1080p、門檻倍率相對正對鏡頭的牆)在下面直接算給你看;`1 + K_N·(1 − n.z)` 的上界恆為
  // `1 + K_N` ⇒ 配到 2° 相等要 K_N = 11.1,那時 45° 斜面被推到 3.1 倍過度抑制;配到 10°
  // 相等則仰角 2° 只剩 0.30 倍 ⇒ **兩條曲線在任何單一係數下都配不起來**。
  // 另外三條:`1 − n.z` 只有 inkMrt 開著才拿得到法線(而它**預設關**、WebGL1 上根本沒有)、
  // 哨兵像素沒有法線要第二份門檻(= 第二份實作)、低解析度時它對像素尺寸是線性沒有上界。
  const INKM2 = code(block(post, '  _inkMaterial() {'));
  const DEN = /float e = lap \/ max\([^;]*\);/.exec(INKM2);
  ok(!!DEN, '深度門檻的分母是一行式子(勾線 pass 的 `e = lap / max(…)`)');
  const den = DEN ? DEN[0] : '';
  ok(/slope \* \$\{INK\.K_S[^}]*\}/.test(den) && count(den, /INK\.K_S/g) === 1,
    '掠射抑制項**恰一項**(`slope × INK.K_S`)');
  ok(!/n\.z|\bnz\b|depthLimit|uDepthRange/.test(den),
    '深度門檻 MUST NOT 再疊法線式上限(計畫 ①-4「兩者擇一,MUST NOT 疊」寫成可驗的形式)');
  // 行為:從**原文**取 K_D / K_S,以解析平面模型算門檻倍率
  const KD = Number(/K_D: ([\d.]+),/.exec(P)?.[1]);
  const KS = Number(/K_S: ([\d.]+),/.exec(P)?.[1]);
  const alpha = 2 * Math.tan((68 / 2) * Math.PI / 180) / 1080;   // 每像素的角尺寸(fovY 68°、1080p)
  const mult = (deg) => 1 + 2 * alpha * KS / (KD * Math.tan(deg * Math.PI / 180));
  ok(Number.isFinite(KD) && Number.isFinite(KS) && KD > 0 && KS > 0,
    `門檻兩項係數由原文取(K_D = ${KD}、K_S = ${KS})`);
  ok(mult(2) >= 8,
    `掠射 2° 的門檻倍率 ${mult(2).toFixed(2)}× ≥ 8×(45° 只有 ${mult(45).toFixed(2)}× ⇒ 山坡乾淨而建物輪廓還在;K_S 被「簡化」成 0 就在這裡紅)`);
}

console.log(`\n${fail === 0 ? '✅' : '❌'} 通過 ${pass} 項,失敗 ${fail} 項`);
const BREAKS = [BREAK_INK && '--break-ink', BREAK_ANCHOR && '--break-anchor',
  BREAK_WAVE && '--break-wave', BREAK_GUST && '--break-gust',
  BREAK_CHAR && '--break-char', BREAK_CHARR && '--break-charR',
  BREAK_CHARSLOT && '--break-charslot', BREAK_FOAM && '--break-foam', BREAK_FOAM_SHAPE && '--break-foam-shape',
  BREAK_INKBREAK && '--break-inkbreak', BREAK_INKANCHOR && '--break-inkanchor',
  BREAK_GRAZE && '--break-graze', BREAK_TREEPHASE && '--break-treephase'].filter(Boolean);
if (BREAKS.length) {
  console.log(`（反向驗證模式:${BREAKS.join(' ')} —— 上面 MUST 有紅字）`);
  process.exit(fail === 0 ? 1 : 0);
}
process.exit(fail === 0 ? 0 : 1);
