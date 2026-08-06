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
// 跑法:`node tools/audit_ult_carrier.mjs`
//   反向驗證(原則 9;對應條目 MUST 立刻紅字,否則等於沒驗到):
//     `--break-cd`    ultCarrierCd 改回恆等映射(CD 不壓帶)⇒ Ⅰ 紅
//     `--break-guard` 把 heroKamikaze 連同第二個 kami 生成點塞回原文(復辟)⇒ Ⅱ 紅
//     `--break-boom`  _kamiBoom 的 uA 分支失效(引爆走一般爆風)⇒ Ⅲ 紅
// 退出碼:0 = 全綠;1 = 有紅字
import { mkdtempSync, writeFileSync, copyFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { pathToFileURL } from 'node:url';
import { readSrc, grabMethod } from './audit_src.mjs';

const ARGV = new Set(process.argv.slice(2));
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
      /return ULT_CARRIER\.CD_LO \+ f \* \(ULT_CARRIER\.CD_HI - ULT_CARRIER\.CD_LO\);/,
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
  ok(count(S, /_castEffect\(/g) === 3, `_castEffect:1 定義 + 2 消費(heroCast 瞬發 / _ultArrive 載具端;實得 ${count(S, /_castEffect\(/g)})`);
  ok(count(S, /_ultArrive\(/g) === 4, `_ultArrive:1 定義 + 3 引爆端(kami / hyper / 轟炸機;實得 ${count(S, /_ultArrive\(/g)})`);
  ok(count(S, /_launchUltCarrier\(/g) === 2, '_launchUltCarrier:1 定義 + heroCast 恰一個呼叫點');

  // 機種絕招三個入口**整組退場**(2026-08-06 第二階段):不是「留著但擋住」,是根本不存在。
  // 註解裡照樣提得到這三個名字(具名退場記錄),所以 MUST 只數執行原文(strip)。
  for (const m of ['heroKamikaze', 'heroDecoy', 'heroHyper']) {
    ok(!new RegExp(`\\n  ${m}\\(`).test(strip(S)), `${m} 已整組退場(MUST NOT 復辟)`);
  }
  // 唯一生成點:三種載具的 kind 各只出現一次,而且都在 _launchUltCarrier 裡
  const luc = strip(grabMethod(S, '_launchUltCarrier'));
  for (const k of ['kami', 'decoy', 'hyper']) {
    ok(count(S, new RegExp(`kind: '${k}',`, 'g')) === 1 && new RegExp(`kind: '${k}',`).test(luc),
      `${k} 的唯一生成點 = _launchUltCarrier(載具只剩「大招遞送」這一個身分)`);
  }
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
  ok(/if \(v\.hp <= 0\) continue;/.test(strip(L)) && !/DEATH_F/.test(strip(L)),
    'lanesim.stepAbils:載具擊落 = 該份完全否定(機種絕招時代的殉爆/補投已隨那三招退場)');
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
  const run = (sim, cond, n = 400) => { for (let i = 0; i < n && cond(); i++) sim.tick(0.125); };

  // ① 機甲 strike:飛彈載具、飛行時間、著彈 strike 結算 + ultfx 事件
  {
    const sim = new BattleSim(mkCfg());
    const h = sim.addHero('STEEL', 'a1', 't01');
    h.x = 400; h.z = 0; h.mp = 999; h.abil.ult = 1;
    const dum = sim._add({ kind: 'bunker', side: 'SWARM', x: 500, z: 0, y: 0, hp: 4000 }); delete dum.lane;
    sim.heroCast('a1', 'ult', 500, 0);
    ok(!!h.hyper && !!h.hyper.uA && h.hyper.tid === 0, 't01 大招 = 極音速飛彈形式(點遞送、不追擊)');
    const cd = h.acd.ult - sim.t;
    ok(cd >= d.ULT_CARRIER.CD_LO && cd <= d.ULT_CARRIER.CD_HI, `施放 CD ${cd.toFixed(1)}s 落在帶內`);
    let ticks = 0, fx = 0;
    const hp0 = dum.hp;
    for (let i = 0; i < 400 && h.hyper; i++) {
      sim.tick(0.125); ticks++;
      fx += sim.events.filter((e) => e.e === 'ultfx' && e.fx === 'strike').length;
      sim.events.length = 0;
    }
    ok(!h.hyper && ticks * 0.125 >= 1, `有飛行時間(${(ticks * 0.125).toFixed(1)}s)後抵達`);
    ok(fx === 1 && dum.hp < hp0, `著彈 ultfx + strike 傷害(${hp0} → ${Math.round(dum.hp)})`);
  }

  // ② 無人機團隊 heal:4 架分批;擊落一半 = 只補一半;落點敵方單位毫髮無傷(效果取代傷害)
  {
    const sim = new BattleSim(mkCfg());
    const h = sim.addHero('SWARM', 'a2', 's02');
    h.x = 400; h.z = 0; h.mp = 999; h.abil.ult = 1; h.hp = 100;
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
    ok(![...sim.ents.values()].some((e) => e.kami || e.decoy || e.hyper),
      '未轉換的三機種代表(s12 / t02 / m08)大招一律瞬發,不生任何載具');
  }

  // ⑤ 最短飛行腿:對自身施放(支援型無點)⇒ 遞送點仍推到 MIN_LEG 之外(需要飛行時間)
  {
    const sim = new BattleSim(mkCfg());
    const h = sim.addHero('SWARM', 'a9', 's02');
    h.x = 400; h.z = 0; h.ry = 0; h.mp = 999; h.abil.ult = 1;
    sim.heroCast('a9', 'ult');   // 不帶點(bots 的 _castSupport 同構)
    const ks = [...sim.ents.values()].filter((e) => e.kami);
    ok(ks.length > 0 && ks.every((k) => Math.hypot(k.pt.x - 400, k.pt.z - 0) >= d.ULT_CARRIER.MIN_LEG - 1e-6),
      `瞄在腳邊 ⇒ 遞送點推到 MIN_LEG ${d.ULT_CARRIER.MIN_LEG}m 之外(每一發都有攔截窗)`);
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
    ok(![...sim.ents.values()].some((e) => e.uA), 's11 大招不生載具(瞬發路徑)');
    ok(Math.abs(h.hp - Math.min(h.maxHp, 50 + A.heal + bst.heal)) < 0.01,
      `s11 瞬發自補 = 基礎 ${A.heal} + 補償增額 ${bst.heal.toFixed(1)}(selfUltBoost 單一縫)`);
    ok(A.cd === d.tierVal(d.CHARACTERS.s11.ult.cd, 1), `s11 大招 cd 不動(${A.cd}s)`);
  }
}

// ============================================================
console.log(`\n${fail ? '❌' : '✅'} 大招載具遞送稽核:${pass} 綠 / ${fail} 紅`
  + (BREAK_CD || BREAK_GUARD || BREAK_BOOM ? '(反向驗證模式:紅字 = 稽核有牙)' : ''));
process.exit(fail ? 1 : 0);
