// Seed replay, cross-client body dimensions, independent demographic axes,
// all catalog variants, production model fitting and articulated gait.
import assert from 'node:assert/strict';
import { mkdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { generateCivilian } from '../public/js/civilianAppearance.js';
import { CIVILIAN_OPTIONS, CIVILIAN_OCCUPATIONS } from '../public/js/civilianContent.js';
import { CIVILIANS, hitH, hitR } from '../public/js/data.js';
import { chromiumOrNull, chromePath, serve, skipNoPlaywright } from './pw.mjs';
import { readSrc } from './audit_src.mjs';

assert.equal(CIVILIAN_OCCUPATIONS.length, CIVILIANS.length);
const seen = Object.fromEntries(Object.keys(CIVILIAN_OPTIONS).filter(k => k !== 'palette').map(k => [k, new Set()]));
const families = CIVILIANS.map(() => ({ genders: new Set(), occupations: new Set() }));
const samples = [];
for (let id = 1; id <= 6000; id++) {
  const prof = id % CIVILIANS.length;
  const a = generateCivilian(id, prof);
  assert.deepEqual(a, generateCivilian(id, prof), 'replay');
  for (const key of Object.keys(seen)) seen[key].add(a[key]);
  families[prof].genders.add(a.gender); families[prof].occupations.add(a.occupation);
  assert.ok(a.age >= 18 && a.age <= 85);
  assert.ok(a.waistCm >= 62 && a.waistCm <= 132);
  const client = JSON.parse(JSON.stringify({ id, civ: true, prof }));
  const server = { ...client, spy: true, cs: 'SWARM' };
  assert.equal(hitH(client), hitH(server)); assert.equal(hitR(client), hitR(server));
  if (samples.length < 96) samples.push(a);
}
for (const [key, values] of Object.entries(seen))
  assert.equal(values.size, new Set(CIVILIAN_OPTIONS[key]).size, `${key} coverage`);
for (const [i, family] of families.entries()) {
  assert.equal(family.genders.size, CIVILIAN_OPTIONS.gender.length, `profession ${i} gender independence`);
  assert.equal(family.occupations.size, CIVILIAN_OCCUPATIONS[i].length, `profession ${i} variations`);
}
for (const id of [undefined, NaN, Infinity, -1, 0, 0xffffffff]) {
  const a = generateCivilian(id, -21);
  assert.ok(Number.isFinite(a.heightScale) && Number.isFinite(a.waistCm));
}
const main = readSrc('public', 'js', 'main.js');
assert.ok(!/data-civprof|data-civfac|\['civ',\s*'平民'\]/.test(main), 'civilian encyclopedia controls removed');

const chromium = await chromiumOrNull();
if (!chromium) skipNoPlaywright('平民生成器瀏覽器量測');
const server = await serve();
let browser;
try {
  browser = await chromium.launch({ headless: true, executablePath: chromePath(),
    args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const page = await browser.newPage({ viewport: { width: 1200, height: 950 } });
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('console', msg => {
    if (/THREE.WebGLProgram: Shader Error|VALIDATE_STATUS|ERROR: 0:/.test(msg.text())) errors.push(msg.text());
  });
  if (process.env.THREE_MODULE) {
    const body = await readFile(process.env.THREE_MODULE, 'utf8');
    await page.route('**/three@0.160.0/build/three.module.js', r => r.fulfill({ contentType: 'text/javascript', body }));
    await page.route('**/three@0.160.0/examples/jsm/**', async r => {
      const name = r.request().url().split('/examples/jsm/')[1].replaceAll('/', '_');
      await r.fulfill({ contentType: 'text/javascript', body: await readFile(path.join(path.dirname(process.env.THREE_MODULE), name), 'utf8') });
    });
  }
  await page.route('**/main.js', r => r.fulfill({ contentType: 'text/javascript', body: '' }));
  await page.goto(server.url, { waitUntil: 'domcontentloaded' });
  const result = await page.evaluate(async samples => {
    const THREE = await import('three');
    const { makeUnit } = await import('/public/js/models.js');
    const { Pipeline } = await import('/public/js/postfx.js');
    const { generateCivilian } = await import('/public/js/civilianAppearance.js');
    const { hitH } = await import('/public/js/data.js');
    const { stepLocomotion } = await import('/public/js/locomotion.js');
    const { disposeTree, setCelSun, updateCelLight } = await import('/public/js/toon.js');
    const check = (v, msg) => { if (!v) throw Error(msg); };
    document.body.innerHTML = '';
    document.body.style.cssText = 'margin:0;display:grid;grid-template-columns:repeat(6,1fr);background:#d9d4ca;color:#222;font:12px sans-serif';
    const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
    renderer.setSize(198, 235); renderer.toneMapping = THREE.ACESFilmicToneMapping;
    setCelSun(new THREE.Vector3(0.4, 0.8, 0.4));
    let minHeight = Infinity, maxHeight = 0;
    for (const [index, expected] of samples.entries()) {
      check(JSON.stringify(generateCivilian(expected.seed, expected.family)) === JSON.stringify(expected), 'Node/browser replay differs');
      const mesh = makeUnit('civ', index % 2 ? 'SWARM' : 'STEEL', {
        ch: expected.family, appearanceSeed: expected.seed, ring: false,
      }).group;
      check(JSON.stringify(mesh.userData.appearance) === JSON.stringify(expected), 'makeUnit seed forwarding');
      mesh.updateWorldMatrix(true, true);
      const box = new THREE.Box3(), part = new THREE.Box3();
      mesh.traverse(n => {
        if (!n.isMesh || n.userData.isOutline) return;
        n.geometry.computeBoundingBox(); box.union(part.copy(n.geometry.boundingBox).applyMatrix4(n.matrixWorld));
      });
      const height = box.max.y - box.min.y;
      check(Math.abs(height - hitH({ id: expected.seed, civ: true })) < 1e-6, 'render/server height mismatch');
      check(Math.abs(box.min.y) < 1e-6, 'feet must start on ground');
      minHeight = Math.min(minHeight, height); maxHeight = Math.max(maxHeight, height);
      const ent = { id: expected.seed, mesh };
      for (let i = 0; i < 45; i++) stepLocomotion(ent, 1 / 60, i / 60, 0, -0.08, 0);
      const rig = mesh.userData.rig;
      check(rig.legChainL[0].g.parent === rig.legL && rig.armChainR[0].g.parent === rig.armR, 'limb ownership');
      mesh.updateWorldMatrix(true, true);
      mesh.traverse(n => check(n.matrixWorld.elements.every(Number.isFinite), 'finite gait'));
      if (index < 24) {
        const scene = new THREE.Scene(); scene.background = new THREE.Color(0xd9d4ca); scene.add(mesh);
        scene.add(new THREE.HemisphereLight(0xffffff, 0x777b83, 1.5));
        const sun = new THREE.DirectionalLight(0xffffff, 1.8); sun.position.set(4, 8, 6); scene.add(sun);
        const camera = new THREE.PerspectiveCamera(35, 198 / 235, 0.1, 100);
        camera.position.set(height * 0.8, height * 0.7, height * 2.2); camera.lookAt(0, height * 0.5, 0);
        camera.updateMatrixWorld(); updateCelLight(camera);
        const pipeline = new Pipeline(renderer, scene, camera, { ink: false, grade: false, dof: false, wipe: false });
        pipeline.render();
        const cell = document.createElement('div'), img = document.createElement('img'), label = document.createElement('div');
        img.src = renderer.domElement.toDataURL();
        label.textContent = `${expected.occupation} · ${expected.age} · ${expected.hairStyle} / ${expected.clothing}`;
        cell.append(img, label); document.body.append(cell);
        pipeline.dispose();
      }
      disposeTree(mesh);
    }
    renderer.dispose();
    return { models: samples.length, minHeight, maxHeight };
  }, samples);
  assert.deepEqual(errors, []);
  await mkdir('tools/.shots', { recursive: true });
  await page.screenshot({ path: 'tools/.shots/civilian-generator.png', fullPage: true });
  console.log('Civilian generator passed:', { profiles: 6000, occupations: CIVILIAN_OCCUPATIONS.flat().length, ...result });
} finally {
  await browser?.close(); server.close();
}
