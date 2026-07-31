// ============ 操作方式(control scheme)— 輸入裝置的唯一真相縫 ============
// 【單一真相縫】「現在該用哪一套操控」只准問這一支。mobile.js / game.js / main.js / help.js
// **MUST NOT** 各自去看 `navigator.maxTouchPoints`、`matchMedia('(pointer: coarse)')` 或
// localStorage 的覆寫旗標 —— 那就變成第二份裝置判定,加第三種輸入裝置時一定漏改。
//
// ── 三個選項(使用者定案 2026-07-31)────────────────────────────────
//   ◈ any 不限定(**預設**):目前操控依裝置判定,**遊戲中可隨時切換**。
//   ⌨ kbm 限定滑鼠鍵盤    :鎖死鍵鼠,虛擬搖桿不出現。
//   🕹 pad 限定搖桿        :鎖死虛擬搖桿(配置照實體手把),桌機也照樣長出搖桿。
//
// ── 兩層狀態,別搞混 ────────────────────────────────────────────
//   `mode`(限定與否)= 玩家在**加入房間之前**選的那一個,`ctrlLocked()` 為真時 MUST NOT 再變更。
//   `scheme`(目前操控 kbm/pad)= 真正生效的那一套。限定時恆等於 mode;不限定時
//   預設 = 裝置判定 `deviceScheme()`,玩家改過就記住(這是「不限定 ⇒ 遊戲中可變更」的落點)。
//   ⇒ 「遊戲中不可變更」不是另寫一道遊戲內閘門,而是 `setCtrlScheme` 對非 any 一律拒絕:
//      鎖的是**限定模式本身**,不是某個畫面。MUST NOT 在 UI 端另判一次(兩份一定會漂)。
//
// 解析順序(mode):網址參數 `?ctrl=` →(相容)`?touch=` → localStorage 記憶 →(相容)舊鍵 → any。
// 本檔 MUST NOT import 任何 three.js / DOM 以外的東西:離線稽核 `tools/audit_ctrl_mode.mjs`
// 直接 import 真品做行為直測(比照 netmode.js),多一個 import 就跑不起來。

export const CTRL_MODES = {
  any: {
    key: 'any', icon: '◈', label: '不限定',
    hint: '目前操控依裝置判定,戰鬥中也能隨時切換鍵鼠 ⇄ 搖桿。',
  },
  kbm: {
    key: 'kbm', icon: '⌨', label: '限定滑鼠鍵盤',
    hint: '鎖死鍵盤滑鼠,虛擬搖桿不會出現。加入房間後不可變更。',
  },
  pad: {
    key: 'pad', icon: '🕹', label: '限定搖桿',
    hint: '鎖死搖桿或虛擬搖桿,桌機也會長出虛擬搖桿。加入房間後不可變更。',
  },
};
export const CTRL_MODE_KEYS = ['any', 'kbm', 'pad'];
export const DEFAULT_CTRL_MODE = 'any';

/** 實際生效的兩套操控(`ctrlScheme()` 的值域;不限定時由玩家或裝置判定挑一個)*/
export const CTRL_SCHEMES = {
  kbm: { key: 'kbm', icon: '⌨', label: '滑鼠鍵盤' },
  pad: { key: 'pad', icon: '🕹', label: '虛擬搖桿' },
};
export const CTRL_SCHEME_KEYS = ['kbm', 'pad'];

const MODE_KEY = 'svs_ctrl_mode';    // 'any' | 'kbm' | 'pad'
const PICK_KEY = 'svs_ctrl_pick';    // 'kbm' | 'pad'(不限定時玩家挑過的那一套)
// 舊鍵(2026-07-31 前的「觸控版 強制開/強制關」):'1' → pad、'0' → kbm。只讀不寫,遷移用。
const LEGACY_KEY = 'svs_touchui';

/** localStorage 在無痕/檔案協定下可能整支拋例外 —— 操作方式不該因此開不了遊戲(比照 netmode.js)*/
function ls(fn, fallback = null) {
  try { return fn(window.localStorage); } catch { return fallback; }
}

/**
 * 有觸控硬體(不代表要用搖桿版:二合一筆電也有觸控螢幕)。
 * 大廳據此決定要不要顯示「📱 手機操控」入口。
 */
export function touchCapable() {
  if (typeof navigator === 'undefined') return false;
  return (navigator.maxTouchPoints || 0) > 0 || 'ontouchstart' in window;
}

/**
 * 裝置判定:這台機器**預設**該用哪一套(= 不限定時的預設值)。
 * 觸控硬體 +(無精準指標且無 hover,或短邊 ≤ 820px)⇒ 虛擬搖桿。
 * 這是全 repo **唯一**一份裝置判定,MUST NOT 在別處重寫(見檔頭)。
 */
export function deviceScheme() {
  if (!touchCapable()) return 'kbm';
  const mm = typeof window !== 'undefined' && window.matchMedia;
  const coarse = mm ? mm('(pointer: coarse)').matches : true;
  const noHover = mm ? !mm('(any-hover: hover)').matches : true;
  const scr = (typeof window !== 'undefined' && window.screen) || {};
  const small = Math.min(scr.width || 9999, scr.height || 9999) <= 820;
  return (coarse && noHover) || small ? 'pad' : 'kbm';
}

/**
 * 網址參數:`?ctrl=any|kbm|pad`;相容舊的 `?touch=1|0|auto`。
 * 手機上沒有 devtools ⇒ localStorage 的逃生門等於不存在,網址參數才是玩家真的能用的那一條。
 * 讀到就順手寫進 localStorage,之後同一台裝置不必再帶參數。
 */
function urlMode() {
  if (typeof location === 'undefined') return null;
  const q = new URLSearchParams(location.search);
  const c = (q.get('ctrl') || '').toLowerCase();
  if (CTRL_MODES[c]) return c;
  const t = (q.get('touch') || '').toLowerCase();
  if (t === '1' || t === 'on') return 'pad';
  if (t === '0' || t === 'off') return 'kbm';
  if (t === 'auto') return 'any';
  return null;
}

let _mode = null;      // 限定與否(any/kbm/pad);null = 尚未定案
let _pick = null;      // 不限定時玩家挑過的那一套(kbm/pad);null = 還沒挑過 ⇒ 用裝置判定
let _locked = false;   // 已加入房間 ⇒ mode MUST NOT 再變更
const _subs = new Set();

/** 目前的限定模式(首次呼叫時依解析順序定案並寫回記憶)*/
export function ctrlMode() {
  if (_mode) return _mode;
  const u = urlMode();
  if (u) { _mode = u; ls((s) => s.setItem(MODE_KEY, u)); return _mode; }
  const saved = ls((s) => s.getItem(MODE_KEY));
  if (CTRL_MODES[saved]) { _mode = saved; return _mode; }
  // 舊版「觸控版 強制開/強制關」遷移:一次性換算成限定模式(讀不到就是不限定)
  const legacy = ls((s) => s.getItem(LEGACY_KEY));
  _mode = legacy === '1' ? 'pad' : legacy === '0' ? 'kbm' : DEFAULT_CTRL_MODE;
  return _mode;
}

/**
 * 變更限定模式。**加入房間後一律拒絕**(使用者定案:操作方式在加入房間之前就要先選擇)。
 * 回傳是否真的變更 —— 呼叫端據此把 UI 扳回去,MUST NOT 自己再判一次鎖定狀態。
 */
export function setCtrlMode(m) {
  if (!CTRL_MODES[m] || _locked) return false;
  if (ctrlMode() === m) return true;
  _mode = m;
  ls((s) => s.setItem(MODE_KEY, m));
  _emit();
  return true;
}

/** 目前實際生效的那一套操控:限定時 = 限定值;不限定時 = 玩家挑過的,沒挑過就用裝置判定 */
export function ctrlScheme() {
  const m = ctrlMode();
  if (m !== 'any') return m;
  if (!_pick) {
    const saved = ls((s) => s.getItem(PICK_KEY));
    _pick = CTRL_SCHEMES[saved] ? saved : deviceScheme();
  }
  return _pick;
}

/**
 * 切換目前操控(戰鬥中也可以)。**只有「不限定」才受理** —— 這就是
 * 「遊戲中不可變更(除非選不限定)」的唯一落點。回傳是否真的變更。
 */
export function setCtrlScheme(s) {
  if (!CTRL_SCHEMES[s] || ctrlMode() !== 'any') return false;
  if (ctrlScheme() === s) return true;
  _pick = s;
  ls((st) => st.setItem(PICK_KEY, s));
  _emit();
  return true;
}

/** 目前是不是虛擬搖桿版(mobile.js `isTouchUI()` 就是轉呼這一支)*/
export function usePad() { return ctrlScheme() === 'pad'; }

/** 現在還能不能改限定模式(= 尚未加入房間)*/
export function ctrlLocked() { return _locked; }

/**
 * 進/離房間時由 main.js `show()` 呼叫:進了房間(含載入/戰鬥/結算)就鎖上,回大廳解鎖。
 * 鎖定只影響**限定模式**;不限定時的「目前操控」仍可隨時切換(見 setCtrlScheme)。
 */
export function setCtrlLock(on) {
  if (_locked === !!on) return;
  _locked = !!on;
  _emit();
}

/** 訂閱變更(UI 同步 / 戰場輸入層重建);回傳解除訂閱函式 */
export function onCtrlChange(fn) {
  _subs.add(fn);
  return () => _subs.delete(fn);
}

function _emit() {
  const info = { mode: ctrlMode(), scheme: ctrlScheme(), locked: _locked };
  for (const fn of [..._subs]) {
    try { fn(info); } catch { /* 單一訂閱者出錯不該拖垮其他人(降級,不例外)*/ }
  }
}

/** 自我診斷用的一行說明(大廳「手機操控」面板逐項顯示)*/
export function ctrlModeText() {
  const m = ctrlMode();
  return `${CTRL_MODES[m].label} ・ 目前 ${CTRL_SCHEMES[ctrlScheme()].label}${_locked ? ' ・ 已鎖定' : ''}`;
}
