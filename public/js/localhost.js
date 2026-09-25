// ============ Solo Mode: In-Browser Authoritative Host ============
// Solo mode does not duplicate server simulation logic on the client (violates principle 1 server-authoritative).
// Instead, the entire server suite (RoomHub in server/rooms.js + BattleSim in server/sim.js) runs inside the browser tab.
// The client only sends input and receives snapshots; only the transport switches from WebSocket to function calls.
//
// Path: ../../server/rooms.js resolved from /public/js/ maps to /server/rooms.js.
// Browser URL structure mirrors repository layout (/public/** + /server/*.js) across dev server and static GitHub Pages build,
// ensuring data.js shares a single module instance across the tab (single seam for balance parameters).
//
// Message dispatch: incoming messages MUST be queued in microtasks before handing off to handlers.
// Server transport is inherently asynchronous (socket events); synchronous dispatch in solo would create recursive call stacks
// (e.g. loaded -> sync -> sendNow), which must not be flattened into synchronous calls.

const HUB_URL = '../../server/rooms.js';

export class LocalNet {
  /**
   * @param {object} handlers Handler table identical to Net (sync/snap/rooms/error/...).
   */
  constructor(handlers = {}) {
    this.h = handlers;
    this.mode = 'solo';
    this.connected = false; // Mark unconnected until module loads; outbound messages queue up (matches Net semantics).
    this._queue = [];
    this._inbox = [];
    this._dead = false;
    this.hub = null;
    this.sess = null;
    this._boot();
  }

  async _boot() {
    try {
      const { RoomHub } = await import(HUB_URL);
      if (this._dead) return;
      // Solo mode: no shareable join URL; drop immediately on disconnect (dropMs 0) since local player is the sole participant.
      this.hub = new RoomHub({ urls: () => [], log: () => {}, dropMs: 0 });
      this.sess = this.hub.attach((msg) => this._inbound(msg));
      this.connected = true;
      this.flushQueue();
    } catch (err) {
      console.error('[solo] 權威模擬載入失敗', err);
      this.h.error?.({ msg: '單機模式載入失敗:取不到本機模擬核心,請重新整理' });
    }
  }

  _inbound(msg) {
    this._inbox.push(msg);
    if (this._inbox.length > 1) return; // Microtask flush already scheduled; batch messages in the same tick.
    queueMicrotask(() => {
      const batch = this._inbox;
      this._inbox = [];
      for (const m of batch) {
        if (this._dead) return;
        const fn = this.h[m.t];
        if (fn) fn(m);
        else this.h.other?.(m);
      }
    });
  }

  kill() {
    this._dead = true;
    this._queue = [];
    this._inbox = [];
    try { this.sess?.close(); } catch { /* ignore */ }
    try { this.hub?.shutdown(); } catch { /* ignore */ } // MUST: stop room ticks; otherwise 8Hz loop leaks across modes.
    this.hub = null; this.sess = null;
  }

  // Solo recv is a direct synchronous invocation: simulation exceptions (e.g. malformed inputs) would halt the render loop.
  // Catch and drop at transport layer to match server-side websocket error handling (degrade by omission).
  _recv(m) {
    try { this.sess.recv(m); }
    catch (err) { console.error('[solo] 訊息處理異常已攔截並丟棄', err); }
  }

  sendNow(msg) { if (this.connected) this._recv(msg); }

  flushQueue() {
    if (!this.connected) return;
    const q = this._queue;
    this._queue = [];
    for (const m of q) this._recv(m);
  }

  send(msg) {
    if (this.connected) this._recv(msg);
    else this._queue.push(msg);
  }
}
