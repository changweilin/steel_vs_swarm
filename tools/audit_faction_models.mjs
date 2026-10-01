// Executed faction models: deterministic shells, distinct geometry, authoritative height fitting,
// articulated damage, ordered muzzle contracts and bounded mesh/triangle budgets.
import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { chromiumOrNull, chromePath, serve, skipNoPlaywright } from './pw.mjs';

const chromium = await chromiumOrNull();
if (!chromium) skipNoPlaywright('Faction model rendering');
const out = path.resolve('tools/.shots/factions');
await mkdir(out, { recursive: true });
const server = await serve();
let browser;
try {
  browser = await chromium.launch({ headless: true, executablePath: chromePath(),
    args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const page = await browser.newPage({ viewport: { width: 1120, height: 920 }, deviceScaleFactor: 1 });
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  await page.route('https://fonts.googleapis.com/**', route => route.fulfill({ contentType: 'text/css', body: '' }));
  if (process.env.THREE_MODULE) {
    const body = await readFile(process.env.THREE_MODULE, 'utf8');
    await page.route('**/three@0.160.0/build/three.module.js', route => route.fulfill({ contentType: 'text/javascript', body }));
    await page.route('**/three@0.160.0/examples/jsm/**', async route => {
      const name = route.request().url().split('/examples/jsm/')[1].replaceAll('/', '_');
      const body = await readFile(path.join(path.dirname(process.env.THREE_MODULE), name), 'utf8');
      await route.fulfill({ contentType: 'text/javascript', body });
    });
  }
  await page.route('**/main.js', route => route.fulfill({ contentType: 'text/javascript', body: '' }));
  await page.goto(server.url, { waitUntil: 'domcontentloaded' });
  const report = await page.evaluate(async () => {
    const THREE = await import('three');
    const { makeUnit } = await import('/public/js/models.js');
    const { buildNpcModel } = await import('/public/js/npcModels.js');
    const { buildBuildingUnit, buildBaseBattery } = await import('/public/js/buildingUnitModels.js');
    const { TARGET_H } = await import('/public/js/data.js');
    const { applySceneDamage, releaseMobileDamage } = await import('/public/js/sceneDamage.js');
    const { disposeTree, setCelSun, updateCelLight } = await import('/public/js/toon.js');
    const { stepCombatFx, stepLocomotion } = await import('/public/js/locomotion.js');
    const { fireUnitMotion, stepUnitMotion } = await import('/public/js/unitMotion.js');
    const check = (ok, message) => { if (!ok) throw new Error(message); };
    const signature = (root, colours = true) => {
      root.updateMatrixWorld(true);
      const parts = [];
      root.traverse(node => {
        if (!node.isMesh || node.userData.isOutline) return;
        const position = node.geometry.attributes.position;
        check([...position.array].every(Number.isFinite), 'Non-finite geometry');
        check(node.matrixWorld.elements.every(Number.isFinite), 'Non-finite transform');
        parts.push([[...position.array], [...node.matrixWorld.elements],
          colours ? node.material.color.getHex() : null]);
      });
      return JSON.stringify(parts);
    };
    const measure = root => {
      root.updateMatrixWorld(true);
      const box = new THREE.Box3(), tmp = new THREE.Box3();
      root.traverse(node => {
        if (!node.isMesh || node.userData.isOutline || node.userData.noPaint) return;
        node.geometry.computeBoundingBox();
        box.union(tmp.copy(node.geometry.boundingBox).applyMatrix4(node.matrixWorld));
      });
      return box;
    };
    document.body.innerHTML = '';
    document.body.style.cssText = 'margin:0;padding:24px;background:#17212b;color:#e1e9ed;font:16px system-ui';
    const title = document.createElement('h1'); title.textContent = 'STEEL vs. SWARM / faction models';
    title.style.cssText = 'margin:0 0 20px;font-size:24px'; document.body.append(title);
    const mobile = document.createElement('main'), structures = document.createElement('main');
    mobile.id = 'npc'; structures.id = 'structures';
    for (const grid of [mobile, structures]) {
      grid.style.cssText = 'display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:20px';
      document.body.append(grid);
    }
    const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
    renderer.setSize(520, 350); renderer.setPixelRatio(1);
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    const scene = new THREE.Scene(); scene.background = new THREE.Color(0xc9cdc9);
    const hemisphere = new THREE.HemisphereLight(0xf5f3e9, 0x54636b, 1.5);
    const sun = new THREE.DirectionalLight(0xfff3dc, 2.0); sun.position.set(20, 40, 30);
    scene.add(hemisphere, sun); setCelSun(sun.position.clone().normalize());
    const roles = ['soldier', 'rocketeer', 'howitzer', 'apc', 'tank', 'heli', 'bunker', 'tower', 'base'];
    const report = [];
    for (const role of roles) {
      const geometry = [];
      for (const side of ['SWARM', 'STEEL']) {
        const kind = role === 'base' ? `base:${side}` : ['tower', 'bunker'].includes(role) ? role : `creep:${role}`;
        const build = () => ['tower', 'base'].includes(role) ? buildBuildingUnit(kind, side) : buildNpcModel(kind, side);
        const original = build(), replay = build();
        check(signature(original) === signature(replay), `${side}/${role}: nondeterministic model`);
        geometry.push(signature(original, false));
        disposeTree(original); disposeTree(replay);
        const model = makeUnit(kind, side, { ring: false }).group, rig = model.userData.rig;
        check(rig, `${side}/${role}: missing rig`);
        const box = measure(model), height = box.max.y - box.min.y;
        check(Math.abs(height - TARGET_H[kind]) < 0.08, `${side}/${role}: authoritative height drift ${height}`);
        if (role === 'tower') check(model.userData.turretMuzzles.length === (side === 'SWARM' ? 6 : 2), 'Tower muzzle ordering');
        if (role === 'base') {
          const battery = buildBaseBattery(side, height); model.add(battery);
          check(battery.userData.pivots.length === 2 && battery.userData.muzzles.length === 2, 'Base battery contract');
          rig.attacks = battery.userData.attacks;
        }
        let meshes = 0, triangles = 0;
        model.traverse(node => {
          if (!node.isMesh || node.userData.isOutline) return;
          check(!Object.hasOwn(node.material.defines ?? {}, 'CEL_PAINT'), `${side}/${role}: legacy full-body paint`);
          meshes++;
          triangles += (node.geometry.index?.count ?? node.geometry.attributes.position.count) / 3 * (node.isInstancedMesh ? node.count : 1);
        });
        check(meshes <= 160 && triangles <= 60000, `${side}/${role}: model budget exceeded`);
        const ent = { id: 101, kind: role, mesh: model, dimH: height, dimTop: box.max.y,
          dimR: Math.max(box.max.x - box.min.x, box.max.z - box.min.z) / 2 };
        if (kind.startsWith('creep:')) {
          const positions = [];
          model.traverse(node => { if (node.isMesh) positions.push([node, node.geometry, [...node.geometry.attributes.position.array]]); });
          applySceneDamage(ent, 2); applySceneDamage(ent, 0);
          for (const [node, geometry, vertices] of positions) {
            check(node.geometry === geometry && JSON.stringify([...geometry.attributes.position.array]) === JSON.stringify(vertices),
              `${side}/${role}: damage changed articulated geometry`);
          }
          releaseMobileDamage(ent);
        }
        for (let i = 0; i < 90; i++) {
          stepCombatFx(ent, 10 + i / 60, 1 / 60);
          stepLocomotion(ent, 1 / 60, 10 + i / 60, 0, 0, 0);
        }
        if (rig.attacks?.length) {
          const attack = rig.attacks[0], muzzle = attack.muzzles[0];
          fireUnitMotion(rig, muzzle, 12); stepUnitMotion(rig, 12.035);
          check(attack.node.position.z < 0, `${side}/${role}: no barrel recoil`);
          stepUnitMotion(rig, 14); check(attack.node.position.z === 0, `${side}/${role}: recoil drift`);
        }
        const bounds = measure(model), center = bounds.getCenter(new THREE.Vector3());
        const radius = bounds.getSize(new THREE.Vector3()).length() / 2;
        const camera = new THREE.PerspectiveCamera(36, 520 / 350, 0.01, 4000);
        const distance = radius / Math.sin(Math.PI / 10) * 1.08;
        const shots = {};
        for (const view of ['front', 'back', 'night', 'silhouette']) {
          const yaw = view === 'back' ? Math.PI * 0.8 : Math.PI * 0.2;
          camera.position.set(center.x + Math.sin(yaw) * distance * 0.95,
            center.y + distance * 0.3, center.z + Math.cos(yaw) * distance * 0.95);
          camera.lookAt(center); camera.updateMatrixWorld(true);
          const night = view === 'night'; hemisphere.intensity = night ? 0.24 : 1.5; sun.intensity = night ? 0.18 : 2.0;
          scene.background.set(night ? 0x18232d : 0xc9cdc9);
          const silhouette = new THREE.MeshBasicMaterial({ color: 0x20272d });
          if (view === 'silhouette') scene.overrideMaterial = silhouette;
          scene.add(model); updateCelLight(camera); renderer.render(scene, camera);
          shots[view] = renderer.domElement.toDataURL();
          scene.overrideMaterial = null; silhouette.dispose(); scene.remove(model);
        }
        const card = document.createElement('section'), label = document.createElement('div'), img = document.createElement('img');
        card.style.cssText = `border-top:3px solid ${side === 'SWARM' ? '#ffb300' : '#4fc3f7'};background:#25333f`;
        label.style.cssText = 'padding:9px 12px'; label.textContent = `${side} / ${role}`;
        img.src = shots.front; img.style.cssText = 'display:block;width:100%'; card.append(label, img);
        (['tower', 'base', 'bunker'].includes(role) ? structures : mobile).append(card);
        report.push({ side, role, height, meshes, triangles, shots }); disposeTree(model);
      }
      check(geometry[0] !== geometry[1], `${role}: factions differ only by colour`);
    }
    renderer.dispose();
    return report;
  });
  assert.deepEqual(errors, []);
  await page.locator('#npc').screenshot({ path: path.join(out, 'npc.png') });
  await page.locator('#structures').screenshot({ path: path.join(out, 'structures.png') });
  for (const row of report) for (const [view, url] of Object.entries(row.shots)) {
    await writeFile(path.join(out, `${row.side}-${row.role}-${view}.png`), Buffer.from(url.split(',')[1], 'base64'));
  }
  const cards = report.map(row => `<section><h2>${row.side} / ${row.role}</h2><img src="${row.side}-${row.role}-front.png" data-prefix="${row.side}-${row.role}" alt="${row.side} ${row.role}"></section>`).join('');
  await writeFile(path.join(out, 'index.html'), `<!doctype html><meta charset="utf-8"><title>Faction models</title>
<style>body{background:#17212b;color:#e1e9ed;font:16px system-ui;margin:24px}nav{position:sticky;top:0;background:#17212b;padding:12px 0}button{padding:8px 18px;margin-right:8px;cursor:pointer}main{display:grid;grid-template-columns:1fr 1fr;gap:16px}section{background:#25333f}h2{padding:0 12px;font-size:18px}img{display:block;width:100%}</style>
<h1>STEEL vs. SWARM / faction models</h1><nav>${['front', 'back', 'night', 'silhouette'].map(view => `<button data-view="${view}">${view}</button>`).join('')}</nav><main>${cards}</main>
<script>document.querySelector('nav').onclick=e=>{if(!e.target.dataset.view)return;document.querySelectorAll('img').forEach(img=>img.src=img.dataset.prefix+'-'+e.target.dataset.view+'.png');};</script>`);
  const summary = report.map(({ shots, ...row }) => row);
  await writeFile(path.join(out, 'report.json'), JSON.stringify(summary, null, 2));
  console.log('Faction models passed:', JSON.stringify(summary));
  console.log(`Visual review: ${path.join(out, 'index.html')}`);
} finally {
  await browser?.close(); server.close();
}
