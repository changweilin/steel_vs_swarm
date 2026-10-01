// Render the deployed habitat/land-field builders on numeric feature fixtures.
// Checks GPU geometry, material compilation, bounded batching and repeated teardown.
import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { chromiumOrNull, chromePath, serve } from './pw.mjs';
import { ROOT } from './audit_src.mjs';
import { loadOsmFixture, loadElevationFixture, fixtureOsm, DEFAULT_ELEVATION_DIR } from './osm_fixture.mjs';

const chromium = await chromiumOrNull();
assert(chromium, 'Habitat visual validation requires an existing Playwright runtime');
const out = path.join(ROOT, 'out', 'habitat_review');
await mkdir(out, { recursive: true });
const server = await serve();
const browser = await chromium.launch({ headless: true, executablePath: chromePath(),
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
try {
  const page = await browser.newPage({ viewport: { width: 1200, height: 760 } });
  const errors = [];
  let omittedImagery = false;
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => {
    if (message.type() !== 'error') return;
    if (omittedImagery && message.location().url.startsWith('https://server.arcgisonline.com/')) return;
    errors.push(message.text());
  });
  const local = process.env.THREE_MODULE || path.join(ROOT, 'out', 'forest_review', 'three.module.js');
  await page.route('**/three@0.160.0/build/three.module.js', async route => route.fulfill({
    contentType: 'text/javascript', body: await readFile(local, 'utf8') }));
  await page.route('**/three@0.160.0/examples/jsm/**', async route => {
    const suffix = route.request().url().split('/examples/jsm/')[1].split('?')[0].replaceAll('/', '_');
    await route.fulfill({ contentType: 'text/javascript', body: await readFile(path.join(path.dirname(local), suffix), 'utf8') });
  });
  await page.route('**/main.js', route => route.fulfill({ contentType: 'text/javascript', body: '' }));
  await page.route('https://fonts.googleapis.com/**', route => route.fulfill({ contentType: 'text/css', body: '' }));
  await page.goto(server.url, { waitUntil: 'domcontentloaded' });
  const report = await page.evaluate(async () => {
    const THREE = await import('three');
    const { buildLandField } = await import('/public/js/landfield.js');
    const { buildHabitatScene } = await import('/public/js/habitatRender.js');
    const { habitatAt, planHabitatCanopy } = await import('/public/js/habitat.js');
    const { forestSceneGeometry } = await import('/public/js/scenePropModels.js');
    const { envMat, setLandField, updateCelLight, setCelSun, disposeTree } = await import('/public/js/toon.js');
    const { buildOsmPolygonBuildings } = await import('/public/js/osmBuilding.js');
    const { Pipeline } = await import('/public/js/postfx.js');
    document.body.innerHTML = '<canvas id="habitat" width="1200" height="760"></canvas>';
    document.body.style.margin = '0';
    const renderer = new THREE.WebGLRenderer({ canvas: document.getElementById('habitat'), antialias: true });
    renderer.setSize(1200, 760); renderer.setPixelRatio(1);
    const scene = new THREE.Scene(); scene.background = new THREE.Color(0xbac7c5);
    scene.add(new THREE.HemisphereLight(0xffffff, 0x827461, .7));
    const sun = new THREE.DirectionalLight(0xfff1d5, 1.1); sun.position.set(35, 70, -35); scene.add(sun);
    setCelSun(sun.position);
    const camera = new THREE.PerspectiveCamera(48, 1200 / 760, .1, 800);
    const pipeline = new Pipeline(renderer, scene, camera, { ink: false, dof: false, grade: false, fxaa: false, wipe: false });
    const observations = code => ({ code, confidence: 2, sources: 3, texture: code === 60 ? 180 : 90,
      coherence: 180, greenFraction: code === 60 || code === 50 ? .05 : .8, brightness: 125, landform: 1 });
    const square = (x0, z0, x1, z1) => [[x0, z0], [x1, z0], [x1, z1], [x0, z1]];
    const results = [], shots = [], memory = [];
    const terrain = { minX: -110, maxX: 110, minZ: -85, maxZ: 85, worldW: 220, worldH: 170, gridM: 220 / 64,
      heightAt: () => 3, center: { lat: 25, lng: 121 }, minH: 3, maxH: 3 };
    for (const [name, code, zone] of [['street', 50, 'urban'], ['meadow', 30, 'green'],
      ['woodland', 10, 'green'], ['scrub', 20, 'green'], ['exposed', 60, 'bare']]) {
      terrain.evidenceAt = () => observations(code);
      const areas = name === 'street' ? [{ sourceId: 'fixture-building', tags: { building: 'house', height: '12' },
        classification: { type: 'building', generator: 'polygonBuilding', family: 'residential', kind: 'house', surface: 'urban', priority: 10 },
        worldPolygons: [{ outer: square(-32, 13, -12, 30), holes: [] }], areaM2: 340, centroid: { x: -22, z: 21.5 } }] : [];
      const field = await buildLandField({ terrain, center: terrain.center, areas, classifyPureAt: () => zone,
        envCodeAt: () => 0, projectAt: () => [0, 0], seed: 7717 });
      setLandField(field.data, field.nx, field.nz, field.bounds, field.appearance);
      const root = new THREE.Group(); scene.add(root);
      const groundGeo = new THREE.PlaneGeometry(220, 170, 64, 64); groundGeo.rotateX(-Math.PI / 2); groundGeo.translate(0, 3, 0);
      root.add(new THREE.Mesh(groundGeo, envMat(0xffffff, { land: true, landField: true, landNrm: true, rim: 0 })));
      const roadClear = (x, z, f) => name === 'street' && Math.abs(z) < 5 + f.r;
      const args = { surfaceField: field, seed: 7717, areas, envCodeAt: () => 0, isBlocked: () => false, roadClear,
        roadSegments: name === 'street' ? [{ a: [-100, 0], b: [100, 0], hw: 5 }] : [],
        reservedFootprints: name === 'street' ? [{ x: -22, z: 21.5, hw: 10, hd: 8.5, ry: 0, r: 14 }] : [],
        environment: { latitude: 25 }, season: 'summer' };
      const batch = new THREE.Group(); root.add(batch);
      const stats = buildHabitatScene(batch, terrain, args);
      const signature = group => {
        const values = [];
        group.traverse(node => {
          if (!node.isMesh) return;
          for (const a of Object.values(node.geometry.attributes)) {
            if (![...a.array].every(Number.isFinite)) throw new Error('Non-finite habitat geometry');
          }
          if (node.instanceMatrix && ![...node.instanceMatrix.array].every(Number.isFinite)) throw new Error('Non-finite habitat instance');
          values.push([node.name, [...node.geometry.attributes.position.array], node.instanceMatrix ? [...node.instanceMatrix.array] : null]);
        });
        return JSON.stringify(values);
      };
      const again = new THREE.Group(); buildHabitatScene(again, terrain, args);
      if (signature(batch) !== signature(again)) throw new Error('Habitat renderer replay differs');
      disposeTree(again);
      const low = new THREE.Group(); const lowStats = buildHabitatScene(low, terrain, { ...args, low: true });
      if (lowStats.details > stats.details || lowStats.models > 16) throw new Error('Habitat budget exceeded');
      disposeTree(low);
      if (name === 'street') {
        const roadGeo = new THREE.PlaneGeometry(220, 10); roadGeo.rotateX(-Math.PI / 2); roadGeo.translate(0, 3.025, 0);
        root.add(new THREE.Mesh(roadGeo, envMat(0x505254, { land: true, rim: 0 })));
        const buildings = buildOsmPolygonBuildings(root, areas, { terrain, rings: [], terrainEnvCode: () => 0 });
        if (!buildings.generated) throw new Error('OSM street fixture failed to generate');
      }
      const canopy = planHabitatCanopy({ bounds: field.bounds, seed: 7717, maxPlants: 60,
        sampleAt: () => habitatAt(observations(code), zone) });
      if (name === 'woodland' || name === 'meadow') {
        for (const row of canopy.rows) {
          const mesh = new THREE.Mesh(forestSceneGeometry('holmOak', row.seed, [5, 8, 5]), envMat(0xffffff, { vertexColors: true }));
          mesh.position.set(row.x, 3, row.z); root.add(mesh);
        }
      }
      camera.position.set(44, 18, 53); camera.lookAt(-6, 3.5, -7); camera.updateMatrixWorld(true);
      updateCelLight(camera);
      renderer.render(scene, camera);
      const draws = renderer.info.render.calls, triangles = renderer.info.render.triangles;
      pipeline.render();
      shots.push({ name, data: renderer.domElement.toDataURL('image/png') });
      results.push({ name, ...stats, draws, triangles });
      scene.remove(root); disposeTree(root); pipeline.render();
      memory.push({ ...renderer.info.memory });
    }
    // Reinstalling fields retains exactly the two current textures, including all previous teardown cycles.
    if (memory.at(-1).geometries !== memory[0].geometries || memory.at(-1).textures > memory[0].textures + 1) {
      throw new Error('Habitat GPU resources accumulated: ' + JSON.stringify(memory));
    }
    pipeline.dispose(); renderer.dispose();
    return { results, shots, memory };
  });
  assert.deepEqual(errors, [], 'Browser/shader errors');
  for (const shot of report.shots) await writeFile(path.join(out, shot.name + '.png'), Buffer.from(shot.data.split(',')[1], 'base64'));
  delete report.shots;
  await writeFile(path.join(out, 'report.json'), JSON.stringify(report, null, 2) + '\n');
  console.log('PASS browser habitat:', JSON.stringify(report));
  const fixtureIndex = process.argv.indexOf('--fixture');
  if (fixtureIndex >= 0) {
    const name = process.argv[fixtureIndex + 1], fixture = loadOsmFixture(name), elevation = loadElevationFixture(name);
    assert(fixture && elevation, 'Full habitat review requires matching validated OSM/elevation fixtures');
    const tiles = new Map();
    for (const tile of elevation.source.tiles) tiles.set(tile.url, await readFile(path.join(DEFAULT_ELEVATION_DIR, tile.path)));
    await page.route('https://s3.amazonaws.com/elevation-tiles-prod/**', route => {
      const body = tiles.get(route.request().url());
      return body ? route.fulfill({ contentType: 'image/png', body, headers: { 'access-control-allow-origin': '*' } }) : route.abort();
    });
    omittedImagery = true;
    await page.route('https://server.arcgisonline.com/**', route => route.abort());
    const actual = await page.evaluate(async ({ venueId, team, osm }) => {
      const THREE = await import('three');
      const { VENUES, venueConfig } = await import('/public/js/venues.js');
      const { buildTerrain } = await import('/public/js/terrain.js');
      const { buildBiomes, commitOsmIn } = await import('/public/js/biomes.js');
      const { applyEnvironment } = await import('/public/js/environment.js');
      const { Pipeline } = await import('/public/js/postfx.js');
      const { updateCelLight, disposeTree } = await import('/public/js/toon.js');
      const cfg = venueConfig(VENUES.find(v => v.id === venueId), team);
      cfg.env = { season: 'summer', time: 'day', weather: 'clear' };
      const start = performance.now(), terrain = await buildTerrain(cfg);
      if (terrain.usedFallback) throw new Error('Real elevation fixture fell back');
      commitOsmIn(terrain.bbox, { feats: osm.features, roads: osm.roads });
      const bio = await buildBiomes(cfg, terrain);
      if (bio.userData.stats.habitatScene.recipe !== 'evidence-habitat-v1' || !bio.userData.stats.mapEvidence) {
        throw new Error('Full prebuild bypassed habitat/evidence generation');
      }
      const scene = new THREE.Scene(); scene.add(terrain.group, bio);
      const environment = applyEnvironment(scene, terrain, cfg.env, { shadow: false });
      const renderer = new THREE.WebGLRenderer({ antialias: true }); renderer.setSize(1200, 760);
      const span = Math.max(terrain.worldW, terrain.worldH);
      const camera = new THREE.PerspectiveCamera(55, 1200 / 760, .5, span * 4);
      camera.position.set(span * .37, terrain.maxH + span * .48, span * .55);
      camera.lookAt(0, terrain.avgH, 0); camera.updateMatrixWorld(true);
      updateCelLight(camera);
      const pipeline = new Pipeline(renderer, scene, camera, { dof: false, wipe: false }); pipeline.render();
      const result = { venueId, stats: bio.userData.stats, buildMs: Math.round(performance.now() - start),
        image: renderer.domElement.toDataURL('image/png') };
      pipeline.dispose(); environment.dispose?.(); disposeTree(bio); disposeTree(terrain.group); renderer.dispose();
      return result;
    }, { venueId: fixture.venue.id, team: fixture.team, osm: fixtureOsm(fixture) });
    assert.deepEqual(errors, [], 'Full prebuild browser errors');
    await writeFile(path.join(out, name + '.png'), Buffer.from(actual.image.split(',')[1], 'base64'));
    delete actual.image;
    await writeFile(path.join(out, name + '.json'), JSON.stringify(actual, null, 2) + '\n');
    console.log('PASS full habitat prebuild:', JSON.stringify({ venue: actual.venueId, buildMs: actual.buildMs,
      buildings: actual.stats.buildings, vegetation: actual.stats.veg, habitat: actual.stats.habitatScene,
      details: actual.stats.groundDetails, evidence: actual.stats.mapEvidence }));
  }
} finally { await browser.close(); server.close(); }
