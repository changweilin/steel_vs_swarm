// ============ Transport Layer: WebSocket client + multi-transport factory ============
// `Net` = WebSocket (shared between Cloud and LAN / Tailscale; differentiates only by URL).
// `LocalNet` (localhost.js) = Solo mode, runs RoomHub in-browser. Interfaces are identical:
//   connected / send / sendNow / flushQueue / kill, with matching handler signatures.
// Single truth seam: selection routes strictly through `makeNet()`; callers MUST NOT instantiate Net directly.
import { netMode, wsUrl, LINK_MODES } from './netmode.js';
import { LocalNet } from './localhost.js';

export class Net {
  /**
   * @param {object} handlers { sync, snap, rooms, error, info, battleConfig, mapProgress, tracer, heavyCharge, heavyFire, reconnect }
   * @param {string} url      WebSocket URL; omitted = host serving this page (LAN / Tailscale)
   */
  constructor(handlers = {}, url = null) {
    this.h = handlers;
    this.url = url || `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}`;
    this.connected = false;
    this._everOpen = false;
    this._queue = [];
    this._fails = 0;      // Consecutive connection failure count for backoff retry; resets on connection
    this._timer = null;
    this._connect();
  }

  // Exponential backoff reconnect: starting at 2s, capped at 30s.
  // Staggers client reconnect bursts upon server restart to avoid thundering herd and heartbeat resonance.
  _later() {
    if (this._dead) return;
    clearTimeout(this._timer);
    const wait = Math.min(30000, 2000 * 2 ** Math.min(this._fails, 4));
    this._fails++;
    this._timer = setTimeout(() => this._connect(), wait);
  }

  _connect() {
    if (this._dead) return;
    let ws;
    try {
      ws = new WebSocket(this.url);
    } catch {
      this._later();   // Malformed URL or connection failure triggers backoff without crashing application
      return;
    }
    this.ws = ws;
    this.ws.onopen = () => {
      this.connected = true;
      this._fails = 0;
      if (this._everOpen) {
        this.h.reconnect?.();     // Reconnection: client emits reattach to reclaim player slot
      } else {
        this._everOpen = true;
        this.flushQueue();
      }
    };
    this.ws.onmessage = (e) => {
      let m;
      try { m = JSON.parse(e.data); } catch { return; }   // Drop malformed non-JSON frames
      try {
        const fn = this.h[m?.t];
        if (fn) fn(m);
        else this.h.other?.(m);
      } catch { /* Handler exceptions MUST NOT crash the transport layer */ }
    };
    this.ws.onerror = () => {};   // Errors delegate to following onclose
    this.ws.onclose = (e) => {
      this.connected = false;
      if (this._dead) return;
      // 1009 = Message exceeds frame size limit (typically world/map payload upload).
      this.h.error?.({ msg: e?.code === 1009 ? '上傳資料超過上限被斷線,重連中…(反覆發生請重整後重試)' : '與伺服器斷線,重連中…' });
      this._later();
    };
  }

  kill() { this._dead = true; this._queue = []; clearTimeout(this._timer); try { this.ws.close(); } catch { /* ignore */ } }

  // Socket transmission: during race conditions where connected is true but underlying socket is closing,
  // ws.send throws. Handled as disconnect by triggering backoff retry while returning false.
  _raw(msg) {
    try { this.ws.send(JSON.stringify(msg)); return true; }
    catch {
      this.connected = false;
      this._later();
      return false;
    }
  }

  sendNow(msg) { if (this.connected && !this._raw(msg)) this._queueMsg(msg); }

  flushQueue() {
    if (!this.connected) return;
    while (this._queue.length) {
      if (!this._raw(this._queue[0])) break;   // Disconnected mid-flush: retain remainder for next reconnect
      this._queue.shift();
    }
  }

  // Unbounded queueing of per-frame input messages during disconnect causes socket overflow upon reconnection.
  // Bound to the latest 120 messages (~2s input) since newer coordinates supersede older ones.
  _queueMsg(msg) {
    if (this._queue.length >= 120) this._queue.shift();
    this._queue.push(msg);
  }

  send(msg) {
    if (this.connected) {
      if (this._raw(msg)) return;
      // Send race failure: queues message after reconnect; reattach is sent first to preserve ordering.
    }
    this._queueMsg(msg);
  }
}

/**
 * Factory for active transport layer (sole entry point).
 * Authoritative simulation for solo mode (~4000 lines) is dynamically imported by `LocalNet` --
 * avoiding simulation bundle overhead for Cloud/LAN players. LocalNet queues early messages during load,
 * allowing this factory to return synchronously.
 * Returns null if required configuration is missing (e.g. unconfigured Cloud node URL).
 */
export function makeNet(handlers = {}) {
  const mode = netMode();
  if (mode === 'solo') return new LocalNet(handlers);
  const url = wsUrl(mode);
  if (!url) return null;
  const net = new Net(handlers, url);
  net.mode = mode;
  return net;
}

/** Transport mode metadata (button labels and tooltips share copy from netmode.js). */
export { LINK_MODES };
