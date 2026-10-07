// ============ View direction prefs (horizontal/vertical invert single source of truth)============
// All view inputs (mouse / numpad grid / touch drag / view stick / gyro / spectator free view)
// always go through `game.js _applyLook(dYaw, dPitch)`; inversion MUST live only here.
// Zero imports in this file (same as rng.js / visualPrefs.js): offline audits must execute it directly to verify defaults.

const KEY = 'svs_look';

export const LOOK_PREFS = {
  invertX: {
    label: '水平方向反轉', def: false,
    hint: '左右視角反轉。關 = 九宮格 4 向左、6 向右(與滑鼠右移向右一致);開 = 反過來。',
  },
  invertY: {
    label: '垂直方向反轉', def: false,
    hint: '上下視角反轉。關 = 九宮格 8 抬頭、2 低頭(與滑鼠上移抬頭一致);開 = 反過來。',
  },
};

const _vals = { invertX: false, invertY: false };
const _subs = new Set();

function clampBool(v, def) {
  if (v === true || v === 'true' || v === 1) return true;
  if (v === false || v === 'false' || v === 0) return false;
  return def;
}

{
  let raw = null;
  try { raw = JSON.parse(localStorage.getItem(KEY) || '{}'); } catch { /* private mode / bad string */ }
  for (const k in LOOK_PREFS) {
    const v = raw && typeof raw === 'object' ? raw[k] : undefined;
    _vals[k] = v === undefined ? LOOK_PREFS[k].def : clampBool(v, LOOK_PREFS[k].def);
  }
}

/** Current value */
export function lookPref(k) {
  return k in _vals ? _vals[k] : (LOOK_PREFS[k]?.def ?? false);
}

/** Whole current values (returns new object, MUST NOT mutate in place) */
export function lookPrefs() {
  return { ..._vals };
}

/** Write one switch (persist + broadcast). Returns the written value */
export function setLookPref(k, v) {
  if (!(k in LOOK_PREFS)) return false;
  const nv = clampBool(v, LOOK_PREFS[k].def);
  if (nv === _vals[k]) return nv;
  _vals[k] = nv;
  try { localStorage.setItem(KEY, JSON.stringify(_vals)); } catch { /* ignore in private mode */ }
  _emit();
  return nv;
}

/** Reset all to defaults (all off = corrected forward) */
export function resetLookPrefs() {
  let changed = false;
  for (const k in LOOK_PREFS) {
    if (_vals[k] !== LOOK_PREFS[k].def) { _vals[k] = LOOK_PREFS[k].def; changed = true; }
  }
  if (!changed) return;
  try { localStorage.setItem(KEY, JSON.stringify(_vals)); } catch { /* ignore in private mode */ }
  _emit();
}

/** Subscribe to changes; returns unsubscribe function */
export function onLookPrefChange(fn) {
  _subs.add(fn);
  return () => _subs.delete(fn);
}

function _emit() {
  for (const fn of [..._subs]) {
    try { fn(_vals); } catch { /* consumer's own error, never blocks broadcast */ }
  }
}
