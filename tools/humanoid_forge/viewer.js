// ============ 機體展示台檢視器(dev-only;不進遊戲)============
// 驗證兩件事:
//   ① 全角度完整 —— 鍛造出來的機體是 360° 實心零件樹(軌道鏡頭 + 自動環繞檢視);
//   ② 可動態移動 —— rig 契約齊全,真品 locomotion.js(stepBiped / stepQuad / stepAerial /
//      stepCombatFx / stepCastPose)一行不改直接驅動。
// 驅動方式鏡射 charPreview.js 的跑步機:機體固定原點、地面反向捲動,
// stepLocomotion 以「假位移」(0, -speed*dt, 0) 量到真實速度 —— 與戰場同一套演算。
//
// 2026-08-12 使用者第四輪:「機體展示台從人形機體擴充到所有機體,根據不同的原型切換管理
// 頁面;武器與機體獨立展示編輯,但加入跳轉連結。」本檔因此有三件新事:
//   ① **分類分頁**:名冊與分類全部取自 roster.js(推導,零手寫清單);缺 mechs/ 檔的格子
//      仍列出來但標「未建模」—— 藏起來的話「還有幾台沒做」就沒有地方看得到。
//   ② **武器獨立檢視**:武器不是另外一棵樹,而是同一棵樹的 `rig.wpn[slot].nodes` 子集
//      (那是 FPV 同源的既有單一縫)。切到武器頁 = 只顯示那個子集 + 依它的包圍盒重新取景,
//      MUST NOT 為了武器台另建一份武器幾何(第二份實作 ⇒ 台上調好的與機體上掛的不是同一把)。
//   ③ **原型參考圖**:2D 定案圖(/api/protoimgs)與真實原型照片(/api/protorefs)並列;
//      兩份名冊都由伺服器端目錄/帳本推導,MUST NOT 在這裡拼檔名。
//
// 旋翼自轉:名冊只有 `unit.spin`(= 戰場 game.js spinners 吃的 `userData.spin` 那一份),
// 本檔每幀推進同一份清單 —— MUST NOT 自己 traverse 場景找槳葉(那就是第二份名冊)。

import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { stepLocomotion, stepCombatFx } from '/public/js/locomotion.js';
import { updateCelLight, disposeTree } from '/public/js/toon.js';
import { SPECS, forgeHumanoidMech, conversionDoc, resolveProp, mergeSpec, HUMANOID } from './forge.js';
import { CATS, rosterByCat, splitKey, FORM_LABEL } from './roster.js';

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
const ROSTER = rosterByCat();
let cat = CATS[0].key;              // 目前管理頁
let view = 'mech';                  // 'mech' | 'light' | 'heavy'(武器獨立檢視)
let unit = null;                    // { group, rig, joints, spin? }
let ent = null;                     // 餵給 locomotion 的假實體
let spec = SPECS[0];
let speed = 0, speedTgt = 0, travel = 0, spdSel = 'spdIdle';
let firing = false, nextShot = 0;
let heavyAt = -1;
let simT = 0;
const clock = new THREE.Clock();
const $ = (id) => document.getElementById(id);
const esc = (s) => String(s).replace(/[&<>"]/g, (m) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[m]));

function setSpec(s) {
  spec = s;
  cat = s.cat;
  if (unit) {
    scene.remove(unit.group);
    disposeTree(unit.group);   // A25:換機體釋放 GPU 資源
  }
  unit = forgeHumanoidMech(mergeSpec(spec, OVR[spec.id]));
  scene.add(unit.group);
  unit.joints.visible = $('btnJoints').classList.contains('on');
  ent = { id: spec.id, mesh: unit.group, heroY: 0 };   // loco 狀態綁 mesh,換機體重建
  speedTgt = 0; speed = 0;
  for (const o of ['spdIdle', 'spdWalk', 'spdRun']) $(o).classList.toggle('on', o === 'spdIdle');
  spdSel = 'spdIdle';
  applyView();
  renderCatButtons();
  renderSpecButtons();
  renderPanel();
}

// ---- 武器獨立檢視 ------------------------------------------------------------
// 「哪些節點屬於這把武器」的唯一真相 = rig.wpn[slot].nodes(FPV 座艙同源的那一份)。
// 顯示 = 只讓那些子樹可見;取景 = 依它們的世界包圍盒。MUST NOT 複製一份武器幾何。
function wpnOf(slot) { return unit?.rig?.wpn?.[slot] || null; }

function applyView() {
  const H = spec.height;
  const w = view === 'mech' ? null : wpnOf(view);
  // 顯示切換:先全開,再在武器模式關掉不屬於該武器的網格
  unit.group.traverse((o) => { if (o.isMesh) o.visible = true; });
  grid.visible = plate.visible = view === 'mech';
  // 武器頁**停止移動**:武器掛在會動的肢體/樞軸上,取景框一旦定住而機體繼續走,
  // 武器就慢慢飄出畫面(2026-08-12 實測 t01 的臂在頭兩幀就從靜姿彈到步態姿)。
  // 這也是語意上對的 —— 武器頁看的是這把武器,不是它的步態。
  if (w) { speedTgt = 0; speed = 0; firing = false; $('btnFire').classList.remove('on'); }
  if (!w) {
    controls.target.set(0, H * 0.52, 0);
    camera.position.set(H * 1.6, H * 0.62, H * 2.1);
    $('stageTag').textContent = `${spec.label} ・ ${spec.kind} 鷹架`;
  } else {
    const keep = new Set();
    for (const n of w.nodes || []) n.traverse((o) => keep.add(o));
    unit.group.traverse((o) => { if (o.isMesh && !keep.has(o)) o.visible = false; });
    // 取景:武器世界包圍盒(空盒 = 這一格沒掛那個 slot,退回機體取景)
    unit.group.updateMatrixWorld(true);
    const box = new THREE.Box3();
    for (const n of w.nodes || []) box.expandByObject(n);
    if (box.isEmpty()) { view = 'mech'; return applyView(); }
    const ctr = box.getCenter(new THREE.Vector3());
    const d = Math.max(0.6, box.getSize(new THREE.Vector3()).length());
    controls.target.copy(ctr);
    camera.position.set(ctr.x + d * 0.9, ctr.y + d * 0.45, ctr.z + d * 1.15);
    $('stageTag').textContent = `${spec.label} ・ ${view === 'light' ? '輕' : '重'}武器(rig.wpn.${view})`;
  }
  camera.near = 0.05; camera.far = 400;
  // **MUST 當場定向**:互動時是 loop 裡的 controls.update() 在轉鏡頭,而 headless 檢視
  // (pane 不合成 ⇒ rAF 不跑)沒有 loop —— 只搬 position 不轉向的話,__shot 拍到的是
  // 上一個取景的朝向,武器就落在畫面角落(2026-08-12 實測)。
  camera.lookAt(controls.target);
  camera.updateMatrixWorld(true);
  controls.update();
  for (const [id, v] of [['vMech', 'mech'], ['vWpnL', 'light'], ['vWpnH', 'heavy']])
    $(id).classList.toggle('on', view === v);
}

// ---- UI ----------------------------------------------------------------------
function renderCatButtons() {
  const box = $('catSeg');
  box.innerHTML = '';
  for (const c of ROSTER) {
    const done = c.entries.filter((e) => SPECS.some((s) => s.id === e.key)).length;
    const b = document.createElement('button');
    b.className = 'segb' + (c.key === cat ? ' cat-on' : '');
    b.innerHTML = `${c.label} <span class="fm">${done}/${c.entries.length}</span>`;
    b.title = c.tip;
    b.onclick = () => {
      cat = c.key;
      const first = SPECS.find((s) => s.cat === cat);
      if (first) setSpec(first); else { renderCatButtons(); renderSpecButtons(); }
    };
    box.appendChild(b);
  }
}

function renderSpecButtons() {
  const box = $('specSeg');
  box.innerHTML = '';
  const group = ROSTER.find((c) => c.key === cat);
  for (const e of group.entries) {
    const s = SPECS.find((x) => x.id === e.key);
    const b = document.createElement('button');
    if (!s) {
      b.className = 'segb missing';
      b.textContent = `${e.id}${e.form ? `・${e.formLabel}` : ''}(未建模)`;
      b.disabled = true;
    } else {
      b.className = 'segb' + (s === spec ? ' on' : '');
      b.innerHTML = `${esc(e.id)} ${esc(e.label)}${e.form ? ` <span class="fm">${e.formLabel}</span>` : ''}`;
      b.onclick = () => setSpec(s);
    }
    box.appendChild(b);
  }
}

// ---- 2D 定案圖 / 原型參考照(名冊皆由伺服器推導;MUST NOT 在這裡拼檔名)----
const IMG_CACHE = new Map();
async function apiImgs(url) {
  if (!IMG_CACHE.has(url)) {
    try {
      const r = await fetch(url);
      IMG_CACHE.set(url, r.ok ? await r.json() : {});
    } catch { IMG_CACHE.set(url, {}); }
  }
  return IMG_CACHE.get(url);
}
const protoCap = (file) => {
  const form = file.includes('_flight_') ? '飛行型・' : file.includes('_ground_') ? '地面型・' : '';
  const pose = file.includes('moving') ? '移動' : file.includes('heavy') ? '重擊' : '定裝';
  return form + pose;
};
/** 2D 定案圖:變形者只列**本型態**那幾張(飛行型的頁面不該拿地面型的圖當建模依據) */
async function fillArtStrip(forId) {
  const box = $('artStrip');
  if (!box) return;
  const j = await apiImgs(`/api/protoimgs?id=${spec.ch}`);
  if (spec.id !== forId || !$('artStrip')) return;             // 面板已換機
  const want = spec.form === 'flight' ? '_flight_' : spec.form === 'ground' ? '_ground_' : null;
  const imgs = (j.imgs || []).filter((m) => !want || m.file.includes(want));
  box.innerHTML = imgs.length
    ? imgs.map((m) => `<figure class="proto"><a href="${m.url}" target="_blank" rel="noopener">
        <img src="${m.url}" alt="${esc(m.file)}" loading="lazy"></a>
        <figcaption>${protoCap(m.file)}</figcaption></figure>`).join('')
    : '<div class="dim">(這一格還沒有 2D 定案圖)</div>';
}
/** 真實原型照片(動物/機型):關鍵詞來自 MECHA[].proto,採集與授權帳走 fetch_protorefs.mjs */
async function fillRefStrip(forId) {
  const box = $('refStrip');
  if (!box) return;
  const j = await apiImgs(`/api/protorefs?key=${encodeURIComponent(spec.id)}`);
  if (spec.id !== forId || !$('refStrip')) return;
  const rows = j.layers || [];
  box.innerHTML = rows.length ? rows.map((L) => `
    <div class="ref-src"><b>${esc(L.label)}</b> ${esc(L.src)}
      ${L.note ? `<span>—— ${esc(L.note)}</span>` : ''}</div>
    <div class="proto-strip">${L.imgs.length
    ? L.imgs.map((m) => `<figure class="proto"><a href="${m.url}" target="_blank" rel="noopener">
          <img src="${m.url}" alt="${esc(m.file)}" loading="lazy"></a>
          <figcaption>${esc(m.license)} ・ ${esc(m.creator || '—')}</figcaption></figure>`).join('')
    : '<div class="dim">(未採集;跑 node tools/fetch_protorefs.mjs)</div>'}</div>`).join('')
    : '<div class="dim">(這一格沒有原型層)</div>';
}

function renderPanel() {
  const quad = spec.kind === 'quad', air = spec.kind === 'air';
  const p = resolveProp(spec);
  const rows = conversionDoc(spec)
    .map((r) => `<tr><td>${esc(r.feat)}</td><td>${esc(r.part)}</td></tr>`).join('');
  const propRows = Object.keys(HUMANOID)
    .map((k) => {
      const ovr = spec.prop?.[k] != null;
      return `<tr class="${ovr ? 'ovr' : ''}"><td>${k}</td><td>${p[k]}</td><td>${HUMANOID[k].vrm}</td></tr>`;
    }).join('');
  const rig = unit.rig;
  // rig 契約檢查依鷹架分流:quad 鏡射 models.js buildBeastMech、air 鏡射 buildDrone 家族、
  // 其餘同 buildRobotMech
  const chan = (air ? [
    ['tilt(壓坡樞軸)+ tiltY0/bob/top', !!(rig.tilt && rig.tiltY0 != null && rig.top)],
    ['升力系統(旋翼 / 撲翼 / 噴焰)', !!(unit.spin?.length || rig.wings?.length || rig.jets?.length)],
    ['level(定翼巡航不低頭)', rig.level ? true : !rig.level],
    ['weap/hvy/kickAmp(後座)', !!(rig.weap && rig.hvy && rig.kickAmp)],
    ['muzzles + wpn(槍口/FPV 同源)', !!(rig.muzzles?.light && rig.muzzles?.heavy && rig.wpn?.light && rig.wpn?.heavy)],
    ['moveSig / castSig(性格層)', !!(rig.moveSig && rig.castSig)],
  ] : quad ? [
    ['spine/chest/neck/head', !!(rig.spine && rig.chest && rig.neck && rig.head)],
    ['legFL/FR/HL/HR + ch ×4', !!(rig.legFL && rig.legFR && rig.legHL && rig.legHR
      && rig.chFL?.length && rig.chFR?.length && rig.chHL?.length && rig.chHR?.length)],
    ['tailSegs(尾鞭)', !!(rig.tailSegs && rig.tailSegs.length >= 2)],
    ['gait 參數(stride/top/bob)', !!(rig.stride && rig.top && rig.bob != null)],
    ['weap/hvy/kickAmp(後座)', !!(rig.weap && rig.hvy && rig.kickAmp)],
    ['muzzles + wpn(槍口/FPV 同源)', !!(rig.muzzles?.light && rig.muzzles?.heavy && rig.wpn?.light && rig.wpn?.heavy)],
    ['moveSig / castSig(性格層)', !!(rig.moveSig && rig.castSig)],
  ] : [
    ['hips/chest/head', !!(rig.hips && rig.chest && rig.head)],
    ['legL/R + legChain ×2', !!(rig.legL && rig.legChainL.length === 2 && rig.legChainR.length === 2)],
    ['armL/R + armChain ×2', !!(rig.armL && rig.armChainL.length === 2 && rig.armChainR.length === 2)],
    ['aimPose(據槍)', !!rig.aimPose],
    ['gunR/gunL(俯仰)', !!(rig.gunR && rig.gunL)],
    ['weap/hvy/kickAmp(後座)', !!(rig.weap && rig.hvy && rig.kickAmp)],
    ['muzzles + wpn(槍口/FPV 同源)', !!(rig.muzzles?.light && rig.muzzles?.heavy && rig.wpn?.light && rig.wpn?.heavy)],
    ['moveSig / castSig(性格層)', !!(rig.moveSig && rig.castSig)],
  ]).map(([n, ok]) => `<li class="${ok ? 'ok' : 'bad'}">${ok ? '✓' : '✗'} ${n}</li>`).join('');

  // 武器區塊(跳轉連結:機體 ⇄ 武器;兩邊是同一棵樹的兩個取景)
  const wl = unit.rig.wpn?.light, wh = unit.rig.wpn?.heavy;
  const jumps = view === 'mech'
    ? `${wl ? '<span class="jump" data-go="light">→ 檢視輕武器</span>' : ''}
       ${wh ? '<span class="jump" data-go="heavy">→ 檢視重武器</span>' : ''}`
    : `<span class="jump" data-go="mech">← 回到機體</span>
       <span class="jump" data-go="${view === 'light' ? 'heavy' : 'light'}">
       → 換${view === 'light' ? '重' : '輕'}武器</span>`;

  $('panel').innerHTML = `
    <h3>${esc(spec.label)} <small>${spec.height} m ・ ${esc(spec.ch)}${spec.form ? `・${FORM_LABEL[spec.form]}` : ''}</small></h3>
    <div>${jumps}</div>
    ${view === 'mech' ? '' : `<div class="note">武器檢視 = 同一棵零件樹的 rig.wpn.${view}.nodes 子集
      (FPV 座艙同源的那一份),不是另建的第二份幾何。長度旋鈕 = knobs.barrelF。</div>`}
    <h4>2D 定案圖(建模設計權威;點圖開大圖)</h4>
    <div id="artStrip" class="proto-strip"><div class="dim">載入中…</div></div>
    <h4>真實原型參考照(CC0/PD;關鍵詞取自 mecha.js proto)</h4>
    <div id="refStrip"><div class="dim">載入中…</div></div>
    <h4>特徵 → 零件轉換</h4>
    <table><tr><th>${air ? '機體特徵' : quad ? '生物特徵' : '人形特徵(VRM 骨)'}</th><th>零件</th></tr>${rows}</table>
    ${quad || air ? '' : `<h4>人形比例(身高 1.0 正規化;<span class="ovr-k">黃 = 本機覆寫</span>)</h4>
    <table><tr><th>特徵</th><th>值</th><th>VRM 對應</th></tr>${propRows}</table>`}
    <h4>rig 契約(locomotion.js 消費通道)</h4>
    <ul class="chan">${chan}</ul>`;
  for (const el of $('panel').querySelectorAll('.jump'))
    el.onclick = () => { view = el.dataset.go; applyView(); renderPanel(); };
  fillArtStrip(spec.id);
  fillRefStrip(spec.id);
}

function bindToggle(id, fn) {
  const b = $(id);
  b.onclick = () => { b.classList.toggle('on'); fn(b.classList.contains('on')); };
}

// 速度三態:目標速度緩動,加減速演出(launch/spool/brake)才看得到
for (const [id, f] of [['spdIdle', 0], ['spdWalk', 0.32], ['spdRun', 1.0]]) {
  $(id).onclick = () => {
    speedTgt = f * (spec.kind === 'air' ? (spec.air?.top ?? 30) : (spec.gait?.top ?? 8));
    spdSel = id;
    for (const o of ['spdIdle', 'spdWalk', 'spdRun']) $(o).classList.toggle('on', o === id);
  };
}
$('spdIdle').classList.add('on');

bindToggle('btnFire', (on) => { firing = on; });
$('btnHeavy').onclick = () => {
  if (heavyAt > 0) return;
  ent.heavyFx = { phase: 'charge', t0: simT };
  heavyAt = simT + 1.05;
};
$('btnCastO').onclick = () => { ent.castFx = { t0: simT, slot: 'ult', dir: 0 }; };
$('btnCastD').onclick = () => { ent.castFx = { t0: simT, slot: 'skill', dir: 1 }; };
bindToggle('btnSpin', (on) => { controls.autoRotate = on; });
bindToggle('btnJoints', (on) => { if (unit) unit.joints.visible = on; });
$('btnSpin').classList.add('on');
controls.autoRotate = true;
for (const [id, v] of [['vMech', 'mech'], ['vWpnL', 'light'], ['vWpnH', 'heavy']])
  $(id).onclick = () => { view = v; applyView(); renderPanel(); };

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
  speed += (speedTgt - speed) * Math.min(1, 2.2 * dt);
  if (speed < 0.02 && speedTgt === 0) speed = 0;
  travel += speed * dt;
  grid.position.z = -(travel % CELL);

  if (ent) {
    if (firing && simT >= nextShot) {
      ent.fireFx = { t0: simT, slot: 'light' };
      nextShot = simT + 0.18;
    }
    if (heavyAt > 0 && simT >= heavyAt) {
      ent.fireFx = { t0: simT, slot: 'heavy' };
      ent.heavyFx = { phase: 'fire', t0: simT };
      heavyAt = -1;
    }
    // MUST 在 stepLocomotion 之前:本幀步態才吃得到射姿/後座/蓄力驅動場(charPreview:650)
    stepCombatFx(ent, simT, dt);
    stepLocomotion(ent, dt, simT, 0, -speed * dt, 0);
  }
  // 旋翼自轉:與戰場同一份名冊(userData.spin);轉速隨速度(靜止仍怠速轉)
  if (unit?.spin?.length) {
    const k = 6 + (speed / Math.max(1, spec.air?.top ?? 30)) * 26;
    for (let i = 0; i < unit.spin.length; i++) unit.spin[i].rotation.y += dt * k * (i % 2 ? -1 : 1);
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
  if (opts.yaw != null || opts.dist != null || opts.pitch != null) {
    const H = spec.height;
    const t = controls.target.clone();
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
  cats: () => ROSTER.map((c) => ({ key: c.key, n: c.entries.length,
    done: c.entries.filter((e) => SPECS.some((s) => s.id === e.key)).length })),
  setSpec: (id) => setSpec(SPECS.find((s) => s.id === id) || spec),
  setView: (v) => { view = v; applyView(); renderPanel(); },
  reframe: () => applyView(),      // 步進之後重新取景(headless 拍武器頁用)
  ent: () => ent,
  rig: () => unit?.rig,
  setSpeed: (f) => { speedTgt = f * (spec.kind === 'air' ? (spec.air?.top ?? 30) : (spec.gait?.top ?? 8)); },
  fire: (slot) => {
    if (slot === 'heavy') { ent.heavyFx = { phase: 'charge', t0: simT }; heavyAt = simT + 1.05; }
    else ent.fireFx = { t0: simT, slot: 'light' };
  },
  cast: (dir, slot = 'ult') => { ent.castFx = { t0: simT, slot, dir }; },
  step: (n = 1, dt = 1 / 60) => { for (let i = 0; i < n; i++) stepWorld(dt); },
  simT: () => simT,
  joints: (on) => { if (unit) unit.joints.visible = !!on; },
};

setSpec(SPECS[0]);
loop();
