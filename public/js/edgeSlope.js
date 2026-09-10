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
  citywall: { color: 0x989789, section: [[-.48, 0], [-.42, .82], [-.48, .82], [-.48, 1], [.48, 1], [.48, .82], [.42, .82], [.48, 0]] },
  barricade: { color: 0x85918c, section: [[-.5, 0], [-.5, .22], [-.2, .58], [-.16, 1], [.16, 1], [.2, .58], [.5, .22], [.5, 0]] },
  levee: { color: 0x8c9587, section: [[-.5, 0], [-.16, .9], [.16, .9], [.5, 0]] },
  seawall: { color: 0x899393, section: [[-.5, 0], [-.25, .85], [-.25, 1], [.38, 1], [.38, .85], [.5, 0]] },
  cliff: { color: 0x8c897b, rock: true, section: [[-.5, 0], [-.42, .58], [-.25, .92], [.05, 1], [.35, .86], [.5, 0]] },
  landslide: { color: 0x9f8667, rock: true, section: [[-.5, 0], [-.25, .58], [0, .88], [.25, .64], [.5, 0]] },
  debris: { color: 0x89816d, rock: true, section: [[-.5, 0], [-.24, .52], [0, .82], [.26, .45], [.5, 0]] },
  ...EXPANDED_BOUNDARIES,
});

const snap = value => Math.round(value * 1e6) / 1e6;
const linear = value => value <= .04045 ? value / 12.92 : ((value + .055) / 1.055) ** 2.4;

/** Build joined masonry/embankment/rock modules, including their terrain-dependent bounds. */
export function buildSlopeBoundary(kind, { len, depth, h, x, z, ry = 0, heightAt, waterY = null, season = 'summer', seed = 1 }) {
  const def = SLOPE_BOUNDARIES[kind];
  if (!def) throw new RangeError(`Boundary cannot conform to slopes: ${kind}`);
  if (![len, depth, h, x, z, ry].every(Number.isFinite) || Math.min(len, depth, h) <= 0
    || typeof heightAt !== 'function') throw new RangeError('Invalid slope boundary inputs');
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
