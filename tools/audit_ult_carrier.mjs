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
//   ・守衛漏一個機種 ⇒ 該機種 converted 角色同時領兩份載具(大招 + 機種絕招);
//   ・「效果取代傷害」漏一條引爆路徑 ⇒ 補血機炸人(預算雙重領,畫面上只是「傷害偏高」)。
//
// 跑法:`node tools/audit_ult_carrier.mjs`
//   反向驗證(原則 9;對應條目 MUST 立刻紅字,否則等於沒驗到):
//     `--break-cd`    ultCarrierCd 改回恆等映射(CD 不壓帶)⇒ Ⅰ 紅
//     `--break-guard` 拿掉 heroKamikaze 的 ultDelivered 守衛(原文層)⇒ Ⅱ 紅
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
if (BREAK_GUARD) S = bust(S, /\n    if \(ultDelivered\(h\.ch\)\) return;\n    const sq = h\.sq;\n    if \(this\.t < \(sq\.kamiCd/, '\n    const sq = h.sq;\n    if (this.t < (sq.kamiCd', '--break-guard');

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

  // 三個機種絕招入口都有 ultDelivered 守衛(合併為一招:舊路徑對 converted 關閉)
  for (const m of ['heroKamikaze', 'heroDecoy', 'heroHyper']) {
    ok(/ultDelivered\(h\.ch\)/.test(grabMethod(S, m)), `${m} 有 ultDelivered 守衛`);
  }

  // 客戶端:長按與 E 同縫(_fireHoldAbility 的 converted 分支走 _castAbility('ult'))
  const fha = grabMethod(G, '_fireHoldAbility');
  ok(/ultDelivered\(this\.ch\)/.test(fha) && /_castAbility\('ult'\)/.test(fha),
    'game._fireHoldAbility:converted 分支走 _castAbility(\'ult\')(單一派發縫)');
  ok(fha.indexOf('ultDelivered') < fha.indexOf('isDrone'), '轉換分支排在機種分派**之前**');
  // HUD:機種絕招格對 converted 收起、觸控絕招鈕鏡射 ult CD
  const hud = grabMethod(G, '_weaponHud');
  ok(count(hud, /ultDelivered\(this\.ch\)/g) >= 4, '_weaponHud:kami/decoy/hyper 三格 + ultCarrier 欄都吃 ultDelivered');
  ok(/w\.ultCarrier \? \(w\.ult\.cd \|\| 0\)/.test(readSrc('public', 'js', 'main.js')),
    'main.js 觸控絕招鈕面:carrier 角色鏡射 ult 的 CD(單一來源)');

  // bots:三個機種絕招區塊有守衛(不浪費 special 手速去按必拒的鈕)
  ok(count(B, /h\.kind === 'drone' && !ultDelivered\(h\.ch\)/g) === 1
    && count(B, /h\.kind === 'morph' && !ultDelivered\(h\.ch\)/g) === 1
    && count(B, /h\.kind === 'robot' && !ultDelivered\(h\.ch\)/g) === 1,
    'bots._engage:三個機種絕招區塊都有 !ultDelivered 守衛');

  // lanesim:converted 分流 + 擊落否定 + 平衡模型 ⑦f 只量仍持有機種絕招的角色
  ok(/ultDelivered\(M\.ch\)\) return castUltCarrier/.test(strip(L)), 'lanesim.castAbil 分流到 castUltCarrier');
  ok(/if \(v\.uA\) continue;/.test(strip(L)), 'lanesim.stepAbils:大招載具擊落 = 完全否定(無殉爆/無補投)');
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

  // ④ 守衛:converted 三機種舊路徑全擋;unconverted 照常
  {
    const sim = new BattleSim(mkCfg());
    const g1 = sim.addHero('SWARM', 'a4', 's02'); g1.x = 0; g1.z = 0;
    sim.heroKamikaze('a4');
    ok(![...sim.ents.values()].some((e) => e.kami), 'converted 無人機 heroKamikaze 被擋(合併為一招)');
    const g2 = sim.addHero('SWARM', 'a5', 's03'); g2.x = 0; g2.z = 0;
    sim.heroDecoy('a5');
    ok(!sim.squads.get('a5').decoy, 'converted 變形者 heroDecoy 被擋');
    const g3 = sim.addHero('STEEL', 'a6', 't01'); g3.x = 0; g3.z = 0; g3.hyperCd = 0;
    sim.heroHyper('a6');
    ok(!g3.hyper, 'converted 機甲 heroHyper 被擋');
    const g4 = sim.addHero('STEEL', 'a7', 't02'); g4.x = 10; g4.z = 0; g4.hyperCd = 0;
    sim.heroHyper('a7');
    ok(!!g4.hyper && !g4.hyper.uA, 'unconverted 機甲(t02)機種絕招照常(純傷害戰鬥部)');
    const g5 = sim.addHero('SWARM', 'a8', 's12'); g5.x = 20; g5.z = 0;
    sim.heroKamikaze('a8');
    ok([...sim.ents.values()].some((e) => e.kami && !e.uA), 'unconverted 無人機(s12)機種絕招照常');
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

  // ⑥ 未轉換角色瞬發路徑逐位元不變(s11 自補;抽縫是重構不是改行為)
  {
    const sim = new BattleSim(mkCfg());
    const h = sim.addHero('SWARM', 'a10', 's11');
    h.mp = 999; h.abil.ult = 1; h.hp = 50;
    sim.heroCast('a10', 'ult');
    const A = d.heroAbility('s11', 'ult', 1);
    ok(Math.abs(h.hp - Math.min(h.maxHp, 50 + A.heal)) < 0.01, 's11 瞬發自補逐位元同舊制');
    ok(A.cd === d.tierVal(d.CHARACTERS.s11.ult.cd, 1), `s11 大招 cd 不動(${A.cd}s)`);
  }
}

// ============================================================
console.log(`\n${fail ? '❌' : '✅'} 大招載具遞送稽核:${pass} 綠 / ${fail} 紅`
  + (BREAK_CD || BREAK_GUARD || BREAK_BOOM ? '(反向驗證模式:紅字 = 稽核有牙)' : ''));
process.exit(fail ? 1 : 0);
