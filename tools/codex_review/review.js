// ============ 機體美術覆核台 — 頁面(dev-only)============
// 使用者需求(2026-08-04):「將已生成的每張機體圖配對到角色頭像、現有機體 3D 展示台,
// 點擊後出現武器招式等機體資訊、遊戲未公開的隱藏資訊,提供使用者確認勾選、局部重繪或重新下 prompt」。
//
// 四條紀律(與遊戲本體同一套):
//   ① **唯讀真品**:數值一律經 `heroWeapon()`/`heroAbility()`,原型與生成段一律經 `codex.js` ——
//      MUST NOT 在這裡自己算一份或抄一份文案(那就是圖鑑與覆核台分家,而且不會報錯)。
//   ② **3D 展示台就是遊戲那一台** `charPreview.js CharPreview`(共用 `makeUnit` + `stepLocomotion`)——
//      MUST NOT 為覆核台另寫預覽(module 層 .claude.md 對 charPreview.js 的同一條)。
//   ③ **重新下的 prompt 是覆核產物不是第二份 `imagePrompt`**:預設值一律由 `imagePrompt()` 產生,
//      使用者改過的存進 state.json 的 `prompt` 欄,並保留「還原成推導值」那顆鈕(A40 ⑥)。
//   ④ **缺圖與孤兒不藏**:配對由伺服器端推導,這裡照實畫出來(缺一格就是一格灰框)。
// three 走 CDN(A2:不進 package.json)⇒ **拿不到就要能降級**(CLAUDE.md 原則 6:降級,不例外)。
// 靜態 import charPreview.js 會連帶把 three 拉進模組圖:CDN 一擋(離線/公司代理/沙箱),
// 整頁在解析階段就死了 —— 配對、勾選、重下 prompt 這些不需要 3D 的工作也一起沒了。
// 故 3D 展示台改成**動態 import**,失敗只讓那一格顯示原因,其餘照常。
let CharPreview = null;
const threeReady = import('/public/js/charPreview.js')
  .then((m) => { CharPreview = m.CharPreview; return true; })
  .catch((e) => { console.warn('3D 展示台停用:', e?.message || e); return false; });
// 人形鍛造區塊(2026-08-12):同一條降級紀律 —— forge.js 靜態拉 three,CDN 擋掉時
// 只讓鍛造那一格顯示原因,覆核台其餘功能照常(原則 6)。
let FORGE = null;   // { forge, loco, toon, THREE }
const forgeReady = Promise.all([
  import('/tools/humanoid_forge/forge.js'),
  import('/public/js/locomotion.js'),
  import('/public/js/toon.js'),
  import('three'),
]).then(([forge, loco, toon, THREE]) => { FORGE = { forge, loco, toon, THREE }; return true; })
  .catch((e) => { console.warn('人形鍛造停用:', e?.message || e); return false; });
import {
  CHARACTERS, charKind, heroWeapon, heroAbility, heroArmor, heroMobility,
} from '/public/js/data.js';
import { LORE } from '/public/js/lore.js';
import {
  protoOf, mechaCodex, charCodex, textSeed, imagePrompt, modelSheet,
} from '/public/js/codex.js';

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
/** 圖鑑數值一律修掉浮點雜訊(heroWeapon 的解析結果是連乘出來的:41.148934413846504)*/
const n1 = (v) => (Math.round(v * 10) / 10).toString();
const n2 = (v) => (Math.round(v * 100) / 100).toString();
const STATUS = { ok: ['✔ 已確認', 'ok'], redraw: ['✎ 局部重繪', 'flag'], reprompt: ['⟳ 重下 prompt', 'flag'] };

const app = { data: null, cur: null, preview: null, canvas: null, filter: 'all' };

// ---- 資料 ----------------------------------------------------------------
const api = async (body) => (await fetch('/api/review', body
  ? { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }
  : undefined)).json();

const itemOf = (slot) => app.data?.state?.items?.[slot] || null;
const rowOf = (id) => app.data.rows.find((r) => r.id === id);

/** 一名角色的覆核進度(用於清單徽章與篩選)。
 * `art`(已入庫)與 `ai`(AI 稿,未驗收)**分開數** —— 併成一個「有圖」會讓「這一格還沒有正式圖」
 * 消失在數字裡,而那正是伺服器端檔頭 ③ 不准藏的東西。缺 = 兩個來源都沒有。 */
function rowStat(r) {
  const has = r.shots.filter((s) => s.has);
  // `stale` = 這張圖是判決之後才重畫的 ⇒ 那個判決講的是**上一張**。既不算通過也不算意見,
  // 否則覆核台會用一個過期的 ✔ 把「這一格重畫好了、還沒人看」蓋掉(檔頭 ④ 不准藏)
  const live = has.filter((s) => !s.stale);
  const ok = live.filter((s) => itemOf(s.slot)?.status === 'ok').length;
  const flag = live.filter((s) => ['redraw', 'reprompt'].includes(itemOf(s.slot)?.status)).length;
  const art = has.filter((s) => s.src === 'art').length;
  return { want: r.shots.length, has: has.length, art, ai: has.length - art, ok, flag,
    // ★ 只在真的有圖時算數:指到空格的星號在 img→3D 端等於沒標(見 shotCard 的「★ 失效」)
    star: r.shots.some((s) => s.star && s.has),
    stale: has.length - live.length, miss: r.shots.length - has.length };
}

// ---- 左側清單 ------------------------------------------------------------
function renderList() {
  const keep = (r) => {
    const st = rowStat(r);
    if (app.filter === 'todo') return st.has > st.ok + st.flag;
    if (app.filter === 'flag') return st.flag > 0;
    if (app.filter === 'miss') return st.miss > 0;
    if (app.filter === 'ai') return st.ai > 0;
    return true;
  };
  $('crList').innerHTML = app.data.rows.filter(keep).map((r) => {
    const st = rowStat(r);
    const pill = st.miss === st.want ? `<span class="cr-pill miss">缺 ${st.miss}</span>`
      : st.flag ? `<span class="cr-pill flag">${st.flag} 意見</span>`
        : st.ok === st.has ? `<span class="cr-pill ok">✔ ${st.ok}</span>`
          : `<span class="cr-pill">${st.ok}/${st.has}</span>`;
    const ai = st.ai ? `<span class="cr-pill ai">AI ${st.ai}</span>` : '';
    const star = st.star ? '<span class="cr-pill star">★</span>' : '';
    return `<div class="cr-row ${app.cur === r.id ? 'on' : ''}" data-id="${r.id}">
      <img src="/${r.avatar}" alt="" onerror="this.style.visibility='hidden'">
      <div class="cr-rn"><b>${esc(r.name)}</b><span>${r.id.toUpperCase()} ・ ${esc(r.kindWord)}</span></div>
      ${star}${ai}${pill}</div>`;
  }).join('') || '<div class="cr-dim" style="padding:12px">(這個篩選沒有結果)</div>';
  for (const el of $('crList').querySelectorAll('.cr-row')) {
    el.onclick = () => select(el.dataset.id);
  }
}

function renderStat() {
  let has = 0, want = 0, art = 0, ai = 0, ok = 0, flag = 0, stale = 0, star = 0;
  for (const r of app.data.rows) {
    const s = rowStat(r);
    has += s.has; want += s.want; art += s.art; ai += s.ai; ok += s.ok; flag += s.flag; stale += s.stale;
    star += s.star ? 1 : 0;
  }
  $('crStat').textContent =
    `應有 ${want} 格 ・ 入庫 ${art} ・ AI 稿 ${ai} ・ 已確認 ${ok}/${has} ・ 有意見 ${flag}`
    + ` ・ 已重畫待覆核 ${stale} ・ 缺 ${want - has} ・ ★ ${star}/${app.data.rows.length} 台`
    + ` ・ 被取代 ${app.data.superseded?.length || 0} ・ 孤兒 ${app.data.orphans.length}`;
}

// ---- 右側:角色 / 機體 ---------------------------------------------------
function select(id) {
  app.cur = id;
  renderList();
  renderBody();
}

function weaponRows(id) {
  const out = [];
  for (const [slot, key] of [['light', '左鍵'], ['heavy', '右鍵']]) {
    const w = heroWeapon(id, slot, 1);
    if (!w) continue;
    const bits = [`傷害 ${n1(w.dmg)}`, `射速 ${n2(w.rate)}/s`, `彈匣 ${w.mag}`,
      `裝填 ${n1(w.reload)}s`, `射程 ${Math.round(w.range)}m`, w.r ? `爆風 ${n2(w.r)}m` : ''].filter(Boolean);
    out.push(`<div class="cr-wrow" data-play="${slot}"><b>${esc(w.name)}</b>
      <span class="cr-dim">${esc(w.rw || '')}</span> <span class="cr-pill">${esc(key)}</span>
      <div class="cr-nums">${bits.join(' ・ ')}</div></div>`);
  }
  for (const [slot, key] of [['skill', 'Q'], ['ult', 'E']]) {
    const a = heroAbility(id, slot, 1);
    if (!a) continue;
    const bits = [`電力 ${a.mp}`, `冷卻 ${a.cd}s`, a.dmg ? `傷害 ${a.dmg}` : '', a.heal ? `修復 ${a.heal}` : '',
      a.r ? `半徑 ${a.r}m` : '', a.dur ? `持續 ${a.dur}s` : ''].filter(Boolean);
    out.push(`<div class="cr-wrow" data-play="${slot}"><b>${esc(a.name)}</b>
      <span class="cr-pill">${esc(key)}</span>
      <div class="cr-dim">${esc(a.desc || '')}</div><div class="cr-nums">${bits.join(' ・ ')}</div></div>`);
  }
  return out.join('');
}

function renderBody() {
  const r = rowOf(app.cur);
  if (!r) { $('crBody').innerHTML = '<div class="cr-dim">← 左側挑一名角色</div>'; return; }
  const id = r.id;
  const lo = LORE[id] || {};
  const mc = mechaCodex(id), cc = charCodex(id);
  const kv = (o) => Object.entries(o).map(([k, v]) => `<b>${esc(k)}</b><div>${esc(v ?? '—')}</div>`).join('');

  $('crBody').innerHTML = `
  <div class="cr-head">
    <div class="cr-face">
      <img src="/${r.portrait}" alt="" onerror="this.src='/${r.avatar}'">
      <div class="cr-cap">${r.id.toUpperCase()} 立繪 / 頭像</div>
    </div>
    <div class="cr-stage" id="crStage">
      <div class="cr-stage-btns">
        <button class="segb" id="crMorph" hidden>✈ 變形</button>
        <button class="segb" id="crRun">⏸ 靜止</button>
      </div>
    </div>
    <div class="cr-meta">
      <h2>「${esc(r.code)}」${esc(r.name)}</h2>
      <div class="cr-mline">${esc(mc.ident.code)} ・ ${esc(r.sideName)} ・ ${esc(r.kindWord)}
        ・ 全高 ${mc.scaleM.toFixed(2)}m</div>
      <div class="cr-kv">${kv({
    機體: r.machine,
    國籍: `${lo.nat} ・ ${lo.age} 歲 ・ ${lo.sex}`,
    職務: lo.role,
    // heroMobility 吃的是 (機種, mods, 飛行態) —— 傳角色 id 會靜默回 0(m/s 欄整排變 0.0)
    裝甲: `${n1(heroArmor(id))} ・ 機動 ${n1(heroMobility(charKind(id), CHARACTERS[id].mods))} m/s`
      + (charKind(id) === 'morph' ? ` / 飛行 ${n1(heroMobility(charKind(id), CHARACTERS[id].mods, true))}` : ''),
    台詞: lo.quote,
  })}</div>
    </div>
  </div>

  <div class="cr-sec"><h3>機體圖(點圖覆核)</h3>
    <div class="cr-shots">${r.shots.map((s) => shotCard(s)).join('')}</div>
  </div>

  <div class="cr-sec"><h3>武器 / 招式(點一列在展示台播演出)</h3>${weaponRows(id)}</div>

  <div class="cr-sec" id="crForgeSec" hidden></div>

  <div class="cr-sec"><h3>原型層</h3>
    <div class="cr-kv">${protoOf(id).map((L) =>
    `<b>${esc(L.label)}</b><div><b>${esc(L.src)}</b> ${esc(L.note)}</div>`).join('')}</div>
  </div>

  <div class="cr-sec cr-hide"><h3>⚑ 遊戲未公開:機體生成段(2D / 3D 用)</h3>
    <div class="cr-kv">${kv({
    剪影: mc.gen.sil, 量體比例: mc.gen.mass, 材質表面: mc.gen.mat,
    分件: (mc.gen.parts || []).join(' / '), 生圖關鍵詞: (mc.gen.tag || []).join('、'), 生成注意: mc.gen.note,
  })}</div>
  </div>

  <div class="cr-sec cr-hide"><h3>⚑ 遊戲未公開:角色生成段(立繪用)</h3>
    <div class="cr-kv">${kv({
    剪影: cc.gen.sil, 身高體格: cc.gen.mass, 膚髮衣料: cc.gen.mat,
    分件: (cc.gen.parts || []).join(' / '), 生圖關鍵詞: (cc.gen.tag || []).join('、'), 生成注意: cc.gen.note,
  })}</div>
  </div>

  <div class="cr-sec cr-hide"><h3>⚑ 遊戲未公開:對外生成文字(codex.js 推導)</h3>
    <label class="cr-dim">3D 建模單 modelSheet</label>
    <textarea class="cr-gen" readonly rows="8">${esc(modelSheet('mecha', id))}</textarea>
    <label class="cr-dim">文本生成種子 textSeed</label>
    <textarea class="cr-gen" readonly rows="10">${esc(textSeed('mecha', id))}</textarea>
  </div>`;

  for (const el of $('crBody').querySelectorAll('.cr-shot[data-slot]')) {
    el.onclick = () => openReview(el.dataset.slot);
  }
  // ★ 鈕疊在圖上 ⇒ MUST 擋掉冒泡,否則按一次星號會順手把覆核 modal 也打開
  for (const b of $('crBody').querySelectorAll('[data-star]')) {
    b.onclick = (e) => { e.stopPropagation(); toggleStar(b.dataset.star, !b.classList.contains('on')); };
  }
  for (const el of $('crBody').querySelectorAll('.cr-wrow[data-play]')) {
    el.onclick = () => app.preview?.play(el.dataset.play);
  }
  mountStage(id);
  mountForge(id);
  // 孤兒區/被取代區跟著每一次重繪掛回去 —— 只在 load() 掛一次的話,點掉第一名角色之後它就被
  // innerHTML 洗掉了,而畫面上只表現成「孤兒檔不見了」(檔頭 ④:漏掉的東西不准藏)
  renderSuperseded();
  renderOrphans();
}

// ---- 人形鍛造區塊(人形特徵 → 機器人零件;dev 原型 tools/humanoid_forge)------------
// 涵蓋 = forge.FORGE_IDS(機甲人形 4 + 變形者人形地面型 4)。出廠規格住 forge.js,
// 使用者調整存 specs.json 覆寫層(/api/forge;一次一台),合併只走 mergeSpec()。
// canvas 存活照 mountStage 同款:模組級持有、每次 renderBody 後 re-prepend。
const fapp = { canvas: null, renderer: null, scene: null, camera: null, unit: null, ent: null,
  id: null, draft: null, ovr: {}, speed: 0, speedTgt: 0, simT: 0, last: 0, timer: 0 };

const forgeApi = async (body) => (await fetch('/api/forge', body
  ? { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }
  : undefined)).json();

/** 比例滑桿的值域(涵蓋八台出廠值;head 上限 1.05 給 t12 的大頭) */
const PROP_RANGE = {
  hips: [0.35, 0.62], legSplay: [0.04, 0.16], thigh: [0.35, 0.55], shin: [0.3, 0.6],
  shoulderY: [0.7, 0.9], shoulderX: [0.1, 0.28], upperArm: [0.1, 0.35], foreArm: [0.1, 0.35],
  head: [0.7, 1.05], girth: [0.6, 1.6],
};
const KNOB_RANGE = { barrelF: [0.5, 1.6, '武器長度'], accentF: [0.2, 2.5, '發光強度'] };

function forgeScene() {
  const { THREE, toon } = FORGE;
  fapp.canvas = document.createElement('canvas');
  fapp.renderer = new THREE.WebGLRenderer({ canvas: fapp.canvas, antialias: true, alpha: true });
  fapp.renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
  fapp.scene = new THREE.Scene();
  fapp.camera = new THREE.PerspectiveCamera(38, 1, 0.1, 300);
  const dir = new THREE.DirectionalLight(0xffffff, 2.1);
  dir.position.set(20, 40, 20);
  fapp.scene.add(dir, new THREE.HemisphereLight(0xdff1ff, 0x2b2f38, 1.1));
  const grid = new THREE.GridHelper(30, 15, 0x39414f, 0x262c36);
  fapp.scene.add(grid);
  fapp.grid = grid;
  const loop = (t) => {
    requestAnimationFrame(loop);
    if (!fapp.canvas.isConnected || !fapp.unit) return;
    const dt = Math.min(0.05, (t - fapp.last) / 1000 || 0.016);
    fapp.last = t;
    fapp.speed += (fapp.speedTgt - fapp.speed) * Math.min(1, 2.2 * dt);
    fapp.trav = (fapp.trav || 0) + fapp.speed * dt;
    fapp.grid.position.z = -(fapp.trav % 2);
    fapp.st = (fapp.st || 0) + dt;
    FORGE.loco.stepCombatFx(fapp.ent, fapp.st, dt);
    FORGE.loco.stepLocomotion(fapp.ent, dt, fapp.st, 0, -fapp.speed * dt, 0);
    fapp.yaw = (fapp.yaw || 0) + dt * 0.5;                       // 自動環繞(全角度檢視)
    const H = fapp.draft.height, d2 = H * 2.3;
    fapp.camera.position.set(Math.sin(fapp.yaw) * d2, H * 0.62, Math.cos(fapp.yaw) * d2);
    fapp.camera.lookAt(0, H * 0.5, 0);
    const w = fapp.canvas.clientWidth, h2 = fapp.canvas.clientHeight;
    if (w && (fapp.canvas.width !== w || fapp.canvas.height !== h2)) {
      fapp.renderer.setSize(w, h2, false);
      fapp.camera.aspect = w / h2;
      fapp.camera.updateProjectionMatrix();
    }
    FORGE.toon.updateCelLight(fapp.camera);                      // 兩座台各自 set→render,互不留殘影
    fapp.renderer.render(fapp.scene, fapp.camera);
  };
  requestAnimationFrame(loop);
}

/** 以目前草稿(出廠 ⊕ 覆寫 ⊕ 滑桿未存值)重鍛,並重畫特徵→零件表 */
function forgeBuild() {
  const { forge, toon } = FORGE;
  if (fapp.unit) { fapp.scene.remove(fapp.unit.group); toon.disposeTree(fapp.unit.group); }
  fapp.unit = forge.forgeHumanoidMech(fapp.draft);
  fapp.scene.add(fapp.unit.group);
  fapp.ent = { id: fapp.id, mesh: fapp.unit.group, heroY: 0 };
  const doc = forge.conversionDoc(fapp.draft)
    .map((r2) => `<tr><td>${esc(r2.feat)}</td><td>${esc(r2.part)}</td></tr>`).join('');
  const docBox = $('crForgeDoc');
  const featTh = fapp.draft.kind === 'quad' ? '生物特徵' : '人形特徵(VRM 骨)';
  if (docBox) docBox.innerHTML = `<table class="cr-ftab"><tr><th>${featTh}</th><th>機器人零件</th></tr>${doc}</table>`;
}

async function mountForge(id) {
  const sec = $('crForgeSec');
  if (!sec) return;
  if (!(await forgeReady)) {
    sec.hidden = false;
    sec.innerHTML = '<h3>人形鍛造(特徵 → 零件)</h3><div class="cr-none">鍛造停用(three CDN 連不到)</div>';
    return;
  }
  const { forge } = FORGE;
  const base = forge.MECH_SPECS.find((s) => s.id === id);
  if (!base) { sec.hidden = true; return; }                      // 不在鍛造名冊(無人機/未建模)不出鍛造區塊
  sec.hidden = false;
  // 2D 原型圖參考帶(2026-08-12 使用者:「下載原型圖片放在機體台,3D建模時需參考2D圖片
  // 設計零件進行組合」):資料 = 伺服器端 manifest 推導的 shots(MUST NOT 在這裡另拼檔名);
  // 只列地面型(人形鍛造建模的是地面人形),★ = 外觀權威排最前。
  const refs = (rowOf(id)?.shots || [])
    .filter((s) => s.has && s.form !== 'flight')
    .sort((a, b) => (b.star ? 1 : 0) - (a.star ? 1 : 0));
  const refHTML = refs.length
    ? refs.map((s) => `<figure class="cr-fref${s.star ? ' star' : ''}">
        <a href="/${s.url}" target="_blank" rel="noopener"><img src="/${s.url}" alt="" loading="lazy"></a>
        <figcaption>${esc(s.poseLabel)}${s.form ? `・${esc(s.form)}` : ''}${s.star ? '・★ 外觀權威' : ''}</figcaption>
      </figure>`).join('')
    : '<div class="cr-none">(這台還沒有 2D 定案圖 —— 建模參考缺席)</div>';
  if (!fapp.canvas) {
    forgeScene();
    fapp.ovr = (await forgeApi()).mechs || {};
  }
  fapp.id = id;
  fapp.draft = forge.mergeSpec(base, fapp.ovr[id]);
  // 版面:左 canvas、右控制欄(滑桿由 HUMANOID 特徵表推導,不手寫清單)。
  // 四足獸鷹架(spec.kind 'quad')不吃人形比例 ⇒ 不出滑桿(比例住 mechs/<id>.js 的 frame)。
  const quad = base.kind === 'quad';
  const propRows = quad ? '' : Object.keys(forge.HUMANOID).map((k) => {
    const [lo, hi] = PROP_RANGE[k] || [0, 1];
    const v = fapp.draft.prop?.[k] ?? forge.HUMANOID[k].def;
    return `<label class="cr-frow"><span>${k}</span>
      <input type="range" data-prop="${k}" min="${lo}" max="${hi}" step="0.005" value="${v}">
      <i data-val="${k}">${v}</i></label>`;
  }).join('');
  const knobRows = Object.entries(KNOB_RANGE).map(([k, [lo, hi, label]]) => {
    const v = fapp.draft.knobs?.[k] ?? 1;
    return `<label class="cr-frow"><span>${label}</span>
      <input type="range" data-knob="${k}" min="${lo}" max="${hi}" step="0.01" value="${v}">
      <i data-val="${k}">${v}</i></label>`;
  }).join('');
  sec.innerHTML = `<h3>人形鍛造(特徵 → 零件)<span class="cr-dim" style="font-weight:normal">
      ${esc(base.label)} ・ 出廠規格住 forge.js,調整存 specs.json 覆寫層</span></h3>
    <div class="cr-dim">2D 原型圖(3D 建模的設計權威 —— 零件多面體照著它拼;點圖開大圖)</div>
    <div class="cr-frefs">${refHTML}</div>
    <div class="cr-forge">
      <div class="cr-fstage" id="crForgeStage">
        <div class="cr-stage-btns">
          <button class="segb" id="cfRun">▶ 奔跑</button>
          <button class="segb" id="cfFire">輕武器</button>
          <button class="segb" id="cfHeavy">重武器</button>
          <button class="segb" id="cfCast">招式</button>
        </div>
      </div>
      <div class="cr-fctl">
        <div class="cr-dim">${quad ? '四足獸鷹架:骨架比例住 mechs/*.js 的 frame(無人形滑桿)' : '人形比例(身高 1.0 正規化;HUMANOID 特徵表推導)'}</div>
        ${propRows}
        <div class="cr-dim">細節旋鈕</div>
        ${knobRows}
        <div class="cr-fbtns">
          <button class="segb" id="cfSave">💾 儲存覆寫</button>
          <button class="segb" id="cfReset">還原出廠</button>
          <span class="cr-dim" id="cfMsg">${fapp.ovr[id] ? '（此機已有使用者覆寫）' : ''}</span>
        </div>
        <div id="crForgeDoc"></div>
      </div>
    </div>`;
  $('crForgeStage').prepend(fapp.canvas);
  forgeBuild();

  // 滑桿:即時重鍛(150ms 去抖);值先進草稿,按「儲存」才落 specs.json
  const applyDraft = () => {
    clearTimeout(fapp.timer);
    fapp.timer = setTimeout(forgeBuild, 150);
  };
  for (const inp of sec.querySelectorAll('input[data-prop]')) {
    inp.oninput = () => {
      fapp.draft.prop = { ...fapp.draft.prop, [inp.dataset.prop]: +inp.value };
      sec.querySelector(`i[data-val="${inp.dataset.prop}"]`).textContent = inp.value;
      applyDraft();
    };
  }
  for (const inp of sec.querySelectorAll('input[data-knob]')) {
    inp.oninput = () => {
      fapp.draft.knobs = { ...fapp.draft.knobs, [inp.dataset.knob]: +inp.value };
      sec.querySelector(`i[data-val="${inp.dataset.knob}"]`).textContent = inp.value;
      applyDraft();
    };
  }
  $('cfSave').onclick = async () => {
    // 覆寫層只存與出廠值的差異(存整份 = 出廠值一改覆寫就把舊值釘死)
    const ovr = { prop: {}, knobs: {} };
    for (const k of Object.keys(forge.HUMANOID)) {
      const v = fapp.draft.prop?.[k];
      if (v != null && v !== (base.prop?.[k] ?? forge.HUMANOID[k].def)) ovr.prop[k] = v;
    }
    for (const k of Object.keys(KNOB_RANGE)) {
      const v = fapp.draft.knobs?.[k];
      if (v != null && v !== 1) ovr.knobs[k] = v;
    }
    if (!Object.keys(ovr.prop).length) delete ovr.prop;
    if (!Object.keys(ovr.knobs).length) delete ovr.knobs;
    const payload = Object.keys(ovr).length ? ovr : null;
    fapp.ovr = (await forgeApi({ id, ovr: payload })).mechs || {};
    $('cfMsg').textContent = payload ? '已儲存 ✔' : '與出廠值相同,已清除覆寫';
  };
  $('cfReset').onclick = async () => {
    fapp.ovr = (await forgeApi({ id, ovr: null })).mechs || {};
    mountForge(id);   // 重畫滑桿回出廠值
  };
  $('cfRun').onclick = () => {
    fapp.speedTgt = fapp.speedTgt ? 0 : fapp.draft.gait.top;
    $('cfRun').textContent = fapp.speedTgt ? '⏸ 靜止' : '▶ 奔跑';
  };
  $('cfFire').onclick = () => { fapp.ent.fireFx = { t0: fapp.st, slot: 'light' }; };
  $('cfHeavy').onclick = () => {
    fapp.ent.heavyFx = { phase: 'charge', t0: fapp.st };
    setTimeout(() => {
      if (!fapp.ent) return;
      fapp.ent.fireFx = { t0: fapp.st, slot: 'heavy' };
      fapp.ent.heavyFx = { phase: 'fire', t0: fapp.st };
    }, 1050);
  };
  $('cfCast').onclick = () => { fapp.ent.castFx = { t0: fapp.st, slot: 'ult', dir: 0 }; };
}

/** 來源標籤:哪一格是「已入庫」、哪一格只是 AI 稿,MUST 在圖上就看得出來 ——
 * 覆核台上這兩件事的下一步完全不同(入庫圖是複核,AI 稿是決定要不要讓它入庫)。 */
const SRC_LABEL = { ai: 'AI 稿' };

/** ★ 切換這台機體的外觀權威。鍵是**機體**(伺服器端 `state.star` 的映射)⇒ 標第二張自動
 *  取代第一張,「一個機體只能標註一張」是資料結構保證的,這裡 MUST NOT 再寫一次那條規則
 *  (寫了就是第二份實作,而兩份不同步的症狀是畫面上兩張同時亮著星)。 */
async function toggleStar(slot, on) {
  await api({ starSlot: on ? slot : null, starChar: app.cur });
  await load();
}

function shotCard(s) {
  const it = itemOf(s.slot);
  // 判決比圖舊 ⇒ 一律當「未覆核」畫,並且明講這是重畫過的新圖(掛著上一張的評語最容易誤判成
  // 「我已經看過了」;那正是重畫完之後最不該發生的事)
  const [label, cls] = s.stale ? ['⟳ 已重畫,待覆核', 'flag'] : (STATUS[it?.status] || ['— 未覆核', '']);
  const badge = s.assigned ? '<span class="cr-pill flag">指派</span>' : '';
  if (!s.has) {
    // 星號指到一格沒有圖的 slot ⇒ 那顆星實際上沒有生效(img→3D 退回舊規則),MUST 講出來
    return `<div class="cr-shot"><div class="cr-none">缺圖${s.star ? '<br>★ 星號指到這裡' : ''}</div>
      <div class="cr-sc"><span class="cr-pill miss">${esc(s.poseLabel)}${s.form ? `・${s.form}` : ''}</span>
        ${s.star ? '<span class="cr-pill miss">★ 失效</span>' : ''}</div></div>`;
  }
  const srcPill = SRC_LABEL[s.src] ? `<span class="cr-pill ai">${esc(SRC_LABEL[s.src])}</span>` : '';
  return `<div class="cr-shot ${cls ? `on-${cls}` : ''} ${s.src === 'ai' ? 'is-ai' : ''} ${s.star ? 'is-star' : ''}" data-slot="${s.slot}">
    <img src="/${s.url}" alt="" loading="lazy">
    <button class="cr-star ${s.star ? 'on' : ''}" data-star="${s.slot}"
      title="★ 這台機體的外觀權威(img→3D 遇到外觀衝突以它為主;一台只能一張)">${s.star ? '★' : '☆'}</button>
    <div class="cr-sc"><span class="cr-pill">${esc(s.poseLabel)}${s.form ? `・${s.form}` : ''}</span>
      ${srcPill}${badge}${s.star ? '<span class="cr-pill star">★ 外觀權威</span>' : ''}
      <span class="cr-pill ${cls}">${esc(label)}</span></div></div>`;
}

// ---- 3D 展示台(遊戲那一台)-----------------------------------------------
async function mountStage(id) {
  const box = $('crStage');
  if (!(await threeReady)) {
    // 降級:三維那一格說明白為什麼沒有,其餘功能不受影響(原則 6)
    box.innerHTML = '<div class="cr-none" style="height:100%">3D 展示台停用<br>(three CDN 連不到)</div>';
    return;
  }
  if (!app.canvas) {
    app.canvas = document.createElement('canvas');
    app.preview = new CharPreview(app.canvas);
    app.preview.start();
  }
  if (box !== app.canvas.parentElement) box.prepend(app.canvas);
  const c = CHARACTERS[id];
  app.preview.setChar(id, c.side);
  const morph = $('crMorph');
  morph.hidden = charKind(id) !== 'morph';
  morph.onclick = () => { morph.textContent = app.preview.toggleMorph() ? '⬇ 變形' : '✈ 變形'; };
  const RUN = { idle: '⏸ 靜止', slow: '🐢 慢速', normal: '▶ 正常' };
  const run = $('crRun');
  run.onclick = () => { app.preview.cycleRun(1); run.textContent = RUN[app.preview.runMode] || RUN.idle; };
  run.textContent = RUN[app.preview.runMode] || RUN.idle;
}

// ---- 覆核 modal:確認勾選 / 局部重繪 / 重新下 prompt ------------------------
function openReview(slot) {
  const r = rowOf(app.cur);
  const s = r.shots.find((x) => x.slot === slot);
  const it = itemOf(slot) || {};
  const regions = [...(it.regions || [])];
  // 重新下 prompt 的預設值一律取**推導值**(codex.imagePrompt);使用者改過的才存進 state。
  // **型態要一起傳**(2026-08-05):變形者恆有兩層原型,不傳型態拿到的是「地面型 + 飛行型」
  // 混在一起的同一份提示詞 —— 那正是六台變形者的飛行稿被判「需要是飛行姿態」的原因
  // (覆核台叫得出兩張不同的圖,卻只發得出一份提示詞)。姿態語的單一縫 = codex.FORM_POSE。
  const derived = imagePrompt('mecha', r.id, s.form, s.pose);
  const m = $('crModal');
  m.hidden = false;
  m.innerHTML = `<div class="cr-mbox">
    <div class="cr-mimg" id="crImgWrap"><img src="/${s.url}" alt="" draggable="false"></div>
    <div class="cr-mside">
      <h3>${esc(r.name)} ・ ${esc(s.poseLabel)}${s.form ? `・${s.form}` : ''}</h3>
      <div class="cr-dim">${esc(s.url)}${s.assigned ? '(指派)' : ''}
        ${s.src === 'ai' ? '<br>⚑ AI 設定稿,<b>尚未驗收</b> —— 通過之後由人搬進 public/assets/cyberpunk_art/mechs/ 才算入庫' : ''}</div>

      <label>★ 外觀權威(img→3D 遇到外觀衝突以這張為主;一台機體只能一張)</label>
      <div class="seg"><button class="segb ${s.star ? 'on' : ''}" id="crStar">${s.star ? '★ 就是這張' : '☆ 標為這台的外觀權威'}</button></div>
      <div class="cr-dim">${r.star && r.star !== s.slot ? `目前標的是 <b>${esc(r.star)}</b> —— 標這張會取代它` : ''}</div>

      <label>① 確認勾選</label>
      <div class="seg"><button class="segb ${it.status === 'ok' ? 'on' : ''}" data-st="ok">✔ 通過</button>
        <button class="segb ${it.status === 'redraw' ? 'on' : ''}" data-st="redraw">✎ 局部重繪</button>
        <button class="segb ${it.status === 'reprompt' ? 'on' : ''}" data-st="reprompt">⟳ 重下 prompt</button>
        <button class="segb" data-st="">✕ 清除</button></div>

      <label>② 局部重繪:在左圖拖曳框出要重畫的地方</label>
      <div class="cr-rgl" id="crRgl"></div>
      <input class="cr-note" id="crRnote" placeholder="這一框要改什麼(下一個框的說明)">

      <label>③ 重新下 prompt(預設 = codex.imagePrompt 推導值)</label>
      <textarea class="cr-gen" id="crPrompt" rows="9">${esc(it.prompt || derived)}</textarea>
      <div class="cr-acts">
        <button class="segb" id="crReset">↺ 還原成推導值</button>
        <button class="segb" id="crCopy">⧉ 複製</button>
      </div>

      <label>整體備註</label>
      <input class="cr-note" id="crNote" value="${esc(it.note || '')}" placeholder="給美術/生圖的整體意見">

      <div class="cr-acts">
        <button class="segb on" id="crSave">儲存</button>
        <button class="segb" id="crClose">關閉</button>
        <span class="cr-saved" id="crSaved"></span>
      </div>
    </div></div>`;

  const wrap = $('crImgWrap');
  const drawRegions = () => {
    for (const b of wrap.querySelectorAll('.cr-box')) b.remove();
    regions.forEach((g, i) => {
      const d = document.createElement('div');
      d.className = 'cr-box';
      d.style.cssText = `left:${g.x * 100}%;top:${g.y * 100}%;width:${g.w * 100}%;height:${g.h * 100}%`;
      d.innerHTML = `<i>${i + 1}. ${esc(g.note || '重繪')}</i>`;
      wrap.appendChild(d);
    });
    $('crRgl').innerHTML = regions.map((g, i) =>
      `<div><span>${i + 1}. ${esc(g.note || '重繪')} (${(g.w * 100) | 0}%×${(g.h * 100) | 0}%)</span>
       <button class="segb" data-del="${i}">✕</button></div>`).join('') || '(還沒有框)';
    for (const b of $('crRgl').querySelectorAll('[data-del]')) {
      b.onclick = () => { regions.splice(+b.dataset.del, 1); drawRegions(); };
    }
  };
  drawRegions();

  // 拖曳框選 → 正規化矩形(0~1),直接可餵給 inpaint 的 bbox
  let drag = null;
  const rect = () => wrap.querySelector('img').getBoundingClientRect();
  const at = (e) => {
    const b = rect();
    return { x: Math.min(1, Math.max(0, (e.clientX - b.left) / b.width)), y: Math.min(1, Math.max(0, (e.clientY - b.top) / b.height)) };
  };
  wrap.onpointerdown = (e) => { drag = at(e); wrap.setPointerCapture(e.pointerId); };
  wrap.onpointermove = (e) => {
    if (!drag) return;
    const p = at(e);
    const g = { x: Math.min(drag.x, p.x), y: Math.min(drag.y, p.y), w: Math.abs(p.x - drag.x), h: Math.abs(p.y - drag.y) };
    for (const b of wrap.querySelectorAll('.cr-box.tmp')) b.remove();
    const d = document.createElement('div');
    d.className = 'cr-box tmp';
    d.style.cssText = `left:${g.x * 100}%;top:${g.y * 100}%;width:${g.w * 100}%;height:${g.h * 100}%`;
    wrap.appendChild(d);
  };
  wrap.onpointerup = (e) => {
    if (!drag) return;
    const p = at(e), s0 = drag; drag = null;
    for (const b of wrap.querySelectorAll('.cr-box.tmp')) b.remove();
    const g = { x: Math.min(s0.x, p.x), y: Math.min(s0.y, p.y), w: Math.abs(p.x - s0.x), h: Math.abs(p.y - s0.y) };
    if (g.w < 0.02 || g.h < 0.02) return;                       // 誤點不算一框
    g.note = $('crRnote').value.trim();
    $('crRnote').value = '';
    regions.push(g);
    drawRegions();
  };

  let status = it.status || '';
  for (const b of m.querySelectorAll('[data-st]')) {
    b.onclick = () => {
      status = b.dataset.st;
      for (const x of m.querySelectorAll('[data-st]')) x.classList.toggle('on', x.dataset.st === status && status);
    };
  }
  // 標星立刻存檔並重繪(它是獨立於覆核判決的一件事:一張被判「局部重繪」的圖仍可能是
  // 最接近設計的那一張 ⇒ MUST NOT 綁進「儲存」那顆鈕的條件裡)
  $('crStar').onclick = async () => { m.hidden = true; await toggleStar(slot, !s.star); };
  $('crReset').onclick = () => { $('crPrompt').value = derived; };
  $('crCopy').onclick = () => navigator.clipboard?.writeText($('crPrompt').value);
  $('crClose').onclick = () => { m.hidden = true; };
  m.onclick = (e) => { if (e.target === m) m.hidden = true; };
  $('crSave').onclick = async () => {
    const prompt = $('crPrompt').value.trim();
    const item = status || regions.length || prompt !== derived || $('crNote').value.trim() ? {
      status,
      regions,
      // 與推導值相同就不存(存了就是第二份 imagePrompt,而且不會跟著欄位變 —— A40 ⑥)
      prompt: prompt !== derived ? prompt : undefined,
      note: $('crNote').value.trim() || undefined,
    } : null;
    const res = await api({ slot, item });
    app.data.state.items = res.items;
    $('crSaved').textContent = '已存檔 ✔';
    renderList(); renderStat(); renderBody();
    setTimeout(() => { m.hidden = true; }, 350);
  };
}

// ---- 被取代的版本(對得到格子、只是輸了來源優先序)--------------------------
// 與孤兒**分開列**:孤兒的定義是「對不到任何一格」,而這些對得到。混在一起的話,覆核台會邀請
// 使用者把一張剛被否決的舊圖「指派」到別的格子去 —— 那是把錯誤搬到另一個地方,而不是修掉它。
function renderSuperseded() {
  const list = app.data.superseded || [];
  const mine = list.filter((o) => o.slot.startsWith(`${app.cur}_`) || o.slot === app.cur);
  if (!mine.length) return;
  const box = document.createElement('div');
  box.className = 'cr-sec cr-orph';
  box.innerHTML = `<h3>被取代的版本(${mine.length})—— 同一格的舊版本,留著備查</h3>
    <div class="cr-shots">${mine.map((o) => `<div class="cr-shot ${o.src === 'ai' ? 'is-ai' : ''}">
      <img src="/${o.url}" alt="" loading="lazy">
      <div class="cr-sc"><span class="cr-pill">${esc(o.slot)}</span>
        <span class="cr-pill ${o.src === 'ai' ? 'ai' : ''}">${esc(SRC_LABEL[o.src] || '入庫')}</span></div>
      </div>`).join('')}</div>`;
  $('crBody').appendChild(box);
}

// ---- 孤兒檔(對不到任何一格的圖)------------------------------------------
function renderOrphans() {
  if (!app.data.orphans.length) return;
  const slots = app.data.rows.flatMap((r) => r.shots.filter((s) => !s.has)
    .map((s) => ({ slot: s.slot, label: `${r.id} ${s.form ? `${s.form}/` : ''}${s.pose}` })));
  const box = document.createElement('div');
  box.className = 'cr-sec cr-orph';
  // 圖的網址由伺服器端給(它才知道這個檔案是哪一個來源)—— 在這裡拼死路徑就是第二份來源表,
  // 症狀是 AI 稿那批孤兒全部破圖,而且不會有任何錯誤訊息。
  box.innerHTML = `<h3>孤兒檔(${app.data.orphans.length})—— 檔名對不到任何一格,多半是機體換過手</h3>
    <div class="cr-shots">${app.data.orphans.map((o) => `<div class="cr-shot ${o.src === 'ai' ? 'is-ai' : ''}">
      <img src="/${o.url}" alt="" loading="lazy">
      <div class="cr-sc">${SRC_LABEL[o.src] ? `<span class="cr-pill ai">${esc(SRC_LABEL[o.src])}</span>` : ''}
        <span class="cr-pill flag">${esc(o.file)}</span></div>
      <select class="cr-note" data-file="${esc(o.file)}">
        <option value="">(指派到…)</option>
        ${slots.map((s) => `<option value="${s.slot}">${esc(s.label)}</option>`).join('')}
      </select></div>`).join('')}</div>`;
  $('crBody').appendChild(box);
  for (const sel of box.querySelectorAll('select[data-file]')) {
    sel.onchange = async () => {
      await api({ assignFile: sel.dataset.file, assignSlot: sel.value });
      await load();
    };
  }
}

// ---- 啟動 ----------------------------------------------------------------
async function load() {
  app.data = await api();
  renderStat();
  renderList();
  renderBody();   // 孤兒區由 renderBody 一併掛(每次重繪都要有,不能只掛開場那一次)
}
for (const b of $('crFilter').querySelectorAll('.segb')) {
  b.onclick = () => {
    app.filter = b.dataset.f;
    for (const x of $('crFilter').querySelectorAll('.segb')) x.classList.toggle('on', x === b);
    renderList();
  };
}
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') $('crModal').hidden = true; });
await load();
select(app.data.rows[0].id);
