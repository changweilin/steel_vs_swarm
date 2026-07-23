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
import { BotBrain } from './bots.js';
import { SIDES, GAME, TEAM, BOT_NAMES, CHARACTERS, charsOf, lanesFor, resolveEnv, BOT_DIFF, DEFAULT_BOT_DIFF, MAPGEO, towerLayoutAudit, laneSeparationAudit } from '../public/js/data.js';

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
    // 開發用靜態伺服器:一律 no-cache,瀏覽器每次重新驗證 → 改了客戶端(game.js/biomes.js…)
    // 普通 F5 就拿得到新碼,免「改了沒效其實是快取舊檔」的假象(前科:防穿模修好了但玩家看舊版)。
    res.writeHead(200, {
      'Content-Type': MIME[path.extname(filePath)] || 'application/octet-stream',
      'Cache-Control': 'no-cache, must-revalidate',
    });
    res.end(data);
  });
});

// ---------------- 房間管理 ----------------
/**
 * room = {
 *   pin, id, hostId, phase: 'room'|'loading'|'game'|'over',
 *   config: { roomName, isPublic, teamSize },   // 每陣營 teamSize 席(1~5)
 *   clients: Map<clientId, {ws, name, side:'SWARM'|'STEEL'|null, mode:'player'|'spectator',
 *                           ready, loaded, connected, token}>,
 *   bots: Map<botId('b1'...), {name, side}>,   // 電腦玩家(房主增減,佔正式席位)
 *   battleConfig,          // 開房時就鎖定(地圖在開房前建立/選好)
 *   battle: BattleSim|null, botBrains: BotBrain[], tickTimer,
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
/** 某陣營已佔席位數(真人 + 電腦) */
function sideCount(room, side) {
  return [...room.clients.values()].filter((c) => c.side === side).length
    + [...room.bots.values()].filter((b) => b.side === side).length;
}

/** 在指定陣營補一名電腦玩家(已滿則不動作) */
function addBotToSide(room, side) {
  if (sideCount(room, side) >= room.config.teamSize) return false;
  const id = 'b' + (++room.nextBotId);
  const used = new Set([...room.bots.values()].map((b) => b.name));
  const name = BOT_NAMES.find((n) => !used.has(n)) || `AI-${room.nextBotId}`;
  room.bots.set(id, { name, side });
  return true;
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
      teamSize: room.config.teamSize,
      players: players.length,
      spectators: room.clients.size - players.length,
      sides: {
        SWARM: players.filter((c) => c.side === 'SWARM').map((c) => c.name)
          .concat([...room.bots.values()].filter((b) => b.side === 'SWARM').map((b) => `🤖${b.name}`)),
        STEEL: players.filter((c) => c.side === 'STEEL').map((c) => c.name)
          .concat([...room.bots.values()].filter((b) => b.side === 'STEEL').map((b) => `🤖${b.name}`)),
      },
      host: hostNameOf(room),
      place: room.battleConfig?.placeName || null,
      env: room.battleConfig?.env || null,
    };
    if (isPublic) e.pin = room.pin;
    out.push(e);
  }
  out.sort((a, b) => ((a.phase !== 'room') - (b.phase !== 'room')) || (b.isPublic - a.isPublic));
  return out;
}

/** 開房前的戰場設定驗證:回傳錯誤訊息或 null */
// 兵線(lat/lng)→ 遊戲公尺(原點任取,towerLayoutAudit 只用相對距離)。與 mapSelect / 烘焙同一換算。
const EARTH_M = 6371000, SC_GAME = 1 / MAPGEO.REAL_SCALE;
function lanesToGame(lanes) {
  const o = lanes[0]?.[0];
  if (!o) return null;
  const cosO = Math.cos(o[0] * Math.PI / 180);
  return lanes.map((lane) => lane.map(([lat, lng]) => [
    (lng - o[1]) * Math.PI / 180 * EARTH_M * cosO * SC_GAME,
    (lat - o[0]) * Math.PI / 180 * EARTH_M * SC_GAME,
  ]));
}

function validateBattleConfig(cfg, teamSize) {
  const L = lanesFor(teamSize);
  if (!cfg || !cfg.bases || !cfg.center || !Array.isArray(cfg.lanes)) return '戰場設定不完整,請先建立/選擇地圖';
  if (cfg.lanes.length !== L) return `隊伍 ${teamSize}v${teamSize} 需要 ${L} 條兵線(收到 ${cfg.lanes.length} 條)`;
  if (!(cfg.distM >= cfg.diagM * 0.8)) {
    return `主堡距離 ${Math.round(cfg.distM)}m 未達地圖對角線 80%(${Math.round(cfg.diagM * 0.8)}m)`;
  }
  // 規則 #4(權威把關):此兵線幾何佈出的砲塔會殘餘 >80% 重疊或疊塔 → 拒絕(自訂/預設同標準;客戶端掃描已預濾)
  const game = lanesToGame(cfg.lanes);
  if (!game || !towerLayoutAudit(game).ok) return '此地圖的兵線幾何無法符合砲塔佈局規則(砲塔射程重疊 >80% 或重疊),請改選其他推薦點或位置';
  // 規則(權威把關):同一 L 內兵線互不接觸/交叉(任兩線中段最近距離須 ≥ 20m 真實;含立體交叉亦禁)
  if (!laneSeparationAudit(game).ok) return '此地圖的兵線互相接觸或交叉(任兩線最近距離須 ≥ 20m),請改選其他推薦點或位置';
  return null;
}

/** 廣播房間(大廳/配對)狀態 */
function broadcast(room) {
  const lobby = {
    pin: room.pin, phase: room.phase, urls: lanUrls(), config: room.config,
    clients: [...room.clients.entries()].map(([id, c]) => ({
      id, name: c.name, side: c.side, mode: c.mode, ch: c.ch || null,
      ready: !!c.ready, loaded: !!c.loaded, isHost: id === room.hostId,
      connected: c.connected !== false,
    })).concat([...room.bots.entries()].map(([id, b]) => ({
      id, name: b.name, side: b.side, mode: 'player', ch: b.ch || null,
      ready: true, loaded: true, isHost: false, connected: true, isBot: true,
    }))),
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
  // world 於構造時傳入 → 水沼粗網格在初次佈點前就緒(中立單位一開始就避開水沼);LOS/走廊淨空仍走下方 setWorld。
  room.battle = new BattleSim(room.battleConfig, room.world || null);
  // 世界障礙(房主載圖時上傳,存房間一份 → rematch 直接沿用):
  // MUST 在 fieldPayload 廣播之前套用 —— 走廊淨空會清掉隧道/橋下的第三方障礙與地雷。
  if (room.world) room.battle.setWorld(room.world);
  // 角色指派:玩家已選的優先;沒選(默認隨機)由 addHero 抽同陣營未用角色
  for (const [id, c] of room.clients) {
    if (c.mode === 'player' && c.side) {
      const h = room.battle.addHero(c.side, id, c.ch);
      c.ch = h.ch;   // 回寫實際角色(隨機結果),lobby 廣播給全員看
    }
  }
  // 電腦玩家:伺服器端 AI 操控英雄,兵線輪流指派(NPC 路線 = 房間兵線)
  room.botBrains = [...room.bots.entries()].map(([bid, b], i) => {
    const h = room.battle.addHero(b.side, bid, b.ch);
    b.ch = h.ch;
    return new BotBrain(room.battle, bid, b.side, i, room.config.botDiff);
  });
  room.phase = 'game';
  // 危險區靜態資料(地雷位置等)只發一次;快照不帶,雙方都要「用眼睛掃雷」
  const field = room.battle.fieldPayload();
  for (const c of room.clients.values()) send(c.ws, field);
  let last = Date.now();
  room.tickTimer = setInterval(() => {
    const now = Date.now();
    const dt = Math.min(0.5, (now - last) / 1000);
    last = now;
    for (const brain of room.botBrains) brain.update(dt);
    room.battle.tick(dt);
    // 霧戰爭:各陣營依己方視野收到不同過濾後的快照;觀戰者收無霧全局快照
    const snaps = {
      SWARM: room.battle.snapshotFor('SWARM'),
      STEEL: room.battle.snapshotFor('STEEL'),
      all: room.battle.snapshotFor(null),
    };
    for (const c of room.clients.values()) send(c.ws, snaps[c.side] || snaps.all);
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
  room.botBrains = [];
  if (!keepPhase) room.battle = null;
}

/** 雙方玩家都載入完地形 → 開戰(單人測試:一個玩家也可開) */
function maybeLaunch(room) {
  if (room.phase !== 'loading') return;
  const players = [...room.clients.values()].filter((c) => c.mode === 'player' && c.side);
  if (players.length > 0 && players.every((c) => c.loaded)) startBattle(room);
}

// ---------------- WebSocket ----------------
// maxPayload 1MiB:最大合法訊息 = world 障礙上傳(occ 4000 + cor 2400 ≈ 250KB,留 4 倍餘裕)。
// ws 預設 100MiB —— 惡意巨型訊息會讓單執行緒 JSON.parse 阻塞全部房間,先在框架層封頂。
const wss = new WebSocketServer({ server: httpServer, maxPayload: 1 << 20 });

wss.on('connection', (ws) => {
  const clientId = nextClientId++;
  let room = null;
  let client = null;

  ws.on('message', (raw) => {
    let m;
    try { m = JSON.parse(raw); } catch { return; }

    // ---- 大廳 ----
    if (m.t === 'createRoom') {
      // 地圖在開房前就要建立/選擇好:createRoom 必須帶合法 battleConfig
      const teamSize = Math.max(TEAM.MIN, Math.min(TEAM.MAX, Math.round(m.teamSize) || TEAM.DEFAULT));
      const cfg = m.battleConfig;
      const err = validateBattleConfig(cfg, teamSize);
      if (err) { send(ws, { t: 'error', msg: err }); return; }
      cfg.env = resolveEnv(cfg.env || {});   // 隨機項在此定案,全房共用同一組環境
      // 地圖雙邊位置陣營隨機(2026-07-21):50% 機率對調兩主堡的陣營歸屬。同步反轉每條兵線的點序,
      // 維持 sim 約定「lane[0]≈bases.SWARM 主堡端」;反轉+換標只變點序不動幾何 → 兵線分離/塔位稽核不受影響。
      // 伺服器定案一次、隨 battleConfig 廣播全房 → 地形/出生/小地圖全客戶端一致。
      if (Math.random() < 0.5) {
        const t = cfg.bases.SWARM; cfg.bases.SWARM = cfg.bases.STEEL; cfg.bases.STEEL = t;
        cfg.lanes = cfg.lanes.map((l) => l.slice().reverse());
      }
      cfg.teamSize = teamSize;
      const pin = genPin();
      client = { ws, name: sanitizeName(m.name), side: null, mode: 'player', ready: false, loaded: false, connected: true, token: genToken() };
      room = {
        pin, id: genRoomId(), hostId: clientId, phase: 'room',
        config: { roomName: sanitizeName(m.roomName) || `${client.name} 的戰區`, isPublic: m.isPublic !== false, teamSize, botDiff: BOT_DIFF[m.botDiff] ? m.botDiff : DEFAULT_BOT_DIFF },
        clients: new Map([[clientId, client]]),
        bots: new Map(), nextBotId: 0, botBrains: [],
        battle: null, battleConfig: cfg, tickTimer: null,
      };
      rooms.set(pin, room);
      console.log(`🏠 建立房間 ${pin}(${room.config.roomName}・${teamSize}v${teamSize}・${cfg.placeName || '未知戰區'})`);
      broadcast(room);
      return;
    }
    if (m.t === 'listRooms') { send(ws, { t: 'rooms', rooms: roomListPayload() }); return; }
    if (m.t === 'joinRoom') {
      const r = rooms.get(String(m.pin));
      if (!r) { send(ws, { t: 'error', msg: '找不到房間,確認 PIN 是否正確' }); return; }
      const mode = m.mode === 'spectator' ? 'spectator' : 'player';
      const players = [...r.clients.values()].filter((c) => c.mode === 'player').length + r.bots.size;
      const cap = r.config.teamSize * 2;
      if (mode === 'player' && players >= cap) { send(ws, { t: 'error', msg: `參戰席位已滿(${cap} 人),可用觀戰模式加入` }); return; }
      client = { ws, name: sanitizeName(m.name), side: null, mode, ready: false, loaded: false, connected: true, token: genToken() };
      room = r;
      room.clients.set(clientId, client);
      broadcast(room);
      // 加入中途對局:立即補送階段與戰場設定(含危險區)
      if (room.phase === 'game' || room.phase === 'loading') {
        send(ws, { t: 'battleConfig', config: room.battleConfig });
        if (room.battle) send(ws, room.battle.fieldPayload());
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
              if (room.battle) send(ws, room.battle.fieldPayload());
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
      if (side && side !== client.side) {
        const n = sideCount(room, side) - (client.side === side ? 1 : 0);
        if (n >= room.config.teamSize) { send(ws, { t: 'error', msg: `${SIDES[side].name} 已滿(${room.config.teamSize} 席)` }); return; }
      }
      client.side = side;
      client.ready = false;
      client.ch = null;   // 換陣營:角色重選(角色綁陣營)
      broadcast(room);
      return;
    }
    if (m.t === 'pickChar') {
      // 開戰前選角(不選 = 開戰時隨機);角色必須屬於自己的陣營,傭兵雙陣營皆可
      if (room.phase !== 'room' || client.mode !== 'player') return;
      if (m.ch == null) { client.ch = null; broadcast(room); return; }
      const c = CHARACTERS[m.ch];
      if (!c || !client.side || (c.side !== client.side && c.side !== 'MERC')) { send(ws, { t: 'error', msg: '角色與陣營不符' }); return; }
      client.ch = m.ch;
      broadcast(room);
      return;
    }
    if (m.t === 'setReady') { client.ready = !!m.ready; broadcast(room); return; }
    if (m.t === 'addBot') {
      // 電腦玩家:房主在房間階段補位(單人練習 / 湊隊)
      if (clientId !== room.hostId) { send(ws, { t: 'error', msg: '只有房主能增減電腦玩家' }); return; }
      if (room.phase !== 'room') return;
      const side = m.side === 'SWARM' || m.side === 'STEEL' ? m.side : null;
      if (!side) return;
      if (!addBotToSide(room, side)) { send(ws, { t: 'error', msg: `${SIDES[side].name} 已滿(${room.config.teamSize} 席)` }); return; }
      broadcast(room);
      return;
    }
    if (m.t === 'setBotChar') {
      // 房主替電腦玩家指定角色(null = 開戰時隨機,與真人 pickChar 同語意)
      if (clientId !== room.hostId) { send(ws, { t: 'error', msg: '只有房主能設定電腦玩家' }); return; }
      if (room.phase !== 'room') return;
      const bot = room.bots.get(String(m.id));
      if (!bot) return;
      if (m.ch == null) { bot.ch = null; broadcast(room); return; }
      const c = CHARACTERS[m.ch];
      if (!c || (c.side !== bot.side && c.side !== 'MERC')) { send(ws, { t: 'error', msg: '角色與陣營不符' }); return; }
      bot.ch = m.ch;
      broadcast(room);
      return;
    }
    if (m.t === 'removeBot') {
      if (clientId !== room.hostId || room.phase !== 'room') return;
      room.bots.delete(String(m.id));
      broadcast(room);
      return;
    }
    if (m.t === 'setRoomConfig' && clientId === room.hostId) {
      if (m.roomName !== undefined) room.config.roomName = sanitizeName(m.roomName);
      if (m.isPublic !== undefined) room.config.isPublic = !!m.isPublic;
      if (m.botDiff !== undefined && BOT_DIFF[m.botDiff]) room.config.botDiff = m.botDiff;
      broadcast(room);
      return;
    }
    if (m.t === 'startBattle') {
      // 房主開戰(地圖開房時已鎖定):至少 1 位已選陣營並準備
      if (clientId !== room.hostId) { send(ws, { t: 'error', msg: '只有房主能開戰' }); return; }
      if (room.phase !== 'room') return;
      const players = [...room.clients.values()].filter((c) => c.mode === 'player' && c.side);
      if (players.length === 0) { send(ws, { t: 'error', msg: '請先選擇陣營' }); return; }
      if (!players.every((c) => c.ready)) { send(ws, { t: 'error', msg: '還有指揮官未按「準備完成」' }); return; }
      // 人數不足一律補電腦玩家到滿編(取消單人練習模式)
      for (const side of ['SWARM', 'STEEL']) {
        while (addBotToSide(room, side)) { /* 補到滿編為止 */ }
      }
      room.phase = 'loading';
      for (const c of room.clients.values()) { c.loaded = false; send(c.ws, { t: 'battleConfig', config: room.battleConfig }); }
      broadcast(room);
      return;
    }
    if (m.t === 'loaded') { client.loaded = true; broadcast(room); maybeLaunch(room); return; }
    if (m.t === 'world') {
      // 房主上傳世界障礙(建物/神木/巨岩碰撞柱)+ 立體交通走廊(sim 座標)。
      // 通常先於開戰抵達(存房間,startBattle 套用);房主是觀戰者時可能晚到 → 直接套用進行中的 sim
      // (LOS 即時生效;走廊內障礙從快照消失,客戶端自動收掉)。非房主來源一律丟棄。
      if (clientId === room.hostId && m.occ) {
        room.world = { occ: m.occ, cor: m.cor, wet: m.wet, slabs: m.slabs };   // wet:水沼粗網格;slabs:橋面/隧道天花薄板(LOS)
        if (room.battle) room.battle.setWorld(room.world);
      }
      return;
    }

    // ---- 戰鬥中 ----
    const b = room.battle;
    if (!b) {
      if (m.t === 'leaveRoom') { leaveRoom(client, room, clientId); room = null; client = null; }
      return;
    }
    if (m.t === 'pos' && client.side) { b.heroPos(clientId, m.x, m.y, m.z, m.ry, m.wet, m.lev); return; }
    if (m.t === 'aim' && client.side) { b.heroAim(clientId, m.on); return; }
    if (m.t === 'hit' && client.side) { b.heroHit(clientId, m.id, m.w); return; }
    if (m.t === 'hitMissile' && client.side) { b.hitMissile(clientId, m.id, m.w); return; }
    if (m.t === 'burst' && client.side) { b.heroBurst(clientId, m.x, m.z, m.y, m.lev); return; }   // y = 對空引爆高度 / lev = 爆點結構層(sim 夾範圍)
    if (m.t === 'plasma' && client.side) { b.heroPlasma(clientId, m.dx, m.dz, m.slot); return; }
    if (m.t === 'lance' && client.side) { b.heroLance(clientId, m.o, m.d, m.len); return; }   // 直線貫穿(beam/rail/gun 重武器):o=[x,z,y] 槍口 / d=[dx,dz,dy] 射向 / len=射線長
    if (m.t === 'kami' && client.side) { b.heroKamikaze(clientId); return; }   // 無人機:狙擊長按左鍵 → 護衛自殺機衝出
    if (m.t === 'decoy' && client.side) { b.heroDecoy(clientId); return; }     // 變形機甲:狙擊長按左鍵 → 餌機(沿途投彈)
    if (m.t === 'barrage' && client.side) { b.heroBarrage(clientId); return; } // 非變形機甲:狙擊長按左鍵 → 重砲模式
    if (m.t === 'swap' && client.side) { b.heroSwap(clientId, m.i); return; }
    if (m.t === 'lock' && client.side) { b.heroLock(clientId, m.id); return; }
    if (m.t === 'civ' && client.side) { b.civInteract(clientId, m.id, m.act); return; }   // 平民互動:跟隨/驅趕
    if (m.t === 'cast' && client.side) { b.heroCast(clientId, m.slot, m.x, m.z); return; }
    if (m.t === 'iframe' && client.side) { b.heroIframe(clientId); return; }   // 蓄力跳/變形中段無敵幀(CD 由 sim 把關)
    if (m.t === 'reload' && client.side) { b.heroReload(clientId, m.w); return; }
    if (m.t === 'buy' && client.side) {
      const err = b.buy(clientId, m.item);
      if (err) send(ws, { t: 'error', msg: err });
      return;
    }
    if (m.t === 'tracer') {
      // 純視覺:轉播給其他客戶端畫彈道;pid 供接收端驅動射手機體的開火動畫(比照 heavyCharge,伺服器附上,不信任客戶端)
      // mv:拋物線武器的實際初速(火控解的裝藥號數;純視覺轉播,讓對方畫出與射手同一條弧)
      for (const [id, c] of room.clients) if (id !== clientId) send(c.ws, { t: 'tracer', pid: clientId, from: m.from, to: m.to, side: client.side, slot: m.slot, hit: m.hit, mv: m.mv });
      return;
    }
    if (m.t === 'heavyCharge' && client.side) {
      // 純視覺:即時轉播 rail 重武器蓄力狀態(third-person 掛點動畫),不進 sim 快照(不等 8Hz)
      for (const [id, c] of room.clients) if (id !== clientId) send(c.ws, { t: 'heavyCharge', pid: clientId, on: !!m.on });
      return;
    }
    if (m.t === 'heavyFire' && client.side) {
      // 純視覺:即時轉播重武器擊發瞬間(third-person 掛點動畫)
      for (const [id, c] of room.clients) if (id !== clientId) send(c.ws, { t: 'heavyFire', pid: clientId });
      return;
    }
    if (m.t === 'backToRoom' && clientId === room.hostId) {
      // 回到房間再戰:地圖屬於房間(開房前選定),保留 battleConfig
      stopBattle(room);
      room.battle = null; room.phase = 'room';
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
