// ============ RoomHub — transport-independent room/matchmaking/battle lifecycle ============
// Single seam: cloud / LAN-over-Tailscale / solo share this file:
//   - cloud & LAN: `server/server.js` attaches each WebSocket as a session.
//   - solo: `public/js/localhost.js` news a RoomHub in-tab with synchronous sessions.
// Hence this file MUST NOT import Node builtins (http/fs/os/ws...) nor touch
// process/Buffer -- solo would explode in the browser (guard: `node tools/audit_net_modes.mjs`).
// The message protocol (t field) is the only cross-mode interface: client -> recv(msg) / hub -> send(msg).
import { BattleSim } from './sim.js';
import { BotBrain } from './bots.js';
import {
  SIDES, GAME, TEAM, BOT_NAMES, CHARACTERS, resolveEnv,
  BOT_DIFF, DEFAULT_BOT_DIFF, MAPGEO, towerLayoutAudit, laneSeparationAudit,
  laneCountFor, mapArg, mapPlan,
} from '../public/js/data.js';
// Control-mode values (room-wide, host-finalized) live only in ctrlmode.js -- copying the
// strings here would fork a second option table (a fourth mode would miss one copy). That file
// stays zero-import with no top-level window access, so Node and in-tab solo both load it
// via the same mirrored-layout relative path as data.js.
import { CTRL_MODES, DEFAULT_CTRL_MODE } from '../public/js/ctrlmode.js';
import { evidenceFrame, evidenceFrameKey } from '../public/js/mapEvidence.js';
import { sanitizeEvidenceRelay } from '../public/js/mapEvidenceRelay.js';
// Road-relay payload shape/limits: host-side send and server-side receive MUST share the single
// sanitizer (a copied limit set here would rot). That module keeps zero imports and zero
// module-level state for the same dual-runtime reason.
import { sanitizeOsmRelay, osmRelayKey } from '../public/js/osmrelay.js';
// Extended-map seams (zero Node API, shared with solo): mix-clamping truth lives in mapgen;
// the validator reads results without rewriting formulas.
import { MAX_WATER_WET, sanitizeProcRelief } from '../public/js/mapgen.js';

// Lanes (lat/lng) -> game meters (arbitrary origin; towerLayoutAudit uses relative distances only). Same conversion as mapSelect / baking.
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

/** Pre-room battlefield-config validation: returns an error message or null (same bar across all three modes, solo included) */
export function validateBattleConfig(cfg, teamSize) {
  if (!cfg || !cfg.bases || !cfg.center || !Array.isArray(cfg.lanes)) return '戰場設定不完整,請先建立/選擇地圖';
  // Map kind (standard / story campaign) has one reading in `mapArg` -- shared with solveTowerSites,
  // scale functions, and lane counts, so validation and generation can never disagree on a battle's kind.
  // Geometry checks below consume client-submitted JSON; a malformed shape (map/number/array)
  // throws TypeError deep inside -- so MUST return error strings, MUST NOT throw: a throw
  // exits the whole server process = every room disconnects. The host sees one sentence, not a fleet-wide outage.
  try {
    const mapA = mapArg(cfg);
  const plan = mapPlan(mapA);
  const L = laneCountFor(teamSize, mapA);
  if (cfg.lanes.length !== L) {
    return plan.mode === 'story'
      ? `劇情戰役恆為 ${L} 條兵線(收到 ${cfg.lanes.length} 條)`
      : `隊伍 ${teamSize}v${teamSize} 需要 ${L} 條兵線(收到 ${cfg.lanes.length} 條)`;
  }
  if (!(cfg.distM >= cfg.diagM * 0.8)) {
    return `主堡距離 ${Math.round(cfg.distM)}m 未達地圖對角線 80%(${Math.round(cfg.diagM * 0.8)}m)`;
  }
  // Rule #4 (authoritative gate): tower layout from this lane geometry would leave >80% overlap or stacked towers -> reject (same bar for custom/preset; client scan pre-filters)
  // Pass the kind through: story mode builds towers on one side only, so validating against the full solution checks
  // towers that will never spawn and would block otherwise legal maps (see towerLayoutAudit)
  const game = lanesToGame(cfg.lanes);
  if (!game || !towerLayoutAudit(game, mapA).ok) return '此地圖的兵線幾何無法符合砲塔佈局規則(砲塔射程重疊 >80% 或重疊),請改選其他推薦點或位置';
  // Rule (authoritative gate): lanes within one L never touch/cross (closest mid-segment distance >= 20m real; 3D crossings also banned)
  if (!laneSeparationAudit(game).ok) return '此地圖的兵線互相接觸或交叉(任兩線最近距離須 ≥ 20m),請改選其他推薦點或位置';
  // Rule (authoritative gate): terrain water+marsh <= 50% (mixed/random map clamp; threshold lives in mapgen.js MAX_WATER_WET)
  if (cfg.venue && cfg.venue.mix) {
    const m = cfg.venue.mix;
    const ww = (Number(m.water) || 0) + (Number(m.wet) || 0);
    if (!(ww <= MAX_WATER_WET + 1e-9)) return `此地圖水域+沼澤占比 ${(ww * 100).toFixed(0)}% 超過上限 50%,請重新生成`;
  }
  return null;
  } catch {
    return '戰場設定格式異常,請重新建立/選擇地圖';
  }
}

/**
 * Randomize which side holds which base position (2026-07-21): 50% chance to swap the two bases side assignment. Reverse every lane point order
 * to keep the sim invariant "lane[0] ~= bases.SWARM base end"; reversal + relabel changes order only, geometry untouched -> lane separation/tower audit unaffected.
 * Server decides, broadcast with battleConfig to the whole room -> terrain/spawns/minimap agree on every client.
 *
 * Re-roll EVERY game (2026-08-01 user decision "rematch never swaps sides"): two roll points -- createRoom + rematch backToRoom.
 * Rolling only at creation equals "one room, one side for life", ten straight games from the same end, mechanism effectively dead.
 * Rolls MUST stay in the ROOM phase (createRoom / backToRoom), MUST NOT move to startBattle: client terrain
 * prebuild starts in room phase from cfg bases/lanes (both enter main.js prebuildKey),
 * swapping cfg at launch invalidates the whole prebuild and the loading screen rebuilds terrain from scratch.
 * Only this function implements the swap -- copying it at both roll points means a rule change will miss one side (audit audit_net_modes.mjs).
 */
function rollSideSwap(cfg) {
  if (!cfg || Math.random() >= 0.5) return;      // Other half: keep original assignment
  const t = cfg.bases.SWARM; cfg.bases.SWARM = cfg.bases.STEEL; cfg.bases.STEEL = t;
  cfg.lanes = cfg.lanes.map((l) => l.slice().reverse());
  // Mother reversed together (laneIds are mother indices, still point at the same lanes unmoved)
  if (Array.isArray(cfg.motherLanes)) cfg.motherLanes = cfg.motherLanes.map((l) => l.slice().reverse());
}

/**
 * room = {
 *   pin, id, hostId, phase: 'room'|'loading'|'game'|'over',
 *   config: { roomName, isPublic, teamSize, botDiff, ctrl },  // teamSize seats per side (1~5);
 *                                              // ctrl = control scheme (room-wide, host may change anytime)
 *   clients: Map<clientId, {send, name, side:'SWARM'|'STEEL'|null, mode:'player'|'spectator',
 *                           ready, loaded, connected, token}>,
 *   bots: Map<botId('b1'...), {name, side}>,   // Bots (host adds/removes, occupy real seats)
 *   battleConfig,          // Locked at creation (map built/selected before opening)
 *   osm,                   // Road relay:{ key, bbox, areas, pointFeatures, roads } -- host-fetched raw OSM data,
 *                          // relayed room-wide => whole room shares one bit-identical world (monotone per cell, see t:'osm')
 *   battle: BattleSim|null, botBrains: BotBrain[], tickTimer,
 * }
 */
export class RoomHub {
  /**
   * @param {object} opts
   *   urls()      -> join URL list (LAN/Tailscale; cloud and solo return empty)
   *   log(msg)    -> logging (server passes console.log; solo passes no-op)
   *   maxRooms    -> room cap (0 = unlimited). Public cloud nodes MUST set it, else one node gets room-flooded
   *   dropMs      -> ms to hold an in-game seat across disconnects (solo may use 0: self is the only player)
   *   noHumanMs   -> in-game "all humans (players+spectators) gone" for this long -> end the game and drop the room
   *                 (bot-vs-bot with nobody watching is pure idle; seat tokens die with the room, late reattach gets "seat expired")
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

  // ---------------- Stats (cloud health check) ----------------
  stats() {
    let players = 0, battles = 0;
    for (const r of this.rooms.values()) {
      players += r.clients.size;
      if (r.battle) battles++;
    }
    return { rooms: this.rooms.size, players, battles };
  }

  // ---------------- Room helpers ----------------
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
  /** Occupied seats on a side (humans + bots) */
  _sideCount(room, side) {
    return [...room.clients.values()].filter((c) => c.side === side).length
      + [...room.bots.values()].filter((b) => b.side === side).length;
  }
  /** Fill one bot on the given side (no-op when full) */
  _addBotToSide(room, side) {
    if (this._sideCount(room, side) >= room.config.teamSize) return false;
    const id = 'b' + (++room.nextBotId);
    const used = new Set([...room.bots.values()].map((b) => b.name));
    const name = BOT_NAMES.find((n) => !used.has(n)) || `AI-${room.nextBotId}`;
    room.bots.set(id, { name, side });
    return true;
  }

  /** Lobby list (public rooms hand out PIN for one-click join; private rooms require typing PIN) */
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
          // SUPER seat appears only in super rooms (normal rooms omit the key => list stays bit-identical to old)
          ...(room.battleConfig?.super
            ? { SUPER: players.filter((c) => c.side === 'SUPER').map((c) => c.name) } : {}),
        },
        host: this._hostNameOf(room),
        // Control scheme: must be visible BEFORE joining (phone players should not enter a KB-only room before learning there is no stick)
        ctrl: room.config.ctrl || DEFAULT_CTRL_MODE,
        place: room.battleConfig?.placeName || null,
        env: room.battleConfig?.env || null,
        // Super battle: solo third-party mode (visible before joining, non-super rooms omit SUPER seat => list stays bit-identical to old)
        super: !!room.battleConfig?.super,
      };
      if (isPublic) e.pin = room.pin;
      out.push(e);
    }
    out.sort((a, b) => ((a.phase !== 'room') - (b.phase !== 'room')) || (b.isPublic - a.isPublic));
    return out;
  }

  /**
   * OSM data already relayed to this room (resend for late joiners / reconnects; null when none).
   * Cells may arrive halved (host first round fetched roads only, building cell follows 90s later) --
   * the receiver `commitOsmIn` is monotone, the late cell triggers its own rebuild.
   */
  osmPayload(room) {
    const o = room.osm;
    return o ? {
      t: 'osm', bbox: o.bbox, areas: o.areas, pointFeatures: o.pointFeatures,
      roads: o.roads, drop: o.drop || 0,
    } : null;
  }

  /** Broadcast room (lobby/matchmaking) state */
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
      try {
        c.send({ t: 'sync', youId: id, token: c.token, isHost: id === room.hostId, lobby });
      } catch { /* one dead connection does not block room broadcast, heartbeat/disconnect flow reaps it */ }
    }
  }

  leaveRoom(client, room, clientId) {
    room.clients.delete(clientId);
    if (room.clients.size === 0) {
      this.stopBattle(room);
      // PIN may have been recycled (abandoned-room reap frees _genPin for reuse) -- only delete the registration still pointing at this room,
      // so a late dropMs seat-clear timer does not kick someone else's new room off the PIN table
      if (this.rooms.get(room.pin) === room) {
        this.rooms.delete(room.pin);
        this.log(`🧹 房間 ${room.pin} 已清除`);
      }
      return;
    }
    if (room.hostId === clientId) {
      room.hostId = [...room.clients.keys()][0];
      const h = room.clients.get(room.hostId);
      try { h.send({ t: 'info', msg: '👑 原房主離線,你成為新房主' }); } catch { /* skip when the new host connection is dead, seat handoff still stands */ }
    }
    this.broadcast(room);
  }

  // ---------------- Battle lifecycle ----------------
  startBattle(room) {
    if (room.battle || !room.battleConfig) return;
    try {
    // world passed at construction -> water/marsh coarse grid ready before first placement (neutrals avoid water from the start); LOS/corridor clearing still goes through setWorld below.
    room.battle = new BattleSim(room.battleConfig, room.world || null);
    // World obstacles (uploaded when host loads the map, kept per room -> rematch reuses):
    // MUST apply before fieldPayload broadcast -- corridor clearing removes third-party obstacles and mines under tunnels/bridges.
    if (room.world) room.battle.setWorld(room.world);
    // Role assignment: pre-picked players first; unpicked (default random) drawn by addHero from unused same-side roles
    for (const [id, c] of room.clients) {
      if (c.mode === 'player' && c.side) {
        const h = room.battle.addHero(c.side, id, c.ch);
        c.ch = h.ch;   // Write back actual role (random result), lobby broadcasts it to everyone
      }
    }
    // Bots: server-side AI drives heroes, lanes assigned round-robin (NPC routes = room lanes)
    room.botBrains = [...room.bots.entries()].map(([bid, b], i) => {
      const h = room.battle.addHero(b.side, bid, b.ch);
      b.ch = h.ch;
      return new BotBrain(room.battle, bid, b.side, i, room.config.botDiff);
    });
    room.phase = 'game';
    // Hazard statics (mine positions etc) sent once; snapshots omit them, both sides must sweep mines by sight
    const field = room.battle.fieldPayload();
    for (const c of room.clients.values()) { try { c.send(field); } catch { /* one dead connection does not block battle start */ } }
    } catch (e) {
      // Broken launch data (malformed map etc): this room falls back to room phase for a retry, server and other rooms unaffected.
      // Uncaught = whole process exits = every room disconnects.
      this.log(`⚠ 房間 ${room.pin} 開戰失敗已攔截:${String(e?.message || e)}`);
        try { this.stopBattle(room); } catch { /* ignore */ }
      room.battle = null; room.phase = 'room';
      const host = room.clients.get(room.hostId);
      try { host?.send({ t: 'error', msg: '開戰失敗:戰場資料異常,請重選地圖再開' }); } catch { /* ignore */ }
        try { this.broadcast(room); } catch { /* ignore */ }
      return;
    }
    let last = Date.now();
    room.noHumanAt = 0;   // In-game no-human timer (see check below)
    room.tickFails = 0;   // Consecutive tick failure count (see catch below: tolerate sporadic, reap on streak)
    room.tickTimer = setInterval(() => {
      try {
      const now = Date.now();
      const dt = Math.min(0.5, (now - last) / 1000);
      last = now;
      // No-human timeout: all humans (players+spectators) gone longer than noHumanMs -> end the game outright.
      // Dropped seats wait on dropMs for reattach; but a room with zero humans is pure idle bot-vs-bot, reap after one minute with nobody back.
      if (this.noHumanMs > 0) {
        const anyHuman = [...room.clients.values()].some((c) => c.connected !== false);
        if (anyHuman) room.noHumanAt = 0;
        else if (!room.noHumanAt) room.noHumanAt = now;
        else if (now - room.noHumanAt >= this.noHumanMs) { this._endAbandoned(room); return; }
      }
      for (const brain of room.botBrains) brain.update(dt);
      room.battle.tick(dt);
      // Fog of war: each side gets a differently filtered snapshot from its own vision; spectators get the clear global snapshot.
      // Snapshots built lazily (2026-08-05 phone-solo perf): only compute the slices with live recipients --
      // solo always has one human, fixed three slices = drop 2/3 of serialization and enemy-vision filtering per tick.
      // Content stays bit-identical; shared first-snapshot-flushes-events semantics (sim._frame) unaffected.
      const snaps = {};
      for (const c of room.clients.values()) {
        // SUPER side gets its own fogged snapshot (same rule as both factions); unset/illegal side keeps the clear one
        const k = c.side === 'SWARM' || c.side === 'STEEL' || c.side === 'SUPER' ? c.side : 'all';
        c.send(snaps[k] ??= room.battle.snapshotFor(k === 'all' ? null : k));
      }
      if (room.battle.over) {
        room.phase = 'over';
        this.stopBattle(room, /*keepPhase*/ true);
        this.broadcast(room);
      }
      room.tickFails = 0;   // This tick ran clean: streak counter resets
      } catch (e) {
        // Any unexpected tick failure (sim edge, snapshot serialize, broadcast) only takes this room: ride out sporadic ticks,
        // retreat to room phase only after 5 straight. Old uncaught behavior = whole process exits = every room disconnects.
        room.tickFails = (room.tickFails || 0) + 1;
        this.log(`⚠ 房間 ${room.pin} tick 異常已攔截:${String(e?.message || e)}`);
        if (room.tickFails <= 5) return;
      try { this.stopBattle(room); } catch { /* ignore */ }
        room.battle = null; room.phase = 'room'; room.tickFails = 0;
      try { this.broadcast(room); } catch { /* ignore */ }
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

  /** Abandoned in-game with no humans: end the game and drop the room outright.
      Clearing seats lets the expired dropMs clear-timer no-op naturally; tokens die with the room, late reattach gets "seat expired". */
  _endAbandoned(room) {
    this.stopBattle(room);
    if (this.rooms.get(room.pin) === room) this.rooms.delete(room.pin);
    room.clients.clear();
    this.log(`⏱ 房間 ${room.pin} 對局中無真人玩家逾 ${Math.round(this.noHumanMs / 1000)} 秒,已結束對局並清除`);
  }

  /** All players loaded terrain -> launch (solo test: one player may launch) */
  maybeLaunch(room) {
    if (room.phase !== 'loading') return;
    const players = [...room.clients.values()].filter((c) => c.mode === 'player' && c.side);
    if (players.length > 0 && players.every((c) => c.loaded)) this.startBattle(room);
  }

  /** Stop ticks in every room (solo backgrounded / server shutdown): MUST call, else setInterval idles forever */
  shutdown() {
    for (const room of this.rooms.values()) this.stopBattle(room);
    this.rooms.clear();
  }

  // ---------------- Connection session ----------------
  /**
   * Attach one connection. `send(msg)` = deliver to that client (WS transport does JSON.stringify; solo calls the handler directly).
   * Returns { id, recv(msg), close() } -- transport only forwards these two entries.
   */
  attach(send) {
    const hub = this;
    const clientId = this._nextClientId++;
    let room = null;
    let client = null;
    // This session seat key in the room: seat key in room.clients, hero pid in sim.heroes, hostId compare target
    // are all the creating session clientId. Reattach MUST keep the old key after reclaiming the seat --
    // using the new connection clientId makes sim silently drop all pos/fire (hero lookup misses), breaks host rights,
    // and deletes the wrong key on leave/clear (seat never freed -> zombie rooms, lobby keeps listing empty bot games).
    let myId = clientId;

    const recv = (m) => {
      if (!m || typeof m.t !== 'string') return;

      // ---- Lobby ----
      if (m.t === 'createRoom') {
        // Map must be built/selected before opening: createRoom must carry a legal battleConfig
        if (hub.maxRooms && hub.rooms.size >= hub.maxRooms) {
          send({ t: 'error', msg: `本節點戰區已達上限(${hub.maxRooms} 間),請稍後再試或加入現有戰區` });
          return;
        }
        const teamSize = Math.max(TEAM.MIN, Math.min(TEAM.MAX, Math.round(m.teamSize) || TEAM.DEFAULT));
        const cfg = m.battleConfig;
        // ---- Map-kind flag normalization: MUST run BEFORE validation ----
        // battleConfig arrives whole from the client, stuffing it into sim as-is lets the peer decide truth (A1 family).
        // Order cannot flip: `defSide: 'FOO'` reads as a normal battle on the validation side, then is cleared to
        // null after normalization -- normalizing after validation would split both sides on "is this a story battle".
        // Story mode (BOSS side; always null for normal battles) is the ONLY flag, see data.js STORY_MAP.
        // (cfg may be wholly absent -- validateBattleConfig reports "incomplete", untouched here)
        if (cfg && typeof cfg === 'object') {
          cfg.defSide = (cfg.defSide === 'SWARM' || cfg.defSide === 'STEEL') ? cfg.defSide : null;
          // Super battle (solo third party) normalized to boolean; mutually exclusive with story (story has a fixed scripted roster).
          // Normalize before validation, same reason as defSide (above). Legacy `cfg.mini` retired, no longer read.
          cfg.super = !!cfg.super && !cfg.defSide;
          // Extended-map mode normalization: only mixed/random are legal, everything else null (old saves lack the field);
          // procedural relief keeps only sanitized {seed,amp} (amplitude capped in mapgen, blocks custom packets blowing up terrain).
          cfg.gen = (cfg.gen?.mode === 'mixed' || cfg.gen?.mode === 'random') ? cfg.gen : null;
          cfg.procRelief = sanitizeProcRelief(cfg.procRelief);
        }
        const err = validateBattleConfig(cfg, teamSize);
        if (err) { send({ t: 'error', msg: err }); return; }
        cfg.env = resolveEnv(cfg.env || {});   // Random picks finalized here, whole room shares one environment
        cfg.architectureSeed = Math.floor(Math.random() * 4294967296); // Per-game building look seed, server decides
        // Siege order (front tower -> mid tower -> base) IS a story-mode derivation, not a second flag: sending one each
        // would produce half-states like "locked by order but no BOSS" or the reverse, while every existing assertion stays green.
        cfg.siege = !!cfg.defSide;
        rollSideSwap(cfg);                     // 50% base side swap (re-rolled at backToRoom on rematch)
        cfg.teamSize = teamSize;
        const pin = hub._genPin();
        client = { send, name: sanitizeName(m.name), side: null, mode: 'player', ready: false, loaded: false, connected: true, token: genToken() };
        room = {
          pin, id: hub._genRoomId(), hostId: myId, phase: 'room',
          config: {
            roomName: sanitizeName(m.roomName) || `${client.name} 的戰區`,
            isPublic: m.isPublic !== false, teamSize,
            botDiff: BOT_DIFF[m.botDiff] ? m.botDiff : DEFAULT_BOT_DIFF,
            // Control scheme: host default at creation, host changes it later via setRoomConfig (room-wide)
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
        // 超級大戰僅限單人遊玩:已有真人玩家時,後來者只能觀戰
        if (r.battleConfig?.super && mode === 'player'
          && [...r.clients.values()].some((c) => c.mode === 'player')) {
          send({ t: 'error', msg: '超級大戰僅限單人遊玩,可用觀戰模式加入' }); return;
        }
        const players = [...r.clients.values()].filter((c) => c.mode === 'player').length + r.bots.size;
        const cap = r.config.teamSize * 2;
        if (mode === 'player' && players >= cap) { send({ t: 'error', msg: `參戰席位已滿(${cap} 人),可用觀戰模式加入` }); return; }
        client = { send, name: sanitizeName(m.name), side: null, mode, ready: false, loaded: false, connected: true, token: genToken() };
        room = r;
        room.clients.set(myId, client);
        hub.broadcast(room);
        // Road relay: host uploaded long ago => late joiners get a copy at once (needed in EVERY phase, room phase
        // is the main case -- client prebuilds on first sync, this message decides WHICH map it builds).
        // MUST NOT stuff into `sync`: that one replays many times, hundreds of KB each is unacceptable (7.4-1).
        const relay = hub.osmPayload(room);
        if (relay) send(relay);
        if (room.mapEvidence) send(room.mapEvidence);
        // Mid-game join: immediately resend phase and battlefield config (incl. hazards)
        if (room.phase === 'game' || room.phase === 'loading') {
          send({ t: 'battleConfig', config: room.battleConfig });
          if (room.battle) send(room.battle.fieldPayload());
        }
        return;
      }
      if (m.t === 'reattach') {
        // Reattach: reclaim the old seat by token
        for (const r of hub.rooms.values()) {
          for (const [id, c] of r.clients) {
            if (c.token === m.token) {
              c.send = send; c.connected = true;
              room = r; client = c; myId = id;   // Reclaimed seat key (hero pid / hostId / clearing all key on it)
              hub.broadcast(room);
              const relay = hub.osmPayload(room);   // Reconnect may need a full prebuild redo -> map data must follow
              if (relay) send(relay);
              if (room.mapEvidence) send(room.mapEvidence);
              if (room.battleConfig && (room.phase === 'loading' || room.phase === 'game')) {
                send({ t: 'battleConfig', config: room.battleConfig });
                if (room.battle) send(room.battle.fieldPayload());
              }
              return;
            }
          }
        }
        // code:'reattach' -> client clears the expired credential on this (no error on every page open), other error handling unaffected
        send({ t: 'error', code: 'reattach', msg: '重連失敗:座位已失效,請重新加入' });
        return;
      }

      if (!room || !client) return;

      // ---- Room matchmaking ----
      if (m.t === 'pickSide') {
        // Only super rooms may pick SUPER (fixed 1 third-party seat); other rooms stay two-sided
        const side = m.side === 'SWARM' || m.side === 'STEEL' || (m.side === 'SUPER' && room.battleConfig?.super)
          ? m.side : null;
        if (client.mode !== 'player') { send({ t: 'error', msg: '觀戰者不能選陣營' }); return; }
        if (side && side !== client.side) {
          const cap = side === 'SUPER' ? 1 : room.config.teamSize;
          const n = hub._sideCount(room, side) - (client.side === side ? 1 : 0);
          if (n >= cap) { send({ t: 'error', msg: `${(SIDES[side] || { name: '超級戰士' }).name} 已滿(${cap} 席)` }); return; }
        }
        client.side = side;
        client.ready = false;
        client.ch = null;   // Side switch: re-pick role (roles bind to sides)
        hub.broadcast(room);
        return;
      }
      if (m.t === 'pickChar') {
        // Pre-battle role pick (unpicked = random at launch); role must belong to own side, MERC fits both; SUPER may pick any
        if (room.phase !== 'room' || client.mode !== 'player') return;
        if (m.ch == null) { client.ch = null; hub.broadcast(room); return; }
        const c = CHARACTERS[m.ch];
        if (!c || !client.side || (client.side !== 'SUPER' && c.side !== client.side && c.side !== 'MERC')) { send({ t: 'error', msg: '角色與陣營不符' }); return; }
        client.ch = m.ch;
        hub.broadcast(room);
        return;
      }
      if (m.t === 'setReady') { client.ready = !!m.ready; hub.broadcast(room); return; }
      if (m.t === 'addBot') {
        // Bots: host fills seats in room phase (solo practice / team fill)
        if (myId !== room.hostId) { send({ t: 'error', msg: '只有房主能增減電腦玩家' }); return; }
        if (room.phase !== 'room') return;
        const side = m.side === 'SWARM' || m.side === 'STEEL' ? m.side : null;
        if (!side) return;
        if (!hub._addBotToSide(room, side)) { send({ t: 'error', msg: `${SIDES[side].name} 已滿(${room.config.teamSize} 席)` }); return; }
        hub.broadcast(room);
        return;
      }
      if (m.t === 'setBotChar') {
        // Host assigns a bot role (null = random at launch, same semantics as human pickChar)
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
        // Control scheme is room-wide => only the host can change it (non-host messages blocked by this if),
        // illegal values silently ignored (degrade by omission); the broadcast value is what clients honor.
        if (m.ctrl !== undefined && CTRL_MODES[m.ctrl]) room.config.ctrl = m.ctrl;
        hub.broadcast(room);
        return;
      }
      if (m.t === 'startBattle') {
        // Host launches (map locked at creation): at least 1 sided-and-ready player
        if (myId !== room.hostId) { send({ t: 'error', msg: '只有房主能開戰' }); return; }
        if (room.phase !== 'room') return;
        const players = [...room.clients.values()].filter((c) => c.mode === 'player' && c.side);
        if (players.length === 0) { send({ t: 'error', msg: '請先選擇陣營' }); return; }
        if (!players.every((c) => c.ready)) { send({ t: 'error', msg: '還有指揮官未按「準備完成」' }); return; }
        // Short roster always filled with bots to full (solo-practice mode retired)
        for (const side of ['SWARM', 'STEEL']) {
          while (hub._addBotToSide(room, side)) { /* fill to full */ }
        }
        room.phase = 'loading';
        for (const c of room.clients.values()) { c.loaded = false; c.send({ t: 'battleConfig', config: room.battleConfig }); }
        hub.broadcast(room);
        return;
      }
      if (m.t === 'loaded') { client.loaded = true; hub.broadcast(room); hub.maybeLaunch(room); return; }
      if (m.t === 'world') {
        // Host uploads world obstacles (building/sacred-tree/rock collision posts) + 3D traffic corridors (sim coords).
        // Normally arrives before launch (stored per room, applied at startBattle); a spectator host may arrive late -> apply to the live sim directly
        // (LOS takes effect at once; in-corridor obstacles drop from snapshots, clients auto-withdraw). Non-host sources always dropped.
        if (myId === room.hostId && m.occ) {
          room.world = { occ: m.occ, cor: m.cor, roofs: m.roofs, wet: m.wet, slabs: m.slabs, hgt: m.hgt };   // wet: water/marsh coarse grid; slabs: bridge/tunnel-ceiling slabs (LOS); hgt: coarse height grid (ridge occlusion)
          if (room.battle) room.battle.setWorld(room.world);
        }
        return;
      }
      if (m.t === 'mapEvidence') {
        if (myId !== room.hostId || room.mapEvidence || !room.battleConfig) return;
        const clean = sanitizeEvidenceRelay(m);
        if (!clean || clean.key !== evidenceFrameKey(evidenceFrame(room.battleConfig))) return;
        room.mapEvidence = clean;
        for (const [id, c] of room.clients) if (id !== myId) c.send(clean);
        return;
      }
      if (m.t === 'osm') {
        // ---- Road relay (2026-08-10 user decision "map data lives with the host, relayed to joiners via server") ----
        // Host uploads its fetched raw Overpass data -> stored per room -> relayed to others. Fixes the EXISTING
        // cross-client split: today each client fetches alone, when A succeeds and B gets throttled their bridges/tunnels/buildings/colliders all differ.
        // Three rules:
        //  (1) Untrusted input: everything from the host passes `sanitizeOsmRelay` (shape + count caps),
        //     and the room MUST store the NEW object it returns -- solo hubs run in the same tab,
        //     storing `m.roads` directly would share refs with the client while downstream mutates those arrays in place.
        //  (2) Monotone: finalized cells MUST NOT be overwritten. Roads may go from absent to present (host retry succeeds after 90s),
        //     but REPLACING an already-sent slice means one room runs v1 and another v2.
        //  (3) MUST NOT touch `room.battleConfig`: the frame (incl. map bearing theta) freezes at creation,
        //     the relay moves roads only. Rotating the whole room world mid-draft is far worse than missing map data (A42 (3)).
        // Whole relay is reclaimed with the room object (cloud `--max-rooms` x per-room cap = memory bound).
        if (myId !== room.hostId) return;
        const clean = sanitizeOsmRelay(m);
        if (!clean) return;
        const key = osmRelayKey(clean.bbox);
        if (!room.osm) room.osm = { key, bbox: clean.bbox, areas: null, pointFeatures: null, roads: null, drop: 0 };
        if (room.osm.key !== key) return;      // Keys differ only on map switch -- that relay does not belong to this room
        const add = { t: 'osm', bbox: room.osm.bbox, drop: clean.drop || 0 };
        let changed = false;
        // null = cell not yet received; []/{} = queried fine but that kind absent, the two MUST stay distinct.
        if (room.osm.areas === null && clean.featureReady !== false && Array.isArray(clean.areas)) {
          add.areas = room.osm.areas = clean.areas; changed = true;
        }
        if (room.osm.pointFeatures === null && clean.featureReady !== false && clean.pointFeatures) {
          add.pointFeatures = room.osm.pointFeatures = clean.pointFeatures; changed = true;
        }
        if (room.osm.roads === null && Array.isArray(clean.roads)) { add.roads = room.osm.roads = clean.roads; changed = true; }
        room.osm.drop = Math.max(room.osm.drop || 0, clean.drop || 0);
        if (!changed) return;  // No new cells => no relay (saves joiners a wasted rebuild)
        for (const [id, c] of room.clients) if (id !== myId) c.send(add);
        return;
      }

      // ---- In battle ----
      const b = room.battle;
      if (!b) {
        if (m.t === 'leaveRoom') { hub.leaveRoom(client, room, myId); room = null; client = null; }
        return;
      }
      if (m.t === 'pos' && client.side) { b.heroPos(myId, m.x, m.y, m.z, m.ry, m.wet, m.lev, m.ay, m.rx); return; }
      if (m.t === 'aim' && client.side) { b.heroAim(myId, m.on); return; }
      if (m.t === 'defend' && client.side) { b.heroDefend(myId, m.on); return; }
      if (m.t === 'hit' && client.side) { b.heroHit(myId, m.id, m.w); return; }
      if (m.t === 'hitMissile' && client.side) { b.hitMissile(myId, m.id, m.w); return; }
      if (m.t === 'burst' && client.side) { b.heroBurst(myId, m.x, m.z, m.y, m.lev); return; }   // y = air-burst height / lev = burst structure layer (sim clamps range)
      if (m.t === 'plasma' && client.side) { b.heroPlasma(myId, m.dx, m.dz, m.slot, m.o, m.dy); return; }   // o=[x,z,y] muzzle / dy=3D aim
      if (m.t === 'lance' && client.side) { b.heroLance(myId, m.o, m.d, m.len); return; }   // Line pierce (beam/rail/gun heavy):o=[x,z,y] muzzle / d=[dx,dz,dy] dir / len=ray length
      // Three mech-ult messages (kami / decoy / hyper) retired as a set on 2026-08-06, MUST NOT return:
      // long right-press is now an ability gesture (normal = guard / scoped = assault) => everything goes through 't: cast' below,
      // the three carriers keep only the "assault delivery" identity (sim._launchAtkCarrier).
      if (m.t === 'swap' && client.side) { b.heroSwap(myId, m.i); return; }
      if (m.t === 'lock' && client.side) { b.heroLock(myId, m.id); return; }
      if (m.t === 'civ' && client.side) { b.civInteract(myId, m.id, m.act); return; }   // Civilian interact: follow/disperse
      if (m.t === 'cast' && client.side) { b.heroCast(myId, m.slot, m.x, m.z); return; }
      if (m.t === 'iframe' && client.side) { b.heroIframe(myId); return; }   // Charged-jump/morph mid iframes (CD gated by sim, decoupled from jump power)
      if (m.t === 'jump' && client.side) { b.heroJump(myId, m.k, m.morph); return; }   // Big-jump/morph liftoff power settlement (authoritative drain)
      if (m.t === 'reload' && client.side) { b.heroReload(myId, m.w); return; }
      if (m.t === 'buy' && client.side) {
        const err = b.buy(myId, m.item, m.lane);   // lane used only for item==='creep' (faction creep upgrade)
        if (err) send({ t: 'error', msg: err });
        return;
      }
      if (m.t === 'tracer') {
        if (client.side && m.slot) b.heroFireRecord?.(myId, m.slot);
        // Visual only: relay to other clients for tracer rendering; pid drives the shooter firing anim on receivers (like heavyCharge, server attaches, never trust client)
        // mv: actual muzzle velocity of lobbed weapons (charge step from fire control; visual relay so peers draw the same arc as the shooter)
        for (const [id, c] of room.clients) if (id !== myId) c.send({ t: 'tracer', pid: myId, from: m.from, to: m.to, side: client.side, slot: m.slot, hit: m.hit, mv: m.mv });
        return;
      }
      if (m.t === 'heavyCharge' && client.side) {
        // Visual only: live relay of rail heavy charge state (third-person mount anim), never enters sim snapshots (no 8Hz wait)
        for (const [id, c] of room.clients) if (id !== myId) c.send({ t: 'heavyCharge', pid: myId, on: !!m.on });
        return;
      }
      if (m.t === 'heavyFire' && client.side) {
        // Visual only: live relay of heavy fire instant (third-person mount anim)
        for (const [id, c] of room.clients) if (id !== myId) c.send({ t: 'heavyFire', pid: myId });
        return;
      }
      if (m.t === 'backToRoom' && myId === room.hostId) {
        // Back to room for rematch: map belongs to the room (picked before creation), battleConfig kept
        hub.stopBattle(room);
        room.battle = null; room.phase = 'room';
        // But base side assignment RE-ROLLS: next game swaps ends at 50% (see rollSideSwap).
        // The broadcast sync carries the new cfg -> clients re-run prebuild in room phase (prebuildKey covers bases/lanes).
        rollSideSwap(room.battleConfig);
        room.battleConfig.architectureSeed = ((room.battleConfig.architectureSeed || 0) + 1) >>> 0;
        for (const c of room.clients.values()) { c.ready = false; c.loaded = false; }
        hub.broadcast(room);
        return;
      }
      if (m.t === 'leaveRoom') { hub.leaveRoom(client, room, myId); room = null; client = null; }
    };

    const close = () => {
      if (!room || !client) return;
      // Seat reclaimed by a newer connection via reattach (this session is a stale socket, late close) -> MUST NOT touch the seat:
      // marking it offline would reap a game that still has live humans. Whether send still points at this session is the only ownership test.
      if (client.send !== send) return;
      client.connected = false;
      // Hold the seat in-game for reattach; room phase leaves the seat at once
      if (room.phase === 'room' || hub.dropMs <= 0) {
        hub.leaveRoom(client, room, myId);
      } else {
        hub.broadcast(room);
        // Clear the seat after a while with nobody back
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
