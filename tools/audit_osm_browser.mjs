// ============ 固定 OSM fixture 瀏覽器/WebGL 驗收 ============
// 用法：node tools/audit_osm_browser.mjs [--only shibuya_dense,roppongi_underpass]
//       [--port 8648] [--out tools/.shots/osm_browser] [--require-browser]
//
// 驗收故意走正式頁面：開房 → `main.js osmGate` → sanitize/fit/commit → `buildBiomes`
// → `BattleClient`，不在 Node 端重寫建物或道路生成器。`window.__shot` 只在 loopback
// fixture query 下出現，明確取消 rAF、顯式畫一幀，再讀真實 WebGL renderer.info。
import fs from 'node:fs';
import path from 'node:path';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromiumOrNull, chromePath, serve } from './pw.mjs';
import { loadOsmFixture } from './osm_fixture.mjs';
import { fixtureManifest, OSM_BROWSER_MANIFEST } from './osm_browser_manifest.mjs';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const arg = (key, fallback) => {
  const inline = process.argv.find((value) => value.startsWith(`${key}=`));
  if (inline) return inline.slice(key.length + 1);
  const i = process.argv.indexOf(key);
  return i >= 0 ? process.argv[i + 1] : fallback;
};
const has = (key) => process.argv.includes(key);
const onlyArg = arg('--only', '');
const names = (onlyArg ? onlyArg.split(',') : Object.keys(OSM_BROWSER_MANIFEST.fixtures))
  .map((s) => s.trim()).filter(Boolean);
const PORT = Number(arg('--port', '8648'));
const OUT = path.resolve(arg('--out', join(ROOT, 'tools', '.shots', 'osm_browser')));
const REPORT = path.resolve(arg('--json', join(OUT, 'manifest.json')));
const REQUIRE_BROWSER = has('--require-browser');
const SHOT_ROOT = path.resolve(ROOT, 'tools', '.shots');
const outFromShotRoot = path.relative(SHOT_ROOT, OUT);
const OUT_IS_SAFE = outFromShotRoot === ''
  || (!outFromShotRoot.startsWith(`..${path.sep}`) && outFromShotRoot !== '..' && !path.isAbsolute(outFromShotRoot));
const OUTPUT_DIR = OUT_IS_SAFE ? path.relative(ROOT, OUT).replaceAll(path.sep, '/') : null;
const report = {
  schema: 'osm-browser-audit-v1',
  evidenceKind: 'browser-webgl-renderer-info',
  generatedAt: new Date().toISOString(),
  requireBrowser: REQUIRE_BROWSER,
  fixtures: {},
  browserDrawCalls: { status: 'unverified', reason: null },
  outputDir: OUTPUT_DIR,
  errors: [],
};

function writeReport() {
  fs.mkdirSync(path.dirname(REPORT), { recursive: true });
  fs.writeFileSync(REPORT, JSON.stringify(report, null, 2));
}

function fail(message) {
  report.errors.push(String(message));
  console.error(`✗ ${message}`);
}

function validateManifest() {
  let ok = true;
  for (const name of names) {
    const spec = fixtureManifest(name);
    const fixture = loadOsmFixture(name);
    if (!spec) { fail(`fixture ${name} 不在固定鏡位名冊`); ok = false; continue; }
    if (!fixture) { fail(`fixture ${name} 不存在或 version 不符`); ok = false; continue; }
    if (fixture.venue?.id !== spec.venue || Number(fixture.team) !== spec.teamSize) {
      fail(`fixture ${name} venue/team 與名冊不符`); ok = false;
    }
    report.fixtures[name] = {
      status: 'pending', fixture: name, venue: spec.venue, teamSize: spec.teamSize,
      shots: spec.shots.map((s) => ({ id: s.id, status: 'pending' })),
    };
  }
  return ok;
}

async function captureFixture(page, name, spec, outputDir) {
  const row = report.fixtures[name];
  row.status = 'running';
  await page.waitForFunction(() => !!window.__scene?.battle && typeof window.__shot === 'function', null,
    { timeout: 120000 });
  await page.waitForFunction(() => window.__SVS?.devOsm?.status === 'fitted', null,
    { timeout: 120000 });
  // 錨點到世界座標的轉換必須在頁面內完成：`projectLL`/terrain 高度都是 production runtime
  // 的同一份資料，Node 端不另抄投影或高程公式。
  const derived = await page.evaluate((shotRows) => {
    const s = window.__scene, cfg = s.cfg;
    const ll = (v) => s.projectLL(v[0], v[1]);
    const anchorOf = (name) => {
      if (name === 'center') return ll([cfg.center.lat, cfg.center.lng]);
      if (name === 'swarmBase' || name === 'steelBase') return ll(cfg.bases[name === 'swarmBase' ? 'SWARM' : 'STEEL']);
      if (name === 'laneMid') { const r = cfg.lanes?.[0] || []; return r.length ? ll(r[Math.floor((r.length - 1) / 2)]) : [0, 0]; }
      if (name === 'tunnelMid') {
        const t = (s.terrain.tunnels || []).find((v) => v && v.open !== true && Number.isFinite(v.x1) && Number.isFinite(v.x2)
          && Number.isFinite(v.z1) && Number.isFinite(v.z2));
        if (!t) throw new Error('固定鏡位要求 production runtime 產生地下道，但沒有可用 tunnel segment');
        return [(t.x1 + t.x2) / 2, (t.z1 + t.z2) / 2];
      }
      throw new Error(`未知鏡位錨點 ${name}`);
    };
    const floorAt = (p, tunnel) => {
      const t = tunnel ? s.terrain.tunnelAt?.(p[0], p[1]) : null;
      const h = Number.isFinite(t?.floor) ? t.floor : s.terrain.heightAt?.(p[0], p[1]);
      return Number.isFinite(h) ? h : 0;
    };
    return shotRows.map((shot) => {
      const a = anchorOf(shot.anchor), t = anchorOf(shot.target);
      let dx = t[0] - a[0], dz = t[1] - a[1], n = Math.hypot(dx, dz);
      if (!(n > 1e-6)) { const sw = anchorOf('swarmBase'), st = anchorOf('steelBase'); dx = st[0] - sw[0]; dz = st[1] - sw[1]; n = Math.hypot(dx, dz); }
      if (!(n > 1e-6)) { dx = 0; dz = -1; n = 1; }
      dx /= n; dz /= n;
      const px = a[0] - dx * shot.back - dz * shot.lateral, pz = a[1] - dz * shot.back + dx * shot.lateral;
      const tunnel = shot.anchor === 'tunnelMid' || shot.target === 'tunnelMid';
      const py = floorAt([px, pz], tunnel) + shot.eye, ty = floorAt(t, shot.target === 'tunnelMid') + shot.targetEye;
      return { ...shot, options: { pos: [px, py, pz], target: [t[0], ty, t[1]] }, derived: { anchor: a, target: t, position: [px, py, pz], lookAt: [t[0], ty, t[1]] } };
    });
  }, spec.shots);
  const results = [];
  for (const shot of derived) {
    const shotName = `${name}_${shot.id}`;
    const result = await page.evaluate(async ({ shotName, options, viewport }) =>
      window.__shot(shotName, viewport.width, viewport.height, options),
    { shotName, options: { ...shot.options, outputDir }, viewport: OSM_BROWSER_MANIFEST.viewport });
    results.push({ id: shot.id, ...result, derived: shot.derived });
  }
  const evidence = await page.evaluate(() => {
    const s = window.__scene, t = s.terrain, r = s.renderer;
    return {
      fixture: window.__SVS.devOsm,
      sceneChildren: s.scene?.children?.length || 0,
      blockers: t.blockers?.length || 0, tunnels: t.tunnels?.length || 0, decks: t.decks?.length || 0,
      rendererInfo: {
        calls: Number(r.info.render?.calls || 0), triangles: Number(r.info.render?.triangles || 0),
        points: Number(r.info.render?.points || 0), lines: Number(r.info.render?.lines || 0),
      },
      glError: Number(r.getContext()?.getError?.() || 0),
    };
  });
  row.status = results.every((x) => x.drawCalls > 0) && evidence.glError === 0 ? 'verified' : 'failed';
  row.evidence = evidence;
  row.shots = results;
  if (row.status !== 'verified') throw new Error(`${name} drawCalls/WebGL 驗收失敗`);
  console.log(`✓ ${name}: ${results.map((x) => `${x.id}=${x.drawCalls}`).join('、')} draw calls`);
}

async function main() {
  if (!names.length) fail('--only 不得為空');
  if (!OUT_IS_SAFE) {
    fail('--out 必須位於 tools/.shots/ 下，避免 dev 截圖路由寫出固定產物根目錄');
    writeReport(); process.exitCode = 1; return;
  }
  fs.mkdirSync(OUT, { recursive: true });
  if (!validateManifest()) { writeReport(); process.exitCode = 1; return; }

  const chromium = await chromiumOrNull();
  if (!chromium) {
    report.browserDrawCalls = {
      status: 'unverified', reason: '找不到 Playwright/chromium；固定 OSM WebGL 未驗。',
      contract: REQUIRE_BROWSER ? '--require-browser 已要求瀏覽器，故以非零退出。' : '本命令固定以非零退出，避免把未驗當綠燈。',
    };
    for (const row of Object.values(report.fixtures)) {
      row.status = 'unverified';
      for (const shot of row.shots || []) {
        shot.status = 'unverified';
        shot.reason = '找不到 Playwright/chromium；未執行瀏覽器單幀 WebGL render。';
      }
    }
    writeReport();
    console.error(`✗ browser drawCall 未驗：找不到 Playwright/chromium（報告 ${REPORT}）`);
    process.exitCode = 1;
    return;
  }

  let srv = null, browser = null;
  try {
    srv = await serve(PORT);
    // `pw.mjs::serve()` 可沿用同埠既有遊戲頁；先確認它也是本輪帶 fixture
    // route 的 dev server，避免把 cloud/舊版頁面當成驗收目標而產生假證據。
    const probe = await fetch(new URL(`__osm_fixture/${encodeURIComponent(names[0])}`, srv.url), {
      headers: { 'x-dev-tools': '1' }, signal: AbortSignal.timeout(5000),
    });
    await probe.body?.cancel();
    if (!probe.ok) throw new Error(`驗收埠沒有可用的 dev fixture route(${probe.status})`);
    browser = await chromium.launch({
      executablePath: chromePath(),
      args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox'],
    });
    const page = await browser.newPage({ viewport: OSM_BROWSER_MANIFEST.viewport });
    page.on('pageerror', (e) => fail(`pageerror: ${e.message.slice(0, 300)}`));
    const localThree = [process.env.THREE_DIR, join(ROOT, 'node_modules', 'three')]
      .filter(Boolean).find((d) => fs.existsSync(join(d, 'build', 'three.module.js')));
    if (localThree) {
      await page.route('**/three@0.160.0/build/three.module.js', (r) => r.fulfill({
        status: 200, contentType: 'text/javascript',
        body: fs.readFileSync(join(localThree, 'build', 'three.module.js'), 'utf8'),
      }));
      await page.route('**/three@0.160.0/examples/jsm/**', (r) => {
        const rel = r.request().url().split('/examples/jsm/')[1].split('?')[0];
        const file = join(localThree, 'examples', 'jsm', rel);
        return fs.existsSync(file) ? r.fulfill({ status: 200, contentType: 'text/javascript', body: fs.readFileSync(file, 'utf8') }) : r.abort();
      });
    }
    for (const name of names) {
      const spec = fixtureManifest(name);
      const row = report.fixtures[name];
      try {
        await page.addInitScript(({ venue, teamSize }) => {
          localStorage.clear(); sessionStorage.clear();
          localStorage.setItem('svs_link_mode', 'lan');
          localStorage.setItem('svs_name', 'OSM 瀏覽器驗收');
          localStorage.setItem('svs_prefs', JSON.stringify({ teamSize, lastVenueId: venue, lastSide: 'SWARM' }));
        }, { venue: spec.venue, teamSize: spec.teamSize });
        await page.goto(`${srv.url}public/?mode=lan&osmFixture=${encodeURIComponent(name)}`, { waitUntil: 'domcontentloaded' });
        await page.waitForFunction(() => !!window.__SVS, null, { timeout: 30000 });
        await page.locator('#openRoomBtn').click();
        await page.waitForFunction(() => document.getElementById('openroom')?.style.display !== 'none', null, { timeout: 10000 });
        await page.waitForFunction(() => !document.getElementById('createRoomBtn')?.disabled, null, { timeout: 30000 });
        await page.locator('#createRoomBtn').click();
        await page.waitForFunction(() => window.__SVS?.lobby?.phase === 'room' && window.__SVS.isHost, null, { timeout: 30000 });
        await page.waitForFunction(() => !!window.__SVS?.lobby?.clients?.find((c) => c.id === window.__SVS.youId)?.side, null, { timeout: 30000 });
        await page.locator('#readyBtn').click();
        await page.waitForFunction(() => !!window.__SVS?.lobby?.clients?.find((c) => c.id === window.__SVS.youId)?.ready, null, { timeout: 30000 });
        await page.locator('#startBattleBtn').click();
        await captureFixture(page, name, spec, OUTPUT_DIR);
      } catch (e) {
        row.status = 'failed'; row.error = String(e?.message || e); fail(`${name}: ${row.error}`);
      }
      // 每個 fixture 需從乾淨的 production page 開始；同分頁重用會保留 OSM store/房間狀態。
      if (names.indexOf(name) !== names.length - 1) await page.goto('about:blank');
    }
    report.browserDrawCalls.status = Object.values(report.fixtures).every((x) => x.status === 'verified') ? 'verified' : 'failed';
  } catch (e) {
    report.browserDrawCalls = { status: 'unverified', reason: String(e?.message || e) };
    fail(`瀏覽器啟動/驗收失敗：${e?.message || e}`);
  } finally {
    await browser?.close().catch(() => {});
    srv?.close?.();
  }
  writeReport();
  console.log(`報告：${REPORT}`);
  process.exitCode = report.errors.length || report.browserDrawCalls.status !== 'verified' ? 1 : 0;
}

await main();
