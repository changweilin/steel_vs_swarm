// ============ 人形鍛造檢視台(dev-only;不進遊戲)============
// 驗證兩件事:
//   ① 全角度完整 —— 鍛造出來的機體是 360° 實心零件樹(軌道鏡頭 + 自動環繞檢視);
//   ② 可動態移動 —— rig 契約齊全,真品 locomotion.js(stepBiped / stepCombatFx /
//      stepCastPose)一行不改直接驅動:步態、據槍、後座、蓄力擊發、施法動作全數成立。
// 驅動方式鏡射 charPreview.js 的跑步機:機體固定原點、地面反向捲動,
// stepLocomotion 以「假位移」(0, -speed*dt, 0) 量到真實速度 —— 與戰場同一套演算。

import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { stepLocomotion, stepCombatFx } from '/public/js/locomotion.js';
import { updateCelLight, disposeTree } from '/public/js/toon.js';
import { SPECS, forgeHumanoidMech, conversionDoc, resolveProp, mergeSpec, HUMANOID } from './forge.js';

// 使用者調整覆寫層(機體台 /api/forge 寫入;本檢視台唯讀)—— 合併只走 mergeSpec 單一縫
let OVR = {};
try {
  const r = await fetch('/tools/humanoid_forge/specs.json');
  if (r.ok) OVR = (await r.json()).mechs || {};
} catch { /* 沒有覆寫檔 = 全走出廠規格 */ }

const canvas = document.getElementById('stage');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
renderer.setClearColor(0x171a21);

const scene = new THREE.Scene();
scene.fog = new THREE.Fog(0x171a21, 60, 140);
const camera = new THREE.PerspectiveCamera(38, 1, 0.1, 400);

// 燈光鏡射 charPreview(賽璐璐 ramp 吃的是 toon.js 共用光向,由 updateCelLight 每幀更新)
const SUN = new THREE.Vector3(0.4, 0.8, 0.4);
const dir = new THREE.DirectionalLight(0xffffff, 2.1);
dir.position.copy(SUN).multiplyScalar(50);
scene.add(dir, new THREE.HemisphereLight(0xdff1ff, 0x2b2f38, 1.1));

// 跑步機地面:格線反向捲動 = 速度的視覺參照(機體恆在原點)
const CELL = 2;
const grid = new THREE.GridHelper(80, 40, 0x39414f, 0x262c36);
scene.add(grid);
const plate = new THREE.Mesh(new THREE.CircleGeometry(40, 48),
  new THREE.MeshBasicMaterial({ color: 0x1b1f27 }));
plate.rotation.x = -Math.PI / 2;
plate.position.y = -0.02;
scene.add(plate);

const controls = new OrbitControls(camera, canvas);
controls.enableDamping = true;
controls.dampingFactor = 0.08;
controls.autoRotateSpeed = 1.6;

// ---- 狀態 ----
let unit = null;      // { group, rig, joints }
let ent = null;       // 餵給 locomotion 的假實體
let spec = SPECS[1];  // 預設:突擊(標準人形比例)
let speed = 0, speedTgt = 0, travel = 0;
let firing = false, nextShot = 0;
let heavyAt = -1;     // 蓄力中:擊發時刻(sim 時間)
let simT = 0;
const clock = new THREE.Clock();

function setSpec(s) {
  spec = s;
  if (unit) {
    scene.remove(unit.group);
    disposeTree(unit.group);   // A25:換機體釋放 GPU 資源
  }
  unit = forgeHumanoidMech(mergeSpec(spec, OVR[spec.id]));
  scene.add(unit.group);
  unit.joints.visible = document.getElementById('btnJoints').classList.contains('on');
  ent = { id: spec.id, mesh: unit.group, heroY: 0 };   // loco 狀態綁 mesh,換機體重建
  const H = spec.height;
  controls.target.set(0, H * 0.52, 0);
  camera.position.set(H * 1.6, H * 0.62, H * 2.1);
  camera.near = 0.1; camera.far = 400;
  renderPanel();
  renderSpecButtons();
}

// ---- UI ----
const $ = (id) => document.getElementById(id);

function renderSpecButtons() {
  const box = $('specSeg');
  box.innerHTML = '';
  for (const s of SPECS) {
    const b = document.createElement('button');
    b.className = 'segb' + (s === spec ? ' on' : '');
    b.textContent = s.label;
    b.onclick = () => setSpec(s);
    box.appendChild(b);
  }
}

function renderPanel() {
  const p = resolveProp(spec);
  const rows = conversionDoc(spec)
    .map((r) => `<tr><td>${r.feat}</td><td>${r.part}</td></tr>`).join('');
  const propRows = Object.keys(HUMANOID)
    .map((k) => {
      const ovr = spec.prop?.[k] != null;
      return `<tr class="${ovr ? 'ovr' : ''}"><td>${k}</td><td>${p[k]}</td><td>${HUMANOID[k].vrm}</td></tr>`;
    }).join('');
  const rig = unit.rig;
  const chan = [
    ['hips/chest/head', !!(rig.hips && rig.chest && rig.head)],
    ['legL/R + legChain ×2', !!(rig.legL && rig.legChainL.length === 2 && rig.legChainR.length === 2)],
    ['armL/R + armChain ×2', !!(rig.armL && rig.armChainL.length === 2 && rig.armChainR.length === 2)],
    ['aimPose(據槍)', !!rig.aimPose],
    ['gunR/gunL(俯仰)', !!(rig.gunR && rig.gunL)],
    ['weap/hvy/kickAmp(後座)', !!(rig.weap && rig.hvy && rig.kickAmp)],
    ['muzzles + wpn(槍口/FPV 同源)', !!(rig.muzzles?.light && rig.muzzles?.heavy && rig.wpn?.light && rig.wpn?.heavy)],
    ['moveSig / castSig(性格層)', !!(rig.moveSig && rig.castSig)],
  ].map(([n, ok]) => `<li class="${ok ? 'ok' : 'bad'}">${ok ? '✓' : '✗'} ${n}</li>`).join('');
  $('panel').innerHTML = `
    <h3>${spec.label} <small>${spec.height} m</small></h3>
    <h4>特徵 → 零件轉換</h4>
    <table><tr><th>人形特徵(VRM 骨)</th><th>機器人零件</th></tr>${rows}</table>
    <h4>人形比例(身高 1.0 正規化;<span class="ovr-k">黃 = 本機覆寫</span>)</h4>
    <table><tr><th>特徵</th><th>值</th><th>VRM 對應</th></tr>${propRows}</table>
    <h4>rig 契約(locomotion.js 消費通道)</h4>
    <ul class="chan">${chan}</ul>`;
}

function bindToggle(id, fn) {
  const b = $(id);
  b.onclick = () => { b.classList.toggle('on'); fn(b.classList.contains('on')); };
}

// 速度三態(靜止/行走/奔跑):目標速度緩動,加減速演出(launch/spool/brake)才看得到
for (const [id, f] of [['spdIdle', 0], ['spdWalk', 0.32], ['spdRun', 1.0]]) {
  $(id).onclick = () => {
    speedTgt = f * spec.gait.top;
    for (const o of ['spdIdle', 'spdWalk', 'spdRun']) $(o).classList.toggle('on', o === id);
  };
}
$('spdIdle').classList.add('on');

bindToggle('btnFire', (on) => { firing = on; });
$('btnHeavy').onclick = () => {
  if (heavyAt > 0) return;                          // 蓄力中不重入
  ent.heavyFx = { phase: 'charge', t0: simT };
  heavyAt = simT + 1.05;                            // 蓄力假定時長(同 stepCombatFx 的假定)
};
$('btnCastO').onclick = () => { ent.castFx = { t0: simT, slot: 'ult', dir: 0 }; };
$('btnCastD').onclick = () => { ent.castFx = { t0: simT, slot: 'skill', dir: 1 }; };
bindToggle('btnSpin', (on) => { controls.autoRotate = on; });
bindToggle('btnJoints', (on) => { if (unit) unit.joints.visible = on; });
$('btnSpin').classList.add('on');
controls.autoRotate = true;

function resize() {
  const w = canvas.clientWidth, h = canvas.clientHeight;
  if (canvas.width !== w || canvas.height !== h) {
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  }
}

/** 世界推進一步(rAF 與 headless 檢視共用 —— pane 不合成時 rAF 不跑,由 __forge.step 手動步進) */
function stepWorld(dt) {
  simT += dt;

  // 速度緩動 + 跑步機捲動
  speed += (speedTgt - speed) * Math.min(1, 2.2 * dt);
  if (speed < 0.02 && speedTgt === 0) speed = 0;
  travel += speed * dt;
  grid.position.z = -(travel % CELL);

  if (ent) {
    // 輕武器連射:固定射速寫 fireFx(戰場的 tracer 事件同語意)
    if (firing && simT >= nextShot) {
      ent.fireFx = { t0: simT, slot: 'light' };
      nextShot = simT + 0.18;
    }
    // 重武器:蓄力期滿 → 擊發(charge → fire 的相位切換,同 charPreview _fireCue)
    if (heavyAt > 0 && simT >= heavyAt) {
      ent.fireFx = { t0: simT, slot: 'heavy' };
      ent.heavyFx = { phase: 'fire', t0: simT };
      heavyAt = -1;
    }
    // MUST 在 stepLocomotion 之前:本幀步態才吃得到射姿/後座/蓄力驅動場(charPreview:650)
    stepCombatFx(ent, simT, dt);
    stepLocomotion(ent, dt, simT, 0, -speed * dt, 0);
  }
}

function loop() {
  requestAnimationFrame(loop);
  const dt = Math.min(0.05, clock.getDelta());
  resize();
  stepWorld(dt);
  controls.update();
  updateCelLight(camera);
  renderer.render(scene, camera);
}

// ---- headless 檢視(.claude/skills/headless-3d-inspection):pane 不合成 ⇒ rAF 不跑、
// 截圖工具逾時 —— 一律走「手動步進 + 顯式渲染一幀 + POST /__shot 落盤」這條路 ----
window.__shot = async (name, w = 1280, h = 800, opts = {}) => {
  // 空 opts = 不動鏡頭(手擺好的姿勢不被重新取景);yaw 0 = 正面(機體面朝 +z)
  if (opts.yaw != null || opts.dist != null || opts.pitch != null) {
    const H = spec.height;
    const t = new THREE.Vector3(0, H * 0.52, 0);
    const d = opts.dist ?? H * 2.6, yaw = opts.yaw ?? 0, pit = opts.pitch ?? 0.16;
    camera.position.set(
      t.x + Math.sin(yaw) * Math.cos(pit) * d,
      t.y + Math.sin(pit) * d,
      t.z + Math.cos(yaw) * Math.cos(pit) * d);
    camera.lookAt(t);
  }
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
  camera.updateMatrixWorld(true);
  updateCelLight(camera);
  renderer.render(scene, camera);
  const r = await fetch(`/__shot/${name}`, { method: 'POST', body: canvas.toDataURL('image/png') });
  return (await r.json()).path;
};
window.__scene = { scene, camera, renderer, controls, THREE };
window.__forge = {
  specs: () => SPECS.map((s) => s.id),
  setSpec: (id) => setSpec(SPECS.find((s) => s.id === id) || spec),
  ent: () => ent,
  rig: () => unit?.rig,
  setSpeed: (f) => { speedTgt = f * spec.gait.top; },
  fire: (slot) => {
    if (slot === 'heavy') { ent.heavyFx = { phase: 'charge', t0: simT }; heavyAt = simT + 1.05; }
    else ent.fireFx = { t0: simT, slot: 'light' };
  },
  cast: (dir, slot = 'ult') => { ent.castFx = { t0: simT, slot, dir }; },
  step: (n = 1, dt = 1 / 60) => { for (let i = 0; i < n; i++) stepWorld(dt); },
  simT: () => simT,
  joints: (on) => { if (unit) unit.joints.visible = !!on; },
};

setSpec(spec);
loop();
