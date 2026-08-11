// ============ 自身強化型大招:補償 + 跟隨玩家的輔助機隊 ============
// 2026-08-06 定案:機種絕招(飽和攻擊 / 集束炸彈 / 極音速飛彈)整組退場,長按右鍵改成招式手勢
// (一般 → 小招 / 狙擊 → 大招)。大招已載具化的 23 台等於把長按換成了大招;剩下 9 台
// **純自身型**大招沒有載具可換 ⇒ 把被移除的那份預算折進大招本身(data.js SELF_ULT)。
// 2026-08-07 定案(本檔 Ⅴ):那 9 台改由**跟隨玩家的輔助機隊**供輸(data.js ULT_SUPPORT)——
//   某些招式派多架、多架的狀態**疊加**;持續型的機隊耐久 > 間斷型 > 瞬發型,dur 越久越硬。
//
// 防的病灶(全部無錯誤訊息):
//   ・當量手寫一個倍率 ⇒ 之後改任一角色的 `ult.cd` 或 `SPECIAL.BASE`,補償當場失準,
//     而畫面上只表現成「這幾台好像變弱了」;
//   ・補償算成「再乘一層」而不是**增額** ⇒ 1.35 × 2.35 = 3.17 而不是 2.35(多發一份預算);
//   ・載具化的 23 台也吃到補償 ⇒ 長按換成大招**又**領一份折算(預算雙重領);
//   ・破隱爆發窗在 `_castEffect` 就開 ⇒ 躲著不開火也在燒那一秒(玩家只覺得「爆發沒生效」);
//   ・`brk`(挨一發就結束)漏掉某一條扣血路徑 ⇒ 那個來源的傷害打不斷超載;
//   ・夾制把推導值削掉卻不記錄 ⇒ 「補償是推導的」這句話對那幾台其實不成立(靜默截斷)。
//   ・疊加寫成「逐架各推一筆 mods」⇒ 被 `_buffMul` **相乘**((1+(m−1)/N)^N ≠ m):全員在線時的
//     效果高於舊制,而且只在「剛好幾架活著」那一瞬對得上帳;
//   ・輔助機每增減一架就把時窗 `until` 重新從當下起算 ⇒ 這一招一路展期,永遠不結束;
//   ・一次性的部分(復活 / 解除異常 / 彈匣全滿 / 無霧視野)跟著重放 ⇒ 同一次施放領好幾份;
//   ・機隊全滅卻沒撤掉不住在 mods 的二元狀態(匿蹤 / 免裝填)⇒ 「輔助機都被打下來了還是隱形」;
//   ・投放腿的到期判定排在推進之前 ⇒ 瞬發型(dur = 0)在 tick 量化那一格被收掉 = **永遠交付不到**。
//
// 跑法:`node tools/audit_self_ult.mjs`
//   反向驗證(原則 9;對應條目 MUST 立刻紅字,否則等於沒驗到):
//     `--break-eq`    selfUltEq 改成手寫常數(不再隨 cd / 預算走)⇒ Ⅰ 紅
//     `--break-alpha` 破隱窗改在 `_castEffect` 就開(而不是開火現形那一刻)⇒ Ⅲ・Ⅳ 紅
//     `--break-brk`   `_damage` 不再呼叫 `_breakOnHit`(超載打不斷)⇒ Ⅲ・Ⅳ 紅
//     `--break-stack` 疊加改成相乘(mf 退化成恆等)⇒ Ⅴ 紅
//     `--break-tempo` 節奏係數全部 1(持續/間斷/瞬發同耐久)⇒ Ⅴ 紅
// 退出碼:0 = 全綠;1 = 有紅字
import { mkdtempSync, writeFileSync, copyFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { pathToFileURL } from 'node:url';
import { readSrc, grabMethod } from './audit_src.mjs';

const ARGV = new Set(process.argv.slice(2));
const BREAK_EQ = ARGV.has('--break-eq');
const BREAK_ALPHA = ARGV.has('--break-alpha');
const BREAK_BRK = ARGV.has('--break-brk');
const BREAK_STACK = ARGV.has('--break-stack');
const BREAK_TEMPO = ARGV.has('--break-tempo');

let pass = 0, fail = 0;
const ok = (c, msg) => { c ? pass++ : (fail++, console.error(`  ✗ ${msg}`)); };
const sec = (t) => console.log(`\n=== ${t} ===`);
/** 逐行剝行末註解(單一縫計數:註解裡提到的名字不算一處實作) */
const strip = (s) => s.split('\n').map((l) => l.replace(/\/\/.*$/, '')).join('\n');
const count = (s, re) => (strip(s).match(re) || []).length;
const near = (a, b, e = 1e-9) => Math.abs(a - b) <= e;

const G = readSrc('public', 'js', 'game.js');
const L = readSrc('tools', 'lanesim.mjs');
const DSRC = readSrc('public', 'js', 'data.js');

/** 反向驗證的改壞規則:MUST 真的改到東西(沒改到 = 旗標成了 no-op,反向驗證假綠) */
const bust = (src, re, to, tag) => {
  const next = src.replace(re, to);
  if (next === src) throw new Error(`反向驗證 ${tag}:原文沒有匹配到目標,改壞規則已失效`);
  return next;
};

// ---- 資料層 / 伺服器層:改壞旗標走「改壞副本再 import」(與真品同一份原文,只動目標那一行)----
let d, S = readSrc('server', 'sim.js'), BattleSim;
{
  const dirty = BREAK_EQ || BREAK_ALPHA || BREAK_BRK || BREAK_STACK || BREAK_TEMPO;
  if (!dirty) {
    d = await import('../public/js/data.js');
    ({ BattleSim } = await import('../server/sim.js'));
  } else {
    const dir = mkdtempSync(join(tmpdir(), 'svs-selfult-'));
    let ds = DSRC;
    if (BREAK_EQ) {
      ds = bust(ds, /return specialBudget\(abil\) \* SELF_ULT\.REALIZED_F \* tierVal\(a\.cd, lvl\) \/ SPECIAL_CD_S;/,
        'return 250;', '--break-eq');
    }
    if (BREAK_ALPHA) {
      S = bust(S, /if \(A\.add\?\.fx === 'alpha' && once\) \{ h\.alphaX = B\.alphaX; h\.alphaArm = this\.t \+ A\.dur; \}/,
        "if (A.add?.fx === 'alpha' && once) { h.mods.push({ k: 'dmg', m: B.alphaX, until: this.t + SELF_ULT.ALPHA_S }); }",
        '--break-alpha');
    }
    if (BREAK_BRK) {
      S = bust(S, /\n      this\._breakOnHit\(t\);[^\n]*/, '', '--break-brk');
    }
    if (BREAK_STACK) {
      // 疊加退化成「每一架都給整份」⇒ 撤下再放的份額失效(= 逐架相乘的等價症狀:全員在線正常、
      // 少一架卻仍是滿倍率)
      S = bust(S, /const mf = \(m\) => 1 \+ \(m - 1\) \* frac;[^\n]*/, 'const mf = (m) => m;', '--break-stack');
    }
    if (BREAK_TEMPO) {
      ds = bust(ds, /export const supportTempoF = \(tempo\) =>\n[^;]*;/,
        'export const supportTempoF = () => 1;', '--break-tempo');
    }
    writeFileSync(join(dir, 'data.js'), ds);
    copyFileSync(join(process.cwd(), 'public', 'js', 'botPolicy.js'), join(dir, 'botPolicy.js'));
    // sim.js 從暫存目錄 import 時 `../public/js/data.js` 要指得到改壞副本 ⇒ 一併鏡射目錄結構
    const pub = join(dir, 'public', 'js'), srv = join(dir, 'server');
    const { mkdirSync } = await import('node:fs');
    mkdirSync(pub, { recursive: true }); mkdirSync(srv, { recursive: true });
    writeFileSync(join(pub, 'data.js'), ds);
    copyFileSync(join(process.cwd(), 'public', 'js', 'botPolicy.js'), join(pub, 'botPolicy.js'));
    writeFileSync(join(srv, 'sim.js'), S);
    d = await import(pathToFileURL(join(pub, 'data.js')).href);
    ({ BattleSim } = await import(pathToFileURL(join(srv, 'sim.js')).href));
    process.on('exit', () => { try { rmSync(dir, { recursive: true, force: true }); } catch { /* 清不掉不擋驗證 */ } });
  }
}

const CHS = Object.keys(d.CHARACTERS);
const SELF = CHS.filter((c) => !d.ultDelivered(c));
const CONV = CHS.filter((c) => d.ultDelivered(c));
const AB = (l = 1, h = 1) => ({ light: l, heavy: h });

// ============================================================
sec('Ⅰ 當量推導(MUST NOT 手寫)');
{
  ok(SELF.length === 9, `純自身型 9 台(實得 ${SELF.length}:${SELF.join(' ')})`);
  ok(CONV.every((c) => d.selfUltEq(c, 1, AB()) === 0),
    '載具化的 23 台當量恆 0(長按已經換成大招,MUST NOT 重複補)');
  ok(SELF.every((c) => d.selfUltEq(c, 1, AB()) > 0), '未載具化的 9 台當量全 > 0');

  // 三個自變數各自單調:CD 越長帶回越多份、預算越大帶回越多、機種絕招 CD 越短要帶回越多份
  const s04 = (lvl) => d.selfUltEq('s04', lvl, AB());
  ok(d.selfUltEq('s04', 1, AB(4, 4)) > d.selfUltEq('s04', 1, AB(1, 1)),
    '當量隨武器綜合等級(= specialBudget)遞增');
  const cds = SELF.map((c) => [d.tierVal(d.CHARACTERS[c].ult.cd, 1), d.selfUltEq(c, 1, AB())]);
  ok(cds.every(([cd, eq]) => near(eq, d.specialBudget(AB()) * d.SELF_ULT.REALIZED_F * cd / d.SPECIAL_CD_S)),
    '當量 = 預算 × 實得率 × (大招 CD ÷ 機種絕招 CD)—— 逐台獨立重算比對');
  // 當量正比於**這一招自己的 CD**:大招轉得越快,一次要帶回的機種絕招份數就越少。
  // s04 的 cd 階梯是 [70, 60, 50](升級越快)⇒ 當量 MUST 跟著遞減,而不是「升級就變多」。
  ok(s04(3) < s04(1) && near(s04(3) / s04(1), d.tierVal(d.CHARACTERS.s04.ult.cd, 3) / d.tierVal(d.CHARACTERS.s04.ult.cd, 1)),
    '當量正比於大招 CD(cd 階梯一改自己跟著走)');

  // 推導不手寫:定義式裡不得出現任何數字字面值(常數一律走 SELF_ULT / SPECIAL_CD_S)
  const eqSrc = (strip(DSRC).match(/export const selfUltEq = [\s\S]*?\n\};/) || [''])[0];
  ok(/specialBudget\(abil\)/.test(eqSrc) && /SELF_ULT\.REALIZED_F/.test(eqSrc)
    && /SPECIAL_CD_S/.test(eqSrc) && !/[^.\w]\d+(\.\d+)?\s*[*/]/.test(eqSrc),
    'selfUltEq 由 specialBudget / REALIZED_F / SPECIAL_CD_S 推導,式子裡沒有手寫倍率');
  ok(/export const SPECIAL_CD_S = SQUAD\.KAMI\.CD_S;/.test(DSRC)
    && near(d.SPECIAL_CD_S, d.SQUAD.KAMI.CD_S) && near(d.SPECIAL_CD_S, d.DECOY.CD_S)
    && near(d.SPECIAL_CD_S, d.HYPER.CD_S),
    '機種絕招 CD 取自常數且三招同值(SPECIAL_CD_S 是唯一縫)');
}

// ============================================================
sec('Ⅱ 兌現形式與夾制(逐台;夾到上限 MUST 講出來)');
{
  // 中性:載具化角色的 boost 三欄全中性 ⇒ _castEffect 對它們逐位元不動
  ok(CONV.every((c) => {
    const B = d.selfUltBoost(c, 1, AB());
    return B.dmgMul === 0 && B.heal === 0 && B.alphaX === 1;
  }), '載具化的 23 台 boost 恆中性(dmgMul 0 / heal 0 / alphaX 1)⇒ 效果結算逐位元不受影響');
  ok(d.selfUltBoost('__nope__', 1, AB()).alphaX === 1, '未知角色回中性值(不炸)');

  // 逐 fx 分派:heal → heal 欄、stealth → alphaX、buff+mul.dmg → dmgMul、重設計三台 → 全中性
  const byFx = (c) => d.CHARACTERS[c].ult.fx;
  for (const c of SELF) {
    const B = d.selfUltBoost(c, 1, AB()), fx = byFx(c);
    const u = d.CHARACTERS[c].ult;
    const want = fx === 'heal' ? (B.heal > 0 && B.dmgMul === 0 && B.alphaX === 1)
      : fx === 'stealth' ? (B.alphaX > 1 && B.heal === 0 && B.dmgMul === 0)
        : (fx === 'buff' && u.mul?.dmg) ? (B.dmgMul > 0 && B.heal === 0 && B.alphaX === 1)
          : (B.dmgMul === 0 && B.heal === 0 && B.alphaX === 1);
    ok(want, `${c}(${fx})的補償走對通道`);
  }
  // 重新設計的三台:效果本身即補償,MUST NOT 再疊乘數(否則同一份預算領兩次)
  for (const c of ['s12', 't02', 'm04']) {
    const B = d.selfUltBoost(c, 1, AB());
    ok(B.dmgMul === 0 && B.heal === 0 && B.alphaX === 1,
      `${c}(重新設計)不再另加乘數 —— 效果本身就是補償`);
  }
  // 治療型:增額 = 當量本身(治療 X 點 = 抵銷 X 點傷害,等價可推導)
  ok(near(d.selfUltBoost('s11', 1, AB()).heal, d.selfUltEq('s11', 1, AB())),
    's11 治療增額 = 當量本身(1:1 等價)');

  // 夾制:兩個上限都夾得住,而且**頂到上限的逐台講出來**(靜默截斷 = 「推導」那句話不成立)
  const capped = { dmg: [], alpha: [] };
  for (const c of SELF) for (const lvl of [1, 2, 3]) {
    const B = d.selfUltBoost(c, lvl, AB());
    ok(B.dmgMul <= d.SELF_ULT.MUL_MAX + 1e-9 && B.alphaX <= d.SELF_ULT.ALPHA_MAX + 1e-9,
      `${c} Lv${lvl} 夾在上限內`);
    if (lvl === 1 && near(B.dmgMul, d.SELF_ULT.MUL_MAX)) capped.dmg.push(c);
    if (lvl === 1 && near(B.alphaX, d.SELF_ULT.ALPHA_MAX)) capped.alpha.push(c);
  }
  console.log(`   ⓘ Lv1 頂到夾制上限:mul.dmg ${capped.dmg.join('/') || '無'}`
    + ` / alphaX ${capped.alpha.join('/') || '無'} —— 這幾台的補償**不是**完整推導值,是被上限截斷後的值`);
  // 夾制真的在做事(而不是剛好都沒超過):現役角色就已經頂到上限。
  // **這是特性也是警訊**:頂到上限的那幾台,補償不再是完整推導值 ⇒ 改 REALIZED_F 對它們無感,
  // 要動它們只能動 MUL_MAX / ALPHA_MAX 或兌現形式本身。
  ok(capped.dmg.length > 0, `MUL_MAX 對現役角色是**生效中**的夾制(${capped.dmg.join('/')})`);
  ok(capped.alpha.length > 0, `ALPHA_MAX 對現役角色是**生效中**的夾制(${capped.alpha.join('/')})`);
  // 預算灌爆(只抬輕武器等級 ⇒ 只抬預算不抬重武器 DPS)一定夾得住
  ok(near(d.selfUltBoost('t06', 1, AB(9, 1)).dmgMul, d.SELF_ULT.MUL_MAX),
    '預算灌爆時 dmgMul 夾在 MUL_MAX');
  // DPS 取重武器(輕武器 DPS 低會把倍率整批推到夾制上限)
  ok(/heroWeapon\(ch, 'heavy'/.test(strip(DSRC).match(/export const selfUltDps[\s\S]*?\n\};/)[0]),
    'selfUltDps 取**重武器**持續 DPS(大招開窗那幾秒玩家打的就是它)');
  ok(/weaponDps\(w\)/.test(DSRC), '持續 DPS 走 weaponDps 單一縫(MUST NOT 手抄彈匣週期)');
}

// ============================================================
sec('Ⅲ 單一縫(原文)');
{
  // 倍率/治療增額只在 _castEffect 取一次
  ok(count(S, /selfUltBoost\(/g) === 1, `sim 只在一處取 boost(實得 ${count(S, /selfUltBoost\(/g)})`);
  const ce = grabMethod(S, '_castEffect');
  ok(/selfUltBoost\(h\.ch, h\.abil\?\.ult \|\| 1, h\.abil\)/.test(ce) && /A\.id === 'ult'/.test(ce),
    '_castEffect 是唯一取用點,而且只給大招(小招不吃補償)');
  ok(!/selfUltBoost|selfUltEq/.test(strip(G)),
    '客戶端 MUST NOT 自己算一份補償(算出兩個數字 = 「HUD 說 ×2.3、實際掉血 ×1.35」)');
  ok(count(L, /selfUltBoost\(/g) === 1,
    '前線交戰模型也只取一次(bal 說平衡、打起來不是 ⇐ 模型自己算一份)');
  // 增額語意:相加不是相乘
  ok(/const mm = k === 'dmg' \? m \+ B\.dmgMul : m;/.test(strip(ce)),
    '補償是**增額**(1.35 + 1.00 = 2.35),MUST NOT 再乘一層');
  ok(/const healAmt = A\.heal \+ B\.heal;/.test(strip(ce)), '治療同樣是增額');

  // 破隱爆發窗:_castEffect 只上膛,開窗在 _gateFire 的「開火現形」那一行
  ok(/h\.alphaX = B\.alphaX; h\.alphaArm = this\.t \+ A\.dur;/.test(strip(ce)),
    '_castEffect 對 alpha 只**上膛**(alphaArm),不開窗');
  const gf = strip(grabMethod(S, '_gateFire'));
  ok(/h\.mods\.push\(\{ k: 'dmg', m: h\.alphaX \|\| 1, until: now \+ SELF_ULT\.ALPHA_S \}\);/.test(gf)
    && gf.indexOf('alphaArm') < gf.indexOf("h.stealthUntil = 0"),
    '窗開在 _gateFire 的開火現形那一刻,且排在 `stealthUntil = 0` **之前**');
  ok(count(S, /SELF_ULT\.ALPHA_S/g) === 1, '爆發窗長度只有一個消費端');

  // 免裝填:補滿 MUST 排在「打空 → 開始填彈」之前
  ok(/if \(h\.ammo\[id\] <= 0 && \(h\.noReloadUntil \|\| 0\) > now\) h\.ammo\[id\] = def\.mag;/.test(gf),
    '_gateFire:免裝填時窗內見底就地補滿');
  ok(gf.indexOf('noReloadUntil') < gf.indexOf('reloadUntil[id] = now - back'),
    '補滿排在「推進填彈計時器」之前(排後面 = 免裝填等於沒有)');
  // 小隊共用:彈匣只有一份,免裝填/破隱窗逐機體各記一份就會出現主視野機與僚機分家
  for (const k of ['noReloadUntil', 'alphaArm', 'alphaX']) {
    ok(new RegExp(`'${k}'`).test(S.slice(0, S.indexOf('// ---- tick 內加速結構'))),
      `${k} 進 SQUAD_SHARED(小隊共用,MUST NOT 逐機體各記一份)`);
  }
  // brk:判定只住 _damage 的英雄分支(散出去 = 「有些傷害來源不會打斷」)
  ok(count(S, /_breakOnHit\(/g) === 2, `_breakOnHit:1 定義 + 1 呼叫(實得 ${count(S, /_breakOnHit\(/g)})`);
  ok(/this\._breakOnHit\(t\);/.test(strip(grabMethod(S, '_damage'))), '_damage 的英雄分支呼叫 _breakOnHit');
  // heroAbility 的四個新欄位
  for (const k of ['regen', 'cleanse', 'revive', 'brk']) {
    ok(new RegExp(`${k}:`).test(strip(DSRC).match(/export function heroAbility[\s\S]*?\n\}/)[0]),
      `heroAbility 解析 ${k} 欄位`);
  }
  // 異常免疫:三條施加路徑都要判(漏一條 = 那一種控場照樣吃得到)
  ok(count(S, /_buffVal\((e|t), 'ccImm'\) > 0/g) === 3,
    `ccImm 在三條施加路徑都判(_applyHitEmp / emp 分支 / _applyCC;實得 ${count(S, /'ccImm'\) > 0/g)})`);
}

// ============================================================
sec('Ⅳ 行為直測(真 BattleSim)');
{
  const mkCfg = () => {
    const A = [25.0330, 121.5654];
    const D = 1600, R = 6371000;
    const realD = D * d.MAPGEO.REAL_SCALE;
    const B2 = [A[0] + realD / R * 180 / Math.PI, A[1]];
    const mid = [(A[0] + B2[0]) / 2, (A[1] + B2[1]) / 2];
    const pts = [];
    for (let t = 0; t <= 1.001; t += 0.05) pts.push([A[0] + (B2[0] - A[0]) * t, A[1]]);
    const sizeM = D / (0.85 * Math.SQRT2);
    return {
      center: { lat: mid[0], lng: mid[1] }, bases: { SWARM: A, STEEL: B2 }, lanes: [pts],
      sizeM, diagM: sizeM * Math.SQRT2, distM: D, geoScaleVer: d.MAPGEO.GEO_SCALE_VER,
      maxOverlap: 0.05, synthetic: true, placeName: '稽核戰區',
      env: { season: 'summer', time: 'day', weather: 'clear' },
    };
  };
  // 施放者站在兵線之外:2026-08-07 起要 tick 到輔助機就位,站在兵線上量到的是「小兵打不打得到
  // 輔助機」而不是招式本身(而且 t02 的 brk 會被路過的小兵提前打斷)。
  const hero = (sim, side, pid, ch) => {
    const h = sim.addHero(side, pid, ch);
    h.x = 400; h.z = 0; h.mp = 999; h.abil.ult = 1;
    return h;
  };
// 2026-08-07:自身強化型大招不再瞬發 —— 先飛完投放腿才供輸 ⇒ 行為直測 MUST 推到就位。
  // 第二輪(大招改從最近的砲塔/主堡召喚)之後,投放腿是**實距**而不是固定值 ⇒ MUST NOT 再用
  // 「supportLegS / dt」那種固定格數(工事離施放者多遠就飛多久;寫死格數會在施放者往前壓的
  // 場景上假紅)。上限用 kami 的 TTL 當保險 —— 真的飛不到才會走到那裡。
  const DEPLOY_N = Math.ceil(d.SQUAD.KAMI.TTL_S / 0.125) + 4;
  const armed = (sim) => [...sim.ents.values()].some((e) => e.supG && e.phase === 'escort');
  const deploy = (sim, until = null) => {
    const done = until || (() => armed(sim) || ![...sim.ents.values()].some((e) => e.supG));
    for (let i = 0; i < DEPLOY_N && !done(); i++) sim.tick(0.125);
  };
  /** 目前在空的輔助機 */
  const craftOf = (sim, pid) => [...sim.ents.values()].filter((e) => e.supG && e.pid === pid);

  // ① rally(s12「滿天星座」):全隊回復加速 + 解除並免疫異常 + 倒數中的隊友原地半血復活
  {
    const sim = new BattleSim(mkCfg());
    const h = hero(sim, 'SWARM', 'a1', 's12');
    const mate = hero(sim, 'SWARM', 'a2', 's11');
    mate.x = 300; mate.z = 40;                       // 離施放者很遠 —— rally 刻意不吃半徑(全隊)
    mate.stunUntil = sim.t + 5; mate.empUntil = sim.t + 5;
    const body = sim._bodies(mate)[0];
    body.dead = true; body.respawnAt = sim.t + 12; body.hp = 0; body.sp = 0;
    const A = d.heroAbility('s12', 'ult', 1);
    sim.heroCast('a1', 'ult');
    deploy(sim);
    ok(!body.dead && body.respawnAt === 0, 'rally:重生倒數中的隊友原地站起來');
    // 就位那一刻半血站起來;之後 regen 會慢慢補上去 ⇒ 下界比對(上界擋掉「整條回滿」)
    ok(body.hp >= Math.max(1, Math.round(body.maxHp * A.revive)) - 1 && body.hp < body.maxHp * (A.revive + 0.25),
      `rally:回場半血(${body.hp.toFixed(0)}/${body.maxHp})`);
    ok(body.invUntil > sim.t, 'rally:復活後有無敵幀(站起來那一瞬不該被同一發爆風再收一次)');
    ok(mate.stunUntil === 0 && mate.empUntil === 0, 'rally:既有異常被解除');
    ok(sim._buffVal(mate, 'ccImm') > 0 && sim._buffMul(mate, 'regen') > 1,
      'rally:期間免疫異常 + 恢復速度倍率(全隊,不吃半徑)');
    // 免疫真的擋得住:再打一次 EMP MUST 無效
    sim._applyHitEmp(h, { emp: 3 }, mate);
    ok(!(mate.empUntil > sim.t), 'rally:免疫期間再施加 EMP 無效');
    // 已經自己回場的隊友不算(只救倒數中的)
    const sim2 = new BattleSim(mkCfg());
    hero(sim2, 'SWARM', 'b1', 's12');
    const m2 = hero(sim2, 'SWARM', 'b2', 's11');
    const b2 = sim2._bodies(m2)[0];
    b2.dead = true; b2.respawnAt = 0;                // 不在倒數中
    sim2.heroCast('b1', 'ult');
    // 2026-08-07:推到就位要 tick,而一般重生流程本來就會在 respawnAt 到期時把人放回場 ⇒
    // 判準改看「有沒有發出 revive 事件」(舊制的 `b2.dead` 會被一般重生洗成假紅)
    let revived = false;
    for (let i = 0; i < DEPLOY_N && !armed(sim2); i++) {
      sim2.tick(0.125);
      revived ||= sim2.events.some((e) => e.e === 'respawn' && e.revive);
    }
    ok(!revived, 'rally:**不在重生倒數中**的隊友不復活(使用者定案的限制)');
  }

  // ② overdrive(t02「同步率 100%」):彈匣全滿 + 免裝填 + 閃避;挨一發即結束
  {
    const sim = new BattleSim(mkCfg());
    const h = hero(sim, 'STEEL', 'a3', 't02');
    const wl = d.heroWeapon('t02', 'light', 1);
    h.ammo.light = 0; h.reloadUntil.light = sim.t + 99;
    sim.heroCast('a3', 'ult');
    deploy(sim);
    ok(h.noReloadUntil > sim.t && !(h.reloadUntil.light > sim.t),
      'overdrive:彈藥/填彈帳清空 + 開啟免裝填時窗');
    ok(sim._buffVal(h, 'evade') > 0, 'overdrive:閃避率加成');
    ok(sim._buffMul(h, 'dmgTaken') < 1, 'overdrive:減傷仍在(mul.dmgTaken)');
    // 時窗內連續開火:打穿好幾個彈匣也 MUST NOT 進填彈窗(發數上限是時窗長度 × 射速,不是彈匣)
    const end = h.noReloadUntil - 0.05;
    let shots = 0, blocked = 0;
    while (sim.t < end) {
      sim.t += 1 / wl.rate + 1e-6;
      if (sim.t >= end) break;
      if (sim._gateFire(h, 'light', wl)) shots++; else blocked++;
    }
    ok(shots > wl.mag && blocked === 0 && !(h.reloadUntil.light > sim.t),
      `overdrive:時窗內連打 ${shots} 發(> 彈匣 ${wl.mag})一次都沒進填彈,擋下 ${blocked} 發`);
    // 挨一發就結束 —— MUST 用**新的一場**驗:上面那個迴圈已經把時鐘推到時窗尾端,
    // 在那裡問「時窗還在不在」恆為否,`_breakOnHit` 拿掉也照樣綠(假綠)。
    {
      const s3 = new BattleSim(mkCfg());
      const h3 = hero(s3, 'STEEL', 'a9', 't02');
      s3.heroCast('a9', 'ult');
      deploy(s3);
      const dur = h3.noReloadUntil - s3.t;
      s3.t += dur / 2;                                 // 時窗正中間,離結束還有一半
      ok(h3.noReloadUntil > s3.t && s3._buffVal(h3, 'evade') > 0, 'overdrive:時窗中段仍生效(對照)');
      s3._damage(h3, 5, null, 0);
      ok(!(h3.noReloadUntil > s3.t) && !(s3._buffVal(h3, 'evade') > 0),
        'overdrive:挨一發即撤銷(免裝填 + 那一批 mods 一起收)');
    }
    // 對照組:沒有 brk 的招式不會被一發打斷
    const sim2 = new BattleSim(mkCfg());
    const h2 = hero(sim2, 'SWARM', 'a4', 's04');
    sim2.heroCast('a4', 'ult');
    deploy(sim2);
    const before = sim2._buffMul(h2, 'dmg');
    sim2._damage(h2, 5, null, 0);
    ok(before > 1 && near(sim2._buffMul(h2, 'dmg'), before),
      's04(無 brk)挨打不受影響 —— `brk` 只作用在標了旗標的招式上');
  }

  // ③ recon(m04「全境盡職調查」):射程加成走 _altRange 這一條縫(每道射程閘門都吃得到)
  {
    const sim = new BattleSim(mkCfg());
    const h = hero(sim, 'SWARM', 'a5', 'm04');
    const dum = sim._add({ kind: 'bunker', side: 'STEEL', x: 200, z: 0, y: 0, hp: 4000 }); delete dum.lane;
    const before = sim._altRange(h, dum);
    sim.heroCast('a5', 'ult');
    deploy(sim);
    const after = sim._altRange(h, dum);
    const A = d.heroAbility('m04', 'ult', 1);
    ok(near(after / before, A.mul.range, 1e-9), `recon:有效射程 ×${A.mul.range}(${before.toFixed(2)} → ${after.toFixed(2)})`);
    ok(sim._buffMul(h, 'speed') > 1 && sim._buffVal(h, 'evade') > 0, 'recon:跑速與閃避同步拉高');
    ok(sim.visionUntil[h.side] > sim.t, 'recon:全隊無霧視野');
    ok(count(S, /this\._buffMul\(shooter, 'range'\)/g) === 1,
      '射程加成只有 _altRange 一個消費端(散到各閘門去乘 = 有些路徑吃不到)');
  }

  // ④ alpha(m08「查無此人」):**開火現形那一刻**才開窗
  {
    const sim = new BattleSim(mkCfg());
    // 側別只用戰區真的有主堡的那兩個(傭兵角色照樣掛得上去 —— 這裡驗的是招式不是陣營)
    const h = hero(sim, 'STEEL', 'a6', 'm08');
    if (!h) { ok(false, 'm08 掛不上戰區'); }
    else {
      const A = d.heroAbility('m08', 'ult', 1);
      const B = d.selfUltBoost('m08', 1, h.abil);
      sim.heroCast('a6', 'ult');
      deploy(sim);
      ok(h.stealthUntil > sim.t && h.alphaArm > sim.t, 'alpha:施放後匿蹤 + 上膛');
      ok(near(sim._buffMul(h, 'dmg'), 1), 'alpha:**還沒開火 ⇒ 窗還沒開**(躲著不打不會燒掉那一秒)');
      const wl = d.heroWeapon('m08', 'light', 1);
      sim.t += 3;                                      // 匿蹤中等了 3 秒
      ok(near(sim._buffMul(h, 'dmg'), 1), 'alpha:等了 3 秒窗仍未開');
      sim._gateFire(h, 'light', wl);                   // 開火 = 現形
      ok(near(sim._buffMul(h, 'dmg'), B.alphaX, 1e-9), `alpha:開火那一刻開窗(×${B.alphaX.toFixed(2)})`);
      ok(h.stealthUntil === 0 && h.alphaArm === 0, 'alpha:現形 + 卸膛(同一次匿蹤只換一個窗)');
      sim.t += d.SELF_ULT.ALPHA_S + 0.01;
      ok(near(sim._buffMul(h, 'dmg'), 1), `alpha:${d.SELF_ULT.ALPHA_S}s 後窗關閉`);
    }
  }

  // ⑤ 未載具化角色的補償真的進到結算(s11 治療 = 基礎 + 增額);載具化角色逐位元不受影響
  {
    const sim = new BattleSim(mkCfg());
    const h = hero(sim, 'SWARM', 'a7', 's11');
    h.hp = 1;
    // 量治療量的兩段 MUST 與戰場火力隔離:`deploy()` 是**真的在跑 tick**,兵波照樣出、火箭兵照樣開火。
    // 2026-08-11 起 NPC 肩射火箭是真的爆炸(逐目標擲閃避的那一版)⇒ 殘血 1 的受測機體會被路過的
    // 濺射掃到,這一段就變成擲骰決定綠不綠(實測 8 跑紅 2)。無敵幀是既有的隔離手段,不改被測邏輯。
    h.invUntil = sim.t + 1e6;
    const A = d.heroAbility('s11', 'ult', 1);
    const B = d.selfUltBoost('s11', 1, h.abil);
    sim.heroCast('a7', 'ult');
    // 瞬發型:四架各交付 1/4 ⇒ 等整隊到齊(第一架到就停 = 只量到四分之一份)
    deploy(sim, () => ![...sim.ents.values()].some((e) => e.supG));
    ok(B.heal > 0 && near(h.hp, Math.min(h.maxHp, 1 + A.heal + B.heal), 0.01),
      `s11 治療 = 基礎 ${A.heal} + 補償 ${B.heal.toFixed(0)}`);
    const sim2 = new BattleSim(mkCfg());
    const h2 = hero(sim2, 'SWARM', 'a8', 's02');       // 載具化(團隊 heal)
    h2.hp = 1;
    sim2.heroCast('a8', 'ult');
    ok(near(h2.hp, 1), '載具化角色:效果由載具抵達時才施放,施放當下不回血(逐位元同載具改制)');
  }
}

// ============================================================
sec('Ⅴ 跟隨玩家的輔助機隊(2026-08-07 使用者定案)');
{
  // ---- Ⅴ-a 分類與機數:推導不手寫 ----
  const TEMPOS = SELF.map((c) => d.selfUltTempo(c));
  ok(TEMPOS.every((t) => t === 'burst' || t === 'pulse' || t === 'sustain'),
    `9 台各有節奏分類(${SELF.map((c, i) => `${c}:${TEMPOS[i]}`).join(' ')})`);
  ok(CONV.every((c) => d.selfUltTempo(c) === null && d.supportN(c) === 1),
    '載具化的 23 台不歸這一段管(tempo 回 null)');
  ok(new Set(TEMPOS).size === 3, '三種節奏在現役角色上都有人(分類不是死碼)');
  // 分類**由 ult 欄位推導**:沒有 dur ⇒ 瞬發、有 regen ⇒ 間斷、其餘 ⇒ 持續(逐台獨立重算)
  ok(SELF.every((c) => {
    const u = d.CHARACTERS[c].ult;
    const want = !(d.tierVal(u.dur ?? 0, 1) > 0) ? 'burst'
      : d.tierVal(u.regen ?? 0, 1) > 0 ? 'pulse' : 'sustain';
    return d.selfUltTempo(c) === want;
  }), '節奏由 ult 欄位推導(逐台獨立重算比對)');
  ok(!/selfUltTempo[\s\S]{0,400}?['"]s\d\d['"]/.test(strip(DSRC)),
    '節奏分類 MUST NOT 手寫角色名冊');
  // 機數:可疊加者依機種分批(同 ultParts 那張表),二元狀態恆單機 —— 使用者「**某些**招式換成多個」
  ok(SELF.every((c) => d.supportN(c) === (d.supportStackable(c) ? d.kindParts(d.charKind(c)) : 1)),
    '機數 = 可疊加 ? 該機種分批數 : 1(與 ultParts 同一張機種表)');
  ok(SELF.some((c) => d.supportN(c) > 1) && SELF.some((c) => d.supportN(c) === 1),
    `「某些」招式換成多架:多機 ${SELF.filter((c) => d.supportN(c) > 1).join('/')}`
    + ` / 單機 ${SELF.filter((c) => d.supportN(c) === 1).join('/')}`);
  ok(!d.supportStackable('m08') && d.supportN('m08') === 1,
    'm08(純二元狀態:匿蹤)不可疊加 ⇒ 單機(「一半的隱形」沒有意義)');
  ok(d.kindParts('drone') === d.SQUAD.KAMI.N && d.kindParts('morph') === d.DECOY.BOMB_MAX
    && d.kindParts('robot') === 1
    && count(DSRC, /kind === 'drone' \? SQUAD\.KAMI\.N/g) === 1,
    'kindParts 是機種分批數的唯一縫(ultParts 與 supportN 同吃)');

  // ---- Ⅴ-b 疊加是加法(核心不變式:全員在線 = 逐位元同舊制)----
  for (const c of SELF) {
    const n = d.supportN(c);
    ok(near(d.supportF(c, n), 1) && near(d.supportF(c, 0), 0),
      `${c}:${n} 架全在線 ⇒ 份額 1(= 舊制效果值)、全滅 ⇒ 0`);
    ok(Array.from({ length: n + 1 }, (_, k) => d.supportF(c, k))
      .every((v, k, a) => k === 0 || v > a[k - 1] - 1e-12), `${c}:份額隨在線架數單調`);
  }
  ok(near(d.supportF('s04', 2), 0.5), 's04 擊落一半 ⇒ 份額 0.5(線性,不是指數)');
  ok(d.supportF('s04', 99) === 1 && d.supportF('s04', -3) === 0, '份額夾在 [0, 1]');

  // ---- Ⅴ-c 耐久:使用者③的兩條 ----
  // 服務窗:同 dur 下 持續 > 間斷 > 瞬發;且對 dur 嚴格遞增(dur = 0 的瞬發除外)
  const F = d.supportTempoF;
  ok(F('sustain') === 1 && F('burst') === 0 && F('pulse') === d.ULT_SUPPORT.PULSE_F,
    '節奏係數:兩端是定義(0 / 1)、中間是旋鈕 PULSE_F');
  ok(F('sustain') > F('pulse') && F('pulse') > F('burst'),
    `持續 > 間斷 > 瞬發(${F('sustain')} > ${F('pulse')} > ${F('burst')})`);
  ok(d.ULT_SUPPORT.PULSE_F > 0 && d.ULT_SUPPORT.PULSE_F < 1,
    'PULSE_F ∈ (0, 1):撐一半仍有交付,但不是撐滿');
  // 同一台角色掃 dur:機隊總耐久對 dur 嚴格遞增(使用者「持續時間越久耐久也越高」)
  {
    const durs = [1, 4, 8, 12, 20];
    // 逐架:投放腿平行(不除以機數)、效果窗串行(除以機數)—— 與 supportHp 同式
    const hpAt = (tempo, dur, n = 4) => d.frontKillHp(d.supportLegS('ult') + F(tempo) * dur / n) * n;
    for (const tempo of ['sustain', 'pulse']) {
      const seq = durs.map((x) => hpAt(tempo, x));
      ok(seq.every((v, i) => i === 0 || v > seq[i - 1]), `${tempo}:dur 越久機隊越硬(${seq.join(' < ')})`);
    }
    for (const dur of durs) {
      ok(hpAt('sustain', dur) > hpAt('pulse', dur) && hpAt('pulse', dur) > hpAt('burst', dur),
        `dur ${dur}s:持續 ${hpAt('sustain', dur)} > 間斷 ${hpAt('pulse', dur)} > 瞬發 ${hpAt('burst', dur)}`);
    }
  }
  // 現役 9 台:機隊總耐久 ≈ frontDps × 服務窗(與機數無關)、逐台 > 0、armor/護盾 0 由生成端保證
  for (const c of SELF) {
    const n = d.supportN(c), tempo = d.selfUltTempo(c);
    const dur = d.tierVal(d.CHARACTERS[c].ult.dur ?? 0, 1);
    const want = d.frontKillHp(d.supportLegS('ult') + F(tempo) * dur / n);
    ok(d.supportHp(c, 1) === want && want > 0,
      `${c}:每架 ${want} = 前線塔位 ${d.frontDps()} DPS ×(投放腿 + ${tempo} 窗 ÷ ${n})`);
    ok(d.supportFleetHp(c, 1) === want * n, `${c}:機隊總耐久 = 每架 × ${n}`);
    ok(d.supportHp(c, 3) >= d.supportHp(c, 1), `${c}:升級不會讓輔助機變脆`);
  }
  // 投放腿是**平行**曝險:MUST NOT 連它也除以機數(除下去 s11 每架只剩一顆子彈的量)
  ok(d.supportHp('s11', 1) > d.frontKillHp(d.supportLegS('ult') / d.supportN('s11')) * 2,
    `瞬發型每架 ${d.supportHp('s11', 1)} 點 ≫ 「整段除以機數」的 ${d.frontKillHp(d.supportLegS('ult') / d.supportN('s11'))} 點`);
  // 推導不手寫:HP 式子只由 frontKillHp / 服務窗 / 機數組成
  {
    const hpSrc = (strip(DSRC).match(/export const supportHp = [\s\S]*?\n\};/) || [''])[0];
    ok(/frontKillHp\(/.test(hpSrc) && /supportLegS\(slot\)/.test(hpSrc) && /supportTempoF\(/.test(hpSrc)
      && /\/ n/.test(hpSrc) && !/\d{2,}/.test(hpSrc),
      'supportHp = frontKillHp(投放腿 + 節奏係數 × dur ÷ 機數)(式子裡沒有手寫血量)');
    const svcSrc = (strip(DSRC).match(/export const supportServiceS = [\s\S]*?\n\};/) || [''])[0];
    ok(/supportLegS\(slot\)/.test(svcSrc) && /supportTempoF\(/.test(svcSrc) && !/\d\s*[*/+-]/.test(svcSrc),
      '服務窗 = 投放腿 + 節奏係數 × dur(沒有手寫秒數)');
    // 投放腿只有 abilLaunchLegM 一份分流(小招 MIN_LEG / 大招 ultLaunchLegM);
    // MUST NOT 在 supportLegS 裡再寫一次 slot 判斷(兩份分流遲早只改一份)
    ok(count(DSRC, /abilLaunchLegM\(slot\) \/ supportSpeed\(\)/g) === 1
      && count(DSRC, /export const abilLaunchLegM/g) === 1,
      '投放腿逐槽位只有 abilLaunchLegM 一份分流(小招 MIN_LEG / 大招 代表發射腿)');
  }
  // 砲塔數值一改,耐久自己跟著漂(與三種點遞送載具同一把尺)
  ok(/frontKillHp/.test(strip(DSRC).match(/export const supportHp[\s\S]*?\n\};/)[0])
    && /export const frontKillHp = \(sec\) => towerKillHp\(sec \* TOWER_SITE_N\);/.test(DSRC),
    '耐久與 kami/decoy/hyper 共用「前線一組塔位」那一把尺');

  // ---- Ⅴ-d 單一縫(原文)----
  ok(count(S, /_launchUltSupport\(/g) === 2,
    `_launchUltSupport:1 定義 + 1 呼叫(實得 ${count(S, /_launchUltSupport\(/g)})`);
  ok(count(S, /supportHp\(/g) === 1, '輔助機 HP 只在生成處取一次(MUST NOT 在別處另算)');
  ok(count(S, /_supSync\(/g) === 3,
    `_supSync:1 定義 + 2 呼叫(就位 / 下線 —— 疊加只有這一條路;實得 ${count(S, /_supSync\(/g)})`);
  ok(!/supportHp|supportN|ULT_SUPPORT/.test(strip(G)),
    '客戶端 MUST NOT 自己算輔助機的耐久/機數(A1:那是伺服器結算的量)');
  {
    const sy = strip(grabMethod(S, '_supSync'));
    ok(/m\.sup !== g\.id/.test(sy) || /\.sup === g\.id/.test(sy),
      '_supSync 先撤下這一組的舊 mods(疊加 = 撤下再放,不是逐架各推一筆)');
    ok(/a\.mods\[j\]\.until = g\.until;/.test(sy),
      '重放的 mods 一律改寫成群組 until(不改 = 每死一架就展期一次)');
    ok(/g\.live <= 0/.test(sy) && /_supRevoke\(/.test(sy),
      '一架都不剩 ⇒ 只撤不放,並撤掉不住在 mods 的二元狀態');
    const ts = strip(grabMethod(S, '_tickSupport'));
    ok(ts.indexOf("k.phase === 'deploy'") < ts.indexOf('this.t >= (k.supG?.until'),
      '投放腿的推進排在到期判定**之前**(排反了 ⇒ 瞬發型永遠交付不到)');
    // 2026-08-07 第二輪:效果窗 MUST 自**就位**起算 —— 施放當下就定死的話,工事離施放者遠一點
    // 就在半路到期 = 這一招在深推時永遠交付不到(同一個坑的第二次,一樣沒有錯誤訊息)
    ok(/until: null,/.test(strip(grabMethod(S, '_launchUltSupport')))
      && /g\.until \?\?= this\.t \+ \(g\.A\.dur \|\| 0\);/.test(strip(grabMethod(S, '_supArm'))),
      '效果窗自第一架就位起算(施放當下 until = null;MUST NOT 用「施放 + 代表腿」定死)');
  }
  {
    const ce = strip(grabMethod(S, '_castEffect'));
    ok(/const mf = \(m\) => 1 \+ \(m - 1\) \* frac;/.test(ce) && /const vf = \(v\) => v \* frac;/.test(ce),
      '份額只有 mf/vf 兩支(乘數型加法疊加 / 數值型按份)');
    for (const g of ['A.revive > 0 && once', 'A.vision && once', 'if (once) h.stealthUntil']) {
      ok(ce.includes(g), `一次性效果掛上 once 守衛(${g})`);
    }
  }

  // ---- Ⅴ-e 行為直測(真 BattleSim)----
  {
    const mkCfg = () => {
      const A = [25.0330, 121.5654];
      const D2 = 1600, R = 6371000;
      const realD = D2 * d.MAPGEO.REAL_SCALE;
      const B2 = [A[0] + realD / R * 180 / Math.PI, A[1]];
      const mid = [(A[0] + B2[0]) / 2, (A[1] + B2[1]) / 2];
      const pts = [];
      for (let t = 0; t <= 1.001; t += 0.05) pts.push([A[0] + (B2[0] - A[0]) * t, A[1]]);
      const sizeM = D2 / (0.85 * Math.SQRT2);
      return {
        center: { lat: mid[0], lng: mid[1] }, bases: { SWARM: A, STEEL: B2 }, lanes: [pts],
        sizeM, diagM: sizeM * Math.SQRT2, distM: D2, geoScaleVer: d.MAPGEO.GEO_SCALE_VER,
        maxOverlap: 0.05, synthetic: true, placeName: '稽核戰區',
        env: { season: 'summer', time: 'day', weather: 'clear' },
      };
    };
    // 投放腿是實距(大招自最近的工事召喚)⇒ 等「有人就位」而不是固定格數
    const DEPLOY_N = Math.ceil(d.SQUAD.KAMI.TTL_S / 0.125) + 4;
    const armed = (sim) => [...sim.ents.values()].some((e) => e.supG && e.phase === 'escort');
    const deploy = (sim, until = null) => {
      const done = until || (() => armed(sim) || ![...sim.ents.values()].some((e) => e.supG));
      for (let i = 0; i < DEPLOY_N && !done(); i++) sim.tick(0.125);
    };
    const mk = (side, pid, ch) => {
      const sim = new BattleSim(mkCfg());
      const h = sim.addHero(side, pid, ch);
      h.x = 400; h.z = 0; h.mp = 999; h.abil.ult = 1;   // 兵線之外(同 Ⅳ 的理由)
      return { sim, h };
    };
    const fleet = (sim, pid) => [...sim.ents.values()].filter((e) => e.supG && e.pid === pid);
    const run = (sim, n) => { for (let i = 0; i < n; i++) sim.tick(0.125); };

    // ① 生成:機數 / HP / armor·護盾 0 / 還沒就位 ⇒ 加成尚未上線
    {
      const { sim, h } = mk('SWARM', 'v1', 's04');
      sim.heroCast('v1', 'ult');
      const cs = fleet(sim, 'v1');
      ok(cs.length === d.supportN('s04'), `s04 派出 ${cs.length} 架(推導 ${d.supportN('s04')})`);
      ok(cs.every((k) => k.hp === d.supportHp('s04', 1) && k.armor === 0 && k.maxSp === 0),
        `每架 HP ${d.supportHp('s04', 1)}、armor / 護盾恆 0(校準不隨主機漂移)`);
      ok(near(sim._buffMul(h, 'dmg'), 1), '投放腿飛行中 ⇒ 加成還沒上線(每一發都有攔截窗)');
      deploy(sim);
      const full = d.heroAbility('s04', 'ult', 1).mul.dmg + d.selfUltBoost('s04', 1, h.abil).dmgMul;
      ok(near(sim._buffMul(h, 'dmg'), full, 1e-6),
        `全員就位 ⇒ 效果值**逐位元同舊制**(×${full.toFixed(3)})`);
      // ② 疊加:擊落一半 ⇒ 加成剩一半(加法,不是相乘)
      const alive = fleet(sim, 'v1');
      alive[0].hp = 0; sim._kill(alive[0], null);
      alive[1].hp = 0; sim._kill(alive[1], null);
      ok(near(sim._buffMul(h, 'dmg'), 1 + (full - 1) * 0.5, 1e-6),
        `擊落 2/4 ⇒ ×${(1 + (full - 1) * 0.5).toFixed(3)}(加法疊加;相乘會得到 ${((1 + (full - 1) / 4) ** 2).toFixed(3)})`);
      for (const k of fleet(sim, 'v1')) { k.hp = 0; sim._kill(k, null); }
      ok(near(sim._buffMul(h, 'dmg'), 1), '機隊全滅 ⇒ 加成整份下線');
      ok(fleet(sim, 'v1').length === 0, '全滅後場上不留殘骸實體');
    }
    // ③ 瞬發型(s11):抵達即交付、擊落一架就少一份
    {
      const { sim, h } = mk('SWARM', 'v2', 's11');
      h.hp = 1;
      h.invUntil = sim.t + 1e6;   // 同上:量治療量 MUST 與路過的爆風隔離(deploy 是真的在跑 tick)
      sim.heroCast('v2', 'ult');
      const cs = fleet(sim, 'v2');
      ok(cs.length === d.supportN('s11') && d.selfUltTempo('s11') === 'burst',
        `s11 是瞬發型、派 ${cs.length} 架`);
      cs[0].hp = 0; sim._kill(cs[0], null);
      deploy(sim, () => ![...sim.ents.values()].some((e) => e.supG));
      const A = d.heroAbility('s11', 'ult', 1), B = d.selfUltBoost('s11', 1, h.abil);
      ok(near(h.hp, Math.min(h.maxHp, 1 + (A.heal + B.heal) * 0.75), 1),
        `擊落 1/4 ⇒ 只補 3/4(${(h.hp - 1).toFixed(0)} / 全額 ${(A.heal + B.heal).toFixed(0)})`);
      ok(fleet(sim, 'v2').length === 0, '瞬發型交付完即退場(沒有時窗可供輸)');
    }
    // ④ 二元狀態(m08 匿蹤):單機、被擊落即現形
    {
      const { sim, h } = mk('STEEL', 'v3', 'm08');
      sim.heroCast('v3', 'ult');
      deploy(sim);
      ok(fleet(sim, 'v3').length === 1 && h.stealthUntil > sim.t,
        'm08 單機就位 ⇒ 匿蹤上線');
      const k = fleet(sim, 'v3')[0];
      k.hp = 0; sim._kill(k, null);
      ok(h.stealthUntil === 0 && !(h.alphaArm > sim.t),
        '輔助機被擊落 ⇒ 當場現形(二元狀態不住在 mods,MUST 顯式撤掉)');
    }
    // ⑤ 時窗不展期:死一架之後 until 仍是原本那一刻
    {
      const { sim, h } = mk('SWARM', 'v4', 's12');
      sim.heroCast('v4', 'ult');
      deploy(sim);
      const armAt5 = sim.t;
      const u0 = h.mods.find((m) => m.k === 'regen').until;
      run(sim, 8);
      const k = fleet(sim, 'v4')[0];
      k.hp = 0; sim._kill(k, null);
      const u1 = h.mods.find((m) => m.k === 'regen').until;
      ok(near(u0, u1), `擊落一架不展期(until ${u0.toFixed(2)} 不變)`);
      ok(u0 > sim.t && near(u0 - armAt5, d.heroAbility('s12', 'ult', 1).dur, 0.2),
        `時窗 = dur(自就位那一刻起算;實得 ${(u0 - armAt5).toFixed(2)}s)`);
    }
    // ⑥ 一次性效果只做一次:s12 的復活不會因為「又死一架重放」而再救一次
    {
      const { sim, h } = mk('SWARM', 'v5', 's12');
      const mate = sim.addHero('SWARM', 'v5b', 's11');
      mate.x = 700; mate.mp = 999; mate.abil.ult = 1;
      const body = sim._bodies(mate)[0];
      body.dead = true; body.respawnAt = sim.t + 30; body.hp = 0;
      sim.heroCast('v5', 'ult');
      deploy(sim);
      ok(!body.dead, 'rally:就位那一刻復活隊友');
      body.dead = true; body.respawnAt = sim.t + 30; body.hp = 0;   // 再殺一次
      const k = fleet(sim, 'v5')[0];
      k.hp = 0; sim._kill(k, null);                                  // 觸發一次重放
      ok(body.dead, '重放 MUST NOT 再復活一次(一次性效果只在第一次做)');
    }
    // ⑦ 載具化的 23 台完全不受影響(不生輔助機)
    {
      const { sim } = mk('SWARM', 'v6', 's02');
      sim.heroCast('v6', 'ult', 450, 0);
      ok(fleet(sim, 'v6').length === 0
        && [...sim.ents.values()].filter((e) => e.kami).length === d.SQUAD.KAMI.N,
        's02(點遞送)仍生 kami 載具、一架輔助機都沒有');
    }
  }
}

// ============================================================
sec('Ⅵ 小招也是輔助機型模式(2026-08-07 使用者定案)');
{
  // 使用者:「小招也改為輔助機型模式,CD 時間 15~30s,從玩家身邊召喚」。
  // 這一段驗的是「同一套機制真的**兩個槽位共用**」——不是兩份長得很像的實作。
  const CHS2 = Object.keys(d.CHARACTERS);
  // ① 分類/機數/節奏/耐久四支全部吃 slot,而且大招那一組**逐位元不動**(預設參數 = 'ult')
  ok(CHS2.every((c) => d.supportStackable(c, 'ult') === d.supportStackable(c)
    && d.supportN(c, 'ult') === d.supportN(c)
    && d.abilTempo(c, 'ult') === d.selfUltTempo(c)
    && d.supportHp(c, 1, 'ult') === d.supportHp(c, 1)),
    '四支推導的預設槽位 = ult ⇒ 既有呼叫端逐位元不變');
  // ② 自身型小招:節奏三分都用得到、耐久 > 0 且與大招同一把尺
  const supSk = CHS2.filter((c) => !d.abilDelivered(c, 'skill'));
  ok(supSk.length > 0 && supSk.every((c) => d.heroAbility(c, 'skill', 1).support),
    `自身/personal 型小招 ${supSk.length} 台走跟隨編隊`);
  ok(new Set(supSk.map((c) => d.abilTempo(c, 'skill'))).size >= 2,
    `小招的節奏不只一種(${[...new Set(supSk.map((c) => d.abilTempo(c, 'skill')))].join(' / ')})`);
  let skHpOk = true;
  for (const c of supSk) {
    const n = d.supportN(c, 'skill'), tempo = d.abilTempo(c, 'skill');
    const dur = d.tierVal(d.CHARACTERS[c].skill.dur ?? 0, 1);
    const want = d.frontKillHp(d.supportLegS('skill') + d.supportTempoF(tempo) * dur / n);
    if (d.supportHp(c, 1, 'skill') !== want || !(want > 0)) skHpOk = false;
  }
  ok(skHpOk, '小招輔助機耐久 = 前線一組塔位 ×(小招投放腿 + 節奏係數 × dur ÷ 機數)(逐台獨立重算)');
  // ③ 小招的投放腿**短於**大招(從玩家身邊 vs 從後方工事)—— 這就是兩者的設計差別
  ok(d.supportLegS('skill') < d.supportLegS('ult'),
    `小招投放腿 ${d.supportLegS('skill').toFixed(2)}s < 大招 ${d.supportLegS('ult').toFixed(2)}s(身邊召喚 vs 後方召喚)`);
  // ④ 同 dur 時,大招那一組的輔助機**比較硬**(要飛比較遠 ⇒ 服務窗比較長)
  {
    const one = (slot, dur) => d.frontKillHp(d.supportLegS(slot) + d.supportTempoF('sustain') * dur);
    ok(one('ult', 8) > one('skill', 8), `同 dur 大招機隊較硬(${one('ult', 8)} > ${one('skill', 8)});推導出來的,不是另外加的規則`);
  }
  // ⑤ 補償只給大招:小招 MUST NOT 領 selfUltEq(那份預算換的是被移除的機種絕招)
  ok(CHS2.every((c) => d.selfUltEq(c, 1, { light: 1, heavy: 1 }) >= 0)
    && /A\.id === 'ult'/.test(strip(grabMethod(S, '_castEffect'))),
    '補償只在 A.id === ult 那一支取(小招不領 selfUltEq)');
}

// ============================================================
console.log(`\n${fail ? '❌' : '✅'} 自身強化型大招(補償 + 輔助機隊)稽核:${pass} 綠 / ${fail} 紅`
  + (BREAK_EQ || BREAK_ALPHA || BREAK_BRK || BREAK_STACK || BREAK_TEMPO
    ? '(反向驗證模式:紅字 = 稽核有牙)' : ''));
process.exit(fail ? 1 : 0);
