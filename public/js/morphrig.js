// ============ 變形者的變形過程(兩態骨架 → 反推運動;**零 import**)============
// 2026-08-15 使用者定案:「兩個形態使用的零件都相同,建立兩個形態的骨架後,**反推**變形時
// 骨架應該如何移動 / 旋轉 / 伸縮 / 透明化等運動。」
//
// ---- 為什麼會有這一支 ----
// 兩態同零件早就是**建構期**的紀律(`forge/mechs/_morph.js`:飛行型一顆自己的幾何都沒有,
// 整台由地面型的建構器組出來,只換一組擺位)。但**演出**還停在 2026-08-14 的權宜作法:
// `locomotion.morphSwap` 只把過渡中那一棵的**根節點**縮小/繞縱軸轉/抬起(FOLD),
// 在 m=0.5 硬換樹 —— 零件一個都沒有真的動,「變形」讀起來是「縮成一團再換一台出來」。
// 既然兩棵樹的零件是同一批,那組運動根本不必手寫:**兩態的靜態骨架就已經把它決定了**,
// 差的只是「哪一顆對上哪一顆」與「中間怎麼補」。本檔就是那兩件事的規則面。
//
// ---- 三段規則 ----
//   ① **對應**(哪一顆對哪一顆):建構期把每一顆零件戳上「哪一支建構器的第幾次呼叫、
//      在那次呼叫裡是第幾顆同類件」的標籤(`tagBuilders`)。兩棵樹吃的是**同一個**逐機檔
//      物件(`import t11 from './t11.js'` 與 `MECH_DETAIL['t11@ground']` 是同一個參照)
//      ⇒ 同一顆零件在兩態拿到**逐字相同**的標籤,對應是構造保證而不是猜的。
//   ② **運動**(中間怎麼補):對應零件的兩組局部變換 A → B 逐幀內插(位置線性 / 旋轉
//      slerp / 縮放線性)= 使用者說的移動 / 旋轉 / 伸縮。接縫零件(父節點沒對應上,
//      典型是「地面型掛在 chest 骨、飛行型掛在 hull 群組」)另**反推**成同一個父之下的
//      等價局部變換(`inv(父的靜止世界) × 對方的靜止世界`),一律在建構期算完 ——
//      執行期只剩三個 lerp,逐幀零矩陣求逆。
//   ③ **透明化**(只有一態有的零件):淡出 MUST 在換樹**之前**收完、淡入 MUST 在換樹
//      **之後**才開始(`fadeA` 在 m=0.5 兩側都恰為 0)⇒ 換樹那一瞬間畫面上沒有任何
//      「突然多一塊/少一塊」。收摺同時縮小(`shrinkS`)= 收進機身而不是原地消失。
//
// ---- 為什麼換樹那一刻接得上(這一支唯一真正脆弱的地方)----
// 兩棵樹各自被自己的步態驅動器(stepBiped / stepAerial)動著,而 A→B 的內插是相對
// **自己的父節點**算的 ⇒ 父節點在靜止姿態時,兩棵樹算出來的世界變換**逐位元相同**
// (左乘一個固定變換與 lerp/slerp 可交換);父節點被步態帶偏多少,兩棵樹就差多少。
// 所以過渡中段 MUST 把「沒有對應上的祖先節點」(= 步態骨)收斂回出廠姿態(`restK`):
// 帶內 k=1 ⇒ 換樹前後兩棵樹的對應零件疊在同一個地方 ⇒ 換樹**看不出來**。
// 兩端 k=0 ⇒ 站著與巡航時步態一格未動(逐位元同舊制)。
//
// ---- 邊界 ----
// 本檔**零 import**(同 `rng.js`/`ctrlmode.js`/`roadgrid.js`):對應規則與時間表是這一族
// 唯一會**靜默**壞掉的部分(對錯了只表現成「某塊裝甲飛到別的地方」,沒有任何錯誤訊息),
// 放在純資料層離線稽核(`tools/audit_morph_rig.mjs`)才吃得到真品。
// 三維物件一律**鴨子型別**(只用 `.children` / `.isMesh` / `.userData`)—— three 的矩陣
// 代數留在建構期那一端(`forge/forge.js captureMorphPlan`,它本來就 import three)。

/** 演出常數(全部是**時間表**,不是幾何:幾何一律由兩態骨架反推) */
export const MORPH_FX = {
  HALF: 0.30,    // 步態收斂帶半寬:|m−0.5| ≤ 0.5−HALF ⇒ k=1(換樹落在帶正中央)
  FADE: 0.35,    // 單態零件的淡出/淡入行程(以 m 為單位;MUST ≤ 0.5 才收得完)
  SHRINK: 0.35,  // 淡出到底時的縮放(0 = 縮成一點;留一截才讀得出「收進去」而不是「消失」)
  EPS: 0.01,     // 進度距離兩端多近算「已經到了」(damp 是指數逼近,永遠不會真的等於 0/1)
};

const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);

/** 變形進度的緩動(平滑起停;對稱 ⇒ ease(0.5) === 0.5,換樹點不偏) */
export const morphEase = (m) => (m <= 0 ? 0 : m >= 1 ? 1 : m * m * (3 - 2 * m));

/** 步態收斂權重:兩端 0(步態原封不動)、中段 1(骨架回到出廠姿態 ⇒ 換樹接得上) */
export const restK = (m) => clamp01((0.5 - Math.abs(m - 0.5)) / MORPH_FX.HALF);

/** 單態零件的不透明度:地面型件在 m=0.5 **之前**收完、飛行型件在 0.5 **之後**才長出來 */
export const fadeA = (m, air) => clamp01((air ? m - 0.5 : 0.5 - m) / MORPH_FX.FADE);

/** 淡出同時收摺(縮放隨不透明度走;a=1 ⇒ 恆等 1,不影響出廠尺寸) */
export const shrinkS = (a) => MORPH_FX.SHRINK + (1 - MORPH_FX.SHRINK) * a;

/** 這一幀還在變形嗎(兩端各留 EPS:到了就把姿態寫死一次然後收工) */
export const morphing = (m) => m > MORPH_FX.EPS && m < 1 - MORPH_FX.EPS;

// ══════════ ① 對應:建構期戳標籤 ══════════

/** 深度優先走訪(鴨子型別;跳過描邊外殼與建構期就藏起來的子樹 —— 樞軸點群組) */
export function walkTree(o, fn, root = true) {
  if (!o || o.userData?.isOutline) return;
  if (!root && o.visible === false) return;   // joints 群組:整棵不參與變形演出
  fn(o);
  const c = o.children;
  if (c) for (let i = 0; i < c.length; i++) walkTree(c[i], fn, false);
}

/**
 * 零件的**類別**(標籤的第二段):同類件才比序號。
 * 刻意**不含尺寸** —— 尺寸不同但同一支建構器畫出來的件仍是「同一顆零件的兩個型態」
 * (s10 的飛羽:收合長度 `len × foldF` vs 展開長度 `len`),那正是要內插的東西;
 * 拿尺寸當類別的話它們會變成「兩顆不同的零件」而各自淡出淡入 = 翅膀在半空中閃一下。
 * 反過來也不能只用「第幾顆」:建構器會依旗標**條件生件**(t11 飛行型的大槳葉),
 * 純序號會讓那次呼叫後面所有件整批錯位。
 */
export function nodeClass(o) {
  if (!o.isMesh) return 'G';
  const g = o.geometry || {};
  const n = g.attributes?.position?.count ?? -1;
  const c = o.material?.color;
  const col = typeof c?.getHex === 'function' ? c.getHex() : -1;
  return `${g.type || 'g'}:${n}:${col.toString(16)}`;
}

const r3 = (v) => Math.round(v * 1000) / 1000;

/**
 * 零件的**細指紋**:同一顆零件在兩態是不是連形狀都一樣。
 * 只用來標 `soft`(形狀在換樹那一刻會變的對應件),不參與配對。
 */
export function nodeFine(o) {
  if (!o.isMesh) return '';
  const g = o.geometry;
  if (!g) return '';
  const p = g.parameters;
  if (p) return Object.keys(p).sort().map((k) => `${k}=${typeof p[k] === 'number' ? r3(p[k]) : p[k]}`).join(',');
  const b = g.boundingBox || (typeof g.computeBoundingBox === 'function' ? (g.computeBoundingBox(), g.boundingBox) : null);
  if (!b) return '';
  return `${r3(b.min.x)},${r3(b.min.y)},${r3(b.min.z)}|${r3(b.max.x)},${r3(b.max.y)},${r3(b.max.z)}`;
}

/**
 * 把一個逐機檔物件的**每一支建構器**包成會戳標籤的版本;回傳還原函式。
 *
 * 兩態吃同一個物件 ⇒ 只要包**地面型**那一份就夠(飛行檔 `import t11 from './t11.js'`
 * 拿到的是同一個參照)。飛行檔自己畫的幾何(t11 的傾轉軸環/艙殼)因此**沒有標籤**
 * = 只有飛行型有的零件 ⇒ 走淡入,語意正確。
 *
 * 三條:
 *   ① **內層先戳、外層不覆蓋**(`mount` 內部呼叫 `rotorDisc` ⇒ 盤面的標籤是 rotorDisc 的)
 *      —— 兩棵樹的巢狀結構相同,先後順序因此對稱。
 *   ② 父節點一律**從位置參數取**(`args[0]` 恆是建構情境 `c`,跳過):`c` 的鍵順序兩態
 *      不同(飛行檔會往上面掛旗標),拿它當走訪根會讓標籤序號兩態分家。
 *   ③ 回傳**分節規格陣列**的建構器(`legF`/`legH`:幾何是稍後由 `segLimbF`/`staticLimb`
 *      呼叫 `draw()` 才畫的)MUST 連 `draw` 一起包 —— 不包的話四足變形者的腿在兩棵樹
 *      都沒有標籤,整組腿變成「淡出再淡入」而不是「收折」。
 */
export function tagBuilders(D) {
  const orig = [];
  const calls = new Map();
  const tagCall = (prefix, roots, run) => {
    const seen = new Set();
    for (const r of roots) walkTree(r, (o) => seen.add(o));
    const out = run();
    const cls = new Map();
    for (const r of roots) {
      walkTree(r, (o) => {
        if (seen.has(o) || o.userData?.mtag) return;
        const c = nodeClass(o);
        const n = cls.get(c) || 0;
        cls.set(c, n + 1);
        o.userData.mtag = `${prefix}|${c}#${n}`;
        o.userData.mfine = nodeFine(o);
      });
    }
    return out;
  };
  for (const k of Object.keys(D)) {
    const fn = D[k];
    if (typeof fn !== 'function') continue;
    orig.push([k, fn]);
    D[k] = function tagged(...args) {
      const call = calls.get(k) || 0;
      calls.set(k, call + 1);
      const pre = `${k}#${call}`;
      const out = tagCall(pre, rootsOf(args), () => fn.apply(this, args));
      // ③ 分節規格:幾何稍後才畫,把 draw 也包起來(標籤延用本次呼叫的前綴 + 節序)
      if (Array.isArray(out)) {
        for (let i = 0; i < out.length; i++) {
          const s = out[i];
          if (!s || typeof s.draw !== 'function') continue;
          const draw = s.draw;
          s.draw = (parent) => tagCall(`${pre}.${i}`, [parent], () => draw(parent));
        }
      }
      return out;
    };
  }
  return () => { for (const [k, fn] of orig) D[k] = fn; };
}

/** 走訪根:位置參數裡的 3D 物件(`args[0]` = 建構情境,跳過);一層 plain object / 陣列 */
export function rootsOf(args) {
  const out = [];
  const push = (v) => { if (v && v.isObject3D && !out.includes(v)) out.push(v); };
  for (let i = 1; i < args.length; i++) {
    const a = args[i];
    if (!a || typeof a !== 'object') continue;
    if (a.isObject3D) { push(a); continue; }
    if (Array.isArray(a)) { for (const v of a) push(v); continue; }
    for (const k of Object.keys(a)) {
      const v = a[k];
      if (Array.isArray(v)) { for (const x of v) push(x); } else push(v);
    }
  }
  return out;
}

/** 收集一棵樹上所有戳過標籤的節點(深度優先;順序決定同標籤重複時誰勝出) */
export function collectTagged(root) {
  const out = [];
  walkTree(root, (o) => {
    const t = o.userData?.mtag;
    if (t) out.push({ node: o, tag: t, fine: o.userData.mfine || '' });
  });
  return out;
}

/**
 * 兩棵樹的零件對應。
 * @returns { pairs: [{g, a, soft}], gOnly, aOnly } —— soft = 對應上但形狀不同
 *   (換樹那一刻尺寸會變的件;位置/旋轉照樣連續內插,只是形狀在換樹點跳一次)
 */
export function pairTagged(gl, al) {
  const am = new Map();
  for (const e of al) if (!am.has(e.tag)) am.set(e.tag, e);
  const pairs = [], gOnly = [];
  const used = new Set();
  for (const e of gl) {
    const o = am.get(e.tag);
    if (!o || used.has(e.tag)) { gOnly.push(e); continue; }
    used.add(e.tag);
    pairs.push({ g: e, a: o, soft: e.fine !== o.fine });
  }
  return { pairs, gOnly, aOnly: al.filter((e) => !used.has(e.tag)) };
}

/**
 * 這一棵樹上**需要淡出/淡入**的網格:往上找到的第一顆帶標籤的節點沒有對應上,
 * 或整條祖先鏈都沒有標籤(= 飛行檔自己畫的幾何)。
 * 逐網格判定而不是「對應節點的子樹整棵跳過」—— 條件生出來的件(t11 的大槳葉)就住在
 * 對應上的盤子底下,整棵跳過的話它會在換樹那一刻憑空出現。
 */
export function fadeTargets(root, pairedTags) {
  const out = [];
  walkTree(root, (o) => {
    if (!o.isMesh) return;
    for (let p = o; p; p = p.parent) {
      const t = p.userData?.mtag;
      if (!t) continue;
      if (!pairedTags.has(t)) out.push(o);
      return;
    }
    out.push(o);   // 整條祖先鏈都沒標籤 = 只有這一態才有的幾何
  });
  return out;
}

/**
 * 一對零件的**共同錨**:兩棵樹上都是它的祖先、而且自己也對應上的那一顆(取最近的)。
 * 沒有 ⇒ null(呼叫端改用兩棵樹的根 —— 它們在同一個框裡)。
 *
 * ⚠ 這是本檔最容易寫錯的一條(2026-08-15 t11 實測 1.99m 落差就是漏了它):
 * 反推出來的等價局部變換是「相對某個**不動的**框」量的,而**已對應的祖先自己也在被內插**。
 * 錨 MUST 取到那一顆對應祖先(它在兩棵樹上被推到同一個地方),量測才是相對同一個框;
 * 直接拿「我自己的父節點的靜止世界」當框的話,父節點只要**自己也是對應零件**,
 * 它的運動就會被子零件再吃一次 —— 症狀是換樹那一幀該掛件整組彈開兩公尺
 * (t11 的雙側貨運掛架:飛行檔在掛架與貨物之間插了一個反傾 Group ⇒ 兩棵樹的父不同調)。
 *
 * 錨 MUST 由**同一側**(地面型)算完給兩邊用:兩側各自找「最近的」有機會找到不同的錨,
 * 那樣兩棵樹又會量在不同的框裡。
 */
export function anchorPair(gNode, aNode, pairOf) {
  const isAnc = (p, n) => { for (let x = n.parent; x; x = x.parent) if (x === p) return true; return false; };
  for (let p = gNode.parent; p; p = p.parent) {
    const q = pairOf.get(p);
    if (q && isAnc(q, aNode)) return [p, q];
  }
  return null;
}

/**
 * 過渡中段要收斂回出廠姿態的節點 = 對應零件的祖先鏈上**沒有對應**的那些(步態骨)。
 * 樹根不收(它的局部變換恆是單位變換,而且 `morphSwap` 的舊 FOLD 曾經寫過它)。
 */
export function restNodes(paired, treeRoot) {
  const set = new Set();
  for (const n of paired) {
    for (let p = n.parent; p && p !== treeRoot; p = p.parent) {
      if (!paired.has(p) && !set.has(p)) set.add(p);
    }
  }
  return [...set];
}

// ══════════ ② 運動:局部變換內插(純數值;three 的矩陣代數留在建構期)══════════

/** 四元數最短路徑球面內插(out 可與 a/b 相同;a/b/out 皆為 [x,y,z,w]) */
export function slerpQ(a, b, t, out) {
  let bx = b[0], by = b[1], bz = b[2], bw = b[3];
  let d = a[0] * bx + a[1] * by + a[2] * bz + a[3] * bw;
  if (d < 0) { d = -d; bx = -bx; by = -by; bz = -bz; bw = -bw; }   // 走短的那一邊
  let s0, s1;
  if (d > 0.9995) { s0 = 1 - t; s1 = t; }                          // 幾乎同向:退回線性(避免除以 ≈0)
  else {
    const th = Math.acos(d), st = Math.sin(th);
    s0 = Math.sin((1 - t) * th) / st;
    s1 = Math.sin(t * th) / st;
  }
  out[0] = a[0] * s0 + bx * s1;
  out[1] = a[1] * s0 + by * s1;
  out[2] = a[2] * s0 + bz * s1;
  out[3] = a[3] * s0 + bw * s1;
  const l = Math.hypot(out[0], out[1], out[2], out[3]) || 1;
  out[0] /= l; out[1] /= l; out[2] /= l; out[3] /= l;
  return out;
}

/** 局部變換內插:位置/縮放線性、旋轉 slerp。A/B/out = { p:[3], q:[4], s:[3] } */
export function mixTRS(A, B, t, out) {
  for (let i = 0; i < 3; i++) {
    out.p[i] = A.p[i] + (B.p[i] - A.p[i]) * t;
    out.s[i] = A.s[i] + (B.s[i] - A.s[i]) * t;
  }
  slerpQ(A.q, B.q, t, out.q);
  return out;
}
