// ============ 無人戰略:鋼鐵與蜂群 — 前端主控 ============
// 畫面流程:connect(大廳)→ room(配對)→ mapselect(戰場選址)
//          → loading(地形建構)→ game(戰鬥)→ over
import { Net } from './net.js';
import { SIDES } from './data.js';
import { MapSelect } from './mapSelect.js';
import { buildTerrain } from './terrain.js';
import { preloadModels } from './models.js';
import { BattleClient } from './game.js';

const $ = (id) => document.getElementById(id);
const screens = ['connect', 'room', 'mapselect', 'loading', 'game'];

const app = {
  net: null,
  youId: null, isHost: false, token: null,
  lobby: null,          // 伺服器同步的房間狀態
  mySide: null,
  mapSel: null,         // MapSelect 實例(房主)
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
    const sideTags = `${r.sides.SWARM ? `<span class="tag swarm">🐝 ${r.sides.SWARM}</span>` : '<span class="tag open">🐝 空位</span>'}
                      ${r.sides.STEEL ? `<span class="tag steel">🤖 ${r.sides.STEEL}</span>` : '<span class="tag open">🤖 空位</span>'}`;
    row.innerHTML = `
      <div class="room-info">
        <div class="room-name">${r.isPublic ? '🌐' : '🔒'} ${esc(r.name)} <span class="room-host">房主:${esc(r.host)}</span></div>
        <div class="room-tags">${sideTags}
          <span class="tag dim">${r.phase === 'room' ? '配對中' : r.phase === 'game' ? '交戰中' : '準備中'}</span>
          ${r.place ? `<span class="tag dim">📍 ${esc(r.place)}</span>` : ''}
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

// ================= 房間(配對)=================
function renderRoom() {
  const lb = app.lobby;
  if (!lb) return;
  $('roomTitle').textContent = lb.config.roomName || '未命名戰區';
  $('roomPin').textContent = lb.pin;
  $('roomUrls').textContent = (lb.urls || []).join('  ');

  const me = lb.clients.find((c) => c.id === app.youId);
  app.mySide = me?.side || null;

  for (const side of ['SWARM', 'STEEL']) {
    const card = $(`side${side}`);
    const holder = lb.clients.find((c) => c.side === side);
    const nameEl = card.querySelector('.side-player');
    const readyEl = card.querySelector('.side-ready');
    card.classList.toggle('taken', !!holder);
    card.classList.toggle('mine', holder?.id === app.youId);
    nameEl.textContent = holder ? `${holder.isHost ? '👑 ' : ''}${holder.name}` : '—— 等待指揮官 ——';
    readyEl.textContent = holder ? (holder.ready ? '✅ 準備完成' : '⏳ 整備中') : '';
  }

  const specs = lb.clients.filter((c) => c.mode === 'spectator');
  $('specList').textContent = specs.length ? `👁️ 觀戰:${specs.map((c) => c.name).join('、')}` : '';

  const readyBtn = $('readyBtn');
  readyBtn.disabled = !me?.side;
  readyBtn.textContent = me?.ready ? '取消準備' : '✔ 準備完成';
  readyBtn.classList.toggle('on', !!me?.ready);

  const startBtn = $('startSetupBtn');
  startBtn.style.display = app.isHost ? '' : 'none';
  const players = lb.clients.filter((c) => c.mode === 'player' && c.side);
  const allReady = players.length > 0 && players.every((c) => c.ready);
  startBtn.disabled = !allReady;
  startBtn.textContent = players.length < 2 ? '🗺️ 前往選址(單人練習)' : '🗺️ 前往戰場選址';
  $('roomHint').textContent = app.isHost
    ? (allReady ? '全員就緒,可以前往戰場選址!' : '雙方選好陣營並按「準備完成」後,由你啟動選址。')
    : '等待房主啟動戰場選址…';
}

// ================= 戰場選址 =================
function enterMapSelect() {
  show('mapselect');
  const isHost = app.isHost;
  $('mapHostPanel').style.display = isHost ? '' : 'none';
  $('mapGuestPanel').style.display = isHost ? 'none' : '';
  $('confirmSiteBtn').disabled = true;

  if (isHost && !app.mapSel) {
    app.mapSel = new MapSelect('leafletMap', {
      status: (text, frac) => {
        $('mapStatus').textContent = text;
        $('mapProgressBar').style.width = `${Math.round(frac * 100)}%`;
        app.net.send({ t: 'mapProgress', status: text, frac });
      },
      candidates: (list) => {
        app.net.send({ t: 'mapProgress', status: `已找到 ${list.length} 個推薦點,等待房主選擇…`, frac: 1 });
      },
      confirmReady: (cfg) => {
        $('confirmSiteBtn').disabled = !cfg;
        if (cfg) {
          $('mapStatus').innerHTML =
            `已選定:兩堡直線 <b>${(cfg.distM / 1000).toFixed(2)} km</b>(對角線 80% 門檻 ${(cfg.diagM * 0.8 / 1000).toFixed(2)} km)` +
            `,三線最大重合 <b>${(cfg.maxOverlap * 100).toFixed(0)}%</b>${cfg.synthetic ? '(含離線模擬路徑)' : ''}`;
        }
      },
    });
    $('mapStatus').textContent = '在地圖上點選你的蜂群主堡位置,演算法會推薦對側的鋼鐵主堡點。';
    setTimeout(() => app.mapSel.map.invalidateSize(), 60);
  }
}

$('confirmSiteBtn')?.addEventListener('click', async () => {
  const cfg = app.mapSel?.buildConfig();
  if (!cfg) return;
  $('confirmSiteBtn').disabled = true;
  $('mapStatus').textContent = '取得地名並鎖定戰場…';
  await app.mapSel.fetchPlaceName(cfg);
  app.net.send({ t: 'battleConfig', config: cfg });
});
$('resetSiteBtn')?.addEventListener('click', () => app.mapSel?.reset());

// ================= 載入 + 開戰 =================
async function enterLoading(cfg) {
  app.battleCfg = cfg;
  if (app.mapSel) { app.mapSel.destroy(); app.mapSel = null; }
  if (app.battle) { app.battle.dispose(); app.battle = null; }
  show('loading');
  $('loadPlace').textContent = cfg.placeName || '';
  $('loadStats').textContent =
    `主堡距離 ${(cfg.distM / 1000).toFixed(2)} km ・ 戰場 ${(cfg.sizeM / 1000).toFixed(1)} km 見方 ・ 三線重合 ≤ ${(cfg.maxOverlap * 100).toFixed(0)}%`;

  const setP = (f, label) => {
    $('loadBar').style.width = `${Math.round(f * 100)}%`;
    $('loadLabel').textContent = label;
  };
  try {
    setP(0.02, '載入 3D 模型(Quaternius CC0)…');
    await preloadModels((f) => setP(f * 0.25, '載入 3D 模型(Quaternius CC0)…'));
    app.terrain = await buildTerrain(cfg, (f, label) => setP(0.25 + f * 0.7, label));
    setP(0.97, '等待其他指揮官…');
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
    net: app.net,
    terrain: app.terrain,
    hud,
  });
  // 陣營樣式 & 操作說明
  document.body.dataset.side = app.mySide || 'SPEC';
  const isDrone = app.mySide && SIDES[app.mySide].hero === 'drone';
  $('hudSideName').textContent = app.mySide ? `${SIDES[app.mySide].name} ・ ${SIDES[app.mySide].heroName}` : '觀戰模式';
  $('hudHelp').innerHTML = app.mySide
    ? (isDrone
      ? 'WASD 平移 ・ 滑鼠 視角 ・ Space/C 升降 ・ Shift 加速 ・ 左鍵 機砲 ・ 右鍵 空投炸彈 ・ M 大地圖'
      : 'WASD 移動 ・ 滑鼠 視角 ・ Space 跳躍 ・ Shift 衝刺 ・ 左鍵 重機槍 ・ 右鍵 火箭 ・ M 大地圖')
    : 'WASD 移動 ・ Space/C 升降 ・ Shift 加速(觀戰自由視角)';
  toast('點擊畫面鎖定滑鼠開始戰鬥', 4000);
}

function makeHud() {
  const feedBox = $('killFeed');
  return {
    self: (hp, max, cd) => {
      $('hpBar').style.width = `${Math.max(0, hp / max * 100)}%`;
      $('hpText').textContent = `${Math.max(0, Math.round(hp))} / ${max}`;
      const cdEl = $('burstCd');
      cdEl.textContent = cd > 0 ? `${cd.toFixed(1)}s` : '就緒';
      cdEl.classList.toggle('ready', cd <= 0);
    },
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
    $('overOverlay').style.display = 'none';
    delete $('overOverlay').dataset.done;
    if (app.phaseShown !== 'room') show('room');
    renderRoom();
  } else if (phase === 'mapselect') {
    if (app.phaseShown !== 'mapselect') enterMapSelect();
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
    error: (m) => toast(`⚠️ ${m.msg}`),
    info: (m) => toast(m.msg),
    battleConfig: (m) => enterLoading(m.config),
    mapProgress: (m) => {
      if (!app.isHost && app.phaseShown === 'mapselect') {
        $('guestMapStatus').textContent = m.status || '';
        $('guestMapBar').style.width = `${Math.round((m.frac || 0) * 100)}%`;
      }
    },
    snap: (m) => app.battle?.onSnap(m),
    tracer: (m) => app.battle?.onTracer(m),
    reconnect: () => {
      const tk = sessionStorage.getItem('svs_token');
      if (tk) app.net.sendNow({ t: 'reattach', token: tk });
      app.net.flushQueue();
    },
  });

  $('createBtn').onclick = () => {
    app.net.send({
      t: 'createRoom',
      name: myName(),
      roomName: $('roomNameInput').value.trim(),
      isPublic: $('createPublic').checked,
    });
  };
  $('refreshRoomsBtn').onclick = refreshRooms;
  $('joinBtn').onclick = () => {
    const pin = $('joinPin').value.trim();
    if (pin.length !== 4) { toast('請輸入 4 位數 PIN'); return; }
    const mode = document.querySelector('input[name=joinMode]:checked')?.value || 'player';
    app.net.send({ t: 'joinRoom', pin, name: myName(), mode });
  };

  for (const side of ['SWARM', 'STEEL']) {
    $(`side${side}`).onclick = () => {
      const holder = app.lobby?.clients.find((c) => c.side === side);
      if (holder && holder.id !== app.youId) return;
      app.net.send({ t: 'pickSide', side: holder?.id === app.youId ? null : side });
    };
  }
  $('readyBtn').onclick = () => {
    const me = app.lobby?.clients.find((c) => c.id === app.youId);
    app.net.send({ t: 'setReady', ready: !me?.ready });
  };
  $('startSetupBtn').onclick = () => app.net.send({ t: 'startSetup' });
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
