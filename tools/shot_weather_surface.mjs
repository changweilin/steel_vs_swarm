// Compile production weather shaders and verify resource ownership in a real WebGL context.
import assert from 'node:assert/strict';
import { mkdir, readFile } from 'node:fs/promises';
import { chromiumOrNull, chromePath, serve } from './pw.mjs';

const chromium = await chromiumOrNull();
assert(chromium, 'Browser validation requires an existing Playwright runtime');
const server = await serve();
const browser = await chromium.launch({ headless: true, executablePath: chromePath() });
try {
  const page = await browser.newPage({ viewport: { width: 1100, height: 760 } });
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('console', e => { if (e.type() === 'error') errors.push(e.text()); });
  await page.route('**/main.js', r => r.fulfill({ contentType: 'text/javascript', body: '' }));
  await page.route('https://fonts.googleapis.com/**', r => r.fulfill({ contentType: 'text/css', body: '' }));
  if (process.env.THREE_MODULE) {
    const body = await readFile(process.env.THREE_MODULE, 'utf8');
    await page.route('**/three@0.160.0/build/three.module.js', r => r.fulfill({ contentType: 'text/javascript', body }));
  }
  if (process.env.THREE_PASS) {
    const body = await readFile(process.env.THREE_PASS, 'utf8');
    await page.route('**/postprocessing/Pass.js', r => r.fulfill({ contentType: 'text/javascript', body }));
  }
  await page.goto(server.url, { waitUntil: 'domcontentloaded' });
  const result = await page.evaluate(async () => {
    const THREE = await import('three');
    const { envMat, toonMat, disposeTree, updateCelLight } = await import('/public/js/toon.js');
    const { makeScorchAtlas, setSurfaceWeather } = await import('/public/js/weatherMaterial.js');
    const { makeWeatherDeposits } = await import('/public/js/weatherDeposits.js');
    const { syncLightningScorch, releaseLightningScorch } = await import('/public/js/lightningScorch.js');
    const { buildHazard, stepFireVisual } = await import('/public/js/hazards.js');
    const { Pipeline } = await import('/public/js/postfx.js');
    document.body.innerHTML = '';
    const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
    renderer.setSize(1100, 760); document.body.appendChild(renderer.domElement);
    const scene = new THREE.Scene(); scene.background = new THREE.Color(0x829cae);
    scene.add(new THREE.HemisphereLight(0xffffff, 0x767066, 2));
    const light = new THREE.DirectionalLight(0xffffff, 3); light.position.set(-30, 60, 20); scene.add(light);
    const camera = new THREE.PerspectiveCamera(48, 1100 / 760, .1, 1000);
    camera.position.set(42, 42, 58); camera.lookAt(0, 0, 0); camera.updateMatrixWorld(); updateCelLight(camera);
    const pipeline = new Pipeline(renderer, scene, camera, { grade: false, fxaa: false });
    const terrain = { minX: -160, minZ: -160, worldW: 320, worldH: 320, maxX: 160, maxZ: 160,
      minH: 0, maxH: 0, waterY: -5, heightAt: () => 0 };
    const ground = new THREE.Mesh(new THREE.PlaneGeometry(320, 320), envMat(0x777a5c, { rim: 0, land: true }));
    ground.rotation.x = -Math.PI / 2; scene.add(ground);
    const road = new THREE.Mesh(new THREE.BoxGeometry(16, .15, 160), envMat(0x4f5358, { rim: 0 })); scene.add(road);
    const building = new THREE.Mesh(new THREE.BoxGeometry(20, 18, 22), envMat(0xb8ae97));
    building.position.set(-24, 9, -12); scene.add(building);
    const unit = new THREE.Mesh(new THREE.BoxGeometry(3, 4, 3), toonMat(0x638abc));
    unit.position.set(5, 2, 12); scene.add(unit);
    const ent = { mesh: unit };
    const baseMaterial = unit.material, baseGeometry = unit.geometry;
    syncLightningScorch(ent, true);
    if (unit.material !== baseMaterial || unit.geometry !== baseGeometry) throw new Error('Scorch changed shared unit resources');
    releaseLightningScorch(ent);
    if (unit.children.length) throw new Error('Scorch shell leaked');
    const atlas = makeScorchAtlas(terrain), dunes = makeWeatherDeposits(scene, terrain, {
      surface: (x, z) => Math.abs(x + 24) < 10 && Math.abs(z + 12) < 11 ? 18 : 0,
    });
    const fire = buildHazard('fire', 42, 6); fire.position.set(23, 0, 5); scene.add(fire);
    stepFireVisual(fire, 3, 0, {});
    if ([...fire.userData.flames, ...fire.userData.smoke].some(n => n.visible)) throw new Error('Extinguished fire still emits smoke/flames');
    const captures = [];
    for (const [name, state] of Object.entries({ dry: {}, puddles: { water: .42 }, rain: { water: .9 }, draining: { water: .22 }, snow: { snow: .95 }, sand: { sand: .95 } })) {
      setSurfaceWeather(state); dunes.update(1, camera, state);
      if (name === 'sand') {
        const duneMesh = scene.children.find(n => n.isMesh && n !== ground && n !== road && n !== building && n !== unit);
        const positions = duneMesh.geometry.attributes.position;
        for (let i = 0; i < positions.count; i++) {
          const x = positions.getX(i) + duneMesh.position.x, z = positions.getZ(i) + duneMesh.position.z;
          if (Math.abs(x + 24) < 10 && Math.abs(z + 12) < 11 && positions.getY(i) > 0) throw new Error('Dunes entered a sheltered building footprint');
        }
      }
      stepFireVisual(fire, 3, state.water || state.snow ? 0 : 1.3, { wind: 80, windDir: [1, .2] });
      pipeline.render();
      captures.push({ name, image: renderer.domElement.toDataURL() });
    }
    setSurfaceWeather({}); dunes.update(1, camera, {});
    atlas.sync([{ x: -24, y: 18, z: 12, r: 5 }]); syncLightningScorch(ent, true);
    pipeline.render(); captures.push({ name: 'lightning', image: renderer.domElement.toDataURL() });
    const programs = renderer.info.programs.map(p => ({ runnable: p.diagnostics?.runnable, log: p.diagnostics?.programLog }));
    releaseLightningScorch(ent); dunes.dispose(); atlas.dispose(); disposeTree(scene); pipeline.dispose(); renderer.dispose();
    return { captures, programs };
  });
  assert.deepEqual(errors, []);
  assert(result.programs.every(p => p.runnable !== false), JSON.stringify(result.programs));
  await mkdir('out/weather_review', { recursive: true });
  const { writeFile } = await import('node:fs/promises');
  for (const capture of result.captures) await writeFile(`out/weather_review/${capture.name}.png`, Buffer.from(capture.image.split(',')[1], 'base64'));
  assert(new Set(result.captures.map(c => c.image)).size === result.captures.length, 'Weather states must render differently');
  const figures = result.captures.map(({ name }) => `<figure><img src="${name}.png"><figcaption>${name}</figcaption></figure>`).join('');
  await writeFile('out/weather_review/index.html', `<!doctype html><html lang="en"><meta charset="utf-8"><title>Weather surface review</title><style>body{margin:24px;background:#182027;color:#e8eef2;font:16px system-ui}main{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:20px}figure{margin:0}img{width:100%}figcaption{padding:8px;text-transform:capitalize}</style><h1>Weather surface review</h1><main>${figures}</main></html>`);
  console.log(`Compiled ${result.programs.length} shader variants; ${result.captures.length} distinct weather frames and ownership/extinction checks passed.`);
} finally { await browser.close(); server.close(); }
