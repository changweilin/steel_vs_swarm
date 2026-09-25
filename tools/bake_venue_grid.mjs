// ============ Venue Primary Grid Orientation Baker ============
// Determines the map rotation angle that best aligns arterial roads to world axes as an orthogonal grid.
// Bakes offline results for default venues into public/js/venueGrid.js (pure data; MUST NOT be edited manually).
//
// Rationale for offline baking over runtime computation:
// Rotation is part of map projection, defining the authoritative coordinate frame shared between client and server
// (terrain.llToWorld / sim.llToMeters). Computing at runtime fails because:
//   1. buildTerrain runs before road network data is fetched.
//   2. startPrebuild runs on each client independently; variable network conditions or truncated Overpass responses
//      would produce mismatched angles between clients, rotating all unit coordinate systems out of sync.
// Therefore, rotation theta MUST freeze as a constant before battleConfig settles.
// Predefined venues are baked offline; custom maps are measured once upon "Save to Favorites" (main.resolveMapRot,
// sharing roadGridRotDeg). Unlisted venues default to rot=0 (no rotation, legacy bit-identical).
//
// Sampling target = major arterials (roadgrid.GRID_HW).
// Rotation derivation is unified in roadgrid.js roadGridRotDeg().
//
// Idempotency:
// Bounding box and measurement frames MUST evaluate in the rot=0 frame. venueConfig stores baked rot into center,
// which expands battleBBox. Without stripping previous rot, successive bakes drift.
// Baseline verification targets:
// manhattan -28.995 / barcelona 42.803 / shibuya 14.527 / kyoto -2.542 / chicago -0.003.
//
// Usage:
//   node tools/bake_venue_grid.mjs              # All venues
//   node tools/bake_venue_grid.mjs --only taipei,berlin
//   node tools/bake_venue_grid.mjs --dry        # Print results without writing file
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT } from './audit_src.mjs';
import { VENUES, venueConfig } from '../public/js/venues.js';
import { battleBBox, llToXZ } from '../public/js/data.js';
import { GRID_HW, roadGridRotDeg, waySegs } from '../public/js/roadgrid.js';

const OSM_UA = 'steel-vs-swarm/1.0 (venue grid bake)';
const OVERPASS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
  'https://maps.mail.ru/osm/tools/overpass/api/interpreter',
];
const REQ_MS = 45000, DEAD_N = 2, ROUNDS = 2;
const RETRYABLE = new Set([429, 502, 503, 504]);
const fails = new Map();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Mirror rotation: each mirror MUST be timed individually; sharing a single timeout exhausts entire budget on one hung host. */
async function overpass(q) {
  let retryable = false;
  for (let round = 0; round < ROUNDS; round++) {
    for (const url of OVERPASS) {
      if ((fails.get(url) || 0) >= DEAD_N) continue;
      try {
        const r = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'User-Agent': OSM_UA },
          body: 'data=' + encodeURIComponent(q),
          signal: AbortSignal.timeout(REQ_MS),
        });
        if (!r.ok) {
          fails.set(url, (fails.get(url) || 0) + 1);
          retryable = retryable || RETRYABLE.has(r.status);
          continue;
        }
        const d = await r.json();
        if (d.remark) { retryable = true; continue; }
        fails.set(url, 0);
        return d.elements || [];
      } catch {
        fails.set(url, (fails.get(url) || 0) + 1);
        retryable = true;
      }
    }
    if (!retryable) return null;
    retryable = false;
    await sleep(3000 * (round + 1));
  }
  return null;
}

/**
 * Venue primary grid orientation (degrees). Returns null on failure (unlisted venues default to rot=0).
 * Bounding box evaluates at L1 (teamSize=1): varying team sizes only change scale; cadastre grid is invariant.
 * Each venue has exactly one angle, independent of player count.
 */
async function bakeOne(v) {
  const cfg0 = venueConfig(v, 1);
  // Sampling bbox MUST evaluate in unrotated rot=0 frame to guarantee idempotency.
  // venueConfig embeds previously baked rot into center, expanding battleBBox (e.g. shibuya 1.77x, barcelona 2.27x).
  // Sampling over expanded boxes causes successive baking runs to drift.
  const cfg = { ...cfg0, center: { lat: cfg0.center.lat, lng: cfg0.center.lng } };
  const bb = battleBBox(cfg);
  const bbs = `${bb.minLat.toFixed(5)},${bb.minLng.toFixed(5)},${bb.maxLat.toFixed(5)},${bb.maxLng.toFixed(5)}`;
  // Highway query filter is defined once in roadgrid.GRID_HW; .source provides the Overpass query filter.
  const q = `[out:json][timeout:60];way["highway"~"${GRID_HW.source}"](${bbs});out geom 900;`;
  const els = await overpass(q);
  if (!els) return { rotDeg: null, why: '圖資取得失敗' };
  const ways = els
    .filter((e) => e.type === 'way' && e.geometry && GRID_HW.test(e.tags?.highway || ''))
    .map((e) => ({ tags: e.tags, geometry: e.geometry }));
  if (!ways.length) return { rotDeg: null, why: '此範圍沒有大馬路' };
  // Measurement frame MUST remain unrotated (c without rot); roadGridRotDeg handles sampling, measurement, and sign inversion.
  const c = { lat: cfg.center.lat, lng: cfg.center.lng };
  const toXZ = (p) => llToXZ(p.lat, p.lon, c);
  const rotDeg = roadGridRotDeg(ways, toXZ);
  if (rotDeg == null) return { rotDeg: null, why: '線段長度不足' };
  const totalM = waySegs(ways, toXZ, (w) => GRID_HW.test(w.tags?.highway || ''))
    .reduce((s, g) => s + Math.hypot(g[2] - g[0], g[3] - g[1]), 0);
  return { rotDeg, ways: ways.length, km: totalM / 1000 };
}

const argv = process.argv.slice(2);
const only = (argv.find((s) => s.startsWith('--only=')) || '').slice(7).split(',').filter(Boolean);
const onlyIdx = argv.indexOf('--only');
if (onlyIdx >= 0 && argv[onlyIdx + 1]) only.push(...argv[onlyIdx + 1].split(','));
const dry = argv.includes('--dry');

const list = VENUES.filter((v) => !only.length || only.includes(v.id));
const out = {};
let okN = 0;
for (const v of list) {
  const r = await bakeOne(v);
  if (r.rotDeg == null) {
    console.log(`  ✗ ${v.id.padEnd(14)} ${r.why}(執行期 rot=0,不旋轉)`);
    continue;
  }
  out[v.id] = +r.rotDeg.toFixed(4);
  okN++;
  console.log(`  ✓ ${v.id.padEnd(14)} rot ${r.rotDeg.toFixed(3).padStart(8)}°  (大馬路 ${r.ways} 條 / ${r.km.toFixed(1)} 遊戲公里)`);
  await sleep(1200);   // Rate limiting for public Overpass mirrors.
}
console.log(`\n量到 ${okN} / ${list.length} 個場地`);
if (dry) { console.log('(--dry:未寫檔)'); process.exit(0); }
if (!okN) { console.log('一個都沒量到 —— 不覆蓋既有檔案'); process.exit(1); }

// Partial baking (--only) MUST merge into existing table to prevent unbaked venues from being wiped.
let prev = {};
try { ({ VENUE_GRID: prev } = await import('../public/js/venueGrid.js')); } catch { /* Initial bake */ }
const merged = { ...prev, ...out };
const body = Object.keys(merged).sort().map((k) => `  ${k}: ${merged[k]},`).join('\n');
const src = `// ============ Venue primary orientation (baked offline; hands MUST NOT edit) ============
// Generated by \`node tools/bake_venue_grid.mjs\`. Values are degrees: "rotate the map this far
// and the venue arterials align to world axes (orthogonal grid)" = -(arterial mod-90-degree heading), in [-45, 45].
// Sole consumer is \`venues.js venueConfig()\` (written into cfg.center.rot, converted to radians);
// a venue missing from the table => 0 = no rotation = bit-identical legacy behavior (custom maps and old favorites take this path).
// Changing \`roadgrid.js gridAngle()\` or the sampling plane (the arterial definition) MUST trigger a rebake.
export const VENUE_GRID = {
${body}
};
`;
writeFileSync(join(ROOT, 'public/js/venueGrid.js'), src, 'utf8');
console.log('已寫入 public/js/venueGrid.js');
