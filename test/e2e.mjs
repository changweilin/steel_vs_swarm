// 端對端測試:sim 直測(地雷/彈夾/克制/自爆/商店/防空伏擊)
//            → 開房前選圖 → 建房(含隊伍規模/環境)→ 選陣營(N 席)
//            → 準備 → 開戰載入 → 快照 → 命中 → 經濟購買 → 勝負 → 回房保留地圖
import WebSocket from 'ws';
import { BattleSim } from '../server/sim.js';
import { UNITS, WEAPONS, ECON, GAME } from '../public/js/data.js';

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
log('— sim:地雷佈設(非正規路線)+ 機甲踩雷 —');
{
  const sim = new BattleSim(fakeBattleConfig(1));
  assert(sim.mines.length >= 20, `地雷 ${sim.mines.length} 顆(目標 ${GAME.MINES.PER_LANE}/線)`);
  assert(sim.mines.every(([x, z]) => sim._distToLanes(x, z) >= GAME.MINES.LANE_CLEAR), '雷區避開兵線走廊');
  const rb = sim.addHero('STEEL', 'p_r');
  const nMines = sim.mines.length;
  [rb.x, rb.z] = sim.mines[0];
  sim.tick(0.125);
  assert(rb.hp < rb.maxHp && sim.mines.length === nMines - 1,
    `機甲踩雷受創(${rb.maxHp} → ${Math.round(rb.hp)},雷被消耗)`);
  assert(sim.events.some((e) => e.e === 'boom' && e.mine && e.tpid === 'p_r'), '地雷爆炸事件帶 tpid');

  log('— sim:武器克制(rgun vs 肉體 ×1.3)+ 彈夾上限 —');
  const dummy = sim._add({ kind: 'soldier', side: 'SWARM', x: rb.x + 10, z: rb.z, hp: UNITS.soldier.hp });
  sim.t += 1;   // 越過射速下限
  sim.heroHit('p_r', dummy.id);
  assert(Math.abs((UNITS.soldier.hp - dummy.hp) - 26 * 1.3) < 0.5,
    `克制傷害 ${(UNITS.soldier.hp - dummy.hp).toFixed(1)}(= 26 × 肉體 1.3)`);
  sim.ents.delete(dummy.id);   // 測試假人沒有 lane,tick 前先移除
  const tw = [...sim.ents.values()].find((e) => e.kind === 'tower' && e.side === 'SWARM');
  rb.x = tw.x + 30; rb.z = tw.z;
  rb.ammo = {}; rb.fireAt = {}; rb.reloadUntil = {};   // 重置彈藥計數
  const hp0t = tw.hp;
  for (let i = 0; i < 60; i++) { sim.t += 0.16; sim.heroHit('p_r', tw.id); }
  const magDmg = hp0t - tw.hp;
  assert(Math.abs(magDmg - 48 * 26 * 0.6) < 1,
    `60 連發只吃進一個彈夾 48 發 × 建築 0.6(傷害 ${magDmg.toFixed(1)},其餘填彈中被拒)`);

  log('— sim:無人機重型炸彈自爆 + 無冷卻重生 —');
  const dr = sim.addHero('SWARM', 'p_d');
  const victim = sim._add({ kind: 'soldier', side: 'STEEL', x: dr.x + 6, z: dr.z, hp: UNITS.soldier.hp });
  dr.y = 4;
  const $kill0 = dr.money;
  sim.heroDetonate('p_d');
  assert(!sim.ents.has(victim.id), '自爆(240 × 肉體 1.5)炸死近旁敵兵');
  assert(dr.dead, '自爆座機同歸於盡');
  assert(dr.money - $kill0 >= ECON.BOUNTY.soldier, `擊殺得賞金 +$${Math.round(dr.money - $kill0)}`);
  sim.tick(0.05);
  assert(!dr.dead, '無人機重生無冷卻(下一 tick 即歸隊)');
  assert(UNITS.robot.respawn.base > 0, '機甲重生有冷卻(數值檢查)');

  log('— sim:軍械庫(升級隨處買 / 熱兵器限主堡 / 槽位)—');
  dr.money = 1000;
  assert(sim.buy('p_d', 'railgun') === null && dr.items.includes('railgun') && dr.money === 600,
    '主堡購入磁軌狙擊砲($400)');
  assert(/已擁有/.test(sim.buy('p_d', 'railgun') || ''), '重複購買被拒');
  assert(/槽/.test(sim.buy('p_d', 'flak') || ''), '超出武器槽被拒(無人機 1 槽)');
  assert(sim.buy('p_d', 'dmg') === null && dr.upg.dmg === 1, '火力升級 Lv.1(隨處可買)');
  const rb2 = sim.addHero('STEEL', 'p_r2');
  rb2.money = 999; rb2.x += 400;
  assert(/主堡/.test(sim.buy('p_r2', 'flak') || ''), '離開主堡買熱兵器被拒');
  assert(sim.buy('p_r2', 'hull') === null && rb2.maxHp > UNITS.robot.hp,
    `裝甲升級隨處可買(HP 上限 ${UNITS.robot.hp} → ${rb2.maxHp})`);

  log('— sim:非正規路線防空伏擊 + 飛彈可破壞 —');
  const mid = sim.lanes[0][Math.floor(sim.lanes[0].length / 2)];
  dr.x = mid[0] + 200; dr.z = mid[1]; dr.y = 10;       // 低空也躲不過伏擊
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
const snap = host.snaps.at(-1);
const bases = snap.ents.filter((e) => e.k === 'base');
const towers = snap.ents.filter((e) => e.k === 'tower');
const heroes = snap.ents.filter((e) => e.k === 'drone' || e.k === 'robot');
assert(bases.length === 2, `主堡 ×2(hp=${bases[0]?.hp})`);
assert(towers.length === 4, `防禦塔 ×4(1 線 × 2 位置 × 2 方;實際 ${towers.length})`);
assert(heroes.length === 2, `英雄 ×2(${heroes.map((h) => h.k).join(',')})`);
const myHero = heroes.find((h) => h.pid === host.sync.youId);
assert(myHero && myHero.k === 'drone', `英雄快照帶 pid,能認出自己的座機(pid=${myHero?.pid})`);
assert(typeof myHero.$ === 'number' && Array.isArray(myHero.it), `英雄快照帶金錢/武器欄($${myHero.$})`);

log('— 等第一波兵線 —');
const snapWave = await host.wait((c) => {
  const s = c.snaps.at(-1);
  return s.ents.some((e) => e.k === 'soldier') ? s : null;
}, 15000);
const creeps = snapWave.ents.filter((e) => ['soldier', 'apc', 'tank'].includes(e.k));
assert(creeps.length === 10, `第一波小兵 10 隻(1線×2方×5;實際 ${creeps.length})`);

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
const t3 = after.ents.find((e) => e.k === 'apc' && e.s === 'STEEL');
if (t3) {
  host.send({ t: 'pos', x: t3.x, y: 250, z: t3.z, ry: 0 });
  await new Promise((r) => setTimeout(r, 250));
  const before = (host.snaps.at(-1).ents.find((e) => e.id === t3.id) || {}).hp ?? t3.hp;
  for (let i = 0; i < 50; i++) host.send({ t: 'hit', id: t3.id });
  await new Promise((r) => setTimeout(r, 400));
  const nowT = host.snaps.at(-1).ents.find((e) => e.id === t3.id);
  const dmgDone = before - (nowT ? nowT.hp : 0);
  assert(dmgDone < 16 * 10, `50 連發只吃進 ${dmgDone} 傷害(限速生效)`);
}

log('— 無人機右鍵 = 重型炸彈原地自爆(死亡後連按無效)—');
host.send({ t: 'burst', x: target.x, z: target.z });
host.send({ t: 'burst', x: target.x, z: target.z });
await new Promise((r) => setTimeout(r, 300));
const booms = host.snaps.flatMap((s) => s.ev || []).filter((e) => e.e === 'boom');
assert(booms.length === 1, `連按兩次只爆一次(自爆後座機已毀;實際 ${booms.length})`);
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

log('— 經濟:回主堡等資金 → 購入攻城榴彈砲(反建築 ×2.2)—');
const swarmBase = snap.ents.find((e) => e.k === 'base' && e.s === 'SWARM');
const homeIv = setInterval(() => host.send({ t: 'pos', x: swarmBase.x, y: 30, z: swarmBase.z, ry: 0 }), 200);
const meOf = (c) => c.snaps.at(-1).ents.find((e) => e.pid === host.sync.youId);
const richSnap = await host.wait((c) => {
  const me = meOf(c);
  return me && me.$ >= 400 ? me : null;
}, 180000);
assert(richSnap.$ >= 400, `擊殺 + 被動收入累積資金 $${richSnap.$}`);
host.send({ t: 'buy', item: 'siege' });
await host.wait((c) => meOf(c)?.it?.includes('siege'), 5000);
clearInterval(homeIv);
assert(true, '主堡軍械庫購入攻城榴彈砲(快照 it 同步)');

log('— 勝負(反建築武器高空拆堡)—');
const steelBase = snap.ents.find((e) => e.k === 'base' && e.s === 'STEEL');
const t0 = Date.now();
const iv = setInterval(() => {
  host.send({ t: 'pos', x: steelBase.x, y: 250, z: steelBase.z, ry: 0 });
  host.send({ t: 'hit', id: steelBase.id, w: 'siege' });
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
const drones5 = s5.ents.filter((e) => e.k === 'drone');
const towers5 = s5.ents.filter((e) => e.k === 'tower');
assert(drones5.length === 2, `同陣營 2 位英雄同時在場(pid:${drones5.map((d) => d.pid).join(',')})`);
assert(towers5.length === 12, `3 線 → 防禦塔 ×12(實際 ${towers5.length})`);
h5.ws.close(); g5.ws.close();

log('— 電腦玩家(單人 + AI 對手)—');
const hb = await client('hb');
hb.send({ t: 'createRoom', name: '獨行俠', roomName: 'BOT房', isPublic: false, teamSize: 2, battleConfig: fakeBattleConfig(1) });
await hb.wait((c) => c.sync);
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
const sb = hb.snaps.at(-1);
const botHero = sb.ents.find((e) => e.k === 'robot');
assert(botHero && typeof botHero.pid === 'string' && botHero.pid.startsWith('b'), `bot 英雄在場(pid=${botHero?.pid})`);
const bp0 = { x: botHero.x, z: botHero.z };
await new Promise((r) => setTimeout(r, 3500));
const botHero2 = hb.snaps.at(-1).ents.find((e) => e.k === 'robot');
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
hb.ws.close();

log(failed ? '\n❌ 有測試失敗' : '\n🎉 全部通過');
host.ws.close(); guest2.ws.close();
process.exit(failed ? 1 : 0);
