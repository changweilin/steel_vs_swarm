// ============ Spatial Geospatial Cache (IndexedDB) ============
// "Cache-on-first-complete-success" store for elevation grids, raw satellite imagery tiles, and Overpass responses.
//
// Rationale: Gameplay-critical structures like lane water-crossing bridges, underpasses, and tunnels
// depend on inputs (elevation, water mask, OSM network) fetched from external services. Fluctuations
// in fallback elevation sources, missing tiles, or Overpass throttling cause non-deterministic layout drift.
// Caching the first complete fetch per bounding box guarantees bit-identical generation inputs across sessions.
//
// Invariants:
//   - Only store completely successful payloads (exclude missing tiles, Overpass remark truncations, or coarse fallbacks).
//   - Cache failures (incognito mode, quota exceeded, unsupported browser) degrade silently to network fetching.
//   - Format revisions bump the `v` parameter in geoKey to invalidate stale entries without manual migrations.
const DB_NAME = 'svs_geo';
const STORE = 'kv';
// Retained entries per category (LRU): satellite images reach ~16MB each; elevation/OSM are KB-MB scale
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

/** Form key: kind|vVersion|bbox (5 decimals ~= 1m precision)|extra (query quota or shape params) */
export function geoKey(kind, v, bbox, extra = '') {
  const bb = `${bbox.minLat.toFixed(5)},${bbox.minLng.toFixed(5)},${bbox.maxLat.toFixed(5)},${bbox.maxLng.toFixed(5)}`;
  return `${kind}|v${v}|${bb}${extra ? '|' + extra : ''}`;
}

/** Retrieve entry; cache misses or storage failures return null. */
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
 * Fire-and-forget write with per-kind LRU eviction.
 * Eviction uses a lightweight metadata array (`meta|kind` storing `{key, t}`)
 * to avoid reading multi-megabyte payloads during pruning. Failures degrade silently.
 */
export function geoPut(key, data) {
  db().then((d) => {
    if (!d) return;
    try {
      const kind = key.split('|')[0];
      const tx = d.transaction(STORE, 'readwrite');
      tx.onerror = () => {};
      tx.onabort = () => {};   // Quota exceeded: abort silently; subsequent runs fall back to network
      const st = tx.objectStore(STORE);
      const mkey = 'meta|' + kind;
      const mreq = st.get(mkey);
      mreq.onsuccess = () => {
        // Metadata list is ordered by insertion time; evict oldest entries from head
        const list = (Array.isArray(mreq.result?.data) ? mreq.result.data : []).filter((e) => e && e.key !== key);
        list.push({ key, t: Date.now() });
        const keep = KEEP[kind] ?? 8;
        while (list.length > keep) st.delete(list.shift().key);
        st.put({ key, kind, t: Date.now(), data });
        st.put({ key: mkey, kind: 'meta', t: Date.now(), data: list });
      };
      mreq.onerror = () => {};
    } catch { /* Silent degradation */ }
  }).catch(() => {});
}

/** Clear entire database (invoked manually after code changes; failures degrade silently). */
export async function geoClear() {
  try {
    if (typeof indexedDB === 'undefined') return;
    await new Promise((res) => {
      const req = indexedDB.deleteDatabase(DB_NAME);
      req.onsuccess = req.onerror = req.onblocked = () => res();
    });
    _dbP = null;   // Next db() call reopens a fresh store
  } catch { /* Silent degradation */ }
}
