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
    this._fails = 0;      // 連續斷線次數:退避重連用,連上歸零
    this._timer = null;
    this._connect();
  }

  // 退避重連:2s 起跳、指數退避、30s 封頂。伺服器重啟瞬間全員固定 2s 回打 = 驚群,
  // 還會跟 15s 心跳共振;拉開之後錯峰回來。長期斷線不無限拉長(封頂 30s)。
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
      this._later();   // 網址壞掉之類:照退避重試,不把頁面炸掉
      return;
    }
    this.ws = ws;
    this.ws.onopen = () => {
      this.connected = true;
      this._fails = 0;
      if (this._everOpen) {
        this.h.reconnect?.();     // 重連:由 app 送 reattach 認回座位
      } else {
        this._everOpen = true;
        this.flushQueue();
      }
    };
    this.ws.onmessage = (e) => {
      let m;
      try { m = JSON.parse(e.data); } catch { return; }   // 非 JSON 幀直接丟棄
      try {
        const fn = this.h[m?.t];
        if (fn) fn(m);
        else this.h.other?.(m);
      } catch { /* handler 異常不炸傳輸層 */ }
    };
    this.ws.onerror = () => {};   // 細節由隨後的 onclose 統一處理
    this.ws.onclose = (e) => {
      this.connected = false;
      if (this._dead) return;
      // 1009 = 訊息超過上限(通常是房主的世界/圖資上傳那一包):重連也不會自己變小,講清楚。
      this.h.error?.({ msg: e?.code === 1009 ? '上傳資料超過上限被斷線,重連中…(反覆發生請重整後重試)' : '與伺服器斷線,重連中…' });
      this._later();
    };
  }

  kill() { this._dead = true; this._queue = []; clearTimeout(this._timer); try { this.ws.close(); } catch { /* 忽略 */ } }

  // 發送本體:race(connected 剛置 true、底層已半開)下 ws.send 會拋 ——
  // 舊制直接噴到呼叫端(遊戲迴圈),connected 還卡在 true = 表面連著、實際全丟。
  // 這裡當斷線處理:排退避重連,呼叫端只看到回傳值。
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
      if (!this._raw(this._queue[0])) break;   // 中途斷線:剩下的留待下次重連,順序不變
      this._queue.shift();
    }
  }

  // 斷線期間的輸入(座標每幀一則)無界排隊 = 重連 burst 打爆上限再斷線的循環。
  // 只留最新的 120 則(約 2s 輸入):舊座標本來就被新座標取代。
  _queueMsg(msg) {
    if (this._queue.length >= 120) this._queue.shift();
    this._queue.push(msg);
  }

  send(msg) {
    if (this.connected) {
      if (this._raw(msg)) return;
      // 發送 race 失敗:當斷線排隊,重連後 reattach 先送、這一則隨後,不亂序。
    }
    this._queueMsg(msg);
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
