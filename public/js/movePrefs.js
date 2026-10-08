// ============ Move operation prefs (level-move lock single source of truth)============
// Flying frames move forward/back (W/S) along gaze by default -- look up to climb, look down to dive.
// With level lock on, forward/back/left/right move only on the horizontal plane, never changing altitude (altitude via Space/C).
// Zero imports in this file (same as lookPrefs.js / rng.js / visualPrefs.js): offline audits must execute it directly to verify defaults.

const KEY = 'svs_move';

export const MOVE_PREFS = {
  levelMove: {
    label: '水平移動鎖定', def: false,
    hint: '開 = 前後左右只控制水平面方向的移動,不改變上下方向(上下改由 Space / C 控制);關 = W / S 沿視線方向飛(抬頭爬升、低頭俯衝)。',
  },
};

const _vals = { levelMove: false };
const _subs = new Set();

function clampBool(v, def) {
  if (v === true || v === 'true' || v === 1) return true;
  if (v === false || v === 'false' || v === 0) return false;
  return def;
}

{
  let raw = null;
  try { raw = JSON.parse(localStorage.getItem(KEY) || '{}'); } catch { /* private mode / bad string */ }
  for (const k in MOVE_PREFS) {
    const v = raw && typeof raw === 'object' ? raw[k] : undefined;
    _vals[k] = v === undefined ? MOVE_PREFS[k].def : clampBool(v, MOVE_PREFS[k].def);
  }
}

/** Current value */
export function movePref(k) {
  return k in _vals ? _vals[k] : (MOVE_PREFS[k]?.def ?? false);
}

/** Whole current values (returns new object, MUST NOT mutate in place) */
export function movePrefs() {
  return { ..._vals };
}

/** Write one switch (persist + broadcast). Returns the written value */
export function setMovePref(k, v) {
  if (!(k in MOVE_PREFS)) return false;
  const nv = clampBool(v, MOVE_PREFS[k].def);
  if (nv === _vals[k]) return nv;
  _vals[k] = nv;
  try { localStorage.setItem(KEY, JSON.stringify(_vals)); } catch { /* ignore in private mode */ }
  _emit();
  return nv;
}

/** Reset all to defaults */
export function resetMovePrefs() {
  let changed = false;
  for (const k in MOVE_PREFS) {
    if (_vals[k] !== MOVE_PREFS[k].def) { _vals[k] = MOVE_PREFS[k].def; changed = true; }
  }
  if (!changed) return;
  try { localStorage.setItem(KEY, JSON.stringify(_vals)); } catch { /* ignore in private mode */ }
  _emit();
}

/** Subscribe to changes; returns unsubscribe function */
export function onMovePrefChange(fn) {
  _subs.add(fn);
  return () => _subs.delete(fn);
}

function _emit() {
  for (const fn of [..._subs]) {
    try { fn(_vals); } catch { /* consumer's own error, never blocks broadcast */ }
  }
}
