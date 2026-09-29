// ============ 通用物件池(唯一縫)============
// 頻繁生成與銷毀的物件(子彈記錄/曳光/粒子 sprite/彈殼)預先分配並循環重用,
// 避免每發 `new` 造成 GC Spike 或逐幀記憶體分配卡頓。
//
// 契約:
//   - 純表現層/記錄層重用,不碰權威結算(A1)。池只管「物件本體」,命中/傷害照舊走原路徑。
//   - 瀏覽器可跑:零 import、零 Node API(sim/game/castfx 共用同一支,見 server/AGENTS.md)。
//   - 確定性:池內是 LIFO 空閒棧,不消費任何隨機序列;存活物件的語義與逐位元行為不變(A4)。
//   - 釋放語義:A25 單一處置 — 池滿溢出才真正 dispose,平時只是藏起來重用。
//   - 呼叫端負責在 acquire 後完整覆寫可變欄位;release 只做「藏起來安全」的最小重置,
//     避免把上一發的殘留帶進下一發(位置/速度/可見度/透明度)。
export class Pool {
  /**
   * @param make  () => 新物件(只在池空時呼叫)
   * @param opts.reset (o) => 歸還時最小重置(藏起來安全);重型重置由呼叫端 acquire 後覆寫
   * @param opts.max    空閒棧上限(超量歸還直接丟棄,由呼叫端另行 dispose)
   * @param opts.prewarm 建構期預填數量(避開首發卡頓;只填空閒棧,不進場景)
   */
  constructor(make, { reset = null, max = 64, prewarm = 0 } = {}) {
    this._make = make;
    this._reset = reset || null;
    this._max = Math.max(1, max | 0);
    this._free = [];
    if (prewarm > 0) this.prewarm(prewarm);
  }

  /** 取一個可用物件(池空即新建,不拋錯)。 */
  acquire() {
    const f = this._free;
    return f.length ? f.pop() : this._make();
  }

  /**
   * 歸還物件。回傳 true=已入池 / false=池滿丟棄(呼叫端此時才 dispose)。
   * 歸還 null/undefined 為 no-op(回傳 false),方便 dispose 路徑直通。
   */
  release(o) {
    if (o == null) return false;
    if (this._reset) this._reset(o);
    if (this._free.length < this._max) { this._free.push(o); return true; }
    return false;
  }

  /** 預填空閒棧(開場/進場一次,避開首發配置卡頓)。 */
  prewarm(n) {
    const want = Math.min(this._max, Math.max(0, n | 0));
    while (this._free.length < want) this._free.push(this._make());
  }

  /** 清空空閒棧(離場時);dispose 逐個呼叫,無則只丟引用。 */
  clear(dispose) {
    if (typeof dispose === 'function') {
      for (const o of this._free) {
        try { dispose(o); } catch { /* 釋放路徑不拋 */ }
      }
    }
    this._free.length = 0;
  }

  get size() { return this._free.length; }
  get max() { return this._max; }
}
