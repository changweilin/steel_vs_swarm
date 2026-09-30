// WebGL validation covers intensity, replay, transitions, pooled strikes, MRT and GPU ownership.
import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { chromiumOrNull, chromePath, serve } from './pw.mjs';

const chromium = await chromiumOrNull();
assert(chromium, 'Weather visual validation requires an existing Playwright runtime');
const server = await serve();
const browser = await chromium.launch({ headless: true, executablePath: chromePath() });
const output = 'out/weather_fx_review';
try {
  const page = await browser.newPage({ viewport: { width: 960, height: 640 } });
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('console', e => { if (e.type() === 'error') errors.push(e.text()); });
  await page.route('**/main.js', r => r.fulfill({ contentType: 'text/javascript', body: '' }));
  await page.route('https://fonts.googleapis.com/**', r => r.fulfill({ contentType: 'text/css', body: '' }));
  for (const [key, route] of [['THREE_MODULE', '**/three@0.160.0/build/three.module.js'], ['THREE_PASS', '**/postprocessing/Pass.js']]) {
    if (!process.env[key]) continue;
    const body = await readFile(process.env[key], 'utf8');
    await page.route(route, r => r.fulfill({ contentType: 'text/javascript', body }));
  }
  await page.goto(server.url, { waitUntil: 'domcontentloaded' });
  const result = await page.evaluate(async () => {
    const THREE = await import('three');
    const { makeClouds, makeParticles, makeLightningSystem } = await import('/public/js/weatherFx.js');
    const { resolveWeatherVisuals } = await import('/public/js/weatherVisuals.js');
    const { applyEnvironment } = await import('/public/js/environment.js');
    const { resolveWeatherDynamics, WEATHER_DEBUFFS } = await import('/public/js/data.js');
    const { envMat, updateCelLight, disposeTree } = await import('/public/js/toon.js');
    const { setSurfaceWeather } = await import('/public/js/weatherMaterial.js');
    const { Pipeline } = await import('/public/js/postfx.js');
    const check = (value, message) => { if (!value) throw new Error(message); };
    document.body.innerHTML = '';
    const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
    renderer.info.autoReset = false;
    renderer.setSize(960, 640); document.body.appendChild(renderer.domElement);
    const scene = new THREE.Scene(); scene.background = new THREE.Color(0x7998b2);
    scene.fog = new THREE.Fog(0x96adbf, 120, 600);
    scene.add(new THREE.HemisphereLight(0xc3dcf2, 0x716959, 2));
    const sun = new THREE.DirectionalLight(0xffeed2, 2); sun.position.set(-60, 100, 30); scene.add(sun);
    const camera = new THREE.PerspectiveCamera(55, 1.5, .1, 1500);
    camera.position.set(0, 12, 55); camera.lookAt(0, 30, -70); camera.updateMatrixWorld(); updateCelLight(camera);
    const ground = new THREE.Mesh(new THREE.PlaneGeometry(600, 600), envMat(0x7c8266, { rim: 0, land: true }));
    ground.rotation.x = -Math.PI / 2; scene.add(ground);
    for (const [x, z, height] of [[-38, -30, 20], [34, -64, 28], [-70, -96, 15]]) {
      const building = new THREE.Mesh(new THREE.BoxGeometry(20, height, 20), envMat(0xa29d92));
      building.position.set(x, height / 2, z); scene.add(building);
    }
    const pipeline = new Pipeline(renderer, scene, camera, { grade: false, fxaa: false });
    const captures = [], stats = [];
    const setup = lowPower => {
      const clouds = makeClouds(320, 42, { lowPower }), particles = makeParticles(42, { lowPower }), lightning = makeLightningSystem(42);
      scene.add(clouds.obj, particles.obj, lightning.obj);
      return { clouds, particles, lightning, dispose() {
        scene.remove(clouds.obj, particles.obj, lightning.obj); clouds.dispose(); particles.dispose(); lightning.dispose();
      } };
    };
    const step = (fx, dyn, profile, frames = 120) => {
      for (let i = 0; i < frames; i++) {
        fx.clouds.obj.position.copy(camera.position);
        fx.clouds.step(i / 60, 1 / 60, scene.background, dyn, profile.clouds);
        fx.particles.update(1 / 60, camera, dyn, profile);
        fx.lightning.update(1 / 60, camera);
      }
    };
    const draw = name => {
      camera.updateMatrixWorld(); updateCelLight(camera); renderer.info.reset(); pipeline.render();
      captures.push({ name, image: renderer.domElement.toDataURL() });
    };
    const warm = setup(false), cool = setup(false);
    let disposedTexture = false;
    warm.clouds.obj.children[0].material.map.addEventListener('dispose', () => { disposedTexture = true; });
    warm.dispose(); check(disposedTexture, 'Cloud texture was not released');
    check(cool.clouds.obj.children[0].material.map !== warm.clouds.obj.children[0].material.map, 'Environments share disposable cloud textures');
    cool.dispose();
    for (const kind of ['rain', 'snow', 'sand']) for (const strength of [.15, .55, 1]) {
      const fx = setup(false);
      const dyn = { clouds: kind === 'sand' ? 30 : 100, cloudDarkness: kind === 'sand' ? 0 : .8,
        wind: strength === 1 ? 100 : 32, windAmp: strength === 1 ? 2.7 : 1.2, windDir: [.85, .52],
        [`effective${kind[0].toUpperCase()}${kind.slice(1)}`]: strength };
      const profile = resolveWeatherVisuals(dyn);
      setSurfaceWeather(kind === 'snow' ? { snow: strength * .9 } : kind === 'rain' ? { water: strength * .8 } : { sand: strength * .8 });
      step(fx, dyn, profile); const name = `${kind}_${Math.round(strength * 100)}`; draw(name);
      const layer = fx.particles.obj.children.find(n => n.name === `${kind}-particles`);
      stats.push({ name, particles: layer.geometry.instanceCount, veil: profile[kind].veil, calls: renderer.info.render.calls });
      for (const node of fx.particles.obj.children) {
        const travel = node.material.uniforms.uTravel.value;
        check([travel.x, travel.y, travel.z].every(Number.isFinite), 'Nonfinite particle advection');
      }
      if (strength === .55) {
        const first = captures.at(-1).image; fx.dispose();
        const replay = setup(false); step(replay, dyn, profile); pipeline.render();
        check(renderer.domElement.toDataURL() === first, `${kind} scatter changed on replay`);
        camera.position.x += 300; camera.position.y += 70;
        step(replay, dyn, profile, 1); pipeline.render();
        check(replay.particles.obj.position.equals(camera.position), 'Particle volume did not follow camera');
        camera.position.x -= 300; camera.position.y -= 70;
        step(replay, {}, resolveWeatherVisuals(), 300); pipeline.render();
        check(replay.particles.obj.children.every(n => !n.visible), 'Calm weather retained precipitation');
        replay.dispose();
      } else fx.dispose();
    }
    setSurfaceWeather({});
    for (const [name, dyn] of Object.entries({
      cirrus: { clouds: 25, windAmp: 1 }, cumulus: { clouds: 50, windAmp: 1 },
      stratus: { clouds: 95, cloudDarkness: .9, fog: 25, windAmp: 1 },
      cumulonimbus: { clouds: 100, cloudDarkness: 1, effectiveThunder: 1, windAmp: 1.8 },
    })) {
      const fx = setup(false); step(fx, dyn, resolveWeatherVisuals(dyn)); draw(name); fx.dispose();
    }
    for (const strength of [.15, 1]) {
      const fx = setup(false), dyn = { clouds: 100, cloudDarkness: .9, effectiveThunder: strength, windAmp: 1 };
      const profile = resolveWeatherVisuals(dyn); step(fx, dyn, profile);
      check(!fx.lightning.strike(new THREE.Vector3(NaN, 2, 1), new THREE.Vector3(), profile.lightning), 'Invalid strike accepted');
      for (const x of [-20, 0, 20]) check(fx.lightning.strike(new THREE.Vector3(x - 10, 110, -55), new THREE.Vector3(x, 0, -35), profile.lightning), 'Strike rejected');
      check(fx.lightning.update(1 / 60, camera) > 0, 'Strike produced no flash');
      check(fx.lightning.obj.children.filter(n => n.visible).length === WEATHER_DEBUFFS.LIGHTNING.MAX_TARGETS, 'Simultaneous strikes overwrote each other');
      fx.lightning.strike(new THREE.Vector3(-45, 100, -55), new THREE.Vector3(-35, 0, -40), profile.lightning);
      fx.lightning.update(0, camera);
      check(fx.lightning.obj.children.filter(n => n.visible).length === WEATHER_DEBUFFS.LIGHTNING.MAX_TARGETS + 1, 'Surface strike overwrote a simultaneous unit strike');
      draw(`lightning_${Math.round(strength * 100)}`);
      fx.lightning.update(1, camera); check(fx.lightning.obj.children.every(n => !n.visible), 'Expired lightning remained visible'); fx.dispose();
    }
    const normal = setup(false), low = setup(true);
    for (let i = 0; i < low.particles.obj.children.length; i++) {
      check(low.particles.obj.children[i].geometry.attributes.aSeed.count < normal.particles.obj.children[i].geometry.attributes.aSeed.count, 'Low-power budget did not shrink');
    }
    const mixedDyn = { effectiveRain: 1, effectiveSnow: 1, effectiveSand: 1, clouds: 100, wind: 100, windAmp: 2.7, windDir: [1, 0] };
    const mixedProfile = resolveWeatherVisuals(mixedDyn); step(low, mixedDyn, mixedProfile);
    normal.clouds.obj.visible = normal.particles.obj.visible = false;
    draw('mixed_low_power'); normal.dispose(); low.dispose();
    const terrain = { worldW: 320, worldH: 320, minX: -160, maxX: 160, minZ: -160, maxZ: 160,
      center: { lat: 25, lng: 121 }, heightAt: () => 0, waterY: -5 };
    const environment = applyEnvironment(scene, terrain, { season: 'winter', time: 'day', weather: 'snow' }, { backgroundOnly: true });
    for (let i = 0; i < 90; i++) environment.update(1 / 60, camera, i / 60);
    environment.strikeLightningAt(0, 0, -40); environment.update(1 / 60, camera, 1.5); draw('environment_snow');
    check(environment.getWeatherDynamics().effectiveSnow === resolveWeatherDynamics(environment.weatherVec).effectiveSnow, 'Visual integration changed weather authority');
    environment.dispose(); pipeline.render();
    const battle = applyEnvironment(scene, terrain, { season: 'summer', time: 'day', weather: 'storm' });
    for (let i = 0; i < 600; i++) battle.update(1 / 60, camera, i / 60);
    const battleBolts = scene.children.find(n => n.name === 'weather-lightning');
    check(battleBolts.children.every(n => !n.visible), 'Battle rendered lightning without server events');
    battle.strikeLightningAt(0, 0, -40); battle.update(1 / 60, camera, 10);
    check(battleBolts.children.some(n => n.visible), 'Server strike did not reach battle renderer');
    draw('environment_storm'); battle.dispose(); pipeline.render();
    const baseline = { ...renderer.info.memory };
    for (let i = 0; i < 3; i++) {
      const fx = setup(false); step(fx, mixedDyn, mixedProfile, 5); pipeline.render(); fx.dispose(); pipeline.render();
      check(renderer.info.memory.geometries === baseline.geometries && renderer.info.memory.textures === baseline.textures, 'Weather teardown leaked GPU memory');
    }
    const programs = renderer.info.programs.map(p => ({ runnable: p.diagnostics?.runnable, log: p.diagnostics?.programLog }));
    pipeline.dispose(); disposeTree(scene); renderer.dispose(); return { captures, programs, stats };
  });
  assert.deepEqual(errors, []);
  assert(result.programs.every(p => p.runnable !== false), JSON.stringify(result.programs));
  assert.equal(new Set(result.captures.map(c => c.image)).size, result.captures.length, 'Different intensities must render distinct frames');
  await mkdir(output, { recursive: true });
  for (const capture of result.captures) await writeFile(`${output}/${capture.name}.png`, Buffer.from(capture.image.split(',')[1], 'base64'));
  await writeFile(`${output}/stats.json`, JSON.stringify(result.stats, null, 2));
  const figures = result.captures.map(c => `<figure><img src="${c.name}.png"><figcaption>${c.name.replaceAll('_', ' ')}</figcaption></figure>`).join('');
  await writeFile(`${output}/index.html`, `<!doctype html><html lang="en"><meta charset="utf-8"><title>Weather FX review</title><style>body{margin:24px;background:#182027;color:#eef2f5;font:16px system-ui}main{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:18px}figure{margin:0}img{width:100%}figcaption{padding:8px;text-transform:capitalize}</style><h1>Weather FX intensity review</h1><main>${figures}</main></html>`);
  console.log(`${result.captures.length} distinct frames; seeded replay, camera movement, transitions, simultaneous lightning, low-power and GPU teardown passed.`);
} finally { await browser.close(); server.close(); }
