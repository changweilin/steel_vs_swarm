// ============ 自動入庫配方(第 ⑦ 站 auto_intake.mjs 的「這一格該怎麼做」唯一縫)============
//
// 2026-08-10 使用者定案「先全部自動化,人眼再審查,決定要刪除原始照片或調整參數重新處理」。
// 自動化要回答的第一個問題是「這顆網格該放進哪一格、用什麼參數 normalize」——
// 本檔就是那份答案,而它**刻意只有兩欄是手寫的**(見下方 RECIPES)。
//
// ---- 為什麼「可自動追加的格」是推導不是名冊 ----
//
// 消費端名冊的值有兩種形式,而它們的語意完全不同:
//   ・**單一字串**(`MEGA_LIB.tower: 'rock/tower_a'`、`BLD_LIB.chimney: ['building/chimney_a', fb]`)
//     = 這一格只有一顆,換掉它就是**取代**。取代要人決定(新的比舊的好嗎?),自動化 MUST NOT 碰。
//   ・**陣列**(`MEGA_LIB.block: [...]`、`BLD_LIB.mass: [[...], fb]`)= **輪替名冊**,
//     逐座號挑一顆用。多一顆 = 同一格多一個剪影,fallback 與預算都已經定好了 ⇒ 純機械。
//
// ⇒ `rosterSlots()` 只問「值是不是陣列」,**MUST NOT 出現任何逐格手寫清單**
//   (手寫的會在名冊擴充時靜默過期:新開的輪替格永遠自動不了,而畫面與今天一樣、沒有錯誤訊息。
//    同一條紀律見 `partlib.libNames()` 的檔頭)。
//
// ---- 為什麼「只准追加」是結構性的,不是保守 ----
//
// 開一個**新的格**要寫 fallback primitive 描述子(`['ico', 1]` / `['box', 1, 1, 1]`),
// 而那個描述子同時是三件事:載入失敗時的降級幾何、離線外廓上界(`audit_beacons` Ⅰ 靠它
// 在 Node 端給保守上界)、`normalize_parts` 的縮放目標。三件事都要人決定「這顆該當什麼」。
// 追加到既有格則一格都不用決定 —— 三者全部沿用同格兄弟的那一份。
//
// ---- 預算不隨名冊長度改變:這是**量出來的**,不是假設 ----
//
// 「追加一顆會不會把既有節點擠爆預算」是這條自動化最危險的問題,而三個格的答案都是不會:
//   ・`MEGA_LIB.block` → `families.megalith`:逐件上限 = whole_factor ÷ **一顆巨岩最多幾件庫零件**
//     (29,由程式碼迴圈可數)—— 除數是「同一顆岩用幾件」不是「名冊有幾顆」。
//   ・`BLD_LIB.mass` / `.masslow` → `families.building.<桶>.node_cap`:除數是 `pick_n`
//     (全圖挑幾棟),同樣與名冊長度無關;且 tri_budget 明文寫著 mass **刻意不併進**
//     deco 的 `roster_size` 除數。
//   ・三個格所屬的族(megalith / building)**都沒有 `kind_factor`** ⇒ 沒有「逐款 Σ」那道閘
//     (只有 tree 族有,而 tree 沒有任何輪替名冊格 —— 它的 `lib:` 是逐零件 1:1 的槽)。
// 這三條不是註解裡的宣稱:`audit_auto_intake.mjs` Ⅱ 拿 N 與 N+1 兩份名冊各算一次上限,
// **要求逐位元相等**。哪天有人把某個除數改成吃名冊長度,那一段就會紅字。
//
// A2:零 npm 依賴。本檔只 import 同目錄的讀取縫。
import { biomesSrc, megaLibDescs, bldLibDescs, fbEnvelope, triBudget } from './parts_src.mjs';

/**
 * **唯一手寫的兩欄**(其餘一律推導)。鍵 = `<表>.<格>`。
 *
 * `fit` —— `normalize_parts.py --node` 的縮放目標(`"r"` 等比 / `"r x hy"` 非等向)。
 *   為什麼不從 `fbEnvelope` 推:包絡的 `r` 是**外接**水平半徑(box(1,1,1) ⇒ hypot(1,1)/2 = 0.707),
 *   而整棟量體那兩桶的消費端是拿**單位方盒**逐實例 scale(w,h,d) —— 縮到 0.707 的話節點會
 *   在軸向上戳出那個方盒的足跡,而 intake 只驗外接半徑 ⇒ **全綠**。0.5 是半跨,比契約嚴,
 *   是刻意的。巨岩那格的 fallback 本來就是單位球,等比縮到 1 即可。
 *   ⇒ 這一欄是「消費端怎麼用這顆」的知識,包絡答不出來。稽核只驗它**不超過**包絡。
 *
 * `solidify` —— T2-spz 那條路的實體化預設參數(`solidify_parts.py`)。SF3D 不走這一段。
 *   `offset` 是唯一會逐顆需要調的(§5am:masslow_b 要 0.014,0.006 出破口)⇒ 它同時是
 *   人眼判 `regen` 時最常覆寫的那一個(見 apply_verdicts.mjs 的覆寫表)。
 */
export const RECIPES = {
  'MEGA_LIB.block': { fit: '1', solidify: null },
  'BLD_LIB.mass': { fit: '0.5x0.5', solidify: { cells: 72, offset: 0.006, target: 2900 } },
  'BLD_LIB.masslow': { fit: '0.5x0.5', solidify: { cells: 72, offset: 0.006, target: 2900 } },
};

/** 節點全名 → 前綴與序號字母(`'building/mass_c'` ⇒ `{ prefix: 'mass', letter: 'c' }`) */
export function splitNodeName(full) {
  const node = full.split('/').slice(1).join('/');
  const m = node.match(/^(.*)_([a-z])$/);
  return m ? { node, prefix: m[1], letter: m[2] } : { node, prefix: node, letter: null };
}

/**
 * 可自動追加的名冊格(**推導**:值是陣列的那些格)。
 * 一列 = 一格,附上追加時要用到的全部資料;沒有配方的格照樣列出來(`recipe: null`),
 * 由稽核 Ⅰ 紅字 —— 靜默跳過就是「那一格永遠自動不了而畫面正常」。
 */
export function rosterSlots(src = biomesSrc()) {
  const { MEGA_LIB } = megaLibDescs(src);
  const { BLD_LIB } = bldLibDescs(src);
  const out = [];
  for (const [key, val] of Object.entries(MEGA_LIB)) {
    if (!Array.isArray(val)) continue;                       // 單一字串 = 取代語意,不自動
    out.push(mkSlot('MEGA_LIB', key, val, ['ico', 1], 'megalith', 'megalith'));
  }
  for (const [key, row] of Object.entries(BLD_LIB)) {
    const [names, fb, profs] = row;
    if (!Array.isArray(names)) continue;
    out.push(mkSlot('BLD_LIB', key, names, fb, 'building', key, profs));
  }
  return out;
}

function mkSlot(table, key, names, fb, budgetFam, budgetKind, profs = null) {
  const id = `${table}.${key}`;
  const family = names[0].split('/')[0];
  const { prefix } = splitNodeName(names[0]);
  return {
    id, table, key, names: [...names], fb, family, prefix, budgetFam, budgetKind,
    // 輪廓剖面(2026-08-12;有宣告的格才有,與 `names` 同序)—— 追加時 MUST 一起補一筆
    profs: profs ? profs.map((p) => p.map((s) => [...s])) : null,
    recipe: RECIPES[id] || null,
  };
}

/**
 * 下一個節點名(**推導**:掃現役名冊取尚未用到的第一個字母)。
 * 刻意不用 `names.length` 當序號 —— 中間撤掉一顆之後 length 會與既有名字撞號,而撞名在
 * `normalize_parts --base` 那一側是**取代**語意(檔頭那條 `.001` 陷阱):新的那顆會把
 * 一顆還在服役的節點無聲換掉,兩邊讀數都正常。
 */
export function nextNodeName(slot) {
  const used = new Set(slot.names.map((n) => splitNodeName(n).letter).filter(Boolean));
  for (let i = 0; i < 26; i++) {
    const c = String.fromCharCode(97 + i);
    if (!used.has(c)) return `${slot.family}/${slot.prefix}_${c}`;
  }
  return null;                                               // 26 顆滿了 ⇒ 呼叫端印理由跳過
}

/** 該格的逐件三角形上限(推導自量測檔;與 `intake_parts.mjs` 同一條查表順序) */
export function slotTriCap(slot, budget = triBudget()) {
  if (!budget) return null;
  return budget.nodeCap(slot.budgetFam, slot.budgetKind) ?? budget.capOf(slot.budgetFam);
}

/** 該格的 UV 契約(推導自量測檔;`null` = 這一桶不吃貼圖) */
export function slotUv(slot, budget = triBudget()) {
  return budget?.families?.[slot.budgetFam]?.[slot.budgetKind]?.uv ?? null;
}

/**
 * 這一格追加一顆時要下給 `normalize_parts.py` 的旗標(不含 `--base`/`--out`,那是呼叫端的事)。
 * UV 那幾支的形式由 `slotUv` 決定:`boxup` ⇒ `--boxuv <node>`;`uvbands`(2026-08-12,
 * 三帶:屋頂 / 素牆 / 窗牆)⇒
 * `--uvbands <node>=<roof>|<plain>|<minz>|<wall_ny>|<flat_deg>|<flat_min>`(後兩欄 2026-08-13
 * 加:窗牆帶還要**完全平整**);`roofband` 是它的兩帶前身,保留可用。數字一律取量測檔
 * 那一份(與 intake 驗的是同一份,抄第二份 = 匯出端與驗收端對同一顆節點用兩組帶寬,
 * 而兩邊都不會報錯)。
 */
export function normalizeArgs(slot, nodeName, srcGlb, budget = triBudget()) {
  const cap = slotTriCap(slot, budget);
  const fit = slot.recipe?.fit;
  if (!fit || cap == null) return null;
  const { node } = splitNodeName(nodeName);
  const args = ['--node', `${node}=${srcGlb}|${fit}|${cap}`];
  const uv = slotUv(slot, budget);
  const b = budget?.families?.[slot.budgetFam]?.[slot.budgetKind];
  if (uv === 'uvbands') {
    const ps = budget?.families?.building?.planar_spec;
    args.push('--uvbands', `${node}=${b.roof_band}|${b.plain_band}|${b.roof_minz ?? 0.30}|${b.wall_ny ?? 0.15}`
      + `|${ps?.flat_deg ?? 0}|${ps?.min_f ?? 0.005}`);
  } else if (uv === 'roofband') args.push('--roofband', `${node}=${b.roof_band}|${b.roof_minz ?? 0.30}`);
  else if (uv) args.push('--boxuv', node);
  return args;
}

/**
 * `fit` 的目標 MUST NOT 超過 fallback 包絡(超過 = 匯出端自己就把外廓契約撐破,而
 * `intake_parts` 會在**之後**紅字 —— 那時 GLB 已經寫出去了,回滾比擋下來貴)。
 * 回傳 `{ ok, tr, thy, env }` 給稽核與 auto_intake 共用(第二份比對式會漂)。
 */
export function fitWithinEnvelope(slot) {
  const env = fbEnvelope(slot.fb);
  const fit = slot.recipe?.fit;
  if (!fit) return { ok: false, tr: null, thy: null, env };
  const [trs, thys] = fit.includes('x') ? fit.split('x') : [fit, null];
  const tr = Number(trs);
  const thy = thys == null ? null : Number(thys);
  return {
    ok: Number.isFinite(tr) && tr <= env.r + 1e-9 && (thy == null || (Number.isFinite(thy) && thy <= env.hy + 1e-9)),
    tr, thy, env,
  };
}
