// ============ 移動操作偏好(水平移動鎖定唯一真相縫)============
// 飛行機體的前後(W/S)預設沿「視線方向」飛 —— 抬頭爬升、低頭俯衝。
// 開啟水平鎖定後,前後左右只在水平面移動,不改變上下方向(上下改由 Space/C 控制)。
// 本檔零 import(同 lookPrefs.js / rng.js / visualPrefs.js):離線稽核要能直接執行它驗預設值。

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
  try { raw = JSON.parse(localStorage.getItem(KEY) || '{}'); } catch { /* 私密模式 / 壞字串 */ }
  for (const k in MOVE_PREFS) {
    const v = raw && typeof raw === 'object' ? raw[k] : undefined;
    _vals[k] = v === undefined ? MOVE_PREFS[k].def : clampBool(v, MOVE_PREFS[k].def);
  }
}

/** 目前值 */
export function movePref(k) {
  return k in _vals ? _vals[k] : (MOVE_PREFS[k]?.def ?? false);
}

/** 整份目前值(回傳新物件,MUST NOT 就地改) */
export function movePrefs() {
  return { ..._vals };
}

/** 寫入一個開關(持久化 + 廣播)。回傳寫入後的值 */
export function setMovePref(k, v) {
  if (!(k in MOVE_PREFS)) return false;
  const nv = clampBool(v, MOVE_PREFS[k].def);
  if (nv === _vals[k]) return nv;
  _vals[k] = nv;
  try { localStorage.setItem(KEY, JSON.stringify(_vals)); } catch { /* 私密模式忽略 */ }
  _emit();
  return nv;
}

/** 全部回到預設 */
export function resetMovePrefs() {
  let changed = false;
  for (const k in MOVE_PREFS) {
    if (_vals[k] !== MOVE_PREFS[k].def) { _vals[k] = MOVE_PREFS[k].def; changed = true; }
  }
  if (!changed) return;
  try { localStorage.setItem(KEY, JSON.stringify(_vals)); } catch { /* 私密模式忽略 */ }
  _emit();
}

/** 訂閱變更;回傳解訂閱函式 */
export function onMovePrefChange(fn) {
  _subs.add(fn);
  return () => _subs.delete(fn);
}

function _emit() {
  for (const fn of [..._subs]) {
    try { fn(_vals); } catch { /* 消費端自己的問題,不阻斷廣播 */ }
  }
}
