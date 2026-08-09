// ============ 世界高度上限(遊戲最高高度 / 物件最高高度) 稽核 ============
// 用途:改 `data.js` 的 `WORLD_H`/`objHeightMax`/`objScaleCap`/`objScaleFit`/`worldCeilY`、
// `TARGET_H.tower`、`terrain.js` 的 `avgH`、`game.js` 的 `_ceilY` 與其消費端(飛行夾制 /
// 上帝視角 / 觀戰起始高度)、`biomes.js` 的 `OVER.bldCap` 與四個物件縮放夾制點,或任何一張
// 物件表(`GIANT_DEFS`/`MEGALITHS`/`LANDMARK_COL`/`BEACON_KINDS`)之後跑。
//
// 使用者定案(2026-08-08)兩句:
//   ①「遊戲最高高度 = max(平均海拔 + 4 倍砲塔高度, 最高海拔 + 2.5 倍砲塔高度)」
//   ②「所有物件的最高高度限定 2 倍砲塔高度」
// 兩句話都是可量測的不變式,本稽核逐條釘死;另加四條「這件事有沒有真的發生在世界裡」的反模式:
//
//   Ⅰ 推導不手寫 —— 三個係數全是 `TARGET_H.tower` 的倍數。手寫 52 / 104 / 65 的下場是:
//        改了砲塔量體之後那三個數字悄悄與塔脫鉤,而畫面上只表現成「這張圖的樓好像比塔高一點」。
//   Ⅱ 結構性不等式 —— 天花板到**任一點地表**的餘裕最少是 `CEIL_PEAK_F × 塔高`(因為地表 ≤ 最高
//        海拔),而物件上限是 `OBJ_F × 塔高` ⇒ 只要 `CEIL_PEAK_F > OBJ_F`,物件就**恆構不到**
//        天花板。這是結構保證不是校準:把 `OBJ_F` 調到 ≥ `CEIL_PEAK_F` 會生出「山頂上的建物
//        頂端頂到飛行天花板」那種穿模。
//   Ⅲ 現役物件表 —— 五族(建物/神木/巨岩/地標/語意化地標)逐款以**真品原文的表**重算,
//        夾制後的世界高度 MUST ≤ 上限;且「最大的那一個恰好貼齊上限」(夾制真的在做事,
//        不是剛好全部本來就矮)。植被另驗標稱高遠在上限之下(結構性安全,不需夾制)。
//   Ⅳ 分布版不是第二條規則 —— `objScaleFit` 的壓縮率就是 `objScaleCap` 套在該處最大縮放上的
//        比值 ⇒ 上限一改兩支同步走;而它**保留相對變異**:硬夾對神木會把整片森林壓成每一株
//        一樣高(公稱 72~110m、最小縮放 0.73 ⇒ 連最矮的抽樣都超過上限),而「同種群聚、
//        株高各異」是這套群落既有的設計(樹冠羞避的縮冠量也是從株高變異來的)。
//   Ⅴ 唯一縫 —— 客戶端的天花板只有 `game._ceilY` 一份(逐處各自去讀地形統計 = 第二份實作,
//        壞掉的樣子只是「有些地方飛得比較高」);消費端數得出來;公式不在消費端重寫。
//   Ⅵ NPC / bot / 彈道結構性收在天花板之下 —— 它們沒有客戶端物理那道夾制,靠的是各自的高度
//        本來就低於「天花板到地表的最小餘裕」。這一節是那個前提的守門線(改了巡航高度或
//        極音速飛彈的發射角就會在這裡紅字,而不是在對局裡表現成「飛彈穿出天花板」)。
//
// 跑法:`node tools/audit_world_height.mjs`(不需伺服器/瀏覽器/網路)
//       反向驗證:`--break-ceil`(天花板改成手寫常數 ⇒ Ⅰ・Ⅱ 紅)
//                 `--break-obj`(物件上限拉到 ≥ 天花板餘裕 ⇒ Ⅱ・Ⅲ 紅)
// 讀原文走 `audit_src.mjs` 單一縫(含換行正規化 —— 逐行剝註解在 CRLF 工作區會靜默失效)。
import { readSrc, grabMethod, grabConst } from './audit_src.mjs';
import {
  WORLD_H, objHeightMax, objScaleCap, objScaleFit, worldCeilY, TARGET_H, GAME, hyperApex,
} from '../public/js/data.js';

const BREAK_CEIL = process.argv.includes('--break-ceil');
const BREAK_OBJ = process.argv.includes('--break-obj');
if (BREAK_OBJ) WORLD_H.OBJ_F = WORLD_H.CEIL_PEAK_F + 0.5;
// `--break-cap` = 把物件上限調回 2026-08-08 的 2 倍(52m)。這**不是**假造的壞值,是
// 2026-08-09 之前 main 上真正的狀態 —— 重現那次「兩個 PR 各自綠、合起來把整棟量體
// 庫節點變成死碼」的語意衝突,用來證明 Ⅲ 的門檻守門線真的咬得住(`--break-obj`
// 是把上限往**上**推,咬不到這一條)。
if (process.argv.includes('--break-cap')) WORLD_H.OBJ_F = 2;
// `--break-ceil` = 把天花板換成**手寫常數**版(今天的塔高剛好算出來的那兩個數字)。
// 它在 Ⅰ・Ⅱ 之外一切照舊 ⇒ 反向驗證要咬住的正是「改了砲塔量體之後還跟不跟得上」。
const CEIL = BREAK_CEIL ? (avg, peak) => Math.max((avg || 0) + 104, (peak || 0) + 65) : worldCeilY;

const dataSrc = readSrc('public', 'js', 'data.js');
const gameSrc = readSrc('public', 'js', 'game.js');
const bioSrc = readSrc('public', 'js', 'biomes.js');
const terrSrc = readSrc('public', 'js', 'terrain.js');
const simSrc = readSrc('server', 'sim.js');
const botsSrc = readSrc('server', 'bots.js');

const strip = (s) => s
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .split('\n').map((l) => l.replace(/(^|[^:'"`])\/\/.*$/, '$1')).join('\n');
/** 只數執行原文,且跳過 import 區塊(import 也提得到同一個名字) */
const codeOf = (s) => strip(s).split("from '../public/js/data.js';").slice(-1)[0]
  .split("from './data.js';").slice(-1)[0];
const gameCode = codeOf(gameSrc), bioCode = codeOf(bioSrc), simCode = codeOf(simSrc), botsCode = codeOf(botsSrc);

let pass = 0, fail = 0;
const t = (n, ok, extra = '') => { ok ? (pass++, console.log(`  ✓ ${n}`)) : (fail++, console.log(`  ✗ ${n} ${extra}`)); };
const count = (s, re) => (s.match(re) || []).length;
const near = (a, b, e = 1e-9) => Math.abs(a - b) <= e;

// ---- 真品原文的物件表(這幾張表住在 import three 的檔案裡,Node 端 import 不了整支;
//      抄一份數字進稽核則永遠會通過 ⇒ 一律 grabConst 執行原文。`build:` 閉包只定義不求值)----
const gStub = { cyl: (r1, r2, h) => ({ bb: h / 2 }), cone: (r, h) => ({ bb: h / 2 }), ico: (r) => ({ bb: r }) };
const runTable = (src, name, extraNames = [], extraVals = []) => new Function(
  'cyl', 'cone', 'ico', ...extraNames, `${grabConst(src, name)} return ${name};`,
)(gStub.cyl, gStub.cone, gStub.ico, ...extraVals);

const GIANT_DEFS = runTable(bioSrc, 'GIANT_DEFS');
const MEGALITHS = runTable(bioSrc, 'MEGALITHS');
const LANDMARK_COL = runTable(bioSrc, 'LANDMARK_COL');
const VEG_DEFS = runTable(bioSrc, 'VEG_DEFS');
const VEG_SCALE = runTable(bioSrc, 'VEG_SCALE');
const OVER = runTable(bioSrc, 'OVER', ['objHeightMax'], [objHeightMax]);
const BEACON_KINDS = runTable(readSrc('public', 'js', 'beacons.js'), 'BEACON_KINDS');
/** 標稱高(= vegSpan 的同一式:逐零件 y + 包圍盒頂 × sy)*/
const spanOf = (def) => Math.max(0.5, ...def.parts.map((p) => (p.y || 0) + p.g.bb * (p.sy || 1)));

const TOW = TARGET_H.tower;

// ---------------- Ⅰ 公式推導不手寫 ----------------
console.log('Ⅰ 公式:三個係數全是砲塔高的倍數,推導不手寫');
{
  t('物件上限 = 砲塔高 × OBJ_F(獨立重算)', near(objHeightMax(), TOW * WORLD_H.OBJ_F));
  t('天花板 = max(平均海拔 + CEIL_AVG_F×塔高, 最高海拔 + CEIL_PEAK_F×塔高)(獨立重算)',
    [[0, 0], [30, 45], [400, 900], [-12, 3.5], [1200, 3200]].every(([a, p]) => near(
      CEIL(a, p), Math.max(a + TOW * WORLD_H.CEIL_AVG_F, p + TOW * WORLD_H.CEIL_PEAK_F))));

  // 定義式裡不得出現高度字面值:改了塔高之後那幾個數字就與塔脫鉤(且沒有任何錯誤訊息)
  const defSrc = strip(dataSrc.slice(dataSrc.indexOf('export const objHeightMax'),
    dataSrc.indexOf('// ---- 自機碰撞量體')));
  t('三支定義式內無數字字面值(除 0 / 1 這種恆等/守衛)',
    !/[^\w.]\d+(\.\d+)?\s*[*/+]/.test(defSrc.replace(/\|\| 0/g, '')), defSrc.slice(0, 120));
  t('係數表 WORLD_H 只在 data.js 定義一次',
    count(dataSrc, /export const WORLD_H\b/g) === 1);

  // 塔高一改,兩個上限同步跟著漂(這就是「同一把尺」的證據)
  const t0 = TARGET_H.tower, o0 = objHeightMax();
  TARGET_H.tower = t0 * 2;
  const obj2 = objHeightMax(), ceil2 = CEIL(10, 20);
  TARGET_H.tower = t0;
  t('砲塔高 ×2 ⇒ 物件上限 ×2', near(obj2, o0 * 2) && near(objHeightMax(), o0));
  t('砲塔高 ×2 ⇒ 天花板的兩項餘裕同步 ×2',
    near(ceil2, Math.max(10 + t0 * 2 * WORLD_H.CEIL_AVG_F, 20 + t0 * 2 * WORLD_H.CEIL_PEAK_F)));

  // 取 max 而不是 min:平原由平均海拔那一項勝出、高山由最高海拔那一項接手
  // 標題吃常數,MUST NOT 手寫倍數:2026-08-09 把三個係數整組抬高時,寫死「4 倍 / 2.5 倍」的
  // 標題會**照樣印綠字**、只是講的是別的數字 —— 稽核的可讀性也會過期。
  t(`平坦場地(avg ≈ peak)由「平均海拔 + ${WORLD_H.CEIL_AVG_F} 倍塔高」勝出`,
    near(CEIL(30, 33), 30 + TOW * WORLD_H.CEIL_AVG_F));
  t(`落差大的場地由「最高海拔 + ${WORLD_H.CEIL_PEAK_F} 倍塔高」接手(谷底也飛得過稜線)`,
    near(CEIL(400, 900), 900 + TOW * WORLD_H.CEIL_PEAK_F));
  // 上面兩條各自成立的**前提**:地表恆 ≤ 最高海拔 ⇒ 平均項的係數不大於峰頂項的話,
  // 平坦那一項永遠贏不了(規則 ③ 退化成單一項,而畫面上只表現成「天花板好像變低了」)。
  t('CEIL_AVG_F > CEIL_PEAK_F(「取 max 的兩端各自勝出」的前提)',
    WORLD_H.CEIL_AVG_F > WORLD_H.CEIL_PEAK_F,
    `avg=${WORLD_H.CEIL_AVG_F} peak=${WORLD_H.CEIL_PEAK_F}`);
  t('兩個輸入各自單調不減',
    CEIL(50, 20) >= CEIL(10, 20) && CEIL(10, 900) >= CEIL(10, 20));
  t('取不到高程統計 ⇒ 退回 0 基準而不是 NaN(原則 6)',
    Number.isFinite(CEIL(undefined, undefined)) && Number.isFinite(CEIL(null, NaN)));
}

// ---------------- Ⅱ 結構性不等式:物件恆構不到天花板 ----------------
console.log('\nⅡ 結構:天花板到地表的最小餘裕 > 物件上限');
{
  t('CEIL_PEAK_F > OBJ_F(這是「物件碰不到天花板」的全部理由)',
    WORLD_H.CEIL_PEAK_F > WORLD_H.OBJ_F,
    `peak=${WORLD_H.CEIL_PEAK_F} obj=${WORLD_H.OBJ_F}`);
  // 掃描:任一場地統計 × 任一點地表(地表恆 ≤ 最高海拔)
  let worst = Infinity, worstAt = null;
  for (const avg of [-30, 0, 25, 400, 1800]) {
    for (const peak of [avg, avg + 5, avg + 80, avg + 900]) {
      for (let f = 0; f <= 1.0001; f += 0.1) {
        const ground = avg + (peak - avg) * f;      // 這張圖上的任一點地表
        const room = CEIL(avg, peak) - ground;
        if (room < worst) { worst = room; worstAt = [avg, peak, ground]; }
      }
    }
  }
  t('任一場地任一點:天花板 − 地表 ≥ CEIL_PEAK_F × 塔高',
    worst >= TOW * WORLD_H.CEIL_PEAK_F - 1e-9, `最緊 ${worst.toFixed(1)}m @ ${worstAt}`);
  t('⇒ 站在最高峰的物件頂端仍在天花板之下(差至少半個塔高)',
    worst > objHeightMax(), `餘裕 ${worst.toFixed(1)} vs 物件上限 ${objHeightMax()}`);
}

// ---------------- Ⅲ 現役物件表:夾制後全數收在上限之下 ----------------
console.log('\nⅢ 現役物件:五族逐款重算世界高度');
{
  const CAP = objHeightMax();
  const tops = [];
  const chk = (fam, name, h) => { tops.push(h); return h <= CAP + 1e-9 ? null : `${fam}/${name} ${h.toFixed(1)}m`; };

  // 建物:三個生成點都經 OVER.bldCap
  t('OVER.bldCap === objHeightMax()(而且原文不是字面值)',
    near(OVER.bldCap, CAP) && !/bldCap:\s*\d/.test(strip(bioSrc)), `bldCap=${OVER.bldCap}`);
  tops.push(OVER.bldCap);
  t('建物高度的每一個生成點都夾 OVER.bldCap',
    count(bioCode, /Math\.min\([^\n]*OVER\.bldCap\)/g) >= 4,
    `${count(bioCode, /OVER\.bldCap/g)} 處`);

  // ---- 守門線:**吃建物高度的門檻 MUST 在上限之下**(2026-08-09 補) ----
  // 這一條是本檔存在以來唯一一次真的抓到東西的那個坑的補救:2026-08-08 的 `OVER.bldCap`
  // 2 倍(52m)與 `biomes.js` 手寫的「高層商辦」門檻 55m 是**兩個 PR 各自綠燈**、合起來
  // 才壞的語意衝突 —— 建物高度上限一夾,`b.h > 55` 就再也不成立 ⇒ 整棟量體庫節點
  // (`building/mass_a`·`mass_b`)一顆都擺不出去、退縮頂塔剪影整個消失,而 intake、
  // audit_siteplan(連 `--break-mass` 反向驗證都照樣紅)、對照台孤兒數 **全部是綠的**。
  // 門檻**從原文抽**而不是手抄:之後有人再加一條 `b.h > N`,這裡自動跟著驗。
  {
    const th = [...bioCode.matchAll(/\bb\.h\s*>\s*(\d+(?:\.\d+)?)/g)].map((m) => +m[1]);
    const mn = /MIN_H:\s*(\d+(?:\.\d+)?)/.exec(bioCode);
    if (mn) th.push(+mn[1]);
    const dead = [...new Set(th)].filter((v) => v >= CAP).sort((a, b) => a - b);
    t(`吃建物高度的門檻 ${new Set(th).size} 個全數 < 物件上限 ${CAP}m(否則那條規則永遠不成立)`,
      !dead.length && th.length >= 3, dead.length ? `構不到:${dead.join(' / ')}m` : `只抽到 ${th.length} 個`);
  }

  // 神木(群落 base 的上下端 × 株高變異的上下端)
  const bad = [];
  for (const [k, def] of Object.entries(GIANT_DEFS)) {
    for (const base of [0.75 * 1.35, 1.10 * 1.35]) {
      for (const v of [0.72, 1.35]) {
        const e = chk('神木', k, objScaleFit(base * v, def.h, base * 1.35) * def.h);
        if (e) bad.push(e);
      }
    }
    const e2 = chk('邊界神木', k, objScaleFit(1.15, def.h, 1.15) * def.h);
    if (e2) bad.push(e2);
  }
  t(`神木 ${Object.keys(GIANT_DEFS).length} 款 × 群落/株高上下端全數 ≤ 上限`, !bad.length, bad.join(', '));

  // 巨岩(名岩逐款 + 合成岩;cell.sf ≤ 1)
  const badM = [];
  for (const [k, def] of Object.entries(MEGALITHS)) {
    const sMax = def.s[1] * OVER.mega;
    for (const s of [def.s[0] * OVER.mega, sMax]) {
      const e = chk('巨岩', k, objScaleFit(s, def.col.h, sMax) * def.col.h);
      if (e) badM.push(e);
    }
  }
  for (const H of [20, 60, 140]) {                 // 合成岩:H 逐顆生成才知道,掃一段值域
    const e = chk('合成岩', `H${H}`, objScaleFit(1.4 * OVER.mega, H, 1.4 * OVER.mega) * H);
    if (e) badM.push(e);
  }
  t(`巨岩 ${Object.keys(MEGALITHS).length} 款(+合成岩)全數 ≤ 上限`, !badM.length, badM.join(', '));

  // 地標(標稱高以 LANDMARK_COL 為下界;真品另以 Box3 實測,只會更嚴)
  const badL = [];
  for (const [k, c] of Object.entries(LANDMARK_COL)) {
    const e = chk('地標', k, objScaleFit(OVER.lm * 1.15, c.h, OVER.lm * 1.15) * c.h);
    if (e) badL.push(e);
  }
  t(`地標 ${Object.keys(LANDMARK_COL).length} 款全數 ≤ 上限`, !badL.length, badL.join(', '));
  t('地標的標稱高**實測**而不是讀手寫的 LANDMARK_COL.h(細長尖頂會低報)',
    /objScaleFit\(sc, new THREE\.Box3\(\)\.setFromObject\(g\)\.max\.y/.test(bioCode));

  // 語意化地標:結構性低於上限(不需夾制 —— 這一條是「將來加高了就會紅字」的守門線)
  const badB = Object.entries(BEACON_KINDS).filter(([, v]) => v.h > CAP).map(([k, v]) => `${k} ${v.h}`);
  t(`語意化地標 ${Object.keys(BEACON_KINDS).length} 款結構性低於上限(最高 ${Math.max(...Object.values(BEACON_KINDS).map((v) => v.h))}m)`,
    !badB.length, badB.join(', '));

  // 一般植被:標稱高遠在上限之下(放置縮放 ≤ 2 仍安全)
  const vegTop = Math.max(...Object.entries(VEG_DEFS).map(([k, d]) => spanOf(d) * (VEG_SCALE[k] || 1)));
  t(`一般植被最高標稱 ${vegTop.toFixed(1)}m,即使放置縮放 ×2 仍在上限之下`, vegTop * 2 <= CAP);

  // 夾制真的在做事:最大的那一族恰好貼齊上限(不是「剛好全部本來就矮」)
  t('最高的物件恰好貼齊上限(夾制生效的證據)', near(Math.max(...tops), CAP, 1e-6),
    `max=${Math.max(...tops).toFixed(2)} cap=${CAP}`);
}

// ---------------- Ⅳ 分布版:同一條規則,而且保留相對變異 ----------------
console.log('\nⅣ objScaleFit:壓縮率由 objScaleCap 推導,相對變異逐位元保留');
{
  t('壓縮率 = objScaleCap 套在最大縮放上的比值(獨立重算)',
    [[0.8, 110, 2.0], [1.2, 30, 1.4], [0.3, 5, 0.5]].every(([s, h, sM]) =>
      near(objScaleFit(s, h, sM), s * (objScaleCap(sM, h) / sM))));
  t('上限之內(不需壓縮)⇒ 逐位元原樣放行',
    near(objScaleFit(1.2, 10, 1.5), 1.2) && near(objScaleCap(1.2, 10), 1.2));
  t('頂端恰好貼齊上限', near(objScaleFit(2.0, 110, 2.0) * 110, objHeightMax()));
  t('相對變異保留:同一組抽樣壓縮前後的比值不變',
    near((objScaleFit(0.8, 110, 2.0) / objScaleFit(2.0, 110, 2.0)), 0.8 / 2.0));
  // 反例存證:抽得到的**每一個**縮放都超過上限時,硬夾把整組壓成同一個高度、分布版不會。
  // 神木正是這個情形(公稱 72~110m、縮放 0.73~2.0)—— 這一條就是「森林裡每一株一樣高」
  // 那個舊症狀的量測版。用一組必定全數超標的合成輸入,不吃現役數值的漂移。
  {
    const H = objHeightMax() * 3, lo = 0.5, hi = 1.5;   // lo × H 已經是上限的 1.5 倍
    t('硬夾:抽樣全數超標 ⇒ 高矮壓成同一個值(反例存證)',
      near(objScaleCap(lo, H) * H, objScaleCap(hi, H) * H));
    t('分布版:同一組輸入仍然高矮有別,且頂端恰好貼齊上限',
      objScaleFit(lo, H, hi) * H < objScaleFit(hi, H, hi) * H
      && near(objScaleFit(hi, H, hi) * H, objHeightMax()));
  }
  t('標稱高不明(≤0)一律原樣放行(原則 6)',
    objScaleCap(1.7, 0) === 1.7 && objScaleFit(1.7, 0, 2) === 1.7 && objScaleFit(1.7, 10, 0) === objScaleCap(1.7, 10));
  t('sMax 給錯(小於 s)也不會放大', objScaleFit(2, 110, 1) <= 2);
}

// ---------------- Ⅴ 唯一縫 ----------------
console.log('\nⅤ 單一縫:天花板只有一份、消費端數得出來');
{
  t('客戶端只有 `_ceilY` 一份實作', count(gameCode, /\n  _ceilY\(\)\s*\{/g) === 1);
  t('公式只在 `_ceilY` 裡取一次(消費端不得自己重算)',
    count(gameCode, /worldCeilY\(/g) === 1);
  t('消費端恰三處(飛行夾制 / 上帝視角天花板 / 觀戰起始高度)',
    count(gameCode, /this\._ceilY\(\)/g) === 3, `${count(gameCode, /this\._ceilY\(\)/g)} 處`);
  t('飛行夾制吃 `_ceilY`,且既有的離地相對上限仍在(兩者取嚴者)',
    /Math\.min\(gy \+ 320, this\._ceilY\(\), this\.pos\.y\)/.test(gameCode));
  t('上帝視角有天花板夾制(且不低於地板)',
    /const ceil = this\._ceilY\(\);/.test(gameCode) && /this\.pos\.y = Math\.max\(floor, ceil\)/.test(gameCode));
  t('平均海拔只在 terrain.js 算一次並回傳',
    count(strip(terrSrc), /avgH \/= N \* N;/g) === 1 && /maxH, avgH,/.test(terrSrc));
  t('伺服器沒有第二份天花板(位置本就客戶端權威,同 FLIGHT 全族)',
    !/worldCeilY|objHeightMax/.test(simCode) && !/worldCeilY|objHeightMax/.test(botsCode));
  t('物件夾制的每一個生成點都經 data.js 的縫(神木×2 / 巨岩×2 / 地標×1)',
    count(bioCode, /objScaleFit\(/g) === 5, `${count(bioCode, /objScaleFit\(/g)} 處`);
  t('biomes.js 沒有手寫的高度上限常數(舊制 bldCap: 170 不得復辟)',
    !/\b170\b/.test(strip(bioSrc).slice(0, bioSrc.indexOf('const CELL'))) && !/bldCap:\s*\d/.test(strip(bioSrc)));

  // 行為直測:執行真品 `_ceilY` 原文
  const mk = (terrain) => {
    const self = { terrain, _worldCeil: null };
    const fn = new Function('worldCeilY', `return { ${grabMethod(gameSrc, '_ceilY').trim()} };`)(worldCeilY);
    return fn._ceilY.call(self);
  };
  t('`_ceilY` 吃地形統計(avgH / maxH)算出天花板',
    near(mk({ avgH: 30, maxH: 45 }), worldCeilY(30, 45)));
  t('缺 avgH ⇒ 退回以最高海拔為兩項的輸入(仍是有限值)',
    near(mk({ maxH: 45 }), worldCeilY(45, 45)));
  t('沒有地形統計(程序生成備援)⇒ 不設限,MUST NOT 變成 0 把玩家壓在地上(原則 6)',
    mk({}) === Infinity && mk(null) === Infinity);
  t('同一場只算一次(快取;一場一個天花板)', (() => {
    const self = { terrain: { avgH: 0, maxH: 0 }, _worldCeil: null };
    const fn = new Function('worldCeilY', `return { ${grabMethod(gameSrc, '_ceilY').trim()} };`)(worldCeilY);
    const a = fn._ceilY.call(self);
    self.terrain = { avgH: 9999, maxH: 9999 };     // 之後把地形換掉也不會改變已定案的天花板
    return fn._ceilY.call(self) === a;
  })());
}

// ---------------- Ⅵ NPC / bot / 彈道結構性收在天花板之下 ----------------
console.log('\nⅥ 沒有客戶端物理那半:靠「本來就低於最小餘裕」');
{
  const ROOM = TOW * WORLD_H.CEIL_PEAK_F;          // 天花板 − 地表 的下界(見 Ⅱ)
  const cruise = JSON.parse((/const CRUISE_ALT = (\{[^}]*\})/.exec(strip(botsSrc)) || [])[1]
    .replace(/(\w+):/g, '"$1":'));
  t(`bot 巡航高度上限 ${cruise.max}m < 最小餘裕 ${ROOM}m(bot 沒有客戶端 ⇒ 沒有那道夾制)`,
    cruise.max < ROOM);
  t(`NPC 直升機巡航 ${GAME.HELI_ALT}m / 防空門檻 ${GAME.AA_MIN_ALT}m 同樣在餘裕之內`,
    GAME.HELI_ALT < ROOM && GAME.AA_MIN_ALT < ROOM);
  t(`極音速飛彈爬升頂點 ${hyperApex().toFixed(0)}m < 平原場地的餘裕 ${TOW * WORLD_H.CEIL_AVG_F}m`,
    hyperApex() < TOW * WORLD_H.CEIL_AVG_F,
    '（伺服器腳本航線刻意不夾:半路截斷會讓兩端插不出同一條拋物線,原則 10）');
  t('主堡/砲塔量體本身低於物件上限(工事不是「物件」但照樣不該頂到天花板)',
    Math.max(TARGET_H.tower, TARGET_H['base:SWARM'], TARGET_H['base:STEEL']) <= objHeightMax());
}

if (BREAK_CEIL) {
  console.log('\n（--break-ceil:天花板改成手寫常數,Ⅰ・Ⅱ MUST 紅字）');
}
console.log(`\n${fail === 0 ? '🎉' : '❌'} 世界高度上限稽核:${pass} 通過 / ${fail} 失敗`);
process.exit(fail === 0 ? 0 : 1);
