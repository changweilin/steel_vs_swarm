// Production building attachments: deterministic pivots, time sampling, collapse ownership and recovery.
import assert from 'node:assert/strict';
import { mkdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { chromiumOrNull, chromePath, serve, skipNoPlaywright } from './pw.mjs';

const chromium = await chromiumOrNull();
if (!chromium) skipNoPlaywright('建築設備動畫瀏覽器量測');
const server = await serve();
let browser;
try {
  browser = await chromium.launch({ headless: true, executablePath: chromePath(),
    args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const page = await browser.newPage({ viewport: { width: 800, height: 1000 } });
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  if (process.env.THREE_MODULE) {
    const source = await readFile(process.env.THREE_MODULE, 'utf8');
    await page.route('**/three@0.160.0/build/three.module.js', route => route.fulfill({ contentType: 'text/javascript', body: source }));
    await page.route('**/three@0.160.0/examples/jsm/**', async route => {
      const suffix = route.request().url().split('/examples/jsm/')[1].replaceAll('/', '_');
      const body = await readFile(path.join(path.dirname(process.env.THREE_MODULE), suffix), 'utf8');
      await route.fulfill({ contentType: 'text/javascript', body });
    });
  }
  await page.route('**/main.js', route => route.fulfill({ contentType: 'text/javascript', body: '' }));
  await page.goto(server.url, { waitUntil: 'domcontentloaded' });
  const report = await page.evaluate(async () => {
    const THREE = await import('three');
    const { buildOsmPolygonBuildings } = await import('/public/js/osmBuilding.js');
    const { registerMapBuildings, detachMapBuilding, mapBuildingTarget } = await import('/public/js/mapBuildingRender.js');
    const { chooseArchitecture } = await import('/public/js/buildingDiversity.js');
    const { BUILDING_FUNCTIONS } = await import('/public/js/buildingFunctions.js');
    const { environmentParts } = await import('/public/js/environmentParts.js');
    const { compileSceneParts, scenePartGeometry } = await import('/public/js/scenePropModels.js');
    const { buildPartMotion } = await import('/public/js/partMotion.js');
    const { applySceneDamage } = await import('/public/js/sceneDamage.js');
    const { disposeTree, setCelSun, updateCelLight } = await import('/public/js/toon.js');
    const check = (condition, message) => { if (!condition) throw Error(message); };
    const finite = root => {
      root.updateMatrixWorld(true);
      root.traverse(node => {
        check(node.matrixWorld.elements.every(Number.isFinite), 'Non-finite building pose');
        if (node.geometry) check(node.geometry.attributes.position.array.every(Number.isFinite), 'Non-finite building geometry');
      });
    };
    const rows = [
      { type: 'house', label: 'Residential / ventilation', flat: true },
      { type: 'plant', label: 'Wind / turbine', tags: { 'plant:source': 'wind' } },
      { type: 'civic', label: 'Civic / banner', tags: { architecture: 'neoclassical_civic' } },
      { type: 'hospital', label: 'Hospital / ventilation', flat: true },
      { type: 'factory', label: 'Industrial / cooling fans', environment: true },
      { type: 'oilfield', label: 'Oil derrick / drill string', environment: true },
    ];
    document.body.innerHTML = '';
    document.body.style.cssText = 'margin:0;background:#ddd8ce;color:#293540;font:16px sans-serif';
    const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
    renderer.setSize(390, 310);
    setCelSun(new THREE.Vector3(.4, .8, .3).normalize(), 1);
    let assemblies = 0;
    for (const row of rows) {
      const root = new THREE.Group(), moving = [];
      let result, record;
      if (row.environment) {
        const parts = environmentParts(row.type, { seed: 42 });
        check(JSON.stringify(parts) === JSON.stringify(environmentParts(row.type, { seed: 42 })), 'Environment replay differs');
        const fixed = new THREE.Mesh(compileSceneParts(parts.filter(p => !p.motion)),
          new THREE.MeshStandardMaterial({ vertexColors: true, roughness: .85 }));
        root.add(fixed);
        const motion = buildPartMotion(parts, scenePartGeometry);
        root.add(motion); moving.push(motion);
      } else {
        const area = { sourceId: row.type, tags: { building: row.type, height: '14', ...row.tags },
          classification: { generator: 'polygonBuilding', kind: row.type },
          worldPolygons: [{ outer: [[-12,-10],[12,-10],[12,10],[-12,10]], holes: [] }] };
        const def = BUILDING_FUNCTIONS[row.type];
        const architectureOf = building => {
          const style = chooseArchitecture(12, row.type, { building,
            ...(def ? { functionInfo: { type: row.type, category: def.category, key: def.range, locked: true } } : {}) });
          return row.flat ? { ...style, roofForm: 'flat' } : style;
        };
        const chosen = architectureOf(area);
        result = buildOsmPolygonBuildings(root, [area], { terrain: { heightAt: () => 10 },
          terrainEnvCode: () => 0, architectureOf: () => chosen });
        const records = registerMapBuildings(root, result.blockers, result.platforms, result.meshes, []);
        record = [...records.values()][0];
        check(record && record.attachments?.length, row.label + ': no owned motion ' + JSON.stringify({
          roof: chosen.actualRoofForm, function: chosen.functionalDesign?.motif,
          generated: result.generatedByKind, skipped: result.skipped, records: [...records.keys()],
        }));
        moving.push(...record.attachments);
        const replay = new THREE.Group();
        const repeated = buildOsmPolygonBuildings(replay, [area], { terrain: { heightAt: () => 10 },
          terrainEnvCode: () => 0, architectureOf });
        check(JSON.stringify(repeated.blockers) === JSON.stringify(result.blockers), 'Building collider replay differs');
        for (let i = 0; i < result.meshes.length; i++) check(
          result.meshes[i].geometry.attributes.position.array.every((n, j) => n === repeated.meshes[i].geometry.attributes.position.array[j]),
          'Building geometry replay differs');
        disposeTree(replay);
      }
      assemblies += moving.reduce((n, m) => n + m.children.length, 0);
      check(moving.every(m => m.children.length > 0), row.label + ': empty motion');
      const signature = () => moving.flatMap(m => m.children.map(p => p.rotation.toArray().slice(0, 3))).flat();
      moving.forEach(m => m.userData.partMotionUpdate(0));
      const rest = signature();
      moving.forEach(m => m.userData.partMotionUpdate(.7));
      check(signature().some((n, i) => n !== rest[i]), row.label + ': motion frozen');
      const sampled = signature();
      for (const fps of [30, 60, 144]) {
        for (let i = 0; i < fps; i++) moving.forEach(m => m.userData.partMotionUpdate(i / fps));
        moving.forEach(m => m.userData.partMotionUpdate(.7));
        check(signature().every((n, i) => n === sampled[i]), 'FPS-dependent equipment');
      }
      moving.forEach(m => m.userData.partMotionUpdate(NaN));
      check(signature().every((n, i) => n === sampled[i]), 'Invalid clock changed equipment');
      finite(root);
      const scene = new THREE.Scene(); scene.background = new THREE.Color(0xddd8ce); scene.add(root);
      scene.add(new THREE.HemisphereLight(0xffffff, 0x6c7180, 2));
      const sun = new THREE.DirectionalLight(0xffffff, 2.2); sun.position.set(20, 40, 30); scene.add(sun);
      const box = new THREE.Box3().setFromObject(root), center = box.getCenter(new THREE.Vector3()), radius = box.getSize(new THREE.Vector3()).length() / 2;
      const camera = new THREE.PerspectiveCamera(36, 390 / 310, .1, 2000);
      camera.position.copy(center).add(new THREE.Vector3(radius * 1.5, radius * 1.3, radius * 2)); camera.lookAt(center);
      const line = document.createElement('div'); line.style.display = 'flex'; document.body.append(line);
      const draw = label => {
        updateCelLight(camera); renderer.render(scene, camera);
        const cell = document.createElement('div'), title = document.createElement('div'), img = document.createElement('img');
        title.textContent = `${row.label} / ${label}`; img.src = renderer.domElement.toDataURL();
        cell.append(title, img); line.append(cell);
      };
      draw('operating');
      if (record) {
        const collision = JSON.stringify(result.blockers);
        root.updateMatrixWorld(true);
        const matrices = moving.map(m => m.matrixWorld.clone());
        const detached = detachMapBuilding(record);
        finite(root);
        moving.forEach((m, i) => check(m.parent === detached && m.matrixWorld.equals(matrices[i]), 'Motion jumped on detach'));
        const ent = mapBuildingTarget(record); ent.mesh = detached;
        applySceneDamage(ent, 3);
        const stopped = signature();
        moving.forEach(m => m.userData.partMotionUpdate(8));
        check(signature().every((n, i) => n === stopped[i]), 'Destroyed equipment still operates');
        detached.scale.y = .2;
        finite(root); draw('collapsed');
        check(JSON.stringify(result.blockers) === collision, 'Presentation changed collision');
        applySceneDamage(ent, 0);
        moving.forEach(m => m.userData.partMotionUpdate(8));
        check(signature().some((n, i) => n !== stopped[i]), 'Recovered equipment stays frozen');
      } else {
        moving.forEach(m => m.userData.partMotionUpdate(1.7));
        finite(root); draw('second pose');
      }
      disposeTree(root);
    }
    renderer.dispose();
    return { buildings: rows.length, assemblies, frameRates: [30, 60, 144], collapseOwnership: true, collisionUnchanged: true };
  });
  assert.deepEqual(errors, []);
  await mkdir('tools/.shots', { recursive: true });
  await page.screenshot({ path: 'tools/.shots/building-motion.png', fullPage: true });
  console.log('Building motion passed:', report);
} finally {
  await browser?.close();
  server.close();
}
