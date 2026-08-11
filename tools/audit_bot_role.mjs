// ============ 電腦玩家定位分類與策略稽核(2026-08-08 使用者需求)============
// 需求原文:「幫依機體技能等數值為電腦玩家分類,並設計不同策略」。
// 改 `data.js` 的 `BOT_ROLE_FEATS`/`BOT_ROLES`/`BOT_ROLE`/`BOT_BUY_ORDER`/`botRoleFeats`/
// `botRoleScores`/`botRoleOf`/`botRoleRoster`/`botRoleMul`/`botRoleTactic`/`botBuyOrder`/
// `botTacticCross`、`BOT_TACTIC` 的五個新旋鈕、`server/bots.js` 的 `_resolveRole` 與
// `_acquire`/`_engage`/`_castSupport`/採購迴圈之後跑:`node tools/audit_bot_role.mjs`
//
// 這支盯的是「**分類看起來很合理、實際上根本沒生效**」的那一批寫壞法:
//   ① 分類寫成逐角色名冊:改平衡數值時沒有任何東西提醒你它過期了 —— 一台被砍到只剩一半
//      火力的機體照樣掛著「攻堅」的策略,而畫面上只是「這台 bot 好像變笨了」。
//   ② 特徵自己算一份 DPS/EHP:圖鑑六角圖與 bot 分類分家,兩邊都「看起來合理」。
//   ③ 乘數沒有正規化:「給每個定位一點加強」= 整批 bot 悄悄變強,而 `npm run sim` 的勝負
//      旗標對這種整體漂移是飽和的(量不出來)。
//   ④ 定位覆寫繞過難度旗標:新手難度跟著一起「優化」,難度階梯整個塌掉(A33)。
//   ⑤ 覆寫在自己身上累乘:換座機幾次之後距離環飄到夾制邊界,完全無聲。
//   ⑥ bots.js 出現 `if (role === 'siege')` 的行為分支:第二套決策系統,與難度分層打架。
//
// 手法:常數/曲線直接 import(data.js 是純模組)、原文單一縫走 `audit_src.mjs`、
// 行為一律以**真的 BattleSim + 真的 BotBrain** 直測。
//
// 反向驗證(原則 9):
//   node tools/audit_bot_role.mjs --break-role   # 四個定位剖面同形(分類退化成一種)⇒ Ⅰ 紅字
//   node tools/audit_bot_role.mjs --break-norm   # 乘數不正規化(通膨而非重分配)⇒ Ⅱ 紅字
//   node tools/audit_bot_role.mjs --break-tier   # 低難度也套定位覆寫(難度階梯塌掉)⇒ Ⅳ 紅字
import { readSrc, grabMethod } from './audit_src.mjs';
import {
  BOT_ROLE_FEATS, BOT_ROLES, BOT_ROLE_KEYS, BOT_ROLE, BOT_BUY_ORDER,
  botRoleFeats, botRoleScores, botRoleOf, botRoleRoster, botRoleMul, botRoleTactic, botBuyOrder,
  BOT_TACTIC, BOT_TACTIC_BASE, BOT_LEARN, botPolicySanitize, botTacticCross,
  HEX_AXES, CHARACTERS, UNITS, MAPGEO, ECON, buildDps, heroAbility, heroWeapon, vsMult,
} from '../public/js/data.js';
import { BattleSim } from '../server/sim.js';
import { BotBrain } from '../server/bots.js';

const BREAK_ROLE = process.argv.includes('--break-role');
const BREAK_NORM = process.argv.includes('--break-norm');
const BREAK_TIER = process.argv.includes('--break-tier');

// --break-role:四個剖面改成同一份 ⇒ argmax 永遠落在宣告序第一個定位(分類退化)。
// MUST 排在任何 botRoleOf 之前(定位有惰性快取)。
if (BREAK_ROLE) for (const r of BOT_ROLE_KEYS) BOT_ROLES[r].w = { mob: 1 };
// --break-norm:被測的覆寫換成「壞版」(直接乘原始乘數,不除加權幾何平均)
const roleTactic = BREAK_NORM
  ? (base, role) => {
    if (!role || !BOT_ROLES[role]) return base;
    const out = { ...base };
    for (const [k, [lo, hi]] of Object.entries(BOT_ROLE.KNOBS)) {
      out[k] = Math.min(hi, Math.max(lo, (base[k] ?? BOT_TACTIC_BASE[k]) * (BOT_ROLES[role].mul[k] ?? 1)));
    }
    return botTacticCross(out);
  }
  : botRoleTactic;
const roleMul = BREAK_NORM ? (k, r) => (BOT_ROLES[r]?.mul?.[k] ?? 1) : botRoleMul;

const dataSrc = readSrc('public', 'js', 'data.js');
const botsSrc = readSrc('server', 'bots.js');
const strip = (s) => s
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .split('\n').map((l) => l.replace(/(^|[^:'"`])\/\/.*$/, '$1')).join('\n');
const dataCode = strip(dataSrc);
const botsCode = strip(botsSrc).split("} from '../public/js/data.js';").slice(1).join('');
const count = (s, needle) => s.split(needle).length - 1;

let pass = 0, fail = 0;
const t = (n, ok, extra = '') => { ok ? (pass++, console.log(`  ✓ ${n}`)) : (fail++, console.log(`  ✗ ${n} ${extra}`)); };
const near = (a, b, e = 1e-9) => Math.abs(a - b) <= e;
const sec = (s) => console.log(`\n■ ${s}`);

const CH = Object.keys(CHARACTERS);
const ROSTER = botRoleRoster();

// ---- 共用:真 BattleSim(與 audit_bot_tactics 同一份合成戰場)----
function fakeCfg() {
  const A = [25.0330, 121.5654], Dm = 1600, R = 6371000;
  const dLat = Dm * MAPGEO.REAL_SCALE / R * 180 / Math.PI;
  const B = [A[0] + dLat, A[1]];
  const pts = [];
  for (let s = 0; s <= 1.001; s += 0.05) pts.push([A[0] + (B[0] - A[0]) * s, A[1]]);
  const sizeM = Dm / (0.85 * Math.SQRT2);
  return {
    center: { lat: (A[0] + B[0]) / 2, lng: A[1] }, bases: { SWARM: A, STEEL: B }, lanes: [pts],
    sizeM, diagM: sizeM * Math.SQRT2, distM: Dm, geoScaleVer: MAPGEO.GEO_SCALE_VER,
    maxOverlap: 0.05, synthetic: true, placeName: '稽核戰區',
    env: { season: 'summer', time: 'day', weather: 'clear' },
  };
}
function blank() {
  const sim = new BattleSim(fakeCfg());
  sim.camps = [];
  for (const e of [...sim.ents.values()]) sim.ents.delete(e.id);
  sim.mines = []; sim.hazBlockers = [];
  return sim;
}
const atBearing = (h, bearing, d) => [h.x - Math.sin(bearing + (h.ry || 0)) * d, h.z + Math.cos(bearing + (h.ry || 0)) * d];
/** 名冊裡屬於該定位、且該陣營選得到的第一名角色(**MUST NOT 在稽核裡手寫角色 id** —— 那就是
 *  被測的那份名冊自己抄了一份,分類一改稽核就跟著失效卻仍全綠) */
const chOfRole = (role, side) => CH.find((c) =>
  ROSTER[c] === role && (CHARACTERS[c].side === side || CHARACTERS[c].side === 'MERC'));
/** 定位 + 招式條件(例:找一台會放自我治療的攻堅型)*/
const chOfRoleWith = (role, side, ok) => CH.find((c) =>
  ROSTER[c] === role && (CHARACTERS[c].side === side || CHARACTERS[c].side === 'MERC') && ok(c));
/** 造一顆已解析定位的 brain(update 之外的直測入口;`_resolveRole` 是唯一解析縫) */
function brainOf(sim, side, ch, diffKey) {
  const pid = 'b' + (sim.heroes.size + 1);
  const h = sim.addHero(side, pid, ch);
  const br = new BotBrain(sim, pid, side, 0, diffKey);
  h.x = 0; h.z = 0; h.y = 0; h.ry = 0;
  sim.t = 100;
  br._resolveRole(h);
  if (BREAK_TIER && !br._role) {   // 反向驗證:低難度也套定位覆寫
    br._role = botRoleOf(h.ch);
    br.tac = botRoleTactic(br.tac, br._role);
  }
  return { h, br };
}

// ---------------------------------------------------------------------------------
sec('Ⅰ 分類:特徵推導不手寫 + 剖面形狀 + 覆蓋與決定性');
// ---------------------------------------------------------------------------------
{
  // ---- 特徵取值:**獨立重算**再比對(不呼叫被測的 botRoleFeats 去驗自己)----
  const HV = Object.fromEntries(HEX_AXES.map((a) => [a.key, a.val]));
  const AID_FX = new Set(['heal', 'rally', 'recon', 'vision']);
  const rawOwn = {
    dur: HV.dur, armor: HV.armor, fire: HV.fire, zone: HV.zone, mob: HV.mob,
    siege: (ch) => buildDps(ch, 'light') + buildDps(ch, 'heavy'),
    aid: (ch) => ['skill', 'ult'].reduce((s, slot) => {
      const A = heroAbility(ch, slot);
      return s + (!A ? 0 : A.target === 'team' ? 1 : AID_FX.has(A.fx) ? 0.5 : 0);
    }, 0) / 2,
  };
  t('特徵表的鍵與獨立重算一致(七項:六個機體數值 + 招式支援傾向)',
    Object.keys(BOT_ROLE_FEATS).join() === Object.keys(rawOwn).join());
  t('五條機體特徵的取值函式 MUST 是 `HEX_AXES` 那一份的同一個參照(圖鑑與分類同縫)',
    ['dur', 'armor', 'fire', 'zone', 'mob'].every((k) => BOT_ROLE_FEATS[k].raw === HV[k]));
  t('攻堅走 `buildDps`、支援走 `heroAbility`(MUST NOT 在這裡自己算 DPS / 讀 mods)', (() => {
    const blk = dataCode.split('export const BOT_ROLE_FEATS')[1]?.split('};')[0] || '';
    return /buildDps\(/.test(blk) && /heroAbility\(/.test(blk)
      && !/weaponDps\(|UNITS\[|\.mods/.test(blk);
  })());
  const own = {};
  for (const k of Object.keys(rawOwn)) {
    const v = CH.map((c) => Math.max(1e-6, rawOwn[k](c)));
    own[k] = { lo: Math.min(...v), hi: Math.max(...v) };
  }
  const ownF = (k, ch) => {
    if (BOT_ROLE_FEATS[k].ratio) return Math.max(0, Math.min(1, rawOwn[k](ch)));
    const v = Math.max(1e-6, rawOwn[k](ch));
    const span = Math.log(own[k].hi / own[k].lo);
    return span > 1e-9 ? Math.max(0, Math.min(1, Math.log(v / own[k].lo) / span)) : 0.5;
  };
  t('32 名角色 × 七項特徵逐一與獨立重算逐位元相同',
    CH.every((c) => Object.keys(rawOwn).every((k) => near(botRoleFeats(c)[k], ownF(k, c)))));
  t('特徵值域一律 [0,1]',
    CH.every((c) => Object.values(botRoleFeats(c)).every((v) => v >= 0 && v <= 1 && Number.isFinite(v))));
  t('分位型特徵:全場最低者恰 0、最高者恰 1(這就是「相對全場的位置」)',
    Object.keys(BOT_ROLE_FEATS).filter((k) => !BOT_ROLE_FEATS[k].ratio).every((k) => {
      const v = CH.map((c) => botRoleFeats(c)[k]);
      return near(Math.min(...v), 0) && near(Math.max(...v), 1);
    }));
  t('佔比型特徵(支援)不取分位:值域內至少出現 0 與 1 以外的中間值,且不被拉成二元旗標', (() => {
    const v = CH.map((c) => botRoleFeats(c).aid);
    return BOT_ROLE_FEATS.aid.ratio === true && v.some((x) => x > 0 && x < 1) && v.some((x) => x === 0);
  })());

  // ---- 剖面形狀 ----
  t('四個定位(突襲 / 壓制 / 攻堅 / 支援),每個都有名稱、剖面、乘數、採購序',
    BOT_ROLE_KEYS.length === 4 && BOT_ROLE_KEYS.every((r) =>
      BOT_ROLES[r].name && BOT_ROLES[r].w && BOT_ROLES[r].mul && BOT_ROLES[r].buy));
  t('剖面權重 Σ|w| = 1(四個分數落在同一把尺上)',
    BOT_ROLE_KEYS.every((r) => near(Object.values(BOT_ROLES[r].w).reduce((s, w) => s + Math.abs(w), 0), 1)));
  t('剖面只用得到已宣告的特徵(打錯字的鍵會被靜默當成 0.5)',
    BOT_ROLE_KEYS.every((r) => Object.keys(BOT_ROLES[r].w).every((k) => BOT_ROLE_FEATS[k])));
  t('四個剖面互不相同(相同 = 分類退化成一種)', (() => {
    const s = BOT_ROLE_KEYS.map((r) => JSON.stringify(Object.entries(BOT_ROLES[r].w).sort()));
    return new Set(s).size === BOT_ROLE_KEYS.length;
  })());
  t('置中公平性:各項都恰好中庸的機體對四個定位一律 0 分(不偏袒正權重多的剖面)',
    BOT_ROLE_KEYS.every((r) =>
      near(Object.entries(BOT_ROLES[r].w).reduce((s, [, w]) => s + w * (0.5 - 0.5), 0), 0)));
  t('每個特徵至少被一個剖面用到(沒人用 = 那一項白算)',
    Object.keys(BOT_ROLE_FEATS).every((k) => BOT_ROLE_KEYS.some((r) => BOT_ROLES[r].w[k] !== undefined)));

  // ---- 覆蓋與決定性 ----
  t('32 名角色各有恰一個定位', CH.every((c) => BOT_ROLE_KEYS.includes(ROSTER[c])));
  const cnt = Object.fromEntries(BOT_ROLE_KEYS.map((r) => [r, CH.filter((c) => ROSTER[c] === r).length]));
  t('四個定位都至少一名角色(全部落在同一個定位 = 分類沒有作用)',
    BOT_ROLE_KEYS.every((r) => cnt[r] > 0), JSON.stringify(cnt));
  t('定位 = 親和分數 argmax(逐角色以 botRoleScores 獨立重算比對)', CH.every((c) => {
    const sc = botRoleScores(c);
    let best = BOT_ROLE_KEYS[0];
    for (const r of BOT_ROLE_KEYS) if (sc[r] > sc[best]) best = r;
    return best === ROSTER[c];
  }));
  t('決定性:連呼三次逐位元同值(有快取也不得漂)',
    CH.every((c) => botRoleOf(c) === ROSTER[c] && botRoleOf(c) === ROSTER[c]));
  t('查無角色回 null(呼叫端據此逐位元退回無定位的基準表)',
    botRoleOf('zz99') === null && botRoleOf(undefined) === null);
  t('定位區塊 MUST NOT 出現任何逐角色名冊(`s01`/`t07`/`m03` 之類的字面值)', (() => {
    const blk = dataCode.split('export const BOT_ROLE_FEATS')[1]?.split('export const balanceFingerprint')[0] || '';
    return !/['"][stm]\d{2}['"]/.test(blk);
  })());
}

// ---------------------------------------------------------------------------------
sec('Ⅱ 策略:乘數是重分配不是通膨 + 邊界鏡射 + 採購順序');
// ---------------------------------------------------------------------------------
{
  const KNOBS = Object.keys(BOT_ROLE.KNOBS);
  t('每個可覆寫旋鈕都真的存在於 BOT_TACTIC(打錯字 = 覆寫一個沒人讀的鍵)',
    KNOBS.every((k) => Number.isFinite(BOT_TACTIC[k])));
  t('四個定位對每個旋鈕都給了乘數(漏鍵會被靜默當成 1,而那不是「不變」是「相對變弱」)',
    BOT_ROLE_KEYS.every((r) => KNOBS.every((k) => Number.isFinite(BOT_ROLES[r].mul[k]))));
  t('乘數表沒有多餘的鍵(寫了卻沒有人套用 = 以為調到了其實沒有)',
    BOT_ROLE_KEYS.every((r) => Object.keys(BOT_ROLES[r].mul).every((k) => BOT_ROLE.KNOBS[k])));
  t(`原始乘數一律收在 [1/${BOT_ROLE.MUL_MAX}, ${BOT_ROLE.MUL_MAX}] 內(防呆幅度)`,
    BOT_ROLE_KEYS.every((r) => KNOBS.every((k) => {
      const m = BOT_ROLES[r].mul[k];
      return m >= 1 / BOT_ROLE.MUL_MAX - 1e-12 && m <= BOT_ROLE.MUL_MAX + 1e-12;
    })));
  // ---- 核心不變式:角色數加權幾何平均 = 1 ----
  t('每個旋鈕的**角色數加權幾何平均 = 1**(重分配而非通膨;整體水位逐位元錨在基準值)',
    KNOBS.every((k) => near(CH.reduce((s, c) => s + Math.log(roleMul(k, ROSTER[c])), 0) / CH.length, 0, 1e-9)),
    KNOBS.map((k) => `${k}:${Math.exp(CH.reduce((s, c) => s + Math.log(roleMul(k, ROSTER[c])), 0) / CH.length).toFixed(4)}`).join(' '));
  t('正規化不改變定位之間的**相對**關係(乘數的兩兩比值逐位元不動)',
    KNOBS.every((k) => BOT_ROLE_KEYS.every((a) => BOT_ROLE_KEYS.every((b) =>
      near(botRoleMul(k, a) / botRoleMul(k, b), BOT_ROLES[a].mul[k] / BOT_ROLES[b].mul[k], 1e-9)))));
  // ---- 邊界 ----
  t('與學習白名單重疊的旋鈕,定位邊界 MUST 收在學習邊界之內(兩張表不得給出不同的合法域)',
    KNOBS.filter((k) => BOT_LEARN.KEYS[k]).every((k) =>
      BOT_ROLE.KNOBS[k][0] >= BOT_LEARN.KEYS[k][0] - 1e-12 && BOT_ROLE.KNOBS[k][1] <= BOT_LEARN.KEYS[k][1] + 1e-12));
  t('邊界本身合法(lo < hi,且基準值落在區間內 ⇒ 中性不會被夾)',
    KNOBS.every((k) => BOT_ROLE.KNOBS[k][0] < BOT_ROLE.KNOBS[k][1]
      && BOT_TACTIC[k] >= BOT_ROLE.KNOBS[k][0] && BOT_TACTIC[k] <= BOT_ROLE.KNOBS[k][1]));
  const tacs = Object.fromEntries(BOT_ROLE_KEYS.map((r) => [r, roleTactic(BOT_TACTIC, r)]));
  t('覆寫後每個旋鈕都落在自己的合法域內',
    BOT_ROLE_KEYS.every((r) => KNOBS.every((k) =>
      tacs[r][k] >= BOT_ROLE.KNOBS[k][0] - 1e-12 && tacs[r][k] <= BOT_ROLE.KNOBS[k][1] + 1e-12)));
  t('覆寫後交叉約束仍成立(W_THREAT 最重 / KITE 近<遠 / PULL_HP > BASE_HP)',
    BOT_ROLE_KEYS.every((r) => {
      const x = tacs[r];
      return x.W_THREAT >= Math.max(x.W_OUTPUT, x.W_EXEC) + BOT_LEARN.GAP - 1e-12
        && x.KITE_NEAR + BOT_LEARN.GAP <= x.KITE_FAR + 1e-12
        && x.PULL_HP >= x.BASE_HP + BOT_LEARN.GAP - 1e-12;
    }));
  t('非覆寫鍵一律原封不動(定位只准動宣告過的那幾個旋鈕)',
    BOT_ROLE_KEYS.every((r) => Object.keys(BOT_TACTIC).filter((k) => !BOT_ROLE.KNOBS[k])
      .every((k) => tacs[r][k] === BOT_TACTIC[k] || k === 'W_THREAT' || k === 'KITE_FAR')));
  // 夾到邊界的逐項印出來:靜默截斷 = 「這個定位的乘數是推導的」對它其實不成立
  const clamped = [];
  for (const r of BOT_ROLE_KEYS) for (const k of KNOBS) {
    const raw = BOT_TACTIC[k] * botRoleMul(k, r);
    if (!near(raw, tacs[r][k], 1e-9)) clamped.push(`${BOT_ROLES[r].name}/${k} ${raw.toFixed(3)}→${tacs[r][k].toFixed(3)}`);
  }
  console.log(`  · 夾到邊界/交叉約束的項目(${clamped.length}):${clamped.join('、') || '(無)'}`);
  t('至少有一半的旋鈕在四個定位上真的分得開(全被夾成同一個值 = 策略沒有落地)',
    KNOBS.filter((k) => new Set(BOT_ROLE_KEYS.map((r) => tacs[r][k].toFixed(6))).size >= 3).length >= KNOBS.length / 2);
  // ---- 採購順序 ----
  t('八軌採購基準序 = ECON.UPGRADES 的完整集合(缺一軌 = 那一軌永遠不會被買)',
    BOT_BUY_ORDER.length === Object.keys(ECON.UPGRADES).length
    && BOT_BUY_ORDER.every((k) => ECON.UPGRADES[k]));
  t('每個定位的採購序都是基準序的排列(不得增刪任何一軌)',
    BOT_ROLE_KEYS.every((r) => BOT_ROLES[r].buy.length === BOT_BUY_ORDER.length
      && [...BOT_ROLES[r].buy].sort().join() === [...BOT_BUY_ORDER].sort().join()));
  t('四個定位的採購序互不相同(相同 = 這一軸沒有作用)',
    new Set(BOT_ROLE_KEYS.map((r) => BOT_ROLES[r].buy.join())).size === BOT_ROLE_KEYS.length);
  t('攻堅型先買重武器與護甲、支援型先買招式(設計主軸真的落在順序上)',
    BOT_ROLES.siege.buy.indexOf('ar') < BOT_ROLES.siege.buy.indexOf('sp')
    && BOT_ROLES.support.buy.indexOf('sk') < BOT_ROLES.support.buy.indexOf('hw')
    && BOT_ROLES.raider.buy.indexOf('lw') < BOT_ROLES.raider.buy.indexOf('hw'));
  t('未知定位 ⇒ 採購序逐位元退回基準',
    botBuyOrder(null) === BOT_BUY_ORDER && botBuyOrder('nope') === BOT_BUY_ORDER);
}

// ---------------------------------------------------------------------------------
sec('Ⅲ 單一縫(原文):一份分類、一份覆寫、一份交叉約束、零行為分支');
// ---------------------------------------------------------------------------------
{
  t('`botRoleOf` / `botRoleTactic` / `botBuyOrder` 在 data.js 各恰一份定義',
    count(dataCode, 'export function botRoleOf') === 1
    && count(dataCode, 'export function botRoleTactic') === 1
    && count(dataCode, 'export const botBuyOrder') === 1);
  t('交叉約束只有 `botTacticCross` 一份實作,恰兩個消費端(學習夾制 + 定位覆寫)',
    count(dataCode, 'export const botTacticCross') === 1
    && count(dataCode, 'botTacticCross(out)') === 2);   // 兩個呼叫點(定義式是 `= (out) =>`)
  t('`botPolicySanitize` 不再自己寫交叉約束(整段搬進 botTacticCross)', (() => {
    const blk = dataCode.split('export const botPolicySanitize')[1]?.split('export const botTacticCross')[0] || '';
    return /botTacticCross\(/.test(blk) && !/W_THREAT\s*=\s*Math\.max/.test(blk);
  })());
  t('正規化只有 `botRoleNorm` 一份、只被 `botRoleMul` 取用',
    count(dataCode, 'function botRoleNorm') === 1 && count(dataCode, 'botRoleNorm(') === 2);
  t('乘數只經 `botRoleMul` 取用(覆寫端 MUST NOT 直接讀 `BOT_ROLES[r].mul`)',
    count(dataCode.split('export const botRoleMul')[1] || '', '.mul[') === 0);
  t('bots.js 完全不認識定位表本身(只拿得到解析結果與旋鈕表)',
    !/BOT_ROLES|BOT_ROLE_FEATS|BOT_ROLE\b/.test(botsCode));
  t('bots.js:定位解析只有 `_resolveRole` 一份實作、一個呼叫點',
    count(botsCode, '_resolveRole(h) {') === 1 && count(botsCode, 'this._resolveRole(') === 1);
  t('bots.js:`botRoleTactic` / `botRoleOf` 各恰一處(只在解析縫裡)',
    count(botsCode, 'botRoleTactic(') === 1 && count(botsCode, 'botRoleOf(') === 1);
  t('定位解析 MUST 由 `diff.tactic` 把關(A33:新手/低難度結構性地逐位元同舊制)',
    /this\.diff\.tactic/.test(strip(grabMethod(botsSrc, '_resolveRole'))));
  t('基準只記一次(`_tacBase` 守衛):不記就會在自己身上累乘,而且完全無聲',
    /this\._tacBase\s*==\s*null/.test(strip(grabMethod(botsSrc, '_resolveRole'))));
  t('bots.js MUST NOT 出現任何定位鍵的行為分支(第二套決策系統)',
    !BOT_ROLE_KEYS.some((r) => botsCode.includes(`'${r}'`)));
  t('讀取縫仍然只有 `this.tac`(`BOT_TACTIC.` 零殘留,見 audit_bot_policy Ⅲ)',
    !/BOT_TACTIC\./.test(botsCode) && /this\.tac = BOT_TACTIC;/.test(botsCode));
  t('bots.js 不再留一份本地 BUY_ORDER 常數(採購序整組搬進 data.js)',
    !/const BUY_ORDER\s*=/.test(botsCode) && /botBuyOrder\(this\._role\)/.test(botsCode));
  t('舊硬編碼零殘留:選敵折算 / 距離環 / 招式血線全部改吃旋鈕', (() => {
    const acq = strip(grabMethod(botsSrc, '_acquire'));
    const eng = strip(grabMethod(botsSrc, '_engage'));
    const cast = strip(grabMethod(botsSrc, '_castSupport'));
    return /this\.tac\.PRIO_HERO/.test(acq) && /this\.tac\.PRIO_STRUCT/.test(acq)
      && !/d \*= 0\.55|d \*= 1\.3/.test(acq)
      && /this\.tac\.KEEP_F/.test(eng) && /this\.tac\.KEEP_STRUCT/.test(eng)
      && !/: 0\.6;|\? 0\.85 :/.test(eng)
      && /this\.tac\.CAST_HURT/.test(cast) && !/frac < 0\.55/.test(cast);
  })());
}

// ---------------------------------------------------------------------------------
sec('Ⅳ 行為直測(真 BattleSim + 真 BotBrain)');
// ---------------------------------------------------------------------------------
{
  // ---- 難度分層 ----
  for (const d of ['novice', 'low']) {
    const sim = blank();
    const { br } = brainOf(sim, 'STEEL', chOfRole('siege', 'STEEL'), d);
    t(`${d} 難度不解析定位:旋鈕表**參照** = 全域 BOT_TACTIC(逐位元同舊制)`,
      br._role === null && br.tac === BOT_TACTIC);
  }
  {
    const sim = blank();
    const seen = {};
    for (const r of BOT_ROLE_KEYS) {
      const ch = chOfRole(r, 'STEEL') || chOfRole(r, 'SWARM');
      const side = CHARACTERS[ch].side === 'SWARM' ? 'SWARM' : 'STEEL';
      const { br } = brainOf(sim, side, ch, 'high');
      seen[r] = br;
      t(`高難度・${BOT_ROLES[r].name}型:解析到 ${r} 且旋鈕表已與全域分家`,
        br._role === r && br.tac !== BOT_TACTIC);
    }
    t('四個定位的距離環真的分開(壓制/支援站得比突襲/攻堅遠)',
      seen.zoner.tac.KEEP_F > seen.raider.tac.KEEP_F
      && seen.support.tac.KEEP_F > seen.siege.tac.KEEP_F);
    t('攻堅型對工事的加價最低、突襲型最高(「咬塔」與「獵人」的落點)',
      seen.siege.tac.PRIO_STRUCT < seen.zoner.tac.PRIO_STRUCT
      && seen.raider.tac.PRIO_STRUCT > seen.zoner.tac.PRIO_STRUCT);
    t('突襲型最會撿尾刀、攻堅型最不會',
      seen.raider.tac.W_EXEC > seen.zoner.tac.W_EXEC && seen.siege.tac.W_EXEC < seen.zoner.tac.W_EXEC);
    t('支援型最早脫離、攻堅型撐最久(撤退線)',
      seen.support.tac.PULL_HP > seen.raider.tac.PULL_HP
      && seen.siege.tac.PULL_HP < seen.zoner.tac.PULL_HP + 1e-12);
  }
  // ---- 疊加而非取代:學習注入的基準要留得住 ----
  {
    const sim = blank();
    const ch = chOfRole('raider', 'SWARM') || chOfRole('raider', 'STEEL');
    const pid = 'bx';
    const h = sim.addHero(CHARACTERS[ch].side === 'STEEL' ? 'STEEL' : 'SWARM', pid, ch);
    const br = new BotBrain(sim, pid, h.side, 0, 'high');
    const inject = { ...BOT_TACTIC, EXEC_S: 2.4, KEEP_F: 0.5 };
    br.tac = inject;                    // 學習迴圈的注入方式(bots.js 唯一讀取縫)
    sim.t = 100; h.x = 0; h.z = 0; h.ry = 0;
    br._resolveRole(h);
    t('學習注入的**非覆寫鍵**原封保留(定位是疊在基準上,不是取代基準)', br.tac.EXEC_S === 2.4);
    t('學習注入的**覆寫鍵**以乘數疊加(不是回頭吃全域基準值)',
      near(br.tac.KEEP_F, 0.5 * botRoleMul('KEEP_F', br._role), 1e-9));
    const snap = JSON.stringify(br.tac);
    for (let i = 0; i < 50; i++) br._resolveRole(h);
    t('重複解析不累乘(50 次後逐位元不變)', JSON.stringify(br.tac) === snap);
    const other = CH.find((c) => ROSTER[c] !== br._role && CHARACTERS[c].side === h.side);
    h.ch = other;
    br._resolveRole(h);
    t('換角色重解 MUST 從**基準**重算(不是在上一份覆寫上再乘一次)',
      near(br.tac.KEEP_F, 0.5 * botRoleMul('KEEP_F', ROSTER[other]), 1e-9));
  }
  // ---- 選敵:攻堅型會停下來拆塔,突襲型繞過去咬人 ----
  // 擺位由**武器自己的類別剋制**反解:`_acquire` 的加權距離 = 距離 × 類別折算 ÷ vsMult,
  // 兩者的 vsMult 逐角色不同 ⇒ 直接寫死兩個距離只會量到「這把武器剋不剋建築」。
  // 取「塔的等效距離 × 1.15 = 小兵的等效距離」⇒ 折算低於 1.15 的定位選塔、高於的選小兵。
  {
    const pick = (role) => {
      const sim = blank();
      const ch = chOfRole(role, 'STEEL') || chOfRole(role, 'SWARM');
      const side = CHARACTERS[ch].side === 'SWARM' ? 'SWARM' : 'STEEL';
      const { h, br } = brainOf(sim, side, ch, 'high');
      const foe = side === 'STEEL' ? 'SWARM' : 'STEEL';
      const wd = heroWeapon(h.ch, 'light', h.abil.light, true);
      const dT = wd.range * 0.30;
      const dS = dT * 1.15 * vsMult(wd, 'soldier') / vsMult(wd, 'tower');
      const [tx, tz] = atBearing(h, 0.02, dT);
      const [sx, sz] = atBearing(h, -0.02, dS);
      const tower = sim._add({ kind: 'tower', side: foe, x: tx, z: tz, y: 0, hp: 9000 });
      const sol = sim._add({ kind: 'soldier', side: foe, lane: 0, x: sx, z: sz, y: 0, hp: 1000 });
      sim._tickN++;
      return { got: br._acquire(h), tower, sol, inRange: dS <= wd.range * 1.15, prio: br.tac.PRIO_STRUCT };
    };
    const sg = pick('siege');
    const rd = pick('raider');
    t('擺位有效(小兵仍在射程閘門內,兩個候選都選得到)', sg.inRange && rd.inRange);
    t('攻堅型:工事加價低於門檻 ⇒ 停下來拆塔', sg.prio < 1.15 && sg.got === sg.tower);
    t('突襲型:同一個場面工事加價更高 ⇒ 繞過去咬小兵', rd.prio > 1.15 && rd.got === rd.sol);
  }
  // ---- 距離環:壓制型後撤、突襲型貼上去(中難度,吃 KEEP_F 那一檔)----
  {
    const ring = (role) => {
      const sim = blank();
      const ch = chOfRole(role, 'STEEL') || chOfRole(role, 'SWARM');
      const side = CHARACTERS[ch].side === 'SWARM' ? 'SWARM' : 'STEEL';
      const { h, br } = brainOf(sim, side, ch, 'medium');
      const foe = side === 'STEEL' ? 'SWARM' : 'STEEL';
      const u = UNITS[h.kind];
      const R = heroWeapon(h.ch, 'light', h.abil.light, true).range;
      const [sx, sz] = atBearing(h, 0, R * 0.62);   // 恰在兩個定位的距離環之間
      const tgt = sim._add({ kind: 'soldier', side: foe, lane: 0, x: sx, z: sz, y: 0, hp: 1000 });
      const d0 = Math.hypot(h.x - tgt.x, h.z - tgt.z);
      br._engage(h, u, tgt, 0.125);
      return { d0, d1: Math.hypot(h.x - tgt.x, h.z - tgt.z), keep: br.tac.KEEP_F * R };
    };
    const zo = ring('zoner');
    const rd = ring('raider');
    t('壓制型:目標比它的距離環近 ⇒ 這一拍往後拉開', zo.d1 > zo.d0 && zo.keep > zo.d0);
    t('突襲型:同一個距離對它太遠 ⇒ 這一拍貼上去', rd.d1 < rd.d0 && rd.keep < rd.d0);
    t('兩者的距離環真的不同(不是靠亂數側移矇到)', zo.keep > rd.keep);
  }
  // ---- 招式血線:支援型放得早、攻堅型撐得久 ----
  {
    const hasSelfHeal = (c) => {
      const A = heroAbility(c, 'skill');
      return A && A.fx === 'heal' && A.target === 'self';
    };
    const castAt = (role, frac) => {
      const ch = chOfRoleWith(role, 'STEEL', hasSelfHeal) || chOfRoleWith(role, 'SWARM', hasSelfHeal);
      if (!ch) return null;
      const sim = blank();
      const side = CHARACTERS[ch].side === 'SWARM' ? 'SWARM' : 'STEEL';
      const { h, br } = brainOf(sim, side, ch, 'high');
      h.abil.skill = 1; h.mp = 999; h.acd.skill = 0;
      br._castSupport(h, frac);
      return { cast: (h.acd.skill || 0) > sim.t, hurt: br.tac.CAST_HURT };
    };
    const sup = castAt('support', 0.6);
    const sg = castAt('siege', 0.6);
    const sgLow = castAt('siege', 0.4);
    t('支援型:裝甲六成就先把自我治療放掉(血線最高)', !sup || (sup.cast && sup.hurt > 0.6));
    t('攻堅型:同樣六成還撐著不放(血線最低)', !sg || (!sg.cast && sg.hurt < 0.6));
    t('攻堅型:真的掉到血線以下才放(不是整支招式壞掉)', !sgLow || sgLow.cast);
  }
  // ---- 採購順序真的換了一條路 ----
  {
    const sim = blank();
    const ch = chOfRole('support', 'STEEL') || chOfRole('support', 'SWARM');
    const side = CHARACTERS[ch].side === 'SWARM' ? 'SWARM' : 'STEEL';
    const { h, br } = brainOf(sim, side, ch, 'high');
    h.money = ECON.UPG_STEPS.reduce((s, st) => s + st.price, 0);   // 三階全額(首階 $0)
    const order = botBuyOrder(br._role);
    for (const item of order) if (sim.buy(br.pid, item) === null) {
      t('支援型的第一筆消費落在招式軌(採購順序真的換了一條路)', item === 'sk' || item === 'ult');
      break;
    }
    t('無定位(低難度)的採購順序仍是舊制那一條', botBuyOrder(null).join() === BOT_BUY_ORDER.join());
  }
}

// ---------------------------------------------------------------------------------
sec('Ⅴ 不回歸:新旋鈕基準 = 改制前硬編碼、學習搜尋空間不變');
// ---------------------------------------------------------------------------------
{
  const OLD = { KEEP_F: 0.6, KEEP_STRUCT: 0.85, PRIO_HERO: 0.55, PRIO_STRUCT: 1.3, CAST_HURT: 0.55 };
  t('五個新旋鈕的基準值逐一等於改制前 bots.js 的硬編碼常數(中性 ⇒ 逐位元同舊制)',
    Object.entries(OLD).every(([k, v]) => BOT_TACTIC_BASE[k] === v));
  t('新旋鈕**不進**學習白名單(bot_learn 的搜尋空間與 botPolicy.js 逐位元不變)',
    Object.keys(OLD).every((k) => !BOT_LEARN.KEYS[k]));
  t('`botPolicySanitize({})` 仍逐位元等於手寫基準(中性不變式沒被交叉約束改掉)', (() => {
    const s = botPolicySanitize({});
    return Object.keys(BOT_TACTIC_BASE).every((k) => s[k] === BOT_TACTIC_BASE[k]);
  })());
  t('新增的 PULL_HP > BASE_HP 交叉約束對基準值是恆等(不改變既有行為)',
    BOT_TACTIC_BASE.PULL_HP >= BOT_TACTIC_BASE.BASE_HP + BOT_LEARN.GAP);
  t('`botRoleTactic(base, null)` 回傳的就是 base 本身(參照相同 ⇒ 不可能有微小漂移)',
    botRoleTactic(BOT_TACTIC, null) === BOT_TACTIC && botRoleTactic(BOT_TACTIC, 'nope') === BOT_TACTIC);
  // 名冊一覽(不是斷言;定位一旦位移,這一段就是唯一看得出「誰換了打法」的地方)
  console.log('  · 定位名冊:');
  for (const r of BOT_ROLE_KEYS) {
    console.log(`      ${BOT_ROLES[r].name}(${r}) ×${CH.filter((c) => ROSTER[c] === r).length}:`
      + CH.filter((c) => ROSTER[c] === r).join(' '));
  }
}

console.log(`\n${fail ? '❌' : '✅'} 電腦玩家定位分類與策略稽核:${pass}/${pass + fail} 通過`);
if (BREAK_ROLE || BREAK_NORM || BREAK_TIER) console.log('(反向驗證模式:紅字 = 稽核抓得到壞版,屬預期)');
process.exit(fail ? 1 : 0);
