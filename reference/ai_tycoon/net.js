// ============ WebSocket 客戶端 ============
export class Net {
  constructor(onSync, onError, onOther = null, onReconnect = null) {
    this.onSync = onSync;
    this.onError = onError;
    this.onOther = onOther;
    this.onReconnect = onReconnect; // 斷線重連成功時呼叫(用來重新加入房間)
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
        // 重連:只先送 reattach 重新綁定房間;排隊訊息等 reattach 被 sync 確認後再由 flushQueue() 補送
        // (否則伺服器這條連線尚未認回座位,排隊的 action 會撞上「尚未加入房間」)
        if (this.onReconnect) this.onReconnect();
      } else {
        // 首次連線:直接補送排隊的 createRoom / joinRoom 等
        this._everOpen = true;
        this.flushQueue();
      }
    };
    this.ws.onmessage = e => {
      const m = JSON.parse(e.data);
      if (m.t === 'sync') this.onSync(m);
      else if (m.t === 'error') this.onError(m.msg);
      else if (this.onOther) this.onOther(m);
    };
    this.ws.onclose = () => {
      this.connected = false;
      if (this._dead) return; // 已被剔除/主動關閉:不再重連
      this.onError('與伺服器斷線,重連中…');
      setTimeout(() => this._connect(), 2000);
    };
  }

  // 永久關閉(被剔除房間時呼叫):停止自動重連
  kill() { this._dead = true; this._queue = []; try { this.ws.close(); } catch { /* 忽略 */ } }

  // 立即送出(不排隊;reattach 必須早於後續行動)
  sendNow(msg) { if (this.connected) this.ws.send(JSON.stringify(msg)); }

  // 補送排隊訊息(重連確認後由 app 呼叫;連線中斷時為 no-op)
  flushQueue() {
    if (!this.connected) return;
    for (const m of this._queue) this.ws.send(JSON.stringify(m));
    this._queue = [];
  }

  // 丟棄排隊訊息(重連失敗、需重新加入時呼叫,避免送出過期行動)
  clearQueue() { this._queue = []; }

  send(msg) {
    if (this.connected) this.ws.send(JSON.stringify(msg));
    else this._queue.push(msg);
  }

  action(kind, extra = {}) { this.send({ t: 'action', kind, ...extra }); }
}
