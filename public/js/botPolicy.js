// ============ 電腦玩家學習策略(工具產出檔;人手 MUST NOT 編輯)============
// 由 `tools/bot_learn.mjs` 的離線自對戰學習迴圈改寫;`data.js` 於載入時把 `tactic` 內
// **白名單鍵**(BOT_LEARN.KEYS)經 `botPolicySanitize` 夾制後套回 BOT_TACTIC。
// 空的 `tactic = {}` = 中性策略:BOT_TACTIC 逐位元等於手寫基準(原則 6 寧缺勿錯)。
//
// 本檔 MUST 維持零 import(同 rng.js / vernacular.js):瀏覽器、伺服器、離線工具、
// 稽核四種環境都要能直接吃真品。
//
// meta 只是留檔(平衡指紋/訓練紀錄),不進任何遊戲判定:
//   balHash   = 訓練當時的平衡數值指紋(data.js balanceFingerprint());
//               與現行指紋不符 = 平衡已調整,策略基準過期 ⇒ 重跑 bot_learn 再學一輪。
//   history   = 最近幾輪學習的摘要(暖啟動的軌跡,方便回看策略怎麼演化)。
export const BOT_POLICY = {
  meta: { v: 1, balHash: null, trainedAt: null, history: [] },
  tactic: {},
};
