// 端對端測試:sim 直測(地雷/彈夾/克制/自爆/角色招式/雙層HP/防空伏擊)
//            → 開房前選圖 → 建房(含隊伍規模/環境)→ 選陣營(N 席)→ 選角
//            → 準備 → 開戰載入 → 快照 → 彈道命中 → 招式養成 → 勝負 → 回房保留地圖
import WebSocket from 'ws';
import { BattleSim } from '../server/sim.js';
import {
  UNITS, ECON, GAME, FIELD, HAZARDS, AFFIXES,
  CHARACTERS, charsOf, heroWeapon, heroAbility, PROG, HEROIC, VITALS, armorMul,
} from '../public/js/data.js';

const URL = 'ws://localhost:8620';
const log = (...a) => console.log(...a);
let failed = false;
const assert = (cond, msg) => {
  if (cond) log(`  ✅ ${msg}`);
  else { failed = true; log(`  ❌ ${msg}`); }
};

function client(name) {
  const ws = new WebSocket(URL);
  const c = { ws, name, msgs: [], sync: null, snaps: [], pin: null };
  ws.on('message', (raw) => {
    const m = JSON.parse(raw);
    c.msgs.push(m);
    if (m.t === 'sync') c.sync = m;
    if (m.t === 'snap') c.snaps.push(m);
    if (m.t === 'battleConfig') c.battleConfig = m.config;
    if (m.t === 'error') log(`  [${name}] ⚠️ error: ${m.msg}`);
  });
  c.send = (m) => ws.send(JSON.stringify(m));
  c.wait = (pred, timeout = 5000) => new Promise((res, rej) => {
    const t0 = Date.now();
    const iv = setInterval(() => {
      const hit = pred(c);
      if (hit) { clearInterval(iv); res(hit); }
      else if (Date.now() - t0 > timeout) { clearInterval(iv); rej(new Error(`timeout: ${name}`)); }
    }, 30);
  });
  return new Promise((res) => ws.on('open', () => res(c)));
}

// 模擬戰場設定(合成兵線;台北 101 附近)。L 條兵線,兩堡距離 1600×L
// (刻意比正式的 1000×L 大:留出塔與高空測試點的防空安全邊界)。
function fakeBattleConfig(L = 3) {
  const A = [25.0330, 121.5654];
  const D = 1600 * L, R = 6371000;
  const dLat = D / R * 180 / Math.PI;
  const B = [A[0] + dLat, A[1]];
  const mid = [(A[0] + B[0]) / 2, (A[1] + B[1]) / 2];
  const mkLane = (off) => {
    const dLng = off / (R * Math.cos(A[0] * Math.PI / 180)) * 180 / Math.PI;
    const c = [mid[0], mid[1] + dLng];
    const pts = [];
    for (let t = 0; t <= 1.001; t += 0.05) {
      const u = 1 - t;
      pts.push([u * u * A[0] + 2 * u * t * c[0] + t * t * B[0], u * u * A[1] + 2 * u * t * c[1] + t * t * B[1]]);
    }
    return pts;
  };
  const offs = L === 1 ? [0] : L === 2 ? [0.3 * D, -0.3 * D] : [0.3 * D, 0, -0.3 * D];
  const sizeM = D / (0.85 * Math.SQRT2);
  return {
    center: { lat: mid[0], lng: mid[1] },
    bases: { SWARM: A, STEEL: B },
    lanes: offs.map(mkLane),
    sizeM, diagM: sizeM * Math.SQRT2, distM: D,
    maxOverlap: 0.05, synthetic: true, placeName: '測試戰區',
    env: { season: 'summer', time: 'day', weather: 'clear' },
  };
}

// ================= sim 直測(不經 WebSocket,確定性驗證新機制)=================
log('— sim:角色系統(24 角 × 專屬武器/招式 × 三階;英雄 vs NPC 倍率)—');
{
  assert(charsOf('SWARM').length === 12 && charsOf('STEEL').length === 12, '雙陣營各 12 名角色');
  let dataOk = true, rangeOk = true, tierOk = true;
  for (const id of Object.keys(CHARACTERS)) {
    for (const slot of ['light', 'heavy']) {
      for (let lvl = 1; lvl <= 3; lvl++) {
        const w = heroWeapon(id, slot, lvl);
        if (!w || !(w.dmg > 0) || !(w.range > 0) || !(w.reload > 0) || !(w.mag > 0)) dataOk = false;
      }
      if (heroWeapon(id, slot, 3).dmg <= heroWeapon(id, slot, 1).dmg) tierOk = false;
    }
    for (const slot of ['skill', 'ult']) {
      for (let lvl = 1; lvl <= 3; lvl++) {
        const a = heroAbility(id, slot, lvl);
        if (!a || !(a.cd > 0) || !(a.mp > 0)) dataOk = false;
      }
    }
    // #INC-104:e2e 從 y=250 高空垂直射擊 → 輕武器英雄射程 ×1.25 必須 > 250
    if (heroWeapon(id, 'light', 1).range * 1.25 <= 250) rangeOk = false;
  }
  assert(dataOk, '24 角 × 4 招 × 3 階資料完整(傷害/射程/CD/MP 皆為正值)');
  assert(tierOk, '三階升級傷害遞增');
  assert(rangeOk, '全部輕武器英雄射程 ×1.25 > 250(高空射擊測試相容,#INC-104)');
  const wn = heroWeapon('t01', 'light', 1, false), wh = heroWeapon('t01', 'light', 1, true);
  assert(Math.abs(wh.range / wn.range - HEROIC.range) < 1e-9 && Math.abs(wh.dmg / wn.dmg - HEROIC.dmg) < 1e-9,
    `玩家英雄同型武器:射程 ×${HEROIC.range}、威力 ×${HEROIC.dmg}(vs NPC 基準)`);
}

log('— sim:地雷佈設(非正規路線)+ 機甲踩雷 —');
{
  const sim = new BattleSim(fakeBattleConfig(1));
  assert(sim.mines.length >= 20, `地雷 ${sim.mines.length} 顆(目標 ${GAME.MINES.PER_LANE}/線)`);
  assert(sim.mines.every(([x, z]) => sim._distToLanes(x, z) >= GAME.MINES.LANE_CLEAR), '雷區避開兵線走廊');
  const rb = sim.addHero('STEEL', 'p_r', 't01');   // 冬將軍(輕武器無爆擊 → 傷害確定性)
  const nMines = sim.mines.length;
  [rb.x, rb.z] = sim.mines[0];
  sim.tick(0.125);
  assert(rb.sp < rb.maxSp && sim.mines.length === nMines - 1,
    `機甲踩雷受創(護盾 ${rb.maxSp} → ${Math.round(rb.sp)},雷被消耗)`);
  assert(sim.events.some((e) => e.e === 'boom' && e.mine && e.tpid === 'p_r'), '地雷爆炸事件帶 tpid');
  assert(sim.events.some((e) => e.e === 'boom' && e.mine && e.mid != null), '地雷爆炸事件帶 mid(客戶端移除微凸起)');
  assert(sim.fieldPayload().mines.every((m) => m.length === 3), 'fieldPayload 地雷格式 [x,z,id]');

  log('— sim:武器克制 × 護甲減免 + 彈夾上限 —');
  const wl = heroWeapon('t01', 'light', 1);
  const dummy = sim._add({ kind: 'soldier', side: 'SWARM', x: rb.x + 10, z: rb.z, hp: UNITS.soldier.hp });
  sim.t += 1;   // 越過射速下限
  sim.heroHit('p_r', dummy.id);
  const expSoldier = wl.dmg * 1.3 * armorMul(UNITS.soldier.armor, wl.pen);
  assert(Math.abs((UNITS.soldier.hp - dummy.hp) - expSoldier) < 0.5,
    `克制傷害 ${(UNITS.soldier.hp - dummy.hp).toFixed(1)}(= ${wl.dmg} × 肉體 1.3 × 護甲減免)`);
  sim.ents.delete(dummy.id);   // 測試假人沒有 lane,tick 前先移除
  const tw = [...sim.ents.values()].find((e) => e.kind === 'tower' && e.side === 'SWARM');
  rb.x = tw.x + 30; rb.z = tw.z;
  rb.ammo = {}; rb.fireAt = {}; rb.reloadUntil = {};   // 重置彈藥計數
  const hp0t = tw.hp;
  const shots = wl.mag + 10;   // 填彈完成前打完(只吃得進一個彈夾)
  for (let i = 0; i < shots; i++) { sim.t += 0.16; sim.heroHit('p_r', tw.id); }
  const magDmg = hp0t - tw.hp;
  const expMag = wl.mag * wl.dmg * 0.6 * armorMul(UNITS.tower.armor, wl.pen);
  assert(Math.abs(magDmg - expMag) < 1,
    `${shots} 連發只吃進一個彈夾 ${wl.mag} 發 × 建築 0.6 × 護甲減免(傷害 ${magDmg.toFixed(1)},其餘填彈中被拒)`);

  log('— sim:無人機重型炸彈自爆 + 無冷卻重生 —');
  const dr = sim.addHero('SWARM', 'p_d', 's01');
  const victim = sim._add({ kind: 'soldier', side: 'STEEL', x: dr.x + 6, z: dr.z, hp: UNITS.soldier.hp });
  dr.y = 4;
  const $kill0 = dr.money;
  sim.heroDetonate('p_d');
  assert(!sim.ents.has(victim.id), '自爆(240 × 肉體 1.5)炸死近旁敵兵');
  assert(dr.dead, '自爆座機同歸於盡');
  assert(dr.money - $kill0 >= ECON.BOUNTY.soldier, `擊殺得賞金 +$${Math.round(dr.money - $kill0)}`);
  assert(dr.kn >= 1, `擊殺數入帳(kn=${dr.kn},招式解鎖門檻用)`);
  sim.tick(0.05);
  assert(dr.dead, '死亡當下那個 tick 仍維持 dead(確保至少一份快照廣播 dead:true,客戶端才能感知死亡)');
  sim.tick(0.05);
  assert(!dr.dead, '無人機重生無冷卻(跨過一次完整 tick 週期後立即歸隊)');
  assert(UNITS.robot.respawn.base > 0, '機甲重生有冷卻(數值檢查)');

  log('— sim:雙層 HP(護盾脫戰回復 / 裝甲只能回堡或招式修)+ 電力 —');
  dr.x = sim.basePos.SWARM[0] + 500; dr.z = sim.basePos.SWARM[1];   // 先遠離主堡補血圈
  dr.sp = 0; dr.hp = Math.round(dr.maxHp * 0.6);
  const hpNow = dr.hp;
  dr.lastHitAt = sim.t;
  sim.tick(0.125);
  assert(dr.sp === 0, '戰鬥中(剛受擊)護盾不回復');
  dr.lastHitAt = sim.t - VITALS.OOC_S - 1;
  sim.tick(0.5);
  assert(dr.sp > 0, `脫戰 ${VITALS.OOC_S}s 後護盾自然回復(sp=${Math.round(dr.sp)})`);
  assert(dr.hp === hpNow, '裝甲在主堡補血圈外不回復(只能回堡或治療招式)');
  [dr.x, dr.z] = sim.basePos.SWARM;
  sim.tick(0.5);
  assert(dr.hp > hpNow, '回主堡 → 裝甲開始修復');
  assert(dr.mp < dr.maxMp || dr.mp === dr.maxMp, `電力欄存在(mp=${Math.floor(dr.mp)}/${dr.maxMp})`);

  log('— sim:招式養成(擊殺數解鎖 + 金錢購買 + CD + 電力)—');
  dr.money = 9999; dr.kn = 0;
  assert(/擊殺數不足/.test(sim.buy('p_d', 'ab:skill') || ''), '擊殺數不足 → 解鎖小招被拒');
  dr.kn = PROG.skill.kills[0];
  assert(sim.buy('p_d', 'ab:skill') === null && dr.abil.skill === 1, `${PROG.skill.kills[0]} 擊殺 + $${PROG.skill.cost[0]} → 小招解鎖`);
  dr.kn = PROG.light.kills[1];
  assert(sim.buy('p_d', 'ab:light') === null && dr.abil.light === 2, '輕武器升 Lv.2(擊殺+金錢)');
  const dmgL2 = heroWeapon('s01', 'light', 2).dmg;
  assert(dmgL2 > heroWeapon('s01', 'light', 1).dmg, `升階後傷害提升(${heroWeapon('s01', 'light', 1).dmg} → ${dmgL2})`);
  dr.mp = dr.maxMp;
  const A1 = heroAbility('s01', 'skill', 1);
  const mp0 = dr.mp;
  sim.heroCast('p_d', 'skill', dr.x, dr.z);
  assert(dr.acd.skill > sim.t && Math.round(mp0 - dr.mp) === A1.mp, `施放小招:CD ${A1.cd}s、電力 -${A1.mp}MP`);
  const mp1 = dr.mp;
  sim.heroCast('p_d', 'skill', dr.x, dr.z);
  assert(dr.mp === mp1, 'CD 中重複施放被拒(電力未扣)');
  assert(dr.mods.length > 0, '增益類小招掛上 mods(蜂群協奏)');
  const rb2 = sim.addHero('STEEL', 'p_r2', 't05');
  rb2.money = 999;
  assert(sim.buy('p_r2', 'hull') === null && rb2.maxHp > Math.round(UNITS.robot.hp * CHARACTERS.t05.mods.hp),
    `裝甲強化隨處可買(HP 上限 → ${rb2.maxHp})`);
  assert(/沒有這項商品/.test(sim.buy('p_r2', 'railgun') || ''), '舊制軍械庫武器已下架(輕重武器外無其他配置)');

  log('— sim:非正規路線防空伏擊(需射程內有存活陣地)+ 飛彈可破壞 —');
  const site0 = [...sim.ents.values()].find((e) => e.kind === 'aasite');
  assert(!!site0, '匿蹤防空陣地已生成');
  dr.x = site0.x; dr.z = site0.z; dr.y = 30;           // 陣地正上方(走廊外);y=30 避開火場
  dr.hp = dr.maxHp = 99999;                            // 防塔砲/流彈把測試機打下來(只驗伏擊)
  let launched = null;
  for (let i = 0; i < 800 && !launched && !dr.dead; i++) {
    sim.tick(0.125);
    launched = sim.missiles.find((m) => m.tpid === 'p_d');
  }
  assert(!!launched, '偏離兵線走廊 → 匿蹤防空飛彈升空');
  assert(sim.events.some((e) => e.e === 'sam' && e.ambush), 'sam 事件帶 ambush 旗標(客戶端警告)');
  if (launched && !dr.dead) {
    dr.ammo = {}; dr.fireAt = {}; dr.reloadUntil = {};
    const $0 = dr.money;
    for (let i = 0; i < 5 && sim.missiles.includes(launched); i++) {
      sim.t += 0.2;
      sim.hitMissile('p_d', launched.id, 'gun');
    }
    assert(!sim.missiles.includes(launched), '來襲飛彈被機槍擊毀');
    assert(dr.money - $0 >= ECON.BOUNTY.missile, `擊落飛彈賞金 +$${ECON.BOUNTY.missile}`);
  }
}

// ================= sim 直測:霧戰爭(單位類實體限視野,建築/中立物永遠可見)=================
log('— sim:霧戰爭(視野外的敵方單位不進快照;瞄準模式加成視野;建築/中立物永遠可見)—');
{
  const sim = new BattleSim(fakeBattleConfig(1));
  const dr = sim.addHero('SWARM', 'p_fow');
  dr.x = 0; dr.z = 0; dr.y = 0;
  const nearSight = UNITS.drone.sight * 0.5;                 // 明確在視野內
  const farOut = UNITS.drone.sight * 1.5;                    // 明確在視野外(未瞄準)
  const near = sim._add({ kind: 'soldier', side: 'STEEL', x: nearSight, z: 0, hp: UNITS.soldier.hp });
  const far = sim._add({ kind: 'soldier', side: 'STEEL', x: farOut, z: 0, hp: UNITS.soldier.hp });
  const enemyHero = sim.addHero('STEEL', 'p_fow2');
  enemyHero.x = farOut; enemyHero.z = 50;

  let snap = sim.snapshotFor('SWARM');
  const ids = new Set(snap.ents.map((e) => e.id));
  assert(ids.has(near.id), '視野內的敵方小兵有進快照');
  assert(!ids.has(far.id), '視野外的敵方小兵不進快照');
  assert(!ids.has(enemyHero.id), '視野外的敵方英雄不進快照');
  assert(ids.has(dr.id), '己方英雄永遠看得到自己');

  // 塔 / 主堡 / 中立物:不算「單位」,永遠可見(即使在視野外)
  const farTower = [...sim.ents.values()].find((e) => e.kind === 'tower' && e.side === 'STEEL');
  const farBase = [...sim.ents.values()].find((e) => e.kind === 'base' && e.side === 'STEEL');
  const neutral = [...sim.ents.values()].find((e) => e.neutral);
  assert(ids.has(farTower.id) && ids.has(farBase.id), '敵方塔/主堡不受霧戰爭影響,永遠可見');
  assert(!neutral || ids.has(neutral.id), '中立實體(障礙/防空陣地)不受霧戰爭影響');

  // 瞄準模式:視野加成應能看到原本在視野外的敵方小兵
  const aimTarget = sim._add({ kind: 'soldier', side: 'STEEL', x: UNITS.drone.sight * 1.3, z: 0, hp: UNITS.soldier.hp });
  let idsNoAim = new Set(sim.snapshotFor('SWARM').ents.map((e) => e.id));
  assert(!idsNoAim.has(aimTarget.id), '瞄準前:1.3 倍視野外看不到');
  dr.aiming = true;
  let idsAim = new Set(sim.snapshotFor('SWARM').ents.map((e) => e.id));
  assert(idsAim.has(aimTarget.id), `瞄準模式視野加成(×${GAME.AIM_SIGHT_MULT})後看得到`);

  // 觀戰者(side=null)無霧,看得到所有東西
  const specIds = new Set(sim.snapshotFor(null).ents.map((e) => e.id));
  assert(specIds.has(far.id) && specIds.has(enemyHero.id), '觀戰者(無側別)收到無霧全局快照');
}

// ================= sim 直測:危險區(Diablo 式隨機生成)=================
log('— sim:障礙物生成(避開走廊/主堡)+ 防空陣地可擊毀 —');
{
  const sim = new BattleSim(fakeBattleConfig(2));
  const haz = [...sim.ents.values()].filter((e) => e.haz);
  const sites = [...sim.ents.values()].filter((e) => e.kind === 'aasite');
  assert(haz.length >= FIELD.HAZ_PER_LANE, `障礙物 ${haz.length} 個(目標 ${FIELD.HAZ_PER_LANE}/線)`);
  assert(haz.every((h) => sim._distToLanes(h.x, h.z) >= FIELD.HAZ_LANE_MIN), '障礙物避開兵線走廊(不擋正規路線)');
  assert(sites.length >= FIELD.AA_SITES_PER_LANE, `防空陣地 ${sites.length} 座`);
  const bases = Object.values(sim.basePos);
  assert(haz.concat(sites).every((h) =>
    bases.every(([bx, bz]) => Math.hypot(h.x - bx, h.z - bz) >= FIELD.HAZ_BASE_CLEAR)), '主堡周圍淨空');
  assert(haz.every((h) => h.sc > 0 && HAZARDS[h.kind]), `每個障礙帶隨機尺寸差異(sc)與合法類型`);

  // 擊毀防空陣地:賞金 + die 事件 + 從快照消失
  const rb = sim.addHero('STEEL', 'hz_r');
  const site = sites[0];
  rb.x = site.x + 10; rb.z = site.z;
  const $0 = rb.money;
  for (let i = 0; i < 40 && sim.ents.has(site.id); i++) { sim.t += 0.3; sim.heroHit('hz_r', site.id); }
  assert(!sim.ents.has(site.id), '防空陣地被機槍拆除(= 打出安全空域)');
  assert(rb.money - $0 >= ECON.BOUNTY.aasite, `拆陣地賞金 +$${ECON.BOUNTY.aasite}`);
  assert(sim.events.some((e) => e.e === 'die' && e.kind === 'aasite'), 'die 事件帶 aasite(客戶端播報)');

  // 不可摧毀障礙(塌陷/坍方/火場/淹水)打不掉
  const inv = haz.find((h) => h.inv);
  if (inv) {
    sim.t += 1;
    sim.heroHit('hz_r', inv.id);
    assert(sim.ents.has(inv.id) && inv.hp === inv.maxHp, `不可摧毀障礙(${HAZARDS[inv.kind].name})免疫傷害`);
  }

  // 可擊毀障礙 → 掉落隨機物資 → 靠近拾取
  sim.loots = [];
  sim._spawnLoot(rb.x + 3, rb.z);
  const loot = sim.loots[0];
  const isAmmo = !!loot.ammo, isAffix = !!loot.af;
  const $1 = rb.money;
  rb.ammo.light = 5;                       // 造一個「半彈夾」狀態驗證補彈
  rb.x = loot.x; rb.z = loot.z; rb.y = 0;
  sim.tick(0.05);
  assert(sim.loots.length === 0, `戰場物資被拾取(${isAmmo ? '彈藥補給' : isAffix ? '詞綴強化' : '現金'})`);
  if (isAmmo) assert(rb.ammo.light == null, '彈藥補給清空計數 = 下次開火滿彈夾');
  else if (isAffix) assert(rb.buffs[loot.af] > sim.t, `詞綴強化生效(${AFFIXES[loot.af].name})`);
  else assert(rb.money > $1, `現金物資入帳 +$${Math.round(rb.money - $1)}`);
  assert(sim.events.some((e) => e.e === 'loot' && e.pid === 'hz_r'), 'loot 事件帶 pid');

  // 火場 DoT:低空/地面才吃(先扣護盾),高空免疫
  const fire = sim._add({ kind: 'fire', side: null, neutral: true, haz: true, inv: true, x: rb.x + 300, z: rb.z + 300, sc: 1, hp: 1 });
  sim._fires.push(fire);
  rb.x = fire.x; rb.z = fire.z;
  const vitF = rb.sp + rb.hp;
  for (let i = 0; i < 8; i++) sim.tick(0.125);
  assert(vitF - (rb.sp + rb.hp) > HAZARDS.fire.dot * 0.8, `火場灼傷 ${Math.round(vitF - (rb.sp + rb.hp))}/秒(先扣護盾)`);
  // 高空免疫灼傷(先拔光防空陣地,避免伏擊飛彈干擾判定)
  for (const s of [...sim.ents.values()]) if (s.kind === 'aasite') sim.ents.delete(s.id);
  sim.missiles.length = 0;
  const dr2 = sim.addHero('SWARM', 'hz_d');
  dr2.x = fire.x; dr2.z = fire.z; dr2.y = HAZARDS.fire.maxY + 20;
  const hpD = dr2.hp;
  for (let i = 0; i < 8; i++) sim.tick(0.125);
  assert(dr2.hp === hpD, '高空飛越火場不受灼傷,且陣地拔光後無伏擊');
}

// ================= sim 直測:Diablo 進階(TreasureClass / 詞綴 / 中繼站 / 連通性)=================
log('— sim:TreasureClass 分層 + 詞綴強化 + 偵察中繼站 + 連通性保證 —');
{
  const sim = new BattleSim(fakeBattleConfig(2));

  // TreasureClass:tc=1(最硬障礙)比 tc=0 更常擲出稀有階(彈藥/詞綴)
  const rareRate = (tc) => {
    let n = 0;
    for (let i = 0; i < 400; i++) {
      sim.loots = [];
      sim._spawnLoot(0, 0, tc);
      const l = sim.loots[0];
      if (l.ammo || l.af) n++;
    }
    return n / 400;
  };
  const r0 = rareRate(0), r1 = rareRate(1);
  assert(r1 > r0 + 0.1, `TC 稀有度偏移生效(tc=0 → ${(r0 * 100).toFixed(0)}%,tc=1 → ${(r1 * 100).toFixed(0)}% 稀有)`);
  sim.loots = [];

  // 詞綴(伺服器結算):淬火軍械縮短填彈、複合裝甲減傷、快照帶 bf 倒數
  const rb = sim.addHero('STEEL', 'af_r', 't01');
  const wl2 = heroWeapon('t01', 'light', 1);
  rb.buffs.tempered = sim.t + 999;
  rb.ammo.light = 5;
  sim.heroReload('af_r', 'light');
  const rl = rb.reloadUntil.light - sim.t;
  assert(Math.abs(rl - wl2.reload * AFFIXES.tempered.reload) < 1e-6,
    `淬火軍械:填彈 ${rl.toFixed(2)}s(${wl2.reload}s × ${AFFIXES.tempered.reload})`);
  rb.buffs.hardened = sim.t + 999;
  rb.sp = 0;   // 清空護盾,直接驗裝甲層公式
  const hp0 = rb.hp;
  sim._damage(rb, 100, null);
  const expArmor = 100 * AFFIXES.hardened.dmgTaken * armorMul(rb.armor);
  assert(Math.abs((hp0 - rb.hp) - expArmor) < 0.5,
    `複合裝甲 × 護甲值:100 傷害實吃 ${(hp0 - rb.hp).toFixed(1)}(減傷 ${AFFIXES.hardened.dmgTaken} × 護甲 ${rb.armor})`);
  assert(sim.snapshotFor('STEEL').ents.find((e) => e.pid === 'af_r').bf?.length === 2, '快照帶詞綴倒數(bf)');

  // 偵察中繼站:每線 1 座、走廊之外(要冒險才吃得到)、佔用 → 視野脈衝 → 用過即毀
  const relays = [...sim.ents.values()].filter((e) => e.kind === 'relay');
  assert(relays.length === sim.lanes.length, `中繼站 ${relays.length} 座(${FIELD.RELAY.PER_LANE}/線)`);
  assert(relays.every((r) => sim._distToLanes(r.x, r.z) >= FIELD.RELAY.laneMin), '中繼站在兵線走廊之外');
  for (const s of [...sim.ents.values()]) if (s.kind === 'aasite') sim.ents.delete(s.id);   // 排除伏擊干擾
  const dr = sim.addHero('SWARM', 'rl_d');
  dr.x = relays[0].x; dr.z = relays[0].z; dr.y = 0;
  for (let i = 0; i < 28; i++) sim.tick(0.125);   // 3.5s > CHANNEL_S
  assert(sim.visionUntil.SWARM > sim.t, '佔用 3 秒 → 全隊視野脈衝啟動');
  assert([...sim.ents.values()].filter((e) => e.kind === 'relay').length === relays.length - 1, '中繼站用過即毀');
  assert(sim.events.some((e) => e.e === 'relay' && e.side === 'SWARM'), 'relay 事件帶陣營(客戶端播報)');
  const far = sim._add({ kind: 'soldier', side: 'STEEL', x: relays[0].x + 2000, z: relays[0].z, hp: UNITS.soldier.hp });
  let ids = new Set(sim.snapshotFor('SWARM').ents.map((e) => e.id));
  assert(ids.has(far.id), '視野脈衝生效中:霧外敵軍照樣進快照');
  sim.t += FIELD.RELAY.VISION_S + 2;
  ids = new Set(sim.snapshotFor('SWARM').ents.map((e) => e.id));
  assert(!ids.has(far.id), '脈衝過期:恢復正常迷霧');
  sim.ents.delete(far.id);   // 測試假人無 lane,清掉避免後續 tick 炸

  // 連通性保證(flood-fill):自然生成本就互通;人工橫斷牆會被偵測並拆出缺口
  const nb0 = sim.hazBlockers.length;
  sim._ensureConnectivity();
  assert(sim.hazBlockers.length === nb0, '連通性檢查:走廊淨空保證兩堡互通,無需拆牆');
  const midZ = (sim.basePos.SWARM[1] + sim.basePos.STEEL[1]) / 2;
  for (let x = -1600; x <= 1600; x += 18) sim.hazBlockers.push([x, midZ, 12]);
  const nb1 = sim.hazBlockers.length;
  sim._ensureConnectivity();
  assert(sim.hazBlockers.length < nb1, `人工橫斷牆被偵測,拆 ${nb1 - sim.hazBlockers.length} 段開出缺口`);
}

// ================= WebSocket 端對端 =================
log('— 開房驗證(地圖必須先建立)—');
const host = await client('host');
host.send({ t: 'createRoom', name: '蜂群女王', roomName: '沒有地圖', teamSize: 1 });
await host.wait((c) => c.msgs.find((m) => m.t === 'error' && /不完整/.test(m.msg)));
assert(true, '缺 battleConfig 開房被拒絕');

const wrongLanes = fakeBattleConfig(3);
host.send({ t: 'createRoom', name: '蜂群女王', roomName: '線數錯', teamSize: 1, battleConfig: wrongLanes });
await host.wait((c) => c.msgs.find((m) => m.t === 'error' && /兵線/.test(m.msg)));
assert(true, '兵線數與隊伍規模不符被拒絕(1v1 要 1 線)');

const tooShort = fakeBattleConfig(1);
tooShort.distM = tooShort.diagM * 0.5;
host.send({ t: 'createRoom', name: '蜂群女王', roomName: '太近', teamSize: 1, battleConfig: tooShort });
await host.wait((c) => c.msgs.find((m) => m.t === 'error' && /80%/.test(m.msg)));
assert(true, '主堡距離未達對角線 80% 被拒絕');

log('— 建立房間(1v1,開房即帶地圖與環境)—');
host.send({ t: 'createRoom', name: '蜂群女王', roomName: '測試戰區', isPublic: true, teamSize: 1, battleConfig: fakeBattleConfig(1) });
await host.wait((c) => c.sync);
const pin = host.sync.lobby.pin;
assert(/^\d{4}$/.test(pin), `取得 PIN:${pin}`);
assert(host.sync.isHost === true, '建房者是房主');
const lockedCfg = host.sync.lobby.battleConfig;
assert(lockedCfg && lockedCfg.lanes.length === 1, '房間已鎖定 1 條兵線的地圖');
assert(['spring', 'summer', 'autumn', 'winter'].includes(lockedCfg.env?.season), `環境已定案(${lockedCfg.env?.season}/${lockedCfg.env?.time}/${lockedCfg.env?.weather})`);

// 霧戰爭:觀戰者收無霧全局快照,後面凡是要「發現」敵方單位(host 視野外)都改讀這份
const spec = await client('spec');
spec.send({ t: 'joinRoom', pin, name: '觀戰者', mode: 'spectator' });
await spec.wait((c) => c.sync);

log('— 房間列表 —');
const lurker = await client('lurker');
lurker.send({ t: 'listRooms' });
const roomsMsg = await lurker.wait((c) => c.msgs.find((m) => m.t === 'rooms'));
const entry = roomsMsg.rooms.find((r) => r.pin === pin);
assert(!!entry, '大廳列表含公開房與 PIN');
assert(entry.teamSize === 1 && entry.place === '測試戰區', `列表帶隊伍規模與地點(${entry.teamSize}v${entry.teamSize}・${entry.place})`);
lurker.ws.close();

log('— 加入 + 選陣營(每陣營 1 席)—');
const guest = await client('guest');
guest.send({ t: 'joinRoom', pin, name: '鋼鐵上校', mode: 'player' });
await guest.wait((c) => c.sync);
host.send({ t: 'pickSide', side: 'SWARM' });
guest.send({ t: 'pickSide', side: 'STEEL' });
await host.wait((c) => c.sync.lobby.clients.filter((x) => x.side).length === 2);
assert(true, '雙方各佔一個陣營');
guest.send({ t: 'pickSide', side: 'SWARM' });
await guest.wait((c) => c.msgs.find((m) => m.t === 'error' && /已滿/.test(m.msg)));
assert(true, '陣營滿員(1 席)再搶被拒絕');
guest.send({ t: 'pickSide', side: 'STEEL' });

log('— 選角(角色綁陣營;不選 = 開戰隨機)—');
host.send({ t: 'pickChar', ch: 't01' });   // 蜂群玩家選鋼鐵角色 → 拒絕
await host.wait((c) => c.msgs.find((m) => m.t === 'error' && /陣營不符/.test(m.msg)));
assert(true, '選敵陣營角色被拒絕');
host.send({ t: 'pickChar', ch: 's02' });   // 鐵匠(重武器溫壓火箭:反建築,後面拆堡用)
await host.wait((c) => c.sync.lobby.clients.find((x) => x.id === c.sync.youId)?.ch === 's02');
assert(true, `host 選角「${CHARACTERS.s02.code}」(lobby 同步)`);
guest.send({ t: 'pickChar', ch: 't04' });
await guest.wait((c) => c.sync.lobby.clients.find((x) => x.id === c.sync.youId)?.ch === 't04');
assert(true, `guest 選角「${CHARACTERS.t04.code}」`);

log('— 滿房拒收第三位玩家(2N=2)—');
const third = await client('third');
third.send({ t: 'joinRoom', pin, name: '第三者', mode: 'player' });
await third.wait((c) => c.msgs.find((m) => m.t === 'error' && /席位已滿/.test(m.msg)));
assert(true, '第 3 位玩家被拒(可觀戰)');
third.ws.close();

log('— 準備 + 開戰 → loading —');
host.send({ t: 'setReady', ready: true });
guest.send({ t: 'setReady', ready: true });
await host.wait((c) => c.sync.lobby.clients.every((x) => x.mode !== 'player' || x.ready));
host.send({ t: 'startBattle' });
await guest.wait((c) => c.battleConfig);
assert(guest.battleConfig.placeName === '測試戰區', '雙方收到 battleConfig');
assert(guest.sync.lobby.phase === 'loading' || guest.battleConfig != null, '進入 loading 階段');

log('— 雙方載入完成 → 開戰 —');
host.send({ t: 'loaded' });
guest.send({ t: 'loaded' });
await host.wait((c) => c.snaps.length > 3, 8000);
await spec.wait((c) => c.snaps.length > 3, 8000);
const snap = host.snaps.at(-1);
const specSnap = spec.snaps.at(-1);   // 無霧視角:雙方主堡/塔/英雄都在
const bases = specSnap.ents.filter((e) => e.k === 'base');
const towers = specSnap.ents.filter((e) => e.k === 'tower');
const heroes = specSnap.ents.filter((e) => e.k === 'drone' || e.k === 'robot');
assert(bases.length === 2, `主堡 ×2(hp=${bases[0]?.hp})`);
assert(towers.length === 4, `防禦塔 ×4(1 線 × 2 位置 × 2 方;實際 ${towers.length})`);
assert(heroes.length === 2, `英雄 ×2(${heroes.map((h) => h.k).join(',')})`);
const myHero = snap.ents.find((h) => h.pid === host.sync.youId);
assert(myHero && myHero.k === 'drone', `英雄快照帶 pid,能認出自己的座機(pid=${myHero?.pid})`);
assert(typeof myHero.$ === 'number' && myHero.ab && typeof myHero.kn === 'number',
  `英雄快照帶金錢/招式階級/擊殺數($${myHero.$}・ab=${JSON.stringify(myHero.ab)})`);
assert(myHero.ch === 's02', `快照帶角色 id(ch=${myHero.ch},客戶端渲染專屬機體)`);
assert(myHero.sp != null && myHero.msp > 0 && myHero.mp != null && myHero.mm > 0,
  `快照帶護盾/電力(sp=${myHero.sp}/${myHero.msp}・mp=${myHero.mp}/${myHero.mm})`);
const botAssigned = specSnap.ents.filter((e) => (e.k === 'drone' || e.k === 'robot') && e.ch);
assert(botAssigned.length === heroes.length, '所有英雄(含未選角者)開戰時都有角色(默認隨機)');

log('— 危險區:field 訊息 + 快照帶中立障礙 —');
const fieldMsg = host.msgs.find((m) => m.t === 'field');
assert(fieldMsg && fieldMsg.mines.length > 0, `開戰收到 field(地雷 ${fieldMsg?.mines?.length} 顆)`);
assert(snap.ents.some((e) => e.k === 'aasite'), '快照帶匿蹤防空陣地(中立實體)');
assert(snap.ents.some((e) => e.sc && !e.s), '中立障礙帶尺寸 sc 且無陣營');

log('— 等第一波兵線 —');
await spec.wait((c) => {
  const s = c.snaps.at(-1);
  return s.ents.some((e) => e.k === 'soldier');
}, 15000);
const snapWave = spec.snaps.at(-1);   // 無霧視角:才看得到雙方全部小兵
const creeps = snapWave.ents.filter((e) => ['soldier', 'rocketeer', 'howitzer', 'heli'].includes(e.k));
assert(creeps.length === 12, `第一波小兵 12 隻(1線×2方×6;實際 ${creeps.length})`);

log('— 英雄移動 + 射擊 —');
const target = snapWave.ents.find((e) => e.k === 'soldier' && e.s === 'STEEL');
host.send({ t: 'pos', x: target.x, y: 250, z: target.z, ry: 0 });
await new Promise((r) => setTimeout(r, 300));
const hp0 = target.hp;
for (let i = 0; i < 6; i++) {
  host.send({ t: 'hit', id: target.id });
  await new Promise((r) => setTimeout(r, 160));
}
const after = await host.wait((c) => {
  const s = c.snaps.at(-1);
  const t2 = s.ents.find((e) => e.id === target.id);
  return (!t2 || t2.hp < hp0) ? s : null;
}, 4000);
const t2 = after.ents.find((e) => e.id === target.id);
assert(!t2 || t2.hp < hp0, `射擊生效(${hp0} → ${t2 ? t2.hp : '陣亡'})`);

log('— 射速上限(狂發 hit 不會全吃)—');
const t3 = spec.snaps.at(-1).ents.find((e) => e.k === 'howitzer' && e.s === 'STEEL');   // 無霧視角找目標(host 視野外)
if (t3) {
  host.send({ t: 'pos', x: t3.x, y: 250, z: t3.z, ry: 0 });
  await new Promise((r) => setTimeout(r, 250));
  const before = (host.snaps.at(-1).ents.find((e) => e.id === t3.id) || {}).hp ?? t3.hp;
  for (let i = 0; i < 50; i++) host.send({ t: 'hit', id: t3.id });
  await new Promise((r) => setTimeout(r, 400));
  const nowT = host.snaps.at(-1).ents.find((e) => e.id === t3.id);
  const dmgDone = before - (nowT ? nowT.hp : 0);
  const wLight = heroWeapon('s02', 'light', 1);
  const cap = wLight.dmg * 1.3 * (wLight.critX ?? 1.6) * 10;   // 遠小於 50 發全吃
  assert(dmgDone < cap, `50 連發只吃進 ${Math.round(dmgDone)} 傷害 < ${Math.round(cap)}(限速生效)`);
}

log('— 重武器 CD(瞄準 + 著彈回報;CD 中連發被拒)—');
host.send({ t: 'pos', x: target.x, y: 250, z: target.z, ry: 0 });   // 回到著彈點正上方(射程內)
const boomsBefore = host.snaps.flatMap((s) => s.ev || []).filter((e) => e.e === 'boom').length;
host.send({ t: 'aim', on: true });
await new Promise((r) => setTimeout(r, 200));
host.send({ t: 'burst', x: target.x, z: target.z });
host.send({ t: 'burst', x: target.x, z: target.z });
await new Promise((r) => setTimeout(r, 400));
host.send({ t: 'aim', on: false });
const boomsAfter = host.snaps.flatMap((s) => s.ev || []).filter((e) => e.e === 'boom').length;
assert(boomsAfter - boomsBefore === 1, `連按兩次只炸一次(重武器 CD 生效;實際 ${boomsAfter - boomsBefore})`);

log('— 無人機自爆(F 鍵;死亡後連按無效)—');
host.send({ t: 'detonate' });
host.send({ t: 'detonate' });
await new Promise((r) => setTimeout(r, 300));
const selfKill = host.snaps.flatMap((s) => s.ev || []).find((e) => e.e === 'die' && e.kind === 'drone');
assert(!!selfKill, '自爆擊毀自身座機(同歸於盡)');
await host.wait((c) => {
  const me = c.snaps.at(-1).ents.find((e) => e.pid === host.sync.youId);
  return me && !me.dead;
}, 5000);
assert(true, '無人機重生無冷卻(即刻歸隊)');

log('— 俯衝進兵線 → 被擊殺 → 重生 —');
host.send({ t: 'pos', x: target.x, y: 5, z: target.z, ry: 0 });
const deadSnap = await host.wait((c) => {
  const s = c.snaps.at(-1);
  const me = s.ents.find((e) => e.k === 'drone');
  return me?.dead ? s : null;
}, 30000);
assert(true, `無人機硬闖兵線被擊殺(重生倒數 ${deadSnap.ents.find((e) => e.k === 'drone').rs}s)`);
await host.wait((c) => {
  const me = c.snaps.at(-1).ents.find((e) => e.k === 'drone');
  return me && !me.dead;
}, 30000);
assert(true, '重生成功(回到主堡)');

log('— 斷線重連 —');
const token = guest.sync.token;
guest.ws.close();
await new Promise((r) => setTimeout(r, 300));
const guest2 = await client('guest2');
guest2.send({ t: 'reattach', token });
await guest2.wait((c) => c.sync);
assert(guest2.sync.lobby.clients.some((x) => x.name === '鋼鐵上校' && x.connected), '用 token 認回原座位');
assert(guest2.battleConfig != null, '重連後補收 battleConfig');

log('— 經濟:回主堡等資金 → 通用強化(火力升級隨處可買)—');
const swarmBase = snap.ents.find((e) => e.k === 'base' && e.s === 'SWARM');
const homeIv = setInterval(() => host.send({ t: 'pos', x: swarmBase.x, y: 30, z: swarmBase.z, ry: 0 }), 200);
const meOf = (c) => c.snaps.at(-1).ents.find((e) => e.pid === host.sync.youId);
const richSnap = await host.wait((c) => {
  const me = meOf(c);
  return me && me.$ >= 400 ? me : null;
}, 180000);
assert(richSnap.$ >= 400, `擊殺 + 被動收入累積資金 $${richSnap.$}`);
host.send({ t: 'buy', item: 'dmg' });
await host.wait((c) => (meOf(c)?.up?.dmg || 0) >= 1, 5000);
clearInterval(homeIv);
assert(true, '火力強化 Lv.1(快照 up 同步)');

log('— 勝負(重武器溫壓火箭高空拆堡:反建築 ×2.0 + 破甲)—');
const steelBase = snap.ents.find((e) => e.k === 'base' && e.s === 'STEEL');
const t0 = Date.now();
const iv = setInterval(() => {
  host.send({ t: 'pos', x: steelBase.x, y: 250, z: steelBase.z, ry: 0 });
  host.send({ t: 'aim', on: true });   // 重武器需瞄準模式(死亡重生會被重置,循環內重送)
  host.send({ t: 'burst', x: steelBase.x, z: steelBase.z });
}, 300);
const overSnap = await host.wait((c) => c.snaps.at(-1).over ? c.snaps.at(-1) : null, 240000);
clearInterval(iv);
assert(overSnap.winner === 'SWARM', `蜂群獲勝(${((Date.now() - t0) / 1000).toFixed(0)}s 拆完主堡)`);

log('— 回房再戰:地圖保留 —');
host.send({ t: 'backToRoom' });
await host.wait((c) => c.sync.lobby.phase === 'room');
assert(host.sync.lobby.battleConfig?.placeName === '測試戰區', '返回房間後地圖仍鎖定(不需重選)');

log('— 5v5 房:同陣營多席 + 3 線 —');
const h5 = await client('h5');
h5.send({ t: 'createRoom', name: '五五開', roomName: '大戰場', isPublic: true, teamSize: 5, battleConfig: fakeBattleConfig(3) });
await h5.wait((c) => c.sync);
const pin5 = h5.sync.lobby.pin;
const g5 = await client('g5');
g5.send({ t: 'joinRoom', pin: pin5, name: '僚機', mode: 'player' });
await g5.wait((c) => c.sync);
h5.send({ t: 'pickSide', side: 'SWARM' });
g5.send({ t: 'pickSide', side: 'SWARM' });
await h5.wait((c) => c.sync.lobby.clients.filter((x) => x.side === 'SWARM').length === 2);
assert(true, '5v5 允許兩人同選蜂群(N 席)');
h5.send({ t: 'setReady', ready: true });
g5.send({ t: 'setReady', ready: true });
await h5.wait((c) => c.sync.lobby.clients.every((x) => x.mode !== 'player' || x.ready));
h5.send({ t: 'startBattle' });
await g5.wait((c) => c.battleConfig);
h5.send({ t: 'loaded' });
g5.send({ t: 'loaded' });
await h5.wait((c) => c.snaps.length > 2, 8000);
const s5 = h5.snaps.at(-1);
// 人數不足一律補電腦到滿編:只看真人 pid(數字),電腦 pid 是 'b' 開頭字串
const drones5 = s5.ents.filter((e) => e.k === 'drone' && !String(e.pid).startsWith('b'));
const towers5 = s5.ents.filter((e) => e.k === 'tower');
assert(drones5.length === 2, `同陣營 2 位真人英雄同時在場(pid:${drones5.map((d) => d.pid).join(',')})`);
assert(towers5.length === 12, `3 線 → 防禦塔 ×12(實際 ${towers5.length})`);
h5.ws.close(); g5.ws.close();

log('— 電腦玩家(單人 + AI 對手)—');
const hb = await client('hb');
hb.send({ t: 'createRoom', name: '獨行俠', roomName: 'BOT房', isPublic: false, teamSize: 2, battleConfig: fakeBattleConfig(1) });
await hb.wait((c) => c.sync);
// 霧戰爭:觀戰者收無霧全局快照,用來驗證「敵方」bot 位置(hb 本身在自己視野外看不到對面 bot)
const hbSpec = await client('hbSpec');
hbSpec.send({ t: 'joinRoom', pin: hb.sync.lobby.pin, name: '觀戰者', mode: 'spectator' });
await hbSpec.wait((c) => c.sync);
hb.send({ t: 'pickSide', side: 'SWARM' });
hb.send({ t: 'addBot', side: 'STEEL' });
hb.send({ t: 'addBot', side: 'STEEL' });
hb.send({ t: 'addBot', side: 'STEEL' });   // 第 3 個超過 2 席應被拒
await hb.wait((c) => c.msgs.find((m) => m.t === 'error' && /已滿/.test(m.msg)));
assert(true, '電腦玩家超出席位被拒絕(2 席)');
await hb.wait((c) => c.sync.lobby.clients.filter((x) => x.isBot).length === 2);
const botsInLobby = hb.sync.lobby.clients.filter((c) => c.isBot);
assert(botsInLobby.every((b) => b.ready && b.side === 'STEEL'), `電腦玩家 ×2 進房自動就緒(${botsInLobby.map((b) => b.name).join('、')})`);
hb.send({ t: 'removeBot', id: botsInLobby[1].id });
await hb.wait((c) => c.sync.lobby.clients.filter((x) => x.isBot).length === 1);
assert(true, '房主可移除電腦玩家');
hb.send({ t: 'setReady', ready: true });
await hb.wait((c) => c.sync.lobby.clients.every((x) => x.mode !== 'player' || x.ready));
hb.send({ t: 'startBattle' });
await hb.wait((c) => c.battleConfig);
hb.send({ t: 'loaded' });   // 只需真人載入完成即可開戰(bot 不用載地形)
await hb.wait((c) => c.snaps.length > 3, 8000);
await hbSpec.wait((c) => c.snaps.length > 3, 8000);
const sb = hb.snaps.at(-1);
const sbSpec = hbSpec.snaps.at(-1);   // 無霧視角:才看得到對面(STEEL)的 bot
const botHero = sbSpec.ents.find((e) => e.k === 'robot');
assert(botHero && typeof botHero.pid === 'string' && botHero.pid.startsWith('b'), `bot 英雄在場(pid=${botHero?.pid})`);
const bp0 = { x: botHero.x, z: botHero.z };
await new Promise((r) => setTimeout(r, 3500));
const botHero2 = hbSpec.snaps.at(-1).ents.find((e) => e.k === 'robot');
const movedM = botHero2 ? Math.hypot(botHero2.x - bp0.x, botHero2.z - bp0.z) : 999;
assert(movedM > 10, `bot 沿兵線推進(3.5 秒移動 ${movedM.toFixed(0)}m)`);

log('— 防空飛彈(高空無人機被鎖定追擊)—');
const twr = sb.ents.find((e) => e.k === 'tower' && e.s === 'STEEL');
const meHp0 = sb.ents.find((e) => e.k === 'drone').hp;
const flyIv = setInterval(() => hb.send({ t: 'pos', x: twr.x, y: 120, z: twr.z, ry: 0 }), 200);
const samSnap = await hb.wait((c) => {
  const s = c.snaps.at(-1);
  return (s.sm && s.sm.length) ? s : null;
}, 12000);
assert(samSnap.sm.length > 0, `防空飛彈升空(${samSnap.sm.length} 枚,3D 追蹤中)`);
const samEv = hb.snaps.flatMap((s) => s.ev || []).find((e) => e.e === 'sam');
assert(samEv && samEv.tpid === hb.sync.youId, 'sam 事件帶鎖定目標 pid(客戶端可警告)');
await hb.wait((c) => {
  const me = c.snaps.at(-1).ents.find((e) => e.k === 'drone');
  return me && (me.hp < meHp0 || me.dead);
}, 15000);
clearInterval(flyIv);
assert(true, '飛彈/塔防命中:高空無人機受損');
const samBoom = hb.snaps.flatMap((s) => s.ev || []).find((e) => e.e === 'boom' && e.sam);
if (samBoom) assert(samBoom.y > 40, `空中近炸事件帶高度(y=${samBoom.y.toFixed?.(0) ?? samBoom.y}m,客戶端爆炸衝擊用)`);
hb.ws.close(); hbSpec.ws.close();

log(failed ? '\n❌ 有測試失敗' : '\n🎉 全部通過');
host.ws.close(); guest2.ws.close(); spec.ws.close();
process.exit(failed ? 1 : 0);
