// ============ 攻擊範圍收斂 + 三軸預算(範圍 / 機動 / 射程)稽核 ============
// 用途:改 `data.js` 的 `AREA_WEAPONS`、`soloBlastRmax()`/`towerPairSepM()`、`AOE_BUDGET`、
// `MOB_BUDGET`、`RANGE_BUDGET`、任何爆炸型武器的 `r`、`GAME.TOWER_SIDE_OFF`、`TARGET_R.tower`、
// `BLAST`,或 `tools/lanesim.mjs` 之後跑。
// 跑法:`node tools/audit_aoe_trim.mjs`
//
// 為什麼要這一支 —— 這批改動有四個「壞掉但不會報錯」的形狀:
//
// ① **夾制失效只差 0.001m**。「一發不得同時吃到同塔位兩座塔」是一條充要條件
//    (r × BLAST.EDGE < 塔距/2 − 塔半徑),頂階半徑高出 1mm 規則就整條失效,而畫面上只表現成
//    「這把武器拆塔特別快」。前科兩次:逐項四捨五入把頂階推回 cap 之上;以及 tierVal 的 Lv4
//    **外推**(2·v₃ − v₂)在逐項捨去後反彈(t09 [15,17,19] 實測回到 4.445)。
//    故此處**實算**:爆心沿兩塔連心線逐點掃,兩座塔都掉血就紅字 —— 不比常數,比行為。
//
// ② **豁免名冊變成裝飾**。「以範圍見長」的武器如果被夾到跟別人一樣,名冊就只是註解;
//    反過來,名冊漏了誰,那把武器就靜默地繼續一發削兩座塔。兩個方向都驗。
//
// ③ **補償變成通膨**。收掉範圍要還火力,但既有的 bal ①④⑤ 全是單體模型(爆風半徑從來沒進過
//    算式)⇒ 補償若當成純加法發下去,那些模型只看得到「傷害整批變高」。故補償 MUST 是
//    **重分配**:整批補償係數的幾何平均 = 1(AOE_BUDGET.NORM 的定義),且沒被夾過的武器恆 ×1。
//
// ④ **預算沒接上 / 接了兩次**。三個係數(aoeTrimF / mobDmgF / rngDmgF)的套用點都只有
//    heroWeapon 的 dmg 一欄;少接一處 = 那條路徑沒有計價,多接一處 = 平方計價。原文計數釘死。
//
// 讀原文走 `audit_src.mjs` 單一縫(含換行正規化 —— 逐行剝註解在 CRLF 工作區會靜默失效)。
import { readSrc } from './audit_src.mjs';
import {
  CHARACTERS, GAME, ECON, BLAST, TARGET_R, UNITS, blastFalloff, aoeClass, heroWeapon, heroRange,
  charKind, heroMobility, AREA_WEAPONS, AOE_BUDGET, MOB_BUDGET, tierVal,
  towerPairSepM, soloBlastRmax, blastFootprintR, areaValue, aoeTrimRaw, aoeTrimF,
  mobMid, mobDmgF, rangeMid, rngDmgF,
  BLAST_BAND, blastCapR, blastFamily, trajClass,
} from '../public/js/data.js';
import { LANE, laneBattle, hits, mech } from './lanesim.mjs';

let pass = 0, fail = 0;
const t = (n, ok, extra = '') => { ok ? (pass++, console.log(`  ✓ ${n}`)) : (fail++, console.log(`  ✗ ${n} ${extra}`)); };
const near = (a, b, e = 1e-9) => Math.abs(a - b) <= e;
const MAX_TIER = 1 + ECON.UPGRADES.hw.max;

const DATA = readSrc('public', 'js', 'data.js');
const LSIM = readSrc('tools', 'lanesim.mjs');
/** 剝掉行註解**與區塊註解**後的原文(單一縫計數 MUST NOT 把註解/JSDoc 裡提到的名字算進去) */
const bare = (src) => src.replace(/\/\*[\s\S]*?\*\//g, '')
  .split('\n').map((l) => l.replace(/\/\/.*$/, '')).join('\n');
const DATA_B = bare(DATA);
const count = (src, re) => (src.match(re) || []).length;

/** 全部「爆炸型」英雄武器(滿級解析後 —— 頂階半徑才是真正的上界) */
const blasts = [];
for (const ch of Object.keys(CHARACTERS)) for (const slot of ['light', 'heavy']) {
  const w = heroWeapon(ch, slot, MAX_TIER, true);
  if (w && aoeClass(w) === 'blast') blasts.push({ key: `${ch}.${slot}`, ch, slot, def: w });
}
/**
 * 這個爆風半徑「一發打不打得到同塔位的兩座塔」——**實算**,不比常數。
 * 爆心沿兩塔連心線掃(對稱 ⇒ 只掃半邊);距離量到**命中量體表面**(對齊 sim._blast 的最近點)。
 */
const twoTowers = (r) => {
  const R = TARGET_R.tower, half = towerPairSepM() / 2;
  for (let c = 0; c <= half + 1e-9; c += 0.05) {
    const dA = Math.max(0, Math.abs(half - c) - R), dB = Math.max(0, half + c - R);
    if (blastFalloff(r, dA) > 0 && blastFalloff(r, dB) > 0) return true;
  }
  return false;
};

console.log('\nⅠ 幾何上界:推導不手寫,且逐把實算「打不打得到兩座塔」');
{
  t('towerPairSepM() = 2 × GAME.TOWER_SIDE_OFF(推導)', near(towerPairSepM(), 2 * GAME.TOWER_SIDE_OFF));
  t('soloBlastRmax() =(塔距/2 − 塔半徑)÷ BLAST.EDGE(推導)',
    near(soloBlastRmax(), (towerPairSepM() / 2 - TARGET_R.tower) / BLAST.EDGE));
  t('blastFootprintR() = r × BLAST.EDGE(= blastFalloff 的歸零界)',
    near(blastFootprintR(7), 7 * BLAST.EDGE) && blastFalloff(7, 7 * BLAST.EDGE) === 0);
  // 上界本身 MUST 恰好是「臨界」:等於上界打不到第二座,再大一點點就打得到
  t('上界是臨界值:r = 上界 ⇒ 打不到兩座;r = 上界 + 1mm ⇒ 打得到',
    !twoTowers(soloBlastRmax()) && twoTowers(soloBlastRmax() + 0.001));
  t('原文:soloBlastRmax / towerPairSepM 各只有一處定義(單一縫)',
    count(DATA_B, /export const soloBlastRmax\s*=/g) === 1
    && count(DATA_B, /export const towerPairSepM\s*=/g) === 1);
  // 消費端不得手抄幾何常數:家族上限只准經 blastCapR(),而它只准經 soloBlastRmax()
  t('原文:blastCapR 只有一處定義,且吃 soloBlastRmax()(MUST NOT 手抄 30 / 7 / 1.8)',
    count(DATA_B, /export const blastCapR\s*=/g) === 1
    && /export const blastCapR\s*=[^;]*soloBlastRmax\(\)/.test(DATA_B));
  t('原文:夾制迴圈只有一處,且家族上限一律取自 blastCapR()(全檔僅此一個呼叫點)',
    count(DATA_B, /cap: blastCapR\(/g) === 1 && count(DATA_B, /blastCapR\(/g) === 1);
  t('原文:家族分組只有 blastFamily 一份(MUST NOT 在夾制迴圈裡另寫一次 traj 比對)',
    count(DATA_B, /export const blastFamily\s*=/g) === 1);
}

console.log('\nⅠ-b 爆風家族帶:榴彈吃滿上限、導引恆小於榴彈(2026-08-04 使用者定案)');
{
  t('blastFamily:lob → lob;guide / fnf → guided(兩者同族)',
    blastFamily('lob') === 'lob' && blastFamily('guide') === 'guided' && blastFamily('fnf') === 'guided');
  t('榴彈家族上限 = soloBlastRmax()(吃滿「不得一次吃兩塔」的上限)', near(blastCapR('lob'), soloBlastRmax()));
  t('導引家族上限 = 榴彈 × GUIDED_F,且 GUIDED_F < 1(推導不手寫)',
    near(blastCapR('guide'), soloBlastRmax() * BLAST_BAND.GUIDED_F)
    && near(blastCapR('fnf'), blastCapR('guide')) && BLAST_BAND.GUIDED_F < 1);
  t('階梯底係數 LO ∈ (0, 1](= 1 即半徑不隨階級成長;→ 0 即回到「頂階貼齊、底階自由落體」)',
    BLAST_BAND.LO > 0 && BLAST_BAND.LO <= 1);
  // 逐階全掃:兩族各自的值域,以及「導引 < 榴彈」的三個端點
  const band = {};
  for (const b of blasts) {
    const fam = blastFamily(trajClass(b.def));
    for (let lv = 1; lv <= MAX_TIER; lv++) (band[fam] ||= []).push(heroWeapon(b.ch, b.slot, lv, true).r);
  }
  const gm = (v) => Math.exp(v.reduce((s, x) => s + Math.log(x), 0) / v.length);
  t('兩族都有成員(名冊清空後 lob 也走夾制)', band.lob?.length > 0 && band.guided?.length > 0);
  t(`導引上限 ${Math.max(...band.guided).toFixed(3)}m < 榴彈上限 ${Math.max(...band.lob).toFixed(3)}m`,
    Math.max(...band.guided) < Math.max(...band.lob));
  t(`導引下限 ${Math.min(...band.guided).toFixed(3)}m < 榴彈下限 ${Math.min(...band.lob).toFixed(3)}m`,
    Math.min(...band.guided) < Math.min(...band.lob));
  t(`導引幾何中點 ${gm(band.guided).toFixed(3)}m < 榴彈幾何中點 ${gm(band.lob).toFixed(3)}m`,
    gm(band.guided) < gm(band.lob));
  t('每一族的頂階恰好貼齊自己的家族上限(帶的上緣是被吃滿的,不是碰巧落在下面)',
    ['lob', 'guided'].every((f) => {
      const cap = blastCapR(f === 'lob' ? 'lob' : 'guide');
      return Math.abs(Math.max(...band[f]) - cap) <= 0.002;
    }));
  t('每一族的底階 = 家族上限 × LO(帶的下緣由 LO 定義,不是等比收斂的殘值)',
    ['lob', 'guided'].every((f) => {
      const cap = blastCapR(f === 'lob' ? 'lob' : 'guide');
      return Math.abs(Math.min(...band[f]) - cap * BLAST_BAND.LO) <= 0.002;
    }));
  // 家族內排序保留:授權半徑大的,定案半徑也 MUST 不小於授權半徑小的(逐把伸展會把這條抹平)
  const bad = [];
  for (const fam of ['lob', 'guided']) {
    const ws = blasts.filter((b) => blastFamily(trajClass(b.def)) === fam)
      .map((b) => ({ k: b.key, raw: CHARACTERS[b.ch][b.slot]._aoeRaw, r: heroWeapon(b.ch, b.slot, 1, true).r }))
      .sort((a, b2) => a.raw - b2.raw);
    for (let i = 1; i < ws.length; i++) if (ws[i].r < ws[i - 1].r - 1e-9) bad.push(`${fam}:${ws[i].k}`);
  }
  t('家族內排序保留:授權半徑越大 ⇒ 定案半徑越大(逐把伸展會把這條抹平)', bad.length === 0, bad.join(' '));
  // 榴彈類 = 「較短射程的那一類」(使用者定案):MUST 是全體重武器解析後射程的最小值
  const heavies = Object.keys(CHARACTERS).map((ch) => ({ ch, r: heroRange(ch, 'heavy'), def: heroWeapon(ch, 'heavy', 1, true) }));
  const minR = Math.min(...heavies.map((h) => h.r));
  const lobs = heavies.filter((h) => trajClass(h.def) === 'lob');
  t(`榴彈類(${lobs.length} 把)射程 = 全體重武器最短的那一帶 ${minR.toFixed(1)}m`,
    lobs.length > 0 && lobs.every((h) => near(h.r, minR)));
  t('導引類射程 MUST 長於榴彈類(短射程換大範圍 / 長射程換小範圍)',
    heavies.filter((h) => aoeClass(h.def) === 'blast' && trajClass(h.def) !== 'lob').every((h) => h.r > minR));
}

console.log('\nⅡ 逐把武器:非「範圍見長」一發打不到兩座塔;名冊內的仍打得到');
{
  const exempt = Object.keys(AREA_WEAPONS);
  // 名冊是**凍結清單**(與 EX_SIEGE_WEAPONS 同一條紀律):放行的是「一發削兩座塔」這種
  // 結構性特權,單靠「有沒有附理由」擋不住膨脹 —— 誰都可以自稱以範圍見長。故此處逐一釘死,
  // **改名冊 MUST 同步改這一行**,讓每一次增刪都是一次刻意的決定而不是順手加名。
  // 2026-08-04 使用者定案「榴彈類不可一次命中兩座砲塔」⇒ 名冊裡原本那三把榴彈類全數收回,
  // 現況**應為空**:沒有任何爆炸型武器享有豁免(fan/line 依機制豁免,不經此表)。
  const EXPECT = [];
  t(`名冊 AREA_WEAPONS 恰為 ${EXPECT.length ? EXPECT.join('、') : '空'}(凍結清單;增刪 MUST 同步本稽核)`,
    exempt.length === EXPECT.length && EXPECT.every((k) => k in AREA_WEAPONS),
    `實得 ${exempt.join('、') || '空'}`);
  t('名冊每一把都附了理由', exempt.every((k) => typeof AREA_WEAPONS[k] === 'string' && AREA_WEAPONS[k].length > 8));
  t('名冊每一把都真的存在,且真的是爆炸型武器(名冊不得指向不存在/非 blast 的武器)',
    exempt.every((k) => blasts.some((b) => b.key === k)));
  for (const b of blasts) {
    const isArea = !!AREA_WEAPONS[b.key];
    const hit2 = twoTowers(b.def.r);
    t(`${b.key} 滿級 r=${b.def.r.toFixed(3)}m ${isArea ? '【範圍見長】MUST 打得到兩座' : 'MUST 打不到兩座'}`,
      isArea ? hit2 : !hit2);
  }
  // 逐階都要成立(不是只有滿級):Lv1~Lv4 全掃
  const badTier = [];
  for (const b of blasts) {
    if (AREA_WEAPONS[b.key]) continue;
    for (let lv = 1; lv <= MAX_TIER; lv++) if (twoTowers(heroWeapon(b.ch, b.slot, lv, true).r)) badTier.push(`${b.key}@Lv${lv}`);
  }
  t(`逐階(Lv1~Lv${MAX_TIER})全數成立`, badTier.length === 0, badTier.join(' '));
  // 三分類只有 blast 進夾制:fan / line 逐位元不動(_aoeRaw 只會掛在被夾過的 blast 上)
  const wrong = [];
  for (const ch of Object.keys(CHARACTERS)) for (const slot of ['light', 'heavy']) {
    const raw = CHARACTERS[ch][slot];
    if (!raw?._aoeRaw) continue;
    if (aoeClass(heroWeapon(ch, slot, 1, true)) !== 'blast' || AREA_WEAPONS[`${ch}.${slot}`]) wrong.push(`${ch}.${slot}`);
  }
  t('只有非豁免的 blast 被夾過(fan 扇形 / line 貫穿 / 名冊內 逐位元不動)', wrong.length === 0, wrong.join(' '));
}

console.log('\nⅢ 範圍補償:重分配而非通膨(幾何平均 = 1),且讓出越多拿越多');
{
  const trimmed = [];
  for (const ch of Object.keys(CHARACTERS)) for (const slot of ['light', 'heavy'])
    if (CHARACTERS[ch][slot]?._aoeRaw) trimmed.push(CHARACTERS[ch][slot]);
  t(`被夾過的武器有 ${trimmed.length} 把`, trimmed.length > 0);
  const geo = Math.exp(trimmed.reduce((s, w) => s + Math.log(aoeTrimF(w)), 0) / trimmed.length);
  t('整批補償係數的幾何平均 = 1(火力水位不動,只在彼此之間重分配)', near(geo, 1, 1e-12), `實得 ${geo}`);
  t('NORM 是 derive 不是手寫(= 未正規化係數的幾何平均)',
    near(AOE_BUDGET.NORM, Math.exp(trimmed.reduce((s, w) => s + Math.log(aoeTrimRaw(w)), 0) / trimmed.length), 1e-12));
  t('沒被夾過的武器補償恆 ×1(其餘角色逐位元不受影響)',
    Object.keys(CHARACTERS).every((ch) => ['light', 'heavy'].every((s) => {
      const w = CHARACTERS[ch][s];
      return !w || w._aoeRaw || (aoeTrimF(w) === 1 && aoeTrimRaw(w) === 1);
    })));
  // 讓出越多範圍 ⇒ 補償越多(單調);同時驗 areaValue 的形狀。
  // **逐家族比**:兩族的上限不同(榴彈吃滿 / 導引 ×GUIDED_F)⇒ 同一個授權半徑在兩族會落在
  // 不同的定案半徑上,跨族排序本來就沒有意義(這條驗的是「同一族內誰讓得多誰拿得多」)。
  const badMono = [];
  for (const fam of ['lob', 'guided']) {
    const sorted = trimmed
      .filter((w) => blastFamily(trajClass(w)) === fam)
      .sort((a, b2) => a._aoeRaw - b2._aoeRaw);
    for (let i = 1; i < sorted.length; i++) {
      if (aoeTrimRaw(sorted[i]) < aoeTrimRaw(sorted[i - 1]) - 1e-12) badMono.push(`${fam}#${i}`);
    }
  }
  t('讓出越多範圍,補償越多(同一家族內對原半徑單調不減)', badMono.length === 0, badMono.join(' '));
  t('areaValue:半徑 0 = 1(單體基準)、= 上界時 = 1 + W、且嚴格遞增',
    near(areaValue(0), 1) && near(areaValue(soloBlastRmax()), 1 + AOE_BUDGET.W)
    && areaValue(10) > areaValue(5));
  // 階梯形狀保留:夾制是等比收斂,不是整排壓平
  const ladders = trimmed.filter((w) => Array.isArray(w.r) && w.r.length > 1);
  t('階梯形狀保留(等比收斂,不是整排壓成同一個值)',
    ladders.length > 0 && ladders.every((w) => w.r[w.r.length - 1] > w.r[0]));
  t(`頂階(含 tierVal Lv${MAX_TIER} 外推)恆 ≤ 上界`,
    trimmed.every((w) => tierVal(w.r, MAX_TIER) <= soloBlastRmax() + 1e-12));
}

console.log('\nⅣ 機動 / 射程預算:以同儕幾何中點為軸,單調,且套用點各只有一處');
{
  // 機動
  const mv = Object.keys(CHARACTERS).map((c) => heroMobility(charKind(c), CHARACTERS[c].mods, charKind(c) === 'drone'));
  t('mobMid() = 全角色有效機動的幾何中點(推導)',
    near(mobMid(), Math.exp(mv.reduce((s, x) => s + Math.log(x), 0) / mv.length), 1e-9));
  const byMob = Object.keys(CHARACTERS).slice().sort((a, b) =>
    heroMobility(charKind(a), CHARACTERS[a].mods, charKind(a) === 'drone')
    - heroMobility(charKind(b), CHARACTERS[b].mods, charKind(b) === 'drone'));
  t('mobDmgF 對機動單調遞減(跑得越快,基礎火力越低)',
    byMob.every((c, i) => i === 0 || mobDmgF(c) <= mobDmgF(byMob[i - 1]) + 1e-12));
  t('mobDmgF 在中點恰為 1、上下各跨過 1(是重分配不是全體加減)',
    Math.max(...byMob.map(mobDmgF)) > 1 && Math.min(...byMob.map(mobDmgF)) < 1
    && MOB_BUDGET.K > 0);
  // 射程(逐槽位)
  for (const slot of ['light', 'heavy']) {
    const rv = Object.keys(CHARACTERS).map((c) => heroRange(c, slot)).filter((x) => x > 0);
    t(`rangeMid('${slot}') = 該槽位解析後射程的幾何中點(逐槽位,推導)`,
      near(rangeMid(slot), Math.exp(rv.reduce((s, x) => s + Math.log(x), 0) / rv.length), 1e-9));
    const by = Object.keys(CHARACTERS).filter((c) => heroRange(c, slot) > 0)
      .sort((a, b) => heroRange(a, slot) - heroRange(b, slot));
    t(`rngDmgF('${slot}') 對射程單調遞減(打得越遠,基礎火力越低)`,
      by.every((c, i) => i === 0 || rngDmgF(c, slot) <= rngDmgF(by[i - 1], slot) + 1e-12));
  }
  t('輕/重武器**分開**取中點(混一鍋 = 量到的是槽位不是射程優勢)',
    Math.abs(rangeMid('light') - rangeMid('heavy')) > 1);
  t('heroRange 是唯一縫:heroWeapon 的 range 欄與預算同吃',
    Object.keys(CHARACTERS).every((c) => ['light', 'heavy'].every((s) =>
      !CHARACTERS[c][s] || near(heroWeapon(c, s, 1, true).range, heroRange(c, s)))));
  // 套用點各只有一處(原文)
  for (const fn of ['aoeTrimF', 'mobDmgF', 'rngDmgF']) {
    // 定義 1 次 + heroWeapon 消費 1 次 = 原文恰 2 處(識別字計數,不論 const 箭頭或 function 宣告)
    const n = count(DATA_B, new RegExp(`\\b${fn}\\b`, 'g'));
    t(`原文:${fn} 恰 2 處(定義 + heroWeapon 唯一消費點)`, n === 2, `實得 ${n}`);
  }
  t('三個係數都掛在 heroWeapon 的 dmg 同一欄(與 counterDmgF 並列)',
    /dmg:\s*t\(w\.dmg\)\s*\*\s*counterDmgF\(w\)\s*\*\s*aoeTrimF\(w\)\s*\*\s*mobDmgF\(ch\)\s*\*\s*rngDmgF\(ch,\s*slot\)/.test(DATA_B));
  t('招式(heroAbility)刻意不吃三軸預算(使用者:先不考慮長按技和大小招)',
    !/dmg:\s*t\(a\.dmg[^\n]*mobDmgF/.test(DATA_B) && !/dmg:\s*t\(a\.dmg[^\n]*rngDmgF/.test(DATA_B));
}

console.log('\nⅤ 前線交戰模型(lanesim):場景全由 data.js 推導,三類範圍幾何各自成立');
{
  t('原文:步進 = 伺服器 tick(GAME.TICK_MS 推導,MUST NOT 手寫秒數)',
    /DT:\s*GAME\.TICK_MS\s*\/\s*1000/.test(bare(LSIM)) && near(LANE.DT, GAME.TICK_MS / 1000));
  t('原文:塔距 / 塔位橫向偏移 / 兵波編制 / 出兵間隔全部取 data.js(無手寫距離)',
    /UNITS\.tower\.range \* GAME\.TOWER_SEP_F/.test(bare(LSIM))
    && /GAME\.TOWER_SIDE_OFF/.test(bare(LSIM))
    && /waveComp\(\)/.test(bare(LSIM)) && /waveInterval\(\)/.test(bare(LSIM)));
  t('原文:傷害拆分走 shieldSplit、護甲走 armorMul(不得自寫第二份)',
    /shieldSplit\(/.test(bare(LSIM)) && /armorMul\(/.test(bare(LSIM))
    && !/Math\.min\(\s*sp/.test(bare(LSIM)));
  t('原文:範圍幾何走 aoeClass 三分類(MUST NOT 另寫一份 def.type 比對)',
    /aoeClass\(def\)/.test(bare(LSIM)) && !/def\.type\s*===\s*'launcher'/.test(bare(LSIM)));

  // 行為:三類範圍各自的命中名冊
  const shooter = { x: 0, y: 0 }, foesAt = (xs) => xs.map((x) => ({ kind: 'soldier', x, y: 0, hp: 100 }));
  const blastDef = heroWeapon(blasts.find((b) => !AREA_WEAPONS[b.key]).ch,
    blasts.find((b) => !AREA_WEAPONS[b.key]).slot, 1, true);
  const foes = foesAt([100, 100 + blastFootprintR(blastDef.r) * 0.5, 100 + blastFootprintR(blastDef.r) * 2]);
  const h = hits(shooter, foes[0], blastDef, foes);
  t('blast:足跡內的順帶掃到、足跡外的不掃到(圓形超壓)',
    h.length === 2 && h.every((x) => x.f > 0) && !h.some((x) => x.ent === foes[2]));
  // fan:錐寬隨距離張開 —— 同一個橫向偏移,拉遠才進得了錐
  const fanCh = Object.keys(CHARACTERS).find((c) => heroWeapon(c, 'heavy', 1, true)?.fan);
  const fanDef = heroWeapon(fanCh, 'heavy', 1, true);
  const off = 12;
  const nearFoes = [{ kind: 'soldier', x: 20, y: 0, hp: 1 }, { kind: 'soldier', x: 20, y: off, hp: 1 }];
  const farFoes = [{ kind: 'soldier', x: 100, y: 0, hp: 1 }, { kind: 'soldier', x: 100, y: off, hp: 1 }];
  const hn = hits(shooter, nearFoes[0], fanDef, nearFoes), hf = hits(shooter, farFoes[0], fanDef, farFoes);
  t(`fan:同一個橫向偏移 ${off}m —— 貼身掃不到、拉遠掃得到(錐寬隨距離張開)`,
    hn.length === 1 && hf.length === 2);
  t('fan:越近越強(fanFalloff),所以拉遠掃得多但每個都更痛不了',
    hn[0].f > hf.find((x) => x.ent === farFoes[0]).f);
  // line:圓柱貫穿,依序衰減,且有上限
  const lineCh = Object.keys(CHARACTERS).find((c) => aoeClass(heroWeapon(c, 'heavy', 1, true)) === 'line');
  const lineDef = heroWeapon(lineCh, 'heavy', 1, true);
  const row = foesAt([30, 60, 90]);
  const hl = hits(shooter, row[0], lineDef, row);
  t('line:一線貫穿多名,且後續目標逐一衰減(LANCE.DECAY)',
    hl.length === 3 && hl[0].f > hl[1].f && hl[1].f > hl[2].f);

  // 勝負條件:先毀敵機體或一座塔
  const r = laneBattle('t01', 't01');
  t('對局終局理由只有 kill / tower / timeout 三種', ['kill', 'tower', 'timeout'].includes(r.why));
  t('對局長度有上限且 ≤ LANE.MAX_T', r.t <= LANE.MAX_T + LANE.DT);
  // 有錢就升級:開場資金 MUST 立刻換成等級(貪心買最便宜的一階)
  const M = mech('t01', 'SWARM');
  t('開場資金 = ECON.START,且八軌起始全 0', M.cash === ECON.START && LANE.TRACKS.every((k) => M.up[k] === 0));
  t('升級只買模型算得到的六軌(小招/大招不在模型內 ⇒ 不進採購清單)',
    !LANE.TRACKS.includes('sk') && !LANE.TRACKS.includes('ult') && LANE.TRACKS.length === 6);
}

console.log(`\n${fail ? '❌' : '✅'} 攻擊範圍收斂 / 三軸預算稽核:${pass}/${pass + fail} 通過`);
process.exit(fail ? 1 : 0);
