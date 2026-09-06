#!/usr/bin/env node
// 樹木幹枝接合離線稽核(2026-09-06;南洋杉 trunk_crown 誤名 + dinizia/tualang 幹頂懸空案)
// ---------------------------------------------------------------------------
// 為什麼要這支:audit_object_joints 以凸包探針驗「零件有沒有貼著」,但三種樹木病灶
// 會從它的指縫溜走 ——
//   ① 同軸樹幹分段的「垂直斷開」(dinizia 頂段頂 70m、冠底 74.7m,中間 4.7m 全是空氣;
//      探針只量相接處,懸空的那一段沒有接合端可以量);
//   ② 零件台樹模型的「木質橋段誤名」(南洋杉 trunk_crown 是棕色木質、卻掛著 crown 的
//      名字 ⇒ 對照台「樹幹＋樹枝」視圖把它藏起來,主幹與頂梢看起來斷成兩截);
//   ③ 結構側枝的梢懸空(枝根釘在幹上、梢停在冠底之外數公尺 —— dinizia +x/+z、
//      sequoia +x 都是這一型;修法一律是根不動、梢重瞄進冠;掛在梢旁的配件要跟著走)。
// 故本支直接驗三件事(全部讀真品,不手抄):
//   Ⅰ biomes.js 宣告表(VEG_DEFS/GIANT_DEFS 真品原文抽出執行):
//     Ⅰ-a 同軸樹幹柱連續(垂直間隙 ≤ 0.05m)。不管的名字只看形狀:
//         主幹候選 = 貼軸無傾角 cyl 且 h > 2×最大半徑(冠盤/苔環/板根是扁的,自然排除);
//         被別段完全包住的段(苔蘚環帶)不計;半徑階只警告(小接大是包覆)。
//     Ⅰ-b 主幹頂埋進樹冠(幹頂點落在任一冠部體積內,容差 0.1m;枯梢不計入柱頂)。
//     Ⅰ-c 枝根埋幹/埋冠/接地(硬);枝梢進冠(硬)—— 但有合法收尾,只記帳不紅:
//         枯梢/內枝:根有接 + 底半徑 ≤ 0.5m + (貼近冠面 1.2m 內或高於冠底)。
//         判紅的是結構枝(底半徑 > 0.5m)的梢懸空。
//         近垂直表面件(剝皮絲帶/纏藤,傾角 ≤ 0.15)只驗根,不驗梢(貼面由探針稽核擁有)。
//         巨木枝全是單軸傾角 ⇒ 與 Euler 軸序無關;出現雙軸傾角直接紅
//         (那在 runtime XYZ 與合成 Rz·Ry·Rx 下指向不同方向)。
//   Ⅱ out/3d_data/tree 樹模型(model.json 真品):
//     只驗對照台可見集合(路徑 _luna_v6 或 metadata status ok;
//     舊 gemini 原件已有 luna 接班,不在名冊內,另列數量不紅)。
//     角色劃分與對照台同一份正則(見 treeModelPartRole,註明出處 —— 驗的就是台上看到的):
//     Ⅱ-a 同軸樹幹柱連續(含木質橋段,不論名字;名字只影響 Ⅱ-b)
//     Ⅱ-b 木質長件 MUST NOT 掛 crown 名(trunk_crown 案重演即紅)
//     Ⅱ-c 枝根接幹/接前段(硬);枝梢進冠/接後段(硬),枯梢/內枝收尾同 Ⅰ-c 例外
//     Ⅱ-d 僅警告:合成軸序(Rz·Ry·Rx)與 runtime XYZ 下端點漂移 > 0.05m 的枝數
//         (runtimePartModel 走 XYZ;漂移的枝上了遊戲會浮空 —— 管線級地雷,先記帳不紅)
//
// 反向驗證(字面替換 CRLF 容忍,替換無效 MUST 當場 exit 1;期望值不隨 flag 改變):
//   --break-trunk-gap  dinizia 頂段縮回舊值(h24→18,y64→61)⇒ Ⅰ-b MUST 紅
//   --break-branch-tip  指定的傘形樹冠整體抬高 5m(記憶體內,不寫碟)⇒ Ⅱ-c MUST 紅;
//     若錨點模型不在可見集合內則當場 exit 1,不報假綠
//   --break-crown-name  南洋杉 trunk_upper 改回 trunk_crown(記憶體內)⇒ Ⅱ-b MUST 紅;
//     若碟上檔案已無 trunk_upper 則當場 exit 1
//
// 用法:node tools/audit_tree_joints.mjs [--break-trunk-gap] [--break-branch-tip] [--break-crown-name]
// 退出碼:0 = 全綠(警告不影響);1 = 有紅
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { readSrc, grabConst, ROOT } from './audit_src.mjs';

const A = process.argv.slice(2);
const BRK = {
  trunkGap: A.includes('--break-trunk-gap'),
  branchTip: A.includes('--break-branch-tip'),
  crownName: A.includes('--break-crown-name'),
};
let pass = 0, fail = 0, warn = 0;
const ok = (c, m) => { if (c) { pass++; } else { fail++; console.log(`  ✗ ${m}`); } };
const note = (m) => { warn++; console.log(`  ! ${m}`); };

// ---------------- 真品抽出 ----------------
let bioSrc = readSrc('public', 'js', 'biomes.js');
if (BRK.trunkGap) {
  const before = bioSrc;
  bioSrc = bioSrc.replace(
    /\{ g: cyl\(1\.0, 1\.7, 24, 6\), y: 64, c: 0xa07a54 \}[^\n]*\r?\n/,
    '{ g: cyl(1.0, 1.7, 18, 6), y: 61, c: 0xa07a54 },\n');
  if (bioSrc === before) { console.log('x --break-trunk-gap 的字面替換沒有生效(原文改了?)'); process.exit(1); }
}
const tableCode = grabConst(bioSrc, 'VEG_DEFS') + '\n' + grabConst(bioSrc, 'GIANT_DEFS')
  + '\nreturn { VEG_DEFS, GIANT_DEFS };';
const { VEG_DEFS, GIANT_DEFS } = new Function('cyl', 'cone', 'ico', 'Math', tableCode)(
  (r1, r2, h, n = 5) => ({ t: 'cyl', r1, r2, h, n }),
  (r, h, n = 5) => ({ t: 'cone', r, h, n }),
  (r) => ({ t: 'ico', r }),
  Math,
);

// ---------------- 小工具 ----------------
const GAP_TOL = 0.05;    // 同軸柱垂直間隙容差(m)
const EMB_TOL = 0.1;     // 幹頂埋冠容差(m)
const ROOT_TOL = 0.15;   // 枝根貼幹容差(m)
const TIP_TOL = 0.15;    // 枝梢進冠容差(m)
const R_STEP_WARN = 0.25;// 半徑階警告線(只警告,不紅)
const TILT_TOL = 0.15;   // 表面件與結構枝的分界傾角(rad)
const SNAG_R = 0.5;      // 枯梢/內枝收尾的底半徑上限(m):結構枝必須落地進冠
const SNAG_DIST = 1.2;   // 收尾梢離冠面的最大距離(m)

// 冠部體積:cone 按線性收分、ico 按 sy 壓扁橢球(含 sy 欄,預設 1)
function crownContains(part, pt, tol = 0) {
  const [x, y, z] = pt;
  const cx = part.px ?? 0, cy = part.y ?? 0, cz = part.pz ?? 0;
  const g = part.g;
  if (g.t === 'cone') {
    if (y < cy - g.h / 2 - tol || y > cy + g.h / 2 + tol) return false;
    const r = g.r * (1 - (y - (cy - g.h / 2)) / g.h);
    return Math.hypot(x - cx, z - cz) <= r + tol;
  }
  if (g.t === 'ico') {
    const sy = part.sy ?? 1, ry = g.r * sy;
    const dx = (x - cx) / g.r, dy = (y - cy) / ry, dz = (z - cz) / g.r;
    return dx * dx + dy * dy + dz * dz <= 1 + tol;
  }
  return false;
}
function crownGap(part, pt) {
  const [x, y, z] = pt;
  const cx = part.px ?? 0, cy = part.y ?? 0, cz = part.pz ?? 0;
  const g = part.g;
  if (g.t === 'cone') {
    const yc = Math.max(cy - g.h / 2, Math.min(cy + g.h / 2, y));
    const r = Math.max(0.001, g.r * (1 - (yc - (cy - g.h / 2)) / g.h));
    return Math.max(0, Math.hypot(x - cx, z - cz) - r) + Math.abs(y - yc) * 0.5;
  }
  if (g.t === 'ico') {
    const sy = part.sy ?? 1, ry = g.r * sy;
    const q = Math.sqrt(((x - cx) / g.r) ** 2 + ((y - cy) / ry) ** 2 + ((z - cz) / g.r) ** 2);
    return Math.max(0, q - 1) * Math.min(g.r, ry);
  }
  return Infinity;
}
const isCrownPart = (p) => p.g.t === 'cone' || p.g.t === 'ico';
// 主幹候選:貼軸無傾角的柱狀 cyl(扁平冠盤 h≤一半最大半徑,自然排除;
// 矮胖多肉幹/基部喇叭口 h≈R 仍保留)
const isBoleCyl = (p) => p.g.t === 'cyl' && Math.abs(p.px ?? 0) <= 0.6
  && Math.abs(p.pz ?? 0) <= 0.6 && !(p.rx || p.rz) && p.g.h > 0.5 * Math.max(p.g.r1, p.g.r2);
// 單軸傾角枝的方向('vertical' = 近垂直表面件;null = 雙軸,呼叫端判紅)
function branchDir(p) {
  const rx = p.rx ?? 0, rz = p.rz ?? 0;
  if (rx && rz) return null;
  if (Math.abs(rz) > TILT_TOL) return [-Math.sin(rz), Math.cos(rz), 0];
  if (Math.abs(rx) > TILT_TOL) return [0, Math.cos(rx), Math.sin(rx)];
  return 'vertical';
}
const trunkRAt = (r1, r2, h, yBot, y) => {
  const t = Math.max(0, Math.min(1, (y - yBot) / h));
  return r2 + (r1 - r2) * t;
};

// ---------------- Ⅰ 宣告表 ----------------
console.log('Ⅰ biomes.js 宣告表幹柱連續');
for (const [group, table] of [['神木', GIANT_DEFS], ['植被', VEG_DEFS]]) {
  for (const [name, def] of Object.entries(table)) {
    const boles = def.parts.filter(isBoleCyl)
      .map((p) => ({ p, bot: p.y - p.g.h / 2, top: p.y + p.g.h / 2 }));
    // 被別段完全包住的段(苔蘚環帶)不計入柱
    const cols = [...boles].sort((a, b) => a.bot - b.bot)
      .filter((s, _, arr) => !arr.some((o) => o !== s && o.bot <= s.bot && o.top >= s.top));
    const crowns = def.parts.filter(isCrownPart);
    const crownBottom = crowns.length
      ? Math.min(...crowns.map((c) => (c.y ?? 0) - (c.g.t === 'cone' ? c.g.h / 2 : c.g.r * (c.sy ?? 1))))
      : Infinity;
    // 枯梢(細長頂刺,根在冠內)不計入柱頂
    const mains = [];
    const spikes = [];
    for (const s of cols) {
      const below = cols.filter((o) => o.top <= s.bot + GAP_TOL)
        .sort((a, b) => b.top - a.top)[0];
      const thinVsBelow = below
        && s.p.g.r2 <= SNAG_R && s.p.g.r2 < 0.5 * trunkRAt(below.p.g.r1, below.p.g.r2, below.p.g.h, below.bot, s.bot);
      const rootInCrown = crowns.some((c) => crownContains(c, [s.p.px ?? 0, s.bot, s.p.pz ?? 0], ROOT_TOL));
      if (thinVsBelow && rootInCrown) {
        spikes.push(s);
        note(`${group} ${name} 枯梢 h=${s.p.g.h}@y=${s.p.y} 突出冠頂(根在冠內,僅記帳)`);
      } else mains.push(s);
    }
    // 覆蓋式掃描(根罩/環帶與主幹同起點重疊,逐對比較會虛報;首段接地即合法;
    // 板根鰭錐包住幹基也算覆蓋:錐水平範圍與軸相交即提供該段覆蓋)
    const cover = mains.map((s) => ({ ...s, quiet: false }));
    for (const p of def.parts.filter((q) => q.g.t === 'cone')) {
      const bot = p.y - p.g.h / 2, top = p.y + p.g.h / 2;
      const rr = Math.max(p.g.r, 0.001);
      if (Math.hypot(p.px ?? 0, p.pz ?? 0) > rr + 3.0) continue;
      cover.push({ p, bot, top, quiet: true });   // 覆蓋不報縫:冠錐坐進冠團即算接合
    }
    let covered = 0.05 + GAP_TOL;
    for (const s of cover.sort((a, b) => a.bot - b.bot)) {
      if (s.bot > covered + GAP_TOL && !s.quiet) {
        ok(false, `${group} ${name} 幹柱 ${s.p.g.h}@y=${s.p.y} 底 ${s.bot.toFixed(2)} 懸空(下方覆蓋只到 ${covered.toFixed(2)})`);
      } else pass++;
      covered = Math.max(covered, s.top);
    }
    for (let i = 0; i < mains.length - 1; i++) {
      const a = mains[i], b = mains[i + 1];
      const step = Math.abs(b.p.g.r2 - trunkRAt(a.p.g.r1, a.p.g.r2, a.p.g.h, a.bot, b.bot));
      if (step > R_STEP_WARN) note(`${group} ${name} 幹柱半徑階 ${step.toFixed(2)}m(包覆,僅記帳)`);
    }
    if (mains.length && crowns.length) {
      const top = mains.reduce((m, b) => (b.top > m.top ? b : m));
      const pt = [top.p.px ?? 0, top.top, top.p.pz ?? 0];
      ok(crowns.some((c) => crownContains(c, pt, EMB_TOL)),
        `${group} ${name} 幹頂 (${pt[0]},${pt[1].toFixed(1)},${pt[2]}) 埋進樹冠`);
    }
    // 側枝:傾角枝驗根+梢;近垂直表面件只驗根埋幹或接地
    const branches = def.parts.filter((p) => p.g.t === 'cyl' && !isBoleCyl(p)
      && Math.abs(p.px ?? 0) < 12 && Math.abs(p.pz ?? 0) < 12);
    for (const b of branches) {
      const d = branchDir(b);
      if (!d) { ok(false, `${group} ${name} 枝 y=${b.y} 雙軸傾角(rx+rz):軸序一改就指向別處`); continue; }
      const L = b.g.h, C = [b.px ?? 0, b.y, b.pz ?? 0];
      const dir = d === 'vertical' ? [0, 1, 0] : d;
      const a = [C[0] - dir[0] * L / 2, C[1] - dir[1] * L / 2, C[2] - dir[2] * L / 2];
      const e = [C[0] + dir[0] * L / 2, C[1] + dir[1] * L / 2, C[2] + dir[2] * L / 2];
      // 根容差隨幹粗放縮(巨木表皮溝壑本來就是分米級;小樹維持原容差)
      const rootIn = a[1] <= 0.05 || boles.some((t) => {
        if (a[1] < t.bot - ROOT_TOL || a[1] > t.top + ROOT_TOL) return false;
        const tr = trunkRAt(t.p.g.r1, t.p.g.r2, t.p.g.h, t.bot, a[1]);
        return Math.hypot(a[0] - (t.p.px ?? 0), a[2] - (t.p.pz ?? 0)) <= tr + ROOT_TOL + 0.1 * tr;
      }) || crowns.some((c) => crownContains(c, a, ROOT_TOL));
      ok(rootIn, `${group} ${name} 枝根 y=${b.y} 埋進幹身/冠內/接地`);
      if (d === 'vertical' || !crowns.length) continue;
      if (crowns.some((c) => crownContains(c, e, TIP_TOL))) { pass++; continue; }
      const thin = (b.g.r2 ?? 1) <= SNAG_R;
      const gap = Math.min(...crowns.map((c) => crownGap(c, e)));
      if (rootIn && thin && (gap <= SNAG_DIST || e[1] >= crownBottom - TIP_TOL)) {
        note(`${group} ${name} 枯梢/內枝 y=${b.y} 收尾(根有接、細枝,僅記帳)`);
      } else {
        ok(false, `${group} ${name} 枝梢 y=${b.y} 懸空(離冠 ${gap.toFixed(1)}m,結構枝必須進冠)`);
      }
    }
  }
}

// ---------------- Ⅱ 樹模型 ----------------
// 角色劃分與對照台同一份正則(tools/parts_review/review.js treeModelPartRole):
// 驗的就是台上看到的接合,不另開第二份定義。
console.log('Ⅱ out/3d_data/tree 模型幹枝接合');
// 整詞比對(broadleaf 含 leaf 子字串,MUST NOT 誤判 —— 與對照台同義,見 treeModelPartRole)
const CROWN_TOKENS = /^(crown|canopy|leaf|foliage)$/;
const BRANCH_TOKENS = /^(branch|bough|primary|outer|secondary|inner|sag|hook|upturn|arm|candelabra|fork|elbow|link|gnarled|limb|tip)$/;
const TRUNK_TOKENS = /^(trunk|bole|stem|column|barrel|flare|leader|root|bottle)$/;
// 梢目標冠:blob 型零件的生成器關鍵詞(對照台把 rosette/tuft/cap 等判成 other,
// 台上冠視圖看不到它們 —— 但梢確實插在裡面,接合驗證 MUST 認,偏離處以本註為準)
const TIP_CROWN_WORDS = /crown|canopy|umbrella|needle|bloom|tuft|rosette|dome|foliage|flower|cluster|mass|facet|pad|fan|cap|core|leaf|outer|edge|whorl|break/;
// 註:對照台把 inner/sag/hook/upturn 链段判成 other(台上枝視圖不顯示它們);
// 這裡為接合完整仍納入驗證,偏離處以本註為準。
const tok = (s) => String(s || '').toLowerCase().split(/[^a-z]+/);
function modelRole(p) {
  const ts = tok(p.name);
  const has = (re) => ts.some((t) => re.test(t));
  if (has(CROWN_TOKENS)) return 'canopy';
  if (/gnarled_(trunk|bough)/.test(String(p.name || '').toLowerCase())) return 'branch';
  if (has(BRANCH_TOKENS)) return isLong(p) ? 'branch' : 'other';
  if (has(TRUNK_TOKENS)) return isLong(p) ? 'trunk' : 'other';
  return 'other';
}
const isLong = (p) => /frustum|cylinder|prism/i.test(p.type || '');
// 合成軸序(Rz·Ry·Rx,烘焙/對照台真相)與 runtime XYZ 下的 +Y 軸向
function dirSYN(rx, ry, rz) {
  const cx = Math.cos(rx), sx = Math.sin(rx), cy = Math.cos(ry), sy = Math.sin(ry);
  const cz = Math.cos(rz), sz = Math.sin(rz);
  const x = sx * sy, y = cx, z = sx * cy;
  return [x * cz - y * sz, x * sz + y * cz, z];
}
function dirXYZ(rx, ry, rz) {
  const cx = Math.cos(rx), sx = Math.sin(rx), cy = Math.cos(ry), sy = Math.sin(ry);
  const cz = Math.cos(rz), sz = Math.sin(rz);
  let x = -sz, y = cz, z = 0;
  const x1 = x * cy + z * sy, z1 = -x * sy + z * cy;
  x = x1; z = z1;
  return [x, y * cx - z * sx, y * sx + z * cx];
}
function visibleTreeModels() {
  const out = [];
  const walk = (d) => {
    for (const e of readdirSync(d, { withFileTypes: true })) {
      const p = join(d, e.name);
      if (e.isDirectory()) { walk(p); continue; }
      if (e.name !== 'model.json') continue;
      let meta = null;
      try { meta = JSON.parse(readFileSync(join(d, 'metadata.json'), 'utf8')); } catch { /* 無 */ }
      if (p.includes('_luna_v6') || meta?.status === 'ok') out.push(p);
    }
  };
  walk(join(ROOT, 'out', '3d_data', 'tree'));
  return out.sort();
}
const files = visibleTreeModels();
let modelCount = 0, skippedLegacy = 0, xyzDrift = 0, xyzBranches = 0, anchorSeen = false;
{
  const all = [];
  const walkAll = (d) => {
    for (const e of readdirSync(d, { withFileTypes: true })) {
      const p = join(d, e.name);
      if (e.isDirectory()) { walkAll(p); continue; }
      if (e.name === 'model.json') all.push(p);
    }
  };
  try { walkAll(join(ROOT, 'out', '3d_data', 'tree')); skippedLegacy = all.length - files.length; } catch { /* 無 */ }
}
for (const f of files) {
  let j;
  try { j = JSON.parse(readFileSync(f, 'utf8')); } catch { continue; }
  const parts = j.parts || [];
  const short = f.split('tree').pop().slice(-70);
  modelCount++;
  const roles = parts.map((p) => ({ p, r: modelRole(p) }));
  const trunks = roles.filter((o) => o.r === 'trunk').map((o) => o.p);
  const branches = roles.filter((o) => o.r === 'branch').map((o) => o.p);
  const crowns = roles.filter((o) => o.r === 'canopy').map((o) => o.p);
  // 梢目標冠 = 台上冠 ∪ blob 生成冠(見 TIP_CROWN_WORDS 註)
  const tipCrowns = parts.filter((p) => !isLong(p)
    && TIP_CROWN_WORDS.test(String(p.name || '').toLowerCase()));
  const boleColors = new Set(trunks.map((p) => p.color));
  if (BRK.crownName && short.includes('61a8c242')) {
    anchorSeen = true;
    for (const p of parts) if (p.name === 'trunk_upper') p.name = 'trunk_crown';
    if (!parts.some((p) => p.name === 'trunk_crown')) { console.log('x --break-crown-name 錨點遺失(模型改名了?)'); process.exit(1); }
    roles.forEach((o) => { o.r = modelRole(o.p); });
  }
  if (BRK.branchTip && short.includes('042e661d')) {
    anchorSeen = true;
    for (const c of tipCrowns) c.position = [c.position[0], c.position[1] + 5, c.position[2]];
  }
  // Ⅱ-b 木質橋段誤名
  for (const p of parts) {
    if (!isLong(p) || modelRole(p) !== 'canopy') continue;
    if (boleColors.has(p.color)) ok(false, `${short} 木質長件 ${p.name} 掛 crown 名(對照台樹幹視圖會藏起它)`);
  }
  // Ⅱ-a 同軸柱連續:主幹件 + 木質橋段(wood 色的 crown 名長件,不論名字);
  // 枝一律不參柱(同柱判定只看垂直覆蓋:根罩 flare 與主幹同起點,覆蓋式掃描才不會虛報)
  const axis = parts.filter((p) => isLong(p)
    && Math.abs(p.position[0]) <= 0.6 && Math.abs(p.position[2]) <= 0.6
    && (modelRole(p) === 'trunk'
      || (modelRole(p) === 'canopy' && p.color != null && boleColors.has(p.color))));
  const spans = axis.map((p) => ({
    p, bot: p.position[1] - p.height / 2, top: p.position[1] + p.height / 2,
  })).sort((a, b) => a.bot - b.bot);
  // 首段接地即合法(底 ≤ 0.1m 視為落地)
  let covered = 0.05 + GAP_TOL;
  for (const s of spans) {
    if (s.bot > covered + GAP_TOL) {
      ok(false, `${short} 幹柱 ${s.p.name} 底 ${s.bot.toFixed(2)} 懸空(下方覆蓋只到 ${covered.toFixed(2)})`);
    } else pass++;
    covered = Math.max(covered, s.top);
  }
  // Ⅱ-c 枝接合(合成軸序);梢目標吃 tipCrowns(含台上判成 other 的生成冠)
  const inTrunk = (pt) => trunks.some((t) => {
    const r = t.radii || [0.1, 0.1], h = t.height, y = t.position[1], ly = pt[1] - y;
    if (ly < -h / 2 - 0.06 || ly > h / 2 + 0.06) return false;
    const tt = Math.max(0, Math.min(1, (ly + h / 2) / h));
    return Math.hypot(pt[0] - t.position[0], pt[2] - t.position[2]) <= r[1] + (r[0] - r[1]) * tt + 0.06;
  });
  const inCrown = (pt) => tipCrowns.some((c) => {
    let rx, ry, rz;
    if (c.radii && c.radii.length === 3) [rx, ry, rz] = c.radii;
    else if (c.radius) rx = ry = rz = c.radius;
    else if (c.dimensions) { rx = c.dimensions[0] / 2; ry = c.dimensions[1] / 2; rz = c.dimensions[2] / 2; }
    else return false;
    const dx = (pt[0] - c.position[0]) / rx, dy = (pt[1] - c.position[1]) / ry, dz = (pt[2] - c.position[2]) / rz;
    return dx * dx + dy * dy + dz * dz <= 1.25;
  });
  const crownGapM = (pt) => {
    let m = Infinity;
    for (const c of tipCrowns) {
      let rx, ry, rz;
      if (c.radii && c.radii.length === 3) [rx, ry, rz] = c.radii;
      else if (c.radius) rx = ry = rz = c.radius;
      else if (c.dimensions) { rx = c.dimensions[0] / 2; ry = c.dimensions[1] / 2; rz = c.dimensions[2] / 2; }
      else continue;
      const q = Math.sqrt(((pt[0] - c.position[0]) / rx) ** 2 + ((pt[1] - c.position[1]) / ry) ** 2 + ((pt[2] - c.position[2]) / rz) ** 2);
      m = Math.min(m, Math.max(0, q - 1) * Math.min(rx, ry, rz));
    }
    return m;
  };
  const crownBottom = tipCrowns.length ? Math.min(...tipCrowns.map((c) => {
    if (c.radii && c.radii.length === 3) return c.position[1] - c.radii[1];
    if (c.radius) return c.position[1] - c.radius;
    if (c.dimensions) return c.position[1] - c.dimensions[1] / 2;
    return Infinity;
  })) : Infinity;
  const items = branches.map((b) => {
    const d = dirSYN(...b.rotation), L = b.height, C = b.position;
    return {
      b,
      a: [C[0] - d[0] * L / 2, C[1] - d[1] * L / 2, C[2] - d[2] * L / 2],
      e: [C[0] + d[0] * L / 2, C[1] + d[1] * L / 2, C[2] + d[2] * L / 2],
    };
  });
  const near = (p, q) => Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]) < 0.08;
  for (const it of items) {
    const rootOk = inTrunk(it.a) || items.some((o) => o !== it && (near(it.a, o.a) || near(it.a, o.e)));
    ok(rootOk, `${short} 枝根 ${it.b.name} 接幹/接前段`);
    if (inCrown(it.e) || items.some((o) => o !== it && (near(it.e, o.a) || near(it.e, o.e)))) { pass++; continue; }
    const thin = (it.b.radii?.[1] ?? 1) <= SNAG_R;
    if (rootOk && thin && (crownGapM(it.e) <= SNAG_DIST || it.e[1] >= crownBottom - TIP_TOL)) {
      note(`${short} 枯梢/內枝 ${it.b.name} 收尾(根有接、細枝,僅記帳)`);
      continue;
    }
    ok(false, `${short} 枝梢 ${it.b.name} 懸空(結構枝必須進冠/接後段)`);
  }
  for (const it of items) {
    // Ⅱ-d 軸序漂移記帳(不紅)
    const d2 = dirXYZ(...it.b.rotation), C = it.b.position, L = it.b.height;
    const drift = Math.max(
      Math.hypot(it.a[0] - (C[0] - d2[0] * L / 2), it.a[1] - (C[1] - d2[1] * L / 2), it.a[2] - (C[2] - d2[2] * L / 2)),
      Math.hypot(it.e[0] - (C[0] + d2[0] * L / 2), it.e[1] - (C[1] + d2[1] * L / 2), it.e[2] - (C[2] + d2[2] * L / 2)));
    xyzBranches++;
    if (drift > 0.05) xyzDrift++;
  }
}
if ((BRK.branchTip || BRK.crownName) && !anchorSeen) {
  console.log('x 反向驗證錨點不在可見集合內(檔名改了?)'); process.exit(1);
}
if (skippedLegacy) note(`舊 gemini 原件 ${skippedLegacy} 顆不在對照台名冊內(已有 luna 接班,僅記帳)`);
if (xyzDrift) note(`軸序漂移:合成 vs runtime XYZ 端點差 > 0.05m 的枝 ${xyzDrift}/${xyzBranches}(管線級地雷,見檔頭 Ⅱ-d)`);
console.log(`\n檢查 ${pass + fail} 項,正常 ${pass} 項,警告 ${warn} 項,模型 ${modelCount} 棵`);
process.exit(fail ? 1 : 0);
