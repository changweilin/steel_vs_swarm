// ============ 變形者的變形過程(兩態骨架 → 反推運動)稽核 ============
// 用途:改 `public/js/morphrig.js`、`forge/forge.js` 的 `captureMorphPlan`/`forgeTagged`、
// `locomotion.js` 的 `morphSwap`/`morphPose`,或任一支 `forge/mechs/*_flight.js` 的擺位之後跑。
//
// 2026-08-15 使用者:「建立變形者的變形過程:兩個形態使用的零件都相同,建立兩個形態的骨架後,
// **反推**變形時骨架應該如何移動/旋轉/伸縮/透明化等運動。」
//
// 本支釘死的是**會靜默壞掉的那幾條**(壞了畫面上只讀成「變形怪怪的」,沒有任何錯誤訊息):
//
//  Ⅰ 時間表 —— 淡出 MUST 在換樹(m=0.5)**之前**收完、淡入 MUST 在之後才開始(兩側在 0.5
//    都恰為 0 ⇒ 換樹那一瞬間畫面上不會多一塊或少一塊);兩端 m=0/1 MUST 完全不作用
//    (站著與巡航時逐位元同出廠姿態);緩動對稱(ease(0.5) === 0.5,換樹點不偏)。
//  Ⅱ 對應 —— 同一顆零件在兩態 MUST 拿到逐字相同的標籤,而且:
//    ① 標籤的序號是**逐類別**的 ⇒ 條件生件(t11 飛行型才伸出的大槳葉)不會讓那次呼叫
//       後面的零件整批錯位;② 類別**不含尺寸** ⇒ 尺寸隨型態改變的件(s03 收合/展開的飛羽)
//       仍然對應得上(那正是要內插的東西),只是標成 `soft`;③ 回傳分節規格的建構器
//       (legF/legH:幾何稍後才由 segLimb/staticLimb 畫)MUST 連 draw 一起戳標籤 ——
//       漏掉的話四足變形者整組腿在兩棵樹都沒標籤,變成「淡出再淡入」而不是收折。
//  Ⅲ 反推(這一族的核心數學)—— 接縫零件的等價局部變換讓**兩棵樹在過渡中算出同一個世界解**:
//    父節點在出廠姿態時,兩側逐位元相同 ⇒ 換樹看不出來;父節點被步態帶偏多少就差多少
//    ⇒ 過渡中段 MUST 把步態骨收斂回出廠姿態(restK),否則換樹那一幀整台機跳一下。
//  Ⅳ 接線(locomotion)—— 姿態 MUST 是 post-pass(排在步態之後;排前面 = 本幀被步態覆寫
//    成完全沒作用)、換樹仍只在越過 0.5 那一次、兩棵樹每幀都寫、`?morph=0` 對照組在冊。
//  Ⅴ 接線(forge)—— 兩棵樹**各包一次**建構器(共用一份呼叫計數器 = 飛行型全部對不上)、
//    還原走 finally、描邊外殼跟著淡(只淡本體 = 淡掉的零件留下一圈黑輪廓)、
//    `morphrig.js` 維持零 import(它是這一族唯一離線驗得到的地方)。
//
// 跑法:`node tools/audit_morph_rig.mjs`
// 反向驗證:`--break-class`(類別改吃尺寸)/ `--break-defer`(不包分節規格的 draw)/
//           `--break-fade`(淡入淡出改成全程線性)/ `--break-rest`(步態不收斂)/
//           `--break-anchor`(反推改量自己的父而不是共同錨)/
//           `--break-post`(姿態改排在步態之前)/ `--break-once`(兩棵樹共用一次包裝)
import { readSrc } from './audit_src.mjs';
import * as REAL from '../public/js/morphrig.js';

const BRK = new Set(process.argv.slice(2).filter((a) => a.startsWith('--break-')).map((a) => a.slice(8)));
const brk = (k) => BRK.has(k);
let pass = 0, fail = 0;
const t = (n, ok, extra = '') => { ok ? (pass++, console.log(`  ✓ ${n}`)) : (fail++, console.log(`  ✗ ${n} ${extra}`)); };
const f3 = (v) => (Math.round(v * 1e4) / 1e4).toFixed(4);

// ── 執行**原文**(壞版注入走字面替換;§5.4 ㋑ 的 CRLF 容忍由 readSrc 保證)──────────
let src = readSrc('public', 'js', 'morphrig.js');
const bust = (name, from, to) => {
  if (!src.includes(from)) { console.log(`  ✗ --break-${name} 沒有咬到目標原文(樣式過期)`); process.exit(1); }
  src = src.replace(from, to);
};
// 壞版 ①:零件類別改吃細指紋 ⇒ 尺寸隨型態變的件不再是「同一顆零件」
if (brk('class')) bust('class', "  return `${g.type || 'g'}:${n}:${col.toString(16)}`;",
  "  return `${g.type || 'g'}:${n}:${col.toString(16)}:${nodeFine(o)}`;");
// 壞版 ②:不包分節規格的 draw ⇒ 腿的幾何是在建構器之外畫的,兩棵樹都沒標籤
if (brk('defer')) bust('defer', '          s.draw = (parent) => tagCall(`${pre}.${i}`, [parent], () => draw(parent));',
  '          s.draw = (parent) => draw(parent);');
// 壞版 ③:淡出淡入改成全程線性 ⇒ 換樹那一刻兩側都不是 0(多一塊/少一塊)
if (brk('fade')) bust('fade', 'export const fadeA = (m, air) => clamp01((air ? m - 0.5 : 0.5 - m) / MORPH_FX.FADE);',
  'export const fadeA = (m, air) => clamp01(air ? m : 1 - m);');
// 壞版 ④:步態不收斂 ⇒ 換樹那一幀兩棵樹停在各自被步態帶偏的地方
if (brk('rest')) bust('rest', 'export const restK = (m) => clamp01((0.5 - Math.abs(m - 0.5)) / MORPH_FX.HALF);',
  'export const restK = () => 0;');
const M = new Function(`${src.replace(/^export /gm, '')}
  return { MORPH_FX, morphEase, restK, fadeA, shrinkS, morphing, walkTree, nodeClass, nodeFine,
    tagBuilders, rootsOf, collectTagged, pairTagged, fadeTargets, restNodes, anchorPair, slerpQ, mixTRS };`)();

// ══════════ 0. 沙箱 = 真品(壞版注入的前提)══════════
console.log('\n【0】沙箱與真品同源');
{
  const same = !BRK.size;
  t('沙箱由 morphrig.js 原文執行(未注入壞版時逐項等於 import 進來的真品)',
    !same || (M.morphEase(0.3) === REAL.morphEase(0.3) && M.restK(0.4) === REAL.restK(0.4)
      && M.fadeA(0.2, false) === REAL.fadeA(0.2, false) && M.MORPH_FX.HALF === REAL.MORPH_FX.HALF));
}

// ══════════ Ⅰ 時間表 ══════════
console.log('\n【Ⅰ】時間表:換樹點對齊、兩端不作用');
{
  t('淡出在換樹之前收完、淡入在之後才開始(m=0.5 兩側恰為 0)',
    M.fadeA(0.5, false) === 0 && M.fadeA(0.5, true) === 0,
    `地面 ${f3(M.fadeA(0.5, false))} / 飛行 ${f3(M.fadeA(0.5, true))}`);
  t('兩端各自完整不透明(地面型件在 m=0 全在、飛行型件在 m=1 全在)',
    M.fadeA(0, false) === 1 && M.fadeA(1, true) === 1);
  t('對面那一態的件在自己那一端恆為 0(不會有半透明的殘影跟著飛)',
    M.fadeA(0, true) === 0 && M.fadeA(1, false) === 0);
  t('淡出行程 MUST ≤ 0.5(否則到換樹點還沒收完)', M.MORPH_FX.FADE <= 0.5);
  t('收摺縮放:全不透明時恆等 1(不影響出廠尺寸)、全淡出時仍留一截(收進機身不是原地消失)',
    M.shrinkS(1) === 1 && M.shrinkS(0) > 0 && M.shrinkS(0) < 1);
  t('緩動對稱且兩端精確(ease(0.5)=0.5 ⇒ 換樹點不偏;ease(0)=0 / ease(1)=1 ⇒ 端點無殘留)',
    M.morphEase(0.5) === 0.5 && M.morphEase(0) === 0 && M.morphEase(1) === 1);
  t('緩動嚴格遞增(變形過程不倒退)',
    Array.from({ length: 200 }, (_, i) => i / 200).every((x) => M.morphEase(x + 0.005) > M.morphEase(x)));
  t('步態收斂:兩端 0(站著/巡航時步態一格未動)、中段 1(換樹落在帶正中央)',
    M.restK(0) === 0 && M.restK(1) === 0 && M.restK(0.5) === 1 && M.restK(0.42) === 1);
  t('兩端不算「變形中」(morphing 兩端為偽 ⇒ 逐位元同出廠姿態)',
    !M.morphing(0) && !M.morphing(1) && M.morphing(0.5) && !M.morphing(M.MORPH_FX.EPS / 2));
  t('局部變換內插的端點精確(t=0/1 逐位元回到 A / B,換樹前後不會有零點幾度的殘差)', (() => {
    const A = { p: [1, 2, 3], q: [0, 0, 0, 1], s: [1, 1, 1] };
    const B = { p: [-4, 0.5, 2], q: [0.5, 0.5, 0.5, 0.5], s: [2, 1, 0.5] };
    const o = { p: [0, 0, 0], q: [0, 0, 0, 1], s: [1, 1, 1] };
    M.mixTRS(A, B, 0, o);
    const at0 = o.p.every((v, i) => v === A.p[i]) && o.s.every((v, i) => v === A.s[i]);
    M.mixTRS(A, B, 1, o);
    return at0 && o.p.every((v, i) => v === B.p[i]) && o.s.every((v, i) => v === B.s[i])
      && o.q.every((v, i) => Math.abs(v - B.q[i]) < 1e-12);
  })());
  t('四元數走最短路徑(對面那一態的姿態寫成反號時 MUST NOT 繞遠路轉一圈)', (() => {
    const a = [0, 0, 0, 1], b = [0, -Math.sin(0.2), 0, -Math.cos(0.2)];   // = 反號的小角度轉
    const o = M.slerpQ(a, b, 0.5, [0, 0, 0, 1]);
    return Math.abs(2 * Math.acos(Math.min(1, Math.abs(o[3]))) - 0.2) < 1e-9;
  })());
}

// ══════════ Ⅱ 對應:兩棵樹的零件標籤 ══════════
// 假的三維物件(鴨子型別;morphrig.js 只用 children / parent / userData / isMesh / geometry)
let SERIAL = 0;
class O3 {
  constructor(mesh = null) {
    this.isObject3D = true;
    this.children = [];
    this.parent = null;
    this.userData = {};
    this.visible = true;
    this.serial = SERIAL++;
    if (mesh) { this.isMesh = true; this.geometry = mesh.geo; this.material = mesh.mat; }
  }
  add(o) { o.parent = this; this.children.push(o); return this; }
}
const geo = (type, count, params) => ({ type, attributes: { position: { count } }, parameters: params });
const node = () => new O3();
const mesh = (type, count, hex, params) => new O3({ geo: geo(type, count, params), mat: { color: { getHex: () => hex } } });

/** 假的逐機檔:兩態共用的建構器(= mechs/<id>.js 的角色) */
function fakeDetail() {
  return {
    label: '測試機', height: 6,
    pelvis(c, p) { p.add(mesh('BoxGeometry', 24, 0x223344, { w: 1, h: 0.4 })); },
    chest(c, p) {
      // 條件生件:只有飛行型才長出來的整流罩(t11 的大槳葉是同一個句型)——
      // 它 MUST NOT 讓同一次呼叫裡後面的零件錯位
      if (c.fairing) p.add(mesh('CylinderGeometry', 40, 0x556677, { r: 0.3 }));
      p.add(mesh('BoxGeometry', 24, 0x223344, { w: 1.2, h: 0.9 }));
      const pod = node();
      p.add(pod);
      pod.add(mesh('BoxGeometry', 24, 0x8899aa, { w: 0.3, h: 0.3 }));
    },
    head(c, p) { p.add(mesh('SphereGeometry', 90, 0xaabbcc, { r: 0.35 })); },
    // 掛架:自己是零件(會被對應到),而武裝掛在它底下 —— t11 的貨運掛架就是這個形狀,
    // 而飛行檔會在掛架與武裝之間插一個反傾 Group(⇒ 兩棵樹的父不同調,共同錨才量得對)
    rack(c, p) { const g = node(); p.add(g); g.add(mesh('BoxGeometry', 24, 0x445566, { w: 1.3 })); c.rack = g; },
    // 羽片:長度隨型態改變(收合 ↔ 展開)⇒ 同一顆零件、不同尺寸(MUST 對應得上並標 soft)
    feather(c, p) { p.add(mesh('BufferGeometry', 12, 0xddeeff, { len: c.spread ? 1.0 : 0.4 })); },
    // 分節規格:幾何稍後才由 segLimb / staticLimb 呼叫 draw 畫出來
    legF(c) {
      return [
        { len: 1, draw: (l) => { l.add(mesh('BoxGeometry', 24, 0x334455, { w: 0.3 })); } },
        { len: 0.9, draw: (l) => { l.add(mesh('BoxGeometry', 24, 0x334455, { w: 0.25 })); } },
      ];
    },
    mount(c, F) { (c.rack || F.chest).add(mesh('CylinderGeometry', 40, 0x111111, { r: 0.12, len: 1.4 })); return { ok: 1 }; },
  };
}
const segLimb = (root, segs) => { let cur = root; for (const s of segs) { const j = node(); cur.add(j); s.draw(j); cur = j; } };

/** 地面型:骨架 = 根 → hips → chest;腿掛在根上(= forgeMech 的慣例) */
function buildGround(D) {
  const root = node();
  const hips = node(); root.add(hips);
  const chest = node(); hips.add(chest);
  const c = { spread: false };
  D.pelvis(c, hips);
  D.chest(c, chest);
  D.head(c, chest);
  D.rack(c, chest);
  for (const sx of [-1, 1]) { const leg = node(); root.add(leg); segLimb(leg, D.legF({ ...c, sx })); }
  for (const sx of [-1, 1]) D.feather({ ...c, sx }, chest);
  D.mount(c, { g: root, chest });
  return root;
}
/** 飛行型:父鏈完全不同(根 → tilt → hull → hips → chest)+ 自己畫的艙殼 + 條件生件 */
function buildFlight(D) {
  const root = node();
  const tilt = node(); root.add(tilt);
  const hull = node(); tilt.add(hull);
  const hips = node(); hull.add(hips);
  const chest = node(); hips.add(chest);
  const c = { spread: true, fairing: true };
  D.pelvis(c, hips);
  D.chest(c, chest);
  D.head(c, chest);
  D.rack(c, chest);
  const up = node(); c.rack.add(up); c.rack = up;    // 反傾中介 Group(= t11_flight 的 upright)
  for (const sx of [-1, 1]) { const leg = node(); hull.add(leg); segLimb(leg, D.legF({ ...c, sx })); }
  for (const sx of [-1, 1]) D.feather({ ...c, sx }, chest);
  D.mount(c, { chest });
  hull.add(mesh('BoxGeometry', 24, 0x000000, { w: 0.5 }));   // 飛行型自己畫的艙殼(只有這一態有)
  return root;
}

console.log('\n【Ⅱ】對應:同一顆零件在兩態拿到同一個標籤');
let PLAN = null;
{
  const D = fakeDetail();
  const orig = { ...D };
  let un = M.tagBuilders(D);
  const G = buildGround(D);
  un();
  const restored = Object.keys(orig).every((k) => D[k] === orig[k]);
  un = M.tagBuilders(D);
  const A = buildFlight(D);
  un();

  const gl = M.collectTagged(G), al = M.collectTagged(A);
  const P = M.pairTagged(gl, al);
  PLAN = { G, A, gl, al, P };
  const tags = new Set(P.pairs.map((x) => x.g.tag));

  t('包裝**還原得乾淨**(拋錯/漏還原 = 下一次鍛造的呼叫序號接著累加,整台對不上)', restored);
  t('兩棵樹戳到的零件數相同(飛行型多的那幾件另計)',
    gl.length > 0 && al.length === gl.length + 1, `地面 ${gl.length} / 飛行 ${al.length}`);
  t('地面型的零件**全部**對應得上(兩態同零件是建構期紀律,對不上就是有人另畫了幾何)',
    P.gOnly.length === 0, `未對應 ${P.gOnly.map((x) => x.tag).join(', ')}`);
  t('條件生件不讓同一次呼叫的其它零件錯位(序號逐類別;整流罩只出現在飛行型)',
    P.aOnly.length === 1 && /^chest#0\|CylinderGeometry/.test(P.aOnly[0].tag),
    P.aOnly.map((x) => x.tag).join(', '));
  t('尺寸隨型態改變的件仍然對應得上,而且被標成 soft(飛羽:收合 ↔ 展開)',
    P.pairs.filter((x) => x.soft).length === 2
    && P.pairs.filter((x) => x.soft).every((x) => x.g.tag.startsWith('feather#')),
    `soft ${P.pairs.filter((x) => x.soft).length} 件`);
  t('分節規格的幾何(legF → draw)有戳到標籤且兩態對應(漏包 = 整組腿變成淡出淡入)',
    P.pairs.filter((x) => /^legF#\d+\.\d+\|/.test(x.g.tag)).length === 4,
    `${P.pairs.filter((x) => /^legF#/.test(x.g.tag)).length} 件`);
  t('父鏈不同不影響對應(地面 hips→chest vs 飛行 tilt→hull→hips→chest)',
    P.pairs.length === gl.length);

  // 共同錨:掛在「已對應的掛架」底下、而飛行型又多插了一層反傾 Group 的武裝
  const pairOf = new Map(P.pairs.map((x) => [x.g.node, x.a.node]));
  const arm = P.pairs.find((x) => /^mount#0\|/.test(x.g.tag));
  const anc = arm && M.anchorPair(arm.g.node, arm.a.node, pairOf);
  t('共同錨取到那一顆**已對應**的祖先(掛架),而不是自己的父節點', (() => {
    if (!anc) return false;
    const naive = arm.g.node.parent === anc[0] && arm.a.node.parent === anc[1];
    return /^rack#0\|/.test(anc[0].userData.mtag) && !naive;   // 飛行側的父是反傾 Group ⇒ 兩邊的父不同調
  })(), anc ? `錨 = ${anc[0].userData.mtag}` : '找不到錨');
  t('錨 MUST 兩棵樹都是祖先(只在自己這一棵找 = 兩邊量在不同的框裡)',
    !!anc && (() => { let x = arm.a.node.parent; while (x && x !== anc[1]) x = x.parent; return x === anc[1]; })());
  t('沒有共同錨時回 null(呼叫端改用兩棵樹的根 —— 它們同框)',
    M.anchorPair(P.pairs[0].g.node, P.pairs[0].a.node, new Map()) === null);

  // 淡出淡入名冊
  const gf = M.fadeTargets(G, tags), af = M.fadeTargets(A, tags);
  t('地面型沒有要淡出的零件(這一台兩態同零件)', gf.length === 0, `${gf.length} 件`);
  t('只有飛行型才有的幾何(自己畫的艙殼 + 條件生的整流罩)MUST 走淡入',
    af.length === 2, `${af.length} 件`);
  t('對應上的零件 MUST NOT 進淡入名冊(它們靠移動/旋轉/伸縮交代,不是靠閃)',
    af.every((n) => !tags.has(n.userData.mtag || '')));

  // 收斂名冊
  const gSet = new Set(P.pairs.map((x) => x.g.node)), aSet = new Set(P.pairs.map((x) => x.a.node));
  const gr = M.restNodes(gSet, G), ar = M.restNodes(aSet, A);
  t('收斂名冊 = 對應零件的**沒對應**祖先(步態骨);樹根不收(根的局部變換恆是單位變換)',
    gr.length > 0 && !gr.includes(G) && !ar.includes(A) && gr.every((n) => !gSet.has(n)),
    `地面 ${gr.length} / 飛行 ${ar.length} 個節點`);
  t('飛行型的收斂名冊涵蓋它自己那條父鏈(tilt/hull:攤平機身的那幾個群組)',
    ar.length >= gr.length + 2, `地面 ${gr.length} / 飛行 ${ar.length}`);
  t('樞軸點群組(建構期就 visible=false)不參與變形演出', (() => {
    const R = node(), j = node();
    j.visible = false;
    j.add(mesh('SphereGeometry', 48, 0x7fd8ff, { r: 0.07 }));
    R.add(j);
    return M.fadeTargets(R, new Set()).length === 0;
  })());
  t('描邊外殼不算零件(它是本體的附屬,淡化時跟著本體走)', (() => {
    const R = node(), m0 = mesh('BoxGeometry', 24, 0x222222, { w: 1 }), sh = mesh('BoxGeometry', 24, 0x000000, { w: 1 });
    sh.userData.isOutline = true;
    m0.add(sh);
    R.add(m0);
    return M.fadeTargets(R, new Set()).length === 1;
  })());
}

// ══════════ Ⅲ 反推:兩棵樹在過渡中算出同一個世界解 ══════════
// 剛體代數(位置 + 四元數;縮放恆 1 —— 這一段驗的是「左乘固定變換與 lerp/slerp 可交換」)
const qmul = (a, b) => [
  a[3] * b[0] + a[0] * b[3] + a[1] * b[2] - a[2] * b[1],
  a[3] * b[1] - a[0] * b[2] + a[1] * b[3] + a[2] * b[0],
  a[3] * b[2] + a[0] * b[1] - a[1] * b[0] + a[2] * b[3],
  a[3] * b[3] - a[0] * b[0] - a[1] * b[1] - a[2] * b[2]];
const qrot = (q, v) => {
  const [x, y, z, w] = q;
  const ix = w * v[0] + y * v[2] - z * v[1], iy = w * v[1] + z * v[0] - x * v[2];
  const iz = w * v[2] + x * v[1] - y * v[0], iw = -x * v[0] - y * v[1] - z * v[2];
  return [ix * w + iw * -x + iy * -z - iz * -y, iy * w + iw * -y + iz * -x - ix * -z, iz * w + iw * -z + ix * -y - iy * -x];
};
const tmul = (A, B) => ({ p: qrot(A.q, B.p).map((v, i) => v + A.p[i]), q: qmul(A.q, B.q) });
const tinv = (A) => { const q = [-A.q[0], -A.q[1], -A.q[2], A.q[3]]; return { p: qrot(q, A.p).map((v) => -v), q }; };
const axisQ = (ax, ang) => { const s = Math.sin(ang / 2); return [ax[0] * s, ax[1] * s, ax[2] * s, Math.cos(ang / 2)]; };
const mixT = (A, B, t) => ({ p: A.p.map((v, i) => v + (B.p[i] - v) * t), q: M.slerpQ(A.q, B.q, t, [0, 0, 0, 1]) });
const tdist = (A, B) => Math.max(Math.hypot(...A.p.map((v, i) => v - B.p[i])),
  Math.min(...[1, -1].map((s) => Math.hypot(...A.q.map((v, i) => v - s * B.q[i])))));

console.log('\n【Ⅲ】反推:接縫零件的等價局部變換');
{
  // 地面型:零件掛在 chest 骨底下;飛行型:同一顆掛在攤平 90° 的 hull 底下(父鏈不同 = 接縫)
  const WpG = { p: [0, 3.1, 0], q: axisQ([0, 1, 0], 0.3) };
  const WpA = { p: [0, 3.1, -0.5], q: axisQ([1, 0, 0], Math.PI / 2) };
  const La = { p: [0.4, 0.2, 0.1], q: axisQ([0, 0, 1], 0.2) };      // 地面型的局部姿態
  const Lb = { p: [1.2, 0, -0.3], q: axisQ([0, 0, 1], -0.9) };      // 飛行型的局部姿態
  const Wg = tmul(WpG, La), Wf = tmul(WpA, Lb);
  const Bg = tmul(tinv(WpG), Wf);      // 反推:對面那一顆,換算到我這一顆的父之下
  const Aa = tmul(tinv(WpA), Wg);

  let worst = 0;
  for (let i = 0; i <= 20; i++) {
    const t0 = i / 20;
    const wG = tmul(WpG, mixT(La, Bg, t0));      // 地面那一棵算出來的世界解
    const wA = tmul(WpA, mixT(Aa, Lb, t0));      // 飛行那一棵算出來的世界解
    worst = Math.max(worst, tdist(wG, wA));
  }
  t('父節點在出廠姿態時,兩棵樹在**每一個**進度上算出同一個世界解(換樹因此看不出來)',
    worst < 1e-9, `最大差 ${worst.toExponential(2)}`);

  // 端點:內插到兩端 MUST 逐位元回到各自的靜止世界(不是「差不多」)
  t('兩端精確落在各自的靜止姿態(m=0 = 地面型出廠、m=1 = 飛行型出廠)',
    tdist(tmul(WpG, mixT(La, Bg, 0)), Wg) < 1e-12 && tdist(tmul(WpA, mixT(Aa, Lb, 1)), Wf) < 1e-12);

  // 步態把父節點帶偏之後:收斂權重 k 決定兩棵樹在換樹點差多少
  const live = tmul(WpG, { p: [0, 0.18, 0], q: axisQ([1, 0, 0], 0.22) });   // 走路中的 chest 骨
  const blend = (Wlive, Wrest, k) => ({ p: Wlive.p.map((v, i) => v + (Wrest.p[i] - v) * k), q: M.slerpQ(Wlive.q, Wrest.q, k, [0, 0, 0, 1]) });
  const gap = (k) => tdist(tmul(blend(live, WpG, k), mixT(La, Bg, 0.5)), tmul(WpA, mixT(Aa, Lb, 0.5)));
  t('換樹點(m=0.5)MUST 落在收斂帶內(k=1)—— 這是「換樹接得上」的唯一保證',
    M.restK(0.5) === 1 && gap(M.restK(0.5)) < 1e-9, `k=${f3(M.restK(0.5))} 時差 ${f3(gap(M.restK(0.5)))} m`);
  t('步態不收斂時真的會跳(對照:k=0 的落差就是步態把骨架帶偏的量)',
    gap(0) > 0.05, `k=0 差 ${f3(gap(0))} m`);

  // ---- 掛在「自己也在被內插的祖先」底下的零件(2026-08-15 t11 實測 1.99m 落差)----
  // 地面型:武裝直接掛在掛架上;飛行型:掛架與武裝之間多一層反傾 Group。
  const WG = WpG, WA = WpA;                                   // 掛架在兩態的靜止世界(= 共同錨)
  const Lg = { p: [0.2, -0.3, 0.1], q: axisQ([0, 1, 0], 0.4) };   // 地面型武裝的局部姿態
  const Lu = { p: [0, 0.05, 0], q: axisQ([1, 0, 0], -Math.PI / 2) };  // 反傾中介
  const Lc = { p: [0.1, -0.9, 0], q: axisQ([0, 0, 1], 0.15) };
  // 反推:錨版(相對共同錨量)vs 天真版(相對「我自己的父的靜止世界」量)
  const Bank = tmul(Lu, Lc);                                    // = inv(WG)·WG·inv(WA)·(WA·Lu·Lc)
  const Bnaive = tmul(tmul(tinv(WG), WA), tmul(Lu, Lc));        // = inv(WG)·(WA·Lu·Lc)
  const Aank = tmul(tinv(Lu), Lg);
  const useAnchor = !brk('anchor');
  let worstA = 0;
  for (let i = 0; i <= 20; i++) {
    const t0 = i / 20;
    const X = tmul(WG, mixT({ p: [0, 0, 0], q: [0, 0, 0, 1] }, tmul(tinv(WG), WA), t0));   // 錨自己的內插姿態
    const wG = tmul(X, mixT(Lg, useAnchor ? Bank : Bnaive, t0));
    const wA = tmul(tmul(X, Lu), mixT(Aank, Lc, t0));
    worstA = Math.max(worstA, tdist(wG, wA));
  }
  t('掛在「自己也在被內插的祖先」底下的零件 MUST 以**共同錨**量測(拿自己的父 = 祖先的運動被吃兩次)',
    worstA < 1e-9, `最大差 ${f3(worstA)} m(t11 的貨運掛架實測 1.99m)`);
}

// ══════════ Ⅳ 接線:locomotion ══════════
console.log('\n【Ⅳ】接線:locomotion(逐幀那一端)');
{
  let loco = readSrc('public', 'js', 'locomotion.js');
  const bustL = (name, from, to) => {
    if (!loco.includes(from)) { console.log(`  ✗ --break-${name} 沒有咬到目標原文(樣式過期)`); process.exit(1); }
    loco = loco.replace(from, to);
  };
  // 壞版 ⑤:姿態排在步態之前 ⇒ 本幀被步態整組覆寫(畫面上「變形完全沒作用」)
  if (brk('post')) {
    bustL('post', '  if (mesh.userData.morph) morphPose(mesh.userData.morph);\n', '');
    bustL('post', '  if (mesh.userData.morph) morphSwap(ent, mesh, dt);',
      '  if (mesh.userData.morph) { morphSwap(ent, mesh, dt); morphPose(mesh.userData.morph); }');
  }
  const iPose = loco.indexOf('if (mesh.userData.morph) morphPose(');
  const iGait = loco.indexOf("if (rig.kind === 'biped')");
  const iCast = loco.indexOf('stepCastPose(L, rig, ent, dt, now);');
  t('變形姿態是 post-pass(排在步態與招式/跳躍姿態**之後**)',
    iPose > 0 && iPose > iGait && iPose > iCast);
  t('換樹仍只在越過 0.5 那一次(可見性與 rig 指向 MUST 一起改,不能分兩處寫)',
    /if \(air !== M\.air0\) \{[^}]*M\.ag\.visible = air;[^}]*M\.gg\.visible = !air;[^}]*userData\.rig = air \? M\.air : M\.ground;/s.test(loco));
  t('兩棵樹每幀都寫(換樹那一幀新上台的那一棵要已經在正確姿態上)',
    /morphSide\(M\.plan\.g,[^;]*;\s*\n\s*morphSide\(M\.plan\.a,/.test(loco));
  t('兩端穩態一格不碰(`morphing` 為偽且上一幀也不在變形 ⇒ 直接 return)',
    /const on = morphing\(M\.m\);\s*\n\s*if \(!on && !M\.act\) return;/.test(loco));
  t('收工那一次把姿態寫死在端點(damp 是指數逼近,不寫死就永遠差一點點)',
    /const m = on \? M\.m : \(M\.m >= 0\.5 \? 1 : 0\);/.test(loco));
  t('`?morph=0` 對照組在冊(退回 2026-08-14 的根節點收摺,做 A/B 前後對照)',
    /const MORPH_RIG = /.test(loco) && /get\('morph'\) !== '0'/.test(loco)
    && /if \(MORPH_RIG && M\.plan\) \{ M\.k = restK\(M\.m\); return; \}/.test(loco));
  t('時間表 MUST 全部來自 morphrig.js(locomotion 這一端 MUST NOT 自己寫第二套曲線)',
    /from '\.\/morphrig\.js'/.test(loco)
    && !/const FADE = |Math\.abs\(M\.m - 0\.5\) \/ 0\./.test(loco.slice(loco.indexOf('function morphPose'))));
  t('暫存物件只有一份(逐幀幾百顆零件,逐顆配新物件 = 變形那半秒的 GC 停頓)',
    /const _mt = \{ p: \[0, 0, 0\]/.test(loco)
    && !/mixTRS\(e\.A, e\.B, t, \{/.test(loco));
}

// ══════════ Ⅴ 接線:forge(建構期那一端)══════════
console.log('\n【Ⅴ】接線:forge(反推那一端)');
{
  let fg = readSrc('public', 'js', 'forge', 'forge.js');
  const bustF = (name, from, to) => {
    if (!fg.includes(from)) { console.log(`  ✗ --break-${name} 沒有咬到目標原文(樣式過期)`); process.exit(1); }
    fg = fg.replace(from, to);
  };
  // 壞版 ⑥:兩棵樹共用一次包裝 ⇒ 飛行型的呼叫序號接在地面型後面,整台對不上
  if (brk('once')) bustF('once',
    '  const G = forgeTagged(DG, specGround, opts);\n  const A = forgeTagged(DG, specAir, opts);',
    '  const untag = DG ? tagBuilders(DG) : null;\n  const G = forgeMech(specGround, opts);\n  const A = forgeMech(specAir, opts);\n  untag?.();');
  t('兩棵樹**各包一次**(共用一份呼叫計數器 = 飛行型每一支建構器的序號都接在地面型後面)',
    /const G = forgeTagged\(DG, specGround, opts\);\s*\n\s*const A = forgeTagged\(DG, specAir, opts\);/.test(fg));
  t('包裝還原走 finally(拋錯留著包裝 = 這台機體之後每一次鍛造都在累加序號)',
    /function forgeTagged[\s\S]*?try \{ return forgeMech\(spec, opts\); \} finally \{ untag\?\.\(\); \}/.test(fg));
  t('包的是**地面型**那一份逐機檔(飛行檔 import 進來的是同一個參照 ⇒ 兩態同標籤)',
    /const DG = MECH_DETAIL\[specGround\.id\];/.test(fg));
  t('接縫零件的等價局部變換是**建構期**算完的(逐幀矩陣求逆 = 每幀幾百次)',
    /_mm\.copy\(from\.matrixWorld\)\.invert\(\)\.multiply\(ancFrom\.matrixWorld\)\s*\n?\s*\.multiply\(_m2\.copy\(ancTo\.matrixWorld\)\.invert\(\)\)\.multiply\(to\.matrixWorld\)/.test(fg)
    && /function captureMorphPlan/.test(fg));
  t('量測框 = **共同錨**(morphrig.anchorPair);拿自己的父 = 已對應祖先的運動被吃兩次',
    /const anc = anchorPair\(g\.node, a\.node, pairOf\);/.test(fg)
    && /const PG = anc \? anc\[0\] : gg, PA = anc \? anc\[1\] : ag;/.test(fg));
  t('錨恰好是雙方的父時走精確版(局部變換直接可比,不繞一圈浮點數)',
    /const kin = g\.node\.parent === PG && a\.node\.parent === PA;/.test(fg));
  t('靜止世界變換 MUST 在**兩棵樹都掛上根之後**量(matrixWorld 沒更新 = 全部量到單位矩陣)',
    /g\.add\(A\.group\);[\s\S]{0,400}?captureMorphPlan\(g, G\.group, A\.group\)/.test(fg)
    && /function captureMorphPlan\(root, gg, ag\) \{\s*\n\s*root\.updateMatrixWorld\(true\);/.test(fg));
  t('描邊外殼跟著本體淡(只淡本體 = 淡掉的零件留下一圈黑輪廓)',
    /for \(const c of n\.children\) if \(c\.userData\?\.isOutline\)/.test(fg));
  t('材質原值 MUST 記下來(淡完直接寫死 transparent=false 會關掉本來就半透明的件)',
    /push = \(m\) => \{ if \(m\) mats\.push\(\{ m, t0: m\.transparent, o0: m\.opacity, d0: m\.depthWrite \}\); \}/.test(fg));
  t('運動表交給 `userData.morph.plan`(缺席 ⇒ 退回根節點收摺,原則 6 降級不例外)',
    /morph = \{ ground: G\.rig, air: A\.rig, gg: G\.group, ag: A\.group, m: 0, air0: false, k: 0, act: false, plan \}/.test(fg));
  t('對應率記在 plan 上(掉下去就是某一支飛行檔開始自己畫幾何,而畫面上看不出來)',
    /n: \{ pair: P\.pairs\.length, soft:/.test(fg));

  const mr = readSrc('public', 'js', 'morphrig.js');
  t('`morphrig.js` 維持**零 import**(這一族唯一離線驗得到規則的地方)',
    !/^\s*import\s/m.test(mr));
  t('`morphrig.js` 零 three(三維物件一律鴨子型別:.children / .isMesh / .userData)',
    !/THREE|new Matrix4|Vector3\(/.test(mr));
}

// ══════════ Ⅵ 現役變形者:飛行檔真的沒有自己畫幾何 ══════════
// (真正的對應率要真瀏覽器量;離線只驗得到「飛行檔有沒有 import 地面檔的建構器」——
//  兩態同零件的**前提**。這一條紅 = 有人回頭在飛行檔裡另畫了一份幾何。)
console.log('\n【Ⅵ】現役變形者:飛行檔仍是「地面型零件 + 另一組擺位」');
{
  const FLIGHT = ['s03', 's10', 't06', 't11', 'm01', 'm05', 'm07', 'm08'];
  const bad = [];
  for (const id of FLIGHT) {
    const s = readSrc('public', 'js', 'forge', 'mechs', `${id}_flight.js`);
    if (!new RegExp(`import ${id} from '\\./${id}\\.js'`).test(s)) bad.push(`${id}:沒 import 地面檔`);
    if (!new RegExp(`${id}\\.`).test(s)) bad.push(`${id}:沒呼叫地面型建構器`);
  }
  t('八台變形者的飛行檔全部 import 並呼叫**地面型**的建構器(兩態同零件的前提)',
    bad.length === 0, bad.join(' / '));
}

console.log(`\n${fail ? '❌' : '✅'} 變形過程稽核:${pass}/${pass + fail} 通過`);
process.exit(fail ? 1 : 0);
