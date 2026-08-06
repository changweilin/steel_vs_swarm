// ============ 純自身型大招補償稽核(2026-08-06 使用者定案)============
// 定案:機種絕招(飽和攻擊 / 集束炸彈 / 極音速飛彈)整組退場,長按右鍵改成招式手勢
// (一般 → 小招 / 狙擊 → 大招)。大招已載具化的 23 台等於把長按換成了大招;剩下 9 台
// **純自身型**大招沒有載具可換 ⇒ 把被移除的那份預算折進大招本身(data.js SELF_ULT)。
//
// 防的病灶(全部無錯誤訊息):
//   ・當量手寫一個倍率 ⇒ 之後改任一角色的 `ult.cd` 或 `SPECIAL.BASE`,補償當場失準,
//     而畫面上只表現成「這幾台好像變弱了」;
//   ・補償算成「再乘一層」而不是**增額** ⇒ 1.35 × 2.35 = 3.17 而不是 2.35(多發一份預算);
//   ・載具化的 23 台也吃到補償 ⇒ 長按換成大招**又**領一份折算(預算雙重領);
//   ・破隱爆發窗在 `_castEffect` 就開 ⇒ 躲著不開火也在燒那一秒(玩家只覺得「爆發沒生效」);
//   ・`brk`(挨一發就結束)漏掉某一條扣血路徑 ⇒ 那個來源的傷害打不斷超載;
//   ・夾制把推導值削掉卻不記錄 ⇒ 「補償是推導的」這句話對那幾台其實不成立(靜默截斷)。
//
// 跑法:`node tools/audit_self_ult.mjs`
//   反向驗證(原則 9;對應條目 MUST 立刻紅字,否則等於沒驗到):
//     `--break-eq`    selfUltEq 改成手寫常數(不再隨 cd / 預算走)⇒ Ⅰ 紅
//     `--break-alpha` 破隱窗改在 `_castEffect` 就開(而不是開火現形那一刻)⇒ Ⅲ・Ⅳ 紅
//     `--break-brk`   `_damage` 不再呼叫 `_breakOnHit`(超載打不斷)⇒ Ⅲ・Ⅳ 紅
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
  const dirty = BREAK_EQ || BREAK_ALPHA || BREAK_BRK;
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
      S = bust(S, /if \(A\.add\?\.fx === 'alpha'\) \{ h\.alphaX = B\.alphaX; h\.alphaArm = this\.t \+ A\.dur; \}/,
        "if (A.add?.fx === 'alpha') { h.mods.push({ k: 'dmg', m: B.alphaX, until: this.t + SELF_ULT.ALPHA_S }); }",
        '--break-alpha');
    }
    if (BREAK_BRK) {
      S = bust(S, /\n      this\._breakOnHit\(t\);[^\n]*/, '', '--break-brk');
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
  const hero = (sim, side, pid, ch) => {
    const h = sim.addHero(side, pid, ch);
    h.x = 0; h.z = 0; h.mp = 999; h.abil.ult = 1;
    return h;
  };

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
    ok(!body.dead && body.respawnAt === 0, 'rally:重生倒數中的隊友原地站起來');
    ok(near(body.hp, Math.max(1, Math.round(body.maxHp * A.revive))), `rally:回場半血(${body.hp}/${body.maxHp})`);
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
    ok(b2.dead, 'rally:**不在重生倒數中**的隊友不復活(使用者定案的限制)');
  }

  // ② overdrive(t02「同步率 100%」):彈匣全滿 + 免裝填 + 閃避;挨一發即結束
  {
    const sim = new BattleSim(mkCfg());
    const h = hero(sim, 'STEEL', 'a3', 't02');
    const wl = d.heroWeapon('t02', 'light', 1);
    h.ammo.light = 0; h.reloadUntil.light = sim.t + 99;
    sim.heroCast('a3', 'ult');
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
    const A = d.heroAbility('s11', 'ult', 1);
    const B = d.selfUltBoost('s11', 1, h.abil);
    sim.heroCast('a7', 'ult');
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
console.log(`\n${fail ? '❌' : '✅'} 純自身型大招補償稽核:${pass} 綠 / ${fail} 紅`
  + (BREAK_EQ || BREAK_ALPHA || BREAK_BRK ? '(反向驗證模式:紅字 = 稽核有牙)' : ''));
process.exit(fail ? 1 : 0);
