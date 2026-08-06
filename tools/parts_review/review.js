// ============ 3D 零件對照台 — 頁面(dev-only)============
// 使用者需求(2026-08-05):「docs/ai3d_runbook.md 生成的 3D 物件與原版 3D 物件比較的工具,
// 須說明使用哪個生成方法與 img,操作比照生圖對照台」。
//
// 四條紀律(與 2D 對照台同一套):
//   ① **唯讀真品**:兩側都由**遊戲自己的** `beacons.buildBeacon` 建、`beaconCollider` 量、
//      `toonMat`/`envMat` 上色。這裡 MUST NOT 出現第二套組裝器或第二份 primitive 產生器 ——
//      抄一套的下場是「對照台上的原版」跟遊戲裡的原版不是同一個東西,而且不會報錯。
//   ② **原版怎麼來,取決於方法分流**(伺服器端 `view.mode` 已經定案):
//        `fuse-vs-lib`     —— 執行期兩條路徑同時存在:沒載零件庫 = 保險絲 primitive(原版),
//                             載了 = GLB(生成)。
//        `baseline-vs-now` —— 生成物就是零件表本身,執行期沒有第二份 ⇒ 原版由 `/baseline/<rev>/`
//                             供應的**那一版 beacons.js 自己的 buildBeacon** 建。
//   ③ **開機順序就是這座台子的正確性**:`libGeo` 是模組層的一張表,`loadPartLibs()` 一旦跑完
//      就全域生效 ⇒ 所有「原版」MUST 在那之前建完並快取起來。順序寫錯不會有任何錯誤訊息,
//      只會左右兩側長得一模一樣(而那看起來像是「AI 生成跟原版沒差多少」的結論)。
//   ④ **缺的不准藏**:缺件 / 孤兒節點 / 未記載來源三種缺口由伺服器端推導,這裡照實畫出來。
// three 走 CDN(A2)⇒ 拿不到就要能降級(原則 6):3D 那半停用,方法/來源圖/數據照常看得到。

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const n3 = (v) => (v == null ? '—' : (Math.round(v * 1000) / 1000).toString());

/** 覆核狀態:三個出口各自對得上 runbook 的下一步動作 */
const STATUS = {
  ok: ['✔ 通過', 'ok'],
  regen: ['⟳ 重生(同圖換參數)', 'flag'],
  reimg: ['⇄ 換來源圖', 'flag'],
};
/** 對照用的座號:同一顆 seed 兩側才比得起來(buildBeacon 的 stretch 由 seed 決定) */
const SEEDS = [1, 3, 7];
/** 三種取景,全部**推導自當件的實測幾何**(手寫距離的話,r 1.5m 的疊石與 24m 的水塔只能二選一
 *  照顧得到:9m 對水塔是貼著一根腿看,對疊石又剛好把 13m 的旗桿塞滿整格):
 *    `part`  這一件零件本身(換掉的就是它)—— 中心取描述子的位置、距離由 fallback 半徑反解。
 *    `whole` 整件地標 —— 距離由碰撞柱高度反解。
 *    `lane`  兵線走廊半寬外 22m 的固定機位 = 玩家實際看到的樣子,不同件之間可比。 */
const DISTS = { part: '零件', whole: '整件', lane: '兵線 22m' };

const app = {
  data: null, cur: null, filter: 'all',
  seed: SEEDS[0], dist: 'part', collider: true, spin: true,
};

// ---- 資料 ------------------------------------------------------------------
const api = async (body) => (await fetch('/api/parts', body
  ? { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }
  : undefined)).json();

const rowOf = (key) => app.data.rows.find((r) => r.key === key);
const itemOf = (key) => app.data?.state?.items?.[key] || null;

// ---- 3D(全部集中在這一段;失敗只讓這一段停用)-------------------------------
const gfx = {
  ready: false, error: null, THREE: null, beacons: null, camera: null,
  mods: new Map(),      // 'now' | `rev:<sha>` → beacons 模組
  groups: new Map(),    // `${phase}|${src}|${kind}|${seed}` → Group(整場快取,不重建也不 dispose)
  viewers: [],
  orbit: { yaw: 0.9, pitch: 0.28 },
};

async function initGfx(data) {
  gfx.THREE = await import('three');
  gfx.beacons = await import('/public/js/beacons.js');
  // 植被/神木那一半由 biomes 自己的 buildVegMeshes 建(同紀律 ①:台上沒有第二套組裝器)
  gfx.biomes = await import('/public/js/biomes.js');
  gfx.rng = await import('/public/js/rng.js');
  const partlib = await import('/public/js/partlib.js');
  const { setCelSun, bakeContactAO } = await import('/public/js/toon.js');
  gfx.bakeContactAO = bakeContactAO;
  gfx.mods.set('now', gfx.beacons);

  // 舊版模組(純資料件的「原版」)——**一律在 loadPartLibs 之前**跑完 import 與建構
  for (const rev of new Set(data.rows.map((r) => r.view?.rev).filter(Boolean))) {
    try { gfx.mods.set(`rev:${rev}`, await import(`/baseline/${rev}/beacons.js`)); }
    catch (e) { console.warn(`baseline ${rev} 載不到:`, e?.message || e); }
  }

  // ── 紀律 ③:原版全部先建完 ────────────────────────────────────────────
  // `pre` = 零件庫尚未載入的那一刻建的(保險絲路徑);`post` = 載入之後建的(= 遊戲實際畫面)。
  // 舊版模組的零件表若將來也出現 `['lib', …]` 列,它同樣落在 `pre` 這一輪 —— 那是刻意的:
  // 「那一版的原版」跟今天的零件庫沒有關係。
  for (const r of data.rows) {
    const v = r.view;
    if (!v?.kind) continue;
    const src = v.mode === 'baseline-vs-now' ? `rev:${v.rev}` : 'now';
    if (v.mode === 'now-only') continue;
    if (!gfx.mods.has(src)) continue;
    for (const s of SEEDS) build('pre', src, v.kind, s, v.builder);
  }

  await partlib.loadPartLibs();

  // 共用相機:兩側同一顆,轉哪一邊另一邊跟著轉(不同角度的兩張圖沒有可比性)
  gfx.camera = new gfx.THREE.PerspectiveCamera(38, 1, 0.1, 500);
  setCelSun(new gfx.THREE.Vector3(-0.5, 0.45, -0.75).normalize());   // 側後鍵光:暗面要在畫面上
  gfx.viewers = [makeViewer(), makeViewer()];
  gfx.ready = true;
  requestAnimationFrame(tick);
}

/**
 * 建一件(快取整場)。`builder` 決定用哪一支**遊戲自己的**建構器:
 *   'beacon' → beacons.buildBeacon(kind, seed)
 *   'veg'    → biomes.buildVegMeshes(kind, [一株], season)——植被走 InstancedMesh,
 *              這裡就餵一個實例(items.length = 1),擺位/抖動仍是它自己那條 vegPartXform。
 *   'mega'   → biomes 的巨岩三支(見 `buildMegalith`)——命令式建造端,沒有「一款一張零件表」
 *              那種東西可以餵,只能照 placeMegaliths 的順序呼叫它自己那三支。
 * 種子只用來湊出一株的樣貌差異(dj/ry),與遊戲的散布無關 —— 台子不模擬佈局,只比幾何。
 *
 * **builder 少一種的下場**(2026-08-06 修:巨岩那三顆節點就是這樣掉進裂縫的):
 * `buildBeacon(kind)` 對認不得的 kind 是 `KIND_PARTS[kind] || KIND_PARTS.cairn` —— 靜默回退。
 * 於是 `rock/mega_*`(kind 'megalith')兩側畫的都是**地標疊石**,而疊石自己也吃 `rock/*` 節點
 * ⇒ 左右真的長得不一樣、讀數也在動,看起來完全正常,只是那顆巨岩從來沒上過台。
 */
function build(phase, src, kind, seed, builder = 'beacon') {
  const key = `${phase}|${src}|${kind}|${seed}|${builder}`;
  if (!gfx.groups.has(key)) {
    const mod = gfx.mods.get(src);
    if (!mod) return null;
    if (builder === 'veg') {
      const g = new gfx.THREE.Group();
      const it = { x: 0, y: 0, z: 0, s: 1, ry: seed * 0.7, dj: (seed % 5) / 5 };
      for (const m of gfx.biomes.buildVegMeshes(kind, [it], 'summer')) g.add(m);
      gfx.groups.set(key, g);
    } else if (builder === 'mega') {
      gfx.groups.set(key, buildMegalith(seed));
    } else if (builder === 'bld' && gfx.biomes.buildBldBucket?.[kind]) {
      // 建物屋頂配件桶:遊戲自己的桶建構表(count = 1 取樣)。instance scale 就是尺寸,
      // 這裡只給一組代表性尺寸讓幾何看得出比例 —— 台子不模擬佈局,數字是取樣不是第二份佈局。
      const DIM = { chimney: [1.15, 4.2, 1.15], tank: [1.75, 3.5, 1.75], acbox: [2.2, 2.6, 2.2] };
      const [sx, sy, sz] = DIM[kind] || [1, 1, 1];
      const im = gfx.biomes.buildBldBucket[kind](1);
      im.setMatrixAt(0, new gfx.THREE.Matrix4().compose(
        new gfx.THREE.Vector3(0, sy / 2, 0), new gfx.THREE.Quaternion(),
        new gfx.THREE.Vector3(sx, sy, sz)));
      im.instanceMatrix.needsUpdate = true;
      const g = new gfx.THREE.Group();
      g.add(im);
      gfx.groups.set(key, g);
    } else if (builder === 'beacon' && mod.BEACON_KINDS[kind]) {
      gfx.groups.set(key, mod.buildBeacon(kind, seed));
    } else {
      // **認不得就空著**,MUST NOT 交給 buildBeacon 收尾 —— 它對未知 kind 是
      // `KIND_PARTS[kind] || KIND_PARTS.cairn` 的靜默回退,台上會理直氣壯地畫出另一個物件
      // (兩側還會因為疊石自己也吃 rock/* 節點而長得不一樣 = 看起來完全正常)。
      // 兩側都空 ⇒ 讀數寫「(建不起來)」,新增消費端時 MUST 在這裡補一支建構器。
      console.warn(`[對照台] 沒有 builder 認得「${builder}/${kind}」—— 這一列不畫,補建構器`);
      return null;
    }
  }
  return gfx.groups.get(key);
}

/**
 * 一顆合成巨岩。順序照 `placeMegaliths` 的那一段:建量體 → 表面特徵 → 零件抖動 → 接地 AO,
 * 每一步都是**遊戲自己的**那一支(紀律 ①:台上不生任何幾何)。
 *
 * 為什麼是**合成**岩:`MEGA_LIB` 的節點只長在 `synthMegalith`(marble 堆塊 / 崩落岩塊 /
 * 伴生圓丘)與 `decorateMegalith`(疊石)裡 —— 名岩 `MEGALITHS[].build` 一顆庫零件都不吃,
 * 拿它當對照,兩側會逐位元一模一樣(又一個「AI 跟原版差不多」的假結論)。崩落岩塊每一型
 * 都有 ⇒ 任何座號都看得到那三顆節點,marble 那一型再多看到堆塊本體。
 *
 * 刻意略過的只有兩件與**露頭/地形**綁定、與零件無關的事:整片露頭共用的色相偏移(field 級,
 * 兩側同樣不套 ⇒ 不影響對照)與落地縮放/落底(台上恆 s = 1,鏡頭按實測高度自己退開)。
 */
function buildMegalith(seed) {
  const g = new gfx.THREE.Group();
  const rnd = gfx.rng.mulberry32((seed * 2654435761) >>> 0);
  const meta = gfx.biomes.synthMegalith(g, rnd);
  gfx.biomes.decorateMegalith(g, meta.anchor, rnd, 1);
  gfx.biomes.jitterMegalith(g, (seed % 5) / 5, meta.col.r);
  gfx.bakeContactAO(g, 6);
  // 巨岩的碰撞柱是**登記值**(佈局端 `meta.col`),不是從幾何量出來的 —— 拿 beaconCollider
  // 硬套一個「看起來很像碰撞柱」的包圍盒上去,台上就會出現一根遊戲裡不存在的柱子(同神木)
  g.userData.megaCol = { r: meta.col.r, h: meta.col.h };
  g.userData.megaMain = meta.main;
  return g;
}

function makeViewer() {
  const T = gfx.THREE;
  const canvas = document.createElement('canvas');
  const renderer = new T.WebGLRenderer({ canvas, antialias: true });
  renderer.setClearColor(0x171b21, 1);
  const scene = new T.Scene();
  const SUN = new T.Vector3(-0.5, 0.45, -0.75).normalize();
  const dir = new T.DirectionalLight(0xffffff, 2.1);
  dir.position.copy(SUN).multiplyScalar(50);
  scene.add(dir, new T.HemisphereLight(0xdff1ff, 0x2b2f38, 1.1));
  scene.add(new T.GridHelper(30, 30, 0x4a5160, 0x3a4050));
  const v = { canvas, renderer, scene, group: null, wire: null, live: false };

  // 拖曳 = 兩側一起轉(orbit 是共用狀態);滾輪縮放同理
  let drag = null;
  canvas.addEventListener('pointerdown', (e) => { drag = { x: e.clientX, y: e.clientY }; canvas.setPointerCapture(e.pointerId); app.spin = false; syncTools(); });
  canvas.addEventListener('pointermove', (e) => {
    if (!drag) return;
    gfx.orbit.yaw -= (e.clientX - drag.x) * 0.008;
    gfx.orbit.pitch = Math.max(-0.35, Math.min(1.25, gfx.orbit.pitch + (e.clientY - drag.y) * 0.005));
    drag = { x: e.clientX, y: e.clientY };
  });
  const stop = () => { drag = null; };
  canvas.addEventListener('pointerup', stop);
  canvas.addEventListener('pointercancel', stop);
  canvas.addEventListener('wheel', (e) => { e.preventDefault(); app.zoom = Math.max(0.5, Math.min(2.5, (app.zoom || 1) * (e.deltaY > 0 ? 1.08 : 0.93))); }, { passive: false });
  return v;
}

/** 掛一件到某一側。讀數(三角形/mesh 數/碰撞柱)一律**量真品群組**,不抄伺服器端的數字 */
function setViewerGroup(v, group, builder = 'beacon') {
  const T = gfx.THREE;
  if (v.group && v.group !== group) v.scene.remove(v.group);
  if (v.wire) { v.scene.remove(v.wire); v.wire.geometry.dispose(); v.wire.material.dispose(); v.wire = null; }
  v.group = group || null;
  v.live = !!group;
  if (!group) return null;
  v.scene.add(group);
  // 神木的碰撞柱不是由幾何量出來的(那是樹幹的登記柱,住 biomes 的散布端)⇒ 這裡照實
  // 改量包圍盒,MUST NOT 拿 beaconCollider 硬套一個看起來很像碰撞柱的東西上去。
  // 巨岩同理但反過來:它**有**登記柱(synthMegalith 回傳的 `col`),量包圍盒才是假的。
  const col = (builder === 'veg' || builder === 'bld') ? vegExtent(group)
    : builder === 'mega' ? group.userData.megaCol
      : gfx.beacons.beaconCollider(group);
  if (app.collider && builder !== 'veg' && builder !== 'bld') {
    v.wire = new T.Mesh(
      new T.CylinderGeometry(col.r, col.r, col.h, 14, 1, true),
      new T.MeshBasicMaterial({ color: 0x2ee6d6, wireframe: true, transparent: true, opacity: 0.3 }),
    );
    v.wire.position.y = col.h / 2;
    v.scene.add(v.wire);
  }
  let tris = 0, meshes = 0;
  group.traverse((o) => {
    if (!o.isMesh) return;
    meshes++;
    const g = o.geometry;
    // InstancedMesh 一件 = 幾何 × 實例數(台上只擺一株,但別讓讀數把這件事藏起來)
    tris += (g.index ? g.index.count : g.attributes.position.count) / 3 * (o.isInstancedMesh ? o.count : 1);
  });
  return { tris, meshes, r: col.r, h: col.h, colWhat: COL_WHAT[builder] || COL_WHAT.beacon };
}

/** 讀數那一行的「這根柱子是什麼」——三種來源不同,寫同一個字就是騙人 */
const COL_WHAT = {
  beacon: '碰撞柱(實測)',
  veg: '外廓(包圍盒;碰撞柱住散布端)',
  mega: '碰撞柱(登記值 meta.col)',
  bld: '外廓(包圍盒;屋頂配件不掛碰撞柱,建物本體的碰撞盒在 blockers)',
};

/** 一株植被的實測外廓(包圍盒:水平最遠點 + 頂高)—— 只給取景與讀數用 */
function vegExtent(group) {
  const box = new gfx.THREE.Box3().setFromObject(group);
  return {
    r: Math.max(Math.abs(box.min.x), Math.abs(box.max.x), Math.abs(box.min.z), Math.abs(box.max.z)),
    h: box.max.y,
  };
}

function tick() {
  requestAnimationFrame(tick);
  if (!gfx.ready) return;
  if (app.spin) gfx.orbit.yaw += 0.0035;
  // 取景全部推導(見 DISTS);兩側同一顆相機 —— 不同角度的兩張圖沒有可比性
  const f = gfx.frame || {};
  let d, h, lookY;
  if (app.dist === 'lane') [d, h, lookY] = [22, 4.5, 4.0];
  else if (app.dist === 'part' && f.part) {
    const { r, cy } = f.part;
    [d, h, lookY] = [Math.max(4.5, r * 5.5), cy + r * 1.1, cy];
  } else {
    const th = Math.max(1.5, f.h || 6);
    [d, h, lookY] = [th * 1.35, th * 0.55, th * 0.45];
  }
  const z = d * (app.zoom || 1);
  const { yaw, pitch } = gfx.orbit;
  gfx.camera.position.set(Math.sin(yaw) * z * Math.cos(pitch), h + Math.sin(pitch) * z * 0.7, Math.cos(yaw) * z * Math.cos(pitch));
  gfx.camera.lookAt(0, lookY, 0);
  for (const v of gfx.viewers) {
    if (!v.live || !v.canvas.isConnected) continue;
    const w = v.canvas.clientWidth, ht = v.canvas.clientHeight;
    if (!w || !ht) continue;
    if (v.canvas.width !== w || v.canvas.height !== ht) v.renderer.setSize(w, ht, false);
    gfx.camera.aspect = w / ht;
    gfx.camera.updateProjectionMatrix();
    v.renderer.render(v.scene, gfx.camera);
  }
}

// ---- 左側清單 --------------------------------------------------------------
function statOf(r) {
  const it = itemOf(r.key);
  return { status: it?.status || '', flag: ['regen', 'reimg'].includes(it?.status || '') };
}

function renderList() {
  const keep = (r) => {
    const s = statOf(r);
    if (app.filter === 'todo') return !s.status;
    if (app.filter === 'flag') return s.flag;
    if (app.filter === 'miss') return r.missing;
    if (app.filter === 'undoc') return !r.prov;
    return true;
  };
  $('prList').innerHTML = app.data.rows.filter(keep).map((r) => {
    const s = statOf(r);
    const pill = r.missing ? '<span class="pr-pill miss">缺件</span>'
      : s.status ? `<span class="pr-pill ${STATUS[s.status]?.[1] || ''}">${esc(STATUS[s.status]?.[0] || s.status)}</span>`
        : '<span class="pr-pill">未覆核</span>';
    const meth = r.method
      ? `<span class="pr-pill gen">${esc(r.method.short)}</span>`
      : '<span class="pr-pill miss">未記載</span>';
    return `<div class="pr-row ${app.cur === r.key ? 'on' : ''}" data-key="${esc(r.key)}">
      <div class="pr-rn"><b>${esc(r.key)}</b><span>${esc(r.consumer || '—')}</span></div>
      ${meth}${pill}</div>`;
  }).join('') || '<div class="pr-dim" style="padding:12px">(這個篩選沒有結果)</div>';
  for (const el of $('prList').querySelectorAll('.pr-row')) el.onclick = () => select(el.dataset.key);
}

function renderStat() {
  const rows = app.data.rows;
  const ok = rows.filter((r) => itemOf(r.key)?.status === 'ok').length;
  const flag = rows.filter((r) => statOf(r).flag).length;
  $('prStat').textContent = `生成物 ${rows.length} 件 ・ 已通過 ${ok} ・ 有意見 ${flag}`
    + ` ・ 缺件 ${app.data.missing.length} ・ 孤兒節點 ${app.data.orphans.length}`
    + ` ・ 未記載來源 ${app.data.undocumented.length}`
    + (app.data.issues.length ? ` ・ 帳目問題 ${app.data.issues.length}` : '');
}

// ---- 右側 ------------------------------------------------------------------
function select(key) { app.cur = key; renderList(); renderBody(); }

/** 「零件」取景成不成立(單一縫:取景計算與鈕面的禁用狀態同吃)*/
const partFramable = (r) => !!(r.env && r.view?.at) && r.view.builder !== 'mega';
/** 這一列**實際**用的取景:零件取景不成立時退回整件 —— 鈕面 MUST 跟著亮那一顆,
 *  否則畫面已經是整件、三顆鈕卻一顆都沒亮(看起來像壞掉,而它其實正常) */
const effDist = (r) => (partFramable(r) || app.dist !== 'part' ? app.dist : 'whole');

const PANE_LABEL = {
  'fuse-vs-lib': ['原版(保險絲 primitive,零件庫未載入)', 'AI 生成(零件庫 GLB)'],
  'baseline-vs-now': ['原版(改寫前的零件表)', 'AI 生成(現行零件表)'],
  'now-only': [null, '現行(沒有可比的原版)'],
};

function imgCard(im) {
  const meta = [im.role === 'reference' ? '參考' : '主要輸入', im.license?.toUpperCase(), im.creator || '(未署名)']
    .filter(Boolean).join(' ・ ');
  const pic = im.has
    ? `<img src="${im.url}" alt="" loading="lazy">`
    : `<div class="pr-miss">原圖不在本機<br>(照片不進儲存庫;<br>runbook §3 規則 2 / §5d 資料家目錄)</div>`;
  return `<div class="pr-img">${pic}
    <div class="pr-icap">${esc(im.id)}<br>${esc(meta)}<br>查詢「${esc(im.query || '')}」
    ${im.source_url ? `<br><a href="${esc(im.source_url)}" target="_blank" rel="noopener">出處 ↗</a>` : ''}</div></div>`;
}

function methodSection(r) {
  if (!r.prov) {
    return `<div class="pr-sec pr-warn"><h3>⚑ 未記載來源</h3>
      <div>這件生成物在 <code>tools/ai3d/parts_manifest.json</code> 裡沒有帳 ⇒
      **說不出用哪個方法、吃哪張圖**。補一筆帳(方法鍵取自 <code>tools/ai3d/provenance.mjs METHODS</code>)才算完成入庫。</div></div>`;
  }
  const p = r.prov;
  const kv = (o) => Object.entries(o).filter(([, v]) => v != null && v !== '')
    .map(([k, v]) => `<b>${esc(k)}</b><div>${esc(v)}</div>`).join('');
  return `<div class="pr-sec"><h3>生成方法</h3>
    <div class="pr-kv">${kv({
    方法: `${r.method.label} ・ 帳上的鍵 ${r.method.key}`,
    適用: r.method.doc,
    工具: p.gen?.tool, 執行環境: p.gen?.runner, 參數: p.gen?.params,
    機器: p.gen?.machine, 實測: p.gen?.measured, 生成註記: p.gen?.note,
    後處理: p.post?.tool,
    後處理參數: [p.post?.fit != null ? `FIT ${p.post.fit}` : '', p.post?.ry_deg ? `ry ${p.post.ry_deg}°` : '',
      p.post?.dy != null ? `dy ${p.post.dy}` : ''].filter(Boolean).join(' ・ '),
    後處理註記: p.post?.note,
    落地版本: p.rev ? `${p.rev}(${p.at || ''})` : null,
    原版版本: p.baseline?.rev ? `${p.baseline.rev} — ${p.baseline.what || ''}` : null,
    備註: p.note,
  })}</div></div>`;
}

function dataSection(r) {
  if (r.measured) {
    const okE = r.measured.rMax <= r.env.r + 1e-6;
    const okT = !r.budget || r.measured.tris <= r.budget.cap;
    return `<div class="pr-sec"><h3>數據對照(離線量測)</h3>
      <table class="pr-tab">
        <tr><th>項目</th><th>原版(fallback primitive)</th><th>AI 生成(GLB 節點)</th><th>判定</th></tr>
        <tr><td>描述子</td><td class="num">${esc(JSON.stringify(r.view.fb))}</td>
            <td class="num">${esc(r.key)}</td><td>—</td></tr>
        <tr><td>水平徑向</td><td class="num">${n3(r.env.r)}</td><td class="num">${n3(r.measured.rMax)}</td>
            <td class="${okE ? 'pr-good' : 'pr-bad'}">${okE ? `✔ 收在包絡內(${(r.pct * 100).toFixed(0)}%)` : '✘ 頂出包絡 = A30'}</td></tr>
        <tr><td>縱向</td><td class="num">±${n3(r.env.hy)}</td>
            <td class="num">[${n3(r.measured.yMin)}, ${n3(r.measured.yMax)}]</td><td>—</td></tr>
        <tr><td>三角形</td><td class="num">—</td><td class="num">${r.measured.tris}</td>
            <td class="${okT ? 'pr-good' : 'pr-bad'}">${r.budget ? `${okT ? '✔' : '✘'} 預算 ${r.budget.cap}` : '(無量測預算)'}</td></tr>
        <tr><td>頂點</td><td class="num">—</td><td class="num">${r.measured.verts}</td><td>—</td></tr>
        ${r.budget?.kind ? `<tr><td>逐株庫零件合計</td><td class="num">現值 ${r.budget.kind.cur}</td>
          <td class="num">上限 ${r.budget.kind.cap}</td>
          <td class="pr-dim">單件合格 ≠ 整株合格:一株十幾件全換掉,每件都「合格」卻是 20 倍</td></tr>` : ''}
      </table>
      <div class="pr-dim" style="margin-top:4px">外廓契約 = 離線外廓取 fallback 的外廓(partlib.js 檔頭);
        執行期碰撞柱仍走 <code>beaconCollider</code> 實測 —— 上方兩張圖裡的青色圓柱就是它。</div></div>`;
  }
  if (r.now) {
    const row = (label, a, b) => `<tr><td>${label}</td><td class="num">${a ?? '—'}</td><td class="num">${b ?? '—'}</td>
      <td class="num">${a != null && b != null ? (b - a > 0 ? `+${(b - a).toFixed(2).replace(/\.00$/, '')}` : (b - a).toFixed(2).replace(/\.00$/, '')) : '—'}</td></tr>`;
    return `<div class="pr-sec"><h3>數據對照(離線量測)</h3>
      <table class="pr-tab">
        <tr><th>項目</th><th>原版(${esc(r.prov?.baseline?.rev || '?')})</th><th>現行</th><th>差</th></tr>
        ${row('零件數', r.base?.parts, r.now.parts)}
        ${row('實算水平外廓', r.base?.extent, r.now.extent)}
        ${row('標稱 foot', r.base?.foot, r.now.foot)}
      </table>
      ${r.baseErr ? `<div class="pr-bad">原版取不到:${esc(r.baseErr)}</div>` : ''}
      <div class="pr-dim" style="margin-top:4px">件數與外廓一律由**兩個版本的零件表**推導,不在來源帳裡手寫。
        <code>foot</code> 是規劃期預留值,MUST 貼著實算外廓(<code>audit_beacons</code> 雙向釘住)。</div></div>`;
  }
  return '';
}

function renderBody() {
  const r = rowOf(app.cur);
  const body = $('prBody');
  if (!r) { body.innerHTML = '<div class="pr-dim">← 左側挑一件生成物</div>'; return; }
  const [lLab, rLab] = PANE_LABEL[r.view?.mode] || PANE_LABEL['now-only'];

  body.innerHTML = `
  <h2 class="pr-h2">${esc(r.title)}</h2>
  <div class="pr-mline">${esc(r.method ? r.method.label : '未記載來源')}
    ・ 消費端 ${esc(r.consumer || '—')}${r.glbPath ? ` ・ ${esc(r.glbPath)}` : ''}
    ${r.missing ? ' ・ <span class="pr-bad">缺件:執行期整件走 fallback</span>' : ''}</div>

  <div class="pr-tools">
    <span class="pr-dim">座號</span>
    <div class="seg" id="prSeed">${SEEDS.map((s) => `<button class="segb ${s === app.seed ? 'on' : ''}" data-seed="${s}">#${s}</button>`).join('')}</div>
    <span class="pr-dim">取景</span>
    <div class="seg" id="prDist">${Object.entries(DISTS).map(([k, v]) => {
    const off = k === 'part' && !partFramable(r);
    return `<button class="segb ${k === effDist(r) ? 'on' : ''}" data-dist="${k}"${off
      ? ' disabled title="單位包絡節點:實際大小與擺位由呼叫端 mesh.scale 決定 ⇒ 零件取景不成立,一律看整件"'
      : ''}>${v}</button>`;
  }).join('')}</div>
    <label><input type="checkbox" id="prCol" ${app.collider ? 'checked' : ''}>碰撞柱</label>
    <label><input type="checkbox" id="prSpin" ${app.spin ? 'checked' : ''}>自轉</label>
    <span class="pr-dim">(拖曳任一側 = 兩側一起轉;滾輪縮放)</span>
  </div>

  <div class="pr-stage" id="prStage">
    ${lLab ? `<div class="pr-pane" id="prPaneL"><div class="pr-cap">◀ ${esc(lLab)}</div>
      <div class="pr-slot"></div><div class="pr-read" id="prReadL"></div></div>` : ''}
    <div class="pr-pane gen" id="prPaneR"><div class="pr-cap">▶ ${esc(rLab)}</div>
      <div class="pr-slot"></div><div class="pr-read" id="prReadR"></div></div>
  </div>

  <div class="pr-sec"><h3>來源圖(img)</h3>
    <div class="pr-imgs">${r.imgs.length ? r.imgs.map(imgCard).join('')
    : '<div class="pr-none">來源帳裡沒有記載任何來源圖</div>'}</div></div>

  ${methodSection(r)}
  ${dataSection(r)}

  <div class="pr-sec"><h3>覆核</h3>
    <div class="seg" id="prSt">
      ${Object.entries(STATUS).map(([k, [label]]) =>
    `<button class="segb ${itemOf(r.key)?.status === k ? 'on' : ''}" data-st="${k}">${label}</button>`).join('')}
      <button class="segb" data-st="">✕ 清除</button></div>
    <div class="pr-acts">
      <input class="pr-note" id="prNote" value="${esc(itemOf(r.key)?.note || '')}"
        placeholder="這一件哪裡不對 / 下一步(換哪張圖、換什麼參數)">
    </div>
    <div class="pr-acts"><button class="segb on" id="prSave">儲存</button>
      <span class="pr-saved" id="prSaved"></span></div>
  </div>`;

  mountStage(r);
  renderGaps();

  for (const b of body.querySelectorAll('#prSeed .segb')) b.onclick = () => { app.seed = +b.dataset.seed; renderBody(); };
  for (const b of body.querySelectorAll('#prDist .segb')) b.onclick = () => { app.dist = b.dataset.dist; renderBody(); };
  $('prCol').onchange = (e) => { app.collider = e.target.checked; mountStage(r); };
  $('prSpin').onchange = (e) => { app.spin = e.target.checked; };
  let status = itemOf(r.key)?.status || '';
  for (const b of body.querySelectorAll('#prSt .segb')) {
    b.onclick = () => {
      status = b.dataset.st;
      for (const x of body.querySelectorAll('#prSt .segb')) x.classList.toggle('on', !!status && x.dataset.st === status);
    };
  }
  $('prSave').onclick = async () => {
    const note = $('prNote').value.trim();
    const res = await api({ key: r.key, item: status || note ? { status, note: note || undefined } : null });
    app.data.state.items = res.items;
    $('prSaved').textContent = '已存檔 ✔';
    renderList(); renderStat();
  };
}

function syncTools() {
  const el = $('prSpin');
  if (el) el.checked = app.spin;
}

/** 把兩個 viewer 的 canvas 掛進當前這一列的兩側,並更新讀數 */
function mountStage(r) {
  const slots = [...$('prStage').querySelectorAll('.pr-slot')];
  if (!gfx.ready) {
    for (const s of slots) s.innerHTML = `<div class="pr-none">3D 對照停用<br>${esc(gfx.error || 'three CDN 連不到')}</div>`;
    return;
  }
  const v = r.view;
  const bld = v.builder || 'beacon';
  const sides = [];
  if (v.mode === 'fuse-vs-lib') {
    sides.push({ g: build('pre', 'now', v.kind, app.seed, bld), read: 'prReadL' });
    sides.push({ g: build('post', 'now', v.kind, app.seed, bld), read: 'prReadR' });
  } else if (v.mode === 'baseline-vs-now') {
    sides.push({ g: build('pre', `rev:${v.rev}`, v.kind, app.seed, bld), read: 'prReadL' });
    sides.push({ g: build('post', 'now', v.kind, app.seed, bld), read: 'prReadR' });
  } else {
    sides.push({ g: v.kind ? build('post', 'now', v.kind, app.seed, bld) : null, read: 'prReadR' });
  }
  // 取景基準:整件取實測碰撞柱高;零件取這一列描述子自己的位置與 fallback 半徑
  // (「換掉的就是它」—— 拿整件當基準的話,13m 旗桿會把 1.5m 的疊石壓成畫面底部一小坨)。
  // 巨岩那三顆是**單位包絡**節點(fallback ico(1)、位置 [0,0,0]),實際大小與擺哪由呼叫端
  // 的 mesh.scale 決定 ⇒ 零件取景在它身上不成立(照算會是「相機貼在 1m 球上,而岩體 100m」),
  // 一律退回整件;`prDist` 那顆鈕同步禁用,MUST NOT 讓它按得下去卻沒有反應
  gfx.frame = { h: 0, part: partFramable(r) ? { r: r.env.r, cy: r.view.at[1] || 0 } : null };
  sides.forEach((side, i) => {
    const viewer = gfx.viewers[i];
    const slot = slots[i];
    if (!slot || !viewer) return;
    slot.innerHTML = '';
    slot.appendChild(viewer.canvas);
    const st = setViewerGroup(viewer, side.g, bld);
    if (st) gfx.frame.h = Math.max(gfx.frame.h, st.h);
    const out = $(side.read);
    if (out) {
      out.textContent = st
        ? `${st.tris} 三角形 ・ ${st.meshes} 個 mesh(= draw call)・ `
          + `${st.colWhat} r ${st.r.toFixed(2)} h ${st.h.toFixed(2)}`
        : '(建不起來)';
    }
  });
  // 這一列只用到一側時,另一個 viewer 停止渲染(canvas 沒掛在 DOM 上也不該白跑)
  for (let i = sides.length; i < gfx.viewers.length; i++) setViewerGroup(gfx.viewers[i], null);
}

/** 缺口三種 + 帳目問題:一律列在最後,不准藏(紀律 ④) */
function renderGaps() {
  const d = app.data;
  const blocks = [];
  if (d.orphans.length) {
    blocks.push(`<h3>孤兒節點(${d.orphans.length})—— GLB 裡有、沒有任何消費端引用</h3>
      <div class="pr-dim">${d.orphans.map((o) => `${esc(o.name)}(${o.tris} tris,r ${o.rMax})`).join('、')}</div>`);
  }
  if (d.missing.length) {
    blocks.push(`<h3>缺件(${d.missing.length})—— 描述子指到不存在的節點,執行期整件走 fallback</h3>
      <div class="pr-bad">${d.missing.map(esc).join('、')}</div>`);
  }
  if (d.undocumented.length) {
    blocks.push(`<h3>未記載來源(${d.undocumented.length})—— 說不出方法與圖</h3>
      <div class="pr-bad">${d.undocumented.map(esc).join('、')}</div>`);
  }
  if (d.issues.length) {
    blocks.push(`<h3>來源帳問題(${d.issues.length})</h3>
      <div class="pr-dim">${d.issues.map((i) => `${i.level === 'err' ? '❌' : '⚠'} ${esc(i.msg)}`).join('<br>')}</div>`);
  }
  if (!blocks.length) return;
  const box = document.createElement('div');
  box.className = 'pr-sec pr-warn';
  box.innerHTML = blocks.join('<div style="height:8px"></div>');
  $('prBody').appendChild(box);
}

// ---- 啟動 ------------------------------------------------------------------
app.data = await api();
try { await initGfx(app.data); }
catch (e) { gfx.error = e?.message || String(e); console.warn('3D 對照停用:', e); }
renderStat();
renderList();
select(app.data.rows[0]?.key);
for (const b of $('prFilter').querySelectorAll('.segb')) {
  b.onclick = () => {
    app.filter = b.dataset.f;
    for (const x of $('prFilter').querySelectorAll('.segb')) x.classList.toggle('on', x === b);
    renderList();
  };
}
