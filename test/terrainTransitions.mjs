// Render the shipped land shader: natural colour transitions, protected water/road edges,
// missing appearance data and repeated texture replacement. No copied palette or shader.
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { chromiumOrNull, chromePath } from '../tools/pw.mjs';
import { readSrc } from '../tools/audit_src.mjs';
import { serve } from './architecturePreview.mjs';

const directory = new URL('../out/boundary_review/surfaces/', import.meta.url);
await mkdir(directory, { recursive: true });
const chromium = await chromiumOrNull();
assert(chromium, 'Terrain transition review requires an existing Playwright runtime');
const server = serve(0);
await new Promise(resolve => server.once('listening', resolve));
let browser;
try {
  browser = await chromium.launch({ executablePath: chromePath(), headless: true,
    args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const page = await browser.newPage({ viewport: { width: 1100, height: 1100 } });
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('console', m => { if (/Shader Error|ERROR: 0:/.test(m.text())) errors.push(m.text()); });
  const url = 'http://127.0.0.1:' + server.address().port;
  await page.route(url + '/three.mjs', route => route.fulfill({ contentType: 'text/javascript', body: readSrc('out', 'forest_review', 'three.module.js') }));
  await page.route(url + '/public/js/**', route => route.fulfill({ contentType: 'text/javascript', body: readSrc('public', 'js', new URL(route.request().url()).pathname.slice(11)) }));
  await page.route(url + '/', route => route.fulfill({ contentType: 'text/html', body:
    '<script type="importmap">{"imports":{"three":"/three.mjs"}}</script><style>body{background:#dce3e5;font:16px sans-serif;margin:20px}main{display:grid;grid-template-columns:repeat(3,1fr);gap:16px}figure{margin:0}img{width:100%}</style><main></main>' }));
  await page.goto(url);
  const result = await page.evaluate(async () => {
    const THREE = await import('three');
    const { envMat, setLandField, updateCelLight, setCelSun } = await import('/public/js/toon.js');
    const { LAND_ZONES } = await import('/public/js/landfield.js');
    const renderer = new THREE.WebGLRenderer({ antialias: false, preserveDrawingBuffer: true });
    renderer.setSize(320, 120);
    const scene = new THREE.Scene();
    scene.add(new THREE.HemisphereLight(0xffffff, 0xffffff, 1));
    const sun = new THREE.DirectionalLight(0xffffff, 1); sun.position.set(0, 30, 0); scene.add(sun); setCelSun(sun.position);
    const camera = new THREE.OrthographicCamera(-16, 16, 6, -6, .1, 100);
    camera.position.set(0, 30, 0); camera.up.set(0, 0, -1); camera.lookAt(0, 0, 0); updateCelLight(camera);
    const geometry = new THREE.PlaneGeometry(32, 12).rotateX(-Math.PI / 2);
    const material = envMat(0xffffff, { landField: true, rim: 0 });
    scene.add(new THREE.Mesh(geometry, material));
    const bounds = { minX: -16, maxX: 16, minZ: -6, maxZ: 6 };
    const render = (a, b, road = false, neutral = false) => {
      const data = new Uint8Array([a, 0, 128, road ? 255 : 0, b, 0, 128, 0]);
      setLandField(neutral ? data.slice(0, 4) : data, neutral ? 1 : 2, 1, bounds);
      renderer.render(scene, camera);
      const pixels = new Uint8Array(320 * 4);
      renderer.getContext().readPixels(0, 60, 320, 1, renderer.getContext().RGBA, renderer.getContext().UNSIGNED_BYTE, pixels);
      return { pixels: Array.from(pixels), image: renderer.domElement.toDataURL() };
    };
    const solid = LAND_ZONES.map((_, zone) => render(zone, zone).pixels);
    const report = [];
    for (let a = 0; a < LAND_ZONES.length; a++) for (let b = a + 1; b < LAND_ZONES.length; b++) {
      const capture = render(a, b);
      if (!capture.pixels.some((v, i) => i % 4 !== 3 && v > 20)) throw new Error('Blank terrain shader');
      const middle = capture.pixels.slice(120 * 4, 200 * 4);
      const difference = reference => middle.some((v, i) => i % 4 !== 3 && Math.abs(v - reference[120 * 4 + i]) > 2);
      if (a > 0 && (!difference(solid[a]) || !difference(solid[b]))) throw new Error('Natural transition collapsed to a category');
      if (a === 0) for (const x of [130, 190]) for (let channel = 0; channel < 3; channel++)
        if (capture.pixels[x * 4 + channel] !== solid[x < 160 ? a : b][x * 4 + channel]) throw new Error('Water boundary colour leaked');
      const figure = document.createElement('figure'), img = document.createElement('img'), label = document.createElement('figcaption');
      img.src = capture.image; label.textContent = LAND_ZONES[a] + ' / ' + LAND_ZONES[b];
      figure.append(img, label); document.querySelector('main').append(figure);
      report.push([LAND_ZONES[a], LAND_ZONES[b]]);
    }
    const road = render(2, 3, true), greenRoad = render(2, 2, true), bare = render(3, 3);
    for (const x of [130, 190]) for (let channel = 0; channel < 3; channel++)
      if (road.pixels[x * 4 + channel] !== (x < 160 ? greenRoad : bare).pixels[x * 4 + channel]) throw new Error('Built footprint colour leaked');
    const neutral = render(2, 2, false, true);
    if (neutral.pixels.some((v, i) => Math.abs(v - solid[2][i]) > 1)) throw new Error('Neutral or missing appearance changed the palette');
    const textures = renderer.info.memory.textures;
    if (textures > 8) throw new Error('Land texture replacements leaked');
    geometry.dispose(); material.dispose(); renderer.dispose();
    return { pairs: report, textures };
  });
  assert.deepEqual(errors, []);
  await page.screenshot({ path: fileURLToPath(new URL('terrain-transitions.png', directory)), fullPage: true });
  await writeFile(new URL('review.json', directory), JSON.stringify(result, null, 2));
  console.log('PASS terrain transitions:', JSON.stringify(result));
} finally { await browser?.close(); server.close(); }
