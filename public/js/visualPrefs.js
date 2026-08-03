// ============ 畫面表現微調(art-direction 旋鈕的唯一縫)============
// docs/visual_upgrade_plan.md 有幾項卡在同一句話上:**「需要美術方向確認」**。
// P1-B(陰影偏色搬進 ramp)那一條寫得最直白 ——「這會改掉每一台機甲的陰影色相,
// 動手前先確認方向,不要跟別的批次綁在一起」。P2-A(風化場)同理:場本身是算出來的,
// 但「要多明顯」是口味不是推導。
//
// 這種東西**不該由 commit 決定**:一個人在自己螢幕上調到滿意,推上去換一台螢幕又不對。
// 故把這幾個旋鈕做成**設定頁的拉桿 + 即時樣品**,由使用者自己定案;程式只負責
//   ① 只有一份數值(本檔),② 預設值 = 逐位元同舊制,③ 改了立刻看得到。
//
// 三條紀律:
//   ① `def` 那一欄是**交付定案值**,不是隨手填的中間值。**卡在「需要美術方向確認」的兩項
//      (shadowMech / shadowEnv)定案值就是 0 = 逐位元同舊制** —— 沒動過拉桿的玩家 MUST
//      看到與這批改動之前完全相同的畫面,否則「加了個設定」就變成「偷偷改了所有人的畫面」。
//      已經定案的兩項(ink / weather)則是 1 = 這批交付的調校值。
//   ② 這是**純表現層**偏好(原則 4),與 `lowPower` 同層級:只住 localStorage、不上行、
//      不進快照、不參與任何判定。伺服器完全不知道它的存在。
//   ③ 消費端 MUST 訂閱 `onVisualChange` 並更新**共享 uniform**,MUST NOT 在改值時重建材質
//      —— 重建材質的話拉桿會卡成幻燈片,而且戰鬥中根本改不動(材質早就發到 GPU 了)。
//
// 本檔**零 import**(同 rng.js 的理由):離線稽核要能直接執行它驗預設值與夾制,
// 綁上 three 就得再抄一份。

const KEY = 'svs_visual';

/**
 * 旋鈕表(單一真相)。
 *   def   預設值 —— **MUST 等於「這一項不生效」的值**(見紀律①)
 *   min/max/step  拉桿範圍;`unit` 只影響顯示
 *   sample 樣品畫面要示範哪一種材質(matsample.js 用;null = 全部)
 */
export const VISUAL_KNOBS = {
  shadowMech: {
    label: '機體陰影偏色', def: 0, min: 0, max: 1, step: 0.05, unit: '%',
    hint: '機甲 / 英雄 / 武器的暗面往天光藍偏移。0% = 只變暗(舊制)。',
  },
  shadowEnv: {
    label: '環境陰影偏色', def: 0, min: 0, max: 1, step: 0.05, unit: '%',
    hint: '地形 / 建物 / 岩石的暗面偏移量,疊在既有的環境冷色之上。',
  },
  ink: {
    label: '勾線強度', def: 1, min: 0, max: 1.5, step: 0.05, unit: '%',
    hint: '螢幕空間描邊的墨色濃度。0% = 沒有線,100% = 現行調校值。',
  },
  weather: {
    label: '風化密度', def: 1, min: 0, max: 1.5, step: 0.05, unit: '%',
    hint: '苔蘚 / 水漬跟著「這一區比較老」的屬性場起伏的幅度。0% = 全場均勻(舊制)。',
  },
};

const _vals = {};
const _subs = new Set();

function clamp(k, v) {
  const d = VISUAL_KNOBS[k];
  if (!d || !Number.isFinite(v)) return d ? d.def : 0;
  return Math.min(d.max, Math.max(d.min, v));
}

// 載入:整份讀進來後逐項夾制。壞掉的鍵/超界的值一律退回預設(原則 6 寧缺勿錯)——
// 手改 localStorage 或舊版遺留的鍵不該讓畫面變成無法解釋的樣子。
{
  let raw = null;
  try { raw = JSON.parse(localStorage.getItem(KEY) || '{}'); } catch { /* 私密模式 / 壞字串 */ }
  for (const k in VISUAL_KNOBS) {
    const v = raw && typeof raw === 'object' ? Number(raw[k]) : NaN;
    _vals[k] = Number.isFinite(v) ? clamp(k, v) : VISUAL_KNOBS[k].def;
  }
}

/** 目前值(恆在 [min, max] 內) */
export function visualPref(k) {
  return k in _vals ? _vals[k] : (VISUAL_KNOBS[k]?.def ?? 0);
}

/** 整份目前值(消費端一次套用用;回傳新物件,MUST NOT 就地改) */
export function visualPrefs() {
  return { ..._vals };
}

/** 寫入一個旋鈕(夾制 + 持久化 + 廣播)。回傳夾制後的值 */
export function setVisualPref(k, v) {
  if (!(k in VISUAL_KNOBS)) return 0;
  const nv = clamp(k, Number(v));
  if (nv === _vals[k]) return nv;
  _vals[k] = nv;
  try { localStorage.setItem(KEY, JSON.stringify(_vals)); } catch { /* 私密模式忽略 */ }
  _emit();
  return nv;
}

/** 全部回到預設(= 這批改動之前的畫面) */
export function resetVisualPrefs() {
  let changed = false;
  for (const k in VISUAL_KNOBS) {
    if (_vals[k] !== VISUAL_KNOBS[k].def) { _vals[k] = VISUAL_KNOBS[k].def; changed = true; }
  }
  if (!changed) return;
  try { localStorage.setItem(KEY, JSON.stringify(_vals)); } catch { /* 私密模式忽略 */ }
  _emit();
}

/** 是否全部維持預設(設定頁的「還原」鈕要不要亮;也是「畫面同舊制」的判據) */
export function visualPrefsDefault() {
  return Object.keys(VISUAL_KNOBS).every((k) => _vals[k] === VISUAL_KNOBS[k].def);
}

/** 訂閱變更;回傳解訂閱函式(消費端 dispose 時 MUST 呼叫,否則舊材質被舊 closure 抓著) */
export function onVisualChange(fn) {
  _subs.add(fn);
  return () => _subs.delete(fn);
}

function _emit() {
  for (const fn of [..._subs]) {
    // 一個消費端炸掉不可以讓其餘的收不到(拉桿只會表現成「有些東西沒跟著變」)
    try { fn(_vals); } catch { /* 消費端自己的問題,不阻斷廣播 */ }
  }
}
