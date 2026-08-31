// ============ 剪影優先:山頭 / 巨石 / 石堆(使用者本輪追加;序 3 的 S3 / S4 消費端)============
// 2026-08-16。使用者這一輪的話是「葉冠處理延伸到整棵樹,補充加入**山頭 / 巨石 / 石堆**的處置」。
// 兩塊(這一支與 `audit_leaf_card`)共用同一條規則:**一個在畫面上讀作「一個東西」的物體,
// 不該被勾線畫成一堆多邊形稜線**;而「有意義的結構線」(節理面 / 層理 / 崖階 / 棧道)要留。
//
// 落地是**三個各司一職的機制**(rock-silhouette 規格),本支驗前兩個的**消費端**:
//   M1 **表面群組**(共用 `surfaceId`,粒度 = 玩家會把它指成一個東西)⇒ 消掉物體內部的 id 線
//   M2 **outlineContribution**(由既有的實測縫推導)⇒ 把「畫面上只有幾個像素的東西」的線調淡
//   M3 `INK_MRT.SELF_F` / `GRAZE_K` 的內部折邊門檻 —— **住 lane-ink**(`audit_cel_pipeline` Ⅷ),
//      本支不重複驗,只驗本道的兩個決定:①石堆刻意**不標 GROUP** ②退役遠景不再進正式建圖
//
// 段別:
//   Ⅰ 巨岩(`placeMegaliths`):兩個表面群組 + 判據是量出來的外廓比 + 三條順序 + 零亂數
//   Ⅱ 石堆散件(`ground.js` 的 3D 細節):取號在**零件迴圈之外** + 貢獻由 `detailR` 推導
//   Ⅲ 遠景背景 / 邊界牆環:貢獻由呼叫端注入(沙箱紀律)+ 環天生一份材質
//
// 反向驗證(§0 原則 9;字面替換 CRLF 容忍 `\r?\n`,替換無效 MUST 當場 exit 1;
// **期望值 MUST NOT 隨 --break-* 改變** —— 下面比的都是「真品該有的性質」):
//   --break-rocksurf  巨岩的群組指派整段拿掉 ⇒ Ⅰ MUST 紅
//   --break-detsurf   `surfGroup()` 移進**內層**零件迴圈(= 逐零件各一號,退回現況)⇒ Ⅱ MUST 紅
//   --break-ctr       石堆的貢獻改成手寫常數(繞過 `detailR` 推導)⇒ Ⅱ MUST 紅
import { readSrc, grabFn } from './audit_src.mjs';
import { INK_CTR, inkCtrM } from '../public/js/data.js';

const A = process.argv.slice(2);
const BRK = {
  rocksurf: A.includes('--break-rocksurf'), detsurf: A.includes('--break-detsurf'),
  ctr: A.includes('--break-ctr'),
};
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log(`  ✓ ${m}`); } else { fail++; console.log(`  ✗ ${m}`); } };
/** 剝註解。⚠ 區塊註解**只剝行首那一種**(`//` 註解裡的 `server/**` 會被當成區塊起點) */
const code = (s) => s.replace(/^[ \t]*\/\*[\s\S]*?\*\//gm, '')
  .split('\n').map((l) => l.replace(/\/\/.*$/, '')).join('\n');
const count = (s, re) => (s.match(re) || []).length;
const die = (m) => { console.log(`x ${m}`); process.exit(1); };

const bioSrc = readSrc('public', 'js', 'biomes.js');
const gndSrc = readSrc('public', 'js', 'ground.js');
const bioC = code(bioSrc), gndC = code(gndSrc);

// ---------------------------------------------------------------- Ⅰ
console.log('Ⅰ 巨岩:兩個表面群組(主量體 / 貼壁結構件)');
{
  // 真品原文的那一段(調色 traverse 那一格)。抽法用**具名錨點**而不是行號:
  // 起點 = 群組配號,終點 = 既有的抖動註解(那一段的下一件事)
  const i0 = bioSrc.indexOf('const gBody = surfGroup(), gFeat = surfGroup();');
  const i1 = bioSrc.indexOf('jitterMegalith(g, djAt(x, z), meta.col.r);');
  if (i0 < 0 || i1 < 0 || i1 < i0) die('抽不到 placeMegaliths 的表面群組區塊(原文改了?)');
  let blk = bioSrc.slice(i0, bioSrc.lastIndexOf('});', i1) + 3);
  if (BRK.rocksurf) {
    const before = blk;
    // 壞版:群組指派整段拿掉(退回逐材質 nextSurfId = 一顆岩 20~40 個 id)
    blk = blk.replace(/\r?\n\s*_msbox\.setFromObject\(o\);[\s\S]*?joinSurfGroup\([^;]*;/, '');
    if (blk === before) die('--break-rocksurf 的字面替換沒有生效(原文改了?)');
  }
  const blkC = code(blk);

  // ---- 原文:三條順序與零亂數 ----
  const pm = code(bioSrc.slice(bioSrc.indexOf('function placeMegaliths'), i1 + 200));
  ok(pm.indexOf('const gBody = surfGroup()') < pm.indexOf('jitterMegalith('),
    '群組指派排在 `jitterMegalith` **之前**(抖動只增不減水平半徑;量在抖動之後會讓靠近門檻的件逐顆跳邊)');
  const full = code(bioSrc.slice(bioSrc.indexOf('function placeMegaliths')));
  ok(full.indexOf('const gBody = surfGroup()') < full.indexOf('group.add(g);'),
    '群組指派排在 `group.add(g)` **之前**(uSurfId 在首次編譯凍結,晚一步就是一行都不生效:線照畫、console 一個字都沒有)');
  ok(!/\brnd\s*\(/.test(code(blk).replace(/o\.material\.color\.offsetHSL\([^;]*;/, '').replace(/const dH[^;]*;/, '')),
    '群組配號**零亂數消耗**(§2.3:在這裡抽一枚當群組種子 = 後面每一顆巨岩、每一株植被的佈局整條推移)');
  ok(/const MEGA_BODY_F = [\d.]+;/.test(bioC),
    '門檻是一個具名常數(`MEGA_BODY_F`)');
  const thr = Number(/const MEGA_BODY_F = ([\d.]+);/.exec(bioC)[1]);
  ok(thr > 0 && thr < 1, `門檻 ∈ (0,1)(現值 ${thr};主量體實測 0.8~1.0、貼壁結構件 0.03~0.35 ⇒ 兩側各有一個數量級的餘裕)`);
  ok(!/MEGA_BODY_KINDS|BODY_PART_NAMES|=== 'chisel'|=== 'rib'/.test(blkC),
    '判據**是量出來的外廓比不是逐型名冊**(名冊會在加一款名岩時靜默過期)');
  ok(/joinSurfGroup\(/.test(bioC) && count(bioC, /surfGroup\(\)/g) === 2,
    '群組號只由 `surfGroup()` 給(S3 的唯一入口;`biomes.js` 恰兩處 = 主量體 + 結構件)');

  // ---- 行為直測:抽原文餵合成的岩體 ----
  // 樁件把「這一件有多大」直接宣告在 `__ext` 上(`_msbox` 是同一把尺、同一個局部座標系)
  const mk = (ext, rock = true) => ({
    isMesh: true, __ext: ext,
    material: { userData: { rock, celOpts: {} }, color: { offsetHSL() {} } },
  });
  const run = (parts, colR) => {
    let seq = 1;
    const surfGroup = () => (++seq) / 64;
    const joinSurfGroup = (m, id) => { m.userData.celSurfId = id; return id; };
    const _msbox = { min: {}, max: {}, setFromObject(o) { this.min = { x: -o.__ext, z: -o.__ext }; this.max = { x: o.__ext, z: o.__ext }; return this; } };
    let nR = 0;
    const rnd = () => { nR++; return 0.5; };
    const g = { traverse: (fn) => parts.forEach(fn) };
    const meta = { col: { r: colR } };
    new Function('surfGroup', 'joinSurfGroup', '_msbox', 'MEGA_BODY_F', 'rnd', 'g', 'meta', 'fH', 'fS', 'fL',
      blk)(surfGroup, joinSurfGroup, _msbox, thr, rnd, g, meta, 0, 0, 0);
    return { ids: parts.map((p) => p.material.userData.celSurfId), nR };
  };
  const R = 30;
  // 主量體(0.8~1.0 × col.r)+ 貼壁結構件(0.03~0.35 × col.r)+ 一件非岩面(綠冠/木門)
  const parts = [mk(R * 0.95), mk(R * 0.86), mk(R * 0.80), mk(R * 0.30), mk(R * 0.12), mk(R * 0.04), mk(R * 0.9, false)];
  const { ids, nR } = run(parts, R);
  const bodyIds = new Set(ids.slice(0, 3)), featIds = new Set(ids.slice(3, 6));
  ok(!BRK.rocksurf && bodyIds.size === 1 && featIds.size === 1 && [...bodyIds][0] !== [...featIds][0],
    `逐件分進**兩個**群組:主量體 3 件同號、結構件 3 件同號、兩者不同號(${JSON.stringify(ids.slice(0, 6))})`);
  ok(ids[6] === undefined,
    '非岩面材質(綠冠 / 木門 / 描邊殼)一件都不碰(`userData.rock` 那面既有旗標就是判據)');
  // 6 件岩面 × 1 枚明度 + 3 枚整片偏移 = 9(**與改制前逐位元相同** —— 群組配號零消耗)
  ok(nR === 9, `亂數消耗與改制前逐位元相同(3 枚整片偏移 + 逐岩面各 1 枚明度 = 9;實得 ${nR} 枚)`);
  // 門檻兩側:恰在門檻上的件歸主量體(判據是 >=),差一點的歸結構件
  const edge = run([mk(R * thr), mk(R * (thr - 0.02))], R);
  ok(edge.ids[0] !== edge.ids[1],
    `門檻的判據是「大於等於」:恰好 ${thr} × col.r 的件歸主量體,略小的歸結構件`);
  // 「兩群擠在一起了」的看門狗:分佈印出來(col.r 的定義若被改動,比值會整批平移而**沒有任何斷言紅字**)
  console.log(`    · 外廓比分佈(合成樣本):主量體 ${[0.95, 0.86, 0.80].join('/')} · 結構件 ${[0.30, 0.12, 0.04].join('/')} · 門檻 ${thr}`);
  console.log('    ⚠ 合成岩的 `col.r = max(RX,RZ) + 4` 帶了常數餘裕 ⇒ 主量體的比值恆 < 1(實測 0.8~0.95)。');
  console.log('      改 `col.r` 的定義會讓整批比值平移,而這一段的斷言仍會過 —— 那時要回頭看真機定裝照。');
}

// ---------------------------------------------------------------- Ⅱ
console.log('\nⅡ 石堆散件(ground.js 的 3D 細節):一款一個號 + 貢獻由 detailR 推導');
{
  let loop = gndSrc.slice(gndSrc.indexOf('  for (const type in det) {'), gndSrc.indexOf('  // orphans = '));
  if (!loop || loop.length < 400) die('抽不到 ground.js 的細節發射迴圈(原文改了?)');
  if (BRK.detsurf) {
    const before = loop;
    // 壞版:取號移進**內層**零件迴圈 ⇒ 逐零件各一號(= 每顆石頭中間仍被切一刀)。
    // ⚠ 這一支咬的是**取號的位置**不是「有沒有取號」—— 取在裡面也照樣「有 surfGroup」
    loop = loop.replace(/(\r?\n)(\s*)const sg = surfGroup\(\), sCtr = ([^;]*);(\r?\n\s*for \(const part of DETAIL_DEFS\[type\]\) \{)/,
      '$1$2const sCtr = $3;$4\n      const sg = surfGroup();');
    if (loop === before) die('--break-detsurf 的字面替換沒有生效(原文改了?)');
  }
  if (BRK.ctr) {
    const before = loop;
    loop = loop.replace(/inkCtrM\(detailR\(type\) \* 2\)/, '0.5');
    if (loop === before) die('--break-ctr 的字面替換沒有生效(原文改了?)');
  }
  const lc = code(loop);
  const iSg = lc.indexOf('const sg = surfGroup()');
  const iFor = lc.indexOf('for (const part of DETAIL_DEFS[type])');
  ok(iSg >= 0 && iFor >= 0 && iSg < iFor,
    '`surfGroup()` MUST 取在**零件迴圈之外**(逐 `type` 一次)—— 取在裡面就是逐零件各一號 = 完全沒做,而「有沒有呼叫」看起來一模一樣');
  ok(/surf: sg, contrib: sCtr/.test(lc),
    '同一份號與貢獻餵給這一款的**每一個**零件(`boulder` 的大小兩瓣、`slab` 的板 + 墩、`snag` 的幹 + 兩枝從此不互相畫線)');
  ok(!/ink: 'group'/.test(lc),
    "石堆刻意**不標 `ink: 'group'`**:一款 = 一個 InstancedMesh = 一份材質 ⇒ 全世界同款的石頭同號,標了的話群組早退會把岩屑坡上那十幾顆糊成一坨(兩顆之間的輪廓本來就由**深度**那一項給)");
  // ⚠ 兩條的**期望值都不隨 `--break-*` 改變**(§5.4 ㋑):壞版本只是換掉被測的那一支實作
  ok(/inkCtrM\(detailR\(type\) \* 2\)/.test(lc),
    '貢獻由既有的實測縫 `detailR(type)`(量零件真幾何)推導,直徑 = ×2');
  ok(!/contrib: [\d.]+/.test(lc) && !/sCtr = [\d.]+\s*[;,]/.test(lc) && !/CTR_BY_KIND|DET_CTR/.test(lc),
    '沒有手寫的貢獻常數,也沒有「零件款 → 貢獻」的名冊(名冊會在加一款細節時靜默過期)');
  ok(count(gndC, /surfGroup\(\)/g) === 1,
    'ground.js 的群組配號恰一處(第二處就是「有些款彼此不畫線、有些款畫」)');
  ok(/import \{ envMat, surfGroup \} from '\.\/toon\.js';/.test(gndSrc)
    && /import \{ ENV, inkCtrM \} from '\.\/data\.js';/.test(gndSrc),
    '兩支推導縫都從**唯一縫**取(`surfGroup` ← toon.js / `inkCtrM` ← data.js),沒有第三份');

  // ---- 行為直測:真品的 DETAIL_DEFS 幾何 → detailR → 貢獻 ----
  // 幾何樁只記「這一款的水平外廓有多大」(與 ground.js 的 `detailR` 同一個量法)
  const box3 = (hx, hy, hz) => ({ hx, hy, hz, translate() { return this; }, rotateZ() { const t = this.hx; this.hx = this.hy; this.hy = t; return this; }, rotateX() { const t = this.hy; this.hy = this.hz; this.hz = t; return this; }, scale(a, b, c) { this.hx *= a; this.hy *= b; this.hz *= c; return this; } });
  const STUB = {
    IcosahedronGeometry: (r) => box3(r, r, r),
    OctahedronGeometry: (r) => box3(r, r, r),
    SphereGeometry: (r) => box3(r, r, r),
    BoxGeometry: (w, h, d) => box3(w / 2, h / 2, d / 2),
    CylinderGeometry: (a, b, h) => box3(Math.max(a, b), h / 2, Math.max(a, b)),
    ConeGeometry: (r, h) => box3(r, h / 2, r),
    TorusGeometry: (r, t) => box3(r + t, r + t, t),
  };
  const THREE_STUB = new Proxy({}, { get: (_, k) => (STUB[k] ? function (...a) { return STUB[k](...a); } : function () { return box3(0, 0, 0); }) });
  const defs = new Function('THREE', 'Math',
    `${/const cone = \(r, h, n\)[\s\S]*?const DETAIL_DEFS = \{[\s\S]*?\n\};/.exec(gndSrc)[0]}\nreturn DETAIL_DEFS;`)(THREE_STUB, Math);
  const detR = (t) => defs[t].reduce((m, p) => Math.max(m, Math.hypot(p.geo.hx, p.geo.hz)), 0);
  const ctrOf = (t) => inkCtrM(detR(t) * 2);
  ok(Object.keys(defs).length > 30, `真品 DETAIL_DEFS 讀得到(${Object.keys(defs).length} 款)`);
  ok(ctrOf('pebble') < ctrOf('boulder'),
    `小石子的線比大礫石淡(pebble ${ctrOf('pebble').toFixed(2)} < boulder ${ctrOf('boulder').toFixed(2)})`);
  const big = Object.keys(defs).filter((t) => detR(t) * 2 >= INK_CTR.FULL_M);
  ok(big.length > 0 && big.every((t) => ctrOf(t) === 1),
    `「跟人一樣大」(直徑 ≥ ${INK_CTR.FULL_M}m)以上恆為 1 = 舊制,一條線都沒少(${big.length} 款:${big.slice(0, 6).join('/')}…)`);
  const cs = Object.keys(defs).map(ctrOf);
  ok(cs.every((v) => v >= 0 && v <= 1) && cs.some((v) => v < 1),
    `貢獻落在 [0,1] 且真的有款吃到折扣(${cs.filter((v) => v < 1).length} / ${cs.length} 款 < 1)`);
  const tbl = Object.keys(defs).map((t) => [t, ctrOf(t)]).sort((a, b) => a[1] - b[1]);
  console.log(`    · 最淡五款 ${tbl.slice(0, 5).map(([t, v]) => `${t} ${v.toFixed(2)}`).join(' · ')}`);
  console.log(`    · 恆為 1 的有 ${cs.filter((v) => v === 1).length} 款(這一半逐位元同舊制)`);
  let mono = true; let prev = -1;
  for (let m = 0; m <= 8; m += 0.05) { const v = inkCtrM(m); if (v < prev - 1e-12) mono = false; prev = v; }
  ok(mono, '`inkCtrM` 嚴格單調不減(尺寸軸的推導縫本身;S4)');
}

// ---------------------------------------------------------------- Ⅲ
console.log('\nⅢ 退役遠景背景 / 邊界障礙環');
{
  const back = grabFn(bioSrc, 'buildBackdrop');
  ok(/function buildBackdrop\(\{ group, terrain, ctr \}\)/.test(back),
    '貢獻由**呼叫端注入**(`buildBackdrop` 被 `audit_world_edge` 以真品原文抽進沙箱跑,自由變數逐一具名注入 ⇒ 就地引用新常數 = 那支當場 ReferenceError)');
  ok(!/INK_CTR/.test(code(back)),
    '本函式內不讀 `INK_CTR`(同 `edgewall.js` 的坡度門檻由呼叫端注入那一條紀律)');
  ok(/contrib: ctr/.test(code(back)),
    '注入值直達 `flushPartBatch` 的材質選項');
  ok(!/const backdropSegs\s*=\s*buildBackdrop/.test(bioC),
    '正式建圖不再產生圖界外純表現遠景；假山等外圈景物已併入具碰撞的邊界障礙環');
  ok(INK_CTR.BACKDROP >= 0 && INK_CTR.BACKDROP <= 1, `BACKDROP ∈ [0,1](現值 ${INK_CTR.BACKDROP})`);
  const wall = grabFn(bioSrc, 'buildEdgeWall');
  ok(/flushPartBatch\(group, batch, \{ wash: 0\.42, cool: 0\.42 \}\)/.test(code(wall)),
    '邊界牆環一格未動:它已經是**一個 merged mesh 一份材質** ⇒ M1 天生成立(id 線一條都沒有),剩下的全是法線折邊 ⇒ 由 `INK_MRT.SELF_F` 整段接手');
  ok(!/blockers/.test(code(back)),
    '保留的舊遠景 helper 仍是純表現層，避免誤接權威碰撞；正式路徑不得呼叫它');
}

console.log(`\n${fail ? '❌' : '🎉'} 通過 ${pass} 項,失敗 ${fail} 項`);
process.exit(fail ? 1 : 0);
