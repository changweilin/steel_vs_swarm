// ============ 1v1 lane 3D-scenario audit (offline; finds test stock venues) ============
// Purpose: answer "on which stock venue's **1v1 (L1) lane** can you actually walk some 3D traffic
// scenario" — one stock map per manual-test scenario, eight scenarios:
//   1 Tunnel (mountain): flat road boring into raised terrain — depth comes from the mountain
//   2 Underpass (flat-land dive): flat terrain, roadbed dipping at one end and back up at the other —
//     depth comes from digging
//     (engine generates these since 2026-07-28: `biomes.js underpassPlan` puts flat tunnel ways on a
//     sunken profile)
//   3 Land viaduct (lane on a **pure-land** deck)  4 Gallery (the side whose side fill cannot hide the structure)
//   5 Level crossing (lane meets surface rails at grade)  6 Under-bridge pass (lane threads beneath a bridge)
//   7 Over-tunnel crossing (lane walks over a bore)
//   8 Terrain taller than one turret on one side (altTier() = TARGET_H.tower, the height-bonus trigger;
//     **general road sections only** — decks/tunnels/approaches all excluded: lateral relief measured
//     inside a bore is the "underpass/tunnel depth", not occupiable tactical high ground)
//   9 Water viaduct (lane on the deck, but the bridge spans water)
//
// 3 and 9 are **two scenarios** (2026-08-02 user decision): land below ⇒ piers passable, falling in still
// fights; water below ⇒ the deck is the only road, falling in means in the water. One verdict seam only:
// `spansWater()` (map-data waterway crossing ∪ below-deck terrain sunk under water/marsh), shared by both —
// MUST NOT be guessed from venue names or mix water ratios.
// (Before 2026-08-02, 9 was just a "cross-water bridge" side diagnostic, unlisted ⇒ no stock venue tagged;
// since the migration it ranks with 3.)
//
// One side diagnostic (not a scenario, but needed when picking venues):
//   Missed underpass: map data tags tunnel and terrain is flat, but underpassPlan gives up (footway /
//     no approach room / deeper than SINK_MAX / corridor hits water) ⇒ still a normal road, listed for
//     evaluation
//
// Data sources fully share origin with runtime:
//   - Lanes/bases/bbox: `venues.js venueConfig(v, 1)` + `data.js battleBBox` (teamSize=1 ⇒ L=1)
//   - Road/rail/crossing network: Overpass, same query strings as `biomes.js fetchOsmRoads/fetchOsmFeatures`;
//     Overpass public mirrors almost always refuse cloud IPs ⇒ on total failure fall back to the OSM
//     official API /map (see OSM_API)
//   - Elevation: AWS terrarium tiles (= `terrain.js` primary source), then the same "3×3 smoothing →
//     off-lane AMP boost → tower-site dry-land lift" pipeline, so this tool's heightAt matches in-game
//     terrain shape.
//   - Tunnel cover/underpass planning/gallery verdict: **execute `biomes.js` function sources directly**
//     (tunnelCoverIntervals / tunFloorAt / underpassPlan / tunnelWallProfile; same source-extraction
//     rationale as audit_open_tunnel.mjs — biomes.js three.js rides the CDN importmap, Node cannot import
//     it, and a recopied formula would pass forever).
//
// Network: first run fetches map + terrarium elevation, results land in `tools/.scen_cache/` (pure offline
// re-runs after).
// Usage: node tools/audit_lane_scenarios.mjs [--only=jinlong,london] [--json=out.json]
//      node tools/audit_lane_scenarios.mjs --probe='25.09,121.54,Ziqiang Tunnel;40.78,-73.97,Central Park'  ← for finding new venues
// Exit code: 0 = every one of the eight scenarios has a venue; 1 = some scenario has none (needs a new test venue)
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { VENUES, venueConfig, SCEN_LABEL } from '../public/js/venues.js';
// MAPGEO is only needed by `probePoint` (probe-bbox edge conversion). When venue_field.mjs was extracted
// on 2026-08-03, the import list shrank to "what the main scan path uses" and dropped it ⇒ **probe mode has
// been fully broken since that day** (ReferenceError: MAPGEO is not defined), while the workflow's probe step
// is continue-on-error and the main scan never touches that branch ⇒ not a single red. This file IS the
// venue-finding tool; its breakage symptom is "scenario 2 never finds a second map", not an error message.
import { MAPGEO, WATER, GAME, UNITS, TARGET_H, altTier, battleBBox, sideMFor, solveTowerSites } from '../public/js/data.js';
// The Node-side single seam for heightfield / map data / structure profiles (shared with audit_traverse
// and the clearance check)
import {
  ROOT, CACHE, llToWorld, distToSegs, R_EARTH, d2r, WORLD_S,
  TUN, UND, PASS_W, ROAD_SEG, tunnelCoverIntervals, tunnelWallProfile, densify, underpassPlan,
  strucTunnel, roadWidth, strucHw, elevSampler, buildHeightField, osmFor, LANE_HW,
  segCross, ptSeg, ptPoly, arcOf, tangentAt, tunnelRunOf,
} from './venue_field.mjs';

const ARG = Object.fromEntries(process.argv.slice(2).map((s) => {
  const m = /^--([^=]+)(?:=(.*))?$/.exec(s);
  return m ? [m[1], m[2] ?? '1'] : ['_', s];
}));
const ONLY = (ARG.only || '').split(',').filter(Boolean);

// ---- Scenario verdict thresholds (game meters) ----
const ON_MIN = 24;        // shortest co-directional overlap for "lane runs on the structure"
const ALIGN = 0.6;        // co-direction verdict |cos|
const XING_R = 20;        // crossing-node-to-lane tolerance (≈ 10 real meters)
// Lateral-highland scan range (game meters): height bonuses apply to "the two sides in combat" ⇒
// measured in engagement distance, not point-blank. 300 ≈ the hero heavy-weapon range cap — the farthest
// "standing on that highland can actually hit the lane". Overridable via --side=.
const SIDE_MAX = +(ARG.side || 300);
const SIDE_STEP = 10;
const SIDE_RUN_MIN = 60;  // highland must continuously cover this much lane to count as "highland on one side"

/** Co-directional overlap runs of lane vs way (lane arc-length [s0,s1] array) */
function overlapRuns(laneD, laneCum, wayPts, hw) {
  const runs = [];
  let cur = null;
  for (let i = 1; i < laneD.length; i++) {
    const mid = [(laneD[i][0] + laneD[i - 1][0]) / 2, (laneD[i][1] + laneD[i - 1][1]) / 2];
    const ex = laneD[i][0] - laneD[i - 1][0], ez = laneD[i][1] - laneD[i - 1][1], l = Math.hypot(ex, ez) || 1;
    const t = tangentAt(mid, wayPts);
    const on = ptPoly(mid, wayPts) <= hw + ROAD_SEG && Math.abs((ex / l) * t[0] + (ez / l) * t[1]) >= ALIGN;
    if (on) cur = cur || [laneCum[i - 1], 0];
    if (on) cur[1] = laneCum[i];
    else if (cur) { runs.push(cur); cur = null; }
  }
  if (cur) runs.push(cur);
  return runs.filter(([a, b]) => b - a >= ON_MIN);
}

/**
 * Whether a bridge spans water or land — the **single split seam** for scenario 3 land viaducts /
 * scenario 9 water viaducts (scenario 3 must be pure land since 2026-07-28; the water half promoted to
 * 9 on 2026-08-02, both sharing this function).
 *   1 Intersects a map-data waterway, or 2 below-deck terrain sunk under water/marsh — either means water.
 * The second catches lakes/lagoons/bays never drawn as waterways (the game-side splitWaterPieces also
 * reads elevation and water color). scanVenue (lane verdict) and probePoint (anchor hunting) MUST share
 * this function; two copies inevitably produce "probe says land bridge, scan says water bridge" splits
 * visible only on specific venues.
 */
const WET_Y = WATER.LEVEL + WATER.SWAMP_BAND;
function makeSpansWater(waterWays, heightAt) {
  return (wpts) => {
    for (let i = 1; i < wpts.length; i++) {
      for (const wp of waterWays) {
        for (let j = 1; j < wp.length; j++) {
          if (segCross(wpts[i - 1], wpts[i], wp[j - 1], wp[j])) return '水道';
        }
      }
    }
    for (const p of densify(wpts, ROAD_SEG)) if (heightAt(p[0], p[1]) <= WET_Y) return '水面';
    return null;
  };
}

async function scanVenue(v) {
  const cfg = venueConfig(v, 1);                  // teamSize 1 ⇒ L = 1(1v1)
  const res = { id: v.id, name: v.name, synthetic: cfg.synthetic, hits: {}, notes: [] };
  if (cfg.synthetic) res.notes.push('兵線為合成弧(無 baked 真實道路)');
  const bbox = battleBBox(cfg);
  const sampleElev = await elevSampler(bbox);
  if (!sampleElev) { res.error = '高程磚下載失敗'; return res; }
  const hf = buildHeightField(cfg, bbox, sampleElev);
  const { heightAt } = hf;
  const center = cfg.center;
  const laneW = cfg.lanes[0].map(([lat, lng]) => llToWorld(lat, lng, center));
  const laneD = densify(laneW, ROAD_SEG), laneCum = arcOf(laneD);
  // Lane vertices ARE OSM network nodes (baked from real roads by venueLanes.js) ⇒ "does the lane
  // **run on** this way" is most solidly judged by shared nodes: pure 2D distance would misread "the
  // pedestrian underpass below / the empty bridge above" as the same road.
  const k6 = (lat, lng) => `${lat.toFixed(6)},${lng.toFixed(6)}`;
  const laneKeys = new Set(cfg.lanes[0].map(([lat, lng]) => k6(lat, lng)));
  const sharesNode = (way) => way.geometry.some((p) => laneKeys.has(k6(p.lat, p.lon)));

  const osm = await osmFor(v.id, bbox);
  if (!osm) { res.error = '取不到路網(Overpass 與 OSM API 皆不可達)'; return res; }
  res.osm = { src: osm.src || 'overpass', roads: osm.roads.length, rails: osm.rails.length,
    waters: (osm.waters || []).length, crossings: osm.crossings.length };

  // Arc-length intervals where the lane "stands on 3D structure" (decks / tunnels incl. approaches):
  // scenario 8's flank highlands exclude these stretches — the user wants high-ground standoffs on
  // **ordinary roads**, not height comparisons from a deck or inside a bore.
  const structArcs = [];

  const spansWater = makeSpansWater(
    (osm.waters || []).map((w) => w.geometry.map((p) => llToWorld(p.lat, p.lon, center))), heightAt);

  // ---- 1/3/5/6 structure ways (tunnels/bridges) ----
  for (const way of osm.roads) {
    const isTun = strucTunnel(way.tags), isBrg = !!way.tags.bridge && !way.tags.tunnel;
    if (!isTun && !isBrg) continue;
    const hw = strucHw(way.tags);
    const wpts = way.geometry.map((p) => llToWorld(p.lat, p.lon, center));
    if (wpts.length < 2) continue;
    const runs = overlapRuns(laneD, laneCum, wpts, hw);
    const onLen = runs.reduce((s, [a, b]) => s + (b - a), 0);
    const name = way.tags.name || way.tags.highway;

    const canCarry = LANE_HW.test(way.tags.highway || '') && sharesNode(way);
    if (isBrg) {
      if (onLen >= ON_MIN && canCarry) {           // lane on the deck (drivable bridge + shared node)
        structArcs.push(...runs);
        // 3 land viaduct = above pure land; 9 water viaduct = spanning water. One spansWater split, both peers.
        const wet = spansWater(wpts);
        const key = wet ? 'waterBridge' : 'bridge';
        const cur = res.hits[key];
        if (!cur || onLen > cur.len) res.hits[key] = { name, len: Math.round(onLen), ...(wet ? { wet } : {}) };
      } else {                                     // 6 lane threads beneath the bridge (pure geometric crossing)
        for (let i = 1; i < laneD.length && !res.hits.underBridge; i++) {
          for (let j = 1; j < wpts.length; j++) {
            if (segCross(laneD[i - 1], laneD[i], wpts[j - 1], wpts[j])) { res.hits.underBridge = { name }; break; }
          }
        }
      }
      continue;
    }
    // Tunnel/underpass: first ask "does runtime really bore here" (mountain hides it → tunnel; flat land → try digging an underpass)
    const tr = tunnelRunOf(way, center, heightAt, hf);
    if (!tr || !tr.intervals.length) {
      // Map data says underpass but the mountain cannot hide it and underpassPlan also gives up (footway /
      // no approach room / too deep / water) ⇒ buildRoads treats it as a normal road. Listed for evaluation,
      // never recorded as hits (a hit means "really walkable in game"; what walks here is an ordinary street).
      if (onLen >= ON_MIN && canCarry) {
        const cur = res.flatTunnel;
        if (!cur || onLen > cur.len) res.flatTunnel = { name, len: Math.round(onLen) };
        structArcs.push(...runs);
      }
      continue;
    }
    if (onLen >= ON_MIN && canCarry) structArcs.push(...runs);
    const covIdx = new Set();
    for (const [, , ia, ib] of tr.intervals) for (let i = ia; i <= ib; i++) covIdx.add(i);
    if (onLen >= ON_MIN && canCarry) {
      // 1/2 bore sections: the overlap must truly fall inside cover intervals (otherwise it is just the approach)
      let covLen = 0;
      for (let i = 1; i < laneD.length; i++) {
        const mid = [(laneD[i][0] + laneD[i - 1][0]) / 2, (laneD[i][1] + laneD[i - 1][1]) / 2];
        if (ptPoly(mid, tr.pts) > hw + ROAD_SEG) continue;
        let k = 0, best = Infinity;
        for (let m = 0; m < tr.pts.length; m++) {
          const d = Math.hypot(mid[0] - tr.pts[m][0], mid[1] - tr.pts[m][1]);
          if (d < best) { best = d; k = m; }
        }
        if (covIdx.has(k)) covLen += laneCum[i] - laneCum[i - 1];
      }
      if (covLen >= ON_MIN) {
        // Mountain tunnel = 1, underpass = 2 (depth from mountain vs depth from digging are two scenarios)
        const key = tr.under ? 'underpass' : 'tunnel';
        const cur = res.hits[key];
        if (!cur || covLen > cur.len) res.hits[key] = { name, len: Math.round(covLen) };
        // 4 Gallery: side-fill check of the same tunnel (biomes.js single settlement seam).
        // Underpasses excluded — their roof is unexcavated native ground; buildRoads always zeroes open (see A29).
        const cov = tr.pts.map((_, i) => covIdx.has(i));
        for (const side of [1, -1]) {
          if (tr.under) break;
          const prof = tunnelWallProfile(tr.pts, tr.floors, cov, heightAt, TUN.HW, side);
          const n = prof.filter((g) => g.open).length;
          if (n) {
            const cur2 = res.hits.gallery;
            if (!cur2 || n > cur2.pts) res.hits.gallery = { name, pts: n, side, len: Math.round(n * ROAD_SEG) };
          }
        }
      }
    } else if (!sharesNode(way)) {
      // 7 Over-tunnel crossing: the lane is not on this tunnel (no shared node) and **crosses** its cover
      // section = walking over the bore. Only "crossing" counts: a parallel second bore (e.g. the same
      // mountain's footway bore) sits on the same heightfield level as the lane — not an "upper/lower
      // split" test scenario. Letting that rule in would misread jinlong's footway bore as 7.
      for (let i = 1; i < laneD.length && !res.hits.overTunnel; i++) {
        for (let j = 1; j < tr.pts.length; j++) {
          if (!segCross(laneD[i - 1], laneD[i], tr.pts[j - 1], tr.pts[j])) continue;
          if (covIdx.has(j) || covIdx.has(j - 1)) { res.hits.overTunnel = { name }; break; }
        }
      }
    }
  }

  // ---- Scenario-1 candidate diagnostics: in-bbox "runtime really bores" drivable tunnels + their **depth** ----
  // "Ground height − roadbed height" on the heightfield is both "how much earth sits above" and "how deep
  // the roadbed sinks below grade" — semantically a **depth** (2026-07-28 user correction): an underpass's
  // key dimension is how far the roadbed sinks, not how thick the top is. The user wants scenario 1 as
  // "underpass feel" = short, **shallow** (roadbed surfaces after a dozen meters), flat surroundings; a
  // deep Jinlong-style cover is a "mountain tunnel". Depth takes the cover section's median.
  for (const w of osm.roads) {
    if (!strucTunnel(w.tags) || !LANE_HW.test(w.tags.highway || '') || w.geometry.length < 2) continue;
    const tr = tunnelRunOf(w, center, heightAt, hf);
    if (!tr || !tr.intervals.length) continue;
    if (tr.under) {                       // underpasses go to scenario 2's candidate list (depth from digging, not mountains)
      const covLen2 = tr.intervals.reduce((a, [s0, s1]) => a + (s1 - s0), 0);
      const d2 = Math.round(Math.min(...tr.pts.map((p) => ptPoly(p, laneD))));
      const c2 = { name: w.tags.name || w.tags.highway, len: Math.round(covLen2), depth: Math.round(tr.sink), d: d2 };
      if (!res.underCand || d2 < res.underCand.d) res.underCand = c2;
      continue;
    }
    const th = [];
    for (const [, , ia, ib] of tr.intervals) {
      for (let i = ia; i <= ib; i++) th.push(heightAt(tr.pts[i][0], tr.pts[i][1]) - tr.floors[i]);
    }
    if (!th.length) continue;
    th.sort((a, b) => a - b);
    const covLen = tr.intervals.reduce((a, [s0, s1]) => a + (s1 - s0), 0);
    const d = Math.round(Math.min(...tr.pts.map((p) => ptPoly(p, laneD))));
    const cand = { name: w.tags.name || w.tags.highway, len: Math.round(covLen),
                   depth: Math.round(th[th.length >> 1]), d };
    // Prefer the "shallowest" (the less the roadbed sinks, the more underpass-like); ties go to nearer the lane
    if (!res.tunnelCand || cand.depth < res.tunnelCand.depth
        || (cand.depth === res.tunnelCand.depth && d < res.tunnelCand.d)) res.tunnelCand = cand;
  }

  // ---- 3/9 candidate diagnostics: in-bbox drivable viaducts (listed even where the lane never
  // walks them), land/water recorded separately ----
  // Purpose: when a scenario lacks a venue, this list judges "which venue could step onto a deck by
  // re-baking the lane from a new anchor".
  for (const w of osm.roads) {
    if (!w.tags.bridge || w.tags.tunnel || !LANE_HW.test(w.tags.highway || '') || w.geometry.length < 2) continue;
    const wpts = w.geometry.map((p) => llToWorld(p.lat, p.lon, center));
    const wet = spansWater(wpts);
    let len = 0;
    for (let i = 1; i < wpts.length; i++) len += Math.hypot(wpts[i][0] - wpts[i - 1][0], wpts[i][1] - wpts[i - 1][1]);
    if (len < ON_MIN) continue;
    const d = Math.round(Math.min(...wpts.map((p) => ptPoly(p, laneD))));
    const slot = wet ? 'waterBridgeCand' : 'landBridgeCand';
    if (!res[slot] || d < res[slot].d) {
      res[slot] = { name: w.tags.name || w.tags.highway, len: Math.round(len), d, ...(wet ? { wet } : {}) };
    }
  }

  // ---- 7 candidate diagnostics: does any drivable road cross above a cover-section tunnel in-bbox ----
  // 7 wants the **lane** over the bore — rare by luck; opportunistically report "does this map hold such
  // a crossing at all, and how far from the lane", to judge whether "re-baking the lane from a new
  // anchor/heading" could ever assemble 7 (closer to the lane = better odds).
  {
    const tunRuns = [];
    for (const w of osm.roads) {
      if (!strucTunnel(w.tags) || w.geometry.length < 2) continue;
      const tr = tunnelRunOf(w, center, heightAt, hf);
      if (!tr || !tr.intervals.length) continue;
      const cov = new Set();
      for (const [, , ia, ib] of tr.intervals) for (let i = ia; i <= ib; i++) cov.add(i);
      tunRuns.push({ name: w.tags.name || w.tags.highway, tr, cov });
    }
    for (const t of tunRuns) {
      for (const w of osm.roads) {
        if (w.tags.tunnel || w.tags.bridge || w.geometry.length < 2) continue;
        const rp = w.geometry.map((p) => llToWorld(p.lat, p.lon, center));
        for (let i = 1; i < rp.length; i++) {
          for (let j = 1; j < t.tr.pts.length; j++) {
            if (!segCross(rp[i - 1], rp[i], t.tr.pts[j - 1], t.tr.pts[j])) continue;
            if (!t.cov.has(j) && !t.cov.has(j - 1)) continue;
            const d = ptPoly(rp[i], laneD);
            if (!res.overTunnelCand || d < res.overTunnelCand.d) {
              res.overTunnelCand = { road: w.tags.name || w.tags.highway, tunnel: t.name, d: Math.round(d) };
            }
          }
        }
      }
    }
  }

  // ---- 8 Flank highlands (altTier() = one turret height = height-bonus gate) ----
  // 2026-07-28 user request: **exclude tunnel/underpass/viaduct sections**. The semantics: lateral terrain
  // "higher than the lane" inside an underpass only means the **roadbed sank deep** (that relief IS the
  // underpass depth), not occupiable tactical high ground; comparing from a deck is even more meaningless.
  // Wanted: "ordinary-road lane with terrain above one turret on one side".
  // structArcs = arc-length intervals where the lane stands on 3D structure (incl. approaches).
  {
    const T = altTier();
    const onStruct = (sArc) => structArcs.some(([a, b]) => sArc >= a - ROAD_SEG && sArc <= b + ROAD_SEG);
    const gain = [[], []];
    for (let i = 0; i < laneD.length; i++) {
      const a = laneD[Math.max(0, i - 1)], c = laneD[Math.min(laneD.length - 1, i + 1)];
      let dx = c[0] - a[0], dz = c[1] - a[1];
      const l = Math.hypot(dx, dz) || 1; dx /= l; dz /= l;
      const base = heightAt(laneD[i][0], laneD[i][1]);
      [1, -1].forEach((side, si) => {
        const nx = dz * side, nz = -dx * side;
        let best = -Infinity;
        for (let d = SIDE_STEP; d <= SIDE_MAX; d += SIDE_STEP) {
          best = Math.max(best, heightAt(laneD[i][0] + nx * d, laneD[i][1] + nz * d) - base);
        }
        gain[si].push(best);
      });
    }
    let bestRun = 0, peak = -Infinity, bestSide = 0;
    gain.forEach((g, si) => {
      let s0 = null;
      for (let i = 0; i < g.length; i++) {
        if (onStruct(laneCum[i])) { s0 = null; continue; }   // structure sections skipped whole (incl. approaches)
        peak = Math.max(peak, g[i]);
        if (g[i] >= T) {
          if (s0 === null) s0 = laneCum[i];
          const run = laneCum[i] - s0;
          if (run > bestRun) { bestRun = run; bestSide = si ? -1 : 1; }
        } else s0 = null;
      }
    });
    if (bestRun >= SIDE_RUN_MIN) {
      res.hits.highGround = { len: Math.round(bestRun), peak: Math.round(peak), side: bestSide };
    }
    res.peakSide = Number.isFinite(peak) ? Math.round(peak) : null;
  }

  // ---- 4 Level crossings (map-data railway=level_crossing nodes landing on the lane) ----
  for (const c of osm.crossings) {
    const p = llToWorld(c.lat, c.lng, center);
    const d = ptPoly(p, laneD);
    if (d <= XING_R) {
      const cur = res.hits.crossing;
      if (!cur || d < cur.d) res.hits.crossing = { d: Math.round(d) };
    }
  }
  return res;
}

/**
 * Probe mode (--probe=lat,lng[,name]): no baked lane needed, only asks "within one L1 map around this
 * point, is there a runtime-really-boring drivable tunnel, how long and how thick". Used to find new venues
 * for scenario 1 (underpass feel = short, thin cover).
 * Since 2026-08-02 also reports **drivable viaducts** (land 3 / water 9 split through the same makeSpansWater
 * seam) — the three user-picked scenarios (2 underpass / 3 land viaduct / 9 water viaduct) get their anchors
 * from one probe, no extra "bake the lane then scan" round for bridges (one lane bake is minutes of Overpass
 * round-trips).
 * 4 gallery candidates get checked here too: run `tunnelWallProfile` (same seam as runtime) on both sides of
 * every boring mountain tunnel and report open-point count × ROAD_SEG = gallery length — the verdict is
 * lane-independent (terrain + tunnel axis only), so probing settles it.
 * bbox matches L1 size (`--probe-r=N` widens the sweep N-fold; pin precisely after a hit);
 * every boring tunnel/gallery section reports its **lon/lat midpoint** — L1 bboxes span only ~266 real
 * meters, so anchoring from place-name memory always drifts; midpoint coordinates place the anchor true.
 * heightAt feeds AMP with an "east-west dummy lane through the point" (probes need only rough terrain).
 */
async function probePoint(lat, lng, label) {
  const half = sideMFor(1) / 2 * MAPGEO.REAL_SCALE * MAPGEO.MAP_EXPAND * (+ARG['probe-r'] || 1);
  const dLat = half / R_EARTH * 180 / Math.PI, dLng = half / (R_EARTH * Math.cos(d2r(lat))) * 180 / Math.PI;
  const bbox = { minLat: lat - dLat, maxLat: lat + dLat, minLng: lng - dLng, maxLng: lng + dLng };
  const sampleElev = await elevSampler(bbox);
  if (!sampleElev) return console.log(`${label}:高程磚下載失敗`);
  const A = [lat, lng - dLng * 0.7], B = [lat, lng + dLng * 0.7];
  const cfg = { center: { lat, lng }, bases: { SWARM: A, STEEL: B }, lanes: [[A, B]], venue: { mix: { urban: 0.6 } } };
  const hf = buildHeightField(cfg, bbox, sampleElev);
  const { heightAt } = hf;
  const osm = await osmFor(`probe_${lat.toFixed(4)}_${lng.toFixed(4)}`, bbox);
  if (!osm) return console.log(`${label}:取不到路網`);
  // World coords → lon/lat (inverse of llToWorld; needed to place anchors)
  const w2ll = ([x, z]) => `${(lat - z / (R_EARTH * WORLD_S) * 180 / Math.PI).toFixed(5)},${(lng + x / (R_EARTH * Math.cos(d2r(lat)) * WORLD_S) * 180 / Math.PI).toFixed(5)}`;
  const found = [];
  for (const w of osm.roads) {
    if (!strucTunnel(w.tags) || !LANE_HW.test(w.tags.highway || '') || w.geometry.length < 2) continue;
    const tr = tunnelRunOf(w, cfg.center, heightAt, hf);
    if (!tr || !tr.intervals.length) { found.push({ name: w.tags.name || w.tags.highway, flat: true }); continue; }
    const th = [];
    for (const [, , ia, ib] of tr.intervals) for (let i = ia; i <= ib; i++) th.push(heightAt(tr.pts[i][0], tr.pts[i][1]) - tr.floors[i]);
    th.sort((a, b) => a - b);
    const covList = [];
    for (const [, , ia, ib] of tr.intervals) for (let i = ia; i <= ib; i++) covList.push(i);
    const covMid = tr.pts[covList[covList.length >> 1]];
    // 4 gallery check: same verdict seam as scanVenue (tunnelWallProfile), taking the larger open-point side
    let gal = 0, galSide = 0, galMid = null;
    if (!tr.under) {
      const cov = tr.pts.map((_, i) => covList.includes(i));
      for (const side of [1, -1]) {
        const opens = [];
        tunnelWallProfile(tr.pts, tr.floors, cov, heightAt, TUN.HW, side).forEach((g, i) => { if (g.open) opens.push(i); });
        if (opens.length > gal) { gal = opens.length; galSide = side; galMid = tr.pts[opens[opens.length >> 1]]; }
      }
    }
    found.push({ name: w.tags.name || w.tags.highway, under: tr.under,
      len: Math.round(tr.intervals.reduce((a, [s0, s1]) => a + (s1 - s0), 0)),
      depth: Math.round(th[th.length >> 1]), gal, galSide,
      at: covMid ? w2ll(covMid) : '', galAt: galMid ? w2ll(galMid) : '' });
  }
  // 3/9 drivable viaducts: land/water via makeSpansWater (same seam as scanVenue). Midpoint coordinates
  // reported as anchors; length takes the whole bridge (> ON_MIN listed — a shorter bridge never qualifies
  // as a scenario even stepped on).
  const spansWater = makeSpansWater(
    (osm.waters || []).map((w) => w.geometry.map((p) => llToWorld(p.lat, p.lon, cfg.center))), heightAt);
  const bridges = [];
  for (const w of osm.roads) {
    if (!w.tags.bridge || w.tags.tunnel || !LANE_HW.test(w.tags.highway || '') || w.geometry.length < 2) continue;
    const wpts = w.geometry.map((p) => llToWorld(p.lat, p.lon, cfg.center));
    let len = 0;
    for (let i = 1; i < wpts.length; i++) len += Math.hypot(wpts[i][0] - wpts[i - 1][0], wpts[i][1] - wpts[i - 1][1]);
    if (len < ON_MIN) continue;
    bridges.push({ name: w.tags.name || w.tags.highway, len: Math.round(len),
      wet: spansWater(wpts), at: w2ll(wpts[wpts.length >> 1]) });
  }
  const land = bridges.filter((b) => !b.wet).sort((a, b) => b.len - a.len);
  const wetB = bridges.filter((b) => b.wet).sort((a, b) => b.len - a.len);

  const real = found.filter((f) => !f.flat && !f.under).sort((a, b) => a.depth - b.depth);
  const und = found.filter((f) => f.under);
  const galHits = real.filter((f) => f.gal).sort((a, b) => b.gal - a.gal);
  console.log(`${label} (${lat},${lng}) 車行隧道 ${found.length} 條、山體成洞 ${real.length} 條、地下道 ${und.length} 條、明隧道 ${galHits.length} 條、陸橋 ${land.length} 座、水橋 ${wetB.length} 座`
    + (real.length ? `　最淺山體洞:${real.slice(0, 3).map((f) => `${f.name} 覆蓋${f.len}m/深${f.depth}m @${f.at}`).join('、')}` : '')
    + (galHits.length ? `　明隧道:${galHits.slice(0, 3).map((f) => `${f.name} open ${f.gal}點≈${Math.round(f.gal * ROAD_SEG)}m(side ${f.galSide},覆蓋${f.len}m)@${f.galAt}`).join('、')}` : '')
    + (und.length ? `　地下道:${und.slice(0, 3).map((f) => `${f.name} 覆蓋${f.len}m @${f.at}`).join('、')}` : '')
    + (land.length ? `　陸上高架橋:${land.slice(0, 3).map((b) => `${b.name} ${b.len}m @${b.at}`).join('、')}` : '')
    + (wetB.length ? `　水上高架橋:${wetB.slice(0, 3).map((b) => `${b.name} ${b.len}m/${b.wet} @${b.at}`).join('、')}` : '')
    + (found.length - real.length - und.length ? `　平地不成洞 ${found.length - real.length - und.length} 條` : ''));
}

if (ARG.probe) {
  for (const spec of ARG.probe.split(';')) {
    const [la, ln, ...rest] = spec.split(',');
    await probePoint(+la, +ln, rest.join(',') || spec);
  }
  process.exit(0);
}

// ---- Main flow ----
// Tunnels and underpasses are **two different things**; verdicts and classification always split
// (2026-07-28 user instruction):
//   Tunnel     flat road boring into raised terrain — depth comes from the "mountain".
//   Underpass  flat terrain, roadbed dipping at one end and back up at the other — depth comes from "digging".
//          Since 2026-07-28 the engine generates them: when the straight profile cannot hide the ceiling,
//          `underpassPlan`'s sunken profile takes over (approaches at both ends, flat bottom mid-section),
//          with cover verdicts and downstream components all reusing the tunnel set.
//          Give-up cases (footway / no approach room / deeper than SINK_MAX / corridor hits water) stay
//          ordinary roads, listed in the report as "missed underpasses".
const SCEN = [
  ['tunnel', '① 隧道(山體)'],
  ['underpass', '② 地下道(平地下穿)'],
  ['bridge', '③ 陸上高架橋'],
  ['gallery', '④ 明隧道'],
  ['crossing', '⑤ 平交道'],
  ['underBridge', '⑥ 穿越高架橋底部'],
  ['overTunnel', '⑦ 穿越地下道上方'],
  ['highGround', '⑧ 一側高於一座砲塔'],
  ['waterBridge', '⑨ 水上高架橋'],
];
// Scenarios the engine does not generate yet: reported but excluded from "missing venues" (no map swap
// fixes them; the engine must change).
// 2026-07-28: `underpass` landed with underpassPlan ⇒ this table is empty (structure kept; the next gap
// hangs here the same way).
const KNOWN_GAP = new Map();
{ // Scenario codes MUST match the venues.js SCEN_LABEL set (labels split from verdicts = tagged but never verified)
  const a = SCEN.map(([k]) => k).sort().join(','), b = Object.keys(SCEN_LABEL).sort().join(',');
  if (a !== b) throw new Error(`場景代號與 venues.js SCEN_LABEL 不一致:\n  稽核 ${a}\n  標記 ${b}`);
}

// Whole-run time budget (minutes; 0 = unlimited). Overpass public nodes queue — one venue can wait a
// minute; 22 venues make an hour-long CI job with no progress in between ⇒ past deadline the remaining
// venues mark "unscanned" and finished ones print first. Cache (.scen_cache) persists ⇒ the next run
// resumes.
const MAX_MS = (+(ARG['max-min'] || 0)) * 60000;
const T_START = Date.now();

const list = VENUES.filter((v) => !ONLY.length || ONLY.includes(v.id));
console.log(`1v1(L1)兵線立體場景稽核 —— 場地 ${list.length}、砲塔高 ${TARGET_H.tower}m、`
  + `側向掃描 ${SIDE_MAX} 遊戲公尺(塔射程 ${UNITS.tower.range})\n`);
const results = [];
let skipped = 0;
for (const v of list) {
  if (MAX_MS && Date.now() - T_START > MAX_MS) {
    skipped++;
    console.log(`${(v.id + ' ').padEnd(15, '·')} ⏭ 時間預算用盡,未掃(快取保留,下次接著跑)`);
    continue;
  }
  const t0 = Date.now();
  const r = await scanVenue(v);
  r.secs = ((Date.now() - t0) / 1000).toFixed(0);
  results.push(r);
  const marks = SCEN.map(([k]) => (r.hits[k] ? '●' : '·')).join(' ');
  const detail = SCEN.filter(([k]) => r.hits[k]).map(([k, label]) => {
    const h = r.hits[k];
    return `${label.slice(0, 2)}${h.name ? h.name : ''}${h.len ? ` ${h.len}m` : ''}${k === 'highGround' ? ` +${h.peak}m` : ''}`;
  }).join('、');
  console.log(`${(r.id + ' ').padEnd(15, '·')} ${marks}  側向峰值 +${r.peakSide ?? '?'}m  ${r.secs}s  `
    + `${r.osm ? `[${r.osm.src} 路 ${r.osm.roads}/軌 ${r.osm.rails}/平交 ${r.osm.crossings}] ` : ''}`
    + `${r.error ? `⚠️ ${r.error}` : detail || '(無)'}`
    + `${r.landBridgeCand ? `　③候選陸橋:${r.landBridgeCand.name} ${r.landBridgeCand.len}m 離兵線 ${r.landBridgeCand.d}m` : ''}`
    + `${r.waterBridgeCand ? `　⑨候選水橋:${r.waterBridgeCand.name} ${r.waterBridgeCand.len}m/${r.waterBridgeCand.wet} 離兵線 ${r.waterBridgeCand.d}m` : ''}`
    + `${r.flatTunnel ? `　落空地下道(規劃放棄,仍是平街):${r.flatTunnel.name} ${r.flatTunnel.len}m` : ''}`
    + `${r.underCand ? `　②候選地下道:${r.underCand.name} 覆蓋 ${r.underCand.len}m/沉 ${r.underCand.depth}m 離兵線 ${r.underCand.d}m` : ''}`
    + `${r.tunnelCand ? `　①候選洞:${r.tunnelCand.name} 覆蓋 ${r.tunnelCand.len}m/深 ${r.tunnelCand.depth}m 離兵線 ${r.tunnelCand.d}m` : ''}`
    + `${r.overTunnelCand ? `　⑦候選:${r.overTunnelCand.road}×${r.overTunnelCand.tunnel} 離兵線 ${r.overTunnelCand.d}m` : ''}`);
}

console.log('\n各場景可用的 1v1 預設場地:');
let missing = 0;
const pick = {};
for (const [k, label] of SCEN) {
  const hit = results.filter((r) => r.hits[k]);
  if (KNOWN_GAP.has(k)) {                       // known gaps: list candidates, never count as missing venues
    const cand = results.filter((r) => r.flatTunnel)
      .map((r) => `${r.id}(${r.flatTunnel.name} ${r.flatTunnel.len}m)`);
    console.log(`  ${label}:⚠️ ${KNOWN_GAP.get(k)}`);
    console.log(`      圖資上是地下道的兵線段(引擎支援後即成立):${cand.join('、') || '(無)'}`);
    continue;
  }
  if (!hit.length) {
    missing++;
    console.log(`  ${label}:❌ 沒有任何預設場地 —— 需新增測試場地`);
    // With no venue, print candidates too: distance to lane, whether planning missed — decides lane
    // re-bake vs anchor swap
    if (k === 'underpass') {
      const cand = results.filter((r) => r.underCand).map((r) => `${r.id}(${r.underCand.name} ${r.underCand.len}m 離兵線 ${r.underCand.d}m)`);
      const lost = results.filter((r) => r.flatTunnel).map((r) => `${r.id}(${r.flatTunnel.name})`);
      console.log(`      bbox 內建得出來的地下道:${cand.join('、') || '(無)'}`);
      console.log(`      規劃落空(仍是平街):${lost.join('、') || '(無)'}`);
    }
    if (k === 'bridge' || k === 'waterBridge') {
      const slot = k === 'bridge' ? 'landBridgeCand' : 'waterBridgeCand';
      const cand = results.filter((r) => r[slot]).map((r) => `${r.id}(${r[slot].name} ${r[slot].len}m 離兵線 ${r[slot].d}m)`);
      console.log(`      bbox 內的候選橋:${cand.join('、') || '(無)'}`);
    }
    continue;
  }
  // Top pick = the venue with the most "amount" of that scenario (tunnels/bridges by length, highlands by
  // continuous length, crossings by nearest)
  const score = (r) => {
    const h = r.hits[k];
    return k === 'crossing' ? -h.d : (h.len ?? h.pts ?? 1);
  };
  hit.sort((a, b) => score(b) - score(a));
  pick[k] = hit[0].id;
  console.log(`  ${label}:${hit[0].id}(${hit[0].name})　其他:${hit.slice(1).map((r) => r.id).join('、') || '—'}`);
}
// ---- venues.js scen / relief tags MUST match surveys (tags are player-facing hints, never guesses) ----
// relief (flank peaks) follows the same rule as scen: since 2026-08-02 the venue menu derives its
// "relief" tier from it (venues.js reliefTier); hand-writing or forgetting updates shows players menu
// terrain blurbs that disagree with the map. Compare only on "full scan with map data actually fetched":
// --only= or a dead Overpass leaves missing tags undecidable.
let tagBad = 0;
if (!ONLY.length && !skipped) {
  console.log('\nvenues.js scen / relief 標記複驗:');
  for (const r of results) {
    if (r.error) { console.log(`  ⚠️ ${r.id}:${r.error} —— 無法複驗標記`); continue; }
    const want = SCEN.map(([k]) => k).filter((k) => !KNOWN_GAP.has(k) && r.hits[k]);
    const v = VENUES.find((x) => x.id === r.id);
    const have = v.scen || [];
    const extra = have.filter((k) => !want.includes(k)), miss = want.filter((k) => !have.includes(k));
    const reliefBad = r.peakSide != null && v.relief !== r.peakSide;
    if (!extra.length && !miss.length && !reliefBad) continue;
    tagBad++;
    console.log(`  ❌ ${r.id}:${extra.length ? `多標 ${extra.join('、')}` : ''}`
      + `${extra.length && miss.length ? ' / ' : ''}${miss.length ? `漏標 ${miss.join('、')}` : ''}`
      + `${reliefBad ? `${extra.length || miss.length ? ' / ' : ''}relief ${v.relief ?? '(未標)'} ≠ 實測 ${r.peakSide}` : ''}`
      + `　實測 = [${want.join(', ')}] relief ${r.peakSide}`);
  }
  if (!tagBad) console.log('  ✓ 全數相符');
}
if (ARG.json) writeFileSync(ARG.json, JSON.stringify({ results, pick }, null, 2));
const NEED = SCEN.length - KNOWN_GAP.size;   // known gaps excluded from the denominator (no map swap fixes them)
console.log(`\n總結:${NEED - missing}/${NEED} 種場景有預設場地(另 ${KNOWN_GAP.size} 種為引擎已知缺口)、標記不符 ${tagBad}`
  + `${skipped ? `、未掃 ${skipped} 個場地(時間預算)` : ''}`);
process.exit(missing || tagBad || skipped ? 1 : 0);
