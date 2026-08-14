// ============ 機體展示台(兩座看板共用的**唯一一座**;dev-only)============
// 2026-08-14 使用者三條:「展示台加入輕重武器和大小招的按鍵,按鍵全部換圖示」+
// 「機體鍛造的建模展示直接套用展示台」+「機體鍛造加入不同版本的建模切換」。
//
// 病灶:機體台(:8631 viewer.js)與覆核台的機體鍛造區塊(:8621 review.js)各自建了一份
// 場景/燈/跑步機地面/軌道鏡頭/逐幀迴圈/檢視切換/演出鈕。兩份「長得很像」的展示台會各自演化 ——
// 實測差異已經是:鍛造那邊沒有型態、沒有版本、沒有樞軸、招式只有一顆(而且恆送 ult+全向)、
// 取景鏡距與展示台差 0.2H。使用者說的是「**直接套用**展示台」,不是「照著再做一個」。
// ⇒ 場景與演出整組收進本檔,兩座看板只負責「把 canvas 與工具列掛到自己的版面上」。
//
// 三條紀律:
//   ① **這裡不碰任何 DOM 版面**:`mount(host, bar)` 由呼叫端給兩個容器,本檔只往裡面塞
//      canvas 與工具列。看板的欄位/面板/名冊一律留在看板自己那邊。
//   ② **建構走版本表**(versions.js),本檔一行 `if (版本 === …)` 都沒有 —— 兩座看板因此
//      **同時**拿到版本切換(使用者第三條),而不是各接一次。
//   ③ **演出的語意到原處取**:招式的定向/全向走 `data.js castDirF`(戰場與圖鑑展示台同一支);
//      鈕面只負責把 slot 送進去,MUST NOT 在這裡自己判「這招是不是指向型」。
//
// 鈕面全部是圖示(使用者:「按鍵全部換圖示」):名冊 = 下面的 `BARS` 一張表,
// 文字改住 `title`(hover 看得到)+ 舞台抬頭(台上是哪一版/哪個型態/哪個檢視,用字說)。
// 圖示是 24×24 平塗 SVG 吃 `currentColor` —— 與遊戲的 `npcicon.js` 同款,MUST NOT 改成點陣圖。

import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { stepLocomotion, stepCombatFx } from '/public/js/locomotion.js';
import { updateCelLight, disposeTree } from '/public/js/toon.js';
import { MORPH, heroAbility, castDirF } from '/public/js/data.js';
import { FORM_LABEL } from '../../public/js/forge/roster.js';
import { STAGE_VERSIONS, versionOf, siblingSpec } from './versions.js';
import { wpnOf, showWpn, wpnFrame, applyWpnCamera, wpnSlotName } from './wpnview.js';

// ---- 圖示(24×24,吃 currentColor)------------------------------------------------
const svg = (d, extra = '') => `<svg viewBox="0 0 24 24" width="18" height="18" fill="none"
  stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${d}${extra}</svg>`;
export const ICONS = {
  mech: svg('<circle cx="12" cy="5" r="2.4"/><path d="M12 7.4v7M7 9.5h10M8 21l4-6.6 4 6.6"/>'),
  wpnL: svg('<path d="M3 11h11l3 3h4M6 11v3M9 14l-2 4"/>'),
  wpnH: svg('<path d="M3 9h9v5H3zM12 11.5h9M18 8.5v6"/>'),
  ground: svg('<path d="M4 18h16M8 6l4 7 4-7"/>'),
  flight: svg('<path d="M3 15l9-9 9 9M6 19h12"/>'),
  idle: svg('<path d="M9 6v12M15 6v12"/>'),
  walk: svg('<path d="M8 4l7 8-7 8"/>'),
  run: svg('<path d="M4 4l7 8-7 8M13 4l7 8-7 8"/>'),
  fire: svg('<path d="M4 12h6M12 12h1.5M15 12h1.5M18 12h2M12 6.5l1.5 2M12 17.5l1.5-2M17 5l1 2.5M17 19l1-2.5"/>'),
  heavy: svg('<circle cx="12" cy="12" r="3"/><path d="M12 2.5v3.5M12 18v3.5M2.5 12h3.5M18 12h3.5M5.5 5.5l2.4 2.4M16.1 16.1l2.4 2.4M18.5 5.5l-2.4 2.4M7.9 16.1l-2.4 2.4"/>'),
  skill: svg('<path d="M12 4l1.9 5.1L19 11l-5.1 1.9L12 18l-1.9-5.1L5 11l5.1-1.9z"/>'),
  ult: svg('<path d="M12 2l2.4 6.6L21 11l-6.6 2.4L12 20l-2.4-6.6L3 11l6.6-2.4z"/><path d="M19 17.5l.9 2.1 2.1.9-2.1.9-.9 2.1"/>'),
  spin: svg('<path d="M20 12a8 8 0 1 1-2.7-6"/><path d="M20 4v4.5h-4.5"/>'),
  joints: svg('<circle cx="6" cy="6" r="2"/><circle cx="18" cy="6" r="2"/><circle cx="12" cy="18" r="2"/><path d="M7.5 7.5l3.3 8.8M16.5 7.5l-3.3 8.8M8 6h8"/>'),
  verNew: svg('<path d="M12 3l2 5.4 5.4 2-5.4 2-2 5.4-2-5.4-5.4-2 5.4-2z"/><path d="M5 20h14"/>'),
  verOld: svg('<circle cx="12" cy="12" r="8.5"/><path d="M12 7v5.4l3.4 2"/>'),
};

/** 工具列名冊:一列 = 一組互斥/開關鈕。`kind` 決定行為,`key` 是鈕的識別。
 *  版本與型態兩組是**推導**出來的(STAGE_VERSIONS / FORM_LABEL),MUST NOT 手寫。 */
const BARS = [
  { group: '檢視', kind: 'view', btns: [
    ['mech', 'mech', '機體'], ['light', 'wpnL', '輕武器(rig.wpn.light 子集)'],
    ['heavy', 'wpnH', '重武器(rig.wpn.heavy 子集)']] },
  { group: '型態', kind: 'form', btns: null },      // ← FORM_LABEL 推導
  { group: '速度', kind: 'speed', btns: [
    ['idle', 'idle', '靜止'], ['walk', 'walk', '巡航'], ['run', 'run', '全速']] },
  // 使用者第一條:演出改成「輕武器 / 重武器 / 小招 / 大招」四顆(舊制是連射/蓄力 +
  // 全向招式/定向招式 —— 後兩顆把**槽位**與**動作方向**混在一起,而方向本來就該由招式自己推)
  { group: '演出', kind: 'play', btns: [
    ['light', 'fire', '輕武器射擊(持續)'], ['heavy', 'heavy', '重武器蓄力擊發'],
    ['skill', 'skill', '小招'], ['ult', 'ult', '大招']] },
  { group: '視角', kind: 'toggle', btns: [
    ['spin', 'spin', '自動環繞'], ['joints', 'joints', '樞軸點']] },
  { group: '版本', kind: 'ver', btns: null },       // ← STAGE_VERSIONS 推導
];

const CELL = 2;          // 跑步機格距(地面反向捲動 = 速度的視覺參照)
const FLY_LIFT = 0.22;   // 飛行型離地懸停(× 建模基準高;鏡射 charPreview 的同一組係數)
const FLY_BOB = 0.04;

/**
 * 造一座展示台。
 * @param opts.alpha    背景透明(覆核台嵌在面板裡要透;機體台是整片舞台)
 * @param opts.ovrOf    (id) => 使用者覆寫層那一格(specs.json;缺席 = 全走出廠規格)
 * @param opts.onBuild  每次重鍛之後(看板拿去重畫「這一台的結構欄」之類的)
 */
export function makeStage({ alpha = false, ovrOf = () => null, onBuild = null } = {}) {
  const canvas = document.createElement('canvas');
  canvas.className = 'fstage-canvas';
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha });
  renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
  if (!alpha) renderer.setClearColor(0x171a21);

  const scene = new THREE.Scene();
  if (!alpha) scene.fog = new THREE.Fog(0x171a21, 60, 140);
  const camera = new THREE.PerspectiveCamera(38, 1, 0.1, 400);
  // 燈光鏡射 charPreview(賽璐璐 ramp 吃的是 toon.js 共用光向,由 updateCelLight 每幀更新)
  const dir = new THREE.DirectionalLight(0xffffff, 2.1);
  dir.position.set(0.4, 0.8, 0.4).multiplyScalar(50);
  scene.add(dir, new THREE.HemisphereLight(0xdff1ff, 0x2b2f38, 1.1));

  const grid = new THREE.GridHelper(80, 40, 0x39414f, 0x262c36);
  scene.add(grid);
  const plate = new THREE.Mesh(new THREE.CircleGeometry(40, 48),
    new THREE.MeshBasicMaterial({ color: 0x1b1f27 }));
  plate.rotation.x = -Math.PI / 2;
  plate.position.y = -0.02;
  plate.visible = !alpha;                 // 透明背景的看板不鋪底盤(它自己的面板就是底)
  scene.add(plate);

  const controls = new OrbitControls(camera, canvas);
  controls.enableDamping = true;
  controls.dampingFactor = 0.08;
  controls.autoRotateSpeed = 1.6;
  controls.autoRotate = true;

  const clock = new THREE.Clock();
  const st = {
    canvas, renderer, scene, camera, controls, THREE,
    spec: null, unit: null, ent: null, ver: STAGE_VERSIONS[0],
    view: 'mech', draft: null,
    // 內部狀態
    _key: null, _formT: 0, _speed: 0, _speedTgt: 0, _spdSel: 'idle', _travel: 0,
    _firing: false, _nextShot: 0, _heavyAt: -1, _t: 0, _reframe: false, _bar: null,
    _edit: false, _spin: true, _joints: false, _tag: null, _onBuild: onBuild,
  };

  // ---- 建構 -------------------------------------------------------------------
  const keyOf = (s) => `${st.ver.key}|${s.form ? s.ch : s.id}`;

  function showJoints(on) {
    st._joints = on;
    for (const j of st.unit?.joints || []) j.visible = on && st.ver.caps.joints;
  }

  function build() {
    if (st.unit) { scene.remove(st.unit.group); disposeTree(st.unit.group); }   // A25
    st.unit = st.ver.build(st.spec, { ovrOf, draft: st.draft });
    st._key = keyOf(st.spec);
    scene.add(st.unit.group);
    showJoints(st._joints);
    st.ent = { id: st.spec.id, mesh: st.unit.group, heroY: 0 };   // loco 狀態綁 mesh
    st._onBuild?.(st.unit, st.spec);
  }

  /** 換到某一格。同一台變形者的另一個型態 **MUST NOT 重鍛**(重鍛把 locomotion 的型態狀態
   *  一起丟掉 ⇒ 收摺/換樹/展開整段不見,看到的是瞬切)。 */
  st.setSpec = (spec, draft = null, { reframe = true } = {}) => {
    const keep = !!st.unit && st.spec && keyOf(spec) === st._key;
    st.spec = spec;
    st.draft = draft;
    st._formT = spec.form === 'flight' ? 1 : 0;
    if (keep) { if (st.unit.dolls) st.unit.doll = st.unit.dolls[spec.form] || null; } else build();
    st.setSpeed('idle');
    st.applyView(reframe);
  };
  /** 結構改動(紙娃娃編輯的每一次拖曳)→ 重鍛;取景刻意不動 */
  st.rebuild = (draft = st.draft) => { st.draft = draft; build(); st.applyView(false); };
  st.setVersion = (key) => {
    st.ver = versionOf(key);
    if (!st.ver.caps.wpn) st.view = 'mech';
    build();
    st.applyView(true);
  };
  /** 型態鈕 = 選另一格(名冊的單位本來就是 (機體, 型態));回傳要換到的那一格給呼叫端同步版面 */
  st.formSpec = (f) => (!st.spec.form ? null : (st.spec.form === f ? st.spec : siblingSpec(st.spec)));
  /** 有哪些建模版本(看板的 headless 入口用;名冊仍只有 versions.js 一份) */
  st.versions = () => STAGE_VERSIONS.map((v) => v.key);

  // ---- 檢視(機體 / 輕武器 / 重武器)-------------------------------------------
  st.applyView = (reframe = true) => {
    const H = st.spec.height;
    if (reframe) st._reframe = true;      // 姿勢落定後再量一次(見 step 那一條)
    const w = st.view === 'mech' ? null : wpnOf(st.unit, st.view);
    showWpn(st.unit, st.view);            // 顯示子集(切回機體時尊重紙娃娃的隱藏覆寫)
    grid.visible = st.view === 'mech';
    plate.visible = !alpha && st.view === 'mech';
    // 武器頁**停止移動**:武器掛在會動的肢體上,取景框定住而機體繼續走 ⇒ 武器飄出畫面
    if (w) { st._speedTgt = 0; st._speed = 0; st._firing = false; }
    if (!w) {
      if (reframe) {
        controls.target.set(0, H * 0.52, 0);
        camera.position.set(H * 1.6, H * 0.62, H * 2.1);
      }
    } else {
      const f = wpnFrame(st.unit, st.view);
      if (!f) { st.view = 'mech'; return st.applyView(reframe); }
      if (reframe) applyWpnCamera(camera, controls.target, f);
    }
    camera.near = 0.05; camera.far = 400;
    // **MUST 當場定向**:headless 檢視(pane 不合成 ⇒ rAF 不跑)沒有 loop,只搬 position
    // 不轉向的話拍到的是上一個取景的朝向(2026-08-12 實測)
    camera.lookAt(controls.target);
    camera.updateMatrixWorld(true);
    controls.update();
    syncBar();
    return undefined;
  };
  st.setView = (v) => { st.view = v; st.applyView(true); };

  // ---- 演出 -------------------------------------------------------------------
  st.setSpeed = (sel) => {
    const f = { idle: 0, walk: 0.32, run: 1 }[sel] ?? 0;
    st._spdSel = sel;
    st._speedTgt = f * (st.spec.kind === 'air' ? (st.spec.air?.top ?? 30) : (st.spec.gait?.top ?? 8));
    if (!f) st._speed = Math.min(st._speed, 0);
    syncBar();
  };
  /**
   * 播一次演出。slot ∈ light|heavy|skill|ult。
   * 招式的**定向/全向**到原處取(`castDirF`;戰場與圖鑑展示台同一支)——
   * 鈕面只送槽位,MUST NOT 在這裡自己判「這招是不是指向型」(第三份實作)。
   */
  st.play = (slot) => {
    if (!st.ent) return;
    if (slot === 'light') { st._firing = !st._firing; syncBar(); return; }
    if (slot === 'heavy') {
      if (st._heavyAt > 0) return;
      st.ent.heavyFx = { phase: 'charge', t0: st._t };
      st._heavyAt = st._t + 1.05;
      return;
    }
    const a = heroAbility(st.spec.ch, slot, 1);
    st.ent.castFx = { t0: st._t, slot, dir: castDirF(a?.fx, (a?.range || 0) > 0) };
  };
  st.setSpin = (on) => { st._spin = on; controls.autoRotate = on && !st._edit; syncBar(); };
  st.setJoints = (on) => { showJoints(on); syncBar(); };
  /** 編輯模式:一邊自轉一邊拖 gizmo,拖到的是「拖的那一瞬間鏡頭在的地方」⇒ 編輯時停自轉 */
  st.setEdit = (on) => { st._edit = on; controls.autoRotate = st._spin && !on; };

  // ---- 每幀 -------------------------------------------------------------------
  function step(dt) {
    st._t += dt;
    st._speed += (st._speedTgt - st._speed) * Math.min(1, 2.2 * dt);
    if (st._speed < 0.02 && st._speedTgt === 0) st._speed = 0;
    st._travel += st._speed * dt;
    grid.position.z = -(st._travel % CELL);
    if (!st.ent) return;
    if (st._firing && st._t >= st._nextShot) {
      st.ent.fireFx = { t0: st._t, slot: 'light' };
      st._nextShot = st._t + 0.18;
    }
    if (st._heavyAt > 0 && st._t >= st._heavyAt) {
      st.ent.fireFx = { t0: st._t, slot: 'heavy' };
      st.ent.heavyFx = { phase: 'fire', t0: st._t };
      st._heavyAt = -1;
    }
    // 變形過程:型態只推「回報高度」過門檻,收摺/換樹/展開一律由真品 locomotion 演
    // (新版 morphSwap / 舊版 stepMorph)。門檻推導自 MORPH.GROUND_Y,×2 是阻尼過衝的餘裕。
    st.ent.heroY = st._formT * MORPH.GROUND_Y * 2;
    // MUST 在 stepLocomotion 之前:本幀步態才吃得到射姿/後座/蓄力驅動場
    stepCombatFx(st.ent, st._t, dt);
    stepLocomotion(st.ent, dt, st._t, 0, -st._speed * dt, 0);
    if (st._reframe && st.view !== 'mech') { st._reframe = false; st.applyView(true); }
    // 飛行型離地懸停:型態進度只**讀** locomotion 算好的那一份(自己再阻尼一次 = 第二條曲線)
    const m = st.morphM();
    st.unit.group.position.y = m * st.spec.height * (FLY_LIFT + Math.sin(st._t * 2.4) * FLY_BOB);
    // 旋翼自轉:與戰場同一份名冊(userData.spin);轉速隨速度(靜止仍怠速轉)
    if (st.unit.spin?.length) {
      const k = 6 + (st._speed / Math.max(1, st.spec.air?.top ?? 30)) * 26;
      for (let i = 0; i < st.unit.spin.length; i++) st.unit.spin[i].rotation.y += dt * k * (i % 2 ? -1 : 1);
    }
  }
  st.step = (n = 1, dt = 1 / 60) => { for (let i = 0; i < n; i++) step(dt); };
  st.morphM = () => st.unit?.morph?.m ?? st.ent?.loco?.morph ?? 0;
  st.render = () => {
    const w = canvas.clientWidth, h = canvas.clientHeight;
    if (w && h && (canvas.width !== w || canvas.height !== h)) {
      renderer.setSize(w, h, false);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
    }
    updateCelLight(camera);   // 兩座台各自 set→render,互不留殘影
    renderer.render(scene, camera);
  };
  function loop() {
    requestAnimationFrame(loop);
    if (!canvas.isConnected || !st.unit) return;
    step(Math.min(0.05, clock.getDelta()));
    controls.update();
    st.render();
  }
  requestAnimationFrame(loop);

  // ---- 工具列(圖示鈕;兩座看板同一份名冊)---------------------------------------
  function barHTML() {
    const seg = (kind, btns) => `<div class="seg fbar-seg" data-kind="${kind}">${btns.map(
      ([key, icon, title]) => `<button class="segb ico" data-kind="${kind}" data-key="${key}"
        title="${title}" aria-label="${title}">${ICONS[icon] || ''}</button>`).join('')}</div>`;
    return BARS.map((b) => {
      const btns = b.kind === 'form'
        ? Object.entries(FORM_LABEL).map(([f, label]) => [f, f, label])
        : b.kind === 'ver'
          ? STAGE_VERSIONS.map((v) => [v.key, v.icon, `${v.label} —— ${v.tip}`])
          : b.btns;
      return `<span class="fbar-lb">${b.group}</span>${seg(b.kind, btns)}`;
    }).join('');
  }
  /** 鈕面 = 這個版本/這一格**真的做得到**的事。灰掉而不是藏起來:少一顆鈕會讓人以為
   *  那個功能不存在,灰掉才讀得出「這一版沒有」。 */
  function syncBar() {
    if (!st._bar || !st.spec) return;   // 還沒上台(mount 可以排在第一次 setSpec 之前)
    const on = (kind, key) => {
      switch (kind) {
        case 'view': return st.view === key;
        case 'form': return st.spec?.form === key;
        case 'speed': return st._spdSel === key;
        case 'ver': return st.ver.key === key;
        case 'toggle': return key === 'spin' ? st._spin : st._joints;
        case 'play': return key === 'light' ? st._firing : false;
        default: return false;
      }
    };
    const off = (kind, key) => {
      if (kind === 'view') return key !== 'mech' && (!st.ver.caps.wpn || !wpnOf(st.unit, key));
      if (kind === 'form') return !st.spec?.form;
      if (kind === 'toggle') return key === 'joints' && !st.ver.caps.joints;
      return false;
    };
    for (const b of st._bar.querySelectorAll('button[data-key]')) {
      const { kind, key } = b.dataset;
      b.classList.toggle('on', on(kind, key));
      b.disabled = off(kind, key);
    }
    if (st._tag) {
      const fm = st.spec.form ? ` ・ ${FORM_LABEL[st.spec.form]}` : '';
      const vw = st.view === 'mech' ? '' : ` ・ ${wpnSlotName(st.view)}武器(rig.wpn.${st.view})`;
      st._tag.textContent = `${st.spec.pilot?.machine || st.spec.label}${fm}`
        + ` ・ ${st.spec.kind} 鷹架 ・ ${st.ver.label}${vw}`;
    }
  }
  st.syncBar = syncBar;

  /**
   * 掛上版面。`host` 放 canvas、`bar` 放工具列、`tag`(選用)是舞台抬頭那一行字。
   * `onPick(kind, key)` 讓看板攔下需要它同步的兩種切換(型態 = 換名冊那一格 / 版本 = 重畫面板);
   * 沒攔的一律由本檔自己吃掉。
   */
  st.mount = (host, bar, { tag = null, onPick = null } = {}) => {
    host.prepend(canvas);
    st._tag = tag;
    if (bar && bar !== st._bar) {
      bar.innerHTML = barHTML();
      bar.onclick = (e) => {
        const b = e.target.closest('button[data-key]');
        if (!b || b.disabled) return;
        const { kind, key } = b.dataset;
        if (onPick?.(kind, key)) { syncBar(); return; }   // 看板要自己處理(回 true = 已吃掉)
        if (kind === 'view') st.setView(key);
        else if (kind === 'speed') st.setSpeed(key);
        else if (kind === 'play') st.play(key);
        else if (kind === 'ver') st.setVersion(key);
        else if (kind === 'toggle') (key === 'spin' ? st.setSpin(!st._spin) : st.setJoints(!st._joints));
        else if (kind === 'form') { const s = st.formSpec(key); if (s) st.setSpec(s, null, { reframe: false }); }
        syncBar();
      };
      st._bar = bar;
    }
    syncBar();
  };

  return st;
}
