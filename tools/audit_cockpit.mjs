// FPV 座艙取景稽核(CLAUDE.md §5「座艙/取景」列;2026-07-24 建立)
// 前置:伺服器在 8620 執行中(node server/server.js);Playwright 借用 mapping_elf 的安裝
// 用法:node tools/audit_cockpit.mjs [--parts] [--only s01,t03]
//
// 使用者四條取景規則(全 32 角色 × 變形者雙型態):
//  ① 視野不可妨礙視線 —— 準星錐(COCKPIT.SIGHT_DEG 半角)內 MUST 零遮擋
//  ② 手部/武器不可超出 HUD 太多 —— 武裝頂緣 MUST ≤ COCKPIT.WPN_TOP(NDC y)
//  ③ 面積不可太大 —— 座艙總遮擋 ≤ COCKPIT.AREA_MAX、武裝 ≤ COCKPIT.WPN_AREA_MAX
//  ④ 透視圖法、消失點在準星 —— 武器軸線與「武器 → 消失點」夾角 ≤ COCKPIT.VP_TOL_DEG
//
// 量測法 = 真渲染(WebGLRenderTarget 讀回 alpha),不是包圍盒近似:
// 半透明件(膜翼/槳盤)按 alpha 加權、描邊殼一併計入 —— 玩家看到多少就量到多少。
// --parts:對每個頂層座艙件單獨渲染,列出侵入準星錐 / 超出 HUD 上緣的元凶(幾何型別 + 世界座標,可直接 grep)
import { chromium } from 'file:///C:/Users/user/Documents/app/mapping_elf/node_modules/playwright/index.mjs';

const PARTS = process.argv.includes('--parts');
const onlyArg = process.argv.find((a) => a.startsWith('--only='));
const ONLY = onlyArg ? onlyArg.slice(7).split(',') : null;

// 埠可由 SVS_URL 覆寫:8620 上常常跑著**另一個 checkout**(工作區之間共用那個埠),
// 在那裡驗到的是別份程式碼而且不會報錯。
const browser = await chromium.launch();
const page = await browser.newPage();
page.on('pageerror', (e) => console.log('PAGEERROR:', e.message));
await page.goto((process.env.SVS_URL || 'http://localhost:8620'), { waitUntil: 'networkidle' });

const rep = await page.evaluate(async ({ PARTS, ONLY }) => {
  const THREE = await import('three');
  const { BattleClient, COCKPIT } = await import('/public/js/game.js');
  const { CHARACTERS, charKind } = await import('/public/js/data.js');

  const W = 640, H = 360, ASPECT = W / H;
  const FOV = 68;                       // A8:全機種 68(MUST NOT 差異化)
  const TAN_V = Math.tan((FOV / 2) * Math.PI / 180);
  const C = COCKPIT;

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
    let cov = 0, sight = 0, mid = 0, topY = -1.001, minDeg = 999;
    for (let j = 0; j < H; j++) {
      for (let i = 0; i < W; i++) {
        const a = buf[(j * W + i) * 4 + 3];
        if (a <= 10) continue;
        const w = a / 255;
        cov += w;
        const d = DEG[j * W + i];
        if (d < minDeg) minDeg = d;
        if (d <= C.SIGHT_DEG) sight += w;
        if (Math.abs(NDCY[j]) <= 0.45) mid += w;          // 交戰帶:畫面中央 45% 高
        if (NDCY[j] > topY) topY = NDCY[j];
      }
    }
    const N = W * H;
    return { cov: cov / N, sight: sight / N, mid: mid / N, topY, minDeg: minDeg === 999 ? 90 : minDeg };
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

  const out = { rows: [], cfg: { SIGHT_DEG: C.SIGHT_DEG, AREA_MAX: C.AREA_MAX, WPN_AREA_MAX: C.WPN_AREA_MAX, TOP_NDC: C.TOP_NDC, DEV_AREA_MAX: C.DEV_AREA_MAX, WPN_BOX_MAX: C.WPN_BOX_MAX, VP_TOL_DEG: C.VP_TOL_DEG, VP_Z: C.VP_Z } };
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

        // --parts:逐件單獨渲染(只留該件的祖先鏈與子樹,其餘全隱),揪出侵入準星錐 / 超出上緣的元凶
        if (PARTS) {
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
        }
      } catch (e) {
        row.err = e.message + '\n' + (e.stack || '').split('\n').slice(0, 3).join('\n');
      }
      out.rows.push(row);
    }
  }
  rt.dispose();
  rnd.dispose();
  return out;
}, { PARTS, ONLY });

await browser.close();

// ---------------- 報表 ----------------
const C = rep.cfg;
const pct = (v) => (v * 100).toFixed(1).padStart(5);
const X = (ok) => (ok ? ' ' : '✗');

console.log(`門檻:準星錐 ${C.SIGHT_DEG}° 淨空 / 總面積 ≤ ${(C.AREA_MAX * 100).toFixed(0)}% / 武裝 ≤ ${(C.WPN_AREA_MAX * 100).toFixed(0)}%`
  + ` / 頂緣 ≤ ${C.TOP_NDC.toFixed(3)}(HUD→準星 2/3)/ 裝置 ≤ 單一武器 / 消失點 ≤ ${C.VP_TOL_DEG}°(VP ${C.VP_Z}m)`);
console.log('');
console.log('id    kind   form   | 總面積  結構   武裝  | 準星錐 | 頂緣NDC | 最大裝置 | 消失點');
console.log('-'.repeat(100));

let nbad = 0;
for (const r of rep.rows) {
  if (r.err) { console.log(`${r.id.padEnd(5)} ${r.kind.padEnd(6)} ${r.form.padEnd(6)} | 例外:${r.err}`); nbad++; continue; }
  const vpMax = r.vp.length ? Math.max(...r.vp.map((v) => v.deg)) : NaN;
  const okA = r.all.cov <= C.AREA_MAX, okW = r.wpn.cov <= C.WPN_AREA_MAX;
  const okS = r.all.minDeg >= C.SIGHT_DEG, okT = r.all.topY <= C.TOP_NDC + 0.005;
  const okD = r.dev.maxDev <= C.DEV_AREA_MAX + 0.004;
  const okV = Number.isNaN(vpMax) || vpMax <= C.VP_TOL_DEG;
  if (!(okA && okW && okS && okT && okD && okV)) nbad++;
  console.log(
    `${r.id.padEnd(5)} ${r.kind.padEnd(6)} ${r.form.padEnd(6)} |`
    + ` ${pct(r.all.cov)}%${X(okA)} ${pct(r.str.cov)}% ${pct(r.wpn.cov)}%${X(okW)} |`
    + ` ${r.all.minDeg.toFixed(1).padStart(5)}°${X(okS)} |`
    + ` ${r.all.topY.toFixed(3).padStart(6)}${X(okT)} |`
    + ` ${pct(r.dev.maxDev)}%${X(okD)} |`
    + ` ${Number.isNaN(vpMax) ? '   —  ' : vpMax.toFixed(1).padStart(5) + '°' + X(okV)}`,
  );
  if (!okT) console.log(`        ⤷ 最高件 top=${r.topPart.topNdc.toFixed(3)}:${r.topPart.topPart}`);
  if (!okD) console.log(`        ⤷ 最大裝置件 ${pct(r.dev.maxDev)}% > ${(C.DEV_AREA_MAX * 100).toFixed(1)}%:${r.dev.devName}`);
  if (PARTS) {
    for (const p of r.parts) {
      const flagS = p.minDeg < C.SIGHT_DEG, flagT = p.topY > C.TOP_NDC, flagA = p.cov > 0.05;
      if (!(flagS || flagT || flagA)) continue;
      console.log(`        ${flagS ? '錐' : ' '}${flagT ? '頂' : ' '}${flagA ? '積' : ' '} ${p.minDeg.toFixed(1).padStart(5)}° top=${p.topY.toFixed(2).padStart(5)} 面積 ${pct(p.cov)}%  ${p.wpn ? '[武裝] ' : ''}${p.name}`);
    }
  }
}
console.log('-'.repeat(100));
console.log(nbad === 0 ? '全數合規 ✔' : `${nbad}/${rep.rows.length} 項不合規`);
process.exit(nbad === 0 ? 0 : 1);
