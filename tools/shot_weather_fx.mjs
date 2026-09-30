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
    const { makeClouds, makeFog, makeParticles, makeLightningSystem } = await import('/public/js/weatherFx.js');
    const { resolveWeatherVisuals } = await import('/public/js/weatherVisuals.js');
    const { applyEnvironment } = await import('/public/js/environment.js');
    const { resolveWeatherDynamics, WEATHER_DEBUFFS } = await import('/public/js/data.js');
    const { envMat, updateCelLight, disposeTree, setWeatherDynamics, stepCelWind, seaSoft, swampSoft, seaSegM } = await import('/public/js/toon.js');
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
    const fogTerrain = { heightAt: () => 0, waterY: -5 };
    const setup = lowPower => {
      const clouds = makeClouds(320, 42, { lowPower }), particles = makeParticles(42, { lowPower }), lightning = makeLightningSystem(42);
      const fog = makeFog(fogTerrain, 42, { lowPower });
      scene.add(clouds.obj, fog.obj, particles.obj, lightning.obj);
      return { clouds, fog, particles, lightning, dispose() {
        scene.remove(clouds.obj, fog.obj, particles.obj, lightning.obj); clouds.dispose(); fog.dispose(); particles.dispose(); lightning.dispose();
      } };
    };
    const step = (fx, dyn, profile, frames = 120) => {
      for (let i = 0; i < frames; i++) {
        fx.clouds.obj.position.copy(camera.position);
        fx.clouds.step(i / 60, 1 / 60, scene.background, dyn, profile.clouds);
        fx.particles.update(1 / 60, camera, dyn, profile);
        fx.fog.update(1 / 60, camera, dyn, profile.fog, scene.fog.color);
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
    camera.lookAt(0, 5, -70); camera.updateMatrixWorld();
    for (const strength of [.15, .55, 1]) {
      const fx = setup(false);
      const dyn = resolveWeatherDynamics({ fog: 75 + strength * 25, wind: 55, clouds: 30 });
      const profile = resolveWeatherVisuals(dyn);
      step(fx, dyn, profile); draw(`fog_${Math.round(strength * 100)}`);
      const first = captures.at(-1).image; fx.dispose();
      const replay = setup(false); step(replay, dyn, profile); pipeline.render();
      check(renderer.domElement.toDataURL() === first, 'Fog scatter changed on replay');
      camera.position.x += 300; camera.position.y += 70;
      step(replay, dyn, profile, 1); pipeline.render();
      const origins = replay.fog.obj.geometry.attributes.aOrigin;
      for (let i = 0; i < origins.count; i++) {
        check(Math.abs(origins.getX(i) - camera.position.x) <= replay.fog.obj.material.uniforms.uRange.value, 'Fog bank failed to recycle');
        check(origins.getY(i) === 0, 'Fog followed camera altitude instead of terrain');
      }
      camera.position.x -= 300; camera.position.y -= 70;
      step(replay, {}, resolveWeatherVisuals(), 300); pipeline.render();
      check(!replay.fog.obj.visible, 'Clear weather retained fog banks'); replay.dispose();
    }
    let fogSamples = 0;
    const omittedFog = makeFog({ heightAt: () => { fogSamples++; return NaN; } }, 42);
    const fullFog = resolveWeatherVisuals({ effectiveFog: 1 }).fog;
    omittedFog.update(.1, camera, {}, fullFog, scene.fog.color);
    const samples = fogSamples;
    omittedFog.update(.1, camera, {}, fullFog, scene.fog.color);
    check(samples > 0 && samples === fogSamples, 'Fog resampled unchanged terrain tiles');
    check(omittedFog.obj.geometry.attributes.aSeed.array.every((v, i) => i % 3 !== 2 || v === 0), 'Invalid terrain produced fog banks');
    check(omittedFog.obj.geometry.attributes.aOrigin.array.every(Number.isFinite), 'Failed fog samples reached the GPU');
    omittedFog.dispose();
    camera.lookAt(0, 30, -70); camera.updateMatrixWorld();
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
    check(low.fog.obj.geometry.instanceCount < normal.fog.obj.geometry.instanceCount, 'Low-power fog budget did not shrink');
    const mixedDyn = { effectiveRain: 1, effectiveSnow: 1, effectiveSand: 1, clouds: 100, wind: 100, windAmp: 2.7, windDir: [1, 0] };
    const mixedProfile = resolveWeatherVisuals(mixedDyn); step(low, mixedDyn, mixedProfile);
    normal.clouds.obj.visible = normal.particles.obj.visible = false;
    draw('mixed_low_power'); normal.dispose(); low.dispose();
    const plants = new THREE.Group();
    for (const [x, z] of [[-24, -12], [0, -35], [25, -55]]) {
      const trunkGeo = new THREE.CylinderGeometry(.35, .7, 10, 8, 8); trunkGeo.translate(0, 5, 0);
      const crownGeo = new THREE.SphereGeometry(4, 12, 10); crownGeo.scale(1, 1.5, 1); crownGeo.translate(0, 11, 0);
      const trunk = new THREE.Mesh(trunkGeo, envMat(0x67523c, { soft: { k: 'wood', span: 16 } }));
      const crown = new THREE.Mesh(crownGeo, envMat(0x68834d, { soft: { k: 'leaf', span: 16 } }));
      trunk.position.set(x, 0, z); crown.position.copy(trunk.position); plants.add(trunk, crown);
    }
    const flagGeo = new THREE.PlaneGeometry(8, 4, 16, 4); flagGeo.translate(4, 10, 0);
    const flag = new THREE.Mesh(flagGeo, envMat(0xc7593c, { soft: { k: 'cloth', span: 8 }, side: THREE.DoubleSide }));
    flag.position.set(-12, 0, 0); plants.add(flag); scene.add(plants);
    let flagShader;
    const compileFlag = flag.material.onBeforeCompile;
    flag.material.onBeforeCompile = (shader, renderer) => { compileFlag(shader, renderer); flagShader = shader; };
    camera.lookAt(0, 8, -35); camera.updateMatrixWorld(); pipeline.render();
    const windClock = flagShader.uniforms.uWeatherWindT;
    const phaseBefore = windClock.value;
    setWeatherDynamics(resolveWeatherDynamics({ wind: 100 }));
    check(windClock.value === phaseBefore, 'Changing wind reset animation phase');
    stepCelWind(1 / 60);
    check(Math.abs(windClock.value - phaseBefore - 2 / 60) < 1e-9, 'Wind animation ignored its resolved rate');
    for (const wind of [0, 50, 100]) {
      setWeatherDynamics(resolveWeatherDynamics({ wind })); windClock.value = 7;
      flagShader.uniforms.uWeatherGustT.value = 7;
      draw(`wind_${wind}`);
    }
    scene.remove(plants); disposeTree(plants);
    ground.visible = false;
    camera.position.set(0, 14, 55); camera.lookAt(0, 0, -45); camera.updateMatrixWorld();
    for (const kind of ['sea', 'swamp']) {
      const waterGeo = new THREE.PlaneGeometry(220, 260, Math.ceil(220 / seaSegM()), Math.ceil(260 / seaSegM()));
      waterGeo.rotateX(-Math.PI / 2);
      waterGeo.setAttribute('seaFade', new THREE.BufferAttribute(new Float32Array(waterGeo.attributes.position.count).fill(1), 1));
      const water = new THREE.Mesh(waterGeo, envMat(kind === 'sea' ? 0x4e879e : 0x66805a,
        { soft: kind === 'sea' ? seaSoft() : swampSoft(), rim: 0, side: THREE.DoubleSide }));
      let waterShader;
      const compileWater = water.material.onBeforeCompile;
      water.material.onBeforeCompile = (shader, renderer) => { compileWater(shader, renderer); waterShader = shader; };
      scene.add(water); pipeline.render();
      const waveClock = waterShader.uniforms.uWeatherWaveT;
      for (const wind of [0, 50, 100]) {
        setWeatherDynamics(resolveWeatherDynamics({ wind })); waveClock.value = 7;
        draw(`${kind}_${wind}`);
      }
      const phase = waveClock.value;
      setWeatherDynamics(resolveWeatherDynamics({ wind: 100, snow: 100, clouds: 100 }));
      for (let i = 0; i < 120; i++) stepCelWind(1 / 60);
      check(waveClock.value === phase && waterShader.uniforms.uWeatherWaveAmp.value === 0, 'Frozen water kept moving');
      draw(`${kind}_frozen`);
      setWeatherDynamics(resolveWeatherDynamics({ wind: 50 }));
      stepCelWind(1 / 60);
      check(Math.abs(waveClock.value - phase - 1.3 / 60) < 1e-9, 'Water animation ignored waveSpeed');
      const start = waveClock.value;
      for (let i = 0; i < 30; i++) stepCelWind(1 / 30);
      const thirty = waveClock.value - start; waveClock.value = start;
      for (let i = 0; i < 120; i++) stepCelWind(1 / 120);
      check(Math.abs(waveClock.value - start - thirty) < 1e-9, 'Wave animation depends on frame rate');
      scene.remove(water); disposeTree(water);
    }
    ground.visible = true;
    camera.position.set(0, 12, 55); camera.lookAt(0, 30, -70); camera.updateMatrixWorld();
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
  await mkdir(output, { recursive: true });
  for (const capture of result.captures) await writeFile(`${output}/${capture.name}.png`, Buffer.from(capture.image.split(',')[1], 'base64'));
  await writeFile(`${output}/stats.json`, JSON.stringify(result.stats, null, 2));
  const figures = result.captures.map(c => `<figure><img src="${c.name}.png"><figcaption>${c.name.replaceAll('_', ' ')}</figcaption></figure>`).join('');
  await writeFile(`${output}/index.html`, `<!doctype html><html lang="en"><meta charset="utf-8"><title>Weather FX review</title><style>body{margin:24px;background:#182027;color:#eef2f5;font:16px system-ui}main{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:18px}figure{margin:0}img{width:100%}figcaption{padding:8px;text-transform:capitalize}</style><h1>Weather FX intensity review</h1><main>${figures}</main></html>`);
  const identical = result.captures.map(c => result.captures.filter(other => other.image === c.image).map(other => other.name)).filter(names => names.length > 1);
  assert.equal(new Set(result.captures.map(c => c.image)).size, result.captures.length, `Different intensities must render distinct frames: ${JSON.stringify(identical)}`);
  console.log(`${result.captures.length} distinct frames; seeded replay, camera movement, transitions, simultaneous lightning, low-power and GPU teardown passed.`);
} finally { await browser.close(); server.close(); }
