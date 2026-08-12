// ============ 紙娃娃覆寫層:資料模型(dev-only;**零 THREE**)============
// 2026-08-12 使用者指示(第五輪):「機體台加入紙娃娃系統的功能,可以拖曳調整骨架的角度/
// 長度/位置/播放骨架運動等,加入外觀零件拖曳調整/邊緣鈍化銳化/更換形狀/縮放/移動/旋轉/
// 黏貼/配色/塗鴉/圖騰設計/烙印等」。
//
// 本檔 = 那句話的**資料面**:一台機體被使用者拖成什麼樣子,只由這一份文件描述。
// 三層合併與既有的比例覆寫同一條路:出廠(mechs/<key>.js)→ specs.json 覆寫層 → 這裡。
//
// ---- 為什麼零 THREE ----
// 幾何套用要 three(CDN importmap,Node 端載不進來)。把「夾制/正規化/鍵推導」留在這一支
// 純資料檔,離線稽核(tools/audit_paper_doll.mjs)才驗得到**真品**:值域夾制、上限、
// 鍵推導規則全部在 Node 端跑得起來。混進 three 的下場是這一族從此只能靠人眼看,
// 而它壞掉的樣子(夾制沒生效、鍵漂掉)在畫面上與「使用者自己拖成這樣」長得一模一樣。
//
// ---- 兩種鍵,各一個推導規則,MUST NOT 手寫名冊 ----
//   骨架鍵 boneKeys(rig) —— 由 **rig 契約**推導(rig 的值是 Object3D 就是一根骨;
//     是 `{g}`/Object3D 陣列就是一條鏈,鍵 = `chFL.2` 這種 `欄位.序`)。
//     手寫一份「這台有哪些骨」的清單 = 換鷹架時清單靜默過期(同 CLAUDE.md A33 ⑤)。
//   零件鍵 pid ——「建構序路徑」(自機體根節點起的逐層子節點索引,`1.3.0`)。
//     零件樹是決定性建構的(§2.3 零 Math.random)⇒ 同一份 mechs/<key>.js 每次鍛造
//     出來的路徑逐位元相同,這是 pid 能跨重建存活的**唯一**理由。
//     ⇒ 改動 mechs/<key>.js 的零件順序會讓舊覆寫落到別的零件上(見 `DOLL_NOTE`)。
//
// 黏貼件的鍵刻意另起門戶(`+0`/`+1`…):它不在建構序裡,拿建構序編號遲早撞上真零件。

/** 覆寫層版本(格式改動 MUST +1;讀到不認得的版本一律當空白,不猜) */
export const DOLL_V = 1;

/** 值域夾制(唯一縫:客戶端草稿與伺服器落檔同吃這一份)。單位:公尺 / 弧度 / 倍率 */
export const DOLL_LIMITS = {
  rot: Math.PI,          // 骨架/零件的角度偏移(±180°)
  pos: 2.5,              // 位置偏移(機體高 4~9m,±2.5m 已經是「拆下來擺旁邊」)
  len: [0.25, 3],        // 骨長倍率
  scale: [0.08, 6],      // 零件縮放倍率
  bevel: 1,              // 邊緣:+1 全鈍化 / −1 全銳化
  glow: [0, 4],          // 發光倍率
  markSize: [0.05, 4],   // 塗鴉/圖騰/烙印的貼花邊長(公尺)
  marks: 64,             // 一台機體的貼花上限(貼花逐張一次 DecalGeometry,無上限會拖垮編輯)
  adds: 32,              // 黏貼件上限
  text: 12,              // 烙印文字長度上限
};

/** 形狀型錄的**名冊**(幾何實作住 shapes.js;稽核逐項比對兩邊一致)。
 *  null = 不換形狀(維持逐機檔鍛造出來的原幾何)。 */
export const SHAPE_KEYS = [
  'box', 'prism3', 'prism5', 'prism6', 'prism8', 'frustum', 'cyl', 'cone',
  'sphere', 'capsule', 'wedge', 'disc', 'blade', 'crystal',
];
export const SHAPE_LABEL = {
  box: '方塊', prism3: '三稜柱', prism5: '五稜柱', prism6: '六稜柱', prism8: '八稜柱',
  frustum: '楔台', cyl: '圓柱', cone: '錐', sphere: '球', capsule: '膠囊',
  wedge: '楔形', disc: '圓盤', blade: '薄刃', crystal: '晶體',
};

/** 彩繪三式(塗鴉 / 圖騰 / 烙印);圖樣實作住 mark.js,同樣逐項比對。 */
export const MARK_KINDS = ['graffiti', 'totem', 'brand'];
export const MARK_LABEL = { graffiti: '塗鴉', totem: '圖騰', brand: '烙印' };

/** 這一份覆寫是拿什麼當鍵的 —— 面板要把這句話印出來(改零件順序 = 舊覆寫錯位) */
export const DOLL_NOTE = '零件鍵 = 建構序路徑;改動 mechs/<key>.js 的零件順序會讓舊覆寫落到別的零件上。';

export const emptyDoll = () => ({ v: DOLL_V, bones: {}, parts: {}, marks: [], adds: [] });

const num = (v, d = 0) => (typeof v === 'number' && Number.isFinite(v) ? v : d);
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
/** 三元組:非陣列或含非數 ⇒ 回 null(留 undefined 讓套用端跳過,MUST NOT 補 0 —— 那是「歸零」不是「沒設」) */
function vec3(v, lim, def = 0) {
  if (!Array.isArray(v) || v.length !== 3) return null;
  const out = v.map((x) => clamp(num(x, def), -lim, lim));
  return out.every((x, i) => x === def) ? null : out;
}
function scale3(v) {
  if (!Array.isArray(v) || v.length !== 3) return null;
  const [lo, hi] = DOLL_LIMITS.scale;
  const out = v.map((x) => clamp(num(x, 1), lo, hi));
  return out.every((x) => x === 1) ? null : out;
}
const hex = (v) => (typeof v === 'number' && Number.isFinite(v) ? clamp(Math.round(v), 0, 0xffffff) : null);
/** 鍵的合法字集:建構序路徑 `1.3.0`、黏貼件 `+2`、骨架 `chFL.2` —— 一律不含路徑分隔字元。
 *  (覆寫層會被寫進 JSON 再讀回來,鍵是不可信輸入。) */
const KEY_RE = /^\+?[A-Za-z0-9_]+(\.[A-Za-z0-9_]+)*$/;
const okKey = (k) => typeof k === 'string' && k.length <= 64 && KEY_RE.test(k);

/** 骨架一格:角度 r / 位置 p / 骨長 len。整格皆為預設 ⇒ 回 null(不落檔) */
function sanitizeBone(b) {
  if (!b || typeof b !== 'object') return null;
  const out = {};
  const r = vec3(b.r, DOLL_LIMITS.rot);
  const p = vec3(b.p, DOLL_LIMITS.pos);
  const len = clamp(num(b.len, 1), DOLL_LIMITS.len[0], DOLL_LIMITS.len[1]);
  if (r) out.r = r;
  if (p) out.p = p;
  if (len !== 1) out.len = len;
  return Object.keys(out).length ? out : null;
}

/** 零件一格:位移 p / 轉角 r / 縮放 s / 換形狀 shape / 邊緣 bevel / 配色 color / 發光 glow */
function sanitizePart(q) {
  if (!q || typeof q !== 'object') return null;
  const out = {};
  const p = vec3(q.p, DOLL_LIMITS.pos);
  const r = vec3(q.r, DOLL_LIMITS.rot);
  const s = scale3(q.s);
  const bevel = clamp(num(q.bevel, 0), -DOLL_LIMITS.bevel, DOLL_LIMITS.bevel);
  const glow = clamp(num(q.glow, 1), DOLL_LIMITS.glow[0], DOLL_LIMITS.glow[1]);
  const color = hex(q.color);
  if (p) out.p = p;
  if (r) out.r = r;
  if (s) out.s = s;
  if (SHAPE_KEYS.includes(q.shape)) out.shape = q.shape;
  if (bevel !== 0) out.bevel = bevel;
  if (glow !== 1) out.glow = glow;
  if (color != null) out.color = color;
  if (q.hide === true) out.hide = true;
  return Object.keys(out).length ? out : null;
}

/** 貼花一枚(塗鴉/圖騰/烙印):貼在哪個零件的哪一點、朝哪個面、多大、什麼圖樣。
 *  p/n 是**該零件的局部座標**(鍛造靜姿下量的)—— 存世界座標的話,機體一走動貼花就飄走。 */
function sanitizeMark(m) {
  if (!m || typeof m !== 'object') return null;
  if (!okKey(m.pid) || !MARK_KINDS.includes(m.kind)) return null;
  const p = Array.isArray(m.p) && m.p.length === 3 ? m.p.map((x) => clamp(num(x), -DOLL_LIMITS.pos * 4, DOLL_LIMITS.pos * 4)) : null;
  const n = Array.isArray(m.n) && m.n.length === 3 ? m.n.map((x) => clamp(num(x), -1, 1)) : null;
  if (!p || !n) return null;
  if (Math.hypot(n[0], n[1], n[2]) < 1e-6) return null;      // 零法線 = 貼花朝向無解
  const [slo, shi] = DOLL_LIMITS.markSize;
  const out = {
    pid: m.pid, kind: m.kind, p, n,
    rot: clamp(num(m.rot), -Math.PI, Math.PI),
    size: clamp(num(m.size, 0.5), slo, shi),
    seed: clamp(Math.round(num(m.seed, 1)), 0, 0xffffffff),
  };
  const color = hex(m.color);
  if (color != null) out.color = color;
  if (typeof m.text === 'string' && m.text) out.text = m.text.slice(0, DOLL_LIMITS.text);
  return out;
}

/** 黏貼一件:把 src 這個零件的複本掛到 to(骨架鍵或零件鍵)底下 */
function sanitizeAdd(a) {
  if (!a || typeof a !== 'object') return null;
  if (!okKey(a.src) || !okKey(a.to)) return null;
  const out = { src: a.src, to: a.to };
  const p = vec3(a.p, DOLL_LIMITS.pos);
  const r = vec3(a.r, DOLL_LIMITS.rot);
  const s = scale3(a.s);
  if (p) out.p = p;
  if (r) out.r = r;
  if (s) out.s = s;
  if (a.mirror === true) out.mirror = true;
  return out;
}

/**
 * 正規化 + 夾制(**唯一縫**):瀏覽器草稿、伺服器落檔、稽核三端同吃這一支。
 * 兩條紀律:
 *   ① 認不得的版本 / 認不得的鍵一律**丟掉**(寧缺勿錯,CLAUDE.md 原則 6),MUST NOT 猜;
 *   ② 值全等於預設的格子不落檔 —— 覆寫層只存差異,存整份的話出廠值一改就被舊值釘死
 *      (同 mergeSpec 檔頭那一條)。
 */
export function sanitizeDoll(d) {
  const out = emptyDoll();
  if (!d || typeof d !== 'object' || (d.v != null && d.v !== DOLL_V)) return out;
  for (const [k, v] of Object.entries(d.bones || {})) {
    if (!okKey(k)) continue;
    const b = sanitizeBone(v);
    if (b) out.bones[k] = b;
  }
  for (const [k, v] of Object.entries(d.parts || {})) {
    if (!okKey(k)) continue;
    const q = sanitizePart(v);
    if (q) out.parts[k] = q;
  }
  for (const m of (Array.isArray(d.marks) ? d.marks : []).slice(0, DOLL_LIMITS.marks)) {
    const mk = sanitizeMark(m);
    if (mk) out.marks.push(mk);
  }
  for (const a of (Array.isArray(d.adds) ? d.adds : []).slice(0, DOLL_LIMITS.adds)) {
    const ad = sanitizeAdd(a);
    if (ad) out.adds.push(ad);
  }
  return out;
}

/** 空白覆寫(= 逐位元同出廠)。存檔端據此決定「清掉這一格」而不是寫一份空文件。 */
export function isEmptyDoll(d) {
  const s = sanitizeDoll(d);
  return !Object.keys(s.bones).length && !Object.keys(s.parts).length
    && !s.marks.length && !s.adds.length;
}

/** 面板抬頭的計數(逐項印出來:改了幾根骨、幾個零件、幾張貼花、黏了幾件) */
export function dollStats(d) {
  const s = sanitizeDoll(d);
  return {
    bones: Object.keys(s.bones).length,
    parts: Object.keys(s.parts).length,
    marks: s.marks.length,
    adds: s.adds.length,
  };
}

/** 黏貼件的鍵(另起門戶,MUST NOT 與建構序路徑同一個編號空間) */
export const addKey = (i) => `+${i}`;
export const isAddKey = (k) => typeof k === 'string' && k.startsWith('+');
/** 建構序路徑(套用端逐層下探時組出來的那一份;兩端同吃這一支) */
export const pidOf = (path) => path.join('.');

/**
 * 貼花種子:同一個零件上的第 i 張貼花恆得同一組亂數(§2.3 —— 圖樣是**決定性**的,
 * MUST NOT 用 Math.random 現抽:重開頁面圖樣就換一張,而覆寫層裡什麼都沒變)。
 */
export function markSeed(pid, i) {
  let h = 0x811c9dc5;
  const s = `${pid}#${i}`;
  for (let j = 0; j < s.length; j++) {
    h ^= s.charCodeAt(j);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

// ---- 骨架鍵推導(rig 契約 → 可編輯骨列表)------------------------------------
const isObj3 = (v) => !!v && v.isObject3D === true;
/** 鏈的一節:segLimbF 推出來的 `{g, base, k, d}`,或直接就是一顆 Object3D(tailSegs/armSh) */
const chainNode = (v) => (isObj3(v) ? v : (v && isObj3(v.g) ? v.g : null));

/**
 * 這台機體有哪些骨可以拖(**推導**,零手寫名冊)。
 * 規則只有兩條:rig 的值是 Object3D ⇒ 一根骨;是「鏈節」陣列 ⇒ 逐節各一根骨。
 * 回傳 [{ key, obj, chain }],序 = rig 契約的宣告序(逐鷹架固定 ⇒ 面板順序穩定)。
 */
export function boneList(rig) {
  const out = [];
  if (!rig || typeof rig !== 'object') return out;
  for (const [k, v] of Object.entries(rig)) {
    if (isObj3(v)) { out.push({ key: k, obj: v, chain: false }); continue; }
    if (!Array.isArray(v) || !v.length) continue;
    const nodes = v.map(chainNode);
    if (nodes.some((n) => !n)) continue;                 // 不是鏈(glow/muzzles 那種帳)
    nodes.forEach((n, i) => out.push({ key: `${k}.${i}`, obj: n, chain: true }));
  }
  return out;
}
export const boneKeys = (rig) => boneList(rig).map((b) => b.key);

/** 骨架標籤(純顯示;查不到就印原鍵 —— 名冊過期只會少一句中文,不會少一根骨) */
const BONE_LABEL = {
  hips: '骨盆', spine: '脊椎', chest: '胸腔', neck: '頸', head: '頭',
  legL: '左腿根', legR: '右腿根', armL: '左肩', armR: '右肩',
  legChainL: '左腿', legChainR: '右腿', armChainL: '左臂', armChainR: '右臂',
  legFL: '左前腿', legFR: '右前腿', legHL: '左後腿', legHR: '右後腿',
  chFL: '左前腿節', chFR: '右前腿節', chHL: '左後腿節', chHR: '右後腿節',
  tail: '尾根', tail2: '尾中', tailSegs: '尾節', tilt: '壓坡樞軸',
  humChest: '騎士胸', humNeck: '騎士頸', armSh: '騎士肩', armEl: '騎士肘',
  weap: '輕武器座', hvy: '重武器座', gunR: '右槍俯仰', gunL: '左槍俯仰',
  wings: '翼', jets: '噴口', rotors: '旋翼', thrusters: '推進器', tents: '觸手',
};
export function boneLabel(key) {
  const [base, idx] = String(key).split('.');
  const L = BONE_LABEL[base] || base;
  return idx == null ? L : `${L} ${Number(idx) + 1}`;
}
