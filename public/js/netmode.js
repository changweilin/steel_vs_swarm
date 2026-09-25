// ============ Link Mode: Single Seam for Gameplay Connection Transports ============
// Single Seam: All queries regarding active connection mode MUST query this module.
// main.js, net.js, and localhost.js MUST NOT inspect location.host or fork if (isSolo) branches independently,
// which would introduce a duplicate mode table and cause drift when adding future transports.
//
// Transports:
//   cloud: connects to remote node (wss://...), custom URL configured and saved by user.
//   lan: connects to host serving the page (location.host). Compatible with Tailscale for cross-network play
//        (host runs npm run lan; peers connect to host's Tailscale address, behaving identically to local LAN).
//   solo: offline mode running simulation directly in browser (server/sim.js); used by static builds (GitHub Pages).
//
// Resolution order: URL query param (?mode=) -> static site auto-detection -> localStorage memory -> default (lan).

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

/** Defensive wrapper for localStorage: private browsing or file: protocols may throw exceptions. */
function ls(fn, fallback = null) {
  try { return fn(window.localStorage); } catch { return fallback; }
}

/**
 * Detect static hosting environments that only support solo mode.
 * Static hosting (GitHub Pages / file://) lacks a WebSocket server;
 * defaulting to solo mode avoids misleading connection timeouts.
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

/** Active link mode (cached on initial invocation for tab lifetime). */
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
 * Switch link mode. Transport layers cannot hot-swap dynamically (WebSocket vs in-browser sim);
 * this function updates storage and returns change status, leaving transport reinitialization to caller.
 */
export function setNetMode(mode) {
  if (!LINK_MODES[mode] || soloOnly()) return false;
  if (mode === _mode) return false;
  _mode = mode;
  ls((s) => s.setItem(MODE_KEY, mode));
  return true;
}

/** Configured cloud server endpoint (persisted in localStorage). */
export function cloudUrl() {
  return ls((s) => s.getItem(CLOUD_KEY), '') || '';
}

/**
 * Normalize user-entered cloud node address to valid WebSocket URL; returns null on invalid input.
 * Accepts https:// (converted to wss://) or bare hostname (inferred from page protocol).
 */
export function normalizeCloudUrl(raw) {
  let s = String(raw || '').trim();
  if (!s) return null;
  if (/^wss?:\/\//i.test(s)) { /* Already WebSocket URL */ }
  else if (/^https:\/\//i.test(s)) s = 'wss://' + s.slice(8);
  else if (/^http:\/\//i.test(s)) s = 'ws://' + s.slice(7);
  else if (/^[a-z][a-z0-9+.-]*:/i.test(s)) return null; // Reject other protocols (ftp:, javascript:); MUST NOT force prefix.
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

/** Save cloud endpoint; returns normalized URL or null if invalid (rejecting write). */
export function setCloudUrl(raw) {
  const u = normalizeCloudUrl(raw);
  if (!u) return null;
  ls((s) => s.setItem(CLOUD_KEY, u));
  return u;
}

/**
 * Target WebSocket URL for active mode; returns null for solo or unconfigured cloud mode.
 * LAN mode uses page host (location.host), which naturally resolves to Tailscale address when accessed remotely.
 */
export function wsUrl(mode = netMode()) {
  if (mode === 'solo') return null;
  if (mode === 'cloud') return cloudUrl() || null;
  if (typeof location === 'undefined') return null;
  return `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}`;
}

/** Check if transport configuration is ready (false indicates missing configuration). */
export function modeReady(mode = netMode()) {
  return mode === 'solo' ? true : !!wsUrl(mode);
}
