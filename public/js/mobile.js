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

/** 有觸控硬體(不代表要用觸控版:二合一筆電也有觸控螢幕) */
export function touchCapable() {
  return (navigator.maxTouchPoints || 0) > 0 || 'ontouchstart' in window;
}

/**
 * 是否採用觸控版 UI:觸控硬體 + (無精準指標/無 hover,或短邊 ≤ 820px)。
 * localStorage `svs_touchui` 可強制覆寫(桌機開發除錯用:設 '1' 就能在電腦上驗版型)。
 */
export function isTouchUI() {
  try {
    const o = localStorage.getItem(OVERRIDE_KEY);
    if (o === '1') return true;
    if (o === '0') return false;
  } catch { /* 私密模式忽略 */ }
  if (!touchCapable()) return false;
  const mm = window.matchMedia;
  const coarse = mm ? mm('(pointer: coarse)').matches : true;
  const noHover = mm ? !mm('(any-hover: hover)').matches : true;
  const small = Math.min(window.screen?.width || 9999, window.screen?.height || 9999) <= 820;
  return (coarse && noHover) || small;
}

/** 觸控版強制開關(設定頁用;需重新載入才會重建輸入層) */
export function setTouchUIOverride(v) {
  try {
    if (v == null) localStorage.removeItem(OVERRIDE_KEY);
    else localStorage.setItem(OVERRIDE_KEY, v ? '1' : '0');
  } catch { /* 私密模式忽略 */ }
}

/* ---------------- 設定(持久化;陀螺儀/靈敏度/左手模式)---------------- */

// 靈敏度基準:touch 每像素轉多少弧度、gyro 1:1(1.0 = 手機轉幾度視角就轉幾度)。
// 這兩個係數是觸控手感的唯一真相,MUST NOT 在別處再乘一次。
export const LOOK = {
  TOUCH_RAD_PX: 0.0034,   // 拖曳視角:rad/px(比滑鼠 0.0023 大 —— 手指行程短)
  GYRO_BASE: 1.0,         // 陀螺儀增益基準(1 = 物理 1:1)
  GYRO_DEAD: 0.00035,     // 陀螺儀死區(rad/event):濾掉手持微顫
  GYRO_JUMP: 0.5,         // 單次事件超過此弧度視為姿態跳變(轉螢幕/失準)→ 重設基準不套用
  SPRINT_MAG: 0.92,       // 蘑菇頭推到此比例以上 = 衝刺(等同 Shift)
  STICK_DEAD: 0.16,       // 蘑菇頭死區(比例)
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
  lefty: false,       // 左手模式(蘑菇頭與動作鈕左右鏡像)
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

/** 左手模式即時套用(設定頁用;鏡像純 CSS,蘑菇頭區域由 CSS 定位 → 無需重建) */
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
 * 陀螺儀輔助瞄準(相對模式)。
 * 絕對映射(手機朝哪、視角就朝哪)在 FPS 不可用 —— 要轉身 180° 就得整個人轉半圈;
 * 故取**每次事件的姿態差**疊加到視角上(= 主機遊戲的陀螺輔助),與拖曳視角可同時作用、互不重設。
 * 螢幕旋轉角納入四元數補正 ⇒ 直式/橫式(含反向橫式)軸向自動正確,MUST NOT 改成手動換軸。
 */
class Gyro {
  constructor(onLook) {
    this.onLook = onLook;
    this.active = false;
    this.granted = false;
    this._q = new THREE.Quaternion();
    this._q0 = new THREE.Quaternion();
    this._e = new THREE.Euler();
    this._f = new THREE.Vector3();
    this._have = false;
    this._yaw = 0; this._pitch = 0;
    this._onOri = (ev) => this._read(ev);
    this._reset = () => { this._have = false; };   // 轉螢幕 → 丟掉基準,下一個事件重新起算
  }

  /** iOS 13+ 需在使用者手勢中要求權限;其他平台直接可用 */
  async request() {
    const D = window.DeviceOrientationEvent;
    if (!D) return false;
    if (typeof D.requestPermission === 'function') {
      try { this.granted = (await D.requestPermission()) === 'granted'; } catch { this.granted = false; }
    } else this.granted = true;
    return this.granted;
  }

  start() {
    if (this.active) return;
    this.active = true;
    this._have = false;
    window.addEventListener('deviceorientation', this._onOri);
    window.addEventListener('orientationchange', this._reset);
    window.screen?.orientation?.addEventListener?.('change', this._reset);
  }

  stop() {
    if (!this.active) return;
    this.active = false;
    this._have = false;
    window.removeEventListener('deviceorientation', this._onOri);
    window.removeEventListener('orientationchange', this._reset);
    window.screen?.orientation?.removeEventListener?.('change', this._reset);
  }

  _read(ev) {
    if (ev.alpha == null || ev.beta == null || ev.gamma == null) return;
    const d2r = Math.PI / 180;
    this._e.set(ev.beta * d2r, ev.alpha * d2r, -ev.gamma * d2r, 'YXZ');
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
    if (oy || op) this.onLook(oy, op);
  }
}

/* ---------------- 觸控操控 ---------------- */

// 機動鈕(空白鍵)逐機種標籤:與 help.js 的操作說明同義,但這裡只需要單字(鈕面寬度有限)。
const MOBIL_GLYPH = { drone: '升', morph: '躍', mech: '躍', robot: '躍' };

/**
 * 戰場觸控操控。由 BattleClient._initInput() 在觸控版時建立,dispose() 時銷毀。
 * DOM 掛點全部在 index.html 的 #touchLayer(靜態骨架 + data-act),本檔只綁事件:
 *   - #tlLook     :全畫面拖曳視角(壓在所有控件之下;控件自行吃掉事件)
 *   - #tlMoveZone :虛擬蘑菇頭作用區(浮動原點 —— 手指落點即圓心)
 *   - [data-act]  :動作鈕(含被特化成按鈕的 HUD 方塊:小招/大招/機動/填彈)
 */
export class TouchControls {
  constructor(client) {
    this.client = client;
    this.axis = { f: 0, r: 0, mag: 0 };   // 移動輸入(_moveAxis 讀;鍵盤未按時才生效)
    this.layer = document.getElementById('touchLayer');
    this.lookPad = document.getElementById('tlLook');
    this.moveZone = document.getElementById('tlMoveZone');
    this.stick = document.getElementById('tlStick');
    this.knob = document.getElementById('tlKnob');
    this._lookId = null;
    this._lookX = 0; this._lookY = 0;
    this._stickId = null;
    this._cx = 0; this._cy = 0; this._r = 60;
    this._held = new Map();   // pointerId → act(按住型動作鈕:射擊/瞄準/機動)
    this.gyro = new Gyro((dy, dp) => this._gyroLook(dy, dp));

    if (this.layer) this.layer.hidden = false;
    this._bindLook();
    this._bindStick();
    this._bindButtons();
    this._bindRotateHint();
    this.setKind(client.heroKind);
    if (TOUCH.gyro) this.setGyro(true, true);   // 記憶開啟:靜默續用(iOS 若未授權會自行退回關閉)
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

  /* ---- 移動:浮動虛擬蘑菇頭 ---- */
  _bindStick() {
    if (!this.moveZone || !this.stick) return;
    const place = (x, y) => {
      const zr = this.moveZone.getBoundingClientRect();
      this._r = (this.stick.offsetWidth || 120) / 2;
      // 圓心夾在作用區內(貼邊落指也要有完整行程)
      this._cx = clamp(x, zr.left + this._r, zr.right - this._r);
      this._cy = clamp(y, zr.top + this._r, zr.bottom - this._r);
      this.stick.style.left = `${this._cx - zr.left - this._r}px`;
      this.stick.style.top = `${this._cy - zr.top - this._r}px`;
      this.stick.classList.add('on');
    };
    this._onStickDown = (e) => {
      if (this._stickId !== null || this._blocked()) return;
      this._stickId = e.pointerId;
      place(e.clientX, e.clientY);
      this._stickMove(e.clientX, e.clientY);
      capture(this.moveZone, e.pointerId);
      e.preventDefault();
      e.stopPropagation();
    };
    this._onStickMove = (e) => {
      if (e.pointerId !== this._stickId) return;
      this._stickMove(e.clientX, e.clientY);
      e.preventDefault();
    };
    this._onStickUp = (e) => {
      if (e.pointerId !== this._stickId) return;
      this._stickId = null;
      this.axis.f = 0; this.axis.r = 0; this.axis.mag = 0;
      this.stick.classList.remove('on');
      this.stick.style.removeProperty('left');
      this.stick.style.removeProperty('top');
      if (this.knob) this.knob.style.transform = '';
      this.client._cmd('sprint', false);
    };
    this.moveZone.addEventListener('pointerdown', this._onStickDown);
    this.moveZone.addEventListener('pointermove', this._onStickMove);
    this.moveZone.addEventListener('pointerup', this._onStickUp);
    this.moveZone.addEventListener('pointercancel', this._onStickUp);
  }

  _stickMove(x, y) {
    const dx = x - this._cx, dy = y - this._cy;
    const len = Math.hypot(dx, dy);
    const k = len > this._r ? this._r / len : 1;                 // 拉出圓外 → 夾在邊緣
    if (this.knob) this.knob.style.transform = `translate(${dx * k}px, ${dy * k}px)`;
    let mag = Math.min(1, len / this._r);
    // 死區 → 重新拉伸到 0~1(免得手指微動就爬行)
    mag = mag < LOOK.STICK_DEAD ? 0 : (mag - LOOK.STICK_DEAD) / (1 - LOOK.STICK_DEAD);
    if (mag <= 0 || len < 0.001) { this.axis.f = 0; this.axis.r = 0; this.axis.mag = 0; return; }
    this.axis.f = -dy / len * mag;   // 螢幕上 = 前進
    this.axis.r = dx / len * mag;
    this.axis.mag = mag;
    this.client._cmd('sprint', mag >= LOOK.SPRINT_MAG);
  }

  /* ---- 動作鈕 ---- */
  _bindButtons() {
    // 按住型:射擊 / 瞄準(長按 = 機種專屬絕招)/ 機動(蓄力跳)/ 下降
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
    // 委派在 document 上:HUD 方塊(小招/大招/機動/填彈)與觸控層的鈕共用同一條派發路徑
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

  /* ---- 陀螺儀開關(設定頁與觸控層鈕共用這一個縫)---- */
  async setGyro(on, silent = false) {
    if (on) {
      const ok = await this.gyro.request();
      if (!ok) {
        TOUCH.gyro = false; saveTouchPrefs(); this._syncGyroBtn();
        if (!silent) this.client.hud?.feed?.('🧭 陀螺儀無法啟用(裝置不支援或未授權)');
        return false;
      }
      this.gyro.start();
      TOUCH.gyro = true;
      if (!silent) this.client.hud?.feed?.('🧭 陀螺儀輔助瞄準:開啟(轉動手機微調準星)');
    } else {
      this.gyro.stop();
      TOUCH.gyro = false;
      if (!silent) this.client.hud?.feed?.('🧭 陀螺儀輔助瞄準:關閉');
    }
    saveTouchPrefs();
    this._syncGyroBtn();
    return TOUCH.gyro;
  }

  _syncGyroBtn() {
    document.querySelectorAll('[data-act="gyro"]').forEach((n) => n.classList.toggle('on', this.gyro.active));
    document.querySelectorAll('[data-act="lefty"]').forEach((n) => n.classList.toggle('on', TOUCH.lefty));
  }

  /**
   * 逐機種鈕面特化。三件事:
   *   ① HUD 招式方塊的鍵位字改成觸控字樣(Q/E/␣ 在手機上沒有意義,但就緒色塊要留)。
   *   ② 下降鈕只在飛行機種(無人機/變形機甲)或觀戰自由視角出現。
   *   ③ 上升鈕只給觀戰(參戰時上升 = HUD #abMobil 方塊,它另帶 CD;不做第二顆同功能鈕)。
   *   ④ 換機鈕只給無人機三機小隊。
   */
  setKind(kind) {
    const spec = !kind;                          // 觀戰自由視角(無機體)
    const key = (sel, t) => { const n = document.querySelector(sel); if (n) n.textContent = t; };
    key('#abMobil .ab-key', MOBIL_GLYPH[kind] || '躍');
    key('#abSkill .ab-key', '小');
    key('#abUlt .ab-key', '大');
    const fly = spec || kind === 'drone' || kind === 'morph';
    document.querySelectorAll('.tl-dive').forEach((n) => { n.hidden = !fly; });
    document.querySelectorAll('.tl-rise').forEach((n) => { n.hidden = !spec; });
    document.querySelectorAll('[data-act="swap"]').forEach((n) => { n.hidden = kind !== 'drone'; });
    // 觀戰沒有座機:戰鬥類鈕一律收掉(_cmd 對 side=null 本來就不受理,留著只會誤按)。
    // ☰ 一併收 —— 戰場選單 `_setPaused` 本來就對 side=null 直接 return(桌機觀戰也沒有 ESC 選單),
    // 留一顆按了沒反應的鈕比沒有更糟;觀戰要離開走瀏覽器重載,與桌機同。
    document.querySelectorAll('.tl-fire, .tl-aim, [data-act="shop"], [data-act="menu"]')
      .forEach((n) => { n.hidden = spec; });
  }

  /** 凍結輸入(開選單/商店時由 _setPaused 呼叫):放掉所有按住狀態,免得放手事件被吃掉後卡住 */
  reset() {
    this.axis.f = 0; this.axis.r = 0; this.axis.mag = 0;
    this._lookId = null; this._stickId = null;
    for (const act of this._held.values()) this.client._cmd(act, false);
    this._held.clear();
    this.stick?.classList.remove('on');
    // 浮動原點的 left/top 是 inline 寫上去的:收起時 MUST 一併清掉,否則 .on 移除後
    // 基準規則的 translate(-50%,-50%) 會配上舊 inline 座標 → 圓盤停在偏移位置
    this.stick?.style.removeProperty('left');
    this.stick?.style.removeProperty('top');
    if (this.knob) this.knob.style.transform = '';
    document.querySelectorAll('#game [data-act].press').forEach((n) => n.classList.remove('press'));
  }

  dispose() {
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
    if (this.moveZone) {
      this.moveZone.removeEventListener('pointerdown', this._onStickDown);
      this.moveZone.removeEventListener('pointermove', this._onStickMove);
      this.moveZone.removeEventListener('pointerup', this._onStickUp);
      this.moveZone.removeEventListener('pointercancel', this._onStickUp);
    }
    document.removeEventListener('pointerdown', this._onBtnDown, true);
    document.removeEventListener('pointerup', this._onBtnUp, true);
    document.removeEventListener('pointercancel', this._onBtnUp, true);
    if (this.layer) this.layer.hidden = true;
  }
}
