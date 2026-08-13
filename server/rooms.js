// ============ 房間中樞 RoomHub — 與傳輸層無關的房間/配對/戰鬥生命週期 ============
// 【單一真相縫】三種連線機制(雲端 / 區網 Tailscale / 單機)**共用這一支**:
//   ・雲端 & 區網:`server/server.js` 把每條 WebSocket 接成一個 session。
//   ・單機:`public/js/localhost.js` 在瀏覽器裡直接 new RoomHub(),session 是同步迴圈。
// 因此本檔 **MUST NOT** import 任何 Node 內建模組(http/fs/os/ws…),也 MUST NOT 碰 process/Buffer ——
// 一旦踩進去,單機版在瀏覽器就整支炸掉(稽核:`node tools/audit_net_modes.mjs`)。
// 訊息協定(t 欄位)是三種機制之間的唯一介面:client → recv(msg) / hub → send(msg)。
import { BattleSim } from './sim.js';
import { BotBrain } from './bots.js';
import {
  SIDES, GAME, TEAM, BOT_NAMES, CHARACTERS, lanesFor, resolveEnv,
  BOT_DIFF, DEFAULT_BOT_DIFF, MAPGEO, towerLayoutAudit, laneSeparationAudit, MINI, miniAllowed,
} from '../public/js/data.js';
// 操作方式(整房一致、房主定案)的合法值只有 ctrlmode.js 一份 —— 在這裡照抄一組字串
// 就是第二份選項表(新增第四種操控時必漏改)。該檔刻意零 import、頂層不碰 window ⇒
// Node 與瀏覽器(單機)都載得起來,與 data.js 同樣走鏡射佈局的相對路徑。
import { CTRL_MODES, DEFAULT_CTRL_MODE } from '../public/js/ctrlmode.js';
// 路網中繼的 payload 形狀/上限:房主送出前與伺服器收到後 MUST 是**同一支**淨化函式
// (在這裡照抄一組上限就是第二份會過期的規格)。該檔零 import、零模組級狀態 ⇒
// Node 與瀏覽器(單機)都載得起來,與 data.js 同樣走鏡射佈局的相對路徑。
import { sanitizeOsmRelay, osmRelayKey } from '../public/js/osmrelay.js';

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

function sanitizeName(s) {
  return String(s || '').replace(/[^\w一-鿿\- ]/g, '').trim().slice(0, 16) || '指揮官';
}
function genToken() {
  return Math.random().toString(36).slice(2) + Date.now().toString(36);
}

/** 開房前的戰場設定驗證:回傳錯誤訊息或 null(三種機制同標準,單機也照驗) */
export function validateBattleConfig(cfg, teamSize) {
  const L = lanesFor(teamSize);
  if (!cfg || !cfg.bases || !cfg.center || !Array.isArray(cfg.lanes)) return '戰場設定不完整,請先建立/選擇地圖';
  if (cfg.lanes.length !== L) return `隊伍 ${teamSize}v${teamSize} 需要 ${L} 條兵線(收到 ${cfg.lanes.length} 條)`;
  // 迷你地圖只開放 1v1 / 2v2(使用者定案)。這一道 MUST 在伺服器 —— 手機閘門住客戶端是因為
  // 「這台裝置畫不畫得動」只有客戶端知道,但「幾人可以打迷你地圖」是房間規則,對雙方對稱生效。
  const mini = !!cfg.mini;
  if (mini && !miniAllowed(teamSize)) {
    return `迷你地圖只開放 ${MINI.TEAM_MAX}v${MINI.TEAM_MAX} 以下(收到 ${teamSize}v${teamSize})`;
  }
  if (!(cfg.distM >= cfg.diagM * 0.8)) {
    return `主堡距離 ${Math.round(cfg.distM)}m 未達地圖對角線 80%(${Math.round(cfg.diagM * 0.8)}m)`;
  }
  // 規則 #4(權威把關):此兵線幾何佈出的砲塔會殘餘 >80% 重疊或疊塔 → 拒絕(自訂/預設同標準;客戶端掃描已預濾)
  // mini MUST 傳下去:迷你地圖沒有後塔,拿完整版的解來驗會擋掉本來合法的地圖(見 towerLayoutAudit)
  const game = lanesToGame(cfg.lanes);
  if (!game || !towerLayoutAudit(game, mini).ok) return '此地圖的兵線幾何無法符合砲塔佈局規則(砲塔射程重疊 >80% 或重疊),請改選其他推薦點或位置';
  // 規則(權威把關):同一 L 內兵線互不接觸/交叉(任兩線中段最近距離須 ≥ 20m 真實;含立體交叉亦禁)
  if (!laneSeparationAudit(game).ok) return '此地圖的兵線互相接觸或交叉(任兩線最近距離須 ≥ 20m),請改選其他推薦點或位置';
  return null;
}

/**
 * 地圖雙邊位置陣營隨機(2026-07-21):50% 機率對調兩主堡的陣營歸屬。同步反轉每條兵線的點序,
 * 維持 sim 約定「lane[0]≈bases.SWARM 主堡端」;反轉+換標只變點序不動幾何 → 兵線分離/塔位稽核不受影響。
 * 伺服器定案、隨 battleConfig 廣播全房 → 地形/出生/小地圖全客戶端一致。
 *
 * **每一場都要重擲**(2026-08-01 使用者回報「再戰不換邊」):擲點有兩個 —— 開房 + 再戰回房。
 * 只在開房擲的舊制等於「一間房定終身」,同一間房連打十場都從同一端開場,機制形同不存在。
 * 擲點 MUST 留在**房間階段**(createRoom / backToRoom),MUST NOT 移到 startBattle:客戶端的
 * 地形預建是在房間階段依 cfg 的 bases/lanes 起跑的(main.js prebuildKey 兩者都進 key),
 * 開戰當下才換 cfg = 整份預建作廢,載入畫面得從頭重建地形。
 * 對調只有這一支實作 —— 兩個擲點各抄一次,改規則必漏改其中一邊(稽核 audit_net_modes.mjs)。
 */
function rollSideSwap(cfg) {
  if (!cfg || Math.random() >= 0.5) return;      // 另外五成:維持原歸屬
  const t = cfg.bases.SWARM; cfg.bases.SWARM = cfg.bases.STEEL; cfg.bases.STEEL = t;
  cfg.lanes = cfg.lanes.map((l) => l.slice().reverse());
}

/**
 * room = {
 *   pin, id, hostId, phase: 'room'|'loading'|'game'|'over',
 *   config: { roomName, isPublic, teamSize, botDiff, ctrl },  // 每陣營 teamSize 席(1~5);
 *                                              // ctrl = 操作方式(整房一致,房主可隨時改)
 *   clients: Map<clientId, {send, name, side:'SWARM'|'STEEL'|null, mode:'player'|'spectator',
 *                           ready, loaded, connected, token}>,
 *   bots: Map<botId('b1'...), {name, side}>,   // 電腦玩家(房主增減,佔正式席位)
 *   battleConfig,          // 開房時就鎖定(地圖在開房前建立/選好)
 *   osm,                   // 路網中繼:{ key, bbox, feats, roads } —— 房主抓到的原始 OSM 圖資,
 *                          // 轉給全房 ⇒ 整房逐位元同一份世界(逐格單調,見 t:'osm')
 *   battle: BattleSim|null, botBrains: BotBrain[], tickTimer,
 * }
 */
export class RoomHub {
  /**
   * @param {object} opts
   *   urls()      → 加入網址清單(區網/Tailscale 用;雲端與單機回空陣列)
   *   log(msg)    → 記錄(伺服器給 console.log;單機給 no-op)
   *   maxRooms    → 房間數上限(0 = 不限)。雲端公開節點 MUST 設,免單一節點被開房洗掉
   *   dropMs      → 對局中斷線保留座位的毫秒數(單機可設 0:自己就是唯一玩家)
   *   noHumanMs   → 對局中「全部真人(玩家+觀戰)都斷線/離開」持續這麼久 → 直接結束該場遊戲並清房
   *                 (bot 對打沒人看是純空轉;座位 token 隨房失效,晚歸的回連會收到「座位已失效」)
   */
  constructor(opts = {}) {
    this.rooms = new Map();
    this.urls = opts.urls || (() => []);
    this.log = opts.log || (() => {});
    this.maxRooms = opts.maxRooms || 0;
    this.dropMs = opts.dropMs ?? 10 * 60 * 1000;
    this.noHumanMs = opts.noHumanMs ?? 60 * 1000;
    this._nextClientId = 1;
  }

  // ---------------- 統計(雲端健康檢查用)----------------
  stats() {
    let players = 0, battles = 0;
    for (const r of this.rooms.values()) {
      players += r.clients.size;
      if (r.battle) battles++;
    }
    return { rooms: this.rooms.size, players, battles };
  }

  // ---------------- 房間工具 ----------------
  _genPin() {
    let pin;
    do { pin = String(Math.floor(1000 + Math.random() * 9000)); } while (this.rooms.has(pin));
    return pin;
  }
  _genRoomId() {
    let id;
    do { id = 'r' + Math.random().toString(36).slice(2, 9); } while (this._findRoomById(id));
    return id;
  }
  _findRoomById(id) {
    if (!id) return null;
    for (const r of this.rooms.values()) if (r.id === id) return r;
    return null;
  }
  _hostNameOf(room) {
    const h = room.clients.get(room.hostId);
    return h ? h.name : '—';
  }
  /** 某陣營已佔席位數(真人 + 電腦) */
  _sideCount(room, side) {
    return [...room.clients.values()].filter((c) => c.side === side).length
      + [...room.bots.values()].filter((b) => b.side === side).length;
  }
  /** 在指定陣營補一名電腦玩家(已滿則不動作) */
  _addBotToSide(room, side) {
    if (this._sideCount(room, side) >= room.config.teamSize) return false;
    const id = 'b' + (++room.nextBotId);
    const used = new Set([...room.bots.values()].map((b) => b.name));
    const name = BOT_NAMES.find((n) => !used.has(n)) || `AI-${room.nextBotId}`;
    room.bots.set(id, { name, side });
    return true;
  }

  /** 大廳列表(公開房直接給 PIN 一鍵加入;私人房要輸入 PIN) */
  roomListPayload() {
    const out = [];
    for (const room of this.rooms.values()) {
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
        host: this._hostNameOf(room),
        // 操作方式:限定時要在**加入之前**看得到(手機玩家不該進了限定鍵鼠的房才發現沒搖桿)
        ctrl: room.config.ctrl || DEFAULT_CTRL_MODE,
        place: room.battleConfig?.placeName || null,
        env: room.battleConfig?.env || null,
        // 迷你地圖:同 ctrl,要在**加入之前**看得到 —— 只能打迷你地圖的裝置(手機)
        // 不該進了完整戰場的房才發現跑不動(閘門住客戶端,見 data.js miniOnlyFor)
        mini: !!room.battleConfig?.mini,
      };
      if (isPublic) e.pin = room.pin;
      out.push(e);
    }
    out.sort((a, b) => ((a.phase !== 'room') - (b.phase !== 'room')) || (b.isPublic - a.isPublic));
    return out;
  }

  /**
   * 房間已中繼到的 OSM 圖資(晚到的入房者 / 重連者補送用;沒有就回 null)。
   * 逐格可能只有一半(房主的第一輪只抓到路網,建物那格等它 90 秒後的補抓)——
   * 收件端的 `commitOsmIn` 是單調的,補上來的那一格會自己觸發一次重建。
   */
  osmPayload(room) {
    const o = room.osm;
    return o && (o.feats || o.roads) ? { t: 'osm', bbox: o.bbox, feats: o.feats, roads: o.roads } : null;
  }

  /** 廣播房間(大廳/配對)狀態 */
  broadcast(room) {
    const lobby = {
      pin: room.pin, phase: room.phase, urls: this.urls(), config: room.config,
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
      c.send({ t: 'sync', youId: id, token: c.token, isHost: id === room.hostId, lobby });
    }
  }

  leaveRoom(client, room, clientId) {
    room.clients.delete(clientId);
    if (room.clients.size === 0) {
      this.stopBattle(room);
      // PIN 可能已被回收再發(無真人逾時清房後 _genPin 會重用)—— 只刪仍指向本房的登記,
      // 免得晚到的 dropMs 清位計時器把別人的新房從 PIN 表上踢掉
      if (this.rooms.get(room.pin) === room) {
        this.rooms.delete(room.pin);
        this.log(`🧹 房間 ${room.pin} 已清除`);
      }
      return;
    }
    if (room.hostId === clientId) {
      room.hostId = [...room.clients.keys()][0];
      const h = room.clients.get(room.hostId);
      h.send({ t: 'info', msg: '👑 原房主離線,你成為新房主' });
    }
    this.broadcast(room);
  }

  // ---------------- 戰鬥生命週期 ----------------
  startBattle(room) {
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
    for (const c of room.clients.values()) c.send(field);
    let last = Date.now();
    room.noHumanAt = 0;   // 對局中無真人計時(見下方檢查)
    room.tickTimer = setInterval(() => {
      const now = Date.now();
      const dt = Math.min(0.5, (now - last) / 1000);
      last = now;
      // 無真人玩家逾時:全部真人(玩家+觀戰)都斷線/離開超過 noHumanMs → 直接結束該場遊戲。
      // 斷線座位靠 dropMs 保留等回連;但整房都沒真人時 bot 對打是純空轉,一分鐘沒人回來就收掉。
      if (this.noHumanMs > 0) {
        const anyHuman = [...room.clients.values()].some((c) => c.connected !== false);
        if (anyHuman) room.noHumanAt = 0;
        else if (!room.noHumanAt) room.noHumanAt = now;
        else if (now - room.noHumanAt >= this.noHumanMs) { this._endAbandoned(room); return; }
      }
      for (const brain of room.botBrains) brain.update(dt);
      room.battle.tick(dt);
      // 霧戰爭:各陣營依己方視野收到不同過濾後的快照;觀戰者收無霧全局快照。
      // 快照惰性產生(2026-08-05 手機單機效能):只算「在場收件者」需要的那幾份 ——
      // 單機恆只有一個真人,固定算三份 = 每 tick 把 2/3 的序列化與敵方視野過濾直接丟掉。
      // 內容逐位元不變;同 tick 首份快照沖洗 events 的共用語意(sim._frame)不受影響。
      const snaps = {};
      for (const c of room.clients.values()) {
        const k = c.side === 'SWARM' || c.side === 'STEEL' ? c.side : 'all';   // 未定/非法 side 照舊收無霧份
        c.send(snaps[k] ??= room.battle.snapshotFor(k === 'all' ? null : k));
      }
      if (room.battle.over) {
        room.phase = 'over';
        this.stopBattle(room, /*keepPhase*/ true);
        this.broadcast(room);
      }
    }, GAME.TICK_MS);
    this.broadcast(room);
    this.log(`⚔️ 房間 ${room.pin} 開戰:${room.battleConfig.placeName || '未知戰區'}`);
  }

  stopBattle(room, keepPhase = false) {
    if (room.tickTimer) { clearInterval(room.tickTimer); room.tickTimer = null; }
    room.botBrains = [];
    if (!keepPhase) room.battle = null;
  }

  /** 對局中無真人玩家逾時:直接結束該場遊戲並清房。
      清空座位讓 dropMs 到期的清位計時器自然 no-op;token 隨房失效,晚歸的回連會收到「座位已失效」。 */
  _endAbandoned(room) {
    this.stopBattle(room);
    if (this.rooms.get(room.pin) === room) this.rooms.delete(room.pin);
    room.clients.clear();
    this.log(`⏱ 房間 ${room.pin} 對局中無真人玩家逾 ${Math.round(this.noHumanMs / 1000)} 秒,已結束對局並清除`);
  }

  /** 雙方玩家都載入完地形 → 開戰(單人測試:一個玩家也可開) */
  maybeLaunch(room) {
    if (room.phase !== 'loading') return;
    const players = [...room.clients.values()].filter((c) => c.mode === 'player' && c.side);
    if (players.length > 0 && players.every((c) => c.loaded)) this.startBattle(room);
  }

  /** 全部房間停 tick(單機切走 / 伺服器關機):MUST 呼叫,否則 setInterval 留著空轉 */
  shutdown() {
    for (const room of this.rooms.values()) this.stopBattle(room);
    this.rooms.clear();
  }

  // ---------------- 連線 session ----------------
  /**
   * 接上一條連線。`send(msg)` = 把訊息送給該客戶端(WS 傳輸就 JSON.stringify;單機直接呼叫 handler)。
   * 回傳 { id, recv(msg), close() } —— 傳輸層只需轉接這兩個入口。
   */
  attach(send) {
    const hub = this;
    const clientId = this._nextClientId++;
    let room = null;
    let client = null;
    // 本 session 在房內的**座位鍵**:座位在 room.clients 的鍵、英雄在 sim.heroes 的 pid、hostId 的比對對象
    // 全都是「建立座位那條 session」的 clientId。reattach 認回舊座位後 MUST 沿用原鍵 ——
    // 用新連線的 clientId 會讓 pos/開火全被 sim 靜默丟棄(查無英雄)、房主權限失效、
    // leaveRoom/清位刪錯鍵(座位永遠留著 → 殭屍房間,首頁一直看得到無人 bot 對局)。
    let myId = clientId;

    const recv = (m) => {
      if (!m || typeof m.t !== 'string') return;

      // ---- 大廳 ----
      if (m.t === 'createRoom') {
        // 地圖在開房前就要建立/選擇好:createRoom 必須帶合法 battleConfig
        if (hub.maxRooms && hub.rooms.size >= hub.maxRooms) {
          send({ t: 'error', msg: `本節點戰區已達上限(${hub.maxRooms} 間),請稍後再試或加入現有戰區` });
          return;
        }
        const teamSize = Math.max(TEAM.MIN, Math.min(TEAM.MAX, Math.round(m.teamSize) || TEAM.DEFAULT));
        const cfg = m.battleConfig;
        const err = validateBattleConfig(cfg, teamSize);
        if (err) { send({ t: 'error', msg: err }); return; }
        cfg.env = resolveEnv(cfg.env || {});   // 隨機項在此定案,全房共用同一組環境
        // 攻堅順序(前線塔 → 中段塔 → 主堡;劇情戰役開房時帶上)。**MUST 在這裡正規化成布林**:
        // battleConfig 整包由客戶端送上來,原樣塞進 sim 等於讓對方決定「什麼算真」(A1 家族)。
        // 這是房間規則(同 botDiff),對雙方對稱生效。
        cfg.siege = !!cfg.siege;
        // 迷你地圖(塔位階數 / 地圖尺度 / 緩衝深度全由它推導)同理正規化成布林。
        // 幾何本身是客戶端算好送上來的,這一格只保證伺服器與全房讀到同一個型別的旗標。
        cfg.mini = !!cfg.mini;
        rollSideSwap(cfg);                     // 主堡陣營歸屬 50% 對調(再戰時於 backToRoom 重擲)
        cfg.teamSize = teamSize;
        const pin = hub._genPin();
        client = { send, name: sanitizeName(m.name), side: null, mode: 'player', ready: false, loaded: false, connected: true, token: genToken() };
        room = {
          pin, id: hub._genRoomId(), hostId: myId, phase: 'room',
          config: {
            roomName: sanitizeName(m.roomName) || `${client.name} 的戰區`,
            isPublic: m.isPublic !== false, teamSize,
            botDiff: BOT_DIFF[m.botDiff] ? m.botDiff : DEFAULT_BOT_DIFF,
            // 操作方式:開房時取房主的預設,之後由房主經 setRoomConfig 變更(整房一致)
            ctrl: CTRL_MODES[m.ctrl] ? m.ctrl : DEFAULT_CTRL_MODE,
          },
          clients: new Map([[myId, client]]),
          bots: new Map(), nextBotId: 0, botBrains: [],
          battle: null, battleConfig: cfg, tickTimer: null,
        };
        hub.rooms.set(pin, room);
        hub.log(`🏠 建立房間 ${pin}(${room.config.roomName}・${teamSize}v${teamSize}・${cfg.placeName || '未知戰區'})`);
        hub.broadcast(room);
        return;
      }
      if (m.t === 'listRooms') { send({ t: 'rooms', rooms: hub.roomListPayload() }); return; }
      if (m.t === 'joinRoom') {
        const r = hub.rooms.get(String(m.pin));
        if (!r) { send({ t: 'error', msg: '找不到房間,確認 PIN 是否正確' }); return; }
        const mode = m.mode === 'spectator' ? 'spectator' : 'player';
        const players = [...r.clients.values()].filter((c) => c.mode === 'player').length + r.bots.size;
        const cap = r.config.teamSize * 2;
        if (mode === 'player' && players >= cap) { send({ t: 'error', msg: `參戰席位已滿(${cap} 人),可用觀戰模式加入` }); return; }
        client = { send, name: sanitizeName(m.name), side: null, mode, ready: false, loaded: false, connected: true, token: genToken() };
        room = r;
        room.clients.set(myId, client);
        hub.broadcast(room);
        // 路網中繼:房主早就上傳完了 ⇒ 晚到的人立刻補一份(**所有階段**都要,房間階段
        // 才是主要情境 —— 客戶端一收到 sync 就開始預建,這一則決定它建的是哪一張圖)。
        // MUST NOT 塞進 `sync`:那則會重播多次,幾百 KB 乘上去不可接受(§7.4-1)。
        const relay = hub.osmPayload(room);
        if (relay) send(relay);
        // 加入中途對局:立即補送階段與戰場設定(含危險區)
        if (room.phase === 'game' || room.phase === 'loading') {
          send({ t: 'battleConfig', config: room.battleConfig });
          if (room.battle) send(room.battle.fieldPayload());
        }
        return;
      }
      if (m.t === 'reattach') {
        // 斷線重連:用 token 認回原座位
        for (const r of hub.rooms.values()) {
          for (const [id, c] of r.clients) {
            if (c.token === m.token) {
              c.send = send; c.connected = true;
              room = r; client = c; myId = id;   // 認回原座位鍵(英雄 pid / hostId / 清位全靠它)
              hub.broadcast(room);
              const relay = hub.osmPayload(room);   // 重連後可能整份預建要重來 → 圖資照樣要跟上
              if (relay) send(relay);
              if (room.battleConfig && (room.phase === 'loading' || room.phase === 'game')) {
                send({ t: 'battleConfig', config: room.battleConfig });
                if (room.battle) send(room.battle.fieldPayload());
              }
              return;
            }
          }
        }
        // code:'reattach' → 客戶端據此清掉過期憑證(免每次開頁都吃一次錯誤),不影響其他錯誤處理
        send({ t: 'error', code: 'reattach', msg: '重連失敗:座位已失效,請重新加入' });
        return;
      }

      if (!room || !client) return;

      // ---- 房間配對 ----
      if (m.t === 'pickSide') {
        const side = m.side === 'SWARM' || m.side === 'STEEL' ? m.side : null;
        if (client.mode !== 'player') { send({ t: 'error', msg: '觀戰者不能選陣營' }); return; }
        if (side && side !== client.side) {
          const n = hub._sideCount(room, side) - (client.side === side ? 1 : 0);
          if (n >= room.config.teamSize) { send({ t: 'error', msg: `${SIDES[side].name} 已滿(${room.config.teamSize} 席)` }); return; }
        }
        client.side = side;
        client.ready = false;
        client.ch = null;   // 換陣營:角色重選(角色綁陣營)
        hub.broadcast(room);
        return;
      }
      if (m.t === 'pickChar') {
        // 開戰前選角(不選 = 開戰時隨機);角色必須屬於自己的陣營,傭兵雙陣營皆可
        if (room.phase !== 'room' || client.mode !== 'player') return;
        if (m.ch == null) { client.ch = null; hub.broadcast(room); return; }
        const c = CHARACTERS[m.ch];
        if (!c || !client.side || (c.side !== client.side && c.side !== 'MERC')) { send({ t: 'error', msg: '角色與陣營不符' }); return; }
        client.ch = m.ch;
        hub.broadcast(room);
        return;
      }
      if (m.t === 'setReady') { client.ready = !!m.ready; hub.broadcast(room); return; }
      if (m.t === 'addBot') {
        // 電腦玩家:房主在房間階段補位(單人練習 / 湊隊)
        if (myId !== room.hostId) { send({ t: 'error', msg: '只有房主能增減電腦玩家' }); return; }
        if (room.phase !== 'room') return;
        const side = m.side === 'SWARM' || m.side === 'STEEL' ? m.side : null;
        if (!side) return;
        if (!hub._addBotToSide(room, side)) { send({ t: 'error', msg: `${SIDES[side].name} 已滿(${room.config.teamSize} 席)` }); return; }
        hub.broadcast(room);
        return;
      }
      if (m.t === 'setBotChar') {
        // 房主替電腦玩家指定角色(null = 開戰時隨機,與真人 pickChar 同語意)
        if (myId !== room.hostId) { send({ t: 'error', msg: '只有房主能設定電腦玩家' }); return; }
        if (room.phase !== 'room') return;
        const bot = room.bots.get(String(m.id));
        if (!bot) return;
        if (m.ch == null) { bot.ch = null; hub.broadcast(room); return; }
        const c = CHARACTERS[m.ch];
        if (!c || (c.side !== bot.side && c.side !== 'MERC')) { send({ t: 'error', msg: '角色與陣營不符' }); return; }
        bot.ch = m.ch;
        hub.broadcast(room);
        return;
      }
      if (m.t === 'removeBot') {
        if (myId !== room.hostId || room.phase !== 'room') return;
        room.bots.delete(String(m.id));
        hub.broadcast(room);
        return;
      }
      if (m.t === 'setRoomConfig' && myId === room.hostId) {
        if (m.roomName !== undefined) room.config.roomName = sanitizeName(m.roomName);
        if (m.isPublic !== undefined) room.config.isPublic = !!m.isPublic;
        if (m.botDiff !== undefined && BOT_DIFF[m.botDiff]) room.config.botDiff = m.botDiff;
        // 操作方式整房一致 ⇒ 只有房主改得動(非房主的訊息在本 if 就被擋掉),
        // 非法值一律靜默忽略(降級不例外);廣播出去才是客戶端的生效值。
        if (m.ctrl !== undefined && CTRL_MODES[m.ctrl]) room.config.ctrl = m.ctrl;
        hub.broadcast(room);
        return;
      }
      if (m.t === 'startBattle') {
        // 房主開戰(地圖開房時已鎖定):至少 1 位已選陣營並準備
        if (myId !== room.hostId) { send({ t: 'error', msg: '只有房主能開戰' }); return; }
        if (room.phase !== 'room') return;
        const players = [...room.clients.values()].filter((c) => c.mode === 'player' && c.side);
        if (players.length === 0) { send({ t: 'error', msg: '請先選擇陣營' }); return; }
        if (!players.every((c) => c.ready)) { send({ t: 'error', msg: '還有指揮官未按「準備完成」' }); return; }
        // 人數不足一律補電腦玩家到滿編(取消單人練習模式)
        for (const side of ['SWARM', 'STEEL']) {
          while (hub._addBotToSide(room, side)) { /* 補到滿編為止 */ }
        }
        room.phase = 'loading';
        for (const c of room.clients.values()) { c.loaded = false; c.send({ t: 'battleConfig', config: room.battleConfig }); }
        hub.broadcast(room);
        return;
      }
      if (m.t === 'loaded') { client.loaded = true; hub.broadcast(room); hub.maybeLaunch(room); return; }
      if (m.t === 'world') {
        // 房主上傳世界障礙(建物/神木/巨岩碰撞柱)+ 立體交通走廊(sim 座標)。
        // 通常先於開戰抵達(存房間,startBattle 套用);房主是觀戰者時可能晚到 → 直接套用進行中的 sim
        // (LOS 即時生效;走廊內障礙從快照消失,客戶端自動收掉)。非房主來源一律丟棄。
        if (myId === room.hostId && m.occ) {
          room.world = { occ: m.occ, cor: m.cor, wet: m.wet, slabs: m.slabs, hgt: m.hgt };   // wet:水沼粗網格;slabs:橋面/隧道天花薄板(LOS);hgt:粗高程網格(稜線遮蔽,避免隔山打牛)
          if (room.battle) room.battle.setWorld(room.world);
        }
        return;
      }
      if (m.t === 'osm') {
        // ---- 路網中繼(2026-08-10 使用者定案「圖資儲存在開房者,再由開房者透過 server 傳給入房者」)----
        // 房主上傳它抓到的原始 Overpass 圖資 → 存房間一份 → 轉給其他人。修的是**既有**的
        // 跨客戶端分家:今天每台各自抓,A 抓到而 B 被限流時兩人的橋隧/建物/碰撞柱全不一樣。
        // 三條紀律:
        //  ① **不可信輸入**:房主送什麼都要過 `sanitizeOsmRelay`(形狀 + 筆數上限),
        //     而且存進房間的 MUST 是它回傳的**新物件** —— 單機模式的 hub 跑在同一個分頁裡,
        //     直接存 `m.roads` 會與客戶端共用參照,而下游是就地變異那些陣列的。
        //  ② **單調**:已定案的格 MUST NOT 被覆蓋。路網可以從無到有(房主 90 秒後重試成功),
        //     但**換掉**已經發出去的那一份,等於同一間房裡有人用 v1、有人用 v2。
        //  ③ **MUST NOT 碰 `room.battleConfig`**:座標框(含地圖主方位 θ)在開房當下就凍結,
        //     中繼只搬路網。選角途中把整房的世界轉一次,比抓不到圖資嚴重得多(A42 ③)。
        // 房間清掉時整份隨 room 物件回收(雲端 `--max-rooms` × 單房上限 = 記憶體上界)。
        if (myId !== room.hostId) return;
        const clean = sanitizeOsmRelay(m);
        if (!clean) return;
        const key = osmRelayKey(clean.bbox);
        if (!room.osm) room.osm = { key, bbox: clean.bbox, feats: null, roads: null };
        if (room.osm.key !== key) return;      // 換圖了才會不同鍵 —— 那份中繼不屬於這一房
        const add = { t: 'osm', bbox: room.osm.bbox, feats: null, roads: null };
        if (!room.osm.feats && clean.feats) add.feats = room.osm.feats = clean.feats;
        if (!room.osm.roads && clean.roads) add.roads = room.osm.roads = clean.roads;
        if (!add.feats && !add.roads) return;  // 沒有新的格 ⇒ 不轉播(免得入房者白重建一次)
        for (const [id, c] of room.clients) if (id !== myId) c.send(add);
        return;
      }

      // ---- 戰鬥中 ----
      const b = room.battle;
      if (!b) {
        if (m.t === 'leaveRoom') { hub.leaveRoom(client, room, myId); room = null; client = null; }
        return;
      }
      if (m.t === 'pos' && client.side) { b.heroPos(myId, m.x, m.y, m.z, m.ry, m.wet, m.lev, m.ay); return; }
      if (m.t === 'aim' && client.side) { b.heroAim(myId, m.on); return; }
      if (m.t === 'hit' && client.side) { b.heroHit(myId, m.id, m.w); return; }
      if (m.t === 'hitMissile' && client.side) { b.hitMissile(myId, m.id, m.w); return; }
      if (m.t === 'burst' && client.side) { b.heroBurst(myId, m.x, m.z, m.y, m.lev); return; }   // y = 對空引爆高度 / lev = 爆點結構層(sim 夾範圍)
      if (m.t === 'plasma' && client.side) { b.heroPlasma(myId, m.dx, m.dz, m.slot, m.o); return; }   // o=[x,z,y] 槍口 = 射程球心(與 lance 同一組約定)
      if (m.t === 'lance' && client.side) { b.heroLance(myId, m.o, m.d, m.len); return; }   // 直線貫穿(beam/rail/gun 重武器):o=[x,z,y] 槍口 / d=[dx,dz,dy] 射向 / len=射線長
      // 機種絕招的三條訊息(kami / decoy / hyper)2026-08-06 整組退場,MUST NOT 復辟:
      // 長按右鍵改成招式手勢(一般 = 小招 / 狙擊 = 大招)⇒ 一律走下面的 't: cast' 單一縫,
      // 三種載具只剩「大招遞送」這一個身分(sim._launchUltCarrier)。
      if (m.t === 'swap' && client.side) { b.heroSwap(myId, m.i); return; }
      if (m.t === 'lock' && client.side) { b.heroLock(myId, m.id); return; }
      if (m.t === 'civ' && client.side) { b.civInteract(myId, m.id, m.act); return; }   // 平民互動:跟隨/驅趕
      if (m.t === 'cast' && client.side) { b.heroCast(myId, m.slot, m.x, m.z); return; }
      if (m.t === 'iframe' && client.side) { b.heroIframe(myId); return; }   // 蓄力跳/變形中段無敵幀(CD 由 sim 把關)
      if (m.t === 'reload' && client.side) { b.heroReload(myId, m.w); return; }
      if (m.t === 'buy' && client.side) {
        const err = b.buy(myId, m.item, m.lane);   // lane 只有 item==='creep'(陣營小兵強化)會用到
        if (err) send({ t: 'error', msg: err });
        return;
      }
      if (m.t === 'tracer') {
        // 純視覺:轉播給其他客戶端畫彈道;pid 供接收端驅動射手機體的開火動畫(比照 heavyCharge,伺服器附上,不信任客戶端)
        // mv:拋物線武器的實際初速(火控解的裝藥號數;純視覺轉播,讓對方畫出與射手同一條弧)
        for (const [id, c] of room.clients) if (id !== myId) c.send({ t: 'tracer', pid: myId, from: m.from, to: m.to, side: client.side, slot: m.slot, hit: m.hit, mv: m.mv });
        return;
      }
      if (m.t === 'heavyCharge' && client.side) {
        // 純視覺:即時轉播 rail 重武器蓄力狀態(third-person 掛點動畫),不進 sim 快照(不等 8Hz)
        for (const [id, c] of room.clients) if (id !== myId) c.send({ t: 'heavyCharge', pid: myId, on: !!m.on });
        return;
      }
      if (m.t === 'heavyFire' && client.side) {
        // 純視覺:即時轉播重武器擊發瞬間(third-person 掛點動畫)
        for (const [id, c] of room.clients) if (id !== myId) c.send({ t: 'heavyFire', pid: myId });
        return;
      }
      if (m.t === 'backToRoom' && myId === room.hostId) {
        // 回到房間再戰:地圖屬於房間(開房前選定),保留 battleConfig
        hub.stopBattle(room);
        room.battle = null; room.phase = 'room';
        // 但主堡的陣營歸屬**重擲**:下一場有五成機率換邊(見 rollSideSwap)。
        // 廣播出去的 sync 帶著新 cfg → 客戶端在房間階段重跑預建(prebuildKey 吃 bases/lanes)。
        rollSideSwap(room.battleConfig);
        for (const c of room.clients.values()) { c.ready = false; c.loaded = false; }
        hub.broadcast(room);
        return;
      }
      if (m.t === 'leaveRoom') { hub.leaveRoom(client, room, myId); room = null; client = null; }
    };

    const close = () => {
      if (!room || !client) return;
      // 座位已被更新的連線用 reattach 認走(本 session 是殭屍舊 socket,close 晚到)→ MUST NOT 動座位:
      // 標成斷線會讓「無真人逾時」把還有真人在玩的對局收掉。send 是否還指向本 session = 座位歸屬的唯一判準。
      if (client.send !== send) return;
      client.connected = false;
      // 對局中保留座位等重連;房間階段直接離座
      if (room.phase === 'room' || hub.dropMs <= 0) {
        hub.leaveRoom(client, room, myId);
      } else {
        hub.broadcast(room);
        // 一段時間沒回來就清位
        const c0 = client, r0 = room, id0 = myId;
        setTimeout(() => {
          if (c0.connected === false && r0.clients.get(id0) === c0) {
            hub.leaveRoom(c0, r0, id0);
          }
        }, hub.dropMs);
      }
    };

    return { id: clientId, recv, close };
  }
}
