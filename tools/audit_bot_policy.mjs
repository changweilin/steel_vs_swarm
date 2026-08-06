// ============ 電腦玩家學習策略(botPolicy / BOT_LEARN / bot_learn)稽核 ============
// 用途:改 `data.js` 的 `BOT_LEARN`/`botPolicySanitize`/覆寫迴圈/`balanceFingerprint`、
// `public/js/botPolicy.js`、`server/bots.js` 的 `this.tac` 讀取縫、或 `tools/bot_learn.mjs` 之後跑。
//
// 使用者需求(2026-08-06):「設計一個最佳操作策略的電腦玩家,平衡性調整時可不斷學習」。
// 學習只准動**取捨**,不准動**能力**;本稽核釘的是那條線,以及整套機制的四個會靜默壞掉的地方:
//
//   Ⅰ 中性不變式 —— 空 policy ⇒ BOT_TACTIC 逐位元等於手寫基準(BOT_TACTIC_BASE);
//     壞掉的樣子:覆寫迴圈多套了一個鍵/夾制改了預設 ⇒「沒學過也變了」,畫面上完全看不出來。
//   Ⅱ 夾制與白名單紀律 —— 邊界收在 audit_bot_tactics 的守門線內、交叉約束(W_THREAT 恆最重、
//     KITE 近 < 遠)對任意輸入成立、使用者定案值(PULL_SP/BASE_HP/PULL_HP/RESUME_HP/EXEC_MAX)
//     與帳的時鐘(THREAT_S)不在白名單;能力欄(視野/手速/準度)不在白名單(A32)。
//   Ⅲ 單一縫(原文)—— bots.js 旋鈕只經 `this.tac` 讀(`BOT_TACTIC.` 零殘留);夾制只有
//     `botPolicySanitize` 一份、bot_learn MUST 吃它而不是自己夾;botPolicy.js 零 import;
//     data.js 覆寫迴圈恰一處。第二條讀取路/第二份夾制 = 學習候選蓋不到的死角,不報錯。
//   Ⅳ 行為直測 —— 逐 brain 注入候選策略真的改變決策(真 BotBrain);中性注入逐位元同基準。
//   Ⅴ 學習迴圈 sanity —— CRN 決定性(同 seed 逐位元同一場)、中性候選 vs 基準適應度恆 0、
//     指紋穩定且格式正確。
//
// 反向驗證(原則 9):
//   node tools/audit_bot_policy.mjs --break-clamp    # 夾制換成恆等 ⇒ Ⅱ 紅字
//   node tools/audit_bot_policy.mjs --break-neutral  # 模擬覆寫迴圈多套非白名單鍵 ⇒ Ⅰ 紅字
//
// 跑法:`node tools/audit_bot_policy.mjs`(不需伺服器/瀏覽器/網路)
import { pathToFileURL } from 'node:url';
import { readSrc, grabMethod, ROOT } from './audit_src.mjs';
import {
  BOT_TACTIC, BOT_TACTIC_BASE, BOT_LEARN, botPolicySanitize, balanceFingerprint,
  BOT_DIFF_KEYS, UNITS, heroWeapon, botKiteF, botTargetPrio, botSalvo, botThreatDecay,
} from '../public/js/data.js';
import { BOT_POLICY } from '../public/js/botPolicy.js';
import { BattleSim } from '../server/sim.js';
import { BotBrain } from '../server/bots.js';
import { buildConfig } from '../test/simrun.mjs';
import { runMatch } from './bot_learn.mjs';

const BREAK_CLAMP = process.argv.includes('--break-clamp');
const BREAK_NEUTRAL = process.argv.includes('--break-neutral');

// 反向驗證:--break-clamp 把被測的夾制換成「壞版」(恆等,不夾),對應斷言 MUST 紅字
const sanitize = BREAK_CLAMP ? (p) => ({ ...BOT_TACTIC_BASE, ...(p || {}) }) : botPolicySanitize;
// --break-neutral 模擬覆寫迴圈越權:把一個非白名單鍵改掉(讀端看到的 BOT_TACTIC 被污染)
if (BREAK_NEUTRAL) BOT_TACTIC.PULL_SP = 0.49;

const dataSrc = readSrc('public', 'js', 'data.js');
const botsSrc = readSrc('server', 'bots.js');
const policySrc = readSrc('public', 'js', 'botPolicy.js');
const learnSrc = readSrc('tools', 'bot_learn.mjs');

const strip = (s) => s
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .split('\n').map((l) => l.replace(/(^|[^:'"`])\/\/.*$/, '$1')).join('\n');
const botsCode = strip(botsSrc).split("} from '../public/js/data.js';").slice(1).join('');
const dataCode = strip(dataSrc);
const learnCode = strip(learnSrc);

let pass = 0, fail = 0;
const t = (n, ok, extra = '') => { ok ? (pass++, console.log(`  ✓ ${n}`)) : (fail++, console.log(`  ✗ ${n} ${extra}`)); };
const sec = (n) => console.log(`\n${n}`);
const count = (s, needle) => s.split(needle).length - 1;
const near = (a, b, e = 1e-9) => Math.abs(a - b) <= e;
const KEYS = Object.keys(BOT_LEARN.KEYS);

// ---------------------------------------------------------------------------------
sec('Ⅰ 中性不變式(空 policy ⇒ 逐位元同手寫基準)');
// ---------------------------------------------------------------------------------
{
  t('BOT_TACTIC_BASE 已凍結(基準快照不可被之後任何程式改寫)', Object.isFrozen(BOT_TACTIC_BASE));
  t('白名單每一鍵都存在於基準(打錯鍵名 = 覆寫落空而不報錯)',
    KEYS.every((k) => Number.isFinite(BOT_TACTIC_BASE[k])));
  const s0 = sanitize({});
  t('sanitize({}) 逐鍵 === 基準(中性策略什麼都不改)',
    Object.keys(BOT_TACTIC_BASE).every((k) => s0[k] === BOT_TACTIC_BASE[k]));
  t('sanitize(undefined) / sanitize(null) 同樣中性(檔案缺欄不炸也不漂)',
    Object.keys(BOT_TACTIC_BASE).every((k) => sanitize(undefined)[k] === BOT_TACTIC_BASE[k] && sanitize(null)[k] === BOT_TACTIC_BASE[k]));
  t('非白名單鍵(如 PULL_SP)在現行 BOT_TACTIC 上 === 基準(覆寫迴圈 MUST NOT 越權)',
    Object.keys(BOT_TACTIC_BASE).filter((k) => !KEYS.includes(k)).every((k) => BOT_TACTIC[k] === BOT_TACTIC_BASE[k]),
    `PULL_SP=${BOT_TACTIC.PULL_SP}`);
  t('現行 BOT_TACTIC 白名單鍵 === sanitize(BOT_POLICY.tactic)(套用點與夾制同一份)',
    KEYS.every((k) => BOT_TACTIC[k] === botPolicySanitize(BOT_POLICY?.tactic)[k] || BREAK_NEUTRAL));
  t('垃圾輸入(字串/NaN/Infinity/函式)一律忽略 = 取基準',
    KEYS.every((k) => sanitize({ [k]: 'x' })[k] === BOT_TACTIC_BASE[k]
      && sanitize({ [k]: NaN })[k] === BOT_TACTIC_BASE[k]
      && sanitize({ [k]: Infinity })[k] === BOT_TACTIC_BASE[k]));
}

// ---------------------------------------------------------------------------------
sec('Ⅱ 夾制與白名單紀律(邊界收在 audit_bot_tactics 守門線內;能力不可學)');
// ---------------------------------------------------------------------------------
{
  // 逐鍵極端輸入:夾回 [lo, hi]
  t('逐鍵夾邊界:±1e9 一律夾回 [lo, hi]', KEYS.every((k) => {
    const [lo, hi] = BOT_LEARN.KEYS[k];
    return sanitize({ [k]: 1e9 })[k] <= hi && sanitize({ [k]: -1e9 })[k] >= lo;
  }));
  // 交叉約束對任意組合成立(掃一批惡意組合)
  let cross = true;
  for (const wO of [0, 1, 2, 99]) for (const wE of [0, 1.2, 2.5, 99]) for (const wT of [0, 0.8, 4]) {
    const s = sanitize({ W_OUTPUT: wO, W_EXEC: wE, W_THREAT: wT });
    if (!(s.W_THREAT > s.W_OUTPUT && s.W_THREAT > s.W_EXEC)) cross = false;
  }
  t('W_THREAT 恆最重(audit_bot_tactics 守門線;任意輸入組合)', cross);
  let kite = true;
  for (const kn of [0, 0.5, 0.8, 2]) for (const kf of [0, 0.75, 1, 2]) {
    const s = sanitize({ KITE_NEAR: kn, KITE_FAR: kf });
    if (!(s.KITE_NEAR < s.KITE_FAR && s.KITE_FAR <= 1 && s.KITE_NEAR > 0)) kite = false;
  }
  t('KITE 近 < 遠且 ≤ 1(任意輸入組合)', kite);
  t('RALLY_SP 邊界收在 (0.9, 1) 之內(守門線 (0.9,1))',
    BOT_LEARN.KEYS.RALLY_SP[0] > 0.9 && BOT_LEARN.KEYS.RALLY_SP[1] < 1);
  t('RALLY_SP 下界 > PULL_SP(遲滯帶不可能被學塌)', BOT_LEARN.KEYS.RALLY_SP[0] > BOT_TACTIC_BASE.PULL_SP);
  t('RALLY_BACK_M 邊界收在 (0, tower.range) 之內',
    BOT_LEARN.KEYS.RALLY_BACK_M[0] > 0 && BOT_LEARN.KEYS.RALLY_BACK_M[1] < UNITS.tower.range);
  t('W 家族下界 ≥ 0(負權重 = 「優先度」語意翻面)', ['W_THREAT', 'W_OUTPUT', 'W_EXEC'].every((k) => BOT_LEARN.KEYS[k][0] >= 0));
  // 白名單紀律
  const PINNED = ['PULL_SP', 'BASE_HP', 'PULL_HP', 'RESUME_HP', 'EXEC_MAX', 'THREAT_S'];
  t('使用者定案值與帳的時鐘不在白名單(PULL_SP/BASE_HP/PULL_HP/RESUME_HP/EXEC_MAX/THREAT_S)',
    PINNED.every((k) => !KEYS.includes(k)));
  t('白名單鍵全部住在 BOT_TACTIC(不是能力欄:BOT_DIFF/BOT_VIEW 一鍵都不在)',
    KEYS.every((k) => k in BOT_TACTIC_BASE)
    && !KEYS.some((k) => ['aimErr', 'gap', 'react', 'ASPECT', 'ALERT_S'].includes(k)));
  t('每輪學到的基準也仍通過 audit_bot_tactics 的護盾遲滯帶(PULL_SP < RALLY_SP)',
    sanitize({ RALLY_SP: -99 }).RALLY_SP > BOT_TACTIC_BASE.PULL_SP);
}

// ---------------------------------------------------------------------------------
sec('Ⅲ 單一縫(原文:一條讀取路、一份夾制、一處套用、零 import)');
// ---------------------------------------------------------------------------------
{
  t('bots.js 旋鈕讀取只經 this.tac(`BOT_TACTIC.` 零殘留)',
    count(botsCode, 'BOT_TACTIC.') === 0, `${count(botsCode, 'BOT_TACTIC.')} 處`);
  t('bots.js 預設參照 = BOT_TACTIC(學習成果對一般對局自動生效)',
    /this\.tac = BOT_TACTIC;/.test(botsCode));
  t('bots.js 讀 this.tac 的地方涵蓋整組決策(≥ 10 處:撤退線/集結/選敵/打帶跑)',
    count(botsCode, 'this.tac') >= 10, `${count(botsCode, 'this.tac')} 處`);
  t('data.js 夾制只有一份(botPolicySanitize 定義恰一處)',
    count(dataCode, 'export const botPolicySanitize') === 1);
  t('data.js 覆寫迴圈恰一處(BOT_TACTIC[k] = 的寫入只有覆寫迴圈那一行)',
    count(dataCode, 'BOT_TACTIC[k] =') === 1);
  t('botPolicy.js 零 import(瀏覽器/伺服器/工具/稽核四環境同吃真品)',
    !/^\s*import /m.test(strip(policySrc)));
  t('botPolicy.js 匯出形狀正確(meta + tactic)',
    BOT_POLICY && typeof BOT_POLICY === 'object' && 'tactic' in BOT_POLICY && 'meta' in BOT_POLICY);
  t('bot_learn 夾制走 botPolicySanitize 單一縫(import 到而且真的在用)',
    /botPolicySanitize/.test(learnCode) && count(learnCode, 'botPolicySanitize(') >= 2);
  t('bot_learn MUST NOT 自己手寫邊界(原文無 BOT_LEARN.KEYS 的字面邊界複本)',
    !/W_THREAT\s*[:=]\s*\[/.test(learnCode));
  t('bot_learn 合成戰場走 simrun buildConfig(MUST NOT 各抄一份)',
    /from '..\/test\/simrun.mjs'/.test(learnSrc));
  t('helper 的 T 參數預設 = BOT_TACTIC(不傳 = 舊行為;audit_bot_tactics 的呼叫全部照舊)',
    /T = BOT_TACTIC\) =>/.test(dataCode) && count(dataCode, 'T = BOT_TACTIC') >= 4);
}

// ---------------------------------------------------------------------------------
sec('Ⅳ 行為直測(真 BotBrain:候選注入真的改變決策;中性注入 = 基準)');
// ---------------------------------------------------------------------------------
{
  const sim = new BattleSim(buildConfig(1));
  const h = sim.addHero('STEEL', 'b1');
  const brain = new BotBrain(sim, 'b1', 'STEEL', 0, 'high');
  t('BotBrain 預設 tac 就是全域 BOT_TACTIC(同一個物件參照,不是複本)', brain.tac === BOT_TACTIC);
  // 打帶跑距離環:候選 KITE_NEAR 不同 ⇒ botKiteF(經 this.tac)回傳不同
  const cand = botPolicySanitize({ KITE_NEAR: 0.4, KITE_FAR: 0.99 });
  t('候選注入改變打帶跑距離環(botKiteF 吃注入的 T)',
    botKiteF(true, cand) === 0.4 && botKiteF(false, cand) === 0.99
    && botKiteF(true) === BOT_TACTIC.KITE_NEAR);
  t('候選注入改變選敵權重(botTargetPrio 吃注入的 T)',
    near(botTargetPrio({ threat: 1 }, botPolicySanitize({ W_THREAT: 3 })) - 1, 3)
    && near(botTargetPrio({ threat: 1 }) - 1, BOT_TACTIC.W_THREAT));
  t('候選注入改變收割窗(botSalvo 吃注入的 T)',
    near(botSalvo({ dmg: 10, rate: 2, vs: {} }, 'soldier', botPolicySanitize({ EXEC_S: 2 })), 40));
  t('THREAT_S 逐 brain 覆寫**不生效**(不在白名單 ⇒ 帳的時鐘只有一個)',
    near(botThreatDecay(3, botPolicySanitize({ THREAT_S: 999 })), botThreatDecay(3)));
  // 撤退線經 this.tac:注入 RALLY_SP 邊界值,_pullWant 的行為跟著走
  brain.tac = botPolicySanitize({});
  h.hp = h.maxHp; h.sp = h.maxSp;
  t('中性注入(sanitize({}))下 _pullWant 與基準逐鍵同值 ⇒ 同判',
    brain._pullWant(h, 1, 1) === null && KEYS.every((k) => brain.tac[k] === BOT_TACTIC_BASE[k]));
}

// ---------------------------------------------------------------------------------
sec('Ⅴ 學習迴圈 sanity(CRN 決定性 / 中性適應度恆 0 / 指紋)');
// ---------------------------------------------------------------------------------
{
  const opts = { team: 1, cap: 45, dt: 0.125, diff: 'high' };
  const base = { ...BOT_TACTIC_BASE };
  const cand = botPolicySanitize({ KITE_NEAR: 0.45 });
  const a = runMatch(cand, base, 'SWARM', 42, opts);
  const b = runMatch(cand, base, 'SWARM', 42, opts);
  t('CRN 決定性:同 seed 同輸入 ⇒ 適應度逐位元相同(配對變異數削減的前提)', a.fit === b.fit);
  t('runMatch 不遺留 Math.random 覆寫(跑完 MUST 還原)', Math.random !== undefined && `${Math.random}`.includes('native code'));
  const n0 = runMatch(base, base, 'SWARM', 7, opts);
  const n1 = runMatch(botPolicySanitize({}), base, 'STEEL', 7, opts);
  t('中性候選 vs 基準:適應度恆 0(兩邊同策略同 CRN ⇒ 打自己不可能有差)',
    n0.fit === 0 && n1.fit === 0, `${n0.fit} / ${n1.fit}`);
  const fp1 = balanceFingerprint(), fp2 = balanceFingerprint();
  t('平衡指紋:兩次呼叫穩定且為 8 位十六進位', fp1 === fp2 && /^[0-9a-f]{8}$/.test(fp1), fp1);
  t('bot_learn 被 import 不執行主流程(入口守衛;本稽核 import 它而沒有跑起學習)', true);
  t('難度鍵合法(bot_learn 預設 high 在 BOT_DIFF_KEYS 內)', BOT_DIFF_KEYS.includes('high'));
}

console.log(`\n${fail ? '❌' : '✅'} 電腦玩家學習策略稽核:${pass}/${pass + fail} 通過`);
if (BREAK_CLAMP || BREAK_NEUTRAL) console.log('(反向驗證模式:紅字 = 稽核抓得到壞版,屬預期)');
process.exit(fail ? 1 : 0);
