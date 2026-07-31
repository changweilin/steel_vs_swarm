// 直線貫穿(aoeClass 'line')命中判定稽核 —— 離線直測 sim._lanceHits / heroLance。
//
// 起因(2026-07-28 使用者回報):「直線攻擊重武器常常打不到單位,特別是建築」。兩處舊病:
//   ① **目標被當成點**:圓柱只比對單位中心座標,半徑 7m 的砲塔 / 20m 的主堡打在牆面上
//      離中心 5~18m ⇒ 明明命中卻整發落空。修正 = 半徑取 lanceR(def) + hitR(t)(data.js 單一縫)。
//   ② **射線被目標自己截斷**:客戶端回報的 len 止於彈道終點,而彈道終點就是目標的**近側表面**
//      (beam 的準星射線尤其明顯)⇒ 目標中心落在線段之外,s > maxS 判成落空。
//      修正 = 軸距量到「線段上最近點」而非要求中心落在線段內(客戶端另讓貫穿光束不停在單位上)。
// 2026-08-01(機甲改招為極音速飛彈,舊巨砲整組移除):貫穿粗細**不再有任何情境倍率** ——
//       `lanceR(def)` 是唯一半徑來源,兩端(伺服器 _lanceHits / 演出 _lanceVisual)吃同一支。
//       舊 `lanceR(def, barrage)` 的第二參數 MUST NOT 復辟(那是「看到的比打到的粗」的來源)。
//
// 用法:node tools/audit_lance_hit.mjs

import { readFileSync } from 'node:fs';
import { BattleSim } from '../server/sim.js';
import {
  UNITS, CHARACTERS, heroWeapon, aoeClass, lanceR, LANCE, MAPGEO, LOS, hitR, hitH, TARGET_R, dmgFalloff,
  offAxisFalloff, AOE_EDGE,
} from '../public/js/data.js';

let failed = false;
const log = (...a) => console.log(...a);
const assert = (cond, msg) => {
  if (cond) log(`  ✅ ${msg}`);
  else { failed = true; log(`  ❌ ${msg}`); }
};

// 合成戰場設定(同 test/e2e.mjs 的 fakeBattleConfig;單線、台北 101 附近)
function fakeBattleConfig(L = 1) {
  const A = [25.0330, 121.5654];
  const D = 1600 * L, R = 6371000;
  const realD = D * MAPGEO.REAL_SCALE;
  const dLat = realD / R * 180 / Math.PI;
  const B = [A[0] + dLat, A[1]];
  const mid = [(A[0] + B[0]) / 2, (A[1] + B[1]) / 2];
  const pts = [];
  for (let t = 0; t <= 1.001; t += 0.05) {
    const u = 1 - t;
    pts.push([u * u * A[0] + 2 * u * t * mid[0] + t * t * B[0], u * u * A[1] + 2 * u * t * mid[1] + t * t * B[1]]);
  }
  const sizeM = D / (0.85 * Math.SQRT2);
  return {
    center: { lat: mid[0], lng: mid[1] },
    bases: { SWARM: A, STEEL: B },
    lanes: [pts],
    sizeM, diagM: sizeM * Math.SQRT2, distM: D,
    geoScaleVer: MAPGEO.GEO_SCALE_VER,
    maxOverlap: 0.05, synthetic: true, placeName: '貫穿稽核戰區',
    env: { season: 'summer', time: 'day', weather: 'clear' },
  };
}

/** 乾淨的測試沙盤:清掉野營/小兵/塔,只留下我們自己放的目標(避免流彈干擾斷言) */
function sandbox() {
  const sim = new BattleSim(fakeBattleConfig(1));
  for (const e of [...sim.ents.values()]) sim.ents.delete(e.id);
  sim.camps = [];
  sim.mines = [];
  sim.missiles = [];
  // 迷霧旁路:本稽核只驗幾何,視野/LOS 另有既有測試把關
  sim.visionUntil = { SWARM: 1e9, STEEL: 1e9 };
  return sim;
}

/** 找一名使用指定 line 類重武器的角色(beam / rail / gun) */
function charWithHeavy(type) {
  for (const [id, c] of Object.entries(CHARACTERS)) {
    const def = heroWeapon(id, 'heavy', 1, false);
    if (def && def.type === type && aoeClass(def) === 'line') return { id, def, kind: c.kind };
  }
  return null;
}

log('— 直線貫穿命中判定(sim._lanceHits)—');

// ---------- ① 分類與半徑基本盤 ----------
{
  const types = ['beam', 'rail', 'gun'];
  let ok = true;
  for (const ty of types) if (!charWithHeavy(ty)) ok = false;
  assert(ok, 'beam / rail / gun 三種 line 類重武器都有角色使用(測試素材齊備)');
  assert(LANCE.R.beam > LANCE.R.rail && LANCE.R.rail > LANCE.R.gun,
    `圓柱粗細階梯 beam > rail > gun(${LANCE.R.beam} / ${LANCE.R.rail} / ${LANCE.R.gun} m)`);
  assert(LANCE.BARRAGE_F === undefined && lanceR({ type: 'beam' }, true) === LANCE.R.beam,
    'lanceR 不再吃任何情境倍率(舊 LANCE.BARRAGE_F 已隨巨砲移除,第二參數 MUST NOT 復辟)');
  assert(lanceR({ type: 'nosuch' }) === LANCE.R.gun, '未知武器型別退回最細的 gun 半徑');
}

// ---------- ② 水平量體:hitR 與 hitH 同一組單位 ----------
{
  assert(hitR({ kind: 'tower' }) === TARGET_R.tower && hitH({ kind: 'tower' }) === 26,
    `砲塔量體 = 半徑 ${TARGET_R.tower}m × 高 26m(hitR / hitH 同一把尺)`);
  const heroR = hitR({ hero: true, kind: 'robot', ch: 's01' });
  assert(heroR > 0 && heroR < hitH({ hero: true, kind: 'robot', ch: 's01' }),
    `英雄水平半徑由機體實高推導(robot ${heroR.toFixed(2)}m,不手寫)`);
  assert(hitR({ kind: 'base', side: 'SWARM' }) === TARGET_R['base:SWARM'],
    '主堡水平半徑依陣營查表(與 hitH 同構)');
  assert(hitR({ kind: '不存在的機種' }) < 1, '未知機種退回人員級量體(寧可小,不無端放大)');
}

// ---------- ③ 建築:打在牆面上算命中(舊病 ①)----------
{
  const sim = sandbox();
  const w = charWithHeavy('gun') || charWithHeavy('rail') || charWithHeavy('beam');
  const h = sim.addHero('SWARM', 'p_g', w.id);
  h.x = 0; h.z = 0; h.y = 0;
  const R = lanceR(w.def);
  const tower = sim._add({ kind: 'tower', side: 'STEEL', x: 0, z: 200, y: 0, hp: 9999, m: 9999 });
  const oy = LOS.EYE_M;
  // 正對塔心:兩制皆命中(迴歸基準)
  const center = sim._lanceHits(h, w.def, 0, 0, oy, 0, 1, 0, 400);
  assert(center.some((k) => k.t === tower), '正對塔心的射線命中砲塔(迴歸)');
  // 偏離塔心 5m:仍在 7m 半徑的塔身上 —— 舊制(純點判定,R < 5)整發落空
  const off = TARGET_R.tower - 2;
  assert(off > R, `測試前提:偏移 ${off}m 已超出純圓柱半徑 ${R}m(舊制必落空)`);
  tower.x = off;
  const wall = sim._lanceHits(h, w.def, 0, 0, oy, 0, 1, 0, 400);
  assert(wall.some((k) => k.t === tower), `打在塔身側面(離塔心 ${off}m)判定命中`);
  // 塔身之外:MUST NOT 命中(不是無限放大)
  tower.x = R + TARGET_R.tower + 3;
  assert(!sim._lanceHits(h, w.def, 0, 0, oy, 0, 1, 0, 400).some((k) => k.t === tower),
    '完全打偏(超出 圓柱半徑 + 塔身半徑)判定落空');
}

// ---------- ④ 射線止於目標近側表面(舊病 ②)----------
{
  const sim = sandbox();
  const w = charWithHeavy('beam') || charWithHeavy('rail') || charWithHeavy('gun');
  const h = sim.addHero('SWARM', 'p_b', w.id);
  h.x = 0; h.z = 0; h.y = 0;
  const oy = LOS.EYE_M;
  const tower = sim._add({ kind: 'tower', side: 'STEEL', x: 0, z: 200, y: 0, hp: 9999, m: 9999 });
  // 準星射線打在塔的**近側牆面**:len 只有 200 − 塔半徑 ⇒ 塔心在線段之外
  const len = 200 - TARGET_R.tower;
  assert(sim._lanceHits(h, w.def, 0, 0, oy, 0, 1, 0, len).some((k) => k.t === tower),
    '射線止於目標近側表面(len < 到塔心距離)仍判定命中');
  // 射線遠遠不到:MUST NOT 命中
  assert(!sim._lanceHits(h, w.def, 0, 0, oy, 0, 1, 0, 60).some((k) => k.t === tower),
    '射線長度不足(離目標 130m 就終止)判定落空');
  // 反向:目標在射手背後 MUST NOT 命中
  assert(!sim._lanceHits(h, w.def, 0, 0, oy, 0, -1, 0, 400).some((k) => k.t === tower),
    '目標在射線反方向判定落空(s < 0 不迴繞)');
}

// ---------- ⑤ 貫穿序與衰減:首個全額、之後 DECAY^i ----------
{
  const sim = sandbox();
  const w = charWithHeavy('rail') || charWithHeavy('gun') || charWithHeavy('beam');
  const h = sim.addHero('SWARM', 'p_r', w.id);
  h.x = 0; h.z = 0; h.y = 0;
  const oy = LOS.EYE_M;
  const ts = [60, 90, 120].map((z) => sim._add({ kind: 'soldier', side: 'STEEL', x: 0, z, y: 0, hp: 99999, m: 99999 }));
  const hits = sim._lanceHits(h, w.def, 0, 0, oy, 0, 1, 0, 400);
  assert(hits.length === 3 && hits[0].t === ts[0] && hits[2].t === ts[2],
    '沿射線的目標由近至遠排序(貫穿序 = 傷害衰減序)');
  const before = ts.map((t) => t.hp);
  h.aiming = true;             // 狙擊型 line 武器帶 needAim
  h.mp = h.maxMp = 9999;       // 電力門檻(_gateFire)不是本節的受測對象
  sim.t = 100;                 // 射速閘以「距上次開火」判定,t=0 會被 fireAt 預設值擋掉
  sim._rollCrit = (b, def, dmg) => dmg;   // 爆擊是機率事件,本節只驗貫穿衰減
  sim.heroLance('p_r', [0, 0, oy], [0, 1, 0], 400);
  const dmg = ts.map((t, i) => before[i] - t.hp);
  assert(dmg[0] > 0 && dmg[1] > 0 && dmg[2] > 0, 'heroLance 一發同時打到三名沿線目標');
  // 期望比值 = DECAY × 兩段距離的物理衰減比(距離衰減與貫穿衰減是兩條獨立的乘數)
  const exp1 = LANCE.DECAY * dmgFalloff(w.def, 90) / dmgFalloff(w.def, 60);
  const exp2 = LANCE.DECAY * dmgFalloff(w.def, 120) / dmgFalloff(w.def, 90);
  const r1 = dmg[1] / dmg[0], r2 = dmg[2] / dmg[1];
  assert(Math.abs(r1 - exp1) < 0.02 && Math.abs(r2 - exp2) < 0.02,
    `貫穿衰減逐個 ×${LANCE.DECAY}(實測 ${r1.toFixed(3)}/${r2.toFixed(3)},期望 ${exp1.toFixed(3)}/${exp2.toFixed(3)})`);
  assert(hits.length <= LANCE.MAX, `單發貫穿數不超過 LANCE.MAX(${LANCE.MAX})`);
}

// ---------- ⑤b 偏心傷害遞減:正中滿額、貼邊 AOE_EDGE 保底(2026-07-29 使用者需求)----------
{
  const sim = sandbox();
  const w = charWithHeavy('rail') || charWithHeavy('gun') || charWithHeavy('beam');
  const h = sim.addHero('SWARM', 'p_o', w.id);
  const oy = LOS.EYE_M;
  const t = sim._add({ kind: 'soldier', side: 'STEEL', x: 0, z: 100, y: 0, hp: 999999, m: 999999 });
  h.aiming = true; h.mp = h.maxMp = 9999;
  sim._rollCrit = (b, def, dmg) => dmg;   // 爆擊是機率事件,本節只驗偏心遞減
  const rr = lanceR(w.def) + hitR(t);
  const shot = (x0) => {   // 沿 +z 開火,origin 橫移 x0 ⇒ 垂距(偏心量)恰為 x0
    h.x = x0; h.z = 0; h.y = 0;
    const hp0 = t.hp;
    sim.t += 100;   // 越過射速/填彈(mag 打空自動填彈也在此完成)
    sim.heroLance('p_o', [x0, 0, oy], [0, 1, 0], 400);
    return hp0 - t.hp;
  };
  const dCenter = shot(0);
  const off = rr * 0.8;
  const dEdge = shot(off);
  assert(dCenter > 0 && dEdge > 0, '正中與偏心(80% 半寬)兩發都命中(偏移仍在 R + hitR 內)');
  // 期望比值 = 偏心遞減 × 兩發 d3 的距離衰減比(距離衰減與偏心遞減是兩條獨立的乘數)
  const dy = sim._tgtY(t) - oy;
  const exp = offAxisFalloff(off / rr)
    * dmgFalloff(w.def, Math.hypot(off, 100, dy)) / dmgFalloff(w.def, Math.hypot(0, 100, dy));
  const ratio = dEdge / dCenter;
  assert(Math.abs(ratio - exp) < 0.02,
    `偏心傷害遞減生效於伺服器結算:偏離軸心 ${off.toFixed(1)}m 傷害 ×${ratio.toFixed(3)}(期望 ${exp.toFixed(3)})`);
  assert(offAxisFalloff(0) === 1 && Math.abs(offAxisFalloff(1) - AOE_EDGE) < 1e-9,
    `曲線端點:正中 1.0 / 邊緣保底 ${AOE_EDGE}(bal/duel 全數模型化「瞄準正中」⇒ 不變式天然不動)`);
}

// ---------- ⑥ 垂直帶:塔頂/機體任一高度同額(hitH 垂直版不得回歸)----------
{
  const sim = sandbox();
  const w = charWithHeavy('beam') || charWithHeavy('rail') || charWithHeavy('gun');
  const h = sim.addHero('SWARM', 'p_v', w.id);
  h.x = 0; h.z = 0; h.y = 0;
  const tower = sim._add({ kind: 'tower', side: 'STEEL', x: 0, z: 150, y: 0, hp: 9999, m: 9999 });
  const oy = LOS.EYE_M;
  // 仰射塔頂(dy 讓射線在 150m 處爬到 24m 高)—— 塔身垂直帶 [0, 26] 內,MUST 命中
  const dy = 24 / 150;
  const nl = Math.hypot(1, dy);
  assert(sim._lanceHits(h, w.def, 0, 0, oy, 0, 1 / nl, dy / nl, 400).some((k) => k.t === tower),
    '仰射塔頂(射線高 24m,落在塔身垂直帶內)判定命中');
  // 遠高於塔頂(垂直帶 + 寬容之外)MUST NOT 命中
  const dyHi = (hitH(tower) + lanceR(w.def) * LANCE.VBAND_F + 30) / 150;
  const nh = Math.hypot(1, dyHi);
  assert(!sim._lanceHits(h, w.def, 0, 0, oy, 0, 1 / nh, dyHi / nh, 400).some((k) => k.t === tower),
    '射線遠高於塔頂(垂直帶寬容之外)判定落空');
}

// ---------- ⑦ 圓柱半徑恆為 lanceR(def):兩端同一條尺、無情境加粗 ----------
{
  const sim = sandbox();
  const w = charWithHeavy('gun') || charWithHeavy('rail') || charWithHeavy('beam');
  const h = sim.addHero('SWARM', 'p_ba', w.id);
  h.x = 0; h.z = 0; h.y = 0;
  const oy = LOS.EYE_M;
  const R = lanceR(w.def) + hitR({ kind: 'soldier' });
  // 判定邊界內外各擺一名:內側命中、外側落空,且**多傳一個舊 barrage 參數也不該改變結果**
  const near = sim._add({ kind: 'soldier', side: 'STEEL', x: R * 0.8, z: 120, y: 0, hp: 99999, m: 99999 });
  const far = sim._add({ kind: 'soldier', side: 'STEEL', x: R * 1.4, z: 100, y: 0, hp: 99999, m: 99999 });
  assert(sim._lanceHits(h, w.def, 0, 0, oy, 0, 1, 0, 400).some((k) => k.t === near),
    `側向 ${(R * 0.8).toFixed(1)}m(判定半徑內)命中`);
  assert(!sim._lanceHits(h, w.def, 0, 0, oy, 0, 1, 0, 400).some((k) => k.t === far),
    `側向 ${(R * 1.4).toFixed(1)}m(判定半徑外)落空`);
  assert(!sim._lanceHits(h, w.def, 0, 0, oy, 0, 1, 0, 400, true).some((k) => k.t === far),
    '傳入舊的 barrage 旗標也不會加粗(_lanceHits 已無該參數 ⇒ 沒有殘留旁路)');
}

// ---------- ⑧ 敵我識別:友軍與駐守單位不進命中列表 ----------
{
  const sim = sandbox();
  const w = charWithHeavy('rail') || charWithHeavy('gun') || charWithHeavy('beam');
  const h = sim.addHero('SWARM', 'p_f', w.id);
  h.x = 0; h.z = 0; h.y = 0;
  const oy = LOS.EYE_M;
  const ally = sim._add({ kind: 'soldier', side: 'SWARM', x: 0, z: 80, y: 0, hp: UNITS.soldier.hp });
  const gar = sim._add({ kind: 'soldier', side: 'STEEL', x: 0, z: 100, y: 0, hp: UNITS.soldier.hp, gar: true });
  const foe = sim._add({ kind: 'soldier', side: 'STEEL', x: 0, z: 120, y: 0, hp: UNITS.soldier.hp });
  const hits = sim._lanceHits(h, w.def, 0, 0, oy, 0, 1, 0, 400);
  assert(!hits.some((k) => k.t === ally), '友軍不在貫穿命中列表');
  assert(!hits.some((k) => k.t === gar), '駐守中(gar)單位不在貫穿命中列表');
  assert(hits.some((k) => k.t === foe), '敵方單位在貫穿命中列表(對照組)');
}

// ---------- ⑨ 演出範圍 = 判定範圍(靜態規則;three 走 CDN,沙箱無法真渲染)----------
// 使用者需求「動畫範圍須一致」+ A18「看到多粗就是打到多粗」。三個會回歸的寫法:
//   ① 演出端自己乘倍率(舊巨砲的 `barrage ? 1.5 : 1`)⇒ 伺服器沒跟上 = 空頭支票
//   ② 外層圓柱只畫判定半徑的一部分(舊 `w: r * 0.45`)⇒ 玩家看到細線、判定卻寬一倍
//   ③ 演出端改吃 lanceR 以外的來源
{
  const game = readFileSync(new URL('../public/js/game.js', import.meta.url), 'utf8');
  const vis = game.slice(game.indexOf('_lanceVisual(from, to, def, side'));
  const body = vis.slice(0, vis.indexOf('\n  }\n'));
  assert(/const r = lanceR\(def\);/.test(body),
    '_lanceVisual 的圓柱半徑取自 lanceR(def) 單一縫');
  assert(!/barrage/.test(body),
    '演出端 MUST NOT 留任何傾洩窗倍率的殘骸(巨砲已整組移除)');
  assert(/beamLine\([^)]*\{ ttl: [\d.]+, w: r, op: [\d.]+ \}\)/.test(body),
    'rail/gun 外層通道滿寬 w: r(= 判定半徑),靠 op 壓低不透明度而非縮小尺寸');
  assert(/gundamBeam\([\s\S]{0,120}\{ r,/.test(body),
    'beam 外暈直接吃 r(gundamBeam 的 halo 半徑 = 判定半徑)');
}

log(failed ? '\n❌ 直線貫穿命中判定稽核未通過' : '\n✅ 直線貫穿命中判定稽核全數通過');
process.exit(failed ? 1 : 0);
