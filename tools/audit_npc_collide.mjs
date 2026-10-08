// ============ NPC flight altitude datum / NPC-vs-mech solid collision audit ============
// Purpose: offline defense for two user reports (2026-08-04) —
//   1 "sometimes NPC flyers over a bridge sink ever lower"
//   2 "physical collision between NPCs and mechs must not clip through models"
//
// — 1 Flyer altitude datum —————————————————————————————
// Root cause: flyer ground-hugging rendering reused the **ground** units' per-frame ratchet —
// `surfaceAt(x, z, curY)` disambiguates "am I above or below the bridge" from the "previous frame's
// altitude", while a flyer's curY seed is `cur.y - heroY`. When the lane crowds, `sim._advance`
// side-push shoves a helicopter off the deck footprint once (`deckY` returns null) ⇒ the seed falls
// back to the riverbed below, after which neither re-boarding condition ever holds again
// (distance to deck > `DECK_STEP`, and belly clearance >= largest mech) ⇒ the datum stays on the
// riverbed **permanently**: the helicopter hugs the valley floor and pierces the deck. The ratchet
// is one-way, so the symptom is "sinking ever lower", never jitter.
// Fix: flyers now consume `_flySurf(x, z)` = a **pure function of position** (max of terrain, deck,
// tunnel roof) — no state, no unrecoverable state. This section's core assertion is therefore
// **path independence**: same coordinate, bit-identical altitude regardless of where it flew in from
// (the old scheme gives two answers on one path — that is the reverse control).
//
// — 2 Unit collision ———————————————————————————————————
// Root cause: client `_collide` did push-out only for **units** (its own loop, ahead of the sweep),
// with only `terrain.blockers` swept. "Sweep and push-out are both required" (CLAUDE.md collision
// volumes) holds for buildings and equally for units: knockback / charged jump / a dropped frame moves
// several meters per frame >> one infantryman's diameter, so the endpoint already lands on the far
// side ⇒ push-out finds no overlap ⇒ whole mechs pass through soldiers/tanks/enemy mecha. But the
// server half (`sim.solidResolve`) always swept + pushed ⇒ split ends (A30 family: players pass,
// the AI does not).
// Fix: units and world obstacles share one pipeline (one roster → sweep → interleaved push-out);
// cylinder geometry collapses into the two single implementations `_circleEnter`/`_pushOutCircle`,
// compared case-by-case against the server `solidEnter`/`solidPush` cylinder branch.
//
// Why "extract source" instead of import: `game.js` three.js rides the CDN importmap, Node cannot
// resolve the whole module; what gets evaluated is still the **actual program text** (a recopied
// formula in the audit would pass forever).
//
// Usage: `node tools/audit_npc_collide.mjs`
//   Reverse verification (break the genuine source and re-run; the matching item MUST go red,
//   otherwise nothing is verified — principle 9):
//     `--break-ratchet` fly branch back to per-frame ratchet ⇒ Ⅲ red
//     `--break-deck`    `_flySurf` ignores the deck          ⇒ Ⅰ② / Ⅱ red
//     `--break-sweep`   drop unit sweeping                    ⇒ Ⅴ / Ⅵ① red
// Exit code: 0 = all green; 1 = red present
import { readSrc, grabMethod, grabFn } from './audit_src.mjs';
import { pedestrianEntranceCollider } from '../public/js/pedestrian.js';
import { PUSH_EPS } from '../public/js/data.js';

const ARGV = new Set(process.argv.slice(2));
const BREAK_RATCHET = ARGV.has('--break-ratchet');
const BREAK_DECK = ARGV.has('--break-deck');
const BREAK_SWEEP = ARGV.has('--break-sweep');

let G = readSrc('public', 'js', 'game.js');
const S = readSrc('server', 'sim.js');

/** Breakage rules for reverse verification: MUST actually change something (a no-op flag makes reverse verification falsely green) */
const bust = (re, to, tag) => {
  const next = G.replace(re, to);
  if (next === G) throw new Error(`反向驗證 ${tag}:原文沒有匹配到目標,改壞規則已失效`);
  G = next;
};
if (BREAK_RATCHET) bust(/gy = this\._flySurf\(nx, nz\);/, 'gy = this._surf(nx, nz, cur.y - lift);', '--break-ratchet');
if (BREAK_DECK) bust(/\n    const d = t\.deckY\?\.[^\n]*\n    if \(d != null && d > s\) s = d;[^\n]*/, '', '--break-deck');
if (BREAK_SWEEP) bust(/\n    for \(const u of units\) \{\n      const t = this\._circleEnter[\s\S]*?\n    \}/, '', '--break-sweep');

let pass = 0, fail = 0;
const ok = (c, msg) => { c ? pass++ : (fail++, console.error(`  ✗ ${msg}`)); };
const sec = (t) => console.log(`\n=== ${t} ===`);
/** Strip trailing line comments (single-seam counting: names mentioned in comments do not count as implementations) */
const strip = (s) => s.split('\n').map((l) => l.replace(/\/\/.*$/, '')).join('\n');
/** Occurrence count in the whole file (after stripping comments) */
const count = (src, re) => (strip(src).match(re) || []).length;
/** Compile a class-method source excerpt into a callable (free identifiers injected by the caller) */
const meth = (name, src = G, free = {}) => {
  const keys = Object.keys(free);
  const body = grabMethod(src, name);
  const f = new Function(...keys, `return function ${body.slice(name.length + 3)}`);
  return f(...keys.map((k) => free[k]));
};

console.log('== NPC 飛行高度基準 / NPC ⇄ 機體碰撞稽核 ==');

// ---------------- Synthetic landscape (pure data stubs; no formula copied from main/biomes) ----------------
// Valley: terrain sinks to 0 (riverbed) for x in [0, 200], 40m tableland on both banks.
// Bridge: along +X from x=-30 to x=230, z=0, half-width 8, deck flat at 46 (valley clearance 46 >> largest
// mech, so passing under is never sucked onto the deck).
// Mountain tunnel: x in [300, 420], |z| <= 9, floor 40 / ceiling 48 / roof top 49, summit terrain 120.
const heightAt = (x) => {
  if (x >= 300 && x <= 420) return 120;            // the mountain holding the tunnel
  if (x > 0 && x < 200) return 0;                  // riverbed
  return 40;                                       // tableland on both banks
};
const DECK = { x0: -30, x1: 230, hw: 8, y: 46 };
const deckY = (x, z, m = 0) =>
  (x >= DECK.x0 && x <= DECK.x1 && Math.abs(z) <= DECK.hw + m ? DECK.y : null);
const tunnelAt = (x, z) =>
  (x >= 300 && x <= 420 && Math.abs(z) <= 9 ? { floor: 40, ceil: 48, roof: 49, open: false } : null);

// main.js surfaceAt (old ratchet) — the **genuine rule** used as the reverse control, constants identical to main.js
const DECK_STEP = 2.2, DECK_MARGIN = 3.0, DECK_UNDER = 1.2, MAX_MECH_H = 4.8;
const surfaceAt = (x, z, curY) => {
  const h = heightAt(x, z);
  if (curY == null) return h;
  const tn = tunnelAt(x, z);
  if (tn && curY < tn.ceil) return tn.floor;
  const d = deckY(x, z, DECK_MARGIN);
  let s = h;
  if (d != null && d > h && (curY >= d - DECK_STEP || (d - DECK_UNDER) - h < MAX_MECH_H)) s = d;
  if (tn && !tn.open && tn.roof > s) s = tn.roof;
  return s;
};
const terrain = { heightAt, deckY, tunnelAt, deckMargin: DECK_MARGIN, surfaceAt };
const flyEnv = { terrain, _flySurf: meth('_flySurf') };
const flySurf = (x, z) => flyEnv._flySurf(x, z);

sec('Ⅰ 飛行體高度基準面:(x, z) 的純函式');
{
  ok(typeof flySurf(100, 0) === 'number', 'Ⅰ `_flySurf` 抽得出來且回傳數值');
  // ① Pure function: same point twice is bit-identical, independent of call order
  const a1 = flySurf(100, 0);
  flySurf(-500, 900); flySurf(350, 0); flySurf(100, 40);
  ok(flySurf(100, 0) === a1, 'Ⅰ① 同一座標的答案與呼叫順序無關(無內部狀態)');
  // ② Over the bridge: datum is always the deck, MUST NOT fall back to the riverbed
  ok(flySurf(100, 0) === DECK.y, 'Ⅰ② 橋樑正上方的基準 = 橋面(不是橋下河床)');
  ok(flySurf(100, DECK.hw - 0.5) === DECK.y, 'Ⅰ② 橋面邊緣仍是橋面');
  // ③ Off the deck footprint it returns to terrain (datum never spills into an invisible platform)
  ok(flySurf(100, DECK.hw + DECK_MARGIN + 5) === 0, 'Ⅰ③ 橋面足跡外回裸地形(不外溢)');
  // ④ Tunnel section: MUST NOT be sucked onto the bore floor (the ratchet's second pit — helicopter diving into the mountain)
  ok(flySurf(360, 0) === 120, 'Ⅰ④ 山體隧道正上方取山頂地表(不落到洞內路面 40)');
  // ⑤ Exposed gallery roof above terrain counts as roof (roof = standable surface, see audit_layer_block Ⅴ)
  {
    const g = { terrain: { heightAt: () => 10, deckY: () => null, tunnelAt: () => ({ floor: 10, ceil: 18, roof: 19, open: false }), deckMargin: 3 }, _flySurf: meth('_flySurf') };
    ok(g._flySurf(0, 0) === 19, 'Ⅰ⑤ 明隧道:頂板高過地表時取頂板頂面');
    const o = { terrain: { heightAt: () => 10, deckY: () => null, tunnelAt: () => ({ floor: 10, ceil: 18, roof: 19, open: true }), deckMargin: 3 }, _flySurf: meth('_flySurf') };
    ok(o._flySurf(0, 0) === 10, 'Ⅰ⑤ open 段(引道露天路塹)無頂板 → 取地表(A29)');
  }
  // ⑥ Point features (buildings/pylons) deliberately excluded: including them would bounce a
  // helicopter passing a roadside pylon sky-high
  ok(!/blockerTopAt/.test(strip(grabMethod(G, '_flySurf'))),
    'Ⅰ⑥ `_flySurf` MUST NOT 吃 blockerTopAt(點狀物件不是連續結構面)');
}

sec('Ⅱ 路徑無關性:飛過橋一次就再也回不去的棘輪(反向對照組)');
{
  // Helicopter flying along the bridge (shoved off the footprint once by sim._advance side-push, then back) —
  // exactly the reported trigger: "sometimes" = the few airframes that happened to be shoved out.
  const LIFT = 13;                                   // GAME.HELI_ALT × COMBAT_SCALE
  const path = [];
  for (let x = -40; x <= 240; x += 5) {
    // The x in [60, 80] stretch is shoved outside the deck footprint (|z| > hw + margin), then returns to center
    const z = (x >= 60 && x <= 80) ? 18 : 0;
    path.push([x, z]);
  }
  // Old scheme: per-frame ratchet (seed = previous frame's datum)
  const ratchet = [];
  {
    let cur = heightAt(path[0][0]) + LIFT;
    for (const [x, z] of path) {
      const gy = surfaceAt(x, z, cur - LIFT);
      cur = gy + LIFT;
      ratchet.push(gy);
    }
  }
  // New scheme: pure function
  const pure = path.map(([x, z]) => flySurf(x, z));
  const onBridge = (i) => Math.abs(path[i][1]) <= DECK.hw;
  const ratchetSunk = ratchet.some((g, i) => onBridge(i) && path[i][0] > 80 && g < DECK.y);
  ok(ratchetSunk, 'Ⅱ 反向對照:舊制棘輪被側推一次後,回到橋心仍停在河床(病灶復現)');
  ok(pure.every((g, i) => !onBridge(i) || path[i][0] < DECK.x0 || path[i][0] > DECK.x1 || g === DECK.y),
    'Ⅱ 新制:同一條路徑上,橋心的基準面**每一點**都是橋面');
  // "Sinking ever lower" = datum staying below deck over the bridge and never recovering;
  // the pure-function version is decided per point by coordinates alone
  const rev = [...path].reverse().map(([x, z]) => flySurf(x, z));
  ok(rev.every((g, i) => g === pure[pure.length - 1 - i]),
    'Ⅱ 新制:反向飛同一條路徑,逐點高度逐位元相同(無方向性/無記憶)');
  // Flyers MUST NOT sink below the deck (piercing the deck plate = clipping through the model)
  ok(pure.every((g, i) => !onBridge(i) || deckY(path[i][0], path[i][1]) == null || g + LIFT >= DECK.y),
    'Ⅱ 新制:橋上的飛行體恆在橋面之上(不穿過橋面板)');
}

sec('Ⅲ 消費端單一縫:_updateEnts 的飛行分支');
{
  const ue = strip(grabMethod(G, '_updateEnts'));
  ok(count(G, /_flySurf\s*\(/g) === 2, 'Ⅲ `_flySurf` 恰一份定義 + 一個消費端');
  ok(/if \(ent\.flies\) \{\s*\n\s*gy = this\._flySurf\(nx, nz\);/.test(ue),
    'Ⅲ `ent.flies` 走 `_flySurf`(MUST NOT 再吃 surfaceAt 的棘輪)');
  // The fly branch MUST NOT read cur.y (reading it restores the state)
  const flyBranch = /if \(ent\.flies\) \{([\s\S]*?)\} else \{/.exec(ue);
  ok(!!flyBranch && !/cur\.y/.test(flyBranch[1]), 'Ⅲ 飛行分支內 MUST NOT 出現 `cur.y`(無棘輪)');
  // The ground-unit half stays bit-identical to the old scheme (lane profile-field seed + ratchet)
  ok(/const laneY = this\._laneSurfAt\?\.\(nx, nz\);/.test(ue) && /curSeed = laneY \+ 1\.2/.test(ue),
    'Ⅲ 地面兵線單位仍吃 `_laneSurfAt` 剖面場(舊行為不變)');
  ok(/let curSeed = cur\.y - lift;/.test(ue), 'Ⅲ 非飛行體(含英雄)仍走逐幀棘輪');
}

// ---------------- ② Unit collision ----------------
// Server half: excerpt the sim.js solidEnter / solidPush source (module-private, not exported)
// solidPush consumes data.js PUSH_EPS (genuine import) ⇒ inject the same value when evaluating;
// what is verified is still the genuine formula
const solidEnter = new Function(`return ${grabFn(S, 'solidEnter')}`)();
const solidPush = new Function('PUSH_EPS', `return ${grabFn(S, 'solidPush')}`)(PUSH_EPS);

const clientEnv = () => ({
  pos: { x: 0, y: 0, z: 0 },
  vel: { x: 0, y: 0, z: 0 },
  _pushOutCircle: meth('_pushOutCircle', G, { PUSH_EPS }),
  _circleEnter: meth('_circleEnter'),
});

sec('Ⅳ 圓柱幾何:客戶端與伺服器逐案例同值(A30 兩端同判)');
{
  const env = clientEnv();
  let enterMax = 0, pushMax = 0, cases = 0, enterDiff = 0, pushDiff = 0;
  const CY = [0, 0, 3.5, 6, 0, 0, 0, 0];   // solid cylinder shape: [x, z, r, top, hw2, hd2, cs, sn]
  for (let ax = -12; ax <= 12; ax += 1.5) {
    for (let az = -12; az <= 12; az += 3) {
      for (let bx = -12; bx <= 12; bx += 1.5) {
        for (let bz = -12; bz <= 12; bz += 3) {
          const myR = 2.4;
          cases++;
          const a = solidEnter(CY, ax, az, bx, bz, myR);
          const b = env._circleEnter(CY[0], CY[1], CY[2], ax, az, bx, bz, myR);
          if ((a == null) !== (b == null)) enterDiff++;
          else if (a != null) enterMax = Math.max(enterMax, Math.abs(a - b));
          const p = solidPush(CY, bx, bz, myR);
          env.pos.x = bx; env.pos.z = bz; env.vel.x = 0; env.vel.z = 0;
          const moved = env._pushOutCircle(CY[0], CY[1], CY[2], myR);
          if ((p == null) !== !moved) pushDiff++;
          else if (p) pushMax = Math.max(pushMax, Math.hypot(env.pos.x - (bx + p[0]), env.pos.z - (bz + p[1])));
        }
      }
    }
  }
  ok(cases > 5000, `Ⅳ 掃描案例數足夠(${cases})`);
  ok(enterDiff === 0, `Ⅳ 掃掠:兩端「有沒有橫越」逐案例同判(分歧 ${enterDiff})`);
  ok(enterMax < 1e-12, `Ⅳ 掃掠:進入參數 t 逐案例同值(最大差 ${enterMax})`);
  ok(pushDiff === 0, `Ⅳ push-out:兩端「有沒有重疊」逐案例同判(分歧 ${pushDiff})`);
  ok(pushMax < 1e-12, `Ⅳ push-out:推出位移逐案例同值(最大差 ${pushMax})`);
}

sec('Ⅴ 單一縫:圓柱幾何各一份實作、單位與障礙同吃');
{
  const col = strip(grabMethod(G, '_collide'));
  const swp = strip(grabMethod(G, '_sweepBlockers'));
  ok(count(G, /_pushOutCircle\s*\(/g) === 3, 'Ⅴ `_pushOutCircle` 恰一份定義 + 兩個消費端(障礙圓柱 / 單位)');
  ok(count(G, /_circleEnter\s*\(/g) === 3, 'Ⅴ `_circleEnter` 恰一份定義 + 兩個消費端(障礙圓柱 / 單位)');
  ok(count(G, /_unitSolids\s*\(/g) === 2, 'Ⅴ `_unitSolids` 恰一份定義 + 一個消費端(掃掠與 push-out 吃同一份名冊)');
  // ents is only scanned in the roster builder (no second scan of `ents` inside `_collide`)
  ok(!/this\.ents\.values\(\)/.test(col), 'Ⅴ `_collide` MUST NOT 自己再掃一次 `ents`(名冊只有一份)');
  ok(/selfCollider\(/.test(col), 'Ⅴ `_collide` 仍吃 `selfCollider`(兩端同一支量體;audit_bot_vision 同條)');
  // Sweeping MUST include units
  ok(/for \(const u of units\)/.test(swp), 'Ⅴ `_sweepBlockers` MUST 掃單位(不是只掃 terrain.blockers)');
  ok(/_sweepBlockers\(px0, pz0, surfHere, onDeck, myR, myBot, myTop, units\)/.test(col),
    'Ⅴ `_collide` 把名冊傳進掃掠');
  // push-out MUST interleave with obstacles (inside the same pass loop)
  const loop = /for \(let pass = 0; pass < 3; pass\+\+\) \{([\s\S]*?)\n    \}/.exec(col);
  ok(!!loop && /for \(const u of units\)/.test(loop[1]),
    'Ⅴ 單位 push-out MUST 在同一趟 pass 迴圈內交錯(分兩段解 = 最後一段說了算)');
  // Order: units first, world obstacles after ⇒ when there is no room, world geometry wins (see Ⅵ⑤-b)
  ok(!!loop && loop[1].indexOf('for (const u of units)') < loop[1].indexOf('of this.terrain.blockers'),
    'Ⅴ pass 內順序 MUST 是「先單位、後世界障礙」(擠不下時 MUST NOT 把機體留在建物裡)');
  // Vertical band follows the server formula
  ok(/myBot >= top - 0\.1 \|\| myTop <= base/.test(strip(grabMethod(G, '_unitSolids'))),
    'Ⅴ 單位垂直帶 ε 與伺服器 `_solidsNear` 的 span() 同式');
  ok(/yBot < top - 0\.1 && yTop > base/.test(strip(grabMethod(S, '_solidsNear'))),
    'Ⅴ(對照)伺服器 `_solidsNear` 的 span() 未被改動');
}

sec('Ⅵ 行為直測:機體 ⇄ NPC 不穿透、不被推進牆裡');
{
  // Genuine `_collide` source (free identifiers injected from here: BattleClient.COLLIDER / selfCollider)
  const COLLIDER = { soldier: { r: 0.6, h: 1.8 }, tank: { r: 2.6, h: 3.2 } };
  const mkEnv = (ents, blockers, src = G) => {
    const free = {
      BattleClient: { COLLIDER },
      selfCollider: (H, fly) => ({ r: H * 0.317, bot: fly ? -H * 0.2 : 0, top: H * 1.0 }),
      PUSH_EPS,
    };
    return {
      pos: { x: 0, y: 0, z: 0 },
      vel: { x: 0, y: 0, z: 0 },
      selfH: 9,
      youId: 'me',
      ents: new Map(ents.map((e, i) => [i, e])),
      terrain: { blockers, heightAt: () => 0, deckY: () => null, surfaceAt: (x, z) => 0 },
      _flying: () => false,
      _surf: function (x, z, c) { return this.terrain.surfaceAt(x, z, c); },
      _unitSolids: meth('_unitSolids', src, free),
      _pushOutCircle: meth('_pushOutCircle', src, free),
      _circleEnter: meth('_circleEnter', src, free),
      _sweepBlockers: meth('_sweepBlockers', src, free),
      _collide: meth('_collide', src, free),
    };
  };
  const npc = (kind, x, z) => ({ kind, mesh: { visible: true, position: { x, y: 0, z } }, isSelf: false });
  const myR = 9 * 0.317;

  // ① Single-frame high-speed crossing of one soldier (30m knockback): MUST be clamped at the
  // near edge, MUST NOT appear on the far side
  {
    const env = mkEnv([npc('soldier', 0, 0)], []);
    env.pos.x = -15; env.pos.z = 0;   // start point
    env.vel.x = 300;
    env.pos.x = 15;                   // this frame lands directly on the far side
    env._collide(-15, 0);
    ok(env.pos.x < 0, `Ⅵ① 單幀 30m 擊退橫越步兵 MUST 被夾在近側(x=${env.pos.x.toFixed(2)})`);
    ok(env.pos.x <= -(myR + 0.6) + 1e-9, 'Ⅵ① 夾住的位置在量體外緣之外(留 skin)');
  }
  // ② (Reverse) slow approach: endpoint lands in the near half of the volume → push-out slides
  // along the edge, feel unchanged
  {
    const env = mkEnv([npc('soldier', 0, 0)], []);
    env.pos.x = -(myR + 0.6) - 0.5; env.pos.z = 0.9;
    const p0x = env.pos.x, p0z = env.pos.z;
    env.pos.x += 0.4;                 // one small step pressing in
    env._collide(p0x, p0z);
    const d = Math.hypot(env.pos.x, env.pos.z);
    ok(d >= myR + 0.6 - 1e-9, 'Ⅵ② 慢速貼上去被 push-out 推到量體外緣(沿邊滑)');
    ok(env.pos.x > p0x - 0.6, 'Ⅵ② 慢速不被掃掠夾回起點(手感不變)');
  }
  // ③ A step touching nothing: bit-identical (no false trigger)
  {
    const env = mkEnv([npc('soldier', 40, 40)], []);
    env.pos.x = 0; env.pos.z = 0;
    env.pos.x = 3;
    env._collide(0, 0);
    ok(env.pos.x === 3 && env.pos.z === 0, 'Ⅵ③ 遠離所有量體的一步逐位元不動');
  }
  // ④ Flying over: mech base above the unit's top ⇒ no collision (same vertical gate as helicopters over tower tops)
  {
    const env = mkEnv([npc('tank', 0, 0)], []);
    env.pos.y = 20; env.pos.x = -15;
    env.pos.x = 15;
    env._collide(-15, 0);
    ok(env.pos.x === 15, 'Ⅵ④ 高於單位垂直帶 ⇒ 不碰撞(逐位元不動)');
  }
  // ⑤ NPC pinning the mech into a wall (fits): after interleaved convergence MUST be outside
  // both the wall and the NPC
  {
    const wall = { x: 0, z: 16, hw2: 30, hd2: 2, ry: 0, y: -1, h: 12 };   // long wall along X (face at z = 14)
    const env = mkEnv([npc('tank', 0, 4.5)], [wall]);
    env.pos.x = 0; env.pos.z = 8;     // wedged between wall and tank (gap fits one mech)
    env._collide(0, 8);
    const d = Math.hypot(env.pos.x, env.pos.z - 4.5);
    ok(d >= myR + 2.6 - 1e-6, `Ⅵ⑤ 擠得下:收斂後在 NPC 量體外(d=${d.toFixed(3)})`);
    ok(env.pos.z <= 14 - myR + 1e-6, `Ⅵ⑤ 擠得下:收斂後在牆外(z=${env.pos.z.toFixed(3)})`);
  }
  // ⑤-b No fit (gap between wall and NPC narrower than one mech): MUST let **world geometry**
  // win — clipping into an NPC is two models overlapping; clipping into a building is the camera
  // seeing through the wall (and no way back out).
  {
    const wall = { x: 0, z: 10, hw2: 30, hd2: 2, ry: 0, y: -1, h: 12 };   // face at z = 8; 3.5m gap to the tank < one mech
    const env = mkEnv([npc('tank', 0, 4.5)], [wall]);
    env.pos.x = 0; env.pos.z = 7.2;
    env._collide(0, 7.2);
    ok(env.pos.z <= 8 - myR + 1e-6,
      `Ⅵ⑤-b 擠不下時機體停在牆外(z=${env.pos.z.toFixed(3)} ≤ ${(8 - myR).toFixed(3)}),不被推進牆體`);
  }
  // ⑥ Own wingman excluded from the roster (closing at 50m/s on regroup; a false hit would clamp it)
  {
    const env = mkEnv([{ kind: 'robot', hero: true, pid: 'me', heroCol: { r: 3, h: 9 }, mesh: { visible: true, position: { x: 0, y: 0, z: 0 } } }], []);
    env.pos.x = -15;
    env.pos.x = 15;
    env._collide(-15, 0);
    ok(env.pos.x === 15, 'Ⅵ⑥ 自己的僚機不碰撞(逐位元不動)');
  }
  // ⑦ Genuine underpass/station-entrance OBB: high-speed head-on crossing and slow side entry must both stop outside the building.
  {
    const entrance = pedestrianEntranceCollider(
      { x: 0, z: 0, ry: Math.PI / 5, archetype: 'underpass_glass_cube' }, 0,
    );
    const env = mkEnv([], [entrance]);
    const ca = Math.cos(entrance.ry), sa = Math.sin(entrance.ry);
    env.pos.x = -20 * sa; env.pos.z = -20 * ca;
    const x0 = env.pos.x, z0 = env.pos.z;
    env.pos.x = 20 * sa; env.pos.z = 20 * ca;
    env._collide(x0, z0);
    const localZ = (env.pos.x - entrance.x) * sa + (env.pos.z - entrance.z) * ca;
    ok(localZ < 0 && Math.abs(localZ) >= entrance.hd2 + myR - 0.31,
      `Ⅵ⑦ 地下道入口正面高速橫越被夾在近側(localZ=${localZ.toFixed(3)})`);

    env.pos.x = -(entrance.hw2 + myR + 0.2) * ca;
    env.pos.z = (entrance.hw2 + myR + 0.2) * sa;
    const sx = env.pos.x, sz = env.pos.z;
    env.pos.x += 0.4 * ca; env.pos.z -= 0.4 * sa;
    env._collide(sx, sz);
    const localX = (env.pos.x - entrance.x) * ca + (env.pos.z - entrance.z) * -sa;
    ok(Math.abs(localX) >= entrance.hw2 + myR - 1e-6,
      `Ⅵ⑦ 地下道入口側面慢速駛入被推出(localX=${localX.toFixed(3)})`);
  }
}

if (BREAK_RATCHET || BREAK_DECK || BREAK_SWEEP) {
  console.log(`\n(反向驗證模式:${[BREAK_RATCHET && '--break-ratchet', BREAK_DECK && '--break-deck', BREAK_SWEEP && '--break-sweep'].filter(Boolean).join(' ')} —— 上面 MUST 有紅字)`);
}

console.log(`\n${fail ? '❌' : '✅'} 通過 ${pass} 項${fail ? `,失敗 ${fail} 項` : ''}`);
process.exit(fail ? 1 : 0);
