// ============ WebSocket 客戶端(改自 ai_tycoon/public/js/net.js)============
export class Net {
  constructor(handlers = {}) {
    this.h = handlers;            // { sync, snap, rooms, error, info, battleConfig, mapProgress, tracer, heavyCharge, heavyFire, reconnect }
    this.connected = false;
    this._everOpen = false;
    this._queue = [];
    this._connect();
  }

  _connect() {
    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    this.ws = new WebSocket(`${proto}://${location.host}`);
    this.ws.onopen = () => {
      this.connected = true;
      if (this._everOpen) {
        this.h.reconnect?.();     // 重連:由 app 送 reattach 認回座位
      } else {
        this._everOpen = true;
        this.flushQueue();
      }
    };
    this.ws.onmessage = (e) => {
      const m = JSON.parse(e.data);
      const fn = this.h[m.t];
      if (fn) fn(m);
      else this.h.other?.(m);
    };
    this.ws.onclose = () => {
      this.connected = false;
      if (this._dead) return;
      this.h.error?.({ msg: '與伺服器斷線,重連中…' });
      setTimeout(() => this._connect(), 2000);
    };
  }

  kill() { this._dead = true; this._queue = []; try { this.ws.close(); } catch { /* 忽略 */ } }

  sendNow(msg) { if (this.connected) this.ws.send(JSON.stringify(msg)); }

  flushQueue() {
    if (!this.connected) return;
    for (const m of this._queue) this.ws.send(JSON.stringify(m));
    this._queue = [];
  }

  send(msg) {
    if (this.connected) this.ws.send(JSON.stringify(msg));
    else this._queue.push(msg);
  }
}
