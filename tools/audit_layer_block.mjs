// ============ Coating two-sided blocking audit (terrain / deck / tunnel roof + floor / obstacle boxes) ============
// Purpose: offline defense for the rule "terrain, roads and other coatings MUST obey physics
// collision both ways — upward and downward gunfire are both stopped, except where transparently
// passable" (user decision 2026-07-30) + "gallery ceilings cannot be stepped on from above; like
// decks they obey physics, no crossing or penetrating attacks; tunnel and underpass ceilings likewise"
// (user decision 2026-08-03).
//
// "Coating" in one sentence: any solid face separating the space above from the space below —
// terrain heightfield, bridge deck, tunnel roof, tunnel floor, building/megalith tops and bottoms.
// Their shared MUSTs:
//   1 **Two-sided**: crossing the same face top-down or bottom-up must both be cut; MUST NOT block
//     only one direction;
//   2 **Transparent exception**: where you can see through (triangles deleted by punchPortalHoles =
//     portals, underpass approach open cuttings) both directions always pass — visible means
//     hittable (A29 / A6);
//   3 **Blocking = standable**: the face that stops gunfire is simultaneously a standing surface
//     (deck `deckY`, tunnel roof `tunRoofTop`) — doing only one half is the "bullets stop but feet
//     fall through" clipping bug (the prior case in section V).
//
// Why it leaks (three prior cases, each pinned here):
//   I Thin plate wrote the ceiling but not the floor — warheads fired at the ground inside the bore
//     pierce the road into the rock (the terrain analytic ray finds no intersection on the mountain's
//     inner side) and fly through to the far side before detonating.
//   II Obstacle-box top-face check hung `dy < 0` (top-down only) + verified only the "entry height" —
//     rays crossing the building bottom-up leak entirely; server `_losBlocked` always meant
//     "crossing interval ∩ [0,h]" ⇒ client counts a hit, server counts blocked = damage silently
//     evaporates (A30: both ends MUST share the cross-section).
//   III Terrain uses `p.y <= heightAt(p.x, p.z)` as the ballistic gate — that asks "below the surface",
//     not "crossed the surface": bottom-up leaks entirely, and heightAt ignores punch-outs (cover-section
//     mountain height untouched) ⇒ portals/bores become visible-but-impenetrable phantom mountains
//     (firing inside a tunnel = shell detonating at the muzzle).
//   IV Detonation takes `heightAt` as the ground — cover-section mountain height was never excavated,
//     so bore detonations get lifted to the summit: explosion drawn on the mountain, height-above-ground
//     back to 1, lev back to 0 ⇒ bore units judged by sim `_slabSep` as on the plate's other side = a whole
//     grenade in the bore dealing zero damage. Only after I added the floor do warheads actually stop
//     on the tunnel floor, making this the hot path.
//   V Ceilings only "blocked ballistics" without "standing surface" — deep tunnels hide it (the mountain
//     above the roof is taller than the plate anyway, so `heightAt` catches it), but a **gallery**
//     roof is a structure exposed outside the terrain: walking over from the slope, `surfaceAt`
//     returns the side slope excavated by `carveGalleryBands` down to road level ⇒ the whole mech falls
//     through the visible roof into the bore (user report 2026-08-03 "cannot step on gallery ceiling").
//     Fix = roof top `tunRoofTop(ceil)` serves as standing surface and ballistic plate upper bound
//     together, symmetric with deck `deckY` rule by rule.
//
// Why "extract source" instead of import: `game.js` three.js rides the CDN importmap, Node cannot
// resolve it; what gets evaluated is still the **actual program text** (a recopied formula would
// pass forever). Every executable assertion carries its own reverse control: restore the bad version
// and the matching item MUST go red immediately.
// Usage: `node tools/audit_layer_block.mjs`
// Exit code: 0 = all green; 1 = red present
//
// ---- Seam discipline: "unowned thresholds" (merged 2026-08-16, `docs/anime_style_plan.md` 4-4; pure
// comment, zero assertion changes) ----
// This file's core invariant (**standable = blocking**, both ends MUST share one face) and the seam-trap
// family recorded in the reference project are two writings of one rule. Existing section V already
// guards the "top face" half; what follows is its twin symptom, with **no assertion** guarding it today:
//
//  A **Where one region's platform stops, the next region's MUST start.** Symptom: *the player drops
//    to natural ground at the seam of two structures and cannot climb back*. Cause is nobody's bug —
//    **two modules each correctly finished their own job**, leaving a stretch owned by no one (reference
//    project measured: a 0.6 m unowned threshold = a 1.79 m fall). This project's three landing points:
//    deck ⇄ approach, tunnel roof ⇄ terrain, gallery open section ⇄ cover section. The first two are
//    currently held by `surfaceAt` taking `max(terrain, roof)` plus `deckAt` overlap, the third by A29-4
//    "cover intervals re-verified point-by-point at full width". ⇒ **when changing either end's boundary
//    condition, MUST ask "did the other end grow with it"**, not just "is my end right".
//  B **Flooding, not humans, catches it.** Height queries at platform boundaries are exclusive ⇒ a query
//    landing on the seam matches neither and returns raw ground height; a real player almost never steps
//    exactly on that line, while `audit_traverse`'s 0.35 m flood grid **steps on it every time**. ⇒
//    A red here and a traverse red are two ends of the same thing; MUST NOT dismiss it as a false
//    positive because "it plays fine".
//    (This file only verifies the rule's shape; walking it for real is `audit_traverse`, which needs
//    the network.)
import { readSrc } from './audit_src.mjs';

// Source is always read via `readSrc` (section-5 general rule ㋑; newlines normalized to LF) —
// a Windows checkout is CRLF, so a trailing `\n  }` method match fails as a group without it
const read = (f) => readSrc('public', 'js', f);
const G = read('game.js');
const M = read('main.js');
const B = read('biomes.js');

let pass = 0, fail = 0;
const ok = (c, msg) => { c ? pass++ : (fail++, console.error(`  ✗ ${msg}`)); };

/** Excerpt a game.js class-method source (2-space indent, ends at the first `\n  }`); src may be swapped for a broken copy */
function pickMethod(name, src = G) {
  const P0 = src.indexOf(`\n  ${name}(`);
  if (P0 < 0) throw new Error(`game.js 找不到 ${name}`);
  const P1 = src.indexOf('\n  }\n', P0);
  if (P1 < 0) throw new Error(`game.js ${name} 收尾解析失敗`);
  return new Function(`return function ${name}${src.slice(P0 + 3 + name.length, P1 + 4)}`)();
}

// ---------------- Test landscape (pure data stubs, no formula copied from biomes/main) ----------------
// Tunnel: along +X from x=0 to x=100, z=0, half-width 9, floor 100 / ceiling underside 108 / roof top 109 (plate 1 thick).
// Bridge: along +X from x=0 to x=100, z=200, half-width 8, deck 150 (plate deckUnder=1.2).
const TUN = { x0: 0, x1: 100, hw: 9, floor: 100, ceil: 108, roof: 109 };
const DECK = { z: 200, x0: 0, x1: 100, hw: 8, y: 150 };
const tunnelAt = (open) => (x, z) =>
  (x >= TUN.x0 && x <= TUN.x1 && Math.abs(z) <= TUN.hw
    ? { floor: TUN.floor, ceil: TUN.ceil, roof: TUN.roof, open } : null);
const deckY = (x, z) =>
  (x >= DECK.x0 && x <= DECK.x1 && Math.abs(z - DECK.z) <= DECK.hw ? DECK.y : null);
const slabEnv = (open = false, src = G) => ({
  terrain: { tunnelAt: tunnelAt(open), deckY, deckUnder: 1.2 },
  _slabHitT: pickMethod('_slabHitT', src),
});
const slabBlocked = (env, a, b) => env._slabHitT.call(env, a[0], a[1], a[2], b[0], b[1], b[2]) != null;

console.log('== 塗層雙面阻擋稽核 ==');

console.log('\n=== Ⅰ 水平薄板(_slabHitT):橋面 / 隧道天花 / 隧道路面 ===');
{
  const env = slabEnv(false);
  // Bore: the cavity between ceiling and floor MUST be open (tunnel lanes trade fire normally)
  ok(!slabBlocked(env, [10, 103, 0], [90, 103, 0]), 'Ⅰ 洞內水平對射(路面↔天花之間)MUST 通');
  ok(!slabBlocked(env, [10, 103, 0], [90, 106, 0]), 'Ⅰ 洞內微仰射(仍在空腔內)MUST 通');
  // Ceiling: both directions
  ok(slabBlocked(env, [50, 103, 0], [50, 120, 0]), 'Ⅰ 洞內往上打天花 MUST 擋');
  ok(slabBlocked(env, [50, 120, 0], [50, 103, 0]), 'Ⅰ 山體上方往下打進洞裡 MUST 擋(穿天花)');
  // The roof is a **plate with thickness** [ceil, roof] (2026-08-03 "same as decks: no penetrating
  // attacks from above"): same semantics as deck [deckY - deckUnder, deckY] — inside-plate and grazing
  // both count as crossing; only outside the plate (above the roof / inside the bore) passes
  ok(slabBlocked(env, [10, 108.5, 0], [90, 108.5, 0]),
    'Ⅰ 射線整條走在頂板板體內 MUST 擋(只驗「跨過天花底面」的舊制會整條漏放)');
  ok(slabBlocked(env, [10, 109.5, 0], [90, 108.2, 0]),
    'Ⅰ 站在頂板上朝洞口低伸、削過頂板 MUST 擋 —— 這正是「從上面穿透攻擊」那一發');
  ok(!slabBlocked(env, [10, 112, 0], [90, 112, 0]), 'Ⅰ 頂板上方水平對射 MUST 通(站頂板上互射)');
  ok(slabBlocked(env, [50, 112, 0], [50, 103, 0]), 'Ⅰ 站頂板上往下打洞內 MUST 擋(穿整塊頂板)');
  ok(slabBlocked(env, [50, 103, 0], [50, 112, 0]), 'Ⅰ 洞內往上打站頂板上的人 MUST 擋(雙面)');
  // Floor: both directions — the old scheme wrote only the ceiling; these two are this rule's core
  ok(slabBlocked(env, [50, 103, 0], [50, 92, 0]), 'Ⅰ 洞內往下打路面 MUST 擋(漏判 = 彈頭穿馬路鑽岩盤)');
  ok(slabBlocked(env, [50, 92, 0], [50, 103, 0]), 'Ⅰ 路面底下往上打 MUST 擋(雙面)');
  // Crossing sideways outside the bore (off the ribbon) MUST pass
  ok(!slabBlocked(env, [50, 103, 40], [50, 92, 40]), 'Ⅰ 隧道 ribbon 外的上下射擊 MUST 通(不誤擋)');

  // Open section (underpass approach open cutting): sky above, native terrain underfoot ⇒ both
  // ceiling and floor MUST pass (A29)
  const envOpen = slabEnv(true);
  ok(!slabBlocked(envOpen, [50, 103, 0], [50, 120, 0]), 'Ⅰ open 段 MUST NOT 有隱形天花(A29)');
  ok(!slabBlocked(envOpen, [50, 103, 0], [50, 92, 0]), 'Ⅰ open 段 MUST NOT 有隱形路面(A29;看得到就打得到)');

  // Deck plate: crossing up/down blocked, same-side level fire passes
  ok(slabBlocked(env, [50, 153, 200], [50, 140, 200]), 'Ⅰ 橋上往下打橋面 MUST 擋');
  ok(slabBlocked(env, [50, 140, 200], [50, 153, 200]), 'Ⅰ 橋下往上打橋面 MUST 擋');
  ok(!slabBlocked(env, [10, 153, 200], [90, 153, 200]), 'Ⅰ 橋面上水平對射 MUST 通');
  ok(!slabBlocked(env, [10, 140, 200], [90, 140, 200]), 'Ⅰ 橋下水平對射 MUST 通');

  // Reverse control: removing the floor term ⇒ both floor assertions MUST fail at once (proves the real term is verified)
  const noFloor = G.replace('\n                || (yHi !== yLo && (py - tn.floor) * (y - tn.floor) <= 0)', '');
  ok(noFloor !== G, 'Ⅰ 反向對照:找得到路面判定原文(改名了就 MUST 同步改本稽核)');
  const envNF = slabEnv(false, noFloor);
  ok(!slabBlocked(envNF, [50, 103, 0], [50, 92, 0]) && !slabBlocked(envNF, [50, 92, 0], [50, 103, 0]),
    'Ⅰ 反向對照:拿掉路面項 MUST 讓「洞內往下 / 路面底下往上」雙雙漏放');
  // Reverse control: roof plate back to the old "crossing the ceiling underside only" single face ⇒
  // the in-plate / grazing pair MUST leak at once, while "up from bore / down from above" still
  // block (proving the difference sits solely in the **plate-thickness** dimension, not a wholesale failure)
  const thin = G.replace('(yLo <= tn.roof && yHi >= tn.ceil)', '(yHi !== yLo && (py - tn.ceil) * (y - tn.ceil) <= 0)');
  ok(thin !== G, 'Ⅰ 反向對照:找得到頂板板體判定原文');
  const envT = slabEnv(false, thin);
  ok(!slabBlocked(envT, [10, 108.5, 0], [90, 108.5, 0]) && !slabBlocked(envT, [10, 109.5, 0], [90, 108.2, 0]),
    'Ⅰ 反向對照:頂板退回零厚度 MUST 讓「板體內 / 擦邊削過」雙雙漏放');
  ok(slabBlocked(envT, [50, 103, 0], [50, 120, 0]) && slabBlocked(envT, [50, 120, 0], [50, 103, 0]),
    'Ⅰ 反向對照:零厚度版仍擋「洞內往上 / 上方往下」(差異單獨落在板厚這一維)');
}

console.log('\n=== Ⅱ 障礙橫斷面(_blockerHitT):側面 / 頂面 / 底面不分方向 ===');
{
  // 40x40 square, base y=19, height 60 ⇒ vertical band [18.5, 79]
  const box = [{ x: 0, z: 0, y: 19, h: 60, hw2: 20, hd2: 20, ry: 0, r: Math.hypot(40, 40) / 2 }];
  const mk = (src = G) => {
    const self = { _blockGrid: pickMethod('_buildBlockGrid', src).call({}, box) };
    const fn = pickMethod('_blockerHitT', src);
    return (a, b) => fn.call(self, a[0], a[1], a[2], b[0], b[1], b[2]) != null;
  };
  const hit = mk();
  ok(hit([-30, 30, 0], [30, 30, 0]), 'Ⅱ 側面水平穿越 MUST 擋');
  ok(hit([0, 120, 0], [0, 40, 0]), 'Ⅱ 正上方垂直往下打頂面 MUST 擋');
  ok(hit([0, 0, 0], [0, 120, 0]), 'Ⅱ 正下方垂直往上打底面 MUST 擋');
  ok(hit([-30, 0, 0], [30, 90, 0]), 'Ⅱ 由下往上斜穿樓體 MUST 擋(入點在盒底之下,舊制整條漏放)');
  ok(hit([-30, 90, 0], [30, 0, 0]), 'Ⅱ 由上往下斜穿樓體 MUST 擋(同一條線反向,結果 MUST 對稱)');
  ok(!hit([-30, 90, 0], [30, 90, 0]), 'Ⅱ 全程高過樓頂 MUST 通');
  ok(!hit([-30, 10, 0], [30, 10, 0]), 'Ⅱ 全程低於盒底 MUST 通(不誤擋)');
  ok(!hit([-30, 30, 60], [30, 30, 60]), 'Ⅱ 盒外側向 MUST 通(不誤擋)');

  // Reverse control: restoring `dy < 0` to the vertical-band check (top-down only) ⇒ both
  // bottom-up lines MUST leak at once
  const oneWay = G.replace('if (dy > 1e-6 || dy < -1e-6) {', 'if (dy < -1e-6) {');
  ok(oneWay !== G, 'Ⅱ 反向對照:找得到方向無關的垂直帶判定原文');
  const hitOW = mk(oneWay);
  ok(!hitOW([0, 0, 0], [0, 120, 0]) && !hitOW([-30, 0, 0], [30, 90, 0]),
    'Ⅱ 反向對照:退回單向(dy<0)MUST 讓「由下往上」雙雙漏放');
  ok(hitOW([-30, 30, 0], [30, 30, 0]) && hitOW([0, 120, 0], [0, 40, 0]),
    'Ⅱ 反向對照:單向版仍擋側面/頂面(證明差異單獨落在「往上」這一維)');
}

console.log('\n=== Ⅲ 地形高度場:解析射線唯一縫,MUST NOT 退回單面 heightAt ===');
{
  ok(!/\.y <= this\.terrain\.heightAt\(/.test(G),
    'Ⅲ MUST NOT 以 `y <= terrain.heightAt(x,z)` 當彈道閘 —— 那是「在地表以下」不是「穿過地表」'
    + '(由下往上漏放 + 不吃打洞 ⇒ 洞口變隱形山體)');
  const seg = pickMethod('_terrainSegT');
  ok(/this\._terrainHitT\(/.test(seg.toString()),
    'Ⅲ _terrainSegT MUST 走 _terrainHitT(rayTerrain 唯一縫,MUST NOT 另開第二條地形射線)');
  const layer = pickMethod('_layerHitT').toString();
  ok(/this\._terrainSegT\(/.test(layer) && /this\._obstHitT\(/.test(layer),
    'Ⅲ _layerHitT MUST = 地形 ∪ 障礙/薄板(取較近),兩者缺一即有一種塗層不擋彈');
  // Consumers: presentation shells and grenade aim arcs MUST share it (the old scheme hand-wrote
  // one heightAt check each)
  for (const [m, why] of [['_updateVisShells', '他人/bot 視覺彈體'], ['_arcTrace', '榴彈瞄準虛線/火控驗證']]) {
    ok(/this\._layerHitT\(prev\.x, prev\.y, prev\.z/.test(pickMethod(m).toString()),
      `Ⅲ ${m}(${why})MUST 走 _layerHitT`);
  }
  // Only rayTerrain sees punchPortalHoles' triDead; heightAt does not ⇒ the transparent exception can only hold via rayTerrain
  ok(/triDead/.test(read('terrain.js')),
    'Ⅲ terrain.js MUST 保留 triDead(打洞記帳)—— 洞口的「透明可穿透例外」唯一來源');
}

console.log('\n=== Ⅳ 爆點的離地基準面與結構層(彈頭現在真的會停在隧道路面上)===');
{
  // Cover-section terrain was never excavated ⇒ heightAt is the mountain overhead, not the floor underfoot.
  ok(/const gy = inTun \? btn\.floor : this\.terrain\.heightAt\(p\.x, p\.z\);/.test(G),
    'Ⅳ 爆點基準 MUST 在洞內改取隧道路面 —— 拿 heightAt 會把爆點抬到山頂'
    + '(爆炸畫在山上、離地高歸 1、lev 掉 0 ⇒ 洞內單位被 _slabSep 判成板體另一側 = 零傷害)');
  ok(/const inTun = !!\(btn && !btn\.open && p\.y < btn\.ceil\);/.test(G),
    'Ⅳ 爆點洞內判定 MUST 濾 open(露天路塹腳下就是地形本體,照走 heightAt;A29)');
  // Decks deliberately never report lev 1: server _unitLev pins towers/bases at 0; reporting 1 =
  // bridge turrets fully immune to AoE
  ok(/lev: inTun \? 2 : 0/.test(G),
    'Ⅳ 爆點 lev MUST 只報 0/2 —— 橋面報 1 會讓橋上砲塔被 _slabSep 判成板體另一側 = AoE 免傷(刻意設計)');
  const sim = readSrc('server', 'sim.js');
  ok(/if \(e\.kind === 'tower' \|\| e\.kind === 'base'\) return 0;/.test(sim),
    'Ⅳ 上述「刻意不報 1」的前提 = sim._unitLev 讓塔/主堡恆為 lev 0(前提變了 MUST 重審這條)');
}

console.log('\n=== Ⅴ 隧道頂板頂面 = 可站立結構面(擋得住 = 站得上去)===');
{
  // ---- Single seam: roof top has only the tunRoofTop definition; all three consumers use it ----
  const defs = B.match(/^const tunRoofTop = .*$/gm) || [];
  ok(defs.length === 1, `Ⅴ biomes.js 的 tunRoofTop MUST 只有一份定義(找到 ${defs.length} 份)`);
  ok(/const tunRoofTop = \(cy\) => cy \+ TUN\.ROOF_T;/.test(B),
    'Ⅴ tunRoofTop MUST = 天花底面 + TUN.ROOF_T(板厚走旋鈕,MUST NOT 手寫數字)');
  // Consumers: exposed roof top / column tops / standing+ballistic index — any hand-written
  // `+ TUN.ROOF_T` splits the seen top from the stood-on top (player floating a notch above the plate,
  // or sunk into it)
  for (const [re, why] of [
    [/const topAt = \(i\) => tunRoofTop\(ceilOf\(cum\[i\]\)\);/, '明隧道外露頂板 galRoof 的頂面'],
    [/y1: tunRoofTop\(ceilOf\(cum\[i\]\)\),/, '明隧道柱列 galCols 的柱頂'],
    [/roof: tunRoofTop\(ceil\)/, '站立/彈道索引 makeTunnelIndex 的 roof'],
  ]) ok(re.test(B), `Ⅴ ${why} MUST 走 tunRoofTop 單一縫`);
  // Beyond the roof-top definition, `+ TUN.ROOF_T` may only appear in the "does terrain hide the
  // roof" **threshold** formula (different semantics). Count with per-line comment stripping —
  // names mentioned in comments would otherwise never add up (same CRLF/comment family as ㋑).
  const code = B.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\*.*$/gm, '').replace(/\/\/.*$/gm, '');
  const stray = (code.match(/\+ TUN\.ROOF_T/g) || []).length;
  const thresh = (code.match(/TUN\.CLEAR \+ TUN\.ROOF_T/g) || []).length;
  ok(stray === thresh + 1,
    `Ⅴ 除了 tunRoofTop 的定義與覆蓋門檻式,MUST NOT 再有手寫的 + TUN.ROOF_T(${stray} vs ${thresh}+1)`);

  // ---- Behavior: execute main.js's genuine surfaceAt source ----
  const num = (name, src = M) => {
    const m = new RegExp(`const ${name} = ([\\d.]+);`).exec(src);
    if (!m) throw new Error(`main.js 找不到 ${name}`);
    return +m[1];
  };
  const K = { DECK_STEP: num('DECK_STEP'), DECK_MARGIN: num('DECK_MARGIN'),
    DECK_UNDER: num('DECK_UNDER'), MAX_MECH_H: num('MAX_MECH_H'), BLK_MARGIN: num('BLK_MARGIN') };
  // No roof-platform data in the test landscape, yet the new surfaceAt-closure dependency must be
  // injected explicitly — a silent sandbox drift from the genuine article otherwise.
  const roofPlatformAtStub = () => null;
  const mkSurf = (heightAt, tunAt, src = M, deckAt = () => null) => {
    const P0 = src.indexOf('    terrain.surfaceAt = (x, z, curY) => {');
    const P1 = src.indexOf('\n    };', P0);
    if (P0 < 0 || P1 <= P0) throw new Error('main.js 找不到 surfaceAt(結構已變?)');
    const keys = ['heightAt', 'tunnelAt', 'deckY', 'blockerTop', 'roofPlatformAt', ...Object.keys(K)];
    return new Function(...keys,
      `const terrain = { heightAt };\n${src.slice(P0, P1 + 7)}\nreturn terrain.surfaceAt;`)(
      heightAt, tunAt, deckAt, () => null, roofPlatformAtStub, ...Object.keys(K).map((k) => K[k]));
  };
  // Gallery: roof exposed outside the terrain (side slope excavated by carveGalleryBands to road level)
  const GAL_H = TUN.floor + 1;                       // off-bore side-slope terrain (far below roof 109)
  const galSurf = (src = M) => mkSurf(() => GAL_H, tunnelAt(false), src);
  {
    const s = galSurf();
    ok(s(50, 0, TUN.roof) === TUN.roof, 'Ⅴ 明隧道:站在頂板頂面 MUST 回頂板(舊制回側坡地表 = 踩空掉進洞裡)');
    ok(s(50, 0, TUN.roof + 6) === TUN.roof, 'Ⅴ 明隧道:自上方落下 MUST 落在頂板上(不是穿過去)');
    ok(s(50, 0, TUN.ceil + 0.2) === TUN.roof, 'Ⅴ 陷進板體內 MUST 被抬回頂面(板體 [ceil, roof] 塞不下人)');
    ok(s(50, 0, TUN.floor + 2) === TUN.floor, 'Ⅴ 洞內(curY < ceil)MUST 仍站路面 —— MUST NOT 被吸到頂板上');
    ok(s(50, 40, TUN.roof) === GAL_H, 'Ⅴ ribbon 外(側坡上)MUST 照踩地表(頂板不外溢成隱形平台)');
    ok(s(50, 0, null) === GAL_H, 'Ⅴ curY 省略(貼地渲染查詢)MUST 維持裸地形語意');
  }
  // Deep mountain tunnel / underpass: the cover threshold already requires terrain >= roof top ⇒
  // max() always yields terrain, bit-identical
  {
    const H = TUN.roof + 21;
    const s = mkSurf(() => H, tunnelAt(false));
    ok(s(50, 0, H) === H, 'Ⅴ 深埋隧道:頂上走的仍是山體地表(MUST NOT 在山坡上長出隱形平台)');
  }
  // Open section (underpass approach open cutting): open sky above, no roof to stand on (A29)
  {
    const s = mkSurf(() => GAL_H, tunnelAt(true));
    ok(s(50, 0, TUN.roof) === GAL_H, 'Ⅴ open 段 MUST NOT 有可站的隱形頂板(A29;露天溝頭上是天空)');
  }
  // Low deck: with belly clearance below the largest mech, runtime MUST route queries below to the
  // deck, and ceilingAt's MAX_MECH_H gate gives up blocking the under-deck ceiling; otherwise the
  // approach gets stuck in a dead zone — cannot board the bridge, cannot pass under.
  {
    const lowDeck = mkSurf(() => 0, () => null, M, () => 5.5);
    ok(lowDeck(50, 200, 0) === 5.5,
      'Ⅴ 低架橋:底緣淨空不足時 surfaceAt MUST 強制上橋(不得卡在橋腹下)');
    ok(/\(d - DECK_UNDER\) - h < MAX_MECH_H\)\) s = d;/.test(M),
      'Ⅴ 低架橋:surfaceAt MUST 以 MAX_MECH_H 將低架段分類為橋面專用');
    ok(/under - terrain\.heightAt\(x, z\) >= MAX_MECH_H/.test(M),
      'Ⅴ 低架橋:ceilingAt MUST 只阻擋真正可鑽越的高架段');
  }
  // Reverse control: dropping the roof standing-surface line ⇒ the gallery set MUST fall back to
  // side-slope terrain at once (= the reported stepping-into-air), while deep/bore/open sets stay put
  // (proving the difference sits solely on the "roof exposed outside terrain" landform)
  const noRoof = M.replace('      if (tn && !tn.open && tn.roof > s) s = tn.roof;\n', '');
  ok(noRoof !== M, 'Ⅴ 反向對照:找得到頂板站立面原文(改名了就 MUST 同步改本稽核)');
  {
    const s = galSurf(noRoof);
    ok(s(50, 0, TUN.roof) === GAL_H && s(50, 0, TUN.roof + 6) === GAL_H,
      'Ⅴ 反向對照:拿掉頂板站立面 MUST 讓明隧道整組踩空(頂板變成看得見卻踩不到的貼圖)');
    ok(s(50, 0, TUN.floor + 2) === TUN.floor,
      'Ⅴ 反向對照:洞內站路面不受影響(差異單獨落在「天花之上」那一側)');
  }
}

console.log(`\n${fail ? '✗' : '✓'} 塗層雙面阻擋:${pass} 通過 / ${fail} 失敗`);
process.exit(fail ? 1 : 0);
