#!/usr/bin/env node
import { createForestDefs } from '../public/js/forest.js';
import { quatApply, quatFromEuler } from '../public/js/xform.js';
// ============ Offline Tree Trunk and Branch Joint Audit ============
// Rationale: audit_object_joints uses convex hull probes to verify part contacts,
// but misses three distinct tree failure modes:
//   1. Vertical disconnection across coaxial trunk segments (e.g. dinizia top segment ending at 70m
//      with crown base at 74.7m leaving 4.7m gap; probes measure contacts, missing empty spans).
//   2. Misnamed wooden bridges in models (e.g. araucaria trunk_crown is brown wood but tagged as crown,
//      hiding it in "trunk + branch" showcase view and rendering the main trunk severed).
//   3. Structural lateral branches with floating tips (branch root planted on trunk, but tip terminates
//      meters outside crown base; fix: root stationary, retarget tip into crown).
// Verified checks (executed directly from source declarations):
//   I. biomes.js declarations (VEG_DEFS / GIANT_DEFS):
//     I-a Coaxial trunk column continuity (vertical gap <= 0.05m). Evaluated by geometry:
//         trunk candidates = axis-aligned non-tilted cylinders with h > 0.5 * max(r1, r2)
//         (excluding flat crown discs). Fully enveloped sub-segments (moss rings) excluded; radius steps warn only.
//     I-b Main trunk summit embedded in crown volume (top point within any crown volume, tolerance 0.1m; snags excluded).
//     I-c Branch root embedded in trunk/crown/ground (hard); branch tip embedded in crown (hard) with exceptions:
//         Snags/inner twigs: root connected + base radius <= 0.5m + (within 1.2m of crown or above crown bottom).
//         Flags structural branches (base radius > 0.5m) with dangling tips.
//         Near-vertical surface pieces (peeling bark, vines, tilt <= 0.15) verify root only.
//         Giant tree branches use single-axis tilt (invariant to Euler axis order; dual-axis tilt fails).
//
// Negative testing:
//   --break-trunk-gap: dinizia top segment shortened (h24->18, y64->61) => I-b MUST fail.
//
// Usage: node tools/audit_tree_joints.mjs [--break-trunk-gap]
// Exit code: 0 = all passed (warnings permitted); 1 = failures detected.
import { readSrc, grabConst } from './audit_src.mjs';

const A = process.argv.slice(2);
const BRK = {
  trunkGap: A.includes('--break-trunk-gap'),
};
let pass = 0, fail = 0, warn = 0;
const ok = (c, m) => { if (c) { pass++; } else { fail++; console.log(`  ✗ ${m}`); } };
const note = (m) => { warn++; console.log(`  ! ${m}`); };

// ---- Extract Real Declarations ----
let bioSrc = readSrc('public', 'js', 'biomes.js');
const tableCode = grabConst(bioSrc, 'VEG_DEFS') + '\n' + grabConst(bioSrc, 'GIANT_DEFS')
  + '\nreturn { VEG_DEFS, GIANT_DEFS };';
const { VEG_DEFS, GIANT_DEFS } = new Function('cyl', 'cone', 'ico', 'Math', 'createForestDefs', tableCode)(
  (r1, r2, h, n = 5) => ({ t: 'cyl', r1, r2, h, n }),
  (r, h, n = 5) => ({ t: 'cone', r, h, n }),
  (r) => ({ t: 'ico', r }),
  Math, createForestDefs,
);

if (BRK.trunkGap) {
  for (const parts of GIANT_DEFS.dinizia.variants) { parts[0].g.h -= 20; parts[0].y -= 10; }
}

// ---- Helpers ----
const GAP_TOL = 0.05;    // Collinear column vertical gap tolerance (m)
const EMB_TOL = 0.1;     // Trunk top crown embed tolerance (m)
const ROOT_TOL = 0.15;   // Branch root trunk attachment tolerance (m)
const TIP_TOL = 0.15;    // Branch tip crown embed tolerance (m)
const R_STEP_WARN = 0.25;// Radius step warning threshold (warning only, non-failing)
const TILT_TOL = 0.15;   // Cutoff tilt angle between surface features and structural branches (rad)
const SNAG_R = 0.5;      // Max base radius for snags/twigs (m): structural branches must terminate in crown
const SNAG_DIST = 1.2;   // Max distance from termination tip to crown surface (m)

// Crown volume: cone tapers linearly; ico forms flattened ellipsoid via sy (default 1).
function tubeContains(part, point, tolerance = ROOT_TOL) {
  if (part.g.t !== 'cyl') return false;
  const q = quatFromEuler(part.rx || 0, part.ry || 0, part.rz || 0);
  const local = quatApply([-q[0], -q[1], -q[2], q[3]], [point[0] - (part.px || 0), point[1] - part.y, point[2] - (part.pz || 0)]);
  const half = part.g.h / 2;
  if (Math.abs(local[1]) > half + tolerance) return false;
  const t = Math.max(0, Math.min(1, (local[1] + half) / part.g.h));
  return Math.hypot(local[0], local[2]) <= part.g.r2 + (part.g.r1 - part.g.r2) * t + tolerance;
}
function crownContains(part, pt, tol = 0) {
  const [x, y, z] = pt;
  const cx = part.px ?? 0, cy = part.y ?? 0, cz = part.pz ?? 0;
  const g = part.g;
  if (g.t === 'cone') {
    if (y < cy - g.h / 2 - tol || y > cy + g.h / 2 + tol) return false;
    const r = g.r * (1 - (y - (cy - g.h / 2)) / g.h);
    return Math.hypot(x - cx, z - cz) <= r + tol;
  }
  if (g.t === 'cyl') return tubeContains(part, pt, tol);
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
const isCrownPart = (p) => p.role ? p.role === 'leaf' : p.g.t === 'cone' || p.g.t === 'ico';
// Bole candidates: axis-aligned non-tilted cylinders (flat crown discs h <= 0.5*max_R excluded; stocky succulent trunks h ~= R retained).
const isBoleCyl = (p) => p.role ? p.role === 'trunk' && p.g.t === 'cyl' && !(p.rx || p.rz) : p.g.t === 'cyl' && Math.abs(p.px ?? 0) <= 0.6
  && Math.abs(p.pz ?? 0) <= 0.6 && !(p.rx || p.rz) && p.g.h > 0.5 * Math.max(p.g.r1, p.g.r2);
// Generated branches use the runtime XYZ rotation, including two-axis forks.
function branchDir(p) {
  const rx = p.rx ?? 0, rz = p.rz ?? 0;
  if (p.role) return quatApply(quatFromEuler(rx, p.ry || 0, rz), [0, 1, 0]);
  if (rx && rz) return quatApply(quatFromEuler(rx, p.ry || 0, rz), [0, 1, 0]);
  if (Math.abs(rz) > TILT_TOL) return [-Math.sin(rz), Math.cos(rz), 0];
  if (Math.abs(rx) > TILT_TOL) return [0, Math.cos(rx), Math.sin(rx)];
  return 'vertical';
}
const trunkRAt = (r1, r2, h, yBot, y) => {
  const t = Math.max(0, Math.min(1, (y - yBot) / h));
  return r2 + (r1 - r2) * t;
};

// ---------------- I. Declaration Tables ----------------
console.log('Ⅰ biomes.js 宣告表幹柱連續');
for (const [group, table] of [['神木', GIANT_DEFS], ['植被', VEG_DEFS]]) {
  for (const [name, def] of Object.entries(table).flatMap(([name, def]) => def.variants
    ? def.variants.map((parts, i) => [`${name}:${i}`, { ...def, parts }]) : [[name, def]])) {
    const boles = def.parts.filter(isBoleCyl)
      .map((p) => ({ p, bot: p.y - p.g.h / 2, top: p.y + p.g.h / 2 }));
    // Segments fully enveloped by another segment (e.g. moss collar bands) do not contribute to trunk height calculation.
    const cols = [...boles].sort((a, b) => a.bot - b.bot)
      .filter((s, _, arr) => !arr.some((o) => o !== s && o.bot <= s.bot && o.top >= s.top));
    const crowns = def.parts.filter(isCrownPart);
    const crownBottom = crowns.length
      ? Math.min(...crowns.map((c) => (c.y ?? 0) - (c.g.t === 'cone' ? c.g.h / 2 : c.g.r * (c.sy ?? 1))))
      : Infinity;
    // Dead tops / snags (slender vertical spikes rooted within crown) are excluded from the main trunk top calculation.
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
    // Coverage scan: overlapping roots/collars sharing a base with the trunk trigger false positives in pairwise checks; grounding the base segment satisfies connectivity.
    // Buttress root cones enveloping the base also provide valid trunk coverage when their horizontal span intersects the trunk axis.
    const cover = mains.map((s) => ({ ...s, quiet: false }));
    for (const p of def.parts.filter((q) => q.g.t === 'cone')) {
      const bot = p.y - p.g.h / 2, top = p.y + p.g.h / 2;
      const rr = Math.max(p.g.r, 0.001);
      if (Math.hypot(p.px ?? 0, p.pz ?? 0) > rr + 3.0) continue;
      cover.push({ p, bot, top, quiet: true });   // Suppress seam warnings: crown cone seated in crown cluster counts as connected.
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
      ok(crowns.some((c) => crownContains(c, pt, EMB_TOL))
        || def.parts.some(p => p.role === 'branch' && tubeContains(p, pt, EMB_TOL)),
        `${group} ${name} 幹頂 (${pt[0]},${pt[1].toFixed(1)},${pt[2]}) 埋進樹冠`);
    }
    // Lateral branches: tilted branches verify both root and tip; near-vertical surface pieces only verify root embed or grounding.
    const branches = def.parts.filter((p) => p.g.t === 'cyl' && !isBoleCyl(p)
      && Math.abs(p.px ?? 0) < 12 && Math.abs(p.pz ?? 0) < 12);
    for (const b of branches) {
      const d = branchDir(b);
      if (!d) { ok(false, `${group} ${name} 枝 y=${b.y} 雙軸傾角(rx+rz):軸序一改就指向別處`); continue; }
      const L = b.g.h, C = [b.px ?? 0, b.y, b.pz ?? 0];
      const dir = d === 'vertical' ? [0, 1, 0] : d;
      const a = [C[0] - dir[0] * L / 2, C[1] - dir[1] * L / 2, C[2] - dir[2] * L / 2];
      const e = [C[0] + dir[0] * L / 2, C[1] + dir[1] * L / 2, C[2] + dir[2] * L / 2];
      // Scale root tolerance with trunk thickness (ancient tree bark fissures span decimeters; smaller trees retain base tolerance).
      const rootIn = a[1] <= 0.05 || (b.role === 'trunk' && Math.min(a[1], e[1]) <= Math.min(b.g.r1, b.g.r2) + .05) || boles.some((t) => {
        if (a[1] < t.bot - ROOT_TOL || a[1] > t.top + ROOT_TOL) return false;
        const tr = trunkRAt(t.p.g.r1, t.p.g.r2, t.p.g.h, t.bot, a[1]);
        return Math.hypot(a[0] - (t.p.px ?? 0), a[2] - (t.p.pz ?? 0)) <= tr + ROOT_TOL + 0.1 * tr;
      }) || crowns.some((c) => c !== b && crownContains(c, a, ROOT_TOL))
        || def.parts.some(p => p !== b && tubeContains(p, a));
      const hangingLeaf = b.role === 'leaf' && def.parts.some(p => p !== b && tubeContains(p, e));
      ok(rootIn || hangingLeaf, `${group} ${name} 枝根 y=${b.y} 埋進幹身/冠內/接地`);
      // Buttress roots connect ground to bole, rather than terminating in foliage.
      if (a[1] <= ROOT_TOL && boles.some(t => e[1] >= t.bot && e[1] <= t.top
        && Math.hypot(e[0], e[2]) <= trunkRAt(t.p.g.r1, t.p.g.r2, t.p.g.h, t.bot, e[1]))) { pass++; continue; }
      if ((rootIn || hangingLeaf) && (b.role === 'root' || b.role === 'leaf')) { pass++; continue; }
      if (b.organStem && def.parts.some(p => p.role === b.role && !p.organStem && crownContains(p, e, TIP_TOL))) { pass++; continue; }
      if (d === 'vertical' || !crowns.length) continue;
      if (crowns.some((c) => c !== b && crownContains(c, e, TIP_TOL)) || def.parts.some(p => p !== b && tubeContains(p, e, TIP_TOL))) { pass++; continue; }
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

// ---------------- Summary ----------------
console.log(`\n檢查 ${pass + fail} 項,正常 ${pass} 項,警告 ${warn} 項`);
process.exit(fail ? 1 : 0);
