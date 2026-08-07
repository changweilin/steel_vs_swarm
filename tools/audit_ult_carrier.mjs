// ============ 大招載具遞送稽核(2026-08-06 使用者定案)============
// 定案三條:①**區域/指向型大招全轉**載具形式(strike/emp/summon + 團隊 heal/buff = 23 台),
//   純自身型 9 台維持瞬發不變;②**合併為一招**(長按 = E = heroCast('ult') → _launchUltCarrier
//   單一縫;純傷害機種絕招對 converted 角色退場);③**效果取代傷害**(載具抵達只施放效果,
//   不再附機種絕招爆風;擊落 = 該份否定)。
//
// 防的病灶(全部無錯誤訊息):
//   ・轉換名冊手寫 ⇒ 加角色/改 fx 之後名冊靜默漂移(推導判定 ultDelivered 是唯一縫);
//   ・CD 映射改成分段表 ⇒ 排名翻掉(仿射保序是**保證**不是巧合);
//   ・效果分支在載具端另抄一份 ⇒ heroCast 改了、載具照舊(_castEffect 單一縫);
//   ・機種絕招復辟 ⇒ 那個機種同時領兩份載具(大招 + 機種絕招),而預算只發了一份;
//   ・「效果取代傷害」漏一條引爆路徑 ⇒ 補血機炸人(預算雙重領,畫面上只是「傷害偏高」)。
//
// 2026-08-06 第二階段(長按 = 招式手勢)之後,②「合併為一招」的驗法**換了一把更硬的尺**:
// 機種絕招三個入口(heroKamikaze / heroDecoy / heroHyper)**整組退場**,守衛也就沒有東西可守
// ⇒ 改驗「三種載具的**唯一生成點** = _launchUltCarrier」。這比逐入口驗守衛強:守衛是「舊路徑
// 還在,只是對 converted 關著」,而唯一生成點是「舊路徑根本不存在」——後者連新增第二條路都擋得住。
//
// 2026-08-07 第二輪(使用者定案兩句:「小招也改為輔助機型模式,CD 時間 15~30s,從玩家身邊召喚」
// +「大招改為從最近的砲塔或主堡召喚」)⇒ 新增 Ⅳ。要擋的病灶同樣**全部無錯誤訊息**:
//   ・小招留一條瞬發路(某一招沒有被載具接管)⇒ 打起來「這一招特別快」,而稽核照樣全綠;
//   ・兩個槽位各寫一份發射點判斷 ⇒ 之後只改其中一份,另一個槽位悄悄留在舊制;
//   ・小招 CD 帶用手寫階梯 ⇒ 改任一角色的 skill.cd 之後,帶的兩端就不再是 15/30;
//   ・小招一律做成跟隨編隊 ⇒ 三把 emp 小招的效果圈當場從 250m 外搬回腳下(招式身分被刪掉)。
//
// 2026-08-07(自身強化型改跟隨玩家的輔助機隊,見 data.js ULT_SUPPORT / audit_self_ult.mjs Ⅴ):
// 32 台大招自此**全部**載具化,只差形式 —— 點遞送(本檔,23 台)vs 跟隨編隊(9 台)。
// 於是 kami 這個 kind 有了**第二個具名生成點** `_launchUltSupport`:本檔的「唯一生成點」因此改成
// 「**恰兩個具名生成點**,而且都在這兩支裡」——仍然擋得住「隨手再開一條生成路」,
// 而 decoy / hyper 維持恰一個(輔助機一律走 kami 那具小型載具的渲染路徑)。
//
// 跑法:`node tools/audit_ult_carrier.mjs`
//   反向驗證(原則 9;對應條目 MUST 立刻紅字,否則等於沒驗到):
//     `--break-cd`    ultCarrierCd 改回恆等映射(CD 不壓帶)⇒ Ⅰ 紅
//     `--break-guard` 把 heroKamikaze 連同第二個 kami 生成點塞回原文(復辟)⇒ Ⅱ 紅
//     `--break-boom`  _kamiBoom 的 uA 分支失效(引爆走一般爆風)⇒ Ⅲ 紅
//     `--break-origin` 發射點退回「一律主機自己」(大招不從工事召喚)⇒ Ⅳ 紅
// 退出碼:0 = 全綠;1 = 有紅字
import { mkdtempSync, writeFileSync, copyFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { pathToFileURL } from 'node:url';
import { readSrc, grabMethod } from './audit_src.mjs';

const ARGV = new Set(process.argv.slice(2));
const BREAK_ORIGIN = ARGV.has('--break-origin');
const BREAK_CD = ARGV.has('--break-cd');
const BREAK_GUARD = ARGV.has('--break-guard');
const BREAK_BOOM = ARGV.has('--break-boom');

let pass = 0, fail = 0;
const ok = (c, msg) => { c ? pass++ : (fail++, console.error(`  ✗ ${msg}`)); };
const sec = (t) => console.log(`\n=== ${t} ===`);
/** 逐行剝行末註解(單一縫計數:註解裡提到的名字不算一處實作) */
const strip = (s) => s.split('\n').map((l) => l.replace(/\/\/.*$/, '')).join('\n');
const count = (s, re) => (strip(s).match(re) || []).length;

let S = readSrc('server', 'sim.js');
const G = readSrc('public', 'js', 'game.js');
const B = readSrc('server', 'bots.js');
const L = readSrc('tools', 'lanesim.mjs');
const BAL = readSrc('tools', 'balance.mjs');

/** 反向驗證的改壞規則:MUST 真的改到東西(沒改到 = 旗標成了 no-op,反向驗證假綠) */
const bust = (src, re, to, tag) => {
  const next = src.replace(re, to);
  if (next === src) throw new Error(`反向驗證 ${tag}:原文沒有匹配到目標,改壞規則已失效`);
  return next;
};
// --break-guard:把機種絕招「復辟」回原文 —— 一個獨立的 heroKamikaze 入口 + 第二個 kami 生成點。
// 這正是 Ⅱ 要擋的那件事(該機種的 converted 角色同時領大招載具與機種絕招 = 預算領兩份)。
if (BREAK_GUARD) S = bust(S, /\n  \/\/ 機種絕招「飽和攻擊」\(heroKamikaze\)/,
  "\n  heroKamikaze(pid) {\n    const h = this.heroes.get(pid);\n    this._add({ kind: 'kami', side: h.side, pid, kami: true, hp: kamiHp(), armor: 0 });\n  }\n\n  // 機種絕招「飽和攻擊」(heroKamikaze)", '--break-guard');

// ---- 資料層:--break-cd 走「改壞副本再 import」——與真品同一份原文,只動映射那一行 ----
let d;   // data.js 模組(真品或改壞副本)
{
  if (BREAK_CD) {
    const dir = mkdtempSync(join(tmpdir(), 'svs-ultcd-'));
    const src = bust(readSrc('public', 'js', 'data.js'),
      /return band\.lo \+ f \* \(band\.hi - band\.lo\);/,
      'return cd;', '--break-cd');
    writeFileSync(join(dir, 'data.js'), src);
    copyFileSync(join(process.cwd(), 'public', 'js', 'botPolicy.js'), join(dir, 'botPolicy.js'));
    d = await import(pathToFileURL(join(dir, 'data.js')).href);
    process.on('exit', () => { try { rmSync(dir, { recursive: true, force: true }); } catch { /* 清不掉不擋驗證 */ } });
  } else {
    d = await import('../public/js/data.js');
  }
}
const { BattleSim } = await import('../server/sim.js');
if (BREAK_ORIGIN) {
  // 改壞:發射點一律主機自己(= 2026-08-07 之前的舊制)⇒ Ⅳ 的「大招自工事召喚」MUST 立刻紅字
  BattleSim.prototype._launchOrigin = function (h) { return { x: h.x, z: h.z, y: h.y || 0 }; };
}
if (BREAK_BOOM) {
  const orig = BattleSim.prototype._kamiBoom;
  BattleSim.prototype._kamiBoom = function (k) {
    const uA = k.uA; k.uA = null;   // 改壞:uA 分支失效 ⇒ 大招 kami 引爆退回一般爆風
    try { orig.call(this, k); } finally { if (this.ents.has(k.id)) k.uA = uA; }
  };
}

const CHS = Object.keys(d.CHARACTERS);
const conv = CHS.filter((c) => d.ultDelivered(c));

// ============================================================
sec('Ⅰ 轉換判定與 CD 帶(推導不手寫)');
{
  // 判定獨立重算(不呼叫被測的 ultDelivered 的內部;規則 = 使用者定案「區域/指向型全轉」)
  const expect = (c) => {
    const u = d.CHARACTERS[c].ult;
    return u.fx === 'strike' || u.fx === 'emp' || u.fx === 'summon'
      || ((u.fx === 'heal' || u.fx === 'buff') && u.target === 'team');
  };
  ok(CHS.every((c) => d.ultDelivered(c) === expect(c)), '轉換判定 = 區域/指向型(全 32 台逐一重算比對)');
  ok(conv.length === 23, `轉換 23 台(實得 ${conv.length})`);
  const byKind = { drone: 0, robot: 0, morph: 0 };
  for (const c of conv) byKind[d.charKind(c)]++;
  ok(byKind.drone === 8 && byKind.robot === 10 && byKind.morph === 5,
    `逐機種 8/10/5(實得 ${byKind.drone}/${byKind.robot}/${byKind.morph})`);

  // CD 帶:全轉換角色 × 三階全落 [CD_LO, CD_HI];端點貼齊;仿射嚴格保序
  let inBand = true, mono = true;
  const grid = [];
  for (const c of conv) for (let lvl = 1; lvl <= 3; lvl++) {
    const cd = d.heroAbility(c, 'ult', lvl).cd;
    if (cd < d.ULT_CARRIER.CD_LO - 1e-9 || cd > d.ULT_CARRIER.CD_HI + 1e-9) inBand = false;
    grid.push([d.tierVal(d.CHARACTERS[c].ult.cd, lvl), cd]);
  }
  ok(inBand, `轉換大招 CD 全落 [${d.ULT_CARRIER.CD_LO}, ${d.ULT_CARRIER.CD_HI}](23 台 × 3 階)`);
  const band = d.ultCdBand();
  ok(Math.abs(d.ultCarrierCd(band.lo) - d.ULT_CARRIER.CD_LO) < 1e-9
    && Math.abs(d.ultCarrierCd(band.hi) - d.ULT_CARRIER.CD_HI) < 1e-9,
    `仿射端點貼齊:原 cd 帶 [${band.lo}, ${band.hi}] → [${d.ULT_CARRIER.CD_LO}, ${d.ULT_CARRIER.CD_HI}]`);
  grid.sort((a, b) => a[0] - b[0]);
  for (let i = 1; i < grid.length; i++) if (grid[i][1] < grid[i - 1][1] - 1e-9) mono = false;
  ok(mono, 'CD 映射嚴格保序(誰的大招轉得快,改制後仍轉得快)');

  // 未轉換 9 台:heroAbility 輸出逐位元不動(cd = 原階梯、無 carrier、range 原樣)
  ok(CHS.filter((c) => !d.ultDelivered(c)).every((c) => {
    const u = d.CHARACTERS[c].ult;
    const A = d.heroAbility(c, 'ult', 2);
    return !A.carrier && A.cd === d.tierVal(u.cd, 2)
      && A.range === d.tierVal(u.range ?? 0, 2) * d.COMBAT_SCALE;
  }), '未轉換 9 台的 heroAbility 輸出逐位元不動(cd / range / carrier)');

  // 支援型遞送距離 = hyperRange()(同一把尺);strike 保留自己的 range
  ok(conv.every((c) => {
    const u = d.CHARACTERS[c].ult;
    const A = d.heroAbility(c, 'ult', 1);
    return u.range ? A.range === d.tierVal(u.range, 1) * d.COMBAT_SCALE : A.range === d.hyperRange();
  }), '遞送距離:有 range 的照舊、未標的補 hyperRange()(單一把尺)');

  // 分批規則:可分預算分批、不可分狀態單載;ultPartN 總和恆 = total
  ok(d.ultParts('drone', 'heal') === d.SQUAD.KAMI.N && d.ultParts('morph', 'strike') === d.DECOY.BOMB_MAX
    && d.ultParts('robot', 'strike') === 1 && d.ultParts('drone', 'emp') === 1
    && d.ultParts('morph', 'buff') === 1 && d.ultParts('drone', 'summon') === d.SQUAD.KAMI.N,
    'ultParts:strike/heal/summon 依機種分批,emp/buff 恆單載');
  let sumOk = true;
  for (const total of [1, 2, 5, 8, 11]) for (const n of [1, 4, 6]) {
    let s2 = 0;
    for (let i = 0; i < n; i++) s2 += d.ultPartN(total, n, i);
    if (s2 !== total) sumOk = false;
  }
  ok(sumOk, 'ultPartN 平衡分配總和恆 = total(sim / lanesim / 稽核共用,不各自 round)');

  // 最短飛行腿:攔截窗 ≥ 半秒(最慢載具 = 集束轟炸機)
  ok(d.ULT_CARRIER.MIN_LEG / d.DECOY.SPEED >= 0.5,
    `MIN_LEG ${d.ULT_CARRIER.MIN_LEG}m ÷ 最慢載具 ${d.DECOY.SPEED}m/s ≥ 0.5s(「需要飛行時間」)`);
}

// ============================================================
sec('Ⅱ 單一縫(原文)');
{
  // 效果分支只有 _castEffect 一份:heroCast 不再自帶效果迴圈,三個載具端走 _ultArrive
  ok(count(S, /A\.fx === 'strike'/g) >= 1 && count(grabMethod(S, 'heroCast'), /A\.fx === 'strike'/g) === 0,
    'heroCast 不再自帶效果分支(全部住 _castEffect)');
  // 2026-08-07 第二輪:兩個槽位一律載具化 ⇒ heroCast **不再有瞬發結算** —— 效果只從載具端進來。
  // 這一條同時是「小招也改為輔助機型模式」最硬的那道閘:heroCast 裡再冒出一個 _castEffect
  // 就是「某一招又變回瞬發」,而畫面上只表現成「這一招好像特別快」。
  ok(count(S, /_castEffect\(/g) === 3 && count(grabMethod(S, 'heroCast'), /_castEffect\(/g) === 0,
    `_castEffect:1 定義 + 2 消費(_ultArrive 點遞送 / _supSync 輔助機隊;實得 ${count(S, /_castEffect\(/g)})`);
  ok(count(S, /_ultArrive\(/g) === 5,
    `_ultArrive:1 定義 + 4 交付端(kami / hyper / 轟炸機 / 輔助機瞬發型;實得 ${count(S, /_ultArrive\(/g)})`);
  ok(count(S, /_launchUltCarrier\(/g) === 2, '_launchUltCarrier:1 定義 + heroCast 恰一個呼叫點');
  ok(count(S, /_launchUltSupport\(/g) === 2, '_launchUltSupport:1 定義 + heroCast 恰一個呼叫點');

  // 機種絕招三個入口**整組退場**(2026-08-06 第二階段):不是「留著但擋住」,是根本不存在。
  // 註解裡照樣提得到這三個名字(具名退場記錄),所以 MUST 只數執行原文(strip)。
  for (const m of ['heroKamikaze', 'heroDecoy', 'heroHyper']) {
    ok(!new RegExp(`\\n  ${m}\\(`).test(strip(S)), `${m} 已整組退場(MUST NOT 復辟)`);
  }
  // 生成點:decoy / hyper 各恰一處(都在 _launchUltCarrier);kami 恰兩處 —— 點遞送與輔助機隊
  // 各一個具名生成點,MUST NOT 有第三處(第三處 = 有人又開了一條繞過大招結算的側門)
  const luc = strip(grabMethod(S, '_launchUltCarrier'));
  const lus = strip(grabMethod(S, '_launchUltSupport'));
  for (const k of ['decoy', 'hyper']) {
    ok(count(S, new RegExp(`kind: '${k}',`, 'g')) === 1 && new RegExp(`kind: '${k}',`).test(luc),
      `${k} 的唯一生成點 = _launchUltCarrier(載具只剩「大招遞送」這一個身分)`);
  }
  ok(count(S, /kind: 'kami',/g) === 2 && /kind: 'kami',/.test(luc) && /kind: 'kami',/.test(lus),
    'kami 恰兩個具名生成點(_launchUltCarrier 點遞送 / _launchUltSupport 輔助機隊)');
  // 傳輸層:三條機種絕招訊息一併退場(留著就是一條繞過 heroCast 的側門)
  ok(!/'kami'|'decoy'|'hyper'/.test(strip(readSrc('server', 'rooms.js'))),
    'rooms.js 的 kami / decoy / hyper 三條訊息已退場(一律走 t:\'cast\' 單一縫)');

  // 客戶端:長按 = 招式手勢,分流只有 abilHoldSlot 一份(MUST NOT 在輸入端另寫 `aiming ? …`)
  const fha = grabMethod(G, '_fireHoldAbility');
  ok(/_castAbility\(abilHoldSlot\(this\.aiming\)\)/.test(fha),
    'game._fireHoldAbility:長按走 _castAbility(abilHoldSlot(aiming))(與 Q/E 同一個派發縫)');
  ok(!/isDrone|isMorph|ultDelivered/.test(strip(fha)),
    '_fireHoldAbility 不再有機種分派表(機種絕招退場 ⇒ A22 的分派縫一併退場)');
  ok(count(G, /abilHoldSlot\(/g) === 1,
    `分流只有一個消費端(實得 ${count(G, /abilHoldSlot\(/g)});MUST NOT 在觸控鈕/鍵盤各判一次`);
  // HUD:機種絕招三格整組收起、觸控招式鈕鏡射 ult CD
  const hud = grabMethod(G, '_weaponHud');
  ok(!/kami:|decoy:|hyper:/.test(strip(hud)), '_weaponHud 不再有 kami / decoy / hyper 三格');
  // 招式鈕面:長按對 32 台一視同仁 ⇒ CD 鏡射**當下模式那一格**招式(單一來源 = w.skill / w.ult),
  // 載具化與否不影響鈕面(它只改大招自己的結算方式)⇒ HUD 不再需要 ultCarrier 旗標
  const M = readSrc('public', 'js', 'main.js');
  ok(/const abCd = \(w\.aiming \? w\.ult\.cd : w\.skill\.cd\) \|\| 0;/.test(M),
    'main.js 招式鈕面:依 aiming 鏡射小招/大招 CD(單一來源)');
  ok(!/w\.ultCarrier/.test(strip(M)) && !/ultCarrier:/.test(strip(hud)),
    'HUD 不再帶 ultCarrier 旗標(長按語意與載具化無關)');

  // bots:三個機種絕招區塊一併退場(否則每 0.75s 付一格 special 手速去按一顆不存在的鈕)
  ok(!/heroKamikaze|heroDecoy|heroHyper/.test(strip(B)),
    'bots._engage:三個機種絕招區塊已退場(只剩 heroCast 兩條路)');

  // lanesim:converted 分流 + 擊落否定 + 平衡模型 ⑦f 只量仍持有機種絕招的角色
  ok(/ultDelivered\(M\.ch\)\) return castUltCarrier/.test(strip(L)), 'lanesim.castAbil 分流到 castUltCarrier');
  // 擊落當格就丟掉,而且那一行**不得**走到任何交付(2026-08-07 起同一行另記輔助機損失,
  // 所以 MUST 驗語意而不是逐字比對:有 continue、沒有 ultDetonate、全檔沒有殉爆係數)
  {
    const drop = (strip(L).match(/if \(v\.hp <= 0\).*/) || [''])[0];
    ok(/continue;/.test(drop) && !/ultDetonate/.test(drop) && !/DEATH_F/.test(strip(L)),
      'lanesim.stepAbils:載具擊落 = 該份完全否定(當格丟掉、不引爆、不補投;殉爆隨機種絕招退場)');
  }
  ok(/filter\(\(c\) => !ultDelivered\(c\)\)/.test(strip(BAL)), 'balance ⑦f 只平均仍持有機種絕招的角色');

  // 效果取代傷害:四條 uA 引爆/擊落路徑一律不走 _blast
  for (const m of ['_kamiBoom', '_kamiDeathBoom', '_hyperBoom', '_decoyBoom']) {
    const src = strip(grabMethod(S, m));
    const uaBranch = src.slice(src.indexOf('uA'), src.indexOf('return'));
    ok(src.includes('uA') && !/_blast\(/.test(uaBranch), `${m} 的 uA 分支不走 _blast(效果取代傷害)`);
  }
}

// ============================================================
sec('Ⅲ 行為直測(真 BattleSim)');
let mkCfg, run;
{
  mkCfg = () => {
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
  run = (sim, cond, n = 400) => { for (let i = 0; i < n && cond(); i++) sim.tick(0.125); };

  // ① 機甲 strike:飛彈載具、飛行時間、著彈 strike 結算 + ultfx 事件
  {
    const sim = new BattleSim(mkCfg());
    const h = sim.addHero('STEEL', 'a1', 't01');
    h.x = 400; h.z = 0; h.mp = 999; h.abil.ult = 1;
    const dum = sim._add({ kind: 'bunker', side: 'SWARM', x: 500, z: 0, y: 0, hp: 4000 }); delete dum.lane;
    sim.heroCast('a1', 'ult', 500, 0);
    ok(h.hypers?.length === 1 && !!h.hypers[0].uA && h.hypers[0].tid === 0,
      't01 大招 = 極音速飛彈形式(點遞送、不追擊)');
    const cd = h.acd.ult - sim.t;
    ok(cd >= d.ULT_CARRIER.CD_LO && cd <= d.ULT_CARRIER.CD_HI, `施放 CD ${cd.toFixed(1)}s 落在帶內`);
    let ticks = 0, fx = 0;
    const hp0 = dum.hp;
    for (let i = 0; i < 400 && h.hypers.length; i++) {
      sim.tick(0.125); ticks++;
      fx += sim.events.filter((e) => e.e === 'ultfx' && e.fx === 'strike').length;
      sim.events.length = 0;
    }
    ok(!h.hypers.length && ticks * 0.125 >= 1, `有飛行時間(${(ticks * 0.125).toFixed(1)}s)後抵達`);
    ok(fx === 1 && dum.hp < hp0, `著彈 ultfx + strike 傷害(${hp0} → ${Math.round(dum.hp)})`);
  }

  // ② 無人機團隊 heal:4 架分批;擊落一半 = 只補一半;落點敵方單位毫髮無傷(效果取代傷害)
  {
    const sim = new BattleSim(mkCfg());
    const h = sim.addHero('SWARM', 'a2', 's02');
    h.x = 400; h.z = 0; h.mp = 999; h.abil.ult = 1; h.hp = 100;
    // 2026-08-07:大招自最近的我方工事召喚 ⇒ 載具要飛好幾秒才到,期間這具 100 HP 的假人會被
    // 場上的敵方單位打死(舊制窗只有 0.7s 碰不到)。量的是「補多少」不是「活不活得下來」
    // ⇒ 用無敵幀把傷害那一軸移開(治療照常寫 hp,不吃 invUntil)。
    h.invUntil = 1e9;
    const bys = sim._add({ kind: 'bunker', side: 'STEEL', x: 450, z: 0, y: 0, hp: 4000 }); delete bys.lane;
    sim.heroCast('a2', 'ult', 450, 0);
    const ks = [...sim.ents.values()].filter((e) => e.kami);
    ok(ks.length === d.SQUAD.KAMI.N && ks.every((k) => k.uA && k.pt && k.hp === d.kamiHp() && k.armor === 0),
      `heal 大招 = ${d.SQUAD.KAMI.N} 架點遞送 kami(HP = kamiHp() 同一把尺、armor 0)`);
    ks[0].hp = 0; sim._kill(ks[0], null);
    ks[1].hp = 0; sim._kill(ks[1], null);
    run(sim, () => [...sim.ents.values()].some((e) => e.kami));
    const healFull = d.heroAbility('s02', 'ult', 1).heal;
    ok(Math.abs((h.hp - 100) - healFull / 2) < 12, `擊落 2/${d.SQUAD.KAMI.N} ⇒ 只補一半(${(h.hp - 100).toFixed(0)} / ${healFull})`);
    ok(bys.hp === 4000, '效果取代傷害:heal 載具引爆對落點敵方單位零傷害');
  }

  // ③ 變形者 emp:單一轟炸機(不可分狀態單載);抵達落點敵人武器離線
  {
    const sim = new BattleSim(mkCfg());
    const h = sim.addHero('SWARM', 'a3', 's03');
    h.x = 400; h.z = 0; h.mp = 999; h.abil.ult = 1;
    const dum = sim._add({ kind: 'bunker', side: 'STEEL', x: 520, z: 0, y: 0, hp: 4000 }); delete dum.lane;
    sim.heroCast('a3', 'ult', 520, 0);
    const bs = [...sim.ents.values()].filter((e) => e.decoy);
    ok(bs.length === 1 && bs[0].uA && bs[0].uDrops.length === 1 && bs[0].hp === d.decoyHp(),
      'emp 大招 = 單一轟炸機、單份投遞(HP = decoyHp() 同一把尺)');
    run(sim, () => [...sim.ents.values()].some((e) => e.decoy));
    ok((dum.empUntil || 0) > sim.t, '抵達 ⇒ 落點敵人 EMP 武器離線,且無爆風傷害' );
    ok(dum.hp === 4000, '效果取代傷害:emp 載具全程零傷害');
  }

  // ④ 機種絕招整組退場:舊路徑在伺服器上**不存在**(而不是「被守衛擋下」);
  //    未轉換的 9 台大招仍是瞬發 —— 一台載具都不生(它們的補償走 SELF_ULT,見 audit_self_ult)
  {
    const sim = new BattleSim(mkCfg());
    ok(['heroKamikaze', 'heroDecoy', 'heroHyper'].every((m) => sim[m] === undefined),
      '三個機種絕招入口在 BattleSim 上不存在(載具只剩「大招遞送」這一個身分)');
    // 側別只用戰區真的有主堡的那兩個(傭兵角色照樣掛得上去 —— 這裡驗的是機種不是陣營)
    for (const [pid, ch, side] of [['a4', 's12', 'SWARM'], ['a5', 't02', 'STEEL'], ['a6', 'm08', 'STEEL']]) {
      const g = sim.addHero(side, pid, ch);
      g.x = 0; g.z = 0; g.mp = 999; g.abil.ult = 1;
      sim.heroCast(pid, 'ult');
    }
    // 2026-08-07:那 9 台改派**跟隨型輔助機**(仍是 kami 那具小型載具),但 MUST NOT 走點遞送
    // ——沒有落點 `pt`、沒有 decoy/hyper 形式,而且效果要等就位才上線。
    const sup = [...sim.ents.values()].filter((e) => e.supG);
    ok(sup.length === ['s12', 't02', 'm08'].reduce((a, c) => a + d.supportN(c), 0)
      && sup.every((k) => k.kami && !k.pt && k.phase === 'deploy'),
      '未轉換的三機種代表(s12 / t02 / m08)大招改派跟隨型輔助機(不是點遞送)');
    ok(![...sim.ents.values()].some((e) => e.decoy || e.hyper),
      '輔助機一律走 kami 那具小型載具(不生轟炸機 / 飛彈)');
  }

  // ⑤ 最短飛行腿:對自身施放(支援型無點)⇒ 遞送點仍推到 MIN_LEG 之外(需要飛行時間)
  {
    const sim = new BattleSim(mkCfg());
    const h = sim.addHero('SWARM', 'a9', 's02');
    h.x = 400; h.z = 0; h.ry = 0; h.mp = 999; h.abil.ult = 1;
    const org9 = sim._launchOrigin(sim.heroes.get('a9'), 'ult');
    sim.heroCast('a9', 'ult');   // 不帶點(bots 的 _castSupport 同構)
    const ks = [...sim.ents.values()].filter((e) => e.kami);
    // 2026-08-07:最短飛行腿改**自發射點**量 —— 站在自家塔下對腳邊施放也要有攔截窗
    ok(ks.length > 0 && ks.every((k) => Math.hypot(k.pt.x - org9.x, k.pt.z - org9.z) >= d.ULT_CARRIER.MIN_LEG - 1e-6),
      `瞄在腳邊 ⇒ 遞送點自發射點推到 MIN_LEG ${d.ULT_CARRIER.MIN_LEG}m 之外(每一發都有攔截窗)`);
  }

  // ⑥ 未轉換角色走瞬發路徑(s11 自補);**治療量 = 基礎 + SELF_ULT 補償增額**——
  //    2026-08-06 機種絕招退場後這一格不再是「逐位元同舊制」,增額本身由 audit_self_ult 把關,
  //    這裡只釘住「載具路徑沒有把它接管走」與「補償真的經 selfUltBoost 這一個縫」。
  {
    const sim = new BattleSim(mkCfg());
    const h = sim.addHero('SWARM', 'a10', 's11');
    h.mp = 999; h.abil.ult = 1; h.hp = 50;
    sim.heroCast('a10', 'ult');
    const A = d.heroAbility('s11', 'ult', 1);
    const bst = d.selfUltBoost('s11', 1, h.abil);
    ok([...sim.ents.values()].filter((e) => e.supG).length === d.supportN('s11'),
      `s11 大招改派 ${d.supportN('s11')} 架輔助機(2026-08-07;不是點遞送載具)`);
    ok(Math.abs(h.hp - 50) < 0.01, '施放當下不回血 —— 要等輔助機飛完投放腿(每一發都有攔截窗)');
    // 大招自最近的工事召喚 ⇒ 投放腿是實距(不是固定格數);四架各交付 1/4,等整隊到齊
    run(sim, () => [...sim.ents.values()].some((e) => e.supG));
    ok(Math.abs(h.hp - Math.min(h.maxHp, 50 + A.heal + bst.heal)) < 1,
      `s11 自補 = 基礎 ${A.heal} + 補償增額 ${bst.heal.toFixed(1)}(selfUltBoost 單一縫)`);
    ok(A.cd === d.tierVal(d.CHARACTERS.s11.ult.cd, 1), `s11 大招 cd 不動(${A.cd}s)`);
  }
}

// ============================================================
sec('Ⅳ 兩個槽位一律載具化 + 發射點(2026-08-07 使用者定案)');
{
  // ---- Ⅳ-a 分類與旗標:64 招全部載具化,分類只有 abilDelivered 一支 ----
  const expect = (c, slot) => {
    const u = d.CHARACTERS[c][slot];
    return u.fx === 'strike' || u.fx === 'emp' || u.fx === 'summon'
      || ((u.fx === 'heal' || u.fx === 'buff') && u.target === 'team');
  };
  let clsOk = true, formOk = true;
  for (const c of CHS) for (const slot of ['skill', 'ult']) {
    if (d.abilDelivered(c, slot) !== expect(c, slot)) clsOk = false;
    const A = d.heroAbility(c, slot, 1);
    if (A.carrier === A.support) formOk = false;                     // 恰一種形式
    if (A.carrier !== d.abilDelivered(c, slot)) formOk = false;
  }
  ok(clsOk, '分類 = 區域/指向型(32 台 × 兩個槽位逐一重算比對;MUST NOT 手寫名冊)');
  ok(formOk, '每一招恰一種形式(carrier 點遞送 / support 跟隨編隊),旗標與分類同源');
  ok(d.ultDelivered('s03') === d.abilDelivered('s03', 'ult'),
    'ultDelivered 只是 abilDelivered 的薄殼(不是第二份規則)');
  // 「不可以一律做成跟隨編隊」:有遞送距離的小招標的是幾百公尺外的一片區域
  const rangedSk = CHS.filter((c) => (d.CHARACTERS[c].skill.range ?? 0) > 0);
  ok(rangedSk.length > 0 && rangedSk.every((c) => d.heroAbility(c, 'skill', 1).carrier
    && d.heroAbility(c, 'skill', 1).range > 0),
    `有遞送距離的小招(${rangedSk.join(' ')})走**點遞送**並保留 range(MUST NOT 收回腳下)`);
  ok(CHS.every((c) => {
    const u = d.CHARACTERS[c].skill;
    return d.heroAbility(c, 'skill', 1).range === d.tierVal(u.range ?? 0, 1) * d.COMBAT_SCALE;
  }), '小招的遞送距離逐位元 = 原資料(未標 range 的不補 hyperRange —— 那是大招的戰略遞送)');

  // ---- Ⅳ-b 小招 CD 帶 [15, 30]:推導不手寫、嚴格保序 ----
  const SB = d.abilCdRange('skill');
  ok(SB.lo === 15 && SB.hi === 30, `小招 CD 帶 = [${SB.lo}, ${SB.hi}](使用者定案「CD時間15~30s」)`);
  let skIn = true;
  const skGrid = [];
  for (const c of CHS) for (let lvl = 1; lvl <= 3; lvl++) {
    const cd = d.heroAbility(c, 'skill', lvl).cd;
    if (cd < SB.lo - 1e-9 || cd > SB.hi + 1e-9) skIn = false;
    skGrid.push([d.tierVal(d.CHARACTERS[c].skill.cd, lvl), cd]);
  }
  ok(skIn, `32 台 × 3 階小招 CD 全落 [${SB.lo}, ${SB.hi}]`);
  const sband = d.abilCdBand('skill');
  ok(Math.abs(d.abilCarrierCd('skill', sband.lo) - SB.lo) < 1e-9
    && Math.abs(d.abilCarrierCd('skill', sband.hi) - SB.hi) < 1e-9,
    `仿射端點貼齊:原小招 cd 帶 [${sband.lo}, ${sband.hi}] → [${SB.lo}, ${SB.hi}]`);
  skGrid.sort((a, b) => a[0] - b[0]);
  ok(skGrid.every((g2, i) => i === 0 || g2[1] >= skGrid[i - 1][1] - 1e-9),
    '小招 CD 映射嚴格保序(排名不變的保證)');
  ok(d.abilCdRange('skill').hi <= d.abilCdRange('ult').lo,
    '兩個槽位各自一條映射且不重疊(小招 [15,30] / 大招 [30,60])');
  ok(CHS.filter((c) => !d.ultDelivered(c))
    .every((c) => d.heroAbility(c, 'ult', 2).cd === d.tierVal(d.CHARACTERS[c].ult.cd, 2)),
    '自身型大招的 cd 仍逐位元不壓帶(補償 selfUltEq 正比於 cd)');

  // ---- Ⅳ-c 發射點:單一縫 + 原文沒有第二份 slot 判斷 ----
  ok(d.abilOrigin('skill') === 'self' && d.abilOrigin('ult') === 'fort',
    'abilOrigin:小招 = 主機身邊 / 大招 = 最近的砲塔或主堡');
  ok(count(S, /_launchOrigin\(/g) === 2, '_launchOrigin:1 定義 + heroCast 恰一個呼叫點(發射點只判一次)');
  ok(count(S, /abilOrigin\(/g) === 2,
    `abilOrigin 在 sim 恰兩個消費端(_launchOrigin / _launchUltSupport;實得 ${count(S, /abilOrigin\(/g)})`);
  ok(!/slot === 'ult'/.test(strip(grabMethod(S, '_launchUltCarrier')) + strip(grabMethod(S, '_launchUltSupport'))),
    '兩支發射縫都不自己判 slot(分流只有 abilOrigin 一份)');
  ok(/UNITS\.tower\.range \* GAME\.TOWER_SEP_F \/ 2/.test(readSrc('public', 'js', 'data.js')),
    'ultLaunchLegM 推導不手寫(= 半個塔距 = 兵線接觸線到自家前線塔的距離)');
  ok(Math.abs(d.supportLegS('ult') - d.ultLaunchLegM() / d.supportSpeed()) < 1e-9
    && Math.abs(d.supportLegS('skill') - d.ULT_CARRIER.MIN_LEG / d.supportSpeed()) < 1e-9,
    `投放腿逐槽位推導(小招 ${d.supportLegS('skill').toFixed(2)}s / 大招 ${d.supportLegS('ult').toFixed(2)}s)`);
  ok(/overflySurviveHp\(hyperFlightS\(hyperMaxArcM\(\)\)\)/.test(readSrc('public', 'js', 'data.js')),
    '飛彈 HP 吃「代表發射腿 + 遞送距離」的最長航程(工事召喚讓它多飛一段,曝險窗跟著漂)');

  // ---- Ⅳ-d 行為直測:大招自工事出發、小招自主機身邊出發 ----
  for (const [ch, side, kindWord] of [['t01', 'STEEL', '飛彈'], ['s03', 'SWARM', '轟炸機'], ['s08', 'SWARM', '自殺機']]) {
    const sim = new BattleSim(mkCfg());
    const h = sim.addHero(side, `o_${ch}`, ch);
    h.x = 300; h.z = 120; h.mp = 999; h.abil.ult = 1; h.abil.skill = 1;
    const fort = sim._launchOrigin(h, 'ult');
    const dFar = Math.hypot(fort.x - h.x, fort.z - h.z);
    sim.heroCast(`o_${ch}`, 'ult', h.x + 60, h.z);
    const v = [...sim.ents.values()].filter((e) => e.kami || e.decoy || e.hyper)[0];
    ok(!!v && dFar > d.ULT_CARRIER.MIN_LEG
      && Math.hypot(v.x - fort.x, v.z - fort.z) < Math.hypot(v.x - h.x, v.z - h.z),
      `${ch} 大招載具(${kindWord})自最近的我方工事出發(工事距機體 ${dFar.toFixed(0)}m)`);
  }
  {
    const sim = new BattleSim(mkCfg());
    const h = sim.addHero('SWARM', 'o_sk', 's03');
    h.x = 300; h.z = 120; h.mp = 999; h.abil.skill = 1;
    const fort = sim._launchOrigin(h, 'ult');
    sim.heroCast('o_sk', 'skill', h.x + 60, h.z);
    const v = [...sim.ents.values()].filter((e) => e.decoy)[0];
    ok(!!v && Math.hypot(v.x - h.x, v.z - h.z) < Math.hypot(v.x - fort.x, v.z - fort.z)
      && Math.hypot(v.x - h.x, v.z - h.z) < d.ULT_CARRIER.MIN_LEG,
      's03 小招載具生在主機身邊(不是工事)—— 使用者定案「從玩家身邊召喚」');
  }
  {
    // 小招也走載具:效果 MUST 等抵達才施放,而且打光輔助機就整份下線
    const sim = new BattleSim(mkCfg());
    const h = sim.addHero('SWARM', 'o_bf', 's05');   // 自身 buff 小招 ⇒ 跟隨編隊
    h.x = 300; h.z = 120; h.mp = 999; h.abil.skill = 1;
    sim.heroCast('o_bf', 'skill');
    const sup = [...sim.ents.values()].filter((e) => e.supG);
    ok(sup.length === d.supportN('s05', 'skill')
      && sup.every((k) => k.hp === d.supportHp('s05', 1, 'skill') && k.armor === 0),
      `s05 小招派 ${sup.length} 架輔助機、每架 HP ${d.supportHp('s05', 1, 'skill')}(armor 0;耐久同一把尺)`);
    ok(Math.abs(sim._buffMul(h, 'dmg') - 1) < 1e-9, '小招施放當下加成未上線 —— 輔助機還在投放腿上');
    run(sim, () => Math.abs(sim._buffMul(h, 'dmg') - 1) < 1e-9, 200);
    ok(Math.abs(sim._buffMul(h, 'dmg') - d.heroAbility('s05', 'skill', 1).mul.dmg) < 1e-6,
      '小招輔助機就位 ⇒ 效果值逐位元 = 招式原值(全員在線)');
    for (const k of [...sim.ents.values()].filter((e) => e.supG)) { k.hp = 0; sim._kill(k, null); }
    ok(Math.abs(sim._buffMul(h, 'dmg') - 1) < 1e-9, '小招輔助機被打光 ⇒ 加成整份下線');
  }
  {
    // 兩個槽位的載具同時在空:名冊 MUST 是陣列(單槽位會把第一發變成殭屍實體)
    const sim = new BattleSim(mkCfg());
    const h = sim.addHero('SWARM', 'o_two', 's03');   // 小招 emp + 大招 emp,同為轟炸機形式
    h.x = 300; h.z = 120; h.mp = 999; h.abil.skill = 1; h.abil.ult = 1;
    sim.heroCast('o_two', 'skill', h.x + 60, h.z);
    sim.heroCast('o_two', 'ult', h.x + 60, h.z);
    ok(h.sq?.decoys?.length === 2 && [...sim.ents.values()].filter((e) => e.decoy).length === 2,
      '同一名玩家的小招與大招轟炸機可同時在空(名冊是陣列,不是單槽位)');
    run(sim, () => [...sim.ents.values()].some((e) => e.decoy), 600);
    ok(![...sim.ents.values()].some((e) => e.decoy) && h.sq.decoys.length === 0,
      '兩架都飛完任務被回收(單槽位名冊會留下一架永不落地的殭屍)');
  }
}

// ============================================================
console.log(`\n${fail ? '❌' : '✅'} 大招載具遞送稽核:${pass} 綠 / ${fail} 紅`
  + (BREAK_CD || BREAK_GUARD || BREAK_BOOM || BREAK_ORIGIN ? '(反向驗證模式:紅字 = 稽核有牙)' : ''));
process.exit(fail ? 1 : 0);
