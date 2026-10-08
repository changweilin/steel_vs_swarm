// ============ Default venue lane offline budget ============
// Usage: node tools/bake_venue_lanes.mjs   (ONLY=taipei101,seoul runs only listed venues)
// Pinned fixture bounded diagnosis: OSM_FIXTURE_DIR=test/fixtures/osm ONLY=taipei101 node tools/bake_venue_lanes.mjs
// target component behavior evidence: node tools/bake_venue_lanes.mjs --self-test-target-components
// --out <path> stages a generated module without replacing the runtime table.
// Fixture mode only lists a report by default; FIXTURE_WRITE=1 still hard-checks center and bbox. Moving a venue for real needs extra setup
// FIXTURE_RECAPTURE=1, right after writing recapture the same-named raw fixture with fetch_osm_fixture.mjs --update.
// Output is public/js/venueLanes.js. After changing ANCHORS or MAPGEO size and overlap constants MUST rerun.
// Per venue bake two sets: full-battlefield three-lane parent (key 3) plus reduced-scale single lane m1 (story-campaign only,
// see venues.js venueLaneKey). L1 (parent middle) and L2 (parent left and right) derive from the parent at write time, never baked alone
// (2026-09-25 same map). Turret rules for m1 check both story sides in one pass
// (defender on SWARM / defender on STEEL), because which side defends varies per chapter and gets
// rerolled once more by rollSideSwap. After changing STORY_MAP.DEF_STAGES MUST rerun.
// Overpass real road network to graph to each lane as one edge-disjoint shortest path (fully on real roads)
// then overlapCellM(L) checks overlap at or below MAX_OVERLAP, detour at or below 2.2x, base distance at or above 80 percent of diagonal.
// Bearing selection also prefers turret rules: rule 5 in-tunnel turrets with at least 20 percent range covering outside the portal (towerTunnelAudit) outranks
// rule 4 range-overlap residual (towerLayoutAudit) -- a turret buried in rock can only duel along the tunnel corridor, a functional defect.
import { writeFileSync, readFileSync, existsSync, mkdirSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { MAPGEO, battleBBox, realDistFor, targetDistFor, overlapCellM, laneTacticsXZ, tacticalScore, towerLayoutAudit, towerTunnelAudit, laneSeparationAudit, laneUTurnAudit, laneTurnAccumAudit, laneStructEntryAudit, lanePathBalanceAudit }
  from '../public/js/data.js';
// Existing lanes: with ONLY= partial rebake, venues not rebaked must be written back unchanged (see keep below)
import { VENUE_LANES } from '../public/js/venueLanes.js';
// Table keys live only in venues.js (producer and consumer share it -- copying one string prefix here
// means a key rename will miss one side, with the symptom that baked lanes have no reader and no error message).
import { VENUE_LANE_KEYS, venueLaneModes, VENUES } from '../public/js/venues.js';
import { readSrc, grabBlock } from './audit_src.mjs';
import { mapGeometryAudit, laneOverlapRatioXZ, MAP_ROAD_PROFILE, MAP_RULE_VERSION } from '../public/js/mapRules.js';
import { sideMFor, laneSubsetFor } from '../public/js/data.js';
import { traceRoadEvidence, roadFingerprint } from '../public/js/roadEvidence.js';
// Structural-tunnel qualification gate (the copy that executes biomes.js source text, section 2.1 single seam for offline tool structure profiles).
// 2026-08-04: legacy buildGraph read w.tags.tunnel directly, a second implementation looser than the engine --
// indoor=yes service passages (station underground malls / parking ramps) always flatten to ordinary paths in the engine
// (strucTunnel, 2026-07-29 Shibuya side-wall breach case), yet PREFER_TUNNEL still scored them as routes
// reaching a tunnel, and the bridge-or-tunnel only via portals rule still blocked them as structures.
// Selection-time and run-time tunnel definitions diverged, with the symptom that baked lanes claimed an underpass while the map showed a flat street.
import { buildGraph, dijkstra } from './road_graph.mjs';
import { loadElevationFixture, fixtureElevationSampler, osmFixtureFiles, readOsmCapture } from './osm_fixture.mjs';
import { makeTerrainAssessment, validTerrainAssessment } from '../public/js/roadEvidence.js';
import { xzToLL } from '../public/js/data.js';
import { VENUE_GRID } from '../public/js/venueGrid.js';

// Lane lat/lng to game meters (center-relative; same conversion as audit_map_rules and runtime, so bake-time rule checks match the final audit)
const SC_GAME = 1 / MAPGEO.REAL_SCALE, EARTH_M = 6371000;
const llToGame = (lat, lng, c) => [
  (lng - c.lng) * Math.PI / 180 * EARTH_M * Math.cos(c.lat * Math.PI / 180) * SC_GAME,
  (lat - c.lat) * Math.PI / 180 * EARTH_M * SC_GAME,
];
// Write precision (six decimals about 0.1m): rule hard gates and file output MUST share one rounding (see tryBearing separation gate)
const r6 = (v) => +v.toFixed(6);

const CACHE = new URL('./.osm_cache/', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
if (!existsSync(CACHE)) mkdirSync(CACHE, { recursive: true });

const R = 6371000, d2r = Math.PI / 180;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (...a) => { console.log(...a); };

const ONLY = (process.env.ONLY || '').split(',').filter(Boolean);
const outputArg = process.argv.indexOf('--out');
if (outputArg >= 0 && !process.argv[outputArg + 1]) throw new Error('--out requires a path');
const OUTPUT = outputArg >= 0 ? resolve(process.argv[outputArg + 1]) : null;
const TARGET_COMPONENT_SELF_TEST = process.argv.includes('--self-test-target-components');
const ANCHORS_ALL = {
  taipei101: [[25.0339, 121.5645]],
  shibuya: [[35.6595, 139.7005]],
  manhattan: [[40.7549, -73.9840]],
  paris: [[48.8584, 2.2945]],
  seoul: [[37.4979, 127.0276]],
  // Natural venues: anchors moved to nearby settled road grids (biome mix unchanged, still forest/desert/wetland look)
  yangmingshan: [[25.1180, 121.5300], [25.1370, 121.5450]],   // Tianmu (residential grid at Yangmingshan south foot)
  aokigahara: [[35.4972, 138.7546], [35.4986, 138.6866]],     // Kawaguchiko town
  blackforest: [[48.4670, 8.4115], [48.5480, 8.3700]],        // Freudenstadt / Baiersbronn
  yosemite: [[37.6690, -119.7990], [37.7485, -119.5878]],     // El Portal / Yosemite Village
  giza: [[29.9870, 31.1420], [29.9773, 31.1325]],             // Nazlet El-Semman
  uluru: [[-25.2406, 130.9889]],                              // Yulara resort
  phoenix: [[33.4950, -112.1700]],                            // West Phoenix Maryvale Sonoran desert grid (all L pass audit)
  hehuanshan: [[23.9650, 120.9670], [24.0577, 121.1614]],     // Puli town / Qingjing Farm
  venice: [[45.4850, 12.2350], [45.4408, 12.3155]],           // Mestre (main island has no car lanes)
  iguazu: [[-25.5990, -54.5735]],                             // Puerto Iguazu
  tamsui: [[25.1680, 121.4450], [25.1720, 121.4400]],         // Tamsui urban area
  okavango: [[-19.9833, 23.4167]],                            // Maun
  rio: [[-22.9700, -43.1850], [-22.9519, -43.2105]],
  // Outside Jinlong tunnel SW portal (Jinlong Rd) and NE portal (Jinhu Rd). L1 bases only about 481 real meters apart, tunnel about 195m:
  // anchors MUST hug the tunnel axis about 130m from each portal, else B gets sucked inside the tunnel or detours onto other blocks
  jinlong: [[25.0838, 121.5846], [25.0873, 121.5895]],
  // 2 Pure-land viaduct candidate (not yet finalized, so venues.js excludes it): Park Avenue viaduct around Grand Central,
  // streets underneath throughout. Three survey rounds (clamped bearings / free bearings / PREFER_BRIDGE bias) got lanes only within 4m beside the viaduct,
  // never truly on the deck -- Manhattan grid offers too many equal-length ground alternatives, and the viaduct and ground Park Ave are separate ways.
  parkave: [[40.75005, -73.97940], [40.75500, -73.97530]],
  barcelona: [[41.3925, 2.1620], [41.3850, 2.1700]],          // Barcelona Eixample grid (near Mediterranean)
  // Story final venue (2026-08-04). Nakhimov Square / Ushakov Square -- both squares sit on the downtown
  // peninsula ridge, separated by about 450 real meters of dense blocks, so L1-L3 can each place three mutually untouched real roads.
  crimea: [[44.6172, 33.5243], [44.6137, 33.5218]],           // Sevastopol downtown
  // London east suburb Ilford and Seven Kings: full L1/L2/L3/m1 anchors selected by the official fixture bake.
  // Ordinary urban grid, no PREFER_BRIDGE and no bearing-sector clamp.
  london: [[51.560302, 0.084931]],
  // Berlin Prenzlauer Berg: first full L1/L2/L3/m1 anchor in candidate reports.
  // Ordinary urban grid, no PREFER_BRIDGE and no bearing-sector clamp.
  berlin: [[52.538038, 13.415268]],
  // Underpass (2): Madrid Castilla Avenue area. Terrain fully flat, so depth can only come from digging, exactly the
  // underpassPlan use case; PREFER_TUNNEL lets selection step onto a tunnel way.
  // Anchors switched to Maria de Molina (probe coverage 234m at 40.43784,-3.68745): first-round Joaquin Costa
  // probe reported 165m, but runtime only builds a 29m covered segment (nearly nothing left past scene gate ON_MIN),
  // and lanes passed within 1m of the portal before returning to the surface -- probe length is the full map-data way length, not the hole actually dug in game.
  // Underpass venues always judge by runtime coverage length, MUST NOT use map-data length as data.
  // 2026-08-04 probe (r=3) measured cover-segment midpoints here: Maria de Molina 277m
  // at 40.43785,-3.68759 (old 234m note is the same stretch, measured slightly shorter), Joaquin Costa 212m
  // at 40.44491,-3.68517. Anchors now bracket both ends of the 277m stretch (backed off about 250m each): two bases 481m apart just
  // enclose the whole stretch with about 100m open sky at each end. Old anchors (-3.68925 / -3.68560) covered only half the hole
  // so lanes crossed over the roof, and the measurement was case 7 crossing above an underpass rather than case 2.
  madrid: [[40.43785, -3.69007], [40.43785, -3.68511], [40.44491, -3.68517]],
  // Water viaduct (9): both banks of the Chicago River. Measured North Lower Michigan Avenue water bridge 201m
  // at 41.88884,-87.62436 (crossing map-data water). The river is only tens of meters wide, and every north-south arterial crosses on a movable traffic bridge
  // so bases on opposite banks force lanes onto the deck; this venue is kept as the water-viaduct control.
  chicago: [[41.88770, -87.62436], [41.89000, -87.62436]],
  // Civic Boulevard: on 2026-08-04 switched from 2 underpass candidate to 3 land viaduct.
  // Legacy anchors chased a cluster of map-data tunnels (8 tunnel ways inside the L1 bbox) with PREFER_TUNNEL;
  // but the 2026-07-30 full sweep had already measured that the 60m service tunnel the lane stepped on was dropped by underpassPlan and
  // stayed a flat street, so case 2 never held on this map (recorded in docs/lane_scenarios.md), yet the bias was never withdrawn.
  // The measured consequence: the L1 lane was dragged by PREFER_TUNNEL to 25.0495-25.0526 (280-620m north of the anchors),
  // with 0 scene kinds, while what this map really has -- the Civic Boulevard viaduct -- sat 226m from the lane.
  // New anchors take the overpass cover-segment midpoints from the 2026-08-04 probe (--probe=25.047,121.518 --probe-r=3):
  //   Civic Boulevard viaduct 1526m at 25.04974,121.51228 / 1269m at 25.04979,121.51243
  //   Civic Boulevard viaduct 560m at 25.05018,121.50993 (west stretch)
  // Both anchors line up along the viaduct axis (east-west) with BEARING_SECTORS clamped on the bridge axis, and selection is now led by PREFER_BRIDGE.
  civicblvd: [[25.05018, 121.50993], [25.04974, 121.51228]],
  // Second map for case 2 underpasses (picked by the 2026-08-04 probe): Tokyo Roppongi.
  // The same probe round reported 7 drivable underpasses the engine can really dig here, the densest surveyed area:
  //   Nogizaka tunnel cover 547m at 35.66675,139.72644
  //   Kanjo Route 3 cover 265m at 35.66163,139.72851
  //   Kanjo Route 3 cover 107m at 35.66387,139.72581
  // The three midpoints serve directly as candidate anchors with no bearing clamp -- underpass axes here disagree (Nogizaka east-west,
  // Kanjo Route 3 north-south), and a wrong clamp would exclude the only workable bearing (the parkave precedent).
  // Scale warning: L1 bases are only about 481 real meters apart, while the Nogizaka tunnel cover at 547m is longer than the whole lane
  // so picking it stuffs both main bases into the hole (rule 5 in-tunnel turrets always violate). Only the 265m and 107m stretches have
  // the mid-hole with open sky at both ends shape, and the ranking picks by itself (tunBad only breaks tunLen ties).
  roppongi: [[35.66163, 139.72851], [35.66387, 139.72581], [35.66675, 139.72644]],
  // Open-cut tunnel test ground (picked by the 2026-07-29 wide probe): Taroko Gorge Yanzikou to Zhuilu stretch on Highway 8,
  // three short tunnels almost entirely open-cut (probe open 72m/54m/96m, midpoints 121.5547/121.5537/121.5509),
  // spaced about 400m apart so one L1 lane can thread several. Anchors MUST use the probe-reported on-road coordinates (gorge roads are narrow,
  // naming-based anchors land on cliffs with no road node within 120m); first anchor is the easternmost open-cut midpoint, baking westward.
  taroko: [[24.1712, 121.5547], [24.1712, 121.5560]],
  kyoto: [[35.0100, 135.7100], [35.0116, 135.6800]],          // Ukyo street grid / Arashiyama
  rotterdam: [[51.909, 4.486], [51.913869, 4.4813346], [51.9130457, 4.4842288], [51.9115783, 4.4914119]],
};

// Pinned fixture mode: feed versioned raw road responses through the same graph and selection gates as live Overpass,
// fully offline with no silent network fallback when a fixture piece is missing. Fixture venue.id is the sole join key,
// so file names like berlin.json and london_water.json can stay independent of game venue ids.
const FIXTURE_DIR = process.env.OSM_FIXTURE_DIR || process.env.FIXTURE_DIR || '';
for (const venue of VENUES) if (!ANCHORS_ALL[venue.id]) ANCHORS_ALL[venue.id] = [venue.ll];
const FIXTURE_BY_VENUE = new Map();
if (FIXTURE_DIR) {
  const fixtureRoot = resolve(FIXTURE_DIR);
  if (!existsSync(fixtureRoot)) throw new Error(`OSM fixture directory does not exist: ${fixtureRoot}`);
  for (const file of osmFixtureFiles(fixtureRoot).sort()) {
    const fixture = readOsmCapture(join(fixtureRoot, file)).data;
    const id = fixture.venue?.id || fixture.name;
    if (fixture.team !== 5 || !id) continue;
    if (FIXTURE_BY_VENUE.has(id)) throw new Error(`OSM fixture duplicate venue.id: ${id}`);
    FIXTURE_BY_VENUE.set(id, fixture);
  }
}
const ANCHORS = ONLY.length
  ? Object.fromEntries(Object.entries(ANCHORS_ALL).filter(([k]) => ONLY.includes(k)))
  : FIXTURE_DIR
    ? Object.fromEntries(Object.entries(ANCHORS_ALL).filter(([k]) => FIXTURE_BY_VENUE.has(k)))
    : ANCHORS_ALL;

const DRIVABLE = MAP_ROAD_PROFILE.source.slice(1, -1);
const ENDPOINTS = [
  'https://overpass-api.de/api/interpreter',
  'https://maps.mail.ru/osm/tools/overpass/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
];

async function overpassRoads(id, lat, lng, radius) {
  const f = `${CACHE}/${id}.json`;
  if (existsSync(f)) return JSON.parse(readFileSync(f, 'utf8'));
  const q = `[out:json][timeout:90];way["highway"~"^(${DRIVABLE})$"](around:${Math.round(radius)},${lat},${lng});out geom;`;
  for (let a = 0; a < 6; a++) {
    const url = ENDPOINTS[a % ENDPOINTS.length];
    try {
      // Content-Type must be explicit: Node fetch defaults string bodies to text/plain,
      // and Overpass reads the data= prefix as query syntax, returning 406 Not Acceptable
      // signal: Node fetch has no default timeout, so a half-dead connection would hang the whole bake
      const resp = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: 'data=' + encodeURIComponent(q),
        signal: AbortSignal.timeout(60000),
      });
      if (!resp.ok) { log(`  overpass ${resp.status} @${new URL(url).host}, retry`); await sleep(3000 * (a + 1)); continue; }
      const d = await resp.json();
      const els = d.elements || [];
      writeFileSync(f, JSON.stringify(els));
      return els;
    } catch (e) { log('  overpass err', e.message); await sleep(3000 * (a + 1)); }
  }
  // Fallback: official OSM API map (2026-07-28). Public Overpass mirrors routinely reject cloud IPs (CI runners and
  // dev sandboxes), so without a fallback no new venue can bake. map uses separate infrastructure and returns raw
  // node and way data for the bbox, filtered to DRIVABLE carriageways with the same shape as an Overpass reply (tags plus geometry).
  const els = await osmApiRoads(lat, lng, radius);
  if (els) { writeFileSync(f, JSON.stringify(els)); return els; }
  return null;
}

function fixtureRoads(id) {
  const fixture = FIXTURE_BY_VENUE.get(id);
  if (!fixture) {
    throw new Error(`OSM fixture missing venue.id=${id} team=5 raw road response`);
  }
  const roads = fixture.responses?.roads?.elements;
  if (!Array.isArray(roads) || !roads.length) {
    throw new Error(`OSM fixture ${id} missing raw road response`);
  }
  const usable = roads.filter((way) => way?.type === 'way'
    && new RegExp(`^(${DRIVABLE})$`).test(way.tags?.highway || '')
    && Array.isArray(way.geometry) && way.geometry.length >= 2
    && way.geometry.every((point) => Number.isFinite(point?.lat)
      && Number.isFinite(point?.lon ?? point?.lng)));
  if (!usable.length) throw new Error(`OSM fixture ${id} has no usable raw road geometry to build graph`);
  log(`  fixture ${id}: raw roads=${roads.length} usable=${usable.length}`);
  return usable;
}

async function roadsFor(id, anchor, radius) {
  if (FIXTURE_DIR) return fixtureRoads(id);
  return overpassRoads(`${id}_${anchor.map((v) => v.toFixed(4)).join('_')}_r${Math.round(radius)}`,
    anchor[0], anchor[1], radius);
}

/** Official OSM /map fallback: returns way array identical in shape to Overpass `out geom` (drivable only) */
async function osmApiRoads(lat, lng, radius) {
  const dLat = radius / 111320, dLng = radius / (111320 * Math.cos(lat * d2r));
  const url = `https://api.openstreetmap.org/api/0.6/map?bbox=${(lng - dLng).toFixed(5)},${(lat - dLat).toFixed(5)},`
    + `${(lng + dLng).toFixed(5)},${(lat + dLat).toFixed(5)}`;
  const RE = new RegExp(`^(${DRIVABLE})$`);
  for (let a = 0; a < 3; a++) {
    try {
      const r = await fetch(url, { signal: AbortSignal.timeout(90000) });
      if (!r.ok) { log(`  osm-api ${r.status}, retry`); await sleep(3000 * (a + 1)); continue; }
      const xml = await r.text();
      const nodes = new Map();
      const attr = (s2, k) => { const m = new RegExp(`${k}="([^"]*)"`).exec(s2); return m ? m[1] : null; };
      for (const m of xml.matchAll(/<node\s([^>]*?)(\/>|>[\s\S]*?<\/node>)/g)) {
        const id2 = attr(m[1], 'id'), la = +attr(m[1], 'lat'), lo = +attr(m[1], 'lon');
        if (id2 && Number.isFinite(la)) nodes.set(id2, { lat: la, lon: lo });
      }
      const out = [];
      for (const m of xml.matchAll(/<way\s([^>]*?)>([\s\S]*?)<\/way>/g)) {
        const body = m[2], tags = {};
        for (const t of body.matchAll(/<tag k="([^"]*)" v="([^"]*)"\s*\/>/g)) tags[t[1]] = t[2];
        if (!RE.test(tags.highway || '')) continue;
        const geometry = [];
        for (const n of body.matchAll(/<nd ref="(\d+)"\s*\/>/g)) {
          const p = nodes.get(n[1]);
          if (p) geometry.push({ lat: p.lat, lon: p.lon });
        }
        if (geometry.length >= 2) out.push({ type: 'way', id: Number(attr(m[1], 'id')), tags, geometry });
      }
      log(`  osm-api fallback retrieved ${out.length} carriageways`);
      return out.length ? out : null;
    } catch (e) { log('  osm-api err', e.message); await sleep(3000 * (a + 1)); }
  }
  return null;
}

// ---- Indexed road graph ----
// Edges already used by a previous lane: heavily penalized rather than strictly forbidden.
// A hard ban (edge-disjoint) would force the third lane past the 2.2x detour cap; heavy penalty encourages avoidance,
// leaving the hard threshold to the overlap ratio (the true rule).
const REUSE_PEN = 20;  // Multiplier for used edges (steered second route away from first, favoring O-pair)
/** Dijkstra; used = Set of (u*n+v) used edges; wMul(u,v) flank preference multiplier */

const pathLen = (g, p) => { let s = 0; for (let i = 1; i < p.length; i++) s += Math.hypot(g.X[p[i]] - g.X[p[i - 1]], g.Z[p[i]] - g.Z[p[i - 1]]); return s; };
const banPath = (b, p, n, prog) => {
  const skip = MAPGEO.LANE_SEP_SKIP_FRAC;
  for (let i = 1; i < p.length; i++) {
    const u = p[i - 1], v = p[i], a = prog(u), z = prog(v);
    // Shared base fan-out is legal; penalizing it forces needless detours.
    if ((a < skip && z < skip) || (a > 1 - skip && z > 1 - skip)) continue;
    b.add(u * n + v); b.add(v * n + u);
  }
};

/** Douglas-Peucker; returns preserved indices (endpoints always preserved -> lane ends land exactly on base) */
function simplifyIdx(pts, tol) {
  const keep = new Uint8Array(pts.length);
  keep[0] = keep[pts.length - 1] = 1;
  if (pts.length >= 3) {
    const st = [[0, pts.length - 1]];
    while (st.length) {
      const [i, j] = st.pop();
      if (j <= i + 1) continue;
      const [x1, y1] = pts[i], [x2, y2] = pts[j];
      const dx = x2 - x1, dy = y2 - y1, L2 = dx * dx + dy * dy || 1;
      let bi = -1, bd = tol;
      for (let k = i + 1; k < j; k++) {
        const [x, y] = pts[k];
        const t = Math.max(0, Math.min(1, ((x - x1) * dx + (y - y1) * dy) / L2));
        const d = Math.hypot(x - (x1 + t * dx), y - (y1 + t * dy));
        if (d > bd) { bd = d; bi = k; }
      }
      if (bi < 0) continue;
      keep[bi] = 1; st.push([i, bi], [bi, j]);
    }
  }
  const outIdx = [];
  for (let i = 0; i < pts.length; i++) if (keep[i]) outIdx.push(i);
  return outIdx;
}

// ---- Rule #5 input: tunnel edges on full path -> arc-length intervals on simplified game lane (game meters) ----
// Simplified lane vertices may not keep tunnel endpoints -> project to arc length.
// Adjacent segments <= SPAN_GAP are stitched into one tunnel (dual-bore / segmented ways); matches tools/audit_lane_grade_sep.mjs.
const SPAN_GAP = 36;
function tunSpansOf(g, full, gpts, cc) {
  const cum = [0];
  for (let i = 1; i < gpts.length; i++) cum.push(cum[i - 1] + Math.hypot(gpts[i][0] - gpts[i - 1][0], gpts[i][1] - gpts[i - 1][1]));
  const arcOf = (i) => {
    const [px, py] = llToGame(g.LA[i], g.LN[i], cc);
    let best = Infinity, bs = 0;
    for (let k = 1; k < gpts.length; k++) {
      const [ax, ay] = gpts[k - 1], [bx, by] = gpts[k];
      const ex = bx - ax, ey = by - ay, L2 = ex * ex + ey * ey || 1;
      let t = ((px - ax) * ex + (py - ay) * ey) / L2;
      t = t < 0 ? 0 : t > 1 ? 1 : t;
      const d = Math.hypot(px - (ax + ex * t), py - (ay + ey * t));
      if (d < best) { best = d; bs = cum[k - 1] + t * Math.hypot(ex, ey); }
    }
    return bs;
  };
  const raw = [];
  let cur = null;
  for (let i = 1; i < full.length; i++) {
    if (g.tunE.has(`${full[i - 1]}:${full[i]}`)) {
      const sa = arcOf(full[i - 1]), sb = arcOf(full[i]);
      const lo = Math.min(sa, sb), hi = Math.max(sa, sb);
      if (!cur) cur = [lo, hi];
      else { cur[0] = Math.min(cur[0], lo); cur[1] = Math.max(cur[1], hi); }
    } else if (cur) { raw.push(cur); cur = null; }
  }
  if (cur) raw.push(cur);
  const out = [];
  for (const s of raw.sort((p, q) => p[0] - q[0])) {
    const last = out[out.length - 1];
    if (last && s[0] - last[1] <= SPAN_GAP) last[1] = Math.max(last[1], s[1]);
    else out.push([...s]);
  }
  return out;
}

function overlapXZ(a, b, cell) { return laneOverlapRatioXZ(a, b, cell); }

// Lateral offset steps: same set as mapSelect OFFSET_FRACS (near -> far)
const OFFSET_FRACS = [MAPGEO.LANE_OFFSET_FRAC, 0.45, 0.62, 0.80];  // 0.80 shifts flanks to further streets, aiding O-shape separation

// Bearing sectors for specific venues (degrees, [start, end] clockwise spanning 0; per-anchor list):
// Lane axis must align with specific landmark for meaningful testing (e.g. jinlong: two anchors oppose along tunnel axis,
// threading Jinlong tunnel; unconstrained search would pick higher-scoring street grids and bypass the tunnel). Unlisted = omnidirectional.
// These venues test lanes walking onto viaducts -> selection compares bridge length first, then default ranking.
// Ordinary venues unaffected.
// 2026-08-04: civicblvd switched from PREFER_TUNNEL to here (wants its elevated expressway, not underground passages).
const PREFER_BRIDGE = new Set(['parkave', 'chicago', 'civicblvd']);
// Likewise: venues where lanes should enter underpasses compare tunnel way length first.
// Measured on strucTunnel-recognized tunnel ways; indoor passages do not count (engine flattens them).
// Note: map tunnel != runtime diggable; underpassPlan may abort due to portal space, depth, or water.
const PREFER_TUNNEL = new Set(['taroko', 'madrid', 'roppongi']);
// Venue -> OSM way name regex: tunnel preference matches target tunnels only.
// Unlisted match all; tunE safety gate input unaffected.
const PREFER_TUNNEL_WAY = {};
const BEARING_SECTORS = {
  // Retained directional sectors for structural venues; standard urban venues use omnidirectional search.
  // madrid: both anchors clamp eastward (Joaquin Costa / Maria de Molina are E-W, target underpass is east).
  // Without clamp, L2 would head north along Castellana, placing rear turret 273m into a service tunnel -> Rule #5 violation.
  madrid: [[[60, 120]], [[240, 300]], [[60, 120], [240, 300]]],
  chicago: [[[330, 30]], [[150, 210]]],    // S bank -> N / N bank -> S (Chicago River main stem is E-W)
  jinlong: [[[30, 80]], [[210, 260]]],   // SW anchor -> NE; NE anchor -> SW (tunnel axis ~56 deg)
  // taroko: both anchors clamp west towards the short open-cut tunnel cluster.
  taroko: [[[235, 300]], [[235, 300]]],
  // parkave: unconstrained; PREFER_BRIDGE selects based on bridge length.
  // civicblvd: clamped along Civic Blvd viaduct axis (E-W): W anchor -> E / E anchor -> W.
  civicblvd: [[[60, 120]], [[240, 300]]],
  // roppongi: intentionally unconstrained; candidate underpass axes vary.
};
const inSector = (br, [a, b]) => ((br - a + 360) % 360) <= ((b - a + 360) % 360);
/** Lexicographic comparison (anchor selection): first differing field decides; identical = preserve earlier entry */
const lexGT = (a, b) => { for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return a[i] > b[i]; return false; };

// Fixed fixture dense road networks may bottleneck single target endpoints.
// Full-battlefield L3 candidate endpoints are verified through formal gates.
const FIXTURE_TARGET_LIMIT = Number.isFinite(+process.env.FIXTURE_TARGET_LIMIT)
  ? Math.max(1, Math.floor(+process.env.FIXTURE_TARGET_LIMIT)) : 32;
function rankTargetRows(rows, sourceComponent, component) {
  return rows.sort((a, b) => {
    const aLocal = component[a.i] === sourceComponent ? 0 : 1;
    const bLocal = component[b.i] === sourceComponent ? 0 : 1;
    return aLocal - bLocal || Number(!!b.junction) - Number(!!a.junction) || a.off - b.off || a.i - b.i;
  });
}
function targetCandidates(g, aIdx, bearing, L, mapA) {
  if (!FIXTURE_DIR || L !== 3 || mapA) return [-1];
  const realD = realDistFor(L, mapA);
  const ax = g.X[aIdx], az = g.Z[aIdx];
  const bx0 = ax + Math.sin(bearing * d2r) * realD;
  const bz0 = az + Math.cos(bearing * d2r) * realD;
  const minAB = realD * MAPGEO.MIN_DIST_FRAC / MAPGEO.BASE_DIST_FRAC;
  const rows = [];
  for (let i = 0; i < g.n; i++) {
    const ab = Math.hypot(g.X[i] - ax, g.Z[i] - az);
    if (ab < minAB || ab > realD * 1.15) continue;
    rows.push({ i, off: Math.hypot(g.X[i] - bx0, g.Z[i] - bz0), junction: g.junction[i] });
  }
  // Prioritize source component stably, then apply candidate cap.
  rankTargetRows(rows, g.component[aIdx], g.component);
  return rows.slice(0, FIXTURE_TARGET_LIMIT).map((row) => row.i);
}

function selfTestTargetComponentRanking() {
  const component = Int32Array.from([7, 3, 7, 3]);
  const rows = [
    { i: 1, off: 0.01 },  // Legacy ordering picked: closest geometrically, but disconnected from source
    { i: 2, off: 0.20 },  // Component-aware ordering must pick: slightly further but reachable
    { i: 3, off: 0.30 },
  ];
  const legacy = rows.slice().sort((a, b) => a.off - b.off || a.i - b.i).slice(0, 1);
  const fixed = rankTargetRows(rows.slice(), component[0], component).slice(0, 1);
  const legacyReachable = component[legacy[0].i] === component[0];
  const fixedReachable = component[fixed[0].i] === component[0];
  if (legacyReachable) throw new Error('target component self-test legacy ordering failed to produce disconnected red case');
  if (!fixedReachable) throw new Error('target component self-test component-aware ordering failed to prioritize reachable target');
  log('target component self-test legacy ordering: RED (disconnected target selected)');
  log('target component self-test component-aware ordering: GREEN (same-component target selected)');
  const junctionRows = [{ i: 1, off: 0, junction: true }, { i: 0, off: 0.01 }, { i: 2, off: 1, junction: true }];
  if (rankTargetRows(junctionRows, component[0], component)[0].i !== 2) {
    throw new Error('Reachable junction must precede road-interior targets and disconnected junctions');
  }
  log('target junction self-test: GREEN (reachable junction selected before the candidate cap)');
}

function fixtureAnchorCandidates(fixture) {
  if (!FIXTURE_DIR || !fixture?.center) return [];
  const { lat: clat, lng: clng } = fixture.center;
  const g = buildGraph(fixtureRoads(fixture.venue?.id || fixture.name), [clat, clng]);
  const cells = new Map();
  for (let i = 0; i < g.n; i++) {
    const lat = g.LA[i], lng = g.LN[i], x = g.X[i], z = g.Z[i];
    // Three road lanes need junctions at both ends to avoid shared corridors.
    const junction = g.junction[i];
    const key = `${Math.floor(x / 100)},${Math.floor(z / 100)}`;
    const d = Math.hypot(x, z);
    const prev = cells.get(key);
    if (!prev || junction > prev.junction || (junction === prev.junction
      && (d < prev.d || (d === prev.d && `${lat},${lng}` < `${prev.lat},${prev.lng}`)))) {
      cells.set(key, { lat, lng, d, junction });
    }
  }
  const limit = Number.isFinite(+process.env.FIXTURE_ANCHOR_LIMIT)
    ? Math.max(1, Math.floor(+process.env.FIXTURE_ANCHOR_LIMIT)) : 24;
  return [...cells.values()].sort((a, b) => b.junction - a.junction || a.d - b.d || a.lat - b.lat || a.lng - b.lng)
    .slice(0, limit).map((point) => [point.lat, point.lng]);
}

function bakedCenterOf(g, route) {
  if (!route) return null;
  const a = [r6(g.LA[route.aIdx]), r6(g.LN[route.aIdx])];
  const b = [r6(g.LA[route.bIdx]), r6(g.LN[route.bIdx])];
  return { lat: (a[0] + b[0]) / 2, lng: (a[1] + b[1]) / 2 };
}

function centerErrorM(fixture, g, route) {
  const center = bakedCenterOf(g, route);
  if (!center || !fixture?.center) return Infinity;
  const dz = (center.lat - fixture.center.lat) * d2r * R;
  const dx = (center.lng - fixture.center.lng) * d2r * R * Math.cos(fixture.center.lat * d2r);
  return Math.hypot(dx, dz);
}

function fixtureContractDrift(fixture, g, route) {
  const center = bakedCenterOf(g, route);
  if (!center || !fixture?.center || !fixture?.bbox) return { centerM: Infinity, bboxDeg: Infinity };
  center.rot = fixture.center.rot;
  const sizeM = targetDistFor(3) / (MAPGEO.BASE_DIST_FRAC * Math.SQRT2);
  const a = [r6(g.LA[route.aIdx]), r6(g.LN[route.aIdx])];
  const b = [r6(g.LA[route.bIdx]), r6(g.LN[route.bIdx])];
  const lanes = route.lanes.map((lane) => lane.idx.map((i) => [r6(g.LA[i]), r6(g.LN[i])]));
  const bbox = battleBBox({ center, sizeM, bases: { SWARM: a, STEEL: b }, lanes });
  const bboxDeg = Math.max(...['minLat', 'minLng', 'maxLat', 'maxLng']
    .map((key) => Math.abs(bbox[key] - fixture.bbox[key])));
  return { centerM: centerErrorM(fixture, g, route), bboxDeg };
}

function tryBearing(g, aIdx, bearing, L, offFrac, mapA = false, targetIdx = -1, laneOrder = null) {
  const realD = realDistFor(L, mapA);
  const { X, Z, n } = g;
  const ax = X[aIdx], az = Z[aIdx];
  const bx0 = ax + Math.sin(bearing * d2r) * realD, bz0 = az + Math.cos(bearing * d2r) * realD;
  const minAB = realD * MAPGEO.MIN_DIST_FRAC / MAPGEO.BASE_DIST_FRAC;   // ⇒ distM ≥ diagM×0.80
  let bIdx = targetIdx, best = Infinity;
  if (bIdx < 0) for (let i = 0; i < n; i++) {
    const ab = Math.hypot(X[i] - ax, Z[i] - az);
    if (ab < minAB || ab > realD * 1.15) continue;
    const off = Math.hypot(X[i] - bx0, Z[i] - bz0);
    if (off < best) { best = off; bIdx = i; }
  }
  if (bIdx < 0) return { fail: 'noB' };

  const straight = Math.hypot(X[bIdx] - ax, Z[bIdx] - az);
  const vx = (X[bIdx] - ax) / straight, vz = (Z[bIdx] - az) / straight;
  const px = -vz, pz = vx;                                    // Perpendicular unit vector
  const lat = (i) => (X[i] - ax) * px + (Z[i] - az) * pz;     // Lateral offset (+ = left)
  const prog = (i) => ((X[i] - ax) * vx + (Z[i] - az) * vz) / straight;   // Progress along A->B (0..1)
  // Flanks: actively hugs target lateral offset arc rather than just penalizing the wrong side --
  // shaped like synthLane spine (sin arc: zero at endpoints, widest at mid-stretch with LANE_OFFSET_FRAC * D).
  // The legacy logic that only penalized the wrong side let routes hug the centerline, inflating overlap.
  const STEER_W = 2.4;
  const sideW = (s, offFrac) => (u, v) => {
    const m = (lat(u) + lat(v)) / 2;
    const t = Math.max(0, Math.min(1, (prog(u) + prog(v)) / 2));
    const want = s * offFrac * straight * Math.sin(Math.PI * t);
    return 1 + STEER_W * Math.abs(m - want) / straight;
  };

  const used = new Set();
  let why = null;
  const take = (wMul) => {
    const p = dijkstra(g, aIdx, bIdx, used, wMul);
    if (!p) { why = 'noPath'; return null; }
    if (pathLen(g, p) / straight > 2.2) { why = 'detour'; return null; }   // Detour gate (matches mapSelect)
    // Backtrack gate (matches mapSelect / MAPGEO.MAX_BACKTRACK): prog normalized to A->B progress;
    // accumulating backward progress checks return ratio toward main base; excess is rejected.
    let back = 0, pr = prog(p[0]);
    for (let k = 1; k < p.length; k++) { const pg = prog(p[k]); if (pg < pr) back += pr - pg; pr = pg; }
    if (back > MAPGEO.MAX_BACKTRACK) { why = 'backtrack'; return null; }
    // Bridges/tunnels must be entered/exited via portals (endpoints portalN), never from the side.
    // struc aligns with node path p: segment k connects p[k-1]->p[k]; portal = whether p[i] is structural endpoint.
    const struc = new Array(p.length);
    struc[0] = false;
    for (let k = 1; k < p.length; k++) struc[k] = g.tunE.has(`${p[k - 1]}:${p[k]}`) || g.brgE.has(`${p[k - 1]}:${p[k]}`);
    if (!laneStructEntryAudit(struc, p.map((nd) => g.portalN.has(nd))).ok) { why = 'sideEntry'; return null; }
    const all = p.map((i) => [X[i], Z[i]]);
    const keep = simplifyIdx(all, 3);
    const idx = keep.map((k) => p[k]);                        // All vertices remain OSM road nodes after simplification
    const xz = keep.map((k) => all[k]);
    // Ban path marks used edges after passing gates (subsequent lanes penalized by REUSE_PEN)
    banPath(used, p, n, prog);
    let s = 0;
    for (const q of idx) s += lat(q);
    return { xz, idx, full: p, lat: s / idx.length };   // full = unsimplified node path (used for Rule #5 tunnel edges)
  };

  const lanes = [];
  const order = laneOrder || (L === 1 ? [0] : L === 2 ? [1, -1] : [0, 1, -1]);
  for (const side of order) {
    const lane = take(side === 0 ? null : sideW(side, offFrac));
    if (!lane) return { fail: why };
    lanes.push(lane);
  }
  lanes.sort((p, q) => q.lat - p.lat);                        // [top, middle, bottom]

  const cell = overlapCellM(L, mapA);
  let mo = 0;
  for (let i = 0; i < lanes.length; i++)
    for (let j = i + 1; j < lanes.length; j++) mo = Math.max(mo, overlapXZ(lanes[i].xz, lanes[j].xz, cell));

  const s = 1 / MAPGEO.REAL_SCALE;
  // Hard gate: lanes must not touch or cross (fully forbidden including grade separation).
  // MUST evaluate geometry *after* rounding: 6 decimal places lat/lng -> llToGame (origin = rounded bases[0]).
  const wr6 = (i) => [r6(g.LA[i]), r6(g.LN[i])];
  const oW = wr6(aIdx);
  const lanesWritten = lanes.map((l) => l.idx.map((i) => {
    const [la, ln] = wr6(i);
    return llToGame(la, ln, { lat: oW[0], lng: oW[1] });
  }));
  let sinu = 0, tpk = 0;
  for (const l of lanes) { const t = laneTacticsXZ(l.xz.map(([x, z]) => [x * s, z * s])); sinu += t.sinuosity; tpk += t.turnsPerKm; }
  sinu /= L; tpk /= L;
  // Tower layout audit (Rule #4): prefers compliant tower layouts.
  const A = [g.LA[aIdx], g.LN[aIdx]], B = [g.LA[bIdx], g.LN[bIdx]];
  const cc = { lat: (A[0] + B[0]) / 2, lng: (A[1] + B[1]) / 2 };
  const written = lanes.map(l => l.idx.map(wr6));
  const writtenA = wr6(aIdx), writtenB = wr6(bIdx);
  const frame = { center: { lat: (writtenA[0] + writtenB[0]) / 2, lng: (writtenA[1] + writtenB[1]) / 2, rot: 0 },
    bases: { SWARM: writtenA, STEEL: writtenB }, lanes: written, laneCount: L,
    laneIds: mapA ? [0] : laneSubsetFor(L), ...(mapA ? {} : { motherLanes: written }),
    defSide: mapA || null, sizeM: sideMFor(mapA ? 1 : 3, mapA) };
  frame.center.rot = g.rotation || 0;
  const common = mapGeometryAudit(frame, 5);
  if (!common.ok) return { fail: common.code };
  if (!mapA && FIXTURE_DIR) {
    if (!g.elevationAt) return { fail: 'missingElevation' };
    frame.roadTerrain = makeTerrainAssessment(frame, (x, z) => g.elevationAt(...xzToLL(x, z, frame.center)));
    if (!validTerrainAssessment(frame)) return { fail: 'terrain' };
  }
  mo = common.metrics.maxOverlap;
  const lanesGame = lanes.map((l) => l.idx.map((i) => llToGame(g.LA[i], g.LN[i], cc)));
  // Tower portal rule (Rule #5): when threading tunnels, turrets buried inside tunnel MUST have >= TOWER_TUNNEL_OUT_F range covering outside.
  // Tunnel segment takes full tunnel way length (conservative bound).
  const spans = lanes.map((l, li) => tunSpansOf(g, l.full, lanesGame[li], cc));
  // Validate rules across venueLaneModes: full battlefield is single mode.
  let resid = 0, tunBad = 0;
  for (const m of venueLaneModes(mapA)) {
    const ta = towerLayoutAudit(lanesGame, m);
    resid += ta.residual + (ta.stackBad ? 1000 : 0);   // Stacked towers heavily penalized
    tunBad += towerTunnelAudit(lanesGame, spans, m).bad.length;
  }
  // Bridge length in game meters: PREFER_BRIDGE venues use this as primary preference.
  let brgLen = 0, tunLen = 0;
  for (const l of lanes) {
    for (let i = 1; i < l.full.length; i++) {
      const u = l.full[i - 1], v = l.full[i];
      const seg = Math.hypot(g.X[u] - g.X[v], g.Z[u] - g.Z[v]) * s;
      if (g.brgE?.has(`${u}:${v}`)) brgLen += seg;
      if ((g.tunPrefE ?? g.tunE)?.has(`${u}:${v}`)) tunLen += seg;
    }
  }
  return {
    bearing, aIdx, bIdx, lanes, brgLen, tunLen,
    maxOverlap: mo, sinuosity: sinu, turnsPerKm: tpk,
    resid,      // Rule #4 residual
    tunBad,     // Rule #5 violating turrets (0 = compliant)
    score: tacticalScore(sinu, tpk, mo),
  };
}

if (TARGET_COMPONENT_SELF_TEST) {
  selfTestTargetComponentRanking();
  const reserved = new Set();
  const progress = [0, MAPGEO.LANE_SEP_SKIP_FRAC / 2, 1 - MAPGEO.LANE_SEP_SKIP_FRAC / 2, 1];
  banPath(reserved, [0, 1, 2, 3], 4, (i) => progress[i]);
  if (reserved.size !== 2 || !reserved.has(1 * 4 + 2) || !reserved.has(2 * 4 + 1)) {
    throw new Error('Lane reuse must reserve the middle in both directions and leave base fan-out available');
  }
  log('path fan-out self-test: GREEN (shared base approaches remain available)');
  process.exit(0);
}

// ---- Main loop ----
const out = {}, report = [];
const maxRealD = realDistFor(3);
// Table keys (order matches write order; single seam in venues.js): full battlefield 1~3 lanes + reduced-scale single lane.
const KEYS = VENUE_LANE_KEYS.map((k) => k.key);
for (const [id, anchors] of Object.entries(ANCHORS)) {
  let picked = null;
  const fixture = FIXTURE_BY_VENUE.get(id);
  const pinnedL3 = VENUE_LANES[id]?.[3];
  const pinnedAnchor = pinnedL3?.bases?.[0];
  const fixtureAnchors = fixture?.center
    ? [...anchors, [fixture.center.lat, fixture.center.lng], ...(pinnedAnchor ? [pinnedAnchor] : []),
      ...fixtureAnchorCandidates(fixture)]
    : anchors;
  for (const anchor of fixtureAnchors) {
    log(`${id} @ [${anchor}] …`);
    // Radius leaves room for flank bulging (B is at 1.15x realD; detour cap 2.2x)
    const RAD = maxRealD * 2.4;
    const ways = await roadsFor(id, anchor, RAD);
    if (!ways || ways.length < 20) { log(`  ways=${ways ? ways.length : 'ERR'} → skip`); continue; }
    const g = buildGraph(ways, anchor, PREFER_TUNNEL_WAY[id]);
    g.rotation = (VENUE_GRID[id] || 0) * Math.PI / 180;
    if (fixture) {
      try {
        const at = fixtureElevationSampler(loadElevationFixture(fixture.name, join(resolve(FIXTURE_DIR), 'elevation')));
        g.elevationAt = (lat, lng) => lat < fixture.bbox.minLat || lat > fixture.bbox.maxLat
          || lng < fixture.bbox.minLng || lng > fixture.bbox.maxLng ? null : at(lat, lng);
      } catch { /* Full-road admission remains pending without the captured relief. */ }
    }
    log(`  ways=${ways.length} nodes=${g.n}`);
    // Anchor -> nearest road node (within 120m)
    let aIdx = -1, ad = 120;
    for (let i = 0; i < g.n; i++) { const d = Math.hypot(g.X[i], g.Z[i]); if (d < ad) { ad = d; aIdx = i; } }
    if (aIdx < 0) { log('  No road node within 120m of anchor -> skip'); continue; }

    const byL = {};
    // Full battlefield bakes 3-lane parent (L3); L1/L2 derive from parent at write time. Reduced-scale is 1 lane.
    // Venues unable to bake parent do not write L1/L2.
    for (const { key, L, mapA } of VENUE_LANE_KEYS.filter(({ mapA: m, L: l }) => m || l === 3)) {
      let best = null;
      const why = {};
      let bestOv = 9;
      const seenTargets = new Set();
      // Bearing every 5 deg x 3 lateral offset targets: exhaustive offline search
      const sectors = BEARING_SECTORS[id]?.[anchors.indexOf(anchor)];
      for (let i = 0; i < 72; i++) {
        if (sectors && !sectors.some((s) => inSector(i * 5, s))) continue;
        for (const off of OFFSET_FRACS) {
          for (const targetIdx of targetCandidates(g, aIdx, i * 5, L, mapA)) {
            // With a fixed target, routing depends on its chord and offset, not the search bearing.
            if (targetIdx >= 0) {
              const targetKey = `${targetIdx}:${off}`;
              if (seenTargets.has(targetKey)) continue;
              seenTargets.add(targetKey);
            }
            let r = tryBearing(g, aIdx, i * 5, L, off, mapA, targetIdx);
            // Greedy middle-first routing can consume the only viable flank corridor.
            // Retry reservation order; every candidate still passes all route gates.
            if (L === 3 && r?.fail && r.fail !== 'noPath' && r.fail !== 'noB') {
              for (const order of [[1, -1, 0], [-1, 1, 0]]) {
                const alternative = tryBearing(g, aIdx, i * 5, L, off, mapA, targetIdx, order);
                if (!alternative?.fail) { r = alternative; break; }
              }
            }
            if (r?.fail) { why[r.fail] = (why[r.fail] || 0) + 1; if (r.ov != null) bestOv = Math.min(bestOv, r.ov); continue; }
            // When fixture already has formal L3, lock its midpoint first. Same-center candidates revert to
            // bridge/tunnel preferences and tactical ranking, converging bake -> recapture -> rebake into a fixed point.
            if (r && pinnedL3 && L === 3 && !mapA) {
              r.centerM = centerErrorM(fixture, g, r);
              const bestCenterM = best?.centerM ?? Infinity;
              if (!best || r.centerM < bestCenterM - 0.001) { best = r; continue; }
              if (r.centerM > bestCenterM + 0.001) continue;
            }
            // Lexicographical ordering: Rule #5 tunnel turret violations lowest first,
            // then Rule #4 residual lowest, then tactical score highest.
            // Both are preferences, not hard gates: take minimum even if noncompliant.
            // TunBad remains 0 for venues without tunnels.
            if (r && PREFER_TUNNEL.has(id)
              && (!best || r.tunLen > best.tunLen + 1
                || (Math.abs(r.tunLen - best.tunLen) <= 1 && (r.tunBad < best.tunBad
                  || (r.tunBad === best.tunBad && (r.resid < best.resid
                    || (r.resid === best.resid && r.score > best.score))))))) { best = r; continue; }
            if (r && PREFER_BRIDGE.has(id)
              && (!best || r.brgLen > best.brgLen + 1
                || (Math.abs(r.brgLen - best.brgLen) <= 1 && (r.tunBad < best.tunBad
                  || (r.tunBad === best.tunBad && (r.resid < best.resid
                    || (r.resid === best.resid && r.score > best.score))))))) { best = r; continue; }
            if (r && !PREFER_BRIDGE.has(id) && !PREFER_TUNNEL.has(id) && (!best || r.tunBad < best.tunBad
              || (r.tunBad === best.tunBad && (r.resid < best.resid
                || (r.resid === best.resid && r.score > best.score))))) best = r;
          }
        }
      }
      if (!best) {
        // Unable to assemble real road lanes for this scale -> key is omitted;
        // full battlefield L1/L2 derive from parent.
        log(`  ${key} X No viable bearing reasons=${JSON.stringify(why)}${bestOv < 9 ? ` bestOv=${bestOv.toFixed(3)}` : ''}`);
        continue;
      }
      byL[key] = { g, ...best };
      log(`  ${key} OK br=${best.bearing} deg ov=${best.maxOverlap.toFixed(3)} sinu=${best.sinuosity.toFixed(2)} resid=${best.resid}` +
        (best.tunBad ? ` [WARN] tunnel tower violations=${best.tunBad}` : ''));
    }
    const hits = Object.keys(byL).length;
    if (!hits) continue;
    // Pick anchor: most compliant keys (Rules #4/#5), then most available road keys; first listed breaks ties.
    // Full-battlefield keys precede reduced-scale keys.
    const cnt = (ks) => {
      const es = ks.map((k) => byL[k]).filter(Boolean);
      return [es.filter((b) => b.resid === 0 && b.tunBad === 0).length, es.length];
    };
    // Re-baking fixture locks projection seam: identical compliance prioritizes L3 midpoint closest to fixture.center.
    const centerM = fixture ? centerErrorM(fixture, g, byL[3]) : 0;
    const rank = [...cnt(KEYS.filter((k) => typeof k === 'number')), ...cnt(KEYS), -centerM];
    if (!picked || lexGT(rank, picked.rank)) picked = { anchor, byL, ways: ways.length, g, conf: rank[2], rank, centerM };
    if (!fixture && byL[3] && byL.m1 && rank[0] === 1 && rank[2] === 2) break;   // Online mode stops early on full compliance
  }
  if (!picked) { report.push(`${id}: [FAIL] No real road solution across scales -> default to synthLane`); log(`${id}: [FAIL]`); continue; }
  out[id] = picked;
  const mark = (K) => {
    if (picked.byL[K]) return `${K} ov=${picked.byL[K].maxOverlap.toFixed(2)}`;
    if ((K === 1 || K === 2) && picked.byL[3]) return `${K} (derived from parent)`;
    return `${K} synth`;
  };
  const full = !!(picked.byL[3] && picked.byL.m1);
  report.push(`${id}: ${full ? 'OK' : 'PARTIAL'} A=[${picked.anchor.map((v) => v.toFixed(5))}] ${KEYS.map(mark).join(' | ')}`
    + (fixture ? ` | centerΔ=${Number.isFinite(picked.centerM) ? picked.centerM.toFixed(3) : 'inf'}m` : ''));
  log(`${id}: ${full ? 'OK' : 'PARTIAL'}`);
}

// Specified venues only write when ALL succeed in acquiring graphs and lanes.
// When external services fail, rewriting would drop unbaked venues from the table,
// falling back silently to synthLane next match and effectively deleting valid routes.
const missing = ONLY.filter((id) => !out[id]);
if (missing.length) {
  log(`\n[FAIL] Target venues missing usable routes, refusing to rewrite venueLanes.js: ${missing.join(', ')}`);
  process.exit(1);
}

log('\n---- Report ----');
for (const r of report) log(r);
log(`\nSuccess ${Object.keys(out).length} / ${Object.keys(ANCHORS).length}`);

if (FIXTURE_DIR && process.env.FIXTURE_WRITE !== '1') {
  log('\nFixture diagnostic mode: FIXTURE_WRITE=1 not set, skipping overwrite of public/js/venueLanes.js.');
  process.exit(0);
}

if (FIXTURE_DIR) {
  const missingMother = Object.entries(out).filter(([, picked]) => !picked.byL[3]).map(([id]) => id);
  if (missingMother.length) {
    throw new Error(`Refusing fixture bake without a road mother: ${missingMother.join(', ')}`);
  }
  const drifted = Object.entries(out).flatMap(([id, picked]) => {
    const fixture = FIXTURE_BY_VENUE.get(id);
    const drift = fixtureContractDrift(fixture, picked.g, picked.byL[3]);
    return drift.centerM <= 0.001 && drift.bboxDeg < 1e-9
      ? [] : [`${id}(center=${drift.centerM.toFixed(3)}m,bbox=${drift.bboxDeg.toExponential(2)}°)`];
  });
  if (drifted.length && process.env.FIXTURE_RECAPTURE !== '1') {
    log(`\n[FAIL] Candidate would drift fixture center/bbox, refusing write: ${drifted.join(', ')}`);
    log('To move venue coordinates permanently, set FIXTURE_RECAPTURE=1 and run fetch_osm_fixture.mjs --update.');
    process.exit(1);
  }
}

let js = `// ============ Default venue lanes (offline precomputed, do not hand edit) ============
// Generated by tools/bake_venue_lanes.mjs: Overpass real road network -> edge-disjoint shortest path.
// Every vertex of each lane is an OSM road node -> NPC paths 100% match navigation routes.
// Rules passed: base distance >= ${MAPGEO.MIN_DIST_FRAC * 100}% diagonal,
// overlap <= ${MAPGEO.MAX_OVERLAP} (overlapCellM(L)), detour <= 2.2x straight distance,
// no mutual contact/crossing (excluding base fanouts, mid-segment min separation >= ${MAPGEO.LANE_MIN_SEP_M} game meters).
// bases[0] = SWARM (anchor side), bases[1] = STEEL; lanes sorted laterally [top, middle, bottom].
// Keys (see venues.js \`venueLaneKey\`): 1/2 = derived middle / outer lanes from parent key 3 (same bases);
// m1 = Dedicated story route (base distance factor ${(realDistFor(1, 'SWARM') / realDistFor(1)).toFixed(1)}).
// Different distance constraints require an independent road route rather than a truncated full route.
// Tower placement is validated for both defending factions.
export const VENUE_LANES = {\n`;
// When baking ONLY= specified venues, existing lanes of remaining venues MUST be preserved unchanged.
const keep = FIXTURE_DIR
  ? Object.entries(VENUE_LANES).filter(([id]) => !(id in ANCHORS) || !out[id])
  : ONLY.length ? Object.entries(VENUE_LANES).filter(([id]) => !(id in ANCHORS)) : [];
for (const [id, byL] of keep) {
  js += `  ${id}: {\n`;
  for (const K of KEYS) {
    const e = byL[K];
    if (!e) continue;
    js += `    ${K}: { bearing: ${e.bearing}, maxOverlap: ${e.maxOverlap},\n`;
    js += `      bases: [[${e.bases[0][0]},${e.bases[0][1]}],[${e.bases[1][0]},${e.bases[1][1]}]],\n`;
    js += `      lanes: [\n        ${e.lanes.map((l) => `[${l.map((p) => `[${p[0]},${p[1]}]`).join(',')}]`).join(',\n        ')}\n      ] },\n`;
  }
  js += `  },\n`;
}
for (const [id, v] of Object.entries(out)) {
  js += `  ${id}: {\n`;
  // L1/L2 derived from parent (key 3), sharing same bases:
  // L1 = parent middle (idx 1), L2 = parent left and right (idx 0/2). Missing parent omits L1/L2.
  const m3 = v.byL[3];
  const derived = {};
  if (m3) {
    derived[1] = { sub: [1], ov: 0 };
    const c2 = overlapCellM(2, false);
    derived[2] = { sub: [0, 2], ov: overlapXZ(m3.lanes[0].xz, m3.lanes[2].xz, c2) };
  }
  for (const K of KEYS) {
    const dv = derived[K];
    const b = v.byL[K] || (dv && m3);
    if (!b) continue;                     // Key lacks real road solution -> venues.js degrades (see venueConfig)
    const g = v.g;
    const A = [g.LA[b.aIdx], g.LN[b.aIdx]], B = [g.LA[b.bIdx], g.LN[b.bIdx]];
    const lanesLL = (dv ? dv.sub.map((i) => b.lanes[i]) : b.lanes).map((l) => l.idx.map((i) => [r6(g.LA[i]), r6(g.LN[i])]));
    const mo = dv ? dv.ov : b.maxOverlap;
    const source = { provider: 'baked-osm-graph', version: 'road-profile-' + MAP_RULE_VERSION,
      fingerprint: roadFingerprint(g.ways) };
    const proofs = lanesLL.map(lane => traceRoadEvidence(lane, g.ways, { source }));
    js += `    ${K}: { bearing: ${b.bearing}, maxOverlap: ${+mo.toFixed(3)},\n`;
    js += `      bases: [[${r6(A[0])},${r6(A[1])}],[${r6(B[0])},${r6(B[1])}]],\n`;
    js += `      lanes: [\n        ${lanesLL.map((l) => `[${l.map((p) => `[${p[0]},${p[1]}]`).join(',')}]`).join(',\n        ')}\n      ], roadSources: ${JSON.stringify(proofs.every(Boolean) ? proofs : null)} },\n`;
  }
  js += `  },\n`;
}
js += '};\n';
if (ONLY.length || FIXTURE_DIR) {
  // Partial bakes preserve the source and ordering of every untouched venue.
  let current = readSrc('public', 'js', 'venueLanes.js');
  for (const id of Object.keys(out)) {
    const marker = `\n  ${id}: `;
    const newBlock = grabBlock(js, marker);
    if (!current.includes(marker)) {
      const end = current.lastIndexOf('};');
      current = current.slice(0, end) + `  ${id}: ${newBlock},\n` + current.slice(end);
      continue;
    }
    const oldBlock = grabBlock(current, marker);
    const start = current.indexOf('{', current.indexOf(marker));
    current = current.slice(0, start) + newBlock + current.slice(start + oldBlock.length);
  }
  js = current;
}
const dest = OUTPUT || new URL('../public/js/venueLanes.js', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
mkdirSync(dirname(dest), { recursive: true });
writeFileSync(dest, js, 'utf8');
log('\nwrote', dest, (js.length / 1024).toFixed(1) + ' KB');
