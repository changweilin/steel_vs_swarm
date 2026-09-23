// ============ 視角方向偏好(水平/垂直反轉唯一真相縫)============
// 所有視角輸入(滑鼠 / 數字九宮格 / 觸控拖曳 / 視角搖桿 / 陀螺儀 / 觀戰自由視角)
// 一律經 `game.js _applyLook(dYaw, dPitch)` 套用,反轉只准住這裡。
// 本檔零 import(同 rng.js / visualPrefs.js):離線稽核要能直接執行它驗預設值。

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
  try { raw = JSON.parse(localStorage.getItem(KEY) || '{}'); } catch { /* 私密模式 / 壞字串 */ }
  for (const k in LOOK_PREFS) {
    const v = raw && typeof raw === 'object' ? raw[k] : undefined;
    _vals[k] = v === undefined ? LOOK_PREFS[k].def : clampBool(v, LOOK_PREFS[k].def);
  }
}

/** 目前值 */
export function lookPref(k) {
  return k in _vals ? _vals[k] : (LOOK_PREFS[k]?.def ?? false);
}

/** 整份目前值(回傳新物件,MUST NOT 就地改) */
export function lookPrefs() {
  return { ..._vals };
}

/** 寫入一個開關(持久化 + 廣播)。回傳寫入後的值 */
export function setLookPref(k, v) {
  if (!(k in LOOK_PREFS)) return false;
  const nv = clampBool(v, LOOK_PREFS[k].def);
  if (nv === _vals[k]) return nv;
  _vals[k] = nv;
  try { localStorage.setItem(KEY, JSON.stringify(_vals)); } catch { /* 私密模式忽略 */ }
  _emit();
  return nv;
}

/** 全部回到預設(皆關 = 修正後的正向) */
export function resetLookPrefs() {
  let changed = false;
  for (const k in LOOK_PREFS) {
    if (_vals[k] !== LOOK_PREFS[k].def) { _vals[k] = LOOK_PREFS[k].def; changed = true; }
  }
  if (!changed) return;
  try { localStorage.setItem(KEY, JSON.stringify(_vals)); } catch { /* 私密模式忽略 */ }
  _emit();
}

/** 訂閱變更;回傳解訂閱函式 */
export function onLookPrefChange(fn) {
  _subs.add(fn);
  return () => _subs.delete(fn);
}

function _emit() {
  for (const fn of [..._subs]) {
    try { fn(_vals); } catch { /* 消費端自己的問題,不阻斷廣播 */ }
  }
}
