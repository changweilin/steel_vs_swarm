import assert from 'node:assert/strict';
import { register } from 'node:module';
// 屋頂接縫回歸：同向共面重疊（z-fighting 色斑）與法線污染（cel 色帶）歸零。
// 手法都是「最終合批幾何量測」，不斷言實作細節，只釘結果。
const modules = {
  three: new URL('../out/forest_review/three.module.js', import.meta.url).href,
  'three/addons/utils/BufferGeometryUtils.js': new URL('../out/forest_review/utils_BufferGeometryUtils.js', import.meta.url).href,
};
register('data:text/javascript,' + encodeURIComponent(`const modules = ${JSON.stringify(modules)};
export async function resolve(s, c, next) { return modules[s] ? { url: modules[s], shortCircuit: true } : next(s, c); }`), import.meta.url);
const THREE = await import('three');
const { buildOsmPolygonBuildings, architecturalRoof } = await import('../public/js/osmBuilding.js');
const { ARCHITECTURE_STYLES } = await import('../public/js/architectureStyles.js');
const { ROOF_FACET_DEG } = await import('../public/js/architectureRoofParts.js');

const rect = (w, d) => ({ outer: [[-w / 2, -d / 2], [w / 2, -d / 2], [w / 2, d / 2], [-w / 2, d / 2]], holes: [] });
const terrain = { heightAt: () => 10 };
const style = { ...ARCHITECTURE_STYLES.alpine, id: 'alpine', profile: 'plain', variant: 0, targetHeight: 9,
  functionInfo: { type: 'townhouse', key: 'residential_townhouse', category: 'residential' } };

function trisOf(geo) {
  const pos = geo.attributes.position, idx = geo.index;
  const out = [];
  const n = idx ? idx.count : pos.count;
  for (let f = 0; f < n; f += 3) {
    const ids = idx ? [idx.getX(f), idx.getX(f + 1), idx.getX(f + 2)] : [f, f + 1, f + 2];
    const v = ids.map((i) => [pos.getX(i), pos.getY(i), pos.getZ(i)]);
    const ab = [v[1][0] - v[0][0], v[1][1] - v[0][1], v[1][2] - v[0][2]];
    const ac = [v[2][0] - v[0][0], v[2][1] - v[0][1], v[2][2] - v[0][2]];
    const cr = [ab[1] * ac[2] - ab[2] * ac[1], ab[2] * ac[0] - ab[0] * ac[2], ab[0] * ac[1] - ab[1] * ac[0]];
    const area2 = Math.hypot(...cr) / 2;
    if (area2 < 1e-9) continue;
    out.push({ v, fn: cr.map((x) => x / (area2 * 2)) });
  }
  return out;
}
const signedArea = (p) => {
  let a = 0;
  for (let i = 0; i < p.length; i++) { const q = p[(i + 1) % p.length]; a += p[i][0] * q[1] - q[0] * p[i][1]; }
  return a / 2;
};
function clipArea(subj, clip) {
  if (signedArea(clip) < 0) clip = [...clip].reverse();
  if (signedArea(subj) < 0) subj = [...subj].reverse();
  const s = (p1, p2, p3) => (p2[0] - p1[0]) * (p3[1] - p1[1]) - (p2[1] - p1[1]) * (p3[0] - p1[0]);
  const cross = (p1, p2, p3, p4) => {
    const d = (p2[0] - p1[0]) * (p4[1] - p3[1]) - (p2[1] - p1[1]) * (p4[0] - p3[0]);
    const t = Math.abs(d) < 1e-15 ? 0 : (((p3[0] - p1[0]) * (p4[1] - p3[1]) - (p3[1] - p1[1]) * (p4[0] - p3[0])) / d);
    return [p1[0] + (p2[0] - p1[0]) * t, p1[1] + (p2[1] - p1[1]) * t];
  };
  let out = subj.map(([x, z]) => [x, z]);
  for (let e = 0; e < clip.length; e++) {
    const a = clip[e], b = clip[(e + 1) % clip.length];
    const inp = out; out = [];
    if (!inp.length) break;
    let prev = inp[inp.length - 1], prevIn = s(a, b, prev) >= -1e-9;
    for (const cur of inp) {
      const curIn = s(a, b, cur) >= -1e-9;
      if (curIn) { if (!prevIn) out.push(cross(prev, cur, a, b)); out.push(cur); }
      else if (prevIn) out.push(cross(prev, cur, a, b));
      prev = cur; prevIn = curIn;
    }
  }
  let area = 0;
  for (let i = 1; i + 1 < out.length; i++) {
    area += Math.abs((out[i][0] - out[0][0]) * (out[i + 1][1] - out[0][1]) - (out[i + 1][0] - out[0][0]) * (out[i][1] - out[0][1])) / 2;
  }
  return area;
}

for (const form of ['flat', 'gable', 'mansard', 'stepped', 'tiered', 'dome', 'shed', 'xieshan']) {
  const group = new THREE.Group();
  const arch = { ...style, roofForm: form };
  buildOsmPolygonBuildings(group, [{ sourceId: 'seam/' + form, tags: { building: 'house' },
    classification: { generator: 'polygonBuilding', kind: 'house' }, worldPolygons: [rect(20, 10)] }],
    { terrain, architectureOf: () => arch });
  const bags = [];
  for (const m of group.children) {
    const name = m.userData.osmBuildingRoofBatch ? 'roofs' : m.userData.osmBuildingDetailBatch ? 'details' : 'walls';
    bags.push({ name, all: trisOf(m.geometry) });
  }
  // 牆頂封頂帶：不同批次的同向（朝上）三角形不得共面重疊。
  const ups = [];
  for (const b of bags) for (const t of b.all) {
    if (t.fn[1] > 0.999 && Math.abs(t.v[0][1] - 19) < 0.3) ups.push({ ...t, bag: b.name });
  }
  let overlap = 0;
  for (let i = 0; i < ups.length; i++) for (let j = i + 1; j < ups.length; j++) {
    const A = ups[i], B = ups[j];
    if (A.bag === B.bag) continue;
    if (Math.abs(A.v[0][1] - B.v[0][1]) > 1e-4) continue;
    overlap += clipArea(A.v.map(([x, , z]) => [x, z]), B.v.map(([x, , z]) => [x, z]));
  }
  assert(overlap < 1e-6, form + ': cross-batch coplanar roof overlap = ' + overlap.toFixed(4) + 'm2');
  for (const m of group.children) m.geometry.dispose();
}

// 屋頂網格法線污染：同三角形三頂點法線夾角不得超過群組閾值（圓頂自身環差 27° 內放行）。
for (const form of ['gable', 'mansard', 'stepped', 'tiered', 'wudian', 'xieshan', 'dome', 'vault', 'shed',
    'sawtooth', 'butterfly', 'gambrel', 'crowstep', 'steep_gable', 'curved_ridge', 'yingshan', 'xuanshan']) {
  const geos = architecturalRoof(rect(20, 10), 19, style, form, null, 9);
  assert(geos.length > 0, form + ': roof exists');
  for (const geo of geos) {
    const pos = geo.attributes.position, nor = geo.attributes.normal, idx = geo.index;
    for (let f = 0; f < idx.count; f += 3) {
      const ids = [idx.getX(f), idx.getX(f + 1), idx.getX(f + 2)];
      const ns = ids.map((i) => [nor.getX(i), nor.getY(i), nor.getZ(i)]);
      let d = 1;
      for (let a = 0; a < 3; a++) for (let c = a + 1; c < 3; c++) {
        d = Math.min(d, ns[a][0] * ns[c][0] + ns[a][1] * ns[c][1] + ns[a][2] * ns[c][2]);
      }
      const spread = Math.acos(Math.min(1, Math.max(-1, d))) * 180 / Math.PI;
      assert(spread <= ROOF_FACET_DEG + 1, form + ': roof normal pollution ' + spread.toFixed(1) + 'deg');
    }
    geo.dispose();
  }
}

// 全方向跨批次共面（含窗戶立面）：同平面（1mm）不同批次的面內重疊面積歸零。
// 反向法線（上下蓋配對）本就不互見，鍵值天然分開；深度分層飾件差 3cm 起跳，不會同鍵。
// 朝下面（地平面底面）略過：可玩視角永遠在地面之上，底面只進陰影圖且其後無接收者。
function planeBasis(fn) {
  const ax = Math.abs(fn[0]) >= Math.abs(fn[1]) && Math.abs(fn[0]) >= Math.abs(fn[2]) ? 0
    : Math.abs(fn[1]) >= Math.abs(fn[2]) ? 1 : 2;
  const keep = [0, 1, 2].filter((a) => a !== ax);
  return (v) => [v[keep[0]], v[keep[1]]];
}
for (const [styleId, form, h] of [['alpine', 'gable', 9], ['deco', 'stepped', 12], ['modern', 'flat', 14]]) {
  const group = new THREE.Group();
  const arch = { ...ARCHITECTURE_STYLES[styleId], id: styleId, profile: 'plain', variant: 0, targetHeight: h,
    functionInfo: { type: 'townhouse', key: 'residential_townhouse', category: 'residential' }, roofForm: form };
  buildOsmPolygonBuildings(group, [{ sourceId: 'seam/all/' + styleId, tags: { building: 'house' },
    classification: { generator: 'polygonBuilding', kind: 'house' }, worldPolygons: [rect(20, 10)] }],
    { terrain, architectureOf: () => arch });
  const buckets = new Map();
  for (const m of group.children) {
    const bag = m.userData.osmBuildingRoofBatch ? 'roofs' : m.userData.osmBuildingDetailBatch ? 'details' : 'walls';
    for (const t of trisOf(m.geometry)) {
      const d = -(t.fn[0] * t.v[0][0] + t.fn[1] * t.v[0][1] + t.fn[2] * t.v[0][2]);
      const key = t.fn.map((x) => Math.round(x * 1000)).join(',') + '|' + Math.round(d * 1000);
      if (!buckets.has(key)) buckets.set(key, { fn: t.fn, items: [] });
      buckets.get(key).items.push({ ...t, bag });
    }
  }
  let overlap = 0, worst = '';
  for (const { fn, items } of buckets.values()) {
    if (items.length < 2 || fn[1] < -0.999) continue;
    const proj = planeBasis(fn);
    for (let i = 0; i < items.length; i++) for (let j = i + 1; j < items.length; j++) {
      const A = items[i], B = items[j];
      if (A.bag === B.bag) continue;
      const a = clipArea(A.v.map(proj), B.v.map(proj));
      if (a > 1e-6) { overlap += a; worst = `${A.bag}/${B.bag} n=[${fn.map((x) => x.toFixed(2))}] area=${a.toFixed(4)}`; }
    }
  }
  assert(overlap < 1e-6, `${styleId}/${form}: cross-batch coplanar overlap = ${overlap.toFixed(4)}m2 (${worst})`);
  for (const m of group.children) m.geometry.dispose();
}

console.log('PASS: no coplanar seams in any orientation, windows included');

// 坡地貼地：正門底部＝落點地形高（不埋入坡面；高腳／擋土戶取 max 維持原值）。
{
  const slopeTerrain = { heightAt: (x) => 10 + x * 0.2, minX: -100, maxX: 100, minZ: -100, maxZ: 100 };
  const group = new THREE.Group();
  const arch = { ...ARCHITECTURE_STYLES.alpine, id: 'alpine', profile: 'plain', variant: 0, targetHeight: 9,
    functionInfo: { type: 'townhouse', key: 'residential_townhouse', category: 'residential' }, roofForm: 'gable' };
  buildOsmPolygonBuildings(group, [{ sourceId: 'seam/slope', tags: { building: 'house' },
    classification: { generator: 'polygonBuilding', kind: 'house' }, worldPolygons: [rect(20, 10)] }],
    { terrain: slopeTerrain, architectureOf: () => arch });
  const { doorFinish } = await import('../public/js/buildingAppurtenances.js');
  const finish = doorFinish('alpine|seam/slope|4', 'residential');
  const doorC = [finish.color].map((h) => new THREE.Color(h).multiplyScalar(0.94))[0];
  let minY = Infinity;
  const cx = [0], cz = [0];
  let n = 0;
  for (const m of group.children) {
    if (!m.userData.osmBuildingDetailBatch) continue;
    const pos = m.geometry.attributes.position, col = m.geometry.attributes.color, idx = m.geometry.index;
    for (let f = 0; f < idx.count; f += 3) {
      const ids = [idx.getX(f), idx.getX(f + 1), idx.getX(f + 2)];
      if (!ids.every((i) => Math.abs(col.getX(i) - doorC.r) < 0.01 && Math.abs(col.getY(i) - doorC.g) < 0.01 && Math.abs(col.getZ(i) - doorC.b) < 0.01)) continue;
      const v = ids.map((i) => [pos.getX(i), pos.getY(i), pos.getZ(i)]);
      const ab = [v[1][0] - v[0][0], v[1][1] - v[0][1], v[1][2] - v[0][2]];
      const ac = [v[2][0] - v[0][0], v[2][1] - v[0][1], v[2][2] - v[0][2]];
      const cr = [ab[1] * ac[2] - ab[2] * ac[1], ab[2] * ac[0] - ab[0] * ac[2], ab[0] * ac[1] - ab[1] * ac[0]];
      const l = Math.hypot(...cr);
      if (l < 1e-9 || cr[1] / l > -0.999) continue;
      for (const i of ids) {
        if (pos.getY(i) < minY) { minY = pos.getY(i); cx[0] = 0; cz[0] = 0; n = 0; }
        if (Math.abs(pos.getY(i) - minY) < 1e-6) { cx[0] += pos.getX(i); cz[0] += pos.getZ(i); n++; }
      }
    }
  }
  assert(n > 0, 'door bottom face exists');
  const gy = Math.max(8, slopeTerrain.heightAt(cx[0] / n, cz[0] / n));
  assert(Math.abs(minY - gy) < 0.05, `door bottom ${minY.toFixed(3)} follows terrain ${gy.toFixed(3)}`);
  for (const m of group.children) m.geometry.dispose();
}

console.log('PASS: ground attachments follow terrain');
