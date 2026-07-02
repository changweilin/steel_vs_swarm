// ============ 單機版「本地伺服器」(GitHub Pages / 無後端時使用)============
// GitHub Pages 是純靜態託管,沒有 WebSocket 伺服器。本檔在瀏覽器內重現 server.js 中
// 「單人對 AI」與「上帝模式」所需的房間/回合驅動邏輯,直接驅動真正的 Game 引擎與 AI bot,
// 並對外暴露與 net.js 的 Net 相同的介面(send / sendNow / action / flushQueue / kill…),
// 讓 ui.js 幾乎無痛切換。加入房間、多人連線、區網 QR 等功能在此一律不提供(鎖定)。
import { Game } from '../engine/game.js';
import { botStep } from '../engine/bot.js';
import { randomStrategy, strategyNickname } from '../engine/strategy.js';
import { CHARACTERS, RULES, FACTIONS } from './data.js';

const LS_SAVES = 'ctw_solo_saves';   // 手動存檔清單
const LS_AUTO = 'ctw_solo_autosave'; // 單一自動存檔槽

// 動畫秒數(毫秒),與 server.js 的 AI_FX_DELAY 一致:AI 下一步等上一步動畫播完
const AI_FX_DELAY = { build: 1800, move: 2200, spy: 2100, destroy: 2100, steal: 2100, fake: 2100, draw: 1000, event: 2800 };

function sanitizeName(s) {
  return String(s || '').replace(/[^\w一-鿿\- ]/g, '').trim().slice(0, 24) || '未命名';
}

/** 自動補齊角色陣容(與 server.js buildLineup 完全一致:滿足米/牆/台限制;6 人以上補日韓)*/
function buildLineup(existing, total) {
  const chosen = [...existing];
  const has = f => chosen.some(id => CHARACTERS.find(c => c.id === id).faction === f);
  const pool = f => CHARACTERS.filter(c => c.faction === f && !chosen.includes(c.id)).map(c => c.id);
  if (!has('US')) chosen.push(pool('US')[0]);
  if (!has('CN')) chosen.push(pool('CN')[0]);
  if (total >= 3 && !has('TW')) chosen.push('tsmc');
  if (total >= RULES.jpkrMinPlayers) {
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

function makeAISeat(charId, usedNames) {
  const strategy = randomStrategy();
  return { charId, playerName: strategyNickname(strategy, usedNames), isAI: true, strategy };
}

export class LocalNet {
  constructor(onSync, onError, onOther = null) {
    this.onSync = onSync;
    this.onError = onError;
    this.onOther = onOther;
    this.connected = true; // 本地永遠連線
    this._queue = [];
    this.game = null;
    this.started = false;
    this.aiChars = new Set();
    this.myCharId = null;     // 人類控制的角色;上帝模式為 '*'
    this.config = { gameName: '單機戰局', expectedCount: 4, isPublic: false };
    this.aiTimer = null;
  }

  // ---- 對外 API:與 Net 相同 ----
  sendNow(msg) { this._handle(msg); }
  flushQueue() { const q = this._queue; this._queue = []; for (const m of q) this._handle(m); }
  clearQueue() { this._queue = []; }
  kill() { this._stopAI(); this._dead = true; }
  send(msg) { this._handle(msg); }
  action(kind, extra = {}) { this._handle({ t: 'action', kind, ...extra }); }

  _err(msg) { if (this.onError) this.onError(msg); }
  _info(msg) { if (this.onOther) this.onOther({ t: 'info', msg }); }

  // ---- 訊息分派 ----
  _handle(m) {
    if (this._dead) return;
    switch (m.t) {
      case 'startSolo': return this._startSolo(m);
      case 'action': return this._action(m);
      case 'saveGame': return this._saveGame(m);
      case 'listSaves': return this._listSaves();
      case 'loadGame': return this._loadGame(m);
      case 'deleteSave': return this._deleteSave(m);
      case 'clearAutosaves': return this._clearAutosaves();
      case 'endGame': return this._endGame();
      case 'setRoomConfig': return this._setConfig(m);
      // 多人/房間相關訊息在單機版一律忽略(已鎖定)
      default: return;
    }
  }

  // ---- 開新局(單人對 AI / 上帝模式)----
  _startSolo(m) {
    const total = Math.min(RULES.maxPlayers, Math.max(2, parseInt(m.expectedCount, 10) || 4));
    const aiNames = new Set();
    this.aiChars = new Set();
    let seats = [];

    if (m.mode === 'god') {
      const lineup = buildLineup([], total);
      seats = lineup.map(id => ({ charId: id }));
      this.myCharId = '*';
    } else {
      const charId = m.charId;
      const ch = CHARACTERS.find(c => c.id === charId);
      if (!ch) { this._err('請先選擇你的角色'); return; }
      if ((ch.faction === 'JP' || ch.faction === 'KR') && total < RULES.jpkrMinPlayers) {
        this._err(`選日本/韓國需要遊戲人數 ${RULES.jpkrMinPlayers} 以上`); return;
      }
      if (ch.faction === 'TW' && total < 3) { this._err('雙人對決為米牆對決,不開放台灣'); return; }
      const lineup = buildLineup([charId], total);
      seats = lineup.map(id => id === charId
        ? { charId: id, playerName: m.name || ch.name }
        : makeAISeat(id, aiNames));
      for (const id of lineup) if (id !== charId) this.aiChars.add(id);
      this.myCharId = charId;
    }

    this.config = { gameName: m.gameName ? sanitizeName(m.gameName) : '單機戰局', expectedCount: total, isPublic: false };
    this.game = new Game(seats);
    this.started = true;
    const aiList = seats.filter(s => s.isAI)
      .map(s => `${s.playerName}(${CHARACTERS.find(c => c.id === s.charId).name})`).join('、');
    if (aiList) this._info(m.mode === 'god' ? '👁️‍🗨️ 上帝模式:你將輪流操控全部角色' : `🤖 對戰 AI:${aiList}`);
    this._autosave();
    this._broadcast();
    this._pumpAI();
  }

  // ---- 遊戲行動(與 server.js action switch 相同)----
  _action(m) {
    if (!this.started) { this._err('遊戲尚未開始'); return; }
    const g = this.game;
    const pIdx = this._playerIdx();
    if (pIdx < 0) { this._err('你不是此局玩家'); return; }
    const isTrade = String(m.kind).startsWith('trade');
    if (g.turnIdx !== pIdx && m.kind !== 'noop' && m.kind !== 'twChoose' && !isTrade) { this._err('還沒輪到你'); return; }

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
      case 'tradeReady': res = g.doTradeReady(pIdx, this.myCharId === '*'); break;
    }
    if (!res.ok) this._err(res.msg);
    this._broadcast();
    this._autosave();
    this._pumpAI();
  }

  // 人類控制角色在 game.players 的索引(上帝模式 = 當前回合角色)
  _playerIdx() {
    if (!this.started || !this.myCharId) return -1;
    if (this.myCharId === '*') return this.game.turnIdx;
    return this.game.players.findIndex(p => p.char.id === this.myCharId);
  }

  // ---- AI 回合驅動(與 server.js pumpAI 同邏輯:等動畫播完再下一步)----
  _pumpAI(delay = 800) {
    if (!this.started || this.game.over || this.aiTimer) return;
    const cur = this.game.cur();
    if (!this.aiChars.has(cur.char.id)) return;
    this.aiTimer = setTimeout(() => {
      this.aiTimer = null;
      if (!this.started || this._dead) return;
      const fxBefore = this.game._fxSeq;
      let cont = false;
      try { cont = botStep(this.game); } catch (e) { console.error('AI 錯誤:', e); this.game.endTurn(); }
      this._broadcast();
      if (!cont) this._autosave();
      this._pumpAI(this._aiStepDelay(fxBefore));
    }, delay);
  }

  _aiStepDelay(fxSeqBefore) {
    const fresh = this.game.fx.filter(f => f.id > fxSeqBefore);
    if (!fresh.length) return 550;
    return Math.max(...fresh.map(f => AI_FX_DELAY[f.type] ?? 1200));
  }

  _stopAI() { if (this.aiTimer) { clearTimeout(this.aiTimer); this.aiTimer = null; } }

  // ---- 廣播:組出與 server.js broadcast 相同形狀的 sync payload(單一房主視角)----
  _broadcast() {
    const lobby = {
      pin: '----', started: this.started, urls: [], config: this.config,
      clients: [{ id: 0, name: '你', mode: 'player', charId: this.myCharId, isHost: true, ready: true, connected: true }],
      takenChars: this.myCharId && this.myCharId !== '*' ? [this.myCharId] : [],
      kickVotes: {},
    };
    let state = null, priv = null;
    if (this.started) {
      state = this.game.publicState();
      const pIdx = this._playerIdx();
      if (pIdx >= 0) priv = this.game.privateStateFor(pIdx);
    }
    this.onSync({ t: 'sync', youId: 0, token: 'local', isHost: true, lobby, state, priv });
  }

  _setConfig(m) {
    if (m.gameName !== undefined) this.config.gameName = sanitizeName(m.gameName);
    if (m.expectedCount !== undefined) {
      const n = parseInt(m.expectedCount, 10);
      if (n >= 2 && n <= RULES.maxPlayers) this.config.expectedCount = n;
    }
    this._broadcast();
  }

  _endGame() {
    if (!this.started) return;
    this._autosave();
    this._stopAI();
    this.started = false;
    this.game = null;
    this.aiChars = new Set();
    this._broadcast();
  }

  // ---- 存檔(localStorage)----
  _saveData(name) {
    return {
      name: sanitizeName(name || this.config.gameName),
      savedAt: new Date().toISOString(),
      config: this.config,
      myCharId: this.myCharId,
      aiChars: [...this.aiChars],
      started: this.started,
      game: this.game ? this.game.serialize() : null,
    };
  }

  _autosave() {
    if (!this.started || !this.game) return;
    try { localStorage.setItem(LS_AUTO, JSON.stringify(this._saveData(this.config.gameName))); }
    catch (e) { console.warn('自動存檔失敗', e); }
  }

  _readSaves() {
    try { return JSON.parse(localStorage.getItem(LS_SAVES) || '[]'); } catch { return []; }
  }
  _writeSaves(list) { localStorage.setItem(LS_SAVES, JSON.stringify(list)); }

  _saveGame(m) {
    if (!this.started || !this.game) { this._err('遊戲尚未開始,沒有可儲存的進度'); return; }
    const data = this._saveData(m.name);
    const file = `${data.name}_${Date.now()}`;
    const list = this._readSaves();
    list.unshift({ file, data });
    this._writeSaves(list.slice(0, 30)); // 最多保留 30 份
    this._info(`💾 已儲存「${data.name}」`);
  }

  _saveEntry(file, data, auto) {
    return {
      file, name: data.name, savedAt: data.savedAt, auto,
      round: data.game ? data.game.round : null,
      over: data.game ? data.game.over : false,
      players: data.game ? data.game.players.map(p => p.name) : [],
    };
  }

  _listSaves() {
    const out = [];
    let auto = null;
    try { auto = JSON.parse(localStorage.getItem(LS_AUTO) || 'null'); } catch { /* 忽略 */ }
    if (auto) out.push(this._saveEntry('__auto__', auto, true));
    for (const { file, data } of this._readSaves()) out.push(this._saveEntry(file, data, false));
    if (this.onOther) this.onOther({ t: 'saves', list: out });
  }

  _findSaveData(file) {
    if (file === '__auto__') { try { return JSON.parse(localStorage.getItem(LS_AUTO) || 'null'); } catch { return null; } }
    return this._readSaves().find(s => s.file === file)?.data || null;
  }

  _loadGame(m) {
    const data = this._findSaveData(m.file);
    if (!data) { this._err('找不到存檔'); return; }
    this._stopAI();
    try { this.game = data.game ? Game.fromSave(data.game) : null; }
    catch (e) { this._err('載入失敗:' + e.message); return; }
    this.config = data.config || this.config;
    this.myCharId = data.myCharId || (this.aiChars ? null : null);
    this.aiChars = new Set(data.aiChars || []);
    this.started = data.started && !!this.game;
    // 舊存檔可能沒存 myCharId:推斷為唯一非 AI 角色
    if (this.started && !this.myCharId) {
      const human = this.game.players.find(p => !this.aiChars.has(p.char.id));
      this.myCharId = human ? human.char.id : '*';
    }
    this._info(`📂 已載入「${data.name}」`);
    this._broadcast();
    this._pumpAI();
  }

  _deleteSave(m) {
    if (m.file === '__auto__') { localStorage.removeItem(LS_AUTO); }
    else this._writeSaves(this._readSaves().filter(s => s.file !== m.file));
    this._info('🗑️ 已刪除存檔');
  }

  _clearAutosaves() {
    localStorage.removeItem(LS_AUTO);
    this._info('🗑️ 已清除自動存檔');
  }
}
