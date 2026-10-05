import * as THREE from 'three';
import { buildRoads, makeDeckIndex, makeTunnelIndex, makeLevelCrossing, buildBaseWaterPads,
  underpassPlan, tunFloorAt, tunnelCoverIntervals, densify, BASE_PAD_R, BASE_PAD_T } from '../../public/js/biomes.js';
import { xzToLL, llToXZ, MAPGEO, selfCollider, PUSH_EPS } from '../../public/js/data.js';
import { mulberry32 } from '../../public/js/rng.js';
import { disposeTree } from '../../public/js/toon.js';
import { structureLayer, platformApproaches } from '../../public/js/roadStructures.js';

const center = { lat: 25, lng: 121, rot: 0 };
const way = (points, tags) => ({ tags: { highway: 'primary', lanes: '2', ...tags }, geometry: points.map(([x, z]) => {
  const [lat, lon] = xzToLL(x, z, center); return { lat, lon };
}) });
const arc = points => { const cum = [0]; for (let i = 1; i < points.length; i++) cum.push(cum.at(-1) + Math.hypot(points[i][0] - points[i - 1][0], points[i][1] - points[i - 1][1])); return cum; };
const models = [], report = [], images = [], textures = {};
const straight = Array.from({ length: 25 }, (_, i) => [i * 12 - 144, 0]);
const ring = Array.from({ length: 33 }, (_, i) => [Math.cos(i / 32 * Math.PI * 2) * 39, Math.sin(i / 32 * Math.PI * 2) * 39]);
const cases = [
  { key: 'bridge', label: 'Bridge · valley span', height: x => 20 - 18 * Math.exp(-((x / 65) ** 2)), roads: [way(straight, { bridge: 'yes' })] },
  { key: 'viaduct', label: 'Viaduct · uneven ground', height: x => 9 + .025 * x + Math.sin(x / 40) * 1.2, roads: [way(straight, { bridge: 'yes' })] },
  { key: 'tunnel', label: 'Mountain tunnel · continuous portals', height: x => 8 + 25 * Math.exp(-((x / 67) ** 4)), roads: [way(straight, { tunnel: 'yes' })], bore: straight },
  { key: 'underpass', label: 'Underpass · graded approaches', height: () => 20, roads: [way([[-45, 0], [45, 0]], { tunnel: 'yes' })], bore: [[-45, 0], [45, 0]], under: true },
  { key: 'gallery', label: 'Open tunnel · rock-side wall and columns', height: (_x, z) => 12 - z * .9, roads: [way(straight, { tunnel: 'avalanche_protector' })], bore: straight, gallery: true },
  { key: 'culvert', label: 'Road culvert · open box barrel', height: () => 15, roads: [way([[-24, 0], [24, 0]], { highway: 'service', tunnel: 'culvert' })], bore: [[-24, 0], [24, 0]], under: true },
  { key: 'interchange', label: 'Interchange · two decks and connected slip road', height: () => 8, roads: [
    way([[-180, 0], [0, 0], [180, 0]], { bridge: 'yes', layer: '1' }),
    way([[0, -180], [0, 0], [0, 180]], { bridge: 'yes', layer: '2' }),
    way([[0, 0], [40, 65], [150, 130]], { bridge: 'yes', layer: '1', highway: 'motorway_link', oneway: 'yes', lanes: '1' }),
  ] },
  { key: 'roundabout', label: 'Roundabout · fitted island and open approaches', height: x => 8 + .025 * x, roads: [
    way(ring, { highway: 'secondary', junction: 'roundabout' }),
    way([[39, 0], [105, 0]], { highway: 'secondary' }), way([[-39, 0], [-105, 0]], { highway: 'secondary' }),
  ] },
  { key: 'crossing', label: 'Level crossing · raised gate and flush roadway', height: () => 8, roads: [way([[-75, 0], [75, 0]], { highway: 'secondary' })], crossing: true },
  { key: 'military-platform', label: 'Military platform · graded access, cut and fill', height: (x, z) => 60 + x * .14 + z * .08,
    roads: [way([[-240, 0], [240, 0]], { highway: 'secondary' })], platform: true },
];

function exportParts(root, prefix) {
  root.updateMatrixWorld(true);
  const parts = [], replacements = new Map();
  root.traverse(node => {
    if (!node.isMesh || node.userData.isOutline) return;
    const material = node.material;
    if (Array.isArray(material)) throw Error('Unexpected material array');
    if (!replacements.has(material)) replacements.set(material, new THREE.MeshStandardMaterial({
      color: material.color, roughness: .8, side: THREE.DoubleSide, vertexColors: material.vertexColors,
      map: material.map, emissive: material.emissive, emissiveIntensity: material.emissiveIntensity,
      polygonOffset: material.polygonOffset, polygonOffsetFactor: material.polygonOffsetFactor, polygonOffsetUnits: material.polygonOffsetUnits,
      transparent: material.transparent, alphaTest: material.alphaTest,
    }));
    node.material = replacements.get(material);
    const canvas = material.map?.image, texture = canvas?.toDataURL ? `${prefix}-${material.id}` : null;
    if (texture && !textures[texture]) textures[texture] = canvas.toDataURL('image/png');
    const count = node.isInstancedMesh ? node.count : 1;
    for (let i = 0; i < count; i++) {
      const m = new THREE.Matrix4();
      if (node.isInstancedMesh) { node.getMatrixAt(i, m); m.premultiply(node.matrixWorld); }
      else m.copy(node.matrixWorld);
      const geo = node.geometry.clone().applyMatrix4(m);
      parts.push({ vertices: Array.from(geo.attributes.position.array),
        faces: geo.index ? Array.from(geo.index.array) : Array.from({ length: geo.attributes.position.count }, (_, i) => i),
        colors: material.vertexColors && geo.attributes.color ? Array.from(geo.attributes.color.array) : null,
        color: material.color.toArray(), texture, uvs: texture && geo.attributes.uv ? Array.from(geo.attributes.uv.array) : null });
      geo.dispose();
    }
  });
  for (const mat of replacements.keys()) mat.dispose();
  return parts;
}

function reviewGround(terrain, fixture, bounds, tunnels) {
  const minX = bounds.min.x - 16, maxX = bounds.max.x + 16;
  const minZ = Math.min(bounds.min.z - 16, -36), maxZ = Math.max(bounds.max.z + 16, 36);
  const nx = Math.ceil((maxX - minX) / 4), nz = Math.ceil((maxZ - minZ) / 4), vertices = [], faces = [];
  for (let i = 0; i <= nz; i++) for (let j = 0; j <= nx; j++) {
    const x = minX + (maxX - minX) * j / nx, z = minZ + (maxZ - minZ) * i / nz;
    vertices.push(x, terrain.heightAt(x, z) - .025, z);
  }
  for (let i = 0; i < nz; i++) for (let j = 0; j < nx; j++) {
    // Sectioned ground exposes the production barrel without modifying any road members.
    if (fixture.bore && minZ + (maxZ - minZ) * (i + .5) / nz > -.5) continue;
    const x = minX + (maxX - minX) * (j + .5) / nx, z = minZ + (maxZ - minZ) * (i + .5) / nz;
    if (tunnels.some(s => {
      if (s.open) return false;
      const dx = s.x2 - s.x1, dz = s.z2 - s.z1;
      const t = Math.max(0, Math.min(1, ((x - s.x1) * dx + (z - s.z1) * dz) / (dx * dx + dz * dz || 1)));
      return Math.hypot(x - s.x1 - dx * t, z - s.z1 - dz * t) < s.hw + 4;
    })) continue;
    const a = i * (nx + 1) + j, b = a + 1, c = a + nx + 1, d = c + 1;
    faces.push(a, c, b, b, c, d);
  }
  const color = new THREE.Color(fixture.bore ? 0x899781 : 0x83996f);
  return { vertices, faces, color: color.toArray(), colors: null, texture: null, uvs: null };
}

try {
  const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
  renderer.setSize(1100, 700); renderer.setClearColor(0xdde4de);
  for (const fixture of cases) {
    const root = new THREE.Group(), terrain = { minX: -350, maxX: 350, minZ: -350, maxZ: 350,
      worldW: 700, worldH: 700, heightAt: fixture.height, natureAt: fixture.height,
      sampleColor: () => [110, 110, 110], envCodeAt: () => 0, waterY: null,
      punchPortalHoles: () => ({ rims: [], touched: [] }) };
    if (fixture.platform) {
      const N = 351, heights = new Float32Array(N * N);
      for (let i = 0; i < N; i++) for (let j = 0; j < N; j++) heights[i * N + j] = fixture.height(j * 2 - 350, i * 2 - 350);
      const hf = window.__platformFixture({ ...terrain, N, heights });
      const pad = { cx: 0, cz: 0, hw: BASE_PAD_R, hd: BASE_PAD_R, y: fixture.height(0, 0) + window.__roadLift, padT: BASE_PAD_T, margin: 2.2 };
      const lanes = [densify([[-240, 0], [240, 0]], 6)];
      pad.approaches = platformApproaches(pad, lanes, hf.heightAt, {
        grade: Math.tan(MAPGEO.MAX_ROAD_GRADE_DEG * Math.PI / 180), lift: window.__roadLift });
      if (pad.approaches.length !== 2) throw Error('Platform approaches are incomplete');
      hf.carve([pad]); terrain.heightAt = hf.heightAt;
    }
    let run = null;
    if (fixture.bore) {
      if (fixture.under) run = underpassPlan(fixture.bore, fixture.roads[0].tags, fixture.height, { ...terrain, hw: 8 });
      else {
        const points = densify(fixture.bore, 6), cum = arc(points), total = cum.at(-1);
        const hA = fixture.height(...points[0]), hB = fixture.height(...points.at(-1));
        const floors = cum.map(s => hA + (hB - hA) * s / total);
        const intervals = fixture.gallery ? [[0, total, 0, points.length - 1]] : tunnelCoverIntervals(points, cum, floors, fixture.height);
        run = { pts: points, cum, hA, hB, intervals };
      }
      if (!run || !run.intervals.length) throw Error(`${fixture.key}: no covered barrel`);
      fixture.roads[0]._tun = [run];
      const floors = run.cum.map(s => tunFloorAt(run, s, run.cum.at(-1)));
      const bounds = [0, ...run.intervals.flatMap(([, , ia, ib]) => [ia, ib]), run.pts.length - 1];
      const carveRuns = [];
      for (let k = 0; k + 1 < bounds.length; k += 2) {
        const a = bounds[k], b = bounds[k + 1];
        if (b - a < 1) continue;
        carveRuns.push({ pts: run.pts.slice(a, b + 1), floors: floors.slice(a, b + 1),
          covA: k > 0, covB: k + 2 < bounds.length, hw: 8, cut: !!run.sink });
      }
      const N = 351, heights = new Float32Array(N * N);
      for (let i = 0; i < N; i++) for (let j = 0; j < N; j++) heights[i * N + j] = fixture.height(j * 2 - 350, i * 2 - 350);
      terrain.heightAt = window.__carveRoadFixture({ ...terrain, N, heights }, carveRuns);
    }
    const result = fixture.roads.length ? buildRoads(root, fixture.roads, terrain, center, null, mulberry32(781), 'summer')
      : { decks: [], tunnels: [], cols: [], gradeRejected: 0 };
    if (result.gradeRejected) throw Error(`${fixture.key}: rejected ${result.gradeRejected} bridge profiles`);
    if (fixture.crossing) root.add(makeLevelCrossing(0, 8, 0, 0, 1));
    if (fixture.platform) buildBaseWaterPads(root, [{ x: 0, z: 0, side: 'STEEL', roadY: fixture.height(0, 0) + window.__roadLift }],
      terrain, result.decks, result.cols, [[[-240, 0], [240, 0]]]);
    const deckY = makeDeckIndex(result.decks), tunnelAt = makeTunnelIndex(result.tunnels);
    const keys = ['terrain', 'deckY', 'tunnelAt', 'blockerTop', 'roofPlatformAt', 'DECK_STEP', 'DECK_MARGIN', 'DECK_UNDER', 'MAX_MECH_H', 'BLK_MARGIN'];
    const surface = new Function(...keys, `return (x,z,curY) => ${window.__roadSurfaceBlock};`)(
      terrain, deckY, tunnelAt, () => null, () => null, ...window.__roadSurfaceConstants);
    terrain.surfaceAt = surface; terrain.deckY = deckY; terrain.blockers = result.cols;
    const Collision = new Function('selfCollider', 'PUSH_EPS', `return class { ${window.__roadCollisionSource} };`)(selfCollider, PUSH_EPS);
    const probe = new Collision();
    Object.assign(probe, { terrain, selfH: window.__roadSurfaceConstants[3], vel: { x: 0, z: 0 },
      _flying: () => false, _unitSolids: () => [], _surf: surface });
    let steps = 0, maxStep = 0;
    const routes = run ? [run.pts] : fixture.roads.map(w =>
      w.geometry.map(p => llToXZ(p.lat, p.lon, center)));
    // Probe the production standing query in both directions at sub-step spacing.
    for (let routeIndex = 0; routeIndex < routes.length; routeIndex++) for (const reversed of [false, true]) {
      const points = routes[routeIndex], road = fixture.roads[routeIndex];
      const pts = reversed ? points.slice().reverse() : points;
      let y = run ? tunFloorAt(run, reversed ? arc(points).at(-1) : 0, arc(points).at(-1)) + window.__roadLift
        : road.tags.bridge ? deckY(...pts[0], 0, -Infinity,
          fixture.height(...pts[0]) + window.__roadLift + window.__bridgeRise * Math.max(1, structureLayer(road.tags)) + .01)
        : fixture.height(...pts[0]);
      let prevX = pts[0][0], prevZ = pts[0][1];
      for (let i = 1; i < pts.length; i++) {
        const a = pts[i - 1], b = pts[i], count = Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) / .35);
        for (let k = 1; k <= count; k++) {
          const x = a[0] + (b[0] - a[0]) * k / count, z = a[1] + (b[1] - a[1]) * k / count;
          const next = surface(x, z, y);
          if (!Number.isFinite(next)) throw Error(`${fixture.key}: non-finite standing surface`);
          maxStep = Math.max(maxStep, Math.abs(next - y));
          if (Math.abs(next - y) > window.__roadSurfaceConstants[0]) throw Error(`${fixture.key}: route ${routeIndex} at ${x},${z}: discontinuous walk ${next - y}`);
          probe.pos = { x, y: next, z }; probe._collide(prevX, prevZ);
          if (Math.hypot(probe.pos.x - x, probe.pos.z - z) > 1e-5) throw Error(`${fixture.key}: route ${routeIndex} blocked at ${x},${z}`);
          prevX = x; prevZ = z;
          y = next; steps++;
        }
      }
    }
    const bounds = new THREE.Box3().setFromObject(root);
    const parts = exportParts(root, fixture.key), groundPart = reviewGround(terrain, fixture, bounds, result.tunnels);
    const covered = result.tunnels.find(t => !t.open);
    models.push({ key: fixture.key, label: fixture.label, parts, ground: groundPart, sectioned: !!fixture.bore,
      inspection: covered ? { x: covered.x1, z: covered.z1, y: covered.fy1,
        dx: covered.x2 - covered.x1, dz: covered.z2 - covered.z1 } : null });
    const scene = new THREE.Scene(); scene.add(root);
    scene.add(new THREE.HemisphereLight(0xffffff, 0x627c6e, 2.1));
    const light = new THREE.DirectionalLight(0xfff3d6, 2.6); light.position.set(-80, 160, 100); scene.add(light);
    const size = bounds.getSize(new THREE.Vector3());
    const target = bounds.getCenter(new THREE.Vector3()), span = Math.max(size.x, size.z, 40);
    const camera = new THREE.PerspectiveCamera(33, 1100 / 700, .1, 3000);
    camera.position.copy(target).add(new THREE.Vector3(-.85, .75, 1.15).normalize().multiplyScalar(span * 1.75)); camera.lookAt(target);
    const groundGeo = new THREE.BufferGeometry();
    groundGeo.setAttribute('position', new THREE.Float32BufferAttribute(groundPart.vertices, 3));
    groundGeo.setIndex(groundPart.faces); groundGeo.computeVertexNormals();
    const ground = new THREE.Mesh(groundGeo, new THREE.MeshStandardMaterial({ color: new THREE.Color(...groundPart.color), roughness: .9, side: THREE.DoubleSide }));
    scene.add(ground);
    renderer.render(scene, camera);
    const src = renderer.domElement.toDataURL('image/png'); images.push({ key: fixture.key, src });
    const card = document.createElement('div'); card.className = 'card';
    const image = new Image(); image.src = src;
    const label = document.createElement('div'); label.className = 'label'; label.textContent = fixture.label;
    card.append(image, label); document.getElementById('grid').append(card);
    report.push({ key: fixture.key, steps, maxStep, decks: result.decks.length, tunnels: result.tunnels.length,
      colliders: result.cols.length, triangles: parts.reduce((n, p) => n + p.faces.length / 3, 0) });
    disposeTree(root); ground.geometry.dispose(); ground.material.dispose();
  }
  renderer.dispose(); renderer.forceContextLoss();
  window.__roadReview = { models, report, images, textures };
} catch (error) { window.__roadReview = { error: error.stack }; }
