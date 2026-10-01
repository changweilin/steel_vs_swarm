// Production browser path: real packaged priors, module worker, IndexedDB commit,
// warm reuse, version/input invalidation, partial-source recovery and storage failure.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { chromiumOrNull, chromePath, serve } from './pw.mjs';

const chromium = await chromiumOrNull();
assert(chromium, 'Map evidence browser validation requires an existing Playwright runtime');
const server = await serve();
let browser;
try {
  browser = await chromium.launch({ headless: true, executablePath: chromePath() });
  const page = await browser.newPage(), errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.route('**/main.js', r => r.fulfill({ contentType: 'text/javascript', body: '' }));
  await page.route('https://fonts.googleapis.com/**', r => r.fulfill({ contentType: 'text/css', body: '' }));
  await page.goto(server.url, { waitUntil: 'domcontentloaded' });
  const result = await page.evaluate(async () => {
    const { VENUES, venueConfig } = await import('/public/js/venues.js');
    const { battleBBox } = await import('/public/js/data.js');
    const { loadVenueEvidence, prepareMapEvidence, installMapEvidence } = await import('/public/js/mapEvidenceLoader.js');
    const { validateEvidence, evidenceChecksum } = await import('/public/js/mapEvidence.js');
    const { geoClear, geoGet, geoPut, geoKey } = await import('/public/js/geocache.js');
    await geoClear();
    const NativeWorker = Worker;
    let jobs = 0;
    globalThis.Worker = class extends NativeWorker { constructor(...args) { super(...args); jobs++; } };
    const cfg = venueConfig(VENUES[0], 1);
    const terrain = { bbox: battleBBox(cfg), sampleColor: (x, z) => [40 + Math.round(Math.abs(x) % 20), 120, 40],
      elevationAt: (x, z) => 60 + x * 0.02, sourceQuality: { imageryComplete: true, elevationComplete: true } };
    const priors = [];
    for (const venue of VENUES) priors.push(await loadVenueEvidence(venueConfig(venue, 1)));
    if (priors.some(p => !p)) throw new Error('Preset prior failed browser validation');
    const cold = await prepareMapEvidence(cfg, terrain, []), coldJobs = jobs;
    const warm = await prepareMapEvidence(cfg, terrain, []), warmJobs = jobs;
    installMapEvidence(terrain, warm);
    if (!validateEvidence(cold) || !cold.complete || cold.cacheHit || !warm.cacheHit || coldJobs !== 1 || warmJobs !== coldJobs) throw new Error('Worker/cache contract failed');
    const corrupt = structuredClone(cold); corrupt.data[0] ^= 1;
    await geoPut(geoKey('evidence', cold.version, terrain.bbox, cold.inputId), corrupt);
    const repaired = await prepareMapEvidence(cfg, terrain, []);
    if (repaired.cacheHit || repaired.checksum !== cold.checksum) throw new Error('Corrupt cache record was trusted');
    const changed = await prepareMapEvidence({ ...cfg, center: { ...cfg.center, rot: cfg.center.rot + 0.1 } }, terrain, []);
    if (changed.cacheHit || changed.inputId === cold.inputId) throw new Error('Changed frame reused old observations');
    const missing = { ...terrain, sourceQuality: { imageryComplete: false, elevationComplete: false }, sampleColor: () => null, elevationAt: () => NaN };
    const partial = await prepareMapEvidence(cfg, missing, null), partialAgain = await prepareMapEvidence(cfg, missing, null);
    if (partial.complete || partialAgain.cacheHit) throw new Error('Partial evidence poisoned the persistent cache');
    const recovered = await prepareMapEvidence(cfg, terrain, []);
    if (!recovered.cacheHit || !recovered.complete) throw new Error('Source recovery lost the complete record');
    const originalColors = terrain.sampleColor;
    terrain.sampleColor = () => [190, 30, 20];
    const updated = await prepareMapEvidence(cfg, terrain, []);
    if (updated.cacheHit || updated.inputId === cold.inputId) throw new Error('Changed source pixels reused old observations');
    terrain.sampleColor = originalColors;
    // Exercise the unchanged synchronous fallback when workers are unavailable.
    await geoClear(); globalThis.Worker = undefined;
    const fallback = await prepareMapEvidence(cfg, terrain, []);
    if (evidenceChecksum(fallback.data) !== cold.checksum) throw new Error('Worker and fallback disagree');
    // Entry eviction remains bounded, and awaiting writes means a following read sees them.
    for (let i = 0; i < 26; i++) await geoPut('evidence|test|' + i, i);
    if (await geoGet('evidence|test|0') !== null || await geoGet('evidence|test|25') !== 25) throw new Error('Cache commit/eviction failed');
    await geoClear(); globalThis.Worker = NativeWorker;
    return { presets: priors.length, coldJobs, warmJobs, corruption: true, sourceRecovery: true, fallback: true, eviction: true,
      observation: terrain.evidenceAt(0, 0) };
  });
  assert.deepEqual(errors, []);
  console.log('PASS browser map evidence:', JSON.stringify(result));
  const denied = await browser.newPage();
  await denied.addInitScript(() => { Object.defineProperty(globalThis, 'indexedDB', { value: { open() { throw new Error('Storage denied'); } } }); });
  await denied.route('**/main.js', r => r.fulfill({ contentType: 'text/javascript', body: '' }));
  await denied.route('https://fonts.googleapis.com/**', r => r.fulfill({ contentType: 'text/css', body: '' }));
  await denied.goto(server.url, { waitUntil: 'domcontentloaded' });
  const storageFailure = await denied.evaluate(async () => {
    const { prepareMapEvidence } = await import('/public/js/mapEvidenceLoader.js');
    const { VENUES, venueConfig } = await import('/public/js/venues.js');
    const { battleBBox } = await import('/public/js/data.js');
    const cfg = venueConfig(VENUES[0], 1), terrain = { bbox: battleBBox(cfg), sampleColor: () => [50, 125, 50], elevationAt: () => 100,
      sourceQuality: { imageryComplete: true, elevationComplete: true } };
    const first = await prepareMapEvidence(cfg, terrain, []), second = await prepareMapEvidence(cfg, terrain, []);
    return first.complete && second.complete && !first.cacheHit && !second.cacheHit && first.checksum === second.checksum;
  });
  assert(storageFailure, 'Denied storage must preserve usable observations without claiming a cache hit');
  await denied.close();
  console.log('PASS browser storage-denial degradation');
  if (process.argv.includes('--creation')) {
    if (process.env.THREE_CACHE) await page.route('https://unpkg.com/three@0.160.0/**', async r => {
      const relative = new URL(r.request().url()).pathname.split('three@0.160.0/')[1];
      const body = await readFile(join(process.env.THREE_CACHE, relative));
      await r.fulfill({ contentType: 'text/javascript', body, headers: { 'access-control-allow-origin': '*' } });
    });
    page.on('requestfailed', r => console.log('Creation resource failed:', r.url(), r.failure()?.errorText));
    const pngs = await page.evaluate(() => {
      const canvas = document.createElement('canvas'); canvas.width = canvas.height = 256;
      const ctx = canvas.getContext('2d');
      ctx.fillStyle = 'rgb(128,100,0)'; ctx.fillRect(0, 0, 256, 256);
      const elevation = canvas.toDataURL('image/png').split(',')[1];
      ctx.fillStyle = 'rgb(50,125,50)'; ctx.fillRect(0, 0, 256, 256);
      return { elevation, imagery: canvas.toDataURL('image/png').split(',')[1] };
    });
    await page.route('https://s3.amazonaws.com/elevation-tiles-prod/**', r => r.fulfill({ contentType: 'image/png', body: Buffer.from(pngs.elevation, 'base64'), headers: { 'access-control-allow-origin': '*' } }));
    await page.route('https://server.arcgisonline.com/**', r => r.fulfill({ contentType: 'image/png', body: Buffer.from(pngs.imagery, 'base64'), headers: { 'access-control-allow-origin': '*' } }));
    await page.route('**/api/interpreter', r => r.fulfill({ contentType: 'application/json', body: '{"elements":[]}', headers: { 'access-control-allow-origin': '*' } }));
    const creation = await page.evaluate(async () => {
      const { prepareMapCreation } = await import('/public/js/mapPreparation.js');
      const { buildTerrain } = await import('/public/js/terrain.js');
      const { VENUES, venueConfig } = await import('/public/js/venues.js');
      const { prepareMapEvidence } = await import('/public/js/mapEvidenceLoader.js');
      const cfg = venueConfig(VENUES[0], 1), progress = [];
      const created = await prepareMapCreation(cfg, label => progress.push(label));
      const sources = await buildTerrain(cfg, () => {}, { sourceOnly: true });
      if (sources.group || sources.mesh || sources.elevationAt(0, 0) !== 100) throw new Error('Source-only creation changed scene state or raw heights');
      const reused = await prepareMapEvidence(cfg, sources, []);
      if (!created.complete || !reused.cacheHit || cfg.mapEvidence.checksum !== created.checksum) throw new Error('Creation did not finish complete cached analysis');
      return { complete: created.complete, cacheHit: reused.cacheHit, rawHeight: sources.elevationAt(0, 0), progress: progress.length };
    });
    assert.deepEqual(errors, []);
    console.log('PASS browser map creation with numeric tile fixtures:', JSON.stringify(creation));
  }
} finally { await browser?.close(); server.close(); }
