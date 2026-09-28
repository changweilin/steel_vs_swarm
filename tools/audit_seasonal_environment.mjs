// Seasonal presentation must preserve woody structure, placement RNG and collision;
// snow needs cold plus moisture, and explicit temperatures must not be offset twice.
import assert from 'node:assert/strict';
import { seasonalEnvironment } from '../public/js/seasonalEnvironment.js';
import { TREE_SPECIES, createForestTree, treePhenology, treeDistribution } from '../public/js/forest.js';
import { geologyEnvironment, generateGeology, geologyBackgroundObject } from '../public/js/geology.js';
import { surfaceEnvironment, paintGround, groundPlantState } from '../public/js/proceduralGround.js';
import { seasonalSurfaceColors } from '../public/js/seasonalSurface.js';
import { buildBoundaryRunParts, wallParts, backdropParts, propParts } from '../public/js/edgewall.js';
import { buildSlopeBoundary } from '../public/js/edgeSlope.js';

const seasons = ['spring', 'summer', 'autumn', 'winter'];
const site = { latitude: 48, altitude: 400, moisture: .65, geology: 'granite' };
for (const season of seasons) {
  const input = { ...site, season };
  const env = seasonalEnvironment(input);
  assert.deepEqual(env, seasonalEnvironment(input));
  assert.equal(env.temperature, surfaceEnvironment(input).temperature);
  assert.equal(env.temperature, geologyEnvironment(input).temperature);
  assert.equal(env.snow, geologyEnvironment(input).snow);
  assert.equal(env.temperature, seasonalEnvironment({ ...input, latitude: -48 }).temperature);
  assert.equal(seasonalEnvironment({ ...input, temperature: 7 }).temperature, 7);
  assert.deepEqual(treeDistribution(48, 400, .5, input), treeDistribution(48, 400, .5, site));
}
assert.equal(seasonalEnvironment({ latitude: 0, season: 'winter', weather: 'snow' }).snow, 0);
assert.equal(seasonalEnvironment({ temperature: -15, moisture: 0, season: 'winter' }).snow, 0);
assert.ok(seasonalEnvironment({ ...site, season: 'winter' }).snow > 0);
assert.ok(seasonalEnvironment({ latitude: 0, altitude: 5500, season: 'winter' }).snow > 0);
assert.equal(seasonalEnvironment({ temperature: 20, weather: 'heavy_rain' }).wetness, .8);
assert.ok(seasonalEnvironment({ latitude: 60, season: 'autumn' }).autumn > seasonalEnvironment({ latitude: 0, season: 'autumn' }).autumn);
assert.equal(surfaceEnvironment({ geology: 'basalt' }).ph, 5.8);
assert.equal(surfaceEnvironment({ geology: 'limestone', ph: 6 }).ph, 6);

const woody = tree => tree.parts.filter(p => !['leaf', 'flower', 'fruit', 'snow'].includes(p.role));
for (const type of Object.keys(TREE_SPECIES)) for (let seed = 0; seed < 12; seed++) {
  const summer = createForestTree(type, seed, undefined, undefined, 1, 'summer', site);
  for (const season of seasons) {
    const tree = createForestTree(type, seed, undefined, undefined, 1, season, site);
    assert.deepEqual(woody(tree), woody(summer), `${type}: stable branches/roots`);
    assert.deepEqual(tree.stems, summer.stems, `${type}: stable collision`);
    assert.equal(tree.footprint, summer.footprint);
    assert.deepEqual(tree, createForestTree(type, seed, undefined, undefined, 1, season, site));
    if (TREE_SPECIES[type].phenology?.habit === 'deciduous' && season === 'winter') {
      assert.ok(tree.parts.filter(p => p.role === 'leaf').every(p => p.hidden));
      assert.ok(!tree.parts.some(p => ['flower', 'fruit'].includes(p.role)));
    }
  }
}
assert.equal(treePhenology('scotsPine', { ...site, season: 'winter' }).retention, 1);
assert.equal(treePhenology('coconut', { latitude: 5, season: 'winter' }).retention, 1);
assert.equal(treePhenology('ginkgo', { latitude: 0, season: 'winter' }).retention, 1);
assert.ok(treePhenology('baobab', { temperature: 30, moisture: .02 }).retention < .2);
const oak = treePhenology('pedunculateOak', { ...site, season: 'autumn' });
assert.ok(oak.retention < 1 && oak.litter > 0);
assert.notEqual(oak.leafColor, TREE_SPECIES.pedunculateOak.leaf);
const pine = createForestTree('scotsPine', 17, undefined, undefined, 1, 'winter', site);
assert.ok(pine.parts.some(p => p.role === 'snow'));
const flowers = Array.from({ length: 20 }, (_, seed) => createForestTree('rhododendron', seed, undefined, undefined, 1, 'spring', { temperature: 15, moisture: .7 }));
assert.ok(flowers.some(t => t.parts.some(p => p.role === 'flower')));
assert.ok(!createForestTree('rhododendron', 1, undefined, undefined, 1, 'spring', { temperature: -5 }).parts.some(p => p.role === 'flower'));
const growing = { temperature: 15, moisture: .7, season: 'spring' };
assert.ok(treePhenology('rhododendron', { ...growing, geology: 'granite' }).growth > 0);
assert.equal(treePhenology('rhododendron', { ...growing, geology: 'limestone' }).growth, 0);
assert.equal(treePhenology('rhododendron', { ...growing, geology: 'limestone', ph: 5 }).growth,
  treePhenology('rhododendron', { ...growing, ph: 5 }).growth, 'Explicit soil pH wins');
for (let seed = 0; seed < 12; seed++) {
  const acid = createForestTree('rhododendron', seed, undefined, undefined, 1, 'spring', { ...growing, geology: 'granite' });
  const lime = createForestTree('rhododendron', seed, undefined, undefined, 1, 'spring', { ...growing, geology: 'limestone' });
  assert.ok(!lime.parts.some(p => p.role === 'flower'));
  assert.deepEqual(woody(acid), woody(lime));
  assert.deepEqual(acid.stems, lime.stems);
}
const fruit = Array.from({ length: 20 }, (_, seed) => createForestTree('coconut', seed, undefined, undefined, 1, 'spring', { latitude: 5 }));
assert.ok(fruit.some(t => t.parts.some(p => p.role === 'fruit')));

const rock = generateGeology('granite', 17, { ...site, season: 'summer' });
const winterRock = generateGeology('granite', 17, { ...site, season: 'winter' });
assert.deepEqual(rock.parameters, winterRock.parameters);
assert.ok(winterRock.surfaces.find(s => s.kind === 'snow').coverage > 0);
assert.equal(rock.surfaces.find(s => s.kind === 'snow').coverage, 0);
function paint(input) {
  const log = [];
  const context = new Proxy({}, { get: (o, k) => o[k] ?? ((...args) => log.push([k, ...args])),
    set: (o, k, v) => { log.push([k, v]); o[k] = v; return true; } });
  paintGround(context, 256, 'turf', 12, surfaceEnvironment(input));
  return log;
}
const snowPaint = paint({ ...site, season: 'winter' });
assert.deepEqual(snowPaint, paint({ ...site, season: 'winter' }));
assert.ok(snowPaint.some(row => row[0] === 'fillStyle' && row[1] === '#e9f0f4'));
assert.ok(!paint({ latitude: 0, season: 'winter' }).some(row => row[0] === 'fillStyle' && row[1] === '#e9f0f4'));
const frozen = seasonalEnvironment({ temperature: -12, moisture: .8, season: 'winter' });
const warm = seasonalEnvironment({ temperature: 24, moisture: .8, season: 'winter' });
// Independent horizontal top, vertical wall and underside triangles test deposition direction.
const mesh = { vertices: [0,1,0, 0,1,1, 1,1,0, 0,0,0, 1,0,0, 0,1,0, 0,0,0, 1,0,0, 0,0,1],
  faces: [0,1,2, 3,4,5, 6,7,8], colors: Array(27).fill(.2) };
const original = structuredClone(mesh), covered = seasonalSurfaceColors(mesh, frozen);
assert.deepEqual(mesh, original);
assert.ok(covered.slice(0, 9).every(c => c > .2));
assert.deepEqual(covered.slice(9), mesh.colors.slice(9), 'vertical/underside surfaces stay bare');
assert.deepEqual(seasonalSurfaceColors(mesh, warm), mesh.colors);
assert.ok(seasonalSurfaceColors(mesh, seasonalEnvironment({ temperature: 15, weather: 'rain' })).every(c => c < .2));
assert.deepEqual(covered, seasonalSurfaceColors(mesh, frozen));
for (const kind of ['cliff', 'rockery', 'landslide']) {
  const opts = { len: 30, depth: 18, h: 32, bufferDepth: 40, seed: 12, season: 'winter' };
  const cold = buildBoundaryRunParts(kind, { ...opts, environment: frozen });
  const hot = buildBoundaryRunParts(kind, { ...opts, environment: warm });
  for (const group of ['parts', 'bufferParts']) {
    const coldMeshes = cold[group].filter(p => p.g[0] === 'mesh');
    const hotMeshes = hot[group].filter(p => p.g[0] === 'mesh');
    assert.ok(coldMeshes.length > 0);
    coldMeshes.forEach((p, i) => {
      assert.deepEqual(p.g[1].vertices, hotMeshes[i].g[1].vertices);
      assert.deepEqual(p.g[1].faces, hotMeshes[i].g[1].faces);
      assert.notDeepEqual(p.g[1].colors, hotMeshes[i].g[1].colors);
    });
  }
}
const opts = { len: 30, depth: 18, h: 32, x: 10, z: 5, heightAt: x => x * .1, season: 'winter' };
for (const fill of [null, { depth: 50, crest: 9, heightAt: x => x * .1 }]) {
  const a = buildSlopeBoundary('cliff', { ...opts, fill, environment: frozen });
  const b = buildSlopeBoundary('cliff', { ...opts, fill, environment: warm });
  assert.equal(a.lo, b.lo); assert.equal(a.hi, b.hi);
  for (const [i, part] of [...a.parts, ...(a.bufferParts || [])].entries()) {
    const other = [...b.parts, ...(b.bufferParts || [])][i];
    assert.deepEqual(part.g[1].vertices, other.g[1].vertices);
    assert.deepEqual(part.p, other.p);
  }
  assert.notDeepEqual(a.parts[0].g[1].colors, b.parts[0].g[1].colors);
}
assert.notDeepEqual(wallParts('densegiants', { ...opts, seed: 4, environment: frozen }),
  wallParts('densegiants', { ...opts, seed: 4, environment: warm }), 'boundary trees receive climate');
const joinedOpts = { len: 30, depth: 18, h: 25, z: 0, season: 'winter', environment: frozen,
  heightAt: x => 10 + x * .1,
  fill: { depth: 50, crest: 9, heightAt: x => 10 + x * .1,
    joins: [{ kind: 'cliff', h: 25, depth: 18 }, { kind: 'cliff', h: 25, depth: 18 }] } };
function boundaryColors(x) {
  const boundary = buildSlopeBoundary('cliff', { ...joinedOpts, x }), points = new Map();
  for (const part of [...boundary.parts, ...boundary.bufferParts]) {
    const mesh = part.g[1];
    for (let i = 0; i < mesh.surfaceVertexCount; i++) {
      const v = i * 3;
      if (Math.abs(mesh.vertices[v] + part.p[0] + x - 15) > 1e-5) continue;
      const key = [mesh.vertices[v + 1] + part.p[1], mesh.vertices[v + 2] + part.p[2]]
        .map(n => n.toFixed(5)).join(',');
      points.set(key, mesh.colors.slice(v, v + 3));
    }
  }
  return points;
}
const leftColors = boundaryColors(0), rightColors = boundaryColors(30);
assert.ok(leftColors.size > 20, 'Cover both wall and buffer seams');
assert.deepEqual(leftColors, rightColors, 'Continuous surfaces have identical snow colors at shared endpoints');
assert.equal(groundPlantState('flower', frozen).visible, false);
assert.equal(groundPlantState('flower', seasonalEnvironment({ latitude: 5, season: 'winter' })).visible, true);
assert.equal(groundPlantState('flower', seasonalEnvironment({ latitude: 45, season: 'spring', temperature: 15 })).visible, true);
assert.equal(groundPlantState('bench', frozen).visible, true);
assert.ok(groundPlantState('rice', frozen).dry > groundPlantState('rice', warm).dry);
for (const kind of ['forest', 'sea']) {
  const options = { len: 90, h: 30, seed: 7, season: 'winter' };
  const cold = backdropParts(kind, { ...options, environment: frozen });
  assert.deepEqual(cold, backdropParts(kind, { ...options, environment: frozen }));
  assert.notDeepEqual(cold, backdropParts(kind, { ...options, environment: warm }));
}
assert.notDeepEqual(propParts('grove', 7, { season: 'winter', environment: frozen }),
  propParts('grove', 7, { season: 'winter', environment: warm }));
for (let seed = 0; seed < 12; seed++) {
  const options = { len: 120, h: 100, seed, season: 'winter' };
  const cold = backdropParts('mountain', { ...options, environment: frozen });
  const hot = backdropParts('mountain', { ...options, environment: warm });
  assert.ok(cold.some(p => p.c === 0xd8dee4));
  assert.ok(!hot.some(p => p.c === 0xd8dee4));
  assert.deepEqual(cold.filter(p => p.c !== 0xd8dee4), hot, 'Snow leaves summit geometry and RNG unchanged');
}
// Substrate affects generic terrain colors only, preserving topology and authored rock types.
const substrates = ['basalt', 'granite', 'limestone', 'sandstone', 'alluvium'];
for (const kind of ['cliff', 'rockery', 'landslide', 'debris', 'basaltspine', 'reefchain']) {
  const samples = substrates.map(geology => buildBoundaryRunParts(kind, {
    len: 30, depth: 18, h: 32, bufferDepth: 40, seed: 12, environment: { ...growing, geology },
  }));
  for (const group of ['parts', 'bufferParts']) {
    const meshes = samples.map(s => s[group].filter(p => p.g[0] === 'mesh'));
    for (let i = 1; i < meshes.length; i++) meshes[i].forEach((part, j) => {
      assert.deepEqual(part.g[1].vertices, meshes[0][j].g[1].vertices);
      assert.deepEqual(part.g[1].faces, meshes[0][j].g[1].faces);
      assert.deepEqual(part.p, meshes[0][j].p);
      if (['basaltspine', 'reefchain'].includes(kind)) assert.deepEqual(part.g[1].colors, meshes[0][j].g[1].colors);
      else assert.notDeepEqual(part.g[1].colors, meshes[0][j].g[1].colors);
    });
  }
}
for (const fill of [null, { depth: 50, crest: 9, heightAt: x => x * .1 }]) {
  const samples = substrates.map(geology => buildSlopeBoundary('cliff', { ...opts, fill, environment: { ...growing, geology } }));
  for (const sample of samples.slice(1)) {
    assert.deepEqual(sample.parts[0].g[1].vertices, samples[0].parts[0].g[1].vertices);
    assert.notDeepEqual(sample.parts[0].g[1].colors, samples[0].parts[0].g[1].colors);
  }
}
for (const type of ['cliff', 'granite']) {
  const a = geologyBackgroundObject(type, 9, { ...growing, geology: 'limestone' });
  const b = geologyBackgroundObject(type, 9, { ...growing, geology: 'basalt' });
  assert.deepEqual(a.meshData.vertices, b.meshData.vertices);
  if (type === 'cliff') assert.notDeepEqual(a.meshData.colors, b.meshData.colors);
  else assert.deepEqual(a.meshData.colors, b.meshData.colors);
}
console.log('Seasonal environment: 42 species × 12 seeds × 4 seasons; stable structure, boundary coverage, deposition direction and ground dormancy passed.');
