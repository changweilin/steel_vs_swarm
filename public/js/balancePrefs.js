// ============ 平衡性設定與數值倍率(全玩家數值微調唯一縫)============
// 提供全玩家八項升級曲線起終點與基礎能力倍率拉桿(0.1~10x);
// 預設值 1.0x(完全等於出廠標準平衡)。
//
// 紀律:
//   ① `def` 一律為 1.0(標準倍率),未調整時數值與原始設定逐位元一致。
//   ② 支援 localStorage(鍵名 svs_balance)記憶與離線稽核零相依載入。
//   ③ 消費端可透過 `upgradeCurveMul(item, lvl)` 計算升級曲線內插倍率,
//      或透過 `balanceMul(statKey)` 讀取單項基礎數值倍率。

const KEY = 'svs_balance';

/**
 * 旋鈕表(單一真相)。
 *   label 繁體中文標籤
 *   group 分組 ('upgrade' = 升級曲線起終點, 'stat' = 基礎能力倍率)
 *   def   預設值 (1.0)
 *   min/max/step  拉桿範圍 (0.1 ~ 10, step 0.1)
 *   unit  單位 ('x')
 *   hint  詳細提示文字
 */
export const BALANCE_KNOBS = {
  // ---- 八項升級曲線起終點 (0.1 ~ 10x) ----
  upg_lw_start: {
    label: '輕武器起點倍率', group: 'upgrade', def: 1.0, min: 0.1, max: 10, step: 0.1, unit: 'x',
    hint: '全玩家輕武器初始(Lv1)的傷害與效能倍率。',
  },
  upg_lw_end: {
    label: '輕武器終點倍率', group: 'upgrade', def: 1.0, min: 0.1, max: 10, step: 0.1, unit: 'x',
    hint: '全玩家輕武器滿級(Lv4)的傷害與效能倍率。',
  },
  upg_hw_start: {
    label: '重武器起點倍率', group: 'upgrade', def: 1.0, min: 0.1, max: 10, step: 0.1, unit: 'x',
    hint: '全玩家重武器初始(Lv1)的傷害與效能倍率。',
  },
  upg_hw_end: {
    label: '重武器終點倍率', group: 'upgrade', def: 1.0, min: 0.1, max: 10, step: 0.1, unit: 'x',
    hint: '全玩家重武器滿級(Lv4)的傷害與效能倍率。',
  },
  upg_sk_start: {
    label: '小招威力起點倍率', group: 'upgrade', def: 1.0, min: 0.1, max: 10, step: 0.1, unit: 'x',
    hint: '全玩家小招初始(Lv1)的效果與威力倍率。',
  },
  upg_sk_end: {
    label: '小招威力終點倍率', group: 'upgrade', def: 1.0, min: 0.1, max: 10, step: 0.1, unit: 'x',
    hint: '全玩家小招滿級(Lv4)的效果與威力倍率。',
  },
  upg_ult_start: {
    label: '大招威力起點倍率', group: 'upgrade', def: 1.0, min: 0.1, max: 10, step: 0.1, unit: 'x',
    hint: '全玩家大招初始(Lv1)的效果與威力倍率。',
  },
  upg_ult_end: {
    label: '大招威力終點倍率', group: 'upgrade', def: 1.0, min: 0.1, max: 10, step: 0.1, unit: 'x',
    hint: '全玩家大招滿級(Lv4)的效果與威力倍率。',
  },
  upg_hp_start: {
    label: '裝甲上限起點倍率', group: 'upgrade', def: 1.0, min: 0.1, max: 10, step: 0.1, unit: 'x',
    hint: '全玩家基礎裝甲(Lv0)的血量上限倍率。',
  },
  upg_hp_end: {
    label: '裝甲上限終點倍率', group: 'upgrade', def: 1.0, min: 0.1, max: 10, step: 0.1, unit: 'x',
    hint: '全玩家滿級裝甲(Lv3)的血量上限倍率。',
  },
  upg_ar_start: {
    label: '複合裝甲起點倍率', group: 'upgrade', def: 1.0, min: 0.1, max: 10, step: 0.1, unit: 'x',
    hint: '全玩家基礎護甲值(Lv0)倍率。',
  },
  upg_ar_end: {
    label: '複合裝甲終點倍率', group: 'upgrade', def: 1.0, min: 0.1, max: 10, step: 0.1, unit: 'x',
    hint: '全玩家滿級護甲值(Lv3)倍率。',
  },
  upg_sp_start: {
    label: '護盾上限起點倍率', group: 'upgrade', def: 1.0, min: 0.1, max: 10, step: 0.1, unit: 'x',
    hint: '全玩家基礎護盾(Lv0)的上限倍率。',
  },
  upg_sp_end: {
    label: '護盾上限終點倍率', group: 'upgrade', def: 1.0, min: 0.1, max: 10, step: 0.1, unit: 'x',
    hint: '全玩家滿級護盾(Lv3)的上限倍率。',
  },
  upg_ch_start: {
    label: '充能回速起點倍率', group: 'upgrade', def: 1.0, min: 0.1, max: 10, step: 0.1, unit: 'x',
    hint: '全玩家基礎充能系統(Lv0)的回復速度倍率。',
  },
  upg_ch_end: {
    label: '充能回速終點倍率', group: 'upgrade', def: 1.0, min: 0.1, max: 10, step: 0.1, unit: 'x',
    hint: '全玩家滿級充能系統(Lv3)的回復速度倍率。',
  },

  // ---- 玩家基礎數值倍率 (0.1 ~ 10x) ----
  stat_speed: {
    label: '移動速度倍率', group: 'stat', def: 1.0, min: 0.1, max: 10, step: 0.1, unit: 'x',
    hint: '全玩家機體地面移動與飛行巡航速度倍率。',
  },
  stat_rate: {
    label: '攻擊射速倍率', group: 'stat', def: 1.0, min: 0.1, max: 10, step: 0.1, unit: 'x',
    hint: '全玩家武器射速與開火頻率倍率。',
  },
  stat_dmg: {
    label: '攻擊傷害倍率', group: 'stat', def: 1.0, min: 0.1, max: 10, step: 0.1, unit: 'x',
    hint: '全玩家武器基礎傷害輸出倍率。',
  },
  stat_cd: {
    label: '冷卻時間倍率', group: 'stat', def: 1.0, min: 0.1, max: 10, step: 0.1, unit: 'x',
    hint: '小招/大招冷卻與重武器裝填時間倍率(數值越小冷卻越快)。',
  },
  stat_range: {
    label: '攻擊射程倍率', group: 'stat', def: 1.0, min: 0.1, max: 10, step: 0.1, unit: 'x',
    hint: '武器與招式的有效射程倍率。',
  },
  stat_sight: {
    label: '視野範圍倍率', group: 'stat', def: 1.0, min: 0.1, max: 10, step: 0.1, unit: 'x',
    hint: '雷達可視與鎖定半徑倍率。',
  },
  stat_bounty: {
    label: '資金收益倍率', group: 'stat', def: 1.0, min: 0.1, max: 10, step: 0.1, unit: 'x',
    hint: '擊殺小兵、防禦塔與敵機獲得之賞金倍率。',
  },
  stat_mpCost: {
    label: '能量消耗倍率', group: 'stat', def: 1.0, min: 0.1, max: 10, step: 0.1, unit: 'x',
    hint: '施放招式與重武器射擊耗電倍率(數值越小耗電越少)。',
  },
  stat_respawn: {
    label: '重生時間倍率', group: 'stat', def: 1.0, min: 0.1, max: 10, step: 0.1, unit: 'x',
    hint: '座機被擊毀後的重生等待倒數時間倍率。',
  },
};

const _vals = {};
const _subs = new Set();

function clamp(k, v) {
  const d = BALANCE_KNOBS[k];
  if (!d) return 1.0;
  const n = Number(v);
  if (!Number.isFinite(n)) return d.def;
  const clamped = Math.min(d.max, Math.max(d.min, n));
  return Math.round(clamped * 10) / 10;
}

// 載入:整份讀進來後逐項夾制
{
  let raw = null;
  try {
    if (typeof localStorage !== 'undefined') {
      raw = JSON.parse(localStorage.getItem(KEY) || '{}');
    }
  } catch { /* 私密模式 / 壞字串 */ }
  for (const k in BALANCE_KNOBS) {
    const v = raw && typeof raw === 'object' ? raw[k] : undefined;
    _vals[k] = v === undefined ? BALANCE_KNOBS[k].def : clamp(k, v);
  }
}

/** 目前值(恆在 [min, max] 內) */
export function balancePref(k) {
  return k in _vals ? _vals[k] : (BALANCE_KNOBS[k]?.def ?? 1.0);
}

/** 取得基礎數值倍率(若無該鍵則回傳 1.0) */
export function balanceMul(statKey) {
  const k = `stat_${statKey}`;
  return k in _vals ? _vals[k] : 1.0;
}

/**
 * 計算升級軌在指定等級下的曲線倍率 (起點與終點線性內插)
 * @param {'lw'|'hw'|'sk'|'ult'|'hp'|'ar'|'sp'|'ch'} item 升級軌 id
 * @param {number} lvl 等級 (戰鬥面向 1..4, 防禦面向 0..3)
 */
export function upgradeCurveMul(item, lvl = 1) {
  const startKey = `upg_${item}_start`;
  const endKey = `upg_${item}_end`;
  const s = balancePref(startKey);
  const e = balancePref(endKey);
  if (s === 1.0 && e === 1.0) return 1.0;

  // lw/hw/sk/ult: lvl 1..4 -> t in [0, 1]
  // hp/ar/sp/ch: lvl 0..3 -> t in [0, 1]
  const isCombat = item === 'lw' || item === 'hw' || item === 'sk' || item === 'ult';
  const minLvl = isCombat ? 1 : 0;
  const maxLvl = isCombat ? 4 : 3;
  const clampedLvl = Math.min(maxLvl, Math.max(minLvl, lvl));
  const t = (clampedLvl - minLvl) / (maxLvl - minLvl);
  return s + (e - s) * t;
}

/** 整份目前值(回傳新物件,MUST NOT 就地改) */
export function balancePrefs() {
  return { ..._vals };
}

/** 寫入一個旋鈕(夾制 + 持久化 + 廣播)。回傳夾制後的值 */
export function setBalancePref(k, v) {
  if (!(k in BALANCE_KNOBS)) return 1.0;
  const nv = clamp(k, v);
  if (nv === _vals[k]) return nv;
  _vals[k] = nv;
  try {
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem(KEY, JSON.stringify(_vals));
    }
  } catch { /* 私密模式忽略 */ }
  _emit();
  return nv;
}

/** 全部回到交付預設 (1.0x) */
export function resetBalancePrefs() {
  let changed = false;
  for (const k in BALANCE_KNOBS) {
    if (_vals[k] !== BALANCE_KNOBS[k].def) {
      _vals[k] = BALANCE_KNOBS[k].def;
      changed = true;
    }
  }
  if (!changed) return;
  try {
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem(KEY, JSON.stringify(_vals));
    }
  } catch { /* 私密模式忽略 */ }
  _emit();
}

/** 是否全部維持預設(設定頁的「還原」鈕要不要亮) */
export function balancePrefsDefault() {
  return Object.keys(BALANCE_KNOBS).every((k) => _vals[k] === BALANCE_KNOBS[k].def);
}

/** 訂閱變更;回傳解訂閱函式 */
export function onBalanceChange(fn) {
  _subs.add(fn);
  return () => _subs.delete(fn);
}

function _emit() {
  for (const fn of [..._subs]) {
    try { fn(_vals); } catch { /* 消費端異常不阻斷廣播 */ }
  }
}
