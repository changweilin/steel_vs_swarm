// ============ 手機 / 平板:觸控 + 陀螺儀操控與直式/橫式版型(客戶端專用)============
// 定位:**輸入轉接層**,不是第二套操控。本檔只把觸控與陀螺儀轉成「既有的輸入狀態」:
//   移動 → BattleClient._moveAxis() 讀的 this.touch.axis(與鍵盤 WASD 共用同一個推導縫)
//   視角 → BattleClient._applyLook(dYaw, dPitch)(與滑鼠 mousemove 共用同一個套用縫)
//   動作 → BattleClient._cmd(act, down)(與鍵盤/滑鼠共用同一個派發縫)
// 因此本檔 MUST NOT 直接改 yaw/pitch/keys/firing,也 MUST NOT 自行結算任何權威狀態
// (伺服器權威見 /CLAUDE.md §1);新增按鈕只准新增 act 名稱,不准在此另寫一份操作邏輯。
//
// 版型:body 上掛三個 class 供 CSS 特化 —— `touch-ui`(觸控版)、`ori-portrait`/`ori-landscape`
// (直式/橫式)、`touch-lefty`(左手模式,左右鏡像)。版型細節全在 css/style.css,本檔只掛 class。
// 視野角度 MUST NOT 因直/橫式而改(全機種 fov 68,見 /CLAUDE.md A8):直式只是水平視野較窄,
// 故直式首次進場提示「建議橫向持握」,而不是偷偷改 FOV。
import * as THREE from 'three';

/* ---------------- 裝置判定 ---------------- */

const OVERRIDE_KEY = 'svs_touchui';   // '1' 強制觸控版 / '0' 強制桌機版 / 未設 = 自動
const SETTINGS_KEY = 'svs_touch';

/** 有觸控硬體(不代表要用觸控版:二合一筆電也有觸控螢幕)。大廳據此決定是否顯示「手機操控」入口 */
export function touchCapable() {
  return (navigator.maxTouchPoints || 0) > 0 || 'ontouchstart' in window;
}

/**
 * 強制覆寫的來源:**網址參數 `?touch=1` / `?touch=0` 優先**,其次 localStorage。
 * 手機上沒有 devtools ⇒ 只能設 localStorage 的覆寫等於不存在;網址參數才是玩家真的能用的逃生門。
 * 讀到參數就順手寫進 localStorage,之後同一台裝置不必再帶參數。
 */
function overrideFlag() {
  let v = null;
  try {
    const q = new URLSearchParams(location.search).get('touch');
    if (q === '1' || q === 'on') v = '1';
    else if (q === '0' || q === 'off') v = '0';
    else if (q === 'auto') v = '';
    if (v !== null) {
      if (v === '') localStorage.removeItem(OVERRIDE_KEY);
      else localStorage.setItem(OVERRIDE_KEY, v);
      return v || null;
    }
  } catch { /* 私密模式忽略 */ }
  try { return localStorage.getItem(OVERRIDE_KEY); } catch { return null; }
}

/** 觸控版強制開關(設定面板用;寫入後需重新載入才會重建輸入層) */
export function setTouchUIOverride(v) {
  try {
    if (v == null) localStorage.removeItem(OVERRIDE_KEY);
    else localStorage.setItem(OVERRIDE_KEY, v ? '1' : '0');
  } catch { /* 私密模式忽略 */ }
}
export function touchUIOverride() { return overrideFlag(); }

/**
 * 是否採用觸控版 UI:觸控硬體 + (無精準指標/無 hover,或短邊 ≤ 820px)。
 * 可用 `?touch=1` / `?touch=0`(或 localStorage `svs_touchui`)強制覆寫。
 */
export function isTouchUI() {
  const o = overrideFlag();
  if (o === '1') return true;
  if (o === '0') return false;
  if (!touchCapable()) return false;
  const mm = window.matchMedia;
  const coarse = mm ? mm('(pointer: coarse)').matches : true;
  const noHover = mm ? !mm('(any-hover: hover)').matches : true;
  const small = Math.min(window.screen?.width || 9999, window.screen?.height || 9999) <= 820;
  return (coarse && noHover) || small;
}

/**
 * 觸控/陀螺儀自我診斷:判定用到的每一項原始值 + 結論。
 * 大廳「手機操控」面板逐項顯示 —— 「沒反應」時要能一眼看出卡在哪一關,MUST NOT 只給一個布林。
 */
export function touchDiagnostics() {
  const mm = (q) => { try { return window.matchMedia(q).matches; } catch { return null; } };
  return [
    { k: '安全連線(陀螺儀必要)', v: window.isSecureContext, ok: !!window.isSecureContext,
      note: `${location.protocol}//${location.host}` },
    { k: '方向感測 API', v: !!window.DeviceOrientationEvent, ok: !!window.DeviceOrientationEvent,
      note: typeof window.DeviceOrientationEvent?.requestPermission === 'function' ? '需要授權(iOS)' : '免授權' },
    { k: '觸控硬體', v: `maxTouchPoints=${navigator.maxTouchPoints || 0}`, ok: touchCapable() },
    { k: '粗指標 pointer:coarse', v: mm('(pointer: coarse)'), ok: mm('(pointer: coarse)') === true },
    { k: '無 hover any-hover:none', v: mm('(any-hover: hover)') === false, ok: mm('(any-hover: hover)') === false },
    { k: '螢幕短邊 ≤ 820', v: `${window.screen?.width}×${window.screen?.height}`,
      ok: Math.min(window.screen?.width || 9999, window.screen?.height || 9999) <= 820 },
    { k: '強制覆寫', v: overrideFlag() === '1' ? '強制開' : overrideFlag() === '0' ? '強制關' : '自動', ok: true },
    { k: '結論:觸控版', v: isTouchUI(), ok: isTouchUI(),
      note: isTouchUI() ? '虛擬搖桿會在戰鬥中出現' : '可用網址加 ?touch=1 強制開啟' },
    { k: 'body class', v: [...document.body.classList].filter((c) => c.startsWith('touch') || c.startsWith('ori')).join(' ') || '(無)',
      ok: document.body.classList.contains('touch-ui') },
  ];
}

/* ---------------- 設定(持久化;陀螺儀/靈敏度/左手模式)---------------- */

// 靈敏度基準:touch 每像素轉多少弧度、gyro 1:1(1.0 = 手機轉幾度視角就轉幾度)。
// 這兩個係數是觸控手感的唯一真相,MUST NOT 在別處再乘一次。
export const LOOK = {
  TOUCH_RAD_PX: 0.0034,   // 拖曳視角:rad/px(比滑鼠 0.0023 大 —— 手指行程短)
  GYRO_BASE: 1.0,         // 陀螺儀增益基準(1 = 物理 1:1)
  GYRO_DEAD: 0.00035,     // 陀螺儀死區(rad/event):濾掉手持微顫
  GYRO_JUMP: 0.5,         // 單次事件超過此弧度視為姿態跳變(轉螢幕/失準)→ 重設基準不套用
  SPRINT_MAG: 0.92,       // 類比十字鍵推到此比例以上 = 衝刺(等同 Shift)
  STICK_DEAD: 0.16,       // 類比十字鍵死區(比例)
};

const clamp = (v, a, b) => Math.max(a, Math.min(b, Number.isFinite(+v) ? +v : a));

/**
 * 指標捕捉(拖出元件外仍收得到 move/up)。**MUST 包 try** ——
 * setPointerCapture 在「該 pointerId 已不是作用中指標」時會 throw,
 * 裸呼叫會把後面的狀態機(送出 _cmd、preventDefault)整段中斷:
 * 症狀是按住鈕只收到放開、收不到按下。捕捉失敗最多只是拖出元件外會斷,不該連按都按不了。
 */
function capture(el, id) {
  try { el.setPointerCapture?.(id); } catch { /* 該指標已失效 → 不捕捉,事件照走 */ }
}

export const TOUCH = {
  gyro: false,        // 陀螺儀輔助瞄準
  gyroSens: 1.0,      // 陀螺儀靈敏度倍率(0.4~2.5)
  gyroInvert: false,  // 陀螺儀垂直反轉
  lookSens: 1.0,      // 拖曳視角靈敏度倍率(0.4~2.5)
  lefty: false,       // 左手模式(十字鍵與 ABXY 左右鏡像)
  haptic: true,       // 觸覺回饋(navigator.vibrate,不支援即無感)
};

function loadTouchPrefs() {
  try {
    const j = JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}');
    for (const k of Object.keys(TOUCH)) if (j[k] !== undefined) TOUCH[k] = j[k];
  } catch { /* 壞資料忽略,用預設 */ }
  TOUCH.gyroSens = clamp(TOUCH.gyroSens, 0.4, 2.5);
  TOUCH.lookSens = clamp(TOUCH.lookSens, 0.4, 2.5);
}
export function saveTouchPrefs() {
  try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(TOUCH)); } catch { /* 私密模式忽略 */ }
}
loadTouchPrefs();

/* ---------------- 版型:觸控版 class + 直式/橫式追蹤 ---------------- */

/** 螢幕旋轉角(度):陀螺儀軸向補正與版型判定共用 */
function screenAngle() {
  const a = window.screen?.orientation?.angle;
  if (Number.isFinite(a)) return a;
  return Number.isFinite(window.orientation) ? window.orientation : 0;
}

let _oriRaf = 0;
/** 直式/橫式判定並掛 class;版型改變時補送一次 resize(讓 BattleClient._onResize 重算 aspect)*/
function syncOrientation() {
  const portrait = window.innerHeight >= window.innerWidth;
  const b = document.body;
  const was = b.classList.contains('ori-portrait');
  b.classList.toggle('ori-portrait', portrait);
  b.classList.toggle('ori-landscape', !portrait);
  if (was !== portrait) {
    // iOS 轉向後 innerWidth/Height 要一兩幀才穩:延後補送 resize,避免畫布拉伸
    cancelAnimationFrame(_oriRaf);
    _oriRaf = requestAnimationFrame(() => setTimeout(() => window.dispatchEvent(new Event('resize')), 120));
  }
}

let _installed = false;
/**
 * 安裝觸控版版型(main.js 啟動時呼叫一次)。回傳是否為觸控版。
 * 只掛 body class 與監聽轉向 —— 戰場的觸控輸入由 TouchControls 負責(進戰場才建)。
 */
export function installTouchUI() {
  const on = isTouchUI();
  document.body.classList.toggle('touch-ui', on);
  document.body.classList.toggle('touch-lefty', on && TOUCH.lefty);
  syncOrientation();
  if (!_installed) {
    _installed = true;
    window.addEventListener('resize', syncOrientation);
    window.addEventListener('orientationchange', syncOrientation);
    window.screen?.orientation?.addEventListener?.('change', syncOrientation);
  }
  return on;
}

/** 左手模式即時套用(設定頁用;鏡像純 CSS,十字鍵位置由 CSS 定位、圓心每次落指重算 → 無需重建) */
export function applyLefty(on) {
  TOUCH.lefty = !!on;
  document.body.classList.toggle('touch-lefty', document.body.classList.contains('touch-ui') && TOUCH.lefty);
  saveTouchPrefs();
}

/** 全螢幕切換(手機瀏覽器工具列會吃掉一大截畫面;附帶嘗試鎖橫向,不支援即靜默) */
export async function toggleFullscreen() {
  try {
    if (!document.fullscreenElement) {
      await (document.documentElement.requestFullscreen?.({ navigationUI: 'hide' })
        ?? document.documentElement.webkitRequestFullscreen?.());
      try { await window.screen?.orientation?.lock?.('landscape'); } catch { /* iOS 不支援 */ }
    } else {
      try { window.screen?.orientation?.unlock?.(); } catch { /* 同上 */ }
      await (document.exitFullscreen?.() ?? document.webkitExitFullscreen?.());
    }
  } catch { /* 使用者拒絕或瀏覽器不支援 → 維持原狀 */ }
  return !!document.fullscreenElement;
}

/* ---------------- 陀螺儀 ---------------- */

const ZEE = new THREE.Vector3(0, 0, 1);
// deviceorientation 的 (alpha,beta,gamma) → 相機四元數:先 YXZ 歐拉,再轉正「螢幕朝上時看向地平線」
const Q_UP = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), -Math.PI / 2);

/**
 * 陀螺儀能不能用的事前檢查(**這是「完全沒反應」的第一嫌疑犯**)。
 * 瀏覽器只在 **secure context**(https / localhost)才派送 deviceorientation:
 * 用 `http://<區網 IP>:8620` 從手機開,事件**靜默不派送** —— 沒有錯誤、沒有權限提示、沒有 log,
 * 就是不動。伺服器請改用 `npm run mobile`(= `--https`,自簽憑證,見 server.js ensureCert)。
 * 回傳 null = 可以試;字串 = 不可能成功的原因(直接顯示給玩家,MUST NOT 靜默失敗)。
 */
export function gyroBlockedReason() {
  if (!window.isSecureContext) {
    return `陀螺儀需要 HTTPS 才會有感測器資料(目前是 ${location.protocol}//${location.hostname})`
      + ' —— 伺服器請改用 npm run mobile(= --https)';
  }
  if (!window.DeviceOrientationEvent) return '此瀏覽器不支援 DeviceOrientationEvent';
  return null;
}

/**
 * 陀螺儀輔助瞄準(相對模式)—— 轉動手機 = 轉動準星朝向。
 * 絕對映射(手機朝哪、準星就朝哪)在 FPS 不可用 —— 要轉身 180° 就得整個人轉半圈;
 * 故取**每次事件的姿態差**疊加到視角上(= 主機遊戲的陀螺輔助),與拖曳視角可同時作用、互不重設。
 * 螢幕旋轉角納入四元數補正 ⇒ 直式/橫式(含反向橫式)軸向自動正確,MUST NOT 改成手動換軸。
 *
 * 事件來源兩種都聽:`deviceorientation`(相對,較普及)與 `deviceorientationabsolute`
 * (Chrome/Android 的絕對版)。**先到者贏**並記在 `source`,之後只吃同一種 ——
 * 兩種混用會讓姿態差在不同基準間跳。
 */
class Gyro {
  constructor(onLook, onFail) {
    this.onLook = onLook;
    this.onFail = onFail;               // (reason) => void:確定收不到資料時回報(UI 要把開關扳回關閉)
    this.active = false;
    this.granted = false;
    this.source = null;                 // 實際在用的事件名(診斷用)
    this.events = 0;                    // 收到的事件數(診斷用:0 = 感測器沒在送)
    this.usable = 0;                    // 其中含有效角度的筆數
    this._q = new THREE.Quaternion();
    this._q0 = new THREE.Quaternion();
    this._e = new THREE.Euler();
    this._f = new THREE.Vector3();
    this._have = false;
    this._yaw = 0; this._pitch = 0;
    this.last = null;                   // 最後一筆原始 {alpha,beta,gamma}(診斷/試玩讀值用)
    this.accYaw = 0; this.accPitch = 0; // 累計輸出角度(度):轉手機時這兩個數字會跑
    this._onOri = (ev) => this._read(ev, 'deviceorientation');
    this._onAbs = (ev) => this._read(ev, 'deviceorientationabsolute');
    this._reset = () => { this._have = false; };   // 轉螢幕 → 丟掉基準,下一個事件重新起算
  }

  /** iOS 13+ 需在使用者手勢中要求權限;其他平台直接可用 */
  async request() {
    if (gyroBlockedReason()) return false;
    const D = window.DeviceOrientationEvent;
    if (typeof D.requestPermission === 'function') {
      try { this.granted = (await D.requestPermission()) === 'granted'; } catch { this.granted = false; }
    } else this.granted = true;
    return this.granted;
  }

  start() {
    if (this.active) return;
    this.active = true;
    this._have = false;
    this.source = null; this.events = 0; this.usable = 0;
    this.accYaw = 0; this.accPitch = 0; this.last = null;
    window.addEventListener('deviceorientation', this._onOri);
    window.addEventListener('deviceorientationabsolute', this._onAbs);
    window.addEventListener('orientationchange', this._reset);
    window.screen?.orientation?.addEventListener?.('change', this._reset);
    // 看門狗:感測器不作動時瀏覽器不會報錯,只會什麼都不發生 ——
    // 沒有這條,玩家看到的就是「開關是綠的但完全沒反應」。
    clearTimeout(this._wdT);
    this._wdT = setTimeout(() => {
      if (!this.active) return;
      if (this.usable > 0) return;
      const why = this.events === 0
        ? '裝置沒有送出方向感測資料(可能無陀螺儀,或系統/瀏覽器關閉了動作感測權限)'
        : '方向感測資料無效(裝置回報的角度為空值)';
      this.onFail?.(why);
    }, 1800);
  }

  stop() {
    clearTimeout(this._wdT);
    if (!this.active) return;
    this.active = false;
    this._have = false;
    window.removeEventListener('deviceorientation', this._onOri);
    window.removeEventListener('deviceorientationabsolute', this._onAbs);
    window.removeEventListener('orientationchange', this._reset);
    window.screen?.orientation?.removeEventListener?.('change', this._reset);
  }

  /** 目前狀態一句話(設定頁提示 + 除錯用) */
  status() {
    if (!this.active) return gyroBlockedReason() || '未啟用';
    if (this.usable > 0) return `運作中(${this.source},已收 ${this.events} 筆)`;
    return this.events ? '收到事件但角度為空值' : '等待感測器資料…';
  }

  _read(ev, src) {
    if (!this.active) return;
    if (this.source && this.source !== src) return;   // 兩種事件都在送 → 只認先到的那種
    this.events++;
    // beta/gamma 是傾角(必要);alpha 是水平朝向,少數裝置無磁力計會給 null ——
    // 這時**不能整筆丟掉**(那就等於陀螺儀全滅),alpha 當 0 仍可靠 beta/gamma 取得俯仰與側傾。
    if (ev.beta == null || ev.gamma == null) return;
    if (!this.source) this.source = src;
    this.usable++;
    this.last = { alpha: ev.alpha, beta: ev.beta, gamma: ev.gamma };
    const d2r = Math.PI / 180;
    this._e.set(ev.beta * d2r, (ev.alpha ?? 0) * d2r, -ev.gamma * d2r, 'YXZ');
    this._q.setFromEuler(this._e);
    this._q.multiply(Q_UP);
    this._q.multiply(this._q0.setFromAxisAngle(ZEE, -screenAngle() * d2r));
    // 相機預設看 −z:取前向量還原成本遊戲的 yaw/pitch(fwd = (−sin yaw, sin pitch, −cos yaw))
    const f = this._f.set(0, 0, -1).applyQuaternion(this._q);
    const yaw = Math.atan2(-f.x, -f.z);
    const pitch = Math.asin(clamp(f.y, -1, 1));
    if (!this._have) { this._have = true; this._yaw = yaw; this._pitch = pitch; return; }
    let dy = yaw - this._yaw;
    if (dy > Math.PI) dy -= Math.PI * 2; else if (dy < -Math.PI) dy += Math.PI * 2;
    const dp = pitch - this._pitch;
    this._yaw = yaw; this._pitch = pitch;
    // 姿態跳變(轉螢幕/感測器失準):吃掉這一筆,只更新基準
    if (Math.abs(dy) > LOOK.GYRO_JUMP || Math.abs(dp) > LOOK.GYRO_JUMP) return;
    const g = LOOK.GYRO_BASE * TOUCH.gyroSens;
    const oy = Math.abs(dy) < LOOK.GYRO_DEAD ? 0 : dy * g;
    const op = Math.abs(dp) < LOOK.GYRO_DEAD ? 0 : dp * g * (TOUCH.gyroInvert ? -1 : 1);
    if (oy || op) {
      this.accYaw += oy * 180 / Math.PI;
      this.accPitch += op * 180 / Math.PI;
      this.onLook(oy, op);
    }
  }
}

/* ---------------- 現役實例 + 設定表(大廳面板與戰場設定頁共用)---------------- */

let _active = null;   // 目前生效的 TouchControls(戰場的或試玩的);設定面板據此把開關導到對的實例
/** 目前生效的虛擬搖桿實例(沒有就是 null) */
export function activeTouch() { return _active; }

/**
 * 觸控設定表 —— **設定 UI 的唯一真相**。大廳「手機操控」面板與戰場選單設定頁
 * 兩處都用同一份渲染(見 main.js renderTouchSettings),MUST NOT 各寫一份 DOM。
 */
export const TOUCH_SETTINGS = [
  { key: 'gyro', type: 'switch', label: '陀螺儀瞄準', hint: '轉動手機即轉動準星(與拖曳視角可同時使用)', status: true },
  { key: 'gyroSens', type: 'range', label: '陀螺靈敏度', min: 40, max: 250 },
  { key: 'gyroInvert', type: 'switch', label: '陀螺垂直反轉', hint: '抬起手機 = 向下看' },
  { key: 'lookSens', type: 'range', label: '拖曳靈敏度', min: 40, max: 250 },
  { key: 'lefty', type: 'switch', label: '左手模式', hint: '十字鍵與 ABXY 左右鏡像' },
  { key: 'haptic', type: 'switch', label: '觸覺回饋', hint: '按鈕震動(裝置不支援則無感)' },
];

/**
 * 陀螺儀開關唯一入口(大廳面板 / 戰場設定頁 / 搖桿上的「陀螺」鈕全走這裡)。
 * 有現役實例就交給它(權限、看門狗、鈕面同步都在那);沒有就只記偏好,進場再套用。
 * 回傳實際結果 —— **不可用時一定回 false**,呼叫端據此把開關扳回去。
 */
export async function setGyroPref(on) {
  if (_active) return _active.setGyro(on);
  if (on && gyroBlockedReason()) { TOUCH.gyro = false; saveTouchPrefs(); return false; }
  TOUCH.gyro = !!on;
  saveTouchPrefs();
  return TOUCH.gyro;
}

/** 陀螺儀狀態一句話(沒有現役實例時做靜態檢查) */
export function gyroStatusText() {
  if (_active) return _active.gyroStatus();
  return gyroBlockedReason() || (TOUCH.gyro ? '已記憶:進戰場自動啟用' : '未啟用');
}

/* ---------------- 設定 UI:唯一一份渲染器 + 同步器 ---------------- */
// 大廳「手機操控」面板與戰場選單設定頁掛不同的 mount,但 DOM 與事件只有這一份 ——
// MUST NOT 在 index.html 或 main.js 另寫一組觸控設定列(兩份一定會漂)。

const _mounts = [];
const _esc = (t) => String(t).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

const MODE_LABEL = { auto: '自動', on: '強制開', off: '強制關' };

/**
 * 把觸控設定列渲染進 mount(冪等:同一個 mount 只建一次)。
 * opts.onNotice(msg) —— 需要提示玩家時呼叫(main.js 傳 toast);不給就靜默。
 */
export function renderTouchSettings(mount, opts = {}) {
  if (!mount || mount.dataset.built) return;
  mount.dataset.built = '1';
  const notice = opts.onNotice || (() => {});
  const uid = (k) => `${mount.id}__${k}`;

  // 觸控版強制開關:手機沒有 devtools ⇒ 這是玩家唯一能自救的地方(另有網址 ?touch=1)
  const modeRow = document.createElement('div');
  modeRow.className = 'set-row';
  modeRow.innerHTML = '<span class="set-label">觸控版</span><span class="tset-seg">'
    + ['auto', 'on', 'off'].map((m) => `<button class="tset-segb" type="button" data-mode="${m}">${MODE_LABEL[m]}</button>`).join('')
    + '</span><span class="set-hint">切換後需重新載入頁面才會重建操控層(也可在網址加 ?touch=1)</span>';
  mount.appendChild(modeRow);
  for (const b of modeRow.querySelectorAll('.tset-segb')) {
    b.addEventListener('click', () => {
      setTouchUIOverride(b.dataset.mode === 'auto' ? null : b.dataset.mode === 'on');
      syncTouchSettings();
      notice('已變更觸控版設定 —— 請重新載入頁面套用', 5000);
    });
  }

  for (const d of TOUCH_SETTINGS) {
    const row = document.createElement('div');
    row.className = 'set-row';
    if (d.type === 'switch') {
      row.innerHTML = `<span class="set-label">${_esc(d.label)}</span>`
        + `<button class="switch" type="button" role="switch" aria-checked="false" id="${uid(d.key)}"`
        + ` aria-label="${_esc(d.label)}"><span></span></button>`
        + `<span class="set-hint">${_esc(d.hint || '')}`
        + `${d.status ? ' ・ 狀態:<b class="tset-stat"></b>' : ''}</span>`;
      row.querySelector('.switch').addEventListener('click', async () => {
        const el = document.getElementById(uid(d.key));
        const on = el.getAttribute('aria-checked') !== 'true';
        if (d.key === 'gyro') {
          const ok = await setGyroPref(on);
          if (on && !ok) notice(gyroBlockedReason() || gyroStatusText(), 6000);
        } else if (d.key === 'lefty') applyLefty(on);
        else { TOUCH[d.key] = on; saveTouchPrefs(); }
        syncTouchSettings();
      });
    } else {
      row.innerHTML = `<span class="set-label">${_esc(d.label)}</span>`
        + `<input class="set-slider" type="range" min="${d.min}" max="${d.max}" step="5" id="${uid(d.key)}"`
        + ` aria-label="${_esc(d.label)}">`
        + `<span class="set-val" id="${uid(d.key)}_v">100%</span>`;
      row.querySelector('input').addEventListener('input', (e) => {
        TOUCH[d.key] = Number(e.target.value) / 100;
        saveTouchPrefs();
        document.getElementById(`${uid(d.key)}_v`).textContent = `${e.target.value}%`;
      });
    }
    mount.appendChild(row);
  }
  _mounts.push(mount);
}

/** 把所有已渲染的觸控設定 UI 同步到目前(持久化的)狀態 + 陀螺儀即時狀態 */
export function syncTouchSettings() {
  const status = gyroStatusText();
  const mode = touchUIOverride() === '1' ? 'on' : touchUIOverride() === '0' ? 'off' : 'auto';
  for (const mount of _mounts) {
    for (const b of mount.querySelectorAll('.tset-segb')) b.classList.toggle('on', b.dataset.mode === mode);
    for (const d of TOUCH_SETTINGS) {
      const el = document.getElementById(`${mount.id}__${d.key}`);
      if (!el) continue;
      if (d.type === 'switch') el.setAttribute('aria-checked', TOUCH[d.key] ? 'true' : 'false');
      else {
        el.value = String(Math.round(TOUCH[d.key] * 100));
        const v = document.getElementById(`${mount.id}__${d.key}_v`);
        if (v) v.textContent = `${el.value}%`;
      }
    }
    for (const n of mount.querySelectorAll('.tset-stat')) n.textContent = status;
  }
}

/* ---------------- 觸控操控 ---------------- */

// B 鍵(空白鍵機動能力)逐機種鈕面字樣:與 help.js 的操作說明同義,鈕面寬度有限故取兩字。
// 變形機甲兩種型態共用 B(地面蓄力變形彈射 / 飛行中上升)⇒ 鈕面寫「躍/升」,細節看角色數據欄。
const MOBIL_LABEL = { drone: '上升', morph: '躍/升', mech: '跳躍', robot: '跳躍' };

/**
 * 戰場虛擬搖桿。由 BattleClient._initInput() 在觸控版時建立,dispose() 時銷毀。
 * DOM 掛點全部在 index.html 的 #touchLayer(靜態骨架 + data-act),本檔只綁事件:
 *   - #tlLook  :全畫面拖曳視角(壓在所有控件之下;控件自行吃掉事件)
 *   - #tlDpad  :虛擬**類比**十字鍵 —— 外觀十字、判定類比(圓心固定 = 鍵盤中心,偏移量 = 推杆量)
 *   - [data-act]:搖桿鈕(ABXY / L・ZL / R・ZR / HOME・⊟・◫ 與陀螺/全螢幕/左手)
 * 角色數據(.hud-self)與小地圖(#minimap)是純顯示,**MUST NOT** 被搖桿覆蓋(版型量測有斷言)。
 */
export class TouchControls {
  constructor(client) {
    this.client = client;
    this.axis = { f: 0, r: 0, mag: 0 };   // 移動輸入(_moveAxis 讀;鍵盤未按時才生效)
    this.layer = document.getElementById('touchLayer');
    this.lookPad = document.getElementById('tlLook');
    this.dpad = document.getElementById('tlDpad');
    this.knob = document.getElementById('tlKnob');
    this._lookId = null;
    this._lookX = 0; this._lookY = 0;
    this._padId = null;
    this._cx = 0; this._cy = 0; this._r = 70;
    this._held = new Map();   // pointerId → act(按住型搖桿鈕:A 射擊 / R 狙擊 / B 跳躍 / ZL 下降)
    this.gyro = new Gyro(
      (dy, dp) => this._gyroLook(dy, dp),
      (why) => this._gyroDead(why),
    );

    _active = this;
    if (this.layer) this.layer.hidden = false;
    this._bindLook();
    this._bindDpad();
    this._bindButtons();
    this._bindRotateHint();
    this.setKind(client.heroKind);
    if (TOUCH.gyro) this.setGyro(true, true);   // 記憶開啟:靜默續用(不可用時 onFail 會自行關掉)
    this._syncGyroBtn();
  }

  /* ---- 視角:拖曳 ---- */
  _bindLook() {
    if (!this.lookPad) return;
    this._onLookDown = (e) => {
      if (this._lookId !== null || this._blocked()) return;
      this._lookId = e.pointerId;
      this._lookX = e.clientX; this._lookY = e.clientY;
      capture(this.lookPad, e.pointerId);
      e.preventDefault();
    };
    this._onLookMove = (e) => {
      if (e.pointerId !== this._lookId) return;
      const dx = e.clientX - this._lookX, dy = e.clientY - this._lookY;
      this._lookX = e.clientX; this._lookY = e.clientY;
      if (this._blocked()) return;
      const s = LOOK.TOUCH_RAD_PX * TOUCH.lookSens;
      this.client._applyLook(-dx * s, -dy * s);
      e.preventDefault();
    };
    this._onLookUp = (e) => { if (e.pointerId === this._lookId) this._lookId = null; };
    this.lookPad.addEventListener('pointerdown', this._onLookDown);
    this.lookPad.addEventListener('pointermove', this._onLookMove);
    this.lookPad.addEventListener('pointerup', this._onLookUp);
    this.lookPad.addEventListener('pointercancel', this._onLookUp);
  }

  _gyroLook(dy, dp) {
    if (this._blocked()) return;
    this.client._applyLook(dy, dp);
  }

  /** 選單/商店/結束畫面開著時不吃視角與移動(等同桌機解除指標鎖定) */
  _blocked() {
    const c = this.client;
    return !!(c.paused || c.shopOpen || c._gameOver);
  }

  /* ---- 移動:虛擬類比十字鍵 ---- */
  // 外觀是十字鍵、判定是類比搖桿:圓心固定在鍵盤中心(不像蘑菇頭那樣浮動 —— 十字鍵的中心就是它自己),
  // 觸點到圓心的偏移量 = 推杆量 ⇒ 輕推慢走、推到底衝刺。方向片依實際軸值亮起(玩家看得出走哪邊)。
  _bindDpad() {
    if (!this.dpad) return;
    this._onPadDown = (e) => {
      if (this._padId !== null || this._blocked()) return;
      this._padId = e.pointerId;
      const r = this.dpad.getBoundingClientRect();
      this._cx = r.left + r.width / 2;
      this._cy = r.top + r.height / 2;
      this._r = r.width / 2 || 70;
      this._padMove(e.clientX, e.clientY);
      capture(this.dpad, e.pointerId);
      e.preventDefault();
      e.stopPropagation();
    };
    this._onPadMove = (e) => {
      if (e.pointerId !== this._padId) return;
      this._padMove(e.clientX, e.clientY);
      e.preventDefault();
    };
    this._onPadUp = (e) => {
      if (e.pointerId !== this._padId) return;
      this._padId = null;
      this.axis.f = 0; this.axis.r = 0; this.axis.mag = 0;
      this._padPaint();
      this.client._cmd('sprint', false);
    };
    this.dpad.addEventListener('pointerdown', this._onPadDown);
    this.dpad.addEventListener('pointermove', this._onPadMove);
    this.dpad.addEventListener('pointerup', this._onPadUp);
    this.dpad.addEventListener('pointercancel', this._onPadUp);
  }

  _padMove(x, y) {
    const dx = x - this._cx, dy = y - this._cy;
    const len = Math.hypot(dx, dy);
    let mag = Math.min(1, len / this._r);
    // 死區 → 重新拉伸到 0~1(免得手指微動就爬行)
    mag = mag < LOOK.STICK_DEAD ? 0 : (mag - LOOK.STICK_DEAD) / (1 - LOOK.STICK_DEAD);
    if (mag <= 0 || len < 0.001) { this.axis.f = 0; this.axis.r = 0; this.axis.mag = 0; }
    else {
      this.axis.f = -dy / len * mag;   // 螢幕上 = 前進
      this.axis.r = dx / len * mag;
      this.axis.mag = mag;
    }
    this._padPaint(dx, dy, len);
    this.client._cmd('sprint', mag >= LOOK.SPRINT_MAG);
  }

  /** 方向片高亮 + 中央 hub 位移(純視覺回饋;軸值已在 _padMove 定案) */
  _padPaint(dx = 0, dy = 0, len = 0) {
    const a = this.axis, on = a.mag > 0;
    const k = on && len > this._r ? this._r / len : 1;
    if (this.knob) this.knob.style.transform = on ? `translate(${dx * k * 0.55}px, ${dy * k * 0.55}px)` : '';
    const cl = this.dpad.classList;
    const T = 0.32;   // 方向片亮起門檻:斜推時兩片同亮
    cl.toggle('on-up', a.f > T); cl.toggle('on-dn', a.f < -T);
    cl.toggle('on-rt', a.r > T); cl.toggle('on-lf', a.r < -T);
    cl.toggle('on-run', a.mag >= LOOK.SPRINT_MAG);
  }

  /* ---- 動作鈕 ---- */
  _bindButtons() {
    // 按住型:A 射擊 / R 狙擊(長按 = 機種專屬絕招)/ B 跳躍(蓄力跳)/ ZL 下降
    const HOLD = new Set(['fire', 'aim', 'jump', 'dive']);
    this._onBtnDown = (e) => {
      const el = e.target.closest?.('[data-act]');
      if (!el || el.classList.contains('off')) return;
      const act = el.dataset.act;
      e.preventDefault();
      e.stopPropagation();
      this._haptic(act === 'fire' ? 6 : 10);
      if (this._local(act, el)) return;               // 觸控層自己的鈕(陀螺/全螢幕/左手)
      if (HOLD.has(act)) {
        this._held.set(e.pointerId, act);
        el.classList.add('press');
        this.client._cmd(act, true);
        capture(el, e.pointerId);
      } else {
        el.classList.add('press');
        this.client._cmd(act, true);
        setTimeout(() => el.classList.remove('press'), 110);
      }
    };
    this._onBtnUp = (e) => {
      const act = this._held.get(e.pointerId);
      if (!act) return;
      this._held.delete(e.pointerId);
      this.client._cmd(act, false);
      document.querySelectorAll(`[data-act="${act}"].press`).forEach((n) => n.classList.remove('press'));
    };
    // 委派在 document 上:搖桿鈕與 #civPrompt 裡的平民鈕共用同一條派發路徑
    document.addEventListener('pointerdown', this._onBtnDown, true);
    document.addEventListener('pointerup', this._onBtnUp, true);
    document.addEventListener('pointercancel', this._onBtnUp, true);
  }

  /** 直式持握提示:每場只提示一次(轉成橫式即自動收),點一下也收 */
  _bindRotateHint() {
    const el = document.getElementById('tlRotate');
    if (!el) return;
    this._rotEl = el;
    this._rotShown = false;
    this._onRot = () => {
      const portrait = document.body.classList.contains('ori-portrait');
      if (!portrait || this._rotShown) { el.classList.remove('on'); return; }
      this._rotShown = true;
      el.classList.add('on');
      clearTimeout(this._rotT);
      this._rotT = setTimeout(() => el.classList.remove('on'), 6000);
    };
    el.addEventListener('pointerdown', (e) => { el.classList.remove('on'); e.stopPropagation(); });
    window.addEventListener('resize', this._onRot);
    this._onRot();
  }

  /** 觸控層自身的設定鈕(不進 BattleClient._cmd);回傳 true = 已處理 */
  _local(act, el) {
    if (act === 'gyro') { this.setGyro(!this.gyro.active); return true; }
    if (act === 'full') { toggleFullscreen(); return true; }
    if (act === 'lefty') {
      applyLefty(!TOUCH.lefty);
      el.classList.toggle('on', TOUCH.lefty);
      this.client.hud?.feed?.(TOUCH.lefty ? '🖐 左手模式:已開啟' : '🖐 左手模式:已關閉');
      return true;
    }
    return false;
  }

  _haptic(ms) {
    if (TOUCH.haptic) { try { navigator.vibrate?.(ms); } catch { /* 不支援即無感 */ } }
  }

  /* ---- 陀螺儀開關(設定頁與搖桿的「陀螺」鈕共用這一個縫)---- */
  // 失敗一律**講原因**:陀螺儀最常見的故障是 http 下瀏覽器根本不派送感測器事件,
  // 而那是完全靜默的(沒錯誤、沒權限提示)⇒ 只要不可用就把開關扳回關閉並把理由寫進戰報。
  async setGyro(on, silent = false) {
    if (on) {
      const blocked = gyroBlockedReason();
      if (blocked) {
        TOUCH.gyro = false; saveTouchPrefs(); this._syncGyroBtn();
        this.client.hud?.feed?.(`🧭 ${blocked}`);   // 這條 MUST NOT 靜默(silent 也要說)
        return false;
      }
      const ok = await this.gyro.request();
      if (!ok) {
        TOUCH.gyro = false; saveTouchPrefs(); this._syncGyroBtn();
        this.client.hud?.feed?.('🧭 陀螺儀未取得授權(iOS 需允許「動作與方向」)');
        return false;
      }
      this.gyro.start();
      TOUCH.gyro = true;
      if (!silent) this.client.hud?.feed?.('🧭 陀螺儀瞄準:開啟(轉動手機即轉動準星)');
    } else {
      this.gyro.stop();
      TOUCH.gyro = false;
      if (!silent) this.client.hud?.feed?.('🧭 陀螺儀瞄準:關閉');
    }
    saveTouchPrefs();
    this._syncGyroBtn();
    return TOUCH.gyro;
  }

  /** 看門狗判定「開了但感測器沒在送」:自動關掉並說明,免得玩家對著綠燈的鈕猜半天 */
  _gyroDead(why) {
    this.gyro.stop();
    TOUCH.gyro = false;
    saveTouchPrefs();
    this._syncGyroBtn();
    this.client.hud?.feed?.(`🧭 陀螺儀已關閉:${why}`);
  }

  /** 陀螺儀狀態一句話(設定頁提示用) */
  gyroStatus() { return this.gyro.status(); }

  _syncGyroBtn() {
    document.querySelectorAll('[data-act="gyro"]').forEach((n) => {
      n.classList.toggle('on', this.gyro.active);
      n.classList.toggle('off', !this.gyro.active && !!gyroBlockedReason());
    });
    document.querySelectorAll('[data-act="lefty"]').forEach((n) => n.classList.toggle('on', TOUCH.lefty));
    const hint = document.getElementById('setGyroHint');
    if (hint) hint.textContent = this.gyro.status();
  }

  /**
   * 逐機種鈕面特化:
   *   ① B 鍵字樣跟著機動能力走(無人機=上升/完美迴避、機甲=躍/蓄力跳、變形=躍/變形彈射)。
   *   ② ZL 下降只在飛行機種(無人機/變形機甲)與觀戰自由視角出現。
   *   ③ ZR 換機只給無人機三機小隊。
   *   ④ 觀戰沒有座機:A/R/⊟/HOME 一律收掉(_cmd 對 side=null 不受理,留著只會誤按;
   *      HOME 亦然 —— `_setPaused` 對 side=null 直接 return,桌機觀戰同樣沒有 ESC 選單)。
   */
  setKind(kind) {
    const spec = !kind;                          // 觀戰自由視角(無機體)
    const mob = MOBIL_LABEL[kind] || MOBIL_LABEL.mech;
    const bf = document.querySelector('.gb-b .gb-f');
    if (bf) bf.textContent = spec ? '上升' : mob;
    const fly = spec || kind === 'drone' || kind === 'morph';
    document.querySelectorAll('[data-act="dive"]').forEach((n) => { n.hidden = !fly; });
    document.querySelectorAll('[data-act="swap"]').forEach((n) => { n.hidden = kind !== 'drone'; });
    document.querySelectorAll('.gb-a, .gb-aim, [data-act="shop"], [data-act="menu"]')
      .forEach((n) => { n.hidden = spec; });
    document.body.classList.toggle('tl-spec', spec);
  }

  /** 凍結輸入(開選單/商店時由 _setPaused 呼叫):放掉所有按住狀態,免得放手事件被吃掉後卡住 */
  reset() {
    this.axis.f = 0; this.axis.r = 0; this.axis.mag = 0;
    this._lookId = null; this._padId = null;
    for (const act of this._held.values()) this.client._cmd(act, false);
    this._held.clear();
    if (this.dpad) this._padPaint();
    document.querySelectorAll('#game [data-act].press').forEach((n) => n.classList.remove('press'));
  }

  dispose() {
    if (_active === this) _active = null;
    this.gyro.stop();
    clearTimeout(this._rotT);
    if (this._onRot) window.removeEventListener('resize', this._onRot);
    this._rotEl?.classList.remove('on');
    if (this.lookPad) {
      this.lookPad.removeEventListener('pointerdown', this._onLookDown);
      this.lookPad.removeEventListener('pointermove', this._onLookMove);
      this.lookPad.removeEventListener('pointerup', this._onLookUp);
      this.lookPad.removeEventListener('pointercancel', this._onLookUp);
    }
    if (this.dpad) {
      this.dpad.removeEventListener('pointerdown', this._onPadDown);
      this.dpad.removeEventListener('pointermove', this._onPadMove);
      this.dpad.removeEventListener('pointerup', this._onPadUp);
      this.dpad.removeEventListener('pointercancel', this._onPadUp);
    }
    document.removeEventListener('pointerdown', this._onBtnDown, true);
    document.removeEventListener('pointerup', this._onBtnUp, true);
    document.removeEventListener('pointercancel', this._onBtnUp, true);
    if (this.layer) this.layer.hidden = true;
  }
}

/* ---------------- 搖桿試玩(大廳:不進戰場也能驗)---------------- */

// 用**真的** TouchControls 配一個假 client:走的是與戰鬥完全相同的程式路徑,
// 所以「試玩會動、戰鬥不會動」才有診斷價值(反之亦然)。MUST NOT 為試玩另寫一套輸入。
let _test = null;

/** 開始試玩:顯示觸控層 + 讀值面板;回傳 stop 函式 */
export function openTouchTest(readEl) {
  if (_test) return _test.stop;
  const acts = [];
  const mock = {
    heroKind: 'drone', side: 'SWARM', paused: false, shopOpen: false, _gameOver: false, dead: false,
    yaw: 0, pitch: 0,
    hud: { feed: (t) => { acts.unshift(t); acts.length = Math.min(acts.length, 4); } },
    _applyLook(dYaw, dPitch) {
      this.yaw += dYaw;
      this.pitch = clamp(this.pitch + dPitch, -1.45, 1.45);
    },
    _cmd(act, down) {
      if (act === 'sprint' && !down) return;
      acts.unshift(`${act}${down === false ? ' ↑' : ' ↓'}`);
      acts.length = Math.min(acts.length, 4);
    },
  };
  // 試玩期間 MUST 確保 body 有 touch-ui + 一個 ori class:搖桿的尺寸/定位全靠它們的 CSS 變數,
  // 少了就會塌成 0×0(在觸控筆電上「自動判定 = 桌機版」時就會踩到)。離開試玩再還原。
  const addedUI = !document.body.classList.contains('touch-ui');
  if (addedUI) document.body.classList.add('touch-ui');
  syncOrientation();
  document.body.classList.add('tl-test');
  const tc = new TouchControls(mock);
  const deg = (r) => (r * 180 / Math.PI).toFixed(1);
  let raf = 0;
  const draw = () => {
    const g = tc.gyro;
    const raw = g.last ? `α ${(g.last.alpha ?? 0).toFixed(0)}° β ${g.last.beta.toFixed(0)}° γ ${g.last.gamma.toFixed(0)}°` : '—';
    readEl.innerHTML = `<b>搖桿試玩</b>(這裡有反應 = 觸控層正常)`
      + `<div>十字鍵 前後 <b>${tc.axis.f.toFixed(2)}</b> 左右 <b>${tc.axis.r.toFixed(2)}</b> 推杆量 <b>${tc.axis.mag.toFixed(2)}</b></div>`
      + `<div>視角 yaw <b>${deg(mock.yaw)}°</b> pitch <b>${deg(mock.pitch)}°</b></div>`
      + `<div>陀螺 <b>${g.status()}</b></div>`
      + `<div>感測原始值 ${raw} ・ 累計 yaw ${g.accYaw.toFixed(1)}° pitch ${g.accPitch.toFixed(1)}°</div>`
      + `<div>按鍵 ${acts.length ? acts.join(' ・ ') : '—'}</div>`;
    raf = requestAnimationFrame(draw);
  };
  draw();
  const stop = () => {
    cancelAnimationFrame(raf);
    tc.dispose();
    document.body.classList.remove('tl-test');
    if (addedUI) document.body.classList.remove('touch-ui');
    _test = null;
  };
  _test = { stop, tc };
  return stop;
}

/** 結束試玩(沒在試玩就什麼都不做) */
export function closeTouchTest() { _test?.stop(); }
