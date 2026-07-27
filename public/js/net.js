// ============ 傳輸層:WebSocket 客戶端 + 三種連線機制的建構入口 ============
// `Net` = WebSocket(雲端 / 區網 Tailscale 共用,差別只有連到哪個網址);
// `LocalNet`(localhost.js)= 單機,把 RoomHub 跑在瀏覽器裡。兩者的介面完全相同:
//   connected / send / sendNow / flushQueue / kill,handler 表也一模一樣。
// 【單一真相縫】選哪一種一律經 `makeNet()`;呼叫端(main.js)**MUST NOT** 自己 `new Net()` 或判斷模式。
import { netMode, wsUrl, LINK_MODES } from './netmode.js';
import { LocalNet } from './localhost.js';

export class Net {
  /**
   * @param {object} handlers { sync, snap, rooms, error, info, battleConfig, mapProgress, tracer, heavyCharge, heavyFire, reconnect }
   * @param {string} url      WebSocket 網址;省略 = 開出本頁的主機(區網 / Tailscale)
   */
  constructor(handlers = {}, url = null) {
    this.h = handlers;
    this.url = url || `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}`;
    this.connected = false;
    this._everOpen = false;
    this._queue = [];
    this._connect();
  }

  _connect() {
    this.ws = new WebSocket(this.url);
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

/**
 * 依目前連線機制建傳輸層(**唯一入口**)。
 * 單機的權威模擬(rooms.js → sim.js/bots.js 約 4000 行)由 `LocalNet` 動態 import ——
 * 雲端/區網玩家不必為了一個用不到的模式多下載一份模擬核心;LocalNet 自己會把載入前的訊息排隊,
 * 因此本函式維持**同步**回傳,啟動流程(建 net → 立刻 listRooms)不必改成 async。
 * 缺設定(雲端沒填節點網址)回 null,呼叫端據此提示玩家,MUST NOT 硬連一個空網址。
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

/** 連線機制的顯示資訊(鈕面/提示共用同一份文案,見 netmode.js) */
export { LINK_MODES };
