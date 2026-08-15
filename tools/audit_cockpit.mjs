// FPV 座艙取景稽核(CLAUDE.md §5「座艙/取景」列;2026-07-24 建立)
// 前置:伺服器在 8620 執行中(node server/server.js);Playwright 借用 mapping_elf 的安裝
// 用法:node tools/audit_cockpit.mjs [--parts] [--only s01,t03] [--break-single|--break-scope|--break-hud]
//
// 使用者四條取景規則(2026-07-24;全 32 角色 × 變形者雙型態):
//  ① 視野不可妨礙視線 —— 準星錐(COCKPIT.SIGHT_DEG 半角)內 MUST 零遮擋
//  ② 手部/武器不可超出 HUD 太多 —— 武裝頂緣 MUST ≤ COCKPIT.TOP_NDC(NDC y)
//  ③ 面積不可太大 —— 座艙總遮擋 ≤ COCKPIT.AREA_MAX、武裝 ≤ COCKPIT.WPN_AREA_MAX
//  ④ 透視圖法、消失點在準星 —— 武器軸線與「武器 → 消失點」夾角 ≤ COCKPIT.VP_TOL_DEG
//
// 2026-08-15 使用者追加三條(「駕駛艙畫面基於新版機體更新設計」那一輪):
//  ⑤ **單一物件面積不可超過全畫面的 5%** —— 逐件單獨渲染,`cov` MUST ≤ COCKPIT.PART_AREA_MAX。
//     這一條 MUST **恆量**(不是 --parts 才量):它是使用者可見的硬天花板,而執行期的兩個夾制
//     旋鈕(WPN_BOX_MAX / DEV_AREA_MAX)夾的是**包圍盒**;盒與實渲染之間的落差逐機體不同,
//     只驗旋鈕等於沒驗到這一條。反向驗證 `--break-single`(把兩個旋鈕放寬到 5% 以上)。
//  ⑥ **狙擊模式不出現機體零件** —— `aiming = true` + `_syncCockpitWeapon()` 之後整個座艙的
//     實渲染遮擋 MUST 為 0。反向驗證 `--break-scope`(略過那次同步)。
//  ⑦ **HUD 最多畫面高度的 1/6** —— 三個視窗尺寸各量一次 `.hud-bottom` 的**變換後**盒高。
//     反向驗證 `--break-hud`(把 `--hud-k` 釘回 1)。
//  ⑧ **畫面九宮格的中間不可放物件**(2026-08-15 第二輪)—— |NDC x| ≤ 1/3 且 |NDC y| ≤ 1/3 的
//     那一格,實渲染遮擋 MUST 為 0。這一條**涵蓋**①(格的邊中點離視軸 12.7° > 11°)⇒ ① 從此是
//     它的見證人:①紅而⑧綠是不可能的,兩欄同時綠才代表夾制真的認的是格不是錐。
//     反向驗證 `--break-grid`(把 `GRID_NDC` 縮成 0 ⇒ 夾制退回只認頂緣與面積)。
//  ⑨ **動起來之後也要守規矩**(2026-08-15 使用者:「螺旋槳放進去的時候會不會轉?不轉的話很奇怪,
//     會轉的話要考慮旋轉後的範圍」)—— 座艙有四種每幀都在動的東西,而取景夾制定案的是靜止那一幀:
//     自轉件(繞樞軸 360°)/ 擺動件(正弦)/ 武裝後座與填彈(平移 + 繞樞軸轉)/ 榴彈超高仰角。
//     這一欄逐姿勢渲染取**最壞**:中央格 MUST 0、頂緣 MUST ≤ TOP_NDC。
//     反向驗證 `--break-anim`(頁面帶 `?cockanim=0`:夾制退回只量靜止那一幀、武裝繞鏡頭抬到底)。
//
// ⚠ 座艙的結構件自 2026-08-15 起是**真品機體零件的複本**(game.js `_cockBody`)——
//    「這一台的座艙看起來不是這一台」在這支稽核上量不到(每一條規則都會過)。逐件數量與
//    來源另有 ㋓ 的定裝照把關,改 `COCK_BODY` 任一參數 MUST 回頭看一次截圖。
//
// 量測法 = 真渲染(WebGLRenderTarget 讀回 alpha),不是包圍盒近似:
// 半透明件(膜翼/槳盤)按 alpha 加權、描邊殼一併計入 —— 玩家看到多少就量到多少。
// --parts:對每個頂層座艙件單獨渲染,列出侵入準星錐 / 超出 HUD 上緣的元凶(幾何型別 + 世界座標,可直接 grep)
import { chromium } from 'file:///C:/Users/user/Documents/app/mapping_elf/node_modules/playwright/index.mjs';

const PARTS = process.argv.includes('--parts');
const BREAK_SINGLE = process.argv.includes('--break-single');
const BREAK_SCOPE = process.argv.includes('--break-scope');
const BREAK_HUD = process.argv.includes('--break-hud');
const BREAK_GRID = process.argv.includes('--break-grid');
const BREAK_ANIM = process.argv.includes('--break-anim');
const onlyArg = process.argv.find((a) => a.startsWith('--only='));
const ONLY = onlyArg ? onlyArg.slice(7).split(',') : null;

// 埠可由 SVS_URL 覆寫:8620 上常常跑著**另一個 checkout**(工作區之間共用那個埠),
// 在那裡驗到的是別份程式碼而且不會報錯。
const browser = await chromium.launch();
const page = await browser.newPage();
page.on('pageerror', (e) => console.log('PAGEERROR:', e.message));
await page.goto((process.env.SVS_URL || 'http://localhost:8620') + (BREAK_ANIM ? '/?cockanim=0' : ''), { waitUntil: 'networkidle' });

const rep = await page.evaluate(async ({ PARTS, ONLY, BREAK_SINGLE, BREAK_SCOPE, BREAK_GRID }) => {
  const THREE = await import('three');
  const { BattleClient, COCKPIT, HUD_BOTTOM_F } = await import('/public/js/game.js');
  const { CHARACTERS, charKind, BALLISTIC, UNITS } = await import('/public/js/data.js');

  const W = 640, H = 360, ASPECT = W / H;
  const FOV = 68;                       // A8:全機種 68(MUST NOT 差異化)
  const TAN_V = Math.tan((FOV / 2) * Math.PI / 180);
  const C = COCKPIT;
  const GRID = C.GRID_NDC;

  const rnd = new THREE.WebGLRenderer({ antialias: false, alpha: true });
  rnd.setSize(W, H, false);
  rnd.setClearColor(0x000000, 0);
  const rt = new THREE.WebGLRenderTarget(W, H);
  const buf = new Uint8Array(W * H * 4);

  const NDCX = new Float32Array(W), NDCY = new Float32Array(H);
  for (let i = 0; i < W; i++) NDCX[i] = ((i + 0.5) / W) * 2 - 1;
  for (let j = 0; j < H; j++) NDCY[j] = ((j + 0.5) / H) * 2 - 1;   // readPixels:j=0 為畫面底
  const DEG = new Float32Array(W * H);
  for (let j = 0; j < H; j++) {
    for (let i = 0; i < W; i++) {
      const tx = NDCX[i] * ASPECT * TAN_V, ty = NDCY[j] * TAN_V;
      DEG[j * W + i] = Math.atan(Math.hypot(tx, ty)) * 180 / Math.PI;
    }
  }

  /** 渲染一次並統計遮擋(alpha 加權;a>10 才算「看得見」) */
  const shoot = (scene, cam) => {
    rnd.setRenderTarget(rt);
    rnd.clear();
    rnd.render(scene, cam);
    rnd.readRenderTargetPixels(rt, 0, 0, W, H, buf);
    rnd.setRenderTarget(null);
    let cov = 0, sight = 0, mid = 0, grid = 0, topY = -1.001, minDeg = 999;
    for (let j = 0; j < H; j++) {
      for (let i = 0; i < W; i++) {
        const a = buf[(j * W + i) * 4 + 3];
        if (a <= 10) continue;
        const w = a / 255;
        cov += w;
        const d = DEG[j * W + i];
        if (d < minDeg) minDeg = d;
        if (d <= C.SIGHT_DEG) sight += w;
        // ⑧ 中央九宮格:MUST 以 **NDC** 判(不是角度)—— 格是矩形而錐是圓,兩者只在
        // 「格涵蓋錐」這個包含關係上有交集,拿角度近似格會在四個角上放行。
        if (Math.abs(NDCX[i]) <= GRID && Math.abs(NDCY[j]) <= GRID) grid += w;
        if (Math.abs(NDCY[j]) <= 0.45) mid += w;          // 交戰帶:畫面中央 45% 高
        if (NDCY[j] > topY) topY = NDCY[j];
      }
    }
    const N = W * H;
    return { cov: cov / N, sight: sight / N, mid: mid / N, grid: grid / N, topY, minDeg: minDeg === 999 ? 90 : minDeg };
  };

  /** 只隱藏(絕不打開)—— 變形者的型態可見性由 _syncCockpitWeapon 定案,稽核 MUST NOT 覆寫 */
  const isolate = (list, keep) => {
    const prev = list.map((o) => o.visible);
    list.forEach((o) => { if (!keep(o)) o.visible = false; });
    return () => list.forEach((o, i) => { o.visible = prev[i]; });
  };

  /** 可辨識的件名:幾何型別 + 主要尺寸 + 世界座標(可直接回 game.js grep) */
  const tag = (o) => {
    let g = null;
    o.traverse((n) => { if (!g && n.isMesh && !n.userData.isOutline) g = n.geometry; });
    const p = g?.parameters || {};
    const t = (g?.type || 'Group').replace('Geometry', '');
    const dims = ['width', 'height', 'depth', 'radius', 'radiusTop', 'radiusBottom', 'length']
      .filter((k) => p[k] != null).map((k) => (+p[k]).toFixed(2)).join('x');
    const w = o.getWorldPosition(new THREE.Vector3());
    return `${t}(${dims})@${w.x.toFixed(2)},${w.y.toFixed(2)},${w.z.toFixed(2)}`;
  };

  // 裝置面積量度(bbox frac,與 game.js _frameCockpitStruct 同度量:16:9 基準、NDC 盒面積)
  const TANV = Math.tan(34 * Math.PI / 180), A2 = 16 / 9;
  const nH = (z) => Math.abs(z) * TANV;
  const bfrac = (o) => {
    const bb = new THREE.Box3().setFromObject(o);
    if (bb.isEmpty()) return 0;
    const zn = Math.max(0.05, Math.min(Math.abs(bb.min.z), Math.abs(bb.max.z)));
    return ((bb.max.x - bb.min.x) / (nH(zn) * A2) / 2) * ((bb.max.y - bb.min.y) / nH(zn) / 2);
  };

  // ⑤ 反向驗證:把**執行期的兩個夾制旋鈕**放寬到天花板之上。壞版的座艙件會真的長大,
  // 而「單件 ≤ 5%」那一欄 MUST 紅字 —— 這證明那一欄量的是實渲染,不是旋鈕的複述。
  if (BREAK_SINGLE) { COCKPIT.WPN_BOX_MAX = 0.25; COCKPIT.DEV_AREA_MAX = 0.25; }
  // ⑧ 反向驗證:格子縮成 0 ⇒ 推出格的那三個消費端全部退化成 no-op(夾制只剩頂緣與面積)。
  // 「中央格」那一欄 MUST 紅字 —— 這證明那一欄量的是實渲染,不是 GRID_NDC 的複述。
  if (BREAK_GRID) COCKPIT.GRID_NDC = 0;
  const out = { rows: [], cfg: { SIGHT_DEG: C.SIGHT_DEG, AREA_MAX: C.AREA_MAX, WPN_AREA_MAX: C.WPN_AREA_MAX, TOP_NDC: C.TOP_NDC, DEV_AREA_MAX: C.DEV_AREA_MAX, WPN_BOX_MAX: C.WPN_BOX_MAX, VP_TOL_DEG: C.VP_TOL_DEG, VP_Z: C.VP_Z, PART_AREA_MAX: C.PART_AREA_MAX, HUD_F: HUD_BOTTOM_F, GRID_NDC: GRID } };
  for (const [id, ch] of Object.entries(CHARACTERS)) {
    if (ONLY && !ONLY.includes(id)) continue;
    const kind = charKind(id);
    const forms = kind === 'morph' ? ['ground', 'air'] : ['-'];
    for (const form of forms) {
      const row = { id, kind, form, err: null, parts: [] };
      try {
        const c = Object.create(BattleClient.prototype);
        c.side = ch.side === 'MERC' ? 'STEEL' : ch.side;
        c.ch = id;
        c.heroKind = kind;
        c.isDrone = kind === 'drone';
        c.isMorph = kind === 'morph';
        c.flight = form === 'air';
        c.wdef = {};
        c.aiming = false;
        c.baseFov = FOV;
        c.scene = new THREE.Scene();
        c.camera = new THREE.PerspectiveCamera(FOV, ASPECT, 0.5, 4000);
        c._buildCockpit();
        if (c.isMorph) c._syncCockpitWeapon();
        c.camera.updateMatrixWorld(true);

        const gun = c.isMorph ? (form === 'air' ? c._gunA : c._gunG) : c.gunGroup;
        row.all = shoot(c.scene, c.camera);
        const top = c.cockpit.children;
        let restore = isolate(top, (o) => o === c.gunGroup);
        row.wpn = shoot(c.scene, c.camera);
        restore();
        restore = isolate(top, (o) => o !== c.gunGroup);
        row.str = shoot(c.scene, c.camera);
        restore();

        // ④ 消失點:每具武裝**一條**砲管軸線(量體中心 → 離中心最遠的槍口)vs「量體中心 → 消失點」。
        // 一具一條(不是一槽一條):同型雙模的兩個膛口在同一條軸線上一前一後,分槽量會把後者判成 180°。
        const mset = (c.isMorph && form === 'air') ? c._muzzles.A : c._muzzles.G;
        row.vp = [];
        for (const wrap of gun.children) {
          const t = wrap.userData?.cockWpn;
          if (!t) continue;
          const bb = new THREE.Box3().setFromObject(wrap);
          if (bb.isEmpty()) continue;
          const ctr = bb.getCenter(new THREE.Vector3());
          let axis = null, far = 1e-2;
          for (const sl of t.split('+')) {
            const mz = mset[sl];
            if (!mz) continue;
            const v = mz.clone().sub(ctr);
            if (v.length() > far) { far = v.length(); axis = v; }
          }
          if (!axis) continue;
          const to = new THREE.Vector3(0, 0, -C.VP_Z).sub(ctr).normalize();
          row.vp.push({ slot: t, deg: Math.acos(Math.max(-1, Math.min(1, axis.normalize().dot(to)))) * 180 / Math.PI });
        }

        // ③ 裝置面積:非武器頂層件的最大件 vs 最大單一武器件(bbox frac,與 _frameCockpitStruct 同度量)
        let maxWpn = 0;
        for (const w of gun.children) if (w.userData?.cockWpn) maxWpn = Math.max(maxWpn, bfrac(w));
        const structCh = [];
        for (const cc of c.cockpit.children) if (cc !== c.gunGroup && cc !== c.cockGround && cc !== c.cockAir) structCh.push(cc);
        if (c.isMorph) for (const cc of (form === 'air' ? c.cockAir : c.cockGround).children) structCh.push(cc);
        let maxDev = 0, devName = '';
        for (const cc of structCh) { const f = bfrac(cc); if (f > maxDev) { maxDev = f; devName = tag(cc); } }
        row.dev = { maxDev, maxWpn, devName };
        // 頂緣元凶(bbox 快查):非武器件 + 武器持槍機構(cockStruct)裡最高的一件
        let topPart = null, topNdc = -9;
        const scan = (o, lbl) => { const bb = new THREE.Box3().setFromObject(o); if (bb.isEmpty()) return; const zn = Math.max(0.05, Math.min(Math.abs(bb.min.z), Math.abs(bb.max.z))); const ny = bb.max.y / nH(zn); if (ny > topNdc) { topNdc = ny; topPart = lbl + tag(o); } };
        for (const cc of structCh) scan(cc, '');
        for (const w of gun.children) scan(w, w.userData?.cockWpn ? '[武器]' : w.userData?.cockStruct ? '[機構]' : '[?]');
        row.topPart = { topNdc, topPart };

        // 逐件單獨渲染(只留該件的祖先鏈與子樹,其餘全隱)。**恆量**:規則⑤「單一物件 ≤ 5%」
        // 量的就是這裡的 `cov`;--parts 只多印「侵入準星錐 / 超出上緣」的元凶明細。
        {
          const isDesc = (n, root) => { let p = n; while (p) { if (p === root) return true; p = p.parent; } return false; };
          const list = [];
          for (const o of c.cockpit.children) {
            // 容器(武裝組 / 變形雙型態組)下沉一層;變形者的 gunGroup 還要再下沉一層(_gunG/_gunA)
            if (o === c.gunGroup && c.isMorph) for (const k of o.children) for (const q of k.children) list.push({ o: q, wpn: true });
            else if (o === c.gunGroup || o === c.cockGround || o === c.cockAir) for (const k of o.children) list.push({ o: k, wpn: o === c.gunGroup });
            else list.push({ o, wpn: false });
          }
          const nodes = [];
          c.cockpit.traverse((n) => { if (n !== c.cockpit) nodes.push(n); });
          const prev = nodes.map((n) => n.visible);
          for (const { o, wpn } of list) {
            const anc = new Set();
            for (let p = o; p; p = p.parent) anc.add(p);
            let vis = true;
            for (const p of anc) if (p !== c.cockpit && !prev[nodes.indexOf(p)] && nodes.includes(p)) vis = false;
            if (!vis) continue;                                   // 該型態未啟用的件不計
            nodes.forEach((n, i) => { n.visible = anc.has(n) || isDesc(n, o) ? prev[i] : false; });
            const m = shoot(c.scene, c.camera);
            if (m.cov > 0.0005) row.parts.push({ name: tag(o), wpn, cov: m.cov, minDeg: m.minDeg, topY: m.topY, sight: m.sight });
          }
          nodes.forEach((n, i) => { n.visible = prev[i]; });
          row.parts.sort((a, b) => (a.minDeg - b.minDeg));
          row.maxPart = row.parts.reduce((m, q) => (q.cov > (m?.cov ?? -1) ? q : m), null);
        }

        // ⑨ 動畫包絡:自轉/擺動繞一圈 + 武裝的三種極端姿勢,逐姿勢渲染取最壞。
        // MUST 走**真品**那條路(`_gunLift`/`_gunDrop`/`_gunPull` + `_gunPivot` 的樞軸補償),
        // 直接寫 `gunGroup.rotation.x = LOB_SUP_MAX` 量到的是一個執行期不會出現的姿勢。
        {
          let grid = 0, top = -1.001;
          const take = () => { const m = shoot(c.scene, c.camera); grid = Math.max(grid, m.grid); top = Math.max(top, m.topY); };
          const N = 12;
          const y0 = c.cockpitSpin.map((o) => o.rotation.y);
          const f0 = c.cockpitFlap.map((f) => f.o.rotation[f.ax]);
          for (let k = 0; k < (c.cockpitSpin.length || c.cockpitFlap.length ? N : 0); k++) {
            const u = (k / N) * Math.PI * 2;
            for (const o of c.cockpitSpin) o.rotation.y = u;
            for (const f of c.cockpitFlap) f.o.rotation[f.ax] = f.base + f.amp * Math.sin(u);
            take();
          }
          c.cockpitSpin.forEach((o, i) => { o.rotation.y = y0[i]; });
          c.cockpitFlap.forEach((f, i) => { f.o.rotation[f.ax] = f0[i]; });
          const P = c._gunPivot || new THREE.Vector3();
          const pose = (want, pull, dy) => {
            const lift = Math.max(-(c._gunDrop || 0), Math.min(want, c._gunLift || 0));
            const pl = Math.min(pull, c._gunPull || 0);
            const lc = Math.cos(lift), ls = Math.sin(lift);
            c.gunGroup.rotation.x = lift;
            c.gunGroup.position.set(0, dy + P.y - (P.y * lc - P.z * ls),
              (c._gunBaseZ || 0) + pl + P.z - (P.y * ls + P.z * lc));
            take();
          };
          // 後座 / 三種填彈動作 / 榴彈超高仰角,位移各掃四格(位移最大**不是**最壞的情況)
          for (let i = 0; i <= 4; i++) {
            const pull = (0.51 * i) / 4;
            pose(0, pull, 0);
            pose(-0.5, pull, 0);
            pose(0.12, pull, -0.22);
            for (let k = 1; k <= 4; k++) pose((BALLISTIC.LOB_SUP_MAX * k) / 4 + 0.12, pull, -0.22);
          }
          pose(0, 0, 0);
          row.anim = { grid, top };
        }

        // ⑥ 狙擊模式:MUST 一塊機體零件都不出現(槍口焰預設隱形,故整幅 MUST 為 0)
        c.aiming = true;
        if (!BREAK_SCOPE) c._syncCockpitWeapon();
        row.scope = shoot(c.scene, c.camera).cov;
        // 退鏡那幾幀：`aiming` 已經翻回 false 而 fov 還在 zoomFov 往回收 ——
        // 座艙 MUST 還不能回來（回來就是被放大兩倍畫出來）。
        c.aiming = false;
        c.camera.fov = UNITS[c.heroKind]?.zoomFov ?? FOV;
        c.camera.updateProjectionMatrix();
        if (!BREAK_SCOPE) c._syncCockpitWeapon();
        row.scope = Math.max(row.scope, shoot(c.scene, c.camera).cov);
        c.camera.fov = FOV;
        c.camera.updateProjectionMatrix();
        c._syncCockpitWeapon();
      } catch (e) {
        row.err = e.message + '\n' + (e.stack || '').split('\n').slice(0, 3).join('\n');
      }
      out.rows.push(row);
    }
  }
  rt.dispose();
  rnd.dispose();
  return out;
}, { PARTS, ONLY, BREAK_SINGLE, BREAK_SCOPE, BREAK_GRID });

// ⑦ HUD 下帶 ≤ 畫面高的 1/6:逐視窗尺寸實測(量的是**變換後**的盒 = 玩家看到的那一塊)。
// MUST 量真的 DOM:高度是內容撐出來的,而「內容有幾列」逐狀態不同(爬升條 / 觀戰面板 / 僚機列)。
const hud = [];
for (const [w, h] of [[1920, 1080], [1366, 768], [960, 540]]) {
  await page.setViewportSize({ width: w, height: h });
  const r = await page.evaluate(async (BREAK_HUD) => {
    const { fitHudBand, HUD_BOTTOM_F } = await import('/public/js/game.js');
    document.getElementById('game').style.display = 'block';
    document.body.dataset.side = 'STEEL';
    // 灌**最忙**的一種內容:飛行機體(爬升條)+ 觀戰面板 + 八軌升級,少灌一列就是量到一個
    // 比實戰矮的 HUD,而規則要守的正是最忙那一刻。
    const q = (id) => document.getElementById(id);
    q('hudSideName').textContent = '鋼鐵協約 · 破陣者';
    q('squadRow').textContent = '僚機 ▮▮▮';
    q('spText').textContent = 'SP 320/320';
    q('hpText').textContent = 'HP 1480/1480';
    q('mpText').textContent = 'EN 100/100';
    q('liftBox').classList.remove('hidden');
    q('liftText').textContent = '爬升 100%';
    q('wpnName').textContent = '突擊步槍';
    q('wpnAmmo').textContent = '30/30';
    q('abSkillName').textContent = '震盪彈幕';
    q('abUltName').textContent = '軌道炮擊';
    q('abMobilName').textContent = '蓄力跳躍';
    q('moneyText').textContent = '1200';
    q('knText').textContent = '48';
    if (BREAK_HUD) document.querySelector('.hud-bottom').style.setProperty('--hud-k', '1');
    else fitHudBand();
    const el = document.querySelector('.hud-bottom');
    return { h: el.getBoundingClientRect().height, vh: window.innerHeight, cap: HUD_BOTTOM_F };
  }, BREAK_HUD);
  hud.push({ w, h, ...r });
}

await browser.close();

// ---------------- 報表 ----------------
const C = rep.cfg;
const pct = (v) => (v * 100).toFixed(1).padStart(5);
const X = (ok) => (ok ? ' ' : '✗');

console.log(`門檻:準星錐 ${C.SIGHT_DEG}° 淨空 / 總面積 ≤ ${(C.AREA_MAX * 100).toFixed(0)}% / 武裝 ≤ ${(C.WPN_AREA_MAX * 100).toFixed(0)}%`
  + ` / 頂緣 ≤ ${C.TOP_NDC.toFixed(3)}(HUD→準星 2/3)/ 裝置 ≤ 單一武器 / 消失點 ≤ ${C.VP_TOL_DEG}°(VP ${C.VP_Z}m)`
  + ` / **單件 ≤ ${(C.PART_AREA_MAX * 100).toFixed(0)}%** / 狙擊模式零機體零件 / **中央九宮格(±${C.GRID_NDC.toFixed(3)} NDC)淨空**`
  + ` / **動畫包絡同樣守中央格與頂緣**`);
console.log('');
console.log('id    kind   form   | 總面積  結構   武裝  | 準星錐 | 頂緣NDC | 最大裝置 | 消失點 | 最大單件 | 狙擊  | 中央格 | 動畫:格/頂緣');
console.log('-'.repeat(126));

let nbad = 0;
for (const r of rep.rows) {
  if (r.err) { console.log(`${r.id.padEnd(5)} ${r.kind.padEnd(6)} ${r.form.padEnd(6)} | 例外:${r.err}`); nbad++; continue; }
  const vpMax = r.vp.length ? Math.max(...r.vp.map((v) => v.deg)) : NaN;
  const okA = r.all.cov <= C.AREA_MAX, okW = r.wpn.cov <= C.WPN_AREA_MAX;
  const okS = r.all.minDeg >= C.SIGHT_DEG, okT = r.all.topY <= C.TOP_NDC + 0.005;
  const okD = r.dev.maxDev <= C.DEV_AREA_MAX + 0.004;
  const okV = Number.isNaN(vpMax) || vpMax <= C.VP_TOL_DEG;
  const okP = (r.maxPart?.cov ?? 0) <= C.PART_AREA_MAX;         // ⑤ 單一物件 ≤ 5% 全畫面
  const okC = (r.scope ?? 0) <= 1e-6;                           // ⑥ 狙擊模式零機體零件
  const okG = (r.all.grid ?? 0) <= 1e-6;                        // ⑧ 中央九宮格淨空
  const okN = (r.anim?.grid ?? 0) <= 1e-6 && (r.anim?.top ?? -1) <= C.TOP_NDC + 0.005;   // ⑨ 動畫包絡
  if (!(okA && okW && okS && okT && okD && okV && okP && okC && okG && okN)) nbad++;
  console.log(
    `${r.id.padEnd(5)} ${r.kind.padEnd(6)} ${r.form.padEnd(6)} |`
    + ` ${pct(r.all.cov)}%${X(okA)} ${pct(r.str.cov)}% ${pct(r.wpn.cov)}%${X(okW)} |`
    + ` ${r.all.minDeg.toFixed(1).padStart(5)}°${X(okS)} |`
    + ` ${r.all.topY.toFixed(3).padStart(6)}${X(okT)} |`
    + ` ${pct(r.dev.maxDev)}%${X(okD)} |`
    + ` ${Number.isNaN(vpMax) ? '   —  ' : vpMax.toFixed(1).padStart(5) + '°' + X(okV)} |`
    + ` ${pct(r.maxPart?.cov ?? 0)}%${X(okP)} |`
    + ` ${pct(r.scope ?? 0)}%${X(okC)} |`
    + ` ${pct(r.all.grid ?? 0)}%${X(okG)} |`
    + ` ${pct(r.anim?.grid ?? 0)}% ${(r.anim?.top ?? 0).toFixed(3).padStart(6)}${X(okN)}`,
  );
  if (!okT) console.log(`        ⤷ 最高件 top=${r.topPart.topNdc.toFixed(3)}:${r.topPart.topPart}`);
  if (!okD) console.log(`        ⤷ 最大裝置件 ${pct(r.dev.maxDev)}% > ${(C.DEV_AREA_MAX * 100).toFixed(1)}%:${r.dev.devName}`);
  if (!okP) console.log(`        ⤷ 最大單件 ${pct(r.maxPart.cov)}% > ${(C.PART_AREA_MAX * 100).toFixed(1)}%:${r.maxPart.name}`);
  if (!okC) console.log(`        ⤷ 狙擊模式仍有 ${pct(r.scope)}% 的機體零件在畫面上`);
  if (!okG) console.log(`        ⤷ 畫面九宮格中央那一格被佔掉 ${pct(r.all.grid)}%(MUST 為 0)`);
  if (!okN) console.log(`        ⤷ 動起來之後破線:中央格 ${pct(r.anim.grid)}% / 頂緣 ${r.anim.top.toFixed(3)}(靜止那一幀是綠的)`);
  if (PARTS) {
    for (const p of r.parts) {
      const flagS = p.minDeg < C.SIGHT_DEG, flagT = p.topY > C.TOP_NDC, flagA = p.cov > 0.05;
      if (!(flagS || flagT || flagA)) continue;
      console.log(`        ${flagS ? '錐' : ' '}${flagT ? '頂' : ' '}${flagA ? '積' : ' '} ${p.minDeg.toFixed(1).padStart(5)}° top=${p.topY.toFixed(2).padStart(5)} 面積 ${pct(p.cov)}%  ${p.wpn ? '[武裝] ' : ''}${p.name}`);
    }
  }
}
console.log('-'.repeat(100));
let hudBad = 0;
console.log('');
console.log(`HUD 下帶高度(上限 = 畫面高 × ${rep.cfg.HUD_F.toFixed(4)} = 1/6):`);
for (const r of hud) {
  const frac = r.h / r.vh, ok = frac <= r.cap + 1e-3;
  if (!ok) hudBad++;
  console.log(`  ${String(r.w).padStart(4)}×${String(r.h).padStart(4)}  ${r.h.toFixed(1).padStart(6)}px / ${String(r.vh).padStart(4)}px = ${(frac * 100).toFixed(1).padStart(5)}%${X(ok)}`);
}
console.log('-'.repeat(126));
console.log(nbad === 0 && hudBad === 0 ? '全數合規 ✔' : `${nbad}/${rep.rows.length} 項不合規` + (hudBad ? ` + HUD ${hudBad}/${hud.length} 個視窗尺寸超線` : ''));
process.exit(nbad === 0 && hudBad === 0 ? 0 : 1);
