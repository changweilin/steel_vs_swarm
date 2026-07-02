// ============ LAN 遊戲伺服器:HTTP 靜態檔 + WebSocket 房間 ============
import http from 'http';
import https from 'https';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { fileURLToPath } from 'url';
import { WebSocketServer } from 'ws';
import { Game } from './game.js';
import { botStep } from './bot.js';
import { loadRulesConfig, DEFAULT_RULES_PATH } from './config.js';
import { randomStrategy, strategyNickname } from './strategy.js';
import { CHARACTERS, RULES, FACTIONS } from '../public/js/data.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = path.join(__dirname, '..', 'public');
const SAVE_DIR = path.join(__dirname, '..', 'saves');
// 命令列參數讀取:支援 `--port 8000` 或 `--port=8000`(任何 shell 都能用 `npm start -- --port 8000`,
// 避開「PowerShell 不支援 bash 風格 PORT=8000 npm start」這個常見坑)。
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
// 埠來源優先序:命令列參數 > 環境變數 > 預設 8520
const PORT = argVal('--port', '-p') || process.env.PORT || 8520;
fs.mkdirSync(SAVE_DIR, { recursive: true });

// 載入數值參數設定檔(config/rules.json)覆寫 RULES
const rulesCfg = loadRulesConfig();
console.log(rulesCfg ? `⚙️ 已載入參數檔:${rulesCfg.path}` : '⚙️ 未找到 config/rules.json,使用內建預設值');

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

const requestHandler = (req, res) => {
  let urlPath = decodeURIComponent(req.url.split('?')[0]);
  if (urlPath === '/') urlPath = '/index.html';
  if (urlPath === '/config/rules.json') { // 前端開局時取得同一份參數設定
    fs.readFile(DEFAULT_RULES_PATH, (err, data) => {
      if (err) { res.writeHead(404); res.end('{}'); return; }
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(data);
    });
    return;
  }
  const filePath = path.join(PUBLIC_DIR, path.normalize(urlPath));
  if (!filePath.startsWith(PUBLIC_DIR)) { res.writeHead(403); res.end(); return; }
  fs.readFile(filePath, (err, data) => {
    if (err) { res.writeHead(404); res.end('404'); return; }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(filePath)] || 'application/octet-stream' });
    res.end(data);
  });
};

// ---------------- HTTP / HTTPS 伺服器 ----------------
// 一律提供 HTTP(在網址列直接輸入位址預設就是 http,「打開就能用」,桌機零摩擦);
// 若提供憑證,另外在 HTTPS_PORT 同時提供 HTTPS + WSS,讓手機能用安全連線。
// 兩個埠共用同一份房間狀態(同一行程),桌機走 http、手機走 https 也能同桌對戰。
// 憑證來源:環境變數 TLS_KEY / TLS_CERT,或 config/key.pem + config/cert.pem(用 `npm run gen-cert` 產生)。
// net.js 會在 https 頁面自動把 WebSocket 改成 wss,因此前端零修改。
const TLS_KEY = process.env.TLS_KEY || path.join(__dirname, '..', 'config', 'key.pem');
const TLS_CERT = process.env.TLS_CERT || path.join(__dirname, '..', 'config', 'cert.pem');
const USE_HTTPS = fs.existsSync(TLS_KEY) && fs.existsSync(TLS_CERT);
const HTTPS_PORT = argVal('--https-port') || process.env.HTTPS_PORT || (Number(PORT) + 1); // 預設 = HTTP 埠 + 1(例:8520→8521)
const httpServer = http.createServer(requestHandler);
const httpsServer = USE_HTTPS
  ? https.createServer({ key: fs.readFileSync(TLS_KEY), cert: fs.readFileSync(TLS_CERT) }, requestHandler)
  : null;

// ---------------- 房間管理 ----------------
/**
 * room = {
 *   pin, hostId, started, game,
 *   clients: Map<clientId, {ws, name, mode:'player'|'spectator', charId|null}>,
 *   chars: Map<charId, {pin, ownerName}>,  // 角色鎖定 PIN
 * }
 */
const rooms = new Map();
let nextClientId = 1;

function genPin() {
  let pin;
  do { pin = String(Math.floor(1000 + Math.random() * 9000)); } while (rooms.has(pin));
  return pin;
}

// 房間公開識別碼(與 PIN 分離):公開大廳列表用它指向房間,
// 私人房不外洩 PIN,加入時才驗證玩家輸入的 PIN。
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
function hostNameOf(room) {
  const h = room.clients.get(room.hostId);
  return h ? h.name : '—';
}
/** 連線畫面用:列出所有房間(公開房附 PIN 供直接加入;私人房只給 id,需輸入 PIN) */
function roomListPayload() {
  const out = [];
  for (const room of rooms.values()) {
    const isPublic = room.config?.isPublic !== false;
    const players = [...room.clients.values()].filter(c => c.mode === 'player').length;
    const spectators = [...room.clients.values()].filter(c => c.mode === 'spectator').length;
    const e = {
      id: room.id, isPublic, started: !!room.started,
      name: room.config?.gameName || '未命名房間',
      players, spectators,
      expected: room.config?.expectedCount || 4,
      host: hostNameOf(room),
    };
    if (isPublic) e.pin = room.pin; // 公開房才回傳 PIN 供一鍵加入
    out.push(e);
  }
  // 未開始的、公開的排前面;其餘維持插入順序
  out.sort((a, b) => (a.started - b.started) || (b.isPublic - a.isPublic));
  return out;
}

// 連線 session token:斷線重連時用來認回原本的座位(保留房主/角色身分)
function genToken() {
  return Math.random().toString(36).slice(2) + Date.now().toString(36);
}

function lanUrls() {
  const urls = [];
  const ifaces = os.networkInterfaces();
  const addrs = [];
  for (const name in ifaces) {
    for (const i of ifaces[name]) {
      if (i.family === 'IPv4' && !i.internal) addrs.push(i.address);
    }
  }
  for (const a of addrs) urls.push(`http://${a}:${PORT}`);          // 一般連線(桌機)
  if (USE_HTTPS) for (const a of addrs) urls.push(`https://${a}:${HTTPS_PORT}`); // 安全連線(手機)
  return urls;
}

function send(ws, msg) {
  if (ws.readyState === 1) ws.send(JSON.stringify(msg));
}

// ---------------- 存檔 ----------------
function sanitizeName(s) {
  return String(s || '').replace(/[^\w一-鿿\- ]/g, '').trim().slice(0, 24) || '未命名';
}

function saveRoom(room, name, file = null) {
  const data = {
    name: sanitizeName(name || room.config.gameName),
    savedAt: new Date().toISOString(),
    config: room.config,
    chars: [...room.chars.entries()].map(([id, lock]) => [id, lock]),
    aiChars: [...(room.aiChars || [])],
    started: room.started,
    game: room.game ? room.game.serialize() : null,
  };
  const fname = file || `${data.name}_${Date.now()}.json`;
  fs.writeFileSync(path.join(SAVE_DIR, fname), JSON.stringify(data));
  return { fname, data };
}

function autosave(room) {
  if (!room.started || !room.game) return;
  try { saveRoom(room, room.config.gameName, `_autosave_${room.pin}.json`); }
  catch (e) { console.error('自動存檔失敗:', e.message); }
}

// 斷線重連時,若房間已不在記憶體(伺服器重啟、或全員離線被清除),從自動存檔復原同 PIN 房間
function restoreRoomFromAutosave(pin) {
  const full = path.join(SAVE_DIR, `_autosave_${pin}.json`);
  if (!fs.existsSync(full)) return null;
  let data;
  try { data = JSON.parse(fs.readFileSync(full, 'utf8')); } catch { return null; }
  const room = {
    pin, id: genRoomId(), hostId: null, started: data.started && !!data.game, game: null,
    clients: new Map(), chars: new Map(data.chars),
    config: data.config || { gameName: data.name, expectedCount: 4 },
    aiChars: new Set(data.aiChars || []),
  };
  if (room.config.isPublic === undefined) room.config.isPublic = true;
  if (data.game) {
    try { room.game = Game.fromSave(data.game); } catch { return null; }
  }
  rooms.set(pin, room);
  console.log(`♻️ 從自動存檔復原房間 ${pin}`);
  return room;
}

function listSaves() {
  return fs.readdirSync(SAVE_DIR)
    .filter(f => f.endsWith('.json'))
    .map(f => {
      try {
        const d = JSON.parse(fs.readFileSync(path.join(SAVE_DIR, f), 'utf8'));
        return {
          file: f, name: d.name, savedAt: d.savedAt,
          auto: f.startsWith('_autosave_'),
          round: d.game ? d.game.round : null,
          over: d.game ? d.game.over : false,
          players: d.game ? d.game.players.map(p => p.name) : [...d.chars.map(c => c[1].ownerName)],
        };
      } catch { return null; }
    })
    .filter(Boolean)
    .sort((a, b) => (b.savedAt || '').localeCompare(a.savedAt || ''));
}

// 刪除單一存檔(防目錄穿越)
function deleteSave(file) {
  const f = path.basename(String(file || ''));
  if (!f.endsWith('.json')) return false;
  const full = path.join(SAVE_DIR, f);
  if (!fs.existsSync(full)) return false;
  fs.unlinkSync(full); return true;
}

// 清除所有自動存檔(_autosave_*.json),保留玩家手動存檔
function clearAutosaves() {
  let n = 0;
  for (const f of fs.readdirSync(SAVE_DIR)) {
    if (f.startsWith('_autosave_') && f.endsWith('.json')) {
      try { fs.unlinkSync(path.join(SAVE_DIR, f)); n++; } catch { /* 忽略 */ }
    }
  }
  return n;
}

/** 廣播房間狀態(每個 client 拿到自己視角的 payload) */
function broadcast(room) {
  pruneKickVotes(room);
  refreshAutoStart(room); // 全員(含房主)準備 + 滿員 → 啟動/取消自動開局倒數
  const lobby = {
    pin: room.pin,
    started: room.started,
    urls: lanUrls(),
    config: room.config,
    clients: [...room.clients.entries()].map(([id, c]) => ({
      id, name: c.name, mode: c.mode, charId: c.charId, isHost: id === room.hostId,
      ready: !!c.ready, connected: c.connected !== false,
    })),
    takenChars: [...room.chars.keys()],
    kickVotes: kickVotesPayload(room),
    // 自動開局倒數剩餘毫秒(null=未倒數);前端依此本地遞減顯示「即將開始 3..2..1」
    startCountdownMs: room.startCountdownAt ? Math.max(0, room.startCountdownAt - Date.now()) : null,
  };
  const pub = room.started ? room.game.publicState() : null;
  for (const [id, c] of room.clients) {
    let priv = null;
    if (room.started && c.charId) {
      const pIdx = playerIdxOf(room, c);
      if (pIdx >= 0) priv = room.game.privateStateFor(pIdx);
    }
    send(c.ws, { t: 'sync', youId: id, token: c.token, isHost: id === room.hostId, lobby, state: pub, priv });
  }
}

function playerIdxOf(room, client) {
  if (!client.charId || !room.started) return -1;
  if (client.charId === '*') return room.game.turnIdx; // 上帝模式:永遠控制當前角色
  return room.game.players.findIndex(p => p.char.id === client.charId);
}

// ---------------- 陣營平衡 / 準備 / 投票剔除 ----------------
/** 角色所屬陣營(米=US含日、牆=CN含韓、台灣=null) */
function sideOfChar(charId) {
  const ch = CHARACTERS.find(c => c.id === charId);
  if (!ch) return null;
  return ch.faction === 'TW' ? null : FACTIONS[ch.faction].side;
}
/** 大廳中各陣營已選角的玩家人數(可排除某一位 client) */
function sideCounts(room, except = null) {
  let US = 0, CN = 0;
  for (const c of room.clients.values()) {
    if (c.mode !== 'player' || !c.charId || c === except) continue;
    const s = sideOfChar(c.charId);
    if (s === 'US') US++; else if (s === 'CN') CN++;
  }
  return { US, CN };
}
/** 每個陣營的選角上限:扣除台灣 1 席後折半(偶數→親美/親中 1:1,奇數→相差 1) */
function sideCapFor(expected) {
  const twSeat = expected >= 3 ? 1 : 0;
  return Math.max(1, Math.ceil((expected - twSeat) / 2));
}

function shuffleArr(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

/** 清掉已離開玩家的剔除票(目標或投票者已不在房內) */
function pruneKickVotes(room) {
  if (!room.kickVotes) return;
  for (const [target, voters] of room.kickVotes) {
    if (!room.clients.has(target)) { room.kickVotes.delete(target); continue; }
    for (const v of [...voters]) if (!room.clients.has(v)) voters.delete(v);
    if (voters.size === 0) room.kickVotes.delete(target);
  }
}
/** 投票剔除門檻:除目標外的在房人數過半 */
function kickThreshold(room, targetId) {
  const eligible = [...room.clients.keys()].filter(id => id !== targetId).length;
  return Math.floor(eligible / 2) + 1;
}
/** 廣播用:{ 目標id: [投票者id…] } */
function kickVotesPayload(room) {
  const out = {};
  if (room.kickVotes) for (const [t, voters] of room.kickVotes) if (voters.size) out[t] = [...voters];
  return out;
}

// ---------------- 自動開局倒數 ----------------
const START_COUNTDOWN_MS = 3000;

/** 房間內「參與遊戲」的玩家(player 模式、未斷線),房主也算 */
function participantsOf(room) {
  return [...room.clients.values()].filter(c => c.mode === 'player' && c.connected !== false);
}
/** 全部參與玩家(含房主)都按了「準備好」 */
function allParticipantsReady(room) {
  const ps = participantsOf(room);
  return ps.length > 0 && ps.every(c => c.ready);
}
/** 滿員:參與人數已達預計人數 */
function roomFull(room) {
  const total = Math.min(RULES.maxPlayers, Math.max(2, room.config.expectedCount || 4));
  return participantsOf(room).length >= total;
}
/** 取消進行中的自動開局倒數 */
function cancelStartCountdown(room) {
  if (room.startTimer) { clearTimeout(room.startTimer); room.startTimer = null; }
  room.startCountdownAt = null;
}
/** 在 broadcast 前呼叫:條件成立(全員準備 + 滿員)→ 啟動 3 秒倒數;條件破壞 → 取消。 */
function refreshAutoStart(room) {
  if (room.started) { if (room.startTimer) cancelStartCountdown(room); return; }
  const should = allParticipantsReady(room) && roomFull(room);
  if (should && !room.startTimer) {
    room.startCountdownAt = Date.now() + START_COUNTDOWN_MS;
    room.startTimer = setTimeout(() => {
      room.startTimer = null; room.startCountdownAt = null;
      // 倒數結束再確認一次條件仍成立(期間沒人取消準備 / 離開)才真的開局
      if (!room.started && allParticipantsReady(room) && roomFull(room)) {
        const e = launchMultiGame(room);
        if (e) for (const c of room.clients.values()) send(c.ws, { t: 'info', msg: e });
      } else {
        broadcast(room); // 條件已破壞:把「倒數取消」狀態送給大家
      }
    }, START_COUNTDOWN_MS);
  } else if (!should && room.startTimer) {
    cancelStartCountdown(room);
  }
}

/** 多人連線模式開局:全員(含房主)已準備 → 依平衡陣容入座、缺額補 AI、建立遊戲。
 *  回傳 null=成功;字串=錯誤訊息。手動「開始遊戲」與倒數結束自動開局共用此邏輯。 */
function launchMultiGame(room) {
  if (room.started) return '遊戲已開始';
  cancelStartCountdown(room);
  const total = Math.min(RULES.maxPlayers, Math.max(2, room.config.expectedCount || 4));
  room.aiChars = new Set();
  const aiNames = new Set();
  let participants = participantsOf(room);
  const notReady = participants.filter(c => !c.ready);
  if (participants.length > 0 && notReady.length) return `還有 ${notReady.length} 位玩家尚未按「準備好」`;
  // 參與人數超過預計人數 → 多出者轉觀戰(已選角者優先入座)
  if (participants.length > total) {
    participants.sort((a, b) => (b.charId ? 1 : 0) - (a.charId ? 1 : 0));
    for (const c of participants.slice(total)) {
      if (c.charId) { room.chars.delete(c.charId); c.charId = null; }
      c.mode = 'spectator';
      send(c.ws, { t: 'info', msg: `👁️ 參與人數超過 ${total} 人,你這局自動觀戰` });
    }
    participants = participants.slice(0, total);
  }
  const chosen = participants.filter(c => c.charId).map(c => c.charId);
  // buildLineup 依平衡陣容(米/牆/台…)補滿;未被真人選走的角色用來隨機分配 / AI 頂替
  const remaining = shuffleArr(buildLineup(chosen, total).filter(id => !chosen.includes(id)));
  const seats = [];
  for (const c of participants) if (c.charId) seats.push({ charId: c.charId, playerName: c.name });
  const randomly = [];
  for (const c of participants) if (!c.charId) {
    const id = remaining.shift();
    c.charId = id;
    room.chars.set(id, { pin: '', ownerName: c.name });
    seats.push({ charId: id, playerName: c.name });
    randomly.push(c);
  }
  for (const id of remaining) { seats.push(makeAISeat(id, aiNames)); room.aiChars.add(id); }
  for (const c of randomly) {
    const cc = CHARACTERS.find(x => x.id === c.charId);
    send(c.ws, { t: 'info', msg: `🎲 系統分配給你的角色:${cc.name}【${FACTIONS[cc.faction].name}】` });
  }
  const aiSeats = seats.filter(s => s.isAI);
  const aiList = aiSeats.map(s => `${s.playerName}(${CHARACTERS.find(c => c.id === s.charId).name})`).join('、');
  const aiFillNote = participants.length === 0
    ? `🍿 無人參與,全 AI 觀賞局開始!對戰角色:${aiList}`
    : aiSeats.length
      ? `🤖 ${participants.length} 位玩家參戰,缺額由 ${aiSeats.length} 位 AI 頂替:${aiList}`
      : randomly.length ? `🎲 已為 ${randomly.length} 位未選角玩家隨機分配角色` : null;

  room.game = new Game(seats);
  room.started = true;
  room.kickVotes = new Map(); // 開局清空剔除票
  if (aiFillNote) {
    room.game.addLog(aiFillNote);
    for (const c of room.clients.values()) send(c.ws, { t: 'info', msg: aiFillNote });
  }
  console.log(`🎮 房間 ${room.pin} 開始遊戲(模式 multi,${seats.length} 角色)`);
  broadcast(room);
  autosave(room); // 開局即留一份自動存檔,確保剛開局(尚無人行動)也能斷線復原
  pumpAI(room);
  return null;
}

/** 選角玩家已達預計人數時,把其餘未選角的(非房主)玩家自動轉為觀戰 */
function autoSpectate(room) {
  if (room.started) return;
  const expected = room.config.expectedCount || 4;
  const seated = [...room.clients.values()].filter(c => c.mode === 'player' && c.charId);
  if (seated.length < expected) return;
  for (const [id, c] of room.clients)
    if (c.mode === 'player' && !c.charId && id !== room.hostId) {
      c.mode = 'spectator';
      send(c.ws, { t: 'info', msg: `👁️ 選角玩家已達 ${expected} 人,你已自動轉為觀戰模式` });
    }
}

/** 自動補齊角色陣容(滿足 米/牆/台 限制;2 人局免台灣;7/8 人補日韓) */
function buildLineup(existing, total) {
  const chosen = [...existing];
  const has = f => chosen.some(id => CHARACTERS.find(c => c.id === id).faction === f);
  const pool = f => CHARACTERS.filter(c => c.faction === f && !chosen.includes(c.id)).map(c => c.id);
  if (!has('US')) chosen.push(pool('US')[0]);
  if (!has('CN')) chosen.push(pool('CN')[0]);
  if (total >= 3 && !has('TW')) chosen.push('tsmc');
  if (total >= RULES.jpkrMinPlayers) { // 6 人以上同時開放日韓
    if (!has('JP') && chosen.length < total) chosen.push('toyota');
    if (!has('KR') && chosen.length < total) chosen.push('lee');
  }
  let toggle = 0;
  while (chosen.length < total) {
    const f = toggle++ % 2 === 0 ? 'US' : 'CN';
    const next = pool(f)[0] || pool(f === 'US' ? 'CN' : 'US')[0];
    if (!next) break;
    chosen.push(next);
  }
  return chosen.slice(0, total);
}

/** 產生一個 AI 座位:隨機策略性格 + 反映性格的梗名(前綴 [AI]) */
function makeAISeat(charId, usedNames) {
  const strategy = randomStrategy();
  return { charId, playerName: strategyNickname(strategy, usedNames), isAI: true, strategy };
}

// 每種動作特效在前端大致的播放秒數(毫秒);AI 下一步會等到上一步的動畫播完才進行
const AI_FX_DELAY = { build: 1800, move: 2200, spy: 2100, destroy: 2100, steal: 2100, fake: 2100, draw: 1000, event: 2800 };
/** 依「上一步剛產生的特效」推算下一步前該等待的時間(沒有特效=純內務,只略停一下) */
function aiStepDelay(g, fxSeqBefore) {
  const fresh = g.fx.filter(f => f.id > fxSeqBefore);
  if (!fresh.length) return 550;
  return Math.max(...fresh.map(f => AI_FX_DELAY[f.type] ?? 1200));
}

/** AI 回合驅動:當前玩家是 AI 時,以計時器逐步執行,且等動畫特效播完才進行下一步 */
function pumpAI(room, delay = 800) {
  if (!room.started || room.game.over || room.aiTimer) return;
  const cur = room.game.cur();
  if (!room.aiChars || !room.aiChars.has(cur.char.id)) return;
  room.aiTimer = setTimeout(() => {
    room.aiTimer = null;
    if (!rooms.has(room.pin) || !room.started) return;
    const fxBefore = room.game._fxSeq;
    let cont = false;
    try { cont = botStep(room.game); } catch (e) { console.error('AI 錯誤:', e); room.game.endTurn(); }
    broadcast(room);
    if (!cont) autosave(room); // AI 回合結束時自動存檔
    pumpAI(room, aiStepDelay(room.game, fxBefore)); // 等這一步的動畫播完再做下一步
  }, delay);
}

// ---------------- WebSocket ----------------
// ws(http 埠)與 wss(https 埠)共用同一個連線處理器,房間狀態在同一行程共享。
function handleConnection(ws) {
  let clientId = nextClientId++; // reattach 時會改綁回原座位 id
  let room = null;
  let client = null;

  const err = msg => send(ws, { t: 'error', msg });

  ws.on('message', raw => {
    let m;
    try { m = JSON.parse(raw); } catch { return; }

    // ----- 建立/加入房間 -----
    if (m.t === 'createRoom') {
      const pin = genPin();
      room = {
        pin, id: genRoomId(), hostId: clientId, started: false, game: null,
        clients: new Map(), chars: new Map(), kickVotes: new Map(),
        config: { gameName: sanitizeName(m.gameName), expectedCount: 4, randomChars: false, isPublic: m.isPublic !== false },
      };
      client = { ws, name: m.name || `玩家${clientId}`, mode: 'player', charId: null, token: genToken(), connected: true };
      room.clients.set(clientId, client);
      rooms.set(pin, room);
      console.log(`🏠 房間 ${pin} 已建立`);
      broadcast(room);
      return;
    }
    // ----- 列出所有房間(連線畫面用:公開房可一鍵加入,私人房需輸入 PIN) -----
    if (m.t === 'listRooms') {
      send(ws, { t: 'rooms', list: roomListPayload() });
      return;
    }
    // ----- 列出/載入存檔(可在尚未加入房間時使用) -----
    if (m.t === 'listSaves') {
      send(ws, { t: 'saves', list: listSaves() });
      return;
    }
    if (m.t === 'loadGame') {
      if (room && room.started) { err('你已在進行中的房間'); return; }
      const file = path.basename(String(m.file || ''));
      const full = path.join(SAVE_DIR, file);
      if (!file.endsWith('.json') || !fs.existsSync(full)) { err('找不到存檔'); return; }
      let data;
      try { data = JSON.parse(fs.readFileSync(full, 'utf8')); }
      catch { err('存檔損毀'); return; }
      if (room) { room.clients.delete(clientId); if (room.clients.size === 0) rooms.delete(room.pin); }
      const pin = genPin();
      room = {
        pin, id: genRoomId(), hostId: clientId, started: data.started && !!data.game, game: null,
        clients: new Map(), chars: new Map(data.chars),
        config: data.config || { gameName: data.name, expectedCount: 4 },
        aiChars: new Set(data.aiChars || []),
      };
      if (room.config.isPublic === undefined) room.config.isPublic = true;
      if (data.game) {
        try { room.game = Game.fromSave(data.game); }
        catch (e) { rooms.delete(pin); room = null; err('載入失敗:' + e.message); return; }
      }
      client = { ws, name: m.name || `玩家${clientId}`, mode: 'player', charId: null, token: genToken(), connected: true };
      room.clients.set(clientId, client);
      rooms.set(pin, room);
      console.log(`📂 從存檔「${data.name}」建立房間 ${pin}`);
      broadcast(room);
      pumpAI(room);
      return;
    }
    if (m.t === 'joinRoom') {
      // 來源:房間列表點擊帶 roomId;直接輸入 PIN 則用 pin 當鍵
      const r = m.roomId ? findRoomById(String(m.roomId)) : rooms.get(String(m.pin));
      if (!r) { err('找不到此房間'); return; }
      // 非公開房:必須提供正確 PIN 才能加入(直接用 PIN 當鍵時 pin 已等同驗證)
      if (r.config?.isPublic === false && String(m.pin || '') !== r.pin) {
        err('🔒 此為私人房間,PIN 碼錯誤'); return;
      }
      room = r;
      client = { ws, name: m.name || `玩家${clientId}`, mode: m.mode === 'spectator' ? 'spectator' : 'player', charId: null, token: genToken(), connected: true };
      room.clients.set(clientId, client);
      console.log(`👤 ${client.name} 加入房間 ${room.pin}(${client.mode})`);
      broadcast(room);
      return;
    }
    // ----- 斷線重連:用 token 認回原座位;失效時用 charId 重新入座 -----
    if (m.t === 'reattach') {
      let r = rooms.get(String(m.pin));
      // 房間不在記憶體(伺服器重啟 / 房間已被清除)→ 試著從自動存檔復原
      if (!r) r = restoreRoomFromAutosave(String(m.pin));
      if (!r) { send(ws, { t: 'needRejoin', msg: '房間已結束,請重新加入' }); return; }
      room = r;
      // 1) 短暫斷線:座位還在,用 token 認回原身分
      let found = null, foundId = null;
      for (const [id, c] of r.clients) { if (c.token && c.token === m.token) { foundId = id; found = c; break; } }
      if (found) {
        client = found; clientId = foundId;
        if (client.dcTimer) { clearTimeout(client.dcTimer); client.dcTimer = null; }
        client.ws = ws; client.connected = true;
      } else {
        // 2) token 失效(座位已過寬限被刪 / 房間剛從存檔復原)→ 重新入座
        clientId = nextClientId++;
        client = {
          ws, name: sanitizeName(m.name) || `玩家${clientId}`,
          mode: m.mode === 'spectator' ? 'spectator' : 'player',
          charId: null, token: genToken(), connected: true,
        };
        // 角色仍以 PIN 鎖定在這位玩家名下 → 自動認回(上帝模式控制當前角色)
        if (m.charId === '*') client.charId = '*';
        else if (m.charId && r.chars.has(m.charId)) client.charId = m.charId;
        r.clients.set(clientId, client);
      }
      // 房主從缺(復原房間 / 原房主已離線)→ 由這位重連者接手
      if (r.hostId == null || !r.clients.has(r.hostId)) r.hostId = clientId;
      console.log(`🔄 ${client.name} 重新連回房間 ${room.pin}`);
      broadcast(room);
      pumpAI(room);
      return;
    }
    // ----- 清除暫存檔/刪除存檔(不需在房間內,連線畫面可用;前端需要時自行重抓 listSaves) -----
    if (m.t === 'clearAutosaves') {
      const n = clearAutosaves();
      send(ws, { t: 'info', msg: n ? `🗑️ 已清除 ${n} 個自動存檔` : '沒有自動存檔可清除' });
      return;
    }
    if (m.t === 'deleteSave') {
      const ok = deleteSave(m.file);
      send(ws, { t: 'info', msg: ok ? '🗑️ 已刪除存檔' : '找不到該存檔' });
      return;
    }
    if (!room || !client) { err('尚未加入房間'); return; }

    // ----- 房間設定(房主):遊戲名稱、預計人數 -----
    if (m.t === 'setRoomConfig') {
      if (clientId !== room.hostId) { err('只有房主能修改設定'); return; }
      if (m.gameName !== undefined) room.config.gameName = sanitizeName(m.gameName);
      if (m.expectedCount !== undefined) {
        const n = parseInt(m.expectedCount, 10);
        if (n >= 2 && n <= RULES.maxPlayers) room.config.expectedCount = n;
      }
      if (m.isPublic !== undefined) room.config.isPublic = !!m.isPublic;
      if (m.randomChars !== undefined) {
        room.config.randomChars = !!m.randomChars;
        if (room.config.randomChars) { // 開啟隨機分配:釋放所有已鎖定角色,改由「準備好」流程
          room.chars.clear();
          for (const c of room.clients.values()) c.charId = null;
        }
      }
      autoSpectate(room);
      broadcast(room);
      return;
    }

    // ----- 切換「準備好」狀態 -----
    if (m.t === 'setReady') {
      if (room.started) { err('遊戲已開始'); return; }
      client.ready = !!m.ready;
      broadcast(room);
      return;
    }

    // ----- 投票剔除玩家(大廳內;過半同意即移出房間,房主免疫) -----
    if (m.t === 'voteKick') {
      if (room.started) { err('遊戲已開始,無法投票剔除'); return; }
      const targetId = m.targetId;
      if (!room.clients.has(targetId)) { err('找不到該玩家'); return; }
      if (targetId === room.hostId) { err('無法投票剔除房主'); return; }
      if (targetId === clientId) { err('不能投票剔除自己'); return; }
      room.kickVotes = room.kickVotes || new Map();
      let voters = room.kickVotes.get(targetId);
      if (!voters) { voters = new Set(); room.kickVotes.set(targetId, voters); }
      if (voters.has(clientId)) voters.delete(clientId); else voters.add(clientId);
      pruneKickVotes(room);
      voters = room.kickVotes.get(targetId);
      if (voters && voters.size >= kickThreshold(room, targetId)) {
        const kicked = room.clients.get(targetId);
        if (kicked) {
          if (kicked.charId) room.chars.delete(kicked.charId);
          if (kicked.dcTimer) { clearTimeout(kicked.dcTimer); kicked.dcTimer = null; }
          send(kicked.ws, { t: 'kicked', msg: '你已被多數玩家投票剔除房間' });
          try { kicked.ws.close(); } catch { /* 忽略 */ }
          room.clients.delete(targetId);
          console.log(`👢 房間 ${room.pin}:玩家 ${kicked.name} 被投票剔除`);
        }
        room.kickVotes.delete(targetId);
        pruneKickVotes(room);
      }
      broadcast(room);
      return;
    }

    // ----- 切換自己的參與模式(大廳內;房主可選擇不參與只主持/觀戰) -----
    if (m.t === 'setMode') {
      if (room.started) { err('遊戲已開始,無法切換模式'); return; }
      const want = m.mode === 'spectator' ? 'spectator' : 'player';
      if (want === 'spectator' && client.charId) {
        room.chars.delete(client.charId); // 退出觀戰:釋放已鎖定的角色
        client.charId = null;
      }
      client.mode = want;
      broadcast(room);
      return;
    }

    // ----- 儲存遊戲(房主) -----
    if (m.t === 'saveGame') {
      if (clientId !== room.hostId) { err('只有房主能儲存'); return; }
      if (!room.started || !room.game) { err('遊戲尚未開始,沒有可儲存的進度'); return; }
      try {
        const { fname, data } = saveRoom(room, m.name);
        send(ws, { t: 'info', msg: `💾 已儲存「${data.name}」` });
        console.log(`💾 房間 ${room.pin} 存檔:${fname}`);
      } catch (e) { err('存檔失敗:' + e.message); }
      return;
    }

    // ----- 結束遊戲(房主):回到大廳,保留角色鎖定 -----
    if (m.t === 'endGame') {
      if (clientId !== room.hostId) { err('只有房主能結束遊戲'); return; }
      if (!room.started) { err('遊戲尚未開始'); return; }
      autosave(room); // 結束前自動留一份
      if (room.aiTimer) { clearTimeout(room.aiTimer); room.aiTimer = null; }
      room.started = false;
      room.game = null;
      room.aiChars = new Set();
      room.kickVotes = new Map();
      // 關閉「角色隨機分配」:否則回大廳後仍鎖在「待隨機分配/取消指定角色」狀態,無法重新選角。
      // 上局隨機分配到的角色仍保留(client.charId),關閉後即顯示為已選、可自由更換。
      room.config.randomChars = false;
      for (const c of room.clients.values()) c.ready = false; // 回大廳:重置準備狀態
      console.log(`⏹️ 房間 ${room.pin} 遊戲已由房主結束`);
      broadcast(room);
      return;
    }

    // ----- 選角色(設定 PIN 鎖定) -----
    if (m.t === 'selectChar') {
      if (client.mode === 'spectator') { err('觀戰者無法選擇角色'); return; }
      if (room.config.randomChars && !room.started) {
        err('房主已開啟「角色隨機分配」,請改用「準備好」按鈕'); return;
      }
      if (client.ready && !room.started) {
        err('你已按「準備好」,請先取消準備才能選擇/更換角色'); return;
      }
      // 點擊自己已選的角色 → 取消選擇(釋放鎖定)
      if (!room.started && m.charId === client.charId) {
        room.chars.delete(client.charId);
        client.charId = null;
        broadcast(room);
        return;
      }
      const ch = CHARACTERS.find(c => c.id === m.charId);
      if (!ch) { err('無此角色'); return; }
      if ((ch.faction === 'JP' || ch.faction === 'KR') && room.config.expectedCount < RULES.jpkrMinPlayers) {
        err(`日本/韓國需要遊戲人數 ${RULES.jpkrMinPlayers} 以上(請房主調整人數選項)`); return;
      }
      if (!room.started && ch.faction === 'TW' && room.config.expectedCount < 3) {
        err('雙人對決為米牆對決,不開放台灣'); return;
      }
      // 3 人以上:若只剩這位玩家未選角且台灣還沒人選,他只能選台灣
      if (!room.started && room.config.expectedCount >= 3 && ch.id !== 'tsmc' && !room.chars.has('tsmc')) {
        const playerClients = [...room.clients.values()].filter(c => c.mode === 'player');
        const unselected = playerClients.filter(c => !c.charId);
        if (playerClients.length >= room.config.expectedCount &&
            unselected.length === 1 && unselected[0] === client) {
          err('你是最後一位未選角的玩家,且台灣尚未有人選擇 — 必須選擇護國神山!'); return;
        }
      }
      // 陣營人數平衡:某陣營達上限時不可再選該陣營(扣除台灣後折半;偶數→親美/親中 1:1)
      if (!room.started && ch.faction !== 'TW' && m.charId !== client.charId) {
        const side = FACTIONS[ch.faction].side;
        const cap = sideCapFor(room.config.expectedCount);
        const cur = sideCounts(room, client);
        if ((side === 'US' ? cur.US : cur.CN) + 1 > cap) {
          err(`${side === 'US' ? '親美' : '親中'}陣營已達 ${cap} 人上限,請選擇另一陣營以維持雙方平衡`); return;
        }
      }
      if (room.chars.has(m.charId)) {
        // 角色已被選:驗證 PIN 即可接管/觀察(換裝置重連)
        const lock = room.chars.get(m.charId);
        if (lock.pin !== String(m.charPin)) { err('角色 PIN 錯誤,無法存取該角色'); return; }
      } else {
        if (room.started) { err('遊戲已開始,只能用 PIN 認領已有角色'); return; }
        if (!m.charPin || String(m.charPin).length < 4) { err('請設定至少 4 位數的角色 PIN'); return; }
        // 一個玩家換角色:釋放舊角色
        if (client.charId) room.chars.delete(client.charId);
        room.chars.set(m.charId, { pin: String(m.charPin), ownerName: client.name });
      }
      client.charId = m.charId;
      autoSpectate(room);
      broadcast(room);
      return;
    }

    // ----- 開始遊戲(房主) -----
    if (m.t === 'startGame') {
      if (clientId !== room.hostId) { err('只有房主能開始遊戲'); return; }
      if (room.started) { err('遊戲已開始'); return; }
      const gameMode = m.mode || 'multi';
      let seats = [];
      let aiFillNote = null; // 多人模式 AI 頂替提示
      room.aiChars = new Set();
      const aiNames = new Set();

      const total = Math.min(RULES.maxPlayers, Math.max(2, room.config.expectedCount || 4));

      if (gameMode === 'god') {
        // 上帝模式:所有角色由房主一人控制(人數 = 預計人數)
        const lineup = buildLineup(client.charId && client.charId !== '*' ? [client.charId] : [], total);
        seats = lineup.map(id => ({ charId: id }));
        for (const c of room.clients.values())
          if (c.mode === 'player') c.charId = '*';
      } else if (gameMode === 'ai') {
        // 單人 vs AI:房主一個角色,AI 數量 = 預計人數 - 1
        if (!client.charId) { err('請先選擇你的角色'); return; }
        const hostFaction = CHARACTERS.find(c => c.id === client.charId).faction;
        if ((hostFaction === 'JP' || hostFaction === 'KR') && total < RULES.jpkrMinPlayers) {
          err(`選日本/韓國需要遊戲人數 ${RULES.jpkrMinPlayers} 以上`); return;
        }
        const lineup = buildLineup([client.charId], total);
        seats = lineup.map(id => id === client.charId
          ? { charId: id, playerName: client.name }
          : makeAISeat(id, aiNames));
        for (const id of lineup) if (id !== client.charId) room.aiChars.add(id);
      } else {
        // 多人連線:全員(含房主)「準備好」才能開始。已選角者用自己的角色;未選角者(含隨機
        // 分配模式、或選擇交給系統)按平衡陣容隨機分配;缺額由 AI 頂替。開局流程與倒數自動
        // 開局共用 launchMultiGame。房主按下「開始」即視為自己已準備(前端 start 門檻仍要求
        // 房主先按「準備好」才會解開;全員準備 + 滿員時則由伺服器倒數自動呼叫 launchMultiGame)。
        if (client.mode === 'player') client.ready = true;
        const e = launchMultiGame(room);
        if (e) { err(e); return; }
        return;
      }

      room.game = new Game(seats);
      room.started = true;
      room.kickVotes = new Map(); // 開局清空剔除票
      if (aiFillNote) {
        room.game.addLog(aiFillNote);
        for (const c of room.clients.values()) send(c.ws, { t: 'info', msg: aiFillNote });
      }
      console.log(`🎮 房間 ${room.pin} 開始遊戲(模式 ${gameMode},${seats.length} 角色)`);
      broadcast(room);
      autosave(room); // 開局即留一份自動存檔,確保剛開局(尚無人行動)也能斷線復原
      pumpAI(room);
      return;
    }

    // ----- 遊戲行動 -----
    if (m.t === 'action') {
      if (!room.started) { err('遊戲尚未開始'); return; }
      const g = room.game;
      const pIdx = playerIdxOf(room, client);
      if (pIdx < 0) { err('你不是此局玩家'); return; }
      const isTradeAction = String(m.kind).startsWith('trade');
      // twChoose(台灣秘密選邊)不耗 AP 也不受輪次限制(限第 1 季)
      if (g.turnIdx !== pIdx && m.kind !== 'noop' && m.kind !== 'twChoose' && !isTradeAction) { err('還沒輪到你'); return; }

      let res = { ok: false, msg: '未知行動' };
      switch (m.kind) {
        case 'move': res = g.doMove(m.regionId); break;
        case 'playTech': res = g.doPlayTech(m.handIdx, m.rebuildUid ?? null); break;
        case 'forfeit': res = g.doForfeit(m.kind2); break;
        case 'exchange': res = g.doExchange(m.res, m.amount); break;
        case 'upgradeCity': res = g.doUpgradeCity(); break;
        case 'upgradeCard': res = g.doUpgradeCard(m.handIdxs, m.toTier); break;
        case 'playCard': res = g.doPlayCard(m.handIdx, m.target); break;
        case 'endTurn': g.endTurn(); res = { ok: true }; break;
        case 'reveal': res = g.doReveal(); break;
        case 'pivot': res = g.doPivot(); break;
        case 'twChoose': res = g.doChooseSide(pIdx, m.side); break;
        case 'tradeOffer': res = g.doTradeOffer(pIdx, m.toId, m.give, m.receive); break;
        case 'tradeRespond': res = g.doTradeRespond(pIdx, m.offerId, !!m.accept); break;
        case 'tradeCancel': res = g.doTradeCancel(pIdx, m.offerId); break;
        case 'tradeReady': res = g.doTradeReady(pIdx, client.charId === '*'); break;
      }
      if (!res.ok) err(res.msg);
      broadcast(room);
      autosave(room);
      pumpAI(room);
      return;
    }
  });

  ws.on('close', () => {
    if (!room || !client) return;
    client.connected = false;
    const dcRoom = room, dcId = clientId, dcClient = client;
    // 斷線寬限:保留座位 60 秒,讓短暫斷線/重整可用 token 認回(避免單人房瞬間銷毀)
    dcClient.dcTimer = setTimeout(() => {
      if (dcClient.connected) return; // 已重連
      dcRoom.clients.delete(dcId);
      if (dcRoom.clients.size === 0) {
        if (dcRoom.aiTimer) { clearTimeout(dcRoom.aiTimer); dcRoom.aiTimer = null; }
        cancelStartCountdown(dcRoom); // 房間關閉:清掉自動開局倒數計時器
        rooms.delete(dcRoom.pin);
        console.log(`🗑️ 房間 ${dcRoom.pin} 已關閉`);
      } else {
        if (dcId === dcRoom.hostId) dcRoom.hostId = [...dcRoom.clients.keys()][0];
        broadcast(dcRoom);
      }
    }, 60000);
  });
}

// 一個 WebSocketServer 掛 http 伺服器,(若有)另一個掛 https 伺服器,共用 handleConnection
const httpWss = new WebSocketServer({ server: httpServer });
httpWss.on('connection', handleConnection);
const httpsWss = httpsServer ? new WebSocketServer({ server: httpsServer }) : null;
if (httpsWss) httpsWss.on('connection', handleConnection);

// 埠被佔用時給清楚指引(常見原因:之前的伺服器沒關乾淨,殭屍行程還霸佔著埠 →
// 網頁打不開[空回應],新伺服器又因 EADDRINUSE 起不來)。不印 stack trace,改印可直接照做的解法。
// 注意:ws 會把底層 http server 的 'error' 轉發到 WebSocketServer 實例(websocket-server.js),
// 所以監聽 wss 即可同時涵蓋 listen() 失敗;若只掛在 http server 上,wss 仍會因未處理而 throw。
// fatal=true(HTTP 主埠):整台無法服務 → 印解法後結束。
// fatal=false(HTTPS 副埠):桌機 HTTP 仍可用 → 只警告、保留 HTTP 繼續跑,不要把整台關掉。
function onListenError(label, port, fatal) {
  return err => {
    if (err.code === 'EADDRINUSE') {
      if (!fatal) {
        // HTTPS 副埠撞埠不致命:HTTP 照常服務,手機安全連線暫時關閉即可
        console.error(`\n⚠️  ${label}埠 ${port} 已被佔用 → 略過 HTTPS,桌機仍可用 http://localhost:${PORT}。`);
        console.error(`    想要手機 HTTPS:換個空閒副埠 →  npm start -- --https-port <空閒埠>  (或 $env:HTTPS_PORT=<空閒埠>; npm start)`);
        return; // 不 exit
      }
      console.error(`\n❌ ${label}埠 ${port} 已被佔用,伺服器無法啟動。`);
      console.error('   多半是上一個伺服器沒關乾淨(殭屍行程還霸佔著埠,網頁會打不開)。');
      console.error('   解法(擇一):');
      console.error(`     1) 換個埠啟動(任何系統都通用):  npm start -- --port <別的埠>`);
      console.error(`     2) 找出並關掉佔用者:  netstat -ano | findstr :${port}   然後  taskkill /PID <PID> /F`);
      console.error('     3) 關掉所有舊的本遊戲伺服器(PowerShell):');
      console.error("        Get-CimInstance Win32_Process -Filter \"Name='node.exe'\" | ? { $_.CommandLine -like '*server/server.js*' } | % { Stop-Process -Id $_.ProcessId -Force }");
    } else {
      console.error(`\n❌ ${label}伺服器啟動失敗:`, err.message);
      if (!fatal) return; // 副埠的其他錯誤也不致命
    }
    process.exit(1);
  };
}
httpWss.on('error', onListenError('HTTP ', PORT, true));
if (httpsWss) httpsWss.on('error', onListenError('HTTPS ', HTTPS_PORT, false));

httpServer.listen(PORT, '0.0.0.0', () => {
  console.log('===========================================');
  console.log('  🌏 賽博貿易戰 2049 — 伺服器已啟動');
  console.log('===========================================');
  console.log(`  本機:  http://localhost:${PORT}`);
  for (const u of lanUrls().filter(u => u.startsWith('http://')))
    console.log(`  區網:  ${u}  ← 桌機/同一 WiFi 用這個`);
  if (USE_HTTPS) {
    console.log('-------------------------------------------');
    console.log('  🔒 安全連線(手機建議用,網址要含 https 與這個埠):');
    for (const u of lanUrls().filter(u => u.startsWith('https://')))
      console.log(`  手機:  ${u}`);
    console.log('  ⚠️ 自簽憑證:手機首次開啟會出現安全警告,點「進階 / 仍要前往」即可。');
    console.log('  想免警告(行動裝置最穩):改用 Tailscale Serve 取得受信任憑證 →');
    console.log('     1) 後台開啟 MagicDNS + HTTPS Certificates');
    console.log(`     2) tailscale serve --bg ${PORT}`);
    console.log('     3) 手機開 https://<你的機器>.<tailnet>.ts.net');
  } else {
    console.log('  (Tailscale 使用者可用 tailscale IP:' + PORT + ')');
    console.log('-------------------------------------------');
    console.log('  💡 要讓手機用 HTTPS 安全連線:先跑 `npm run gen-cert` 產生憑證再重啟。');
  }
  console.log('===========================================');
});

if (httpsServer) httpsServer.listen(HTTPS_PORT, '0.0.0.0',
  () => console.log(`  🔒 HTTPS + WSS 已在埠 ${HTTPS_PORT} 啟動`));
