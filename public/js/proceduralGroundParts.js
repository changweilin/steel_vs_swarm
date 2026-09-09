import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { mulberry32 } from './rng.js';
import { GROUND_PARTS, PART_VARIATION, GROUND_PART_PALETTES } from './groundPartCatalog.js';

export function createGroundParts() {
  return Object.fromEntries(Object.keys(GROUND_PARTS).map(type => [type,
    Array.from({ length: PART_VARIATION.count }, (_, variant) => generateGroundPart(type, variant))]));
}

export function generateGroundPart(type, variant = 0) {
  const spec = GROUND_PARTS[type];
  if (!spec) throw new RangeError(`Unknown ground part ${type}`);
  let seed = variant ^ 0x47525054;
  for (const c of type) seed = Math.imul(seed ^ c.charCodeAt(0), 16777619);
  const rnd = mulberry32(seed), range = ([a, b]) => a + rnd() * (b - a);
  const [family, nw, nh, nd, color] = spec;
  const equipment = ['net', 'goal', 'uprights', 'netball', 'wicket', 'target'].includes(family);
  const f = equipment ? 1 : range(PART_VARIATION.size), w = nw * f, h = nh * f, d = nd * f;
  const segments = Math.floor(range(PART_VARIATION.segments));
  const parts = [];
  const add = (geo, c = color, sf = null) => { parts.push({ geo, c, sf }); };
  const box = (x, y, z, sx, sy, sz, c = color) => add(new THREE.BoxGeometry(sx, sy, sz).translate(x, y, z), c);
  const stem = (x, y, z, height, radius, c = 0x776345) => add(new THREE.CylinderGeometry(radius * .7, radius, height, segments).translate(x, y + height / 2, z), c);
  const rock = (x, y, z, sx, sy, sz, c = color, soft = null) => {
    const g = new THREE.IcosahedronGeometry(1, 0), p = g.attributes.position;
    // Coordinate-based deformation gives shared corners identical positions (no cracks).
    const phase = rnd() * 6;
    for (let i = 0; i < p.count; i++) {
      const a = p.getX(i), b = p.getY(i), c0 = p.getZ(i);
      const k = .85 + .15 * Math.sin(a * 4 + b * 3 + c0 * 5 + phase);
      p.setXYZ(i, x + a * sx * k / 2, y + b * sy * k / 2, z + c0 * sz * k / 2);
    }
    g.computeVertexNormals(); add(g, c, soft);
  };
  const legs = (top, c = 0x707a79) => {
    for (const x of [-1, 1]) for (const z of [-1, 1]) box(x * w * .38, top / 2, z * d * .35, .09, top, .09, c);
  };
  if (family === 'picnic') {
    legs(h * .9);
    box(0, h, 0, w, .09, d * .45);
    for (const side of [-1, 1]) {
      box(0, h * .5, side * d * .4, w, .08, d * .2);
      for (const x of [-w * .34, w * .34]) box(x, h * .25, side * d * .4, .09, h * .5, .09);
    }
  } else if (family === 'tent') {
    box(0, .04, 0, w, .08, d);
    const roofLength = Math.hypot(w / 2, h), angle = Math.atan2(h, w / 2);
    for (const side of [-1, 1]) add(new THREE.BoxGeometry(roofLength, .04, d).rotateZ(-side * angle).translate(side * w / 4, h / 2, 0));
    for (const z of [-d / 2, d / 2]) stem(0, 0, z, h, .035);
  } else if (family === 'bin') {
    box(0, h / 2, 0, w, h, d);
    box(0, h, 0, w * 1.08, .07, d * 1.08, 0x404b46);
    box(0, h * .8, d * .51, w * .65, h * .13, .025, 0x303a35);
  } else if (equipment) {
    const pole = .035 + variant * .003;
    if (family === 'net') {
      // Net spans local Z, matching a court's centre line, with functional mesh only.
      for (const z of [-w / 2, w / 2]) stem(0, 0, z, h, pole);
      const bottom = Math.max(.05, h - 1);
      for (let z = -w / 2; z <= w / 2; z += .24) box(0, (h + bottom) / 2, z, .012, h - bottom, .012, 0x656d67);
      for (let y = bottom; y <= h; y += .2) box(0, y, 0, .015, .015, w, 0x656d67);
      box(0, h, 0, .035, .04, w);
    } else if (family === 'goal' || family === 'uprights') {
      for (const x of [-w / 2, w / 2]) stem(x, 0, 0, h, pole);
      box(0, family === 'goal' ? h : 3, 0, w, pole * 2, pole * 2);
      if (family === 'goal' && w > 1) {
        for (let x = -w / 2; x <= w / 2; x += .3) box(x, h / 2, -d, .015, h, .015, 0x9da49a);
        for (let y = .15; y < h; y += .3) box(0, y, -d, w, .015, .015, 0x9da49a);
        for (const x of [-w / 2, w / 2]) box(x, .04, -d / 2, pole, .08, d);
      }
    } else if (family === 'wicket') {
      for (const x of [-w / 2, 0, w / 2]) stem(x, 0, 0, h, .015 + variant * .001);
      box(0, h, 0, w, .02, .02);
    } else if (family === 'netball') {
      stem(0, 0, 0, h, pole);
      add(new THREE.TorusGeometry(.19, pole / 2, 5, 16).rotateX(Math.PI / 2).translate(0, h, .19));
    } else {
      stem(0, 0, 0, h, pole);
      for (let i = 0; i < 5; i++) add(new THREE.CylinderGeometry(w / 2 * (1 - i * .18), w / 2 * (1 - i * .18), .025, 24).rotateX(Math.PI / 2).translate(0, h * .7, i * .027), [0xe9e8df, 0x343d40, 0x4d93ad, 0xc35449, 0xe5c64a][i]);
    }
  } else if (['urn', 'fountain', 'lantern', 'stall'].includes(family)) {
    if (family === 'stall') {
      legs(h * .9); box(0, h * .35, 0, w, .15, d);
      add(new THREE.BoxGeometry(w, .12, d).rotateX(.1).translate(0, h, 0), [0xac6255, 0x658d85, 0xbb9c50][variant]);
    } else if (family === 'lantern') {
      stem(0, 0, 0, h * .75, w * .12);
      box(0, h * .75, 0, w * .65, h * .25, d * .65);
      add(new THREE.ConeGeometry(w * .7, h * .18, 4).rotateY(Math.PI / 4).translate(0, h, 0));
    } else {
      add(new THREE.CylinderGeometry(w / 2, w * .38, h * .35, 12).translate(0, h * .175, 0));
      add(new THREE.CylinderGeometry(w * .43, w * .43, .02, 12).translate(0, h * .36, 0), family === 'fountain' ? 0x639ca5 : 0x71604d);
      stem(0, h * .35, 0, h * .65, w * .07);
      if (family === 'fountain') add(new THREE.SphereGeometry(w * .17, 8, 5).translate(0, h, 0));
    }
  } else if (family === 'blade' || family === 'flower') {
    const n = Math.floor(range(PART_VARIATION.blades));
    for (let i = 0; i < n; i++) {
      const ht = h * (.55 + rnd() * .45), angle = rnd() * Math.PI * 2;
      const lean = (rnd() - .5) * .55;
      const transform = new THREE.Matrix4().makeRotationY(angle).multiply(new THREE.Matrix4().makeRotationZ(lean));
      transform.setPosition((rnd() - .5) * w * .6, 0, (rnd() - .5) * d * .6);
      const g = new THREE.ConeGeometry(w * .09, ht, 3).translate(0, ht / 2, 0).applyMatrix4(transform);
      add(g, family === 'flower' ? 'grass' : color, 'grass');
      if (family === 'flower') {
        const tip = new THREE.Vector3(0, ht, 0).applyMatrix4(transform);
        rock(tip.x, tip.y, tip.z, w * .6, .1, d * .6, color, 'grass');
      }
    }
  } else if (['crown', 'tree', 'snag'].includes(family)) {
    if (family !== 'crown') stem(0, 0, 0, h * .85, w * .08);
    const n = Math.floor(range(PART_VARIATION.branches));
    for (let i = 0; i < n; i++) {
      const a = i * Math.PI * 2 / n, x = Math.cos(a) * w * .22, z = Math.sin(a) * d * .22;
      if (family === 'snag') add(new THREE.CylinderGeometry(.025, .06, h * .4, 5).translate(0, h * .2, 0).rotateZ(.8).rotateY(a).translate(0, h * (.35 + rnd() * .25), 0));
      else rock(x, h * (family === 'tree' ? .72 : .5), z, w * .65, h * .6, d * .65, color, 'leaf');
    }
  } else if (family === 'rock') {
    rock(0, h * .4, 0, w, h, d);
    for (let i = 0; i < 2 + variant; i++) rock((rnd() - .5) * w * .6, h * .17, (rnd() - .5) * d * .6, w * .45, h * .5, d * .45);
  } else if (['log', 'logs', 'pipe'].includes(family)) {
    const n = family === 'logs' ? 3 + variant : 1;
    for (let i = 0; i < n; i++) {
      const rad = h * (n > 1 ? .23 : .5), y = rad + Math.floor(i / 2) * rad * 1.6, z = n > 1 ? (i % 2 - .5) * rad * 2 : 0;
      const length = w * (.9 + rnd() * .1);
      add(new THREE.CylinderGeometry(rad * .88, rad, length, segments, 1, family === 'pipe').rotateZ(Math.PI / 2).translate(0, y, z));
      if (family !== 'pipe') add(new THREE.CylinderGeometry(rad * .8, rad * .8, .015, segments).rotateZ(Math.PI / 2).translate(length / 2, y, z), 0xccb284);
    }
  } else if (['stump', 'post', 'drum'].includes(family)) {
    stem(0, 0, 0, h, w / 2, color);
    if (family === 'drum') for (const y of [h * .12, h * .88]) add(new THREE.TorusGeometry(w / 2, .025, 4, segments).rotateX(Math.PI / 2).translate(0, y, 0), 0x637074);
  } else if (family === 'hoop') {
    stem(0, 0, -d * .35, h * .86, .09, 0x707f83);
    box(0, h * .82, 0, w, h * .23, .08);
    box(0, h * .74, -d * .18, .1, .1, d * .45, 0x707f83);
    add(new THREE.TorusGeometry(.23, .025, 4, 12).rotateX(Math.PI / 2).translate(0, h * .7, .27), 0xda7743);
  } else if (['bench', 'solar', 'canopy', 'trellis', 'sign'].includes(family)) {
    const top = h * (family === 'bench' ? .48 : family === 'sign' ? .6 : .87);
    legs(top);
    if (family === 'bench') {
      for (let i = 0; i < 3 + variant; i++) box(0, top, -d * .35 + i * d * .7 / (2 + variant), w, .06, d / (4 + variant));
      box(0, h * .8, -d * .4, w, h * .3, .07);
    } else if (family === 'sign') box(0, h * .77, 0, w, h * .43, d);
    else if (family === 'trellis') {
      for (let i = 0; i < 4; i++) rock((i / 3 - .5) * w * .8, top * .85, 0, w * .32, h * .4, d, color, 'leaf');
    } else {
      add(new THREE.BoxGeometry(w, .1, d).rotateX(family === 'solar' ? -.32 : 0).translate(0, top, 0));
      if (family === 'solar') for (let i = 1; i < 5; i++) box((i / 5 - .5) * w, top + .09, 0, .012, .018, d * .9, 0xb3c9cc);
      if (family === 'canopy') for (const side of [-1, 1]) {
        for (const part of generateGroundPart('pump', variant)) {
          add(part.geo.translate(side * w * .25, 0, 0),
            part.c === 'palette' ? GROUND_PART_PALETTES.pump[variant % GROUND_PART_PALETTES.pump.length] : part.c);
        }
      }
    }
  } else if (['hut', 'crate', 'container', 'pump', 'car', 'stone', 'planter'].includes(family)) {
    const bh = h * (family === 'car' ? .45 : family === 'planter' ? .45 : .9);
    box(0, bh / 2, 0, w, bh, d);
    if (family === 'hut') {
      for (const side of [-1, 1]) add(new THREE.BoxGeometry(w * .59, .1, d * 1.08).rotateZ(side * .36).translate(-side * w * .26, bh, 0), 0x66594b);
    } else if (family === 'car') {
      box(0, h * .65, 0, w * .5, h * .4, d * .9, 0x5b6a70);
      for (const x of [-1, 1]) for (const z of [-1, 1]) add(new THREE.CylinderGeometry(h * .2, h * .2, .16, 7).rotateX(Math.PI / 2).translate(x * w * .3, h * .22, z * d * .5), 0x424844);
    } else if (family === 'planter') rock(0, h * .73, 0, w, h * .6, d, 'foliage', 'leaf');
    else if (family === 'pump') box(0, bh * .7, d * .51, w * .6, h * .18, .025, 0x364b50);
    else if (family === 'container' || family === 'crate') {
      const n = family === 'container' ? 14 + variant * 2 : 3 + variant;
      for (let i = 0; i < n; i++) for (const side of [-1, 1]) box((i / (n - 1) - .5) * w * .95, bh / 2, side * d * .505, .025, bh, .035, 0xa3a095);
    }
  } else if (family === 'leaf' || family === 'shell') {
    add(new THREE.SphereGeometry(1, segments, 4, 0, Math.PI * 1.85, 0, Math.PI / 2).scale(w / 2, h, d / 2));
  } else if (family === 'fish') {
    rock(0, 0, 0, w * .8, h, d);
    add(new THREE.ConeGeometry(d / 2, w * .3, 3).rotateZ(Math.PI / 2).translate(-w * .42, 0, 0));
  } else if (family === 'mushroom') {
    stem(0, 0, 0, h * .7, w * .1, 0xd9cbaa);
    add(new THREE.SphereGeometry(1, segments, 4, 0, Math.PI * 2, 0, Math.PI / 2).scale(w / 2, h * .4, d / 2).translate(0, h * .65, 0));
  } else throw new RangeError(`Unimplemented ground part family ${family}`);
  // Merge by coating/softness, keeping draw calls bounded independently of branch counts.
  const buckets = new Map();
  for (const p of parts) {
    const key = `${p.c}/${p.sf}`;
    if (!buckets.has(key)) buckets.set(key, []);
    buckets.get(key).push(p);
  }
  return [...buckets.values()].map(list => {
    const geometries = list.map(p => p.geo.index ? p.geo.toNonIndexed() : p.geo);
    const geo = mergeGeometries(geometries);
    for (const g of new Set([...geometries, ...list.map(p => p.geo)])) g.dispose();
    return { geo, c: list[0].c, sf: list[0].sf };
  });
}
