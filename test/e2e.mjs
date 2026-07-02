// 端對端測試:兩位玩家 → 建房/加入 → 選陣營 → 準備 → 選址 → 載入 → 開戰快照 → 命中 → 勝負
import WebSocket from 'ws';

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

// 模擬戰場設定(合成兵線;台北 101 附近,距離 4.8km)
function fakeBattleConfig() {
  const A = [25.0330, 121.5654];
  const D = 4800, R = 6371000;
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
  const sizeM = D / (0.85 * Math.SQRT2);
  return {
    center: { lat: mid[0], lng: mid[1] },
    bases: { SWARM: A, STEEL: B },
    lanes: [mkLane(1440), mkLane(0), mkLane(-1440)],
    sizeM, diagM: sizeM * Math.SQRT2, distM: D,
    maxOverlap: 0.05, synthetic: true, placeName: '測試戰區',
  };
}

const host = await client('host');
log('— 建立房間 —');
host.send({ t: 'createRoom', name: '蜂群女王', roomName: '測試戰區', isPublic: true });
await host.wait((c) => c.sync);
const pin = host.sync.lobby.pin;
assert(/^\d{4}$/.test(pin), `取得 PIN:${pin}`);
assert(host.sync.isHost === true, '建房者是房主');

log('— 房間列表 —');
const lurker = await client('lurker');
lurker.send({ t: 'listRooms' });
const roomsMsg = await lurker.wait((c) => c.msgs.find((m) => m.t === 'rooms'));
assert(roomsMsg.rooms.length === 1 && roomsMsg.rooms[0].pin === pin, '大廳列表含公開房與 PIN');
lurker.ws.close();

log('— 加入 + 選陣營 —');
const guest = await client('guest');
guest.send({ t: 'joinRoom', pin, name: '鋼鐵上校', mode: 'player' });
await guest.wait((c) => c.sync);
host.send({ t: 'pickSide', side: 'SWARM' });
guest.send({ t: 'pickSide', side: 'STEEL' });
await host.wait((c) => c.sync.lobby.clients.filter((x) => x.side).length === 2);
assert(true, '雙方各佔一個陣營');
// 搶同陣營要被拒絕
guest.send({ t: 'pickSide', side: 'SWARM' });
await guest.wait((c) => c.msgs.find((m) => m.t === 'error' && /已被選走/.test(m.msg)));
assert(true, '搶已佔用陣營被拒絕');
guest.send({ t: 'pickSide', side: 'STEEL' });

log('— 準備 + 進入選址 —');
host.send({ t: 'setReady', ready: true });
guest.send({ t: 'setReady', ready: true });
await host.wait((c) => c.sync.lobby.clients.every((x) => x.mode !== 'player' || x.ready));
host.send({ t: 'startSetup' });
await guest.wait((c) => c.sync.lobby.phase === 'mapselect');
assert(true, '進入 mapselect 階段');

log('— 距離驗證(過短要被拒)—');
const bad = fakeBattleConfig();
bad.distM = bad.diagM * 0.5;
host.send({ t: 'battleConfig', config: bad });
await host.wait((c) => c.msgs.find((m) => m.t === 'error' && /80%/.test(m.msg)));
assert(true, '未達對角線 80% 被伺服器拒絕');

log('— 提交合法戰場 → loading —');
host.send({ t: 'battleConfig', config: fakeBattleConfig() });
await guest.wait((c) => c.battleConfig);
assert(guest.battleConfig.placeName === '測試戰區', '雙方收到 battleConfig');

log('— 雙方載入完成 → 開戰 —');
host.send({ t: 'loaded' });
guest.send({ t: 'loaded' });
await host.wait((c) => c.snaps.length > 3, 8000);
const snap = host.snaps.at(-1);
const bases = snap.ents.filter((e) => e.k === 'base');
const towers = snap.ents.filter((e) => e.k === 'tower');
const heroes = snap.ents.filter((e) => e.k === 'drone' || e.k === 'robot');
assert(bases.length === 2, `主堡 ×2(hp=${bases[0]?.hp})`);
assert(towers.length === 12, `防禦塔 ×12(實際 ${towers.length})`);
assert(heroes.length === 2, `英雄 ×2(${heroes.map((h) => h.k).join(',')})`);

log('— 等第一波兵線 —');
const snapWave = await host.wait((c) => {
  const s = c.snaps.at(-1);
  return s.ents.some((e) => e.k === 'soldier') ? s : null;
}, 15000);
const creeps = snapWave.ents.filter((e) => ['soldier', 'apc', 'tank'].includes(e.k));
assert(creeps.length === 30, `第一波小兵 30 隻(3線×2方×5;實際 ${creeps.length})`);

log('— 英雄移動 + 射擊 —');
// 無人機在敵兵上空 200m 巡航(小兵射程外)攻擊
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

log('— 範圍技冷卻 —');
host.send({ t: 'burst', x: target.x, z: target.z });
host.send({ t: 'burst', x: target.x, z: target.z });
await new Promise((r) => setTimeout(r, 300));
const booms = host.snaps.flatMap((s) => s.ev || []).filter((e) => e.e === 'boom');
assert(booms.length === 1, `連按兩次範圍技只爆一次(實際 ${booms.length})`);

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

log('— 勝負(高空圍攻敵方主堡)—');
// 無人機在敵方主堡上空 200m(塔射程外)狂轟;沒有己方小兵在場 → 吃 65% 減傷,
// 同時每 6.5s 用一次空投炸彈。預期 1~2 分鐘拆完。
const steelBase = snap.ents.find((e) => e.k === 'base' && e.s === 'STEEL');
const t0 = Date.now();
const iv = setInterval(() => {
  host.send({ t: 'pos', x: steelBase.x, y: 250, z: steelBase.z, ry: 0 });
  host.send({ t: 'hit', id: steelBase.id });
}, 100);
const ivB = setInterval(() => host.send({ t: 'burst', x: steelBase.x, z: steelBase.z }), 6500);
const overSnap = await host.wait((c) => c.snaps.at(-1).over ? c.snaps.at(-1) : null, 150000);
clearInterval(iv); clearInterval(ivB);
assert(overSnap.winner === 'SWARM', `蜂群獲勝(${((Date.now() - t0) / 1000).toFixed(0)}s 拆完主堡)`);

log(failed ? '\n❌ 有測試失敗' : '\n🎉 全部通過');
host.ws.close(); guest2.ws.close();
process.exit(failed ? 1 : 0);
