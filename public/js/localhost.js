// ============ 單機模式:瀏覽器內的權威主機 ============
// 「單機」不是把伺服器邏輯抄一份到客戶端 —— 那是 A1 明令禁止的「客戶端先改狀態」。
// 這裡做的是**把伺服器整支搬進分頁**:同一支 `server/rooms.js`(RoomHub)+ `server/sim.js`(BattleSim)
// 直接在瀏覽器執行,客戶端仍然只送輸入、收快照。差別只有傳輸層:WebSocket 換成同分頁的函式呼叫。
//
// 【路徑】`../../server/rooms.js` 從 `/public/js/` 出發 = `/server/rooms.js`。
// 這要求瀏覽器的 URL 佈局鏡射儲存庫佈局(`/public/**` + `/server/*.js`);
// dev 伺服器(server/server.js)與 GitHub Pages 靜態版(tools/build_solo.mjs)都照這個佈局出檔,
// 這樣 `data.js` 在整個分頁裡才是**同一個模組實例**(平衡數值只有一份)。
//
// 訊息延遲:收進來的訊息一律**排進微任務**再交給 handler。伺服器版天然是非同步的(socket 事件),
// 單機若同步回呼,`send → handler → send` 會變成遞迴堆疊(例如 loaded → sync → 再送訊息),
// MUST NOT 為了「少一個 tick」改成同步直呼。

const HUB_URL = '../../server/rooms.js';

export class LocalNet {
  /**
   * @param {object} handlers 與 `Net` 完全相同的 handler 表(sync/snap/rooms/error/…)
   */
  constructor(handlers = {}) {
    this.h = handlers;
    this.mode = 'solo';
    this.connected = false;     // 模組載入完成前先當「未連上」,送出的訊息排隊(與 Net 同語意)
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
      // 單機:沒有可分享的加入網址;斷線即離座(dropMs 0)—— 自己就是唯一的真人玩家,不必留位等重連。
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
    if (this._inbox.length > 1) return;          // 已排好一次沖洗,同一輪的訊息一起送
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
    try { this.sess?.close(); } catch { /* 忽略 */ }
    try { this.hub?.shutdown(); } catch { /* 忽略 */ }   // MUST:停掉房間 tick,否則切走後 8Hz 迴圈還在跑
    this.hub = null; this.sess = null;
  }

  sendNow(msg) { if (this.connected) this.sess.recv(msg); }

  flushQueue() {
    if (!this.connected) return;
    const q = this._queue;
    this._queue = [];
    for (const m of q) this.sess.recv(m);
  }

  send(msg) {
    if (this.connected) this.sess.recv(msg);
    else this._queue.push(msg);
  }
}
