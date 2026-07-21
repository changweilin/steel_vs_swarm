// ============ 無人戰略:鋼鐵與蜂群 — 前端主控 ============
// 畫面流程:connect(大廳)→ mapbuilder(建地圖:隊伍規模/場地/選址,存入最愛)
//          → openroom(開戰時刻:從最愛挑地圖 + 房名/公開性/環境 → 開房)
//          → room(配對,每陣營 N 席)→ loading(地形+地貌建構)→ game → over
import { Net } from './net.js';
import {
  SIDES, ENV, TEAM, lanesFor, sideMFor, MAPGEO, ECON, upgradePrice,
  CHARACTERS, charsOf, charKind, heroWeapon, heroAbility, recoilName,
  UNITS, WEAPONS, CLASS_NAME, TARGET_CLASS, LOS, WATER,
  BOT_DIFF, BOT_DIFF_KEYS, DEFAULT_BOT_DIFF,
  THIRD, isThirdSide, sideInfo, CIVILIAN, CIVILIANS,
} from './data.js';
import { LORE } from './lore.js';
import { avatarURL, portraitURL } from './portraits.js';

import { MapSelect } from './mapSelect.js';
import { buildTerrain } from './terrain.js';
import { buildBiomes, makeDeckIndex, makeTunnelIndex, terrainEnvCode } from './biomes.js';
import { envLabel } from './environment.js';
import { preloadModels } from './models.js';
import { CharPreview } from './charPreview.js';
import { VENUES, venueConfig, migrateFavCfg, loadFavorites, saveFavorite, removeFavorite } from './venues.js';
import { STORY, WORLD, chapterSide, loadStoryCleared, isCleared, chapterUnlocked, markCleared } from './story.js';
import { BattleClient } from './game.js';

const $ = (id) => document.getElementById(id);
const screens = ['connect', 'mapbuilder', 'openroom', 'story', 'room', 'loading', 'game'];

/**
 * 水沼粗網格烘烤(2026-07-19;房主載圖後上傳,供伺服器中立單位佈點/移動迴避)。
 * 逐格取 terrainEnvCode(0 乾 / 1 水 / 2 沼),sim 座標系(x = three x、z 北 = −three z);
 * 回傳 { minX, minZ, cell, cols, rows, data },data 為 cols×rows 個 '0'/'1'/'2' 字元(row-major)。
 */
function bakeWetGrid(t) {
  const cell = WATER.GRID_M;
  const minX = t.minX, minZ = -t.maxZ;   // sim z = −three z ⇒ three maxZ 對應 sim minZ
  const cols = Math.max(1, Math.min(300, Math.ceil((t.maxX - t.minX) / cell)));
  const rows = Math.max(1, Math.min(300, Math.ceil((t.maxZ - t.minZ) / cell)));
  let data = '';
  for (let i = 0; i < rows; i++) {
    const sz = minZ + (i + 0.5) * cell;              // sim z(格心)
    for (let j = 0; j < cols; j++) {
      const sx = minX + (j + 0.5) * cell;            // sim x = three x
      data += String(terrainEnvCode(t, sx, -sz));    // 取樣 three 座標 (sx, −sz)
    }
  }
  return { minX: Math.round(minX * 10) / 10, minZ: Math.round(minZ * 10) / 10, cell, cols, rows, data };
}
const DECK_STEP = 2.2;   // 上橋台階(遊戲公尺):低於橋面這麼多以上 = 從橋下走過,不會被吸上橋
const DECK_MARGIN = 3.0;  // 站立表面側向容差:走位/轉向/後座漂移貼近橋緣仍不掉下橋(上橋更穩);天花碰撞不吃此容差
                          // 值大 = 站得住橋緣外一截(免掉橋),代價是可站到可見橋緣外 3m —— 取「不掉橋」優先
const DECK_UNDER = 1.2;   // 橋面結構厚度(頂面→底緣);= biomes.js soffit/girder 底緣深
const MAX_MECH_H = 4.8;   // 最大機體所需淨空(4.5m + 頭頂餘裕)。橋底緣離地低於此 = 鑽不過去 → 該上橋,
                          // MUST NOT 讓機體卡在「上不了橋面(> DECK_STEP)又鑽不過橋腹」的死區(引道口卡住前科)

const app = {
  net: null,
  youId: null, isHost: false, token: null,
  lobby: null,          // 伺服器同步的房間狀態
  mySide: null,
  charTarget: null,     // 選角對象:null = 自己;bot id = 房主代選(setBotChar)
  preview: null,        // CharPreview(機體展示台);previewCv 為其共用 canvas 節點
  previewCv: null,
  stages: { char: null, unit: null },   // 角色卡 / NPC 卡各一台持久展示台(各自 WebGLRenderer,同框並存)
  modalRole: null,      // 放大視窗當前展示的 role('char'|'unit'|null=關閉)
  unitSide: null,       // NPC 圖鑑檢視陣營(可切換);unitKind = 目前選的單位;unitShown = 已載入的 kind:side
  unitKind: null, unitShown: null, civProf: 0, civFaction: 'STEEL',   // 平民圖鑑:目前檢視的職業 index + 陣營
  pickSubject: null, pickSide: null, pickEditable: false, pickIsSelf: false,   // 選角上下文(供放大視窗角色格)
  mapSel: null,         // MapSelect 實例(開房前的設定畫面)
  teamSize: TEAM.DEFAULT,
  favCfg: null,         // 從「我的最愛」直接取用的 battleConfig
  story: null,          // 劇情戰役進行中:{ chapterId, side, foe, ch(主駕), allies[], enemies[], index, launched }
  storySide: 'STEEL',   // 目前瀏覽的戰線陣營(協約 / 同盟)
  storyPilot: null,     // 簡報中選定的出戰主駕
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
  if (screen !== 'room') { closeStageModal?.(); stopStages?.(); app.charTarget = null; }   // 離開房間:收放大視窗、兩台展示台停 rAF,不與戰場搶 GPU
  // 主視覺:大廳/選圖/開房一律回到「藍黃左右對抗」;房間交給 renderRoom(依選角收束)、戰鬥交給 enterGame
  if (screen === 'connect' || screen === 'mapbuilder' || screen === 'openroom' || screen === 'story') document.body.dataset.side = 'SPEC';
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
    const sideTags = `<span class="tag swarm">SWARM ${r.sides.SWARM.length}/${n}</span>
                      <span class="tag steel">STEEL ${r.sides.STEEL.length}/${n}</span>`;
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
  const size = sideMFor(L);
  $('tsInfo').textContent = `總共 ${app.teamSize * 2} 位玩家 ・ ${L} 條兵線 ・ 戰場約 ${(size / 1000).toFixed(1)} km 見方(真實 ${(size * MAPGEO.REAL_SCALE / 1000).toFixed(2)} km)`;
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
    b.innerHTML = `★ ${esc(f.name)} <span class="venue-type">${f.teamSize}v${f.teamSize}</span>`;
    b.onclick = () => {
      app.teamSize = f.teamSize;
      const cfg = migrateFavCfg(f);        // 尺度追溯:舊尺度最愛自動遷移
      savePrefs({ teamSize: f.teamSize });
      app.favCfg = cfg;
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
  const size = sideMFor(L);
  $('tsInfoOpen').textContent = `總共 ${app.teamSize * 2} 位玩家 ・ ${L} 條兵線 ・ 戰場約 ${(size / 1000).toFixed(1)} km 見方(真實 ${(size * MAPGEO.REAL_SCALE / 1000).toFixed(2)} km)`;
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
  // 環境選擇記憶:與人數/場地/房名同存於 svs_prefs.env,重啟瀏覽器仍還原
  const saved = loadPrefs().env || {};
  const persist = () => savePrefs({
    env: { season: $('envSeason').value, time: $('envTime').value, weather: $('envWeather').value },
  });
  const fill = (id, obj, label, key) => {
    const sel = $(id);
    sel.innerHTML = `<option value="random">🎲 隨機${label}</option>`;
    for (const [k, v] of Object.entries(obj)) {
      sel.innerHTML += `<option value="${k}">${v.name}</option>`;
    }
    const want = saved[key];
    sel.value = (want === 'random' || obj[want]) ? want : 'random';   // 舊值失效退回隨機
    sel.onchange = persist;
  };
  fill('envSeason', ENV.seasons, '季節', 'season');
  fill('envTime', ENV.times, '時段', 'time');
  fill('envWeather', ENV.weathers, '天氣', 'weather');
}

// ================= 劇情戰役(雙陣營雙故事線:選陣營 → 選章 → 圖文簡報 + 選主駕 → 出戰)=================
const STORY_DIFF = ['novice', 'low', 'low', 'medium', 'medium', 'high'];   // 六章難度漸升

function enterStory() {
  app.story = null;                       // 進場清空(可能剛從某場劇情戰役退回)
  if (app.storySide !== 'STEEL' && app.storySide !== 'SWARM') app.storySide = 'STEEL';
  $('storyBrief').style.display = 'none';
  $('worldOverlay').style.display = 'none';
  $('storyDeploy').style.display = 'none';
  show('story');
  renderStorySide();
}

/** 切換/重繪目前瀏覽的陣營戰線(主視覺色軌一併收束成該陣營) */
function renderStorySide() {
  const side = app.storySide;
  document.querySelectorAll('#storySideToggle .ss-btn').forEach((b) => b.classList.toggle('on', b.dataset.side === side));
  document.body.dataset.side = side;
  $('storyBlurb').textContent = side === 'STEEL'
    ? '你指揮協約的鋼鐵機甲,替沒能穿上裝甲的孩子補上那一層。沿全球戰線鎮壓蜂群,擊毀敵方主堡即通關,解鎖下一戰場。'
    : '你指揮同盟的蜂群無人機,用數量與速度證明便宜的東西一樣能贏。沿全球戰線抵擋協約,擊毀敵方主堡即通關,解鎖下一戰場。';
  renderStoryChapters();
}

function renderStoryChapters() {
  const side = app.storySide;
  const grid = $('storyChapters');
  grid.innerHTML = '';
  let clearedN = 0;
  STORY.forEach((ch, i) => {
    const sc = chapterSide(ch, side);
    const unlocked = chapterUnlocked(side, i);
    const cleared = isCleared(side, ch.id);
    if (cleared) clearedN++;
    const v = VENUES.find((x) => x.id === ch.venueId);
    const card = document.createElement(unlocked ? 'button' : 'div');
    card.className = 'chapter-card' + (unlocked ? '' : ' locked') + (cleared ? ' cleared' : '');
    const state = cleared ? '<span class="chapter-state done">✓ 已通關</span>'
      : unlocked ? '<span class="chapter-state go">▶ 可出戰</span>'
      : '<span class="chapter-state lock">🔒 未解鎖</span>';
    card.innerHTML = `
      <span class="chapter-num">${i + 1}</span>
      <div class="chapter-body">
        <span class="chapter-title">${esc(ch.act)} ・ ${esc(sc.title)}</span>
        <span class="chapter-place">📍 ${esc(v ? v.name : ch.venueId)} ・ ${esc(envLabel(ch.env))} ・ ${ch.teamSize}v${ch.teamSize}</span>
      </div>
      ${state}`;
    if (unlocked) card.onclick = () => showStoryBrief(i);
    grid.appendChild(card);
  });
  $('storyProgress').textContent = `${SIDES[side].name}戰線:已通關 ${clearedN} / ${STORY.length}`
    + (clearedN >= STORY.length ? ' ・ 🏆 全戰線肅清!' : '');
}

/** 角色小卡(選主駕 / 敵方預覽共用) */
function heroChip(id, opts = {}) {
  const c = CHARACTERS[id] || {};
  const cls = 'sb-chip' + (opts.merc ? ' merc' : '') + (opts.on ? ' on' : '') + (opts.enemy ? ' enemy' : '');
  return `<button class="${cls}" data-ch="${id}"${opts.enemy ? ' disabled' : ''}>
      <img src="${avatarURL(id)}" alt="">
      <span class="sb-chip-txt"><b>「${esc(c.code || '')}」</b>${esc(c.name || '')}${opts.merc ? '<i>傭兵</i>' : ''}</span>
    </button>`;
}

function showStoryBrief(i) {
  const ch = STORY[i];
  const side = app.storySide, foe = side === 'STEEL' ? 'SWARM' : 'STEEL';
  const sc = chapterSide(ch, side), ec = chapterSide(ch, foe);
  const v = VENUES.find((x) => x.id === ch.venueId);
  const roster = [...sc.heroes, ...sc.mercs];
  app.storyPilot = roster[0];             // 預設主駕 = 第一名陣營角色
  const cine = sc.img
    ? `<img class="sb-cine-img" src="${esc(sc.img)}" alt="${esc(sc.title)}" onerror="this.classList.add('sb-cine-fail')">`
    : '';
  const mercSet = new Set(sc.mercs);
  const yourChips = roster.map((id) => heroChip(id, { merc: mercSet.has(id), on: id === app.storyPilot })).join('');
  const foeMerc = new Set(ec.mercs);
  const foeChips = [...ec.heroes, ...ec.mercs].map((id) => heroChip(id, { merc: foeMerc.has(id), enemy: true })).join('');
  // 圖文並茂:全幅立繪 → 長篇敘事 → 雙方陣容(選主駕)→ 任務目標
  $('storyBriefBody').innerHTML = `
    <div class="sb-cine sb-cine-${side}">
      ${cine}
      <div class="sb-cine-scrim"></div>
      <div class="sb-cine-corners"><i></i><i></i><i></i><i></i></div>
      <div class="sb-cine-tag">${side === 'STEEL' ? '協約 · 鋼鐵征討' : '同盟 · 蜂群逆襲'}</div>
      <div class="sb-cine-cap">
        <div class="sb-cine-act">${esc(ch.act)} ／ CH.${String(i + 1).padStart(2, '0')}</div>
        <div class="sb-cine-name">${esc(sc.title)}</div>
        <div class="sb-cine-meta">📍 ${esc(v ? v.name : ch.venueId)} ・ ${esc(envLabel(ch.env))} ・ ${ch.teamSize}v${ch.teamSize}</div>
      </div>
    </div>
    <div class="sb-prose"><p class="sb-intro">${esc(sc.intro).replace(/\n\n+/g, '</p><p class="sb-intro">')}</p></div>
    <div class="sb-roster" style="--own:var(${side === 'STEEL' ? '--steel' : '--swarm'});--foe:var(${side === 'STEEL' ? '--swarm' : '--steel'})">
      <div class="sb-roster-h your">◈ 你的部隊 — 點選出戰主駕,其餘為 AI 僚機</div>
      <div class="sb-chips" id="sbYourChips">${yourChips}</div>
      <div class="sb-roster-h foe">✖ 當面之敵</div>
      <div class="sb-chips">${foeChips}</div>
    </div>
    <div class="sb-obj">${esc(sc.objective)}</div>`;
  $('sbYourChips').querySelectorAll('.sb-chip').forEach((btn) => {
    btn.onclick = () => {
      app.storyPilot = btn.dataset.ch;
      $('sbYourChips').querySelectorAll('.sb-chip').forEach((b) => b.classList.toggle('on', b === btn));
    };
  });
  $('storyFightBtn').className = 'btn big ' + (side === 'STEEL' ? 'steel-btn' : 'swarm-btn');
  $('storyFightBtn').onclick = () => startStoryChapter(i);
  $('storyBrief').style.display = '';
  $('storyBriefBody').scrollTop = 0;
}

/** 出擊:組 battleConfig 開私人房;僚機/敵方角色於 launchStoryBattle 指派 */
function startStoryChapter(i) {
  const ch = STORY[i];
  const side = app.storySide, foe = side === 'STEEL' ? 'SWARM' : 'STEEL';
  const sc = chapterSide(ch, side), ec = chapterSide(ch, foe);
  const v = VENUES.find((x) => x.id === ch.venueId);
  if (!v) { toast('⚠️ 找不到戰場資料'); return; }
  const cfg = venueConfig(v, ch.teamSize);
  cfg.env = { ...ch.env };
  const pilot = app.storyPilot || sc.heroes[0];
  const allies = [...sc.heroes, ...sc.mercs].filter((id) => id !== pilot);   // 我方僚機(指名 AI)
  const enemies = [...ec.heroes, ...ec.mercs];                              // 敵方陣容(指名 AI)
  app.story = { chapterId: ch.id, side, foe, ch: pilot, allies, enemies, index: i, launched: false };
  $('storyBrief').style.display = 'none';
  $('storyDeploy').style.display = '';
  $('storyDeploy').textContent = `⚙ 部署中:${sc.title}(${v.name})…`;
  app.net.send({
    t: 'createRoom', name: myName(), roomName: sc.title, isPublic: false,
    teamSize: ch.teamSize, botDiff: STORY_DIFF[i] || 'medium', battleConfig: cfg,
  });
}

/** onSync 在 room 階段呼叫一次:選陣營/主駕、指名我方僚機 + 敵方陣容、開戰。
    私人劇情房 nextBotId 從 0 起、且只有房主在操作 ⇒ addBot 次序決定 bot id 為 b1,b2,…(可預測),
    因此能一次把 setBotChar 指名完再開戰,不必等每次 addBot 的 lobby 回廣播。 */
function launchStoryBattle() {
  const s = app.story;
  s.launched = true;
  app.mySide = s.side;
  const net = app.net;
  net.send({ t: 'pickSide', side: s.side });
  net.send({ t: 'pickChar', ch: s.ch });
  let n = 0;
  const assign = [];
  for (const id of s.allies) { net.send({ t: 'addBot', side: s.side }); assign.push(['b' + (++n), id]); }
  for (const id of s.enemies) { net.send({ t: 'addBot', side: s.foe }); assign.push(['b' + (++n), id]); }
  for (const [bid, cid] of assign) net.send({ t: 'setBotChar', id: bid, ch: cid });
  net.send({ t: 'setReady', ready: true });
  net.send({ t: 'startBattle' });
}

/** 退出劇情戰役(勝負已定或中途離開):收掉單人房,回到章節選擇(重繪解鎖狀態) */
function exitStoryBattle() {
  app.net.send({ t: 'leaveRoom' });
  if (app.battle) { app.battle.dispose(); app.battle = null; }
  app.terrain = null;
  app.lobby = null;
  app.story = null;
  app.fieldMsg = null;
  $('overOverlay').style.display = 'none';
  $('pauseOverlay').style.display = 'none';
  $('shopOverlay').style.display = 'none';
  delete $('overOverlay').dataset.done;
  sessionStorage.removeItem('svs_token');
  enterStory();
}

/** 離開戰場(暫停選單「離開戰場」共用):劇情 → 回章節;一般對戰 → 退回大廳 */
function leaveBattle() {
  if (app.story) { exitStoryBattle(); return; }
  app.net.send({ t: 'leaveRoom' });
  sessionStorage.removeItem('svs_token');
  location.reload();
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
  // 選角高亮對象 = 任一 client id(自己/電腦/他人);指向的對象消失就退回自己
  if (!lb.clients.some((c) => c.id === app.charTarget)) app.charTarget = me?.side ? me.id : null;
  // 主視覺:自己的角色一經 highlight,整套 UI 單色件收束成該陣營色(style.css --uiL/--uiR);
  // 尚未選角(含觀戰/未入座)= 藍黃左右對抗。傭兵跟雇主陣營走。
  document.body.dataset.side = (me?.mode === 'player' && me.side && me.ch) ? me.side : 'SPEC';

  const slotX = (title, fn) => {
    const x = document.createElement('span');
    x.className = 'slot-x';
    x.textContent = '✕';
    x.title = title;
    x.onclick = (e) => { e.stopPropagation(); fn(); };
    return x;
  };

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
      if (c) {
        // 填滿槽位:點整格 = 高亮 + 檢視該玩家角色(自己/電腦可改、他人唯讀)
        div.className = 'slot filled' + (c.id === app.youId ? ' me' : '') + (c.isBot ? ' bot' : '')
          + (app.charTarget === c.id ? ' sel' : '');
        const chTag = c.ch && CHARACTERS[c.ch] ? `<span class="slot-char">「${CHARACTERS[c.ch].code}」</span>` : '<span class="slot-char dim">RND</span>';
        div.innerHTML = `<span class="slot-name">${c.isHost ? '◆ ' : ''}${c.isBot ? '▣ ' : ''}${esc(c.name)}</span> ${chTag}<span class="slot-ready">${c.ready ? '●' : '○'}${c.connected === false ? ' ✕' : ''}</span>`;
        div.onclick = () => { app.charTarget = c.id; renderRoom(); };
        // 自己:X 才離座(點格子只是選取,不再離座);電腦(房主):X 移除
        if (c.id === app.youId) div.appendChild(slotX('離開座位', () => app.net.send({ t: 'pickSide', side: null })));
        else if (c.isBot && app.isHost) div.appendChild(slotX('移除電腦玩家', () => app.net.send({ t: 'removeBot', id: c.id })));
      } else {
        // 空位:入座 + 加電腦玩家,兩顆按鈕同寬
        div.className = 'slot empty';
        if (me && me.mode === 'player' && me.side !== side) {
          const join = document.createElement('button');
          join.className = 'slot-btn';
          join.textContent = '＋ 入座';
          join.onclick = (e) => { e.stopPropagation(); app.net.send({ t: 'pickSide', side }); };
          div.appendChild(join);
        }
        if (app.isHost) {
          const add = document.createElement('button');
          add.className = 'slot-btn';
          add.textContent = '＋ 電腦玩家';
          add.onclick = (e) => { e.stopPropagation(); app.net.send({ t: 'addBot', side }); };
          div.appendChild(add);
        }
        if (!div.childElementCount) div.innerHTML = '<span class="slot-empty-label">—— 空位 ——</span>';
      }
      slotsEl.appendChild(div);
    }
  }

  renderCharPick(me);

  const specs = lb.clients.filter((c) => c.mode === 'spectator');
  $('specList').textContent = specs.length ? `◇ 觀戰:${specs.map((c) => c.name).join('、')}` : '';

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
    row.textContent = `▣ 電腦難度:${BOT_DIFF[cur]?.name || cur}`;
    return;
  }
  row.innerHTML = '▣ 電腦難度:';
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
  else bits.push(`彈夾 ${tri((l) => w(l).mag)}`, `裝填 ${tri((l) => w(l).reload, 1)}s`);
  if (raw.r) bits.push(`爆風 ${tri((l) => w(l).r)}m`);
  if (raw.pen) bits.push(`破甲 ${tri((l) => w(l).pen)}`);
  if (raw.crit) bits.push(`爆擊 ${Math.round(w(1).crit * 100)}%×${w(1).critX}`);
  if (raw.emp) bits.push(`癱瘓 ${tri((l) => w(l).emp, 1)}s`);
  // 機制標籤(2026-07-11 武器多元化):一眼看出這把的操作手感
  if (raw.arc) bits.push(`扇形 ±${tri((l) => w(l).arc)}°`);
  if (raw.guide) bits.push('雷射導引');
  if (raw.type === 'missile') bits.push('鎖定追蹤');
  bits.push(`後座力 ${recoilName(raw, slot === 'heavy' ? 'heavy' : 'light')}`);
  return `<div class="cd-row" data-slot="${slot}" title="點擊播放施展動畫">
    <span class="cd-key">${key}</span>
    <div><b>${esc(raw.name)}</b> <span class="dim">${esc(raw.rw)}</span> <span class="cd-play">▶</span>
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
  return `<div class="cd-row" data-slot="${slot}" title="點擊播放施展動畫">
    <span class="cd-key">${key}</span>
    <div><b>${esc(A.name)}</b> <span class="cd-fx">${FX_LABEL[A.fx] || A.fx}</span> <span class="cd-play">▶</span>
    <div class="cd-desc">${esc(A.desc || '')}</div>
    <div class="cd-nums">${bits.join(' ・ ')}</div></div></div>`;
}

/** 機體設計原型:「現實原型」(工程出處)/「機體原型」(人形機甲裝甲哲學)/
 * 「體態原型」(變形機甲地面體態)/「仿生原型」(獸型機體取自哪種生物)各自一行,
 * 四種標籤格式一致(後三者皆為「名稱 —— 描述」),不併入單一「設計原型」桶。 */
const PROTO_LABEL = { 現實: '設計原型', 機體: '機體原型', 體態: '體態原型', 仿生: '仿生原型' };
function protoHTML(proto) {
  if (!proto) return '';
  return proto.split(/(?=現實原型:|機體原型:|體態原型:|仿生原型:)/).map((p) => {
    const m = p.match(/^(現實|機體|體態|仿生)原型:/);
    const label = m ? PROTO_LABEL[m[1]] : '設計原型';
    return `<div class="cd-proto"><span>${label}</span>${esc(p.replace(/^(現實|機體|體態|仿生)原型:/, ''))}</div>`;
  }).join('');
}

/** 敘事文字區塊。簡歷(頭銜/機體關係/外貌/台詞)側欄與跳出視窗共用;
 * 完整檔案(生平/興趣/專長/與機體的機緣)為 full=true 時才展開 —— 只在立繪跳出視窗(showCharBioModal)出現,不進側欄簡介區塊。 */
function charBioTextHTML(id, full = false) {
  const c = CHARACTERS[id];
  const lo = LORE[id] || {};
  return `<div class="cd-name">「${esc(c.code)}」${esc(c.name)}</div>
    <div class="cd-machine">${esc(c.machine)}</div>
    ${protoHTML(lo.proto)}
    <div class="cd-meta">${[lo.nat, lo.age && `${lo.age} 歲`, lo.sex, lo.role].filter(Boolean).map(esc).join(' ・ ')}</div>
    ${lo.quote ? `<div class="cd-quote">「${esc(lo.quote)}」</div>` : ''}
    ${lo.look ? `<p class="cd-bio">${esc(lo.look)}</p>` : ''}
    ${full ? `
    ${lo.bio ? `<p class="cd-bio"><b class="cd-bio-tag">生平</b>${esc(lo.bio)}</p>` : ''}
    ${lo.hobby ? `<p class="cd-bio"><b class="cd-bio-tag">興趣</b>${esc(lo.hobby)}</p>` : ''}
    ${lo.expertise ? `<p class="cd-bio"><b class="cd-bio-tag">專長</b>${esc(lo.expertise)}</p>` : ''}
    ${lo.bond ? `<p class="cd-bio"><b class="cd-bio-tag">與機體的機緣</b>${esc(lo.bond)}</p>` : ''}` : ''}`;
}

function charDetailHTML(id) {
  const c = CHARACTERS[id];
  const kind = charKind(id);
  const isDrone = kind === 'drone';
  const stats = heroStatCells(id);
  const kindLabel = kindLabelOf(kind);
  // 展示台 #charStage 由 showCharDetail 直接插進 #charDetail 頂端(大)或 #stageBottom(小,頭像下方)。
  // 大圖必須是 #charDetail 的直接子代,sticky 才能在整個捲動容器內固定(套 wrapper 會被限制在 wrapper 內)。
  return `<div class="cd-lower">
    <div class="cd-art">
      <div class="cd-portrait">
        <img src="${portraitURL(id)}" alt="${esc(c.name)}">
        <div class="cd-tag ${c.side === 'MERC' ? 'merc' : c.side.toLowerCase()}">
          ${c.side === 'MERC' ? '⚔ 傭兵' : SIDES[c.side].name}・${kindLabel}</div>
      </div>
      <div class="cd-arthint">點立繪 ▸ 生平・興趣・專長・與機體的機緣</div>
      <div id="stageBottom"></div>
    </div>
    <div class="cd-body">
      ${charBioTextHTML(id)}
      <div class="cd-stats">${stats}
        ${isDrone ? `<div class="cd-note">※ 蜂群為單架無人機:生存值為機甲平均的 80%、傷害同機甲、射程略高;兩架常駐護衛自殺機隨行,狙擊模式長按右鍵令其衝出(各半傷、自爆後 30s 重現)。</div>` : ''}
        ${kind === 'morph' ? '<div class="cd-note">※ 變形機甲:HP 與火力與機甲相同。飛行型態觸地 → 變形為地面型;地面型按住 Space 蓄力跳 → 彈射變形為飛行型。</div>' : ''}
      </div>
      <div class="cd-kit">
        ${charWeaponRow(id, 'light', '左鍵')}
        ${charWeaponRow(id, 'heavy', '右鍵')}
        ${charAbilityRow(id, 'skill', 'Q')}
        ${charAbilityRow(id, 'ult', 'E')}
      </div>
      <div class="cd-foot">數值為 Lv1 → Lv2 → Lv3 → Lv4(戰場金錢升級,開場 Lv1);已含英雄倍率(射程 ×1.2、威力 ×1.5)。</div>
    </div>
    </div>`;
}

/** 點角色說明面板的頭像(立繪縮圖)跳出大圖 + 完整簡歷(唯讀預覽,見 showCharDetail 掛載處)*/
function showCharBioModal(id, side) {
  const c = CHARACTERS[id];
  if (!c) return;
  const kind = charKind(id);
  const kindLabel = kind === 'drone' ? '無人機' : kind === 'morph' ? '變形機甲' : '機甲';
  const s = side || c.side;
  $('charBioModalBody').innerHTML = `
    <div class="bio-portrait">
      <img src="${portraitURL(id)}" alt="${esc(c.name)}">
      <div class="cd-tag ${s === 'MERC' ? 'merc' : s.toLowerCase()}">
        ${s === 'MERC' ? '⚔ 傭兵' : SIDES[s].name}・${kindLabel}</div>
    </div>
    <div class="bio-text">${charBioTextHTML(id, true)}</div>`;
  $('charBioModal').hidden = false;
}
function hideCharBioModal() { $('charBioModal').hidden = true; }
$('charBioModalClose').onclick = hideCharBioModal;
$('charBioModal').addEventListener('click', (e) => { if (e.target.id === 'charBioModal') hideCharBioModal(); });
document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !$('charBioModal').hidden) hideCharBioModal(); });

// 機體展示台:角色卡與 NPC 卡「各一台」持久 CharPreview(各自 WebGLRenderer)→ 兩台同框並存,
// 選角色不清 NPC、反之亦然。放大 = 頁內 modal,把該卡的 shell 搬進 modal 大圖(可在 modal 內切換對象)。

// ---- 屬性數值格(角色 / 單位共用);max = 該欄滿格基準 ----
function statCell(label, v, max) {
  return `<div class="cd-stat"><span>${esc(label)}</span>
      <i><b style="width:${Math.min(100, v / max * 100).toFixed(0)}%"></b></i>
      <em>${v}</em></div>`;
}
function heroStatCells(id) {
  const kind = charKind(id); const u = UNITS[kind]; const m = CHARACTERS[id].mods;
  return [
    ['裝甲 HP', Math.round(u.hp * (m.hp ?? 1)), 'hp'],
    ['護盾', Math.round(u.shield * (m.sp ?? 1)), 'sp'],
    ['電力', Math.round(u.mp * (m.mp ?? 1)), 'mp'],
    ['機動', Math.round(u.speed * (m.speed ?? 1)), 'speed'],
    ['護甲值', m.armor ?? 0, 'armor'],
  ].map(([label, v, k]) => statCell(label, v, BAR_MAX[k])).join('');
}
const UNIT_BAR_MAX = { hp: 3000, armor: 30, dmg: 130, range: 320, rate: 5, speed: 22, sight: 310 };
function unitStatCells(kind) {
  const u = UNITS[kind];
  // 戰鬥列一律「有值才顯示」:平民只有 hp/armor/speed(無 dmg/range/rate/sight),不會踩 undefined.toFixed
  const rows = [['血量', u.hp, 'hp'], ['護甲值', u.armor ?? 0, 'armor']];
  if (u.dmg != null) rows.push(['火力', u.dmg, 'dmg']);
  if (u.range != null) rows.push(['射程', Math.round(u.range), 'range']);
  if (u.rate != null) rows.push(['射速', +u.rate.toFixed(1), 'rate']);
  if (u.sight != null) rows.push(['視野', u.sight, 'sight']);
  if (u.speed) rows.push(['機動', u.speed, 'speed']);
  return rows.map(([label, v, k]) => statCell(label, v, UNIT_BAR_MAX[k])).join('');
}
const kindLabelOf = (kind) => kind === 'drone' ? '無人機' : kind === 'morph' ? '變形機甲' : '機甲';
const sideName = (side) => sideInfo(side).name;   // SWARM/STEEL/第三方(GUER/MILI)統一查表
const unitClassLabel = (kind) => CLASS_NAME[TARGET_CLASS[kind]] || '';

// ---- NPC / 建築武器(整形成 heroWeapon 形狀供展示台 playUnitWeapon)----
const WTYPE_NAME = { gun: '動能', launcher: '榴彈', missile: '飛彈', rail: '軌道', beam: '能束', plasma: '電漿' };
function unitWeaponList(kind) {
  const u = UNITS[kind];
  const gun = (label, name, o) => ({ label, name, type: 'gun', dmg: o.dmg, rate: o.rate, range: o.range, mag: o.mag, r: 0 });
  const launcher = (label, name, o) => ({ label, name, type: 'launcher', dmg: o.dmg, rate: o.rate, range: o.range, mag: o.mag, r: o.r || 15 });
  switch (kind) {
    case 'soldier': case 'heli': { const w = WEAPONS[u.wid]; return [gun('主武', w.name, w)]; }
    case 'rocketeer': { const w = WEAPONS.rocket; return [launcher('主武', w.name, w)]; }
    case 'howitzer': { const w = WEAPONS.siege; return [launcher('主武', '手持榴彈槍', w)]; }   // 步兵化:顯示名改手持,數值同 siege 表
    case 'tank': { const w = WEAPONS.siege; return [launcher('主砲', '滑膛戰車砲', w)]; }
    case 'tower':
      return [gun('主砲', '防禦砲塔', { dmg: u.dmg, rate: u.rate, range: u.range })];
    case 'base': {
      const g = u.guns;
      return [gun('主砲', '主堡火砲', { dmg: u.dmg, rate: u.rate, range: u.range }),
        gun('雙聯', '主堡雙聯裝砲', { dmg: g.dmg, rate: g.rate, range: g.range })];
    }
    default: return [];
  }
}
function unitWeaponRow(w, i) {
  const bits = [`傷害 ${w.dmg}`, `射程 ${Math.round(w.range)}m`, `射速 ${(+w.rate).toFixed(1)}/s`];
  if (w.mag) bits.push(`彈匣 ${w.mag}`);
  if (w.r) bits.push(`爆風 ${w.r}m`);
  return `<div class="cd-row" data-uwid="${i}" title="點擊播放攻擊演出">
    <span class="cd-key">${esc(w.label)}</span>
    <div><b>${esc(w.name)}</b> <span class="cd-fx">${WTYPE_NAME[w.type] || w.type}</span> <span class="cd-play">▶</span>
    <div class="cd-nums">${bits.join(' ・ ')}</div></div></div>`;
}
/** 碉堡專用說明列(無武裝工事,武器列以駐防機制代替;數值一律讀 THIRD,不手抄) */
const bunkerNoteRow = () => `<div class="cd-row">
  <span class="cd-key">駐防</span>
  <div><b>無武裝工事</b>
  <div class="cd-nums">駐守 ${THIRD.GAR_CAP} 名步槍兵:免傷 ・ 回血 ${Math.round(THIRD.GAR_REGEN_PS * 100)}%/s ・ 射程 ×${THIRD.GAR_RANGE_F} ・ 被拆 ${THIRD.BUNKER_RESPAWN_S / 60} 分鐘原地重生</div></div></div>`;

/** 平民專用說明列(非戰鬥人員;平民/間諜同外觀,只能分辨陣營) */
const civNoteRow = () => `<div class="cd-row">
  <span class="cd-key">身分</span>
  <div><b>非戰鬥人員</b>
  <div class="cd-nums">平民與間諜外觀完全相同(只能分辨陣營)・移速 平民 ×${CIVILIAN.CIV_SPEED_F} / 間諜 ×${CIVILIAN.SPY_SPEED_F} 步槍兵 —— 細看走位可辨 ・ 誤殺平民一律負賞金,揪出敵方間諜 +${CIVILIAN.KILL_F.enemySpy} 步槍兵賞金</div></div></div>`;
const CIV_REWARD_ICON = { medkit: '🩹', battery: '🔋', money: '💰' };
/** 職業選擇格(男女 20 種,點選切換展示台外觀;圖示 = 我方跟隨時提供的物資) */
const civProfGrid = () => `<div class="civ-prof-grid">${CIVILIANS.map((c, i) =>
  `<button class="civ-prof-btn ${i === (app.civProf || 0) ? 'on' : ''}" data-civprof="${i}">${c.g === 'F' ? '♀' : '♂'} ${esc(c.name)} ${CIV_REWARD_ICON[c.reward]}</button>`).join('')}</div>`;
/** 平民陣營子切換(鋼鐵/蜂群;外觀只換貼地光環色) */
const civFactionToggle = (side) => `<div class="civ-fac-toggle">${['STEEL', 'SWARM'].map((s) =>
  `<button class="unit-side-btn ${s === side ? 'on' : ''}" data-civfac="${s}">${esc(sideInfo(s).name)}</button>`).join('')}</div>`;

/** 建一台展示台(角色 'char' / NPC 'unit' 各一,持久重用):自帶 canvas + shell + CharPreview 實例。
 *  按鈕以 class 定位 + 閉包綁定(兩台 shell 並存,不可用共用 id)。 */
function buildStage(role) {
  const canvas = document.createElement('canvas');
  canvas.className = 'cd-canvas';
  const preview = new CharPreview(canvas);
  const shell = document.createElement('div');
  shell.className = 'cd-stage small';
  shell.innerHTML = `
    <button class="cd-morph-btn" hidden>✈ 切換飛行型態</button>
    <div class="cd-stage-tr">
      <button class="cd-size-btn">⤢ 放大</button>
    </div>
    <div class="cd-run">
      <button class="cd-run-btn" data-run="idle">⏸ 靜止</button>
    </div>
    <div class="cd-stage-hint">拖曳旋轉 ・ 滾輪縮放 ・ 點按循環跑速(雙擊反向)・ 點武器/招式看演出</div>`;
  shell.appendChild(canvas);
  const q = (s) => shell.querySelector(s);
  const st = { role, preview, shell, canvas, home: null, subject: null, weapons: null };
  const RUN_LABEL = { idle: '⏸ 靜止', slow: '🐢 慢速', normal: '▶ 正常' };
  const syncRun = () => {
    const b = q('.cd-run-btn'); if (!b) return;
    b.textContent = RUN_LABEL[preview.runMode] || RUN_LABEL.idle;   // 單鍵循環:標籤即目前態
    b.dataset.run = preview.runMode;
    b.classList.toggle('on', preview.runMode !== 'idle');           // 非靜止 = 高亮(沿用 .cd-run-btn.on)
  };
  st.syncRun = syncRun;   // 供 mountStageInline 重掛時共用同一份標籤邏輯(單一縫)
  // 點一下正向循環;點兩下反向循環(用點擊計時分辨,避免雙擊被算成兩次正向 → 乾淨的單步反向)
  let runClickT = null;
  q('.cd-run-btn').onclick = () => {
    if (runClickT) { clearTimeout(runClickT); runClickT = null; preview.cycleRun(-1); }
    else runClickT = setTimeout(() => { runClickT = null; preview.cycleRun(1); }, 250);
  };
  q('.cd-size-btn').onclick = () => toggleStageModal(role);
  q('.cd-morph-btn').onclick = (e) => { e.currentTarget.textContent = preview.toggleMorph() ? '⬇ 切換地面型態' : '✈ 切換飛行型態'; };
  preview.onMove = () => syncRun();   // cycleRun / 雙擊 / W / setChar 重置 → 單鍵標籤跟著切
  app.stages[role] = st;
  return st;
}
function getStage(role) { return app.stages[role] || buildStage(role); }
function stopStages() { for (const r of ['char', 'unit']) app.stages[r]?.preview.stop(); }

/** 配置某台展示台的按鈕(變形鈕/移動徽章/慢速)並掛到內嵌 home;若正被 modal 放大則不搬(留在 modal) */
function mountStageInline(role, subject, homeEl) {
  const st = getStage(role);
  st.subject = subject;
  st.home = homeEl;
  const shell = st.shell;
  const isMorph = subject.type === 'char' && charKind(subject.id) === 'morph';
  const mb = shell.querySelector('.cd-morph-btn'); mb.hidden = !isMorph; mb.textContent = '✈ 切換飛行型態';
  const run = shell.querySelector('.cd-run');
  run.style.display = subject.type === 'unit' ? 'none' : '';   // NPC/建築不做移動演示
  st.syncRun?.();   // 重掛內嵌 → 依 preview.runMode(setChar 已重置 idle)刷新單鍵標籤
  if (app.modalRole !== role) homeEl.appendChild(shell);
  else fillModalPanels(role);   // 正被放大 → shell 留在 modal,改更新 modal 面板
  st.preview._resize();
}

function showCharDetail(id, side) {
  const box = $('charDetail');
  if (!id) {
    if (app.modalRole === 'char') closeStageModal();
    app.stages.char?.preview.stop();
    if (app.stages.char) app.stages.char.subject = null;
    box.innerHTML = '<div class="cd-empty">🎲 未選角色<br><span>開戰時隨機指派一名。點選頭像可看完整簡歷與數值。</span></div>';
    return;
  }
  box.innerHTML = charDetailHTML(id);
  // 角色說明的頭像(立繪縮圖)/ 提示列點擊 → 跳出大圖 + 完整檔案(生平/興趣/專長/機緣);純預覽,不影響選角
  const openBio = () => showCharBioModal(id, side);
  box.querySelector('.cd-portrait img').onclick = openBio;
  box.querySelector('.cd-arthint').onclick = openBio;
  // 傭兵隨雇主換色:展示台一律以「檢視中的陣營」建機體
  const s = side || CHARACTERS[id].side;
  const viewSide = s === 'MERC' ? 'STEEL' : s;
  const st = getStage('char');
  mountStageInline('char', { type: 'char', id, side: s }, $('stageBottom'));
  st.preview.setChar(id, viewSide);
  st.preview.start();
}

// 點武器/招式區塊 → 角色展示台播放施展動畫(委派,charDetail 每次重繪都沿用)
$('charDetail').addEventListener('click', (e) => {
  const row = e.target.closest('.cd-row');
  if (row?.dataset.slot) app.stages.char?.preview.play(row.dataset.slot);
});

// ================= 放大獨立視窗(仿遊戲操作演出;含角色/NPC 選擇,可切換放大對象) =================
function stageTitleHTML(subject) {
  if (subject.type === 'char') {
    const c = CHARACTERS[subject.id];
    return `「${esc(c.code)}」${esc(c.name)} <span class="dim">${esc(c.machine)} ・ ${kindLabelOf(charKind(subject.id))}</span>`;
  }
  const u = UNITS[subject.kind];
  return `${esc(u.name)} <span class="dim">${esc(sideName(subject.side))} ・ ${esc(unitClassLabel(subject.kind))}</span>`;
}
function stageInfoHTML(subject) {
  if (subject.type === 'char') {
    const isDrone = charKind(subject.id) === 'drone';
    return `<div class="cd-stats">${heroStatCells(subject.id)}</div>
      ${isDrone ? '<div class="cd-note">※ 蜂群為單架無人機(生存值 = 機甲平均 80%、傷害同機甲)。</div>' : ''}`;
  }
  return `<div class="cd-stats">${unitStatCells(subject.kind)}</div>`;
}
function stageKitHTML(st) {
  const subject = st.subject;
  if (subject.type === 'char') {
    const id = subject.id;
    return charWeaponRow(id, 'light', '左鍵') + charWeaponRow(id, 'heavy', '右鍵')
      + charAbilityRow(id, 'skill', 'Q') + charAbilityRow(id, 'ult', 'E');
  }
  return subject.kind === 'bunker' ? bunkerNoteRow()
    : subject.kind === 'civilian' ? civFactionToggle(subject.side) + civNoteRow() + civProfGrid()
      : (st.weapons || []).map((w, i) => unitWeaponRow(w, i)).join('');
}
/** modal 側欄面板(標題/數值/武器/操作提示)依目前放大的 role 填 */
function fillModalPanels(role) {
  const st = app.stages[role]; if (!st?.subject) return;
  $('stageModalTitle').innerHTML = stageTitleHTML(st.subject);
  $('stageModalInfo').innerHTML = stageInfoHTML(st.subject);
  $('stageModalKit').innerHTML = stageKitHTML(st);
  $('stageModalKeys').innerHTML = st.subject.type === 'char'
    ? '<b>操作演示</b>　左鍵 輕武器 ・ 右鍵 重武器 ・ Q 小招 ・ E 大招 ・ Space 跳躍/變形 ・ W 循環跑速'
    : '<b>操作演示</b>　左鍵 主武器 ・ 右鍵 副武器 ・ 點下方武器列演出攻擊';
}
function activeStage() { return app.modalRole ? app.stages[app.modalRole] : null; }
/** 把放大視窗裡的 shell 歸位到它的內嵌 home,還原放大鈕字樣 */
function restoreModalShell() {
  const st = app.modalRole && app.stages[app.modalRole];
  if (!st) return;
  const size = st.shell.querySelector('.cd-size-btn'); if (size) size.textContent = '⤢ 放大';
  if (st.home) st.home.appendChild(st.shell);
}
/** 讓 role 的 shell 成為放大視窗當前展示(切換放大對象;必要時重綁操作) */
function enlargeInModal(role) {
  const st = getStage(role);
  if (!st.subject || app.modalRole === role) return;
  const wasOpen = !!app.modalRole;
  if (wasOpen) unbindStageControls();
  restoreModalShell();
  app.modalRole = role;
  $('stageModalStage').appendChild(st.shell);
  st.shell.querySelector('.cd-size-btn').textContent = '⤡ 縮小';
  fillModalPanels(role);
  if (wasOpen) bindStageControls();
  st.preview._resize();
}
function toggleStageModal(role) { if (app.modalRole === role) closeStageModal(); else openStageModal(role); }
function openStageModal(role) {
  const st = getStage(role);
  if (!st.subject) return;
  restoreModalShell();
  app.modalRole = role;
  $('stageModalStage').appendChild(st.shell);
  st.shell.querySelector('.cd-size-btn').textContent = '⤡ 縮小';
  fillModalPanels(role);
  renderModalPicks();
  $('charStageModal').hidden = false;
  bindStageControls();
  st.preview._resize();
}
function closeStageModal() {
  if (!app.modalRole) return;
  unbindStageControls();
  restoreModalShell();
  app.modalRole = null;
  $('charStageModal').hidden = true;
  for (const r of ['char', 'unit']) app.stages[r]?.preview._resize();
}
function stagePlaySlot(slot) { const st = activeStage(); if (st?.subject.type === 'char') st.preview.play(slot); }
function stagePlayPrimary(secondary) {
  const st = activeStage(); if (!st?.subject) return;
  if (st.subject.type === 'char') st.preview.play(secondary ? 'heavy' : 'light');
  else { const list = st.weapons || []; const w = secondary && list[1] ? list[1] : list[0]; if (w) st.preview.playUnitWeapon(w); }
}
/** 仿遊戲操作:鍵盤 Q/E/Space/W + 滑鼠左右鍵(拖曳=旋轉、點擊=開火)。綁在「目前放大那台」的 canvas。 */
function bindStageControls() {
  const st = activeStage(); if (!st) return;
  const cv = st.canvas, p = st.preview;
  let down = null;
  const onKey = (e) => {
    if (!app.modalRole) return;
    if (e.code === 'Escape') { closeStageModal(); return; }
    if (e.code === 'KeyQ') stagePlaySlot('skill');
    else if (e.code === 'KeyE') stagePlaySlot('ult');
    else if (e.code === 'Space') { e.preventDefault(); p.jump(); }
    else if (e.code === 'KeyW') p.cycleRun();
  };
  const onDown = (e) => { down = { x: e.clientX, y: e.clientY, b: e.button }; };
  const onUp = (e) => {
    if (!down) return;
    if (Math.abs(e.clientX - down.x) + Math.abs(e.clientY - down.y) < 6) stagePlayPrimary(down.b === 2);
    down = null;
  };
  const onCtx = (e) => e.preventDefault();
  window.addEventListener('keydown', onKey);
  cv.addEventListener('mousedown', onDown);
  cv.addEventListener('mouseup', onUp);
  cv.addEventListener('contextmenu', onCtx);
  app._stageBind = { onKey, onDown, onUp, onCtx, cv };
}
function unbindStageControls() {
  const b = app._stageBind; if (!b) return;
  window.removeEventListener('keydown', b.onKey);
  b.cv.removeEventListener('mousedown', b.onDown);
  b.cv.removeEventListener('mouseup', b.onUp);
  b.cv.removeEventListener('contextmenu', b.onCtx);
  app._stageBind = null;
}
/** 選角(角色格 onclick 與放大視窗角色格共用):唯讀對象不可選;送 pickChar/setBotChar 後即時換展示 */
function selectChar(id) {
  if (!app.pickEditable) return;
  app.net.send(app.pickIsSelf ? { t: 'pickChar', ch: id } : { t: 'setBotChar', id: app.pickSubject.id, ch: id });
  showCharDetail(id, app.pickSide);
}
/** 放大視窗內的角色 + NPC 選擇格(req:放大頁面也出現選擇)。角色格僅在可選角(自己/房主代選)時出現。 */
function renderModalPicks() {
  const cg = $('modalCharGrid');
  if (app.pickEditable && app.pickSide) {
    cg.innerHTML = '';
    for (const id of charsOf(app.pickSide)) {
      const c = CHARACTERS[id];
      const b = document.createElement('button');
      b.className = 'char-btn' + (app.stages.char?.subject?.id === id ? ' on' : '') + (c.side === 'MERC' ? ' merc' : '');
      b.innerHTML = `<img class="char-av" src="${avatarURL(id)}" alt="" draggable="false"><b>${c.side === 'MERC' ? '⚔ ' : ''}${esc(c.code)}</b>`;
      b.onclick = () => { selectChar(id); enlargeInModal('char'); renderModalPicks(); };
      cg.appendChild(b);
    }
    cg.parentElement.style.display = '';
  } else { cg.parentElement.style.display = 'none'; }

  const side = app.unitSide || app.pickSide || 'STEEL';
  $('modalUnitToggle').innerHTML = sideToggleHTML(side, 'muside');
  const ug = $('modalUnitGrid');
  ug.innerHTML = '';
  for (const kind of unitRosterOf(side)) {
    const b = document.createElement('button');
    b.className = 'unit-btn' + (app.stages.unit?.subject?.kind === kind && app.stages.unit?.subject?.side === side ? ' on' : '');
    b.innerHTML = `<b>${esc(UNITS[kind].name)}</b><span class="unit-cls">${esc(unitClassLabel(kind))}</span>`;
    b.onclick = () => { app.unitKind = kind; app.unitShown = null; renderUnitGrid(side); showUnitDetail(kind, side); enlargeInModal('unit'); renderModalPicks(); };
    ug.appendChild(b);
  }
}
$('charStageModalClose').onclick = closeStageModal;
$('charStageModal').addEventListener('click', (e) => { if (e.target.id === 'charStageModal') closeStageModal(); });
$('stageModalKit').addEventListener('click', (e) => {
  // 平民放大視窗:職業格 / 陣營子切換(重載 → mountStageInline 偵測放大中會回填 modal 面板)
  const cp = e.target.closest('[data-civprof]');
  if (cp) { app.civProf = +cp.dataset.civprof; showUnitDetail('civilian', 'CIV'); return; }
  const cf = e.target.closest('[data-civfac]');
  if (cf) { app.civFaction = cf.dataset.civfac; showUnitDetail('civilian', 'CIV'); return; }
  const row = e.target.closest('.cd-row'); if (!row) return;
  const st = activeStage(); if (!st) return;
  if (row.dataset.slot) st.preview.play(row.dataset.slot);
  else if (row.dataset.uwid != null) { const w = (st.weapons || [])[+row.dataset.uwid]; if (w) st.preview.playUnitWeapon(w); }
});
$('modalUnitToggle').addEventListener('click', (e) => {
  const b = e.target.closest('[data-muside]'); if (!b) return;
  app.unitSide = b.dataset.muside; app.unitShown = null;
  renderUnitGrid(app.unitSide);
  if (app.unitKind) showUnitDetail(app.unitKind, app.unitSide);
  renderModalPicks();
});

// ================= NPC / 攻擊建築圖鑑(選角牆下方獨立區塊;雙陣營 + 第三方,與角色卡同框並存) =================
const UNIT_ROSTER = ['soldier', 'rocketeer', 'howitzer', 'tank', 'heli', 'tower', 'base'];   // tank 2026-07-17 入列(波次追加坦克)
const UNIT_SIDES = ['STEEL', 'SWARM', 'GUER', 'MILI'];   // 圖鑑可切陣營(2026-07-17 起含第三方)
// 切換列另加「平民」獨立按鈕(2026-07-18;偽陣營 'CIV',非真實 side)——雙方平民從這裡切換職業/陣營
const UNIT_TOGGLE = [...UNIT_SIDES, 'CIV'];
const toggleLabel = (sd) => sd === 'CIV' ? '平民' : sideInfo(sd).name;
// 第三方單位牆 = 編制唯一真相 THIRD.COMP(去重)+ 碉堡;雙陣營維持現役清單;平民只有一格(職業在詳情選)
const unitRosterOf = (side) => side === 'CIV' ? ['civilian']
  : isThirdSide(side) ? [...new Set(THIRD.COMP[side]), 'bunker'] : UNIT_ROSTER;
const sideToggleHTML = (side, attr) => UNIT_TOGGLE.map((sd) =>
  `<button class="unit-side-btn ${sd === side ? 'on' : ''}" data-${attr}="${sd}">${esc(toggleLabel(sd))}</button>`).join('');
const UNIT_PROMPT = '<div class="unit-empty">點左側單位查看數值與武器 ・ 點武器列播放攻擊演出(對虛擬目標)。</div>';
function unitDetailHTML(kind, side) {
  const u = UNITS[kind];
  const list = unitWeaponList(kind);
  return `<div class="cd-lower">
    <div class="cd-art"><div id="unitStageBottom" class="unit-stage-mount"></div></div>
    <div class="cd-body">
      <div class="unit-name">${esc(u.name)} <span class="dim">${esc(sideName(side))} ・ ${esc(unitClassLabel(kind))}</span></div>
      <div class="cd-stats">${unitStatCells(kind)}</div>
      <div class="cd-kit">${kind === 'bunker' ? bunkerNoteRow()
        : kind === 'civilian' ? civFactionToggle(side) + civNoteRow() + civProfGrid()
          : list.map((w, i) => unitWeaponRow(w, i)).join('')}</div>
      <div class="cd-foot">點武器列播放攻擊演出;拖曳旋轉、滾輪縮放,「放大」開獨立視窗。</div>
    </div>
  </div>`;
}
function showUnitDetail(kind, side) {
  const civ = kind === 'civilian';
  const mside = civ ? (app.civFaction || 'STEEL') : side;   // 平民實際陣營走 civFaction('CIV' 偽陣營無模型)
  const prof = app.civProf || 0;
  $('unitDetail').innerHTML = unitDetailHTML(kind, mside);
  const st = getStage('unit');
  st.weapons = unitWeaponList(kind);
  mountStageInline('unit', { type: 'unit', kind, side: mside, prof }, $('unitStageBottom'));
  st.preview.setUnit(kind, mside, prof);
  st.preview.start();
  app.unitShown = civ ? `civilian:${mside}:${prof}` : kind + ':' + side;
  // 平民圖鑑:職業格 + 陣營子切換(點選重載本卡;不揭露間諜)
  if (civ) {
    for (const b of $('unitDetail').querySelectorAll('[data-civprof]'))
      b.onclick = () => { app.civProf = +b.dataset.civprof; showUnitDetail('civilian', side); };
    for (const b of $('unitDetail').querySelectorAll('[data-civfac]'))
      b.onclick = () => { app.civFaction = b.dataset.civfac; showUnitDetail('civilian', side); };
  }
}
/** 圖鑑陣營切換 + 單位牆(highlight);不重建 detail(避免每次房間同步重載模型) */
function renderUnitGrid(side) {
  app.unitSide = side;
  const roster = unitRosterOf(side);
  // 平民列只有一格 → 自動選取(切進來即顯示);切到沒有此兵種的陣營 → 落到第一個單位
  if (side === 'CIV') { if (app.unitKind !== 'civilian') { app.unitKind = 'civilian'; app.unitShown = null; } }
  else if (app.unitKind && !roster.includes(app.unitKind)) { app.unitKind = roster[0]; app.unitShown = null; }
  $('unitSideToggle').innerHTML = sideToggleHTML(side, 'uside');
  const grid = $('unitGrid');
  grid.innerHTML = '';
  for (const kind of roster) {
    const b = document.createElement('button');
    b.className = 'unit-btn' + (app.unitKind === kind ? ' on' : '');
    b.innerHTML = `<b>${esc(UNITS[kind].name)}</b><span class="unit-cls">${esc(unitClassLabel(kind))}</span>`;
    b.onclick = () => { app.unitKind = kind; app.unitShown = null; renderUnitGrid(side); showUnitDetail(kind, side); };
    grid.appendChild(b);
  }
}
/** 選角重繪時呼叫:NPC 選取保留(不清),已選單位持續顯示(未變則不重載) */
function renderUnitSection(defaultSide) {
  renderUnitGrid(app.unitSide || defaultSide);
  if (app.unitKind) {
    const key = app.unitKind === 'civilian'
      ? `civilian:${app.civFaction || 'STEEL'}:${app.civProf || 0}`
      : app.unitKind + ':' + app.unitSide;
    if (app.unitShown !== key) showUnitDetail(app.unitKind, app.unitSide);
  } else {
    $('unitDetail').innerHTML = UNIT_PROMPT;
  }
}
$('unitSideToggle').addEventListener('click', (e) => {
  const b = e.target.closest('[data-uside]'); if (!b) return;
  app.unitShown = null;
  renderUnitGrid(b.dataset.uside);
  if (app.unitKind) showUnitDetail(app.unitKind, b.dataset.uside);   // 切陣營保留當前單位、換外觀
});
$('unitDetail').addEventListener('click', (e) => {
  const row = e.target.closest('.cd-row'); if (!row || row.dataset.uwid == null) return;
  const st = app.stages.unit;
  const w = (st?.weapons || [])[+row.dataset.uwid];
  if (w) st.preview.playUnitWeapon(w);
});

/**
 * 選角:預設替自己選;房主點 bot 槽位的「選角」後 app.charTarget = bot id,
 * 同一套 UI 改送 setBotChar(伺服器同樣驗證陣營)。
 */
function renderCharPick(me) {
  const sec = $('charSection');
  // 檢視/選角對象:高亮的槽位(自己/電腦/他人);沒有就退回自己
  const subject = app.lobby.clients.find((c) => c.id === app.charTarget) || me;
  if (app.lobby.phase !== 'room' || !me || me.mode !== 'player' || !me.side || !subject) {
    sec.style.display = 'none';
    stopStages();
    return;
  }
  sec.style.display = '';

  const isSelf = subject.id === app.youId;
  const editable = isSelf || (subject.isBot && app.isHost);   // 自己 / 房主代電腦選;他人唯讀
  // 選角上下文(供角色格 onclick 與放大視窗的角色格共用)
  app.pickSubject = subject; app.pickSide = subject.side; app.pickEditable = editable; app.pickIsSelf = isSelf;
  const whoLabel = isSelf ? '你' : `${subject.isBot ? '▣ ' : ''}${esc(subject.name)}`;

  $('charSectionHead').innerHTML = editable
    ? (isSelf ? '▍選擇你的角色(不選 = 隨機)' : `▍替 ${whoLabel} 選擇角色(不選 = 隨機)`)
    : `▍檢視 ${whoLabel} 的角色(唯讀 —— 點自己的區塊可選角)`;

  const grid = $('charGrid');
  grid.style.display = editable ? '' : 'none';
  grid.innerHTML = '';
  if (editable) {
    for (const id of charsOf(subject.side)) {
      const c = CHARACTERS[id];
      const merc = c.side === 'MERC';   // 傭兵:雙陣營皆可受雇,機體/武器不隨陣營改變
      const b = document.createElement('button');
      b.className = 'char-btn' + (subject.ch === id ? ' on' : '') + (merc ? ' merc' : '');
      b.innerHTML = `<img class="char-av" src="${avatarURL(id)}" alt="" draggable="false">
        <b>${merc ? '⚔ ' : ''}${esc(c.code)}</b><span class="char-name">${esc(c.name)}</span>`;
      b.onclick = () => selectChar(id);   // 伺服器 sync 前先換,點擊即時有反應
      grid.appendChild(b);
    }
    // 隨機殿後(預設選項但排在列表最後,不搶頭像牆第一格的視覺焦點)
    const rnd = document.createElement('button');
    rnd.className = 'char-btn rnd' + (subject.ch ? '' : ' on');
    rnd.innerHTML = '<span class="char-dice">🎲</span><span class="char-name">隨機</span>';
    rnd.onclick = () => selectChar(null);   // 只有點擊會換展示角色(懸浮不換)
    grid.appendChild(rnd);
  }
  showCharDetail(subject.ch || null, subject.side);

  const cur = subject.ch && CHARACTERS[subject.ch];
  $('charInfo').innerHTML = cur
    ? `${whoLabel}已選定 <b>「${esc(cur.code)}」${esc(cur.name)}</b> ・ ${esc(cur.machine)}`
    : editable
      ? `${whoLabel}未選角色:開戰時將隨機指派一名(點頭像選角並展示,點武器/招式看演出)。`
      : `${whoLabel}尚未選定角色(開戰隨機)。`;

  // NPC / 攻擊建築圖鑑(獨立於角色選擇,選取不互清;預設檢視自己陣營,可切換雙陣營)
  renderUnitSection(subject.side);
  if (app.modalRole) { fillModalPanels(app.modalRole); renderModalPicks(); }   // 放大視窗開啟中 → 同步刷新
}

// ================= 載入 + 開戰 =================
async function enterLoading(cfg) {
  app.battleCfg = cfg;
  if (app.battle) { app.battle.dispose(); app.battle = null; }
  
  // Select a dynamic background based on room participants
  try {
    const clients = app.lobby?.clients || [];
    const bots = app.lobby?.bots || [];
    const allParticipants = [...clients, ...bots].filter(p => p.ch);
    const sides = new Set(allParticipants.map(p => CHARACTERS[p.ch]?.side).filter(Boolean));
    
    let pool = 'steel_vs_swarm';
    if (sides.has('MERC')) {
      const mySide = clients.find((c) => c.id === app.youId)?.side || 'SWARM';
      if (mySide === 'SWARM') {
        pool = Math.random() < 0.5 ? 'swarm_vs_mercenary' : 'steel_vs_swarm';
      } else {
        pool = Math.random() < 0.5 ? 'steel_vs_mercenary' : 'steel_vs_swarm';
      }
    } else {
      const r = Math.random();
      if (r < 0.5) pool = 'steel_vs_swarm';
      else if (r < 0.75) pool = 'steel_vs_mercenary';
      else pool = 'swarm_vs_mercenary';
    }
    const idx = Math.floor(Math.random() * 6) + 1;
    $('loading').style.backgroundImage = `url('assets/loading/${pool}_${idx}.png')`;
  } catch (err) {
    console.error('Failed to set loading background:', err);
    $('loading').style.backgroundImage = '';
  }

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
    app.terrain.clearBuildingsAround = biomes.userData.clearAround || null;   // 碉堡淨空:移除重疊建物(game.js 碉堡進場時呼叫)
    // 高架橋橋面 = 可站立平台。surfaceAt(x, z, curY):curY 高於橋面一個台階內才算「站在橋上」,
    // 否則(從橋下經過)照舊踩地形 —— 同一條規則同時服務玩家物理與 NPC/敵機的貼地渲染。
    const deckY = makeDeckIndex(biomes.userData.decks);
    const tunnelAt = makeTunnelIndex(biomes.userData.tunnels);   // (x,z) → { floor, ceil } | null
    const decks = biomes.userData.decks || [];
    app.terrain.deckY = deckY;
    app.terrain.tunnelAt = tunnelAt;
    app.terrain.deckUnder = DECK_UNDER;   // 橋面板厚(game.js _slabHitT 判彈道穿板用)
    // 站立表面:①在地下道天花之下(curY < ceil)= 站隧道路面 ②橋面(curY 貼近橋面)= 站橋上 ③否則地表
    app.terrain.surfaceAt = (x, z, curY) => {
      const h = app.terrain.heightAt(x, z);
      if (curY == null) return h;
      const tn = tunnelAt(x, z);
      if (tn && curY < tn.ceil) return tn.floor;   // 在天花之下 = 洞內,站路面(而非上方山體)
      const d = deckY(x, z, DECK_MARGIN);           // 站立查詢帶側向容差(貼緣不掉下)
      if (d == null || d <= h) return h;
      // 上橋:①已貼近橋面(DECK_STEP 內)②或橋面底緣貼地(引道段,機體鑽不過去 → 只能上去,免卡在橋腹下)
      return (curY >= d - DECK_STEP || (d - DECK_UNDER) - h < MAX_MECH_H) ? d : h;
    };
    // 天花碰撞面:回傳「玩家頭頂上方最近的不可穿越面」——地下道天花 或 橋面底緣(在其下方時)。無則回 null。
    app.terrain.ceilingAt = (x, z, curY) => {
      let c = null;
      const tn = tunnelAt(x, z);
      if (tn && curY < tn.ceil) c = tn.ceil;                       // 洞內天花板
      const d = deckY(x, z);
      if (d != null && curY < d - DECK_STEP) {                     // 橋下:橋面底緣(deck 厚 ~DECK_UNDER)
        const under = d - DECK_UNDER;
        // 只有「真能鑽過去的高架段」(底緣淨空 ≥ 最大機體)才擋頭;引道低架段不擋 → 交給 surfaceAt 上橋,免卡死
        if (under - app.terrain.heightAt(x, z) >= MAX_MECH_H && (c == null || under < c)) c = under;
      }
      return c;
    };
    const st = biomes.userData.stats;
    setP(0.97, `等待其他指揮官…(植被 ${st.veg}・建物 ${st.buildings}` +
      `${st.roads ? `・道路 ${st.roads} 段` : ''}${st.rails ? `・鐵路 ${st.rails} 段` : ''}${st.falls ? `・瀑布 ${st.falls}` : ''}${st.osm ? '・OSM 圖資' : ''})`);
    // 障礙視線遮蔽 + 立體交通走廊上傳(2026-07-15;房主一份,伺服器驗證上限並於開戰時套用):
    // occ = 建物/神木/巨岩/橋墩碰撞柱 → sim 的 LOS 遮蔽(塔/NPC/命中驗證不可透視);
    // cor = 隧道/橋樑走廊 → sim 清除走廊內第三方障礙與地雷(地下道/隧道內只會有道路物件)。
    // 座標轉 sim 系(z 北 = −three z)。e2e/無瀏覽器對局不會上傳 → LOS 遮蔽自動停用(行為不變)。
    if (app.isHost) {
      const rd = (v) => Math.round(v * 10) / 10;
      const occ = (biomes.userData.blockers || []).slice(0, LOS.MAX_OCC)
        .map((b) => [rd(b.x), rd(-b.z), rd(Math.min(60, b.r)), rd(Math.min(300, b.h))]);
      const cor = (biomes.userData.gradeCorridors || []).slice(0, 2400)
        .map((c) => [rd(c.x1), rd(-c.z1), rd(c.x2), rd(-c.z2), rd(c.hw), c.kind === 'tun' ? 1 : 0]);
      // 橋面/隧道天花水平薄板(#1):deck ribbon(ty=1)+ 隧道 ribbon(ty=2),sim 座標(z 北 = −three z)。
      // 伺服器 _slabBlocked 判「兩端同 ribbon 且分屬板體兩側」擋彈道/LOS —— 補圓柱(occ)之外的水平板缺口。
      const decks = biomes.userData.decks || [], tunnels = biomes.userData.tunnels || [];
      const slabs = [
        ...decks.map((d) => [rd(d.x1), rd(-d.z1), rd(d.x2), rd(-d.z2), rd(d.hw), 1]),
        ...tunnels.map((d) => [rd(d.x1), rd(-d.z1), rd(d.x2), rd(-d.z2), rd(d.hw), 2]),
      ].slice(0, LOS.MAX_SLAB);
      // 水沼粗網格(2026-07-19):逐格 terrainEnvCode 烘烤(0 乾 / 1 水 / 2 沼),sim 座標系(z 北 = −three z)。
      // 供伺服器中立單位(平民/第三方)佈點與移動迴避 —— 不涉任何權威傷害(領機水沼效果走客戶端 pos.wet 回報)。
      app.net.send({ t: 'world', occ, cor, wet: bakeWetGrid(app.terrain), slabs });
    }
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
  const heroKind = chData?.kind || (app.mySide && SIDES[app.mySide].hero);
  $('hudSideName').textContent = app.mySide
    ? (chData ? `「${chData.code}」${chData.name} ・ ${chData.machine}` : `${SIDES[app.mySide].name} ・ ${SIDES[app.mySide].heroName}`)
    : '觀戰模式';
  $('pauseHelp').innerHTML = app.mySide
    ? (heroKind === 'drone'
      ? 'W/S 沿視線飛 ・ A/D 橫移 ・ Space/C 升降 ・ 戰鬥中按 Space 飛行=完美迴避(向上飛+1s 無敵,CD 30s) ・ 左鍵 輕武器 ・ 右鍵切換 瞄準+重武器(準星鎖定) ・ Q 小招 ・ E 大招 ・ 狙擊模式長按右鍵 令兩架常駐護衛自殺機衝出(各半傷、3 倍速撲擊、吸走敵方導引飛彈,CD 30s、自爆後重現) ・ R 填彈 ・ B 升級 ・ 單機機動求生,善用護衛機拆塔清群!'
      : heroKind === 'morph'
      ? '地面:WASD 移動 ・ 按住 Space 蓄力 → 放開彈射變形飛行 ・ 飛行:W/S 沿視線飛、A/D 橫移、Space/C 升降、觸地變形回地面型 ・ 左鍵 輕武器 ・ 右鍵切換 瞄準+重武器 ・ Q 小招 ・ E 大招 ・ 狙擊模式長按右鍵 分離餌機(沿途投彈:依機體類型燃燒/凍結/毒霧/雷爆,有鎖定就追蹤,CD 30s) ・ R 填彈 ・ B 升級 ・ 地面小心地雷、高空小心防空!'
      : 'WASD 移動 ・ Space 跳 ・ Shift 衝刺 ・ 左鍵 輕武器 ・ 右鍵切換 瞄準+重武器 ・ Q 小招 ・ E 大招 ・ 狙擊模式長按右鍵 重砲模式(0.5s 傾洩剩餘彈夾、傷害 +33% 射程 +20%,CD 30s) ・ R 填彈 ・ B 升級 ・ 偏離兵線小心地雷!')
    : 'WASD 移動 ・ Space/C 升降 ・ Shift 加速(觀戰自由視角)';
  $('pauseHelp').innerHTML += ' ・ ESC 戰場選單/離開';
  toast('點擊畫面鎖定滑鼠開始戰鬥 ・ ESC 開選單', 4000);
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
        // 電力(MP;電池 overcharge 可 > 上限 → 條夾 100%,數字照實顯示 130 / 100)
        const mpo = w.mp > w.mm;
        $('mpBar').style.width = `${Math.max(0, Math.min(100, w.mp / w.mm * 100))}%`;
        $('mpBar').classList.toggle('overcharge', mpo);
        $('mpText').textContent = `電力 ${Math.floor(w.mp)} / ${w.mm}${mpo ? ' ⚡' : ''}`;
        // 輕武器:彈藥 / 填彈(瞄準中 HUD 高亮重武器)
        const l = w.light;
        $('wpnName').textContent = `${l.name} Lv.${l.lvl}${w.emp > 0 ? ' ⚡離線' : ''}`;
        $('wpnAmmo').textContent = l.reload > 0 ? `填彈 ${l.reload.toFixed(1)}s` : `${l.ammo} / ${l.mag}`;
        $('wpnAmmo').classList.toggle('reloading', l.reload > 0);
        $('wpnAmmo').classList.toggle('low', l.reload <= 0 && l.ammo <= l.mag * 0.25);
        // 重武器(CD 型;右鍵瞄準 + 左鍵發射)+ 無人機自爆提示 / 變形機甲型態指示
        const hv = w.heavy;
        const morphTag = w.morph
          ? (w.morph.flight ? '(✈ 飛行型態)'
            : w.morph.charge > 0 ? `(⚡ 蓄力 ${Math.round(w.morph.charge * 100)}%)` : '(🦿 地面型態)')
          : '';
        // 狙擊模式長按右鍵:無人機 = 護衛自殺機;變形機甲 = 餌機(沿途投彈);非變形機甲 = 重砲模式
        const abTag = w.kami ? (w.kami.cd > 0.05 ? `(護衛機 ${w.kami.cd.toFixed(0)}s)` : `(護衛機 ×${w.kami.n} 就緒)`)
          : w.decoy ? (w.decoy.ready ? '(餌機就緒)' : `(餌機 ${w.decoy.cd.toFixed(0)}s)`)
          : w.barrage ? (w.barrage.cd > 0.05 ? `(重砲 ${w.barrage.cd.toFixed(0)}s)` : '(重砲就緒)')
          : '';
        $('burstName').textContent = `${hv.name} Lv.${hv.lvl}${abTag}${morphTag}`;
        // 招式:Q 小招 / E 大招(鎖定 / 冷卻 / 就緒)
        const abEl = (box, nameEl, cdEl2, a) => {
          $(nameEl).textContent = a.lvl > 0 ? `${a.name} Lv.${a.lvl}` : `${a.name} 🔒`;
          $(cdEl2).textContent = a.lvl === 0 ? '' : a.cd > 0 ? `${a.cd.toFixed(0)}s` : `${a.mp}MP`;
          $(box).classList.toggle('ready', a.ready);
          $(box).classList.toggle('locked', a.lvl === 0);
        };
        abEl('abSkill', 'abSkillName', 'abSkillCd', w.skill);
        abEl('abUlt', 'abUltName', 'abUltCd', w.ult);
        // 空白鍵機動能力 CD(完美迴避 / 蓄力跳躍 / 升空變形):就緒亮綠、冷卻顯示秒數
        const mob = w.mobil;
        if (mob) {
          $('abMobilName').textContent = mob.name;
          $('abMobilCd').textContent = mob.cd > 0.05 ? `${mob.cd.toFixed(0)}s` : '就緒';
          $('abMobil').classList.toggle('ready', mob.cd <= 0.05);
        }
        // 狙擊模式:正圓可視遮罩(body.aiming → CSS 顯示 scope-vig;陣亡 aiming 已歸零 → 自動收起)
        document.body.classList.toggle('aiming', !!w.aiming);
        $('moneyText').textContent = Math.floor(w.money);
        $('knText').textContent = w.kn;
        $('shopHint').textContent = 'B 升級(金錢固定單價)';
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
      $('pauseOverlay').style.display = 'none';   // 分出勝負:收掉可能開著的戰場選單
      ov.style.display = '';
      ov.dataset.done = '1';
      const win = SIDES[winner];
      const won = app.mySide === winner;
      // 劇情戰役:勝利即通關解鎖同陣營下一章;敘事文案改用該章該陣營的 victory/defeat
      const chapter = app.story && STORY[app.story.index];
      const csc = chapter && chapterSide(chapter, app.story.side);
      if (chapter && won) markCleared(app.story.side, chapter.id);
      $('overTitle').textContent = chapter
        ? (won ? '任務達成' : '任務失敗')
        : `${win.name} 勝利!`;
      $('overTitle').style.color = won ? win.color : (chapter ? 'var(--danger)' : win.color);
      $('overSub').textContent = chapter
        ? (won ? csc.victory : csc.defeat)
        : app.mySide
          ? (won ? '🏆 敵方主堡已化為廢墟,你贏得了這場戰役!' : '💀 你的主堡被摧毀了…下次再戰。')
          : '戰役結束。';
      $('overStats').textContent =
        `◆ ${SIDES.SWARM.name}:擊殺 ${stats.SWARM.kills}/陣亡 ${stats.SWARM.deaths}/補刀 ${stats.SWARM.creepKills}   ` +
        `◆ ${SIDES.STEEL.name}:擊殺 ${stats.STEEL.kills}/陣亡 ${stats.STEEL.deaths}/補刀 ${stats.STEEL.creepKills}`;
      const back = $('backRoomBtn');
      if (chapter) {
        back.style.display = '';
        back.textContent = won && app.story.index + 1 < STORY.length ? '◀ 返回劇情(下一章已解鎖)' : '◀ 返回劇情';
        if (won) toast(app.story.index + 1 < STORY.length ? '🎖 通關!已解鎖下一個戰場' : '🏆 全戰線肅清!劇情戰役全數通關', 4200);
      } else {
        back.style.display = app.isHost ? '' : 'none';
        back.textContent = '◀ 返回戰區(再來一場)';
      }
      document.exitPointerLock?.();
    },
    // 戰場選單(暫停):game.js 於指標解鎖時推狀態
    pause: (on) => { $('pauseOverlay').style.display = on ? '' : 'none'; },
    // 被敵方準星鎖定:每幀由 game.js 推狀態(伺服器 lock 事件驅動,LOCK.WARN_S 後自動退)
    locked: (on) => $('lockWarn').classList.toggle('on', !!on),
    // 平民互動提示:info={cs 陣營, self 是否我方, follow 是否跟隨中} 或 null(離開互動範圍)
    civPrompt: (info) => {
      const el = $('civPrompt');
      if (!info) { el.classList.remove('on'); return; }
      const s = sideInfo(info.cs);
      el.innerHTML = `<span class="civ-fac" style="color:${s.color}">◈ ${esc(s.name)}平民 ${info.self ? '(我方)' : '(敵方)'}</span>`
        + `<span class="civ-hint">${info.follow ? '跟隨中 ・ <b>H</b> 驅趕' : '<b>G</b> 要求跟隨 ・ <b>H</b> 驅趕'}</span>`;
      el.classList.add('on');
    },
    hitmark: () => {
      const el = $('hitmark');
      el.classList.remove('on');
      void el.offsetWidth;
      el.classList.add('on');
    },
    // 受傷暈影:自機被擊(HP/護盾下降)時全屏邊緣紅光閃一下(重觸發動畫同 hitmark 手法)
    hurt: () => {
      const el = $('hurtVig');
      el.classList.remove('on');
      void el.offsetWidth;
      el.classList.add('on');
    },
    // 火場滯留視野霧化(2026-07-19;game.js 每幀推 0~1 濃度,離場漸清)—— 純表現,傷害由伺服器結算。
    // 越濃越嚴重:邊緣全黑(CSS 漸層)+ 中央漸模糊(backdrop blur)+ 狙擊視野縮圈(--scope-r)。
    envFog: (v) => {
      const f = Math.max(0, Math.min(1, v || 0));
      const el = $('envFog');
      el.style.opacity = String(f);
      const blur = f > 0 ? `blur(${(f * 6).toFixed(2)}px)` : '';   // 離場移除 → 不留 backdrop 合成層(效能)
      el.style.backdropFilter = blur; el.style.webkitBackdropFilter = blur;
      document.body.style.setProperty('--scope-r', `${(40 - f * 22).toFixed(1)}vmin`);   // 40vmin → 18vmin
    },
    // 陣亡殉爆過場:on=過場期間紅警邊框開關;flash=額外觸發一次全屏白閃(高潮/觸地);比照 hitmark 的 remove→reflow→add 重觸發
    deathCine: (on, flash) => {
      $('deathAlert').classList.toggle('on', !!on);
      if (flash) { const el = $('deathFlash'); el.classList.remove('on'); void el.offsetWidth; el.classList.add('on'); }
    },
  };
}

// ================= 升級工坊(B 鍵開關;八軌全金錢固定單價,隨處可買;2026-07-20 面向改制)=================
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
  // 下一階數值預覽(戰鬥面向:輕/重武器 → 傷害/彈夾/填彈;小招/大招 → CD/電力/傷害)
  const facetNext = (slot, nextTier) => {
    if (slot === 'light' || slot === 'heavy') {
      const w = heroWeapon(st.ch, slot, nextTier);
      return `下一階:傷害 ${Math.round(w.dmg)} ・ 彈夾 ${w.mag} ・ 填彈 ${(+w.reload).toFixed(1)}s`;
    }
    const a = heroAbility(st.ch, slot, nextTier);
    return `下一階:CD ${(+a.cd).toFixed(0)}s ・ ${Math.round(a.mp)}MP${a.dmg ? ` ・ 傷害 ${Math.round(a.dmg)}` : ''}`;
  };
  const c = st.ch && CHARACTERS[st.ch];
  const KEYS = { light: '左鍵', heavy: '右鍵瞄準', skill: 'Q', ult: 'E' };
  if (c) {
    head(`🎖 戰鬥強化 —「${c.code}」${c.machine}(輕/重武器・小招/大招,開場 Lv1 → 升 3 次到 Lv4)`);
    for (const [id, up] of Object.entries(ECON.UPGRADES)) {
      if (!up.abil) continue;
      const upg = st.upg[id] || 0;           // 已購步數(0~3);目前階級 = 1 + upg
      const tier = 1 + upg, full = upg >= up.max;
      const price = full ? null : upgradePrice(up, upg);
      const nm = c[up.abil]?.name || up.desc;
      row(`<b>${up.name}</b> <span class="tag dim">${nm}・${KEYS[up.abil]}</span> Lv.${tier}/4`,
        price, !full && st.money >= price, () => st.buy(id),
        full ? '已滿階(Lv4)' : facetNext(up.abil, tier + 1));
    }
  }
  head('⬆️ 防禦/系統強化(隨處可買,立即生效;充能影響護盾/電力回速)');
  for (const [id, up] of Object.entries(ECON.UPGRADES)) {
    if (up.abil) continue;
    const lvl = st.upg[id] || 0;
    const full = lvl >= up.max;
    const price = full ? null : upgradePrice(up, lvl);
    row(`<b>${up.name}</b> Lv.${lvl}/${up.max} <span class="dim">${up.desc}</span>`,
      price, !full && st.money >= price, () => st.buy(id), full ? '已滿級' : '');
  }
}
$('shopCloseBtn')?.addEventListener('click', () => app.battle?._toggleShop(false));

$('backRoomBtn')?.addEventListener('click', () => {
  if (app.story) { exitStoryBattle(); return; }   // 劇情:回章節選擇(重繪解鎖狀態)
  app.net.send({ t: 'backToRoom' });
});
$('leaveGameBtn')?.addEventListener('click', () => location.reload());

// 戰場選單(暫停):繼續 / 離開戰場
$('resumeBtn')?.addEventListener('click', () => app.battle?._setPaused(false));
$('pauseLeaveBtn')?.addEventListener('click', () => leaveBattle());

// 劇情戰役
$('storyBtn')?.addEventListener('click', () => { myName(); enterStory(); });
$('storyBackBtn')?.addEventListener('click', () => { app.story = null; show('connect'); refreshRooms(); });
$('storyBriefCloseBtn')?.addEventListener('click', () => { $('storyBrief').style.display = 'none'; });
$('storyBrief')?.addEventListener('click', (e) => { if (e.target.id === 'storyBrief') $('storyBrief').style.display = 'none'; });
// 陣營戰線切換(協約 / 同盟)
$('storySideToggle')?.addEventListener('click', (e) => {
  const b = e.target.closest('.ss-btn');
  if (!b || b.dataset.side === app.storySide) return;
  app.storySide = b.dataset.side;
  renderStorySide();
});
// 世界觀・序章
$('worldBtn')?.addEventListener('click', () => {
  $('worldBody').innerHTML = `<p>${esc(WORLD).replace(/\n\n+/g, '</p><p>')}</p>`;
  $('worldOverlay').style.display = '';
  $('worldBody').scrollTop = 0;
});
$('worldCloseBtn')?.addEventListener('click', () => { $('worldOverlay').style.display = 'none'; });
$('worldOverlay')?.addEventListener('click', (e) => { if (e.target.id === 'worldOverlay') $('worldOverlay').style.display = 'none'; });

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
    // 劇情戰役:不顯示配對房 UI,自動完成選陣營/角色/準備/開戰(只跑一次)
    if (app.story) { if (!app.story.launched) launchStoryBattle(); return; }
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

  // 還原上次的開房設定(人數 / 房名;場地在 enterOpenRoom 還原)
  const prefs = loadPrefs();
  if (prefs.teamSize >= TEAM.MIN && prefs.teamSize <= TEAM.MAX) app.teamSize = prefs.teamSize;
  $('roomNameInput').value = prefs.roomName || '';
  $('roomNameInput').addEventListener('input', (e) => savePrefs({ roomName: e.target.value.trim() }));

  app.net = new Net({
    sync: onSync,
    rooms: (m) => renderRooms(m.rooms),
    error: (m) => {
      toast(`⚠️ ${m.msg}`);
      // 開房被拒(驗證失敗)→ 解鎖建立鈕讓房主重試
      if (app.phaseShown === 'openroom') $('createRoomBtn').disabled = !app.favCfg;
      // 劇情部署被拒 → 清狀態退回章節列表
      if (app.phaseShown === 'story' && app.story) { app.story = null; $('storyDeploy').style.display = 'none'; renderStoryChapters(); }
    },
    info: (m) => toast(m.msg),
    battleConfig: (m) => enterLoading(m.config),
    // 危險區靜態資料(地雷等):可能比 BattleClient 早到,先暫存
    field: (m) => { app.fieldMsg = m; app.battle?.onField(m); },
    snap: (m) => app.battle?.onSnap(m),
    tracer: (m) => app.battle?.onTracer(m),
    heavyCharge: (m) => app.battle?.onHeavyCharge(m),
    heavyFire: (m) => app.battle?.onHeavyFire(m),
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

  // 入座/離座改由槽位內的「＋ 入座」按鈕與自己槽位的 ✕ 處理(見 renderRoom),
  // 整卡不再綁 pickSide —— 點卡片/槽位是「選取檢視角色」,不會誤觸換陣營。
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
