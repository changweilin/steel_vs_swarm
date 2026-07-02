// ============ 無人戰略:鋼鐵與蜂群 — LAN 對戰伺服器 ============
// HTTP 靜態檔 + WebSocket 房間配對(架構改自 ai_tycoon/server/server.js)
// + 戰場權威模擬(server/sim.js,8Hz tick)。
import http from 'http';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { fileURLToPath } from 'url';
import { WebSocketServer } from 'ws';
import { BattleSim } from './sim.js';
import { SIDES, OTHER_SIDE, GAME } from '../public/js/data.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = path.join(__dirname, '..', 'public');

// 命令列參數:`--port 8620` 或 `--port=8620`(PowerShell 不吃 PORT=xxx 前綴)
function argVal(...names) {
  const a = process.argv.slice(2);
  for (let i = 0; i < a.length; i++) {
    for (const n of names) {
      if (a[i] === n) return a[i + 1];
      if (a[i].startsWith(n + '=')) return a[i].slice(n.length + 1);
    }
  }
  return undefined;
}
const PORT = argVal('--port', '-p') || process.env.PORT || 8620;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon', '.woff2': 'font/woff2',
  '.glb': 'model/gltf-binary', '.gltf': 'model/gltf+json', '.bin': 'application/octet-stream',
  '.mp3': 'audio/mpeg', '.ogg': 'audio/ogg', '.wav': 'audio/wav',
};

const httpServer = http.createServer((req, res) => {
  let urlPath = decodeURIComponent(req.url.split('?')[0]);
  if (urlPath === '/') urlPath = '/index.html';
  const filePath = path.join(PUBLIC_DIR, path.normalize(urlPath));
  if (!filePath.startsWith(PUBLIC_DIR)) { res.writeHead(403); res.end(); return; }
  fs.readFile(filePath, (err, data) => {
    if (err) { res.writeHead(404); res.end('404'); return; }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(filePath)] || 'application/octet-stream' });
    res.end(data);
  });
});

// ---------------- 房間管理 ----------------
/**
 * room = {
 *   pin, id, hostId, phase: 'room'|'mapselect'|'loading'|'game'|'over',
 *   config: { roomName, isPublic },
 *   clients: Map<clientId, {ws, name, side:'SWARM'|'STEEL'|null, mode:'player'|'spectator',
 *                           ready, loaded, connected, token}>,
 *   battle: BattleSim|null, battleConfig, tickTimer, snapTimer,
 * }
 */
const rooms = new Map();
let nextClientId = 1;

function genPin() {
  let pin;
  do { pin = String(Math.floor(1000 + Math.random() * 9000)); } while (rooms.has(pin));
  return pin;
}
function genRoomId() {
  let id;
  do { id = 'r' + Math.random().toString(36).slice(2, 9); } while (findRoomById(id));
  return id;
}
function findRoomById(id) {
  if (!id) return null;
  for (const r of rooms.values()) if (r.id === id) return r;
  return null;
}
function genToken() {
  return Math.random().toString(36).slice(2) + Date.now().toString(36);
}
function send(ws, msg) {
  if (ws && ws.readyState === 1) ws.send(JSON.stringify(msg));
}
function sanitizeName(s) {
  return String(s || '').replace(/[^\w一-鿿\- ]/g, '').trim().slice(0, 16) || '指揮官';
}
function hostNameOf(room) {
  const h = room.clients.get(room.hostId);
  return h ? h.name : '—';
}

function lanUrls() {
  const urls = [];
  const ifaces = os.networkInterfaces();
  for (const name in ifaces) {
    for (const i of ifaces[name]) {
      if (i.family === 'IPv4' && !i.internal) urls.push(`http://${i.address}:${PORT}`);
    }
  }
  return urls;
}

/** 大廳列表(公開房直接給 PIN 一鍵加入;私人房要輸入 PIN) */
function roomListPayload() {
  const out = [];
  for (const room of rooms.values()) {
    const isPublic = room.config.isPublic !== false;
    const players = [...room.clients.values()].filter((c) => c.mode === 'player');
    const e = {
      id: room.id, isPublic, phase: room.phase,
      name: room.config.roomName || '未命名戰區',
      players: players.length,
      spectators: room.clients.size - players.length,
      sides: {
        SWARM: players.find((c) => c.side === 'SWARM')?.name || null,
        STEEL: players.find((c) => c.side === 'STEEL')?.name || null,
      },
      host: hostNameOf(room),
      place: room.battleConfig?.placeName || null,
    };
    if (isPublic) e.pin = room.pin;
    out.push(e);
  }
  out.sort((a, b) => ((a.phase !== 'room') - (b.phase !== 'room')) || (b.isPublic - a.isPublic));
  return out;
}

/** 廣播房間(大廳/配對)狀態 */
function broadcast(room) {
  const lobby = {
    pin: room.pin, phase: room.phase, urls: lanUrls(), config: room.config,
    clients: [...room.clients.entries()].map(([id, c]) => ({
      id, name: c.name, side: c.side, mode: c.mode,
      ready: !!c.ready, loaded: !!c.loaded, isHost: id === room.hostId,
      connected: c.connected !== false,
    })),
    battleConfig: room.battleConfig || null,
  };
  for (const [id, c] of room.clients) {
    send(c.ws, { t: 'sync', youId: id, token: c.token, isHost: id === room.hostId, lobby });
  }
}

function leaveRoom(client, room, clientId) {
  room.clients.delete(clientId);
  if (room.clients.size === 0) {
    stopBattle(room);
    rooms.delete(room.pin);
    console.log(`🧹 房間 ${room.pin} 已清除`);
    return;
  }
  if (room.hostId === clientId) {
    room.hostId = [...room.clients.keys()][0];
    const h = room.clients.get(room.hostId);
    send(h.ws, { t: 'info', msg: '👑 原房主離線,你成為新房主' });
  }
  broadcast(room);
}

// ---------------- 戰鬥生命週期 ----------------
function startBattle(room) {
  if (room.battle || !room.battleConfig) return;
  room.battle = new BattleSim(room.battleConfig);
  for (const c of room.clients.values()) {
    if (c.mode === 'player' && c.side) room.battle.addHero(c.side);
  }
  room.phase = 'game';
  let last = Date.now();
  room.tickTimer = setInterval(() => {
    const now = Date.now();
    const dt = Math.min(0.5, (now - last) / 1000);
    last = now;
    room.battle.tick(dt);
    const snap = room.battle.snapshot();
    for (const c of room.clients.values()) send(c.ws, snap);
    if (room.battle.over) {
      room.phase = 'over';
      stopBattle(room, /*keepPhase*/ true);
      broadcast(room);
    }
  }, GAME.TICK_MS);
  broadcast(room);
  console.log(`⚔️ 房間 ${room.pin} 開戰:${room.battleConfig.placeName || '未知戰區'}`);
}

function stopBattle(room, keepPhase = false) {
  if (room.tickTimer) { clearInterval(room.tickTimer); room.tickTimer = null; }
  if (!keepPhase) room.battle = null;
}

/** 雙方玩家都載入完地形 → 開戰(單人測試:一個玩家也可開) */
function maybeLaunch(room) {
  if (room.phase !== 'loading') return;
  const players = [...room.clients.values()].filter((c) => c.mode === 'player' && c.side);
  if (players.length > 0 && players.every((c) => c.loaded)) startBattle(room);
}

// ---------------- WebSocket ----------------
const wss = new WebSocketServer({ server: httpServer });

wss.on('connection', (ws) => {
  const clientId = nextClientId++;
  let room = null;
  let client = null;

  ws.on('message', (raw) => {
    let m;
    try { m = JSON.parse(raw); } catch { return; }

    // ---- 大廳 ----
    if (m.t === 'createRoom') {
      const pin = genPin();
      client = { ws, name: sanitizeName(m.name), side: null, mode: 'player', ready: false, loaded: false, connected: true, token: genToken() };
      room = {
        pin, id: genRoomId(), hostId: clientId, phase: 'room',
        config: { roomName: sanitizeName(m.roomName) || `${client.name} 的戰區`, isPublic: m.isPublic !== false },
        clients: new Map([[clientId, client]]),
        battle: null, battleConfig: null, tickTimer: null,
      };
      rooms.set(pin, room);
      console.log(`🏠 建立房間 ${pin}(${room.config.roomName})`);
      broadcast(room);
      return;
    }
    if (m.t === 'listRooms') { send(ws, { t: 'rooms', rooms: roomListPayload() }); return; }
    if (m.t === 'joinRoom') {
      const r = rooms.get(String(m.pin));
      if (!r) { send(ws, { t: 'error', msg: '找不到房間,確認 PIN 是否正確' }); return; }
      const mode = m.mode === 'spectator' ? 'spectator' : 'player';
      const players = [...r.clients.values()].filter((c) => c.mode === 'player').length;
      if (mode === 'player' && players >= 2) { send(ws, { t: 'error', msg: '兩個陣營都有指揮官了,可用觀戰模式加入' }); return; }
      client = { ws, name: sanitizeName(m.name), side: null, mode, ready: false, loaded: false, connected: true, token: genToken() };
      room = r;
      room.clients.set(clientId, client);
      broadcast(room);
      // 加入中途對局:立即補送階段與戰場設定
      if (room.phase === 'game' || room.phase === 'loading') {
        send(ws, { t: 'battleConfig', config: room.battleConfig });
      }
      return;
    }
    if (m.t === 'reattach') {
      // 斷線重連:用 token 認回原座位
      for (const r of rooms.values()) {
        for (const [id, c] of r.clients) {
          if (c.token === m.token) {
            c.ws = ws; c.connected = true;
            room = r; client = c;
            broadcast(room);
            if (room.battleConfig && (room.phase === 'loading' || room.phase === 'game')) {
              send(ws, { t: 'battleConfig', config: room.battleConfig });
            }
            return;
          }
        }
      }
      send(ws, { t: 'error', msg: '重連失敗:座位已失效,請重新加入' });
      return;
    }

    if (!room || !client) return;

    // ---- 房間配對 ----
    if (m.t === 'pickSide') {
      const side = m.side === 'SWARM' || m.side === 'STEEL' ? m.side : null;
      if (client.mode !== 'player') { send(ws, { t: 'error', msg: '觀戰者不能選陣營' }); return; }
      if (side) {
        const taken = [...room.clients.values()].some((c) => c !== client && c.side === side);
        if (taken) { send(ws, { t: 'error', msg: `${SIDES[side].name} 已被選走` }); return; }
      }
      client.side = side;
      client.ready = false;
      broadcast(room);
      return;
    }
    if (m.t === 'setReady') { client.ready = !!m.ready; broadcast(room); return; }
    if (m.t === 'setRoomConfig' && clientId === room.hostId) {
      if (m.roomName !== undefined) room.config.roomName = sanitizeName(m.roomName);
      if (m.isPublic !== undefined) room.config.isPublic = !!m.isPublic;
      broadcast(room);
      return;
    }
    if (m.t === 'startSetup') {
      // 房主啟動戰場選址:至少 1 位已選陣營並準備(單人=練習模式)
      if (clientId !== room.hostId) { send(ws, { t: 'error', msg: '只有房主能啟動選址' }); return; }
      const players = [...room.clients.values()].filter((c) => c.mode === 'player' && c.side);
      if (players.length === 0) { send(ws, { t: 'error', msg: '請先選擇陣營' }); return; }
      if (!players.every((c) => c.ready)) { send(ws, { t: 'error', msg: '還有指揮官未按「準備完成」' }); return; }
      room.phase = 'mapselect';
      broadcast(room);
      return;
    }
    if (m.t === 'mapProgress' && clientId === room.hostId) {
      // 選址進度轉播給其他人(候選點/搜尋進度)
      for (const [id, c] of room.clients) if (id !== clientId) send(c.ws, m);
      return;
    }
    if (m.t === 'battleConfig' && clientId === room.hostId) {
      // 房主完成選址:驗證幾何條件後鎖定戰場
      const cfg = m.config;
      if (!cfg || !cfg.bases || !Array.isArray(cfg.lanes) || cfg.lanes.length !== 3) {
        send(ws, { t: 'error', msg: '戰場設定不完整' });
        return;
      }
      if (!(cfg.distM >= cfg.diagM * 0.8)) {
        send(ws, { t: 'error', msg: `主堡距離 ${Math.round(cfg.distM)}m 未達地圖對角線 80%(${Math.round(cfg.diagM * 0.8)}m)` });
        return;
      }
      room.battleConfig = cfg;
      room.phase = 'loading';
      for (const c of room.clients.values()) { c.loaded = false; send(c.ws, { t: 'battleConfig', config: cfg }); }
      broadcast(room);
      return;
    }
    if (m.t === 'loaded') { client.loaded = true; broadcast(room); maybeLaunch(room); return; }

    // ---- 戰鬥中 ----
    const b = room.battle;
    if (!b) {
      if (m.t === 'leaveRoom') { leaveRoom(client, room, clientId); room = null; client = null; }
      return;
    }
    if (m.t === 'pos' && client.side) { b.heroPos(client.side, m.x, m.y, m.z, m.ry); return; }
    if (m.t === 'hit' && client.side) { b.heroHit(client.side, m.id); return; }
    if (m.t === 'burst' && client.side) { b.heroBurst(client.side, m.x, m.z); return; }
    if (m.t === 'tracer') {
      // 純視覺:轉播給其他客戶端畫彈道
      for (const [id, c] of room.clients) if (id !== clientId) send(c.ws, { t: 'tracer', from: m.from, to: m.to, side: client.side });
      return;
    }
    if (m.t === 'backToRoom' && clientId === room.hostId) {
      stopBattle(room);
      room.battle = null; room.battleConfig = null; room.phase = 'room';
      for (const c of room.clients.values()) { c.ready = false; c.loaded = false; }
      broadcast(room);
      return;
    }
    if (m.t === 'leaveRoom') { leaveRoom(client, room, clientId); room = null; client = null; }
  });

  ws.on('close', () => {
    if (!room || !client) return;
    client.connected = false;
    // 對局中保留座位等重連;房間階段直接離座
    if (room.phase === 'room') {
      leaveRoom(client, room, clientId);
    } else {
      broadcast(room);
      // 10 分鐘沒回來就清位
      setTimeout(() => {
        if (client.connected === false && room.clients.get(clientId) === client) {
          leaveRoom(client, room, clientId);
        }
      }, 10 * 60 * 1000);
    }
  });
});

httpServer.listen(PORT, () => {
  console.log('==============================================');
  console.log('  無人戰略:鋼鐵與蜂群  Drone Tactics: Steel vs. Swarm');
  console.log(`  本機:  http://localhost:${PORT}`);
  for (const u of lanUrls()) console.log(`  區網:  ${u}`);
  console.log('==============================================');
});
