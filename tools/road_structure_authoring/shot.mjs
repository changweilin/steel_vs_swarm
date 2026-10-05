import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { chromiumOrNull, chromePath } from '../pw.mjs';
import { ROOT, readSrc, grabBlock, grabMethod } from '../audit_src.mjs';
import { makeCarvedField, TUN, BRIDGE_RISE } from '../venue_field.mjs';

const chromium = await chromiumOrNull();
assert(chromium, 'Road review requires an existing Playwright runtime');
const directory = path.join(ROOT, 'out/road_structure_review');
await mkdir(directory, { recursive: true });
const main = readSrc('public', 'js', 'main.js');
const surface = grabBlock(main, 'terrain.surfaceAt =');
const constants = ['DECK_STEP', 'DECK_MARGIN', 'DECK_UNDER', 'MAX_MECH_H', 'BLK_MARGIN'].map(name => {
  const match = new RegExp(`const ${name} = ([\\d.]+)`).exec(main);
  assert(match, `Missing production constant ${name}`); return +match[1];
});
const terrainSource = readSrc('public', 'js', 'terrain.js');
const carvedSource = makeCarvedField.toString();
const cutWidth = +/const CUT_W = ([\d.]+)/.exec(terrainSource)[1];
const protection = +/const PROT_M = (\d+)/.exec(terrainSource)[1];
const roadLift = +/const ROAD_LIFT = ([\d.]+)/.exec(readSrc('public', 'js', 'biomes.js'))[1];
const platformSource = 'function carvePlatforms(platforms) ' + grabBlock(terrainSource, 'function carvePlatforms(')
  + '\nfunction sampleField(field,x,z) ' + grabBlock(terrainSource, 'function sampleField(');
const game = readSrc('public', 'js', 'game.js');
const laneProfileSource = grabMethod(game, '_buildLaneSurf');
const collisionSource = ['_pushOutCircle', '_circleEnter', '_sweepBlockers', '_collide'].map(name => grabMethod(game, name)).join('\n');
let browser;
try {
  browser = await chromium.launch({ executablePath: chromePath(), headless: true,
    args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const page = await browser.newPage({ viewport: { width: 1540, height: 1000 } });
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => {
    if (/THREE.WebGLProgram: Shader Error|BufferGeometryUtils.*failed|ERROR: 0:/.test(message.text())) errors.push(message.text());
  });
  const local = process.env.THREE_MODULE || path.join(ROOT, 'out/forest_review/three.module.js');
  await page.route('**/three@0.160.0/build/three.module.js', async route => route.fulfill({
    contentType: 'text/javascript', body: await readFile(local, 'utf8') }));
  await page.route('**/three@0.160.0/examples/jsm/**', async route => route.fulfill({
    contentType: 'text/javascript', body: await readFile(path.join(path.dirname(local),
      route.request().url().split('/examples/jsm/')[1].split('?')[0].replaceAll('/', '_')), 'utf8') }));
  for (const file of ['review.html', 'review.js']) await page.route('**/tools/road_structure_authoring/' + file + '*',
    route => route.fulfill({ contentType: file.endsWith('.js') ? 'text/javascript' : 'text/html',
      body: readSrc('tools', 'road_structure_authoring', file) }));
  // Serve local production modules through the browser route; no network or game server is needed.
  await page.route('**/public/**', async route => {
    const pathname = decodeURIComponent(new URL(route.request().url()).pathname);
    const file = path.resolve(ROOT, '.' + pathname);
    assert(file.startsWith(path.join(ROOT, 'public') + path.sep));
    await route.fulfill({ contentType: pathname.endsWith('.js') ? 'text/javascript' : 'application/octet-stream',
      body: await readFile(file) });
  });
  await page.addInitScript(({ surface, constants, terrainSource, carvedSource, platformSource, collisionSource, laneProfileSource, cutWidth, protection, clear, rise, roadLift }) => {
    window.__laneProfileSource = laneProfileSource;
    window.__roadSurfaceBlock = surface; window.__roadSurfaceConstants = constants;
    window.__bridgeRise = rise; window.__roadLift = roadLift;
    window.__roadCollisionSource = collisionSource;
    window.__carveRoadFixture = new Function('tsrc', 'CUT_W', 'PROT_M', 'TUN',
      carvedSource + '\nreturn makeCarvedField;')(terrainSource, cutWidth, protection, { CLEAR: clear });
    window.__platformFixture = hf => new Function('N', 'minX', 'maxX', 'minZ', 'maxZ', 'heights', 'markCarved', 'syncHeights',
      platformSource + '\nreturn { carve: carvePlatforms, heightAt: (x,z)=>sampleField(heights,x,z) };')(
      hf.N, hf.minX, hf.maxX, hf.minZ, hf.maxZ, hf.heights, () => {}, () => {});
  }, { surface, constants, terrainSource, carvedSource, platformSource, collisionSource, laneProfileSource, cutWidth, protection, clear: TUN.CLEAR, rise: BRIDGE_RISE, roadLift });
  await page.goto('http://road-review.local/tools/road_structure_authoring/review.html');
  await page.waitForFunction('window.__roadReview', null, { timeout: 60000 });
  const result = await page.evaluate(() => window.__roadReview);
  assert.deepEqual(errors, []); assert.ifError(result.error);
  await writeFile(path.join(directory, 'review.json'), JSON.stringify({ models: result.models }));
  await writeFile(path.join(directory, 'traversal.json'), JSON.stringify(result.report, null, 2));
  await mkdir(path.join(directory, 'textures'), { recursive: true });
  for (const [key, src] of Object.entries(result.textures)) await writeFile(path.join(directory, 'textures', `${key}.png`),
    Buffer.from(src.split(',')[1], 'base64'));
  for (const { key, src } of result.images) await writeFile(path.join(directory, `${key}-runtime.png`),
    Buffer.from(src.split(',')[1], 'base64'));
  await page.screenshot({ path: path.join(directory, 'game-models.png'), fullPage: true });
  console.log(JSON.stringify({ models: result.report.length, report: result.report }));
} finally { await browser?.close(); }
