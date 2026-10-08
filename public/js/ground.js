// Procedural ground placement: taxonomy/params separated from geometry gen; reuses terrain
// drape, road avoidance, and collision registration.
import * as THREE from 'three';
import { mulberry32 } from './rng.js';
import { DEFS, ZONES, CARPET, FAMS, SIZE, SURFACES } from './groundCatalog.js';
import { paintGround, surfaceEnvironment, surfaceAllowed, surfaceParameters, probeSurface, groundSeed, groundPlantState } from './proceduralGround.js';
import { GROUND_ATTACHMENTS, GROUND_PART_PALETTES } from './groundPartCatalog.js';
import { createGroundParts } from './proceduralGroundParts.js';
import { ENV, inkCtrM, edgeWallInsetM, optimalSolarTiltRad, mapRot } from './data.js';
import { envMat, surfGroup } from './toon.js';
import { gridAngle } from './roadgrid.js';
import { registerStreamTex } from './tex.js';

const MAX_DETAIL = 19000;  // Total 3D detail instance cap (feature + carpet scatter; all
                           // InstancedMesh so draw calls flat; 2026-07-12 15000 to 19000: green
                           // weed/flower-band dense scatter needed quota)
const FEAT_DETAIL = 12000; // Feature-layer detail quota; rest stays with carpet so open ground never bares
const VARIANTS = 6;        // Texture variants per surface (lazily built on use only;
                           // 2026-07-12 4 to 6: in-view same-kind dedup needs more rotation)
const CARPET_VARIANTS = 3; // Carpet variant count (per-cell distinct, planCarpetVariants): each extra
                           // same-kind variant costs one mesh per sub#variant batch, and this renderer
                           // is draw-call bound; 3 is the lower bound for all-different shared edges
                           // (at most two decided shared-edge neighbors, so a third is always pickable)
const BUF_CELL_F = 3;      // Buffer-ring carpet cell multiple (x cell): that ring sits 40m+ from playable,
                           // out to 455m, details invisible -- full-res would cost 2.5x cells of overdraw
const RSCALE = 1.3;        // Global feature patch radius multiplier
const VIS_R = 300;         // Anti-repeat radius = hero max sight (UNITS.drone.sight)
const SEP_F = 0.85;        // Natural-kind puzzle spacing factor (circle approx): d >= (r1+r2)x0.85,
                           // only small edge overlap allowed (fade edges melt, deliberate)
const INK_SEP_F = 1.06;    // Broad-phase conservative factor (legacy regular-vs-regular circle factor;
                           // precise test now uses true footprints, see footNear)
// ==== Functional blocks / 3D objects MUST NOT overlap (2026-08-11 user decision) ====
// Fields, parking lots, courts and other functional blocks MUST NOT overlap 3D objects either.
// Three things measured separately:
//   1. Functional blocks (edge ink fields/parking/courts/plazas/solar and more) take zero
//      overlap against ANY puzzle -- judged on true footprints (rect = oriented box, blob =
//      hand-drawn outline bounding circle); MUST NOT fall back to equal-area circle approx:
//      equal-area circles run 16 percent short on the long axis and 20 percent long on the
//      short axis, so a court corner slides into parking while the circle test says fine,
//      and on screen that is two neat blocks cutting through each other.
//   2. 3D objects MUST NOT interpenetrate: footprint radius measures real part geometry
//      (detailR, same foot discipline as beacons) times instance scale.
//   3. 3D objects MUST NOT stand inside functional blocks they do not belong to (no reeds of
//      the next meadow growing inside a parking lot).
// Natural-vs-natural (fade vs fade) deliberately keeps SEP_F edge blending: that is the
// 2026-07-12 anti-repeat device, and they are not functional blocks -- two grass outlines
// biting into each other is exactly what nature looks like.
export const PATCH_GAP = 1.0;     // Functional-block clearance (m). MUST stay below array gap
                           // ARR_GAP (1.6) and family-extension gap (1.2), else street arrays and
                           // farm quilts break themselves apart
export const DET_GAP = 0.0;       // Between 3D objects: footprint tangent is enough (0 = no overlap;
                           // more clearance would thin dense grass)

// All three exported: offline audits MUST run the source text (copying a geometry formula
// into the audit only verifies the copy)
// Closest distance from point to oriented box (0 = inside); ry axis convention matches emitRect
// (local x axis = (cos, sin))
export function obbDist(px, pz, o) {
  const ca = Math.cos(o.ry), sa = Math.sin(o.ry), dx = px - o.x, dz = pz - o.z;
  const lx = dx * ca + dz * sa, lz = -dx * sa + dz * ca;
  return Math.hypot(Math.max(0, Math.abs(lx) - o.hw), Math.max(0, Math.abs(lz) - o.hd));
}
// Whether two oriented boxes come closer than gap (SAT on four axes; separated on an axis
// by >= gap counts as not close)
export function obbNear(a, b, gap) {
  const dx = b.x - a.x, dz = b.z - a.z;
  const axes = [[Math.cos(a.ry), Math.sin(a.ry)], [-Math.sin(a.ry), Math.cos(a.ry)],
                [Math.cos(b.ry), Math.sin(b.ry)], [-Math.sin(b.ry), Math.cos(b.ry)]];
  for (const [ax, az] of axes) {
    const proj = (o) => Math.abs(Math.cos(o.ry) * ax + Math.sin(o.ry) * az) * o.hw
                      + Math.abs(-Math.sin(o.ry) * ax + Math.cos(o.ry) * az) * o.hd;
    if (Math.abs(dx * ax + dz * az) >= proj(a) + proj(b) + gap) return false;
  }
  return true;
}
// Footprint single seam: circle x, z, r or oriented box x, z, hw, hd, ry, r (r = bounding
// radius for broad phase)
export function footNear(a, b, gap) {
  if (!a.hd && !b.hd) return Math.hypot(a.x - b.x, a.z - b.z) < a.r + b.r + gap;
  if (a.hd && b.hd) return obbNear(a, b, gap);
  const c = a.hd ? b : a, o = a.hd ? a : b;
  return obbDist(c.x, c.z, o) < c.r + gap;
}

// Shared spatial index for scene footprints: roads, buildings, vegetation, fields all use
// the same true volumes through footNear.
export function makeFootprintIndex(feet = [], cell = 64) {
  const grid = new Map();
  const add = (foot) => {
    const i0 = Math.floor((foot.x - foot.r) / cell), i1 = Math.floor((foot.x + foot.r) / cell);
    const j0 = Math.floor((foot.z - foot.r) / cell), j1 = Math.floor((foot.z + foot.r) / cell);
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
      const key = `${i},${j}`;
      let arr = grid.get(key);
      if (!arr) { arr = []; grid.set(key, arr); }
      arr.push(foot);
    }
  };
  for (const foot of feet) add(foot);
  return {
    add,
    near(foot, gap = 0) {
      const seen = new Set();
      const R = foot.r + gap;
      const i0 = Math.floor((foot.x - R) / cell), i1 = Math.floor((foot.x + R) / cell);
      const j0 = Math.floor((foot.z - R) / cell), j1 = Math.floor((foot.z + R) / cell);
      for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
        const arr = grid.get(`${i},${j}`);
        if (!arr) continue;
        for (const other of arr) {
          if (seen.has(other)) continue;
          seen.add(other);
          if (footNear(foot, other, gap)) return true;
        }
      }
      return false;
    },
  };
}

// Convert blocker box/circle fields to the shared footprint format; boxes MUST keep their
// rotation, never fall back to bounding circles.
export function blockerFoot(b) {
  if (b.hw2 != null && b.hd2 != null) {
    return { x: b.x, z: b.z, hw: b.hw2, hd: b.hd2, ry: b.ry || 0,
             r: b.r ?? Math.hypot(b.hw2, b.hd2) };
  }
  return { x: b.x, z: b.z, r: b.r };
}



// Low-frequency value noise: subtype/variant zoning (nearby patches share kind+variant,
// so runs extend without breaking texture)
function vnoise(x, z, seed) {
  const h = (i, j) => {
    let n = ((i * 374761393 + j * 668265263) ^ seed) | 0;
    n = Math.imul(n ^ (n >>> 13), 1274126177);
    return ((n ^ (n >>> 16)) >>> 0) / 4294967296;
  };
  const xi = Math.floor(x), zi = Math.floor(z);
  let fx = x - xi, fz = z - zi;
  fx = fx * fx * (3 - 2 * fx); fz = fz * fz * (3 - 2 * fz);
  return (h(xi, zi) * (1 - fx) + h(xi + 1, zi) * fx) * (1 - fz)
       + (h(xi, zi + 1) * (1 - fx) + h(xi + 1, zi + 1) * fx) * fz;
}

// ---- Procedural ground brush textures (fixed seeds; cached by surface#variant key) ----
// Climate buckets share textures; brush seeds remain independent of environment.
// Brush seeds still derive only from sub#variant, so furrow/gap positions of one field stay
// fixed across seasons while only the crop changes (four-season design item 3)
function groundTex(sub, variant, fit, season, environment, seed, cache) {
  const key = `${sub}#${variant}`;
  const ck = `${key}@${season}/${fit}/${environment.snow}/${environment.growth}/${environment.wetness}/${environment.autumn}/${environment.geology}`;
  if (cache.has(ck)) return cache.get(ck);
  const S = sub === 'track' ? 1024 : 256;
  const cv = document.createElement('canvas');
  cv.width = cv.height = S;
  let hs = 0;
  for (let i = 0; i < key.length; i++) hs = (hs * 31 + key.charCodeAt(i)) | 0;
  let pW, pD;
  if (sub === 'parking') {
    pW = 20 + variant * 8;
    pD = Math.round(pW * (DEFS.parking?.aspect || 0.7));
  } else if (sub === 'court') {
    pW = 28 + (variant >= 3 ? 28 : 0);
    pD = 15 + (variant >= 4 ? 15 : 0);
  }
  paintGround(cv.getContext('2d'), S, sub, seed ^ hs, environment, SUB_COL[sub], pW, pD);
  const t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.SRGBColorSpace;
  // Mirrored repeat: brush features cross tiles seamlessly (fit singles cover once, no repeat)
  t.wrapS = t.wrapT = fit ? THREE.ClampToEdgeWrapping : THREE.MirroredRepeatWrapping;
  registerStreamTex(t);
  cache.set(ck, t);
  return t;
}

// Hand-drawn brush blob (painterly blob; photoreal noise banned)
function brushBlob(g, x, y, r, rnd) {
  g.beginPath();
  for (let a = 0; a <= 10; a++) {
    const t = a / 10 * Math.PI * 2;
    const rr = r * (0.7 + rnd() * 0.5);
    const px = x + Math.cos(t) * rr, py = y + Math.sin(t) * rr;
    a ? g.lineTo(px, py) : g.moveTo(px, py);
  }
  g.closePath();
  g.fill();
}
// Base color (hex to css rgb): all variants of one surface share one base (2026-08-12 user
// decision: same-color terrain patches can carry different patterns/motifs/sprinkles) --
// variants swap only the print, never the color. The old vary shook the base by +-10/255 per
// variant, and since carpet picks variants per cell (planCarpetVariants), that shake became a
// per-cell color swap = half of the reported short-range flicker; the words same-colored
// neighbors alone demand same-color variants.
// Still draws three randoms, so every later brush stroke stays bit-identical to the old rule
// (only the base cell changed).
function baseFill(hex, rnd) {
  for (let k = 0; k < 3; k++) rnd();
  return `rgb(${hex >> 16 & 255},${hex >> 8 & 255},${hex & 255})`;
}

// ==== Four-season farm surfaces (2026-08-13 user request) ====
// User words: fields plus veggie plots, pasture, fish ponds, orchards and more, all season-aware
// including the original fields. Old seasons were one SEASON_TINT multiply filter (tints the
// whole map yellow) -- not what an autumn paddy looks like (cut stubble and golden ear waves,
// not green rice under a filter). Three rules:
//  1. Seasonal paint and quantized local climate share cached textures.
//  2. Season-aware surfaces MUST be flagged seasonal and skip SEASON_TINT -- skipping nothing
//    tints twice (brush already gold, times one more 0xffd9a8 = faded photo).
//  3. Brushes eat their own mulberry32, not the shared rnd, so seasonal branches draw as many
//    as they want without shifting layout (2.3).

// ==== Carpet representative colors (2026-08-13 user request: no fast short-range jumps
// inside one type) ====
// Base colors used to live only in each painter first line baseFill(0x..) -- paint-first-ask-later.
// This round needs colors BEFORE painting for two consumers:
//   1. Carpet picking rosters sort by color (index adjacency = color adjacency), so noise sweeps
//      a gradient instead of green-red-gray;
//   2. Sharp color jumps get a divider line (borderKindOf same-zone branch).
// => Collect representative colors into ONE table shared by painters and both consumers (MUST NOT
//    copy a second table at the sort/border side: changing one painter base while sorting stays
//    old silently un-gradients the roster, reading on screen as jumping again).
//
// Three rules:
//  1. Roster MUST cover exactly the kinds reaching carpet (CARPET union ENCLAVE_STYLES carpet,
//    audit checks both directions) -- feature patches (courts/gas stations/sites) never enter the
//    carpet grid, so no sort and no border applies to them;
//  2. That kind painter MUST really eat this table (audit greps baseFill(SUB_COL.kind) per kind);
//  3. Brick land is the named exception: its base is mortar, the read color is those five bricks
//    => representative derives from brick colors (mean of BRICK_C), MUST NOT hand-write a second
//    number.
const BRICK_C = ['#b06a4a', '#a35f3f', '#bd7855', '#9d5a3e', '#b57050'];
const hexOf = (css) => parseInt(css.slice(1), 16);
const meanHex = (list) => {
  let r = 0, g = 0, b = 0;
  for (const c of list) { const h = hexOf(c); r += h >> 16 & 255; g += h >> 8 & 255; b += h & 255; }
  const n = list.length;
  return ((Math.round(r / n) << 16) | (Math.round(g / n) << 8) | Math.round(b / n));
};
export const SUB_COL = {
  // green
  turf: 0x7db159, lawn: 0x6fae5a, meadow: 0xb3a468, bushfield: 0x6f9a4c, flowerfield: 0x78a854,
  arrowbamboo: 0x8ba757, deadwood: 0x9c9070, fallenlogs: 0x7c8a55, park: 0x74a85c,
  // bare
  wild: 0x8d835f, gravel: 0x9a9384, sand: 0xdcc28f, mud: 0x6d5940, crackedearth: 0xb08d5f,
  redsoil: 0xa05f42, deadforest: 0x6b655c, steppe: 0xbca95e,
  // urban
  concrete: 0xa2a49e, pavement: 0x98948b, brick: meanHex(BRICK_C),
  // wet / water
  marsh: 0x5d5647, lotus: 0x41616b, watertile: 0x2f6f96, deepwater: 0x1c4560,
  // highland
  plateau: 0xa08c6a, icefield: 0xd8e8ee, scree: 0x8f8c84,
};
// Perceived color distance (redmean approx; range 0-765). Pure function, zero tables, zero deps --
// plain RGB Euclidean calls deep-green vs deep-blue closer than grass-green vs soil-yellow, while
// the abruptness the user means is measured by the human eye.
export function colDist(h1, h2) {
  const r1 = h1 >> 16 & 255, g1 = h1 >> 8 & 255, b1 = h1 & 255;
  const r2 = h2 >> 16 & 255, g2 = h2 >> 8 & 255, b2 = h2 & 255;
  const rm = (r1 + r2) / 2, dr = r1 - r2, dg = g1 - g2, db = b1 - b2;
  return Math.sqrt((2 + rm / 256) * dr * dr + 4 * dg * dg + (2 + (255 - rm) / 256) * db * db);
}
// Carpet picking roster sorted into a color path (pure function; zero rnd / zero Math.random, 2.3).
// Lesion: cellSubAt maps low-frequency noise t to roster index, but the roster itself is no color
// ramp -- the green roster slots 8-9-10 run meadow (tan) to deadwood (gray) to turf (green). Smooth t
// walks across while colors jump. Picking blocks (CARPET_LOT) only make jumps less frequent;
// amplitude untouched.
// New rule: sort into a color path => index adjacency = color adjacency, noise sweeping the roster
// walks a gradient band.
//   1. Duplicates = weight; sorting MUST keep multiplicity with same kinds adjacent (weight becomes
//      a plateau on the gradient);
//   2. Path starts from the kind farthest from the color centroid -- starting mid-way walks half
//      each way and rejoins with a big jump (greedy-nearest-neighbor classic failure);
//   3. Same-distance ties take roster order (deterministic, bit-identical across clients).
export function carpetOrder(list, colOf = (s) => SUB_COL[s]) {
  const uniq = [];
  for (const s of list) if (!uniq.includes(s)) uniq.push(s);
  // Fall back to roster order only for one kind or kinds missing representative colors. Two
  // kinds still sort -- not for ordering but to gather same kinds into one run (a roster like
  // lotus, marsh, lotus splits lotus across marsh and walks pond-marsh-pond back and forth)
  if (uniq.length <= 1 || uniq.some((s) => colOf(s) == null)) return list.slice();
  let cr = 0, cg = 0, cb = 0;
  for (const s of uniq) { const h = colOf(s); cr += h >> 16 & 255; cg += h >> 8 & 255; cb += h & 255; }
  const ctr = ((Math.round(cr / uniq.length) << 16) | (Math.round(cg / uniq.length) << 8)
               | Math.round(cb / uniq.length));
  let start = uniq[0], bd = -1;
  for (const s of uniq) { const d = colDist(colOf(s), ctr); if (d > bd) { bd = d; start = s; } }
  const path = [start], left = uniq.filter((s) => s !== start);
  while (left.length) {
    const cur = colOf(path[path.length - 1]);
    let bi = 0, bdd = Infinity;
    for (let i = 0; i < left.length; i++) {
      const d = colDist(cur, colOf(left[i]));
      if (d < bdd) { bdd = d; bi = i; }
    }
    path.push(left.splice(bi, 1)[0]);
  }
  const out = [];
  for (const s of path) for (const q of list) if (q === s) out.push(s);
  return out;
}



// ---- Surface definitions ----
// shape: blob = irregular patch / rect = field, court; uv: fit = single-sheet cover
// (else world-projected tile)
// edge: fade = outer alpha melts into terrain (natural) / ink = hard ink line (artificial)
// slope: allowed height/radius ratio; rim: outer raised ring (field bund); fam: extension family
// reg: tidiness 0..1 = probability of aligning to the nearest road at placement (orient());
//   rest, or no road nearby, goes random. Farmed/court surfaces high, natural blobs always 0

// Zone slices (value-noise pick; duplicates = weight, ends = rare)
// Feature-layer zone slices (value-noise pick; duplicates = weight, ends = rare):
// Only place-like features go here -- things with 3D detail or hard borders; pure ground kinds
// are all carpet duty now
// Cross-zone form split (2026-07-12): solar panels/containers read as sparse urban pieces but
// large bare-land arrays -- solarfarm/containeryard place patches moved to bare land (wasteland
// solar fields / inland container yards); urban instead scatters sparse singles on concrete /
// parking via scatterDetails (see concrete branch)

// Carpet zone slices: all tile-type (world-projected UV) ground, laid in big continuous land sheets

// Extension families: same-family patches extend adjacently (farm quilts / sports parks / green
// clusters / logged scars / ruin clusters / highland bands / salt-fishpond pans / quarry sites /
// stockpile yards)

// Bund-eligible roster: derived not written -- farm quilts (rectFarm) + pan areas (panFam, fishpond
// and salt-pan berms are the same thing). A hand-written roster silently expires when surfaces are
// added (pasture entering rectFarm automatically gains bunds).
const BUND_SUBS = new Set([...FAMS.rectFarm, ...FAMS.panFam]);
// Size [base radius, spread] (rect half-width; court/track near true field size)

// Green seasonal tint (material color multiplied over texture)
const SEASON_TINT = { spring: 0xeaffe0, summer: 0xffffff, autumn: 0xffd9a8, winter: 0xdfe8ea };

// Seeded geometry prototypes; placements select a variant without consuming scene RNG.
const DETAIL_VARIANTS = createGroundParts();
const DETAIL_DEFS = Object.fromEntries(Object.entries(DETAIL_VARIANTS).map(([key, variants]) => [key, variants.flat()]));

// Max random tilt per kind (rad; drawn per x/z axis): natural pieces lean, artificial pieces
// near-upright; plus existing random yaw ry and size jitter, same-kind instances stop copy-pasting
const TILT = {
  tuft: 0.22, rice: 0.16, reed: 0.2, bush: 0.1, sapling: 0.09, flower: 0.16, lotuspad: 0.05,
  bamboo: 0.13, snag: 0.18, charsnag: 0.18, log: 0.07, stump: 0.06, logpile: 0.05, plank: 0.08,
  fencepost: 0.14, vinerow: 0.04, ghouse: 0.03, slab: 0.22, iceshard: 0.35, rockflat: 0.3,
  saltmound: 0.06, pipe: 0.06, spoil: 0.05, barrier: 0.08, pebble: 0.4, hay: 0.07,
  boulder: 0.3, drybush: 0.18, drum: 0.07, crate: 0.06, carwreck: 0.05, car: 0, motorcycle: 0,
  solarpanel: 0, bench: 0.04, headstone: 0.1,
  miscanthus: 0.24, weed: 0.3, cabbage: 0.12, billboard: 0.04, planter: 0.05, hoop: 0.03,
  fish: 0.12, shell: 0.5, mushroom: 0.14,
};

// Per-kind 3D object tidiness 0..1 = probability that the random-yaw path becomes align to
// the nearest road (addDetail rolls via orient(); rows()/fixed-ry callers already aligned to the
// patch axis and skip this table). Artificial straight pieces (containers/panels/signs/benches/
// graves/sheds) high; natural and radially symmetric kinds always 0.
const REG = {
  tuft: 0, rice: 0, reed: 0, bush: 0, pebble: 0, hay: 0.3, sapling: 0, flower: 0, lotuspad: 0,
  bamboo: 0, snag: 0, charsnag: 0, log: 0.15, stump: 0, logpile: 0.6, plank: 0.4, cabin: 0.7,
  fencepost: 0.2, vinerow: 0.9, ghouse: 0.85, slab: 0.1, iceshard: 0, rockflat: 0, saltmound: 0,
  pipe: 0.5, spoil: 0, barrier: 0.75, canopy: 0.9, pump: 0.9, container: 0.9, carwreck: 0.45,
  car: 1.0, motorcycle: 1.0,
  solarpanel: 1.0, bench: 0.8, headstone: 0.85, boulder: 0, drybush: 0, drum: 0.2, crate: 0.5,
  miscanthus: 0, weed: 0, cabbage: 0, billboard: 0.85, planter: 0.6, hoop: 0.9,
  fish: 0, shell: 0, mushroom: 0,
};

// Rectangular-base artificial pieces: whenever the caller leaves array angle unset, always
// follow road/block grid orientation.
const RECT_BASE_DETAILS = new Set([
  'logpile', 'plank', 'cabin', 'vinerow', 'ghouse', 'pipe', 'barrier', 'canopy', 'pump',
  'container', 'carwreck', 'car', 'motorcycle', 'solarpanel', 'bench', 'headstone', 'crate', 'billboard', 'planter', 'hoop',
  'picnictable', 'tent', 'litterbin',
]);

// Ground-conforming roster: arrayed/linear pavers tilt with terrain (gravity-upright pieces like
// vehicles/containers/furniture excluded, stay upright and embedded)
const SLOPE_FIT_DETAILS = new Set(['solarpanel', 'vinerow', 'ghouse', 'pipe', 'barrier']);

// Only fixed set-pieces with readable solid volume; grass, sign flakes and step-over small
// things build no invisible walls.
const PHYSICAL_DETAILS = new Set([
  'log', 'stump', 'logpile', 'cabin', 'ghouse', 'slab', 'pipe', 'barrier',
  'canopy', 'container', 'carwreck', 'car', 'motorcycle', 'boulder', 'crate',
]);

function detailCollider(type, it) {
  const bounds = new THREE.Box3().makeEmpty();
  const partBox = new THREE.Box3();
  const actual = new THREE.Matrix4(), frame = new THREE.Matrix4(), invFrame = new THREE.Matrix4();
  const pos = new THREE.Vector3(it.x, it.y, it.z), center = new THREE.Vector3(), size = new THREE.Vector3();
  const quat = new THREE.Quaternion().setFromEuler(new THREE.Euler(it.tx || 0, it.ry, it.tz || 0));
  frame.makeRotationY(it.ry).setPosition(pos);
  invFrame.copy(frame).invert();
  for (const part of DETAIL_VARIANTS[type][it.variant ?? 0]) {
    if (!part.geo.boundingBox) part.geo.computeBoundingBox();
    actual.compose(pos, quat, new THREE.Vector3(it.s, it.s * (part.sy ?? 1) * it.sy, it.s));
    partBox.copy(part.geo.boundingBox).applyMatrix4(actual).applyMatrix4(invFrame);
    bounds.union(partBox);
  }
  if (bounds.isEmpty()) return null;
  bounds.getCenter(center).applyMatrix4(frame);
  bounds.getSize(size);
  const hw2 = size.x / 2, hd2 = size.z / 2;
  return {
    x: center.x, z: center.z, y: center.y - size.y / 2,
    h: Math.max(0.1, size.y), hw2, hd2, ry: it.ry,
    r: Math.hypot(hw2, hd2), name: `detail_${type}`,
  };
}

// Horizontal footprint radius of 3D objects (scale=1): measure real part geometry, MUST NOT
// hand-write -- once the part table changes (model swap / new part) a written value silently
// expires, and on screen that reads as two containers grown together
const _detR = new Map();
/**
 * Nominal height of one detail kind (sway-weight denominator; A39 item 5: span derived not written).
 * Same discipline as biomes.js vegSpan: changing the part table (taller plume, new sy) moves sway
 * along -- a written number would freeze tip weights below 1 after a height change, so that kind
 * stops swaying with zero error message.
 * Ground offset is baked into boundingBox (see DETAIL_DEFS header), so take max.y times sy.
 */
const _detSpan = new Map();
function detailSpan(type) {
  let s = _detSpan.get(type);
  if (s != null) return s;
  s = 0;
  for (const p of DETAIL_DEFS[type]) {
    if (!p.geo.boundingBox) p.geo.computeBoundingBox();
    s = Math.max(s, p.geo.boundingBox.max.y * (p.sy ?? 1));
  }
  s = Math.max(0.3, s);   // Denominator MUST NOT be zero (same floor as vegSpan)
  _detSpan.set(type, s);
  return s;
}

function detailR(type) {
  let r = _detR.get(type);
  if (r != null) return r;
  r = 0;
  for (const p of DETAIL_DEFS[type]) {
    p.geo.computeBoundingBox();
    const bb = p.geo.boundingBox;
    r = Math.max(r, Math.hypot(Math.max(Math.abs(bb.min.x), Math.abs(bb.max.x)),
                               Math.max(Math.abs(bb.min.z), Math.abs(bb.max.z))));
  }
  _detR.set(type, r);
  return r;
}

function bucketOf(buckets, key) {
  let b = buckets.get(key);
  if (!b) { b = { pos: [], nrm: [], uv: [], col: [], idx: [], base: 0, lnrm: [] }; buckets.set(key, b); }
  return b;
}

// ==== Ground-layer terrain normals (2026-08-13 user decision: terrain change follows LUT and ink) ====
// Every ground patch normal is (0,1,0) -- a skin draped over terrain, lighting deliberately
// ignores slope. That lie costs twice in the ink info buffer: 1. ridges and road cuts under the
// patch draw no line (normals are constant); 2. where the patch ends onto bare terrain, constant
// normals hit true normals, drawing a FALSE crease along the patch rim. So store aLandN feeding
// only gInfo (lighting untouched, see CEL_LAND_N in toon.js).
//
// Three rules:
//   1. Sample step = terrain height-grid pitch (terrain.gridM). Sampling finer stays inside one
//      bilinear face, so normals go constant per cell, differences degrade to per-cell steps, and
//      crease lines grow back into grid lines; sampling coarser smooths ridges away.
//   2. Pure function of (x,z) only => adjacent patches sharing an edge read bit-identical normals
//      (no crease exists between patches, so seam is absent rather than pressed down).
//   3. Height sampling uses the caller hAt: in-map terrain.heightAt, buffer ring
//      terrain.bufferHeightAt (wrong branch clamps the whole outer ring to in-map values).
function landNrmAt(hAt, x, z, d) {
  const s = d > 0 ? d : 1;
  const nx = (hAt(x - s, z) - hAt(x + s, z)) / (2 * s);
  const nz = (hAt(x, z - s) - hAt(x, z + s)) / (2 * s);
  const l = Math.hypot(nx, 1, nz) || 1;
  return [nx / l, 1 / l, nz / l];
}
/** The line paired with b.nrm.push(0, 1, 0) (audits compare the two counts per file) */
function pushLandN(b, hAt, x, z, d) {
  const n = landNrmAt(hAt, x, z, d);
  b.lnrm.push(n[0], n[1], n[2]);
}
// ==== Drape lift: slope breakage (2026-08-13 user report: terrain patches break on slopes) ====
// Ground cover is a skin: vertices take heightAt, so vertices always sit on terrain while edges
// between them run straight. Terrain is not -- it is a per-cell triangulated height field with a
// crease where two triangles meet. A skin edge (chord) crossing the crease sinks below terrain by
// crease times chord length over 4. Skin edges run half a cell (6.5m), terrain pitch is 8.5m, so
// almost every skin edge crosses a crease, while carpet lift is only CLIFT = 0.07m.
// 2026-08-13 taroko measurement (audit_ground_drape): 22 percent of triangles pierced by terrain,
// p90 0.057m / p99 0.446m. Flat land shows nothing (crease = 0); steeper slopes break more --
// exactly the reported on-slopes symptom.
//
// Consumers shrank to three on the same day (user decision A adopt-terrain-triangles): in-map
// carpet / spillover / ridge band now eat terrain own triangles (see emitCell header), so chord
// loss for those three layers is structurally 0; MUST NOT lift them again (re-lift = floating
// above terrain, the other half of breakage in item 4 below). Remaining consumers are feature
// patches / border puzzles / buffer-ring carpet: the first two are freely rotated standalone
// faces (snapping to terrain grid serrates edges, and they already carry slope gates), the last
// stands on the skirt with no height grid to adopt.
//
// Fix = push chord loss back per vertex: lift = max over eight directions of mid height minus
// end-point mean.
// Four rules:
//   1. MUST be a pure function of (x,z) (same as landNrmAt) -- adjacent faces sharing a vertex
//      read bit-identical values, else lifting itself tears the skin;
//   2. Flat stays 0 (crease = 0 gives loss = 0), so flat and gentle slopes stay bit-identical to
//      the old rule; this layer only acts where a real crease exists;
//   3. End-symmetric: midpoint loss of edge (v,n) computes the same from both ends, so lifting
//      both ends lands the chord midpoint exactly back on terrain (not approximately);
//   4. MUST clamp: over-lift stops being drape and becomes floating above terrain (hovering
//      cover breaks too). Three caps: ROAD inside road corridors < road lift 0.18 minus carpet
//      0.07 headroom (lifting above road = grass over tarmac); in-map MAX; buffer BUF relaxed
//      (pitch times BUF_CELL_F, 400m+ from player, nothing else stacks there, and unrelaxed means
//      30m-class holes).
const SAG = {
  MAX: 0.6,    // In-map lift cap (m)
  ROAD: 0.10,  // Inside road corridors (road lift 0.18 minus carpet CLIFT 0.07 = 0.11 headroom)
  BUF: 6,      // Buffer ring (pitch times BUF_CELL_F; uncorrected p99 10.8m / max 37.6m)
};
//   6. Size MUST be this layer own chord length (2026-08-13 user report: dirt roads, tidal
//     flats, beaches MUST NOT bulge, field bunds neither -- the root cause): lift scales with
//     chord length squared, while the old rule fed all three consumers carpet cell/2 (6.5m).
//     Border puzzle ring spacing is about 2m, bund sample spacing 3m -- feeding 6.5m of loss
//     into a 2m chord lifts ten times what it needs, pinning straight to MAX 0.6m. Back when
//     carpet also ate sag this only shifted the whole lift staircase (the header reason of one
//     field feeding every layer); since carpet/spillover/ridge adopted terrain triangles
//     (sag identically 0), that reason is gone -- borders and bunds float half a meter above
//     exactly-draped carpet as a rim, which is the reported bulge. So drapeSag takes an optional
//     r, and callers MUST pass their own chord length; omitted = carpet scale (the 7x6 feature
//     grid sits at that size, keeping the old rule).
// 5. Multi-scale: one chord loss scales with chord length times crease, and cover has more
//   than one chord length -- carpet runs half a cell (6.5m), border rings only about 2m.
//   Measuring only the longest scale misses near small bumps (2026-08-13 measurement: single
//   scale pressed carpet breakage 22.0 percent to 3.8, while border puzzles moved 29.6 to 29.5,
//   untouched). So take the max of three scales: large serves carpet, small serves narrow bands,
//   one field still monotone.
// Turning the whole layer off with sag=0 gives staged-shot and audit_ground_drape --break-sag
// before/after pairs -- same as toon.js curve=0 (only side-by-side frames show that layer).
const SAG_OFF = typeof location !== 'undefined' && /[?&]sag=0/.test(location.search);
const SAG_DIRS = [[1, 0], [-1, 0], [0, 1], [0, -1],
  [0.70711, 0.70711], [0.70711, -0.70711], [-0.70711, 0.70711], [-0.70711, -0.70711]];
// Scale vs direction-count tradeoff (2026-08-13 taroko measurement): the largest scale needs
// eight directions (skin triangulation diagonals live there), small scales manage with four axes
// -- per-vertex samples drop 48 to 32, buildBiomes 1331 to 1252ms, while three-layer breakage
// stays put (3.8 / 2.8 / 0.0 percent). The whole added cost lands at build time (buildYield yields
// frames), zero at runtime.
const SAG_SCALES = [[1, 8], [0.45, 4], [0.2, 4]];
function groundSagAt(hAt, x, z, r) {
  if (!(r > 0)) return 0;
  const h0 = hAt(x, z);
  let s = 0;
  for (const [f, nd] of SAG_SCALES) {
    const rr = r * f;
    for (let k = 0; k < nd; k++) {
      const [dx, dz] = SAG_DIRS[k];
      // Mid height minus end mean = how far this chord sinks at mid (flat stays 0, so flat
      // stays bit-identical to the old rule)
      const d = hAt(x + dx * rr * 0.5, z + dz * rr * 0.5)
        - (h0 + hAt(x + dx * rr, z + dz * rr)) * 0.5;
      if (d > s) s = d;
    }
  }
  return s;
}
/** Geometry carries aLandN (absent => material falls back to its own normal, principle 6) */
function setLandN(geo, b) {
  if (b.lnrm?.length === b.pos.length) geo.setAttribute('aLandN', new THREE.Float32BufferAttribute(b.lnrm, 3));
}

// Irregular patches. edge fade: outer alpha 0 melts into terrain; ink: outer ink vertex color
// (hand-drawn outline)
// Hand-drawn outline radius jitter range (times r): outer edge reaches (MIN+JIT) times r, not r --
// the avoid radius (tryPatch bdCross) shares this source, and using r lets 14 percent of outer
// edges press onto divider bands
const BLOB_R = { MIN: 0.72, JIT: 0.42 };
function emitBlob(b, terrain, x, z, r, lift, uvS, edge, pt, rnd, sag) {
  const n = 12;
  // Per-patch random UV rotation: same-kind textures face different ways (in-view same-kind
  // already deduped, no cross-patch print continuity needed)
  const ua = rnd() * Math.PI * 2, cu = Math.cos(ua), su = Math.sin(ua);
  const push = (vx, vz, cr, cg, cb, ca) => {
    b.pos.push(vx, terrain.heightAt(vx, vz) + lift + sag(vx, vz), vz);
    b.nrm.push(0, 1, 0);
    pushLandN(b, terrain.heightAt, vx, vz, terrain.gridM);
    b.uv.push((vx * cu - vz * su) * uvS, (vx * su + vz * cu) * uvS);
    b.col.push(cr * pt[0], cg * pt[1], cb * pt[2], ca);
  };
  const ph = rnd() * Math.PI * 2;               // Random outline start phase: same-radius blobs differ
  const angs = [], rads = [];
  for (let i = 0; i < n; i++) {
    angs.push(ph - i / n * Math.PI * 2);        // Decreasing angle faces triangles +y
    rads.push(r * (BLOB_R.MIN + rnd() * BLOB_R.JIT));   // Boundary jitter = hand-drawn outline
  }
  const eC = edge === 'fade' ? [1, 1, 1, 0] : [0.55, 0.56, 0.62, 1];
  const mR = edge === 'fade' ? 0.66 : 0.6;
  for (let i = 0; i < n; i++) push(x + Math.cos(angs[i]) * rads[i], z + Math.sin(angs[i]) * rads[i], ...eC);
  for (let i = 0; i < n; i++) push(x + Math.cos(angs[i]) * rads[i] * mR, z + Math.sin(angs[i]) * rads[i] * mR, 1, 1, 1, 1);
  push(x, z, 1, 1, 1, 1);
  const k = b.base, c = k + 2 * n;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    b.idx.push(k + i, k + j, k + n + i, k + j, k + n + j, k + n + i, k + n + i, k + n + j, c);
  }
  b.base += 2 * n + 1;
}

// ==== Farm bunds (2026-08-13 user decision: fix alignment + only bund large-enough clusters) ====
// User words: terrain patches sometimes join badly, e.g. fields not aligned; misalignment is
// acceptable if bunds separate them. Two fixes split -- alignment lives in family extension
// (neighbor sizes solved back from the shared axis); this is the bund half.
// Bunds straddle the footprint border (grow only outward by HW): two face-adjacent fields stand
// FARM_GAP = 2 x HW apart, so two bunds meet back to back on the path centerline as one continuous
// ridge; offset pairs read as the bund turning a corner, which is what terraces/paddies do. The
// outward half stays inside PATCH_GAP (1.0) and band-edge BORDER_BAND.PAD (1.6), so the no-overlap
// and no-border-crossing gates do not move.
// Three rings outward:
//   R0 = footprint edge, dy = def.rim ?? 0 -- level with the field own rim, no gap no stab;
//   R1 = bund crest outer edge, dy = max(rim, RISE);
//   R2 = straight below R1, dy = 0.
// Two bands: R0 to R1 is the crest, R1 to R2 is the outer vertical face -- without the vertical
// face, grazing angles see through a floating soil flake (same family as A44 item 3: visible
// things need thickness).
// Large-enough-only = BUND.MIN_N: one lone field ringed reads as a flower bed; only a joined
// quilt reads as farmland.
export const BUND = {
  HW: 0.6,      // Half width (m): grows outward only. FARM_GAP = 2xHW is derived, not coincidence (see above)
  // Crest height (m); fields with their own rim take the taller, so bunds always cover rims and
  // no two ridges fight.
  // 2026-08-13 user report: bunds should not bulge much: 0.30 to 0.18 (true paddy bunds are
  // ankle-high; the other half of bulge was drape lift with the wrong chord length, see SAG
  // header item 6 and the emitBund callers above)
  RISE: 0.18,
  MIN_N: 3,     // Large-enough threshold (farm patches inside one cluster)
  SEG_M: 3,     // Sample spacing along bunds (m): tracks terrain without going finer than the field own 7x6 grid
  UVS: 1 / 6,   // Crest world-projected UV scale, so rammed-earth print runs continuously across neighbors
};
export const FARM_GAP = BUND.HW * 2;   // Farm path width from family extension (two bunds meet exactly on centerline)
// Rect ring: same params differing only in half-span map index to index (inner/outer corners meet)
function bundRing(a, c, ns, nd) {
  const p = [];
  for (let i = 0; i < ns; i++) p.push([-a + 2 * a * i / ns, -c]);
  for (let i = 0; i < nd; i++) p.push([a, -c + 2 * c * i / nd]);
  for (let i = 0; i < ns; i++) p.push([a - 2 * a * i / ns, c]);
  for (let i = 0; i < nd; i++) p.push([-a, c - 2 * c * i / nd]);
  return p;
}
function emitBund(b, terrain, x, z, r, rot, def, lift, sag) {
  const hw = r, hd = r * (def.aspect || 0.7), H = BUND.HW;
  const rim = def.rim || 0, crest = Math.max(rim, BUND.RISE);
  const ns = Math.max(4, Math.round(2 * hw / BUND.SEG_M)), nd = Math.max(4, Math.round(2 * hd / BUND.SEG_M));
  const IN = bundRing(hw, hd, ns, nd), OUT = bundRing(hw + H, hd + H, ns, nd);
  const ca = Math.cos(rot), sa = Math.sin(rot);
  const world = ([lx, lz]) => [x + lx * ca - lz * sa, z + lx * sa + lz * ca];
  const L = IN.length;
  // Outer-ring cumulative arc length: vertical faces use arc-length u (top projection would
  // stretch a 0.3m face into a smeared stripe)
  const arc = new Array(L + 1).fill(0);
  for (let k = 0; k < L; k++) {
    const [ax, az] = OUT[k], [bx, bz] = OUT[(k + 1) % L];
    arc[k + 1] = arc[k] + Math.hypot(bx - ax, bz - az);
  }
  const base0 = b.base;
  // Four vertex rings: 0 bund inner edge / 1 crest outer edge / 2 vertical-face top edge (same
  // position as 1, different UV and normals) / 3 skirt base. Ring 2 exists because crests use
  // world-projected UV while vertical faces use arc-length UV; sharing vertices would stretch a
  // 0.3m face into a smeared stripe. Bands = 0 to 1 (crest) and 2 to 3 (outer vertical face).
  const RINGS = [[IN, rim, 0], [OUT, crest, 0], [OUT, crest, 1], [OUT, 0, 1]];
  RINGS.forEach(([P, dy, wall]) => {
    for (let k = 0; k < L; k++) {
      const [wx, wz] = world(P[k]);
      b.pos.push(wx, terrain.heightAt(wx, wz) + lift + dy + sag(wx, wz), wz);
      if (wall) {                                       // Outer vertical face: normals point out (creases draw lines)
        const [ox, oz] = world(OUT[k]), [ix, iz] = world(IN[k]);
        const nl = Math.hypot(ox - ix, oz - iz) || 1;
        b.nrm.push((ox - ix) / nl, 0, (oz - iz) / nl);
        b.lnrm.push((ox - ix) / nl, 0, (oz - iz) / nl);   // Ink buffer eats true face normals, so crest creases draw
        b.uv.push(arc[k] * BUND.UVS, dy > 0 ? 0 : 1);
      } else {
        // Crests follow the same rule as other ground layers: lighting uses (0,1,0) without slope
        // tilt, while the ink copy gets true terrain normals -- without the latter, ridges under
        // the bund draw nothing and the bund-field seam grows a false line (see landNrmAt header)
        b.nrm.push(0, 1, 0);
        pushLandN(b, terrain.heightAt, wx, wz, terrain.gridM);
        b.uv.push(wx * BUND.UVS, wz * BUND.UVS);
      }
      // Warm crest soil, inner edge tinted with field color (meets the field rim), skirt base darkened
      const s = P === IN ? 0.88 : wall && dy === 0 ? 0.72 : 1;
      b.col.push(0.78 * s, 0.66 * s, 0.5 * s, 1);
    }
  });
  for (const A of [base0, base0 + 2 * L]) {             // 0 to 1 crest, 2 to 3 vertical face
    const B = A + L;
    for (let k = 0; k < L; k++) {
      const k2 = (k + 1) % L;
      // Same winding convention as emitRect (a, f, e): (p0, p0+along-ring, p0+outward/down) gives
      // crest facing +y and faces pointing out
      b.idx.push(A + k, A + k2, B + k, A + k2, B + k2, B + k);
    }
  }
  b.base += 4 * L;
}

// Rect fields/courts: 6x7 draped grid; rim = raised outer bund (warm soil vertex color), else outer ink line
function emitRect(b, terrain, x, z, r, rot, def, lift, pt, flipU, flipV, rnd, sag) {
  const w = r * 2, d = r * 2 * (def.aspect || 0.7);
  const step = Math.min(2, terrain.gridM || 2);
  const nx = Math.max(7, Math.ceil(w / step) + 1), nz = Math.max(6, Math.ceil(d / step) + 1);
  const ca = Math.cos(rot), sa = Math.sin(rot);
  for (let j = 0; j < nz; j++) {
    for (let i = 0; i < nx; i++) {
      const lx = (i / (nx - 1) - 0.5) * w, lz = (j / (nz - 1) - 0.5) * d;
      const vx = x + lx * ca - lz * sa, vz = z + lx * sa + lz * ca;
      const edge = i === 0 || j === 0 || i === nx - 1 || j === nz - 1;
      let dy = 0, cr = 1, cg = 1, cb = 1;
      if (edge) {
        if (def.rim) { dy = def.rim; cr = 0.78; cg = 0.66; cb = 0.5; }
        else { cr = 0.6; cg = 0.6; cb = 0.64; }
      }
      b.pos.push(vx, terrain.heightAt(vx, vz) + lift + dy + sag(vx, vz), vz);
      b.nrm.push(0, 1, 0);
      pushLandN(b, terrain.heightAt, vx, vz, terrain.gridM);
      if (def.uv === 'fit') {
        const u = i / (nx - 1), v = j / (nz - 1);
        b.uv.push(flipU ? 1 - u : u, flipV ? 1 - v : v);   // Random dual-axis mirror: four orientations per court variant
      } else b.uv.push(vx * def.uvS, vz * def.uvS);
      b.col.push(cr * pt[0], cg * pt[1], cb * pt[2], 1);
    }
  }
  for (let j = 0; j < nz - 1; j++) {
    for (let i = 0; i < nx - 1; i++) {
      const a = b.base + j * nx + i, e = a + 1, f = a + nx, g = f + 1;
      b.idx.push(a, f, e, e, f, g);
    }
  }
  b.base += nx * nz;
  void rnd;
}

// ==== Carpet picking blocks: minimum color scale inside one zone (2026-08-12 user request) ====
// User words: patches sometimes flip green-red-gray suddenly; within one type (urban/green/bare/
//   water/wet), avoid fast short-range color jumps as much as possible.
// Lesion: picking maps low-frequency noise t to roster index per cell, while one roster holds
// 10-12 kinds with t gradients sweeping several indices within a dozen meters on steep noise
// slopes, so walking that band reads turf to flowerfield to deadwood (green-red-gray). Every cell
// follows the rule, and no existing assertion can see the problem.
// New rule: move the sampling point to blocks (lots) -- jittered-grid nearest-point split
// (jittered-Voronoi / Worley); every cell in one lot takes t at the lot center, so colors inside
// one zone change at most once per lot.
// Four rules:
//   1. Pure function (coordinate hash, zero rnd / zero Math.random, 2.3): bit-identical across
//      clients, and placed anywhere in the build flow it never shifts vegetation layout;
//   2. Acts only inside its zone -- zones (green/bare/urban/wet/water/alpine) still resolve per
//      cell from imagery/slope/envCode; a lot only picks which kind inside that cell own roster,
//      so true terrain borders do not move by one cell (border puzzles and spillover eat the same
//      zoneGrid);
//   3. Jitter MUST stay under 0.5 pitch: beyond that the nearest lot center can fall outside the
//      3x3 candidates, opening holes where two middle cells claim different lots, reading on
//      screen as an occasional single-cell color jump;
//   4. Spacing counts in carpet cells, so retuning cell (derived per map size) carries it along;
//      MUST NOT hand-write meters.
// 2026-08-13 user follow-up (same type should not jump sub-kinds at short range) gets three
// coordinated fixes, each curing half the lesion; MUST NOT ship only one:
//   (a) Swap frequency: lots 6 to 9 cells (78m to 117m) plus doubled picking-field wavelength
//   (CARPET_SEL);
//   (b) Swap amplitude: rosters become color paths (carpetOrder), so index adjacency = color
//   adjacency;
//   (c) Remaining structurally unavoidable jumps (distance over CARPET_DE.LINE, e.g. snowline
//      icefield vs steppe 253) draw that zone own divider (borderKindOf same-zone branch) --
//      once covered, the jump reads as two genuinely different grounds meeting.
export const CARPET_LOT = { CELLS: 9, JIT: 0.42 };
// Picking-field sampling (single seam; cellSubAt and the audit control eat the same -- hand-copy
// one frequency into the audit and that section measures a dead old rule after a retune).
// W/QC_W = wave numbers (1/m); SPAN/QC_A = range and quasi-crystal term weight. The two terms
// scale differently (vnoise is unit-pitch value noise, so feature scale = 1/W; quasi-crystal is a
// plane-wave sum, so wavelength = 2 pi / QC_W): W 0.006 to 0.0032 means 167m to 313m, QC_W 0.035
// to 0.018 means 180m to 349m. Both MUST grow together -- growing only one leaves the other as
// the new shortest swap scale while the screen looks unimproved.
// SPAN 2.2 to 1.4 is the one box this round MUST move: vnoise marginals are bell-shaped (measured
// p05 0.148 / p95 0.851, not uniform), so times 2.2 the effective window is only 0.273 to 0.727,
// trapping 30 percent of samples at the ends, with each end slot taking about 20 percent and each
// middle cell only 4-5 percent (8 seeds x 90000 cells). Once rosters become color paths, the ends
// are the two color extremes -- meaning 40 percent of every zone frame would be its own most
// extreme colors, half of the reported abruptness; and cutting brick usage hard is impossible under
// the old rule (brick is the farthest hue on the urban roster, so it always lands on an end, always
// takes 20 percent, no weight count helps). 1.4 is the measured value whose per-slot shares track
// declared weights closest (length 10: 7.6-11.9 vs declared 10 percent; length 15: 4.1-8.6 vs 6.7;
// 2.2 gives 6.2-22.5, 1.0 flips to middle 16.8 / ends 2.1).
export const CARPET_SEL = { W: 0.0032, SPAN: 1.4, QC_W: 0.018, QC_A: 0.30 };
// Sharp-color-jump gate (redmean distance; 2026-08-13 user decision: sharp jumps get that zone
// own divider). Measured on sorted-roster adjacent steps: p50 49 / p90 134 / max 253, so 100
// catches exactly the structurally unavoidable jumps: snowline icefield vs steppe 253, cracked
// earth vs mud 157, brick vs pavement 137, concrete vs park 127, deadwood vs gravel 134,
// lawn vs pavement 114, sand vs steppe 103. Lower cuts green fields into nets (the 2026-08-11
// no-lines-inside-same-zone lesion), higher leaves only the snowline. Same-zone lines trigger on
// color distance only; surface-level overrides (BORDER_SUB_RULES) still act cross-zone only.
export const CARPET_DE = { LINE: 100 };
// Returns [li, lj, ci, cj]: lot index + lot center (cell-index space; callers convert to world
// coords for sampling)
export function carpetLotAt(i, j, seed, cells = CARPET_LOT.CELLS, jit = CARPET_LOT.JIT) {
  const S = Math.max(1, cells);
  const gi = Math.floor(i / S), gj = Math.floor(j / S);
  let best = null, bd = Infinity;
  for (let oj = -1; oj <= 1; oj++) {
    for (let oi = -1; oi <= 1; oi++) {
      const li = gi + oi, lj = gj + oj;
      // vnoise on integer coords = pure hash (bilinear fx/fz are 0), no second hash needed
      const ci = (li + 0.5 + (vnoise(li, lj, (seed ^ 0x1F3A) | 0) - 0.5) * 2 * jit) * S;
      const cj = (lj + 0.5 + (vnoise(li, lj, (seed ^ 0x77C1) | 0) - 0.5) * 2 * jit) * S;
      const dx = ci - (i + 0.5), dz = cj - (j + 0.5);
      const d = dx * dx + dz * dz;
      if (d < bd) { bd = d; best = [li, lj, ci, cj]; }
    }
  }
  return best;
}

// ==== Carpet print: same-color neighbors draw different prints (2026-08-12 user request) ====
// User words: same-color patches can carry different prints/motifs/sprinkles, and same-color
//   neighbors should differ whenever possible.
// Old variants were low-frequency noise (wavelength about 400m), so whole meadows wore one texture
// with only mirrored tiling and wash against repeat; the new rule picks per cell with a hard rule
// of edge-adjacent same-kind neighbors always differing (scan order: decided left/upper two cells)
// and a soft rule of diagonals differing too (3 variants x 8 neighbors cannot all differ -- four
// cells of a 2x2 block are pairwise adjacent and need 4 colors; the user words say best effort).
// Three deliberate designs:
//   1. Pure function (scan-order greedy, zero rnd, 2.3) -- determinism = agreement across clients;
//   2. Constraints bind only within one kind (other kinds are already different textures, no need
//      for another variant);
//   3. Same-kind different-variant emits no border spillover (see planSeamOverlays): variants share
//      the base (baseFill), borders swap prints with no color to cross-fade; and since carpet swaps
//      variants per cell, emitting spillover for it paves two more translucent carpets over the map
//      (about 2 per cell) of pure overdraw.
export function planCarpetVariants(subs, gnx, gnz, { seed = 0, variants = 3 } = {}) {
  const out = new Array(gnx * gnz).fill(0);
  const at = (i, j) => (i < 0 || j < 0 || i >= gnx || j >= gnz) ? null : subs[j * gnx + i];
  const V = Math.max(1, variants);
  for (let j = 0; j < gnz; j++) {
    for (let i = 0; i < gnx; i++) {
      const s = subs[j * gnx + i];
      if (s == null || s === '!') continue;
      const hard = [], soft = [];                       // Decided neighbors: shared-edge (hard) / diagonal (soft)
      const look = (di, dj, arr) => {
        if (at(i + di, j + dj) === s) arr.push(out[(j + dj) * gnx + i + di]);
      };
      look(-1, 0, hard); look(0, -1, hard);
      look(-1, -1, soft); look(1, -1, soft);
      const v0 = ((vnoise(i, j, (seed ^ 0x3C7B) | 0) * V) | 0) % V;   // Start from per-cell hash, so picks never stripe
      let best = -1, ok = -1;
      for (let k = 0; k < V; k++) {
        const v = (v0 + k) % V;
        if (hard.includes(v)) continue;
        if (ok < 0) ok = v;                             // First hard-passing pick (fallback)
        if (!soft.includes(v)) { best = v; break; }     // Diagonal-different too = best
      }
      out[j * gnx + i] = best >= 0 ? best : (ok >= 0 ? ok : v0);
    }
  }
  return out;
}

// ==== Cross-zone spillover config (2026-07-29 border-aliasing rework; single seam, audits run source) ====
// Old rule = whole-cell one-way spillover: the kA<kB side pastes the whole cell into four-neighbors
// (shared edge alpha 1 to far edge 0). Its two structural lesions are the reported unnatural
// jagged borders between terrain types:
//   1. Border outlines quantized onto 13m cell edges turn diagonal borders into 90-degree stair jags
//      (corner jitter only twists each run, never removes the stairs); 2. diagonal neighbors get no
//      fade at all, so every stair corner keeps a hard notch, sharpening the jags (two spillovers
//      stacked in one cell also eat each other in depth).
// New rule = corner-membership bilinear fade (dual-grid / marching-squares vocabulary): a corner
// weight for some key = share of the four cells around that corner holding that key, denominator
// counting only carpeted cells (cliff ! and unpaved null excluded, so carpet fading to cliffs/map
// edges converges corner weights to 1 and meets opaque carpet seamlessly); each cell emits one
// alpha=corner-weight spillover cell per other-kind neighbor key (incl. diagonals). Symmetric spill
// from both sides puts the border midline exactly at 50/50 mix; the bilinear 0.5 contour shaves 90
// degree stairs into smooth diagonals, diagonal weights fill stair-corner notches; lone single
// cells (imagery classification speckle) reach corner weight 0.75 and get softly swallowed.
// Pure function (zero rnd / zero Math.random, 2.3; no THREE): takes the keys grid, returns
// [{ i, j, key, alphas, st }]; alphas match emitCell corners [P0(i,j), P1(i+1,j), P2(i+1,j+1),
// P3(i,j+1)].
//
// Per-pair border styles (added 2026-07-29, user decision: real borders are usually not blends;
// different terrain pairs own diverse borders, some crisp, some with middle transitions) --
// styles look up coarse-zone unordered pairs (SEAM_STYLES; miss goes SEAM_SOFT gentle fade), four modes:
//   sharp  Crisp artificial border: transition pinched by sharp, noise pressed down -- urban vs any
//          zone switches at curb/wall-foot straight lines, not gradients (urban-vs-urban paving cuts
//          straightest); the low-wall/fence cover layer gates the same group.
//   soft   Gentle fade (default): same-zone different-kind (turf vs flower field) and the rest keep
//          bilinear + fractal noise.
//   dither Patchy transition: snowline/highland borders are neither gradients nor straight lines but
//          remnant-snow/scree patches -- the band pushes alpha toward quasi-crystal 0/1 patches
//          (endpoints pinned, see seamAlpha).
//   mid    Middle transition: a border ridge band (4 times own times neighbor weight, peaking exactly
//          on the 50/50 mix line) lays a third surface -- green-vs-bare sandwiches steppe, green or
//          water vs wet sandwiches marsh, bare-vs-wet sandwiches mud; intermittent by low-frequency
//          value noise (midP coverage, peak width about 65m) -- real transition bands come and go,
//          paving the whole line reads fake.
// Three watertight invariants (audit V): 1. ridge bands use the two-key weight product, not one-sided
// w(1-w) -- only then both sides of a three-zone meeting compute the same; 2. intermittence gate
// gateAt eats corner coords, not cell indices -- per-cell gates cut new hard seams at cell edges;
// 3. style endpoints pinned (alpha 0 to 0, 1 to 1, see seamAlpha) -- band ends meet opaque carpet.
export const SEAM_STYLES = {
  // -- Crisp (artificial) borders --
  'green|urban':  { sharp: 3.2, noise: 0.12 },
  'bare|urban':   { sharp: 3.2, noise: 0.12 },
  'urban|wet':    { sharp: 3.2, noise: 0.12 },
  'alpine|urban': { sharp: 3.2, noise: 0.12 },
  'urban|urban':  { sharp: 3.6, noise: 0.06 },
  'urban|water':  { sharp: 3.2, noise: 0.10 },   // Docks/embankments: hard shoreline
  // -- Ecotone bands: wide fade + heavy noise + intermittent middle mode --
  'bare|green':   { noise: 0.5,  mid: 'steppe', midP: 0.55 },
  'green|wet':    { noise: 0.45, mid: 'marsh',  midP: 0.7 },
  'bare|wet':     { noise: 0.45, mid: 'mud',    midP: 0.6 },
  'green|water':  { noise: 0.45, mid: 'marsh',  midP: 0.45 },   // Natural banks with sparse reed fringe (foam lives in buildWaterEdges)
  'water|wet':    { noise: 0.45, mid: 'marsh',  midP: 0.6 },
  // -- Snowline/highland borders: patchy --
  'alpine|bare':  { dither: 1 },
  'alpine|green': { dither: 1 },
};
export const SEAM_SOFT = { noise: 0.4 };   // Default: gentle fade (same-zone kinds plus the rest)

// Border-vertex alpha shaping (pure function; emitCell calls per spillover vertex, audits test directly):
// q = quasi-crystal field in [-1,1]. Endpoints pinned: a=0 to 0, a=1 to 1 (all styles), so opaque
// carpet stays watertight.
export function seamAlpha(a, q, st) {
  if (a <= 0) return 0;
  if (a >= 1) return 1;
  const s = st || SEAM_SOFT;
  if (s.sharp) a = Math.min(1, Math.max(0, (a - 0.5) * s.sharp + 0.5));
  const band = a * (1 - a) * 4;                 // Transition envelope: zero at endpoints
  if (band <= 0) return a;
  if (s.dither) {                               // Patchy: push alpha inside the band toward field 0/1 patches, ends pinned
    const f = Math.min(1, Math.max(0, (a + q * 0.5 - 0.5) * 3 + 0.5));
    return a * (1 - band) + f * band;
  }
  return Math.min(1, Math.max(0, a + q * (s.noise ?? 0.4) * band));
}

// hardOf(k0, kn, i, j, ni, nj): does this pair draw a divider (injected by caller; the rule
// still lives only in borderKindOf). True means 1. spillover switches to the borderCutAlpha cut
// line (overlay carries cut, see emitCell) and 2. the middle-transition ridge band stays out:
// that third terrain straddling the border is exactly half of the reported borders-not-separating
// failure.
export function planSeamOverlays(keys, gnx, gnz, opts = {}) {
  const { coarseOf = null, seed = 0, variants = 6, hardOf = null } = opts;
  const keyAt = (i, j) => (i < 0 || j < 0 || i >= gnx || j >= gnz) ? null : keys[j * gnx + i];
  const solid = (k) => k != null && k !== '!';          // Only carpeted cells count for membership denominators/spillover sources
  // Same-kind different-variant emits no spillover (2026-08-12): variants share the base
  // (baseFill), so borders swap prints with no color to cross-fade; and since carpet picks variants
  // per cell (planCarpetVariants), emitting spillover for it paves two more translucent carpets
  // over the map (about 2 per cell). Membership denominators unaffected (solid still counts).
  const subOf = (k) => { const p = k.indexOf('#'); return p < 0 ? k : k.slice(0, p); };
  const zoneOf = (k) => (coarseOf && k != null && k !== '!') ? coarseOf(k) : null;
  const styleOf = (za, zb) => {                         // Zone unordered pair to style (miss/unknown zone goes gentle)
    if (!za || !zb) return SEAM_SOFT;
    return SEAM_STYLES[za < zb ? `${za}|${zb}` : `${zb}|${za}`] || SEAM_SOFT;
  };
  const hash01 = (i, j, s) => {
    let n = (Math.imul(i | 0, 374761393) ^ Math.imul(j | 0, 668265263) ^ Math.imul(s | 0, 2246822519) ^ seed) | 0;
    n = Math.imul(n ^ (n >>> 13), 1274126177);
    return ((n ^ (n >>> 16)) >>> 0) / 4294967296;
  };
  const vn01 = (x, z, s) => {                           // Smooth value noise (bilinear; for the intermittence gate, pure)}
    const xi = Math.floor(x), zi = Math.floor(z);
    let fx = x - xi, fz = z - zi;
    fx = fx * fx * (3 - 2 * fx); fz = fz * fz * (3 - 2 * fz);
    return (hash01(xi, zi, s) * (1 - fx) + hash01(xi + 1, zi, s) * fx) * (1 - fz)
         + (hash01(xi, zi + 1, s) * (1 - fx) + hash01(xi + 1, zi + 1, s) * fx) * fz;
  };
  // Middle-mode intermittence gate: eats corner coords (per-corner pure function, so adjacent
  // ridge cells sharing a corner agree, watertight); wavelength 5 cells is about 65m, midP is the
  // expected coverage, and the 0.18 soft shoulder tapers band heads/tails instead of hard cuts
  const gateAt = (ci, cj, p) => Math.min(1, Math.max(0, (p - vn01(ci / 5, cj / 5, 0x51AB)) / 0.18));
  const cornerW = (k, ci, cj) => {                      // Corner (ci,cj) is ringed by the four cells (ci-1..ci, cj-1..cj)
    let n = 0, valid = 0;
    for (const [oi, oj] of [[-1, -1], [0, -1], [-1, 0], [0, 0]]) {
      const kk = keyAt(ci + oi, cj + oj);
      if (solid(kk)) { valid++; if (kk === k) n++; }
    }
    return valid ? n / valid : 0;
  };
  const midVar = (sub) => {                             // Ridge-band variant: one fixed kind per map per mode -- without
    let h = seed | 0;                                   // crossfade, per-cell/per-zone swaps cut swap seams on band peaks
    for (let c = 0; c < sub.length; c++) h = (Math.imul(h, 31) + sub.charCodeAt(c)) | 0;
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    return ((h ^ (h >>> 16)) >>> 0) % variants;
  };
  const out = [];
  for (let j = 0; j < gnz; j++) {
    for (let i = 0; i < gnx; i++) {
      const k0 = keyAt(i, j);
      if (k0 == null) continue;                        // Unpaved cells (water-gray bands/shorelines) stay empty, collect no spillover
      const z0 = zoneOf(k0);
      const seen = new Set(), seenMid = new Set();     // Cliff cells collect spillover (fade into cliffs) but emit none
      const cs = [[i, j], [i + 1, j], [i + 1, j + 1], [i, j + 1]];
      for (let oj = -1; oj <= 1; oj++) {
        for (let oi = -1; oi <= 1; oi++) {
          if (!oi && !oj) continue;
          const kn = keyAt(i + oi, j + oj);
          if (!solid(kn) || kn === k0 || seen.has(kn)) continue;
          seen.add(kn);
          if (subOf(kn) === subOf(k0)) continue;       // Print-only swap over a shared base has nothing to cross-fade
          const st = styleOf(z0, zoneOf(kn));
          const hard = hardOf ? !!hardOf(k0, kn, i, j, i + oi, j + oj) : false;
          const alphas = [cornerW(kn, i, j), cornerW(kn, i + 1, j),
                          cornerW(kn, i + 1, j + 1), cornerW(kn, i, j + 1)];
          // cut = neighbor-cell direction (cell-index delta, direction only): consumers use it to
          // tell which side of the divider belongs to the neighbor. Direction, not the neighbor
          // center: a straightened chord can cross mid-cell, and comparing points would flip whole
          // cells.
          if (alphas[0] || alphas[1] || alphas[2] || alphas[3]) {
            out.push({ i, j, key: kn, alphas, st, cut: hard ? { di: oi, dj: oj } : null });
          }
          // Middle transition: ridge band from the two-key weight product (peaks on the 50/50 mix
          // line to cover leftover seams), intermittent
          if (st.mid && z0 && !hard && !seenMid.has(st.mid)) {
            const bandAl = [0, 0, 0, 0];
            let mx = 0;
            for (let c = 0; c < 4; c++) {
              const wS = cornerW(k0, cs[c][0], cs[c][1]);
              const wF = alphas[c];
              bandAl[c] = 4 * wS * wF * gateAt(cs[c][0], cs[c][1], st.midP ?? 0.5);
              if (bandAl[c] > mx) mx = bandAl[c];
            }
            if (mx > 0.03) {
              seenMid.add(st.mid);
              out.push({ i, j, key: `${st.mid}#${midVar(st.mid)}`, alphas: bandAl, st: { band: 1 } });
            }
          }
        }
      }
    }
  }
  return out;
}

// ==== Multi-level terrain: small-in-large area styles (2026-07-29 user request) ====
// Small areas inside large ones wear the host look: same coarse zone reads differently by host --
//   small green inside urban = parks/gardens, small water = park ponds/detention ponds, small bare =
//   construction sites; small urban inside green = farm markets/hamlets, small water = natural
//   lakes/landslide lakes; small green inside bare = oases, small urban = towns ... looked up per
//   inner@outer pair (ENCLAVE_STYLES); miss keeps the home zone roster.
// planEnclaves = the single enclosure seam (pure function: zero rnd / zero Math.random / zero
// THREE, 2.3; audit tools/audit_ground_enclave.mjs runs the source): 4-neighbor connected
// components over the coarse zone grid; components with area within MIN_CELLS..MAX_CELLS whose
// solid-neighbor border share of one outer zone reaches OUTER_MIN count as enclosed small areas,
// and the whole component is tagged inner@outer. Three deliberate designs:
//   1. Cliff ! and unpaved null do not count in border denominators -- ringed by cliffs is not
//      enclosed by anyone (all-cliff border = untagged);
//   2. Components over MAX_CELLS are still fully walked (marked seen) but untagged -- large areas
//      keep their look with no rescan;
//   3. Insufficiently single outer zone (< OUTER_MIN) untagged -- border-serration lobes are not
//      enclosure;
//   4. Map-edge-touching untagged -- edge zones run off-map with unknown extent, so not enclosed
//      (section 4: omit rather than err; also blocks donut holes self-tagging: a ring whose outer
//      edge touches the map border is dropped directly).
// All consumers live in buildGroundCover (style table = single truth; MUST NOT hard-code a second
// combo table at consumers): carpet cellKeyAt swaps carpet rosters, feature main scatter and street
// arrays swap feat pools, tryPatch zone gates admit style surfaces only inside enclave cells (never
// leaking out), watertile details swap aquatic sprinkles by det (pond lotus / natural-lake reed
// banks / desert springs). Presentation only: no collision/raycast/server changes.
export const ENCLAVE = { MAX_CELLS: 160, MIN_CELLS: 2, OUTER_MIN: 0.6 };
// carpet = carpet roster (duplicates = weight; subs MUST sit in the CARPET/ZONES union so coarse
// lookup finds them)
// feats = feature puzzle pool (subs MUST sit in DEFS with SIZE); det = water sprinkle mode (watertile branch)
export const ENCLAVE_STYLES = {
  // -- Small other-kind pockets inside urban --
  'green@urban': { name: '公園/私人庭園',
    carpet: ['park', 'lawn', 'park', 'flowerfield', 'turf', 'lawn'],
    feats:  ['park', 'flowerfield', 'park', 'veggiefield'] },
  'bare@urban':  { name: '待建工地',
    carpet: ['gravel', 'mud', 'gravel', 'crackedearth'],
    feats:  ['construction', 'scrapyard', 'construction', 'containeryard'] },
  'wet@urban':   { name: '公園荷塘/滯洪池畔',
    carpet: ['lotus', 'marsh', 'lotus'],
    feats:  ['lotus', 'park'] },
  'water@urban': { name: '公園埤塘/滯洪池', det: 'pond' },
  // -- Inside green --
  'urban@green': { name: '農村市集/村落',
    // brick diluted 2/4 to 1/9 (town/hamlet enclaves concentrate urban carpet most -- kyoto
    // measurement: undiluted, brick still took 21 percent of map carpet while CARPET.urban had
    // long dropped to 7 percent)
    carpet: ['pavement', 'lawn', 'pavement', 'pavement', 'lawn', 'pavement', 'pavement', 'lawn', 'brick'],
    feats:  ['plaza', 'veggiefield', 'greenhouse', 'gasstation'] },
  'bare@green':  { name: '廢耕地/伐採跡地',
    carpet: ['crackedearth', 'gravel', 'wild'],
    feats:  ['abandonedfarm', 'clearcut', 'quarry', 'abandonedfarm'] },
  'water@green': { name: '天然湖泊/堰塞湖', det: 'lake' },
  'wet@green':   { name: '天然湖沼',
    carpet: ['marsh', 'lotus', 'marsh'],
    feats:  ['marsh', 'lotus'] },
  // -- Inside bare --
  'green@bare':  { name: '綠洲',
    carpet: ['turf', 'bushfield', 'flowerfield', 'turf'],
    feats:  ['orchard', 'bushfield', 'flowerfield'] },
  'urban@bare':  { name: '小鎮/驛站聚落',
    carpet: ['pavement', 'pavement', 'pavement', 'pavement', 'pavement', 'pavement',
             'pavement', 'concrete', 'brick'],
    feats:  ['gasstation', 'parking', 'plaza', 'scrapyard'] },
  'water@bare':  { name: '荒漠湧泉/鹹水湖', det: 'spring' },
  'wet@bare':    { name: '鹽沼窪地',
    carpet: ['marsh', 'marsh'],
    feats:  ['saltpan', 'marsh'] },
  // -- Inside wet --
  'green@wet':   { name: '沙洲草澤島',
    carpet: ['meadow', 'turf', 'bushfield'],
    feats:  ['bushfield', 'flowerfield'] },
  'urban@wet':   { name: '漁村埠頭',
    carpet: ['pavement', 'pavement', 'pavement', 'pavement', 'lawn', 'pavement', 'pavement', 'brick'],
    feats:  ['fishpond', 'plaza'] },
  // -- Highland-related (alpine triggers on relative height; lone peaks/meadow enclaves form naturally) --
  'green@alpine': { name: '高山草甸',
    carpet: ['steppe', 'meadow', 'steppe', 'turf'],
    feats:  ['steppe', 'flowerfield'] },
  'alpine@green': { name: '孤峰岩場',
    carpet: ['scree', 'plateau', 'scree'],
    feats:  ['slabruin', 'quarry'] },
};
export function planEnclaves(zones, gnx, gnz, opts = {}) {
  const { styles = ENCLAVE_STYLES, maxCells = ENCLAVE.MAX_CELLS,
          minCells = ENCLAVE.MIN_CELLS, outerMin = ENCLAVE.OUTER_MIN } = opts;
  const solid = (z) => z != null && z !== '!';
  const out = new Array(gnx * gnz).fill(null);
  const seen = new Uint8Array(gnx * gnz);
  for (let j0 = 0; j0 < gnz; j0++) {
    for (let i0 = 0; i0 < gnx; i0++) {
      const idx0 = j0 * gnx + i0;
      if (seen[idx0]) continue;
      seen[idx0] = 1;
      const zn = zones[idx0];
      if (!solid(zn)) continue;
      // 4-neighbor connected component (BFS); border counts = one vote per solid other-kind
      // edge segment on the component perimeter (perimeter-weighted)
      const comp = [idx0];
      const border = Object.create(null);
      let nb = 0, edge = false;
      for (let q = 0; q < comp.length; q++) {
        const idx = comp[q], ci = idx % gnx, cj = (idx / gnx) | 0;
        if (ci === 0 || cj === 0 || ci === gnx - 1 || cj === gnz - 1) edge = true;
        for (const [oi, oj] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          const ni = ci + oi, nj = cj + oj;
          if (ni < 0 || nj < 0 || ni >= gnx || nj >= gnz) continue;
          const nidx = nj * gnx + ni, znb = zones[nidx];
          if (znb === zn) {
            if (!seen[nidx]) { seen[nidx] = 1; comp.push(nidx); }
          } else if (solid(znb)) { border[znb] = (border[znb] || 0) + 1; nb++; }
        }
      }
      if (edge || comp.length < minCells || comp.length > maxCells || !nb) continue;
      let outer = null, bestN = 0;
      for (const z in border) if (border[z] > bestN) { bestN = border[z]; outer = z; }
      if (bestN < nb * outerMin) continue;   // Outer not single enough = serration lobe, not enclosure
      const key = `${zn}@${outer}`;
      if (!styles[key]) continue;            // Unknown combo = keep home zone look
      for (const idx of comp) out[idx] = key;
    }
  }
  return out;
}

// ==== Terrain border puzzle (2026-08-11 user request) ====
// Borders between large terrain blocks use 16-direction straight/turn/fork pieces joined as type
//   boundaries (Carcassonne-like); border puzzles use trail/forest-road/gravel-path/field-ridge/
//   ditch/stream/fence/hedgerow/beach/rocks/mangrove natural or artificial dividers as dedicated
//   prints, and different divider kinds can relay-link.
// Layers (single seam = this block; audit tools/audit_ground_border.mjs runs the source with
// built-in controls):
//   Catalog BORDER_KINDS -- 11 divider kinds (flat ground texture band / ridge solid trapezoid
//   spine, or both);
//   Styles BORDER_STYLES (coarse-zone unordered pair to kind; miss = skip, omit rather than err) +
//        BORDER_SUB_RULES (surface-level override: bamboo/deadwood to forest road, flower field
//        to field ridge, sand to beach); resolution lives only in borderKindOf, consumers MUST NOT
//        write a second table;
//   Plan planBorderPuzzle -- pure function (zero rnd / zero Math.random / zero THREE, 2.3):
//     1. Collect boundary edges between adjacent solid cells differing in surface (sub) on the
//        carpet keys grid (same-surface different-variant prints are already continuous, not a
//        border; cliff ! and unpaved null form none), resolving kind per edge (kind-less edges
//        dropped);
//     2. Edges join at shared corners into a graph; corners of degree != 2 are chain ends/forks,
//        graph walked into chains (incl. loops);
//     3. 16-direction quantization (BORDER_DIRS): greedily merge straights inside chains -- skipped
//        corners join only if their distance to the chord stays within driftMax; cut points always
//        come from original shared corners (endpoint anchoring gives zero-gap chain/fork joins;
//        joining outranks chord-angles-hitting-cell-centers -- chord bearing vs bin center error is
//        bounded by round to half a bin, 11.25 deg);
//     4. Tiles emit x0,z0,x1,z1, bin, kind, turn, drift: a bin change between neighbors = a turn;
//        kinds resolve per edge and relay as neighbors change inside one chain (cut points shared);
//        corners of degree >= 3 enter forks (fork puzzles where divider kinds meet and relay).
// Emission (consumers inside buildGroundCover) only draws; presentation-only: no collision, no
// outline, no raycast (principle 4; open ground stays walkable).
export const BORDER_DIRS = 16;   // Puzzle direction count (22.5 deg per bin; same vocabulary as road 16-dir)
// flat = ground texture band (w width in m, tex painter key to BORDER_PAINTERS) / ridge =
// trapezoid spine (w base width / wt top width / h height / jit top-height jitter ratio / color,
// foliage = seasonal leaf color); aq = water-adjacent kind (may sit below the waterline with
// vertices clamped above water).
// Every kind MUST carry flat (2026-08-11 user decision: dividers can be thicker with finer art):
// the ground band is the border itself -- it does three jobs at once: 1. reads as a patterned
// border (a pure spine is one thin rod, reading from afar as a meaningless line) 2. covers the
// true border skipped when the 13m carpet grid is straightened (driftMax in planBorderPuzzle)
// 3. both terrains hand off under it (borderCut switches exactly below).
// Solid spines are now ornaments on bands (field-ridge soil, fence posts, hedges, rocks), never
// borders alone.
//
// form = whether the thing is continuous or discrete in reality (2026-08-13 user reports: fences
// should read as wooden fences not plain dirt walls; dirt roads, tidal flats, beaches should not
// bulge, and so on). The old rule had one spine = a continuous trapezoid swept along the center
// line, right for field ridges and hedges (they are continuous banks/walls), but fences, rocks and
// mangroves became uniform solid walls out of post rows, fallen rocks and prop-root clusters --
// paint them earthier and they read as plain dirt walls. Three forms:
//   (none) Continuous trapezoid (field ridges, hedges) -- bit-identical to the old rule;
//   posts  Posts + rails (wooden fence): posts always land on both ends (n = round(len/pitch),
//          i/n), so neighbors and corners share end posts with no doubled posts at seams; rails run
//          between posts, and rail.y is the share of full height;
//   clumps Discrete clumps (rocks, mangrove prop-root clusters): one per pitch, size/height/lateral
//          offset jittered by ehash.
// Discrete pieces always sit LOWER than the old continuous spine -- the user asked to tell what it
// is, not to be blocked by it.
export const BORDER_KINDS = {
  trail:      { name: '步道小徑', flat: { w: 4.2, tex: 'trail' } },
  forestroad: { name: '林道',     flat: { w: 6.0, tex: 'forestroad' } },
  gravelpath: { name: '碎石土徑', flat: { w: 5.0, tex: 'gravelpath' } },
  fieldridge: { name: '田埂',     flat: { w: 4.2, tex: 'fieldpath' },
                // 0.32 to 0.18: same decision as BUND.RISE (bunds should not bulge much)
                ridge: { w: 0.85, wt: 0.5, h: 0.18, jit: 0.18, color: 0x87704a } },
  ditch:      { name: '水溝',     flat: { w: 4.2, tex: 'ditch' } },
  stream:     { name: '小溪',     flat: { w: 5.4, tex: 'stream' } },
  // Wooden fence: posts every 2.4m (true pasture fence spacing), 0.14 posts with two rails
  // at 40 and 76 percent height. Color shifted to sun-dried wood (the deep-soil 0x6b5138 tone is
  // half of the dirt-wall read)
  fence:      { name: '圍籬',     flat: { w: 4.2, tex: 'fenceline' },
                ridge: { form: 'posts', w: 0.14, wt: 0.14, h: 1.15, jit: 0.10, color: 0x9c7a4c,
                         pitch: 2.4, pw: 0.14, rail: { y: [0.40, 0.76], h: 0.18, t: 0.07 } } },
  hedgerow:   { name: '灌木矮牆', flat: { w: 4.4, tex: 'hedgebank' },
                ridge: { w: 1.15, wt: 0.72, h: 1.4, jit: 0.55, color: 'foliage' } },
  beach:      { name: '沙灘',     flat: { w: 9.0, tex: 'beach', wet: 1 }, aq: 1 },
  // Mudflat transition (2026-08-13 user decision: dedicated mud transition between water and
  // marsh) -- water-vs-marsh goes here from now on; mangrove stepped back to the lotus cell (see
  // BORDER_SUB_RULES)
  mudflat:    { name: '泥灘',     flat: { w: 8.0, tex: 'mudflat', wet: 1 }, aq: 1 },
  // Rocks: a 0.7m gray wall becomes one fallen rock per 3m (height down to 0.42; detail back
  // on the rubble painter)
  rocks:      { name: '岩塊',     flat: { w: 5.2, tex: 'rubble' },
                ridge: { form: 'clumps', w: 1.3, wt: 0.7, h: 0.42, jit: 0.6, color: 0x8f8c83,
                         pitch: 3.0, lat: 0.55 }, aq: 1 },
  // Mangrove (tidal zone): a 1.15m continuous green wall becomes prop-root clusters per 3.4m;
  // the mudflat half is fully the painter job
  mangrove:   { name: '紅樹林',   flat: { w: 7.0, tex: 'mangrove', wet: 1 },
                ridge: { form: 'clumps', w: 1.6, wt: 1.35, h: 0.5, jit: 0.5, color: 0x3f6b3f,
                         pitch: 3.4, lat: 0.6 }, aq: 1 },
};
// Zone (coarse) unordered pair to kind. Different zones always get a divider (2026-08-11 user
// decision: same zone on both sides needs no divider) -- swapping carpet kinds inside one green
// field (turf vs miscanthus vs bushes) is print variation inside one zone, not a border; per-kind
// lines would cut large greens into dense nets.
// 2026-08-13 adds one narrow gate (user decision: sharp color jumps get that zone own divider):
// same-zone pairs at distance >= CARPET_DE.LINE go BORDER_SAME_ZONE. This does NOT overturn the
// rule above -- 08-11 blocked per-kind lines (any two green-roster kinds drawing = net); this gate
// only catches the sorted-roster unavoidable jumps (7 live pairs, see measured roster in the
// CARPET_DE header).
// Cross-zone style table: water-vs-marsh is continuous fluid water (no land divider); land-water
// meets always take the matching water-land style (beach / shore rocks / mudflat / stream /
// ditch); tidal foam lives in buildWaterEdges / celFoam.
export const BORDER_STYLES = {
  'bare|green': 'gravelpath', 'green|urban': 'hedgerow',  'green|wet': 'stream',
  'green|water': 'beach',     'alpine|green': 'trail',
  'bare|urban': 'fence',      'bare|wet': 'mudflat',      'bare|water': 'rocks',
  'alpine|bare': 'rocks',     'urban|wet': 'ditch',       'urban|water': 'rocks',
  'alpine|urban': 'fence',                                'alpine|wet': 'rocks',
  'alpine|water': 'rocks',
};
// Surface-level override (some carpet kinds bring their own divider): a sub hits only when the
// far-side zone sits in vs (urban borders never overridden = artificial borders win). vs MUST NOT
// contain that sub own zone -- same-zone draws no line, so listing it is a permanently dead
// setting. Table order is priority; both sides hitting takes the first hit.
export const BORDER_SUB_RULES = [
  // Mangrove (tidal zone): lotus ponds (tropical wetlands) facing land (green/bare) go mangrove
  { sub: 'lotus',       kind: 'mangrove',   vs: ['green', 'bare'] },
  // Sandy land facing water/marsh goes beach
  { sub: 'sand',        kind: 'beach',      vs: ['water', 'wet'] },
  { sub: 'flowerfield', kind: 'fieldridge', vs: ['bare'] },
  { sub: 'arrowbamboo', kind: 'forestroad', vs: ['bare', 'alpine'] },
  { sub: 'deadwood',    kind: 'forestroad', vs: ['bare', 'alpine'] },
  { sub: 'fallenlogs',  kind: 'forestroad', vs: ['bare', 'alpine'] },
  { sub: 'deadforest',  kind: 'forestroad', vs: ['green', 'alpine'] },
];
// Dividers for sharp color jumps inside one zone (2026-08-13 user decision: sharp jumps get that
// zone own divider) -- one kind per zone, the least abrupt natural border in that zone: green =
// walked trail, bare = gravel path, urban = street hedge (urban jumps are always paving-vs-green),
// wet = ditch, highland = rocks (snowline). Water has none -- shallow and deep are one water body,
// miss means skip (section 4: omit rather than err).
export const BORDER_SAME_ZONE = {
  green: 'trail', bare: 'gravelpath', urban: 'hedgerow', wet: 'ditch', alpine: 'rocks',
};
// Divider-kind single seam (symmetric: swapping sides returns the same; miss to null = skip).
// Same-zone goes only through the color-distance narrow gate (BORDER_SAME_ZONE); surface-level
// overrides (BORDER_SUB_RULES) stay gated on the cross-zone side, so their vs MUST NOT contain
// that sub own zone (still a dead setting).
export function borderKindOf(subA, subB, za, zb) {
  if (!za || !zb) return null;
  if (za === zb) {
    if (subA === subB) return null;
    const ca = SUB_COL[subA], cb = SUB_COL[subB];
    if (ca == null || cb == null) return null;   // No representative color = not a carpet kind, so no line
    return colDist(ca, cb) >= CARPET_DE.LINE ? (BORDER_SAME_ZONE[za] || null) : null;
  }
  for (const r of BORDER_SUB_RULES) {
    if (subA === r.sub && r.vs.includes(zb)) return r.kind;
    if (subB === r.sub && r.vs.includes(za)) return r.kind;
  }
  return BORDER_STYLES[za < zb ? `${za}|${zb}` : `${zb}|${za}`] || null;
}
// Box face table for discrete spine pieces (posts/rails/rocks/root clusters). Local frame (t, up,
// n) always right-handed (t cross up = n); each row = [local outward normal, four corners (i,j,k)
// CCW seen from outside]; i along t, j along up (-1 base / +1 top), k along n. The four-point order
// derives from the right-handed triple and MUST NOT be reordered by feel -- the wrong face points
// inward, three.js paints it dead black, and every offline assertion stays green (same family as
// the sweepUpY header).
// Six faces with four vertices each (unshared), so creases really draw lines and boxes read as
// edged wood/stone.
const BOX_FACES = [
  [[1, 0, 0], [[1, -1, -1], [1, 1, -1], [1, 1, 1], [1, -1, 1]]],
  [[-1, 0, 0], [[-1, -1, -1], [-1, -1, 1], [-1, 1, 1], [-1, 1, -1]]],
  [[0, 1, 0], [[-1, 1, -1], [-1, 1, 1], [1, 1, 1], [1, 1, -1]]],
  [[0, -1, 0], [[-1, -1, -1], [1, -1, -1], [1, -1, 1], [-1, -1, 1]]],
  [[0, 0, 1], [[-1, -1, 1], [1, -1, 1], [1, 1, 1], [-1, 1, 1]]],
  [[0, 0, -1], [[-1, -1, -1], [-1, 1, -1], [1, 1, -1], [1, -1, -1]]],
];
// Corner-joint solution (pure function; planner and audits share it) -- the geometric definition
// of a fully drawn turn puzzle. Both arm unit directions a, b point AWAY from the node; Lmax = max
// allowed pull-back; hw = band half-width.
// Fillet (arc): circle tangent to both arms with radius R = L tan(psi/2) (psi = arm angle), so cut
//   points land exactly on pulled-back straight endpoints with tangent exactly along the arms -- the
//   print bends around the corner instead of butt-joining at it.
// Cap: pulls back to a round cap when too tight for the band (R cannot fit the width, inner edge
//   would flip) -- a disk of radius hw, the standard round line join; still one fully drawn piece,
//   not two straight bands stacked.
// Returns L (how far to pull back) -- callers MUST use it for pull-back so straight endpoints meet
// joint cut points.
export function borderCornerArc(px, pz, ax, az, bx, bz, Lmax, hw) {
  const psi = Math.acos(Math.max(-1, Math.min(1, ax * bx + az * bz)));   // Arm angle
  const phi = Math.PI - psi;                                            // Path deflection angle
  const at = (L) => ({ Pa: [px + ax * L, pz + az * L], Pb: [px + bx * L, pz + bz * L] });
  if (phi < 1e-4) return { mode: 'straight', L: 0, phi, len: 0, ...at(0) };
  const tan = Math.tan(psi / 2);
  const Lneed = hw * 1.1 / Math.max(tan, 1e-6);      // R >= 1.1 hw fits the band (inner edge keeps facing out)
  if (!(Lneed <= Lmax)) {
    const L = Math.min(Lmax, hw);
    return { mode: 'cap', L, phi, cx: px, cz: pz, r: hw, len: hw * phi, ...at(L) };
  }
  const L = Lmax, R = L * tan;
  const sx = ax + bx, sz = az + bz, sl = Math.hypot(sx, sz) || 1;
  const d = L / Math.cos(psi / 2);                   // Center distance along the angle bisector
  const cx = px + sx / sl * d, cz = pz + sz / sl * d;
  const g = at(L);
  const a0 = Math.atan2(g.Pa[1] - cz, g.Pa[0] - cx);
  let sweep = Math.atan2(g.Pb[1] - cz, g.Pb[0] - cx) - a0;
  while (sweep > Math.PI) sweep -= Math.PI * 2;
  while (sweep < -Math.PI) sweep += Math.PI * 2;
  return { mode: 'arc', L, phi, cx, cz, R, a0, sweep, len: Math.abs(sweep) * R, ...g };
}

// ---- Both terrains bounded by the divider line (2026-08-11 user request) ----
// Why dividers failed to separate terrains with one side bleeding over: two different lines never
// aligned. Carpet borders resolve on a 13m jittered grid, while the old spillover (corner
// membership in planSeamOverlays) pushed each side one full cell into the other, for a mix band
// about 26m wide; dividers are grid-edge chains pulled straight into chords (drifting within
// driftMax). On screen that reads as the line here but the terrain swap over there.
// New rule: every pair that draws a divider (borderKindOf != null) takes spillover alpha from the
// signed distance of each vertex to the DRAWN line, so handoff sits exactly on the line and always
// under the band width beneath the print; pairs with no line fall back to the old fade. Same-zone
// kind swaps (turf vs miscanthus) never had a line and keep gentle fades.
// Pure function: d = signed distance (positive = neighbor-cell side), endpoints pinned 0/1, so
// opaque carpet stays watertight.
// Handoff width in m / organic noise amplitude in m / line-search radius (times cell).
// Invariant: W/2 + JIT/2 stays within the narrowest band half-width -- a wider handoff than the
// print leaks bleed outside the band.
export const BORDER_CUT = { W: 2.8, JIT: 1.2, R_F: 1.7 };
// Band measurement and look knobs (single seam; yield sampling, avoid radius, texture pitch all
// derive here, MUST NOT hand-write)
//   EDGE_A/EDGE_W = band-edge organic wobble amplitude ratio and wave number (1/m) -- the divider
//     itself stays straight while its two edges may wander (2026-08-11 user words): centerlines
//     stay 16-direction chords, only edges wobble in world coords (pure vnoise, so neighboring
//     tiles and joints sharing an endpoint agree and edges never fork).
//   PAD = clearance between feature puzzles / 3D details and band edges (fields/parking/courts
//     MUST NOT straddle, nor press right up).
//   TEX_F/TEX_MIN = one texture repeat in world length = max(TEX_MIN, w times TEX_F): wide bands
//     get long repeats, else prints stretch sideways into unreadable lines.
//   RUN_MIN_CELL = how many carpet cells one relay run must span at minimum -- kinds resolve
//     per edge, but carpet kinds are picked on a 13m grid: a shorter swap is grid noise, not a zone
//     change, and MUST merge back into a neighbor. 3 is the measured upper bound: 5 would merge away
//     the field-ridge kind that only borders small flower plots (one of 11 kinds never appearing,
//     with shot_borders quietly reporting seen zone-level answers); below 2 the per-cell jitter
//     returns.
export const BORDER_BAND = { EDGE_A: 0.26, EDGE_W: 0.2, PAD: 1.6, TEX_F: 1.5, TEX_MIN: 7, RUN_MIN_CELL: 3 };
export function borderCutAlpha(d, w) {
  return d <= -w / 2 ? 0 : d >= w / 2 ? 1 : 0.5 + d / w;
}
// Sweep-winding single seam (pure function): sign of the geometric normal y of triangles swept
// from cross-sections. t = centerline tangent, n = cross-section lateral (f increasing); flat emits
// with tangent-then-lateral winding, so only > 0 faces up here (ridge cross-section order is mirrored,
// so its test flips, see sweepRidge).
// This breaks fully silently: flipped winding under DoubleSide shows no hole, three.js just flips
// normals, so whole bands turn into lit-from-underground dead black while vertex counts, positions,
// alpha, UV and texture assertions all stay green. 2026-08-11 field test: linePath always negative
// (every straight dead black), arcPath flipping with sweep sign (turns flickering) = the reported
// several dividers with discontinuous colors.
export function sweepUpY(tx, tz, nx, nz) { return tz * nx - tx * nz; }

// Forced-dry lookup factory for divider bands (2026-08-13 user decision: water/marsh inside
// divider bands MUST NOT trigger abnormal states; rule body and wiring discipline live at the
// buildGroundCover call-site comments).
// Module level is deliberate: the returned function hangs on terrain until battle end, and an inner
// buildGroundCover closure would pin that whole scope context (carpet buckets / detail rosters /
// landCells and more) with it.
// grid = centerline-segment spatial index (ci,cj key to segment arrays, each carrying its own band
// half-width hw); sc = index cell edge; hwMax = widest catalog half-width (scan count derives from
// it, never hand-written).
export function makeBandMask(grid, sc, hwMax) {
  const n = Math.max(1, Math.ceil(hwMax / sc));
  return (x, z) => {
    const ci = Math.floor(x / sc), cj = Math.floor(z / sc);
    for (let dj = -n; dj <= n; dj++) {
      for (let di = -n; di <= n; di++) {
        const l = grid.get(`${ci + di},${cj + dj}`);
        if (!l) continue;
        for (const sg of l) {
          const dx = sg.x1 - sg.x0, dz = sg.z1 - sg.z0, l2 = dx * dx + dz * dz || 1;
          let t = ((x - sg.x0) * dx + (z - sg.z0) * dz) / l2;
          t = t < 0 ? 0 : t > 1 ? 1 : t;
          if (Math.hypot(sg.x0 + dx * t - x, sg.z0 + dz * t - z) <= sg.hw) return true;
        }
      }
    }
    return false;
  };
}

export function planBorderPuzzle(keys, gnx, gnz, opts = {}) {
  // zoneOf(i,j) = that cell true zone (caller-computed zoneGrid). MUST win over reverse lookup
  // by kind (coarseOf): steppe/scree sit in both bare and highland carpet rosters, and reverse
  // lookup always takes the first, so highland cells would read as bare and grow a fake cross-zone
  // border net inside highland.
  const { zoneOf = null, coarseOf = null, cornerXZ = (ci, cj) => [ci, cj], driftMax = 1,
          kindOf = borderKindOf, halfWidthOf = () => 1, jointF = 2.2, forkF = 1, runMinM = 0 } = opts;
  const solid = (k) => k != null && k !== '!';
  const subOf = (k) => { const p = k.indexOf('#'); return p < 0 ? k : k.slice(0, p); };
  const keyAt = (i, j) => (i < 0 || j < 0 || i >= gnx || j >= gnz) ? null : keys[j * gnx + i];
  // 1. Boundary edges: two solid cells, different surfaces, kind resolvable; an edge = two shared
  // corners (corner grid (gnx+1) x (gnz+1))
  const NKW = gnx + 2;                                  // Node key stride (corner ci in 0..gnx)
  const zoneAt = (i, j) => {
    if (zoneOf) return zoneOf(i, j) ?? null;
    const k = keyAt(i, j);
    return (coarseOf && solid(k)) ? coarseOf(k) : null;
  };
  const edges = [];                                     // { a, b: node key, kind, used }
  const adj = new Map();                                // node key -> [edge indices] (insertion order = deterministic)
  const addEdge = (ci0, cj0, ci1, cj1, k0, k1, z0, z1) => {
    const s0 = subOf(k0), s1 = subOf(k1);
    if (s0 === s1) return;                              // Same-surface variants: motif continues, no border
    const kind = kindOf(s0, s1, z0, z1);                // Same zone -> borderKindOf always returns null
    if (!kind) return;
    const e = { a: cj0 * NKW + ci0, b: cj1 * NKW + ci1, kind, used: false };
    const ei = edges.length;
    edges.push(e);
    for (const n of [e.a, e.b]) {
      let l = adj.get(n);
      if (!l) { l = []; adj.set(n, l); }
      l.push(ei);
    }
  };
  for (let j = 0; j < gnz; j++) {
    for (let i = 0; i < gnx; i++) {
      const k0 = keyAt(i, j);
      if (!solid(k0)) continue;
      const z0 = zoneAt(i, j);
      const kR = keyAt(i + 1, j), kD = keyAt(i, j + 1);
      if (solid(kR)) addEdge(i + 1, j, i + 1, j + 1, k0, kR, z0, zoneAt(i + 1, j));   // Vertical edge shared with the right neighbor
      if (solid(kD)) addEdge(i, j + 1, i + 1, j + 1, k0, kD, z0, zoneAt(i, j + 1));   // Horizontal edge shared with the lower neighbor
    }
  }
  // 2. Walk the corner graph into chains: start from degree != 2 nodes (ends/forks), loops left over
  const deg = (n) => (adj.get(n) || []).length;
  const walk = (ei0, n0) => {
    const pts = [n0], kinds = [];
    let e = edges[ei0], n = n0;
    for (;;) {
      e.used = true;
      const m = e.a === n ? e.b : e.a;
      pts.push(m);
      kinds.push(e.kind);
      if (deg(m) !== 2) break;                          // End (1) / fork (3+): chain stops here
      const ni = adj.get(m).find((k) => !edges[k].used);
      if (ni == null) break;                            // Loop walked back to start
      e = edges[ni]; n = m;
    }
    return { pts, kinds };
  };
  const raw = [];
  for (const [n, l] of adj) {
    if (l.length === 2) continue;
    for (const ei of l) if (!edges[ei].used) raw.push(walk(ei, n));
  }
  for (let ei = 0; ei < edges.length; ei++) if (!edges[ei].used) raw.push(walk(ei, edges[ei].a));
  // 3-4. 16-direction quantization + relay splitting into tiles
  const STEP = (Math.PI * 2) / BORDER_DIRS;
  const binOf = (dx, dz) => ((Math.round(Math.atan2(dz, dx) / STEP) % BORDER_DIRS) + BORDER_DIRS) % BORDER_DIRS;
  const posOf = (n) => cornerXZ(n % NKW, (n / NKW) | 0);
  const chains = [];
  for (const ch of raw) {
    const P = ch.pts.map(posOf);
    const closed = ch.pts.length > 2 && ch.pts[0] === ch.pts[ch.pts.length - 1];
    // ---- Relay swaps whole runs, not per cell: short runs merge back into neighbors ----
    // Kinds resolve per edge while carpet kinds are picked on a 13m grid, so walking the border
    // jitters kinds back and forth near zone(cors) borders, fragmenting resolved kinds into gravel /
    // forest-road / gravel noise (2026-08-11 photos swapped color about every 20m) = half of the
    // reported divider color discontinuity. Merging follows the edgewall run discipline (A44 item 7):
    // short yields to the LONGER neighbor, re-merge same kinds, shortest-first per round, so
    // deterministic and convergent. runMinM = 0 (default) is bit-identical to unmerged.
    if (runMinM > 0 && ch.kinds.length > 1) {
      const eLen = [];
      for (let e = 0; e < ch.kinds.length; e++) {
        eLen.push(Math.hypot(P[e + 1][0] - P[e][0], P[e + 1][1] - P[e][1]));
      }
      const mkRuns = () => {
        const rs = [];
        for (let e = 0; e < ch.kinds.length; e++) {
          const last = rs[rs.length - 1];
          if (last && last.kind === ch.kinds[e]) { last.e = e + 1; last.len += eLen[e]; }
          else rs.push({ s: e, e: e + 1, kind: ch.kinds[e], len: eLen[e] });
        }
        return rs;
      };
      let runs = mkRuns();
      while (runs.length > 1) {
        let pick = -1;
        for (let r = 0; r < runs.length; r++) {
          if (runs[r].len >= runMinM) continue;
          if (pick < 0 || runs[r].len < runs[pick].len) pick = r;
        }
        if (pick < 0) break;
        const pv = runs[pick - 1], nx = runs[pick + 1];
        const into = !pv ? nx : !nx ? pv : (nx.len > pv.len ? nx : pv);
        for (let e = runs[pick].s; e < runs[pick].e; e++) ch.kinds[e] = into.kind;
        runs = mkRuns();
      }
    }
    // Split by kind first (relay cuts are shared corners like fork cuts), quantize direction inside runs
    const segs = [];
    let s0 = 0;
    for (let e = 1; e <= ch.kinds.length; e++) {
      if (e === ch.kinds.length || ch.kinds[e] !== ch.kinds[s0]) { segs.push([s0, e, ch.kinds[s0]]); s0 = e; }
    }
    const tiles = [];
    for (const [e0, e1, kind] of segs) {
      let i0 = e0;
      while (i0 < e1) {
        let i1 = i0 + 1;
        while (i1 < e1) {                               // Greedy extend: merge only while every skipped corner stays within driftMax
          const [ax, az] = P[i0], [bx, bz] = P[i1 + 1];
          const dx = bx - ax, dz = bz - az, L = Math.hypot(dx, dz) || 1;
          let fit = true;
          for (let k = i0 + 1; k <= i1; k++) {
            const d = Math.abs((P[k][0] - ax) * dz - (P[k][1] - az) * dx) / L;
            if (d > driftMax) { fit = false; break; }
          }
          if (!fit) break;
          i1++;
        }
        const [ax, az] = P[i0], [bx, bz] = P[i1];
        const dx = bx - ax, dz = bz - az, L = Math.hypot(dx, dz) || 1;
        let drift = 0;                                  // Honestly recomputed (audits still measure it if the greedy check breaks)
        for (let k = i0 + 1; k < i1; k++) {
          const d = Math.abs((P[k][0] - ax) * dz - (P[k][1] - az) * dx) / L;
          if (d > drift) drift = d;
        }
        tiles.push({ x0: ax, z0: az, x1: bx, z1: bz, bin: binOf(dx, dz), kind, drift,
                     n0: ch.pts[i0], n1: ch.pts[i1] });
        i0 = i1;
      }
    }
    for (let t = 0; t < tiles.length; t++) {
      const tl = tiles[t];
      const prev = tiles[t - 1] || (closed ? tiles[tiles.length - 1] : null);
      const next = tiles[t + 1] || (closed ? tiles[0] : null);
      tl.turn = !!(prev && prev !== tl && prev.bin !== tl.bin);   // Turn piece: bin differs from previous
      tl.j0 = !!prev; tl.j1 = !!next;                             // Whether endpoints join (relay / same-run continuation)
    }
    chains.push({ closed, ns: ch.pts, tiles });
  }
  // ---- 5. Joints: turns and forks are always fully drawn pieces, MUST NOT butt-join straights ----
  // Only one way: straights pull back (tr0/tr1) from joints, freeing space owned by joint pieces, so
  // no overlap, no coplanar eating, no two-pieces-stacked-pretending-a-turn. Pull-back amounts are
  // solved by joints themselves (borderCornerArc returns L), equal on both sides, so straight
  // endpoints meet joint cut points bit-identically (endpoint anchoring generalized).
  // One node is handled by exactly one joint (each tile end belongs to exactly one node), so tr0/tr1
  // are never written twice.
  const hwOf = (k) => halfWidthOf(k) || 1;
  const arms = new Map();                        // Node to incoming arms (directions always point away from node)
  for (const ch of chains) {
    for (const tl of ch.tiles) {
      const dx = tl.x1 - tl.x0, dz = tl.z1 - tl.z0, l = Math.hypot(dx, dz) || 1;
      for (const e of [0, 1]) {
        const n = e ? tl.n1 : tl.n0, s = e ? -1 : 1;
        let a = arms.get(n);
        if (!a) { a = []; arms.set(n, a); }
        a.push({ tl, e, dx: dx / l * s, dz: dz / l * s, kind: tl.kind, len: l });
      }
    }
  }
  const corners = [], forks = [];
  for (const [n, l] of arms) {
    const [x, z] = posOf(n);
    if (l.length === 2) {
      const [A, B] = l;
      if (A.tl.bin === B.tl.bin) continue;       // Same-direction cells (pure relay kind swap) = straight, no turn piece needed
      const hw = Math.max(hwOf(A.kind), hwOf(B.kind));
      const g = borderCornerArc(x, z, A.dx, A.dz, B.dx, B.dz,
        Math.min(jointF * hw, A.len * 0.4, B.len * 0.4), hw);
      if (g.mode === 'straight') continue;
      A.tl[A.e ? 'tr1' : 'tr0'] = g.L;
      B.tl[B.e ? 'tr1' : 'tr0'] = g.L;
      const cor = { type: 'corner', n, x, z, hw, geo: g,
                    a: { dx: A.dx, dz: A.dz, kind: A.kind, hw: hwOf(A.kind) },
                    b: { dx: B.dx, dz: B.dz, kind: B.kind, hw: hwOf(B.kind) } };
      corners.push(cor);
      A.tl[A.e ? 'c1' : 'c0'] = cor; B.tl[B.e ? 'c1' : 'c0'] = cor;
    } else if (l.length >= 3) {
      // Fork: one shared pull-back length, so per-arm cross-sections stay equal and the joint
      // polygon stays regular. Coefficients stay SEPARATE from turns (forkF, not jointF): turn L
      // sets arc radius and wants room to sweep, while fork L is mouth size -- about one band
      // half-width makes the mouth one band square; reusing jointF stretches per-arm wedges into
      // starbursts (stepped on in 2026-08-11 photos).
      let hw = 0, lim = Infinity;
      for (const a of l) { hw = Math.max(hw, hwOf(a.kind)); lim = Math.min(lim, a.len * 0.4); }
      const L = Math.min(forkF * hw, lim);
      const list = l.map((a) => {
        a.tl[a.e ? 'tr1' : 'tr0'] = L;
        a.tl[a.e ? 'f1' : 'f0'] = true;      // This end meets a fork (not another in-chain piece), so endpoints MUST NOT fade
        return { dx: a.dx, dz: a.dz, kind: a.kind, hw: hwOf(a.kind) };
      });
      list.sort((p, q) => Math.atan2(p.dz, p.dx) - Math.atan2(q.dz, q.dx));   // CCW order
      const ks = [];
      for (const a of list) if (!ks.includes(a.kind)) ks.push(a.kind);
      forks.push({ type: 'fork', n, x, z, L, hw, arms: list, kinds: ks });
    }
  }
  // Pulled-back endpoints (emitters read only this set; unpulled ends are bit-identical to raw ends)
  for (const ch of chains) {
    for (const tl of ch.tiles) {
      tl.tr0 = tl.tr0 || 0; tl.tr1 = tl.tr1 || 0;
      const dx = tl.x1 - tl.x0, dz = tl.z1 - tl.z0, l = Math.hypot(dx, dz) || 1;
      tl.ax = tl.x0 + dx / l * tl.tr0; tl.az = tl.z0 + dz / l * tl.tr0;
      tl.bx = tl.x1 - dx / l * tl.tr1; tl.bz = tl.z1 - dz / l * tl.tr1;
      tl.len = l - tl.tr0 - tl.tr1;
    }
  }
  return { chains, corners, forks };
}

// ---- Border puzzle ground-band painters (transparent base + along-x print; mirrored repeat =
// seamless across tiles) ----
// Painter contract: prints MUST fill the whole v range (= full texture height) -- band soft edges
// belong to vertex alpha (sweepFlat edges alpha 0, centerline alpha 1). Painting one thin strip in
// the middle makes the realized width far below the catalog w, and a second vertex-alpha fade melts
// the whole line; canvases only paint in browsers, so NO offline audit can measure this, only the
// tools/shot_borders.mjs field photos caught it (stepped on 2026-08-11).
// Lateral positions always go through bandY; MUST NOT hand-write S times 0.xx y offsets in painters.
const bandY = (S, f) => S / 2 + f * S * 0.46;      // f in [-1,1] across the band to canvas y
// Hand band along x: overlapping blobs = organic edges (photoreal noise banned, same PAINTERS vocabulary)
function bandBlob(g, S, rnd, f, color, alpha = 1) {
  const h = S * 0.92 * f;                          // f = share of band width filled
  g.fillStyle = color;
  for (let x = -12; x < S + 12; x += 9) {
    g.globalAlpha = alpha * (0.7 + rnd() * 0.3);
    brushBlob(g, x, S / 2 + (rnd() - 0.5) * S * 0.04, h / 2 + rnd() * h * 0.16, rnd);
  }
  g.globalAlpha = 1;
}
// Grass strokes on both edges (shared by most painters): pasted on band rims to chew straight
// geometric edges into organic ones
function bandFringe(g, S, rnd, color, n = 34, len = 6) {
  g.strokeStyle = color; g.lineWidth = 2; g.lineCap = 'round';
  for (let i = 0; i < n; i++) {
    const x = rnd() * S, y = bandY(S, (rnd() < 0.5 ? -1 : 1) * (0.7 + rnd() * 0.3));
    g.beginPath(); g.moveTo(x, y);
    g.lineTo(x + (rnd() - 0.5) * 5, y + (y < S / 2 ? -1 : 1) * (len + rnd() * len * 0.9));
    g.stroke();
  }
  g.lineCap = 'butt';
}
// v contract (2026-08-13 user report: both sides of a beach cannot be water; as a divider it
// should split two different zone types): most dividers are SYMMETRIC (trail / forest road / gravel
// path / field ridge / ditch / stream / fence / hedge / rocks -- same nature both sides, both sides
// of a road were always alike), so painters may paint freely.
// But the THREE transition kinds (beach / mudflat / mangrove) split different things: water on one
// side, land on the other. Painting them symmetric puts water on both sides of the beach -- surf
// runs onto the land side. Those three flag flat.wet = 1 in the catalog, and emitters use it to
// orient the v axis (see wetFlipAt). Contract: f = +1 (v = 1) is always the water side, f = -1
// (v = 0) always the land side. Painters flagged wet MUST paint water elements (surf / tidal
// channels / ponding) on the f > 0 half and land elements (dry sand / shells / grass / canopy) on
// the f < 0 half; unflagged painters MUST NOT depend on the sign of f (direction unguaranteed).
const BORDER_PAINTERS = {
  trail(g, S, rnd) {                                   // Foot trail: trodden tread + step stones + ruts + edge grass
    bandBlob(g, S, rnd, 1, 'rgb(150,124,90)');
    bandBlob(g, S, rnd, 0.44, 'rgb(133,108,76)', 0.75);   // Trodden center tread (darker than sides)
    g.fillStyle = 'rgb(126,102,72)';
    for (let x = 8; x < S; x += 26 + (rnd() * 10 | 0)) {
      g.beginPath();
      g.ellipse(x, bandY(S, (rnd() - 0.5) * 0.7), 9 + rnd() * 5, 7 + rnd() * 4, rnd(), 0, 7); g.fill();
      g.fillStyle = rnd() < 0.5 ? 'rgb(166,140,104)' : 'rgb(126,102,72)';
    }
    g.fillStyle = 'rgba(96,84,64,0.5)';                // Shallow puddles (tread hollows)
    for (let i = 0; i < 5; i++) brushBlob(g, rnd() * S, bandY(S, (rnd() - 0.5) * 0.5), 5 + rnd() * 7, rnd);
    g.fillStyle = 'rgba(188,166,128,0.8)';             // Dry loose-soil specks
    for (let i = 0; i < 22; i++) { g.beginPath(); g.arc(rnd() * S, bandY(S, (rnd() - 0.5) * 1.6), 1.2 + rnd() * 2, 0, 7); g.fill(); }
    bandFringe(g, S, rnd, 'rgba(74,110,52,0.7)', 40, 7);
  },
  forestroad(g, S, rnd) {                              // Forest road: twin ruts + center grass + leaf litter
    bandBlob(g, S, rnd, 1, 'rgb(122,100,72)', 0.92);
    g.fillStyle = 'rgba(88,70,50,0.85)';
    for (const f of [-0.5, 0.5]) {                     // Wheel ruts: left and right
      for (let x = -8; x < S + 8; x += 10) brushBlob(g, x, bandY(S, f + (rnd() - 0.5) * 0.06), 13 + rnd() * 4, rnd);
    }
    g.strokeStyle = 'rgba(96,128,66,0.8)'; g.lineWidth = 2;
    for (let i = 0; i < 24; i++) {                     // Center grass strip
      const x = rnd() * S, y = bandY(S, (rnd() - 0.5) * 0.22);
      g.beginPath(); g.moveTo(x, y); g.lineTo(x + (rnd() - 0.5) * 4, y - 6); g.stroke();
    }
    g.fillStyle = 'rgba(150,110,60,0.7)';
    for (let i = 0; i < 16; i++) { g.beginPath(); g.arc(rnd() * S, bandY(S, (rnd() - 0.5) * 1.9), 2.2, 0, 7); g.fill(); }
    bandFringe(g, S, rnd, 'rgba(84,116,58,0.65)', 30, 8);
  },
  gravelpath(g, S, rnd) {                              // Gravel dirt road: gray soil band + graded stone layers
    bandBlob(g, S, rnd, 1, 'rgb(160,148,128)');
    bandBlob(g, S, rnd, 0.5, 'rgb(178,168,148)', 0.6);    // Rolled-bright fine grade at center
    for (let i = 0; i < 190; i++) {                       // Fine grains: full cover
      g.fillStyle = rnd() < 0.5 ? 'rgba(120,112,98,0.9)' : 'rgba(196,188,170,0.9)';
      g.beginPath(); g.arc(rnd() * S, bandY(S, (rnd() - 0.5) * 1.9), 1.2 + rnd() * 1.8, 0, 7); g.fill();
    }
    for (let i = 0; i < 26; i++) {                        // Coarse grains: angular stones (edges read as gravel)
      const x = rnd() * S, y = bandY(S, (rnd() - 0.5) * 1.7), r = 2.6 + rnd() * 3.4;
      g.fillStyle = rnd() < 0.5 ? 'rgb(146,138,124)' : 'rgb(206,198,182)';
      g.beginPath();
      for (let a = 0; a < 5; a++) {
        const t = a / 5 * Math.PI * 2, rr = r * (0.65 + rnd() * 0.55);
        a ? g.lineTo(x + Math.cos(t) * rr, y + Math.sin(t) * rr) : g.moveTo(x + Math.cos(t) * rr, y + Math.sin(t) * rr);
      }
      g.closePath(); g.fill();
    }
    // Weeds growing out of gravel seams (2026-08-13 user report: dirt roads carry gravel weeds):
    // bandFringe only grows on rims, while dirt-road grass grows ON the road -- without it, a flat
    // gravel band is just a gray texture line
    for (let i = 0; i < 26; i++) {
      const x = rnd() * S, y = bandY(S, (rnd() - 0.5) * 1.75);
      g.strokeStyle = rnd() < 0.5 ? 'rgba(112,134,72,0.85)' : 'rgba(146,152,88,0.8)';
      g.lineWidth = 1.3;
      for (let k = 0; k < 3; k++) {                        // Three blades per tuft
        g.beginPath(); g.moveTo(x, y);
        g.quadraticCurveTo(x + (rnd() - 0.5) * 4, y - 4, x + (rnd() - 0.5) * 8, y - 6 - rnd() * 4);
        g.stroke();
      }
    }
    bandFringe(g, S, rnd, 'rgba(122,132,86,0.55)', 22, 5);
  },
  fieldpath(g, S, rnd) {                               // Field ridge: rammed-earth path + wet field reflections + straw bits + grass crown
    bandBlob(g, S, rnd, 1, 'rgb(146,124,88)');
    bandBlob(g, S, rnd, 0.36, 'rgb(122,102,72)', 0.85);   // Trodden crest at center
    g.fillStyle = 'rgba(108,120,96,0.55)';                // Field-water / wet-soil reflections on both sides
    for (const f of [-0.86, 0.86]) {
      for (let x = -8; x < S + 8; x += 11) brushBlob(g, x, bandY(S, f + (rnd() - 0.5) * 0.12), 9 + rnd() * 5, rnd);
    }
    g.strokeStyle = 'rgba(186,164,112,0.85)'; g.lineWidth = 1.5;   // Straw bits
    for (let i = 0; i < 26; i++) {
      const x = rnd() * S, y = bandY(S, (rnd() - 0.5) * 1.2), a = rnd() * Math.PI;
      g.beginPath(); g.moveTo(x, y); g.lineTo(x + Math.cos(a) * 7, y + Math.sin(a) * 4); g.stroke();
    }
    bandFringe(g, S, rnd, 'rgba(96,128,60,0.8)', 46, 8);
  },
  ditch(g, S, rnd) {                                   // Ditch: concrete rims + dark water + algae glints
    const y = (f) => bandY(S, f);
    g.fillStyle = 'rgb(70,84,88)';                     // Ditch water (center 60 percent)
    g.fillRect(0, y(-0.3), S, y(0.3) - y(-0.3));
    g.fillStyle = 'rgb(178,180,176)';                  // Concrete rims on both sides
    g.fillRect(0, y(-0.98), S, y(-0.3) - y(-0.98));
    g.fillRect(0, y(0.3), S, y(0.98) - y(0.3));
    g.fillStyle = 'rgba(140,142,138,0.7)';             // Dark rim hems (edge finish)
    g.fillRect(0, y(-0.36), S, 3); g.fillRect(0, y(0.33), S, 3);
    g.fillStyle = 'rgba(96,120,96,0.6)';
    for (let i = 0; i < 18; i++) brushBlob(g, rnd() * S, y((rnd() - 0.5) * 0.5), 4 + rnd() * 5, rnd);
    g.strokeStyle = 'rgba(210,220,222,0.5)'; g.lineWidth = 1.4;
    for (let i = 0; i < 10; i++) {
      const x = rnd() * S, yy = y((rnd() - 0.5) * 0.45);
      g.beginPath(); g.moveTo(x, yy); g.lineTo(x + 8 + rnd() * 8, yy); g.stroke();
    }
    g.fillStyle = 'rgba(150,148,142,0.6)';             // Rim joints (precast cover segments)
    for (let x = 6; x < S; x += 30 + (rnd() * 12 | 0)) { g.fillRect(x, y(-0.98), 2, y(-0.3) - y(-0.98)); g.fillRect(x, y(0.3), 2, y(0.98) - y(0.3)); }
    bandFringe(g, S, rnd, 'rgba(92,124,64,0.7)', 26, 6);
  },
  fenceline(g, S, rnd) {                               // Fence foot: trodden dirt strip + post shadows + tall weeds
    bandBlob(g, S, rnd, 1, 'rgb(138,132,96)');
    bandBlob(g, S, rnd, 0.34, 'rgb(120,110,80)', 0.8);    // Narrow path worn along the fence
    g.fillStyle = 'rgba(74,66,48,0.5)';                   // Post-foot shadows (regular spacing = artificial border)
    for (let x = 10; x < S + 10; x += 32) brushBlob(g, x, bandY(S, 0.02), 5 + rnd() * 2, rnd);
    g.fillStyle = 'rgba(158,150,112,0.7)';
    for (let i = 0; i < 30; i++) { g.beginPath(); g.arc(rnd() * S, bandY(S, (rnd() - 0.5) * 1.8), 1.3 + rnd() * 2, 0, 7); g.fill(); }
    bandFringe(g, S, rnd, 'rgba(112,134,66,0.85)', 52, 10);
  },
  hedgebank(g, S, rnd) {                               // Hedge foot: leaf litter + moss + dead twigs (hedge body is a solid spine)
    bandBlob(g, S, rnd, 1, 'rgb(104,94,68)');
    g.fillStyle = 'rgba(70,64,48,0.6)';                   // Dense hedge shade pressed on centerline
    for (let x = -8; x < S + 8; x += 10) brushBlob(g, x, bandY(S, (rnd() - 0.5) * 0.2), 13 + rnd() * 5, rnd);
    for (let i = 0; i < 46; i++) {                        // Fallen leaves
      g.fillStyle = rnd() < 0.5 ? 'rgba(146,116,62,0.85)' : 'rgba(112,92,54,0.85)';
      const x = rnd() * S, y = bandY(S, (rnd() - 0.5) * 1.8);
      g.beginPath(); g.ellipse(x, y, 3.4 + rnd() * 2.4, 1.8 + rnd() * 1.2, rnd() * 3, 0, 7); g.fill();
    }
    g.fillStyle = 'rgba(96,132,74,0.55)';                 // Moss stains
    for (let i = 0; i < 14; i++) brushBlob(g, rnd() * S, bandY(S, (rnd() - 0.5) * 1.5), 5 + rnd() * 6, rnd);
    g.strokeStyle = 'rgba(84,70,50,0.85)'; g.lineWidth = 1.6;
    for (let i = 0; i < 14; i++) {                        // Dead twigs
      const x = rnd() * S, y = bandY(S, (rnd() - 0.5) * 1.4), a = rnd() * Math.PI;
      g.beginPath(); g.moveTo(x, y); g.lineTo(x + Math.cos(a) * 12, y + Math.sin(a) * 6); g.stroke();
    }
    bandFringe(g, S, rnd, 'rgba(88,124,58,0.8)', 40, 9);
  },
  rubble(g, S, rnd) {                                  // Rock band: fallen angular scree + lichen + crack lines
    bandBlob(g, S, rnd, 1, 'rgb(150,146,138)');
    for (let i = 0; i < 60; i++) {                        // Angular rocks (graded sizes, not uniform noise)
      const x = rnd() * S, y = bandY(S, (rnd() - 0.5) * 1.9), r = 3 + rnd() * rnd() * 12;
      const c = 120 + (rnd() * 70 | 0);
      g.fillStyle = `rgb(${c},${c - 3},${c - 10})`;
      g.beginPath();
      for (let a = 0; a < 6; a++) {
        const t = a / 6 * Math.PI * 2, rr = r * (0.6 + rnd() * 0.6);
        a ? g.lineTo(x + Math.cos(t) * rr, y + Math.sin(t) * rr) : g.moveTo(x + Math.cos(t) * rr, y + Math.sin(t) * rr);
      }
      g.closePath(); g.fill();
      g.strokeStyle = 'rgba(78,76,72,0.5)'; g.lineWidth = 1.2; g.stroke();   // Crack dark lines
    }
    g.fillStyle = 'rgba(154,168,118,0.45)';               // Lichen
    for (let i = 0; i < 18; i++) brushBlob(g, rnd() * S, bandY(S, (rnd() - 0.5) * 1.7), 3.5 + rnd() * 4, rnd);
  },
  stream(g, S, rnd) {                                  // Stream: teal water band + white glints + bank stones
    bandBlob(g, S, rnd, 1, 'rgb(88,138,148)');
    bandBlob(g, S, rnd, 0.5, 'rgb(70,120,134)', 0.8);  // Deep channel
    g.strokeStyle = 'rgba(226,240,242,0.75)'; g.lineWidth = 1.6; g.lineCap = 'round';
    for (let i = 0; i < 18; i++) {
      const x = rnd() * S, y = bandY(S, (rnd() - 0.5) * 0.9);
      g.beginPath(); g.moveTo(x, y); g.quadraticCurveTo(x + 6, y - 2, x + 12 + rnd() * 6, y); g.stroke();
    }
    g.fillStyle = 'rgb(140,138,126)';
    for (let i = 0; i < 18; i++) {                     // Bank stones on both sides
      const y = bandY(S, (rnd() < 0.5 ? -1 : 1) * (0.66 + rnd() * 0.3));
      g.beginPath(); g.ellipse(rnd() * S, y, 4.5 + rnd() * 3, 3.5 + rnd() * 2.5, rnd(), 0, 7); g.fill();
      g.fillStyle = rnd() < 0.5 ? 'rgb(158,154,142)' : 'rgb(126,124,114)';
    }
    g.fillStyle = 'rgba(214,236,238,0.45)';            // White foam tails below stones
    for (let i = 0; i < 10; i++) brushBlob(g, rnd() * S, bandY(S, (rnd() - 0.5) * 0.8), 4 + rnd() * 5, rnd);
    bandFringe(g, S, rnd, 'rgba(88,126,66,0.8)', 34, 9);
  },
  // The three painters below flag wet (see the v contract above): f > 0 is water, f < 0 is
  // land; MUST NOT paint symmetric
  beach(g, S, rnd) {                                   // Beach: dry sand land-side to tide line to wet sand + surf water-side
    bandBlob(g, S, rnd, 1, 'rgb(216,198,158)');
    g.save(); g.beginPath();                              // Wet sand only on the water side (f > 0.05)
    g.rect(0, bandY(S, 0.05), S, S); g.clip();
    bandBlob(g, S, rnd, 1, 'rgb(186,168,132)', 0.75);
    g.restore();
    g.strokeStyle = 'rgba(168,150,116,0.7)'; g.lineWidth = 2.2;   // Tide lines: farthest wash reaches
    for (const f of [-0.1, 0.14]) {
      g.beginPath();
      for (let x = -8; x <= S + 8; x += 12) {
        const y = bandY(S, f + (rnd() - 0.5) * 0.16);
        x < 0 ? g.moveTo(x, y) : g.lineTo(x, y);
      }
      g.stroke();
    }
    for (let i = 0; i < 44; i++) {                        // Shells/pebbles piled at tide line and land side
      g.fillStyle = rnd() < 0.6 ? 'rgba(240,232,214,0.9)' : 'rgba(150,140,120,0.9)';
      g.beginPath(); g.arc(rnd() * S, bandY(S, -0.95 + rnd() * 1.1), 1.2 + rnd() * 1.8, 0, 7); g.fill();
    }
    g.strokeStyle = 'rgba(150,152,102,0.75)'; g.lineWidth = 1.5;  // Land side: dune grass
    for (let i = 0; i < 22; i++) {
      const x = rnd() * S, y = bandY(S, -1 + rnd() * 0.28);
      g.beginPath(); g.moveTo(x, y);
      g.quadraticCurveTo(x + (rnd() - 0.5) * 5, y + 4, x + (rnd() - 0.5) * 9, y + 8 + rnd() * 4);
      g.stroke();
    }
    // Surf (2026-08-13 user report: beaches need surf) -- water side ONLY. Symmetric surf reads
    // as water on both sides, while divider sides MUST be different zone types (same-day follow-up)
    for (const [f, a] of [[0.42, 0.7], [0.8, 0.9]]) {
      g.fillStyle = `rgba(252,252,250,${a})`;
      for (let x = -6; x < S + 6; x += 7) {               // Foam-line body: bubbles chained into scallops
        const y = bandY(S, f + (rnd() - 0.5) * 0.13);
        g.beginPath(); g.arc(x + rnd() * 5, y, 2 + rnd() * 3.4, 0, 7); g.fill();
      }
      g.strokeStyle = `rgba(206,228,234,${a * 0.7})`; g.lineWidth = 1.4;   // Dark wet-sand hem behind the foam
      g.beginPath();
      for (let x = -6; x <= S + 6; x += 10) {
        const y = bandY(S, f - 0.1 + (rnd() - 0.5) * 0.1);
        x < 0 ? g.moveTo(x, y) : g.lineTo(x, y);
      }
      g.stroke();
    }
    g.fillStyle = 'rgba(255,255,255,0.5)';                // Leftover foam: scattered water-side only
    for (let i = 0; i < 46; i++) { g.beginPath(); g.arc(rnd() * S, bandY(S, 0.2 + rnd() * 0.8), 0.8 + rnd() * 1.4, 0, 7); g.fill(); }
  },
  mudflat(g, S, rnd) {                                 // Mudflat transition (water vs marsh): salt grass land-side to mud to tidal pools water-side
    bandBlob(g, S, rnd, 1, 'rgb(122,110,88)');
    g.save(); g.beginPath();                              // Water side: soaked dark wet mud
    g.rect(0, bandY(S, 0.1), S, S); g.clip();
    bandBlob(g, S, rnd, 1, 'rgb(92,86,72)', 0.8);
    g.restore();
    g.fillStyle = 'rgba(70,92,96,0.55)';                  // Tidal channels: winding leftover pools at ebb (water side)
    for (let i = 0; i < 10; i++) {
      const y0 = bandY(S, 0.15 + rnd() * 0.8);
      g.beginPath(); g.moveTo(-8, y0);
      for (let x = 0; x <= S + 8; x += 18) g.quadraticCurveTo(x + 6, y0 + (rnd() - 0.5) * 9, x + 18, y0 + (rnd() - 0.5) * 5);
      g.lineWidth = 3 + rnd() * 5; g.strokeStyle = 'rgba(70,92,96,0.5)'; g.stroke();
    }
    g.fillStyle = 'rgba(150,140,116,0.6)';                // Cracked mud polygons (land side)
    for (let i = 0; i < 26; i++) brushBlob(g, rnd() * S, bandY(S, -1 + rnd() * 1.0), 4 + rnd() * 7, rnd);
    g.strokeStyle = 'rgba(96,84,64,0.5)'; g.lineWidth = 1;
    for (let i = 0; i < 30; i++) {                        // Mud cracks
      const x = rnd() * S, y = bandY(S, -1 + rnd() * 0.9), a = rnd() * Math.PI;
      g.beginPath(); g.moveTo(x, y); g.lineTo(x + Math.cos(a) * 9, y + Math.sin(a) * 6); g.stroke();
    }
    g.fillStyle = 'rgba(140,132,104,0.85)';               // Shells / crab holes
    for (let i = 0; i < 34; i++) { g.beginPath(); g.arc(rnd() * S, bandY(S, (rnd() - 0.5) * 1.9), 1 + rnd() * 1.6, 0, 7); g.fill(); }
    g.strokeStyle = 'rgba(118,138,84,0.8)'; g.lineWidth = 1.6; g.lineCap = 'round';
    for (let i = 0; i < 34; i++) {                        // Land side: salt-grass tufts (the marsh side)
      const x = rnd() * S, y = bandY(S, -1 + rnd() * 0.35);
      g.beginPath(); g.moveTo(x, y + 5); g.lineTo(x + (rnd() - 0.5) * 4, y - 4 - rnd() * 6); g.stroke();
    }
    g.lineCap = 'butt';
  },
  mangrove(g, S, rnd) {                                // Mangrove: canopy land-side to prop roots to tidal channels water-side
    bandBlob(g, S, rnd, 1, 'rgb(112,98,76)');
    g.save(); g.beginPath();
    g.rect(0, bandY(S, 0.15), S, S); g.clip();            // Water side: soaked deep mud
    bandBlob(g, S, rnd, 1, 'rgb(84,80,68)', 0.75);
    g.restore();
    g.fillStyle = 'rgba(63,107,63,0.8)';                  // Land side: dense canopy
    for (let i = 0; i < 20; i++) brushBlob(g, rnd() * S, bandY(S, -1 + rnd() * 0.85), 7 + rnd() * 9, rnd);
    g.fillStyle = 'rgba(96,140,80,0.7)';
    for (let i = 0; i < 14; i++) brushBlob(g, rnd() * S, bandY(S, -1 + rnd() * 0.7), 4 + rnd() * 6, rnd);
    g.strokeStyle = 'rgba(84,66,48,0.9)'; g.lineWidth = 2; g.lineCap = 'round';
    for (let i = 0; i < 40; i++) {                        // Prop roots: reaching from canopy toward water
      const x = rnd() * S, y = bandY(S, -0.35 + rnd() * 1.1);
      g.beginPath(); g.moveTo(x, y + 5 + rnd() * 4); g.lineTo(x + (rnd() - 0.5) * 4, y - 5 - rnd() * 5); g.stroke();
    }
    g.lineCap = 'butt';
    g.fillStyle = 'rgba(58,74,62,0.5)';                   // Channel pools: water side only
    for (let i = 0; i < 12; i++) brushBlob(g, rnd() * S, bandY(S, 0.25 + rnd() * 0.75), 6 + rnd() * 8, rnd);
  },
};
// Painter keys come from the catalog flat.tex (single seam; cache still keyed by kind) -- MUST NOT
// fall back to kind names directly: that leaves tex as decoration with no consumer, silently stale
// on renames
const _bdTexCache = new Map();
function borderTex(kind) {
  let t = _bdTexCache.get(kind);
  if (t) return t;
  const S = 256;
  const cv = document.createElement('canvas');
  cv.width = cv.height = S;
  let hs = 0;
  for (let i = 0; i < kind.length; i++) hs = (hs * 31 + kind.charCodeAt(i)) | 0;
  BORDER_PAINTERS[BORDER_KINDS[kind].flat.tex](cv.getContext('2d'), S, mulberry32(0xB07D ^ hs));
  t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.MirroredRepeatWrapping;
  registerStreamTex(t);
  _bdTexCache.set(kind, t);
  return t;
}

/**
 * Lay ground cover. Adds into the biomes group; returns stats { patches, details }.
 * @param group     biomes THREE.Group
 * @param terrain   buildTerrain() product
 * @param opts.isBlocked  (x,z)=>bool troop-line / tower / keep clearance
 * @param opts.classifyAt (x,z)=>green/bare/urban/wet/water fallback when classifyPureAt absent
 * @param opts.classifyPureAt pure imagery classification (no field-mix rewrite); carpet and feature
 *                            layers always use it, so puzzle kinds match satellite imagery (courts only
 *                            urban / paddies only green / gravel only bare)
 * @param opts.blockers   building collision posts (patches avoid buildings)
 * @param opts.season / opts.seed / opts.rnd  deterministic environment params
 * @param opts.roadDirAt  (x,z)=>nearest road bearing (rad, atLocal plane angle) or null (no road
 *                        nearby); tidy pieces align to roads; absent = all random (legacy behavior)
 * @param opts.roadClear  (x,z,foot?)=>whether a footprint touches road corridors (bool); feature
 *                        puzzles avoid tarmac so no 3D piece pierces it; absent = no mask (legacy).
 *                        Lookup takes no rnd (rejection before the first rnd() call keeps sequences)
 * @param opts.reservedFootprints  other standalone field/vegetation footprints; merged with blockers
 *                        for puzzles and details
 */
export function buildGroundCover(group, terrain, { isBlocked, classifyAt, classifyPureAt, envCodeAt, blockers, season, seed, rnd, roadDirAt, roadRank, roadClear, roadPolys, reservedFootprints = [], surfaceField = null, environment = {} }) {
  const environmentAt = (x, z) => surfaceEnvironment({ ...environment, season,
    latitude: environment.latitude ?? terrain.center?.lat,
    altitude: terrain.elevationAt?.(x, z) ?? environment.altitude ?? 0 });
  const textureCache = new Map();
  const textureOf = (sub, variant, fit, env) => groundTex(sub, variant, fit, season, env, seed, textureCache);
  // Reuse textures across nearby climate states; altitude must not create one
  // material per tile. Bucket changes never enter placement seeds or seam heights.
  const climateBucket = (bmap, key, x, z) => {
    const env = environmentAt(x, z);
    for (const field of ['snow', 'growth', 'wetness', 'autumn']) env[field] = Math.round(env[field] * 8) / 8;
    const state = [env.snow, env.growth, env.wetness, env.autumn].join('/');
    const b = bucketOf(bmap, key + '@' + state);
    b.surfaceKey = key; b.environment = env;
    return b;
  };
  const generatedSurfaces = [];
  const inb = edgeWallInsetM();
  const classifyPure = classifyPureAt || classifyAt;   // For carpet: un-rewritten zones
  const envAt = envCodeAt || (() => 0);                // Water/marsh classification single seam (biomes.terrainEnvCode; absent = all dry)
  const AQ_DET = new Set(['reed', 'lotuspad', 'fish']);   // Aquatic details: skip shoreline height culling, sit on water
  // Submersion depth in m; 2026-08-13 fish. This is a SUBSET of AQ_DET, not a second roster --
  // reeds/lotus sit on the surface while fish hang below, sharing one shoreline exemption. Too
  // shallow (bottom closer to surface than this number) means skip: a half-buried fish reads worse
  // than no fish (section 4: omit rather than err)
  const DIVE = { fish: 0.5 };
  const buckets = new Map();   // Surface/variant plus local climate state.
  const occupied = makeFootprintIndex([...blockers.map(blockerFoot), ...reservedFootprints]);
  const det = {};
  for (const t in DETAIL_DEFS) det[t] = [];
  let detCount = 0;
  let detCap = FEAT_DETAIL;   // Feature layer spends quota first; relaxed to MAX_DETAIL before carpet scatter
  // ==== Urban-plan grid orientation (2026-07-29 user request: courts/fields/parking/solar blocks
  // should read as planned -- aligned to roads wherever possible) ====
  // Old lesion: roadDirAt only answers within 46m, farther regular structures fell back to fully
  // random yaw; even near roads a reg roll remained (court 0.9 leaves 10 percent random) -- one
  // skewed parking lot by the road reads as unplanned.
  // New rule: regular structures (edge ink) ALWAYS align, in three fallbacks -- near-road (46m)
  // nearest road bearing, then wider radius (GRID_FAR) for same-block arterials, then map-wide grid
  // bearing gridA (road-length-weighted mod-90 circular mean; cadastral grids are symmetric under 90
  // degree rotation, so averaging at 4x angles keeps perpendicular streets from canceling). No map
  // data (empty roadPolys) gives gridA=null and falls back to random (offline fallback unchanged).
  // Zero rnd, pure geometry.
  const GRID_FAR_R2 = 220 * 220;
  // The bearing formula lives only in roadgrid.gridAngle (closed 2026-08-10): offline-baked field
  // bearings eat the same branch, differing only in sample surface -- that side takes only highways
  // (asking where the cadastral grid points) while this side takes all roads (asking where local
  // set-pieces should face). Bit-identical to the old rule.
  let gridA = null;
  if (roadPolys?.length) {
    const segs = [];
    for (const [pts] of roadPolys) {
      for (let i = 1; i < pts.length; i++) segs.push([pts[i - 1][0], pts[i - 1][1], pts[i][0], pts[i][1]]);
    }
    gridA = gridAngle(segs);
  }
  // Tidiness to road alignment: reg = probability that this puzzle/object kind aligns to the
  // nearest road; the rest (or no road nearby) goes random; ink regular structures never roll and
  // always take the three-fallback alignment (above).
  // Randomness discipline (2.3): both branches always draw two first, then decide -- aligning or not
  // never changes rnd consumption; roadDirAt / gridA themselves take no rnd. Returns atLocal plane
  // angle.
  let aligned = 0;   // Aligned-to-road count (puzzles + objects; for smoke audits)
  let bStat = { planned: 0, drawn: 0, forks: 0, forksDrawn: 0 };   // Border puzzles: planned vs drawn
  const orient = (x, z, reg, halfTurn, ink = false) => {
    const ra = rnd() * (halfTurn ? Math.PI : Math.PI * 2);   // Random yaw candidate (fixed count)
    const roll = rnd();                                       // Alignment roll (fixed count)
    if (ink) {                                                // Planned pieces: always align to the road grid
      const a = (roadDirAt ? (roadDirAt(x, z) ?? roadDirAt(x, z, GRID_FAR_R2)) : null) ?? gridA;
      if (a == null) return ra;
      aligned++;
      return a;
    }
    if (!reg || !roadDirAt || roll >= reg) return ra;
    const a = roadDirAt(x, z);
    if (a == null) return ra;
    aligned++;
    return a;
  };
  // ry null = roll tidiness via REG[type] (align to road or random yaw); a fixed angle means an
  // aligned array (trellis/solar/containers run with the print rows), skipping the tidiness roll
  const addDetail = (type, px, pz, s, tintHex = null, sy = 1, ry = null) => {
    // 3D set-pieces MUST NOT stand on dividers either (user: all kinds of 3D objects should not
    // straddle dividers) -- what the line itself grows (step stones / posts / hedges / rocks) comes
    // from BORDER_KINDS ridges, not from ground weeds, seedlings and containers standing on the line.
    // Same rank as existing early-outs, so no rnd consumed
    if (detCount >= detCap || isBlocked(px, pz)) return;
    // No overlap plus never inside someone else functional block (footprints measure real part
    // geometry times this instance scale); same rank as existing early-outs, so no rnd consumed
    // (s is drawn by callers first, sequences unchanged)
    const dr = detailR(type) * s;
    if (bdCross(px, pz, dr) || roadClear?.(px, pz, { x: px, z: pz, r: dr })) return;
    if (px - dr < terrain.minX + inb || px + dr > terrain.maxX - inb
      || pz - dr < terrain.minZ + inb || pz + dr > terrain.maxZ - inb) return;
    if (curInk?.hw != null) {
      const ca = Math.cos(curInk.ry), sa = Math.sin(curInk.ry), dx = px - curInk.x, dz = pz - curInk.z;
      if (Math.abs(dx * ca + dz * sa) + dr > curInk.hw
        || Math.abs(-dx * sa + dz * ca) + dr > curInk.hd) return;
    }
    if (!detFree(px, pz, dr)) return;
    let y = terrain.heightAt(px, pz);
    if (y < 0.4) {
      if (!AQ_DET.has(type)) return;                   // Aquatic details (reeds/lotus/fish) pass
      if (terrain.waterY != null) y = Math.max(y, terrain.waterY);
    }
    const dive = DIVE[type];
    if (dive) {                                        // Hangs below the surface: skip when too shallow (see DIVE)
      const wy = terrain.waterY;
      if (wy == null || terrain.heightAt(px, pz) > wy - dive - 0.2) return;
      y = wy - dive;
    }
    const tl = TILT[type] || 0;   // Random tilt: every instance poses differently
    // atLocal plane angle to three.js rotation.y takes the negative (same ry=-rot convention as rows)
    const variant = groundSeed(px, pz, seed) % DETAIL_VARIANTS[type].length;
    // Rigid objects remain upright and embed their foot ring into rising terrain.
    if (!AQ_DET.has(type) && !dive) {
      let low = y, high = y;
      for (let i = 0; i < 8; i++) {
        const a = i * Math.PI / 4, h = terrain.heightAt(px + Math.cos(a) * dr, pz + Math.sin(a) * dr);
        if (!Number.isFinite(h)) return;
        low = Math.min(low, h); high = Math.max(high, h);
      }
      if (type !== 'solarpanel' && RECT_BASE_DETAILS.has(type) && high - low > .3) return;
      y = low;
    }
    const finalRy = ry ?? -orient(px, pz, REG[type] || 0, false, RECT_BASE_DETAILS.has(type));
    // Ground-conforming: arrayed/linear pieces take terrain gradients into tx/tz (same local frame as
    // instance yaw), the rest keep random tilt; conforming pieces still discard 2 rnd draws as before,
    // zero shared-sequence shift
    let ptx = (rnd() - 0.5) * 2 * (RECT_BASE_DETAILS.has(type) ? 0 : tl);
    let ptz = (rnd() - 0.5) * 2 * (RECT_BASE_DETAILS.has(type) ? 0 : tl);
    if (SLOPE_FIT_DETAILS.has(type)) {
      const e = 1.0;
      const hx1 = terrain.heightAt(px + e, pz), hx0 = terrain.heightAt(px - e, pz);
      const hz1 = terrain.heightAt(px, pz + e), hz0 = terrain.heightAt(px, pz - e);
      if (Number.isFinite(hx1) && Number.isFinite(hx0) && Number.isFinite(hz1) && Number.isFinite(hz0)) {
        const gx = (hx1 - hx0) / (2 * e), gz = (hz1 - hz0) / (2 * e);
        const slope = Math.hypot(gx, gz);
        const c = Math.cos(finalRy), s = Math.sin(finalRy);
        const glx = c * gx - s * gz, glz = s * gx + c * gz;
        const clamp = (v) => Math.max(-0.45, Math.min(0.45, v));
        if (type === 'solarpanel') {
          // Sloped/rolling ground: lay along terrain height (y = low/heightAt), but panel facing keeps
          // its science tilt (latitude-toward-ecliptic); +z faces south
          const latDeg = terrain?.center?.lat ?? 25.0;
          const sciTilt = optimalSolarTiltRad(latDeg);
          const targetWorldAz = (latDeg >= 0 ? 0 : Math.PI); // +z is south
          const relAz = targetWorldAz - finalRy;
          ptx = sciTilt * Math.cos(relAz);
          ptz = sciTilt * Math.sin(relAz);
        } else {
          // Other linear/arrayed pieces on rolling terrain: laid along terrain slope
          ptx = clamp(-Math.atan(glz));
          ptz = clamp(Math.atan(glx));
        }
      } else { ptx = 0; ptz = 0; }
    }
    det[type].push({ x: px, y, z: pz, s, sy, variant, ry: finalRy, tx: ptx, tz: ptz, tint: tintHex });
    detPut(px, pz, dr);
    detCount++;
  };

  const area = terrain.worldW * terrain.worldH / 1e6;
  const target = Math.max(140, Math.min(1800, Math.round(area * 420)));
  let placed = 0;
  let arraysN = 0;   // Street-aligned array block count (for smoke audits; patches includes it)

  // ---- Highland/season zones: measure map-wide height RELIEF (absolute altitude is meaningless;
  // a plateau city would misjudge); relatively high ground switches to plateau/scree/icefield ----
  let hMin = Infinity, hMax = -Infinity, snowAvailable = false;
  for (let j = 0; j <= 20; j++) {
    for (let i = 0; i <= 20; i++) {
      const h = terrain.heightAt(terrain.minX + terrain.worldW * i / 20, terrain.minZ + terrain.worldH * j / 20);
      if (environmentAt(terrain.minX + terrain.worldW * i / 20, terrain.minZ + terrain.worldH * j / 20).snow > .05) snowAvailable = true;
      if (h < hMin) hMin = h;
      if (h > hMax) hMax = h;
    }
  }
  const relief = hMax - hMin;
  const alpineH = relief > 40 ? hMin + relief * 0.62 : Infinity;   // Flat maps grow no highland kinds
  const zoneLists = { ...ZONES };
  const carpetLists = { ...CARPET };
  if (snowAvailable) {                  // Snow requires cold and available moisture.
    zoneLists.bare = ['icefield', ...ZONES.bare, 'icefield'];
    zoneLists.alpine = ['plateau', 'icefield', 'scree', 'icefield', 'plateau', 'icefield'];
    carpetLists.bare = ['icefield', ...CARPET.bare, 'icefield'];
    carpetLists.alpine = ['icefield', 'plateau', 'icefield', 'scree', 'icefield'];
  }
  // Carpet rosters sorted into color paths (carpetOrder; 2026-08-13 user request: same type should
  // not jump sub-kinds at short range) -- picking maps low-frequency noise t to roster index, and if
  // index adjacency is not color adjacency, colors jump no matter how smooth t is. MUST sort AFTER the
  // winter override (winter rosters are newly built lists, unsorted means missed), and enclave rosters
  // MUST sort too (at encRt build); missing either roster source leaves some area still jumping.
  for (const zn in carpetLists) carpetLists[zn] = carpetOrder(carpetLists[zn]);
  // coarse zone lookup (sub to zone): shared by border styles (planSeamOverlays) and border covers
  // (single seam)
  const subCoarse = new Map();
  for (const zn in carpetLists) for (const s of carpetLists[zn]) if (!subCoarse.has(s)) subCoarse.set(s, zn);
  subCoarse.set('watertile', 'water'); subCoarse.set('deepwater', 'water');
  const coarseOfKey = (key) => subCoarse.get(key.slice(0, key.indexOf('#'))) || 'green';
  // Zones each surface may appear in (feature + carpet roster union): tryPatch always gates on this,
  // family extensions (salt pan to fish pond, farmland patchwork) crossing into foreign zones or past map-data edges are blocked outright
  const subZones = new Map();
  for (const lists of [zoneLists, carpetLists]) {
    for (const zn in lists) {
      for (const sub of lists[zn]) {
        let s = subZones.get(sub);
        if (!s) { s = new Set(); subZones.set(sub, s); }
        s.add(zn);
      }
    }
  }
  const zoneAt = (x, z) => {
    if (surfaceField) return surfaceField.sample(x, z);
    // Water/marsh go through envCode first (same rule as server mask and wading check = WYSIWYG):
    // water returns water (no feature patch roster, so no venue puzzle may land in water); marsh returns wet (enables wetland features)
    const ec = envAt(x, z);
    if (ec === 1) return 'water';
    if (ec === 2) return 'wet';
    let zn = classifyPure(x, z);
    if ((zn === 'green' || zn === 'bare') && terrain.heightAt(x, z) > alpineH) zn = 'alpine';
    return zn;
  };

  // ==== Carpet layer: jittered grid tiles all land seamlessly ====
  // Corner positions derive from grid-index hash alone, so adjacent cells share the same corner and faces are watertight by construction;
  // jitter of +-0.45 cell (under half a cell, so topology never flips) renders borders as hand-drawn fractals instead of straight grid lines.
  const carpetBuckets = new Map(), spillBuckets = new Map(), bandBuckets = new Map();
  const CLIFT = 0.07, SLIFT = 0.10;                     // carpet 0.070 < spillover [0.100,0.107] < irregular fade [.110,.124] < regular ink [.135,.172] < road 0.18
  const cell = Math.max(13, Math.max(terrain.worldW, terrain.worldH) / 232);
  // Drape lift (see file header SAG): one field, but each layer passes its own chord length (header item 6) -- border-puzzle ring spacing is
  // around 2m and field ridges 3m, so lifting with the carpet 6.5m chord over-lifts tenfold (proportional to chord squared) and tops out at MAX 0.6m as a floating platform.
  // In-map carpet / spillover / ridge are no longer consumers (since 2026-08-13 they eat terrain triangles directly, loss is always 0).
  // Caps split by location, and all three branches are pure functions of (x,z), so one point always yields one value and lifting itself never tears the skin.
  const inMap = (x, z) => x >= terrain.minX && x <= terrain.maxX && z >= terrain.minZ && z <= terrain.maxZ;
  const drapeSag = (hAt, x, z, r) => {
    if (SAG_OFF) return 0;
    const inb = inMap(x, z);
    const s = groundSagAt(hAt, x, z, r ?? (inb ? cell : cell * BUF_CELL_F) / 2);
    if (!inb) return Math.min(s, SAG.BUF);
    // Road corridors clamp tighter: the roadbed was already graded flat by gradeRoadBeds, so there is almost no crease left there,
    // while lifting past 0.11 would push turf above the road surface (section lift ladder)
    return Math.min(s, roadClear?.(x, z) ? SAG.ROAD : SAG.MAX);
  };
  // Spillover uses a tiny per-key lift delta (0-0.007, still under the fade floor 0.110): when foreign-key spillovers overlap in one cell this
  // avoids coplanar depth fighting (old rule dropped the later full sheet in depth test = hard gap at border corners); draw order (renderOrder)
  // follows the same hash, so lower draws first and higher covers, keeping blends continuous and deterministic across clients (2.3, no rnd)
  const seamLift = (key) => {
    let h = 0;
    for (let i = 0; i < key.length; i++) h = (h * 31 + key.charCodeAt(i)) | 0;
    return ((h >>> 3) % 8) * 0.001;
  };
  // Hand-drawn fractal ripple wavenumber for transition bands (world wavelength about 1.6 cells: narrower than the border band, wider than vertex spacing)
  const SEAM_QC_W = (2 * Math.PI) / (cell * 1.6);
  const gnx = Math.ceil(terrain.worldW / cell), gnz = Math.ceil(terrain.worldH / cell);
  // ==== Quasicrystal field (quasicrystal; aperiodic backbone of irregular patchwork; shared seam for carpet corners, picking, details) ====
  // Sum of 5 directional plane waves (directions k pi/5 give tenfold symmetry = isotropic, aperiodic). Pure function: same seed and coords give same value,
  // consistent across the room and clients (2.3); phases derive from seed, so each map differs while one room agrees. Zero rnd / zero Math.random (A4).
  // One field scaled by wavenumber w feeds three scales: corner de-gridding (coarse), carpet picking clusters (mid), detail blue-noise (fine).
  const QC_N = 5;
  const QC_DIR = [];
  for (let k = 0; k < QC_N; k++) QC_DIR.push([Math.cos(k * Math.PI / QC_N), Math.sin(k * Math.PI / QC_N)]);
  const QC_PH = QC_DIR.map((_, k) => {
    let n = (seed ^ Math.imul(k + 1, 0x9E3779B1)) | 0;
    n = Math.imul(n ^ (n >>> 15), 0x2C1B3C6D);
    return ((n ^ (n >>> 13)) >>> 0) / 4294967296 * Math.PI * 2;
  });
  // Field value strictly in [-1,1] (N cosines over N), so corner offsets budget exactly +-0.45
  const qcVal = (x, z, w) => {
    let s = 0;
    for (let k = 0; k < QC_N; k++) s += Math.cos(w * (QC_DIR[k][0] * x + QC_DIR[k][1] * z) + QC_PH[k]);
    return s / QC_N;
  };
  // Unit gradient vector of the field (points at nearest crest); near-flat returns [0,0]
  const qcGrad = (x, z, w) => {
    let gx = 0, gz = 0;
    for (let k = 0; k < QC_N; k++) {
      const s = -Math.sin(w * (QC_DIR[k][0] * x + QC_DIR[k][1] * z) + QC_PH[k]);
      gx += s * QC_DIR[k][0]; gz += s * QC_DIR[k][1];
    }
    const m = Math.hypot(gx, gz);
    return m < 1e-6 ? [0, 0] : [gx / m, gz / m];
  };
  // Detail blue-noise nudge: white-noise drops shift 0.7m toward the nearest crest (under quarter wavelength, so declumping never hard-snaps); pure function, no rnd
  const DET_QC_W = (2 * Math.PI) / 2.6;
  const qcNudge = (px, pz) => { const [gx, gz] = qcGrad(px, pz, DET_QC_W); return [px + gx * 0.7, pz + gz * 0.7]; };
  const QC_SEL_W = CARPET_SEL.QC_W;   // Carpet subtype cluster modulation wavenumber (single seam, see CARPET_SEL)

  const cornH = (i, j, s) => {                          // Hand-drawn grain (fractal detail stacked on the quasicrystal field)
    let n = ((i * 374761393 + j * 668265263) ^ (seed ^ s)) | 0;
    n = Math.imul(n ^ (n >>> 13), 1274126177);
    return ((n ^ (n >>> 16)) >>> 0) / 4294967296;
  };
  // Corner offset = quasicrystal field (major +-0.34) + cornH grain (minor +-0.10); grid-index (i,j) input is natively a pure function of (i,j),
  // so adjacent cells sharing a corner index get the same offset, hence watertight. dz decouples via a second offset quasicrystal sample. Total amplitude 0.44 < 0.45,
  // clampD as insurance, so worst-case opposing corners stay 0.88 < 1.0 and topology never flips. Cache (i,j) -> [x,z]: saves recompute and guarantees bit-identical shared corners.
  const QC_CORN_W = 1.75, QC_CORN_A = 0.34, QC_CORN_G = 0.20;
  const clampD = (d) => (d < -0.45 ? -0.45 : d > 0.45 ? 0.45 : d);
  const _cornCache = new Map();
  const cornerAt = (i, j) => {
    const ck = i * 65536 + j;
    let c = _cornCache.get(ck);
    if (c) return c;
    const dx = clampD(QC_CORN_A * qcVal(i, j, QC_CORN_W) + QC_CORN_G * (cornH(i, j, 0x9E37) - 0.5)) * cell;
    const dz = clampD(QC_CORN_A * qcVal(i + 8123.5, j + 2971.3, QC_CORN_W) + QC_CORN_G * (cornH(i, j, 0x85EB) - 0.5)) * cell;
    const x = terrain.minX + i * cell + dx, z = terrain.minZ + j * cell + dz;
    c = [Math.min(terrain.maxX, Math.max(terrain.minX, x)),
         Math.min(terrain.maxZ, Math.max(terrain.minZ, z))];
    _cornCache.set(ck, c);
    return c;
  };
  // Low-frequency watercolor wash (continuous function, so no steps across cells; anti-repetition measure from botw_plan Task 2.1)
  const wash = (x, z) => 0.88 + (vnoise(x * 0.011, z * 0.011, seed ^ 0x5A5A) - 0.5) * 0.34;
  // Cell zoning: 5-point majority vote (smooths per-cell flicker from satellite pixel noise) + slope rules
  //   cliff (>0.75) -> '!' unpaved (top-projected UV streaks on near-vertical faces, so exposed rock reads more natural,
  //                  neighbor spillover fades to seal the seam); mid slope (>0.28) -> forced bare (hillsides are never parking lots)
  //   low green near water (within +2.2m of water surface) -> wet (riparian reed belt)
  // Carpet coarse zoning (zoning half of cellKeyAt; pure function, zero rnd): 'water' / '!' / null (unpaved) / zone.
  // Whole map is zoned into zoneGrid first, then planEnclaves judges small-area wrapping; cellKeyAt picks sub from the budgeted zn.
  const cellZoneAt = (i, j) => {
    const cx = terrain.minX + (i + 0.5) * cell, cz = terrain.minZ + (j + 0.5) * cell;
    // Water/marsh-only puzzles (2026-07-22, same rule as envCode and server mask = WYSIWYG):
    // water (1) always gets a water puzzle (no slope or shoreline culling -- flat water reads best when recognizable).
    const ec = envAt(cx, cz);
    if (ec === 1) return 'water';
    const hC = terrain.heightAt(cx, cz);
    const slope = Math.max(
      Math.abs(terrain.heightAt(cx + cell, cz) - hC),
      Math.abs(terrain.heightAt(cx, cz + cell) - hC)) / cell;
    if (slope > 0.75) return 'cliff';
    const votes = {};
    for (const [ox, oz] of [[0, 0], [cell * 0.4, 0], [-cell * 0.4, 0], [0, cell * 0.4], [0, -cell * 0.4]]) {
      const zn0 = classifyPure(cx + ox, cz + oz);
      votes[zn0] = (votes[zn0] || 0) + 1;
    }
    let zn = Object.keys(votes).reduce((a, b) => (votes[b] > votes[a] ? b : a));
    if (zn === 'water') zn = slope > 0.28 ? 'bare' : 'green'; // Dry land never exposes satellite imagery; safe downgrade at surface level.
    if (slope > 0.28 && zn !== 'wet') zn = 'bare';
    // Marsh (2) always gets a wetland puzzle (replaces the old private green-and-low rule -- unified with envCode)
    if (ec === 2) zn = 'wet';
    if ((zn === 'green' || zn === 'bare') && hC > alpineH) zn = 'alpine';
    return zn;
  };
  // Picking (color) half: zn = budgeted zone from zoneGrid -> surface name / '!' / null.
  // Variants (motifs) are NOT picked here -- planCarpetVariants picks per cell after the whole subGrid is done,
  // which is the only way adjacent same-color puzzles get different motifs (independent per-cell picking would collide).
  const cellSubAt = (i, j, zn) => {
    if (zn == null || zn === 'cliff') return zn;
    const cx = terrain.minX + (i + 0.5) * cell, cz = terrain.minZ + (j + 0.5) * cell;
    if (zn === 'water') {                               // Match shallow/deep to depth (depth is physical, read per cell)
      const wy = terrain.waterY;
      return wy != null && terrain.heightAt(cx, cz) < wy - 2.5 ? 'deepwater' : 'watertile';
    }
    // Multi-level combo style: small areas wrapped inside a foreign large area switch to the enclave-only carpet (single source of truth ENCLAVE_STYLES)
    const available = encRt.get(encGrid[j * gnx + i])?.style.carpet || carpetLists[zn];
    if (!available) return null;
    const env = environmentAt(cx, cz);
    const list = available.filter(sub => surfaceAllowed(sub, env));
    if (!list.length) return null;
    // Sample point = picking-block (lot) center, not cell center (carpetLotAt single seam, 2026-08-12 user decision):
    // one lot always yields one pick, so colors inside one terrain hold for at least one lot (about 6 cells) before changing.
    // The field formula is untouched (same vnoise plus same quasicrystal term); only the sample location changes.
    const [, , li, lj] = carpetLotAt(i, j, seed);
    const lx = terrain.minX + li * cell, lz = terrain.minZ + lj * cell;
    let t = (vnoise(lx * CARPET_SEL.W, lz * CARPET_SEL.W, seed) - 0.5) * CARPET_SEL.SPAN + 0.5;
    if (zn !== 'urban') t += qcVal(lx, lz, QC_SEL_W) * CARPET_SEL.QC_A;   // Irregular zones stack quasicrystal, so cluster borders stay aperiodic
    t = Math.min(0.999, Math.max(0, t));
    return list[(t * list.length) | 0];
  };
  // Cell geometry: 3x3 ground-hugging grid (edge midpoints = midpoints of shared corners, so adjacent cells share every point, watertight;
  // near-half-cell sampling lets cells follow terrain relief, so hilltops no longer poke through carpet); vertex color = wash
  // cut = (di, dj) neighbor direction: this spillover sheet takes alpha from bdCutAt by band-signed distance to the drawn line
  // (both terrains split at the line); only falls back to the old fade when no line is found.
  // Emission core for ground-hugging 3x3 faces. Since 2026-08-13 it serves only the buffer ring (in-map carpet / spillover / ridge
  // moved to emitCell adopting terrain triangles, see that header): outside the map stands the terrain.js skirt ring with no height grid
  // to adopt, so that half stays a draped skin and still needs drapeSag to compensate chord loss (cap SAG.BUF).
  //   G  = nine [x, z] points (3x3 layout, rows along z, columns along x)
  //   hAt = height function -- the buffer ring uses terrain.bufferHeightAt (sole seam for skirt extrapolated height;
  //         heightAt would clamp back to the map edge and paste the whole ring at the wrong height)
  const emitFace = (bmap, key, G, hAt, alphas, st, cut) => {
    const sub = key.slice(0, key.indexOf('#'));
    const aq = !!DEFS[sub].aq;                          // Aquatic puzzle: skips shoreline culling, vertices clamp above water (visible)
    let hs = G.map(([px, pz]) => hAt(px, pz));
    if (!aq && Math.min(...hs) < 0.45) return null;     // Shore gap stays open = beach line, never pave underwater
    if (aq && terrain.waterY != null) hs = hs.map((hh) => Math.max(hh, terrain.waterY + 0.05));
    const [aA, aB, aC, aD] = alphas || [1, 1, 1, 1];
    const AL = [aA, (aA + aB) / 2, aB,
                (aD + aA) / 2, (aA + aB + aC + aD) / 4, (aB + aC) / 2,
                aD, (aC + aD) / 2, aC];
    const uvS = DEFS[sub].uvS || 1 / 12;
    // Mid-state ridge band (st.band) always presses above other spillovers (0.108 still under the fade floor 0.110) -- it is
    // a third surface laid over both side fades; ordinary spillover uses the per-key micro lift instead
    const lift = alphas ? (st?.band ? SLIFT + 0.008 : SLIFT + seamLift(key)) : CLIFT;
    const b = climateBucket(bmap, key, G[4][0], G[4][1]);
    G.forEach(([px, pz], k) => {
      const w = wash(px, pz);
      let a = AL[k];
      // Cut lines win and overwrite unconditionally per vertex (corner weights ignored): the line can cross mid-cell, and gating on corner
      // weights would leave the half-cell that should flip but weighs 0 on the old terrain = the leak persists
      const cutA = cut ? bdCutAt(px, pz, cut.di, cut.dj) : null;
      if (cutA != null) a = cutA;
      else if (alphas && a > 0 && a < 1) {
        // 交界頂點 α 塑形(seamAlpha 純函式,樣式 = 逐分區組合查表):明確邊界壓窄、
        // 柔和淡出疊碎形擾動、雪線推成斑塊。端點 α=0/1 恆定 ⇒ 與不透明底毯/淡出盡頭
        // 仍水密;純函數(世界座標+seed)⇒ 相鄰外溢格共用頂點同值不開縫(§2.3 零 rnd)
        a = seamAlpha(a, qcVal(px, pz, SEAM_QC_W), st);
      }
      b.pos.push(px, hs[k] + lift + drapeSag(hAt, px, pz), pz);
      b.nrm.push(0, 1, 0);
      pushLandN(b, hAt, px, pz, terrain.gridM);
      b.uv.push(px * uvS, pz * uvS);
      b.col.push(w, w, w, a);
    });
    for (let v = 0; v < 2; v++) {                       // 2×2 小格,面朝 +y
      for (let u = 0; u < 2; u++) {
        const a2 = b.base + v * 3 + u, e = a2 + 1, f = a2 + 3, g2 = f + 1;
        b.idx.push(a2, f, e, e, f, g2);
      }
    }
    b.base += 9;
    return G[4];
  };
  // 四角 → 3×3 排列(列沿 z、行沿 x):P0 E01 P1 / E30 M E12 / P3 E23 P2。
  // 邊中點 = 共用角點的中點 ⇒ 相鄰 cell 完全同點,拼面天生水密(圖內與緩衝空間同吃)
  const face9 = (P0, P1, P2, P3) => {
    const mid = (a2, b2) => [(a2[0] + b2[0]) / 2, (a2[1] + b2[1]) / 2];
    return [P0, mid(P0, P1), P1,
            mid(P3, P0), mid(mid(P0, P1), mid(P3, P2)), mid(P1, P2),
            P3, mid(P3, P2), P2];
  };
  // ==== 圖內底毯:認養地形三角形(2026-08-13 使用者定案「A 認養地形三角形」)====
  // 舊制底毯自己切一張 3×3 貼地網格,頂點取 heightAt ⇒ **頂點恆在地形上,而頂點與頂點之間
  // 是直的**;地形不是(逐格三角化的高度場,格線上有折角)。皮的邊長 ≈ 半個 cell(6.5m)
  // 而地形格距 8.5m ⇒ 幾乎每一條邊都橫跨折角,弦沉在地形下 = 使用者回報的「斜坡破圖」
  // (taroko 實測 22% 三角形被戳穿),SAG 那一層就是在補這件事。
  // 新制:**皮的三角形就是地形的三角形** —— 規劃層一行不動,只把「畫在哪些三角形上」改成
  // 逐地形四邊形認養主人格。共面 ⇒ 破圖恆為 0(是結構保證,不是「小於門檻」)。四條:
  //  ①**規劃層零改動**:cornerAt 抖動 / zoneGrid / subGrid / varGrid / planSeamOverlays 全部
  //    照舊 ⇒ lot 尺度、SEAM_QC_W、界線 run 長、BUF_CELL_F 那一票 cell 衍生常數一個都不用重調。
  //  ②**灘線閘仍以 face9 九點整格判**,MUST NOT 改成逐四邊形判:那一閘決定 landCells,而
  //    landCells 餵底毯細節撒佈 ⇒ 逐四邊形會多鋪半格、多撒幾株草,共享 rnd 序列整條推移(§2.3)。
  //  ③**圖內底毯 MUST NOT 再套 drapeSag**:頂點與三角形都已經是地形自己的,再抬就是**浮在
  //    地形上**,那同樣是破圖(SAG 檔頭 ⑤ 的同一條)。緩衝空間那一半站在裙上、沒有地形網格
  //    可認養,仍走 emitFace + SAG.BUF。
  //  ④**認養判定用 PNPOLY**(射線穿越數),MUST NOT 拿對角線拆成兩個三角形:抖動後的四邊形
  //    可以是凹的,對角線會跑到多邊形外 ⇒ 那一塊沒有主人、地形直接露出來,而畫面上只是偶爾
  //    一格禿掉。候選只掃 3×3(抖動 < 0.45 格 ⇒ 主人恆在其中;稽核以暴力搜尋逐格對照)。
  // 地形頂點數**推導不手寫**(terrain 只對外給 gridM = x 軸格距;z 軸格距要用 worldH 自己回推,
  // 非方形戰場兩軸不同)。
  const NTV = Math.round(terrain.worldW / terrain.gridM) + 1;
  const TGX = terrain.worldW / (NTV - 1), TGZ = terrain.worldH / (NTV - 1);
  const tvx = (a) => terrain.minX + a * TGX;
  const tvz = (b) => terrain.minZ + b * TGZ;
  // 切線帶內的細分數**推導不手寫**:子邊長 ≤ 半個 `BORDER_CUT.W` ⇒ α 的斜坡收得進換手帶。
  // 只作用在線真的穿過的那一排四邊形(見 emitCell),其餘一格未動。
  const CUT_SUB = Math.max(1, Math.ceil(Math.max(TGX, TGZ) / BORDER_CUT.W));
  const quadOf = (ti, tj) => [cornerAt(ti, tj), cornerAt(ti + 1, tj),
                              cornerAt(ti + 1, tj + 1), cornerAt(ti, tj + 1)];
  // PNPOLY:半開邊 ⇒ 落在兩格共用邊上的點恰有一個主人(不會兩格都畫或都不畫)
  const inQuad = (Q, px, pz) => {
    let inside = false;
    for (let a = 0, c = 3; a < 4; c = a++) {
      const zi = Q[a][1], zc = Q[c][1];
      if ((zi > pz) !== (zc > pz)
          && px < (Q[c][0] - Q[a][0]) * (pz - zi) / (zc - zi) + Q[a][0]) inside = !inside;
    }
    return inside;
  };
  // 反雙線性(P(u,v) = A + u·e + v·f + uv·g 的解):外溢 α 是給在**規劃格四角**的,而地形
  // 頂點落在格內任意位置。角上恆等 ⇒ 相鄰格共用的那顆地形頂點兩邊算出同一個 α,淡出不開縫。
  const invBil = (Q, px, pz) => {
    const [A, B, C, D] = Q;
    const ex = B[0] - A[0], ez = B[1] - A[1];
    const fx = D[0] - A[0], fz = D[1] - A[1];
    const gx = A[0] - B[0] + C[0] - D[0], gz = A[1] - B[1] + C[1] - D[1];
    const hx = px - A[0], hz = pz - A[1];
    const cr = (ax, az, bx, bz) => ax * bz - az * bx;
    const k2 = cr(gx, gz, fx, fz);
    const k1 = cr(ex, ez, fx, fz) + cr(hx, hz, gx, gz);
    const k0 = cr(hx, hz, ex, ez);
    // 給定 v 回 u:分母取兩軸絕對值大的那一個(另一軸可能剛好退化成 0)
    const uOf = (v) => {
      const dx = ex + gx * v, dz = ez + gz * v;
      const u = Math.abs(dx) > Math.abs(dz) ? (hx - fx * v) / dx : (hz - fz * v) / dz;
      return Number.isFinite(u) ? u : 0;
    };
    let v;
    if (Math.abs(k2) < 1e-9) {
      if (Math.abs(k1) < 1e-12) return [0, 0];
      v = -k0 / k1;
    } else {
      const w2 = k1 * k1 - 4 * k0 * k2;
      if (!(w2 >= 0)) return [0.5, 0.5];                 // 落在映射像之外(數值邊緣)⇒ 取格心
      const w = Math.sqrt(w2), ik2 = 0.5 / k2;
      v = (-k1 - w) * ik2;
      const u0 = uOf(v);
      if (u0 < -1e-6 || u0 > 1 + 1e-6 || v < -1e-6 || v > 1 + 1e-6) v = (-k1 + w) * ik2;
    }
    const u = uOf(v);
    return [Math.min(1, Math.max(0, u)), Math.min(1, Math.max(0, v))];
  };
  // 主人格 → 地形四邊形索引扁平表 [a0, b0, a1, b1, …](純函式、零 rnd,建一次共用)
  const cellQuads = new Array(gnx * gnz);
  let orphanQuads = 0;
  for (let b = 0; b < NTV - 1; b++) {
    const cz = tvz(b + 0.5), nj = Math.floor((cz - terrain.minZ) / cell);
    for (let a = 0; a < NTV - 1; a++) {
      const cx = tvx(a + 0.5), ni = Math.floor((cx - terrain.minX) / cell);
      let own = -1;
      for (let dj = -1; dj <= 1 && own < 0; dj++) {
        const tj = nj + dj;
        if (tj < 0 || tj >= gnz) continue;
        for (let di = -1; di <= 1; di++) {
          const ti = ni + di;
          if (ti < 0 || ti >= gnx) continue;
          if (inQuad(quadOf(ti, tj), cx, cz)) { own = tj * gnx + ti; break; }
        }
      }
      if (own < 0) { orphanQuads++; continue; }
      (cellQuads[own] || (cellQuads[own] = [])).push(a, b);
    }
  }
  // 這一格的底毯是不是貼水種類(切線細分的閘;subGrid 在下面才建,呼叫時早已定案)
  const cellAq = (ti, tj) => {
    const s = subGrid[tj * gnx + ti];
    return !!(s && s !== '!' && DEFS[s]?.aq);
  };
  const emitCell = (bmap, key, ti, tj, alphas, st, cut) => {
    const sub = key.slice(0, key.indexOf('#'));
    const aq = !!DEFS[sub].aq;                          // Aquatic puzzle: skips shoreline culling, vertices clamp above water (visible)
    const Q = quadOf(ti, tj);
    const G = face9(Q[0], Q[1], Q[2], Q[3]);
    // ② 灘線閘:仍以整格九點判(landCells 與共享 rnd 序列逐位元同舊制)
    if (!aq && Math.min(...G.map(([px, pz]) => terrain.heightAt(px, pz))) < 0.45) return null;
    const quads = cellQuads[tj * gnx + ti];
    if (!quads) return null;
    const uvS = DEFS[sub].uvS || 1 / 12;
    // Mid-state ridge band (st.band) always presses above other spillovers (0.108 still under the fade floor 0.110) -- it is
    // a third surface laid over both side fades; ordinary spillover uses the per-key micro lift instead
    const lift = alphas ? (st?.band ? SLIFT + 0.008 : SLIFT + seamLift(key)) : CLIFT;
    const wy = aq && terrain.waterY != null ? terrain.waterY + 0.05 : null;
    const b = climateBucket(bmap, key, G[4][0], G[4][1]);
    const putQuad = (x0, x1, z0, z1) => {
      // 頂點序 (x,z)/(x+1,z)/(x,z+1)/(x+1,z+1),索引取**反對角線** —— 與 terrain.js 的
      // (a,c,b)(b,c,d) 逐字同向 ⇒ 兩張皮的三角形完全重合(共面的本錢在這一行)
      for (const [px, pz] of [[x0, z0], [x1, z0], [x0, z1], [x1, z1]]) {
        const w = wash(px, pz);
        let al = 1;
        if (alphas) {
          // 切線優先且**逐頂點無條件覆寫**(不看角點權重):線可能自格子中間穿過,拿角點權重
          // 當閘門會讓「該換手卻權重為 0」的那半格留在原本的地貌上 = 滲透照樣發生
          const cutA = cut ? bdCutAt(px, pz, cut.di, cut.dj) : null;
          if (cutA != null) al = cutA;
          else {
            const [u, v] = invBil(Q, px, pz);
            al = (1 - u) * (1 - v) * alphas[0] + u * (1 - v) * alphas[1]
               + u * v * alphas[2] + (1 - u) * v * alphas[3];
        // Boundary-vertex alpha shaping (seamAlpha pure function, style = per-zone-combo lookup): crisp borders pinch narrow,
            // 柔和淡出疊碎形擾動、雪線推成斑塊。端點 α=0/1 恆定 ⇒ 與不透明底毯/淡出盡頭
            // 仍水密;純函數(世界座標+seed)⇒ 相鄰外溢格共用頂點同值不開縫(§2.3 零 rnd)
            if (al > 0 && al < 1) al = seamAlpha(al, qcVal(px, pz, SEAM_QC_W), st);
          }
        }
        const hy = terrain.heightAt(px, pz);
        b.pos.push(px, (wy != null ? Math.max(hy, wy) : hy) + lift, pz);
        b.nrm.push(0, 1, 0);
        pushLandN(b, terrain.heightAt, px, pz, terrain.gridM);
        b.uv.push(px * uvS, pz * uvS);
        b.col.push(w, w, w, al);
      }
      b.idx.push(b.base, b.base + 2, b.base + 1, b.base + 1, b.base + 2, b.base + 3);
      b.base += 4;
    };
    for (let n = 0; n < quads.length; n += 2) {
      const x0 = tvx(quads[n]), x1 = tvx(quads[n] + 1);
      const z0 = tvz(quads[n + 1]), z1 = tvz(quads[n + 1] + 1);
      // ---- 切線的解析度(2026-08-13 使用者「還是看到沙灘兩側都有海水」)----
      // 換手是**逐頂點**算的,而自 08-13 認養地形三角形之後頂點就是地形網格頂點(格距 8.5m)
      // ⇒ α 從 1 掉到 0 的斜坡實際寬度是**一整格**,不是 `BORDER_CUT.W`(2.8m)。水那一側的
      // 外溢因此一路淡進陸地將近十公尺,而它是貼水種類(頂點夾到水面)⇒ 讀起來就是
      // 「沙灘的陸側也有海水」。斜坡比帶還寬,帶再怎麼畫都蓋不住。
      // 修法:線真的穿過的那些四邊形細分到 ≤ 半個切線帶寬。**只細分穿過的那一排**
      // (四角 α 不全等)⇒ 其餘逐位元同舊制;而 `terrain.heightAt` 與地形網格是**同一組
      // 三角形內插**(sampleField 的 (a,c,b)/(b,c,d) 分割)⇒ 子頂點恆落在地形面上,
      // 共面一格未失、不會回頭長出貼合破圖。
      // **只給沾到水的那些外溢**:水藍 vs 陸綠是全場色差最大的一對,斜坡寬過帶就直接讀成
      // 「這一側也是水」;陸對陸(圍籬/樹籬/碎石徑那幾種)的兩款顏色相近,同樣寬的斜坡在
      // 畫面上讀不出來,而細分整份外溢層要多十倍的三角形(實測 buildBiomes 1.2 → 4.2s)。
      let div = 1;                                       // (MUST NOT 叫 sub —— 那是上面的地表名)
      if (cut && (aq || cellAq(ti, tj))) {
        const a4 = [[x0, z0], [x1, z0], [x0, z1], [x1, z1]]
          .map(([px, pz]) => bdCutAt(px, pz, cut.di, cut.dj));
        if (a4.some((v) => v !== a4[0])) div = CUT_SUB;
      }
      if (div === 1) { putQuad(x0, x1, z0, z1); continue; }
      for (let sj = 0; sj < div; sj++) {
        for (let si = 0; si < div; si++) {
          putQuad(x0 + (x1 - x0) * si / div, x0 + (x1 - x0) * (si + 1) / div,
                  z0 + (z1 - z0) * sj / div, z0 + (z1 - z0) * (sj + 1) / div);
        }
      }
    }
    return G[4];
  };
  // ==== Multi-level terrain: full-map coarse zoning grid -> enclave wrap check (planEnclaves single seam) ====
  // encGrid[cell] = `${內}@${外}` 樣式鍵或 null;encRt = 樣式執行期物件(set = 該樣式
  // 允許的全部地表 —— tryPatch 放行閘,僅對 enclave 格生效,不讓樣式地表外漏到一般分區)
  const zoneGrid = new Array(gnx * gnz).fill(null);
  for (let j = 0; j < gnz; j++) for (let i = 0; i < gnx; i++) {
    const x = terrain.minX + (i + 0.5) * cell, z = terrain.minZ + (j + 0.5) * cell;
    zoneGrid[j * gnx + i] = surfaceField ? surfaceField.sample(x, z) : cellZoneAt(i, j);
  }
  const encGrid = surfaceField ? new Array(gnx * gnz).fill(null) : planEnclaves(zoneGrid, gnx, gnz, {});
  const encRt = new Map();
  for (const k in ENCLAVE_STYLES) {
    // 樣式的底毯清單同樣排成顏色路徑(carpetOrder;與 carpetLists 同一條規則)。原樣式物件
    // MUST NOT 就地改寫 —— ENCLAVE_STYLES 是模組級常數,改它等於這一場的排序漏到下一場
    const st = ENCLAVE_STYLES[k];
    const style = st.carpet ? { ...st, carpet: carpetOrder(st.carpet) } : st;
    encRt.set(k, { key: k, style, set: new Set([...(st.carpet || []), ...(st.feats || [])]) });
  }
  const encAt = (x, z) => {   // 世界座標 → enclave 執行期樣式(非 enclave = null;不吃 rnd)
    const i = Math.floor((x - terrain.minX) / cell), j = Math.floor((z - terrain.minZ) / cell);
    if (i < 0 || j < 0 || i >= gnx || j >= gnz) return null;
    const k = encGrid[j * gnx + i];
    return k ? encRt.get(k) : null;
  };

  // 底毯 = 兩段:先整張挑**顏色**(款;lot 量化 ⇒ 同地貌內顏色慢慢換),再整張挑**花紋**
  // (變體;逐格互異 ⇒ 同顏色的相鄰拼圖圖案不同)。兩支都是純函式,不動共享 rnd 序列。
  const subGrid = new Array(gnx * gnz).fill(null);
  for (let j = 0; j < gnz; j++) for (let i = 0; i < gnx; i++) subGrid[j * gnx + i] = cellSubAt(i, j, zoneGrid[j * gnx + i]);
  const varGrid = planCarpetVariants(subGrid, gnx, gnz, { seed, variants: CARPET_VARIANTS });
  const keys = new Array(gnx * gnz).fill(null);
  const landCells = [];                                 // [x, z, key]:底毯細節撒佈用
  if (!surfaceField) for (let j = 0; j < gnz; j++) {
    for (let i = 0; i < gnx; i++) {
      const sub = subGrid[j * gnx + i];
      if (!sub) continue;
      if (sub === 'cliff') { keys[j * gnx + i] = 'cliff'; continue; }
      const key = `${sub}#${varGrid[j * gnx + i]}`;
      const mid = emitCell(carpetBuckets, key, i, j, null);
      if (!mid) continue;
      keys[j * gnx + i] = key;
      landCells.push([mid[0], mid[1], key]);
    }
  }
  // ==== Buffer-ring carpet (2026-08-12 user decision: buffer ring past the border also gets terrain patches) ====
  // 緩衝空間 = terrain.js 那一圈外緣裙(深度 terrain.bufferM,見該檔 ⑧);舊制它只有地形材質(影像鏡射
  // 平鋪 / 屬性場色階)⇒ 站在邊界往外看是「圖內鋪著拼圖、過了圖界突然變回一張照片」的硬界。
  // 五條:
  //  ①**分區與選款一律鏡射回圖內取**(與 terrain.js 裙的 UV 同一個三角波):鏡射在圖界上是
  //    恆等 ⇒ 接縫兩側取到同一格 = 同一款,再往外是這張圖自己的地貌翻過去又翻回來。界外沒有
  //    影像也沒有圖資,classifyPure 在那裡本來就沒有答案(§4 寧缺勿錯:不是猜一個,是照抄自己)。
  //  ②**格距放粗** BUF_CELL_F 倍:它離可玩區至少 `edgeWallInsetM()`、最遠 455m,細節看不到,
  //    而原尺寸鋪滿要多兩倍半的格子。
  //  ③**高度走 terrain.bufferHeightAt**(裙的外推高度唯一縫);取不到就整圈不鋪(降級不例外)。
  //  ④**只鋪底毯**:界線拼圖/特徵拼圖/3D 細節一律不進緩衝空間(看不到,而那些都要吃共享
  //    rnd 序列與空間索引)。底毯與**交界外溢**共用圖內那兩批 buckets ⇒ 一個 draw call 都沒有多。
  //  ⑤**零共享 rnd 消耗**(§2.3):整段純函式取值,插在哪裡都不推移植被佈局。
  //  ⑥**角點抖動 + 交界外溢照走** —— 少了這兩樣,粗格 + 硬邊就是一床方塊拼被(2026-08-12 實拍:
  //    站在邊界往外看是一片直角接直角的色塊,比舊制那張糊掉的衛星圖更假)。圖界那兩條線上的
  //    角點**不准抖**(那是與真地形的接縫,動了就開縫);外溢走的是圖內同一支 planSeamOverlays。
  let bufCells = 0;
  if (!surfaceField && terrain.bufferHeightAt) {
    const B = terrain.bufferM;   // 深度讀地形實際鋪的那一份(見 terrain.js ⑧)
    const bcell = cell * BUF_CELL_F;
    const nOut = Math.max(1, Math.ceil(B / bcell));
    // 三角波鏡射(同 terrain.js 裙):在 [lo, hi] 的兩端恆等 ⇒ 接縫逐點同款
    const mirror = (v, lo, hi) => {
      const span = hi - lo;
      if (!(span > 0)) return lo;
      const t = Math.abs(((v - lo) % (2 * span) + 2 * span) % (2 * span));
      return lo + (t <= span ? t : 2 * span - t);
    };
    // 非均勻軸:外帶(nOut 格粗格)+ 內域(照樣切成粗格,但整塊跳過 = 真地形的地盤)+ 外帶
    const axis = (lo, hi) => {
      const nin = Math.max(1, Math.ceil((hi - lo) / bcell)), a = [];
      for (let k = nOut; k > 0; k--) a.push(lo - (B * k) / nOut);
      for (let k = 0; k <= nin; k++) a.push(lo + ((hi - lo) * k) / nin);
      for (let k = 1; k <= nOut; k++) a.push(hi + (B * k) / nOut);
      return a;
    };
    const xs = axis(terrain.minX, terrain.maxX), zs = axis(terrain.minZ, terrain.maxZ);
    const bnx = xs.length - 1, bnz = zs.length - 1;
    const inX = bnx - nOut, inZ = bnz - nOut;            // 內域格索引 [nOut, in*)
    const BJ = bcell * 0.3;                              // 角點抖動幅度(< 半格 ⇒ 拓撲不翻面)
    const bcorner = (i, j) => [
      xs[i] + ((i === nOut || i === inX) ? 0 : (vnoise(i, j, (seed ^ 0x2AC1) | 0) - 0.5) * 2 * BJ),
      zs[j] + ((j === nOut || j === inZ) ? 0 : (vnoise(i, j, (seed ^ 0x5D31) | 0) - 0.5) * 2 * BJ)];
    const bFace = (i, j) => face9(bcorner(i, j), bcorner(i + 1, j), bcorner(i + 1, j + 1), bcorner(i, j + 1));
    const bkeys = new Array(bnx * bnz).fill(null);
    for (let j = 0; j < bnz; j++) {
      for (let i = 0; i < bnx; i++) {
        if (i >= nOut && i < inX && j >= nOut && j < inZ) continue;
        const mx = mirror((xs[i] + xs[i + 1]) / 2, terrain.minX, terrain.maxX);
        const mz = mirror((zs[j] + zs[j + 1]) / 2, terrain.minZ, terrain.maxZ);
        const ki = Math.min(gnx - 1, Math.max(0, Math.floor((mx - terrain.minX) / cell)));
        const kj = Math.min(gnz - 1, Math.max(0, Math.floor((mz - terrain.minZ) / cell)));
        const key = keys[kj * gnx + ki];
        if (!key || key === '!') continue;               // 圖內那一格沒鋪(崖/灘線/灰帶)⇒ 界外也不鋪
        if (!emitFace(carpetBuckets, key, bFace(i, j), terrain.bufferHeightAt, null, null, null)) continue;
        bkeys[j * bnx + i] = key;
        bufCells++;
      }
    }
    // 交界外溢:走圖內同一支規劃器(單一縫)—— 沒有它,粗格之間就是硬邊直角
    for (const ov of planSeamOverlays(bkeys, bnx, bnz, { coarseOf: coarseOfKey, seed, variants: VARIANTS })) {
      emitFace(ov.st?.band ? bandBuckets : spillBuckets, ov.key, bFace(ov.i, ov.j),
               terrain.bufferHeightAt, ov.alphas, ov.st, null);
    }
  }
  // ==== Terrain border puzzle: planning + spatial index (2026-08-11) ====
  // Planning MUST run after carpet but before spillover and feature puzzles -- all three consumers eat this one copy (single seam):
  //   (1) spillover cut line bdCutAt (both terrain sides split exactly at the line)
  //   (2) feature-puzzle and 3D-detail avoidance bdCross (fields, lots, courts, props MUST NOT straddle the line)
  //   (3) geometry emission (the Terrain border puzzle emission block below)
  // planBorderPuzzle is a pure function (zero rnd), so calling it early never shifts the shared rnd sequence (2.3); tryPatch
  // bdCross rejection shares position with roadClear, ranked before the first rnd() call, so the scatter-sequence discipline holds.
  const coarseOf = (key) => (key && key !== '!') ? coarseOfKey(key) : null;
  const bdSubOf = (k) => { const p = k.indexOf('#'); return p < 0 ? k : k.slice(0, p); };
  // 半寬取型錄真值;flat 再乘上帶緣起伏的最外緣 ⇒ 讓路取樣與迴避半徑恆蓋得住真的畫出來的邊
  const hwOfKind = (k) => {
    const d = BORDER_KINDS[k];
    return Math.max(d.flat ? d.flat.w / 2 * (1 + BORDER_BAND.EDGE_A) : 0, d.ridge ? d.ridge.w / 2 : 0);
  };
  const bdPlan = surfaceField ? { chains: [], corners: [], forks: [] } : planBorderPuzzle(keys, gnx, gnz, {
    // 地貌取**格子自己的分區**(zoneGrid,與底毯選款同一份),不由款式反查
    zoneOf: (i, j) => zoneGrid[j * gnx + i],
    coarseOf, cornerXZ: cornerAt, driftMax: cell * 0.6,
    halfWidthOf: hwOfKind, runMinM: cell * BORDER_BAND.RUN_MIN_CELL,
  });
  // 中心線段空間索引:存**退縮前**的端點 —— 那才是完整連續的界線曲線(退縮只是把接頭那一小段
  // 空間讓給轉彎/岔路拼圖,界線並沒有斷)。逐段沿線走訪、每個取樣點連 3×3 鄰格一起登記 ⇒
  // 查詢只掃自己那一格,而半徑 ≤ BSC 的東西保證找得到。
  const BSC = Math.max(24, cell * 2);
  const BD_HW_MAX = Math.max(...Object.keys(BORDER_KINDS).map(hwOfKind));   // 最寬的一種(掃描格數用)
  const bdGrid = new Map();
  for (const ch of bdPlan.chains) {
    for (const tl of ch.tiles) {
      const sg = { x0: tl.x0, z0: tl.z0, x1: tl.x1, z1: tl.z1, hw: hwOfKind(tl.kind) };
      const dx = sg.x1 - sg.x0, dz = sg.z1 - sg.z0;
      const n = Math.max(1, Math.ceil(Math.hypot(dx, dz) / (BSC * 0.5)));
      const seenC = new Set();
      for (let s = 0; s <= n; s++) {
        const ci = Math.floor((sg.x0 + dx * s / n) / BSC), cj = Math.floor((sg.z0 + dz * s / n) / BSC);
        for (let oj = -1; oj <= 1; oj++) {
          for (let oi = -1; oi <= 1; oi++) {
            const gk = `${ci + oi},${cj + oj}`;
            if (seenC.has(gk)) continue;
            seenC.add(gk);
            let arr = bdGrid.get(gk);
            if (!arr) { arr = []; bdGrid.set(gk, arr); }
            arr.push(sg);
          }
        }
      }
    }
  }
  // 掃過查詢半徑覆蓋到的每一格。**格數 MUST 由半徑推導**:索引只保證「段附近一圈」的格子
  // 有它,而拼圖的迴避半徑(足跡 + 帶半寬 + PAD)可以到 45m 遠大於一格 —— 只掃自己那一格
  // 的話,大塊水田的中心離線 30m 就查不到那條線,而它的角早就壓在帶上了(2026-08-11 實測)
  const bdEach = (x, z, R, fn) => {
    const n = Math.ceil(R / BSC);
    const ci = Math.floor(x / BSC), cj = Math.floor(z / BSC);
    for (let dj = -n; dj <= n; dj++) {
      for (let di = -n; di <= n; di++) {
        const l = bdGrid.get(`${ci + di},${cj + dj}`);
        if (l) for (const sg of l) fn(sg);
      }
    }
  };
  const bdSegD = (sg, x, z) => {
    const dx = sg.x1 - sg.x0, dz = sg.z1 - sg.z0, l2 = dx * dx + dz * dz || 1;
    let t = ((x - sg.x0) * dx + (z - sg.z0) * dz) / l2;
    t = t < 0 ? 0 : t > 1 ? 1 : t;
    return Math.hypot(sg.x0 + dx * t - x, sg.z0 + dz * t - z);
  };
  // 迴避:半徑 r 的足跡與任何分界線帶(含帶緣起伏 + PAD 淨距)相交即擋下
  const bdCross = (x, z, r) => {
    let hit = false;
    bdEach(x, z, r + BD_HW_MAX + BORDER_BAND.PAD, (sg) => {
      if (!hit && bdSegD(sg, x, z) < r + sg.hw + BORDER_BAND.PAD) hit = true;
    });
    return hit;
  };
  // ---- 分界線帶內不觸發地形異常狀態(2026-08-13 使用者定案)----
  // 「確保水域/沼澤在分界線的區塊內不會觸發異常狀態」。成因是**兩條線從來沒有對齊過**:
  // 權威的水沼分類(terrainEnvCode)量的是真實地形高程與衛星影像,而底毯的換手在**畫出來的
  // 那條線**上(borderCut),那條線是格邊鏈拉直後的弦、最寬的一種帶(沙灘)有 9m ⇒ 兩者
  // 最多可以差半個帶寬。畫面上你站在沙灘/泥灘/小溪的圖案上,伺服器算的卻是「泡在水裡」——
  // 涉水凍結與陷沼扣血就在這裡冒出來,而每一條既有斷言都是綠的。
  // 修法 = 帶內一律當乾地(比照 `terrain.inDryBand` 兵線外接帶那一層,同樣是「這一塊強制乾」)。
  // 三條:
  //  ①**純幾何、(x,z) 的純函式**:只問「離任何一段界線中心線的垂距 ≤ 該種類的帶半寬嗎」,
  //    半寬取 `hwOfKind`(= 真的畫出來的外緣,含帶緣起伏)⇒ 遮罩恰好蓋住圖案,不多不少;
  //  ②**寧缺勿錯往「不觸發」偏**:規劃出來但發射時被讓路規則(道路/建物)剔掉的那幾段仍在
  //    索引裡 ⇒ 那裡沒畫帶卻也不觸發。反過來(畫了帶卻照樣扣血)才是使用者回報的症狀;
  //  ③**MUST 在 buildBiomes 之外才裝上去**(見 biomes.js 的清空 + main.js 的安裝點):底毯
  //    分區自己就吃 terrainEnvCode,建圖期就掛上等於「界線改變分區 → 分區改變界線」的循環,
  //    而症狀是同一張圖每次建出來都不一樣。
  //  ④遮罩要活到戰鬥結束 ⇒ MUST 走**模組層**工廠(`makeBandMask`):在 buildGroundCover 裡
  //    寫一個閉包的話,V8 會把整個函式作用域的 context 一起留住(底毯 buckets、細節清單、
  //    landCells…幾十 MB),而畫面上什麼都看不出來(A25 的同一條)。
  const bandDryAt = makeBandMask(bdGrid, BSC, BD_HW_MAX);
  // 底毯切線:頂點落在「鄰格那一側」多遠 → borderCutAlpha。側別由**鄰格方向**判(格索引差),
  // 不拿鄰格中心點去比 —— 拉直後的弦可能自格子中間穿過,拿點比會整格翻面
  const bdCutAt = (x, z, di, dj) => {
    let best = null, bd = cell * BORDER_CUT.R_F;
    bdEach(x, z, bd, (sg) => { const d = bdSegD(sg, x, z); if (d < bd) { bd = d; best = sg; } });
    if (!best) return null;
    const ex = best.x1 - best.x0, ez = best.z1 - best.z0;
    const nb = ex * dj - ez * di;                        // 鄰格方向落在線的哪一側
    if (!nb) return null;
    const vs = ex * (z - best.z0) - ez * (x - best.x0);  // 這個頂點落在哪一側
    const sgn = (vs >= 0) === (nb > 0) ? 1 : -1;
    // 切線本身不必筆直:沿世界座標的低頻擾動(純函式,相鄰格共用頂點恆同值)
    return borderCutAlpha(sgn * bd + BORDER_CUT.JIT * (vnoise(x * 0.19, z * 0.19, seed ^ 0x2B0D) - 0.5) * 2,
                          BORDER_CUT.W);
  };

  // Hetero-boundary spillover (incl. diagonal): corner-membership bilinear fade -- layout lives in planSeamOverlays
  // (純函式,稽核執行原文;舊制單向整格外溢的鋸齒病灶見該函式檔頭),此處只發幾何。
  // 兩側對稱互溢 + 對角補角 ⇒ 交界中線 = 50/50 混色的平滑等值線,90° 階梯縫消失。
  // 交界樣式逐分區組合查表(明確/柔和/斑塊/中間過渡帶,SEAM_STYLES);中間樣態脊帶
  // 進獨立 bandBuckets(固定壓在兩側淡出之上,renderOrder 見 mesh 段)。
  // hardOf = 「這一對畫得出分界線嗎」(規則仍只有 borderKindOf 一份):畫得出來就改走切線,
  // 中間過渡脊帶也不出 —— 那條橫跨界線的第三種地表正是「沒有正確分隔兩側地貌」的一半成因。
  const bdHard = (k0, kn, i, j, ni, nj) => !!borderKindOf(
    bdSubOf(k0), bdSubOf(kn), zoneGrid[j * gnx + i], zoneGrid[nj * gnx + ni]);
  for (const ov of planSeamOverlays(keys, gnx, gnz,
      { coarseOf: coarseOfKey, seed, variants: VARIANTS, hardOf: bdHard })) {
    emitCell(ov.st?.band ? bandBuckets : spillBuckets, ov.key, ov.i, ov.j, ov.alphas, ov.st, ov.cut);
  }

  // ---- 特徵拼圖登錄:不疊置(邊緣小比例交疊)+ 視野內同款不重複 ----
  const MAXRE = 26;                       // 最大有效半徑(SIZE 上限 × RSCALE)
  const PCELL = 64;                       // 疊置查詢空間網格(交疊半徑 ≤ ~50m)
  const pGrid = new Map();                // `${i},${j}` -> [{x,z,re}]:疊置檢查
  const keyPos = new Map();               // 'sub#variant' -> [{x,z}]:同款反重複
  // 有效半徑:rect 以等面積圓近似(半寬 × √aspect),blob 直接用 r
  const rEffOf = (def, r) => def.shape === 'rect' ? r * Math.sqrt(def.aspect || 0.7) : r;
  // 廣相搜尋半徑:**外接**半徑的上界(推導,MUST NOT 手寫)—— 等面積半徑 MAXRE 不夠,
  // 一塊長條球場的角比它的等面積圓遠 15%,漏掉就等於沒判
  const MAXRC = Math.max(...Object.keys(SIZE).map((s) => {
    const d = DEFS[s];
    if (!d) return 0;
    const rr = (SIZE[s][0] + SIZE[s][1]) * RSCALE;
    return rr * (d.shape === 'rect' ? Math.hypot(1, d.aspect || 0.7) : (BLOB_R.MIN + BLOB_R.JIT));
  }));
  const overlapPs = (x, z, re, foot, isInk) => {
    const R = Math.max((re + MAXRE) * INK_SEP_F, foot.r + MAXRC + PATCH_GAP);
    const i0 = Math.floor((x - R) / PCELL), i1 = Math.floor((x + R) / PCELL);
    const j0 = Math.floor((z - R) / PCELL), j1 = Math.floor((z + R) / PCELL);
    for (let j = j0; j <= j1; j++) {
      for (let i = i0; i <= i1; i++) {
        const arr = pGrid.get(`${i},${j}`);
        if (!arr) continue;
        for (const p of arr) {
          // 任一方是功能性區塊 ⇒ 量**真實足跡**零重疊(rect 有向盒 / blob 外接圓);
          // 自然類彼此才走圓近似的邊緣互融
          if (isInk || p.ink) { if (footNear(foot, p.foot, PATCH_GAP)) return true; continue; }
          const dx = p.x - x, dz = p.z - z, rr = (re + p.re) * SEP_F;
          if (dx * dx + dz * dz < rr * rr) return true;
        }
      }
    }
    return false;
  };
  const usedNear = (x, z, key) => {
    const arr = keyPos.get(key);
    if (!arr) return false;
    for (const p of arr) {
      const dx = p.x - x, dz = p.z - z;
      if (dx * dx + dz * dz < VIS_R * VIS_R) return true;
    }
    return false;
  };
  // 功能性區塊(ink)專屬索引:3D 物件的「不得站進別人的區塊」逐件都要查一次 ⇒
  // 用比 PCELL 細的格,查詢只掃一格(拿 pGrid 的 64m 格逐次掃 3×3 會是每個擺件近百次比對)
  const ICELL = 32;
  const iGrid = new Map();
  const regPatch = (x, z, re, key, ink, foot) => {
    const gk = `${Math.floor(x / PCELL)},${Math.floor(z / PCELL)}`;
    let arr = pGrid.get(gk);
    if (!arr) { arr = []; pGrid.set(gk, arr); }
    arr.push({ x, z, re, ink, foot });   // ink = 規律結構拼圖(edge:'ink'):邊界物件避開其覆蓋範圍
    if (ink) {
      const i0 = Math.floor((x - foot.r) / ICELL), i1 = Math.floor((x + foot.r) / ICELL);
      const j0 = Math.floor((z - foot.r) / ICELL), j1 = Math.floor((z + foot.r) / ICELL);
      for (let j = j0; j <= j1; j++) {
        for (let i = i0; i <= i1; i++) {
          const ik = `${i},${j}`;
          let l = iGrid.get(ik);
          if (!l) { l = []; iGrid.set(ik, l); }
          l.push(foot);
        }
      }
    }
    let ps = keyPos.get(key);
    if (!ps) { ps = []; keyPos.set(key, ps); }
    ps.push({ x, z });
  };
  // ---- 3D 物件:互不重疊 + 不站進別人的功能性區塊 ----
  const DCELL = 6;
  const dGrid = new Map();          // 已擺放的 3D 物件足跡(圓)
  const DET_R_MAX = Math.max(...Object.keys(DETAIL_DEFS).map(detailR)) * 2;   // 廣相上界(含實例放大)
  let curInk = null;                // 正在撒細節的那一塊功能性區塊(它自己的擺件當然站得上去)
  const detFree = (px, pz, dr) => {
    const R = dr + DET_R_MAX + DET_GAP;
    const i0 = Math.floor((px - R) / DCELL), i1 = Math.floor((px + R) / DCELL);
    const j0 = Math.floor((pz - R) / DCELL), j1 = Math.floor((pz + R) / DCELL);
    for (let j = j0; j <= j1; j++) {
      for (let i = i0; i <= i1; i++) {
        const l = dGrid.get(`${i},${j}`);
        if (!l) continue;
        for (const o of l) {
          const rr = dr + o.r + DET_GAP;
          if ((o.x - px) ** 2 + (o.z - pz) ** 2 < rr * rr) return false;
        }
      }
    }
    const il = iGrid.get(`${Math.floor(px / ICELL)},${Math.floor(pz / ICELL)}`);
    if (il) {
      const me = { x: px, z: pz, r: dr };
      for (const f of il) if (f !== curInk && footNear(me, f, 0)) return false;
    }
    if (occupied.near({ x: px, z: pz, r: dr }, DET_GAP)) return false;
    return true;
  };
  const detPut = (px, pz, dr) => {
    const gk = `${Math.floor(px / DCELL)},${Math.floor(pz / DCELL)}`;
    let l = dGrid.get(gk);
    if (!l) { l = []; dGrid.set(gk, l); }
    l.push({ x: px, z: pz, r: dr });
  };
  // 自雜訊指定變體起輪替,回傳視野內未用的變體;全數用罄回 -1(改試其他地表)
  const freeVariant = (sub, x, z, v0) => {
    for (let k = 0; k < VARIANTS; k++) {
      const v = (v0 + k) % VARIANTS;
      if (!usedNear(x, z, `${sub}#${v}`)) return v;
    }
    return -1;
  };

  // ---- 農田叢集:「組合夠大片才加田埂」(2026-08-13 使用者定案)----
  // 一塊孤田圍一圈埂讀起來像花壇 ⇒ 田埂**不是逐塊的屬性,是叢集的屬性**。開一本帳把同一次
  // 遞迴(或同一條路的沿街陣列)裡的農田塊記下來,收工時才決定畫不畫 —— 門檻 BUND.MIN_N。
  // 帳本身零 rnd(只是記帳),畫不畫也不影響任何淘汰閘 ⇒ 共享 rnd 序列與佈局一格未動。
  const bundBuckets = new Map();
  let farmCluster = null;
  const withCluster = (fn) => {
    const prev = farmCluster;
    farmCluster = [];
    const out = fn();
    if (farmCluster.length >= BUND.MIN_N) {
      const b = bucketOf(bundBuckets, 'fieldbund');
      // 弦長傳 `BUND.SEG_M`(埂自己的取樣間距)不是底毯的 cell/2 —— 見 SAG 檔頭 ⑥:
      // 拿 6.5m 的弦虧損去抬 3m 的弦就是「凸太多」的來源
      for (const p of farmCluster) emitBund(b, terrain, p.x, p.z, p.r, p.rot, p.def, p.lift + 0.004,
                                            (px, pz) => drapeSag(terrain.heightAt, px, pz, BUND.SEG_M));
    }
    farmCluster = prev;
    return out;
  };

  // ---- 單塊 patch:檢查 → 幾何 → 細節 → 家族延伸(遞迴,同族異款毗鄰)----
  const tryPatch = (x, z, sub, variant, r, rot, depth) => {
    if (placed >= target) return false;
    const env = environmentAt(x, z);
    if (!surfaceAllowed(sub, env)) return false;
    const parameters = surfaceParameters(sub, seed, x, z);
    r *= parameters.widthScale;
    const def = { ...DEFS[sub], aspect: parameters.aspect };
    const foot = def.shape === 'rect'
      ? { x, z, hw: r, hd: r * (def.aspect || 0.7), ry: rot, r: r * Math.hypot(1, def.aspect || 0.7) }
      : { x, z, r: r * (BLOB_R.MIN + BLOB_R.JIT) };
    if (x < terrain.minX + inb + foot.r || x > terrain.maxX - inb - foot.r
      || z < terrain.minZ + inb + foot.r || z > terrain.maxZ - inb - foot.r) return false;
    if (isBlocked(x, z)) return false;
    if (roadClear?.(x, z, foot)) return false;   // 用完整足跡避路，不能只驗中心點
    if (occupied.near(foot, PATCH_GAP)) return false;
    const zn = zoneAt(x, z);
    const enc = encAt(x, z);
    // 類型必須與所在圖資分區相符;enclave 格內另放行該組合樣式的地表(公園拼圖只准落在
    // 「市區內的小綠地」格上,不會因此漏到整片綠地 —— 放行閘只看 encAt 命中的格)
    if (!subZones.get(sub)?.has(zn) && !enc?.set.has(sub)) return false;
    // 田/停車場/球場…一律不得橫跨分界線(2026-08-11 使用者定案)。理由不只是「線被蓋住」——
    // 規律結構的 lift(.135↑)本來就高過帶(.126~.134)⇒ 它會**整片壓在界線上**;而一塊
    // 橫跨界線的水田同時也是「一側地貌滲透到另一側」。擋在這裡而不是讓界線讓路:界線是
    // 地貌的分界(結構),拼圖是點綴。半徑取**外接**(rect 的角落比 r 遠:半寬 r × 半深
    // r·aspect ⇒ 用 r 會讓角壓上帶緣)。與 roadClear 同位 = 首個 rnd() 之前,確定性紀律不變
    if (bdCross(x, z, def.shape === 'rect' ? r * Math.hypot(1, def.aspect || 0.7)
                                           : r * (BLOB_R.MIN + BLOB_R.JIT))) return false;
    // 坡度/水面檢查:整塊落在陸地、高差在容許內(田與球場要平)
    if (!probeSurface(terrain.heightAt, x, z, r, rot, def, SURFACES[sub], terrain.gridM)) return false;
    // 拼圖不疊置。**功能性區塊(ink)量真實足跡零重疊**(含陣列 tile 與家族延伸 —— 舊制
    // 的 `depth === 0` 把它們排除在外,於是沿街格陣與農田拼布之間可以互切);自然類彼此
    // 才走圓近似的邊緣互融(fade 邊互融是刻意的)
    const rEff = rEffOf(def, r);
    if (overlapPs(x, z, rEff, foot, def.edge === 'ink')) return false;

    // 圖層優先(使用者定):規律(ink)疊不規律(fade)之上;規律再依所對齊道路分級抬高(大馬路>小馬路),
    // 整體仍 < 道路 0.18。rank 為決定性查詢(不吃 rnd);每分支恰一枚 rnd。ink_min .135 > fade_max .124 恆成立。
    let lift;
    if (def.edge === 'ink') {
      const rk = roadRank ? (roadRank(x, z) ?? 0) : 0;
      lift = 0.135 + rk * 0.033 + rnd() * 0.004;
    } else {
      lift = 0.110 + rnd() * 0.014;
    }
    const shade = 1 + parameters.lightness;
    const pt = [shade, shade, shade];
    const b = climateBucket(buckets, `${sub}#${variant}`, x, z);
    const patchSag = (px, pz) => drapeSag(terrain.heightAt, px, pz);
    if (def.shape === 'rect') {
      const flipU = rnd() < .5, flipV = rnd() < .5;
      const venue = ['venue', 'visitor'].includes(SURFACES[sub].pattern);
      const readable = SURFACES[sub].text.length > 0 || venue || sub === 'track';
      emitRect(b, terrain, x, z, r, rot, def, lift, pt, !readable && flipU, venue || (!readable && flipV), rnd, patchSag);
    }
    else emitBlob(b, terrain, x, z, r, lift, def.uvS, def.edge, pt, rnd, patchSag);
    regPatch(x, z, rEff, `${sub}#${variant}`, def.edge === 'ink', foot);
    placed++;
    generatedSurfaces.push({ sub, x, z, width: r * 2, depth: r * 2 * def.aspect, rot,
      classification: { ...SURFACES[sub], ...env }, parameters });
    if (BUND_SUBS.has(sub)) farmCluster?.push({ x, z, r, rot, def, lift });   // 田埂帳(收工才決定畫不畫)

    // curInk = 這一塊自己的足跡:它自己的擺件當然站得上去(球場的籃球架/加油站的油槍),
    // 擋的是**別人的**擺件走進來。家族延伸在 scatterDetails 之後才遞迴 ⇒ 還原後再往下走
    const prevInk = curInk;
    curInk = def.edge === 'ink' ? foot : null;
    scatterDetails(sub, x, z, r, rot, def, zn, enc, parameters.density * (env.temperature < 0 ? .5 : 1));
    curInk = prevInk;

    // 家族延伸:農田拼布 / 運動園區 / 綠地群落(rect 沿軸毗鄰、blob 邊緣淡接);
    // 每鄰塊經 freeVariant 換款 → 拼布連片但視野內無同款重複
    if (def.fam && depth < 2 && rnd() < 0.65) {
      const k = 1 + (rnd() * 2 | 0);
      for (let i = 0; i < k; i++) {
        const sub2 = rnd() < 0.7 ? sub : FAMS[def.fam][(rnd() * FAMS[def.fam].length) | 0];
        const def2 = DEFS[sub2];
        if (def2.shape !== def.shape) continue;
        let nx2, nz2, r2, rot2;
        if (def.shape === 'rect') {
          // 沿本塊局部軸擺到正鄰位(間留 FARM_GAP 小路),同 rot → 田字拼布。
          // **鄰塊尺寸依毗鄰軸反解**(2026-08-13 使用者「田與田之間沒有整齊對準」):
          //   側向毗鄰 ⇒ 共用的是**長邊** ⇒ 深度要一樣 ⇒ r2 = r × aspect ÷ aspect2;
          //   前後毗鄰 ⇒ 共用的是**短邊** ⇒ 寬度要一樣 ⇒ r2 = r。
          // 舊制兩種情形都取 r2 = r,於是 aspect 不同的鄰款(水田 0.7 / 茶園 0.8 / 溫室 0.6)
          // 側向毗鄰時長邊差了 14~33% —— 畫面上就是「兩塊田沒對齊」。
          // 兩枚 rnd 的順序與枚數逐位元同舊制(先毗鄰軸、後方向)。
          const as1 = def.aspect || 0.7, as2 = def2.aspect || 0.7;
          const side = rnd() < 0.5, sgn = rnd() < 0.5 ? 1 : -1;
          r2 = side ? r * as1 / as2 : r;
          const [ox, oz] = side ? [(r + r2 + FARM_GAP) * sgn, 0]
                                : [0, (r * as1 + r2 * as2 + FARM_GAP) * sgn];
          const ca = Math.cos(rot), sa = Math.sin(rot);
          nx2 = x + ox * ca - oz * sa; nz2 = z + ox * sa + oz * ca; rot2 = rot;
        } else {
          r2 = (SIZE[sub2][0] + rnd() * SIZE[sub2][1]) * RSCALE;
          const th = rnd() * Math.PI * 2, dist = (r + r2) * 0.86;   // 邊緣小比例交疊:fade 邊互融(> SEP_F)
          nx2 = x + Math.cos(th) * dist; nz2 = z + Math.sin(th) * dist;
          rot2 = orient(nx2, nz2, def2.reg, true);   // 鄰塊各自依整齊度擲骰(rect 拼布已同 rot 延伸)
        }
        const v2 = freeVariant(sub2, nx2, nz2, variant);
        if (v2 >= 0) tryPatch(nx2, nz2, sub2, v2, r2, rot2, depth + 1);
      }
    }
    return true;
  };

  // ---- 3D 細節(表面特徵輪廓)----
  // zn = 所在分區:同物件跨地貌形式不同(雜草/花/灌木 — 綠地大面積密集、
  // 市區/裸露地零星;貨櫃/太陽能板 — 裸露地大陣列、市區零星單件)
  function scatterDetails(sub, x, z, r, rot, def, zn, enc = null, density = 1) {
    const w = r * 2, dp = r * 2 * (def.aspect || 0.7);
    const ca = Math.cos(rot), sa = Math.sin(rot);
    const atLocal = (lx, lz) => [x + lx * ca - lz * sa, z + lx * sa + lz * ca];
    // 數量隨 patch 面積縮放(大 patch 不再顯得稀疏)+ 每次呼叫再抖 ±40%;
    // 散佈型態每 patch×型別隨機:cluster 群聚(1~3 簇)/ ring 沿緣 / uniform 均勻
    const kMul = Math.min(3, Math.max(0.7, (r / ((SIZE[sub]?.[0] || 9) * RSCALE)) ** 1.6));
    const scatter = (type, k, s0, sv, tintPick = null) => {
      k = Math.max(1, Math.round(k * kMul * density * (0.55 + rnd() * 1.1)));
      const mode = rnd();
      let centers = null, arc0 = 0, arcSpan = Math.PI * 2;
      if (mode < 0.3) {
        centers = [];
        const nC = 1 + (rnd() * 3 | 0);
        for (let c = 0; c < nC; c++) centers.push([(rnd() - 0.5) * r * 1.1, (rnd() - 0.5) * r * 1.1]);
      } else if (mode < 0.45) {                        // ring 改隨機弧段:C 形/半圈,不再恆整圈
        arc0 = rnd() * Math.PI * 2; arcSpan = Math.PI * (0.5 + rnd() * 1.5);
      }
      for (let i = 0; i < k; i++) {
        let px, pz;
        if (centers) {                                 // cluster:簇心 + 高斯狀聚攏
          const [ox, oz] = centers[(rnd() * centers.length) | 0];
          const rr = r * 0.3 * rnd(), th = rnd() * Math.PI * 2;
          px = x + ox + Math.cos(th) * rr; pz = z + oz + Math.sin(th) * rr;
        } else if (mode < 0.45) {                      // ring:沿 patch 邊緣的隨機弧段
          const rr = r * (0.55 + rnd() * 0.35), th = arc0 + rnd() * arcSpan;
          px = x + Math.cos(th) * rr; pz = z + Math.sin(th) * rr;
        } else {                                       // uniform:面積均勻
          const rr = r * 0.75 * Math.sqrt(rnd()), th = rnd() * Math.PI * 2;
          px = x + Math.cos(th) * rr; pz = z + Math.sin(th) * rr;
        }
        const tint = tintPick ? tintPick[(rnd() * tintPick.length) | 0] : null;
        const [jpx, jpz] = qcNudge(px, pz);           // 準晶體 blue-noise 位移:去叢聚/去重複,純函數不動 rnd 序列
        addDetail(type, jpx, jpz, s0 + rnd() * sv, tint);
      }
    };
    // 對齊列陣:沿 patch 局部軸整齊排列;ry=-rot 使 3D 件與貼圖行列同向
    // (atLocal 的平面旋轉正向 = three.js rotation.y 的負向);格位/朝向微抖不豆腐格
    const rows = (type, stepX, stepZ, mX, mZ, cap, skip, tintPick = null, s0 = 1, sv = 0) => {
      let k = 0;
      const isSolar = type === 'solarpanel';
      const jx = isSolar ? 0 : stepX * 0.18, jz = isSolar ? 0 : stepZ * 0.18;
      // 列陣隨機起點相位:同款場地的排列位置塊塊互異(太陽能板平整處恆整齊居中)
      const px0 = isSolar ? 0 : (rnd() - 0.5) * stepX * 0.6, pz0 = isSolar ? 0 : (rnd() - 0.5) * stepZ * 0.6;
      for (let lz = -dp * mZ + pz0; lz <= dp * mZ && k < cap; lz += stepZ) {
        for (let lx = -w * mX + px0; lx <= w * mX && k < cap; lx += stepX) {
          if (rnd() < skip) continue;
          const [px, pz] = atLocal(lx + (rnd() - 0.5) * jx, lz + (rnd() - 0.5) * jz);
          const tint = tintPick ? tintPick[(rnd() * tintPick.length) | 0] : null;
          addDetail(type, px, pz, s0 + rnd() * sv, tint, 1, -rot + (isSolar ? 0 : (rnd() - 0.5) * 0.1));
          k++;
        }
      }
    };
    const recipe = GROUND_ATTACHMENTS[sub];
    if (!recipe) return;
    const scatterRules = { ...recipe.scatter, ...recipe.contexts?.[enc?.style.det] };
    for (const [type, values] of Object.entries(scatterRules)) {
      if (sub === 'parking' && (type === 'car' || type === 'motorcycle')) continue;
      const [min, max, smin, smax, chance = 1] = values;
      if (rnd() > chance) continue;
      const count = min + Math.floor(rnd() * (max - min + 1));
      scatter(type, count, smin, smax - smin, GROUND_PART_PALETTES[type]);
    }
    if (sub === 'parking') {
      const occRate = 0.5 + rnd() * 0.5;
      const carPal = GROUND_PART_PALETTES.car;
      const motoPal = GROUND_PART_PALETTES.motorcycle;
      const carSlots = [];
      const motoSlots = [];

      const marginX = 0.06;
      const usableSpan = 1 - 2 * marginX;
      const numCols = Math.max(4, Math.floor((w * usableSpan) / 2.5));
      const dx = (w * usableSpan) / numCols;
      const startX = -w * 0.5 + w * marginX;

      if (dp >= 28) {
        // 4-row layout for larger fields
        const rZ = [-dp * 0.38, -dp * 0.12, dp * 0.12, dp * 0.38];
        const rHead = [-rot + Math.PI / 2, -rot - Math.PI / 2, -rot + Math.PI / 2, -rot - Math.PI / 2];
        for (let r = 0; r < 3; r++) {
          for (let i = 0; i < numCols; i++) {
            carSlots.push([startX + (i + 0.5) * dx, rZ[r], rHead[r]]);
          }
        }
        const carCols = Math.max(2, Math.floor(numCols * 0.68));
        for (let i = 0; i < carCols; i++) {
          carSlots.push([startX + (i + 0.5) * dx, rZ[3], rHead[3]]);
        }
        const motoStartX = startX + carCols * dx + 0.5;
        const motoEndX = w * 0.5 - w * marginX;
        const motoWidth = Math.max(2, motoEndX - motoStartX);
        const numMotos = Math.max(3, Math.floor(motoWidth / 1.05));
        const motoDx = motoWidth / numMotos;
        for (let i = 0; i < numMotos; i++) {
          motoSlots.push([motoStartX + (i + 0.5) * motoDx, rZ[3], rHead[3]]);
        }
      } else {
        // 2-row layout for standard/smaller fields
        for (let i = 0; i < numCols; i++) {
          carSlots.push([startX + (i + 0.5) * dx, -dp * 0.31, -rot + Math.PI / 2]);
        }
        const carCols = Math.max(2, Math.floor(numCols * 0.65));
        for (let i = 0; i < carCols; i++) {
          carSlots.push([startX + (i + 0.5) * dx, dp * 0.31, -rot - Math.PI / 2]);
        }
        const motoStartX = startX + carCols * dx + 0.5;
        const motoEndX = w * 0.5 - w * marginX;
        const motoWidth = Math.max(2, motoEndX - motoStartX);
        const numMotos = Math.max(3, Math.floor(motoWidth / 1.05));
        const motoDx = motoWidth / numMotos;
        for (let i = 0; i < numMotos; i++) {
          motoSlots.push([motoStartX + (i + 0.5) * motoDx, dp * 0.31, -rot - Math.PI / 2]);
        }
      }

      for (const [lx, lz, hd] of carSlots) {
        if (rnd() < occRate) {
          const [px, pz] = atLocal(lx, lz);
          const tint = carPal ? carPal[(rnd() * carPal.length) | 0] : null;
          addDetail('car', px, pz, 0.98 + rnd() * 0.04, tint, 1, hd);
        }
      }
      for (const [lx, lz, hd] of motoSlots) {
        if (rnd() < occRate) {
          const [px, pz] = atLocal(lx, lz);
          const tint = motoPal ? motoPal[(rnd() * motoPal.length) | 0] : null;
          addDetail('motorcycle', px, pz, 0.98 + rnd() * 0.04, tint, 1, hd);
        }
      }
    }
    for (const [type, values] of Object.entries(recipe.rows || {})) {
      const [sx, sz, cap, skip, smin, smax] = values;
      const isSolar = type === 'solarpanel';
      const mX = isSolar ? 0.46 : 0.4;
      const mZ = isSolar ? 0.44 : 0.34;
      rows(type, sx, sz, mX, mZ, Math.round(cap * density), isSolar ? 0 : skip, GROUND_PART_PALETTES[type], smin, smax - smin);
    }
    for (const [type, u, v, heading, scale] of recipe.fixed || []) {
      const [px, pz] = atLocal(u * w, v * dp);
      addDetail(type, px, pz, scale * (recipe.referenceWidth ? w / recipe.referenceWidth : 1), null, 1, -rot + heading);
    }
  }

  // ==== 沿街連續規律陣列(2026-07-25 使用者需求「規律拼貼順著道路整齊排列」)====
  // 規律結構型(ink rect、reg≥ARR_MINREG:停車場/球場/太陽能板/稻田/農田…)沿道路兩側(法線偏移讓開
  // 路面)鋪成連續等尺寸格陣,朝向鎖道路角、同陣列共 rot ⇒ 無接歪。決定性:錨點沿 roadPolys(geocache
  // 定案、跨客戶端同序)以固定步距推進;變體走決定性輪替。tryPatch depth=2 ⇒ 無家族延伸、overlapPs 走
  // SEP_F(陣列 tile 相接不重疊,獨立結構才對它們全分離)。無道路圖資 → 不鋪(規律型退回主迴圈隨機散佈)。
  const ARR_MINREG = 0.7;
  const arrayable = new Set(Object.keys(DEFS).filter(
    (s) => DEFS[s].edge === 'ink' && DEFS[s].shape === 'rect' && (DEFS[s].reg || 0) >= ARR_MINREG));
  const arrPools = {};
  for (const zn in zoneLists) arrPools[zn] = zoneLists[zn].filter((s) => arrayable.has(s));
  const layRegularArrays = () => {
    if (!roadPolys?.length) return;
    const ARR_MARGIN = 3, ARR_GAP = 1.6, ARR_DEPTH = 2, ARR_MINSTEP = 28, ARR_FREQ = 0.004;
    const arrCap = Math.round(target * 0.55);            // 陣列最多吃 55% 配額,其餘留主迴圈填不規律
    const dropAt = (px, pz, a, hw, station) => {
      const zn = zoneAt(px, pz);
      const enc = encAt(px, pz);
      // enclave 內只鋪該組合樣式的規律結構(公園裡不長一般市區停車陣列);樣式無可陣列型 → 空推進
      const pool = enc
        ? (enc.arr ??= (enc.style.feats || []).filter((s) => arrayable.has(s)))
        : arrPools[zn];
      if (!pool || !pool.length) return ARR_MINSTEP;     // 水域/高地/無候選 → 空推進
      const t = Math.min(0.999, Math.max(0, (vnoise(px * ARR_FREQ, pz * ARR_FREQ, seed ^ 0x1A77) - 0.5) * 2 + 0.5));
      const sub = pool[(t * pool.length) | 0], def = DEFS[sub];
      const r = SIZE[sub][0] * RSCALE;                   // 固定半徑(不抖):同陣列等尺寸才對齊
      const d = 2 * r * (def.aspect || 0.7);
      const stepA = 2 * r + ARR_GAP, stepP = d + ARR_GAP, off0 = hw + ARR_MARGIN + d / 2;
      const ca = Math.cos(a), sa = Math.sin(a), nx = -sa, nz = ca;   // 道路法線
      for (let side = -1; side <= 1; side += 2) {
        for (let c = 0; c < ARR_DEPTH; c++) {
          if (placed >= arrCap) return stepA;
          const off = off0 + c * stepP;
          const tx = px + nx * side * off, tz = pz + nz * side * off;
          const variant = (station * 2 + c * 3 + (side > 0 ? 1 : 0)) % VARIANTS;   // 決定性變體輪替(同陣列不死板同款)
          if (tryPatch(tx, tz, sub, variant, r, a, 2)) arraysN++;   // depth=2:鎖路向、無家族延伸、overlapPs 走 SEP_F
        }
      }
      return stepA;
    };
    for (const [pts, hw] of roadPolys) {
      if (placed >= arrCap) break;
      // 一條路 = 一本田埂帳:沿街連續格陣本來就是「夠大片的組合」,而它與主迴圈的家族延伸
      // 是兩條互不相干的產線 ⇒ 各記各的(外層 `placed >= arrCap` 仍是唯一的收手閘,
      // 內層改為只結束這條路,語意與舊制的 return 相同)
      withCluster(() => {
        let carry = 0, station = 0;
        for (let si = 1; si < pts.length; si++) {
          const x0 = pts[si - 1][0], z0 = pts[si - 1][1];
          const dx = pts[si][0] - x0, dz = pts[si][1] - z0, segLen = Math.hypot(dx, dz);
          if (segLen < 1e-3) continue;
          const ux = dx / segLen, uz = dz / segLen, a = Math.atan2(dz, dx);
          let dcur = carry;
          while (dcur < segLen) {
            if (placed >= arrCap) return;
            dcur += dropAt(x0 + ux * dcur, z0 + uz * dcur, a, hw, station++);
          }
          carry = dcur - segLen;                         // 跨段連續推進(街廓不因節點斷開)
        }
      });
    }
  };
  layRegularArrays();

  // ---- 不規律主散佈:準晶體點陣候選 + tryPatch(近路規律型讓給沿街陣列)----
  // 候選由均勻 rnd 改「準晶體全循環走訪」(去格化 blue-noise、非週期不重複);保留完整 zone 清單內層重試,
  // 分區仍走純圖資分類(球場只落市區、水田只落綠地…)。qStride⊥nCells ⇒ 走訪為雙射(每格恰訪一次)。
  const qcArea = terrain.worldW * terrain.worldH;
  const qs = Math.max(18, Math.min(40, Math.sqrt(qcArea / Math.max(1, target * 4))));
  const QC_PT_W = (2 * Math.PI) / (qs * 1.7);
  const qcPoint = (cx, cz) => { const [gx, gz] = qcGrad(cx, cz, QC_PT_W); return [cx + gx * qs * 0.42, cz + gz * qs * 0.42]; };
  const nqx = Math.ceil(terrain.worldW / qs), nqz = Math.ceil(terrain.worldH / qs);
  const nCells = nqx * nqz;
  const gcd = (m, n) => { while (n) { const t = m % n; m = n; n = t; } return m; };
  let qStride = Math.max(1, Math.round(nCells * 0.61803));   // 黃金步幅、與 nCells 互質 ⇒ 全循環雙射走訪
  while (gcd(qStride, nCells) !== 1) qStride++;
  const qOff = (seed >>> 0) % Math.max(1, nCells);
  for (let a = 0; a < nCells && placed < target; a++) {
    const idx = (qOff + a * qStride) % nCells;
    const gi = idx % nqx, gj = (idx / nqx) | 0;
    const cx = terrain.minX + (gi + 0.5) * qs, cz = terrain.minZ + (gj + 0.5) * qs;
    const [qx, qz] = qcPoint(cx, cz);
    const x = qx + (rnd() - 0.5) * qs * 0.2;              // 固定 2 枚 rnd(破殘餘對稱;淘汰前抽 = 序列穩定)
    const z = qz + (rnd() - 0.5) * qs * 0.2;
    // enclave 內主散佈改抽該組合樣式的 feats 池(水域 enclave 無 feats → 照舊走 zoneLists 淘汰)
    const encM = encAt(x, z);
    const zones = encM?.style.feats?.length ? encM.style.feats : zoneLists[zoneAt(x, z)];
    if (!zones) continue;
    const t = Math.min(0.999, Math.max(0, (vnoise(x * 0.006, z * 0.006, seed) - 0.5) * 2.2 + 0.5));
    const zi = (t * zones.length) | 0;
    const v0 = Math.min(VARIANTS - 1, (vnoise(x * 0.0025, z * 0.0025, seed ^ 0x7E11) * VARIANTS) | 0);
    for (let s = 0; s < zones.length; s++) {
      const sub = zones[(zi + s) % zones.length];
      if (roadPolys?.length && arrayable.has(sub) && roadDirAt?.(x, z) != null) continue;   // 近路規律型 → 已交陣列
      const v = freeVariant(sub, x, z, v0);
      if (v < 0) continue;
      const r = (SIZE[sub][0] + rnd() * SIZE[sub][1]) * RSCALE;
      // 一次遞迴 = 一本田埂帳(root + 家族延伸的全部後代 = 這一片農田拼布)
      if (withCluster(() => tryPatch(x, z, sub, v, r, orient(x, z, DEFS[sub].reg, true, DEFS[sub].edge === 'ink'), 0))) break;
    }
  }

  // ---- 底毯細節:剩餘配額撒進大片空地(準晶體疏密,不留隨機禿斑;仍避開兵線走廊/建物)----
  detCap = MAX_DETAIL;
  const remain = MAX_DETAIL - detCount;
  if (remain > 60 && landCells.length) {
    const pDet = Math.min(0.3, remain / (landCells.length * 5));
    const CAR_QC_W = (2 * Math.PI) / (cell * 3);
    for (const [cx2, cz2, key] of landCells) {
      if (detCount >= MAX_DETAIL) break;
      const q = 0.5 + 0.5 * qcVal(cx2, cz2, CAR_QC_W);     // [0,1] 準晶體疏密調變(峰密谷疏,去隨機禿斑)
      if (rnd() >= pDet * (0.35 + 1.3 * q)) continue;       // 先抽 1 枚;E[0.35+1.3q]=1 ⇒ 總量不變
      const sub = key.slice(0, key.indexOf('#'));
      scatterDetails(sub, cx2, cz2, cell * 0.55, rnd() * Math.PI * 2, DEFS[sub], zoneAt(cx2, cz2), encAt(cx2, cz2));
    }
  }

  // ---- 底毯 Mesh(不透明,墊在最底)+ 外溢 Mesh(透明淡出)+ 中間樣態脊帶 Mesh
  //      (透明,壓在外溢之上),皆先於特徵/特效繪製 ----
  for (const [bmap, pass] of [[carpetBuckets, 0], [spillBuckets, 1], [bandBuckets, 2]]) {
    for (const b of bmap.values()) {
      const key = b.surfaceKey;
      if (!b.idx.length) continue;
      const [sub, v] = key.split('#');
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.Float32BufferAttribute(b.pos, 3));
      geo.setAttribute('normal', new THREE.Float32BufferAttribute(b.nrm, 3));
      geo.setAttribute('uv', new THREE.Float32BufferAttribute(b.uv, 2));
      geo.setAttribute('color', new THREE.Float32BufferAttribute(b.col, 4));
      setLandN(geo, b);
      geo.setIndex(b.idx);
      // 有四季設計的地表**跳過**季節濾鏡:畫筆已經畫成那個季節了,再乘一層 = 調兩次色
      const tint = DEFS[sub].green && !DEFS[sub].seasonal ? (SEASON_TINT[season] ?? 0xffffff) : 0xffffff;
      const m = new THREE.Mesh(geo, envMat(tint, {
        map: textureOf(sub, +v, false, b.environment),
        vertexColors: true, wash: 0.5, cool: 0.5, rim: 0,   // 貼地面關 rim:掠射角全開會把遠處洗白
        transparent: pass > 0,   // 外溢/脊帶靠頂點 alpha 淡出;depthWrite 保持 true
        landNrm: true,           // 地貌類別 + 真地形法線(見 landNrmAt 那一段)
      }));
      // 外溢在透明佇列裡必須早於特徵 patch / 特效(renderOrder 0)繪製,
      // 否則 depthWrite 會把後畫的底層擋掉出現描圈破洞。
      // 同佇列內再依 seamLift 同一雜湊排序(低者先畫)⇒ 異 key 外溢互疊時
      // 高者後蓋、深度不互吃,混色連續且決定性(範圍 [-2, -1.3] 仍恆 < 0);
      // 中間樣態脊帶 -1.2:恆在全部外溢之後、特徵層之前(與 lift 0.108 同序)
      if (pass === 1) m.renderOrder = -2 + seamLift(key) * 100;
      else if (pass === 2) m.renderOrder = -1.2;
      m.frustumCulled = false;
      m.userData.noOutline = true;
      // 冒煙測試識別標記(同特徵拼圖的 gsub/gvar 慣例):截圖工具據此認出「這一格是哪種地表」
      m.userData.gsub = sub; m.userData.gvar = +v; m.userData.surfaceEnvironment = b.environment;
      m.userData.glayer = pass === 0 ? 'carpet' : pass === 1 ? 'spill' : 'band';
      group.add(m);
    }
  }

  // ==== Terrain border puzzle emission (2026-08-11 user decision; replaces 2026-07-24 border props) ====
  // 配置全住 planBorderPuzzle(純函式單一縫:16 方向直線/轉彎/岔路、種類解析 borderKindOf、
  // 接力切點共用、'!'/null 不成界),這裡只發幾何:
  //   flat 種類 = 貼地紋理帶(透明;lift 帶 [0.126, 0.134] 介於不規律 fade 上限 0.124 與
  //   規律 ink 下限 0.135 之間、renderOrder ∈ [-1.1, -1.05] 恆晚於脊帶 -1.2 早於特徵層 0);
  //   ridge 種類 = 梯形脊(沿用舊遮蔽物的幾何語彙;接續端各外延半寬 → 轉角互搭無楔縫)。
  // 與地被同契約:純視覺、無碰撞、不描邊、不進 raycast(空地照常通行)。
  // 道路/兵線淨空/規律結構拼圖優先 —— 沿 tile 密取樣任一點命中即整片跳過(鏈斷口兩端
  // alpha 收尾 = 步道讓路給馬路);貼水種類(aq)頂點夾到水面上,其餘不下水。
  // 決定性只吃 seed + 節點索引雜湊(零共享 rnd,§2.3)⇒ 佈局不變、跨客戶端一致。
  {
    bStat = { planned: 0, drawn: 0, forks: 0, forksDrawn: 0 };
    const ehash = (a, b, c) => {
      let n = (Math.imul(a | 0, 374761393) ^ Math.imul(b | 0, 668265263) ^ Math.imul(c | 0, 2246822519) ^ seed) | 0;
      n = Math.imul(n ^ (n >>> 13), 1274126177);
      return ((n ^ (n >>> 16)) >>> 0) / 4294967296;
    };
    const snB = ENV.seasons[season] || ENV.seasons.summer;
    // 規律結構拼圖(edge:'ink' 球場/停車場/農田/廣場…)覆蓋範圍:分界線一律避開,不切穿
    // 整齊區塊(2026-07-25 使用者回報「球場/停車場上放邊界拼圖很亂」的裁決沿用)。
    const onRegular = (x, z) => {
      const R = MAXRE * SEP_F;
      const i0 = Math.floor((x - R) / PCELL), i1 = Math.floor((x + R) / PCELL);
      const j0 = Math.floor((z - R) / PCELL), j1 = Math.floor((z + R) / PCELL);
      for (let jj = j0; jj <= j1; jj++) for (let ii = i0; ii <= i1; ii++) {
        const arr = pGrid.get(`${ii},${jj}`);
        if (!arr) continue;
        for (const p of arr) if (p.ink && (p.x - x) ** 2 + (p.z - z) ** 2 < p.re * p.re) return true;
      }
      return false;
    };
    const wy = terrain.waterY;
    // 配置吃上面就規劃好的那一份(bdPlan;底毯切線與拼圖迴避是同一份 = 單一縫),
    // 接頭退縮量由**真實帶寬**推導(hwOfKind:型錄是唯一真相,MUST NOT 手寫公尺數)
    const plan = bdPlan;
    const bKinds = Object.keys(BORDER_KINDS);
    const bLift = (kind) => 0.126 + bKinds.indexOf(kind) * 0.0008;  // 異種類互疊(接力/岔路)不共面
    // 帶紋理一輪的世界長:寬帶配長節距(推導,MUST NOT 手寫固定公尺)—— 固定 9m 會把
    // 9m 寬的沙灘壓成 1:1 而 3.6m 的步道橫向拉扁 2.5×,圖案就讀不出是什麼了
    const bTexL = (kd) => Math.max(BORDER_BAND.TEX_MIN, kd.w * BORDER_BAND.TEX_F);
    const flatB = new Map(), ridgeB = new Map();
    const bkOf = (m, kind, uv) => {
      let b = m.get(kind);
      if (!b) {
        // flat(貼地紋理帶)吃 aLandN;ridge(立體脊)的法線是**真的**,不需要也不准換
        b = uv ? { pos: [], nrm: [], uv: [], col: [], idx: [], base: 0, lnrm: [] } : { pos: [], nrm: [], idx: [], base: 0 };
        m.set(kind, b);
      }
      return b;
    };
    const gY = (px, pz, aq) => {
      const h = terrain.heightAt(px, pz);
      return aq && wy != null ? Math.max(h, wy + 0.05) : h;
    };
    // 讓路判定唯一縫:道路走廊 / 兵線淨空 / 規律結構拼圖 / 不下水。
    // **直段與接頭吃同一支** —— 接頭只驗節點那一個點的話,轉彎圓弧掃過的那一塊完全沒驗到,
    // 分界線就會橫過馬路(道路的圖層本來就在分界線之上,但那只保證被蓋住,不保證不該畫)。
    // onRegular is a fuse since 2026-08-11, not the main path: tryPatch bdCross already keeps regular structures
    // off the line from the start (yield direction is reversed -- the line is structure, puzzle pieces are decoration), kept only to
    // catch leaks such as family extensions.
    const ptOk = (px, pz, aq) => !isBlocked(px, pz) && !(roadClear && roadClear(px, pz))
      && !onRegular(px, pz)
      && (aq || terrain.heightAt(px, pz) > (wy != null ? wy + 0.15 : 0.45));
    // 逐 ~3m 取樣,**每個取樣點連兩側帶緣一起驗**(帶是有寬度的:只驗中心線的話,
    // 中心線剛好貼著走廊外緣時帶緣仍伸進馬路 —— 實測 150 個頂點漏 2 個就是這樣來的)
    const segOk = (x0, z0, x1, z1, aq, hw) => {
      const dx = x1 - x0, dz = z1 - z0, l = Math.hypot(dx, dz) || 1;
      const nx = -dz / l * hw, nz = dx / l * hw;
      const steps = Math.max(2, Math.ceil(l / 3));
      for (let s = 0; s <= steps; s++) {
        const t = s / steps, px = x0 + dx * t, pz = z0 + dz * t;
        if (!ptOk(px, pz, aq) || !ptOk(px + nx, pz + nz, aq) || !ptOk(px - nx, pz - nz, aq)) return false;
      }
      return true;
    };
    // 直段的可畫區間(沿退縮後的中心線,參數 0..1):逐 ~3m 判定,連續可畫的收成一段。
    // MUST NOT 退回「整片一個布林」—— 見 chains 迴圈的檔頭。
    const tileRuns = (tl, aq, hw) => {
      const dx = tl.bx - tl.ax, dz = tl.bz - tl.az, l = Math.hypot(dx, dz) || 1;
      const nx = -dz / l * hw, nz = dx / l * hw;
      const steps = Math.max(2, Math.ceil(l / 3));
      const runs = [];
      let s0 = -1;
      for (let s = 0; s <= steps; s++) {
        const t = s / steps, px = tl.ax + dx * t, pz = tl.az + dz * t;
        const good = ptOk(px, pz, aq) && ptOk(px + nx, pz + nz, aq) && ptOk(px - nx, pz - nz, aq);
        if (good) { if (s0 < 0) s0 = s; } else if (s0 >= 0) {
          if (s - 1 > s0) runs.push([s0 / steps, (s - 1) / steps]);
          s0 = -1;
        }
      }
      if (s0 >= 0 && steps > s0) runs.push([s0 / steps, 1]);
      return runs;
    };
    // 接頭:轉彎沿弧取樣(半徑取 R 與 R±hw 三圈)、圓帽驗整個圓盤、岔路逐臂連帶緣
    const cornerOk = (cor, aq) => {
      const g = cor.geo, hw = cor.hw;
      if (g.mode === 'cap') {
        if (!ptOk(g.cx, g.cz, aq)) return false;
        for (let s = 0; s < 8; s++) {
          const a = s / 8 * Math.PI * 2;
          if (!ptOk(g.cx + Math.cos(a) * g.r, g.cz + Math.sin(a) * g.r, aq)) return false;
        }
        return true;
      }
      const n = Math.max(3, Math.round(g.len / 3));
      for (let s = 0; s <= n; s++) {
        const a = g.a0 + g.sweep * (s / n), ca = Math.cos(a), sa = Math.sin(a);
        for (const rr of [g.R - hw, g.R, g.R + hw]) {
          if (!ptOk(g.cx + ca * rr, g.cz + sa * rr, aq)) return false;
        }
      }
      return true;
    };
    const forkOkAt = (fk) => {
      if (!ptOk(fk.x, fk.z, fk.arms.some((a) => BORDER_KINDS[a.kind].aq))) return false;
      for (const a of fk.arms) {
        if (!segOk(fk.x, fk.z, fk.x + a.dx * fk.L, fk.z + a.dz * fk.L,
                   !!BORDER_KINDS[a.kind].aq, hwOfKind(a.kind))) return false;
      }
      return true;
    };
    const forkOk = new Map();
    for (const fk of plan.forks) forkOk.set(fk.n, forkOkAt(fk));
    // 冒煙統計(同 aligned/arrays 性質):規劃了幾片 vs 真的畫出幾片 —— 分得開
    // 「沒有交界」與「有交界但整段讓路掉了」,否則兩者在畫面上都是「什麼都沒有」
    bStat.planned = plan.chains.reduce((s, c) => s + c.tiles.length, 0);
    bStat.forks = plan.forks.length;
    // ---- 掃掠核心:直段與轉彎共用同一支,差別只在中心線 ----
    // path(t) → [cx, cz, nx, nz](中心點 + 單位法向);直段是直線、轉彎是圓弧
    // ⇒ 轉彎不是「兩段直帶對接」,是同一套斷面沿著彎過去的中心線掃出來的完整一片。
    // flat:三頂點斷面(兩緣 α0、中線 α1)貼地;u = 沿線累計弧長 / bTexL(圖案連續彎過轉角)
    // 橫斷面:α 中段是**平台**不是尖峰 —— 只用三點(0,1,0)會讓整條帶變成軟糊的暈,
    // 讀不出「這是一條有邊的小徑」;平台佔內側 62%,柔邊只留最外側兩成。
    const XS = [[-1, 0, 0], [-0.62, 0.19, 1], [0, 0.5, 1], [0.62, 0.81, 1], [1, 1, 0]];
    // 接頭(楔形/圓帽)逐點取同一條剖面:平台 62%、外側兩成柔邊 —— 與直段同一把尺,
    // 接起來才是同一條帶,MUST NOT 在接頭另寫線性淡出
    const xsAlpha = (t, hw) => Math.min(1, Math.max(0, (1 - Math.abs(t) / hw) / 0.38));
    // 帶緣有機起伏(純函式,吃**世界座標**):中心線仍是 16 方向的弦,只有兩緣沿線起伏 ——
    // 田埂/土路/灌木/潮間帶/海灘的邊本來就不是尺畫出來的。取世界座標而不是取沿線參數 ⇒
    // 相鄰 tile 與轉彎接頭在共用端點上取到同一個值,邊緣連續、不會在接頭處開叉。
    const eN = (x, z, s) => 1 + BORDER_BAND.EDGE_A
      * (vnoise(x * BORDER_BAND.EDGE_W, z * BORDER_BAND.EDGE_W, seed ^ s) - 0.5) * 2;
    // 掃掠繞向:正面 MUST 朝上(sweepUpY 唯一縫)。DoubleSide 底下繞向反了不會破圖,
    // three 只是把法線反轉 ⇒ 整段帶像從地底打光的死黑,而每一條離線斷言照樣全綠。
    const flipOf = (path, rings) => {
      const [ax, az, nx, nz] = path(0);
      const [bx, bz] = path(Math.min(1, 1 / Math.max(1, rings)));
      return sweepUpY(bx - ax, bz - az, nx, nz) < 0;
    };
    // 這一層自己的弦長(餵 drapeSag,見 SAG 檔頭 ⑥):沿線 = 環距、橫向 = XS 的 0.38 步 × 半寬,
    // 取大者。**MUST NOT 用底毯的 cell/2** —— 抬升 ∝ 弦長²,拿 6.5m 去抬 2m 的環就是頂到
    // MAX 0.6m 浮成一條台(使用者:「土路/潮間帶/海灘不要凸起」)
    const bandSagR = (kd, ringLen) => Math.max(ringLen, kd.w * 0.38 / 2);
    // 帶的方向性(2026-08-13 使用者「作為分界線的話應該是兩邊不同類型的區域才對」):
    // 標了 `flat.wet` 的過渡型畫筆約定 **v = 1 是水側**(見 BORDER_PAINTERS 檔頭的 v 契約),
    // 而中心線的法向由鏈的走向決定 —— 同一種分界線在圖上兩處可以剛好相反。發射端據此把 v 軸
    // 轉正:水側 = **地形較低**的那一邊(貼水種類的水面恆低於陸地,這是判準而不是查表)。
    // 逐**片**定案不是逐頂點 —— 逐頂點在兩側幾乎等高處會來回翻,那是把圖案沿線撕開。
    // (ax, az) = v 遞增方向;沒標 wet 的畫筆恆回 false ⇒ 逐位元同舊制。
    const wetFlipAt = (kd, x, z, ax, az, r) => !!kd.wet
      && terrain.heightAt(x - ax * r, z - az * r) < terrain.heightAt(x + ax * r, z + az * r);
    const sweepFlat = (kind, kd, aq, path, rings, u0, len, a0, a1) => {
      const b = bkOf(flatB, kind, true);
      const w2 = kd.w / 2, lift = bLift(kind), NC = XS.length, texL = bTexL(kd);
      const sagR = bandSagR(kd, len / Math.max(1, rings));
      const flip = flipOf(path, rings);
      const [mx, mz, mnx, mnz] = path(0.5);
      const vflip = wetFlipAt(kd, mx, mz, mnx, mnz, w2);
      for (let s = 0; s <= rings; s++) {
        const t = s / rings;
        const [cx, cz, nx, nz] = path(t);
        const ea = s === 0 ? a0 : s === rings ? a1 : 1;   // 自由端 α=0 收尾、接頭端 α=1 對接
        const u = (u0 + len * t) / texL;
        const eL = eN(cx, cz, 0x1F17), eR = eN(cx, cz, 0x2E29);   // 兩緣各自起伏
        for (const [f, v, va] of XS) {
          const ff = f * (f < 0 ? eL : eR);
          const gx = cx + nx * w2 * ff, gz = cz + nz * w2 * ff;
          const wsh = wash(gx, gz);
          b.pos.push(gx, gY(gx, gz, aq) + lift + drapeSag(terrain.heightAt, gx, gz, sagR), gz);
          b.nrm.push(0, 1, 0);
          pushLandN(b, terrain.heightAt, gx, gz, terrain.gridM);
          b.uv.push(u, vflip ? 1 - v : v);
          b.col.push(wsh, wsh, wsh, va * ea);
        }
        if (s) {
          const p0 = b.base + (s - 1) * NC, q0 = p0 + NC;
          for (let k = 0; k < NC - 1; k++) {
            if (flip) b.idx.push(p0 + k, p0 + k + 1, q0 + k, p0 + k + 1, q0 + k + 1, q0 + k);
            else b.idx.push(p0 + k, q0 + k, p0 + k + 1, p0 + k + 1, q0 + k, q0 + k + 1);
          }
        }
      }
      b.base += (rings + 1) * NC;
    };
    // 離散件的盒子(木柵欄的樁與橫桿 / 岩塊 / 紅樹林支柱根叢):沿路徑的局部框
    // (t 切向、up、n 法向;t×up = n ⇒ 右手系,六個面各自帶外法線)。
    // 六面各自四頂點 = 折邊真的出得了線;繞向逐面由右手三元組定,**不吃 flip** ——
    // 盒子是封閉體,朝向由自己的面法線決定,與掃掠帶「哪一側朝上」無關。
    const ridgeBox = (b, cx, cz, tx, tz, hl, hw, y0, y1) => {
      const nx = -tz, nz = tx;                       // n = t × up(右手系)
      // 角點:i 沿 t、j 沿 up(−1 = y0 / +1 = y1)、k 沿 n
      const P = (i, j, k) => [cx + tx * hl * i + nx * hw * k, j > 0 ? y1 : y0, cz + tz * hl * i + nz * hw * k];
      for (const [N, Q] of BOX_FACES) {
        const o = b.base;
        for (const [i, j, k] of Q) {
          const p = P(i, j, k);
          b.pos.push(p[0], p[1], p[2]);
          b.nrm.push(N[0] * tx + N[2] * nx, N[1], N[0] * tz + N[2] * nz);   // 局部法線 → 世界
        }
        b.idx.push(o, o + 1, o + 2, o, o + 2, o + 3);
        b.base += 4;
      }
    };
    // 離散脊:`form` 決定「這東西在現實裡是不是連續的」(見 BORDER_KINDS 檔頭)。
    //   posts —— 樁恆落在**兩端**(i/n)⇒ 相鄰片與轉角共用端樁,接縫不擠成兩根;
    //            橫桿在樁與樁之間、`rail.y` 是佔全高的比例 ⇒ 讀起來是木柵欄不是一道牆。
    //   clumps —— pitch 一顆,尺寸/高度/橫向偏移吃 ehash(零共享 rnd,§2.3)。
    const partRidge = (kind, kd, aq, path, hseed, len) => {
      const b = bkOf(ridgeB, kind, false);
      const n = Math.max(1, Math.round((len || kd.pitch) / kd.pitch));
      const at = (t) => {
        const [cx, cz, nx, nz] = path(Math.min(1, Math.max(0, t)));
        return [cx, cz, nz, -nx];                    // 切向 = 法向轉 90°(path 的 n = (−dz, dx))
      };
      if (kd.form === 'posts') {
        const R = kd.rail, pw = (kd.pw ?? kd.w) / 2, hw = kd.w / 2;
        const P = [];
        for (let i = 0; i <= n; i++) {
          const [cx, cz, tx, tz] = at(i / n);
          const gy = gY(cx, cz, aq) - 0.12;
          const h = kd.h * (1 + (ehash(hseed + i, hseed * 7, 13) - 0.5) * (kd.jit || 0));
          ridgeBox(b, cx, cz, tx, tz, pw, hw, gy, gy + h);
          P.push([cx, cz, gy, h]);
        }
        if (!R) return;
        for (let i = 0; i < n; i++) {                 // 橫桿:兩樁之間,量到樁心(端頭埋進樁裡)
          const [ax, az, ay, ah] = P[i], [bx, bz, by, bh] = P[i + 1];
          const dx = bx - ax, dz = bz - az, l = Math.hypot(dx, dz);
          if (l < 1e-3) continue;
          const mx = (ax + bx) / 2, mz = (az + bz) / 2;
          for (const ry of R.y) {
            const y0 = (ay + ah * ry + by + bh * ry) / 2;
            ridgeBox(b, mx, mz, dx / l, dz / l, l / 2, R.t / 2, y0, y0 + R.h);
          }
        }
        return;
      }
      for (let i = 0; i < n; i++) {                   // clumps
        const [cx, cz, tx, tz] = at((i + 0.5) / n);
        const j1 = ehash(hseed + i, hseed * 7, 13), j2 = ehash(hseed * 3 + i, 5, hseed | 1);
        const j3 = ehash(i, hseed * 11, 29);
        const off = (j3 - 0.5) * 2 * (kd.lat ?? 0) * (kd.w / 2);
        const ox = cx - tz * off, oz = cz + tx * off;
        const gy = gY(ox, oz, aq) - 0.12;
        const sc = 1 + (j1 - 0.5) * (kd.jit || 0);
        ridgeBox(b, ox, oz, tx, tz, kd.wt / 2 * sc, kd.w / 2 * (0.45 + j2 * 0.4),
          gy, gy + kd.h * sc);
      }
    };
    // ridge:梯形斷面沿同一條中心線掃掠;端面封口。斷面順序(底左/底右/頂左/頂右)是
    // flat 的鏡像 ⇒ 繞向判準取反(sweepUpY > 0 才要翻)。DoubleSide 只保證看得見,
    // 不保證亮度 —— 側面繞向反了同樣是整根死黑
    const sweepRidge = (kind, kd, aq, path, spans, hseed, len) => {
      const b = bkOf(ridgeB, kind, false);
      if (kd.form) { partRidge(kind, kd, aq, path, hseed, len); return; }
      const w2 = kd.w / 2, wt2 = kd.wt / 2;
      const flip = !flipOf(path, spans);
      const nrm = (v) => { const l = Math.hypot(v[0], v[1], v[2]) || 1; return [v[0] / l, v[1] / l, v[2] / l]; };
      const first = b.base;
      let prev = null;
      for (let s = 0; s <= spans; s++) {
        const [cx, cz, nx, nz] = path(s / spans);
        const NL = nrm([-nx, 0.25, -nz]), NR = nrm([nx, 0.25, nz]);   // 側面外法線(略朝上,倒角)
        const NLt = nrm([-nx * 0.4, 1, -nz * 0.4]), NRt = nrm([nx * 0.4, 1, nz * 0.4]);
        const gy = gY(cx, cz, aq) - 0.12;                             // 底埋入地表,無縫接地
        const topY = gy + kd.h * (1 + (ehash(hseed + s, hseed * 7, 13) - 0.5) * kd.jit);
        const idx0 = b.base;
        const push = (px, py, pz, n) => { b.pos.push(px, py, pz); b.nrm.push(n[0], n[1], n[2]); };
        push(cx - nx * w2, gy, cz - nz * w2, NL);
        push(cx + nx * w2, gy, cz + nz * w2, NR);
        push(cx - nx * wt2, topY, cz - nz * wt2, NLt);
        push(cx + nx * wt2, topY, cz + nz * wt2, NRt);
        b.base += 4;
        if (prev != null) {
          const p0 = prev, q0 = idx0;
          const tri = (a2, b2, c2) => (flip ? b.idx.push(a2, c2, b2) : b.idx.push(a2, b2, c2));
          tri(p0, p0 + 2, q0); tri(q0, p0 + 2, q0 + 2);               // 左側面
          tri(p0 + 1, q0 + 1, p0 + 3); tri(p0 + 3, q0 + 1, q0 + 3);   // 右側面
          tri(p0 + 2, p0 + 3, q0 + 2); tri(q0 + 2, p0 + 3, q0 + 3);   // 頂面
        }
        prev = idx0;
      }
      const cap = (a2, b2, c2) => (flip ? b.idx.push(a2, c2, b2) : b.idx.push(a2, b2, c2));
      cap(first, first + 1, first + 3); cap(first, first + 3, first + 2);
      cap(prev, prev + 3, prev + 1); cap(prev, prev + 2, prev + 3);
    };
    // 直段中心線(吃**退縮後**的端點:接頭那一段空間讓給接頭拼圖)
    const linePath = (tl) => {
      const dx = tl.bx - tl.ax, dz = tl.bz - tl.az, l = Math.hypot(dx, dz) || 1;
      const nx = -dz / l, nz = dx / l;
      return [(t) => [tl.ax + dx * t, tl.az + dz * t, nx, nz], l];
    };
    // 圓弧中心線(轉彎接頭):法向 = 徑向,取「指向圓心外側」的一致方向
    const arcPath = (g, t0, t1) => {
      const sgn = g.sweep >= 0 ? 1 : -1;
      return (t) => {
        const a = g.a0 + g.sweep * (t0 + (t1 - t0) * t);
        const rx = Math.cos(a), rz = Math.sin(a);
        return [g.cx + rx * g.R, g.cz + rz * g.R, rx * sgn, rz * sgn];
      };
    };
    // 圓帽接頭(急彎):半徑 hw 的圓盤 —— 標準 round join,一片完整拼圖。
    // 接力急彎時沿角平分線切半,兩臂各畫各的;立體脊另立一根接頭墩。
    const emitCap = (cor, fromA, tlKind) => {
      const g = cor.geo;
      const arms2 = [cor.a, cor.b];
      const halves = cor.a.kind === cor.b.kind ? [[0, 2, tlKind]] : [[0, 1, cor.a.kind], [1, 2, cor.b.kind]];
      // 切半基準:角平分線的法線方向(a 臂那半 / b 臂那半)
      const sx = cor.a.dx + cor.b.dx, sz = cor.a.dz + cor.b.dz;
      const sl2 = Math.hypot(sx, sz) || 1;
      const base = Math.atan2(-sx / sl2, sz / sl2);   // 平分線的法線 ⇒ 半圓切在兩臂之間
      const NF = 12;
      const bxu = sx / sl2, bzu = sz / sl2;            // 平分線單位向量 = 圓帽的局部框
      for (const [h0, h1, kk] of halves) {
        const kdef = BORDER_KINDS[kk];
        if (!kdef.flat) continue;
        const b = bkOf(flatB, kk, true), lift = bLift(kk), aq = !!kdef.aq;
        const sagR = bandSagR(kdef.flat, g.r * Math.PI / NF);   // 扇形的弦 = 圓帽半徑上的弧步
        const vflip = wetFlipAt(kdef.flat, g.cx, g.cz, -bzu, bxu, g.r);   // v 軸 = 平分線的法線
        // 以平分線為框取 UV 與 α:橫過帶的方向仍走**帶剖面**(中線實、兩緣 0),
        // MUST NOT 用「徑向淡出 + v 固定」—— 那會把紋理最深的中線鋪成一塊實心圓斑
        const put = (px, pz) => {
          const s2 = (px - g.cx) * bxu + (pz - g.cz) * bzu;
          const t2 = (px - g.cx) * -bzu + (pz - g.cz) * bxu;
          const wsh = wash(px, pz);
          b.pos.push(px, gY(px, pz, aq) + lift + drapeSag(terrain.heightAt, px, pz, sagR), pz);
          b.nrm.push(0, 1, 0);
          pushLandN(b, terrain.heightAt, px, pz, terrain.gridM);
          const vv = Math.min(1, Math.max(0, 0.5 + t2 / (g.r * 2)));
          b.uv.push(s2 / bTexL(kdef.flat), vflip ? 1 - vv : vv);
          b.col.push(wsh, wsh, wsh, xsAlpha(t2, g.r));
        };
        put(g.cx, g.cz);
        const n2 = Math.max(3, Math.round(NF * (h1 - h0) / 2));
        for (let s = 0; s <= n2; s++) {
          const ang = base + Math.PI * (h0 + (h1 - h0) * (s / n2));
          put(g.cx + Math.cos(ang) * g.r, g.cz + Math.sin(ang) * g.r);
          // 扇形沿**遞增角**展開 ⇒ 在 (x,z) 俯視是逆向,繞向必須倒過來才正面朝上(同 sweepUpY)
          if (s) b.idx.push(b.base, b.base + s + 1, b.base + s);
        }
        b.base += n2 + 2;
      }
      for (const arm of arms2) {                       // 立體脊:自節點沿臂掃到斷面 = 接頭墩
        const kdef = BORDER_KINDS[arm.kind];
        if (!kdef.ridge) continue;
        const nx = -arm.dz, nz = arm.dx;
        sweepRidge(arm.kind, kdef.ridge, !!kdef.aq,
          (t) => [g.cx + arm.dx * g.L * t, g.cz + arm.dz * g.L * t, nx, nz],
          Math.max(1, Math.round(g.L / 2)), cor.n, g.L);
      }
    };
    // Accumulated arc length at joint ends (keyed by node + kind): fork puzzles align each arm pattern phase to it, so motifs never jump at crossings
    const uAt = new Map();
    const uKey = (n, kind) => `${n}|${kind}`;
    for (const ch of plan.chains) {
      const nT = ch.tiles.length;
      // 逐片先算「可畫的區間」:讓路 MUST 是**逐段**的,不是整片全有或全無 ——
      // 共線的交界會被 16 方向量化併成一整片(實測一條 900m 的直線交界 = 1 片),
      // 整片判定的話,沿線任何一處有停車場就讓整條界線消失(2026-08-11 實測:
      // 市區側規劃 1 片 → 實畫 0 片 = 0% 覆蓋)。改逐段後,界線只在該讓的地方斷開。
      const info = ch.tiles.map((tl) => {
        const kdef = BORDER_KINDS[tl.kind];
        const runs = tileRuns(tl, !!kdef.aq, hwOfKind(tl.kind));
        return { kdef, runs, head: runs.length > 0 && runs[0][0] === 0,
                 tail: runs.length > 0 && runs[runs.length - 1][1] === 1 };
      });
      let u = 0;
      for (let t = 0; t < nT; t++) {
        const tl = ch.tiles[t], nf = info[t];
        const kdef = nf.kdef;
        const [path, len] = linePath(tl);
        if (!nf.runs.length) { u = 0; continue; }       // 整片都該讓路:紋理弧長歸零重起
        // 接續端 = 相鄰 tile 那一頭真的畫到底,或這一端接的是**真的畫得出來的**岔路
        // (岔路是鏈的邊界 ⇒ j0/j1 恆 false,只看 j 會讓每條臂在路口前淡出成殘影);
        // 轉彎同理:接頭讓路而沒畫時,直段那一端 MUST 收成 α=0,不能停在半空
        const cOk0 = !tl.c0 || cornerOk(tl.c0, !!kdef.aq);
        const cOk1 = !tl.c1 || cornerOk(tl.c1, !!kdef.aq);
        const okPrev = nf.head && cOk0
          && (tl.f0 ? forkOk.get(tl.n0) : (tl.j0 && info[(t - 1 + nT) % nT].tail));
        const okNext = nf.tail && cOk1
          && (tl.f1 ? forkOk.get(tl.n1) : (tl.j1 && info[(t + 1) % nT].head));
        uAt.set(uKey(tl.n0, tl.kind), u);
        bStat.drawn++;
        for (const [r0, r1] of nf.runs) {
          const sl = len * (r1 - r0);
          const p = (tt) => path(r0 + (r1 - r0) * tt);
          const a0 = r0 === 0 ? (okPrev ? 1 : 0) : 0;    // 區間內側的斷口一律淡出收尾
          const a1 = r1 === 1 ? (okNext ? 1 : 0) : 0;
          // 環距 4 → 2.2m(與轉彎圓弧同密度):弦短一截,貼合抬升就少 (2.2/4)² ≈ 三成
          if (kdef.flat) sweepFlat(tl.kind, kdef.flat, !!kdef.aq, p,
                                   Math.max(1, Math.round(sl / 2.2)), u + len * r0, sl, a0, a1);
          if (kdef.ridge) sweepRidge(tl.kind, kdef.ridge, !!kdef.aq, p,
                                     Math.max(1, Math.round(sl / 5)), tl.n0 + ((r0 * 97) | 0), sl);
        }
        u += len;
        uAt.set(uKey(tl.n1, tl.kind), u);
        // ---- 轉彎拼圖:整片畫出來(圓弧掃掠 / 急彎走圓帽),不是把下一段直帶黏上來 ----
        const cor = tl.c1;
        if (!cor || !okNext || !cOk1) { u += cor ? cor.geo.len : 0; continue; }
        const g = cor.geo;
        const mixed = cor.a.kind !== cor.b.kind;        // 接力轉彎:前後半各畫各的圖案
        // 這一片是自 tl 那一臂轉向另一臂:tl 的臂在 cor 裡可能是 a 也可能是 b,
        // 弧的參數方向恆自 Pa→Pb,所以要先認出自己是哪一端
        const fromA = Math.abs(g.Pa[0] - tl.bx) + Math.abs(g.Pa[1] - tl.bz) < 1e-6;
        if (g.mode === 'arc') {
          const segs = mixed ? [[0, 0.5, fromA ? cor.a.kind : cor.b.kind],
                               [0.5, 1, fromA ? cor.b.kind : cor.a.kind]]
                             : [[0, 1, tl.kind]];
          let uu = u;
          for (const [s0, s1, kk] of segs) {
            const kdf = BORDER_KINDS[kk];
            const sl = g.len * (s1 - s0);
            const p = fromA ? arcPath(g, s0, s1) : arcPath(g, 1 - s0, 1 - s1);
            const rings = Math.max(2, Math.round(sl / 2.2));   // 弧段取樣密一點,彎才圓順
            if (kdf.flat) sweepFlat(kk, kdf.flat, !!kdf.aq, p, rings, uu, sl, 1, 1);
            if (kdf.ridge) sweepRidge(kk, kdf.ridge, !!kdf.aq, p, rings, cor.n, sl);
            uu += sl;
          }
          u = uu;
        } else if (g.mode === 'cap') {
          // 急彎:圓帽接頭(標準 round join)—— 一片完整的圓盤,兩臂各佔半邊圖案
          emitCap(cor, fromA, tl.kind);
          u += g.len;
        }
      }
    }
    // ---- Fork puzzle: per-arm wedges meet at the center, each carrying its own motif (relay); MUST NOT cap the seam with a pad ----
    // Polygon (CCW) = [B0,A0,B1,A1,...], Bi/Ai = the two edges of arm i cross-section; arms split at midpoints,
    // each wedge goes into its own kind bucket, so a three-divider crossing is three real puzzle pieces, not one cover plate.
    for (const fk of plan.forks) {
      if (!forkOk.get(fk.n)) continue;     // 讓路判定與直段同一支(逐臂取樣,不是只驗中心點)
      bStat.forksDrawn++;
      const k = fk.arms.length;
      // 逐臂斷面:**沿用直段的 XS 橫斷面表**(自 f=-1 到 +1;A = 逆時針側 f=+1)。
      // 只放兩緣的話,α 會自中心線性內插到 0,正好在直段起點開一個洞(路口變成白十字)。
      const E = fk.arms.map((a) => {
        const nx = -a.dz, nz = a.dx;
        const cx = fk.x + a.dx * fk.L, cz = fk.z + a.dz * fk.L;
        const hw = (BORDER_KINDS[a.kind].flat?.w ?? BORDER_KINDS[a.kind].ridge.w) / 2;
        // 帶緣起伏取**斷面中心的世界座標** ⇒ 與該臂直段退縮端那一圈同值,楔形與直段接得上
        const eL = eN(cx, cz, 0x1F17), eR = eN(cx, cz, 0x2E29);
        const xs = XS.map(([f]) => {
          const ff = f * (f < 0 ? eL : eR);
          return [cx + nx * hw * ff, cz + nz * hw * ff];
        });
        return { xs, B: xs[0], A: xs[xs.length - 1] };
      });
      const M = E.map((e, i) => {                       // 相鄰臂之間的切分中點
        const nx = E[(i + 1) % k].B;
        return [(e.A[0] + nx[0]) / 2, (e.A[1] + nx[1]) / 2];
      });
      for (let i = 0; i < k; i++) {
        const a = fk.arms[i], kdef = BORDER_KINDS[a.kind];
        const aq = !!kdef.aq;
        if (kdef.flat) {
          const b = bkOf(flatB, a.kind, true);
          const lift = bLift(a.kind), hw = kdef.flat.w / 2;
          const sagR = bandSagR(kdef.flat, fk.L);              // 楔形自節點量到斷面 = fk.L
          const vflip = wetFlipAt(kdef.flat, fk.x, fk.z, -a.dz, a.dx, hw);
          const u0 = uAt.get(uKey(fk.n, a.kind)) ?? 0;
          // 楔形 = 扇形過 [M(i-1), B_i, A_i, M_i];UV 與 α 都取**該臂的局部框 + 帶剖面**
          // (中線實、兩緣 0)⇒ 交會處讀起來是三條帶匯進來,MUST NOT 用徑向淡出(會糊成一團)
          const ring = [M[(i - 1 + k) % k], ...E[i].xs, M[i]];
          const put = (px, pz) => {
            const s = (px - fk.x) * a.dx + (pz - fk.z) * a.dz;
            const t2 = (px - fk.x) * -a.dz + (pz - fk.z) * a.dx;
            const wsh = wash(px, pz);
            b.pos.push(px, gY(px, pz, aq) + lift + drapeSag(terrain.heightAt, px, pz, sagR), pz);
            b.nrm.push(0, 1, 0);
            pushLandN(b, terrain.heightAt, px, pz, terrain.gridM);
            const vv = Math.min(1, Math.max(0, 0.5 + t2 / (hw * 2)));
            b.uv.push((u0 - fk.L + s) / bTexL(kdef.flat), vflip ? 1 - vv : vv);
            b.col.push(wsh, wsh, wsh, xsAlpha(t2, hw));
          };
          put(fk.x, fk.z);
          for (const p of ring) put(p[0], p[1]);
          // 楔形扇自 f=-1 掃到 +1 ⇒ 俯視是逆向,繞向倒過來才正面朝上(同 sweepUpY / emitCap)
          for (let s = 0; s < ring.length - 1; s++) b.idx.push(b.base, b.base + 2 + s, b.base + 1 + s);
          b.base += 1 + ring.length;
        }
        if (kdef.ridge) {
          // 立體脊的交會 = 一根接頭墩(角柱/樹叢/岩堆),自節點沿該臂掃到斷面
          const dx = a.dx, dz = a.dz, nx = -dz, nz = dx;
          sweepRidge(a.kind, kdef.ridge, aq,
            (t) => [fk.x + dx * fk.L * t, fk.z + dz * fk.L * t, nx, nz],
            Math.max(1, Math.round(fk.L / 2)), fk.n + i, fk.L);
        }
      }
    }
    for (const [kind, b] of flatB) {
      if (!b.idx.length) continue;
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.Float32BufferAttribute(b.pos, 3));
      geo.setAttribute('normal', new THREE.Float32BufferAttribute(b.nrm, 3));
      geo.setAttribute('uv', new THREE.Float32BufferAttribute(b.uv, 2));
      geo.setAttribute('color', new THREE.Float32BufferAttribute(b.col, 4));
      setLandN(geo, b);
      geo.setIndex(b.idx);
      const m = new THREE.Mesh(geo, envMat(0xffffff, {
        map: borderTex(kind), vertexColors: true, wash: 0.5, cool: 0.5, rim: 0, landNrm: true,
        // 繞向由 sweepUpY / flipOf 定案(正面恆朝上);DoubleSide 只是「自下方也看得見」的
        // 保險,MUST NOT 拿它當繞向的替代品 —— 它讓背面看得見,卻同時把法線反轉成死黑
        transparent: true, side: THREE.DoubleSide,
      }));
      m.renderOrder = -1.1 + bKinds.indexOf(kind) * 0.005;   // ∈ [-1.1, -1.05]:晚於脊帶 -1.2、早於特徵層 0
      m.frustumCulled = false;
      m.userData.noOutline = true;
      m.userData.gborder = kind; m.userData.glayer = 'border';   // 冒煙識別標記(同上)
      group.add(m);
    }
    for (const [kind, b] of ridgeB) {
      if (!b.idx.length) continue;
      const kd = BORDER_KINDS[kind].ridge;
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.Float32BufferAttribute(b.pos, 3));
      geo.setAttribute('normal', new THREE.Float32BufferAttribute(b.nrm, 3));
      geo.setIndex(b.idx);
      // 立體脊:`land` 但**不換法線** —— 它是真的有形狀的東西(梯形斷面),折邊那一項照舊
      // 出線;共用 id 只是讓它與底下的地被之間不再多一條「不同材質」的假線。
      const m = new THREE.Mesh(geo, envMat(kd.color === 'foliage' ? snB.foliage : kd.color,
        { wash: 0.4, cool: 0.45, side: THREE.DoubleSide, land: true }));
      m.frustumCulled = false;
      m.userData.noOutline = true;
      m.userData.gborder = kind; m.userData.glayer = 'border';   // 冒煙識別標記(同上)
      group.add(m);
    }
  }

  // ---- Feature color-block Mesh (one draw call per surface-by-variant) ----
  for (const [key, b] of buckets) {
    if (!b.idx.length) continue;
    const [sub, v] = b.surfaceKey.split('#');
    const def = DEFS[sub];
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(b.pos, 3));
    geo.setAttribute('normal', new THREE.Float32BufferAttribute(b.nrm, 3));
    geo.setAttribute('uv', new THREE.Float32BufferAttribute(b.uv, 2));
    geo.setAttribute('color', new THREE.Float32BufferAttribute(b.col, 4));   // RGBA:fade 邊用頂點 alpha
    setLandN(geo, b);
    geo.setIndex(b.idx);
    const tint = def.green && !def.seasonal ? (SEASON_TINT[season] ?? 0xffffff) : 0xffffff;   // 同底毯:四季設計不再吃濾鏡
    const m = new THREE.Mesh(geo, envMat(tint, {
      map: textureOf(sub, +v, def.uv === 'fit', b.environment),
      vertexColors: true, wash: 0.5, cool: 0.5, rim: 0,   // 貼地面關 rim(同底毯)
      transparent: def.edge === 'fade',   // 淡出邊融入地形;depthWrite 保持 true(貼花式)
      landNrm: true,                      // 地貌類別 + 真地形法線(同底毯)
    }));
    m.frustumCulled = false;
    m.userData.noOutline = true;
    // 特徵拼圖識別標記:冒煙測試核對不疊置/反重複/分區相符用
    m.userData.gsub = sub; m.userData.gvar = +v; m.userData.surfaceEnvironment = b.environment; m.userData.gshape = def.shape;
    group.add(m);
  }

  // ---- 農田田埂 Mesh(全場一個 draw call;2026-08-13)----
  // 畫筆走 `borderTex('fieldridge')` = 界線拼圖那一份 `fieldpath` 夯土畫筆(**同一個縫**;
  // 田埂就是田埂,沒有理由多養一支)。`land: true` 但**不換法線** —— 同立體脊的處理:
  // 它是真的有斷面的東西,折邊那一項要照樣出線(埂頂與外側垂直面的 90° 折角就是那條線),
  // 共用 id 只是不要在埂與底下的田之間多畫一條「不同材質」的假線。
  for (const [, b] of bundBuckets) {
    if (!b.idx.length) continue;
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(b.pos, 3));
    geo.setAttribute('normal', new THREE.Float32BufferAttribute(b.nrm, 3));
    geo.setAttribute('uv', new THREE.Float32BufferAttribute(b.uv, 2));
    geo.setAttribute('color', new THREE.Float32BufferAttribute(b.col, 4));
    setLandN(geo, b);
    geo.setIndex(b.idx);
    const m = new THREE.Mesh(geo, envMat(0xffffff, {
      map: borderTex('fieldridge'), vertexColors: true, wash: 0.45, cool: 0.5, rim: 0,
      land: true, landNrm: true,   // 埂頂吃真地形法線、垂直面吃自己的面法線(見 emitBund)
    }));
    m.frustumCulled = false;
    m.userData.noOutline = true;
    m.userData.glayer = 'bund';   // 冒煙識別標記(同拼圖的 gsub/glayer 慣例)
    group.add(m);
  }

  // ---- 細節 InstancedMesh(每零件一個 draw call;實例色抖動同植被)----
  const sn = ENV.seasons.summer;
  const partColor = (c) => c === 'grass' ? sn.grass : c === 'foliage' ? sn.foliage : c === 'palette' ? 0xffffff : c;
  const M = new THREE.Matrix4(), Q = new THREE.Quaternion(), E = new THREE.Euler();
  const P = new THREE.Vector3(), S = new THREE.Vector3(), tint = new THREE.Color();
  const dryPlantColor = new THREE.Color(0xa08c58);
  for (const type in det) {
    const appearance = new Map(det[type].map(it => [it, groundPlantState(type, environmentAt(it.x, it.z))]));
    for (let variant = 0; variant < DETAIL_VARIANTS[type].length; variant++) {
    const items = det[type].filter(it => it.variant === variant && appearance.get(it).visible);
    if (!items.length) continue;
    // ---- 表面群組 + outlineContribution(2026-08-16;序 3 的 S3 / S4 消費端)----
    // 使用者追加的「石堆的處置」:一顆石頭在畫面上是**一個東西**。現況是 `boulder` 的大小
    // 兩瓣、`slab` 的板 + 墩、`snag` 的幹 + 兩枝各自是一個逐材質 surfaceId ⇒ **每一顆石頭
    // 中間被切一刀**(而兩顆不同的石頭反而同號 —— 一款 = 一個 InstancedMesh = 一份材質)。
    // ①**取號 MUST 在零件迴圈之外**(逐 `type` 一次):放進去就是逐零件各一號 = 完全沒做,
    //   而「有沒有呼叫 surfGroup」看起來一模一樣(反向驗證 `--break-detsurf` 咬的正是位置)。
    // ②**粒度是「一顆」不是「一堆」**:兩顆之間的輪廓由**深度**那一項給(它們是分開的實體,
    //   深度真的有落差)⇒ 這裡刻意**不標 `ink: 'group'`**。標了的話群組早退會把「五格同號」
    //   的判定套到全世界同款的石頭上,岩屑坡上那十幾顆當場糊成一坨(rock-silhouette 規格
    //   點名的那個坑)。同號只讓 `INK_MRT.ID` 那一項閉嘴、並讓法線折邊改吃 `SELF_F` 的門檻。
    // ③**貢獻由既有的實測縫 `detailR(type)` 推導**(量零件真幾何;手寫值會靜默過期),
    //   直徑 = ×2 ⇒ `pebble`(r≈0.42)之類「畫面上只有幾個像素」的東西不值得一條線,
    //   而 `boulder`(r≈1.25)以上恆為 1(= 舊制)。零新名冊。
    // **零亂數消耗**:`surfGroup()` 吃的是 toon.js 的模組級序不是共享 `rnd()`(§2.3)。
    const sg = surfGroup(), sCtr = inkCtrM(detailR(type) * 2);
    for (const part of DETAIL_VARIANTS[type][variant]) {
      // 材質塗層與 2D 地表同語彙:低頻水彩 wash + 冷藍陰影(envMat),
      // 人造附件再疊程序貼圖(貨櫃浪板/太陽能電池格/看板畫面/木箱板紋)
      // 軟性(A39):稻/草/芒草/蘆葦/花/灌木隨風飄揚 + 細勾線。錨點 base = 0 —— 這一張表的
      // 落地平移烤在幾何裡,頂點的 y 本身就是整株座標(見 DETAIL_DEFS 檔頭那一段)。
      const plantColor = part.c === 'grass' || part.c === 'foliage';
      const plantBase = plantColor ? new THREE.Color(partColor(part.c)) : null;
      const plantTint = plantColor ? new THREE.Color() : null;
      const mat = envMat(plantColor ? 0xffffff : partColor(part.c), {
        wash: 0.35, cool: 0.4,
        surf: sg, contrib: sCtr,
        ...(part.sf ? { soft: { k: part.sf, span: detailSpan(type), base: 0, sy: part.sy ?? 1 } } : {}),
      });
      const m = new THREE.InstancedMesh(part.geo.clone(), mat, items.length);
      m.userData.proceduralGroundPart = { type, variant };
      items.forEach((it, i) => {
        E.set(it.tx || 0, it.ry, it.tz || 0);   // 隨機傾角(TILT 表)+ 隨機朝向
        Q.setFromEuler(E);
        P.set(it.x, it.y, it.z);
        S.set(it.s, it.s * (part.sy ?? 1) * it.sy, it.s);
        M.compose(P, Q, S);
        m.setMatrixAt(i, M);
        if (part.c === 'palette' && it.tint != null) tint.setHex(it.tint);
        else {
          const j1 = ((i * 2654435761) >>> 0) % 100 / 100;
          const j2 = ((i * 1597334677) >>> 0) % 100 / 100;
          const j3 = ((i * 3812015801) >>> 0) % 100 / 100;
          tint.setRGB(0.84 + j1 * 0.3, 0.84 + j2 * 0.3, 0.84 + j3 * 0.3);
        }
        if (plantColor) tint.multiply(plantTint.copy(plantBase).lerp(dryPlantColor, appearance.get(it).dry));
        m.setColorAt(i, tint);
      });
      m.instanceMatrix.needsUpdate = true;
      if (m.instanceColor) m.instanceColor.needsUpdate = true;
      m.castShadow = false;
      m.frustumCulled = false;
      group.add(m);
    }
    }
  }
  // 擺放全數定案後才登記碰撞，避免 collider 反過來改變同一批細節的淘汰順序。
  for (const type of PHYSICAL_DETAILS) {
    for (const it of det[type] || []) {
      const col = detailCollider(type, it);
      if (col) blockers.push(col);
    }
  }
  // orphans = 找不到主人格的地形四邊形數(結構上應恆為 0:抖動 < 0.45 格 ⇒ 主人恆在 3×3 內。
  // > 0 就是認養搜尋範圍或抖動幅度有人動過,而畫面上只表現成偶爾一格禿掉露出地形)
  // 影子的**承接面**(2026-08-14):地貌那幾層蓋住了絕大部分的地形三角形 ——
  // 只讓 `terrain.mesh` 收影子的話,機體的影子會在有底毯的地方整片消失(而空地上有,
  // 讀起來像「影子時有時無」)。投射一律不開:這些是貼地面,自己投不出東西,
  // 而 3D 細節那一批本來就顯式 `castShadow = false`(instanced 的陰影 pass 是純浪費)。
  group.traverse((o) => { if (o.isMesh) o.receiveShadow = true; });
  group.userData.proceduralSurfaces = generatedSurfaces;
  return { patches: placed, details: detCount, cells: landCells.length, aligned, arrays: arraysN,
           border: bStat, bufCells, orphans: orphanQuads, bandDryAt };
}
