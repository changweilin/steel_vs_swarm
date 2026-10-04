// ============ 戰場地圖設立背景進度管理器 (懸浮小視窗) ============
// 在地圖設立/選擇時提前處理高程、OSM圖資分析、3D引擎與單位模型預載，
// 透過懸浮小視窗展示進度，非阻塞執行，使用者可自由切換操作。
import { prepareMapCreation, isMapPrepared, mapPrepKey } from './mapPreparation.js';
import { preloadModels } from './models.js';

let _battleClientPromise = null;
export function preloadBattleClient() {
  if (!_battleClientPromise) {
    _battleClientPromise = import('./game.js').then((m) => m.BattleClient).catch((err) => {
      console.warn('戰鬥引擎背景預載降級:', err);
      _battleClientPromise = null;
      return null;
    });
  }
  return _battleClientPromise;
}

const $ = (id) => (typeof document !== 'undefined' ? document.getElementById(id) : null);

let _activeSeq = 0;
let _activeKey = null;
let _autoMinTimer = null;
let _domInitialized = false;
let _userActive = 0;      // 玩家選圖觸發、進行中的預處理數;>0 時預設地圖預熱暫停
let _warmStarted = false;
// 載入頁/戰鬥中:預熱不啟動新項目也不碰面板(省效能與頻寬;回大廳後自動續跑)
const inBattle = () => typeof document !== 'undefined' && ['loading', 'game'].includes(document.body?.dataset.screen);

function initDom() {
  if (_domInitialized || typeof document === 'undefined') return;
  _domInitialized = true;

  const minBtn = $('bgMapMinBtn');
  const closeBtn = $('bgMapCloseBtn');
  const panel = $('bgMapProgress');

  if (minBtn && panel) {
    minBtn.onclick = (e) => {
      e.stopPropagation();
      panel.classList.toggle('minimized');
      minBtn.textContent = panel.classList.contains('minimized') ? '▢' : '_';
      minBtn.title = panel.classList.contains('minimized') ? '展開' : '最小化';
    };
  }

  if (closeBtn && panel) {
    closeBtn.onclick = (e) => {
      e.stopPropagation();
      panel.style.display = 'none';
    };
  }

  if (panel) {
    panel.onclick = (e) => {
      // 點擊最小化的抬頭時自動展開
      if (panel.classList.contains('minimized') && e.target !== closeBtn) {
        panel.classList.remove('minimized');
        if (minBtn) {
          minBtn.textContent = '_';
          minBtn.title = '最小化';
        }
      }
    };
  }
}

/** 檢查特定戰場設定是否已於背景分析完成 */
export function isBackgroundMapReady(cfg) {
  return isMapPrepared(cfg);
}

/** 隱藏懸浮進度視窗 (進入戰場或離開選圖流程時調用) */
export function hideBackgroundMapSetup() {
  const panel = $('bgMapProgress');
  if (panel) panel.style.display = 'none';
  if (_autoMinTimer) { clearTimeout(_autoMinTimer); _autoMinTimer = null; }
}

/**
 * 啟動戰場背景預處理
 * @param {object} cfg - 戰場設定 (battleConfig)
 * @param {string} displayName - 顯示地名或場地名稱
 */
export function triggerBackgroundMapSetup(cfg, displayName = '') {
  if (!cfg || !cfg.center) return;
  initDom();

  const key = mapPrepKey(cfg);
  const panel = $('bgMapProgress');
  const pulse = $('bgMapPulse');
  const title = $('bgMapTitle');
  const nameEl = $('bgMapName');
  const bar = $('bgMapBar');
  const statusEl = $('bgMapStatus');
  const minBtn = $('bgMapMinBtn');

  if (!panel) return;
  if (_autoMinTimer) { clearTimeout(_autoMinTimer); _autoMinTimer = null; }

  // 立即並行預熱與 cfg 無關的 3D 模型與戰鬥引擎模組
  preloadModels();
  preloadBattleClient();

  const titleText = displayName || cfg.placeName || '戰區';
  const lanesCount = cfg.lanes?.length || 1;
  const desc = `${titleText} (${lanesCount} 線)`;

  // 若該地圖已經預先建構完成，直接呈現完成就緒狀態
  if (isMapPrepared(cfg)) {
    _activeKey = key;
    panel.style.display = 'block';
    if (pulse) pulse.className = 'bg-map-progress-pulse done';
    if (title) title.textContent = '戰場就緒';
    if (nameEl) nameEl.textContent = desc;
    if (bar) {
      bar.style.width = '100%';
      bar.className = 'bg-map-bar-fill done';
    }
    if (statusEl) statusEl.textContent = '✅ 地圖與引擎已就緒，可隨時建立戰區';
    return;
  }

  const seq = ++_activeSeq;
  _activeKey = key;

  // 展開面板並重設進度條
  panel.style.display = 'block';
  if (panel.classList.contains('minimized')) {
    panel.classList.remove('minimized');
    if (minBtn) { minBtn.textContent = '_'; minBtn.title = '最小化'; }
  }
  if (pulse) pulse.className = 'bg-map-progress-pulse';
  if (title) title.textContent = '戰場背景處理';
  if (nameEl) nameEl.textContent = desc;
  if (bar) {
    bar.style.width = '12%';
    bar.className = 'bg-map-bar-fill';
  }
  if (statusEl) statusEl.textContent = '準備戰場圖資與高程…';

  let stepFrac = 0.15;
  const onProgress = async (label) => {
    if (_activeSeq !== seq) return;
    stepFrac = Math.min(0.92, stepFrac + 0.22);
    if (bar) bar.style.width = `${Math.round(stepFrac * 100)}%`;
    if (statusEl) statusEl.textContent = label || '背景分析中…';
  };

  // 背景非阻塞執行 prepareMapCreation(玩家選擇優先:預設地圖預熱會讓路,見 startPresetWarmup)
  _userActive++;
  prepareMapCreation(cfg, onProgress).finally(() => { _userActive--; }).then((pack) => {
    if (_activeSeq !== seq) return;
    if (bar) {
      bar.style.width = '100%';
      bar.className = 'bg-map-bar-fill done';
    }
    if (pulse) pulse.className = 'bg-map-progress-pulse done';
    if (title) title.textContent = '戰場就緒';
    if (statusEl) {
      statusEl.textContent = pack?.complete ? '✅ 地圖與引擎已就緒，開房將立即生效' : '⚠️ 地圖圖資降級完成，可直接建立戰區';
    }

    // 完成後 7 秒若無動作，自動收攏為角落微型指示藥丸
    _autoMinTimer = setTimeout(() => {
      if (_activeSeq === seq && panel && !panel.classList.contains('minimized')) {
        panel.classList.add('minimized');
        if (minBtn) { minBtn.textContent = '▢'; minBtn.title = '展開'; }
      }
    }, 7000);
  }).catch((err) => {
    if (_activeSeq !== seq) return;
    console.warn('背景地圖預載異常:', err);
    if (statusEl) statusEl.textContent = '⚠️ 部分圖資背景快取逾時 (開房時將自動補正)';
  });
}

/**
 * 開啟遊戲頁面時依序在背景處理所有預設地圖圖資(已有持久標記者跳過)。
 * 玩家選圖(triggerBackgroundMapSetup)優先:有玩家任務進行中時,預熱在下一張前暫停。
 * @param {{cfg:object,name:string}[]} items
 */
export async function startPresetWarmup(items) {
  if (_warmStarted || !Array.isArray(items) || typeof document === 'undefined') return;
  _warmStarted = true;
  initDom();
  const total = items.length;
  let done = items.filter((it) => isMapPrepared(it.cfg)).length;
  if (done >= total) return;

  const panel = $('bgMapProgress');
  if (!panel) return;
  const show = (text) => {
    if (_userActive > 0 || inBattle()) return;
    panel.style.display = 'block';
    const pulse = $('bgMapPulse'), title = $('bgMapTitle'), nameEl = $('bgMapName'),
      bar = $('bgMapBar'), statusEl = $('bgMapStatus');
    if (pulse) pulse.className = 'bg-map-progress-pulse' + (done >= total ? ' done' : '');
    if (title) title.textContent = done >= total ? '預設地圖就緒' : '預設地圖圖資處理';
    if (nameEl) nameEl.textContent = `${done}/${total}`;
    if (bar) {
      bar.style.width = `${Math.round(done / total * 100)}%`;
      bar.className = 'bg-map-bar-fill' + (done >= total ? ' done' : '');
    }
    if (statusEl) statusEl.textContent = text;
  };

  preloadModels();
  preloadBattleClient();
  for (const it of items) {
    while (_userActive > 0 || inBattle()) await new Promise((r) => setTimeout(r, 300));
    if (isMapPrepared(it.cfg)) continue;
    show(`處理中:${it.name}`);
    try {
      await prepareMapCreation(it.cfg, () => {});
    } catch (err) {
      console.warn('預設地圖預熱略過:', it.name, err);
    }
    done++;
  }
  show('✅ 所有預設地圖圖資已處理並記憶');
  if (_userActive === 0) {
    clearTimeout(_autoMinTimer);
    _autoMinTimer = setTimeout(() => {
      if (_userActive === 0 && !inBattle()) panel.style.display = 'none';
    }, 5000);
  }
}
