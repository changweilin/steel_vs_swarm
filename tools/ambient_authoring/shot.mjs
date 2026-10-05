import assert from 'node:assert/strict';
import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { chromiumOrNull, chromePath, serve } from '../pw.mjs';
import { readSrc, grabFn } from '../audit_src.mjs';

const output = 'out/atmosphere_review';
await mkdir(output, { recursive: true });
const chromium = await chromiumOrNull();
assert(chromium, 'An existing browser runtime is required');
const server = await serve();
const browser = await chromium.launch({ headless: true, executablePath: chromePath() });
try {
  const page = await browser.newPage({ viewport: { width: 960, height: 640 } });
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('console', e => { if (e.type() === 'error') errors.push(e.text()); });
  await page.route('**/main.js', r => r.fulfill({ contentType: 'text/javascript', body: '' }));
  await page.route('https://fonts.googleapis.com/**', r => r.fulfill({ contentType: 'text/css', body: '' }));
  if (process.env.THREE_MODULE) {
    const body = await readFile(process.env.THREE_MODULE, 'utf8');
    await page.route('**/three@0.160.0/build/three.module.js', r => r.fulfill({ contentType: 'text/javascript', body }));
  }
  await page.goto(server.url, { waitUntil: 'domcontentloaded' });
  const biomeSource = grabFn(readSrc('public', 'js', 'biomes.js'), 'buildFlocks');
  const result = await page.evaluate(async biomeSource => {
    const THREE = await import('three');
    const { buildWildlifeBatches } = await import('/public/js/wildlifeRender.js');
    const wildlifeRules = await import('/public/js/wildlife.js');
    const { FLOCK, FISH, CAT, DOG, SMALL_ANIMALS } = wildlifeRules;
    const { blockerFoot, makeFootprintIndex } = await import('/public/js/ground.js');
    const { visualPref, setVisualPref } = await import('/public/js/visualPrefs.js');
    const { edgeWallInsetM, objHeightMax } = await import('/public/js/data.js');
    const { AMBIENT_SURFACES } = await import('/public/js/ambientMeshData.js');
    const { runtimeMeshDataGeometry } = await import('/public/js/runtimePartModel.js');
    const { envMat, disposeTree, setCelSun, setWeatherDynamics } = await import('/public/js/toon.js');
    const { makeRainImpacts } = await import('/public/js/weatherFx.js');
    const { resolveWeatherVisuals } = await import('/public/js/weatherVisuals.js');
    const { resolveWeatherDynamics } = await import('/public/js/data.js');
    const { buildHazard, stepFireVisual } = await import('/public/js/hazards.js');
    const { makeDamageFx } = await import('/public/js/vfx.js');
    const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
    renderer.setSize(960, 640); document.body.replaceChildren(renderer.domElement);
    const scene = new THREE.Scene(); scene.background = new THREE.Color(0x2e3942);
    const camera = new THREE.PerspectiveCamera(38, 1.5, .01, 1000);
    const sun = new THREE.DirectionalLight(0xfff2d7, 2);
    sun.position.set(-2, 5, 3); scene.add(sun, new THREE.HemisphereLight(0xd5e5ee, 0x6b7054, 1.2));
    setCelSun(sun.position.clone().normalize());
    const ground = new THREE.Mesh(new THREE.PlaneGeometry(400, 400), envMat(0x727c67, { rim: 0, wash: .05 }));
    ground.rotation.x = -Math.PI / 2; scene.add(ground);
    const bounds = { minX: -100, maxX: 100, minZ: -100, maxZ: 100 };
    const captures = [], check = (value, message) => { if (!value) throw new Error(message); };
    const draw = name => { renderer.render(scene, camera); captures.push({ name, image: renderer.domElement.toDataURL() }); };
    const specs = { bird: FLOCK, fish: FISH, cat: CAT, dog: DOG, ...SMALL_ANIMALS };
    for (const [species, config] of Object.entries(specs)) {
      const group = new THREE.Group(); scene.add(group);
      const spec = { ...config, NOISE_AMP: [0, 0, 0], SPEED: 0.1 };
      const route = { count: 1, seed: 43, n: 3, len: 1,
        pts: new Float32Array([0, .2, 0, .001, .2, 0, 0, .2, .001]), spec };
      const wildlife = buildWildlifeBatches(group, [{ species, routes: [route] }],
        { probe: () => 0, bounds, waterY: species === 'fish' ? 1 : undefined, validAt: () => true });
      wildlife.update(0, .11, { activity: 1 });
      const target = species === 'bird' || species === 'fish' || species === 'butterfly' ? .4 : .24;
      camera.position.set(.78, .58 + target, .98); camera.lookAt(0, target, 0); camera.updateMatrixWorld();
      draw(species);
      const first = Array.from(wildlife.batches[0].body.instanceMatrix.array);
      wildlife.update(1 / 60, 1.25, { activity: 1 });
      check(group.children.every(m => Array.from(m.instanceMatrix.array).every(Number.isFinite)), 'Nonfinite wildlife matrices');
      check(group.children.length <= 8, 'Species exceeds articulated draw budget');
      if (species !== 'fish') {
        check(first.some((v, i) => Math.abs(v - wildlife.batches[0].body.instanceMatrix.array[i]) > 1e-7), 'Wildlife did not advance');
      }
      draw(species + '_motion');
      scene.remove(group); disposeTree(group);
    }
    camera.position.set(1.5, 1.4, 2.3); camera.lookAt(0, .4, 0);
    for (const name of ['leaf', 'petal']) {
      const mesh = new THREE.Mesh(runtimeMeshDataGeometry(AMBIENT_SURFACES[name]),
        envMat(name === 'leaf' ? 0xb65f26 : 0xdfb4c6, { side: THREE.DoubleSide, rim: 0 }));
      mesh.position.y = .65; scene.add(mesh); draw(name); scene.remove(mesh); disposeTree(mesh);
    }
    camera.position.set(14, 12, 23); camera.lookAt(0, 4, 0);
    const fire = buildHazard('forestfire', 42, 7); scene.add(fire);
    for (const [name, wind] of [['fire_calm', 0], ['fire_wind', 100]]) {
      stepFireVisual(fire, 4.2, 1, { wind, windDir: [1, 0] }); draw(name);
      check(fire.userData.flames.every(f => Number.isFinite(f.position.y) && Number.isFinite(f.scale.y)), 'Invalid fire pose');
    }
    stepFireVisual(fire, 4.2, 0, {});
    check(fire.userData.flames.every(f => !f.visible), 'Extinguished fire retained flames');
    scene.remove(fire); disposeTree(fire);
    const damage = makeDamageFx({ r: 1.8, top: 2, h: 3, surfaceCracks: false });
    scene.add(damage); damage.userData.setStage(2);
    setWeatherDynamics(resolveWeatherDynamics({ wind: 100 })); damage.userData.update(.1, 4.2); draw('damage_fire_wind');
    scene.remove(damage); disposeTree(damage);
    const terrain = { ...bounds, waterY: .15, heightAt: x => x < 0 ? -.4 : 0, inDryBand: x => x >= 0 };
    const dyn = { effectiveRain: 1, wind: 100, windDir: [1, 0] }, profile = resolveWeatherVisuals(dyn);
    camera.position.set(6, 2, 7); camera.lookAt(0, 0, 0);
    const water = new THREE.Mesh(new THREE.PlaneGeometry(35, 35), envMat(0x4d7b88, { transparent: true, opacity: .8, rim: 0 }));
    water.rotation.x = -Math.PI / 2; water.position.set(-17.5, .15, 0); scene.add(water);
    const impacts = makeRainImpacts(terrain, 42); scene.add(impacts.obj);
    for (let i = 0; i < 120; i++) impacts.update(1 / 60, camera, dyn, profile);
    draw('rain_contacts');
    check(impacts.obj.visible && impacts.obj.geometry.instanceCount === 196, 'Rain contact budget is invalid');
    const contactSeeds = impacts.obj.geometry.attributes.aSeed.array;
    check(contactSeeds.some((v, i) => i % 3 === 1 && v === 1), 'Water contacts are absent');
    check(contactSeeds.some((v, i) => i % 3 === 1 && v === 0 && contactSeeds[i + 1] === 1), 'Ground contacts are absent');
    for (let i = 0; i < 180; i++) impacts.update(1 / 60, camera, {}, resolveWeatherVisuals());
    check(!impacts.obj.visible, 'Rain contacts failed to fade with rain');
    scene.remove(impacts.obj); impacts.dispose(); scene.remove(water); disposeTree(water);
    const dependencyNames = ['edgeWallInsetM', 'objHeightMax', 'terrainEnvCode', 'makeFootprintIndex', 'blockerFoot',
      'visualPref', 'buildWildlifeBatches', 'BIRDS_OFF', 'FISH_OFF', 'CATS_OFF', 'DOGS_OFF',
      'SMALL_ANIMALS', 'planFlockRoutes', 'planFishRoutes', 'planCatRoutes', 'planDogRoutes', 'planSmallAnimalRoutes'];
    const buildFlocks = new Function(...dependencyNames, biomeSource + '\nreturn buildFlocks;')(
      edgeWallInsetM, objHeightMax, (_, x) => x < 0 ? 1 : 0, makeFootprintIndex, blockerFoot,
      visualPref, buildWildlifeBatches, true, false, false, false, SMALL_ANIMALS,
      wildlifeRules.planFlockRoutes, wildlifeRules.planFishRoutes, wildlifeRules.planCatRoutes,
      wildlifeRules.planDogRoutes, wildlifeRules.planSmallAnimalRoutes);
    const habitat = { ...bounds, heightAt: x => x < 0 ? -.7 : .2, waterY: 0, inDryBand: x => x >= 0 };
    const anchor = { shore: Array.from({ length: 24 }, (_, i) => [-25 + Math.cos(i / 24 * Math.PI * 2) * 10,
      Math.sin(i / 24 * Math.PI * 2) * 10]), groves: [{ x: 25, z: 0, r: 6 }], settlements: [{ x: 25, z: 0, r: 6 }] };
    setVisualPref('birds', 0);
    const biome = new THREE.Group(), dynamics = [];
    buildFlocks(biome, habitat, dynamics, { anchors: anchor, low: false });
    check(!biome.children.some(m => m.name.startsWith('wildlife-bird-')), 'Bird kill switch failed');
    for (const species of ['fish', 'cat', 'dog', 'rabbit', 'squirrel', 'butterfly']) {
      check(biome.children.some(m => m.name.startsWith('wildlife-' + species + '-')), 'Bird toggle suppressed ' + species);
    }
    for (const update of dynamics) update(1 / 60);
    check(biome.children.every(m => m.instanceMatrix.array.every(Number.isFinite)), 'Biome wiring produced nonfinite matrices');
    disposeTree(biome);
    for (const low of [false, true]) {
      let ground = 0;
      const group = new THREE.Group();
      const route = { count: 1000, seed: 1, n: 3, len: 20,
        pts: new Float32Array([0, 0, 0, 10, 0, 0, 0, 0, 10]), spec: CAT };
      const wildlife = buildWildlifeBatches(group, [{ species: 'cat', routes: [route] }], { probe: () => ground, bounds, low });
      check(wildlife.total === (low ? 64 : 128), 'Global wildlife instance budget failed');
      ground = NaN; wildlife.update(.1, 1);
      check(group.children.every(m => m.instanceMatrix.array.every(Number.isFinite)), 'Invalid terrain poisoned instance matrices');
      check(wildlife.batches[0].body.instanceMatrix.array[0] === 0, 'Invalid terrain retained visible wildlife');
      disposeTree(group);
    }
    const baseline = { ...renderer.info.memory };
    for (let i = 0; i < 3; i++) {
      const group = new THREE.Group(); scene.add(group);
      const route = { count: 4, seed: 1, n: 3, len: 20, pts: new Float32Array([0, 0, 0, 10, 0, 0, 0, 0, 10]), spec: CAT };
      const animals = buildWildlifeBatches(group, [{ species: 'cat', routes: [route] }], { probe: () => 0, bounds });
      animals.update(1 / 60, 1); renderer.render(scene, camera); scene.remove(group); disposeTree(group); renderer.render(scene, camera);
      check(renderer.info.memory.geometries === baseline.geometries && renderer.info.memory.textures === baseline.textures,
        'Wildlife teardown leaked GPU resources');
    }
    const invalid = makeRainImpacts({ ...terrain, heightAt: () => NaN }, 42);
    invalid.update(.25, camera, dyn, profile);
    check(invalid.obj.geometry.attributes.aSeed.array.every((v, i) => i % 3 !== 2 || v === 0), 'Missing terrain created impacts');
    invalid.dispose();
    disposeTree(scene); renderer.dispose();
    return { captures };
  }, biomeSource);
  assert.deepEqual(errors, []);
  for (const capture of result.captures) await writeFile(`${output}/${capture.name}.png`, Buffer.from(capture.image.split(',')[1], 'base64'));
  const figures = result.captures.map(c => `<figure><img src="${c.name}.png"><figcaption>${c.name.replaceAll('_', ' ')}</figcaption></figure>`).join('');
  await writeFile(`${output}/index.html`, `<!doctype html><html lang="en"><meta charset="utf-8"><title>Wildlife and weather review</title><style>body{margin:24px;background:#182027;color:#e7eef2;font:16px system-ui}main{display:grid;grid-template-columns:repeat(3,1fr);gap:18px}figure{margin:0}img{width:100%}figcaption{padding:8px;text-transform:capitalize}</style><h1>Wildlife and weather</h1><main>${figures}</main></html>`);
  await page.setViewportSize({ width: 1280, height: 960 });
  const overview = result.captures.filter(c => !c.name.endsWith('_motion')).map(c =>
    `<figure><img src="${c.image}"><figcaption>${c.name.replaceAll('_', ' ')}</figcaption></figure>`).join('');
  await page.setContent(`<style>body{margin:18px;background:#182027;color:#e7eef2;font:17px system-ui}main{display:grid;grid-template-columns:repeat(4,1fr);gap:12px}figure{margin:0}img{width:100%}figcaption{padding:4px;text-transform:capitalize}</style><h2>Blender wildlife and weather · in-game WebGL</h2><main>${overview}</main>`);
  await page.screenshot({ path: `${output}/overview.png`, fullPage: true });
  console.log(`${result.captures.length} WebGL captures; animation, extinction, contact sampling, omission and GPU teardown passed.`);
} finally { await browser.close(); server.close(); }
