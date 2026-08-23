// ============ 手機 / 平板:觸控 + 陀螺儀操控與直式/橫式版型(客戶端專用)============
// 定位:**輸入轉接層**,不是第二套操控。本檔只把觸控與陀螺儀轉成「既有的輸入狀態」:
//   移動 → BattleClient._moveAxis() 讀的 this.touch.axis(與鍵盤 WASD 共用同一個推導縫)
//   視角 → BattleClient._applyLook(dYaw, dPitch)(與滑鼠 mousemove 共用同一個套用縫)
//   動作 → BattleClient._cmd(act, down)(與鍵盤/滑鼠共用同一個派發縫)
// 因此本檔 MUST NOT 直接改 yaw/pitch/keys/firing,也 MUST NOT 自行結算任何權威狀態
// (伺服器權威見 /CLAUDE.md §1);新增按鈕只准新增 act 名稱,不准在此另寫一份操作邏輯。
//
// 版型:body 上掛四個 class 供 CSS 特化 —— `touch-ui`(觸控版)、`ori-portrait`/`ori-landscape`
// (直式/橫式)、`touch-lefty`(左手模式,左右鏡像),以及**與版型正交**的 `touch-dev`
// (這台機器有觸控硬體;頁面級觸控硬化綁它,見 installTouchUI())。
// 版型細節全在 css/style.css,本檔只掛 class。
// 視野角度 MUST NOT 因直/橫式而改(全機種 fov 68,見 /CLAUDE.md A8):直式只是水平視野較窄,
// 故直式首次進場提示「建議橫向持握」,而不是偷偷改 FOV。
import * as THREE from 'three';
import {
  CTRL_MODES, CTRL_MODE_KEYS, CTRL_SCHEMES, CTRL_SCHEME_KEYS, ctrlMode, ctrlPref, setCtrlPref,
  ctrlScheme, setCtrlScheme, ctrlLocked, ctrlMismatchText, onCtrlChange, usePad, deviceScheme,
  touchCapable, ctrlModeText, VIEW_MODES, VIEW_MODE_KEYS, viewMode, setViewMode, onViewModeChange,
} from './ctrlmode.js';
import { tipHTML } from './tip.js';

/* ---------------- 裝置判定 ---------------- */
// 判定本身住 `ctrlmode.js`(操作方式唯一真相縫):本檔只轉呼,MUST NOT 在這裡再寫一份
// `maxTouchPoints` / `pointer: coarse` 的判斷(見 ctrlmode.js 檔頭)。

const SETTINGS_KEY = 'svs_touch';

export { touchCapable };

/**
 * 是否採用虛擬搖桿版 UI(= 操作方式解析後的結果)。
 * 房主替整房選「限定滑鼠鍵盤 / 限定搖桿 / 不限定」,不限定時吃裝置判定 —— 全部住 ctrlmode.js。
 */
export function isTouchUI() { return usePad(); }

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
    // 角速度是「方向感測缺磁力計 ⇒ 水平轉不動」時的替代路徑,診斷 MUST 分開列(兩者可以一好一壞)
    { k: '角速度 API(無磁力計時的備援)', v: !!window.DeviceMotionEvent, ok: !!window.DeviceMotionEvent,
      note: typeof window.DeviceMotionEvent?.requestPermission === 'function' ? '需要授權(iOS)' : '免授權' },
    { k: '觸控硬體', v: `maxTouchPoints=${navigator.maxTouchPoints || 0}`, ok: touchCapable() },
    { k: '粗指標 pointer:coarse', v: mm('(pointer: coarse)'), ok: mm('(pointer: coarse)') === true },
    { k: '無 hover any-hover:none', v: mm('(any-hover: hover)') === false, ok: mm('(any-hover: hover)') === false },
    { k: '螢幕短邊 ≤ 820', v: `${window.screen?.width}×${window.screen?.height}`,
      ok: Math.min(window.screen?.width || 9999, window.screen?.height || 9999) <= 820 },
    { k: '裝置判定(不限定時的預設)', v: CTRL_SCHEMES[deviceScheme()].label, ok: true },
    { k: '操作方式', v: ctrlModeText(), ok: !ctrlMismatchText(),
      note: ctrlLocked() ? '整房一致,由房主在戰區畫面決定' : `我的預設(開房時整房沿用):${CTRL_MODES[ctrlPref()].label}` },
    { k: '結論:虛擬搖桿', v: isTouchUI(), ok: isTouchUI(),
      note: isTouchUI() ? '虛擬搖桿會在戰鬥中出現'
        : (ctrlLocked() ? '本戰區由房主限定,要換請洽房主' : '可把操作方式改成「限定搖桿」,或網址加 ?ctrl=pad') },
    { k: 'body class', v: [...document.body.classList].filter((c) => c.startsWith('touch') || c.startsWith('ori')).join(' ') || '(無)',
      ok: document.body.classList.contains('touch-ui') },
  ];
}

/* ---------------- 設定(持久化;陀螺儀/靈敏度/左右慣用手)---------------- */

// 靈敏度基準:touch 每像素轉多少弧度、gyro 1:1(1.0 = 手機轉幾度視角就轉幾度)。
// 這兩個係數是觸控手感的唯一真相,MUST NOT 在別處再乘一次。
export const LOOK = {
  TOUCH_RAD_PX: 0.0034,   // 拖曳視角:rad/px(比滑鼠 0.0023 大 —— 手指行程短)
  GYRO_BASE: 1.0,         // 陀螺儀增益基準(1 = 物理 1:1)
  GYRO_DEAD: 0.00035,     // 陀螺儀死區(rad/event):濾掉手持微顫
  GYRO_JUMP: 0.5,         // 單次事件超過此弧度視為姿態跳變(轉螢幕/失準)→ 重設基準不套用
  GYRO_WD_MS: 1600,       // 看門狗:一條感測路徑等這麼久還沒有有效資料就換下一條
  GYRO_DT_MAX: 0.1,       // devicemotion 單筆積分上限(秒):事件延遲時不讓準星暴衝
  GYRO_YAW_DEAD: 0.012,   // 「水平軸死了」判定:俯仰已轉這麼多(rad)…
  GYRO_YAW_PROOF: 0.18,   // …但水平累計仍不到 GYRO_YAW_DEAD ⇒ 無磁力計 → 改走 devicemotion
  SPRINT_MAG: 0.92,       // 移動搖桿推到此比例以上 = 衝刺(等同 Shift)
  STICK_DEAD: 0.16,       // 類比搖桿死區(比例;兩支共用)
  LOOK_RAD_S: 2.5,        // 視角搖桿推到底的轉速(rad/s ≈ 143°/s,比照主機手把)
  LOOK_CURVE: 1.7,        // 視角搖桿的響應曲線指數(>1 = 小推更細膩、推到底才全速)
  // 空處「雙擊後按住 / 拖曳 = 射擊」的手勢門檻(見 TouchControls._bindLook)。
  // 這是給「不想把拇指移到 A 鈕」的玩家的第二條開火路徑,判定 MUST 嚴到不會誤觸:
  // 單指拖曳轉視角(最常做的事)絕不可以變成開火,故一定要先有一次**完整的輕點**。
  //
  // **「什麼算一次點擊」全站只有這一組門檻**(2026-08-16):空處手勢的輕點與點擊型鈕
  // (`_bindButtons` 的非按住型 act)同吃 TAP_MS + TAP_SLOP_PX。MUST NOT 為按鈕另訂第二組數字 ——
  // 兩份定義會漂,而症狀是「同樣的手指動作在鈕上算點擊、在空處不算」。
  TAP_MS: 260,            // 一次「輕點」的上限時長(超過就是按住,不算點)
  TAP_SLOP_PX: 16,        // 一次「輕點」允許的位移(超過就是拖曳,不算點)
  TAP_GAP_MS: 300,        // 兩點之間的最大間隔(超過就不是雙擊)
  TAP_FIRE_MS: 130,       // 第二點按住多久開始射擊(**長按**路徑;純雙擊放開不開火)
  TAP_FIRE_PX: 8,         // 第二點拖多遠開始射擊(**拖曳**路徑;比 SLOP 小,一動就認)
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

/** 感測來源:auto 自動(方向感測優先,失效自動改角速度)/ orient 只用方向感測 / motion 只用角速度 */
export const GYRO_SRC = ['auto', 'orient', 'motion'];
export const GYRO_SRC_LABEL = { auto: '自動', orient: '方向', motion: '角速度' };

export const TOUCH = {
  gyro: false,        // 陀螺儀輔助瞄準(**預設關閉**;戰場以十字鍵下的「陀螺」鈕一鍵收放)
  gyroSrc: 'auto',    // 感測來源:auto 自動 / orient 方向感測 / motion 角速度(見 Gyro)
  gyroSens: 1.0,      // 陀螺儀靈敏度倍率(0.4~2.5)
  gyroInvert: false,  // 陀螺儀垂直反轉
  lookSens: 1.0,      // 拖曳視角靈敏度倍率(0.4~2.5)
  lefty: false,       // 慣用手鏡像旗標(相容既有 svs_touch 設定鍵)
  screenLefty: false, // 畫面慣用手鏡像旗標(舊版 lefty 會在載入時遷移)
  haptic: true,       // 觸覺回饋(navigator.vibrate,不支援即無感)
};

export const HAND_KEYS = ['right', 'left'];
export const HAND_LABEL = { right: '右手', left: '左手' };

export function handedness() { return TOUCH.lefty ? 'left' : 'right'; }

export function setHandedness(hand) {
  if (!HAND_KEYS.includes(hand)) return false;
  applyLefty(hand === 'left');
  return true;
}

export function screenHandedness() { return TOUCH.screenLefty ? 'left' : 'right'; }

export function setScreenHandedness(hand) {
  if (!HAND_KEYS.includes(hand)) return false;
  applyScreenLefty(hand === 'left');
  return true;
}

function loadTouchPrefs() {
  let j = {};
  try {
    j = JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}');
    for (const k of Object.keys(TOUCH)) if (j[k] !== undefined) TOUCH[k] = j[k];
  } catch { /* 壞資料忽略,用預設 */ }
  if (j.screenLefty === undefined && j.lefty !== undefined) TOUCH.screenLefty = !!j.lefty;
  TOUCH.gyroSens = clamp(TOUCH.gyroSens, 0.4, 2.5);
  TOUCH.lookSens = clamp(TOUCH.lookSens, 0.4, 2.5);
  TOUCH.lefty = !!TOUCH.lefty;
  TOUCH.screenLefty = !!TOUCH.screenLefty;
  if (!GYRO_SRC.includes(TOUCH.gyroSrc)) TOUCH.gyroSrc = 'auto';
}
export function saveTouchPrefs() {
  try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(TOUCH)); } catch { /* 私密模式忽略 */ }
}
loadTouchPrefs();

/* ---------------- 低功耗模式(算圖降階 + 合成音效)---------------- */
// 旗標的**唯一真相** = localStorage `svs_lowpower`,game.js `_dpr()`、audio.js、設定頁三處共讀。
// 手機/平板 **預設開啟**:GPU 與電量都吃緊,滿解析度算圖在中階機上直接掉幀。
// 「沒設定過」與「設成 0」MUST 分開 —— 前者才吃預設值,後者是玩家明確關掉,不可被預設蓋回去。
const LOWP_KEY = 'svs_lowpower';

/** 低功耗是否生效(未設定過 → 觸控版預設開、桌機預設關) */
export function lowPower() {
  let v = null;
  try { v = localStorage.getItem(LOWP_KEY); } catch { /* 私密模式忽略 */ }
  return v === null ? isTouchUI() : v === '1';
}

/** 低功耗開關(設定頁用;寫入後即為明確偏好,不再吃預設值) */
export function setLowPower(on) {
  try { localStorage.setItem(LOWP_KEY, on ? '1' : '0'); } catch { /* 私密模式忽略 */ }
}

/* ---------------- 版型:觸控版 class + 直式/橫式追蹤 ---------------- */

/** 螢幕旋轉角(度):陀螺儀軸向補正與版型判定共用 */
function screenAngle() {
  const a = window.screen?.orientation?.angle;
  if (Number.isFinite(a)) return a;
  return Number.isFinite(window.orientation) ? window.orientation : 0;
}

/* ---- 視窗尺寸定案(旋轉 debounce;唯一縫)---- */
// **一次旋轉會連發好幾個尺寸,只有最後一個是對的** —— iOS 尤其。每一筆都照做的代價是
// 重配一次 render target(頓一下)**而且有機會停在中間那個錯的尺寸**:畫面拉伸、HUD 錯位,
// 而且沒有任何錯誤訊息。故「尺寸真的定案了」只有這一個縫,消費端(畫布 / 相機 / HUD 帶)
// MUST 訂閱 `onViewportSettled`,MUST NOT 自己綁 `window.addEventListener('resize', …)`。
// 直式/橫式的 body class 仍**當場**切(CSS 版型不該等 —— 等的是重配 GPU 資源那一半)。
export const VIEWPORT = {
  SETTLE_MS: 50,        // 一般裝置:壓掉拖曳視窗邊緣的連發
  SETTLE_IOS_MS: 500,   // iOS:一次旋轉連發數個中間尺寸,等它安定(見上)
};

/**
 * iOS / iPadOS。**iPadOS 13+ 的 UA 偽裝成 Mac**(桌面版網站請求是預設值)⇒ 只比對
 * `iPad|iPhone|iPod` 會把 iPad 整批判成桌機,而 iPad 正是最會連發中間尺寸的那一類;
 * 補「Mac + 有多點觸控」那一格才蓋得住(桌機 Mac 的 `maxTouchPoints` 是 0)。
 */
export function isIOS() {
  if (typeof navigator === 'undefined') return false;
  const ua = navigator.userAgent || '';
  if (/iPad|iPhone|iPod/.test(ua)) return true;
  return /Mac/.test(ua) && (navigator.maxTouchPoints || 0) > 1;
}

/** 這台裝置要等多久才算「尺寸定案」(ms);兩個值都住 `VIEWPORT`,MUST NOT 在消費端手寫 */
export function viewportSettleMs() { return isIOS() ? VIEWPORT.SETTLE_IOS_MS : VIEWPORT.SETTLE_MS; }

const _vpSubs = new Set();
let _vpT = 0;
let _vpBound = false;

/** 尺寸可能變了 → 重新起算 debounce(resize / 轉向 / 全螢幕進出共用這一支)*/
export function bumpViewport() {
  clearTimeout(_vpT);
  _vpT = setTimeout(() => {
    _vpT = 0;
    for (const fn of [..._vpSubs]) {
      try { fn(); } catch { /* 單一訂閱者出錯不該拖垮其他人(降級,不例外)*/ }
    }
  }, viewportSettleMs());
}

/** 訂閱「尺寸真的定案了」;回傳解除訂閱函式。首次訂閱時才綁三個來源(冪等)*/
export function onViewportSettled(fn) {
  _vpSubs.add(fn);
  if (!_vpBound) {
    _vpBound = true;
    window.addEventListener('resize', bumpViewport);
    window.addEventListener('orientationchange', bumpViewport);
    window.screen?.orientation?.addEventListener?.('change', bumpViewport);
  }
  return () => _vpSubs.delete(fn);
}

/** 直式/橫式判定並掛 class(當場);尺寸那一半交給 `bumpViewport` 的 debounce */
function syncOrientation() {
  const portrait = window.innerHeight >= window.innerWidth;
  const b = document.body;
  const was = b.classList.contains('ori-portrait');
  b.classList.toggle('ori-portrait', portrait);
  b.classList.toggle('ori-landscape', !portrait);
  // 轉向本身也是一次「尺寸可能變了」:MUST 走同一個 debounce,MUST NOT 自己 rAF + setTimeout
  // 補送一次合成 resize(那是第二份等待時間,而且它比 iOS 真正需要的短一截)
  if (was !== portrait) bumpViewport();
}

let _installed = false;
/**
 * 安裝觸控版版型(main.js 啟動時呼叫一次)。回傳是否為虛擬搖桿版。
 * 只掛 body class 與監聽轉向 —— 戰場的觸控輸入由 TouchControls 負責(進戰場才建)。
 * **操作方式改變(不限定時玩家在戰鬥中切換)時 MUST 重跑一次**:body class 是搖桿層的
 * CSS 尺寸/定位來源,少掛就會塌成 0×0。故此處自行訂閱 ctrlmode,呼叫端不必記得。
 */
export function installTouchUI() {
  const on = isTouchUI();
  document.body.classList.toggle('touch-ui', on);
  // 裝置級硬化旗標(2026-08-16,`docs/anime_style_plan.md` ⑧-5):`touch-ui` 是**房間設定**
  // (房主鎖「限定滑鼠鍵盤」⇒ 恆 false),而「捏合縮放 / 下拉刷新 / 長按選字 / 點擊高亮要不要
  // 擋掉」問的是**這台機器有沒有觸控硬體** —— 兩件事共用一個旗標的話,房主一鎖鍵鼠,真手機上
  // 那組頁面級保護整組消失而遊戲照樣在跑、零錯誤訊息。判定只准轉呼 `ctrlmode.touchCapable()`,
  // 本檔 MUST NOT 再寫一份 `maxTouchPoints` / `pointer: coarse`(見檔頭與 A21 家族)。
  // 純滑鼠桌機 `touchCapable()` 恆 false ⇒ 逐位元同改制前。
  document.body.classList.toggle('touch-dev', touchCapable());
  document.body.classList.toggle('touch-lefty', on && TOUCH.lefty);
  document.body.classList.toggle('touch-screen-lefty', on && TOUCH.screenLefty);
  syncOrientation();
  if (!_installed) {
    _installed = true;
    window.addEventListener('resize', syncOrientation);
    window.addEventListener('orientationchange', syncOrientation);
    window.screen?.orientation?.addEventListener?.('change', syncOrientation);
    onCtrlChange(() => installTouchUI());
  }
  return on;
}

/** 左手模式即時套用(設定頁用;鏡像純 CSS,十字鍵位置由 CSS 定位、圓心每次落指重算 → 無需重建) */
export function applyLefty(on) {
  TOUCH.lefty = !!on;
  document.body.classList.toggle('touch-lefty', document.body.classList.contains('touch-ui') && TOUCH.lefty);
  saveTouchPrefs();
  syncCtrlSettings();
}

/** 畫面慣用手即時套用:只鏡像 HUD / 小地圖,不改觸控按鍵位置 */
export function applyScreenLefty(on) {
  TOUCH.screenLefty = !!on;
  document.body.classList.toggle('touch-screen-lefty',
    document.body.classList.contains('touch-ui') && TOUCH.screenLefty);
  saveTouchPrefs();
  syncCtrlSettings();
}

/**
 * 全螢幕切換(手機瀏覽器工具列會吃掉一大截畫面)。
 * 全螢幕 **MUST NOT 鎖方向**(2026-08-04 使用者需求「全螢幕時也可以旋轉手機切換直式/橫式」)——
 * 進全螢幕就 `unlock()`,轉手機照樣在直式/橫式版型之間切。
 * 舊版是「鎖成當下的持握」(比一律鎖橫向好,但仍是鎖):玩家躺著開全螢幕就被釘死在直式,
 * 想換橫式只能先退出全螢幕、轉好、再進一次 —— 中間還會掉一次 `resize`、畫布重算兩遍。
 * `unlock()` 而非「什麼都不做」:PWA manifest 的 `orientation` 與前一次全螢幕留下的鎖都會延續,
 * 不主動解就等於預設鎖著。版型切換本身不歸這裡管 —— `syncOrientation()` 已經在聽
 * `orientationchange` / `screen.orientation` 的 change,全螢幕內外走的是同一條路徑。
 */
export async function toggleFullscreen() {
  try {
    if (!document.fullscreenElement) {
      await (document.documentElement.requestFullscreen?.({ navigationUI: 'hide' })
        ?? document.documentElement.webkitRequestFullscreen?.());
      try { window.screen?.orientation?.unlock?.(); } catch { /* iOS 不支援 */ }
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
 * 瀏覽器只在 **secure context**(https / localhost)才派送 deviceorientation / devicemotion:
 * 用 `http://<區網 IP>:8620` 從手機開,事件**靜默不派送** —— 沒有錯誤、沒有權限提示、沒有 log,
 * 就是不動。伺服器請改用 `npm run mobile`(= `--https`,自簽憑證,見 server.js ensureCert)。
 * 回傳 null = 可以試;字串 = 不可能成功的原因(直接顯示給玩家,MUST NOT 靜默失敗)。
 */
export function gyroBlockedReason() {
  if (!window.isSecureContext) {
    return `陀螺儀需要 HTTPS 才會有感測器資料(目前是 ${location.protocol}//${location.hostname})`
      + ' —— 伺服器請改用 npm run mobile(= --https)';
  }
  // 兩條路徑任一支援就有機會:方向感測(融合姿態)/ 角速度(純陀螺儀,無磁力計也能用)
  if (!window.DeviceOrientationEvent && !window.DeviceMotionEvent) {
    return '此瀏覽器不支援 DeviceOrientationEvent / DeviceMotionEvent';
  }
  return null;
}

/**
 * 陀螺儀輔助瞄準(相對模式)—— 轉動手機 = 轉動準星朝向。
 * 絕對映射(手機朝哪、準星就朝哪)在 FPS 不可用 —— 要轉身 180° 就得整個人轉半圈;
 * 故取**每次事件的姿態差**疊加到視角上(= 主機遊戲的陀螺輔助),與拖曳視角可同時作用、互不重設。
 * 螢幕旋轉角納入補正 ⇒ 直式/橫式(含反向橫式)軸向自動正確,MUST NOT 改成手動換軸。
 *
 * ── 兩條感測路徑(**這是「開了但準星不動」的解法**)────────────────────────────
 * ① `orient` = `deviceorientation` / `deviceorientationabsolute`:瀏覽器融合過的**絕對姿態**,
 *    精度好、無漂移,但水平朝向(alpha)要**磁力計**。不少中低階機沒有磁力計、或系統關閉了
 *    「指南針校正」,結果是:事件照送、beta/gamma 有值、**alpha 恆為 null 或恆定**
 *    ⇒ 俯仰勉強能動、水平完全不動 —— 玩家的體感就是「陀螺儀無法控制準星」。
 *    更慘的情況是連 relative orientation sensor 都沒有 ⇒ 一筆事件都收不到。
 * ② `motion` = `devicemotion` 的 `rotationRate`:**純陀螺儀角速度**(度/秒),不需要磁力計、
 *    不需要融合姿態,幾乎所有有陀螺儀的手機都送得出來。把角速度投影到「畫面上方軸 / 畫面右軸」
 *    再積分,就是主機手把那種體感瞄準(Switch/PS 的陀螺輔助也是走本體角速度,不是絕對方位)。
 *
 * `auto`(預設)先試 ①,**看門狗**或**水平軸死亡偵測**判定不行就自動改走 ②;
 * 玩家也能在設定頁把來源鎖死(`TOUCH.gyroSrc`)——「自動猜錯」時不該沒有逃生門。
 * 兩條路徑的輸出**一律**經同一個 `_emit()` 收束(死區/反轉/靈敏度/累計統計只有一份)。
 *
 * `orient` 事件來源兩種都聽:`deviceorientation`(相對)與 `deviceorientationabsolute`。
 * **偏好相對版** —— absolute 在磁力計不穩的機器上可能只零星送個一兩筆,
 * 舊版「先到者贏」一旦鎖上 absolute 就等於凍住(收得到事件、姿態卻不更新)。
 */
class Gyro {
  constructor(onLook, onFail) {
    this.onLook = onLook;
    this.onFail = onFail;               // (reason) => void:兩條路徑都收不到資料時回報(UI 把開關扳回)
    this.active = false;
    this.granted = false;
    this.path = null;                   // 目前生效的路徑:'orient' | 'motion'
    this.source = null;                 // 實際在用的事件名(診斷用)
    this.events = 0;                    // 收到的事件數(診斷用:0 = 感測器沒在送)
    this.usable = 0;                    // 其中含有效資料的筆數
    this.note = '';                     // 自動切換的理由(診斷用)
    this._q = new THREE.Quaternion();
    this._q0 = new THREE.Quaternion();
    this._e = new THREE.Euler();
    this._f = new THREE.Vector3();
    this._have = false;
    this._yaw = 0; this._pitch = 0;
    this._rawYaw = 0; this._rawPitch = 0;   // 未過死區的累計位移(rad):水平軸死亡偵測用
    this._mt = 0;                           // devicemotion 上一筆時間戳(秒)
    this.last = null;                   // 最後一筆原始讀值(診斷/試玩讀值用)
    this.accYaw = 0; this.accPitch = 0; // 累計輸出角度(度):轉手機時這兩個數字會跑
    this._onOri = (ev) => this._readOrient(ev, 'deviceorientation');
    this._onAbs = (ev) => this._readOrient(ev, 'deviceorientationabsolute');
    this._onMotion = (ev) => this._readMotion(ev);
    // 轉螢幕 → 丟掉基準,下一個事件重新起算(兩條路徑都要:軸向補正跟著螢幕角走)
    this._reset = () => { this._have = false; this._mt = 0; };
  }

  /**
   * 還需不需要跟使用者要權限(iOS 13+)。**記憶開啟的偏好靠這支才活得下來** ——
   * iOS 的 `requestPermission()` 只在使用者手勢中可靠,進場自動套用偏好那條路徑不是手勢,
   * 硬要就是被拒 ⇒ 開關被扳回關閉並寫進偏好,玩家上一場親手打開的設定就這樣被抹掉。
   */
  needsPermission() {
    if (this.granted) return false;
    return typeof window.DeviceOrientationEvent?.requestPermission === 'function'
      || typeof window.DeviceMotionEvent?.requestPermission === 'function';
  }

  /**
   * iOS 13+ 需在使用者手勢中要求權限;其他平台直接可用。
   * **兩種事件各有各的 requestPermission** —— 只要到方向權限、之後 fallback 到 devicemotion
   * 一樣會被擋(iOS 實際上是同一個開關,但 API 得分別呼叫過才算數)。
   */
  async request() {
    if (gyroBlockedReason()) return false;
    let any = false;
    for (const D of [window.DeviceOrientationEvent, window.DeviceMotionEvent]) {
      if (!D) continue;
      if (typeof D.requestPermission !== 'function') { any = true; continue; }
      try { if ((await D.requestPermission()) === 'granted') any = true; } catch { /* 使用者拒絕 */ }
    }
    this.granted = any;
    return any;
  }

  start() {
    if (this.active) return;
    this.active = true;
    this._have = false; this._mt = 0;
    this.source = null; this.events = 0; this.usable = 0; this.note = '';
    this._rawYaw = 0; this._rawPitch = 0;
    this.accYaw = 0; this.accPitch = 0; this.last = null;
    window.addEventListener('orientationchange', this._reset);
    window.screen?.orientation?.addEventListener?.('change', this._reset);
    this._use(TOUCH.gyroSrc === 'motion' ? 'motion' : 'orient');
  }

  stop() {
    clearTimeout(this._wdT);
    if (!this.active) return;
    this.active = false;
    this._have = false;
    this._unbind();
    window.removeEventListener('orientationchange', this._reset);
    window.screen?.orientation?.removeEventListener?.('change', this._reset);
    this.path = null;
  }

  _unbind() {
    window.removeEventListener('deviceorientation', this._onOri);
    window.removeEventListener('deviceorientationabsolute', this._onAbs);
    window.removeEventListener('devicemotion', this._onMotion);
  }

  /** 切到某條感測路徑並重新起算看門狗(同一支入口 ⇒ 綁定/計數/逾時只有一份) */
  _use(path) {
    this._unbind();
    this.path = path;
    this.source = null;
    this.events = 0; this.usable = 0;
    this._have = false; this._mt = 0;
    this._rawYaw = 0; this._rawPitch = 0;
    if (path === 'orient') {
      window.addEventListener('deviceorientation', this._onOri);
      window.addEventListener('deviceorientationabsolute', this._onAbs);
    } else {
      window.addEventListener('devicemotion', this._onMotion);
    }
    // 看門狗:感測器不作動時瀏覽器不會報錯,只會什麼都不發生 ——
    // 沒有這條,玩家看到的就是「開關是綠的但完全沒反應」。
    clearTimeout(this._wdT);
    this._wdT = setTimeout(() => {
      if (!this.active || this.usable > 0) return;
      const dead = this.events === 0
        ? (path === 'orient' ? '裝置沒有送出方向感測資料' : '裝置沒有送出角速度資料')
        : (path === 'orient' ? '方向感測資料無效(角度為空值)' : '角速度資料無效(rotationRate 為空值)');
      // auto:換另一條路徑再試一次;鎖死來源就直接回報(玩家自己選的,不該偷偷換掉)
      if (path === 'orient' && TOUCH.gyroSrc === 'auto' && window.DeviceMotionEvent) {
        this.note = `${dead} → 改用角速度`;
        this._use('motion');
        return;
      }
      this.onFail?.(`${dead}(可能無陀螺儀,或系統/瀏覽器關閉了動作感測權限)`);
    }, LOOK.GYRO_WD_MS);
  }

  /** 感測來源偏好改變:重綁路徑並重新起算看門狗(權限沒變,不重新要) */
  retune() {
    if (!this.active) return;
    this.note = '';
    this._use(TOUCH.gyroSrc === 'motion' ? 'motion' : 'orient');
  }

  /** 目前狀態一句話(設定頁提示 + 除錯用) */
  status() {
    if (!this.active) return gyroBlockedReason() || '未啟用';
    const p = this.path === 'motion' ? '角速度' : '方向感測';
    const tail = this.note ? ` ・ ${this.note}` : '';
    if (this.usable > 0) return `運作中(${p}:${this.source},已收 ${this.events} 筆)${tail}`;
    return this.events ? `收到 ${p} 事件但資料為空值${tail}` : `等待${p}資料…${tail}`;
  }

  /**
   * 兩條路徑的**唯一輸出縫**:死區 → 靈敏度 → 垂直反轉 → 累計統計 → 送進 `_applyLook`。
   * MUST NOT 在各路徑裡各乘一次增益(那就是兩套手感)。
   */
  _emit(dy, dp) {
    this._rawYaw += Math.abs(dy);
    this._rawPitch += Math.abs(dp);
    const g = LOOK.GYRO_BASE * TOUCH.gyroSens;
    const oy = Math.abs(dy) < LOOK.GYRO_DEAD ? 0 : dy * g;
    const op = Math.abs(dp) < LOOK.GYRO_DEAD ? 0 : dp * g * (TOUCH.gyroInvert ? -1 : 1);
    if (!oy && !op) return;
    this.accYaw += oy * 180 / Math.PI;
    this.accPitch += op * 180 / Math.PI;
    this.onLook(oy, op);
  }

  /**
   * 水平軸死亡偵測:**手機明明轉了(俯仰累積夠多),水平卻幾乎沒動** = 沒有磁力計/alpha 恆定。
   * 這正是「陀螺儀無法控制準星」最常見的一種 —— 事件一直來、看門狗也不會響,但橫向永遠不動。
   * 只在 auto 下自動改走角速度;誤判的代價只是換一條同樣能用的路徑,故門檻取寬鬆值即可。
   */
  _checkYawDead() {
    if (this.path !== 'orient' || TOUCH.gyroSrc !== 'auto' || !window.DeviceMotionEvent) return;
    if (this._rawPitch < LOOK.GYRO_YAW_PROOF || this._rawYaw >= LOOK.GYRO_YAW_DEAD) return;
    this.note = '方向感測缺水平朝向(無磁力計)→ 改用角速度';
    this._use('motion');
  }

  /** 路徑 ①:融合姿態 → 取前後兩筆的 yaw/pitch 差 */
  _readOrient(ev, src) {
    if (!this.active || this.path !== 'orient') return;
    // 相對版優先:已在吃 deviceorientation 就不再理會 absolute(兩種混用會讓姿態差在不同基準間跳)
    if (this.source === 'deviceorientation' && src !== 'deviceorientation') return;
    this.events++;
    // beta/gamma 是傾角(必要);alpha 是水平朝向,少數裝置無磁力計會給 null ——
    // 這時**不能整筆丟掉**(那就等於陀螺儀全滅),alpha 當 0 仍可靠 beta/gamma 取得俯仰,
    // 水平朝向則交給 _checkYawDead 改走角速度路徑。
    if (ev.beta == null || ev.gamma == null) return;
    // 從 absolute 升級到相對版:基準要重來(兩者的 alpha 原點不同)
    if (this.source && this.source !== src) { this._have = false; }
    this.source = src;
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
    this._emit(dy, dp);
    this._checkYawDead();
  }

  /**
   * 路徑 ②:純陀螺儀角速度(度/秒)投影到畫面軸再積分。
   * `rotationRate` 的 {alpha,beta,gamma} 分別是繞**裝置** z / x / y 軸的角速度;
   * 螢幕旋轉角 θ 決定「畫面上方軸」= (sinθ, cosθ, 0)、「畫面右軸」= (cosθ, −sinθ, 0)(裝置座標)。
   *   水平轉頭 = 繞畫面上方軸(+ 為左轉,與 yaw 同號)
   *   抬頭低頭 = 繞畫面右軸(**同號**:手機頂端往自己這邊倒 ⇒ 仰視)。
   *              兩條路徑的俯仰方向 MUST 一致 —— 相機是朝機背方向看的,故 deviceorientation 的
   *              beta 由 90 降到 0(頂端前傾、螢幕朝天)= 俯視,對應 rotationRate.beta 為負。
   *              量測有斷言(合成事件比對兩條路徑的 pitch 同號),改號 MUST 重跑。
   * 不需要磁力計、不需要融合姿態 ⇒ 這是路徑 ① 失效時仍能動的原因。
   */
  _readMotion(ev) {
    if (!this.active || this.path !== 'motion') return;
    this.events++;
    const rr = ev.rotationRate;
    if (!rr || (rr.alpha == null && rr.beta == null && rr.gamma == null)) return;
    if (!this.source) this.source = 'devicemotion';
    this.usable++;
    // dt:優先用瀏覽器回報的取樣間隔(ms),沒有就用時間戳差;上限夾制免得延遲後暴衝
    const now = performance.now() / 1000;
    let dt = Number.isFinite(ev.interval) && ev.interval > 0 ? ev.interval / 1000 : (this._mt ? now - this._mt : 0);
    this._mt = now;
    dt = clamp(dt, 0, LOOK.GYRO_DT_MAX);
    this.last = { rateX: rr.beta ?? 0, rateY: rr.gamma ?? 0, rateZ: rr.alpha ?? 0, dt };
    if (!this._have) { this._have = true; return; }   // 第一筆只當基準(dt 還不可信)
    if (dt <= 0) return;
    const d2r = Math.PI / 180;
    const th = screenAngle() * d2r;
    const s = Math.sin(th), c = Math.cos(th);
    const wx = (rr.beta ?? 0) * d2r, wy = (rr.gamma ?? 0) * d2r;
    const dy = (wx * s + wy * c) * dt;     // 繞畫面上方軸 → 水平
    const dp = (wx * c - wy * s) * dt;     // 繞畫面右軸 → 俯仰
    if (Math.abs(dy) > LOOK.GYRO_JUMP || Math.abs(dp) > LOOK.GYRO_JUMP) return;
    this._emit(dy, dp);
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
  // 自動偵測猜錯時的逃生門:手機沒有 devtools,沒有這一列就只能「不會動就是不會動」。
  { key: 'gyroSrc', type: 'seg', label: '陀螺來源', opts: GYRO_SRC, optLabel: GYRO_SRC_LABEL,
    hint: '自動 = 方向感測優先,水平不動就改用角速度;角速度不需磁力計(轉不動時改這個)' },
  { key: 'gyroSens', type: 'range', label: '陀螺靈敏度', min: 40, max: 250 },
  { key: 'gyroInvert', type: 'switch', label: '陀螺垂直反轉', hint: '抬起手機 = 向下看' },
  { key: 'lookSens', type: 'range', label: '拖曳靈敏度', min: 40, max: 250 },
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

/**
 * 換過 `TOUCH.gyroSrc` 後重新起算(停→開)。**MUST 走這支** ——
 * 感測路徑是在 `Gyro.start()` 綁定的,只改偏好不重綁 = 玩家換了來源卻毫無變化。
 */
export async function restartGyro() {
  if (!_active) return TOUCH.gyro;
  // 已在跑:只重綁路徑。**MUST NOT** 用 setGyro(false) → setGyro(true) 繞一圈 ——
  // 那會再要一次 iOS 權限,而中間的 await 已經離開使用者手勢 ⇒ 有機會被拒、反而把陀螺關掉。
  if (_active.gyro.active) { _active.gyro.retune(); _active._syncGyroBtn(); return TOUCH.gyro; }
  return TOUCH.gyro ? _active.setGyro(true, true) : TOUCH.gyro;
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
const _ctrlMounts = [];    // 設定頁:目前操控(+ 操作方式唯讀狀態)
const _modeMounts = [];    // 戰區畫面:操作方式三選一(房主可改)
let _modeHost = false;     // 我是不是房主(由 main.js `syncCtrlModeRow()` 回報)
let _modePick = null;      // 房主按下時的上行回呼(main.js 傳:送 setRoomConfig)
const _esc = (t) => String(t).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const _tipDot = (cls) => tipHTML('', cls);

/**
 * **操作方式三選一(整房一致;2026-07-31 使用者定案「由房主選擇」)**。
 * 只掛在戰區畫面 —— 它是房間設定,不是個人偏好,故與電腦難度並列而不是躺在設定頁裡。
 *
 * 這一列 MUST NOT 自己改生效值:房主按下 → `opts.onPick(mode)`(main.js 送 `setRoomConfig`)
 * → 伺服器廣播 → `setRoomCtrlMode()` → 本列同步。客戶端先斬後奏 = 房主與隊友版型不同步。
 * 非房主一律停用(規則的落點仍在伺服器 —— 只有 hostId 的 `setRoomConfig` 會被受理)。
 */
export function renderCtrlModeRow(mount, opts = {}) {
  if (!mount) return;
  if (opts.onPick) _modePick = opts.onPick;
  if (mount.dataset.ctrlModeBuilt) { syncCtrlSettings(); return; }
  mount.dataset.ctrlModeBuilt = '1';
  const notice = opts.onNotice || (() => {});

  const row = document.createElement('div');
  row.className = 'set-row';
  row.innerHTML = (opts.bare ? '' : '<span class="set-label">操作方式</span>')
    + '<span class="seg seg-sm tset-ctrl">'
    + CTRL_MODE_KEYS.map((m) =>
      `<button class="segb" type="button" data-ctrl="${m}">${_esc(CTRL_MODES[m].icon)} ${_esc(CTRL_MODES[m].label)}</button>`).join('')
    + '</span>' + _tipDot('tset-ctrl-hint');
  mount.appendChild(row);
  for (const b of row.querySelectorAll('.segb')) {
    b.addEventListener('click', () => {
      if (!_modeHost) { notice('操作方式由房主決定 —— 整房一致', 4000); return; }
      const m = b.dataset.ctrl;
      setCtrlPref(m);        // 記成我的預設:下次自己開房沿用(生效值仍等伺服器廣播回來)
      _modePick?.(m);
      notice(`本戰區操作方式:${CTRL_MODES[m].label}`, 3000);
    });
  }
  _modeMounts.push(mount);
  syncCtrlSettings();
}

/** 戰區畫面每次重繪時回報「我是不是房主」(停用態的唯一驅動;值本身仍是伺服器廣播的那一份)*/
export function syncCtrlModeRow(isHost) {
  _modeHost = !!isHost;
  syncCtrlSettings();
}

/**
 * 設定頁的操作方式區塊:**唯讀狀態列 + 目前操控三選一**(2026-07-31 使用者定案
 * 「目前操控的選擇併入設定」)。大廳選單、手機操控面板、戰場暫停選單三處共用這一份 DOM,
 * MUST NOT 在 index.html / main.js 另寫一組 —— 兩份一定會漂。
 *
 * 啟用條件由 ctrlmode.js 決定,本函式只忠實反映:生效模式非「不限定」⇒ 目前操控停用
 * (這就是「遊戲中不可變更」)。MUST NOT 在這裡自己判 `app.phaseShown` 之類的畫面狀態。
 */
export function renderCtrlSettings(mount, opts = {}) {
  if (!mount || mount.dataset.ctrlBuilt) return;
  mount.dataset.ctrlBuilt = '1';
  const notice = opts.onNotice || (() => {});

  const modeRow = document.createElement('div');
  modeRow.className = 'set-row';
  modeRow.innerHTML = '<span class="set-label">操作方式</span>'
    + '<span class="set-val tset-ctrl-val"></span>' + _tipDot('tset-ctrl-hint');
  mount.appendChild(modeRow);

  const pickRow = document.createElement('div');
  pickRow.className = 'set-row';
  pickRow.innerHTML = '<span class="set-label">目前操控</span><span class="seg seg-sm tset-pick">'
    + CTRL_SCHEME_KEYS.map((s) =>
      `<button class="segb" type="button" data-scheme="${s}">${_esc(CTRL_SCHEMES[s].icon)} ${_esc(CTRL_SCHEMES[s].label)}</button>`).join('')
    + '</span>' + _tipDot('tset-pick-hint');
  mount.appendChild(pickRow);
  for (const b of pickRow.querySelectorAll('.segb')) {
    b.addEventListener('click', () => {
      if (!setCtrlScheme(b.dataset.scheme)) { notice('本戰區已限定操作方式,遊戲中不可變更 —— 要能隨時切換請請房主改選「不限定」', 5000); return; }
      syncCtrlSettings();
      notice(`目前操控:${CTRL_SCHEMES[ctrlScheme()].label}`, 3000);
    });
  }

  const viewRow = document.createElement('div');
  viewRow.className = 'set-row';
  viewRow.innerHTML = '<span class="set-label">視角模式</span><span class="seg seg-sm tset-view">'
    + VIEW_MODE_KEYS.map((v) =>
      `<button class="segb" type="button" data-view="${v}">${_esc(VIEW_MODES[v].icon)} ${_esc(VIEW_MODES[v].label)}</button>`).join('')
    + '</span>' + _tipDot('tset-view-hint');
  mount.appendChild(viewRow);
  for (const b of viewRow.querySelectorAll('.segb')) {
    b.addEventListener('click', () => {
      setViewMode(b.dataset.view);
      syncCtrlSettings();
      notice(`視角模式:${VIEW_MODES[viewMode()].label}`, 3000);
    });
  }

  const handRow = document.createElement('div');
  handRow.className = 'set-row';
  handRow.innerHTML = '<span class="set-label">按鍵慣用手</span><span class="seg seg-sm tset-hand">'
    + HAND_KEYS.map((hand) =>
      `<button class="segb" type="button" data-hand="${hand}">${_esc(HAND_LABEL[hand])}</button>`).join('')
    + '</span>' + _tipDot('tset-hand-hint');
  mount.appendChild(handRow);
  for (const b of handRow.querySelectorAll('.segb')) {
    b.addEventListener('click', () => {
      setHandedness(b.dataset.hand);
      syncCtrlSettings();
      notice(`慣用手:${HAND_LABEL[handedness()]}`, 3000);
    });
  }

  const screenHandRow = document.createElement('div');
  screenHandRow.className = 'set-row';
  screenHandRow.innerHTML = '<span class="set-label">畫面慣用手</span><span class="seg seg-sm tset-screen-hand">'
    + HAND_KEYS.map((hand) =>
      `<button class="segb" type="button" data-screen-hand="${hand}">${_esc(HAND_LABEL[hand])}</button>`).join('')
    + '</span>' + _tipDot('tset-screen-hand-hint');
  mount.appendChild(screenHandRow);
  for (const b of screenHandRow.querySelectorAll('.segb')) {
    b.addEventListener('click', () => {
      setScreenHandedness(b.dataset.screenHand);
      syncCtrlSettings();
      notice(`畫面慣用手:${HAND_LABEL[screenHandedness()]}`, 3000);
    });
  }
  _ctrlMounts.push(mount);
  syncCtrlSettings();
}

// 狀態一變(戰區定案 / 我的預設 / 目前操控)就把所有已渲染的操作方式 UI 同步一次。
// 訂閱 MUST 住這裡而不是 installTouchUI —— 少了它,「房主改了選項變灰」要等下次開設定頁才生效。
onCtrlChange(() => syncCtrlSettings());
onViewModeChange(() => syncCtrlSettings());

/** 把所有已渲染的操作方式 UI 同步到目前狀態(選取態 + 停用態 + 提示文字)*/
export function syncCtrlSettings() {
  const mode = ctrlMode(), scheme = ctrlScheme(), locked = ctrlLocked();
  const curView = viewMode();
  const warn = ctrlMismatchText();
  // ① 戰區畫面:三選一(房主可改;值恆是伺服器廣播的那一份)
  for (const mount of _modeMounts) {
    for (const b of mount.querySelectorAll('.tset-ctrl .segb')) {
      b.classList.toggle('on', b.dataset.ctrl === mode);
      b.disabled = !_modeHost;
    }
    const mh = mount.querySelector('.tset-ctrl-hint');
    if (mh) {
      mh.dataset.tip = (_modeHost ? '整房一致,由你決定 ・ ' : '整房一致,由房主決定 ・ ')
        + CTRL_MODES[mode].hint + (warn ? ` ${warn}` : '');
    }
  }
  // ② 設定頁:操作方式唯讀 + 目前操控三選一 + 視角模式二選一 + 按鍵/畫面左右手
  for (const mount of _ctrlMounts) {
    const mv = mount.querySelector('.tset-ctrl-val');
    if (mv) mv.textContent = `${CTRL_MODES[mode].icon} ${CTRL_MODES[mode].label}`;
    const mh = mount.querySelector('.tset-ctrl-hint');
    if (mh) {
      mh.dataset.tip = (locked ? '本戰區由房主指定,整房一致 ・ ' : '我的預設(自己開房時整房沿用;可在戰區畫面變更)・ ')
        + CTRL_MODES[mode].hint + (warn ? ` ${warn}` : '');
    }
    for (const b of mount.querySelectorAll('.tset-pick .segb')) {
      b.classList.toggle('on', b.dataset.scheme === scheme);
      b.disabled = mode !== 'any';
    }
    const ph = mount.querySelector('.tset-pick-hint');
    if (ph) {
      ph.dataset.tip = mode === 'any'
        ? `即時切換,不必重新載入。裝置判定為${CTRL_SCHEMES[deviceScheme()].label}。`
        : '已限定操作方式,遊戲中不可變更。';
    }
    for (const b of mount.querySelectorAll('.tset-view .segb')) {
      b.classList.toggle('on', b.dataset.view === curView);
    }
    for (const b of mount.querySelectorAll('.tset-hand .segb')) {
      b.classList.toggle('on', b.dataset.hand === handedness());
    }
    const hh = mount.querySelector('.tset-hand-hint');
    if (hh) hh.dataset.tip = '只鏡像觸控按鍵位置；不影響 HUD / 小地圖。';
    for (const b of mount.querySelectorAll('.tset-screen-hand .segb')) {
      b.classList.toggle('on', b.dataset.screenHand === screenHandedness());
    }
    const sh = mount.querySelector('.tset-screen-hand-hint');
    if (sh) sh.dataset.tip = '只鏡像觸控版 HUD / 小地圖位置；不影響按鍵位置。';
    const vh = mount.querySelector('.tset-view-hint');
    if (vh) {
      vh.dataset.tip = VIEW_MODES[curView]?.hint || '視角切換:第一人稱(座艙)/第三人稱(機體後方)';
    }
  }
}

/**
 * 把觸控設定列渲染進 mount(冪等:同一個 mount 只建一次)。
 * opts.onNotice(msg) —— 需要提示玩家時呼叫(main.js 傳 toast);不給就靜默。
 */
export function renderTouchSettings(mount, opts = {}) {
  if (!mount || mount.dataset.built) return;
  mount.dataset.built = '1';
  const notice = opts.onNotice || (() => {});
  const uid = (k) => `${mount.id}__${k}`;

  for (const d of TOUCH_SETTINGS) {
    const row = document.createElement('div');
    row.className = 'set-row';
    if (d.type === 'switch') {
      row.innerHTML = `<span class="set-label">${_esc(d.label)}</span>`
        + `<button class="switch" type="button" role="switch" aria-checked="false" id="${uid(d.key)}"`
        + ` aria-label="${_esc(d.label)}"><span></span></button>`
        + _tipDot(`tset-hint-${d.key}`)
        + `${d.status ? '<span class="set-hint">狀態:<b class="tset-stat"></b></span>' : ''}`;
      row.querySelector('.switch').addEventListener('click', async () => {
        const el = document.getElementById(uid(d.key));
        const on = el.getAttribute('aria-checked') !== 'true';
        if (d.key === 'gyro') {
          const ok = await setGyroPref(on);
          if (on && !ok) notice(gyroBlockedReason() || gyroStatusText(), 6000);
        } else { TOUCH[d.key] = on; saveTouchPrefs(); }
        syncTouchSettings();
      });
    } else if (d.type === 'seg') {
      row.innerHTML = `<span class="set-label">${_esc(d.label)}</span><span class="seg seg-sm" id="${uid(d.key)}">`
        + d.opts.map((o) => `<button class="segb" type="button" data-opt="${o}">${_esc(d.optLabel[o])}</button>`).join('')
        + `</span>` + _tipDot(`tset-hint-${d.key}`);
      for (const b of row.querySelectorAll('.segb')) {
        b.addEventListener('click', async () => {
          TOUCH[d.key] = b.dataset.opt;
          saveTouchPrefs();
          if (d.key === 'gyroSrc') await restartGyro();   // 換來源要重綁事件,不然改了也沒感覺
          syncTouchSettings();
        });
      }
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
  syncCtrlSettings();   // 操作方式列可能與觸控設定掛在同一個面板裡,一起同步(自身冪等)
  for (const mount of _mounts) {
    for (const d of TOUCH_SETTINGS) {
      const el = document.getElementById(`${mount.id}__${d.key}`);
      if (!el) continue;
      const dot = mount.querySelector(`.tset-hint-${d.key}`);
      if (dot && d.hint) dot.dataset.tip = d.hint;
      if (d.type === 'switch') el.setAttribute('aria-checked', TOUCH[d.key] ? 'true' : 'false');
      else if (d.type === 'seg') {
        for (const b of el.querySelectorAll('.segb')) b.classList.toggle('on', b.dataset.opt === TOUCH[d.key]);
      } else {
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
// 變形者兩種型態共用 B(地面蓄力變形彈射 / 飛行中上升)⇒ 鈕面寫「躍/升」,細節看角色數據欄。
const MOBIL_LABEL = { drone: '上升', morph: '躍/升', mech: '跳躍', robot: '跳躍' };

/**
 * 戰場虛擬搖桿。由 BattleClient._initInput() 在觸控版時建立,dispose() 時銷毀。
 * DOM 掛點全部在 index.html 的 #touchLayer(靜態骨架 + data-act),本檔只綁事件:
 *   - #tlLook  :全畫面拖曳視角(壓在所有控件之下;控件自行吃掉事件)
 *   - #tlStick :移動類比搖桿(左上;圓心固定 = 搖桿中心,偏移量 = 推杆量)
 *   - #tlRStick:視角類比搖桿(右下;推杆量 → 每秒轉速,與拖曳並存)
 *   - #tlDpad  :十字鍵 —— 四向是**按鍵**(上 ⊟ 商店 / 下 陀螺 / 右 小地圖範圍 / 左 招式)
 *   - [data-act]:動作鈕(ABXY / 肩鍵與系統鍵直條)
 * 角色數據(.hud-self)與小地圖(#minimap)是純顯示,**MUST NOT** 被搖桿覆蓋(版型量測有斷言)。
 */
export class TouchControls {
  constructor(client) {
    this.client = client;
    this.axis = { f: 0, r: 0, mag: 0 };   // 移動輸入(_moveAxis 讀;鍵盤未按時才生效)
    this.layer = document.getElementById('touchLayer');
    this.lookPad = document.getElementById('tlLook');
    this._lookId = null;
    this._lookX = 0; this._lookY = 0;
    // 空處雙擊開火手勢(見 _bindLook):上一次輕點的結束時刻/位置、本次按壓的起點與判定狀態
    this._tapAt = 0; this._tapX = 0; this._tapY = 0;
    this._downAt = 0; this._downX = 0; this._downY = 0;
    this._fireArm = false;    // 本次按壓是「雙擊的第二點」⇒ 按久或拖動就開火
    this._lookFire = false;   // 本手勢目前正在開火(放開才收)
    this._held = new Map();   // pointerId → act(按住型搖桿鈕:A 射擊 / R 狙擊 / ZR 鎖定 / B 跳躍 / ZL 下降)
    this._tap = new Map();    // pointerId → 待定案的點擊型按壓 { act, el, x, y, t }(見 _bindButtons)
    // 兩支類比搖桿共用同一份判定(_bindStick):移動的推杆量餵 axis,視角的推杆量餵每幀轉速。
    this.moveStick = null;
    this.lookStick = null;
    this.gyro = new Gyro(
      (dy, dp) => this._gyroLook(dy, dp),
      (why) => this._gyroDead(why),
    );

    _active = this;
    if (this.layer) this.layer.hidden = false;
    this._bindLook();
    this._bindSticks();
    this._bindButtons();
    this._bindRotateHint();
    this._off = false;
    this.syncBlocked();
    this.setKind(client.heroKind);
    if (TOUCH.gyro) this.setGyro(true, true);   // 記憶開啟:靜默續用(不可用時 onFail 會自行關掉)
    this._syncGyroBtn();
  }

  /* ---- 視角:拖曳(+ 空處雙擊開火手勢)---- */
  /**
   * `#tlLook` 是滿版的「沒有控件的空處」,原本只吃拖曳視角。這裡再疊一個**雙擊開火**手勢:
   * **輕點一下 → 再按下去不放(或直接拖)= 持續射擊**,放開即停;拖曳期間視角照常跟著轉,
   * 所以「邊瞄邊打」是同一根拇指、不必移到 A 鈕。
   *
   * 判定 MUST 先要求一次**完整的輕點**(短於 TAP_MS 且位移小於 TAP_SLOP_PX),
   * 第二點再等 TAP_FIRE_MS 或拖過 TAP_FIRE_PX 才真的開火 —— 少了哪一段,
   * 「單指拖曳轉視角」這個每秒都在做的動作都會變成誤擊發。純雙擊(點兩下就放開)刻意不開火:
   * 那個手勢在觸控介面上太容易由捲動/誤觸產生。
   *
   * 開火一律走 `client._cmd('fire', …)`(與 A 鈕、鍵鼠同一個派發縫),
   * MUST NOT 直接改 `client.firing`。
   */
  _bindLook() {
    if (!this.lookPad) return;
    this._onLookDown = (e) => {
      if (this._lookId !== null || this._blocked()) return;
      this._lookId = e.pointerId;
      this._lookX = e.clientX; this._lookY = e.clientY;
      const now = performance.now();
      // 這一點算不算「雙擊的第二點」:上一次輕點剛結束、且落在同一個位置附近
      this._fireArm = this._tapAt > 0 && now - this._tapAt <= LOOK.TAP_GAP_MS
        && Math.hypot(e.clientX - this._tapX, e.clientY - this._tapY) <= LOOK.TAP_SLOP_PX;
      this._tapAt = 0;   // 用掉就清:MUST NOT 讓一次輕點連續配對出好幾發(點三下 = 一次雙擊,不是兩次)
      this._downAt = now; this._downX = e.clientX; this._downY = e.clientY;
      capture(this.lookPad, e.pointerId);
      e.preventDefault();
    };
    this._onLookMove = (e) => {
      if (e.pointerId !== this._lookId) return;
      const dx = e.clientX - this._lookX, dy = e.clientY - this._lookY;
      this._lookX = e.clientX; this._lookY = e.clientY;
      if (this._blocked()) return;
      // 拖曳路徑:第二點一動就開火(門檻比輕點的 SLOP 小 ⇒ 「雙擊後拖曳」不必等時間)
      if (this._fireArm && !this._lookFire
        && Math.hypot(e.clientX - this._downX, e.clientY - this._downY) >= LOOK.TAP_FIRE_PX) {
        this._setLookFire(true);
      }
      const s = LOOK.TOUCH_RAD_PX * TOUCH.lookSens;
      this.client._applyLook(-dx * s, -dy * s);
      e.preventDefault();
    };
    this._onLookUp = (e) => {
      if (e.pointerId !== this._lookId) return;
      this._lookId = null;
      const now = performance.now();
      // 這一次按壓夠短、夠不動 ⇒ 記成一次「輕點」,供下一次落指配對成雙擊。
      // 已經在開火的手勢不算輕點(不然放開就又武裝好下一發)。
      const tap = !this._lookFire && now - this._downAt <= LOOK.TAP_MS
        && Math.hypot(e.clientX - this._downX, e.clientY - this._downY) <= LOOK.TAP_SLOP_PX;
      this._tapAt = tap && !this._fireArm ? now : 0;
      this._tapX = this._downX; this._tapY = this._downY;
      this._fireArm = false;
      this._setLookFire(false);
    };
    this.lookPad.addEventListener('pointerdown', this._onLookDown);
    this.lookPad.addEventListener('pointermove', this._onLookMove);
    this.lookPad.addEventListener('pointerup', this._onLookUp);
    this.lookPad.addEventListener('pointercancel', this._onLookUp);
  }

  /**
   * 空處手勢的開火開關。**放開時的 `fire,false` 要先確認 A 鈕沒被按著** ——
   * 兩條路徑共用同一個 `firing` 旗標,不檢查的話「A 按著 + 空處手勢放開」會把射擊直接切斷。
   */
  _setLookFire(on) {
    if (on === this._lookFire) return;
    if (on && this._blocked()) return;
    this._lookFire = on;
    if (!on && [...this._held.values()].includes('fire')) return;   // A 鈕仍按著 → 不代 A 放手
    this.client._cmd('fire', on);
    if (on) this._haptic(6);
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

  /**
   * 疊層(戰場選單 / 商店 / 結束畫面)開著時**整層收起來**。由主迴圈每幀呼叫,狀態沒變就早退。
   *
   * 這不只是「畫面乾淨」——**沒有這條,疊層上的按鈕一顆都按不到**:
   *   `#game` 是 `position: fixed`,而 fixed **本身就會建立堆疊脈絡**(z-index: auto 也一樣),
   *   所以 `#game` 整棵子樹在根脈絡裡等同 z 0 —— 疊層寫的 z 20 只在 `#game` 內部有意義。
   *   本層(z 9)住在 body,於是**壓在整個 #game 之上**,而 `#tlLook` 又是滿版 `pointer-events: auto`
   *   ⇒ 疊層的每一次點擊都被搖桿層吃掉:選單/商店開了以後任何按鍵都沒反應、也關不掉。
   * 單靠調 z-index 修不了(#game 是一個脈絡,外面找不到「介於畫布與疊層之間」的層級),
   * 故 MUST 用「疊層開著就收起搖桿」這條。陣亡頁**不收** —— 那頁沒有自己的按鈕,
   * 玩家得靠搖桿的 ⊟ 商店買升級(收掉就等於卡死在倒數畫面)。
   */
  /**
   * 每幀入口(game.js 主迴圈呼叫)。**三件事只有這一個縫**:
   *   ① 疊層開關 → 收起/放回整層(見 syncBlocked)
   *   ② 視角搖桿積分 → 推杆量 × 轉速 × dt 疊進 `_applyLook`
   *   ③ 「按住多久」類的判定 → 空處手勢開火(`_tickLookFire`)與點擊型鈕逾時(`_tickTap`)
   * 視角搖桿是**持續**輸入(按著就一直轉),故 MUST 在幀迴圈積分,MUST NOT 在 pointermove 裡算
   * ——— 手指不動就收不到事件,視角會停住,那是「拖曳」不是「搖桿」。
   * ③ 同理:手指按著不動時 pointermove 一筆都不會來。
   */
  tick(dt) {
    this.syncBlocked();
    this._tickLookFire();
    this._tickTap();
    const st = this.lookStick;
    if (!st || st.mag <= 0 || this._blocked()) return;
    // 響應曲線:小推細膩、推到底才全速(比照主機手把;線性推杆在 FPS 上很難微調)
    const sp = LOOK.LOOK_RAD_S * TOUCH.lookSens * Math.pow(st.mag, LOOK.LOOK_CURVE) * dt;
    const ux = st.x / st.mag, uy = st.y / st.mag;   // st.x/y 已含推杆量,取單位方向再乘曲線速度
    this.client._applyLook(-ux * sp, uy * sp);      // 右推 = 向右轉(yaw 減);上推 = 抬頭
  }

  /**
   * 空處雙擊手勢的**長按**路徑:手指按著不動就收不到 pointermove ⇒ 「按住多久」MUST 在幀迴圈判定
   * (與視角搖桿同理)。疊層開起來時順手收掉射擊 —— 收起整層後就收不到 pointerup 了。
   */
  _tickLookFire() {
    if (this._lookFire && this._blocked()) { this._setLookFire(false); return; }
    if (!this._fireArm || this._lookFire || this._lookId === null) return;
    if (performance.now() - this._downAt >= LOOK.TAP_FIRE_MS) this._setLookFire(true);
  }

  syncBlocked() {
    const off = this._blocked();
    if (off === this._off) return;
    this._off = off;
    if (off) this.reset();                       // 收起前先放掉按住中的鈕(收起後收不到 pointerup)
    if (this.layer) this.layer.hidden = off;
    document.body.classList.toggle('tl-off', off);
  }

  /* ---- 類比搖桿(移動 / 視角)---- */
  // 排位照實體手把(Switch / PS5 / Xbox):**左上移動搖桿、右下視角搖桿**;
  // 十字鍵(左下)在這套配置裡是「四顆按鍵」,走 _bindButtons 的 data-act 委派,不在此處。
  //
  // 兩支搖桿 **MUST 共用這一份判定** —— 死區、推杆量正規化、圓心量測、指標捕捉只有一套實作;
  // 差別只在 onVec 拿推杆量去做什麼(移動 → 寫 axis 給 _moveAxis;視角 → 存起來由 tick 積分)。
  _bindStick(el, knob, onVec) {
    if (!el) return null;
    const st = { el, knob, id: null, cx: 0, cy: 0, r: 70, x: 0, y: 0, mag: 0 };
    // 圓心每次落指才量:CSS 版型(直/橫式、左手鏡像)會改位置,快取住就會整支偏掉
    const move = (cx, cy) => {
      const dx = cx - st.cx, dy = cy - st.cy;
      const len = Math.hypot(dx, dy);
      let mag = Math.min(1, len / st.r);
      // 死區 → 重新拉伸到 0~1(免得手指微動就爬行/緩慢飄視角)
      mag = mag < LOOK.STICK_DEAD ? 0 : (mag - LOOK.STICK_DEAD) / (1 - LOOK.STICK_DEAD);
      if (mag <= 0 || len < 0.001) { st.x = 0; st.y = 0; st.mag = 0; }
      else { st.x = dx / len * mag; st.y = -dy / len * mag; st.mag = mag; }   // y 向上為正
      this._stickPaint(st);
      onVec(st);
    };
    st.onDown = (e) => {
      if (st.id !== null || this._blocked()) return;
      st.id = e.pointerId;
      const r = el.getBoundingClientRect();
      st.cx = r.left + r.width / 2;
      st.cy = r.top + r.height / 2;
      st.r = r.width / 2 || 70;
      move(e.clientX, e.clientY);
      capture(el, e.pointerId);
      e.preventDefault();
      e.stopPropagation();
    };
    st.onMove = (e) => { if (e.pointerId === st.id) { move(e.clientX, e.clientY); e.preventDefault(); } };
    st.onUp = (e) => {
      if (e.pointerId !== st.id) return;
      st.id = null; st.x = 0; st.y = 0; st.mag = 0;
      this._stickPaint(st);
      onVec(st);
    };
    el.addEventListener('pointerdown', st.onDown);
    el.addEventListener('pointermove', st.onMove);
    el.addEventListener('pointerup', st.onUp);
    el.addEventListener('pointercancel', st.onUp);
    return st;
  }

  _bindSticks() {
    this.moveStick = this._bindStick(
      document.getElementById('tlStick'), document.getElementById('tlStickKnob'),
      (st) => {
        this.axis.f = st.y; this.axis.r = st.x; this.axis.mag = st.mag;
        this.client._cmd('sprint', st.mag >= LOOK.SPRINT_MAG);
      });
    this.lookStick = this._bindStick(
      document.getElementById('tlRStick'), document.getElementById('tlRStickKnob'),
      () => { /* 視角是**持續**輸入:實際套用在 tick(dt),這裡只留推杆量 */ });
  }

  /** 桿頭位移 + 推到底的衝刺高亮(純視覺回饋;軸值已在 _bindStick 定案) */
  _stickPaint(st) {
    if (st.knob) {
      st.knob.style.transform = st.mag > 0
        ? `translate(${st.x * st.r * 0.42}px, ${-st.y * st.r * 0.42}px)` : '';
    }
    st.el.classList.toggle('on', st.mag > 0);
    st.el.classList.toggle('on-run', st.mag >= LOOK.SPRINT_MAG);
  }

  /* ---- 動作鈕 ---- */
  /**
   * 兩類鈕、兩條規則:
   *   **按住型**(`HOLD`:A 射擊 / R 狙擊 / ZR 鎖定 / B 跳躍 / ZL 下降)—— 按下即送 `act↓`、
   *     放開送 `act↑`。「按住」本身就是語意,MUST NOT 拿點擊判定去閘它(拇指在射擊中微微滑動
   *     是常態,判成「不是點擊」就會在交火中途停火)。
   *   **點擊型**(其餘全部:商店 / 地圖 / 招式 / 小招 / 大招 / 填彈 / 換機 / HOME / 全螢幕 / 陀螺 / 左手)——
   *     **一次點擊 = 距離 + 時間**(2026-08-16,`docs/anime_style_plan.md` ⑧-1):
   *     按下只亮鈕面,派發等到**放開**才定案,而且位移 MUST ≤ `LOOK.TAP_SLOP_PX`、
   *     時長 MUST ≤ `LOOK.TAP_MS`,`pointercancel`(系統手勢接管)一律不算。
   *
   * 為什麼點擊型不能在 `pointerdown` 就派發:那條路徑**沒有機會反悔**。手指從搖桿邊緣滑出去、
   * 或落指落在鈕上才發現想按的是隔壁,舊制當場就送出去了 —— 症狀是「我沒按商店它自己開了」,
   * 而且完全不會留下任何錯誤訊息。代價是點擊延遲一個抬指(數十毫秒),與所有原生介面一致。
   *
   * 時間那一半 MUST 在**幀迴圈**判定(`_tickTap`):手指按著不動就收不到 `pointermove`,
   * 只在放開時檢查的話,鈕面會亮著等玩家抬指才熄 —— 與 `_tickLookFire` 同一條理由。
   */
  _bindButtons() {
    const HOLD = new Set(['fire', 'aim', 'jump', 'dive', 'lock']);
    this._onBtnDown = (e) => {
      const el = e.target.closest?.('[data-act]');
      if (!el) return;
      const act = el.dataset.act;
      // `.off`(陀螺儀不可用的 ⚠ 警示)**MUST NOT** 連自己都按不動 ——
      // 舊版在這裡就 return,結果是「鈕標了警示、按下去卻毫無反應也沒有理由」:
      // 那顆鈕的用途正是按下去把原因寫進戰報,故只擋別的鈕、放行 gyro。
      if (el.classList.contains('off') && act !== 'gyro') return;
      e.preventDefault();
      e.stopPropagation();
      // 觸覺與鈕面**仍在按下當下**給(回饋要先於動作;點擊型只是把「動作」延到放開)
      this._haptic(act === 'fire' ? 6 : 10);
      el.classList.add('press');
      if (HOLD.has(act)) {
        this._held.set(e.pointerId, act);
        this.client._cmd(act, true);
        capture(el, e.pointerId);
      } else {
        this._tap.set(e.pointerId, { act, el, x: e.clientX, y: e.clientY, t: performance.now() });
      }
    };
    // 拖走就取消:距離那一半只有在 pointermove 上判得到。`_tap` 空的時候直接早退 ——
    // 這條委派掛在 document 上,拖曳視角的每一筆 move 都會經過。
    this._onBtnMove = (e) => {
      if (!this._tap.size) return;
      const p = this._tap.get(e.pointerId);
      if (p && !this._tapNear(p, e.clientX, e.clientY)) this._dropTap(e.pointerId, p);
    };
    this._onBtnUp = (e) => {
      const p = this._tap.get(e.pointerId);
      if (p) {
        this._tap.delete(e.pointerId);
        const el = p.el;
        setTimeout(() => el.classList.remove('press'), 110);   // 最短亮燈時間(同舊制)
        if (this._tapOk(p, e) && !this._local(p.act, el)) this.client._cmd(p.act, true);
      }
      const act = this._held.get(e.pointerId);
      if (!act) return;
      this._held.delete(e.pointerId);
      // A 放手時空處手勢還在射擊 → 不送 fire↑(兩條路徑共用同一個 firing 旗標,見 _setLookFire)
      if (!(act === 'fire' && this._lookFire)) this.client._cmd(act, false);
      document.querySelectorAll(`[data-act="${act}"].press`).forEach((n) => n.classList.remove('press'));
    };
    // 委派在 document 上:搖桿鈕與 #civPrompt 裡的平民鈕共用同一條派發路徑
    document.addEventListener('pointerdown', this._onBtnDown, true);
    document.addEventListener('pointermove', this._onBtnMove, true);
    document.addEventListener('pointerup', this._onBtnUp, true);
    document.addEventListener('pointercancel', this._onBtnUp, true);
  }

  /** 位移還在「輕點」容差內嗎(門檻與空處輕點同一組,見 LOOK.TAP_SLOP_PX 那段註解)*/
  _tapNear(p, x, y) { return Math.hypot(x - p.x, y - p.y) <= LOOK.TAP_SLOP_PX; }

  /** 這一次按壓算不算一次點擊:取消的不算、拖走的不算、按太久的不算 */
  _tapOk(p, e) {
    return e.type !== 'pointercancel' && this._tapNear(p, e.clientX, e.clientY)
      && performance.now() - p.t <= LOOK.TAP_MS;
  }

  /** 放棄一個待定案的按壓(熄燈 + 除帳);拖走與逾時共用這一支 */
  _dropTap(id, p) {
    p.el.classList.remove('press');
    this._tap.delete(id);
  }

  /**
   * 點擊型鈕的**時間**那一半:按著不動收不到 `pointermove` ⇒ MUST 在幀迴圈判定。
   * 逾時當場熄燈 —— 玩家看得到「這一下沒被算成點擊」,而不是抬指才發現什麼都沒發生。
   */
  _tickTap() {
    if (!this._tap.size) return;
    const now = performance.now();
    for (const [id, p] of this._tap) {
      if (now - p.t > LOOK.TAP_MS) this._dropTap(id, p);
    }
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
      setHandedness(TOUCH.lefty ? 'right' : 'left');
      el.classList.toggle('on', TOUCH.lefty);
      this.client.hud?.feed?.(TOUCH.lefty ? '🖐 按鍵慣用手:左手' : '🖐 按鍵慣用手:右手');
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
      // 靜默啟用(進場自動套用偏好)+ 尚未授權:**MUST NOT** 在這裡要權限 ——
      // 那不是使用者手勢,iOS 會直接拒,結果是把玩家上一場親手開啟的偏好也一併關掉。
      // 保留偏好、把「陀螺」鈕留在待授權狀態,並告訴玩家按一下就好。
      if (silent && this.gyro.needsPermission()) {
        this._syncGyroBtn();
        this.client.hud?.feed?.('🧭 陀螺儀待授權:按一下十字鍵下的「陀螺」鈕允許「動作與方向」');
        return TOUCH.gyro;
      }
      // 已授權過就不再要一次 —— iOS 的 requestPermission 只在使用者手勢中可靠,
      // 從設定頁/記憶開啟等非手勢路徑重複呼叫反而可能被拒。
      const ok = this.gyro.granted || await this.gyro.request();
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
   *   ② ZL 下降只在飛行機種(無人機/變形者)與觀戰自由視角出現。
   *   ③ 換機(R 區系統鍵)只給無人機三機小隊。
   *   ④ 觀戰沒有座機:A / R / ZR 鎖定 / ⊟ 一律收掉(_cmd 對 side=null 不受理,留著只會誤按)。
   *      **HOME 戰場選單不收**(2026-07-31 使用者需求「觀戰也可以按 ESC」)—— 觀戰者同樣要有
   *      離開戰場的出口,`_setPaused` 已對 side=null 放行,桌機觀戰按 ESC 走的是同一條路。
   *      **十字鍵的陀螺與地圖不收** —— 觀戰自由視角同樣吃 _applyLook,也同樣看小地圖。
   *   ⑤ 觀戰視角切換(2026-08-02 使用者需求「觸控使用虛擬手把加入切換」)**沿用既有兩顆鈕、
   *      只換鈕面字**:十字鍵左(招式位)= 循環四種視角(上帝 → 第一人稱 → 第三人稱跟隨 →
   *      第三人稱自由,序取自 `data.js SPEC_CAM.VIEWS`)、⇄(換機位)= 換下一位玩家。
   *      A22「同功能只准一顆鈕」⇒ MUST NOT 為觀戰另長出新鈕(四分區版型已滿,新鈕必然疊到別區);
   *      派發仍走 `game._cmd` → `_specFollow` 同一個縫,MUST NOT 在觸控層自己判模式。
   */
  setKind(kind) {
    const spec = !kind;                          // 觀戰自由視角(無機體)
    const mob = MOBIL_LABEL[kind] || MOBIL_LABEL.mech;
    const bf = document.querySelector('.gb-b .gb-f');
    if (bf) bf.textContent = spec ? '上升' : mob;
    const fly = spec || kind === 'drone' || kind === 'morph';
    document.querySelectorAll('[data-act="dive"]').forEach((n) => { n.hidden = !fly; });
    document.querySelectorAll('[data-act="swap"]').forEach((n) => { n.hidden = !spec && kind !== 'drone'; });
    document.querySelectorAll('.gb-a, .gb-aim, [data-act="shop"], [data-act="lock"]')
      .forEach((n) => { n.hidden = spec; });
    // 鈕面字:觀戰借用招式/換機兩顆鈕(功能不同 ⇒ 字一定要跟著換,否則按下去與鈕面不符)
    const sf = document.querySelector('[data-act="special"] .gb-f');
    if (sf) sf.textContent = spec ? '視角' : '招式';
    document.querySelectorAll('[data-act="swap"]').forEach((n) => { n.textContent = spec ? '⇄換人' : '⇄換機'; });
    document.body.classList.toggle('tl-spec', spec);
  }

  /** 凍結輸入(開選單/商店時由 _setPaused 呼叫):放掉所有按住狀態,免得放手事件被吃掉後卡住 */
  reset() {
    this.axis.f = 0; this.axis.r = 0; this.axis.mag = 0;
    this._lookId = null;
    this._setLookFire(false);            // 空處手勢的射擊也要放掉(收起整層後收不到 pointerup)
    this._fireArm = false; this._tapAt = 0;
    for (const st of [this.moveStick, this.lookStick]) {
      if (!st) continue;
      st.id = null; st.x = 0; st.y = 0; st.mag = 0;
      this._stickPaint(st);
    }
    for (const act of this._held.values()) this.client._cmd(act, false);
    this._held.clear();
    this._tap.clear();      // 待定案的點擊一律作廢:收起整層後收不到 pointerup(同 _held)
    document.querySelectorAll('[data-act].press').forEach((n) => n.classList.remove('press'));
  }

  dispose() {
    if (_active === this) _active = null;
    this._lookFire = false; this._fireArm = false; this._tapAt = 0;
    document.body.classList.remove('tl-off');   // 收起狀態 MUST 跟著銷毀清掉(大廳試玩會重建本層)
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
    for (const st of [this.moveStick, this.lookStick]) {
      if (!st) continue;
      st.el.removeEventListener('pointerdown', st.onDown);
      st.el.removeEventListener('pointermove', st.onMove);
      st.el.removeEventListener('pointerup', st.onUp);
      st.el.removeEventListener('pointercancel', st.onUp);
    }
    document.removeEventListener('pointerdown', this._onBtnDown, true);
    document.removeEventListener('pointermove', this._onBtnMove, true);
    document.removeEventListener('pointerup', this._onBtnUp, true);
    document.removeEventListener('pointercancel', this._onBtnUp, true);
    this._tap.clear();
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
    tc.tick(1 / 60);          // 試玩也要跑幀迴圈 —— 視角搖桿是持續輸入,不跑 tick 就完全沒反應
    const g = tc.gyro;
    const L = g.last;
    const raw = !L ? '—'
      : g.path === 'motion'
        ? `ω x ${L.rateX.toFixed(1)} y ${L.rateY.toFixed(1)} z ${L.rateZ.toFixed(1)} °/s ・ dt ${(L.dt * 1000).toFixed(0)}ms`
        : `α ${L.alpha == null ? '—(無磁力計)' : L.alpha.toFixed(0) + '°'} β ${L.beta.toFixed(0)}° γ ${L.gamma.toFixed(0)}°`;
    readEl.innerHTML = `<b>搖桿試玩</b>(這裡有反應 = 觸控層正常)`
      + `<div>移動搖桿 前後 <b>${tc.axis.f.toFixed(2)}</b> 左右 <b>${tc.axis.r.toFixed(2)}</b> 推杆量 <b>${tc.axis.mag.toFixed(2)}</b></div>`
      + `<div>視角搖桿 左右 <b>${(tc.lookStick?.x ?? 0).toFixed(2)}</b> 上下 <b>${(tc.lookStick?.y ?? 0).toFixed(2)}</b></div>`
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
