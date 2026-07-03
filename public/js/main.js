// ============ 無人戰略:鋼鐵與蜂群 — 前端主控 ============
// 畫面流程:connect(大廳)→ mapbuilder(建地圖:隊伍規模/場地/選址,存入最愛)
//          → openroom(開戰時刻:從最愛挑地圖 + 房名/公開性/環境 → 開房)
//          → room(配對,每陣營 N 席)→ loading(地形+地貌建構)→ game → over
import { Net } from './net.js';
import { SIDES, ENV, TEAM, lanesFor, targetDistFor, MAPGEO, WEAPONS, ECON, upgradePrice, CLASS_NAME } from './data.js';
import { MapSelect } from './mapSelect.js';
import { buildTerrain } from './terrain.js';
import { buildBiomes } from './biomes.js';
import { envLabel } from './environment.js';
import { preloadModels } from './models.js';
import { VENUES, venueConfig, loadFavorites, saveFavorite, removeFavorite } from './venues.js';
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
            `・${cfg.laneCount} 條兵線,最大重合 <b>${(cfg.maxOverlap * 100).toFixed(0)}%</b>${cfg.synthetic ? '(含離線模擬路徑)' : ''}`;
        }
      },
    });
    renderTeamSize();
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
  const size = targetDistFor(L) / (MAPGEO.BASE_DIST_FRAC * Math.SQRT2);
  $('tsInfo').textContent = `總共 ${app.teamSize * 2} 位玩家 ・ ${L} 條兵線 ・ 戰場約 ${(size / 1000).toFixed(1)} km 見方`;
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
  const cfg = venueConfig(v, app.teamSize);
  app.mapSel.showConfig(cfg);      // 內部會 reset(觸發 confirmReady(null)),故 favCfg 之後再設
  app.venueSel = v;
  app.favCfg = cfg;
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
      app.favCfg = f.cfg;
      app.venueSelOpen = null;   // 最愛的兵線是存檔時就烤死的配置,跟即時場地選擇互斥
      for (const el of grid.children) el.classList.remove('on');
      for (const el of $('venueGridOpen').children) el.classList.remove('on');
      for (const [i, tb] of [...$('tsRowOpen').children].entries()) tb.classList.toggle('on', i + TEAM.MIN === f.teamSize);
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
  renderVenuesOpen();
  renderEnvSelects();
  renderFavsOpenRoom();
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
  const size = targetDistFor(L) / (MAPGEO.BASE_DIST_FRAC * Math.SQRT2);
  $('tsInfoOpen').textContent = `總共 ${app.teamSize * 2} 位玩家 ・ ${L} 條兵線 ・ 戰場約 ${(size / 1000).toFixed(1)} km 見方`;
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
  const cfg = venueConfig(v, app.teamSize);
  app.venueSelOpen = v;
  app.favCfg = cfg;
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
        div.innerHTML = `${c.isHost ? '👑 ' : ''}${c.isBot ? '🤖 ' : ''}${esc(c.name)} <span class="slot-ready">${c.ready ? '✅' : '⏳'}</span>${c.connected === false ? ' 🔌' : ''}`;
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
    const st = biomes.userData.stats;
    setP(0.97, `等待其他指揮官…(植被 ${st.veg}・建物 ${st.buildings}` +
      `${st.rails ? `・鐵路 ${st.rails} 段` : ''}${st.falls ? `・瀑布 ${st.falls}` : ''}${st.osm ? '・OSM 圖資' : ''})`);
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
  app.battle = new BattleClient({
    canvas: $('gameCanvas'),
    minimapCanvas: $('minimap'),
    cfg: app.battleCfg,
    side: app.mySide,
    youId: app.youId,
    net: app.net,
    terrain: app.terrain,
    hud,
  });
  if (app.fieldMsg) app.battle.onField(app.fieldMsg);   // 開戰前就收到的危險區資料
  // 陣營樣式 & 操作說明
  document.body.dataset.side = app.mySide || 'SPEC';
  const isDrone = app.mySide && SIDES[app.mySide].hero === 'drone';
  $('hudSideName').textContent = app.mySide ? `${SIDES[app.mySide].name} ・ ${SIDES[app.mySide].heroName}` : '觀戰模式';
  $('hudHelp').innerHTML = app.mySide
    ? (isDrone
      ? 'W/S 沿視線飛 ・ A/D 橫移 ・ Space/C 升降 ・ 左鍵 射擊 ・ 右鍵 瞄準(彈藥空時改換彈夾) ・ F/高速撞擊 自爆 ・ 1/2 切武器 ・ R 填彈 ・ B 商店 ・ 偏離兵線小心防空!'
      : 'WASD 移動 ・ Space 跳 ・ Shift 衝刺 ・ 左鍵 射擊(瞄準時發射火箭) ・ 右鍵 按住瞄準(彈藥空時改換彈夾) ・ 1/2/3 切武器 ・ R 填彈 ・ B 商店 ・ 偏離兵線小心地雷!')
    : 'WASD 移動 ・ Space/C 升降 ・ Shift 加速(觀戰自由視角)';
  toast('點擊畫面鎖定滑鼠開始戰鬥', 4000);
}

function makeHud() {
  const feedBox = $('killFeed');
  return {
    self: (hp, max, cd, w) => {
      $('hpBar').style.width = `${Math.max(0, hp / max * 100)}%`;
      $('hpText').textContent = `${Math.max(0, Math.round(hp))} / ${max}`;
      if (w) {
        // 主武器:彈藥 / 填彈
        $('wpnName').textContent = `[${w.slot}] ${w.name}`;
        $('wpnAmmo').textContent = w.reload > 0 ? `填彈 ${w.reload.toFixed(1)}s` : `${w.ammo} / ${w.mag}`;
        $('wpnAmmo').classList.toggle('reloading', w.reload > 0);
        $('wpnAmmo').classList.toggle('low', w.reload <= 0 && w.ammo <= w.mag * 0.25);
        // 副武器:火箭彈數(瞄準+左鍵發射)/ 自爆(F 鍵)
        const alt = w.alt;
        const altText = alt.label
          ? `${alt.name}(F/撞擊)`
          : (alt.reload > 0 ? `${alt.name} 填彈 ${alt.reload.toFixed(1)}s` : `${alt.name} ×${alt.ammo}(瞄準+左鍵)`);
        $('burstName').textContent = altText;
        $('moneyText').textContent = Math.floor(w.money);
        $('shopHint').textContent = w.atBase ? 'B 開軍械庫' : '升級隨處可買(B)・熱兵器需回主堡';
      }
      const cdEl = $('burstCd');
      cdEl.textContent = cd > 0 ? `${cd.toFixed(1)}s` : '就緒';
      cdEl.classList.toggle('ready', cd <= 0);
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

// ================= 主堡軍械庫(B 鍵開關;升級隨處可買,熱兵器需在主堡)=================
function renderShop(open, st) {
  const ov = $('shopOverlay');
  ov.style.display = open ? '' : 'none';
  if (!open || !st) return;
  $('shopMoney').textContent = `💰 ${Math.floor(st.money)}`;
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
  head('⬆️ 升級(隨處可買,立即生效)');
  for (const [id, up] of Object.entries(ECON.UPGRADES)) {
    const lvl = st.upg[id] || 0;
    const full = lvl >= up.max;
    const price = full ? null : upgradePrice(up, lvl);
    row(`<b>${up.name}</b> Lv.${lvl}/${up.max} <span class="dim">${up.desc}</span>`,
      price, !full && st.money >= price, () => st.buy(id), full ? '已滿級' : '');
  }
  head(`🔫 熱兵器(${st.items.length}/${st.slots} 槽${st.atBase ? '' : ' ・ 需回主堡補給圈'})`);
  for (const [id, wd] of Object.entries(WEAPONS)) {
    if (!wd.price) continue;
    const owned = st.items.includes(id);
    const vs = Object.entries(wd.vs).filter(([, m]) => m > 1)
      .map(([k, m]) => `${CLASS_NAME[k]}×${m}`).join(' ');
    const enabled = !owned && st.atBase && st.items.length < st.slots && st.money >= wd.price;
    row(`<b>${wd.name}</b> <span class="tag dim">${wd.tag}</span> <span class="dim">傷害 ${wd.dmg} ・ 彈夾 ${wd.mag} ・ ${vs}</span>`,
      owned ? null : wd.price, enabled, () => st.buy(id), owned ? '已擁有' : '');
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
