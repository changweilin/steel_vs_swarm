// ============ 連線機制(link mode)— 三種遊戲機制的唯一真相縫 ============
// 【單一真相縫】「現在是哪一種連線」只准問這一支;main.js / net.js / localhost.js **MUST NOT** 各自
// 判斷 `location.host` 或自寫 `if (isSolo)` 分支 —— 那就變成第二份模式表,加第四種機制時一定漏改。
//
//   ☁ cloud 雲端伺服器:連到遠端節點(wss://…),玩家自己填/記住網址。規劃給未來上雲端的公開對戰。
//   🛰 lan   區網對戰  :連到「開出這個頁面的那台主機」(location.host)。搭 Tailscale 就是跨網對戰 ——
//                        主機 `npm run lan`,隊友連主機的 Tailscale 位址,對客戶端而言與家用區網完全一樣。
//   🖥 solo  單機模式  :不連線。權威模擬(server/sim.js)直接跑在瀏覽器裡,可離線遊玩;
//                        GitHub Actions 產出的靜態單機版(GitHub Pages)就是這一種。
//
// 解析順序:網址參數 `?mode=` → 靜態站台自動判定 → localStorage 記憶 → 預設 lan。

export const LINK_MODES = {
  cloud: {
    key: 'cloud', icon: '☁', label: '雲端伺服器',
    hint: '連到遠端戰區節點,和網路上的指揮官同場對戰。需要填入節點網址。',
  },
  lan: {
    key: 'lan', icon: '🛰', label: '區網對戰',
    hint: '連到開出本頁的主機。裝了 Tailscale 就能跨網對戰:主機執行 npm run lan,隊友連主機的 Tailscale 網址。',
  },
  solo: {
    key: 'solo', icon: '🖥', label: '單機模式',
    hint: '戰局在你的瀏覽器裡結算,不需要伺服器,可離線遊玩。對手一律是電腦玩家。',
  },
};
export const LINK_MODE_KEYS = ['cloud', 'lan', 'solo'];
export const DEFAULT_LINK_MODE = 'lan';

const MODE_KEY = 'svs_link_mode';
const CLOUD_KEY = 'svs_cloud_url';

/** localStorage 在無痕/檔案協定下可能整支拋例外 —— 連線模式不該因此開不了遊戲 */
function ls(fn, fallback = null) {
  try { return fn(window.localStorage); } catch { return fallback; }
}

/**
 * 這個站台是不是「只可能單機」的靜態站台?
 * 靜態託管(GitHub Pages / 本機檔案)根本沒有 WebSocket 端點,連 lan 都連不上 ——
 * 與其讓玩家按了半天才看到「與伺服器斷線」,不如在這裡就定案成單機並把另外兩顆鈕標示為不可用。
 */
export function soloOnly() {
  if (typeof location === 'undefined') return false;
  if (location.protocol === 'file:') return true;
  const h = location.hostname || '';
  return /(^|\.)(github\.io|pages\.dev|netlify\.app|surge\.sh)$/.test(h);
}

function urlMode() {
  if (typeof location === 'undefined') return null;
  const q = new URLSearchParams(location.search);
  const v = (q.get('mode') || q.get('net') || '').toLowerCase();
  return LINK_MODES[v] ? v : null;
}

let _mode = null;

/** 目前的連線機制(首次呼叫時定案並寫回記憶,之後整個分頁都用同一個值) */
export function netMode() {
  if (_mode) return _mode;
  const forced = urlMode();
  if (soloOnly()) _mode = 'solo';
  else if (forced) _mode = forced;
  else {
    const saved = ls((s) => s.getItem(MODE_KEY));
    _mode = LINK_MODES[saved] ? saved : DEFAULT_LINK_MODE;
  }
  ls((s) => s.setItem(MODE_KEY, _mode));
  return _mode;
}

/**
 * 切換連線機制。傳輸層要整條重建(WebSocket ⇄ 瀏覽器內模擬無法熱切),
 * 故本函式只負責寫記憶 + 回報有沒有真的變 —— 重建連線由呼叫端(main.js)做。
 */
export function setNetMode(mode) {
  if (!LINK_MODES[mode] || soloOnly()) return false;
  if (mode === _mode) return false;
  _mode = mode;
  ls((s) => s.setItem(MODE_KEY, mode));
  return true;
}

/** 雲端節點網址(玩家填,記在 localStorage) */
export function cloudUrl() {
  return ls((s) => s.getItem(CLOUD_KEY), '') || '';
}

/**
 * 正規化玩家填的雲端節點位址 → WebSocket 網址;不合法回 null。
 * 允許直接貼 https:// 網址(自動換成 wss://),或只填主機名(依本頁協定推 ws/wss)。
 */
export function normalizeCloudUrl(raw) {
  let s = String(raw || '').trim();
  if (!s) return null;
  if (/^wss?:\/\//i.test(s)) { /* 已經是 WebSocket 網址 */ }
  else if (/^https:\/\//i.test(s)) s = 'wss://' + s.slice(8);
  else if (/^http:\/\//i.test(s)) s = 'ws://' + s.slice(7);
  else if (/^[a-z][a-z0-9+.-]*:/i.test(s)) return null;   // 其他協定(ftp:、javascript:…)一律拒絕,MUST NOT 硬補前綴
  else s = (typeof location !== 'undefined' && location.protocol === 'https:' ? 'wss://' : 'ws://') + s;
  try {
    const u = new URL(s);
    if (u.protocol !== 'ws:' && u.protocol !== 'wss:') return null;
    if (!u.hostname) return null;
    return u.toString().replace(/\/$/, '');
  } catch {
    return null;
  }
}

/** 存雲端節點網址;回傳正規化後的網址(不合法回 null 且不寫入) */
export function setCloudUrl(raw) {
  const u = normalizeCloudUrl(raw);
  if (!u) return null;
  ls((s) => s.setItem(CLOUD_KEY, u));
  return u;
}

/**
 * 目前機制要連的 WebSocket 網址;單機回 null(不連線),雲端沒填網址也回 null(呼叫端提示玩家填)。
 * 區網 = 開出本頁的那台主機 —— Tailscale 對戰時 location.host 本來就是主機的 Tailscale 位址。
 */
export function wsUrl(mode = netMode()) {
  if (mode === 'solo') return null;
  if (mode === 'cloud') return cloudUrl() || null;
  if (typeof location === 'undefined') return null;
  return `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}`;
}

/** 這個機制現在連得上嗎?(false = 缺設定,呼叫端顯示提示而不是硬連) */
export function modeReady(mode = netMode()) {
  return mode === 'solo' ? true : !!wsUrl(mode);
}
