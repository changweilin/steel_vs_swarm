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
import { CATS, catOf, rosterByCat, splitKey, FORM_LABEL } from './roster.js';
import { makeDollEditor } from './dolledit.js';
import {
  fetchArt, fetchRefs, dropRefsCache, artStripHTML, refStripHTML, bindRefStrip,
} from './refstrip.js';
// 頭像路徑只有 portraits.js 一份(手繪在冊就回檔案、不在冊回程序生成的 data URI)。
// 回傳值是**相對 public/ 的路徑** —— 遊戲頁面的根就是 public/,而本台的根是儲存庫根,
// 故消費端補前綴;MUST NOT 在這裡另寫一份 `assets/avatars/${id}.png`(換成手繪/退回生成
// 都會靜默分家)。
import { avatarURL } from '/public/js/portraits.js';
import { wpnOf, showWpn, wpnFrame, applyWpnCamera, wpnSlotName } from './wpnview.js';

// 使用者調整覆寫層(specs.json;/api/forge 讀寫)—— 合併只走 mergeSpec 單一縫。
// 2026-08-12 第五輪起本台**可寫**(紙娃娃編輯器存 `doll` 那一欄);比例滑桿仍住覆核台,
// 兩邊寫的是同一份檔、同一個路由,而且是**逐欄**寫入(見 specstore.mjs 的 patch 語意)。
let OVR = {};
try {
  const r = await fetch('/api/forge');
  if (r.ok) OVR = (await r.json()).mechs || {};
} catch { /* 沒有覆寫檔 = 全走出廠規格 */ }
async function saveOvr(id, patch) {
  const r = await fetch('/api/forge', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ id, ovr: patch }),
  });
  return (await r.json()).mechs || {};
}

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
/** 右欄分頁(標記 = 覆核意見 + 紙娃娃;它同時就是編輯模式的開關,見 setTab) */
const PANEL_TABS = [['data', '資料'], ['ref', '參考圖'], ['rig', '結構'], ['mark', '標記']];
let cat = CATS[0].key;              // 目前管理頁
let tab = 'data';                   // 右欄分頁
let view = 'mech';                  // 'mech' | 'light' | 'heavy'(武器獨立檢視)
let unit = null;                    // { group, rig, joints, spin? }
let ent = null;                     // 餵給 locomotion 的假實體
let spec = SPECS[0];
let speed = 0, speedTgt = 0, travel = 0, spdSel = 'spdIdle';
let draftDoll = null;               // 紙娃娃草稿(尚未存檔的那一份;null = 照已存檔的走)
let reframeNext = false;            // 切武器頁後的第一幀要重取景(姿勢落定才量得準)
let editor = null;
let firing = false, nextShot = 0;
let heavyAt = -1;
let simT = 0;
const clock = new THREE.Clock();
const $ = (id) => document.getElementById(id);
const esc = (s) => String(s).replace(/[&<>"]/g, (m) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[m]));
/** 程序生成的頭像回的是 data URI(已是完整 URL),手繪的是相對 public/ 的路徑 */
const avatarSrc = (id) => {
  const u = avatarURL(id);
  return /^(data:|https?:|\/)/.test(u) ? u : `/public/${u}`;
};
/** 機體名恆取 data.js 那一份(spec.label 是建模註記,見 forge.js MECH_SPECS 的欄位說明) */
const mechName = (s) => s.pilot?.machine || s.label;

/** 重鍛目前這一台(換機體 / 紙娃娃編輯的每一次結構改動都走這裡)。
 *  紙娃娃**草稿**優先於已存檔的那一份 —— 編輯中看到的就是還沒存的樣子。 */
function buildUnit() {
  if (unit) {
    scene.remove(unit.group);
    disposeTree(unit.group);   // A25:換機體釋放 GPU 資源
  }
  const merged = mergeSpec(spec, OVR[spec.id]);
  if (draftDoll) merged.doll = draftDoll;
  unit = forgeHumanoidMech(merged);
  scene.add(unit.group);
  unit.joints.visible = $('btnJoints').classList.contains('on');
  ent = { id: spec.id, mesh: unit.group, heroY: 0 };   // loco 狀態綁 mesh,重鍛即重建
}

function setSpec(s) {
  spec = s;
  cat = s.cat;
  draftDoll = OVR[s.id]?.doll || null;
  buildUnit();
  editor?.load(draftDoll);
  speedTgt = 0; speed = 0;
  for (const o of ['spdIdle', 'spdWalk', 'spdRun']) $(o).classList.toggle('on', o === 'spdIdle');
  spdSel = 'spdIdle';
  applyView();
  renderCatButtons();
  renderRail();
  renderPanel();
}

// ---- 武器獨立檢視 ------------------------------------------------------------
// 邏輯整組住 wpnview.js(2026-08-12 第五輪起覆核台 :8641 也有這一頁 ⇒ 兩個消費端);
// 這裡只剩本台的取景高、跑步機地面與鈕面。
function applyView(reframe = true) {
  const H = spec.height;
  if (reframe) reframeNext = true;   // 姿勢落定後再量一次(見 stepWorld 那一條)
  const w = view === 'mech' ? null : wpnOf(unit, view);
  showWpn(unit, view);                       // 顯示子集(切回機體時尊重紙娃娃的隱藏覆寫)
  grid.visible = plate.visible = view === 'mech';
  // 武器頁**停止移動**:武器掛在會動的肢體/樞軸上,取景框一旦定住而機體繼續走,
  // 武器就慢慢飄出畫面(2026-08-12 實測 t01 的臂在頭兩幀就從靜姿彈到步態姿)。
  // 這也是語意上對的 —— 武器頁看的是這把武器,不是它的步態。
  if (w) { speedTgt = 0; speed = 0; firing = false; $('btnFire').classList.remove('on'); }
  if (!w) {
    if (reframe) {
      controls.target.set(0, H * 0.52, 0);
      camera.position.set(H * 1.6, H * 0.62, H * 2.1);
    }
    $('stageTag').textContent = `${mechName(spec)} ・ ${spec.pilot?.name || spec.ch} ・ ${spec.kind} 鷹架`;
  } else {
    // 取景:武器世界包圍盒(空盒 = 這一格沒掛那個 slot,退回機體取景)
    const f = wpnFrame(unit, view);
    if (!f) { view = 'mech'; return applyView(reframe); }
    if (reframe) applyWpnCamera(camera, controls.target, f);
    $('stageTag').textContent = `${mechName(spec)} ・ ${wpnSlotName(view)}武器(rig.wpn.${view})`;
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
// 名冊欄:分類鈕(逐類進度)+ 逐列一格。
// 一列 = 一個 (機體, 型態):頭像 / 機體名 / 駕駛員 / 型態 / 覆核標記,一眼掃得到「誰開哪一台、
// 哪幾台我看過了」。改版前這是頂部一整排 20 顆寬鈕 —— 掃不到人,還吃掉整個畫面上緣。
function renderCatButtons() {
  const box = $('catSeg');
  box.innerHTML = '';
  for (const c of ROSTER) {
    const done = c.entries.filter((e) => SPECS.some((s) => s.id === e.key)).length;
    const b = document.createElement('button');
    b.className = 'segb' + (c.key === cat ? ' on' : '');
    b.innerHTML = `${c.label} <span class="fm">${done}/${c.entries.length}</span>`;
    b.title = c.tip;
    b.onclick = () => {
      cat = c.key;
      const first = SPECS.find((s) => s.cat === cat);
      if (first) setSpec(first); else { renderCatButtons(); renderRail(); }
    };
    box.appendChild(b);
  }
  const done = SPECS.length, all = ROSTER.reduce((n, c) => n + c.entries.length, 0);
  $('hdCount').textContent = `已建模 ${done}/${all} 格 ・ 已覆核 ${markedN()}/${done}`;
}

function renderRail() {
  const box = $('railList');
  box.innerHTML = '';
  const group = ROSTER.find((c) => c.key === cat);
  const h = document.createElement('div');
  h.className = 'rl-h';
  h.textContent = `${group.label} ・ ${group.tip}`;
  box.appendChild(h);
  for (const e of group.entries) {
    const s = SPECS.find((x) => x.id === e.key);
    const pl = e.pilot;
    const b = document.createElement('button');
    b.className = 'rl' + (s ? (s === spec ? ' on' : '') : ' missing');
    const form = e.form ? ` <span class="fm">${e.formLabel}</span>` : '';
    b.innerHTML = `<img src="${esc(avatarSrc(e.id))}" alt="">
      <span class="rl-txt">
        <span class="rl-m">${esc(pl?.machine || e.label)}${form}${s ? '' : ' <span class="fm">未建模</span>'}</span>
        <span class="rl-p">${esc(e.id)} ・ ${esc(pl?.name || '')}</span>
      </span>
      <span class="rl-mk">${s ? markIcon(e.key) : ''}</span>`;
    if (pl) b.title = `${pl.code} ${pl.machine}\n駕駛員「${pl.callsign}」${pl.name}`
      + ` ・ ${pl.sideName} ・ ${pl.kindWord} ・ 全高 ${pl.heightM.toFixed(2)} m`;
    if (s) b.onclick = () => setSpec(s); else b.disabled = true;
    box.appendChild(b);
  }
}

// ---- 覆核意見標記 --------------------------------------------------------------
// 2026-08-12 使用者第六輪:「以可讀性、**易於標記**為主」。標記有兩種,這裡是「這一台我看
// 過了沒、有沒有意見」那一種(另一種是紙娃娃的零件標記,住 dolledit.js)。
//
// 三條:
//   ① **存在既有的覆寫層**(specs.json 的同一格,欄位 `review`)—— 那支 patch 是逐欄的
//      (specstore.mjs 檔頭),多一欄不會洗掉紙娃娃;另開第二本帳就是第二套存檔語意。
//   ② 字彙只有 `MARK_STATUS` 一份:鈕面、名冊徽章、頁首計數全部由它推導,
//      MUST NOT 任一處自己寫 '✔'/'✎'(加第四個判決時會有地方靜默過期)。
//   ③ 意見是**逐格**的(名冊鍵),不是逐角色 —— 變形者兩個型態各自看、各自標。
export const MARK_STATUS = [
  { key: 'ok', icon: '✔', label: '已確認', tip: '這一格看過了,可以出貨' },
  { key: 'fix', icon: '✎', label: '待修', tip: '有意見:形狀/比例/零件要改' },
  { key: 'ref', icon: '◔', label: '缺參考', tip: '缺 2D 定案圖或原型照,先別動手' },
];
const markOf = (key) => OVR[key]?.review || null;
const markDef = (st) => MARK_STATUS.find((m) => m.key === st) || null;
const markIcon = (key) => {
  const d = markDef(markOf(key)?.status);
  return d ? `<span title="${esc(d.label)}">${d.icon}</span>` : '';
};
const markedN = () => SPECS.filter((s) => markOf(s.id)).length;

/** 寫一筆意見(status 為 null = 清掉這一格的意見)。時間戳只為了「這句話是什麼時候寫的」。 */
async function saveMark(status, note) {
  const review = status || note
    ? { status: status || null, note: note || '', at: new Date().toISOString().slice(0, 16).replace('T', ' ') }
    : null;
  OVR = await saveOvr(spec.id, { review });
  renderCatButtons();
  renderRail();
  renderPanel();
}

// ---- 2D 定案圖 / 原型參考照 ----------------------------------------------------
// 標記與名冊取得整組住 refstrip.js(2026-08-12 第五輪:覆核台也要這兩帶)——
// 兩座看板 MUST 是同一份標記 + 同一份 CSS(board.css),各寫一份就會各自演化。
// 這裡只剩「這一格要看哪幾張」:變形者只列**本型態**那幾張(飛行型的頁面不該拿地面型的
// 圖當建模依據),以及「面板已換機就別把上一台的圖畫進去」那道時序閘。
async function fillArtStrip(forId) {
  const box = $('artStrip');
  if (!box) return;
  const j = await fetchArt(spec.ch);
  if (spec.id !== forId || !$('artStrip')) return;             // 面板已換機
  const want = spec.form === 'flight' ? '_flight_' : spec.form === 'ground' ? '_ground_' : null;
  box.innerHTML = artStripHTML((j.imgs || []).filter((m) => !want || m.file.includes(want)));
}
async function fillRefStrip(forId, fresh = false) {
  const box = $('refStrip');
  if (!box) return;
  if (fresh) dropRefsCache(spec.id);          // 剛改過帳本 ⇒ 快取那一份已經是舊的
  const j = await fetchRefs(spec.id);
  if (spec.id !== forId || !$('refStrip')) return;
  box.innerHTML = refStripHTML(j.layers || [], spec.id);
  // 判決/註解/重搜/自己貼的行為也住 refstrip.js(標記與行為同一份 —— 兩座看板各綁一份的話,
  // 其中一座遲早少一個 dropRefsCache,而症狀是「我標了它還在」)
  bindRefStrip(box, spec.id, () => fillRefStrip(spec.id, true));
}

/**
 * 抬頭:**機體 ⇄ 角色**(2026-08-12 使用者:「機體台中,機體與角色的關係還沒更新」)。
 * 這一台是誰在開、他跟這台機體是什麼關係(`bond`)—— 那是建模時最該看見的一段設定,
 * 原本只在覆核台 :8641 有,機體台這邊只印一個裸的 `t01`。
 *
 * 三條:
 *   ① 每一欄都到原處取(roster.pilotOf 單一縫)—— 這裡 MUST NOT 出現任何手寫的姓名/陣營/
 *      機種/公尺數,也 MUST NOT 拿 `spec.label`(建模註記)當機體名。
 *   ② **全高與取景高分開印**:`pilot.heightM` 是遊戲裡的真實全高(heroTargetH,隨護甲內插),
 *      `spec.height` 只是展示台的統一取景高 —— 兩個數字併成一個就會有人拿取景高去改機體比例。
 *   ③ 頭像取 portraits.js 的 `avatarURL`(手繪不在冊時自動退回程序生成,不會留破圖)。
 */
function pilotHTML(spec) {
  const p = spec.pilot;
  const form = spec.form ? `・${FORM_LABEL[spec.form]}` : '';
  if (!p) {   // 理論上不會發生(名冊由 CHARACTERS 推導);缺了要看得出來,MUST NOT 靜默留白
    return `<h3>${esc(spec.label)} <small>${esc(spec.ch)}${form}</small></h3>
      <div class="note">(查不到這一格的駕駛員 —— data.js / mecha.js 對不上)</div>`;
  }
  return `
    <h3>「${esc(p.code)}」${esc(p.machine)}
      <small>${esc(catOf(spec.cat)?.label || spec.cat)}${form}</small></h3>
    <div class="pilot">
      <!-- 一張 54px 的頭像刻意不 lazy:pane 不合成時 lazy 影像永遠不觸發,
           headless 檢視看到的會是一格空白(而 HTTP 上那張圖是 200) -->
      <img src="${esc(avatarSrc(spec.ch))}" alt="">
      <div>
        <div class="pl-name">「${esc(p.callsign)}」${esc(p.name)}
          <span class="dim">${esc(spec.ch)}</span></div>
        <div class="pl-line">${esc(p.sideName)} ・ ${esc(p.kindWord)} ・ 全高 ${p.heightM.toFixed(2)} m</div>
        <div class="pl-line dim">${esc(p.nat)} ・ ${esc(p.role)}</div>
      </div>
    </div>
    ${p.quote ? `<div class="pl-quote">「${esc(p.quote)}」</div>` : ''}
    ${p.bond ? `<h4>機體與駕駛的關係(lore.js bond ・ 建模設定依據)</h4>
      <div class="pl-bond">${esc(p.bond)}</div>` : ''}
    <div class="note">建模鷹架 ${esc(spec.kind)} ・ 展示台取景高 ${spec.height} m
      (不是機體全高)・ 名冊鍵 ${esc(spec.id)}</div>`;
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

  // 四個分頁的內容。**武器檢視的入口只在舞台工具列**:改版前這裡還有一組文字跳轉
  // (→檢視輕武器 / ←回到機體),與工具列那組是同一個功能的第二份入口 —— 兩邊要各自
  // 維護選取態,而它們遲早會說出不一樣的話(使用者第六輪:「整併重複的資訊與功能」)。
  const body = {
    data: () => pilotHTML(spec),
    ref: () => `
      <h4>2D 定案圖(建模設計權威;點圖開大圖)</h4>
      <div id="artStrip" class="proto-strip"><div class="dim">載入中…</div></div>
      <h4>真實原型參考照(CC0/PD;關鍵詞取自 mecha.js proto)</h4>
      <div id="refStrip"><div class="dim">載入中…</div></div>`,
    rig: () => `
      <h4>特徵 → 零件轉換</h4>
      <table><tr><th>${air ? '機體特徵' : quad ? '生物特徵' : '人形特徵(VRM 骨)'}</th><th>零件</th></tr>${rows}</table>
      ${quad || air ? '' : `<h4>人形比例(身高 1.0 正規化;<span class="ovr-k">黃 = 本機覆寫</span>)</h4>
      <table><tr><th>特徵</th><th>值</th><th>VRM 對應</th></tr>${propRows}</table>`}
      <h4>rig 契約(locomotion.js 消費通道)</h4>
      <ul class="chan">${chan}</ul>
      <div class="note">武器檢視 = 同一棵零件樹的 rig.wpn.&lt;槽位&gt;.nodes 子集(FPV 座艙同源的
        那一份),不是另建的第二份幾何 —— 入口在舞台下方的「檢視」。</div>`,
    mark: () => markTabHTML(),
  }[tab] || (() => '');

  $('panelBody').innerHTML = body();
  renderTabs();
  if (tab === 'ref') { fillArtStrip(spec.id); fillRefStrip(spec.id); }
  if (tab === 'mark') bindMarkTab();
}

/** 分頁鈕:標記分頁掛徽章(這一格有沒有意見,不必點進去才知道) */
function renderTabs() {
  const box = $('panelTabs');
  box.innerHTML = '';
  const mk = markDef(markOf(spec.id)?.status);
  for (const [k, label] of PANEL_TABS) {
    const b = document.createElement('button');
    b.className = 'segb' + (k === tab ? ' on' : '');
    b.innerHTML = k === 'mark' && mk ? `${label} ${mk.icon}` : label;
    b.onclick = () => setTab(k);
    box.appendChild(b);
  }
}

/** 分頁切換。**標記分頁 = 編輯模式**:紙娃娃編輯器不再是另一顆全域開關 —— 改版前它一開
 *  就把整個資訊欄蓋掉,而你正在對照的 2D 定案圖當場消失。 */
function setTab(k) {
  tab = k;
  const on = k === 'mark';
  // 一邊自轉一邊拖 gizmo,拖到的是「拖的那一瞬間鏡頭在的地方」⇒ 進標記模式先停自轉
  if (on && controls.autoRotate) { controls.autoRotate = false; $('btnSpin').classList.remove('on'); }
  editor.setOn(on);
  $('dollPanel').hidden = !on;
  renderPanel();
}

/** 標記分頁上半:覆核意見(下半 = 紙娃娃編輯器,由 dolledit.js 掛在 #dollPanel) */
function markTabHTML() {
  const r = markOf(spec.id) || {};
  return `
    <h4>覆核意見(這一格看過了沒 / 有什麼要改)</h4>
    <div class="mk-row"><div class="seg" id="mkSeg">${MARK_STATUS.map((m) =>
    `<button class="segb${r.status === m.key ? ' on' : ''}" data-mk="${m.key}"
       title="${esc(m.tip)}">${m.icon} ${m.label}</button>`).join('')}
      <button class="segb" data-mk="" title="清掉這一格的意見">✕ 清除</button></div></div>
    <textarea class="mk-note" id="mkNote" placeholder="一句話寫下要改什麼(存進 specs.json 的 review 欄)"
      >${esc(r.note || '')}</textarea>
    <div class="mk-row"><button class="segb" id="mkSave">💾 存這句話</button>
      <span class="mk-stat">${r.at ? `上次 <b>${esc(r.at)}</b>` : '(還沒有意見)'}</span></div>
    <div class="mk-sep"></div>
    <div class="note">下面是零件標記:點機體上的零件選它,改形狀/配色或貼彩繪;
      2D 定案圖與原型照留在「參考圖」分頁,標記時不會被蓋掉。</div>`;
}

function bindMarkTab() {
  for (const b of $('panelBody').querySelectorAll('[data-mk]')) {
    b.onclick = () => saveMark(b.dataset.mk || null, $('mkNote').value.trim());
  }
  $('mkSave').onclick = () => saveMark(markOf(spec.id)?.status || null, $('mkNote').value.trim());
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
// 紙娃娃編輯模式的開關 = 右欄的「標記」分頁(setTab),MUST NOT 再有第二顆全域鈕:
// 兩顆開關管同一個模式,只要有一條路徑忘了同步,面板就會停在「看起來沒在編輯、
// 但點機體會選到零件」的狀態。
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
    // 切到武器頁的**第一幀**:手臂從鍛造靜姿彈到步態/據槍姿(t01 的臂位移超過 1.5m),
    // 而取景是在靜姿下算的 ⇒ 武器當場被甩出畫面。等姿勢落定再重取一次景。
    if (reframeNext && view !== 'mech') { reframeNext = false; applyView(true); }
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
  // 紙娃娃(headless 檢視:直接餵一份覆寫文件,不必操作面板)。
  // MUST 同時餵給編輯器 —— 只改草稿的話,面板統計說 0、而下一次面板觸發的重鍛會把
  // 這份文件整份蓋掉(兩份草稿 = 兩個真相)。
  doll: (doc) => { draftDoll = doc; buildUnit(); applyView(false); editor.load(doc); },
  dollIndex: () => ({
    parts: [...(unit?.doll?.parts.keys() || [])],
    bones: [...(unit?.doll?.bones.keys() || [])],
  }),
  // headless 入口一律走**與人一樣的那條路**(setTab):編輯模式的開關只有一個
  tab: (k) => setTab(k),
  edit: (on) => setTab(on ? 'mark' : 'data'),
  mark: () => markOf(spec.id),
};

editor = makeDollEditor({
  scene, camera, canvas, orbit: controls,
  unit: () => unit,
  // 結構改動(換形狀/邊緣/黏貼/貼花/配色/骨長)→ 重鍛;取景刻意不動
  rebuild: (doc) => { draftDoll = doc; buildUnit(); applyView(false); },
  save: async (doc) => { OVR = await saveOvr(spec.id, { doll: doc }); },
  stored: () => OVR[spec.id]?.doll || null,
  specKey: () => spec.id,
});
editor.mount($('dollPanel'));

setSpec(SPECS[0]);
loop();
