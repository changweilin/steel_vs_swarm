// 本機視覺驗收：僅測試伺服器，正式遊戲不包含此路由。
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';

const root = fileURLToPath(new URL('../public/js/', import.meta.url));
const page = `<!doctype html><meta charset="utf-8"><title>立體視覺驗收工作室 · 建築分類與隨機參數展開</title>
<style>
  *, *::before, *::after { box-sizing: border-box; }
  body { margin: 0; background: #cdd9e2; color: #273649; font: 13px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; overflow: hidden; user-select: none; }
  header { position: absolute; top: 16px; left: 20px; z-index: 20; background: rgba(255, 255, 255, 0.94); padding: 14px 20px; border-radius: 12px; box-shadow: 0 6px 24px rgba(15, 23, 42, 0.15); backdrop-filter: blur(10px); max-width: 640px; }
  h1 { font-size: 17px; margin: 0 0 4px; color: #0f172a; display: flex; align-items: center; gap: 8px; }
  h1 .tag { font-size: 11px; background: #2563eb; color: #fff; padding: 2px 7px; border-radius: 4px; font-weight: 600; }
  .desc { font-size: 12px; color: #475569; margin-bottom: 12px; line-height: 1.45; }
  
  .dim-panel { background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 8px; padding: 10px 12px; margin-bottom: 10px; }
  .dim-title { font-size: 11px; font-weight: 700; color: #334155; text-transform: uppercase; margin-bottom: 6px; display: flex; justify-content: space-between; align-items: center; }
  .dim-title .badge { font-size: 11px; color: #2563eb; font-weight: 600; text-transform: none; }
  .dim-options { display: flex; flex-wrap: wrap; gap: 8px; }
  .dim-cb-label { display: inline-flex; align-items: center; gap: 6px; background: #fff; border: 1px solid #cbd5e1; padding: 4px 10px; border-radius: 6px; font-size: 12px; font-weight: 500; color: #334155; cursor: pointer; transition: all 0.15s; }
  .dim-cb-label:hover { border-color: #94a3b8; background: #f1f5f9; }
  .dim-cb-label.checked { background: #eff6ff; border-color: #3b82f6; color: #1d4ed8; font-weight: 600; box-shadow: 0 1px 3px rgba(59, 130, 246, 0.2); }
  .dim-cb-label input { margin: 0; accent-color: #2563eb; cursor: pointer; }

  .action-row { display: flex; align-items: center; gap: 8px; margin-top: 10px; flex-wrap: wrap; }
  .btn-generate { background: linear-gradient(135deg, #2563eb, #1d4ed8); color: #fff; border: none; padding: 7px 18px; border-radius: 6px; font-weight: 700; font-size: 13px; cursor: pointer; transition: all 0.2s; box-shadow: 0 3px 10px rgba(37, 99, 235, 0.35); display: inline-flex; align-items: center; gap: 6px; }
  .btn-generate:hover { background: linear-gradient(135deg, #1d4ed8, #1e40af); box-shadow: 0 4px 14px rgba(37, 99, 235, 0.45); transform: translateY(-1px); }
  .btn-generate:active { transform: translateY(0); }
  .btn-generate.btn-variant { background: linear-gradient(135deg, #059669, #047857); box-shadow: 0 3px 10px rgba(5, 150, 105, 0.35); }
  .btn-generate.btn-variant:hover { background: linear-gradient(135deg, #047857, #065f46); }
  .btn-randomize { background: #f1f5f9; color: #334155; border: 1px solid #cbd5e1; padding: 6px 13px; border-radius: 6px; font-weight: 600; font-size: 12px; cursor: pointer; transition: all 0.15s; }
  .btn-randomize:hover { background: #e2e8f0; border-color: #94a3b8; }
  .btn-filter { background: #f8fafc; color: #1e293b; border: 1px solid #cbd5e1; padding: 6px 13px; border-radius: 6px; font-weight: 600; font-size: 12px; cursor: pointer; transition: all 0.15s; }
  .btn-filter:hover { background: #f1f5f9; border-color: #94a3b8; }
  .btn-full-random { background: linear-gradient(135deg, #8b5cf6, #6d28d9); color: #fff; border: none; padding: 6px 14px; border-radius: 6px; font-weight: 700; font-size: 12px; cursor: pointer; box-shadow: 0 3px 10px rgba(139, 92, 246, 0.35); transition: all 0.2s; }
  .btn-full-random:hover { background: linear-gradient(135deg, #7c3aed, #5b21b6); transform: translateY(-1px); }

  .sample-control { display: inline-flex; align-items: center; gap: 6px; font-size: 11px; color: #334155; font-weight: 600; background: #fff; padding: 4px 8px; border-radius: 6px; border: 1px solid #cbd5e1; }
  .sample-label { color: #1e293b; font-weight: 700; }
  .sample-input-wrap { display: inline-flex; align-items: center; gap: 3px; font-weight: 500; color: #475569; }
  .sample-input-wrap input { width: 38px; padding: 2px 4px; border: 1px solid #cbd5e1; border-radius: 4px; font-size: 12px; font-weight: 700; color: #2563eb; text-align: center; }
  .sample-all-wrap { display: inline-flex; align-items: center; gap: 3px; font-size: 11px; color: #64748b; margin-left: 4px; cursor: pointer; }
  .sample-all-wrap input { accent-color: #2563eb; cursor: pointer; margin: 0; }
  .seed-control { display: inline-flex; align-items: center; gap: 5px; font-size: 11px; color: #475569; font-weight: 600; background: #fff; padding: 4px 8px; border-radius: 6px; border: 1px solid #cbd5e1; }
  .seed-control input { width: 65px; padding: 2px 4px; border: 1px solid #cbd5e1; border-radius: 4px; font-size: 11px; font-weight: 600; color: #1e293b; text-align: center; }
  .seed-mode-control { display: inline-flex; align-items: center; gap: 5px; font-size: 11px; color: #334155; font-weight: 600; background: #fff; padding: 4px 8px; border-radius: 6px; border: 1px solid #cbd5e1; }
  .seed-mode-select { padding: 2px 6px; border: 1px solid #cbd5e1; border-radius: 4px; font-size: 11px; font-weight: 600; color: #1d4ed8; background: #f8fafc; cursor: pointer; outline: none; }

  .nav-bar { display: flex; align-items: center; justify-content: space-between; gap: 10px; flex-wrap: wrap; margin-top: 4px; }
  .nav-status { font-size: 12px; color: #1e293b; font-weight: 600; }
  .btn-back { display: none; background: #dc2626; color: #fff; border: none; padding: 6px 14px; border-radius: 6px; font-size: 12px; font-weight: 600; cursor: pointer; transition: all 0.2s; box-shadow: 0 2px 6px rgba(220, 38, 38, 0.3); }
  .btn-back:hover { background: #b91c1c; }
  .toggles { display: flex; gap: 12px; font-size: 11px; color: #475569; align-items: center; }
  .toggles label { display: inline-flex; align-items: center; gap: 4px; cursor: pointer; }

  .hint { position: absolute; bottom: 16px; left: 20px; z-index: 20; background: rgba(15, 23, 42, 0.78); color: #f8fafc; padding: 7px 14px; border-radius: 8px; font-size: 12px; backdrop-filter: blur(4px); pointer-events: none; line-height: 1.5; }
  .hint kbd { background: rgba(255, 255, 255, 0.22); padding: 1px 5px; border-radius: 4px; font-size: 11px; }

  #labels { position: absolute; inset: 0; pointer-events: none; overflow: hidden; }
  .badge-label { position: absolute; font-weight: 600; font-size: 11px; background: rgba(255, 255, 255, 0.94); color: #1e293b; padding: 3px 8px; border-radius: 5px; box-shadow: 0 2px 6px rgba(0, 0, 0, 0.12); border-left: 3px solid #2563eb; white-space: nowrap; transform: translate(-50%, -100%); margin-top: -6px; pointer-events: none; transition: opacity 0.15s; }
  .badge-label .cat { color: #2563eb; font-weight: 700; margin-right: 3px; }
  .badge-label .height { color: #059669; font-weight: 700; margin-left: 3px; }

  /* 懸停詳細檢驗面板 */
  .inspector-card { position: absolute; z-index: 40; width: 340px; background: rgba(15, 23, 42, 0.92); color: #e2e8f0; padding: 14px 16px; border-radius: 10px; box-shadow: 0 10px 30px rgba(0, 0, 0, 0.35); border: 1px solid rgba(59, 130, 246, 0.4); backdrop-filter: blur(10px); pointer-events: none; transition: opacity 0.1s ease, transform 0.1s ease; font-size: 12px; line-height: 1.4; }
  .inspector-card h3 { margin: 0 0 6px; font-size: 15px; color: #60a5fa; display: flex; align-items: center; justify-content: space-between; }
  .inspector-card .sub { font-size: 11px; color: #94a3b8; margin-bottom: 10px; }
  .prop-group { border-top: 1px solid rgba(255, 255, 255, 0.1); padding-top: 6px; margin-top: 6px; }
  .prop-title { font-size: 10px; font-weight: 700; color: #38bdf8; text-transform: uppercase; margin-bottom: 4px; letter-spacing: 0.5px; }
  .prop-row { display: flex; justify-content: space-between; margin-bottom: 3px; font-size: 11px; }
  .prop-row .k { color: #94a3b8; }
  .prop-row .v { color: #f1f5f9; font-weight: 600; text-align: right; }
  .color-bar { display: flex; gap: 8px; margin-top: 4px; }
  .color-chip { flex: 1; display: flex; align-items: center; gap: 4px; font-size: 10px; color: #cbd5e1; }
  .color-chip .dot { width: 12px; height: 12px; border-radius: 3px; border: 1px solid rgba(255,255,255,0.4); display: inline-block; }
  .parts-badges { display: flex; flex-wrap: wrap; gap: 4px; margin-top: 4px; }
  .part-pill { background: rgba(37, 99, 235, 0.25); border: 1px solid rgba(96, 165, 250, 0.4); color: #bfdbfe; font-size: 10px; padding: 2px 6px; border-radius: 4px; }
  .inspector-hint { margin-top: 8px; font-size: 10px; color: #f59e0b; background: rgba(245, 158, 11, 0.12); padding: 4px 8px; border-radius: 4px; text-align: center; }

  /* 類別篩選模態視窗 */
  .filter-modal-backdrop { position: fixed; inset: 0; background: rgba(15, 23, 42, 0.65); backdrop-filter: blur(6px); z-index: 100; display: none; align-items: center; justify-content: center; padding: 20px; }
  .filter-modal-card { background: #ffffff; width: 100%; max-width: 1060px; max-height: 88vh; border-radius: 14px; box-shadow: 0 24px 50px rgba(0, 0, 0, 0.35); display: flex; flex-direction: column; overflow: hidden; }
  .filter-modal-header { display: flex; align-items: center; justify-content: space-between; padding: 14px 20px; border-bottom: 1px solid #e2e8f0; background: #f8fafc; }
  .filter-modal-title { font-size: 15px; font-weight: 700; color: #0f172a; display: flex; align-items: center; gap: 8px; }
  .filter-modal-desc { font-size: 11px; color: #64748b; margin-top: 2px; }
  .btn-close-modal { background: #e2e8f0; border: none; padding: 6px 12px; border-radius: 6px; font-weight: 600; font-size: 12px; cursor: pointer; color: #334155; }
  .btn-close-modal:hover { background: #cbd5e1; }
  .filter-modal-body { padding: 16px 20px; overflow-y: auto; display: flex; flex-direction: column; gap: 14px; }
  .filter-modal-grid { display: grid; grid-template-columns: repeat(5, minmax(170px, 1fr)); gap: 12px; }
  .filter-cat-col { background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 8px; padding: 10px; display: flex; flex-direction: column; gap: 6px; }
  .filter-cat-header { display: flex; justify-content: space-between; align-items: center; border-bottom: 1px solid #e2e8f0; padding-bottom: 6px; }
  .filter-cat-name { font-size: 12px; font-weight: 700; color: #1e293b; }
  .filter-cat-actions { display: flex; gap: 4px; }
  .btn-cat-act { font-size: 10px; padding: 1px 6px; border: 1px solid #cbd5e1; background: #fff; border-radius: 4px; color: #2563eb; cursor: pointer; }
  .btn-cat-act:hover { background: #eff6ff; }
  .filter-cat-list { max-height: 280px; overflow-y: auto; display: flex; flex-direction: column; gap: 3px; padding-right: 4px; }
  .filter-item-cb { display: flex; align-items: center; gap: 6px; font-size: 11px; color: #334155; cursor: pointer; padding: 2px 4px; border-radius: 4px; user-select: none; }
  .filter-item-cb:hover { background: #e2e8f0; }
  .filter-item-cb.selected { color: #1d4ed8; font-weight: 600; }
  .filter-item-cb input { accent-color: #2563eb; cursor: pointer; margin: 0; }
  .filter-modal-footer { display: flex; justify-content: space-between; align-items: center; padding: 12px 20px; border-top: 1px solid #e2e8f0; background: #f8fafc; }
  .filter-stat-text { font-size: 12px; color: #475569; font-weight: 600; }

  canvas { display: block; width: 100vw; height: 100vh; cursor: grab; }
  canvas:active { cursor: grabbing; }
</style>
<header>
  <h1>立體視覺驗收工作室 <span class="tag">建築與路網</span></h1>
  <div class="desc">多維度正交分類對照 · 點擊展開隨機參數變體 · 懸停數值檢驗 · 參數化十字路網</div>
  <div class="dim-panel">
    <div class="dim-title">
      <span>建築分類維度（最多任選兩個）</span>
      <span class="badge" id="dim-count-badge">已選 2 / 2 維度</span>
    </div>
    <div class="dim-options" id="dim-options">
      <label class="dim-cb-label checked"><input type="checkbox" value="func" checked> 地點與功能 (13)</label>
      <label class="dim-cb-label checked"><input type="checkbox" value="style" checked> 文化建築風格 (21)</label>
      <label class="dim-cb-label"><input type="checkbox" value="roof"> 屋頂立體造型 (12)</label>
      <label class="dim-cb-label"><input type="checkbox" value="facade"> 牆面立面材質 (7)</label>
      <label class="dim-cb-label"><input type="checkbox" value="region"> 世界文化大區 (7)</label>
    </div>
    <div class="action-row">
      <button id="btn-generate" class="btn-generate">⚡ 生成建築陣列</button>
      <button id="btn-randomize" class="btn-randomize">🎲 隨機種子生成</button>
      <button id="btn-open-filter" class="btn-filter">⚙ 類別篩選設定</button>
      <button id="btn-full-random" class="btn-full-random">🎲 全類別隨機混搭</button>
      <div class="sample-control">
        <span class="sample-label">取樣規模:</span>
        <label class="sample-input-wrap">維度A <input type="number" id="sample-dim-a" value="5" min="1" max="30"></label>
        <span>×</span>
        <label class="sample-input-wrap">維度B <input type="number" id="sample-dim-b" value="5" min="1" max="30"></label>
        <label class="sample-all-wrap"><input type="checkbox" id="chk-sample-all"> 全量不取樣</label>
      </div>
      <div class="seed-control">
        <label for="input-seed">種子碼</label>
        <input type="number" id="input-seed" value="5000" min="1" max="999999">
      </div>
      <div class="seed-mode-control">
        <span class="sample-label">生成種子規則:</span>
        <select id="select-seed-mode" class="seed-mode-select">
          <option value="fixed">固定種子</option>
          <option value="shared_batch">每次改變種子但同陣列相同</option>
          <option value="per_building" selected>每一個建築每次都改變種子</option>
        </select>
      </div>
      <button id="btn-regen-variants" class="btn-generate btn-variant" style="display: none;">🎲 重新隨機生成 16 組變體</button>
    </div>
  </div>
  <div class="nav-bar">
    <button id="btn-back" class="btn-back">← 返回分類矩陣</button>
    <div class="nav-status" id="nav-status">目前展示：【地點功能】×【文化風格】陣列</div>
    <div class="toggles">
      <label><input type="checkbox" id="chk-roads" checked> 道路與路口</label>
      <label><input type="checkbox" id="chk-labels" checked> 懸浮標籤</label>
      <label><button id="btn-reset-cam" style="background:#e2e8f0;border:none;padding:2px 8px;border-radius:4px;cursor:pointer;font-size:11px;">視角重置</button></label>
    </div>
  </div>
</header>
<div class="hint">
  <kbd>左鍵拖曳</kbd> 旋轉視角 · <kbd>右鍵拖曳</kbd> 平移中心 · <kbd>滾輪</kbd> 縮放 · <kbd>點擊建築</kbd> 展開 16 組隨機參數
</div>
<div id="labels"></div>
<div id="inspector-card" class="inspector-card" style="display: none;"></div>

<div id="filter-modal" class="filter-modal-backdrop">
  <div class="filter-modal-card">
    <div class="filter-modal-header">
      <div>
        <div class="filter-modal-title">⚙ 建築類別與維度選項篩選池</div>
        <div class="filter-modal-desc">自訂隨機生成與陣列循環時納入的特徵項目（未勾選之項目將從隨機抽選與矩陣循環中排除）</div>
      </div>
      <button id="btn-close-filter" class="btn-close-modal">✕ 關閉</button>
    </div>
    <div class="filter-modal-body">
      <div id="filter-grid" class="filter-modal-grid"></div>
    </div>
    <div class="filter-modal-footer">
      <div id="filter-stat" class="filter-stat-text">已啟用項目：60 / 60 款</div>
      <div style="display: flex; gap: 8px;">
        <button id="btn-filter-reset" class="btn-randomize">全部重設啟用</button>
        <button id="btn-filter-apply" class="btn-generate">套用並重新生成</button>
      </div>
    </div>
  </div>
</div>

<script type="importmap">{"imports":{"three":"/three.mjs","three/addons/utils/BufferGeometryUtils.js":"/utils.mjs","three/addons/postprocessing/Pass.js":"/pass.mjs"}}</script>
<script type="module">
import * as THREE from 'three';
import { buildOsmPolygonBuildings } from '/js/osmBuilding.js';
import {
  ARCHITECTURE_STYLES, ROOF_FORMS, FACADE_TYPES, BUILDING_FUNCTION_RANGES,
  CULTURAL_REGIONS, APPURTENANCE_RULES, calculateFootprintMetrics,
} from '/js/architectureStyles.js';
import { inferBuildingFunction, sampleBuildingHeight, architectureHash } from '/js/buildingDiversity.js';
import { sceneObjectMat } from '/js/toon.js';
import { Pipeline } from '/js/postfx.js';

// ---- Three.js 核心場景初始化 ----
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(innerWidth, innerHeight);
renderer.setPixelRatio(devicePixelRatio);
renderer.shadowMap.enabled = false;
document.body.append(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(0xcdd9e2);
scene.add(new THREE.HemisphereLight(0xffffff, 0x889bb0, 2.4));
const light = new THREE.DirectionalLight(0xfff3e0, 2.3);
light.position.set(-100, 200, 120);
scene.add(light);

const aspect = innerWidth / innerHeight;
const camera = new THREE.PerspectiveCamera(38, aspect, 0.5, 4000);

let camDist = 320, camTheta = 0.85, camPhi = 0.62;
const camTarget = new THREE.Vector3(0, 6, 0);
let isLeftDragging = false, isRightDragging = false, prevMouse = { x: 0, y: 0 };
let mouseDownPos = { x: 0, y: 0 };

function updateCamera() {
  camPhi = Math.max(0.08, Math.min(Math.PI / 2 - 0.05, camPhi));
  camera.position.x = camTarget.x + camDist * Math.sin(camPhi) * Math.sin(camTheta);
  camera.position.y = camTarget.y + camDist * Math.cos(camPhi);
  camera.position.z = camTarget.z + camDist * Math.sin(camPhi) * Math.cos(camTheta);
  camera.lookAt(camTarget);
}
updateCamera();

window.addEventListener('contextmenu', (e) => e.preventDefault());
window.addEventListener('mousedown', (e) => {
  if (e.button === 0) isLeftDragging = true;
  if (e.button === 2) isRightDragging = true;
  prevMouse = { x: e.clientX, y: e.clientY };
  mouseDownPos = { x: e.clientX, y: e.clientY };
});
window.addEventListener('mousemove', (e) => {
  const dx = e.clientX - prevMouse.x, dy = e.clientY - prevMouse.y;
  if (isLeftDragging) {
    camTheta -= dx * 0.007;
    camPhi += dy * 0.007;
    updateCamera(); render();
  } else if (isRightDragging) {
    const forward = new THREE.Vector3().subVectors(camTarget, camera.position);
    forward.y = 0; forward.normalize();
    const right = new THREE.Vector3().crossVectors(forward, new THREE.Vector3(0, 1, 0)).normalize();
    const panSpeed = camDist * 0.0016;
    camTarget.addScaledVector(right, -dx * panSpeed);
    camTarget.addScaledVector(forward, dy * panSpeed);
    updateCamera(); render();
  } else {
    handleHover(e);
  }
  prevMouse = { x: e.clientX, y: e.clientY };
});
window.addEventListener('mouseup', (e) => {
  const moved = Math.hypot(e.clientX - mouseDownPos.x, e.clientY - mouseDownPos.y);
  if (moved < 5 && e.button === 0) {
    handleClick(e);
  }
  isLeftDragging = false;
  isRightDragging = false;
});
window.addEventListener('wheel', (e) => {
  camDist = Math.max(40, Math.min(1800, camDist + e.deltaY * 0.35));
  updateCamera(); render();
}, { passive: true });

// 底板與建築群組
const floor = new THREE.Mesh(new THREE.PlaneGeometry(3200, 3200), new THREE.MeshLambertMaterial({ color: 0xbed0bd }));
floor.rotation.x = -Math.PI / 2;
floor.position.y = -0.05;
scene.add(floor);

let buildingGroup = new THREE.Group();
scene.add(buildingGroup);

let roadGroup = new THREE.Group();
scene.add(roadGroup);

const labels = [];
const labelContainer = document.querySelector('#labels');
const inspectorCard = document.querySelector('#inspector-card');

// 懸停高亮指示框
const highlightMesh = new THREE.Mesh(
  new THREE.RingGeometry(1, 1.4, 32),
  new THREE.MeshBasicMaterial({ color: 0x38bdf8, side: THREE.DoubleSide, transparent: true, opacity: 0.85 })
);
highlightMesh.rotation.x = -Math.PI / 2;
highlightMesh.position.y = 0.2;
highlightMesh.visible = false;
scene.add(highlightMesh);

// ---- 分類維度定義集 ----
const FUNCTION_DIM = [
  { key: 'commercial_skyscraper', label: '商業摩天樓', kind: 'commercial', w: 30, d: 26, defaultStyle: 'modern', tags: { building: 'skyscraper' } },
  { key: 'commercial_office',     label: '商辦大樓',   kind: 'commercial', w: 24, d: 20, defaultStyle: 'deco', tags: { building: 'office' } },
  { key: 'commercial_retail',     label: '商場賣場',   kind: 'commercial', w: 34, d: 24, defaultStyle: 'modern', tags: { building: 'retail', shop: 'supermarket' } },
  { key: 'industrial_factory',    label: '工業廠房',   kind: 'industrial', w: 28, d: 22, defaultStyle: 'industrial', tags: { building: 'industrial' } },
  { key: 'industrial_warehouse',  label: '物流倉儲',   kind: 'industrial', w: 32, d: 24, defaultStyle: 'industrial', tags: { building: 'warehouse' } },
  { key: 'industrial_power',      label: '能源設施',   kind: 'industrial', w: 26, d: 20, defaultStyle: 'industrial', tags: { building: 'industrial', power: 'substation' } },
  { key: 'residential_apartment', label: '集合公寓',   kind: 'apartments', w: 22, d: 18, defaultStyle: 'tile_apartment', tags: { building: 'apartments' } },
  { key: 'residential_townhouse', label: '獨棟透天',   kind: 'house',      w: 16, d: 14, defaultStyle: 'minnan_brick', tags: { building: 'house' } },
  { key: 'residential_alley',     label: '巷弄老屋',   kind: 'house',      w: 12, d: 18, defaultStyle: 'machiya', tags: { building: 'house' } },
  { key: 'rural_farmhouse',       label: '鄉村農舍',   kind: 'farm',       w: 18, d: 14, defaultStyle: 'alpine', tags: { building: 'farm' } },
  { key: 'rural_greenhouse',      label: '農業溫室',   kind: 'farm',       w: 22, d: 16, defaultStyle: 'greenhouse_glass', tags: { building: 'greenhouse' } },
  { key: 'tourism_visitor',       label: '遊客中心',   kind: 'civic',      w: 24, d: 18, defaultStyle: 'courtyard', tags: { building: 'civic', tourism: 'visitor_center' } },
  { key: 'tourism_cultural',      label: '文化歷史',   kind: 'museum',     w: 28, d: 24, defaultStyle: 'east_asian_palace', tags: { building: 'museum', tourism: 'museum' } },
];

const STYLE_DIM = Object.entries(ARCHITECTURE_STYLES).map(([id, s]) => ({ key: id, label: s.label, style: s }));
const ROOF_DIM = Object.entries(ROOF_FORMS).map(([id, label]) => ({ key: id, label }));
const FACADE_DIM = Object.entries(FACADE_TYPES).map(([id, label]) => ({ key: id, label }));
const REGION_DIM = Object.entries(CULTURAL_REGIONS).map(([id, r]) => ({ key: id, label: r.name, region: r }));

const DIM_COLLECTIONS = {
  func:   { name: '地點與功能', items: FUNCTION_DIM },
  style:  { name: '文化建築風格', items: STYLE_DIM },
  roof:   { name: '屋頂立體造型', items: ROOF_DIM },
  facade: { name: '牆面立面材質', items: FACADE_DIM },
  region: { name: '世界文化大區', items: REGION_DIM },
};

// 各維度已啟用的項目池 (預設全選)
const enabledDimItems = {
  func: new Set(FUNCTION_DIM.map((i) => i.key)),
  style: new Set(STYLE_DIM.map((i) => i.key)),
  roof: new Set(ROOF_DIM.map((i) => i.key)),
  facade: new Set(FACADE_DIM.map((i) => i.key)),
  region: new Set(REGION_DIM.map((i) => i.key)),
};

function getActiveDimItems(dimKey) {
  const collection = DIM_COLLECTIONS[dimKey];
  if (!collection) return [];
  const enabledSet = enabledDimItems[dimKey];
  const active = collection.items.filter((it) => enabledSet.has(it.key));
  return active.length > 0 ? active : collection.items;
}

// 當前狀態
let selectedDims = ['func', 'style'];
let currentMode = 'matrix'; // 'matrix' | 'variants' | 'full_random'
let variantTargetMeta = null;
const raycaster = new THREE.Raycaster();
const mouse = new THREE.Vector2();
const clickableObjects = [];
const dimCycleOffsets = { func: 0, style: 0, roof: 0, facade: 0, region: 0 };


// ---- 零件預估與統計輔助函式 ----
function estimateAppurtenances(poly, arch, heightInfo, seed) {
  const parts = [];
  const metrics = calculateFootprintMetrics(poly);
  const area = metrics ? metrics.area : 100;
  const idBase = (arch.id || 'bld') + '|' + (metrics?.outer?.[0]?.[0] || 0) + '|' + (metrics?.outer?.length || 0);
  const cat = arch.functionInfo?.category || 'residential';
  const height = heightInfo.height;

  if (cat === 'commercial' && height >= 28 && area >= 450) parts.push('停機坪直升機棚');
  if ((architectureHash(idBase, 'tank') % 100) < 85 && area >= 30) parts.push('白鐵不銹鋼水塔 ×' + ((seed % 3) + 1));
  if ((architectureHash(idBase, 'antenna') % 100) < 60) parts.push('魚骨電視天線');
  if ((architectureHash(idBase, 'cell') % 100) < 35 && height >= 24) parts.push('通訊基地台塔');
  if ((architectureHash(idBase, 'solar') % 100) < 45 && area >= 80) parts.push('光伏太陽能板 ×' + ((seed % 3) + 2));
  if ((architectureHash(idBase, 'chimney') % 100) < 55) parts.push('排煙煙囪');
  if ((architectureHash(idBase, 'roof_board') % 100) < 40 && cat === 'commercial' && height >= 18) parts.push('屋頂大型廣告架');
  if ((architectureHash(idBase, 'canopy') % 100) < 75) parts.push('門頭遮雨棚');
  if ((architectureHash(idBase, 'pots') % 100) < 70) parts.push('迎賓景觀盆栽 ×2');
  if ((architectureHash(idBase, 'ac') % 100) < 85) parts.push('冷氣室外機 ×' + (Math.floor(height / 4) * 2 + 2));
  if ((architectureHash(idBase, 'sign') % 100) < 80 && (cat === 'commercial' || cat === 'residential')) parts.push('側懸店鋪招牌 ×2');
  if ((architectureHash(idBase, 'fire') % 100) < 40 && height >= 12) parts.push('外露鋼構逃生梯');
  if (parts.length === 0) parts.push('正門標準門框', '換氣導流槽');
  return parts;
}

// ---- 清除與重設 ----
function clearScene() {
  scene.remove(buildingGroup);
  buildingGroup = new THREE.Group();
  scene.add(buildingGroup);

  scene.remove(roadGroup);
  roadGroup = new THREE.Group();
  scene.add(roadGroup);

  labels.length = 0;
  labelContainer.innerHTML = '';
  clickableObjects.length = 0;
  highlightMesh.visible = false;
  inspectorCard.style.display = 'none';
}

// ---- 隨機道路與十字路口系統 ----
function buildRoadGrid(cols, rows, startX, startZ, stepX, stepZ, margin = 28) {
  if (!document.querySelector('#chk-roads').checked) return;

  const minX = startX - stepX / 2;
  const maxX = startX + (cols - 1) * stepX + stepX / 2;
  const minZ = startZ - stepZ / 2;
  const maxZ = startZ + (rows - 1) * stepZ + stepZ / 2;

  // 垂直道路 X 座標清單
  const vertXs = [];
  for (let c = 0; c <= cols; c++) {
    vertXs.push(startX + (c - 0.5) * stepX);
  }
  // 水平道路 Z 座標清單
  const horizZs = [];
  for (let r = 0; r <= rows; r++) {
    horizZs.push(startZ + (r - 0.5) * stepZ);
  }

  const ROAD_PALETTE = [0x2c3036, 0x3a3f47, 0x484f58, 0x5a544c];
  const MARK_YELLOW = 0xf59e0b;
  const MARK_WHITE = 0xf1f5f9;

  // 1. 生成所有十字路口 (Crossroads)
  for (let ci = 0; ci < vertXs.length; ci++) {
    for (let rj = 0; rj < horizZs.length; rj++) {
      const cx = vertXs[ci], cz = horizZs[rj];
      const rSeed = Math.abs(Math.sin(ci * 37 + rj * 73)) * 10000;
      const roadW = 10 + (Math.floor(rSeed) % 3) * 2; // 10, 12, 14m
      const color = ROAD_PALETTE[Math.floor(rSeed) % ROAD_PALETTE.length];

      // 路口核心地面
      const junc = new THREE.Mesh(
        new THREE.PlaneGeometry(roadW, roadW),
        new THREE.MeshLambertMaterial({ color })
      );
      junc.rotation.x = -Math.PI / 2;
      junc.position.set(cx, 0.015, cz);
      roadGroup.add(junc);

      // 4 向斑馬線 (Crosswalks)
      const zebraLen = roadW - 1.6;
      const zebraArms = [
        { dx: 0, dz: -roadW / 2 - 1.6, rot: 0 },          // 北側
        { dx: 0, dz: roadW / 2 + 1.6, rot: 0 },           // 南側
        { dx: -roadW / 2 - 1.6, dz: 0, rot: Math.PI / 2 },// 西側
        { dx: roadW / 2 + 1.6, dz: 0, rot: Math.PI / 2 }, // 東側
      ];

      for (const arm of zebraArms) {
        // 斑馬線白色條紋
        const numStripes = Math.floor(zebraLen / 1.0);
        for (let s = 0; s < numStripes; s++) {
          const offset = (s - (numStripes - 1) / 2) * 1.0;
          const stripe = new THREE.Mesh(
            new THREE.PlaneGeometry(0.45, 2.6),
            new THREE.MeshBasicMaterial({ color: MARK_WHITE })
          );
          stripe.rotation.x = -Math.PI / 2;
          stripe.rotation.z = arm.rot;
          const sx = arm.rot === 0 ? cx + offset : cx + arm.dx;
          const sz = arm.rot === 0 ? cz + arm.dz : cz + offset;
          stripe.position.set(sx, 0.025, sz);
          roadGroup.add(stripe);
        }
        // 停止線 (Stop line)
        const stopDist = 3.3;
        const stopLine = new THREE.Mesh(
          new THREE.PlaneGeometry(arm.rot === 0 ? roadW - 2 : 0.45, arm.rot === 0 ? 0.45 : roadW - 2),
          new THREE.MeshBasicMaterial({ color: MARK_WHITE })
        );
        stopLine.rotation.x = -Math.PI / 2;
        const stX = arm.rot === 0 ? cx : cx + (arm.dx > 0 ? arm.dx + 1.7 : arm.dx - 1.7);
        const stZ = arm.rot === 0 ? cz + (arm.dz > 0 ? arm.dz + 1.7 : arm.dz - 1.7) : cz;
        stopLine.position.set(stX, 0.026, stZ);
        roadGroup.add(stopLine);
      }
    }
  }

  // 2. 生成十字路口之間的直行路段 (Road Segments)
  // (a) 縱向直行路段 (南北向)
  for (let ci = 0; ci < vertXs.length; ci++) {
    const cx = vertXs[ci];
    for (let rj = 0; rj < horizZs.length - 1; rj++) {
      const z1 = horizZs[rj], z2 = horizZs[rj + 1];
      const roadW = 10;
      const segLen = (z2 - z1) - roadW - 7.0;
      if (segLen <= 1) continue;
      const cz = (z1 + z2) / 2;
      const sSeed = Math.abs(Math.sin(ci * 91 + rj * 43)) * 10000;
      const color = ROAD_PALETTE[Math.floor(sSeed) % ROAD_PALETTE.length];

      // 路面
      const roadSeg = new THREE.Mesh(
        new THREE.PlaneGeometry(roadW, segLen),
        new THREE.MeshLambertMaterial({ color })
      );
      roadSeg.rotation.x = -Math.PI / 2;
      roadSeg.position.set(cx, 0.015, cz);
      roadGroup.add(roadSeg);

      // 兩側人行道路緣石 (Sidewalks)
      for (const side of [-1, 1]) {
        const sw = new THREE.Mesh(
          new THREE.BoxGeometry(1.6, 0.16, segLen),
          new THREE.MeshLambertMaterial({ color: 0x94a3b8 })
        );
        sw.position.set(cx + side * (roadW / 2 + 0.8), 0.08, cz);
        roadGroup.add(sw);
      }

      // 雙黃分向線或白虛線
      for (const dy of [-0.15, 0.15]) {
        const line = new THREE.Mesh(
          new THREE.PlaneGeometry(0.12, segLen),
          new THREE.MeshBasicMaterial({ color: MARK_YELLOW })
        );
        line.rotation.x = -Math.PI / 2;
        line.position.set(cx + dy, 0.024, cz);
        roadGroup.add(line);
      }
    }
  }

  // (b) 橫向直行路段 (東西向)
  for (let rj = 0; rj < horizZs.length; rj++) {
    const cz = horizZs[rj];
    for (let ci = 0; ci < vertXs.length - 1; ci++) {
      const x1 = vertXs[ci], x2 = vertXs[ci + 1];
      const roadW = 10;
      const segLen = (x2 - x1) - roadW - 7.0;
      if (segLen <= 1) continue;
      const cx = (x1 + x2) / 2;
      const sSeed = Math.abs(Math.sin(ci * 61 + rj * 89)) * 10000;
      const color = ROAD_PALETTE[Math.floor(sSeed) % ROAD_PALETTE.length];

      // 路面
      const roadSeg = new THREE.Mesh(
        new THREE.PlaneGeometry(segLen, roadW),
        new THREE.MeshLambertMaterial({ color })
      );
      roadSeg.rotation.x = -Math.PI / 2;
      roadSeg.position.set(cx, 0.015, cz);
      roadGroup.add(roadSeg);

      // 兩側人行道路緣石 (Sidewalks)
      for (const side of [-1, 1]) {
        const sw = new THREE.Mesh(
          new THREE.BoxGeometry(segLen, 0.16, 1.6),
          new THREE.MeshLambertMaterial({ color: 0x94a3b8 })
        );
        sw.position.set(cx, 0.08, cz + side * (roadW / 2 + 0.8));
        roadGroup.add(sw);
      }

      // 雙黃分向線
      for (const dz of [-0.15, 0.15]) {
        const line = new THREE.Mesh(
          new THREE.PlaneGeometry(segLen, 0.12),
          new THREE.MeshBasicMaterial({ color: MARK_YELLOW })
        );
        line.rotation.x = -Math.PI / 2;
        line.position.set(cx, 0.024, cz + dz);
        roadGroup.add(line);
      }
    }
  }
}

// ---- 建構建築實例與中繼資料 ----
function spawnBuilding({ x, z, w, d, funcItem, styleItem, roofForm, facadeType, regionId, seed, variantIdx = 0, customPoly = null }) {
  const fItem = funcItem || FUNCTION_DIM[0];
  const sItem = styleItem || (ARCHITECTURE_STYLES[fItem.defaultStyle] ? { key: fItem.defaultStyle, label: ARCHITECTURE_STYLES[fItem.defaultStyle].label, style: ARCHITECTURE_STYLES[fItem.defaultStyle] } : STYLE_DIM[0]);
  const style = { ...sItem.style };

  // 覆寫維度屬性
  if (roofForm) style.roofForm = roofForm;
  if (facadeType) style.wallType = facadeType;
  if (regionId) style.region = regionId;

  const poly = customPoly || {
    outer: [
      [x - w / 2, z - d / 2],
      [x + w / 2, z - d / 2],
      [x + w / 2, z + d / 2],
      [x - w / 2, z + d / 2],
    ],
    holes: [],
  };

  const functionInfo = inferBuildingFunction({ tags: fItem.tags || { building: 'yes' }, w, d }, poly, { urban: true });
  const heightInfo = sampleBuildingHeight(fItem.key, seed, 'bld_' + seed);

  const area = {
    sourceId: 'bld_' + seed,
    tags: { building: 'yes', ...fItem.tags },
    classification: { kind: fItem.kind || 'house', generator: 'polygonBuilding' },
    worldPolygons: [poly],
  };

  const subGroup = new THREE.Group();
  buildingGroup.add(subGroup);

  const archConfig = {
    ...style,
    id: sItem.key,
    variant: variantIdx,
    profile: 'plain',
    functionInfo,
    targetHeight: heightInfo.height,
    levels: heightInfo.levels,
    floorH: heightInfo.floorH,
  };

  buildOsmPolygonBuildings(subGroup, [area], {
    terrain: { heightAt: () => 0 },
    architectureOf: () => archConfig,
    materialOf: () => ({
      wall: sceneObjectMat(0xffffff, { vertexColors: true }),
      roof: sceneObjectMat(0xffffff, { vertexColors: true }),
      detail: sceneObjectMat(0xffffff, { vertexColors: true }),
    }),
  });

  // 計算零件清單
  const appurtenances = estimateAppurtenances(poly, archConfig, heightInfo, seed);

  // 儲存詳細中繼資料
  const meta = {
    id: 'bld_' + seed,
    seed,
    funcKey: fItem.key,
    funcLabel: fItem.label,
    styleKey: sItem.key,
    styleLabel: sItem.label,
    roofForm: style.roofForm,
    roofLabel: ROOF_FORMS[style.roofForm] || style.roofForm,
    facadeType: style.wallType || style.facade,
    facadeLabel: FACADE_TYPES[style.wallType || style.facade] || style.wallType || style.facade,
    regionKey: style.region || 'global_modern',
    regionLabel: CULTURAL_REGIONS[style.region]?.name || style.region || '全球現代',
    era: style.era || 'modern',
    width: Number(w.toFixed(1)),
    depth: Number(d.toFixed(1)),
    height: Number(heightInfo.height.toFixed(1)),
    levels: heightInfo.levels,
    floorH: Number(heightInfo.floorH.toFixed(2)),
    area: Number((w * d).toFixed(1)),
    span: Number(Math.min(w, d).toFixed(1)),
    aspect: Number((Math.max(w, d) / Math.min(w, d)).toFixed(2)),
    colors: {
      wall: '#' + (style.wall || 0xd8e6ed).toString(16).padStart(6, '0'),
      roof: '#' + (style.roof || 0x4e667b).toString(16).padStart(6, '0'),
      trim: '#' + (style.trim || 0x93afbd).toString(16).padStart(6, '0'),
      glass: '#' + (style.glass || 0x50aed2).toString(16).padStart(6, '0'),
    },
    appurtenances,
    position: new THREE.Vector3(x, heightInfo.height, z),
    centerPos: new THREE.Vector3(x, 0, z),
    radius: Math.hypot(w, d) / 2,
    rawPoly: poly,
    archConfig,
  };

  subGroup.userData.buildingMeta = meta;

  // 記錄點擊可拾取幾何
  subGroup.traverse((child) => {
    if (child.isMesh) {
      child.userData.buildingMeta = meta;
      clickableObjects.push(child);
    }
  });

  // 飄浮標籤
  const badge = document.createElement('div');
  badge.className = 'badge-label';
  badge.innerHTML = '<span class="cat">【' + meta.funcLabel + '】</span>' + meta.styleLabel + ' · ' + meta.roofLabel + '<span class="height">' + meta.height + 'm (' + meta.levels + 'F)</span>';
  labelContainer.append(badge);
  labels.push({ element: badge, point: meta.position });

  return meta;
}

function getCyclicItems(items, count, offset) {
  if (!items || items.length === 0) return { items: [], range: '無啟用項目' };
  if (!count || count >= items.length) {
    return { items: [...items], range: '全量 1~' + items.length + ' / 啟用 ' + items.length + ' 款' };
  }
  const result = [];
  const start = ((offset % items.length) + items.length) % items.length;
  for (let i = 0; i < count; i++) {
    const idx = (start + i) % items.length;
    result.push(items[idx]);
  }
  const end = (start + count - 1) % items.length;
  let rangeStr = '';
  if (start + count <= items.length) {
    rangeStr = '第 ' + (start + 1) + '~' + (start + count) + ' / 啟用 ' + items.length + ' 款';
  } else {
    rangeStr = '第 ' + (start + 1) + '~' + items.length + ' 接 1~' + (end + 1) + ' / 啟用 ' + items.length + ' 款';
  }
  return { items: result, range: rangeStr };
}

// ---- 1. 雙維度/單維度分類陣列模式 (Matrix Mode) ----
function buildMatrixMode({ advance = false } = {}) {
  clearScene();
  currentMode = 'matrix';
  document.querySelector('#btn-back').style.display = 'none';
  document.querySelector('#btn-generate').style.display = 'inline-flex';
  document.querySelector('#btn-randomize').style.display = 'inline-flex';
  document.querySelector('#btn-regen-variants').style.display = 'none';

  const dimKeyA = selectedDims[0];
  const dimKeyB = selectedDims.length > 1 ? selectedDims[1] : null;

  const dimA = DIM_COLLECTIONS[dimKeyA];
  const dimB = dimKeyB ? DIM_COLLECTIONS[dimKeyB] : null;

  const activeItemsA = getActiveDimItems(dimKeyA);
  const activeItemsB = dimKeyB && dimB ? getActiveDimItems(dimKeyB) : null;

  const seedMode = document.querySelector('#select-seed-mode')?.value || 'per_building';
  let baseSeed = parseInt(document.querySelector('#input-seed')?.value, 10) || 5000;
  const isAll = document.querySelector('#chk-sample-all')?.checked;
  const sampleCountA = isAll ? activeItemsA.length : Math.min(activeItemsA.length, Math.max(1, parseInt(document.querySelector('#sample-dim-a')?.value, 10) || 5));
  const sampleCountB = isAll ? (activeItemsB ? activeItemsB.length : 1) : Math.min(activeItemsB ? activeItemsB.length : 1, Math.max(1, parseInt(document.querySelector('#sample-dim-b')?.value, 10) || 5));

  // 若使用者點擊「生成」
  if (advance) {
    if (seedMode === 'shared_batch' || seedMode === 'per_building') {
      baseSeed = Math.floor(Math.random() * 90000) + 1000;
      const input = document.querySelector('#input-seed');
      if (input) input.value = baseSeed;
    }
    // 分類內切換至尚未展示的項目，形成循環輪播
    dimCycleOffsets[dimKeyA] = (dimCycleOffsets[dimKeyA] + sampleCountA) % activeItemsA.length;
    if (dimKeyB && activeItemsB) {
      dimCycleOffsets[dimKeyB] = (dimCycleOffsets[dimKeyB] + sampleCountB) % activeItemsB.length;
    }
  }

  const offsetA = ((dimCycleOffsets[dimKeyA] || 0) % activeItemsA.length + activeItemsA.length) % activeItemsA.length;
  const offsetB = (dimKeyB && activeItemsB ? (((dimCycleOffsets[dimKeyB] || 0) % activeItemsB.length + activeItemsB.length) % activeItemsB.length) : 0);

  const cycleA = getCyclicItems(activeItemsA, sampleCountA, offsetA);
  const cycleB = activeItemsB ? getCyclicItems(activeItemsB, sampleCountB, offsetB) : null;

  const itemsA = cycleA.items;
  const itemsB = cycleB ? cycleB.items : null;


  let cols, rows;

  if (dimB) {
    // 雙維度交叉矩陣: X軸 = Dim A, Z軸 = Dim B
    cols = itemsA.length;
    rows = itemsB.length;
    document.querySelector('#nav-status').textContent = '雙維度循環矩陣：【' + dimA.name + ' (' + cycleA.range + ')】×【' + dimB.name + ' (' + cycleB.range + ')】（共 ' + (cols * rows) + ' 棟）';
  } else {
    // 單維度陣列 (折行排成方形網格)
    cols = Math.min(5, Math.ceil(Math.sqrt(itemsA.length)));
    rows = Math.ceil(itemsA.length / cols);
    document.querySelector('#nav-status').textContent = '單維度循環展示：【' + dimA.name + ' (' + cycleA.range + ')】（共 ' + itemsA.length + ' 棟）';
  }

  const stepX = 52, stepZ = 48;
  const startX = -(cols - 1) * stepX / 2;
  const startZ = -(rows - 1) * stepZ / 2;

  // 生成間隔道路網
  buildRoadGrid(cols, rows, startX, startZ, stepX, stepZ);

  // 生成建築格子
  for (let c = 0; c < cols; c++) {
    for (let r = 0; r < rows; r++) {
      const idx = r * cols + c;
      const x = startX + c * stepX;
      const z = startZ + r * stepZ;

      let funcItem = null, styleItem = null, roofForm = null, facadeType = null, regionId = null;

      // 解析 Dim A
      const itA = itemsA[c];
      if (selectedDims[0] === 'func') funcItem = itA;
      else if (selectedDims[0] === 'style') styleItem = itA;
      else if (selectedDims[0] === 'roof') roofForm = itA.key;
      else if (selectedDims[0] === 'facade') facadeType = itA.key;
      else if (selectedDims[0] === 'region') regionId = itA.key;

      // 解析 Dim B (若存在)
      if (dimB) {
        const itB = itemsB[r];
        if (selectedDims[1] === 'func') funcItem = itB;
        else if (selectedDims[1] === 'style') styleItem = itB;
        else if (selectedDims[1] === 'roof') roofForm = itB.key;
        else if (selectedDims[1] === 'facade') facadeType = itB.key;
        else if (selectedDims[1] === 'region') regionId = itB.key;
      } else {
        if (idx >= itemsA.length) continue;
        const itSingle = itemsA[idx];
        if (selectedDims[0] === 'func') funcItem = itSingle;
        else if (selectedDims[0] === 'style') styleItem = itSingle;
        else if (selectedDims[0] === 'roof') roofForm = itSingle.key;
        else if (selectedDims[0] === 'facade') facadeType = itSingle.key;
        else if (selectedDims[0] === 'region') regionId = itSingle.key;
      }

      const w = funcItem ? funcItem.w : 22;
      const d = funcItem ? funcItem.d : 18;

      let seed;
      if (seedMode === 'shared_batch') {
        seed = baseSeed;
      } else if (seedMode === 'fixed') {
        seed = baseSeed + (offsetA + c) * 73 + (offsetB + r) * 137;
      } else {
        seed = baseSeed + (offsetA + c) * 73 + (offsetB + r) * 137;
      }

      spawnBuilding({ x, z, w, d, funcItem, styleItem, roofForm, facadeType, regionId, seed, variantIdx: (c + r) % 3 });
    }
  }

  // 自動調整攝影機距離以完整納入視野
  camTarget.set(0, 8, 0);
  const maxSpan = Math.max(cols * stepX, rows * stepZ);
  camDist = Math.max(220, maxSpan * 1.05);
  updateCamera();
  render();
}

// ---- 2. 點擊展開隨機參數變體陣列 (Variant Mode) ----
function buildVariantsMode(baseMeta) {
  clearScene();
  currentMode = 'variants';
  variantTargetMeta = baseMeta;

  document.querySelector('#btn-back').style.display = 'block';
  document.querySelector('#btn-generate').style.display = 'none';
  document.querySelector('#btn-randomize').style.display = 'none';
  document.querySelector('#btn-regen-variants').style.display = 'inline-flex';
  document.querySelector('#nav-status').textContent = '【' + baseMeta.funcLabel + ' × ' + baseMeta.styleLabel + '】16 組隨機參數展開變體';

  const cols = 4, rows = 4;
  const stepX = 54, stepZ = 50;
  const startX = -(cols - 1) * stepX / 2;
  const startZ = -(rows - 1) * stepZ / 2;

  // 生成間隔道路網
  buildRoadGrid(cols, rows, startX, startZ, stepX, stepZ);

  // 取出對應功能與風格定義
  const funcItem = FUNCTION_DIM.find((f) => f.key === baseMeta.funcKey) || FUNCTION_DIM[0];
  const styleItem = STYLE_DIM.find((s) => s.key === baseMeta.styleKey) || STYLE_DIM[0];

  for (let i = 0; i < 16; i++) {
    const c = i % cols;
    const r = Math.floor(i / cols);
    const x = startX + c * stepX;
    const z = startZ + r * stepZ;
    const vSeed = baseMeta.seed + i * 1337 + 89;

    // (1) 長寬高與基地隨機化
    const scaleW = 0.75 + ((architectureHash(vSeed, 'var_w') % 100) / 100) * 0.5; // 0.75 ~ 1.25x
    const scaleD = 0.75 + ((architectureHash(vSeed, 'var_d') % 100) / 100) * 0.5;
    const w = Math.round(funcItem.w * scaleW);
    const d = Math.round(funcItem.d * scaleD);

    // 基地形體變化：0=常規矩形, 1=倒角退縮, 2=L形凹角, 3=中庭天井
    let customPoly = null;
    const shapeType = i % 4;
    if (shapeType === 2) {
      // L 形平面
      customPoly = {
        outer: [
          [x - w / 2, z - d / 2],
          [x + w / 2, z - d / 2],
          [x + w / 2, z],
          [x, z],
          [x, z + d / 2],
          [x - w / 2, z + d / 2],
        ],
        holes: [],
      };
    } else if (shapeType === 3 && w >= 22 && d >= 20) {
      // 帶中庭天井平面
      const hw = w * 0.35, hd = d * 0.35;
      customPoly = {
        outer: [
          [x - w / 2, z - d / 2],
          [x + w / 2, z - d / 2],
          [x + w / 2, z + d / 2],
          [x - w / 2, z + d / 2],
        ],
        holes: [
          [
            [x - hw / 2, z - hd / 2],
            [x + hw / 2, z - hd / 2],
            [x + hw / 2, z + hd / 2],
            [x - hw / 2, z + hd / 2],
          ]
        ],
      };
    }

    // (2) 色彩渲染調色隨機偏置
    const vStyle = JSON.parse(JSON.stringify(styleItem.style));
    const hueShift = ((i * 35) % 360) / 360;
    // 微幅變化牆面與屋頂明暗
    const shadeF = 0.85 + (i % 5) * 0.08;
    vStyle.wall = adjustColorTone(vStyle.wall, shadeF);
    vStyle.roof = adjustColorTone(vStyle.roof, 1.15 - (i % 4) * 0.1);

    spawnBuilding({
      x, z, w, d,
      funcItem,
      styleItem: { key: styleItem.key, label: styleItem.label, style: vStyle },
      roofForm: baseMeta.roofForm,
      facadeType: baseMeta.facadeType,
      regionId: baseMeta.regionKey,
      seed: vSeed,
      variantIdx: i % 4,
      customPoly,
    });
  }

  // 鏡頭聚焦於 4x4 陣列
  camTarget.set(0, 8, 0);
  camDist = 260;
  updateCamera();
  render();
}

// ---- 3. 全類別隨機混搭模式 (Full Random Mode) ----
function buildFullRandomMode() {
  clearScene();
  currentMode = 'matrix';
  document.querySelector('#btn-back').style.display = 'none';
  document.querySelector('#btn-generate').style.display = 'inline-flex';
  document.querySelector('#btn-randomize').style.display = 'inline-flex';
  document.querySelector('#btn-regen-variants').style.display = 'none';

  const seedMode = document.querySelector('#select-seed-mode')?.value || 'per_building';
  let baseSeed = parseInt(document.querySelector('#input-seed')?.value, 10) || 5000;
  if (seedMode === 'shared_batch' || seedMode === 'per_building') {
    baseSeed = Math.floor(Math.random() * 90000) + 1000;
    const input = document.querySelector('#input-seed');
    if (input) input.value = baseSeed;
  }

  const isAll = document.querySelector('#chk-sample-all')?.checked;
  const cols = isAll ? 6 : Math.max(1, parseInt(document.querySelector('#sample-dim-a')?.value, 10) || 5);
  const rows = isAll ? 6 : Math.max(1, parseInt(document.querySelector('#sample-dim-b')?.value, 10) || 5);

  const funcs = getActiveDimItems('func');
  const styles = getActiveDimItems('style');
  const roofs = getActiveDimItems('roof');
  const facades = getActiveDimItems('facade');
  const regions = getActiveDimItems('region');

  document.querySelector('#nav-status').textContent = '🎲 全類別隨機混搭陣列：' + cols + ' × ' + rows + '（共 ' + (cols * rows) + ' 棟，5 大維度自由組合）';

  const stepX = 52, stepZ = 48;
  const startX = -(cols - 1) * stepX / 2;
  const startZ = -(rows - 1) * stepZ / 2;

  buildRoadGrid(cols, rows, startX, startZ, stepX, stepZ);

  for (let c = 0; c < cols; c++) {
    for (let r = 0; r < rows; r++) {
      const idx = r * cols + c;
      const x = startX + c * stepX;
      const z = startZ + r * stepZ;
      const cellSeed = seedMode === 'shared_batch' ? baseSeed : (baseSeed + idx * 79 + 17);

      const fItem = funcs[(architectureHash(cellSeed, 'rnd_f') >>> 0) % funcs.length];
      const sItem = styles[(architectureHash(cellSeed, 'rnd_s') >>> 0) % styles.length];
      const rItem = roofs[(architectureHash(cellSeed, 'rnd_r') >>> 0) % roofs.length];
      const fcItem = facades[(architectureHash(cellSeed, 'rnd_fc') >>> 0) % facades.length];
      const rgItem = regions[(architectureHash(cellSeed, 'rnd_rg') >>> 0) % regions.length];

      const w = fItem ? fItem.w : 22;
      const d = fItem ? fItem.d : 18;

      spawnBuilding({
        x, z, w, d,
        funcItem: fItem,
        styleItem: sItem,
        roofForm: rItem.key,
        facadeType: fcItem.key,
        regionId: rgItem.key,
        seed: cellSeed,
        variantIdx: (c + r) % 3,
      });
    }
  }

  camTarget.set(0, 8, 0);
  const maxSpan = Math.max(cols * stepX, rows * stepZ);
  camDist = Math.max(220, maxSpan * 1.05);
  updateCamera();
  render();
}


function adjustColorTone(hex, factor) {
  const c = new THREE.Color(hex);
  c.r = Math.min(1, Math.max(0, c.r * factor));
  c.g = Math.min(1, Math.max(0, c.g * factor));
  c.b = Math.min(1, Math.max(0, c.b * factor));
  return c.getHex();
}

// ---- 3. 滑鼠懸停檢驗面板 (Hover Inspector) ----
function handleHover(e) {
  mouse.x = (e.clientX / innerWidth) * 2 - 1;
  mouse.y = -(e.clientY / innerHeight) * 2 + 1;
  raycaster.setFromCamera(mouse, camera);

  const intersects = raycaster.intersectObjects(clickableObjects, false);

  if (intersects.length > 0) {
    const meta = intersects[0].object.userData.buildingMeta;
    if (meta) {
      highlightMesh.position.set(meta.centerPos.x, 0.2, meta.centerPos.z);
      const ringR = meta.radius + 1.5;
      highlightMesh.scale.set(ringR, ringR, 1);
      highlightMesh.visible = true;

      // 渲染詳細檢驗面板內容
      const eraText = meta.era === 'historic' ? '古典歷史' : (meta.era === 'transitional' ? '近代過渡' : '當代現代');
      const hintText = currentMode === 'matrix' ? '💡 點擊此建築可展開 16 組隨機參數變體' : '✨ 隨機參數變體細節檢驗中';
      const pillsHtml = meta.appurtenances.map(function(p) { return '<span class="part-pill">' + p + '</span>'; }).join('');

      inspectorCard.innerHTML =
        '<h3><span>' + meta.funcLabel + '</span><span style="font-size:12px;color:#38bdf8;">' + meta.styleLabel + '</span></h3>' +
        '<div class="sub">分類：' + meta.regionLabel + ' · ' + eraText + '</div>' +
        '<div class="prop-group">' +
          '<div class="prop-title">📐 實體幾何與基地尺寸</div>' +
          '<div class="prop-row"><span class="k">實體長寬高</span><span class="v">' + meta.width + ' × ' + meta.depth + ' × ' + meta.height + ' m</span></div>' +
          '<div class="prop-row"><span class="k">樓層與層高</span><span class="v">' + meta.levels + ' 層 (單層 ' + meta.floorH + 'm)</span></div>' +
          '<div class="prop-row"><span class="k">基地面積 / 跨度</span><span class="v">' + meta.area + ' m² / 跨度 ' + meta.span + 'm</span></div>' +
          '<div class="prop-row"><span class="k">屋頂 / 外牆材質</span><span class="v">' + meta.roofLabel + ' / ' + meta.facadeLabel + '</span></div>' +
        '</div>' +
        '<div class="prop-group">' +
          '<div class="prop-title">🎨 外觀色彩與渲染色碼</div>' +
          '<div class="color-bar">' +
            '<div class="color-chip"><span class="dot" style="background:' + meta.colors.wall + '"></span> 牆 ' + meta.colors.wall + '</div>' +
            '<div class="color-chip"><span class="dot" style="background:' + meta.colors.roof + '"></span> 頂 ' + meta.colors.roof + '</div>' +
            '<div class="color-chip"><span class="dot" style="background:' + meta.colors.trim + '"></span> 飾 ' + meta.colors.trim + '</div>' +
            '<div class="color-chip"><span class="dot" style="background:' + meta.colors.glass + '"></span> 窗 ' + meta.colors.glass + '</div>' +
          '</div>' +
        '</div>' +
        '<div class="prop-group">' +
          '<div class="prop-title">⚙ 外部構件組合 (' + meta.appurtenances.length + ' 項)</div>' +
          '<div class="parts-badges">' + pillsHtml + '</div>' +
        '</div>' +
        '<div class="inspector-hint">' + hintText + '</div>';

      // 智慧浮動位置（防止超出螢幕右側或底部）
      const cardW = 340, cardH = 320;
      let left = e.clientX + 16;
      let top = e.clientY + 16;
      if (left + cardW > innerWidth) left = e.clientX - cardW - 16;
      if (top + cardH > innerHeight) top = innerHeight - cardH - 16;

      inspectorCard.style.left = left + 'px';
      inspectorCard.style.top = top + 'px';
      inspectorCard.style.display = 'block';
      render();
      return;
    }
  }

  highlightMesh.visible = false;
  inspectorCard.style.display = 'none';
  render();
}

// ---- 4. 點擊建築觸發展開變體 ----
function handleClick(e) {
  mouse.x = (e.clientX / innerWidth) * 2 - 1;
  mouse.y = -(e.clientY / innerHeight) * 2 + 1;
  raycaster.setFromCamera(mouse, camera);

  const intersects = raycaster.intersectObjects(clickableObjects, false);
  if (intersects.length > 0) {
    const meta = intersects[0].object.userData.buildingMeta;
    if (meta && currentMode === 'matrix') {
      buildVariantsMode(meta);
    }
  }
}

// ---- UI 控制事件綁定 ----
const dimLabels = document.querySelectorAll('.dim-cb-label');
dimLabels.forEach((label) => {
  const cb = label.querySelector('input');
  cb.addEventListener('change', () => {
    const val = cb.value;
    if (cb.checked) {
      if (selectedDims.length >= 2) {
        // 最多勾選兩個：若已滿 2 個，將最早選取的解除勾選 (FIFO)
        const unselected = selectedDims.shift();
        const uncheckCb = document.querySelector('.dim-cb-label input[value="' + unselected + '"]');
        if (uncheckCb) {
          uncheckCb.checked = false;
          uncheckCb.parentElement.classList.remove('checked');
        }
      }
      selectedDims.push(val);
      label.classList.add('checked');
    } else {
      // 至少保持勾選 1 個維度
      if (selectedDims.length <= 1) {
        cb.checked = true;
        return;
      }
      selectedDims = selectedDims.filter((d) => d !== val);
      label.classList.remove('checked');
      dimCycleOffsets[val] = 0;
    }
    document.querySelector('#dim-count-badge').textContent = '已選 ' + selectedDims.length + ' / 2 維度';
    buildMatrixMode({ advance: false });
  });
});

document.querySelector('#btn-generate').addEventListener('click', () => {
  const btn = document.querySelector('#btn-generate');
  btn.textContent = '⚡ 生成中...';
  setTimeout(() => {
    try {
      buildMatrixMode({ advance: true });
    } catch (err) {
      console.error('生成建築陣列失敗:', err);
      alert('生成建築陣列時發生錯誤: ' + (err.message || err));
    } finally {
      btn.textContent = '⚡ 生成建築陣列';
    }
  }, 10);
});

document.querySelector('#btn-randomize').addEventListener('click', () => {
  const newSeed = Math.floor(Math.random() * 90000) + 1000;
  const input = document.querySelector('#input-seed');
  if (input) input.value = newSeed;
  Object.keys(dimCycleOffsets).forEach((k) => {
    dimCycleOffsets[k] = Math.floor(Math.random() * (DIM_COLLECTIONS[k]?.items.length || 10));
  });
  try {
    buildMatrixMode({ advance: false });
  } catch (err) {
    console.error('隨機種子生成失敗:', err);
  }
});

document.querySelector('#input-seed').addEventListener('change', () => {
  if (currentMode === 'matrix') {
    buildMatrixMode({ advance: false });
  } else if (variantTargetMeta) {
    variantTargetMeta.seed = parseInt(document.querySelector('#input-seed').value, 10) || 5000;
    buildVariantsMode(variantTargetMeta);
  }
});

['#sample-dim-a', '#sample-dim-b', '#chk-sample-all', '#select-seed-mode'].forEach((sel) => {
  document.querySelector(sel)?.addEventListener('change', () => {
    if (currentMode === 'matrix') buildMatrixMode({ advance: false });
  });
});

document.querySelector('#btn-regen-variants').addEventListener('click', () => {
  if (variantTargetMeta) {
    variantTargetMeta.seed = Math.floor(Math.random() * 90000) + 1000;
    const input = document.querySelector('#input-seed');
    if (input) input.value = variantTargetMeta.seed;
    buildVariantsMode(variantTargetMeta);
  }
});

document.querySelector('#btn-back').addEventListener('click', () => {
  buildMatrixMode({ advance: false });
});

document.querySelector('#chk-roads').addEventListener('change', (e) => {
  roadGroup.visible = e.target.checked;
  render();
});

document.querySelector('#chk-labels').addEventListener('change', (e) => {
  labelContainer.style.display = e.target.checked ? 'block' : 'none';
});

document.querySelector('#btn-reset-cam').addEventListener('click', () => {
  camTarget.set(0, 8, 0);
  camTheta = 0.85; camPhi = 0.62;
  camDist = currentMode === 'matrix' ? 380 : 260;
  updateCamera();
  render();
});

// ---- 4. 類別篩選模態視窗與管理 ----
function setupFilterModal() {
  const grid = document.querySelector('#filter-grid');
  const stat = document.querySelector('#filter-stat');
  if (!grid) return;
  grid.innerHTML = '';

  let totalItems = 0;
  const colInputs = {};

  function updateStat() {
    let activeCount = 0;
    Object.keys(DIM_COLLECTIONS).forEach((k) => {
      activeCount += enabledDimItems[k].size;
    });
    if (stat) stat.textContent = '已啟用項目：' + activeCount + ' / ' + totalItems + ' 款';
  }

  Object.entries(DIM_COLLECTIONS).forEach(([dimKey, col]) => {
    colInputs[dimKey] = [];
    const colDiv = document.createElement('div');
    colDiv.className = 'filter-cat-col';

    const header = document.createElement('div');
    header.className = 'filter-cat-header';

    const nameSpan = document.createElement('span');
    nameSpan.className = 'filter-cat-name';
    nameSpan.textContent = col.name + ' (' + col.items.length + ')';
    header.appendChild(nameSpan);

    const actions = document.createElement('div');
    actions.className = 'filter-cat-actions';

    const btnAll = document.createElement('button');
    btnAll.className = 'btn-cat-act';
    btnAll.textContent = '全選';
    btnAll.addEventListener('click', () => {
      col.items.forEach((it) => enabledDimItems[dimKey].add(it.key));
      colInputs[dimKey].forEach(({ cb, label }) => {
        cb.checked = true;
        label.classList.add('selected');
      });
      updateStat();
    });

    const btnClear = document.createElement('button');
    btnClear.className = 'btn-cat-act';
    btnClear.textContent = '全清';
    btnClear.addEventListener('click', () => {
      enabledDimItems[dimKey].clear();
      colInputs[dimKey].forEach(({ cb, label }) => {
        cb.checked = false;
        label.classList.remove('selected');
      });
      updateStat();
    });

    actions.appendChild(btnAll);
    actions.appendChild(btnClear);
    header.appendChild(actions);
    colDiv.appendChild(header);

    const list = document.createElement('div');
    list.className = 'filter-cat-list';

    col.items.forEach((it) => {
      totalItems++;
      const isChecked = enabledDimItems[dimKey].has(it.key);

      const label = document.createElement('label');
      label.className = 'filter-item-cb' + (isChecked ? ' selected' : '');

      const cb = document.createElement('input');
      cb.type = 'checkbox';
      cb.checked = isChecked;
      cb.addEventListener('change', () => {
        if (cb.checked) {
          enabledDimItems[dimKey].add(it.key);
          label.classList.add('selected');
        } else {
          enabledDimItems[dimKey].delete(it.key);
          label.classList.remove('selected');
        }
        updateStat();
      });

      label.appendChild(cb);
      label.appendChild(document.createTextNode(it.label));
      list.appendChild(label);
      colInputs[dimKey].push({ cb, label, key: it.key });
    });

    colDiv.appendChild(list);
    grid.appendChild(colDiv);
  });

  updateStat();

  document.querySelector('#btn-filter-reset')?.addEventListener('click', () => {
    Object.entries(DIM_COLLECTIONS).forEach(([k, col]) => {
      col.items.forEach((it) => enabledDimItems[k].add(it.key));
      colInputs[k]?.forEach(({ cb, label }) => {
        cb.checked = true;
        label.classList.add('selected');
      });
    });
    updateStat();
  });
}

const filterModal = document.querySelector('#filter-modal');
document.querySelector('#btn-open-filter')?.addEventListener('click', () => {
  if (filterModal) filterModal.style.display = 'flex';
});
document.querySelector('#btn-close-filter')?.addEventListener('click', () => {
  if (filterModal) filterModal.style.display = 'none';
});
filterModal?.addEventListener('click', (e) => {
  if (e.target === filterModal) filterModal.style.display = 'none';
});
document.querySelector('#btn-filter-apply')?.addEventListener('click', () => {
  if (filterModal) filterModal.style.display = 'none';
  buildMatrixMode({ advance: false });
});
document.querySelector('#btn-full-random')?.addEventListener('click', () => {
  buildFullRandomMode();
});

// ---- 飄浮標籤投影更新與渲染循環 ----

function updateLabels() {
  if (!document.querySelector('#chk-labels').checked) return;
  const halfW = innerWidth / 2, halfH = innerHeight / 2;
  for (let i = 0; i < labels.length; i++) {
    const { element, point } = labels[i];
    const p = point.clone().project(camera);
    if (p.z > -1 && p.z < 1) {
      element.style.display = 'block';
      element.style.left = ((p.x + 1) * halfW) + 'px';
      element.style.top = ((-p.y + 1) * halfH) + 'px';
    } else {
      element.style.display = 'none';
    }
  }
}

let pipeline = null;
try {
  pipeline = new Pipeline(renderer, scene, camera, { dof: false, grade: false });
} catch (err) {
  console.warn('後製管線初始化回退為原生 WebGL 渲染:', err);
}

function render() {
  if (pipeline) {
    pipeline.render();
  } else {
    renderer.render(scene, camera);
  }
  updateLabels();
}

window.addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
  render();
});

// 初次建構
try {
  setupFilterModal();
  buildMatrixMode();
} catch (err) {
  console.error('初次建構失敗:', err);
}

document.body.dataset.ready = 'true';
</script>`;

export const DEFAULT_PORT = 8644;

export function serve(port = DEFAULT_PORT) {
  const server = http.createServer(async (req, res) => {
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
  });
  server.listen(port, '127.0.0.1', () => console.log(`建築驗收：http://127.0.0.1:${port}`));
  return server;
}

if (import.meta.url === pathToFileURL(path.resolve(process.argv[1] || '')).href) {
  serve();
}
