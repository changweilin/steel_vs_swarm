// ============ 動畫權重向量(唯一縫;`docs/anime_style_plan.md` ⑥-3)============
// 「這台機體現在在做什麼」全專案只有這一份答案。輸入是 `locomotion.js` 已經算好的
// 狀態包 `ent.loco`(L)與 rig 驅動場,輸出是一個**有序鍵集**的 0..1 權重物件。
//
// ── 為什麼要有這一支 ─────────────────────────────────────────────
// 落地前同一件事有三份互相矛盾的實作:
//   ① 速度:`locomotion.js:67` 的 `L.speed`(位移差分 + 阻尼)vs `game.js:8250` 的
//      `ent._moveSpd`(未阻尼、吃 8Hz 插值鋸齒,而且 `* 0.6` 是逐幀常數 = 幀率相依)。
//   ② 離地:`MORPH.GROUND_Y` = 2(換樹)/ `SPEC_CAM.FLY_M` = 2.5(取景)/ `game.js:8281`
//      的 `> 3`(環境音)⇒ 2~3m 之間機體已經是飛行型而音床還在踏地。
//   ③ 「他在不在動」:`_updateMoveAudio` 又自己寫了一條 `moveGate` 速度曲線。
// 收成一份之後,⑦-2 的 gain-ride 才有東西可吃(交叉淡入要求兩軌的和是定值)。
//
// ── 三條硬規則(稽核 `tools/audit_anim_weights.mjs` 逐條守)────────────────
//   ① **地面三軌 idle / walk / run 的和恆為 1**(誤差 < 1e-9)。和不為 1 時,gain-ride 的
//      交叉淡入會在中間速度掉一塊音量 —— 那是「走著走著聲音忽大忽小」而沒有任何錯誤訊息。
//   ② **每一格恆為有限數**:`L` 缺欄一律回 0,MUST NOT 回 NaN。NaN 進
//      `AudioParam.setTargetAtTime` 會丟例外,**把整條 requestAnimationFrame 迴圈打斷**
//      (畫面凍結,而錯誤看起來像音效壞了)。`ent.loco` 在重生瞬移那一幀是 `null`
//      (`game.js` `_updateEnts` 的 `_snapPos` 分支)⇒ 這條不是理論情況。
//   ③ **鍵集由 `WEIGHT_KEYS` 推導**:消費端 MUST NOT 手寫鍵表,本檔 MUST NOT 出現
//      逐機種 / 逐角色名冊(同 A33 ⑤ 的紀律 —— 定位分類也是推導不手寫)。
//
// ── 邊界 ─────────────────────────────────────────────────────
// **零 import**(同 `gaitcurve.js` / `morphrig.js` / `visualPrefs.js` / `rng.js`):離線稽核
// 直接執行真品,不必 mock three 或 data.js。**度量一律由呼叫端注入** —— 離地門檻走
// `opts.groundY`(呼叫端傳 `MORPH.GROUND_Y`,與換樹同一條線)、速度正規化基準走
// `opts.top`/`rig.top`。本檔裡的常數一律是**無單位的比例**,不是公尺也不是 m/s
// (沿用 `edgewall.js` 的紀律:坡度門檻由呼叫端注入,型錄本身不寫死度數)。
// 純表現層:`data.js` / `sim.js` / `server/**` 一格都不碰。

/** 權重鍵集(**有序**;消費端一律由此推導,MUST NOT 手寫字串表)。
 *  idle/walk/run 地面三軌(和恆為 1)· air 離地 · land 落地衝擊 · aim 開火保持 ·
 *  charge 蓄力 · morph 變形 · surge 爆發起步 · brake 急停。 */
export const WEIGHT_KEYS = ['idle', 'walk', 'run', 'air', 'land', 'aim', 'charge', 'morph', 'surge', 'brake'];

/** 走↔跑的分軌帶(`L.amp` 已由 `rig.top` 正規化 ⇒ **無單位**)。
 *  RUN_HI < 1 是刻意的:頂速那一段 MUST 完全落在 run 上,否則最快的那一檔還混著 walk。 */
export const RUN_LO = 0.45;
export const RUN_HI = 0.95;
/** 離地權重的過渡帶**半寬**,以注入的 `groundY` 為單位(0.5 ⇒ 帶 = [0.5g, 1.5g])。
 *  半寬取 g/2 讓 `air` 恰在 y === groundY 時等於 0.5 ⇒ 消費端的 `w.air > 0.5`
 *  與 `locomotion` 換樹的 `y > MORPH.GROUND_Y` 是**同一條線**,不是另一個門檻。 */
export const AIR_BAND_F = 0.5;

const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
/** 取第一個有限數;全都不是就回 0(硬規則 ②:缺欄回 0,不得回 NaN) */
const first = (...vals) => {
  for (const v of vals) if (typeof v === 'number' && Number.isFinite(v)) return v;
  return 0;
};

/**
 * 逐鍵權重向量。
 * @param {object|null} L    `ent.loco`(locomotion.js 的狀態包;null / 缺欄一律退化成靜止)
 * @param {object|null} rig  `mesh.userData.rig`(只讀既有驅動場 `_aim`/`_chg`,不寫)
 * @param {object} opts      呼叫端注入的度量與旗標:
 *   `groundY` 離地門檻(公尺,= `MORPH.GROUND_Y`)· `y` 離地高 · `flies` 常駐飛行體 ·
 *   `top` 速度正規化基準(m/s,= `rig.top`)· `aim` 開火保持 0..1 · `charge` 蓄力 −1..1
 * @returns {Record<string, number>} 鍵集恆為 `WEIGHT_KEYS`,每格恆為 [0,1] 的有限數
 */
export function animWeights(L, rig, opts) {
  const l = L || {};
  const r = rig || {};
  const o = opts || {};

  // ── 地面三軌 ───────────────────────────────────────────────
  // 輸入只有 `L.amp`(既有步態振幅,已由 rig.top 正規化的無單位量)。
  // `stepAerial` / `stepVehicle` 不寫 `L.amp` ⇒ 退回 `L.speed ÷ top`:那是 **同一份**
  // 速度(stepLocomotion 唯一的位移差分)配 **同一個** 正規化基準,只是少了阻尼 ——
  // MUST NOT 在這裡重新差分位置(那就是 `_moveSpd` 那個坑的第二次)。
  const top = first(o.top, r.top);
  const amp = clamp01(Number.isFinite(l.amp) ? l.amp : (top > 0 ? first(l.speed) / top : 0));
  const runShare = clamp01((amp - RUN_LO) / (RUN_HI - RUN_LO));
  const run = amp * runShare;
  const walk = amp - run;          // ⇒ walk + run ≡ amp
  const idle = 1 - amp;            // ⇒ idle + walk + run ≡ 1(硬規則 ①)

  // ── 離地 ─────────────────────────────────────────────────
  // 門檻**注入不寫死**;帶寬由門檻自己推導(AIR_BAND_F 是比例不是公尺)。
  // groundY ≤ 0(呼叫端沒傳)⇒ 退化成二元判定,仍不產生 NaN。
  const groundY = first(o.groundY);
  const y = first(o.y);
  const air = o.flies ? 1
    : (groundY > 0
      ? clamp01((y - groundY * (1 - AIR_BAND_F)) / (groundY * 2 * AIR_BAND_F))
      : (y > 0 ? 1 : 0));

  // ── 其餘各軌:一律**讀既有唯一縫的產出**,不重算 ──────────────────────
  // land ← stepJumpPose 的落地衝擊係數(0..1.6,夾回 1)
  // aim / charge ← stepCombatFx 寫進 rig 的驅動場(`rig._aim` / `rig._chg`);
  //   MUST NOT 反過來讓 locomotion 的 `braceF` 改讀本向量 —— 那一條釘著
  //   「站著不動不是射擊姿勢的來源」,吃的就是 `rig._aim` 本身(audit_gait_anat Ⅷ①b)。
  const raw = {
    idle,
    walk,
    run,
    air,
    land: clamp01(first(l.landK)),
    aim: clamp01(first(o.aim, r._aim)),
    charge: clamp01(Math.abs(first(o.charge, r._chg, l.act))),
    morph: clamp01(first(l.morph)),
    surge: clamp01(first(l.srg)),
    brake: clamp01(first(l.brk)),
  };
  // 鍵集**由 WEIGHT_KEYS 推導**(硬規則 ③):raw 多一格會被丟掉、少一格會補 0,
  // 兩種情況都不會讓消費端拿到 undefined。有限性守衛是恆等式(上面每一格都已夾過)
  // ⇒ 不動地面三軌的和。
  const w = {};
  for (const k of WEIGHT_KEYS) {
    const v = raw[k];
    w[k] = (typeof v === 'number' && Number.isFinite(v)) ? v : 0;
  }
  return w;
}
