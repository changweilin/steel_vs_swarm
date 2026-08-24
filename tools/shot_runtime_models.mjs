// 正式場景模型視覺閉環：v5/v6 建築、v6 載具、NPC 與戰鬥建築同頁檢查。
// 用法：node tools/shot_runtime_models.mjs [--out tools/.shots/runtime-models.png]
import fs from 'node:fs';
import path from 'node:path';
import { chromiumOrNull, chromePath, skipNoPlaywright } from './pw.mjs';

const arg = (key, fallback) => {
  const i = process.argv.indexOf(key);
  return i >= 0 ? process.argv[i + 1] : fallback;
};
const out = path.resolve(arg('--out', 'tools/.shots/runtime-models.png'));
const chromium = await chromiumOrNull();
if (!chromium) skipNoPlaywright('正式場景模型');
fs.mkdirSync(path.dirname(out), { recursive: true });

const browser = await chromium.launch({
  executablePath: chromePath(),
  args: ['--use-gl=angle'],
  env: { ...process.env, CHROME_LOG_FILE: path.join(path.dirname(out), 'chromium.log') },
});
const page = await browser.newPage({ viewport: { width: 1440, height: 1040 }, deviceScaleFactor: 1 });
const errors = [];
page.on('pageerror', (error) => errors.push(error.message));
page.on('console', (message) => { if (message.type() === 'error') errors.push(message.text()); });
page.on('requestfailed', (request) => console.error(`REQUESTFAILED ${request.url()}: ${request.failure()?.errorText}`));
if (process.env.THREE_MODULE && fs.existsSync(process.env.THREE_MODULE)) {
  const threeSource = fs.readFileSync(process.env.THREE_MODULE, 'utf8');
  const corePath = path.join(path.dirname(process.env.THREE_MODULE), 'three.core.js');
  await page.route('**/__three.module.js', (route) => route.fulfill({
    status: 200,
    contentType: 'text/javascript',
    body: threeSource,
  }));
  if (fs.existsSync(corePath)) {
    const coreSource = fs.readFileSync(corePath, 'utf8');
    await page.route('**/three.core.js', (route) => route.fulfill({
      status: 200,
      contentType: 'text/javascript',
      body: coreSource,
    }));
  }
  await page.route('http://localhost:8620/', (route) => route.fulfill({
    status: 200,
    contentType: 'text/html',
    body: '<!doctype html><meta charset="utf-8"><script type="importmap">{"imports":{"three":"/__three.module.js"}}</script><body></body>',
  }));
}
await page.goto('http://localhost:8620', { waitUntil: 'domcontentloaded' });

const report = await page.evaluate(async () => {
  const THREE = await import('three');
  const { BUILDING_PARTS } = await import('/public/js/runtimeParts.js');
  const { APPROVED_VEHICLE_MODELS } = await import('/public/js/approvedVehicleModels.js');
  const { makeRuntimePartModel } = await import('/public/js/runtimePartModel.js');
  const { buildNpcModel } = await import('/public/js/npcModels.js');
  const { buildBuildingUnit, buildBuildingUnitTurret } = await import('/public/js/buildingUnitModels.js');
  const { setCelSun, updateCelLight } = await import('/public/js/toon.js');
  setCelSun(new THREE.Vector3(0.4, 0.8, 0.4));

  document.body.innerHTML = '';
  document.body.style.cssText = 'margin:0;background:#171b22;color:#edf2f7;font:14px system-ui;';
  const title = document.createElement('h1');
  title.textContent = '正式場景模型視覺稽核';
  title.style.cssText = 'margin:18px 24px 8px;font-size:22px;';
  document.body.append(title);
  const grid = document.createElement('main');
  grid.style.cssText = 'display:grid;grid-template-columns:repeat(4,1fr);gap:12px;padding:12px 24px 24px;';
  document.body.append(grid);

  const first = (version) => BUILDING_PARTS.find((row) => row.version === version);
  const cases = [
    ['建築 v5', () => makeRuntimePartModel(first(5))],
    ['建築 v6', () => makeRuntimePartModel(first(6))],
    ['場景載具 v6', () => makeRuntimePartModel(APPROVED_VEHICLE_MODELS[0])],
    ['蜂群步兵', () => buildNpcModel('creep:soldier', 'SWARM')],
    ['鋼鐵裝甲車', () => buildNpcModel('creep:apc', 'STEEL')],
    ['鋼鐵坦克', () => buildNpcModel('creep:tank', 'STEEL')],
    ['游擊火箭兵', () => buildNpcModel('creep:rocketeer', 'GUER')],
    ['民兵榴彈兵', () => buildNpcModel('creep:howitzer', 'MILI')],
    ['蜂群直升機', () => buildNpcModel('creep:heli', 'SWARM')],
    ['第三方碉堡', () => buildNpcModel('bunker', 'GUER')],
    ['平民', () => buildNpcModel('civ', 'MILI', { profile: 2 })],
    ['蜂群防禦塔', () => {
      const g = buildBuildingUnit('tower', 'SWARM');
      const turret = buildBuildingUnitTurret('SWARM');
      turret.position.y = 20 * 0.92;
      g.add(turret);
      return g;
    }],
    ['蜂群主堡', () => buildBuildingUnit('base:SWARM', 'SWARM')],
    ['鋼鐵主堡', () => buildBuildingUnit('base:STEEL', 'STEEL')],
  ];

  const rows = [];
  for (const [label, build] of cases) {
    const card = document.createElement('section');
    card.style.cssText = 'background:#242a34;border:1px solid #3c4655;border-radius:10px;overflow:hidden;';
    const canvas = document.createElement('canvas');
    canvas.width = 336; canvas.height = 400;
    canvas.style.cssText = 'display:block;width:100%;height:400px;background:#cfd5dc;';
    const text = document.createElement('div');
    text.style.cssText = 'padding:9px 11px 11px;';
    card.append(canvas, text);
    grid.append(card);
    try {
      const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false });
      renderer.setPixelRatio(1);
      renderer.setSize(336, 400, false);
      renderer.setClearColor(0xcfd5dc, 1);
      renderer.outputColorSpace = THREE.SRGBColorSpace;
      const scene = new THREE.Scene();
      scene.add(new THREE.HemisphereLight(0xf4f7ff, 0x4c5560, 2.2));
      const sun = new THREE.DirectionalLight(0xffffff, 2.7);
      sun.position.set(5, 9, 7);
      scene.add(sun);
      const model = build();
      scene.add(model);
      model.updateMatrixWorld(true);
      const box = new THREE.Box3().setFromObject(model);
      const size = box.getSize(new THREE.Vector3());
      const center = box.getCenter(new THREE.Vector3());
      const radius = Math.max(1, size.length() * 0.52);
      const camera = new THREE.PerspectiveCamera(35, 336 / 400, radius / 100, radius * 20);
      camera.position.set(center.x + radius * 1.55, center.y + radius * 1.0, center.z + radius * 1.8);
      camera.lookAt(center);
      camera.updateMatrixWorld(true);
      updateCelLight(camera);
      scene.add(new THREE.GridHelper(radius * 3, 16, 0x78828e, 0xaab1b9));
      renderer.render(scene, camera);
      let meshes = 0;
      model.traverse((node) => { if (node.isMesh && !node.userData.isOutline) meshes++; });
      text.textContent = `${label}　${size.x.toFixed(1)} × ${size.y.toFixed(1)} × ${size.z.toFixed(1)}　${meshes} meshes`;
      rows.push({ label, size: size.toArray(), meshes });
      renderer.dispose();
    } catch (error) {
      text.textContent = `${label}　失敗：${error.message}`;
      text.style.color = '#ff9b9b';
      rows.push({ label, error: error.message });
    }
  }
  return rows;
});

await page.screenshot({ path: out, fullPage: true });
await browser.close();
const failed = report.filter((row) => row.error);
console.log(`正式場景模型：${report.length - failed.length}/${report.length} 可建，截圖 ${out}`);
for (const row of failed) console.error(`❌ ${row.label}: ${row.error}`);
for (const error of errors) console.error(`瀏覽器：${error}`);
if (failed.length || errors.length) process.exit(1);
