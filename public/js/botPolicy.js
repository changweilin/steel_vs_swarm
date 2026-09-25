// ============ Bot learning policy (tool-generated; MUST NOT edit by hand) ============
// Rewritten by the offline self-play loop in `tools/bot_learn.mjs`; `data.js` clamps
// the allowlisted keys (BOT_LEARN.KEYS) in `tactic` via `botPolicySanitize` into BOT_TACTIC.
// Empty `tactic = {}` = neutral policy: BOT_TACTIC is bit-identical to the hand baseline.
//
// This file MUST stay import-free (like rng.js / vernacular.js): browsers, servers,
// offline tools, and audits all consume the original directly.
//
// meta is record-keeping only (balance fingerprint / training log), never game input:
//   balHash   = balance fingerprint at train time (data.js balanceFingerprint());
//               mismatch with the current fingerprint = balance changed, baseline stale
//               -> rerun bot_learn for another round.
//   history   = summary of recent learning rounds (warm-start trail for review).
export const BOT_POLICY = {
  meta: { v: 1, balHash: null, trainedAt: null, history: [] },
  tactic: {},
};
