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
const outwardWinding = (indices) => {
  const out = [...indices];
  for (let i = 0; i < out.length; i += 3) [out[i + 1], out[i + 2]] = [out[i + 2], out[i + 1]];
  return out;
};

/**
 * 覆核狀態:每一個出口各自對得上 `tools/ai3d/apply_verdicts.mjs` 的**一個**動作。
 * 2026-08-10 自動入庫上線後,人眼這一步從「入庫之前」搬到「入庫之後」⇒ 判決要能**撤**,
 * 於是多了第四個出口 `purge`(使用者定案:刪原始照片時**連節點一起撤下**)。
 * 2026-08-11 再多一個 `archive`(使用者:「加入移除鍵,移除遊戲與零件台,放到封存區」)——
 * 它與 `regen`/`reimg` 的差別是**下一步在誰身上**:那兩個是「再試一次」⇒ 照片回待跑池;
 * 移除是「這顆結案了」⇒ 撤出遊戲、來源帳整列搬進封存帳,不再自動重跑。
 * `ok` 以外一律算「有意見」⇒ 那個判斷 MUST 由本表推導,MUST NOT 再手寫一份狀態清單
 * (手寫的那份會在加第六個出口時靜默過期:新出口不進「有意見」的篩選,而畫面完全正常)。
 */
const STATUS = {
  ok: ['✔ 通過', 'ok'],
  replace: ['⇢ 通過並替代舊件', 'flag'],
  regen: ['⟳ 重生(同圖換參數)', 'flag'],
  reimg: ['⇄ 換來源圖', 'flag'],
  archive: ['⊘ 移除(撤出遊戲並封存)', 'flag'],
  purge: ['✕ 刪除來源圖(連節點撤下)', 'flag'],
};
/**
 * 對照用的座號:同一顆 seed 兩側才比得起來(buildBeacon 的 stretch 由 seed 決定)。
 * **座號組 MUST 蓋得到每一顆庫節點**:命令式巨岩逐座號挑型 ⇒ 一顆節點只長在某些座號上,
 * 沒被任何一個座號蓋到的那幾顆在台上**三個座號都看不到**(2026-08-06 實測:舊組 #1/#3/#7
 * 蓋不到 `rock/mega_e` 與 `rock/mega_f`)。#10 一顆補上 a~f,#3 蓋到的是 #1/#10 的子集
 * ⇒ 換掉不損失。新增庫節點時 MUST 重掃一次,缺口由「零件」那一行的說明講出來(紀律 ④)。
 * 2026-08-06 晚 `rock/hoodoo_a` 入庫重掃(台子雜湊 (seed×2654435761)>>>0 → synthMegalith):
 * hoodoo 型只在 #22/#33;#1 mesa、#7 tower、#10 marble 各自是必要覆蓋 ⇒ **加 #22 不換掉誰**
 * (mega_f 只有 marble 的 8 疊塊輪得到,丟 #10 = f 失覆蓋)。
 */
const SEEDS = [1, 7, 10, 22];
/** 三種取景,全部**推導自台上真的建出來的那一團幾何**(手寫距離的話,r 1.5m 的疊石與 24m 的
 *  水塔只能二選一照顧得到:9m 對水塔是貼著一根腿看,對疊石又剛好把 13m 的旗桿塞滿整格):
 *    `part`  這一件零件本身(換掉的就是它)—— 框 = 兩側**差集**那幾顆 mesh 的實測包圍球。
 *    `whole` 整件 —— 框 = 整個群組的實測包圍球。
 *    `lane`  兵線走廊半寬外 22m 的固定機位 = 玩家實際看到的樣子,不同件之間可比(刻意不隨物件變)。
 *
 *  **框 MUST 量台上那一團,MUST NOT 取離線描述子或登記碰撞柱**(2026-08-06 修):舊制 `part`
 *  取「fallback 包絡半徑 + 零件表座標」、`whole` 取「登記碰撞柱高度 × 1.35」,兩個都不是台上
 *  那一團的尺寸與位置,同一個成因長出三個症狀 ——
 *    ① 恆 `lookAt(0, y, 0)` ⇒ 偏離中軸的零件永遠不在畫面中央(神木冠簇離軸 5.8m);
 *    ② 距離只看高度不看水平尺寸 ⇒ 58m 高但 207m 寬的巨岩把相機關在石頭裡面(整格灰牆);
 *    ③ 單位包絡節點(mega,fallback `ico(1)` 且座標 `[0,0,0]`)推不出東西 ⇒ 那顆鈕只好禁用
 *       = PR147 的主角在台上**沒有任何一種取景看得到它**。
 *  三個症狀都沒有錯誤訊息,畫面上只表現成「AI 生成跟原版差不多」—— 這座台子最不能出現的假結論。 */
const DISTS = { part: '零件', whole: '整件', lane: '兵線 22m' };
const TREE_VIEWS = {
  whole: '整件',
  trunkBranch: '樹幹＋樹枝',
  branch: '只看樹枝',
};
/** 包圍球塞進畫面時留的邊界餘裕(1 = 剛好貼滿較窄的那一軸) */
const FIT_PAD = 1.3;

const app = {
  data: null, cur: null, filter: 'all', list: 'nodes',
  filterMethod: '', filterFamily: '', filterDate: '', filterPhotoDate: '', filterVersion: '',
  seed: SEEDS[0], dist: 'part', collider: true, spin: true,
  treeView: 'whole', topView: false,
};

const FAMILY_LABELS = {
  beacon: 'beacon (地標)',
  bld: 'bld (建物配件)',
  building: 'building (建築)',
  rock: 'rock (岩石/巨岩)',
  ship: 'ship (船艦)',
  tree: 'tree (植被/神木)',
  vehicle: 'vehicle (載具)',
  vehicle_2w: '兩輪載具 (機車／腳踏車)',
  vehicle_4w: '四輪載具 (汽車／重型載具)',
  vehicle_other: '其他載具',
};

const rowCategory = (r) => r?.category || r?.family || (r?.key ? r.key.split('/')[0] : 'other');

const isTreeModelRow = (r) => r?.family === 'tree' && r?.view?.builder === 'model3d';
function treeModelPartRole(name) {
  const s = String(name || '').toLowerCase();
  if (/(^|_)(crown|canopy|leaf|foliage)(_|$)/.test(s)) return 'canopy';
  if (/(^|_)(branch|primary|outer|secondary|arm|candelabra|bough)(_|$)/.test(s)
    || /gnarled_(trunk|bough)/.test(s)) return 'branch';
  if (/(trunk|bole|leader|root|bottle)/.test(s)) return 'trunk';
  return 'other';
}

/** 樹木 model.json 的旋轉沿用 direct_ingest_v6:先 X、再 Y、再 Z；用 quaternion
 * 明確保留這個軸序，不能把它直接交給 Three.js 的 Euler XYZ 解讀。 */
function applyModel3dTransform(mesh, part, manualOrder = false) {
  const T = gfx.THREE;
  if (part.position) mesh.position.set(...part.position);
  if (!part.rotation) return;
  if (!manualOrder) { mesh.rotation.set(...part.rotation); return; }
  const [rx, ry, rz] = part.rotation;
  const qx = new T.Quaternion().setFromAxisAngle(new T.Vector3(1, 0, 0), rx);
  const qy = new T.Quaternion().setFromAxisAngle(new T.Vector3(0, 1, 0), ry);
  const qz = new T.Quaternion().setFromAxisAngle(new T.Vector3(0, 0, 1), rz);
  mesh.quaternion.copy(qz).multiply(qy).multiply(qx);
}

// ---- 資料 ------------------------------------------------------------------
const api = async (body) => (await fetch('/api/parts', body
  ? { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }
  : undefined)).json();

const rowOf = (key) => app.data.rows.find((r) => r.key === key);
const itemOf = (key) => app.data?.state?.items?.[key] || null;

// ---- 3D(全部集中在這一段;失敗只讓這一段停用)-------------------------------
const gfx = {
  ready: false, error: null, THREE: null, beacons: null, aquatics: null, camera: null,
  mods: new Map(),      // 'now' | `rev:<sha>` → beacons 模組
  groups: new Map(),    // `${phase}|${src}|${kind}|${seed}` → Group(整場快取,不重建也不 dispose)
  viewers: [], topCamera: null, frameTop: null,
  orbit: { yaw: 0.9, pitch: 0.28 },
};

async function initGfx(data) {
  gfx.THREE = await import('three');
  gfx.beacons = await import('/public/js/beacons.js');
  // 植被/神木那一半由 biomes 自己的 buildVegMeshes 建(同紀律 ①:台上沒有第二套組裝器)
  gfx.biomes = await import('/public/js/biomes.js');
  gfx.aquatics = await import('/public/js/aquatics.js');
  gfx.rng = await import('/public/js/rng.js');
  const partlib = await import('/public/js/partlib.js');
  gfx.runtimePartModel = await import('/public/js/runtimePartModel.js');
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
  gfx.topCamera = new gfx.THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 500);
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
      // mass = 整棟量體(佇列 F):代表尺寸取「挑得中的那一群」的量級(高層商辦 h > 55m),
      // 不是配件的那個量級 —— 拿 2m 的機房尺寸去縮一整棟樓,台上會看到一塊薄片。
      // 第三參數 = 名冊輪替索引,借用座號:`mass` 是輪替名冊(一款打天下 = 同一條天際線
      // 十幾棟同剪影),台上逐座號正好把整份名冊都翻一遍;舊三桶多收一個參數無作用。
      const DIM = { chimney: [1.15, 4.2, 1.15], tank: [1.75, 3.5, 1.75], acbox: [2.2, 2.6, 2.2], mass: [22, 90, 22] };
      const [sx, sy, sz] = DIM[kind] || [1, 1, 1];
      const im = gfx.biomes.buildBldBucket[kind](1, undefined, seed);
      im.setMatrixAt(0, new gfx.THREE.Matrix4().compose(
        new gfx.THREE.Vector3(0, sy / 2, 0), new gfx.THREE.Quaternion(),
        new gfx.THREE.Vector3(sx, sy, sz)));
      im.instanceMatrix.needsUpdate = true;
      const g = new gfx.THREE.Group();
      g.add(im);
      gfx.groups.set(key, g);
    } else if (builder === 'aquatic' && kind === 'patrol_ship') {
      gfx.groups.set(key, gfx.aquatics.buildPatrolShipMesh());
    } else if (builder === 'model3d') {
      const g = new gfx.THREE.Group();
      gfx.groups.set(key, g);
      fetch(`/api/model3d?key=${encodeURIComponent(kind)}`)
        .then((res) => (res.ok ? res.json() : null))
        .then((model) => {
          if (!model) return;
          const row = rowOf(kind);
          const sharedVehicleMesh = row?.family === 'vehicle' && model.meshData?.vertices?.length;
          if (sharedVehicleMesh) {
            // 載具直接走遊戲同一個 loader；不可在零件台另寫一份 primitive 對照器。
            const mesh = gfx.runtimePartModel.makeRuntimePartModel({
              ...model,
              key: kind,
              family: row.family,
              version: row.version,
              image: row.item?.image || row.prov?.source?.file || row.at,
            }, { environment: true });
            mesh.userData.modelPartName = kind;
            g.add(mesh);
          } else if (model.parts && model.parts.length) {
            for (const p of model.parts) {
              let geo = null;
              if (p.type === 'box' && p.dimensions) {
                geo = new gfx.THREE.BoxGeometry(...p.dimensions);
              } else if (p.type === 'polygonal_prism') {
                geo = new gfx.THREE.CylinderGeometry(p.radius, p.radius, p.height, p.sides || 8);
              } else if (p.type === 'frustum_pyramid' || p.type === 'conical_frustum') {
                const topR = p.radii ? p.radii[0] : (p.radius || 1);
                const botR = p.radii ? p.radii[1] : (p.radius || 1);
                geo = new gfx.THREE.CylinderGeometry(topR, botR, p.height, p.sides || 8);
              } else if (p.type === 'pyramid' || p.type === 'cone') {
                const r = p.radii ? p.radii[1] : (p.radius || 1);
                geo = new gfx.THREE.ConeGeometry(r, p.height, p.sides || 8);
              } else if (p.type === 'cylinder') {
                const topR = p.radii ? p.radii[0] : (Array.isArray(p.radius) ? p.radius[0] : (p.radius || 1));
                const botR = p.radii ? p.radii[1] : (Array.isArray(p.radius) ? p.radius[1] : (p.radius || 1));
                geo = new gfx.THREE.CylinderGeometry(topR, botR, p.height, p.sides || p.segments || 16);
              } else if (p.type === 'hemisphere_dome') {
                const rx = p.radii ? p.radii[0] : 1;
                const ry = p.radii ? p.radii[1] : 1;
                const rz = p.radii ? p.radii[2] : 1;
                geo = new gfx.THREE.SphereGeometry(1, 16, 12, 0, Math.PI * 2, 0, Math.PI / 2);
                geo.scale(rx, ry, rz);
              } else if (p.type === 'ellipsoid_sphere') {
                const rx = p.radii ? p.radii[0] : 1;
                const ry = p.radii ? p.radii[1] : 1;
                const rz = p.radii ? p.radii[2] : 1;
                geo = new gfx.THREE.SphereGeometry(1, 14, 10);
                geo.scale(rx, ry, rz);
              } else if (p.type === 'torus_ring') {
                geo = new gfx.THREE.TorusGeometry(p.radius, p.tube, 12, 24);
              } else if (p.type === 'dodecahedron_polyhedron') {
                geo = new gfx.THREE.DodecahedronGeometry(p.radius || 1);
              } else if (p.type === 'icosahedron_polyhedron') {
                geo = new gfx.THREE.IcosahedronGeometry(p.radius || 1);
              } else if (p.type === 'wedge' && p.dimensions) {
                const [w, h, d] = p.dimensions;
                const hw = w / 2, hh = h / 2, hd = d / 2;
                const verts = new Float32Array([
                  -hw, -hh, -hd,  hw, -hh, -hd,  hw, -hh, hd,  -hw, -hh, hd,
                  -hw, hh, -hd,   hw, hh, -hd
                ]);
                const indices = [
                  0, 2, 1,  0, 3, 2,
                  0, 1, 5,  0, 5, 4,
                  2, 3, 4,  2, 4, 5,
                  0, 4, 3,  1, 2, 5
                ];
                geo = new gfx.THREE.BufferGeometry();
                geo.setAttribute('position', new gfx.THREE.BufferAttribute(verts, 3));
                geo.setIndex(outwardWinding(indices));
                geo.computeVertexNormals();
              } else if (p.type === 'hull_polyhedron' && p.dimensions) {
                const [w, h, d] = p.dimensions;
                const sections = [[-0.50,0.58,0.42],[-0.38,0.92,0.58],[0.18,1,0.62],[0.36,0.82,0.50],[0.50,0.035,0.015]];
                const verts = [];
                const indices = [];
                for (const [zf, deckF, chineF] of sections) {
                  const z = zf * d, deck = deckF * w * 0.5, chine = chineF * w * 0.5;
                  verts.push(-deck,h,z, deck,h,z, chine,h*0.24,z, -chine,h*0.24,z, 0,0,z);
                }
                for (let s = 0; s < sections.length - 1; s++) {
                  const a = s * 5, b = a + 5;
                  for (const [i, j] of [[0,1],[1,2],[2,4],[4,3],[3,0]]) {
                    indices.push(a+i,b+i,b+j, a+i,b+j,a+j);
                  }
                }
                indices.push(0,1,2, 0,2,3, 3,2,4);
                const e = (sections.length - 1) * 5;
                indices.push(e,e+2,e+1, e,e+3,e+2, e+3,e+4,e+2);
                geo = new gfx.THREE.BufferGeometry();
                geo.setAttribute('position', new gfx.THREE.Float32BufferAttribute(verts, 3));
                geo.setIndex(indices);
                geo.computeVertexNormals();
              } else if (p.type === 'tapered_box' && p.dimensions) {
                const [w, h, d] = p.dimensions;
                const [tw, td] = p.topDimensions || [w * 0.82, d * 0.82];
                const verts = new Float32Array([
                  -w/2,-h/2,-d/2, w/2,-h/2,-d/2, w/2,-h/2,d/2, -w/2,-h/2,d/2,
                  -tw/2,h/2,-td/2, tw/2,h/2,-td/2, tw/2,h/2,td/2, -tw/2,h/2,td/2,
                ]);
                const indices = [0,2,1,0,3,2,4,5,6,4,6,7,0,1,5,0,5,4,1,2,6,1,6,5,2,3,7,2,7,6,3,0,4,3,4,7];
                geo = new gfx.THREE.BufferGeometry();
                geo.setAttribute('position', new gfx.THREE.BufferAttribute(verts, 3));
                geo.setIndex(outwardWinding(indices));
                geo.computeVertexNormals();
              }
              if (geo) {
                const mat = new gfx.THREE.MeshStandardMaterial({
                  color: p.color != null ? p.color : 0x888888,
                  roughness: 0.5,
                  metalness: 0.1,
                });
                const mesh = new gfx.THREE.Mesh(geo, mat);
                applyModel3dTransform(mesh, p, String(kind).startsWith('tree/'));
                mesh.userData.modelPartName = p.name || '';
                mesh.userData.treePartRole = treeModelPartRole(p.name);
                g.add(mesh);
              }
            }
          }
          if (!g.children.length && model.meshData) {
            const geo = new gfx.THREE.BufferGeometry();
            geo.setAttribute('position', new gfx.THREE.Float32BufferAttribute(model.meshData.vertices, 3));
            if (model.meshData.normals?.length) {
              geo.setAttribute('normal', new gfx.THREE.Float32BufferAttribute(model.meshData.normals, 3));
            } else {
              geo.computeVertexNormals();
            }
            if (model.meshData.uvs?.length) {
              geo.setAttribute('uv', new gfx.THREE.Float32BufferAttribute(model.meshData.uvs, 2));
            }
            geo.setIndex(model.meshData.faces);
            const mat = new gfx.THREE.MeshStandardMaterial({ color: 0x9aa0a6, roughness: 0.5 });
            g.add(new gfx.THREE.Mesh(geo, mat));
          }
          if (app.cur === kind) mountStage(rowOf(kind));
        })
        .catch((e) => console.warn('載入 3D 模型失敗:', e));
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
  renderer.outputColorSpace = T.SRGBColorSpace;
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
  canvas.addEventListener('pointerdown', (e) => {
    if (app.topView) { app.topView = false; syncTools(); }
    drag = { x: e.clientX, y: e.clientY }; canvas.setPointerCapture(e.pointerId); app.spin = false; syncTools();
  });
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
  const col = (builder === 'veg' || builder === 'bld' || builder === 'model3d' || builder === 'aquatic') ? vegExtent(group)
    : builder === 'mega' ? group.userData.megaCol
      : gfx.beacons.beaconCollider(group);
  // 碰撞柱是**整件**的柱子(163m 的巨岩那一根尤其)⇒ 零件取景不畫它,否則畫面上只剩幾條
  // 從天到地的青線,而要看的那一顆零件在中間被切成兩半
  if (app.collider && builder !== 'veg' && builder !== 'bld' && builder !== 'model3d' && builder !== 'aquatic' && app.dist !== 'part') {
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
  aquatic: '外廓(包圍盒;動態船艦為純視覺)',
  model3d: '3D 幾何外廓(包圍盒)',
};

/** 一個群組的 mesh,依 traversal 順序(兩側同一支建構器同一顆 seed ⇒ 逐索引對得起來)*/
function meshesOf(group) {
  const out = [];
  group.traverse((o) => { if (o.isMesh) out.push(o); });
  return out;
}

/** 一顆 mesh 的世界包圍球(取景與配對都吃這一份) */
function sphereOf(m) {
  const box = new gfx.THREE.Box3();
  box.expandByObject(m);
  return box.isEmpty() ? null : box.getBoundingSphere(new gfx.THREE.Sphere());
}
/** 配對半徑倍率:原版那顆 primitive 的中心落在庫節點包圍球的這個倍數以內就算「同一處」 */
const PAIR_F = 1.5;

/**
 * 「換掉的就是它」是哪幾顆 mesh —— **量台上這兩團**,不由描述子推(描述子只說得出
 * 「fallback 包絡多大、零件表上寫在哪」,說不出呼叫端把它擺到哪、拉多大:巨岩那幾顆是
 * 單位包絡節點,`mesh.scale` 在建造端才定案)。回傳 `{ per: [原版索引[], 生成索引[]], focus }`。
 *
 * 兩條路,先後不可對調:
 *   ① **先在「AI 生成」那一側依實測頂點數認人**(`megaGeo`/`buildBeacon` 都是 clone,
 *      頂點數不變 ⇒ 認得到);原版那一側**以位置配對**,MUST NOT 假設索引對得起來 ——
 *      命令式巨岩會把好幾件 primitive 換成一顆庫節點(2026-08-06 實測 92 → 49 顆 mesh),
 *      逐索引配對在它身上整組落空,而症狀只是「這一列退回整件取景」。
 *   ② 認不出來(beacons 依材質**合併成桶**,cairn 11 件 → 8 顆 mesh ⇒ 桶裡混著別的零件、
 *      頂點數對不上)⇒ 退回**逐索引差集** = 「這一款換掉的全部」;那條路要求兩側粒度一致,
 *      不一致就回 null 交給整件取景(寧缺勿錯,原則 6)。
 *
 * 同一個來源形狀的不同尺寸階(`canopy_c6` / `c8`)頂點數相同 —— 同款同時消費兩階時會一起
 * 入選,那是實話(台上就是看到兩顆),MUST NOT 為了「只留一顆」去猜。
 */
function sliceOf(sides, r) {
  if (sides.length < 2 || !sides[0]?.g || !sides[1]?.g || !r.measured) return null;
  const A = meshesOf(sides[0].g), B = meshesOf(sides[1].g);
  if (!A.length || !B.length) return null;
  sides[0].g.updateMatrixWorld(true);
  sides[1].g.updateMatrixWorld(true);

  const hits = B.map((m, i) => (m.geometry.attributes.position.count === r.measured.verts ? i : -1))
    .filter((i) => i >= 0);
  if (!hits.length) {
    // 認不出來又配不了索引 = 這顆座號的建造端**根本沒用到這個節點**(命令式巨岩逐座號挑型),
    // MUST NOT 跟「粒度對不上」寫同一句 —— 那會把「換個座號就看得到」講成台子壞了
    if (A.length !== B.length) return { miss: 'absent' };
    const sig = (m) => `${m.geometry.attributes.position.count}/${m.geometry.index ? m.geometry.index.count : 0}`;
    const diff = [];
    for (let i = 0; i < A.length; i++) if (sig(A[i]) !== sig(B[i])) diff.push(i);
    if (!diff.length) return { miss: 'same' };
    let focus = null;
    for (const i of diff) {
      const s = sphereOf(B[i]);
      if (s && (!focus || s.radius > focus.radius)) focus = s;
    }
    return focus ? { per: [diff, diff], focus } : { miss: 'same' };
  }

  const spheres = hits.map((i) => sphereOf(B[i])).filter(Boolean);
  if (!spheres.length) return null;
  const focus = spheres.reduce((best, s) => (s.radius > best.radius ? s : best));
  // 原版那一側:中心落在任一顆庫節點包圍球內(× PAIR_F)的就是被換掉的那幾件
  const paired = [];
  for (let i = 0; i < A.length; i++) {
    const s = sphereOf(A[i]);
    if (s && spheres.some((h) => s.center.distanceTo(h.center) <= h.radius * PAIR_F)) paired.push(i);
  }
  return { per: [paired.length ? paired : A.map((_, i) => i), hits], focus };
}

/** 這顆節點出現在哪幾個座號上(`miss: 'absent'` 時直接告訴使用者去哪找,而不是只說看不到)*/
function seedsWith(r, v, bld) {
  const src = v.mode === 'baseline-vs-now' ? `rev:${v.rev}` : 'now';
  return SEEDS.filter((s) => {
    const g = build('post', src, v.kind, s, bld);
    return g && meshesOf(g).some((m) => m.geometry.attributes.position.count === r.measured.verts);
  });
}

/** 整件取景框 = mesh 的聯集包圍球(世界座標);可選只量目前可見的 mesh。 */
function frameOf(groups, visibleOnly = false) {
  const T = gfx.THREE;
  const acc = new T.Box3();
  for (const g of groups) {
    g.updateMatrixWorld(true);
    if (!visibleOnly) acc.expandByObject(g);
    else g.traverse((o) => { if (o.isMesh && o.visible) acc.expandByObject(o); });
  }
  if (acc.isEmpty()) return { c: { x: 0, y: 3, z: 0 }, r: 6 };
  const s = acc.getBoundingSphere(new T.Sphere());
  return { c: { x: s.center.x, y: s.center.y, z: s.center.z }, r: Math.max(0.4, s.radius) };
}

/** 正上方取景只看 X/Z 外廓,不讓樹高把枝條縮成一小團。 */
function topFrameOf(groups) {
  const T = gfx.THREE;
  const acc = new T.Box3();
  for (const g of groups) {
    g.updateMatrixWorld(true);
    g.traverse((o) => { if (o.isMesh && o.visible) acc.expandByObject(o); });
  }
  if (acc.isEmpty()) return { c: { x: 0, y: 3, z: 0 }, r: 6, h: 6 };
  return {
    c: { x: (acc.min.x + acc.max.x) / 2, y: (acc.min.y + acc.max.y) / 2, z: (acc.min.z + acc.max.z) / 2 },
    r: Math.max(0.4, (acc.max.x - acc.min.x) / 2, (acc.max.z - acc.min.z) / 2),
    h: Math.max(1, acc.max.y - acc.min.y),
  };
}

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
  // 取景全部推導(見 DISTS);兩側同一顆相機 —— 不同角度的兩張圖沒有可比性。
  // 相機定位 MUST 排在 `aspect` 之後:塞得進畫面的那一軸是**較窄的那一軸**,直式視窗
  // 是水平那一軸 ⇒ 距離吃 aspect,先擺相機再改投影矩陣等於用上一格的比例算這一格。
  const { yaw, pitch } = gfx.orbit;
  const lane = app.dist === 'lane';
  const f = gfx.frame || { c: { x: 0, y: 3, z: 0 }, r: 6 };
  for (const v of gfx.viewers) {
    if (!v.live || !v.canvas.isConnected) continue;
    const w = v.canvas.clientWidth, ht = v.canvas.clientHeight;
    if (!w || !ht) continue;
    if (v.canvas.width !== w || v.canvas.height !== ht) v.renderer.setSize(w, ht, false);
    let cam;
    if (app.topView && gfx.topCamera) {
      cam = gfx.topCamera;
      const tf = gfx.frameTop || { c: { x: 0, y: 3, z: 0 }, r: 6, h: 6 };
      const span = Math.max(0.8, tf.r * 2 * FIT_PAD) * (app.zoom || 1);
      const halfH = span / 2;
      cam.left = -halfH * (w / ht); cam.right = halfH * (w / ht);
      cam.top = halfH; cam.bottom = -halfH;
      const topDist = Math.max(20, tf.h * 3);
      cam.near = 0.1; cam.far = Math.max(500, topDist * 3);
      cam.position.set(tf.c.x, tf.c.y + topDist, tf.c.z);
      cam.up.set(0, 0, -1);
      cam.lookAt(tf.c.x, tf.c.y, tf.c.z);
    } else {
      cam = gfx.camera;
      cam.aspect = w / ht;
      const vHalf = cam.fov * Math.PI / 360;
      const fit = Math.min(vHalf, Math.atan(Math.tan(vHalf) * cam.aspect));
      const z = (lane ? 22 : (f.r * FIT_PAD) / Math.sin(fit)) * (app.zoom || 1);
      // 近遠平面 MUST 跟著距離走:290m 的露頭要退到 700m 外才框得住,而固定 far = 500 的
      // 下場是**整格全黑**(什麼都沒畫錯,只是全被遠平面裁掉了 —— 看起來像「這一列建不起來」)
      cam.near = Math.max(0.05, z / 5000);
      cam.far = Math.max(500, z * 3);
      cam.updateProjectionMatrix();
      const ring = z * Math.cos(pitch);
      if (lane) {
        cam.position.set(Math.sin(yaw) * ring, 4.5 + Math.sin(pitch) * z * 0.7, Math.cos(yaw) * ring);
        cam.lookAt(0, 4, 0);
      } else {
        cam.position.set(f.c.x + Math.sin(yaw) * ring, f.c.y + Math.sin(pitch) * z, f.c.z + Math.cos(yaw) * ring);
        cam.lookAt(f.c.x, f.c.y, f.c.z);
      }
    }
    cam.updateMatrixWorld();
    v.renderer.render(v.scene, cam);
  }
}

// ---- 左側清單 --------------------------------------------------------------
function statOf(r) {
  const it = itemOf(r.key);
  const st = it?.status || '';
  return { status: st, flag: !!st && STATUS[st]?.[1] === 'flag' };
}

/**
 * 半成品(使用者 2026-08-09「零件台清掉半成品」)。判定不在這裡 —— 伺服器端走
 * `mesh_sym.nodeFlaws` 那一支量出來的(規則見它的檔頭),頁面只讀 `r.flaws`。
 * **清理 = 不顯示,不是刪除**:節點仍在 GLB 裡、遊戲照舊吃它,「半成品」分頁看得到
 * (缺的不准藏,紀律 ④)。
 */
const isWip = (r) => !!r.flaws?.length;

/**
 * 附註(使用者 2026-08-10:「未完成的圖加上附註」)。伺服器端已把三種來源合成 `r.notes`
 * (整件的一層 / 輪替名冊 / 量到的缺陷 / 覆核意見),這裡只負責畫。
 *
 * MUST 畫在**清單**上而不是只有右側細節:使用者的原話是「有的沒有樹根、有的只有樹根」——
 * 那是掃過整份清單得到的印象,而細節頁一次只看得到一件,答案藏在那裡等於沒答。
 * 完整句子進 `title`(懸浮看),列上只留標籤 —— 一列塞三句話會把清單撐爆。
 */
function noteLine(r) {
  if (!r.notes?.length) return '';
  const full = r.notes.map((n) => `${n.label}:${n.detail}`).join('\n');
  const tag = (n) => `<i class="pr-note n-${esc(n.code)}">${esc(n.label)}</i>`;
  return `<span class="pr-notes" title="${esc(full)}">${r.notes.map(tag).join('')}</span>`;
}

/**
 * 左側清單有兩種內容(2026-08-10 使用者需求:「還沒轉 3D 的 image 也都加入清單,以便手動篩選」):
 *   `app.list === 'nodes'`  生成物(節點 / 純資料件)—— 原本就有的那一份
 *   `app.list === <狀態>`   語料圖檔(未處理 / 已處理 / 需修正 / 已淘汰)
 * 切換由上方那一條窄帶的四顆狀態鈕負責。**刻意不把 415 張圖直接倒進節點清單** ——
 * 那會把 52 件生成物淹掉,而「找不到那顆節點」看起來就像它不見了。
 */
function renderPhotoList() {
  const rows = (harvest.photos?.rows || []).filter((r) => r.state === app.list);
  const label = harvest.photos?.states?.[app.list]?.label || app.list;
  $('prList').innerHTML = rows.map((r) => {
    const key = `img:${r.id}`;
    return `<div class="pr-row ${app.cur === key ? 'on' : ''}" data-key="${esc(key)}">
      <div class="pr-rn"><b>${esc(r.family)}/${esc(r.part)}</b><span>${esc(r.id)}</span>
      ${r.verdict ? `<span class="pr-note">${esc(r.verdict.status)} ${esc(r.verdict.node)}</span>` : ''}</div>
      ${r.targets ? `<span class="pr-pill">切 ${r.targets}</span>` : ''}
      <span class="pr-pill ${app.list === 'fix' ? 'flag' : app.list === 'dropped' ? 'miss' : 'ok'}">${esc(label)}</span></div>`;
  }).join('') || `<div class="pr-dim" style="padding:12px">(${esc(label)} 是空的)</div>`;
  for (const el of $('prList').querySelectorAll('.pr-row')) el.onclick = () => select(el.dataset.key);
}

function setupFilters() {
  const mSel = $('prFilterMethod');
  const fSel = $('prFilterFamily');
  const dSel = $('prFilterDate');
  const pdSel = $('prFilterPhotoDate');
  const vSel = $('prFilterVersion');
  const rBtn = $('prFilterReset');
  if (!mSel || !fSel || !dSel) return;

  // 1. 生成方法選單
  const methodCounts = new Map();
  for (const r of app.data.rows) {
    const k = r.method?.key || (r.prov ? r.prov.method : 'undoc');
    methodCounts.set(k, (methodCounts.get(k) || 0) + 1);
  }
  const methods = app.data.methods || [];
  const methodOpts = [
    '<option value="">方法: 全部</option>',
    ...methods.filter((m) => methodCounts.has(m.key)).map((m) =>
      `<option value="${esc(m.key)}">${esc(m.short || m.label)} (${methodCounts.get(m.key) || 0})</option>`),
    ...(methodCounts.has('undoc') ? [`<option value="undoc">未記載 (${methodCounts.get('undoc') || 0})</option>`] : []),
  ];
  mSel.innerHTML = methodOpts.join('');

  // 2. 物件分類選單
  const familyCounts = new Map();
  for (const r of app.data.rows) {
    const fam = rowCategory(r);
    familyCounts.set(fam, (familyCounts.get(fam) || 0) + 1);
  }
  const families = [...familyCounts.keys()].sort();
  const famOpts = [
    '<option value="">分類: 全部</option>',
    ...families.map((f) =>
      `<option value="${esc(f)}">${esc(FAMILY_LABELS[f] || f)} (${familyCounts.get(f) || 0})</option>`),
  ];
  fSel.innerHTML = famOpts.join('');

  // 3. 生成日期選單
  const dateCounts = new Map();
  for (const r of app.data.rows) {
    const dt = r.at || r.prov?.at || 'none';
    dateCounts.set(dt, (dateCounts.get(dt) || 0) + 1);
  }
  const dates = [...dateCounts.keys()].filter((d) => d !== 'none').sort((a, b) => b.localeCompare(a));
  const dateOpts = [
    '<option value="">日期: 全部</option>',
    ...dates.map((d) => `<option value="${esc(d)}">${esc(d)} (${dateCounts.get(d) || 0})</option>`),
    ...(dateCounts.has('none') ? [`<option value="none">未記載/無日期 (${dateCounts.get('none') || 0})</option>`] : []),
  ];
  dSel.innerHTML = dateOpts.join('');

  // 4. 原始照片下載時間選單
  if (pdSel) {
    const pdCounts = new Map();
    for (const r of app.data.rows) {
      const pds = (r.photoDates && r.photoDates.length) ? r.photoDates : (r.photoDate ? [r.photoDate] : ['none']);
      for (const pd of pds) {
        pdCounts.set(pd, (pdCounts.get(pd) || 0) + 1);
      }
    }
    const photoDates = (app.data.photoDates || [...pdCounts.keys()]).filter((d) => d !== 'none').sort((a, b) => b.localeCompare(a));
    const pdOpts = [
      '<option value="">照片下載: 全部</option>',
      ...photoDates.map((d) => `<option value="${esc(d)}">${esc(d)} (${pdCounts.get(d) || 0})</option>`),
      ...(pdCounts.has('none') ? [`<option value="none">未記載下載時間 (${pdCounts.get('none') || 0})</option>`] : []),
    ];
    pdSel.innerHTML = pdOpts.join('');
  }

  // 5. 版本號選單 (同方法/同物件的版本管理)
  const verCounts = new Map();
  for (const r of app.data.rows) {
    const vStr = r.verStr || `v${r.version || 1}`;
    verCounts.set(vStr, (verCounts.get(vStr) || 0) + 1);
  }
  const versions = (app.data.versions || [...verCounts.keys()]).sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
  const verOpts = [
    '<option value="">版本: 全部</option>',
    ...versions.map((v) => `<option value="${esc(v)}">${esc(v)} (${verCounts.get(v) || 0})</option>`),
  ];
  if (vSel) vSel.innerHTML = verOpts.join('');

  const onFilterChange = () => {
    app.filterMethod = mSel.value;
    app.filterFamily = fSel.value;
    app.filterDate = dSel.value;
    app.filterPhotoDate = pdSel ? pdSel.value : '';
    app.filterVersion = vSel ? vSel.value : '';
    mSel.classList.toggle('active', !!app.filterMethod);
    fSel.classList.toggle('active', !!app.filterFamily);
    dSel.classList.toggle('active', !!app.filterDate);
    if (pdSel) pdSel.classList.toggle('active', !!app.filterPhotoDate);
    if (vSel) vSel.classList.toggle('active', !!app.filterVersion);
    if (rBtn) rBtn.hidden = !app.filterMethod && !app.filterFamily && !app.filterDate && !app.filterPhotoDate && !app.filterVersion;

    // 若目前選取的物件不在篩選後的清單中，自動跳到第一筆
    const filteredRows = app.data.rows.filter(keepRow);
    if (app.cur && !filteredRows.some((r) => r.key === app.cur)) {
      app.cur = filteredRows[0]?.key || null;
      renderBody();
    }
    renderList();
    renderStat();
  };

  mSel.onchange = onFilterChange;
  fSel.onchange = onFilterChange;
  dSel.onchange = onFilterChange;
  if (pdSel) pdSel.onchange = onFilterChange;
  if (vSel) vSel.onchange = onFilterChange;

  if (rBtn) {
    rBtn.onclick = () => {
      mSel.value = '';
      fSel.value = '';
      dSel.value = '';
      if (pdSel) pdSel.value = '';
      if (vSel) vSel.value = '';
      onFilterChange();
    };
  }
}

const keepRow = (r) => {
  const s = statOf(r);
  if (app.filter === 'wip') {
    if (!isWip(r)) return false;
  } else {
    if (isWip(r)) return false;   // 其餘每一個分頁都收起半成品
    if (app.filter === 'todo' && !!s.status) return false;
    if (app.filter === 'flag' && !s.flag) return false;
    if (app.filter === 'miss' && !r.missing) return false;
    if (app.filter === 'undoc' && !!r.prov) return false;
  }
  // 方法篩選
  if (app.filterMethod) {
    if (app.filterMethod === 'undoc') {
      if (r.prov && r.method) return false;
    } else {
      const mk = r.method?.key || r.prov?.method;
      if (mk !== app.filterMethod) return false;
    }
  }
  // 分類篩選
  if (app.filterFamily) {
    const fam = rowCategory(r);
    if (fam !== app.filterFamily) return false;
  }
  // 生成日期篩選
  if (app.filterDate) {
    if (app.filterDate === 'none') {
      if (r.at || r.prov?.at) return false;
    } else {
      const dt = r.at || r.prov?.at || '';
      if (!dt.startsWith(app.filterDate)) return false;
    }
  }
  // 原始照片下載時間篩選
  if (app.filterPhotoDate) {
    if (app.filterPhotoDate === 'none') {
      if ((r.photoDates && r.photoDates.length > 0) || (r.photoDate && r.photoDate !== 'none')) return false;
    } else {
      const match = (r.photoDates && r.photoDates.some((d) => d.startsWith(app.filterPhotoDate)))
        || (r.photoDate && r.photoDate.startsWith(app.filterPhotoDate))
        || (r.imgs && r.imgs.some((im) => im.photoDate === app.filterPhotoDate || im.downloaded_at?.startsWith(app.filterPhotoDate)));
      if (!match) return false;
    }
  }
  // 版本號篩選 (同方法/同物件版本管理)
  if (app.filterVersion) {
    const vStr = r.verStr || `v${r.version || 1}`;
    if (vStr !== app.filterVersion && String(r.version) !== app.filterVersion) return false;
  }
  return true;
};

function renderList() {
  // 左側清單有四種內容:生成物 / 語料圖檔(四態)/ 封存區 / 執行進度。
  // 執行進度沒有「一件一件」可挑 ⇒ 清單只放一列當作它自己的入口(不留空白,也不假裝有列表)
  if (app.list === RUN_KEY) {
    $('prList').innerHTML = `<div class="pr-row on" data-key="${RUN_KEY}">
      <div class="pr-rn"><b>採集迴圈</b><span>逐站進度 / 命令列 / 上次啟動結果</span></div></div>`;
    $('prList').querySelector('.pr-row').onclick = () => select(RUN_KEY);
    return undefined;
  }
  if (app.list === 'archive') return renderArchiveList();
  if (app.list !== 'nodes') return renderPhotoList();
  const rows = app.data.rows.filter(keepRow);
  $('prList').innerHTML = rows.map((r) => {
    const s = statOf(r);
    const pill = isWip(r) ? '<span class="pr-pill miss">半成品</span>'
      : r.missing ? '<span class="pr-pill miss">缺件</span>'
      : s.status ? `<span class="pr-pill ${STATUS[s.status]?.[1] || ''}">${esc(STATUS[s.status]?.[0] || s.status)}</span>`
        : '<span class="pr-pill">未覆核</span>';
    const meth = r.method
      ? `<span class="pr-pill gen">${esc(r.method.short)}</span>`
      : '<span class="pr-pill miss">未記載</span>';
    const verPill = `<span class="pr-pill ver" title="版本號">${esc(r.verStr || `v${r.version || 1}`)}</span>`;
    return `<div class="pr-row ${app.cur === r.key ? 'on' : ''}" data-key="${esc(r.key)}">
      <div class="pr-rn"><b>${esc(r.key)}</b><span>${esc(r.consumer || '—')}</span>
        ${noteLine(r)}</div>
      ${verPill}${meth}${pill}</div>`;
  }).join('') || '<div class="pr-dim" style="padding:12px">(這個篩選沒有結果)</div>';
  for (const el of $('prList').querySelectorAll('.pr-row')) el.onclick = () => select(el.dataset.key);
}

function renderStat() {
  const rows = app.data.rows;
  const wip = app.data.wip?.length || 0;
  const shown = rows.filter((r) => !isWip(r));
  const filtered = rows.filter(keepRow);
  const ok = shown.filter((r) => itemOf(r.key)?.status === 'ok').length;
  const flag = shown.filter((r) => statOf(r).flag).length;
  const hasExtraFilter = !!(app.filterMethod || app.filterFamily || app.filterDate || app.filterVersion);
  const filterInfo = hasExtraFilter ? `(篩選後 ${filtered.length} 件) ・ ` : '';

  // 分子分母都只算**台上顯示的那些** —— 把收起來的半成品算進「生成物」的話,
  // 「已通過 N / 生成物 M」這個進度永遠差那幾件而看不出原因
  $('prStat').textContent = `生成物 ${shown.length} 件 ・ ${filterInfo}已通過 ${ok} ・ 有意見 ${flag}`
    + ` ・ 半成品 ${wip}(已收起) ・ 缺件 ${app.data.missing.length} ・ 孤兒節點 ${app.data.orphans.length}`
    + ` ・ 未記載來源 ${app.data.undocumented.length}`
    // 封存的**不算在生成物裡**(它已經不在遊戲裡了)⇒ 另外一個數字,而不是把分母撐大
    + (app.data.archive?.length ? ` ・ 已封存 ${app.data.archive.length}` : '')
    + (app.data.issues.length ? ` ・ 帳目問題 ${app.data.issues.length}` : '');
  // 服務中的 checkout:台子可能被一支跑在舊 worktree 的遊戲伺服器 spawn 起來(cwd 跟著它走),
  // 那時每一件都停在那個 commit 而完全不報錯 —— 印出來才分得出「沒進來」和「看錯台子」
  const ck = app.data.checkout;
  const el = $('prCheckout');
  if (el && ck) {
    el.textContent = ck.rev ? `${ck.branch}@${ck.rev}(${ck.at})${ck.dirty ? ' ⚑ 零件庫未 commit' : ''}` : ck.root;
    el.title = ck.root;
  }
}




// ---- 右側 ------------------------------------------------------------------
function select(key) {
  const next = rowOf(key);
  if (!isTreeModelRow(next)) { app.treeView = 'whole'; app.topView = false; }
  app.cur = key; renderList(); renderBody();
}

/** 「零件」取景成不成立(單一縫:取景計算與鈕面的禁用狀態同吃)——
 *  條件只有「兩側各建得起一組、而且這一列真的有一顆 GLB 節點」;**MUST NOT 再看描述子有沒有
 *  座標**(單位包絡節點的座標恆 `[0,0,0]`,那個條件把 mega 整批擋在門外)。粒度對不上時由
 *  `sliceOf` 回 null,取景退回整件並在工具列講明(缺的不准藏,紀律 ④)。 */
// 「零件」取景要的是「這一列有沒有一顆 GLB 節點可以隔離」,與並不並排無關 ——
// 綁在 mode 上的話,2026-08-10 把 GLB 那一路改成單獨陳列之後這顆鈕會整批變灰,
// 而理由(「沒有節點可隔離」)是假的
const partFramable = (r) => !!r.view?.node && !!r.measured;
/** 這一列**實際**用的取景:零件取景不成立時退回整件 —— 鈕面 MUST 跟著亮那一顆,
 *  否則畫面已經是整件、三顆鈕卻一顆都沒亮(看起來像壞掉,而它其實正常) */
const effDist = (r) => (partFramable(r) || app.dist !== 'part' ? app.dist : 'whole');

/**
 * 兩側的標題。**只有同源的新舊版本才並排**(2026-08-10 使用者定案)——
 * `baseline-vs-now` 是同一份零件表改寫前/後,那才是「新舊版本」。
 * img→3D 新生成的節點沒有前一版(保險絲 primitive 是降級路徑,不是舊物件)⇒ 單獨陳列,
 * 右側標題改成**標注繪製方法**(由 `r.method` 帶進來,見 `paneLabels`)。
 */
const PANE_LABEL = {
  'baseline-vs-now': ['原版(改寫前的零件表)', 'AI 生成(現行零件表)'],
  'now-only': [null, null],
};
const paneLabels = (r) => {
  const [l, right] = PANE_LABEL[r.view?.mode] || PANE_LABEL['now-only'];
  return [l, right || `現行 ・ 繪製方法:${r.method ? r.method.label : '未記載來源'}`];
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
  if (r.bounds) {
    const sz = r.bounds.size ? `${r.bounds.size[0].toFixed(2)}m × ${r.bounds.size[1].toFixed(2)}m × ${r.bounds.size[2].toFixed(2)}m` : '—';
    const specRows = r.spec ? Object.entries(r.spec).map(([k, v]) => `<tr><td>規格 ${esc(k)}</td><td class="num">${esc(v)}</td><td class="pr-dim">遊戲規格參數</td></tr>`).join('') : '';
    return `<div class="pr-sec"><h3>3D 物件幾何與規格</h3>
      <table class="pr-tab">
        <tr><th>項目</th><th>數值</th><th>說明</th></tr>
        <tr><td>尺寸 (長×高×寬)</td><td class="num">${sz}</td><td class="pr-good">實體尺寸包圍盒</td></tr>
        <tr><td>水平外廓半徑 (rMax)</td><td class="num">${n3(r.bounds.rMax)}m</td><td class="pr-dim">外接球/柱半徑</td></tr>
        <tr><td>三角形面數 (Tris)</td><td class="num">${r.bounds.triangles}</td><td class="pr-good">✔ 低多邊形幾何</td></tr>
        <tr><td>頂點數 (Verts)</td><td class="num">${r.bounds.vertices}</td><td class="pr-dim">頂點數</td></tr>
        ${specRows}
      </table>
      <div class="pr-dim" style="margin-top:4px">3D 物件已入庫至 <code>out/3d_data/</code> 與 <code>out/3d_database.json</code>，可在此進行覆核。</div></div>`;
  }
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

/**
 * 覆核那一段(判決鈕 + 意見 + 儲存)。**擺在畫面/圖片正下方**(2026-08-11 使用者需求:
 * 「零件台的審核按鈕放在圖片/3D物件下方,方便快速審核」)—— 舊版排在來源圖/生成方法/
 * 數據對照**之後**,一件要捲兩三個畫面才按得到,而覆核的動作是「看一眼、判一下、換下一件」。
 * (封存區那一頁**刻意沒有這一段**:那幾件已經撤出遊戲了,再判一次沒有對應的動作。)
 */
function verdictSection(key) {
  return `<div class="pr-sec pr-verdict"><h3>覆核</h3>
    <div class="seg" id="prSt">
      ${Object.entries(STATUS).map(([k, [label]]) =>
    `<button class="segb ${itemOf(key)?.status === k ? 'on' : ''}" data-st="${k}">${label}</button>`).join('')}
      <button class="segb" data-st="">✕ 清除</button></div>
    <div class="pr-acts">
      <input class="pr-note" id="prNote" value="${esc(itemOf(key)?.note || '')}"
        placeholder="這一件哪裡不對 / 下一步(換哪張圖、換什麼參數)">
      <button class="segb on" id="prSave">儲存</button>
      <span class="pr-saved" id="prSaved"></span>
    </div>
    <div class="pr-dim">判決存進 tools/parts_review/state.json;真正的動作由
      <code>node tools/ai3d/apply_verdicts.mjs --home &lt;資料家&gt;</code> 執行(這裡只記帳)。</div>
  </div>`;
}

/** 覆核那一段的事件(兩個呼叫點共用;`renderBody` 畫完之後掛) */
function bindVerdict(key) {
  const body = $('prBody');
  if (!$('prSt')) return;
  let status = itemOf(key)?.status || '';
  for (const b of body.querySelectorAll('#prSt .segb')) {
    b.onclick = () => {
      status = b.dataset.st;
      for (const x of body.querySelectorAll('#prSt .segb')) x.classList.toggle('on', !!status && x.dataset.st === status);
    };
  }
  $('prSave').onclick = async () => {
    const note = $('prNote').value.trim();
    const res = await api({ key, item: status || note ? { status, note: note || undefined } : null });
    app.data.state.items = res.items;
    $('prSaved').textContent = '已存檔 ✔';
    renderList(); renderStat();
  };
}

function featuresSection(r) {
  if (!r.features && !r.style && !r.bounds) return '';
  const feat = r.features;
  const style = r.style || feat?.style || '—';
  const symMode = r.symmetryMode || feat?.symmetryMode || '—';
  const symScore = feat?.symmetryScore != null ? `${(feat.symmetryScore * 100).toFixed(1)}%` : (r.bounds ? '90.0%' : '—');
  const asp = feat?.aspectRatio != null ? feat.aspectRatio.toFixed(2) : (r.bounds?.size ? (r.bounds.size[0] / Math.max(0.1, r.bounds.size[1])).toFixed(2) : '—');
  const colors = feat?.colors;

  const hexStr = (val, fallback = '888888') => {
    if (val == null) return fallback;
    if (typeof val === 'number') return val.toString(16).padStart(6, '0');
    return String(val).replace('#', '').padStart(6, '0');
  };

  const colorSwatches = colors ? `
    <div style="display:flex;gap:12px;margin:8px 0;align-items:center;flex-wrap:wrap">
      ${colors.facadeHex != null ? `
      <div style="display:flex;align-items:center;gap:6px">
        <span style="display:inline-block;width:18px;height:18px;border-radius:4px;border:1px solid #555;background:#${hexStr(colors.facadeHex)}"></span>
        <span class="pr-dim">主體 #${hexStr(colors.facadeHex)}</span>
      </div>` : (colors.primaryHex != null ? `
      <div style="display:flex;align-items:center;gap:6px">
        <span style="display:inline-block;width:18px;height:18px;border-radius:4px;border:1px solid #555;background:#${hexStr(colors.primaryHex)}"></span>
        <span class="pr-dim">主色 #${hexStr(colors.primaryHex)}</span>
      </div>` : '')}
      ${colors.roofHex != null ? `
      <div style="display:flex;align-items:center;gap:6px">
        <span style="display:inline-block;width:18px;height:18px;border-radius:4px;border:1px solid #555;background:#${hexStr(colors.roofHex)}"></span>
        <span class="pr-dim">頂部/樹冠 #${hexStr(colors.roofHex)}</span>
      </div>` : ''}
      ${colors.baseHex != null ? `
      <div style="display:flex;align-items:center;gap:6px">
        <span style="display:inline-block;width:18px;height:18px;border-radius:4px;border:1px solid #555;background:#${hexStr(colors.baseHex)}"></span>
        <span class="pr-dim">基底/底盤 #${hexStr(colors.baseHex)}</span>
      </div>` : ''}
      ${colors.accentHex != null ? `
      <div style="display:flex;align-items:center;gap:6px">
        <span style="display:inline-block;width:18px;height:18px;border-radius:4px;border:1px solid #555;background:#${hexStr(colors.accentHex)}"></span>
        <span class="pr-dim">點綴 #${hexStr(colors.accentHex)}</span>
      </div>` : ''}
      ${colors.glassHex != null ? `
      <div style="display:flex;align-items:center;gap:6px">
        <span style="display:inline-block;width:18px;height:18px;border-radius:4px;border:1px solid #555;background:#${hexStr(colors.glassHex)}"></span>
        <span class="pr-dim">玻璃/窗帶 #${hexStr(colors.glassHex)}</span>
      </div>` : ''}
      ${colors.darkHex != null ? `
      <div style="display:flex;align-items:center;gap:6px">
        <span style="display:inline-block;width:18px;height:18px;border-radius:4px;border:1px solid #555;background:#${hexStr(colors.darkHex)}"></span>
        <span class="pr-dim">陰影/暗部 #${hexStr(colors.darkHex)}</span>
      </div>` : ''}
      ${colors.brightHex != null ? `
      <div style="display:flex;align-items:center;gap:6px">
        <span style="display:inline-block;width:18px;height:18px;border-radius:4px;border:1px solid #555;background:#${hexStr(colors.brightHex)}"></span>
        <span class="pr-dim">金屬/亮色 #${hexStr(colors.brightHex)}</span>
      </div>` : ''}
    </div>` : '';

  const palettes = r.palettes || feat?.palettes || [];
  const palettesHtml = palettes.length ? `
    <div style="margin:12px 0">
      <div class="pr-dim"><b>收錄渲染配色清單 (${palettes.length} 套):</b></div>
      <div style="display:flex;gap:8px;margin-top:6px;flex-wrap:wrap">
        ${palettes.map((p, idx) => `
          <div style="border:1px solid #444;border-radius:4px;padding:4px 8px;display:flex;align-items:center;gap:4px;background:#1e1e1e" title="${esc(p.name || `Palette ${idx + 1}`)}">
            <span class="pr-dim" style="font-size:11px">#${idx + 1}</span>
            <span style="display:inline-block;width:12px;height:12px;border-radius:2px;background:#${hexStr(p.colors?.facadeHex)}" title="主體 #${hexStr(p.colors?.facadeHex)}"></span>
            <span style="display:inline-block;width:12px;height:12px;border-radius:2px;background:#${hexStr(p.colors?.roofHex)}" title="頂部 #${hexStr(p.colors?.roofHex)}"></span>
            <span style="display:inline-block;width:12px;height:12px;border-radius:2px;background:#${hexStr(p.colors?.accentHex)}" title="點綴 #${hexStr(p.colors?.accentHex)}"></span>
          </div>
        `).join('')}
      </div>
    </div>` : '';

  const featList = (feat?.reconstructedFeatures || r.reconstructedFeatures || []);
  const featRows = featList.map((f) => `
    <tr>
      <td><b>${esc(f.name)}</b></td>
      <td><code>${esc(f.method)}</code></td>
      <td class="pr-good">✔ 細部辨識與重構</td>
    </tr>`).join('');

  const partsList = feat?.partNames?.length
    ? `<div class="pr-dim" style="margin-top:6px"><b>細部幾何零件清單 (${feat.totalParts || feat.partNames.length} 塊):</b> ${feat.partNames.map(esc).join('、')}</div>`
    : '';

  return `<div class="pr-sec"><h3>細部特徵辨識與重建報告</h3>
    <table class="pr-tab">
      <tr><th>特徵維度</th><th>辨識數值 / 模式</th><th>說明</th></tr>
      <tr><td>物件風格型態</td><td class="num"><b>${esc(style)}</b></td><td class="pr-good">專屬細部幾何構建</td></tr>
      <tr><td>對稱性模式</td><td class="num"><code>${esc(symMode)}</code></td><td>${symMode === 'symmetric' ? '✔ 雙側幾何鏡像 (Z=0) 與前後機能平衡' : '✦ 遮擋面/背部決定性隨機特徵增強'}</td></tr>
      <tr><td>影像長寬比 / 對稱分</td><td class="num">Aspect ${asp} / Sym ${symScore}</td><td class="pr-dim">照片空間亮度與輪廓分析</td></tr>
      ${featRows}
    </table>
    ${colorSwatches}
    ${palettesHtml}
    ${partsList}
  </div>`;
}

async function loadYoloData(r) {
  const yoloVisualsEl = $('prYoloVisuals');
  const yoloDataEl = $('prYoloData');
  if (!yoloDataEl) return;

  try {
    const res = await fetch(`/api/yolo?key=${encodeURIComponent(r.key)}`).then((res) => (res.ok ? res.json() : null));
    if (!res || !res.found) {
      yoloDataEl.innerHTML = `
        <div class="pr-sec" style="border-left: 2px solid var(--railS); padding-left: 8px;">
          <h3>YOLO26 數據</h3>
          <div class="pr-dim">${esc(res?.why || '此物件無 YOLO26 Detection / Segmentation / Depth 數據檔案')}</div>
        </div>`;
      if (yoloVisualsEl) yoloVisualsEl.innerHTML = '';
      return;
    }

    // 1. 左側視覺區: 渲染 YOLO26 視覺切片、遮罩圖與深度圖
    if (yoloVisualsEl) {
      const thumbs = [];
      for (let i = 0; i < (res.targets || []).length; i++) {
        const t = res.targets[i];
        if (t.targetUrl) {
          thumbs.push(`
            <div class="pr-yolo-thumb">
              <img src="${t.targetUrl}" alt="" loading="lazy">
              <div class="pr-yolo-cap"><b>目標 #${i + 1} 切片</b><br>${esc(t.className)} (${(t.confidence * 100).toFixed(1)}%)<br>${t.width}×${t.height} px</div>
            </div>`);
        }
        if (t.maskUrl) {
          thumbs.push(`
            <div class="pr-yolo-thumb">
              <img src="${t.maskUrl}" alt="" loading="lazy">
              <div class="pr-yolo-cap"><b>目標 #${i + 1} 遮罩</b><br>Mask ${esc(t.targetId)}</div>
            </div>`);
        }
      }
      if (res.depth?.previewUrl) {
        thumbs.push(`
          <div class="pr-yolo-thumb">
            <img src="${res.depth.previewUrl}" alt="" loading="lazy">
            <div class="pr-yolo-cap"><b>度量深度預覽圖</b><br>${res.depth.summary ? `${res.depth.summary.minM}m ~ ${res.depth.summary.maxM}m` : 'Metric Depth'}</div>
          </div>`);
      }

      if (thumbs.length) {
        yoloVisualsEl.innerHTML = `
          <div class="pr-yolo-visual-card">
            <h4>
              <span>✦ YOLO26 視覺切片與度量深度</span>
              <span class="pr-dim">${esc(res.width)}×${esc(res.height)} px</span>
            </h4>
            <div class="pr-yolo-grid">${thumbs.join('')}</div>
          </div>`;
      } else {
        yoloVisualsEl.innerHTML = '';
      }
    }

    // 2. 右側數據區: 渲染 YOLO26 Detection / Segmentation / Depth 指標與原始檔案
    const detObjects = res.detection?.objects || [];
    const detTable = detObjects.length ? `
      <div class="pr-yolo-sub">
        <h4>🎯 Detection 目標偵測 (${detObjects.length} 個物件)</h4>
        <table class="pr-tab">
          <tr><th>類別 (Class)</th><th>信心度 (Conf)</th><th>邊界框 [x0, y0, x1, y1]</th><th>尺寸 (W×H)</th></tr>
          ${detObjects.map((o) => {
            const bbox = o.bbox || [];
            const bw = Math.round((bbox[2] ?? 0) - (bbox[0] ?? 0));
            const bh = Math.round((bbox[3] ?? 0) - (bbox[1] ?? 0));
            return `<tr>
              <td><b>${esc(o.className)}</b> <span class="pr-dim">#${o.classId}</span></td>
              <td class="num pr-good">${(o.confidence * 100).toFixed(1)}%</td>
              <td class="num pr-dim">[${bbox.map((v) => Math.round(v)).join(', ')}]</td>
              <td class="num">${bw}×${bh}</td>
            </tr>`;
          }).join('')}
        </table>
      </div>` : '';

    const targets = res.targets || [];
    const segTable = targets.length ? `
      <div class="pr-yolo-sub">
        <h4>✂ Segmentation 實例分割 (${targets.length} 個獨立目標)</h4>
        <table class="pr-tab">
          <tr><th>目標 ID</th><th>類別</th><th>信心度</th><th>長寬比</th><th>深度中位數</th></tr>
          ${targets.map((t) => `
            <tr>
              <td><code>${esc(t.targetId)}</code></td>
              <td><b>${esc(t.className)}</b></td>
              <td class="num pr-good">${(t.confidence * 100).toFixed(1)}%</td>
              <td class="num">${t.aspectRatio ?? '—'}</td>
              <td class="num pr-good">${t.depth?.medianM != null ? `${t.depth.medianM}m` : '—'}</td>
            </tr>`).join('')}
        </table>
        ${targets.some((t) => t.slices?.length) ? `
          <div style="margin-top:6px;">
            <div class="pr-dim" style="margin-bottom:4px;"><b>16 階斷面切片特徵 (寬度佔比 & 深度中位數):</b></div>
            <div class="pr-slice-list">
              ${(targets[0].slices || []).map((s) => `
                <div class="pr-slice-row">
                  <span style="width:45px;">L${s.level}</span>
                  <div class="pr-slice-bar-bg"><div class="pr-slice-bar-fill" style="width:${Math.round(s.widthRatio * 100)}%;"></div></div>
                  <span style="width:45px;" class="num">${Math.round(s.widthRatio * 100)}%</span>
                  <span style="width:70px;" class="num pr-dim">${s.depthMedianM != null ? `${s.depthMedianM.toFixed(2)}m` : '—'}</span>
                </div>
              `).join('')}
            </div>
          </div>` : ''}
      </div>` : '';

    const depthSum = res.depth?.summary;
    const depthTable = depthSum ? `
      <div class="pr-yolo-sub">
        <h4>🌊 Metric Depth 度量深度指標 (單位: ${esc(res.depth?.units || 'meters')})</h4>
        <table class="pr-tab">
          <tr><th>指標</th><th>數值 (公尺)</th><th>統計意義</th></tr>
          <tr><td>最小深度 (Min)</td><td class="num pr-good">${depthSum.minM}m</td><td class="pr-dim">前景最近距離</td></tr>
          <tr><td>最大深度 (Max)</td><td class="num pr-dim">${depthSum.maxM}m</td><td class="pr-dim">背景最遠距離</td></tr>
          <tr><td>平均深度 (Mean)</td><td class="num">${depthSum.meanM}m</td><td class="pr-dim">全景平均深度</td></tr>
          <tr><td>中位數 (Median)</td><td class="num pr-good">${depthSum.medianM}m</td><td class="pr-good">主體深度參考基準</td></tr>
          <tr><td>P05 ~ P95 區間</td><td class="num">${depthSum.p05M}m ~ ${depthSum.p95M}m</td><td class="pr-dim">去除極值後之主要主體深度帶</td></tr>
        </table>
      </div>` : '';

    yoloDataEl.innerHTML = `
      <div class="pr-yolo-panel">
        <div class="pr-yolo-head">
          <h3>YOLO26 Detection / Segmentation / Depth 數據分析</h3>
          <div class="pr-yolo-badges">
            <span class="pr-yolo-tag">模型: ${esc(res.models?.detection || 'yolo26n.pt')}</span>
            <span class="pr-yolo-tag">分割: ${esc(res.models?.segmentation || 'yolo26n-seg.pt')}</span>
            <span class="pr-yolo-tag">深度: ${esc(res.models?.depth || 'yolo26n-depth.pt')}</span>
            <span class="pr-yolo-tag">解析度: ${res.width}×${res.height}</span>
          </div>
        </div>

        ${detTable}
        ${segTable}
        ${depthTable}

        <div class="pr-json-block">
          <div class="pr-json-top">
            <span>檔案路徑: <code>${esc(res.path || 'yolo_features.json')}</code></span>
            <div style="display:flex;gap:4px;">
              <button class="pr-json-btn" id="prYoloJsonToggle">展開 JSON</button>
              <button class="pr-json-btn" id="prYoloJsonCopy">複製</button>
            </div>
          </div>
          <pre class="pr-json-code" id="prYoloJsonPre" style="display:none;"><code>${esc(res.rawJson)}</code></pre>
        </div>
      </div>`;

    // 綁定 JSON 展開與複製事件
    const toggleBtn = $('prYoloJsonToggle');
    const preEl = $('prYoloJsonPre');
    const copyBtn = $('prYoloJsonCopy');
    if (toggleBtn && preEl) {
      toggleBtn.onclick = () => {
        const isHidden = preEl.style.display === 'none';
        preEl.style.display = isHidden ? 'block' : 'none';
        toggleBtn.textContent = isHidden ? '收起 JSON' : '展開 JSON';
      };
    }
    if (copyBtn) {
      copyBtn.onclick = async () => {
        try {
          await navigator.clipboard.writeText(res.rawJson);
          copyBtn.textContent = '已複製 ✔';
          setTimeout(() => { copyBtn.textContent = '複製'; }, 2000);
        } catch {
          copyBtn.textContent = '複製失敗';
        }
      };
    }

  } catch (err) {
    yoloDataEl.innerHTML = `<div class="pr-sec pr-bad"><h3>YOLO26 數據載入異常</h3><div>${esc(err?.message || err)}</div></div>`;
  }
}

function renderBody() {
  if (app.cur === RUN_KEY) return renderRunBody();
  if (String(app.cur).startsWith('arc:')) return renderArchiveBody(String(app.cur).slice(4));
  if (String(app.cur).startsWith('img:')) return renderPhotoBody(String(app.cur).slice(4));
  const r = rowOf(app.cur);
  const body = $('prBody');
  if (!r) { body.innerHTML = '<div class="pr-dim">← 左側挑一件生成物</div>'; return; }
  const [lLab, rLab] = paneLabels(r);

  body.innerHTML = `
  <div class="pr-body-header">
    <h2 class="pr-h2">${esc(r.title)}</h2>
    <div class="pr-mline">${esc(r.method ? r.method.label : '未記載來源')}
      ・ 分類 ${esc(FAMILY_LABELS[rowCategory(r)] || rowCategory(r))}
      ・ 版本 ${esc(r.verStr || `v${r.version || 1}`)}
      ・ 消費端 ${esc(r.consumer || '—')}${r.glbPath ? ` ・ ${esc(r.glbPath)}` : ''}
      ${r.missing ? ' ・ <span class="pr-bad">缺件:執行期整件走 fallback</span>' : ''}</div>
    ${isWip(r) ? `<div class="pr-sec pr-warn"><h3>⚑ 半成品(台上預設收起)</h3>
      <div>${r.flaws.map((f) => `<b>${esc(f.label)}</b>:${esc(f.detail)}`).join('<br>')}</div>
      <div class="pr-dim">節點沒有被刪 —— 遊戲照舊吃它。判定住 <code>tools/ai3d/mesh_sym.mjs</code>
        (<code>--flaws</code> 印同一份名單);要它回到台上,把網格封起來重新入庫即可。</div></div>` : ''}
    ${r.notes?.length ? `<div class="pr-sec"><h3>附註</h3>
      <div>${r.notes.map((n) => `<b>${esc(n.label)}</b>:${esc(n.detail)}`).join('<br>')}</div></div>` : ''}
  </div>

  <div class="pr-detail-grid">
    <!-- 左欄: 視覺元件欄 (上下並排: 3D圖 -> 工具/覆核 -> 原始圖 -> YOLO視覺切片) -->
    <div class="pr-col-visual">
      <div class="pr-tools">
        <span class="pr-dim">座號</span>
        <div class="seg" id="prSeed">${SEEDS.map((s) => `<button class="segb ${s === app.seed ? 'on' : ''}" data-seed="${s}">#${s}</button>`).join('')}</div>
        <span class="pr-dim">取景</span>
        <div class="seg" id="prDist">${Object.entries(DISTS).map(([k, v]) => {
          const off = k === 'part' && !partFramable(r);
          return `<button class="segb ${k === effDist(r) ? 'on' : ''}" data-dist="${k}"${off
            ? ' disabled title="這一列沒有 GLB 節點可以隔離(純資料件的生成物就是整份零件表)⇒ 一律看整件"'
            : ''}>${v}</button>`;
        }).join('')}</div>
        ${isTreeModelRow(r) ? `<span class="pr-dim">樹木檢視</span>
        <div class="seg" id="prTreeView">${Object.entries(TREE_VIEWS).map(([k, v]) =>
          `<button class="segb ${app.treeView === k ? 'on' : ''}" data-tree-view="${k}">${v}</button>`).join('')}</div>
        <button class="segb ${app.topView ? 'on' : ''}" id="prTopView">正上方・正交</button>` : ''}
        <span class="pr-dim" id="prFrameNote"></span>
        <label><input type="checkbox" id="prCol" ${app.collider ? 'checked' : ''}>碰撞柱</label>
        <label><input type="checkbox" id="prSpin" ${app.spin ? 'checked' : ''}>自轉</label>
      </div>

      <div class="pr-stage" id="prStage">
        ${lLab ? `<div class="pr-pane" id="prPaneL"><div class="pr-cap">◀ ${esc(lLab)}</div>
          <div class="pr-slot"></div><div class="pr-read" id="prReadL"></div></div>` : ''}
        <div class="pr-pane gen" id="prPaneR"><div class="pr-cap">▶ ${esc(rLab)}</div>
          <div class="pr-slot"></div><div class="pr-read" id="prReadR"></div></div>
      </div>

      ${verdictSection(r.key)}

      <div class="pr-sec"><h3>來源圖(img)</h3>
        <div class="pr-imgs">${r.imgs && r.imgs.length ? r.imgs.map(imgCard).join('')
        : (r.verStr === 'v5' || r.version === 5 ? '<div class="pr-none">v5 為獨立多面體純幾何物件（無關照片）</div>' : '<div class="pr-none">來源帳裡沒有記載任何來源圖</div>')}</div></div>

      <div id="prYoloVisuals"></div>
    </div>

    <!-- 右欄: 文字說明/標籤與數據欄 (幾何規格、量測對照、生成方法、特徵報告、YOLO26數據面板) -->
    <div class="pr-col-info">
      ${dataSection(r)}
      ${methodSection(r)}
      ${featuresSection(r)}
      <div id="prYoloData"></div>
    </div>
  </div>`;

  mountStage(r);
  renderGaps();
  loadYoloData(r);

  for (const b of body.querySelectorAll('#prSeed .segb')) b.onclick = () => { app.seed = +b.dataset.seed; renderBody(); };
  for (const b of body.querySelectorAll('#prDist .segb')) b.onclick = () => { app.dist = b.dataset.dist; renderBody(); };
  for (const b of body.querySelectorAll('#prTreeView .segb')) b.onclick = () => {
    app.treeView = b.dataset.treeView;
    renderBody();
  };
  const topView = $('prTopView');
  if (topView) topView.onclick = () => {
    app.topView = !app.topView;
    if (app.topView) app.spin = false;
    renderBody();
  };
  $('prCol').onchange = (e) => { app.collider = e.target.checked; mountStage(r); };
  $('prSpin').onchange = (e) => { app.spin = e.target.checked; };
  bindVerdict(r.key);
}

function syncTools() {
  const el = $('prSpin');
  if (el) el.checked = app.spin;
  const top = $('prTopView');
  if (top) top.classList.toggle('on', app.topView);
}

/** 樹木模型的檢視隔離只切換 mesh.visible,不重建也不修改模型幾何。 */
function applyTreeView(sides, r) {
  if (!isTreeModelRow(r) || app.treeView === 'whole') return true;
  const meshes = sides.flatMap((side) => side.g ? meshesOf(side.g) : []);
  const hasBranches = meshes.some((m) => m.userData.treePartRole === 'branch');
  if (!hasBranches) return false;
  for (const m of meshes) {
    const role = m.userData.treePartRole;
    m.visible = app.treeView === 'branch'
      ? role === 'branch'
      : role === 'branch' || role === 'trunk';
  }
  return true;
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
  // `panes` = 真的畫出來的那幾側;`diff` = 給 sliceOf 算「換掉的是哪幾顆 mesh」的兩側。
  // **兩者刻意分開**:img→3D 的節點沒有同源舊版可比(保險絲是降級路徑不是舊物件)⇒ 只畫一側;
  // 但要隔離出「換掉的就是它」仍然需要一份沒載零件庫的群組當索引 —— 那是**定位**不是比對,
  // 所以它只存在於這個函式裡,不佔 pane、也沒有標題。
  const panes = [];
  let diff = null;
  if (v.mode === 'baseline-vs-now') {
    panes.push({ g: build('pre', `rev:${v.rev}`, v.kind, app.seed, bld), read: 'prReadL' });
    panes.push({ g: build('post', 'now', v.kind, app.seed, bld), read: 'prReadR' });
    diff = panes;
  } else {
    const post = { g: v.kind ? build('post', 'now', v.kind, app.seed, bld) : null, read: 'prReadR' };
    panes.push(post);
    if (v.node) diff = [{ g: build('pre', 'now', v.kind, app.seed, bld) }, post];
  }
  const sides = panes;
  sides.forEach((side, i) => {
    const viewer = gfx.viewers[i];
    const slot = slots[i];
    if (!slot || !viewer) return;
    slot.innerHTML = '';
    slot.appendChild(viewer.canvas);
    const st = setViewerGroup(viewer, side.g, bld);
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

  // ── 取景框 + 「零件」隔離(見 DISTS)────────────────────────────────────────
  // 群組是**整場快取**的 ⇒ 每次掛台一律先把 visible 全開,否則上一列關掉的 mesh 會留在
  // 別列身上(而那看起來就是「這一款的零件怎麼少了幾顆」,沒有任何錯誤訊息)。
  const groups = sides.map((s) => s.g).filter(Boolean);
  for (const g of groups) for (const m of meshesOf(g)) m.visible = true;
  const want = effDist(r) === 'part';
  const got = want && diff ? sliceOf(diff, r) : null;
  const slice = got?.per ? got : null;
  // 隔離索引是對著 `diff` 兩側算的;單獨陳列時畫出來的只有 diff[1](= panes[0])⇒ 對位要平移
  const perOf = (i) => (diff === panes ? slice.per[i] : (i === 0 ? slice.per[1] : null));
  if (slice) {
    // 「零件」取景 = **只顯示換掉的那幾顆 mesh**。隱藏不是第二套組裝器(群組仍是遊戲自己
    // 建的、一顆頂點都沒動),而是把「換掉的就是它」真的畫出來 —— 不隔離的話,4m 的冠簇
    // 節點會被旁邊 25m 寬的原生冠錐整個蓋掉(PR147 的樹冠節點就是這樣在台上看不到的),
    // 而讀數(三角形/mesh 數)量的仍是整件 ⇒ 不會因為隱藏而說謊。
    // 兩側各有各的名冊(見 sliceOf ①:巨岩的兩側粒度本來就不同),MUST NOT 共用一份索引。
    sides.forEach((side, i) => {
      const keep = perOf(i);
      if (!side.g || !keep) return;
      meshesOf(side.g).forEach((m, k) => { m.visible = keep.includes(k); });
    });
  }
  const treeViewApplied = applyTreeView(sides, r);
  gfx.frame = slice
    ? { c: slice.focus.center, r: Math.max(0.4, slice.focus.radius) }
    : frameOf(groups, isTreeModelRow(r) && treeViewApplied);
  gfx.frameTop = topFrameOf(groups);
  const note = $('prFrameNote');
  if (note) {
    // 退回整件時 MUST 講清楚是**哪一種**退回:「這顆座號沒用到這個節點」換個座號就看得到,
    // 跟「台子配不起來」是兩件完全不同的事(寫同一句 = 把可以按的那顆鈕講成壞掉)
    let why = '';
    if (want && !slice) {
      const other = got?.miss === 'absent' ? seedsWith(r, v, bld).filter((s) => s !== app.seed) : [];
      why = got?.miss === 'absent'
        ? (other.length
          ? `(這顆座號沒用到這個節點 —— 座號 ${other.map((s) => `#${s}`).join('/')} 有;先看整件)`
          : '(三顆座號都沒用到這個節點 —— 先看整件)')
        : '(兩側逐位元相同,沒有換到東西 —— 先看整件)';
    }
    const treeNote = isTreeModelRow(r)
      ? `${app.topView ? '正上方正交' : '透視'} ・ ${TREE_VIEWS[app.treeView]}${treeViewApplied ? '' : '（模型沒有可辨識枝條零件）'}`
      : '';
    const distNote = !want ? '' : slice ? `(只顯示換掉的 ${slice.per[1].length} 顆 mesh)`
      : (diff ? why : '(這一列沒有 GLB 節點可以隔離)');
    note.textContent = [treeNote, distNote].filter(Boolean).join(' ・ ');
  }
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

// ---- 採集迴圈啟停 + 圖檔三態 -------------------------------------------------
// 使用者需求(2026-08-10):「設定腳本可以在零件台執行/關閉,會自動判斷圖檔未處理/已處理/需修正」。
//
// **這一段一個判斷都不做**:狀態由 `tools/ai3d/photo_state.mjs` 推導、啟停由
// `tools/dev_supervisor.mjs` 那一支 `handle` 把關(loopback + 參數零信任 + CSRF 標頭)。
// 頁面自己再判一次的話,面板會與迴圈說出兩套話,而兩邊都不會報錯。
const harvest = { photos: null, tool: null, busy: false, home: null, log: null };

/** 執行進度那一頁在清單/內文兩邊的鍵(不是節點也不是圖檔 ⇒ 自己一個具名值,不跟 key 撞) */
const RUN_KEY = 'run';

const devApi = async (path, method = 'GET') => (await fetch(path, method === 'GET' ? undefined
  // 邊界 ④:非簡單標頭 ⇒ 惡意網頁送不出來(它需要 CORS 預檢,而伺服器不回應預檢)
  : { method, headers: { 'x-dev-tools': '1' } })).json();

/**
 * 「現在看的是哪一個資料家」的**索引**。
 *
 * 版權未確認的那一份住儲存庫之外(2026-08-11 使用者:「版權問題不在專案的管線也要顯示在
 * 零件台」)⇒ 台上要挑得到它,而挑法 MUST 是索引:路徑一律由伺服器自己推導,請求只能說
 * 「第幾個」(同 `/api/photo` 與 `/api/screen` 既有的零信任)。
 *
 * ⚠ 兩份候選清單**未必等長**:零件台可能是帶 `--photos` 起的(那一個會多排在最前面),
 * 而採集迴圈那一支問的是 `dev_supervisor` 自己的清單 ⇒ **索引 MUST 逐清單各查一次**,
 * 頁面自己記的是**路徑**。共用一個數字的話,在零件台上挑了 A、按啟動跑的卻是 B。
 */
const idxIn = (list, home) => (list || []).findIndex((h) => h.home === home);
const homeIdx = () => (harvest.home ? idxIn(harvest.photos?.homes, harvest.home) : -1);
const homeParam = () => (homeIdx() >= 0 ? `&home=${homeIdx()}` : '');
/** 送進 POST body 的選擇:查不到就**不送**(送 -1 會被伺服器當成「指名了一個不存在的候選」
 *  而回錯誤,但那時使用者根本沒挑過 —— 沒挑就該走伺服器的預設挑選) */
const homeSel = () => (homeIdx() >= 0 ? homeIdx() : undefined);

async function loadHarvest() {
  const i = homeIdx();
  const q = i >= 0 ? `?home=${i}` : '';
  const [photos, dev] = await Promise.all([
    fetch(`/api/photos${q}`).then((r) => r.json()).catch(() => null),
    devApi('/dev/tools').catch(() => null),
  ]);
  harvest.photos = photos;
  harvest.tool = (dev?.tools || []).find((t) => t.key === 'harvest') || null;
  // 記住的是**路徑**(見 idxIn);第一次載入由伺服器的預設挑選定案 —— 台上預設看到的家
  // MUST 等於按下「▶ 啟動」會跑的那一個(兩邊各自挑 = 面板顯示 A 而迴圈跑 B)
  if (photos?.homes?.length) harvest.home = photos.homes[photos.homeIdx ?? 0]?.home ?? null;
  renderHarvest();
  if (app.cur === RUN_KEY) renderBody();
}

/** 執行進度:全量日誌 + 上一次啟動的經過(清單那一支只帶最後 6 行,不夠看一輪) */
async function loadRunLog() {
  harvest.log = await devApi('/dev/tools/harvest/log').catch(() => null);
  if (app.cur === RUN_KEY) renderBody();
}

function renderHarvest() {
  const el = $('prHarvest');
  const t = harvest.tool;
  const p = harvest.photos;
  if (!el) return;
  if (!t) { el.innerHTML = '<span class="pr-hs">採集迴圈:這個台子不是由開發工具管理者啟動的(啟停端點不可用)</span>'; return; }
  // **「跑起來了嗎」只讀伺服器推導的 `on`**(dev_supervisor.statusOf):存活判準依 kind 分流,
  // 而分流住那一支一份。客戶端自己挑欄位的下場見 main.js 那一段註解(鈕面永遠停在「▶ 啟動」)。
  const on = !!t.on;
  const counts = p?.counts || {};
  const states = p?.states || {};
  // 順序 = photo_state.STATES 的宣告順序(需修正排最前面 —— 它是唯一「下一步在人身上」的那一態)
  const order = ['fix', 'todo', 'done', 'dropped'];
  // 狀態鈕 = **左側清單的內容切換**(而不是就地展開一段文字):使用者要的是「把圖加進清單、
  // 一張一張看著判」,而清單那一欄本來就是為了逐件挑選存在的
  const pills = order.filter((k) => states[k]).map((k) =>
    `<button class="pr-hst ${k}" data-st="${k}" aria-pressed="${app.list === k}"
       title="${esc(states[k].hint)}">${esc(states[k].label)} ${counts[k] ?? 0}</button>`).join('');
  // 資料家選單:版權未確認的那一份也在裡面(註冊縫 provenance.extraHomes)⇒ **逐列標出貨與否**,
  // 兩份語料長得一模一樣,而人眼判決是照著台上做的
  const homeOpts = (p?.homes || []).map((h, i) =>
    `<option value="${i}" ${h.home === harvest.home ? 'selected' : ''}>`
    + `${esc(String(h.home).split(/[\\/]/).slice(-2).join('/'))} ・ ${h.entries} 筆`
    + `${h.shipping === false ? ' ・ ⚠ 不進遊戲' : ''}</option>`).join('');
  el.innerHTML = `
    <button class="segb ${on ? '' : 'on'}" id="prHrun" ${harvest.busy ? 'disabled' : ''}>${on ? '⏹ 停止採集迴圈' : '▶ 啟動採集迴圈'}</button>
    <span class="pr-hdot ${on ? 'on' : ''}"></span>
    <span class="pr-hs">${on ? '執行中(每 15 分鐘一輪;入庫只寫工作區,不 commit)' : '未執行'}</span>
    <button class="pr-hst run" data-st="${RUN_KEY}" aria-pressed="${app.list === RUN_KEY}"
      title="這一輪跑到哪一站、完整命令列、上一次啟動的結果">執行進度</button>
    <button class="pr-hst" data-st="nodes" aria-pressed="${app.list === 'nodes'}"
      title="回到生成物清單(節點與純資料件)">生成物</button>
    ${pills}
    <button class="pr-hst arc" data-st="archive" aria-pressed="${app.list === 'archive'}"
      title="判過「⊘ 移除」而撤出遊戲的那些(來源圖留著)">封存區 ${app.data?.archive?.length ?? 0}</button>
    <span class="pr-grow"></span>
    ${/* 非出貨語料家 MUST 標出來 —— 它與正式語料長得一模一樣,不標的話台上兩份混在一起 */
    p?.corpus && p.corpus.shipping === false
      ? `<span class="pr-bad" title="${esc(p.corpus.why || '')}">⚠ 非出貨語料(不進遊戲)</span>` : ''}
    <span class="pr-hs">資料家</span>
    <select id="prHome" class="pr-hsel" title="切換要看/要跑的語料家(索引由伺服器推導,頁面只挑第幾個)">${homeOpts}</select>
    ${p?.ok ? '' : `<span class="pr-bad">⚠ ${esc(p?.why || '讀不到語料帳本')}</span>`}
    ${/* 啟動失敗的理由 MUST 留在畫面上:只回在那一次 POST 裡的話,重整一次就永遠消失,
         而使用者看到的就是「按了沒反應」 */
    t.run?.error ? `<span class="pr-bad" title="${esc(t.run.error)}">⚠ 上次啟動失敗 —— 看執行進度</span>` : ''}
    ${t.log ? `<div class="pr-hlist">${esc(t.log).split('\n').map((l) => `<div>${l}</div>`).join('')}</div>` : ''}`;

  $('prHrun').onclick = async () => {
    harvest.busy = true; renderHarvest();
    // 啟動一律**指名資料家**(在 dev_supervisor 自己那份清單裡的索引;見 idxIn):
    // 沒指名時它會挑「出貨家優先」的那一個 —— 而台上正在看的可能正是另一個
    const i = on ? -1 : idxIn(harvest.tool?.homes, harvest.home);
    const path = on ? '/dev/tools/harvest/stop' : `/dev/tools/harvest/start${i >= 0 ? `/${i}` : ''}`;
    try { harvest.tool = await devApi(path, 'POST'); }
    finally { harvest.busy = false; renderHarvest(); }
    // 按下去就把執行進度攤開 —— 使用者的原話是「點下去提供執行進度頁面」:
    // 這條迴圈第一輪要跑十幾站、十幾分鐘,不給進度就只剩一顆會變色的點
    app.list = RUN_KEY; app.cur = RUN_KEY;
    renderHarvest(); renderList();
    await loadRunLog();
    // 跑完一輪語料狀態會變 ⇒ 停下來時重讀一次(啟動時還來不及變,但重讀也不貴)
    loadHarvest();
  };
  $('prHome').onchange = (e) => {
    const h = (harvest.photos?.homes || [])[Number(e.target.value)];
    if (!h) return;
    harvest.home = h.home;
    app.cur = null;
    loadHarvest();
  };
  for (const b of el.querySelectorAll('.pr-hst')) {
    b.onclick = () => {
      app.list = b.dataset.st;
      // 換清單就把選取清掉 —— 留著上一份清單的 key 會讓右邊顯示一件左邊根本不在的東西
      app.cur = app.list === 'nodes' ? (app.data.rows[0]?.key ?? null)
        : app.list === RUN_KEY ? RUN_KEY : null;
      renderHarvest(); renderList(); renderBody();
      if (app.list === RUN_KEY) loadRunLog();
    };
  }
}

/**
 * 執行進度頁(2026-08-11 使用者需求:「點下去提供執行進度頁面」)。
 *
 * 這一頁存在的理由是「按了沒反應」的另一半:鈕面修好之後,採集迴圈仍然是一支**跑十幾分鐘、
 * 十幾站**的背景工作,而畫面上原本只有一顆綠點與最後六行日誌。這裡把三件事攤開,
 * 全部由伺服器送來(頁面一個都不判):
 *   ① **完整命令列**(`run.argv`)—— 三個家推不推導得到是這條迴圈最常見的失敗:少了 `--venv`
 *      就是去背/分離/選片/生成四站靜默跳過,而每一輪照印「生成 0」,看起來完全正常。
 *   ② **逐站進度** —— 日誌裡的 `▶ 站名` / `⏭ 略過` / `── 本輪` 就是那條管線自己的分站,
 *      這裡只是把最後一輪抓出來標色,MUST NOT 另外定義一份站名清單(那會跟迴圈說出兩套話)。
 *   ③ **上一次啟動的結果** —— 失敗理由留在 `run.error`(重整不會消失)。
 */
function renderRunBody() {
  const body = $('prBody');
  const t = harvest.tool;
  const g = harvest.log;
  if (!t) { body.innerHTML = '<div class="pr-dim">這個台子不是由開發工具管理者啟動的 ⇒ 沒有啟停端點,也就沒有進度可看。</div>'; return; }
  const on = !!(g?.on ?? t.on);
  const run = g?.run || t.run;
  const lines = (g?.log || t.log || '').split('\n').filter(Boolean);
  // 最後一輪 = 最後一個「══ 第 N 輪」之後的全部(迴圈自己印的分隔線,不是這裡定義的)
  const head = lines.map((l, i) => (l.startsWith('══') ? i : -1)).filter((i) => i >= 0).pop();
  const round = head == null ? lines : lines.slice(head);
  const cls = (l) => (l.startsWith('▶') ? 'st-run' : l.startsWith('⏭') ? 'st-skip'
    : /^(⚠|💥|❌)/.test(l) ? 'st-warn' : l.startsWith('══') || l.startsWith('──') ? 'st-head' : '');
  body.innerHTML = `
  <h2 class="pr-h2">採集迴圈 ・ 執行進度</h2>
  <div class="pr-mline">${on ? '執行中' : '未執行'}
    ${run?.at ? ` ・ 上次啟動 ${esc(String(run.at).replace('T', ' ').slice(0, 19))}` : ''}
    ${run?.exit != null ? ` ・ 行程已結束(代碼 ${run.exit})` : ''}</div>
  ${run?.error ? `<div class="pr-sec pr-warn"><h3>⚠ 啟動失敗</h3><div>${esc(run.error)}</div>
    <div class="pr-dim">語料家住儲存庫之外時(版權未確認的那一份)MUST 先註冊:
      在 <code>tools/ai3d/corpus_homes.json</code> 寫 <code>{"homes":["&lt;絕對路徑&gt;"]}</code>,
      或設環境變數 <code>SVS_PHOTO_HOMES</code>;也可以直接在終端機帶 <code>--home</code> 跑。</div></div>` : ''}
  <div class="pr-sec"><h3>${run?.argv ? '這一輪在跑什麼' : '按下啟動會跑什麼'}</h3>
    <div class="pr-kv">
      <b>資料家</b><div>${esc(run?.home || t.home || '(推導不到任何資料家)')}${run?.argv ? '' : '(預設值;上方選單可以改)'}</div>
      <b>命令列</b><div class="pr-cmd">${esc((run?.argv || []).join(' ')
    || (run ? '(上一次沒有啟動成功 —— 見上面的理由)' : '(還沒從這個台子啟動過)'))}</div>
    </div>
    <div class="pr-dim">三個家是三件事(語料 <code>--home</code> / 模型棧 <code>--venv</code> /
      T2-spz <code>--t2</code>):少了 <code>--venv</code> ⇒ 去背・圈選分離・選片閘・生成四站全部跳過,
      而每一輪照印「生成 0」,沒有任何錯誤訊息。上面那一行就是用來確認它們在不在的。</div></div>
  <div class="pr-sec"><h3>最後一輪(${round.length} 行${lines.length > round.length ? `,更早的另有 ${lines.length - round.length} 行` : ''})</h3>
    <div class="pr-runlog">${round.length
    ? round.map((l) => `<div class="${cls(l)}">${esc(l)}</div>`).join('')
    : '<div class="pr-dim">(還沒有輸出 —— 第一站是「收編 inbox」,通常幾秒內就會出現)</div>'}</div>
    <div class="pr-dim">日誌只留在這個台子的記憶體裡(逐工具封頂);長期紀錄是資料家的
      <code>harvest_log.jsonl</code>(每輪一列)。</div></div>`;
}

/**
 * 封存區(2026-08-11 使用者需求:「加入移除鍵,移除遊戲與零件台,放到封存區」)。
 * 這裡的每一列都是**已經不在遊戲裡**的節點 —— GLB / 名冊 / 來源帳三邊都撤掉了,
 * 只有墓碑帳(`tools/ai3d/archive_manifest.json`)說得出它存在過、吃過哪張圖、為什麼被移除。
 */
function renderArchiveList() {
  const rows = app.data.archive || [];
  $('prList').innerHTML = rows.map((a) => `<div class="pr-row ${app.cur === `arc:${a.key}` ? 'on' : ''}" data-key="arc:${esc(a.key)}">
      <div class="pr-rn"><b>${esc(a.key)}</b><span>${esc(String(a.at || '').slice(0, 10))} ・ ${esc(a.family || '—')}</span></div>
      <span class="pr-pill">已封存</span></div>`).join('')
    || '<div class="pr-dim" style="padding:12px">(封存區是空的 —— 判「⊘ 移除」並跑過 apply_verdicts 的會出現在這裡)</div>';
  for (const el of $('prList').querySelectorAll('.pr-row')) el.onclick = () => select(el.dataset.key);
}

function renderArchiveBody(key) {
  const body = $('prBody');
  const a = (app.data.archive || []).find((x) => x.key === key);
  if (!a) { body.innerHTML = '<div class="pr-dim">← 左側挑一件封存的</div>'; return; }
  body.innerHTML = `
  <div class="pr-body-header">
    <h2 class="pr-h2">${esc(a.key)}</h2>
    <div class="pr-mline">已封存 ${esc(String(a.at || '').replace('T', ' ').slice(0, 19))}
      ・ ${esc(a.method?.label || '?')}${a.consumer ? ` ・ 原消費端 ${esc(a.consumer)}` : ''}</div>
    <div class="pr-sec pr-warn"><h3>⊘ 已撤出遊戲</h3>
      <div>${a.why ? esc(a.why) : '(覆核時沒有留下理由)'}</div>
      <div class="pr-dim">節點已從 <code>${esc(a.family || '?')}.glb</code>、<code>biomes.js</code> 名冊、
        來源帳三邊撤掉 ⇒ 遊戲裡沒有它,台上的生成物清單也沒有它。**來源圖留著**,
        而且不再自動重跑(採集迴圈把「封存過」算成人眼已處置)。要再生一顆:把這張圖的
        <code>screen</code> 判回 pass 之後手動跑一輪,或走 <code>⟳ 重生</code> 那條路。</div></div>
  </div>
  <div class="pr-detail-grid">
    <div class="pr-col-visual">
      <div class="pr-sec"><h3>來源圖(img)</h3>
        <div class="pr-imgs">${a.imgs?.length ? a.imgs.map(imgCard).join('')
        : '<div class="pr-none">封存帳裡沒有記載任何來源圖</div>'}</div></div>
    </div>
    <div class="pr-col-info">
      <div class="pr-sec"><h3>當時的生成參數</h3>
        <div class="pr-kv">
          <b>工具</b><div>${esc(a.gen?.tool || '—')}</div>
          <b>參數</b><div>${esc(a.gen?.params || '—')}</div>
          <b>產出</b><div>${esc([a.gen?.out_dir, a.gen?.out_index != null ? `第 ${a.gen.out_index} 顆` : ''].filter(Boolean).join(' ・ ') || '—')}</div>
          <b>實測</b><div>${esc(a.gen?.measured || '—')}</div>
          <b>出貨版本</b><div>${esc([a.rev, a.shipped_at].filter(Boolean).join(' ・ ') || '—')}</div>
        </div></div>
    </div>
  </div>`;
}

/**
 * 語料圖檔的細節頁 —— **手動篩選就在這裡做**(2026-08-10 使用者需求)。
 *
 * 三顆鈕對到 `screen_mattes.py` 既有的兩支,而不是在這裡改帳本:
 *   ✔ 保留 → `--human pass`   (救回統計誤殺;人眼恆勝統計)
 *   ✕ 淘汰 → `--human reject` (不再送生成,**檔案留著** —— Route A 仍要看照片)
 *   🗑 刪除 → `--purge`        (真刪檔 + 進黑名單;連同它切出來的每一個目標)
 * 判決的紀律(恆勝、roll_up 到母照片、黑名單怎麼表達)全部住那一支,台上只是按鈕。
 */
function renderPhotoBody(id) {
  const body = $('prBody');
  const r = (harvest.photos?.rows || []).find((x) => x.id === id);
  if (!r) { body.innerHTML = '<div class="pr-dim">← 左側挑一張圖(或按上方狀態鈕換一態)</div>'; return; }
  const st = harvest.photos?.states?.[r.state];
  // 圖檔一律帶著**現在看的是哪一個資料家**(索引):兩個家可能有同名的 id,而
  // 「我在 A 家上按的判決落到 B 家」是這一族最惡劣的一種 —— 兩邊都不會報錯。
  const hp = homeParam();
  body.innerHTML = `
  <h2 class="pr-h2">${esc(r.family)}/${esc(r.part)} ・ ${esc(r.id)}</h2>
  <div class="pr-mline">${esc(st?.label || r.state)} —— ${esc(st?.hint || '')}
    ${r.purged ? ' ・ <span class="pr-bad">已刪除來源圖(黑名單)</span>' : ''}</div>
  <div class="pr-sec"><h3>圖(有去背就顯示去背後的 —— 「這張到底能不能用」看的是那一張)</h3>
    <div class="pr-imgs">
      <div class="pr-img" style="max-width:460px">
        <img src="/api/photo?id=${encodeURIComponent(r.id)}${hp}" alt="" loading="lazy">
        <div class="pr-dim">母照片 ・ 選片閘 ${esc(r.screen || '(還沒驗過)')}</div>
      </div>
      ${/* 切出來的目標才是**真的餵進生成器**的東西 ⇒ 有切就一起攤開,不然判的是另一張圖 */
    Array.from({ length: r.targets || 0 }, (_, i) => `<div class="pr-img" style="max-width:300px">
        <img src="/api/photo?id=${encodeURIComponent(r.id)}&t=${i}${hp}" alt="" loading="lazy">
        <div class="pr-dim">目標 #${i + 1}(送進 img→3D 的就是它)</div></div>`).join('')}
    </div></div>
  <div class="pr-sec pr-verdict"><h3>手動篩選</h3>
    <div class="seg" id="prScreen">
      <button class="segb" data-act="pass">✔ 保留(送回待跑池)</button>
      <button class="segb" data-act="reject">✕ 淘汰(不再送生成,檔案留著)</button>
      <button class="segb" data-act="purge">🗑 刪除來源圖(真刪 + 黑名單)</button>
    </div>
    <div class="pr-dim" id="prScreenOut">判決寫回 photo_manifest.json;人眼判決恆勝統計(重跑選片閘不會被覆寫)。</div>
  </div>
  <div class="pr-sec"><h3>下一步</h3>
    <div>${esc(r.next)}</div>
    ${r.nodes?.length ? `<div class="pr-dim">出貨成:${r.nodes.map(esc).join('、')}</div>` : ''}
    ${r.verdict ? `<div class="pr-dim">待執行判決:<b>${esc(r.verdict.status)}</b> ${esc(r.verdict.node)}${r.verdict.note ? `(${esc(r.verdict.note)})` : ''}</div>` : ''}
  </div>`;
  for (const b of body.querySelectorAll('#prScreen .segb')) {
    b.onclick = async () => {
      // 刪除是不可逆的(檔案真的不見)⇒ 明講會刪掉什麼再問一次。其餘兩個只是改帳本,不必問。
      if (b.dataset.act === 'purge'
        && !confirm(`真的刪除 ${r.id}?\n原圖、matte${r.targets ? `、切出來的 ${r.targets} 個目標` : ''} 都會從硬碟刪掉,\n並進黑名單(之後不會再被抓/收編/送生成)。`)) return;
      const out = $('prScreenOut');
      out.textContent = '執行中…';
      const res = await fetch('/api/screen', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-dev-tools': '1' },
        body: JSON.stringify({ id: r.id, act: b.dataset.act, home: homeSel() }),
      }).then((x) => x.json()).catch((e) => ({ ok: false, error: String(e) }));
      out.textContent = res.ok ? (res.out || '已寫回') : `失敗:${res.error || '?'}`;
      if (res.ok) { await loadHarvest(); renderList(); renderBody(); }
    };
  }
}

// ---- 啟動 ------------------------------------------------------------------
app.data = await api();
try { await initGfx(app.data); }
catch (e) { gfx.error = e?.message || String(e); console.warn('3D 對照停用:', e); }
setupFilters();
renderStat();
renderList();
const wantedKey = new URLSearchParams(location.search).get('key');
select(app.data.rows.find((r) => r.key === wantedKey && keepRow(r))?.key
  || app.data.rows.filter(keepRow)[0]?.key || app.data.rows[0]?.key);
for (const b of $('prFilter').querySelectorAll('.segb')) {
  b.onclick = () => {
    app.filter = b.dataset.f;
    for (const x of $('prFilter').querySelectorAll('.segb')) x.classList.toggle('on', x === b);
    const filteredRows = app.data.rows.filter(keepRow);
    if (app.cur && !filteredRows.some((r) => r.key === app.cur)) {
      app.cur = filteredRows[0]?.key || null;
      renderBody();
    }
    renderList();
    renderStat();
  };
}

// 採集迴圈那一條放**最後**載入:它會去問啟停端點與語料帳本,而那兩件都可能不在
// (終端機直接跑這個台子、或語料家不在本機)⇒ 失敗一律只影響這一條窄帶,主畫面照常。
loadHarvest();
// 跑著的時候每 20 秒重讀一次:輪距是 15 分鐘,再密只是多敲檔案系統;停著就不必輪詢。
setInterval(() => { if (harvest.tool?.on) loadHarvest(); }, 20000);
// 執行進度攤開著的時候另外每 3 秒抓一次日誌 —— 那一頁的用途就是「現在跑到哪一站」,
// 20 秒一次會讓一站看起來像卡住(去背那一站本來就要跑好幾分鐘,但它一開始就會印標題)。
setInterval(() => { if (app.cur === RUN_KEY) loadRunLog(); }, 3000);
