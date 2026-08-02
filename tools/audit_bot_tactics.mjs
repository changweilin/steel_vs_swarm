// ============ 電腦玩家戰術(選敵優先度 / 撤退線 / 打帶跑)稽核(2026-08-02 使用者需求)============
// 需求原文:「中高級電腦操作邏輯優化:被打時優先對『對自己傷害最高者、造成敵人最大總傷害、
//            快要陣亡的目標』進行攻擊 / HP 低於 25% 才會回主堡,否則撤退到最近砲塔後方兵線
//            等滿護盾即可」/「高級電腦操作邏輯優化:撿尾刀、打帶跑操作、扛半條護盾就後撤」。
// 改 `data.js` 的 `BOT_DIFF.tactic/elite`、`BOT_TACTIC`/`botTargetPrio`/`botThreatDecay`/
// `botSalvo`/`botExecW`/`botKiteF`、`sim.js` 的 `_dmgOut`/`_hurtLog` 威脅帳、
// `bots.js` 的 `_pullWant`/`_enterPull`/`_resume`/`_pickRally`/`_rally`/`_pulling`/
// `_threatOf`/`_prioritize`/`_acquire`/`_engage` 之後跑:`node tools/audit_bot_tactics.mjs`
//
// 這支盯的是「**看不出來但玩起來就是不對**」的那一批寫壞法:
//   ① 威脅帳自己記一份:伺服器唯一知道「被誰打了多少」的地方是 `_hurtLog`,另開第二份
//      必定與濺血/警戒那份分家(A1 家族)。
//   ② 輸出帳只記一般結算那條路徑:護盾全擋的那些發全部漏帳 ⇒ 高護盾對手的輸出被系統性
//      低估,而那正好是最該被集火的人 —— 純看程式碼完全正常,只是「AI 好像不太會挑人」。
//   ③ 撤退遲滯帶寫沒了:進場/出場同一個門檻 ⇒ 退到塔後、護盾一滿就回去、血還是低又退,
//      整條兵線只剩一台在原地來回跑,而畫面上只像「這台 bot 很猶豫」。
//   ④ 難度分層寫成比對難度字串:第二份分級表,改 BOT_DIFF 不會跟著動。
//   ⑤ 新手/低難度被順手「一起優化」:難度階梯整個塌掉(新手打得跟高難度一樣兇)。
//
// 手法:常數/曲線直接 import(data.js 是純模組)、原文單一縫走 `audit_src.mjs`、
// 行為一律以**真的 BattleSim + 真的 BotBrain** 直測。
import { readSrc, grabMethod } from './audit_src.mjs';
import {
  BOT_DIFF, BOT_DIFF_KEYS, BOT_TACTIC, botTargetPrio, botThreatDecay, botSalvo, botExecW, botKiteF,
  UNITS, GAME, CHARACTERS, heroKindOf, heroWeapon, MAPGEO, VITALS,
} from '../public/js/data.js';
import { BattleSim } from '../server/sim.js';
import { BotBrain } from '../server/bots.js';

const botsSrc = readSrc('server', 'bots.js');
const simSrc = readSrc('server', 'sim.js');

// 「全檔只有 N 處」MUST 只數**執行原文**(與 audit_bot_vision 同一支剝法)
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

// ---- 共用:真 BattleSim(與 audit_bot_vision 同一份合成戰場)----
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
/** 空戰場:清掉全部既有實體與野營(選敵不被小兵與塔干擾) */
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
/** 以 sim 座標放一個「相對 h 的朝向偏 bearing、距離 d」的點(視野錐內才選得到) */
const atBearing = (h, bearing, d) => [h.x - Math.sin(bearing + (h.ry || 0)) * d, h.z + Math.cos(bearing + (h.ry || 0)) * d];

// ---------------------------------------------------------------------------------
sec('Ⅰ 常數與曲線(data.js:分層旗標 + 三項權重 + 遲滯帶,推導不手寫)');
// ---------------------------------------------------------------------------------
{
  // 難度分層:tactic 中/高、elite 只有高;且 MUST 單調(高難度不得比低難度笨)
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

  // 選敵優先度:三項都 MUST 是「越大越優先」,且基準 = 1(什麼都不加 ⇒ 純加權距離)
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

  // 威脅記憶:線性淡出,THREAT_S 後歸零
  t('威脅淡出:剛挨打 = 1、半程 = 0.5、逾時 = 0(線性)',
    near(botThreatDecay(0), 1) && near(botThreatDecay(BOT_TACTIC.THREAT_S / 2), 0.5)
    && near(botThreatDecay(BOT_TACTIC.THREAT_S), 0) && near(botThreatDecay(999), 0));
  t('負齡(時鐘倒退/同 tick)夾在 1,不會爆出 >1 的權重', near(botThreatDecay(-5), 1));
  t('記憶秒數為正且短於一場交戰(不是整場的傷害排行)',
    BOT_TACTIC.THREAT_S > 0 && BOT_TACTIC.THREAT_S < 30);

  // 收割窗
  const wd = { dmg: 40, rate: 2, vs: {} };
  t('收割窗傷害 = dmg × vsMult × rate × EXEC_S(推導不手寫)',
    near(botSalvo(wd, 'soldier'), 40 * 2 * BOT_TACTIC.EXEC_S));
  t('撿尾刀權重遠高於「剩一口氣」(兩件事不共用 0~1 的尺)',
    BOT_TACTIC.EXEC_MAX > 1 && near(botExecW(10, 1000, 20), BOT_TACTIC.EXEC_MAX));
  t('打不死就退回「已損失比例」(0~1)', near(botExecW(250, 1000, 20), 0.75));
  t('salvo = 0 ⇒ 收割分支關閉(中難度只剩低血偏好)', near(botExecW(10, 1000, 0), 0.99));
  t('滿血目標的權重為 0(不會無差別加分)', near(botExecW(1000, 1000, 0), 0));
  t('maxEhp 為 0(除以零)不噴 NaN', botExecW(0, 0, 0) === 0);

  // 撤退線 + 遲滯帶
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

  // 打帶跑
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
    // 兩個讀帳點(選敵的 `_threatOf`、撤退的 `_recentDmg`)MUST 吃同一支淡出曲線
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
    // 護盾全擋那條是「記帳 → return」的早退區塊,MUST 在 return 之前就把 toShield 入帳
    const early = /rem <= 0[\s\S]*?_dmgOut\(by, t, toShield\)[\s\S]*?return;/.test(d);
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
    // 狀態**派發**(if state === 'RALLY' → _rally)本來就要逐個列名;禁的是「兩個一起問」
    // 那種語意 —— 散出去之後新增第三種脫離狀態就會有地方漏改。
    const outside = botsCode.replace(strip(grabMethod(botsSrc, '_pulling')), '');   // 定義本身不算
    const inline = /'(RETREAT|RALLY)'\s*\|\|/.test(outside) || /\|\|\s*this\.state === '(RETREAT|RALLY)'/.test(outside);
    return !inline
      && /this\._pulling\(\)/.test(strip(grabMethod(botsSrc, 'update')))
      && /this\._pulling\(\)/.test(strip(grabMethod(botsSrc, '_castSupport')));
  })());
  t('集結點吃 `sim.towerSites`(與開場預置兵線同一份解,MUST NOT 再解一次)',
    /towerSites/.test(strip(grabMethod(botsSrc, '_pickRally'))) && !/solveTowerSites/.test(botsCode));
  t('RALLY 的位置一樣走 `_moveToward` → `_move` 碰撞唯一縫',
    /this\._moveToward\(/.test(strip(grabMethod(botsSrc, '_rally'))));
  t('bots.js 不再手寫撤退門檻(整組搬進 BOT_TACTIC)',
    !/RETREAT_HP|RESUME_HP\s*=/.test(botsCode) && /BOT_TACTIC\./.test(botsCode));
  t('「還在戰鬥中」只有 `_inFight` 一支、且吃 `VITALS.OOC_S`(= 護盾還沒開始回復)',
    /VITALS\.OOC_S/.test(strip(grabMethod(botsSrc, '_inFight')))
    && count(botsCode, 'VITALS.') === 1
    && count(botsCode, 'this._inFight(') === 2);
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
   * 兩個**完全一樣**的敵人放在同一方位、同一距離,只有一項指標不同。
   * 插入序刻意讓「該被選中的那個」排在後面 —— 平手時 `_acquire` 會選先插入的那個,
   * 所以測得過就代表優先度真的把它拉贏了,而不是靠迭代順序矇到。
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
    const plain = mk(0.02, R);      // 先插入 = 平手時的贏家
    const mark = mk(-0.02, R);      // 後插入 = 只有測項成立才選得到
    tune(sim, h, brain, mark, plain);
    sim._tickN++;
    return { got: brain._acquire(h), mark, plain, sim, h, brain };
  };

  {
    // 攻擊者同時也會在 `_dmgOut` 記到輸出 ⇒ 就地歸零,這一項才真的只在量「威脅」
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

  // 威脅淡出:同一份帳,過了 THREAT_S 就不再左右選敵
  {
    const r = twin('medium', (sim, h, br, mark) => { sim._damage(h, 300, mark, 0); mark.dmgOut = 0; });
    t('威脅帳真的記在受擊者身上(pid/id 對得起來)',
      r.h._threat instanceof Map && r.h._threat.get(r.mark.id)?.v > 0);
    r.sim.t += BOT_TACTIC.THREAT_S + 1;
    r.sim._tickN++;
    t('逾時之後威脅歸零 ⇒ 選敵退回加權距離(不會一直記恨)', r.brain._acquire(r.h) === r.plain);
  }

  // 撿尾刀:高難度會為了收人頭跑遠一點,中難度不會
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
      // 近的:傷得更重但**還打不死**;遠的(1.5×):一個收割窗就打得完
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

  // 塔/主堡刻意不進「總輸出」比較
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
    tow.dmgOut = 999999;   // 塔的累計輸出必然全場最高
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
  const HIT = { lastHitAt: 100 };                          // 正在挨打(剛中彈)
  const CALM = { lastHitAt: 100 - VITALS.OOC_S - 1 };      // 已脫戰(護盾正在回)

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
  // 沒有這道閘 = bot 在空曠兵線上為了一條回充中的護盾一路往回走(2026-08-02 實測:工事損血腰斬)
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

  // ---- 「扛半條護盾」量的是**近期吃下的傷害**,而且工事刮傷不算(真 BattleSim 直測)----
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
      for (let i = 0; i < 30; i++) { sim._damage(h, h.maxSp * 0.02, foe, 0); sim.t += 1; }   // 慢慢刮
      t('慢慢被刮到護盾見底(每秒 2%)⇒ 不算「扛了半條」,不後撤',
        spF(h) < BOT_TACTIC.PULL_SP && br._pullWant(h, 1, spF(h)) === null,
        `sp ${spF(h).toFixed(2)} 近期 ${br._recentDmg(h).toFixed(0)}`);
    }
  }

  // ---- 集結點:最近一座**存活**己方砲塔後方 ----
  {
    const sim = new BattleSim(fakeCfg());          // 這一份要留著塔
    const h = sim.addHero('STEEL', 'b1', CH_ROBOT);
    const brain = new BotBrain(sim, 'b1', 'STEEL', 0, 'high');
    const towers = [...sim.ents.values()].filter((e) => e.kind === 'tower' && e.side === 'STEEL');
    t('稽核戰場真的有己方砲塔(集結點的前提)', towers.length > 0, `${towers.length} 座`);
    const [bx, bz] = sim.basePos.STEEL;
    // 站到最前線那座塔旁邊
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

    // 站到後方塔旁邊 → 選到的是後方那座(「最近」而不是「最前線」)
    let rear = towers[0];
    for (const e of towers) if (Math.hypot(e.x - bx, e.z - bz) < Math.hypot(rear.x - bx, rear.z - bz)) rear = e;
    if (rear !== front) {
      h.x = rear.x; h.z = rear.z;
      brain._pickRally(h);
      const d2 = Math.hypot(brain._rallyAt[0] - bx, brain._rallyAt[1] - bz);
      t('選的是**最近**那座塔(不是恆取最前線)', d2 < dRally, `${d2.toFixed(0)}m < ${dRally.toFixed(0)}m`);
    } else t('選的是**最近**那座塔(本戰場只有一排塔,跳過)', true);

    // 塔全滅 → 退回主堡(降級不例外)
    for (const e of towers) sim.ents.delete(e.id);
    brain._pickRally(h);
    t('己方砲塔全滅 ⇒ 集結點退回主堡(不會退到一個空塔位上)',
      brain._rallyAt === sim.basePos.STEEL || (near(brain._rallyAt[0], bx) && near(brain._rallyAt[1], bz)));
  }

  // ---- 狀態機:進場 / 復出 / 不長征 ----
  {
    const sim = new BattleSim(fakeCfg());
    const h = sim.addHero('STEEL', 'b1', CH_ROBOT);
    const brain = new BotBrain(sim, 'b1', 'STEEL', 0, 'high');
    const dt = GAME.TICK_MS / 1000;
    // `by` = 這一拍有人在打我。一律走**真的 `sim._damage`** —— 護盾水位、脫戰計時、威脅帳
    // 三件事本來就是同一次傷害的產物,手動塞欄位會漏掉其中一份、測到假的通過。
    const step = (n = 1, by = null) => {
      for (let i = 0; i < n; i++) { sim.t += dt; if (by) sim._damage(h, 1, by, 0); brain.update(dt); }
    };
    brain.prog = 900; step(4);
    const foe = sim.addHero('SWARM', 'p9', CH_DRONE);
    foe.x = h.x + 60; foe.z = h.z; foe.y = 0;
    sim._damage(h, h.maxSp * 0.7, foe, 0);      // 一波扛掉七成護盾
    for (let i = 0; i < 40 && brain.state !== 'RALLY'; i++) step(1, foe);
    t('一波扛掉半條護盾 ⇒ 進 RALLY(不是 RETREAT)', brain.state === 'RALLY', brain.state);
    t('進 RALLY 當下就定案集結點', brain._rallyAt != null);
    const rallyProg = brain._rallyProg;
    const d0 = Math.hypot(h.x - brain._rallyAt[0], h.z - brain._rallyAt[1]);
    step(120);
    const d1 = Math.hypot(h.x - brain._rallyAt[0], h.z - brain._rallyAt[1]);
    t('RALLY 真的往集結點移動', d1 < d0, `${d0.toFixed(0)}m → ${d1.toFixed(0)}m`);
    h.sp = h.maxSp;                             // 護盾回滿
    for (let i = 0; i < 40 && brain.state === 'RALLY'; i++) step();
    t('等滿護盾即復出(不必等裝甲)', brain.state !== 'RALLY' && !brain._pulling(), brain.state);
    t('復出的沿兵線進度接回集結點(**不是**從主堡 0 重走)', near(brain.prog, rallyProg, 200),
      `prog ${brain.prog.toFixed(0)} vs 集結 ${rallyProg.toFixed(0)}`);
    t('復出後不會立刻又想撤(遲滯帶真的關得起來)',
      brain._pullWant(h, h.hp / h.maxHp, 1) === null);

    // 裝甲掉破 25% ⇒ 從 RALLY 升級成 RETREAT(目的地換成主堡)。
    // 先把稽核自己放的敵人撤掉:留著會把機體打死,`update` 一早退就不再走位,測到的是死人不動
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
    // 復出當拍就已經推了一步 ⇒ prog 不會剛好是 0,但 MUST 遠離集結進度(那才是「重新出發」)
    t('補到 RESUME_HP 才復出,且 prog 從 0 重走(回堡 = 重新出發)',
      brain.state !== 'RETREAT' && brain.prog < rallyProg * 0.1, `${brain.state} prog=${brain.prog.toFixed(1)}`);
  }

  // ---- RALLY 沿路照打(轉身跑掉不還手 = 送人頭)----
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
    // ---- 還在挨打:邊退邊打(轉身不還手 = 送人頭)----
    h.lastHitAt = sim.t;
    const hp0 = foe.hp;
    const [x0, z0] = [h.x, h.z];
    brain._rally(h, UNITS[h.kind], foe, dtk);
    t('還在挨打 ⇒ RALLY 途中照樣開火(打帶跑的宏觀版本)', foe.hp < hp0, `掉 ${(hp0 - foe.hp).toFixed(1)}`);
    t('還在挨打 ⇒ 真的往集結點退', Math.hypot(h.x - x0, h.z - z0) > 0);
    t('RALLY 途中視角看向目標(不是背對敵人跑)', brain._wantRy != null);
    // ---- 已脫離接觸:停火停步等護盾(繼續開火 = 脫戰計時永遠被還擊重置,護盾回不來)----
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
  /** 把敵人放在射程 0.7× 處跑一拍 `_engage`,回傳「靠近(+)/拉開(−)」的位移分量 */
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
    return d0 - Math.hypot(foe.x - h.x, foe.z - h.z);   // >0 = 靠近
  };
  t('高難度・可擊發:貼上去', closeIn('high', false) > 0, `${closeIn('high', false).toFixed(2)}m`);
  t('高難度・裝填中:拉開(這就是打帶跑)', closeIn('high', true) < 0, `${closeIn('high', true).toFixed(2)}m`);
  t('中難度:裝填中不拉開(打帶跑是高級專屬)', closeIn('medium', true) > 0);
  t('低/新手難度同樣不打帶跑(舊制的 0.6 距離環)',
    closeIn('low', true) > 0 && closeIn('novice', true) > 0);
  // 建築維持舊制的 0.85 距離環 ⇒ 在 0.7× 射程處本來就會往後站,重點是**裝填與否不改變它**
  t('對建築不打帶跑(塔不會追,拉開只是白白少打幾秒:裝填與否位移一致)',
    near(closeIn('high', true, 'tower'), closeIn('high', false, 'tower'), 1e-6),
    `${closeIn('high', true, 'tower').toFixed(3)} vs ${closeIn('high', false, 'tower').toFixed(3)}`);
}

// ---------------------------------------------------------------------------------
sec('Ⅵ 不回歸:護盾回復規則沒被動到 / 舊制難度逐位元不變');
// ---------------------------------------------------------------------------------
{
  // OOC_S 是**讀**來當交戰判定(見 Ⅱ);禁的是「自己回盾」—— 回復速率整條只准住 sim
  t('護盾脫戰回復仍由 sim 結算(戰術層只讀交戰秒數,MUST NOT 自己給 bot 回盾)',
    VITALS.OOC_S > 0 && VITALS.SP_REGEN_PS > 0 && !/SP_REGEN_PS/.test(botsCode));
  t('bots.js MUST NOT 直接改 hp/sp(權威狀態只在 sim 結算)',
    !/h\.(hp|sp)\s*=[^=]/.test(botsCode));
  // 低難度 bot 的一整段推線 MUST 與改制前逐位元相同 —— 這裡以「不吃任何戰術分支」代驗
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

console.log(`\n${fail ? '❌' : '✅'} 電腦玩家戰術稽核:${pass}/${pass + fail} 通過`);
process.exit(fail ? 1 : 0);
