// 本機視覺驗收：僅測試伺服器，正式遊戲不包含此路由。
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = fileURLToPath(new URL('../public/js/', import.meta.url));
const page = `<!doctype html><meta charset="utf-8"><title>建築分類與文化風格立體驗收</title>
<style>
  body { margin: 0; background: #cdd9e2; color: #273649; font: 14px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; overflow: hidden; }
  header { position: absolute; top: 16px; left: 20px; z-index: 10; background: rgba(255,255,255,0.92); padding: 14px 20px; border-radius: 10px; box-shadow: 0 4px 16px rgba(0,0,0,0.12); backdrop-filter: blur(8px); }
  h1 { font-size: 18px; margin: 0 0 6px; color: #1c2b3d; }
  .desc { font-size: 12px; color: #5a6e85; margin-bottom: 10px; }
  .tabs { display: flex; gap: 8px; }
  .tab-btn { background: #e2e8f0; border: none; padding: 6px 14px; border-radius: 6px; font-weight: 600; font-size: 12px; color: #475569; cursor: pointer; transition: all 0.2s; }
  .tab-btn.active { background: #2563eb; color: #fff; box-shadow: 0 2px 6px rgba(37,99,235,0.35); }
  .hint { position: absolute; bottom: 16px; left: 20px; z-index: 10; background: rgba(0,0,0,0.65); color: #fff; padding: 6px 12px; border-radius: 6px; font-size: 12px; pointer-events: none; }
  #labels { position: absolute; inset: 0; pointer-events: none; }
  .badge { position: absolute; font-weight: 600; font-size: 11px; background: rgba(255,255,255,0.94); color: #1e2c3d; padding: 4px 10px; border-radius: 6px; box-shadow: 0 2px 8px rgba(0,0,0,0.14); border-left: 3px solid #2563eb; white-space: nowrap; transform: translate(-50%, -100%); margin-top: -8px; pointer-events: none; }
  .badge .cat { color: #2563eb; font-weight: 700; margin-right: 4px; }
  .badge .height { color: #059669; font-weight: 700; margin-left: 4px; }
  canvas { display: block; width: 100vw; height: 100vh; cursor: grab; }
  canvas:active { cursor: grabbing; }
</style>
<header>
  <h1>程序化建築系統・分類與樓高視覺驗收</h1>
  <div class="desc">先拉伸量體後細部渲染：支援 13 類地點功能高程、7 款牆面材質、12 款立體屋頂與 21 款外部構件</div>
  <div class="tabs">
    <button id="btn-func" class="tab-btn active">13 種地點與功能分類（真實高低起伏）</button>
    <button id="btn-style" class="tab-btn">21 種全球文化風格矩陣</button>
  </div>
</header>
<div class="hint">按住滑鼠左鍵拖曳旋轉視野 · 滾輪縮放視角</div>
<div id="labels"></div>
<script type="importmap">{"imports":{"three":"/three.mjs","three/addons/utils/BufferGeometryUtils.js":"/utils.mjs","three/addons/postprocessing/Pass.js":"/pass.mjs"}}</script>
<script type="module">
import * as THREE from 'three';
import { buildOsmPolygonBuildings } from '/js/osmBuilding.js';
import { ARCHITECTURE_STYLES, ROOF_FORMS, FACADE_TYPES, BUILDING_FUNCTION_RANGES } from '/js/architectureStyles.js';
import { inferBuildingFunction, sampleBuildingHeight } from '/js/buildingDiversity.js';
import { sceneObjectMat } from '/js/toon.js';
import { Pipeline } from '/js/postfx.js';

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(innerWidth, innerHeight);
renderer.setPixelRatio(devicePixelRatio);
document.body.append(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(0xcdd9e2);
scene.add(new THREE.HemisphereLight(0xffffff, 0x889bb0, 2.4));
const light = new THREE.DirectionalLight(0xfff3e0, 2.4);
light.position.set(-80, 160, 90);
scene.add(light);

const aspect = innerWidth / innerHeight;
const camera = new THREE.PerspectiveCamera(38, aspect, 0.1, 1200);

let camDist = 280, camTheta = 0.85, camPhi = 0.65;
let isDragging = false, prevMouse = { x: 0, y: 0 };
function updateCamera() {
  camPhi = Math.max(0.1, Math.min(Math.PI / 2 - 0.05, camPhi));
  camera.position.x = camDist * Math.sin(camPhi) * Math.sin(camTheta);
  camera.position.y = camDist * Math.cos(camPhi);
  camera.position.z = camDist * Math.sin(camPhi) * Math.cos(camTheta);
  camera.lookAt(0, 8, 0);
}
updateCamera();

window.addEventListener('mousedown', (e) => { isDragging = true; prevMouse = { x: e.clientX, y: e.clientY }; });
window.addEventListener('mousemove', (e) => {
  if (!isDragging) return;
  const dx = e.clientX - prevMouse.x, dy = e.clientY - prevMouse.y;
  camTheta -= dx * 0.008; camPhi += dy * 0.008;
  prevMouse = { x: e.clientX, y: e.clientY };
  updateCamera(); render();
});
window.addEventListener('mouseup', () => { isDragging = false; });
window.addEventListener('wheel', (e) => {
  camDist = Math.max(50, Math.min(600, camDist + e.deltaY * 0.25));
  updateCamera(); render();
}, { passive: true });

const floor = new THREE.Mesh(new THREE.PlaneGeometry(500, 500), new THREE.MeshLambertMaterial({ color: 0xbed0bd }));
floor.rotation.x = -Math.PI / 2;
floor.position.y = -0.05;
scene.add(floor);

let buildingGroup = new THREE.Group();
scene.add(buildingGroup);

const labels = [];
const labelContainer = document.querySelector('#labels');

// 13 大地點與功能分類展示定義（涵蓋商業區、工業區、住宅郊區、鄉村、觀光文化區）
const FUNCTION_SHOWCASE = [
  { key: 'commercial_skyscraper', label: '商業摩天樓', kind: 'commercial', w: 30, d: 26, styleId: 'modern', tags: { building: 'skyscraper' } },
  { key: 'commercial_office', label: '商辦大樓', kind: 'commercial', w: 24, d: 20, styleId: 'deco', tags: { building: 'office' } },
  { key: 'commercial_retail', label: '賣場/超市', kind: 'commercial', w: 34, d: 24, styleId: 'modern', tags: { building: 'retail', shop: 'supermarket' } },
  { key: 'industrial_factory', label: '工業廠房', kind: 'industrial', w: 28, d: 22, styleId: 'industrial', tags: { building: 'industrial' } },
  { key: 'industrial_warehouse', label: '倉儲物流中心', kind: 'industrial', w: 32, d: 24, styleId: 'industrial', tags: { building: 'warehouse' } },
  { key: 'industrial_power', label: '發電廠/變電所', kind: 'industrial', w: 26, d: 20, styleId: 'industrial', tags: { power: 'substation' } },
  { key: 'residential_apartment', label: '集合住宅公寓', kind: 'apartments', w: 22, d: 18, styleId: 'modern', tags: { building: 'apartments' } },
  { key: 'residential_townhouse', label: '透天別墅', kind: 'house', w: 16, d: 14, styleId: 'mediterranean', tags: { building: 'house' } },
  { key: 'residential_alley', label: '巷弄老屋街屋', kind: 'house', w: 10, d: 18, styleId: 'machiya', tags: { building: 'house' } },
  { key: 'rural_farmhouse', label: '鄉村農舍', kind: 'farm', w: 18, d: 14, styleId: 'alpine', tags: { building: 'farm' } },
  { key: 'rural_greenhouse', label: '農業溫室', kind: 'farm', w: 22, d: 16, styleId: 'modern', tags: { building: 'greenhouse' } },
  { key: 'tourism_visitor', label: '遊客中心', kind: 'civic', w: 24, d: 18, styleId: 'courtyard', tags: { tourism: 'visitor_center' } },
  { key: 'tourism_cultural', label: '文化歷史建築', kind: 'museum', w: 28, d: 24, styleId: 'east_asian_palace', tags: { building: 'museum', tourism: 'museum' } },
];

function clearBuildings() {
  scene.remove(buildingGroup);
  buildingGroup = new THREE.Group();
  scene.add(buildingGroup);
  labels.length = 0;
  labelContainer.innerHTML = '';
}

function buildFunctionsMode() {
  clearBuildings();
  const cols = 4;
  FUNCTION_SHOWCASE.forEach((item, i) => {
    const col = i % cols;
    const row = Math.floor(i / cols);
    const x = (col - (cols - 1) / 2) * 52;
    const z = (row - Math.floor(FUNCTION_SHOWCASE.length / cols) / 2) * 52;
    const poly = { outer: [[x - item.w / 2, z - item.d / 2], [x + item.w / 2, z - item.d / 2], [x + item.w / 2, z + item.d / 2], [x - item.w / 2, z + item.d / 2]], holes: [] };
    const funcInfo = inferBuildingFunction({ tags: item.tags, w: item.w, d: item.d }, poly, { urban: true });
    const heightInfo = sampleBuildingHeight(item.key, 9999 + i, 'func_' + i);
    const style = ARCHITECTURE_STYLES[item.styleId] || ARCHITECTURE_STYLES.modern;

    const area = {
      sourceId: 'bld_func_' + i,
      tags: { ...item.tags },
      classification: { kind: item.kind, generator: 'polygonBuilding' },
      worldPolygons: [poly],
    };

    buildOsmPolygonBuildings(buildingGroup, [area], {
      terrain: { heightAt: () => 0 },
      architectureOf: () => ({
        ...style,
        id: item.styleId,
        variant: i % 3,
        profile: 'plain',
        functionInfo,
        targetHeight: heightInfo.height,
        levels: heightInfo.levels,
        floorH: heightInfo.floorH,
      }),
      materialOf: () => ({
        wall: sceneObjectMat(0xffffff, { vertexColors: true }),
        roof: sceneObjectMat(0xffffff, { vertexColors: true }),
        detail: sceneObjectMat(0xffffff, { vertexColors: true }),
      }),
    });

    const badge = document.createElement('div');
    badge.className = 'badge';
    const rf = ROOF_FORMS[style.roofForm] || style.roofForm;
    const fc = FACADE_TYPES[style.wallType || style.facade] || style.facade;
    badge.innerHTML = '<span class="cat">【' + item.label + '】</span>' + style.label + ' · ' + fc + ' · ' + rf + '<span class="height">' + heightInfo.height + 'm (' + heightInfo.levels + '層)</span>';
    labelContainer.append(badge);
    labels.push({ label: badge, point: new THREE.Vector3(x, heightInfo.height, z) });
  });
  render();
}

function buildStylesMode() {
  clearBuildings();
  const entries = Object.entries(ARCHITECTURE_STYLES);
  const cols = 5;
  entries.forEach(([id, style], i) => {
    const col = i % cols;
    const row = Math.floor(i / cols);
    const x = (col - (cols - 1) / 2) * 44;
    const z = (row - Math.floor(entries.length / cols) / 2) * 44;

    let funcKey = 'residential_townhouse';
    if (/skyscraper|deco|modern/.test(id)) funcKey = i % 2 === 0 ? 'commercial_skyscraper' : 'commercial_office';
    else if (/industrial/.test(id)) funcKey = 'industrial_factory';
    else if (/courtyard|wudian|xieshan|gothic/.test(id)) funcKey = 'tourism_cultural';
    else if (/machiya|alley|vernacular/.test(id)) funcKey = 'residential_alley';
    else if (/alpine|farm/.test(id)) funcKey = 'rural_farmhouse';
    else if (/earthen|mediterranean/.test(id)) funcKey = 'residential_apartment';

    const heightInfo = sampleBuildingHeight(funcKey, 8888 + i, 'style_' + id);
    const w = funcKey === 'commercial_skyscraper' ? 24 : 20;
    const d = funcKey === 'commercial_skyscraper' ? 22 : 18;
    const poly = { outer: [[x - w / 2, z - d / 2], [x + w / 2, z - d / 2], [x + w / 2, z + d / 2], [x - w / 2, z + d / 2]], holes: [] };

    const area = {
      sourceId: 'bld_style_' + id,
      tags: { building: 'yes' },
      classification: { kind: 'house', generator: 'polygonBuilding' },
      worldPolygons: [poly],
    };

    buildOsmPolygonBuildings(buildingGroup, [area], {
      terrain: { heightAt: () => 0 },
      architectureOf: () => ({
        ...style,
        id,
        variant: i % 3,
        profile: 'plain',
        targetHeight: heightInfo.height,
        levels: heightInfo.levels,
        floorH: heightInfo.floorH,
      }),
      materialOf: () => ({
        wall: sceneObjectMat(0xffffff, { vertexColors: true }),
        roof: sceneObjectMat(0xffffff, { vertexColors: true }),
        detail: sceneObjectMat(0xffffff, { vertexColors: true }),
      }),
    });

    const badge = document.createElement('div');
    badge.className = 'badge';
    const rf = ROOF_FORMS[style.roofForm] || style.roofForm;
    const fc = FACADE_TYPES[style.wallType || style.facade] || style.facade;
    badge.innerHTML = '<span class="cat">【' + style.label + '】</span>' + fc + ' · ' + rf + '<span class="height">' + heightInfo.height + 'm (' + heightInfo.levels + '層)</span>';
    labelContainer.append(badge);
    labels.push({ label: badge, point: new THREE.Vector3(x, heightInfo.height, z) });
  });
  render();
}

const pipeline = new Pipeline(renderer, scene, camera, { dof: false, grade: false });
function updateLabels() {
  labels.forEach(({ label, point }) => {
    const p = point.clone().project(camera);
    label.style.left = ((p.x + 1) * innerWidth / 2) + 'px';
    label.style.top = ((-p.y + 1) * innerHeight / 2) + 'px';
    label.style.display = (p.z < 1 && p.z > -1) ? 'block' : 'none';
  });
}

function render() {
  pipeline.render();
  updateLabels();
}

window.addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
  render();
});

const btnFunc = document.querySelector('#btn-func');
const btnStyle = document.querySelector('#btn-style');
btnFunc.addEventListener('click', () => {
  btnFunc.classList.add('active'); btnStyle.classList.remove('active');
  buildFunctionsMode();
});
btnStyle.addEventListener('click', () => {
  btnStyle.classList.add('active'); btnFunc.classList.remove('active');
  buildStylesMode();
});

buildFunctionsMode();
document.body.dataset.ready = 'true';
</script>`;

http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://localhost');
    let body, type = 'text/javascript';
    if (url.pathname === '/') {
      body = page; type = 'text/html';
    } else if (url.pathname === '/three.mjs') {
      if (process.env.THREE_MODULE) {
        body = await readFile(process.env.THREE_MODULE);
      } else {
        res.writeHead(302, { Location: 'https://unpkg.com/three@0.160.0/build/three.module.js' });
        res.end(); return;
      }
    } else if (url.pathname === '/pass.mjs') {
      if (process.env.THREE_PASS) {
        body = await readFile(process.env.THREE_PASS);
      } else {
        res.writeHead(302, { Location: 'https://unpkg.com/three@0.160.0/examples/jsm/postprocessing/Pass.js' });
        res.end(); return;
      }
    } else if (url.pathname === '/utils.mjs') {
      if (process.env.THREE_BUFFER_UTILS) {
        body = await readFile(process.env.THREE_BUFFER_UTILS);
      } else {
        res.writeHead(302, { Location: 'https://unpkg.com/three@0.160.0/examples/jsm/utils/BufferGeometryUtils.js' });
        res.end(); return;
      }
    } else if (url.pathname.startsWith('/js/')) {
      const file = path.resolve(root, url.pathname.slice(4));
      if (!file.startsWith(root)) throw new Error('路徑不在模組目錄內');
      body = await readFile(file);
    } else {
      res.writeHead(404); res.end(); return;
    }
    res.writeHead(200, { 'Content-Type': type + '; charset=utf-8' });
    res.end(body);
  } catch (error) {
    res.writeHead(500); res.end(String(error));
  }
}).listen(8644, '127.0.0.1', () => console.log('建築驗收：http://127.0.0.1:8644'));
