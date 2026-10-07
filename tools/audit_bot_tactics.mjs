// ============ Bot tactics (target priority / retreat line / hit-and-run) audit (2026-08-02 user request) ============
// Requirement source: "mid/high-tier bot operation optimization: when hit, prioritize whoever deals
// the highest damage to self, deals the greatest total damage to enemies, or is about to die /
// retreat to behind the nearest turret when HP is below 25% and wait for shields, otherwise hold the
// line until shields refill" / "high-tier bot optimization: kill-stealing, hit-and-run, pulling back
// after tanking half a shield".
// Run after changing `data.js` `BOT_DIFF.tactic/elite`, `BOT_TACTIC`/`botTargetPrio`/`botThreatDecay`/
// `botSalvo`/`botExecW`/`botKiteF`, `sim.js` `_dmgOut`/`_hurtLog` threat books, or `bots.js`
// `_pullWant`/`_enterPull`/`_resume`/`_pickRally`/`_rally`/`_pulling`/`_threatOf`/`_prioritize`/
// `_acquire`/`_engage`: `node tools/audit_bot_tactics.mjs`
//
// This file watches the "plays wrong but nothing looks wrong" breakage family:
//   1 Threat book kept separately: the server's only knowledge of "who dealt how much to me" is
//     `_hurtLog`; a second book inevitably splits from the blood-splash/alert one (A1 family).
//   2 Output book recording only the normal-settlement path: fully-shield-blocked shots all go
//     unlogged ⇒ high-shield opponents are systematically underestimated — exactly the people who
//     should be focused. Reads perfectly normally in code, just "the AI seems bad at picking targets".
//   3 Retreat hysteresis band deleted: same threshold in and out ⇒ pulls back, shield refills, goes
//     back in, still low, pulls again — the whole lane watches one bot pace back and forth, looking
//     merely "hesitant" on screen.
//   4 Difficulty tiers written as difficulty-string comparisons: a second tier table that will not
//     follow BOT_DIFF changes.
//   5 Rookies/low tiers "optimized" along the way: the whole difficulty ladder collapses (rookies
//     fight as fiercely as high tiers).
//
// Method: constants/curves imported directly (data.js is a pure module), source via the `audit_src.mjs`
// single seam, behavior always measured with a **genuine BattleSim + genuine BotBrain**.
import { readSrc, grabMethod } from './audit_src.mjs';
import {
  BOT_DIFF, BOT_DIFF_KEYS, BOT_TACTIC, botTargetPrio, botThreatDecay, botSalvo, botExecW, botKiteF,
  UNITS, GAME, CHARACTERS, heroKindOf, heroWeapon, MAPGEO, VITALS,
} from '../public/js/data.js';
import { BattleSim, pointAt } from '../server/sim.js';
import { BotBrain } from '../server/bots.js';

const botsSrc = readSrc('server', 'bots.js');
const simSrc = readSrc('server', 'sim.js');

// "Only N occurrences in the whole file" MUST count **executable source** only (same stripping as audit_bot_vision)
const strip = (s) => s
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .split('\n').map((l) => l.replace(/(^|[^:'"`])\/\/.*$/, '$1')).join('\n');
const botsCode = strip(botsSrc).split("} from '../public/js/data.js';").slice(1).join('');
const simCode = strip(simSrc);
const count = (s, needle) => s.split(needle).length - 1;

let pass = 0, fail = 0;
const t = (n, ok, extra = '') => { ok ? (pass++, console.log(`  ✓ ${n}`)) : (fail++, console.log(`  ✗ ${n} ${extra}`)); };
const near = (a, b, e = 1e-9) => Math.abs(a - b) <= e;
const sec = (s) => console.log(`\n■ ${s}`);

// ---- Shared: genuine BattleSim (same synthetic battlefield as audit_bot_vision) ----
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
/** Empty battlefield: wipe all existing entities and camps (targeting undisturbed by creeps and towers) */
function blank() {
  const sim = new BattleSim(fakeCfg());
  sim.camps = [];
  for (const e of [...sim.ents.values()]) sim.ents.delete(e.id);
  sim.mines = []; sim.hazBlockers = [];
  return sim;
}
const chOf = (side, kind) => Object.keys(CHARACTERS).find((c) =>
  (CHARACTERS[c].side === side || CHARACTERS[c].side === 'MERC') && heroKindOf(c, side) === kind);
const CH_ROBOT = chOf('STEEL', 'robot');
const CH_DRONE = chOf('SWARM', 'drone');
/** Place a point at bearing/distance d relative to h's facing, in sim coordinates (only selectable inside the vision cone) */
const atBearing = (h, bearing, d) => [h.x - Math.sin(bearing + (h.ry || 0)) * d, h.z + Math.cos(bearing + (h.ry || 0)) * d];

// ---------------------------------------------------------------------------------
sec('Ⅰ 常數與曲線(data.js:分層旗標 + 三項權重 + 遲滯帶,推導不手寫)');
// ---------------------------------------------------------------------------------
{
  // Difficulty tiers: tactic on mid/high, elite on high only; and MUST be monotone (higher tiers never dumber)
  t('新手/低難度沒有戰術旗標(舊制逐位元不變)',
    !BOT_DIFF.novice.tactic && !BOT_DIFF.novice.elite && !BOT_DIFF.low.tactic && !BOT_DIFF.low.elite);
  t('中難度有 tactic、沒有 elite(撿尾刀/打帶跑/半護盾後撤是高級專屬)',
    BOT_DIFF.medium.tactic === true && BOT_DIFF.medium.elite === false);
  t('高難度兩顆都有', BOT_DIFF.high.tactic === true && BOT_DIFF.high.elite === true);
  t('旗標沿難度階梯單調(不得出現「低難度會、高難度不會」)', (() => {
    let seenT = false, seenE = false;
    for (const k of BOT_DIFF_KEYS) {
      if (BOT_DIFF[k].tactic) seenT = true; else if (seenT) return false;
      if (BOT_DIFF[k].elite) seenE = true; else if (seenE) return false;
    }
    return true;
  })());

  // Target priority: all three MUST be "larger wins", with baseline = 1 (nothing added ⇒ pure weighted distance)
  t('什麼都不加 ⇒ 優先度 = 1(舊制的加權距離原封不動)', near(botTargetPrio({}), 1));
  for (const [k, w] of [['threat', 'W_THREAT'], ['output', 'W_OUTPUT'], ['exec', 'W_EXEC']]) {
    t(`${k} 項單調遞增且係數 = BOT_TACTIC.${w}(推導不手寫)`,
      near(botTargetPrio({ [k]: 1 }) - 1, BOT_TACTIC[w]) && botTargetPrio({ [k]: 0.5 }) > botTargetPrio({ [k]: 0 }));
  }
  t('三項可疊加(同時是威脅 + 輸出核心 + 快陣亡 ⇒ 最高優先)',
    near(botTargetPrio({ threat: 1, output: 1, exec: 1 }),
      1 + BOT_TACTIC.W_THREAT + BOT_TACTIC.W_OUTPUT + BOT_TACTIC.W_EXEC));
  t('威脅權重 MUST 最重(「被打時優先」是需求原文的第一順位)',
    BOT_TACTIC.W_THREAT > BOT_TACTIC.W_OUTPUT && BOT_TACTIC.W_THREAT > BOT_TACTIC.W_EXEC);

  // Threat memory: linear fade, zero after THREAT_S
  t('威脅淡出:剛挨打 = 1、半程 = 0.5、逾時 = 0(線性)',
    near(botThreatDecay(0), 1) && near(botThreatDecay(BOT_TACTIC.THREAT_S / 2), 0.5)
    && near(botThreatDecay(BOT_TACTIC.THREAT_S), 0) && near(botThreatDecay(999), 0));
  t('負齡(時鐘倒退/同 tick)夾在 1,不會爆出 >1 的權重', near(botThreatDecay(-5), 1));
  t('記憶秒數為正且短於一場交戰(不是整場的傷害排行)',
    BOT_TACTIC.THREAT_S > 0 && BOT_TACTIC.THREAT_S < 30);

  // Execute window
  const wd = { dmg: 40, rate: 2, vs: {} };
  t('收割窗傷害 = dmg × vsMult × rate × EXEC_S(推導不手寫)',
    near(botSalvo(wd, 'soldier'), 40 * 2 * BOT_TACTIC.EXEC_S));
  t('撿尾刀權重遠高於「剩一口氣」(兩件事不共用 0~1 的尺)',
    BOT_TACTIC.EXEC_MAX > 1 && near(botExecW(10, 1000, 20), BOT_TACTIC.EXEC_MAX));
  t('打不死就退回「已損失比例」(0~1)', near(botExecW(250, 1000, 20), 0.75));
  t('salvo = 0 ⇒ 收割分支關閉(中難度只剩低血偏好)', near(botExecW(10, 1000, 0), 0.99));
  t('滿血目標的權重為 0(不會無差別加分)', near(botExecW(1000, 1000, 0), 0));
  t('maxEhp 為 0(除以零)不噴 NaN', botExecW(0, 0, 0) === 0);

  // Retreat line + hysteresis band
  t('回主堡門檻 = 25%(使用者定案)', near(BOT_TACTIC.BASE_HP, 0.25));
  t('回主堡門檻 MUST 低於脫離交戰門檻(否則「退到砲塔後方」這一段永遠不會發生)',
    BOT_TACTIC.BASE_HP < BOT_TACTIC.PULL_HP);
  t('復出線高於撤退線(回堡補血不會補到一半就衝出去)', BOT_TACTIC.RESUME_HP > BOT_TACTIC.PULL_HP);
  t('**護盾遲滯帶**:進場 PULL_SP < 出場 RALLY_SP(同門檻 = 在線上無限抖動)',
    BOT_TACTIC.PULL_SP < BOT_TACTIC.RALLY_SP, `${BOT_TACTIC.PULL_SP} vs ${BOT_TACTIC.RALLY_SP}`);
  t('「扛半條護盾」= 0.5(使用者定案)', near(BOT_TACTIC.PULL_SP, 0.5));
  t('「等滿護盾」的出場線接近滿但 < 1(浮點回復永遠差最後一點點,== 1 會卡死在集結點)',
    BOT_TACTIC.RALLY_SP < 1 && BOT_TACTIC.RALLY_SP > 0.9);
  t('集結點退在砲塔後方(正距離,且短於塔距 ⇒ 不會退成第二次長征)',
    BOT_TACTIC.RALLY_BACK_M > 0 && BOT_TACTIC.RALLY_BACK_M < UNITS.tower.range);

  // Hit-and-run
  t('打帶跑:可擊發貼上去、裝填中拉開(近 < 遠,且都在射程內)',
    botKiteF(true) < botKiteF(false) && botKiteF(false) < 1 && botKiteF(true) > 0);
  t('拉開的距離仍在射程內(退到射程外 = 這段時間完全打不到人)', botKiteF(false) <= 1);
}

// ---------------------------------------------------------------------------------
sec('Ⅱ 單一縫(原文:威脅/輸出各只有一份帳,分層只認旗標)');
// ---------------------------------------------------------------------------------
{
  t('威脅帳只在 `_hurtLog` 記(與濺血方位、受擊警戒同一份來源)',
    count(simCode, '_threat ||=') === 1 && /_threat \|\|=/.test(strip(grabMethod(simSrc, '_hurtLog'))));
  t('bots.js MUST NOT 自己記威脅(只准讀)', !/_threat\s*(\|\|=|=[^=])/.test(botsCode));
  t('威脅讀取只有一支(`_threatOf`)',
    count(botsCode, '_threatOf(') === 1 + count(botsCode, 'this._threatOf('));
  t('威脅淡出只經 `botThreatDecay`,MUST NOT 手寫 THREAT_S 的除法', (() => {
    // Both book readers (targeting `_threatOf`, retreat `_recentDmg`) MUST share one fade curve
    const rd = strip(grabMethod(botsSrc, '_recentDmg'));
    return !/THREAT_S/.test(botsCode)
      && count(botsCode, 'botThreatDecay(') === 2
      && /botThreatDecay\(/.test(strip(grabMethod(botsSrc, '_threatOf'))) && /botThreatDecay\(/.test(rd);
  })());
  t('威脅記帳 MUST 排在「只記主視野機」那道閘之前(僚機挨打也算打這一隊)', (() => {
    const s = strip(grabMethod(simSrc, '_hurtLog'));
    return s.indexOf('_threat ||=') < s.indexOf('this.heroes.get(t.pid) !== t');
  })());

  t('輸出帳只有一支 `_dmgOut`', count(simCode, 'by.dmgOut =') === 1
    && /by\.dmgOut = /.test(strip(grabMethod(simSrc, '_dmgOut'))));
  t('**兩條結算路徑都記帳**(護盾全擋早退 + 一般結算;漏一條 = 高護盾對手被系統性低估)', (() => {
    const d = strip(grabMethod(simSrc, '_damage'));
    // The fully-blocked path is a "book then return" early exit; toShield MUST be booked before returning.
    // The guard changed names in the 2026-08-02 shield-track migration from `rem <= 0` to `toHp <= 0`
    // (same semantics: nothing reaches the armor layer) — what is recognized here is "book before the
    // early return", not the variable name.
    const early = /toHp <= 0[\s\S]*?_dmgOut\(by, t, toShield\)[\s\S]*?return;/.test(d);
    return count(d, 'this._dmgOut(') === 2 && early;
  })(), `${count(strip(grabMethod(simSrc, '_damage')), 'this._dmgOut(')} 處`);
  t('輸出帳與吸血記在同一個 dealt(量的是實際護盾+裝甲損耗)', (() => {
    const d = strip(grabMethod(simSrc, '_damage'));
    return /_dmgOut\(by, t, toShield\);\s*this\._vamp\(by, toShield\)/.test(d)
      && /_dmgOut\(by, t, dealt\);\s*\n?\s*this\._vamp\(by, dealt\)/.test(d);
  })());
  t('英雄的輸出帳走小隊共用(一名玩家一份,不是逐機體三份)', /'dmgOut'/.test(simCode));
  t('bots.js MUST NOT 自己統計輸出(只准讀 dmgOut)', !/dmgOut\s*=/.test(botsCode));

  t('難度分層只認 BOT_DIFF 旗標(MUST NOT 比對難度字串 = 第二份分級表)',
    !/diff\.key\s*===/.test(botsCode) && !/'(high|medium|low|novice)'/.test(botsCode));
  t('bots.js MUST NOT 手寫三項權重 / 撿尾刀門檻',
    !/W_THREAT|W_OUTPUT|W_EXEC|EXEC_MAX|EXEC_S/.test(botsCode));
  t('優先度組合只有一處(`_prioritize` → botTargetPrio)',
    count(botsCode, 'botTargetPrio(') === 1
    && /botTargetPrio\(/.test(strip(grabMethod(botsSrc, '_prioritize'))));
  t('選敵仍只有 `_acquire` 一條路(視野錐/迷霧/LOS 全在那裡)',
    /this\._prioritize\(/.test(strip(grabMethod(botsSrc, '_acquire')))
    && count(botsCode, 'this._prioritize(') === 1);
  t('打帶跑比例只經 `botKiteF`,MUST NOT 手寫 KITE_ 常數',
    count(botsCode, 'botKiteF(') === 1 && !/KITE_(NEAR|FAR)/.test(botsCode));
  t('撤退決策只有 `_pullWant` 一支,且 `state` 進場只經 `_enterPull`',
    count(botsCode, '_pullWant(') === 1 + count(botsCode, 'this._pullWant(')
    && count(botsCode, 'this._enterPull(') === 1);
  t('「脫離交戰中」的判斷只有 `_pulling`(MUST NOT 逐處展開成 RETREAT || RALLY)', (() => {
    // State **dispatch** (if state === 'RALLY' → _rally) legitimately names each case; what is banned
    // is the "ask both at once" semantic — once spread out, a third withdrawn state would be missed somewhere.
    const outside = botsCode.replace(strip(grabMethod(botsSrc, '_pulling')), '');   // the definition itself does not count
    const inline = /'(RETREAT|RALLY)'\s*\|\|/.test(outside) || /\|\|\s*this\.state === '(RETREAT|RALLY)'/.test(outside);
    return !inline
      && /this\._pulling\(\)/.test(strip(grabMethod(botsSrc, 'update')))
      && /this\._pulling\(\)/.test(strip(grabMethod(botsSrc, '_castSupport')));
  })());
  t('集結點吃 `sim.towerSites`(與開場預置兵線同一份解,MUST NOT 再解一次)',
    /towerSites/.test(strip(grabMethod(botsSrc, '_pickRally'))) && !/solveTowerSites/.test(botsCode));
  t('RALLY 的位置一樣走 `_moveToward` → `_move` 碰撞唯一縫',
    /this\._moveToward\(/.test(strip(grabMethod(botsSrc, '_rally'))));
  // Learning-policy rollout 2026-08-06: the knob read seam upgrades to `this.tac` (default =
  // BOT_TACTIC, the learning loop injects candidate policies per brain) ⇒ thresholds still live in
  // BOT_TACTIC as a group, but bots.js MUST read via this.tac and MUST NOT read `BOT_TACTIC.` directly
  // again (a second read path = a dead corner learning candidates cannot cover). See audit_bot_policy.mjs.
  t('bots.js 不再手寫撤退門檻(整組搬進 BOT_TACTIC,經 this.tac 單一讀取縫)',
    !/RETREAT_HP|RESUME_HP\s*=/.test(botsCode) && /this\.tac = BOT_TACTIC;/.test(botsCode)
    && !/BOT_TACTIC\./.test(botsCode));
  t('「還在戰鬥中」只有 `_inFight` 一支、且吃 `VITALS.OOC_S`(= 護盾還沒開始回復)',
    /VITALS\.OOC_S/.test(strip(grabMethod(botsSrc, '_inFight')))
    && count(botsCode, 'VITALS.') === 1
    && count(botsCode, 'this._inFight(') >= 2);
  t('撤退判定與集結行為同吃那支交戰判定(退到一半的規則不得與行為分家)',
    /this\._inFight\(/.test(strip(grabMethod(botsSrc, '_pullWant')))
    && /this\._inFight\(/.test(strip(grabMethod(botsSrc, '_rally'))));
  t('威脅帳帶攻擊者機種 `k`(撤退判定要分得出「被人打」與「站在塔下被刮」)',
    /k: by\.kind/.test(strip(grabMethod(simSrc, '_hurtLog'))));
  t('「扛半條護盾」排除工事刮傷(與 `_prioritize` 排除工事總輸出同一條理由)',
    /'tower'/.test(strip(grabMethod(botsSrc, '_recentDmg'))) && /'base'/.test(strip(grabMethod(botsSrc, '_recentDmg'))));
}

// ---------------------------------------------------------------------------------
sec('Ⅲ 選敵優先度 行為直測(真 BattleSim + 真 BotBrain)');
// ---------------------------------------------------------------------------------
{
  /**
   * Two **identical** enemies at the same bearing and distance, differing in only one metric.
   * Insertion order deliberately puts "the one that should be picked" last — ties go to the first
   * inserted in `_acquire`, so a pass proves priority genuinely outweighed it rather than riding
   * iteration order.
   */
  const twin = (diffKey, tune) => {
    const sim = blank();
    const h = sim.addHero('STEEL', 'b1', CH_ROBOT);
    const brain = new BotBrain(sim, 'b1', 'STEEL', 0, diffKey);
    h.x = 0; h.z = 0; h.y = 0; h.ry = 0;
    sim.t = 100;
    const R = heroWeapon(h.ch, 'light', h.abil.light, true).range * 0.5;
    const mk = (bearing, dist) => {
      const [x, z] = atBearing(h, bearing, dist);
      return sim._add({ kind: 'soldier', side: 'SWARM', lane: 0, x, z, y: 0, hp: 1000 });
    };
    const plain = mk(0.02, R);      // inserted first = tie winner
    const mark = mk(-0.02, R);      // inserted later = only picked if the measured trait holds
    tune(sim, h, brain, mark, plain);
    sim._tickN++;
    return { got: brain._acquire(h), mark, plain, sim, h, brain };
  };

  {
    // The attacker also books output in `_dmgOut` ⇒ zero it on the spot, so this trait genuinely measures "threat" only
    const r = twin('medium', (sim, h, br, mark) => { sim._damage(h, 300, mark, 0); mark.dmgOut = 0; });
    t('①對自己傷害最高者:剛打過我的那個優先(平手時本來會選另一個)', r.got === r.mark);
  }
  {
    const r = twin('medium', (sim, h, br, mark) => { mark.dmgOut = 5000; });
    t('②對我方造成總傷害最高者(輸出核心)優先', r.got === r.mark);
  }
  {
    const r = twin('medium', (sim, h, br, mark) => { mark.hp = 60; });
    t('③快要陣亡的目標優先', r.got === r.mark);
  }
  {
    const r = twin('low', (sim, h, br, mark) => {
      sim._damage(h, 300, mark, 0); mark.dmgOut = 5000; mark.hp = 60;
    });
    t('低難度**三項全不吃**(舊制:純加權距離,平手選先插入的)', r.got === r.plain);
  }
  {
    const r = twin('novice', (sim, h, br, mark) => { mark.hp = 1; });
    t('新手難度同樣不吃(難度階梯不得塌掉)', r.got === r.plain);
  }

  // Threat fade: same book; past THREAT_S it no longer steers targeting
  {
    const r = twin('medium', (sim, h, br, mark) => { sim._damage(h, 300, mark, 0); mark.dmgOut = 0; });
    t('威脅帳真的記在受擊者身上(pid/id 對得起來)',
      r.h._threat instanceof Map && r.h._threat.get(r.mark.id)?.v > 0);
    r.sim.t += BOT_TACTIC.THREAT_S + 1;
    r.sim._tickN++;
    t('逾時之後威脅歸零 ⇒ 選敵退回加權距離(不會一直記恨)', r.brain._acquire(r.h) === r.plain);
  }

  // Kill-stealing: high tier runs farther for a secured kill, mid tier does not
  {
    const execTest = (diffKey) => {
      const sim = blank();
      const h = sim.addHero('STEEL', 'b1', CH_ROBOT);
      const brain = new BotBrain(sim, 'b1', 'STEEL', 0, diffKey);
      h.x = 0; h.z = 0; h.y = 0; h.ry = 0;
      sim.t = 100;
      const wd = heroWeapon(h.ch, 'light', h.abil.light, true);
      const R = wd.range * 0.4;
      const salvo = botSalvo(wd, 'soldier');
      const mk = (bearing, dist, hp) => {
        const [x, z] = atBearing(h, bearing, dist);
        return sim._add({ kind: 'soldier', side: 'SWARM', lane: 0, x, z, y: 0, hp });
      };
      // Near one: hurt worse but **not yet killable**; far one (1.5x): finishes inside one execute window
      const wounded = mk(0.02, R, salvo * 1.4);
      const finish = mk(-0.02, R * 1.5, salvo * 0.6);
      sim._tickN++;
      return { got: brain._acquire(h), wounded, finish };
    };
    const hi = execTest('high');
    t('④撿尾刀(高難度):寧可跑遠 1.5× 也要去收那個打得死的',
      hi.got === hi.finish);
    const mid = execTest('medium');
    t('中難度不撿尾刀:一樣看「傷得多重」,選近的那個(收割是高級專屬)',
      mid.got === mid.wounded);
  }

  // Towers/bases deliberately excluded from the "total output" comparison
  {
    const sim = blank();
    const h = sim.addHero('STEEL', 'b1', CH_ROBOT);
    const brain = new BotBrain(sim, 'b1', 'STEEL', 0, 'high');
    h.x = 0; h.z = 0; h.y = 0; h.ry = 0;
    sim.t = 100;
    const R = heroWeapon(h.ch, 'light', h.abil.light, true).range * 0.5;
    const [sx, sz] = atBearing(h, 0.02, R);
    const sol = sim._add({ kind: 'soldier', side: 'SWARM', lane: 0, x: sx, z: sz, y: 0, hp: 1000 });
    const [tx, tz] = atBearing(h, -0.02, R);
    const tow = sim._add({ kind: 'tower', side: 'SWARM', lane: 0, x: tx, z: tz, y: 0, hp: UNITS.tower.hp });
    tow.dmgOut = 999999;   // a tower's cumulative output is inevitably the highest on the field
    sim._tickN++;
    t('砲塔的累計輸出不列入比較(否則 bot 會一頭撞進塔的射程裡)', brain._acquire(h) === sol);
  }
}

// ---------------------------------------------------------------------------------
sec('Ⅳ 撤退線:HP < 25% 才回主堡,否則退到最近砲塔後方等護盾');
// ---------------------------------------------------------------------------------
{
  const brainOf = (diffKey) => {
    const sim = blank();
    sim.addHero('STEEL', 'b1', CH_ROBOT);
    const br = new BotBrain(sim, 'b1', 'STEEL', 0, diffKey);
    sim.t = 100;
    return br;
  };
  const hi = brainOf('high'), mid = brainOf('medium'), lo = brainOf('low');
  const HIT = { lastHitAt: 100 };                          // under fire (just hit)
  const CALM = { lastHitAt: 100 - VITALS.OOC_S - 1 };      // disengaged (shields regenerating)

  t('裝甲 < 25% ⇒ 回主堡(唯一會離開兵線的情況)',
    hi._pullWant(HIT, 0.2, 1) === 'RETREAT' && mid._pullWant(HIT, 0.2, 1) === 'RETREAT');
  t('裝甲 25~32% + 護盾扛掉一半 ⇒ 退到砲塔後方(不回主堡)',
    mid._pullWant(HIT, 0.28, 0.4) === 'RALLY' && hi._pullWant(HIT, 0.28, 0.4) === 'RALLY');
  t('裝甲 25~32% 但護盾還滿 ⇒ 不撤(緩衝還在,退了只是浪費兵線)',
    mid._pullWant(HIT, 0.28, 1) === null);
  t('⑤高難度:滿血但扛掉半條護盾就後撤', hi._pullWant(HIT, 1, 0.45) === 'RALLY');
  t('中難度滿血不會因為護盾就撤(「扛半條護盾就後撤」是高級專屬)',
    mid._pullWant(HIT, 1, 0.45) === null);
  t('健康 ⇒ 不撤(兩個難度都是)', hi._pullWant(HIT, 1, 1) === null && mid._pullWant(HIT, 0.9, 0.9) === null);
  // Without this gate, bots walk miles back across open lane for a mid-regen shield (measured
  // 2026-08-02: fortification damage halved)
  t('**脫戰後護盾低不算危險**:沒人在打就繼續推(護盾走到哪回到哪)',
    hi._pullWant(CALM, 1, 0.1) === null && hi._pullWant(CALM, 0.28, 0.1) === null
    && mid._pullWant(CALM, 0.28, 0.1) === null);
  t('但裝甲跌破 25% 不吃交戰閘(裝甲只有主堡補得回來,拖著不回去只會死在路上)',
    hi._pullWant(CALM, 0.2, 1) === 'RETREAT' && mid._pullWant(CALM, 0.2, 1) === 'RETREAT');
  t('低/新手難度**逐位元舊制**:只有一條「裝甲 < PULL_HP → 回主堡」,且不吃交戰閘',
    lo._pullWant(CALM, 0.31, 0.1) === 'RETREAT' && lo._pullWant(HIT, 0.2, 1) === 'RETREAT'
    && lo._pullWant(HIT, 0.5, 0.1) === null && lo._pullWant(CALM, 0.33, 0) === null);
  t('遲滯帶真的關得起來:退場護盾滿(RALLY_SP)之後不會立刻又想撤',
    hi._pullWant(HIT, 0.28, BOT_TACTIC.RALLY_SP) === null
    && hi._pullWant(HIT, 0.99, BOT_TACTIC.RALLY_SP) === null);

  // ---- "Tanked half a shield" measures **recently taken damage**, and fortification chip damage
  // does not count (genuine BattleSim measurement) ----
  {
    const mk = () => {
      const sim = blank();
      const h = sim.addHero('STEEL', 'b1', CH_ROBOT);
      const br = new BotBrain(sim, 'b1', 'STEEL', 0, 'high');
      h.x = 0; h.z = 0; h.y = 0; sim.t = 100;
      return { sim, h, br };
    };
    const spF = (h) => (h.sp || 0) / h.maxSp;
    {
      const { sim, h, br } = mk();
      const foe = sim.addHero('SWARM', 'p9', CH_DRONE);
      foe.x = 60; foe.z = 0; foe.y = 0;
      sim._damage(h, h.maxSp * 0.7, foe, 0);
      t('一波被敵方英雄扛掉七成護盾 ⇒ 後撤', br._pullWant(h, 1, spF(h)) === 'RALLY');
    }
    {
      const { sim, h, br } = mk();
      const tow = sim._add({ kind: 'tower', side: 'SWARM', lane: 0, x: 60, z: 0, y: 0, hp: UNITS.tower.hp });
      sim._damage(h, h.maxSp * 0.7, tow, 0);
      t('同樣扛掉七成護盾、但來源是**砲塔** ⇒ 不後撤(拆塔本來就是站在塔的射程裡挨打)',
        br._pullWant(h, 1, spF(h)) === null, `sp ${spF(h).toFixed(2)}`);
      t('工事刮傷不進「扛下的傷害」帳,但威脅選敵照樣認得它(兩件事不同帳)',
        br._recentDmg(h) === 0 && br._threatOf(h, tow) > 0);
      h.hp = h.maxHp * 0.28;
      t('但裝甲被塔打到剩三成 ⇒ 照樣退到砲塔後方(工事的危險訊號是裝甲,不是護盾)',
        br._pullWant(h, 0.28, spF(h)) === 'RALLY');
    }
    {
      const { sim, h, br } = mk();
      const foe = sim.addHero('SWARM', 'p9', CH_DRONE);
      foe.x = 60; foe.z = 0; foe.y = 0;
      for (let i = 0; i < 30; i++) { sim._damage(h, h.maxSp * 0.02, foe, 0); sim.t += 1; }   // slow chip
      t('慢慢被刮到護盾見底(每秒 2%)⇒ 不算「扛了半條」,不後撤',
        spF(h) < BOT_TACTIC.PULL_SP && br._pullWant(h, 1, spF(h)) === null,
        `sp ${spF(h).toFixed(2)} 近期 ${br._recentDmg(h).toFixed(0)}`);
    }
  }

  // ---- Rally point: behind the nearest **surviving** friendly turret ----
  {
    const sim = new BattleSim(fakeCfg());          // this copy keeps the towers
    const h = sim.addHero('STEEL', 'b1', CH_ROBOT);
    const brain = new BotBrain(sim, 'b1', 'STEEL', 0, 'high');
    const towers = [...sim.ents.values()].filter((e) => e.kind === 'tower' && e.side === 'STEEL');
    t('稽核戰場真的有己方砲塔(集結點的前提)', towers.length > 0, `${towers.length} 座`);
    const [bx, bz] = sim.basePos.STEEL;
    // Standing next to the frontmost tower
    let front = towers[0];
    for (const e of towers) if (Math.hypot(e.x - bx, e.z - bz) > Math.hypot(front.x - bx, front.z - bz)) front = e;
    h.x = front.x; h.z = front.z; h.y = 0;
    brain._pickRally(h);
    const dRally = Math.hypot(brain._rallyAt[0] - bx, brain._rallyAt[1] - bz);
    const dTower = Math.hypot(front.x - bx, front.z - bz);
    t('集結點落在「最近砲塔」與主堡之間(= 塔的後方)', dRally < dTower && dRally > 0,
      `集結 ${dRally.toFixed(0)}m / 塔 ${dTower.toFixed(0)}m`);
    t('退的距離 ≈ RALLY_BACK_M(不是退回主堡)',
      Math.abs(dTower - dRally - BOT_TACTIC.RALLY_BACK_M) < BOT_TACTIC.RALLY_BACK_M * 0.5
      && dRally > dTower * 0.5, `Δ${(dTower - dRally).toFixed(0)}m`);
    t('集結進度是沿兵線的己方端距離(復出時 prog 從這裡接回,不是從 0 重走)',
      brain._rallyProg > 0 && brain._rallyProg < dTower + BOT_TACTIC.RALLY_BACK_M);

    // Standing next to a rear tower → the rear one is picked ("nearest", not "frontmost")
    let rear = towers[0];
    for (const e of towers) if (Math.hypot(e.x - bx, e.z - bz) < Math.hypot(rear.x - bx, rear.z - bz)) rear = e;
    if (rear !== front) {
      h.x = rear.x; h.z = rear.z;
      brain._pickRally(h);
      const d2 = Math.hypot(brain._rallyAt[0] - bx, brain._rallyAt[1] - bz);
      t('選的是**最近**那座塔(不是恆取最前線)', d2 < dRally, `${d2.toFixed(0)}m < ${dRally.toFixed(0)}m`);
    } else t('選的是**最近**那座塔(本戰場只有一排塔,跳過)', true);

    // All towers down → fall back to base (no exception for the downgrade)
    for (const e of towers) sim.ents.delete(e.id);
    brain._pickRally(h);
    t('己方砲塔全滅 ⇒ 集結點退回主堡(不會退到一個空塔位上)',
      brain._rallyAt === sim.basePos.STEEL || (near(brain._rallyAt[0], bx) && near(brain._rallyAt[1], bz)));
  }

  // ---- State machine: enter / resume / no long marches ----
  {
    const sim = new BattleSim(fakeCfg());
    const h = sim.addHero('STEEL', 'b1', CH_ROBOT);
    const brain = new BotBrain(sim, 'b1', 'STEEL', 0, 'high');
    const dt = GAME.TICK_MS / 1000;
    // `by` = someone is hitting me this beat. Always travel the **genuine `sim._damage`** — shield
    // level, disengage timing, and the threat book are all products of the same damage event; stuffing
    // fields by hand drops one of the three and measures a false pass.
    const step = (n = 1, by = null) => {
      for (let i = 0; i < n; i++) { sim.t += dt; if (by) sim._damage(h, 1, by, 0); brain.update(dt); }
    };
    const total = brain._cum[brain._cum.length - 1];
    brain.prog = 900;
    [h.x, h.z] = pointAt(sim.lanes[0], brain._cum, total - 900);
    step(4);
    const foe = sim.addHero('SWARM', 'p9', CH_DRONE);
    foe.x = h.x + 60; foe.z = h.z; foe.y = 0;
    sim._damage(h, h.maxSp * 0.7, foe, 0);      // tanked 70% of shields in one wave
    for (let i = 0; i < 40 && brain.state !== 'RALLY'; i++) step(1, foe);
    t('一波扛掉半條護盾 ⇒ 進 RALLY(不是 RETREAT)', brain.state === 'RALLY', brain.state);
    t('進 RALLY 當下就定案集結點', brain._rallyAt != null);
    const rallyProg = brain._rallyProg;
    const d0 = Math.hypot(h.x - brain._rallyAt[0], h.z - brain._rallyAt[1]);
    step(120, foe);
    const d1 = Math.hypot(h.x - brain._rallyAt[0], h.z - brain._rallyAt[1]);
    t('RALLY 真的往集結點移動', d1 < d0, `${d0.toFixed(0)}m → ${d1.toFixed(0)}m`);
    h.sp = h.maxSp;                             // shields back to full
    for (let i = 0; i < 40 && brain.state === 'RALLY'; i++) step();
    t('等滿護盾即復出(不必等裝甲)', brain.state !== 'RALLY' && !brain._pulling(), brain.state);
    t('復出的沿兵線進度接回集結點(**不是**從主堡 0 重走)', near(brain.prog, rallyProg, 200),
      `prog ${brain.prog.toFixed(0)} vs 集結 ${rallyProg.toFixed(0)}`);
    t('復出後不會立刻又想撤(遲滯帶真的關得起來)',
      brain._pullWant(h, h.hp / h.maxHp, 1) === null);

    // Armor breached below 25% ⇒ RALLY upgrades to RETREAT (destination swaps to base).
    // Remove the audit's own planted enemy first: leaving it gets the mech killed, `update` early-outs
    // stop moving, and what gets measured is a corpse standing still
    sim.ents.delete(foe.id); sim.heroes.delete(foe.pid); sim.squads.delete(foe.pid);
    h.hp = h.maxHp * 0.2; h.sp = 0;
    for (let i = 0; i < 40 && brain.state !== 'RETREAT'; i++) step();
    t('裝甲跌破 25% ⇒ 升級成回主堡', brain.state === 'RETREAT', brain.state);
    const [bx, bz] = sim.basePos.STEEL;
    const db0 = Math.hypot(h.x - bx, h.z - bz);
    step(160);
    t('RETREAT 真的往主堡移動', Math.hypot(h.x - bx, h.z - bz) < db0);
    t('回主堡途中護盾就算見底也**不會**被叫去集結點(補血補到一半掉頭 = 整趟白跑)',
      brain._pullWant({ lastHitAt: sim.t }, 0.4, 0) === 'RETREAT' && brain.state === 'RETREAT');
    h.hp = h.maxHp; h.sp = h.maxSp;
    for (let i = 0; i < 40 && brain.state === 'RETREAT'; i++) step();
    // The resume beat already pushed one step ⇒ prog is never exactly 0, but MUST sit far from rally
    // progress (that is what "starting over" means)
    t('補到 RESUME_HP 才復出,且 prog 從 0 重走(回堡 = 重新出發)',
      brain.state !== 'RETREAT' && brain.prog < rallyProg * 0.1, `${brain.state} prog=${brain.prog.toFixed(1)}`);
  }

  // ---- RALLY keeps shooting on the way out (running away silent = feeding kills) ----
  {
    const sim = blank();
    const h = sim.addHero('STEEL', 'b1', CH_ROBOT);
    const brain = new BotBrain(sim, 'b1', 'STEEL', 0, 'high');
    h.x = 0; h.z = 0; h.y = 0; h.ry = 0;
    sim.t = 100;
    brain._rallyAt = [0, -400]; brain._rallyProg = 300;
    const wd = heroWeapon(h.ch, 'light', h.abil.light, true);
    const [tx, tz] = atBearing(h, 0, wd.range * 0.5);
    const foe = sim._add({ kind: 'soldier', side: 'SWARM', lane: 0, x: tx, z: tz, y: 0, hp: 99999 });
    h.ammo.light = wd.mag; h.reloadUntil.light = 0; h.fireAt.light = -99;
    brain._aimAt = 0;
    const dtk = GAME.TICK_MS / 1000;
    // ---- Still under fire: shoot while pulling back (silent retreat = feeding kills) ----
    h.lastHitAt = sim.t;
    const hp0 = foe.hp;
    const [x0, z0] = [h.x, h.z];
    brain._rally(h, UNITS[h.kind], foe, dtk);
    t('還在挨打 ⇒ RALLY 途中照樣開火(打帶跑的宏觀版本)', foe.hp < hp0, `掉 ${(hp0 - foe.hp).toFixed(1)}`);
    t('還在挨打 ⇒ 真的往集結點退', Math.hypot(h.x - x0, h.z - z0) > 0);
    t('RALLY 途中視角看向目標(不是背對敵人跑)', brain._wantRy != null);
    // ---- Disengaged: hold fire and hold position for shields (keep shooting = return fire keeps
    // resetting the disengage timer, shields never return) ----
    h.lastHitAt = sim.t - VITALS.OOC_S - 1;
    h.ammo.light = wd.mag; h.reloadUntil.light = 0; h.fireAt.light = -99;
    const hp1 = foe.hp;
    const [x1, z1] = [h.x, h.z];
    for (let i = 0; i < 8; i++) brain._rally(h, UNITS[h.kind], foe, dtk);
    t('脫離接觸 ⇒ **停火**等護盾(不停火的話護盾永遠回不來,RALLY 出不去)',
      near(foe.hp, hp1, 1e-9), `掉 ${(hp1 - foe.hp).toFixed(1)}`);
    t('脫離接觸 ⇒ 停在原地(退夠了就不必再往回跑)', near(h.x, x1, 1e-9) && near(h.z, z1, 1e-9));
    t('但眼睛還是盯著人(免得被繞後)', brain._wantRy != null);
    brain._rally(h, UNITS[h.kind], null, dtk);
    t('沒有目標時面向敵方端等護盾(背對戰場 = 前方視野錐全對著自家主堡)',
      brain._wantRy != null);
  }
}

// ---------------------------------------------------------------------------------
sec('Ⅴ 打帶跑:裝填中拉開、可擊發貼上去(高難度)');
// ---------------------------------------------------------------------------------
{
  /** Park the enemy at 0.7x range, run one `_engage` beat, return the closing (+)/opening (−) displacement component */
  const closeIn = (diffKey, reloading, kind = 'soldier') => {
    const sim = blank();
    const h = sim.addHero('STEEL', 'b1', CH_ROBOT);
    const brain = new BotBrain(sim, 'b1', 'STEEL', 0, diffKey);
    h.x = 0; h.z = 0; h.y = 0; h.ry = 0;
    sim.t = 100;
    const wd = heroWeapon(h.ch, 'light', h.abil.light, true);
    const foe = sim._add({ kind, side: 'SWARM', lane: 0, x: 0, z: wd.range * 0.7, y: 0, hp: 99999 });
    h.ammo.light = wd.mag; h.fireAt.light = -99;
    h.reloadUntil.light = reloading ? sim.t + 2 : 0;
    const d0 = Math.hypot(foe.x - h.x, foe.z - h.z);
    brain._engage(h, UNITS[h.kind], foe, GAME.TICK_MS / 1000);
    return d0 - Math.hypot(foe.x - h.x, foe.z - h.z);   // >0 = closing
  };
  t('高難度・可擊發:貼上去', closeIn('high', false) > 0, `${closeIn('high', false).toFixed(2)}m`);
  t('高難度・裝填中:拉開(這就是打帶跑)', closeIn('high', true) < 0, `${closeIn('high', true).toFixed(2)}m`);
  t('中難度:裝填中不拉開(打帶跑是高級專屬)', closeIn('medium', true) > 0);
  t('低/新手難度同樣不打帶跑(舊制的 0.6 距離環)',
    closeIn('low', true) > 0 && closeIn('novice', true) > 0);
  // Buildings keep the legacy 0.85 distance ring ⇒ at 0.7x range they already stand off; the point is
  // **reloading changes nothing about it**
  t('對建築不打帶跑(塔不會追,拉開只是白白少打幾秒:裝填與否位移一致)',
    near(closeIn('high', true, 'tower'), closeIn('high', false, 'tower'), 1e-6),
    `${closeIn('high', true, 'tower').toFixed(3)} vs ${closeIn('high', false, 'tower').toFixed(3)}`);
}

// ---------------------------------------------------------------------------------
sec('Ⅵ 不回歸:護盾回復規則沒被動到 / 舊制難度逐位元不變');
// ---------------------------------------------------------------------------------
{
  // OOC_S is **read** as the engagement test (see II); what is banned is "self-healing shields" —
  // the whole regen rate lives in sim only
  t('護盾脫戰回復仍由 sim 結算(戰術層只讀交戰秒數,MUST NOT 自己給 bot 回盾)',
    VITALS.OOC_S > 0 && VITALS.SP_REGEN_PS > 0 && !/SP_REGEN_PS/.test(botsCode));
  t('bots.js MUST NOT 直接改 hp/sp(權威狀態只在 sim 結算)',
    !/h\.(hp|sp)\s*=[^=]/.test(botsCode));
  // A low-tier bot's whole push MUST stay bit-identical to pre-migration — verified here by "takes no tactical branch"
  {
    const sim = blank();
    const h = sim.addHero('STEEL', 'b1', CH_ROBOT);
    const brain = new BotBrain(sim, 'b1', 'STEEL', 0, 'low');
    h.x = 0; h.z = 0; h.y = 0; h.ry = 0;
    sim.t = 100;
    const R = heroWeapon(h.ch, 'light', h.abil.light, true).range * 0.5;
    const [x1, z1] = atBearing(h, 0.02, R * 0.9);
    const nearFull = sim._add({ kind: 'soldier', side: 'SWARM', lane: 0, x: x1, z: z1, y: 0, hp: 1000 });
    const [x2, z2] = atBearing(h, -0.02, R);
    const farDying = sim._add({ kind: 'soldier', side: 'SWARM', lane: 0, x: x2, z: z2, y: 0, hp: 1 });
    sim._damage(h, 500, farDying, 0);
    farDying.dmgOut = 99999;
    sim._tickN++;
    t('低難度:滿血近敵 vs 瀕死+高輸出+正在打我的遠敵 ⇒ 仍然選近的(純距離)',
      brain._acquire(h) === nearFull);
    t('低難度不進 `_prioritize`(候選集不帶戰術欄位)',
      brain.diff.tactic !== true && nearFull.threat === undefined);
  }
}

// ---------------------------------------------------------------------------------
sec('Ⅶ 防守姿態與攻防招式策略 行為直測(真 BattleSim + 真 BotBrain)');
// ---------------------------------------------------------------------------------
{
  // 1 Novice tier: never uses the defensive stance
  {
    const sim = blank();
    const h = sim.addHero('STEEL', 'b1', CH_ROBOT);
    const brain = new BotBrain(sim, 'b1', 'STEEL', 0, 'novice');
    h.sp = 200; h.hp = 100; h.lastHitAt = sim.t;
    brain.state = 'RETREAT';
    brain._updateDefending(h, null);
    t('新手難度: defend 旗標為 false', brain.diff.defend === false);
    t('新手難度: 危急撤退亦不進入防守姿態', h.defending !== true);
  }

  // 2 Low tier: passive shield-up only when retreating to base under fire; no shield-up while reloading in normal combat
  {
    const sim = blank();
    const h = sim.addHero('STEEL', 'b1', CH_ROBOT);
    const brain = new BotBrain(sim, 'b1', 'STEEL', 0, 'low');
    h.sp = 200; h.hp = 100; h.lastHitAt = sim.t;
    brain.state = 'RETREAT';
    brain._updateDefending(h, null);
    t('低難度: defend 旗標為 true', brain.diff.defend === true);
    t('低難度: 撤退回主堡受擊中進入防守姿態保命', h.defending === true);

    // Normal-combat reload: no shield-up (no tactic flag)
    brain.state = 'ENGAGE';
    h.reloadUntil.light = sim.t + 2;
    brain._opAt.defend = 0; brain._opNext = 0;
    brain._updateDefending(h, null);
    t('低難度: 一般交戰換彈不具備戰術切盾意識', h.defending === false);
  }

  // 3 Mid tier: tactical defense (shield-up on reload, shield held on retreat/rally, defensive ability on magnet attrition)
  {
    const sim = blank();
    const h = sim.addHero('STEEL', 'b1', CH_ROBOT);
    const brain = new BotBrain(sim, 'b1', 'STEEL', 0, 'medium');
    h.sp = 200; h.maxSp = 200; h.hp = 500; h.maxHp = 500;
    brain.state = 'ENGAGE';
    h.reloadUntil.light = sim.t + 2;
    h.reloadUntil.heavy = sim.t + 5;
    brain._opAt.defend = 0; brain._opNext = 0;
    brain._updateDefending(h, null);
    t('中難度: 輕武器換彈空窗期戰術性切換防守姿態', h.defending === true);

    // Magnet attrition past half: fire the defensive ability
    const hd = sim.addHero('SWARM', 'b2', CH_DRONE);
    const bd = new BotBrain(sim, 'b2', 'SWARM', 0, 'medium');
    hd.sp = 40; hd.maxSp = 200; hd.lastHitAt = sim.t; hd.abil.skill = 1; hd.mp = 999; hd.acd.skill = 0;
    bd._opAt.ability = 0; bd._opNext = 0;
    bd._castSupport(hd, 1.0); // fires the defensive ability on past-half magnet attrition even at full HP (frac=1.0)
    t('中難度: 磁力損耗過半及時啟動防守招式充能/強化',
      (hd.acd.skill || 0) > sim.t || (hd.achg?.skill?.rechargeAt?.length || 0) > 0 || !!hd.cast);
  }

  // 4 High tier: elite all-round offense-defense (shield-up on reload, active shield-down once loaded, facing the threat)
  {
    const sim = blank();
    const h = sim.addHero('STEEL', 'b1', CH_ROBOT);
    const brain = new BotBrain(sim, 'b1', 'STEEL', 0, 'high');
    h.sp = 200; h.maxSp = 200; h.hp = 500; h.maxHp = 500;
    brain.state = 'ENGAGE';
    h.reloadUntil.light = sim.t + 2;
    h.reloadUntil.heavy = sim.t + 5;
    h._alert = { x: 50, z: -50, t: sim.t };
    brain._opAt.defend = 0; brain._opNext = 0;
    brain._updateDefending(h, null);
    t('高難度: 換彈空窗進入防守姿態', h.defending === true);
    t('高難度: 持盾防守時自動轉向威脅警戒方向', brain._wantRy != null);

    // Reload complete with a target ready: actively drop the defensive stance to attack
    const foe = sim._add({ kind: 'soldier', side: 'SWARM', lane: 0, x: 0, z: 50, y: 0, hp: 100 });
    h.reloadUntil.light = 0;
    brain._aimAt = sim.t - 1;
    brain._opAt.defend = 0; brain._opNext = 0;
    brain._updateDefending(h, foe);
    t('高難度: 換彈就緒且瞄準完成時主動解除防守姿態投入進攻', h.defending === false);
  }
}

console.log(`\n${fail ? '❌' : '✅'} 電腦玩家戰術稽核:${pass}/${pass + fail} 通過`);
process.exit(fail ? 1 : 0);
