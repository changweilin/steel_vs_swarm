// ============ 固定 OSM fixture 瀏覽器/WebGL 驗收 ============
// 用法：node tools/audit_osm_browser.mjs [--only shibuya_dense,roppongi_underpass]
//       [--port 8648] [--out tools/.shots/osm_browser] [--require-browser]
//
// 驗收故意走正式頁面：開房 → `main.js osmGate` → sanitize/fit/commit → `buildBiomes`
// → `BattleClient`，不在 Node 端重寫建物或道路生成器。`window.__shot` 只在 loopback
// fixture query 下出現，明確取消 rAF、顯式畫一幀，再讀真實 WebGL renderer.info。
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import net from 'node:net';
import { spawn } from 'node:child_process';
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
const BROWSER_WAIT_MS = Number(process.env.SVS_OSM_BROWSER_WAIT_MS || 120000);
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

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Playwright 不在受驗環境時，使用現有 Chrome/Edge 的 CDP 最小縫。
 * 這裡只包 Runtime/Page evaluate 與顯式 navigation；draw call 仍由頁內
 * `renderer.info.render.calls` 回報，絕不在 Node 端估算。
 */
class CdpClient {
  constructor(url, WebSocketImpl) {
    this.url = url;
    this.WebSocketImpl = WebSocketImpl;
    this.nextId = 1;
    this.pending = new Map();
    this.events = new Map();
    this.ws = null;
  }

  async connect() {
    this.ws = new this.WebSocketImpl(this.url);
    await new Promise((resolve, reject) => {
      const onOpen = () => { this.ws.off?.('error', onError); resolve(); };
      const onError = (error) => { this.ws.off?.('open', onOpen); reject(error); };
      this.ws.once('open', onOpen);
      this.ws.once('error', onError);
    });
    this.ws.on('message', (value) => {
      let message;
      try { message = JSON.parse(value.toString()); } catch { return; }
      if (message.id) {
        const waiter = this.pending.get(message.id);
        if (!waiter) return;
        this.pending.delete(message.id);
        if (message.error) waiter.reject(new Error(`${message.error.message || 'CDP error'} (${message.error.code || 'unknown'})`));
        else waiter.resolve(message.result || {});
        return;
      }
      for (const listener of this.events.get(message.method) || []) listener(message.params || {});
    });
    this.ws.on('close', () => {
      for (const waiter of this.pending.values()) waiter.reject(new Error('CDP websocket closed'));
      this.pending.clear();
    });
    return this;
  }

  on(method, listener) {
    const listeners = this.events.get(method) || [];
    listeners.push(listener);
    this.events.set(method, listeners);
  }

  send(method, params = {}) {
    if (!this.ws || this.ws.readyState !== this.WebSocketImpl.OPEN) return Promise.reject(new Error('CDP websocket 尚未連線'));
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.ws.send(JSON.stringify({ id, method, params }), (error) => {
        if (!error) return;
        this.pending.delete(id);
        reject(error);
      });
    });
  }

  async close() {
    if (!this.ws || this.ws.readyState === this.WebSocketImpl.CLOSED) return;
    this.ws.close();
    await sleep(40);
  }
}

class CdpPage {
  constructor(client) {
    this.client = client;
    this.listeners = new Map();
  }

  static async connect(url, WebSocketImpl) {
    const page = new CdpPage(await new CdpClient(url, WebSocketImpl).connect());
    await page.client.send('Runtime.enable');
    await page.client.send('Page.enable');
    page.client.on('Runtime.exceptionThrown', (event) => {
      const detail = event.exceptionDetails || {};
      const description = detail.exception?.description || detail.text || '瀏覽器頁面例外';
      page.emit('pageerror', new Error(description));
    });
    return page;
  }

  on(event, listener) {
    const listeners = this.listeners.get(event) || [];
    listeners.push(listener);
    this.listeners.set(event, listeners);
  }

  emit(event, value) {
    for (const listener of this.listeners.get(event) || []) listener(value);
  }

  async evaluate(fn, arg) {
    const source = typeof fn === 'function' ? fn.toString() : String(fn);
    const argument = arg === undefined ? '' : `(${JSON.stringify(arg)})`;
    const expression = `(${source})(${argument})`;
    const result = await this.client.send('Runtime.evaluate', {
      expression, awaitPromise: true, returnByValue: true, userGesture: true,
    });
    if (result.exceptionDetails) {
      const detail = result.exceptionDetails;
      throw new Error(detail.exception?.description || detail.text || '瀏覽器 evaluate 失敗');
    }
    return result.result?.value;
  }

  async addInitScript(fn, arg) {
    const source = typeof fn === 'function' ? fn.toString() : String(fn);
    const argument = arg === undefined ? '' : `(${JSON.stringify(arg)})`;
    await this.client.send('Page.addScriptToEvaluateOnNewDocument', {
      source: `(${source})(${argument});`,
    });
  }

  async goto(url) {
    await this.client.send('Page.navigate', { url });
    await this.waitForFunction(() => document.readyState === 'interactive' || document.readyState === 'complete', null,
      { timeout: 30000 });
  }

  async waitForFunction(fn, arg, options = {}) {
    const timeout = Number(options?.timeout || 30000);
    const deadline = Date.now() + timeout;
    let lastError = null;
    while (Date.now() < deadline) {
      try {
        if (await this.evaluate(fn, arg)) return true;
      } catch (error) { lastError = error; }
      await sleep(100);
    }
    throw new Error(`waitForFunction 超時${lastError ? `: ${lastError.message}` : ''}`);
  }

  locator(selector) {
    return {
      click: () => this.evaluate((sel) => {
        const node = document.querySelector(sel);
        if (!node) throw new Error(`找不到 DOM ${sel}`);
        if (node.disabled) throw new Error(`DOM disabled ${sel}`);
        node.click();
        return true;
      }, selector),
    };
  }

  async close() {
    await this.client.close();
  }
}

function browserExecutable() {
  const candidates = [
    process.env.PW_CHROME, process.env.CHROME_PATH, process.env.BROWSER_PATH,
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
    'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
    '/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser',
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  ].filter(Boolean);
  for (const base of [
    'C:\\Program Files\\Google\\Chrome\\Application',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application',
    'C:\\Program Files\\Microsoft\\Edge\\Application',
    'C:\\Program Files (x86)\\Microsoft\\Edge\\Application',
  ]) {
    try {
      for (const entry of fs.readdirSync(base, { withFileTypes: true })) {
        if (entry.isDirectory()) candidates.push(join(base, entry.name, base.includes('Edge') ? 'msedge.exe' : 'chrome.exe'));
      }
    } catch { /* 該平台沒有該安裝根 */ }
  }
  const helperPath = chromePath();
  if (helperPath) candidates.unshift(helperPath);
  return candidates.find((candidate) => fs.existsSync(candidate));
}

async function freeTcpPort() {
  const probe = net.createServer();
  await new Promise((resolve, reject) => {
    probe.once('error', reject);
    probe.listen(0, '127.0.0.1', resolve);
  });
  const port = probe.address().port;
  await new Promise((resolve) => probe.close(resolve));
  return port;
}

async function jsonFetch(url, options = {}) {
  const response = await fetch(url, { ...options, signal: options.signal || AbortSignal.timeout(2500) });
  const text = await response.text();
  if (!response.ok) throw new Error(`CDP HTTP ${response.status}: ${text.slice(0, 300)}`);
  return JSON.parse(text);
}

async function launchCdpBrowser() {
  const executable = browserExecutable();
  if (!executable) return null;
  const cdpPort = await freeTcpPort();
  const profile = fs.mkdtempSync(join(os.tmpdir(), 'svs-osm-cdp-'));
  const child = spawn(executable, [
    '--headless=new', '--no-sandbox', '--disable-gpu-sandbox',
    '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader',
    '--disable-dev-shm-usage', '--disable-extensions', '--disable-sync',
    '--remote-allow-origins=*', `--remote-debugging-port=${cdpPort}`,
    `--user-data-dir=${profile}`, '--window-size=1280,720', '--force-device-scale-factor=1',
    '--hide-scrollbars', 'about:blank',
  ], { cwd: ROOT, stdio: 'ignore', windowsHide: true });
  let launchError = null;
  child.once('error', (error) => { launchError = error; });
  const base = `http://127.0.0.1:${cdpPort}`;
  try {
    let target = null;
    for (let i = 0; i < 80; i++) {
      if (launchError) throw launchError;
      try {
        const rows = await jsonFetch(`${base}/json/list`);
        target = rows.find((row) => row.type === 'page' && row.webSocketDebuggerUrl);
        if (target) break;
      } catch { /* CDP 尚未起來 */ }
      await sleep(150);
    }
    if (!target) throw new Error('既有 Chrome/Edge 無法在時限內開啟 CDP');
    const wsModule = await import('ws');
    const WebSocketImpl = wsModule.WebSocket || wsModule.default;
    const page = await CdpPage.connect(target.webSocketDebuggerUrl, WebSocketImpl);
    return {
      mode: 'cdp', page, executable,
      close: async () => {
        await page.close().catch(() => {});
        if (!child.killed) child.kill();
        await sleep(100);
        try { fs.rmSync(profile, { recursive: true, force: true }); } catch { /* 盡力清理暫存 profile */ }
      },
    };
  } catch (error) {
    if (!child.killed) child.kill();
    try { fs.rmSync(profile, { recursive: true, force: true }); } catch { /* 盡力清理暫存 profile */ }
    throw new Error(`CDP 瀏覽器啟動失敗(${executable}): ${error.message}`);
  }
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
  try {
    await page.waitForFunction(() => !!window.__scene?.battle && typeof window.__shot === 'function', null,
      { timeout: BROWSER_WAIT_MS });
  } catch (error) {
    const state = await page.evaluate(() => ({
      href: location.href, readyState: document.readyState,
      svs: !!window.__SVS, phase: window.__SVS?.phase || null,
      devOsm: window.__SVS?.devOsm || null, battle: !!window.__SVS?.battle,
      scene: !!window.__scene, shot: typeof window.__shot,
      body: String(document.body?.innerText || '').slice(0, 500),
    })).catch((diagnosticError) => ({ diagnosticError: diagnosticError.message }));
    throw new Error(`${error.message}; pageState=${JSON.stringify(state)}`);
  }
  try {
    await page.waitForFunction(() => window.__SVS?.devOsm?.status === 'fitted', null,
      { timeout: BROWSER_WAIT_MS });
  } catch (error) {
    const state = await page.evaluate(() => ({
      href: location.href, devOsm: window.__SVS?.devOsm || null,
      battle: !!window.__SVS?.battle, scene: !!window.__scene,
      body: String(document.body?.innerText || '').slice(0, 500),
    })).catch((diagnosticError) => ({ diagnosticError: diagnosticError.message }));
    throw new Error(`${error.message}; fixtureState=${JSON.stringify(state)}`);
  }
  // 開戰建構子會由正式 BattleClient 啟動揭幕 wipe；等它由 production render loop
  // 完整收斂，避免第一張固定鏡位把半幅斜幕當成場景證據。若背景分頁沒有 rAF，
  // 這裡明確失敗，不以關閉 wipe 或裁圖冒充穩定畫面。
  await page.waitForFunction(() => !window.__scene?.pipeline?._wipe, null,
    { timeout: BROWSER_WAIT_MS });
  // 錨點到世界座標的轉換必須在頁面內完成：`projectLL`/terrain 高度都是 production runtime
  // 的同一份資料，Node 端不另抄投影或高程公式。
  const derived = await page.evaluate((shotRows) => {
    const s = window.__scene, cfg = s.cfg;
    const ll = (v) => s.projectLL(v[0], v[1]);
    const anchorOf = (name) => {
      if (name === 'center') return ll([cfg.center.lat, cfg.center.lng]);
      if (name === 'swarmBase' || name === 'steelBase') return ll(cfg.bases[name === 'swarmBase' ? 'SWARM' : 'STEEL']);
      if (name === 'laneMid') {
        const r = cfg.lanes?.[0] || [];
        if (!r.length) throw new Error('固定鏡位要求 production runtime 產生 lane，但沒有可用 lane');
        return ll(r[Math.floor((r.length - 1) / 2)]);
      }
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
    results.push({ id: shot.id, status: result.drawCalls > 0 && result.glError === 0 ? 'verified' : 'failed',
      ...result, derived: shot.derived });
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
  row.status = results.every((x) => x.drawCalls > 0 && x.glError === 0) && evidence.glError === 0 ? 'verified' : 'failed';
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
  let cdpBrowser = null;
  let cdpError = null;
  if (!chromium) {
    try { cdpBrowser = await launchCdpBrowser(); } catch (error) { cdpError = error; }
  }
  if (!chromium && !cdpBrowser) {
    const reason = cdpError
      ? `找不到 Playwright；既有 Chrome/Edge CDP 啟動失敗：${cdpError.message}`
      : '找不到 Playwright/chromium，也找不到可啟動的 Chrome/Edge；固定 OSM WebGL 未驗。';
    report.browserDrawCalls = {
      status: 'unverified', reason,
      contract: REQUIRE_BROWSER ? '--require-browser 已要求瀏覽器，故以非零退出。' : '本命令固定以非零退出，避免把未驗當綠燈。',
    };
    for (const row of Object.values(report.fixtures)) {
      row.status = 'unverified';
      for (const shot of row.shots || []) {
        shot.status = 'unverified';
        shot.reason = reason;
      }
    }
    writeReport();
    console.error(`✗ browser drawCall 未驗：${reason}（報告 ${REPORT}）`);
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
    if (chromium) {
      browser = await chromium.launch({
        executablePath: chromePath(),
        args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox'],
      });
    }
    const page = browser
      ? await browser.newPage({ viewport: OSM_BROWSER_MANIFEST.viewport })
      : cdpBrowser.page;
    report.browser = chromium
      ? { mode: 'playwright', executable: chromePath() || null }
      : { mode: cdpBrowser.mode, executable: cdpBrowser.executable };
    page.on('pageerror', (e) => fail(`pageerror: ${e.message.slice(0, 300)}`));
    const localThree = [process.env.THREE_DIR, join(ROOT, 'node_modules', 'three')]
      .filter(Boolean).find((d) => fs.existsSync(join(d, 'build', 'three.module.js')));
    if (localThree && typeof page.route === 'function') {
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
          // Chromium 會先在 opaque about:blank context 執行 new-document script；
          // 該 context 禁止 storage，不能讓這個開發驗收初始化噴 pageerror。
          if (location.origin === 'null') return;
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
        const state = await page.evaluate(() => ({
          href: location.href, readyState: document.readyState,
          svs: !!window.__SVS, phase: window.__SVS?.phase || null,
          devOsm: window.__SVS?.devOsm || null, battle: !!window.__SVS?.battle,
          scene: !!window.__scene, shot: typeof window.__shot,
          openRoom: document.getElementById('openroom')?.style.display || null,
          createDisabled: document.getElementById('createRoomBtn')?.disabled ?? null,
          body: String(document.body?.innerText || '').slice(0, 600),
        })).catch((diagnosticError) => ({ diagnosticError: diagnosticError.message }));
        row.status = 'failed'; row.error = `${String(e?.message || e)}; pageState=${JSON.stringify(state)}`;
        fail(`${name}: ${row.error}`);
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
    await cdpBrowser?.close().catch(() => {});
    srv?.close?.();
  }
  writeReport();
  console.log(`報告：${REPORT}`);
  process.exitCode = report.errors.length || report.browserDrawCalls.status !== 'verified' ? 1 : 0;
}

await main();
