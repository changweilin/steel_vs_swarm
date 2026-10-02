// Exercise the studio controls with captured OSM/Terrarium sources and the shipped satellite prior.
// Missing RGB remains disclosed; stale builds must never attach after leaving the tab.
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { inflateSync } from 'node:zlib';
import { serve } from '../test/architecturePreview.mjs';
import { chromiumOrNull, chromePath } from './pw.mjs';
import { ROOT } from './audit_src.mjs';
import { loadOsmFixture, loadElevationFixture, fixtureOsm, DEFAULT_ELEVATION_DIR } from './osm_fixture.mjs';

const name = process.argv[2] || 'berlin';
const fixture = loadOsmFixture(name), elevation = loadElevationFixture(name);
assert(fixture && elevation, 'Matching validated geographic fixtures required');
const chromium = await chromiumOrNull();
assert(chromium, 'Geographic review requires an existing Playwright runtime');
const out = path.join(ROOT, 'out', 'geographic_review');
await mkdir(out, { recursive: true });
const server = serve(0);
await once(server, 'listening');
const url = `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch({ headless: true, executablePath: chromePath(),
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
try {
  const page = await browser.newPage({ viewport: { width: 1600, height: 1000 }, acceptDownloads: true });
  const errors = [];
  page.on('pageerror', error => { errors.push(error.message); console.error(error.message); });
  page.on('console', message => {
    if (message.type() === 'error' && message.location().url.startsWith(url)) console.error(message.text());
  });
  const cache = process.env.THREE_CACHE || path.join(ROOT, 'out', 'forest_review');
  for (const [route, file] of [['**/three.mjs', 'three.module.js'], ['**/utils.mjs', 'utils_BufferGeometryUtils.js'],
    ['**/pass.mjs', 'postprocessing_Pass.js']]) {
    await page.route(route, async r => r.fulfill({ contentType: 'text/javascript', body: await readFile(path.join(cache, file)) }));
  }
  await page.route('**/three@0.160.0/examples/jsm/**', async r => {
    const file = r.request().url().split('/examples/jsm/')[1].split('?')[0].replaceAll('/', '_');
    await r.fulfill({ contentType: 'text/javascript', body: await readFile(path.join(cache, file)) });
  });
  const tiles = new Map();
  for (const tile of elevation.source.tiles) tiles.set(tile.url, await readFile(path.join(DEFAULT_ELEVATION_DIR, tile.path)));
  await page.route('https://s3.amazonaws.com/elevation-tiles-prod/**', r => {
    const body = tiles.get(r.request().url());
    return body ? r.fulfill({ contentType: 'image/png', body, headers: { 'access-control-allow-origin': '*' } }) : r.abort();
  });
  await page.route('https://server.arcgisonline.com/**', r => r.abort());
  await page.goto(url);
  await page.waitForSelector('body[data-ready="true"]');
  await page.evaluate(async ({ venueId, osm }) => {
    const { VENUES, venueConfig } = await import('/public/js/venues.js');
    const { battleBBox } = await import('/public/js/data.js');
    const { commitOsmIn } = await import('/public/js/biomes.js');
    const cfg = venueConfig(VENUES.find(v => v.id === venueId), 1);
    commitOsmIn(battleBBox(cfg), { feats: osm.features, roads: osm.roads });
  }, { venueId: fixture.venue.id, osm: fixtureOsm(fixture) });
  await page.click('#tab-btn-geographic');
  await page.selectOption('#geographic-venue', fixture.venue.id);
  await page.click('#btn-geographic-build');
  await page.waitForFunction(() => !document.querySelector('#btn-geographic-export').disabled, null, { timeout: 180000 });
  assert.match(await page.textContent('#geographic-status'), /部分來源缺失/);
  const download = page.waitForEvent('download', { timeout: 120000 }).then(value => ({ value }), error => ({ error }));
  await page.click('#btn-geographic-export', { timeout: 120000 });
  const file = path.join(out, name + '-scene.json');
  const downloaded = await download;
  if (downloaded.error) throw new Error(await page.textContent('#geographic-status') + '\n' + downloaded.error.message);
  await downloaded.value.saveAs(file);
  const snapshot = JSON.parse(await readFile(file, 'utf8'));
  assert.equal(snapshot.schema, 'steel-geographic-scene-v1');
  assert.equal(snapshot.metadata.elevationFallback, false);
  assert.equal(snapshot.metadata.sourceQuality.imageryComplete, false);
  assert.equal(snapshot.metadata.stats.osm, true);
  assert.equal(snapshot.metadata.stats.mapEvidence.prior, true);
  assert.equal(snapshot.metadata.stats.habitatScene.recipe, 'evidence-habitat-v2');
  assert(snapshot.meshes.length && snapshot.geometries.length);
  for (const geo of snapshot.geometries) {
    const vertices = inflateSync(Buffer.from(geo.vertices, 'base64')), indices = inflateSync(Buffer.from(geo.indices, 'base64'));
    assert.equal(vertices.length, geo.vertexCount * 12);
    assert.equal(indices.length, geo.indexCount * 4);
    for (let i = 0; i < vertices.length; i += 4) assert(Number.isFinite(vertices.readFloatLE(i)));
    assert.equal(geo.indexCount % 3, 0);
    for (let i = 0; i < indices.length; i += 4) assert(indices.readUInt32LE(i) < geo.vertexCount);
  }
  await page.screenshot({ path: path.join(out, name + '.png') });
  // A tab exit while source loading is pending invalidates the eventual commit.
  await page.click('#btn-geographic-build');
  await page.click('#tab-btn-arch');
  await page.waitForFunction(() => !document.querySelector('#btn-geographic-build').disabled, null, { timeout: 180000 });
  assert(await page.isDisabled('#btn-geographic-export'));
  assert.deepEqual(errors, []);
  await writeFile(path.join(out, name + '-report.json'), JSON.stringify({
    metadata: snapshot.metadata, geometries: snapshot.geometries.length, meshes: snapshot.meshes.length,
    instances: snapshot.meshes.reduce((n, mesh) => n + mesh.instances.length, 0), errors,
  }, null, 2) + '\n');
  console.log('PASS geographic studio:', name, snapshot.meshes.length, 'meshes');
} finally {
  await browser.close(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve));
}
