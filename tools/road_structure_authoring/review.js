import * as THREE from 'three';
import { buildRoads, makeDeckIndex, makeTunnelIndex, makeLevelCrossing, buildBaseWaterPads,
  underpassPlan, tunFloorAt, tunnelCoverIntervals, densify, BASE_PAD_R, BASE_PAD_T } from '../../public/js/biomes.js';
import { xzToLL, llToXZ, MAPGEO, selfCollider, PUSH_EPS } from '../../public/js/data.js';
import { mulberry32 } from '../../public/js/rng.js';
import { disposeTree } from '../../public/js/toon.js';
import { structureLayer, platformApproaches } from '../../public/js/roadStructures.js';
import { buildWorldSigns } from '../../public/js/biomes.js';
import { SignSheet, applySignGlow } from '../../public/js/worldtext.js';
import { trafficSignStyle } from '../../public/js/roadSigns.js';
import { planLaneGuidance } from '../../public/js/laneGuidancePlan.js';
import { buildLaneGuidance, laneGuidePlates } from '../../public/js/laneGuidance.js';

const center = { lat: 25, lng: 121, rot: 0 };
const way = (points, tags) => ({ tags: { highway: 'primary', lanes: '2', ...tags }, geometry: points.map(([x, z]) => {
  const [lat, lon] = xzToLL(x, z, center); return { lat, lon };
}) });
const arc = points => { const cum = [0]; for (let i = 1; i < points.length; i++) cum.push(cum.at(-1) + Math.hypot(points[i][0] - points[i - 1][0], points[i][1] - points[i - 1][1])); return cum; };
const models = [], report = [], images = [], textures = {};
const straight = Array.from({ length: 25 }, (_, i) => [i * 12 - 144, 0]);
const ring = Array.from({ length: 33 }, (_, i) => [Math.cos(i / 32 * Math.PI * 2) * 39, Math.sin(i / 32 * Math.PI * 2) * 39]);
const cases = [
  { key: 'lane-guidance', label: 'Lane route and ordinary side road · fixed roadside furniture', height: () => 8,
    roads: [way([[-80, 0], [80, 0]], { name: '中山北路' }), way([[0, 0], [0, 45]], { highway: 'residential' })],
    signs: true, guidance: [[-80, 0], [80, 0]] },
  { key: 'lane-turn', label: 'Lane bend · approach-facing signs and LED arrows', height: () => 8,
    roads: [way([[-65, 0], [0, 0], [0, -65]], { name: '中山北路' })], signs: true,
    guidance: [[-65, 0], [0, 0], [0, -65]], close: true },
  { key: 'lane-night', label: 'Night · route legend remains readable between LED phases', height: () => 8,
    roads: [way([[-80, 0], [80, 0]], { name: '中山北路' })], signs: true,
    guidance: [[-80, 0], [80, 0]], night: true, close: true },
  { key: 'narrowing', label: 'Six lanes to service road · continuous taper', height: () => 8, roads: [
    way([[-100, 0], [0, 0]], { lanes: '6', name: '中山北路', maxspeed: '50' }),
    way([[0, 0], [100, 0]], { highway: 'service', lanes: '1', name: '中山北路', maxspeed: '30' }),
  ], signs: true },
  { key: 't-junction', label: 'T junction · wide arterial and narrow side street', height: () => 8, roads: [
    way([[-85, 0], [0, 0], [85, 0]], { lanes: '4', name: '中山北路', maxspeed: '50' }),
    way([[0, 0], [0, 75]], { highway: 'residential', name: '長安東路', lanes: '1' }),
  ], signs: true },
  { key: 'cross-junction', label: 'Four arms · separate widths and open crossing core', height: () => 8, roads: [
    way([[-75, 0], [0, 0], [75, 0]], { lanes: '4' }),
    way([[0, -75], [0, 0], [0, 75]], { highway: 'residential', lanes: '2' }),
  ] },
  { key: 'y-junction', label: 'Y junction · unequal arms and curved throats', height: () => 8, roads: [
    way([[0, 0], [85, 0]], { lanes: '4' }),
    way([[0, 0], [-45, 78]], { highway: 'secondary', lanes: '2' }),
    way([[0, 0], [-45, -78]], { highway: 'residential', lanes: '1' }),
  ] },
  { key: 'skew-junction', label: 'Acute crossing · bounded corners', height: (x, z) => 8 + .015 * x + .01 * z, roads: [
    way([[-85, 0], [0, 0], [85, 0]], { lanes: '4' }),
    way([[-75, -42], [0, 0], [75, 42]], { highway: 'secondary', lanes: '2' }),
  ] },
  { key: 'five-arm-junction', label: 'Five arms · every approach retains its width', height: () => 8, roads:
    Array.from({ length: 5 }, (_, i) => way([[0, 0], [Math.cos(i * Math.PI * 2 / 5) * 80, Math.sin(i * Math.PI * 2 / 5) * 80]],
      { highway: i ? 'residential' : 'primary', lanes: i ? '2' : '4' })) },
  { key: 'bend-junction', label: 'Right-angle connection · fitted inside corner', height: () => 8, roads: [
    way([[-85, 0], [0, 0], [0, 85]], { highway: 'secondary', lanes: '2' }),
  ] },
  { key: 'local-guide-signs', label: 'OSM labels · street, destination, attraction and civic signs', height: () => 8, roads: [
    way([[-120, 0], [120, 0]], { highway: 'secondary', lanes: '2', name: '明治通り', maxspeed: '40',
      destination: '新宿;原宿', 'destination:ref': '305' }),
  ], signs: true, targets: [
    { x: -50, z: 35, tags: { tourism: 'attraction', name: '明治神宮' } },
    { x: 45, z: -35, tags: { amenity: 'townhall', name: '渋谷区役所' } },
  ] },
  { key: 'bridge', label: 'Bridge · valley span', height: x => 20 - 18 * Math.exp(-((x / 65) ** 2)), roads: [way(straight, { bridge: 'yes' })], signs: true, guidance: straight },
  { key: 'viaduct', label: 'Viaduct · uneven ground', height: x => 9 + .025 * x + Math.sin(x / 40) * 1.2, roads: [way(straight, { bridge: 'yes' })] },
  { key: 'tunnel', label: 'Mountain tunnel · continuous portals', height: x => 8 + 25 * Math.exp(-((x / 67) ** 4)), roads: [way(straight, { tunnel: 'yes' })], bore: straight, signs: true, guidance: straight },
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
      color: material.color, roughness: .8, side: material.side, vertexColors: material.vertexColors,
      map: material.map, emissive: material.isMeshBasicMaterial ? material.color : material.emissive,
      emissiveIntensity: material.isMeshBasicMaterial ? 1 : material.emissiveIntensity,
      polygonOffset: material.polygonOffset, polygonOffsetFactor: material.polygonOffsetFactor, polygonOffsetUnits: material.polygonOffsetUnits,
      transparent: material.transparent, alphaTest: material.alphaTest,
    }));
    node.material = replacements.get(material);
    if (material.userData.signGlow && !node.material.userData.signGlow) applySignGlow(node.material, material.map);
    const canvas = material.map?.image, texture = canvas?.toDataURL ? `${prefix}-${material.id}` : null;
    if (texture && !textures[texture]) textures[texture] = canvas.toDataURL('image/png');
    const count = node.isInstancedMesh ? node.count : 1;
    for (let i = 0; i < count; i++) {
      const m = new THREE.Matrix4();
      if (node.isInstancedMesh) { node.getMatrixAt(i, m); m.premultiply(node.matrixWorld); }
      else m.copy(node.matrixWorld);
      const geo = node.geometry.clone().applyMatrix4(m);
      const color = material.color.clone();
      if (node.instanceColor) { const tint = new THREE.Color(); node.getColorAt(i, tint); color.multiply(tint); }
      parts.push({ vertices: Array.from(geo.attributes.position.array),
        faces: geo.index ? Array.from(geo.index.array) : Array.from({ length: geo.attributes.position.count }, (_, i) => i),
        colors: material.vertexColors && geo.attributes.color ? Array.from(geo.attributes.color.array) : null,
        color: color.toArray(), emission: material.isMeshBasicMaterial ? 1 : 0,
        glow: geo.attributes.signGlow ? Array.from(geo.attributes.signGlow.array) : null,
        side: material.side, texture, uvs: texture && geo.attributes.uv ? Array.from(geo.attributes.uv.array) : null });
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
    if (fixture.signs) {
      const pois = (fixture.targets || []).map(p => { const [lat, lon] = xzToLL(p.x, p.z, center); return { lat, lng: lon, tags: p.tags }; });
      buildWorldSigns({ group: root, terrain, center, portals: [], signSpots: [], generic: [], pois,
        lowPower: false, corpus: null, rnd: () => { throw Error('Mapped signs cannot consume RNG'); }, used: new Set(),
        roads: fixture.roads, roadRuns: result.roadRuns, isBlocked: () => false, features: [] });
    }
    if (result.gradeRejected) throw Error(`${fixture.key}: rejected ${result.gradeRejected} bridge profiles`);
    if (fixture.crossing) root.add(makeLevelCrossing(0, 8, 0, 0, 1));
    if (fixture.platform) buildBaseWaterPads(root, [{ x: 0, z: 0, side: 'STEEL', roadY: fixture.height(0, 0) + window.__roadLift }],
      terrain, result.decks, result.cols, [[[-240, 0], [240, 0]]]);
    const deckY = makeDeckIndex(result.decks), tunnelAt = makeTunnelIndex(result.tunnels);
    const keys = ['terrain', 'deckY', 'tunnelAt', 'blockerTop', 'roofPlatformAt', 'DECK_STEP', 'DECK_MARGIN', 'DECK_UNDER', 'MAX_MECH_H', 'BLK_MARGIN'];
    const surface = new Function(...keys, `return (x,z,curY) => ${window.__roadSurfaceBlock};`)(
      terrain, deckY, tunnelAt, () => null, () => null, ...window.__roadSurfaceConstants);
    terrain.surfaceAt = surface; terrain.deckY = deckY; terrain.blockers = result.cols;
    let guidance = null, guidanceFurniture = null;
    const collisionBeforeGuidance = JSON.stringify(result.cols);
    if (fixture.guidance) {
      const Profile = new Function('return class { ' + window.__laneProfileSource + ' };')();
      const profile = new Profile();
      profile.lanePts = [fixture.guidance.map(([x, z]) => new THREE.Vector3(x, 0, z))];
      profile.terrain = terrain; profile._surf = surface; profile._buildLaneSurf();
      guidance = planLaneGuidance(profile._laneSurf, { surfaceAt: surface, roadRuns: result.roadRuns,
        ceilingAt: (x, z, y) => { const t = tunnelAt(x, z); return t && !t.open && y < t.ceil ? t.ceil : null; } });
      const plates = laneGuidePlates(guidance);
      const accepted = root.userData.setLaneSigns(plates);
      if (accepted.length !== guidance.signs.length) throw Error('Lane atlas dropped a tactical sign');
      const firstAtlas = root.children.find(m => m.userData.signTex);
      let released = 0;
      firstAtlas.userData.signTex.addEventListener('dispose', () => released++);
      root.userData.setLaneSigns(plates);
      const atlases = root.children.filter(m => m.userData.signTex);
      if (released !== 1 || atlases.length !== 1 || atlases[0].userData.signDropped) throw Error('Lane atlas replacement leaked or dropped a plate');
      guidanceFurniture = buildLaneGuidance(guidance); guidanceFurniture.userData.update(.7); root.add(guidanceFurniture);
      if (JSON.stringify(terrain.blockers) !== collisionBeforeGuidance) throw Error('Roadside signs changed movement blockers');
    }
    const Collision = new Function('selfCollider', 'PUSH_EPS', `return class { ${window.__roadCollisionSource} };`)(selfCollider, PUSH_EPS);
    const probe = new Collision();
    Object.assign(probe, { terrain, selfH: window.__roadSurfaceConstants[3], vel: { x: 0, z: 0 },
      _flying: () => false, _unitSolids: () => [], _surf: surface });
    if (guidanceFurniture) {
      // Traverse every prop's footprint with the actual player resolver. Rendering cannot change collision.
      const move = (p, attached) => {
        if (attached) root.add(guidanceFurniture); else root.remove(guidanceFurniture);
        const x0 = p.x - p.dx * 2, z0 = p.z - p.dz * 2;
        probe.pos = { x: p.x + p.dx * 2, y: p.y, z: p.z + p.dz * 2 };
        probe.vel.x = 0; probe.vel.z = 0; probe._collide(x0, z0);
        return { ...probe.pos };
      };
      for (const p of [...guidance.markers, ...guidance.signs]) {
        if (JSON.stringify(move(p, false)) !== JSON.stringify(move(p, true))) throw Error('Roadside sign altered player movement');
      }
    }
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
    if (guidance) renderer.compile(new THREE.Scene().add(root), new THREE.PerspectiveCamera());
    const parts = exportParts(root, fixture.key), groundPart = reviewGround(terrain, fixture, bounds, result.tunnels);
    const covered = result.tunnels.find(t => !t.open);
    const detailSign = guidance?.signs.find(p => p.arrow !== 'straight') || guidance?.signs.find(p => Math.abs(p.dx) > .9);
    models.push({ key: fixture.key, label: fixture.label, parts, ground: groundPart, sectioned: !!fixture.bore, night: !!fixture.night,
      guidance: guidance ? { signs: guidance.signs.length, markers: guidance.markers.length } : null,
      inspection: covered ? { x: covered.x1, z: covered.z1, y: covered.fy1,
        dx: covered.x2 - covered.x1, dz: covered.z2 - covered.z1 } : detailSign ?
        { x: detailSign.x, z: detailSign.z, y: detailSign.y, dx: detailSign.dx, dz: detailSign.dz } : null });
    const scene = new THREE.Scene(); scene.add(root);
    scene.add(new THREE.HemisphereLight(0xffffff, 0x627c6e, fixture.night ? .55 : 2.1));
    const light = new THREE.DirectionalLight(0xfff3d6, fixture.night ? .3 : 2.6); light.position.set(-80, 160, 100); scene.add(light);
    const size = bounds.getSize(new THREE.Vector3());
    const target = bounds.getCenter(new THREE.Vector3()), span = Math.max(size.x, size.z, 40);
    const camera = new THREE.PerspectiveCamera(33, 1100 / 700, .1, 3000);
    camera.position.copy(target).add(new THREE.Vector3(-.85, .75, 1.15).normalize().multiplyScalar(span * 1.75)); camera.lookAt(target);
    if (fixture.close && detailSign) {
      const p = detailSign;
      camera.position.set(p.x - p.dx * 19 + p.dz * 3, p.y + 3.2, p.z - p.dz * 19 - p.dx * 3);
      camera.lookAt(p.x + p.dx * 12, p.y + 3.3, p.z + p.dz * 12);
    }
    renderer.setClearColor(fixture.night ? 0x101927 : 0xdde4de);
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
      colliders: result.cols.length, guidance: guidance ? { signs: guidance.signs.length, markers: guidance.markers.length } : null,
      triangles: parts.reduce((n, p) => n + p.faces.length / 3, 0) });
    disposeTree(root); ground.geometry.dispose(); ground.material.dispose();
  }
  // Readable plate inspection uses the production atlas, including back-to-back faces.
  const root = new THREE.Group(), sheet = new SignSheet(false);
  const copies = ['stop', 'yield', 'no_entry', 'no_parking', 'no_overtaking', 'keep_left', 'keep_right', 'oneway',
    'roundabout', 'crossing', 'rail_crossing', 'narrowing', 'curve', 'bump', 'signals'].map(symbol => ({ t: symbol === 'stop' ? 'STOP' : symbol, symbol }));
  copies.unshift({ t: '50', symbol: 'speed' }, { t: '30', s: 'mph', symbol: 'speed' });
  const labels = [
    { t: '中山北路', style: 'street' }, { t: '明治神宮', style: 'tourist', arrow: 'left' },
    { t: '渋谷区役所', style: 'civic', arrow: 'right' }, { t: 'Champs-Élysées', style: 'street' },
    { t: 'شارع النيل', style: 'street' }, { t: '新宿', s: '原宿', ref: '305', style: 'destination', arrow: 'straight' },
  ];
  copies.forEach((copy, i) => sheet.add({ copy, x: (i % 6) * 2.5 - 6.25, y: 8 - Math.floor(i / 6) * 2.1,
    z: 0, ry: 0, h: 1.6, style: trafficSignStyle(copy), both: true }));
  labels.forEach((copy, i) => sheet.add({ copy, x: i % 2 ? 4.1 : -4.1, y: 1 - Math.floor(i / 2) * 1.5,
    z: 0, ry: 0, h: .95, style: copy.style, both: true }));
  const signs = sheet.build(); root.add(signs);
  if (signs.userData.signDropped || signs.userData.signCount !== copies.length + labels.length) {
    throw Error('Sign atlas lost a review plate: ' + JSON.stringify({ drawn: signs.userData.signCount, dropped: signs.userData.signDropped,
      missing: [...copies, ...labels].filter(c => !sheet.items.some(it => it.copy === c)).map(c => c.t) }));
  }
  const parts = exportParts(root, 'traffic-sign-library');
  models.push({ key: 'traffic-sign-library', label: 'Traffic signs · native plates and local scripts', parts,
    ground: { vertices: [-12, -4, -3, 12, -4, -3, 12, -4, 3, -12, -4, 3], faces: [0, 2, 1, 0, 3, 2], color: [.63, .7, .62] }, sectioned: false });
  const scene = new THREE.Scene(); scene.add(root, new THREE.HemisphereLight(0xffffff, 0x627c6e, 2.1));
  const camera = new THREE.PerspectiveCamera(38, 1100 / 700, .1, 100);
  camera.position.set(0, 3, 24); camera.lookAt(0, 3, 0); renderer.render(scene, camera);
  images.push({ key: 'traffic-sign-library', src: renderer.domElement.toDataURL('image/png') });
  report.push({ key: 'traffic-sign-library', signs: signs.userData.signCount, dropped: signs.userData.signDropped });
  disposeTree(root);
  renderer.dispose(); renderer.forceContextLoss();
  window.__roadReview = { models, report, images, textures };
} catch (error) { window.__roadReview = { error: error.stack }; }
