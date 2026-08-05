// ============ 3D 零件對照台(臨時工具;dev-only,不進遊戲)============
// 使用者需求(2026-08-05):「在設定頁面另外建立 docs/ai3d_runbook.md 生成的 3D 物件與原版
// 3D 物件比較的工具,須說明使用哪個生成方法與 img,操作比照生圖對照台」。
//
// 這是 `tools/codex_review.mjs`(2D 生圖對照台)的 3D 版本,同一套邊界、同一套操作:
//   ① **住 `tools/` 不住 `public/`** —— `build_solo.mjs` 是把 `public/**` 整包複製出貨的;
//      頁面由這支自己的 dev server 供應,`server/server.js` 一行都不動。
//   ② **唯讀遊戲資料** —— 頁面 import 的是真品 `beacons.js`/`partlib.js`/`toon.js`,
//      覆核結果只寫 `tools/parts_review/state.json`(本工具自己的檔)。
//   ③ **配對是推導的、缺的不准藏** —— 「有哪些 AI 生成物」由**消費端零件表**(beacons.js 的
//      `['lib', …]` 描述子)與 **GLB 節點**兩邊推導,來源帳 `tools/ai3d/parts_manifest.json`
//      只是掛上去的說明。三種缺口一律列出來:缺件(描述子指到不存在的節點 ⇒ 執行期整件走
//      fallback)、孤兒(GLB 裡有、沒人用)、**未記載來源**(有生成物、沒有帳 ⇒ 說不出方法與圖)。
//
// 「原版 vs 生成」怎麼取,取決於方法分流(`provenance.METHODS[].kind`):
//   - `glb`   兩條路徑執行期同時存在:**不載零件庫** = 保險絲 primitive(原版),**載了** = GLB。
//             頁面 MUST 先把原版建完才 `loadPartLibs()`(詳見 review.js 的開機順序註解)。
//   - `parts` 生成物就是零件表本身,執行期沒有第二份 ⇒ 原版來自 `baseline.rev`:本檔以
//             `git show <rev>:public/js/beacons.js` 供應那一版模組,由**那一版自己的
//             `buildBeacon`** 建原版 —— 對照台裡不會有第二套組裝器(抄一套 = 原版是假的)。
//
// 跑法:
//   node tools/parts_review.mjs            # 起 dev server(預設 :8622)
//   node tools/parts_review.mjs --report   # 不開瀏覽器,直接印對照表(方法/來源圖/缺口)
//   node tools/parts_review.mjs --port 9001 --photos <某個 tools/ai3d 目錄>
//
// A2:零 npm 依賴(node:http/fs/path/child_process);three 仍走 CDN importmap,與遊戲同一版。
import { createServer } from 'node:http';
import { execFileSync } from 'node:child_process';
import { readFile, writeFile, mkdir, stat } from 'node:fs/promises';
import { existsSync, readFileSync } from 'node:fs';
import { extname, join, normalize, resolve, sep } from 'node:path';
import { pathToFileURL } from 'node:url';
import { ROOT } from './audit_src.mjs';
import {
  beaconsPure, beaconsSrc, partLibs, libDescs, bioLibDescs, megaLibDescs, fbEnvelope,
  parseGlb, nodeExtent, glbPath, triBudget,
} from './ai3d/parts_src.mjs';
import { METHODS, loadProvenance, photoRoots, resolvePhoto } from './ai3d/provenance.mjs';

const STATE_FILE = join(ROOT, 'tools', 'parts_review', 'state.json');

/** 這支自己的預設埠 —— **它是這個數字的唯一真相**(同 codex_review:`dev_supervisor` MUST import) */
export const DEFAULT_PORT = 8622;

const argv = process.argv.slice(2);
const arg = (k, d = null) => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : d; };

// ---- 對照表(伺服器端推導;頁面只負責畫)---------------------------------
/**
 * 一列 = 一個「AI 生成的 3D 物件」。列由**程式碼**推導(lib 描述子 ∪ GLB 節點 ∪ 來源帳的
 * 純資料件),來源帳只是掛上去 —— 反過來以帳為準的話,一顆沒記帳的石頭就整個消失了(邊界 ③)。
 */
export function manifest(items = {}, photosOpt = null) {
  const prov = loadProvenance();
  const roots = photoRoots(photosOpt);
  const budget = triBudget();
  const B = beaconsPure(beaconsSrc());
  // 三個消費端:beacons(地標,`['lib', …]` 描述子)+ biomes 宣告式零件表(植被/神木,`lib:` 欄)
  // + biomes 命令式巨岩(`MEGA_LIB` 名冊 + `megaGeo` 呼叫點守衛)。少收哪一邊,那一邊的生成物
  // 就整批從台上消失 —— 而「台上沒有」看起來跟「還沒做」一模一樣(邊界 ③),更糟的是它會被
  // 算進**孤兒節點**:台子會說「這顆沒人用」,而它其實正在每一顆巨岩上。
  const descs = [
    ...libDescs(B.KIND_PARTS).map((d) => ({ ...d, builder: 'beacon' })),
    ...bioLibDescs().rows.map((d) => ({ ...d, builder: 'veg' })),
    ...megaLibDescs().rows.map((d) => ({ ...d, builder: 'mega' })),
  ];
  const libs = partLibs();

  // 逐族解析 GLB(不存在/壞掉不是例外:那正是要顯示的事實)
  const families = new Map();   // family → { path, nodes: Map|null, error }
  for (const fam of new Set([...libs, ...descs.map((d) => d.family)])) {
    const p = glbPath(fam);
    if (!existsSync(p)) { families.set(fam, { path: p, nodes: null, error: 'GLB 不存在(整族走保險絲)' }); continue; }
    try { families.set(fam, { path: p, nodes: parseGlb(p), error: null }); }
    catch (e) { families.set(fam, { path: p, nodes: null, error: `GLB 解析失敗:${e.message}` }); }
  }

  const imgOut = (key) => (prov.byKey.get(key)?.imgs || []).map((im, i) => {
    const hit = resolvePhoto(im.file, roots);
    return { ...im, has: !!hit, url: hit ? `/api/img?key=${encodeURIComponent(key)}&i=${i}` : null };
  });

  const rows = [];
  const seenNodes = new Set();   // `${family}/${node}` — 用來算孤兒

  // ── (A) 每一個 lib 描述子指到的節點 ────────────────────────────────────
  const byName = new Map();
  for (const d of descs) {
    if (!byName.has(d.name)) byName.set(d.name, []);
    byName.get(d.name).push(d);
  }
  for (const [name, ds] of byName) {
    const d0 = ds[0];
    const fam = families.get(d0.family);
    const node = fam?.nodes?.get(d0.node) || null;
    seenNodes.add(name);
    const env = fbEnvelope(d0.fb);
    const mea = node ? nodeExtent(node) : null;
    const p = prov.byKey.get(name) || null;
    rows.push({
      key: name,
      title: name,
      family: d0.family,
      node: d0.node,
      method: p ? (METHODS[p.method] || { key: p.method, label: `未知方法「${p.method}」`, kind: 'glb', short: '?' }) : null,
      prov: p,
      imgs: imgOut(name),
      consumer: ds.map((x) => `${x.kind}[${x.index}]`).join('、'),
      // 對照的兩側:左 = 原版(保險絲 primitive),右 = AI 生成(GLB)。
      // `builder` 決定由**誰的**建構器建 —— beacons 的 buildBeacon / biomes 的 buildVegMeshes,
      // 兩者都是遊戲自己那一支(台上沒有第二套組裝器,紀律 ①)
      view: { mode: 'fuse-vs-lib', builder: d0.builder, kind: d0.kind, node: d0.node, fb: d0.fb, at: d0.p },
      missing: !node,
      glbPath: fam ? fam.path.replace(ROOT + sep, '') : null,
      glbError: fam?.error || null,
      measured: mea,
      env,
      pct: mea ? mea.rMax / env.r : null,
      budget: budget
        ? {
          cap: budget.capOf(d0.family), what: budget.whatOf(d0.family),
          // 逐株(逐款)閘:單件合格 ≠ 整株合格(tree 族 justification)
          kind: budget.kindCap(d0.family, d0.kind),
        }
        : null,
      item: items[name] || null,
    });
  }

  // ── (B) 純資料件(生成物 = 零件表本身;原版來自 baseline rev)────────────
  for (const p of prov.parts) {
    if (METHODS[p.method]?.kind !== 'parts') continue;
    const kind = p.key.startsWith('beacon/') ? p.key.slice('beacon/'.length) : null;
    const now = kind && B.KIND_PARTS[kind]
      ? { parts: B.KIND_PARTS[kind].length, foot: B.BEACON_KINDS[kind]?.foot ?? null, extent: +B.kindExtent(kind).toFixed(3) }
      : null;
    let base = null, baseErr = null;
    if (p.baseline?.rev && kind) {
      try {
        const bs = beaconsPure(gitShow(p.baseline.rev));
        base = bs.KIND_PARTS[kind]
          ? { parts: bs.KIND_PARTS[kind].length, foot: bs.BEACON_KINDS[kind]?.foot ?? null, extent: +bs.kindExtent(kind).toFixed(3) }
          : null;
        if (!base) baseErr = `${p.baseline.rev} 的零件表裡沒有 ${kind}`;
      } catch (e) { baseErr = `取不到 ${p.baseline.rev} 的 beacons.js:${e.message}`; }
    }
    rows.push({
      key: p.key,
      title: kind ? `${kind}(${p.consumer || ''})` : p.key,
      family: null,
      node: null,
      method: METHODS[p.method],
      prov: p,
      imgs: imgOut(p.key),
      consumer: p.consumer || '',
      view: p.baseline?.rev && kind && !baseErr
        ? { mode: 'baseline-vs-now', kind, rev: p.baseline.rev }
        : { mode: 'now-only', kind },
      missing: !now,
      now,
      base,
      baseErr,
      item: items[p.key] || null,
    });
  }

  // ── 缺口三種,一種都不准藏 ─────────────────────────────────────────────
  const orphans = [];
  for (const [fam, f] of families) {
    for (const n of f.nodes?.keys() || []) {
      if (!seenNodes.has(`${fam}/${n}`)) {
        const e = nodeExtent(f.nodes.get(n));
        orphans.push({ name: `${fam}/${n}`, tris: e.tris, rMax: +e.rMax.toFixed(3) });
      }
    }
  }
  const undocumented = rows.filter((r) => !r.prov).map((r) => r.key);
  const missing = rows.filter((r) => r.missing).map((r) => r.key);

  rows.sort((a, b) => (a.key < b.key ? -1 : 1));
  return {
    rows,
    orphans,
    undocumented,
    missing,
    issues: prov.issues,
    libs,
    photoRoots: roots.map((r) => r.replace(ROOT + sep, '') || r),
    methods: Object.values(METHODS),
  };
}

/** 舊版原文(給 `parts` 方法的「原版」那一半);rev 一律白名單過濾,見 `revAllowed` */
function gitShow(rev) {
  if (!/^[0-9a-f]{7,40}$/.test(rev)) throw new Error('rev 格式不合法');
  return execFileSync('git', ['show', `${rev}:public/js/beacons.js`],
    { cwd: ROOT, encoding: 'utf8', maxBuffer: 8 << 20 }).replace(/\r\n?/g, '\n');
}

/** 只有**來源帳裡記著的** rev 才供應得出來(參數零信任,同 dev_supervisor 邊界 ③) */
function revAllowed(rev) {
  return loadProvenance().parts.some((p) => p.baseline?.rev === rev);
}

// ---- 覆核狀態(本工具自己的檔)---------------------------------------------
async function loadState() {
  try { return JSON.parse(await readFile(STATE_FILE, 'utf8')); }
  catch { return { version: 1, items: {} }; }
}
async function saveState(s) {
  await mkdir(join(ROOT, 'tools', 'parts_review'), { recursive: true });
  await writeFile(STATE_FILE, `${JSON.stringify(s, null, 2)}\n`);
}

// ---- --report:不開瀏覽器的對照表 -------------------------------------------
async function report() {
  const st = await loadState();
  const m = manifest(st.items, arg('--photos'));
  console.log('3D 零件對照台 — 對照表');
  console.log(`  零件庫家族  [${m.libs.join(', ') || '空'}];照片探測路徑 ${m.photoRoots.length} 個`);
  for (const r of m.rows) {
    const meth = r.method ? `${r.method.short}` : '⚑ 未記載來源';
    const img = r.imgs.length
      ? r.imgs.map((i) => `${i.id}${i.has ? '' : '(原圖不在本機)'}`).join('、')
      : '(無)';
    const st2 = r.item?.status ? ` [${r.item.status}]` : '';
    console.log(`\n  ${r.key}${st2}`);
    console.log(`    方法  ${meth}${r.method ? ` — ${r.method.label}` : ''}`);
    console.log(`    來源圖 ${img}`);
    console.log(`    消費端 ${r.consumer || '—'}`);
    if (r.measured) {
      console.log(`    實測  ${r.measured.tris} tris ・ 水平徑向 ${r.measured.rMax.toFixed(3)}`
        + ` / fallback ${r.env.r.toFixed(3)}(${(r.pct * 100).toFixed(0)}%)`);
    }
    if (r.now) console.log(`    件數  原版 ${r.base ? r.base.parts : '?'} → 現行 ${r.now.parts}${r.baseErr ? `(${r.baseErr})` : ''}`);
    if (r.missing) console.log('    ❌ 缺件:執行期整件走 fallback');
  }
  console.log(`\n  缺件    ${m.missing.length}${m.missing.length ? `:${m.missing.join('、')}` : ''}`);
  console.log(`  孤兒節點 ${m.orphans.length}${m.orphans.length ? `:${m.orphans.map((o) => o.name).join('、')}` : ''}`);
  console.log(`  未記載來源 ${m.undocumented.length}${m.undocumented.length ? `:${m.undocumented.join('、')}` : ''}`);
  for (const i of m.issues) console.log(`  ${i.level === 'err' ? '❌' : '⚠'} ${i.msg}`);
}

// ---- dev server ------------------------------------------------------------
const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.png': 'image/png', '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.svg': 'image/svg+xml', '.glb': 'model/gltf-binary',
  '.woff2': 'font/woff2',
};

function safePath(url) {
  const p = normalize(join(ROOT, decodeURIComponent(url.split('?')[0])));
  return p.startsWith(ROOT + sep) || p === ROOT ? p : null;
}

async function serve() {
  const port = Number(arg('--port', DEFAULT_PORT));
  const photos = arg('--photos');
  const srv = createServer(async (req, res) => {
    const send = (code, body, type = 'application/json; charset=utf-8') => {
      res.writeHead(code, { 'content-type': type, 'cache-control': 'no-store' });
      res.end(body);
    };
    try {
      const u = new URL(req.url, 'http://localhost');

      if (u.pathname === '/api/parts') {
        if (req.method === 'GET') {
          const st = await loadState();
          return send(200, JSON.stringify({ ...manifest(st.items, photos), state: st }));
        }
        if (req.method === 'POST') {
          const chunks = [];
          for await (const c of req) chunks.push(c);
          const body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
          const st = await loadState();
          st.items = st.items || {};
          // 一次只覆寫一格(整份覆寫會讓兩個分頁互相蓋掉對方剛存的覆核)
          if (body.key) {
            if (body.item === null) delete st.items[body.key];
            else st.items[body.key] = { ...body.item, at: new Date().toISOString() };
          }
          await saveState(st);
          return send(200, JSON.stringify({ ok: true, items: st.items }));
        }
        return send(405, '{"error":"method"}');
      }

      // 來源圖:客戶端只送 key + 索引,路徑一律由伺服器從來源帳解析(零信任;
      // 照片住 gitignore 的資料家目錄,不在 ROOT 底下 ⇒ 走不了靜態那條路)
      if (u.pathname === '/api/img') {
        const prov = loadProvenance();
        const rec = prov.byKey.get(u.searchParams.get('key'));
        const im = rec?.imgs?.[Number(u.searchParams.get('i'))];
        const hit = im && resolvePhoto(im.file, photoRoots(photos));
        if (!hit) return send(404, 'not found', 'text/plain; charset=utf-8');
        return send(200, readFileSync(hit.path), MIME[extname(hit.path).toLowerCase()] || 'application/octet-stream');
      }

      // 舊版模組:讓「原版」那一半由**那一版自己的 buildBeacon** 建。相對 import 改指現行
      // public/js —— 只換組裝器那一支,材質/亂數/零件庫仍是同一份實例(不然兩側連燈光都不同)。
      const bm = u.pathname.match(/^\/baseline\/([0-9a-f]{7,40})\/beacons\.js$/);
      if (bm) {
        if (!revAllowed(bm[1])) return send(404, 'not found', 'text/plain; charset=utf-8');
        try {
          const src = gitShow(bm[1]).replace(/from '\.\/([\w.]+\.js)'/g, "from '/public/js/$1'");
          return send(200, src, MIME['.js']);
        } catch (e) { return send(404, `// ${e.message}`, MIME['.js']); }
      }

      let url = u.pathname;
      if (url === '/' || url === '') url = '/tools/parts_review/index.html';
      const p = safePath(url);
      if (!p) return send(403, '{"error":"path"}');
      // three 走 CDN(A2);裝了本機 three 就把 importmap 改指本機(離線/代理擋 unpkg 時仍活得下來)
      if (url.endsWith('/index.html') && existsSync(join(ROOT, 'node_modules', 'three', 'build', 'three.module.js'))) {
        const html = (await readFile(p, 'utf8'))
          .replace('https://unpkg.com/three@0.160.0/build/three.module.js', '/node_modules/three/build/three.module.js')
          .replace('https://unpkg.com/three@0.160.0/examples/jsm/', '/node_modules/three/examples/jsm/');
        return send(200, html, MIME['.html']);
      }
      const s = await stat(p).catch(() => null);
      if (!s || !s.isFile()) return send(404, 'not found', 'text/plain; charset=utf-8');
      send(200, await readFile(p), MIME[extname(p).toLowerCase()] || 'application/octet-stream');
    } catch (e) {
      send(500, JSON.stringify({ error: String(e?.message || e) }));
    }
  });
  srv.listen(port, () => {
    console.log(`3D 零件對照台 → http://localhost:${port}/`);
    console.log(`  覆核結果寫入 ${STATE_FILE.replace(ROOT + sep, '')}(記得 commit —— 容器回收後不留)`);
  });
}

// 只有「直接被執行」時才起 server —— `tools/dev_supervisor.mjs` 要 import 這一支拿 `DEFAULT_PORT`
// (埠號的單一真相縫),沒有這道閘,那支 import 會在遊戲伺服器的行程裡把對照台也一起開起來。
if (import.meta.url === pathToFileURL(resolve(process.argv[1] || '')).href) {
  if (argv.includes('--report')) await report();
  else await serve();
}
