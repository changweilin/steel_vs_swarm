// Continuous boundary cross-sections. Adjacent segments sample identical world coordinates;
// segment seeds never change their end profiles. No Three.js or shared random stream.
import { ROCK_SEASON_TINT, environmentParts } from './environmentParts.js';
import { mulberry32 } from './rng.js';

const hillSection = [[-.5, 0], [-.35, .32], [-.16, .7], [0, .86], [.2, .65], [.38, .25], [.5, 0]];
const shelfSection = [[-.5, 0], [-.38, .1], [.36, .1], [.5, 0]];
// Domain, slope capability and model recipe are declared together.
export const EXPANDED_BOUNDARIES = Object.freeze({
  densegiants: { label: '密集連綿神木林', category: 'giant-tree', bio: ['green', 'wet'], slope: 'steep', depth: 18, h: 60, color: 0x586647, section: shelfSection, object: 'gianttree', rows: 2, pitch: 6 },
  cliffvillage: { label: '山壁階地聚落', category: 'residential', bio: ['urban', 'bare'], slope: 'steep', depth: 18, h: 26, color: 0x8e8471, section: shelfSection, object: 'house', rows: 2, pitch: 8, foundation: true },
  alpinecity: { label: '密集山城高樓', category: 'highrise', bio: ['urban'], slope: 'steep', depth: 18, h: 48, color: 0x777b77, section: shelfSection, object: 'skyscraper', rows: 2, pitch: 8, foundation: true },
  rollinghills: { label: '連綿草丘', category: 'rock', bio: ['green', 'bare'], slope: 'steep', depth: 18, h: 26, color: 0x718052, section: hillSection, rock: true, relief: true },
  foresthills: { label: '林木連綿山丘', category: 'giant-tree', bio: ['green'], slope: 'steep', depth: 18, h: 48, color: 0x68754c, section: hillSection.map(([z, y]) => [z, y * .16]), rock: true, object: 'gianttree', rows: 2, pitch: 9 },
  basaltspine: { label: '玄武岩連峰', category: 'rock', bio: ['bare', 'wet'], slope: 'steep', depth: 18, h: 34, color: 0x565d5c, section: hillSection, rock: true, relief: true },
  terracedfarms: { label: '梯田農舍帶', category: 'agriculture', bio: ['green', 'bare'], slope: 'mid', depth: 18, h: 18, color: 0x8a9461, section: shelfSection, object: 'ranch', rows: 1, pitch: 14, foundation: true },
  hillsidegreenhouses: { label: '坡地溫室帶', category: 'agriculture', bio: ['green'], slope: 'mid', depth: 18, h: 16, color: 0x818b64, section: shelfSection, object: 'greenhouse', rows: 1, pitch: 12, foundation: true },
  warehousebelt: { label: '密集倉儲工業帶', category: 'industry', bio: ['urban', 'bare'], slope: 'flat', depth: 18, h: 22, color: 0x86857b, section: shelfSection, object: 'factory', rows: 2, pitch: 12, foundation: true },
  tankfarm: { label: '油槽儲運區', category: 'industry', bio: ['urban', 'bare'], slope: 'flat', depth: 18, h: 18, color: 0x868b87, section: shelfSection, tanks: true, rows: 2, pitch: 8 },
  canalbank: { label: '運河護岸', category: 'levee', bio: ['wet', 'urban'], slope: 'flat', depth: 12, h: 8, color: 0x8d9691, section: [[-.5,0],[-.45,.85],[.3,.85],[.5,0]] },
  reefchain: { label: '密集連綿礁岩', category: 'coastal', dom: 'water', bio: ['water'], slope: 'flat', depth: 18, h: 16, color: 0x758b80, section: hillSection, rock: true, relief: true },
  seaice: { label: '浮冰冰脊帶', category: 'coastal', dom: 'water', bio: ['water'], slope: 'flat', depth: 18, h: 12, color: 0xb7d4d8, section: [[-.5,0],[-.4,.5],[-.12,.9],[.1,.85],[.35,.45],[.5,0]], rock: true },
  harborwarehouses: { label: '港灣高腳倉庫群', category: 'coastal', dom: 'water', bio: ['water'], slope: 'flat', depth: 18, h: 20, color: 0x737f80, section: shelfSection, object: 'factory', rows: 1, pitch: 13, foundation: true },
});
export const SLOPE_BOUNDARIES = Object.freeze({
  citywall: { fillContact: true, color: 0x989789, section: [[-.48, 0], [-.42, .82], [-.48, .82], [-.48, 1], [.48, 1], [.48, .82], [.42, .82], [.48, 0]] },
  barricade: { color: 0x85918c, section: [[-.5, 0], [-.5, .22], [-.2, .58], [-.16, 1], [.16, 1], [.2, .58], [.5, .22], [.5, 0]] },
  levee: { fillContact: true, color: 0x8c9587, section: [[-.5, 0], [-.16, .9], [.16, .9], [.5, 0]] },
  seawall: { color: 0x899393, section: [[-.5, 0], [-.25, .85], [-.25, 1], [.38, 1], [.38, .85], [.5, 0]] },
  cliff: { bufferFill: true, color: 0x8c897b, rock: true, section: [[-.5, 0], [-.42, .58], [-.25, .92], [.05, 1], [.35, .86], [.5, 0]] },
  landslide: { bufferFill: true, color: 0x9f8667, rock: true, section: [[-.5, 0], [-.25, .58], [0, .88], [.25, .64], [.5, 0]] },
  debris: { bufferFill: true, color: 0x89816d, rock: true, section: [[-.5, 0], [-.24, .52], [0, .82], [.26, .45], [.5, 0]] },
  ...EXPANDED_BOUNDARIES,
});

const snap = value => Math.round(value * 1e6) / 1e6;
const linear = value => value <= .04045 ? value / 12.92 : ((value + .055) / 1.055) ** 2.4;
// World-space scales keep relief continuous across kinds, segments and corners.
const bufferRelief = (x, z) => (Math.sin(x * .16 + .7) + Math.sin(z * .16 + .7)
  + .4 * (Math.sin((x + z) * .095) + Math.cos((x - z) * .095))
  + .4 * (Math.sin(x * .31 + 1.1) + Math.sin(z * .31 + 1.1))) / 3.6;
const bufferRoof = (x, z) => .70 + bufferRelief(x, z) * .28;

// A filled boundary has no downhill back face. Its roof continues to the skirt's
// outer edge; both sides of a joint evaluate the same profile and world samples.
function buildFilledBoundary(kind, { len, depth, h, x, z, ry, heightAt, season, fill }) {
  if (!Number.isFinite(fill.depth) || fill.depth < depth || !Number.isFinite(fill.crest)
    || fill.crest <= 0 || fill.crest > depth || typeof fill.heightAt !== 'function'
    || (fill.joins != null && (!Array.isArray(fill.joins) || fill.joins.length !== 2
      || fill.joins.some(j => j && (!SLOPE_BOUNDARIES[j.kind] || !Number.isFinite(j.h) || j.h <= 0))))) return null;
  const def = SLOPE_BOUNDARIES[kind], ca = snap(Math.cos(ry)), sa = snap(Math.sin(ry));
  const joins = fill.joins || [null, null];
  const stations = [-len / 2, len / 2];
  const axis = Math.abs(ca) > .5 ? x : z, sign = Math.abs(ca) > .5 ? ca : -sa;
  for (let t = Math.ceil((axis - len / 2) / 3) * 3; t < axis + len / 2; t += 3) {
    const u = (t - axis) / sign;
    if (u > -len / 2 + 1e-6 && u < len / 2 - 1e-6) stations.push(u);
  }
  stations.sort((a, b) => a - b);
  const distances = [0, depth, fill.depth, fill.crest];
  for (let d = 2; d < fill.depth; d += 2) distances.push(d);
  const ds = [...new Set(distances)].sort((a, b) => a - b);
  const smooth = t => t * t * (3 - 2 * t);
  const profile = (k, d) => {
    const section = SLOPE_BOUNDARIES[k].section;
    const peak = Math.max(...section.map(p => p[1]));
    const front = [...section].reverse();
    const crest = front.findIndex(p => p[1] === peak);
    const width = .5 - front[crest][0];
    const q = Math.min(1, d / fill.crest);
    for (let i = 1; i <= crest; i++) {
      const a = (.5 - front[i - 1][0]) / width, b = (.5 - front[i][0]) / width;
      if (q <= b) return (front[i - 1][1] + (front[i][1] - front[i - 1][1]) * (q - a) / (b - a)) / peak;
    }
    return 1;
  };
  const world = (u, d) => {
    // Miter the two natural strips at a map corner. Their diagonal end edges
    // have identical coordinates; no overlapping roofs or unfilled square.
    let along = u;
    if (u < 0 && joins[0]?.corner) along -= d * smooth(-u * 2 / len);
    if (u > 0 && joins[1]?.corner) along += d * smooth(u * 2 / len);
    const v = depth / 2 - d;
    return [snap(x + ca * along + sa * v), snap(z - sa * along + ca * v)];
  };
  let lo = Infinity, hi = -Infinity, valid = true;
  const rows = stations.map(u => ds.map(d => {
    const end = u < 0 ? joins[0] : joins[1], blend = smooth(Math.abs(u) * 2 / len);
    const natural = end && SLOPE_BOUNDARIES[end.kind]?.bufferFill;
    const level = natural ? profile(kind, d) * (1 - blend / 2) + profile(end.kind, d) * blend / 2 : profile(kind, d);
    const height = end ? h + (Math.min(h, end.h) - h) * blend : h;
    const [wx, wz] = world(u, d), [fx, fz] = world(u, 0), [cx, cz] = world(u, fill.crest);
    const ground = fill.heightAt(wx, wz), front = heightAt(fx, fz), crest = fill.heightAt(cx, cz);
    if (![ground, front, crest].every(Number.isFinite)) valid = false;
    if (d <= depth) { lo = Math.min(lo, ground, front, crest); hi = Math.max(hi, ground, front, crest); }
    const wave = (Math.sin(wx * .081 + wz * .043) + Math.sin(wx * .027 - wz * .069)) / 2;
    const base = front + (crest - front) * Math.min(1, d / fill.crest);
    const top = Math.max(ground - .4, base + height * level * (.9 + wave * .09));
    // Ease into rolling relief behind the crest without falling back to ground.
    // Both factors stay below 1, preserving the existing collision height cap.
    const crestWave = (Math.sin(cx * .081 + cz * .043) + Math.sin(cx * .027 - cz * .069)) / 2;
    const rearBlend = smooth(Math.max(0, Math.min(1, (d - fill.crest) / (fill.crest * 2))));
    const roof = (.9 + crestWave * .09) * (1 - rearBlend)
      + bufferRoof(wx, wz) * rearBlend;
    const y = d >= fill.crest ? Math.max(ground - .4, crest + height * roof) : d === 0 ? front - .4 : top;
    const tint = ROCK_SEASON_TINT[season] || ROCK_SEASON_TINT.summer;
    const color = [16, 8, 0].map(shift => {
      let c = (def.color >> shift) & 255;
      if (natural) c = c * (1 - blend / 2) + (((SLOPE_BOUNDARIES[end.kind].color >> shift) & 255)) * blend / 2;
      return linear(c / 255 * (.9 + wave * .07) * ((tint >> shift) & 255) / 255);
    });
    return { p: [ca * (wx - x) - sa * (wz - z), y, sa * (wx - x) + ca * (wz - z)], bottom: Math.min(ground, y) - .4, color };
  }));
  if (!valid) return null;
  const parts = [], bufferParts = [];
  const split = ds.indexOf(depth);
  for (let i = 0; i < rows.length - 1; i++) for (const [from, to] of [[0, split], [split, ds.length - 1]]) {
    if (from === to) continue;
    const cells = rows[i].slice(from, to + 1).concat(rows[i + 1].slice(from, to + 1));
    const n = to - from + 1, bottom = cells.length;
    const vertices = cells.flatMap(c => c.p).concat(cells.flatMap(c => [c.p[0], c.bottom, c.p[2]]));
    const colors = [...cells, ...cells].flatMap(c => c.color), faces = [];
    for (let j = 0; j < n - 1; j++) {
      faces.push(j, j + n, j + n + 1, j, j + n + 1, j + 1);
      faces.push(j + bottom, j + n + 1 + bottom, j + n + bottom, j + bottom, j + 1 + bottom, j + n + 1 + bottom);
    }
    const rim = [...Array.from({ length: n }, (_, j) => j), ...Array.from({ length: n }, (_, j) => 2 * n - 1 - j)];
    for (let j = 0; j < rim.length; j++) {
      // Only the exterior is capped. Coincident internal caps cause dark seams
      // and depth fighting even when their roof vertices match exactly.
      if (j < n - 1 && (i > 0 || joins[0]?.corner || SLOPE_BOUNDARIES[joins[0]?.kind]?.bufferFill)) continue;
      if (j >= n && j < rim.length - 1
        && (i < rows.length - 2 || joins[1]?.corner || SLOPE_BOUNDARIES[joins[1]?.kind]?.bufferFill)) continue;
      if (j === n - 1 && to < ds.length - 1) continue;
      if (j === rim.length - 1 && from > 0) continue;
      const a = rim[j], b = rim[(j + 1) % rim.length];
      // Hard side normals must not bend the roof normals at every station.
      for (const index of [a, b, b + bottom, a, b + bottom, a + bottom]) {
        faces.push(vertices.length / 3);
        vertices.push(...vertices.slice(index * 3, index * 3 + 3));
        colors.push(...colors.slice(index * 3, index * 3 + 3));
      }
    }
    const min = [0,1,2].map(a => Math.min(...vertices.filter((_, k) => k % 3 === a)));
    const max = [0,1,2].map(a => Math.max(...vertices.filter((_, k) => k % 3 === a)));
    const center = min.map((v, a) => (v + max[a]) / 2), size = min.map((v, a) => max[a] - v);
    const buffer = ds[to] > depth || joins.some(joint => joint?.corner);
    const mesh = { vertices: vertices.map((v, k) => v - center[k % 3]), colors, faces, boundaryBuffer: buffer, surfaceVertexCount: cells.length, bottomVertexOffset: cells.length };
    (buffer ? bufferParts : parts).push({ g: ['mesh', mesh, size], p: center, c: null,
      role: buffer ? 'boundary-buffer-fill' : 'terrain-joined-boundary' });
  }
  // Masonry does not extend into the buffer. At a mixed corner, fill the other
  // half of the square too, ending exactly on the masonry's existing end plane.
  for (const end of [0, 1]) {
    const joint = joins[end];
    if (!joint?.corner || SLOPE_BOUNDARIES[joint.kind]?.bufferFill) continue;
    const edge = rows[end ? rows.length - 1 : 0], section = SLOPE_BOUNDARIES[joint.kind]?.section;
    if (!section || !Number.isFinite(joint.depth) || joint.depth <= 0) return null;
    const wall = edge.map((cell, j) => {
      const d = ds[j], p = [cell.p[0], 0, depth / 2];
      const wx = snap(x + ca * p[0] + sa * p[2]), wz = snap(z - sa * p[0] + ca * p[2]);
      const ground = fill.heightAt(wx, wz);
      if (!Number.isFinite(ground)) valid = false;
      let level = d > joint.depth ? Math.max(...section.map(s => s[1])) : 0;
      if (d > joint.depth) {
        const blend = smooth(Math.min(1, (d - joint.depth) / (fill.crest * 2)));
        level *= 1 - blend + blend * bufferRoof(wx, wz);
      }
      const v = .5 - d / joint.depth;
      for (let i = 1; i < section.length; i++) {
        const [a, ya] = section[i - 1], [b, yb] = section[i];
        if (v < Math.min(a, b) || v > Math.max(a, b)) continue;
        level = Math.max(level, a === b ? Math.max(ya, yb) : ya + (yb - ya) * (v - a) / (b - a));
      }
      p[1] = ground + (level === 0 ? -.4 : joint.h * level);
      return { p, bottom: ground - .8, color: cell.color };
    });
    if (!valid) return null;
    for (let j = 0; j < ds.length - 1; j++) {
      const cells = end ? [edge[j], wall[j], wall[j + 1], edge[j + 1]]
        : [wall[j], edge[j], edge[j + 1], wall[j + 1]];
      const points = cells.map(c => c.p).concat(cells.map(c => [c.p[0], c.bottom, c.p[2]]));
      const triangles = [0,1,2,0,2,3,4,6,5,4,7,6];
      // Only the wall contact and outer skirt need side closures; the diagonal
      // is already joined to the natural strip and must have no internal cap.
      const side = end ? [1,2] : [3,0];
      triangles.push(side[0],side[0]+4,side[1]+4,side[0],side[1]+4,side[1]);
      if (j === ds.length - 2) triangles.push(2,6,7,2,7,3);
      const vertices = triangles.flatMap(i => points[i]), colors = triangles.flatMap(i => cells[i % 4].color);
      const min = [0,1,2].map(a => Math.min(...points.map(p => p[a])));
      const max = [0,1,2].map(a => Math.max(...points.map(p => p[a])));
      const center = min.map((v, a) => (v + max[a]) / 2), size = min.map((v, a) => max[a] - v);
      const mesh = { vertices: vertices.map((v, i) => v - center[i % 3]), colors,
        faces: triangles.map((_, i) => i), boundaryBuffer: true, surfaceVertexCount: 6 };
      bufferParts.push({ g: ['mesh', mesh, size], p: center, c: null, role: 'boundary-buffer-fill' });
    }
  }
  return { lo, hi, parts, bufferParts };
}

/** Build joined masonry/embankment/rock modules, including their terrain-dependent bounds. */
export function buildSlopeBoundary(kind, { len, depth, h, x, z, ry = 0, heightAt, waterY = null, season = 'summer', seed = 1, fill = null }) {
  const def = SLOPE_BOUNDARIES[kind];
  if (!def) throw new RangeError(`Boundary cannot conform to slopes: ${kind}`);
  if (![len, depth, h, x, z, ry].every(Number.isFinite) || Math.min(len, depth, h) <= 0
    || typeof heightAt !== 'function') throw new RangeError('Invalid slope boundary inputs');
  if (def.bufferFill && fill) return buildFilledBoundary(kind, { len, depth, h, x, z, ry, heightAt, season, fill });
  const ca = snap(Math.cos(ry)), sa = snap(Math.sin(ry));
  const alongX = Math.abs(ca) > .5, axis = alongX ? x : z, sign = alongX ? ca : -sa;
  // Use world-aligned stations, not a separately rounded grid per segment.
  const stations = [-len / 2, len / 2];
  const a = axis - len / 2, b = axis + len / 2;
  for (let t = Math.ceil(a / 3) * 3; t < b; t += 3) {
    const local = (t - axis) / sign;
    if (local > -len / 2 + 1e-6 && local < len / 2 - 1e-6) stations.push(local);
  }
  stations.sort((a, b) => a - b);
  const vertices = [], colors = [], faces = [], n = def.section.length;
  let lo = Infinity, hi = -Infinity;
  for (const u of stations) for (const [dz, level] of def.section) {
    const v = dz * depth, wx = snap(x + ca * u + sa * v), wz = snap(z - sa * u + ca * v);
    const sample = heightAt(wx, wz);
    if (!Number.isFinite(sample)) return null;
    const base = waterY == null ? sample : Math.max(waterY, sample);
    lo = Math.min(lo, base); hi = Math.max(hi, base);
    const wave = (Math.sin(wx * .081 + wz * .043) + Math.sin(wx * .027 - wz * .069)) / 2;
    const relief = def.relief ? .62 + Math.cos(wx * .16 + wz * .12) * .37 : def.rock ? .9 + wave * .09 : 1;
    const rise = level * h * relief;
    vertices.push(u, base + (level === 0 ? -.4 : rise), v);
    const shade = def.rock ? .87 + wave * .1 + level * .03 : .93 + level * .05 + wave * .02;
    const tint = def.rock ? ROCK_SEASON_TINT[season] || ROCK_SEASON_TINT.summer : 0xffffff;
    for (const shift of [16, 8, 0]) colors.push(linear(((def.color >> shift) & 255) / 255 * shade * ((tint >> shift) & 255) / 255));
  }
  for (let i = 0; i < stations.length - 1; i++) for (let j = 0; j < n; j++) {
    const a = i * n + j, b = i * n + (j + 1) % n, c = b + n, d = a + n;
    faces.push(a, b, d, b, c, d);
  }
  // End caps are only closures; matching modules share the complete same end ring.
  for (let j = 1; j < n - 1; j++) {
    faces.push(0, j + 1, j);
    const end = (stations.length - 1) * n;
    faces.push(end, end + j, end + j + 1);
  }
  const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
  vertices.forEach((v, i) => { const a = i % 3; min[a] = Math.min(min[a], v); max[a] = Math.max(max[a], v); });
  const center = min.map((v, i) => (v + max[i]) / 2), size = max.map((v, i) => v - min[i]);
  const meshData = { vertices: vertices.map((v, i) => v - center[i % 3]), faces, colors };
  const parts = [{ g: ['mesh', meshData, size], p: center, c: null, role: 'terrain-joined-boundary' }];
  if (def.object || def.tanks) {
    const count = Math.max(1, Math.ceil(len / def.pitch)), slot = len / count;
    const rnd = mulberry32(seed >>> 0);
    for (let row = 0; row < def.rows; row++) for (let i = 0; i < count; i++) {
      const tree = def.object === 'gianttree';
      // Canopies overlap between rows and neighbours; trunks remain separate rigid members.
      const width = tree ? Math.min(slot * 1.8, depth * .7, len) : slot * .96;
      const thick = tree ? depth * .7 : depth / def.rows * .94;
      const u = tree ? (count === 1 ? 0 : (i / (count - 1) - .5) * (len - width)) : (i + .5) * slot - len / 2;
      const v = tree ? (def.rows === 1 ? 0 : (row / (def.rows - 1) - .5) * (depth - thick)) : (row + .5) * depth / def.rows - depth / 2;
      const samples = [];
      const supportW = width * (tree ? .25 : .5), supportD = thick * (tree ? .25 : .5);
      for (const du of [-supportW, 0, supportW]) for (const dv of [-supportD, 0, supportD]) {
        const value = heightAt(snap(x + ca * (u + du) + sa * (v + dv)), snap(z - sa * (u + du) + ca * (v + dv)));
        if (!Number.isFinite(value)) return null;
        samples.push(waterY == null ? value : Math.max(value, waterY));
      }
      const low = Math.min(...samples), high = Math.max(...samples);
      lo = Math.min(lo, low); hi = Math.max(hi, high);
      // Rigid members stay vertical on individually supported sites, rather than bending houses/trees.
      const base = high + h * .1, modelSeed = Math.floor(rnd() * 0x7fffffff);
      if (def.tanks) {
        const radius = Math.min(width, thick) * .46, height = h * (.5 + rnd() * .2);
        parts.push({ g: ['cyl', radius, radius, height, 12], p: [u, base + height / 2, v], c: 0xb3bab6, role: 'storage-tank' });
        parts.push({ g: ['cyl', radius * .96, radius, h * .04, 12], p: [u, base + height + h * .02, v], c: 0x707e81, role: 'tank-roof' });
      } else {
        const model = environmentParts(def.object, { size: [width, h * .85, thick], seed: modelSeed, season });
        parts.push(...model.map(p => ({ ...p, p: [p.p[0] + u, p.p[1] + base, p.p[2] + v] })));
      }
      // Fill the individual downhill footing; the shared earth ribbon closes between sites.
      const foot = base - low + .4;
      parts.push({ g: tree ? ['cyl', Math.min(width, thick) * .12, Math.min(width, thick) * .25, foot, 8]
        : ['box', width, foot, thick], p: [u, low - .4 + foot / 2, v],
        c: tree ? 0x66503b : def.color, role: tree ? 'root-buttress' : 'terrace-footing' });
    }
  }
  return { lo, hi, parts };
}
