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
// ── 三層狀態,別搞混(2026-07-31 使用者定案「操作方式應該由房主選擇」)──────
//   `pref`(我的預設)  = 自己開房時整房沿用的那一個;記在 localStorage,房主在戰區畫面
//                        改選時一併更新(下次開房沿用)。**它不是生效值**。
//   `room`(戰區定案)  = **房主選定、伺服器廣播、整房一致**;在戰區內時蓋過 pref。
//                        null = 現在不在任何戰區(大廳)⇒ 生效值退回 pref。
//   `scheme`(目前操控)= 真正生效的那一套(kbm/pad),選擇**併入設定頁**。限定時恆等於
//                        生效模式;不限定時預設 = 裝置判定 `deviceScheme()`,玩家改過就記住。
//   ⇒ 生效模式 `ctrlMode()` = `room ?? pref`,消費端(mobile/game/main)一律只問這一支。
//   ⇒ 「遊戲中不可變更」不是另寫一道遊戲內閘門,而是 `setCtrlScheme` 對非 any 一律拒絕;
//      「其他人不能改整房的操作方式」也不是 UI 端判一次,而是根本沒有第二條寫入 `_room` 的路
//      —— 唯一入口 `setRoomCtrlMode()` 吃的是伺服器廣播值(房主的選擇經 `setRoomConfig` 上行)。
//
// 解析順序(pref):網址參數 `?ctrl=` →(相容)`?touch=` → localStorage 記憶 →(相容)舊鍵 → any。
// 本檔 MUST NOT import 任何 three.js / DOM 以外的東西:離線稽核 `tools/audit_ctrl_mode.mjs`
// 直接 import 真品做行為直測(比照 netmode.js),多一個 import 就跑不起來。

export const CTRL_MODES = {
  any: {
    key: 'any', icon: '◈', label: '不限定',
    hint: '全房各自依裝置判定,戰鬥中也能隨時在設定頁切換鍵鼠 ⇄ 搖桿。',
  },
  kbm: {
    key: 'kbm', icon: '⌨', label: '限定滑鼠鍵盤',
    hint: '全房鎖死鍵盤滑鼠,虛擬搖桿不會出現。',
  },
  pad: {
    key: 'pad', icon: '🕹', label: '限定搖桿',
    hint: '全房鎖死搖桿或虛擬搖桿,桌機也會長出虛擬搖桿。',
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

/** 視角模式:第三人稱(預設) / 第一人稱 */
export const VIEW_MODES = {
  fpv: { key: 'fpv', icon: '🎯', label: '第一人稱', hint: '座艙第一人稱視角，臨場感強，準星與槍口一致。' },
  tps: { key: 'tps', icon: '🤖', label: '第三人稱', hint: '偏肩後方第三人稱視角，機體完整可見且不佔準星；WASD 依鏡頭水平方向移動。' },
};
export const VIEW_MODE_KEYS = ['fpv', 'tps'];
export const DEFAULT_VIEW_MODE = 'tps';

const MODE_KEY = 'svs_ctrl_mode';    // 'any' | 'kbm' | 'pad'
const PICK_KEY = 'svs_ctrl_pick';    // 'kbm' | 'pad'(不限定時玩家挑過的那一套)
const VIEW_KEY = 'svs_view_mode';    // 'fpv' | 'tps'(視角模式)
// 舊鍵(2026-07-31 前的「觸控版 強制開/強制關」):'1' → pad、'0' → kbm。只讀不寫,遷移用。
const LEGACY_KEY = 'svs_touchui';

/** localStorage 在無痕/檔案協定下可能整支拋例外 —— 操作方式不該因此開不了遊戲(比照 netmode.js)*/
function ls(fn, fallback = null) {
  try { return fn(window.localStorage); } catch { return fallback; }
}

let _viewMode = null;
const _viewSubs = new Set();

/** 讀取目前視角模式(單一真相:localStorage svs_view_mode,預設 tps)*/
export function viewMode() {
  if (_viewMode) return _viewMode;
  const saved = ls((s) => s.getItem(VIEW_KEY));
  _viewMode = VIEW_MODES[saved] ? saved : DEFAULT_VIEW_MODE;
  return _viewMode;
}

/** 設定視角模式(fpv / tps),持久化並發送通知 */
export function setViewMode(v) {
  if (!VIEW_MODES[v]) return false;
  if (viewMode() === v) return true;
  _viewMode = v;
  ls((s) => s.setItem(VIEW_KEY, v));
  for (const fn of [..._viewSubs]) {
    try { fn(v); } catch { /* 降級,不例外 */ }
  }
  return true;
}

/** 訂閱視角模式變更;回傳解除訂閱函式 */
export function onViewModeChange(fn) {
  _viewSubs.add(fn);
  return () => _viewSubs.delete(fn);
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

let _pref = null;      // 我的預設操作方式(any/kbm/pad);null = 尚未定案
let _pick = null;      // 不限定時玩家挑過的那一套(kbm/pad);null = 還沒挑過 ⇒ 用裝置判定
let _room = null;      // 戰區定案(房主選定、伺服器廣播);null = 不在戰區
const _subs = new Set();

/** 我的預設操作方式:自己開房時整房沿用(首次呼叫時依解析順序定案並寫回記憶)*/
export function ctrlPref() {
  if (_pref) return _pref;
  const u = urlMode();
  if (u) { _pref = u; ls((s) => s.setItem(MODE_KEY, u)); return _pref; }
  const saved = ls((s) => s.getItem(MODE_KEY));
  if (CTRL_MODES[saved]) { _pref = saved; return _pref; }
  // 舊版「觸控版 強制開/強制關」遷移:一次性換算成限定模式(讀不到就是不限定)
  const legacy = ls((s) => s.getItem(LEGACY_KEY));
  _pref = legacy === '1' ? 'pad' : legacy === '0' ? 'kbm' : DEFAULT_CTRL_MODE;
  return _pref;
}

/**
 * 記住「我的預設操作方式」(房主在戰區畫面改選時一併呼叫 ⇒ 下次開房沿用)。
 * 這 **不是** 整房生效值:在戰區內時生效的是房主定案 `_room`,所以本函式不需要鎖 ——
 * 房主的選擇要真的生效,一律得經伺服器 `setRoomConfig` 廣播回來(單一寫入路徑)。
 */
export function setCtrlPref(m) {
  if (!CTRL_MODES[m]) return false;
  if (ctrlPref() === m) return true;
  const before = ctrlMode();
  _pref = m;
  ls((s) => s.setItem(MODE_KEY, m));
  if (ctrlMode() !== before) _emit();   // 在戰區內時房主定案蓋過預設 ⇒ 生效值沒變就不驚動消費端
  return true;
}

/**
 * **生效的操作方式**(消費端只准問這一支):在戰區內 = 房主定案,大廳 = 我的預設。
 * 兩層合一只有這一處,MUST NOT 在別處自己寫 `room || pref`(第二份合流 = 兩邊會漂)。
 */
export function ctrlMode() { return _room || ctrlPref(); }

/** 戰區定案(房主選的那一個);null = 現在不在任何戰區 */
export function roomCtrlMode() { return _room; }

/**
 * 套用戰區定案。**唯一寫入路徑 = 伺服器廣播**(`sync` 的 `lobby.config.ctrl`),
 * 離開戰區回大廳時以 `null` 解除。房主自己的選擇也 MUST 繞這一圈回來 ——
 * 客戶端先斬後奏會讓房主看到的版型與其他人不同步(且違反「伺服器唯一真相」)。
 */
export function setRoomCtrlMode(m) {
  const next = m == null ? null : (CTRL_MODES[m] ? m : null);
  if (_room === next) return false;
  const before = ctrlMode(), wasLocked = _room !== null;
  _room = next;
  // 生效模式或「還能不能自己改」任一項變了都要發 —— UI 的停用態與提示吃的是 ctrlLocked()
  if (ctrlMode() !== before || wasLocked !== (_room !== null)) _emit();
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
 * 切換目前操控(戰鬥中也可以,選擇併入設定頁)。**只有「不限定」才受理** ——
 * 這就是「遊戲中不可變更(除非戰區選不限定)」的唯一落點。回傳是否真的變更。
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

/**
 * 操作方式現在是不是「別人定的」= 已在戰區內(房主定案生效中)。
 * 鎖的是**整房的操作方式**;不限定時的「目前操控」仍可隨時切換(見 setCtrlScheme)。
 */
export function ctrlLocked() { return _room !== null; }

/** 訂閱變更(UI 同步 / 戰場輸入層重建);回傳解除訂閱函式 */
export function onCtrlChange(fn) {
  _subs.add(fn);
  return () => _subs.delete(fn);
}

function _emit() {
  const info = { mode: ctrlMode(), scheme: ctrlScheme(), locked: ctrlLocked(), room: _room };
  for (const fn of [..._subs]) {
    try { fn(info); } catch { /* 單一訂閱者出錯不該拖垮其他人(降級,不例外)*/ }
  }
}

/** 自我診斷用的一行說明(大廳「手機操控」面板逐項顯示)*/
export function ctrlModeText() {
  const m = ctrlMode();
  return `${CTRL_MODES[m].label} ・ 目前 ${CTRL_SCHEMES[ctrlScheme()].label}`
    + (_room ? '(戰區定案)' : '(我的預設)');
}

/**
 * 「本裝置與生效的操作方式對不對盤」—— 房主限定鍵鼠、隊友卻是手機(反之亦然)時,
 * UI MUST 講清楚(寧可醜話說在前面,也不要玩家進了戰場才發現沒有搖桿)。
 * 回傳警告字串或 null。
 */
export function ctrlMismatchText() {
  const m = ctrlMode();
  if (m === 'any' || m === deviceScheme()) return null;
  return m === 'kbm'
    ? '⚠ 本戰區限定滑鼠鍵盤,但你的裝置判定為虛擬搖桿 —— 建議外接鍵鼠,或請房主改選「不限定」。'
    : '⚠ 本戰區限定搖桿,你的畫面會長出虛擬搖桿(桌機也一樣)。';
}
