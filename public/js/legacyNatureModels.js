// ============ v1 自然物正式名冊（岩石／針葉林）============
// 這份純資料 adapter 只回答「哪個已通過的舊版 key 可供哪個角色使用」。
// 幾何仍由 partlib.js 依原 key 載入；查不到時沿用既有程序生成保險絲。

const freezeRows = (rows) => Object.freeze(rows.map((row) => Object.freeze({ ...row })));
const V1_NATURE_CANDIDATE = /^(?:rock\/(?:collapse_a|facet_[ab]|mega_[a-z])|tree\/cf[1-4]_(?:wood|crown)_a)$/;

/** v1 唯一正式採用的四個岩石節點；順序是穩定的消費角色順序，不得重排。 */
export const LEGACY_ROCK_MODELS = freezeRows([
  { category: 'rock', variant: 'cairn-base', key: 'rock/collapse_a', version: 1 },
  { category: 'rock', variant: 'cairn-middle', key: 'rock/facet_a', version: 1 },
  { category: 'rock', variant: 'cairn-top', key: 'rock/facet_b', version: 1 },
  { category: 'rock', variant: 'megalith', key: 'rock/mega_a', version: 1 },
]);

/** cf1..cf4 尚未通過零件台審核；空陣列是刻意的 fail-closed 契約。 */
export const LEGACY_CONIFER_MODELS = freezeRows([]);

export const LEGACY_NATURE_MODELS = Object.freeze({
  rock: LEGACY_ROCK_MODELS,
  conifer: LEGACY_CONIFER_MODELS,
});

/** 依類別與用途取穩定 key；未知／未通過用途一律回 null。 */
export function legacyNatureKey(category, variant) {
  const rows = LEGACY_NATURE_MODELS[category];
  if (!rows) return null;
  return rows.find((row) => row.variant === variant)?.key || null;
}

/** 供接線與稽核判斷 key 是否在正式 v1 白名單。 */
export function isApprovedLegacyNatureKey(key) {
  return LEGACY_ROCK_MODELS.some((row) => row.key === key)
    || LEGACY_CONIFER_MODELS.some((row) => row.key === key);
}

/** 非 v1 候選不受本白名單影響；v1 候選只有人工通過者能進執行期。 */
export function isRuntimeEligibleNatureKey(key) {
  return !V1_NATURE_CANDIDATE.test(key) || isApprovedLegacyNatureKey(key);
}
