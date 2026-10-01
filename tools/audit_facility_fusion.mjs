// Guards: exact mapped sports envelopes, unknown-data omission, functional POI ownership,
// religious/era/source precedence, climate/material adaptation and bounded rendered geometry.
import assert from 'node:assert/strict';
import { mkdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { ROOT } from './audit_src.mjs';
import { chromiumOrNull, chromePath, serve } from './pw.mjs';
import { classifyArea, pointInProjectedArea, projectedAreaContainsRect } from '../public/js/osmAreas.js';
import { planOsmAreaObjects } from '../public/js/osmAreaLayout.js';
import { osmSportSpec } from '../public/js/osmSports.js';
import { taggedBuildingFunction } from '../public/js/buildingFunctions.js';
import { createArchitecturePlanner, chooseArchitecture } from '../public/js/buildingDiversity.js';
import { functionalBuildingParts } from '../public/js/functionalBuildingParts.js';
import { osmFeatureQuery, parseOsmFeatureElements } from '../public/js/osmQuery.js';

const rectangle = (w, d, x = 0, z = 0) => ({ outer: [[x-w/2,z-d/2],[x+w/2,z-d/2],[x+w/2,z+d/2],[x-w/2,z+d/2]], holes: [] });
const area = (sourceId, tags, poly = rectangle(100, 70)) => ({ sourceId, tags, classification: classifyArea(tags),
  centroid: { x: 0, z: 0 }, worldPolygons: [poly] });
const terrain = { minX: -200, maxX: 200, minZ: -200, maxZ: 200, worldW: 400, worldH: 400, gridM: 5,
  heightAt: () => 10, waterY: 0, evidenceAt: () => ({ confidence: 2, sources: 3, brightness: 150 }) };
const options = { terrain, heightAt: terrain.heightAt, envCodeAt: () => 0, seed: 77 };
const basketball = area('court', { leisure: 'pitch', sport: 'basketball' });
const track = area('track', { leisure: 'track', sport: 'running' }, rectangle(230, 120));
for (const facility of [basketball, track, area('tennis', { leisure: 'pitch', sport: 'tennis' })]) {
  const plan = planOsmAreaObjects([facility], options);
  assert.equal(plan.placed.length, 1);
  const p = plan.placed[0];
  assert(p.sport && p.shape === 'sport');
  assert(projectedAreaContainsRect(p.x, p.z, p.sport.hw, p.sport.hd, p.ry, facility.worldPolygons[0]));
  assert(Math.abs(p.sport.hw / p.sport.hd - p.sport.length / p.sport.width) < 1e-12);
  assert.deepEqual(plan, planOsmAreaObjects([facility], options));
}
assert.equal(planOsmAreaObjects([basketball], { ...options, heightAt: () => NaN }).placed.length, 0);
assert.equal(planOsmAreaObjects([basketball], { ...options, envCodeAt: () => 1 }).placed.length, 0);
assert.equal(planOsmAreaObjects([basketball], { ...options, blocked: () => true }).placed.length, 0);
assert.equal(planOsmAreaObjects([basketball], { ...options, heightAt: x => x * .15 + 10 }).placed.length, 0);
assert.equal(osmSportSpec({ leisure: 'pitch' }), null);
assert.equal(osmSportSpec({ leisure: 'pitch', sport: 'golf' }), null);
assert.equal(osmSportSpec({ leisure: 'stadium', sport: 'soccer' }), null);
assert.equal(osmSportSpec({ leisure: 'pitch', sport: 'tennis', indoor: 'yes' }), null);
assert.equal(osmSportSpec({ leisure: 'track', sport: 'athletics', athletics: 'long_jump' }), null);
assert.equal(osmSportSpec({ leisure: 'track', sport: 'running', lanes: '6' }).lanes, 6);
assert.equal(osmSportSpec({ leisure: 'pitch', sport: 'basketball;volleyball' }), null);
const tinyHole = { ...rectangle(20, 20), holes: [rectangle(.2, .2, 1, 1).outer] };
assert(!projectedAreaContainsRect(0, 0, 5, 4, 0, tinyHole));
const notch = { outer: [[-10,-10],[10,-10],[10,10],[1,10],[1,0],[0,0],[0,10],[-10,10]], holes: [] };
assert(!projectedAreaContainsRect(0, 0, 5, 4, 0, notch));
const replayAreas = [basketball, area('nearby', { leisure: 'pitch', sport: 'tennis' }, rectangle(50, 35, 110, 0))];
assert.deepEqual(planOsmAreaObjects(replayAreas, options), planOsmAreaObjects(replayAreas.toReversed(), options));

const building = area('building', { building: 'yes' }, rectangle(40, 30));
const planner = (pois, areas = []) => createArchitecturePlanner({ areas, terrain, seed: 5,
  country: 'TW', pois, toXZ: p => [p.x, p.z], environmentAt: () => ({ climate: 'tropical', geology: 'basalt' }) });
const libraryPoint = { x: 0, z: 0, tags: { amenity: 'library', construction_date: '1920', 'building:material': 'brick' } };
const library = planner([libraryPoint])(building, building.worldPolygons[0]);
assert.equal(library.functionInfo.type, 'library');
assert.equal(library.functionalDesign.year, 1920);
assert.equal(library.functionalDesign.material, 'brick');
assert.equal(library.functionalDesign.climate, 'tropical');
assert.notEqual(planner([{ ...libraryPoint, x: 100 }])(building, building.worldPolygons[0]).functionInfo.type, 'library');
assert.notEqual(planner([libraryPoint, { x: 1, z: 1, tags: { tourism: 'museum' } }])(building, building.worldPolygons[0]).functionInfo.type, 'library');
const courtyard = { ...building.worldPolygons[0], holes: [rectangle(4, 4).outer] };
assert.notEqual(planner([libraryPoint])(building, courtyard).functionInfo.type, 'library');
const hospital = { ...building, tags: { building: 'hospital' } };
assert.equal(planner([libraryPoint])(hospital, building.worldPolygons[0]).functionInfo.type, 'hospital');
const campus = area('campus', { amenity: 'school', height: '80', 'plant:source': 'solar' }, rectangle(100, 90));
const school = planner([], [campus])(building, building.worldPolygons[0]);
assert.equal(school.functionInfo.type, 'school');
assert(school.targetHeight < 80, 'Campus geometry must never overwrite its children');
const templeParcel = area('temple-parcel', { amenity: 'place_of_worship', religion: 'buddhist', denomination: 'theravada' });
assert.equal(planner([], [templeParcel])(building, building.worldPolygons[0]).functionalDesign.id, 'theravada_hall');
assert.equal(taggedBuildingFunction({ building: 'library' }).type, 'library');
assert.equal(taggedBuildingFunction({ building: 'yes', 'building:use': 'museum' }).type, 'museum');
assert.equal(classifyArea({ amenity: 'library' }).generator, 'civic');
assert.equal(classifyArea({ tourism: 'museum' }).generator, 'civic');

const design = (tags, context = {}) => chooseArchitecture(1, 'design', { building: { tags }, ...context });
const orthodox = design({ building: 'church', denomination: 'orthodox', start_date: '2000' });
assert.equal(orthodox.functionalDesign.motif, 'orthodox');
assert.equal(design({ building: 'church', 'building:architecture': 'gothic', construction_date: '1980' }).functionalDesign.id, 'gothic_church');
assert.equal(design({ building: 'church', 'building:architecture': 'modern' }).functionalDesign.id, 'modern_church');
assert.equal(design({ power: 'plant', 'plant:source': 'solar' }).functionalDesign.motif, 'solar');
assert.equal(design({ power: 'plant', 'plant:source': 'nuclear' }).functionalDesign.motif, 'nuclear');
assert.equal(design({ building: 'temple', religion: 'taoist' }).functionalDesign.id, 'taoist_hall');
assert.equal(design({ building: 'temple', religion: 'buddhist', denomination: 'theravada' }).functionalDesign.id, 'theravada_hall');
assert.equal(design({ building: 'hospital', construction_date: '2000' }, { climate: 'boreal' }).roofForm, 'gable');
assert.equal(design({ building: 'hospital', 'roof:shape': 'flat' }, { climate: 'boreal' }).roofForm, 'flat');
assert.equal(design({ building: 'church', 'building:material': 'brick' }, { geology: 'basalt' }).functionalDesign.material, 'brick');
assert.equal(design({ building: 'church' }).functionalDesign.material, null);
const edges = [{ x: 0, z: -10, y: 0, h: 14, hw2: 12, hd2: .15, ry: 0 }];
const religiousStyles = [design({ building: 'temple', religion: 'buddhist' }), design({ building: 'mosque' }), design({ building: 'church' })];
for (const style of religiousStyles) {
  const parts = functionalBuildingParts(edges, 0, 14, style, [0, 0], 6, 9).parts;
  assert(parts.length <= 160 && parts.every(p => p.p.every(Number.isFinite)));
  if (style.functionInfo.type === 'temple') assert(parts.some(p => p.role.includes('dharma-wheel')));
  if (style.functionInfo.type === 'mosque') assert(parts.some(p => p.role.includes('crescent-finial')));
  if (style.functionInfo.type === 'church') assert(parts.some(p => p.role.includes('christian-cross')));
}
assert(!functionalBuildingParts(edges, 0, 14, design({ amenity: 'place_of_worship' }), [0,0], 6, 9).parts
  .some(p => /christian-cross|crescent|dharma-wheel/.test(p.role)));
const query = osmFeatureQuery({ minLat: 24, maxLat: 25, minLng: 120, maxLng: 121 });
assert(query.includes('node["amenity"') && query.includes('node["office"="government"]'));
assert.equal(parseOsmFeatureElements([{ type: 'node', id: 1, lat: 24.5, lon: 120.5, tags: libraryPoint.tags }]).pois.length, 1);
console.log('PASS facility fusion: mapped envelopes, omission, POI ownership and functional evidence precedence');

const chromium = await chromiumOrNull();
if (!chromium) { console.log('SKIP facility browser geometry: Playwright unavailable'); process.exit(0); }
const server = await serve(), browser = await chromium.launch({ headless: true, executablePath: chromePath() });
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  if (process.env.THREE_MODULE) {
    await page.route('**/three@0.160.0/build/three.module.js', async route => route.fulfill({ contentType: 'text/javascript',
      body: await readFile(process.env.THREE_MODULE, 'utf8') }));
    await page.route('**/three@0.160.0/examples/jsm/**', async route => route.fulfill({ contentType: 'text/javascript',
      body: await readFile(path.join(path.dirname(process.env.THREE_MODULE), route.request().url().split('/examples/jsm/')[1].replaceAll('/', '_')), 'utf8') }));
  }
  await page.route('**/main.js', route => route.fulfill({ contentType: 'text/javascript', body: '' }));
  await page.goto(server.url, { waitUntil: 'domcontentloaded' });
  const report = await page.evaluate(async ({ terrain, facilities }) => {
    const THREE = await import('three');
    const { buildOsmAreaObjects } = await import('/public/js/osmAreaObjects.js');
    const { createArchitecturePlanner } = await import('/public/js/buildingDiversity.js');
    const { buildOsmPolygonBuildings, functionalRoofSite } = await import('/public/js/osmBuilding.js');
    const { disposeTree } = await import('/public/js/toon.js');
    terrain.heightAt = () => 10; terrain.evidenceAt = () => ({ confidence: 2, sources: 3, brightness: 150 });
    const check = (value, message) => { if (!value) throw new Error(message); };
    const sports = new THREE.Group();
    const result = buildOsmAreaObjects(sports, facilities, { terrain, heightAt: terrain.heightAt, envCodeAt: () => 0, seed: 77 });
    check(result.generated === 1 && result.blockers.length === 2, 'Basketball must have two equipment boxes, not a solid field');
    const surface = sports.children.find(m => m.name.startsWith('osm-sports/court/'));
    check(surface?.geometry.attributes.uv && surface.material.map, 'Mapped markings lost UVs or texture');
    for (const b of result.blockers) check(Math.abs(b.r - Math.hypot(b.hw2, b.hd2)) < 1e-8, 'Equipment collider mismatch');
    disposeTree(sports);
    const root = new THREE.Group(), rows = [
      { tags: { building: 'temple', religion: 'buddhist' }, country: 'TW' },
      { tags: { building: 'mosque', amenity: 'place_of_worship', religion: 'muslim' }, country: 'IR' },
      { tags: { building: 'church', denomination: 'orthodox' }, country: 'GR' },
      { tags: { building: 'library', start_date: '1920' }, country: 'GB' },
      { tags: { building: 'school', start_date: '2000' }, country: 'TW' },
      { tags: { building: 'train_station' }, country: 'JP' },
      { tags: { building: 'hospital' }, country: 'TW' },
      { tags: { building: 'civic' }, country: 'US' },
      { tags: { building: 'museum' }, country: 'FR' },
      { tags: { building: 'industrial' }, country: 'GB' },
      { tags: { building: 'yes', power: 'plant', 'plant:source': 'solar' }, country: 'AU' },
      { tags: { building: 'yes', power: 'plant', 'plant:source': 'nuclear' }, country: 'FR' },
    ];
    const signatures = [];
    for (let i = 0; i < rows.length; i++) {
      const group = new THREE.Group(), row = rows[i];
      const poly = { outer: [[-12,-10],[12,-10],[12,10],[-12,10]], holes: [] };
      const building = { sourceId: `review/${i}`, tags: { ...row.tags, height: '14' }, centroid: { x: 0, z: 0 },
        classification: { generator: 'polygonBuilding', kind: 'house' }, worldPolygons: [poly] };
      const architectureOf = createArchitecturePlanner({ terrain, country: row.country, seed: 1,
        environmentAt: () => ({ climate: 'temperate', geology: 'limestone' }) });
      const result = buildOsmPolygonBuildings(group, [building], { terrain, architectureOf, terrainEnvCode: () => 0 });
      check(result.blockers.length >= 4 && result.generated === 1, 'Mapped building missing');
      group.traverse(node => {
        if (!node.isMesh) return;
        const p = node.geometry.attributes.position;
        for (const value of p.array) check(Number.isFinite(value), 'Non-finite cultural geometry');
      });
      signatures.push(architectureOf(building, poly).functionalDesign?.id);
      group.position.set((i % 4 - 1.5) * 42, -10, (Math.floor(i / 4) - 1) * 43); root.add(group);
    }
    const courtyard = { outer: [[-20,-20],[20,-20],[20,20],[-20,20]], holes: [[[-7,-7],[7,-7],[7,7],[-7,7]]] };
    const site = functionalRoofSite(courtyard, 10);
    check(site && Math.hypot(...site.point) > 7, 'Courtyard must retain a solid fitted roof site');
    const { functionalBuildingParts } = await import('/public/js/functionalBuildingParts.js');
    const { architecturePartGeometry } = await import('/public/js/architecturePartGeometry.js');
    const { chooseArchitecture } = await import('/public/js/buildingDiversity.js');
    for (const kind of ['temple', 'mosque', 'church']) for (const half of [.8, 2, 8]) {
      const style = chooseArchitecture(1, kind, { building: { tags: { building: kind } } });
      const parts = functionalBuildingParts([{ x: 0, z: -10, y: 0, h: 14, hw2: 12, hd2: .15, ry: 0 }],
        0, 14, style, [0, 0], half, 8).parts;
      for (const part of parts.filter(p => p.p[1] >= 14)) {
        const geo = architecturePartGeometry(part); geo.computeBoundingBox(); const b = geo.boundingBox;
        check(Math.max(Math.abs(b.min.x), Math.abs(b.max.x), Math.abs(b.min.z), Math.abs(b.max.z)) <= half + 1e-5,
          'Cultural roof escaped the verified patch');
        check(b.max.y <= 22 + 1e-5, 'Cultural roof exceeded its height budget'); geo.dispose();
      }
    }
    document.body.replaceChildren(); document.body.style.margin = '0';
    const scene = new THREE.Scene(); scene.background = new THREE.Color(0xdce2d5); scene.add(root);
    scene.add(new THREE.HemisphereLight(0xffffff, 0x758476, 3));
    const sun = new THREE.DirectionalLight(0xffffff, 2); sun.position.set(-60, 120, 80); scene.add(sun);
    const camera = new THREE.PerspectiveCamera(40, 1440 / 900, .1, 1000); camera.position.set(150, 180, 220); camera.lookAt(0, 3, 0);
    const renderer = new THREE.WebGLRenderer({ antialias: true }); renderer.setSize(1440, 900);
    document.body.append(renderer.domElement); renderer.render(scene, camera);
    window.facilityReview = { scene, renderer, camera, root };
    return { styles: signatures, equipment: result.blockers.length };
  }, { terrain: { ...terrain, heightAt: undefined, evidenceAt: undefined }, facilities: [basketball] });
  assert.equal(errors.length, 0, errors.join('\n'));
  const out = path.join(ROOT, 'tools/.shots/facility-fusion'); await mkdir(out, { recursive: true });
  await page.screenshot({ path: path.join(out, 'buildings.png') });
  const sportsReport = await page.evaluate(async () => {
    const THREE = await import('three');
    const { buildOsmAreaObjects } = await import('/public/js/osmAreaObjects.js');
    const { classifyArea } = await import('/public/js/osmAreas.js');
    const { disposeTree } = await import('/public/js/toon.js');
    const { scene, renderer, camera, root } = window.facilityReview;
    scene.remove(root); disposeTree(root);
    const sports = new THREE.Group(), rows = [
      ['basketball', 'pitch', -130, -80, 45, 30], ['basketball', 'pitch', -70, -80, 45, 30],
      ['tennis', 'pitch', 0, -80, 40, 25], ['soccer', 'pitch', 105, -65, 150, 100],
      ['running', 'track', -105, 80, 225, 120], ['baseball', 'pitch', 105, 80, 150, 150],
    ];
    const areas = rows.map(([sport, leisure, x, z, w, d], i) => {
      const tags = { sport, leisure };
      return { sourceId: `sport/${i}`, tags, classification: classifyArea(tags),
        worldPolygons: [{ outer: [[x-w/2,z-d/2],[x+w/2,z-d/2],[x+w/2,z+d/2],[x-w/2,z+d/2]], holes: [] }] };
    });
    const terrain = { minX: -300, maxX: 300, minZ: -300, maxZ: 300, worldW: 600, worldH: 600, gridM: 5,
      heightAt: () => 0, evidenceAt: () => ({ confidence: 2, sources: 3, brightness: 150 }) };
    const result = buildOsmAreaObjects(sports, areas, { terrain, heightAt: terrain.heightAt, envCodeAt: () => 0, seed: 12 });
    if (result.generated !== rows.length) throw new Error('Missing mapped sports: ' + JSON.stringify(result.skipped));
    const court = sports.children.find(m => m.name === 'osm-sports/court//');
    if (!court?.geometry.attributes.uv || court.geometry.attributes.position.count < 100) throw new Error('Batched courts lost UVs');
    if (result.footprints.length !== rows.length) throw new Error('Sports envelopes were not reserved');
    scene.add(sports); camera.position.set(0, 360, 340); camera.lookAt(0, 0, 0); renderer.render(scene, camera);
    return { generated: result.generated, meshes: sports.children.length, equipment: result.blockers.length };
  });
  await page.screenshot({ path: path.join(out, 'sports.png') });
  console.log('PASS facility browser geometry:', JSON.stringify(report));
  console.log('PASS mapped sports rendering:', JSON.stringify(sportsReport));
  console.log('Review:', path.join(out, 'buildings.png'));
} finally { await browser.close(); server.close(); }
