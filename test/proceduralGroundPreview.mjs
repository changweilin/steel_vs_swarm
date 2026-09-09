// GPU verification using production builders. No runtime route or new dependency.
import { mkdir } from 'node:fs/promises';
import { chromiumOrNull, chromePath, serve } from '../tools/pw.mjs';
const chromium = await chromiumOrNull();
if (!chromium) throw new Error('Set PW_MODULE to an existing Playwright installation');
const server = await serve(8657);
const browser = await chromium.launch({ executablePath: chromePath(), headless: true,
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
try {
  const page = await browser.newPage({ viewport: { width: 1400, height: 1000 } });
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  await page.route('**/three.module.js', r => r.fulfill({ path: process.env.THREE_MODULE || 'out/forest_review/three.module.js', contentType: 'text/javascript' }));
  await page.route('**/BufferGeometryUtils.js', r => r.fulfill({ path: process.env.THREE_BUFFER_UTILS || 'out/forest_review/utils_BufferGeometryUtils.js', contentType: 'text/javascript' }));
  await page.route('**/Pass.js', r => r.fulfill({ path: process.env.THREE_PASS || 'out/forest_review/postprocessing_Pass.js', contentType: 'text/javascript' }));
  await page.route('**/__ground_preview', r => r.fulfill({ body: '<html></html>', contentType: 'text/html' }));
  await page.goto(new URL('__ground_preview', server.url).href);
  await page.setContent(`<html><style>body{margin:0;background:#c7d4d8}aside{position:absolute;top:20px;left:24px;font:16px sans-serif;color:#243744}h1{font-size:22px}</style><aside><h1>程序生成地表與附件</h1><p>平地場域 · 自然起伏 · 季節變體</p></aside><script type="importmap">{"imports":{"three":"${server.url}/three.module.js","three/addons/utils/BufferGeometryUtils.js":"${server.url}/BufferGeometryUtils.js","three/addons/postprocessing/Pass.js":"${server.url}/Pass.js"}}</script></html>`);
  const result = await page.evaluate(async base => {
    base = base.replace(/\/$/, '') + '/public';
    const THREE = await import('three');
    const { paintGround, surfaceEnvironment } = await import(base + '/js/proceduralGround.js');
    const { DEFS, SURFACES } = await import(base + '/js/groundCatalog.js');
    const { generateGroundPart } = await import(base + '/js/proceduralGroundParts.js');
    const { GROUND_ATTACHMENTS } = await import(base + '/js/groundPartCatalog.js');
    const { envMat } = await import(base + '/js/toon.js');
    const { Pipeline } = await import(base + '/js/postfx.js');
    const scene = new THREE.Scene(); scene.background = new THREE.Color(0xc7d4d8);
    scene.add(new THREE.HemisphereLight(0xffffff, 0x798675, .8));
    const light = new THREE.DirectionalLight(0xffffff, 1); light.position.set(-60, 120, 80); scene.add(light);
    const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
    renderer.setSize(1400, 1000); document.body.append(renderer.domElement);
    const camera = new THREE.PerspectiveCamera(42, 1.4, .1, 1200);
    camera.position.set(85, 125, 155); camera.lookAt(0, 0, 0);
    const ids = ['picnicLawn', 'mossGarden', 'forestLearning', 'grasslandCamp', 'safariRest', 'coastalRest', 'basaltExhibit', 'desertCamp', 'saltInterpretation', 'stargazingSite', 'clayWorkshop', 'miningHeritage'];
    for (let i = 0; i < ids.length; i++) {
      const id = ids[i], spec = SURFACES[id], x = (i % 4 - 1.5) * 34, z = (Math.floor(i / 4) - 1) * 32;
      const env = surfaceEnvironment({ season: id === 'icefield' ? 'winter' : 'summer', latitude: id === 'icefield' ? 70 : 25 });
      const canvas = document.createElement('canvas'); canvas.width = canvas.height = 512;
      paintGround(canvas.getContext('2d'), 512, id, 133 + i, env);
      if (i === 0) { canvas.style.cssText = `position:absolute;right:20px;top:20px;width:280px;height:${280 * spec.aspect}px`; document.body.append(canvas); }
      const tex = new THREE.CanvasTexture(canvas); tex.colorSpace = THREE.SRGBColorSpace;
      const width = 29, depth = width * (spec.aspect || DEFS[id].aspect || .8);
      const geo = new THREE.PlaneGeometry(width, depth, 20, 20).rotateX(-Math.PI / 2);
      const height = (lx, lz) => spec.flat ? 0 : Math.sin(lx * .22) * Math.cos(lz * .14) * 1.5;
      const p = geo.attributes.position;
      for (let n = 0; n < p.count; n++) p.setY(n, height(p.getX(n), p.getZ(n)));
      geo.computeVertexNormals();
      const tile = new THREE.Mesh(geo, envMat(0xffffff, { map: tex, wash: .3, cool: .4, rim: 0, preview: true })); tile.position.set(x, 0, z); scene.add(tile);
      const recipe = GROUND_ATTACHMENTS[id];
      const entries = recipe.fixed || spec.parts.slice(0, 3).map((type, n) => [type, (n - 1) * .24, .3, 0, 1]);
      for (const [type, u, v, heading, scale] of entries) {
        const px = u * width, pz = v * depth, s = scale * (recipe.referenceWidth ? width / recipe.referenceWidth : 1);
        for (const part of generateGroundPart(type, i % 3)) {
          const c = part.c === 'grass' ? 0x829c54 : part.c === 'foliage' ? 0x6e914e : part.c === 'palette' ? 0xc4aa74 : part.c;
          const mesh = new THREE.Mesh(part.geo, envMat(c, { wash: .3, cool: .4 }));
          mesh.position.set(x + px, height(px, pz), z + pz); mesh.rotation.y = heading; mesh.scale.setScalar(s); scene.add(mesh);
        }
      }
    }
    const pipeline = new Pipeline(renderer, scene, camera, { dof: false, grade: false });
    pipeline.render();
    return { samples: ids.length };
  }, server.url);
  await mkdir('out/ground_review', { recursive: true });
  await page.screenshot({ path: 'out/ground_review/procedural-ground.png' });
  const deployment = await page.evaluate(async base => {
    base = base.replace(/\/$/, '') + '/public';
    const THREE = await import('three');
    const { buildGroundCover } = await import(base + '/js/ground.js');
    const { mulberry32 } = await import(base + '/js/rng.js');
    const { Pipeline } = await import(base + '/js/postfx.js');
    document.querySelectorAll('canvas').forEach(c => c.remove());
    const scene = new THREE.Scene(); scene.background = new THREE.Color(0xc7d4d8);
    scene.add(new THREE.HemisphereLight(0xffffff, 0x798675, .8));
    const light = new THREE.DirectionalLight(0xffffff, 1); light.position.set(-60, 120, 80); scene.add(light);
    const renderer = new THREE.WebGLRenderer({ antialias: true }); renderer.setSize(1400, 1000); document.body.append(renderer.domElement);
    const camera = new THREE.PerspectiveCamera(42, 1.4, .1, 1500);
    camera.position.set(180, 300, 360); camera.lookAt(0, 20, 0);
    const group = new THREE.Group(); scene.add(group);
    const heightAt = (x, z) => x < 0 ? 20 : 20 + Math.sin(x * .015) ** 2 * 9;
    const terrain = { minX: -160, maxX: 160, minZ: -160, maxZ: 160, worldW: 320, worldH: 320, gridM: 4,
      heightAt, elevationAt: () => 150, center: { lat: 25 } };
    const stats = buildGroundCover(group, terrain, { isBlocked: () => false,
      classifyAt: (x) => x < 0 ? 'urban' : 'green', classifyPureAt: (x) => x < 0 ? 'urban' : 'green',
      blockers: [], season: 'summer', seed: 7123, rnd: mulberry32(7123) });
    const pipeline = new Pipeline(renderer, scene, camera, { dof: false, grade: false }); pipeline.render();
    if (!stats.patches || !stats.details) throw new Error('Empty runtime deployment');
    return { patches: stats.patches, details: stats.details, meshes: group.children.length };
  }, server.url);
  await page.screenshot({ path: 'out/ground_review/runtime-ground.png' });
  if (errors.length) throw new Error(errors.join('\n'));
  console.log(JSON.stringify({ preview: result, deployment }));
} finally { await browser.close(); await server.close(); }
