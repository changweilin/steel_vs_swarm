// ============ Balance Preferences & Stat Multipliers (sole client tuning seam) ============
// Provides sliders (0.1..10x) for upgrade curve endpoints and base ability multipliers across all players;
// defaults to 1.0x (factory baseline).
//
// Invariants:
//   1. `def` is strictly 1.0; unadjusted values remain bit-identical to shipped balance.
//   2. Persists to localStorage (`svs_balance`) with zero-dependency loading for offline audits.
//   3. Consumers query `upgradeCurveMul(item, lvl)` for interpolated curve multipliers,
//      or `balanceMul(statKey)` for single stat multipliers.

const KEY = 'svs_balance';

/**
 * Knob registry (single truth source).
 *   label Traditional Chinese display label
 *   group Category ('upgrade' = curve endpoints, 'stat' = base stat multipliers)
 *   def   Default value (1.0)
 *   min/max/step  Slider range (0.1..10, step 0.1)
 *   unit  Display unit ('x')
 *   hint  Detailed tooltip text
 */
export const BALANCE_KNOBS = {
  // ---- Eight upgrade curve endpoints (0.1..10x) ----
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
    label: '防守招式威力起點倍率', group: 'upgrade', def: 1.0, min: 0.1, max: 10, step: 0.1, unit: 'x',
    hint: '全玩家防守招式初始(Lv1)的效果與威力倍率。',
  },
  upg_sk_end: {
    label: '防守招式威力終點倍率', group: 'upgrade', def: 1.0, min: 0.1, max: 10, step: 0.1, unit: 'x',
    hint: '全玩家防守招式滿級(Lv4)的效果與威力倍率。',
  },
  upg_ult_start: {
    label: '攻擊招式威力起點倍率', group: 'upgrade', def: 1.0, min: 0.1, max: 10, step: 0.1, unit: 'x',
    hint: '全玩家攻擊招式初始(Lv1)的效果與威力倍率。',
  },
  upg_ult_end: {
    label: '攻擊招式威力終點倍率', group: 'upgrade', def: 1.0, min: 0.1, max: 10, step: 0.1, unit: 'x',
    hint: '全玩家攻擊招式滿級(Lv4)的效果與威力倍率。',
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

  // ---- Base player stat multipliers (0.1..10x) ----
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
    hint: '防守/攻擊招式冷卻與重武器裝填時間倍率(數值越小冷卻越快)。',
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

// Load: clamps values on initialization from localStorage
{
  let raw = null;
  try {
    if (typeof localStorage !== 'undefined') {
      raw = JSON.parse(localStorage.getItem(KEY) || '{}');
    }
  } catch { /* Incognito storage quota or malformed JSON */ }
  for (const k in BALANCE_KNOBS) {
    const v = raw && typeof raw === 'object' ? raw[k] : undefined;
    _vals[k] = v === undefined ? BALANCE_KNOBS[k].def : clamp(k, v);
  }
}

/** Current value (guaranteed within [min, max]). */
export function balancePref(k) {
  return k in _vals ? _vals[k] : (BALANCE_KNOBS[k]?.def ?? 1.0);
}

/** Lookup base stat multiplier (defaults to 1.0 if key not found). */
export function balanceMul(statKey) {
  const k = `stat_${statKey}`;
  return k in _vals ? _vals[k] : 1.0;
}

/**
 * Compute upgrade curve multiplier at specified level (linear interpolation between start and end).
 * @param {'lw'|'hw'|'sk'|'ult'|'hp'|'ar'|'sp'|'ch'} item Upgrade track ID
 * @param {number} lvl Level (1..4 for combat, 0..3 for defense)
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

/** Snapshot of current preference values (shallow copy; callers MUST NOT mutate). */
export function balancePrefs() {
  return { ..._vals };
}

/** Update single knob with clamping, persistence, and change notification. Returns clamped value. */
export function setBalancePref(k, v) {
  if (!(k in BALANCE_KNOBS)) return 1.0;
  const nv = clamp(k, v);
  if (nv === _vals[k]) return nv;
  _vals[k] = nv;
  try {
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem(KEY, JSON.stringify(_vals));
    }
  } catch { /* Ignore incognito localStorage write errors */ }
  _emit();
  return nv;
}

/** Reset all knobs to shipped defaults (1.0x). */
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
  } catch { /* Ignore incognito localStorage write errors */ }
  _emit();
}

/** Check whether all settings remain at defaults (drives Reset button state in UI). */
export function balancePrefsDefault() {
  return Object.keys(BALANCE_KNOBS).every((k) => _vals[k] === BALANCE_KNOBS[k].def);
}

/** Subscribe to balance preference updates; returns unsubscribe function. */
export function onBalanceChange(fn) {
  _subs.add(fn);
  return () => _subs.delete(fn);
}

function _emit() {
  for (const fn of [..._subs]) {
    try { fn(_vals); } catch { /* Consumer errors MUST NOT interrupt notification chain */ }
  }
}
