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
  beaconsPure, beaconsSrc, partLibs, libDescs, bioLibDescs, megaLibDescs, bldLibDescs, fbEnvelope,
  parseGlb, nodeExtent, glbPath, triBudget,
} from './ai3d/parts_src.mjs';
import { METHODS, loadArchive, loadProvenance, partKeys, photoRoots, resolvePhoto } from './ai3d/provenance.mjs';
// 半成品判定的唯一縫(使用者 2026-08-09「零件台清掉半成品」+「不要在零件台顯示,不是刪除」)。
// 規則與兩個常數的語意見 mesh_sym.mjs 檔頭那一段;`mesh_sym --flaws` 印的就是這裡隱藏的那幾顆。
import { topoStats, nodeFlaws } from './ai3d/mesh_sym.mjs';

const STATE_FILE = join(ROOT, 'tools', 'parts_review', 'state.json');

/** 這支自己的預設埠 —— **它是這個數字的唯一真相**(同 codex_review:`dev_supervisor` MUST import) */
export const DEFAULT_PORT = 8622;

const readJson = (p, d) => { try { return JSON.parse(readFileSync(p, 'utf8')); } catch { return d; } };
/** 語料家自己的 venv(screen_mattes 吃 numpy/PIL/scipy);沒有就退回 PATH 的 python,
 *  兩者都不行時由呼叫端把錯誤原樣送到頁面 —— MUST NOT 靜靜地當成「判決存好了」 */
const venvPython = (home) => {
  const win = process.platform === 'win32';
  for (const p of [join(home || '', '.venv', win ? 'Scripts' : 'bin', win ? 'python.exe' : 'python')]) {
    if (p && existsSync(p)) return p;
  }
  return 'python';
};

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
    ...bldLibDescs().rows.map((d) => ({ ...d, builder: 'bld' })),
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

  const imgsOut = (key, imgs) => (imgs || []).map((im, i) => {
    const hit = resolvePhoto(im.file, roots);
    return { ...im, has: !!hit, url: hit ? `/api/img?key=${encodeURIComponent(key)}&i=${i}` : null };
  });
  const imgOut = (key) => imgsOut(key, prov.byKey.get(key)?.imgs);

  const rows = [];
  const seenNodes = new Set();   // `${family}/${node}` — 用來算孤兒

  // 同一件消費端由**幾顆節點**組成(推導,MUST NOT 手寫名冊)。
  //
  // 為什麼要有這一欄:2026-08-10 使用者回報「有的沒有樹根、有的只有樹根」—— 那不是破圖,
  // 是 §5z-n/o 定案的「一株 = 木質 + 葉冠兩顆節點」被單顆攤在台上看。台上一列 = 一顆節點,
  // 而**一件成品可能要好幾顆**,少了這一句就只能從畫面推測,而畫面正好長得像半成品。
  // ⚠ 兄弟有**兩種**,寫成同一句話就是騙人:①**組件**(beacons `KIND_PARTS` / biomes
  // `VEG_DEFS`·`GIANT_DEFS`)一次全部一起建,少一顆就真的少一塊 ⇒「這一顆是整件的一層」;
  // ②**輪替名冊**(`MEGA_LIB` / `BLD_LIB`)一顆節點服務一整個桶、逐座號**挑一顆**用 ⇒ 它自己
  // 就是完整的一件,兄弟是「同一格的其他款」。把 ② 講成「整件的一層」會讓人以為 mass_a 只是
  // 大樓的一層 —— 而它就是整棟。分流只認 `table`,MUST NOT 逐節點手寫名冊。
  // 鍵取 (builder, table, kind):同一張零件表、同一個型別的那幾列才是兄弟。
  const ROSTER_TABLES = new Set(['MEGA_LIB', 'BLD_LIB']);
  const sibKey = (d) => `${d.builder || d.consumer}|${d.table || ''}|${d.kind}`;
  const bySib = new Map();
  for (const d of descs) {
    if (!bySib.has(sibKey(d))) bySib.set(sibKey(d), new Set());
    bySib.get(sibKey(d)).add(d.name);
  }

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
    // 半成品:走 `mesh_sym` 那一支判定(只跑拓樸那一半 —— 鏡射殘差是 O(n²))。
    // 台上**預設不顯示**但不刪節點,遊戲照舊吃它;「半成品」分頁看得到(缺的不准藏,邊界 ③)
    const topo = node ? topoStats(node) : null;
    const flaws = topo ? nodeFlaws(topo, d0.family) : [];
    // 附註(使用者 2026-08-10:「未完成的圖加上附註」)= 三種來源合成一份,**全部推導**:
    //   ㋐ `part-of`  這一顆只是整件的一層(上面 bySib);沒有它,「只有樹根」讀起來像破圖
    //   ㋑ 量出來的缺陷(mesh_sym.nodeFlaws:破口 / 碎屑)
    //   ㋒ 人的覆核意見(state.json 的 note,例:「太薄不立體」)
    // 三者刻意分開列而不合成一句話:一顆節點可以同時「只是一層」**且**「有破口」,
    // 併成一句就得挑一個講,而挑掉的那一個正好可能是使用者要看的那一個。
    const sibs = [...(bySib.get(sibKey(d0)) || [])].filter((n) => n !== name);
    const st = items[name];
    const notes = [
      ...(sibs.length ? [ROSTER_TABLES.has(d0.table)
        ? {
          code: 'alt-of', label: '輪替名冊',
          detail: `「${d0.kind}」這一格有 ${sibs.length + 1} 顆輪替節點,逐座號挑一顆用`
            + `(其餘:${sibs.join('、')})—— 這一顆本身就是完整的一件`,
        }
        : {
          code: 'part-of', label: '整件的一層',
          detail: `這一顆是「${d0.kind}」的其中一層,同一件還有 ${sibs.join('、')}`
            + ' —— 單看這一顆本來就不是完整的一件',
        }] : []),
      ...flaws,
      ...(st?.note ? [{ code: 'review', label: '覆核意見', detail: st.note }] : []),
    ];
    rows.push({
      notes,
      siblings: sibs,
      key: name,
      title: name,
      family: d0.family,
      node: d0.node,
      method: p ? (METHODS[p.method] || { key: p.method, label: `未知方法「${p.method}」`, kind: 'glb', short: '?' }) : null,
      prov: p,
      imgs: imgOut(name),
      consumer: ds.map((x) => `${x.kind}[${x.index}]`).join('、'),
      // **單獨陳列,不並排比對**(2026-08-10 使用者定案:「只比對同源物件的新舊版本;
      // 透過 img→3D 新生成與舊物件無關,不該一起比對,各自陳列,標注繪製方法即可」)。
      //
      // 保險絲 primitive **不是這顆節點的前一版** —— 它是載入失敗時的降級路徑,兩者不同源。
      // 把它們並排會讀成「AI 版 vs 原版」,而那個「原版」從來沒有出貨過。
      // ⚠ 保險絲群組仍然**會被建出來**,但只當「換掉的是哪幾顆 mesh」的索引(取景用,
      //   見 review.js 的 sliceOf)—— 那是定位不是比對,所以它不佔一個 pane。
      // `builder` 決定由**誰的**建構器建 —— beacons 的 buildBeacon / biomes 的 buildVegMeshes,
      // 兩者都是遊戲自己那一支(台上沒有第二套組裝器,紀律 ①)
      view: { mode: 'now-only', builder: d0.builder, kind: d0.kind, node: d0.node, fb: d0.fb, at: d0.p },
      missing: !node,
      glbPath: fam ? fam.path.replace(ROOT + sep, '') : null,
      glbError: fam?.error || null,
      measured: mea,
      topo: topo && { open: topo.open, loops: topo.loops, perimF: +topo.perimF.toFixed(2), comps: topo.comps, compTris: topo.compTris.slice(0, 6) },
      flaws,
      env,
      pct: mea ? mea.rMax / env.r : null,
      budget: budget
        ? {
          // 預算依**消費角色**取(與 intake 同一條:巨岩塊走 families.megalith、建物配件桶
          // 走 families.building 的逐桶 node_caps)—— 拿檔案族當鍵會把巨岩顯示成 rock 的 1071
          cap: budget.nodeCap(d0.budgetFam || d0.family, d0.kind) ?? budget.capOf(d0.budgetFam || d0.family),
          what: budget.whatOf(d0.budgetFam || d0.family),
          // 逐株(逐款)閘:單件合格 ≠ 整株合格(tree 族 justification)
          kind: budget.kindCap(d0.family, d0.kind),
        }
        : null,
      item: items[name] || null,
      replaces: p.replaces || null,
    });
  }

  // 讀取 3D 物件資料庫索引 (out/3d_database.json)
  const db3DPath = join(ROOT, 'out', '3d_database.json');
  const db3D = existsSync(db3DPath) ? readJson(db3DPath, { items: [] }) : { items: [] };
  const db3DMap = new Map((db3D.items || []).map((it) => [it.key, it]));

  // ── (B) 純資料件與 3D 物件(生成物 = 零件表或 3D 幾何資料;原版來自 baseline rev)────────────
  for (const p of prov.parts) {
    if (METHODS[p.method]?.kind !== 'parts') continue;
    const allKeys = partKeys(p);
    const pk = allKeys.find((k) => k.startsWith('beacon/'));
    const kind = pk ? pk.slice('beacon/'.length) : null;
    const rowKey = pk || allKeys[0];
    const dbItem = db3DMap.get(rowKey) || null;

    let now = null;
    let mea = null;
    let env = null;
    let view = { mode: 'now-only', kind };

    if (kind && B.KIND_PARTS[kind]) {
      now = { parts: B.KIND_PARTS[kind].length, foot: B.BEACON_KINDS[kind]?.foot ?? null, extent: +B.kindExtent(kind).toFixed(3) };
    } else if (dbItem) {
      now = {
        parts: dbItem.bounds?.triangles || 0,
        foot: dbItem.bounds?.size || [1, 1, 1],
        extent: dbItem.bounds?.rMax || 1.0,
      };
      mea = {
        tris: dbItem.bounds?.triangles || 0,
        verts: dbItem.bounds?.vertices || 0,
        rMax: dbItem.bounds?.rMax || 1.0,
        yMin: dbItem.bounds?.min?.[1] ?? 0,
        yMax: dbItem.bounds?.max?.[1] ?? (dbItem.bounds?.size?.[1] || 1),
      };
      env = {
        r: dbItem.bounds?.rMax || 1.0,
        hy: (dbItem.bounds?.size?.[1] || 1) / 2,
      };
      view = { mode: 'now-only', builder: 'model3d', kind: rowKey, key: rowKey, modelPath: `/${dbItem.outputDir}/model.json` };
    }

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

    const title = dbItem
      ? `${dbItem.family}/${dbItem.subpart} (${dbItem.id})`
      : (kind ? `${kind}(${p.consumer || ''})` : rowKey);

    rows.push({
      key: rowKey,
      title,
      family: dbItem?.family || null,
      node: dbItem?.subpart || null,
      method: METHODS[p.method] || { key: p.method, label: p.method, short: p.method },
      prov: p,
      imgs: imgOut(rowKey),
      flaws: [],
      consumer: p.consumer || (dbItem ? `${dbItem.family} catalog` : ''),
      view: p.baseline?.rev && kind && !baseErr
        ? { mode: 'baseline-vs-now', kind, rev: p.baseline.rev }
        : view,
      missing: !now,
      measured: mea,
      env,
      bounds: dbItem?.bounds || null,
      spec: dbItem?.spec || null,
      now,
      base,
      baseErr,
      item: items[rowKey] || null,
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
  // 半成品(台上預設不顯示;判定住 mesh_sym,這裡只是把名冊帶出去給頁面與 --report)
  const wip = rows.filter((r) => r.flaws?.length).map((r) => r.key);

  // ── 封存區(判過「⊘ 移除」而撤下來的)────────────────────────────────────
  // **不是缺口而是墓碑**:節點已經不在遊戲裡、也不在來源帳裡(所以上面每一種推導都看不到它)。
  // 少了這一段,「我把它移除了」與「它從來沒存在過」在台上長得一模一樣 —— 而使用者要的正是
  // 「移除遊戲與零件台,**放到封存區**」:移掉的東西要看得到、說得出理由、找得回那張來源圖。
  const archive = loadArchive().parts.map((p) => ({
    ...p,
    key: (p.keys || [])[0] || null,
    method: METHODS[p.method] || { key: p.method, short: p.method || '?', label: `未知方法「${p.method}」` },
    imgs: imgsOut((p.keys || [])[0] || '', p.imgs),
  })).sort((a, b) => String(b.at || '').localeCompare(String(a.at || '')));

  rows.sort((a, b) => (a.key < b.key ? -1 : 1));
  return {
    rows,
    orphans,
    undocumented,
    missing,
    wip,
    archive,
    issues: prov.issues,
    checkout: checkout(),
    libs,
    photoRoots: roots.map((r) => r.replace(ROOT + sep, '') || r),
    methods: Object.values(METHODS),
  };
}

/**
 * 這座台子**正在服務哪一份 checkout**。存在的理由是一個沒有任何錯誤訊息的坑:
 * `dev_supervisor` 的 spawn 是 `{ cwd: ROOT }`,而 ROOT = 啟動它的**那支遊戲伺服器自己的**
 * 儲存庫根 ⇒ 從一支跑在舊 worktree 的遊戲按「開發工具 ▶ 啟動」,台上讀的就是那個 worktree 的
 * GLB/manifest,埠不衝突、頁面照常打得開,只是每一件都停在那個 commit(2026-08-10 實測:
 * 三支舊 server 全部少了 mass_c 與三種針葉,而使用者看到的結論是「worktree 裡調整的都沒進來」)。
 * 取不到 git 就只印路徑(原則 6:降級不例外)。
 */
function checkout() {
  const git = (args) => {
    try { return execFileSync('git', args, { cwd: ROOT, encoding: 'utf8' }).trim(); }
    catch { return null; }
  };
  return {
    root: ROOT,
    rev: git(['rev-parse', '--short', 'HEAD']),
    branch: git(['rev-parse', '--abbrev-ref', 'HEAD']),
    at: git(['log', '-1', '--format=%ad', '--date=format:%m-%d %H:%M']),
    dirty: !!git(['status', '--porcelain', '--', 'public/assets/models/parts']),
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
  const ck = m.checkout;
  console.log(`  服務中的 checkout  ${ck.root}${ck.rev ? `  ${ck.branch}@${ck.rev}(${ck.at})` : ''}`
    + `${ck.dirty ? '  ⚑ 零件庫有未 commit 的改動' : ''}`);
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
    for (const n of r.notes || []) console.log(`    附註  ${n.label}:${n.detail}`);
    if (r.measured) {
      console.log(`    實測  ${r.measured.tris} tris ・ 水平徑向 ${r.measured.rMax.toFixed(3)}`
        + ` / fallback ${r.env.r.toFixed(3)}(${(r.pct * 100).toFixed(0)}%)`);
    }
    if (r.now) console.log(`    件數  原版 ${r.base ? r.base.parts : '?'} → 現行 ${r.now.parts}${r.baseErr ? `(${r.baseErr})` : ''}`);
    if (r.flaws?.length) console.log(`    ⚑ 半成品(台上預設不顯示)${r.flaws.map((f) => `${f.label}:${f.detail}`).join(' ・ ')}`);
    if (r.missing) console.log('    ❌ 缺件:執行期整件走 fallback');
  }
  // 封存區:**MUST 印出來**。`gapsClean()` 抓的是缺件/孤兒/未記載三行,而封存刻意不是缺口
  // ⇒ 不印的話「撤下了幾顆、為什麼」在離線出口上完全看不到(而那是唯一的離線出口)。
  for (const a of m.archive) {
    console.log(`\n  ⊘ 封存 ${a.key}(${a.at || '?'})`);
    console.log(`    方法  ${a.method.short} ・ 原消費端 ${a.consumer || '—'}`);
    console.log(`    來源圖 ${(a.imgs || []).map((i) => i.id).join('、') || '(無)'}`);
    if (a.why) console.log(`    理由  ${a.why}`);
  }
  console.log(`\n  封存    ${m.archive.length}${m.archive.length ? `:${m.archive.map((a) => a.key).join('、')}` : ''}(已撤出遊戲;來源圖留著)`);
  console.log(`  半成品  ${m.wip.length}${m.wip.length ? `:${m.wip.join('、')}` : ''}（台上預設不顯示;節點仍在遊戲裡）`);
  console.log(`  缺件    ${m.missing.length}${m.missing.length ? `:${m.missing.join('、')}` : ''}`);
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

  /**
   * 「這個請求要看哪一個資料家」—— **本檔唯一一處**(三支語料 API 同吃)。
   *
   * 2026-08-11 使用者需求:「版權問題不在專案的管線也要顯示在零件台」。那一份住儲存庫之外、
   * 由 `provenance.extraHomes()` 註冊進候選清單 ⇒ 台上要挑得到它。而挑法 MUST 是**索引**:
   * 路徑一律由伺服器自己推導(同 `/api/photo` 與 `/api/screen` 的零信任),請求只能說「第幾個」。
   *
   * 沒指定 ⇒ 走 `corpusHome()` 那一份**預設挑選**(出貨家優先)—— 台上預設看到的家 MUST 等於
   * 按下「▶ 啟動」會跑的那一個,兩邊各自挑的話面板顯示 A 而迴圈跑 B,而畫面完全正常。
   * 指定了但對不上 ⇒ **回錯誤**,MUST NOT 退回預設(靜靜地換一個家 = 人眼判決落在別份語料上)。
   */
  const pickHome = async (idxRaw) => {
    const { corpusHome, corpusHomes } = await import('./ai3d/provenance.mjs');
    const homes = corpusHomes(photos);
    if (idxRaw != null && idxRaw !== '') {
      const i = Number(idxRaw);
      if (!Number.isInteger(i) || i < 0 || i >= homes.length) {
        return { error: `第 ${idxRaw} 個資料家候選不存在(清單變了?重新整理再挑一次)`, homes };
      }
      return { home: homes[i].home, idx: i, homes };
    }
    const def = corpusHome(photos);
    return { home: def, idx: Math.max(0, homes.findIndex((h) => h.home === def)), homes };
  };

  const srv = createServer(async (req, res) => {
    const send = (code, body, type = 'application/json; charset=utf-8') => {
      res.writeHead(code, { 'content-type': type, 'cache-control': 'no-store' });
      res.end(body);
    };
    try {
      const u = new URL(req.url, 'http://localhost');

      // 採集迴圈的啟停(2026-08-10 使用者需求:「設定腳本可以在零件台執行/關閉」)。
      // **掛的是 `dev_supervisor` 那一支 `handle`,不是自己寫一份**:那是全專案唯一
      // 「HTTP 進來 → spawn 行程」的閘門(loopback + 參數零信任 + CSRF 標頭三道),
      // 各寫一份 = 兩個入口兩套閘,而漏掉的那一套沒有任何錯誤訊息。
      // 這個台子是 dev-only 且只綁本機 —— 與遊戲伺服器那條路同樣的邊界(見 dev_supervisor 檔頭)。
      if (u.pathname.startsWith('/dev/tools')) {
        const sup = await import('./dev_supervisor.mjs');
        if (await sup.handle(req, res, u.pathname)) return undefined;
        return send(404, '{"error":"not found"}');
      }

      // 圖檔三態(未處理 / 已處理 / 需修正 + 已淘汰);推導縫住 tools/ai3d/photo_state.mjs,
      // 這裡只轉呼(頁面更不准自己判 —— 那會變成第六本帳)
      if (u.pathname === '/api/photos') {
        const { corpusMeta } = await import('./ai3d/provenance.mjs');
        const { photoStates, STATES } = await import('./ai3d/photo_state.mjs');
        const pick = await pickHome(u.searchParams.get('home'));
        if (pick.error) return send(404, JSON.stringify({ ok: false, why: pick.error, homes: pick.homes, rows: [], counts: {} }));
        // 這個家出不出貨 —— **一定要講**:非出貨語料(授權未確認的那一份)長得跟正式語料
        // 一模一樣,不標的話台上兩份混在一起,而人眼判決是照著台上做的。
        return send(200, JSON.stringify({
          ...photoStates(pick.home), homes: pick.homes, homeIdx: pick.idx,
          states: STATES, corpus: corpusMeta(pick.home),
        }));
      }

      // 語料原圖(還沒轉 3D 的也要看得到 —— 手動篩選就是看著圖判)。
      // **路徑一律由伺服器從帳本解析**(同 /api/img 的零信任):請求只送 id,
      // 檔名從 `entry.file` 來 —— 讓請求決定路徑等於開一個任意讀檔的洞。
      if (u.pathname === '/api/photo') {
        const home = (await pickHome(u.searchParams.get('home'))).home;
        const id = u.searchParams.get('id');
        const man = home ? readJson(join(home, 'photo_manifest.json'), []) : [];
        const e = man.find((x) => x.id === id);
        if (!e) return send(404, 'not found', 'text/plain; charset=utf-8');
        // `?t=<i>` = 切出來的第 i 個目標(那才是真的餵進生成器的東西);沒給就是母照片。
        // ⚠ `entry.matte` 是**去背的 bbox 物件**(`{wh, origin}`)不是路徑 —— 當成路徑用會
        //   `String()` 成 "[object Object]"、`existsSync` 回 false,然後安靜地退回原圖:
        //   看起來一切正常,而你以為在看去背後的樣子。matte 的路徑是**約定**的
        //   `out/matte/<族>/<零件>/<id>.png`(與 screen_mattes 的 apply_purge 同一條)。
        const ti = u.searchParams.get('t');
        const rel = ti != null
          ? e.targets?.[Number(ti)]?.file
          : [join('out', 'matte', e.family, e.part, `${e.id}.png`), e.file]
            .find((p) => existsSync(join(home, p)));
        const hit = rel && join(home, String(rel).replace(/\\/g, '/'));
        if (!hit || !existsSync(hit)) return send(404, 'not found', 'text/plain; charset=utf-8');
        return send(200, readFileSync(hit), MIME[extname(hit).toLowerCase()] || 'application/octet-stream');
      }

      // 手動篩選:人眼對**還沒轉 3D 的圖**下判決。三個出口對應 screen_mattes.py 既有的兩支
      // (`--human pass|reject` / `--purge`)—— 判決的紀律(人眼恆勝統計、roll_up 到母照片、
      // 黑名單怎麼表達)全部住那一支,這裡**只轉呼**,MUST NOT 自己改帳本(第二份實作)。
      if (u.pathname === '/api/screen' && req.method === 'POST') {
        if (req.headers['x-dev-tools'] !== '1') return send(403, '{"error":"缺少 x-dev-tools 標頭"}');
        const chunks = [];
        for await (const c of req) chunks.push(c);
        const body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
        // 判決 MUST 落在**面板正在看的那一個家**(挑法同 `/api/photos`,索引不是路徑)——
        // 這裡自己取第一個的話,在別的家上按下的「刪除來源圖」會刪到正牌語料庫那一張同名的圖
        const pick = await pickHome(body.home);
        if (pick.error) return send(404, JSON.stringify({ ok: false, error: pick.error }));
        const home = pick.home;
        const man = home ? readJson(join(home, 'photo_manifest.json'), []) : [];
        // **id 與 family 都從帳本取**,不是從請求抄過去(零信任;請求只能「挑一筆現有的」)
        const e = man.find((x) => x.id === body.id);
        if (!e) return send(404, '{"error":"帳本裡沒有這一筆"}');
        const act = { pass: ['--human', 'pass', e.id], reject: ['--human', 'reject', e.id], purge: ['--purge', e.id] }[body.act];
        if (!act) return send(400, '{"error":"只收 pass / reject / purge"}');
        const py = venvPython(home);
        try {
          const out = execFileSync(py, ['screen_mattes.py', '--home', home, '--family', e.family, ...act],
            { cwd: join(ROOT, 'tools', 'ai3d'), encoding: 'utf8', timeout: 120000 });
          return send(200, JSON.stringify({ ok: true, out: out.trim().split(/\r?\n/).slice(-4).join('\n') }));
        } catch (err) {
          return send(500, JSON.stringify({ ok: false, error: `${py}:${(err.stderr || err.message || '').toString().split(/\r?\n/).slice(-3).join(' ')}` }));
        }
      }

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

      if (u.pathname === '/api/model3d') {
        const key = u.searchParams.get('key');
        const db3DPath = join(ROOT, 'out', '3d_database.json');
        const db3D = existsSync(db3DPath) ? readJson(db3DPath, { items: [] }) : { items: [] };
        const item = db3D.items?.find((it) => it.key === key);
        if (item) {
          const modelFile = join(ROOT, item.outputDir, 'model.json');
          if (existsSync(modelFile)) {
            return send(200, readFileSync(modelFile), 'application/json; charset=utf-8');
          }
        }
        return send(404, '{"error":"model not found"}');
      }

      // 來源圖:客戶端只送 key + 索引,路徑一律由伺服器從來源帳解析(零信任;
      // 照片住 gitignore 的資料家目錄,不在 ROOT 底下 ⇒ 走不了靜態那條路)
      if (u.pathname === '/api/img') {
        const key = u.searchParams.get('key');
        // 封存的那幾件在來源帳裡已經沒有了(墓碑帳才有)⇒ 兩本都問,否則封存區那一頁
        // 的來源圖會整批變成「原圖不在本機」,而檔案其實好端端地躺在那裡
        const rec = loadProvenance().byKey.get(key) || loadArchive().byKey.get(key);
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
