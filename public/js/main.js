// ============ 無人戰略:鋼鐵與蜂群 — 前端主控 ============
// 畫面流程:connect(大廳)→ mapbuilder(建地圖:隊伍規模/場地/選址,存入最愛)
//          → openroom(開戰時刻:從最愛挑地圖 + 房名/公開性/環境 → 開房)
//          → room(配對,每陣營 N 席)→ loading(地形+地貌建構)→ game → over
import { Net } from './net.js';
import {
  SIDES, ENV, TEAM, lanesFor, targetDistFor, MAPGEO, ECON, upgradePrice,
  CHARACTERS, charsOf, charKind, heroWeapon, heroAbility, PROG, SIZE_KEYS,
  UNITS, SQUAD,
  BOT_DIFF, BOT_DIFF_KEYS, DEFAULT_BOT_DIFF,
} from './data.js';
import { LORE } from './lore.js';
import { avatarURL, portraitURL } from './portraits.js';

const SIZE_LABELS = { large: '大', medium: '中', small: '小' };
import { MapSelect } from './mapSelect.js';
import { buildTerrain } from './terrain.js';
import { buildBiomes } from './biomes.js';
import { envLabel } from './environment.js';
import { preloadModels } from './models.js';
import { VENUES, venueConfig, migrateFavCfg, loadFavorites, saveFavorite, removeFavorite } from './venues.js';
import { BattleClient } from './game.js';

const $ = (id) => document.getElementById(id);
const screens = ['connect', 'mapbuilder', 'openroom', 'room', 'loading', 'game'];

const app = {
  net: null,
  youId: null, isHost: false, token: null,
  lobby: null,          // 伺服器同步的房間狀態
  mySide: null,
  mapSel: null,         // MapSelect 實例(開房前的設定畫面)
  teamSize: TEAM.DEFAULT,
  sizeKey: 'medium',    // 地圖尺寸(大/中/小);中型 = 現況錨點
  favCfg: null,         // 從「我的最愛」直接取用的 battleConfig
  venueSelOpen: null,   // 開戰時刻現場選的預設場地(與最愛互斥)
  battle: null,         // BattleClient
  terrain: null,
  battleCfg: null,
  phaseShown: null,
  roomPoll: null,
};

function show(screen) {
  for (const s of screens) $(s).style.display = s === screen ? '' : 'none';
  app.phaseShown = screen;
}

function toast(msg, ms = 3200) {
  const el = $('toast');
  el.textContent = msg;
  el.classList.add('on');
  clearTimeout(toast._t);
  toast._t = setTimeout(() => el.classList.remove('on'), ms);
}

// ================= 大廳 =================
function refreshRooms() { app.net.send({ t: 'listRooms' }); }

function renderRooms(list) {
  const box = $('roomList');
  if (!list.length) {
    box.innerHTML = '<div class="room-empty">目前沒有戰區。建立一個,或稍後重新整理。</div>';
    return;
  }
  box.innerHTML = '';
  for (const r of list) {
    const row = document.createElement('div');
    row.className = 'room-row' + (r.phase !== 'room' ? ' started' : '');
    const n = r.teamSize || 1;
    const sideTags = `<span class="tag swarm">🐝 ${r.sides.SWARM.length}/${n}</span>
                      <span class="tag steel">🤖 ${r.sides.STEEL.length}/${n}</span>`;
    row.innerHTML = `
      <div class="room-info">
        <div class="room-name">${r.isPublic ? '🌐' : '🔒'} ${esc(r.name)} <span class="room-host">房主:${esc(r.host)}</span></div>
        <div class="room-tags">${sideTags}
          <span class="tag dim">${n}v${n}</span>
          <span class="tag dim">${r.phase === 'room' ? '配對中' : r.phase === 'game' ? '交戰中' : '準備中'}</span>
          ${r.place ? `<span class="tag dim">📍 ${esc(r.place)}</span>` : ''}
          ${r.env ? `<span class="tag dim">${esc(envLabel(r.env))}</span>` : ''}
        </div>
      </div>
      <button class="btn small">${r.phase === 'room' ? '加入' : '觀戰'}</button>`;
    row.querySelector('button').onclick = () => {
      const mode = r.phase === 'room'
        ? (document.querySelector('input[name=joinMode]:checked')?.value || 'player')
        : 'spectator';
      if (r.pin) {
        app.net.send({ t: 'joinRoom', pin: r.pin, name: myName(), mode });
      } else {
        const pin = prompt('私人戰區,請輸入 4 位數 PIN:');
        if (pin) app.net.send({ t: 'joinRoom', pin, name: myName(), mode });
      }
    };
    box.appendChild(row);
  }
}

function myName() {
  const v = $('myName').value.trim() || '指揮官';
  localStorage.setItem('svs_name', v);
  return v;
}

// ---- 開房設定持久化(localStorage,重啟瀏覽器仍記憶)----
// 存人數 / 尺寸 / 房名 / 上次場地;啟動時還原(見 DOMContentLoaded / enterOpenRoom)。
const PREFS_KEY = 'svs_prefs';
function loadPrefs() {
  try { return JSON.parse(localStorage.getItem(PREFS_KEY)) || {}; } catch { return {}; }
}
function savePrefs(patch) {
  localStorage.setItem(PREFS_KEY, JSON.stringify({ ...loadPrefs(), ...patch }));
}
function esc(s) {
  return String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}

// ================= 建立地圖(隊伍規模/場地/選址,建好後存入最愛)=================
function enterMapBuilder() {
  show('mapbuilder');
  app.favCfg = null;
  $('saveFavBtn').disabled = true;

  if (!app.mapSel) {
    app.mapSel = new MapSelect('leafletMap', {
      status: (text, frac) => {
        $('mapStatus').textContent = text;
        $('mapProgressBar').style.width = `${Math.round(frac * 100)}%`;
      },
      confirmReady: (cfg) => {
        app.favCfg = null;
        app.venueSel = null;
        $('saveFavBtn').disabled = !cfg;
        if (cfg) {
          $('mapStatus').innerHTML =
            `已選定:兩堡直線 <b>${(cfg.distM / 1000).toFixed(2)} km</b>(門檻 ${(cfg.diagM * 0.8 / 1000).toFixed(2)} km)` +
            `・${cfg.laneCount} 條兵線,最大重合 <b>${(cfg.maxOverlap * 100).toFixed(0)}%</b>` +
            (cfg.tactics ? `・彎折 <b>×${cfg.tactics.sinuosity.toFixed(2)}</b>・轉角 <b>${cfg.tactics.turnsPerKm.toFixed(1)}/km</b>` : '') +
            `${cfg.synthetic ? '(含離線模擬路徑)' : ''}`;
        }
      },
    });
    renderTeamSize();
    renderSize('szRow', setSizeKey);
    app.mapSel.setSizeKey(app.sizeKey);   // 同步還原的尺寸
    renderVenues();
    setTimeout(() => app.mapSel.map.invalidateSize(), 60);
  }
  $('mapStatus').textContent = '選一個預設場地,或在地圖上點選你的蜂群主堡位置。';
}

function renderTeamSize() {
  const row = $('tsRow');
  row.innerHTML = '';
  for (let n = TEAM.MIN; n <= TEAM.MAX; n++) {
    const b = document.createElement('button');
    b.className = 'btn ts-btn' + (n === app.teamSize ? ' on' : '');
    b.textContent = `${n}v${n}`;
    b.onclick = () => { setTeamSize(n); };
    row.appendChild(b);
  }
  updateTsInfo();
}

function setTeamSize(n) {
  app.teamSize = n;
  savePrefs({ teamSize: n });
  app.favCfg = null;
  app.mapSel?.setTeamSize(n);
  $('saveFavBtn').disabled = true;
  for (const [i, b] of [...$('tsRow').children].entries()) b.classList.toggle('on', i + TEAM.MIN === n);
  updateTsInfo();
  // 預設場地已選:換規模直接重算(預先計算是確定性幾何,瞬間完成)
  if (app.venueSel) selectVenue(app.venueSel);
}

function updateTsInfo() {
  const L = lanesFor(app.teamSize);
  const size = targetDistFor(L, app.sizeKey) / (MAPGEO.BASE_DIST_FRAC * Math.SQRT2);
  $('tsInfo').textContent = `總共 ${app.teamSize * 2} 位玩家 ・ ${L} 條兵線 ・ ${SIZE_LABELS[app.sizeKey]}型戰場約 ${(size / 1000).toFixed(1)} km 見方`;
}

// ---- 地圖尺寸(大/中/小)按鈕 ----
function renderSize(rowId, onPick) {
  const row = $(rowId);
  if (!row) return;
  row.innerHTML = '';
  for (const k of SIZE_KEYS) {
    const b = document.createElement('button');
    b.className = 'btn ts-btn' + (k === app.sizeKey ? ' on' : '');
    b.textContent = SIZE_LABELS[k];
    b.title = `邊長 ×${(MAPGEO.SIZE_MULT[k] / MAPGEO.SIZE_MULT.medium).toFixed(2)}`;
    b.onclick = () => onPick(k);
    row.appendChild(b);
  }
}

function setSizeKey(k) {
  app.sizeKey = k;
  savePrefs({ sizeKey: k });
  app.favCfg = null;
  app.mapSel?.setSizeKey(k);
  $('saveFavBtn').disabled = true;
  for (const b of [...$('szRow').children]) b.classList.toggle('on', b.textContent === SIZE_LABELS[k]);
  updateTsInfo();
  if (app.venueSel) selectVenue(app.venueSel);   // 預設場地已選 → 即時重算
}

function renderVenues() {
  const grid = $('venueGrid');
  grid.innerHTML = '';
  for (const v of VENUES) {
    const b = document.createElement('button');
    b.className = 'venue-btn';
    b.innerHTML = `<span class="venue-type t-${v.type}">${v.type}</span>${v.country} ${esc(v.name)}`;
    b.title = `地貌:${Object.entries(v.mix).map(([k, f]) => `${{ green: '綠地', bare: '裸露', urban: '市區', water: '水體', wet: '濕地' }[k]} ${Math.round(f * 100)}%`).join('・')}`;
    b.onclick = () => selectVenue(v);
    grid.appendChild(b);
  }
}

/** 預設場地:路線/圖資已預先算好(確定性合成兵線),即選即用、免掃描 */
function selectVenue(v) {
  const cfg = venueConfig(v, app.teamSize, app.sizeKey);
  app.mapSel.showConfig(cfg);      // 內部會 reset(觸發 confirmReady(null)),故 favCfg 之後再設
  app.venueSel = v;
  app.favCfg = cfg;
  savePrefs({ lastVenueId: v.id });
  $('mapStatus').innerHTML =
    `📍 <b>${esc(v.name)}</b>:預先計算完成 — 兩堡 ${(cfg.distM / 1000).toFixed(1)} km ・ ${cfg.laneCount} 條兵線,存入最愛後即可開房。` +
    `(想用真實道路兵線,可改在地圖上手動點選錨點)`;
  $('mapProgressBar').style.width = '100%';
  $('saveFavBtn').disabled = false;
}

/** 開戰時刻畫面:我的最愛列表(選一個 → 可建立戰區) */
function renderFavsOpenRoom() {
  const favs = loadFavorites();
  $('favEmptyHint').style.display = favs.length ? 'none' : '';
  const grid = $('favGrid');
  grid.innerHTML = '';
  for (const f of favs) {
    const b = document.createElement('button');
    b.className = 'venue-btn fav';
    b.innerHTML = `⭐ ${esc(f.name)} <span class="venue-type">${f.teamSize}v${f.teamSize}</span>`;
    b.onclick = () => {
      app.teamSize = f.teamSize;
      const cfg = migrateFavCfg(f);        // 尺度追溯:舊尺度最愛自動遷移
      app.sizeKey = cfg.sizeKey || 'medium';
      savePrefs({ teamSize: f.teamSize, sizeKey: app.sizeKey });
      app.favCfg = cfg;
      app.venueSelOpen = null;   // 最愛的兵線是存檔時就烤死的配置,跟即時場地選擇互斥
      for (const el of grid.children) el.classList.remove('on');
      for (const el of $('venueGridOpen').children) el.classList.remove('on');
      for (const [i, tb] of [...$('tsRowOpen').children].entries()) tb.classList.toggle('on', i + TEAM.MIN === f.teamSize);
      renderSize('szRowOpen', setSizeKeyOpen);   // 反映最愛烤死的尺寸
      updateTsInfoOpen();
      b.classList.add('on');
      $('openRoomStatus').innerHTML = `⭐ 已選「${esc(f.name)}」(${esc(f.cfg.placeName || '')}) ・ ${f.teamSize}v${f.teamSize},可以開房了。`;
      $('createRoomBtn').disabled = false;
    };
    const del = document.createElement('span');
    del.className = 'fav-del';
    del.textContent = '✕';
    del.title = '移除最愛';
    del.onclick = (e) => {
      e.stopPropagation();
      removeFavorite(f.name);
      if (app.favCfg === f.cfg) { app.favCfg = null; $('createRoomBtn').disabled = true; }
      renderFavsOpenRoom();
    };
    b.appendChild(del);
    grid.appendChild(b);
  }
}

// ================= 開戰時刻(現場選人數 + 預設場地,或挑已存最愛;設定房名/公開性/環境後開房)=================
function enterOpenRoom() {
  show('openroom');
  app.favCfg = null;
  app.venueSelOpen = null;
  $('createRoomBtn').disabled = true;
  $('openRoomStatus').textContent = '選人數 + 場地,或從下面挑一張已存的地圖。';
  renderTeamSizeOpen();
  renderSize('szRowOpen', setSizeKeyOpen);
  renderVenuesOpen();
  renderEnvSelects();
  renderFavsOpenRoom();
  // 還原上次選的預設場地(記憶設定):命中則即時重算兵線並解鎖開房
  const lastId = loadPrefs().lastVenueId;
  const lastV = lastId && VENUES.find((v) => v.id === lastId);
  if (lastV) selectVenueOpen(lastV);
}

function renderTeamSizeOpen() {
  const row = $('tsRowOpen');
  row.innerHTML = '';
  for (let n = TEAM.MIN; n <= TEAM.MAX; n++) {
    const b = document.createElement('button');
    b.className = 'btn ts-btn' + (n === app.teamSize ? ' on' : '');
    b.textContent = `${n}v${n}`;
    b.onclick = () => setTeamSizeOpen(n);
    row.appendChild(b);
  }
  updateTsInfoOpen();
}

function setTeamSizeOpen(n) {
  app.teamSize = n;
  savePrefs({ teamSize: n });
  for (const [i, b] of [...$('tsRowOpen').children].entries()) b.classList.toggle('on', i + TEAM.MIN === n);
  updateTsInfoOpen();
  if (app.venueSelOpen) {
    // 預設場地選好時,換人數直接即時重算(確定性幾何,瞬間完成)
    selectVenueOpen(app.venueSelOpen);
  } else {
    // 沒有正在用的預設場地(可能剛選了固定 teamSize 的最愛)→ 舊配置的兵線數已跟新人數不符,清掉逼重選
    app.favCfg = null;
    for (const el of $('favGrid').children) el.classList.remove('on');
    $('createRoomBtn').disabled = true;
    $('openRoomStatus').textContent = '人數已變更,請重新選一個預設場地,或挑對應人數的最愛地圖。';
  }
}

function updateTsInfoOpen() {
  const L = lanesFor(app.teamSize);
  const size = targetDistFor(L, app.sizeKey) / (MAPGEO.BASE_DIST_FRAC * Math.SQRT2);
  $('tsInfoOpen').textContent = `總共 ${app.teamSize * 2} 位玩家 ・ ${L} 條兵線 ・ ${SIZE_LABELS[app.sizeKey]}型戰場約 ${(size / 1000).toFixed(1)} km 見方`;
}

function setSizeKeyOpen(k) {
  app.sizeKey = k;
  savePrefs({ sizeKey: k });
  for (const b of [...$('szRowOpen').children]) b.classList.toggle('on', b.textContent === SIZE_LABELS[k]);
  updateTsInfoOpen();
  if (app.venueSelOpen) {
    selectVenueOpen(app.venueSelOpen);          // 預設場地已選 → 即時重算
  } else {
    // 最愛 cfg 烤死了尺寸,尺寸一變即失效,清掉逼重選(比照 setTeamSizeOpen)
    app.favCfg = null;
    for (const el of $('favGrid').children) el.classList.remove('on');
    $('createRoomBtn').disabled = true;
    $('openRoomStatus').textContent = '尺寸已變更,請重新選一個預設場地,或挑對應設定的最愛地圖。';
  }
}

function renderVenuesOpen() {
  const grid = $('venueGridOpen');
  grid.innerHTML = '';
  for (const v of VENUES) {
    const b = document.createElement('button');
    b.className = 'venue-btn';
    b.innerHTML = `<span class="venue-type t-${v.type}">${v.type}</span>${v.country} ${esc(v.name)}`;
    b.title = `地貌:${Object.entries(v.mix).map(([k, f]) => `${{ green: '綠地', bare: '裸露', urban: '市區', water: '水體', wet: '濕地' }[k]} ${Math.round(f * 100)}%`).join('・')}`;
    b.onclick = () => selectVenueOpen(v);
    grid.appendChild(b);
  }
}

/** 開戰時刻現場選場地:依上方即時 teamSize 重算兵線(免先存最愛) */
function selectVenueOpen(v) {
  const cfg = venueConfig(v, app.teamSize, app.sizeKey);
  app.venueSelOpen = v;
  app.favCfg = cfg;
  savePrefs({ lastVenueId: v.id });
  for (const el of $('venueGridOpen').children) el.classList.remove('on');
  const idx = VENUES.indexOf(v);
  if (idx >= 0 && $('venueGridOpen').children[idx]) $('venueGridOpen').children[idx].classList.add('on');
  for (const el of $('favGrid').children) el.classList.remove('on');
  $('openRoomStatus').innerHTML =
    `📍 <b>${esc(v.name)}</b>:${app.teamSize}v${app.teamSize} ・ 兩堡 ${(cfg.distM / 1000).toFixed(1)} km ・ ${cfg.laneCount} 條兵線,可以開房了。`;
  $('createRoomBtn').disabled = false;
}

function renderEnvSelects() {
  const fill = (id, obj, label) => {
    const sel = $(id);
    sel.innerHTML = `<option value="random">🎲 隨機${label}</option>`;
    for (const [k, v] of Object.entries(obj)) {
      sel.innerHTML += `<option value="${k}">${v.name}</option>`;
    }
  };
  fill('envSeason', ENV.seasons, '季節');
  fill('envTime', ENV.times, '時段');
  fill('envWeather', ENV.weathers, '天氣');
}

$('saveFavBtn')?.addEventListener('click', async () => {
  const cfg = app.favCfg || app.mapSel?.buildConfig();
  if (!cfg) return;
  await app.mapSel.fetchPlaceName(cfg);
  const name = prompt('地圖名稱:', cfg.placeName)?.trim();
  if (!name) return;
  saveFavorite(name, app.teamSize, cfg);
  toast(`⭐ 已存入最愛:${name}(可到「開戰時刻」選用)`);
});

$('resetSiteBtn')?.addEventListener('click', () => {
  app.favCfg = null;
  app.mapSel?.reset();
});
$('backLobbyBtn')?.addEventListener('click', () => {
  app.favCfg = null;
  app.mapSel?.reset();
  show('connect');
  refreshRooms();
});
$('goOpenRoomBtn')?.addEventListener('click', () => enterOpenRoom());
$('goMapBuilderBtn')?.addEventListener('click', () => enterMapBuilder());

$('createRoomBtn')?.addEventListener('click', () => {
  const cfg = app.favCfg;
  if (!cfg) return;
  $('createRoomBtn').disabled = true;
  $('openRoomStatus').textContent = '建立戰區…';
  cfg.env = {
    season: $('envSeason').value,
    time: $('envTime').value,
    weather: $('envWeather').value,
  };
  app.net.send({
    t: 'createRoom',
    name: myName(),
    roomName: $('roomNameInput').value.trim(),
    isPublic: $('createPublic').checked,
    teamSize: app.teamSize,
    botDiff: loadPrefs().botDiff || DEFAULT_BOT_DIFF,
    battleConfig: cfg,
  });
});
$('backFromOpenRoomBtn')?.addEventListener('click', () => {
  app.favCfg = null;
  show('connect');
  refreshRooms();
});

// ================= 房間(配對,每陣營 N 席)=================
function renderRoom() {
  const lb = app.lobby;
  if (!lb) return;
  const N = lb.config.teamSize || 1;
  $('roomTitle').textContent = lb.config.roomName || '未命名戰區';
  $('roomPin').textContent = lb.pin;
  $('roomUrls').textContent = (lb.urls || []).join('  ');

  // 戰場資訊(開房時已鎖定)
  const cfg = lb.battleConfig;
  $('roomMapInfo').textContent = cfg
    ? `📍 ${cfg.placeName} ・ ${N}v${N} ・ ${cfg.lanes.length} 條兵線 ・ ${(cfg.sizeM / 1000).toFixed(1)} km 見方 ・ ${envLabel(cfg.env)}`
    : '';

  renderBotDiff(lb);

  const me = lb.clients.find((c) => c.id === app.youId);
  app.mySide = me?.side || null;

  for (const side of ['SWARM', 'STEEL']) {
    const card = $(`side${side}`);
    const members = lb.clients.filter((c) => c.side === side);
    card.classList.toggle('taken', members.length >= N);
    card.classList.toggle('mine', members.some((c) => c.id === app.youId));
    const slotsEl = card.querySelector('.side-slots');
    slotsEl.innerHTML = '';
    for (let i = 0; i < N; i++) {
      const c = members[i];
      const div = document.createElement('div');
      div.className = 'slot' + (c ? ' filled' : '') + (c?.id === app.youId ? ' me' : '') + (c?.isBot ? ' bot' : '');
      if (c) {
        const chTag = c.ch && CHARACTERS[c.ch] ? ` <span class="slot-char">「${CHARACTERS[c.ch].code}」</span>` : ' <span class="slot-char dim">🎲隨機</span>';
        div.innerHTML = `${c.isHost ? '👑 ' : ''}${c.isBot ? '🤖 ' : ''}${esc(c.name)}${chTag} <span class="slot-ready">${c.ready ? '✅' : '⏳'}</span>${c.connected === false ? ' 🔌' : ''}`;
        if (c.isBot && app.isHost) {
          const del = document.createElement('span');
          del.className = 'bot-del';
          del.textContent = '✕';
          del.title = '移除電腦玩家';
          del.onclick = (e) => { e.stopPropagation(); app.net.send({ t: 'removeBot', id: c.id }); };
          div.appendChild(del);
        }
      } else if (app.isHost) {
        div.innerHTML = '—— 空位 ——';
        const add = document.createElement('button');
        add.className = 'btn tiny bot-add';
        add.textContent = '+ 電腦玩家';
        add.onclick = (e) => { e.stopPropagation(); app.net.send({ t: 'addBot', side }); };
        div.appendChild(add);
      } else {
        div.innerHTML = '—— 空位 ——';
      }
      slotsEl.appendChild(div);
    }
  }

  renderCharPick(me);

  const specs = lb.clients.filter((c) => c.mode === 'spectator');
  $('specList').textContent = specs.length ? `👁️ 觀戰:${specs.map((c) => c.name).join('、')}` : '';

  const readyBtn = $('readyBtn');
  readyBtn.disabled = !me?.side;
  readyBtn.textContent = me?.ready ? '取消準備' : '✔ 準備完成';
  readyBtn.classList.toggle('on', !!me?.ready);

  const startBtn = $('startBattleBtn');
  startBtn.style.display = app.isHost ? '' : 'none';
  const players = lb.clients.filter((c) => c.mode === 'player' && c.side);
  const allReady = players.length > 0 && players.every((c) => c.ready);
  startBtn.disabled = !allReady;
  startBtn.textContent = players.length < 2 ? '⚔️ 開戰(單人練習)' : `⚔️ 開戰(${players.length} 位指揮官)`;
  $('roomHint').textContent = app.isHost
    ? (allReady ? '全員就緒,可以開戰!' : '各自選好陣營並按「準備完成」後,由你開戰。')
    : '等待房主開戰…';
}

// 電腦玩家難度(整房一個;房主可改,其他人唯讀顯示)
function renderBotDiff(lb) {
  const row = $('botDiffRow');
  if (!row) return;
  const cur = lb.config.botDiff || DEFAULT_BOT_DIFF;
  if (!app.isHost) {
    row.textContent = `🤖 電腦難度:${BOT_DIFF[cur]?.name || cur}`;
    return;
  }
  row.innerHTML = '🤖 電腦難度:';
  const sel = document.createElement('select');
  sel.className = 'diff-select';
  for (const k of BOT_DIFF_KEYS) {
    const opt = document.createElement('option');
    opt.value = k; opt.textContent = BOT_DIFF[k].name;
    if (k === cur) opt.selected = true;
    sel.appendChild(opt);
  }
  sel.onchange = () => {
    savePrefs({ botDiff: sel.value });
    app.net.send({ t: 'setRoomConfig', botDiff: sel.value });
  };
  row.appendChild(sel);
  const hint = document.createElement('span');
  hint.className = 'diff-hint dim';
  hint.textContent = ' ・ 新手:只用輕武器 ・ 低:不用招式 ・ 越低瞄準越差';
  row.appendChild(hint);
}

// ================= 選角(入座後出現;不選 = 開戰隨機)=================
const FX_LABEL = {
  buff: '增益', heal: '維修', strike: '打擊', summon: '召喚', emp: '癱瘓',
  vision: '視野', stealth: '匿蹤', dash: '突進', intercept: '攔截',
};
// 屬性條的滿格基準(取全角色池上緣,純顯示用)
const BAR_MAX = { hp: 850, sp: 300, mp: 135, speed: 52, armor: 28 };

/** 三階數值:全等 → 單值;否則 "a → b → c" */
const tri = (fn, digits = 0) => {
  const v = [1, 2, 3].map((l) => +fn(l).toFixed(digits));
  return v.every((x) => x === v[0]) ? `${v[0]}` : v.join(' → ');
};

function charWeaponRow(id, slot, key) {
  const raw = CHARACTERS[id][slot];
  const w = (l) => heroWeapon(id, slot, l);
  const bits = [`傷害 ${tri((l) => w(l).dmg)}`, `射程 ${Math.round(w(1).range)}m`];
  if (slot === 'light') bits.push(`射速 ${tri((l) => w(l).rate, 1)}/s`, `彈匣 ${tri((l) => w(l).mag)}`);
  else bits.push(`冷卻 ${tri((l) => w(l).reload, 1)}s`);
  if (raw.r) bits.push(`爆風 ${tri((l) => w(l).r)}m`);
  if (raw.pen) bits.push(`破甲 ${tri((l) => w(l).pen)}`);
  if (raw.crit) bits.push(`爆擊 ${Math.round(w(1).crit * 100)}%×${w(1).critX}`);
  if (raw.emp) bits.push(`癱瘓 ${tri((l) => w(l).emp, 1)}s`);
  return `<div class="cd-row">
    <span class="cd-key">${key}</span>
    <div><b>${esc(raw.name)}</b> <span class="dim">${esc(raw.rw)}</span>
    <div class="cd-nums">${bits.join(' ・ ')}</div></div></div>`;
}

function charAbilityRow(id, slot, key) {
  const a = (l) => heroAbility(id, slot, l);
  const A = a(1);
  const bits = [`電力 ${tri((l) => a(l).mp)}`, `冷卻 ${tri((l) => a(l).cd, 1)}s`];
  if (A.dmg) bits.push(`傷害 ${tri((l) => a(l).dmg)}`);
  if (A.heal) bits.push(`修復 ${tri((l) => a(l).heal)}`);
  if (A.count > 1 || A.unit) bits.push(`數量 ${tri((l) => a(l).count)}`);
  if (A.dur) bits.push(`持續 ${tri((l) => a(l).dur, 1)}s`);
  if (A.r) bits.push(`半徑 ${tri((l) => a(l).r)}m`);
  if (A.range) bits.push(`施放距離 ${tri((l) => a(l).range)}m`);
  if (A.vision) bits.push(`無霧 ${tri((l) => a(l).vision)}s`);
  if (A.imp) bits.push(`推力 ${tri((l) => a(l).imp)}`);
  if (A.mul) bits.push(...Object.entries(A.mul).map(([k, _]) =>
    `${k === 'dmg' ? '傷害' : k === 'dmgTaken' ? '承傷' : '填彈'} ${tri((l) => a(l).mul[k], 2)}×`));
  return `<div class="cd-row">
    <span class="cd-key">${key}</span>
    <div><b>${esc(A.name)}</b> <span class="cd-fx">${FX_LABEL[A.fx] || A.fx}</span>
    <div class="cd-desc">${esc(A.desc || '')}</div>
    <div class="cd-nums">${bits.join(' ・ ')}</div></div></div>`;
}

function charDetailHTML(id) {
  const c = CHARACTERS[id];
  const lo = LORE[id] || {};
  const kind = charKind(id);
  const u = UNITS[kind];
  const m = c.mods;
  const isDrone = kind === 'drone';
  const stats = [
    ['裝甲 HP', Math.round(u.hp * (m.hp ?? 1)), 'hp'],
    ['護盾', Math.round(u.shield * (m.sp ?? 1)), 'sp'],
    ['電力', Math.round(u.mp * (m.mp ?? 1)), 'mp'],
    ['機動', Math.round(u.speed * (m.speed ?? 1)), 'speed'],
    ['護甲值', m.armor ?? 0, 'armor'],
  ].map(([label, v, k]) =>
    `<div class="cd-stat"><span>${label}</span>
      <i><b style="width:${Math.min(100, v / BAR_MAX[k] * 100).toFixed(0)}%"></b></i>
      <em>${v}</em></div>`).join('');

  return `<div class="cd-art">
      <img src="${portraitURL(id)}" alt="${esc(c.name)}">
      <div class="cd-tag ${c.side === 'MERC' ? 'merc' : c.side.toLowerCase()}">
        ${c.side === 'MERC' ? '⚔ 傭兵' : SIDES[c.side].name}・${isDrone ? '無人機' : '機甲'}</div>
    </div>
    <div class="cd-body">
      <div class="cd-name">「${esc(c.code)}」${esc(c.name)}</div>
      <div class="cd-machine">${esc(c.machine)}</div>
      <div class="cd-meta">${[lo.nat, lo.age && `${lo.age} 歲`, lo.sex, lo.role].filter(Boolean).map(esc).join(' ・ ')}</div>
      ${lo.quote ? `<div class="cd-quote">「${esc(lo.quote)}」</div>` : ''}
      ${lo.look ? `<p class="cd-bio">${esc(lo.look)}</p>` : ''}
      ${lo.bio ? `<p class="cd-bio">${esc(lo.bio)}</p>` : ''}
      <div class="cd-stats">${stats}
        ${isDrone ? `<div class="cd-note">※ 蜂群為 ${SQUAD.N} 機小隊:上表為單機值,單機傷害為機甲的 1/3,三機齊射 ≈ 一台機甲。</div>` : ''}
      </div>
      <div class="cd-kit">
        ${charWeaponRow(id, 'light', '左鍵')}
        ${charWeaponRow(id, 'heavy', '右鍵')}
        ${charAbilityRow(id, 'skill', 'Q')}
        ${charAbilityRow(id, 'ult', 'E')}
      </div>
      <div class="cd-foot">數值為 Lv1 → Lv2 → Lv3(擊殺數 + 金錢於戰場升級);已含英雄倍率(射程 ×1.2、威力 ×1.5)。</div>
    </div>`;
}

function showCharDetail(id) {
  const box = $('charDetail');
  box.innerHTML = id
    ? charDetailHTML(id)
    : '<div class="cd-empty">🎲 未選角色<br><span>開戰時隨機指派一名。點選頭像可看完整簡歷與數值。</span></div>';
}

function renderCharPick(me) {
  const sec = $('charSection');
  if (!me || me.mode !== 'player' || !me.side || app.lobby.phase !== 'room') {
    sec.style.display = 'none';
    return;
  }
  sec.style.display = '';
  const grid = $('charGrid');
  grid.innerHTML = '';
  const rnd = document.createElement('button');
  rnd.className = 'char-btn rnd' + (me.ch ? '' : ' on');
  rnd.innerHTML = '<span class="char-dice">🎲</span><span class="char-name">隨機</span>';
  rnd.onclick = () => app.net.send({ t: 'pickChar', ch: null });
  rnd.onmouseenter = () => showCharDetail(null);
  grid.appendChild(rnd);
  for (const id of charsOf(me.side)) {
    const c = CHARACTERS[id];
    const merc = c.side === 'MERC';   // 傭兵:雙陣營皆可受雇,機體/武器不隨陣營改變
    const b = document.createElement('button');
    b.className = 'char-btn' + (me.ch === id ? ' on' : '') + (merc ? ' merc' : '');
    b.innerHTML = `<img class="char-av" src="${avatarURL(id)}" alt="" draggable="false">
      <b>${merc ? '⚔ ' : ''}${esc(c.code)}</b><span class="char-name">${esc(c.name)}</span>`;
    b.onclick = () => app.net.send({ t: 'pickChar', ch: id });
    b.onmouseenter = () => showCharDetail(id);
    grid.appendChild(b);
  }
  // 滑鼠移出網格 → 退回目前選定角色
  grid.onmouseleave = () => showCharDetail(me.ch || null);
  showCharDetail(me.ch || null);

  const cur = me.ch && CHARACTERS[me.ch];
  $('charInfo').innerHTML = cur
    ? `已選定 <b>「${esc(cur.code)}」${esc(cur.name)}</b> ・ ${esc(cur.machine)}`
    : '未選角色:開戰時將隨機指派一名(滑鼠移到頭像可預覽)。';
}

// ================= 載入 + 開戰 =================
async function enterLoading(cfg) {
  app.battleCfg = cfg;
  if (app.battle) { app.battle.dispose(); app.battle = null; }
  show('loading');
  $('loadPlace').textContent = `${cfg.placeName || ''} ・ ${envLabel(cfg.env)}`;
  $('loadStats').textContent =
    `主堡距離 ${(cfg.distM / 1000).toFixed(2)} km ・ 戰場 ${(cfg.sizeM / 1000).toFixed(1)} km 見方 ・ ${cfg.lanes.length} 條兵線(重合 ≤ ${(cfg.maxOverlap * 100).toFixed(0)}%)`;

  const setP = (f, label) => {
    $('loadBar').style.width = `${Math.round(f * 100)}%`;
    $('loadLabel').textContent = label;
  };
  try {
    setP(0.02, '載入 3D 模型(Quaternius CC0)…');
    await preloadModels((f) => setP(f * 0.18, '載入 3D 模型(Quaternius CC0)…'));
    app.terrain = await buildTerrain(cfg, (f, label) => setP(0.18 + f * 0.42, label));
    const biomes = await buildBiomes(cfg, app.terrain, (f, label) => setP(0.60 + f * 0.36, label));
    app.terrain.group.add(biomes);
    app.terrain.biomesUpdate = biomes.userData.update || null;   // 火車 / 瀑布動態
    app.terrain.blockers = biomes.userData.blockers || [];       // 建物碰撞(限制行動不封鎖)
    const st = biomes.userData.stats;
    setP(0.97, `等待其他指揮官…(植被 ${st.veg}・建物 ${st.buildings}` +
      `${st.roads ? `・道路 ${st.roads} 段` : ''}${st.rails ? `・鐵路 ${st.rails} 段` : ''}${st.falls ? `・瀑布 ${st.falls}` : ''}${st.osm ? '・OSM 圖資' : ''})`);
    app.net.send({ t: 'loaded' });
  } catch (e) {
    console.error(e);
    setP(1, `❌ 地形建構失敗:${e.message}(檢查網路後重新整理)`);
  }
}

function enterGame() {
  if (app.battle || !app.terrain) return;
  show('game');
  const hud = makeHud();
  const meLobby = app.lobby?.clients.find((c) => c.id === app.youId);
  const myCh = meLobby?.ch || null;   // 開戰時伺服器已定案(隨機也回寫)
  app.battle = new BattleClient({
    canvas: $('gameCanvas'),
    minimapCanvas: $('minimap'),
    cfg: app.battleCfg,
    side: app.mySide,
    youId: app.youId,
    ch: myCh,
    net: app.net,
    terrain: app.terrain,
    hud,
  });
  if (app.fieldMsg) app.battle.onField(app.fieldMsg);   // 開戰前就收到的危險區資料
  // 陣營樣式 & 操作說明
  document.body.dataset.side = app.mySide || 'SPEC';
  const chData = myCh && CHARACTERS[myCh];
  // 機體種類綁角色(傭兵 kind 自帶,不隨陣營),操作說明跟著機體走
  const isDrone = (chData?.kind || (app.mySide && SIDES[app.mySide].hero)) === 'drone';
  $('hudSideName').textContent = app.mySide
    ? (chData ? `「${chData.code}」${chData.name} ・ ${chData.machine}` : `${SIDES[app.mySide].name} ・ ${SIDES[app.mySide].heroName}`)
    : '觀戰模式';
  $('hudHelp').innerHTML = app.mySide
    ? (isDrone
      ? 'W/S 沿視線飛 ・ A/D 橫移 ・ Space/C 升降 ・ 左鍵 輕武器 ・ 右鍵按住 瞄準+重武器(準星鎖定) ・ Q 小招 ・ E 大招 ・ F/高速撞擊 自爆(僚機衝向鎖定目標) ・ V 或 1~3 切換主視野 ・ R 填彈 ・ B 升級 ・ 三機齊射才是完整火力,別讓僚機掉隊!'
      : 'WASD 移動 ・ Space 跳 ・ Shift 衝刺 ・ 左鍵 輕武器 ・ 右鍵按住 瞄準+重武器 ・ Q 小招 ・ E 大招 ・ R 填彈 ・ B 升級 ・ 偏離兵線小心地雷!')
    : 'WASD 移動 ・ Space/C 升降 ・ Shift 加速(觀戰自由視角)';
  toast('點擊畫面鎖定滑鼠開始戰鬥', 4000);
}

function makeHud() {
  const feedBox = $('killFeed');
  return {
    self: (hp, max, cd, w) => {
      $('hpBar').style.width = `${Math.max(0, hp / max * 100)}%`;
      $('hpText').textContent = `裝甲 ${Math.max(0, Math.round(hp))} / ${max}`;
      if (w) {
        // 雙層 HP:護盾(脫戰自然回復)+ 裝甲(回堡/招式才能修)
        $('spBar').style.width = `${Math.max(0, w.sp / w.msp * 100)}%`;
        $('spText').textContent = `護盾 ${Math.max(0, Math.round(w.sp))} / ${w.msp}`;
        // 電力(MP)
        $('mpBar').style.width = `${Math.max(0, w.mp / w.mm * 100)}%`;
        $('mpText').textContent = `電力 ${Math.floor(w.mp)} / ${w.mm}`;
        // 輕武器:彈藥 / 填彈(瞄準中 HUD 高亮重武器)
        const l = w.light;
        $('wpnName').textContent = `${l.name} Lv.${l.lvl}${w.emp > 0 ? ' ⚡離線' : ''}`;
        $('wpnAmmo').textContent = l.reload > 0 ? `填彈 ${l.reload.toFixed(1)}s` : `${l.ammo} / ${l.mag}`;
        $('wpnAmmo').classList.toggle('reloading', l.reload > 0);
        $('wpnAmmo').classList.toggle('low', l.reload <= 0 && l.ammo <= l.mag * 0.25);
        // 重武器(CD 型;右鍵瞄準 + 左鍵發射)+ 無人機自爆提示
        const hv = w.heavy;
        $('burstName').textContent = `${hv.name} Lv.${hv.lvl}${w.bomb ? '(另有 F 自爆)' : ''}`;
        // 招式:Q 小招 / E 大招(鎖定 / 冷卻 / 就緒)
        const abEl = (box, nameEl, cdEl2, a) => {
          $(nameEl).textContent = a.lvl > 0 ? `${a.name} Lv.${a.lvl}` : `${a.name} 🔒`;
          $(cdEl2).textContent = a.lvl === 0 ? '' : a.cd > 0 ? `${a.cd.toFixed(0)}s` : `${a.mp}MP`;
          $(box).classList.toggle('ready', a.ready);
          $(box).classList.toggle('locked', a.lvl === 0);
        };
        abEl('abSkill', 'abSkillName', 'abSkillCd', w.skill);
        abEl('abUlt', 'abUltName', 'abUltCd', w.ult);
        $('moneyText').textContent = Math.floor(w.money);
        $('knText').textContent = w.kn;
        $('shopHint').textContent = 'B 升級(擊殺+金錢)';
      }
      const cdEl = $('burstCd');
      cdEl.textContent = cd > 0 ? `CD ${cd.toFixed(1)}s` : '就緒';
      cdEl.classList.toggle('ready', cd <= 0);
    },
    // 三機小隊:HP 條 + 陣亡重生倒數;高亮主視野那一架
    squad: (list) => {
      const box = $('squadRow');
      if (!list || list.length < 2) { box.innerHTML = ''; return; }
      box.innerHTML = list.map((d) => {
        const cls = `sq-box${d.act ? ' act' : ''}${d.dead ? ' down' : ''}`;
        const w = d.dead ? 100 : Math.max(0, d.hp / d.max * 100);
        const label = d.dead ? `☠ ${d.rs}s` : `${Math.round(d.hp)}`;
        return `<div class="${cls}"><div class="sq-fill" style="width:${w}%"></div><span>${d.si + 1}號 ${label}</span></div>`;
      }).join('');
    },
    shop: (open, st) => renderShop(open, st),
    bases: (bases, stats) => {
      for (const side of ['SWARM', 'STEEL']) {
        const b = bases[side];
        const bar = $(`base${side}`);
        bar.style.width = b ? `${Math.max(0, b.hp / b.max * 100)}%` : '0%';
      }
      if (stats) {
        $('scoreSWARM').textContent = `擊殺 ${stats.SWARM.kills} ・ 補刀 ${stats.SWARM.creepKills}`;
        $('scoreSTEEL').textContent = `擊殺 ${stats.STEEL.kills} ・ 補刀 ${stats.STEEL.creepKills}`;
      }
    },
    wave: (n, secs) => {
      $('waveInfo').textContent = `第 ${n} 波 ・ 下一波 ${secs}s`;
    },
    feed: (text) => {
      const div = document.createElement('div');
      div.textContent = text;
      feedBox.prepend(div);
      while (feedBox.children.length > 5) feedBox.lastChild.remove();
      setTimeout(() => div.remove(), 6000);
    },
    dead: (secs) => {
      const ov = $('deadOverlay');
      ov.style.display = secs != null ? '' : 'none';
      if (secs != null) $('deadTimer').textContent = secs;
    },
    over: (winner, stats) => {
      const ov = $('overOverlay');
      if (ov.style.display !== 'none' && ov.dataset.done) return;
      ov.style.display = '';
      ov.dataset.done = '1';
      const win = SIDES[winner];
      $('overTitle').textContent = `${win.name} 勝利!`;
      $('overTitle').style.color = win.color;
      $('overSub').textContent = app.mySide
        ? (app.mySide === winner ? '🏆 敵方主堡已化為廢墟,你贏得了這場戰役!' : '💀 你的主堡被摧毀了…下次再戰。')
        : '戰役結束。';
      $('overStats').textContent =
        `🐝 ${SIDES.SWARM.name}:擊殺 ${stats.SWARM.kills}/陣亡 ${stats.SWARM.deaths}/補刀 ${stats.SWARM.creepKills}   ` +
        `🤖 ${SIDES.STEEL.name}:擊殺 ${stats.STEEL.kills}/陣亡 ${stats.STEEL.deaths}/補刀 ${stats.STEEL.creepKills}`;
      $('backRoomBtn').style.display = app.isHost ? '' : 'none';
      document.exitPointerLock?.();
    },
    hitmark: () => {
      const el = $('hitmark');
      el.classList.remove('on');
      void el.offsetWidth;
      el.classList.add('on');
    },
  };
}

// ================= 升級工坊(B 鍵開關;招式升級 = 擊殺數 + 金錢,隨處可買)=================
function renderShop(open, st) {
  const ov = $('shopOverlay');
  ov.style.display = open ? '' : 'none';
  if (!open || !st) return;
  $('shopMoney').textContent = `💰 ${Math.floor(st.money)} ・ ☠ ${st.kn} 擊殺`;
  const box = $('shopItems');
  box.innerHTML = '';
  const row = (html, price, enabled, onBuy, note = '') => {
    const div = document.createElement('div');
    div.className = 'shop-item' + (enabled ? '' : ' off');
    div.innerHTML = `<div class="shop-info">${html}${note ? `<div class="shop-item-note">${note}</div>` : ''}</div>`;
    const btn = document.createElement('button');
    btn.className = 'btn small';
    btn.textContent = price != null ? `$${price}` : '—';
    btn.disabled = !enabled;
    btn.onclick = onBuy;
    div.appendChild(btn);
    box.appendChild(div);
  };
  const head = (t) => {
    const d = document.createElement('div');
    d.className = 'shop-head';
    d.textContent = t;
    box.appendChild(d);
  };
  const c = st.ch && CHARACTERS[st.ch];
  if (c) {
    head(`🎖 招式升級 —「${c.code}」${c.machine}(每招三階;需擊殺數 + 金錢)`);
    const KEY = { light: '左鍵', heavy: '右鍵瞄準', skill: 'Q', ult: 'E' };
    for (const slot of ['light', 'heavy', 'skill', 'ult']) {
      const lvl = st.ab[slot] || 0;
      const isWpn = slot === 'light' || slot === 'heavy';
      const name = c[slot].name;
      const full = lvl >= 3;
      const needK = full ? null : PROG[slot].kills[lvl];
      const price = full ? null : PROG[slot].cost[lvl];
      const kOk = !full && st.kn >= needK;
      // 下一階數值預覽
      let nextInfo = '';
      if (!full) {
        if (isWpn) {
          const nw = heroWeapon(st.ch, slot, lvl + 1);
          nextInfo = `下一階:傷害 ${Math.round(nw.dmg)} ・ 彈夾 ${nw.mag}${nw.pen ? ` ・ 破甲 ${nw.pen}` : ''}`;
        } else {
          const na = heroAbility(st.ch, slot, lvl + 1);
          nextInfo = `下一階:CD ${na.cd}s ・ ${na.mp}MP${na.dmg ? ` ・ 傷害 ${na.dmg}` : ''}${na.heal ? ` ・ 修復 ${na.heal}` : ''}${na.dur ? ` ・ ${na.dur}s` : ''}`;
        }
      }
      const desc = isWpn ? c[slot].rw : c[slot].desc;
      row(
        `<b>${name}</b> <span class="tag dim">${PROG[slot].name}・${KEY[slot]}</span> Lv.${lvl}/3 <span class="dim">${desc}</span>`,
        price, kOk && st.money >= price, () => st.buy(`ab:${slot}`),
        full ? '已滿階'
          : `${kOk ? '✅' : '☠'} 需 ${needK} 擊殺(目前 ${st.kn})${lvl === 0 && !isWpn ? ' ・ 解鎖後按 ' + KEY[slot] + ' 施放' : ''}${nextInfo ? ' ・ ' + nextInfo : ''}`,
      );
    }
  }
  head('⬆️ 通用強化(隨處可買,立即生效)');
  for (const [id, up] of Object.entries(ECON.UPGRADES)) {
    const lvl = st.upg[id] || 0;
    const full = lvl >= up.max;
    const price = full ? null : upgradePrice(up, lvl);
    row(`<b>${up.name}</b> Lv.${lvl}/${up.max} <span class="dim">${up.desc}</span>`,
      price, !full && st.money >= price, () => st.buy(id), full ? '已滿級' : '');
  }
}
$('shopCloseBtn')?.addEventListener('click', () => app.battle?._toggleShop(false));

$('backRoomBtn')?.addEventListener('click', () => {
  app.net.send({ t: 'backToRoom' });
});
$('leaveGameBtn')?.addEventListener('click', () => location.reload());

// ================= 伺服器訊息 =================
function onSync(m) {
  app.youId = m.youId;
  app.isHost = m.isHost;
  app.token = m.token;
  sessionStorage.setItem('svs_token', m.token);
  app.lobby = m.lobby;
  const phase = m.lobby.phase;

  if (phase === 'room') {
    if (app.battle) { app.battle.dispose(); app.battle = null; app.terrain = null; }
    app.fieldMsg = null;   // 回房再戰會重新生成危險區
    $('overOverlay').style.display = 'none';
    $('shopOverlay').style.display = 'none';
    delete $('overOverlay').dataset.done;
    if (app.mapSel) { app.mapSel.destroy(); app.mapSel = null; }   // 設定畫面用完即收
    if (app.phaseShown !== 'room') show('room');
    renderRoom();
  } else if (phase === 'loading') {
    // battleConfig 訊息會觸發 enterLoading;這裡只更新等待名單
    const waiting = m.lobby.clients.filter((c) => c.mode === 'player' && c.side && !c.loaded).map((c) => c.name);
    if (app.phaseShown === 'loading' && waiting.length) {
      $('loadLabel').textContent = `等待:${waiting.join('、')} 載入地形…`;
    }
  } else if (phase === 'game' || phase === 'over') {
    if (app.terrain && !app.battle) enterGame();
  }
}

window.addEventListener('DOMContentLoaded', () => {
  $('myName').value = localStorage.getItem('svs_name') || '';

  // 還原上次的開房設定(人數 / 尺寸 / 房名;場地在 enterOpenRoom 還原)
  const prefs = loadPrefs();
  if (prefs.teamSize >= TEAM.MIN && prefs.teamSize <= TEAM.MAX) app.teamSize = prefs.teamSize;
  if (prefs.sizeKey) app.sizeKey = prefs.sizeKey;
  $('roomNameInput').value = prefs.roomName || '';
  $('roomNameInput').addEventListener('input', (e) => savePrefs({ roomName: e.target.value.trim() }));

  app.net = new Net({
    sync: onSync,
    rooms: (m) => renderRooms(m.rooms),
    error: (m) => {
      toast(`⚠️ ${m.msg}`);
      // 開房被拒(驗證失敗)→ 解鎖建立鈕讓房主重試
      if (app.phaseShown === 'openroom') $('createRoomBtn').disabled = !app.favCfg;
    },
    info: (m) => toast(m.msg),
    battleConfig: (m) => enterLoading(m.config),
    // 危險區靜態資料(地雷等):可能比 BattleClient 早到,先暫存
    field: (m) => { app.fieldMsg = m; app.battle?.onField(m); },
    snap: (m) => app.battle?.onSnap(m),
    tracer: (m) => app.battle?.onTracer(m),
    reconnect: () => {
      const tk = sessionStorage.getItem('svs_token');
      if (tk) app.net.sendNow({ t: 'reattach', token: tk });
      app.net.flushQueue();
    },
  });

  $('mapBuilderBtn').onclick = () => { myName(); enterMapBuilder(); };
  $('openRoomBtn').onclick = () => { myName(); enterOpenRoom(); };
  $('refreshRoomsBtn').onclick = refreshRooms;
  $('joinBtn').onclick = () => {
    const pin = $('joinPin').value.trim();
    if (pin.length !== 4) { toast('請輸入 4 位數 PIN'); return; }
    const mode = document.querySelector('input[name=joinMode]:checked')?.value || 'player';
    app.net.send({ t: 'joinRoom', pin, name: myName(), mode });
  };

  for (const side of ['SWARM', 'STEEL']) {
    $(`side${side}`).onclick = () => {
      const me = app.lobby?.clients.find((c) => c.id === app.youId);
      if (!me || me.mode !== 'player') return;
      // 已在此陣營 → 離開;否則加入(滿了由伺服器拒絕)
      app.net.send({ t: 'pickSide', side: me.side === side ? null : side });
    };
  }
  $('readyBtn').onclick = () => {
    const me = app.lobby?.clients.find((c) => c.id === app.youId);
    app.net.send({ t: 'setReady', ready: !me?.ready });
  };
  $('startBattleBtn').onclick = () => app.net.send({ t: 'startBattle' });
  $('leaveRoomBtn').onclick = () => {
    app.net.send({ t: 'leaveRoom' });
    sessionStorage.removeItem('svs_token');
    location.reload();
  };

  window.__SVS = app; // 除錯/測試用
  show('connect');
  refreshRooms();
  app.roomPoll = setInterval(() => {
    if (app.phaseShown === 'connect') refreshRooms();
  }, 5000);
});
