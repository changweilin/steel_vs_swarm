// ============ 劇情戰役:攻堅順序鎖血 + 階段對話 稽核 ============
// 用途:改 `data.js` 的 `SIEGE`/`siegeSiteStages()`/`siegeOpenStage()`、`sim.js` 的
// `siegeLocked`/`_siegeFell`/`_spawnStructures`/`_damage`/`_tgBlockedD`/`_serializeEnt`、
// `bots.js` 的 `_acquire`,或 `storytalk.js` 的任何一場對白之後跑。
//
// 為什麼這兩件事合在一支:它們是同一條規則的兩端 —— 伺服器決定「第幾階被推平」,
// 對白決定「那一刻誰開口」。分兩支稽核的話,階段語意一改(例如把 front/mid 對調),
// 對白那半照樣全綠,而玩家看到的是「拔掉前線塔卻演出終場對白」。
//
// 四類會靜默壞掉的事(每一類都不會有錯誤訊息,只會表現成「劇情怪怪的」或「兵不推了」):
//   ① **前線塔判錯邊** —— `solveTowerSites()` 回傳的是 `[後塔, 前塔]`,而兵線太短時只有一個元素。
//      拿陣列索引當判據會在單塔位兵線上剛好對、雙塔位兵線上剛好相反 ⇒ 半張地圖的鎖血順序是反的。
//   ② **只擋傷害不擋索敵** —— 小兵與砲塔會停在打不動的目標前面,整條兵線卡死。
//   ③ **對白的發言者不在場** —— 頻道裡冒出一張這一章根本沒出戰的頭像。
//   ④ **有人整章不開口** —— 三場對白加起來沒蓋滿名冊,那一章的陣容有一半是啞的。
//
// 反向驗證(原則 9;每一支都 MUST 讓對應條目紅字,否則等於沒驗到):
//   node tools/audit_story_talk.mjs --break-stage    前線塔判據改回陣列索引
//   node tools/audit_story_talk.mjs --break-gate     拿掉 _tgBlockedD 的鎖血閘(只擋傷害)
//   node tools/audit_story_talk.mjs --break-cast     對白塞一名不在該章名冊的發言者
//   node tools/audit_story_talk.mjs --break-quota    對白多塞兩句超出配額
//   node tools/audit_story_talk.mjs --break-book     故事書自己覆寫一條對話條樣式(第二份版面)
//   node tools/audit_story_talk.mjs --break-floor    拿掉區域 BOSS 關卡的 HP 地板
//   node tools/audit_story_talk.mjs --break-talk     BOSS 倒下不起算對白窗(當場解鎖)
// 跑法:`node tools/audit_story_talk.mjs`
// 讀原文與抽方法走 `audit_src.mjs` 單一縫(含換行正規化 —— 逐行剝註解在 CRLF 工作區會靜默失效)。
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { readSrc, grabMethod, ROOT } from './audit_src.mjs';
import { briefHTML } from '../public/js/storyui.js';
import { SIEGE, siegeSiteStages, siegeOpenStage, siegeTalkS, CHARACTERS, MAPGEO } from '../public/js/data.js';
import { BattleSim } from '../server/sim.js';
import { STORY, chapterSide } from '../public/js/story.js';
import { STORY_TALK, talkOf, stageKey } from '../public/js/storytalk.js';

const ARG = new Set(process.argv.slice(2));
const BRK = {
  stage: ARG.has('--break-stage'), gate: ARG.has('--break-gate'),
  cast: ARG.has('--break-cast'), quota: ARG.has('--break-quota'),
  book: ARG.has('--break-book'),
  floor: ARG.has('--break-floor'), talk: ARG.has('--break-talk'),
};

const simSrc = readSrc('server', 'sim.js');
const botSrc = readSrc('server', 'bots.js');
const dataSrc = readSrc('public', 'js', 'data.js');

/** 剝掉區塊/行註解(「全檔只有 N 處」這類計數 MUST 只數執行原文) */
const strip = (s) => s
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .split('\n').map((l) => l.replace(/(^|[^:'"`])\/\/.*$/, '$1')).join('\n');
const simCode = strip(simSrc);
const botCode = strip(botSrc);

let pass = 0, fail = 0;
const t = (n, ok, extra = '') => { ok ? (pass++, console.log(`  ✓ ${n}`)) : (fail++, console.log(`  ✗ ${n} ${extra}`)); };
const count = (s, needle) => s.split(needle).length - 1;

// ---------------------------------------------------------------------------
console.log('■ Ⅰ 階段定義(data.js SIEGE:順序 / 推導 / 前線判據)');
// ---------------------------------------------------------------------------
{
  t('階段順序 = 前線 → 中段 → 主堡', JSON.stringify(SIEGE.STAGES) === JSON.stringify(['front', 'mid', 'base']),
    JSON.stringify(SIEGE.STAGES));
  t('階段名稱與順序等長(HUD 取字不會拿到 undefined)', SIEGE.NAMES.length === SIEGE.STAGES.length);
  t('SIEGE.BASE 由長度推導,MUST NOT 手寫', SIEGE.BASE === SIEGE.STAGES.length - 1
    && /SIEGE\.BASE\s*=\s*SIEGE\.STAGES\.length\s*-\s*1/.test(dataSrc), `${SIEGE.BASE}`);

  // 前線 = frac 最大(最靠戰場中線)。solveTowerSites 的回傳序是 [後塔, 前塔] ⇒ 索引與階段**相反**,
  // 這一項就是 --break-stage 要咬住的地方。
  const sites2 = [{ frac: 0.12 }, { frac: 0.31 }];              // 雙塔位:回傳序 [後, 前]
  const stages2 = BRK.stage ? sites2.map((_, i) => i) : siegeSiteStages(sites2);
  t('雙塔位:frac 大的那一座 = 前線(0)', stages2[1] === 0 && stages2[0] === 1, JSON.stringify(stages2));
  const sites1 = [{ frac: 0.24 }];                              // 單塔位兵線(後塔塞不下)
  const stages1 = BRK.stage ? sites1.map((_, i) => i) : siegeSiteStages(sites1);
  t('單塔位兵線:唯一那一座 = 前線(0)', stages1[0] === 0, JSON.stringify(stages1));
  t('階段值恆落在 [0, BASE)', [...stages2, ...stages1].every((s) => s >= 0 && s < SIEGE.BASE));

  t('開放階段 = 仍有存活建築的最低階', siegeOpenStage([4, 4, 1]) === 0
    && siegeOpenStage([0, 4, 1]) === 1 && siegeOpenStage([0, 0, 1]) === SIEGE.BASE);
  t('全滅回主堡階(不會回到已清空的階)', siegeOpenStage([0, 0, 0]) === SIEGE.BASE);
}

// ---------------------------------------------------------------------------
console.log('\n■ Ⅱ 伺服器結算(sim.js:鎖血唯一縫 + 三個消費端 + 階段推進)');
// ---------------------------------------------------------------------------
{
  t('`siegeLocked` 是 sim 的具名方法(唯一縫)', /\n  siegeLocked\(t\)\s*\{/.test(simSrc));
  const locked = grabMethod(simSrc, 'siegeLocked');
  t('鎖血判據 = 旗標 + 階段比較(MUST NOT 比對 kind 字串)',
    /this\.siege/.test(locked) && /t\.sg\s*>\s*this\._siegeOpen\[t\.side\]/.test(locked)
    && !/kind\s*===/.test(locked), locked.replace(/\s+/g, ' ').slice(0, 120));

  // 三個消費端:_damage(擋傷害)/ _tgBlockedD(擋小兵與塔索敵)/ bots._acquire(擋 AI 索敵)
  const dmg = grabMethod(simSrc, '_damage');
  t('消費端①:`_damage` 早退', /siegeLocked\(t\)\)\s*return;/.test(dmg));
  const dmgLines = dmg.split('\n').map((l) => l.trim());
  const iInv = dmgLines.findIndex((l) => l.includes('t.inv'));
  const iLock = dmgLines.findIndex((l) => l.includes('siegeLocked'));
  t('早退 MUST 排在任何記帳之前(助攻/仇恨/吸血都不該對免傷目標記一筆)',
    iLock > iInv && iLock < dmgLines.findIndex((l) => l.includes('asst')), `inv@${iInv} lock@${iLock}`);
  const tg = BRK.gate ? '' : grabMethod(simSrc, '_tgBlockedD');
  t('消費端②:`_tgBlockedD` 把鎖血目標排除在索敵之外(只擋傷害會把兵線卡死)',
    /siegeLocked\(t\)\)\s*return true;/.test(tg));
  const acq = grabMethod(botSrc, '_acquire');
  t('消費端③:`bots._acquire` 轉呼同一支(MUST NOT 在 bots 另寫判據)',
    /this\.sim\.siegeLocked\(t\)\)\s*continue;/.test(acq));
  t('bots.js 不自帶第二份階段判據', !/_siegeOpen|\.sg\s*>/.test(botCode));

  // 呼叫端恰兩處、且都在 `_kill`:建築陣亡那一條 + NPC BOSS 整隊全滅那一條(BOSS 與同階
  // 砲塔同屬一階,見 sim.addHero 的點名)。加上定義本身 = 原文出現三次。
  t('階段推進只有 `_siegeFell` 一份,且只在 `_kill` 呼叫',
    count(simCode, '_siegeFell(') === 3 && count(grabMethod(simSrc, '_kill'), '_siegeFell(') === 2,
    `${count(simCode, '_siegeFell(')} 處`);
  const fell = grabMethod(simSrc, '_siegeFell');
  t('事件送的是**剛被推平**的那一階(不是新開放的那一階)',
    /stage:\s*fell/.test(fell) && /const fell = this\._siegeOpen\[t\.side\]/.test(fell));
  t('非劇情戰役不發 siege 事件(對局行為逐位元不變)', /if \(this\.siege\)\s*this\.events\.push/.test(fell));
  t('`siege` 事件全 sim 只有這一個發送點', count(simCode, "e: 'siege'") === 1);

  // ---- 區域 BOSS 關卡(2026-08-14 使用者:「敵方砲塔主堡會鎖住 HP1 直到區域 BOSS 被擊敗且
  // 對話結束」)。這是鎖血之外的**第二道閘**,兩者的結算語意刻意不同 —— 合併就會把其中一邊
  // 的症狀帶到另一邊(把地板當免傷 = 塔照樣被拆;把免傷當地板 = 打不動的塔留在索敵名單裡)。
  const floorSrc = BRK.floor ? '' : grabMethod(simSrc, 'siegeHpFloor');
  t('HP 地板回 `SIEGE.BLD_HP_FLOOR`,且 BOSS 自己不吃(判據 `!t.hero`)',
    /SIEGE\.BLD_HP_FLOOR : 0;/.test(floorSrc) && /t\.hero/.test(floorSrc));
  t('地板的消費端**只有 `_damage`**(索敵那兩支 MUST NOT 吃 —— 打得到卻死不了的塔仍要被打)',
    count(simCode, 'siegeHpFloor(') === 2
    && /floorHp = Math\.max\(floorHp, this\.siegeHpFloor\(t\)\);/.test(dmg)
    && !/siegeHpFloor/.test(tg) && !/siegeHpFloor/.test(botCode),
    `${count(simCode, 'siegeHpFloor(')} 處`);
  t('地板併進既有的 `floorHp` 通道(那條路徑本來就是「扣得動、夾地板、不呼叫 _kill」)',
    /if \(floorHp\) \{/.test(dmg) && dmg.indexOf('siegeHpFloor') < dmg.indexOf('if (floorHp) {'));
  const bfell = BRK.talk ? '' : grabMethod(simSrc, '_bossFell');
  t('對白窗由 `siegeTalkS` 起算(主堡那一階回 0 = 當場解禁,它的對白在結算畫面播)',
    /this\._talkUntil\[t\.side\]\[t\.sg\] = this\.t \+ siegeTalkS\(t\.sg\);/.test(bfell)
    && siegeTalkS(SIEGE.BASE) === 0 && siegeTalkS(0) === SIEGE.TALK_S && SIEGE.TALK_S > 0);
  t('`siegeTalk` 全 sim 只有這一個發送點,且只在 `_kill` 的 BOSS 分支推進',
    count(simCode, "e: 'siegeTalk'") === 1 && count(simCode, '_bossFell(') === 2
    && /this\._bossFell\(t\);/.test(grabMethod(simSrc, '_kill')));

  const spawn = grabMethod(simSrc, '_spawnStructures');
  t('塔位階段走 `siegeSiteStages`(MUST NOT 用 st 的陣列索引)',
    /siegeSiteStages\(sites\[li\]\)/.test(spawn) && /sg:\s*stages\[si\]/.test(spawn));
  t('主堡階段 = SIEGE.BASE(推導不手寫 2)', /sg:\s*SIEGE\.BASE/.test(spawn));
  t('逐階存活數只在開場點一次名(建築只減不增)', /_siegeLeft\[side\] = new Array\(SIEGE\.STAGES\.length\)/.test(spawn));

  const ser = grabMethod(simSrc, '_serializeEnt');
  t('鎖血狀態隨快照下發(客戶端血條變灰 + 排除射程光暈)', /siegeLocked\(e\)\)\s*o\.lk = 1;/.test(ser));

  const roomSrc = readSrc('server', 'rooms.js');
  // 2026-08-13 起 `cfg.siege` 不再是獨立旗標,而是劇情戰役旗標 `cfg.defSide` 的**推導**
  // (兩格各送一份就會出現「照順序鎖血但沒有 BOSS」的半套狀態;見 data.js STORY_MAP)。
  t('`cfg.siege` MUST 在 rooms.js 由 `cfg.defSide` 推導(battleConfig 整包由客戶端送上來)',
    /cfg\.siege = !!cfg\.defSide;/.test(roomSrc)
    && /cfg\.defSide = \(cfg\.defSide === 'SWARM' \|\| cfg\.defSide === 'STEEL'\) \? cfg\.defSide : null;/.test(roomSrc));
}

// ---------------------------------------------------------------------------
console.log('\n■ Ⅲ 對白涵蓋(storytalk.js:六章 × 兩陣營 × 三階段)');
// ---------------------------------------------------------------------------
const SIDES2 = ['STEEL', 'SWARM'];
{
  let miss = [];
  for (const ch of STORY) for (const side of SIDES2) for (let i = 0; i < SIEGE.STAGES.length; i++) {
    const sc = talkOf(ch.id, side, stageKey(i));
    if (!sc || !Array.isArray(sc.lines) || sc.lines.length < 2) miss.push(`${ch.id}/${side}/${stageKey(i)}`);
  }
  t(`每章每陣營每階段都有對白(${STORY.length}×2×${SIEGE.STAGES.length} 場)`, miss.length === 0, miss.join(' '));
  t('階段鍵一律走 SIEGE.STAGES(storytalk 不自帶第二份順序表)',
    /SIEGE\.STAGES\[i\]/.test(readSrc('public', 'js', 'storytalk.js')));
  t('對白只出現在名冊內的章節(無多餘章節鍵)',
    Object.keys(STORY_TALK).every((k) => STORY.some((c) => c.id === k)), Object.keys(STORY_TALK).join(','));
}

// ---------------------------------------------------------------------------
console.log('\n■ Ⅳ 選角規則(發言者 ⊆ 該章名冊 / 雙方都有人 / 每人 4~5 句 / 三場蓋滿名冊)');
// ---------------------------------------------------------------------------
{
  // 期望值(4~5 句)恆定 —— `--break-*` MUST 只動**被驗的東西**,動期望值的話 break 永遠是綠的
  // (見 CLAUDE.md §5.4 ㋑)。故 --break-quota 改成往資料裡多塞幾句。
  const QUOTA = [4, 5];
  const bad = { cast: [], solo: [], quota: [], cover: [] };
  for (const ch of STORY) for (const side of SIDES2) {
    const foe = side === 'STEEL' ? 'SWARM' : 'STEEL';
    const mine = [...chapterSide(ch, side).heroes, ...chapterSide(ch, side).mercs];
    const theirs = [...chapterSide(ch, foe).heroes, ...chapterSide(ch, foe).mercs];
    const roster = new Set([...mine, ...theirs]);
    const seen = new Set();
    for (let i = 0; i < SIEGE.STAGES.length; i++) {
      const sc = talkOf(ch.id, side, stageKey(i));
      if (!sc) continue;
      const tag = `${ch.id}/${side}/${stageKey(i)}`;
      let lines = sc.lines;
      if (BRK.cast && i === 0) lines = [...lines, { ch: 's01', t: '(不該在場)' }];
      if (BRK.quota && i === 0) lines = [...lines, lines[0], lines[0]];   // 同一人多講兩句 → 超出配額
      const n = new Map();
      for (const l of lines) {
        if (!CHARACTERS[l.ch]) bad.cast.push(`${tag}:未知角色 ${l.ch}`);
        else if (!roster.has(l.ch)) bad.cast.push(`${tag}:${CHARACTERS[l.ch].code} 不在名冊`);
        n.set(l.ch, (n.get(l.ch) || 0) + 1);
        seen.add(l.ch);
      }
      const speakers = [...n.keys()];
      if (!speakers.some((c) => mine.includes(c)) || !speakers.some((c) => theirs.includes(c))) bad.solo.push(tag);
      for (const [c, k] of n) if (k < QUOTA[0] || k > QUOTA[1]) bad.quota.push(`${tag}:${CHARACTERS[c]?.code || c} ${k} 句`);
    }
    for (const c of roster) if (!seen.has(c)) bad.cover.push(`${ch.id}/${side}:${CHARACTERS[c]?.code || c} 整章沒開口`);
  }
  t('發言者全部出自該章雙方名冊(story.js heroes + mercs)', bad.cast.length === 0, bad.cast.join(' / '));
  t('每一場都有雙方的人(不是獨白)', bad.solo.length === 0, bad.solo.join(' '));
  t(`每人每場 ${QUOTA[0]}~${QUOTA[1]} 句`, bad.quota.length === 0, bad.quota.join(' / '));
  t('三場加起來蓋滿雙方名冊(沒有人整章是啞的)', bad.cover.length === 0, bad.cover.join(' / '));
}

// ---------------------------------------------------------------------------
console.log('\n■ Ⅴ 內容衛生(標題 / 旁白 / 台詞不空、不夾標記)');
// ---------------------------------------------------------------------------
{
  const bad = [];
  for (const ch of STORY) for (const side of SIDES2) for (let i = 0; i < SIEGE.STAGES.length; i++) {
    const sc = talkOf(ch.id, side, stageKey(i));
    if (!sc) continue;
    const tag = `${ch.id}/${side}/${stageKey(i)}`;
    if (!sc.title || !sc.note) bad.push(`${tag}:缺 title/note`);
    for (const l of sc.lines) {
      if (!l.t || !l.t.trim()) bad.push(`${tag}:${l.ch} 空台詞`);
      if (/[<>&]/.test(l.t) || /[<>&]/.test(sc.title) || /[<>&]/.test(sc.note)) bad.push(`${tag}:含標記字元`);
      if (l.t && l.t.length > 46) bad.push(`${tag}:${l.ch} 台詞 ${l.t.length} 字(對話條放不下)`);
    }
  }
  t('每場都有標題與戰況旁白', !bad.some((b) => b.includes('缺 title')), bad.filter((b) => b.includes('缺 title')).join(' '));
  t('台詞非空、不含 HTML 標記字元', !bad.some((b) => /空台詞|標記字元/.test(b)), bad.filter((b) => /空台詞|標記字元/.test(b)).join(' '));
  t('單句 ≤ 46 字(對話條一行放得下)', !bad.some((b) => b.includes('放不下')), bad.filter((b) => b.includes('放不下')).join(' / '));
}

// ---------------------------------------------------------------------------
console.log('\n■ Ⅵ 客戶端接線(game.js 事件 / dialogue.js 演出 / main.js 觸發)');
// ---------------------------------------------------------------------------
{
  const gameSrc = strip(readSrc('public', 'js', 'game.js'));
  const mainSrc = strip(readSrc('public', 'js', 'main.js'));
  t('game.js 收 `siegeTalk` 事件並上拋(客戶端 MUST NOT 自己判階段)',
    /ev\.e === 'siegeTalk'/.test(gameSrc) && /onSiege/.test(gameSrc));
  t('只有**敵方**那一階的區域 BOSS 倒下才演出(自己這邊的 BOSS 倒下不演戲)',
    /if \(ev\.side !== this\.side\) this\.onSiege\?\./.test(gameSrc));
  // 2026-08-14:對白的觸發點自「整階被推平」搬到「區域 BOSS 被擊敗」—— 使用者的順序是
  // 「BOSS 死 → 對話 → 才拆得掉建築」。掛回推平事件的話對白永遠慢一步(而且那時建築已經沒了,
  // 鎖不鎖已經沒有意義),兩邊都掛則同一場對白播兩次。
  t('`onSiege` 只掛在 `siegeTalk`,MUST NOT 也掛在「整階被推平」的 `siege` 上(否則播兩次)',
    !((gameSrc.split("ev.e === 'siege')")[1] || '').split('} else if')[0] || '').includes('onSiege')
    && count(gameSrc, 'this.onSiege?.(') === 1);
  t('對話演出層只有 dialogue.js 一份(MUST NOT 併進 cutin.js)',
    !/STORY_TALK/.test(strip(readSrc('public', 'js', 'cutin.js'))));
  // 旗標只有一格:main.js 帶 `defSide`(= venueConfig 的第三參數),`cfg.siege` 由 rooms 推導 ——
  // 客戶端 MUST NOT 再自己送一份(送了就有兩個真相,而它們可以不一致)
  t('main.js 只帶劇情戰役旗標 `defSide`(cfg.siege 由伺服器推導)',
    /venueConfig\(v, ch\.teamSize, foe\)/.test(mainSrc) && !/cfg\.siege\s*=/.test(mainSrc));
  t('main.js 取對白走 `talkOf`(MUST NOT 直接索引 STORY_TALK)',
    /talkOf\(/.test(mainSrc) && !/STORY_TALK\[/.test(mainSrc));
  const css = readSrc('public', 'css', 'style.css');
  t('對話條 MUST NOT 掛 CSS transition(逐句切換會被補間拖成殘影)',
    /\.dlg-line\b/.test(css) && !/\.dlg-line[^{]*\{[^}]*transition/.test(css));
}

// ---------------------------------------------------------------------------
console.log('\n■ Ⅶ 行為直測(真的建一座 BattleSim,逐階打過去)');
// ---------------------------------------------------------------------------
{
  // 合成戰場(與 test/e2e.mjs fakeBattleConfig 同形:兩點主堡 + 二次貝茲兵線);
  // 這裡只需要幾何合法,不需要真實圖資。
  const A = [25.0330, 121.5654], L = 2, D = 1600 * L, R = 6371000;
  const realD = D * MAPGEO.REAL_SCALE;
  const B = [A[0] + realD / R * 180 / Math.PI, A[1]];
  const ctr = [(A[0] + B[0]) / 2, (A[1] + B[1]) / 2];
  const mkLane = (off) => {
    const dLng = off / (R * Math.cos(A[0] * Math.PI / 180)) * 180 / Math.PI;
    const c = [ctr[0], ctr[1] + dLng], pts = [];
    for (let t = 0; t <= 1.001; t += 0.05) {
      const u = 1 - t;
      pts.push([u * u * A[0] + 2 * u * t * c[0] + t * t * B[0], u * u * A[1] + 2 * u * t * c[1] + t * t * B[1]]);
    }
    return pts;
  };
  const sizeM = D / (0.85 * Math.SQRT2);
  const cfg = (siege) => ({
    center: { lat: ctr[0], lng: ctr[1] }, bases: { SWARM: A, STEEL: B },
    lanes: [mkLane(0.3 * realD), mkLane(-0.3 * realD)],
    sizeM, diagM: sizeM * Math.SQRT2, distM: D, teamSize: 3, siege, defSide: siege ? 'SWARM' : null,
  });

  const structs = (sim, side, sg) =>
    [...sim.ents.values()].filter((e) => e.side === side && e.sg === sg);
  /** 打到死;回傳「真的掉血了嗎」 */
  const smash = (sim, e) => { const h0 = e.hp; sim._damage(e, 1e9, null, 999); return e.hp < h0; };

  const s = new BattleSim(cfg(true));
  const front = structs(s, 'SWARM', 0), midT = structs(s, 'SWARM', 1), base = structs(s, 'SWARM', SIEGE.BASE);
  t('塔位分成兩階,每階都有塔;主堡自成一階', front.length > 0 && midT.length > 0 && base.length === 1,
    `前線 ${front.length} / 中段 ${midT.length} / 主堡 ${base.length}`);
  t('開場:中段砲塔與主堡鎖血', s.siegeLocked(midT[0]) && s.siegeLocked(base[0]));
  t('開場:前線砲塔打得動', !s.siegeLocked(front[0]) && smash(s, front[0]));
  t('鎖血 = 完全免傷(不是減傷)', !smash(s, midT[0]) && midT[0].hp === midT[0].maxHp);
  t('鎖血目標不列入索敵(小兵不會停在打不動的塔前面)',
    s._tgBlockedD({ x: midT[0].x, z: midT[0].z, side: 'STEEL' }, { range: 1e6 }, null, midT[0], 0) === true);

  s.events.length = 0;
  for (const e of front) smash(s, e);
  const ev0 = s.events.filter((e) => e.e === 'siege');
  t('前線全滅 → 發一次 siege 事件,stage = 剛被推平的那一階',
    ev0.length === 1 && ev0[0].stage === 0 && ev0[0].side === 'SWARM', JSON.stringify(ev0));
  t('前線全滅 → 中段解鎖、主堡仍鎖', !s.siegeLocked(midT[0]) && s.siegeLocked(base[0]));

  s.events.length = 0;
  for (const e of midT) smash(s, e);
  const ev1 = s.events.filter((e) => e.e === 'siege');
  t('中段全滅 → stage = 1 的 siege 事件', ev1.length === 1 && ev1[0].stage === 1, JSON.stringify(ev1));
  t('中段全滅 → 主堡解鎖', !s.siegeLocked(base[0]) && smash(s, base[0]));
  t('對手那一側不受影響(鎖血逐陣營各算各的)',
    !s.siegeLocked(structs(s, 'STEEL', SIEGE.BASE)[0]));

  // 一般對戰:旗標關掉 ⇒ 整套 no-op(對局行為逐位元同舊制)
  const n = new BattleSim(cfg(false));
  const nFront = structs(n, 'SWARM', 0), nBase = structs(n, 'SWARM', SIEGE.BASE);
  t('非劇情戰役:砲塔與主堡開場就打得動', !n.siegeLocked(nFront[0]) && smash(n, nFront[0])
    && !n.siegeLocked(nBase[0]) && smash(n, nBase[0]));
  n.events.length = 0;
  for (const e of structs(n, 'SWARM', 0)) smash(n, e);
  t('非劇情戰役:不發 siege 事件', n.events.filter((e) => e.e === 'siege').length === 0);
  t('非劇情戰役:快照不帶 sg 欄位', n.snapshotFor('STEEL').sg === undefined
    && s.snapshotFor?.('STEEL') !== undefined);
}

// ---------------------------------------------------------------------------
console.log('\n■ Ⅷ 本地故事書(tools/story_book:MUST 是真品的另一個入口,不是第二個作品)');
// ---------------------------------------------------------------------------
{
  const bookJs = strip(readSrc('tools', 'story_book', 'book.js'));
  const bookCss = readSrc('tools', 'story_book', 'book.css')
    + (BRK.book ? '\n.dlg-bar { bottom: 20px; font-size: 22px; }\n' : '');
  const bookHtml = readSrc('tools', 'story_book', 'index.html');
  const srvJs = strip(readSrc('tools', 'story_book.mjs'));
  const uiJs = readSrc('public', 'js', 'storyui.js');
  const mainJs = strip(readSrc('public', 'js', 'main.js'));

  // ① 同一份標記 / 同一支演出 / 同一份 CSS —— 這三條就是「完全仿照正式遊戲的呈現」的全部內容
  t('章節卡 / 簡報 / 結算文案走真品 `storyui.js`',
    /from '\/public\/js\/storyui\.js'/.test(bookJs)
    && /chapterCardHTML\(/.test(bookJs) && /briefHTML\(/.test(bookJs) && /overText\(/.test(bookJs));
  t('對話演出走真品 `dialogue.js`(MUST NOT 在故事書另寫一套對話條)',
    /from '\/public\/js\/dialogue\.js'/.test(bookJs) && /new Dialogue\(/.test(bookJs)
    && !/dlg-bar|dlg-say|dlg-track/.test(bookJs));
  t('樣式吃遊戲原檔 `public/css/style.css`', /href="\/public\/css\/style\.css"/.test(bookHtml));
  // book.css 只准畫**台子自己的框**。判準逐條選擇器看:
  //   ㋐ 每條選擇器 MUST 帶台子自己的記號(`bk-` / `storybook`)—— 沒有的話它就作用在遊戲元件上;
  //   ㋑ `.overlay-box` / `.sb-*` / `.dlg-*` **一個字都不准提** —— 那三族是簡報、結算與對話條本體,
  //      在這裡動它們等於「故事書裡的樣子遊戲從來沒出現過」;
  //   ㋒ `.chapter-card` 只准跟台子的狀態 class 一起出現(選中的那張加個外框是台子的事,
  //      不是把卡片改成另一種長相)。
  {
    const rules = bookCss.replace(/\/\*[\s\S]*?\*\//g, '')
      .split('}').map((b) => b.split('{')[0].trim()).filter((s) => s && !s.startsWith('@'));
    const bad = rules.filter((sel) =>
      !/bk-|storybook/.test(sel)
      || /\.overlay-box|\.sb-|\.dlg-/.test(sel)
      || (/\.chapter-card/.test(sel) && !/\.chapter-card[\w.-]*\.bk-/.test(sel)));
    t('book.css 只畫台子的框:不覆寫 .overlay-box / .sb-* / .dlg-*,.chapter-card 只准加台子狀態',
      bad.length === 0, bad.join(' | '));
  }
  t('對白內容只經 `talkOf`(MUST NOT 直接索引 STORY_TALK)',
    /talkOf\(/.test(bookJs) && !/STORY_TALK\[/.test(bookJs));

  // ② 頁序推導自 SIEGE.STAGES —— 手寫五頁的話,攻堅階段一加,故事書就少一頁而沒有錯誤訊息
  t('頁序推導自 `SIEGE.STAGES`,兩端(server / 頁面)都不手寫',
    /SIEGE\.STAGES\.map/.test(bookJs) && /SIEGE\.STAGES\.length/.test(srvJs));
  t('缺頁 MUST 列出來(覆核台把漏掉的東西藏起來就沒有意義)',
    /missing/.test(srvJs) && /miss/.test(bookJs));

  // ③ 唯讀:不得寫回通關進度 —— 寫滿的話使用者下次真的開遊戲會發現自己「已經通關了」
  t('故事書 MUST NOT 碰通關進度(localStorage / markCleared)',
    !/localStorage|markCleared|svs_story/.test(bookJs + srvJs));
  t('全開是**參數**不是分支(`unlocked: true`)', /unlocked:\s*true/.test(bookJs));

  // ④ 逐句翻頁是故事書專屬:遊戲本體 MUST NOT 傳 manual(戰鬥中沒有人能按「下一句」)
  t('`manual` 逐句模式只給故事書用,main.js 不得出現', /manual/.test(bookJs) && !/manual/.test(mainJs));
  t('遊戲本體的 radio 呼叫不帶選項(逐位元同舊制)', /app\.dlg\?\.radio\(sc\);/.test(mainJs));

  // ⑤ 住 tools/ 不住 public/ —— build_solo 是把 public/** 整包複製的
  t('故事書住 tools/,MUST NOT 混進 public/', !existsSync(join(ROOT, 'public', 'story_book')));
  t('storyui.js 兩個消費端都吃同一份(main.js + 故事書)',
    /from '\.\/storyui\.js'/.test(mainJs) && /storyui\.js/.test(bookJs));
  t('storyui.js 零 three ⇒ Node 端載得起來(本稽核就是證據)', typeof briefHTML === 'function'
    && !/from 'three'/.test(uiJs));
}

console.log(`\n${fail ? '❌' : '✅'} 攻堅順序 / 劇情對話稽核:${pass}/${pass + fail} 通過`);
process.exit(fail ? 1 : 0);
