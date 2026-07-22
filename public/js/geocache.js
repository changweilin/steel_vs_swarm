// ============ 場地圖資快取(IndexedDB)============
// 高程網格 / 衛星影像原始像素 / Overpass 回應的「首次完整成功即定案」快取
// (2026-07-23 倫敦兵線橋 1~3 座逐局浮動案)。
//
// 為什麼:兵線跨水補橋/地下道/隧道等遊戲性關鍵結構,其判定輸入(高程、水色、OSM 路網)
// 全來自外部服務 —— 高程主/備援來源高度場不同、影像缺磚、Overpass 限流,任一逐局波動
// 都會讓「同一場地」的橋數/隧道忽有忽無。同一 bbox 第一次「完整」抓齊後定案入庫,
// 之後每場直接取快取 → 建圖輸入位元級一致,整張地圖(含兵線結構)恆定。
//
// 紀律:
//  - 只准存「完整成功」的結果(缺磚 / Overpass remark 截斷 / 備援粗高程不入庫,
//    否則一次網路顛簸把殘缺資料永久定案);
//  - 快取層任何失敗(隱私模式、配額滿、瀏覽器不支援)一律靜默降級照走網路 ——
//    MUST NOT 因快取炸掉建圖(§2.4 外部服務防禦不變);
//  - 資料格式改版時 bump geoKey 的 v 參數即自然失效,不需遷移。
const DB_NAME = 'svs_geo';
const STORE = 'kv';
// 每類保留筆數(LRU):影像一筆可達 ~16MB,收緊;高程/OSM 皆 KB~MB 級
const KEEP = { elev: 12, img: 4, osmF: 8, osmR: 8 };

let _dbP = null;
function db() {
  if (_dbP) return _dbP;
  _dbP = new Promise((resolve) => {
    try {
      if (typeof indexedDB === 'undefined') return resolve(null);
      const req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = () => { req.result.createObjectStore(STORE, { keyPath: 'key' }); };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
      req.onblocked = () => resolve(null);
    } catch { resolve(null); }
  });
  return _dbP;
}

/** 組鍵:kind|v版本|bbox(5 位小數 ≈ 1m,同場地同隊制必同鍵)|extra(查詢額度等形狀參數) */
export function geoKey(kind, v, bbox, extra = '') {
  const bb = `${bbox.minLat.toFixed(5)},${bbox.minLng.toFixed(5)},${bbox.maxLat.toFixed(5)},${bbox.maxLng.toFixed(5)}`;
  return `${kind}|v${v}|${bb}${extra ? '|' + extra : ''}`;
}

/** 讀取;未命中或快取層失敗一律回 null */
export async function geoGet(key) {
  const d = await db();
  if (!d) return null;
  return new Promise((resolve) => {
    try {
      const req = d.transaction(STORE, 'readonly').objectStore(STORE).get(key);
      req.onsuccess = () => resolve(req.result ? req.result.data : null);
      req.onerror = () => resolve(null);
    } catch { resolve(null); }
  });
}

/**
 * fire-and-forget 寫入 + 同類 LRU 修剪。修剪走輕量 meta 清單(meta|kind 一筆,
 * 只存 {key,t}),不用 getAll 把 MB 級大 blob 整批拉回來。任何失敗靜默 ——
 * 快取只是定錨,不是正確性前提。
 */
export function geoPut(key, data) {
  db().then((d) => {
    if (!d) return;
    try {
      const kind = key.split('|')[0];
      const tx = d.transaction(STORE, 'readwrite');
      tx.onerror = () => {};
      tx.onabort = () => {};   // 配額滿等寫入失敗:整筆放棄,下場照走網路
      const st = tx.objectStore(STORE);
      const mkey = 'meta|' + kind;
      const mreq = st.get(mkey);
      mreq.onsuccess = () => {
        // meta 清單依寫入序排列(append-only),頭端即最舊 → 超額從頭刪
        const list = (Array.isArray(mreq.result?.data) ? mreq.result.data : []).filter((e) => e && e.key !== key);
        list.push({ key, t: Date.now() });
        const keep = KEEP[kind] ?? 8;
        while (list.length > keep) st.delete(list.shift().key);
        st.put({ key, kind, t: Date.now(), data });
        st.put({ key: mkey, kind: 'meta', t: Date.now(), data: list });
      };
      mreq.onerror = () => {};
    } catch { /* 靜默 */ }
  }).catch(() => {});
}
